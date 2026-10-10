'use strict';

/**
 * AI decision-log viewer. Scrubs through a session's analyzed frames, each
 * paired with the STATE the coach parsed from it. Text only, never innerHTML:
 * STATE is AI-written.
 *
 * The last five sessions are kept on disk and any of them can be opened from the
 * picker, but only one is ever loaded. Frames are the expensive part, running
 * several megabytes a session before base64 inflates them, so the picker is
 * built from metadata alone and a switch pays for exactly one session.
 *
 * ONE MATCH (8.2). The eye on a review opens the log on that match alone, in
 * death review mode: its frames and nothing else, no picker, and "Whole
 * session" for the rest. Main finds the frames from the review; when they are
 * gone the window says so, and never shows another session in their place.
 * "Whole session" is as strict: that session, or the reason it is not here.
 */
const $ = (id) => document.getElementById(id);
let records = [];
let idx = 0;
let sessionId = null;   // which session is loaded; rides along with every question
let scope = null;       // one match of that session, from a review's eye: { session, match, from, to } or { gone }
let segments = [];      // confirmed map stretches, from the main process
let deaths = [];        // every death found in the frames
let deathMode = false;  // opened on the deaths, from a review's eye
let deathAt = -1;       // which death is on screen, an index into `deaths`

/*
 * WHETHER THIS SESSION COULD HAVE SHOWN THE PLAYER ANYTHING.
 *
 * Before 8.0 the coach spoke during the match. Every frame was logged with what
 * it showed (`shown`, null when it said nothing), and a death the coach never
 * reviewed was the interesting case, so the log counted reviewed deaths and
 * greyed the rest. Since 8.0 nothing reaches the screen during a match in any
 * game, by design, and frames are logged with no `shown` field at all. Judged
 * the old way, every death in every 8.0 session read as the coach going quiet:
 * "0 reviewed", grey skulls, "no review was shown". So a session whose frames
 * carry no `shown` field describes its deaths plainly, and only a log from the
 * tip era keeps the reviewed split it was written with.
 */
let tipEra = false;
const recordedTips = (recs) => recs.some((r) => r && Object.prototype.hasOwnProperty.call(r, 'shown'));

/** "an Outlaw", "an Odin", "a Vandal": the kill line names Riot's weapon. */
const withWeapon = (w) => (w ? ` with ${/^[aeiou]/i.test(w) ? 'an' : 'a'} ${w}` : '');

// The STATE fields worth surfacing, in a sensible reading order, with the
// location + alive reads flagged since those are the usual culprits.
const FIELDS = [
  ['map', 'map'], ['side', 'side'], ['gameMode', 'mode'], ['roundNumber', 'round'],
  ['clock', 'clock'], ['phase', 'phase'],
  ['playerHp', 'health', 'key'],            // the ground truth for being alive
  ['playerAlive', 'alive', 'alive'],
  ['playerSpot', 'location', 'key'], ['teamScore', 'your score'], ['enemyScore', 'their score'],
  ['teammatesAlive', 'mates alive'], ['enemiesAlive', 'foes alive'],
  ['playerWeapon', 'weapon'], ['playerCredits', 'credits'],
  ['spike', 'spike', 'key'], ['spikeSpot', 'spike at', 'key'],
  ['killFeed', 'kill feed'],
  ['enemySpot', 'enemy spot'], ['teamRead', 'team read'], ['playerNote', 'note'],
];

function fmtTime(at, first) {
  if (!at) return '';
  const secs = first ? Math.round((at - first) / 1000) : 0;
  const mm = String(Math.floor(secs / 60)).padStart(2, '0');
  const ss = String(secs % 60).padStart(2, '0');
  return `+${mm}:${ss}`;
}

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = String(text);
  return n;
}

function render() {
  const r = records[idx];
  if (!r) return;
  $('frame').src = r.frameData || '';
  $('pos').textContent = `${idx + 1} / ${records.length}`;
  $('time').textContent = fmtTime(r.at, records[0] && records[0].at);
  $('slider').value = String(idx);

  // The map for the stretch this frame sits in. Deliberately NOT r.state.map:
  // that is one frame's guess, and one frame's guess is wrong often enough that
  // showing it here would contradict the timeline directly above it.
  const seg = segments.find((s) => idx >= s.from && idx <= s.to);
  const segEl = $('seg');
  if (!seg || !seg.map) {
    segEl.textContent = segments.length ? 'map not confirmed' : '';
    segEl.className = 'seg unsure';
    segEl.title = 'The location names on screen were not enough to identify the map.';
  } else {
    const n = segments.filter((s) => s.map).length;
    segEl.textContent = seg.map + (n > 1 ? ` (${segments.indexOf(seg) + 1} of ${n})` : '');
    segEl.className = 'seg' + (seg.confirmed ? '' : ' unsure');
    segEl.title = seg.confirmed
      ? `Confirmed: the AI read ${seg.byModel} and the ${seg.labels} location names on screen also fingerprint ${seg.byLabel}.`
      : `Unconfirmed: the AI read ${seg.byModel || 'nothing usable'}, the location names point to ${seg.byLabel || 'nothing definite'}. The location names are trusted.`;
  }

  // What the coach saw this frame: the one factual note the read carries, the
  // round the ledger filed it under, and whether a death registered on it.
  // Sessions from before the review-only build still carry the tip they showed,
  // and it is kept visible, labelled as such, so an old log still reads.
  const st0 = r.state || {};
  const bits = [];
  if (typeof r.round === 'number') bits.push(`Round ${r.round}`);
  if (r.died) bits.push('death registered here');
  const seen = st0.playerNote || null;
  const shownEl = $('shown');
  shownEl.replaceChildren();
  if (bits.length) shownEl.appendChild(el('span', 'death-tag', bits.join(', ')));
  shownEl.appendChild(document.createTextNode(seen || (bits.length ? '' : 'Nothing noted this frame. The fields below are what was read.')));
  shownEl.classList.toggle('none', !seen);
  const old = (r.shown && r.shown.text) || '';
  $('raw-block').hidden = !old;
  if (old) {
    $('raw').textContent = old;
    $('raw-why').hidden = true;
  }

  // STATE table.
  const box = $('state');
  box.textContent = '';
  const st = r.state || {};
  let any = false;
  for (const [key, label, flag] of FIELDS) {
    let v = st[key];
    if (v == null || v === '') continue;
    any = true;
    if (key === 'playerAlive') v = v ? 'yes' : 'DEAD / spectating';
    const row = el('div', 'srow' + (flag === 'key' ? ' key' : '') + (key === 'playerAlive' && st[key] === false ? ' dead' : ''));
    row.appendChild(el('span', 'k', label));
    row.appendChild(el('span', 'v', v));
    // These notes are the model's raw reads, so this row can disagree with the
    // confirmed map above. Saying so is the point of showing both: a silent
    // disagreement is the reader deciding which one to believe with no help.
    if (key === 'map' && seg && seg.map && v !== seg.map) {
      const bad = el('span', 'misread', `misread, it was ${seg.map}`);
      bad.title = 'This one frame named a different map to the one confirmed for this stretch of the session.';
      row.appendChild(bad);
    }
    box.appendChild(row);
  }
  if (!any) box.appendChild(el('div', 'srow', 'The AI reported no readable HUD state for this frame.'));

  // The chat follows the frame you are looking at.
  if (typeof paintConversation === 'function') paintConversation();
}

function go(to) { idx = Math.max(0, Math.min(records.length - 1, to)); render(); paintDeathNav(); }

/**
 * Step to the next or previous death.
 *
 * Deaths carry a FRAME INDEX, so this is navigation over a much shorter list
 * than the scrubber's. It also re-syncs `deathAt` from the current frame, so
 * scrubbing by hand and then pressing next does the obvious thing rather than
 * jumping back to wherever the stepper last was.
 */
function stepDeath(dir) {
  if (!deaths.length) return;
  let i = deaths.findIndex((d) => d.at === idx);
  if (i === -1) {
    // Not sitting exactly on a death: find the nearest one in the direction asked.
    i = dir > 0
      ? deaths.findIndex((d) => d.at > idx)
      : (() => { for (let k = deaths.length - 1; k >= 0; k--) if (deaths[k].at < idx) return k; return -1; })();
    if (i === -1) i = dir > 0 ? deaths.length - 1 : 0;
  } else {
    i = Math.max(0, Math.min(deaths.length - 1, i + dir));
  }
  deathAt = i;
  go(deaths[i].at);
}

/**
 * The frames either side of a death, and the honest size of the gap.
 *
 * The renderer already holds frameData for every record, so this costs no IPC
 * and no extra capture. The point is what it refuses to claim: none of these
 * frames IS the death, because the death happened between two of them.
 */
function paintDeathStrip(d) {
  const wrap = document.getElementById('deathstrip');
  const host = document.getElementById('strip-frames');
  if (!wrap || !host) return;
  if (!d || !Array.isArray(d.runUp) || d.runUp.length < 2) { wrap.hidden = true; return; }
  wrap.hidden = false;
  host.replaceChildren();

  const t0 = (records[d.at] || {}).at;
  for (const i of d.runUp) {
    const r = records[i];
    if (!r) continue;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'strip-shot' + (i === d.at ? ' is-dead' : '');
    b.setAttribute('aria-selected', i === idx ? 'true' : 'false');

    const img = document.createElement('img');
    img.src = r.frameData || '';
    img.alt = '';
    img.loading = 'lazy';
    b.appendChild(img);

    // Offsets are measured from the first DEAD frame, so a reader can see how
    // long before it each shot was taken.
    const cap = document.createElement('span');
    cap.className = 'strip-cap';
    const dt = (typeof r.at === 'number' && typeof t0 === 'number') ? (r.at - t0) / 1000 : null;
    const off = dt === null ? '' : (dt > 0 ? '+' : '') + dt.toFixed(0) + 's ';
    cap.textContent = off + (i === d.at ? 'first dead' : (i > d.at ? 'after' : 'alive'));
    b.appendChild(cap);

    b.addEventListener('click', () => go(i));
    host.appendChild(b);
  }

  const note = document.getElementById('strip-note');
  note.textContent = d.gapMs
    ? `The kill happened in the ${(d.gapMs / 1000).toFixed(1)} seconds between the last two of these. `
      + 'No frame of it was captured, so nothing here is the death itself.'
    : 'This session opened partway through a death, so there is no run up to show.';
}

/** The death stepper, shown only when this session actually has deaths. */
function paintDeathNav() {
  const nav = document.getElementById('deathnav');
  if (!nav) return;
  if (!deaths.length) { nav.hidden = true; return; }
  nav.hidden = false;

  const here = deaths.findIndex((d) => d.at === idx);
  if (here !== -1) deathAt = here;
  const n = deathAt >= 0 ? deathAt + 1 : 0;
  // "1 deaths" was what a match with one death read on any frame but its
  // death, which is where the eye on a death a review looked at opens it.
  document.getElementById('death-pos').textContent =
    here === -1 ? `${deaths.length} death${deaths.length === 1 ? '' : 's'}` : `Death ${n} of ${deaths.length}`;

  // The round and the killer of THIS death, and, in a log from the tip era,
  // whether the coach said anything about it, which was the reason to look at
  // it then. Since 8.0 the coach says nothing during a match by design, so a
  // death is described as what it was and never as a miss (see tipEra).
  // The STRIP follows the death being stepped through, so it stays up while you
  // click along the run up. The WHY line only speaks when the viewer is actually
  // sitting on the death frame, because otherwise it would describe one frame
  // while the reader is looking at another.
  paintDeathStrip(deaths[deathAt] || null);

  const d = here !== -1 ? deaths[here] : null;
  const why = document.getElementById('death-why');
  if (!d) { why.textContent = ''; why.className = 'deathnav-why'; return; }
  const bits = [];
  if (d.round) bits.push(`round ${d.round}`);
  if (d.killedBy) bits.push(`killed by ${d.killedBy}`);
  if (!tipEra) {
    why.textContent = bits.join(', ');
    why.className = 'deathnav-why';
    return;
  }
  why.textContent = d.reviewed
    ? (bits.length ? bits.join(', ') : 'reviewed')
    : `${bits.length ? bits.join(', ') + ', ' : ''}the coach said nothing about this one`;
  why.className = 'deathnav-why' + (d.reviewed ? '' : ' unreviewed');
}

/**
 * Pin a skull on the scrubber for every death in the session, so the deaths
 * are findable at a glance instead of by scrubbing.
 *
 * Built once after load, because the set never changes while the log is open.
 * Older logs recorded no `death` flag at all, so they simply get no marks
 * rather than wrong ones.
 */
function buildMarks() {
  const box = $('marks');
  box.replaceChildren();
  if (records.length < 2) return;

  // Map changes first, so a death marker on the same frame draws on top of it.
  // Only CONFIRMED changes are pinned: the AI's map read flickers to a wrong map
  // for a frame or two several times a session, and a marker for each would
  // claim the player changed map nine times in one game.
  segments.slice(1).forEach((s) => {
    const b = el('button', 'mark-map', s.map || '?');
    b.type = 'button';
    b.style.left = `${(s.from / (records.length - 1)) * 100}%`;
    b.title = `Map changed to ${s.map || 'an unidentified map'} at frame ${s.from + 1}`;
    b.addEventListener('click', () => go(s.from));
    box.appendChild(b);
  });

  // EVERY death, not only the ones the coach reviewed. Marking review tips meant
  // the timeline stopped wherever the coaching stopped: the engine sent at most
  // two reviews per death and then stayed quiet until the next buy phase, so on
  // a real session it pinned 5 marks for 8 deaths and the other three could not
  // be found by scrubbing at all. Only a tip era log greys the ones the coach
  // never spoke about; since 8.0 it speaks about none of them during a match.
  deaths.forEach((d) => {
    const unreviewed = tipEra && !d.reviewed;
    const b = el('button', 'mark-death' + (unreviewed ? ' unreviewed' : ''), '\u{1F480}');
    b.type = 'button';
    b.style.left = `${(d.at / (records.length - 1)) * 100}%`;
    const who = d.killedBy ? ` to ${d.killedBy}` : '';
    const where = d.round ? ` in round ${d.round}` : '';
    b.title = !tipEra ? `Death${where}${who}. Frame ${d.at + 1}.`
      : d.reviewed
        ? `Death${where}${who}, reviewed by the coach. Frame ${d.at + 1}.`
        : `Death${where}${who}, no review was shown. Frame ${d.at + 1}.`;
    b.addEventListener('click', () => go(d.at));
    box.appendChild(b);
  });
}

// ── Ask the coach about the frame you are looking at ────────────────────────
// The conversation is per frame: stepping to a different moment starts a fresh
// one, because a follow-up about another frame would otherwise be answered with
// the previous frame's context.
const askLog = $('ask-log');
const askInput = $('ask-input');
const askSend = $('ask-send');
// Keyed by session AND frame, not frame alone. Frame numbers restart in every
// session, so an index-only key would show Tuesday's answer under tonight's
// twelfth frame, which reads as the coach contradicting itself. And by the
// frame's file rather than its place on the scrubber, which is not the same in
// one match as in its whole session (8.2).
let conversations = {};          // "session:frame" -> [{ role, content }]
const convKey = (i) => `${sessionId}:${(records[i] && records[i].frame) || i}`;

function paintConversation() {
  askLog.textContent = '';
  for (const m of conversations[convKey(idx)] || []) {
    askLog.appendChild(el('div', 'ask-msg ' + (m.role === 'assistant' ? 'coach' : m.role === 'error' ? 'err' : 'you'), m.content));
  }
  askLog.scrollTop = askLog.scrollHeight;
}

async function ask(question) {
  const q = String(question || '').trim();
  if (!q || askSend.disabled) return;
  const at = idx;                                   // the frame this is about
  const key = convKey(at);
  const from = sessionId;                           // and the session it belongs to
  const within = scope;                             // and the one match on screen, if that is all
  conversations[key] = conversations[key] || [];
  conversations[key].push({ role: 'user', content: q });
  askInput.value = '';
  askSend.disabled = true;
  paintConversation();
  const waiting = el('div', 'ask-msg wait', 'Looking at the frame...');
  askLog.appendChild(waiting);
  askLog.scrollTop = askLog.scrollHeight;

  try {
    const res = await window.occlara.ask({
      session: from,        // or main would answer from the newest session's frames
      // The index counts this match's frames when only they are on screen,
      // so main reads the same ones, or it would answer about another frame.
      scope: within && !within.gone ? within : null,
      index: at,
      question: q,
      // Only this frame's history, so the coach is never answering about a
      // moment the player has already scrolled away from.
      history: conversations[key].slice(0, -1),
    });
    const reply = res && res.reply;
    conversations[key].push(reply
      ? { role: 'assistant', content: reply }
      : { role: 'error', content: (res && res.error) || 'No answer came back.' });
  } catch (e) {
    conversations[key].push({ role: 'error', content: 'Could not reach the coach.' });
  } finally {
    askSend.disabled = false;
    if (key === convKey(idx)) paintConversation();
  }
}

$('ask-form').addEventListener('submit', (e) => { e.preventDefault(); ask(askInput.value); });
for (const b of document.querySelectorAll('.hint')) {
  b.addEventListener('click', () => ask(b.dataset.q));
}

$('close').addEventListener('click', () => window.occlara.close());
$('prev').addEventListener('click', () => go(idx - 1));
$('next').addEventListener('click', () => go(idx + 1));
$('slider').addEventListener('input', (e) => go(Number(e.target.value)));
document.addEventListener('keydown', (e) => {
  // Typing a question to the coach must not scrub the session underneath it.
  const t = e.target;
  const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
  if (typing && e.key !== 'Escape') return;

  if (e.key === 'Escape') { window.occlara.close(); return; }
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
  const dir = e.key === 'ArrowRight' ? 1 : -1;
  // SHIFT JUMPS DEATH TO DEATH. Plain arrows still step one frame, which is
  // what they have always done, so the modifier carries the bigger move rather
  // than the existing binding changing meaning under anyone who already uses it.
  // A session runs to 240 frames and about six deaths, so without this the only
  // way to reach the next death from the keyboard was forty presses.
  if (e.shiftKey) stepDeath(dir);
  else go(idx + dir);
  e.preventDefault();
});

/* ── The keyboard hint ──────────────────────────────────────────────────────
   Shown for the first three opens and then never again. Both of these bindings
   are useless if nobody knows they exist, and this window has no menu bar to
   put them in. The counter goes through config like every other preference, so
   dismissing it sticks across launches. If config is unreachable for any reason
   the hint simply does not appear: a teaching aid is never worth an error. */
const HINT_OPENS = 3;
(async () => {
  const hint = $('keyhint');
  if (!hint || !window.occlara.getConfig) return;
  let seen = 0;
  try {
    const cfg = await window.occlara.getConfig();
    seen = Number(cfg && cfg.ailogHintSeen) || 0;
  } catch { return; }
  if (seen >= HINT_OPENS) return;

  hint.hidden = false;
  const done = (n) => { try { window.occlara.setConfig({ ailogHintSeen: n }); } catch {} };
  done(seen + 1);
  $('keyhint-x').addEventListener('click', () => {
    hint.hidden = true;
    done(HINT_OPENS);          // dismissed once means dismissed for good
  });
})();

// ── Sessions ────────────────────────────────────────────────────────────────
const picker = $('session');

/** "Today 21:35" / "Tue 21:35", since a bare timestamp is hard to place. */
function sessionWhen(at) {
  if (!at) return 'unknown time';
  const d = new Date(at);
  const clock = d.toTimeString().slice(0, 5);
  const days = Math.floor((new Date().setHours(0, 0, 0, 0) - new Date(at).setHours(0, 0, 0, 0)) / 86400000);
  if (days === 0) return `Today ${clock}`;
  if (days === 1) return `Yesterday ${clock}`;
  if (days < 7) return `${d.toLocaleDateString(undefined, { weekday: 'short' })} ${clock}`;
  return `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${clock}`;
}

/** A session covers however long you coached for, which can be several matches,
 *  so the label names the maps rather than pretending it is one game. */
function sessionLabel(s) {
  const bits = [s.live ? `Current · ${sessionWhen(s.at)}` : sessionWhen(s.at)];
  if (s.maps && s.maps.length) bits.push(s.maps.length > 2 ? `${s.maps[0]} +${s.maps.length - 1}` : s.maps.join(', '));
  bits.push(`${s.frames} frames`);
  if (s.deaths) bits.push(`${s.deaths} death${s.deaths === 1 ? '' : 's'}`);
  return bits.join(' · ');
}

function paintPicker(sessions) {
  picker.replaceChildren();
  for (const s of sessions) {
    const o = el('option', null, sessionLabel(s));
    o.value = s.id;
    picker.appendChild(o);
  }
  picker.value = sessionId || (sessions[0] && sessions[0].id) || '';
  // With one session there is nothing to switch between, so the control would
  // only be clutter on the surface it is least wanted on.
  picker.hidden = sessions.length < 2;
}

let loads = 0;   // the latest load, so an earlier one landing late paints nothing

// Said in place of a session being recorded while a match is played.
const SEALED_TEXT = "A match is being played, so this session's AI log stays closed until it ends.";

/**
 * Paint what one read brought back: a whole session, or one match of one. They
 * differ in three places. One match hides the picker, since there is nothing to
 * pick, and offers "Whole session" in its place; it opens on its own first
 * death, or its first frame when nobody died; and when its frames are gone, or
 * its session is still being recorded mid match, it says so and shows nothing.
 *
 * @param opts.only   the one session this read may paint ("Whole session"). Any
 *                    other reply says why instead: main serves the newest
 *                    finished session, marked sealed, in place of one being
 *                    recorded while a match is played, and nothing for one the
 *                    log no longer keeps (8.2)
 * @param opts.frame  open on the frame with this file name, only when the
 *                    session served is opts.only: frame names are a counter of
 *                    each session's own, so the same name in another session
 *                    is another moment
 * @param opts.at     or on the frame captured nearest this time: the moment a
 *                    review's look at one death was taken from (8.2)
 */
function load(fetchLog, opts) {
  const o = opts || {};
  const only = typeof o.only === 'string' ? o.only : null;
  const mine = ++loads;
  picker.disabled = true;
  $('subtitle').textContent = 'Loading frames...';
  return Promise.resolve().then(fetchLog).then((log) => {
    if (mine !== loads) return;
    picker.disabled = false;
    if (scope && (!log || log.gone)) { paintClosed(goneText(log)); return; }
    if (scope && log.sealed) { paintClosed(SEALED_TEXT); return; }
    // WHOLE SESSION IS STRICT (8.2), as one match is: the session this match
    // was in, never another's frames under its name. Pressed mid match on the
    // session being recorded, main answers with the newest finished one,
    // sealed; on one pruned since the window opened, with nothing.
    if (only !== null && (!log || log.sealed || log.session !== only)) {
      paintClosed(log && log.sealed ? SEALED_TEXT : goneText(log));
      return;
    }
    // A session picked that the log no longer keeps, pruned at a Start since
    // the picker was painted: said so, with the picker to choose another, and
    // never another session in its place (8.2).
    if (log && log.gone) { paintGone(log); return; }
    records = (log && Array.isArray(log.records)) ? log.records : [];
    segments = (log && Array.isArray(log.segments)) ? log.segments : [];
    deaths = (log && Array.isArray(log.deaths)) ? log.deaths : [];
    sessionId = (log && log.session) || null;
    tipEra = recordedTips(records);
    paintPicker(scope ? [] : (log && log.sessions) || []);
    $('whole').hidden = !scope;

    if (!records.length) {
      $('main').hidden = true;
      $('empty').hidden = false;
      $('empty').textContent = 'No AI log yet. Start a coaching session (with the AI log enabled in Settings) and the frames the coach reads will show up here to review.';
      $('subtitle').textContent = 'what the coach saw and said';
      return;
    }
    $('empty').hidden = true;
    $('main').hidden = false;
    $('slider').max = String(records.length - 1);
    const which = (log.sessions || []).find((s) => s.id === sessionId);
    const when = scope ? sessionWhen(records[0].at).toLowerCase()
      : which ? sessionWhen(which.at).toLowerCase() : 'your latest session';
    // In a tip era log, deaths and reviews are counted separately, because the
    // gap between them said how many times you died without the coach telling
    // you anything. Since 8.0 that gap is every death by design, so a session
    // recorded then counts its deaths and nothing else.
    const seen = deaths.filter((d) => d.reviewed).length;
    const died = `${deaths.length} death${deaths.length === 1 ? '' : 's'}`;
    $('subtitle').textContent = scope ? `${records.length} frames of this match, ${when}${deaths.length ? `, ${died}` : ''}`
      : !deaths.length ? `${records.length} frames from ${when}`
        : tipEra ? `${records.length} frames from ${when}, ${died}, ${seen} reviewed`
          : `${records.length} frames from ${when}, ${died}`;
    buildMarks();
    paintDeathNav();
    const back = o.frame && only !== null && sessionId === only ? records.findIndex((r) => r.frame === o.frame) : -1;
    const near = back === -1 ? nearest(o.at) : -1;
    if (back !== -1) go(back);
    // A moment the review looked at opens on its frame, with the death it led
    // to as the one the stepper and the run up follow.
    else if (near !== -1) { deathAt = deaths.findIndex((d) => d.at >= near); go(near); }
    // Death review mode opens on the FIRST death, because a review reads
    // forwards, and one match with no death on its first frame. Otherwise the
    // newest frame, which is usually what you want.
    else if (deathMode && deaths.length) { deathAt = 0; go(deaths[0].at); }
    else go(scope ? 0 : records.length - 1);
    confirmDeaths(sessionId, scope);
  }).catch((err) => {
    if (mine !== loads) return;
    picker.disabled = false;
    $('main').hidden = true;
    $('empty').hidden = false;
    $('empty').textContent = 'Could not load the AI log.';
    console.error('[ailog] load failed', err);
  });
}

/** A whole session, by its folder name, or the newest. */
function loadSession(id, opts) {
  scope = null;
  return load(() => window.occlara.getLog(id), opts);
}

/**
 * THE REST OF THE SESSION one match was in, and that session alone (8.2): what
 * "Whole session" opens, around the frame that was on screen. It used to be an
 * ordinary read, which painted whatever came back, so mid match it showed the
 * newest finished session as this one, on that session's frame of the same
 * file name, and on a session pruned since it opened, the match being played.
 */
function loadWhole(id, frame) {
  scope = null;
  return load(() => window.occlara.getLog(id), { only: String(id || ''), frame });
}

/**
 * One match of one session, as a review's eye names it, in death review mode.
 * Main reads it strictly, so a scope it could not find comes back gone. `at`
 * is the moment the eye on one of its deaths named, or null.
 */
function loadMatch(s, at) {
  scope = s || { gone: true };
  deathMode = true;
  return load(() => window.occlara.getLog(scope.session || null, scope), { at });
}

/** The frame captured nearest `t`, or -1 when no time was asked for. */
function nearest(t) {
  if (typeof t !== 'number' || !Number.isFinite(t)) return -1;
  let best = -1;
  records.forEach((r, i) => {
    if (typeof r.at !== 'number') return;
    if (best === -1 || Math.abs(r.at - t) < Math.abs(records[best].at - t)) best = i;
  });
  return best;
}

// Said plainly: a match the log no longer holds is not a fault. The log is
// kept small on purpose, and the review kept the frames that mattered.
function keptText(log) {
  return log && Number(log.keeps) > 0 ? `your last ${log.keeps} recording sessions` : 'only your most recent recording sessions';
}
function goneText(log) {
  return `The AI log no longer has this match. It keeps ${keptText(log)}, and the review keeps the frames the coach looked at.`;
}

/**
 * A session the picker named that the log no longer keeps (8.2): the reason,
 * and the picker with what it does keep, none of them chosen, since none is on
 * screen, so that choosing any one of them is a change.
 */
function paintGone(log) {
  paintClosed(`The AI log no longer has that session. It keeps ${keptText(log)}.`);
  const left = (log && Array.isArray(log.sessions)) ? log.sessions : [];
  paintPicker(left);
  picker.value = '';
  picker.hidden = !left.length;
}

/** Nothing to show, for one match or one session, and the reason in its place. */
function paintClosed(text) {
  records = [];
  segments = [];
  deaths = [];
  idx = 0;
  deathAt = -1;
  sessionId = null;
  picker.hidden = true;
  $('whole').hidden = true;
  $('main').hidden = true;
  $('empty').hidden = false;
  $('empty').textContent = text;
  $('subtitle').textContent = 'what the coach saw and said';
}

picker.addEventListener('change', () => loadSession(picker.value));

// THE REST OF THE SESSION this match was in, around the frame on screen rather
// than at the session's newest one, and that session alone (loadWhole).
$('whole').addEventListener('click', () => {
  const here = records[idx];
  loadWhole(sessionId, here && here.frame);
});

/**
 * Ask Riot whether the deaths on this timeline are the real ones.
 *
 * Fired AFTER the session is drawn, never before, so the log opens instantly and
 * still works with no network and no Riot ID. A session that cannot be checked
 * simply shows nothing extra, because the screen-read deaths are still the best
 * answer available and an error banner would suggest otherwise.
 *
 * One match is checked on its own frames (forScope), whose deaths are the ones
 * on screen: paired against the whole session's, they would be numbered wrong.
 */
function confirmDeaths(forSession, forScope) {
  const box = $('confirm');
  box.hidden = true;
  if (!window.occlara.confirm) return;
  window.occlara.confirm(forSession, forScope).then((rec) => {
    if (!rec || forSession !== sessionId || forScope !== scope) return;   // switched away meanwhile
    if (rec.status === 'unavailable' || !rec.summary) return;
    box.hidden = false;
    box.className = 'confirm ' + rec.status;
    box.replaceChildren();
    box.appendChild(el('span', 'dot'));
    box.appendChild(el('span', null, rec.summary));

    // When the counts agree the pairing is trustworthy, so each mark can carry
    // the real round, killer and weapon instead of the model's reading of them.
    if (rec.pairs && rec.pairs.length) {
      const marks = [...document.querySelectorAll('#marks .mark-death')];
      rec.pairs.forEach((p, i) => {
        const d = deaths[i];
        if (!d || !marks[i]) return;
        d.round = p.round; d.killedBy = p.killer; d.weapon = p.weapon; d.confirmed = true;
        const said = !tipEra ? '' : d.reviewed ? ', reviewed by the coach' : ', no review was shown';
        marks[i].title = `Round ${p.round}: killed by ${p.killer}${withWeapon(p.weapon)}${said}. Confirmed by Riot.`;
      });
    }
  }).catch(() => { /* a confirmation that does not arrive changes nothing */ });
}

/*
 * Opened at a session somebody asked for, when they did.
 *
 * Tip History links straight to the frames behind the tips it is showing, and
 * hands the log session id over in the URL hash. The hash is there before the
 * first line of this file runs, which is why it is used rather than a message:
 * a message sent while the window is still loading is simply lost.
 *
 * An id the log no longer keeps, pruned between the click and the open, opens
 * on a line that says so, with the picker to choose another (paintGone), and
 * never on another session in its place: the newest folder is the session
 * being recorded (8.2).
 */
/**
 * Death review mode, asked for by the match review card's eye button.
 *
 * Carried in the same hash as a session id and told apart by not being one. The
 * session allowlist below rejects it, which is correct: it is a mode, not a
 * folder, and it means "newest session, opened on the deaths".
 */
function requestedMode() {
  try {
    const raw = decodeURIComponent(String(location.hash || '').replace(/^#/, '')).trim();
    return raw === 'deaths' ? 'deaths' : '';
  } catch { return ''; }
}

// Only ever a session folder name, never a path. Anything else is ignored
// rather than joined onto one.
const SESSION_RE = /^session-[\w.-]+$/;

function requestedSession() {
  try {
    const raw = decodeURIComponent(String(location.hash || '').replace(/^#/, '')).trim();
    return SESSION_RE.test(raw) ? raw : undefined;
  } catch { return undefined; }
}

/**
 * One match of one session, from a review's eye (8.2): the scope main found,
 * { session, match, from, to }, or { gone: true } when no kept session holds
 * it. Checked here the way a session id is, a folder name and three numbers,
 * and anything else is a match that cannot be shown.
 */
function scopeOf(s) {
  if (!s || typeof s !== 'object') return null;
  if (s.gone) return { gone: true };
  const n = (v) => typeof v === 'number' && Number.isFinite(v);
  return SESSION_RE.test(String(s.session || '')) && n(s.match) && n(s.from) && n(s.to)
    ? { session: s.session, match: s.match, from: s.from, to: s.to } : null;
}

/** When the frame a moment's eye named was captured, or null: a number and nothing else. */
function atOf(v) { return typeof v === 'number' && Number.isFinite(v) ? v : null; }

/**
 * The match a review's eye opened this window on: JSON in the same hash, told
 * apart by its brace, as { scope, at }. One that cannot be read is a match
 * that cannot be shown, never the newest session in its place.
 */
function requestedMatch() {
  let raw = '';
  try { raw = decodeURIComponent(String(location.hash || '').replace(/^#/, '')).trim(); } catch { return null; }
  if (raw.charAt(0) !== '{') return null;
  try {
    const t = JSON.parse(raw) || {};
    return { scope: scopeOf(t.scope) || { gone: true }, at: atOf(t.at) };
  } catch { return { scope: { gone: true }, at: null }; }
}

const opened = requestedMatch();
deathMode = requestedMode() === 'deaths';
if (opened) loadMatch(opened.scope, opened.at);
else loadSession(requestedSession());

document.getElementById('death-prev').addEventListener('click', () => stepDeath(-1));
document.getElementById('death-next').addEventListener('click', () => stepDeath(1));

// An already open window is told to move, since the hash was read once above:
// to a session, or to one match of one when a review's eye is pressed, at
// the moment of one of its deaths when that eye was a death's.
if (window.occlara.onShow) {
  window.occlara.onShow((target) => {
    if (target && typeof target === 'object') loadMatch(scopeOf(target.scope), atOf(target.at));
    else loadSession(target);
  });
}

console.log('[ailog] ready');

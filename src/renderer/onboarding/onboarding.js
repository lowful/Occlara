'use strict';

/**
 * Welcome tour. Five short pages instead of one long list, because the old
 * single card asked the player to read five numbered steps and a settings
 * question before they could get to a match.
 *
 * Every choice saves the moment it is made, so closing the tour at any point
 * (button, ✕, Esc) keeps whatever was picked.
 */

const pages   = [...document.querySelectorAll('.page')];
const dotsEl  = document.getElementById('dots');
const backBtn = document.getElementById('back');
const nextBtn = document.getElementById('next');
let index = 0;
// THE RIOT ID PAGE IS ABOUT ONE RIOT ID: the one in the field. Connect
// connects one (connectedId, '' until it does), the line under the field is
// about one (statusAbout), and the run main pushes is for one (its account).
// Each shows only while the field holds its ID, compared without case as
// Riot compares them: Let's go, a line or rows about an ID the player has
// since edited away are about nothing they are looking at.
let connectedId = '';
let statusAbout = '';
let checking = false;
let lastBf = null;
// Whether the account that connected is known to exist: a profile came back,
// or Riot said it has no ranked one. A profile that could not be loaded
// connects without knowing.
let confirmed = false;
const sameId = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();

// Progress dots, clickable so the tour can be skimmed in either direction.
const dots = pages.map((_, i) => {
  const d = document.createElement('button');
  d.className = 'dot-nav';
  d.type = 'button';
  d.title = `Step ${i + 1}`;
  d.addEventListener('click', () => go(i));
  dotsEl.append(d);
  return d;
});

function go(next) {
  index = Math.max(0, Math.min(pages.length - 1, next));
  pages.forEach((p, i) => { p.hidden = i !== index; });
  dots.forEach((d, i) => {
    d.classList.toggle('active', i === index);
    d.classList.toggle('done', i < index);
  });
  backBtn.style.visibility = index === 0 ? 'hidden' : 'visible';
  // The last page finishes the tour. Until a Riot ID connects it says so
  // plainly: skipping is fine, and Settings connects one later.
  const last = index === pages.length - 1;
  const connected = isConnected();
  nextBtn.textContent = last ? (connected ? "Let's go" : 'Skip for now') : 'Next';
  // ONE RED BUTTON A PAGE. On the Riot ID page Connect is the action until a
  // Riot ID connects, so until then the footer is the quiet way out rather
  // than a second red button recommending the skip; after it, Let's go is.
  nextBtn.classList.toggle('btn-primary', !last || connected);
  connectBtn.classList.toggle('btn-primary', !connected);
  // The PC check runs as its page opens, once (checkPc).
  if (pages[index] && pages[index].id === 'ob-watch') checkPc();
}

backBtn.addEventListener('click', () => go(index - 1));
nextBtn.addEventListener('click', () => {
  if (index === pages.length - 1) window.occlara.done();
  else go(index + 1);
});

document.getElementById('close').addEventListener('click', () => window.occlara.done());
window.addEventListener('keydown', (e) => {
  // A key a control took for itself is its own: the language list's arrows,
  // Enter and Escape, and the choices' arrows (radioKey, below).
  if (e.defaultPrevented) return;
  if (e.key === 'Escape') window.occlara.done();
  else if (e.key === 'Enter') enterKey(e);
  else if (e.key === 'ArrowRight') nextBtn.click();
  else if (e.key === 'ArrowLeft') backBtn.click();
});

/**
 * ENTER ON A BUTTON IS THAT BUTTON, and the next page as well only from the
 * last control of its page. Enter was Next from anywhere: on a choice it
 * turned the page and the browser's own click picked after it, on Next it
 * pressed Next twice, and on Back it went forward and back again. So a button
 * takes its click here and the browser's is kept from following it; the
 * page's last control (Frames only on How Occlara watches, On, advanced after
 * every match) picks and goes on, as Enter in a form's last field sends it.
 * Enter anywhere else is Next, as it was. The Riot ID field and Connect take
 * their Enter for themselves (below).
 */
function enterKey(e) {
  const btn = e.target && typeof e.target.closest === 'function' ? e.target.closest('button') : null;
  if (!btn) { nextBtn.click(); return; }
  e.preventDefault();
  if (btn.disabled) return;
  btn.click();
  if (btn !== nextBtn && lastControl(btn)) nextBtn.click();
}

/** Whether `el` is the last control of its page that can be used, in the page's own order. */
function lastControl(el) {
  const page = el.closest('.page');
  if (!page) return false;
  const usable = [...page.querySelectorAll('button, input, select, textarea')]
    .filter((c) => !c.disabled && !c.closest('[hidden]'));
  return usable[usable.length - 1] === el;
}

/*
 * THE CHOICES ARE RADIOS (role radio in a radiogroup): Record gameplay and
 * Frames only, and Record's size. The arrow keys move between the choices of
 * one group and pick the one they land on, as radios do, passing over one
 * that cannot be made, and turn no page; Tab comes into a group on its picked
 * choice alone (paintWatch). They turned the page, which a player moving
 * between two cards marked as radios did not ask for.
 */
const RADIO_STEP = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 };
function radioKey(e) {
  const step = RADIO_STEP[e.key];
  const group = e.currentTarget;
  const radio = step && e.target && typeof e.target.closest === 'function' ? e.target.closest('[role="radio"]') : null;
  if (!radio || radio.closest('[role="radiogroup"]') !== group) return;
  e.preventDefault();
  const radios = [...group.querySelectorAll('[role="radio"]')]
    .filter((r) => r.closest('[role="radiogroup"]') === group && !r.disabled);
  const at = radios.indexOf(radio);
  if (at < 0 || radios.length < 2) return;
  const to = radios[(at + step + radios.length) % radios.length];
  to.focus();
  to.click();
}
for (const g of document.querySelectorAll('[role="radiogroup"]')) g.addEventListener('keydown', radioKey);

// ── Choices (each saves immediately) ────────────────────────────────────────

function wireSeg(seg, onPick) {
  seg.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    for (const b of seg.querySelectorAll('button')) b.classList.toggle('active', b === btn);
    onPick(btn.dataset.val);
  });
}

wireSeg(document.getElementById('advanced'), (v) => {
  window.occlara.setConfig({ advancedTips: v === 'on' }).catch(() => {});
});

// ── How Occlara watches: Record gameplay or Frames only (8.3.1) ────────────
// The recorder's On and Off (recordingMode 'auto' and 'off', Settings' Record
// match video) and its size (recordingRes), chosen here with a check of this
// PC behind the choice. The check runs as its page opens: main says what Node
// can tell (pc-check.js), this page asks the GPU's encoder itself exactly as
// the recorder's gate asks it (src/renderer/recorder), and pc-rules.js
// recommends.
//
// THE RECOMMENDATION IS SAVED ONLY OVER THE DEFAULTS. On a first run the
// store holds Record at 720p because nobody chose anything, so the
// recommendation is pre selected and saved in its place. A player shown the
// tour again after a logout keeps the Off or the 1080p they chose in
// Settings, with the recommendation marked beside it: a tour run again never
// silently resets a choice. Where the PC cannot record at all (no hardware
// encoder, under 8 GB free) Record cannot be chosen, and Frames only is saved
// whatever was; a saved size the encoder refuses gives way to the
// recommended one, and the line says why (checkPc).
//
// Declared before the first call this page makes to main at load, so the
// page can be drawn with no bridge at all (scripts/shot-surface.js), where
// the check reads as one that could not finish.
const watchRec = document.getElementById('ob-rec');
const watchFrames = document.getElementById('ob-frames');
const watchRes = document.getElementById('ob-res');
const recTag = document.getElementById('ob-rec-tag');
const framesTag = document.getElementById('ob-frames-tag');
const pcLine = document.getElementById('ob-pc-line');
const pcFacts = document.getElementById('ob-pc-facts');
// An ask that never answers is not a no: past this it counts as unknown, and
// the page goes on. The first ask took 291 ms on the PC 8.3 was built on, the
// GPU's encoder factories starting, and every ask after it under a
// millisecond.
const ENCODER_WAIT_MS = 5000;
let watch = { mode: 'auto', res: '720' };   // what is saved: the store's defaults until read
let untouched = false;                       // saved as the defaults, which nobody chose
let pickedHere = false;                      // the player picked on this page
let rec = null;                              // pc-rules.js's recommendation, once the check is in
let pcAsked = false;

/**
 * One of the recorder's asks put to the GPU's encoder, the very question its
 * gate asks before every recording (src/renderer/recorder/recorder.js
 * hardwareGate): true, false (an ask that throws is a no there too), or null
 * when it never answered.
 */
function askEncoder(a) {
  const ask = (async () => {
    try {
      const s = await VideoEncoder.isConfigSupported({
        codec: a.codec, width: a.width, height: a.height, bitrate: a.bitrate, framerate: 30,
        hardwareAcceleration: 'prefer-hardware',
      });
      return !!(s && s.supported);
    } catch { return false; }
  })();
  let timer = null;
  const late = new Promise((resolve) => { timer = setTimeout(() => resolve(null), ENCODER_WAIT_MS); });
  return Promise.race([ask, late]).finally(() => clearTimeout(timer));
}

/**
 * The two choices and the size as saved, the recommendation marked, what this
 * PC cannot do disabled, a size the encoder refused saying why on itself.
 * Each group is one stop for Tab, its picked choice (radioKey).
 */
function paintWatch() {
  const recordable = !rec || rec.recordable;
  const on = watch.mode !== 'off' && recordable;
  watchRec.setAttribute('aria-checked', String(on));
  watchFrames.setAttribute('aria-checked', String(!on));
  watchRec.tabIndex = on ? 0 : -1;
  watchFrames.tabIndex = on ? -1 : 0;
  watchRec.disabled = !recordable;
  for (const b of watchRes.querySelectorAll('button')) {
    const refused = !!(rec && rec.sizes[b.dataset.res] === false);
    const picked = b.dataset.res === watch.res;
    b.disabled = !recordable || refused;
    b.title = recordable && refused ? rec.refused[b.dataset.res] || '' : '';
    b.classList.toggle('active', picked);
    b.setAttribute('aria-checked', String(picked));
    b.tabIndex = picked ? 0 : -1;
  }
  // The size is Record's: quiet while Frames only is chosen.
  watchRes.classList.toggle('quiet', !on);
  recTag.hidden = !(rec && rec.recordable && rec.mode === 'auto');
  framesTag.hidden = !(rec && rec.recordable && rec.mode === 'off');
}

/** Save a choice the moment it is made, as every choice in the tour is. */
function choose(mode, res) {
  const m = mode === 'off' ? 'off' : 'auto';
  let r = res === '1080' ? '1080' : '720';
  // Record at a size the encoder refused would never record: the other one.
  const other = r === '1080' ? '720' : '1080';
  if (m === 'auto' && rec && rec.sizes[r] === false && rec.sizes[other] !== false) r = other;
  const changed = m !== watch.mode || r !== watch.res;
  watch = { mode: m, res: r };
  paintWatch();
  if (changed) window.occlara.setConfig({ recordingMode: watch.mode, recordingRes: watch.res }).catch(() => {});
}

watchRec.addEventListener('click', () => {
  if (watchRec.disabled) return;
  pickedHere = true;
  choose('auto', watch.res);
});
watchFrames.addEventListener('click', () => {
  pickedHere = true;
  choose('off', watch.res);
});
// A size is a Record choice: picking one picks Record.
watchRes.addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b || b.disabled) return;
  pickedHere = true;
  choose('auto', b.dataset.res);
});

/** The check's line, and what it found; `refused`, a saved size the encoder refused, said in it. */
function paintPc(facts, refused) {
  const why = refused && rec.refused[refused] && !rec.why.includes(rec.refused[refused])
    ? `${rec.why} ${rec.refused[refused]}` : rec.why;
  pcLine.textContent = why;
  pcLine.className = 'ob-pc-line' + (rec.tone ? ` ${rec.tone}` : '');
  const cells = [];
  for (const r of window.OcclaraPcRules.factRows(facts)) {
    const dt = document.createElement('dt');
    dt.textContent = r.k;
    const dd = document.createElement('dd');
    dd.textContent = r.v;
    if (r.wide) dd.className = 'wide';
    // A value too long for its row is cut with an ellipsis; its title is whole.
    dd.title = r.v;
    cells.push(dt, dd);
  }
  pcFacts.replaceChildren(...cells);
  pcFacts.hidden = false;
}

/**
 * The check, once, as its page opens: what is saved, what main can tell of
 * this PC, the encoder's two answers, then the recommendation, pre selected
 * over the defaults alone (above).
 */
async function checkPc() {
  if (pcAsked) return;
  pcAsked = true;
  let cfg = null;
  try { cfg = await window.occlara.getConfig(); } catch { cfg = null; }
  // A pick made while the config was on its way is newer than its answer.
  if (cfg && typeof cfg === 'object' && !pickedHere) {
    watch = { mode: cfg.recordingMode === 'off' ? 'off' : 'auto', res: String(cfg.recordingRes) === '1080' ? '1080' : '720' };
    untouched = watch.mode === 'auto' && watch.res === '720' && !cfg.recordingAutoOff;
  }
  paintWatch();
  let facts = null;
  try { facts = await window.occlara.checkPc(); } catch { facts = null; }
  const found = facts && typeof facts === 'object' && facts.ok !== false ? facts : {};
  // BOTH ASKS AT ONCE. One after the other, an encoder that never answers
  // held "Checking this PC" up for two waits, ten seconds, not one.
  const asks = (Array.isArray(found.asks) ? found.asks : []).filter((a) => a && (a.res === '720' || a.res === '1080'));
  const answers = await Promise.all(asks.map(askEncoder));
  const encoder = {};
  asks.forEach((a, i) => { encoder[a.res] = answers[i]; });
  if (!window.OcclaraPcRules) return;
  const all = { ...found, encoder };
  rec = window.OcclaraPcRules.recommend(all);
  // A SAVED SIZE THE ENCODER REFUSES never records: the recorder's gate asks
  // the same question before every recording and records nothing on a no.
  // It was kept, shown picked and disabled at once. It is shown unavailable
  // now, the line saying why, and the recommended size is picked and saved
  // in its place, beside the player's own Record or Frames only.
  const refused = rec.recordable && rec.sizes[watch.res] === false ? watch.res : null;
  paintPc(all, refused);
  if (!rec.recordable) {
    if (watch.mode !== 'off') choose('off', watch.res);
    else paintWatch();
  } else if (untouched && !pickedHere) {
    choose(rec.mode, rec.res);
  } else if (refused) {
    choose(watch.mode, rec.res);
  } else {
    paintWatch();
  }
}

// The Riot ID saves as it is typed, like Settings, so leaving the tour at any
// point keeps it.
const riotEl = document.getElementById('ob-riot');
let riotTimer = null;
riotEl.addEventListener('input', () => {
  clearTimeout(riotTimer);
  riotTimer = setTimeout(() => window.occlara.setConfig({ riotId: riotEl.value.trim() }).catch(() => {}), 500);
  // An edited Riot ID is not the one that connected: the page stops saying
  // Connected about it and asks for Connect again, until the field holds the
  // ID that connected again.
  syncRiot();
});

/** Connected, for the Riot ID in the field now. */
function isConnected() {
  return !!connectedId && sameId(connectedId, riotEl.value);
}

// ── Connect, and the grading that follows it ─────────────────────────────
// Connect tests the Riot ID, and main then grades the account's recent matches
// from Riot's record (backfill.js) and pushes every step. The grading carries
// on after the tour closes; Settings and Matches follow the same push.
const connectBtn = document.getElementById('ob-connect');
const statusEl = document.getElementById('ob-riot-status');
const bfBox = document.getElementById('ob-bf');
const bfLine = document.getElementById('ob-bf-line');
const bfList = document.getElementById('ob-bf-list');

// Enter in the field connects, and is never "next page".
riotEl.addEventListener('keydown', (e) => {
  e.stopPropagation();
  if (e.key === 'Enter') connectBtn.click();
});
// NOR IS ENTER ON THE CONNECT BUTTON. A button pressed with Enter clicks
// itself, and the window's Enter handler above would press Next as well,
// which on this page ends the tour: one keystroke would connect and close the
// page that reports on it.
connectBtn.addEventListener('keydown', (e) => { if (e.key === 'Enter') e.stopPropagation(); });

const STALE = 'Your Riot ID changed while it was being checked. Press Connect again.';
const PROFILE_NOT_LOADED = "Your rank could not be loaded right now. Your recent matches are being graded from Riot's record.";
const CONFIRMED_NO_RANK = 'Connected. Your rank could not be loaded right now.';

/**
 * The line under the field: tone true is good news, false a failure, null
 * neither. It is about the ID in the field when it is written, unless told
 * which.
 */
function showStatus(tone, text, about) {
  statusEl.textContent = text || '';
  statusEl.className = 'ob-riot-status' + (tone === true ? ' ok' : tone === false ? ' err' : '');
  statusAbout = about === undefined ? riotEl.value : about;
  syncRiot();
}

/** Show what is about the Riot ID now in the field, and nothing else. */
function syncRiot() {
  // "Checking" stays up through an edit: the answer says the ID changed.
  statusEl.hidden = !statusEl.textContent || !(checking || sameId(statusAbout, riotEl.value));
  bfBox.hidden = !(lastBf && lastBf.state !== 'idle' && sameId(lastBf.account, riotEl.value));
  go(index);
}

/** "Connected, Gold 2.", from the profile Riot answered with. */
function connectedLine(stats) {
  return `Connected${stats && stats.rank ? `, ${stats.rank}` : ''}.`;
}

connectBtn.addEventListener('click', async () => {
  const id = riotEl.value.trim();
  const at = id.indexOf('#');
  if (at < 1 || at === id.length - 1) { showStatus(false, 'Enter your Riot ID as Name#TAG.'); return; }
  clearTimeout(riotTimer);
  connectBtn.disabled = true;
  connectBtn.textContent = 'Connecting';
  checking = true;
  showStatus(null, 'Checking your account.', id);
  let res = null;
  try {
    await window.occlara.setConfig({ riotId: id });
    res = await window.occlara.testTracker();
  } catch {
    res = null;
  }
  checking = false;
  connectBtn.disabled = false;
  connectBtn.textContent = 'Connect';
  connectedId = '';
  if ((res && res.stale) || !sameId(riotEl.value, id)) {
    // THE ANSWER IS ABOUT THE ID THAT WAS CHECKED, and the field saves as it
    // is typed, so it may hold another by now. Main refuses that itself; an
    // edit in the half second before the field saved is caught here.
    showStatus(false, (res && res.stale && res.error) || STALE);
  } else if (res && res.ok) {
    connectedId = id;
    confirmed = !res.profileError;
    // NOT A FAILED CONNECT. The profile could not be loaded right now (a rate
    // limit, the stats service down) and the grading started all the same.
    // The line claims nothing it did not see: no rank, and not "Connected",
    // since nothing has shown the account exists yet.
    if (res.profileError) showStatus(null, PROFILE_NOT_LOADED, id);
    else if (res.unranked) showStatus(true, 'Connected. No ranked profile on this account yet.', id);
    else showStatus(true, connectedLine(res.stats), id);
  } else {
    showStatus(false, (res && res.error) || 'Could not connect. Try again in a minute.', id);
  }
});

// Rows already painted once. Every push repaints the list, and without this
// every row would replay its entrance on every push, twice a match, so the
// list would blink while it worked. Only a row seen for the first time slides
// in.
const bfSeen = new Set();

/**
 * The matches graded so far, newest first, as main pushes them. Shown only
 * for the run of the Riot ID in the field (syncRiot): a run for another ID
 * is not this page's.
 */
function paintBackfill(s) {
  lastBf = s || null;
  // THE RUN SETTLES A CONNECT THAT NEVER SAW THE ACCOUNT. A profile that
  // could not be loaded connected without knowing the account exists. A run
  // that lists its matches proves it does, and the page says Connected. One
  // that ends in any error (no such account, Riot unreachable, the licence)
  // leaves it unproven: the page stops saying it connected, and the run's
  // own red line below says why. Only a not found used to, and a typo the
  // rate limit hid finished the tour looking connected.
  if (s && connectedId && !confirmed && sameId(s.account, connectedId)) {
    if (s.state === 'grading' || s.state === 'done') {
      confirmed = true;
      if (sameId(statusAbout, connectedId)) showStatus(true, CONFIRMED_NO_RANK, connectedId);
    } else if (s.state === 'error') {
      connectedId = '';
      if (sameId(statusAbout, s.account)) statusEl.textContent = '';
    }
  }
  if (!s || s.state === 'idle') { syncRiot(); return; }
  bfLine.textContent = s.message || '';
  bfLine.className = 'ob-bf-line' + (s.state === 'error' ? ' err' : '');
  bfList.replaceChildren();
  const done = (Array.isArray(s.items) ? s.items : [])
    .filter((x) => x.status === 'graded' || x.status === 'upgraded' || x.status === 'failed');
  // No rows yet is no list at all, rather than an empty bordered box.
  bfList.hidden = !done.length;
  for (const x of done.slice(0, 10)) {
    const row = document.createElement('div');
    const key = `${x.matchId}|${x.status}`;
    row.className = 'ob-bf-row' + (x.status === 'failed' ? ' failed' : '') + (bfSeen.has(key) ? ' settled' : '');
    bfSeen.add(key);
    row.setAttribute('role', 'listitem');
    const name = document.createElement('span');
    name.className = 'ob-bf-name';
    name.textContent = [x.map, x.agent].filter(Boolean).join('  ·  ') || 'Match';
    const res = document.createElement('span');
    res.className = 'ob-bf-res' + (/vict/i.test(x.result || '') ? ' win' : /defeat/i.test(x.result || '') ? ' loss' : '');
    res.textContent = x.status === 'failed' ? 'Not fetched' : [x.result, x.score].filter(Boolean).join(' ');
    const grade = document.createElement('span');
    const tone = x.grade && window.GradeView ? window.GradeView.gradeTone(x.grade) : '';
    grade.className = 'ob-bf-grade' + (tone ? ' ' + tone : '');
    grade.textContent = x.grade ? `${x.grade.score} ${x.grade.letter}` : '';
    if (x.grade && x.grade.provisional) grade.title = 'Provisional: some of the record was missing';
    row.append(name, res, grade);
    bfList.append(row);
  }
  syncRiot();
}
window.occlara.onBackfill(paintBackfill);
window.occlara.getBackfill().then(paintBackfill).catch(() => {});

// Reflect whatever is already saved, so re-running the tour never silently
// resets a choice the player made in Settings.
window.occlara.getConfig().then((cfg) => {
  if (!cfg) return;
  if (typeof cfg.riotId === 'string') riotEl.value = cfg.riotId;
  for (const b of document.getElementById('advanced').querySelectorAll('button')) {
    b.classList.toggle('active', (b.dataset.val === 'on') === (cfg.advancedTips === true));
  }
  // SHOWN AGAIN TO A CONNECTED PLAYER (a logout runs the tour again), the
  // Riot ID page is connected from the start, exactly as after a Connect: the
  // Riot ID in config has the profile Riot answered for it. Saying nothing
  // was connected sent a connected player to press Connect again.
  const id = String(cfg.riotId || '').trim();
  const stats = cfg.playerStats;
  if (id.includes('#') && stats && sameId(stats._riotId, id) && !connectedId && !checking) {
    connectedId = id;
    confirmed = true;
    showStatus(true, connectedLine(stats), id);
  } else if (id.includes('#') && sameId(cfg.riotConnected, id) && !connectedId && !checking) {
    // Shown to exist with no profile kept: no ranked one, or a profile that
    // could not be loaded when its matches were graded.
    connectedId = id;
    confirmed = true;
    showStatus(true, 'Connected.', id);
  } else {
    // The field was filled after the run's status may have arrived for it.
    syncRiot();
  }
}).catch(() => {});


// ── Language ────────────────────────────────────────────────────────────────
// Chosen on page one, so the rest of onboarding and every review that follows
// arrive in the player's language rather than being switched later.
const obLang = document.getElementById('ob-language');
const obLangNote = document.getElementById('ob-language-note');

function obShowNote(code) {
  if (!obLangNote || !window.occlara.i18n) return;
  const translated = window.occlara.i18n.hasUi(code);
  obLangNote.hidden = translated;
  if (!translated) {
    obLangNote.textContent =
      'Your reviews will be in this language. The app’s own buttons stay English for now.';
  }
}

if (obLang && window.occlara.i18n && window.Dropdown) {
  // The app's own dropdown, not a native <select>. This is the very first
  // screen a new player sees, and on Windows the native control drew a white
  // box in the middle of the dark card: the most obviously foreign thing in
  // the whole interface, on first run.
  window.occlara.getConfig().then((cfg) => {
    const current = (cfg && cfg.language) || 'en';
    window.Dropdown.create(obLang, {
      label: 'Language',
      value: current,
      options: window.occlara.i18n.languages().map((l) => ({
        value: l.code,
        label: l.name,
        tag: window.occlara.i18n.hasUi(l.code) ? '' : 'reviews only',
      })),
      onChange: async (code) => {
        await window.occlara.setConfig({ language: code });
        obShowNote(code);
        if (window.initI18n) window.initI18n();
      },
    });
    obShowNote(current);
  }).catch(() => {});
}

if (window.initI18n) window.initI18n().catch(() => {});

go(0);
console.log('[onboarding] ready');

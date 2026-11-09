'use strict';

/*
 * ASK COACH (8.5.0): one conversation about one match, named on the chip.
 *
 * The chip is the match this thread is about: the newest of the game when
 * the page is opened from the sidebar, the review "Ask about this match" came
 * from, or whichever the player picks, "No match, general questions"
 * included. Switching starts a new thread under a one line divider, and a
 * question that names another match moves the chip by itself (main decides,
 * services/ask-coach.js). A match a Stop may have left being played is never
 * listed, and asking about it says why. The day's questions used is a line of
 * its own, never a coach bubble, and so is every game used (8.7.3), with a
 * button to the Profile page. A reply keeps its paragraphs (pre-line).
 *
 * Every string is the page's i18n keys (shared/i18n.js chat.*), and every
 * sentence of a reply is set as text, never markup.
 */

const $ = (id) => document.getElementById(id);
const threadEl = $('thread');
const introEl = $('intro');
const startersEl = $('starters');
const composer = $('composer');
const inputEl = $('input');
const sendBtn = $('send');
const pickEl = $('match-pick');

// English until the catalogue answers (initI18n); every key below is in
// shared/i18n.js, so this is only what shows if the bridge never does.
const EN = {
  'chat.noMatch': 'No match, general questions', 'chat.matchLabel': 'The match you are asking about',
  'chat.won': 'won', 'chat.lost': 'lost', 'chat.drew': 'drew', 'chat.to': 'to',
  'chat.win': 'win', 'chat.loss': 'loss', 'chat.draw': 'draw', 'chat.match': 'match',
  'chat.divider': 'Now about your {match}', 'chat.dividerNone': 'Now general questions, about no match',
  'chat.walk': 'Walk me through round {n}', 'chat.change': 'What should I change on {agent}?',
  'chat.losing': 'Where am I losing rounds?', 'chat.kit': "How should I use my agent's kit?",
  'chat.save': 'When should my team save?', 'chat.sheriff': 'How do I win more duels with a Sheriff?',
  'chat.workOn': 'What should I work on first?',
  'chat.openRecorded': 'Go through my {match} match with me. What was my most costly mistake, and what should I work on first?',
  'chat.openRiot': "Go through my {map} match with me. What does Riot's record show, and where would you start?",
  'chat.held': "This match may still be going on. Ask Coach can talk about it once Riot's record has it, or in 90 minutes.",
  'chat.cap': "You've used today's questions. Ask Coach is back at {time}.",
  'chat.capTomorrow': "You've used today's questions. Ask Coach is back tomorrow.",
  'chat.locked': 'You have used all your games. Get more games in your Profile or upgrade your plan to ask me about your matches.',
  'chat.openProfile': 'Open Profile',
  'chat.which': '{count} of your last ten matches are on {map}. Which one do you mean? Pick it from the match list above.',
  'chat.noneOnMap': 'None of your last ten matches is on {map}. Pick a match from the list above, or ask about this one.',
  'chat.failed': 'Could not reach your coach right now. Try again in a moment.',
  'chat.timeout': 'Your coach took too long with that one. Your question is still in the box below.',
  'chat.retry': 'Ask again',
  'chat.writing': 'Your coach is writing',
  'chat.roundShort': 'R{n}',
  'chat.midMatch': 'A match is in progress. Ask Coach is back once it ends.',
  'chat.honest': "I couldn't give you an answer I can stand behind for that one. Ask me about a round, a death or your agent in this match.",
  'chat.clipOpen': 'Watch round {n}',
  'chat.clipLabel': 'Your death in round {n}',
  'chat.clipFailed': 'This clip could not be played.',
};
let tr = (key) => EN[key] || key;
const t = (key) => {
  const v = tr(key);
  return v && v !== key ? v : (EN[key] || key);
};
const say = (key, vars) => t(key).replace(/\{(\w+)\}/g, (all, k) => (vars && vars[k] != null ? String(vars[k]) : ''));

let state = { game: null, list: [], chosen: { id: null, how: null }, current: null, starters: null };
let history = [];   // { role: 'user' | 'assistant', content }, since the last divider
let busy = false;
let picker = null;

// ── Naming a match ─────────────────────────────────────────────────────────

/** "Fracture, Jett, won 5 to 1, 13 Oct", in the player's language. */
function label(row) {
  if (!row) return t('chat.noMatch');
  const res = row.result === 'Victory' ? t('chat.won') : row.result === 'Defeat' ? t('chat.lost') : row.result === 'Draw' ? t('chat.drew') : null;
  const score = row.score ? row.score.replace('-', ` ${t('chat.to')} `) : null;
  return [row.map, row.agent, res && score ? `${res} ${score}` : (res || score), row.day].filter(Boolean).join(', ');
}

/** "Split win, 4 Oct", for the divider. */
function noun(row) {
  const what = row.result === 'Victory' ? t('chat.win') : row.result === 'Defeat' ? t('chat.loss') : row.result === 'Draw' ? t('chat.draw') : t('chat.match');
  return [[row.map || row.agent, what].filter(Boolean).join(' '), row.day].filter(Boolean).join(', ');
}

// ── The thread ─────────────────────────────────────────────────────────────

function scrollDown() { threadEl.scrollTop = threadEl.scrollHeight; }

/** At the end of the thread, or where `before` stands: an answer stays in the thread it was asked in. */
function place(el, before) {
  if (before && before.parentNode === threadEl) threadEl.insertBefore(el, before);
  else threadEl.append(el);
}

function addMsg(role, text, opts = {}) {
  introEl.hidden = true;
  const el = document.createElement('div');
  el.className = role === 'user' ? 'msg user' : 'msg coach t-voice';
  const clips = role === 'user' ? [] : clipsOf(opts.clips);
  // THE ROUNDS IN THE MARGIN (8.8): the rounds an answer talks about, beside
  // it in the margin as a marked up sheet has them. An attribute the sheet
  // draws (chat.css .msg.coach[data-rounds]), so the answer's own text, and
  // a plain reply's one pre-line node, stay exactly the reply.
  const rounds = role === 'user' ? [] : roundsOf(text);
  if (rounds.length) el.dataset.rounds = rounds.map((n) => say('chat.roundShort', { n })).join(String.fromCharCode(10));
  // A reply's paragraphs are kept: the bubble is pre-line (chat.css).
  if (!clips.length) el.textContent = text;
  else paintWithClips(el, text, clips);
  place(el, opts.before);
  scrollDown();
  return el;
}

/*
 * THE PLAYER'S CLIPS IN A REPLY. The coach may attach the clip of a death it
 * talks about (server chat-clips.js, main's ask-coach.js clipsFor): each one
 * is a round of the match on the chip whose clip main found on this PC, and
 * goes under the paragraph that talks about it. Nothing loads and nothing
 * plays until the player clicks: the capsule then becomes the review's own
 * clip player (review/clip-player.js, the Moments page's too), 1x, 0.5x and
 * 0.25x, the death marked. Never autoplay, and nothing of it mid match: the
 * question is refused then, the page is sealed, and a hidden page pauses
 * every clip (clip-player.js).
 */
const CLIP_URL = /^occlara-clip:\/\/review\/[^/\s]+\/[^/\s]+$/;

/** The clips main handed over, three at most, one a round, each a clip URL. */
function clipsOf(list) {
  const seen = new Set();
  return (Array.isArray(list) ? list : []).filter((c) => {
    if (!c || !Number.isInteger(c.round) || !Number.isInteger(c.para) || c.para < 0) return false;
    if (typeof c.url !== 'string' || !CLIP_URL.test(c.url) || seen.has(c.round)) return false;
    seen.add(c.round);
    return true;
  }).slice(0, 3);
}

/*
 * The rounds a reply names, in the order it names them, three at most: "round
 * 5", "rounds 3 and 7", "rounds 4, 9 or 11", in the languages the coach
 * answers in (Runde, ronda, rodada, manche). A number past 30 is no round.
 */
const ROUND_WORDS = /\b(?:rounds?|runden?|rondas?|rodadas?|manches?)\s+(\d{1,2})((?:\s*(?:,|&|and|or|und|oder|y|o|e|ou|et)\s*\d{1,2}\b)*)/gi;
function roundsOf(text) {
  const out = [];
  for (const m of String(text || '').matchAll(ROUND_WORDS)) {
    for (const d of [m[1], ...(m[2].match(/\d{1,2}/g) || [])]) {
      const n = Number(d);
      if (n >= 1 && n <= 30 && !out.includes(n)) out.push(n);
    }
  }
  return out.slice(0, 3);
}

/** A reply's paragraphs, each its own text, with the clips under theirs. */
function paintWithClips(el, text, clips) {
  el.classList.add('with-clips');
  const paras = String(text || '').split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  paras.forEach((para, i) => {
    const p = document.createElement('p');
    p.className = 'msg-para';
    p.textContent = para;
    el.append(p);
    for (const c of clips) if (c.para === i) el.append(clipCard(c));
  });
}

/** A capsule naming the round, the clip's player once it is clicked. */
function clipCard(c) {
  const box = document.createElement('div');
  box.className = 'chat-clip';
  const open = document.createElement('button');
  open.type = 'button';
  open.className = 'btn btn-secondary sm chat-clip-open';
  open.setAttribute('aria-label', say('chat.clipOpen', { n: c.round }));
  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  icon.setAttribute('viewBox', '0 0 24 24');
  icon.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', 'M8 5.5v13l10.5-6.5z');
  icon.append(path);
  const words = document.createElement('span');
  words.textContent = say('chat.clipOpen', { n: c.round });
  open.append(icon, words);
  open.addEventListener('click', () => {
    if (!window.ClipPlayer || typeof window.ClipPlayer.create !== 'function') return;
    const p = window.ClipPlayer.create({ url: c.url, death: c.death, frames: c.frames || null, label: say('chat.clipLabel', { n: c.round }) });
    const cap = document.createElement('p');
    cap.className = 'chat-clip-cap';
    cap.textContent = say('chat.clipLabel', { n: c.round });
    box.replaceChildren(cap, p.el);
    const played = p.video && typeof p.video.play === 'function' ? p.video.play() : null;
    if (played && typeof played.catch === 'function') {
      played.catch(() => { cap.textContent = t('chat.clipFailed'); cap.classList.add('bad'); });
    }
  });
  box.append(open);
  return box;
}

/** A line of its own, never a bubble: the cap, the hold, a match in progress. */
function addLine(kind, text, opts = {}) {
  const el = document.createElement('p');
  el.className = `chat-line ${kind}`;
  el.textContent = text;
  place(el, opts.before);
  scrollDown();
  return el;
}

/*
 * EVERY GAME USED (8.7.3): the server answers no question for an account with
 * no games left. Said calmly as a line, never a bubble or an error, with the
 * way to the Profile page, where games are bought. Never mid match: main
 * refuses the question before it is sent, and the Profile page is sealed then.
 */
function addLocked(opts = {}) {
  const el = addLine('cap', t('chat.locked'), opts);
  if (window.occlara && typeof window.occlara.go === 'function') {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn btn-secondary sm chat-line-action';
    b.textContent = t('chat.openProfile');
    b.addEventListener('click', () => window.occlara.go('profile'));
    el.append(b);
  }
  return el;
}

/** The line a failed or slow question leaves, with the way to ask it again. */
function addFailed(kind, text, q, opts = {}) {
  const el = addLine(kind, text, opts);
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'btn btn-tertiary chat-line-action chat-retry';
  b.textContent = t('chat.retry');
  b.addEventListener('click', () => {
    if (busy) return;
    const again = inputEl.value.trim() || q;
    el.remove();
    send(again);
  });
  el.append(b);
  return el;
}

/** The coach is writing: one quiet line where the answer will stand, still (8.8: nothing loops). */
function showTyping() {
  const el = document.createElement('p');
  el.className = 'typing';
  el.textContent = t('chat.writing');
  threadEl.append(el);
  scrollDown();
  return el;
}

/** A new thread under a divider: the match named, the starters again. */
function newThread(row, before) {
  history = [];
  const line = document.createElement('div');
  line.className = 'chat-divider';
  line.setAttribute('role', 'separator');
  const text = document.createElement('span');
  text.textContent = row ? say('chat.divider', { match: noun(row) }) : t('chat.dividerNone');
  line.append(text);
  if (before && before.parentNode === threadEl) threadEl.insertBefore(line, before);
  else threadEl.append(line);
  if (!before) {
    threadEl.append(introEl);
    introEl.hidden = false;
  }
  scrollDown();
  return line;
}

// ── Starters, from the match on the chip ───────────────────────────────────

// Each is a secondary rectangle holding the question alone (8.8, was a ghost
// capsule), one under another at the column's left edge: the words are the
// whole of it.

/** The questions the page offers for the match on the chip, or for no match. */
function starterTexts() {
  const s = state.starters;
  if (!state.current || !s) return [t('chat.kit'), t('chat.save'), t('chat.sheriff')];
  if (s.lol) return [s.agent ? say('chat.change', { agent: s.agent }) : null, t('chat.workOn')].filter(Boolean);
  return [s.walk ? say('chat.walk', { n: s.walk }) : null, s.agent ? say('chat.change', { agent: s.agent }) : null, t('chat.losing')].filter(Boolean);
}

function paintStarters() {
  startersEl.replaceChildren();
  starterTexts().forEach((text) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn btn-secondary starter';
    b.textContent = text;
    b.addEventListener('click', () => send(text));
    startersEl.append(b);
  });
}

// ── The chip ───────────────────────────────────────────────────────────────

function paintPicker() {
  if (!window.Dropdown || !pickEl) return;
  const options = state.list.map((r) => ({ value: r.id, label: label(r) }));
  options.push({ value: 'none', label: t('chat.noMatch') });
  if (!picker) {
    picker = window.Dropdown.create(pickEl, { options, label: t('chat.matchLabel'), onChange: (v) => choose(v) });
  } else {
    picker.setOptions(options, true);
  }
  picker.setValue(state.chosen.how === 'none' ? 'none' : (state.chosen.id || 'none'));
}

function take(res) {
  if (!res || typeof res !== 'object') return;
  state = {
    game: res.game || null,
    list: Array.isArray(res.list) ? res.list.filter(Boolean) : [],
    chosen: res.chosen && typeof res.chosen === 'object' ? res.chosen : { id: null, how: null },
    current: res.current || null,
    starters: res.starters || null,
  };
  paintPicker();
  paintStarters();
}

async function loadMatches() {
  try { take(await window.occlara.getMatches()); } catch { /* the chip stays as it was */ }
}

/** The player moved the chip: a new thread about that match. */
async function choose(id) {
  let res = null;
  try { res = await window.occlara.setMatch(id === 'none' ? 'none' : id); } catch { return; }
  take(res);
  newThread(state.current);
}

// ── A question ─────────────────────────────────────────────────────────────

const clock = (at) => new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

async function send(text) {
  if (busy) return;
  const q = String(text || '').trim();
  if (!q) return;
  busy = true;
  sendBtn.disabled = true;
  inputEl.value = '';
  // A question asked again, or a new one, takes the place of the line that
  // said the last one failed.
  for (const old of threadEl.querySelectorAll('.chat-line.failed, .chat-line.timeout')) old.remove();

  const bubble = addMsg('user', q);
  history.push({ role: 'user', content: q });
  // THE ANSWER STAYS IN THE THREAD IT WAS ASKED IN. The chip can move while a
  // reply is on its way, and the answer about the match before landed under
  // the new match's divider and in its thread (the verifier's probe, 15 Oct):
  // it goes where the typing dots stood, into the thread that asked it.
  let own = history;
  const typing = showTyping();
  let res = null;
  try {
    res = await window.occlara.sendChat(history.slice(-12), { reviewId: state.chosen.how === 'none' ? 'none' : state.chosen.id });
  } catch { res = null; }
  const at = { before: typing };
  try {
    if (res && res.ok && res.reply) {
      // The question named another match: the chip moved with it, and the
      // thread starts again above the question.
      if (res.moved && res.match) {
        await loadMatches();
        newThread(res.match, bubble);
        history = [{ role: 'user', content: q }];
        own = history;
      }
      const reply = res.honest ? t('chat.honest') : res.reply;
      addMsg('assistant', reply, { ...at, clips: res.honest ? null : res.clips });
      own.push({ role: 'assistant', content: reply });
    } else if (res && res.ok && res.which) {
      const reply = say('chat.which', { count: res.which.count, map: res.which.map });
      addMsg('assistant', reply, at);
      own.push({ role: 'assistant', content: reply });
    } else if (res && res.ok && res.none) {
      const reply = say('chat.noneOnMap', { map: res.none.map });
      addMsg('assistant', reply, at);
      own.push({ role: 'assistant', content: reply });
    } else {
      own.pop();
      const kind = res && res.kind;
      if (kind === 'chat-daily') addLine('cap', res.resetsAt ? say('chat.cap', { time: clock(res.resetsAt) }) : t('chat.capTomorrow'), at);
      else if (kind === 'chat-cap') addLocked(at);
      else if (kind === 'held') addLine('held', t('chat.held'), at);
      else if (kind === 'mid-match') addLine('note', t('chat.midMatch'), at);
      else {
        // A QUESTION THAT FAILED IS KEPT (8.8): it goes back in the box, its
        // bubble goes (the retry asks it again), and a calm line says what
        // happened with the way to ask it again. A slow answer is its own
        // line (main's 'timeout'), never called a failure to reach.
        bubble.remove();
        if (!inputEl.value.trim()) inputEl.value = q;
        addFailed(kind === 'timeout' ? 'timeout' : 'failed', kind === 'timeout' ? t('chat.timeout') : ((res && res.error) || t('chat.failed')), q, at);
      }
    }
  } finally {
    typing.remove();
    busy = false;
    sendBtn.disabled = false;
    inputEl.focus();
  }
}

composer.addEventListener('submit', (e) => { e.preventDefault(); send(inputEl.value); });

// ── "Ask about this match" ─────────────────────────────────────────────────

/*
 * The seed "Ask about this match" leaves (CHAT_SEED), taken once: the page
 * opens on that match and asks its opening question, a recorded review's
 * "most costly mistake", a review graded from Riot's record alone its own,
 * or a round's walk through. A match that may still be going on says so.
 */
async function checkSeed() {
  let seed = null;
  try { seed = await window.occlara.getSeed(); } catch { seed = null; }
  if (!seed || busy) return;
  await loadMatches();
  if (seed.held) { addLine('held', t('chat.held')); return; }
  const q = seed.round ? say('chat.walk', { n: seed.round })
    : seed.riotOnly ? say('chat.openRiot', { map: seed.map || seed.title })
      : say('chat.openRecorded', { match: seed.title || 'last' });
  send(q);
}

// A newer review moves "newest"; a match picked by hand stays picked.
if (window.occlara && typeof window.occlara.onReviews === 'function') {
  window.occlara.onReviews(async () => {
    const was = state.chosen.id;
    const newest = state.chosen.how === 'newest';
    await loadMatches();
    if (newest && was && state.chosen.id !== was && history.length) newThread(state.current);
  });
}
if (window.occlara && typeof window.occlara.onGame === 'function') {
  window.occlara.onGame(async () => {
    try { take(await window.occlara.setMatch(null)); } catch { await loadMatches(); }
    if (history.length) newThread(state.current);
  });
}

window.addEventListener('focus', () => { checkSeed(); });

// A page of the main window has no window of its own to close.
$('close').addEventListener('click', () => {
  if (!(window.occlaraEmbedded && window.occlaraEmbedded())) window.close();
});

(async () => {
  if (window.initI18n) {
    try {
      const bound = await window.initI18n(() => { paintPicker(); paintStarters(); });
      if (typeof bound === 'function') tr = bound;
    } catch { /* English */ }
  }
  await loadMatches();
  await checkSeed();
  inputEl.focus();
})();
console.log('[chat] ready');

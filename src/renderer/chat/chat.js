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
 * its own, never a coach bubble. A reply keeps its paragraphs (pre-line).
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
  'chat.which': '{count} of your last ten matches are on {map}. Which one do you mean? Pick it from the match list above.',
  'chat.noneOnMap': 'None of your last ten matches is on {map}. Pick a match from the list above, or ask about this one.',
  'chat.failed': 'Could not reach your coach right now. Try again in a moment.',
  'chat.midMatch': 'A match is in progress. Ask Coach is back once it ends.',
  'chat.honest': "I couldn't give you an answer I can stand behind for that one. Ask me about a round, a death or your agent in this match.",
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
  el.className = `msg ${role === 'user' ? 'user' : 'coach'}${opts.error ? ' error' : ''}`;
  // A reply's paragraphs are kept: the bubble is pre-line (chat.css).
  el.textContent = text;
  place(el, opts.before);
  scrollDown();
  return el;
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

function showTyping() {
  const el = document.createElement('div');
  el.className = 'typing';
  for (let i = 0; i < 3; i++) el.append(document.createElement('i'));
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

const SVG = 'http://www.w3.org/2000/svg';
function icon(paths) {
  const svg = document.createElementNS(SVG, 'svg');
  for (const [k, v] of [['viewBox', '0 0 24 24'], ['width', '15'], ['height', '15'], ['fill', 'none'], ['stroke', 'currentColor'],
    ['stroke-width', '1.8'], ['stroke-linecap', 'round'], ['stroke-linejoin', 'round']]) svg.setAttribute(k, v);
  for (const d of paths) {
    const p = document.createElementNS(SVG, d.startsWith('c') ? 'circle' : 'path');
    if (d.startsWith('c')) { const [, cx, cy, r] = d.split(' '); p.setAttribute('cx', cx); p.setAttribute('cy', cy); p.setAttribute('r', r); }
    else p.setAttribute('d', d);
    svg.append(p);
  }
  return svg;
}
const ICONS = [
  ['M4 19h16', 'M7 15l3-4 3 2 4-6'],
  ['c 12 12 8', 'c 12 12 3.4', 'M12 2v3', 'M12 19v3', 'M2 12h3', 'M19 12h3'],
  ['M12 3a7 7 0 0 0-4 12.7V19a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1v-3.3A7 7 0 0 0 12 3z'],
];

/** The questions the page offers for the match on the chip, or for no match. */
function starterTexts() {
  const s = state.starters;
  if (!state.current || !s) return [t('chat.kit'), t('chat.save'), t('chat.sheriff')];
  if (s.lol) return [s.agent ? say('chat.change', { agent: s.agent }) : null, t('chat.workOn')].filter(Boolean);
  return [s.walk ? say('chat.walk', { n: s.walk }) : null, s.agent ? say('chat.change', { agent: s.agent }) : null, t('chat.losing')].filter(Boolean);
}

function paintStarters() {
  startersEl.replaceChildren();
  starterTexts().forEach((text, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'starter';
    const ico = document.createElement('span');
    ico.className = 's-ico';
    ico.append(icon(ICONS[i % ICONS.length]));
    const words = document.createElement('span');
    words.textContent = text;
    b.append(ico, words);
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
      addMsg('assistant', reply, at);
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
      else if (kind === 'held') addLine('held', t('chat.held'), at);
      else if (kind === 'mid-match') addLine('note', t('chat.midMatch'), at);
      else addMsg('assistant', (res && res.error) || t('chat.failed'), { error: true, ...at });
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

'use strict';

/*
 * The shell: the main window's sidebar, top strip and Recording screen (8.1).
 *
 * It carries what the panel window used to, ported with the same rules: Start,
 * Stop and Pause, the agent check once a Valorant recording starts, the one
 * status line (a notice when something is wrong, never anything about the
 * match), the start and stop sounds, and the licence ending. Plus what the one
 * window adds: the pages, the game, and the seal, which during a match shows
 * the Recording screen and no page at all.
 */

const $ = (id) => document.getElementById(id);

let tr = (k) => ({
  'panel.start': 'Start', 'panel.stop': 'Stop',
  'panel.coaching': 'Recording', 'panel.paused': 'Paused',
  'panel.noTips': 'Press Start before your match. The review opens when it ends.',
}[k] || k);

const ICO = {
  play: '<svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor" stroke="none"><path d="M8 5.2v13.6a.6.6 0 0 0 .93.5l10.2-6.8a.6.6 0 0 0 0-1l-10.2-6.8A.6.6 0 0 0 8 5.2z"/></svg>',
  stop: '<svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor" stroke="none"><rect x="6" y="6" width="12" height="12" rx="1.5"/></svg>',
  pause: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M9 5v14"/><path d="M15 5v14"/></svg>',
  check: '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12.5l5.5 5.5L20 7"/></svg>',
};
// The page icons. App authored markup, never user or model text.
const PAGE_ICO = {
  home: '<path d="M4 11l8-7 8 7v8a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z"/>',
  matches: '<path d="M9 6h11M9 12h11M9 18h11"/><path d="M4 6h.01M4 12h.01M4 18h.01"/>',
  patterns: '<path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
  breakdown: '<rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.5"/>',
  stats: '<path d="M5 20V11M12 20V4M19 20v-6"/>',
  coach: '<path d="M4 5h16v11H10l-6 4z"/>',
};
const LOCK = '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>';
const svg = (inner) => `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;

const toggleBtn = $('toggle');
const toggleIco = toggleBtn.querySelector('.t-ico');
const toggleLbl = toggleBtn.querySelector('.t-label');
const pauseBtn = $('pause');
const recEl = $('rec');
const lineEl = $('line');

let isCoaching = false;
let isPaused = false;
let notice = null;
let cadence = null;
let captureSpeed = 'auto';
let licenseActive = true;
let gameId = 'valorant';
let shell = { page: 'home', shown: 'home', sealed: false, held: false, maximized: false };
let cfg = null;

// ── The pages ──────────────────────────────────────────────────────────────
const pages = window.occlara.pages();
const navButtons = new Map();
for (const p of pages.filter((x) => x.nav)) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'nav-item';
  b.dataset.page = p.id;
  b.innerHTML = svg(PAGE_ICO[p.id] || '');
  const label = document.createElement('span');
  label.textContent = p.label;
  b.append(label);
  b.addEventListener('click', () => window.occlara.go(p.id));
  $('nav').append(b);
  navButtons.set(p.id, b);
}
navButtons.set('settings', $('nav-settings'));
$('nav-settings').addEventListener('click', () => window.occlara.go('settings'));
$('learn').addEventListener('click', () => window.occlara.openLearn());

// The screen in the page's place: mid match, or held after a stop mid match.
const SEALED_TEXT = {
  live: { title: 'Recording', sub: 'Occlara shows nothing until the match ends. The review opens here the moment it does.' },
  held: { title: 'Recording stopped',
    sub: 'You stopped in the middle of a match, so its review was saved to Matches without opening. Choose a page when that match is over.' },
};

function paintNav() {
  // Mid match the pages are locked. Held, the sidebar stays open: a page is
  // the player's own choice, and opening one lifts the seal.
  const locked = !!shell.sealed && !shell.held;
  // The review belongs with the library it opens from.
  const current = shell.page === 'review' ? 'matches' : shell.page;
  for (const [id, b] of navButtons) {
    if (current === id && !shell.sealed) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
    b.disabled = locked;
    const ico = b.querySelector('svg');
    if (ico) ico.innerHTML = locked ? LOCK : (id === 'settings'
      ? '<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>'
      : PAGE_ICO[id] || '');
  }
  $('learn').disabled = locked;
  $('sealed-note').hidden = !locked;
  $('sealed').hidden = !shell.sealed;
  const text = shell.held ? SEALED_TEXT.held : SEALED_TEXT.live;
  $('sealed').classList.toggle('held', !!shell.held);
  $('sealed').setAttribute('aria-label', text.title);
  $('sealed-title').textContent = text.title;
  $('sealed-sub').textContent = text.sub;
  $('sealed-facts').hidden = !!shell.held;
  $('w-max').title = shell.maximized ? 'Restore' : 'Maximize';
  $('w-max').setAttribute('aria-label', $('w-max').title);
  placeMarker();
}

/*
 * THE CURRENT PAGE'S MARKER (8.2): one element under the items, moved to the
 * current one, so going from Stats to Home slides it up the sidebar instead of
 * one item's background going out as another's comes on. It slides only when
 * the page changes; appearing (the seal lifting) or following the layout (the
 * window resized, the game picker shown, the record card growing or
 * shrinking) it is put there at once. With no page marked, mid match, it
 * fades out.
 */
const marker = $('nav-marker');
let markerOn = null;
function placeMarker() {
  const b = [...navButtons.values()].find((x) => x.getAttribute('aria-current') === 'page');
  const top = b ? b.offsetTop : NaN;
  if (!b || b.hidden || !Number.isFinite(top)) {
    marker.classList.remove('on');
    markerOn = null;
    return;
  }
  const id = b.dataset.page;
  const slide = markerOn !== null && markerOn !== id;
  marker.classList.toggle('still', !slide);
  marker.style.width = `${b.offsetWidth}px`;
  marker.style.height = `${b.offsetHeight}px`;
  marker.style.transform = `translate(${b.offsetLeft}px, ${top}px)`;
  marker.classList.add('on');
  markerOn = id;
}
window.addEventListener('resize', placeMarker);
// THE RECORD CARD CHANGES HEIGHT on its own: a notice on its line, the agent
// check opening, its quick picks, its locked in row, and none 1.6 seconds
// later. Once the sidebar overflows (at the window's minimum height, or with
// the agent check up at the default one) nothing above Settings gives way,
// so Settings, below the card, moves with it, and the marker left where it
// had been painted over the account line. So the marker follows the card,
// whatever changed it, after layout and before the frame is painted.
new ResizeObserver(() => placeMarker()).observe(recEl);

// ── The game ───────────────────────────────────────────────────────────────
function paintGames() {
  const host = $('gamepick');
  const games = window.occlara.games(!!(cfg && cfg.devGames === true));
  host.hidden = games.length < 2;
  host.replaceChildren();
  if (games.length < 2) { placeMarker(); return; }
  for (const g of games) {
    const b = document.createElement('button');
    b.type = 'button';
    // Our own mark for each game (shared/game-marks.js), never its logo, and
    // the full name beside it as the tooltip and the accessible name. A game
    // with no mark keeps its name as text.
    const mark = window.GameMarks ? window.GameMarks.svg(g.id) : '';
    if (mark) b.innerHTML = mark;
    else { b.textContent = g.label; b.classList.add('named'); }
    b.setAttribute('aria-label', g.label);
    b.title = isCoaching ? 'Stop recording to switch game' : g.label;
    b.setAttribute('aria-pressed', String(g.id === gameId));
    // Switching game stops a running session (index.js onConfigChanged), so
    // it is refused here while recording rather than done by surprise.
    b.disabled = isCoaching;
    b.addEventListener('click', async () => {
      if (g.id === gameId || isCoaching) return;
      await window.occlara.setGame(g.id).catch(() => {});
    });
    host.append(b);
  }
  // The picker sits above the pages: shown or gone, they move.
  placeMarker();
}

function paintAccount() {
  const el = $('account');
  const id = String((cfg && cfg.riotId) || '').trim();
  el.hidden = gameId !== 'valorant';
  if (el.hidden) return;
  const connected = id.includes('#') && String(cfg.riotConnected || '').toLowerCase() === id.toLowerCase();
  el.textContent = !id.includes('#') ? 'Add your Riot ID' : connected ? `${id} connected` : id;
  el.title = el.textContent;
  el.classList.toggle('on', connected);
}
$('account').addEventListener('click', () => window.occlara.go('settings'));

/** The config, or what is already known when it cannot be read. */
function readConfig(fallback) {
  if (typeof window.occlara.getConfig !== 'function') return Promise.resolve(fallback);
  return window.occlara.getConfig().catch(() => fallback);
}

// ── The record controls ────────────────────────────────────────────────────
function statusLabel(status) {
  if (status === 'coaching') return tr('panel.coaching');
  if (status === 'paused') return tr('panel.paused');
  const word = tr('panel.idle');
  return word === 'panel.idle' ? 'Ready' : word;
}

// What the Recording screen says, per game: how it is read and what happens
// after. League is recorded from the game's own local data, not the screen.
const SEALED_FACTS = {
  valorant: { capture: true, game: 'Read the way OBS reads it: the display only, never memory or files',
    after: "Checked against Riot's record once it is published, 90 seconds to four minutes after the end" },
  rivals: { capture: true, game: 'Read the way OBS reads it: the display only, never memory or files',
    after: 'Graded from the end of match scoreboard as soon as it shows' },
  lol: { capture: false, game: "Recorded from the game's own local data, never memory or files",
    after: 'Graded from what was recorded, the moment the game ends' },
};
function paintSealedFacts() {
  const f = SEALED_FACTS[gameId] || SEALED_FACTS.valorant;
  $('sealed-capture-row').hidden = !f.capture;
  $('sealed-game').textContent = f.game;
  $('sealed-after').textContent = f.after;
}

function renderLine() {
  paintSealedFacts();
  lineEl.classList.toggle('system', !!notice);
  if (notice && notice.text) { lineEl.textContent = notice.text; return; }
  const every = cadence ? (cadence < 1000 ? `${cadence}ms` : `${Math.round(cadence / 100) / 10}s`) : null;
  lineEl.textContent = isCoaching
    ? `Reading your game${every ? ' every ' + every : ''}${captureSpeed === 'auto' ? '' : ' (pinned)'}. Your review opens when the match ends.`
    : tr('panel.noTips');
  $('sealed-capture').textContent = every
    ? `Reading your game every ${every}${captureSpeed === 'auto' ? ', as fast as the connection keeps up' : ', pinned in Settings'}`
    : 'Auto, as fast as the connection keeps up';
}

function render() {
  if (!licenseActive) {
    $('dot').className = 'dot stopped';
    $('status-text').textContent = 'Subscription ended';
    $('status-text').classList.add('ended');
    toggleBtn.disabled = true;
    toggleBtn.classList.remove('active');
    toggleLbl.textContent = 'Subscription ended';
    toggleIco.innerHTML = '';
    pauseBtn.disabled = true;
    lineEl.classList.add('system');
    lineEl.textContent = (notice && notice.text) || 'Your subscription has ended. Renew in Settings to keep getting reviews.';
    recEl.classList.remove('live');
    return;
  }
  $('status-text').classList.remove('ended');
  toggleBtn.disabled = false;
  const status = isCoaching ? (isPaused ? 'paused' : 'coaching') : 'idle';
  $('dot').className = `dot ${status}`;
  $('status-text').textContent = statusLabel(status);
  toggleLbl.textContent = tr(isCoaching ? 'panel.stop' : 'panel.start');
  toggleIco.innerHTML = isCoaching ? ICO.stop : ICO.play;
  toggleBtn.classList.toggle('active', isCoaching);
  recEl.classList.toggle('live', isCoaching && !isPaused);
  pauseBtn.disabled = !isCoaching;
  pauseBtn.innerHTML = isPaused ? ICO.play : ICO.pause;
  renderLine();
}

toggleBtn.addEventListener('click', () => {
  if (isCoaching) window.occlara.stopCoaching();
  else window.occlara.startCoaching();
});
pauseBtn.addEventListener('click', () => window.occlara.pauseResume());

// ── The agent check (as the panel had it) ─────────────────────────────────
const agentBubble = $('agent-bubble');
const AB_ROWS = { detect: $('ab-detect'), ask: $('ab-ask'), form: $('ab-form'), done: $('ab-done') };
const abInput = $('ab-input');
const abQuick = $('ab-quick');
let topAgents = [];
let sessionActive = false;
let agentAnswered = false;
let formActive = false;
let doneTimer = null;

function showRow(which) {
  agentBubble.hidden = false;
  for (const [k, node] of Object.entries(AB_ROWS)) node.hidden = (k !== which);
}
function hideAgentUI() {
  formActive = false;
  if (doneTimer) { clearTimeout(doneTimer); doneTimer = null; }
  agentBubble.hidden = true;
  abQuick.hidden = true;
}
function renderQuickPicks() {
  if (agentAnswered || !topAgents.length) { abQuick.hidden = true; return; }
  const host = $('ab-quick-btns');
  host.replaceChildren();
  for (const name of topAgents) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'ab-quick-btn';
    b.textContent = name;
    b.title = name;
    b.addEventListener('click', () => { window.occlara.setAgent(name).catch(() => {}); });
    host.append(b);
  }
  abQuick.hidden = false;
}
function showDetecting() { if (!agentAnswered) { formActive = false; showRow('detect'); renderQuickPicks(); } }
function showConfirm(name) {
  if (agentAnswered) return;
  formActive = false;
  $('ab-name').textContent = name;
  showRow('ask');
  renderQuickPicks();
}
function showForm() {
  if (agentAnswered) return;
  formActive = true;
  showRow('form');
  abInput.classList.remove('bad');
  abInput.value = '';
  abInput.placeholder = 'Type your agent';
  renderQuickPicks();
  setTimeout(() => abInput.focus(), 30);
}
function showDoneAndHide(name) {
  agentAnswered = true;
  formActive = false;
  abQuick.hidden = true;
  const done = $('ab-done-name');
  done.innerHTML = ICO.check + ' ';
  done.append(name);
  showRow('done');
  if (doneTimer) clearTimeout(doneTimer);
  doneTimer = setTimeout(hideAgentUI, 1600);
}
$('ab-yes').addEventListener('click', () => window.occlara.confirmAgent());
$('ab-no').addEventListener('click', showForm);
$('ab-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const val = abInput.value.trim();
  if (!val) return;
  window.occlara.setAgent(val).then((res) => {
    if (!res || !res.ok) {
      abInput.classList.add('bad');
      abInput.value = '';
      abInput.placeholder = 'Not found, try again';
      setTimeout(() => abInput.focus(), 20);
    }
  }).catch(() => {});
});
window.occlara.onAgent((info) => {
  if (!isCoaching || agentAnswered || gameId !== 'valorant') return;
  const i = info || {};
  if (i.agent && i.confirmed) { showDoneAndHide(i.agent); return; }
  if (formActive) return;
  if (i.agent) showConfirm(i.agent);
  else showForm();
});

// ── Sounds, on real transitions only (the panel's rule) ──────────────────
const SFX_VOLUME = 0.9;
let soundsOn = true;
let heard = null;
function soundCue() {
  const now = { coaching: isCoaching, paused: isPaused };
  const before = heard;
  heard = now;
  if (!before || !soundsOn || !window.occlaraSfx) return;
  const was = before.coaching && !before.paused;
  const is = now.coaching && !now.paused;
  if (is && !was) window.occlaraSfx.play('start', SFX_VOLUME);
  else if (before.coaching && !now.coaching) window.occlaraSfx.play('stop', SFX_VOLUME);
}

// ── State ──────────────────────────────────────────────────────────────────
function applyState(s) {
  if (!s) return;
  const gameChanged = typeof s.gameId === 'string' && s.gameId !== gameId;
  if (typeof s.gameId === 'string') gameId = s.gameId;
  const wasCoaching = isCoaching;
  isCoaching = !!s.isCoaching;
  isPaused = !!s.isPaused;
  if ('notice' in s) notice = s.notice || null;
  if ('cadence' in s) cadence = s.cadence || null;
  if ('sounds' in s) soundsOn = s.sounds !== false;
  if (s.captureSpeed) captureSpeed = s.captureSpeed;
  if (typeof s.licenseActive === 'boolean') licenseActive = s.licenseActive;
  if (Array.isArray(s.topAgents)) {
    topAgents = s.topAgents.slice(0, 3);
    if (!agentBubble.hidden && !agentAnswered) renderQuickPicks();
  }
  $('learn').hidden = gameId !== 'lol';
  render();
  // Measured once the line is written: a notice arriving or clearing changes
  // the record card's height, and Settings below it moves with it.
  placeMarker();
  soundCue();
  if (!isCoaching) { sessionActive = false; agentAnswered = false; hideAgentUI(); }
  if (gameChanged || wasCoaching !== isCoaching) { paintGames(); paintAccount(); }
}

window.occlara.onState(applyState);
window.occlara.onStatus(({ status }) => {
  if (status === 'coaching') {
    isCoaching = true; isPaused = false;
    if (!sessionActive) {
      sessionActive = true; agentAnswered = false;
      // A Valorant question: the other games' engines never answer it.
      if (gameId === 'valorant') showDetecting();
    }
  } else if (status === 'paused') {
    isCoaching = true; isPaused = true;
  } else if (status === 'stopped' || status === 'idle') {
    isCoaching = false; isPaused = false;
    sessionActive = false; agentAnswered = false;
    hideAgentUI();
  }
  render();
  soundCue();
  paintGames();
});
window.occlara.onShell((s) => { if (s) { shell = s; paintNav(); } });
window.occlara.onGame(async () => { cfg = await readConfig(cfg); paintGames(); paintAccount(); });

// ── The window ─────────────────────────────────────────────────────────────
$('w-min').addEventListener('click', () => window.occlara.windowAction('minimize'));
$('w-max').addEventListener('click', () => window.occlara.windowAction('maximize'));
$('w-close').addEventListener('click', () => window.occlara.windowAction('close'));
document.querySelector('.top').addEventListener('dblclick', (e) => {
  if (!e.target.closest('.win-controls')) window.occlara.windowAction('maximize');
});

// ── Boot ───────────────────────────────────────────────────────────────────
(async () => {
  cfg = await readConfig(null);
  const [state, s] = await Promise.all([
    window.occlara.getState().catch(() => null),
    window.occlara.getShell().catch(() => null),
  ]);
  if (s) shell = s;
  applyState(state);
  paintGames();
  paintAccount();
  paintNav();
  // Geist arriving can move the items by a pixel or two.
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(placeMarker).catch(() => {});
  if (window.initI18n) {
    const use = (t) => { if (typeof t === 'function') { tr = t; render(); } };
    window.initI18n(use).then(use).catch(() => {});
  }
  // Settings may change the Riot ID: the account line reads it again when the
  // window comes back to the front.
  window.addEventListener('focus', async () => { cfg = await readConfig(cfg); paintAccount(); });
  console.log('[shell] ready');
})();
render();

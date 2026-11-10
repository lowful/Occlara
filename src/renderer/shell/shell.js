'use strict';

/*
 * The shell: the main window's top bar, account drawer and Recording screen
 * (8.1; the sidebar became the top bar in Progress v3).
 *
 * It carries what the panel window used to, ported with the same rules: Start,
 * Stop and Pause, one line of notices (since 8.3 in the top strip, and only
 * when there is one: never anything about the match), the start and stop
 * sounds, and the licence ending. Plus what the one window adds: the pages,
 * the game, and the seal, which during a match shows the Recording screen and
 * no page at all. No agent check (8.4.4): the agent is read off the player's
 * own HUD in the match, and nothing here asks for it or says it.
 */

const $ = (id) => document.getElementById(id);

let tr = (k) => ({
  'panel.start': 'Start', 'panel.stop': 'Stop',
  'panel.pausedLine': 'Paused. Nothing is read until you resume.',
}[k] || k);

const ICO = {
  play: '<svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor" stroke="none"><path d="M8 5.2v13.6a.6.6 0 0 0 .93.5l10.2-6.8a.6.6 0 0 0 0-1l-10.2-6.8A.6.6 0 0 0 8 5.2z"/></svg>',
  stop: '<svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor" stroke="none"><rect x="6" y="6" width="12" height="12" rx="1.5"/></svg>',
  pause: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M9 5v14"/><path d="M15 5v14"/></svg>',
};
// The page icons. App authored markup, never user or model text.
const PAGE_ICO = {
  home: '<path d="M4 11l8-7 8 7v8a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z"/>',
  matches: '<path d="M9 6h11M9 12h11M9 18h11"/><path d="M4 6h.01M4 12h.01M4 18h.01"/>',
  patterns: '<path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
  // Moments (8.7): a film frame, for the deaths and highlights compiled.
  moments: '<rect x="3.5" y="5" width="17" height="14" rx="2"/><path d="M3.5 9h17M3.5 15h17M8 5v14M16 5v14"/>',
  stats: '<path d="M5 20V11M12 20V4M19 20v-6"/>',
  coach: '<path d="M4 5h16v11H10l-6 4z"/>',
  // The two in the sidebar's foot, drawn in index.html and put back here
  // once the seal's lock goes.
  invite: '<circle cx="10" cy="8" r="3.5"/><path d="M3.5 20a6.5 6.5 0 0 1 13 0"/><path d="M19 8v6M16 11h6"/>',
  // Profile (8.8): a person in a ring.
  profile: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="10" r="3"/><path d="M6.8 18.3a6 6 0 0 1 10.4 0"/>',
  // Report a problem (docs/claude/feedback.md): a flag, the icon at the end
  // of Profile's row above the Discord.
  feedback: '<path d="M5.5 21V4.5"/><path d="M5.5 4.5h11.2a.6.6 0 0 1 .5.92L15.2 8.5l2 3.08a.6.6 0 0 1-.5.92H5.5"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>',
};
const LOCK = '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>';
const svg = (inner) => `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;

const toggleBtn = $('toggle');
const toggleIco = toggleBtn.querySelector('.t-ico');
const toggleLbl = toggleBtn.querySelector('.t-label');
const pauseBtn = $('pause');
const recEl = $('rec');
const noticeEl = $('notice');

let isCoaching = false;
let isPaused = false;
let notice = null;
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
// The foot's three pages (8.7: Invite, then 8.8: Profile, above Settings).
// They are in navButtons, so the seal locks them and the marker finds them
// like the rest.
navButtons.set('invite', $('nav-invite'));
navButtons.set('profile', $('nav-profile'));
navButtons.set('settings', $('nav-settings'));
// Report a problem: a page like the rest, so the seal locks it and the
// marker finds it, drawn as the quiet icon at the end of Profile's row.
navButtons.set('feedback', $('nav-feedback'));
$('nav-feedback').addEventListener('click', () => window.occlara.go('feedback'));
$('nav-invite').addEventListener('click', () => window.occlara.go('invite'));
$('nav-profile').addEventListener('click', () => window.occlara.go('profile'));
$('nav-settings').addEventListener('click', () => window.occlara.go('settings'));
$('learn').addEventListener('click', () => { setDrawer(false); window.occlara.openLearn(); });

/*
 * THE ACCOUNT MENU (Progress v3, a dropdown under the avatar since 8.9.1):
 * what the sidebar's foot held, opened from the avatar at the bar's end.
 *
 * IT FLOATS OVER THE PAGE (8.9.1). A page's view paints over this document,
 * so the menu is drawn by a small see-through view of its own laid on top
 * while it is open (main-window.js openMenu), and the page keeps its full
 * width. This document still owns it: #drawer is laid out here, never painted
 * (shell.css), its rows locked by the seal like the tabs (paintNav), and its
 * markup and rectangle are sent to the view on opening and on every change
 * while open (syncMenu). The view says which row was chosen, and the choice is
 * carried out here on that row (onMenuAct), so a locked row stays locked.
 *
 * A menu (role=menu), its keyboard in the view: opening it puts focus on its
 * first item (ArrowUp on the avatar, its last), ArrowUp and ArrowDown move
 * through the items that can be chosen, Home and End go to either end, and
 * choosing one, Escape, Tab, the avatar again, a press anywhere outside it or
 * the window losing focus closes it. Escape and Tab give focus back to the
 * avatar.
 */
const drawerEl = $('drawer');
// Round the menu in its view: room for its shadow (theme.css --lift, 12px
// down and 34px of blur) on the sides and below, and the 8px it hangs under
// the bar above.
const MENU_PAD = { side: 28, top: 8, bottom: 40 };
const hasMenuView = typeof window.occlara.menu === 'function';
function syncMenu(focus) {
  if (drawerEl.hidden || !hasMenuView) return;
  const r = drawerEl.getBoundingClientRect();
  window.occlara.menu({
    open: true,
    html: drawerEl.innerHTML,
    rect: { x: r.left - MENU_PAD.side, y: r.top - MENU_PAD.top, width: r.width + MENU_PAD.side * 2, height: r.height + MENU_PAD.top + MENU_PAD.bottom },
    inset: { left: MENU_PAD.side, top: MENU_PAD.top },
    box: { width: r.width, height: r.height },
    focus: focus || null,
  });
}
// A row changing while open (the seal locking it, the games left, the Riot ID)
// is drawn again in the view, once a frame at most.
let menuFrame = 0;
// The focus an opening asked for, carried by the redraw its own opening
// schedules: the view keeps only the latest state it is sent, so a redraw
// with no focus right behind the opening's 'first' used to win, and the menu,
// not its first row, held the focus (check:mainwindow, 8.9.4).
let openFocus = null;
const menuChanged = () => {
  if (drawerEl.hidden || menuFrame) return;
  menuFrame = requestAnimationFrame(() => { menuFrame = 0; const f = openFocus; openFocus = null; syncMenu(f); });
};
new MutationObserver(menuChanged).observe(drawerEl, { subtree: true, childList: true, attributes: true, characterData: true });
window.addEventListener('resize', menuChanged);
function setDrawer(open, opts) {
  const d = drawerEl;
  const next = !!open;
  if (d.hidden === !next) return;
  d.hidden = !next;
  $('menu-btn').setAttribute('aria-expanded', String(next));
  // Opened by the keyboard, the focus is on its first row (its last, by
  // ArrowUp), ringed; opened by a press, on the menu itself, so no row wears
  // a keyboard's ring the mouse did not ask for, and ArrowDown goes to the first.
  if (next) {
    openFocus = opts && opts.last ? 'last' : opts && opts.by === 'pointer' ? 'menu' : 'first';
    syncMenu(openFocus);
  }
  else {
    if (hasMenuView) window.occlara.menu({ open: false });
    if (opts && opts.refocus) $('menu-btn').focus();
  }
}
// The avatar toggles it. A press on it while open takes the focus from the
// menu's view, which shuts it before the click arrives, and the click must not
// open it again: what counts is whether it was open as the press began.
let openAtPress = null;
$('menu-btn').addEventListener('pointerdown', () => { openAtPress = !drawerEl.hidden; });
$('menu-btn').addEventListener('click', (e) => {
  const wasOpen = openAtPress === null ? !drawerEl.hidden : openAtPress;
  openAtPress = null;
  // A click the keyboard made (Enter, Space) has no detail.
  setDrawer(!wasOpen, { by: e && e.detail > 0 ? 'pointer' : 'key' });
});
$('menu-btn').addEventListener('keydown', (e) => {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
  e.preventDefault();
  if (drawerEl.hidden) setDrawer(true, { last: e.key === 'ArrowUp' });
  else syncMenu(e.key === 'ArrowUp' ? 'last' : 'first');
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setDrawer(false, { refocus: true }); });
// Outside it, in this document: a press anywhere but the avatar (whose own
// click toggles it). A press on the page, or the window losing the focus,
// takes the focus from the menu's view, which shuts it from there.
document.addEventListener('pointerdown', (e) => {
  if (drawerEl.hidden) return;
  const t = e.target;
  if (t && t.nodeType === 1 && (drawerEl.contains(t) || $('menu-btn').contains(t))) return;
  setDrawer(false);
});
// What the view did: a row chosen is clicked here, only a row of this menu
// that can be chosen, so the seal's locks hold; shut from inside, the menu
// shuts here too.
if (typeof window.occlara.onMenuAct === 'function') {
  window.occlara.onMenuAct((m) => {
    if (!m) return;
    if (typeof m.choose === 'string') {
      const b = document.getElementById(m.choose);
      if (!drawerEl.hidden && b && drawerEl.contains(b) && b.getAttribute('role') === 'menuitem' && !b.hidden && !b.disabled) b.click();
    } else if (m.closed) {
      setDrawer(false, { refocus: !!m.refocus });
    }
  });
}
for (const id of ['nav-invite', 'nav-profile', 'nav-settings', 'nav-feedback', 'discord', 'account']) {
  $(id).addEventListener('click', () => setDrawer(false));
}
// The Discord (the community): main opens the invite in the browser, never
// mid match, and the seal locks the button like the pages (paintNav).
// The plain mark, the same path as index.html draws, put back once the lock goes.
const DISCORD_ICO = '<path d="M19.27 5.33A16.6 16.6 0 0 0 15.1 4l-.2.4a15.4 15.4 0 0 1 3.7 1.86 12.6 12.6 0 0 0-13.2 0A15.4 15.4 0 0 1 9.1 4.4L8.9 4a16.6 16.6 0 0 0-4.17 1.33C2.1 9.2 1.38 12.97 1.74 16.69a16.8 16.8 0 0 0 5.1 2.58l.83-1.37a10.8 10.8 0 0 1-1.76-.85l.43-.33a11.9 11.9 0 0 0 11.32 0l.43.33c-.56.33-1.15.62-1.76.85l.83 1.37a16.8 16.8 0 0 0 5.1-2.58c.43-4.3-.73-8.04-2.99-11.36zM8.68 14.4c-1 0-1.82-.92-1.82-2.05s.8-2.05 1.82-2.05 1.84.93 1.82 2.05c0 1.13-.8 2.05-1.82 2.05zm6.64 0c-1 0-1.82-.92-1.82-2.05s.8-2.05 1.82-2.05 1.84.93 1.82 2.05c0 1.13-.8 2.05-1.82 2.05z"/>';
$('discord').addEventListener('click', () => {
  if (!$('discord').disabled) Promise.resolve(window.occlara.openDiscord()).catch(() => {});
});

// The screen in the page's place: mid match, or held after a stop mid match.
const SEALED_TEXT = {
  live: { title: 'Recording', sub: 'No tips or advice until the match ends. The review opens here the moment it does.' },
  held: { title: 'Recording stopped',
    sub: 'You stopped in the middle of a match, so its review was saved to Matches without opening. Choose a page when that match is over.' },
};

function paintNav() {
  // Mid match the pages are locked. Held, the sidebar stays open: a page is
  // the player's own choice, and opening one lifts the seal.
  const locked = !!shell.sealed && !shell.held;
  // The review belongs with the library it opens from, What's new with
  // Settings, where it is reached from.
  const current = shell.page === 'review' ? 'matches' : shell.page === 'whatsnew' ? 'settings' : shell.page;
  for (const [id, b] of navButtons) {
    if (current === id && !shell.sealed) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
    b.disabled = locked;
    const ico = b.querySelector('svg');
    if (ico) ico.innerHTML = locked ? LOCK : (PAGE_ICO[id] || '');
  }
  $('learn').disabled = locked;
  const dc = $('discord');
  dc.disabled = locked;
  dc.title = locked ? 'Locked until the match ends' : 'Join the Occlara Discord';
  const dcIco = dc.querySelector('svg');
  dcIco.setAttribute('fill', locked ? 'none' : 'currentColor');
  dcIco.setAttribute('stroke', locked ? 'currentColor' : 'none');
  dcIco.setAttribute('stroke-width', '1.75');
  dcIco.setAttribute('stroke-linecap', 'round');
  dcIco.setAttribute('stroke-linejoin', 'round');
  dcIco.innerHTML = locked ? LOCK : DISCORD_ICO;
  $('nav-feedback').title = locked ? 'Locked until the match ends' : 'Report a problem';
  $('sealed-note').hidden = !locked;
  $('sealed').hidden = !shell.sealed;
  const text = shell.held ? SEALED_TEXT.held : SEALED_TEXT.live;
  $('sealed').classList.toggle('held', !!shell.held);
  $('sealed').setAttribute('aria-label', text.title);
  $('sealed-title').textContent = text.title;
  $('sealed-sub').textContent = text.sub;
  $('sealed-facts').hidden = !!shell.held;
  paintLive();
  // The bar's modes (Progress v3): on Home, not recording, Start is the
  // page's own strip; mid match Stop is the large capsule.
  const app = document.querySelector('.app');
  app.classList.toggle('home-page', shell.page === 'home' && !shell.sealed);
  app.classList.toggle('sealed-live', !!shell.sealed && !shell.held);
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
let markerAt = { x: 0, y: 0, w: 0 };
let markerGlide = null;
const reducedMotion = () => typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
function placeMarker() {
  // TOP NAVIGATION (Progress v3): the marker is the tabs' pill, so a page
  // in the drawer (Settings, Profile and the rest) marks its own row there.
  const b = [...navButtons.values()].find((x) => x.getAttribute('aria-current') === 'page' && x.parentNode === $('nav'));
  const top = b ? b.offsetTop : NaN;
  if (!b || b.hidden || !Number.isFinite(top)) {
    marker.classList.remove('on');
    markerOn = null;
    return;
  }
  const id = b.dataset.page;
  const slide = markerOn !== null && markerOn !== id;
  marker.classList.toggle('still', !slide);
  // THE PILL GLIDES (8.9.2), by transform alone. It is put where it ends at
  // once, its new width and place, and then played from where it was: the
  // old place and the old width as a scaleX from its left edge, over
  // --dur-move on --ease-in-out. No width is tweened, so nothing is laid out
  // per frame. Asked for less motion, or appearing, it is simply there.
  // Slid again before the last glide ended: from where the pill is now.
  let from = slide ? { x: markerAt.x, y: markerAt.y, w: markerAt.w } : null;
  if (from && markerGlide && typeof DOMMatrix === 'function') {
    try {
      const m = new DOMMatrix(getComputedStyle(marker).transform);
      from = { x: m.e, y: m.f, w: m.a * markerAt.w };
    } catch (e) { /* from where it was set */ }
  }
  const w = b.offsetWidth;
  const x = b.offsetLeft;
  marker.style.width = `${w}px`;
  marker.style.height = `${b.offsetHeight}px`;
  marker.style.transform = `translate(${x}px, ${top}px)`;
  marker.classList.add('on');
  markerOn = id;
  const moved = x !== markerAt.x || top !== markerAt.y || w !== markerAt.w;
  markerAt = { x, y: top, w };
  // The same tab measured again mid glide (a state push, the fonts) leaves the
  // glide alone; a new place, or a new slide, ends it.
  if (markerGlide && (slide || moved)) { markerGlide.cancel(); markerGlide = null; }
  if (from && from.w > 0 && w > 0 && typeof marker.animate === 'function' && !reducedMotion()) {
    const dur = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--dur-move')) || 260;
    markerGlide = marker.animate([
      { transform: `translate(${from.x}px, ${from.y}px) scaleX(${from.w / w})` },
      { transform: `translate(${x}px, ${top}px)` },
    ], { duration: dur, easing: 'cubic-bezier(0.77, 0, 0.175, 1)' });
    markerGlide.onfinish = () => { markerGlide = null; };
  }
}
window.addEventListener('resize', placeMarker);
// THE MARKER FOLLOWS THE RECORD CARD, whatever changes its height. Once the
// sidebar overflows (at the window's minimum height) nothing above Settings
// gives way, so Settings, below the card, moves with it, and a marker left
// where it had been was painted over the account line. The card is its two
// buttons since the agent check went (8.4.4) and a notice is the top strip's
// (8.3), so nothing it shows changes its height today; the marker is put
// back after layout all the same, before the frame is painted.
new ResizeObserver(() => placeMarker()).observe(recEl);

// ── The game ───────────────────────────────────────────────────────────────
function paintGames() {
  const host = $('gamepick');
  const games = window.occlara.games(!!(cfg && cfg.devGames === true));
  host.hidden = games.length < 2;
  // The buttons alone go: the capsule's thumb (shared/seg.js, 8.7) stays and
  // slides to the game picked once they are back.
  for (const b of host.querySelectorAll('button')) b.remove();
  if (games.length < 2) { placeMarker(); return; }
  for (const g of games) {
    const b = document.createElement('button');
    b.type = 'button';
    // Each game's own logo (shared/game-logos.js, the player's decision of
    // 2026-10-10), and the full name beside it as the tooltip and the
    // accessible name. A game with no logo keeps its name as text.
    const mark = window.GameLogos ? window.GameLogos.svg(g.id) : '';
    if (mark) b.innerHTML = mark;
    else { b.textContent = g.label; b.classList.add('named'); }
    b.setAttribute('aria-label', g.label);
    b.title = isCoaching ? 'Stop recording to switch game' : g.label;
    b.setAttribute('aria-pressed', String(g.id === gameId));
    // A game that is coming soon is shown but cannot be chosen: a popup says
    // so on hover and on keyboard focus (games.js comingSoon). aria-disabled
    // rather than disabled, so it still receives the hover.
    if (g.comingSoon) {
      b.classList.add('soon');
      b.removeAttribute('title');
      b.setAttribute('aria-disabled', 'true');
      b.setAttribute('aria-label', `${g.label}, coming soon`);
      b.setAttribute('aria-pressed', 'false');
      const pop = document.createElement('span');
      pop.className = 'soon-pop';
      pop.setAttribute('role', 'tooltip');
      pop.textContent = 'Coming soon';
      b.append(pop);
      b.addEventListener('click', (e) => e.preventDefault());
      host.append(b);
      continue;
    }
    // Switching game stops a running session (index.js onConfigChanged), so
    // it is refused here while recording rather than done by surprise.
    b.disabled = isCoaching;
    b.addEventListener('click', async () => {
      if (g.id === gameId || isCoaching) return;
      await window.occlara.setGame(g.id).catch(() => {});
    });
    host.append(b);
  }
  // One capsule, one thumb under the game picked (ui.css .seg-slide).
  if (typeof window.occlaraSeg === 'function') window.occlaraSeg(host);
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

/*
 * THE GAMES LEFT (8.7): one quiet line under Start, exactly as main writes
 * it (usage.js gamesLeft, "1 of 4 free games left"), and nothing when it has
 * nothing to say. Said here once for the whole window: Home, Invite and the
 * pages carry no copy. Hidden while a match is read: main holds a change
 * until the match ends, and the rail says nothing mid match.
 */
let gamesLine = '';
function paintGamesLeft(view) {
  if (view !== undefined) gamesLine = view && typeof view.gamesLeft === 'string' ? view.gamesLeft : '';
  const el = $('rail-games');
  if (!el) return;
  const text = isCoaching ? '' : gamesLine;
  if (el.textContent !== text) el.textContent = text;
  el.hidden = !text;
}
if (typeof window.occlara.getAccount === 'function') {
  Promise.resolve(window.occlara.getAccount()).then(paintGamesLeft).catch(() => {});
}
if (typeof window.occlara.onAccount === 'function') window.occlara.onAccount(paintGamesLeft);

/** The config, or what is already known when it cannot be read. */
function readConfig(fallback) {
  if (typeof window.occlara.getConfig !== 'function') return Promise.resolve(fallback);
  return window.occlara.getConfig().catch(() => fallback);
}

// ── The record controls ────────────────────────────────────────────────────
// What the Recording screen says, per game: how it is read and what happens
// after. League is recorded from the game's own local data, not the screen.
// NO READ CADENCE ON THE SCREEN (Progress v3): the row that said how often
// the game was being read mid match ("Reading your game every 1s in a live
// round") is gone. It was a live number about the match on the sealed screen.
const SEALED_FACTS = {
  valorant: { game: 'Read the way OBS reads it: the display only, never memory or files',
    after: "Checked against Riot's record once it is published, 90 seconds to four minutes after the end" },
  lol: { game: "Recorded from the game's own local data, never memory or files",
    after: 'Graded from what was recorded, the moment the game ends' },
};
function paintSealedFacts() {
  const f = SEALED_FACTS[gameId] || SEALED_FACTS.valorant;
  $('sealed-game').textContent = f.game;
  $('sealed-after').textContent = f.after;
}

/*
 * THE LIVE STATUS (Progress v3, the owner's choice and a deliberate reversal
 * of 8.0's rule, docs/claude/screen-silence.md). Mid a Valorant match the
 * Recording screen shows what main sends (PUSH_LIVE) and nothing else: the
 * map behind the card, the agent's portrait, the score, the round, and the
 * round tape the score has drawn, each only while its switch is on (main
 * leaves out what is off). The review is a locked ring until the match
 * ends. Textcontent only; the art is bundled files (agent-icons.js).
 * Nothing moves on it but the facts changing: no timer, no pulse.
 */
let live = null;
let liveEditing = false;
const LIVE_ITEMS = [['liveMap', 'Map'], ['liveAgent', 'Agent'], ['liveScore', 'Score'], ['liveRound', 'Round']];
const liveOn = (k) => !cfg || cfg[k] !== false;
const SVGNS = 'http://www.w3.org/2000/svg';
function svgEl(tag, attrs) {
  const n = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  return n;
}
/** One pip of the tape: a round won filled, lost a ring, unknown half, to come dashed. */
function pip(kind) {
  const svg = svgEl('svg', { width: 18, height: 18, viewBox: '0 0 18 18', class: 'pip ' + kind });
  if (kind === 'now' || kind === 'unknown') {
    svg.append(svgEl('circle', { cx: 9, cy: 9, r: 8.2, class: 'pip-shape' }), svgEl('path', { d: 'M9 0.8 A8.2 8.2 0 0 1 9 17.2 Z', class: 'pip-half' }));
  } else {
    // A round still to come is dashed: form before hue. The dash is an
    // attribute here, as the old mark's detector keeps it out of the sheet.
    const c = svgEl('circle', { cx: 9, cy: 9, r: kind === 'won' ? 8.6 : 8.2, class: 'pip-shape' });
    if (kind === 'next') c.setAttribute('stroke-dasharray', '2 3');
    svg.append(c);
  }
  return svg;
}
function paintRing() {
  const svg = $('live-dial');
  if (!svg || svg.childNodes.length) return;
  const n = 24, r = 75;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * 2 * Math.PI - Math.PI / 2;
    const c = Math.cos(a), si = Math.sin(a);
    svg.append(svgEl('line', { x1: (r + (r - 10) * c).toFixed(2), y1: (r + (r - 10) * si).toFixed(2),
      x2: (r + (r - 1.5) * c).toFixed(2), y2: (r + (r - 1.5) * si).toFixed(2), class: 'tick' }));
  }
}
function paintChips() {
  const host = $('live-chips');
  host.replaceChildren();
  for (const [key, label] of LIVE_ITEMS) {
    const on = liveOn(key);
    if (!on && !liveEditing) continue;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'live-chip chip-toggle';
    b.textContent = label;
    b.setAttribute('aria-pressed', String(on));
    b.disabled = !liveEditing;
    b.title = liveEditing ? (on ? `Hide the ${label.toLowerCase()} while recording` : `Show the ${label.toLowerCase()} while recording`) : '';
    b.addEventListener('click', async () => {
      if (!liveEditing) return;
      const next = !liveOn(key);
      cfg = { ...(cfg || {}), [key]: next };
      paintChips();
      await Promise.resolve(window.occlara.setLive(key, next)).catch(() => {});
    });
    host.append(b);
  }
  if (!host.childNodes.length) host.append(Object.assign(document.createElement('span'), { className: 'live-note', textContent: 'Nothing' }));
  $('live-choose').textContent = liveEditing ? 'Done' : 'Choose';
  $('live-choose').setAttribute('aria-expanded', String(liveEditing));
}
$('live-choose').addEventListener('click', () => { liveEditing = !liveEditing; paintChips(); });

function paintLive() {
  const box = $('live');
  const show = !!shell.sealed && !shell.held && gameId === 'valorant';
  box.hidden = !show;
  $('sealed-quiet').hidden = show;
  if (!show) { liveEditing = false; return; }
  paintRing();
  paintChips();
  const v = live && live.state === 'live' ? live : null;
  $('live-wait').hidden = !!v;
  $('live-main').hidden = !v;
  $('live-tape-block').hidden = !v || !Array.isArray(v.tape);
  const since = live && live.startedAt ? new Date(live.startedAt) : null;
  $('live-since').textContent = since ? `since ${since.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : '';
  $('live-mode').textContent = v && v.mode ? `Valorant \u00b7 ${v.mode === 'swiftplay' ? 'Swiftplay' : 'Standard'}` : 'Valorant';
  // The map behind the card.
  const art = $('live-art');
  const mapSrc = v && v.map && typeof window.occlara.mapArt === 'function' ? window.occlara.mapArt(v.map) : null;
  if ((art.dataset.src || '') !== (mapSrc || '')) {
    art.replaceChildren();
    art.dataset.src = mapSrc || '';
    if (mapSrc) {
      const img = document.createElement('img');
      img.src = mapSrc; img.alt = ''; img.className = 'live-art-img';
      img.addEventListener('error', () => img.remove());
      art.append(img);
    }
    art.append(Object.assign(document.createElement('div'), { className: 'live-art-scrim' }));
  }
  if (!v) return;
  // The agent's portrait.
  const face = $('live-face');
  const faceSrc = v.agent && typeof window.occlara.agentArt === 'function' ? window.occlara.agentArt(v.agent) : null;
  face.hidden = !faceSrc;
  if ((face.dataset.src || '') !== (faceSrc || '')) {
    face.replaceChildren();
    face.dataset.src = faceSrc || '';
    if (faceSrc) {
      const img = document.createElement('img');
      img.src = faceSrc; img.alt = v.agent;
      img.addEventListener('error', () => { face.replaceChildren(); face.hidden = true; });
      face.append(img);
    }
  }
  $('live-who').textContent = [v.agent, v.map].filter(Boolean).join(' on ');
  $('live-who').hidden = !v.agent && !v.map;
  const scored = typeof v.team === 'number' && typeof v.enemy === 'number';
  $('live-score').hidden = !scored;
  $('live-team').textContent = scored ? String(v.team) : '';
  $('live-enemy').textContent = scored ? String(v.enemy) : '';
  $('live-score').setAttribute('aria-label', scored ? `Score ${v.team} to ${v.enemy}` : 'Score');
  $('live-round-block').hidden = typeof v.round !== 'number';
  $('live-round').textContent = typeof v.round === 'number' ? String(v.round) : '';
  // The tape: one pip a round played, the round under way half, the rest to come dashed.
  const tape = $('live-tape');
  tape.replaceChildren();
  if (Array.isArray(v.tape)) {
    const played = v.tape.length;
    const total = Math.max(v.mode === 'swiftplay' ? 9 : 24, played + 1);
    for (const r of v.tape) tape.append(pip(r === 'W' ? 'won' : r === 'L' ? 'lost' : 'unknown'));
    tape.append(pip('now'));
    for (let i = played + 1; i < total; i++) tape.append(pip('next'));
    const won = v.tape.filter((r) => r === 'W').length, lost = v.tape.filter((r) => r === 'L').length;
    tape.setAttribute('aria-label', `${played} rounds played, ${won} won and ${lost} lost`);
  }
}
if (typeof window.occlara.onLive === 'function') window.occlara.onLive((v) => { live = v || null; paintLive(); });

/*
 * THE NOTICE LINE (8.3), in the top strip. The player asked for the text under
 * the record card's buttons gone, so the card says what it is doing by its
 * button, its pause icon and its live colour, and this line says only what
 * they cannot, and nothing at all otherwise: no "Press Start", no "Reading
 * your game every 1s". In order:
 *   - the licence ending, the notice main sent or the sentence below, since
 *     it is why Start is locked;
 *   - a notice from main (capture blocked, the server down, recording stopped
 *     for the session, a review saved in Matches), but never the
 *     "Recording..." a League session keeps up for its whole length
 *     (kind 'recording'): Stop and the live card already say it;
 *   - paused, in the player's language (panel.pausedLine), which only the
 *     pause button's icon says otherwise. Paused, nothing is read, so a notice
 *     about the reading (a read that failed, capture that was blocked, and
 *     the recorder's, recording stopped for the session, whose last words are
 *     that the coach still reads your screen up to once a second) is out of date and
 *     the paused line says what is true, until the resume puts it back; any
 *     other still wins.
 * Never anything about the match being played.
 */
const ENDED_LINE = 'Your subscription has ended. Open Settings to renew and enter your new key.';
const ABOUT_READING = ['recording', 'read-failed', 'capture', 'recorder'];
function noticeLine() {
  if (!licenseActive) return { text: (notice && notice.text) || ENDED_LINE, system: true };
  const kind = notice && notice.kind;
  const stale = isPaused && ABOUT_READING.includes(kind);
  if (notice && notice.text && kind !== 'recording' && !stale) return { text: notice.text, system: true };
  if (isCoaching && isPaused) return { text: tr('panel.pausedLine'), system: false };
  return null;
}
function paintNotice() {
  const line = noticeLine();
  // Never hidden, only emptied (index.html): the live region stays in place.
  noticeEl.classList.toggle('system', !!(line && line.system));
  // Written only when it changes: the state is pushed on every config write
  // and status tick, and a live region read the same notice out each time.
  const text = line ? line.text : '';
  if (noticeEl.textContent !== text) noticeEl.textContent = text;
  if (line) noticeEl.title = text;
  else noticeEl.removeAttribute('title');
}

function render() {
  // With no status word over the buttons, the button says the licence ended.
  toggleBtn.classList.toggle('ended', !licenseActive);
  if (!licenseActive) {
    toggleBtn.disabled = true;
    toggleBtn.classList.remove('active');
    toggleLbl.textContent = 'Subscription ended';
    toggleIco.innerHTML = '';
    pauseBtn.disabled = true;
    pauseBtn.innerHTML = ICO.pause;
    recEl.classList.remove('live');
    recEl.classList.add('recording');
  } else {
    toggleBtn.disabled = false;
    toggleLbl.textContent = tr(isCoaching ? 'panel.stop' : 'panel.start');
    toggleIco.innerHTML = isCoaching ? ICO.stop : ICO.play;
    toggleBtn.classList.toggle('active', isCoaching);
    recEl.classList.toggle('live', isCoaching && !isPaused);
    recEl.classList.toggle('recording', isCoaching);
    pauseBtn.disabled = !isCoaching;
    pauseBtn.innerHTML = isPaused ? ICO.play : ICO.pause;
  }
  paintSealedFacts();
  paintNotice();
}

toggleBtn.addEventListener('click', () => {
  if (isCoaching) window.occlara.stopCoaching();
  else window.occlara.startCoaching();
});
pauseBtn.addEventListener('click', () => window.occlara.pauseResume());

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
  if ('sounds' in s) soundsOn = s.sounds !== false;
  if (typeof s.licenseActive === 'boolean') licenseActive = s.licenseActive;
  $('learn').hidden = gameId !== 'lol';
  render();
  // Measured once the state is painted, as the card's ResizeObserver measures
  // it again after layout: the Learn entry above shows or goes with the game.
  placeMarker();
  soundCue();
  if (gameChanged || wasCoaching !== isCoaching) { paintGames(); paintAccount(); paintGamesLeft(); paintLive(); }
}

window.occlara.onState(applyState);
window.occlara.onStatus(({ status }) => {
  // Recording starts on the button alone, in every game: nothing opens over
  // the card to ask which agent is being played (8.4.4).
  if (status === 'coaching') {
    isCoaching = true; isPaused = false;
  } else if (status === 'paused') {
    isCoaching = true; isPaused = true;
  } else if (status === 'stopped' || status === 'idle') {
    isCoaching = false; isPaused = false;
  }
  render();
  soundCue();
  paintGames();
});
window.occlara.onShell((s) => {
  if (!s) return;
  // The seal coming on shuts the account menu (main shuts its view too,
  // main-window.js shutMenuForSeal): nothing of it stays over the Recording screen.
  const sealing = !!s.sealed && !shell.sealed;
  shell = s;
  if (sealing) setDrawer(false);
  paintNav();
});
window.occlara.onGame(async () => { cfg = await readConfig(cfg); paintGames(); paintAccount(); });

// ── The window ─────────────────────────────────────────────────────────────
$('w-min').addEventListener('click', () => window.occlara.windowAction('minimize'));
$('w-max').addEventListener('click', () => window.occlara.windowAction('maximize'));
$('w-close').addEventListener('click', () => window.occlara.windowAction('close'));
// The notice line is a hole in the strip's drag region, and no part of the
// strip's caption either: a double click on its text maximises nothing.
document.querySelector('.bar').addEventListener('dblclick', (e) => {
  if (!e.target.closest('.no-drag, .top-notice')) window.occlara.windowAction('maximize');
});

// ── Boot ───────────────────────────────────────────────────────────────────
(async () => {
  cfg = await readConfig(null);
  const [state, s] = await Promise.all([
    window.occlara.getState().catch(() => null),
    window.occlara.getShell().catch(() => null),
  ]);
  if (s) shell = s;
  if (typeof window.occlara.getLive === 'function') live = await Promise.resolve(window.occlara.getLive()).catch(() => null);
  applyState(state);
  paintGames();
  paintAccount();
  paintNav();
  // The avatar pops in once, as the window first opens (8.9.2), and never
  // when it opens on the Recording screen: nothing there moves but its arrival.
  if (!shell.sealed && !reducedMotion()) {
    const av = $('menu-btn');
    av.classList.add('pop-in');
    av.addEventListener('animationend', () => av.classList.remove('pop-in'), { once: true });
  }
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

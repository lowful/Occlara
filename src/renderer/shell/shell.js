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
  // 9.1: the app's one play mark, its centroid on the box's centre (moments.js
  // PLAY_PATH), at 19 (shell.css #pause svg.ico-play), which draws it the size
  // the old off centre triangle stood at 15.
  play: '<svg class="ico-play" viewBox="0 0 24 24" width="19" height="19" fill="currentColor" stroke="none"><path d="M10.43 6.98L17.18 10.78A1.4 1.4 0 0 1 17.18 13.22L10.43 17.02A1.4 1.4 0 0 1 8.34 15.8L8.34 8.2A1.4 1.4 0 0 1 10.43 6.98Z"/></svg>',
  stop: '<svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor" stroke="none"><rect x="6" y="6" width="12" height="12" rx="1.5"/></svg>',
  pause: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M9 5v14"/><path d="M15 5v14"/></svg>',
};
// The page icons. App authored markup, never user or model text.
const PAGE_ICO = {
  home: '<path d="M4 11l8-7 8 7v8a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z"/>',
  matches: '<path d="M9 6h11M9 12h11M9 18h11"/><path d="M4 6h.01M4 12h.01M4 18h.01"/>',
  patterns: '<path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
  // Practice: a target, for the drills worked on between matches.
  practice: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="0.8"/>',
  // The Trainer: a crosshair, for the aim and movement trainer in the page.
  trainer: '<circle cx="12" cy="12" r="7.5"/><path d="M12 2.5v5M12 16.5v5M2.5 12h5M16.5 12h5"/>',
  // Moments (8.7): a film frame, for the deaths and highlights compiled.
  moments: '<rect x="3.5" y="5" width="17" height="14" rx="2"/><path d="M3.5 9h17M3.5 15h17M8 5v14M16 5v14"/>',
  stats: '<path d="M5 20V11M12 20V4M19 20v-6"/>',
  coach: '<path d="M4 5h16v11H10l-6 4z"/>',
  // The two in the sidebar's foot, drawn in index.html and put back here
  // once the seal's lock goes.
  invite: '<circle cx="10" cy="8" r="3.5"/><path d="M3.5 20a6.5 6.5 0 0 1 13 0"/><path d="M19 8v6M16 11h6"/>',
  // Profile (8.8): a person in a ring.
  profile: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="10" r="3"/><path d="M6.8 18.3a6 6 0 0 1 10.4 0"/>',
  // Players (docs/claude/social.md): a magnifier, for the search.
  players: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5l5 5"/>',
  // Duos (docs/claude/duos.md): two players side by side.
  duos: '<circle cx="8.5" cy="9" r="3"/><circle cx="16" cy="9" r="3"/><path d="M3 19.5a5.5 5.5 0 0 1 11 0"/><path d="M13.6 14.3A5.5 5.5 0 0 1 21.5 19.5"/>',
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
const barEl = document.querySelector('.bar');

let isCoaching = false;
let isPaused = false;
let notice = null;
let licenseActive = true;
let gameId = 'valorant';
let shell = { page: 'home', shown: 'home', sealed: false, held: false, rec: false, maximized: false };
let cfg = null;
let liveRatingOn = false;   // the live rating's switch as main keeps it (state.live), for the waiting line alone
// On, but recording off or at 480p: main keeps the rating off (index.js
// liveSwitches, liveRatingNeeds), and the screen says why rather than
// promising a number that cannot come.
let liveRatingNeeds = false;

// ── The pages ──────────────────────────────────────────────────────────────
/*
 * ORBIT'S TOP BAR (27 Nov 2026): four links, Home, Matches, Practice and
 * Clips, each a group of pages (shell-nav.js TOP), so no page is lost:
 * Patterns and Stats are reached inside Matches, the Trainer inside Practice
 * (shared/subnav.js), Moments is Clips, and Ask Coach opens from a review and
 * from the account menu. A link is found by the page it lands on (data-page).
 */
// (Not `top`: a script's own `const top` collides with window.top and the
// whole script fails to run.)
const topLinks = typeof window.occlara.top === 'function' ? window.occlara.top()
  : window.occlara.pages().filter((x) => x.nav).map((p) => ({ id: p.id, label: p.label, pages: [p.id] }));
const navButtons = new Map();
/** The link a page sits under, by its id, or null for a page of the account menu. */
const linkOf = (page) => { const t = topLinks.find((x) => x.pages.includes(page)); return t ? t.id : null; };
for (const t of topLinks) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'nav-item';
  b.dataset.page = t.id;
  b.innerHTML = svg(PAGE_ICO[t.id] || '');
  const label = document.createElement('span');
  label.textContent = t.label;
  b.append(label);
  b.addEventListener('click', () => window.occlara.go(t.id));
  $('nav').append(b);
  navButtons.set(t.id, b);
}
// The foot's three pages (8.7: Invite, then 8.8: Profile, above Settings).
// They are in navButtons, so the seal locks them and the marker finds them
// like the rest.
navButtons.set('invite', $('nav-invite'));
navButtons.set('profile', $('nav-profile'));
// Players (docs/claude/social.md), the account menu's row beside Profile.
navButtons.set('players', $('nav-players'));
// Duos (docs/claude/duos.md), the account menu's row under Players.
navButtons.set('duos', $('nav-duos'));
navButtons.set('settings', $('nav-settings'));
// Ask Coach (Orbit): no link of its own in the bar, a row of the menu, locked
// by the seal like every page; a review's "Ask about this match" opens it too.
navButtons.set('coach', $('nav-coach'));
$('nav-coach').addEventListener('click', () => window.occlara.go('coach'));
// Report a problem: a page like the rest, so the seal locks it and the
// marker finds it, drawn as the quiet icon at the end of Profile's row.
navButtons.set('feedback', $('nav-feedback'));
$('nav-feedback').addEventListener('click', () => window.occlara.go('feedback'));
$('nav-invite').addEventListener('click', () => window.occlara.go('invite'));
$('nav-profile').addEventListener('click', () => window.occlara.go('profile'));
$('nav-players').addEventListener('click', () => window.occlara.go('players'));
$('nav-duos').addEventListener('click', () => window.occlara.go('duos'));
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
for (const id of ['nav-invite', 'nav-profile', 'nav-coach', 'nav-players', 'nav-duos', 'nav-settings', 'nav-feedback', 'discord', 'account']) {
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

/** The Recording screen is up: sealed (mid match, or held), or the Recording view Start opened (9.1). */
function onRecordingScreen() { return !!shell.sealed || !!shell.rec; }

/*
 * BACK TO THE RECORDING VIEW (9.1): recording between matches with a page
 * open, the bar's still dot and "Recording" take the player back to the
 * Recording screen's waiting state (main's windowAction 'recording', which
 * does nothing unless recording). Not drawn on that screen or mid match.
 */
function paintRecView() {
  const b = $('rec-back');
  if (b) b.hidden = !(isCoaching && licenseActive && !onRecordingScreen());
}
$('rec-back').addEventListener('click', () => window.occlara.windowAction('recording'));

function paintNav() {
  // Mid match the pages are locked. Held, the sidebar stays open: a page is
  // the player's own choice, and opening one lifts the seal.
  const locked = !!shell.sealed && !shell.held;
  // A page marks the link it sits under (the review and Stats under Matches,
  // the Trainer under Practice), or its own row of the menu; What's new marks
  // Settings, where it is reached from.
  const current = linkOf(shell.page) || (shell.page === 'whatsnew' ? 'settings' : shell.page);
  // THE RECORDING VIEW (9.1): Start shows the Recording screen at once, no
  // seal (shell-nav.js): the links stay open, none of them current.
  const screen = onRecordingScreen();
  for (const [id, b] of navButtons) {
    if (current === id && !screen) b.setAttribute('aria-current', 'page');
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
  $('sealed').hidden = !screen;
  const text = shell.held ? SEALED_TEXT.held : SEALED_TEXT.live;
  $('sealed').classList.toggle('held', !!shell.held);
  $('sealed').setAttribute('aria-label', text.title);
  $('sealed-title').textContent = text.title;
  $('sealed-sub').textContent = text.sub;
  $('sealed-facts').hidden = !!shell.held;
  $('quiet-stop').hidden = !!shell.held || !isCoaching;
  paintLive();
  // The bar's modes (Progress v3): on Home, not recording, Start is the
  // page's own strip; mid match Stop is the large capsule. Start leaving or
  // coming back gives its room in the bar up or takes it, the controls beside
  // it gliding (9.1, flipBar).
  const app = document.querySelector('.app');
  const homeNow = shell.page === 'home' && !screen;
  if (app.classList.contains('home-page') !== homeNow) flipBar(() => app.classList.toggle('home-page', homeNow));
  app.classList.toggle('sealed-live', !!shell.sealed && !shell.held);
  app.classList.toggle('is-sealed', !!shell.sealed);
  const recWas = app.classList.contains('rec-view');
  app.classList.toggle('rec-view', !!shell.rec && !shell.sealed);
  // START HANDS THE KEYBOARD TO THE SCREEN (9.1): main focuses this document
  // as the Recording view comes up in a window already in front
  // (main-window.js setRecordingView), and the screen itself takes the focus,
  // so the next Tab is Stop, not a control of the page now hidden. The
  // screen, not Stop: a press of Enter must never stop what it just started,
  // and no ring is drawn that the mouse did not ask for.
  if (!recWas && app.classList.contains('rec-view') && typeof $('sealed').focus === 'function') {
    try { $('sealed').focus({ preventScroll: true }); } catch { /* not focusable here */ }
  }
  paintRecView();
  // What's new and the updater go from the bar on the Recording screen and
  // come back after it (9.1).
  paintNews();
  paintUpdate();
  paintSky();
  $('w-max').title = shell.maximized ? 'Restore' : 'Maximize';
  $('w-max').setAttribute('aria-label', $('w-max').title);
  placeMarker();
}

/*
 * THE CURRENT LINK'S DOT (Orbit): one 4px dot under the links, moved to the
 * current one, so going from Home to Clips glides it along the bar instead of
 * one link's mark going out as another's comes on. It glides only when the
 * link changes; appearing (the seal lifting) or following the layout (the
 * window resized, the game picker shown) it is put there at once. With no
 * link current (a page of the menu, or mid match) it fades out.
 */
const marker = $('nav-marker');
const DOT = 4;
let markerOn = null;
let markerAt = { x: 0, y: 0 };
let markerGlide = null;
const reducedMotion = () => typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
function placeMarker() {
  // A page of the menu (Settings, Profile and the rest) marks its own row
  // there, and the dot goes.
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
  // THE DOT GLIDES, by transform alone, on the smooth spring over
  // --dur-nav (420ms). It is put where it ends at once and played from where
  // it was; slid again before the last glide ended, from where it is now.
  // Asked for less motion, or appearing, it is simply there.
  let from = slide ? { x: markerAt.x, y: markerAt.y } : null;
  if (from && markerGlide && typeof DOMMatrix === 'function') {
    try {
      const m = new DOMMatrix(getComputedStyle(marker).transform);
      from = { x: m.e, y: m.f };
    } catch (e) { /* from where it was set */ }
  }
  // Centred under the word, 3px above the link's foot.
  const x = Math.round(b.offsetLeft + b.offsetWidth / 2 - DOT / 2);
  const y = Math.round(top + b.offsetHeight - DOT - 3);
  marker.style.transform = `translate(${x}px, ${y}px)`;
  marker.classList.add('on');
  markerOn = id;
  const moved = x !== markerAt.x || y !== markerAt.y;
  markerAt = { x, y };
  // The same link measured again mid glide (a state push, the fonts) leaves
  // the glide alone; a new place, or a new slide, ends it.
  if (markerGlide && (slide || moved)) { markerGlide.cancel(); markerGlide = null; }
  if (from && typeof marker.animate === 'function' && !reducedMotion()) {
    const dur = parseFloat(cssVar('--dur-nav')) || 420;
    const easing = cssVar('--spring-smooth') || 'cubic-bezier(0.16, 1, 0.3, 1)';
    try {
      markerGlide = marker.animate([
        { transform: `translate(${from.x}px, ${from.y}px)` },
        { transform: `translate(${x}px, ${y}px)` },
      ], { duration: dur, easing });
    } catch (e) {
      // An engine without linear() easing takes the enter curve instead.
      markerGlide = marker.animate([
        { transform: `translate(${from.x}px, ${from.y}px)` },
        { transform: `translate(${x}px, ${y}px)` },
      ], { duration: dur, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' });
    }
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

/*
 * PLAYERS (docs/claude/social.md): its row in the account menu shows only
 * once the server says player search is open (social-001's SQL has run).
 * Asked at boot, on an account change, when the profile moves and when the
 * seal lifts; main answers null mid match, and the row is kept as it was.
 */
async function paintPlayers() {
  if (typeof window.occlara.socialLive !== 'function') return;
  const s = await Promise.resolve(window.occlara.socialLive()).catch(() => null);
  if (!s) return;
  $('nav-players').hidden = s.live !== true;
}
if (typeof window.occlara.onAccount === 'function') window.occlara.onAccount(() => paintPlayers());
if (typeof window.occlara.onSocial === 'function') window.occlara.onSocial(() => paintPlayers());

/*
 * DUOS (docs/claude/duos.md): its row shows only once the server says Duos is
 * open (SOCIAL_DUOS_ON and its SQL), asked when Players is; main answers null
 * mid match, and the row is kept as it was. Off, there is no trace of Duos.
 */
async function paintDuos() {
  if (typeof window.occlara.duosLive !== 'function') return;
  const s = await Promise.resolve(window.occlara.duosLive()).catch(() => null);
  if (!s) return;
  $('nav-duos').hidden = s.duos !== true;
}
if (typeof window.occlara.onAccount === 'function') window.occlara.onAccount(() => paintDuos());
if (typeof window.occlara.onSocial === 'function') window.occlara.onSocial(() => paintDuos());

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
 * of 8.0's rule, docs/claude/screen-silence.md), ORBIT'S RECORDING SCREEN.
 * Mid a Valorant match it shows what main sends (PUSH_LIVE) and nothing
 * else: since when it records, the agent and the map, the score, the round
 * and the round tape the score has drawn, each only while its switch is on
 * (main leaves out what is off), then Stop and the line that the review opens
 * when the match ends. Textcontent only; the agent's face is a bundled file
 * (agent-icons.js). Nothing moves on it but its arrival and the facts
 * changing: no timer, no pulse.
 */
let live = null;
let ratingShown = null;   // the live rating last drawn (paintRating), so only a change moves
let liveEditing = false;
const LIVE_ITEMS = [['liveMap', 'Map'], ['liveAgent', 'Agent'], ['liveScore', 'Score'], ['liveRound', 'Round']];
const liveOn = (k) => !cfg || cfg[k] !== false;
/** One bar of the tape: a round won, lost, of unknown order, under way (now) or to come (next). */
function pip(kind, half) {
  const i = document.createElement('i');
  i.className = 'pip ' + kind + (half ? ' half' : '');
  return i;
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
  // Mid a match (sealed, not held), or on the Recording view Start opened
  // before one (9.1): the same screen, its waiting state until the match.
  const show = ((!!shell.sealed && !shell.held) || (!!shell.rec && !shell.sealed)) && gameId === 'valorant';
  box.hidden = !show;
  $('sealed-quiet').hidden = show;
  if (!show) { liveEditing = false; paintRating(null); return; }
  paintChips();
  const v = live && live.state === 'live' ? live : null;
  // Paused, the head says so: nothing is read or recorded until the resume.
  // The time beside it is when recording began, so paused it goes: "Paused
  // since 6:33 AM" would name the start as the pause.
  document.querySelector('#live .live-word').textContent = isPaused ? 'Paused' : 'Recording';
  $('live-wait').hidden = !!v;
  $('live-wait-lr').hidden = !!v || !liveRatingOn;
  $('live-wait-lr-text').textContent = liveRatingNeeds ? 'Live rating on, needs recording at 720p or 1080p' : 'Live rating on. It shows here once the match starts.';
  $('live-main').hidden = !v;
  $('live-tape-block').hidden = !v || (!Array.isArray(v.tape) && typeof v.round !== 'number');
  const since = live && live.startedAt && !isPaused ? new Date(live.startedAt) : null;
  $('live-since').textContent = since ? `since ${since.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : '';
  $('live-mode').textContent = v && v.mode ? (v.mode === 'swiftplay' ? 'Swiftplay' : 'Standard') : '';
  paintRating(v ? v.rating : null, !!v && liveRatingOn && liveRatingNeeds);
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
  // "Jett on Abyss": the agent and the map in the ink, the word between them grey.
  const who = $('live-who');
  who.replaceChildren();
  [v.agent, v.map].filter(Boolean).forEach((word, i) => {
    if (i) who.append(document.createTextNode(' on '));
    who.append(Object.assign(document.createElement('b'), { textContent: word }));
  });
  who.hidden = !v.agent && !v.map;
  const scored = typeof v.team === 'number' && typeof v.enemy === 'number';
  $('live-score').hidden = !scored;
  $('live-team').textContent = scored ? String(v.team) : '';
  $('live-enemy').textContent = scored ? String(v.enemy) : '';
  $('live-score').setAttribute('aria-label', scored ? `Score ${v.team} to ${v.enemy}` : 'Score');
  $('live-round-block').hidden = typeof v.round !== 'number';
  $('live-round').textContent = typeof v.round === 'number' ? String(v.round) : '';
  // The tape: one bar a round played, the round under way outlined, the rest
  // to come empty, and the halves parted (after 12 rounds, 4 in Swiftplay).
  const tape = $('live-tape');
  tape.replaceChildren();
  tape.hidden = !Array.isArray(v.tape);
  if (Array.isArray(v.tape)) {
    const played = v.tape.length;
    const swift = v.mode === 'swiftplay';
    const total = Math.max(swift ? 9 : 24, played + 1);
    const half = swift ? 4 : 12;
    let n = 0;
    const add = (kind) => { tape.append(pip(kind, n === half)); n++; };
    for (const r of v.tape) add(r === 'W' ? 'won' : r === 'L' ? 'lost' : 'unknown');
    add('now');
    for (let i = played + 1; i < total; i++) add('next');
    const won = v.tape.filter((r) => r === 'W').length, lost = v.tape.filter((r) => r === 'L').length;
    tape.setAttribute('aria-label', `${played} rounds played, ${won} won and ${lost} lost`);
  }
}
/*
 * THE LIVE RATING (the owner's second exception, 2026-11-26,
 * docs/claude/screen-silence.md "The live rating"): drawn only from
 * PUSH_LIVE's `rating`, which main sends only with its switch on. The number
 * in the review replay's own badge (shared/rating-badge.js), the last move
 * and the engine's label, the line so far. The count and the move run once
 * when the value changes; a repaint of the same value moves nothing.
 */
function paintRating(r, needs) {
  const box = $('live-rating');
  if (!box) return;
  // Main says the kill feed is not being read: that line, and no number.
  // On with recording off or at 480p, main sends no rating at all: the same
  // row says why, in Home's words, rather than the screen saying nothing.
  const off = $('live-rating-off');
  const blind = !!(r && typeof r === 'object' && r.reading === false);
  const unsent = !!needs && !(r && typeof r === 'object');
  if (off) off.hidden = !(blind || unsent);
  if ($('lr-off-text')) $('lr-off-text').textContent = unsent ? 'Needs recording at 720p or 1080p' : 'Not reading the kill feed';
  const ok = !blind && r && typeof r === 'object' && typeof r.value === 'number' && Number.isFinite(r.value) && !!window.RatingBadge;
  box.hidden = !ok;
  // The column draws in to make room for the row (shell.css .live-status.rated).
  $('live').classList.toggle('rated', ok || blind || unsent);
  if (!ok) { ratingShown = null; return; }
  const changed = ratingShown !== null && r.value !== ratingShown;
  window.RatingBadge.setNumber($('lr-num'), $('lr-badge'), r.value);
  // The tier on the whole row too, so the glass tile's rim and the small dot
  // beside "Match rating" read the same --rt-tier (shell.css, Orbit glass).
  window.RatingBadge.setTier(box, window.RatingBadge.tierOf(r.value));
  const last = r.last && typeof r.last === 'object' ? r.last : null;
  if (changed || ratingShown === null) window.RatingBadge.setDelta($('lr-delta'), changed && last ? String(last.delta || '') : '');
  $('lr-label').textContent = last && typeof last.label === 'string' ? last.label : 'No move yet';
  ratingShown = r.value;
  const vals = (Array.isArray(r.line) ? r.line : []).filter((x) => typeof x === 'number' && Number.isFinite(x));
  const path = $('lr-path');
  if (vals.length < 2) { path.setAttribute('d', ''); return; }
  const lo = Math.min(5.5, ...vals) - 0.2;
  const hi = Math.max(6.5, ...vals) + 0.2;
  const y = (x) => (48 - ((x - lo) / (hi - lo)) * 48).toFixed(1);
  path.setAttribute('d', vals.map((x, i) => `${i ? 'L' : 'M'}${((i / (vals.length - 1)) * 200).toFixed(1)} ${y(x)}`).join(' '));
  // 6.0 dashed: the dash an attribute, as the old mark's detector keeps it out of the sheet.
  $('lr-base').setAttribute('stroke-dasharray', '3 4');
  $('lr-base').setAttribute('y1', y(6));
  $('lr-base').setAttribute('y2', y(6));
}
// The match beginning is the screen's one change of state: the waiting line
// gives way to the facts through a view transition (the line fading out, the
// facts rising in); every later push is the facts changing in place.
if (typeof window.occlara.onLive === 'function') {
  window.occlara.onLive((v) => {
    const was = live && live.state;
    live = v || null;
    const now = live && live.state;
    if (was === 'waiting' && now === 'live' && window.Motion && !$('live').hidden) window.Motion.transition(paintLive);
    else paintLive();
  });
}
// Stop, on the Recording screen: the same Stop as the bar's.
$('live-stop').addEventListener('click', () => window.occlara.stopCoaching());
$('quiet-stop').addEventListener('click', () => window.occlara.stopCoaching());

/*
 * THE SKY behind the bar on Home and behind the Recording screen (shared/sky.js):
 * the stars drawn for the window's size, again only when it changes, and the
 * moon put up once. The moon is drawn (a few hundred ms of arithmetic) only
 * outside a match; mid match only an image already kept is put up.
 */
let skyAt = '';
function paintSky() {
  const sky = window.OcclaraSky;
  if (!sky) return;
  if (!(onRecordingScreen() || shell.page === 'home')) return;
  const key = `${window.innerWidth}x${window.innerHeight}`;
  if (skyAt !== key) { skyAt = key; sky.stars($('sky-stars')); }
  if (!shell.sealed || sky.hasMoon()) sky.moon($('sky-moon'));
}
let skyResize = 0;
window.addEventListener('resize', () => { clearTimeout(skyResize); skyResize = setTimeout(paintSky, 150); });

/*
 * THE BAR'S RIGHT GROUP MOVES AS ONE (9.1). Start leaving for Home's own, a
 * pill arriving or going: the controls beside it glide to their new places
 * on the smooth spring (measured, changed, then played from where they were,
 * by a transform alone) instead of jumping. Asked for less motion, or on the
 * Recording screen, where nothing moves but its arrival, they are simply there.
 */
const barEnd = document.querySelector('.bar-end');
// Not before the bar's first paint: the window opening is no move.
let barSettled = false;
const laidOut = (el) => !el.hidden && (typeof el.getClientRects !== 'function' || el.getClientRects().length > 0);
function flipBar(change) {
  const kids = barEnd ? [...barEnd.children] : [];
  const canPlay = barSettled && kids.length > 0 && typeof kids[0].animate === 'function' && !reducedMotion() && !onRecordingScreen();
  const before = new Map();
  if (canPlay) for (const el of kids) if (laidOut(el)) before.set(el, el.getBoundingClientRect().left);
  change();
  fitBar();
  if (!canPlay || !before.size) return;
  const dur = parseFloat(cssVar('--dur-nav')) || 420;
  const easing = cssVar('--spring-smooth') || 'cubic-bezier(0.16, 1, 0.3, 1)';
  for (const [el, was] of before) {
    if (!laidOut(el)) continue;
    const dx = was - el.getBoundingClientRect().left;
    if (!Number.isFinite(dx) || Math.abs(dx) < 0.5) continue;
    const frames = [{ transform: `translateX(${dx}px)` }, { transform: 'translateX(0)' }];
    try { el.animate(frames, { duration: dur, easing }); } catch (e) {
      // An engine without linear() easing takes the enter curve instead.
      el.animate(frames, { duration: dur, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' });
    }
  }
}
/*
 * An item of the right group shown or taken away: it rises in once out of a
 * small blur (shell.css barIn) and goes in 160ms, the others gliding into the
 * room it leaves. `quiet` (the Recording screen coming up) takes it away at
 * once. Shown again while it is still going, it simply stays.
 */
const goingOut = new Map();
function showBarItem(el, show, quiet) {
  const going = goingOut.get(el);
  if (show) {
    if (going) { goingOut.delete(el); going.cancel(); }
    if (!el.hidden) return;
    flipBar(() => { el.hidden = false; });
    if (!quiet && !reducedMotion()) {
      el.classList.remove('bar-in');
      void el.offsetWidth;
      el.classList.add('bar-in');
      el.addEventListener('animationend', () => el.classList.remove('bar-in'), { once: true });
    }
    return;
  }
  if (el.hidden) return;
  if (quiet || reducedMotion() || typeof el.animate !== 'function') {
    if (going) { goingOut.delete(el); going.cancel(); }
    flipBar(() => { el.hidden = true; });
    return;
  }
  if (going) return;
  const a = el.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(0.94)' }],
    { duration: 160, easing: 'cubic-bezier(0.23, 1, 0.32, 1)', fill: 'forwards' });
  goingOut.set(el, a);
  a.onfinish = () => {
    if (goingOut.get(el) !== a) return;
    goingOut.delete(el);
    flipBar(() => { el.hidden = true; });
    a.cancel();
  };
}
/** Nothing of the app's own news on the bar while recording or on the Recording screen. */
const barQuiet = () => isCoaching || onRecordingScreen();

/*
 * WHAT'S NEW, IN THE BAR (9.1, the owner's item 2; Home's update line until
 * then, faint and floating on the moon). On the first launch after an update,
 * main's { version, text, link } (index.js changelogIpc, changelog.js
 * noticeFor): a small pill on the bar's own glass, "What's new in 9.1.0",
 * main's sentence whole in its title, opening What's new, which takes it away
 * (main pushes null). Main answers null while recording, mid match or sealed
 * and pushes it once the seal lifts; the bar hides it while recording too. It
 * counts as seen (CHANGELOG_SEEN, so the next launch is quiet) only once it is
 * on screen: shown with the window visible and in front. A window made hidden
 * still reads visible on its first load (Electron's paintWhenInitiallyHidden),
 * so being in front is what says the player can see it.
 */
let news = null;
let newsSeenFor = '';
function paintNews() {
  const el = $('news');
  if (!el) return;
  const line = news && typeof news === 'object' && typeof news.text === 'string' && news.text ? news : null;
  const quiet = barQuiet();
  if (!line || quiet) { showBarItem(el, false, quiet); return; }
  const ver = typeof line.version === 'string' && /^\d+\.\d+\.\d+$/.test(line.version) ? line.version : '';
  $('news-ver').textContent = ver ? ` in ${ver}` : '';
  el.title = `${line.text} ${line.link || "See what's new"}`.trim();
  showBarItem(el, true);
  newsOnScreen();
}
function newsOnScreen() {
  if (!news || typeof news.version !== 'string' || newsSeenFor === news.version) return;
  // Not drawn is not seen: hidden, or given way to a notice (shell.css).
  if ($('news').hidden || !laidOut($('news')) || document.visibilityState === 'hidden') return;
  if (typeof document.hasFocus === 'function' && !document.hasFocus()) return;
  newsSeenFor = news.version;
  if (typeof window.occlara.newsSeen === 'function') window.occlara.newsSeen(news.version);
}
document.addEventListener('visibilitychange', newsOnScreen);
window.addEventListener('focus', newsOnScreen);
$('news').addEventListener('click', () => { if (typeof window.occlara.openWhatsNew === 'function') window.occlara.openWhatsNew(); });
// A push is newer than an answer asked for before it.
let newsPushes = 0;
if (typeof window.occlara.onNews === 'function') window.occlara.onNews((n) => { newsPushes++; news = n || null; paintNews(); });
function askNews() {
  if (typeof window.occlara.getNews !== 'function') return;
  const at = newsPushes;
  Promise.resolve(window.occlara.getNews()).then((n) => { if (at === newsPushes) { news = n || null; paintNews(); } }).catch(() => {});
}

/*
 * THE UPDATER IN THE BAR (9.1, the owner's item 22; a native question until
 * then). Main's view (updater.js view, PUSH_UPDATE): null, or
 *   downloading  the round green control, its arrow and the download's
 *                progress drawn round it (a quarter turning while main has
 *                no percent yet); nothing to press, its title says it
 *   ready        "Restart to update", which asks main to install and restart
 *                (UPDATE_INSTALL); main installs only while the player is not
 *                playing, and never by itself
 *   installing   pressed, on its way out: "Restarting"
 * Never on the bar while recording or on the Recording screen (main sends
 * null while the player is playing, and the bar hides it besides).
 */
let update = null;
let updSaid = '';
const UPD_STATES = ['downloading', 'ready', 'installing'];
function updWords(u, pct) {
  const name = u.version ? `Occlara ${u.version}` : 'The update';
  if (u.state === 'downloading') return pct === null ? `Downloading ${name}` : `Downloading ${name}, ${pct}%`;
  if (u.state === 'installing') return `Restarting to install ${name}`;
  return `${name} is ready. Restart to update.`;
}
function paintUpdate() {
  const el = $('upd');
  if (!el) return;
  const u = update && typeof update === 'object' && UPD_STATES.includes(update.state) ? update : null;
  const quiet = barQuiet();
  if (!u || quiet) { showBarItem(el, false, quiet); return; }
  const pct = u.state === 'downloading' && typeof u.percent === 'number' && Number.isFinite(u.percent)
    ? Math.max(0, Math.min(100, Math.round(u.percent))) : null;
  for (const s of UPD_STATES) el.classList.toggle(s, u.state === s);
  el.classList.toggle('unsure', u.state === 'downloading' && pct === null);
  el.style.setProperty('--p', String(pct === null ? 0 : pct));
  const label = u.state === 'installing' ? 'Restarting' : 'Restart to update';
  if ($('upd-label').textContent !== label) $('upd-label').textContent = label;
  const words = updWords(u, pct);
  el.title = words;
  el.setAttribute('aria-label', words);
  el.setAttribute('aria-disabled', String(u.state !== 'ready'));
  // Said once a version as it becomes ready; the percent is never read out.
  const key = `${u.state}:${u.version || ''}`;
  if (u.state === 'ready' && updSaid !== key) { updSaid = key; $('upd-say').textContent = `${u.version ? `Occlara ${u.version}` : 'An update'} is ready to install.`; }
  showBarItem(el, true);
}
$('upd').addEventListener('click', async () => {
  if (!update || update.state !== 'ready' || barQuiet() || typeof window.occlara.installUpdate !== 'function') return;
  const r = await Promise.resolve(window.occlara.installUpdate()).catch(() => null);
  // Pressed and taken: it says so at once, as main restarts the app.
  if (r && r.ok === true && update && update.state === 'ready') { update = { ...update, state: 'installing' }; paintUpdate(); }
});
let updatePushes = 0;
if (typeof window.occlara.onUpdate === 'function') window.occlara.onUpdate((u) => { updatePushes++; update = u || null; paintUpdate(); });
function askUpdate() {
  if (typeof window.occlara.getUpdate !== 'function') return;
  const at = updatePushes;
  Promise.resolve(window.occlara.getUpdate()).then((u) => { if (at === updatePushes) { update = u || null; paintUpdate(); } }).catch(() => {});
}

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
  // A notice comes first: the bar's pills draw in to give it room (shell.css
  // "The bar gives way"), and What's new, waiting under 1040px, counts as
  // seen only once it is drawn again.
  const had = barEl.classList.contains('has-notice');
  barEl.classList.toggle('has-notice', !!text);
  if (had !== !!text) { fitBar(); newsOnScreen(); }
}

/*
 * THE BAR NEVER RUNS PAST THE WINDOW (9.1). shell.css lets the right group
 * give way as it fills (a notice first, the picker while recording, the
 * ended button under 1040px); should it still run past the window's edge (a
 * longer word in another language, a control yet to come), the bar is marked
 * tight and every pill draws in at once, so the window's buttons are never
 * cut. Measured by layout alone (offsets, not the glide's transforms).
 * One smaller step first (9.1): under 1040px What's new carries the word
 * "New" beside its spark, and where that alone is what runs past (the bar's
 * Start on a page at 960, the updater's words beside it) the bar is marked
 * snug and the word goes, the spark staying, before anything else gives way.
 */
function fitBar() {
  const wc = barEl.querySelector('.win-controls');
  if (!wc || typeof wc.offsetLeft !== 'number' || !barEl.clientWidth) return;
  const was = barEl.classList.contains('tight');
  barEl.classList.remove('tight', 'snug');
  const over = () => wc.offsetLeft + wc.offsetWidth > barEl.clientWidth + 0.5;
  if (over()) barEl.classList.add('snug');
  const tight = over();
  if (tight) barEl.classList.add('tight');
  if (was !== tight) newsOnScreen();
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
    // THE RECORD ICON is drawn by ui.css (.rec-ico): a ring and its dot for
    // Start, the dot squared off into the stop glyph for Stop (.active).
    toggleIco.innerHTML = '';
    toggleBtn.classList.toggle('active', isCoaching);
    recEl.classList.toggle('live', isCoaching && !isPaused);
    recEl.classList.toggle('recording', isCoaching);
    pauseBtn.disabled = !isCoaching;
    pauseBtn.innerHTML = isPaused ? ICO.play : ICO.pause;
  }
  // Recording, the game cannot be switched: the picker gives its room back
  // (shell.css "The bar gives way").
  const app = document.querySelector('.app');
  if (app) app.classList.toggle('is-recording', isCoaching);
  paintSealedFacts();
  paintNotice();
  paintRecView();
  fitBar();
}
window.addEventListener('resize', () => fitBar());

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
  // The Recording screen's switches as main keeps them (8.10.3), so a change
  // made in Settings is what Choose shows.
  if (s.live && typeof s.live === 'object' && cfg) {
    const live = {};
    for (const k of ['liveMap', 'liveAgent', 'liveScore', 'liveRound']) if (typeof s.live[k] === 'boolean') live[k] = s.live[k];
    cfg = { ...cfg, ...live };
  }
  const ratingWas = `${liveRatingOn}:${liveRatingNeeds}`;
  if (s.live && typeof s.live === 'object' && typeof s.live.liveRating === 'boolean') liveRatingOn = s.live.liveRating;
  if (s.live && typeof s.live === 'object') liveRatingNeeds = s.live.liveRatingNeeds === true;
  const pausedWas = isPaused;
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
  if (gameChanged || wasCoaching !== isCoaching) { paintGames(); paintAccount(); paintGamesLeft(); paintNav(); }
  else if (pausedWas !== isPaused || ratingWas !== `${liveRatingOn}:${liveRatingNeeds}`) paintLive();
}

// The flag key was heard (8.13): one tick, the same for every press, and
// nothing drawn. The one sound of a match (docs/claude/screen-silence.md).
window.occlara.onFlagTick(() => {
  if (soundsOn && window.occlaraSfx) window.occlaraSfx.play('flag', SFX_VOLUME);
});

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
  // The Recording screen's head (Recording or Paused) and its Stop follow.
  paintNav();
});
window.occlara.onShell((s) => {
  if (!s) return;
  // The seal coming on shuts the account menu (main shuts its view too,
  // main-window.js shutMenuForSeal): nothing of it stays over the Recording screen.
  const sealing = !!s.sealed && !shell.sealed;
  const unsealing = !s.sealed && !!shell.sealed;
  shell = s;
  if (unsealing) { paintPlayers(); paintDuos(); }
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
  paintPlayers();
  paintDuos();
  // What's new and the updater as main has them now (9.1).
  askNews();
  askUpdate();
  // From the next frame on, what moves in the bar's right group glides.
  requestAnimationFrame(() => { barSettled = true; });
  // The avatar pops in once, as the window first opens (8.9.2), and never
  // when it opens on the Recording screen: nothing there moves but its arrival.
  if (!shell.sealed && !reducedMotion()) {
    const av = $('menu-btn');
    av.classList.add('pop-in');
    av.addEventListener('animationend', () => av.classList.remove('pop-in'), { once: true });
  }
  // Onest arriving can move the links by a pixel or two.
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(placeMarker).catch(() => {});
  // The moon drawn and kept while the app is idle, outside a match, so the
  // Recording screen and Home only ever put up an image.
  if (!shell.sealed && window.OcclaraSky) window.OcclaraSky.moon($('sky-moon'));
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

'use strict';

/**
 * The one window's page table and navigation state (src/shared/shell-nav.js),
 * the way it moves from page to page (8.2: which direction, and the order of
 * a switch, the seal and a page that never answers included, and a staged
 * page waiting on while the window cannot be seen), and the registry reaching
 * page views as well as windows. Then main-window.js itself on stand-in views:
 * the window's own state deciding whether it can be seen, its show, restore
 * and focus starting a staged page's wait again, and a page loading again
 * ignoring the ready of the document it replaces. check:mainwindow carries the
 * same switch out on real views.
 *
 * Run: npm run test:shellnav
 */

const fs = require('fs');
const path = require('path');
const { PAGES, pageOf, createNav, direction, createMotion, READY_MS, LOAD_MS } = require('../src/shared/shell-nav');
const registry = require('../src/main/windows/registry');

let fails = 0;
let checks = 0;
const ok = (cond, what) => {
  checks++;
  if (!cond) { fails++; console.log(`FAIL  ${what}`); } else console.log(`ok    ${what}`);
};

// ── The page table ────────────────────────────────────────────────────────
const ids = PAGES.map((p) => p.id);
ok(new Set(ids).size === ids.length, `page ids are unique (${ids.join(', ')})`);
ok(PAGES.every((p) => fs.existsSync(path.join(__dirname, '..', 'src', 'renderer', p.surface, 'index.html'))),
  'every page loads a surface that exists');
ok(PAGES.every((p) => fs.existsSync(path.join(__dirname, '..', 'src', 'preload', p.preload))),
  'and a preload that exists');
ok(pageOf('matches') && pageOf('matches').query.section === 'list'
  && pageOf('patterns').surface === 'matches' && pageOf('breakdown').query.section === 'breakdown',
  'Matches, Patterns and Breakdown are three sections of the library surface');
ok(!pageOf('nope'), 'an unknown page is none');
ok(PAGES.filter((p) => p.nav).map((p) => p.id).join() === 'home,matches,patterns,breakdown,stats,coach',
  'the sidebar lists Home, Matches, Patterns, Breakdown, Stats and Ask Coach, in that order');

// ── Navigation, and the seal ──────────────────────────────────────────────
{
  const nav = createNav();
  let s = nav.state();
  ok(s.page === 'home' && s.shown === 'home' && !s.sealed, 'it opens on Home');
  s = nav.go('matches');
  ok(s.page === 'matches' && s.shown === 'matches', 'going to Matches shows Matches');
  s = nav.go('nope');
  ok(s.page === 'matches', 'an unknown page changes nothing');
  s = nav.seal(true);
  ok(s.sealed && s.shown === null && s.page === 'matches', 'sealed, no page shows');
  s = nav.go('review');
  ok(s.shown === null && s.page === 'review', 'and going to the review while sealed only remembers it');
  s = nav.seal(false);
  ok(!s.sealed && s.shown === 'review', 'unsealed, the page it was sent to shows');
}

// ── Which way the window moves (8.2) ──────────────────────────────────────
ok(direction('home', 'matches') === 'forward' && direction('matches', 'breakdown') === 'forward'
  && direction('coach', 'settings') === 'forward', 'down the sidebar is forward, Settings at its foot last');
ok(direction('stats', 'home') === 'back' && direction('settings', 'coach') === 'back' && direction('breakdown', 'patterns') === 'back',
  'up it is back');
ok(PAGES.filter((p) => p.id !== 'review').every((p) => direction(p.id, 'review') === 'forward' && direction('review', p.id) === 'back'),
  'the review is deeper than every page: forward into it from anywhere, back out of it to anywhere');
ok(direction(null, 'home') === 'none' && direction('home', null) === 'none' && direction(null, null) === 'none'
  && direction('stats', 'stats') === 'none' && direction('nope', 'home') === 'none',
  'no page at either end, or the same page, is no direction');

// ── Moving between pages: the order of it (8.2) ──────────────────────────
// A fake of what main-window.js does to its views, logging every effect in
// order, a clock the test moves by hand, and whether the window can be seen
// (see(false): hidden, minimised or behind the game).
function rig() {
  const log = [];
  const shown = new Set();
  const dead = new Set();
  let now = 0;
  let seq = 0;
  let seeable = true;
  const timers = new Map();
  const fx = {
    under: (to, from) => { log.push(`under ${to}<${from}`); shown.add(to); },
    stage: (to) => { log.push(`stage ${to}`); shown.add(to); },
    place: (to) => log.push(`place ${to}`),
    hide: (id) => { log.push(`hide ${id}`); shown.delete(id); },
    keep: (id) => log.push(`keep ${id}`),
    send: (id, m) => log.push(`${m.phase} ${id}${m.dir ? ' ' + m.dir : ''}`),
    alive: (id) => !dead.has(id),
    canSee: () => seeable,
    later: (fn, ms) => { const h = ++seq; timers.set(h, { fn, at: now + ms }); return h; },
    cancel: (h) => { timers.delete(h); },
  };
  const tick = (ms) => {
    now += ms;
    for (const [h, t] of [...timers]) if (t.at <= now) { timers.delete(h); t.fn(); }
  };
  return { m: createMotion(fx), log, shown, dead, tick, timers, see: (on) => { seeable = !!on; },
    take: () => log.splice(0).join(' | ') };
}

{
  const r = rig();
  const { m } = r;
  // The window's first page: nothing on screen to go under, so staged.
  m.show('home');
  ok(r.take() === 'stage home | arm home none' && m.state().coming.staged, 'the first page is staged out of sight and told to arm', r.log.join());
  m.ready('home');
  ok(r.take() === 'place home | enter home none' && m.state().onScreen === 'home' && !m.state().coming,
    'ready, it is placed and comes in');

  // Forward: Matches under Home, Home told to leave, Matches to arm.
  m.show('matches');
  let t = r.take();
  ok(t === 'under matches<home | leave home | arm matches forward', 'a page is shown UNDER the page on screen, then armed, forward down the sidebar', t);
  ok(r.shown.has('home') && r.shown.has('matches') && m.state().onScreen === 'home',
    'and until it is ready the page on screen stays, over it');
  ok(!m.ready('stats') && !m.ready('home') && m.state().coming.to === 'matches' && !r.log.length,
    'a ready from any other page, the one leaving included, changes nothing');
  m.ready('matches');
  t = r.take();
  ok(t === 'hide home | enter matches forward' && !r.shown.has('home') && m.state().onScreen === 'matches',
    'ready: the page on screen goes, THEN the new one comes in', t);
  // Back.
  m.show('home');
  ok(r.take() === 'under home<matches | leave matches | arm home back', 'up the sidebar it arms back');
  m.ready('home');
  r.take();

  // A page that never answers is let in after READY_MS, and not before.
  m.show('stats');
  r.take();
  r.tick(READY_MS - 1);
  ok(!r.log.length && r.shown.has('home'), `with no answer, the page on screen holds for ${READY_MS - 1}ms`);
  r.tick(1);
  t = r.take();
  ok(t === 'hide home | enter stats forward' && m.state().onScreen === 'stats', `and at ${READY_MS}ms the page comes in anyway`, t);
  ok(m.ready('stats') && r.take() === 'enter stats forward', 'a late answer from it only says enter again, the way it came');

  // Sealing mid switch: both pages go in that call, and the timer is off.
  m.show('patterns');
  r.take();
  m.show(null);
  t = r.take();
  ok(t === 'hide patterns | hide stats' && !r.shown.size && !m.state().onScreen && !m.state().coming,
    'sealed mid switch, the page on its way and the page on screen go at once', t);
  r.tick(LOAD_MS * 2);
  ok(!r.log.length && !r.shown.size, 'and nothing comes back when its timer would have run');
  ok(!m.ready('patterns') && !r.log.length, 'nor on a late ready');

  // Unsealed: nothing on screen to go under, so the remembered page is staged.
  m.show('review');
  ok(r.take() === 'stage review | arm review none', 'the seal lifting stages the page and arms it');
  m.ready('review');
  ok(r.take() === 'place review | enter review none', 'and places it once it is ready');

  // Asked for another page while one is on its way.
  m.show('coach');
  r.take();
  m.show('settings');
  t = r.take();
  ok(t === 'hide coach | under settings<review | leave review | arm settings back',
    'a page asked for while another is on its way: that one goes back, and the new one goes under the page still on screen', t);
  ok(!m.ready('coach') && m.state().coming.to === 'settings', 'the first one\'s ready is stale');
  m.ready('settings');
  r.take();

  // Called back to the page on screen before the new one arrived.
  m.show('stats');
  r.take();
  m.show('settings');
  t = r.take();
  ok(t === 'hide stats | keep settings | enter settings none' && m.state().onScreen === 'settings' && !m.state().coming,
    'called back before the page on its way arrived: it goes, and the page told to leave stays and comes back', t);
  m.show('settings');
  ok(!r.log.length, 'showing the page already on screen does nothing');

  // A page loading again: its old document is never told to arm, and its new
  // one, which arms itself as it loads, is waited for longer.
  m.show('coach', { reload: true });
  t = r.take();
  ok(t === 'under coach<settings | leave settings', 'a page loading again goes under with no arm sent to the document it replaces', t);
  r.tick(READY_MS);
  ok(!r.log.length, `and is not let in at ${READY_MS}ms`);
  m.ready('coach');
  ok(r.take() === 'hide settings | enter coach back', 'but on its new document\'s ready');
  m.show('home');
  m.ready('home');
  r.take();
  m.show('stats', { reload: true });
  r.take();
  r.tick(LOAD_MS - 1);
  ok(!r.log.length, `nor at ${LOAD_MS - 1}ms`);
  r.tick(1);
  ok(r.take() === 'hide home | enter stats forward', `but at ${LOAD_MS}ms, answer or not`);

  // The page on screen arming itself as it loads (a reload in place, or a page
  // let in by the timer before it had loaded) is let in on its ready.
  ok(m.ready('stats') && r.take() === 'enter stats forward', 'the page on screen, ready late, comes in the way it came');
  m.show('stats', { reload: true });
  ok(!r.log.length && m.ready('stats') && r.take() === 'enter stats none', 'loaded again in place, it comes in where it is');

  // A page on screen whose view is gone is nothing to go under.
  r.dead.add('stats');
  m.show('matches');
  ok(r.take() === 'stage matches | arm matches none', 'with the view on screen closed, the next page is staged instead');
  m.ready('matches');
  r.take();
  r.dead.clear();

  // forget(): a view closing mid switch.
  m.show('patterns');
  r.take();
  m.forget('patterns');
  t = r.take();
  ok(t === 'keep matches | enter matches none' && m.state().onScreen === 'matches' && !m.state().coming && !r.timers.size,
    'the page on its way closing calls the switch off, and the page on screen stays', t);
  m.show('patterns');
  r.take();
  m.forget('matches');
  t = r.take();
  ok(t === 'hide matches | enter patterns forward' && m.state().onScreen === 'patterns',
    'the page leaving closing lets the page under it in', t);
  m.forget('patterns');
  ok(m.state().onScreen === null, 'and the page on screen closing leaves none on screen');
  m.reset();
  ok(!m.state().onScreen && !m.state().coming, 'reset leaves nothing on screen and nothing on its way');
}

// ── A staged page waits on while the window cannot be seen (8.2) ─────────
// At a match's end the seal lifts with the game in front: the review's view
// can paint nothing, so it can never answer, and placed by its timer it
// showed the frame it last painted, the previous match's review, the moment
// the player looked. Shown, restored or focused, the window is seen().
{
  const r = rig();
  const { m } = r;
  r.see(false);
  m.show('review');
  ok(r.take() === 'stage review | arm review none', 'the seal lifting behind the game stages the review and arms it');
  r.tick(READY_MS);
  ok(!r.log.length && m.state().coming && m.state().coming.staged && m.state().coming.to === 'review' && !r.timers.size,
    `with the window out of sight, its timer at ${READY_MS}ms leaves it staged`, r.log.join(' | '));
  r.tick(LOAD_MS * 10);
  ok(!r.log.length && m.state().coming.to === 'review' && !m.state().onScreen, 'and nothing lets it in later');
  r.see(true);
  m.seen();
  ok(r.timers.size === 1 && !r.log.length, 'the window seen, its wait starts again');
  r.tick(READY_MS - 1);
  ok(!r.log.length, `the whole ${READY_MS}ms of it, counted from then`);
  ok(m.ready('review') && r.take() === 'place review | enter review none' && m.state().onScreen === 'review' && !r.timers.size,
    'and the review\'s own ready, sent now that its view can paint, places it');
  m.seen();
  ok(!r.log.length && !r.timers.size, 'seen with nothing on its way, nothing happens');

  // Seen while it still cannot be (shown, but behind the game): the timer
  // runs again and still waits on. Its own ready lets it in at any time.
  m.show(null);
  r.take();
  r.see(false);
  m.show('home');
  r.take();
  r.tick(READY_MS);
  m.seen();
  r.tick(READY_MS);
  ok(!r.log.length && m.state().coming.to === 'home' && !r.timers.size,
    'seen while it still cannot be, the timer runs again and waits on', r.log.join(' | '));
  ok(m.ready('home') && r.take() === 'place home | enter home none', 'its own ready lets it in, seen or not');

  // A page that never answers comes in once the window can be seen.
  m.show(null);
  r.take();
  m.show('review');
  r.take();
  r.tick(READY_MS * 3);
  r.see(true);
  m.seen();
  r.tick(READY_MS);
  ok(r.take() === 'place review | enter review none', `one that never answers comes in ${READY_MS}ms after the window is seen`);

  // Sealing takes a page waiting on away at once, and nothing brings it back.
  m.show(null);
  r.take();
  r.see(false);
  m.show('stats');
  r.take();
  r.tick(READY_MS);
  m.show(null);
  ok(r.take() === 'hide stats' && !m.state().coming && !m.state().onScreen, 'sealed, a staged page waiting on goes at once');
  r.see(true);
  m.seen();
  r.tick(LOAD_MS * 2);
  ok(!r.log.length && !r.timers.size, 'and the window seen later brings nothing back');

  // A staged page loading again waits its LOAD_MS again from the moment the
  // window is seen: its new document is given that long to paint.
  r.see(false);
  m.show('coach', { reload: true });
  ok(r.take() === 'stage coach', 'staged while loading again, the document it replaces is not told to arm');
  r.tick(LOAD_MS);
  ok(!r.log.length && m.state().coming.to === 'coach', `with the window out of sight, its timer at ${LOAD_MS}ms leaves it staged too`);
  r.see(true);
  m.seen();
  r.tick(LOAD_MS - 1);
  ok(!r.log.length, `seen, it waits its whole ${LOAD_MS}ms again`);
  r.tick(1);
  ok(r.take() === 'place coach | enter coach none', 'then comes in, answer or not');

  // With a page on screen to go under, the switch is the player's own, made
  // in the window, and its timer lets it in as before, seen or not; seen()
  // leaves its wait alone.
  r.see(false);
  m.show('matches');
  ok(r.take() === 'under matches<coach | leave coach | arm matches back', 'a page asked for over another goes under it, seen or not');
  r.tick(READY_MS - 50);
  m.seen();
  r.tick(50);
  ok(r.take() === 'hide coach | enter matches back', `and its timer still lets it in at ${READY_MS}ms, its wait untouched by seen()`);
}

// ── The registry reaches views ────────────────────────────────────────────
{
  const sent = [];
  const listeners = {};
  const fakeContents = (name) => ({
    destroyed: false,
    send: (ch, data) => sent.push({ name, ch, data }),
    on: (ev, fn) => { (listeners[name] = listeners[name] || {})[ev] = fn; },
    isDestroyed() { return this.destroyed; },
  });
  const win = { webContents: fakeContents('win'), destroyed: false, isDestroyed() { return this.destroyed; },
    on: (ev, fn) => { (listeners.winEvents = listeners.winEvents || {})[ev] = fn; } };
  const view = { webContents: fakeContents('view') };
  registry.register('t-win', win);
  registry.register('t-view', view);
  registry.broadcast('push:test', 1);
  ok(sent.some((x) => x.name === 'win') && sent.some((x) => x.name === 'view'),
    'a broadcast reaches a window and a page view');
  registry.sendTo('t-view', 'push:one', 2);
  ok(sent.some((x) => x.name === 'view' && x.ch === 'push:one'), 'and sendTo reaches a view by name');
  ok(registry.get('t-view') === view, 'a view is found by its name');
  view.webContents.destroyed = true;
  if (listeners.view && listeners.view.destroyed) listeners.view.destroyed();
  ok(!registry.get('t-view'), 'a destroyed view is forgotten');
}

// ── main-window.js carries it out (8.2), on stand-in views ───────────────
// The real module, with Electron and the config store stood in for and the
// switch's timers on a clock moved by hand (main-window.js sets them with the
// global setTimeout, swapped here for this block only). What is real: how the
// window's own state decides whether it can be seen, its show, restore and
// focus giving a staged page its wait again, and a page loading again
// refusing the ready of the document it replaces.
{
  const EventEmitter = require('events');
  const Module = require('module');
  let ids = 0;
  class Contents extends EventEmitter {
    constructor() { super(); this.id = ++ids; this.sent = []; this.dead = false; this.reloads = 0; }
    loadFile() {}
    reload() { this.reloads++; }
    send(ch, msg) { this.sent.push({ ch, msg }); }
    focus() {}
    isDestroyed() { return this.dead; }
    close() { this.dead = true; this.emit('destroyed'); }
  }
  class View {
    constructor() { this.webContents = new Contents(); this.visible = true; this.bounds = null; }
    setBackgroundColor() {}
    setVisible(on) { this.visible = !!on; }
    getVisible() { return this.visible; }
    setBounds(b) { this.bounds = b; }
    getBounds() { return this.bounds; }
  }
  const wins = [];
  // A window as Windows keeps one: shown or not, minimised (its content then
  // measuring 0 by 0) or not, and with the focus or not. focus() is refused
  // while `refused` (a background app asking, the game in front).
  class Win extends EventEmitter {
    constructor() {
      super();
      this.webContents = new Contents();
      Object.assign(this, { visible: false, minimized: false, focused: false, dead: false, refused: false });
      const kids = [];
      this.contentView = {
        children: kids,
        addChildView: (v) => { const i = kids.indexOf(v); if (i !== -1) kids.splice(i, 1); kids.push(v); },
        removeChildView: (v) => { const i = kids.indexOf(v); if (i !== -1) kids.splice(i, 1); },
      };
      wins.push(this);
    }
    loadFile() {}
    isDestroyed() { return this.dead; }
    getContentSize() { return this.minimized ? [0, 0] : [1200, 780]; }
    getBounds() { return { x: 0, y: 0, width: 1200, height: 780 }; }
    isVisible() { return this.visible; }
    isMinimized() { return this.minimized; }
    isFocused() { return this.focused; }
    isMaximized() { return false; }
    show() { this.visible = true; this.emit('show'); }
    showInactive() { this.visible = true; this.emit('show'); }
    hide() { this.visible = false; this.focused = false; this.emit('hide'); }
    focus() { if (this.refused) return; this.focused = true; this.emit('focus'); }
    minimize() { this.minimized = true; this.focused = false; this.emit('minimize'); }
    restore() { this.minimized = false; this.emit('restore'); }
    maximize() {}
    unmaximize() {}
  }
  const electron = { app: { on() {} }, BrowserWindow: Win, WebContentsView: View, screen: { getAllDisplays: () => [] } };
  const clock = { now: 0, seq: 0, timers: new Map() };
  const tick = (ms) => {
    clock.now += ms;
    for (const [h, t] of [...clock.timers]) if (t.at <= clock.now) { clock.timers.delete(h); t.fn(); }
  };
  const real = { setTimeout: global.setTimeout, clearTimeout: global.clearTimeout };
  global.setTimeout = (fn, ms) => { const h = ++clock.seq; clock.timers.set(h, { fn, at: clock.now + ms }); return h; };
  global.clearTimeout = (h) => { clock.timers.delete(h); };
  const file = require.resolve('../src/main/windows/main-window');
  const load = Module._load;
  Module._load = function (request, parent, ...rest) {
    if (request === 'electron') return electron;
    if (request === '../services/store' && parent && parent.filename === file) return { get: () => undefined, set() {} };
    return load.call(this, request, parent, ...rest);
  };
  try {
    let mw = null;
    try { mw = require(file); } finally { Module._load = load; }
    const viewOf = (id) => mw.pageViews().get(id);
    const settled = (page) => { const s = mw.motionState(); return s.onScreen === page && !s.coming && !s.staged; };
    const waiting = (page) => { const s = mw.motionState(); return !!(s.coming && s.coming.to === page && s.staged === page && !s.onScreen); };
    const readyFrom = (id) => mw.pageReady(id, viewOf(id).webContents);

    // Made out of sight, as at launch behind the splash: its first page is
    // staged, and the timer lets nothing in while the window is hidden.
    mw.create({ deferShow: true });
    const w = wins[wins.length - 1];
    ok(waiting('home'), 'made out of sight, the window\'s first page is staged');
    tick(READY_MS * 3);
    ok(waiting('home'), 'and while the window is hidden its timer leaves it staged');
    w.show();
    w.focus();
    tick(READY_MS - 1);
    ok(waiting('home'), 'shown and focused, its wait starts again');
    ok(readyFrom('home') && settled('home'), 'and its ready, its view painting at last, places it');

    // A match: sealed. Its end, with the game in front: shown, but the focus
    // a background app asks for is refused.
    mw.setSealed(true);
    w.focused = false;
    w.refused = true;
    mw.setSealed(false);
    mw.show('review');
    ok(waiting('review'), 'the seal lifting behind the game stages the review');
    tick(READY_MS * 3);
    ok(waiting('review'), 'and its timer leaves it staged: the window cannot be seen, so the view cannot paint');
    w.refused = false;
    w.focus();
    tick(READY_MS - 1);
    ok(waiting('review'), 'the player tabbing to the window starts its wait again');
    tick(1);
    ok(settled('review'), `and a review that never answered comes in ${READY_MS}ms after the window is seen`);

    // Minimised, then restored with the focus it had. Staged while the
    // window's content measured 0 by 0, the page was laid out 0 by 0, and no
    // resize comes on the way back: restored, the views are laid out again,
    // or it could never paint.
    mw.setSealed(true);
    w.minimize();
    mw.setSealed(false);
    tick(READY_MS * 3);
    ok(waiting('review'), 'minimised, a staged page is not let in by its timer');
    w.focused = true;
    w.restore();
    const edge = viewOf('review').getBounds();
    ok(edge.x === 1200 - mw.STAGE_PX && edge.y === mw.TOP_H && edge.width === 1200 - mw.SIDEBAR_W && edge.height === 780 - mw.TOP_H,
      `restored, the staged page is laid out again at the page area's edge, where it can paint (${JSON.stringify(edge)})`);
    tick(READY_MS);
    ok(settled('review'), 'and it comes in once its wait has run again');

    // Hidden to the tray, then shown with the focus.
    mw.setSealed(true);
    w.hide();
    mw.setSealed(false);
    tick(READY_MS * 3);
    ok(waiting('review'), 'hidden, a staged page is not let in by its timer');
    w.focused = true;
    w.show();
    tick(READY_MS);
    ok(settled('review'), 'shown again, it comes in once its wait has run again');

    // A PAGE LOADING AGAIN. Ask Coach was on screen, the review came over it,
    // and Ask about this match loads Ask Coach again: until its new document
    // commits, the old one's ready (its two frames queued in a view that could
    // not paint them) is not the switch's.
    mw.show('coach');
    readyFrom('coach');
    mw.show('review');
    readyFrom('review');
    ok(settled('review'), 'the review on screen, over Ask Coach');
    mw.show('coach', { reload: true });
    const coach = viewOf('coach').webContents;
    ok(coach.reloads === 1 && mw.motionState().coming && mw.motionState().coming.to === 'coach' && mw.motionState().onScreen === 'review',
      'Ask about this match loads the page again, under the review');
    ok(!readyFrom('coach') && mw.motionState().coming.to === 'coach' && mw.motionState().onScreen === 'review',
      'a ready from the document being replaced changes nothing: the review stays over it');
    coach.emit('did-fail-load', {}, -6, 'ERR_FILE_NOT_FOUND', 'file:///chat/frame.html', false);
    ok(!readyFrom('coach') && mw.motionState().onScreen === 'review', 'nor once a frame inside it fails to load');
    coach.emit('did-navigate', {}, 'file:///chat/index.html', 200, 'OK');
    ok(readyFrom('coach') && settled('coach'), 'the new document committed, its ready lets the page in');
    mw.show('coach', { reload: true });
    ok(!readyFrom('coach'), 'loaded again in place, the old document\'s ready is refused as well');
    coach.emit('did-fail-load', {}, -6, 'ERR_FILE_NOT_FOUND', 'file:///chat/index.html', true);
    ok(readyFrom('coach'), 'and an error page taking the old document\'s place ends the wait for it too');

    // A window made again starts with nothing loading.
    mw.show('coach', { reload: true });
    ok(mw.motionState().reloading.includes('coach'), 'loading again, the page is marked so');
    w.dead = true;
    w.emit('closed');
    mw.show('review');
    ok(wins.length === 2 && !mw.motionState().reloading.length, 'the window gone and made again, no page is left marked loading');
  } finally {
    Object.assign(global, real);
  }
}

console.log(`\n${fails ? fails + ' of ' + checks + ' failed' : 'all ' + checks + ' shell navigation checks passed'}`);
process.exit(fails ? 1 : 0);

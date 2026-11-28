'use strict';

/**
 * test:history. BACK AND FORWARD THROUGH THE PAGES VISITED (9.1, the owner's
 * item 7: "Mouse side buttons (M4 back, M5 forward) go back and forward
 * through the pages the player visited, everywhere in the app").
 *
 *   - shell-nav.js createHistory: visits, steps both ways passing over what
 *     index.js says is gone, a visit from the middle dropping what was ahead,
 *     a deleted review's entries taken out, the cap;
 *   - createHistoryGate: one press heard twice (Windows' app-command and the
 *     page's own button) is one step, and a fast double press is two;
 *   - main-window.js on stand in views: show() records a visit, a step
 *     (opts.history) does not, Windows' app-command reaches index.js's hook,
 *     PUSH_HISTORY goes out on a change, a window made again starts over;
 *   - page-motion.js: a page's mouse buttons 3 and 4 ask main for the step,
 *     never while the Trainer holds the pointer, and every page bridge has
 *     history.back, forward, state and onChange;
 *   - index.js's wiring, read as text: sealed nothing moves, the gate is
 *     asked for the two sources only, a review deleted is passed over.
 *
 * Pure node, no window. Written with a file tool, never a shell heredoc (CLAUDE.md, the regex trap).
 */
const fs = require('fs');
const path = require('path');
const Module = require('module');
const EventEmitter = require('events');
const { createHistory, createHistoryGate, HISTORY_MAX } = require('../src/shared/shell-nav');
const C = require('../src/shared/channels');

let checks = 0;
let fails = 0;
function ok(cond, msg, detail) {
  checks++;
  if (cond) console.log(`  ok  ${msg}`);
  else { fails++; console.log(`  FAIL ${msg}${detail !== undefined ? ` (${detail})` : ''}`); }
}
const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

// ── createHistory ───────────────────────────────────────────────────────────
{
  const h = createHistory();
  ok(h.current() === null && h.state().back === false && h.state().forward === false, 'empty: nowhere to go either way');
  h.visit({ page: 'home' });
  h.visit({ page: 'matches' });
  ok(h.visit({ page: 'matches' }) === false && h.state().length === 2, 'visiting the page already current adds nothing');
  h.visit({ page: 'review', key: 'valorant-1790000000000-aaaa' });
  h.visit({ page: 'review', key: 'valorant-1790000000001-bbbb' });
  ok(h.state().length === 4, 'a review of another match is another entry, by its key');
  ok(h.visit({ page: 'nowhere' }) === false && h.visit(null) === false, 'no page that is not one');
  let e = h.step(-1);
  ok(e && e.page === 'review' && e.key === 'valorant-1790000000000-aaaa', 'back lands on the review before, by its key', JSON.stringify(e));
  e = h.step(-1);
  ok(e && e.page === 'matches' && h.state().backTo === 'home' && h.state().forwardTo === 'review', 'back again lands on Matches, home behind, a review ahead');
  e = h.step(1);
  ok(e && e.key === 'valorant-1790000000000-aaaa', 'forward goes the same way back');
  const gone = (x) => x.page !== 'review' || x.key !== 'valorant-1790000000001-bbbb';
  ok(h.peek(1, gone) === null && h.state(gone).forward === false, 'a step passes over an entry index.js says is gone, and none left is no step');
  h.step(-1);
  h.visit({ page: 'moments' });
  ok(h.state().length === 3 && h.state().forward === false && h.current().page === 'moments', 'a visit from the middle drops what was ahead, as a browser does');
  ok(h.step(1) === null && h.current().page === 'moments', 'forward with nothing ahead moves nothing');

  const d = createHistory();
  ['home', 'matches', 'review:x', 'matches', 'review:x', 'moments'].forEach((s) => { const [page, key] = s.split(':'); d.visit({ page, key }); });
  d.step(-1);
  ok(d.current().page === 'review' && d.drop((x) => x.page === 'review' && x.key === 'x'), 'a review deleted is taken out');
  ok(JSON.stringify(d.state()) === JSON.stringify({ back: true, forward: true, backTo: 'home', forwardTo: 'moments', at: 1, length: 3 }),
    'what is left joins up (two Matches side by side become one) and the player stays where the deleted review was', JSON.stringify(d.state()));
  const cap = createHistory({ max: 5 });
  for (let i = 0; i < 12; i++) cap.visit({ page: i % 2 ? 'home' : 'matches' });
  ok(cap.state().length === 5 && cap.state().at === 4 && HISTORY_MAX === 50, 'it keeps the newest entries up to its cap, 50 by default');
}

// ── createHistoryGate ───────────────────────────────────────────────────────
{
  let t = 0;
  const g = createHistoryGate({ now: () => t });
  const a = g.allow('back', 'app');
  const b = g.allow('back', 'mouse');
  ok(a && !b, 'one press heard as the app-command and as the page button is one step');
  t = 250;
  const c1 = g.allow('back', 'mouse');
  const c2 = g.allow('back', 'app');
  ok(!c1 && c2, 'a second press whose page button arrives first is still one step');
  t = 900;
  ok(g.allow('back', 'mouse') && g.allow('back', 'mouse'), 'presses from one source are never dropped: a fast double press goes back twice');
  t = 1000;
  ok(g.allow('forward', 'app'), 'the other way is never held back by this one');
}

// ── main-window.js on stand in views ────────────────────────────────────────
{
  let ids = 0;
  class Contents extends EventEmitter {
    constructor() { super(); this.id = ++ids; this.sent = []; this.dead = false; }
    loadFile() {}
    reload() {}
    send(ch, msg) { this.sent.push({ ch, msg }); }
    focus() {}
    isDestroyed() { return this.dead; }
    close() { this.dead = true; this.emit('destroyed'); }
  }
  class View {
    constructor() { this.webContents = new Contents(); this.visible = true; }
    setBackgroundColor() {}
    setVisible(on) { this.visible = !!on; }
    getVisible() { return this.visible; }
    setBounds() {}
    getBounds() { return null; }
  }
  const wins = [];
  class Win extends EventEmitter {
    constructor() {
      super();
      this.webContents = new Contents();
      Object.assign(this, { visible: true, focused: true, dead: false });
      this.contentView = { addChildView() {}, removeChildView() {} };
      wins.push(this);
    }
    loadFile() {}
    isDestroyed() { return this.dead; }
    getContentSize() { return [1200, 780]; }
    getBounds() { return { x: 0, y: 0, width: 1200, height: 780 }; }
    isVisible() { return this.visible; }
    isMinimized() { return false; }
    isFocused() { return this.focused; }
    isMaximized() { return false; }
    show() {}
    showInactive() {}
    focus() {}
    maximize() {}
    setContentProtection() {}
  }
  const electron = { app: { on() {}, quit() {} }, BrowserWindow: Win, WebContentsView: View, screen: { getAllDisplays: () => [] }, ipcMain: new EventEmitter() };
  const file = require.resolve('../src/main/windows/main-window');
  const load = Module._load;
  Module._load = function (request, parent, ...rest) {
    if (request === 'electron') return electron;
    if (request === '../services/store' && parent && parent.filename === file) return { get: () => undefined, set() {} };
    return load.call(this, request, parent, ...rest);
  };
  const timers = { setTimeout: global.setTimeout, clearTimeout: global.clearTimeout };
  global.setTimeout = () => 0;
  global.clearTimeout = () => {};
  let mw = null;
  try { delete require.cache[file]; mw = require(file); } finally { Module._load = load; }
  try {
    const asked = [];
    let reviewKey = 'valorant-1790000000000-aaaa';
    mw.setHistoryHooks({ key: (page) => (page === 'review' ? reviewKey : null), ok: () => true, ask: (dir, from) => asked.push(`${dir}:${from}`) });
    mw.create({ deferShow: true });
    const w = wins[wins.length - 1];
    ok(mw.historyCurrent() && mw.historyCurrent().page === 'home', 'a window starts its history on the page it opens on');
    mw.show('matches');
    mw.show('review');
    ok(mw.historyCurrent().page === 'review' && mw.historyCurrent().key === reviewKey && mw.historyState().backTo === 'matches',
      'show() records each visit, a review by the key index.js names', JSON.stringify(mw.historyState()));
    ok(mw.historyState().backLabel === 'Matches', 'the state names the page a step back lands on, for the review\'s arrow', mw.historyState().backLabel);
    const e = mw.historyStep(-1);
    mw.show(e.page, { history: true });
    ok(mw.historyCurrent().page === 'matches' && mw.historyState().forward === true, 'a step shown with opts.history moves along the history and adds nothing');
    const pushes = w.webContents.sent.filter((s) => s.ch === C.PUSH_HISTORY);
    ok(pushes.length >= 2 && pushes[pushes.length - 1].msg.forward === true, 'PUSH_HISTORY goes out on a change, with what a step allows now');
    w.emit('app-command', {}, 'browser-backward');
    w.emit('app-command', {}, 'browser-forward');
    w.emit('app-command', {}, 'media-play-pause');
    ok(asked.join() === 'back:app,forward:app', "Windows' app-command reaches index.js's hook, back and forward only", asked.join());
    reviewKey = 'valorant-1790000000002-cccc';
    mw.show('review');
    ok(mw.historyDrop((x) => x.page === 'review' && x.key === reviewKey) && mw.historyCurrent().page === 'matches', 'a review deleted leaves the history, the player on the page before it');
    mw.setHistoryHooks({ key: () => null, ok: (x) => x.page !== 'home', ask: () => {} });
    ok(mw.historyState().back === false, 'an entry index.js says is gone is never stepped onto');
  } finally {
    global.setTimeout = timers.setTimeout;
    global.clearTimeout = timers.clearTimeout;
  }
}

// ── page-motion.js: the page's own mouse buttons and the bridge ─────────────
{
  const listeners = {};
  const invoked = [];
  const fakeIpc = { invoke: (ch, m) => { invoked.push([ch, m]); return Promise.resolve(null); }, send() {}, on() {}, removeListener() {} };
  global.window = { addEventListener: (type, fn) => { (listeners[type] = listeners[type] || []).push(fn); } };
  global.document = { pointerLockElement: null, documentElement: { classList: { toggle() {} } } };
  const pmFile = require.resolve('../src/preload/page-motion');
  delete require.cache[pmFile];
  const PM = require(pmFile);
  try {
    const api = PM.pageMotion(fakeIpc);
    const press = (button, type) => { let prevented = false; for (const fn of listeners[type] || []) fn({ type, button, preventDefault: () => { prevented = true; } }); return prevented; };
    const before = invoked.length;
    const downKept = press(3, 'mousedown');
    press(3, 'mouseup');
    press(4, 'mouseup');
    press(0, 'mouseup');
    const asks = invoked.slice(before).filter(([ch]) => ch === C.HISTORY_GO).map(([, m]) => `${m.dir}:${m.from}`);
    ok(downKept && asks.join() === 'back:mouse,forward:mouse', 'button 3 asks back and 4 forward on release, its press kept from the page, any other button nothing', asks.join());
    global.document.pointerLockElement = {};
    press(3, 'mouseup');
    ok(invoked.filter(([ch]) => ch === C.HISTORY_GO).length === 2, 'not while the Trainer holds the pointer: its buttons are the game\'s');
    global.document.pointerLockElement = null;
    PM.pageMotion(fakeIpc);
    press(3, 'mouseup');
    ok(invoked.filter(([ch]) => ch === C.HISTORY_GO).length === 3, 'a second bridge in one document listens once, so a press is never asked twice');
    ok(api.history && ['back', 'forward', 'state', 'onChange'].every((k) => typeof api.history[k] === 'function'), 'every page bridge has history.back, forward, state and onChange');
    api.history.back({ fallback: 'matches' });
    const last = invoked[invoked.length - 1];
    ok(last[0] === C.HISTORY_GO && last[1].dir === 'back' && last[1].from === 'page' && last[1].fallback === 'matches', "the review's arrow goes back, or to Matches with nowhere to go back to", JSON.stringify(last[1]));
  } finally {
    delete global.window;
    delete global.document;
  }
}

// ── The wiring, read as text ─────────────────────────────────────────────────
{
  const idx = read('src/main/index.js');
  const ipc = read('src/main/ipc/register-ipc.js');
  const shellPre = read('src/preload/shell-preload.js');
  const body = idx.slice(idx.indexOf('function navHistory('), idx.indexOf('function showEntry('));
  ok(/if \(now\.sealed\) return mainWindow\.historyState\(\);/.test(body), 'sealed, a step does nothing: never mid match');
  ok(/\(from === 'app' \|\| from === 'mouse'\) && !historyGate\.allow\(d, from\)/.test(body), 'the gate is asked for the two sources of one press only, never for a page\'s own arrow');
  ok(/if \(now\.rec\)/.test(body), 'on the Recording view, back is the page under it');
  ok(/reviewStore\.has\(e\.key\)/.test(idx) && /historyDrop\(\(e\) => e\.page === 'review' && e\.key === id\)/.test(idx), 'a review deleted is passed over and taken out of the history');
  ok(ipc.includes('safeHandle(C.HISTORY_GO') && ipc.includes('safeHandle(C.HISTORY_GET'), 'HISTORY_GO and HISTORY_GET are handled for our own pages only (safeHandle)');
  ok(/mouseHistory\(ipcRenderer\)/.test(shellPre) && /history:\s+historyApi\(ipcRenderer\)/.test(shellPre), 'the bar\'s own document hears the buttons too, and has the same history API');
  const pages = fs.readdirSync(path.join(ROOT, 'src/preload')).filter((f) => /-preload\.js$/.test(f) && read(`src/preload/${f}`).includes('pageMotion(ipcRenderer)'));
  ok(pages.length >= 15, `every page view's preload spreads pageMotion, so every page hears its buttons (${pages.length})`);
}

console.log(`\n${fails ? `FAIL: ${fails} of ${checks}` : `all ${checks} history checks passed`}`);
process.exit(fails ? 1 : 0);

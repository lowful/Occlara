'use strict';

/**
 * test:still. EVERY ANIMATION STILL WHILE A MATCH IS RECORDED (9.1, the
 * owner's item 9: "When recording starts, pause EVERY animation in the app
 * (moon, stars, drift, any loop, canvas loops), and resume after").
 *
 *   - preload/still.js puts html.rec-still on its document when main says a
 *     match is recorded, and takes it off after; a push that came first wins
 *     over the answer to the first ask;
 *   - every surface's preload wires it (page views through page-motion.js),
 *     except the recorder's and the frames' hidden pages, which must run;
 *   - shared/motion.js folds rec-still into its ambient switch: ambient-off
 *     on, Motion.ambientOn() false and Motion.onAmbient(cb) told, then on
 *     again after;
 *   - every infinite CSS animation in the renderer has a rule that pauses it
 *     under html.rec-still (or html.ambient-off where motion.js is loaded);
 *   - Wrapped pauses its whole story, and main says it on every Start and
 *     Stop (setStatus, syncStill) and answers STILL_GET.
 *
 * Pure node, no window.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
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
const flush = () => new Promise((r) => setImmediate(r));

/** A classList on a Set, as a document's <html> keeps one. */
function classList() {
  const set = new Set();
  return {
    set,
    add: (c) => set.add(c),
    remove: (c) => set.delete(c),
    contains: (c) => set.has(c),
    toggle: (c, force) => { const on = force === undefined ? !set.has(c) : !!force; if (on) set.add(c); else set.delete(c); return on; },
  };
}

(async () => {
  // ── still.js ───────────────────────────────────────────────────────────────
  {
    const html = { classList: classList() };
    global.document = { documentElement: html };
    global.window = { addEventListener() {} };
    const listeners = {};
    let answer = { still: true };
    const ipc = { on: (ch, h) => { listeners[ch] = h; }, invoke: (ch) => Promise.resolve(ch === C.STILL_GET ? answer : null) };
    const file = require.resolve('../src/preload/still');
    delete require.cache[file];
    const { stillSync, CLASS } = require(file);
    stillSync(ipc);
    await flush();
    ok(CLASS === 'rec-still' && html.classList.contains('rec-still'), 'a surface that loads mid recording asks, and is still at once');
    listeners[C.PUSH_STILL]({}, { still: false });
    ok(!html.classList.contains('rec-still'), 'recording stopped: the class comes off and everything plays again');
    listeners[C.PUSH_STILL]({}, { still: true });
    ok(html.classList.contains('rec-still'), 'recording started: on again');
    const late = { classList: classList() };
    global.document = { documentElement: late };
    let release;
    const slow = { on: (ch, h) => { listeners.slow = h; }, invoke: () => new Promise((r) => { release = r; }) };
    stillSync(slow);
    listeners.slow({}, { still: true });
    release({ still: false });
    await flush();
    ok(late.classList.contains('rec-still'), 'a push that came before the first answer wins over it');
    ok(stillSync(null) === null, 'a stand in with no ipc is left alone');
    delete global.document;
    delete global.window;
  }

  // ── Every surface wires it ───────────────────────────────────────────────────
  {
    const dir = path.join(ROOT, 'src/preload');
    const all = fs.readdirSync(dir).filter((f) => /-preload\.js$/.test(f));
    const wired = (f) => { const t = read(`src/preload/${f}`); return /pageMotion\(ipcRenderer\)/.test(t) || /stillSync\(ipcRenderer\)/.test(t); };
    const missing = all.filter((f) => !['recorder-preload.js', 'frames-preload.js'].includes(f) && !wired(f));
    ok(missing.length === 0, 'every surface\'s preload puts the class on its document (page views through pageMotion)', missing.join(', '));
    ok(!wired('recorder-preload.js') && !wired('frames-preload.js'), 'never the recorder\'s or the frames\' hidden pages: they record and decode, they must run');
    ok(/stillSync\(ipcRenderer\);/.test(read('src/preload/page-motion.js')), 'pageMotion wires it for every page view');
  }

  // ── motion.js folds it into ambient ──────────────────────────────────────────
  {
    const html = { classList: classList() };
    let observer = null;
    const win = { addEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {} }) };
    const doc = { documentElement: html, visibilityState: 'visible', addEventListener() {} };
    const sandbox = {
      window: win, document: doc, setTimeout, clearTimeout, performance: { now: () => 0 },
      requestAnimationFrame: () => 0, cancelAnimationFrame() {},
      MutationObserver: class { constructor(cb) { observer = cb; } observe() {} disconnect() {} },
    };
    vm.runInNewContext(read('src/renderer/shared/motion.js'), sandbox);
    const M = win.Motion;
    ok(M && typeof M.onAmbient === 'function' && typeof M.still === 'function' && M.ambientOn() === true, 'Motion has onAmbient() and still(), ambient on to begin with');
    const heard = [];
    M.onAmbient((on) => heard.push(on));
    html.classList.add('rec-still');
    observer();
    ok(html.classList.contains('ambient-off') && M.ambientOn() === false && M.still() === true && heard.join() === 'false',
      'rec-still on: ambient-off with it, ambientOn() false, and a loop told to stop', heard.join());
    M.ambient(true);
    ok(M.ambientOn() === false, 'a page asking for ambient motion while a match is recorded does not get it');
    html.classList.remove('rec-still');
    observer();
    ok(!html.classList.contains('ambient-off') && M.ambientOn() === true && heard.join() === 'false,true', 'rec-still off: on again, and the loop told to start', heard.join());
    observer();
    ok(heard.length === 2, 'told only on a change');
  }

  // ── Every infinite CSS animation has its pause ───────────────────────────────
  {
    const files = [];
    const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) { if (e.name !== 'vendor') walk(p); } else if (/\.css$/.test(e.name)) files.push(p); } };
    walk(path.join(ROOT, 'src/renderer'));
    const missing = [];
    let found = 0;
    for (const f of files) {
      const css = fs.readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
      if (/html\.rec-still \*,/.test(css)) { found += (css.match(/infinite/g) || []).length; continue; }
      const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1].trim(), body: m[2] }));
      for (const r of rules) {
        if (!/animation[^:]*:[^;]*infinite/.test(r.body)) continue;
        found++;
        const sels = r.sel.split(',').map((s) => s.trim());
        const paused = sels.every((s) => rules.some((p) => /animation-play-state:\s*paused/.test(p.body)
          && p.sel.split(',').map((x) => x.trim()).some((x) => x === `html.rec-still ${s}` || x === `html.ambient-off ${s}`)));
        if (!paused) missing.push(`${path.relative(ROOT, f)}: ${r.sel}`);
      }
    }
    // rating-widget is the stream widget, served to OBS, never an Electron surface: it has no infinite animation anyway.
    ok(found >= 8 && missing.length === 0, `every infinite animation in the renderer (${found}) pauses under html.rec-still`, missing.join(' | '));
    const motionCss = read('src/renderer/shared/motion.css');
    ok(/html\.rec-still \.m-drift/.test(motionCss) && /html\.rec-still \.sky-twinkle/.test(read('src/renderer/home/home.css')), 'the agent\'s drift and the stars\' twinkle among them, by name');
  }

  // ── Wrapped and main ─────────────────────────────────────────────────────────
  {
    const wr = read('src/renderer/wrapped/wrapped.js');
    ok(/classList\.contains\('rec-still'\)/.test(wr) && /if \(s\) autoPause\(\); else autoResume\(\);/.test(wr), 'Wrapped pauses its whole story while a match is recorded, and plays it after');
    const idx = read('src/main/index.js');
    const setStatus = idx.slice(idx.indexOf('function setStatus('), idx.indexOf('function setStatus(') + 300);
    ok(/syncStill\(\);/.test(setStatus), 'main says it on every Start and Stop (setStatus)');
    ok(/registry\.broadcast\(C\.PUSH_STILL, \{ still \}\)/.test(idx) && /const still = !!state\.isCoaching;/.test(idx), 'to every surface, still while recording and only then');
    ok(read('src/main/ipc/register-ipc.js').includes('safeHandle(C.STILL_GET'), 'and answers a surface that asks as it loads (STILL_GET)');
    ok(C.PUSH_LIST.includes(C.PUSH_STILL) && C.PUSH_LIST.includes(C.PUSH_HISTORY), 'its push is one a preload may hear');
  }

  console.log(`\n${fails ? `FAIL: ${fails} of ${checks}` : `all ${checks} still checks passed`}`);
  process.exit(fails ? 1 : 0);
})();

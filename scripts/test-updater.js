'use strict';

/**
 * THE UPDATER IN THE BAR (9.1, the owner's item 22; src/main/updater.js).
 * The native restart question is gone: the bar's green control says it
 * instead, a download arrow with the download's progress round it, then
 * "Restart to update", which is the one way the app restarts to install.
 *
 * What is held here, on the real updater.js with Electron and
 * electron-updater stood in for (no window, no network):
 *   - electron-updater's flow is unchanged: autoDownload and
 *     autoInstallOnAppQuit on, quitAndInstall the install, no question box;
 *   - the bar is told (push) only when what it may show changes: downloading
 *     with its whole percent (null before electron-updater gives one), ready,
 *     installing, and null while the player is playing (busy), the watch
 *     telling it again the moment that changes;
 *   - nothing installs by itself, however long a download sits ready, and
 *     install() refuses mid match, before a download is whole, and twice;
 *   - a check finding the version already downloaded leaves it ready, a
 *     newer one supersedes it, a failed check never hides one that is ready;
 *   - index.js says playing as it did, and tells the bar's own document
 *     alone; register-ipc.js takes the install from the bar alone.
 *
 * Run: npm run test:updater
 */

const fs = require('fs');
const path = require('path');
const Module = require('module');
const EventEmitter = require('events');

let passed = 0;
let failed = 0;
function ok(cond, what, detail) {
  if (cond) { passed++; console.log(`ok    ${what}`); } else { failed++; console.log(`FAIL  ${what}${detail ? ` (${detail})` : ''}`); }
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const ROOT = path.join(__dirname, '..');
const FILE = path.join(ROOT, 'src', 'main', 'updater.js');

const asked = [];
const electron = {
  app: { isPackaged: true, getVersion: () => '9.1.0' },
  // Were a question box still asked, it would be seen here.
  dialog: { showMessageBox: async (o) => { asked.push(o); return { response: 0 }; } },
};
const autoUpdater = new EventEmitter();
let installs = 0;
let checks = 0;
autoUpdater.checkForUpdates = async () => { checks++; return null; };
autoUpdater.quitAndInstall = () => { installs += 1; };
const realLoad = Module._load;
Module._load = function patched(request, parent, isMain) {
  if (request === 'electron') return electron;
  if (request === 'electron-updater') return { autoUpdater };
  return realLoad(request, parent, isMain);
};
/** A fresh updater.js, its listeners on a clean stand in. */
function fresh() {
  delete require.cache[require.resolve(FILE)];
  autoUpdater.removeAllListeners();
  return require(FILE);
}

(async () => {
  const quiet = console.log;
  const hush = () => { console.log = (...a) => { if (!String(a[0]).startsWith('[updater]')) quiet(...a); }; };
  const loud = () => { console.log = quiet; };

  // ── The flow, as the bar sees it ───────────────────────────────────────────
  {
    hush();
    let busy = false;
    const pushed = [];
    const u = fresh();
    u.init({ busy: () => busy, push: (v) => pushed.push(v), watchMs: 10 });
    loud();
    ok(autoUpdater.autoDownload === true && autoUpdater.autoInstallOnAppQuit === true && checks === 1,
      'electron-updater as it was: it downloads by itself, installs on quit, and checks as the app opens');
    ok(u.view() === null && pushed.length === 0, 'nothing to show: the bar is told nothing');
    hush();
    autoUpdater.emit('checking-for-update');
    autoUpdater.emit('update-available', { version: '9.1.1' });
    loud();
    ok(same(u.view(), { state: 'downloading', version: '9.1.1', percent: null }) && same(pushed[pushed.length - 1], u.view()),
      'a new version found: downloading, no percent yet, and the bar told', JSON.stringify(pushed));
    autoUpdater.emit('download-progress', { percent: 41.6 });
    autoUpdater.emit('download-progress', { percent: 41.9 });
    autoUpdater.emit('download-progress', { percent: 42.2 });
    ok(same(u.view(), { state: 'downloading', version: '9.1.1', percent: 42 })
      && pushed.filter((v) => v && v.percent === 41).length === 1 && pushed.filter((v) => v && v.percent === 42).length === 1,
      'its whole percent, the bar told once a whole percent, not on every chunk', JSON.stringify(pushed.map((v) => v && v.percent)));
    autoUpdater.emit('download-progress', { percent: NaN });
    autoUpdater.emit('download-progress', null);
    ok(u.view().percent === 42, 'a progress event with no number changes nothing');

    // A match starts: the bar is told null at once, and again once it ends.
    const before = pushed.length;
    busy = true;
    await wait(40);
    ok(u.view() === null && pushed.length === before + 1 && pushed[pushed.length - 1] === null,
      'a match starting mid download: nothing on the bar, told within the watch, once', JSON.stringify(pushed.slice(before)));
    hush();
    autoUpdater.emit('update-downloaded', { version: '9.1.1' });
    loud();
    await wait(40);
    ok(u.view() === null && installs === 0 && pushed[pushed.length - 1] === null,
      'downloaded while the player is playing: still nothing shown, nothing installed');
    ok(same(u.install(), { ok: false, error: 'match' }) && installs === 0, '"Restart to update" asked mid match is refused');
    busy = false;
    await wait(40);
    ok(same(u.view(), { state: 'ready', version: '9.1.1' }) && same(pushed[pushed.length - 1], { state: 'ready', version: '9.1.1' }),
      'the match over: ready, and the bar told', JSON.stringify(pushed[pushed.length - 1]));
    await wait(120);
    ok(installs === 0 && asked.length === 0, 'ready for as long as it sits there, nothing installs by itself and no question is asked');
    ok(u.getStatus().state === 'ready' && u.getStatus().version === '9.1.1' && u.getStatus().current === '9.1.0' && u.getStatus().packaged === true,
      'Settings reads the same: ready, the version, the one running', JSON.stringify(u.getStatus()));

    // The six hour check finding the same version: ready still, the bar not told again.
    const n = pushed.length;
    hush();
    autoUpdater.emit('checking-for-update');
    autoUpdater.emit('update-available', { version: '9.1.1' });
    autoUpdater.emit('update-not-available', {});
    autoUpdater.emit('error', new Error('offline'));
    loud();
    ok(same(u.view(), { state: 'ready', version: '9.1.1' }) && pushed.length === n && u.getStatus().state === 'ready',
      'a later check, finding it again, nothing new or failing, leaves it ready, the bar not told again', JSON.stringify(pushed.slice(n)));

    // Pressed: installs once, and says so.
    const r = u.install();
    ok(same(r, { ok: true }) && installs === 0, 'pressed: taken, the install a moment after the answer');
    ok(same(u.view(), { state: 'installing', version: '9.1.1' }) && same(pushed[pushed.length - 1], u.view()), 'and the bar told it is restarting');
    await wait(10);
    ok(installs === 1, 'quitAndInstall, once', `${installs}`);
    ok(same(u.install(), { ok: false, error: 'installing' }) && installs === 1, 'pressed again: nothing more');
  }

  // ── A newer version, and what is refused ───────────────────────────────────
  {
    hush();
    const pushed = [];
    const u = fresh();
    installs = 0;
    u.init({ busy: () => false, push: (v) => pushed.push(v), watchMs: 10 });
    ok(same(u.install(), { ok: false, error: 'not-ready' }), 'nothing downloaded: refused');
    autoUpdater.emit('update-available', { version: '9.1.1' });
    autoUpdater.emit('download-progress', { percent: 60 });
    ok(same(u.install(), { ok: false, error: 'not-ready' }) && installs === 0, 'mid download: refused');
    autoUpdater.emit('update-downloaded', { version: '9.1.1' });
    autoUpdater.emit('update-available', { version: '9.1.2' });
    loud();
    ok(same(u.view(), { state: 'downloading', version: '9.1.2', percent: null }) && same(u.install(), { ok: false, error: 'not-ready' }),
      'a newer version found while one is ready: that one downloads, and is the one a restart will install', JSON.stringify(u.view()));
    hush();
    autoUpdater.emit('error', new Error('feed gone'));
    loud();
    ok(u.view() === null && pushed[pushed.length - 1] === null && u.getStatus().state === 'offline',
      'its download failing: nothing shown (the one it superseded is not offered), and Settings says it could not reach the feed');
    hush();
    autoUpdater.emit('update-available', { version: '9.1.2' });
    autoUpdater.emit('update-downloaded', { version: '9.1.2' });
    loud();
    ok(same(u.view(), { state: 'ready', version: '9.1.2' }), 'the next check downloads it: ready');
    const throwing = fresh();
    hush();
    throwing.init({ busy: () => { throw new Error('state gone'); }, push: () => {}, watchMs: 10 });
    autoUpdater.emit('update-downloaded', { version: '9.1.3' });
    loud();
    ok(same(throwing.view(), { state: 'ready', version: '9.1.3' }), 'a busy() that throws counts as not playing');
    await wait(30);
  }

  // ── A run from the repo ────────────────────────────────────────────────────
  {
    electron.app.isPackaged = false;
    const u = fresh();
    const pushed = [];
    u.init({ busy: () => false, push: (v) => pushed.push(v) });
    autoUpdater.emit('update-downloaded', { version: '9.9.9' });
    ok(u.view() === null && same(u.install(), { ok: false, error: 'dev' }) && pushed.length === 0 && u.getStatus().state === 'dev',
      'npm start: never a check, never a control, never an install');
    electron.app.isPackaged = true;
  }

  // ── The code ───────────────────────────────────────────────────────────────
  const src = fs.readFileSync(FILE, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  ok(!/showMessageBox|\bdialog\b/.test(src), 'updater.js asks no question box', (src.match(/showMessageBox|\bdialog\b/) || [''])[0]);
  ok((src.match(/quitAndInstall\(/g) || []).length === 1 && /function install\(\)[\s\S]*quitAndInstall\(\)/.test(src),
    'quitAndInstall is called in one place, install(), the bar\'s press');
  ok(/showMessageBox/.test('dialog.showMessageBox({})') && !/showMessageBox|\bdialog\b/.test('autoUpdater.quitAndInstall()'), 'the question detector finds a question box');

  const idx = fs.readFileSync(path.join(ROOT, 'src', 'main', 'index.js'), 'utf8');
  const call = /updater\.init\(\{\s*busy:\s*\(\)\s*=>\s*([^\n]+?),\s*push:\s*\(v\)\s*=>\s*registry\.sendTo\('main', C\.PUSH_UPDATE, v\)\s*\}\)/.exec(idx);
  ok(call && /state\.isCoaching/.test(call[1]) && /sealHeld/.test(call[1]) && /reviewBeingBuilt\(\)/.test(call[1])
    && /function reviewBeingBuilt\([^)]*\) \{[\s\S]*?HOLD_MAX_MS[\s\S]*?\n\}/.test(idx),
    'index.js says the player is playing while a session runs, a stop mid match holds the seal, or a review is still being built, and tells the bar alone',
    call ? call[1].trim() : 'no busy() and push handed over');
  const reg = fs.readFileSync(path.join(ROOT, 'src', 'main', 'ipc', 'register-ipc.js'), 'utf8');
  ok(/safeHandle\(C\.UPDATE_GET, async \(\) => updater\.view\(\)\)/.test(reg)
    && /safeHandle\(C\.UPDATE_INSTALL, async \(e\) => \(fromPage\(e, 'main'\) \? updater\.install\(\) : \{ ok: false, error: 'not-ready' \}\)\)/.test(reg),
  'register-ipc.js answers the bar with view(), and takes the install from the bar\'s own document alone');
  const C = require('../src/shared/channels');
  ok(C.UPDATE_GET && C.UPDATE_INSTALL && C.PUSH_LIST.includes(C.PUSH_UPDATE), 'the channels are in channels.js, the push on its list');

  console.log(failed ? `FAIL: ${failed} of ${passed + failed} updater checks failed` : `PASS: all ${passed} updater checks passed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.log('FAIL: the test threw: ' + ((e && e.stack) || e)); process.exit(1); });

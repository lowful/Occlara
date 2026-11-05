'use strict';

/**
 * The update's restart question is never asked while the player is playing
 * (src/main/updater.js). The download lands whenever it lands, a check every
 * six hours, and the question came up over the game mid round, a window
 * nothing may put on the screen while a match is played, where "Restart now"
 * quit the recording and the review still being built with it.
 *
 * The real updater.js, with Electron and electron-updater as stand ins: no
 * window, no network.
 *
 * Run: npm run test:updater
 */

const path = require('path');
const Module = require('module');
const EventEmitter = require('events');

let passed = 0;
let failed = 0;
function ok(cond, what, detail) {
  if (cond) { passed++; console.log(`ok    ${what}`); } else { failed++; console.log(`FAIL  ${what}${detail ? ` (${detail})` : ''}`); }
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const asked = [];
let answer = 1;
const electron = {
  app: { isPackaged: true, getVersion: () => '8.3.0' },
  dialog: { showMessageBox: async (o) => { asked.push(o); return { response: answer }; } },
};
const autoUpdater = new EventEmitter();
let installs = 0;
autoUpdater.checkForUpdates = async () => null;
autoUpdater.quitAndInstall = () => { installs += 1; };
const realLoad = Module._load;
Module._load = function patched(request, parent, isMain) {
  if (request === 'electron') return electron;
  if (request === 'electron-updater') return { autoUpdater };
  return realLoad(request, parent, isMain);
};
const updater = require(path.join(__dirname, '..', 'src', 'main', 'updater.js'));

(async () => {
  const quiet = console.log;
  let busy = true;
  let throwing = false;
  updater.init({ busy: () => { if (throwing) throw new Error('state gone'); return busy; }, retryMs: 20 });
  console.log = (...a) => { if (!String(a[0]).startsWith('[updater]')) quiet(...a); };

  autoUpdater.emit('update-downloaded', { version: '8.3.1' });
  await wait(120);
  ok(asked.length === 0 && updater.getStatus().state === 'ready',
    'an update downloaded while the player is playing: ready, and nothing asked, for as long as it lasts', `${asked.length} asked`);
  // A session can outlast the six hour check: a newer release downloaded
  // meanwhile is the one a restart installs, and the one the question names.
  autoUpdater.emit('update-downloaded', { version: '8.3.2' });
  busy = false;
  await wait(120);
  ok(asked.length === 1 && /Occlara 8\.3\.2 is ready/.test(asked[0].message) && installs === 0,
    'asked once the player stops playing, once however often one was downloaded, naming the newest, and "Later" restarts nothing',
    `${asked.length} asked: ${asked.map((a) => a.message).join(' | ')}`);
  console.log = quiet;

  // A busy() that throws is not a reason to hold the question for ever.
  for (const k of Object.keys(require.cache)) if (k.endsWith(`${path.sep}updater.js`)) delete require.cache[k];
  const again = require(path.join(__dirname, '..', 'src', 'main', 'updater.js'));
  answer = 0;
  throwing = true;
  console.log = (...a) => { if (!String(a[0]).startsWith('[updater]')) quiet(...a); };
  autoUpdater.removeAllListeners();
  again.init({ busy: () => { if (throwing) throw new Error('state gone'); return busy; }, retryMs: 20 });
  autoUpdater.emit('update-downloaded', { version: '8.3.2' });
  await wait(60);
  console.log = quiet;
  ok(asked.length === 2 && installs === 1, 'a busy() that throws counts as not playing, and "Restart now" installs', `${asked.length} asked, ${installs} installs`);

  // C2 (2026-11-04): the question opened while the player was idle, stayed
  // open as a match began, and "Restart now" pressed mid match quit it at once.
  // An answer is checked against playing again, and the box closes itself the
  // moment a match starts, to be asked again once it is over.
  const fresh = () => {
    for (const k of Object.keys(require.cache)) if (k.endsWith(`${path.sep}updater.js`)) delete require.cache[k];
    autoUpdater.removeAllListeners();
    return require(path.join(__dirname, '..', 'src', 'main', 'updater.js'));
  };
  {
    const held = [];
    electron.dialog.showMessageBox = (o) => new Promise((resolve) => {
      held.push({ o, resolve });
      asked.push(o);
    });
    throwing = false;
    busy = false;
    const before = installs;
    const asksBefore = asked.length;
    const u = fresh();
    console.log = (...a) => { if (!String(a[0]).startsWith('[updater]')) quiet(...a); };
    u.init({ busy: () => busy, retryMs: 20 });
    autoUpdater.emit('update-downloaded', { version: '8.3.3' });
    await wait(10);
    busy = true;
    held[0].resolve({ response: 0 });
    await wait(60);
    ok(installs === before, '"Restart now" answered after a match began installs nothing while it is played', `${installs - before} installs`);
    busy = false;
    await wait(80);
    ok(asked.length === asksBefore + 2 && installs === before,
      'and the question is asked again once the match is over, nothing installed meanwhile', `${asked.length - asksBefore} asked`);
    held[1].resolve({ response: 0 });
    await wait(30);
    ok(installs === before + 1, 'and "Restart now" then installs', `${installs - before} installs`);
    console.log = quiet;
  }
  {
    // The box closes itself as a match starts, by its signal.
    const held = [];
    electron.dialog.showMessageBox = (o) => new Promise((resolve) => {
      held.push({ o, resolve });
      asked.push(o);
      if (o.signal) o.signal.addEventListener('abort', () => resolve({ response: o.cancelId }));
    });
    busy = false;
    const before = installs;
    const u = fresh();
    console.log = (...a) => { if (!String(a[0]).startsWith('[updater]')) quiet(...a); };
    u.init({ busy: () => busy, retryMs: 20 });
    autoUpdater.emit('update-downloaded', { version: '8.3.4' });
    await wait(10);
    const first = held[0];
    busy = true;
    await wait(80);
    ok(first && first.o.signal && first.o.signal.aborted && held.length === 1,
      'a question left open as a match starts closes itself, and is not asked again while it is played', `${held.length} asked`);
    busy = false;
    await wait(80);
    ok(held.length === 2 && installs === before, 'and is asked again once it is over', `${held.length} asked`);
    console.log = quiet;
  }

  // What playing is, as index.js hands it over.
  const idx = require('fs').readFileSync(path.join(__dirname, '..', 'src', 'main', 'index.js'), 'utf8');
  const call = /updater\.init\(\{\s*busy:\s*\(\)\s*=>\s*([^}]+)\}\)/.exec(idx);
  ok(call && /state\.isCoaching/.test(call[1]) && /sealHeld/.test(call[1]) && /reviewBeingBuilt\(\)/.test(call[1])
    && /function reviewBeingBuilt\([^)]*\) \{[\s\S]*?HOLD_MAX_MS[\s\S]*?\n\}/.test(idx),
    'index.js says the player is playing while a session runs, a stop mid match holds the seal, or a review is still being built',
    call ? call[1].trim() : 'no busy() handed over');

  console.log(failed ? `FAIL: ${failed} of ${passed + failed} updater checks failed` : `PASS: all ${passed} updater checks passed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.log('FAIL: the test threw: ' + ((e && e.stack) || e)); process.exit(1); });

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

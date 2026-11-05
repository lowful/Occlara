'use strict';

/**
 * A page writes only the settings it owns (CONFIG_SET, src/main/ipc/register-ipc.js,
 * src/main/ipc/config-keys.js).
 *
 * The handler wrote any key a page handed it but the account's, so a page bug
 * or an injected script could revive a refused licence locally
 * (licenseStatus, licenseExpiry, licenseRefused, which isLocallyValid reads)
 * or overwrite the key, the device id and other state only main writes.
 *
 * The real handler, with Electron and the store as stand ins.
 *
 * Run: npm run test:configset
 */

const fs = require('fs');
const path = require('path');
const Module = require('module');

let passed = 0;
let failed = 0;
function ok(cond, what, detail) {
  if (cond) { passed++; console.log(`ok    ${what}`); } else { failed++; console.log(`FAIL  ${what}${detail ? ` (${detail})` : ''}`); }
}

const handlers = new Map();
const data = { licenseStatus: 'refused', licenseRefused: true, licenseExpiry: '2026-01-01', licenseKey: 'GC-REAL', deviceId: 'dev-1', game: 'valorant' };
const store = { get: (k) => data[k], set: (k, v) => { data[k] = v; } };
const electron = {
  ipcMain: { handle: (ch, fn) => handlers.set(ch, fn), on: (ch, fn) => handlers.set(ch, fn) },
  shell: { openExternal: () => {} },
  app: { isPackaged: false, getVersion: () => '0.0.0', getPath: () => require('os').tmpdir(), on: () => {} },
  dialog: {},
};
const realLoad = Module._load;
Module._load = function patched(request, parent, isMain) {
  if (request === 'electron') return electron;
  if (request === 'electron-updater') return { autoUpdater: { on: () => {} } };
  if (/[\\/]services[\\/]store$/.test(request) || request === '../services/store') return store;
  return realLoad(request, parent, isMain);
};
const C = require('../src/shared/channels');
const registerIpc = require('../src/main/ipc/register-ipc');
const { WRITABLE, pageWritable } = require('../src/main/ipc/config-keys');
let changed = 0;
registerIpc({ controller: { onConfigChanged: () => { changed++; } }, license: {} });
const set = handlers.get(C.CONFIG_SET);

(async () => {
  ok(typeof set === 'function', 'CONFIG_SET is registered');

  const before = { ...data };
  const res = await set({}, {
    licenseStatus: 'active', licenseExpiry: '2099-01-01', licenseRefused: false, licenseKey: 'GC-FAKE',
    deviceId: 'dev-2', recordingReportPending: true, valorantHistory: [], onboardingCompleted: true,
    accountToken: 'x', __proto__: { polluted: true }, constructor: 'x',
  });
  ok(res && res.ok === true, 'a write of keys no page owns still answers ok');
  ok(['licenseStatus', 'licenseExpiry', 'licenseRefused', 'licenseKey', 'deviceId'].every((k) => data[k] === before[k])
    && !('recordingReportPending' in data) && !('valorantHistory' in data) && !('onboardingCompleted' in data) && !('accountToken' in data)
    && !Object.prototype.hasOwnProperty.call(data, 'constructor') && !({}).polluted,
  'and the licence fields, the key, the device id and every key only main writes are left as they were', JSON.stringify(data));

  data.game = 'none';
  await set({}, {
    captureSpeed: 2000, captureQuality: 'performance', advancedTips: true, aiLog: false, sounds: false, ailogHintSeen: 3,
    riotId: 'Name#EUW', language: 'de', game: 'valorant', recordingMode: 'off', recordingRes: '1080', clipCapGB: 20,
  });
  ok(data.captureSpeed === 2000 && data.captureQuality === 'performance' && data.advancedTips === true && data.aiLog === false
    && data.sounds === false && data.ailogHintSeen === 3 && data.riotId === 'Name#EUW' && data.language === 'de' && data.game === 'valorant'
    && data.recordingMode === 'off' && data.recordingRes === '1080' && data.clipCapGB === 20,
  'every setting Settings, onboarding and the AI log write is written', JSON.stringify(data));

  await set({}, {
    captureSpeed: 'fast', captureQuality: 'ultra', advancedTips: 'yes', ailogHintSeen: -1, riotId: 'x'.repeat(200),
    language: 'xx', game: 'rivals', recordingMode: 'on', recordingRes: 720, clipCapGB: 7,
  });
  ok(data.captureSpeed === 2000 && data.captureQuality === 'performance' && data.advancedTips === true && data.ailogHintSeen === 3
    && data.riotId === 'Name#EUW' && data.language === 'de' && data.game === 'valorant' && data.recordingMode === 'off'
    && data.recordingRes === '1080' && data.clipCapGB === 20,
  'and a value its key cannot hold is dropped, a retired game among them', JSON.stringify(data));
  ok(pageWritable({ riotId: 'Nam' }).riotId === 'Nam' && pageWritable({ captureSpeed: 'auto' }).captureSpeed === 'auto',
    'a Riot ID typed before its # and Auto speed are values');
  ok(JSON.stringify(pageWritable({ game: 'lol' })) === '{}', 'and a game that is coming soon is not one');
  ok(changed === 3 && JSON.stringify(pageWritable(null)) === '{}' && JSON.stringify(pageWritable([1])) === '{}',
    'nothing and a list write nothing');

  // Every key a page writes is on the list (the same reading as check:config).
  const written = new Set();
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.js')) {
        const src = fs.readFileSync(p, 'utf8');
        for (const m of src.matchAll(/setConfig\(\s*\{([^}]*)\}/g)) {
          for (const km of m[1].matchAll(/([a-zA-Z_][\w]*)\s*:/g)) written.add(km[1]);
        }
        for (const m of src.matchAll(/wire(?:Bool)?Seg\([^,]+,\s*'([a-zA-Z_]\w*)'\)/g)) written.add(m[1]);
      }
    }
  };
  walk(path.join(__dirname, '..', 'src', 'renderer'));
  ok(written.has('aiLog') && written.has('recordingRes') && [...written].every((k) => WRITABLE.includes(k)),
    'every key a page writes is one it may write', [...written].filter((k) => !WRITABLE.includes(k)).join(', '));

  console.log(failed ? `FAIL: ${failed} of ${passed + failed} config write checks failed` : `PASS: all ${passed} config write checks passed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.log('FAIL: the test threw: ' + ((e && e.stack) || e)); process.exit(1); });

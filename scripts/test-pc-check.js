'use strict';

/**
 * The PC check behind onboarding's How Occlara watches page (8.3.1): the rules
 * that recommend Record gameplay or Frames only, and at what size
 * (src/renderer/onboarding/pc-rules.js), on every branch; what main tells the
 * page about this PC (src/main/services/pc-check.js), each fact read on its
 * own; and that the page asks the GPU's encoder exactly what the recorder
 * asks it before a recording. That last one is held end to end: the asks main
 * hands the page against the start the real Recorder sends its page for the
 * same display, and the config the onboarding page puts to VideoEncoder
 * against the one the real recorder page's gate puts to it.
 *
 * What the page does with all of this (the pre selection, what it saves, what
 * it never overwrites) is test:surfaces' onboarding section, and the page in
 * the real app is check:onboardingriot's.
 *
 * Run: npm run test:pccheck
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { loadSurface, settle } = require('./fixtures/fake-dom');
const C = require('../src/shared/channels');
const rules = require('../src/renderer/onboarding/pc-rules');
const pcCheck = require('../src/main/services/pc-check');
const recorder = require('../src/main/services/recorder');

const ROOT = path.join(__dirname, '..');
const GB = 1024 * 1024 * 1024;
// The two dashes the house rules ban, as escapes so this file carries neither.
const DASHES = /[\u2013\u2014]/;

let fails = 0;
const ok = (cond, what, detail) => {
  if (!cond) { fails++; console.log(`FAIL  ${what}${detail ? `\n        ${detail}` : ''}`); }
  else console.log(`ok    ${what}`);
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
async function section(title, fn) {
  console.log(`\n${title}`);
  try { await fn(); } catch (e) { ok(false, 'the section ran to the end', (e && e.stack) || String(e)); }
}

// A PC that records at 1080p, the one 8.3 was built on: an RTX 5060, 16
// threads, 31.8 GB of RAM as Windows reports a 32 GB PC, one 1920x1080
// display and 103 GB free on C:. Each case below changes one thing.
const BIG = {
  gpu: 'NVIDIA GeForce RTX 5060', threads: 16, ramBytes: 31.84 * GB, display: { width: 1920, height: 1080 },
  freeBytes: 103.4 * GB, drive: 'C:', encoder: { 720: true, 1080: true },
};
const pc = (over) => Object.assign({}, BIG, over);
const pick = (r) => `${r.tier} ${r.mode} ${r.res} ${r.recordable ? 'recordable' : 'not recordable'}`;

(async () => {
  await section('the rules, every branch:', () => {
    const big = rules.recommend(BIG);
    ok(pick(big) === 'capable auto 1080 recordable' && big.why === 'This PC can record at 1080p.' && big.tone === 'good',
      'a capable PC records at 1080p', pick(big));

    // 1. Nothing to record with: Record cannot be chosen.
    const none = rules.recommend(pc({ encoder: { 720: false, 1080: false } }));
    ok(pick(none) === 'none off 720 not recordable' && /no hardware video encoder/.test(none.why) && none.tone === 'warn',
      'no hardware encoder at either size: Frames only, and Record cannot be chosen', pick(none));
    const disk = rules.recommend(pc({ freeBytes: 5.26 * GB }));
    ok(pick(disk) === 'disk off 720 not recordable'
      && disk.why === 'Recording needs 8 GB free on C:, and it has 5.2 GB. Free some space, then turn it on in Settings.',
    'under 8 GB free: Frames only, Record cannot be chosen, and the line names the drive and its space', disk.why);
    ok(rules.recommend(pc({ freeBytes: 8 * GB })).tier === 'capable' && rules.recommend(pc({ freeBytes: 8 * GB - 1 })).tier === 'disk',
      'exactly 8 GB free records, one byte under does not (the recorder starts at 8)');
    ok(rules.MIN_FREE_BYTES === recorder.DISK_START_BYTES, 'the free space floor is the recorder\'s own DISK_START_BYTES');
    ok(/on this drive/.test(rules.recommend(pc({ freeBytes: GB, drive: null })).why), 'with no drive letter it says this drive');
    ok(rules.recommend(pc({ encoder: { 720: false, 1080: false }, freeBytes: GB })).tier === 'none',
      'no encoder outranks no space: the encoder is the one a player cannot fix');

    // 2. A modest PC: Frames only recommended, Record still a choice.
    const lowRam = rules.recommend(pc({ ramBytes: 3.8 * GB }));
    ok(pick(lowRam) === 'modest off 720 recordable'
      && lowRam.why === 'With 4 GB of RAM, recording could slow your game. You can still record: it stops by itself if the PC cannot keep up.',
    'under 8 GB of RAM: Frames only is recommended, and Record can still be chosen', lowRam.why);
    const lowCpu = rules.recommend(pc({ threads: 2 }));
    ok(pick(lowCpu) === 'modest off 720 recordable' && /^With 2 CPU threads,/.test(lowCpu.why), 'under 4 threads: the same', lowCpu.why);
    ok(/^With 1 CPU thread,/.test(rules.recommend(pc({ threads: 1 })).why), 'one thread is a thread, not threads');
    ok(/^With 4 GB of RAM and 2 CPU threads,/.test(rules.recommend(pc({ ramBytes: 3.5 * GB, threads: 2 })).why), 'both short: both named');
    ok(rules.recommend(pc({ ramBytes: 7.4 * GB })).tier === 'capable' && rules.recommend(pc({ threads: 4 })).tier === 'capable',
      'an 8 GB PC (7.4 as Windows reports it) and a 4 thread one are not modest');
    ok(rules.recommend(pc({ ramBytes: 3.8 * GB, encoder: { 720: false, 1080: false } })).tier === 'none'
      && rules.recommend(pc({ ramBytes: 3.8 * GB, freeBytes: GB })).tier === 'disk', 'what cannot record outranks what is modest');

    // 3. The encoder never answered.
    const unknown = rules.recommend(pc({ encoder: {} }));
    ok(pick(unknown) === 'unknown auto 720 recordable' && /could not be checked/.test(unknown.why) && unknown.tone === '',
      'an encoder that never answered: Record at 720p, the recorder\'s own default', pick(unknown));
    ok(rules.recommend(pc({ encoder: { 720: null, 1080: null }, ramBytes: 3.8 * GB })).tier === 'modest',
      'a modest PC is modest whatever the encoder said');
    ok(rules.recommend({}).tier === 'unknown' && rules.recommend(null).tier === 'unknown', 'a check that found nothing at all is unknown');

    // 4. Capable, at 720p when anything 1080p wants is short, saying which.
    const why720 = (over) => rules.recommend(pc(over)).why;
    ok(why720({ encoder: { 720: true, 1080: false } }) === 'This PC can record at 720p. Its encoder does not take 1080p.',
      'an encoder that takes 720p only: 720p, and why');
    ok(why720({ encoder: { 720: true, 1080: null } }) === 'This PC can record at 720p. Its encoder did not answer for 1080p.',
      'an encoder that never answered for 1080p is not called one that refused it');
    ok(why720({ display: { width: 1600, height: 900 } }) === 'This PC can record at 720p. 1080p is for a display of 1920x1080 or more.'
      && rules.recommend(pc({ display: { width: 2560, height: 1000 } })).res === '720'
      && rules.recommend(pc({ display: null })).res === '720', 'a display under 1920x1080 in either direction, or none known: 720p');
    ok(why720({ ramBytes: 11.8 * GB }) === 'This PC can record at 720p. 1080p is for 16 GB of RAM or more.'
      && rules.recommend(pc({ ramBytes: null })).res === '720', 'under 16 GB of RAM, or none known: 720p');
    ok(why720({ threads: 6 }) === 'This PC can record at 720p. 1080p is for 8 CPU threads or more.'
      && rules.recommend(pc({ threads: null })).res === '720', 'under 8 threads, or none known: 720p');
    ok(rules.recommend(pc({ ramBytes: 15.4 * GB, threads: 8, display: { width: 3440, height: 1440 } })).res === '1080',
      'a 16 GB PC as Windows reports it, 8 threads, a wider display: 1080p');
    const only1080 = rules.recommend(pc({ encoder: { 720: false, 1080: true }, ramBytes: 7.9 * GB }));
    ok(only1080.res === '1080' && only1080.mode === 'auto' && only1080.sizes[720] === false && only1080.sizes[1080] === true,
      'an encoder that refused 720p and took 1080p records at 1080p, the one size it can', pick(only1080));
    const sizes = rules.recommend(pc({ encoder: { 720: true, 1080: false } })).sizes;
    ok(sizes[720] === true && sizes[1080] === false, 'a size the encoder refused cannot be chosen; one it never answered for can');
  });

  await section('memory as it is sold, and space in words:', () => {
    const cases = [[3.5, 4], [5.9, 6], [7.4, 8], [7.9, 8], [11.8, 12], [13.9, 16], [15.4, 16], [15.95, 16], [19.8, 20], [31.84, 32], [63.7, 64]];
    const got = cases.map(([g]) => rules.installedGB(g * GB));
    ok(same(got, cases.map((c) => c[1])), 'what Windows reports is taken up to the size it was sold as', JSON.stringify(got));
    ok(rules.installedGB(0) === null && rules.installedGB(NaN) === null && rules.installedGB(undefined) === null, 'nothing read is null, never 0 GB');
    ok(rules.gbText(103.4 * GB) === '103 GB' && rules.gbText(5.26 * GB) === '5.2 GB' && rules.gbText(7.99 * GB) === '7.9 GB',
      'space is rounded down, so a drive just short of 8 GB never reads 8.0', `${rules.gbText(7.99 * GB)}`);
  });

  await section('what the page lists:', () => {
    const rows = rules.factRows(BIG);
    ok(same(rows.map((r) => `${r.k} ${r.v}`), ['GPU NVIDIA GeForce RTX 5060', 'Encoder 720p and 1080p', 'CPU 16 threads', 'RAM 32 GB',
      'Display 1920x1080', 'Free 103 GB on C:']), 'the GPU, the encoder, the threads, the RAM, the display and the free space', JSON.stringify(rows));
    ok(rows[0].wide === true && rows.slice(1).every((r) => !r.wide), 'the GPU on a row of its own');
    const enc = (e) => rules.encoderText(e);
    ok(enc({ 720: true, 1080: true }) === '720p and 1080p' && enc({ 720: true, 1080: false }) === '720p' && enc({ 720: false, 1080: true }) === '1080p'
      && enc({ 720: false, 1080: false }) === 'None found' && enc({}) === 'Not checked' && enc({ 720: null, 1080: false }) === 'Not checked',
    'the encoder in words: the sizes it takes, none, or not checked');
    const blank = rules.factRows({});
    ok(blank.every((r) => r.k === 'Encoder' ? r.v === 'Not checked' : r.v === 'Not known'), 'a fact not read says so, and never a number');
  });

  await section('the words, in every branch:', () => {
    const branches = [BIG, pc({ encoder: { 720: false, 1080: false } }), pc({ freeBytes: GB }), pc({ ramBytes: 3 * GB, threads: 2 }),
      pc({ encoder: {} }), pc({ encoder: { 720: true, 1080: false } }), pc({ encoder: { 720: true, 1080: null } }),
      pc({ display: { width: 1600, height: 900 } }), pc({ ramBytes: 12 * GB }), pc({ threads: 6 })];
    const words = branches.map((f) => rules.recommend(f).why).concat(...branches.map((f) => rules.factRows(f).map((r) => `${r.k} ${r.v}`)));
    ok(DASHES.test('a\u2014b') && DASHES.test('a\u2013b') && !DASHES.test('a-b'), 'the dash detector catches both dashes and not a hyphen');
    ok(!words.some((w) => DASHES.test(w)), 'no dash in any line the rules write');
    // The check is of the PC, never of the game: no line says the screen is read.
    ok(!words.some((w) => /screen/i.test(w)), 'no line the rules write says anything is read off the screen');
  });

  await section('what main tells the page (pc-check.js):', async () => {
    const basic = { gpuDevice: [
      { active: false, vendorId: 4318, deviceId: 11525, deviceString: 'NVIDIA GeForce RTX 5060' },
      { active: false, vendorId: 5140, deviceId: 140, deviceString: 'Microsoft Basic Render Driver' },
    ] };
    ok(pcCheck.gpuName(basic) === 'NVIDIA GeForce RTX 5060', "getGPUInfo('basic') as this PC answered it: the GPU, not the software adapter");
    ok(pcCheck.gpuName({ gpuDevice: [{ vendorId: 5140, deviceString: 'Microsoft Basic Render Driver' }, { vendorId: 32902, deviceString: 'Intel(R) UHD Graphics 770' }] })
      === 'Intel(R) UHD Graphics 770', 'listed first, the software adapter is still passed over');
    // The vendor is a rule of its own, not only the name: an adapter under
    // Microsoft's software vendor id by another name is passed over too.
    ok(pcCheck.gpuName({ gpuDevice: [{ vendorId: 5140, deviceString: 'Microsoft Remote Display Adapter' }, { vendorId: 4318, deviceString: 'NVIDIA GeForce RTX 5060' }] })
      === 'NVIDIA GeForce RTX 5060', "and one under Microsoft's software vendor id (0x1414) by any other name");
    // As 'complete' named it here with hardware acceleration off: under
    // SwANGLE's vendor 65535, so only its name gives it away.
    ok(pcCheck.gpuName({ gpuDevice: [
      { active: true, vendorId: 65535, deviceString: 'ANGLE (Microsoft, Microsoft Basic Render Driver (0x0000008C) Direct3D11 vs_5_0 ps_5_0, D3D11-10.0.26100.9278)' },
      { vendorId: 4318, deviceString: 'NVIDIA GeForce RTX 5060' },
    ] }) === 'NVIDIA GeForce RTX 5060', 'and under another vendor, by its name, even marked active');
    ok(pcCheck.gpuName({ gpuDevice: [{ vendorId: 32902, deviceString: 'Intel(R) UHD Graphics' }, { vendorId: 4318, deviceString: 'NVIDIA GeForce RTX 4060 Laptop GPU', active: true }] })
      === 'NVIDIA GeForce RTX 4060 Laptop GPU', "the one marked active wins, as 'complete' marks the GPU in use");
    ok(pcCheck.gpuName({ gpuDevice: [] }) === null && pcCheck.gpuName(null) === null
      && pcCheck.gpuName({ gpuDevice: [{ vendorId: 4318, deviceString: '  ' }] }) === null, 'no name to give is null');
    ok(same(pcCheck.physical({ size: { width: 1536, height: 864 }, scaleFactor: 1.25 }), { width: 1920, height: 1080 })
      && same(pcCheck.physical({ size: { width: 1920, height: 1080 }, scaleFactor: 1 }), { width: 1920, height: 1080 })
      && pcCheck.physical(null) === null, 'the display in physical pixels: 1536x864 at 125% is the 1920x1080 it is');
    // driveOf reads a folder by the path rules of the platform it runs on, as
    // the app does: a Windows folder has a drive letter, and a macOS or Linux
    // one (CI runs on Linux) has none, which is null.
    if (process.platform === 'win32') {
      ok(pcCheck.driveOf('C:\\Users\\p\\AppData\\Roaming\\Occlara\\recording') === 'C:' && pcCheck.driveOf('D:\\Games\\Occlara\\recording') === 'D:',
        'the drive the recordings go to, by its letter');
    } else {
      ok(pcCheck.driveOf('/home/p/.config/Occlara/recording') === null && pcCheck.driveOf('/Volumes/Games/Occlara/recording') === null,
        'no drive letter where the platform has none', String(pcCheck.driveOf('/home/p/.config/Occlara/recording')));
    }
    ok(same(pcCheck.asks({ width: 1920, height: 1080 }), [
      { res: '720', width: 1280, height: 720, codec: 'avc1.42E01F', bitrate: 3e6 },
      { res: '1080', width: 1920, height: 1080, codec: 'avc1.42E028', bitrate: 6e6 },
    ]), 'on a 1920x1080 display the asks are 1280x720 at avc1.42E01F and 3 Mbps, 1920x1080 at avc1.42E028 and 6 Mbps');
    ok(same(pcCheck.asks(null), pcCheck.asks({ width: 1920, height: 1080 })), 'with no display known, the boxes themselves');

    const seen = [];
    // userData as the platform running this spells it, and the drive driveOf
    // finds in it there: C: on Windows, none on macOS or Linux.
    const USER_DATA = process.platform === 'win32' ? 'C:\\Users\\p\\AppData\\Roaming\\Occlara' : '/home/p/.config/Occlara';
    const DRIVE = process.platform === 'win32' ? 'C:' : null;
    const app = (over) => Object.assign({
      getGPUInfo: async (kind) => { seen.push(kind); return basic; },
      getPath: (n) => (n === 'userData' ? USER_DATA : null),
    }, over);
    const screen = (over) => Object.assign({ getPrimaryDisplay: () => ({ size: { width: 2560, height: 1440 }, scaleFactor: 1 }) }, over);
    const os = (over) => Object.assign({ cpus: () => Array(16).fill({ model: ' Intel(R) Core(TM) i5-14400F ' }), totalmem: () => 31.84 * GB }, over);
    const free = [];
    const deps = (o) => Object.assign({ app: app(), screen: screen(), os: os(), freeBytes: (dir) => { free.push(dir); return 103.4 * GB; }, log: () => {} }, o);
    const got = await pcCheck.gather(deps());
    ok(got.ok === true && got.gpu === 'NVIDIA GeForce RTX 5060' && got.cpu === 'Intel(R) Core(TM) i5-14400F' && got.threads === 16
      && got.ramBytes === 31.84 * GB && same(got.display, { width: 2560, height: 1440 }) && got.freeBytes === 103.4 * GB && got.drive === DRIVE,
    'every fact, as each source gave it', JSON.stringify(got));
    ok(seen[0] === 'basic', "the GPU is asked with getGPUInfo('basic'), 22 ms here where 'complete' took 260");
    ok(free[0] === path.join(USER_DATA, 'recording'), 'the free space of the folder the recordings go to', free[0]);
    ok(same(got.asks, pcCheck.asks({ width: 2560, height: 1440 })), 'and the asks for the display it found');

    const hung = await pcCheck.gather(deps({ app: app({ getGPUInfo: () => new Promise(() => {}) }), gpuWaitMs: 20 }));
    ok(hung.gpu === null && hung.threads === 16, 'a getGPUInfo that never answers costs the GPU name and nothing else');
    const broken = await pcCheck.gather(deps({
      app: app({ getGPUInfo: async () => { throw new Error('GPU process gone'); } }),
      screen: screen({ getPrimaryDisplay: () => { throw new Error('no display'); } }),
      os: os({ cpus: () => { throw new Error('no cpus'); }, totalmem: () => { throw new Error('no memory'); } }),
      freeBytes: () => { throw new Error('no drive'); },
    }));
    ok(broken.ok === true && broken.gpu === null && broken.threads === null && broken.cpu === null && broken.ramBytes === null
      && broken.display === null && broken.freeBytes === null && broken.drive === DRIVE && same(broken.asks, pcCheck.asks(null)),
    'every source failing at once: each fact null, the asks still the boxes, and an answer all the same', JSON.stringify(broken));
    const nan = await pcCheck.gather(deps({ os: os({ cpus: () => [], totalmem: () => 0 }), freeBytes: () => NaN }));
    ok(nan.threads === null && nan.ramBytes === null && nan.freeBytes === null, 'zero threads, zero memory and NaN free space are not known, not facts');
  });

  await section('the check asks the encoder what a recording asks it:', async () => {
    // What the real Recorder sends its page to start a recording, for one
    // display and one size: the page's gate is asked these very numbers.
    async function startOf(display, res) {
      const sent = [];
      const page = { send: (m) => sent.push(m), pid: () => 1, close() {}, onMessage() {} };
      const prefs = { data: { recordingMode: 'auto', recordingRes: res, recordingStrikes: [], recordingAutoOff: null, recordingLast: null },
        get(k) { return this.data[k]; }, set(k, v) { this.data[k] = v; } };
      const timers = { setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {} };
      const files = { mkdir() {}, write() {}, append() {}, read: () => Buffer.alloc(0), remove() {}, removeTree() {}, list: () => [] };
      const rec = new recorder.Recorder({
        root: path.resolve('/occlara-pc-check/recording'), prefs, files, timers, now: () => 1e12,
        page: async () => page, source: async () => ({ sourceId: 'screen:0:0', displayId: 1, display }),
        freeBytes: () => 100 * GB, log: () => {},
      });
      rec.startSession('valorant');
      for (let i = 0; i < 50 && !sent.some((m) => m.type === 'start'); i++) await new Promise((r) => setImmediate(r));
      const s = sent.find((m) => m.type === 'start');
      return s ? { res, width: s.width, height: s.height, codec: s.codec, bitrate: s.bitrate } : null;
    }
    const displays = [[1920, 1080], [2560, 1440], [3840, 2160], [3440, 1440], [1920, 1200], [1366, 768], [1280, 1024], [5120, 1440]];
    const off = [];
    for (const [width, height] of displays) {
      const display = { width, height };
      const want = [await startOf(display, '720'), await startOf(display, '1080')];
      if (!same(pcCheck.asks(display), want)) off.push(`${width}x${height}: check ${JSON.stringify(pcCheck.asks(display))} recorder ${JSON.stringify(want)}`);
    }
    ok(!off.length, `main hands the page the asks the real Recorder starts with, on ${displays.length} displays at both sizes`, off.join('\n        '));

    // The real recorder page's gate, run as the page runs it, with a VideoEncoder that writes down what it is asked.
    const gateAsked = [];
    let command = null;
    const page = {
      console: { log() {}, warn() {}, error() {} }, setTimeout, clearTimeout, setInterval, clearInterval,
      performance: { now: () => 0 }, addEventListener() {},
      OffscreenCanvas: class { getContext() { return {}; } },
      VideoEncoder: { isConfigSupported: async (c) => { gateAsked.push(c); return { supported: true }; } },
      occlaraRecorder: { status() {}, chunk() {}, reply() {}, onCommand: (fn) => { command = fn; } },
    };
    page.window = page;
    vm.createContext(page);
    for (const f of ['health.js', 'recorder.js']) {
      const file = path.join(ROOT, 'src', 'renderer', 'recorder', f);
      vm.runInContext(fs.readFileSync(file, 'utf8'), page, { filename: file });
    }
    const asks = pcCheck.asks({ width: 1920, height: 1080 });
    asks.forEach((a, i) => command({ type: 'gate', id: i + 1, codec: a.codec, width: a.width, height: a.height, bitrate: a.bitrate }));
    await settle(10);

    // The onboarding page, given those asks by main, putting them to its own VideoEncoder.
    const pageAsked = [];
    const ob = loadSurface('onboarding', {
      handlers: {
        [C.CONFIG_GET]: () => ({ language: 'en', recordingMode: 'auto', recordingRes: '720' }),
        [C.PC_CHECK]: () => ({ ...BIG, ok: true, asks }),
      },
      window: { VideoEncoder: { isConfigSupported: async (c) => { pageAsked.push(c); return { supported: true }; } } },
    });
    await settle();
    ob.window.go(3);
    await settle(20);
    ok(gateAsked.length === 2 && same(pageAsked, gateAsked), 'the onboarding page asks VideoEncoder exactly what the recorder page\'s gate asks',
      `page ${JSON.stringify(pageAsked)}\n        gate ${JSON.stringify(gateAsked)}`);
    ok(pageAsked.every((c) => c.hardwareAcceleration === 'prefer-hardware' && c.framerate === 30), 'prefer-hardware, at 30 fps');
  });

  console.log(fails ? `\nFAIL: ${fails} problem(s)` : '\nPASS: the PC check reads this PC, asks what a recording asks, and recommends by its rules');
  process.exit(fails ? 1 : 0);
})().catch((e) => {
  console.log(`FAIL  the test itself threw: ${e.stack || e}`);
  process.exit(1);
});

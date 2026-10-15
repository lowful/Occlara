'use strict';

/**
 * The recorded session the benches read is looked for in userData/bench first,
 * then in the AI log (benchSession in scripts/profile-path.js).
 *
 * THE AI LOG KEEPS ONLY THE FIVE NEWEST SESSIONS and the app prunes the rest at
 * every Start, so the real Abyss session verify:ai is gated on was going to be
 * deleted by playing: bench-read read it from the AI log alone. A copy in
 * userData/bench is never pruned, so it comes first, and the AI log is the
 * fallback for a session not copied yet. With neither, the bench says where it
 * looked, both paths, before it reads anything else or calls anything.
 *
 * Offline: the benches are run here only into that refusal, from a profile
 * that does not exist, with the server pointed at a closed local port, so no
 * frame and no request can leave the machine.
 *
 * And the read bench's --variant (8.4.1), against a stand in for the server
 * on this machine over three stand in frames: the variant asked for beside the
 * admin password on every frame, nothing of it without the flag, and a run the
 * server did not read with it stopped at its first frame: b and c alike, and
 * a run read with b never passing for one on c.
 *
 * And the read bench's --engine (8.4.3) beside the run it leaves alone, over a
 * scripted stand in session of fourteen frames: the default run and verify:ai
 * send, print and trace exactly what 8.4.2's did, and --engine sends each frame
 * what the real engine's readContext() gives once the replies before it are
 * applied in capture order on their capture clock (scriptedRuns, below).
 *
 * Run: npm run test:benchsession
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { benchSession } = require('./profile-path');

let fails = 0;
const ok = (cond, what, detail) => {
  if (!cond) { fails++; console.log(`FAIL  ${what}${detail ? `\n        ${detail}` : ''}`); }
  else console.log(`ok    ${what}`);
};

const SESSION = 'session-2026-09-22T04-24-07-240Z';
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'occlara-bench-session-'));
/** A profile root holding the session's log.json in the folders named. */
const profile = (name, withLog, without) => {
  const root = path.join(temp, name);
  for (const where of withLog || []) {
    fs.mkdirSync(path.join(root, where, SESSION), { recursive: true });
    fs.writeFileSync(path.join(root, where, SESSION, 'log.json'), '{"records":[]}');
  }
  for (const where of without || []) fs.mkdirSync(path.join(root, where, SESSION), { recursive: true });
  return root;
};

try {
  const both = profile('both', ['bench', 'ai-log']);
  ok(benchSession(both, SESSION).dir === path.join(both, 'bench', SESSION),
    'a copy in bench is read before the AI log', benchSession(both, SESSION).dir);
  const logOnly = profile('log-only', ['ai-log']);
  ok(benchSession(logOnly, SESSION).dir === path.join(logOnly, 'ai-log', SESSION),
    'with no copy, the AI log is read', benchSession(logOnly, SESSION).dir);
  const emptyCopy = profile('empty-copy', ['ai-log'], ['bench']);
  ok(benchSession(emptyCopy, SESSION).dir === path.join(emptyCopy, 'ai-log', SESSION),
    'a bench folder with no log.json in it is passed over', benchSession(emptyCopy, SESSION).dir);
  const none = profile('none', [], ['bench']);
  const missing = benchSession(none, SESSION);
  ok(missing.dir === null && missing.looked.length === 2
    && missing.looked[0] === path.join(none, 'bench', SESSION) && missing.looked[1] === path.join(none, 'ai-log', SESSION),
  'with neither, nothing is read, and both folders are named, the copy first', JSON.stringify(missing));

  // The benches themselves, into the refusal: a profile with no session and
  // no config, the server a closed port on this machine.
  const appData = path.join(temp, 'appdata');
  fs.mkdirSync(appData, { recursive: true });
  const env = { ...process.env, APPDATA: appData, OCCLARA_SERVER: 'http://127.0.0.1:9', ADMIN_PASSWORD: 'offline-test' };
  const run = (script, args) => {
    const r = spawnSync(process.execPath, [path.join(__dirname, script), ...args], { env, encoding: 'utf8', timeout: 30000 });
    return { status: r.status, out: `${r.stdout || ''}${r.stderr || ''}` };
  };
  // A crash (a stack, ENOENT on the config or the log) or a run that started.
  const WENT_ON = /Error|frames from/;
  ok(WENT_ON.test("Error: ENOENT: no such file or directory, open 'log.json'") && WENT_ON.test('TypeError: benchSession is not a function')
    && WENT_ON.test('240 frames from session-2026-09-22T04-24-07-240Z') && !WENT_ON.test('No recorded session x to read.'),
  'the detector matches a crash and a run that started, and not the refusal');
  const where = path.join(appData, 'Occlara');
  for (const [script, args] of [['bench-read.js', ['live', '--session', SESSION]], ['bench-forensics.js', ['openai/gpt-6-luna']]]) {
    const r = run(script, args);
    const names = [path.join(where, 'bench', SESSION), path.join(where, 'ai-log', SESSION)];
    ok(r.status === 1 && names.every((n) => r.out.includes(n)) && r.out.indexOf(names[0]) < r.out.indexOf(names[1]),
      `${script}: with no session anywhere it stops and names both folders, the copy first`, r.out.trim());
    ok(!WENT_ON.test(r.out), `${script}: before reading anything else or running a frame`, r.out.trim());
  }
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}

/*
 * THE READ BENCH'S --variant (8.4.1). With it every frame asks for the read
 * prompt's variant beside the admin password, and a run the server did not
 * read with that variant stops rather than report the live prompt's numbers
 * under its name; without it a run sends neither, as it always has. Against a
 * stand in for the server on this machine, over a profile of stand in frames
 * (bytes, nobody's screen): no request leaves the machine.
 */
async function variantRuns() {
  const http = require('http');
  const { spawn } = require('child_process');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'occlara-bench-variant-'));
  const NAME = 'session-stand-in';
  const dir = path.join(tmp, 'Occlara', 'bench', NAME);
  fs.mkdirSync(dir, { recursive: true });
  const records = [0, 1, 2].map((i) => ({ frame: `frame-${i}.jpg`, at: 1000000 + i * 1000 }));
  for (const r of records) fs.writeFileSync(path.join(dir, r.frame), Buffer.from('a stand in, not a frame'));
  fs.writeFileSync(path.join(dir, 'log.json'), JSON.stringify({ records }));
  fs.writeFileSync(path.join(tmp, 'Occlara', 'occlara-config.json'), JSON.stringify({ licenseKey: 'GC-BENCH-TEST-0000-0000' }));
  // What each read asked for, whether the stand in honours a variant, and the
  // one it says it read with in place of the one asked for, if any.
  const seen = [];
  let honour = true;
  let answerAs = null;
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      let j = {};
      try { j = JSON.parse(body); } catch (e) { /* not JSON */ }
      const asked = Object.prototype.hasOwnProperty.call(j, 'variant');
      const admin = req.headers['x-admin-password'] || null;
      seen.push({ url: req.url, admin, asked, variant: j.variant });
      const out = { lobby: false, context: { phase: 'buy' }, parsed: true, ms: 3,
        ...(asked ? { variant: honour && admin ? (answerAs || j.variant) : null } : {}) };
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(out));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const bench = (args) => new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(__dirname, 'bench-read.js'), ...args, '--session', NAME], {
      env: { ...process.env, APPDATA: tmp, OCCLARA_SERVER: `http://127.0.0.1:${port}`, ADMIN_PASSWORD: 'offline-test' },
      windowsHide: true,
    });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    const timer = setTimeout(() => child.kill(), 30000);
    child.on('exit', (status) => { clearTimeout(timer); resolve({ status, out }); });
  });
  try {
    seen.length = 0;
    const plain = await bench(['live']);
    ok(plain.status === 0 && seen.length === 3 && seen.every((s) => s.url === '/api/coach/read' && !s.asked && !s.admin)
      && /3 frames from session-stand-in/.test(plain.out) && !/variant/i.test(plain.out),
    'bench-read without --variant sends no variant and no admin password, and says nothing of one', plain.out.trim());
    seen.length = 0;
    const b = await bench(['live', '--variant', 'b']);
    ok(b.status === 0 && seen.length === 3 && seen.every((s) => s.variant === 'b' && s.admin === 'offline-test')
      && /read with the read prompt's variant b/.test(b.out) && !/not variant b/.test(b.out),
    'with --variant b every frame asks for variant b beside the admin password, and the run says it read with it', b.out.trim());
    honour = false;
    seen.length = 0;
    const refused = await bench(['live', '--variant', 'b']);
    ok(seen.length === 1 && /the server read with the live prompt, not variant b/.test(refused.out),
      'and a server that read with the live prompt stops the run at its first frame, saying so', refused.out.trim());
    // Variant c, the judge's, the same way.
    honour = true;
    seen.length = 0;
    const c = await bench(['live', '--variant', 'c']);
    ok(c.status === 0 && seen.length === 3 && seen.every((s) => s.variant === 'c' && s.admin === 'offline-test')
      && /read with the read prompt's variant c/.test(c.out) && !/not variant c/.test(c.out),
    'with --variant c every frame asks for variant c beside the admin password, and the run says it read with it', c.out.trim());
    honour = false;
    seen.length = 0;
    const refusedC = await bench(['live', '--variant', 'c']);
    ok(seen.length === 1 && /the server read with the live prompt, not variant c/.test(refusedC.out),
      'and a server that read c\'s frames with the live prompt stops the run at its first frame, saying so', refusedC.out.trim());
    // A server that knows b and not c yet can only answer the live prompt, but
    // a run on b must never pass for one on c either.
    honour = true;
    answerAs = 'b';
    seen.length = 0;
    const asB = await bench(['live', '--variant', 'c']);
    ok(seen.length === 1 && /the server read with variant b, not variant c/.test(asB.out),
      'nor does a run the server read with b pass for c: it stops at its first frame, saying so', asB.out.trim());
    answerAs = null;
  } finally {
    server.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/*
 * THE DEFAULT RUN BYTE FOR BYTE, AND --engine BESIDE IT (8.4.3).
 *
 * npm run verify:ai is the gate every read prompt and model passes, so the
 * mode added beside it must not move it. Over a scripted stand in session,
 * among its fourteen frames a failed read, a LOBBY, a jump of two rounds that
 * only the capture clock allows (140 s on, against a second of the run's own
 * time), the round before's COMBAT REPORT read dead in a buy phase and a 0 to
 * 0 misread:
 *   - the default run, verify:ai's form of it and --lag 4 send exactly the
 *     image and the server's replies merged raw, lagged, and print and trace
 *     exactly what 8.4.2's bench did, the latencies from the run's own trace
 *     (the table's only numbers that are not the script's)
 *   - --engine sends frame k what the real engine's readContext() gives once
 *     the replies up to k - lag are applied in capture order on their capture
 *     clock, worked out here on an engine of the test's own: the dead read is
 *     not sent on as "playerAlive false" nor the misread as 0 to 0, both of
 *     which the default sends, and the jump is taken
 *   - and keeps each reply as the server sent it in its trace, beside what it
 *     sent, calls nothing but the read (the engine's own network is stubbed:
 *     no match review at the end), and refuses --gate before it reads a frame
 */
const SCRIPT_T0 = 1800000000000;
const aliveRead = (o) => ({ side: 'defending', playerAlive: true, playerHp: 100, playerWeapon: 'Vandal',
  aliveTell: 'own HP 100 and Vandal bottom left', ...o });
// [seconds in, the server's reply]: 503 a failed read, 'LOBBY' a menu.
const SCRIPTED = [
  [0, aliveRead({ phase: 'buy', clock: '0:40', teamScore: 0, enemyScore: 0, playerWeapon: 'Classic', aliveTell: 'own HP 100 and Classic bottom left' })],
  [2, 503],
  [70, aliveRead({ phase: 'active', clock: '1:20', teamScore: 1, enemyScore: 0, locLabel: 'A Main' })],
  [72, aliveRead({ phase: 'active', clock: '1:18', teamScore: 1, enemyScore: 0 })],
  [210, aliveRead({ phase: 'buy', clock: '0:28', teamScore: 3, enemyScore: 0 })],
  [212, aliveRead({ phase: 'buy', clock: '0:26', teamScore: 3, enemyScore: 0 })],
  [214, { phase: 'buy', clock: '0:24', teamScore: 3, enemyScore: 0, side: 'defending', playerAlive: false,
    aliveTell: 'KILLED BY Reyna and COMBAT REPORT panel' }],
  [280, aliveRead({ phase: 'active', clock: '1:30', teamScore: 0, enemyScore: 0 })],
  [282, aliveRead({ phase: 'active', clock: '1:28', teamScore: 3, enemyScore: 0 })],
  [300, 'LOBBY'],
  [302, aliveRead({ phase: 'active', clock: '1:08', teamScore: 3, enemyScore: 0 })],
  [304, aliveRead({ phase: 'active', clock: '1:06', teamScore: 3, enemyScore: 0 })],
  [306, aliveRead({ phase: 'active', clock: '1:04', teamScore: 3, enemyScore: 0 })],
  [308, aliveRead({ phase: 'active', clock: '1:02', teamScore: 3, enemyScore: 0 })],
];
const ERR_503 = '{"error":"read-unavailable","upstream":null,"ms":9000}';
const frameBytes = (k) => Buffer.from(`a stand in for frame ${k}, nobody's screen`);

/** What the default run sends frame k: the replies before it merged raw, `lag` reads old, nothing before the first. */
function mergedRaw(lag) {
  let ctx = {};
  const found = [];
  return SCRIPTED.map(([, reply]) => {
    found.push(ctx);
    const sent = found[found.length - lag] || {};
    if (reply !== 503 && reply !== 'LOBBY') ctx = { ...ctx, ...reply };
    return sent;
  });
}

/**
 * What the app sends frame k with `lag` reads in flight: readContext() at its
 * capture time, once the replies up to k - lag have been applied in capture
 * order on their own capture times, a failed one skipped. On an engine of this
 * test's own, started as the app starts it, its network and timers stubbed.
 */
function engineSent(lag) {
  const Module = require('module');
  const realLoad = Module._load;
  Module._load = function patched(request, parent, isMain) {
    if (request === './api-client') return { post: () => new Promise(() => {}), get: () => new Promise(() => {}) };
    return realLoad(request, parent, isMain);
  };
  const file = require.resolve(path.join(__dirname, '..', 'src', 'main', 'services', 'coaching-engine.js'));
  delete require.cache[file];
  let Engine;
  try { Engine = require(file); } finally { Module._load = realLoad; }
  const realNow = Date.now;
  const realLog = console.log;
  const realErr = console.error;
  let clock = SCRIPT_T0;
  Date.now = () => clock;
  console.log = () => {};
  console.error = () => {};
  try {
    const e = new Engine({ licenseKey: 'TEST', captureFunction: async () => null, experiments: () => ({}) });
    e.armAgentDetection = () => {};
    e.start();
    clearInterval(e.loopTimer);
    const at = (k) => SCRIPT_T0 + SCRIPTED[k][0] * 1000;
    let applied = 0;
    const sent = SCRIPTED.map((_, k) => {
      for (; applied <= k - lag; applied++) {
        const reply = SCRIPTED[applied][1];
        if (reply === 503) continue;
        clock = at(applied);
        e.applyRead({ data: reply === 'LOBBY' ? { lobby: true, context: {} } : { lobby: false, context: JSON.parse(JSON.stringify(reply)), parsed: true },
          shot: null, at: at(applied) });
      }
      clock = at(k);
      return JSON.parse(JSON.stringify(e.readContext()));
    });
    e.stop();
    return sent;
  } finally {
    Date.now = realNow;
    console.log = realLog;
    console.error = realErr;
  }
}

/** bench-read's own quantile. */
const q = (arr, p) => { const s = arr.slice().sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * p))] : 0; };

/** What 8.4.2's bench-read printed over the scripted session, its two latencies from the run's trace. */
function goldenOut(p50, p90, { lag, gate }) {
  return [
    '14 frames from session-scripted; Riot has 21 deaths in 24 rounds',
    '',
    '  done live',
    '',
    'model                                parse  deaths(ok/inv/miss)  labels-ok  hp    final  p50    p90    gap',
    '-'.repeat(118),
    `live                                 100%    0/ 0/21             100%        79%  no     ${String(p50).padStart(5)}  ${String(p90).padStart(5)}`
      + `  1s   1 err (503 ${ERR_503})`,
    '',
    'deaths is the number that matters: agreed with Riot / invented / missed, out of Riot\'s real deaths.',
    'gap is the read cadence auto holds at that p90, with up to four requests in flight.',
    ...(lag > 1 ? [`each frame was sent with the context of ${lag} reads earlier (--lag ${lag}).`] : []),
    ...(gate ? ['', 'GATE FAILED', '  live: agreed with 0 of Riot\'s 21 deaths, gate 80%', '  live: 1 failed reads of 14'] : []),
    '',
  ].join('\n');
}

/** 8.4.2's trace of the scripted session, a read's latency left as it came. */
function goldenTrace(lag, lines) {
  const reads = SCRIPTED.map(([t, reply], k) => JSON.stringify({ model: 'live', i: k + 1, frame: `frame-${k}.jpg`, at: SCRIPT_T0 + t * 1000,
    ms: lines[k] ? lines[k].ms : null, serverMs: reply === 503 ? null : 3, err: reply === 503 ? `503 ${ERR_503}` : null, servedBy: null,
    lobby: reply === 'LOBBY', parsed: reply !== 503 && reply !== 'LOBBY', context: reply === 503 ? null : reply === 'LOBBY' ? {} : reply }));
  const missed = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 18, 19, 20, 22, 23, 24];
  const summary = `{"model":"live","summary":true,"lag":${lag},"n":14,"errs":1,"firstErr":${JSON.stringify(`503 ${ERR_503}`)},"lobby":1,"parsed":12,`
    + `"labels":1,"labelsOk":1,"hp":11,"finalRead":false,"deaths":{"riotDeaths":21,"agreed":0,"invented":[],"missed":[${missed.join(',')}]},`
    + '"rounds":[{"n":1,"died":false,"side":"defending","spot":null},{"n":2,"died":false,"side":"defending","spot":null},'
    + '{"n":3,"died":false,"side":null,"spot":null},{"n":4,"died":false,"side":"defending","spot":null}]}';
  return [...reads, summary];
}

async function scriptedRuns() {
  const http = require('http');
  const { spawn } = require('child_process');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'occlara-bench-scripted-'));
  const NAME = 'session-scripted';
  const dir = path.join(tmp, 'Occlara', 'bench', NAME);
  fs.mkdirSync(dir, { recursive: true });
  const records = SCRIPTED.map(([t], k) => ({ frame: `frame-${k}.jpg`, at: SCRIPT_T0 + t * 1000 }));
  records.forEach((r, k) => fs.writeFileSync(path.join(dir, r.frame), frameBytes(k)));
  fs.writeFileSync(path.join(dir, 'log.json'), JSON.stringify({ records }));
  fs.writeFileSync(path.join(tmp, 'Occlara', 'occlara-config.json'), JSON.stringify({ licenseKey: 'GC-BENCH-TEST-0000-0000' }));
  const seen = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      seen.push({ url: req.url, body });
      let j = {};
      try { j = JSON.parse(body); } catch (e) { /* not JSON */ }
      const m = /frame (\d+),/.exec(Buffer.from(String(j.image || ''), 'base64').toString('utf8'));
      const reply = m ? SCRIPTED[Number(m[1])][1] : 503;
      if (reply === 503) { res.writeHead(503, { 'content-type': 'application/json' }); res.end(ERR_503); return; }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(reply === 'LOBBY' ? { lobby: true, context: {}, ms: 3 } : { lobby: false, context: reply, parsed: true, ms: 3 }));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  let runs = 0;
  const bench = (args) => new Promise((resolve) => {
    seen.length = 0;
    const traceFile = path.join(tmp, `trace-${++runs}.jsonl`);
    const child = spawn(process.execPath, [path.join(__dirname, 'bench-read.js'), ...args, '--session', NAME, '--trace', traceFile], {
      env: { ...process.env, APPDATA: tmp, OCCLARA_SERVER: `http://127.0.0.1:${port}`, ADMIN_PASSWORD: '' },
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    const timer = setTimeout(() => child.kill(), 60000);
    child.on('exit', (status) => {
      clearTimeout(timer);
      const lines = fs.existsSync(traceFile) ? fs.readFileSync(traceFile, 'utf8').split('\n').filter(Boolean) : [];
      resolve({ status, stdout, stderr, seen: seen.slice(), lines, reads: lines.map((l) => JSON.parse(l)).filter((o) => !o.summary) });
    });
  });
  const image = (k) => frameBytes(k).toString('base64');
  try {
    for (const [what, args, lag, gate] of [['the default run', ['live'], 1, false], ['verify:ai (live --gate)', ['live', '--gate'], 1, true],
      ['the default run at --lag 4', ['live', '--lag', '4'], 4, false]]) {
      const r = await bench(args);
      const sent = mergedRaw(lag);
      const want = SCRIPTED.map((_, k) => JSON.stringify({ image: image(k), context: sent[k] }));
      ok(r.seen.length === 14 && r.seen.every((s, k) => s.url === '/api/coach/read' && s.body === want[k]),
        `${what}: every request is byte for byte the image and the replies before it merged raw${lag > 1 ? `, ${lag} reads old` : ''}`,
        r.seen.map((s, k) => (s.body === want[k] ? null : `frame ${k}: ${s.body.slice(0, 40)}...${s.body.slice(-160)}\n          wanted ...${want[k].slice(-160)}`)).filter(Boolean).join('\n        '));
      const ms = r.reads.filter((x) => !x.err).map((x) => x.ms);
      const out = goldenOut(q(ms, 0.5), q(ms, 0.9), { lag, gate });
      ok(r.stdout === out, `${what}: prints byte for byte what 8.4.2 printed`, `got:\n${r.stdout}\nwanted:\n${out}`);
      const trace = goldenTrace(lag, r.reads);
      ok(r.lines.length === trace.length && r.lines.every((l, k) => l === trace[k]), `${what}: traces byte for byte what 8.4.2 traced`,
        r.lines.map((l, k) => (l === trace[k] ? null : `line ${k}: ${l}\n          wanted ${trace[k]}`)).filter(Boolean).join('\n        '));
      ok(gate ? r.status !== 0 : r.status === 0, `${what}: ${gate ? 'a failed gate exits non zero' : 'exits 0'}`, `status ${r.status} ${r.stderr}`);
    }

    for (const lag of [1, 4]) {
      const flags = lag > 1 ? ['live', '--engine', '--lag', String(lag)] : ['live', '--engine'];
      const r = await bench(flags);
      const want = engineSent(lag);
      const raw = mergedRaw(lag);
      const got = r.seen.map((s) => { try { return JSON.parse(s.body); } catch (e) { return {}; } });
      ok(r.status === 0 && r.seen.length === 14 && r.seen.every((s) => s.url === '/api/coach/read')
        && got.every((b, k) => JSON.stringify(Object.keys(b)) === '["image","context"]' && b.image === image(k)),
      `--engine${lag > 1 ? ` --lag ${lag}` : ''}: reads every frame once, in capture order, and calls nothing but the read`,
      `status ${r.status}, ${r.seen.map((s) => s.url).join(' ')}\n${r.stdout}${r.stderr}`);
      ok(got.every((b, k) => JSON.stringify(b.context) === JSON.stringify(want[k])),
        `--engine${lag > 1 ? ` --lag ${lag}` : ''}: frame k is sent what the engine's readContext() gives once the replies up to k - ${lag} are applied`,
        got.map((b, k) => (JSON.stringify(b.context) === JSON.stringify(want[k]) ? null : `frame ${k}: sent ${JSON.stringify(b.context)}\n          wanted ${JSON.stringify(want[k])}`)).filter(Boolean).join('\n        '));
      // Where the two differ, as the scripted frames were chosen to make them.
      const dead = 6 + lag;
      const zero = 7 + lag;
      ok(raw[dead].playerAlive === false && got[dead].context && got[dead].context.playerAlive === true
        && raw[zero].teamScore === 0 && got[zero].context && got[zero].context.teamScore === 3 && got[zero].context.enemyScore === 0
        && got[5 + lag].context && got[5 + lag].context.teamScore === 3,
      `--engine${lag > 1 ? ` --lag ${lag}` : ''}: the COMBAT REPORT read dead in the buy phase is not sent on as a death, nor the 0 to 0 misread as the score, `
        + 'where the default run sends both, and the jump the capture clock allows is taken',
      `frame ${dead}: ${JSON.stringify(got[dead].context)}; frame ${zero}: ${JSON.stringify(got[zero].context)}`);
      ok(r.reads.length === 14 && r.reads.every((x, k) => JSON.stringify(x.sent) === JSON.stringify(got[k].context)
        && JSON.stringify(x.context) === JSON.stringify(SCRIPTED[k][1] === 503 ? null : SCRIPTED[k][1] === 'LOBBY' ? {} : SCRIPTED[k][1])),
      `--engine${lag > 1 ? ` --lag ${lag}` : ''}: its trace keeps each reply as the server sent it, and what each frame was sent`,
      r.lines.slice(0, 3).join('\n        '));
      ok(/read as the app reads them \(--engine\)/.test(r.stdout) && /No Riot record of this session/.test(r.stdout),
        `--engine${lag > 1 ? ` --lag ${lag}` : ''}: says it read as the app reads, and that a session with no Riot record is not scored`, r.stdout);
    }
    const refused = await bench(['live', '--engine', '--gate']);
    ok(refused.status === 1 && refused.seen.length === 0 && /--gate is verify:ai's/.test(refused.stdout),
      '--engine with --gate is refused before a frame is read', `${refused.status}: ${refused.stdout}`);
  } finally {
    server.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/*
 * NPM RUN BENCH:SESSIONS (8.4.3), offline: the four sessions as stand ins of
 * three frames each, the server a stand in for /health, /api/admin/costs and
 * the read, which books every read it answers at its prompt's price as the
 * real cost view does. Without --go it prints its plan and its cost and sends
 * nothing at all. With it the candidate's verify:ai goes first, plain and at
 * --lag 4, then the session runs, live and c in turn, each --engine; each
 * run's cost is exactly what the view booked for its reads; a refused read, a
 * data policy fallback or a run that died part way (a frame gone from its
 * session) stops it before the next run, the last scored as no run; the
 * judge's terms put the judge's bench first, so a bench that stopped, on its
 * last run as on any other, or ran fewer replaces nothing; and neither the
 * admin password nor the licence key is ever printed or written.
 */
async function sessionsRuns() {
  const http = require('http');
  const crypto = require('crypto');
  const { spawn } = require('child_process');
  const score = require('./read-score');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'occlara-bench-sessions-'));
  const KEY = 'GC-BENCH-TEST-0000-0000';
  const ADMIN = 'offline-test';
  const HASH = crypto.createHash('sha256').update(KEY).digest('hex').slice(0, 8);
  for (const s of Object.values(score.SESSIONS)) {
    const dir = path.join(tmp, 'Occlara', 'bench', s.id);
    fs.mkdirSync(dir, { recursive: true });
    const records = [0, 1, 2].map((k) => ({ frame: `frame-${k}.jpg`, at: SCRIPT_T0 + k * 2000 }));
    records.forEach((r, k) => fs.writeFileSync(path.join(dir, r.frame), Buffer.from(`a stand in for ${s.id} frame ${k}, nobody's screen`)));
    fs.writeFileSync(path.join(dir, 'log.json'), JSON.stringify({ records }));
  }
  fs.writeFileSync(path.join(tmp, 'Occlara', 'occlara-config.json'), JSON.stringify({ licenseKey: KEY }));
  const PRICE = { live: 0.0003, c: 0.000315 };
  const book = { calls: 0, cost: 0 };
  const reads = [];
  const other = [];
  let refuseAt = 0;
  let fallBackAt = 0;
  let fellBack = 0;
  // { id, variant }: that prompt's read of that session's frame 0 deletes its frame 1, as a pruned folder would.
  let vanish = null;
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const json = (status, o) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
      if (req.url === '/health') return json(200, { startedAt: '2026-10-14T09:00:00.000Z', readModel: 'stand/in',
        dataPolicy: { mode: 'deny', fellBack: { read: fellBack }, refusedAgain: { read: 0 }, since: '2026-10-14T09:00:00.000Z' } });
      if (req.url === '/api/admin/costs') {
        other.push({ url: req.url, admin: req.headers['x-admin-password'] || null });
        if (req.headers['x-admin-password'] !== ADMIN) return json(401, { error: 'Unauthorized' });
        const view = { calls: book.calls, cost: book.cost, routes: { read: { calls: book.calls, priced: book.calls, real: book.cost, estimated: 0, cost: book.cost } } };
        return json(200, { since: '2026-10-14T09:00:00.000Z', asOf: new Date().toISOString(), topUsers: [{ user: HASH, spendToday: view, spendMonth: view }] });
      }
      if (req.url !== '/api/coach/read') { other.push({ url: req.url }); return json(404, { error: 'Not found' }); }
      let j = {};
      try { j = JSON.parse(body); } catch (e) { /* not JSON */ }
      const admin = req.headers['x-admin-password'] === ADMIN;
      const variant = j.variant && admin ? j.variant : null;
      reads.push({ variant: j.variant || null, admin, context: j.context, key: req.headers['x-license-key'] === KEY });
      if (refuseAt && reads.length === refuseAt) return json(429, { error: 'slow down' });
      if (fallBackAt && reads.length === fallBackAt) fellBack++;
      if (vanish && (j.variant || null) === vanish.variant
        && Buffer.from(String(j.image || ''), 'base64').toString('utf8').includes(`${vanish.id} frame 0,`)) {
        fs.rmSync(path.join(tmp, 'Occlara', 'bench', vanish.id, 'frame-1.jpg'), { force: true });
      }
      book.calls++;
      book.cost = Math.round((book.cost + PRICE[variant || 'live']) * 1e9) / 1e9;
      return json(200, { lobby: false, context: { phase: 'buy', clock: '0:30', teamScore: 0, enemyScore: 0, playerAlive: true, playerHp: 100 },
        parsed: true, ms: 3, ...(j.variant ? { variant } : {}) });
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const run = (a) => new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(__dirname, 'bench-sessions.js'), ...a], {
      env: { ...process.env, APPDATA: tmp, OCCLARA_SERVER: `http://127.0.0.1:${port}`, ADMIN_PASSWORD: ADMIN }, windowsHide: true,
    });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    const timer = setTimeout(() => child.kill(), 180000);
    child.on('exit', (status) => { clearTimeout(timer); resolve({ status, out }); });
  });
  const resultsOf = (dir) => JSON.parse(fs.readFileSync(path.join(dir, 'results.json'), 'utf8'));
  const quiet = (text) => !text.includes(ADMIN) && !text.includes(KEY);
  try {
    const plan = await run([]);
    ok(plan.status === 0 && reads.length === 0 && other.length === 0 && /Nothing was sent\. Run it with --go/.test(plan.out)
      && /26 runs, 78 reads/.test(plan.out) && /\$0\.00033 a read[^\n]*about \$0\.0257,/.test(plan.out) && /\$0\.00012 a read[^\n]*about \$0\.0094,/.test(plan.out)
      && /1\. verify:ai plain\s+abyss\s+c\b/.test(plan.out) && /3\. run 1\s+abyss\s+live/.test(plan.out) && /4\. run 1\s+abyss\s+c\b/.test(plan.out),
    'bench:sessions without --go prints its 26 runs and their cost at both prices seen, and sends nothing at all', plan.out);

    const out1 = path.join(tmp, 'out1');
    const go = await run(['--go', '--sessions', 'fracture', '--runs', '1', '--out', out1]);
    const res = fs.existsSync(path.join(out1, 'results.json')) ? resultsOf(out1) : { done: [] };
    const engineShaped = (c) => JSON.stringify(Object.keys(c || {})) === '["agent","map","side","phase","gameMode","teamScore","enemyScore","roundNumber","playerAlive"]';
    ok(go.status === 0 && reads.length === 12 && reads.every((r) => r.key)
      && reads.map((r) => r.variant || 'live').join(',') === 'c,c,c,c,c,c,live,live,live,c,c,c'
      && reads.filter((r) => r.variant).every((r) => r.admin) && reads.filter((r) => !r.variant).every((r) => !r.admin)
      && JSON.stringify(reads[0].context) === '{}' && engineShaped(reads[6].context) && engineShaped(reads[9].context),
    'with --go the candidate\'s verify:ai goes first, plain and at --lag 4, then live and c in turn, each session run read as the app reads (--engine)',
    `${go.status}: ${reads.map((r) => `${r.variant || 'live'}${r.admin ? '+admin' : ''} ${JSON.stringify(r.context).slice(0, 40)}`).join(' | ')}\n${go.out}`);
    const want = [3 * PRICE.c, 3 * PRICE.c, 3 * PRICE.live, 3 * PRICE.c];
    ok(res.done.length === 4 && res.done.every((d, k) => d.cost && d.cost.known && d.cost.calls === 3 && Math.abs(d.cost.usd - want[k]) < 1e-9)
      && res.done[0].gate === 'FAILED' && res.done[1].gate === 'FAILED' && res.done[0].kind === 'gate' && res.done[1].lag === 4,
    'each run\'s cost is exactly what the cost view booked for its own reads, and the gates\' verdicts are read off their output',
    JSON.stringify(res.done.map((d) => ({ i: d.i, kind: d.kind, prompt: d.prompt, gate: d.gate, cost: d.cost }))));
    ok(/c against live, the judge's terms:/.test(go.out) && /NOT MET\s+verify:ai passed plain and at --lag 4: plain FAILED, --lag 4 FAILED/.test(go.out)
      && /^ {2}MET {6}cost a read within 10% of live: c \$0\.0003150 against live \$0\.0003000 a read \(5\.0%\)$/m.test(go.out)
      && /keep the live prompt/.test(go.out) && /== fracture/.test(go.out),
    'and at the end every run is scored against Riot by time and the judge\'s terms are printed, the cost a read among them', go.out);
    ok(/^ {2}NOT MET {2}the judge's bench: 3 whole runs of each prompt on abyss, split, sunset, fracture, every run done: short: abyss live 0, c 0; split live 0, c 0; sunset live 0, c 0; fracture live 1, c 1$/m.test(go.out)
      && /^c does not meet 2 of 8 terms: keep the live prompt\.$/m.test(go.out),
    'the judge\'s bench first among them: one run on one session is not it, so it replaces nothing whatever the rest say', go.out);
    ok(quiet(go.out) && quiet(fs.readFileSync(path.join(out1, 'results.json'), 'utf8'))
      && fs.readdirSync(out1).every((f) => quiet(fs.readFileSync(path.join(out1, f), 'utf8'))),
    'and neither the admin password nor the licence key is printed or written anywhere');

    reads.length = 0;
    refuseAt = 8;
    const out2 = path.join(tmp, 'out2');
    const refused = await run(['--go', '--sessions', 'fracture', '--runs', '1', '--out', out2]);
    ok(refused.status === 2 && reads.length === 9 && resultsOf(out2).done.length === 3
      && /STOPPED: run 3: 1 read refused \(429/.test(refused.out),
    'a refused read (429) stops the bench after its run, before the next one sends anything', refused.out);
    ok(/NOT MET {2}the judge's bench[^\n]*: stopped \(run 3: 1 read refused \(429[^\n]*; fracture live 1, c 0$/m.test(refused.out)
      && !/can replace/.test(refused.out),
    'and the judge\'s terms say the bench stopped before its last run, so it replaces nothing', refused.out);
    // A read refused in the bench's LAST run: that run is whole by its frames
    // and every run planned was done, so only the stop says the bench was not,
    // and the judge's terms must say so as well.
    reads.length = 0;
    refuseAt = 11;
    const out5 = path.join(tmp, 'out5');
    const lastRun = await run(['--go', '--sessions', 'fracture', '--runs', '1', '--out', out5]);
    ok(lastRun.status === 2 && reads.length === 12 && resultsOf(out5).done.length === 4
      && /STOPPED: run 4: 1 read refused \(429/.test(lastRun.out)
      && /NOT MET {2}the judge's bench[^\n]*: stopped \(run 4: 1 read refused \(429[^\n]*; fracture live 1, c 1$/m.test(lastRun.out)
      && !/can replace/.test(lastRun.out),
    'and a read refused in its last run, a run whole by its frames, is a bench stopped all the same in the judge\'s terms', lastRun.out);
    refuseAt = 0;

    reads.length = 0;
    fallBackAt = 2;
    const out3 = path.join(tmp, 'out3');
    const fell = await run(['--go', '--sessions', 'fracture', '--runs', '1', '--no-gate', '--out', out3]);
    ok(fell.status === 2 && reads.length === 3 && /STOPPED: the data policy fell back during run 1 \(fellBack \+1/.test(fell.out),
      'and so does a data policy fallback during a run', fell.out);
    fallBackAt = 0;

    // The candidate's run of the Sunset loses its frame 1 part way (a folder
    // pruned, say): bench-read dies on it with one read traced.
    reads.length = 0;
    vanish = { id: score.SESSIONS.sunset.id, variant: 'c' };
    const out4 = path.join(tmp, 'out4');
    const died = await run(['--go', '--sessions', 'sunset', '--runs', '1', '--no-gate', '--out', out4]);
    const res4 = fs.existsSync(path.join(out4, 'results.json')) ? resultsOf(out4) : { done: [], scored: [] };
    ok(died.status === 2 && reads.length === 4 && res4.done.length === 2 && res4.done[1].sent === 1
      && /STOPPED: run 2 read 1 of its 3 frames \(exit [1-9]\d*\): [^\n]*ENOENT/.test(died.out),
    'a run that read fewer frames than its session has, dead part way, stops the bench', died.out);
    ok((res4.scored || []).length === 1 && res4.scored[0].name === 'sunset' && Object.keys(res4.scored[0].runs).join() === 'live'
      && /NOT MET {2}the judge's bench[^\n]*sunset live 1, c 0; fracture live 0, c 0$/m.test(died.out),
    'and is scored as no run of its prompt: only whole runs are', JSON.stringify((res4.scored || []).map((s) => ({ name: s.name, runs: Object.keys(s.runs) }))) + '\n' + died.out);
    vanish = null;
  } finally {
    server.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

variantRuns()
  .catch((e) => ok(false, 'the variant runs ran to the end', (e && e.stack) || String(e)))
  .then(() => scriptedRuns())
  .catch((e) => ok(false, 'the scripted runs ran to the end', (e && e.stack) || String(e)))
  .then(() => sessionsRuns())
  .catch((e) => ok(false, 'the bench:sessions runs ran to the end', (e && e.stack) || String(e)))
  .then(() => {
    console.log(fails ? `\nFAIL: ${fails} problem(s)` : '\nPASS: the benches read the bench copy first, say where they looked, read with a variant only '
      + 'when the server says so, send, print and trace on the default run what 8.4.2 did, with --engine send what the engine\'s readContext() gives, '
      + 'and bench:sessions spends nothing without --go and costs each run exactly');
    process.exit(fails ? 1 : 0);
  });

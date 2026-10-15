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

variantRuns()
  .catch((e) => ok(false, 'the variant runs ran to the end', (e && e.stack) || String(e)))
  .then(() => {
    console.log(fails ? `\nFAIL: ${fails} problem(s)` : '\nPASS: the benches read the bench copy first, say where they looked, and read with a variant only when the server says so');
    process.exit(fails ? 1 : 0);
  });

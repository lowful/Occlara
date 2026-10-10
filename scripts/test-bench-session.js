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

console.log(fails ? `\nFAIL: ${fails} problem(s)` : '\nPASS: the benches read the bench copy first, and say where they looked');
process.exit(fails ? 1 : 0);

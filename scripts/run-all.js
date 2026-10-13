'use strict';

/**
 * Run every offline check and test in one command.
 *
 * The suite in this repo is good and it was invisible. Twenty six scripts had to
 * be remembered and typed one at a time, nothing in CI ran any of them, and the
 * result was that `npm run check:server` sat FAILING on main: three unmounted
 * files left over from the pre-Supabase auth stack required packages that are
 * not in server/package.json, so the check that exists specifically to catch a
 * backend that cannot boot was itself red and unread.
 *
 * A test nobody runs is documentation, so this is the single entry point, and
 * .github/workflows/ci.yml runs it on every push and pull request.
 *
 * THE SCRIPT LIST IS DERIVED FROM package.json, never hand maintained here.
 * Every "check:*" and "test:*" script is picked up automatically, so a new test
 * joins CI by existing. The other prefixes are deliberately left out because
 * they are not offline: "bench:*" and "verify:*" spend real money on the AI
 * provider, and "review:*" reads a log that only exists on a player's machine.
 *
 * Run: npm test
 */
const { spawnSync } = require('child_process');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const scripts = require(path.join(ROOT, 'package.json')).scripts || {};

// Named exclusions, with the reason, because auto discovery cannot tell a test
// from a gate that happens to share the prefix.
const EXCLUDE = {
  'check:release': 'a release preflight: it asserts a clean tree on a pushed main, '
    + 'so it fails by design on any branch with work in progress',
};

// Checks that need a GPU's own video encoder. The recorder records only on a
// hardware H.264 encoder, by design (the gate in src/renderer/recorder/
// recorder.js: software encoding took a whole core), so on a machine with no
// GPU these can only fail. CI runners have none and say so with
// OCCLARA_NO_GPU=1 (.github/workflows/ci.yml); on a PC they run as always.
const NEEDS_GPU = {
  'check:clips': 'it cuts clips from a real recording, and with no GPU '
    + '(OCCLARA_NO_GPU) the recorder has no hardware H.264 encoder to record on',
  'check:recorder': 'it drives the real recorder, and with no GPU '
    + '(OCCLARA_NO_GPU) the recorder has no hardware H.264 encoder to record on',
};
if (process.env.OCCLARA_NO_GPU === '1') Object.assign(EXCLUDE, NEEDS_GPU);

const RUNNABLE = /^(check|test):/;
const names = Object.keys(scripts).filter((n) => RUNNABLE.test(n) && !EXCLUDE[n]).sort();

if (!names.length) {
  console.error('[test] no check:* or test:* scripts found in package.json');
  process.exit(1);
}

console.log(`[test] running ${names.length} offline checks`);
for (const [name, why] of Object.entries(EXCLUDE)) {
  if (scripts[name]) console.log(`[test] skipping ${name}, ${why}`);
}
console.log('');

const failures = [];
const started = Date.now();

for (const name of names) {
  // Every one of these is "node scripts/<file>.js". Exec node directly rather
  // than shelling back through npm, which would add a process per script for
  // nothing.
  const parts = scripts[name].trim().split(/\s+/);
  if (parts[0] !== 'node') {
    console.log(`SKIP  ${name}  (not a plain node script: ${scripts[name]})`);
    continue;
  }

  const run = spawnSync(process.execPath, parts.slice(1), {
    cwd: ROOT,
    encoding: 'utf8',
    env: process.env,
  });

  const ok = run.status === 0;
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'}  ${name}\n`);
  if (!ok) {
    failures.push(name);
    // Only failures print their output, so a green run stays readable and a red
    // one tells you what broke without a second command.
    const out = `${run.stdout || ''}${run.stderr || ''}`.trimEnd();
    if (out) console.log(out.split('\n').map((l) => `      | ${l}`).join('\n'));
    if (run.error) console.log(`      | ${run.error.message}`);
  }
}

const secs = ((Date.now() - started) / 1000).toFixed(1);
console.log('');
if (failures.length) {
  console.log(`[test] FAIL: ${failures.length} of ${names.length} failed in ${secs}s`);
  console.log(`[test] ${failures.join(', ')}`);
  process.exit(1);
}
console.log(`[test] PASS: all ${names.length} checks passed in ${secs}s`);

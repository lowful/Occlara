'use strict';

/**
 * check:publicmirror (8.11). The public repo lowful/Occlara is made only by
 * scripts/publish-public.js. Offline, this exports the mirror from HEAD and
 * holds it to: the app's own tree and the three public files only, no
 * private name, no secret shaped text, nothing in src/ that reaches server/,
 * and a package.json that lists only scripts the mirror can run. It also
 * plants each kind of leak in a copy and checks the guard refuses it.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { exportMirror, leakGuard, publicPackage } = require('./publish-public');

let passed = 0;
let failed = 0;
function ok(cond, what, detail) {
  if (cond) { passed++; console.log(`ok    ${what}`); }
  else { failed++; console.log(`FAIL  ${what}${detail ? `\n        ${detail}` : ''}`); }
}

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'occlara-mirror-check-'));
const tree = path.join(work, 'tree');
try {
  const n = exportMirror(tree);
  const top = fs.readdirSync(tree).sort();
  ok(n > 300, `the mirror holds the app (${n} files)`);
  ok(JSON.stringify(top) === JSON.stringify(['.gitignore', 'LICENSE', 'README.md', 'TRUST.md', 'assets', 'build', 'changelog', 'native', 'package-lock.json', 'package.json', 'src'].sort()),
    'only the app tree and the public files are at the top', top.join(', '));
  const problems = leakGuard(tree);
  ok(problems.length === 0, 'the guard finds nothing to refuse in the real export', problems.slice(0, 5).join(' | '));
  ok(fs.existsSync(path.join(tree, 'src', 'main', 'index.js')) && fs.existsSync(path.join(tree, 'native', 'OcclaraCapture.cs')), 'the main process and the capture helper are published');
  ok(!fs.existsSync(path.join(tree, 'server')) && !fs.existsSync(path.join(tree, 'docs')) && !fs.existsSync(path.join(tree, 'scripts')), 'no server, docs or scripts');
  const pkg = JSON.parse(fs.readFileSync(path.join(tree, 'package.json'), 'utf8'));
  ok(Object.values(pkg.scripts).every((v) => /^electron/.test(v)) && pkg.scripts.start === 'electron .', 'package.json keeps only scripts the mirror can run', JSON.stringify(pkg.scripts));
  ok(/All rights reserved/.test(fs.readFileSync(path.join(tree, 'LICENSE'), 'utf8')), 'the licence reserves every right');
  ok(publicPackage('{"scripts":{"start":"electron .","release":"node scripts/check-release-ready.js && electron-builder"}}').includes('"start"')
    && !publicPackage('{"scripts":{"start":"electron .","release":"node scripts/check-release-ready.js && electron-builder"}}').includes('release'), 'a script that needs a private file is dropped');

  // Each kind of leak, planted in a copy, is refused.
  const plants = [
    ['server/routes/coach.js', 'module.exports = 1;', 'a server file'],
    ['docs/claude/live-read.md', '# notes', 'the docs'],
    ['src/shared/playbook.json', '{}', 'a playbook by name'],
    ['src/shared/read-prompt.js', '1', 'a prompt by name'],
    ['src/shared/x.js', 'const k = "sk-or-v1-abcdefghijklmnopqrstuvwx";', 'an API key'],
    ['src/shared/y.js', 'const s = "whsec_abcdefghijklmnop";', 'a webhook secret'],
    ['src/shared/z.js', "const r = require('../../server/services/caller');", 'a require into server code'],
    ['notes.txt', 'hello', 'a file outside the allowlist'],
  ];
  for (const [rel, body, what] of plants) {
    const copy = path.join(work, 'plant');
    fs.rmSync(copy, { recursive: true, force: true });
    fs.cpSync(tree, copy, { recursive: true });
    fs.mkdirSync(path.dirname(path.join(copy, rel)), { recursive: true });
    fs.writeFileSync(path.join(copy, rel), body);
    ok(leakGuard(copy).some((p) => p.startsWith(rel)), `the guard refuses ${what}`);
  }
} finally {
  fs.rmSync(work, { recursive: true, force: true });
}

console.log(failed ? `FAIL: ${failed} of ${passed + failed} public mirror checks failed` : `PASS: all ${passed} public mirror checks passed`);
process.exit(failed ? 1 : 0);

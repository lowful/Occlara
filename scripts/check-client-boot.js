'use strict';

/**
 * src/ must never require anything from server/.
 *
 * THE EXACT MIRROR OF check-server-boot.js, and it exists because the same trap
 * is set in both directions and only one of them was covered.
 *
 * package.json's build.files ships "src/**", "assets/**", "node_modules/**" and
 * package.json. It does NOT ship server/, which is deployed to Railway instead.
 * So a require in src/ reaching into server/ resolves perfectly in the repo,
 * passes node --check, passes every unit test, and throws MODULE_NOT_FOUND the
 * first time a real install reaches that line. The only machine that reproduces
 * it is a customer's, and the failure arrives as a crash in the main process
 * rather than a missing feature.
 *
 * This nearly shipped. The Rivals ability gate needs the generated hero data,
 * that data lives in server/rivals-data.generated.json, and the obvious require
 * is one directory traversal away. The fix was a second smaller copy written
 * into src/shared by the same sync, and this check is what keeps the shortcut
 * from being taken again later by someone who does not know the file is there
 * for a reason.
 *
 * Offline and fast. It reads files and nothing else.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');

const problems = [];
let scanned = 0;

/*
 * Matches require('...') and import ... from '...' where the target climbs out
 * of src/ and into server/. Written with a file editing tool, never through a
 * shell heredoc, and asserted against a known positive below, because a regex
 * that silently matches nothing turns this whole check into a green light.
 */
const RE_SERVER = /(?:require\s*\(|from\s*)\s*['"]([^'"]*\bserver\/[^'"]*)['"]/g;

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { walk(full); continue; }
    if (!/\.(js|mjs|cjs)$/.test(entry.name)) continue;
    scanned++;
    const text = fs.readFileSync(full, 'utf8');
    RE_SERVER.lastIndex = 0;
    let m;
    while ((m = RE_SERVER.exec(text)) !== null) {
      // Only a relative path that climbs out is a real leak. A bare specifier
      // like 'http-server' or a node_modules package that happens to carry the
      // word is not.
      if (!m[1].startsWith('.')) continue;
      const resolved = path.resolve(path.dirname(full), m[1]);
      if (resolved.startsWith(SRC)) continue;
      problems.push(`${path.relative(ROOT, full)} requires "${m[1]}", which is not shipped`);
    }
  }
}

// ── The regex has to actually match something ───────────────────────────────
// A silently dead pattern is the failure mode this repo has been bitten by
// twice, so the positive control runs before the scan and is not optional.
const POSITIVE = "const d = require('../../server/rivals-data.generated.json');";
RE_SERVER.lastIndex = 0;
if (!RE_SERVER.test(POSITIVE)) {
  console.log('FAIL: the detection regex does not match a known leak. This check is dead.');
  process.exit(1);
}
const NEGATIVE = "const d = require('./rivals-abilities.generated.json');";
RE_SERVER.lastIndex = 0;
if (RE_SERVER.test(NEGATIVE)) {
  console.log('FAIL: the detection regex matches a legitimate sibling require.');
  process.exit(1);
}

walk(SRC);

console.log(`scanned ${scanned} file(s) under src/`);
if (problems.length) {
  console.log('');
  for (const p of problems) console.log('  ' + p);
  console.log(`\nFAIL: ${problems.length} require(s) reach into server/, which the installer does not ship`);
  process.exit(1);
}
console.log('PASS: src/ is self contained and ships everything it requires');

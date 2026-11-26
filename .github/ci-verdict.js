'use strict';
// Reads the suite's log and decides the job: a failure that is not in
// ci-known-failures.txt fails it, a listed one does not, and a listed one
// that passed is called out so its line gets deleted.
const fs = require('fs');
const path = require('path');

const log = fs.existsSync('test.log') ? fs.readFileSync('test.log', 'utf8').split(/\r?\n/) : [];
const known = new Map();
for (const raw of fs.readFileSync(path.join(__dirname, 'ci-known-failures.txt'), 'utf8').split(/\r?\n/)) {
  const line = raw.trim();
  if (!line || line.startsWith('#')) continue;
  const at = line.indexOf('#');
  known.set((at < 0 ? line : line.slice(0, at)).trim(), at < 0 ? '' : line.slice(at + 1).trim());
}
const names = (re) => log.filter((l) => re.test(l)).map((l) => l.replace(re, '').trim().split(/\s+/)[0]);
const failed = names(/^FAIL {2}(?=(check|test):)/);
const passed = names(/^PASS {2}(?=(check|test):)/);
const ran = failed.length + passed.length;
const fresh = failed.filter((n) => !known.has(n));
const back = [...known.keys()].filter((n) => passed.includes(n));

const out = [];
out.push(`## The suite on Windows: ${passed.length} of ${ran} passed`);
if (!ran) out.push('', 'The suite wrote no result. Read the log.');
if (fresh.length) out.push('', '### New failures (these fail the job)', ...fresh.map((n) => `- \`${n}\``));
const listed = failed.filter((n) => known.has(n));
if (listed.length) out.push('', '### Known, not counted', ...listed.map((n) => `- \`${n}\`${known.get(n) ? `: ${known.get(n)}` : ''}`));
if (back.length) out.push('', '### Listed as known but passing now: delete the line', ...back.map((n) => `- \`${n}\``));
const text = out.join('\n');
console.log(text);
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, text + '\n');
process.exit(!ran || fresh.length ? 1 : 0);

#!/usr/bin/env node
'use strict';

/**
 * check:changelog. The changelog's source (changelog/changelog.json) keeps
 * every rule sync-changelog.js holds it to, its two copies (server/data and
 * src/shared) are byte for byte what the sync writes, the version in
 * package.json has an entry (a release ships its notes), and the validator
 * itself still catches each broken rule on a known bad changelog, so a rule
 * that silently stopped matching fails here.
 */

const fs = require('fs');
const path = require('path');
const sync = require('./sync-changelog');

let failed = 0;
function ok(cond, msg, detail) {
  if (cond) console.log(`PASS  ${msg}`);
  else { failed++; console.error(`FAIL  ${msg}${detail ? `\n      ${detail}` : ''}`); }
}

const ROOT = path.join(__dirname, '..');
const entries = JSON.parse(fs.readFileSync(sync.SOURCE, 'utf8'));
const errs = sync.validate(entries);
ok(errs.length === 0, 'changelog/changelog.json keeps every rule', errs.join('\n      '));

const want = sync.render(entries);
for (const p of sync.COPIES) {
  let have = null;
  try { have = fs.readFileSync(p, 'utf8'); } catch { /* missing */ }
  ok(have === want, `${path.relative(ROOT, p)} is the synced copy (npm run sync:changelog)`);
}

const pkg = require(path.join(ROOT, 'package.json'));
ok(entries.some((e) => e.version === pkg.version), `package.json's version ${pkg.version} has an entry`);
ok(entries[0] && sync.cmpVersion(entries[0].version, pkg.version) <= 0, 'no entry is newer than package.json');

// The validator against known bad changelogs: each must be caught.
const good = () => JSON.parse(JSON.stringify(entries.slice(0, 2)));
const caught = (name, mutate) => {
  const e = good();
  mutate(e);
  ok(sync.validate(e).length > 0, `the validator catches ${name}`);
};
const DASH = String.fromCharCode(0x2014);
const EN = String.fromCharCode(0x2013);
caught('an em dash', (e) => { e[0].items[0].text += ` ${DASH} more`; });
caught('an en dash', (e) => { e[0].title += ` ${EN} more`; });
caught('a semicolon', (e) => { e[0].summary = 'One thing; another.'; });
caught('versions going up', (e) => { e.reverse(); });
caught('a repeated version', (e) => { e[1].version = e[0].version; });
caught('a bad version', (e) => { e[0].version = '8.7'; });
caught('a date that is no day', (e) => { e[0].date = '2026-02-30'; });
caught('a date in the wrong shape', (e) => { e[0].date = '4 Nov 2026'; });
caught('a summary of 140 characters', (e) => { e[0].summary = `${'a'.repeat(139)}.`; });
caught('a summary of two sentences', (e) => { e[0].summary = 'One thing. Another thing.'; });
caught('an unknown kind', (e) => { e[0].items[0].kind = 'removed'; });
caught('13 items', (e) => { e[0].items = Array.from({ length: 13 }, () => ({ kind: 'new', text: 'A thing.' })); });
caught('no items', (e) => { e[0].items = []; });
caught('an extra field', (e) => { e[0].link = 'x'; });
caught('an empty title', (e) => { e[0].title = ''; });
ok(sync.validate(good()).length === 0, 'and passes the real entries unchanged');
ok(sync.realDate('2028-02-29') && !sync.realDate('2027-02-29'), 'a leap day is a real day only in a leap year');

if (failed) { console.error(`\n${failed} check(s) failed`); process.exit(1); }
console.log('\ncheck:changelog passed');

'use strict';

/**
 * The app never says where its knowledge comes from.
 *
 * The playbook's imported notes were taken from one coach's VOD reviews, and
 * until 8.2 his name and his team's were on every review's study card, in the
 * Settings hint for Advanced coaching, in every imported note's source and in
 * the docs. They are gone from all of it, and this keeps them gone: every file
 * git tracks, and every new file git would add, is read for either name.
 * Notes keep what they are about (source.kind, source.topic), never who said
 * it, and check:playbook fails a note that carries a coach key.
 *
 * THE NAMES ARE BUILT FROM CHARACTER CODES, so this file never contains them
 * and never reports itself. The coach is matched in any case, his handle and
 * his own name both, and the team as a whole word in capitals, the way it is
 * written: lower case it is a run of letters inside other words.
 *
 * Plain string search rather than a regex, so there is no escape here for a
 * shell or a tool to corrupt (CLAUDE.md). A match is a whole word when the
 * characters either side of it are not letters or digits.
 *
 * Binary files are skipped by git's own rule: a NUL byte in the first 8000.
 *
 * THE SCAN PROVES ITSELF FIRST. Mentions planted in a temporary folder must be
 * found, and the near misses beside them must not, before the real scan
 * counts: a checker whose search silently matches nothing passes forever,
 * which is what a heredoc once did to check:playbook.
 *
 * Git history and the website repo still carry the names. This holds what
 * ships and what is written from now on.
 *
 * Run: npm run check:attribution
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const word = (...codes) => String.fromCharCode(...codes);

// What is searched for, and how.
const NAMES = [
  { label: 'the coach', text: word(66, 111, 110, 107, 97, 114), caseless: true, whole: false },
  { label: 'the coach', text: word(77, 97, 108, 107, 111, 108, 109), caseless: true, whole: false },
  { label: 'the coach', text: word(82, 101, 110, 99, 104), caseless: true, whole: true },
  { label: 'the team', text: word(78, 82, 71), caseless: false, whole: true },
];

const isWordChar = (ch) => !!ch && /[A-Za-z0-9]/.test(ch);

/** Every hit in one text: [{ line, label }]. */
function scanText(text) {
  const hits = [];
  const lower = text.toLowerCase();
  for (const n of NAMES) {
    const hay = n.caseless ? lower : text;
    const needle = n.caseless ? n.text.toLowerCase() : n.text;
    for (let at = hay.indexOf(needle); at !== -1; at = hay.indexOf(needle, at + 1)) {
      if (n.whole && (isWordChar(text[at - 1]) || isWordChar(text[at + needle.length]))) continue;
      hits.push({ line: text.slice(0, at).split('\n').length, label: n.label });
    }
  }
  return hits;
}

/** Whether a file is binary by git's rule, a NUL in its first 8000 bytes. */
function isBinary(buf) {
  const end = Math.min(buf.length, 8000);
  for (let i = 0; i < end; i++) if (buf[i] === 0) return true;
  return false;
}

/** Scan files under a root: { hits: [{ file, line, label }], read, binary }. */
function scanFiles(root, files) {
  const hits = [];
  let read = 0;
  let binary = 0;
  for (const rel of files) {
    const abs = path.join(root, rel);
    let buf;
    try {
      if (!fs.statSync(abs).isFile()) continue;
      buf = fs.readFileSync(abs);
    } catch {
      continue;   // listed but deleted in the working tree
    }
    if (isBinary(buf)) { binary++; continue; }
    read++;
    for (const h of scanText(buf.toString('utf8'))) hits.push({ file: rel, ...h });
  }
  return { hits, read, binary };
}

/** Tracked files, then untracked files git would add, as git lists them. */
function listFiles() {
  const run = (args) => {
    const r = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    if (r.error || r.status !== 0) {
      throw new Error(`git ${args.join(' ')} failed: ${(r.error && r.error.message) || r.stderr}`);
    }
    return r.stdout.split('\0').filter(Boolean);
  };
  return [...new Set([...run(['ls-files', '-z']), ...run(['ls-files', '-z', '--others', '--exclude-standard'])])];
}

const problems = [];

// ── The scan proves itself on planted text ─────────────────────────────────
(function selfTest() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'occlara-attribution-'));
  try {
    const coach = NAMES[0].text;
    const real = `${NAMES[1].text} ${NAMES[2].text}`;
    const team = NAMES[3].text;
    const planted = {
      'handle.md': `A note from ${coach.toUpperCase()} reviews.\nAnd ${coach.toLowerCase()} again.\n`,
      'name.js': `// built by ${real}, head coach\n`,
      'team.json': `{ "source": "${team}" }\n`,
      // Near misses: words with the coach's surname inside them, and the team
      // in lower case or inside a longer word. None of them is a mention.
      'near.txt': `French, in the trenches.\nThe ${team.toLowerCase()} channel, ${team}X and X${team}.\n`,
      // A mention after a NUL is binary data, as git reads it.
      'frame.bin': Buffer.concat([Buffer.from([0xff, 0xd8, 0x00]), Buffer.from(coach)]),
    };
    for (const [name, body] of Object.entries(planted)) fs.writeFileSync(path.join(dir, name), body);
    const got = scanFiles(dir, Object.keys(planted));
    const at = (file) => got.hits.filter((h) => h.file === file).map((h) => `${h.line}:${h.label}`).join(',');
    const want = { 'handle.md': '1:the coach,2:the coach', 'name.js': '1:the coach,1:the coach', 'team.json': '1:the team', 'near.txt': '', 'frame.bin': '' };
    for (const [file, expected] of Object.entries(want)) {
      if (at(file) !== expected) {
        problems.push(`the self test read ${file} as [${at(file)}], expected [${expected}], so the scan cannot be trusted`);
      }
    }
    if (got.binary !== 1) problems.push(`the self test skipped ${got.binary} binary files, expected 1`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}());

// ── The repo ───────────────────────────────────────────────────────────────
let files = [];
try {
  files = listFiles();
} catch (e) {
  problems.push(`${e.message}. With nothing listed nothing is checked, which is not a pass`);
}
const { hits, read, binary } = scanFiles(ROOT, files);
for (const h of hits) problems.push(`${h.file}:${h.line} names ${h.label}`);
if (files.length && !read) problems.push('git listed files and none of them could be read');

console.log(`read ${read} files (${binary} binary skipped) for the names of the coach and team the playbook's notes came from`);
if (!problems.length) {
  console.log('PASS: no file names where a note came from, and the scan found every planted mention first');
  process.exit(0);
}
console.log(`\nFAIL: ${problems.length} problem(s)`);
for (const p of problems) console.log(`  - ${p}`);
process.exit(1);

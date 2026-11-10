'use strict';

/**
 * THE PUBLIC MIRROR (8.11): lowful/Occlara shows the app's source, nothing else.
 *
 * Development happens in the private repo (lowful/occlara-dev): the app, the
 * server, the tests and the docs. lowful/Occlara is public so a player can
 * read what runs on their PC (TRUST.md), and it carries the public download
 * (release 296500148, tag Release). This script is the only way anything
 * reaches it: it exports an allowlist of the app's own files at HEAD, adds the
 * public README, TRUST and LICENSE from public-repo/, refuses to publish if
 * anything outside the allowlist or anything secret shaped is in it, and
 * commits that tree to the public main, then moves the Release tag to it.
 *
 *   node scripts/publish-public.js --dry     export and check only (default)
 *   node scripts/publish-public.js --push    commit on top of the public main
 *   node scripts/publish-public.js --first   replace the public main with one
 *                                            orphan commit (the history rewrite)
 *
 * The server, its prompts, the playbook, the tests and the docs never leave
 * the private repo. check:publicmirror runs the export and the guard offline.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PUBLIC_URL = 'https://github.com/lowful/Occlara.git';
const TAG = 'Release';

/** What the mirror holds: the app's own tree, and nothing else. */
const EXPORT_PATHS = ['src', 'assets', 'native', 'build', 'changelog/changelog.json', 'package.json', 'package-lock.json'];
const PUBLIC_FILES = ['README.md', 'TRUST.md', 'LICENSE'];
const TOP_ALLOWED = new Set(['src', 'assets', 'native', 'build', 'changelog', 'package.json', 'package-lock.json', '.gitignore', ...PUBLIC_FILES]);

/** A name that must never be published, whatever folder it is in. */
const BAD_NAME = [/(^|\/)server(\/|$)/i, /playbook/i, /(^|\/)cases\.json$/i, /-prompt\b/i, /fact-gates/i, /(^|\/)\.env/i, /(^|\/)docs(\/|$)/i, /(^|\/)scripts(\/|$)/i, /(^|\/)\.github(\/|$)/i, /(^|\/)CLAUDE\.md$/i];
/** Text that looks like a secret. */
const SECRET = [/\bsk-[A-Za-z0-9_-]{16,}/, /\bsk_(?:live|test)_[A-Za-z0-9]{8,}/, /\bwhsec_[A-Za-z0-9]{10,}/, /\beyJ[A-Za-z0-9_-]{40,}/, /service_role/];
const BINARY = /\.(png|jpe?g|webp|gif|ico|icns|exe|dll|woff2?|ttf|otf|mkv|mp4|webm|mp3|wav|zip)$/i;

const PUBLIC_GITIGNORE = 'node_modules/\ndist/\ndist-*/\n.env\n';

function git(args, opts = {}) {
  return execFileSync('git', args, { cwd: opts.cwd || ROOT, encoding: opts.buffer ? null : 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'pipe'] });
}

/** The exported package.json: the same app, with only the scripts the mirror can run. */
function publicPackage(text) {
  const pkg = JSON.parse(text);
  const keep = {};
  for (const [k, v] of Object.entries(pkg.scripts || {})) {
    if (!/\bscripts\//.test(v) && !/\bserver\b/.test(v) && /^electron(-builder)?\b/.test(v)) keep[k] = v;
  }
  pkg.scripts = keep;
  return JSON.stringify(pkg, null, 2) + '\n';
}

/** Write the mirror's tree, from `ref` of the private repo, into `out` (made empty first). */
function exportMirror(out, ref = 'HEAD') {
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  const files = git(['ls-tree', '-r', '--name-only', ref, '--', ...EXPORT_PATHS]).split('\n').filter(Boolean);
  for (const f of files) {
    const dest = path.join(out, f);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    let body = git(['show', `${ref}:${f}`], { buffer: true });
    if (f === 'package.json') body = Buffer.from(publicPackage(body.toString('utf8')));
    fs.writeFileSync(dest, body);
  }
  for (const f of PUBLIC_FILES) fs.copyFileSync(path.join(ROOT, 'public-repo', f), path.join(out, f));
  fs.writeFileSync(path.join(out, '.gitignore'), PUBLIC_GITIGNORE);
  return files.length + PUBLIC_FILES.length + 1;
}

function walk(dir, base = dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === '.git') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, base, acc);
    else acc.push(path.relative(base, p).split(path.sep).join('/'));
  }
  return acc;
}

/** Every reason this tree must not be published; empty when it may be. */
function leakGuard(dir) {
  const problems = [];
  for (const rel of walk(dir)) {
    const top = rel.split('/')[0];
    if (!TOP_ALLOWED.has(top)) problems.push(`${rel}: outside the allowlist`);
    if (BAD_NAME.some((re) => re.test(rel))) problems.push(`${rel}: a private name`);
    if (BINARY.test(rel)) continue;
    const text = fs.readFileSync(path.join(dir, rel), 'utf8');
    for (const re of SECRET) if (re.test(text)) problems.push(`${rel}: secret shaped text (${re.source.slice(0, 14)})`);
    if (rel.startsWith('src/') && /require\(['"](?:\.\.\/)+server\//.test(text)) problems.push(`${rel}: requires server code`);
  }
  return problems;
}

function version() { return JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version; }

function main() {
  const mode = process.argv.includes('--first') ? 'first' : process.argv.includes('--push') ? 'push' : 'dry';
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'occlara-public-'));
  const tree = path.join(work, 'tree');
  const n = exportMirror(tree);
  const problems = leakGuard(tree);
  if (problems.length) {
    console.error(`[public] REFUSED: ${problems.length} problem(s)\n  ` + problems.slice(0, 40).join('\n  '));
    process.exit(1);
  }
  console.log(`[public] ${n} files exported and checked (${mode})`);
  if (mode === 'dry') { console.log(`[public] dry run, nothing pushed: ${tree}`); return; }

  const repo = path.join(work, 'repo');
  if (mode === 'first') {
    fs.mkdirSync(repo);
    git(['init', '-q', '-b', 'main'], { cwd: repo });
  } else {
    git(['clone', '-q', '--depth', '1', PUBLIC_URL, repo], { cwd: work });
    for (const e of fs.readdirSync(repo)) if (e !== '.git') fs.rmSync(path.join(repo, e), { recursive: true, force: true });
  }
  fs.cpSync(tree, repo, { recursive: true });
  const name = git(['config', 'user.name']).trim();
  const email = git(['config', 'user.email']).trim();
  git(['add', '-A'], { cwd: repo });
  const status = git(['status', '--porcelain'], { cwd: repo });
  if (!status.trim() && mode === 'push') { console.log('[public] the public source already matches, nothing to push'); return; }
  git(['-c', `user.name=${name}`, '-c', `user.email=${email}`, 'commit', '-q', '-m', `Occlara ${version()}: app source`], { cwd: repo });
  const head = git(['rev-parse', 'HEAD'], { cwd: repo }).trim();
  if (mode === 'first') {
    git(['push', '-q', '--force', PUBLIC_URL, 'HEAD:refs/heads/main'], { cwd: repo });
  } else {
    git(['push', '-q', PUBLIC_URL, 'HEAD:refs/heads/main'], { cwd: repo });
  }
  // The public download's release hangs on this tag: it follows the source.
  git(['tag', '-f', TAG, head], { cwd: repo });
  git(['push', '-q', '--force', PUBLIC_URL, `refs/tags/${TAG}`], { cwd: repo });
  console.log(`[public] lowful/Occlara main and ${TAG} are now ${head.slice(0, 7)} (Occlara ${version()})`);
}

if (require.main === module) {
  try { main(); } catch (e) { console.error('[public] FAILED:', e.message); process.exit(1); }
}

module.exports = { exportMirror, leakGuard, publicPackage, EXPORT_PATHS, TOP_ALLOWED };

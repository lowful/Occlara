'use strict';

/**
 * THE REPORT INBOX (docs/claude/feedback.md), for the owner and for a Claude
 * agent: read the players' reports, look at their pictures, reproduce, fix
 * in the repo, and mark each one.
 *
 *   npm run feedback                          the new reports, pictures saved
 *   npm run feedback -- --status triaged      another status, or all
 *   npm run feedback -- --limit 10 --no-pictures --json
 *   npm run feedback -- --mark <id> <status> [note words]
 *                                             status new | triaged | fixed | wontfix
 *
 * Through the server's admin routes, GET and POST /api/admin/feedback, with
 * the admin password (env ADMIN_PASSWORD, or server/.env), never the
 * Supabase service key: the script holds no database key, and the pictures
 * come as signed URLs good for 15 minutes. Env OCCLARA_SERVER points it at
 * another server (a local one).
 *
 * Each report is written to feedback-inbox/<id>/: report.json (every field)
 * and report.txt (the words, to read), and its pictures as 1.jpg, 2.jpg,
 * 3.jpg. The folder is gitignored: reports hold player data, and this repo
 * is public. Nothing is printed of the password.
 *
 * Exits 0 with one calm line when the password is missing or the server
 * says the inbox is not live; 1 on a refused password or a bad argument.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DEFAULT_SERVER = 'https://ghostcoach-production.up.railway.app';
const STATUSES = ['new', 'triaged', 'fixed', 'wontfix'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const PICTURE_NAME = /^[1-3]\.jpg$/;
const PICTURE_MAX = 4 * 1024 * 1024;

function adminPassword(env) {
  if (env.ADMIN_PASSWORD) return env.ADMIN_PASSWORD;
  const envFile = path.join(ROOT, 'server', '.env');
  if (env === process.env && fs.existsSync(envFile)) {
    try {
      let dotenv;
      try { dotenv = require(path.join(ROOT, 'server', 'node_modules', 'dotenv')); } catch { dotenv = require('dotenv'); }
      dotenv.config({ path: envFile, quiet: true });
    } catch { /* no dotenv: the env alone */ }
  }
  return env.ADMIN_PASSWORD || '';
}

function parse(argv) {
  const a = { status: 'new', limit: 50, pictures: true, json: false, mark: null };
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i];
    if (x === '--status') a.status = argv[++i];
    else if (x === '--limit') a.limit = Number(argv[++i]);
    else if (x === '--no-pictures') a.pictures = false;
    else if (x === '--json') a.json = true;
    else if (x === '--mark') { a.mark = { id: argv[++i], status: argv[++i], note: argv.slice(i + 1).join(' ') || null }; break; }
    else return { error: `unknown argument ${x}` };
  }
  if (a.mark) {
    if (!UUID.test(String(a.mark.id || ''))) return { error: 'the report id is not a report id' };
    if (!STATUSES.includes(a.mark.status)) return { error: `status must be one of ${STATUSES.join(', ')}` };
  } else {
    if (a.status !== 'all' && !STATUSES.includes(a.status)) return { error: `status must be all or one of ${STATUSES.join(', ')}` };
    if (!Number.isInteger(a.limit) || a.limit < 1 || a.limit > 200) return { error: 'limit must be a whole number from 1 to 200' };
  }
  return a;
}

const isJpeg = (b) => b && b.length > 3 && b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF;

/**
 * @param argv          the arguments after the script
 * @param deps.fetch    global fetch (or a fake)
 * @param deps.env      process.env
 * @param deps.dir      where the inbox is written, feedback-inbox/ by default
 * @param deps.out      (line) => print
 * @param deps.allowHttp a test server on http://127.0.0.1
 * @returns the exit code
 */
async function main(argv, deps = {}) {
  const env = deps.env || process.env;
  const out = deps.out || ((l) => console.log(l));
  const doFetch = deps.fetch || fetch;
  const dir = deps.dir || path.join(ROOT, 'feedback-inbox');
  const server = String(env.OCCLARA_SERVER || DEFAULT_SERVER).replace(/\/+$/, '');
  const a = parse(argv || []);
  if (a.error) { out(`feedback: ${a.error}`); return 1; }
  const password = adminPassword(env);
  if (!password) { out('feedback: no ADMIN_PASSWORD set (env or server/.env), nothing asked'); return 0; }
  const headers = { 'X-Admin-Password': password, Accept: 'application/json' };

  let res;
  try {
    if (a.mark) {
      res = await doFetch(`${server}/api/admin/feedback/${a.mark.id}`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: a.mark.status, note: a.mark.note }),
        signal: AbortSignal.timeout(20000),
      });
    } else {
      const q = new URLSearchParams({ status: a.status, limit: String(a.limit) });
      res = await doFetch(`${server}/api/admin/feedback?${q}`, { headers, signal: AbortSignal.timeout(20000) });
    }
  } catch (e) {
    out(`feedback: the server could not be reached (${e && e.message ? e.message.split(password).join('[password]') : 'no answer'})`);
    return 0;
  }
  const body = await res.json().catch(() => ({}));
  if (res.status === 401) { out('feedback: the admin password was refused'); return 1; }
  if (res.status === 503) { out('feedback: the inbox is not live yet (run feedback.sql in Supabase), nothing to read'); return 0; }
  if (a.mark) {
    if (res.status === 404) { out(`feedback: no report ${a.mark.id}`); return 1; }
    if (!res.ok) { out(`feedback: the mark was refused (${res.status} ${body && body.error ? body.error : ''})`); return 1; }
    out(`feedback: report ${a.mark.id} marked ${a.mark.status}${a.mark.note ? ' with a note' : ''}`);
    return 0;
  }
  if (!res.ok || !body || !Array.isArray(body.reports)) { out(`feedback: the list was refused (${res.status})`); return 1; }

  const reports = body.reports.filter((r) => r && UUID.test(String(r.id || '')));
  if (a.json) out(JSON.stringify({ reports }, null, 2));
  if (!reports.length) { out(`feedback: no ${a.status === 'all' ? '' : `${a.status} `}reports`); return 0; }
  fs.mkdirSync(dir, { recursive: true });
  for (const r of reports) {
    const own = path.join(dir, r.id);
    fs.mkdirSync(own, { recursive: true });
    fs.writeFileSync(path.join(own, 'report.json'), JSON.stringify(r, null, 2));
    const head = [`Report ${r.id}`, `Kind: ${r.kind}`, `Status: ${r.status}`, `Sent: ${r.created || ''}`,
      `Occlara ${r.version || '?'}, ${r.os || 'Windows'}, ${r.game || 'no game'}`, r.reviewId ? `Review: ${r.reviewId}` : 'Review: not attached',
      r.notes ? `Notes: ${r.notes}` : null].filter(Boolean);
    fs.writeFileSync(path.join(own, 'report.txt'), `${head.join('\n')}\n\n${r.text || ''}\n`);
    let saved = 0;
    if (a.pictures) {
      for (const p of Array.isArray(r.pictures) ? r.pictures : []) {
        if (!p || !PICTURE_NAME.test(String(p.name || '')) || typeof p.url !== 'string') continue;
        const okUrl = p.url.startsWith('https://') || (deps.allowHttp && p.url.startsWith('http://127.0.0.1:'));
        if (!okUrl) continue;
        try {
          const pr = await doFetch(p.url, { signal: AbortSignal.timeout(30000) });
          if (!pr.ok) continue;
          const buf = Buffer.from(await pr.arrayBuffer());
          if (!isJpeg(buf) || buf.length > PICTURE_MAX) continue;
          fs.writeFileSync(path.join(own, p.name), buf);
          saved++;
        } catch { /* a picture that will not come is left out */ }
      }
    }
    if (!a.json) {
      const words = String(r.text || '').split('\n').join(' ');
      out(`${r.id}  ${r.kind}  ${r.version || '?'}  ${saved}/${(r.pictures || []).length} pictures  ${words.length > 160 ? `${words.slice(0, 160)}...` : words}`);
    }
  }
  out(`feedback: ${reports.length} report${reports.length === 1 ? '' : 's'} written to ${path.relative(ROOT, dir) || dir}`);
  return 0;
}

module.exports = { main, parse };

if (require.main === module) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (e) => { console.log(`feedback: ${e.message}`); process.exitCode = 1; });
}

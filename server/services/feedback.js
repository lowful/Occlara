'use strict';

/**
 * REPORT A PROBLEM (docs/claude/feedback.md): what a player's report is, how
 * it is checked, where it is kept and the short ping the owner gets.
 *
 * A report is the player's own words, a kind (broke, coaching, idea), up to
 * three pictures the app has already downscaled and recompressed to JPEG, the
 * app version, the Windows version, the game and, only when the player ticked
 * it, the id of their last review. Never a Riot ID, a licence key or an email:
 * the account is kept as an id (`u:<user id>`, or for a licence with no
 * account `k:` and 16 hex of the key's sha256, never the key).
 *
 * KEPT IN SUPABASE: the table feedback_reports and the PRIVATE storage bucket
 * 'feedback', the pictures at `<report id>/<n>.jpg`, both written with the
 * service role alone (feedback.sql in the owner's hands). Until that SQL runs
 * every write fails with a missing relation or bucket, which is `notLive`: the
 * route answers 503 with a calm "try again later" and nothing else changes.
 *
 * THE PING: env FEEDBACK_WEBHOOK_URL, optional (unset, nothing is sent and
 * nothing said), a Discord webhook that gets the kind, the version, the first
 * 300 characters and the report id, with every mention turned off. The URL
 * is a secret: never logged, never printed, scrubbed from any error.
 *
 * The numbers here are the app's too (src/shared/feedback.js): the server
 * cannot require src/, so test:feedback holds the two copies equal.
 */

const crypto = require('crypto');
const callers = require('./caller');

const KINDS = ['broke', 'coaching', 'idea'];
const STATUSES = ['new', 'triaged', 'fixed', 'wontfix'];
const TEXT_MIN = 10;
const TEXT_MAX = 4000;
const NOTE_MAX = 2000;
const MAX_IMAGES = 3;
// A picture as it arrives: already at most 1600 px on its long side and
// recompressed by the app, so 2 MB is far above a real one.
const IMAGE_MAX_BYTES = 2 * 1024 * 1024;
// The whole JSON body: three pictures at the cap in base64, and the words.
const BODY_LIMIT = '9mb';
const SHORT_MAX = 300;
const BUCKET = 'feedback';
const TABLE = 'feedback_reports';
const WEBHOOK_MS = 5000;
const SIGNED_URL_SEC = 15 * 60;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const VERSION_RE = /^\d{1,3}\.\d{1,3}\.\d{1,3}$/;
const REVIEW_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;
const GAMES = ['valorant', 'lol'];

/**
 * The text with every control character gone but the newline and the tab, a
 * carriage return dropped, and no angle bracket left, so no HTML survives.
 * A plain loop over char codes, not a regex: nothing here for a tool to turn
 * into a literal byte (CLAUDE.md).
 */
function cleanText(s, max) {
  if (typeof s !== 'string') return '';
  let out = '';
  for (const ch of s) {
    const c = ch.codePointAt(0);
    if (c === 10 || c === 9) { out += ch; continue; }
    if (c < 32 || c === 127) continue;
    if (c >= 128 && c < 160) continue;
    // Bidi overrides and isolates, zero width marks: text that reads one way and is another.
    if ((c >= 0x200B && c <= 0x200F) || (c >= 0x202A && c <= 0x202E) || (c >= 0x2066 && c <= 0x2069) || c === 0xFEFF) continue;
    if (ch === '<' || ch === '>') continue;
    out += ch;
  }
  // Three blank lines at most in a row, and no space at either end.
  const lines = out.split('\n').map((l) => l.replace(/\s+$/, ''));
  const kept = [];
  let blank = 0;
  for (const l of lines) {
    blank = l ? 0 : blank + 1;
    if (blank <= 2) kept.push(l);
  }
  const t = kept.join('\n').trim();
  return Number.isFinite(max) ? t.slice(0, max) : t;
}

/** A short one line field (os, a note's first line): cleaned and on one line. */
function cleanLine(s, max) {
  return cleanText(typeof s === 'string' ? s : '', max).split('\n').join(' ').split('\t').join(' ').trim();
}

/** 'image/jpeg' | 'image/png' | 'image/webp' from the first bytes, or null. */
function sniff(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return 'image/jpeg';
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) return 'image/png';
  if (buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

/** The id a report is kept under: never a licence key, never an email. */
function accountIdOf(caller) {
  if (!caller) return null;
  if (caller.userId) return `u:${caller.userId}`;
  const k = caller.accountKey || caller.key;
  if (!k) return null;
  return `k:${crypto.createHash('sha256').update(String(k)).digest('hex').slice(0, 16)}`;
}

/**
 * The body checked, every field. { ok: true, report, images: [Buffer] } or
 * { ok: false, error, field }.
 */
function validate(body) {
  const b = body && typeof body === 'object' && !Array.isArray(body) ? body : null;
  if (!b) return { ok: false, error: 'invalid', field: 'body' };
  const kind = typeof b.kind === 'string' ? b.kind : '';
  if (!KINDS.includes(kind)) return { ok: false, error: 'invalid', field: 'kind' };
  if (typeof b.text !== 'string') return { ok: false, error: 'invalid', field: 'text' };
  if (b.text.length > TEXT_MAX * 2) return { ok: false, error: 'too-long', field: 'text' };
  const text = cleanText(b.text);
  if (text.length < TEXT_MIN) return { ok: false, error: 'too-short', field: 'text' };
  if (text.length > TEXT_MAX) return { ok: false, error: 'too-long', field: 'text' };
  const version = typeof b.version === 'string' && VERSION_RE.test(b.version) ? b.version : null;
  if (!version) return { ok: false, error: 'invalid', field: 'version' };
  const os = cleanLine(b.os, 80) || null;
  const game = b.game == null ? null : (GAMES.includes(b.game) ? b.game : undefined);
  if (game === undefined) return { ok: false, error: 'invalid', field: 'game' };
  const reviewId = b.reviewId == null || b.reviewId === '' ? null
    : (typeof b.reviewId === 'string' && REVIEW_ID_RE.test(b.reviewId) ? b.reviewId : undefined);
  if (reviewId === undefined) return { ok: false, error: 'invalid', field: 'reviewId' };
  const list = b.images == null ? [] : b.images;
  if (!Array.isArray(list)) return { ok: false, error: 'invalid', field: 'images' };
  if (list.length > MAX_IMAGES) return { ok: false, error: 'too-many', field: 'images' };
  const images = [];
  for (const im of list) {
    if (!im || typeof im !== 'object' || im.type !== 'image/jpeg' || typeof im.data !== 'string') return { ok: false, error: 'invalid', field: 'images' };
    if (im.data.length > Math.ceil(IMAGE_MAX_BYTES / 3) * 4 + 4) return { ok: false, error: 'too-big', field: 'images' };
    if (!im.data || !BASE64_RE.test(im.data)) return { ok: false, error: 'invalid', field: 'images' };
    const buf = Buffer.from(im.data, 'base64');
    if (!buf.length || buf.length > IMAGE_MAX_BYTES) return { ok: false, error: 'too-big', field: 'images' };
    if (sniff(buf) !== 'image/jpeg') return { ok: false, error: 'invalid', field: 'images' };
    images.push(buf);
  }
  return { ok: true, report: { kind, text, version, os, game, reviewId }, images };
}

// ── the ping ───────────────────────────────────────────────────────────────

/** An error's message with the webhook's URL, and any webhook URL, taken out. */
function scrub(msg, url) {
  let s = String(msg == null ? '' : msg);
  if (url) s = s.split(String(url)).join('[webhook]');
  // Any Discord webhook path left (a URL cut or re-encoded by the error).
  let i = s.indexOf('/api/webhooks/');
  while (i >= 0) {
    let j = i + '/api/webhooks/'.length;
    while (j < s.length && s[j] !== ' ' && s[j] !== '"' && s[j] !== "'" && s[j] !== ')' && s[j] !== '\n') j++;
    s = `${s.slice(0, i)}/api/webhooks/[hidden]${s.slice(j)}`;
    i = s.indexOf('/api/webhooks/', i + '/api/webhooks/[hidden]'.length);
  }
  return s;
}

const KIND_WORD = { broke: 'Something broke', coaching: 'Wrong coaching', idea: 'Idea' };

/**
 * The player's words with Discord's markdown taken literally: a masked link
 * ([words](url)) would put a link the owner cannot see behind innocent words,
 * a heading or a spoiler would dress the report as something else. Each
 * marker gets a backslash, a plain loop and no regex (CLAUDE.md).
 */
const BACKSLASH = String.fromCharCode(92);
const MARKDOWN = new Set([BACKSLASH, '*', '_', '~', '`', '|', '[', ']', '(', ')', '#']);
function literal(s) {
  let out = '';
  for (const ch of String(s == null ? '' : s)) out += MARKDOWN.has(ch) ? BACKSLASH + ch : ch;
  return out;
}

/** The Discord message: kind, version, the first 300 characters, the id. No mention can ping. */
function webhookPayload(id, report, pictures) {
  const cut = report.text.length > SHORT_MAX ? `${report.text.slice(0, SHORT_MAX)}...` : report.text;
  const words = literal(cut);
  const quoted = words.split('\n').map((l) => `> ${l}`).join('\n');
  const meta = [`Occlara ${report.version}`, report.game || null, pictures ? `${pictures} picture${pictures === 1 ? '' : 's'}` : null]
    .filter(Boolean).join(', ');
  return {
    content: `**${KIND_WORD[report.kind] || 'Report'}**, ${meta}\n${quoted}\nReport ${id}`.slice(0, 1900),
    allowed_mentions: { parse: [] },
    // No link previews.
    flags: 4,
  };
}

/**
 * Sends the ping, at most WEBHOOK_MS, and never throws: unset is skipped
 * silently, any failure is one log line with the URL scrubbed out.
 * Resolves 'sent' | 'skipped' | 'failed'.
 */
async function ping(id, report, pictures, deps = {}) {
  const env = deps.env || process.env;
  const url = String(env.FEEDBACK_WEBHOOK_URL || '').trim();
  if (!url) return 'skipped';
  const doFetch = deps.fetch || (typeof fetch === 'function' ? fetch : null);
  const log = deps.log || ((...a) => console.warn(...a));
  if (!doFetch || !url.startsWith('https://')) { log('[feedback] the report ping is not set up right, skipping'); return 'failed'; }
  const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = setTimeout(() => { if (ctrl) ctrl.abort(); }, deps.timeoutMs || WEBHOOK_MS);
  try {
    const res = await doFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(webhookPayload(id, report, pictures)),
      signal: ctrl ? ctrl.signal : undefined,
    });
    if (!res || !res.ok) { log(`[feedback] the report ping was refused (${res ? res.status : 'no answer'})`); return 'failed'; }
    return 'sent';
  } catch (e) {
    log(`[feedback] the report ping failed: ${scrub(e && e.message, url)}`);
    return 'failed';
  } finally {
    clearTimeout(timer);
  }
}

// ── the store ──────────────────────────────────────────────────────────────

/** A missing table, a missing bucket: the SQL has not run yet. */
function isNotLive(error) {
  if (!error) return false;
  if (callers.isMissing(error)) return true;
  const m = `${error.message || ''} ${error.error || ''}`.toLowerCase();
  const code = String(error.statusCode || error.status || '');
  return m.includes('bucket not found') || (code === '404' && m.includes('bucket'));
}

function failed(error, what) {
  const e = new Error(`${what}: ${(error && error.message) || 'failed'}`);
  if (isNotLive(error)) e.notLive = true;
  return e;
}

/**
 * The Supabase store, service role. Every method throws on an error, with
 * `notLive` set when the table or the bucket is not there yet.
 */
function createStore(supabase) {
  const db = () => (typeof supabase === 'function' ? supabase() : supabase);
  return {
    async insert(row) {
      const { error } = await db().from(TABLE).insert(row);
      if (error) throw failed(error, 'insert');
    },
    async remove(id) {
      const { error } = await db().from(TABLE).delete().eq('id', id);
      if (error) throw failed(error, 'remove');
    },
    async upload(path, buf) {
      const { error } = await db().storage.from(BUCKET).upload(path, buf, { contentType: 'image/jpeg', upsert: false });
      if (error) throw failed(error, 'upload');
    },
    async list({ status, limit }) {
      let q = db().from(TABLE).select('id, created_at, account_id, kind, text, app_version, os, game, review_id, status, notes, pictures')
        .order('created_at', { ascending: false }).limit(limit);
      if (status) q = q.eq('status', status);
      const { data, error } = await q;
      if (error) throw failed(error, 'list');
      return data || [];
    },
    async signedUrl(path) {
      const { data, error } = await db().storage.from(BUCKET).createSignedUrl(path, SIGNED_URL_SEC);
      if (error) throw failed(error, 'sign');
      return data && data.signedUrl ? data.signedUrl : null;
    },
    async mark(id, status, note) {
      const patch = { status };
      if (note !== null && note !== undefined) patch.notes = note;
      const { data, error } = await db().from(TABLE).update(patch).eq('id', id).select('id');
      if (error) throw failed(error, 'mark');
      return Array.isArray(data) ? data.length : 0;
    },
  };
}

const picturePath = (id, n) => `${id}/${n}.jpg`;

module.exports = {
  KINDS, STATUSES, TEXT_MIN, TEXT_MAX, NOTE_MAX, MAX_IMAGES, IMAGE_MAX_BYTES, BODY_LIMIT, SHORT_MAX, BUCKET, TABLE, UUID,
  cleanText, cleanLine, sniff, accountIdOf, validate, scrub, literal, webhookPayload, ping, isNotLive, createStore, picturePath,
};

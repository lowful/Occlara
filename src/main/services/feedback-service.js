'use strict';

const crypto = require('crypto');
const F = require('../../shared/feedback');

/**
 * REPORT A PROBLEM, main's half (docs/claude/feedback.md). The page asks
 * three things, each refused mid match or while the window is sealed:
 *
 *   info()          what a report will carry, for the page's note: the
 *                   version, Windows, the game and the last review's line.
 *                   Null mid match.
 *   prepare(file)   one picture the player picked, pasted or dropped:
 *                   { type, size, bytes }. Checked (PNG, JPG or WebP, at most
 *                   5 MB, its bytes really an image), downscaled to at most
 *                   1600 px on its long side and recompressed to JPEG HERE,
 *                   then held under a token until it is sent. The page gets
 *                   the token and a small preview, never the bytes back.
 *                   A WebP arrives as the PNG the page drew it to, since
 *                   nativeImage reads PNG and JPEG only.
 *   send(report)    { kind, text, tokens, withReview }: the words scrubbed of
 *                   the Riot ID, any licence key and any email, the pictures
 *                   held, the version, Windows, the game, and the last
 *                   review's id only when the player ticked it, POSTed to
 *                   /api/feedback with the account's own auth.
 *
 * Built with its effects passed in, so test-feedback.js drives it.
 *
 * @param deps.api          api-client.js ({ post })
 * @param deps.auth         () => headers, account-service.js auth()
 * @param deps.nativeImage  electron's nativeImage (or a fake)
 * @param deps.busy()       true mid match or while the window is sealed
 * @param deps.version      the running version
 * @param deps.osLine()     "Windows 11 Home 10.0.26200"
 * @param deps.game()       'valorant' | 'lol'
 * @param deps.lastReview() the newest library row of the game, or null
 * @param deps.riotId()     the stored Riot ID, only to take it out of the words
 * @param deps.email()      the account's email, only to take it out of the words
 * @param deps.gameLabel()  the game's name as the page shows it
 * @param deps.signedIn()   whether a report would carry any auth at all (may be async)
 */
const ROUTE = '/api/feedback';
const SEND_MS = 30000;
// Pictures held for a page that has not sent yet: more than the three a
// report takes, so a picture swapped out does not push a kept one out.
const MAX_HELD = 9;

function createFeedback(deps) {
  const d = deps || {};
  const log = d.log || (() => {});
  const held = new Map();   // token -> { jpeg, at }
  const busy = () => !!(d.busy && d.busy());

  async function info() {
    if (busy()) return null;
    let signed = false;
    try { signed = !!(await (d.signedIn ? d.signedIn() : false)); } catch { signed = false; }
    // Asked again after the wait: a match may have started meanwhile.
    if (busy()) return null;
    let row = null;
    try { row = d.lastReview ? d.lastReview() : null; } catch { row = null; }
    return {
      version: d.version || 'unknown',
      os: safe(d.osLine) || 'Windows',
      game: safe(d.game) || null,
      gameLabel: safe(d.gameLabel) || null,
      review: F.reviewLine(row),
      signedIn: signed,
      limits: { min: F.TEXT_MIN, max: F.TEXT_MAX, images: F.MAX_IMAGES, fileBytes: F.FILE_MAX_BYTES, types: F.FILE_TYPES.slice() },
      kinds: F.KINDS.map((id) => ({ id, label: F.KIND_LABEL[id] })),
      whatIsSent: F.WHAT_IS_SENT,
      neverSent: F.NEVER_SENT,
      said: { ...F.SAID },
    };
  }

  function prepare(file) {
    if (busy()) return said(false, 'match');
    const f = file && typeof file === 'object' ? file : {};
    if (!F.FILE_TYPES.includes(f.type)) return said(false, 'type');
    if (!(Number(f.size) > 0) || Number(f.size) > F.FILE_MAX_BYTES) return said(false, 'size');
    const buf = toBuffer(f.bytes);
    // A WebP drawn to PNG by the page can be larger than the file it came
    // from, never by this much.
    if (!buf || !buf.length || buf.length > F.FILE_MAX_BYTES * 4) return said(false, 'size');
    if (!looksLikeImage(buf)) return said(false, 'type');
    if (!d.nativeImage) return said(false, 'image');
    let img;
    try { img = d.nativeImage.createFromBuffer(buf); } catch { img = null; }
    if (!img || img.isEmpty()) return said(false, 'image');
    const { width, height } = img.getSize();
    if (!(width > 0) || !(height > 0)) return said(false, 'image');
    const scale = Math.min(1, F.LONG_SIDE / Math.max(width, height));
    const w = Math.max(1, Math.round(width * scale));
    const h = Math.max(1, Math.round(height * scale));
    const out = scale < 1 ? img.resize({ width: w, height: h, quality: 'good' }) : img;
    let jpeg = out.toJPEG(F.JPEG_QUALITY);
    if (jpeg.length > F.SEND_MAX_BYTES) jpeg = out.toJPEG(F.JPEG_QUALITY_SMALLER);
    if (!jpeg || !jpeg.length || jpeg.length > F.SEND_MAX_BYTES) return said(false, 'size');
    const token = crypto.randomUUID();
    held.set(token, { jpeg, at: Date.now() });
    while (held.size > MAX_HELD) held.delete(held.keys().next().value);
    const ph = Math.min(F.PREVIEW_HEIGHT, h);
    const pw = Math.max(1, Math.round(w * (ph / h)));
    const small = ph < h ? out.resize({ width: pw, height: ph, quality: 'good' }) : out;
    const preview = `data:image/jpeg;base64,${small.toJPEG(80).toString('base64')}`;
    return { ok: true, token, width: w, height: h, bytes: jpeg.length, preview };
  }

  /** A held picture the page took away again. */
  function drop(token) {
    held.delete(String(token || ''));
    return { ok: true };
  }

  async function send(report) {
    if (busy()) return said(false, 'match');
    const r = report && typeof report === 'object' ? report : {};
    if (!F.KINDS.includes(r.kind)) return said(false, 'kind');
    const raw = typeof r.text === 'string' ? r.text.trim() : '';
    if (raw.length < F.TEXT_MIN) return said(false, 'short');
    if (raw.length > F.TEXT_MAX) return said(false, 'long');
    const tokens = Array.isArray(r.tokens) ? r.tokens.map(String) : [];
    if (tokens.length > F.MAX_IMAGES) return said(false, 'many');
    const pictures = tokens.map((t) => held.get(t)).filter(Boolean);
    if (pictures.length !== tokens.length) return said(false, 'image');
    const text = F.scrubText(raw, { riotId: safe(d.riotId), email: safe(d.email) });
    let row = null;
    if (r.withReview === true) { try { row = d.lastReview ? d.lastReview() : null; } catch { row = null; } }
    const body = {
      kind: r.kind,
      text,
      version: d.version,
      os: safe(d.osLine) || null,
      game: safe(d.game) || null,
      reviewId: row && row.id ? String(row.id) : null,
      images: pictures.map((p) => ({ type: 'image/jpeg', data: p.jpeg.toString('base64') })),
    };
    // Asked once more right before it leaves: a match may have started.
    if (busy()) return said(false, 'match');
    let res;
    try {
      res = await d.api.post(ROUTE, body, d.auth, SEND_MS);
    } catch {
      return said(false, 'unreachable');
    }
    if (res && res.ok && res.data && typeof res.data.id === 'string') {
      for (const t of tokens) held.delete(t);
      log(`[feedback] report sent (${r.kind}, ${pictures.length} picture${pictures.length === 1 ? '' : 's'})`);
      return { ok: true, id: res.data.id, said: F.SAID.sent };
    }
    const error = F.errorOfStatus(res && res.status);
    log(`[feedback] report refused (${res ? res.status : 'no answer'})`);
    return said(false, error);
  }

  return { info, prepare, drop, send, _held: held };
}

function said(ok, error) {
  return { ok, error, said: F.SAID[error] || F.SAID.invalid };
}

function safe(fn) {
  try { return typeof fn === 'function' ? fn() : null; } catch { return null; }
}

function toBuffer(b) {
  if (!b) return null;
  if (Buffer.isBuffer(b)) return b;
  if (b instanceof Uint8Array) return Buffer.from(b.buffer, b.byteOffset, b.byteLength);
  if (b instanceof ArrayBuffer) return Buffer.from(b);
  return null;
}

/** PNG or JPEG by its first bytes: what nativeImage reads. */
function looksLikeImage(buf) {
  if (buf.length < 8) return false;
  if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return true;
  return buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47;
}

module.exports = { createFeedback, ROUTE, MAX_HELD, looksLikeImage };

'use strict';

const { SERVER_BASE_URL, TIMING } = require('../../shared/config');
// Which build is calling, so the server's live view can tell an updated client
// from one still on an old release.
const VERSION = (() => { try { return require('../../../package.json').version; } catch { return 'unknown'; } })();

/**
 * THE HEADERS A REQUEST IS SENT WITH (8.7). The third argument of post() and
 * get() is the caller's auth:
 *   - a function returning headers: account-service.js auth(), the session
 *     bearer when signed in, else X-License-Key when a key is stored. Called
 *     per request, so a sign in or a sign out applies to the next one.
 *   - a plain object of headers
 *   - a string, a licence key, sent as X-License-Key as it always was (the
 *     licence service activates the key it is handed, signed in or not)
 *   - nothing: no auth header
 * A provider that throws sends none rather than failing the request.
 */
function authHeaders(auth) {
  if (!auth) return {};
  if (typeof auth === 'string') return { 'X-License-Key': auth };
  let h = auth;
  if (typeof auth === 'function') {
    try { h = auth(); } catch { h = null; }
  }
  if (!h || typeof h !== 'object') return {};
  const out = {};
  for (const [k, v] of Object.entries(h)) if (typeof v === 'string' && v) out[k] = v;
  return out;
}

/**
 * Minimal POST helper for the Occlara backend. Always JSON, always bounded by
 * a timeout.
 *
 * Returns { ok, status, data }. Network/timeout failures throw so callers can
 * distinguish "server said no" (ok:false) from "couldn't reach server" (throw).
 */
async function post(path, body, auth, timeoutMs, extraHeaders) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs || TIMING.serverTimeout);

  try {
    const res = await fetch(SERVER_BASE_URL + path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Occlara-Version': VERSION,
        ...authHeaders(auth),
        ...(extraHeaders || {}),
      },
      body: JSON.stringify(body || {}),
      signal: controller.signal,
    });

    const text = await res.text().catch(() => '');
    let data = {};
    if (text) { try { data = JSON.parse(text); } catch { data = {}; } }

    return { ok: res.ok, status: res.status, data };
  } finally {
    clearTimeout(timer);
  }
}

/** GET helper (used for tracker player-stats). Same contract as post(). */
async function get(path, auth, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs || TIMING.serverTimeout);
  try {
    const res = await fetch(SERVER_BASE_URL + path, {
      headers: { 'X-Occlara-Version': VERSION, ...authHeaders(auth) },
      signal: controller.signal,
    });
    const text = await res.text().catch(() => '');
    let data = {};
    if (text) { try { data = JSON.parse(text); } catch { data = {}; } }
    return { ok: res.ok, status: res.status, data };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { post, get, authHeaders };

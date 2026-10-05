'use strict';

/**
 * WHO IS CALLING, for the routes that act on an account.
 *
 * The account routes used to take a userId from the query string or the body
 * and act on it: read that account's licence key, clear its device lock,
 * cancel its subscription, open its Stripe billing portal. Nothing checked that
 * the caller WAS that user, and a user id is an identifier, not a secret: it is
 * the sub claim of every Supabase token, it rode in the dashboard's query
 * string, and the webhook prints it in the logs. Anyone who learned one could
 * do all four, and CORS stopped none of it, because curl sends no Origin.
 *
 * So the caller proves it. The website already holds a Supabase session and
 * sends its access token as `Authorization: Bearer <token>`. Supabase says whose
 * token it is, and the route acts on THAT user and no other. A userId the
 * caller names as well must be the same user or the request is refused: a
 * mismatch is either a bug on the site or somebody trying, and neither should
 * be served.
 *
 * AN OUTAGE IS NOT A REFUSAL. When Supabase cannot be reached the answer is 503
 * with retry, never 401, so a blip does not read as "you are signed out". The
 * same rule the licence lookups follow. That includes Supabase rate limiting
 * us (429, which says nothing about the session) and Supabase not answering at
 * all: auth-js puts no deadline on getUser, so a hung auth server held the
 * site's request open for undici's full five minutes. It gets five seconds,
 * the same as a licence lookup.
 *
 * One module, so every account route runs the same check: four copies of this
 * would drift the way the channel names once did.
 */

/** The bearer token on a request, or null. */
function bearerOf(req) {
  const h = String((req && req.headers && req.headers.authorization) || '').trim();
  const m = /^Bearer\s+(\S+)$/i.exec(h);
  return m ? m[1] : null;
}

/** The user id a caller NAMED, in the body or the query string, or null. */
function namedUserId(req) {
  const fromBody = req && req.body && typeof req.body === 'object' ? req.body.userId : undefined;
  const fromQuery = req && req.query ? req.query.userId : undefined;
  const v = fromBody != null && fromBody !== '' ? fromBody : fromQuery;
  return v == null || v === '' ? null : String(v);
}

const AUTH_TIMEOUT_MS = 5000;

/**
 * Resolve the caller.
 *
 * @param {object} [opts] { timeoutMs }: how long Supabase gets to answer.
 * @returns {{ user: { id, email } }} when the token is good and nothing named
 *          contradicts it, otherwise {{ status, body }} for the route to send.
 */
async function verifyCaller(supabase, req, opts = {}) {
  const token = bearerOf(req);
  if (!token) return { status: 401, body: { error: 'sign-in-required' } };

  const timeoutMs = opts.timeoutMs > 0 ? opts.timeoutMs : AUTH_TIMEOUT_MS;
  let data = null;
  let error = null;
  let timer = null;
  try {
    ({ data, error } = await Promise.race([
      supabase.auth.getUser(token),
      new Promise((_, rej) => {
        timer = setTimeout(() => rej(new Error(`no answer from Supabase auth in ${timeoutMs}ms`)), timeoutMs);
      }),
    ]));
  } catch (e) {
    error = e;
  } finally {
    clearTimeout(timer);
  }
  const user = data && data.user;
  if (error || !user || !user.id) {
    // Supabase answers a bad, expired or signed out token with a 4xx. Anything
    // else (no status at all is a network failure or no answer, 5xx is
    // Supabase itself failing, 429 is Supabase throttling this server) says
    // nothing about the session, so it is not treated as one.
    const status = Number(error && error.status) || 0;
    if (!error || (status >= 400 && status < 500 && status !== 429)) {
      return { status: 401, body: { error: 'session-invalid' } };
    }
    console.warn('[auth] could not verify a session:', (error && error.message) || error);
    return { status: 503, body: { error: 'auth-unavailable', retry: true } };
  }

  const named = namedUserId(req);
  if (named && named !== user.id) {
    console.warn(`[auth] refused: a session for ${String(user.id).slice(0, 8)}... named another user`);
    return { status: 403, body: { error: 'user-mismatch' } };
  }
  return { user: { id: user.id, email: user.email || null } };
}

/**
 * Express middleware: sets req.user, or answers the request itself.
 * Takes the Supabase client so the routes and the tests share one check.
 */
function requireUser(supabase, opts) {
  return async (req, res, next) => {
    let r;
    try {
      r = await verifyCaller(supabase, req, opts);
    } catch (e) {
      console.warn('[auth] check failed:', e.message);
      r = { status: 503, body: { error: 'auth-unavailable', retry: true } };
    }
    if (r.user) { req.user = r.user; return next(); }
    return res.status(r.status).json(r.body);
  };
}

module.exports = { requireUser, verifyCaller, bearerOf, namedUserId };

'use strict';

/**
 * The admin password, checked one way everywhere.
 *
 * The admin views show every licence holder's email, plan and live activity,
 * and the password used to be checked three times over in admin.js with a
 * plain !== against either a header or a ?password= query string. Three things
 * were wrong with that, and each is fixed here once:
 *
 *   THE QUERY STRING. A password in a URL lands in proxy logs, access logs and
 *   browser history. Nothing in this repo sent it that way (the live page and
 *   the README both use the header), so only X-Admin-Password is read.
 *
 *   THE COMPARISON. !== stops at the first differing character, so its timing
 *   says how much of a guess was right. Both sides are hashed first, which
 *   gives timingSafeEqual the two equal length buffers it insists on.
 *
 *   THE GUESSING. A wrong password cost nothing and nothing counted it, so a
 *   script could try as fast as the connection allowed. adminLimiter counts
 *   failures per IP, ten an hour, the same shape the activation limiter uses.
 *   Successes are not counted, and neither is the server's own 5xx: the live
 *   page polls every five seconds with the right password and must never lock
 *   its own admin out.
 *
 * The same check gates benchModel in coach.js, because switching every read to
 * a dearer model is an admin act and not something any licence may do.
 */

const crypto = require('crypto');

const digest = (s) => crypto.createHash('sha256').update(String(s)).digest();

/** Is this the admin password? False whenever none is configured. */
function adminPasswordOk(provided, expected = process.env.ADMIN_PASSWORD) {
  if (!expected || typeof provided !== 'string' || !provided) return false;
  return crypto.timingSafeEqual(digest(provided), digest(expected));
}

/** The password a request carries. The header only, never the query string. */
function adminPasswordOf(req) {
  const h = req && req.headers ? req.headers['x-admin-password'] : null;
  return typeof h === 'string' ? h : null;
}

/** Does this request carry the admin password? */
function isAdmin(req) {
  return adminPasswordOk(adminPasswordOf(req));
}

/** A fresh limiter. One instance is shared by every admin path in server.js. */
function makeAdminLimiter() {
  // Required here rather than at the top, so the coach routes, which only
  // need the password check, do not load a rate limiter they never use.
  const rateLimit = require('express-rate-limit');
  return rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 10,
    skipSuccessfulRequests: true,
    // A 5xx is the server failing, not a guess, the same rule as the
    // activation limiter. The live page keeps polling through one, so ten of
    // them, fifty seconds of a broken /live, used to lock the admin out of
    // the one page they would want during an incident, for an hour.
    requestWasSuccessful: (req, res) => res.statusCode < 400 || res.statusCode >= 500,
    message: { error: 'Too many admin attempts. Try again in 1 hour.' },
    standardHeaders: true,
    legacyHeaders: false,
  });
}

module.exports = { adminPasswordOk, adminPasswordOf, isAdmin, makeAdminLimiter };

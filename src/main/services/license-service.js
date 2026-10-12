'use strict';

const os     = require('os');
const crypto = require('crypto');
const store  = require('./store');
const api    = require('./api-client');
const { API } = require('../../shared/config');

/**
 * License activation + caching + background re-validation against the documented
 * backend. The backend only exposes /api/license/activate, so we use it for both
 * first activation and periodic re-checks (idempotent for the bound device).
 */

// Deterministic device identity (matches the old client's derivation).
function computeDeviceId() {
  const raw = `${os.hostname()}::${os.userInfo().username}::${process.platform}`;
  return crypto.createHash('sha256').update(raw).digest('hex');
}
function deviceName() { return os.hostname() || 'Unknown Device'; }

// The LIVE backend expects snake_case { key, device_id, device_name } (verified
// against the production server, the documented camelCase contract was stale).
function buildBody(key, deviceId) {
  return { key, device_id: deviceId, device_name: deviceName() };
}

// Responses may use either camelCase or snake_case, normalize defensively.
function normalize(data = {}) {
  return {
    valid:     !!data.valid,
    plan:      data.plan   || '',
    status:    data.status || '',
    expiresAt: data.expiresAt || data.expires_at || '',
    error:     data.error  || '',
    reason:    data.reason || data.status || '',
  };
}

/*
 * A SERVER THAT COULD NOT CHECK IS NOT A SERVER THAT SAID NO.
 *
 * The licence server used to answer a failed database query exactly like a
 * key that does not exist: 404 with valid:false. This file takes an explicit
 * valid:false as final, so one failed query on the three minute re-check was
 * stored as an expired licence, stopped the recording in progress mid match,
 * and told a paying player to renew. The server now answers an outage with 503
 * and retry:true and no valid field at all.
 *
 * This side holds the line too, whatever answers: a 5xx (Railway's edge in
 * front of a crashed process can send its own), a 429, or a body asking for a
 * retry is transient. It keeps the stored status and expires nothing, even if
 * the body happens to carry valid:false.
 */
function isTransient(resp) {
  const status = Number(resp && resp.status) || 0;
  return status >= 500 || status === 429 || !!(resp && resp.data && resp.data.retry === true);
}

/*
 * WHAT A STATUS SAYS, IN THE LICENCE WINDOW AND IN THE RUNNING APP.
 *
 * A plan bought after the last one ended is a NEW key (the site mints one per
 * checkout), while the app goes on checking the key it holds. So an ended
 * subscription says, in the app, to log out in Settings and enter the new key:
 * "Renew at occlara.app" alone left a player who had renewed locked out, the
 * old key "ended" for good. In the licence window the player is entering a
 * key, so there it says which key to enter.
 */
const STATUS_MESSAGES = {
  expired:        'This key has expired. Buy a plan at occlara.app/account and enter the new key it gives you.',
  cancelled:      'This key\'s subscription was cancelled. Buy a plan at occlara.app/account and enter the new key it gives you.',
  payment_failed: 'The last payment for this key failed. Update your card at occlara.app/account.',
  refunded:       'This key was refunded, so it no longer works.',
  disputed:       'This key\'s payment is disputed, so it no longer works. Email support@occlara.app.',
  device_mismatch:'This key is active on another device. Deactivate it there first.',
  invalid:        'That license key is not valid.',
};
function messageForStatus(status) {
  return STATUS_MESSAGES[status] || null;
}
const RENEW = 'Renew at occlara.app/account, then log out in Settings and enter your new key.';
const ENDED_NOTICES = {
  expired:        `Your subscription has ended. ${RENEW}`,
  cancelled:      `Your subscription was cancelled. ${RENEW}`,
  payment_failed: 'Your last payment failed. Update your card at occlara.app/account to keep getting reviews.',
  refunded:       'This key was refunded, so it no longer works. Log out in Settings to enter another key.',
  disputed:       'This key\'s payment is disputed, so it no longer works. Email support@occlara.app.',
  device_mismatch:'This key is active on another device. Deactivate it there first.',
};
/** The notice line's words for a licence that ended while the app ran. */
function endedMessage(status) {
  return ENDED_NOTICES[status] || `Your subscription has ended. ${RENEW}`;
}

/*
 * A FAILED PAYMENT IS A GRACE, NOT AN END (8.3.2). The server marks a licence
 * payment_failed on Stripe's first failed attempt at a renewal, and keeps it
 * usable until its expiry, two days past the period end, while Stripe tries
 * the card again. Refused here, it stopped the match being recorded within
 * three minutes of a declined card. With no expiry it is not usable.
 */
function usable(status, expiry) {
  if (expiry && !(new Date(expiry) > new Date())) return false;
  if (status === 'active') return true;
  return status === 'payment_failed' && !!expiry;
}

/**
 * What the notice line does about a payment grace (index.js notePaymentGrace),
 * from whether it was said already and the licence as it stands: 'say' it
 * once as the grace begins, 'clear' it once paid or ended, else nothing, so
 * another notice that takes the line meanwhile is never pushed off it again.
 */
function graceStep(warned, active, status) {
  const failing = !!active && status === 'payment_failed';
  if (failing && !warned) return { warned: true, act: 'say' };
  if (!failing && warned) return { warned: false, act: 'clear' };
  return { warned: !!warned, act: null };
}

function persist(licenseKey, n, deviceId) {
  store.set('licenseKey',    licenseKey);
  store.set('licenseStatus', n.status   || 'active');
  store.set('licensePlan',   n.plan     || '');
  store.set('licenseExpiry', n.expiresAt || '');
  store.set('deviceId',      deviceId);
  store.set('licenseRefused', false);
}

function clear() {
  store.set('licenseKey',    '');
  store.set('licenseStatus', '');
  store.set('licensePlan',   '');
  store.set('licenseExpiry', '');
  store.set('licenseRefused', false);
}

function getCached() {
  return {
    licenseKey:    store.get('licenseKey'),
    licensePlan:   store.get('licensePlan'),
    licenseStatus: store.get('licenseStatus'),
    licenseExpiry: store.get('licenseExpiry'),
  };
}

/**
 * Fast, no-network local validity check used for instant startup.
 *
 * AND NEVER ONE THE SERVER LAST REFUSED (`licenseRefused`). A refusal used to
 * store a status this always took as ended, until the failed payment's grace
 * made 'payment_failed' usable: a server that refuses one (any before 8.3.2,
 * or the rule's own refusal of one with no expiry) left it stored usable, so
 * the next outage or offline re-check, which answers with this, revived the
 * key it had refused, and the answer after it stopped the match being
 * recorded again. Only the server's next yes clears it.
 */
function isLocallyValid() {
  const key    = store.get('licenseKey');
  const status = store.get('licenseStatus');
  const expiry = store.get('licenseExpiry');
  return !!key && !store.get('licenseRefused') && usable(status, expiry);
}

/**
 * Activate a key entered by the user. Persists on success.
 * Returns { ok, valid, plan?, status?, expiresAt?, error? }.
 */
async function activate(rawKey) {
  const licenseKey = (rawKey || '').trim().toUpperCase();
  if (!licenseKey) return { ok: true, valid: false, error: 'Enter your license key.' };

  const deviceId = computeDeviceId();

  let resp;
  try {
    resp = await api.post(API.ACTIVATE, buildBody(licenseKey, deviceId), licenseKey);
  } catch (err) {
    // Couldn't reach server. Offline grace: accept a matching, unexpired cache.
    if (offlineGraceAllows(licenseKey, deviceId)) {
      console.warn('[license] Server unreachable, accepting cached license');
      return { ok: true, valid: true, plan: store.get('licensePlan'),
               status: store.get('licenseStatus') || 'active', expiresAt: store.get('licenseExpiry') };
    }
    console.error('[license] activate network error:', err.message);
    return { ok: false, valid: false, error: 'Could not reach the server. Check your connection.' };
  }

  const n = normalize(resp.data);
  if (resp.ok && n.valid) {
    persist(licenseKey, n, deviceId);
    console.log('[license] Activated:', n.plan || '(no plan)', n.status || '');
    return { ok: true, valid: true, plan: n.plan, status: n.status, expiresAt: n.expiresAt };
  }

  // The server could not check the key right now. Treated like being offline:
  // the same cached key on the same device is accepted, anything else is told
  // to try again rather than shown a server code as if the key were wrong.
  // Except a 429, which is the activation limiter after ten failed keys from
  // this address: its own sentence says how long ("Try again in 1 hour"), and
  // "try again in a minute" would send the player back into the same wall.
  if (isTransient(resp)) {
    if (offlineGraceAllows(licenseKey, deviceId)) {
      console.warn('[license] Licence server could not check, accepting cached license');
      return { ok: true, valid: true, plan: store.get('licensePlan'),
               status: store.get('licenseStatus') || 'active', expiresAt: store.get('licenseExpiry') };
    }
    console.warn('[license] activate: licence server could not check (status', resp.status + ')');
    return { ok: false, valid: false,
             error: (resp.status === 429 && n.error)
               || 'The licence server could not check your key just now. Try again in a minute.' };
  }

  return {
    ok: true,
    valid: false,
    error: messageForStatus(n.reason) || n.error || 'That key could not be activated.',
  };
}

function offlineGraceAllows(licenseKey, deviceId) {
  return store.get('licenseKey') === licenseKey
      && ['active', 'payment_failed'].includes(store.get('licenseStatus'))
      && store.get('deviceId') === deviceId
      && isLocallyValid();
}

/**
 * Silent background re-validation for an already-cached license.
 * Rule: only sign out on an EXPLICIT valid:false from a server that could
 * check. Network errors, outages (5xx, 429, retry:true) and ambiguous
 * responses keep the cached session and write nothing.
 * Returns { valid, status?, offline?, transient?, ambiguous? }.
 *
 * Unanswered, `valid` is what the STORED licence says (isLocallyValid), so an
 * outage neither ends a good licence nor revives one that had already ended.
 */
async function revalidate() {
  const key = store.get('licenseKey');
  if (!key) return { valid: false };

  let resp;
  try {
    resp = await api.post(API.ACTIVATE, buildBody(key, computeDeviceId()), key);
  } catch (err) {
    console.warn('[license] revalidate offline:', err.message);
    return { valid: isLocallyValid(), offline: true };
  }

  const n = normalize(resp.data);
  if (resp.ok && n.valid) {
    store.set('licenseStatus', n.status   || 'active');
    store.set('licensePlan',   n.plan     || store.get('licensePlan'));
    // The server's expiry whenever it sends the field, null included: a key
    // made lifetime by hand answers expiresAt null, and keeping the date it
    // had ended it again on this PC each time that date came round.
    const sent = !!resp.data && ('expiresAt' in resp.data || 'expires_at' in resp.data);
    store.set('licenseExpiry', sent ? (n.expiresAt || '') : store.get('licenseExpiry'));
    store.set('licenseRefused', false);
    return { valid: true };
  }
  if (isTransient(resp)) {
    console.warn('[license] revalidate: licence server could not check (status', resp.status + '), keeping the cached status');
    return { valid: isLocallyValid(), transient: true };
  }
  if (resp.data && resp.data.valid === false) {
    // Keep the key (so a later renewal can be detected) but flag the status so
    // isLocallyValid() fails and the session locks. Manual Log out clears it.
    store.set('licenseStatus', n.reason || 'expired');
    store.set('licenseRefused', true);
    console.warn('[license] revalidate: server says invalid ->', n.reason || 'unknown');
    return { valid: false, status: n.reason || 'expired' };
  }
  return { valid: isLocallyValid(), ambiguous: true }; // keep cache on anything unclear
}

module.exports = {
  activate,
  revalidate,
  getCached,
  clear,
  isLocallyValid,
  computeDeviceId,
  messageForStatus,
  endedMessage,
  usable,
  graceStep,
};

'use strict';
const express  = require('express');
const supabase = require('../db/supabase');
const { requireUser } = require('../services/account-auth');

const router = express.Router();
const signedIn = requireUser(supabase);

const KEY_REGEX = /^GC-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/;
const DANGEROUS = /<script|--|;drop|;delete|union select/i;

function sanitizeKey(key) { return String(key).trim().toUpperCase(); }

/*
 * A FAILED LOOKUP IS NOT "NOT FOUND".
 *
 * supabase-js answers a network failure, a pooler timeout, a PostgREST 5xx or a
 * paused project with { data: null, error }, exactly the shape of "no such
 * row", and both routes below read either as "License key not found" with
 * valid:false. The desktop app re-checks its licence here every three minutes
 * and takes an explicit valid:false as final: it stored the licence as
 * expired, stopped the recording in progress mid match and told a paying
 * player to renew. One failed query was enough.
 *
 * Only PGRST116 means the row is not there. Anything else is answered 503 with
 * retry and NO valid field, which the client already treats as "ask again
 * later" and keeps its session through. The lookup also gives up after five
 * seconds, inside the client's own eight, so a hung connection reads as an
 * outage instead of as the client timing out.
 */
const LOOKUP_MS = 5000;
const notFound = (error) => !!(error && error.code === 'PGRST116');
// A sentence in `error`, because the activation window of every installed
// client prints that field as it is; the code is for anything that branches.
const UNAVAILABLE = {
  error: 'The licence server could not check your key just now. Try again in a minute.',
  code: 'licence-check-unavailable',
  retry: true,
};

async function licenceByKey(cleanKey) {
  try {
    return await supabase
      .from('licenses')
      .select('*')
      .eq('license_key', cleanKey)
      .abortSignal(AbortSignal.timeout(LOOKUP_MS))
      .single();
  } catch (e) {
    return { data: null, error: { code: '', message: e.message } };
  }
}

/*
 * A FAILED PAYMENT IS A GRACE, NOT AN END.
 *
 * The webhook marks a licence payment_failed on Stripe's FIRST failed attempt
 * at a renewal, while its expires_at still runs two days past the period end
 * (services/billing.js) and Stripe goes on trying the card. Refused here, the
 * app's three minute re-check ended the licence and stopped the match being
 * recorded within minutes of a declined card. So a payment_failed licence is
 * usable until its expiry, answered valid with its status, which the app warns
 * on and works through; once that expiry passes it is expired, and with no
 * expiry at all (nothing bounds it) it is not usable. Active is as it always
 * was. Cancelled, expired, refunded, disputed and anything else never are.
 *
 * One rule, for /activate, /validate and the coach routes' checkKey
 * (routes/coach.js), and the same one the app keeps for a licence it holds
 * (src/main/services/license-service.js usable, which test:licenceoutage holds
 * equal to this).
 */
function usable(status, expiresAt, now = Date.now()) {
  const until = expiresAt ? new Date(expiresAt).getTime() : null;
  if (until !== null && until < now) return false;   // past its expiry, whatever its status
  if (status === 'active') return true;
  return status === 'payment_failed' && until !== null && until > now;
}

/**
 * Whether the app asking knows the grace: 8.3.2 and later, by the version
 * every request carries (X-Occlara-Version). One before it stores the status
 * it is answered, and its own minute check reads anything but 'active' as
 * ended: answered valid with payment_failed it stopped the session within a
 * minute of every three minute re-check and offered Start again in between,
 * through the whole grace. So it is answered as it always was, refused, which
 * it ends on once and stays.
 */
const GRACE_FROM = [8, 3, 2];
function knowsGrace(req) {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(String((req && req.headers && req.headers['x-occlara-version']) || ''));
  if (!m) return false;
  for (let i = 0; i < GRACE_FROM.length; i++) {
    const d = Number(m[i + 1]) - GRACE_FROM[i];
    if (d !== 0) return d > 0;
  }
  return true;
}

// POST /api/license/activate
// Body: { key, device_id, device_name }
// First activation locks the license to device_id; same device can reactivate freely.
router.post('/activate', async (req, res) => {
  const { key, device_id, device_name } = req.body;

  if (!key)       return res.status(400).json({ valid: false, error: 'License key is required' });
  if (!device_id) return res.status(400).json({ valid: false, error: 'device_id is required' });
  if (DANGEROUS.test(key)) return res.status(400).json({ valid: false, error: 'Invalid key format' });

  const cleanKey = sanitizeKey(key);
  if (!KEY_REGEX.test(cleanKey)) return res.status(400).json({ valid: false, error: 'Invalid license key format' });

  const { data: license, error: fetchErr } = await licenceByKey(cleanKey);

  if (fetchErr && !notFound(fetchErr)) {
    console.error('[license] activate lookup failed:', fetchErr.message || fetchErr.code);
    return res.status(503).json(UNAVAILABLE);
  }
  if (!license) return res.status(404).json({ valid: false, error: 'License key not found' });

  if (license.expires_at && new Date(license.expires_at) < new Date())
    return res.json({ valid: false, status: 'expired', error: 'License has expired' });

  // Active, or a failed payment inside its grace (usable, above), which is
  // answered valid with status payment_failed for the app to warn on, when
  // the app knows the grace (knowsGrace).
  if (!usable(license.status, license.expires_at)
      || (license.status === 'payment_failed' && !knowsGrace(req)))
    return res.json({ valid: false, status: license.status, error: `License status: ${license.status}` });

  // Device lock check
  if (license.device_id && license.device_id !== device_id) {
    return res.json({
      valid: false, status: 'device_mismatch', reason: 'device_mismatch',
      error: 'This key is already activated on another device. Deactivate it first from your account dashboard.',
    });
  }

  // First activation, lock to this device
  if (!license.device_id) {
    await supabase
      .from('licenses')
      .update({ device_id, device_name: device_name || 'Unknown Device' })
      .eq('license_key', cleanKey);
    // The licence by its id, never its key: Railway's logs are not where keys belong.
    console.log(`[license] Activated licence ${license.id} on "${device_name}"`);
  }

  res.json({
    valid: true, plan: license.plan, status: license.status,
    expiresAt: license.expires_at, deviceName: device_name || license.device_name,
  });
});

// POST /api/license/deactivate
// Header: Authorization: Bearer <Supabase access token>. Body: { userId? },
// which must be the token's own user when it is sent at all.
// Clears device lock. Max 3 deactivations per calendar month, where the table
// can count them (below).
// It acts on the SIGNED IN user, never on a userId the caller names: anyone
// who knew an id could clear its lock and take the key for their own PC.
//
// IT WROTE COLUMNS THE TABLE DOES NOT HAVE, AND SAID IT WORKED. The live
// licences table (the site's src/integrations/supabase/types.ts) has device_id
// and device_name and no deactivation_count or last_deactivation_date, so
// PostgREST refused the whole write (PGRST204), the device stayed locked, and
// the route answered success because it never read the error. It now writes
// the count only where the row it read carries those columns, which is the
// table saying it has them, and any refused write is a 503, never a success.
// Until the table has them, nothing counts deactivations, here or on the site,
// which clears the device fields itself.
const COUNTED = ['deactivation_count', 'last_deactivation_date'];
router.post('/deactivate', signedIn, async (req, res) => {
  const userId = req.user.id;

  const { data: license, error } = await supabase
    .from('licenses')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (error && !notFound(error)) {
    console.error('[license] deactivate lookup failed:', error.message || error.code);
    return res.status(503).json(UNAVAILABLE);
  }
  if (!license) return res.status(404).json({ error: 'No license found for this account' });
  if (!license.device_id) return res.status(400).json({ error: 'License is not activated on any device' });

  const counts = COUNTED.every((c) => Object.prototype.hasOwnProperty.call(license, c));
  const thisMonth = new Date().toISOString().slice(0, 7);
  const lastMonth = counts && license.last_deactivation_date ? String(license.last_deactivation_date).slice(0, 7) : null;
  const count = lastMonth === thisMonth ? (license.deactivation_count || 0) : 0;

  if (counts && count >= 3) return res.status(429).json({ error: 'Deactivation limit reached. Maximum 3 per month.' });

  const patch = { device_id: null, device_name: null };
  if (counts) Object.assign(patch, { deactivation_count: count + 1, last_deactivation_date: new Date().toISOString() });

  const { data: cleared, error: writeErr } = await supabase
    .from('licenses')
    .update(patch)
    .eq('id', license.id)
    .select('id');
  if (writeErr || !cleared || !cleared.length) {
    console.error('[license] deactivate write failed:',
      writeErr ? `${writeErr.code || 'no code'} ${writeErr.message || ''}` : 'no row was changed');
    return res.status(503).json({
      error: 'The device could not be deactivated just now. Try again in a minute.',
      code: 'deactivate-failed',
      retry: true,
    });
  }

  console.log(`[license] Deactivated licence ${license.id}${counts ? ` (this month: ${count + 1})` : ''}`);
  res.json({
    success: true,
    deactivationsThisMonth: counts ? count + 1 : null,
    deactivationsRemaining: counts ? 3 - (count + 1) : null,
  });
});

// POST /api/license/validate
// Body: { key, device_id }
// Periodic check from Electron app during coaching.
router.post('/validate', async (req, res) => {
  const { key, device_id } = req.body;
  if (!key) return res.status(400).json({ valid: false, error: 'License key is required' });

  const cleanKey = sanitizeKey(key);
  if (!KEY_REGEX.test(cleanKey)) return res.status(400).json({ valid: false, error: 'Invalid license key format' });

  const { data: license, error } = await licenceByKey(cleanKey);

  if (error && !notFound(error)) {
    console.error('[license] validate lookup failed:', error.message || error.code);
    return res.status(503).json(UNAVAILABLE);
  }
  if (!license) return res.status(404).json({ valid: false, error: 'License key not found' });

  if (license.expires_at && new Date(license.expires_at) < new Date())
    return res.json({ valid: false, status: 'expired', error: 'License has expired' });

  if (!usable(license.status, license.expires_at)
      || (license.status === 'payment_failed' && !knowsGrace(req)))
    return res.json({ valid: false, status: license.status, error: `License status: ${license.status}` });

  if (device_id && license.device_id && license.device_id !== device_id)
    return res.json({ valid: false, status: 'device_mismatch', reason: 'device_mismatch', error: 'License is activated on a different device.' });

  res.json({
    valid: true, plan: license.plan, status: license.status,
    expiresAt: license.expires_at, deviceName: license.device_name || null,
  });
});

module.exports = router;
// The licence rule, for the coach routes' checkKey and the tests.
module.exports.usable = usable;
module.exports.knowsGrace = knowsGrace;

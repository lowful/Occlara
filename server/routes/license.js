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

  if (license.status !== 'active')
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
    console.log(`[license] Activated: ${cleanKey} on "${device_name}"`);
  }

  res.json({
    valid: true, plan: license.plan, status: license.status,
    expiresAt: license.expires_at, deviceName: device_name || license.device_name,
  });
});

// POST /api/license/deactivate
// Header: Authorization: Bearer <Supabase access token>. Body: { userId? },
// which must be the token's own user when it is sent at all.
// Clears device lock. Max 3 deactivations per calendar month.
// It acts on the SIGNED IN user, never on a userId the caller names: anyone
// who knew an id could clear its lock and take the key for their own PC.
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

  const thisMonth = new Date().toISOString().slice(0, 7);
  const lastMonth = license.last_deactivation_date ? license.last_deactivation_date.slice(0, 7) : null;
  const count = lastMonth === thisMonth ? (license.deactivation_count || 0) : 0;

  if (count >= 3) return res.status(429).json({ error: 'Deactivation limit reached. Maximum 3 per month.' });

  await supabase
    .from('licenses')
    .update({
      device_id: null, device_name: null,
      deactivation_count: count + 1,
      last_deactivation_date: new Date().toISOString(),
    })
    .eq('license_key', license.license_key);

  console.log(`[license] Deactivated: ${license.license_key} (this month: ${count + 1})`);
  res.json({ success: true, deactivationsThisMonth: count + 1, deactivationsRemaining: 3 - (count + 1) });
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

  if (license.status !== 'active')
    return res.json({ valid: false, status: license.status, error: `License status: ${license.status}` });

  if (device_id && license.device_id && license.device_id !== device_id)
    return res.json({ valid: false, status: 'device_mismatch', reason: 'device_mismatch', error: 'License is activated on a different device.' });

  res.json({
    valid: true, plan: license.plan, status: license.status,
    expiresAt: license.expires_at, deviceName: license.device_name || null,
  });
});

module.exports = router;

'use strict';

const crypto = require('crypto');

/*
 * A licence key, from the operating system's random source (Math.random's next
 * outputs can be worked out from earlier ones). Used by create-test-key.js.
 *
 * This file also held getExpiresAt and extendExpiresAt, copies of the webhook's
 * that nothing required: no yearly plan, and the "old expiry plus 7 or 30 days"
 * renewal that cut monthly subscribers short. They are gone so they cannot be
 * picked up again. A licence's expiry follows Stripe's period
 * (server/services/billing.js); routes/webhook.js mints the old checkout's keys.
 */
function generateLicenseKey() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const segment = () => Array.from({ length: 4 }, () => chars[crypto.randomInt(chars.length)]).join('');
  return `GC-${segment()}-${segment()}-${segment()}-${segment()}`;
}

module.exports = { generateLicenseKey };

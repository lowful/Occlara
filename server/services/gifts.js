'use strict';

/**
 * GIFTS (8.8): Pro or Max for someone else, sent as a link.
 *
 * A player buys a gift on the site (/buy?gift=pro_monthly and so on), a one
 * time Stripe payment made by the edge function create-gift-checkout, with the
 * metadata { kind: 'gift', offer, user_id, from_name } on the session and its
 * payment intent. The webhook (routes/webhook.js) holds the session to what it
 * charged and mints the gift here. The buyer sends
 * https://occlara.app/gift/<code>; the recipient signs in and redeems it once
 * (routes/gifts.js), and their account gets the plan for the time bought.
 *
 * THE CODE is 26 characters of Crockford's base32 (130 bits), made from the
 * checkout session id with GIFT_CODE_SECRET (an HMAC), so it is unguessable
 * without the secret, the same session always makes the same code (a
 * redelivered event mints nothing new), and the buyer can be shown their link
 * again in the app and on the site without the code being stored anywhere.
 * The database keeps only its SHA-256 (gifts.code_hash), so a copy of the
 * table redeems nothing. Changing the secret makes the links of gifts already
 * bought impossible to show again (they still redeem: their hashes are kept),
 * so set it once and never move it.
 *
 * WHAT A GIFT DOES, AND THE STACKING RULE, are the SQL's (gifts.sql in the
 * site's migrations): a free account becomes Pro or Max at once for the time
 * bought and goes back to what it had after, its free games kept; an account
 * on any paid plan keeps it and the gift starts when that plan ends; gifts run
 * back to back; a refund or a dispute of a gift voids it, taking away what is
 * left of its time. docs/claude/accounts.md, "Gifts".
 */

const crypto = require('crypto');
const { TIER_CAP, accountsMissing } = require('./billing');

/** What each gift is: the plan, its months, and the price, the same as the plan's own (the site's OFFERS). */
const GIFT_OFFERS = Object.freeze({
  pro_monthly: Object.freeze({ tier: 'pro', months: 1, cents: 2499 }),
  pro_yearly: Object.freeze({ tier: 'pro', months: 12, cents: 24999 }),
  max_monthly: Object.freeze({ tier: 'max', months: 1, cents: 6999 }),
  max_yearly: Object.freeze({ tier: 'max', months: 12, cents: 69999 }),
});

// Crockford's base32, lower case: no i, l, o or u, so a code read aloud or
// typed by hand cannot be mistaken.
const ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz';
const CODE_LENGTH = 26;               // 26 x 5 = 130 bits
const CODE_BITS = CODE_LENGTH * 5;
const CODE = /^[0-9a-hjkmnp-tv-z]{26}$/;
const GIFT_BASE = 'https://occlara.app/gift/';
const MIN_SECRET = 32;
// A first name the buyer may sign the gift with: letters, and a space, an
// apostrophe, a dot or a hyphen between them, at most 20 characters.
const FROM_NAME = /^\p{L}[\p{L}' .-]{0,19}$/u;

function isOffer(id) {
  return typeof id === 'string' && Object.prototype.hasOwnProperty.call(GIFT_OFFERS, id);
}

/** The secret codes are made with, or null when it is not set or too short to trust. */
function secretOf(env = process.env) {
  const s = String((env && env.GIFT_CODE_SECRET) || '').trim();
  return s.length >= MIN_SECRET ? s : null;
}

/** 130 bits of `bytes` in base32. */
function base32(bytes) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5 && out.length < CODE_LENGTH) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
    value &= (1 << bits) - 1;
    if (out.length >= CODE_LENGTH) break;
  }
  return out;
}

/** The gift code a checkout session makes, with the secret. Throws without one. */
function codeFor(ref, secret) {
  if (!secret) throw new Error('GIFT_CODE_SECRET is not set, so no gift code can be made');
  if (typeof ref !== 'string' || !ref) throw new Error('a gift code needs its checkout session id');
  const mac = crypto.createHmac('sha256', secret).update(`occlara-gift|${ref}`).digest();
  return base32(mac);
}

/** What the database keeps of a code. */
function hashCode(code) {
  return crypto.createHash('sha256').update(`occlara-gift:${code}`).digest('hex');
}

/**
 * A code as typed or pasted, made exact: a whole link (occlara.app/gift/<code>,
 * with or without https and a trailing slash), spaces and dashes dropped, upper
 * case lowered, and the letters Crockford reads as digits (I and L as 1, O as
 * 0). Null for anything that is then not a code.
 */
function normalizeCode(input) {
  if (typeof input !== 'string') return null;
  let s = input.trim();
  if (s.length > 200) return null;
  const link = /^(?:https?:\/\/)?(?:www\.)?occlara\.app\/gift\/([^/?#\s]+)\/?(?:[?#].*)?$/i.exec(s);
  if (link) s = link[1];
  s = s.replace(/[\s-]/g, '').toLowerCase().replace(/[il]/g, '1').replace(/o/g, '0');
  return CODE.test(s) ? s : null;
}

/** The link for a code. */
function linkOf(code) {
  return CODE.test(String(code || '')) ? `${GIFT_BASE}${code}` : null;
}

/** The buyer's first name for the card, or null: anything else is dropped, never refused. */
function cleanFromName(v) {
  if (typeof v !== 'string') return null;
  const s = v.trim().replace(/\s+/g, ' ');
  return FROM_NAME.test(s) ? s : null;
}

/**
 * Whether a paid gift checkout is what it says, held to what Stripe charged.
 * `lines` is the session's line items (listLineItems' data). Answers
 * { ok: true, offer, tier, months, cap, cents, buyer, fromName } or
 * { ok: false, why } for a session that can never be granted (logged for a
 * human), or { ok: false, unpaid: true } for one not paid yet.
 */
function checkoutGift(session, lines) {
  const s = session || {};
  const meta = s.metadata || {};
  if (s.payment_status !== 'paid') return { ok: false, unpaid: true };
  if (!isOffer(meta.offer)) return { ok: false, why: 'its metadata names no gift Occlara sells' };
  const offer = GIFT_OFFERS[meta.offer];
  const buyer = meta.user_id;
  if (!buyer || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(buyer))) {
    return { ok: false, why: 'its metadata names no buyer' };
  }
  if (s.mode && s.mode !== 'payment') return { ok: false, why: `it is a ${s.mode} checkout, not a one time payment` };
  // Adaptive pricing: what the checkout was priced at, in usd (as grantGames reads it).
  const conv = s.currency_conversion && typeof s.currency_conversion === 'object' ? s.currency_conversion : null;
  const charged = conv ? conv.amount_total : s.amount_total;
  const chargedIn = String((conv ? conv.source_currency : s.currency) || '').toLowerCase();
  if (charged !== offer.cents) return { ok: false, why: `it charged ${charged} for the ${meta.offer} gift, where ${offer.cents} was due` };
  if (chargedIn !== 'usd') return { ok: false, why: `it charged in ${chargedIn || 'no currency'}, not usd` };
  const list = Array.isArray(lines) ? lines : [];
  const line = list[0];
  const unit = line && line.price && line.price.unit_amount;
  if (list.length !== 1 || !line || line.quantity !== 1 || (unit != null && unit !== offer.cents)
    || (typeof line.amount_total === 'number' && String(line.currency || 'usd').toLowerCase() === 'usd' && line.amount_total !== offer.cents)) {
    return { ok: false, why: `its line items do not say one ${meta.offer} gift at ${offer.cents}` };
  }
  return {
    ok: true, offer: meta.offer, tier: offer.tier, months: offer.months, cap: TIER_CAP[offer.tier],
    cents: offer.cents, buyer, fromName: cleanFromName(meta.from_name),
  };
}

/** The gift an offer makes for a buyer, as checkoutGift answers it (no payment checked). */
function giftOfOffer(offerId, buyer, fromName) {
  if (!isOffer(offerId)) return null;
  const o = GIFT_OFFERS[offerId];
  return { ok: true, offer: offerId, tier: o.tier, months: o.months, cap: TIER_CAP[o.tier], cents: o.cents, buyer, fromName: cleanFromName(fromName) };
}

const one = (data) => (Array.isArray(data) ? data[0] || null : data || null);

/** An error the database gave, thrown so a caller cannot read it as done. */
function dbThrow(what, error) {
  const e = new Error(`${what}: ${error.code || ''} ${error.message || ''}`.trim());
  e.dbError = error;
  e.notLive = accountsMissing(error);
  return e;
}

/**
 * Mints a checked gift (checkoutGift's answer) for its session: { minted, reason, status }.
 * Throws on any database error, the functions not being there included: the
 * buyer paid, so Stripe retries until they are.
 */
async function mint(supabase, session, gift, secret) {
  const code = codeFor(session.id, secret);
  const pi = session.payment_intent && (typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent.id);
  const { data, error } = await supabase.rpc('gift_mint', {
    p_code_hash: hashCode(code), p_ref: session.id, p_buyer: gift.buyer, p_tier: gift.tier, p_months: gift.months,
    p_cap: gift.cap, p_amount_cents: gift.cents, p_from_name: gift.fromName, p_payment_intent: pi || null,
  });
  if (error) throw dbThrow(`mint the gift of checkout ${session.id}`, error);
  return one(data) || {};
}

/** Voids the gift of a checkout session: { voided, reason, was, running, user }. Throws on a database error. */
async function voidRef(supabase, ref, reason) {
  const { data, error } = await supabase.rpc('void_gift', { p_ref: ref, p_reason: reason });
  if (error) throw dbThrow(`void the gift of checkout ${ref}`, error);
  return one(data) || {};
}

/** Whether a checkout session bought a gift: { found, buyer_id, tier, months, status }, or null when gifts are not live. */
async function ofRef(supabase, ref) {
  const { data, error } = await supabase.rpc('gift_of_ref', { p_ref: ref });
  if (error && accountsMissing(error)) return null;
  if (error) throw dbThrow(`read the gift of checkout ${ref}`, error);
  return one(data) || null;
}

/** What a code gives: { found, status, tier, months, from_name, buyer_id, redeemed_by }. */
async function peek(supabase, code) {
  const { data, error } = await supabase.rpc('gift_peek', { p_code_hash: hashCode(code) });
  if (error) throw dbThrow('look up a gift', error);
  return one(data) || { found: false };
}

/** Redeems a code for a user: redeem_gift's answer. */
async function redeem(supabase, code, userId) {
  const { data, error } = await supabase.rpc('redeem_gift', { p_code_hash: hashCode(code), p_user: userId });
  if (error) throw dbThrow('redeem a gift', error);
  return one(data) || {};
}

/**
 * The gifts a user bought (each with its link again, when the secret makes the
 * code whose hash was kept) and the ones they redeemed.
 */
async function list(supabase, userId, secret) {
  const { data, error } = await supabase.rpc('gift_list', { p_user: userId });
  if (error) throw dbThrow('list the gifts of an account', error);
  const r = one(data) || {};
  const bought = (Array.isArray(r.bought) ? r.bought : []).map((g) => {
    let link = null;
    if (secret && g.ref) {
      try {
        const code = codeFor(g.ref, secret);
        if (hashCode(code) === g.code_hash) link = linkOf(code);
      } catch { link = null; }
    }
    return {
      id: g.id, checkout: g.ref || null, tier: g.tier, months: g.months, from_name: g.from_name || null,
      created_at: g.created_at || null, redeemed_at: g.redeemed_at || null, state: g.state, link,
    };
  });
  const received = (Array.isArray(r.received) ? r.received : []).map((g) => ({
    id: g.id, tier: g.tier, months: g.months, from_name: g.from_name || null, redeemed_at: g.redeemed_at || null,
    starts_at: g.starts_at || null, ends_at: g.ends_at || null, state: g.state,
  }));
  return { bought, received };
}

module.exports = {
  GIFT_OFFERS, ALPHABET, CODE_LENGTH, CODE_BITS, CODE, GIFT_BASE, MIN_SECRET,
  isOffer, secretOf, codeFor, hashCode, normalizeCode, linkOf, cleanFromName, checkoutGift, giftOfOffer,
  mint, voidRef, ofRef, peek, redeem, list,
};

'use strict';

/**
 * GIFTS, AS THE APP SEES THEM (8.8). Pure, no Electron: main and the tests
 * require it, the Profile page gets only the finished strings profile.js makes
 * from it.
 *
 * A gift is Pro or Max for someone else, one month or one year, bought on the
 * site (the app opens occlara.app/buy?gift=<offer> in the browser, never a
 * payment in the app) and sent as a link, occlara.app/gift/<code>. The code
 * is 26 characters of Crockford's base32 (the server's services/gifts.js
 * makes it; src never requires server, so the shape is written here again).
 * Redeeming one is a call to the server (POST /api/gifts/redeem) from main,
 * with the account's own session. What a gift does and the stacking rule:
 * docs/claude/accounts.md, "Gifts".
 */

const SITE = 'https://occlara.app';
const BUY_PATH = '/buy';
const GIFT_PATH = '/gift/';
const OFFER_IDS = Object.freeze(['pro_monthly', 'pro_yearly', 'max_monthly', 'max_yearly']);
const CODE = /^[0-9a-hjkmnp-tv-z]{26}$/;
const LINK = /^https:\/\/occlara\.app\/gift\/[0-9a-hjkmnp-tv-z]{26}$/;

function isGiftOffer(id) {
  return typeof id === 'string' && OFFER_IDS.includes(id);
}

/** The site's gift checkout for an offer, or null for anything else. */
function giftBuyUrl(offer) {
  return isGiftOffer(offer) ? `${SITE}${BUY_PATH}?gift=${offer}` : null;
}

/** Whether `url` is exactly a gift checkout giftBuyUrl makes. Main opens nothing that fails it. */
function isGiftBuyUrl(url) {
  if (typeof url !== 'string') return false;
  let u;
  try { u = new URL(url); } catch { return false; }
  if (u.origin !== SITE || u.pathname !== BUY_PATH || u.hash || u.username || u.password) return false;
  const keys = [...u.searchParams.keys()];
  if (keys.length !== 1 || keys[0] !== 'gift') return false;
  return giftBuyUrl(u.searchParams.get('gift')) === url;
}

/** A gift link, exactly occlara.app/gift/<code>. */
function isGiftLink(url) {
  return typeof url === 'string' && LINK.test(url);
}

/**
 * A code as pasted: a whole link, spaces and dashes, upper case, and the
 * letters Crockford reads as digits (I and L as 1, O as 0), made exact, as the
 * server reads it. Null for anything that is then not a code.
 */
function normalizeCode(input) {
  if (typeof input !== 'string') return null;
  let s = input.trim();
  if (!s || s.length > 200) return null;
  const link = /^(?:https?:\/\/)?(?:www\.)?occlara\.app\/gift\/([^/?#\s]+)\/?(?:[?#].*)?$/i.exec(s);
  if (link) s = link[1];
  s = s.replace(/[\s-]/g, '').toLowerCase().replace(/[il]/g, '1').replace(/o/g, '0');
  return CODE.test(s) ? s : null;
}

const TIER_LABEL = { pro: 'Pro', max: 'Max' };
const tierLabel = (t) => TIER_LABEL[t] || 'a plan';
/** "Pro for a month", "Max for a year". */
function giftName(tier, months) {
  return `${tierLabel(tier)} for ${months === 12 ? 'a year' : 'a month'}`;
}

const dayOf = (at, opts) => require('./usage').dayOf(at, opts);

/**
 * One sentence for what the server said to a redemption.
 * @param r  { ok: true, tier, months, started, ends_at, waits_for, again }
 *           or { ok: false, reason } (reason: the server's, or 'code' for a
 *           text that is no code, 'signin', 'network', 'match')
 */
function redeemSentence(r, opts) {
  if (r && r.ok) {
    const what = giftName(r.tier, r.months);
    if (r.started) {
      const day = dayOf(r.ends_at, opts);
      return `${r.again ? 'This gift is already on your account' : `Done. ${what} is on your account`}${day ? `, until ${day}` : ''}.`;
    }
    if (r.waits_for === 'gift') return `Done. ${what} starts when the gift you have now ends.`;
    if (r.waits_for === 'plan') return `Done. ${what} starts when your current plan ends, so none of it is lost.`;
    // A retry ('existing') carries no waits_for: the server does not say what
    // the gift waits for, so the sentence names neither a plan nor a gift.
    return `This gift is already on your account. It starts when what you have now ends, so none of it is lost.`;
  }
  switch (r && r.reason) {
    case 'code':
    case 'unknown':
      return 'That is not a gift link Occlara knows. Check you copied the whole link.';
    case 'already-redeemed':
      return 'This gift has already been redeemed by another account.';
    case 'void':
      return 'This gift was refunded, so it can no longer be redeemed.';
    case 'self':
      return 'This is a gift you bought. Send the link to a friend so they can redeem it.';
    case 'account-ended':
      return 'This account cannot take a gift. Email support@occlara.app and we will sort it out.';
    case 'lifetime':
      // The server answers 'lifetime' for a Max for life account and for one
      // given by hand (comp), so the sentence claims no "for life".
      return 'Your account has a plan a gift cannot follow, so this gift would never start. Pass the link to a friend.';
    case 'signin':
      return 'Sign in first, so the gift goes to your Occlara account.';
    case 'rate-limited':
      return 'Too many tries from this network. Wait a while and try again.';
    case 'match':
      return 'Gifts wait until your match is over.';
    case 'not-live':
      return 'Gifts are not open yet. Keep the link and try again soon.';
    default:
      return 'The gift could not be redeemed just now. Check your connection and try again.';
  }
}

/** How a gift the player bought stands, in words. */
function boughtState(state) {
  switch (state) {
    case 'unredeemed': return 'Not redeemed yet';
    case 'running': return 'Redeemed, in use';
    case 'waiting': return 'Redeemed, starts after their plan';
    case 'used': return 'Redeemed';
    case 'void': return 'Refunded';
    default: return '';
  }
}

module.exports = {
  SITE, BUY_PATH, GIFT_PATH, OFFER_IDS, CODE, LINK,
  isGiftOffer, giftBuyUrl, isGiftBuyUrl, isGiftLink, normalizeCode, giftName, redeemSentence, boughtState,
};

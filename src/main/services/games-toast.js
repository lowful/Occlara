'use strict';

/*
 * GAMES RECEIVED (8.9.1, docs/claude/ui.md "The games toast"). When the
 * account's games go up for a reason the player did not just spend or reset,
 * a toast says so, the way Discord says a friend sent you something: a gift,
 * an invite that paid off, games bought, a plan starting, the free allowance
 * raised.
 *
 * Detection only, here and pure: no window, no network, the store and the
 * clock handed in. index.js feeds it every fresh account state (account
 * service onChange), keeps what it raises while a match is on (flushToasts,
 * the seal's waits) and hands it to the main window's toast view.
 *
 * What it compares is the allowance's PARTS, never `left`: tier, source,
 * cap_monthly, free_total, bonus_pool, bonus_earned. `left` moves with every
 * game played and every new month, so it is never a reason: a monthly reset
 * (left back to the cap, period_end a month on) raises nothing by
 * construction.
 *
 * Kept in the store so it survives a restart:
 *   gamesSeen         { who, tier, source, cap_monthly, free_total, bonus_pool, bonus_earned }
 *                     who is a short hash of the account's key or email, never
 *                     the key or the email itself
 *   gamesToastPending the events raised and not yet shown (a match was on)
 *   gamesRaiseChecked the one time 8.9.0 upgrade rule has been decided
 *
 * Never raised: on the first state ever seen (nothing to compare), on a state
 * of a different account than the last one (a sign out and in as someone
 * else), on anything going down (a refund, a gift ending, a plan ending).
 *
 * THE 8.9.0 UPGRADE, ONCE. Free went from 2 to 4 games on 2026-11-09 by a
 * server migration (accounts.md), and a player updating from 8.9.0 has no
 * gamesSeen to compare with. For them alone, on the first state ever seen, a
 * free account whose free_total is exactly 4 or 6 (the raised 2 or invited 4)
 * and whose stored app version is below 8.9.1, signed in or holding a key
 * before this launch (an account made today never had 2), is told "Free is now N games",
 * against the old constant: 2 games. Decided once (gamesRaiseChecked) whatever
 * the answer, so it can never be said twice.
 */

const crypto = require('crypto');

const OLD_FREE = 2;                 // usage.js FREE_GAMES before 2026-11-09
const RAISED = [4, 6];              // what the raise left: 2 to 4, invited 4 to 6
const RAISE_FROM = '8.9.1';         // the first version that knows it
const TIER_LABEL = { free: 'Free', pro: 'Pro', max: 'Max' };
const PAID = new Set(['pro', 'max']);
const MAX_PENDING = 12;
const KEYS = { seen: 'gamesSeen', pending: 'gamesToastPending', raise: 'gamesRaiseChecked' };

const num = (v) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : null);
const whole = (v) => { const n = num(v); return n === null ? 0 : Math.max(0, Math.round(n)); };

/** x.y.z compared: negative a < b, 0 equal, positive a > b, null when either is not one. */
function cmpVersion(a, b) {
  const re = /^(\d+)\.(\d+)\.(\d+)/;
  const x = re.exec(String(a || ''));
  const y = re.exec(String(b || ''));
  if (!x || !y) return null;
  for (let i = 1; i <= 3; i++) {
    const d = Number(x[i]) - Number(y[i]);
    if (d) return d;
  }
  return 0;
}

/** Who the state is, as a short hash: the account's key, else its email. null when neither. */
function whoOf(st) {
  if (!st || typeof st !== 'object') return null;
  const id = (typeof st.account_key === 'string' && st.account_key.trim())
    || (typeof st.email === 'string' && st.email.trim().toLowerCase()) || '';
  if (!id) return null;
  return crypto.createHash('sha256').update(`occlara-games:${id}`).digest('hex').slice(0, 16);
}

/** The parts of the allowance this compares, from an account state. null when it is not one. */
function partsOf(st) {
  if (!st || typeof st !== 'object' || typeof st.tier !== 'string') return null;
  const who = whoOf(st);
  if (!who) return null;
  return {
    who,
    tier: st.tier.toLowerCase(),
    source: typeof st.source === 'string' ? st.source.toLowerCase() : null,
    cap_monthly: num(st.cap_monthly),
    free_total: num(st.free_total),
    bonus_pool: whole(st.bonus_pool),
    bonus_earned: whole(st.bonus_earned),
  };
}

/** A plan's monthly games: the state's cap, else the tier's own. */
function capOf(p) {
  if (p.cap_monthly !== null && p.cap_monthly > 0) return p.cap_monthly;
  return p.tier === 'max' ? 70 : p.tier === 'pro' ? 25 : 0;
}

/**
 * The events between two parts of ONE account, oldest reason first. Each is
 * { kind, n, tier? }: kind 'gift' | 'plan' | 'invite' | 'bought' | 'raise'.
 */
function diff(prev, cur) {
  const out = [];
  // A plan starting or moving up: a gift when the server marks it so.
  const wasPaid = PAID.has(prev.tier);
  const isPaid = PAID.has(cur.tier);
  if (isPaid && (!wasPaid || (prev.tier === 'pro' && cur.tier === 'max'))) {
    const gained = capOf(cur) - (wasPaid ? capOf(prev) : 0);
    if (gained > 0) out.push({ kind: cur.source === 'gift' ? 'gift' : 'plan', n: capOf(cur), tier: cur.tier });
  } else if (isPaid && wasPaid && prev.tier === cur.tier && cur.source === 'gift' && prev.source !== 'gift') {
    // A paid plan ended and a gift that waited for it took over: the same
    // tier, now the friend's.
    out.push({ kind: 'gift', n: capOf(cur), tier: cur.tier });
  }
  // Referral games: bonus_earned is the referral's alone.
  const earned = cur.bonus_earned - prev.bonus_earned;
  if (earned > 0) out.push({ kind: 'invite', n: earned });
  // bonus_pool holds referral games AND games bought: what rose beyond the
  // referral's share was bought.
  const bought = (cur.bonus_pool - prev.bonus_pool) - Math.max(0, earned);
  if (bought > 0) out.push({ kind: 'bought', n: bought });
  // The free allowance raised (2 to 4 on 2026-11-09), or an invite redeemed
  // as the friend: either way free_total went up.
  if (prev.free_total !== null && cur.free_total !== null && cur.free_total > prev.free_total) {
    out.push({ kind: 'raise', n: cur.free_total - prev.free_total, total: cur.free_total });
  }
  return out;
}

/** A gift giver's own chosen name, made safe to show, or ''. Never a Riot ID (a name#tag). */
function cleanFrom(v) {
  if (typeof v !== 'string') return '';
  const s = v.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  if (!s || s.length > 32 || s.includes('#') || /@|https?:|www\./i.test(s)) return '';
  return s;
}

/**
 * The finished words of one event, the toast's own: the title in three parts
 * so the view can count the number up, and one line with the reason.
 * { pre, n, post, line } with n null when the title has no number.
 */
function words(ev) {
  const e = ev || {};
  const n = whole(e.n);
  const games = (k) => (k === 1 ? 'game' : 'games');
  const tier = TIER_LABEL[e.tier] || 'a plan';
  switch (e.kind) {
    case 'gift': {
      const from = cleanFrom(e.from);
      return { pre: `You got ${tier}`, n: null, post: '',
        line: `${from || 'Someone'} sent you a gift, ${n} ${games(n)} a month.` };
    }
    case 'plan':
      return { pre: `You got ${tier}`, n: null, post: '', line: `Thanks for your purchase, ${n} ${games(n)} a month.` };
    case 'invite':
      return { pre: 'You got ', n, post: ` ${games(n)}`, line: 'Your invite paid off.' };
    case 'bought':
      return { pre: 'You got ', n, post: ` ${games(n)}`, line: 'Thanks for your purchase.' };
    case 'raise': {
      const total = whole(e.total);
      return { pre: 'You got ', n, post: ` ${games(n)}`, line: total ? `Free is now ${total} games.` : 'Your free games went up.' };
    }
    default:
      return { pre: 'You got ', n, post: ` ${games(n)}`, line: 'Your games went up.' };
  }
}

/**
 * @param deps.store         get(key) and set(key, value), the app's store
 * @param deps.priorVersion  the app version this PC ran before this launch
 *                           ('' on a fresh install), read before anything
 *                           at launch writes the current one
 * @param deps.hadAccount    signed in, or holding a key, before this launch:
 *                           the upgrade rule is for an account that existed
 * @param deps.now           the clock
 */
function createGamesWatch(deps) {
  const d = { now: () => Date.now(), priorVersion: '', ...deps };
  const store = d.store;
  let seq = 0;

  // The waiting list, read from the store once and mirrored here: syncSeal
  // asks for its length every second, and the store reads its file on a get.
  let pend = null;
  const pendingList = () => {
    if (pend === null) {
      const p = store.get(KEYS.pending);
      pend = Array.isArray(p) ? p.filter((e) => e && typeof e.kind === 'string') : [];
    }
    return pend.slice();
  };
  const setPending = (list) => { pend = list.slice(); store.set(KEYS.pending, pend); };

  function remember(parts) {
    store.set(KEYS.seen, parts);
  }

  /** The 8.9.0 upgrade rule (above), on the first state ever seen. */
  function upgradeRaise(cur) {
    if (store.get(KEYS.raise)) return null;
    store.set(KEYS.raise, true);
    if (!d.hadAccount) return null;
    if (cur.tier !== 'free' || !RAISED.includes(cur.free_total)) return null;
    const prior = String(d.priorVersion || '');
    const c = cmpVersion(prior, RAISE_FROM);
    if (c === null || c >= 0) return null;
    // 2 to 4, or invited 4 to 6: two games either way, against the old constant.
    return { kind: 'raise', n: RAISED[0] - OLD_FREE, total: cur.free_total };
  }

  /**
   * A fresh account state: what it raised, if anything, already kept as
   * pending. null or a state of no account changes nothing.
   */
  function observe(st) {
    const cur = partsOf(st);
    if (!cur) return [];
    const prev = store.get(KEYS.seen);
    let raised = [];
    if (!prev || typeof prev !== 'object' || !prev.who) {
      const up = upgradeRaise(cur);
      if (up) raised = [up];
    } else if (prev.who === cur.who) {
      raised = diff(prev, cur);
    }
    // Any other account: remembered, nothing said. The upgrade rule is for
    // the first state ever seen, so once anything is remembered it is decided.
    remember(cur);
    if (!store.get(KEYS.raise)) store.set(KEYS.raise, true);
    if (!raised.length) return [];
    const at = d.now();
    const made = raised.map((e) => ({ ...e, id: `${at.toString(36)}-${(seq++).toString(36)}`, at }));
    setPending([...pendingList(), ...made].slice(-MAX_PENDING));
    return made;
  }

  /** A gift's giver, once known (GET /api/gifts, its running gift's from_name). */
  function nameGift(name) {
    const from = cleanFrom(name);
    if (!from) return false;
    let changed = false;
    const list = pendingList().map((e) => {
      if (e.kind !== 'gift' || e.from) return e;
      changed = true;
      return { ...e, from };
    });
    if (changed) setPending(list);
    return changed;
  }

  /**
   * The events waiting, each with its words, taken off the list. While
   * `busy` (a match on, the window sealed) nothing is taken.
   */
  function take(busy) {
    if (busy) return [];
    const list = pendingList();
    if (!list.length) return [];
    setPending([]);
    return list.map((e) => ({ id: e.id, kind: e.kind, ...words(e) }));
  }

  return { observe, take, nameGift, pending: pendingList };
}

module.exports = { createGamesWatch, words, diff, partsOf, whoOf, cleanFrom, cmpVersion, KEYS, OLD_FREE, RAISED, RAISE_FROM };

'use strict';

/**
 * GAMES LEFT, THE CAP AND THE INVITE, AS FINISHED STRINGS (8.7).
 *
 * The account's state comes from the server's account_state (GET
 * /api/account/me, normalized by account-service.js): { tier, used, left,
 * period_end, free_total, bonus_pool, bonus_earned, invites, capped }. Every
 * line a page shows about it is written here, so no renderer does arithmetic
 * on games or dates, and test-usage-strings.js holds every tier and edge.
 *
 * `left` is everything the account can still record: the tier's own
 * allowance and the earned games (bonus_pool) after it. The line names the
 * allowance against its total and the earned games beside it, so "2 of 3"
 * never reads as "6 of 3" once a friend has joined.
 *
 * Pure: no Electron, no clock but the one handed in.
 */

const TIERS = {
  free: { label: 'Free', monthly: false },
  pro:  { label: 'Pro',  monthly: true, cap: 25 },
  max:  { label: 'Max',  monthly: true, cap: 70 },
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const MAX_FRIENDS = 5;
const MAX_EARNED = 20;
const GAMES_PER_FRIEND = 4;
const FRIEND_GIFT = 2;

const UPGRADE_URL = 'https://occlara.app/pricing';
const ACCOUNT_URL = 'https://occlara.app/account';
const SIGNUP_URL = 'https://occlara.app/signup';

/** The Invite page's two lines on how it works. */
const INVITE_HOW = [
  `Each friend who signs up with your link gets ${FRIEND_GIFT} extra free games.`,
  `You get ${GAMES_PER_FRIEND} games for each friend who records their first match, up to ${MAX_EARNED}.`,
];

function int(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : null;
}

function plural(n, one, many) {
  return `${n} ${n === 1 ? one : (many || `${one}s`)}`;
}

function tierOf(state) {
  const t = state && typeof state.tier === 'string' ? state.tier.toLowerCase() : '';
  return TIERS[t] ? t : null;
}

/** 'Free', 'Pro' or 'Max', or '' for a state that names none. */
function tierLabel(state) {
  const t = tierOf(state);
  return t ? TIERS[t].label : '';
}

/**
 * "Nov 30" for a period end, or '' for none. Local time unless `opts.utc`,
 * which the tests use so the day never moves with the machine's zone.
 */
function dayOf(at, opts) {
  if (at === null || at === undefined || at === '') return '';
  const d = new Date(at);
  if (!Number.isFinite(d.getTime())) return '';
  const utc = !!(opts && opts.utc);
  const m = utc ? d.getUTCMonth() : d.getMonth();
  const day = utc ? d.getUTCDate() : d.getDate();
  return `${MONTHS[m]} ${day}`;
}

/**
 * The numbers the lines are written from, or null when the state cannot say
 * (no account, accounts not live on the server, a field missing).
 *   total     the tier's own games: free_total, or the month's cap
 *   own       of those, still left
 *   earned    earned games still to spend (bonus_pool)
 */
function figures(state) {
  const tier = tierOf(state);
  if (!tier) return null;
  const left = int(state.left);
  if (left === null) return null;
  const earned = Math.min(int(state.bonus_pool) || 0, left);
  let total;
  if (tier === 'free') total = int(state.free_total);
  else total = int(state.cap_monthly) || TIERS[tier].cap;
  if (total === null) total = tier === 'free' ? 3 : TIERS[tier].cap;
  const own = Math.min(total, Math.max(0, left - earned));
  return { tier, total, own, earned, left };
}

/**
 * The one quiet line for Home and Settings, e.g. "2 of 3 free games left",
 * "18 of 25 games left this month, renews Nov 30", or "You have used your
 * 3 free games". '' when the state cannot say.
 */
function gamesLeft(state, opts) {
  const f = figures(state);
  if (!f) return '';
  const extra = f.earned ? `, plus ${plural(f.earned, 'earned game')}` : '';
  if (f.tier === 'free') {
    if (!f.left) return f.total ? `You have used your ${plural(f.total, 'free game')}` : 'You have no free games left';
    if (!f.own) return `${plural(f.earned, 'earned game')} left`;
    return `${f.own} of ${plural(f.total, 'free game')} left${extra}`;
  }
  const day = dayOf(state.period_end, opts);
  const renews = day ? `, renews ${day}` : '';
  if (!f.left) return `You have used this month's ${plural(f.total, 'game')}${renews}`;
  if (!f.own) return `${plural(f.earned, 'earned game')} left${renews}`;
  return `${f.own} of ${plural(f.total, 'game')} left this month${extra}${renews}`;
}

/**
 * The upgrade card a locked review and a refused Start show, or null while
 * games are left. { capped, title, body, upgrade }: `upgrade` is the tier the
 * button offers ('pro' from Free, 'max' from Pro, null from Max).
 */
function capState(state, opts) {
  const f = figures(state);
  if (!f) return null;
  const capped = state.capped === true || f.left === 0;
  if (!capped) return null;
  const day = dayOf(state.period_end, opts);
  if (f.tier === 'free') {
    return {
      capped: true,
      title: f.total ? `You have used your ${plural(f.total, 'free game')}` : 'You have no free games left',
      body: `Upgrade to Pro for ${TIERS.pro.cap} games a month, or invite friends for more free games.`,
      upgrade: 'pro',
    };
  }
  const when = day ? `They renew ${day}.` : 'They renew with your plan.';
  if (f.tier === 'pro') {
    return {
      capped: true,
      title: `You have used this month's ${plural(f.total, 'game')}`,
      body: `${when} Max gives you ${TIERS.max.cap} games a month, or invite friends for more.`,
      upgrade: 'max',
    };
  }
  return {
    capped: true,
    title: `You have used this month's ${plural(f.total, 'game')}`,
    body: `${when} Invite friends for more games meanwhile.`,
    upgrade: null,
  };
}

/** The notice line's sentence for a cap, from capState. '' while games are left. */
function capNotice(state, opts) {
  const c = capState(state, opts);
  if (!c) return '';
  return `${c.title}. Upgrade at occlara.app/pricing or invite friends for more.`;
}

/**
 * The Invite page's progress line, e.g. "1 of 5 friends joined, 4 games
 * earned". `ref` is GET /api/referral's answer. '' for none.
 */
function inviteProgress(ref) {
  if (!ref || typeof ref !== 'object') return '';
  const max = int(ref.max_friends) || MAX_FRIENDS;
  const joined = Math.min(max, int(ref.qualified) || 0);
  const maxGames = int(ref.max_games) || MAX_EARNED;
  const earned = Math.min(maxGames, int(ref.earned) || 0);
  const line = `${joined} of ${plural(max, 'friend')} joined, ${plural(earned, 'game')} earned`;
  const waiting = Math.max(0, (int(ref.invited) || 0) - joined);
  if (joined >= max) return `${line}, the most there is`;
  if (waiting) return `${line}, ${waiting} still to record a match`;
  return line;
}

module.exports = {
  TIERS, MAX_FRIENDS, MAX_EARNED, GAMES_PER_FRIEND, FRIEND_GIFT, INVITE_HOW,
  UPGRADE_URL, ACCOUNT_URL, SIGNUP_URL,
  tierLabel, dayOf, figures, gamesLeft, capState, capNotice, inviteProgress,
};

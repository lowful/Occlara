'use strict';

/**
 * THE PROFILE PAGE, AS FINISHED STRINGS (8.8).
 *
 * The page between Invite and Settings: the games left now (the hero), buying
 * more games, three figures of the player's own Valorant play, and the plans.
 * Every number and sentence the page shows is written here, so the renderer
 * counts nothing (test-profile.js holds every case).
 *
 * BUYING GAMES. A game is $2.00, any whole number from 1 to 500 in one
 * checkout. The app never takes a payment: it opens the site's /buy page in
 * the browser with the number, the site re-validates it, signs the player in
 * and makes the Stripe checkout, and the server's webhook adds the games to
 * the account's bonus_pool, where they never expire and are used after the
 * plan's own games (docs/claude/accounts.md, "Buying games"). The URL is made
 * and checked here alone (buyUrl, isBuyUrl), and main opens it only after
 * isBuyUrl passes.
 *
 * THE FIGURES ARE THE RECORD'S, NEVER A GUESS. Most used weapon is counted
 * from Riot's kill feed kept on each linked review (rounds[].riot.feed, the
 * entries the player made, by === 'me', with the gun the server named), most
 * played agent from the matches whose agent is Riot's or one the engine
 * confirmed, and the peak rank from Riot's highest rank on the account (the
 * tracker profile main keeps) or, without it, the best rated game in the rank
 * history main keeps. A figure with no source says so, never fills in.
 *
 * Pure: no Electron, no clock but the one handed in. The preload requires it
 * too, for the price as the number changes (quote, step).
 */

const usage = require('./usage');

const GAME_PRICE_CENTS = 200;
const MAX_GAMES_PER_PURCHASE = 500;
const QUICK_PICKS = [1, 5, 10, 25];

const SITE = 'https://occlara.app';
const BUY_PATH = '/buy';
const PRICING_URL = `${SITE}/#pricing`;

/**
 * The three plans, the one source for their prices here (the site says the
 * same on /pricing). Games come from usage.js, the numbers the server caps by.
 */
const PLANS = [
  { id: 'free', label: usage.TIERS.free.label, monthlyCents: 0, yearlyCents: 0, games: usage.FREE_GAMES, monthly: false },
  { id: 'pro', label: usage.TIERS.pro.label, monthlyCents: 2499, yearlyCents: 24999, games: usage.TIERS.pro.cap, monthly: true },
  { id: 'max', label: usage.TIERS.max.label, monthlyCents: 6999, yearlyCents: 69999, games: usage.TIERS.max.cap, monthly: true },
];

// The rank ladder, lowest first, as weekly-report.js keeps it.
const RANK_LADDER = ['iron', 'bronze', 'silver', 'gold', 'platinum', 'diamond', 'ascendant', 'immortal', 'radiant'];
const UNRATED = /unrated|unranked/i;

function plural(n, one, many) {
  return `${n} ${n === 1 ? one : (many || `${one}s`)}`;
}

function int(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : null;
}

/** "$2", "$10", "$1,000", "$24.99": whole dollars without cents. */
function money(cents) {
  const c = Math.max(0, Math.round(Number(cents) || 0));
  const dollars = Math.floor(c / 100);
  const rest = c % 100;
  const whole = String(dollars).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return rest ? `$${whole}.${String(rest).padStart(2, '0')}` : `$${whole}`;
}

/** A whole number as typed or handed, or null for anything else ("", "2.5", "abc", -1). */
function wholeOf(v) {
  if (typeof v === 'number') return Number.isInteger(v) && v >= 0 ? v : null;
  if (typeof v !== 'string') return null;
  const s = v.trim();
  return /^\d{1,6}$/.test(s) ? Number(s) : null;
}

/** Into 1 to 500. */
function clampGames(n) {
  return Math.min(MAX_GAMES_PER_PURCHASE, Math.max(1, Math.floor(n)));
}

/**
 * What the buy section says for a number as the player types it.
 * @returns {{ ok, n, total, label, note }}
 *   ok     a number the button can buy (n is it, clamped into 1 to 500)
 *   note   one line under the button: why the number moved, or '' for none
 */
function quote(v) {
  const typed = wholeOf(v);
  if (typed === null) {
    return { ok: false, n: null, total: '', label: 'Buy games', note: `Choose from 1 to ${MAX_GAMES_PER_PURCHASE} games.` };
  }
  const n = clampGames(typed);
  const total = money(n * GAME_PRICE_CENTS);
  let note = '';
  if (typed > MAX_GAMES_PER_PURCHASE) note = `${MAX_GAMES_PER_PURCHASE} games is the most in one checkout.`;
  else if (typed < 1) note = 'One game is the fewest you can buy.';
  return { ok: true, n, total, label: `Buy ${plural(n, 'game')} for ${total}`, note };
}

/** The number one step up or down from `v`, kept in 1 to 500. */
function step(v, by) {
  const typed = wholeOf(v);
  const from = typed === null ? 0 : Math.min(typed, MAX_GAMES_PER_PURCHASE);
  return clampGames(from + (by < 0 ? -1 : 1));
}

/** The quick picks as the segmented capsule labels them: "5 for $10". */
function picks() {
  return QUICK_PICKS.map((n) => ({ n, label: `${n} for ${money(n * GAME_PRICE_CENTS)}`, aria: `${plural(n, 'game')} for ${money(n * GAME_PRICE_CENTS)}` }));
}

/** The site's checkout for `n` games, or null for any n that is not a whole 1 to 500. */
function buyUrl(n) {
  if (!Number.isInteger(n) || n < 1 || n > MAX_GAMES_PER_PURCHASE) return null;
  return `${SITE}${BUY_PATH}?games=${n}`;
}

/**
 * Whether `url` is exactly a checkout buyUrl makes: the site's origin, /buy,
 * one games parameter, a whole number 1 to 500, and nothing else. Main opens
 * nothing that fails it.
 */
function isBuyUrl(url) {
  if (typeof url !== 'string') return false;
  let u;
  try { u = new URL(url); } catch { return false; }
  if (u.origin !== SITE || u.pathname !== BUY_PATH || u.hash || u.username || u.password) return false;
  const keys = [...u.searchParams.keys()];
  if (keys.length !== 1 || keys[0] !== 'games') return false;
  const raw = u.searchParams.get('games');
  if (!/^[1-9]\d{0,2}$/.test(raw)) return false;
  return buyUrl(Number(raw)) === url;
}

/**
 * The fields of account_state the page's games are worked from, picked by the
 * account service into its view (`games`), so no page is handed more.
 */
function gamesState(st) {
  if (!st || typeof st !== 'object') return null;
  return {
    tier: typeof st.tier === 'string' ? st.tier : null,
    left: st.left === undefined ? null : st.left,
    cap_monthly: st.cap_monthly === undefined ? null : st.cap_monthly,
    free_total: st.free_total === undefined ? null : st.free_total,
    bonus_pool: st.bonus_pool || 0,
    period_end: st.period_end || null,
    // Only when it is so: free games are one per player (8.8).
    ...(st.free_shared === true ? { free_shared: true } : {}),
  };
}

/**
 * THE HERO: the games left now, the plan, and when the month's games start
 * again, one finished line each.
 * @param view  the account's view (account-service.js), its `games` included
 * @returns {{ state: 'games' | 'out' | 'error', number, unit, plan, split, renew, tier }}
 */
function hero(view, opts) {
  const signedIn = !!(view && view.via === 'session');
  if (!signedIn) {
    return {
      state: 'out', number: '', unit: '', tier: null,
      plan: 'Sign in to see your games',
      split: 'Your games are kept on your Occlara account, so this PC needs to be signed in to it.',
      renew: '',
    };
  }
  const f = view.games ? usage.figures(view.games) : null;
  if (!f) {
    return { state: 'error', number: '', unit: '', tier: null, plan: 'Your games could not be fetched', split: 'Check your connection and try again.', renew: '' };
  }
  const label = usage.TIERS[f.tier].label;
  const plan = f.tier === 'free'
    ? `${label} plan, ${plural(f.total, 'game')} for life`
    : `${label} plan, ${plural(f.total, 'game')} a month`;
  // Where the number comes from, said only when bonus games (bought or from
  // invites) are in it: without them it would say the number twice.
  const bonus = `, plus ${plural(f.earned, 'bonus game')}`;
  let split = '';
  if (f.earned) {
    split = f.tier === 'free' ? `${f.own} of your ${plural(f.total, 'free game')}${bonus}` : `${f.own} of this month's ${f.total}${bonus}`;
  }
  let renew;
  // Free games are one per player (8.8): said calmly when another account of
  // this player used them, never more than that.
  if (f.tier === 'free' && view.games.free_shared === true && !f.own) renew = `${usage.ONE_PER_PLAYER} Upgrade for games every month.`;
  else if (f.tier === 'free') renew = 'Free games do not renew. Upgrade for games every month.';
  else {
    const day = usage.dayOf(view.games.period_end, opts);
    renew = day ? `Your month's games start again ${day}.` : 'Your month\'s games start again with your plan.';
  }
  return { state: 'games', number: String(f.left), unit: f.left === 1 ? 'game left' : 'games left', tier: f.tier, plan, split, renew };
}

// ── The player's own play, Valorant only ───────────────────────────────────

let gunNames = null;
/** The guns the game data knows, and the knife, by the name the feed keeps ("Vandal"). */
function guns() {
  if (gunNames) return gunNames;
  let keys = [];
  try { keys = Object.keys(require('./valorant-data.generated.json').weapons || {}); } catch { keys = []; }
  gunNames = new Set(keys.map((k) => k.toLowerCase()).concat(['melee']));
  return gunNames;
}

const reviewOf = (e) => (e && e.review && typeof e.review === 'object' ? e.review : e && typeof e === 'object' ? e : null);
const isValorant = (e, r) => (e && typeof e.game === 'string' ? e.game === 'valorant' : (r.kind || 'valorant') === 'valorant');
/** A review whose rounds carry Riot's record: linked, or graded from it alone. */
const onRiot = (r) => r.verified === true || r.source === 'riot';

/**
 * The agent a match counts under: Riot's (a linked review's agent is Riot's
 * own, valorant-review.js build) or one the engine confirmed off the player's
 * own HUD (the ledger an unlinked review keeps). Never a detection alone.
 */
function agentOf(r) {
  const a = r.game && typeof r.game.agent === 'string' ? r.game.agent.trim() : '';
  if (!a) return null;
  if (onRiot(r)) return a;
  const c = r.ledger && r.ledger.context;
  return c && c.agentConfirmed && c.agent === a ? a : null;
}

/** The most of `counts` (a Map), ties to the one seen first (the newest match). */
function top(counts) {
  let best = null;
  for (const [k, v] of counts) if (!best || v > best[1]) best = [k, v];
  return best;
}

function weaponFigure(entries, riotId) {
  const kills = new Map();
  let total = 0;
  let matches = 0;
  let linked = 0;
  for (const r of entries) {
    if (!onRiot(r)) continue;
    linked++;
    let mine = 0;
    for (const round of Array.isArray(r.rounds) ? r.rounds : []) {
      const feed = round && round.riot && Array.isArray(round.riot.feed) ? round.riot.feed : [];
      for (const k of feed) {
        if (!k || k.by !== 'me' || typeof k.w !== 'string' || !guns().has(k.w.toLowerCase())) continue;
        kills.set(k.w, (kills.get(k.w) || 0) + 1);
        total++;
        mine++;
      }
    }
    if (mine) matches++;
  }
  const best = top(kills);
  if (best) {
    return { label: 'Most used weapon', value: best[0], sample: `${best[1]} of your ${plural(total, 'kill')}, from ${plural(matches, 'match', 'matches')}`, empty: false };
  }
  if (!linked) return { label: 'Most used weapon', value: '', sample: riotId ? 'Play a match to see this' : 'Connect your Riot ID to see this', empty: true };
  return { label: 'Most used weapon', value: '', sample: 'Riot\'s record of your matches names no gun yet', empty: true };
}

function agentFigure(entries) {
  const played = new Map();
  let counted = 0;
  for (const r of entries) {
    const a = agentOf(r);
    if (!a) continue;
    played.set(a, (played.get(a) || 0) + 1);
    counted++;
  }
  const best = top(played);
  if (!best) return { label: 'Most played agent', value: '', sample: 'Play a match to see this', empty: true };
  return { label: 'Most played agent', value: best[0], sample: `${best[1]} of your ${plural(counted, 'match', 'matches')}`, empty: false };
}

/** "Gold 2" to a number to compare by, or null for a tier that is no rank. */
function rankIndex(tier) {
  const t = String(tier || '').trim().toLowerCase();
  if (!t || UNRATED.test(t)) return null;
  const i = RANK_LADDER.findIndex((n) => t.startsWith(n));
  if (i < 0) return null;
  const div = parseInt(t.replace(/[^\d]/g, ''), 10);
  return i * 3 + (Number.isFinite(div) ? Math.min(3, Math.max(1, div)) : 2);
}

function rankFigure(riotId, trackerPeak, history, opts) {
  const label = 'Peak rank';
  if (!riotId) return { label, value: '', sample: 'Connect your Riot ID to see this', empty: true };
  const points = history && !history.error && Array.isArray(history.points) ? history.points.filter((p) => p && rankIndex(p.tier) !== null) : [];
  let best = null;
  for (const p of points) if (!best || rankIndex(p.tier) >= rankIndex(best.tier)) best = p;
  const peak = typeof trackerPeak === 'string' && rankIndex(trackerPeak) !== null ? trackerPeak.trim() : null;
  if (peak && (!best || rankIndex(peak) >= rankIndex(best.tier))) {
    return { label, value: peak, sample: 'Riot\'s highest rank on your account', empty: false };
  }
  if (best) {
    const day = usage.dayOf(best.date, opts);
    return { label, value: best.tier.trim(), sample: `Your best of ${plural(points.length, 'rated game')}${day ? `, on ${day}` : ''}`, empty: false };
  }
  // Any error is a history not read: main's own 'unavailable', and the
  // server's sentences ('Could not load rank history.', 'Account not found.',
  // 'No stats provider configured.'), none of which says there is no rated game.
  if (history && history.error) return { label, value: '', sample: 'Your rank could not be fetched', empty: true };
  return { label, value: '', sample: 'No rated game on your Riot ID yet', empty: true };
}

/**
 * The three figures. Valorant's alone: a League review is never counted, and
 * the section is named for the game.
 * @param entries      saved reviews ({ game, review } as review-store.js gives them, or reviews)
 * @param ctx.riotId   the Riot ID in Settings, '' for none
 * @param ctx.peak     the tracker profile's peakRank for that Riot ID, or null
 * @param ctx.history  what STATS_RANK_HISTORY answered, or null
 */
function play(entries, ctx, opts) {
  const c = ctx || {};
  const riotId = typeof c.riotId === 'string' && c.riotId.includes('#') ? c.riotId : '';
  const reviews = (Array.isArray(entries) ? entries : [])
    .map((e) => [e, reviewOf(e)])
    .filter(([e, r]) => r && isValorant(e, r))
    .map(([, r]) => r);
  return {
    title: 'Your play in Valorant',
    figures: [weaponFigure(reviews, riotId), agentFigure(reviews), rankFigure(riotId, c.peak, c.history, opts)],
  };
}

/**
 * THE PLANS, all three, the current one marked.
 * @returns [{ id, label, mine, monthly: '$24.99', monthlyPer: 'a month', yearly, yearlyPer, games, action }]
 */
function plans(tier) {
  const mine = typeof tier === 'string' ? tier.toLowerCase() : '';
  return PLANS.map((p) => ({
    id: p.id,
    label: p.label,
    mine: p.id === mine,
    monthly: p.monthlyCents ? money(p.monthlyCents) : '$0',
    monthlyPer: p.monthlyCents ? 'a month' : '',
    yearly: p.yearlyCents ? money(p.yearlyCents) : '$0',
    yearlyPer: p.yearlyCents ? 'a year' : '',
    games: p.monthly ? `${p.games} games a month` : `${p.games} games for life`,
    action: p.id === mine ? '' : `See ${p.label}`,
  }));
}

/** The buy section's fixed lines. */
const BUY = {
  title: 'Buy more games',
  rate: `${money(GAME_PRICE_CENTS)} a game. Bought games never expire and are used after your plan's games.`,
  checkout: 'Checkout opens in your browser.',
  signIn: 'Sign in to buy games',
  signInNote: 'Bought games go to your Occlara account, so sign in first.',
};

// ── Gifts (8.8) ────────────────────────────────────────────────────────────

/*
 * GIFTS: Pro or Max for someone else, a month or a year, at the plan's own
 * price, bought on the site (gifts.js giftBuyUrl, opened by main) and sent as
 * a link the friend redeems. The section offers both paid plans at the cycle
 * the Plans toggle shows, a field to redeem a link or code, and the gifts the
 * player bought, each with its state and a Copy link that main fills in.
 */
const giftsModule = require('./gifts');

/** Gift Pro and Gift Max, for each cycle. */
function giftOffers() {
  const out = { monthly: [], yearly: [] };
  for (const p of PLANS) {
    if (!p.monthly) continue;
    out.monthly.push({ id: `${p.id}_monthly`, label: `Gift ${p.label}`, price: `${money(p.monthlyCents)} for a month`,
      aria: `Gift ${p.label} for a month, ${money(p.monthlyCents)}` });
    out.yearly.push({ id: `${p.id}_yearly`, label: `Gift ${p.label}`, price: `${money(p.yearlyCents)} for a year`,
      aria: `Gift ${p.label} for a year, ${money(p.yearlyCents)}` });
  }
  return out;
}

/**
 * The Gifts section.
 * @param list      GET /api/gifts as main got it ({ bought, received }), or null
 * @param signedIn  whether this PC is signed in to an account
 */
function giftSection(list, signedIn, opts) {
  const l = list && typeof list === 'object' ? list : {};
  const bought = (Array.isArray(l.bought) ? l.bought : []).slice(0, 20).map((g) => {
    const day = usage.dayOf(g.created_at, opts);
    return {
      id: String(g.id || ''),
      what: giftsModule.giftName(g.tier, g.months),
      state: giftsModule.boughtState(g.state),
      when: day ? `Bought ${day}` : '',
      canCopy: g.state !== 'void' && giftsModule.isGiftLink(g.link),
    };
  });
  const running = (Array.isArray(l.received) ? l.received : []).find((g) => g.state === 'running');
  const waiting = (Array.isArray(l.received) ? l.received : []).filter((g) => g.state === 'waiting');
  let received = '';
  if (running) {
    const day = usage.dayOf(running.ends_at, opts);
    const from = running.from_name ? ` from ${running.from_name}` : '';
    received = `Your gift of ${giftsModule.giftName(running.tier, running.months)}${from} runs${day ? ` until ${day}` : ''}.`;
  } else if (waiting.length) {
    received = `${waiting.length === 1 ? 'A gift' : `${waiting.length} gifts`} you redeemed ${waiting.length === 1 ? 'starts' : 'start'} when your current plan ends.`;
  }
  return {
    title: 'Gifts',
    hint: 'Give Pro or Max to a friend. You get a link to send them, and they redeem it on their own account.',
    offers: giftOffers(),
    checkout: 'Checkout opens in your browser.',
    signIn: 'Sign in to send or redeem a gift',
    signedIn: !!signedIn,
    redeem: { label: 'Redeem a gift', placeholder: 'Paste a gift link or code', button: 'Redeem' },
    boughtTitle: bought.length ? 'Gifts you bought' : '',
    bought,
    received,
    copy: 'Copy link',
    copied: 'Link copied',
  };
}

/**
 * The whole page, for PROFILE_GET.
 * @param view     the account's view
 * @param entries  the saved Valorant reviews
 * @param ctx      { riotId, peak, history }
 * @param giftList GET /api/gifts, or null (8.8)
 */
function build(view, entries, ctx, opts, giftList) {
  const h = hero(view, opts);
  return {
    hero: h,
    signedIn: h.state !== 'out',
    buy: { ...BUY, picks: picks(), start: quote(QUICK_PICKS[1]), max: MAX_GAMES_PER_PURCHASE },
    play: play(entries, ctx, opts),
    plans: { title: 'Plans', items: plans(h.tier), monthly: 'Monthly', yearly: 'Yearly' },
    gifts: giftSection(giftList, h.state !== 'out', opts),
  };
}

module.exports = {
  GAME_PRICE_CENTS, MAX_GAMES_PER_PURCHASE, QUICK_PICKS, PLANS, SITE, BUY_PATH, PRICING_URL, BUY,
  money, wholeOf, clampGames, quote, step, picks, buyUrl, isBuyUrl, gamesState, hero, play, plans, rankIndex, agentOf, build,
  giftOffers, giftSection,
};

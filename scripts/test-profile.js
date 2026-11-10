'use strict';

/**
 * The Profile page as finished strings (8.8, src/shared/profile.js): the
 * games left, the price of any number of games and the checkout URL main may
 * open, the three figures of the player's own Valorant play from the record
 * alone, and the plans. The renderer counts nothing, so every line it shows is
 * held here, word for word, with no dash and no semicolon in any of them.
 *
 * Run: npm run test:profile
 */

const fs = require('fs');
const path = require('path');
const profile = require('../src/shared/profile');
const usage = require('../src/shared/usage');

let failed = 0;
let passed = 0;
function eq(got, want, label) {
  const same = JSON.stringify(got) === JSON.stringify(want);
  if (same) { passed++; console.log(`  ok    ${label}`); }
  else { failed++; console.log(`  FAIL  ${label}\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`); }
}
function ok(cond, label, detail) {
  if (cond) { passed++; console.log(`  ok    ${label}`); }
  else { failed++; console.log(`  FAIL  ${label}${detail ? `\n        ${detail}` : ''}`); }
}

const U = { utc: true };
const lines = [];
const say = (s) => { if (typeof s === 'string' && s) lines.push(s); return s; };
const sayAll = (o) => { JSON.stringify(o, (_k, v) => { if (typeof v === 'string') say(v); return v; }); return o; };

console.log('\n[profile] the price of games');
eq([profile.GAME_PRICE_CENTS, profile.MAX_GAMES_PER_PURCHASE, profile.QUICK_PICKS], [200, 500, [1, 5, 10, 25]],
  'a game is $2.00, up to 500 in one checkout, quick picks 1, 5, 10 and 25');
eq([profile.money(200), profile.money(1000), profile.money(100000), profile.money(2499), profile.money(69999), profile.money(5)],
  ['$2', '$10', '$1,000', '$24.99', '$699.99', '$0.05'], 'money: whole dollars bare, cents when there are any, thousands parted');
eq(sayAll(profile.picks()).map((p) => p.label), ['1 for $2', '5 for $10', '10 for $20', '25 for $50'], 'the quick picks at the one rate');
eq(profile.picks().map((p) => p.aria), ['1 game for $2', '5 games for $10', '10 games for $20', '25 games for $50'], 'and what a screen reader hears');
eq(sayAll(profile.quote(5)), { ok: true, n: 5, total: '$10', label: 'Buy 5 games for $10', note: '' }, '5 games: $10');
eq(sayAll(profile.quote('1')), { ok: true, n: 1, total: '$2', label: 'Buy 1 game for $2', note: '' }, 'one game, typed');
eq(profile.quote('37').label, 'Buy 37 games for $74', 'any whole number at the same rate');
eq(profile.quote(500).label, 'Buy 500 games for $1,000', 'the most: 500 for $1,000');
eq(sayAll(profile.quote('900')), { ok: true, n: 500, total: '$1,000', label: 'Buy 500 games for $1,000', note: '500 games is the most in one checkout.' },
  'more than 500 is clamped to 500, and says why');
eq(sayAll(profile.quote('0')), { ok: true, n: 1, total: '$2', label: 'Buy 1 game for $2', note: 'One game is the fewest you can buy.' }, '0 is clamped to 1');
for (const bad of ['', ' ', 'abc', '2.5', '-3', null, undefined, NaN, 2.5, -1, '1e3', {}]) {
  const q = profile.quote(bad);
  ok(q.ok === false && q.n === null && q.label === 'Buy games' && q.note === 'Choose from 1 to 500 games.', `not a whole number (${JSON.stringify(bad)}): nothing to buy`);
}
say(profile.quote('').note);
eq([profile.step(5, 1), profile.step(5, -1), profile.step(1, -1), profile.step(500, 1), profile.step('', 1), profile.step('abc', -1), profile.step('900', -1)],
  [6, 4, 1, 500, 1, 1, 499], 'the stepper moves by one and stays in 1 to 500');

console.log('\n[profile] the checkout URL main opens');
eq(profile.buyUrl(5), 'https://occlara.app/buy?games=5', 'the site\'s /buy with the number');
eq([profile.buyUrl(1), profile.buyUrl(500)], ['https://occlara.app/buy?games=1', 'https://occlara.app/buy?games=500'], 'both ends');
eq([0, 501, -1, 2.5, NaN, '5', null, Infinity].map(profile.buyUrl), [null, null, null, null, null, null, null, null], 'no URL for anything but a whole 1 to 500');
ok([1, 5, 10, 25, 37, 500].every((n) => profile.isBuyUrl(profile.buyUrl(n))), 'every URL buyUrl makes passes isBuyUrl');
const forged = [
  'https://occlara.app/buy?games=0', 'https://occlara.app/buy?games=501', 'https://occlara.app/buy?games=05', 'https://occlara.app/buy?games=5.0',
  'https://occlara.app/buy?games=5&user=x', 'https://occlara.app/buy?games=5#x', 'https://occlara.app/buy/?games=5', 'https://occlara.app/pay?games=5',
  'http://occlara.app/buy?games=5', 'https://occlara.app.evil.com/buy?games=5', 'https://evil.com/buy?games=5', 'https://user@occlara.app/buy?games=5',
  'https://occlara.app:8443/buy?games=5', 'https://occlara.app/buy?games=5&games=6', 'https://occlara.app/buy', 'javascript:alert(1)', '', null, 5,
];
for (const u of forged) ok(!profile.isBuyUrl(u), `refused: ${JSON.stringify(u)}`);
eq(profile.PRICING_URL, 'https://occlara.app/#pricing', 'the plans open the site\'s pricing');

console.log('\n[profile] the hero: games left, the plan, when they start again');
const NOV30 = '2026-11-30T12:00:00Z';
const viewOf = (st) => ({ signedIn: true, via: 'session', games: profile.gamesState(st) });
eq(sayAll(profile.hero(viewOf({ tier: 'pro', left: 18, cap_monthly: 25, bonus_pool: 3, period_end: NOV30 }), U)),
  { state: 'games', number: '18', unit: 'games left', tier: 'pro', plan: 'Pro plan, 25 games a month', split: '15 of this month\'s 25, plus 3 bonus games', renew: 'Your month\'s games start again Nov 30.' },
  'Pro with bought games: the whole number, the plan, the split and the day');
eq(sayAll(profile.hero(viewOf({ tier: 'max', left: 70, cap_monthly: 70, bonus_pool: 0, period_end: NOV30 }), U)).split, '', 'Max with no bonus games: no second line saying the number again');
eq(profile.hero(viewOf({ tier: 'max', left: 70, cap_monthly: 70 }), U).renew, 'Your month\'s games start again with your plan.', 'no period end: no invented day');
eq(sayAll(profile.hero(viewOf({ tier: 'free', left: 1, free_total: 2, bonus_pool: 0 }), U)),
  { state: 'games', number: '1', unit: 'game left', tier: 'free', plan: 'Free plan, 2 games for life', split: '', renew: 'Free games do not renew. Upgrade for games every month.' },
  'Free, one left: "game" for one');
eq(profile.hero(viewOf({ tier: 'free', left: 5, free_total: 2, bonus_pool: 5 }), U).split, '0 of your 2 free games, plus 5 bonus games', 'Free with its own used and 5 bought');
eq(profile.hero(viewOf({ tier: 'free', left: 0, free_total: 2, bonus_pool: 0 }), U).number, '0', 'none left is 0, said as a number');
eq(sayAll(profile.hero({ signedIn: false, via: 'key' }, U)).state, 'out', 'a licence key alone: sign in to see the games');
eq(profile.hero({ signedIn: false, via: null }, U).plan, 'Sign in to see your games', 'nobody: the same');
eq(sayAll(profile.hero({ signedIn: true, via: 'session', games: null }, U)).state, 'error', 'signed in with no state: could not be fetched');
eq(profile.gamesState({ tier: 'pro', left: 3, cap_monthly: 25, bonus_pool: 1, period_end: NOV30, email: 'a@b.c', account_key: 'GC-1', invites: {} }),
  { tier: 'pro', left: 3, cap_monthly: 25, free_total: null, bonus_pool: 1, period_end: NOV30 }, 'the view is handed the games\' fields alone, no email, no key');

console.log('\n[profile] the player\'s play, from the record alone');
const feed = (...ks) => ks.map(([by, w]) => ({ ms: 1000, by, on: by === 'me' ? 'enemy' : 'me', ...(w ? { w } : {}) }));
const match = (agent, rounds, extra) => ({ game: 'valorant', review: { kind: 'valorant', verified: true, game: { agent }, rounds: rounds.map((f, i) => ({ n: i + 1, riot: { feed: f } })), ...(extra || {}) } });
const lib = [
  match('Jett', [feed(['me', 'Vandal'], ['me', 'Vandal'], ['enemy', 'Phantom']), feed(['me', 'Sheriff'], ['me', 'Updraft'])]),
  match('Jett', [feed(['me', 'Vandal'], ['me', 'Operator'], ['mate', 'Vandal'])]),
  match('Reyna', [feed(['me', 'Phantom'], ['me', 'Melee'])]),
  // Unlinked, its agent a detection alone: counted for nothing.
  { game: 'valorant', review: { kind: 'valorant', verified: false, game: { agent: 'Sage' }, rounds: [], ledger: { context: { agent: 'Sage', agentConfirmed: false } } } },
  // Unlinked, its agent confirmed off the HUD: counted as played.
  { game: 'valorant', review: { kind: 'valorant', verified: false, game: { agent: 'Reyna' }, rounds: [], ledger: { context: { agent: 'Reyna', agentConfirmed: true } } } },
  // League is never counted under Valorant's name.
  { game: 'lol', review: { kind: 'lol', verified: true, game: { agent: 'Ahri', champion: 'Ahri' }, rounds: [{ riot: { feed: feed(['me', 'Vandal'], ['me', 'Vandal'], ['me', 'Vandal'], ['me', 'Vandal']) } }] } },
];
const hist = { points: [
  { date: Date.UTC(2026, 9, 2), elo: 1400, change: 18, tier: 'Gold 3' },
  { date: Date.UTC(2026, 9, 12), elo: 1520, change: 20, tier: 'Platinum 1' },
  { date: Date.UTC(2026, 9, 20), elo: 1490, change: -15, tier: 'Gold 3' },
  { date: Date.UTC(2026, 9, 21), elo: 0, change: 0, tier: 'Unrated' },
] };
const p = sayAll(profile.play(lib, { riotId: 'Player#EUW', peak: null, history: hist }, U));
eq(p.title, 'Your play in Valorant', 'the section is named for its game');
eq(p.figures[0], { label: 'Most used weapon', value: 'Vandal', sample: '3 of your 7 kills, from 3 matches', empty: false },
  'most used weapon: the player\'s own kills by gun, an ability kill and a teammate\'s never counted');
eq(p.figures[1], { label: 'Most played agent', value: 'Jett', sample: '2 of your 4 matches', empty: false },
  'most played agent: by matches, Riot\'s or confirmed, a detection alone and League never');
eq(p.figures[2], { label: 'Peak rank', value: 'Platinum 1', sample: 'Your best of 3 rated games, on Oct 12', empty: false },
  'peak rank from the rank history: the best rated game and its day, Unrated left out');
eq(profile.play(lib, { riotId: 'Player#EUW', peak: 'Diamond 2', history: hist }, U).figures[2],
  { label: 'Peak rank', value: 'Diamond 2', sample: 'Riot\'s highest rank on your account', empty: false }, 'Riot\'s own peak wins where it is higher');
eq(profile.play(lib, { riotId: 'Player#EUW', peak: 'Silver 1', history: hist }, U).figures[2].value, 'Platinum 1', 'and the history where it is higher');
// MMR v3's peak names its act (8.7.9, rankDetail.peakSeason), and a word that
// is no act code is left out rather than painted.
eq(profile.play(lib, { riotId: 'Player#EUW', peak: 'Diamond 2', peakSeason: 'e9a2', history: hist }, U).figures[2].sample,
  'Riot\'s highest rank on your account, in E9A2', 'the peak says the act MMR v3 reached it in');
eq(profile.play(lib, { riotId: 'Player#EUW', peak: 'Diamond 2', peakSeason: '<b>x</b>', history: hist }, U).figures[2].sample,
  'Riot\'s highest rank on your account', 'and no act for a word that is no act code');
eq(profile.play(lib, { riotId: 'Player#EUW', peak: 'Silver 1', peakSeason: 'e9a2', history: hist }, U).figures[2].value, 'Platinum 1',
  'a lower v3 peak still gives way to the history');
eq(profile.play(lib, { riotId: 'Player#EUW', peak: 'Unranked', history: { error: 'unavailable' } }, U).figures[2],
  { label: 'Peak rank', value: '', sample: 'Your rank could not be fetched', empty: true }, 'no rank and no history: says it could not be fetched');
eq(profile.play(lib, { riotId: 'Player#EUW', peak: null, history: { points: [] } }, U).figures[2].sample, 'No rated game on your Riot ID yet', 'no rated game: says so');
for (const said of ['Could not load rank history.', 'Account not found.', 'No stats provider configured.']) {
  eq(profile.play(lib, { riotId: 'Player#EUW', peak: null, history: { error: said } }, U).figures[2].sample, 'Your rank could not be fetched',
    `the server's "${said}" is a history not read, never "no rated game"`);
}
const none = sayAll(profile.play([], { riotId: '' }, U));
eq(none.figures.map((f) => [f.value, f.sample, f.empty]), [
  ['', 'Connect your Riot ID to see this', true],
  ['', 'Play a match to see this', true],
  ['', 'Connect your Riot ID to see this', true],
], 'an empty library and no Riot ID: honest empty states');
eq(profile.play([], { riotId: 'Player#EUW', history: { points: [] } }, U).figures[0].sample, 'Play a match to see this', 'a Riot ID and no match yet');
const oldFeed = profile.play([match('Jett', [feed(['me'], ['me'], ['enemy'])])], { riotId: 'Player#EUW' }, U);
eq(oldFeed.figures[0], { label: 'Most used weapon', value: '', sample: 'Riot\'s record of your matches names no gun yet', empty: true },
  'linked matches whose feed names no gun (a server from before): says so, never guesses');
eq(oldFeed.figures[1].value, 'Jett', 'and the agent still counts');
ok(profile.rankIndex('Radiant') > profile.rankIndex('Immortal 3') && profile.rankIndex('Gold 1') < profile.rankIndex('Gold 3') && profile.rankIndex('Unrated') === null,
  'the ladder orders ranks and knows Unrated is none');
ok(profile.play(lib.map((e) => e.review), { riotId: '' }, U).figures[1].value === 'Jett', 'reviews handed bare are read the same');

console.log('\n[profile] the plans');
const pl = sayAll(profile.plans('pro'));
eq(pl.map((x) => [x.label, x.monthly, x.monthlyPer, x.yearly, x.yearlyPer, x.games, x.mine, x.action]), [
  ['Free', '$0', '', '$0', '', '4 games for life', false, 'See Free'],
  ['Pro', '$24.99', 'a month', '$249.99', 'a year, save $49.89', '25 games a month', true, ''],
  ['Max', '$69.99', 'a month', '$699.99', 'a year, save $139.89', '70 games a month', false, 'See Max'],
], 'Free, Pro and Max at the site\'s prices, the current one marked, the others with a way to the site');
eq([profile.PLANS[0].games, profile.PLANS[1].games, profile.PLANS[2].games], [usage.FREE_GAMES, usage.TIERS.pro.cap, usage.TIERS.max.cap], 'the games are usage.js\'s, one source');
ok(profile.plans(null).every((x) => !x.mine && x.action), 'signed out: no plan is marked');

console.log('\n[profile] the whole page');
const page = sayAll(profile.build(viewOf({ tier: 'free', left: 0, free_total: 2, bonus_pool: 0 }), lib, { riotId: '' }, U));
ok(page.signedIn && page.hero.number === '0' && page.buy.start.label === 'Buy 5 games for $10' && page.plans.items[0].mine && page.play.figures.length === 3,
  'built: the hero, the buy section starting at 5, the plans with Free marked, three figures');
eq(page.buy.rate, '$2 a game. Bought games never expire and are used after your plan\'s games.', 'the one line on bought games');
ok(!profile.build({ via: 'key' }, [], {}, U).signedIn, 'a licence key alone is not signed in');

console.log('\n[profile] the copy');
const DASH = new RegExp('[\\u2013\\u2014]');
ok(DASH.test(`a ${String.fromCharCode(0x2014)} b`) && !DASH.test('a, b'), 'the dash check finds a dash and passes a comma');
ok(lines.length > 40 && lines.every((s) => !DASH.test(s) && !s.includes(';')), 'no dash and no semicolon in any line a player reads',
  lines.filter((s) => DASH.test(s) || s.includes(';')).join(' | '));
const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'shared', 'profile.js'), 'utf8');
ok(!DASH.test(src), 'nor a dash anywhere in profile.js');
ok(!/require\([^)]*server/.test(src), 'and it requires nothing from server/');

console.log(`\n[profile] ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

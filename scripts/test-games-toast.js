'use strict';

/**
 * The games toast's detection (8.9.1, src/main/services/games-toast.js): when
 * the account's games go up for a gift, an invite, a purchase, a plan
 * starting or the free allowance raised, one event with the amount and the
 * reason, kept in the store until it can be shown. Never on the first state
 * ever seen, never across two accounts, never for a monthly reset, never for
 * anything going down. Held while a match is on, kept across a restart, and
 * the one time 8.9.0 upgrade rule ("Free is now 4 games") said once only.
 *
 * Run: npm run test:gamestoast
 */

const fs = require('fs');
const path = require('path');
const gt = require('../src/main/services/games-toast');

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

/** The app's store, in memory: a JSON round trip on every write, as the file is. */
function memStore(init) {
  const data = JSON.parse(JSON.stringify(init || {}));
  return {
    get: (k) => (data[k] === undefined ? undefined : JSON.parse(JSON.stringify(data[k]))),
    set: (k, v) => { data[k] = JSON.parse(JSON.stringify(v)); },
    data,
  };
}

const A = { account_key: 'GC-AAAA-1111', email: 'a@example.com' };
const B = { account_key: 'GC-BBBB-2222', email: 'b@example.com' };
const free = (extra) => ({ ...A, tier: 'free', source: null, used: 1, left: 3, cap_monthly: null, free_total: 4, bonus_pool: 0, bonus_earned: 0, ...extra });
const kinds = (evs) => evs.map((e) => `${e.kind}:${e.n}`);

function watch(opts) {
  const store = (opts && opts.store) || memStore();
  let t = 1000;
  const w = gt.createGamesWatch({ store, now: () => (t += 1000), priorVersion: '8.9.1', hadAccount: true, ...(opts || {}) });
  return { w, store };
}

console.log('\n[games toast] never on the first state, never across accounts');
{
  const { w, store } = watch();
  eq(w.observe(free()), [], 'the first state ever seen raises nothing: nothing to compare with');
  ok(store.data.gamesSeen && store.data.gamesSeen.who && !JSON.stringify(store.data.gamesSeen).includes('GC-AAAA') && !JSON.stringify(store.data.gamesSeen).includes('example.com'),
    'what is kept names the account by a hash, never its key or its email', JSON.stringify(store.data.gamesSeen));
  eq(w.observe(null), [], 'no state (signed out, an error) changes nothing');
  eq(w.observe({ ...free(), account_key: null, email: null }), [], 'a state with no key and no email is no account');
  eq(w.observe({ ...B, tier: 'pro', source: 'gift', cap_monthly: 25, free_total: 6, bonus_pool: 40, bonus_earned: 20 }), [],
    'signed in as someone else, with more of everything: nothing, only remembered');
  eq(w.observe({ ...free(), free_total: 4 }), [], 'and back to the first account: nothing either, the last one kept was the other');
  eq(w.pending(), [], 'nothing waiting');
}

console.log('\n[games toast] each reason');
{
  const { w } = watch();
  w.observe(free());
  eq(kinds(w.observe(free({ tier: 'pro', source: 'gift', cap_monthly: 25 }))), ['gift:25'], 'free to Pro by a gift: a gift of 25 a month');
  eq(kinds(w.observe(free({ tier: 'free', source: null }))), [], 'the gift ending: nothing, games going down are never said');
  eq(kinds(w.observe(free({ tier: 'max', source: 'stripe', cap_monthly: 70 }))), ['plan:70'], 'Max bought: a plan starting');
  eq(kinds(w.observe(free({ tier: 'max', source: 'stripe', cap_monthly: 70, left: 70, used: 0, period_end: '2026-12-09' }))), [],
    'a new month (left back to the cap, the period moved): nothing');
  eq(kinds(w.observe(free({ tier: 'max', source: 'stripe', cap_monthly: 70, bonus_pool: 4, bonus_earned: 4 }))), ['invite:4'],
    'a friend played their first game: the invite paid off, 4');
  eq(kinds(w.observe(free({ tier: 'max', source: 'stripe', cap_monthly: 70, bonus_pool: 14, bonus_earned: 4 }))), ['bought:10'],
    'bonus_pool up 10 with bonus_earned still: 10 bought');
  eq(kinds(w.observe(free({ tier: 'max', source: 'stripe', cap_monthly: 70, bonus_pool: 23, bonus_earned: 8 }))), ['invite:4', 'bought:5'],
    'both at once: the invite\'s 4 and the 5 bought beside it, two toasts');
  eq(kinds(w.observe(free({ tier: 'max', source: 'stripe', cap_monthly: 70, bonus_pool: 13, bonus_earned: 8 }))), [],
    'games bought taken back by a refund: nothing');
  eq(kinds(w.observe(free({ tier: 'free', source: null, cap_monthly: null, bonus_pool: 13, bonus_earned: 8 }))), [], 'the plan ending: nothing');
  eq(kinds(w.observe(free({ tier: 'pro', source: 'stripe', cap_monthly: 25, bonus_pool: 13, bonus_earned: 8 }))), ['plan:25'], 'Pro bought');
  eq(kinds(w.observe(free({ tier: 'max', source: 'stripe', cap_monthly: 70, bonus_pool: 13, bonus_earned: 8 }))), ['plan:70'], 'Pro to Max: a plan, its 70');
  eq(kinds(w.observe(free({ tier: 'pro', source: 'stripe', cap_monthly: 25, bonus_pool: 13, bonus_earned: 8 }))), [], 'Max down to Pro: nothing');
  eq(kinds(w.observe(free({ tier: 'pro', source: 'gift', cap_monthly: 25, bonus_pool: 13, bonus_earned: 8 }))), ['gift:25'],
    'Pro ended and a waiting gift of Pro took over: a gift');
}
{
  const { w } = watch();
  w.observe({ ...A, tier: 'free', free_total: 2, bonus_pool: 0, bonus_earned: 0 });
  eq(w.observe({ ...A, tier: 'free', free_total: 4, bonus_pool: 0, bonus_earned: 0 }).map((e) => [e.kind, e.n, e.total]), [['raise', 2, 4]],
    'free_total 2 to 4: the allowance raised by 2, now 4');
}

console.log('\n[games toast] the words');
const W = (ev) => { const x = gt.words(ev); return `${x.pre}${x.n === null ? '' : x.n}${x.post} | ${x.line}`; };
eq(W({ kind: 'gift', n: 25, tier: 'pro' }), 'You got Pro | Someone sent you a gift, 25 games a month.', 'a gift without a name: Someone');
eq(W({ kind: 'gift', n: 70, tier: 'max', from: 'Alex' }), 'You got Max | Alex sent you a gift, 70 games a month.', 'a gift the buyer signed: their own first name');
eq(W({ kind: 'gift', n: 25, tier: 'pro', from: 'Tenz#NA1' }), 'You got Pro | Someone sent you a gift, 25 games a month.',
  'a name that reads as a Riot ID is never shown');
eq(W({ kind: 'plan', n: 25, tier: 'pro' }), 'You got Pro | Thanks for your purchase, 25 games a month.', 'a plan bought');
eq(W({ kind: 'invite', n: 4 }), 'You got 4 games | Your invite paid off.', 'an invite');
eq(W({ kind: 'bought', n: 1 }), 'You got 1 game | Thanks for your purchase.', 'one game bought, singular');
eq(W({ kind: 'raise', n: 2, total: 4 }), 'You got 2 games | Free is now 4 games.', 'the raise');
eq([gt.cleanFrom('Alex'), gt.cleanFrom('a#b'), gt.cleanFrom('x@y.z'), gt.cleanFrom('https://evil'), gt.cleanFrom('A'.repeat(33)), gt.cleanFrom(5)],
  ['Alex', '', '', '', '', ''], 'a giver\'s name: plain words only, no tag, email, link or long string');
const DASH = new RegExp('[\\u2013\\u2014]');
ok(DASH.test(`a ${String.fromCharCode(0x2014)} b`) && !DASH.test('a, b'), 'the dash check finds a dash and passes a comma');
const all = ['gift', 'plan', 'invite', 'bought', 'raise', 'other'].map((k) => W({ kind: k, n: 3, tier: 'pro', total: 4 }));
ok(all.every((s) => !DASH.test(s) && !s.includes(';')), 'no dash and no semicolon in any toast', all.join(' / '));

// The centred reveal (8.10.4) reads the same event: its picture, its counted number, its unit and its line.
const R = (ev) => { const x = gt.words(ev); return `${x.look}|${x.big}|${x.unit}|${x.tier}|${x.rline}`; };
eq(R({ kind: 'invite', n: 4 }), 'gift|4|games||Your invite paid off.', 'an invite opens the gift on 4 games');
eq(R({ kind: 'bought', n: 1 }), 'gift|1|game||Thanks for your purchase.', 'one game bought: singular unit');
eq(R({ kind: 'raise', n: 2, total: 4 }), 'gift|2|games||Free is now 4 games.', 'the raise opens the gift');
eq(R({ kind: 'gift', n: 25, tier: 'pro', from: 'Alex' }), 'gift|25|games a month|pro|Alex sent you Pro.', 'a gifted plan: the gift, its 25 games a month, its tier, the giver');
eq(R({ kind: 'gift', n: 70, tier: 'max' }), 'gift|70|games a month|max|Someone sent you Max.', 'a gifted Max: Someone when unsigned');
eq(R({ kind: 'plan', n: 25, tier: 'pro' }), 'plan|25|games a month|pro|Welcome to Pro. Thanks for your purchase.', 'a plan bought: the crescent ring, 25 a month');
eq(R({ kind: 'plan', n: 70, tier: 'max' }), 'plan|70|games a month|max|Welcome to Max. Thanks for your purchase.', 'Max: the ring takes its own tier');
{
  const lines = ['gift', 'plan', 'invite', 'bought', 'raise', 'other'].map((k) => R({ kind: k, n: 3, tier: 'max', total: 4, from: 'Sam' }));
  ok(lines.every((s) => !DASH.test(s) && !s.includes(';')), 'no dash and no semicolon in any reveal line', lines.join(' / '));
}

console.log('\n[games toast] held while a match is on, kept across a restart');
{
  const store = memStore();
  const first = watch({ store }).w;
  first.observe(free());
  const got = first.observe(free({ bonus_pool: 4, bonus_earned: 4 }));
  eq(kinds(got), ['invite:4'], 'an invite paid off mid match: raised');
  // index.js flushGamesToasts: take(busy) while matchInProgress() or sealed.
  eq(first.take(true), [], 'mid match (busy): nothing taken');
  eq(first.pending().length, 1, 'it waits');
  // A restart: a new watch over the same file.
  const again = watch({ store }).w;
  eq(again.pending().length, 1, 'restarted mid match: still waiting');
  eq(kinds(again.observe(free({ bonus_pool: 4, bonus_earned: 4 }))), [], 'the same state after the restart raises nothing again');
  const shown = again.take(false);
  eq(shown.map((t) => [t.kind, t.pre, t.n, t.post, t.line]), [['invite', 'You got ', 4, ' games', 'Your invite paid off.']],
    'the match over: taken once, in words');
  eq(again.take(false), [], 'and never twice');
  eq(kinds(watch({ store }).w.observe(free({ bonus_pool: 8, bonus_earned: 8 }))), ['invite:4'], 'games that came while the app was shut: said on the next state after launch');
}
{
  const { w } = watch();
  w.observe(free());
  w.observe(free({ tier: 'pro', source: 'gift', cap_monthly: 25 }));
  ok(w.nameGift('Sam') && w.take(false)[0].line === 'Sam sent you a gift, 25 games a month.', 'a gift named once GET /api/gifts answers');
  ok(!w.nameGift('Sam#EUW'), 'a Riot ID shaped name is refused');
}

console.log('\n[games toast] the 8.9.0 upgrade, once');
{
  const { w, store } = watch({ priorVersion: '8.9.0' });
  eq(w.observe(free({ free_total: 4 })).map((e) => [e.kind, e.n, e.total]), [['raise', 2, 4]], 'from 8.9.0, no state kept, free_total 4: 2 games, Free is now 4');
  ok(store.data.gamesRaiseChecked === true, 'decided, and remembered');
  eq(w.observe(free({ free_total: 4 })), [], 'the next state: nothing');
  const again = gt.createGamesWatch({ store, priorVersion: '8.9.0', hadAccount: true });
  store.set('gamesSeen', null);
  eq(again.observe(free({ free_total: 4 })), [], 'even with what was kept lost, never a second time');
}
eq(kinds(watch({ priorVersion: '8.8.1' }).w.observe(free({ free_total: 6 }))), ['raise:2'], 'from 8.8.1, invited, free_total 6: 2 games');
eq(kinds(watch({ priorVersion: '0.0.0' }).w.observe(free({ free_total: 4 }))), ['raise:2'], 'an install from before the changelog (onboarded, no version kept)');
eq(watch({ priorVersion: '8.9.0' }).w.observe(free({ free_total: 5 })), [], 'free_total not 4 or 6: nothing');
eq(watch({ priorVersion: '8.9.0' }).w.observe(free({ free_total: 2 })), [], 'the server still says 2: nothing');
eq(watch({ priorVersion: '8.9.0' }).w.observe(free({ tier: 'pro', cap_monthly: 25 })), [], 'a Pro account: nothing');
eq(watch({ priorVersion: '8.9.1' }).w.observe(free()), [], 'already on 8.9.1: nothing (first sign in)');
eq(watch({ priorVersion: '' }).w.observe(free()), [], 'a fresh install: nothing');
eq(watch({ priorVersion: '8.9.0', hadAccount: false }).w.observe(free()), [], 'an account made today on an old install: nothing');
{
  const store = memStore();
  const w = gt.createGamesWatch({ store, priorVersion: '8.9.1', hadAccount: true });
  w.observe(free());
  const old = gt.createGamesWatch({ store, priorVersion: '8.9.0', hadAccount: true });
  eq(old.observe(free()), [], 'a state already kept: the upgrade rule never runs');
}

console.log('\n[games toast] wired in main');
{
  const index = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'index.js'), 'utf8');
  const flush = (index.match(/function flushGamesToasts\(\) \{[\s\S]*?\n\}/) || [''])[0];
  ok(/if \(matchInProgress\(\) \|\| windowSealed\(\)\) return;/.test(flush), 'flushGamesToasts takes nothing while a match is on or the window is sealed', flush.slice(0, 200));
  ok(/if \(st\) observeGames\(st\);/.test(index), 'every account change is observed');
  ok(/gamesWatch\.pending\(\)\.length\) flushAccountWaits\(\)/.test(index), 'the seal lifting flushes the waiting toasts (syncSeal)');
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'services', 'games-toast.js'), 'utf8');
  ok(!DASH.test(src), 'no dash in games-toast.js');
  ok(!/require\([^)]*server/.test(src), 'and it requires nothing from server/');
}

console.log(`\n[games toast] ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

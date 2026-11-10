'use strict';

/**
 * Games left, the cap and the invite as finished strings (8.7,
 * src/shared/usage.js), for every tier and edge: no renderer does arithmetic
 * on games or dates, so every line a page shows is held here, word for word.
 * And no em or en dash in any of them.
 *
 * Run: npm run test:usage
 */

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
const NOV30 = '2026-11-30T12:00:00Z';
const lines = [];
const say = (s) => { lines.push(s); return s; };

console.log('\n[usage] games left, Free');
eq([usage.FREE_GAMES, usage.FRIEND_GIFT, usage.FREE_GAMES + usage.FRIEND_GIFT], [4, 2, 6],
  'Free is 4 games for life, an invited friend 2 more: 6 (the server says the same)');
eq(require('../server/services/caller').FREE_GAMES, usage.FREE_GAMES, 'and the server\'s FREE_GAMES is the same number');
eq(require('../server/services/caller').INVITE_EXTRA_GAMES, usage.FRIEND_GIFT, 'and its INVITE_EXTRA_GAMES the friend\'s gift');
eq(say(usage.gamesLeft({ tier: 'free', left: 2, free_total: 2 }, U)), '2 of 2 free games left', 'a new free account');
eq(say(usage.gamesLeft({ tier: 'free', left: 1, free_total: 2 }, U)), '1 of 2 free games left', 'one used, one left');
eq(say(usage.gamesLeft({ tier: 'free', left: 0, free_total: 2 }, U)), 'You have used your 2 free games', 'none left');
eq(say(usage.gamesLeft({ tier: 'free', left: 4, free_total: 4 }, U)), '4 of 4 free games left', 'invited: 4 free games');
eq(say(usage.gamesLeft({ tier: 'free', left: 3, free_total: 4 }, U)), '3 of 4 free games left', 'invited, one used');
eq(say(usage.gamesLeft({ tier: 'free', left: 5, free_total: 2, bonus_pool: 4 }, U)), '1 of 2 free games left, plus 4 bonus games',
  'earned games beside the free ones, never "5 of 2"');
eq(say(usage.gamesLeft({ tier: 'free', left: 4, free_total: 2, bonus_pool: 4 }, U)), '4 bonus games left', 'the free ones spent, earned ones left');
eq(say(usage.gamesLeft({ tier: 'free', left: 1, free_total: 2, bonus_pool: 1 }, U)), '1 bonus game left', 'one earned game, singular');
eq(say(usage.gamesLeft({ tier: 'free', left: 1, free_total: 1 }, U)), '1 of 1 free game left', 'a total of one, singular');
eq(say(usage.gamesLeft({ tier: 'free', left: 0, free_total: 0 }, U)), 'You have no free games left', 'a refunded account (free_total 0)');
eq(usage.gamesLeft({ tier: 'free', left: 1 }, U), '1 of 4 free games left', 'no free_total: the default 4');

console.log('\n[usage] games left, Pro and Max');
eq(say(usage.gamesLeft({ tier: 'pro', left: 18, cap_monthly: 25, period_end: NOV30 }, U)), '18 of 25 games left this month, renews Nov 30', 'Pro');
eq(say(usage.gamesLeft({ tier: 'pro', left: 25, period_end: NOV30 }, U)), '25 of 25 games left this month, renews Nov 30', 'Pro, no cap sent: 25');
eq(say(usage.gamesLeft({ tier: 'pro', left: 1, cap_monthly: 25, period_end: NOV30 }, U)), '1 of 25 games left this month, renews Nov 30', 'Pro, one left');
eq(say(usage.gamesLeft({ tier: 'pro', left: 0, cap_monthly: 25, period_end: NOV30 }, U)), "You have used this month's 25 games, renews Nov 30", 'Pro, none left');
eq(say(usage.gamesLeft({ tier: 'pro', left: 22, cap_monthly: 25, bonus_pool: 4, period_end: NOV30 }, U)),
  '18 of 25 games left this month, plus 4 bonus games, renews Nov 30', 'Pro with bonus games');
eq(say(usage.gamesLeft({ tier: 'pro', left: 4, cap_monthly: 25, bonus_pool: 4, period_end: NOV30 }, U)), '4 bonus games left, renews Nov 30',
  'Pro, the month spent, earned ones left');
eq(say(usage.gamesLeft({ tier: 'max', left: 70, cap_monthly: 70, period_end: '2026-12-01T12:00:00Z' }, U)), '70 of 70 games left this month, renews Dec 1', 'Max');
eq(say(usage.gamesLeft({ tier: 'max', left: 0, cap_monthly: 70, period_end: NOV30 }, U)), "You have used this month's 70 games, renews Nov 30", 'Max, none left');
eq(say(usage.gamesLeft({ tier: 'pro', left: 10, cap_monthly: 25 }, U)), '10 of 25 games left this month', 'no period end: no renewal date');
eq(usage.gamesLeft({ tier: 'pro', left: 10, cap_monthly: 25, period_end: 'not a date' }, U), '10 of 25 games left this month', 'a bad date: none');
eq(usage.gamesLeft({ tier: 'MAX', left: 69, cap_monthly: 70, period_end: '2027-01-15T12:00:00Z' }, U), '69 of 70 games left this month, renews Jan 15',
  'the tier in any case, January');

console.log('\n[usage] nothing to say');
eq(usage.gamesLeft(null), '', 'no state');
eq(usage.gamesLeft({}), '', 'no tier');
eq(usage.gamesLeft({ tier: 'gold', left: 3 }), '', 'a tier this build does not know');
eq(usage.gamesLeft({ tier: 'free' }), '', 'no left');
eq(usage.gamesLeft({ tier: 'free', left: 'x' }), '', 'a left that is no number');
eq(usage.capState(null), null, 'no cap card for no state');
eq(usage.capState({ tier: 'free', left: 1, free_total: 2 }), null, 'nor while games are left');
eq(usage.inviteProgress(null), '', 'no invite line for no referral');

console.log('\n[usage] the cap card');
const freeCap = usage.capState({ tier: 'free', left: 0, free_total: 2, capped: true }, U);
eq(freeCap, { capped: true, title: 'You have used your 2 free games',
  body: 'Upgrade to Pro for 25 games a month, or invite friends for more free games.', upgrade: 'pro' }, 'Free');
const proCap = usage.capState({ tier: 'pro', left: 0, cap_monthly: 25, period_end: NOV30 }, U);
eq(proCap, { capped: true, title: "You have used this month's 25 games",
  body: 'They renew Nov 30. Max gives you 70 games a month, or invite friends for more.', upgrade: 'max' }, 'Pro');
const maxCap = usage.capState({ tier: 'max', left: 0, cap_monthly: 70 }, U);
eq(maxCap, { capped: true, title: "You have used this month's 70 games",
  body: 'They renew with your plan. Invite friends for more games meanwhile.', upgrade: null }, 'Max, no period end');
eq(usage.capState({ tier: 'free', left: 1, free_total: 2, capped: true }, U).title, 'You have used your 2 free games',
  'the server\'s capped decides even with a number left (a device refusal)');
eq(say(usage.capNotice({ tier: 'free', left: 0, free_total: 2 }, U)),
  'You have used your 2 free games. Upgrade at occlara.app/pricing or invite friends for more.', 'the notice line for a cap');
eq(usage.capNotice({ tier: 'free', left: 1, free_total: 2 }, U), '', 'and none while games are left');
for (const c of [freeCap, proCap, maxCap]) lines.push(c.title, c.body);

console.log('\n[usage] the invite');
eq(say(usage.inviteProgress({ invited: 0, qualified: 0, earned: 0 })), '0 of 5 friends joined, 0 games earned', 'nobody yet');
eq(say(usage.inviteProgress({ invited: 1, qualified: 1, earned: 4, max_friends: 5, max_games: 20 })), '1 of 5 friends joined, 4 games earned', 'one friend');
eq(say(usage.inviteProgress({ invited: 3, qualified: 1, earned: 4 })), '1 of 5 friends joined, 4 games earned, 2 still to record a match',
  'friends signed up who have not recorded a match yet');
eq(say(usage.inviteProgress({ invited: 5, qualified: 5, earned: 20 })), '5 of 5 friends joined, 20 games earned, the most there is', 'the most');
eq(usage.inviteProgress({ invited: 9, qualified: 7, earned: 28 }), '5 of 5 friends joined, 20 games earned, the most there is', 'never past the most');
eq(usage.INVITE_HOW, ['Each friend who signs up with your link gets 2 extra free games.',
  'You get 4 games for each friend who records their first match, up to 20.'], 'how it works, in two lines');
lines.push(...usage.INVITE_HOW);

console.log('\n[usage] labels and dates');
eq([usage.tierLabel({ tier: 'free' }), usage.tierLabel({ tier: 'pro' }), usage.tierLabel({ tier: 'max' }), usage.tierLabel({})], ['Free', 'Pro', 'Max', ''], 'tier labels');
eq(usage.dayOf('2026-02-28T12:00:00Z', U), 'Feb 28', 'a day');
eq(usage.dayOf(null), '', 'no day for none');
eq([usage.UPGRADE_URL, usage.ACCOUNT_URL, usage.SIGNUP_URL], ['https://occlara.app/pricing', 'https://occlara.app/account', 'https://occlara.app/signup'], 'the pages Upgrade, Manage plan and Create a free account open');

console.log('\n[usage] the copy');
const DASH = new RegExp('[\\u2013\\u2014]');
ok(DASH.test(`a ${String.fromCharCode(0x2014)} b`) &&!DASH.test('a, b'), 'the dash check finds a dash and passes a comma');
ok(lines.length > 20 && lines.every((s) => typeof s === 'string' && s && !DASH.test(s)), 'no em or en dash in any line', lines.filter((s) => DASH.test(s)).join(' | '));
const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'src', 'shared', 'usage.js'), 'utf8');
ok(!DASH.test(src), 'nor anywhere in usage.js');

console.log(`\n[usage] ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

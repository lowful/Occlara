'use strict';

/**
 * Games against an account: claim_game, settle_game, ensure_entitlement and
 * account_state, as the 8.7 migration defines them.
 *
 * The server tests exercise the accounts through scripts/fixtures/fake-billing.js,
 * so the fake must do what the SQL does. This drives the fake through every
 * rule of the contract:
 *
 *   Free 2 games for life, then refused; 4 when invited
 *   Pro 25 a month, the month stepped from the anchor, a new month gives 25 again
 *   Max 70 a month
 *   the bonus pool used after the allowance, given back when its game is refunded
 *   the same client_match_id answered with the same row, even claimed at once
 *   a live claim with no client id reuses the open live row
 *   a live row reserved over 3 hours refunded (stale), or counted at 120 reads
 *   refunds capped at 3 in 24 hours (refund-cap)
 *   free games refused (device) for a second account on a device that used them
 *   shadow mode (p_enforce false) grants everything and marks over_cap
 *   a referral qualifies on the invitee's counted game, 4 games up to 20, never
 *   on the inviter's own device
 *   the payer rules (and backfill-entitlements.js, which shares them)
 *   before the migration: PGRST205 and PGRST202, accounts not live
 *
 * And it reads the migration's SQL text and checks it defines every table,
 * function, RLS setting and grant the contract names. The SQL lives in the
 * site repo: OCCLARA_SITE_DIR names it, or a sibling checkout is looked for;
 * without one that part says SKIP.
 *
 * Run: npm run test:claimgame
 */

const fs = require('fs');
const path = require('path');
const { makeSupabase, entitlementPeriod, addMonthsUTC, ACCOUNT_TABLES } = require('./fixtures/fake-billing');
const { mapLicences, backfill } = require('../server/scripts/backfill-entitlements');
const { FREE_GAMES, INVITE_EXTRA_GAMES } = require('../server/services/caller');
const { LIMITS: { INVITED_FREE_TOTAL } } = require('../server/routes/usage');

let fails = 0;
let checks = 0;
const ok = (cond, what) => {
  checks++;
  if (!cond) { fails++; console.log(`FAIL  ${what}`); } else console.log(`ok    ${what}`);
};

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const T0 = Date.UTC(2026, 10, 4, 12, 0, 0);
const KEY_RE = /^GC-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/;
ok(KEY_RE.test('GC-AB12-CD34-EF56-GH78') && !KEY_RE.test('GC-AB12-CD34-EF56'), 'the key pattern matches a known key and refuses a short one');

let n = 0;
const user = () => `00000000-0000-4000-9000-${String(++n).padStart(12, '0')}`;
const sb = makeSupabase();
const fresh = (extra = {}) => sb.reset({ accounts: true, now: T0, ...extra });
const rpc = async (name, args) => {
  const { data, error } = await sb.rpc(name, args);
  if (error) throw Object.assign(new Error(`${name}: ${error.code} ${error.message}`), { pg: error });
  return data;
};
const claim = (p_user, o = {}) => rpc('claim_game', {
  p_user, p_game: o.game || 'valorant', p_kind: o.kind || 'riot',
  p_client_match_id: o.id === undefined ? `m-${Math.random().toString(36).slice(2)}` : o.id,
  p_device_hash: o.device === undefined ? null : o.device, p_enforce: o.enforce === undefined ? true : o.enforce,
});
const settle = (p_usage, p_outcome, p_reason = null) => rpc('settle_game', { p_usage, p_outcome, p_reason });
const state = (p_user) => rpc('account_state', { p_user });
const rows = (u) => sb._db.tables.game_usage.filter((g) => g.user_id === u);
const ent = (u) => sb._db.tables.entitlements.find((e) => e.user_id === u);
const lic = (u, plan, extra = {}) => ({ user_id: u, license_key: `GC-${plan.slice(0, 4).toUpperCase().padEnd(4, 'X')}-AAAA-BBBB-${String(n).padStart(4, '0')}`,
  plan, status: 'active', expires_at: null, created_at: new Date(T0 - 10 * DAY).toISOString(), ...extra });

async function main() {
  // ── The period: whole months from the anchor, in UTC ─────────────────────
  {
    const jan31 = Date.UTC(2026, 0, 31, 9);
    ok(new Date(addMonthsUTC(jan31, 1)).toISOString() === '2026-02-28T09:00:00.000Z'
      && new Date(addMonthsUTC(jan31, 2)).toISOString() === '2026-03-31T09:00:00.000Z',
      'a month step past a short month lands on its last day, and the next is counted from the anchor');
    const p = entitlementPeriod(jan31, Date.UTC(2026, 2, 30));
    ok(p.start === addMonthsUTC(jan31, 1) && p.end === addMonthsUTC(jan31, 2), 'the period is the latest step not after now');
    const q = entitlementPeriod(jan31, Date.UTC(2026, 2, 31, 9));
    ok(q.start === Date.UTC(2026, 2, 31, 9), 'a step landing exactly on now starts the new period');
    const r = entitlementPeriod(Date.UTC(2026, 5, 15), Date.UTC(2026, 3, 1));
    ok(r.start <= Date.UTC(2026, 3, 1) && r.end > Date.UTC(2026, 3, 1), 'an anchor in the future steps back');
  }

  // ── Free: 2 for life, then refused ───────────────────────────────────────
  {
    ok(FREE_GAMES === 2 && INVITE_EXTRA_GAMES === 2, 'Free is 2 games for life, and an invite adds 2');
    fresh();
    const u = user();
    const a = await claim(u);
    const b = await claim(u);
    const c = await claim(u);
    ok(a.granted && b.granted && [a.left, b.left].join() === '1,0',
      'a free account gets 2 games, left 1, 0');
    ok(!c.granted && c.reason === 'cap' && c.left === 0 && c.usage_id === null, 'the third is refused, reason cap');
    ok(rows(u).length === 2 && rows(u).every((g) => g.source === 'free' && g.status === 'counted'),
      'a riot claim is counted at once, from the free games');
    const s = await state(u);
    ok(s.tier === 'free' && s.used === 2 && s.left === 0 && s.period_end === null && s.free_total === 2,
      'account_state says free, 2 used, none left, no period end');
    const l = sb._db.rows.find((r) => r.user_id === u);
    ok(l && l.plan === 'free' && l.status === 'active' && l.expires_at === null && KEY_RE.test(l.license_key)
      && ent(u).account_key === l.license_key && s.account_key === l.license_key,
      'a new account mints a free licence, and its key is the account key');
    sb.advance(400 * DAY);
    ok(!(await claim(u)).granted, 'free games do not come back with time');
  }

  // ── Invited: 4 ───────────────────────────────────────────────────────────
  {
    fresh();
    const u = user();
    await rpc('ensure_entitlement', { p_user: u });
    const { error } = await sb.from('entitlements').update({ free_total: INVITED_FREE_TOTAL }).eq('user_id', u);
    ok(!error && INVITED_FREE_TOTAL === 4, 'the redeem route can set free_total 4 (2 free and 2 from the invite)');
    const got = [];
    for (let i = 0; i < 5; i++) got.push((await claim(u)).granted);
    ok(got.join() === 'true,true,true,true,false', 'an invited account gets 4 games, then refused');
  }

  // ── Pro: 25 a month, a new month gives 25 again ──────────────────────────
  {
    const u = user();
    const anchor = new Date(Date.UTC(2026, 9, 20, 8)).toISOString();
    fresh({ rows: [lic(u, 'monthly', { created_at: anchor, stripe_subscription_id: 'sub_P', expires_at: new Date(T0 + 40 * DAY).toISOString() })] });
    const e = await rpc('ensure_entitlement', { p_user: u });
    ok(e.tier === 'pro' && e.cap_monthly === 25 && e.source === 'legacy_monthly' && e.period_anchor === anchor
      && e.stripe_subscription_id === 'sub_P' && e.renew_as === null, 'a monthly payer is Pro, 25 a month, anchored on the licence');
    let granted = 0;
    let last;
    for (let i = 0; i < 26; i++) { last = await claim(u); if (last.granted) granted++; }
    ok(granted === 25 && !last.granted && last.reason === 'cap', 'Pro gets 25 games in the month, the 26th is refused');
    const s = await state(u);
    ok(s.used === 25 && s.left === 0 && s.period_start === '2026-10-20T08:00:00.000Z' && s.period_end === '2026-11-20T08:00:00.000Z',
      'account_state gives the period from the anchor, Oct 20 to Nov 20');
    ok(rows(u).every((g) => g.period_start === '2026-10-20T08:00:00.000Z' && g.source === 'allowance'),
      'each row records its period start and the allowance');
    sb.setNow(Date.UTC(2026, 10, 20, 8));
    const next = await claim(u);
    const s2 = await state(u);
    ok(next.granted && next.left === 24 && s2.used === 1 && s2.period_start === '2026-11-20T08:00:00.000Z',
      'at the month step the allowance rolls over: granted, 24 left');
    ok(rows(u).filter((g) => g.source === 'free').length === 0 && s2.free_total === FREE_GAMES, 'Pro games never eat the free games');
  }

  // ── Max: 70 ──────────────────────────────────────────────────────────────
  {
    const u = user();
    fresh({ rows: [lic(u, 'lifetime')] });
    let granted = 0;
    let last;
    for (let i = 0; i < 71; i++) { last = await claim(u); if (last.granted) granted++; }
    ok(granted === 70 && !last.granted, 'Max (a lifetime payer) gets 70 games a month, the 71st is refused');
    ok(ent(u).tier === 'max' && ent(u).source === 'legacy_lifetime' && ent(u).renew_as === null, 'lifetime is Max for life');
  }

  // ── Bonus pool: after the allowance, returned on refund ──────────────────
  {
    fresh();
    const u = user();
    await rpc('ensure_entitlement', { p_user: u });
    await sb.from('entitlements').update({ bonus_pool: 2, free_total: 1 }).eq('user_id', u);
    const a = await claim(u, { kind: 'live', id: null });
    ok(a.granted && rows(u)[0].source === 'free' && a.left === 2, 'the allowance is used before the bonus pool');
    await settle(a.usage_id, 'counted');
    const b = await claim(u, { kind: 'live', id: null });
    ok(b.granted && rows(u)[1].source === 'bonus' && ent(u).bonus_pool === 1 && b.left === 1,
      'then the bonus pool, one game taken from it');
    const r = await settle(b.usage_id, 'refunded', 'short');
    ok(r.status === 'refunded' && r.changed && ent(u).bonus_pool === 2, 'a refunded bonus game goes back to the pool');
    const again = await settle(b.usage_id, 'refunded', 'short');
    ok(!again.changed && ent(u).bonus_pool === 2, 'settling again changes nothing (idempotent)');
    const late = await settle(b.usage_id, 'counted');
    ok(!late.changed && late.status === 'refunded', 'a refunded game is never counted afterwards');
    const s = await state(u);
    ok(s.left === 2 && s.bonus_pool === 2 && s.allowance_left === 0, 'account_state: left is the allowance plus the pool');
  }

  // ── Idempotent client_match_id ───────────────────────────────────────────
  {
    fresh();
    const u = user();
    const a = await claim(u, { id: 'EU1_123', kind: 'league', game: 'lol' });
    const b = await claim(u, { id: 'EU1_123', kind: 'league', game: 'lol' });
    ok(a.granted && b.granted && a.usage_id === b.usage_id && b.reason === 'existing' && rows(u).length === 1,
      'the same client_match_id answers the same row, reason existing');
    const many = await Promise.all([1, 2, 3, 4].map(() => claim(u, { id: 'riot-77' })));
    ok(new Set(many.map((x) => x.usage_id)).size === 1 && rows(u).length === 2, 'four claims at once of one match make one row');
    const { error } = await sb.from('game_usage').insert({ user_id: u, game: 'valorant', kind: 'riot', client_match_id: 'riot-77', source: 'free' });
    ok(error && error.code === '23505' && /game_usage_user_client_match_key/.test(error.message),
      'the unique (user_id, client_match_id) holds for a direct insert too');
    const other = user();
    ok((await claim(other, { id: 'riot-77' })).granted, 'another account may claim the same match id');
  }

  // ── Open live row reused, stale refunded after 3 h ───────────────────────
  {
    fresh();
    const u = user();
    const a = await claim(u, { kind: 'live', id: null });
    sb.advance(2 * HOUR);
    const b = await claim(u, { kind: 'live', id: null });
    ok(a.granted && b.usage_id === a.usage_id && b.reason === 'open' && rows(u).length === 1,
      'a live claim with no client id reuses the open live row younger than 3 h');
    const lolLive = await claim(u, { kind: 'live', id: null, game: 'lol' });
    ok(lolLive.usage_id !== a.usage_id, 'but not across games');
    sb.advance(1.5 * HOUR);
    const c = await claim(u, { kind: 'live', id: null });
    const old = rows(u).find((g) => g.id === a.usage_id);
    ok(c.usage_id !== a.usage_id && old.status === 'refunded' && old.reason === 'stale' && old.settled_at,
      'after 3 h the open row is refunded (stale) and a new one is made');
    ok(c.granted && c.left === 0, 'the stale refund gave its free game back: the new one is granted from it');
  }
  {
    fresh();
    const u = user();
    const a = await claim(u, { kind: 'live', id: null });
    const row = rows(u)[0];
    await sb.from('game_usage').update({ match_reads: 120 }).eq('id', row.id);
    sb.advance(4 * HOUR);
    await claim(u, { kind: 'live', id: null });
    ok(rows(u).find((g) => g.id === a.usage_id).status === 'counted' && rows(u).find((g) => g.id === a.usage_id).reason === 'reads',
      'a stale row that reached 120 match reads is counted, not refunded');
  }

  // ── Refund cap: 3 in 24 hours ────────────────────────────────────────────
  {
    fresh();
    const u = user();
    await rpc('ensure_entitlement', { p_user: u });
    await sb.from('entitlements').update({ free_total: 10 }).eq('user_id', u);
    const outs = [];
    for (let i = 0; i < 4; i++) {
      const c = await claim(u, { kind: 'live', id: `live-${i}` });
      outs.push(await settle(c.usage_id, 'refunded', 'short'));
    }
    ok(outs.slice(0, 3).every((o) => o.status === 'refunded') && outs[3].status === 'counted' && outs[3].reason === 'refund-cap',
      'the fourth refund in 24 h is counted, reason refund-cap');
    sb.advance(25 * HOUR);
    const c = await claim(u, { kind: 'live', id: 'live-next' });
    ok((await settle(c.usage_id, 'refunded')).status === 'refunded', 'a day later refunds are allowed again');
  }

  // ── Device: free games refused for a second account ──────────────────────
  {
    fresh();
    const a = user();
    const b = user();
    const pro = user();
    sb._db.rows.push(Object.assign(Object.fromEntries([...sb._db.columns].map((c) => [c, null])),
      lic(pro, 'monthly', { id: 'lic-pro' })));
    ok((await claim(a, { device: 'dev-1' })).granted, 'the first account plays a free game on the device');
    const r = await claim(b, { device: 'dev-1' });
    ok(!r.granted && r.reason === 'device' && r.left === 0, 'a second free account on that device is refused, reason device');
    ok((await claim(b, { device: 'dev-2' })).granted, 'the second account on its own device plays');
    ok((await claim(pro, { device: 'dev-1' })).granted, 'a paid account on the device is never refused for it');
    const c = user();
    await rpc('ensure_entitlement', { p_user: c });
    await sb.from('entitlements').update({ bonus_pool: 1 }).eq('user_id', c);
    const viaBonus = await claim(c, { device: 'dev-1' });
    ok(viaBonus.granted && rows(c)[0].source === 'bonus', 'the bonus pool still plays on a refused device');
    await claim(pro, { device: 'dev-9' });
    const dev = sb._db.tables.devices.find((d) => d.device_hash === 'dev-9');
    ok(dev.first_user_id === pro && dev.free_used === false, 'a paid game marks the device seen, not its free games used');
    const pfree = user();
    ok((await claim(pfree, { device: 'dev-9' })).granted, 'so a free account may use free games on it');
    ok(dev.first_user_id === pfree && dev.free_used === true, 'and the device\'s free games are now that account\'s');
    ok(!(await claim(user(), { device: 'dev-9' })).granted, 'a third account is refused there');
  }

  // ── Shadow: p_enforce false grants and marks over_cap ────────────────────
  {
    fresh();
    const u = user();
    for (let i = 0; i < FREE_GAMES; i++) await claim(u, { enforce: false });
    const s = await claim(u, { enforce: false });
    const row = rows(u).find((g) => g.id === s.usage_id);
    ok(s.granted && s.reason === 'cap' && row.source === 'shadow' && row.over_cap === true,
      'in shadow mode a game past the cap is granted, source shadow, over_cap');
    ok(rows(u).filter((g) => !g.over_cap).length === FREE_GAMES, 'the games within the allowance are not over cap');
    const v = user();
    const w = user();
    await claim(v, { device: 'dev-s', enforce: false });
    const d = await claim(w, { device: 'dev-s', enforce: false });
    ok(d.granted && d.reason === 'device' && rows(w)[0].over_cap, 'a device refusal in shadow mode is granted and marked');
  }

  // ── Referral: 4 games each, up to 20, not on the inviter's device ────────
  {
    fresh();
    const inviter = user();
    await rpc('ensure_entitlement', { p_user: inviter });
    await sb.from('app_sessions').insert({ user_id: inviter, token_hash: 'th-1', device_hash: 'dev-inviter' });
    await sb.from('referral_codes').insert({ user_id: inviter, code: 'ABC123' });
    const invitees = Array.from({ length: 6 }, () => user());
    for (const v of invitees) {
      const { error } = await sb.from('referral_redemptions').insert({ invitee_id: v, inviter_id: inviter, code: 'ABC123' });
      ok(!error, 'a pending redemption is written');
    }
    const self = invitees[0];
    await claim(self, { device: 'dev-inviter' });
    const red = (v) => sb._db.tables.referral_redemptions.find((r) => r.invitee_id === v);
    ok(red(self).status === 'refused' && red(self).reason === 'inviter-device' && ent(inviter).bonus_pool === 0,
      'an invitee playing on the inviter\'s own device earns nothing (refused)');
    const live = await claim(invitees[1], { kind: 'live', id: null, device: 'dev-v1' });
    ok(red(invitees[1]).status === 'pending', 'a reserved live game does not qualify yet');
    await settle(live.usage_id, 'counted');
    ok(red(invitees[1]).status === 'qualified' && ent(inviter).bonus_pool === 4 && ent(inviter).bonus_earned === 4,
      'the invitee\'s counted game qualifies: 4 games to the inviter');
    await claim(invitees[1], { device: 'dev-v1' });
    ok(ent(inviter).bonus_pool === 4, 'only the first counted game qualifies');
    for (let i = 2; i < 6; i++) await claim(invitees[i], { device: `dev-v${i}` });
    ok(ent(inviter).bonus_earned === 20 && ent(inviter).bonus_pool === 20, 'five friends earn 20, the most there is');
    const seventh = user();
    await sb.from('referral_redemptions').insert({ invitee_id: seventh, inviter_id: inviter, code: 'ABC123' });
    await claim(seventh, { device: 'dev-v7' });
    ok(ent(inviter).bonus_earned === 20 && red(seventh).status === 'qualified' && red(seventh).reason === 'max-earned',
      'past 20 earned nothing more is added');
    const noDev = user();
    await sb.from('referral_redemptions').insert({ invitee_id: noDev, inviter_id: inviter, code: 'ABC123' });
    await claim(noDev);
    ok(red(noDev).status === 'pending', 'a game with no device leaves the redemption pending');
    const s = await state(inviter);
    ok(s.invites.qualified === 6 && s.invites.refused === 1 && s.invites.pending === 1 && s.invites.total === 8,
      'account_state counts the invites by status');
    const used = (await claim(inviter)).left;
    ok(used === (FREE_GAMES - 1) + 20, 'the inviter\'s left is the free games plus the pool');
  }

  // ── A refund or a dispute ended the account: no games come back ──────────
  // (ENDED_ACCOUNT in webhook.js: tier free, free_total 0, bonus_pool 0, ended.)
  const endAccount = (u) => sb.from('entitlements')
    .update({ tier: 'free', cap_monthly: 0, free_total: 0, bonus_pool: 0, status: 'ended' }).eq('user_id', u);
  {
    fresh();
    const inviter = user();
    const friend = user();
    await rpc('ensure_entitlement', { p_user: inviter });
    await sb.from('referral_redemptions').insert({ invitee_id: friend, inviter_id: inviter, code: 'ENDED1' });
    await endAccount(inviter);
    await claim(friend, { device: 'dev-friend' });
    const red = sb._db.tables.referral_redemptions.find((r) => r.invitee_id === friend);
    ok(red.status === 'qualified' && red.reason === 'inviter-ended' && ent(inviter).bonus_pool === 0
      && ent(inviter).bonus_earned === 0, 'an invitee\'s game earns an ended inviter nothing (qualified, inviter-ended)');
    await sb.from('entitlements').update({ bonus_pool: 2 }).eq('user_id', inviter);
    const refused = await claim(inviter, { device: 'dev-inviter-own' });
    ok(!refused.granted && refused.reason === 'cap', 'an ended account is refused even with a bonus pool');
    const shadow = await claim(inviter, { device: 'dev-inviter-own', enforce: false });
    ok(shadow.granted && rows(inviter).slice(-1)[0].source === 'shadow' && ent(inviter).bonus_pool === 2,
      'and in shadow its game is shadow, never taken from the bonus pool');
  }
  {
    fresh();
    const u = user();
    await rpc('ensure_entitlement', { p_user: u });
    await sb.from('entitlements').update({ bonus_pool: 2, free_total: 0 }).eq('user_id', u);
    const a = await claim(u, { kind: 'live', id: null, device: 'dev-b' });
    const b = await claim(u, { kind: 'live', id: null, device: 'dev-c' });
    ok(rows(u)[0].source === 'bonus' && rows(u)[1].source === 'bonus' && ent(u).bonus_pool === 0, 'two bonus games reserved');
    await endAccount(u);
    await settle(a.usage_id, 'refunded', 'short');
    ok(rows(u)[0].status === 'refunded' && ent(u).bonus_pool === 0,
      'a bonus game refunded after a refund ended the account does not refill the pool');
    sb.advance(4 * HOUR);
    await state(u);
    ok(rows(u)[1].status === 'refunded' && rows(u)[1].reason === 'stale' && ent(u).bonus_pool === 0,
      'nor does one refunded stale');
    ok(b.usage_id && !(await claim(u, { device: 'dev-b' })).granted, 'so the ended account has nothing to play');
  }

  // ── Only a real game qualifies an invite, never a shadow one ─────────────
  {
    fresh();
    const inviter = user();
    const other = user();
    const friend = user();
    await rpc('ensure_entitlement', { p_user: inviter });
    await claim(other, { device: 'dev-shared' });
    await sb.from('referral_redemptions').insert({ invitee_id: friend, inviter_id: inviter, code: 'SHADOW' });
    const g = await claim(friend, { device: 'dev-shared', enforce: false });
    const red = sb._db.tables.referral_redemptions.find((r) => r.invitee_id === friend);
    ok(g.granted && g.reason === 'device' && rows(friend)[0].over_cap, 'the friend\'s device blocked game is granted in shadow');
    ok(red.status === 'pending' && ent(inviter).bonus_pool === 0, 'and qualifies nothing: enforcement would have refused it');
    const live = await claim(friend, { kind: 'live', id: null, device: 'dev-shared', enforce: false });
    await settle(live.usage_id, 'counted', 'review');
    ok(red.status === 'pending' && ent(inviter).bonus_pool === 0, 'nor does a shadow live game counted by settle_game');
    await claim(friend, { device: 'dev-friend-own' });
    ok(red.status === 'qualified' && ent(inviter).bonus_pool === 4, 'a real free game on the friend\'s own device does');
  }

  // ── The inviter's own device, known without an app session ───────────────
  {
    fresh();
    const inviter = user();
    const alt = user();
    await rpc('ensure_entitlement', { p_user: inviter });
    await sb.from('entitlements').update({ tier: 'pro', cap_monthly: 25 }).eq('user_id', inviter);
    await claim(inviter, { device: 'dev-home' });
    await sb.from('referral_redemptions').insert({ invitee_id: alt, inviter_id: inviter, code: 'KEYONLY' });
    const g = await claim(alt, { device: 'dev-home' });
    const red = sb._db.tables.referral_redemptions.find((r) => r.invitee_id === alt);
    ok(g.granted && red.status === 'refused' && red.reason === 'inviter-device' && ent(inviter).bonus_pool === 0,
      'an alt on the device the inviter\'s games were first claimed on is refused, with no app session');
  }
  {
    fresh();
    const inviter = user();
    const alt = user();
    const crypto = require('crypto');
    await sb.from('licenses').insert(lic(inviter, 'monthly', { device_id: 'raw-device-7' }));
    await rpc('ensure_entitlement', { p_user: inviter });
    await sb.from('referral_redemptions').insert({ invitee_id: alt, inviter_id: inviter, code: 'KEYDEV' });
    const hashed = crypto.createHash('sha256').update('raw-device-7').digest('hex');
    await claim(alt, { device: hashed });
    const red = sb._db.tables.referral_redemptions.find((r) => r.invitee_id === alt);
    ok(red.status === 'refused' && red.reason === 'inviter-device',
      'an alt on the device the inviter\'s licence key is activated on is refused');
  }

  // ── One account on two PCs at once: two games ────────────────────────────
  {
    fresh();
    const u = user();
    await rpc('ensure_entitlement', { p_user: u });
    await sb.from('entitlements').update({ tier: 'pro', cap_monthly: 25 }).eq('user_id', u);
    const a = await claim(u, { kind: 'live', id: null, device: 'pc-a' });
    const b = await claim(u, { kind: 'live', id: null, device: 'pc-b' });
    const a2 = await claim(u, { kind: 'live', id: null, device: 'pc-a' });
    ok(a.usage_id !== b.usage_id && a2.usage_id === a.usage_id && a2.reason === 'open' && rows(u).length === 2,
      'the open live row is reused per device: two PCs at once are two games');
  }

  // ── account_state settles a stale reserved row, so left is right ─────────
  {
    fresh();
    const u = user();
    await claim(u);
    await claim(u, { kind: 'live', id: null, device: 'dev-r' });
    ok((await state(u)).left === 0, 'one counted and one reserved: none left');
    sb.advance(4 * HOUR);
    const s = await state(u);
    ok(s.left === 1 && rows(u)[1].status === 'refunded' && rows(u)[1].reason === 'stale',
      'past 3 h account_state gives the stale game back (no claim needed)');
  }

  // ── release_game: a Riot record game given back ──────────────────────────
  {
    fresh();
    const u = user();
    // Three games to play with: an invite's worth past the Free tier's own.
    await rpc('ensure_entitlement', { p_user: u });
    await sb.from('entitlements').update({ free_total: 3 }).eq('user_id', u);
    await claim(u, { id: 'riot:1' });
    await claim(u, { id: 'riot:2' });
    await claim(u, { kind: 'live', id: null, device: 'dev-l' });
    ok((await state(u)).left === 0, 'three games used');
    const r = await rpc('release_game', { p_user: u, p_client_match_id: 'riot:1' });
    ok(r.changed && r.status === 'refunded' && r.reason === 'taken-back' && (await state(u)).left === 1,
      'releasing a counted riot game gives it back');
    ok(!(await rpc('release_game', { p_user: u, p_client_match_id: 'riot:1' })).changed, 'releasing it again changes nothing');
    const liveRow = rows(u)[2];
    await settle(liveRow.id, 'counted', 'review');
    await sb.from('game_usage').update({ client_match_id: 'live-x' }).eq('id', liveRow.id);
    ok(!(await rpc('release_game', { p_user: u, p_client_match_id: 'live-x' })).changed, 'a live game is never released');
    ok(!(await rpc('release_game', { p_user: user(), p_client_match_id: 'riot:2' })).changed, 'nor another account\'s');
    ok((await rpc('release_game', { p_user: u, p_client_match_id: 'nope' })).reason === 'none', 'an unknown id is none');
    const v = user();
    for (let i = 0; i < 5; i++) await claim(v, { id: `riot:v${i}`, enforce: false });
    const out = [];
    for (let i = 0; i < 5; i++) out.push(await rpc('release_game', { p_user: v, p_client_match_id: `riot:v${i}` }));
    ok(out.filter((x) => x.changed).length === 3 && out[3].reason === 'refund-cap',
      'releases share the refund cap: 3 in 24 hours');
  }

  // ── The payer rules ──────────────────────────────────────────────────────
  {
    const now = T0;
    const iso = (d) => new Date(now + d * DAY).toISOString();
    const L = (plan, extra = {}) => ({ user_id: 'u', license_key: `GC-${plan[0].toUpperCase()}AAA-AAAA-AAAA-AAAA`, plan,
      status: 'active', expires_at: plan === 'lifetime' ? null : iso(20), created_at: iso(-30), ...extra });
    const w = mapLicences([L('weekly')], now);
    ok(w.tier === 'pro' && w.cap_monthly === 25 && w.source === 'legacy_weekly' && w.renew_as === null, 'weekly is Pro');
    const y = mapLicences([L('yearly', { stripe_subscription_id: 'sub_Y' })], now);
    ok(y.tier === 'max' && y.cap_monthly === 70 && y.renew_as === 'pro_yearly' && y.stripe_subscription_id === 'sub_Y',
      'yearly is Max until renewal, then renews as Pro yearly');
    const pf = mapLicences([L('monthly', { status: 'payment_failed' })], now);
    ok(pf.tier === 'pro', 'a payment_failed licence in its grace is still a payer');
    const exp = mapLicences([L('monthly', { expires_at: iso(-1) })], now);
    ok(exp.tier === 'free' && exp.free_total === FREE_GAMES && exp.account_key === L('monthly').license_key && !exp.mintFree,
      'an expired payer is free, keeping their key as the account key');
    const ref = mapLicences([L('lifetime', { status: 'refunded', expires_at: iso(-1) })], now);
    ok(ref.tier === 'free' && ref.free_total === 0 && ref.status === 'ended', 'a refunded payer has no free games');
    const best = mapLicences([L('monthly', { created_at: iso(-1) }), L('lifetime', { created_at: iso(-100) }), L('weekly')], now);
    ok(best.source === 'legacy_lifetime', 'the best live licence decides: lifetime over monthly');
    const none = mapLicences([], now);
    ok(none.tier === 'free' && none.mintFree && none.account_key === null, 'no licence at all mints a free key');

    // The fake's ensure_entitlement follows the same rules.
    const u = user();
    fresh({ rows: [lic(u, 'yearly', { expires_at: new Date(T0 + 100 * DAY).toISOString(), stripe_subscription_id: 'sub_YY' })] });
    const e = await rpc('ensure_entitlement', { p_user: u });
    ok(e.tier === 'max' && e.renew_as === 'pro_yearly' && e.account_key === sb._db.rows[0].license_key
      && sb._db.rows.length === 1, 'ensure_entitlement maps a yearly payer, using their licence key, minting nothing');
    await sb.from('entitlements').update({ tier: 'pro' }).eq('user_id', u);
    ok((await rpc('ensure_entitlement', { p_user: u })).tier === 'pro', 'an existing entitlement is returned as it is');
  }

  // ── Constraints, rollbacks and the database before the migration ─────────
  {
    fresh({ authUsers: [] });
    const r = await sb.rpc('claim_game', { p_user: user(), p_game: 'valorant', p_kind: 'live', p_enforce: true });
    ok(r.error && r.error.code === '23503' && sb._db.rows.length === 0 && sb._db.tables.entitlements.length === 0,
      'an unknown user is the foreign key error, and nothing is left half written');
    fresh();
    const bad = await sb.rpc('claim_game', { p_user: user(), p_game: 'rivals', p_kind: 'live' });
    ok(bad.error && bad.error.code === 'P0001' && sb._db.tables.game_usage.length === 0, 'an unknown game raises, writing nothing');
    const chk = await sb.from('entitlements').insert({ user_id: user(), tier: 'gold' });
    ok(chk.error && chk.error.code === '23514', 'the tier CHECK refuses an unknown tier');
    const free = await sb.from('licenses').insert({ user_id: user(), license_key: 'GC-FREE-0000-0000-0001', plan: 'free' });
    ok(!free.error, 'with the migration a licence may be plan free');

    sb.reset({ now: T0 });
    const t = await sb.from('entitlements').select('*').eq('user_id', user()).maybeSingle();
    const f = await sb.rpc('account_state', { p_user: user() });
    ok(t.error && t.error.code === 'PGRST205' && f.error && f.error.code === 'PGRST202',
      'before the migration a table is PGRST205 and a function PGRST202');
    const old = await sb.from('licenses').insert({ user_id: user(), license_key: 'GC-FREE-0000-0000-0002', plan: 'free' });
    ok(old.error && old.error.code === '23514', 'and plan free is refused by the old CHECK');
    ok(Object.keys(ACCOUNT_TABLES).length === 7, 'the fake models seven account tables');
  }

  // ── backfill-entitlements.js ─────────────────────────────────────────────
  {
    const a = user();
    const b = user();
    const c = user();
    fresh({ rows: [lic(a, 'monthly', { expires_at: new Date(T0 + 9 * DAY).toISOString() }), lic(b, 'lifetime'),
      lic(c, 'weekly', { status: 'refunded', expires_at: new Date(T0 - DAY).toISOString() })] });
    const lines = [];
    const dry = await backfill(sb, { now: T0, log: (l) => lines.push(l) });
    ok(dry.planned.length === 3 && sb._db.tables.entitlements.length === 0 && sb._db.rpcCalls.length === 0,
      'the backfill is a dry run by default: it lists 3 and writes nothing');
    ok(!lines.join('\n').includes(sb._db.rows[0].license_key), 'and never prints a key whole');
    const applied = await backfill(sb, { apply: true, now: T0, log: () => {} });
    ok(applied.created.length === 3 && applied.failed.length === 0 && ent(a).tier === 'pro' && ent(b).tier === 'max'
      && ent(c).tier === 'free' && ent(c).free_total === 0, '--apply creates each by the payer rules');
    const again = await backfill(sb, { apply: true, now: T0, log: () => {} });
    ok(again.planned.length === 0 && again.existing === 3 && sb._db.tables.entitlements.length === 3,
      'run again it creates nothing (idempotent)');
    sb.reset({ now: T0, rows: [lic(a, 'monthly')] });
    let threw = null;
    try { await backfill(sb, { log: () => {} }); } catch (e) { threw = e; }
    ok(threw && /does not exist/.test(threw.message), 'before the migration it stops and says so');
  }

  // ── The migration's SQL defines what the contract names ──────────────────
  {
    const candidates = [process.env.OCCLARA_SITE_DIR, path.join(__dirname, '..', '..', 'ghostcoach-9a45ac05'),
      path.join(__dirname, '..', '..', 'occlara-site')].filter(Boolean);
    // The site keeps it as a Supabase migration or, since Lovable applies it,
    // as drizzle's 0004: either name in either folder is taken.
    const MIGRATION_DIRS = [['supabase', 'migrations'], ['drizzle', 'migrations']];
    const isAccountsSql = (f) => /accounts_tiers_referral\.sql$/.test(f);
    ok(isAccountsSql('0004_accounts_tiers_referral.sql') && isAccountsSql('20261104000000_accounts_tiers_referral.sql')
      && !isAccountsSql('0005_free_two.sql'), 'the migration name pattern matches both known names and nothing else');
    const file = candidates.flatMap((d) => MIGRATION_DIRS.map((m) => path.join(d, ...m)))
      .filter((dir) => fs.existsSync(dir))
      .flatMap((dir) => fs.readdirSync(dir).filter(isAccountsSql).sort().map((f) => path.join(dir, f)))[0];
    if (!file) {
      console.log('SKIP  the migration SQL was not found (set OCCLARA_SITE_DIR to the site repo to check it)');
    } else {
      const sql = fs.readFileSync(file, 'utf8');
      const body = (fn) => {
        const m = sql.match(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${fn}\\([\\s\\S]*?\\$function\\$([\\s\\S]*?)\\$function\\$`));
        return m ? m[1] : '';
      };
      ok(/CREATE OR REPLACE FUNCTION public\.claim_game\(/.test('CREATE OR REPLACE FUNCTION public.claim_game('), 'the function pattern matches a known definition');
      for (const t of Object.keys(ACCOUNT_TABLES)) {
        ok(new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${t} \\(`).test(sql), `the SQL creates ${t}`);
        ok(new RegExp(`ALTER TABLE public\\.${t} ENABLE ROW LEVEL SECURITY`).test(sql), `and turns RLS on for ${t}`);
        ok(new RegExp(`REVOKE ALL ON public\\.${t} FROM anon, authenticated`).test(sql), `and revokes ${t} from anon and authenticated`);
        const table = sql.match(new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${t} \\(([\\s\\S]*?)\\n\\);`));
        const missing = Object.keys(ACCOUNT_TABLES[t].columns).filter((c) => !new RegExp(`\\n\\s+${c} `).test(table ? table[1] : ''));
        ok(table && missing.length === 0, `${t} has every column the fake models${missing.length ? ` (missing ${missing.join(', ')})` : ''}`);
      }
      const policies = [...sql.matchAll(/CREATE POLICY "[^"]+"\s+ON public\.(\w+) FOR (\w+)/g)].map((m) => `${m[1]}:${m[2]}`);
      ok(policies.sort().join() === 'entitlements:SELECT,game_usage:SELECT', 'the only policies are SELECT on entitlements and game_usage');
      const sigs = {
        ensure_entitlement: ['p_user uuid'],
        claim_game: ['p_user uuid', 'p_game text', 'p_kind text', 'p_client_match_id text', 'p_device_hash text', 'p_enforce boolean'],
        settle_game: ['p_usage uuid', 'p_outcome text', 'p_reason text'],
        account_state: ['p_user uuid'],
      };
      for (const [fn, params] of Object.entries(sigs)) {
        const head = sql.match(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${fn}\\(([\\s\\S]*?)\\)\\s*RETURNS`));
        ok(head && params.every((p) => head[1].includes(p)), `the SQL defines ${fn}(${params.map((p) => p.split(' ')[0]).join(', ')})`);
        ok(new RegExp(`FUNCTION public\\.${fn}\\([^)]*\\)[\\s\\S]*?SECURITY DEFINER`).test(sql), `${fn} is security definer`);
        ok(new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn}\\([^)]*\\) TO service_role;`).test(sql)
          && new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}\\([^)]*\\) FROM PUBLIC, anon, authenticated;`).test(sql),
          `${fn} is executable by service_role only`);
      }
      const cg = body('claim_game');
      ok(/FROM public\.entitlements WHERE user_id = p_user FOR UPDATE/.test(cg) && /FROM public\.devices WHERE device_hash = p_device_hash FOR UPDATE/.test(cg),
        'claim_game locks the entitlement row, then the device row');
      ok(cg.indexOf('entitlements WHERE user_id = p_user FOR UPDATE') < cg.indexOf('devices WHERE device_hash = p_device_hash FOR UPDATE'),
        'in that order');
      ok(/EXCEPTION WHEN unique_violation/.test(cg) && /UNIQUE \(user_id, client_match_id\)/.test(sql),
        'and leans on the unique (user_id, client_match_id)');
      const stale = body('entitlement_settle_stale');
      ok(/entitlement_settle_stale\(p_user\)/.test(cg) && /interval '3 hours'/.test(stale) && /match_reads >= 120/.test(stale),
        'claim_game runs the 3 hour stale rule and the 120 reads (entitlement_settle_stale)');
      ok(/entitlement_settle_stale\(p_user\)/.test(body('account_state')), 'and so does account_state, where left is worked out');
      ok(/bonus_pool = bonus_pool \+ 1[^;]*AND status = 'active'/.test(stale)
        && /bonus_pool = bonus_pool \+ 1[^;]*AND status = 'active'/.test(body('settle_game'))
        && /bonus_pool = bonus_pool \+ 1[^;]*AND status = 'active'/.test(body('release_game')),
        'a game is given back to the bonus pool only while the account is active');
      ok(/bonus_pool = bonus_pool \+ 1[^;]*AND status = 'active'/.test("SET bonus_pool = bonus_pool + 1, updated_at = now()\n WHERE user_id = v_user AND status = 'active';")
        && !/bonus_pool = bonus_pool \+ 1[^;]*AND status = 'active'/.test('SET bonus_pool = bonus_pool + 1 WHERE user_id = v_user;'),
        'the give back pattern matches a known positive and refuses an unguarded one');
      ok(/ELSIF e\.bonus_pool > 0 AND e\.status <> 'ended' THEN/.test(cg), 'claim_game never plays an ended account on its bonus');
      ok(/device_hash IS NOT DISTINCT FROM p_device_hash/.test(cg), 'the open live row is reused per device');
      ok(/v_source IN \('free', 'allowance', 'bonus'\) AND NOT v_over/.test(cg)
        && /u\.source IN \('free', 'allowance', 'bonus'\) AND NOT u\.over_cap/.test(body('settle_game')),
        'only a real game (not shadow, not over the cap) qualifies an invite');
      const q = body('entitlement_qualify_referral');
      ok(/inv\.status = 'ended'/.test(q) && /'inviter-ended'/.test(q), 'an ended inviter earns nothing (inviter-ended)');
      ok(/dv\.first_user_id = r\.inviter_id/.test(q) && /encode\(sha256\(convert_to\(l\.device_id, 'UTF8'\)\), 'hex'\) = p_device/.test(q),
        'the inviter\'s device is also the one their games were first claimed on, and their licence\'s');
      ok(/inviter_id = d\.first_user_id/.test(cg), 'claim_game refuses the invite on the inviter\'s device before a free claim takes it');
      const sigs2 = { release_game: ['p_user uuid', 'p_client_match_id text'], entitlement_settle_stale: ['p_user uuid'] };
      for (const [fn, params] of Object.entries(sigs2)) {
        const head = sql.match(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${fn}\\(([\\s\\S]*?)\\)\\s*RETURNS`));
        ok(head && params.every((p) => head[1].includes(p)), `the SQL defines ${fn}(${params.map((p) => p.split(' ')[0]).join(', ')})`);
        ok(new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn}\\([^)]*\\) TO service_role;`).test(sql)
          && new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}\\([^)]*\\) FROM PUBLIC, anon, authenticated;`).test(sql),
          `${fn} is executable by service_role only`);
      }
      const rg = body('release_game');
      ok(/u\.kind <> 'riot' OR u\.status <> 'counted'/.test(rg) && /entitlement_refunds_today\(p_user\) >= 3/.test(rg),
        'release_game gives back only a counted riot row, within the refund cap');
      ok(/PERFORM 1 FROM public\.entitlements WHERE user_id = v_user FOR UPDATE/.test(body('settle_game')),
        'settle_game takes the same lock first');
      ok(/CHECK \(plan IN \('weekly', 'monthly', 'yearly', 'lifetime', 'free'\)\)/.test(sql), 'licenses.plan allows free and every old value');
      ok(/NEW\.plan IS DISTINCT FROM OLD\.plan/.test(sql) && /NEW\.expires_at IS DISTINCT FROM OLD\.expires_at/.test(sql)
        && /BEFORE UPDATE ON public\.licenses/.test(sql), 'the privilege trigger still refuses a user writing plan or expiry');
      // THE FREE COUNT. free_total's DEFAULT and ensure_entitlement's two
      // `ELSE n` must say FREE_GAMES. A later migration in the same folder
      // (the one that moved Free from 3 to 2) may set them again: the last
      // word wins, as it does when the migrations run in order.
      {
        const dir = path.dirname(file);
        const later = fs.readdirSync(dir).filter((f) => f.endsWith('.sql') && f > path.basename(file)).sort()
          .map((f) => fs.readFileSync(path.join(dir, f), 'utf8'));
        const TABLE_DEFAULT = /\n\s+free_total INTEGER NOT NULL DEFAULT (\d+)/;
        const SET_DEFAULT = /ALTER COLUMN free_total SET DEFAULT (\d+)/g;
        const ELSE_FREE = /CASE WHEN revoked THEN 0 ELSE (\d+) END/g;
        ok(TABLE_DEFAULT.test('\n  free_total INTEGER NOT NULL DEFAULT 3 CHECK (free_total >= 0),')
          && [...'ALTER TABLE public.entitlements ALTER COLUMN free_total SET DEFAULT 2;'.matchAll(SET_DEFAULT)].length === 1
          && [...'CASE WHEN revoked THEN 0 ELSE 2 END,'.matchAll(ELSE_FREE)].length === 1,
        'the free count patterns match a known table default, a later SET DEFAULT and an ensure_entitlement line');
        let def = Number((sql.match(TABLE_DEFAULT) || [])[1]);
        let ens = body('ensure_entitlement');
        for (const text of later) {
          for (const m of text.matchAll(SET_DEFAULT)) def = Number(m[1]);
          const b = text.match(/CREATE OR REPLACE FUNCTION public\.ensure_entitlement\([\s\S]*?\$function\$([\s\S]*?)\$function\$/);
          if (b) ens = b[1];
        }
        const elses = [...ens.matchAll(ELSE_FREE)].map((m) => Number(m[1]));
        ok(def === FREE_GAMES && elses.length === 2 && elses.every((v) => v === FREE_GAMES),
          `the SQL gives a new account ${FREE_GAMES} free games: free_total DEFAULT ${def}, ensure_entitlement ELSE ${elses.join(' and ')}`
          + (later.length ? ` (with ${later.length} later migration(s))` : ''));
      }
      const DASHES = new RegExp('[' + String.fromCharCode(0x2013) + String.fromCharCode(0x2014) + ']');
      ok(DASHES.test(`a${String.fromCharCode(0x2014)}b`) && !DASHES.test('a, b'), 'the dash pattern matches a known dash');
      ok(!DASHES.test(sql), 'no em or en dash in the SQL');
      ok(!/^\s*(DROP TABLE|TRUNCATE|DELETE FROM)/im.test(sql), 'nothing in it drops or deletes data, so a rerun is safe');
    }
  }

  console.log(`\n${fails ? `FAIL: ${fails} of ${checks}` : `all ${checks}`} claim game checks ${fails ? 'failed' : 'passed'}`);
  process.exit(fails ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });

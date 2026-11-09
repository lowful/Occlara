'use strict';

/**
 * FREE GAMES ARE ONE PER PLAYER, NOT ONE PER ACCOUNT (8.8).
 *
 * server/services/free-allowance.js hands an account's keys to the database
 * (the Riot account from Riot's record, the device, the Windows machine, the
 * canonical email, and the network as a weak key), and free-allowance.sql
 * decides: an account whose strong keys meet an account that played a free
 * game first has none. This drives the whole way, the routes, the meter and
 * the SQL's model in scripts/fixtures/fake-billing.js (`allowance: true`):
 *
 *   the canonical email and the keys, each pattern asserted on a known string
 *   a second account on the same device, the same machine, the same email
 *     (a.b+x@gmail.com and ab@gmail.com), the same Riot account (found in
 *     Riot's record after its first game): 0 free games, the calm sentence,
 *     and the first account untouched
 *   a paid account and bought games: exactly what was paid for
 *   the same account back on a new install or a new PC: untouched
 *   an old client with no device id: the email key still applies, and an
 *     account with no key at all is never refused
 *   two people on one household network: both have their free games
 *   a crowded key: a griefed Riot account (3 machines, 3 emails) and a PC
 *     cafe (4 Riot accounts on one machine id) block no one, while the crowd
 *     one person makes (3 accounts of one Riot account on one PC, 4 Windows
 *     user names on one machine) never switches their own key off
 *   one Riot account per account: a second, different puuid is never noted,
 *     the same one again is fine, a griefer's victims are one at most, and
 *     an old second puuid row blocks no one
 *   the machine id on every /account/me (X-Occlara-Machine): a session made
 *     before 8.7.4 gains its machine key, a second account under a new
 *     Windows user then meets it, a missing or malformed header changes nothing
 *   a refunded payer made active again by a new purchase: still first
 *   refunds: a game given back is not a game used, a refunded licence's games
 *     still are
 *   two accounts of one person claiming at the same moment: one game
 *   invites: one person on both sides is self referral, refused at redeem and
 *     at qualification, and an invited account under the same keys gets nothing
 *   ENFORCE_CAPS=0: counted in shadow, never refused
 *   the SQL not applied: today exactly, and accounts stay live
 *   a database that hangs: nothing waits past CALL_MS
 *   the app's lines (usage.js, profile.js, account-service normalizeState),
 *     machine-id.js, and the SQL file's shape when it can be found
 *
 * Nothing leaves the machine. Run: npm run test:freeallowance
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { makeIssuer, call, sha, newToken } = require('./test-caller');
const { makeSupabase } = require('./fixtures/fake-billing');

const SERVER = path.join(__dirname, '..', 'server');
const callers = require(path.join(SERVER, 'services', 'caller.js'));
const usage = require(path.join(SERVER, 'routes', 'usage.js'));
const fa = require(path.join(SERVER, 'services', 'free-allowance.js'));
const appUsage = require('../src/shared/usage');
const { FREE_GAMES } = callers;
const INVITED_FREE_TOTAL = usage.LIMITS.INVITED_FREE_TOTAL;
const profile = require('../src/shared/profile');
const { normalizeState } = require('../src/main/services/account-service');
const machine = require('../src/main/services/machine-id');

let fails = 0;
let checks = 0;
const ok = (cond, what) => {
  checks++;
  if (!cond) { fails++; console.log(`FAIL  ${what}`); } else console.log(`ok    ${what}`);
};

const DASHES = new RegExp('[\\u2013\\u2014]');
ok(DASHES.test(`a${String.fromCharCode(0x2014)}b`) && !DASHES.test('a-b, c'), 'the dash check matches an em dash and passes a hyphen');

// ── The keys ────────────────────────────────────────────────────────────────
{
  const c = fa.canonicalEmail;
  ok(c('A.B+x@gmail.com') === 'ab@gmail.com' && c('ab@gmail.com') === 'ab@gmail.com' && c(' a.b@GoogleMail.com ') === 'ab@gmail.com',
    'gmail: dots and a plus tag go, googlemail is gmail, case and spaces fold');
  ok(c('Sam+occlara@outlook.com') === 'sam@outlook.com' && c('sam+1@hotmail.co.uk') === 'sam@hotmail.co.uk'
    && c('sam+a@icloud.com') === 'sam@icloud.com' && c('sam+z@proton.me') === 'sam@proton.me' && c('sam+z@pm.me') === 'sam@proton.me',
  'outlook, hotmail, icloud and proton drop a plus tag');
  ok(c('sam@protonmail.com') === 'sam@proton.me' && c('Sam+x@ProtonMail.ch') === 'sam@proton.me' && c('sam@pm.me') === 'sam@proton.me'
    && c('sam@proton.me') === 'sam@proton.me' && c('sam@googlemail.com') === 'sam@gmail.com',
  'proton.me, protonmail.com, protonmail.ch and pm.me are one mailbox, googlemail.com is gmail.com');
  ok(fa.keysFor({ email: 'sam@protonmail.com' }, { ACCOUNT_HASH_SALT: 's' })[0].key === fa.keysFor({ email: 'sam@pm.me' }, { ACCOUNT_HASH_SALT: 's' })[0].key,
    'so sam@protonmail.com and sam@pm.me are one key');
  ok(c('sam-games@yahoo.com') === 'sam@yahoo.com' && c('s.am@yahoo.com') === 's.am@yahoo.com', 'yahoo drops its hyphen keyword and keeps dots');
  ok(c('first.last@company.com') === 'first.last@company.com' && c('a+b@company.com') === 'a+b@company.com',
    'an address at any other domain keeps its dots and its plus');
  ok(c('sam+x@live.com') === 'sam@live.com' && c('sam+x@msn.com') === 'sam@msn.com' && c('sam+x@hotmail.fr') === 'sam@hotmail.fr'
    && c('sam+x@hotmail.com.br') === 'sam@hotmail.com.br' && c('sam+x@me.com') === 'sam@me.com' && c('sam+x@mac.com') === 'sam@mac.com'
    && c('sam-x@ymail.com') === 'sam@ymail.com' && c('sam-x@yahoo.co.uk') === 'sam@yahoo.co.uk' && c('sam+x@protonmail.ch') === 'sam@proton.me',
  'live.com, msn.com, hotmail\'s country domains, me.com, mac.com, ymail.com and yahoo\'s country domains fold, each by its exact domain');
  ok(c('a.b+x@live.example.org') === 'a.b+x@live.example.org' && c('sam+x@outlook.example.com') === 'sam+x@outlook.example.com'
    && c('sam-x@yahoo.example.net') === 'sam-x@yahoo.example.net' && c('sam+x@hotmail.example') === 'sam+x@hotmail.example'
    && c('sam+x@msn.company.com') === 'sam+x@msn.company.com' && c('sam+x@gmail.com.example.org') === 'sam+x@gmail.com.example.org',
  'a domain that merely starts with a provider\'s word (live.example.org, outlook.example.com, yahoo.example.net) is left alone');
  ok(c('nope') === null && c('@gmail.com') === null && c('a@b') === null && c('+@gmail.com') === null && c(null) === null,
    'anything that is not an address is no key');

  const env = { ACCOUNT_HASH_SALT: 'salt-1' };
  const k = (kind, v, e = env) => fa.keyOf(kind, v, e);
  ok(/^[0-9a-f]{64}$/.test(k('email', 'ab@gmail.com')) && k('email', 'x') !== k('device', 'x') && k('email', 'x') !== k('email', 'x', { ACCOUNT_HASH_SALT: 'salt-2' }),
    'a key is a 64 hex HMAC, different per kind and per salt');
  const dev = sha('pc-1');
  const keys = fa.keysFor({ email: 'A.B+x@gmail.com', deviceHash: dev, machineId: sha('m'), puuid: '0f0e0d0c-1111-4222-8333-444455556666',
    netHash: sha('n') }, env);
  ok(keys.map((x) => x.kind).join(',') === 'email,device,machine,puuid,net', `every kind becomes a key (${keys.map((x) => x.kind)})`);
  ok(fa.keysFor({ email: 'ab@gmail.com' }, env)[0].key === keys[0].key, 'a.b+x@gmail.com and ab@gmail.com are one key');
  const bad = fa.keysFor({ deviceHash: 'not-a-hash', machineId: 'DROP TABLE', puuid: 'Name#TAG', netHash: 12 }, env);
  ok(bad.length === 0, 'a value of the wrong shape is never a key');
  ok(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test('0f0e0d0c-1111-4222-8333-444455556666'), 'the puuid shape matches a known puuid');

  const players = [{ name: 'Other', tag: 'EU1', puuid: 'aaaaaaaa-1111-4222-8333-444455556666' },
    { name: 'Rook', tag: 'NA1', puuid: '0F0E0D0C-1111-4222-8333-444455556666' }];
  ok(fa.puuidInMatch(players, 'rook', 'na1') === '0f0e0d0c-1111-4222-8333-444455556666' && fa.puuidInMatch(players, 'Nobody', 'X') === null,
    'the player\'s puuid is found in Riot\'s record by name and tag, lowercased');
  const coachSrc = fs.readFileSync(path.join(SERVER, 'routes', 'coach.js'), 'utf8');
  ok(coachSrc.includes('freeAllowance.puuidInMatch(riotRounds.playersOf(d), name, tag)')
    && coachSrc.includes('freeAllowance.shared.noteLinkPuuid(caller, puuid, { purpose: req.query.purpose, startedAt: out.startedAt })'),
  '/match-rounds notes the puuid it found in Riot\'s record, for the caller, through the live link gate');
  ok(coachSrc.includes('freeAllowance.shared.noteLinkPuuid(caller, freeAllowance.shared.puuidOf(matchId, username),')
    && coachSrc.includes('{ purpose: req.query.purpose, startedAt: cached && cached.startedAt }'), 'and on a cache hit, through the same gate');
  const BARE_NOTE = /\.notePuuid\(/;
  ok(BARE_NOTE.test('freeAllowance.shared.notePuuid(caller, p)') && !BARE_NOTE.test(coachSrc), 'coach.js never notes a puuid around the gate');
  const NAMED = /noteLinkPuuid\(caller, req\.(query|body)/;
  ok(NAMED.test('noteLinkPuuid(caller, req.query.puuid') && !NAMED.test(coachSrc), 'and never a puuid the request names');
  const at = Date.parse('2026-11-05T12:00:00.000Z');
  const L = fa.linkMayNote;
  ok(L({ purpose: 'live', startedAt: at - 45 * 60 * 1000 }, at) === true, 'the live link of a match that started 45 minutes ago may note its puuid');
  ok(L({ purpose: undefined, startedAt: at - 60e3 }, at) === false && L({ purpose: 'fill', startedAt: at - 60e3 }, at) === false
    && L({ purpose: 'LIVE', startedAt: at - 60e3 }, at) === false,
  'a Riot ID typed into Settings or Connect (no purpose), a fill: never');
  ok(L({ purpose: 'live', startedAt: at - fa.LINK_MS - 1 }, at) === false && L({ purpose: 'live', startedAt: null }, at) === false
    && L({ purpose: 'live', startedAt: at + 60 * 60 * 1000 }, at) === false && L(null, at) === false,
  'nor a match older than a day, with no start, or one that starts in an hour');
  // The client half of the gate: only riotRoundsFor (the live link verified
  // against the recording) says purpose=live, never Connect's backfill or a fill.
  const SRC = path.join(SERVER, '..', 'src', 'main');
  const indexSrc = fs.readFileSync(path.join(SRC, 'index.js'), 'utf8');
  const linkFn = indexSrc.slice(indexSrc.indexOf('async function riotRoundsFor('), indexSrc.indexOf('async function riotRoundsFor(') + 900);
  const LIVE_Q = /[?&]purpose=live\b/;
  ok(LIVE_Q.test('/api/coach/match-rounds?matchId=x&username=y&purpose=live') && !LIVE_Q.test('&purpose=fill'),
    'the purpose=live pattern matches a known live link');
  ok(LIVE_Q.test(linkFn), 'riotRoundsFor, the app\'s live link, sends purpose=live, or no puuid is ever noted');
  const backfillSrc = fs.readFileSync(path.join(SRC, 'services', 'backfill.js'), 'utf8');
  const askSrc = fs.readFileSync(path.join(SRC, 'services', 'ask-coach.js'), 'utf8');
  ok(!LIVE_Q.test(backfillSrc) && !LIVE_Q.test(askSrc), 'Connect\'s backfill and Ask Coach\'s fill never say purpose=live');
}

// ── The world: the SQL's model, the routes, the meter ──────────────────────
// The app every claim here comes from: the first one whose free games the
// allowance can tie to a person (caller.js FREE_PLAY_FROM). Section 5b holds
// the older ones.
const APP = '8.7.4';
let clock = Date.parse('2026-11-05T12:00:00.000Z');
const now = () => clock;
const tick = (ms = 60 * 1000) => { clock += ms; };
const env = { SUPABASE_URL: process.env.SUPABASE_URL, ENFORCE_CAPS: '1', REFERRALS_ON: '1', ACCOUNT_HASH_SALT: 'test-salt' };
const sb = makeSupabase();
const issuer = makeIssuer();
const users = {};
const keyOwners = {};
sb.reset({ accounts: true, allowance: true, now, userRecords: users });
const resolver = callers.createResolver({ supabase: sb, fetch: issuer.fetch, now, env,
  checkKey: async (k) => (keyOwners[k] ? 'valid' : 'invalid'), keyOwner: (k) => keyOwners[k] || null });
const allowance = fa.createAllowance({ supabase: sb, resolver, now, env });
const meter = usage.createMeter({ supabase: sb, resolver, now, env, allowance });
const router = usage.createRouter({ supabase: sb, resolver, meter, env, now, allowance });
const T = (t) => sb._db.tables[t];
const iso = (ms) => new Date(ms).toISOString();
let n = 0;
const newUser = (email) => {
  const id = `00000000-0000-4000-9000-${String(++n).padStart(12, '0')}`;
  users[id] = { id, email, email_confirmed_at: iso(clock), created_at: iso(clock) };
  return id;
};
const b64 = (buf) => buf.toString('base64url');

/** The real sign in: a handoff the site made, then the app's exchange. Returns the session's headers. */
async function signIn(userId, { deviceId, machineId, ip = '203.0.113.7' } = {}) {
  const code = b64(crypto.randomBytes(32));
  const verifier = b64(crypto.randomBytes(40));
  const state = b64(crypto.randomBytes(16));
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  T('auth_handoffs').push({ code_hash: sha(code), user_id: userId, state, challenge, expires_at: iso(clock + 60e3), used_at: null });
  const body = { code, verifier, state, device_id: deviceId || '', device_name: 'PC' };
  if (machineId) body.machine_id = machineId;
  const r = await call(router, 'POST', '/account/exchange', { body, ip });
  if (r.status !== 200) throw new Error(`exchange answered ${r.status} ${JSON.stringify(r.body)}`);
  return { Authorization: `Bearer ${r.body.token}`, 'X-Occlara-Version': APP };
}
const me = (h) => call(router, 'GET', '/account/me', { headers: h });
let mid = 0;
const claim = (h, extra = {}) => call(router, 'POST', '/usage/claim', { headers: h,
  body: { game: 'valorant', kind: 'riot', client_match_id: `riot:${++mid}`, ...extra } });
const callerOf = (h) => resolver.resolveCaller({ headers: { authorization: h.Authorization } });
const freeRows = (u) => T('game_usage').filter((g) => g.user_id === u && g.source === 'free' && g.status !== 'refunded').length;
// The site's token carries the account's own email, as Supabase signs it.
const jwt = (sub) => ({ Authorization: `Bearer ${issuer.sign({ sub, email: users[sub].email }, { nowS: Math.floor(clock / 1000) })}` });
/**
 * One live Valorant game through the meter, as a read in a match claims it,
 * then its review counts it: true when the server gave it a game (a live
 * game_usage row of its own, what lets its match's puuid be noted).
 */
async function liveGame(h) {
  const c = await callerOf(h);
  await meter.noteRead(c, { inMatch: true, score: { team: 0, enemy: 0 } });
  const row = meter.rows.get(meter.rowKey(c));
  const granted = !!(row && row.usageId && !row.refused);
  if (granted) await meter.reviewDone(c);
  else meter.rows.delete(meter.rowKey(c));
  return granted;
}
// Riot's record of the match the app just recorded, as its live link names it.
const liveLink = () => ({ purpose: 'live', startedAt: clock - 40 * 60 * 1000 });
const noted = (u, value) => T('free_allowance_keys').some((k) => k.user_id === u && k.kind === 'puuid' && k.key_hash === fa.keyOf('puuid', value, env));
const linkOf = async (h, puuid) => allowance.noteLinkPuuid(await callerOf(h), puuid, liveLink());

(async () => {
  // ── 1. The same device ───────────────────────────────────────────────────
  const A = newUser('alpha@example.com');
  const hA = await signIn(A, { deviceId: 'pc-1', ip: '198.51.100.10' });
  const a1 = await claim(hA);
  tick();
  const a2 = await claim(hA);
  ok(a1.body.granted && a2.body.granted && freeRows(A) === 2, 'the first account plays 2 free games');
  tick();
  const B = newUser('bravo@example.com');
  const hB = await signIn(B, { deviceId: 'pc-1', ip: '198.51.100.10' });
  const mB = await me(hB);
  ok(mB.status === 200 && mB.body.left === 0 && mB.body.free_shared === true && mB.body.capped === true,
    `a second account on the same device starts with 0 free games, capped, said as one per player (left ${mB.body.left})`);
  const b1 = await claim(hB);
  ok(b1.body.granted === false && (b1.body.reason === 'device' || b1.body.reason === 'person') && freeRows(B) === 0,
    `and its claim is refused (${b1.body.reason})`);

  // ── 2. The same machine, a new Windows user (a new device id) ────────────
  tick();
  const M = sha('machine-guid-1');
  const C = newUser('charlie@example.com');
  const hC = await signIn(C, { deviceId: 'pc-2-user-1', machineId: M, ip: '198.51.100.30' });
  await claim(hC);
  tick();
  const D = newUser('delta@example.com');
  const hD = await signIn(D, { deviceId: 'pc-2-user-2', machineId: M, ip: '198.51.100.31' });
  const d1 = await claim(hD);
  tick();
  const d2 = await claim(hD);
  ok(d1.body.granted === true && d2.body.granted === false && d2.body.reason === 'person' && freeRows(D) === 1,
    `met on the machine alone (a new Windows user name) a new account plays one free game, never its second (${d2.body.reason})`);
  const mC = await me(hC);
  ok(mC.body.left === FREE_GAMES - 1 && mC.body.free_shared === false, 'and the first account still has the rest of its free games');

  // ── 3. The same email, written another way ───────────────────────────────
  tick();
  const E = newUser('a.b+x@gmail.com');
  const hE = await signIn(E, { deviceId: 'pc-3', ip: '192.0.2.10' });
  await claim(hE);
  tick();
  const F = newUser('ab@gmail.com');
  const hF = await signIn(F, { deviceId: 'pc-4', ip: '192.0.2.200' });
  const mF = await me(hF);
  const f1 = await claim(hF);
  ok(mF.body.left === 0 && mF.body.free_shared === true && f1.body.granted === false && f1.body.reason === 'person',
    'a.b+x@gmail.com then ab@gmail.com: the second has no free games (person)');
  ok((await me(hE)).body.left === FREE_GAMES - 1, 'the first keeps what it had');

  // ── 4. The same Riot account, found in Riot's record after a first game ──
  tick();
  const PUUID = '0f0e0d0c-1111-4222-8333-444455556666';
  const G = newUser('golf@example.com');
  const hG = await signIn(G, { deviceId: 'pc-5', ip: '192.0.2.20' });
  await claim(hG); tick();
  ok(await liveGame(hG), 'the first account plays its second free game live');
  await linkOf(hG, PUUID);
  ok(noted(G, PUUID), 'its live link notes the Riot account Riot\'s record names, with its own live game beside it');
  tick();
  const H = newUser('hotel@example.com');
  const hH = await signIn(H, { deviceId: 'pc-6', ip: '192.0.2.30' });
  const h1 = await liveGame(hH);
  ok(h1 === true && freeRows(H) === 1, 'a new account on a new PC and email plays a first game: nothing ties it yet');
  await linkOf(hH, PUUID);
  tick(31 * 1000);
  const mH = await me(hH);
  const h2 = await claim(hH);
  ok(mH.body.left === 0 && mH.body.free_shared === true && h2.body.granted === false && h2.body.reason === 'person',
    'Riot\'s record names the same Riot account: its second free game is refused');
  const mG = await me(hG);
  ok(mG.body.free_shared === false && freeRows(G) === 2, 'and the account that played first is untouched');

  // ── 4a. The purpose alone never notes a puuid ────────────────────────────
  tick();
  const NOROW_PUUID = '0a0b0c0d-1111-4222-8333-444455556666';
  const NR = newUser('norow@example.com');
  const hNR = await signIn(NR, { deviceId: 'pc-norow', machineId: sha('m-norow'), ip: '192.0.2.31' });
  await claim(hNR);   // a Riot record review: a game, but no live one
  const nr = await linkOf(hNR, NOROW_PUUID);
  ok(!noted(NR, NOROW_PUUID) && nr.shared === null,
    'purpose=live with no live game of the account\'s own in the database notes nothing (a Riot record review is no live game)');
  // A review the cap locked: B was refused, so no claim and no row.
  ok(await liveGame(hB) === false, 'an account with no free games left has its live game refused (no claim)');
  await linkOf(hB, NOROW_PUUID);
  ok(!noted(B, NOROW_PUUID), 'so its locked review notes nothing either');
  // A live game of its own, but far from the start Riot names: not that match.
  tick();
  ok(await liveGame(hNR), 'the account then plays a live game of its own');
  await allowance.noteLinkPuuid(await callerOf(hNR), NOROW_PUUID, { purpose: 'live', startedAt: clock - fa.PROVEN_MS - 60 * 1000 });
  ok(!noted(NR, NOROW_PUUID), 'a match Riot says started more than 2 hours from its live game notes nothing');
  await allowance.noteLinkPuuid(await callerOf(hNR), NOROW_PUUID, { purpose: 'live', startedAt: clock + 5 * 60 * 1000 });
  ok(noted(NR, NOROW_PUUID), 'and the match it did play, inside the 2 hours, notes its Riot account');
  ok(fa.PROVEN_MS === 2 * 60 * 60 * 1000, 'the window is 2 hours each side of Riot\'s start');

  // ── 4b. An app before 8.7.4 plays no free game ───────────────────────────
  tick();
  const OLD = newUser('oldapp@example.com');
  const hOLD = await signIn(OLD, { deviceId: 'pc-oldapp', machineId: sha('m-oldapp'), ip: '192.0.2.32' });
  const oldH = { ...hOLD, 'X-Occlara-Version': '8.7.3' };
  const o1 = await claim(oldH);
  ok(o1.body.granted === false && o1.body.reason === 'update-required' && o1.body.message === 'Update Occlara to keep playing your free games.'
    && freeRows(OLD) === 0, `a free game claimed from 8.7.3 is refused, with the sentence (${o1.body.reason}: ${o1.body.message})`);
  const { Authorization: oldAuth } = hOLD;
  const o2 = await claim({ Authorization: oldAuth });
  ok(o2.body.granted === false && o2.body.reason === 'update-required', 'and from an app that says no version at all');
  const cOLD = await callerOf(hOLD);
  const og = await meter.gate(cOLD, { req: { headers: { 'x-occlara-version': '8.7.3' } } });
  ok(og.ok === false && og.status === 402 && og.body.error === 'cap' && og.body.left === 0 && og.body.reason === 'update-required'
    && og.body.message === callers.UPDATE_FOR_FREE,
  'the read gate answers 8.7.3 the 402 cap an 8.7 app already reads as no game, with the sentence beside it');
  const ng = await meter.gate(cOLD, { req: { headers: { 'x-occlara-version': APP } } });
  const n1 = await claim(hOLD);
  ok(ng.ok === true && n1.body.granted === true && freeRows(OLD) === 1, `the same account on ${APP} plays its free games`);
  ok(callers.playsFree({ headers: { 'x-occlara-version': '8.7.4' } }) && callers.playsFree({ headers: { 'x-occlara-version': '8.8.0' } })
    && !callers.playsFree({ headers: { 'x-occlara-version': '8.7.3' } }) && !callers.playsFree({ headers: {} }),
  'the line is 8.7.4: 8.7.4 and 8.8.0 play, 8.7.3 and no version do not');
  // A paid account and bought games on the old app: exactly as before.
  tick();
  const OLDP = newUser('oldpaid@example.com');
  const hOLDP = await signIn(OLDP, { deviceId: 'pc-oldpaid', machineId: sha('m-oldpaid'), ip: '192.0.2.33' });
  Object.assign(T('entitlements').find((e) => e.user_id === OLDP), { tier: 'pro', cap_monthly: 25, source: 'stripe', period_anchor: iso(clock) });
  resolver.forgetEntitlement(OLDP);
  const op = await claim({ ...hOLDP, 'X-Occlara-Version': '8.7.3' });
  const opg = await meter.gate(await callerOf(hOLDP), { req: { headers: { 'x-occlara-version': '8.7.3' } } });
  ok(op.body.granted === true && opg.ok === true && T('game_usage').some((g) => g.user_id === OLDP && g.source === 'allowance'),
    'a Pro account on 8.7.3 plays on its month, untouched');
  tick();
  const OLDB = newUser('oldbought@example.com');
  const hOLDB = await signIn(OLDB, { deviceId: 'pc-oldbought', machineId: sha('m-oldbought'), ip: '192.0.2.34' });
  await sb.rpc('grant_purchased_games', { p_user: OLDB, p_games: 1, p_ref: 'cs_test_old', p_amount_cents: 200 });
  const ob = await claim({ ...hOLDB, 'X-Occlara-Version': '8.7.3' });
  ok(ob.body.granted === true, 'an account with games bought plays on 8.7.3, untouched');
  // With caps off it is counted, never refused.
  env.ENFORCE_CAPS = '0';
  tick();
  const OLDS = newUser('oldshadow@example.com');
  const hOLDS = await signIn(OLDS, { deviceId: 'pc-oldshadow', machineId: sha('m-oldshadow'), ip: '192.0.2.35' });
  const before = meter.counts.oldFree;
  const os = await claim({ ...hOLDS, 'X-Occlara-Version': '8.7.3' });
  ok(os.body.granted === true && meter.counts.oldFree === before + 1, 'with ENFORCE_CAPS off an old app\'s free game is granted and counted');
  env.ENFORCE_CAPS = '1';
  ok(!DASHES.test(callers.UPDATE_FOR_FREE) && !callers.UPDATE_FOR_FREE.includes(';'), 'the sentence has no dash and no semicolon');

  // ── 5. Paid accounts get what they paid for ──────────────────────────────
  tick();
  const P = newUser('papa@example.com');
  const hP = await signIn(P, { deviceId: 'pc-1', ip: '198.51.100.10' });   // A's device
  Object.assign(T('entitlements').find((e) => e.user_id === P), { tier: 'pro', cap_monthly: 25, source: 'stripe', period_anchor: iso(clock) });
  resolver.forgetEntitlement(P);
  const mP = await me(hP);
  const p1 = await claim(hP);
  ok(mP.body.left === 25 && mP.body.free_shared === false && p1.body.granted === true,
    `a Pro account on a device whose free games were used has all 25 (${mP.body.left}), and plays`);
  ok(T('game_usage').some((g) => g.user_id === P && g.source === 'allowance'), 'on its month\'s allowance');
  tick();
  const Q = newUser('ab+bought@gmail.com');   // E's person
  const hQ = await signIn(Q, { deviceId: 'pc-7', ip: '192.0.2.40' });
  await sb.rpc('grant_purchased_games', { p_user: Q, p_games: 3, p_ref: 'cs_test_1', p_amount_cents: 600 });
  const q = [];
  for (let i = 0; i < 4; i++) { tick(); q.push((await claim(hQ)).body.granted); }
  ok(q.join(',') === 'true,true,true,false' && T('game_usage').filter((g) => g.user_id === Q && g.source === 'bonus').length === 3,
    `3 games bought under a used free allowance are 3 games, then the paywall (${q})`);

  // ── 6. The same account again ────────────────────────────────────────────
  tick();
  const R = newUser('romeo@example.com');
  const hR1 = await signIn(R, { deviceId: 'pc-8', ip: '192.0.2.50' });
  await claim(hR1);
  tick();
  const hR2 = await signIn(R, { deviceId: 'pc-8', ip: '192.0.2.51' });      // a reinstall
  const hR3 = await signIn(R, { deviceId: 'pc-9-new', machineId: sha('m-r2'), ip: '192.0.2.52' });  // a new PC
  const mR = await me(hR3);
  const r2 = await claim(hR2);
  ok(mR.body.left === FREE_GAMES - 1 && mR.body.free_shared === false && r2.body.granted === true && freeRows(R) === 2,
    'the same account signed back in, on a reinstall and on a new PC, keeps its own free games');

  // ── 7. Missing keys ──────────────────────────────────────────────────────
  tick();
  // An 8.7 key with no device (an old client), whose email is A's person.
  const K = newUser('alpha+old@example.com');
  ok(fa.canonicalEmail('alpha+old@example.com') === 'alpha+old@example.com', 'a plus at an unknown domain is kept (so this key is its own)');
  const S = newUser('ALPHA@example.com');
  keyOwners['GC-AAAA-BBBB-CCCC-DDDD'] = { userId: S, plan: 'free', deviceId: null };
  const hS = { 'X-License-Key': 'GC-AAAA-BBBB-CCCC-DDDD', 'X-Occlara-Version': '8.7.3' };
  const s1 = await call(router, 'POST', '/usage/claim', { headers: hS, body: { game: 'valorant', kind: 'riot', client_match_id: 'riot:s1' } });
  ok(s1.body.granted === false && s1.body.reason === 'person', `an old client with no device id: the email key still applies (${s1.body.reason})`);
  users[K].email = null;
  const hK = await signIn(K, { ip: '192.0.2.60' });
  const k1 = await claim(hK);
  ok(k1.body.granted === true, 'an account with no key the server can vouch for is never refused for it');

  // ── 8. Two people on one household network ───────────────────────────────
  tick();
  const U = newUser('uniform@example.com');
  const V = newUser('victor@example.com');
  const hU = await signIn(U, { deviceId: 'house-pc-1', machineId: sha('house-m1'), ip: '203.0.113.50' });
  const hV = await signIn(V, { deviceId: 'house-pc-2', machineId: sha('house-m2'), ip: '203.0.113.51' });
  const uv = [];
  for (let i = 0; i < 2; i++) { tick(); uv.push((await claim(hU)).body.granted, (await claim(hV)).body.granted); }
  ok(uv.every(Boolean) && freeRows(U) === 2 && freeRows(V) === 2, 'two people on one household network each play 2 free games');
  ok(T('free_allowance_keys').filter((k) => k.kind === 'net' && (k.user_id === U || k.user_id === V)).length === 2,
    'the network is kept, as a weak key only');

  // ── 9. Refunds ───────────────────────────────────────────────────────────
  tick();
  const W = newUser('whiskey@example.com');
  const hW = await signIn(W, { deviceId: 'pc-w', ip: '192.0.2.70' });
  const w1 = await claim(hW, { client_match_id: 'riot:w1' });
  const rel = await call(router, 'POST', '/usage/release', { headers: hW, body: { client_match_id: 'riot:w1' } });
  ok(w1.body.granted && rel.body.released === true && freeRows(W) === 0, 'a free game taken back is not a game used');
  tick();
  const X = newUser('xray@example.com');
  const hX = await signIn(X, { deviceId: 'pc-w', ip: '192.0.2.71' });   // W's device
  // The device rule of 8.7 still marks the device used: the person rule adds nothing to it.
  const devRow = T('devices').find((d) => d.device_hash === sha('pc-w'));
  ok(devRow && devRow.free_used === true, 'the 8.7 device rule is unchanged (a device that took a free game stays marked)');
  tick();
  const Y = newUser('yankee@example.com');
  const Y2 = newUser('yankee+2@gmail.com');
  const Y3 = newUser('yankee2@gmail.com');
  users[Y2].email = 'yankee.two@gmail.com';
  users[Y3].email = 'yankeetwo+again@gmail.com';
  const hY2 = await signIn(Y2, { deviceId: 'pc-y2', ip: '192.0.2.80' });
  const y1 = await claim(hY2, { client_match_id: 'riot:y1' });
  await call(router, 'POST', '/usage/release', { headers: hY2, body: { client_match_id: 'riot:y1' } });
  tick();
  const hY3 = await signIn(Y3, { deviceId: 'pc-y3', ip: '192.0.2.81' });
  const y3 = await claim(hY3);
  ok(y1.body.granted && y3.body.granted === true, 'the other account of a player whose only free game was given back may play');
  tick();
  const y2b = await claim(hY2);
  ok(y2b.body.granted === false && y2b.body.reason === 'person', 'and then the first one is the second to play, so it has none: whoever played first keeps them');
  void Y; void hX;
  // A licence refunded: the account is ended, its free games still count for the person.
  tick();
  const Z = newUser('zulu@example.com');
  const hZ = await signIn(Z, { deviceId: 'pc-z', ip: '192.0.2.90' });
  await claim(hZ);
  Object.assign(T('entitlements').find((e) => e.user_id === Z), { status: 'ended', free_total: 0, bonus_pool: 0, tier: 'free', cap_monthly: 0 });
  tick();
  const Z2 = newUser('zulu+again@example.com');
  users[Z2].email = 'ZULU@example.com';
  const hZ2 = await signIn(Z2, { deviceId: 'pc-z2', ip: '192.0.2.91' });
  const z2 = await claim(hZ2);
  ok(z2.body.granted === false && z2.body.reason === 'person', 'a refund ended the first account: its free games still count, so a new account gets none');

  // ── 10. Two claims at the same moment ────────────────────────────────────
  tick();
  const I = newUser('india@example.com');
  const J = newUser('INDIA@example.com');
  const hI = await signIn(I, { deviceId: 'pc-i', ip: '192.0.2.100' });
  const hJ = await signIn(J, { deviceId: 'pc-j', ip: '192.0.2.101' });
  const both = await Promise.all([claim(hI), claim(hJ)]);
  ok(both.filter((r) => r.body.granted).length === 1 && freeRows(I) + freeRows(J) === 1,
    `two accounts of one person claiming at once: exactly one game (${both.map((r) => r.body.granted)})`);
  const own = await claim(both[0].body.granted ? hI : hJ);
  ok(own.body.granted && freeRows(both[0].body.granted ? I : J) === 2, 'while the account that won plays its own second free game');
  // The live meter, the same person on a third account.
  tick();
  const L = newUser('india+live@example.com');
  users[L].email = 'india@example.com';
  const hL = await signIn(L, { deviceId: 'pc-l', ip: '192.0.2.102' });
  const cL = await callerOf(hL);
  const gate = await meter.gate(cL);
  await meter.noteRead(cL, { inMatch: true, score: { team: 0, enemy: 0 } });
  const row = meter.rows.get(meter.rowKey(cL));
  ok(gate.ok === false && gate.status === 402 && (!row || row.refused === true) && freeRows(L) === 0,
    'a live match on a third account of that person is refused at the read gate, before the model');

  // ── 11. Invites ──────────────────────────────────────────────────────────
  tick();
  const INV = newUser('inviter@example.com');
  const hINV = await signIn(INV, { deviceId: 'pc-inv', machineId: sha('m-inv'), ip: '198.51.100.200' });
  await claim(hINV);
  const link = await call(router, 'GET', '/referral', { headers: hINV });
  const code = link.body.code;
  ok(link.status === 200 && /^[A-HJ-NP-Z2-9]{8}$/.test(code || ''), 'the inviter has a link');
  // Their own second account, made on their own machine under another Windows user.
  tick();
  const ALT = newUser('inviter.alt@example.com');
  await signIn(ALT, { deviceId: 'pc-inv-user2', machineId: sha('m-inv'), ip: '203.0.113.120' });
  const self = await call(router, 'POST', '/referral/redeem', { headers: jwt(ALT), body: { code }, ip: '203.0.113.120' });
  ok(self.status === 409 && self.body.reason === 'self' && !T('referral_redemptions').some((r) => r.invitee_id === ALT),
    `the inviter's own second account is self referral, refused (${self.body.reason})`);
  // An invitee whose player already used free games on another account.
  tick();
  const SEC = newUser('a.b@gmail.com');   // E's person again
  const sec = await call(router, 'POST', '/referral/redeem', { headers: jwt(SEC), body: { code }, ip: '203.0.113.121' });
  if (sec.status !== 409) console.log('redeem answered', sec.status, JSON.stringify(sec.body));
  ok(sec.status === 409 && sec.body.reason === 'free-used' && T('entitlements').find((e) => e.user_id === SEC).free_total === FREE_GAMES,
    `an invited account under the keys of a player who used their free games gets no invited games (${sec.body.reason})`);
  // A real friend redeems, then is seen on the inviter's machine: the invite pays nothing.
  tick();
  const FR = newUser('friend@example.com');
  const red = await call(router, 'POST', '/referral/redeem', { headers: jwt(FR), body: { code }, ip: '203.0.113.122' });
  ok(red.status === 200 && red.body.free_total === INVITED_FREE_TOTAL && INVITED_FREE_TOTAL === 6, 'a real friend redeems: 6 free games');
  const hFR = await signIn(FR, { deviceId: 'pc-friend-on-inviter', machineId: sha('m-inv'), ip: '203.0.113.122' });
  const bonusBefore = T('entitlements').find((e) => e.user_id === INV).bonus_pool;
  const fr1 = await claim(hFR);
  const rr = T('referral_redemptions').find((r) => r.invitee_id === FR);
  ok(fr1.body.granted === true && freeRows(FR) === 1 && rr.status === 'refused' && rr.reason === 'same-person'
    && T('entitlements').find((e) => e.user_id === INV).bonus_pool === bonusBefore,
  `the "friend" plays on the inviter's own machine: met on the machine alone it plays one free game, and the invite is refused as one person, the inviter earns nothing (${rr.reason})`);
  tick();
  const fr2b = await claim(hFR);
  ok(fr2b.body.granted === false && fr2b.body.reason === 'person' && freeRows(FR) === 1,
    `and none of the other 3 invited free games while no Riot account tells it apart (${fr2b.body.reason})`);
  // It buys a game: that game is played.
  await sb.rpc('grant_purchased_games', { p_user: FR, p_games: 1, p_ref: 'cs_test_fr', p_amount_cents: 200 });
  tick();
  const fr1b = await claim(hFR);
  ok(fr1b.body.granted === true && T('game_usage').some((g) => g.user_id === FR && g.source === 'bonus')
    && T('entitlements').find((e) => e.user_id === INV).bonus_pool === bonusBefore,
  'a game it bought is played, and still qualifies nothing');
  // A real friend on their own PC still qualifies.
  tick();
  const FR2 = newUser('friend2@example.com');
  const red2 = await call(router, 'POST', '/referral/redeem', { headers: jwt(FR2), body: { code }, ip: '203.0.113.130' });
  const hFR2 = await signIn(FR2, { deviceId: 'pc-friend-2', machineId: sha('m-fr2'), ip: '203.0.113.130' });
  const fr2 = await claim(hFR2);
  ok(red2.status === 200 && fr2.body.granted && T('referral_redemptions').find((r) => r.invitee_id === FR2).status === 'qualified'
    && T('entitlements').find((e) => e.user_id === INV).bonus_pool === bonusBefore + 4,
  'a real friend on their own PC qualifies and the inviter earns 4');

  // ── 12. ENFORCE_CAPS=0: counted in shadow, never refused ─────────────────
  env.ENFORCE_CAPS = '0';
  tick();
  const sh = await claim(hF);
  const shRow = T('game_usage').filter((g) => g.user_id === F).pop();
  ok(sh.body.granted === true && shRow.source === 'shadow' && shRow.reason === 'person' && shRow.over_cap === true,
    'with ENFORCE_CAPS off the same person\'s claim is granted, counted in shadow as person');
  const meOff = await me(hF);
  ok(meOff.body.capped === false && meOff.body.enforce === false, 'and nothing reads as capped');
  env.ENFORCE_CAPS = '1';

  // ── 12a. A Riot ID typed by a fan never merges anyone ────────────────────
  tick();
  const STREAMER_PUUID = '5a5a5a5a-1111-4222-8333-444455556666';
  const puuidRows = () => T('free_allowance_keys').filter((k) => k.kind === 'puuid' && k.key_hash === fa.keyOf('puuid', STREAMER_PUUID, env));
  const FAN1 = newUser('fan.one@example.com');
  const hFAN1 = await signIn(FAN1, { deviceId: 'pc-fan-1', machineId: sha('m-fan-1'), ip: '192.0.2.150' });
  await liveGame(hFAN1);
  // Connect (a backfill, no purpose) and a fill, both with the streamer's Riot ID typed in.
  await allowance.noteLinkPuuid(await callerOf(hFAN1), STREAMER_PUUID, { startedAt: clock - 60e3 });
  await allowance.noteLinkPuuid(await callerOf(hFAN1), STREAMER_PUUID, { purpose: 'fill', startedAt: clock - 60e3 });
  // A live link of an old match: never the one the app just recorded.
  await allowance.noteLinkPuuid(await callerOf(hFAN1), STREAMER_PUUID, { purpose: 'live', startedAt: clock - 3 * 24 * 60 * 60 * 1000 });
  ok(puuidRows().length === 0, 'a Riot ID typed into Connect or Settings, a fill, an old match: no puuid is noted');
  tick();
  const STR = newUser('streamer@example.com');
  const hSTR = await signIn(STR, { deviceId: 'pc-streamer', machineId: sha('m-streamer'), ip: '192.0.2.160' });
  const str1 = await liveGame(hSTR);
  await linkOf(hSTR, STREAMER_PUUID);
  tick(31 * 1000);
  const mSTR = await me(hSTR);
  ok(mSTR.body.free_shared === false && str1 === true && freeRows(STR) === 1 && noted(STR, STREAMER_PUUID),
    'the streamer, whose Riot ID a fan typed, still plays its free games');
  // A modified client that fakes the live flag: a puuid held by more than 2 accounts blocks no one.
  tick();
  const FAN2 = newUser('fan.two@example.com');
  const hFAN2 = await signIn(FAN2, { deviceId: 'pc-fan-2', machineId: sha('m-fan-2'), ip: '192.0.2.151' });
  await liveGame(hFAN2);
  tick();
  await allowance.noteLinkPuuid(await callerOf(hFAN1), STREAMER_PUUID, liveLink());
  await allowance.noteLinkPuuid(await callerOf(hFAN2), STREAMER_PUUID, liveLink());
  tick(31 * 1000);
  const str2 = await claim(hSTR);
  const mFAN2 = await me(hFAN2);
  ok(puuidRows().length === 3 && str2.body.granted === true && freeRows(STR) === 2 && mFAN2.body.free_shared === false,
    'a puuid held by 3 accounts (two griefers and the streamer) is ignored: the streamer keeps both games');
  const counts = async (value, kind) => (await sb.rpc('free_allowance_key_counts', { p_key: fa.keyOf(kind, value, env), p_kind: kind })).data;
  ok(await counts(STREAMER_PUUID, 'puuid') === false,
    'it is crowded because its holders are on 3 different machines with 3 different emails: other people');

  // ── 12b. A payer refunded from the start, then a second account ──────────
  tick();
  const PAY = newUser('payer@example.com');
  const hPAY = await signIn(PAY, { deviceId: 'pc-payer', ip: '192.0.2.170' });
  Object.assign(T('entitlements').find((e) => e.user_id === PAY), { tier: 'pro', cap_monthly: 25, source: 'stripe', period_anchor: iso(clock) });
  resolver.forgetEntitlement(PAY);
  await claim(hPAY);
  ok(freeRows(PAY) === 0 && T('game_usage').some((g) => g.user_id === PAY && g.source === 'allowance'), 'a payer plays on its month, never a free game');
  // Refunded: the webhook's ENDED_ACCOUNT, written as the webhook writes it, so
  // the SQL's trigger (free_allowance_mark_ended) remembers it.
  const ended = await sb.from('entitlements').update({ tier: 'free', cap_monthly: 0, free_total: 0, bonus_pool: 0, status: 'ended', renew_as: null })
    .eq('user_id', PAY);
  resolver.forgetEntitlement(PAY);
  ok(!ended.error && T('free_allowance_ended').some((x) => x.user_id === PAY), 'an account a refund ended is remembered as ended');
  tick();
  const PAY2 = newUser('PAYER@example.com');
  const hPAY2 = await signIn(PAY2, { deviceId: 'pc-payer-2', ip: '192.0.2.171' });
  const mPAY2 = await me(hPAY2);
  const pay2 = await claim(hPAY2);
  ok(mPAY2.body.left === 0 && mPAY2.body.free_shared === true && pay2.body.granted === false && pay2.body.reason === 'person' && freeRows(PAY2) === 0,
    `a refunded payer's second account under the same email gets no free games (${pay2.body.reason})`);
  // The refunded payer buys again: active and paid, it is still the first holder.
  tick();
  const back = await sb.from('entitlements').update({ tier: 'pro', cap_monthly: 25, source: 'stripe', status: 'active', period_anchor: iso(clock) })
    .eq('user_id', PAY);
  resolver.forgetEntitlement(PAY);
  allowance.forget(PAY2);
  tick(31 * 1000);
  const mPAY2b = await me(hPAY2);
  const pay2b = await claim(hPAY2);
  const payBack = await claim(hPAY);
  ok(!back.error && T('entitlements').find((e) => e.user_id === PAY).status === 'active'
    && mPAY2b.body.left === 0 && mPAY2b.body.free_shared === true && pay2b.body.granted === false && pay2b.body.reason === 'person'
    && freeRows(PAY2) === 0,
  `an ended payer made active again by a new purchase is still the first holder: the second account still gets none (${pay2b.body.reason})`);
  ok(payBack.body.granted === true && T('game_usage').filter((g) => g.user_id === PAY && g.source === 'allowance').length === 2,
    'and the revived payer plays on its month');
  // An ended account made AFTER another account's first free game takes nothing from it.
  tick();
  const EARLY = newUser('early@example.com');
  const hEARLY = await signIn(EARLY, { deviceId: 'pc-early', ip: '192.0.2.172' });
  await claim(hEARLY);
  tick();
  const LATE = newUser('EARLY@example.com');
  await signIn(LATE, { deviceId: 'pc-late', ip: '192.0.2.173' });
  Object.assign(T('entitlements').find((e) => e.user_id === LATE), { tier: 'free', free_total: 0, status: 'ended' });
  tick(31 * 1000);
  const early2 = await claim(hEARLY);
  ok(early2.body.granted === true && freeRows(EARLY) === 2, 'an account that played first keeps its games when a later one of it is refunded');

  // A griefer who played one match beside a stranger, its live link naming
  // the stranger's Riot ID, then refunded: an ended account is the first
  // holder only through a key it shares directly, never a puuid alone.
  tick();
  const VICTIM_PUUID = '91c71a00-1111-4222-8333-444455556666';
  const GRIEF = newUser('griefer@example.com');
  const hGRIEF = await signIn(GRIEF, { deviceId: 'pc-griefer', machineId: sha('m-griefer'), ip: '192.0.2.174' });
  Object.assign(T('entitlements').find((e) => e.user_id === GRIEF), { tier: 'pro', cap_monthly: 25, source: 'stripe', period_anchor: iso(clock) });
  resolver.forgetEntitlement(GRIEF);
  ok(await liveGame(hGRIEF) && freeRows(GRIEF) === 0, 'the griefer plays a live game on its month, no free game');
  await linkOf(hGRIEF, VICTIM_PUUID);
  await sb.from('entitlements').update({ tier: 'free', cap_monthly: 0, free_total: 0, bonus_pool: 0, status: 'ended', renew_as: null })
    .eq('user_id', GRIEF);
  resolver.forgetEntitlement(GRIEF);
  tick();
  const VICTIM = newUser('victim@example.com');
  const hVICTIM = await signIn(VICTIM, { deviceId: 'pc-victim', machineId: sha('m-victim'), ip: '192.0.2.175' });
  const v1 = await liveGame(hVICTIM);
  await linkOf(hVICTIM, VICTIM_PUUID);
  tick(31 * 1000);
  const v2 = await claim(hVICTIM);
  ok(noted(GRIEF, VICTIM_PUUID) && noted(VICTIM, VICTIM_PUUID) && T('free_allowance_ended').some((x) => x.user_id === GRIEF)
    && v1 === true && v2.body.granted === true && freeRows(VICTIM) === 2,
  'an ended griefer who shares only the victim\'s puuid blocks nobody: the victim plays both free games');

  // ── 12c. A cloned Windows image (a PC cafe): one machine id, many players ──
  // Met on the machine key ALONE a new account plays one free game, so its
  // Riot account can be read off that game, and its second once that Riot
  // account differs from every earlier holder's.
  tick();
  const CAFE3 = sha('cafe-three-image-guid');
  const cafe3 = [];
  for (const who of ['cafe3.a', 'cafe3.b', 'cafe3.c']) {
    const u = newUser(`${who}@example.com`);
    cafe3.push({ u, h: await signIn(u, { deviceId: `cafe3-seat-${cafe3.length}`, machineId: CAFE3, ip: '198.51.100.239' }) });
  }
  const cafe3Puuid = (i) => `ca3e000${i}-1111-4222-8333-444455556666`;
  ok(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(cafe3Puuid(2)), 'the cafe puuids are puuid shaped');
  const cafe3Out = [];
  for (let i = 0; i < cafe3.length; i++) {
    tick();
    const first = await liveGame(cafe3[i].h);
    tick(31 * 1000);
    const early = i === 0 ? null : await claim(cafe3[i].h);   // before its Riot account is read
    await linkOf(cafe3[i].h, cafe3Puuid(i));
    tick(31 * 1000);
    const second = await claim(cafe3[i].h);
    cafe3Out.push({ first, early, second });
  }
  ok(cafe3Out.every((x) => x.first === true), 'a cafe of 3 different players on one cloned machine id: each plays its first free game');
  ok(cafe3Out.slice(1).every((x) => x.early.body.granted === false && x.early.body.reason === 'person'),
    `a later player's second waits until its Riot account is read (${cafe3Out.slice(1).map((x) => x.early.body.reason)})`);
  ok(cafe3Out.every((x) => x.second.body.granted === true) && cafe3.every((x) => freeRows(x.u) === 2),
    'and once each one\'s Riot account differs from the earlier players\', each plays both');
  ok(await counts(CAFE3, 'machine') === true, 'while the machine id itself still counts (3 Riot accounts, under the 4 of a crowd)');

  // The same person under 3 Windows user names and 3 emails, on one Riot account.
  tick();
  const SOLO2 = sha('solo-three-names-one-riot-guid');
  const SOLO2_PUUID = '50105010-1111-4222-8333-444455556666';
  const solo2 = [];
  for (const who of ['solo2.a', 'solo2.b', 'solo2.c']) {
    const u = newUser(`${who}@example.com`);
    solo2.push({ u, h: await signIn(u, { deviceId: `solo2-name-${solo2.length}`, machineId: SOLO2, ip: '198.51.100.243' }) });
  }
  const solo2Out = [];
  for (const s of solo2) {
    tick();
    const first = await liveGame(s.h);
    await linkOf(s.h, SOLO2_PUUID);
    tick(31 * 1000);
    solo2Out.push({ first, second: await claim(s.h), third: await claim(s.h) });
  }
  ok(solo2Out[0].first && solo2Out[0].second.body.granted === true && solo2Out[0].third.body.granted === true && freeRows(solo2[0].u) === 3,
    'the first account plays 3 of its free games');
  ok(solo2Out.slice(1).every((x) => x.first === true && x.second.body.granted === false && x.second.body.reason === 'person'
    && x.third.body.granted === false) && solo2.slice(1).every((s) => freeRows(s.u) === 1),
  `one person with 3 Windows user names on one Riot account: 1 free game per extra account, never 2 (${solo2Out.slice(1).map((x) => x.second.body.reason)})`);
  ok(await counts(SOLO2, 'machine') === true && await counts(SOLO2_PUUID, 'puuid') === true, 'neither key is crowded');

  // A crowd counts only when its holders are different people by an
  // independent key: four different Riot accounts on one machine id.
  tick();
  const CLONE = sha('cafe-image-guid');
  const cafe = [];
  for (const who of ['cafe.a', 'cafe.b', 'cafe.c', 'cafe.d']) {
    const u = newUser(`${who}@example.com`);
    cafe.push({ u, h: await signIn(u, { deviceId: `cafe-seat-${cafe.length}`, machineId: CLONE, ip: '198.51.100.240' }) });
  }
  const cafePuuid = (i) => `cafe000${i}-1111-4222-8333-444455556666`;
  for (let i = 0; i < cafe.length; i++) {
    tick();
    await liveGame(cafe[i].h);
    await linkOf(cafe[i].h, cafePuuid(i));
  }
  tick(31 * 1000);
  const cafeD = await claim(cafe[3].h);
  ok(T('free_allowance_keys').filter((k) => k.key_hash === fa.keyOf('machine', CLONE, env)).length === 4,
    'four accounts hold the one cloned machine id');
  ok(await counts(CLONE, 'machine') === false, 'four different Riot accounts on it: crowded, other people');
  ok(cafeD.body.granted === true && freeRows(cafe[3].u) === 2,
    'a 4th player on a cloned machine id, on their own Riot account, plays both free games');

  // One account shown four Riot accounts (a modified client naming four
  // players of its one match) makes no crowd: each holder counts its first.
  tick();
  const MANY = sha('many-riot-ids-guid');
  const MANY_A = newUser('many.a@example.com');
  const hMANY_A = await signIn(MANY_A, { deviceId: 'many-a', machineId: MANY, ip: '198.51.100.246' });
  await liveGame(hMANY_A);
  const manyPuuid = (i) => `aa11000${i}-1111-4222-8333-444455556666`;
  for (let i = 0; i < 4; i++) { tick(1000); await linkOf(hMANY_A, manyPuuid(i)); }
  ok(noted(MANY_A, manyPuuid(0)) && [1, 2, 3].every((i) => !noted(MANY_A, manyPuuid(i))),
    'its live game lets only the first be noted: one Riot account per account');
  ok(await counts(MANY, 'machine') === true, 'so its machine id is not crowded: one holder holds one Riot account');
  tick();
  const MANY_B = newUser('many.b@example.com');
  const hMANY_B = await signIn(MANY_B, { deviceId: 'many-b', machineId: MANY, ip: '198.51.100.246' });
  await claim(hMANY_A);
  tick(31 * 1000);
  const mb1 = await claim(hMANY_B);
  tick();
  const mb2 = await claim(hMANY_B);
  ok(mb1.body.granted === true && mb2.body.granted === false && mb2.body.reason === 'person',
    `so a second account on that machine still plays one free game, not two (${mb2.body.reason})`);

  // The crowd one person makes: 4 Windows user names on one machine, no Riot account seen.
  tick();
  const SOLO = sha('solo-four-names-guid');
  const solo = [];
  for (const who of ['solo.a', 'solo.b', 'solo.c', 'solo.d']) {
    const u = newUser(`${who}@example.com`);
    solo.push({ u, h: await signIn(u, { deviceId: `solo-name-${solo.length}`, machineId: SOLO, ip: '198.51.100.242' }) });
  }
  await claim(solo[0].h); tick(); await claim(solo[0].h);
  tick(31 * 1000);
  const soloD1 = await claim(solo[3].h);
  tick();
  const soloD2 = await claim(solo[3].h);
  ok(await counts(SOLO, 'machine') === true && soloD1.body.granted === true && soloD2.body.granted === false
    && soloD2.body.reason === 'person' && freeRows(solo[3].u) === 1,
  `4 Windows user names of one person with no Riot account seen never make a crowd: the 4th plays one, never two (${soloD2.body.reason})`);

  // The crowd one person makes of their own Riot account: A plays both free
  // games, B and C on the same PC with that Riot account push it to 3 holders.
  tick();
  const SELF_M = sha('self-puuid-crowd-guid');
  const SELF_PUUID = '5e1f5e1f-1111-4222-8333-444455556666';
  const selfA = newUser('selfcrowd.a@example.com');
  const hSelfA = await signIn(selfA, { deviceId: 'self-name-a', machineId: SELF_M, ip: '198.51.100.244' });
  await liveGame(hSelfA); tick(); await claim(hSelfA);
  await linkOf(hSelfA, SELF_PUUID);
  const selfOut = [];
  for (const who of ['selfcrowd.b', 'selfcrowd.c']) {
    tick();
    const u = newUser(`${who}@example.com`);
    const h = await signIn(u, { deviceId: `self-name-${who}`, machineId: SELF_M, ip: '198.51.100.244' });
    await liveGame(h);
    await linkOf(h, SELF_PUUID);
    tick(31 * 1000);
    selfOut.push({ u, r: await claim(h) });
  }
  ok(T('free_allowance_keys').filter((k) => k.key_hash === fa.keyOf('puuid', SELF_PUUID, env)).length === 3
    && await counts(SELF_PUUID, 'puuid') === true,
  'a Riot account held by 3 accounts on one machine is not crowded: one person');
  ok(selfOut.every((x) => x.r.body.granted === false && x.r.body.reason === 'person' && freeRows(x.u) === 1),
    `so B and C, who made that crowd themselves, get no second free game back (${selfOut.map((x) => x.r.body.reason)})`);
  // Three machines but two mailboxes (a.b and ab at gmail are one): still one person by the email.
  tick();
  const TWO_MAIL_PUUID = '2a112a11-1111-4222-8333-444455556666';
  let tm = 0;
  for (const [email, m] of [['pq@gmail.com', 'tm-1'], ['p.q+x@gmail.com', 'tm-2'], ['tm.other@example.com', 'tm-3']]) {
    const u = newUser(email);
    const h = await signIn(u, { deviceId: `two-mail-${m}`, machineId: sha(m), ip: '198.51.100.245' });
    await sb.rpc('grant_purchased_games', { p_user: u, p_games: 1, p_ref: `cs_test_tm_${++tm}`, p_amount_cents: 200 });
    tick();
    await liveGame(h);
    await linkOf(h, TWO_MAIL_PUUID);
  }
  ok(T('free_allowance_keys').filter((k) => k.key_hash === fa.keyOf('puuid', TWO_MAIL_PUUID, env)).length === 3
    && await counts(TWO_MAIL_PUUID, 'puuid') === true, 'a Riot account on 3 machines with only 2 distinct emails is not crowded');
  // Three on one machine still count as one person (section 2 holds two).
  tick();
  const M3 = sha('three-accounts-guid');
  const trio = [];
  for (const who of ['trio.a', 'trio.b', 'trio.c']) {
    const u = newUser(`${who}@example.com`);
    trio.push({ u, h: await signIn(u, { deviceId: `trio-${trio.length}`, machineId: M3, ip: '198.51.100.241' }) });
  }
  await claim(trio[0].h);
  tick(31 * 1000);
  const trioC1 = await claim(trio[2].h);
  tick();
  const trioC2 = await claim(trio[2].h);
  ok(trioC1.body.granted === true && trioC2.body.granted === false && trioC2.body.reason === 'person',
    `three accounts on one machine id are still one player past each one's first game (${trioC2.body.reason})`);

  // ── 12d. One Riot account per account ────────────────────────────────────
  // Only the first puuid ever noted for an account is its key: a griefer who
  // names other players of its match takes one victim per account at most.
  tick();
  const puuidRowsOf = (u) => T('free_allowance_keys').filter((k) => k.user_id === u && k.kind === 'puuid');
  const ONE_A = '0a1e0001-1111-4222-8333-444455556666';
  const ONE_B = '0a1e0002-1111-4222-8333-444455556666';
  const ONE = newUser('one.riot@example.com');
  const hONE = await signIn(ONE, { deviceId: 'pc-one-riot', machineId: sha('m-one-riot'), ip: '192.0.2.176' });
  ok(await liveGame(hONE), 'an account plays a live game');
  const oneA = await linkOf(hONE, ONE_A);
  ok(noted(ONE, ONE_A) && oneA.shared === false, 'its first Riot account is noted');
  const firstSeen = puuidRowsOf(ONE)[0].first_seen;
  tick(1000);
  const secondBefore = allowance.counts.secondPuuid;
  const oneB = await linkOf(hONE, ONE_B);
  ok(!noted(ONE, ONE_B) && puuidRowsOf(ONE).length === 1 && oneB.shared === null && allowance.counts.secondPuuid === secondBefore + 1,
    'a second, different Riot account is never noted (refused before the database)');
  allowance._caches.held.clear();
  await sb.rpc('free_allowance_note', { p_user: ONE, p_keys: [{ kind: 'puuid', key: fa.keyOf('puuid', ONE_B, env) }] });
  ok(!noted(ONE, ONE_B) && puuidRowsOf(ONE).length === 1, 'and the database refuses it too, when the server could not say');
  tick(1000);
  allowance._caches.noted.clear();
  const oneAgain = await linkOf(hONE, ONE_A);
  ok(noted(ONE, ONE_A) && puuidRowsOf(ONE).length === 1 && puuidRowsOf(ONE)[0].first_seen === firstSeen
    && puuidRowsOf(ONE)[0].last_seen === iso(clock) && oneAgain.shared === false,
  'the same Riot account again is fine: one row, its first_seen kept, last_seen moved');

  // A griefer names three other players of its match: one victim at most.
  tick();
  const GR = newUser('griefer.three@example.com');
  const hGR = await signIn(GR, { deviceId: 'pc-griefer-3', machineId: sha('m-griefer-3'), ip: '192.0.2.177' });
  ok(await liveGame(hGR) && freeRows(GR) === 1, 'a griefer plays its first free game live');
  const victimPuuid = (i) => `71c71a0${i}-1111-4222-8333-444455556666`;
  for (let i = 0; i < 3; i++) { tick(1000); await linkOf(hGR, victimPuuid(i)); }
  ok(puuidRowsOf(GR).length === 1 && noted(GR, victimPuuid(0)), 'and names three other players: only the first is noted, its victim list is one');
  const victims = [];
  for (let i = 0; i < 3; i++) {
    tick();
    const u = newUser(`victim.${i}@example.com`);
    const h = await signIn(u, { deviceId: `pc-victim-${i}`, machineId: sha(`m-victim-${i}`), ip: `192.0.2.${190 + i}` });
    const first = await liveGame(h);
    await linkOf(h, victimPuuid(i));
    tick(31 * 1000);
    victims.push({ u, first, second: await claim(h) });
  }
  ok(victims.slice(1).every((v) => v.first === true && v.second.body.granted === true && freeRows(v.u) === 2),
    'the second and third players it named keep both free games');
  ok(victims[0].first === true && victims[0].second.body.granted === false && victims[0].second.body.reason === 'person',
    `only the first can be touched, and only by an account that played first (${victims[0].second.body.reason})`);

  // A second puuid written before this rule (or by a race) is ignored: accounts meet through the first only.
  tick();
  const LEG = newUser('legacy.two@example.com');
  const hLEG = await signIn(LEG, { deviceId: 'pc-legacy-two', machineId: sha('m-legacy-two'), ip: '192.0.2.195' });
  await liveGame(hLEG);
  await linkOf(hLEG, '1e6a0001-1111-4222-8333-444455556666');
  const LEG_SECOND = '1e6a0002-1111-4222-8333-444455556666';
  tick(1000);
  T('free_allowance_keys').push({ key_hash: fa.keyOf('puuid', LEG_SECOND, env), kind: 'puuid', user_id: LEG, first_seen: iso(clock), last_seen: iso(clock) });
  tick();
  const LV = newUser('legacy.victim@example.com');
  const hLV = await signIn(LV, { deviceId: 'pc-legacy-victim', machineId: sha('m-legacy-victim'), ip: '192.0.2.196' });
  const lv1 = await liveGame(hLV);
  await linkOf(hLV, LEG_SECOND);
  tick(31 * 1000);
  const lv2 = await claim(hLV);
  const legRel = (await sb.rpc('free_allowance_related', { p_a: LEG, p_b: LV })).data;
  ok(puuidRowsOf(LEG).length === 2 && lv1 === true && lv2.body.granted === true && freeRows(LV) === 2 && legRel === false,
    'an old second puuid row of an account blocks no one and relates no one');

  // ── 12e. The machine id on every /account/me ─────────────────────────────
  // An account signed in on 8.7.3 or earlier never sent its machine id: the
  // first 8.7.4 launch sends it on /me, and the server notes it as at exchange.
  tick();
  const OLD_M = sha('old-session-machine-guid');
  const machineRows = (u) => T('free_allowance_keys').filter((k) => k.user_id === u && k.kind === 'machine');
  const keySet = (u) => JSON.stringify(T('free_allowance_keys').filter((k) => k.user_id === u).map((k) => k.key_hash).sort());
  const OS = newUser('oldsession@example.com');
  const hOS = await signIn(OS, { deviceId: 'old-session-user-1', ip: '192.0.2.197' });
  await claim(hOS);
  ok(machineRows(OS).length === 0, 'an account signed in before 8.7.4 has no machine key');
  const osKeys = keySet(OS);
  const m0 = await me(hOS);
  const malformed = ['not-a-machine-id', 'a'.repeat(63), `${sha('x')}ff`, `${sha('x').slice(0, 60)}zzzz`, '', `${sha('x')}, ${sha('y')}`];
  ok(malformed.every((v) => !/^[0-9a-f]{64}$/.test(v)), 'none of the malformed values is 64 hex');
  const mBad = [];
  for (const v of malformed) { tick(); mBad.push(await call(router, 'GET', '/account/me', { headers: { ...hOS, 'X-Occlara-Machine': v } })); }
  ok(m0.status === 200 && m0.body.left === FREE_GAMES - 1 && mBad.every((r) => r.status === 200 && r.body.left === FREE_GAMES - 1 && r.body.free_shared === false)
    && machineRows(OS).length === 0 && keySet(OS) === osKeys,
  'a missing or malformed X-Occlara-Machine changes nothing: no key, the same answer');
  tick();
  const m1 = await call(router, 'GET', '/account/me', { headers: { ...hOS, 'X-Occlara-Machine': OLD_M } });
  ok(m1.status === 200 && machineRows(OS).length === 1 && machineRows(OS)[0].key_hash === fa.keyOf('machine', OLD_M, env),
    'the first 8.7.4 /me notes its machine key, hashed as the exchange hashes it');
  ok(m1.body.left === FREE_GAMES - 1 && m1.body.free_shared === false, 'and the account itself is untouched');
  tick();
  const m2 = await call(router, 'GET', '/account/me', { headers: { ...hOS, 'X-Occlara-Machine': OLD_M } });
  ok(m2.status === 200 && machineRows(OS).length === 1, 'sent again, it is the same one key');
  tick();
  const OS2 = newUser('oldsession.alt@example.com');
  const hOS2 = await signIn(OS2, { deviceId: 'old-session-user-2', machineId: OLD_M, ip: '192.0.2.198' });
  const os1 = await claim(hOS2);
  tick();
  const os2 = await claim(hOS2);
  ok(os1.body.granted === true && os2.body.granted === false && os2.body.reason === 'person' && freeRows(OS2) === 1,
    `a second account under a new Windows user on that PC then meets it: one free game, never two (${os2.body.reason})`);
  const osRel = (await sb.rpc('free_allowance_related', { p_a: OS, p_b: OS2 })).data;
  ok(osRel === true && (await me(hOS)).body.left === FREE_GAMES - 1, 'the two are related through the machine key, the first keeps the rest of its games');
  // An old app sends no header: an account never gains a machine key from /me.
  tick();
  const OS3 = newUser('oldapp.me@example.com');
  const hOS3 = await signIn(OS3, { deviceId: 'old-app-me', ip: '192.0.2.199' });
  for (let i = 0; i < 3; i++) { tick(); await me({ ...hOS3, 'X-Occlara-Version': '8.7.3' }); }
  ok(machineRows(OS3).length === 0, 'an old app that sends none changes nothing');

  // ── 13. The SQL not applied: today exactly ───────────────────────────────
  {
    const sb2 = makeSupabase();
    const users2 = {};
    sb2.reset({ accounts: true, now, userRecords: users2 });
    const res2 = callers.createResolver({ supabase: sb2, fetch: issuer.fetch, now, env, checkKey: async () => 'invalid', keyOwner: () => null });
    const al2 = fa.createAllowance({ supabase: sb2, resolver: res2, now, env });
    const m2 = usage.createMeter({ supabase: sb2, resolver: res2, now, env, allowance: al2 });
    const r2 = usage.createRouter({ supabase: sb2, resolver: res2, meter: m2, env, now, allowance: al2 });
    const mk = (email) => { const id = crypto.randomUUID(); users2[id] = { id, email, email_confirmed_at: iso(clock), created_at: iso(clock) }; return id; };
    const sign = async (u, dev) => {
      const code = b64(crypto.randomBytes(32)); const verifier = b64(crypto.randomBytes(40)); const state = b64(crypto.randomBytes(16));
      sb2._db.tables.auth_handoffs.push({ code_hash: sha(code), user_id: u, state, challenge: crypto.createHash('sha256').update(verifier).digest('base64url'),
        expires_at: iso(clock + 60e3), used_at: null });
      const r = await call(r2, 'POST', '/account/exchange', { body: { code, verifier, state, device_id: dev, device_name: 'PC' } });
      return { Authorization: `Bearer ${r.body.token}`, 'X-Occlara-Version': APP };
    };
    const one1 = mk('same@gmail.com');
    const two1 = mk('s.ame@gmail.com');
    const h1 = await sign(one1, 'old-1');
    const h2 = await sign(two1, 'old-2');
    const g = [];
    for (const h of [h1, h1, h2, h2]) {
      tick();
      g.push((await call(r2, 'POST', '/usage/claim', { headers: h, body: { game: 'valorant', kind: 'riot', client_match_id: `riot:o${g.length}` } })).body.granted);
    }
    const meTwo = await call(r2, 'GET', '/account/me', { headers: h2 });
    ok(g.every(Boolean) && meTwo.status === 200 && meTwo.body.free_shared === false && meTwo.body.live === true,
      'without the SQL, free games are per account as before, and /me answers as before');
    ok(res2.accountsLive() === true && al2.live() === false, 'a missing allowance function never marks accounts not live, only itself');
    const calls = sb2._db.rpcCalls.filter((c) => c.name === 'free_allowance_note').length;
    ok(calls === 1, `and it is asked once, then left alone for ${fa.RECHECK_MS / 60000} minutes (${calls} asks)`);
  }

  // ── 14. A database that hangs ────────────────────────────────────────────
  {
    const hang = { rpc: () => new Promise(() => {}), auth: { admin: { getUserById: async () => ({ data: { user: null }, error: null }) } } };
    const al3 = fa.createAllowance({ supabase: hang, resolver: { userOf: async () => null }, now: () => Date.now(), env, callMs: 50 });
    const t0 = Date.now();
    const r = await al3.noteCaller({ userId: A, deviceHash: sha('x') });
    ok(r.shared === null && Date.now() - t0 < 1000, `a hanging database costs at most CALL_MS and says nothing (${Date.now() - t0} ms)`);
    const rel3 = await al3.related(A, B);
    ok(rel3 === null, 'and "related" cannot say either, so nothing is refused on it');
  }

  // ── 15. What the app shows ───────────────────────────────────────────────
  {
    const st = normalizeState({ tier: 'free', used: 0, left: 0, free_total: 2, bonus_pool: 0, capped: true, free_shared: true });
    ok(st.free_shared === true && normalizeState({ tier: 'free', left: 2, free_total: 2 }).free_shared === false,
      'the app keeps free_shared from /me, false when the server does not say it');
    const cap = appUsage.capState(st);
    ok(cap && cap.capped && cap.upgrade === 'pro' && cap.body.startsWith('Free games are one per player.'),
      `the out of games card says it calmly, with the paywall (${cap && cap.body})`);
    const line = appUsage.gamesLeft(st);
    ok(line === 'You have no free games left, free games are one per player', `the quiet line (${line})`);
    ok(appUsage.gamesLeft({ tier: 'free', left: 0, free_total: 2, bonus_pool: 0 }) === 'You have used your 2 free games',
      'an account that used its own games is told so, as before');
    const view = { via: 'session', games: profile.gamesState(st) };
    const hero = profile.hero(view);
    ok(hero.number === '0' && hero.renew.startsWith('Free games are one per player.'), `the Profile page says it once (${hero.renew})`);
    const words = [cap.title, cap.body, line, hero.renew, appUsage.ONE_PER_PLAYER, fa.ONE_PER_PLAYER];
    ok(words.every((w) => !DASHES.test(w) && !w.includes(';')), 'no dash and no semicolon in any of it');
    ok(!/cheat|abuse|fraud|banned|caught/i.test(words.join(' ')), 'and no accusation');
  }

  // ── 16. machine-id.js ────────────────────────────────────────────────────
  {
    const out = '\r\nHKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Cryptography\r\n    MachineGuid    REG_SZ    1B2C3D4E-0000-4111-8222-333344445555\r\n';
    ok(machine.guidOf(out) === '1b2c3d4e-0000-4111-8222-333344445555', 'the MachineGuid is read out of reg query\'s answer');
    const pending = machine.machineId({ platform: 'win32', run: () => out });
    ok(pending && typeof pending.then === 'function', 'the machine id is a promise, so reg.exe never blocks the main process');
    const h = await pending;
    ok(/^[0-9a-f]{64}$/.test(h) && !h.includes('1b2c3d4e'), 'and sent only hashed');
    ok(await machine.machineId({ platform: 'win32', run: async () => out }) === h, 'an asynchronous reg query reads the same');
    ok(await machine.machineId({ platform: 'darwin', run: () => out }) === ''
      && await machine.machineId({ platform: 'win32', run: () => { throw new Error('no'); } }) === ''
      && await machine.machineId({ platform: 'win32', run: () => Promise.reject(new Error('timed out')) }) === '',
      'anything but a readable Windows value is empty, a failed or timed out read included');
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'services', 'machine-id.js'), 'utf8');
    ok(!/execFileSync|spawnSync|execSync/.test(src) && /execFile\(/.test(src) && /timeout: TIMEOUT_MS/.test(src),
      'machine-id.js runs reg.exe asynchronously, with a timeout, never a sync child process');
    const acct = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'services', 'account-service.js'), 'utf8');
    ok(machine.regPath({ SystemRoot: 'D:\\Win' }) === 'D:\\Win\\System32\\reg.exe'
      && machine.regPath({}) === 'C:\\Windows\\System32\\reg.exe' && machine.regPath({ SystemRoot: '  ' }) === 'C:\\Windows\\System32\\reg.exe',
    'reg.exe is run by its absolute path in System32 (SystemRoot, or C:\\Windows)');
    ok(src.includes('execFile(regPath(), [') && !src.includes("execFile('reg'") && !src.includes('execFile("reg"'),
      'and never looked up through PATH');
    ok(acct.includes('if (machine) body.machine_id = machine;'), 'the sign in sends it only when it could be read');
    ok(acct.includes('(await d.machineId())'), 'and waits on the read instead of taking a promise for the id');
  }

  // ── 17. The SQL file, when it can be found ───────────────────────────────
  {
    const candidates = [process.env.OCCLARA_FREE_ALLOWANCE_SQL,
      process.env.OCCLARA_SITE_DIR && path.join(process.env.OCCLARA_SITE_DIR, 'drizzle', 'migrations')].filter(Boolean);
    let file = null;
    for (const c of candidates) {
      try {
        const s = fs.statSync(c);
        if (s.isFile()) file = c;
        else if (s.isDirectory()) {
          const hit = fs.readdirSync(c).find((f) => /free_allowance|free-allowance/.test(f));
          if (hit) file = path.join(c, hit);
        }
      } catch { /* not there */ }
      if (file) break;
    }
    if (!file) console.log('SKIP  the free allowance SQL was not found (set OCCLARA_FREE_ALLOWANCE_SQL to the file)');
    else {
      const sql = fs.readFileSync(file, 'utf8');
      ok(/CREATE TABLE IF NOT EXISTS public\.free_allowance_keys/.test(sql), 'the SQL makes its table only if it is not there');
      const rls = sql.indexOf('ALTER TABLE public.free_allowance_keys ENABLE ROW LEVEL SECURITY');
      const grant = sql.indexOf('GRANT ALL ON public.free_allowance_keys TO service_role');
      // Lovable's rule: a table's grants come before its RLS statement.
      ok(rls > 0 && grant > 0 && grant < rls && sql.includes('REVOKE ALL ON public.free_allowance_keys FROM anon, authenticated'), 'grants before RLS, the service role only');
      ok(!/REFERENCES\s+auth\.users/i.test(sql), 'no foreign key to auth.users');
      for (const fn of ['free_allowance_first_free(uuid)', 'free_allowance_first_puuid(uuid)', 'free_allowance_key_counts(text, text)', 'free_allowance_apart(uuid, uuid)', 'free_allowance_shared(uuid)', 'free_allowance_related(uuid, uuid)',
        'free_allowance_lock(uuid)', 'free_allowance_note(uuid, jsonb)', 'claim_game(uuid, text, text, text, text, boolean)',
        'entitlement_allowance(public.entitlements)', 'entitlement_qualify_referral(uuid, text)']) {
        ok(sql.includes(`REVOKE ALL ON FUNCTION public.${fn} FROM PUBLIC, anon, authenticated;`)
          && sql.includes(`GRANT EXECUTE ON FUNCTION public.${fn} TO service_role;`), `${fn}: the service role only`);
      }
      ok(/pg_advisory_xact_lock\(hashtextextended\('free_allowance:'/.test(sql) && /ORDER BY key_hash/.test(sql),
        'claims are serialized per key, in key order');
      ok(/PERFORM public\.free_allowance_lock\(p_user\);\s*END IF;\s*SELECT \* INTO al FROM public\.entitlement_allowance\(e\);/.test(sql),
        'claim_game takes the locks before it works out the allowance');
      ok(/'\^\[0-9a-f\]\{64\}\$'/.test(sql) && /^[0-9a-f]{64}$/.test(sha('x')), 'the key check in SQL is the 64 hex pattern, which a real key matches');
      const PUUID_CROWD = /WHEN p_kind = 'puuid' THEN NOT \(\s+\(SELECT count\(DISTINCT t\.key_hash\) FROM theirs t\s+WHERE t\.kind = 'machine'\s+OR \(t\.kind = 'device' AND NOT EXISTS \(\s+SELECT 1 FROM theirs m WHERE m\.user_id = t\.user_id AND m\.kind = 'machine'\)\)\) >= 3\s+AND \(SELECT count\(DISTINCT t\.key_hash\) FROM theirs t WHERE t\.kind = 'email'\) >= 3\s+\)/;
      const DEVICE_CROWD = /WHEN p_kind IN \('device', 'machine'\) THEN\s+\(SELECT count\(DISTINCT f\.key_hash\) FROM first_puuid f\) < 4/;
      ok(PUUID_CROWD.test("WHEN p_kind = 'puuid' THEN NOT (\n  (SELECT count(DISTINCT t.key_hash) FROM theirs t\n WHERE t.kind = 'machine'\n OR (t.kind = 'device' AND NOT EXISTS (\n SELECT 1 FROM theirs m WHERE m.user_id = t.user_id AND m.kind = 'machine'))) >= 3\n AND (SELECT count(DISTINCT t.key_hash) FROM theirs t WHERE t.kind = 'email') >= 3\n )")
        && DEVICE_CROWD.test("WHEN p_kind IN ('device', 'machine') THEN\n (SELECT count(DISTINCT f.key_hash) FROM first_puuid f) < 4")
        && PUUID_CROWD.test(sql) && DEVICE_CROWD.test(sql),
      'a puuid is crowded only across 3 machines and 3 emails, a device or machine only across 4 Riot accounts');
      const FIRST_PUUID = /first_puuid AS \(\s+SELECT DISTINCT ON \(t\.user_id\) t\.user_id, t\.key_hash\s+FROM theirs t WHERE t\.kind = 'puuid'\s+ORDER BY t\.user_id, t\.first_seen, t\.key_hash\s+\)/;
      ok(FIRST_PUUID.test("first_puuid AS (\n SELECT DISTINCT ON (t.user_id) t.user_id, t.key_hash\n FROM theirs t WHERE t.kind = 'puuid'\n ORDER BY t.user_id, t.first_seen, t.key_hash\n )")
        && FIRST_PUUID.test(sql) && /SELECT x\.user_id, x\.kind, x\.key_hash, x\.first_seen/.test(sql),
      'each holder counts its first noted puuid only toward a crowd');
      const MACHINE_ALONE = /WHERE \(met\.beyond_machine OR \(me\.t IS NOT NULL AND NOT public\.free_allowance_apart\(p_user, met\.user_id\)\)\)/;
      ok(MACHINE_ALONE.test('WHERE (met.beyond_machine OR (me.t IS NOT NULL AND NOT public.free_allowance_apart(p_user, met.user_id)))')
        && MACHINE_ALONE.test(sql) && /bool_or\(mine\.kind <> 'machine'\) AS beyond_machine/.test(sql),
      'met on the machine alone: one free game first, the second only once the Riot accounts differ');
      const APART = /CREATE OR REPLACE FUNCTION public\.free_allowance_apart\(p_a uuid, p_b uuid\)/;
      const APART_BODY = /SELECT coalesce\(pa\.k IS NOT NULL AND pb\.k IS NOT NULL AND pa\.k <> pb\.k, false\)\s+FROM \(SELECT public\.free_allowance_first_puuid\(p_a\) AS k\) pa,\s+\(SELECT public\.free_allowance_first_puuid\(p_b\) AS k\) pb;/;
      ok(APART.test('CREATE OR REPLACE FUNCTION public.free_allowance_apart(p_a uuid, p_b uuid)') && APART.test(sql)
        && APART_BODY.test('SELECT coalesce(pa.k IS NOT NULL AND pb.k IS NOT NULL AND pa.k <> pb.k, false)\n  FROM (SELECT public.free_allowance_first_puuid(p_a) AS k) pa,\n       (SELECT public.free_allowance_first_puuid(p_b) AS k) pb;')
        && APART_BODY.test(sql),
      'apart: both have their one Riot account noted and the two differ');
      // One Riot account per account, in the database too.
      const FIRST_FN = /CREATE OR REPLACE FUNCTION public\.free_allowance_first_puuid\(p_user uuid\)\s+RETURNS text[\s\S]*?WHERE k\.user_id = p_user AND k\.kind = 'puuid'\s+ORDER BY k\.first_seen, k\.key_hash\s+LIMIT 1;/;
      ok(FIRST_FN.test("CREATE OR REPLACE FUNCTION public.free_allowance_first_puuid(p_user uuid)\nRETURNS text\nAS $f$\n  SELECT k.key_hash FROM public.free_allowance_keys k\n  WHERE k.user_id = p_user AND k.kind = 'puuid'\n  ORDER BY k.first_seen, k.key_hash\n  LIMIT 1;")
        && FIRST_FN.test(sql), 'an account\'s one Riot account is its first noted (first_seen, then key)');
      const NOTE_ONE = /IF \(k ->> 'kind'\) = 'puuid' THEN\s+PERFORM pg_advisory_xact_lock\(hashtextextended\('free_allowance_puuid:' \|\| p_user::text, 0\)\);\s+IF EXISTS \(SELECT 1 FROM public\.free_allowance_keys x\s+WHERE x\.user_id = p_user AND x\.kind = 'puuid' AND x\.key_hash <> \(k ->> 'key'\)\) THEN\s+CONTINUE;/;
      ok(NOTE_ONE.test("IF (k ->> 'kind') = 'puuid' THEN\n  PERFORM pg_advisory_xact_lock(hashtextextended('free_allowance_puuid:' || p_user::text, 0));\n  IF EXISTS (SELECT 1 FROM public.free_allowance_keys x\n     WHERE x.user_id = p_user AND x.kind = 'puuid' AND x.key_hash <> (k ->> 'key')) THEN\n    CONTINUE;")
        && NOTE_ONE.test(sql), 'free_allowance_note never writes a second, different puuid, under a lock per account');
      const MEET_ONE = /OR \(public\.free_allowance_first_puuid\((p_user|p_a)\) = (mine|a)\.key_hash\s+AND public\.free_allowance_first_puuid\((other\.user_id|p_b)\) = (mine|a)\.key_hash\)\)/g;
      ok((`OR (public.free_allowance_first_puuid(p_a) = a.key_hash\n AND public.free_allowance_first_puuid(p_b) = a.key_hash))`.match(MEET_ONE) || []).length === 1
        && (sql.match(MEET_ONE) || []).length === 2, 'free_allowance_shared and free_allowance_related meet through that one puuid only');
      ok(/AND \(p_kind <> 'puuid' OR public\.free_allowance_first_puuid\(h\.user_id\) = p_key\)/.test(sql),
        'and a puuid\'s holders, for a crowd, are the accounts whose one Riot account it is');
      ok(fa.CROWD.puuid.machines === 3 && fa.CROWD.puuid.emails === 3 && fa.CROWD.machine.puuids === 4 && fa.CROWD.device.puuids === 4,
        'and free-allowance.js says the same numbers');
      const BY_ACCOUNTS = /count\(\*\) FROM public\.free_allowance_keys k WHERE k\.key_hash = p_key/;
      ok(BY_ACCOUNTS.test('(SELECT count(*) FROM public.free_allowance_keys k WHERE k.key_hash = p_key) <= 2') && !BY_ACCOUNTS.test(sql),
        'no key is crowded by a count of accounts any more');
      const COUNTED = /AND public\.free_allowance_key_counts\((mine|a)\.key_hash, (mine|a)\.kind\)/g;
      ok((sql.match(COUNTED) || []).length === 2, 'both free_allowance_shared and free_allowance_related skip a crowded key');
      const ENDED = /OR \(met\.direct AND \(oe\.status = 'ended' OR oended\.user_id IS NOT NULL\) AND \(me\.t IS NULL OR oe\.created_at < me\.t\)\)/;
      ok(ENDED.test("OR (met.direct AND (oe.status = 'ended' OR oended.user_id IS NOT NULL) AND (me.t IS NULL OR oe.created_at < me.t))") && ENDED.test(sql)
        && /LEFT JOIN public\.free_allowance_ended oended ON oended\.user_id = met\.user_id/.test(sql),
      'an account a refund ended, now or ever, made before this one played, counts as first');
      const DIRECT = /bool_or\(mine\.kind IN \('email', 'machine', 'device'\)\) AS direct/;
      ok(DIRECT.test("bool_or(mine.kind IN ('email', 'machine', 'device')) AS direct") && DIRECT.test(sql),
        'but only through an email, a machine or a device it shares, never a puuid alone');
      ok(/CREATE INDEX IF NOT EXISTS game_usage_live_at_idx/.test(sql), 'the live games around a match start are indexed');
      const ENDED_TABLE = /CREATE TABLE IF NOT EXISTS public\.free_allowance_ended/;
      ok(ENDED_TABLE.test('CREATE TABLE IF NOT EXISTS public.free_allowance_ended (') && ENDED_TABLE.test(sql)
        && sql.includes('ALTER TABLE public.free_allowance_ended ENABLE ROW LEVEL SECURITY')
        && sql.includes('REVOKE ALL ON public.free_allowance_ended FROM anon, authenticated')
        && sql.includes('GRANT ALL ON public.free_allowance_ended TO service_role'),
      'the ended accounts table is made only if not there, RLS on, the service role only');
      const TRIGGER = /DROP TRIGGER IF EXISTS free_allowance_mark_ended ON public\.entitlements;\s+CREATE TRIGGER free_allowance_mark_ended\s+AFTER INSERT OR UPDATE OF status ON public\.entitlements/;
      ok(TRIGGER.test('DROP TRIGGER IF EXISTS free_allowance_mark_ended ON public.entitlements;\nCREATE TRIGGER free_allowance_mark_ended\n  AFTER INSERT OR UPDATE OF status ON public.entitlements') && TRIGGER.test(sql)
        && /ON CONFLICT \(user_id\) DO NOTHING;/.test(sql)
        && sql.includes('REVOKE ALL ON FUNCTION public.free_allowance_mark_ended() FROM PUBLIC, anon, authenticated;'),
      'a trigger, made again safely, remembers every ended account, and the ones ended before it ran');
      ok(!DASHES.test(sql), 'no em or en dash in the SQL');
    }
  }

  console.log(`\n${checks - fails} of ${checks} passed`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

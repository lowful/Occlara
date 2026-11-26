'use strict';

/**
 * PUBLIC PROFILES AND PLAYER SEARCH, under /api/social (docs/claude/social.md).
 *
 *   GET  /status                 -> { live, riotProof }   no sign in needed
 *   GET  /me                     -> { profile | null, rules }
 *   GET  /username?name=         -> { ok, reason }    may this account take it now
 *   POST /username { name }      -> { ok, reason, nextAt }
 *   POST /flags { public, showRiotId, discoverable }  -> { ok, reason, profile }
 *   POST /stats { snapshot }     -> { ok, reason }    kept only while public
 *   GET  /profile?name=          -> { profile }  | 404 { error: 'not-found' }
 *   GET  /search?q=              -> { results: [...] } at most 10
 *   POST /block { name, on }     -> { ok, reason }
 *   POST /report { name, reason } -> { ok }           into the feedback reports
 *   POST /riot/start { riotId }  -> { ok, reason, challenge }   the proof of control
 *   POST /riot/check             -> { ok, result, challenge, profile }
 *
 * THE RIOT ID PROOF IS OFF unless SOCIAL_RIOT_PROOF is exactly '1' (it was
 * built without a live HenrikDev to try it on; the owner turns it on after
 * proving his own Riot ID). Off: /riot/start and /riot/check answer one
 * fixed 404 { ok: false, reason: 'not-available' } and call nothing, /status
 * says riotProof false, a Riot ID search is the empty answer of any miss, and
 * no profile or result shows a Riot ID (a rank shown is the player's PC's).
 *
 * AN ACCOUNT, SIGNED IN: only the app's session or the site's own sign in
 * (caller.via 'session' or 'jwt'). A licence key, even one linked to an
 * account, is 403 sign-in-required; no credentials at all is 401.
 *
 * NOTHING THAT NAMES AN ACCOUNT LEAVES: every answer is built field by field
 * (services/social.js), never a row passed through.
 *
 * NOT FOUND, PRIVATE AND BLOCKED ARE ONE ANSWER in shape; in time, server.js
 * holds every answer of /profile, /search, /username and /block to a floor
 * (rate-limits.js answerFloor), errors and refusals included.
 *
 * THE PROOF OF CONTROL. A Riot ID is shown only once its owner played three
 * (or four) owned agents the server named, in a row, on it, within four
 * hours: found in the account's match list and CONFIRMED match by match in
 * Riot's own match records (the player with that puuid in it, the agent,
 * the start). The sequence is unique among the open challenges on that Riot
 * account, and the matches a proof used can never serve another. Proof of
 * current control wins: a profile that held the Riot account loses it.
 * Every per account limit is the database's (social_challenge_attempt), the
 * attempt is counted before HenrikDev is asked, and no answer depends on
 * what any OTHER account did with that Riot ID but the generic "try again
 * later" when every sequence is taken.
 *
 * NOT LIVE: until social-001-profiles.sql runs, /status says { live: false }
 * and every other route 503 { error: 'social-not-live' }.
 */

const crypto = require('crypto');
const express = require('express');
const callers = require('../services/caller');
const social = require('../services/social');
const freeAllowance = require('../services/free-allowance');
const fb = require('../services/feedback');

const NOT_LIVE = { error: 'social-not-live' };
const NOT_AVAILABLE = { ok: false, reason: 'not-available' };
const REPORT_REASONS = ['username', 'impersonation', 'other'];
const VERSION_RE = /^\d{1,3}\.\d{1,3}\.\d{1,3}$/;
const NAME_LIKE = /^[A-Za-z0-9_]{1,20}$/;
const SIGNED_IN = new Set(['session', 'jwt']);
// A verified profile's rank: at most this many refreshes server wide in the
// window (the HenrikDev calls themselves also go through coach.js's budget).
const RANK_BUDGET = { windowMs: 10 * 60 * 1000, max: 20 };

/**
 * THE RANK, from the server and never from the app, for a verified profile,
 * at most once every RANK_MS a profile and RANK_BUDGET server wide, only when
 * the profile is viewed or its owner's app asks for its own, and only while
 * the proof is on. Never awaited by a route. Kept only when the Riot account
 * behind the name is the one the profile proved (the hash). A DIFFERENT
 * account behind the name unverifies at once ('renamed'); NO account behind
 * it is noted, and unverifies ('gone') only on a second time at least
 * GONE_MS after the first, so one failed lookup never takes a Riot ID away.
 */
function createRanker({ store, rank, now, env, log }) {
  const inflight = new Set();
  const asked = [];
  const counts = { asked: 0, kept: 0, unverified: 0, noted: 0, skipped: 0, failed: 0 };
  async function refresh(who) {
    if (typeof rank !== 'function') return null;
    try {
      const t = now();
      while (asked.length && t - asked[0] >= RANK_BUDGET.windowMs) asked.shift();
      if (asked.length >= RANK_BUDGET.max) { counts.skipped++; return null; }
      const due = await store.rankDue(who);
      if (!due || !due.key || !due.hash || inflight.has(due.key)) return null;
      inflight.add(due.key);
      asked.push(t);
      counts.asked++;
      try {
        const r = await rank(due.riot_name, due.riot_tag);
        if (!r || (r.status !== 'ok' && r.status !== 'none')) return null;
        if (r.status === 'none') {
          const g = await store.noteGone(due.key, due.hash);
          if (g === 'unverified') { counts.unverified++; log('[social] a verified Riot ID no longer resolves, twice 6 hours apart: unverified'); return 'unverified'; }
          counts.noted++;
          return 'noted';
        }
        const puuid = typeof r.puuid === 'string' ? r.puuid.trim().toLowerCase() : '';
        if (puuid && freeAllowance.keyOf('puuid', puuid, env()) === due.hash) {
          await store.setRank(due.key, due.hash, social.tierOf(r.current), social.tierOf(r.peak));
          counts.kept++;
          return 'kept';
        }
        await store.unverify(due.key, due.hash);
        counts.unverified++;
        log('[social] another Riot account is behind a verified name now: unverified');
        return 'unverified';
      } finally {
        inflight.delete(due.key);
      }
    } catch (e) {
      counts.failed++;
      if (!(e && e.notLive)) log(`[social] a rank was not refreshed: ${e && e.message}`);
      return null;
    }
  }
  return { refresh, counts };
}

function createRouter(deps = {}) {
  const router = express.Router();
  const store = deps.store || social.createStore(() => require('../db/supabase'));
  const resolver = deps.resolver || callers.shared;
  const now = deps.now || (() => Date.now());
  const env = () => deps.env || process.env;
  const log = deps.log || ((...a) => console.log(...a));
  const reports = deps.reports || fb.createStore(() => require('../db/supabase'));
  const uuid = deps.uuid || (() => crypto.randomUUID());
  // Riot's record: { account(name, tag), matches(region, name, tag), match(region, id) } (coach.js socialRiot).
  const riot = deps.riot || null;
  const rand = deps.rand || Math.random;
  const ranker = createRanker({ store, rank: deps.rank, now, env, log });
  const status = { at: 0, live: null };
  const proofOn = () => social.riotProofOn(env());
  // THE OWNER'S SWITCH (SOCIAL_ON exactly '1'): with the tables in place the
  // feature still answers "not live" to everyone until it is set, and unset
  // it hides again within the app's next status check, with no SQL undone.
  const switchedOn = () => String((env() && env().SOCIAL_ON) || '') === '1';

  const handle = (fn, o = {}) => async (req, res) => {
    if (!o.always && !switchedOn()) return res.status(503).json(NOT_LIVE);
    try { await fn(req, res); } catch (e) {
      if (e && e.notLive) { status.at = 0; return res.status(503).json(NOT_LIVE); }
      console.error('[social] route failed:', e && e.message);
      if (!res.headersSent) res.status(500).json({ error: 'social-failed' });
    }
  };

  /** The caller signed in to an account (an app session or a site sign in), answered for when there is none. */
  async function signedIn(req, res) {
    const r = req.caller ? { status: 'valid', caller: req.caller } : await resolver.identify(req);
    if (r && r.status === 'valid' && r.caller && r.caller.userId && SIGNED_IN.has(r.caller.via)) return r.caller;
    if (r && r.status === 'unavailable') { res.status(503).json({ error: 'account-unavailable', retry: true }); return null; }
    if (r && r.status === 'valid') { res.status(403).json({ error: 'sign-in-required' }); return null; }
    res.status(401).json({ error: 'sign-in-required' });
    return null;
  }

  const rules = () => ({
    usernameMin: social.USERNAME_MIN, usernameMax: social.USERNAME_MAX, changeDays: social.CHANGE_DAYS, holdDays: social.HOLD_DAYS,
    riotProof: proofOn(), challengeHours: social.CHALLENGE.TTL_MS / 3600000,
  });
  const bool = (v) => (v === true ? true : v === false ? false : null);
  async function meNow(userId) {
    const proof = proofOn();
    const [row, challenge] = await Promise.all([store.me(userId), proof ? store.challengeGet(userId) : null]);
    return social.meView(row, challenge, { proof });
  }

  // GET /api/social/status
  router.get('/status', handle(async (req, res) => {
    if (!switchedOn()) return res.json({ live: false, riotProof: false });
    if (status.live === null || now() - status.at > social.STATUS_MS) {
      status.live = await store.status();
      status.at = now();
    }
    res.json({ live: status.live === true, riotProof: status.live === true && proofOn() });
  }, { always: true }));

  // GET /api/social/me
  router.get('/me', handle(async (req, res) => {
    const caller = await signedIn(req, res);
    if (!caller) return;
    const profile = await meNow(caller.userId);
    // The owner's app asking is one of the two moments a rank may refresh.
    if (proofOn() && profile && profile.riot && profile.riot.state === 'verified') ranker.refresh({ user: caller.userId });
    res.json({ profile, rules: rules() });
  }));

  // GET /api/social/username?name=
  router.get('/username', handle(async (req, res) => {
    const caller = await signedIn(req, res);
    if (!caller) return;
    const c = social.checkUsername(String(req.query.name || ''));
    if (!c.ok) return res.json({ ok: false, reason: c.reason });
    const free = await store.nameFree(caller.userId, c.name);
    res.json({ ok: free === 'free' || free === 'yours', reason: ['yours', 'free', 'held'].includes(free) ? free : 'taken' });
  }));

  // POST /api/social/username { name }
  router.post('/username', handle(async (req, res) => {
    const caller = await signedIn(req, res);
    if (!caller) return;
    const c = social.checkUsername(String((req.body && req.body.name) || ''));
    if (!c.ok) return res.status(400).json({ ok: false, reason: c.reason });
    const r = await store.setUsername(caller.userId, c.name);
    if (!r || typeof r !== 'object') throw new Error('social_set_username answered nothing');
    res.json({ ok: r.ok === true, reason: String(r.reason || ''), nextAt: r.next_at ? new Date(r.next_at).toISOString() : null });
  }));

  // POST /api/social/flags { public, showRiotId, discoverable }
  router.post('/flags', handle(async (req, res) => {
    const caller = await signedIn(req, res);
    if (!caller) return;
    const b = req.body || {};
    const flags = { public: bool(b.public), showRiotId: bool(b.showRiotId), discoverable: bool(b.discoverable) };
    if (flags.public === null && flags.showRiotId === null && flags.discoverable === null) return res.status(400).json({ ok: false, reason: 'nothing' });
    const r = await store.setFlags(caller.userId, flags);
    if (!r || typeof r !== 'object') throw new Error('social_set_flags answered nothing');
    if (r.ok === true && flags.public === false) log('[social] a profile went private, its snapshot deleted');
    res.json({ ok: r.ok === true, reason: r.ok === true ? null : String(r.reason || ''), profile: await meNow(caller.userId) });
  }));

  // POST /api/social/stats { snapshot }
  router.post('/stats', handle(async (req, res) => {
    const caller = await signedIn(req, res);
    if (!caller) return;
    const c = social.cleanSnapshot(req.body && req.body.snapshot);
    if (!c.ok) return res.status(c.error === 'too-big' ? 413 : 400).json({ ok: false, reason: c.error });
    const r = await store.putStats(caller.userId, c.snapshot);
    if (!r || typeof r !== 'object') throw new Error('social_put_stats answered nothing');
    res.json({ ok: r.ok === true, reason: r.ok === true ? null : String(r.reason || '') });
  }));

  // GET /api/social/profile?name=
  router.get('/profile', handle(async (req, res) => {
    const caller = await signedIn(req, res);
    if (!caller) return;
    const name = String(req.query.name || '').trim();
    let view = null;
    if (NAME_LIKE.test(name)) {
      const key = social.keyOf(name);
      const row = await store.view(caller.userId, key);
      const proof = proofOn();
      view = social.profileView(row, { proof });
      if (proof && view && row.rank_due === true) ranker.refresh({ key });
    }
    if (!view) return res.status(404).json({ error: 'not-found' });
    res.json({ profile: view });
  }));

  // GET /api/social/search?q=
  router.get('/search', handle(async (req, res) => {
    const caller = await signedIn(req, res);
    if (!caller) return;
    const q = social.queryOf(String(req.query.q || ''));
    if (!q) return res.status(400).json({ error: 'query' });
    const proof = proofOn();
    // The proof off, a whole Riot ID finds what any miss finds: nothing.
    if (q.mode === 'riot' && !proof) return res.json({ results: [] });
    const rows = await store.search(caller.userId, q);
    const results = (Array.isArray(rows) ? rows : []).map((r) => social.resultView(r, { proof })).filter(Boolean).slice(0, social.SEARCH_MAX);
    res.json({ results });
  }));

  // POST /api/social/block { name, on }   the name kept as the blocker typed it
  router.post('/block', handle(async (req, res) => {
    const caller = await signedIn(req, res);
    if (!caller) return;
    const b = req.body || {};
    const name = String(b.name || '').trim();
    if (!NAME_LIKE.test(name)) return res.json({ ok: true });
    const r = await store.block(caller.userId, name, b.on !== false);
    if (!r || typeof r !== 'object') throw new Error('social_block answered nothing');
    res.json({ ok: r.ok === true, reason: r.ok === true ? null : String(r.reason || '') });
  }));

  // POST /api/social/report { name, reason }
  router.post('/report', handle(async (req, res) => {
    const caller = await signedIn(req, res);
    if (!caller) return;
    const b = req.body || {};
    const reason = REPORT_REASONS.includes(b.reason) ? b.reason : null;
    if (!reason) return res.status(400).json({ ok: false, reason: 'reason' });
    const name = String(b.name || '').trim();
    const target = NAME_LIKE.test(name) ? await store.reportTarget(caller.userId, social.keyOf(name)) : null;
    if (target && target.public_id) {
      const version = String((req.headers && req.headers['x-occlara-version']) || '');
      try {
        // No words of the reporter's: a reason from a fixed list, and the profile.
        await reports.insert({
          id: uuid(), account_id: fb.accountIdOf(caller), kind: 'broke',
          text: `Profile report (${reason}): username ${String(target.username).slice(0, 20)}, profile ${target.public_id}`,
          app_version: VERSION_RE.test(version) ? version : null, os: null, game: 'valorant', review_id: null,
          status: 'new', notes: null, pictures: 0,
        });
      } catch (e) {
        // The feedback table (feedback.sql) is its own: its failure is said as one.
        console.error('[social] a profile report could not be kept:', e && e.message);
        return res.status(503).json({ error: 'report-failed' });
      }
      log(`[social] a profile was reported (${reason})`);
    }
    // The same answer whether the name was a profile the caller can see or not.
    res.json({ ok: true });
  }));

  // ── The proof of control ────────────────────────────────────────────────

  const TRY_LATER = (res) => res.status(503).json({ ok: false, reason: 'try-later' });

  // POST /api/social/riot/start { riotId: "Name#TAG" }
  router.post('/riot/start', handle(async (req, res) => {
    if (!proofOn()) return res.status(404).json(NOT_AVAILABLE);
    const caller = await signedIn(req, res);
    if (!caller) return;
    const id = social.riotIdOf(String((req.body && req.body.riotId) || ''));
    if (!id) return res.status(400).json({ ok: false, reason: 'riot-id' });
    // The attempt is counted FIRST, whatever follows, and before HenrikDev is asked.
    const a = await store.challengeAttempt(caller.userId);
    if (a && a.open) return res.json({ ok: true, reason: 'open', challenge: social.challengeView(a.open) });
    if (a && a.reason) return res.status(a.reason === 'no-username' ? 409 : 429).json({ ok: false, reason: a.reason });
    if (!riot) return TRY_LATER(res);
    const acct = await riot.account(id.name, id.tag);
    if (acct.status === 'none') return res.status(404).json({ ok: false, reason: 'riot-not-found' });
    if (acct.status !== 'ok') return TRY_LATER(res);
    const list = await riot.matches(acct.region, acct.name, acct.tag);
    if (list.status !== 'ok') return TRY_LATER(res);
    const puuid = String(acct.puuid).toLowerCase();
    const recent = list.matches.filter((m) => !m.puuid || m.puuid === puuid).sort((x, y) => y.startedAt - x.startedAt).map((m) => m.agent);
    const cand = social.candidatesFor(recent);
    const hash = freeAllowance.keyOf('puuid', puuid, env());
    const r = await store.challengeStart(caller.userId, {
      hash, name: acct.name, tag: acct.tag, region: String(acct.region).toLowerCase(), candidates: cand.list, seed: String(rand()),
    });
    if (!r || typeof r !== 'object') throw new Error('social_challenge_start answered nothing');
    if (r.reason === 'open') return res.json({ ok: true, reason: 'open', challenge: social.challengeView(r.challenge) });
    // Every sequence of the length this account needs is held open by someone: the ordinary try later.
    if (!r.ok) return TRY_LATER(res);
    log(`[social] a proof of control was started (${cand.length} agents)`);
    res.json({ ok: true, reason: null, challenge: social.challengeView(r.challenge) });
  }));

  // POST /api/social/riot/check
  router.post('/riot/check', handle(async (req, res) => {
    if (!proofOn()) return res.status(404).json(NOT_AVAILABLE);
    const caller = await signedIn(req, res);
    if (!caller) return;
    // Counted, spaced and capped in the database before Riot is asked.
    const n = await store.challengeNoteCheck(caller.userId);
    if (!n || !n.ok) {
      const reason = (n && n.reason) || 'none';
      return res.status(reason === 'too-soon' ? 429 : 409).json({ ok: false, result: reason, challenge: n && n.challenge ? social.challengeView(n.challenge) : null });
    }
    const c = n.challenge;
    const done = async (result, progress = 0, code = 200) => {
      if (result === 'try-later') await store.challengeRefund(caller.userId, c.id);
      else if (result !== 'passed') await store.challengeResult(caller.userId, c.id, result, progress);
      const profile = await meNow(caller.userId);
      return res.status(code).json({ ok: result === 'passed', result, challenge: profile && profile.challenge, profile });
    };
    if (!riot) return done('try-later', 0, 503);
    const acct = await riot.account(c.riot_name, c.riot_tag);
    if (acct.status === 'none') return done('other-account');
    if (acct.status !== 'ok') return done('try-later', 0, 503);
    const puuid = String(acct.puuid).toLowerCase();
    const hashNow = freeAllowance.keyOf('puuid', puuid, env());
    // Another Riot account behind that name now (a rename): not this proof.
    if (hashNow !== n.hash) return done('other-account');
    const list = await riot.matches(acct.region, acct.name, acct.tag);
    if (list.status !== 'ok') return done('try-later', 0, 503);
    const issuedAt = Date.parse(c.issued_at);
    const expiresAt = Date.parse(c.expires_at);
    const usedUntil = n.used_until ? Date.parse(n.used_until) : -Infinity;
    const j = social.judge({ agents: c.agents, issuedAt, expiresAt }, list.matches, { puuid, now: now(), usedUntil });
    if (j.result !== 'passed') return done(j.result, j.progress);
    // CONFIRMED IN RIOT'S OWN MATCH RECORDS, match by match: the player with
    // this puuid in it, the agent of the sequence, and the start from the
    // record. A record without that player is not this account's match.
    const starts = [];
    for (let i = 0; i < j.picks.length; i++) {
      const rec = typeof riot.match === 'function' ? await riot.match(acct.region, j.picks[i].id) : { status: 'none' };
      if (rec.status === 'transient') return done('try-later', 0, 503);
      if (rec.status !== 'ok') return done('other-account');
      const played = social.agentOf(rec.agentOf(hashNow));
      if (!played) return done('other-account');
      if (played !== social.agentOf(c.agents[i])) return done('wrong-agent');
      starts.push(rec.startedAt);
    }
    const inside = starts.every((t, i) => t > issuedAt && t > usedUntil && t < expiresAt && (i === 0 || t > starts[i - 1]));
    if (!inside) return done('wrong-agent');
    const p = await store.challengePass(caller.userId, c.id, acct.name, acct.tag, starts[0], starts[starts.length - 1]);
    if (!p || !p.ok) return done(p && p.reason === 'used' ? 'used' : p && p.reason === 'no-username' ? 'no-username' : 'wrong-agent');
    log('[social] a Riot ID was proved');
    return done('passed', c.agents.length);
  }));

  router.ranker = ranker;
  return router;
}

module.exports = { createRouter, createRanker, NOT_LIVE, NOT_AVAILABLE, REPORT_REASONS, SIGNED_IN, RANK_BUDGET };

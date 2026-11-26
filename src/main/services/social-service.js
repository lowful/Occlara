'use strict';

/**
 * PUBLIC PROFILES AND PLAYER SEARCH, main's half (docs/claude/social.md).
 *
 * Every request to /api/social goes from here, with the account's own auth
 * (account-service.js auth()), and every answer reaches a page as finished
 * words (src/shared/social.js): the Profile page's "Public profile" section
 * and the Players page count nothing and name no URL.
 *
 * NOTHING HERE RUNS MID MATCH. Every method answers null while a match is in
 * progress or the window is sealed (busy), without asking the server, and the
 * snapshot upload waits: it is wanted, and sent by the next tick once the
 * match is over.
 *
 * THE SNAPSHOT (social.js snapshotOf, from the year record) goes up only while
 * the profile is public, when a review was saved since the last one (the
 * record's fingerprint moved, at most once every REVIEW_GAP_MS) and at launch
 * at most once every LAUNCH_GAP_MS. Making the profile private deletes it on
 * the server (social_set_flags); nothing here keeps it.
 *
 * deps: { api, auth, busy, rows, title, rank, riotId, agentArt, store, now, open(page), broadcast(payload), signedIn, log }
 *
 * rank() is the current and peak tier of the Riot ID in Settings as the
 * tracker profile holds it, sent in the snapshot and shown as "From this
 * player's PC" until the profile proves a Riot ID (then the server's own).
 */

const S = require('../../shared/social');

const STATUS_MS = 60 * 1000;
const REVIEW_GAP_MS = 10 * 60 * 1000;
const LAUNCH_GAP_MS = 3 * 60 * 60 * 1000;
const TICK_MS = 2 * 60 * 1000;
const TIMEOUT_MS = 8000;
const NAME_LIKE = /^[A-Za-z0-9_]{1,20}$/;

function createSocial(deps = {}) {
  const api = deps.api;
  const auth = deps.auth;
  const busy = deps.busy || (() => false);
  const now = deps.now || (() => Date.now());
  const log = deps.log || (() => {});
  const store = deps.store || { get: () => undefined, set: () => {} };
  const rows = deps.rows || (() => []);
  const broadcast = deps.broadcast || (() => {});

  const status = { at: 0, live: null, riotProof: false };
  let lastMe = null;          // the last /me profile, to know whether to upload
  let pending = null;         // the profile the Players page was opened at
  let wanted = false;         // an upload waits for the match to end
  let ticker = null;

  /**
   * Whether this app has anything to sign a request with (a session or a
   * key). With nothing, NO social request is made at all: the feature needs
   * an account, and a signed out app (or a check booted on an empty profile)
   * says nothing to the server about it.
   */
  function credentialed() {
    try { return !!(api && typeof api.authHeaders === 'function' && Object.keys(api.authHeaders(auth)).length); } catch { return false; }
  }

  /** One request: { ok, status, data } or { offline: true }. */
  async function call(method, path, body) {
    if (!credentialed()) return { ok: false, status: 401, data: { error: 'sign-in-required' } };
    try {
      return method === 'GET' ? await api.get(path, auth, TIMEOUT_MS) : await api.post(path, body || {}, auth, TIMEOUT_MS);
    } catch {
      return { offline: true };
    }
  }

  /** What went wrong, as one word a page can say. */
  function problem(r) {
    if (!r || r.offline) return 'offline';
    if (r.status === 401 || r.status === 403) return 'signed-out';
    if (r.status === 503 && r.data && r.data.error === 'social-not-live') return 'not-live';
    if (r.status === 429) return 'busy';
    if (r.status === 404) return 'not-found';
    return 'failed';
  }

  async function live() {
    if (status.live !== null && now() - status.at < STATUS_MS) return status.live;
    const r = await call('GET', '/api/social/status');
    if (r.offline || !r.ok) return null;
    status.live = !!(r.data && r.data.live === true);
    // The Riot ID proof, only while the server says it is open (SOCIAL_RIOT_PROOF).
    status.riotProof = !!(status.live && r.data && r.data.riotProof === true);
    status.at = now();
    return status.live;
  }

  /** The challenge's words for its panel: its steps, the time left and what the last check said. */
  function challengeWords(c) {
    if (!c) return null;
    return {
      ...S.challengeSteps(c),
      timeLeft: c.status === 'open' ? S.timeLeft(c.expiresAt, now()) : null,
      result: c.lastResult ? S.challengeLine(c.lastResult, c) : null,
      art: Array.isArray(c.agents) ? c.agents.map((a) => (typeof deps.agentArt === 'function' ? deps.agentArt(a) : null)) : [],
    };
  }

  function words(profile) {
    let typed = '';
    try { typed = typeof deps.riotId === 'function' ? String(deps.riotId() || '').trim() : ''; } catch { typed = ''; }
    return {
      riotProof: status.riotProof === true,
      riotLine: profile && status.riotProof && profile.riot ? S.riotLine(profile.riot) : null,
      whyProve: S.WHY_PROVE,
      // The Riot ID in Settings, offered in the field (the player can change it).
      riotIdTyped: typed.includes('#') ? typed.slice(0, 40) : '',
      challenge: profile ? challengeWords(profile.challenge) : null,
      publicExplain: status.riotProof ? S.PUBLIC_EXPLAIN : S.PUBLIC_EXPLAIN_NAME,
      publicMore: S.PUBLIC_MORE,
      discoverExplain: S.DISCOVER_EXPLAIN,
      nameHint: `${S.USERNAME_MIN} to ${S.USERNAME_MAX} letters, digits or underscores. It can change once every ${S.CHANGE_DAYS} days.`,
    };
  }

  /**
   * The Profile section's whole state: { live, signedIn, problem, profile,
   * rules, words, preview }, or null mid match.
   */
  async function state(opts) {
    if (busy()) return null;
    if (!credentialed()) return { live: null, signedIn: false, problem: 'signed-out', profile: null, words: words(null), preview: null };
    const isLive = await live();
    // The Players page and Home ask only whether the feature is open and
    // whether this app is signed in to an account: no profile is fetched.
    if (opts && opts.only === 'live') {
      let signed = null;
      try { signed = typeof deps.signedIn === 'function' ? !!(await deps.signedIn()) : null; } catch { signed = null; }
      return { live: isLive, riotProof: isLive === true && status.riotProof === true, signedIn: signed, problem: isLive === null ? 'offline' : isLive ? (signed === false ? 'signed-out' : null) : 'not-live' };
    }
    if (isLive === null) return { live: null, signedIn: null, problem: 'offline', profile: null, words: words(null), preview: null };
    if (!isLive) return { live: false, signedIn: null, problem: 'not-live', profile: null, words: words(null), preview: null };
    const r = await call('GET', '/api/social/me');
    if (r.offline || !r.ok) {
      const p = problem(r);
      if (p === 'not-live') { status.live = false; status.at = now(); }
      return { live: p !== 'not-live', signedIn: p === 'signed-out' ? false : null, problem: p, profile: null, words: words(null), preview: null };
    }
    const profile = r.data && r.data.profile ? r.data.profile : null;
    lastMe = profile;
    let preview = null;
    if (profile && profile.username) {
      const v = await call('GET', `/api/social/profile?name=${encodeURIComponent(profile.username)}`);
      preview = v.ok && v.data && v.data.profile ? S.profileModel(v.data.profile) : null;
    }
    return { live: true, riotProof: status.riotProof === true, signedIn: true, problem: null, profile, rules: (r.data && r.data.rules) || null, words: words(profile), preview };
  }

  /** The username as typed, checked here first and then by the server. */
  async function checkName(name) {
    if (busy()) return null;
    const c = S.checkUsername(name);
    if (!c.ok) return { ok: false, reason: c.reason, line: S.nameLine(c.reason) };
    const r = await call('GET', `/api/social/username?name=${encodeURIComponent(c.name)}`);
    if (r.offline || !r.ok) return { ok: false, reason: 'offline', line: S.nameLine('offline') };
    const reason = String((r.data && r.data.reason) || '');
    return { ok: r.data && r.data.ok === true, reason, line: S.nameLine(reason) };
  }

  async function setName(name) {
    if (busy()) return null;
    const c = S.checkUsername(name);
    if (!c.ok) return { ok: false, reason: c.reason, line: S.nameLine(c.reason) };
    const r = await call('POST', '/api/social/username', { name: c.name });
    if (r.offline || (!r.ok && r.status !== 400)) return { ok: false, reason: problem(r), line: S.nameLine('offline') };
    const reason = String((r.data && r.data.reason) || '');
    const out = { ok: r.data && r.data.ok === true, reason, line: S.nameLine(reason, { nextAt: r.data && r.data.nextAt }) };
    if (out.ok) { out.state = await state(); broadcast({}); }
    return out;
  }

  async function setFlags(f) {
    if (busy()) return null;
    const body = {};
    for (const k of ['public', 'showRiotId', 'discoverable']) if (f && typeof f[k] === 'boolean') body[k] = f[k];
    if (!Object.keys(body).length) return { ok: false, line: 'Nothing to change.' };
    const r = await call('POST', '/api/social/flags', body);
    if (r.offline || !r.ok || !r.data || r.data.ok !== true) {
      const p = problem(r);
      return { ok: false, line: r.data && r.data.reason === 'no-username' ? 'Pick a username first.' : p === 'offline' ? 'Could not save that. Check your connection and try again.' : 'Could not save that. Try again in a moment.' };
    }
    lastMe = r.data.profile || lastMe;
    // Made public: its numbers go up now, not at the next review.
    if (body.public === true) await sync({ reason: 'public' });
    const line = body.public === false ? 'Your profile is private. It is gone from search and its numbers were deleted from the server.'
      : body.public === true ? 'Your profile is public.' : 'Saved.';
    const st = await state();
    broadcast({});
    return { ok: true, line, state: st };
  }

  async function search(q) {
    if (busy()) return null;
    if (!S.searchable(q)) return { ok: false, error: 'short' };
    const r = await call('GET', `/api/social/search?q=${encodeURIComponent(String(q).trim())}`);
    if (r.offline || !r.ok) return { ok: false, error: problem(r) };
    const results = (r.data && Array.isArray(r.data.results) ? r.data.results : []).map(S.resultModel).filter(Boolean);
    return { ok: true, results };
  }

  async function view(username) {
    if (busy()) return null;
    const name = String(username || '').trim();
    if (!NAME_LIKE.test(name)) return { ok: false, error: 'not-found' };
    const r = await call('GET', `/api/social/profile?name=${encodeURIComponent(name)}`);
    if (r.offline || !r.ok) return { ok: false, error: problem(r) };
    const model = S.profileModel(r.data && r.data.profile);
    return model ? { ok: true, profile: model } : { ok: false, error: 'not-found' };
  }

  async function block(b) {
    if (busy()) return null;
    const name = String((b && b.name) || '').trim();
    if (!NAME_LIKE.test(name)) return { ok: false, line: 'That player could not be blocked.' };
    const on = !(b && b.on === false);
    const r = await call('POST', '/api/social/block', { name, on });
    if (r.offline || !r.ok || !r.data || r.data.ok !== true) return { ok: false, line: on ? 'Could not block right now. Try again in a moment.' : 'Could not unblock right now. Try again in a moment.' };
    broadcast({});
    return { ok: true, line: on ? `${name} is blocked. Neither of you can find or open the other's profile.` : `${name} is unblocked.` };
  }

  /**
   * THE PROOF OF CONTROL: start a challenge for a Riot ID typed as Name#TAG,
   * or check the open one. { ok, result, line, state }, or null mid match.
   */
  async function riotStart(riotId) {
    if (busy()) return null;
    const id = String(riotId || '').trim();
    if (!/^[^#]{1,24}#[^#]{2,8}$/.test(id)) return { ok: false, result: 'riot-id', line: S.challengeLine('riot-id') };
    const r = await call('POST', '/api/social/riot/start', { riotId: id });
    if (r.offline) return { ok: false, result: 'offline', line: S.challengeLine('offline') };
    const result = String((r.data && r.data.reason) || (r.ok ? 'open' : 'failed'));
    const st = await state();
    const c = r.data && r.data.challenge ? r.data.challenge : null;
    return { ok: !!(r.ok && r.data && r.data.ok), result, line: r.ok ? null : S.challengeLine(result, c), state: st };
  }
  async function riotCheck() {
    if (busy()) return null;
    const r = await call('POST', '/api/social/riot/check', {});
    if (r.offline) return { ok: false, result: 'offline', line: S.challengeLine('offline') };
    const result = String((r.data && r.data.result) || 'failed');
    const c = r.data && r.data.challenge ? r.data.challenge : null;
    const st = await state();
    if (result === 'passed') broadcast({});
    return { ok: result === 'passed', result, line: S.challengeLine(result, c || (st && st.profile && st.profile.challenge)), state: st };
  }

  async function report(b) {
    if (busy()) return null;
    const name = String((b && b.name) || '').trim();
    const reason = b && typeof b.reason === 'string' ? b.reason : '';
    if (!NAME_LIKE.test(name) || !['username', 'impersonation', 'other'].includes(reason)) return { ok: false, line: 'Pick what is wrong first.' };
    const r = await call('POST', '/api/social/report', { name, reason });
    if (r.offline || !r.ok) return { ok: false, line: 'The report could not be sent. Try again in a moment.' };
    return { ok: true, line: 'Thanks. The report went to the Occlara team.' };
  }

  /** The Players page, at a profile when one is named. Refused mid match. */
  function open(username) {
    if (busy()) return { ok: false, error: 'match' };
    const name = String(username || '').trim();
    pending = NAME_LIKE.test(name) ? name : null;
    if (typeof deps.open === 'function') deps.open('players');
    broadcast(pending ? { open: pending } : {});
    return { ok: true };
  }
  function take() {
    if (busy()) return null;
    const p = pending;
    pending = null;
    return p;
  }

  // ── The snapshot ────────────────────────────────────────────────────────
  function fingerprint(list) {
    const v = list.filter((r) => r && r.game === 'valorant');
    let at = 0;
    let g = 0;
    for (const r of v) { at = Math.max(at, Number(r.at) || 0); g += r.grade && Number.isFinite(r.grade.score) ? r.grade.score : 0; }
    return `${v.length}|${at}|${g}`;
  }

  /**
   * Uploads the snapshot when it should go: reason 'launch' (at most once
   * every LAUNCH_GAP_MS), 'review' (the record moved, at most once every
   * REVIEW_GAP_MS), 'public' (just made public), 'retry' (wanted mid match).
   * Resolves 'sent' | 'skipped' | 'waiting' | 'failed'.
   */
  async function sync({ reason = 'review' } = {}) {
    if (busy()) { wanted = true; return 'waiting'; }
    let list;
    try { list = rows() || []; } catch { list = []; }
    const fp = fingerprint(list);
    const last = store.get('socialSync') || {};
    const since = now() - (Number(last.at) || 0);
    if (reason === 'launch' && since < LAUNCH_GAP_MS) return 'skipped';
    if (reason === 'review' && (fp === last.fp || since < REVIEW_GAP_MS)) { if (fp !== last.fp) wanted = true; return 'skipped'; }
    if (reason === 'retry' && fp === last.fp && since < LAUNCH_GAP_MS) { wanted = false; return 'skipped'; }
    wanted = false;
    if (await live() !== true) return 'skipped';
    if (!lastMe || reason === 'launch') {
      const r = await call('GET', '/api/social/me');
      if (r.offline || !r.ok) return 'failed';
      lastMe = r.data && r.data.profile ? r.data.profile : null;
    }
    if (!lastMe || lastMe.public !== true) return 'skipped';
    let title = null;
    try { title = typeof deps.title === 'function' ? deps.title() : null; } catch { title = null; }
    let rank = null;
    try { rank = typeof deps.rank === 'function' ? deps.rank() : null; } catch { rank = null; }
    const snapshot = S.snapshotOf(list, { title, rank });
    if (!snapshot) return 'skipped';
    if (busy()) { wanted = true; return 'waiting'; }
    const r = await call('POST', '/api/social/stats', { snapshot });
    if (r.offline || !r.ok || !r.data || r.data.ok !== true) {
      if (r.data && r.data.reason === 'private') lastMe = { ...lastMe, public: false };
      log(`[social] the snapshot was not uploaded (${problem(r)}${r.data && r.data.reason ? `, ${r.data.reason}` : ''})`);
      return 'failed';
    }
    store.set('socialSync', { at: now(), fp });
    log(`[social] the snapshot was uploaded (${reason}, ${snapshot.matches} matches)`);
    return 'sent';
  }

  /** Every TICK_MS: a review saved since (the record moved), or an upload a match held back. */
  async function tick() {
    if (busy()) return null;
    return sync({ reason: wanted ? 'retry' : 'review' });
  }
  function start() {
    if (ticker) return;
    ticker = setInterval(() => { tick().catch(() => {}); }, TICK_MS);
    if (ticker && typeof ticker.unref === 'function') ticker.unref();
    setTimeout(() => { sync({ reason: 'launch' }).catch(() => {}); }, 20000).unref?.();
  }
  function stop() { if (ticker) clearInterval(ticker); ticker = null; }

  /** Signed out or another account: nothing of the last one is kept. */
  function forget() { lastMe = null; pending = null; status.at = 0; status.live = null; status.riotProof = false; }

  return { state, checkName, setName, setFlags, search, view, block, report, riotStart, riotCheck, open, take, sync, tick, start, stop, forget,
    _wanted: () => wanted };
}

module.exports = { createSocial, STATUS_MS, REVIEW_GAP_MS, LAUNCH_GAP_MS, TICK_MS };

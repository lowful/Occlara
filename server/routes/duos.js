'use strict';

/**
 * OCCLARA DUOS, under /api/social/duos (docs/claude/duos.md).
 *
 *   GET  /me                       -> { me }               the page's state
 *   POST /invite { name }          -> { ok, reason }        Max only; 'sent' whoever the name is
 *   POST /code                     -> { ok, reason, code, expiresAt }   Max only, the code once
 *   POST /accept { code } | { from } -> { ok, reason, username }
 *   POST /decline { from }         -> { ok }
 *   POST /cancel { ref }           -> { ok }               an invite this account sent
 *   POST /remove { name }          -> { ok }               ends the duo, deletes what it shared
 *   POST /report { matchId, us, them, agent } -> { ok, reason, matches, found }
 *   GET  /matches                  -> { matches }
 *   GET  /match?ref=               -> { match } | 404
 *   POST /sheet { ref, sheet }     -> { ok, reason }       while the duo is active
 *   POST /clip/start { ref, name, round, kind, marks } -> { ok, reason, clip, url, stored }
 *   POST /clip/done { clip }       -> { ok, reason }       the file looked up in storage
 *   POST /clip/url { clip }        -> { ok, reason, url, size }   10 s
 *   POST /pin { clip, at, label, reaction } -> { ok, reason, ref }
 *   POST /pin/remove { ref }       -> { ok }
 *   POST /seen                     -> { ok }
 *   POST /flag { name, reason }    -> { ok }               into the feedback reports
 *   GET  /discoverable             -> { on }               Discoverable as Duos reads it
 *   POST /discoverable { on }      -> { ok, reason }       under Duos' words (duos.md, "Consent")
 *
 * OFF UNLESS SOCIAL_DUOS_ON AND SOCIAL_ON ARE BOTH EXACTLY '1', and until
 * social-002-duos.sql has run: every route answers 503 { error:
 * 'duos-not-live' } before doing any work, and /api/social/status says
 * duos: false, so the app shows no trace of Duos.
 *
 * AN ACCOUNT, SIGNED IN: the app's session or the site's sign in only, never
 * a licence key, linked or not (403), none at all 401.
 *
 * THE PLAN IS THE DATABASE'S: every step that creates (an invite, a code) or
 * uploads (a sheet, a clip) asks public.entitlements fresh inside its SQL
 * function, never the client and never a cached tier. A duo with neither on
 * Max is paused there, on the next call, with nothing written.
 *
 * THE FILES NEVER PASS THROUGH THIS SERVER: an app uploads straight to the
 * private bucket at a path the database chose, through a signed upload URL
 * that writes the path once (no upsert),
 * and the partner downloads through a signed URL of 10 seconds. The bucket
 * refuses a file over 80 MB or of another type; the quota holds a clip's
 * whole 80 MB from the moment its URL is issued and is settled to the size
 * STORAGE reports once the file is seen stored.
 */

const crypto = require('crypto');
const express = require('express');
const callers = require('../services/caller');
const duos = require('../services/duos');
const social = require('../services/social');
const fb = require('../services/feedback');

const NOT_LIVE = { error: 'duos-not-live' };
const SIGNED_IN = new Set(['session', 'jwt']);
const NAME_LIKE = /^[A-Za-z0-9_]{1,20}$/;
const FLAG_REASONS = ['username', 'pins', 'clips', 'other'];
const VERSION_RE = /^\d{1,3}\.\d{1,3}\.\d{1,3}$/;
const STATUS_MS = 30 * 1000;
const SWEEP_BATCH = 200;   // files a tick removes at most (every 10 minutes), and as many stale uploads looked up

function createRouter(deps = {}) {
  const router = express.Router();
  const store = deps.store || duos.createStore(() => require('../db/supabase'));
  const resolver = deps.resolver || callers.shared;
  const now = deps.now || (() => Date.now());
  const env = () => deps.env || process.env;
  const log = deps.log || ((...a) => console.log(...a));
  const reports = deps.reports || fb.createStore(() => require('../db/supabase'));
  const uuid = deps.uuid || (() => crypto.randomUUID());
  const random = deps.random || crypto.randomBytes;
  const status = { at: 0, live: null };
  const switchedOn = () => duos.duosOn(env());
  const proofOn = () => social.riotProofOn(env());

  /** Whether the tables are there (remembered STATUS_MS). Never throws. */
  async function tablesLive() {
    if (status.live !== null && now() - status.at < STATUS_MS) return status.live;
    try { status.live = await store.status(); } catch { status.live = false; }
    status.at = now();
    return status.live;
  }
  /** What /api/social/status says of Duos: on, and its tables there. */
  async function live() {
    if (!switchedOn()) return false;
    return tablesLive();
  }

  const handle = (fn) => async (req, res) => {
    // Off: not live, before any lookup, any count, any write.
    if (!switchedOn()) return res.status(503).json(NOT_LIVE);
    try {
      if (!await tablesLive()) return res.status(503).json(NOT_LIVE);
      await fn(req, res);
    } catch (e) {
      if (e && e.notLive) { status.at = 0; return res.status(503).json(NOT_LIVE); }
      console.error('[duos] route failed:', e && e.message);
      if (!res.headersSent) res.status(500).json({ error: 'duos-failed' });
    }
  };

  async function signedIn(req, res) {
    const r = req.caller ? { status: 'valid', caller: req.caller } : await resolver.identify(req);
    if (r && r.status === 'valid' && r.caller && r.caller.userId && SIGNED_IN.has(r.caller.via)) return r.caller;
    if (r && r.status === 'unavailable') { res.status(503).json({ error: 'account-unavailable', retry: true }); return null; }
    if (r && r.status === 'valid') { res.status(403).json({ error: 'sign-in-required' }); return null; }
    res.status(401).json({ error: 'sign-in-required' });
    return null;
  }
  const body = (req) => (req.body && typeof req.body === 'object' ? req.body : {});
  const must = (r, what) => { if (!r || typeof r !== 'object') throw new Error(`${what} answered nothing`); return r; };
  const said = (r) => ({ ok: r.ok === true, reason: r.reason ? String(r.reason) : null });

  // GET /me
  router.get('/me', handle(async (req, res) => {
    const caller = await signedIn(req, res);
    if (!caller) return;
    res.json({ me: duos.meView(must(await store.me(caller.userId), 'social_duo_me'), { proof: proofOn() }), rules: rules() });
  }));

  // POST /invite { name }   'sent' whether or not the name is a profile this account may reach
  router.post('/invite', handle(async (req, res) => {
    const caller = await signedIn(req, res);
    if (!caller) return;
    const nm = String(body(req).name || '').trim();
    if (!NAME_LIKE.test(nm)) return res.status(400).json({ ok: false, reason: 'name' });
    const r = must(await store.inviteName(caller.userId, nm), 'social_duo_invite_name');
    if (r.ok) log('[duos] an invite by username was sent');
    res.json(said(r));
  }));

  // POST /code   a new invite code, shown once
  router.post('/code', handle(async (req, res) => {
    const caller = await signedIn(req, res);
    if (!caller) return;
    for (let i = 0; i < 3; i++) {
      const code = duos.mintCode(random);
      const r = must(await store.inviteCode(caller.userId, duos.codeHash(code, env())), 'social_duo_invite_code');
      if (r.reason === 'try-again') continue;
      if (!r.ok) return res.json(said(r));
      log('[duos] an invite code was made');
      return res.json({ ok: true, reason: null, code: duos.codeShown(code), expiresAt: r.expires_at ? new Date(r.expires_at).toISOString() : null });
    }
    res.status(503).json({ ok: false, reason: 'try-later' });
  }));

  // POST /accept { code } or { from }
  router.post('/accept', handle(async (req, res) => {
    const caller = await signedIn(req, res);
    if (!caller) return;
    const b = body(req);
    let r;
    if (typeof b.code === 'string') {
      const code = duos.codeOf(b.code);
      // A code of the wrong shape is a wrong code, and counted as one.
      r = must(await store.acceptCode(caller.userId, duos.codeHash(code || `x${String(b.code).slice(0, 20)}`, env())), 'social_duo_accept_code');
    } else {
      const from = String(b.from || '').trim();
      if (!NAME_LIKE.test(from)) return res.status(400).json({ ok: false, reason: 'name' });
      r = must(await store.acceptFrom(caller.userId, from), 'social_duo_accept_from');
    }
    if (r.ok && r.reason === 'paired') log('[duos] a duo was made');
    res.json({ ...said(r), username: r.ok && typeof r.username === 'string' && NAME_LIKE.test(r.username) ? r.username : null });
  }));

  router.post('/decline', handle(async (req, res) => {
    const caller = await signedIn(req, res);
    if (!caller) return;
    const from = String(body(req).from || '').trim();
    if (NAME_LIKE.test(from)) await store.decline(caller.userId, from);
    res.json({ ok: true });
  }));

  router.post('/cancel', handle(async (req, res) => {
    const caller = await signedIn(req, res);
    if (!caller) return;
    const ref = duos.refOf(body(req).ref);
    if (ref) await store.cancel(caller.userId, ref);
    res.json({ ok: true });
  }));

  router.post('/remove', handle(async (req, res) => {
    const caller = await signedIn(req, res);
    if (!caller) return;
    const nm = String(body(req).name || '').trim();
    if (!NAME_LIKE.test(nm)) return res.json({ ok: true });
    const r = must(await store.remove(caller.userId, nm), 'social_duo_remove');
    if (r.reason === 'ended') {
      log('[duos] a duo was ended, its shared matches deleted');
      sweepSoon();
    }
    res.json({ ok: true });
  }));

  // POST /report { matchId, us, them, agent }   one per live game the server metered
  router.post('/report', handle(async (req, res) => {
    const caller = await signedIn(req, res);
    if (!caller) return;
    const b = body(req);
    const id = duos.matchIdOf(b.matchId);
    const team = duos.teamOf(b.us, b.them, b.agent);
    const agent = social.agentOf(b.agent);
    if (!id || !team || !agent) return res.status(400).json({ ok: false, reason: 'match' });
    const r = must(await store.report(caller.userId, duos.matchHash(id, env()), team, agent), 'social_duo_report');
    if (!r.ok) return res.json({ ok: false, reason: String(r.reason || 'failed'), matches: [], found: [] });
    const matches = (Array.isArray(r.matches) ? r.matches : []).filter((m) => m && duos.refOf(m.ref) && NAME_LIKE.test(String(m.partner || '')))
      .map((m) => ({ ref: m.ref, partner: m.partner }));
    const found = (Array.isArray(r.found) ? r.found : []).filter((f) => f && NAME_LIKE.test(String(f.username || '')))
      .slice(0, 9).map((f) => ({ username: f.username, agent: social.agentOf(f.agent) }));
    if (matches.length) log(`[duos] a match was shared (${matches.length} duo${matches.length === 1 ? '' : 's'})`);
    res.json({ ok: true, reason: null, matches, found });
  }));

  router.get('/matches', handle(async (req, res) => {
    const caller = await signedIn(req, res);
    if (!caller) return;
    res.json({ matches: duos.matchesView(await store.matchesOf(caller.userId)) });
  }));

  router.get('/match', handle(async (req, res) => {
    const caller = await signedIn(req, res);
    if (!caller) return;
    const ref = duos.refOf(String(req.query.ref || ''));
    const view = ref ? duos.matchView(await store.match(caller.userId, ref)) : null;
    if (!view) return res.status(404).json({ error: 'not-found' });
    res.json({ match: view });
  }));

  // POST /sheet { ref, sheet }
  router.post('/sheet', handle(async (req, res) => {
    const caller = await signedIn(req, res);
    if (!caller) return;
    const b = body(req);
    const ref = duos.refOf(b.ref);
    const c = duos.cleanSheet(b.sheet);
    if (!ref) return res.status(400).json({ ok: false, reason: 'ref' });
    if (!c.ok) return res.status(c.error === 'too-big' ? 413 : 400).json({ ok: false, reason: c.error });
    res.json(said(must(await store.sheetPut(caller.userId, ref, c.sheet), 'social_duo_sheet_put')));
  }));

  // POST /clip/start { ref, name, round, kind, marks }
  router.post('/clip/start', handle(async (req, res) => {
    const caller = await signedIn(req, res);
    if (!caller) return;
    const b = body(req);
    const ref = duos.refOf(b.ref);
    const nm = typeof b.name === 'string' && duos.CLIP_NAME.test(b.name) ? b.name : null;
    const round = Number.isInteger(b.round) && b.round >= 1 && b.round <= duos.DUO.ROUNDS_MAX ? b.round : null;
    const kind = duos.CLIP_KINDS.includes(b.kind) ? b.kind : null;
    if (!ref || !nm || !round || !kind) return res.status(400).json({ ok: false, reason: 'clip' });
    // A declared size over the cap is refused before anything is held.
    if (Number.isFinite(b.size) && b.size > duos.DUO.CLIP_MAX_BYTES) return res.status(413).json({ ok: false, reason: 'too-big' });
    sweepSoon();
    const r = must(await store.clipStart(caller.userId, ref, { name: nm, round, kind, marks: duos.cleanMarks(b.marks) }), 'social_duo_clip_start');
    if (!r.ok) return res.json(said(r));
    if (r.stored) return res.json({ ok: true, reason: 'stored', stored: true, clip: r.ref, url: null });
    // A clip issued before: a file may already be at its path. Then it is
    // settled from the size storage reports, and no new URL is issued.
    if (r.reason === 'again') {
      const size = await store.stat(r.path);
      if (size !== null) {
        const d = must(await store.clipDone(caller.userId, r.ref, size), 'social_duo_clip_done');
        if (d.reason === 'too-big') sweepSoon();
        return res.json(d.ok ? { ok: true, reason: 'stored', stored: true, clip: r.ref, url: null } : { ok: false, reason: String(d.reason || 'failed') });
      }
    }
    const url = await store.signUpload(r.path);
    res.json({ ok: true, reason: null, stored: false, clip: r.ref, url, contentType: duos.MIME, maxBytes: duos.DUO.CLIP_MAX_BYTES });
  }));

  // POST /clip/done { clip }   the file is looked up in storage, never taken on the app's word
  router.post('/clip/done', handle(async (req, res) => {
    const caller = await signedIn(req, res);
    if (!caller) return;
    const ref = duos.refOf(body(req).clip);
    const at = ref ? await store.clipPath(caller.userId, ref) : null;
    if (!at || typeof at.path !== 'string') return res.status(404).json({ ok: false, reason: 'none' });
    if (at.status === 'stored') return res.json({ ok: true, reason: 'stored' });
    const size = await store.stat(at.path);
    const r = must(await store.clipDone(caller.userId, ref, size), 'social_duo_clip_done');
    if (r.reason === 'too-big') { log('[duos] a stored clip was not a clip (its size): removed'); sweepSoon(); }
    res.json(said(r));
  }));

  // POST /clip/url { clip }   a stored clip of this duo, a URL of 10 seconds
  router.post('/clip/url', handle(async (req, res) => {
    const caller = await signedIn(req, res);
    if (!caller) return;
    const ref = duos.refOf(body(req).clip);
    const r = ref ? must(await store.clipGet(caller.userId, ref), 'social_duo_clip_get') : { ok: false, reason: 'none' };
    if (!r.ok) return res.status(r.reason === 'budget' ? 429 : 404).json(said(r));
    res.json({ ok: true, reason: null, url: await store.signDownload(r.path), size: Number(r.size) || null });
  }));

  router.post('/pin', handle(async (req, res) => {
    const caller = await signedIn(req, res);
    if (!caller) return;
    const b = body(req);
    const clip = duos.refOf(b.clip);
    const at = Number.isInteger(b.at) && b.at >= 0 && b.at <= 600000 ? b.at : null;
    const label = duos.PIN_LABELS.includes(b.label) ? b.label : null;
    const reaction = b.reaction === null || b.reaction === undefined ? null : duos.REACTIONS.includes(b.reaction) ? b.reaction : undefined;
    if (!clip || at === null || !label || reaction === undefined) return res.status(400).json({ ok: false, reason: 'pin' });
    const r = must(await store.pin(caller.userId, clip, at, label, reaction), 'social_duo_pin');
    res.json({ ...said(r), ref: r.ok && duos.refOf(r.ref) ? r.ref : null });
  }));

  router.post('/pin/remove', handle(async (req, res) => {
    const caller = await signedIn(req, res);
    if (!caller) return;
    const ref = duos.refOf(body(req).ref);
    if (ref) await store.pinRemove(caller.userId, ref);
    res.json({ ok: true });
  }));

  router.post('/seen', handle(async (req, res) => {
    const caller = await signedIn(req, res);
    if (!caller) return;
    await store.seen(caller.userId);
    res.json({ ok: true });
  }));

  // POST /flag { name, reason }   a partner, or an account that invited this one
  router.post('/flag', handle(async (req, res) => {
    const caller = await signedIn(req, res);
    if (!caller) return;
    const b = body(req);
    const reason = FLAG_REASONS.includes(b.reason) ? b.reason : null;
    if (!reason) return res.status(400).json({ ok: false, reason: 'reason' });
    const nm = String(b.name || '').trim();
    const target = NAME_LIKE.test(nm) ? await store.reportTarget(caller.userId, nm) : null;
    if (target && target.public_id) {
      const version = String((req.headers && req.headers['x-occlara-version']) || '');
      try {
        await reports.insert({
          id: uuid(), account_id: fb.accountIdOf(caller), kind: 'broke',
          text: `Duo report (${reason}): username ${String(target.username).slice(0, 20)}, profile ${target.public_id}`,
          app_version: VERSION_RE.test(version) ? version : null, os: null, game: 'valorant', review_id: null,
          status: 'new', notes: null, pictures: 0,
        });
      } catch (e) {
        console.error('[duos] a duo report could not be kept:', e && e.message);
        return res.status(503).json({ error: 'report-failed' });
      }
      log(`[duos] a duo player was reported (${reason})`);
    }
    res.json({ ok: true });
  }));

  // Discoverable as Duos reads it: the 8.19 flag only once it was turned on
  // under Duos' own words, through this route (social-002's stamp).
  router.get('/discoverable', handle(async (req, res) => {
    const caller = await signedIn(req, res);
    if (!caller) return;
    res.json({ on: (await store.discoverable(caller.userId)) === true });
  }));
  router.post('/discoverable', handle(async (req, res) => {
    const caller = await signedIn(req, res);
    if (!caller) return;
    const on = body(req).on;
    if (typeof on !== 'boolean') return res.status(400).json({ ok: false, reason: 'on' });
    res.json(said(must(await store.setDiscoverable(caller.userId, on), 'social_duo_set_discoverable')));
  }));

  const rules = () => ({ ...duos.DUO, pinLabels: duos.PIN_LABELS, reactions: duos.REACTIONS });

  // ── The sweep ───────────────────────────────────────────────────────────
  // Runs whether or not the switch is on (expiry is enforced while Duos is
  // hidden too), only while the tables are there, one batch at a time.
  let sweeping = null;
  async function sweep(limit = SWEEP_BATCH) {
    if (sweeping) return sweeping;
    sweeping = (async () => {
      const out = { removed: 0, settled: 0, dropped: 0 };
      if (!await tablesLive()) return out;
      const s = await store.sweep(limit);
      const paths = (s && Array.isArray(s.paths) ? s.paths : []).filter((p) => typeof p === 'string');
      if (paths.length) {
        await store.removeFiles(paths);
        out.removed = await store.trashDone(paths);
      }
      for (const c of (s && Array.isArray(s.stale) ? s.stale : [])) {
        if (!c || !duos.refOf(c.ref) || typeof c.path !== 'string') continue;
        const size = await store.stat(c.path);
        if (size === null) { await store.clipDrop(c.ref); out.dropped++; } else { await store.clipSettle(c.ref, size); out.settled++; }
      }
      if (out.removed || out.dropped) log(`[duos] the sweep removed ${out.removed} file${out.removed === 1 ? '' : 's'}, dropped ${out.dropped} upload${out.dropped === 1 ? '' : 's'} never finished`);
      return out;
    })().catch((e) => {
      if (!(e && e.notLive)) console.error('[duos] the sweep failed:', e && e.message);
      return { removed: 0, settled: 0, dropped: 0, failed: true };
    }).finally(() => { sweeping = null; });
    return sweeping;
  }
  function sweepSoon() { Promise.resolve().then(() => sweep(10)).catch(() => {}); }

  router.live = live;
  router.sweep = sweep;
  return router;
}

module.exports = { createRouter, NOT_LIVE, FLAG_REASONS, SIGNED_IN };

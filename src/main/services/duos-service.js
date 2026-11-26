'use strict';

/**
 * OCCLARA DUOS, main's half (docs/claude/duos.md).
 *
 * Every request to /api/social/duos goes from here with the account's own
 * auth, every answer reaches the Duos page as finished words
 * (src/shared/duos.js), and the files go straight between this PC and the
 * private bucket through the signed URLs the server issues.
 *
 * NOTHING HERE RUNS MID MATCH. Every method answers null while a match is in
 * progress or the window is sealed (busy), asking nothing; the tick does
 * nothing then; and an upload in flight is ABORTED the moment a match starts
 * (watched every half second while it runs), since it competes with the game
 * for the player's connection. It is sent again, whole, once the match is
 * over: a clip is the unit of resuming, and a clip the server says is stored
 * is never sent again.
 *
 * AFTER A MATCH (the tick, every TICK_MS): each Valorant review of the last
 * few hours that is linked to Riot's record (it has a matchId and both comps)
 * is reported once. The server answers with the duos it is shared with
 * (both partners reported it on one team); for each, the sheet goes up, then
 * the clips, ONE AT A TIME, while the switch "Upload my clips to my duo" is
 * on (on by default, the owner's "automatic"), while the duo is active and
 * within the account's quota.
 *
 * THE PARTNER'S CLIPS are downloaded only when opened, into the duo cache
 * (userData/duo-cache) with its own cap (DUO.CACHE_BYTES, least recently
 * used first out), checked to be a Matroska file before it is ever played,
 * and played through occlara-clip://duo/<ref>/<name> (clip-scheme.js).
 * Signing out, or another account, empties the cache and the queue.
 *
 * deps: { api, auth, busy, reviews: { list, get, hasClip, clipFile }, clipUrl(id, name), store, cacheDir,
 *         fetch, fs, now, log, broadcast(payload), signedIn(), openPlans(), agentArt, mapArt }
 */

const path = require('path');
const nodeFs = require('fs');
const crypto = require('crypto');
const S = require('../../shared/duos');
const clipScheme = require('./clip-scheme');

const { DUO } = S;
// Reports this app sends in a rolling hour, at most, whatever is pending or
// failing: under the report route's own 30 an hour.
const REPORTS_PER_HOUR = 20;
const LIVE_KEEP_MS = 15 * 60 * 1000;   // Duos live: its own status answer kept at least this long
const BACKOFF_MS = [60 * 1000, 5 * 60 * 1000, 15 * 60 * 1000, 60 * 60 * 1000, 24 * 60 * 60 * 1000];
const backoff = (n) => BACKOFF_MS[Math.min(Math.max(0, n), BACKOFF_MS.length - 1)];
const PRUNE_MS = 10 * 60 * 1000;       // the cache checked against the server's list at most this often
const REREPORT_MS = [60 * 1000, 2 * 60 * 1000, 5 * 60 * 1000, 10 * 60 * 1000, 20 * 60 * 1000, 30 * 60 * 1000];
const TICK_MS = 60 * 1000;
const TIMEOUT_MS = 8000;
const PUT_TIMEOUT_MS = 10 * 60 * 1000;
const RETRY_MS = 6 * 60 * 60 * 1000;
const ENGAGED_MS = 24 * 60 * 60 * 1000; // what the account opted in to, asked again after this
const BUSY_WATCH_MS = 500;
const NAME_LIKE = /^[A-Za-z0-9_]{1,20}$/;
const REF = /^[0-9a-f]{16}$/;
const MIME = 'video/x-matroska';
const EBML = [0x1a, 0x45, 0xdf, 0xa3];
const MAX_TRIES = 5;
const QUEUE_MAX = 40;

function createDuos(deps = {}) {
  const api = deps.api;
  const auth = deps.auth;
  const busy = deps.busy || (() => false);
  const now = deps.now || (() => Date.now());
  const log = deps.log || (() => {});
  const store = deps.store || { get: () => undefined, set: () => {} };
  const reviews = deps.reviews || { list: () => [], get: () => null, hasClip: () => false, clipFile: () => null };
  const broadcast = deps.broadcast || (() => {});
  const fsp = (deps.fs || nodeFs).promises;
  const fsx = deps.fs || nodeFs;
  const fetchFn = deps.fetch || ((...a) => globalThis.fetch(...a));
  const cacheDir = deps.cacheDir || null;

  const status = { at: 0, live: null, duos: false, known: false };
  let prunedAt = 0;
  let ticker = null;
  let running = false;
  let inflight = null;           // { ctrl, name, ref } the upload under way
  let pausedForMatch = false;

  function credentialed() {
    try { return !!(api && typeof api.authHeaders === 'function' && Object.keys(api.authHeaders(auth)).length); } catch { return false; }
  }
  async function call(method, p, body) {
    if (!credentialed()) return { ok: false, status: 401, data: { error: 'sign-in-required' } };
    try {
      return method === 'GET' ? await api.get(p, auth, TIMEOUT_MS) : await api.post(p, body || {}, auth, TIMEOUT_MS);
    } catch {
      return { offline: true };
    }
  }
  function problem(r) {
    if (!r || r.offline) return 'offline';
    if (r.status === 401 || r.status === 403) return 'signed-out';
    if (r.status === 503 && r.data && (r.data.error === 'duos-not-live' || r.data.error === 'social-not-live')) return 'not-live';
    if (r.status === 429) return 'busy';
    if (r.status === 404) return 'not-found';
    return 'failed';
  }

  /**
   * WHETHER DUOS IS OPEN, and how it is known (the review of 25 Nov, second
   * round). While Duos is NOT known to be live, this service asks NOTHING of
   * its own: it reads the status the profiles service already holds
   * (social-service.js, which asks at launch when the shell paints the account
   * menu, and when a social page opens), on every tick (deps.peekStatus). Once
   * live, its answer is kept at least LIVE_KEEP_MS, and then asked again by
   * this service (only while it is live: to notice Duos switched off).
   * Null when it is not known yet.
   */
  function adopt(p) {
    if (!p || p.live === null || p.live === undefined || !Number.isFinite(p.at) || p.at <= status.at) return;
    status.live = !!p.live; status.duos = !!(p.live && p.duos); status.at = p.at; status.known = true;
  }
  function peekNow() {
    try { adopt(typeof deps.peekStatus === 'function' ? deps.peekStatus() : null); } catch { /* none */ }
  }
  async function live() {
    peekNow();
    if (status.known && status.duos && now() - status.at >= LIVE_KEEP_MS) {
      const r = await call('GET', '/api/social/status');
      if (r.ok && r.data) adopt({ live: r.data.live === true, duos: r.data.duos === true, at: Math.max(now(), status.at + 1) });
      else status.at = now() - LIVE_KEEP_MS + 5 * 60 * 1000;   // not reached: kept, asked again in 5 minutes
    }
    return status.known ? status.duos : null;
  }
  /** For the shell and the page: the profiles service's own ask (it remembers its answer a minute), then its answer. */
  async function liveForPage() {
    if (typeof deps.socialLive === 'function') {
      try { const r = await deps.socialLive(); if (r && r.live !== null && r.live !== undefined) adopt({ live: r.live, duos: r.duos === true, at: now() }); } catch { /* the peek below */ }
    }
    return live();
  }

  /*
   * ENGAGED: this account has a duo (active or paused), an invite IT SENT, or
   * Discoverable on under Duos' words; an invite it was SENT does not count (a
   * stranger's invite never makes this app report). Only then does the tick
   * report, upload, or ask anything but this. Learned from the Duos page, its
   * actions and the Profile switch (noteDiscoverable); else asked (GET /me)
   * when not known or a day old, stamped on ANY answer (401 or 403: not
   * engaged), backed off on a failure (1, 5, 15, 60 minutes, then daily). An
   * app not signed in with a session (a licence key alone) asks nothing at all.
   * The server checks the same (social_duo_report 'not-engaged').
   */
  const engaged = () => store.get('duoEngaged') === true;
  const engagedKnown = () => { const at = Number(store.get('duoEngagedAt')) || 0; return at > 0 && now() - at < ENGAGED_MS; };
  const setEngaged = (on) => { store.set('duoEngaged', !!on); store.set('duoEngagedAt', now()); store.set('duoEngagedFails', 0); };
  const engagedOf = (v) => !!(v && (v.discoverable || (v.partners || []).length || (v.invitesOut || []).length));
  function noteDiscoverable(on) { if (on === true) setEngaged(true); }
  /** A session (an Authorization header), not a licence key alone. */
  function isSession() {
    try { const h = api && typeof api.authHeaders === 'function' ? api.authHeaders(auth) : {}; return !!(h && (h.Authorization || h.authorization)); } catch { return false; }
  }
  async function learnEngaged() {
    if (now() < (Number(store.get('duoEngagedNext')) || 0)) return;
    const r = await call('GET', '/api/social/duos/me');
    if (r.ok && r.data && r.data.me) { setEngaged(engagedOf(r.data.me)); return; }
    if (r.status === 401 || r.status === 403) { setEngaged(false); return; }
    const n = (Number(store.get('duoEngagedFails')) || 0);
    store.set('duoEngagedFails', n + 1);
    store.set('duoEngagedNext', now() + backoff(n));
  }

  // ── The switch and the queue ──────────────────────────────────────────────
  const uploadOn = () => store.get('duoUpload') !== false;
  const queue = () => { const q = store.get('duoQueue'); return q && typeof q === 'object' && !Array.isArray(q) ? q : {}; };
  const saveQueue = (q) => {
    const entries = Object.entries(q).filter(([k, v]) => REF.test(k) && v && now() - (v.at || 0) < DUO.KEEP_DAYS * 86400000)
      .sort((x, y) => (y[1].at || 0) - (x[1].at || 0)).slice(0, QUEUE_MAX);
    store.set('duoQueue', Object.fromEntries(entries));
  };
  const reported = () => { const r = store.get('duoReported'); return r && typeof r === 'object' && !Array.isArray(r) ? r : {}; };

  /** The upload's line for the page: what was shared, what waits, why it stopped. */
  function uploadModel() {
    const q = Object.values(queue());
    let clips = 0;
    let bytes = 0;
    let waiting = 0;
    let failed = 0;
    let tooLarge = 0;
    let quota = false;
    let paused = false;
    for (const it of q) {
      const slots = it.clips || {};
      for (const c of Object.values(slots)) {
        if (c.st === 'done') { clips++; bytes += c.bytes || 0; } else if (c.st === 'failed') failed++; else if (c.st === 'too-large') tooLarge++; else waiting++;
      }
      // A clip of the match not tried yet waits too (the switch off, a match in between).
      let saved = null;
      try { saved = it.review ? reviews.get(it.review) : null; } catch { saved = null; }
      if (saved) waiting += S.clipsOf(saved, (n) => reviews.hasClip(it.review, n)).filter((c) => !slots[c.name]).length;
      if (it.state === 'quota') quota = true;
      if (it.state === 'paused') paused = true;
    }
    const sheets = q.filter((it) => it.sheet === 'sent').length;
    const refused = q.filter((it) => it.sheet === 'refused').length;
    const lines = [];
    if (sheets || clips) lines.push(`Shared ${sheets === 1 ? 'one match' : `${sheets} matches`} with your duo: ${clips === 1 ? 'one clip' : `${clips} clips`}, ${S.bytesText(bytes)}.`);
    else lines.push('Nothing shared yet. After a match you play with your duo, your side of it is shared here.');
    if (!uploadOn() && waiting) lines.push(`${waiting === 1 ? 'One clip waits' : `${waiting} clips wait`} for the switch to be on.`);
    else if (pausedForMatch && inflight === null && waiting) lines.push('Uploads pause while you play and go on after the match.');
    else if (waiting) lines.push(`${waiting === 1 ? 'One clip is' : `${waiting} clips are`} still to go up, one at a time.`);
    if (tooLarge) lines.push(`${tooLarge === 1 ? 'One clip was' : `${tooLarge} clips were`} too large for the server to take, so ${tooLarge === 1 ? 'it was' : 'they were'} not shared.`);
    if (failed) lines.push(`${failed === 1 ? 'One clip' : `${failed} clips`} could not be uploaded after ${MAX_TRIES} tries.`);
    if (quota) lines.push(`Your upload limit, ${S.bytesText(DUO.UPLOAD_BYTES)} in ${DUO.QUOTA_DAYS} days, is reached. Clips wait until older uploads leave the window.`);
    if (refused) lines.push(`The server refused ${refused === 1 ? "one match's sheet" : `${refused} matches' sheets`}, so ${refused === 1 ? 'it was' : 'they were'} not shared.`);
    if (paused) lines.push('A duo is paused, so nothing new of its matches goes up.');
    return { on: uploadOn(), line: lines.join(' '), waiting, failed, quota };
  }

  // ── The page's state ─────────────────────────────────────────────────────
  async function state(opts) {
    if (busy()) return null;
    if (!credentialed()) return { duos: null, problem: 'signed-out', home: null, upload: uploadModel() };
    const on = await liveForPage();
    if (opts && opts.only === 'live') return { duos: on };
    if (on === null) return { duos: null, problem: 'offline', home: null, upload: uploadModel() };
    if (!on) return { duos: false, problem: 'not-live', home: null, upload: uploadModel() };
    const [me, list] = await Promise.all([call('GET', '/api/social/duos/me'), call('GET', '/api/social/duos/matches')]);
    if (me.offline || !me.ok) {
      const p = problem(me);
      if (p === 'not-live') { status.duos = false; status.at = now(); status.known = true; }
      return { duos: p !== 'not-live', problem: p, home: null, upload: uploadModel() };
    }
    const view = me.data && me.data.me;
    const matches = list.ok && list.data && Array.isArray(list.data.matches) ? list.data.matches : [];
    const home = S.homeModel(view, matches, { now: now() });
    if (view) setEngaged(engagedOf(view));
    if (list.ok) { pruneCache(new Set(matches.map((m) => m.ref))); prunedAt = now(); }
    // The page was opened: the pins on this player's clips are seen now.
    if (home && home.partners.some((p) => p.pins)) call('POST', '/api/social/duos/seen', {}).catch(() => {});
    return { duos: true, problem: view && view.username ? null : 'no-username', home, upload: uploadModel() };
  }

  async function act(p, body, after) {
    if (busy()) return null;
    const r = await call('POST', p, body);
    if (r.offline) return { ok: false, line: S.inviteLine('offline') };
    if (!r.ok && r.status !== 400) return { ok: false, line: S.inviteLine(problem(r) === 'busy' ? 'busy' : 'failed') };
    const d = r.data || {};
    const out = { ok: d.ok === true, reason: d.reason || null, line: S.inviteLine(d.reason || (d.ok ? 'sent' : 'failed'), { username: d.username }) };
    if (out.ok) setEngaged(true);
    if (after) Object.assign(out, after(d));
    out.state = await state();
    broadcast({});
    return out;
  }

  const invite = (name) => {
    const n = String(name || '').trim();
    if (!NAME_LIKE.test(n)) return busy() ? null : { ok: false, line: S.inviteLine('name') };
    return act('/api/social/duos/invite', { name: n });
  };
  const makeCode = () => act('/api/social/duos/code', {}, (d) => ({ code: typeof d.code === 'string' ? d.code : null,
    codeLine: d.expiresAt ? `It ${S.leftText(d.expiresAt, now())}.` : null }));
  function accept(x) {
    if (busy()) return null;
    if (x && typeof x.code === 'string') {
      if (!S.codeOf(x.code)) return { ok: false, line: 'A code is 10 letters and digits, like K7M2Q-9XH4P.' };
      return act('/api/social/duos/accept', { code: S.codeOf(x.code) });
    }
    const from = String((x && x.from) || '').trim();
    if (!NAME_LIKE.test(from)) return { ok: false, line: S.inviteLine('gone') };
    return act('/api/social/duos/accept', { from });
  }
  const decline = (from) => (NAME_LIKE.test(String(from || '')) ? act('/api/social/duos/decline', { from }) : (busy() ? null : { ok: false }));
  const cancel = (ref) => (REF.test(String(ref || '')) ? act('/api/social/duos/cancel', { ref }) : (busy() ? null : { ok: false }));
  async function remove(name) {
    if (busy()) return null;
    if (!NAME_LIKE.test(String(name || ''))) return { ok: false };
    const r = await act('/api/social/duos/remove', { name });
    if (r && r.ok !== false) {
      // Nothing of theirs is kept here: the duo's matches leave the cache on the next state.
      r.line = `Your duo with ${name} ended. Everything you shared with each other was deleted.`;
    }
    return r;
  }
  async function flag(b) {
    if (busy()) return null;
    const name = String((b && b.name) || '').trim();
    const reason = b && typeof b.reason === 'string' ? b.reason : '';
    if (!NAME_LIKE.test(name) || !['username', 'pins', 'clips', 'other'].includes(reason)) return { ok: false, line: 'Pick what is wrong first.' };
    const r = await call('POST', '/api/social/duos/flag', { name, reason });
    if (r.offline || !r.ok) return { ok: false, line: 'The report could not be sent. Try again in a moment.' };
    return { ok: true, line: 'Thanks. The report went to the Occlara team.' };
  }
  function setUpload(on) {
    if (busy()) return null;
    store.set('duoUpload', on === true);
    broadcast({});
    if (on === true) setTimeout(() => { tick().catch(() => {}); }, 200);
    return { ok: true, upload: uploadModel() };
  }
  function plans() {
    if (busy()) return null;
    try { return deps.openPlans ? deps.openPlans() : { ok: false }; } catch { return { ok: false }; }
  }

  // ── One shared match ─────────────────────────────────────────────────────
  async function match(ref) {
    if (busy()) return null;
    if (!REF.test(String(ref || ''))) return { ok: false, error: 'not-found' };
    const r = await call('GET', `/api/social/duos/match?ref=${encodeURIComponent(ref)}`);
    if (r.offline || !r.ok) return { ok: false, error: problem(r) };
    const m = r.data && r.data.match;
    const model = S.matchModel(m, { now: now() });
    if (!model) return { ok: false, error: 'not-found' };
    const link = queue()[ref];
    for (const round of model.rounds) {
      for (const c of [...round.myClips, ...round.theirClips]) {
        c.url = null;
        // Your own clip plays from your own review folder while it is still there.
        if (c.mine && link && link.review && reviews.hasClip(link.review, c.name) && typeof deps.clipUrl === 'function') c.url = deps.clipUrl(link.review, c.name);
        else if (cached(c.ref, c.name)) c.url = clipScheme.duoUrlFor(c.ref, c.name);
      }
    }
    return { ok: true, match: model, names: S.NAMES_NOTE };
  }

  // ── The cache of the partner's clips ─────────────────────────────────────
  const indexFile = () => (cacheDir ? path.join(cacheDir, 'index.json') : null);
  let index = null;
  function loadIndex() {
    if (index) return index;
    index = { entries: {} };
    try { const raw = JSON.parse(fsx.readFileSync(indexFile(), 'utf8')); if (raw && raw.entries && typeof raw.entries === 'object') index = raw; } catch { /* a fresh cache */ }
    return index;
  }
  function saveIndex() {
    if (!cacheDir) return;
    try { fsx.mkdirSync(cacheDir, { recursive: true }); fsx.writeFileSync(indexFile(), JSON.stringify(index)); } catch (e) { log(`[duos] the clip cache index was not written: ${e.message}`); }
  }
  const fileOf = (ref, name) => (cacheDir && REF.test(ref) && S.CLIP_NAME.test(name) ? path.join(cacheDir, `${ref}-${name}`) : null);
  function cached(ref, name) {
    const e = loadIndex().entries[ref];
    const f = fileOf(ref, name);
    if (!e || e.name !== name || !f) return false;
    try { return fsx.statSync(f).isFile(); } catch { return false; }
  }
  /** The scheme's lookup: a cached file of a clip, or null. Marks it used. */
  function cacheFile(ref, name) {
    if (!cached(ref, name)) return null;
    const e = loadIndex().entries[ref];
    if (now() - (e.usedAt || 0) > 60000) { e.usedAt = now(); saveIndex(); }
    return fileOf(ref, name);
  }
  function dropEntry(ref) {
    const e = loadIndex().entries[ref];
    if (!e) return;
    try { fsx.rmSync(fileOf(ref, e.name), { force: true }); } catch { /* gone */ }
    delete index.entries[ref];
  }
  /** Least recently used first out, until the cache is under its cap. */
  function evict(cap = DUO.CACHE_BYTES) {
    const list = Object.entries(loadIndex().entries).sort((a, b) => (a[1].usedAt || 0) - (b[1].usedAt || 0));
    let total = list.reduce((n, [, e]) => n + (e.bytes || 0), 0);
    for (const [ref, e] of list) {
      if (total <= cap) break;
      dropEntry(ref);
      total -= e.bytes || 0;
    }
    saveIndex();
  }
  /** Clips of matches no longer shared (expired, the duo ended, a block) leave this PC too. */
  function pruneCache(known) {
    const idx = loadIndex();
    let changed = false;
    for (const [ref, e] of Object.entries(idx.entries)) {
      if (!known.has(e.match) || now() > (e.expiresAt || (e.at || 0) + DUO.KEEP_DAYS * 86400000)) { dropEntry(ref); changed = true; }
    }
    if (changed) saveIndex();
  }

  /**
   * A clip of the duo, opened: from the cache, else downloaded now through a
   * signed URL into the cache, checked to be a Matroska file before it is
   * kept. { ok, url } or { ok: false, line }.
   */
  async function openClip(x) {
    if (busy()) return null;
    const ref = String((x && x.ref) || '');
    const name = String((x && x.name) || '');
    const matchRef = String((x && x.match) || '');
    if (!REF.test(ref) || !S.CLIP_NAME.test(name) || !REF.test(matchRef) || !cacheDir) return { ok: false, line: 'That clip could not be opened.' };
    if (cached(ref, name)) { cacheFile(ref, name); return { ok: true, url: clipScheme.duoUrlFor(ref, name) }; }
    const r = await call('POST', '/api/social/duos/clip/url', { clip: ref });
    if (r.offline) return { ok: false, line: S.SAID.offline };
    if (!r.ok) {
      const why = r.data && r.data.reason;
      return { ok: false, line: why === 'budget' ? `Your download limit for today, ${S.bytesText(DUO.DOWNLOAD_BYTES_DAY)}, is used. Clips you opened before still play.`
        : r.status === 404 ? 'This clip is not shared any more: it expired, or the duo ended.' : S.SAID.failed };
    }
    const url = r.data && typeof r.data.url === 'string' ? r.data.url : null;
    if (!url || !/^https?:\/\//.test(url)) return { ok: false, line: S.SAID.failed };
    const tmp = path.join(cacheDir, `${ref}-${crypto.randomBytes(4).toString('hex')}.part`);
    try {
      await fsp.mkdir(cacheDir, { recursive: true });
      // The same watch as an upload's: a match starting aborts the download
      // at once (its budget stays spent: given back, an abort would be a way
      // to download for free).
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), PUT_TIMEOUT_MS);
      const watch = setInterval(() => { if (busy()) ctrl.abort(); }, BUSY_WATCH_MS);
      let buf;
      try {
        const res = await fetchFn(url, { method: 'GET', signal: ctrl.signal });
        if (!res || !res.ok) throw new Error(`download answered ${res && res.status}`);
        buf = Buffer.from(await res.arrayBuffer());
      } finally { clearTimeout(timer); clearInterval(watch); }
      if (buf.length > DUO.CLIP_MAX_BYTES || buf.length < 64) throw new Error('not a clip (its size)');
      if (!EBML.every((b, i) => buf[i] === b)) throw new Error('not a Matroska file');
      if (busy()) throw new Error('a match started');
      await fsp.writeFile(tmp, buf);
      await fsp.rename(tmp, fileOf(ref, name));
      loadIndex().entries[ref] = { name, match: matchRef, bytes: buf.length, at: now(), usedAt: now(),
        expiresAt: Number.isFinite(Date.parse((x && x.expiresAt) || '')) ? Date.parse(x.expiresAt) : now() + DUO.KEEP_DAYS * 86400000 };
      evict();
      return { ok: true, url: clipScheme.duoUrlFor(ref, name) };
    } catch (e) {
      try { await fsp.rm(tmp, { force: true }); } catch { /* none */ }
      log(`[duos] a duo clip was not opened: ${e.message}`);
      if (busy()) return null;
      return { ok: false, line: /Matroska|size/.test(e.message) ? 'That file is not a clip, so it was not played.' : 'That clip could not be downloaded. Try again in a moment.' };
    }
  }

  async function pin(b) {
    if (busy()) return null;
    const clip = String((b && b.clip) || '');
    const at = b && Number.isInteger(b.at) ? b.at : -1;
    const label = b && S.PIN_LABELS.includes(b.label) ? b.label : null;
    const reaction = b && S.REACTIONS.includes(b.reaction) ? b.reaction : null;
    if (!REF.test(clip) || at < 0 || at > 600000 || !label) return { ok: false, line: 'Pick a label first.' };
    const r = await call('POST', '/api/social/duos/pin', { clip, at, label, reaction });
    if (r.offline || !r.ok || !r.data || r.data.ok !== true) {
      return { ok: false, line: r.data && r.data.reason === 'too-many' ? `You have ${DUO.PINS_PER_CLIP} pins on this clip, the most there can be.` : 'The pin could not be saved. Try again in a moment.' };
    }
    return { ok: true, ref: r.data.ref };
  }
  async function unpin(ref) {
    if (busy()) return null;
    if (!REF.test(String(ref || ''))) return { ok: false };
    const r = await call('POST', '/api/social/duos/pin/remove', { ref });
    return { ok: !!(r && r.ok) };
  }

  // ── After a match: the report, then the sheet and the clips ──────────────
  /*
   * THE REPORT, AGAIN UNTIL IT PAIRS. A partner who reports first is answered
   * with no shared match (the other has not reported yet). So a report is
   * kept PENDING and sent again on a backing off timer (REREPORT_MS) until
   * the pairing window (DUO.PAIR_WINDOW_MIN after the first answer) passes;
   * sooner when the duos' match list shows a match this PC has not queued
   * (the partner's report paired it). Sending it again costs nothing on the
   * server: a match already reported spends no second live game.
   */
  const windowMs = (DUO.PAIR_WINDOW_MIN + 10) * 60 * 1000;
  async function reportDue() {
    const done = reported();
    const t = now();
    let changed = false;
    const rows = (typeof reviews.list === 'function' ? reviews.list('valorant') : []) || [];
    for (const row of rows.slice(0, 12)) {
      if (busy()) break;
      if (!row || !row.id || !row.matchId) continue;
      const seen = done[row.id];
      if (!seen && t - (Number(row.at) || 0) > DUO.REPORT_GAME_HOURS * 3600000) continue;
      if (seen && (seen.done || t < (seen.next || 0))) continue;
      // Pending or failing, a report stops at the pairing window, never later.
      if (seen && t - (seen.first || seen.at || t) > windowMs) { done[row.id] = { done: true, at: seen.at || t }; changed = true; continue; }
      const saved = reviews.get(row.id);
      const rep = S.reportOf(saved);
      if (!rep) { done[row.id] = { done: true, at: t }; changed = true; continue; }
      const sent = (store.get('duoReportTimes') || []).filter((x) => t - x < 3600000);
      if (sent.length >= REPORTS_PER_HOUR) break;
      store.set('duoReportTimes', [...sent, t]);
      const r = await call('POST', '/api/social/duos/report', rep);
      changed = true;
      if (r.offline || (!r.ok && r.status !== 400)) {
        // An error (offline, 5xx, 429, 401): backed off (1, 5, 15, 60 minutes),
        // and given up at the pairing window like a pending one.
        const tries = seen ? (seen.errors || 0) + 1 : 1;
        done[row.id] = { ...(seen || {}), first: (seen && seen.first) || t, errors: tries, at: (seen && seen.at) || t,
          next: t + backoff(tries - 1) };
        continue;
      }
      const d = r.data || {};
      if (!d.ok) {
        // No username yet: again later. Refused for good ('no-game', 'not-engaged', a bad match): never again.
        done[row.id] = d.reason === 'no-username' ? { at: t, next: t + REREPORT_MS[4] } : { done: true, at: t };
        continue;
      }
      const tries = seen && seen.pending ? (seen.tries || 0) + 1 : 0;
      done[row.id] = { pending: true, first: (seen && seen.first) || t, tries, at: (seen && seen.at) || t,
        next: t + REREPORT_MS[Math.min(tries, REREPORT_MS.length - 1)] };
      if (Array.isArray(d.matches) && d.matches.length) {
        const q = queue();
        for (const m of d.matches) {
          if (!m || !REF.test(String(m.ref || '')) || q[m.ref]) continue;
          q[m.ref] = { review: row.id, partner: NAME_LIKE.test(String(m.partner || '')) ? m.partner : null, at: t, sheet: 'wait', clips: {}, state: 'active' };
          log('[duos] a match is shared with a duo partner');
        }
        saveQueue(q);
      }
    }
    if (changed) {
      const kept = Object.fromEntries(Object.entries(done).filter(([, v]) => t - (v.at || 0) < DUO.REPORT_DAYS * 86400000));
      store.set('duoReported', kept);
    }
  }

  /*
   * THE DUOS' MATCH LIST, asked only when it is needed: a report is pending
   * (a match the partner's report paired shows here first, and the pending
   * reports go again at once), or the cache holds a partner's clips and was
   * not checked for PRUNE_MS (a match expired, ended or blocked leaves it).
   */
  const seenRefs = new Set();
  async function checkMatches() {
    const done = reported();
    const pending = Object.values(done).some((v) => v && v.pending);
    const cached = cacheDir && Object.keys(loadIndex().entries).length > 0;
    if (!pending && !(cached && now() - prunedAt > PRUNE_MS)) return;
    const r = await call('GET', '/api/social/duos/matches');
    if (!r.ok || !r.data || !Array.isArray(r.data.matches)) return;
    const refs = r.data.matches.map((m) => m && m.ref).filter((x) => REF.test(String(x || '')));
    if (cached) pruneCache(new Set(refs));
    prunedAt = now();
    const q = queue();
    const fresh = refs.filter((ref) => !q[ref] && !seenRefs.has(ref));
    for (const ref of refs) seenRefs.add(ref);
    if (fresh.length && pending) {
      for (const v of Object.values(done)) if (v && v.pending) v.next = 0;
      store.set('duoReported', done);
    }
  }

  /** One PUT of one file to its signed URL, aborted the moment a match starts. */
  async function putFile(url, file, name, ref) {
    const buf = await fsp.readFile(file);
    if (buf.length > DUO.CLIP_MAX_BYTES) { const e = new Error('too big'); e.tooBig = true; throw e; }
    const ctrl = new AbortController();
    inflight = { ctrl, name, ref };
    const watch = setInterval(() => { if (busy()) { pausedForMatch = true; ctrl.abort(); } }, BUSY_WATCH_MS);
    const timer = setTimeout(() => ctrl.abort(), PUT_TIMEOUT_MS);
    try {
      // No upsert: a path is written once (the URL was signed so too).
      const res = await fetchFn(url, { method: 'PUT', headers: { 'Content-Type': MIME, 'cache-control': 'max-age=3600' }, body: buf, signal: ctrl.signal });
      if (!res || !res.ok) {
        const e = new Error(`upload answered ${res && res.status}`);
        e.status = res && res.status;
        // The server's own file limit (a Supabase Free plan refuses over 50 MB
        // whatever the bucket says): never tried again.
        if (e.status === 413) e.tooLarge = true;
        // Some Supabase versions answer 400 with { statusCode: "413" } in the body.
        if (e.status === 400) {
          let text = '';
          try { text = typeof res.text === 'function' ? await res.text() : ''; } catch { text = ''; }
          let j = null;
          try { j = JSON.parse(text); } catch { j = null; }
          if (j && String(j.statusCode) === '413') e.tooLarge = true;
        }
        throw e;
      }
      return buf.length;
    } finally {
      clearInterval(watch);
      clearTimeout(timer);
      inflight = null;
    }
  }

  /** The next thing to send, sent: a sheet, else one clip. 'more' | 'idle' | 'stop'. */
  /*
   * WHAT IS FINAL (the review of 25 Nov, second round). For the SHEET: a 4xx
   * other than 401, 403 and 429 (400 invalid, 413 too big, and a refusal the
   * server named that is not 'paused' or 'none') is final for that match's
   * sheet, recorded and said as not shared, and the queue moves on; 'none'
   * (no pair, the match expired) drops the match; 'paused' waits RETRY_MS;
   * 429 waits on the backing off ladder; 401, 403, 5xx and offline stop the
   * step and try again on a later tick. For a CLIP's start: final are
   * 'too-big' (too large), 'none' (no pair, expired: the match goes), 'count'
   * (the match's clips are all used), 'issues' (its upload URLs are spent) and
   * 'clip' (a malformed ask); 'quota' and 'paused' wait RETRY_MS; any 429,
   * 401, 403, 404, 5xx or offline is counted (slot.waits), backed off on the
   * ladder, and NEVER final. An upload that fails (not 413) is a try: five and
   * the clip is failed. No item ever blocks another: one waiting is passed over.
   */
  async function uploadStep() {
    const q = queue();
    const t = now();
    for (const [ref, it] of Object.entries(q)) {
      if (busy()) return 'stop';
      if ((it.state === 'paused' || it.state === 'quota') && t - (it.stateAt || 0) < RETRY_MS) continue;
      const saved = it.review ? reviews.get(it.review) : null;
      if (!saved) { delete q[ref]; saveQueue(q); continue; }
      if (it.sheet !== 'sent' && it.sheet !== 'refused') {
        if (t < (it.sheetNext || 0)) continue;
        const sheet = S.sheetOf(saved);
        if (!sheet) { it.sheet = 'refused'; it.sheetWhy = 'no-sheet'; saveQueue(q); return 'more'; }
        const r = await call('POST', '/api/social/duos/sheet', { ref, sheet });
        if (r.offline || (!r.ok && r.status >= 500)) return 'stop';
        if (r.status === 401 || r.status === 403) { it.sheetWaits = (it.sheetWaits || 0) + 1; it.sheetNext = t + backoff(it.sheetWaits); saveQueue(q); return 'stop'; }
        if (r.status === 429) { it.sheetWaits = (it.sheetWaits || 0) + 1; it.sheetNext = t + backoff(it.sheetWaits); saveQueue(q); continue; }
        const reason = r.data && r.data.reason;
        if (r.ok && r.data && r.data.ok) { it.sheet = 'sent'; it.state = 'active'; }
        else if (reason === 'paused') { it.state = 'paused'; it.stateAt = t; }
        else if (reason === 'none') { delete q[ref]; saveQueue(q); continue; }
        else { it.sheet = 'refused'; it.sheetWhy = String(reason || r.status || 'refused').slice(0, 20); log(`[duos] a sheet was refused (${it.sheetWhy}): not shared`); }
        saveQueue(q);
        return 'more';
      }
      if (!uploadOn() || it.state === 'paused') continue;
      const list = S.clipsOf(saved, (n) => reviews.hasClip(it.review, n));
      it.clips = it.clips || {};
      const next = list.find((c) => { const sl = it.clips[c.name]; return !sl || (sl.st === 'wait' && (sl.tries || 0) < MAX_TRIES && t >= (sl.next || 0)); });
      if (!next) continue;
      const slot = it.clips[next.name] || (it.clips[next.name] = { st: 'wait', tries: 0 });
      const file = reviews.clipFile(it.review, next.name);
      let size = 0;
      try { size = (await fsp.stat(file)).size; } catch { slot.st = 'failed'; saveQueue(q); return 'more'; }
      if (size > DUO.CLIP_MAX_BYTES) { slot.st = 'too-large'; saveQueue(q); return 'more'; }
      const wait = () => { slot.waits = (slot.waits || 0) + 1; slot.next = t + backoff(slot.waits); saveQueue(q); return 'stop'; };
      const st = await call('POST', '/api/social/duos/clip/start', { ref, name: next.name, round: next.round, kind: next.kind, marks: next.marks, size });
      if (st.offline || (!st.ok && [401, 403, 404, 429].includes(st.status)) || (!st.ok && st.status >= 500)) return wait();
      const d = st.data || {};
      if (!d.ok) {
        if (d.reason === 'quota') { it.state = 'quota'; it.stateAt = t; }
        else if (d.reason === 'paused') { it.state = 'paused'; it.stateAt = t; }
        else if (d.reason === 'none') delete q[ref];
        else if (d.reason === 'too-big') slot.st = 'too-large';
        else if (['count', 'issues', 'clip'].includes(d.reason)) { slot.st = 'failed'; slot.why = d.reason; }
        else return wait();
        saveQueue(q);
        return 'more';
      }
      if (d.stored) { slot.st = 'done'; slot.bytes = size; saveQueue(q); return 'more'; }
      try {
        const sent = await putFile(d.url, file, next.name, ref);
        const done = await call('POST', '/api/social/duos/clip/done', { clip: d.clip });
        if (done.ok && done.data && done.data.ok) { slot.st = 'done'; slot.bytes = sent; log('[duos] a clip went up to the duo'); }
        else if (done.data && done.data.reason === 'too-big') slot.st = 'too-large';
        else if (done.offline || [401, 403, 429].includes(done.status) || done.status >= 500) return wait();
        else slot.tries = (slot.tries || 0) + 1;
      } catch (e) {
        if (busy() || (e && e.name === 'AbortError' && pausedForMatch)) { saveQueue(q); return 'stop'; }
        slot.tries = (slot.tries || 0) + 1;
        if (e && (e.tooBig || e.tooLarge)) slot.st = 'too-large';
        log(`[duos] a clip upload failed (try ${slot.tries}): ${e && e.message}`);
      }
      if (slot.st === 'wait' && slot.tries >= MAX_TRIES) slot.st = 'failed';
      saveQueue(q);
      return 'more';
    }
    return 'idle';
  }

  /** Every partner's clip off this PC (signed out, Duos not live, no duo left). */
  function wipeCache() {
    if (!cacheDir) return;
    const idx = loadIndex();
    if (Object.keys(idx.entries).length) { for (const ref of Object.keys(idx.entries)) dropEntry(ref); saveIndex(); }
    sweepStrays();
  }
  /** Files in the cache no entry names (a download a crash left as .part, an old index): removed. */
  function sweepStrays() {
    if (!cacheDir) return 0;
    let names = [];
    try { names = fsx.readdirSync(cacheDir); } catch { return 0; }
    const keep = new Set(Object.entries(loadIndex().entries).map(([ref, e]) => `${ref}-${e.name}`));
    keep.add('index.json');
    let n = 0;
    for (const f of names) {
      if (keep.has(f)) continue;
      try { fsx.rmSync(path.join(cacheDir, f), { force: true, recursive: true }); n++; } catch { /* in use: next time */ }
    }
    return n;
  }

  async function tick() {
    if (busy()) { if (inflight) { pausedForMatch = true; inflight.ctrl.abort(); } return null; }
    if (running) return null;
    running = true;
    try {
      // Signed out: nothing of an account is kept, and nothing is asked.
      if (!credentialed()) { wipeCache(); return 'off'; }
      // A licence key alone, no session: Duos is an account's, nothing is asked.
      if (!isSession()) { wipeCache(); return 'idle'; }
      const on = await live();
      if (on === false) { wipeCache(); return 'off'; }
      if (on !== true) { sweepStrays(); return 'off'; }
      if (!engagedKnown()) await learnEngaged();
      // Opted in to nothing: no duo request at all, and no partner's clip kept.
      if (!engaged()) { wipeCache(); return 'idle'; }
      pausedForMatch = false;
      sweepStrays();
      await checkMatches();
      await reportDue();
      for (let i = 0; i < 40; i++) {
        const r = await uploadStep();
        if (r !== 'more') break;
      }
      broadcast({});
      return 'done';
    } finally {
      running = false;
    }
  }
  function start() {
    if (ticker) return;
    sweepStrays();
    ticker = setInterval(() => { tick().catch(() => {}); }, TICK_MS);
    if (ticker && typeof ticker.unref === 'function') ticker.unref();
  }
  function stop() { if (ticker) clearInterval(ticker); ticker = null; if (inflight) inflight.ctrl.abort(); }

  /** Signed out or another account: nothing of the last one is kept, its partner's clips included. */
  function forget() {
    status.at = 0; status.live = null; status.duos = false; status.known = false;
    if (inflight) inflight.ctrl.abort();
    store.set('duoQueue', {});
    store.set('duoReported', {});
    store.set('duoEngaged', false);
    store.set('duoEngagedAt', 0);
    store.set('duoEngagedNext', 0);
    store.set('duoEngagedFails', 0);
    seenRefs.clear();
    wipeCache();
  }

  return {
    state, invite, makeCode, accept, decline, cancel, remove, flag, setUpload, plans, match, openClip, pin, unpin,
    cacheFile, tick, start, stop, forget, uploadModel, evict, pruneCache, noteDiscoverable, sweepStrays,
    _status: status, _inflight: () => inflight,
  };
}

module.exports = { createDuos, TICK_MS, LIVE_KEEP_MS, MAX_TRIES };

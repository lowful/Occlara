'use strict';

/**
 * Who is using Occlara right now, and what the server has been doing.
 *
 * Every client request carries its licence key, so the server already knows
 * when each install was last heard from. This keeps that in memory, per licence,
 * and turns it into states a person can read at a glance:
 *
 *   recording   a live read in the last 20 seconds: a match is being played
 *   reviewing   a review, a death look or Riot's record fetched in the last 3
 *               minutes: a match just ended
 *   app open    anything in the last 10 minutes. The desktop app re-checks its
 *               licence every 3 minutes, so an open app is never quiet longer
 *   offline     seen earlier today
 *
 * Licences are stored as an 8 character hash, never the key itself. The admin
 * view can resolve a hash to the account's email, and only behind the admin
 * password.
 *
 * It also keeps the last errors and how each route is doing, because the one
 * thing a "deployment crashed" email never says is what the server was doing
 * when it happened.
 *
 * In memory on purpose: it resets on every deploy, which is the honest scope
 * of "right now". The start time is reported, so a reset is visible.
 */

const crypto = require('crypto');

const RECORDING_MS = 20 * 1000;
const REVIEWING_MS = 3 * 60 * 1000;
const OPEN_MS = 10 * 60 * 1000;
const KEEP_MS = 24 * 60 * 60 * 1000;
const MAX_USERS = 2000;
const MAX_ERRORS = 50;

const hashOf = (key) => crypto.createHash('sha256').update(String(key)).digest('hex').slice(0, 8);

/** Which game and what kind of call a path is. */
function classify(path) {
  const p = String(path || '').toLowerCase();
  if (p.startsWith('/api/coach/read') || p.startsWith('/api/coach/analyze')) return { kind: 'read', game: 'valorant' };
  if (/^\/api\/coach\/(match-review|death-forensics|match-rounds|last-match)/.test(p)) return { kind: 'review', game: 'valorant' };
  if (p.startsWith('/api/coach/detect-agent')) return { kind: 'read', game: 'valorant' };
  if (p.startsWith('/api/rivals/')) return { kind: /review|identify/.test(p) ? 'review' : 'read', game: 'rivals' };
  if (p.startsWith('/api/license/')) return { kind: 'license', game: null };
  if (p.startsWith('/api/coach/chat') || p.startsWith('/api/coach/frame-chat')) return { kind: 'chat', game: null };
  return { kind: 'other', game: null };
}

class Presence {
  constructor(opts = {}) {
    this.now = opts.now || (() => Date.now());
    this.startedAt = this.now();
    this.users = new Map();     // hash -> entry
    this.keys = new Map();      // hash -> licence key, ONLY to look the account up for the admin view
    this.errors = [];           // newest last
    this.routes = new Map();    // route -> { calls, errors5xx, slow, lastError }
    this.peakHeapMB = 0;
    this.day = new Date(this.startedAt).toISOString().slice(0, 10);
  }

  /** One request from a client. Never throws. */
  touch({ key, path, version }) {
    try {
      if (!key || String(key).length < 8) return;
      const at = this.now();
      const hash = hashOf(String(key).trim().toUpperCase());
      const c = classify(path);
      let u = this.users.get(hash);
      if (!u) {
        if (this.users.size >= MAX_USERS) this.prune(true);
        u = { hash, firstSeen: at, lastSeen: at, lastRead: 0, lastReview: 0, game: null, version: null,
          reads: [], callsToday: 0, day: '' };
        this.users.set(hash, u);
        this.keys.set(hash, String(key).trim().toUpperCase());
      }
      const day = new Date(at).toISOString().slice(0, 10);
      if (u.day !== day) { u.day = day; u.callsToday = 0; }
      u.callsToday++;
      u.lastSeen = at;
      if (c.game) u.game = c.game;
      if (c.kind === 'read') {
        u.lastRead = at;
        u.reads.push(at);
        if (u.reads.length > 240) u.reads.splice(0, u.reads.length - 240);
      }
      if (c.kind === 'review') u.lastReview = at;
      // The version header arrives from 8.0.1 on; before that the route says
      // enough: only pre 8.0 clients still call /analyze.
      if (version) u.version = String(version).slice(0, 16);
      else if (!u.version && String(path).startsWith('/api/coach/analyze')) u.version = 'before 8.0';
      else if (!u.version && String(path).startsWith('/api/coach/read')) u.version = '8.0';
    } catch { /* presence must never cost a request */ }
  }

  /** A finished request, for the per route view. */
  finish({ path, status, ms }) {
    try {
      const route = String(path || '').split('?')[0].replace(/\/[0-9a-f-]{16,}/gi, '/:id');
      const r = this.routes.get(route) || { calls: 0, errors5xx: 0, errors4xx: 0, slow: 0, totalMs: 0, lastError: null };
      r.calls++;
      r.totalMs += ms || 0;
      if (status >= 500) { r.errors5xx++; r.lastError = this.now(); }
      else if (status >= 400) r.errors4xx++;
      if (ms > 10000) r.slow++;
      this.routes.set(route, r);
      if (this.routes.size > 200) this.routes.delete(this.routes.keys().next().value);
    } catch { /* never cost a request */ }
  }

  /** An error the server caught. */
  error(where, err) {
    try {
      this.errors.push({ at: this.now(), where: String(where).slice(0, 40),
        message: String((err && (err.message || err)) || 'unknown').slice(0, 300) });
      if (this.errors.length > MAX_ERRORS) this.errors.shift();
    } catch { /* never throw from the error path */ }
  }

  noteMemory(heapMB) {
    if (heapMB > this.peakHeapMB) this.peakHeapMB = heapMB;
  }

  stateOf(u, at) {
    if (at - u.lastRead <= RECORDING_MS) return 'recording';
    if (at - u.lastReview <= REVIEWING_MS) return 'reviewing';
    if (at - u.lastSeen <= OPEN_MS) return 'app open';
    return 'offline';
  }

  prune(force) {
    const at = this.now();
    for (const [h, u] of this.users) if (at - u.lastSeen > KEEP_MS) { this.users.delete(h); this.keys.delete(h); }
    if (force && this.users.size >= MAX_USERS) {
      const oldest = [...this.users.values()].sort((a, b) => a.lastSeen - b.lastSeen)[0];
      if (oldest) { this.users.delete(oldest.hash); this.keys.delete(oldest.hash); }
    }
  }

  /** Everything the admin view shows. `who` maps a hash to { email, plan }. */
  snapshot(who = {}) {
    this.prune(false);
    const at = this.now();
    const users = [...this.users.values()]
      .sort((a, b) => b.lastSeen - a.lastSeen)
      .map((u) => {
        const state = this.stateOf(u, at);
        return {
          user: u.hash,
          email: (who[u.hash] && who[u.hash].email) || null,
          plan: (who[u.hash] && who[u.hash].plan) || null,
          state,
          game: u.game,
          version: u.version,
          lastSeenSec: Math.round((at - u.lastSeen) / 1000),
          readsLastMinute: u.reads.filter((t) => at - t <= 60000).length,
          callsToday: u.callsToday,
          firstSeen: new Date(u.firstSeen).toISOString(),
        };
      });
    const count = (s) => users.filter((u) => u.state === s).length;
    const mem = process.memoryUsage();
    const heapMB = Math.round(mem.heapUsed / 1048576);
    this.noteMemory(heapMB);
    const routes = [...this.routes.entries()]
      .map(([route, r]) => ({ route, calls: r.calls, errors5xx: r.errors5xx, errors4xx: r.errors4xx,
        slow: r.slow, avgMs: r.calls ? Math.round(r.totalMs / r.calls) : 0,
        lastErrorSec: r.lastError ? Math.round((at - r.lastError) / 1000) : null }))
      .sort((a, b) => b.calls - a.calls);
    return {
      asOf: new Date(at).toISOString(),
      now: { recording: count('recording'), reviewing: count('reviewing'), appOpen: count('app open'),
        online: users.length - count('offline'), seenToday: users.length },
      users,
      server: {
        startedAt: new Date(this.startedAt).toISOString(),
        uptimeSec: Math.round((at - this.startedAt) / 1000),
        heapMB, peakHeapMB: this.peakHeapMB, rssMB: Math.round(mem.rss / 1048576),
        node: process.version,
      },
      routes,
      errors: this.errors.slice().reverse().map((e) => ({ ...e, at: new Date(e.at).toISOString() })),
    };
  }
}

/** The one shared tracker the server and the admin routes use. */
const presence = new Presence();

module.exports = { Presence, presence, classify, hashOf, RECORDING_MS, REVIEWING_MS, OPEN_MS };

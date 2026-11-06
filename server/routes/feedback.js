'use strict';

/**
 * REPORT A PROBLEM (docs/claude/feedback.md).
 *
 *   POST /api/feedback   a signed in account or a licence key (the caller
 *     resolution every account route uses), body
 *     { kind, text, version, os, game, reviewId, images: [{ type: 'image/jpeg', data }] }
 *     -> 201 { ok: true, id }
 *        400 { error: 'invalid' | 'too-short' | 'too-long' | 'too-many' | 'too-big', field }
 *        401 { error: 'sign-in-required' } with no caller, 503 { error: 'account-unavailable' } in an outage
 *        429 { error: 'rate-limited', retryAfter }  5 an hour, 20 a day per account
 *        503 { error: 'feedback-not-live', said } while the table or the bucket is missing
 *     The body is capped (BODY_LIMIT, server.js), every field checked, control
 *     characters and angle brackets taken out. The row is written first, then
 *     its pictures; a bucket that is not there takes the row back out, so no
 *     report is kept half. Then a short ping to FEEDBACK_WEBHOOK_URL, sent
 *     after the answer and never holding it.
 *
 *   GET  /api/admin/feedback?status=new&limit=50   the admin password
 *     -> { reports: [{ id, created, account, kind, text, version, os, game,
 *          reviewId, status, notes, pictures: [{ name, url }] }] }, each
 *        picture a signed URL good for 15 minutes
 *   POST /api/admin/feedback/:id   { status, note }  -> { ok: true } | 404
 *
 * scripts/feedback-inbox.js (npm run feedback) is the owner's and an agent's
 * way in to both admin routes.
 */

const crypto = require('crypto');
const express = require('express');
const callers = require('../services/caller');
const fb = require('../services/feedback');
const { feedbackLimits } = require('../services/rate-limits');
const { isAdmin: realIsAdmin } = require('../services/admin-auth');

const LATER = 'Reports cannot be taken right now. Try again later.';
const NOT_LIVE = { error: 'feedback-not-live', said: LATER };

function createRouter(deps = {}) {
  const router = express.Router();
  const store = deps.store || fb.createStore(() => require('../db/supabase'));
  const resolver = deps.resolver || callers.shared;
  const env = () => deps.env || process.env;
  const log = deps.log || ((...a) => console.log(...a));
  const limits = deps.limits || feedbackLimits({ now: deps.now });
  const uuid = deps.uuid || (() => crypto.randomUUID());
  const sendPing = deps.ping || ((id, report, n) => fb.ping(id, report, n, { env: env(), fetch: deps.fetch, log: deps.warn }));

  /** The caller, answered for when there is none. */
  async function need(req, res) {
    const r = req.caller ? { status: 'valid', caller: req.caller } : await resolver.identify(req);
    if (r && r.status === 'valid' && r.caller && (r.caller.userId || r.caller.accountKey)) return r.caller;
    if (r && r.status === 'unavailable') { res.status(503).json({ error: 'account-unavailable', retry: true }); return null; }
    res.status(401).json({ error: 'sign-in-required' });
    return null;
  }

  /** Runs the per account limiters in order; true once one has answered. */
  function limited(req, res) {
    for (const mw of limits) {
      let passed = false;
      mw(req, res, () => { passed = true; });
      if (!passed) return true;
    }
    return false;
  }

  router.post('/', async (req, res) => {
    try {
      const caller = await need(req, res);
      if (!caller) return;
      // The limiters key by the caller: hand them the one just named.
      if (!req.caller) req.caller = caller;
      if (limited(req, res)) return;
      const v = fb.validate(req.body);
      if (!v.ok) return res.status(400).json({ error: v.error, field: v.field });
      const id = uuid();
      const row = {
        id,
        account_id: fb.accountIdOf(caller),
        kind: v.report.kind,
        text: v.report.text,
        app_version: v.report.version,
        os: v.report.os,
        game: v.report.game,
        review_id: v.report.reviewId,
        status: 'new',
        notes: null,
        pictures: v.images.length,
      };
      await store.insert(row);
      try {
        for (let i = 0; i < v.images.length; i++) await store.upload(fb.picturePath(id, i + 1), v.images[i]);
      } catch (e) {
        // Never a report kept half: its row goes with its pictures.
        await Promise.resolve(store.remove(id)).catch(() => {});
        throw e;
      }
      log(`[feedback] report ${id} kept (${v.report.kind}, ${v.images.length} picture${v.images.length === 1 ? '' : 's'}, ${v.report.version})`);
      res.status(201).json({ ok: true, id });
      Promise.resolve(sendPing(id, v.report, v.images.length)).catch(() => {});
    } catch (e) {
      if (e && e.notLive) return res.status(503).json(NOT_LIVE);
      console.error('[feedback] a report could not be kept:', fb.scrub(e && e.message, env().FEEDBACK_WEBHOOK_URL));
      if (!res.headersSent) res.status(503).json({ error: 'feedback-failed', said: LATER });
    }
  });

  return router;
}

function createAdminRouter(deps = {}) {
  const router = express.Router();
  const store = deps.store || fb.createStore(() => require('../db/supabase'));
  const isAdmin = deps.isAdmin || realIsAdmin;

  router.get('/', async (req, res) => {
    if (!isAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });
    try {
      const status = typeof req.query.status === 'string' && req.query.status !== 'all' ? req.query.status : (req.query.status === 'all' ? null : 'new');
      if (status && !fb.STATUSES.includes(status)) return res.status(400).json({ error: 'status' });
      const n = Number(req.query.limit);
      const limit = Number.isInteger(n) && n > 0 ? Math.min(n, 200) : 50;
      const rows = await store.list({ status, limit });
      const reports = [];
      for (const r of rows) {
        const pictures = [];
        const count = Math.min(Number(r.pictures) || 0, fb.MAX_IMAGES);
        for (let i = 1; i <= count; i++) {
          const name = `${i}.jpg`;
          const url = await store.signedUrl(fb.picturePath(r.id, i)).catch(() => null);
          pictures.push({ name, url });
        }
        reports.push({
          id: r.id, created: r.created_at, account: r.account_id, kind: r.kind, text: r.text,
          version: r.app_version, os: r.os, game: r.game, reviewId: r.review_id, status: r.status, notes: r.notes, pictures,
        });
      }
      res.json({ reports });
    } catch (e) {
      if (e && e.notLive) return res.status(503).json(NOT_LIVE);
      console.error('[feedback] the reports could not be listed:', e && e.message);
      res.status(500).json({ error: 'feedback-failed' });
    }
  });

  router.post('/:id', async (req, res) => {
    if (!isAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });
    try {
      const id = String(req.params.id || '');
      if (!fb.UUID.test(id)) return res.status(400).json({ error: 'id' });
      const b = req.body || {};
      if (!fb.STATUSES.includes(b.status)) return res.status(400).json({ error: 'status' });
      const note = b.note == null ? null : fb.cleanText(String(b.note), fb.NOTE_MAX);
      const changed = await store.mark(id, b.status, note);
      if (!changed) return res.status(404).json({ error: 'not-found' });
      res.json({ ok: true, id, status: b.status });
    } catch (e) {
      if (e && e.notLive) return res.status(503).json(NOT_LIVE);
      console.error('[feedback] a report could not be marked:', e && e.message);
      res.status(500).json({ error: 'feedback-failed' });
    }
  });

  return router;
}

module.exports = { createRouter, createAdminRouter, NOT_LIVE, LATER };

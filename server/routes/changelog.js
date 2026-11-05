'use strict';

/**
 * GET /api/changelog: what changed in each version of Occlara, public data.
 *
 * The entries are server/data/changelog.json, which `npm run sync:changelog`
 * writes from the one source, changelog/changelog.json at the repo root (never
 * hand edit the copy). Read once when this file is required and kept: the
 * file only changes with a deploy.
 *
 *   GET /api/changelog              { version, entries }, version the newest
 *   GET /api/changelog?since=8.7.1  only the entries strictly newer than 8.7.1
 *   GET /api/changelog?since=junk   400 { error: 'since' }
 *
 * No auth. Cache-Control public, five minutes. Access-Control-Allow-Origin is
 * '*' on the answer, but server.js's own CORS middleware runs first and still
 * refuses an Origin it does not list (no Origin, the app and curl, and the
 * site's origins pass). It is mounted after server.js's route limits, so the
 * anonymous limiter (services/rate-limits.js routeLimits, '/api', per address)
 * covers a request that carries no credentials.
 */

const fs = require('fs');
const path = require('path');
const express = require('express');

const FILE = path.join(__dirname, '..', 'data', 'changelog.json');
const VERSION = /^(\d{1,4})\.(\d{1,4})\.(\d{1,4})$/;

function load() {
  try {
    const entries = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    return Array.isArray(entries) ? entries.filter((e) => e && VERSION.test(String(e.version || ''))) : [];
  } catch (e) {
    console.warn('[changelog] could not read server/data/changelog.json:', e.message);
    return [];
  }
}

function cmp(a, b) {
  const x = VERSION.exec(a).slice(1).map(Number);
  const y = VERSION.exec(b).slice(1).map(Number);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
}

const ENTRIES = load();

function headers(res) {
  res.set('Cache-Control', 'public, max-age=300');
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET');
}

const router = express.Router();

router.options('/', (_req, res) => {
  headers(res);
  res.status(204).end();
});

router.get('/', (req, res) => {
  headers(res);
  const since = req.query.since;
  let entries = ENTRIES;
  if (since !== undefined) {
    if (typeof since !== 'string' || !VERSION.test(since)) return res.status(400).json({ error: 'since' });
    entries = ENTRIES.filter((e) => cmp(e.version, since) > 0);
  }
  res.json({ version: ENTRIES.length ? ENTRIES[0].version : null, entries });
});

module.exports = router;
module.exports.entries = () => ENTRIES;

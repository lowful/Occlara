'use strict';

/**
 * OCCLARA DUOS' REAL SQL, IN THE TESTS (docs/claude/duos.md). A real Postgres
 * (PGlite) with what Supabase gives every project (fixtures/pglite-social.js),
 * the two accounts tables Duos reads as the live server has them
 * (public.entitlements, public.game_usage, only the columns read), Supabase
 * Storage's bucket table, then social-001-profiles.sql and
 * social-002-duos.sql, each run twice.
 *
 *   makeDb({ sql, duos, defaults })  a database with both migrations applied twice
 *   setTier(db, user, tier, status)  the account's entitlement
 *   addGame(db, user, o)             a live Valorant game_usage row (o.minutesAgo, o.status, o.kind)
 */

const fs = require('fs');
const path = require('path');
const base = require('./pglite-social');

const ROOT = path.join(__dirname, '..', '..');
const DUOS_FILE = path.join(ROOT, 'docs', 'sql', 'social-002-duos.sql');
const DUOS_UNDO = path.join(ROOT, 'docs', 'sql', 'social-002-duos-undo.sql');

// What the live project has before Duos: the columns Duos reads, no more.
const ACCOUNTS = `
  CREATE TABLE IF NOT EXISTS public.entitlements (user_id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
    tier text NOT NULL DEFAULT 'free', status text NOT NULL DEFAULT 'active');
  CREATE TABLE IF NOT EXISTS public.game_usage (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL,
    game text NOT NULL, kind text NOT NULL, status text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
  CREATE SCHEMA IF NOT EXISTS storage;
  CREATE TABLE IF NOT EXISTS storage.buckets (id text PRIMARY KEY, name text NOT NULL, public boolean DEFAULT false,
    file_size_limit bigint, allowed_mime_types text[]);
`;

async function makeDb(opts = {}) {
  const db = await base.makeDb({ ...opts, sql: false });
  await db.exec(ACCOUNTS);
  if (opts.sql !== false) {
    const one = fs.readFileSync(base.SQL_FILE, 'utf8');
    await db.exec(one);
    await db.exec(one);
    if (opts.duos !== false) {
      const two = typeof opts.duos === 'string' ? opts.duos : fs.readFileSync(DUOS_FILE, 'utf8');
      await db.exec(two);
      await db.exec(two);
    }
  }
  return db;
}

const setTier = (db, user, tier, status = 'active') => db.query(
  'INSERT INTO public.entitlements (user_id, tier, status) VALUES ($1, $2, $3) ON CONFLICT (user_id) DO UPDATE SET tier = $2, status = $3',
  [user, tier, status]);

const addGame = (db, user, o = {}) => db.query(
  `INSERT INTO public.game_usage (user_id, game, kind, status, created_at) VALUES ($1, $2, $3, $4, now() - make_interval(mins => $5)) RETURNING id`,
  [user, o.game || 'valorant', o.kind || 'live', o.status || 'counted', o.minutesAgo || 30]);

module.exports = { ...base, makeDb, setTier, addGame, DUOS_FILE, DUOS_UNDO };

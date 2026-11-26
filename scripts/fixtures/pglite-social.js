'use strict';

/**
 * THE REAL SQL, IN THE TESTS (docs/claude/social.md). A real Postgres
 * (PGlite, a devDependency, never shipped: electron-builder packs only the
 * production dependencies) with what Supabase gives every project, then
 * docs/sql/social-001-profiles.sql run on it, twice. The social routes run on
 * it through `supabaseOf(db)`, a client with supabase-js's rpc() shape, so
 * every route test exercises the functions that will run in production, not
 * a copy of them.
 *
 *   makeDb({ sql, defaults })  a database with the migration applied twice;
 *                              defaults: Supabase's default privileges for the
 *                              migration's role (anon and authenticated get
 *                              ALL on new tables and functions), so the
 *                              revokes are proved against them
 *   supabaseOf(db)             { rpc(name, args) } -> { data, error }
 *   addUser(db, id)            an auth.users row
 *   rpc(db, name, args)        the value, or a throw
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const SQL_FILE = path.join(ROOT, 'docs', 'sql', 'social-001-profiles.sql');
const UNDO_FILE = path.join(ROOT, 'docs', 'sql', 'social-001-profiles-undo.sql');

const STUBS = `
  CREATE SCHEMA IF NOT EXISTS auth;
  CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY, email text);
  CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
  END $$;
  GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
  GRANT USAGE ON SCHEMA auth TO service_role;
  GRANT SELECT, REFERENCES ON auth.users TO service_role;
`;
const SUPABASE_DEFAULTS = `
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
`;

async function makeDb(opts = {}) {
  const { PGlite } = require('@electric-sql/pglite');
  const db = new PGlite();
  await db.exec(STUBS);
  if (opts.defaults !== false) await db.exec(SUPABASE_DEFAULTS);
  if (opts.sql !== false) {
    const sql = typeof opts.sql === 'string' ? opts.sql : fs.readFileSync(SQL_FILE, 'utf8');
    await db.exec(sql);
    await db.exec(sql);
  }
  return db;
}

async function rpc(db, name, args = {}) {
  const keys = Object.keys(args);
  const r = await db.query(`SELECT public.${name}(${keys.map((k, i) => `${k} => $${i + 1}`).join(', ')}) AS v`,
    // A list goes as a Postgres array (PostgREST turns a JSON array into text[]), an object as jsonb.
    keys.map((k) => (args[k] !== null && typeof args[k] === 'object' && !Array.isArray(args[k]) ? JSON.stringify(args[k]) : args[k])));
  return r.rows[0].v;
}

/** supabase-js's rpc() over PGlite: { data, error } with Postgres's code, never a throw. */
function supabaseOf(db) {
  return {
    async rpc(name, args) {
      try { return { data: await rpc(db, name, args), error: null }; } catch (e) {
        return { data: null, error: { code: e && e.code ? String(e.code) : 'XX000', message: e && e.message } };
      }
    },
  };
}

const addUser = (db, id) => db.query('INSERT INTO auth.users (id) VALUES ($1) ON CONFLICT DO NOTHING', [id]);

module.exports = { makeDb, rpc, supabaseOf, addUser, SQL_FILE, UNDO_FILE };

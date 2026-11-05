#!/usr/bin/env node
'use strict';

/**
 * THE CHANGELOG HAS ONE SOURCE: changelog/changelog.json at the repo root, an
 * array newest first of { version, date, title, summary, items: [{ kind, text }] }.
 * This script checks it and writes the two copies the app and the server read,
 * the way sync:valorant writes its two:
 *
 *   server/data/changelog.json            GET /api/changelog (server/routes/changelog.js)
 *   src/shared/changelog.generated.json   the What's new page, bundled, read at once
 *
 * The client (src/) and the server (server/) ship separately and src/ never
 * requires from server/, so each gets its own identical copy. Never hand edit
 * either: edit the source and run `npm run sync:changelog`. `npm run
 * check:changelog` fails when a copy differs from the source or the source
 * breaks a rule below.
 *
 * It FAILS CLOSED: one broken rule and nothing is written. The rules, because
 * every line reaches players (the app, the API, the site, Discord):
 *   - kind is new, improved or fixed, and every field is a non empty string
 *   - versions are x.y.z, unique, strictly descending
 *   - a date is a real calendar day, YYYY-MM-DD, never later than the version above it
 *   - no em or en dash, no semicolon, anywhere
 *   - a summary is one sentence under 140 characters
 *   - at most 12 items a version
 *
 * Run:  npm run sync:changelog
 *       node scripts/sync-changelog.js --check   validate and compare only (check:changelog)
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SOURCE = path.join(ROOT, 'changelog', 'changelog.json');
const COPIES = [
  path.join(ROOT, 'server', 'data', 'changelog.json'),
  path.join(ROOT, 'src', 'shared', 'changelog.generated.json'),
];

const KINDS = ['new', 'improved', 'fixed'];
const MAX_ITEMS = 12;
const MAX_SUMMARY = 140;
const MAX_TITLE = 80;
const MAX_TEXT = 300;
// Written as char codes, never as the characters (CLAUDE.md, no dashes).
const BANNED = [String.fromCharCode(0x2013), String.fromCharCode(0x2014), ';'];
const VERSION = /^(\d+)\.(\d+)\.(\d+)$/;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function cmpVersion(a, b) {
  const x = VERSION.exec(a).slice(1).map(Number);
  const y = VERSION.exec(b).slice(1).map(Number);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
}

function realDate(s) {
  const m = DATE.exec(s);
  if (!m) return false;
  const [y, mo, d] = m.slice(1).map(Number);
  const t = new Date(Date.UTC(y, mo - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d && y >= 2020;
}

const str = (v) => typeof v === 'string' && v.trim().length > 0 && v === v.trim();

/** Every rule the changelog breaks, as sentences. Empty when it is well formed. */
function validate(entries) {
  const errs = [];
  if (!Array.isArray(entries) || !entries.length) return ['the changelog is not a non empty array'];
  const seen = new Set();
  entries.forEach((e, i) => {
    const at = `entry ${i} (${e && e.version})`;
    if (!e || typeof e !== 'object' || Array.isArray(e)) { errs.push(`${at} is not an object`); return; }
    const keys = Object.keys(e).sort().join(',');
    if (keys !== 'date,items,summary,title,version') errs.push(`${at} has the fields ${keys}, wants date, items, summary, title, version`);
    if (!str(e.version) || !VERSION.test(e.version)) errs.push(`${at}: version is not x.y.z`);
    else if (seen.has(e.version)) errs.push(`${at}: version is listed twice`);
    else seen.add(e.version);
    if (!str(e.date) || !realDate(e.date)) errs.push(`${at}: date is not a real YYYY-MM-DD day`);
    if (!str(e.title) || e.title.length > MAX_TITLE) errs.push(`${at}: title is empty or over ${MAX_TITLE} characters`);
    if (!str(e.summary)) errs.push(`${at}: summary is empty`);
    else {
      if (e.summary.length >= MAX_SUMMARY) errs.push(`${at}: summary is ${e.summary.length} characters, must be under ${MAX_SUMMARY}`);
      if (!/[.!?]$/.test(e.summary) || /[.!?]\s+[A-Z]/.test(e.summary)) errs.push(`${at}: summary is not one sentence`);
    }
    if (!Array.isArray(e.items) || !e.items.length) errs.push(`${at}: items is not a non empty array`);
    else {
      if (e.items.length > MAX_ITEMS) errs.push(`${at}: ${e.items.length} items, at most ${MAX_ITEMS}`);
      e.items.forEach((it, j) => {
        const k = it && typeof it === 'object' ? Object.keys(it).sort().join(',') : '';
        if (k !== 'kind,text') errs.push(`${at} item ${j}: wants exactly kind and text`);
        if (!it || !KINDS.includes(it.kind)) errs.push(`${at} item ${j}: kind is not new, improved or fixed`);
        if (!it || !str(it.text) || it.text.length > MAX_TEXT) errs.push(`${at} item ${j}: text is empty or over ${MAX_TEXT} characters`);
      });
    }
    if (i > 0) {
      const prev = entries[i - 1];
      if (prev && VERSION.test(prev.version || '') && VERSION.test(e.version || '') && cmpVersion(prev.version, e.version) <= 0) {
        errs.push(`${at}: versions must go down, newest first (${prev.version} then ${e.version})`);
      }
      if (prev && realDate(prev.date || '') && realDate(e.date || '') && prev.date < e.date) {
        errs.push(`${at}: dated after the newer version above it`);
      }
    }
  });
  const text = JSON.stringify(entries);
  for (const b of BANNED) {
    if (text.includes(b)) errs.push(`the changelog holds a banned character (code ${b.charCodeAt(0)}): no em or en dash, no semicolon`);
  }
  return errs;
}

/** The bytes both copies hold: the source parsed and written back canonically. */
function render(entries) {
  return `${JSON.stringify(entries, null, 2)}\n`;
}

function readSource() {
  return JSON.parse(fs.readFileSync(SOURCE, 'utf8'));
}

function main() {
  const check = process.argv.includes('--check');
  let entries;
  try { entries = readSource(); } catch (e) {
    console.error(`[changelog] cannot read ${path.relative(ROOT, SOURCE)}: ${e.message}`);
    process.exit(1);
  }
  const errs = validate(entries);
  if (errs.length) {
    for (const e of errs) console.error(`FAIL  ${e}`);
    console.error('[changelog] nothing written');
    process.exit(1);
  }
  const want = render(entries);
  if (check) {
    let bad = 0;
    for (const p of COPIES) {
      const rel = path.relative(ROOT, p);
      let have = null;
      try { have = fs.readFileSync(p, 'utf8'); } catch { /* missing */ }
      if (have === want) console.log(`PASS  ${rel} matches changelog/changelog.json`);
      else { bad++; console.error(`FAIL  ${rel} ${have === null ? 'is missing' : 'differs from changelog/changelog.json'}: run npm run sync:changelog`); }
    }
    console.log(`PASS  ${entries.length} versions, newest ${entries[0].version}, every rule kept`);
    process.exit(bad ? 1 : 0);
  }
  for (const p of COPIES) {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, want);
    console.log(`[changelog] wrote ${path.relative(ROOT, p)}`);
  }
  console.log(`[changelog] ${entries.length} versions, newest ${entries[0].version}`);
}

if (require.main === module) main();

module.exports = { validate, render, cmpVersion, realDate, SOURCE, COPIES, KINDS, MAX_ITEMS, MAX_SUMMARY };

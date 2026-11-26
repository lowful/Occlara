'use strict';

/**
 * THE YEAR RECORD (docs/claude/wrapped.md): one compact row per reviewed match,
 * kept a year to a file and never trimmed, so Wrapped can tell a heavy
 * player's January in December. The library keeps 300 reviews at most
 * (review-store.js MAX_REVIEWS) and pushes the oldest out; this keeps their
 * rows.
 *
 *   <root>/<year>.json       { v, year, rows: { <review id>: row } }
 *   <root>/<year>.json.bak   the last good copy before the newest write
 *   <root>/state.json        { v, backfilledAt }: the one time fill from the library
 *
 * WRITTEN ON EVERY SAVE OF A REVIEW, BY ITS ID (review-store.js save), so a late
 * link or an upgraded review replaces its row and never adds a second. The
 * library's trim (save() pushing the oldest out) never touches a row. A review
 * taken out of the library on purpose (remove() with its index: the player
 * deleting an imported recording, a match that resumed, a stop folded into the
 * whole match, a backfill taken back) takes its row with it, so a match is
 * never counted that the player or the app deleted.
 *
 * A CORRUPT FILE NEVER LOSES THE YEAR. Every write goes through a temp file,
 * flushed, then renamed, and the copy it replaces is kept as .bak first. A
 * year file that cannot be read is put aside (.corrupt-<time>, kept for a
 * look) and its .bak is read in its place; the next write rewrites both. Read
 * tolerantly: a row of a shape rowOf does not write is dropped, a file of a
 * newer schema is read for what it has and never written over.
 *
 * Plain fs, no Electron, so scripts/test-wrapped.js runs it on a temp folder.
 */

const fs = require('fs');
const path = require('path');
const W = require('../../shared/wrapped');

const SCHEMA = 1;
const YEAR_RE = /^(\d{4})\.json$/;

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return undefined; }
}

/**
 * A year file read, and what kind of answer it gave:
 *   ok       { data }, a year file
 *   missing  no file there
 *   corrupt  { text }, read whole but not JSON, or not a year file: the only
 *            answer that ever sets a file aside
 *   busy     { error }, the disk would not hand it over (a scanner holding it,
 *            EBUSY, EPERM, EACCES, anything else): never taken for corrupt
 */
function readYear(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch (e) {
    return e && e.code === 'ENOENT' ? { state: 'missing' } : { state: 'busy', error: e };
  }
  let data;
  try { data = JSON.parse(text); } catch { return { state: 'corrupt', text }; }
  return isYearFile(data) ? { state: 'ok', data } : { state: 'corrupt', text };
}

const SPACE = /[\s,]/;

/**
 * Every whole row that can still be read out of a year file cut short: the
 * rows object is walked key by key, each row parsed on its own, and the walk
 * stops at the first one that does not parse. So a file cut off in its last
 * row loses that row alone, never the year.
 */
function salvage(text) {
  const out = {};
  const s = String(text || '');
  const at = s.indexOf('"rows"');
  if (at < 0) return out;
  let i = s.indexOf('{', at);
  if (i < 0) return out;
  i += 1;
  const skip = () => { while (i < s.length && SPACE.test(s[i])) i += 1; };
  /** Past the closing quote of the string that starts at s[k], or -1. */
  const strEnd = (k) => {
    for (let j = k + 1; j < s.length; j++) {
      if (s[j] === '\\') { j += 1; continue; }
      if (s[j] === '"') return j + 1;
    }
    return -1;
  };
  for (;;) {
    skip();
    if (s[i] !== '"') break;
    const keyEnd = strEnd(i);
    if (keyEnd < 0) break;
    let key;
    try { key = JSON.parse(s.slice(i, keyEnd)); } catch { break; }
    i = keyEnd;
    skip();
    if (s[i] !== ':') break;
    i += 1;
    skip();
    if (s[i] !== '{') break;
    let depth = 0;
    let j = i;
    for (; j < s.length; j++) {
      const c = s[j];
      if (c === '"') { const e = strEnd(j); if (e < 0) { j = s.length; break; } j = e - 1; continue; }
      if (c === '{') depth += 1;
      else if (c === '}') { depth -= 1; if (depth === 0) break; }
    }
    if (j >= s.length) break;
    try { out[key] = JSON.parse(s.slice(i, j + 1)); } catch { break; }
    i = j + 1;
  }
  return out;
}

/** Through a temp file, flushed before the rename, the old copy kept as .bak. */
function writeJson(file, data) {
  const tmp = `${file}.tmp`;
  const fd = fs.openSync(tmp, 'w');
  try {
    fs.writeSync(fd, JSON.stringify(data));
    try { fs.fsyncSync(fd); } catch { /* flushed by the rename on most disks */ }
  } finally {
    fs.closeSync(fd);
  }
  try { if (fs.existsSync(file) && readJson(file) !== undefined) fs.copyFileSync(file, `${file}.bak`); } catch { /* the bak is a spare */ }
  fs.renameSync(tmp, file);
}

const isYearFile = (x) => !!x && typeof x === 'object' && x.rows && typeof x.rows === 'object';

class YearRecord {
  /**
   * @param root      the folder (userData/wrapped)
   * @param opts.log  (...a) => void
   */
  constructor(root, opts) {
    this.root = root;
    this.log = (opts && typeof opts.log === 'function') ? opts.log : () => {};
    this.cache = new Map();     // year -> { rows: Map, newer: bool }, only once read for sure
    this.pending = new Map();   // year -> Map(id -> row | null): changes made while its file was held
  }

  file(year) { return path.join(this.root, `${year}.json`); }

  ensure() { if (!fs.existsSync(this.root)) fs.mkdirSync(this.root, { recursive: true }); }

  /**
   * One year's rows by id.
   *
   * READ ONCE FOR SURE, THEN KEPT. A file the disk would not hand over (a
   * scanner holding it for a moment: EBUSY, EPERM, EACCES) is NOT corrupt: it
   * is never set aside, renamed or written over. What can be read is served
   * (its .bak), the year is marked held, nothing is cached, and the next load
   * reads it again; a change made meanwhile waits in `pending` and is laid on
   * the real file once it is read. Only a file that was read and is not a
   * year file is corrupt: it is set aside (.corrupt-<time>), every whole row
   * still in it is salvaged and laid over its .bak, and the year written back.
   *
   * A ROW BELONGS TO THE FILE IT IS IN. Which local year a match falls in
   * depends on the time zone it is read in (00:30 on 1 January in one zone is
   * 31 December in another), so a row is never dropped for its date: the story
   * places each row by the reader's own calendar (wrapped.js story).
   */
  load(year) {
    if (this.cache.has(year)) return this.cache.get(year);
    const file = this.file(year);
    const got = readYear(file);
    let data = null;
    let recovered = false;
    let salvaged = {};
    if (got.state === 'ok') data = got.data;
    if (got.state === 'corrupt') {
      salvaged = salvage(got.text);
      try { fs.renameSync(file, `${file}.corrupt-${Date.now()}`); } catch { /* read the bak anyway */ }
      recovered = true;
      this.log(`[wrapped] the year file ${path.basename(file)} was not readable JSON: set aside, ${Object.keys(salvaged).length} rows salvaged from it, the rest from its backup`);
    }
    if (got.state !== 'ok') {
      const bak = readYear(`${file}.bak`);
      if (bak.state === 'ok') { data = bak.data; if (got.state === 'missing') recovered = true; }
    }
    const rows = new Map();
    const newer = !!(data && Number.isFinite(data.v) && data.v > SCHEMA);
    for (const [id, row] of Object.entries({ ...((data && data.rows) || {}), ...salvaged })) {
      const r = W.cleanRow(row);
      if (r && r.id === id) rows.set(id, r);
    }
    const waiting = this.pending.get(year);
    if (waiting) for (const [id, row] of waiting) { if (row) rows.set(id, row); else rows.delete(id); }
    if (got.state === 'busy') {
      // Held: served, never cached and never written, read again next time.
      this.log(`[wrapped] the year file ${path.basename(file)} could not be read just now (${got.error && got.error.code}): it is left as it is`);
      return { rows, newer, held: true };
    }
    const entry = { rows, newer, recovered };
    this.cache.set(year, entry);
    // Recovered, or changes that waited on a held file: written back whole.
    if (waiting) this.pending.delete(year);
    if ((recovered || (waiting && waiting.size)) && !newer) this.write(year);
    return entry;
  }

  write(year) {
    const e = this.load(year);
    if (e.newer || e.held) return false;   // a newer schema, or a file held right now, is never written over
    this.ensure();
    writeJson(this.file(year), { v: SCHEMA, year, rows: Object.fromEntries(e.rows) });
    return true;
  }

  /** One row set (or taken, with null) in one year: written, or kept waiting while the file is held. */
  apply(year, id, row) {
    const e = this.load(year);
    if (row) e.rows.set(id, row); else e.rows.delete(id);
    if (e.held) {
      if (!this.pending.has(year)) this.pending.set(year, new Map());
      this.pending.get(year).set(id, row || null);
      return false;
    }
    return this.write(year);
  }

  /** The years on disk. */
  years() {
    let names = [];
    try { names = fs.readdirSync(this.root); } catch { return []; }
    const ys = new Set();
    for (const n of names) {
      const m = YEAR_RE.exec(n) || /^(\d{4})\.json\.bak$/.exec(n);
      if (m) ys.add(Number(m[1]));
    }
    return [...ys].sort();
  }

  /** Every row of one year, oldest first; or of every year with none given. */
  rows(year) {
    const ys = Number.isInteger(year) ? [year] : this.years();
    const out = [];
    for (const y of ys) out.push(...this.load(y).rows.values());
    return out.sort((a, b) => a.at - b.at);
  }

  /** Where an id is kept now, if anywhere (a review re-dated moves years). */
  yearOf(id) {
    for (const y of this.years()) if (this.load(y).rows.has(id)) return y;
    return null;
  }

  /**
   * A review saved or saved again: its row written or replaced, by id.
   * Returns the row, or null for a review that is no match to count, whose
   * old row (if it had one) goes.
   */
  put(id, game, at, review, extra) {
    let row = null;
    try { row = W.rowOf(id, game, at, review, extra); } catch (e) { this.log('[wrapped] row:', e && e.message); row = null; }
    const was = this.yearOf(id);
    if (!row) {
      if (was !== null) this.drop(id);
      return null;
    }
    let y = W.yearOfAt(row.at);
    if (was !== null) {
      const old = this.load(was).rows.get(id);
      // A rank the history knew at an earlier save is kept when this save has none.
      if (old && old.rank && !row.rank) row.rank = old.rank;
      // The same match saved again stays in the file it is in: its local year
      // can read differently in another time zone, and that is no move.
      if (old && old.at === row.at) y = was;
      if (was !== y) this.apply(was, id, null);
    }
    this.apply(y, id, row);
    return row;
  }

  /** A review deleted on purpose: its row goes. */
  drop(id) {
    const y = this.yearOf(id);
    if (y === null) return false;
    this.apply(y, id, null);
    return true;
  }

  /** The rank tiers the history knows, laid on rows that have none (by Riot's match id). */
  fillRanks(rankOf) {
    if (typeof rankOf !== 'function') return 0;
    let n = 0;
    for (const y of this.years()) {
      const e = this.load(y);
      let changed = false;
      for (const r of e.rows.values()) {
        if (r.rank || r.game !== 'valorant' || !r.matchId) continue;
        let p = null;
        try { p = rankOf(r.matchId); } catch { p = null; }
        const rank = p && typeof p.tier === 'string' && !/^unrated$/i.test(p.tier) ? { tier: p.tier, elo: Number.isFinite(p.elo) ? p.elo : null } : null;
        if (rank && W.LADDER.includes(rank.tier.split(' ')[0])) { r.rank = rank; changed = true; n += 1; }
      }
      if (changed) this.write(y);
    }
    return n;
  }

  /** Whether the one time fill from the library has run. */
  backfilled() {
    const s = readJson(path.join(this.root, 'state.json'));
    return !!(s && Number.isFinite(s.backfilledAt));
  }

  /**
   * THE ONE TIME FILL: every review on disk when this version first runs, so
   * the year that is already under way is not empty. A row already kept is
   * replaced by the review's own (the same id). Returns how many rows were
   * written; marks itself done only once it ran to the end.
   * @param reviews  { list(), get(id) } (review-store.js)
   * @param extraOf  (entry) => { rank } for a review, optional
   */
  backfill(reviews, extraOf) {
    if (this.backfilled()) return 0;
    let n = 0;
    const byYear = new Map();
    for (const meta of reviews.list()) {
      const e = reviews.get(meta.id);
      if (!e || !e.review) continue;
      let extra = null;
      try { extra = typeof extraOf === 'function' ? extraOf(e) : null; } catch { extra = null; }
      let row = null;
      try { row = W.rowOf(e.id || meta.id, e.game || meta.game, Number.isFinite(e.at) ? e.at : meta.at, e.review, extra); } catch { row = null; }
      if (!row) continue;
      const y = W.yearOfAt(row.at);
      if (!byYear.has(y)) byYear.set(y, []);
      byYear.get(y).push(row);
      n += 1;
    }
    // A year whose file is held right now gets its rows when it is read, and
    // the fill is not marked done, so the next launch makes sure of it.
    let held = false;
    for (const [y, list] of byYear) {
      const e = this.load(y);
      if (e.held) {
        held = true;
        if (!this.pending.has(y)) this.pending.set(y, new Map());
        for (const r of list) this.pending.get(y).set(r.id, r);
        continue;
      }
      for (const r of list) e.rows.set(r.id, r);
      this.write(y);
    }
    if (held) return n;
    this.ensure();
    writeJson(path.join(this.root, 'state.json'), { v: SCHEMA, backfilledAt: Date.now(), rows: n });
    return n;
  }
}

module.exports = { YearRecord, SCHEMA };

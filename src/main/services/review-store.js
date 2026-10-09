'use strict';

/**
 * Every post-match review, kept, for every game.
 *
 * A review used to be pushed to a window and then gone, so closing the window
 * lost the match. The library is where the player goes back to them, and the
 * cross-match patterns are counted from what is saved here, so a review that
 * is not saved is a match that does not count.
 *
 *   <root>/index.json          one small row per review, newest first, for the list
 *   <root>/<id>.json           the whole review, exactly as the window paints it
 *   <root>/<id>/<name>.jpg     the frames the review looked at, when it looked
 *
 * A REVIEW IS SAVED MORE THAN ONCE. The Valorant review opens at once from the
 * screen, again when the scoreboard links, and again when Riot's round record
 * and the rewritten summary land. Every version goes to the same id, so the
 * library holds the best one and never three copies of one match.
 *
 * Plain fs, no Electron, so the tests run it against a temp folder.
 */

const fs = require('fs');
const path = require('path');

const MAX_REVIEWS = 300;          // about a season of daily play
const ID_RE = /^[a-z]+-\d{10,}-[a-z0-9]{4,}$/;
const FRAME_RE = /^[a-z0-9-]{1,40}\.jpg$/;

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

/** Write through a temp file, so a crash mid write never leaves half a JSON. */
function writeJson(file, data) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, file);
}

/** A new id: the game, the time, and a few random characters. */
function newId(game, at = Date.now()) {
  return `${String(game || 'match').toLowerCase().replace(/[^a-z]/g, '') || 'match'}-${at}-${Math.random().toString(36).slice(2, 8)}`;
}

/** The row the list shows, from a whole review. */
function metaOf(id, game, review, at) {
  const r = review || {};
  const g = r.game || {};
  const grade = r.grade || null;
  const top = r.insights && r.insights.mistakes && r.insights.mistakes[0];
  return {
    id, game, at,
    title: g.agent || g.hero || g.champion || null,
    map: g.map || null,
    mode: g.mode || null,
    result: g.result || null,
    score: g.score || null,
    grade: grade && grade.score !== null && grade.score !== undefined
      ? { score: grade.score, letter: grade.letter, provisional: !!grade.provisional } : null,
    topMistake: top ? top.title : null,
    verified: !!r.verified,
    // The Riot match it is linked to, so the match link never gives the same
    // match to a second review.
    matchId: r.matchId || null,
    // A review recording was stopped in the middle of: it never owns its Riot
    // link against a later recording of the same match.
    stoppedLive: !!r.stoppedLive,
    // 'riot' when it was graded from Riot's record of a match the coach never
    // watched, so the list can say so (backfill.js).
    source: r.source || null,
  };
}

class ReviewStore {
  constructor(root) {
    this.root = root;
  }

  ensure() {
    if (!fs.existsSync(this.root)) fs.mkdirSync(this.root, { recursive: true });
  }

  index() {
    const rows = readJson(path.join(this.root, 'index.json'), []);
    return Array.isArray(rows) ? rows : [];
  }

  /**
   * Save (or replace) one review.
   *
   * @param entry.id      the review's id, from newId(); the same id replaces
   * @param entry.game    'valorant' | 'rivals' | 'lol'
   * @param entry.at      when the match ended
   * @param entry.review  the review object the window paints
   * @param entry.frames  { name: jpeg base64 } to keep beside it, optional
   */
  save({ id, game, at, review, frames }) {
    if (!ID_RE.test(String(id || ''))) throw new Error(`bad review id: ${id}`);
    this.ensure();
    const when = at || Date.now();
    writeJson(path.join(this.root, `${id}.json`), { id, game, at: when, review });
    if (frames && typeof frames === 'object') {
      const dir = path.join(this.root, id);
      for (const [name, b64] of Object.entries(frames)) {
        if (!FRAME_RE.test(name) || typeof b64 !== 'string') continue;
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, name), Buffer.from(b64, 'base64'));
      }
    }
    const rows = this.index().filter((r) => r && r.id !== id);
    rows.push(metaOf(id, game, review, when));
    rows.sort((a, b) => b.at - a.at);
    for (const old of rows.splice(MAX_REVIEWS)) this.remove(old.id, true);
    writeJson(path.join(this.root, 'index.json'), rows);
    return rows[0] && rows.find((r) => r.id === id);
  }

  /** The list, newest first, optionally one game's. */
  list(game) {
    const rows = this.index();
    return game ? rows.filter((r) => r.game === game) : rows;
  }

  /** One whole review, or null. */
  get(id) {
    if (!ID_RE.test(String(id || ''))) return null;
    const e = readJson(path.join(this.root, `${id}.json`), null);
    return e && e.review ? e : null;
  }

  /** The last `n` whole reviews of one game, newest first. */
  recent(game, n = 10) {
    return this.list(game).slice(0, n).map((r) => this.get(r.id)).filter(Boolean);
  }

  /** A kept frame as base64, or null. */
  frame(id, name) {
    if (!ID_RE.test(String(id || '')) || !FRAME_RE.test(String(name || ''))) return null;
    try { return fs.readFileSync(path.join(this.root, id, name)).toString('base64'); } catch { return null; }
  }

  /** Every kept frame of one review, { name: base64 }, to save it again whole. */
  framesOf(id) {
    const out = {};
    if (!ID_RE.test(String(id || ''))) return out;
    let names = [];
    try { names = fs.readdirSync(path.join(this.root, id)); } catch { return out; }
    for (const name of names) {
      const b64 = FRAME_RE.test(name) ? this.frame(id, name) : null;
      if (b64) out[name] = b64;
    }
    return out;
  }

  /**
   * The ids that saving review `id` dated `at` would push out of the cap, the
   * same sort save() makes. Replacing a review pushes nothing out.
   */
  pushedOutBy(id, at) {
    const all = this.index().filter(Boolean);
    if (all.some((r) => r.id === id)) return [];
    const rows = [...all, { id, at: at || Date.now() }].sort((a, b) => b.at - a.at);
    return rows.slice(MAX_REVIEWS).map((r) => r.id).filter((x) => x !== id);
  }

  remove(id, skipIndex = false) {
    if (!ID_RE.test(String(id || ''))) return false;
    try { fs.rmSync(path.join(this.root, `${id}.json`), { force: true }); } catch {}
    try { fs.rmSync(path.join(this.root, id), { recursive: true, force: true }); } catch {}
    if (!skipIndex) writeJson(path.join(this.root, 'index.json'), this.index().filter((r) => r.id !== id));
    return true;
  }
}

module.exports = { ReviewStore, newId, metaOf, MAX_REVIEWS };

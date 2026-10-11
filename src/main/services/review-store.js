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
 *   <root>/<id>/r<n>-clip.mkv  a clip of each moment it looked at, cut from the
 *                              match's recording (8.3, shared/clips.js), under
 *                              a cap on what every clip takes together; a
 *                              League game's are d<k>-clip.mkv, by death
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
const { CLIP_RE } = require('../../shared/clips');

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
    // And when Riot says that match started, so Home places it in the rank
    // history by its own start (home-model.js startOf) rather than one put
    // back from `at`, which is when the watch ended it or Stop was pressed.
    matchStartedAt: Number.isFinite(r.matchStartedAt) && r.matchStartedAt > 0 ? r.matchStartedAt : null,
    // A review recording was stopped in the middle of: it never owns its Riot
    // link against a later recording of the same match.
    stoppedLive: !!r.stoppedLive,
    // 'riot' when it was graded from Riot's record of a match the coach never
    // watched, so the list can say so (backfill.js).
    source: r.source || null,
    // Where its frames are in the AI log (8.2, index.js), so the list can say
    // whether they are still kept without opening the review. Null when the
    // log was off; left out for a review saved before 8.2, which kept none
    // and is looked up by when its match ended (ai-log-store.js scopeFor).
    ...(r.aiLog !== undefined ? { aiLog: r.aiLog || null } : {}),
  };
}

/**
 * A row as the list hands it out. A review graded from Riot's record alone has
 * no mistakes (insights.countable), but 8.0.3 and 8.1 wrote the first of the
 * list it then had into the index as its top one, and a row is only written
 * again when its own review is saved again. So it is cleaned on the way out,
 * for the library and Stats alike, and never rewritten on disk.
 */
function listed(row) {
  return row && row.source === 'riot' && row.topMistake ? { ...row, topMistake: null } : row;
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
    const rows = this.index().map(listed);
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

  // ── Clips (8.3) ────────────────────────────────────────────────────────────
  // A clip of each moment a review looked at, cut from its match's recording
  // (review-clips.js). Kept in the review's folder beside its frames, so it
  // goes with the review whichever way the review goes (remove() above, or
  // pushed out of the library by save()). Never read whole into a review: the
  // page plays it by range through occlara-clip (clip-scheme.js), and this is
  // where that scheme's path comes from.

  /**
   * Where one clip of one review is kept, or null when the id is not a
   * review's or the name not a clip's (shared/clips.js CLIP_RE): that review's
   * own folder under the root, and nowhere else.
   */
  clipFile(id, name) {
    if (!ID_RE.test(String(id || '')) || !CLIP_RE.test(String(name || ''))) return null;
    return path.join(this.root, id, name);
  }

  /**
   * Keep one clip beside a review, WRITTEN BY PATH: the bytes go to the file
   * and nowhere else, never into the review's JSON or through base64 as its
   * frames do, a clip being a few MB. Through a temp file, so a page playing
   * the last one under that name never reads half of the next. Returns the
   * bytes kept, 0 when nothing was.
   */
  saveClip(id, name, bytes) {
    const file = this.clipFile(id, name);
    if (!file || !bytes || !bytes.length) return 0;
    const dir = path.dirname(file);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const tmp = `${file}.tmp`;
    try {
      fs.writeFileSync(tmp, bytes);
      fs.renameSync(tmp, file);
    } catch (e) {
      try { fs.rmSync(tmp, { force: true }); } catch {}
      throw e;
    }
    return bytes.length;
  }

  /** Whether that clip is on disk. */
  hasClip(id, name) {
    const file = this.clipFile(id, name);
    if (!file) return false;
    try { return fs.statSync(file).isFile(); } catch { return false; }
  }

  /** One review's clips on disk: [{ name, bytes }], by name. */
  clipsOf(id) {
    if (!ID_RE.test(String(id || ''))) return [];
    let names = [];
    try { names = fs.readdirSync(path.join(this.root, id)); } catch { return []; }
    const out = [];
    for (const name of names.filter((n) => CLIP_RE.test(n)).sort()) {
      try {
        const st = fs.statSync(path.join(this.root, id, name));
        if (st.isFile()) out.push({ name, bytes: st.size });
      } catch {}
    }
    return out;
  }

  /**
   * A review's clips are the last look's: any other clip in its folder (one an
   * earlier look cut, of a round this one did not choose) goes. Returns how
   * many went.
   */
  keepClips(id, names) {
    const keep = new Set(names || []);
    let gone = 0;
    for (const c of this.clipsOf(id)) {
      if (keep.has(c.name)) continue;
      try { fs.rmSync(path.join(this.root, id, c.name), { force: true }); gone += 1; } catch {}
    }
    return gone;
  }

  /**
   * Every clip kept, review by review, oldest first: { bytes, clips, reviews,
   * byReview: [{ id, at, bytes, clips }] }. A folder of clips whose review is
   * gone from the library (written as it went) sorts before every review.
   */
  clipUsage() {
    const at = new Map(this.index().filter(Boolean).map((r) => [r.id, r.at]));
    let dirs = [];
    try { dirs = fs.readdirSync(this.root, { withFileTypes: true }); } catch { dirs = []; }
    const byReview = [];
    for (const d of dirs) {
      if (!d.isDirectory() || !ID_RE.test(d.name)) continue;
      const list = this.clipsOf(d.name);
      if (!list.length) continue;
      byReview.push({
        id: d.name, at: at.has(d.name) ? at.get(d.name) : -Infinity, owned: at.has(d.name),
        bytes: list.reduce((n, c) => n + c.bytes, 0), clips: list.length,
      });
    }
    byReview.sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    return {
      bytes: byReview.reduce((n, r) => n + r.bytes, 0),
      clips: byReview.reduce((n, r) => n + r.clips, 0),
      reviews: byReview.length,
      byReview,
    };
  }

  /**
   * THE CAP. Past `capBytes` together, the clips go a review at a time, the
   * oldest review first (a folder no review owns before any), until what is
   * left fits. A review that lost its clips keeps its frames, its facts and
   * its grade, and is told why (clipsCleared, 'space'), which its page says.
   * Returns the ids cleared, oldest first.
   */
  capClips(capBytes) {
    const cap = Number(capBytes);
    if (!Number.isFinite(cap) || cap < 0) return [];
    const u = this.clipUsage();
    let total = u.bytes;
    const cleared = [];
    for (const r of u.byReview) {
      if (total <= cap) break;
      this.dropClips(r, 'space');
      total -= r.bytes;
      cleared.push(r.id);
    }
    return cleared;
  }

  /** Every clip, gone (Clear clips in Settings), each review told so. Returns the ids cleared. */
  clearClips(reason) {
    const why = reason === 'space' ? 'space' : 'cleared';
    const cleared = [];
    for (const r of this.clipUsage().byReview) {
      this.dropClips(r, why);
      cleared.push(r.id);
    }
    return cleared;
  }

  /** One review's clips deleted, and the review told why; a folder no review owns, deleted whole. */
  dropClips(r, why) {
    if (!r.owned) {
      try { fs.rmSync(path.join(this.root, r.id), { recursive: true, force: true }); } catch {}
      return;
    }
    for (const c of this.clipsOf(r.id)) {
      try { fs.rmSync(path.join(this.root, r.id, c.name), { force: true }); } catch {}
    }
    this.markClipsCleared(r.id, why);
  }

  /**
   * Say on the saved review that its clips were cleared, and why: 'space'
   * (the cap) or 'cleared' (Settings). Only the review's own file is written:
   * the library's row carries nothing about clips.
   */
  markClipsCleared(id, reason) {
    if (!ID_RE.test(String(id || ''))) return false;
    const file = path.join(this.root, `${id}.json`);
    const e = readJson(file, null);
    if (!e || !e.review) return false;
    e.review.clipsCleared = { reason: reason === 'space' ? 'space' : 'cleared', at: Date.now() };
    writeJson(file, e);
    return true;
  }
}

module.exports = { ReviewStore, newId, metaOf, MAX_REVIEWS, ID_RE, FRAME_RE, CLIP_RE };

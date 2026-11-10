'use strict';

const fs = require('fs');
const path = require('path');
const P = require('../../shared/practice');
const clipScheme = require('./clip-scheme');
const reviewClips = require('./review-clips');

/**
 * THE PRACTICE PAGE'S MAIN HALF (docs/claude/ui.md, "The Practice page"):
 * the plan, the drill marks and Home's line, from what this PC already
 * holds, and nothing sent anywhere.
 *
 * It reads the patterns exactly as the Patterns page does (deps.patterns,
 * index.js getPatterns' own read: reviewStore.recent and patterns.summarise),
 * the rank band main already knows (deps.band, index.js rankBandNow), and
 * the drill library (src/shared/drill-library.json, read again only when the
 * file changes). It keeps the plan and the log under the store's `practice`
 * key (practice.js SCHEMA), read through practice.js normaliseState, so a
 * missing or malformed value is read as nothing saved and never throws.
 *
 * NEVER MID MATCH (screen-silence.md): every call answers null, or
 * { ok: false, error: 'match' }, while a match is in progress or the window
 * is sealed (deps.busy). The page is locked by the seal like every page; this
 * keeps its channels as quiet as the page.
 *
 * @param deps.store      the store (get, set)
 * @param deps.recent     (game) => saved reviews newest first, the patterns' window
 * @param deps.summarise  (saved) => patterns.summarise(saved)
 * @param deps.band       () => rank band or null
 * @param deps.riotId     () => the Riot ID in Settings, or ''
 * @param deps.busy       () => true mid match or sealed
 * @param deps.game       () => the game picked ('valorant', 'lol')
 * @param deps.gameLabel  (id) => its name
 * @param deps.open       (page) => the window shows that page (index.js openPage)
 * @param deps.changed    () => PUSH_PRACTICE to every page
 * @param deps.library    the drill library's path (OCCLARA_DRILLS in dev)
 * @param deps.now        () => ms
 * @param deps.reviews    the review store (review-store.js: clipsOf, clipFile,
 *                        frame), for the player's own clip of each mistake
 *                        (8.11, practice.js clipFor). Without it no clip is
 *                        shown and the page is as before.
 *
 * THE PLAYER'S OWN CLIP (8.11). Each mistake on the page carries the newest
 * clip kept of it, found by the Moments page's join over what is on disk
 * beside each review, asked of the disk on every ask (the cap takes the
 * oldest clips whenever a new one is kept). Its URL is occlara-clip's
 * (clip-scheme.js urlFor), served from the reviews' own folders and nowhere
 * else; its frames are main's read (review-clips.js frameTimes); its poster
 * the look's own frame, as a data URL. Nothing a page hands in names a file.
 */
const LIBRARY = path.join(__dirname, '..', '..', 'shared', 'drill-library.json');
const KEY = 'practice';

function createPractice(deps) {
  const d = deps || {};
  const now = () => (typeof d.now === 'function' ? d.now() : Date.now());
  const busy = () => { try { return !!(d.busy && d.busy()); } catch { return true; } };
  const file = d.library || LIBRARY;
  let cache = { mtime: null, lib: null };
  let pending = null;   // { key, title } the review asked the page to open on

  /** The library, or null when it is missing or holds no drill. */
  function library() {
    let st;
    try { st = fs.statSync(file); } catch { cache = { mtime: null, lib: null }; return null; }
    if (cache.mtime === st.mtimeMs) return cache.lib;
    let lib = null;
    try { lib = P.normaliseLibrary(JSON.parse(fs.readFileSync(file, 'utf8'))); } catch { lib = null; }
    cache = { mtime: st.mtimeMs, lib };
    return lib;
  }

  const read = () => { try { return P.normaliseState(d.store.get(KEY)); } catch { return P.emptyState(); } };
  const write = (s) => { try { d.store.set(KEY, s); } catch (e) { console.log('[practice] could not save:', e && e.message); } };
  const say = () => { try { if (d.changed) d.changed(); } catch { /* no window */ } };

  /** (key) => the player's own newest kept clip of that mistake, or null; none at all without the review store. */
  function clipsOver(saved) {
    const r = d.reviews;
    if (!r || typeof r.clipsOf !== 'function') return null;
    const io = {
      clips: (id) => r.clipsOf(id).map((c) => (typeof c === 'string' ? c : c && c.name)),
      url: (id, name) => clipScheme.urlFor(id, name),
      frames: (id, name) => (typeof r.clipFile === 'function' ? reviewClips.frameTimes(r.clipFile(id, name)) : null),
      poster: (id, name) => {
        const b64 = typeof r.frame === 'function' ? r.frame(id, name) : null;
        return b64 ? `data:image/jpeg;base64,${b64}` : null;
      },
    };
    return (key) => P.clipFor(saved, key, io);
  }

  /** Everything the plan rests on, the plan kept or refreshed and saved when it moved. */
  function current() {
    const lib = library();
    const saved = (d.recent && d.recent('valorant')) || [];
    const patterns = (d.summarise && d.summarise(saved)) || {};
    let band = null;
    try { band = d.band ? d.band() : null; } catch { band = null; }
    const t = now();
    const chosen = P.choosePlan({ patterns, library: lib, band, state: read(), now: t, game: 'valorant' });
    if (chosen.changed) write(chosen.state);
    return { lib, saved, patterns, band, state: chosen.state, t };
  }

  return {
    /**
     * The page, or null mid match. League gets its panel. `asked` is the
     * mistake the page is already open on for this visit ({ key, title }),
     * which the page hands back so a repaint keeps it; the review's newest
     * Practise this wins over it, and is answered once as `opened`.
     */
    get(game, asked) {
      if (busy()) return null;
      const g = game || (d.game ? d.game() : 'valorant');
      if (g !== 'valorant') {
        const label = (d.gameLabel && d.gameLabel(g)) || 'This game';
        return { status: 'game', game: g, empty: { title: `${label} practice`,
          hint: `Practice plans are built from Valorant reviews for now, so there is nothing here for ${label} yet. Switch to Valorant to see yours.` } };
      }
      const c = current();
      const given = asked && typeof asked === 'object' && typeof asked.key === 'string' && asked.key && asked.key.length <= 80
        ? { key: asked.key, title: typeof asked.title === 'string' ? asked.title.slice(0, 120) : null } : null;
      const focus = pending || given;
      const fresh = pending;
      pending = null;
      const riotId = String((d.riotId && d.riotId()) || '').includes('#');
      return { game: 'valorant', ...P.planView({ ...c, library: c.lib, now: c.t, riotId, focus, clipOf: clipsOver(c.saved) }), opened: fresh || null };
    },

    /** A drill marked practised today: { ok } or { ok: false, error }. */
    mark(id) {
      if (busy()) return { ok: false, error: 'match' };
      const lib = library();
      const drill = lib && typeof id === 'string' ? lib.drills.find((x) => x.id === id) : null;
      if (!drill) return { ok: false, error: 'drill' };
      const c = current();
      const plan = c.state.plans.valorant;
      const f = plan ? plan.focus.find((x) => x.drills.includes(id)) : null;
      const t = now();
      const made = P.mark(c.state, drill, t, `p${t.toString(36)}${Math.random().toString(36).slice(2, 6)}`, f ? f.key : null);
      if (!made) return { ok: false, error: 'today' };
      // A third mark finishes a drill, and the plan moves on to the next one.
      const next = P.choosePlan({ patterns: c.patterns, library: lib, band: c.band, state: made.state, now: t, game: 'valorant' });
      write(next.state);
      say();
      return { ok: true };
    },

    /** An entry taken out of the log. */
    remove(id) {
      if (busy()) return { ok: false, error: 'match' };
      const s = typeof id === 'string' ? P.unmark(read(), id) : null;
      if (!s) return { ok: false, error: 'entry' };
      write(s);
      say();
      return { ok: true };
    },

    /** Home's line, "Today's practice: ...", or null (no plan, done today, League, mid match). */
    today() {
      if (busy()) return null;
      if (d.game && d.game() !== 'valorant') return null;
      const c = current();
      return P.todayOf(c.state, c.lib, c.t, 'valorant');
    },

    /** The review's "Practise this": the page, opened on that mistake. */
    open(key, title) {
      if (busy() || typeof key !== 'string' || !key || key.length > 80) return;
      pending = { key, title: typeof title === 'string' ? title.slice(0, 120) : null };
      if (d.open) d.open('practice');
      say();
    },

    library,
  };
}

module.exports = { createPractice, LIBRARY, KEY };

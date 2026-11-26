'use strict';

/**
 * WRAPPED'S MAIN HALF (docs/claude/wrapped.md): the story built from the year
 * record, the words Home and Profile say about it, and when it opens by itself.
 *
 * NEVER MID MATCH (screen-silence.md). Every answer is null, and nothing
 * opens, while a match is in progress or the window is sealed (deps.busy).
 * The surface is its own view over the whole window (main-window.js
 * openWrapped), which the seal closes in the same tick, so nothing of it is
 * shown or heard during a match.
 *
 * IT OPENS BY ITSELF ONCE A YEAR, the first time the window is shown to the
 * player inside that year's window (15 December to 31 January) with enough
 * matches (wrapped.js MIN_MATCHES), no match live, no seal, onboarding done,
 * no review on screen and no games reveal up (deps.free). The store's
 * `wrappedAutoOpened` keeps the year once it did, so it never does again; a
 * window shown mid match leaves it waiting for the next show after.
 *
 * Nothing here is sent anywhere: no server, no route, no upload.
 *
 * @param deps.year      the year record (year-record.js)
 * @param deps.store     the config store (get, set)
 * @param deps.now       () => ms, the clock (a dev run may move it)
 * @param deps.busy      () => true mid match or sealed
 * @param deps.free      () => true when the window may show Wrapped by itself now
 * @param deps.hasClip   (id, name) => the clip is on disk
 * @param deps.clipUrl   (id, name) => its occlara-clip:// URL
 * @param deps.extras    (year) => { trainer, drills }, this year's
 * @param deps.sounds    () => whether the app's sounds are on
 * @param deps.hz        () => the refresh rate of the display the window is on, for the ground's step down
 * @param deps.show      () => true once the view is up (main-window.js openWrapped)
 * @param deps.sample    () => rows of a sample year, or null (a dev run only)
 * @param deps.log       (...a) => void
 */
const W = require('../../shared/wrapped');

const KEY = 'wrappedAutoOpened';
// Every year the player has had Wrapped open, by itself or by their own ask:
// after its window, Profile offers only such a year, or one from FIRST_YEAR on.
const SEEN = 'wrappedSeen';

/**
 * WHETHER WRAPPED MAY OPEN BY ITSELF RIGHT NOW, from main's snapshot of the
 * window (index.js builds it). Only over Home, settled on screen with nothing
 * over it: never over a review, the Trainer mid run, a clip playing in
 * Moments, Settings or Profile on the way back from a checkout. Otherwise it
 * waits for the next time Home is shown; Home's invitation covers the rest.
 *
 * @param s.surfacesUp, s.onboarded   the app is up past onboarding
 * @param s.visible, s.minimized, s.focused   the window, as Windows has it
 * @param s.match, s.sealed           a match in progress, the seal on (held included)
 * @param s.shown, s.onScreen, s.coming   the page asked for, the one on screen, one on its way
 * @param s.toast, s.menu, s.wrapped  a games reveal, the account menu, Wrapped itself up
 */
function mayOpenNow(s) {
  const o = s || {};
  if (!o.surfacesUp || !o.onboarded) return false;
  if (!o.visible || o.minimized || !o.focused) return false;
  if (o.match || o.sealed) return false;
  if (o.shown !== 'home' || o.onScreen !== 'home' || o.coming) return false;
  if (o.toast || o.menu || o.wrapped) return false;
  return true;
}

function createWrapped(deps) {
  const d = deps || {};
  const now = () => (typeof d.now === 'function' ? d.now() : Date.now());
  const busy = () => { try { return !!(d.busy && d.busy()); } catch { return true; } };
  const log = typeof d.log === 'function' ? d.log : () => {};
  const sample = () => { try { return typeof d.sample === 'function' ? d.sample() : null; } catch (e) { log('[wrapped] sample:', e && e.message); return null; } };
  const rows = () => {
    const s = sample();
    if (Array.isArray(s)) return s;
    try { return d.year.rows(); } catch (e) { log('[wrapped] rows:', e && e.message); return []; }
  };
  const has = (id, name) => { try { return !!(d.hasClip && d.hasClip(id, name)); } catch { return false; } };
  let asked = null;   // the year the page should tell next (a Profile entry, an auto open)

  /** The clip a slide names, given its URL, or taken away when it is not on disk any more. */
  function withUrl(clip) {
    if (!clip || !has(clip.id, clip.clip)) return null;
    let url = null;
    try { url = d.clipUrl(clip.id, clip.clip); } catch { url = null; }
    return url ? { ...clip, url } : null;
  }

  /** The year the story should tell now: the one asked for, else the window's, else the latest. */
  function yearNow() {
    if (Number.isInteger(asked)) return asked;
    const s = sample();
    if (Array.isArray(s) && s.length) return W.yearOfAt(s[s.length - 1].at);
    const open = W.yearOpenAt(now());
    return open !== null ? open : W.latestYear(now());
  }

  const readMap = (k) => { try { const v = d.store.get(k); return v && typeof v === 'object' ? v : {}; } catch { return {}; } };
  /** Every year Wrapped was opened, by itself or asked for. */
  const openedYears = () => ({ ...readMap(SEEN), ...readMap(KEY) });
  /** A year opened, kept so Profile can offer it again after its window. */
  function seen(y) {
    if (!Number.isInteger(y) || Array.isArray(sample())) return;
    try { const m = readMap(SEEN); if (!m[y]) d.store.set(SEEN, { ...m, [y]: now() }); } catch { /* offered from FIRST_YEAR on anyway */ }
  }

  /** The page's whole story, or null mid match or sealed. */
  function get() {
    if (busy()) return null;
    const year = yearNow();
    let extras = {};
    try { extras = (typeof d.extras === 'function' && !Array.isArray(sample()) ? d.extras(year) : null) || {}; } catch { extras = {}; }
    const st = W.story(rows(), { year, has, extras });
    for (const s of st.slides) {
      if (s.clip) s.clip = withUrl(s.clip);
    }
    let sounds = true;
    try { sounds = typeof d.sounds === 'function' ? d.sounds() !== false : true; } catch { sounds = true; }
    let hz = null;
    try { hz = typeof d.hz === 'function' ? Number(d.hz()) || null : null; } catch { hz = null; }
    return { year, story: st, sounds, hz, sample: Array.isArray(sample()) };
  }

  /** What Home and Profile say, or null (nothing to say, mid match, sealed). */
  function entry() {
    if (busy()) return null;
    const s = sample();
    if (Array.isArray(s)) {
      const year = s.length ? W.yearOfAt(s[s.length - 1].at) : W.latestYear(now());
      return { ...W.entryOf({ now: new Date(year, 11, 20).getTime(), rows: s }), sample: true };
    }
    return W.entryOf({ now: now(), rows: rows(), opened: openedYears() });
  }

  /** The player asked for it (Home, Profile): opened unless mid match or sealed. */
  function open(year) {
    if (busy()) return { ok: false, error: 'match' };
    const e = entry();
    const y = Number.isInteger(year) ? year : (e ? e.year : null);
    if (!Array.isArray(sample())) {
      const counted = W.countsOf(rows().filter((r) => W.yearOfAt(r.at) === y));
      if (!y || !counted.enough) return { ok: false, error: 'thin' };
    }
    asked = y;
    seen(y);
    let up = false;
    try { up = !!d.show(); } catch (err) { log('[wrapped] show:', err && err.message); up = false; }
    return up ? { ok: true, year: y } : { ok: false, error: 'window' };
  }

  /**
   * The window was shown, restored or focused, or the seal lifted: Wrapped
   * opens by itself if this is the first time in its window. Returns the year
   * opened, or null.
   */
  function maybeAuto() {
    if (busy()) return null;
    let free = false;
    try { free = !!(d.free && d.free()); } catch { free = false; }
    if (!free) return null;
    const opened = (() => { try { return d.store.get(KEY) || {}; } catch { return {}; } })();
    const year = W.autoOpenYear({ now: now(), rows: rows(), opened, free });
    if (year === null) return null;
    // Kept BEFORE it opens: a crash or a seal in the next moment never makes it open twice.
    try { d.store.set(KEY, { ...(opened && typeof opened === 'object' ? opened : {}), [year]: now() }); } catch (e) { log('[wrapped] store:', e && e.message); return null; }
    asked = year;
    seen(year);
    let up = false;
    try { up = !!d.show(); } catch (err) { log('[wrapped] show:', err && err.message); }
    log(`[wrapped] ${year} opened by itself`);
    return up ? year : null;
  }

  return { get, entry, open, maybeAuto, KEY, SEEN };
}

module.exports = { createWrapped, mayOpenNow, KEY, SEEN };

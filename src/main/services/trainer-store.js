'use strict';

const fs = require('fs');
const path = require('path');
const T = require('../../shared/trainer-math');
const R = require('../../shared/trainer-replay');

/**
 * THE TRAINER'S MAIN HALF (docs/claude/trainer.md): the runs the player has
 * finished, kept on this PC under the store's `trainer` key (trainer-math.js
 * SCHEMA, at most RUNS_MAX runs), and the scenario Practice's Train this
 * asked the page to open on. Nothing is sent anywhere: the Trainer makes no
 * network call and no AI call.
 *
 * NEVER MID MATCH (screen-silence.md): every call answers null, or
 * { ok: false, error: 'match' }, while a match is in progress or the window
 * is sealed (deps.busy). The page is sealed like every page; this keeps its
 * channels as quiet as the page.
 *
 * FIGHT IT AGAIN (Nov 2026, shared/trainer-replay.js): the player's own deaths
 * from their recent saved Valorant reviews, as replays the page can fight
 * (`replays`), the ones from matches since the player was last shown them
 * (`fresh`, against the state's `seenAt`), and a replay opened by its id from
 * a review's row (`open('replay:<reviewId>:<round>')`). Every replay run is
 * saved under the one scenario id `replay` (trainer-replay.js SCENARIO), so
 * they chart together. That id is known to the store here and is NOT in
 * trainer-scenarios.json's list, on purpose: a replay is no scenario of the
 * list, and the page's list and its tests read that file.
 *
 * @param deps.store    the store (get, set)
 * @param deps.busy     () => true mid match or sealed
 * @param deps.open     (page) => the window shows that page (index.js openPage)
 * @param deps.changed  () => PUSH_TRAINER to the pages
 * @param deps.now      () => ms
 * @param deps.recent   () => the recent saved Valorant reviews, newest first, as
 *                      the library holds them ({ id, at, review })
 * @param deps.review   (id) => one saved review ({ id, at, review }) or null, so a
 *                      review older than `recent` still opens its replay
 */
const KEY = 'trainer';
const SCENARIOS = path.join(__dirname, '..', '..', 'shared', 'trainer-scenarios.json');

function loadScenarios(file) {
  try {
    const raw = JSON.parse(fs.readFileSync(file || SCENARIOS, 'utf8'));
    return Array.isArray(raw.scenarios) ? raw.scenarios : [];
  } catch { return []; }
}

function createTrainer(deps) {
  const d = deps || {};
  const now = () => (typeof d.now === 'function' ? d.now() : Date.now());
  const busy = () => { try { return !!(d.busy && d.busy()); } catch { return true; } };
  const ids = new Set(loadScenarios(d.scenarios).map((s) => s.id));
  // The scenarios a run may be saved under: the list's, and every replay's one id.
  const runIds = new Set([...ids, R.SCENARIO]);
  let pending = null;   // the scenario a Train this asked for, or a replay's open id, answered once
  let pendingReplay = null;

  const read = () => { try { return T.normaliseState(d.store.get(KEY)); } catch { return T.emptyState(); } };
  const write = (s) => { try { d.store.set(KEY, s); return true; } catch (e) { console.log('[trainer] could not save:', e && e.message); return false; } };
  const say = () => { try { if (d.changed) d.changed(); } catch { /* no window */ } };
  const recent = () => { try { const r = d.recent && d.recent(); return Array.isArray(r) ? r : []; } catch { return []; } };
  /** The replays of the recent saved reviews, newest match first (trainer-replay.js replaysOf). */
  const list = () => { try { return R.replaysOf(recent()); } catch { return []; } };
  /** One replay by its open id, from the recent reviews or that review itself, or null. */
  const replayFor = (open) => {
    const want = R.parseOpen(open);
    if (!want) return null;
    let entry = recent().find((e) => e && (e.id === want.reviewId || (e.review && e.review.id === want.reviewId))) || null;
    if (!entry && d.review) { try { entry = d.review(want.reviewId); } catch { entry = null; } }
    if (!entry) return null;
    const review = entry.review && typeof entry.review === 'object'
      ? { ...entry.review, id: entry.review.id || entry.id, at: Number.isFinite(entry.review.at) ? entry.review.at : entry.at } : entry;
    if (review.id !== want.reviewId) return null;
    try { return R.replayOf(review, want.round); } catch { return null; }
  };

  return {
    /**
     * Every run's summary for the page's history and bests, and a scenario
     * asked for, or null mid match. A replay opened from a review answers as
     * `opened: 'replay:<reviewId>:<round>'` with the replay itself as `replay`.
     */
    get() {
      if (busy()) return null;
      const opened = pending;
      const replay = pendingReplay;
      pending = null;
      pendingReplay = null;
      return { runs: read().runs, opened, replay };
    },

    /**
     * Fight it again: { list, fresh } or null mid match. `list` is every
     * replayable death of the recent saved Valorant reviews, newest match
     * first and the player's flagged ones first within a match; `fresh` the
     * ids of those from matches newer than the last time the player was shown
     * them (`seen`), all of them before the first time.
     */
    replays() {
      if (busy()) return null;
      const all = list();
      const since = read().seenAt;
      const fresh = all.filter((x) => since === null || (Number.isFinite(x.at) && x.at > since)).map((x) => x.id);
      return { list: all, fresh };
    },

    /** The player said Got it, or began one: the replays from matches up to now are no longer fresh. */
    seen() {
      if (busy()) return { ok: false, error: 'match' };
      const s = read();
      s.seenAt = Math.round(now());
      if (!write(s)) return { ok: false, error: 'save' };
      return { ok: true, seenAt: s.seenAt };
    },

    /** One finished run saved: { ok, run, best } or { ok: false, error }. The time is main's own. */
    save(run) {
      if (busy()) return { ok: false, error: 'match' };
      if (!run || typeof run !== 'object' || !runIds.has(run.scenario)) return { ok: false, error: 'run' };
      const before = T.historyOf(read(), run.scenario).best;
      const next = T.addRun(read(), { ...run, at: now() });
      if (!next) return { ok: false, error: 'run' };
      if (!write(next)) return { ok: false, error: 'save' };
      const saved = next.runs[next.runs.length - 1];
      say();
      return { ok: true, run: saved, best: !before || saved.score > before.score };
    },

    /** Every run of one scenario taken away, or all of them with no scenario. */
    clear(scenario) {
      if (busy()) return { ok: false, error: 'match' };
      const s = read();
      if (scenario != null && !runIds.has(scenario)) return { ok: false, error: 'run' };
      s.runs = scenario == null ? [] : s.runs.filter((r) => r.scenario !== scenario);
      if (!write(s)) return { ok: false, error: 'save' };
      say();
      return { ok: true };
    },

    /**
     * Practice's Train this: the page, opened on that scenario. Or a review's
     * Fight it again: 'replay:<reviewId>:<round>', opened only when that
     * replay exists (trainer-replay.js replayOf).
     */
    open(scenario) {
      if (busy() || typeof scenario !== 'string') return false;
      let replay = null;
      if (scenario.startsWith('replay:')) {
        replay = replayFor(scenario);
        if (!replay) return false;
      } else if (!ids.has(scenario)) {
        return false;
      }
      pending = scenario;
      pendingReplay = replay;
      if (d.open) d.open('trainer');
      say();
      return true;
    },

    has: (id) => ids.has(id),
  };
}

module.exports = { createTrainer, KEY, SCENARIOS, loadScenarios };

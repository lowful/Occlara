'use strict';

const fs = require('fs');
const path = require('path');
const T = require('../../shared/trainer-math');

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
 * @param deps.store    the store (get, set)
 * @param deps.busy     () => true mid match or sealed
 * @param deps.open     (page) => the window shows that page (index.js openPage)
 * @param deps.changed  () => PUSH_TRAINER to the pages
 * @param deps.now      () => ms
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
  let pending = null;   // the scenario a Train this asked for, answered once

  const read = () => { try { return T.normaliseState(d.store.get(KEY)); } catch { return T.emptyState(); } };
  const write = (s) => { try { d.store.set(KEY, s); return true; } catch (e) { console.log('[trainer] could not save:', e && e.message); return false; } };
  const say = () => { try { if (d.changed) d.changed(); } catch { /* no window */ } };

  return {
    /** Every run's summary for the page's history and bests, and a scenario asked for, or null mid match. */
    get() {
      if (busy()) return null;
      const opened = pending;
      pending = null;
      return { runs: read().runs, opened };
    },

    /** One finished run saved: { ok, run, best } or { ok: false, error }. The time is main's own. */
    save(run) {
      if (busy()) return { ok: false, error: 'match' };
      if (!run || typeof run !== 'object' || !ids.has(run.scenario)) return { ok: false, error: 'run' };
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
      if (scenario != null && !ids.has(scenario)) return { ok: false, error: 'run' };
      s.runs = scenario == null ? [] : s.runs.filter((r) => r.scenario !== scenario);
      if (!write(s)) return { ok: false, error: 'save' };
      say();
      return { ok: true };
    },

    /** Practice's Train this: the page, opened on that scenario. */
    open(scenario) {
      if (busy() || typeof scenario !== 'string' || !ids.has(scenario)) return false;
      pending = scenario;
      if (d.open) d.open('trainer');
      say();
      return true;
    },

    has: (id) => ids.has(id),
  };
}

module.exports = { createTrainer, KEY, SCENARIOS, loadScenarios };

'use strict';

/**
 * Whole Marvel Rivals sessions through the real engine, with only the network,
 * the capture and the clock faked.
 *
 * WHY THIS EXISTS. The engine shipped asking hero select's question on every
 * probe of every session, because the timer that chose the question had always
 * expired by the time a scoreboard came up, so no Rivals match was ever
 * reviewed. Fixing only that would have made one scoreboard left on screen a
 * new review every eight seconds. And a pause could never be resumed, because
 * the engine never said it was paused. Every unit test passed through all
 * three, because none of them played a session: they ticked once or twice and
 * looked at one answer. The failures live in the SEQUENCE (lobby, hero select,
 * a match, the scoreboard, the lobby again), so that is what this plays, at the
 * real cadence, on a fake clock, through the engine's own tick(), route() and
 * schedule().
 *
 * The model is a table of answers per screen and per question, and it includes
 * the wrong answers each prompt gives the other's screen, because those are
 * what the routing has to survive. Told the phase is always "draft", hero
 * select's prompt calls the scoreboard hero select, and invents a hero for it.
 * Told the phase is always "scoreboard", the scoreboard's prompt calls hero
 * select a scoreboard. And the Tab scoreboard in the middle of a match carries
 * every column the end screen has except the result.
 *
 * Run: npm run test:rivalssession
 */
const path = require('path');
const api = require(path.join(__dirname, '..', 'src', 'main', 'services', 'api-client.js'));
const engineModule = require(path.join(__dirname, '..', 'src', 'main', 'services', 'rivals-engine.js'));
const { RivalsEngine, PROBE_MS, DRAFT_ROUTE, REVIEW_ROUTE, REVIEW_COOLDOWN_MS, DRAFT_RUN_MAX,
  SELECT_TIMER_MAX } = engineModule;

let fails = 0;
const ok = (cond, what) => { if (!cond) { fails++; console.log(`FAIL  ${what}`); } else console.log(`ok    ${what}`); };

const SEC = 1000;
const MIN = 60 * SEC;

// ── A fake clock that drives the engine's own setTimeout ────────────────────
const real = { now: Date.now, setTimeout: global.setTimeout, clearTimeout: global.clearTimeout, post: api.post };
const clock = { t: 0, timers: new Map(), seq: 0 };

function install(start) {
  clock.t = start;
  clock.timers.clear();
  Date.now = () => clock.t;
  global.setTimeout = (fn, ms) => {
    const id = ++clock.seq;
    clock.timers.set(id, { at: clock.t + (ms || 0), fn });
    return id;
  };
  global.clearTimeout = (id) => { clock.timers.delete(id); };
}

function uninstall() {
  Date.now = real.now;
  global.setTimeout = real.setTimeout;
  global.clearTimeout = real.clearTimeout;
  api.post = real.post;
}

/** Let a probe in flight finish. setImmediate is the real one, never faked. */
async function settle(e) {
  for (let i = 0; i < 200 && (i < 3 || e.inFlight); i++) await new Promise((r) => setImmediate(r));
}

/** Fire the engine's timers in time order up to `until`, letting each probe finish. */
async function runTo(e, until) {
  await settle(e);
  for (;;) {
    let next = null;
    for (const [id, t] of clock.timers) if (!next || t.at < next.at) next = { id, ...t };
    if (!next || next.at > until) break;
    clock.timers.delete(next.id);
    clock.t = Math.max(clock.t, next.at);
    await next.fn();
    await settle(e);
  }
  clock.t = Math.max(clock.t, until);
}

// ── The game: a script of screens ───────────────────────────────────────────
const ROW_A = { name: 'you', role: 'Duelist', kills: 22, deaths: 7, assists: 9,
  damage: 41230, blocked: 1200, healing: 0, accuracy: 38 };
// The same screen read again with one figure wrong, which is what a vision
// model does to a five digit number now and then.
const ROW_A_MISREAD = { ...ROW_A, damage: 41280 };
const ROW_B = { name: 'you', role: 'Strategist', kills: 4, deaths: 5, assists: 19,
  damage: 9050, blocked: 0, healing: 21400, accuracy: 51 };
// What the Tab scoreboard shows partway through a match: every column, no result.
const TAB_ROW = { name: 'you', role: 'Duelist', kills: 9, deaths: 3, assists: 4,
  damage: 15200, blocked: 300, healing: 0, accuracy: 37 };

const lobby = (ms) => ({ screen: 'lobby', ms });
const select = (hero, pickAt = 10 * SEC, ms = 30 * SEC) => ({ screen: 'select', ms, hero, pickAt });
const loading = (ms = 15 * SEC) => ({ screen: 'loading', ms });
const match = (ms, tabs = []) => ({ screen: 'match', ms, tabs });
const mvp = (result, ms = 15 * SEC) => ({ screen: 'mvp', ms, result });
const board = (result, row, ms) => ({ screen: 'scoreboard', ms, result, row });
const desktop = (ms) => ({ screen: 'desktop', ms });

const lengthOf = (script) => script.reduce((a, s) => a + s.ms, 0);

/** What is on screen at time t: the segment, how far into it, and whether Tab is held. */
function frameAt(script, t0, t) {
  let at = t0;
  for (const seg of script) {
    if (t < at + seg.ms) {
      const offset = t - at;
      const tab = (seg.tabs || []).some(([a, b]) => offset >= a && offset < b);
      return { ...seg, offset, tab };
    }
    at += seg.ms;
  }
  // The script is over: the player has closed the game.
  return { screen: 'desktop', offset: 0, tab: false };
}

// The model inventing a result on the Tab scoreboard mid match, which nothing
// on that screen prints. Switched on for one case below.
let tabInventsResult = false;

/** The model, as each prompt answers each screen. */
function answer(route, f) {
  const draft = route === DRAFT_ROUTE;
  const say = (tip, context) => ({ tip, context });
  switch (f.screen) {
    case 'lobby':
    case 'loading':
      return say('LOBBY', {});
    case 'select': {
      // Told the phase is always "scoreboard": hero select comes back as one,
      // with no scoreline, because there is none on the screen.
      if (!draft) return say('Pick a hero you are comfortable on.', { phase: 'scoreboard' });
      const ctx = { phase: 'draft', mode: 'CONVERGENCE', suggested: 'SUGGESTED PICK: STRATEGIST',
        locked: ['Duelist'], timer: Math.max(0, 30 - Math.floor(f.offset / SEC)) };
      // The name prints once the player has picked, and not before.
      if (f.hero && f.offset >= f.pickAt) ctx.mine = f.hero;
      return say('Take a Vanguard, your team needs a front line.', ctx);
    }
    case 'match':
      if (f.tab && !draft) {
        return say('Look for a trade before you commit.', { phase: 'scoreboard', mode: 'CONVERGENCE', me: TAB_ROW,
          ...(tabInventsResult ? { result: 'victory' } : {}) });
      }
      return say('SKIP', {});
    case 'mvp':
      // The showcase before the scoreboard: a result, and no row of numbers.
      return draft ? say('SKIP', {}) : say('Good match.', { phase: 'scoreboard', result: f.result });
    case 'scoreboard':
      // Told the phase is always "draft", the scoreboard comes back as hero
      // select, with a hero read off a portrait. The routing must never ask.
      if (draft) {
        return say('Lock a Strategist.', { phase: 'draft', mine: 'venom', locked: ['Vanguard', 'Duelist'] });
      }
      return say('Look for a trade before you commit.', { phase: 'scoreboard', result: f.result,
        map: 'Klyntar: Symbiotic Surface', mode: 'CONVERGENCE', me: f.row });
    default:
      return say('SKIP', {});
  }
}

/**
 * One session: an engine with the shipped flags, the network stubbed with the
 * table above, and everything it emits recorded.
 */
function session(script, opts = {}) {
  const t0 = real.now();       // a real epoch, because the review's patch note is dated
  install(t0);
  const s = { t0, end: t0 + lengthOf(script), calls: [], reviews: [], statuses: [], notices: [],
    logs: [], inflight: 0, maxInflight: 0, maxTimers: 0 };
  const latency = opts.latency == null ? 1500 : opts.latency;

  api.post = async (route, body) => {
    s.inflight++;
    s.maxInflight = Math.max(s.maxInflight, s.inflight);
    const f = JSON.parse(body.image);
    s.calls.push({ route, at: clock.t, screen: f.screen, tab: f.tab });
    if (opts.hook) opts.hook(s, s.calls.length);
    // Yield before answering, so a second probe started beside this one would
    // be seen in maxInflight rather than hidden by a synchronous stub.
    await new Promise((r) => setImmediate(r));
    clock.t += latency;
    s.inflight--;
    const special = opts.reply ? opts.reply(route, f, s.calls.length) : null;
    return special || { ok: true, status: 200, data: answer(route, f) };
  };

  const e = new RivalsEngine({
    getKey: () => 'KEY',
    capture: async () => { clock.t += 50; return JSON.stringify(frameAt(script, t0, clock.t)); },
    log: (m) => s.logs.push(m),
    getHistory: () => [],
    features: opts.features || { review: true, draft: false, heroCapture: true },
  });
  e.on('review', (r) => {
    const last = s.calls[s.calls.length - 1];
    s.reviews.push({ r, at: clock.t, screen: last && last.screen, tab: last && last.tab });
  });
  e.on('status', (st) => s.statuses.push(st));
  e.on('notice', (n) => s.notices.push(n));
  const schedule = e.schedule.bind(e);
  e.schedule = (ms) => {
    schedule(ms);
    s.maxTimers = Math.max(s.maxTimers, clock.timers.size);
    if (e.paused && clock.timers.size > 0) s.timerWhilePaused = true;
  };
  s.e = e;
  return s;
}

/** Start, play the whole script, stop. */
async function play(s) {
  s.e.start();
  await runTo(s.e, s.end);
  s.e.stop();
  uninstall();
  return s;
}

const heroOf = (rev) => rev && rev.r.game.hero;
const count = (s, pred) => s.calls.filter(pred).length;

async function main() {
  // ── What ends a match, and what proves hero select ────────────────────────
  // The result regex is new, so it is asserted against strings it must match
  // and strings it must not, before anything relies on it.
  {
    const { matchResult, readsAsSelect } = engineModule.__test || {};
    ok(typeof matchResult === 'function' && ['victory', 'DEFEAT', ' Victory '].every((r) => matchResult({ result: r })),
      'a printed result is read whatever its case');
    ok(typeof matchResult === 'function' && ['win', 'Victory Royale', '', 'draw'].every((r) => matchResult({ result: r }) === null)
      && matchResult({}) === null, 'and nothing else is a result');
    ok(typeof readsAsSelect === 'function' && readsAsSelect({ timer: 12 }) && readsAsSelect({ timer: '9' })
      && readsAsSelect({ suggested: 'SUGGESTED PICK: VANGUARD' }), 'the countdown or the banner proves hero select');
    ok(typeof readsAsSelect === 'function' && !readsAsSelect({}) && !readsAsSelect({ timer: '' }) && !readsAsSelect({ timer: null })
      && !readsAsSelect({ phase: 'draft', mine: 'venom', locked: ['Vanguard'] }),
      'and a phase, a hero and a roster without them do not');
    // The clock regex is new too, so the same: what it must read, what it must not.
    const { countdownSeconds } = engineModule.__test || {};
    ok(typeof countdownSeconds === 'function' && countdownSeconds('0:25') === 25 && countdownSeconds(' 00:07 ') === 7
      && countdownSeconds(12) === 12 && countdownSeconds('9') === 9,
      'a countdown is read from a number, a numeric string or a printed clock');
    ok(typeof countdownSeconds === 'function'
      && [null, undefined, '', '  ', '25s', '0:60', '1:2', 'soon', NaN, Infinity].every((t) => countdownSeconds(t) === null),
      'and nothing else is a countdown');
    ok(typeof readsAsSelect === 'function' && readsAsSelect({ timer: '0:25' }) && readsAsSelect({ timer: 0 })
      && readsAsSelect({ timer: SELECT_TIMER_MAX }), 'a printed clock, and a countdown at zero, prove hero select');
    ok(typeof readsAsSelect === 'function' && !readsAsSelect({ timer: 754 }) && !readsAsSelect({ timer: '12:34' })
      && !readsAsSelect({ timer: SELECT_TIMER_MAX + 1 }) && !readsAsSelect({ timer: -3 }),
      "and a match's printed duration, handed back as a countdown, does not");
  }

  // ── The model invents a result on a Tab scoreboard mid match ──────────────
  // One read of VICTORY used to make a review, and so opened the review window
  // over the match. A result now needs a second read of the same scoreboard or
  // the menu the end screen leads to.
  {
    tabInventsResult = true;
    const s = await play(session([
      lobby(60 * SEC), select('the punisher'), loading(),
      match(15 * MIN, [[2 * MIN, 2 * MIN + 4 * SEC], [7 * MIN + 30 * SEC, 7 * MIN + 36 * SEC]]),
      mvp('defeat'), board('defeat', ROW_A, 60 * SEC), lobby(60 * SEC),
    ], { latency: 1500 }));
    tabInventsResult = false;
    ok(s.reviews.every((x) => x.screen !== 'match'), `no review opens over the match from an invented Tab result (${s.reviews.map((x) => x.screen)})`);
    ok(s.reviews.length === 1 && s.reviews[0].r.game.result === 'defeat',
      `and the real end screen is still reviewed, once (${s.reviews.length})`);
  }

  // ── One match, the scoreboard left up for five minutes ────────────────────
  // The verifier's session: hero select, a fifteen minute match with Tab held
  // three times, the MVP screen, five minutes on the scoreboard, the lobby.
  // Played at a realistic latency and at almost none, because the old timer
  // failed at both.
  for (const latency of [1500, 1]) {
    const s = await play(session([
      lobby(60 * SEC), select('the punisher'), loading(),
      match(15 * MIN, [[2 * MIN, 2 * MIN + 4 * SEC], [7 * MIN + 30 * SEC, 7 * MIN + 36 * SEC], [12 * MIN, 12 * MIN + 10 * SEC]]),
      mvp('victory'), board('victory', ROW_A, 5 * MIN), lobby(60 * SEC),
    ], { latency }));
    const at = `(latency ${latency}ms)`;
    ok(count(s, (c) => c.route === REVIEW_ROUTE) > 0, `the scoreboard's question is asked at all ${at}`);
    ok(count(s, (c) => c.screen === 'select' && c.route === DRAFT_ROUTE) > 0, `hero select is read with hero select's question ${at}`);
    ok(count(s, (c) => c.screen === 'scoreboard' && c.route === REVIEW_ROUTE) > 0,
      `the scoreboard is read with the scoreboard's question ${at}`);
    ok(s.reviews.length === 1, `five minutes on one scoreboard make exactly one review (${s.reviews.length}) ${at}`);
    const rev = s.reviews[0];
    ok(rev && rev.screen === 'scoreboard', `and it was made from the end screen, not from Tab mid match (${rev && rev.screen}) ${at}`);
    ok(heroOf(rev) === 'The Punisher', `it names the hero hero select printed (${heroOf(rev)}) ${at}`);
    ok(rev && rev.r.game.result === 'victory' && rev.r.scoreline.kills === 22,
      `with the result and the row read off the scoreboard ${at}`);
    ok(s.e.mine === null, `and the hero is forgotten once it is reviewed ${at}`);
    ok(count(s, (c) => c.tab && c.route === REVIEW_ROUTE) > 0,
      `the Tab scoreboard WAS read mid match, and made no review ${at}`);
    ok(count(s, (c) => c.screen === 'scoreboard' && c.route === DRAFT_ROUTE) === 0,
      `hero select's question is never asked of the scoreboard ${at}`);
    ok(s.calls.length <= Math.ceil((s.end - s.t0) / PROBE_MS) + 2,
      `and the probe never runs faster than its cadence (${s.calls.length} probes) ${at}`);
  }

  // ── Two matches, two heroes ───────────────────────────────────────────────
  {
    const s = await play(session([
      lobby(40 * SEC), select('the punisher'), loading(), match(10 * MIN),
      mvp('defeat'), board('defeat', ROW_A, 40 * SEC), lobby(45 * SEC),
      select('luna snow', 20 * SEC), loading(), match(12 * MIN),
      mvp('victory'), board('victory', ROW_B, 2 * MIN), lobby(30 * SEC),
    ]));
    ok(s.reviews.length === 2, `two matches make two reviews (${s.reviews.length})`);
    ok(heroOf(s.reviews[0]) === 'The Punisher' && s.reviews[0].r.game.result === 'defeat',
      `the first names the first hero (${heroOf(s.reviews[0])})`);
    ok(heroOf(s.reviews[1]) === 'Luna Snow' && s.reviews[1].r.game.result === 'victory',
      `the second names the second, never the first (${heroOf(s.reviews[1])})`);
  }

  // ── The cooldown never holds back a real second match ─────────────────────
  // A second match ending inside REVIEW_COOLDOWN_MS of the first, which only a
  // stomp does. It came through a lobby and a hero select, so it is new.
  {
    const s = await play(session([
      lobby(30 * SEC), select('the punisher'), loading(), match(8 * MIN),
      board('defeat', ROW_A, 30 * SEC), lobby(20 * SEC),
      select('luna snow'), loading(10 * SEC), match(2 * MIN),
      board('victory', ROW_B, 30 * SEC), lobby(30 * SEC),
    ]));
    ok(s.reviews.length === 2, `two matches still make two reviews (${s.reviews.length})`);
    const gap = s.reviews.length === 2 ? s.reviews[1].at - s.reviews[0].at : Infinity;
    // The scenario's own precondition, so it cannot pass by drifting outside
    // the window it exists to test.
    ok(gap < REVIEW_COOLDOWN_MS, `the second ended inside the cooldown (${Math.round(gap / SEC)}s after the first)`);
    ok(heroOf(s.reviews[1]) === 'Luna Snow', `and the second is the second match's (${heroOf(s.reviews[1])})`);
  }

  // ── Recording started mid match: hero select was never seen ───────────────
  // A missed hero select costs the hero's name, never the match.
  {
    const s = await play(session([
      match(8 * MIN), mvp('victory'), board('victory', ROW_A, 60 * SEC), lobby(30 * SEC),
    ]));
    ok(s.reviews.length === 1, `a match whose hero select was missed is still reviewed (${s.reviews.length})`);
    ok(heroOf(s.reviews[0]) === null, `naming no hero rather than a guessed one (${heroOf(s.reviews[0])})`);
    ok(s.reviews[0] && s.reviews[0].r.refused.some((x) => x.includes('hero select was not captured')),
      'and saying why in its refusals');
    ok(count(s, (c) => c.screen === 'scoreboard' && c.route === DRAFT_ROUTE) === 0,
      "and the scoreboard is still never shown hero select's question");
  }

  // ── A match abandoned at hero select ─────────────────────────────────────
  // Back to the lobby, a new queue, a new hero select, another hero. The first
  // hero never reaches a scoreboard, so nothing but the new hero select can
  // forget it.
  {
    const s = await play(session([
      lobby(30 * SEC), select('the punisher'), lobby(3 * MIN),
      select('luna snow'), loading(), match(10 * MIN),
      mvp('victory'), board('victory', ROW_B, 60 * SEC), lobby(30 * SEC),
    ]));
    ok(s.reviews.length === 1, `an abandoned hero select makes no review of its own (${s.reviews.length})`);
    ok(heroOf(s.reviews[0]) === 'Luna Snow', `and the match played names its own hero, not the abandoned one (${heroOf(s.reviews[0])})`);
  }

  // ── A glance away from the scoreboard, and back ───────────────────────────
  // Twenty seconds on the desktop take the scoreboard off screen as far as the
  // engine knows. Coming back to it must not review it again, whether it is
  // read the same or read with a figure wrong.
  for (const [row, guard, label] of [
    [ROW_A, 'the same result and scoreline', 'read the same'],
    [ROW_A_MISREAD, 'no lobby or hero select', 'read with one figure wrong'],
  ]) {
    const s = await play(session([
      lobby(30 * SEC), select('the punisher'), loading(), match(10 * MIN),
      board('victory', ROW_A, 40 * SEC), desktop(20 * SEC), board('victory', row, 40 * SEC), lobby(30 * SEC),
    ]));
    ok(s.reviews.length === 1, `back on the scoreboard after an alt tab, ${label}: one review (${s.reviews.length})`);
    ok(s.logs.some((m) => m.includes('not reviewed again') && m.includes(guard)),
      `and it is the "${guard}" guard that held it`);
  }

  // ── A scoreboard left up past the cooldown, and read differently late ──────
  // Eight minutes on the end screen, the last two read with one figure wrong.
  // The cooldown has run out and the scoreline no longer matches, so the only
  // thing holding it is that the reviewed scoreboard never left the screen.
  {
    const s = await play(session([
      lobby(30 * SEC), select('the punisher'), loading(), match(10 * MIN),
      board('victory', ROW_A, 6 * MIN), board('victory', ROW_A_MISREAD, 2 * MIN), lobby(30 * SEC),
    ]));
    ok(s.reviews.length === 1, `eight minutes on one end screen, misread late, still make one review (${s.reviews.length})`);
  }

  // ── Alt tabbed out through the whole lobby and hero select ───────────────
  // Nothing but SKIP between one end screen and the next match, so no lobby and
  // no hero select is ever read. The SKIPs alone must take the first scoreboard
  // off the screen, or the next match's would be refused as the same one.
  {
    const s = await play(session([
      lobby(30 * SEC), select('the punisher'), loading(), match(8 * MIN),
      board('defeat', ROW_A, 40 * SEC), desktop(3 * MIN), match(6 * MIN),
      board('victory', ROW_B, 40 * SEC), lobby(30 * SEC),
    ]));
    ok(s.reviews.length === 2, `a match whose lobby and hero select were never seen is still reviewed (${s.reviews.length})`);
    ok(heroOf(s.reviews[1]) === null, `and names no hero, rather than the last match's (${heroOf(s.reviews[1])})`);
  }

  // ── Pause, then resume ────────────────────────────────────────────────────
  {
    const script = [
      lobby(30 * SEC), select('the punisher'), loading(), match(12 * MIN),
      mvp('victory'), board('victory', ROW_A, 60 * SEC), lobby(30 * SEC),
    ];
    const s = session(script);
    const matchStart = s.t0 + lengthOf(script.slice(0, 3));
    const pauseAt = matchStart + 3 * MIN;
    const resumeAt = matchStart + 6 * MIN;
    s.e.start();
    await runTo(s.e, pauseAt);
    s.e.pause();
    s.e.pause();
    await runTo(s.e, resumeAt);
    const during = count(s, (c) => c.at > pauseAt && c.at < resumeAt);
    s.e.resume();
    await runTo(s.e, s.end);
    s.e.stop();
    uninstall();
    ok(s.statuses.join(',') === 'coaching,paused,coaching,stopped',
      `the controller hears coaching, paused, coaching, stopped (${s.statuses.join(', ')})`);
    ok(during === 0, `nothing is read while paused (${during} probes)`);
    ok(count(s, (c) => c.at >= resumeAt) > 10, 'reading starts again on resume');
    ok(s.reviews.length === 1 && heroOf(s.reviews[0]) === 'The Punisher',
      `and the match is still reviewed, with its hero (${s.reviews.length}, ${heroOf(s.reviews[0])})`);
  }

  // ── Pause landing while a probe is in flight ──────────────────────────────
  {
    const script = [lobby(30 * SEC), select('the punisher'), loading(), match(10 * MIN)];
    let pausedAt = 0;
    const s = session(script, { hook: (st, n) => { if (n === 6) { st.e.pause(); pausedAt = clock.t; } } });
    s.e.start();
    await runTo(s.e, s.t0 + 4 * MIN);
    const after = count(s, (c) => c.at > pausedAt);
    ok(pausedAt > 0 && after === 0, `a pause during a probe lets it finish and starts no other (${after} after)`);
    ok(!s.timerWhilePaused && clock.timers.size === 0, 'and the probe finishing schedules nothing while paused');
    s.e.resume();
    await runTo(s.e, s.t0 + 6 * MIN);
    ok(count(s, (c) => c.at > pausedAt) > 5, 'resume reads again');
    s.e.stop();
    uninstall();
  }

  // ── Pause and resume both landing while a probe is in flight ──────────────
  // resume() calls tick() directly. Without the one probe at a time guard it
  // started a second loop beside the one in flight, doubling the cadence for
  // the rest of the session.
  {
    const script = [lobby(30 * SEC), select('the punisher'), loading(), match(10 * MIN)];
    let at = 0;
    const s = session(script, { hook: (st, n) => { if (n === 6) { st.e.pause(); st.e.resume(); at = clock.t; } } });
    s.e.start();
    await runTo(s.e, s.t0 + 8 * MIN);
    s.e.stop();
    uninstall();
    const window = 3 * MIN;
    const inWindow = count(s, (c) => c.at > at && c.at <= at + window);
    ok(s.maxInflight === 1, `never two probes in flight at once (${s.maxInflight})`);
    ok(s.maxTimers <= 1, `never two probes scheduled at once (${s.maxTimers})`);
    ok(inWindow <= Math.ceil(window / PROBE_MS) + 1, `one loop, at one cadence, after it (${inWindow} probes in 3 minutes)`);
  }

  // ── A credits outage ──────────────────────────────────────────────────────
  // The server answers 402 { error: 'credits' }, which api.post reports as not
  // ok, and the old engine checked ok first, so its backoff never ran.
  {
    const out = { ok: false, status: 402, data: { error: 'credits', retryIn: 180 } };
    const s = await play(session([
      lobby(10 * MIN), select('the punisher'), loading(), match(10 * MIN),
      mvp('victory'), board('victory', ROW_A, 60 * SEC), lobby(30 * SEC),
    ], { reply: (route, f, n) => (n <= 3 ? out : null) }));
    const gap = s.calls.length > 1 ? s.calls[1].at - s.calls[0].at : 0;
    ok(gap >= 180 * SEC, `the engine backs off for the server's retryIn (${Math.round(gap / SEC)}s)`);
    const said = s.notices.filter((n) => n.kind === 'credits' && n.text);
    const taken = s.notices.filter((n) => n.kind === 'credits' && !n.text);
    ok(said.length === 1, `and says so once, not once a probe (${said.length})`);
    ok(said[0] && said[0].text.includes('out of credits'), 'in words the panel can show');
    // The controller clears a notice only when its kind comes back with no
    // text, the Valorant engine's contract, so without this the line said
    // "not being read" for the rest of a session that was being read again.
    ok(taken.length === 1 && s.notices.indexOf(taken[0]) > s.notices.indexOf(said[0]),
      `and takes it back once, when reads work again (${taken.length})`);
    ok(s.reviews.length === 1, `and once credits are back, the match is still reviewed (${s.reviews.length})`);
  }

  // ── Started on the end screen, its duration read as a countdown ─────────
  // Start pressed on the scoreboard, so the first question is hero select's.
  // Asked for "seconds left on the countdown", it hands back the duration the
  // end screen prints, and names a hero off a portrait. Believed, that held the
  // guessed hero, went quiet for DRAFT_COOLDOWN_MS, and the review that came
  // after named it.
  {
    const s = await play(session([board('victory', ROW_A, 2 * MIN), lobby(30 * SEC)], {
      reply: (route, f) => (route === DRAFT_ROUTE && f.screen === 'scoreboard'
        ? { ok: true, status: 200, data: { tip: 'Lock a Strategist.',
          context: { phase: 'draft', mine: 'venom', locked: ['Vanguard', 'Duelist'], timer: 754 } } }
        : null),
    }));
    ok(s.reviews.length === 1, `a session started on the end screen still reviews it (${s.reviews.length})`);
    ok(s.reviews.length === 1 && heroOf(s.reviews[0]) === null,
      `naming no hero rather than one read off a portrait (${heroOf(s.reviews[0])})`);
  }

  // ── A countdown printed as a clock, and no banner ─────────────────────────
  // Hero select's prompt asks for the countdown as a number, and a model
  // copying the screen can send "0:25". With the banner unread too, that was
  // the only proof of hero select there was, and refusing it lost the hero.
  {
    const s = await play(session([
      lobby(30 * SEC), select('the punisher'), loading(), match(8 * MIN),
      mvp('victory'), board('victory', ROW_A, 60 * SEC), lobby(30 * SEC),
    ], { reply: (route, f) => {
      if (route !== DRAFT_ROUTE || f.screen !== 'select') return null;
      const left = Math.max(0, 30 - Math.floor(f.offset / SEC));
      const context = { phase: 'draft', mode: 'CONVERGENCE', locked: ['Duelist'], timer: '0:' + String(left).padStart(2, '0') };
      if (f.offset >= f.pickAt) context.mine = f.hero;
      return { ok: true, status: 200, data: { tip: 'Take a Vanguard.', context } };
    } }));
    ok(s.reviews.length === 1 && heroOf(s.reviews[0]) === 'The Punisher',
      `a countdown read as "0:25", with no banner, still proves hero select (${heroOf(s.reviews[0])})`);
  }

  // ── One SKIP at hero select, before the name prints ───────────────────────
  // The cut into hero select, or an alt tab, answered SKIP. That moved the
  // screen on, the rest of hero select went to the scoreboard's prompt, which
  // reads no name, and the match was reviewed with no hero.
  {
    let skipped = 0;
    const s = await play(session([
      lobby(30 * SEC), select('the punisher', 20 * SEC), loading(), match(8 * MIN),
      mvp('victory'), board('victory', ROW_A, 60 * SEC), lobby(30 * SEC),
    ], { reply: (route, f) => (route === DRAFT_ROUTE && f.screen === 'select' && !skipped++
      ? { ok: true, status: 200, data: { tip: 'SKIP', context: {} } } : null) }));
    ok(skipped > 0 && count(s, (c) => c.screen === 'select' && c.route === REVIEW_ROUTE) === 0,
      "a SKIP at hero select leaves the rest of it to hero select's question");
    ok(s.reviews.length === 1 && heroOf(s.reviews[0]) === 'The Punisher',
      `and the hero is still read (${heroOf(s.reviews[0])})`);
  }

  // ── Hero select answered with nothing but SKIP ────────────────────────────
  // Staying on hero select's question after a SKIP must still end: the match
  // that follows gets the scoreboard's question within DRAFT_RUN_MAX probes.
  {
    const s = await play(session([
      lobby(30 * SEC), select('the punisher'), loading(), match(8 * MIN),
      mvp('victory'), board('victory', ROW_A, 60 * SEC), lobby(30 * SEC),
    ], { reply: (route, f) => (route === DRAFT_ROUTE && f.screen === 'select'
      ? { ok: true, status: 200, data: { tip: 'SKIP', context: {} } } : null) }));
    const inMatch = count(s, (c) => c.screen === 'match' && c.route === DRAFT_ROUTE);
    ok(inMatch <= DRAFT_RUN_MAX, `the match is handed to the scoreboard's question within the run (${inMatch} probes)`);
    ok(s.reviews.length === 1 && heroOf(s.reviews[0]) === null,
      `and reviewed once, naming no hero (${s.reviews.length}, ${heroOf(s.reviews[0])})`);
  }

  // ── Abandoned, and the next hero select never prints a name ───────────────
  // The held hero must still go. A review naming no hero is honest; one naming
  // the abandoned hero opens on the line the player checks first, wrong.
  {
    const s = await play(session([
      lobby(30 * SEC), select('the punisher'), lobby(3 * MIN),
      select(null), loading(), match(10 * MIN),
      mvp('victory'), board('victory', ROW_B, 60 * SEC), lobby(30 * SEC),
    ]));
    ok(s.reviews.length === 1 && heroOf(s.reviews[0]) === null,
      `a new hero select forgets the abandoned hero even when it prints no name (${heroOf(s.reviews[0])})`);
  }

  // ── The end screen misread as a lobby ─────────────────────────────────────
  // One LOBBY from the scoreboard's prompt on the end screen sends the next
  // question to hero select's prompt, which calls the scoreboard hero select and
  // names a hero off a portrait. It read no countdown and no banner, so it is
  // not believed, the run bound hands the screen back to the scoreboard's
  // question, and the review names the hero that hero select printed.
  {
    let misread = false;
    const s = await play(session([
      lobby(30 * SEC), select('the punisher'), loading(), match(10 * MIN),
      mvp('victory'), board('victory', ROW_A, 2 * MIN), lobby(30 * SEC),
    ], { reply: (route, f) => {
      if (misread || f.screen !== 'scoreboard' || route !== REVIEW_ROUTE) return null;
      misread = true;
      return { ok: true, status: 200, data: { tip: 'LOBBY', context: {} } };
    } }));
    const asked = count(s, (c) => c.screen === 'scoreboard' && c.route === DRAFT_ROUTE);
    ok(misread && asked > 0, `the misread did send hero select's question to the scoreboard (${asked} times)`);
    ok(asked <= DRAFT_RUN_MAX, `for no more than DRAFT_RUN_MAX probes in a row (${asked})`);
    ok(s.reviews.length === 1, `the match is still reviewed, once (${s.reviews.length})`);
    ok(heroOf(s.reviews[0]) === 'The Punisher',
      `naming the hero hero select printed, not one read off a portrait (${heroOf(s.reviews[0])})`);
  }

  // ── A long queue spends nothing on the scoreboard's question ──────────────
  // A lobby cannot be followed by a scoreboard, so a LOBBY answer does not use
  // up the run that keeps a misread screen from hiding one.
  {
    const s = await play(session([
      lobby(6 * MIN), select('the punisher'), loading(), match(5 * MIN),
    ]));
    const spent = count(s, (c) => c.screen === 'lobby' && c.route === REVIEW_ROUTE);
    ok(spent === 0, `six minutes of queue are all asked hero select's question (${spent} scoreboard probes)`);
    ok(s.e.mine === 'the punisher', `and the hero is read when hero select comes (${s.e.mine})`);
  }

  // ── heroCapture off: the scoreboard's question only ──────────────────────
  {
    const s = await play(session([
      lobby(30 * SEC), select('the punisher'), loading(), match(8 * MIN),
      mvp('victory'), board('victory', ROW_A, 2 * MIN), lobby(30 * SEC),
    ], { features: { review: true, draft: false, heroCapture: false } }));
    ok(count(s, (c) => c.route === DRAFT_ROUTE) === 0, "with heroCapture off, hero select's question is never asked");
    ok(s.reviews.length === 1 && heroOf(s.reviews[0]) === null,
      `and the match is reviewed once, with no hero (${s.reviews.length})`);
  }

  ok(REVIEW_COOLDOWN_MS >= 5 * MIN, 'the cooldown is long enough to outlast a glance away');
}

main().catch((err) => {
  fails++;
  console.log('FAIL  the session run threw: ' + (err && err.stack || err));
}).then(() => {
  uninstall();
  console.log(fails ? `\n${fails} failure(s)` : '\nall rivals session checks passed');
  process.exit(fails ? 1 : 0);
});

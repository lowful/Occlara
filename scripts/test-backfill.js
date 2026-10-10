'use strict';

/**
 * Grading recent matches from Riot's record, against a fake server and a real
 * review store in a temp folder: the order, the baselines, never twice, the
 * old server, the pacing, the wait while a match is played, retries, cancel,
 * and what the status says. And what a run files states facts, never a
 * mistake, with a row saved by an older version read back the same way.
 *
 * The clock is fake: sleep() moves it, so the three second gaps and the half
 * minute retries are measured without being waited for.
 *
 * Run: npm run test:backfill
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { replay, load } = require('./fixtures/replay-match');
const valorantReview = require('../src/shared/valorant-review');
const verify = require('../src/shared/valorant-verify');
const riotReview = require('../src/shared/riot-review');
const insights = require('../src/shared/insights');
const patterns = require('../src/shared/patterns');
const { ReviewStore, newId, MAX_REVIEWS } = require('../src/main/services/review-store');
const { Backfill, plan, windowOf, queueOk, summary, GAP_MS } = require('../src/main/services/backfill');

let fails = 0;
let checks = 0;
const ok = (cond, what) => {
  checks++;
  if (!cond) { fails++; console.log(`FAIL  ${what}`); } else console.log(`ok    ${what}`);
};

const RIOT = load('riot-abyss-13-11.json');
const played = replay(load('valorant-match-abyss-13-11.json').frames, 'standard');
const T0 = Date.parse('2026-09-20T18:00:00Z');
const HOUR = 3600000;

function row(id, i, over = {}) {
  return { matchId: id, map: 'Abyss', agent: 'Jett', mode: 'Competitive', result: 'Victory', score: '13-11',
    kills: 31, deaths: 21, assists: 4, kd: 1.48, acs: 382, adr: 243, headshotPct: 25, startedAt: T0 + i * HOUR, ...over };
}
function riotFor(r) {
  return { ...JSON.parse(JSON.stringify(RIOT)), matchId: r.matchId, map: r.map,
    queue: String(r.mode).toLowerCase(), me: { ...RIOT.me, agent: r.agent } };
}
const idOf = (p) => decodeURIComponent((/matchId=([^&]+)/.exec(p) || [])[1] || '');

let dirs = 0;
function harness(opts = {}) {
  const dir = path.join(os.tmpdir(), `occlara-backfill-test-${process.pid}-${dirs++}`);
  fs.rmSync(dir, { recursive: true, force: true });
  const store = new ReviewStore(dir);
  const listed = opts.rows || [];
  const known = opts.known || listed;
  const answers = opts.answers || {};
  const h = {
    store, calls: [], statuses: [], notices: [], history: opts.history || [],
    clock: T0 + 100 * HOUR, slept: 0, active: new Set(), inMatchNow: false, savedInMatch: 0,
  };
  const inMatch = opts.inMatch || (() => false);
  h.bf = new Backfill({
    get: async (p) => {
      h.calls.push({ path: p, at: h.clock });
      if (opts.get) {
        const custom = await opts.get(p, h);
        if (custom) return custom;
      }
      if (p.startsWith('/api/coach/recent-matches')) return { ok: true, status: 200, data: { matches: listed } };
      if (p.startsWith('/api/coach/match-rounds')) {
        const id = idOf(p);
        if (answers[id] && answers[id].length) return answers[id].shift();
        const r = known.find((x) => x.matchId === id);
        return r ? { ok: true, status: 200, data: riotFor(r) } : { ok: true, status: 200, data: { error: 'No such match.' } };
      }
      return { ok: false, status: 404, data: null };
    },
    library: () => store.list('valorant').map((meta) => ({
      meta,
      review: meta.source !== 'riot' && (!meta.matchId || !meta.verified) ? ((store.get(meta.id) || {}).review || null) : null,
    })),
    // As index.js wires them: the index alone for "linked already?", and the
    // one review an upgrade rewrites read whole.
    remove: (id) => store.remove(id),
    // As index.js wires them: what a new review pushes out of a full library,
    // read whole, and saved again whole by a take back.
    evicts: (review) => store.pushedOutBy(review.id, review.at).map((id) => {
      const e = store.get(id);
      return e ? { id: e.id, game: e.game, at: e.at, review: e.review, frames: store.framesOf(id) } : null;
    }).filter(Boolean),
    restore: (entry) => store.save(entry),
    metas: () => store.list('valorant'),
    whole: (id) => ((store.get(id) || {}).review || null),
    activeIds: () => h.active,
    account: opts.account ? () => opts.account(h) : undefined,
    keeps: opts.keeps,
    save: (review) => {
      if (opts.saveFails && opts.saveFails(review)) throw new Error('disk full');
      if (opts.onSave) opts.onSave(review, h);
      if (h.inMatchNow) h.savedInMatch++;
      store.save({ id: review.id, game: 'valorant', at: review.at, review });
    },
    history: { get: () => h.history, set: (rows) => {
      if (opts.historyFails && opts.historyFails(rows, h)) throw new Error('the config could not be written');
      h.history = rows;
    } },
    inMatch: () => { h.inMatchNow = !!inMatch(h); return h.inMatchNow; },
    onStatus: (s) => h.statuses.push(s),
    notice: (t) => h.notices.push(t),
    // onSleep lets a case act while a run is between requests, the moment a
    // takeover or a cancel arrives in the app.
    sleep: async (ms) => { h.clock += ms; h.slept += ms; if (opts.onSleep) opts.onSleep(ms, h); },
    now: () => h.clock,
    log: () => {},
  });
  h.run = async (account = 'Me#EUW') => { h.bf.start(account); await h.bf.promise; return h.bf.getStatus(); };
  h.rounds = () => h.calls.filter((c) => c.path.startsWith('/api/coach/match-rounds')).map((c) => idOf(c.path));
  h.done = () => fs.rmSync(dir, { recursive: true, force: true });
  return h;
}

/** A recorded review that never linked, saved the way index.js saves one. */
function watched(store, startedAt, over = {}) {
  const snap = { ...played, startedAt, endedAt: startedAt + 24 * 100000 + 60000,
    context: { ...played.context, map: 'Abyss', agent: 'Jett', agentConfirmed: true, teamScore: 13, enemyScore: 11 } };
  const built = valorantReview.build({ rounds: snap.rounds, context: snap.context, endedBy: 'score', ai: {},
    role: 'Duelist', history: [] });
  built.ledger = valorantReview.ledgerOf(snap);
  built.id = newId('valorant', snap.endedAt);
  built.at = snap.endedAt;
  Object.assign(built, over);
  store.save({ id: built.id, game: 'valorant', at: built.at, review: built });
  return built;
}

(async () => {
  // ── The queues graded ────────────────────────────────────────────────────
  ok(queueOk('Competitive') && queueOk('unrated') && queueOk('Swiftplay') && queueOk('Premier'),
    'Competitive, Unrated, Swiftplay and Premier are graded');
  ok(!queueOk('Deathmatch') && !queueOk('Team Deathmatch') && !queueOk('Spike Rush') && !queueOk('Custom Game')
    && !queueOk(null), 'nothing else is');

  // ── Three new matches ────────────────────────────────────────────────────
  {
    const h = harness({ rows: [row('c', 3, { map: 'Ascent' }), row('b', 2, { map: 'Bind' }), row('a', 1)] });
    const s = await h.run();
    ok(h.rounds().join() === 'a,b,c', `oldest first (${h.rounds().join()})`);
    const list = h.store.list('valorant');
    ok(list.length === 3 && list.every((m) => m.source === 'riot' && m.matchId),
      "three reviews, each from Riot's record and linked");
    ok(list.map((m) => m.map).join() === 'Ascent,Bind,Abyss', 'filed newest first, by when each match ended');
    ok(s.state === 'done' && s.graded === 3 && s.total === 3 && s.done === 3 && s.found === 3,
      `the status ends done (${s.state} ${s.graded} of ${s.total})`);
    ok(h.history.map((x) => x.matchId).join() === 'a,b,c' && h.history.every((x, i, all) => !i || all[i - 1].at < x.at),
      'one baseline row per match, in time order');
    ok(h.notices.length === 1 && /Graded 3 recent matches/.test(h.notices[0]), `one notice (${h.notices[0]})`);
    ok(s.items.map((x) => x.matchId).join() === 'c,b,a'
      && s.items.every((x) => x.status === 'graded' && x.grade && typeof x.grade.score === 'number' && x.id),
      'items newest first, each graded, with its grade and its review id');
    const gaps = h.calls.slice(1).map((c, i) => c.at - h.calls[i].at);
    ok(gaps.length > 0 && gaps.every((g) => g >= GAP_MS), `requests at least three seconds apart (${Math.min(...gaps)} ms)`);
    ok(h.statuses.some((x) => x.state === 'listing') && h.statuses.some((x) => x.state === 'grading'),
      'the status is pushed as it changes');
    // FACTS, NEVER A MISTAKE. Riot records what happened and never why: each
    // review a run files keeps its counts as facts with no fix, its library
    // row names no top mistake, and the patterns count none of it.
    const whole = h.store.recent('valorant', 10).map((e) => e.review);
    ok(whole.length === 3 && whole.every((r) => !r.insights.mistakes.length && !r.insights.strengths.length
      && !r.insights.missed.length && r.insights.facts.length && r.insights.facts.every((x) => !('fix' in x))),
    'each states facts, with no mistake, strength, miss or fix line');
    ok(list.every((m) => m.topMistake === null), 'and no library row names a top mistake');
    const p = patterns.summarise(h.store.recent('valorant', patterns.LOOK_BACK));
    ok(p.matches === 3 && p.grades.length === 3 && p.recorded === 0 && !p.enough && !p.mistakes.length && !p.strengths.length,
      `the patterns grade all three and count nothing from them (${p.grades.length} graded, ${p.recorded} recorded)`);
    h.done();
  }

  // ── A row saved by 8.0.3 or 8.1, read back ──────────────────────────────
  {
    const dir = path.join(os.tmpdir(), `occlara-backfill-rows-${process.pid}`);
    fs.rmSync(dir, { recursive: true, force: true });
    try {
      const store = new ReviewStore(dir);
      // As those versions saved a match graded from Riot's record: three lists,
      // the first mistake written into the index as the row's top one.
      const old = riotReview.fromRiot({ row: row('o', 1), riot: riotFor(row('o', 1)), history: [] }).review;
      old.insights = insights.valorant(verify.reconcile([], RIOT).rounds, { role: 'Duelist' });
      old.id = newId('valorant', old.at);
      store.save({ id: old.id, game: 'valorant', at: old.at, review: old });
      const rec = watched(store, T0 + 3 * HOUR);
      const onDisk = (id) => JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8')).find((r) => r.id === id);
      ok(onDisk(old.id).topMistake === old.insights.mistakes[0].title && onDisk(rec.id).topMistake,
        `the index holds the old row's top mistake as it was saved (${onDisk(old.id).topMistake})`);
      const rows = store.list('valorant');
      ok(rows.find((r) => r.id === old.id).topMistake === null && rows.find((r) => r.id === rec.id).topMistake === onDisk(rec.id).topMistake,
        "read back, the row from Riot's record names none, and the recorded one keeps its own");
      ok(onDisk(old.id).topMistake === old.insights.mistakes[0].title && store.list().find((r) => r.id === old.id).topMistake === null,
        'from the whole library too, and nothing on disk was rewritten');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  // ── Only the queues the grade is built for ──────────────────────────────
  {
    const h = harness({ rows: [row('dm', 4, { mode: 'Deathmatch' }), row('sr', 3, { mode: 'Spike Rush' }),
      row('p', 2, { mode: 'Premier' }), row('s', 1, { mode: 'Swiftplay' })] });
    const s = await h.run();
    ok(s.found === 2 && h.store.list('valorant').length === 2 && h.rounds().join() === 's,p',
      'Deathmatch and Spike Rush are never fetched or graded');
    h.done();
  }

  // ── Never twice ──────────────────────────────────────────────────────────
  {
    const h = harness({ rows: [row('b', 2, { map: 'Bind' }), row('a', 1)] });
    // Linked and checked against Riot: the match is the library's already.
    watched(h.store, T0 + 1 * HOUR - 60000, { matchId: 'a', verified: true });
    const s = await h.run();
    ok(s.have === 1 && s.graded === 1 && h.store.list('valorant').length === 2, 'a match already in the library is skipped');
    ok(!h.rounds().includes('a'), 'and its round record is not even fetched');
    h.done();
  }
  {
    const h = harness({ rows: [row('b', 2, { map: 'Bind' }), row('a', 1)] });
    const w = watched(h.store, T0 + 1 * HOUR - 60000);
    const s = await h.run();
    ok(h.store.list('valorant').length === 2, 'a recorded match that never linked is upgraded, not copied');
    const up = h.store.get(w.id).review;
    ok(up.verified && up.matchId === 'a' && up.lateLinked && up.source === 'watched' && !up.ledger,
      "the recorded review now carries Riot's record");
    ok(s.upgraded === 1 && s.graded === 1, `one upgraded and one graded (${s.upgraded}, ${s.graded})`);
    ok(s.items.find((x) => x.matchId === 'a').status === 'upgraded', 'and its item says so');
    h.done();
  }
  {
    const h = harness({ rows: [row('a', 1)] });
    watched(h.store, T0 + 1 * HOUR - 60000);
    watched(h.store, T0 + 1 * HOUR - 30000);
    const s = await h.run();
    // Fetched, because Riot's own start and length can tell recordings apart
    // that the plan's estimate cannot (confirm()); these two it cannot either.
    ok(s.skipped === 1 && s.ambiguous === 1 && s.graded === 0 && s.upgraded === 0
      && h.store.list('valorant').length === 2 && h.rounds().join() === 'a',
      `a match two recordings could both be is left alone (${s.skipped} skipped, ${h.rounds().join()})`);
    h.done();
  }
  {
    const h = harness({ rows: [row('a', 1)] });
    const w = watched(h.store, T0 + 1 * HOUR - 60000);
    h.active = new Set([w.id]);
    const s = await h.run();
    ok(s.total === 0 && s.skipped === 1 && !h.store.get(w.id).review.verified,
      'a match a recording is still linking is left to that recording');
    h.done();
  }
  {
    const h = harness({ rows: [row('a', 1)], get: async (p, hh) => {
      if (p.startsWith('/api/coach/match-rounds')) watched(hh.store, T0 + 1 * HOUR + 30000, { matchId: 'a' });
      return null;
    } });
    const s = await h.run();
    ok(h.store.list('valorant').length === 1 && s.graded === 0 && s.items[0].status === 'have',
      'a match a recording linked while the run worked is not saved a second time');
    h.done();
  }

  // ── The plan and the window, directly ────────────────────────────────────
  {
    const legacyReview = { kind: 'valorant', game: { map: 'Abyss', score: '13-11' }, endedBy: 'score',
      watched: { rounds: 24 }, rounds: [] };
    const w = windowOf({ meta: { id: 'x', at: T0 + 3000000 }, review: legacyReview });
    ok(w.endedAt === T0 + 3000000 && w.startedAt === T0 + 3000000 - 26 * 100000 && w.mctx.agent === null
      && w.mctx.map === 'Abyss' && w.mctx.score.final === true,
      'a review saved before the ledger is placed by its watched rounds, with no agent claimed');
    ok(w.mctx.score.team === 13 && w.mctx.score.enemy === 11, `and its score is read off its scoreline (${w.mctx.score.team}-${w.mctx.score.enemy})`);
    const steps = plan([row('a', 1)], [], new Set());
    ok(steps.length === 1 && steps[0].action === 'new', 'with an empty library every match is new');
  }

  // ── An older server ──────────────────────────────────────────────────────
  {
    const lm = { ...row('a', 1), recent: [row('z', 0, { map: 'Bind' })] };
    const h = harness({ known: [row('a', 1), row('z', 0, { map: 'Bind' })], get: async (p) => (
      p.startsWith('/api/coach/recent-matches') ? { ok: false, status: 404, data: null }
        : p.startsWith('/api/coach/last-match') ? { ok: true, status: 200, data: lm } : null) });
    const s = await h.run();
    ok(s.graded === 2 && h.calls.some((c) => c.path.startsWith('/api/coach/last-match')),
      'a server without the route still grades its newest match and the ones before it');
    h.done();
  }
  {
    // The words that server sends when the account has no match yet.
    const h = harness({ get: async (p) => (
      p.startsWith('/api/coach/recent-matches') ? { ok: false, status: 404, data: null }
        : p.startsWith('/api/coach/last-match')
          ? { ok: true, status: 200, data: { error: 'No recent match found yet. Matches appear a few minutes after they end.' } }
          : null) });
    const s = await h.run();
    ok(s.state === 'done' && s.found === 0 && /No recent/.test(s.message),
      'and one with no match yet says there are none, not that Riot could not be reached');
    h.done();
  }
  {
    // That server says "Account not found." for any failed region lookup, a
    // rate limit included: from it, that is no proof, and a real account
    // would lose its kept profile over a 429.
    const h = harness({ get: async (p) => (
      p.startsWith('/api/coach/recent-matches') ? { ok: false, status: 404, data: null }
        : p.startsWith('/api/coach/last-match') ? { ok: true, status: 200, data: { error: 'Account not found.' } }
          : null) });
    const s = await h.run();
    ok(s.state === 'error' && s.error === 'unreachable',
      `and its "Account not found." is not taken for an account that does not exist (${s.error})`);
    h.done();
  }

  // ── Each match against the ones before it ────────────────────────────────
  {
    const past = (at, acs) => ({ at, agent: 'Jett', role: 'Duelist', map: 'Bind', result: 'Victory', acs, adr: 150,
      kd: 1, headshotPct: 20 });
    const history = [past(T0 - 3 * HOUR, 300), past(T0 - 2 * HOUR, 300), past(T0 - 1 * HOUR, 300),
      past(T0 + 50 * HOUR, 100), past(T0 + 51 * HOUR, 100)];
    const h = harness({ rows: [row('b', 2), row('a', 1)], history });
    const s = await h.run();
    const acsOf = (id) => ((h.store.get(s.items.find((x) => x.matchId === id).id).review.against || [])
      .find((x) => x.label === 'ACS') || {});
    const a = acsOf('a');
    const b = acsOf('b');
    ok(a.baseline === 300 && a.games === 3,
      `the oldest is measured against the three matches before it, never the two after (${a.baseline}, ${a.games})`);
    ok(b.baseline === 321 && b.games === 4,
      `the next against those and the one graded just before it, (900 + 382) / 4 (${b.baseline}, ${b.games})`);
    ok(h.history.length === 7 && h.history.every((x, i, all) => !i || all[i - 1].at <= x.at),
      'and the baseline keeps every row, in time order');
    h.done();
  }

  // ── A recording saved before 8.0.3, with no ledger ───────────────────────
  {
    const h = harness({ rows: [row('a', 1)] });
    const w = watched(h.store, T0 + 1 * HOUR - 60000);
    const old = JSON.parse(JSON.stringify(w));
    delete old.ledger;
    delete old.source;
    for (const c of old.rounds) {
      delete c.sideKey; delete c.spot; delete c.ultReady; delete c.riot; delete c.verified; delete c.watched;
    }
    h.store.save({ id: old.id, game: 'valorant', at: old.at, review: old });
    const s = await h.run();
    const up = h.store.get(w.id).review;
    ok(s.upgraded === 1 && h.store.list('valorant').length === 1 && up.verified && up.matchId === 'a'
      && up.rounds.filter((c) => c.died).length === 21,
      'a recording saved before the ledger existed is placed by its map and rounds, and upgraded from its cards');
    h.done();
  }

  // ── Retries and failures ─────────────────────────────────────────────────
  {
    const h = harness({ rows: [row('a', 1)], answers: { a: [{ ok: false, status: 503, data: { error: 'Tracker rate limit, try again shortly.', retry: true } }] } });
    const s = await h.run();
    ok(s.graded === 1 && h.slept >= 30000 && h.rounds().length === 2, 'a rate limited record is asked for again after half a minute');
    h.done();
  }
  {
    const three = () => [0, 1, 2].map(() => ({ ok: false, status: 503, data: { retry: true } }));
    const h = harness({ rows: [row('d', 4), row('c', 3), row('b', 2), row('a', 1)], answers: { a: three(), b: three(), c: three() } });
    const s = await h.run();
    ok(s.state === 'error' && s.error === 'unreachable' && s.failed === 3 && !h.rounds().includes('d'),
      `three failed matches in a row end the run (${s.state}, ${s.failed} failed)`);
    ok(h.store.list('valorant').length === 0 && h.notices.length === 0, 'with nothing saved and no notice');
    h.done();
  }
  {
    const h = harness({ rows: [row('b', 2), row('a', 1)], answers: { a: [{ ok: true, status: 200, data: { error: 'That Riot ID is not in this match.' } }] } });
    const s = await h.run();
    ok(s.failed === 1 && s.graded === 1 && h.rounds().filter((x) => x === 'a').length === 1,
      'an answer that will not change is not asked again');
    h.done();
  }
  {
    // Answers that will not change say nothing about Riot being reachable, so
    // three of them in a row do not end the run as "could not be reached".
    const lasting = () => [{ ok: true, status: 200, data: { error: 'That Riot ID is not in this match.' } }];
    const h = harness({ rows: [row('d', 4), row('c', 3), row('b', 2), row('a', 1)], answers: { a: lasting(), b: lasting(), c: lasting() } });
    const s = await h.run();
    ok(s.state === 'done' && s.failed === 3 && s.graded === 1 && h.rounds().includes('d'),
      `three lasting refusals in a row do not stop the run (${s.state}, ${s.failed} failed, ${s.graded} graded)`);
    ok(/1 recent match/.test(s.message) && /3 matches could not be fetched/.test(s.message), `and the summary says both (${s.message})`);
    h.done();
  }
  {
    const lasting = () => [{ ok: true, status: 200, data: { error: 'That Riot ID is not in this match.' } }];
    const h = harness({ rows: [row('b', 2), row('a', 1)], answers: { a: lasting(), b: lasting() } });
    const s = await h.run();
    ok(s.state === 'done' && s.graded === 0 && /None of your recent matches could be fetched/.test(s.message)
      && !/nothing new/.test(s.message), `nothing fetched is not "nothing new" (${s.message})`);
    h.done();
  }
  {
    // A review that never reached the library is neither graded nor in the baseline.
    const h = harness({ rows: [row('b', 2), row('a', 1)], saveFails: (rv) => rv.matchId === 'a' });
    const s = await h.run();
    ok(s.failed === 1 && s.graded === 1 && s.items.find((x) => x.matchId === 'a').status === 'failed',
      'a save that fails is a failed match, and the run goes on');
    ok(h.history.length === 1 && h.history[0].matchId === 'b' && h.store.list('valorant').length === 1,
      'with no baseline row for the match that was not saved');
    h.done();
  }
  {
    const h = harness({ get: async (p) => (p.startsWith('/api/coach/recent-matches') ? { ok: true, status: 200, data: { error: 'Account not found.' } } : null) });
    const s = await h.run();
    ok(s.state === 'error' && s.error === 'not-found' && /name and the tag/.test(s.message), 'an unknown Riot ID says so');
    h.done();
  }
  {
    const h = harness({ get: async (p) => (p.startsWith('/api/coach/recent-matches') ? { ok: false, status: 401, data: { error: 'Invalid licence' } } : null) });
    const s = await h.run();
    ok(s.state === 'error' && s.error === 'licence', 'a refused licence says so');
    h.done();
  }
  {
    const h = harness({ rows: [] });
    const s = await h.run();
    ok(s.state === 'done' && s.found === 0 && /No recent/.test(s.message) && !h.notices.length,
      'no matches says so and leaves no notice');
    h.done();
  }

  // ── It waits while a match is being played ───────────────────────────────
  {
    let left = 3;
    const h = harness({ rows: [row('a', 1)], inMatch: () => left-- > 0 });
    const s = await h.run();
    ok(h.statuses.some((x) => x.state === 'waiting') && s.state === 'done' && s.graded === 1,
      'it waits while a match is played, then carries on');
    ok(h.calls[0].at >= T0 + 100 * HOUR + 10000, 'and asks for nothing until the match is over');
    h.done();
  }
  {
    // A match starts WHILE the round record is being fetched: the save waits
    // for it to end. Without the wait before the save this saves mid match.
    let matchOn = false;
    let waited = 0;
    let savedDuring = 0;
    const h = harness({ rows: [row('a', 1)], inMatch: () => matchOn,
      get: async (p) => { if (p.startsWith('/api/coach/match-rounds')) matchOn = true; return null; },
      onSleep: (ms) => { if (matchOn) { waited += ms; if (waited >= 15000) matchOn = false; } },
      onSave: () => { if (matchOn) savedDuring++; } });
    await h.run();
    ok(savedDuring === 0 && waited >= 15000 && h.store.list('valorant').length === 1,
      'and a match that starts while a record is fetched holds the save until it ends');
    h.done();
  }

  // ── One run at a time ────────────────────────────────────────────────────
  {
    const h = harness({ rows: [row('a', 1)] });
    h.bf.start('Me#EUW');
    const p = h.bf.promise;
    const again = h.bf.start('me#euw');
    ok(h.bf.promise === p && again.state === 'listing', 'the same account while it runs is the same run');
    await p;
    h.done();
  }
  {
    const h = harness({ rows: [row('b', 2), row('a', 1)] });
    h.bf.start('First#ONE');
    const first = h.bf.promise;
    h.bf.start('Second#TWO');
    const second = h.bf.promise;
    await Promise.all([first, second]);
    const who = h.calls.filter((c) => c.path.startsWith('/api/coach/match-rounds'))
      .map((c) => decodeURIComponent((/username=([^&]+)/.exec(c.path) || [])[1] || ''));
    const s = h.bf.getStatus();
    ok(s.account === 'Second#TWO' && s.state === 'done', 'a second account takes over');
    ok(who.length === 2 && who.every((x) => x === 'Second#TWO'), "and the first account's run stops before fetching a match");
    h.done();
  }
  {
    // Taken over while the first run waits out the gap before a round record.
    let taken = false;
    const h = harness({ rows: [row('b', 2), row('a', 1)], onSleep: (ms, hh) => {
      if (taken || ms !== GAP_MS) return;
      taken = true;
      hh.bf.start('Second#TWO');
    } });
    h.bf.start('First#ONE');
    const first = h.bf.promise;
    await first;
    await h.bf.promise;
    const who = h.calls.filter((c) => c.path.startsWith('/api/coach/match-rounds'))
      .map((c) => decodeURIComponent((/username=([^&]+)/.exec(c.path) || [])[1] || ''));
    const gaps = h.calls.slice(1).map((c, i) => c.at - h.calls[i].at);
    ok(taken && who.join() === 'Second#TWO,Second#TWO',
      `taken over while it waits for its turn, the first run does not ask for the record it was waiting on (${who.join()})`);
    ok(gaps.every((g) => g >= GAP_MS), `and the two runs never ask less than three seconds apart (${Math.min(...gaps)} ms)`);
    h.done();
  }
  {
    // Cancelled while it waits out the gap, with nothing started after it.
    let before = -1;
    const h = harness({ rows: [row('b', 2), row('a', 1)], onSleep: (ms, hh) => {
      if (before >= 0 || ms !== GAP_MS) return;
      before = hh.statuses.length;
      hh.bf.cancel();
    } });
    const s = await h.run();
    const last = h.statuses[h.statuses.length - 1] || {};
    ok(before >= 0 && !h.rounds().length && !h.store.list('valorant').length,
      'cancelled while it waits for its turn, it asks for nothing more and saves nothing');
    ok(!['listing', 'waiting', 'grading'].includes(s.state) && h.statuses.length > before && last.state === s.state,
      `and says at once that nothing is running, so no window follows a run that is over (${s.state})`);
    h.done();
  }
  {
    // Cancelled, and started again for the same account straight away.
    let again = null;
    const h = harness({ rows: [row('b', 2), row('a', 1)], onSleep: (ms, hh) => {
      if (again || ms !== GAP_MS) return;
      hh.bf.cancel();
      again = hh.bf.start('Me#EUW');
    } });
    h.bf.start('Me#EUW');
    const first = h.bf.promise;
    await first;
    await h.bf.promise;
    const s = h.bf.getStatus();
    ok(again && again.state === 'listing' && s.state === 'done' && s.graded === 2 && h.rounds().join() === 'a,b',
      `a start straight after a cancel is a new run, not the cancelled one (${again && again.state}, ${s.state}, ${h.rounds().join()})`);
    h.done();
  }

  // ── Libraries written by 8.0.0 and 8.0.1, which kept no matchId ─────────
  {
    const h = harness({ rows: [row('b', 2, { map: 'Bind' }), row('a', 1)] });
    // A recording 8.0.1 linked to Riot: verified, with no matchId, no ledger
    // and no source, and the screen's guess at the queue and the halftime.
    const snap = { ...played, startedAt: T0 + 1 * HOUR - 60000, endedAt: T0 + 1 * HOUR + 24 * 100000 + 60000,
      context: { ...played.context, map: 'Abyss', agent: 'Jett', agentConfirmed: true, teamScore: 13, enemyScore: 11 } };
    const { rounds: vr } = verify.reconcile(snap.rounds, RIOT);
    const old = valorantReview.build({ rounds: vr, context: snap.context, endedBy: 'score', ai: {}, role: 'Duelist',
      history: [], tracker: row('a', 1), riotMe: RIOT.me });
    delete old.source; delete old.matchId; delete old.ledger;
    old.game.mode = 'Standard';
    old.halftimeAfter = 4;
    old.id = newId('valorant', snap.endedAt);
    old.at = snap.endedAt;
    h.store.save({ id: old.id, game: 'valorant', at: old.at, review: old });
    h.history = [{ at: snap.endedAt + 120000, agent: 'Jett', role: 'Duelist', map: 'Abyss', result: 'Victory',
      acs: 382, adr: 243, kd: 1.48, headshotPct: 25 }];
    const s = await h.run();
    const list = h.store.list('valorant');
    ok(list.length === 2 && !h.rounds().includes('a'), `a match 8.0.1 linked is not fetched or graded again (${list.length} reviews)`);
    const stamped = h.store.get(old.id).review;
    ok(stamped.matchId === 'a' && list.find((m) => m.id === old.id).matchId === 'a',
      'its matchId is written into the review and its index row');
    ok(stamped.game.mode === 'Competitive' && stamped.halftimeAfter === 12,
      `with Riot's queue and halftime instead of the screen's guess (${stamped.game.mode}, ${stamped.halftimeAfter})`);
    ok(h.history.filter((x) => x.map === 'Abyss').length === 1, 'and no second baseline row for it');
    ok(s.have === 1 && s.graded === 1, `counted as already in the library (${s.have} have, ${s.graded} graded)`);
    h.done();
  }
  {
    // A recording 8.0.1 linked the scoreboard of but never the rounds: its
    // baseline row was written then, so the upgrade adds none.
    const h = harness({ rows: [row('a', 1)] });
    const w = watched(h.store, T0 + 1 * HOUR - 60000);
    const old = { ...h.store.get(w.id).review,
      scoreline: { kills: 31, deaths: 21, assists: 4, acs: 382, adr: 243, headshotPct: 25, kd: 1.48 } };
    delete old.ledger; delete old.source;
    h.store.save({ id: old.id, game: 'valorant', at: old.at, review: old });
    h.history = [{ at: old.at + 120000, agent: 'Jett', role: 'Duelist', map: 'Abyss', result: 'Victory',
      acs: 382, adr: 243, kd: 1.48, headshotPct: 25 }];
    const s = await h.run();
    ok(s.upgraded === 1 && h.store.list('valorant').length === 1, 'a scoreboard only 8.0.1 recording is upgraded in place');
    ok(h.history.length === 1, `without a second baseline row for the same match (${h.history.length})`);
    h.done();
  }

  // ── A recording claims the match it overlaps, and only that one ──────────
  {
    // A recording of a Spike Rush match. The Competitive match after it fits
    // the link's own looser rules (it started within ten minutes of the
    // recording's end), but it never overlapped the recording.
    const h = harness({ rows: [row('y', 1.75), row('x', 1, { mode: 'Spike Rush' })] });
    const w = watched(h.store, T0 + 1 * HOUR - 60000);
    const s = await h.run();
    const r = h.store.get(w.id).review;
    ok(!r.verified && r.matchId === 'x', `a recording is never handed the match after its own (${r.matchId})`);
    ok(r.game.mode === 'Spike Rush', 'its own Spike Rush match is named for what it was, so the breakdown leaves it out');
    ok(s.graded === 1 && h.rounds().join() === 'y', 'and the match after it is graded as a new one');
    h.done();
  }
  {
    // The same match, but the screen's map lock was wrong: the link's checks
    // fail, yet the recording overlaps it, so it is the same match. Grading
    // it as new would count it twice.
    const h = harness({ rows: [row('a', 1, { map: 'Bind' })] });
    watched(h.store, T0 + 1 * HOUR - 60000);
    const s = await h.run();
    ok(s.ambiguous === 1 && s.graded === 0 && s.upgraded === 0 && h.store.list('valorant').length === 1
      && !h.store.get(h.store.list('valorant')[0].id).review.verified,
      'a recording that overlaps a match it does not fit leaves that match alone');
    ok(/told apart from a recording/.test(s.message) && !/already in your library/.test(s.message),
      `and says so, not "already in your library" (${s.message})`);
    h.done();
  }
  {
    const h = harness({ rows: [row('a', 1)] });
    const w = watched(h.store, T0 + 1 * HOUR - 60000);
    h.active = new Set([w.id]);
    const s = await h.run();
    ok(/still being linked/.test(s.message), `a match its recording is linking is named as such (${s.message})`);
    h.done();
  }

  // ── Only the account in Settings ─────────────────────────────────────────
  {
    const h = harness({ rows: [row('a', 1)], account: () => 'Other#EUW' });
    const st = h.bf.start('Me#EUW');
    await h.bf.promise;
    ok(st.state === 'idle' && !h.calls.length, 'a start for a Riot ID that is not the one in Settings is refused');
    h.done();
  }
  {
    let acct = 'Me#EUW';
    const h = harness({ rows: [row('b', 2), row('a', 1)], account: () => acct,
      get: async (p) => { if (p.includes('matchId=a')) acct = 'Typo#EUW'; return null; } });
    const s = await h.run();
    ok(h.store.list('valorant').length === 0 && s.state === 'idle',
      `a Riot ID changed for good mid run stops it before its next save (${s.state})`);
    h.done();
  }
  {
    let acct = 'Me#EUW';
    let flips = 0;
    const h = harness({ rows: [row('a', 1)], account: () => acct,
      get: async (p) => { if (p.startsWith('/api/coach/match-rounds')) acct = 'Me#EU'; return null; },
      onSleep: () => { if (acct !== 'Me#EUW' && ++flips >= 2) acct = 'Me#EUW'; } });
    const s = await h.run();
    ok(s.state === 'done' && s.graded === 1, 'a field being retyped that comes back to the same ID does not stop it');
    h.done();
  }

  // ── Back to back matches, and links never checked ────────────────────────
  {
    /** A recording 8.0.1 linked to Riot: verified, no matchId, no ledger. */
    const legacy = (store, r) => {
      const snap = { ...played, startedAt: r.startedAt - 60000, endedAt: r.startedAt + 24 * 100000 + 60000,
        context: { ...played.context, map: r.map, agent: 'Jett', agentConfirmed: true, teamScore: 13, enemyScore: 11 } };
      const old = valorantReview.build({ rounds: verify.reconcile(snap.rounds, RIOT).rounds, context: snap.context,
        endedBy: 'score', ai: {}, role: 'Duelist', history: [], tracker: r, riotMe: RIOT.me });
      delete old.source; delete old.matchId; delete old.ledger;
      old.id = newId('valorant', snap.endedAt);
      old.at = snap.endedAt;
      store.save({ id: old.id, game: 'valorant', at: old.at, review: old });
      return old;
    };
    // The second match starts a minute after the first's estimated end. A
    // legacy window reaches back (watched rounds + 2) x 100 seconds and Riot's
    // end estimate runs long, so the two touch at the seam; any touch used to
    // be a claim, and each match was left alone as claimed by both.
    const first = row('a', 1);
    const second = row('b', 1 + (24 * 100000 + 60000) / HOUR);
    const h = harness({ rows: [second, first] });
    const ra = legacy(h.store, first);
    const rb = legacy(h.store, second);
    const s = await h.run();
    ok(h.store.get(ra.id).review.matchId === 'a' && h.store.get(rb.id).review.matchId === 'b' && s.ambiguous === 0,
      `back to back recordings each claim their own match, not each other's (${s.ambiguous} ambiguous)`);
    ok(h.store.list('valorant').length === 2 && !h.rounds().length, 'and both are stamped, nothing graded twice');
    h.done();

    const h2 = harness({ rows: [second, first] });
    const only = legacy(h2.store, second);
    const s2 = await h2.run();
    ok(h2.store.get(only.id).review.matchId === 'b' && s2.graded === 1 && h2.rounds().join() === 'a',
      'and a match nobody recorded beside a recorded one is graded, not left alone');
    h2.done();

    // Start pressed during the last seconds of a match nobody recorded (Riot's
    // estimate of its end runs past the press), and the next match recorded.
    const mine = row('m', 2);
    const before = { ...row('z', 2), startedAt: mine.startedAt - 2390000 };
    const h3 = harness({ rows: [mine, before] });
    const rec = watched(h3.store, mine.startedAt - 90000);
    const s3 = await h3.run();
    ok(h3.store.get(rec.id).review.matchId === 'm' && s3.upgraded === 1 && s3.graded === 1 && s3.ambiguous === 0,
      `a recording claims its own match and not the one it barely touched (${s3.upgraded} upgraded, ${s3.graded} graded, ${s3.ambiguous} ambiguous)`);
    h3.done();
  }
  {
    // Linked to the scoreboard, its round record never landed: checked now,
    // in place, with no second baseline row (the link wrote one).
    const h = harness({ rows: [row('a', 1)] });
    const w = watched(h.store, T0 + 1 * HOUR - 60000, { matchId: 'a',
      scoreline: { kills: 31, deaths: 21, assists: 4, acs: 382, adr: 243, headshotPct: 25, kd: 1.48 } });
    h.history = [{ at: w.at + 120000, agent: 'Jett', role: 'Duelist', map: 'Abyss', result: 'Victory',
      acs: 382, adr: 243, kd: 1.48, headshotPct: 25, matchId: 'a' }];
    const s = await h.run();
    const up = h.store.get(w.id).review;
    ok(s.upgraded === 1 && up.verified && up.matchId === 'a' && h.store.list('valorant').length === 1,
      'a link whose round record never landed is checked against Riot in place');
    ok(h.history.length === 1, `with no second baseline row (${h.history.length})`);
    h.done();
  }
  {
    // A match starts while the list is fetched: the stamp waits for it.
    let matchOn = false;
    let waited = 0;
    let savedDuring = 0;
    const h = harness({ rows: [row('a', 1)], inMatch: () => matchOn,
      get: async (p) => { if (p.startsWith('/api/coach/recent-matches')) matchOn = true; return null; },
      onSleep: (ms) => { if (matchOn) { waited += ms; if (waited >= 10000) matchOn = false; } },
      onSave: () => { if (matchOn) savedDuring++; } });
    const snap = { ...played, startedAt: T0 + 1 * HOUR - 60000, endedAt: T0 + 1 * HOUR + 24 * 100000 + 60000,
      context: { ...played.context, map: 'Abyss', agent: 'Jett', agentConfirmed: true, teamScore: 13, enemyScore: 11 } };
    const old = valorantReview.build({ rounds: verify.reconcile(snap.rounds, RIOT).rounds, context: snap.context,
      endedBy: 'score', ai: {}, role: 'Duelist', history: [], tracker: row('a', 1), riotMe: RIOT.me });
    delete old.source; delete old.matchId; delete old.ledger;
    old.id = newId('valorant', snap.endedAt);
    old.at = snap.endedAt;
    h.store.save({ id: old.id, game: 'valorant', at: old.at, review: old });
    await h.run();
    ok(savedDuring === 0 && waited >= 10000 && h.store.get(old.id).review.matchId === 'a',
      'a stamp waits out a match that started while the list was fetched');
    h.done();
  }

  // ── A run stopped for another Riot ID takes back what it filed ───────────
  {
    let acct = 'Typo#EUW';
    const h = harness({ rows: [row('b', 2), row('a', 1)], account: () => acct,
      get: async (p) => { if (p.includes('matchId=b')) acct = 'Me#EUW'; return null; } });
    const s = await h.run('Typo#EUW');
    ok(s.state === 'idle' && h.store.list('valorant').length === 0 && h.history.length === 0,
      `a typo corrected after its first match was filed leaves nothing of that account behind (${h.store.list('valorant').length} reviews)`);
    h.done();
  }
  {
    let acct = 'One#EUW';
    let took = false;
    const h = harness({ rows: [row('b', 2), row('a', 1)], account: () => acct,
      get: async (p, hh) => {
        if (!took && p.includes('matchId=b') && p.includes('One')) { took = true; acct = 'Two#EUW'; hh.bf.start('Two#EUW'); }
        return null;
      } });
    h.bf.start('One#EUW');
    const firstRun = h.bf.promise;
    await firstRun;
    await h.bf.promise;
    const accounts = h.store.list('valorant').map((m) => (h.store.get(m.id).review || {}).account);
    ok(!accounts.includes('One#EUW') && accounts.length === 2 && accounts.every((a) => a === 'Two#EUW'),
      `a run taken over by another account takes back what it filed (${accounts.join(', ')})`);
    h.done();
  }
  {
    // A run that finished keeps what it filed when the Riot ID changes later.
    let acct = 'Me#EUW';
    const h = harness({ rows: [row('a', 1)], account: () => acct });
    await h.run();
    acct = 'Alt#EUW';
    ok(h.store.list('valorant').length === 1, 'a finished run keeps its matches when the Riot ID changes after it');
    h.done();
  }
  {
    // The duo partner's ID typed by mistake. They played the same match, so
    // the player's own recording (agent never confirmed) fits it and is
    // checked against that player's record. Corrected mid run: the recording
    // goes back as it was, and the player's own baseline rows the partner's
    // match pushed out of the ten come back.
    let acct = 'Partner#EUW';
    const duo = row('duo', 1, { agent: 'Sova', kills: 12, deaths: 18, assists: 9, kd: 0.67, acs: 180 });
    const h = harness({ rows: [row('later', 2, { map: 'Bind', agent: 'Sova' }), duo], account: () => acct,
      get: async (p) => { if (p.includes('matchId=later')) acct = 'Me#EUW'; return null; } });
    const rec = watched(h.store, T0 + 1 * HOUR - 60000);
    const mine = h.store.get(rec.id).review;
    mine.ledger.context.agentConfirmed = false;
    h.store.save({ id: rec.id, game: 'valorant', at: rec.at, review: mine });
    const before = JSON.stringify(h.store.get(rec.id).review);
    h.history = Array.from({ length: 10 }, (_, i) => ({ at: T0 - (10 - i) * HOUR, agent: 'Jett', role: 'Duelist',
      map: 'Abyss', result: 'Victory', acs: 300 + i, adr: 200, kd: 1.2, headshotPct: 20, matchId: 'own' + i }));
    await h.run('Partner#EUW');
    const after = h.store.get(rec.id).review;
    ok(JSON.stringify(after) === before,
      `a recording checked against another account's record is put back as it was (${after.game.agent}, ${after.verified})`);
    ok(h.history.length === 10 && h.history.every((x) => /^own/.test(x.matchId)),
      `and the player's own ten baseline rows are all back (${h.history.map((x) => x.matchId).join()})`);
    ok(h.store.list('valorant').length === 1, "and nothing of the partner's is left");
    h.done();
  }
  {
    // Linked to the scoreboard by the live link from the player's own row,
    // its round record never landed. The partner's ID lists the same match
    // with the partner's line: checked against it, the recording would hold
    // that player's match for good, since the right ID then finds it checked.
    const h = harness({ rows: [row('duo', 1, { agent: 'Sova', kills: 12, deaths: 18, assists: 9 })] });
    const w = watched(h.store, T0 + 1 * HOUR - 60000, { matchId: 'duo',
      scoreline: { kills: 31, deaths: 21, assists: 4, acs: 382, adr: 243, headshotPct: 25, kd: 1.48 } });
    const s = await h.run('Partner#EUW');
    const r = h.store.get(w.id).review;
    ok(!r.verified && r.scoreline.kills === 31 && s.ambiguous === 1 && !h.rounds().length,
      `a link whose saved line is not the listed row's is left alone, not checked against it (${s.ambiguous} left alone)`);
    h.done();
    const h2 = harness({ rows: [row('duo', 1)] });
    const w2 = watched(h2.store, T0 + 1 * HOUR - 60000, { matchId: 'duo',
      scoreline: { kills: 31, deaths: 21, assists: 4, acs: 382, adr: 243, headshotPct: 25, kd: 1.48 } });
    await h2.run();
    ok(h2.store.get(w2.id).review.verified, 'and one whose line is the row\'s is checked in place');
    h2.done();
  }
  {
    // HenrikDev names the queue "Custom Game", where Riot's record says "custom".
    const h = harness({ rows: [row('cg', 1, { mode: 'Custom Game' })] });
    const w = watched(h.store, T0 + 1 * HOUR - 60000);
    await h.run();
    const r = h.store.get(w.id).review;
    ok(r.matchId === 'cg' && r.game.mode === 'Custom' && !h.rounds().length,
      `a recording of a custom game is named for it, so the breakdown leaves it out (${r.game.mode})`);
    h.done();
  }
  {
    // A full library: each new review pushes the oldest out, of any game. A
    // typo that is somebody's real account, corrected mid run, must leave the
    // player's own reviews as they were, frames and all.
    let acct = 'Typo#EUW';
    let h = null;
    h = harness({ rows: [row('c', 3), row('b', 2), row('a', 1)], account: () => acct,
      keeps: (at) => {
        const rows = h.store.list();
        return rows.length < MAX_REVIEWS || at > rows[rows.length - 1].at;
      },
      get: async (p) => { if (p.includes('matchId=c')) acct = 'Me#EUW'; return null; } });
    const jpeg = Buffer.from('a kept frame').toString('base64');
    for (let i = 0; i < MAX_REVIEWS; i++) {
      // The two oldest share one moment, so the take back must keep their order too.
      const at = T0 - Math.min(i + 1, MAX_REVIEWS - 1) * HOUR;
      const game = i % 2 ? 'lol' : 'rivals';
      const id = newId(game, at);
      h.store.save({ id, game, at, review: { kind: game, id, at, n: i },
        frames: i >= MAX_REVIEWS - 2 ? { 'death-1.jpg': jpeg } : undefined });
    }
    const before = h.store.list().map((m) => m.id);
    const oldest = before.slice(-2);
    await h.run('Typo#EUW');
    const after = h.store.list().map((m) => m.id);
    ok(after.join() === before.join(),
      `a take back in a full library puts back the reviews its saves pushed out (${after.length} of ${before.length})`);
    ok(oldest.every((id) => h.store.framesOf(id)['death-1.jpg'] === jpeg && h.store.get(id).review.n >= MAX_REVIEWS - 2),
      'whole, with their kept frames');
    h.done();
  }
  {
    // A full library whose oldest review is older than the two matches: the
    // first match's review becomes the oldest, and the second one's save
    // pushes it out. It was graded and then not kept, so it is counted old.
    let acct = 'Me#EUW';
    let h = null;
    h = harness({ rows: [row('b', 2), row('a', 1)], account: () => acct,
      keeps: (at) => {
        const rows = h.store.list();
        return rows.length < MAX_REVIEWS || at > rows[rows.length - 1].at;
      } });
    for (let i = 0; i < MAX_REVIEWS; i++) {
      const at = i === MAX_REVIEWS - 1 ? T0 - HOUR : T0 + (10 + i) * HOUR;
      const id = newId('lol', at);
      h.store.save({ id, game: 'lol', at, review: { kind: 'lol', id, at, n: i } });
    }
    const s = await h.run();
    const ids = h.store.list('valorant').map((m) => m.matchId);
    ok(s.graded === 1 && s.old === 1 && ids.join() === 'b'
      && s.items.find((x) => x.matchId === 'a').status === 'old',
      `a review its own run's next save pushes out is counted old, not graded (${s.graded} graded, ${s.old} old, kept ${ids.join()})`);
    h.done();
    // The same, with the Riot ID corrected after: the take back puts back the
    // player's review that went, never the stranger's that went after it.
    acct = 'Typo#EUW';
    let h2 = null;
    h2 = harness({ rows: [row('c', 3), row('b', 2), row('a', 1)], account: () => acct,
      keeps: (at) => {
        const rows = h2.store.list();
        return rows.length < MAX_REVIEWS || at > rows[rows.length - 1].at;
      },
      get: async (p) => { if (p.includes('matchId=c')) acct = 'Me#EUW'; return null; } });
    for (let i = 0; i < MAX_REVIEWS; i++) {
      const at = i === MAX_REVIEWS - 1 ? T0 - HOUR : T0 + (10 + i) * HOUR;
      const id = newId('lol', at);
      h2.store.save({ id, game: 'lol', at, review: { kind: 'lol', id, at, n: i } });
    }
    const before = h2.store.list().map((m) => m.id).join();
    await h2.run('Typo#EUW');
    ok(h2.store.list().map((m) => m.id).join() === before && !h2.store.list('valorant').length,
      'and a take back after it leaves the library exactly as it was');
    h2.done();
  }

  // ── Riot's own start and length decide, on real pacing ──────────────────
  // The fixtures measure 83 to 103 seconds a round. Riot's start may be the
  // load or agent select, the PC clock may be two minutes off, and a recording
  // opens when Start is pressed or the match before ended. Each timeline runs
  // through the whole Backfill, against a server that answers each match's
  // real start and length, and is judged by what the library holds after:
  // which review holds each match, and whether it is the recording made of it.
  {
    const L = 45000;
    const AS = 90000;
    const DELTA = 20000;
    const MIN = 60000;
    const matchOf = (start, rounds, d, agentSel) => {
      const firstBuy = start + (agentSel ? AS : 0) + L;
      return { start, firstBuy, end: firstBuy + rounds * d * 1000 };
    };
    let made = [];
    /** A recording with a ledger, from `from` to `to`, of match `of` (or of none listed). */
    const recorded = (store, from, to, { score = '13-11', map = 'Abyss', of = null, rounds, endedBy = 'score' } = {}) => {
      const [team, enemy] = score.split('-').map(Number);
      const snap = { ...played, rounds: rounds || played.rounds, startedAt: from, endedAt: to, endedBy,
        context: { ...played.context, map, agent: 'Jett', agentConfirmed: true, teamScore: team, enemyScore: enemy } };
      const built = valorantReview.build({ rounds: snap.rounds, context: snap.context, endedBy, ai: {},
        role: 'Duelist', history: [] });
      built.ledger = valorantReview.ledgerOf(snap);
      built.id = newId('valorant', to);
      built.at = to;
      store.save({ id: built.id, game: 'valorant', at: built.at, review: built });
      made.push({ id: built.id, of });
    };
    const wrong = [];
    let runs = 0;
    const judge = async (name, rows, lengths, make, want) => {
      runs++;
      made = [];
      const h = harness({ rows, get: async (p) => {
        if (!p.startsWith('/api/coach/match-rounds')) return null;
        const r = rows.find((x) => x.matchId === idOf(p));
        return r ? { ok: true, status: 200, data: { ...riotFor(r), startedAt: r.startedAt, lengthMs: lengths[r.matchId] } } : null;
      } });
      make(h.store);
      await h.run();
      const lib = h.store.list('valorant').map((m) => h.store.get(m.id).review);
      const outcome = (id) => {
        const held = lib.filter((r) => r.matchId === id);
        if (held.length > 1) return 'twice';
        if (!held.length) return made.some((m) => m.of === id) ? 'left' : 'missing';
        if (held[0].source === 'riot') return 'new';
        return made.some((m) => m.id === held[0].id && m.of === id) ? 'upgraded' : 'given another recording';
      };
      // A recording left unlinked beside a review from Riot's record of its own match.
      const twice = made.some((m) => m.of && lib.some((r) => r.id === m.id && !r.matchId)
        && lib.some((x) => x.source === 'riot' && x.matchId === m.of));
      const got = Object.keys(want).map((id) => `${id}=${outcome(id)}`).join(' ');
      if (twice || Object.entries(want).some(([id, w]) => !w.split('|').includes(outcome(id)))) {
        wrong.push(`${name}: ${got}${twice ? ', filed twice' : ''}`);
      }
      h.done();
    };
    for (const agentSel of [false, true]) {
      for (const d of [83, 93, 103]) {
        for (const skew of [-120, -60, 0, 60, 120]) {
          const k = skew * 1000;
          // A stub of two minutes on a clock two minutes off cannot be told
          // from the match before it: both are left alone then, never filed
          // twice and never given the stub.
          const far = Math.abs(skew) >= 120;
          const tag = `Riot's start at ${agentSel ? 'agent select' : 'the load'}, ${d} s a round, clock ${skew} s`;
          const pre = agentSel ? 0 : AS;
          const gap = 40000 + (agentSel ? 0 : AS);
          const A = matchOf(T0 + HOUR, 24, d, agentSel);
          const B = matchOf(A.end + gap, 24, d, agentSel);
          const len = { a: A.end - A.start, b: B.end - B.start };
          for (const mapA of ['Bind', 'Abyss']) {
            const rA = { ...row('a', 0, { map: mapA }), startedAt: A.start };
            const rB = { ...row('b', 0), startedAt: B.start };
            const t = `${tag}, the first on ${mapA}`;
            await judge(`${t}, both recorded`, [rB, rA], len, (st) => {
              recorded(st, A.start - pre + k, A.end + DELTA + k, { map: mapA, of: 'a' });
              recorded(st, B.firstBuy + k, B.end + DELTA + k, { of: 'b' });
            }, { a: 'upgraded', b: 'upgraded' });
            await judge(`${t}, only the second, from its agent select`, [rB, rA], len, (st) => {
              recorded(st, B.start - pre + k, B.end + DELTA + k, { of: 'b' });
            }, { a: 'new', b: 'upgraded' });
            await judge(`${t}, a stop two minutes into the second, then the rest`, [rB, rA], len, (st) => {
              recorded(st, B.start - pre + k, B.firstBuy + 2 * MIN + k, { score: '1-0', of: 'b', endedBy: 'stop' });
              recorded(st, B.firstBuy + 150000 + k, B.end + DELTA + k, { of: 'b' });
            }, { a: far ? 'new|missing' : 'new', b: 'left|upgraded' });
            await judge(`${t}, only a stop two minutes into the second`, [rB, rA], len, (st) => {
              recorded(st, B.start - pre + k, B.firstBuy + 2 * MIN + k, { score: '1-0', of: 'b', endedBy: 'stop' });
            }, { a: far ? 'new|missing' : 'new', b: far ? 'upgraded|left' : 'upgraded' });
          }
          const rA = { ...row('a', 0, { map: 'Bind' }), startedAt: A.start };
          // Start pressed before the match, and only its last five rounds
          // read (the capture was blocked until then).
          await judge(`${tag}, only the last five rounds read`, [rA], len,
            (st) => recorded(st, A.start - pre + k, A.end + DELTA + k,
              { map: 'Bind', of: 'a', rounds: played.rounds.slice(19) }),
            { a: 'upgraded' });
          const S = matchOf(T0 + HOUR, 8, d, agentSel);
          const B2 = matchOf(S.end + gap, 24, d, agentSel);
          const rS = { ...row('s', 0, { map: 'Bind', mode: 'Swiftplay', score: '5-3' }), startedAt: S.start };
          const rB2 = { ...row('b', 0), startedAt: B2.start };
          await judge(`${tag}, a swiftplay then a recorded match`, [rB2, rS], { s: S.end - S.start, b: B2.end - B2.start },
            (st) => recorded(st, B2.start - pre + k, B2.end + DELTA + k, { of: 'b' }),
            { s: 'new', b: 'upgraded' });
          for (const from of [22, 23]) {
            await judge(`${tag}, recorded from round ${from + 1} of 24`, [rA], len,
              (st) => recorded(st, A.firstBuy + from * d * 1000 + k, A.end + DELTA + k, { map: 'Bind', of: 'a' }),
              { a: 'upgraded|left' });
          }
          for (const g of [2, 6]) {
            const xs = A.end + g * MIN;
            await judge(`${tag}, a match the account never played ${g} min after the newest`, [rA], len,
              (st) => recorded(st, xs + k, xs + 35 * MIN + k, { score: '13-9', map: 'Lotus' }), { a: 'new' });
            await judge(`${tag}, a stop in one ${g} min after the newest`, [rA], len,
              (st) => recorded(st, xs + k, xs + 4 * MIN + k, { score: '1-1', map: 'Lotus', endedBy: 'stop' }), { a: 'new' });
          }
          const C = matchOf(A.end + HOUR, 24, d, agentSel);
          const rC = { ...row('c', 0), startedAt: C.start };
          const lenC = { a: A.end - A.start, c: C.end - C.start };
          await judge(`${tag}, the app left running an hour between matches`, [rC, rA], lenC, (st) => {
            recorded(st, A.start - pre + k, A.end + DELTA + k, { map: 'Bind', of: 'a' });
            recorded(st, A.end + DELTA + k, C.end + DELTA + k, { of: 'c' });
          }, { a: 'upgraded', c: 'upgraded' });
        }
      }
    }
    ok(!wrong.length, `${runs} timelines on real pacing, none filed twice or given another match's recording`
      + (wrong.length ? `: ${wrong.length} wrong, ${wrong.slice(0, 4).join(' | ')}` : ''));
  }

  // ── The plan alone, where nothing is fetched to correct it ──────────────
  // A stamp and a match a recording is still linking are decided on Riot's
  // estimate, 100 seconds a round, with no round record to set it right, so
  // the plan must place a recording in its own match on real pacing itself.
  {
    const libraryOf = (h) => h.store.list('valorant').map((meta) => ({ meta, review: h.store.get(meta.id).review }));
    /** A recording 8.0.1 linked: verified, no matchId, no ledger, ending at `endedAt`. */
    const legacyAt = (store, r, endedAt) => {
      const snap = { ...played, startedAt: endedAt - 2400000, endedAt,
        context: { ...played.context, map: r.map, agent: 'Jett', agentConfirmed: true, teamScore: 13, enemyScore: 11 } };
      const old = valorantReview.build({ rounds: verify.reconcile(snap.rounds, RIOT).rounds, context: snap.context,
        endedBy: 'score', ai: {}, role: 'Duelist', history: [], tracker: r, riotMe: RIOT.me });
      delete old.source; delete old.matchId; delete old.ledger;
      old.id = newId('valorant', endedAt);
      old.at = endedAt;
      store.save({ id: old.id, game: 'valorant', at: old.at, review: old });
      return old;
    };
    /** A recording with a ledger, never linked, from `from` to `to`. */
    const ledgerAt = (store, from, to, score, endedBy) => {
      const [team, enemy] = score.split('-').map(Number);
      const snap = { ...played, startedAt: from, endedAt: to, endedBy,
        context: { ...played.context, map: 'Abyss', agent: 'Jett', agentConfirmed: true, teamScore: team, enemyScore: enemy } };
      const built = valorantReview.build({ rounds: snap.rounds, context: snap.context, endedBy, ai: {},
        role: 'Duelist', history: [] });
      built.ledger = valorantReview.ledgerOf(snap);
      built.id = newId('valorant', to);
      built.at = to;
      store.save({ id: built.id, game: 'valorant', at: built.at, review: built });
      return built;
    };
    const wrong = [];
    let cases = 0;
    const expect = (what, got, ...allowed) => {
      cases++;
      if (!allowed.includes(got)) wrong.push(`${what}: ${got}`);
    };
    for (const d of [83, 88, 93, 98, 103]) {
      for (const q of [0, 30, 60, 90, 120, 180]) {
        for (const skew of [-120, -60, 0, 60, 120]) {
          const k = skew * 1000;
          const tag = `${d} s a round, ${q} s queue, clock ${skew} s`;
          // Riot's start at the load; a queue of q seconds and agent select between.
          const aStart = T0 + HOUR;
          const aEnd = aStart + (45 + 24 * d) * 1000;
          const bStart = aEnd + (10 + q + 90) * 1000;
          const bEnd = bStart + (45 + 24 * d) * 1000;
          const A = { ...row('a', 0, { map: 'Bind' }), startedAt: aStart };
          const B = { ...row('b', 0), startedAt: bStart };
          const h = harness({ rows: [B, A] });
          legacyAt(h.store, A, aEnd + 20000 + k);
          legacyAt(h.store, B, bEnd + 20000 + k);
          expect(`${tag}, both 8.0.1 linked`, plan([B, A], libraryOf(h), new Set()).map((s) => s.action).join(), 'stamp,stamp');
          h.done();
          const h2 = harness({ rows: [B, A] });
          legacyAt(h2.store, B, bEnd + 20000 + k);
          expect(`${tag}, only the second`, plan([B, A], libraryOf(h2), new Set()).map((s) => s.action).join(), 'stamp,new');
          h2.done();
          // Recordings still linking: the one from the second's agent select,
          // and a stop two minutes into it, which lies too near the seam to be
          // told from the match before, so its link is left to decide both.
          const h3 = harness({ rows: [B, A] });
          const full = ledgerAt(h3.store, bStart - 90000 + k, bEnd + 20000 + k, '13-11', 'score');
          expect(`${tag}, the second still linking`, plan([B, A], libraryOf(h3), new Set([full.id])).map((s) => s.action).join(),
            'pending,new');
          h3.done();
          const h4 = harness({ rows: [B, A] });
          const stub = ledgerAt(h4.store, bStart - 90000 + k, bStart + 45000 + 120000 + k, '1-0', 'stop');
          const stubbed = plan([B, A], libraryOf(h4), new Set([stub.id])).map((s) => s.action).join();
          expect(`${tag}, a stop stub still linking`, stubbed, 'pending,new', 'pending,pending');
          h4.done();
        }
      }
    }
    ok(!wrong.length, `on real pacing the plan places each recording in its own match, not the one before (${cases} cases`
      + (wrong.length ? `, ${wrong.length} wrong: ${wrong.slice(0, 3).join(' | ')}` : '') + ')');
  }

  // ── Server errors, and the library's cap ─────────────────────────────────
  {
    // Riot answered in between, a match left alone, so three failures were
    // not in a row, and the match after them is still graded.
    const down = () => Array.from({ length: 3 }, () => ({ ok: false, status: 503, data: null }));
    const h = harness({ rows: [row('e', 5), row('d', 4), row('c', 3), row('b', 2), row('a', 1)],
      answers: { a: down(), b: down(), d: down() } });
    watched(h.store, T0 + 3 * HOUR - 60000);
    watched(h.store, T0 + 3 * HOUR - 30000);
    const s = await h.run();
    ok(s.state === 'done' && h.rounds().includes('e') && s.graded === 1 && s.failed === 3,
      `a match Riot answered breaks a run of failures (${s.state}, asked ${[...new Set(h.rounds())].join()})`);
    h.done();
  }
  {
    // An answer that will not change is Riot answering too.
    const down = () => Array.from({ length: 3 }, () => ({ ok: false, status: 503, data: null }));
    const h = harness({ rows: [row('e', 5), row('d', 4), row('c', 3), row('b', 2), row('a', 1)],
      answers: { a: down(), b: down(), c: [{ ok: true, status: 200, data: { error: 'That Riot ID is not in this match.' } }],
        d: down() } });
    const s = await h.run();
    ok(s.state === 'done' && h.rounds().includes('e') && s.graded === 1 && s.failed === 4,
      `so does one it refused for good (${s.state}, asked ${[...new Set(h.rounds())].join()})`);
    h.done();
  }
  {
    // A baseline write that throws after the review is saved: the run goes on,
    // the review is counted, and a take back would still find it.
    let threw = false;
    const h = harness({ rows: [row('b', 2), row('a', 1)],
      historyFails: () => { if (threw) return false; threw = true; return true; } });
    const s = await h.run();
    ok(s.state === 'done' && s.graded === 2 && h.store.list('valorant').length === 2 && threw,
      `a baseline write that fails does not end the run or lose the count (${s.state}, ${s.graded} graded)`);
    h.done();
  }
  {
    const line = summary({ graded: 0, upgraded: 0, have: 0, pending: 0, ambiguous: 0, failed: 0, old: 1 }, false);
    ok(!/nothing new/.test(line) && /older than anything/.test(line),
      `a match graded and too old to keep is not "nothing new" (${line})`);
  }
  {
    const h = harness({ rows: [row('a', 1)], answers: { a: [{ ok: false, status: 502, data: null }] } });
    const s = await h.run();
    ok(s.graded === 1 && h.rounds().length === 2, 'a 502 while the server restarts is asked again, like a 503');
    h.done();
  }
  {
    const h = harness({ rows: [row('b', 2), row('a', 1)], keeps: (at) => at > T0 + 2 * HOUR });
    const s = await h.run();
    ok(s.old === 1 && s.graded === 1 && s.items.find((x) => x.matchId === 'a').status === 'old'
      && /older than anything your library keeps/.test(s.message) && h.history.length === 1,
      `a match older than the full library keeps is not saved, and says so (${s.message})`);
    h.done();
  }

  console.log(`\n${fails ? fails + ' of ' + checks + ' failed' : 'all ' + checks + ' backfill checks passed'}`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log('FAIL  the test crashed:', e.stack || e.message); process.exit(1); });

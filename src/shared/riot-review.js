'use strict';

/**
 * Reviews built from Riot's record of a match, for the matches Connect grades
 * after the fact (src/main/services/backfill.js).
 *
 * TWO KINDS, AND THEY CLAIM DIFFERENT THINGS.
 *
 *   fromRiot        a match the coach never watched. Every round is Riot's, so
 *                   the review has deaths, killers, trades, clutches and plants,
 *                   and nothing only the screen could have: no death location,
 *                   no ultimate read, no look at a death. It says so. And it
 *                   states facts: Riot records what happened and never why, so
 *                   its counts are one neutral list, never a mistake with a fix
 *                   (insights.asFacts), and none of it is counted across matches.
 *   upgradeWatched  a match the coach DID watch, saved before it could link (no
 *                   Riot ID yet, or the link gave up). The same reconcile the
 *                   end of a match runs, over the ledger the review kept, so it
 *                   keeps its locations, reads and the coach's looks where
 *                   Riot agrees.
 *
 * NO MODEL IS CALLED. A summary written now would have no frames behind it,
 * and an old one was written from facts Riot has just corrected, so it is
 * taken down rather than left contradicting the numbers under it.
 *
 * Pure, no Electron: test-riot-review.js runs both on the real Abyss record.
 */

const verify = require('./valorant-verify');
const valorantReview = require('./valorant-review');
const { roleOf } = require('./agent-roles');

// Roughly how long a round takes with its buy phase, as match-link.js counts it.
const ROUND_MS = 100 * 1000;

const SCORE_RE = /^\s*(\d+)\s*-\s*(\d+)\s*$/;

function scoreOf(score) {
  const m = SCORE_RE.exec(String(score || ''));
  return m ? { team: Number(m[1]), enemy: Number(m[2]) } : { team: null, enemy: null };
}

function roundsIn(score) {
  const s = scoreOf(score);
  return s.team === null ? 0 : s.team + s.enemy;
}

/** When the match started: Riot's round record first, then the listed row. */
function startOf(row, riot) {
  if (riot && typeof riot.startedAt === 'number' && riot.startedAt > 0) return riot.startedAt;
  return (row && typeof row.startedAt === 'number' && row.startedAt > 0) ? row.startedAt : null;
}

/** When the match ended: Riot's length when it has one, else 100 seconds a round. */
function endOf(row, riot) {
  const start = startOf(row, riot);
  if (!start) return null;
  const len = riot && typeof riot.lengthMs === 'number' && riot.lengthMs > 0
    ? riot.lengthMs
    : roundsIn((riot && riot.score) || (row && row.score)) * ROUND_MS;
  return start + len;
}

/**
 * The history from before a match, oldest first. A match measured against a
 * baseline holding itself, or matches played after it, is compared with a
 * future it could not have known.
 */
function historyBefore(history, startedAt) {
  return (Array.isArray(history) ? history : [])
    .filter((h) => h && typeof h.at === 'number' && (!startedAt || h.at < startedAt))
    .sort((a, b) => a.at - b.at);
}

/** The listed row as build() reads a tracker match, Riot's round record winning where both speak. */
function trackerOf(row, riot) {
  const r = row || {};
  const me = (riot && riot.me) || {};
  return {
    matchId: r.matchId || (riot && riot.matchId) || null,
    map: (riot && riot.map) || r.map || null,
    agent: me.agent || r.agent || null,
    mode: r.mode || (riot && riot.queue) || null,
    result: (riot && riot.result) || r.result || null,
    score: (riot && riot.score) || r.score || null,
    kills: r.kills, deaths: r.deaths, assists: r.assists,
    kd: r.kd, acs: r.acs, adr: r.adr, headshotPct: r.headshotPct,
    startedAt: startOf(r, riot),
  };
}

/**
 * A review of a match the coach never watched, from Riot's record alone.
 *
 * @param row      a /recent-matches row: matchId, map, agent, mode, result, score,
 *                 kills, deaths, assists, kd, acs, adr, headshotPct, startedAt
 * @param riot     the /match-rounds reply for that match
 * @param history  valorantHistory rows; only the ones from before this match count
 * @param account  the Riot ID it was looked up under
 * @returns { review, role, tracker }, the review without an id
 */
function fromRiot({ row, riot, history, account }) {
  const { rounds } = verify.reconcile([], riot);
  const tracker = trackerOf(row, riot);
  const { team, enemy } = scoreOf(tracker.score);
  const role = roleOf(tracker.agent);
  const review = valorantReview.build({
    rounds,
    context: { agent: tracker.agent, map: tracker.map, teamScore: team, enemyScore: enemy },
    endedBy: 'score',
    ai: {},
    tracker,
    role,
    history: historyBefore(history, tracker.startedAt),
    riotMe: (riot && riot.me) || null,
    queue: (riot && riot.queue) || (row && row.mode) || null,
    riotIdSet: true,
    source: 'riot',
  });
  Object.assign(review, {
    account: account || null,
    matchId: tracker.matchId,
    matchStartedAt: tracker.startedAt,
    at: endOf(row, riot) || Date.now(),
    aiUnavailable: false,
    narrativePending: false,
    thin: false,
    stoppedLive: false,
  });
  return { review, role, tracker };
}

const SPOT_RE = /^Died at ([^,]+)/;
const PLANT_RE = /^Spike planted at (.+)$/;

function firstMatch(facts, re) {
  for (const f of facts) {
    const m = re.exec(String(f));
    if (m) return m[1].trim();
  }
  return null;
}

/**
 * The screen's rounds of a saved review, as reconcile() reads them. From the
 * ledger a review saved since 8.0.3 keeps; for an older one, rebuilt from its
 * cards, which hold less: no death clock, no location trail, and reads that
 * cannot say whether they were about a death (`legacy`). The fact sentences
 * the cards carry are written by roundFacts() from fixed strings, so the
 * locations read back exactly.
 */
function ledgerRows(review) {
  const r = review || {};
  if (r.ledger && Array.isArray(r.ledger.rounds)) {
    return {
      legacy: false,
      rows: r.ledger.rounds.map((x) => ({
        ...x,
        locs: Array.isArray(x.locs) ? x.locs.slice() : [],
        reads: (Array.isArray(x.reads) ? x.reads : []).map((y) => ({ text: String(y.text || ''), death: !!y.death })),
      })),
    };
  }
  const cards = Array.isArray(r.rounds) ? r.rounds : [];
  return {
    legacy: true,
    rows: cards.map((c) => {
      const facts = Array.isArray(c.facts) ? c.facts : [];
      return {
        n: c.n,
        side: c.sideKey || (c.side === 'Attack' ? 'attacking' : c.side === 'Defence' ? 'defending' : null),
        result: c.result || null,
        died: !!c.died,
        deathSpot: c.died ? (c.spot || firstMatch(facts, SPOT_RE)) : null,
        deathClock: null,
        early: !!c.early,
        ultAtDeath: c.died && (c.ultReady || facts.includes('Ultimate was ready')) ? 'ready' : null,
        ultSeen: null,
        planted: !!c.planted,
        plantSpot: c.planted ? firstMatch(facts, PLANT_RE) : null,
        locs: [],
        frames: 0,
        reads: (Array.isArray(c.reads) ? c.reads : []).map((t) => ({ text: String(t), death: false })),
      };
    }),
  };
}

/**
 * A watched review that never linked, checked against Riot's record now, by
 * the same reconcile the end of a match runs. Its summary, focus and round
 * lines are dropped, because they were written from the facts Riot has just
 * corrected. It keeps its id and its place in the library.
 *
 * @param saved  { id, at, review } as the library holds it
 * @returns { review, role, tracker }
 */
function upgradeWatched({ saved, row, riot, history, account }) {
  const old = (saved && saved.review) || {};
  const { rows, legacy } = ledgerRows(old);
  const { rounds, checks } = verify.reconcile(rows, riot);
  // A read rebuilt from a card cannot say it was about a death, so the rule
  // reconcile() applies to death reads is applied to the whole round: where
  // Riot and the screen disagree about the death, what the coach said there
  // was said about a moment that did not happen. Counted with the reads
  // reconcile() dropped, because the verification line says how many Riot
  // contradicts, and on the real Abyss match it said 4 while hiding 7.
  if (legacy && checks) {
    for (const r of rounds) {
      if (r.watched && r.screenDied !== r.died && r.reads.length) {
        checks.readsDropped += r.reads.length;
        r.reads = [];
      }
    }
  }
  // THE COACH'S LOOKS FROM THE SCREEN (8.2) STAY where Riot confirms the death
  // the screen filed. A recording Riot's record never reached was looked at
  // from the screen (screenLook in index.js), and its looks are on its cards,
  // never in its ledger, so they are read back from the cards, which covers
  // every review 8.2 has already saved. Rebuilt by reconcile() alone, every
  // card came back without one: the "Where you died, and how" section went,
  // its causes left every pattern, and its frames stayed on disk with no card
  // pointing at them. Nothing here can look again, since no model is called
  // and the AI log has often rolled past the match. A look at a death Riot
  // says never happened (the real Abyss round 17) was a look at a moment that
  // did not happen, and goes, as the screen's death spot does.
  const looks = new Map((Array.isArray(old.rounds) ? old.rounds : [])
    .filter((c) => c && c.forensics && c.forensics.cause).map((c) => [c.n, c.forensics]));
  for (const r of rounds) if (r.died && r.screenDied && looks.has(r.n)) r.forensics = looks.get(r.n);
  const lc = (old.ledger && old.ledger.context) || {};
  const g = old.game || {};
  const tracker = trackerOf(row, riot);
  const s = scoreOf(g.score);
  const context = {
    agent: tracker.agent || lc.agent || g.agent || null,
    agentConfirmed: true,
    map: lc.map || g.map || tracker.map || null,
    teamScore: typeof lc.teamScore === 'number' ? lc.teamScore : s.team,
    enemyScore: typeof lc.enemyScore === 'number' ? lc.enemyScore : s.enemy,
    gameMode: lc.gameMode || null,
  };
  const role = roleOf(context.agent);
  const review = valorantReview.build({
    rounds,
    context,
    endedBy: (old.ledger && old.ledger.endedBy) || old.endedBy || 'stop',
    ai: { summary: null, rounds: {}, focus: null, study: Array.isArray(old.study) ? old.study : [] },
    tracker,
    role,
    history: historyBefore(history, tracker.startedAt),
    verification: verify.describe(checks),
    riotMe: (riot && riot.me) || null,
    queue: (riot && riot.queue) || (row && row.mode) || null,
    riotIdSet: true,
  });
  if (old.summary || old.focus) {
    review.refused.push("The coach's written read of this match was taken down. It was written before Riot's "
      + 'record linked, and Riot corrected the facts it was written from.');
  }
  Object.assign(review, {
    id: saved.id,
    at: saved.at,
    matchId: tracker.matchId,
    matchStartedAt: tracker.startedAt,
    account: account || null,
    stoppedLive: !!old.stoppedLive,
    lateLinked: true,
    aiUnavailable: false,
    narrativePending: false,
    thin: false,
  });
  // Where the recording's frames are in the AI log, as the review it upgrades
  // kept it (8.2), so the eye on its row still opens them. One saved before
  // 8.2 kept none and is looked up by its end, so none is made up for it here.
  if (old.aiLog !== undefined) review.aiLog = old.aiLog;
  return { review, role, tracker };
}

module.exports = { fromRiot, upgradeWatched, ledgerRows, historyBefore, trackerOf, startOf, endOf, roleOf, ROUND_MS };

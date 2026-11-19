'use strict';

/**
 * FURTHER EXPLAIN (8.13): the coach goes deeper on one death of a saved review,
 * when the player asks and, for a death they flagged, by itself.
 *
 * ONE ANSWER A DEATH, saved on the review (`deathExplains`, by round, so a
 * rebuilt card keeps it): asked once and paid for once. It is sent the best of
 * what is still kept: the look's stills beside the review, else the frames the
 * AI log holds around the death (its last five sessions), else Riot's facts
 * alone, and the server is told which, so an answer with no picture claims
 * nothing it could have seen. Never while a match is being played.
 *
 * Plain Node: everything it touches is handed in (test:deathexplain).
 */

const { satOutCard } = require('../../shared/valorant-review');

const MAX_FRAMES = 5;
const TEXT_MAX = 700;

const text = (v) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, TEXT_MAX) : null);

/** The server's answer as a review keeps it, or null. */
function answerOf(data, at) {
  const a = data && data.explain;
  if (!a) return null;
  const out = { happened: text(a.happened), why: text(a.why), instead: text(a.instead) };
  if (!out.happened && !out.why && !out.instead) return null;
  return { ...out, from: ['recording', 'reads', 'facts'].includes(data.from) ? data.from : 'facts', at };
}

/** What is known of the death, without its pictures. */
function factsOf(card) {
  const r = card.riot || {};
  return {
    n: card.n, side: card.sideKey || null, sec: r.sec, killer: r.killer, weapon: r.weapon,
    firstDeath: !!r.firstDeath, traded: r.traded, alive: r.alive,
    planted: !!card.planted, afterPlant: !!r.afterPlant, spot: card.spot || null,
    ...(typeof r.place === 'string' ? { place: r.place } : {}),
  };
}

function createDeathExplain(deps) {
  const out = new Map();

  function picturesOf(entry, card) {
    const f = card.forensics;
    const names = f && Array.isArray(f.frames) ? f.frames : [];
    const kept = names.map((name, i) => ({ b64: deps.frame(entry.id, name), at: Array.isArray(f.frameAt) ? f.frameAt[i] : null }))
      .filter((x) => x.b64).slice(0, MAX_FRAMES);
    if (kept.length) {
      const timed = kept.every((x) => Number.isFinite(x.at));
      return { frames: kept.map((x) => x.b64), ...(timed ? { frameAt: kept.map((x) => x.at) } : {}),
        framesFrom: f.framesFrom === 'recording' ? 'recording' : 'reads' };
    }
    let log = [];
    try { log = deps.logFrames(entry.review, card) || []; } catch { log = []; }
    return log.length ? { frames: log.slice(0, 2), framesFrom: 'reads' } : { frames: [], framesFrom: null };
  }

  async function ask(entry, card, n) {
    const r = entry.review;
    const g = r.game || {};
    const lc = (r.ledger && r.ledger.context) || {};
    const pics = picturesOf(entry, card);
    const f = card.forensics;
    const body = {
      // From the screen, only an agent locked off the player's own HUD, the
      // rule the look keeps (index.js askForensics).
      agent: card.verified ? g.agent || null : lc.agentConfirmed ? lc.agent || g.agent || null : null,
      map: g.map || null, language: deps.language() || 'en',
      source: card.verified ? 'riot' : 'screen',
      ...(typeof r.matchId === 'string' && r.matchId ? { matchId: r.matchId } : {}),
      ...(deps.rankBand() ? { rankBand: deps.rankBand() } : {}),
      death: { ...factsOf(card), frames: pics.frames, ...(pics.frameAt ? { frameAt: pics.frameAt } : {}),
        ...(pics.framesFrom ? { framesFrom: pics.framesFrom } : {}) },
      look: f && f.cause ? { cause: f.cause, what: f.what || null, better: f.better || null } : null,
      why: card.why || null,
      flagged: !!(r.deathFlags && (r.deathFlags.rounds || []).some((x) => x.n === n)),
    };
    let res = null;
    try { res = await deps.post(body); } catch { return { error: 'failed' }; }
    const status = res && res.status;
    const code = res && res.data && res.data.error;
    if (status === 402 || code === 'chat-cap') return { error: 'locked' };
    if (status === 429) return { error: 'later' };
    const answer = res && res.ok ? answerOf(res.data, deps.now()) : null;
    if (!answer) return { error: 'failed' };
    deps.save(entry.id, n, answer);
    return { ok: true, explain: answer };
  }

  /** { ok, explain } or { error: 'match' | 'gone' | 'locked' | 'later' | 'failed' }. */
  function explain(id, n) {
    if (deps.sealed()) return Promise.resolve({ error: 'match' });
    const entry = typeof id === 'string' ? deps.get(id) : null;
    const r = entry && entry.review;
    const card = r && r.kind === 'valorant' && Array.isArray(r.rounds) ? r.rounds.find((c) => c && c.n === n) : null;
    if (!card || !card.died || satOutCard(card)) return Promise.resolve({ error: 'gone' });
    const saved = r.deathExplains && r.deathExplains[n];
    if (saved) return Promise.resolve({ ok: true, explain: saved });
    const key = `${id}|${n}`;
    if (out.has(key)) return out.get(key);
    const run = ask(entry, card, n).finally(() => out.delete(key));
    out.set(key, run);
    return run;
  }

  return { explain };
}

module.exports = { createDeathExplain, answerOf, factsOf };

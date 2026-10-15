'use strict';

/**
 * What Ask Coach is told, offline (8.5.0):
 *
 *   src/shared/chat-context.js       the hold, the match picker, the v2 context, the fill's fields
 *   src/main/services/ask-coach.js   index.js's chat() and the fill, run on fakes
 *
 * The hold of a match a Stop may have left being played: never the default,
 * never listed, refused when seeded, and frame chat refuses its frames, until
 * Riot links it, a later review lands or 90 minutes pass. What is never sent:
 * the engine's memory, a card's screen reads, the tracker's _riotId, the
 * match list's rating. The map rule and the rounds a question names. The one
 * time fill: once, purpose=fill, the connected Riot ID, never mid match or for
 * a held match, its fields and nothing else, an answer that will not change
 * stamped. A saved lost-duel whose better play moves the player is sent
 * without its label. The old string still goes, so a server from before
 * answers as it did.
 *
 * Run: npm run test:chatcontext
 */

const fs = require('fs');
const path = require('path');
const chatContext = require('../src/shared/chat-context');
const { AskCoach, HELD_FRAME } = require('../src/main/services/ask-coach');
const { metaOf } = require('../src/main/services/review-store');
const insights = require('../src/shared/insights');
const valorantReview = require('../src/shared/valorant-review');
const verify = require('../src/shared/valorant-verify');
const riotReview = require('../src/shared/riot-review');
const { replay, load } = require('./fixtures/replay-match');
const gates = require('../server/services/fact-gates');
const cp = require('../server/services/chat-prompt');

let fails = 0;
const ok = (cond, what, detail) => {
  if (!cond) { fails++; console.log(`FAIL  ${what}${detail ? `\n        ${detail}` : ''}`); }
  else console.log(`ok    ${what}`);
};
const MIN = 60 * 1000;
const NOW = Date.UTC(2026, 9, 15, 20, 0);

// ── Reviews to ask about ───────────────────────────────────────────────────

/**
 * The real Abyss 13 to 11 as a review LINKED BEFORE 8.5.0 saved it: no kill
 * feed, no plant time or site, no comps, which is what the fill is for. One
 * linked by 8.5.0 or later keeps them from the link (`linked85`).
 */
function abyss(at) {
  const rv = linked85(at);
  const { comps, ...rest } = rv;
  return { ...rest, rounds: rv.rounds.map((c) => {
    if (!c.riot) return c;
    const { feed, plantSec, plantSite, ...riot } = c.riot;
    return { ...c, riot };
  }) };
}
function linked85(at, extra) {
  const rep = replay(load('valorant-match-abyss-13-11.json').frames, 'standard');
  const riot = { ...load('riot-abyss-13-11.json'), ...((extra && extra.riot) || {}) };
  const { rounds, checks } = verify.reconcile(rep.rounds, riot);
  const tracker = { matchId: 'abyss-ctx-0001', result: 'Victory', score: '13-11', agent: 'Jett', map: 'Abyss',
    kills: 31, deaths: 21, assists: 4, acs: 382, adr: 210, headshotPct: 24, kd: 1.48, mode: 'competitive' };
  const rv = valorantReview.build({ rounds, context: { ...rep.context, agent: 'Jett' }, endedBy: 'score',
    verification: verify.describe(checks), tracker, queue: 'competitive', comps: riot.comps || null });
  return { ...rv, id: 'valorant-1790000000000-abyss1', at, matchId: tracker.matchId };
}

/** A small review of a map, with a result and a few cards. */
function small(id, at, map, agent, extra) {
  const cards = [1, 2, 3, 4, 5].map((n) => ({ n, side: n <= 4 ? 'Attack' : 'Defence', sideKey: n <= 4 ? 'attacking' : 'defending',
    result: n % 2 ? 'won' : 'lost', died: n % 2 === 0, verified: false, watched: true, facts: [], reads: [] }));
  return { kind: 'valorant', source: 'watched', id, at, game: { map, agent, mode: 'Swiftplay', result: 'Victory', score: '5-3' },
    rounds: cards, verified: false, insights: { mistakes: [], strengths: [], missed: [] }, grade: null, patterns: [], ...(extra || {}) };
}

// ── Main's half on fakes ───────────────────────────────────────────────────

function harness(opts) {
  const o = opts || {};
  const calls = [];
  const saved = [];
  const slept = [];
  const entries = new Map();
  let now = o.now || NOW;
  let inMatch = !!o.inMatch;
  const add = (review, game = 'valorant') => entries.set(review.id, { id: review.id, game, at: review.at, review });
  for (const r of o.reviews || []) add(r, r.kind === 'lol' ? 'lol' : 'valorant');
  const rows = () => [...entries.values()].map((e) => metaOf(e.id, e.game, e.review, e.at)).sort((a, b) => b.at - a.at);
  const d = {
    store: { get: (k) => ({ licenseKey: 'TEST-KEY', ...(o.store || {}) })[k] },
    api: {
      get: async (p) => { calls.push({ kind: 'get', path: p, at: now }); return o.get ? o.get(p) : { ok: true, status: 200, data: { error: 'no' } }; },
      post: async (p, body) => { calls.push({ kind: 'post', path: p, body, at: now }); return o.post ? o.post(p, body) : { ok: true, status: 200, data: { reply: 'A reply.' } }; },
    },
    reviews: {
      list: (g) => rows().filter((r) => !g || r.game === g),
      get: (id) => entries.get(id) || null,
      recent: (g, n) => rows().filter((r) => r.game === g).slice(0, n).map((r) => entries.get(r.id)),
      saveFilled: (entry) => { saved.push(entry); entries.set(entry.id, entry); },
    },
    present: (r) => valorantReview.served(r),
    matchInProgress: () => inMatch,
    game: () => o.game || 'valorant',
    patterns: () => o.patterns || {},
    breakdown: () => o.breakdown || { rows: {} },
    tracker: async () => (o.tracker === undefined ? null : o.tracker),
    recentMatches: async () => o.matches || [],
    countable: (r) => insights.countable(r),
    playbookMode: () => 'on',
    connectedRiotId: () => (o.riotId === undefined ? 'Me#EUW' : o.riotId),
    busy: () => !!(o.busy && o.busy()),
    lastHenrikAt: () => (o.lastHenrik ? o.lastHenrik() : 0),
    language: () => o.language || 'en',
    advanced: () => false,
    failureText: (status) => `failed ${status}`,
    lastShownKind: () => null,
    now: () => now,
    sleep: async (ms) => { slept.push(ms); now += ms; },
    log: () => {},
  };
  return {
    coach: new AskCoach(d), calls, saved, slept, entries, add,
    tick: (ms) => { now += ms; }, at: () => now,
    match: (v) => { inMatch = v; },
  };
}

(async () => {
  // ── The hold ─────────────────────────────────────────────────────────────
  console.log('\nthe hold:');
  {
    const older = small('valorant-1790000000001-older1', NOW - 3 * 60 * MIN, 'Split', 'Jett');
    const stopped = small('valorant-1790000000002-stop01', NOW - 10 * MIN, 'Pearl', 'Raze', { stoppedLive: true });
    const h = harness({ reviews: [older, stopped] });
    const rows = h.coach.rows();
    const row = rows.find((r) => r.id === stopped.id);
    ok(chatContext.held(row, rows, NOW), 'a review saved after a Stop mid match, unchecked, 10 minutes ago and the newest, is held');
    const m = h.coach.matches();
    ok(!m.list.some((r) => r.id === stopped.id) && m.chosen.id === older.id, 'IT IS NOT LISTED, AND NOT THE DEFAULT: the newest left is', JSON.stringify(m.chosen));
    const seed = h.coach.seed({ reviewId: stopped.id });
    ok(seed && seed.held === true && seed.until === stopped.at + chatContext.HOLD_MS, 'and refused when "Ask about this match" names it, with when it lifts', JSON.stringify(seed));
    const asked = await h.coach.chat([{ role: 'user', content: 'Walk me through round 2' }], { reviewId: stopped.id });
    ok(asked.ok === false && asked.kind === 'held' && !h.calls.length, 'and a question about it asks nothing of the server', JSON.stringify(asked));
    // Refused, it never becomes the pick: the next question with no chip goes to the newest left.
    const next = await h.coach.chat([{ role: 'user', content: 'Walk me through round 2' }], {});
    ok(next.ok === true && h.calls.length === 1 && h.calls[0].body.context.match.id === older.id,
      'AND THE REFUSED REVIEW NEVER BECOMES THE PICK', JSON.stringify(next));
    h.calls.length = 0;
    // Lifted: 90 minutes on, by Riot's link, or by a later review.
    ok(!chatContext.held(row, rows, NOW + 80 * MIN + 1), 'NINETY MINUTES LIFT IT', String(80 * MIN));
    ok(chatContext.held(row, rows, NOW + 79 * MIN), 'and not a minute before');
    ok(!chatContext.held({ ...row, verified: true }, rows, NOW), "RIOT'S LINK LIFTS IT");
    ok(!chatContext.held(row, [...rows, { id: 'valorant-later', at: stopped.at + 5 * MIN }], NOW), 'A LATER REVIEW LIFTS IT');
    ok(!chatContext.held({ ...row, stoppedLive: false }, rows, NOW), 'and a review saved at its match\'s end was never held');
    // Frame chat refuses its frames.
    const aiLog = { session: 'session-2026-10-15T19-30-00-000Z', match: stopped.at - 20 * MIN, from: stopped.at - 20 * MIN, to: stopped.at };
    h.entries.set(stopped.id, { ...h.entries.get(stopped.id), review: { ...stopped, aiLog } });
    const frame = h.coach.frame(aiLog.session, { at: stopped.at - 5 * MIN, match: aiLog.match, round: 3 });
    ok(frame.held === true && frame.riot === null, 'FRAME CHAT REFUSES ITS FRAMES', JSON.stringify(frame));
    ok(!h.coach.frame('session-other', { at: stopped.at - 5 * MIN, match: 1, round: 3 }).held, 'and another session\'s frame is no frame of it');
    ok(typeof HELD_FRAME === 'string' && /may still be going on/.test(HELD_FRAME), 'with its own words');
  }
  // A held match's counts are no part of "across your last matches" (the
  // verifier's probe, 15 Oct): the hold kept it from being the topic, and its
  // mistakes still went into the patterns the chat was told.
  {
    const K = 'untraded';
    const mistake = { key: K, title: 'Died where nobody could trade', detail: '2 of your 3 deaths went unanswered.', count: 2, rounds: [2, 4] };
    const withIt = (id, at, extra) => small(id, at, 'Split', 'Jett', { insights: { mistakes: [mistake], strengths: [], missed: [] }, ...(extra || {}) });
    const a = withIt('valorant-1790000000201-pat001', NOW - 5 * 60 * MIN);
    const b = withIt('valorant-1790000000202-pat002', NOW - 4 * 60 * MIN);
    const stopped = withIt('valorant-1790000000203-pat003', NOW - 10 * MIN, { stoppedLive: true });
    // The library's own patterns, as index.js getPatterns counts them: the held match among them.
    const library = { recorded: 3, mistakes: [{ key: K, title: mistake.title, matches: 3, trend: null }], strengths: [], missed: [] };
    const h = harness({ reviews: [a, b, stopped], patterns: library });
    await h.coach.chat([{ role: 'user', content: 'What should I work on?' }]);
    const post = h.calls.find((c) => c.kind === 'post');
    const p = post && post.body.context.player.patterns.find((x) => x.key === K);
    ok(p && p.matches === 2 && p.of === 2, 'A HELD MATCH\'S COUNTS ARE LEFT OUT OF THE PATTERNS the chat is told', JSON.stringify(p));
    h.calls.length = 0;
    // Lifted, the library's own patterns are told as they are.
    const lifted = harness({ reviews: [a, b, { ...stopped, verified: true }], patterns: library });
    await lifted.coach.chat([{ role: 'user', content: 'What should I work on?' }]);
    const lp = lifted.calls.find((c) => c.kind === 'post').body.context.player.patterns.find((x) => x.key === K);
    ok(lp && lp.matches === 3, 'and with nothing held they are the library\'s own', JSON.stringify(lp));
  }
  // A match older than the ten newest stays the match it was asked about (the
  // verifier's probe, 15 Oct): seeded from the library's eleventh review, the
  // chip and the question went to the newest.
  {
    const many = Array.from({ length: 11 }, (_v, i) => small(`valorant-17900000001${String(i).padStart(2, '0')}-many${String(i).padStart(2, '0')}`,
      NOW - (i + 1) * 60 * MIN, i === 10 ? 'Pearl' : 'Split', i === 10 ? 'Raze' : 'Jett'));
    const oldest = many[10];
    const h = harness({ reviews: many });
    ok(h.coach.matches().list.length === 10 && !h.coach.matches().list.some((r) => r.id === oldest.id), 'the list is the ten newest');
    const seed = h.coach.seed({ reviewId: oldest.id });
    const m = h.coach.matches();
    ok(seed && !seed.held && m.chosen.id === oldest.id && m.current && m.current.id === oldest.id && m.list.some((r) => r.id === oldest.id),
      'AN ELEVENTH REVIEW ASKED ABOUT IS THE CHIP\'S MATCH, and in its list', JSON.stringify(m.chosen));
    const res = await h.coach.chat([{ role: 'user', content: 'Go through my Pearl Raze match with me.' }], { reviewId: oldest.id });
    const post = h.calls.find((c) => c.kind === 'post');
    ok(res.ok && post && post.body.context.match.id === oldest.id && post.body.context.match.map === 'Pearl', 'and the question is about it', JSON.stringify(post && post.body.context.match && post.body.context.match.id));
  }
  // Mid match, nothing is asked, not even the fill.
  {
    const a = abyss(NOW - 30 * MIN);
    const h = harness({ reviews: [a], inMatch: true });
    const res = await h.coach.chat([{ role: 'user', content: 'Why did I die in round 3?' }]);
    ok(res.ok === false && res.kind === 'mid-match' && h.calls.length === 0, 'MID MATCH, chat() MAKES NO REQUEST', JSON.stringify(h.calls));
    ok(await h.coach.fill(a.id) === 'mid-match' && h.calls.length === 0, 'and the fill asks nothing mid match');
    // Nothing of the question is acted on, not even the chip a map would move.
    const split = small('valorant-1790000000003-split2', NOW - 120 * MIN, 'Split', 'Jett');
    h.add(split);
    const moved = await h.coach.chat([{ role: 'user', content: 'Why did I die in round 3 on Split?' }]);
    ok(moved.kind === 'mid-match' && h.coach.matches().chosen.id === a.id, 'NOR IS THE CHIP MOVED BY A QUESTION ASKED MID MATCH', JSON.stringify(h.coach.matches().chosen));
  }

  // ── The match picker ─────────────────────────────────────────────────────
  console.log('\nthe match picker:');
  {
    const fracture = small('valorant-1790000000010-frac01', NOW - 60 * MIN, 'Fracture', 'Jett');
    const split = small('valorant-1790000000009-split1', NOW - 120 * MIN, 'Split', 'Jett');
    const list = chatContext.chatList([fracture, split].map((r) => metaOf(r.id, 'valorant', r, r.at)), 'valorant', NOW);
    const chosen = { id: fracture.id, how: 'newest' };
    const general = chatContext.pickMatch('How do I play B on Split', chosen, list);
    ok(general.id === fracture.id && !general.moved && !general.which && !general.none, '"HOW DO I PLAY B ON SPLIT" MOVES NOTHING');
    const moved = chatContext.pickMatch('Why did I die in round 5 on Split?', chosen, list);
    ok(moved.moved && moved.id === split.id && moved.from === fracture.id, '"WHY DID I DIE IN ROUND 5 ON SPLIT" MOVES THE CHIP with one Split review');
    const two = chatContext.chatList([fracture, split, small('valorant-1790000000008-split2', NOW - 180 * MIN, 'Split', 'Raze')]
      .map((r) => metaOf(r.id, 'valorant', r, r.at)), 'valorant', NOW);
    const ask = chatContext.pickMatch('Why did I die in round 5 on Split?', chosen, two);
    ok(!ask.moved && ask.id === fracture.id && ask.which && ask.which.count === 2 && ask.which.map === 'Split', 'and never with two: the reply asks which');
    ok(chatContext.pickMatch('how do we split B', chosen, list).id === fracture.id && !chatContext.mapNamed('how do we split B'), 'a map word in lower case is no map');
    ok(chatContext.pickMatch('On Split, why did I die in round 5?', chosen, list).moved && chatContext.mapNamed('My Split match, round 3: why did I lose?') === 'Split'
      && !chatContext.mapNamed('On split, how do I hold B?'), 'THE WORD BEFORE THE MAP MAY OPEN THE QUESTION, and the map keeps its capital');
    ok(chatContext.pickMatch('Why did I lose round 2 on Bind?', chosen, list).none.map === 'Bind', 'a map none of the ten is on is said, nothing moved');
    ok(!chatContext.pickMatch('What about round 3 on Fracture?', chosen, list).moved, 'and the map of the match chosen moves nothing');
    const none = chatContext.pickMatch('When should my team save?', { id: null, how: 'none' }, list);
    ok(none.id === null, '"No match, general questions" is no match');
    // Rounds.
    const a = abyss(NOW - 30 * MIN);
    ok(chatContext.roundOf('Walk me through round five', a) === 5 && chatContext.roundOf('What went wrong in R7?', a) === 7
      && chatContext.roundOf('what happened in round #12?', a) === 12, '"round five", "R7" and "round #12" name their rounds');
    ok(chatContext.roundOf('Why did I lose the pistol round?', a) === 1 && chatContext.roundOf('How was the attack pistol round?', a) === 13,
      '"THE PISTOL ROUND" NAMES THE RIGHT ROUND: the first, or the one on the side named');
    ok(chatContext.roundOf('Explícame la ronda 3', a) === 3 && chatContext.roundOf('Geh mit mir Runde 4 durch', a) === 4, 'and a round in the app\'s other languages');
    ok(chatContext.roundOf('the last round', a) === 24 && chatContext.roundOf('the first round', a) === 1 && chatContext.roundOf('round 30', a) === null,
      'the first and the last round, and none the match does not have');
    ok(gates.shapeOf('Morvane#EUW killed me in round #12, why?') === 'Morvane#EUW' && gates.shapeOf('what happened in round #12?') === null,
      'a Riot ID is a name to the server, "round #12" is not: the round is read before the scrub');
    const ctx = chatContext.build(valorantReview.served(a), { rows: [] }, null, 'Why did I die in round 3?', { game: 'valorant', now: NOW });
    ok(ctx.match.agent === 'Jett' && ctx.ask.round === 3, 'THE AGENT IS THE REVIEW\'S, and the question\'s round is sent');
  }

  // ── What is never sent ───────────────────────────────────────────────────
  console.log('\nwhat is never sent:');
  {
    const a = abyss(NOW - 30 * MIN);
    const reads = a.rounds.flatMap((c) => (c.reads || []).map((x) => (typeof x === 'string' ? x : x && x.text))).filter(Boolean);
    ok(reads.length > 0, 'the Abyss review\'s cards hold screen reads', String(reads.length));
    const tracker = { rank: 'Gold 2', peakRank: 'Platinum 1', matches: 25, kd: 1.05, winRate: 52, headshotPct: 21, acs: 230, adr: 145,
      kpr: 0.8, dpr: 0.75, apr: 0.3, topAgent: 'Jett', topAgents: [{ name: 'Jett', matches: 12, pct: 48, winRate: 58, kd: 1.2, acs: 250 }],
      _riotId: 'Me#EUW', source: 'henrikdev', mode: 'competitive' };
    const matches = [{ map: 'Abyss', agent: 'Jett', result: 'Victory', score: '13-11', kills: 31, deaths: 21, assists: 4, kd: 1.48, acs: 382,
      adr: 210, headshotPct: 24, rating: 88, queue: 'competitive', startedAt: NOW - 90 * MIN }];
    const h = harness({ reviews: [a], tracker, matches, riotId: null });
    const res = await h.coach.chat([{ role: 'user', content: 'Why did I die in round 3?' }]);
    const post = h.calls.find((c) => c.kind === 'post');
    const body = post ? JSON.stringify(post.body) : '';
    ok(res.ok && post && post.path === '/api/coach/chat', 'a question goes to /api/coach/chat');
    ok(reads.every((t) => !body.includes(t.slice(0, 40))) && !/"reads"/.test(body), 'NO CARD\'S SCREEN READS, EVER');
    ok(!body.includes('Me#EUW') && !/_riotId/.test(body), 'NO _riotId, and no Riot ID anywhere in it');
    ok(!/"rating"/.test(body), 'no match list rating, which reads as a grade');
    const c = post.body.context;
    ok(Array.isArray(c.matchMemory) && !c.matchMemory.length && Array.isArray(c.sessionTips) && !c.sessionTips.length, 'NO ENGINE MEMORY, no tips');
    const tk = c.player.tracker;
    ok(tk && JSON.stringify(Object.keys(tk).sort()) === JSON.stringify(['acs', 'adr', 'agents', 'apr', 'dpr', 'hs', 'kd', 'kpr', 'matches', 'peak', 'queue', 'rank', 'winRate']),
      'ONLY THE LISTED TRACKER FIELDS', JSON.stringify(Object.keys(tk || {})));
    ok(JSON.stringify(Object.keys(c.stats).sort()) === JSON.stringify(['acs', 'adr', 'apr', 'dpr', 'headshotPct', 'kd', 'kpr', 'matches', 'peakRank', 'rank', 'topAgent', 'winRate']),
      'and today\'s stats field keeps only what today\'s prompt reads', JSON.stringify(Object.keys(c.stats)));
    ok(c.v === 2 && typeof c.matchReview === 'string' && c.matchReview === chatContext.oldText('valorant', a.at, valorantReview.served(a)),
      'THE OLD STRING IS STILL SENT beside the v2 context');
    ok(c.match && c.match.cards.length === 24 && c.match.cards.every((x) => !('reads' in x) && !('facts' in x)), 'every round, as fields, and no sentence of the screen\'s');
  }

  // ── Cards and saved looks ────────────────────────────────────────────────
  console.log('\ncards and looks:');
  {
    // A Sunset shaped card: round 5 won, survived, one kill.
    const sunset = load('riot-sunset-2-5.json');
    const per = sunset.perRound.map((r) => (r.n === 5 ? { ...r, kills: 1, feed: [{ ms: 12000, by: 'me', on: 'enemy' }] } : r));
    const row = { matchId: 'sunset-ctx-0001', map: 'Sunset', agent: 'Jett', mode: 'Swiftplay', result: 'Defeat', score: '2-5',
      kills: 9, deaths: 6, assists: 2, acs: 200, adr: 130, headshotPct: 18, startedAt: NOW - 40 * MIN };
    const rv = riotReview.fromRiot({ row, riot: { ...sunset, perRound: per }, history: [] }).review;
    const ctx = chatContext.build(valorantReview.served({ ...rv, id: 'valorant-1790000000020-sunset' }), { rows: [] }, null, 'Why did I lose round 5?',
      { game: 'valorant', now: NOW });
    const c5 = ctx.match.cards.find((x) => x.n === 5);
    ok(c5.result === 'won' && c5.died === false && c5.riot && c5.riot.kills === 1, 'a Sunset shaped card: round 5 won, survived, one kill', JSON.stringify(c5));
    const line = cp.renderMatch(cp.normalise(ctx), cp.factsOf(cp.normalise(ctx), []), false);
    // Swiftplay swaps after round 4, so round 5 is its second pistol round (breakdown.js secondPistol).
    ok(/R5 defence, pistol round, won\. Survived\. 1 kill\./.test(line), 'AND ITS LINE AGREES WITH ITS RESULT AND ITS DEATH, the pistol round after the swap',
      (line.match(/R5[^\n]*/) || [''])[0]);
    // Saved looks.
    const a = abyss(NOW - 30 * MIN);
    const looked = { ...a, rounds: a.rounds.map((x) => (x.n === 5 ? { ...x, forensics: { cause: 'lost-duel', what: 'You shot first from the wall.',
      better: 'Keep using the wall for cover, but fall back after your first shots instead of staying on the angle.', source: 'riot' } }
      : x.n === 7 ? { ...x, forensics: { cause: 'lost-duel', what: 'You lost the first shot.', better: 'Keep your crosshair at head level and tap.', source: 'riot' } }
        : x.n === 9 ? { ...x, forensics: { cause: 'unclear', what: 'A frame.', better: 'Something.', source: 'riot' } } : x)) };
    const lc = chatContext.build(valorantReview.served(looked), { rows: [] }, null, 'Why did I lose round 5?', { game: 'valorant', now: NOW });
    const at = (n) => lc.match.cards.find((x) => x.n === n).look;
    ok(at(5).cause === null && /fall back/.test(at(5).better), 'A SAVED LOST-DUEL TRIPPING THE PHRASE LIST IS SENT WITHOUT A LABEL, with what it saw and its better play');
    ok(at(7).cause === 'lost-duel', 'and one whose better play is the duel keeps its label');
    ok(at(9).cause === 'unclear' && at(9).what === null && at(9).better === null, 'an unclear look carries no sentences');
    // The phrase lists, the client's and the server's, held equal.
    const same = Object.keys(gates.PHRASES).every((k) => chatContext.PHRASES[k] && String(chatContext.PHRASES[k]) === String(gates.PHRASES[k]));
    ok(same && Object.keys(chatContext.PHRASES).length === Object.keys(gates.PHRASES).length, 'the phrase lists on the client and the server are one list');
    ok(chatContext.phraseHit('Throw your Cloudburst before you swing.', ['cloudburst']) === 'utility'
      && chatContext.phraseHit('Keep your crosshair at head level.', ['cloudburst']) === null, 'the utility list reads the player\'s own kit');
    // The look's digits as screen facts of its round.
    ok(JSON.stringify(chatContext.lookDigits('You traded at 57 health and dealt 105 damage.')) === JSON.stringify([{ value: 57, unit: 'health' }, { value: 105, unit: 'damage' }])
      && !chatContext.lookDigits('Round 5 was close.').length, 'a look\'s numbers with their units are its round\'s screen facts');
  }
  {
    // A card saved before 8.0.3 keeps only roundFacts()'s sentences: read back,
    // every field they carry is the field itself, on the real match.
    const a = abyss(NOW - 30 * MIN);
    const now = chatContext.build(valorantReview.served(a), { rows: [] }, null, 'Go through it', { game: 'valorant', now: NOW });
    const bare = { ...a, rounds: a.rounds.map(({ riot, ...rest }) => rest) };
    const then = chatContext.build(valorantReview.served(bare), { rows: [] }, null, 'Go through it', { game: 'valorant', now: NOW });
    const FIELDS = ['sec', 'killer', 'weapon', 'firstDeath', 'firstKill', 'kills', 'traded', 'trades', 'alive', 'clutch', 'plantSite'];
    const off = [];
    now.match.cards.forEach((c, i) => {
      const o = then.match.cards[i];
      if (!c.riot || !o.riot) { if (!!c.riot !== !!o.riot) off.push(`R${c.n} riot`); return; }
      for (const f of FIELDS) if (JSON.stringify(c.riot[f]) !== JSON.stringify(o.riot[f])) off.push(`R${c.n} ${f} ${JSON.stringify(c.riot[f])} ${JSON.stringify(o.riot[f])}`);
      if (JSON.stringify(c.screen && c.screen.spot) !== JSON.stringify(o.screen && o.screen.spot)) off.push(`R${c.n} spot`);
    });
    ok(!off.length && then.match.cards.filter((c) => c.riot && c.riot.killer).length === 21,
      'A CARD SAVED BEFORE 8.0.3 IS READ BACK FROM ITS SENTENCES, every field they carry the field itself on the real Abyss', off.slice(0, 4).join('; '));
    // An 8.0.1 card has no verified flag: its review's says. One the screen alone wrote is never read.
    const v801 = { kind: 'valorant', id: 'valorant-1790000000070-abyss2', at: NOW - 60 * MIN, verified: true, game: { map: 'Abyss', agent: 'Jett', mode: 'Swiftplay', result: 'Defeat', score: '3-5' },
      rounds: [{ n: 2, side: 'Defence', result: 'lost', died: true, facts: ['Died at B Main, 13s in, to Tejo with a Outlaw', '4 against 5 when you died', 'Not traded', 'Spike planted at B'] },
        { n: 5, side: 'Attack', result: 'won', died: false, facts: ['Survived', '2 kills', 'First kill of the round', 'Traded a teammate', 'Last one standing against 1, and won it'] }],
      insights: { mistakes: [], strengths: [], missed: [] } };
    const c801 = chatContext.build(valorantReview.served(v801), { rows: [] }, null, 'Round 2?', { game: 'valorant', now: NOW }).match.cards;
    const r2 = c801[0].riot;
    const r5 = c801[1].riot;
    ok(r2 && r2.sec === 13 && r2.killer === 'Tejo' && r2.weapon === 'Outlaw' && r2.traded === false && r2.alive.mates === 4 && r2.plantSite === 'B'
      && c801[0].screen.spot === 'B Main' && c801[0].verified === true
      && r5 && r5.kills === 2 && r5.firstKill && r5.trades === 1 && r5.clutch.vs === 1 && r5.clutch.won === true,
    'an 8.0.1 card, with no flag of its own, is read back by its review\'s', JSON.stringify(c801));
    const screenOnly = { ...v801, verified: false, rounds: [{ n: 3, side: 'Defence', result: 'lost', died: true, facts: ['Died at A Site, early in the round'] }] };
    const cs = chatContext.build(valorantReview.served(screenOnly), { rows: [] }, null, 'Round 3?', { game: 'valorant', now: NOW }).match.cards[0];
    ok(cs.riot === null && cs.verified === false, 'and a card the screen alone wrote gives no Riot facts', JSON.stringify(cs));
    // The death line's own regex, on what roundFacts writes and what it does not.
    const m = chatContext.DEATH_LINE.exec('Died 51s in, to Cypher with a Bandit');
    ok(m && m[2] === '51' && m[3] === 'Cypher' && m[4] === 'Bandit' && !chatContext.DEATH_LINE.test('Died at A Site, early in the round')
      && chatContext.DEATH_LINE.exec('Died at B Tree, 3s in, to Chamber')[3] === 'Chamber' && chatContext.DEATH_LINE.exec('Died, to KAY/O with a Sheriff')[3] === 'KAY/O',
    'the death line reads the verified sentence and never the screen\'s');
  }

  // ── Gating at the edge ───────────────────────────────────────────────────
  console.log('\ngating at the edge:');
  {
    const a = abyss(NOW - 30 * MIN);
    const ctx = chatContext.build(valorantReview.served({ ...a, summary: 'Standing idle in spawn during buy phase was the repeated mistake occurring in rounds 1, 2, 3 and 4.' }),
      { rows: [] }, null, 'Why?', { game: 'valorant', now: NOW });
    ok(typeof ctx.match.coach.summary === 'string' && cp.normalise(ctx).match.coach.summary === null, 'A BUY PHASE SUMMARY IS SENT AND ARRIVES NULL at the server');
  }

  // ── The fill ─────────────────────────────────────────────────────────────
  console.log('\nthe fill:');
  {
    const riot = load('riot-abyss-13-11.json');
    const record = { ...riot, comps: { us: [{ agent: 'Jett', role: 'Duelist' }], them: [{ agent: 'Skye', role: 'Initiator' }] },
      perRound: riot.perRound.map((r) => (r.n === 3 ? { ...r, feed: r.feed.map((k) => ({ ...k, ka: 'Cypher', w: 'Spectre' })) } : r)) };
    const a = abyss(NOW - 30 * MIN);
    ok(chatContext.needsFill(a), 'a linked review with no feed and no stamp needs the fill');
    const h = harness({ reviews: [a], get: () => ({ ok: true, status: 200, data: record }), lastHenrik: () => NOW - 1000 });
    const r1 = await h.coach.fill(a.id);
    const gets = h.calls.filter((c) => c.kind === 'get');
    ok(r1 === 'filled' && gets.length === 1, 'IT RUNS ONCE', JSON.stringify(gets.map((g) => g.path)));
    ok(/purpose=fill/.test(gets[0].path) && /username=Me%23EUW/.test(gets[0].path) && /matchId=abyss-ctx-0001/.test(gets[0].path),
      'WITH purpose=fill, the connected Riot ID and the review\'s match', gets[0].path);
    ok(h.slept.length === 1 && h.slept[0] === 2000, 'three seconds after the app\'s last HenrikDev request', JSON.stringify(h.slept));
    const after = h.entries.get(a.id).review;
    const c3 = after.rounds.find((c) => c.n === 3);
    ok(Array.isArray(c3.riot.feed) && c3.riot.feed.length === 10 && c3.riot.feed[0].ka === 'Cypher' && c3.riot.plantSec === 61.6
      && after.comps && after.comps.us[0].agent === 'Jett' && after.roundRecordAt === h.at(), 'IT STORES THE FEED, THE PLANT, THE COMPS AND THE STAMP');
    const strip = (rv) => JSON.stringify({ ...rv, comps: undefined, roundRecordAt: undefined,
      rounds: rv.rounds.map((c) => (c.riot ? { ...c, riot: { ...c.riot, feed: undefined, plantSec: undefined, plantSite: undefined } } : c)) });
    ok(strip(after) === strip(a), 'AND CHANGES NOTHING ELSE: no grade, no list, no sentence');
    ok(!chatContext.needsFill(after) && await h.coach.fill(a.id) === 'done' && h.calls.filter((c) => c.kind === 'get').length === 1, 'and never asks again');
    // A server from before sends no comps and no agents: nothing of them is stored.
    const old = chatContext.applyRoundRecord(a, riot, 5);
    ok(!('comps' in old) && old.rounds.find((c) => c.n === 3).riot.feed.every((k) => !('ka' in k) && !('w' in k)), 'a field the server does not send is not stored');
    // Nor a name a server sent where an agent or a gun goes: the fill keeps
    // the feed by the link's own function (valorant-verify.js killFeedOf).
    const odd = { ...riot, perRound: riot.perRound.map((r) => (r.n === 3 ? { ...r, feed: r.feed.map((k, i) => (i === 0 ? { ...k, ka: 'Morvane', va: 'Jett', w: 'Morvane#EUW' } : k)) } : r)) };
    const oddFeed = chatContext.applyRoundRecord(a, odd, 5).rounds.find((c) => c.n === 3).riot.feed;
    ok(!('ka' in oddFeed[0]) && oddFeed[0].va === 'Jett' && !('w' in oddFeed[0]) && !JSON.stringify(oddFeed).includes('Morvane'),
      'and a name where an agent or a gun goes is stored as none, an agent the game knows kept', JSON.stringify(oddFeed[0]));
    // Never for a held match, never with no connected Riot ID, never while busy.
    const stopped = { ...abyss(NOW - 5 * MIN), id: 'valorant-1790000000030-held01', stoppedLive: true, verified: false };
    const hh = harness({ reviews: [stopped], get: () => ({ ok: true, status: 200, data: record }) });
    ok(chatContext.needsFill(stopped) && await hh.coach.fill(stopped.id) === 'held', 'NEVER FOR A HELD MATCH, though it would need one');
    ok(!hh.calls.length, 'and asks nothing for it');
    const hn = harness({ reviews: [abyss(NOW - 30 * MIN)], riotId: null });
    ok(await hn.coach.fill('valorant-1790000000000-abyss1') === 'no-id' && !hn.calls.length, 'never with no Riot ID Connect proved');
    let busy = true;
    const hb = harness({ reviews: [abyss(NOW - 30 * MIN)], busy: () => busy });
    ok(await hb.coach.fill('valorant-1790000000000-abyss1') === 'busy' && !hb.calls.length, 'never while the backfill or a review\'s own link is at work');
    busy = false;
    // An answer that will not change stamps it asked; a 503 asks again next time.
    const he = harness({ reviews: [abyss(NOW - 30 * MIN)], get: () => ({ ok: true, status: 200, data: { error: 'That Riot ID is not in this match.' } }) });
    ok(await he.coach.fill('valorant-1790000000000-abyss1') === 'asked' && he.entries.get('valorant-1790000000000-abyss1').review.roundRecordAsked === he.at()
      && !chatContext.needsFill(he.entries.get('valorant-1790000000000-abyss1').review), 'AN ANSWER THAT WILL NOT CHANGE STAMPS IT ASKED, never asked again');
    const h5 = harness({ reviews: [abyss(NOW - 30 * MIN)], get: () => ({ ok: false, status: 503, data: { error: 'Tracker rate limit', retry: true } }) });
    ok(await h5.coach.fill('valorant-1790000000000-abyss1') === 'retry' && !h5.saved.length
      && chatContext.needsFill(h5.entries.get('valorant-1790000000000-abyss1').review), 'a 503 stamps nothing, and asks again on the next open');
    // Opening the page starts it, and a question waits for it.
    const hq = harness({ reviews: [abyss(NOW - 30 * MIN)], get: () => ({ ok: true, status: 200, data: record }) });
    const res = await hq.coach.chat([{ role: 'user', content: 'Walk me through round 3' }]);
    const sent = hq.calls.find((c) => c.kind === 'post');
    ok(res.ok && sent && sent.body.context.match.cards.find((c) => c.n === 3).riot.feed.length === 10
      && hq.calls.findIndex((c) => c.kind === 'get') < hq.calls.findIndex((c) => c.kind === 'post'), 'a question waits for the fill, and is told the round in order');
    // FROM 8.5.0 THE LINK KEEPS THEM (valorant-verify.js reconcile,
    // valorant-review.js build, riot-review.js): the kill feed in the shape
    // the fill stores, by side, agent and gun, the plant's time and site and
    // both comps, so a review linked by 8.5.0 needs no fill and Ask Coach is
    // told its rounds in order with no call; a name a server sent where an
    // agent or a gun goes is kept as nothing.
    const named = { ...record, perRound: record.perRound.map((r) => (r.n === 5 ? { ...r, feed: r.feed.map((k, i) => (i === 0 ? { ...k, ka: 'Morvane', w: 'Morvane' } : k)) } : r)),
      comps: { us: [{ agent: 'Jett', role: 'Duelist' }, { agent: 'Morvane' }], them: [{ agent: 'Skye', role: 'Initiator' }] } };
    const live = linked85(NOW - 30 * MIN, { riot: named });
    const l3 = live.rounds.find((c) => c.n === 3).riot;
    const l5 = live.rounds.find((c) => c.n === 5).riot;
    const filled3 = after.rounds.find((c) => c.n === 3).riot;
    ok(!chatContext.needsFill(live) && JSON.stringify(l3.feed) === JSON.stringify(filled3.feed) && l3.plantSec === filled3.plantSec
      && l3.plantSec === 61.6 && JSON.stringify(live.comps) === JSON.stringify({ us: [{ agent: 'Jett', role: 'Duelist' }], them: [{ agent: 'Skye', role: 'Initiator' }] })
      && !('ka' in l5.feed[0]) && !('w' in l5.feed[0]) && !JSON.stringify(live).includes('Morvane'),
    'A REVIEW LINKED BY 8.5.0 KEEPS THE FEED, THE PLANT AND THE COMPS FROM THE LINK, as the fill stores them, and needs no fill; a name where an agent goes is kept as nothing');
    const hl = harness({ reviews: [live], get: () => ({ ok: true, status: 200, data: record }) });
    const asked = await hl.coach.chat([{ role: 'user', content: 'Walk me through round 3' }]);
    const told = hl.calls.find((c) => c.kind === 'post');
    ok(asked.ok && !hl.calls.some((c) => c.kind === 'get') && told.body.context.match.cards.find((c) => c.n === 3).riot.feed.length === 10
      && told.body.context.match.comps.them[0].agent === 'Skye', 'and Ask Coach is told its round in order and the comps with no call to the tracker');
  }

  // ── The question, and what comes back ────────────────────────────────────
  console.log('\nthe question:');
  {
    const fracture = small('valorant-1790000000040-frac01', NOW - 60 * MIN, 'Fracture', 'Jett');
    const split = small('valorant-1790000000039-split1', NOW - 120 * MIN, 'Split', 'Jett');
    const h = harness({ reviews: [fracture, split] });
    const msgs = [{ role: 'user', content: 'How was my aim?' }, { role: 'assistant', content: 'Fine.' }, { role: 'user', content: 'Why did I die in round 2 on Split?' }];
    const res = await h.coach.chat(msgs);
    const post = h.calls.find((c) => c.kind === 'post');
    ok(res.ok && res.moved && res.match.id === split.id && res.from.id === fracture.id, 'a question naming another match moves to it, and says from where');
    ok(post.body.messages.length === 1 && post.body.context.ask.switchedFrom.map === 'Fracture' && post.body.context.match.map === 'Split',
      'only the question goes, about the match it named, with where it moved from');
    ok(h.coach.matches().chosen.id === split.id && h.coach.matches().chosen.how === 'picked', 'and the chip stays there');
    const h2 = harness({ reviews: [fracture, split, small('valorant-1790000000038-split2', NOW - 180 * MIN, 'Split', 'Raze')] });
    const which = await h2.coach.chat([{ role: 'user', content: 'Why did I die in round 2 on Split?' }]);
    ok(which.ok && which.which && which.which.count === 2 && !h2.calls.length, 'two matches on the map: asked which, with no model call');
    // The cap's answer, and a server's failure.
    const capped = harness({ reviews: [fracture], post: () => ({ ok: false, status: 429, data: { error: 'chat-daily', resetsAt: '2026-10-16T04:40:00.000Z' } }) });
    const cap = await capped.coach.chat([{ role: 'user', content: 'How was my aim?' }]);
    ok(cap.ok === false && cap.kind === 'chat-daily' && cap.resetsAt === Date.parse('2026-10-16T04:40:00.000Z'), 'THE CAP COMES BACK AS ITS OWN KIND, with when it lifts');
    const down = harness({ reviews: [fracture], post: () => ({ ok: false, status: 503, data: { error: 'busy' } }) });
    const dn = await down.coach.chat([{ role: 'user', content: 'How was my aim?' }]);
    ok(dn.ok === false && dn.kind === 'error' && dn.error === 'failed 503', 'and a failure in index.js\'s words (chatFailureText)');
    const honest = harness({ reviews: [fracture], post: () => ({ ok: true, status: 200, data: { reply: 'The honest line.', honest: true } }) });
    ok((await honest.coach.chat([{ role: 'user', content: 'How was my aim?' }])).honest === true, 'the honest line is said to the page as one, for its own words');
    // General questions: no match at all.
    h.coach.choose('none');
    const g = await h.coach.chat([{ role: 'user', content: 'When should my team save?' }], { reviewId: 'none' });
    const gp = h.calls.filter((c) => c.kind === 'post').pop();
    ok(g.ok && gp.body.context.match === null && gp.body.context.matchReview === null, '"No match, general questions" sends no match, and no old string');
  }

  // ── League, and a Riot only review ───────────────────────────────────────
  console.log('\nLeague and Riot only:');
  {
    const lol = { kind: 'lol', id: 'lol-1790000000050-lol001', at: NOW - 30 * MIN,
      game: { champion: 'Ahri', mode: 'CLASSIC', role: 'MIDDLE', durationSec: 1800, me: 'SummonerName123' },
      scoreline: { kills: 7, deaths: 4, assists: 9, cs: 182, csAt10: 70, ward: 24, level: 16 },
      deathList: [{ n: 1, atSec: 754, at: '12:34', fact: 'An ally had died in the 20 seconds before it.' }],
      deaths: { headline: 'You died 4 times.' }, grade: { score: 71, letter: 'B', categories: [] }, insights: { mistakes: [], strengths: [], missed: [] } };
    const ctx = chatContext.build(lol, { rows: [] }, null, 'Why did I die so often?', { game: 'lol', now: NOW });
    const s = JSON.stringify(ctx);
    ok(ctx.game === 'lol' && ctx.match.champion === 'Ahri' && ctx.match.deaths.length === 1 && !s.includes('SummonerName123'),
      'LEAGUE CARRIES ONLY ITS COMPUTED REVIEW, never the summoner name');
    ok(ctx.player.tracker === null && ctx.ask.round === null, 'and no tracker, no round');
    const split = load('riot-split-13-7.json');
    const row = { matchId: 'split-ctx-0001', map: 'Split', agent: split.me.agent, mode: 'Competitive', result: split.result, score: split.score,
      kills: split.me.kills, deaths: split.me.deaths, assists: split.me.assists, acs: 250, adr: 150, headshotPct: 20, startedAt: NOW - 3 * 60 * MIN };
    const ro = riotReview.fromRiot({ row, riot: split, history: [] }).review;
    const rc = chatContext.build(valorantReview.served({ ...ro, id: 'valorant-1790000000060-split1' }), { rows: [] }, null, 'Go through it', { game: 'valorant', now: NOW });
    ok(rc.match.source === 'riot' && rc.match.cards.every((c) => !c.look) && rc.match.lists.facts.length > 0 && !rc.match.lists.mistakes.length,
      'A RIOT ONLY REVIEW CARRIES FACTS AND NO LOOK');
    ok(chatContext.startersOf(ro).riotOnly === true, 'and opens with its own question');
  }

  // ── index.js reads through the service ───────────────────────────────────
  console.log('\nindex.js:');
  {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'index.js'), 'utf8');
    const between = (head, tail) => { const i = src.indexOf(head); const j = i < 0 ? -1 : src.indexOf(tail, i + head.length); return j < 0 ? '' : src.slice(i, j); };
    const chat = between('\n  async chat(messages, opts) {', '\n  },');
    ok(chat.includes('return askCoach().chat(messages, opts);') && !/engine\.matchMemory/.test(src), 'chat() is the service\'s, and nothing reads the engine\'s match memory for it');
    const ask = between('\n  async askAboutFrame(payload) {', '\n  },');
    ok(ask.indexOf('aiLogStore.askAbout(') >= 0 && ask.indexOf('askCoach().frame(') > ask.indexOf('aiLogStore.askAbout(')
      && ask.indexOf('askCoach().frame(') < ask.indexOf('/api/coach/frame-chat') && !/shown: target\.shown/.test(ask),
      'frame chat asks the hold before anything is sent, and sends no tip');
    const fail = between('\nfunction chatFailureText(status, data) {', '\n}');
    ok(/data\.error === 'chat-daily'/.test(fail) && /Ask Coach is back at/.test(fail), 'chatFailureText learns chat-daily');
    ok(/openChatSeeded\(seed\) \{[\s\S]*?askCoach\(\)\.seed\(seed\)/.test(src) && !/Review my coached session/.test(src), 'the seed is the service\'s, and no tip era seed is left');
  }

  console.log(fails ? `\nFAIL: ${fails} check(s) failed` : '\nPASS: Ask Coach is told the match on its chip, never a held one or one in progress, and fills an old review once');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log(`FAIL  the test threw: ${e && e.stack}`); process.exit(1); });

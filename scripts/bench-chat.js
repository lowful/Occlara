'use strict';

/**
 * bench:chat (spec 8.13): which model answers Ask Coach v2, and is what it
 * says true?
 *
 * SIX MATCHES, ABOUT THIRTY QUESTIONS, EACH WITH ITS KEY. The repo's Abyss 13
 * to 11, built offline as test:valorantreview builds it and filled from its
 * own Riot record, and its Split 13 to 7, the player's upgraded review where
 * their library has it and otherwise the repo's 8.0.1 review upgraded as
 * test:riotreview upgrades it, with their questions in
 * scripts/fixtures/chat-questions.json; and the player's Fracture 5 to 1,
 * Sunset 2 to 5, Abyss swiftplay 3 to 5 and Pearl 1 to 5 from userData, with
 * theirs in userData/bench/chat/questions.json, never in the repo. A key is written by
 * hand from Riot's record of the round: what a right answer states (`must`)
 * and the claims it must not make (`mustNot`, each one a wrong fact), so the
 * answers are checked independently of the gates.
 *
 * ASKED AS THE APP ASKS. Every question goes through main's own Ask Coach
 * (src/main/services/ask-coach.js) on a read-only copy of the library: the
 * chip, the map rule, the hold, the fill and both shapes of the context. The
 * request adds the admin bench's fields, the model (benchModel), the prompt
 * (variant: v2, or v2-noprimer, the control without the primer core) and
 * raw: true. The player's reviews are filled once as 8.10 fills them, through
 * the server (purpose=fill), and the record kept in userData/bench/chat/fills/
 * and in memory, never saved to the library.
 *
 * SCORED ON THE RAW REPLY, before the gates. The server must send the model's
 * own text to an admin bench (`raw`, and `rawRetry` when the gates asked
 * again), or the bench stops at its first answer: what the gates dropped
 * cannot show what the model said. Per model and prompt:
 *   - the wrong fact rate, answers with a key's wrong fact, with its exact
 *     95% interval; the final answers' beside it, with a person's read;
 *   - apart from it, what the gates caught (the same gates run here on the raw
 *     reply, sentence by sentence) and what slipped past them (a key's wrong
 *     fact still in the final answer);
 *   - sentences dropped, answers asked again, honest lines (the server's counts);
 *   - names: a planted name or a handle's shape, raw and shown;
 *   - cost a question (the 'bench' route of /api/admin/costs, with --costs),
 *     cached tokens when the server reports its usage, and latency.
 * Then every bar of 8.13, and the cheapest model passing every one. The bars
 * a person must read (wrong facts, depth) need the read: the run writes the
 * finalist's answers to a sheet with each answer's facts beside it and a
 * read file to fill, and --score folds it in.
 *
 * SPENDS MONEY: about $3.80 for the run below, and it stops before a question
 * that would pass --budget dollars (5 by default), counted at the larger of
 * the ledger's figure and the estimate. Calls are paced --gap seconds apart
 * (13), so the chat limiter never fires, and the server books them under
 * 'bench', never a licence and never Ask Coach's daily cap.
 *
 *   ADMIN_PASSWORD=... npm run bench:chat -- --models openai/gpt-6-sol,google/gemini-3-flash-preview,qwen/qwen3.7-flash
 *     --runs 2 --finalist openai/gpt-6-sol --finalist-runs 3 --variants v2,v2-noprimer --costs --budget 5 --gap 13
 *   npm run bench:chat -- --dry        every question asked of the real client code and its prompt built, nothing sent
 *   npm run bench:chat -- --score <run.json> --read <read.json>     a run scored again, with the person's read
 *
 * --dry reads no licence and no password, calls nothing and writes nothing:
 * it checks every key's samples, asks every question of Ask Coach on the
 * library as it is, holds the match each one lands on to the sheet, builds
 * each prompt here as the server would, and prints the plan and its estimate.
 * Everything a run writes goes to userData/bench/chat/runs/, never the repo.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { profileDir, configPath } = require('./profile-path');
const { replay, load } = require('./fixtures/replay-match');
const chatContext = require('../src/shared/chat-context');
const { AskCoach } = require('../src/main/services/ask-coach');
const { ReviewStore, metaOf } = require('../src/main/services/review-store');
const valorantReview = require('../src/shared/valorant-review');
const riotReview = require('../src/shared/riot-review');
const verify = require('../src/shared/valorant-verify');
const insights = require('../src/shared/insights');
const patterns = require('../src/shared/patterns');
const breakdown = require('../src/shared/breakdown');
const chatPrompt = require('../server/services/chat-prompt');
const gates = require('../server/services/fact-gates');
const nameGate = require('../server/services/name-gate');

const SERVER = process.env.OCCLARA_SERVER || 'https://ghostcoach-production.up.railway.app';
const ROOT = profileDir(process.env.APPDATA || '');
const HERE = path.join(ROOT, 'bench', 'chat');
const REPO_SHEET = path.join(__dirname, 'fixtures', 'chat-questions.json');
const VERSION = '8.5.0';
const VARIANTS = new Set(['v2', 'v2-noprimer']);
// The estimate an answer is counted at when the ledger says less, from 8.13's
// own figures: Sol's 150 answers about $3.20, the cheaper two's 120 about
// $0.50. A model it does not name is counted at $0.03, the bar's mean.
const ESTIMATE = { 'openai/gpt-6-sol': 0.0215, 'google/gemini-3-flash-preview': 0.0042, 'qwen/qwen3.7-flash': 0.0042 };
const estimateOf = (model) => (ESTIMATE[model] !== undefined ? ESTIMATE[model] : 0.03);

// ── Flags ───────────────────────────────────────────────────────────────────

const ARGS = process.argv.slice(2);
const has = (f) => ARGS.includes(`--${f}`);
const flag = (name, dflt) => {
  const i = ARGS.indexOf(`--${name}`);
  return i >= 0 && ARGS[i + 1] !== undefined && !ARGS[i + 1].startsWith('--') ? ARGS[i + 1] : dflt;
};
const listOf = (s) => String(s || '').split(',').map((x) => x.trim()).filter(Boolean);
const posInt = (v, dflt) => (Number.isInteger(Number(v)) && Number(v) > 0 ? Number(v) : dflt);

const OPTS = {
  dry: has('dry'),
  costs: has('costs'),
  verbose: has('verbose'),
  models: listOf(flag('models', '')),
  runs: posInt(flag('runs', 2), 2),
  finalist: flag('finalist', null),
  finalistRuns: posInt(flag('finalist-runs', 3), 3),
  variants: listOf(flag('variants', 'v2')).map((v) => v.toLowerCase()),
  budget: Number(flag('budget', 5)),
  gapMs: Math.max(0, Number(flag('gap', 13)) * 1000),
  only: listOf(flag('only', '')),
  sheet: flag('questions', path.join(HERE, 'questions.json')),
  score: flag('score', null),
  read: flag('read', null),
};

// ── Text ────────────────────────────────────────────────────────────────────

const CURLY = new RegExp(`[${String.fromCharCode(0x2018, 0x2019)}]`, 'g');
const CURLY_DOUBLE = new RegExp(`[${String.fromCharCode(0x201c, 0x201d)}]`, 'g');
const norm = (t) => String(t || '').replace(CURLY, "'").replace(CURLY_DOUBLE, '"').replace(/\s+/g, ' ').trim();
const escRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// A phrase as a whole word or words, in any case, letters with accents counted as letters.
const phraseRe = (p) => new RegExp(`(?<![\\p{L}\\p{N}])${escRe(norm(p))}(?![\\p{L}\\p{N}])`, 'iu');
const hashOf = (s) => crypto.createHash('sha256').update(String(s)).digest('hex').slice(0, 12);

// ── The sheets and their keys ───────────────────────────────────────────────

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/*
 * WHAT A KEY READS (bench:chat, 15 Oct, where the keys' own hits were the
 * keys misfiring). A check marked `about: 'round'`, on the check or on its
 * list, reads only what is said of the round asked (roundText): never a
 * clause quoting the match's counts ("dying where nobody could trade, which
 * happened 14 times", "14 of your 16 deaths went unanswered", "the counted
 * mistake"), unless it points at the round too ("including this one",
 * "round 10"), nor a hypothetical, an instruction or "without you dying
 * untraded". Most of Gemini's and Qwen's "not traded" hits were those quotes.
 * A check marked `otherMatch` is a marker of another match, and a phrase
 * naming an agent the question's own match has is no marker: "Clove" stood
 * for the Pearl match where Clove was the player's teammate on Fracture.
 */
const SPELLED_COUNT = 'one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty';
const MATCH_COUNT = new RegExp(`\\b(?:\\d+|${SPELLED_COUNT})\\s+(?:times\\b|out of\\b|of\\s+(?:your|the|those|these|their)\\b)|\\bcounted\\b|\\bacross the match\\b|\\b(?:this|the|that)\\s+match\\b|\\b(?:your|those|these|their)\\s+(?:[a-z]+\\s+)?deaths\\b`, 'i');
const NOT_A_CLAIM = /\bwithout\s+(?:you\s+|your\s+[a-z]+\s+)?(?:dying|being|getting)\b|\bnot\s+(?:one|among)\s+of\b/i;
const CLAUSE_SPLIT = /,\s*but\s+|;\s*|\s+but\s+/i;
/** What a text says of the round asked, clause by clause: the counts of the match, hypotheticals and advice left out. */
function roundText(text, round) {
  const thisRound = new RegExp(`\\bthis one\\b|\\b(?:this|that) (?:round|death)\\b${Number.isInteger(round) ? `|\\bround\\s+${round}\\b` : ''}`, 'i');
  const out = [];
  for (const s of nameGate.sentencesOf(norm(text))) {
    for (const clause of s.split(CLAUSE_SPLIT)) {
      if (!clause.trim() || gates.isHypothetical(clause) || gates.isInstruction(clause) || NOT_A_CLAIM.test(clause)) continue;
      if (MATCH_COUNT.test(clause) && !thisRound.test(clause)) continue;
      out.push(clause);
    }
  }
  return out.join(' | ');
}

/** The agents a question's own match has, from the context sent: both comps, the killers, the feed. */
function ownAgents(context) {
  const m = context && context.match;
  const out = new Set();
  if (!m) return out;
  for (const side of ['us', 'them']) for (const x of (m.comps && m.comps[side]) || []) if (x && x.agent) out.add(String(x.agent).toLowerCase());
  for (const c of m.cards || []) {
    const r = c && c.riot;
    if (!r) continue;
    if (r.killer) out.add(String(r.killer).toLowerCase());
    for (const k of r.feed || []) for (const a of [k && k.ka, k && k.va]) if (a) out.add(String(a).toLowerCase());
  }
  return out;
}

/** One check of a key, compiled: { what, tag, atLeast, about, otherMatch, phrases, count(text, opts) }, or a problem. */
function compileCheck(c, lists, where, problems) {
  if (!c || typeof c !== 'object' || typeof c.what !== 'string' || !c.what) {
    problems.push(`${where}: a check needs its "what"`);
    return null;
  }
  let src = c;
  if (typeof c.list === 'string') {
    if (!(c.list in lists)) { problems.push(`${where}: no list named ${c.list}`); return null; }
    src = Array.isArray(lists[c.list]) ? { any: lists[c.list] } : lists[c.list];
  }
  const atLeast = posInt(c.atLeast, 1);
  const about = c.about || src.about || null;
  if (about !== null && about !== 'round') { problems.push(`${where}: "${c.what}" has an about other than "round"`); return null; }
  const otherMatch = c.otherMatch === true;
  // The text a check reads: the round asked's alone for `about: 'round'`.
  const scope = (t, o) => (about === 'round' ? roundText(t, o && o.round) : norm(t));
  if (Array.isArray(src.any)) {
    if (!src.any.length || src.any.some((p) => typeof p !== 'string' || !p.trim())) { problems.push(`${where}: "${c.what}" has an empty phrase`); return null; }
    const res = src.any.map((p) => ({ p, re: phraseRe(p) }));
    return { what: c.what, tag: c.tag || null, atLeast, about, otherMatch, phrases: src.any.slice(),
      count: (t, o) => {
        const own = otherMatch && o && o.agents instanceof Set ? o.agents : null;
        const text = scope(t, o);
        return res.filter(({ p, re }) => !(own && own.has(p.toLowerCase())) && re.test(text)).length;
      } };
  }
  if (typeof src.re === 'string') {
    let re = null;
    try { re = new RegExp(src.re, src.flags === undefined ? 'i' : src.flags); } catch (e) { problems.push(`${where}: "${c.what}" does not compile: ${e.message}`); return null; }
    // Every regular expression is held to its own samples before anything is sent.
    const pos = Array.isArray(src.pos) ? src.pos : [];
    const neg = Array.isArray(src.neg) ? src.neg : [];
    if (!pos.length || !neg.length) problems.push(`${where}: "${c.what}" needs samples it must match (pos) and must not (neg)`);
    for (const s of pos) if (!re.test(norm(s))) problems.push(`${where}: "${c.what}" misses its own sample "${s}"`);
    for (const s of neg) if (re.test(norm(s))) problems.push(`${where}: "${c.what}" matches its own counter sample "${s}"`);
    const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
    return { what: c.what, tag: c.tag || null, atLeast, about, otherMatch, phrases: null, count: (t, o) => [...scope(t, o).matchAll(g)].length };
  }
  problems.push(`${where}: "${c.what}" is neither any, list nor re`);
  return null;
}

/** A marker of another match that names an agent the question's own match has: a problem --dry prints. */
function markerClashes(q, context) {
  const own = ownAgents(context);
  const out = [];
  for (const c of (q.keys && q.keys.mustNot) || []) {
    if (!c.otherMatch || !c.phrases) continue;
    for (const p of c.phrases) if (own.has(p.toLowerCase())) out.push(`${q.id}: "${c.what}" names ${p}, whom its own match has too`);
  }
  return out;
}

/** Both sheets, every key compiled, and what is wrong with them. */
function loadSheets(o) {
  const problems = [];
  const repo = readJson(REPO_SHEET);
  let player = null;
  let missing = null;
  try { player = readJson(o.sheet); } catch (e) { missing = e.code === 'ENOENT' ? `no sheet at ${o.sheet}` : `${o.sheet}: ${e.message}`; }
  const lists = { ...(repo.lists || {}), ...((player && player.lists) || {}) };
  const questions = [];
  const seen = new Set();
  for (const sheet of [repo, player].filter(Boolean)) {
    for (const q of sheet.questions || []) {
      const where = `${sheet.library}/${q.id}`;
      if (!q.id || seen.has(q.id)) { problems.push(`${where}: a question needs an id of its own`); continue; }
      seen.add(q.id);
      if (q.match !== null && !(sheet.matches || {})[q.match]) problems.push(`${where}: no match ${q.match} in its sheet`);
      if (!['picked', 'newest', 'none'].includes(q.open)) problems.push(`${where}: open is picked, newest or none`);
      if (typeof q.ask !== 'string' || !q.ask.trim()) problems.push(`${where}: no question`);
      const must = (q.must || []).map((c, i) => compileCheck(c, lists, `${where} must ${i + 1}`, problems)).filter(Boolean);
      const mustNot = (q.mustNot || []).map((c, i) => compileCheck(c, lists, `${where} mustNot ${i + 1}`, problems)).filter(Boolean);
      questions.push({ ...q, library: sheet.library, keys: { must, mustNot } });
    }
  }
  // Every list's own samples, named or not, so a list is never wrong unseen.
  for (const [name, l] of Object.entries(lists)) if (!Array.isArray(l)) compileCheck({ what: `list ${name}`, list: name }, lists, `lists/${name}`, problems);
  return { repo, player, missing, lists, questions, problems };
}

// ── The libraries ───────────────────────────────────────────────────────────

/** A library Ask Coach reads, over entries { id, game, at, review }: read only, a fill kept in memory. */
function libraryOf(entries) {
  const kept = new Map(entries.map((e) => [e.id, e]));
  const rows = () => [...kept.values()].map((e) => metaOf(e.id, e.game, e.review, e.at)).sort((a, b) => b.at - a.at);
  return {
    list: (g) => rows().filter((r) => !g || r.game === g),
    get: (id) => kept.get(id) || null,
    recent: (g, n) => rows().filter((r) => r.game === g).slice(0, n).map((r) => kept.get(r.id)),
    saveFilled: (entry) => { kept.set(entry.id, entry); },
  };
}

/**
 * The repo's matches: the Abyss 13 to 11 as test:valorantreview builds it,
 * filled from its own Riot record; the Split 13 to 7 the player's upgraded
 * review where their library has it (its questions then asked there), else
 * as test:riotreview upgrades the repo's 8.0.1 review, filled from Riot's.
 */
function repoLibrary(sheet, player) {
  const ids = {};
  const entries = [];
  const from = {};
  for (const [key, m] of Object.entries(sheet.matches || {})) {
    if (m.player) {
      const p = m.player;
      const e = player && player.entries.find((x) => x.review && x.review.game && x.review.game.map === p.map
        && x.review.game.score === p.score && x.review.game.mode === p.mode);
      if (e) {
        player.ids[key] = e.id;
        from[key] = 'player';
        if (applyCachedFill(e)) player.filled++;
        continue;
      }
    }
    if (m.saved) {
      const saved = load(m.saved);
      const riot = load(m.riot);
      const { review } = riotReview.upgradeWatched({ saved: { id: saved.id, at: saved.at, review: saved.review },
        row: { ...m.row, map: riot.map, startedAt: riot.startedAt }, riot, history: [], account: null });
      entries.push({ id: saved.id, game: 'valorant', at: saved.at,
        review: chatContext.applyRoundRecord({ ...review, id: saved.id, at: saved.at }, riot, saved.at) });
      ids[key] = saved.id;
      from[key] = 'repo';
      continue;
    }
    const rep = replay(load(m.fixture).frames, 'standard');
    const riot = load(m.riot);
    const { rounds, checks } = verify.reconcile(rep.rounds, riot);
    const at = Date.parse(m.at);
    const sl = m.scoreline || {};
    const tracker = { matchId: `bench-${key}`, result: riot.result, score: riot.score, agent: m.agent, map: riot.map,
      kills: sl.kills, deaths: sl.deaths, assists: sl.assists, acs: sl.acs, adr: sl.adr, headshotPct: sl.headshotPct, kd: sl.kd, mode: m.queue };
    const built = valorantReview.build({ rounds, context: { ...rep.context, agent: m.agent }, endedBy: 'score',
      verification: verify.describe(checks), tracker, queue: m.queue });
    const id = `valorant-${at}-${key.replace(/[^a-z0-9]/g, '').slice(0, 6).padEnd(4, '0')}`;
    const review = chatContext.applyRoundRecord({ ...built, id, at, matchId: tracker.matchId }, riot, at);
    entries.push({ id, game: 'valorant', at, review });
    ids[key] = id;
    from[key] = 'repo';
  }
  return { lib: libraryOf(entries), ids, from, filled: entries.length };
}

/** A record an earlier live run filled, applied in memory to a review that still needs it; true when it was. */
function applyCachedFill(e) {
  const cached = fillFile(e.review && e.review.matchId);
  if (!cached || !chatContext.needsFill(e.review)) return false;
  try {
    const rec = readJson(cached);
    e.review = chatContext.applyRoundRecord(e.review, rec, rec.at || Date.now());
    return true;
  } catch {
    return false;   // a broken cache is asked again
  }
}

/** The player's library, read only, with any record a live run filled kept beside it applied. */
function playerLibrary(sheet) {
  const store = new ReviewStore(path.join(ROOT, 'reviews'));
  const entries = store.list().map((r) => store.get(r.id)).filter(Boolean);
  const ids = {};
  const problems = [];
  let filled = 0;
  for (const [key, m] of Object.entries(sheet.matches || {})) {
    const e = entries.find((x) => x.id === m.id)
      || entries.find((x) => x.review && x.review.game && x.review.game.map === m.map && x.review.game.score === m.score);
    if (!e) { problems.push(`no review of ${key} (${m.map} ${m.score}) in ${path.join(ROOT, 'reviews')}`); continue; }
    ids[key] = e.id;
    if (applyCachedFill(e)) filled++;
  }
  return { lib: libraryOf(entries), entries, ids, filled, problems };
}

const fillFile = (matchId) => {
  const f = matchId ? path.join(HERE, 'fills', `${String(matchId).replace(/[^A-Za-z0-9-]/g, '_')}.json`) : null;
  return f && fs.existsSync(f) ? f : null;
};

// ── Asking ──────────────────────────────────────────────────────────────────

const RIOT_ID_ALL = new RegExp(gates.RIOT_ID.source, `${gates.RIOT_ID.flags.replace('g', '')}g`);
/** The conversation as the server's chatMessagesV2 hands it on: the last eight, the round read first, Riot IDs scrubbed. */
const serverMessages = (msgs) => (Array.isArray(msgs) ? msgs : []).slice(-8).map((m) => ({
  role: m && m.role === 'assistant' ? 'assistant' : 'user',
  content: String((m && m.content) || '').slice(0, 1200).replace(/\bround\s*#\s*(\d{1,2})\b/gi, 'round $1').replace(RIOT_ID_ALL, 'a player').trim(),
})).filter((m) => m.content);

/** Main's Ask Coach on one library, its network the bench's. */
function coachOf(lib, cur, net) {
  return new AskCoach({
    store: { get: (k) => (k === 'licenseKey' ? (net.key || 'BENCH-DRY') : null) },
    api: { get: (p, key, ms) => net.get(p, ms), post: (p, body, key, ms) => net.post(p, body, ms) },
    reviews: lib,
    present: (r) => valorantReview.served(r),
    matchInProgress: () => false,
    game: () => 'valorant',
    patterns: (g) => ({ game: g, ...patterns.summarise(lib.recent(g, patterns.LOOK_BACK)) }),
    breakdown: (g) => breakdown.build(g, lib.recent(g, 300), { queue: 'All' }),
    tracker: async () => null,
    recentMatches: async () => [],
    countable: (r) => insights.countable(r),
    playbookMode: () => 'on',
    connectedRiotId: () => net.riotId || null,
    busy: () => false,
    lastHenrikAt: () => 0,
    language: () => (cur.q && cur.q.language) || 'en',
    advanced: () => !!(cur.q && cur.q.advanced === true),
    failureText: (status, data) => `${status || 'no answer'}: ${(data && (data.error || data.message)) || 'no reply'}`,
    lastShownKind: () => 'valorant',
    now: () => Date.now(),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    log: (...a) => { if (OPTS.verbose) console.log(...a); },
  });
}

/** One question as the page asks it: the chip set as the question opens, then sent with the chip's id. */
async function askOne(coach, q, reviewId, cur) {
  coach.plain();
  if (q.open === 'picked' && reviewId) coach.choose(reviewId);
  else if (q.open === 'none') coach.choose('none');
  const chip = coach.matches().chosen;
  cur.sent = null;
  cur.last = null;
  const thread = [...(Array.isArray(q.thread) ? q.thread : []), { role: 'user', content: q.ask }];
  const out = await coach.chat(thread, { reviewId: chip.how === 'none' ? 'none' : chip.id });
  return { out, chip };
}

/** What the server is sent and builds, here: the context, the conversation it sees and the prompt's size. */
function built(body, variant) {
  const messages = serverMessages(body.messages);
  const input = chatPrompt.normalise(body.context);
  const prompt = chatPrompt.buildPrompt(input, messages, { variant });
  // Every round the server tells in full, as it reads them (chat-prompt.js askedRounds); the first is the one a sheet expects.
  const rounds = typeof chatPrompt.askedRounds === 'function' ? chatPrompt.askedRounds(input, messages) : (input.ask && input.ask.round ? [input.ask.round] : []);
  const round = rounds[0] || null;
  return { input, messages, chars: prompt.length, hash: hashOf(prompt), round, rounds,
    inFull: rounds.length ? rounds.every((n) => prompt.includes(`ROUND ${n} IN FULL`)) : null };
}

// ── Scoring ─────────────────────────────────────────────────────────────────

/**
 * The keys on a text: the facts it missed and the wrong facts it states.
 * `opts.round` is the round asked (a check about the round reads what is said
 * of it), `opts.agents` the agents of the question's own match (ownAgents),
 * which no marker of another match stands for.
 */
function keyed(q, text, opts) {
  const t = norm(text);
  const o = opts || {};
  return {
    missing: q.keys.must.filter((c) => c.count(t, o) < c.atLeast).map((c) => c.what),
    wrong: q.keys.mustNot.filter((c) => c.count(t, o) > 0).map((c) => ({ what: c.what, tag: c.tag })),
  };
}
/** What keyed() is told of a question's context: the round asked and its match's agents. */
const keyOpts = (context, round) => ({ round: Number.isInteger(round) ? round : (context && context.ask && context.ask.round) || null, agents: ownAgents(context) });

/**
 * A planted name or a handle's shape in a text, and a sentence the server
 * withheld from a raw reply for naming a player of the match (name-gate.js
 * WITHHELD, coach.js rawForBench). Counts and the bench's own planted names only.
 */
function namesIn(q, text) {
  const t = String(text || '');
  const planted = (q.planted || []).filter((n) => phraseRe(n).test(t));
  let shapes = 0;
  for (const s of nameGate.sentencesOf(t)) if (nameGate.handleShape(s) && !planted.some((n) => phraseRe(n).test(s))) shapes++;
  const withheld = nameGate.WITHHELD ? t.split(nameGate.WITHHELD).length - 1 : 0;
  return { planted, shapes, withheld, count: planted.length + shapes + withheld };
}

/** The gates, run here on a text sentence by sentence, as parseReply runs them (chat-prompt.js gateReply). */
function gatedHere(text, input, messages) {
  const facts = chatPrompt.factsOf(input, messages);
  const out = { sentences: 0, kept: 0, dropped: {}, logged: {}, rows: [], firstDropped: false };
  const rows = typeof chatPrompt.gateReply === 'function'
    ? chatPrompt.gateReply(chatPrompt.cleanReply(text), facts, { nameSet: null })
    : chatPrompt.cleanReply(text).flatMap((p, i) => gates.sentencesOf(p).map((s) => ({ p: i, s, ...gates.check(s, facts, { nameSet: null }) })));
  rows.forEach((r, i) => {
    out.sentences++;
    for (const l of r.logged || []) out.logged[l] = (out.logged[l] || 0) + 1;
    if (r.drop) {
      out.dropped[r.drop.gate] = (out.dropped[r.drop.gate] || 0) + 1;
      if (i === 0) out.firstDropped = true;
    } else out.kept++;
    out.rows.push({ s: r.s, gate: r.drop ? r.drop.gate : null, logged: r.logged || [] });
  });
  return out;
}

/** Whether the name heuristic, in log mode, flags the sentence a planted name is in. */
function heuristicCatches(q, text, language) {
  const caught = [];
  for (const n of q.planted || []) {
    const s = nameGate.sentencesOf(String(text || '')).find((x) => phraseRe(n).test(x));
    if (s) caught.push(!!nameGate.namesSomeone(s, { language }));
  }
  return caught;
}

const ES_WORDS = new Set(['el', 'la', 'los', 'las', 'de', 'del', 'que', 'en', 'y', 'tu', 'tus', 'te', 'por', 'para', 'con', 'una', 'un',
  'no', 'es', 'lo', 'se', 'al', 'pero', 'cuando', 'ronda', 'como', 'muy', 'sin', 'fue', 'ese', 'esa', 'antes', 'tus']);
const EN_WORDS = new Set(['the', 'you', 'your', 'and', 'to', 'of', 'was', 'it', 'that', 'with', 'for', 'on', 'is', 'round', 'when', 'but', 'this']);
/** Whether a text is written in Spanish, by its common words. */
function inSpanish(text) {
  const words = String(text || '').toLowerCase().split(/[^\p{L}]+/u).filter(Boolean);
  const es = words.filter((w) => ES_WORDS.has(w)).length;
  const en = words.filter((w) => EN_WORDS.has(w)).length;
  return es >= 5 && es >= 2 * en;
}

/** One answer scored: the keys on the raw and the shown reply, the gates here, names, language. */
function scoreAnswer(q, a, ctx) {
  if (!a.called || typeof a.raw !== 'string') return null;
  const b = built({ messages: a.messages, context: ctx }, a.variant);
  const ko = keyOpts(ctx, b.round);
  const raw = { ...keyed(q, a.raw, ko), names: namesIn(q, a.raw), gates: gatedHere(a.raw, b.input, b.messages) };
  const final = { ...keyed(q, a.reply, ko), names: namesIn(q, a.reply), gates: gatedHere(a.reply || '', b.input, b.messages) };
  // What slipped: a wrong fact the raw reply stated that the shown one still states.
  const slipped = final.wrong.filter((w) => raw.wrong.some((x) => x.what === w.what)).map((w) => w.what);
  const caught = raw.wrong.filter((w) => !final.wrong.some((x) => x.what === w.what)).map((w) => w.what);
  return {
    raw, final, slipped, caught,
    heuristic: heuristicCatches(q, a.raw, q.language || 'en'),
    spanish: q.language === 'es' ? { written: inSpanish(a.reply), digits: (raw.gates.dropped.number || 0) } : null,
  };
}

// ── Statistics ──────────────────────────────────────────────────────────────

const LOG_FACT = [0];
const logFact = (n) => { for (let i = LOG_FACT.length; i <= n; i++) LOG_FACT[i] = LOG_FACT[i - 1] + Math.log(i); return LOG_FACT[n]; };
const logChoose = (n, k) => logFact(n) - logFact(k) - logFact(n - k);
function binomCdf(k, n, p) {
  if (p <= 0) return 1;
  if (p >= 1) return k >= n ? 1 : 0;
  let s = 0;
  for (let i = 0; i <= k; i++) s += Math.exp(logChoose(n, i) + i * Math.log(p) + (n - i) * Math.log(1 - p));
  return Math.min(1, s);
}
/** The p at which k or fewer in n has chance alpha: the exact upper bound. */
function upperBound(k, n, alpha) {
  if (k >= n) return 1;
  let lo = k / n;
  let hi = 1;
  for (let i = 0; i < 80; i++) { const mid = (lo + hi) / 2; if (binomCdf(k, n, mid) > alpha) lo = mid; else hi = mid; }
  return hi;
}
/** The p at which k or more in n has chance alpha: the exact lower bound. */
function lowerBound(k, n, alpha) {
  if (k <= 0) return 0;
  let lo = 0;
  let hi = k / n;
  for (let i = 0; i < 80; i++) { const mid = (lo + hi) / 2; if (1 - binomCdf(k - 1, n, mid) < alpha) lo = mid; else hi = mid; }
  return lo;
}
/** k of n with its exact two sided 95% interval, and the one sided 95% upper bound a zero is judged by. */
const rateOf = (k, n) => (n ? { k, n, rate: k / n, lo: lowerBound(k, n, 0.025), hi: upperBound(k, n, 0.025), upper: upperBound(k, n, 0.05) } : { k, n, rate: null, lo: null, hi: null, upper: null });
const pct = (x) => (x === null || x === undefined ? 'n/a' : `${(x * 100).toFixed(1)}%`);
const rateText = (r) => (r.n ? `${r.k} of ${r.n} (${pct(r.rate)}, 95% ${pct(r.lo)} to ${pct(r.hi)})` : 'none');
function percentile(xs, q) {
  const s = xs.filter(Number.isFinite).slice().sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.max(0, Math.ceil(q * s.length) - 1))] : null;
}
const sum = (xs) => xs.reduce((a, b) => a + b, 0);

// ── One model's answers, summed ─────────────────────────────────────────────

function summarise(answers, byId, read) {
  const calls = answers.filter((a) => a.called && a.score);
  const n = calls.length;
  const person = (a) => (read && read[a.id]) || null;
  const personWrong = (a) => { const r = person(a); return r && Number.isInteger(r.wrong) ? r.wrong : null; };
  const tagged = (side, tag) => calls.filter((a) => a.score[side].wrong.some((w) => w.tag === tag)).length;
  const gateDrops = (side, gate) => sum(calls.map((a) => a.score[side].gates.dropped[gate] || 0));
  const serverSentences = sum(calls.map((a) => a.sentences || 0));
  const serverDropped = sum(calls.map((a) => sum(Object.values(a.dropped || {}).map(Number).filter(Number.isFinite))));
  const premises = calls.filter((a) => byId[a.q] && byId[a.q].premise);
  const spanish = calls.filter((a) => a.score.spanish);
  const costs = calls.map((a) => a.cost).filter(Number.isFinite);
  const wasRead = calls.filter((a) => personWrong(a) !== null);
  const depths = calls.map((a) => (person(a) && Number.isFinite(person(a).depth) ? person(a).depth : null)).filter((d) => d !== null);
  const heur = calls.flatMap((a) => a.score.heuristic);
  const plantedRaw = calls.filter((a) => a.score.raw.names.planted.length).length;
  const nameLog = sum(calls.map((a) => (a.logged && a.logged['name-log']) || 0));
  return {
    answers: n,
    rawWrong: rateOf(calls.filter((a) => a.score.raw.wrong.length).length, n),
    finalWrongKeys: rateOf(calls.filter((a) => a.score.final.wrong.length).length, n),
    finalWrong: rateOf(calls.filter((a) => a.score.final.wrong.length || (personWrong(a) || 0) > 0).length, n),
    personRead: wasRead.length,
    personWrongFacts: wasRead.length ? sum(wasRead.map(personWrong)) : null,
    caught: sum(calls.map((a) => a.score.caught.length)),
    slipped: sum(calls.map((a) => a.score.slipped.length)),
    gatesHere: Object.fromEntries(Object.entries(calls.reduce((acc, a) => {
      for (const [k, v] of Object.entries(a.score.raw.gates.dropped)) acc[k] = (acc[k] || 0) + v;
      return acc;
    }, {})).sort((x, y) => y[1] - x[1])),
    rawSentences: sum(calls.map((a) => a.score.raw.gates.sentences)),
    dropShare: serverSentences ? serverDropped / serverSentences : null,
    retryShare: n ? calls.filter((a) => a.retried).length / n : null,
    honestShare: n ? calls.filter((a) => a.honest).length / n : null,
    namesRaw: sum(calls.map((a) => a.score.raw.names.count)),
    namesShown: sum(calls.map((a) => a.score.final.names.count)),
    plantedRaw,
    plantedShown: calls.filter((a) => a.score.final.names.planted.length).length,
    kitMapRaw: gateDrops('raw', 'ability') + gateDrops('raw', 'map'),
    kitMapShown: gateDrops('final', 'ability') + gateDrops('final', 'map') + tagged('final', 'kit') + tagged('final', 'map'),
    relabelsShown: gateDrops('final', 'label') + tagged('final', 'relabel'),
    economyShown: gateDrops('final', 'economy') + tagged('final', 'economy'),
    metaShown: gateDrops('final', 'meta') + tagged('final', 'meta'),
    relabelsRaw: gateDrops('raw', 'label') + tagged('raw', 'relabel'),
    economyRaw: gateDrops('raw', 'economy') + tagged('raw', 'economy'),
    metaRaw: gateDrops('raw', 'meta') + tagged('raw', 'meta'),
    premises: premises.length,
    premisesCorrected: premises.filter((a) => !a.score.final.missing.length && !a.score.final.wrong.length).length,
    depthMean: depths.length ? sum(depths) / depths.length : null,
    depthMin: depths.length ? Math.min(...depths) : null,
    depthRead: depths.length,
    p50: percentile(calls.map((a) => a.ms), 0.5),
    p90: percentile(calls.map((a) => a.ms), 0.9),
    maxMs: percentile(calls.map((a) => a.ms), 1),
    costMean: costs.length ? sum(costs) / costs.length : null,
    costMax: costs.length ? Math.max(...costs) : null,
    costKnown: costs.length,
    cached: calls.some((a) => a.usage && Number.isFinite(a.usage.cached)) ? sum(calls.map((a) => (a.usage && a.usage.cached) || 0)) : null,
    spanishAnswers: spanish.length,
    spanishWritten: spanish.filter((a) => a.score.spanish.written).length,
    spanishNames: sum(spanish.map((a) => a.score.final.names.count)),
    spanishDigits: sum(spanish.map((a) => a.score.spanish.digits)),
    heuristic: { planted: heur.length, caught: heur.filter(Boolean).length, flagged: nameLog,
      share: serverSentences ? nameLog / serverSentences : null },
  };
}

/** The bars of 8.13 for one model's v2 answers: pass true or false, or null when what it needs was not read. */
function barsOf(s, opts) {
  const o = opts || {};
  const b = (name, pass, value, limit, note) => ({ name, pass, value, limit, note: note || null });
  const bars = [
    b('names', s.namesShown === 0, `${s.namesShown} shown (${s.namesRaw} raw, ${s.plantedRaw} planted raw)`, '0, planted ones included'),
    b('kit, map', s.kitMapShown === 0, `${s.kitMapShown} shown (${s.kitMapRaw} raw)`, '0 foreign abilities and off map callouts'),
    b('raw rate', o.lowestHi === null ? null : s.rawWrong.rate <= o.lowestHi + 1e-12, rateText(s.rawWrong), "the lowest, or inside the lowest's interval"),
    b('relabels', s.relabelsShown === 0, `${s.relabelsShown} shown (${s.relabelsRaw} raw)`, '0'),
    b('economy', s.economyShown === 0, `${s.economyShown} shown (${s.economyRaw} raw)`, '0 before Phase D'),
    b('meta', s.metaShown === 0, `${s.metaShown} shown (${s.metaRaw} raw)`, '0 rankings'),
    b('drops', s.dropShare === null ? null : s.dropShare <= 0.15, pct(s.dropShare), 'at most 15% of sentences'),
    b('retries', s.retryShare === null ? null : s.retryShare <= 0.1, pct(s.retryShare), 'at most 10% of answers'),
    b('honest', s.honestShare === null ? null : s.honestShare <= 0.03, pct(s.honestShare), 'at most 3% of answers'),
    b('latency', s.p90 === null ? null : s.p90 <= 12000 && s.maxMs <= 40000, `p90 ${s.p90} ms, max ${s.maxMs} ms`, 'p90 at most 12 s, none past 40 s'),
    b('cost', s.costKnown ? s.costMean <= 0.03 && s.costMax <= 0.07 : null,
      s.costKnown ? `mean $${s.costMean.toFixed(4)}, max $${s.costMax.toFixed(4)}` : 'not read', 'mean at most $0.03, none over $0.07',
      s.costKnown ? null : 'run with --costs'),
    b('spanish', s.spanishAnswers ? s.spanishWritten === s.spanishAnswers && s.spanishNames === 0 && s.spanishDigits === 0 : null,
      `${s.spanishWritten} of ${s.spanishAnswers} in Spanish, ${s.spanishNames} names, ${s.spanishDigits} invented digits`, 'all in Spanish, 0 names, 0 invented digits'),
    b('depth', s.depthRead ? s.depthMean >= 4 && s.depthMin >= 3 : null,
      s.depthRead ? `mean ${s.depthMean.toFixed(2)}, lowest ${s.depthMin}, ${s.depthRead} read` : 'not read', 'mean at least 4 of 5, none under 3', s.depthRead ? null : 'a person reads the sheet'),
  ];
  if (o.finalist) {
    bars.push(b('person', s.personRead ? s.personRead === s.answers && s.personWrongFacts === 0 : null,
      s.personRead ? `${s.personWrongFacts} wrong facts in ${s.personRead} answers read` : 'not read', "0 in the finalist's final answers (under 3.3% at 95%)",
      s.personRead ? null : 'a person reads the sheet'));
    bars.push(b('premises', s.premises ? s.premisesCorrected === s.premises : null, `${s.premisesCorrected} of ${s.premises}`, 'every false premise corrected'));
  }
  return bars;
}

function printSummary(label, s, bars) {
  console.log(`\n${label}: ${s.answers} answers`);
  console.log(`  wrong facts, raw:      ${rateText(s.rawWrong)}`);
  console.log(`  wrong facts, shown:    ${rateText(s.finalWrong)}${s.personRead ? `, ${s.personRead} read by a person` : ', keys only'}`);
  console.log(`  the gates caught ${s.caught} of the keys' wrong facts and ${s.slipped} slipped past them; dropped here on the raw replies: `
    + `${Object.entries(s.gatesHere).map(([k, v]) => `${k} ${v}`).join(', ') || 'nothing'} of ${s.rawSentences} sentences`);
  console.log(`  dropped ${pct(s.dropShare)} of sentences, asked again ${pct(s.retryShare)}, the honest line ${pct(s.honestShare)}`);
  console.log(`  names ${s.namesShown} shown, ${s.namesRaw} raw; planted names repeated raw in ${s.plantedRaw} answers, shown in ${s.plantedShown}`);
  console.log(`  latency p50 ${s.p50} ms, p90 ${s.p90} ms, max ${s.maxMs} ms; cost ${s.costKnown ? `mean $${s.costMean.toFixed(4)}, max $${s.costMax.toFixed(4)}` : 'not read'}`
    + `; cached tokens ${s.cached === null ? 'not reported' : s.cached}`);
  for (const bar of bars) {
    console.log(`  ${bar.pass === null ? 'n/a ' : bar.pass ? 'PASS' : 'FAIL'}  ${bar.name.padEnd(9)} ${bar.value}, ${bar.limit}${bar.note ? ` (${bar.note})` : ''}`);
  }
}

/** Every model's summary, its bars, the winner, and the name heuristic's verdict. */
function report(run, sheets, read) {
  const byId = Object.fromEntries(sheets.questions.map((q) => [q.id, q]));
  for (const a of run.answers) {
    try {
      a.score = byId[a.q] && run.contexts[a.q] ? scoreAnswer(byId[a.q], a, run.contexts[a.q]) : null;
    } catch (e) {
      console.log(`  ${a.id} could not be scored: ${e.message}`);
      a.score = null;
    }
  }
  const groups = new Map();
  for (const a of run.answers.filter((x) => x.called)) {
    const k = `${a.model}|${a.variant}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(a);
  }
  const sums = [...groups.entries()].map(([k, answers]) => {
    const [model, variant] = k.split('|');
    return { model, variant, s: summarise(answers, byId, read) };
  });
  const v2 = sums.filter((x) => x.variant === 'v2' && x.s.answers);
  const lowest = v2.length ? v2.reduce((m, x) => (x.s.rawWrong.rate < m.s.rawWrong.rate ? x : m)) : null;
  const verdicts = [];
  for (const x of sums) {
    const finalist = run.opts.finalist ? x.model === run.opts.finalist : true;
    const bars = x.variant === 'v2' ? barsOf(x.s, { lowestHi: lowest ? lowest.s.rawWrong.hi : null, finalist }) : [];
    printSummary(`${x.model}, ${x.variant}${x.variant === 'v2-noprimer' ? ' (the control: what the primer buys, not a candidate)' : ''}`, x.s, bars);
    if (x.variant === 'v2') verdicts.push({ model: x.model, pass: bars.every((bb) => bb.pass === true), open: bars.filter((bb) => bb.pass === null).map((bb) => bb.name), cost: x.s.costMean });
  }
  const passing = verdicts.filter((v) => v.pass).sort((p, q) => (p.cost === null ? 1 : q.cost === null ? -1 : p.cost - q.cost));
  console.log('');
  if (passing.length) console.log(`PROMOTE ${passing[0].model}: the cheapest passing every bar.`);
  else {
    const open = verdicts.filter((v) => v.open.length);
    console.log(`Nothing is promoted: no model passed every bar${open.length ? ` (still to read: ${[...new Set(open.flatMap((v) => v.open))].join(', ')})` : ''}.`);
  }
  // The name heuristic turns enforcing at most 2% of sentences flagged, every planted name caught.
  const all = summarise(run.answers.filter((a) => a.called && a.score && a.variant === 'v2'), byId, read);
  const h = all.heuristic;
  // Caught "every planted name" needs one repeated: none repeated measures nothing.
  const enforce = h.share !== null && h.share <= 0.02 && h.planted > 0 && h.caught === h.planted;
  console.log(`The name heuristic flagged ${h.flagged} of the sentences (${pct(h.share)}) and caught ${h.caught} of ${h.planted} planted names repeated: `
    + `${h.share === null ? 'not measured' : enforce ? 'turn it to enforcing'
      : h.planted ? 'keep it in log mode' : 'no reply repeated a planted name, so its catching is unmeasured: keep it in log mode'}.`);
  return { sums, verdicts, passing: passing.map((p) => p.model) };
}

// ── The person's sheet ──────────────────────────────────────────────────────

/** A card's facts as the review card says them, from the context the bench sent. */
function cardLine(card) {
  if (!card) return null;
  const r = card.riot || {};
  const bits = [`R${card.n}${card.side ? ` ${card.side}` : ''}`, card.result || 'no result'];
  if (card.died) bits.push(`died${Number.isFinite(r.sec) ? ` ${r.sec} s in` : ''}${r.killer ? ` to ${r.killer}` : ''}${r.weapon ? ` with ${r.weapon}` : ''}`);
  else if (card.riot) bits.push('survived');
  if (r.firstDeath) bits.push('first death');
  if (r.firstKill) bits.push('first kill');
  if (Number.isFinite(r.kills)) bits.push(`${r.kills} kill${r.kills === 1 ? '' : 's'}`);
  if (r.traded === true) bits.push('traded');
  if (r.traded === false) bits.push('not traded');
  if (r.alive) bits.push(`${r.alive.mates} against ${r.alive.enemies}`);
  if (r.plantSite) bits.push(`planted at ${r.plantSite}`);
  if (card.look) bits.push(`the look: ${card.look.cause || 'its label held back'}${card.look.what ? `, "${card.look.what}"` : ''}`);
  return bits.join(', ');
}

const RUBRIC = 'Depth, 1 to 5, a point each: answers in the first sentence; tells the round in order; names the decision; '
  + 'gives a concrete alternative with its game reason; ends on a drill when asked how to improve (a point for free when not asked).';

function writeSheet(run, sheets, stamp) {
  const byId = Object.fromEntries(sheets.questions.map((q) => [q.id, q]));
  const finalist = run.opts.finalist || (run.plan[0] && run.plan[0].model);
  const shown = run.answers.filter((a) => a.called && a.variant === 'v2' && a.model === finalist);
  const lines = [`bench:chat ${stamp}, ${finalist}, v2: ${shown.length} answers to read.`, '',
    'For each answer write in the read file: wrong, the number of facts it states that the facts beside it contradict',
    "(a planted name repeated counts); depth, 1 to 5; note, anything else. The keys' own findings are printed as a start, not a verdict.", RUBRIC, ''];
  const read = {};
  for (const a of shown) {
    const q = byId[a.q] || {};
    const ctx = run.contexts[a.q] || {};
    // Every round the server told in full, each with its line (built's rounds, kept on the answer).
    const rounds = Array.isArray(a.rounds) && a.rounds.length ? a.rounds : (ctx.ask && ctx.ask.round ? [ctx.ask.round] : []);
    const cards = ctx.match ? rounds.map((n) => (ctx.match.cards || []).find((c) => c.n === n)).filter(Boolean) : [];
    lines.push(`== ${a.id}`);
    lines.push(`Question (${q.match || 'no match'}, ${q.kind || ''}${q.advanced ? ', Advanced coaching on' : ''}): ${q.ask}`);
    if (q.facts) lines.push(`Facts: ${q.facts}`);
    for (const card of cards) lines.push(`Riot's record of the round: ${cardLine(card)}`);
    lines.push('Answer:', a.reply || '(none)');
    if (a.raw && norm(a.raw) !== norm(a.reply)) lines.push('Before the gates:', a.raw);
    const sc = a.score;
    if (sc) lines.push(`Keys: wrong ${sc.final.wrong.map((w) => w.what).join('; ') || 'none'}; missing ${sc.final.missing.join('; ') || 'none'}`);
    lines.push('');
    read[a.id] = { wrong: null, depth: null, note: '' };
  }
  const base = path.join(HERE, 'runs', stamp);
  fs.writeFileSync(`${base}-sheet.txt`, lines.join('\n'));
  fs.writeFileSync(`${base}-read.json`, JSON.stringify(read, null, 1));
  return { sheet: `${base}-sheet.txt`, read: `${base}-read.json` };
}

// ── Live ────────────────────────────────────────────────────────────────────

/** The models the server will bench, from its BENCH_MODELS list, or null when it cannot be read. */
function benchList() {
  try {
    const src = fs.readFileSync(path.join(__dirname, '..', 'server', 'routes', 'coach.js'), 'utf8');
    const block = /const BENCH_MODELS = new Set\(\[([\s\S]*?)\]\);/.exec(src);
    return block ? new Set([...block[1].matchAll(/'([^']+)'/g)].map((m) => m[1])) : null;
  } catch {
    return null;
  }
}

/** ADMIN_PASSWORD from the environment, or from server/.env when it exists. Read only for a live run. */
function adminPassword() {
  const envFile = path.join(__dirname, '..', 'server', '.env');
  if (!process.env.ADMIN_PASSWORD && fs.existsSync(envFile)) {
    try {
      let dotenv;
      try { dotenv = require(path.join(__dirname, '..', 'server', 'node_modules', 'dotenv')); } catch { dotenv = require('dotenv'); }
      dotenv.config({ path: envFile });
    } catch (e) { console.log(`could not read ${envFile}: ${e.message}`); }
  }
  return process.env.ADMIN_PASSWORD || '';
}

/** The bench's spend so far today, from the 'bench' route of /api/admin/costs, or null when unread. */
async function benchSpend(admin) {
  try {
    const resp = await fetch(`${SERVER}/api/admin/costs`, { headers: { 'x-admin-password': admin }, signal: AbortSignal.timeout(15000) });
    if (!resp.ok) return null;
    const j = await resp.json();
    const r = j.spend && j.spend.today && j.spend.today.routes && j.spend.today.routes.bench;
    return r ? { real: r.real || 0, estimated: r.estimated || 0 } : null;
  } catch {
    return null;
  }
}

/** The network a live run asks through: the fill's GET and the question's POST, with the bench's fields. */
function liveNet(key, admin, riotId, cur) {
  const fills = {};
  return {
    key, riotId, fills,
    async get(p, ms) {
      try {
        const resp = await fetch(`${SERVER}${p}`, { headers: { 'x-license-key': key, 'x-occlara-version': VERSION }, signal: AbortSignal.timeout(ms || 30000) });
        const data = await resp.json().catch(() => ({}));
        const m = /[?&]matchId=([^&]+)/.exec(p);
        if (m && resp.ok && data && Array.isArray(data.perRound) && data.perRound.length) fills[decodeURIComponent(m[1])] = data;
        return { ok: resp.ok, status: resp.status, data };
      } catch (e) {
        return { ok: false, status: 0, data: { error: e.message } };
      }
    },
    async post(p, body, ms) {
      cur.sent = body;
      const t0 = Date.now();
      let status = 0;
      let data = {};
      try {
        const resp = await fetch(`${SERVER}${p}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-license-key': key, 'x-admin-password': admin, 'x-occlara-version': VERSION },
          body: JSON.stringify({ ...body, benchModel: cur.model, variant: cur.variant, raw: true }),
          signal: AbortSignal.timeout(ms || 50000),
        });
        status = resp.status;
        data = await resp.json().catch(() => ({}));
      } catch (e) { data = { error: e.message }; }
      cur.last = { status, data, ms: Date.now() - t0 };
      return { ok: status >= 200 && status < 300, status, data };
    },
  };
}

/** The network --dry asks through: nothing leaves, the prompt is built here and a stand in reply comes back. */
function dryNet(cur) {
  return {
    key: null, riotId: null, fills: {},
    async get() { return { ok: false, status: 503, data: { error: 'dry' } }; },
    async post(p, body) {
      cur.sent = body;
      cur.last = { status: 200, data: { reply: 'A dry run sends nothing.', v: 2 }, ms: 0 };
      return { ok: true, status: 200, data: cur.last.data };
    },
  };
}

// ── The run ─────────────────────────────────────────────────────────────────

/** Who answers what: v2 for every model, the finalist's at --finalist-runs; the control for the finalist alone. */
function planOf(o) {
  const models = o.models.length ? o.models : (o.finalist ? [o.finalist] : []);
  const out = [];
  for (const model of models) {
    for (const variant of o.variants) {
      const isFinalist = o.finalist ? model === o.finalist : true;
      if (variant !== 'v2' && !isFinalist) continue;
      out.push({ model, variant, runs: variant === 'v2' && o.finalist && model === o.finalist ? o.finalistRuns : o.runs });
    }
  }
  return out;
}

/** The matches each library has, its Ask Coach, and the key each review id is known by. */
function setUp(sheets, cur, net) {
  // The player's library whatever their sheet: the repo's Split is asked of it where it is there.
  const player = playerLibrary(sheets.player || { matches: {} });
  const repo = repoLibrary(sheets.repo, player);
  const libs = { repo: { ...repo, coach: coachOf(repo.lib, cur, net) }, player: { ...player, coach: coachOf(player.lib, cur, net) } };
  const keyOf = {};
  for (const l of Object.values(libs)) for (const [k, id] of Object.entries(l.ids)) keyOf[id] = k;
  return { libs, keyOf, problems: player ? player.problems : [] };
}

/** One question asked and what came back, as the run keeps it. */
async function ask(q, libs, keyOf, cur, plan) {
  // The library that holds the question's match, whichever sheet the question is in.
  const l = (q.match && Object.values(libs).find((x) => x.ids[q.match])) || libs[q.library];
  const reviewId = q.match ? l.ids[q.match] : null;
  cur.q = q;
  cur.model = plan ? plan.model : null;
  cur.variant = plan ? plan.variant : 'v2';
  const { out } = await askOne(l.coach, q, reviewId, cur);
  const rec = { q: q.id, model: cur.model, variant: cur.variant, called: false };
  if (out.which) return { ...rec, which: out.which.map, matchKey: out.match ? keyOf[out.match.id] || null : null };
  if (out.none) return { ...rec, none: out.none.map, matchKey: out.match ? keyOf[out.match.id] || null : null };
  const sent = cur.sent;
  const matchId = sent && sent.context && sent.context.match ? sent.context.match.id : null;
  rec.matchKey = matchId ? keyOf[matchId] || `other:${matchId}` : null;
  rec.moved = !!out.moved;
  if (!sent) return { ...rec, error: out.error || 'nothing was sent' };
  const b = built(sent, cur.variant);
  rec.round = b.round || null;
  rec.rounds = b.rounds;
  rec.inFull = b.inFull;
  rec.prompt = { chars: b.chars, hash: b.hash };
  rec.messages = sent.messages;
  rec.context = sent.context;
  const last = cur.last || {};
  const d = last.data || {};
  rec.called = !!(plan && last.status);
  rec.status = last.status || null;
  rec.ms = last.ms || null;
  rec.reply = typeof d.reply === 'string' ? d.reply : null;
  rec.raw = typeof d.raw === 'string' ? d.raw : null;
  rec.rawRetry = typeof d.rawRetry === 'string' ? d.rawRetry : null;
  rec.honest = !!d.honest;
  rec.retried = !!d.retried;
  rec.dropped = d.dropped && typeof d.dropped === 'object' ? d.dropped : {};
  rec.logged = d.logged && typeof d.logged === 'object' ? d.logged : {};
  rec.sentences = Number.isInteger(d.sentences) ? d.sentences : 0;
  rec.served = { v: d.v || null, model: d.model || null, variant: d.variant || null };
  const u = d.usage && typeof d.usage === 'object' ? d.usage : null;
  rec.usage = u ? { prompt: u.prompt ?? u.prompt_tokens ?? null, completion: u.completion ?? u.completion_tokens ?? null, cached: u.cached ?? u.cached_tokens ?? null } : null;
  if (!out.ok) rec.error = out.error || `status ${last.status}`;
  return rec;
}

/** What the sheet says a question must land on, against where it landed. */
function expectProblems(q, rec) {
  const e = q.expect || {};
  const out = [];
  if (e.which !== undefined) {
    if (rec.which !== e.which) out.push(`expected to ask which ${e.which}, got ${rec.which || rec.none || rec.matchKey}`);
    return out;
  }
  if (rec.which || rec.none) { out.push(`expected an answer, got a question about ${rec.which || rec.none}`); return out; }
  if (e.match !== undefined && (rec.matchKey || null) !== e.match) out.push(`answered on ${rec.matchKey || 'no match'}, expected ${e.match || 'no match'}`);
  if (e.moved !== undefined && !!rec.moved !== !!e.moved) out.push(`moved ${!!rec.moved}, expected ${!!e.moved}`);
  if (e.round !== undefined && (rec.round || null) !== e.round) out.push(`asked round ${rec.round || 'none'}, expected ${e.round}`);
  return out;
}

/** The scorer held to canned answers: each wrong fact found, and the gates here catch a planted name. */
function selfTest(sheets, contexts) {
  const byId = Object.fromEntries(sheets.questions.map((q) => [q.id, q]));
  const out = [];
  const canned = [
    ['split-r10-planted', 'Varkalen is right that you baited him in round 10. Your death was not traded.', ['repeats the planted name', 'says the death was not traded']],
    ['split-r5-premise', 'You lost round 5 because you died first to Phoenix with a Phantom.', ['accepts the loss']],
    ['pearl-r5-look', 'You dealt 104 damage before Cypher killed you with a Classic, and your death was traded.', ['changes the 105 damage']],
    ['abyss-r13-why', 'You got the first kill, then Viper killed you with a Ghost 17 seconds in, and nobody traded you.', []],
    // The keys' misfires of 15 Oct, each a true sentence of the run: a refusal,
    // the plant's time, the counted list quoted, a teammate of this match.
    ['split-meta', "I can't tell you whether Jett is the best agent for Split from these facts.", []],
    ['split-r15-hash', 'The spike went down at A at 28 s in, and their Phoenix killed your last teammate at 33 s in.', []],
    ['split-r20-walk', 'While this was a great multi kill round, your largest counted mistake across the match was dying where nobody could trade 14 times.', []],
    ['sidebar-fracture', 'Astra then killed your KAY/O, and Phoenix killed your Clove.', []],
  ];
  for (const [id, text, wrong] of canned) {
    const q = byId[id];
    if (!q || !contexts[id]) continue;
    const got = keyed(q, text, keyOpts(contexts[id])).wrong.map((w) => w.what);
    if (JSON.stringify(got) !== JSON.stringify(wrong)) out.push(`the keys of ${id} on "${text}" found [${got.join('; ')}], expected [${wrong.join('; ')}]`);
  }
  const q = byId['split-r10-planted'];
  if (q && contexts[q.id]) {
    const b = built({ messages: [{ role: 'user', content: q.ask }], context: contexts[q.id] }, 'v2');
    const g = gatedHere('Varkalen is right about round 10. Your death was traded by a teammate within five seconds.', b.input, b.messages);
    if (!g.dropped.name) out.push(`the gates here kept a sentence repeating the planted name: ${JSON.stringify(g.dropped)}`);
    const n = namesIn(q, 'Varkalen is right.');
    if (n.planted.length !== 1) out.push('a planted name in a reply was not counted');
  }
  return out;
}

function printQuestion(q, rec, problems) {
  const landed = rec.which ? `asks which ${rec.which} (no model call)` : rec.none ? `says no ${rec.none} match (no model call)`
    : `${rec.matchKey || 'no match'}${rec.moved ? ' (moved)' : ''}${rec.round ? `, ${(rec.rounds || []).length > 1 ? `rounds ${rec.rounds.join(', ')}` : `round ${rec.round}`}${rec.inFull ? ' in full' : ''}` : ''}`
      + `${rec.prompt ? `, prompt ${rec.prompt.chars.toLocaleString('en')} chars` : ''}`;
  console.log(`  ${problems.length ? 'FAIL' : 'ok  '}  ${q.id.padEnd(22)} ${String(q.open).padEnd(7)} ${landed}${problems.length ? `: ${problems.join('; ')}` : ''}`);
}

async function main() {
  if (OPTS.score) return rescore();
  if (OPTS.variants.some((v) => !VARIANTS.has(v))) { console.log(`--variants are v2 and v2-noprimer, not ${OPTS.variants.join(',')}`); return 1; }
  if (!(OPTS.budget > 0)) { console.log('--budget is the dollars the run may spend, more than 0'); return 1; }
  if (OPTS.finalist && OPTS.models.length && !OPTS.models.includes(OPTS.finalist)) { console.log(`--finalist ${OPTS.finalist} is not among --models`); return 1; }

  const sheets = loadSheets(OPTS);
  if (sheets.missing) console.log(`The player's sheet: ${sheets.missing}. Only the repo's questions are asked.`);
  const plan = planOf(OPTS);
  const questions = sheets.questions.filter((q) => !OPTS.only.length || OPTS.only.includes(q.id));
  const modelQuestions = questions.filter((q) => !(q.expect && q.expect.which !== undefined));
  const calls = sum(plan.map((p) => p.runs)) * modelQuestions.length;
  const estimate = sum(plan.map((p) => p.runs * modelQuestions.length * estimateOf(p.model)));
  console.log(`bench:chat: ${questions.length} questions (${modelQuestions.length} for a model), `
    + `${plan.map((p) => `${p.model} ${p.variant} x${p.runs}`).join(', ') || 'no model named'}: `
    + `${calls} answers, about $${estimate.toFixed(2)}, stopped at $${OPTS.budget.toFixed(2)}, ${OPTS.gapMs / 1000} s apart.`);
  if (sheets.problems.length) {
    console.log('The sheets cannot be asked:');
    for (const p of sheets.problems) console.log(`  ${p}`);
    return 1;
  }

  if (OPTS.dry) return dryRun(sheets, questions, plan);

  // ── Live: everything checked before the first dollar ──
  if (!plan.length) { console.log('Name the models: --models a,b,c (and --finalist one of them).'); return 1; }
  const listed = benchList();
  const off = plan.map((p) => p.model).filter((m) => listed && !listed.has(m));
  if (off.length) { console.log(`${[...new Set(off)].join(', ')} not on the server's BENCH_MODELS list, so the server would answer on its own model.`); return 1; }
  const admin = adminPassword();
  if (!admin) { console.log('bench:chat needs ADMIN_PASSWORD: the server honours benchModel, the variant and raw only beside it.'); return 1; }
  const cfg = readJson(configPath(ROOT));
  const riotId = String(cfg.riotId || '').trim();
  const connected = riotId.includes('#') && String(cfg.riotConnected || '').trim().toLowerCase() === riotId.toLowerCase() ? riotId : null;
  const cur = {};
  const net = liveNet(cfg.licenseKey, admin, connected, cur);
  const { libs, keyOf, problems } = setUp(sheets, cur, net);
  if (problems.length) { for (const p of problems) console.log(p); return 1; }

  // The fill, once a match, as 8.10 fills it, before any question.
  if (libs.player) {
    if (!connected) console.log("No Riot ID is connected, so the player's matches go unfilled: no feed, no plant time, no comps.");
    for (const [key, id] of Object.entries(libs.player.ids)) {
      if (!connected) break;
      let how = null;
      for (let i = 0; i < 3; i++) {
        how = await libs.player.coach.fill(id);
        if (how !== 'retry' && how !== 'unreachable') break;
        await new Promise((r) => setTimeout(r, 10000));
      }
      console.log(`  fill ${key}: ${how}`);
    }
    fs.mkdirSync(path.join(HERE, 'fills'), { recursive: true });
    for (const [matchId, data] of Object.entries(net.fills)) {
      fs.writeFileSync(path.join(HERE, 'fills', `${matchId.replace(/[^A-Za-z0-9-]/g, '_')}.json`), JSON.stringify({ ...data, at: Date.now() }));
    }
  }

  const run = { at: new Date().toISOString(), server: SERVER, opts: OPTS, plan, spent: 0, stopped: null, contexts: {}, answers: [] };
  const checked = new Set();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const maxRuns = Math.max(...plan.map((p) => p.runs));
  outer:
  for (let r = 1; r <= maxRuns; r++) {
    for (const p of plan.filter((x) => x.runs >= r)) {
      for (const q of questions) {
        const est = estimateOf(p.model);
        const det = q.expect && q.expect.which !== undefined;
        if (!det && run.spent + est > OPTS.budget) { run.stopped = `the budget: $${run.spent.toFixed(4)} spent, the next answer would pass $${OPTS.budget.toFixed(2)}`; break outer; }
        const before = OPTS.costs && !det ? await benchSpend(admin) : null;
        const rec = await ask(q, libs, keyOf, cur, p);
        const after = OPTS.costs && rec.called ? await benchSpend(admin) : null;
        rec.run = r;
        rec.id = `${p.model}|${p.variant}|${r}|${q.id}`;
        rec.cost = before && after ? Math.max(0, (after.real + after.estimated) - (before.real + before.estimated)) : null;
        if (rec.context) { run.contexts[q.id] = rec.context; delete rec.context; }
        run.answers.push(rec);
        if (rec.called) run.spent += Math.max(rec.cost || 0, est);
        const exp = expectProblems(q, rec);
        console.log(`  run ${r} ${p.model} ${p.variant} ${q.id.padEnd(22)} ${rec.which ? `which ${rec.which}` : `${rec.status || '-'} ${rec.ms || 0} ms`}`
          + `${rec.cost !== null && rec.cost !== undefined ? ` $${rec.cost.toFixed(4)}` : ''}${rec.retried ? ' asked again' : ''}${rec.honest ? ' honest line' : ''}`
          + `${rec.error ? ` ERROR ${rec.error}` : ''}${exp.length ? ` LANDED WRONG: ${exp.join('; ')}` : ''}`);
        if (rec.called && !checked.has(`${p.model}|${p.variant}`)) {
          checked.add(`${p.model}|${p.variant}`);
          const why = rec.status !== 200 ? `the server answered ${rec.status}: ${rec.error || ''}`
            : rec.served.v !== 2 ? 'the server did not answer with v2: is chat-prompt.js deployed, and is the admin password right?'
              : rec.served.model !== p.model ? `the server answered on ${rec.served.model || 'its live model'}, not ${p.model}`
                : rec.served.variant !== p.variant ? `the server answered with prompt ${rec.served.variant || 'none'}, not ${p.variant}`
                  : rec.raw === null ? 'the server sent no raw reply (raw: true), and bench:chat scores raw replies' : null;
          if (why) { run.stopped = why; break outer; }
        }
        if (rec.called || rec.error) await sleep(OPTS.gapMs);
      }
    }
  }
  const stamp = run.at.replace(/[:.]/g, '-');
  fs.mkdirSync(path.join(HERE, 'runs'), { recursive: true });
  const verdict = report(run, sheets, null);
  const out = path.join(HERE, 'runs', `${stamp}.json`);
  fs.writeFileSync(out, JSON.stringify({ ...run, answers: run.answers.map(({ score, ...a }) => a), verdict }, null, 1));
  const sheet = writeSheet(run, sheets, stamp);
  console.log(`\n$${run.spent.toFixed(4)} spent${OPTS.costs ? '' : " (estimated: run with --costs for the ledger's)"}${run.stopped ? `; stopped by ${run.stopped}` : ''}.`);
  console.log(`Written to ${out}\nThe person's sheet: ${sheet.sheet}\nTheir read, to fill: ${sheet.read}\nThen: npm run bench:chat -- --score ${out} --read ${sheet.read}`);
  return run.stopped ? 1 : 0;
}

/** --dry: every key's samples, every question asked of the real client code, its prompt built here. Nothing leaves, nothing is written. */
async function dryRun(sheets, questions, plan) {
  const cur = {};
  const { libs, keyOf, problems } = setUp(sheets, cur, dryNet(cur));
  for (const p of problems) console.log(`  ${p}`);
  const where = Object.entries(libs.repo.from).map(([k, w]) => `${k} ${w === 'player' ? "from the player's library" : 'built offline'}`).join(', ');
  console.log(`\nThe repo's matches: ${where}. The player's library: ${Object.keys(libs.player.ids).length} of its `
    + `${libs.player.lib.list('valorant').length} asked about, ${libs.player.filled} filled from an earlier run's record.`);
  console.log('\nEach question, asked of Ask Coach as the page asks it:');
  let bad = problems.length;
  const contexts = {};
  for (const q of questions) {
    if (!libs[q.library]) { console.log(`  skip  ${q.id}: no ${q.library} library`); continue; }
    const rec = await ask(q, libs, keyOf, cur, null);
    if (rec.context) contexts[q.id] = rec.context;
    const exp = expectProblems(q, rec);
    if (rec.error && !rec.which && !rec.none) exp.push(rec.error);
    // A marker of another match must be no agent this match has.
    if (rec.context) exp.push(...markerClashes(q, rec.context));
    printQuestion(q, rec, exp);
    bad += exp.length ? 1 : 0;
  }
  const self = selfTest(sheets, contexts);
  console.log(`\nThe scorer on canned answers: ${self.length ? self.join('; ') : 'every wrong fact found, and the gates here drop a planted name'}.`);
  bad += self.length;
  if (plan.length) {
    const listed = benchList();
    const off = plan.map((p) => p.model).filter((m) => listed && !listed.has(m));
    if (off.length) { console.log(`Not on the server's BENCH_MODELS list: ${[...new Set(off)].join(', ')}.`); bad++; }
  }
  console.log(`\n--dry: nothing sent, nothing read of the licence or the password, nothing written.${bad ? ` ${bad} problem${bad === 1 ? '' : 's'}.` : ''}`);
  return bad ? 1 : 0;
}

/** --score: a saved run scored again with today's keys, and the person's read folded in. No network. */
function rescore() {
  let run = null;
  try { run = readJson(OPTS.score); } catch (e) { console.log(`cannot read ${OPTS.score}: ${e.message}`); return 1; }
  let read = null;
  if (OPTS.read) {
    try { read = readJson(OPTS.read); } catch (e) { console.log(`cannot read ${OPTS.read}: ${e.message}`); return 1; }
  }
  const sheets = loadSheets({ ...OPTS, sheet: OPTS.sheet });
  if (sheets.problems.length) { for (const p of sheets.problems) console.log(`  ${p}`); return 1; }
  console.log(`bench:chat run of ${run.at}, ${run.answers.length} answers${read ? `, read by a person for ${Object.values(read).filter((x) => x && Number.isInteger(x.wrong)).length}` : ''}.`);
  report(run, sheets, read);
  return 0;
}

if (require.main === module) {
  main().then((code) => process.exit(code || 0), (e) => { console.error(e && e.stack ? e.stack : e); process.exit(1); });
}

// The parts, for a run scored on stand in answers.
module.exports = { compileCheck, loadSheets, keyed, keyOpts, roundText, ownAgents, markerClashes, MATCH_COUNT, NOT_A_CLAIM, CLAUSE_SPLIT,
  namesIn, inSpanish, rateOf, upperBound, lowerBound, planOf, expectProblems, serverMessages, built, gatedHere,
  setUp, ask, dryNet, scoreAnswer, summarise, barsOf, report, writeSheet, OPTS };

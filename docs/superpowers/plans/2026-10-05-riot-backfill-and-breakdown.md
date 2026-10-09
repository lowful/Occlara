# Riot backfill, onboarding Riot ID step, and Matches breakdown: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Grade a player's recent Valorant matches from Riot's record when they connect a Riot ID (in onboarding, with Skip, and in Settings), and add a per map and per agent breakdown to the Matches library, counted only from saved reviews.

**Architecture:** A new server route lists the recent matches; a main process service (`backfill.js`) plans, fetches Riot's round record one match at a time, builds reviews with a pure builder (`riot-review.js`) and saves them through the existing library. A pure module (`breakdown.js`) cuts every saved review of a game by map and agent; Matches paints it. Onboarding, Settings and Matches listen to one pushed status.

**Tech Stack:** Electron main, preload and renderer (vanilla HTML, CSS and JS, no build step), Node tests run with plain `node scripts/<file>.js`, Express server on Railway.

**Spec:** `docs/superpowers/specs/2026-10-05-riot-backfill-and-breakdown-design.md`

## Global Constraints

- No em dashes and no en dashes anywhere: code, comments, UI copy, tests, docs. Use commas. In code that must match one, write `\u2014` or `\u2013`.
- Never write a regex through a shell heredoc. Create and edit files with the Write and Edit tools only. Every new regex gets a test against a known positive string.
- Renderers: plain DOM, no framework, no build step, no `innerHTML`, text through `textContent` only. Colours, radii, easings and durations come from `src/renderer/shared/theme.css` tokens. No decorative gradients. Geist weights 400 to 800 only, Geist Mono (`var(--font-mono)`) for columns of digits. A grade's colour is never its only signal: its number and letter are always beside it.
- IPC channel names exist only in `src/shared/channels.js`. Never hand type a channel string.
- Nothing may reach the screen during a match. The backfill waits while `matchInProgress()` is true.
- Match the surrounding comment style: comments explain why, and the load-bearing decision opens in capitals, as the existing files do.
- Agents do NOT commit, do NOT bump the version, do NOT run `npm run release`, and do NOT edit files outside their task's file list. The lead commits after review.
- Electron from this shell needs `env -u ELECTRON_RUN_AS_NODE` (the boot check scripts already strip it themselves).
- Run each test you touch with `node scripts/<file>.js`. `npm test` runs every check (several boot Electron, a few minutes).
- The new npm scripts (`test:riotreview`, `test:backfill`, `test:breakdown`, `check:onboardingriot`) are added to `package.json` by the lead before the tasks start.

## File map

```
server/routes/coach.js                 + GET /api/coach/recent-matches                      (Task 1)
server/services/riot-rounds.js         + startedAt, lengthMs in parse()                      (Task 1)
scripts/test-tracker-routes.js         + the route and the two fields                        (Task 1)

src/shared/agent-roles.js              NEW roleOf(agent), case insensitive                   (Task 2)
src/shared/valorant-review.js          cards carry structured facts, source 'riot', ledgerOf (Task 2)
src/main/services/review-store.js      metaOf keeps source                                   (Task 2)
scripts/test-valorant-review.js        + new card fields, Riot only review, ledgerOf         (Task 2)

src/shared/riot-review.js              NEW fromRiot, upgradeWatched, ledgerRows, ...         (Task 3)
scripts/test-riot-review.js            NEW                                                   (Task 3)

src/main/services/backfill.js          NEW Backfill, plan, windowOf, queueOk                 (Task 4)
scripts/test-backfill.js               NEW                                                   (Task 4)

src/shared/breakdown.js                NEW build(game, saved, opts)                          (Task 5)
scripts/test-breakdown.js              NEW                                                   (Task 5)

src/shared/channels.js                 + BREAKDOWN_GET, BACKFILL_START, BACKFILL_STATUS, PUSH_BACKFILL (Task 6)
src/main/ipc/register-ipc.js           + three handlers                                      (Task 6)
src/main/index.js                      backfill instance, testTracker, controller, caches   (Task 6)
src/preload/matches-preload.js         + getBreakdown, startBackfill, getBackfill, onBackfill (Task 6)
src/preload/settings-preload.js        + getBackfill, onBackfill, openMatches                (Task 6)
src/preload/onboarding-preload.js      + testTracker, getBackfill, onBackfill                (Task 6)

src/renderer/matches/*                 Breakdown section, grade recent matches, row source  (Task 7)
scripts/check-matches-window.js        + breakdown assertions                                (Task 7)

src/renderer/onboarding/*              Riot ID page with Connect and Skip, progress rows    (Task 8)
src/renderer/settings/*                backfill status line                                  (Task 8)
src/renderer/review/review.js          "From Riot's record" in the meta line                 (Task 8)
scripts/check-onboarding-riot.js       NEW boot check                                        (Task 8)
```

Execution order: Tasks 1 and 2 in parallel; then 3 followed by 4, in parallel with 5; then 6; then 7 and 8 in parallel.

---

### Task 1: The recent-matches route, and Riot's start and length

**Files:**
- Modify: `server/routes/coach.js` (add the route directly after the `/last-match` route, which ends near line 2815)
- Modify: `server/services/riot-rounds.js` (the object `parse()` returns, near line 218)
- Test: `scripts/test-tracker-routes.js`

**Interfaces:**
- Produces: `GET /api/coach/recent-matches?username=Name%23TAG` answering `200 { matches: Row[] }` (newest first, at most 10, round based only, deduplicated by `matchId`), `200 { error }` for what will not change (`'Account not found.'`, `'Riot ID must be Name#TAG.'`, `'No stats provider configured.'`, a refused list), `503 { error, retry: true }` for what will pass. `Row` is exactly `lastMatchRow(m)`: `{ matchId, map, mode, agent, result, score, kills, deaths, assists, kd, acs, adr, headshotPct, grade, startedAt }`.
- Produces: `/api/coach/match-rounds` replies gain `startedAt` (ms or null) and `lengthMs` (ms or null).

- [ ] **Step 1: Write the failing tests.** In `scripts/test-tracker-routes.js`, insert this block immediately before the line `  // ── every tracker call can time out ──────────────────────────────────────`:

```js
  // ── /recent-matches: the matches Connect grades from Riot's record ──────
  regionCache.clear();
  calls.length = 0;
  henrik.account = async () => ({ status: 200, json: { data: { region: 'eu' } } });
  henrik.stored = async (u) => {
    if (/[?&]page=2\b/.test(u)) {
      return { status: 200, json: { data: [row('p2a', 'Competitive', 13, 7, 400), row('c3', 'Unrated', 13, 9, 30)] } };
    }
    return { status: 200, json: { data: [
      row('dm1', 'Deathmatch', null, null, 1), row('c1', 'Competitive', 13, 11, 10),
      row('dm2', 'Deathmatch', null, null, 50), row('c2', 'Swiftplay', 5, 3, 20),
      row('c3', 'Unrated', 13, 9, 30), row('dm3', 'Deathmatch', null, null, 60),
      row('dm4', 'Deathmatch', null, null, 70), row('dm5', 'Deathmatch', null, null, 80),
      row('dm6', 'Deathmatch', null, null, 90), row('dm7', 'Deathmatch', null, null, 95),
    ] } };
  };
  ok(/[?&]page=2\b/.test('/x?size=10&page=2') && !/[?&]page=2\b/.test('/x?size=10&page=20'),
    'the second page pattern matches page 2 and only page 2');
  {
    const r = await call(coach, 'GET', `/recent-matches?username=${ME}`, { headers: H });
    const ids = (r.body.matches || []).map((m) => m.matchId);
    ok(r.status === 200 && ids.join() === 'c1,c2,c3,p2a',
      `round based matches only, newest first, once each across both pages (${ids.join()})`);
    ok(count('stored') === 2 && calls.some((u) => /[?&]page=2\b/.test(u)),
      'a full first page crowded by deathmatches asks for a second one');
    const c1 = (r.body.matches || [])[0] || {};
    ok(c1.result === 'Victory' && c1.score === '13-11' && c1.acs > 0 && c1.mode === 'Competitive' && c1.startedAt > 0,
      'each row is the row /last-match builds');
  }
  {
    calls.length = 0;
    const r = await call(coach, 'GET', `/recent-matches?username=${ME}`, { headers: H });
    ok(r.status === 200 && calls.length === 0 && (r.body.matches || []).length === 4,
      'asked again within two minutes, the list comes from memory');
  }
  henrik.stored = async () => ({ status: 429, json: {} });
  {
    const r = await call(coach, 'GET', `/recent-matches?username=${encodeURIComponent('Other#EUW')}`, { headers: H });
    ok(r.status === 503 && r.body.retry === true, `a rate limit is a 503 to retry, never an empty list (${r.status})`);
  }
  regionCache.clear();
  henrik.account = async () => ({ status: 404, json: {} });
  {
    const r = await call(coach, 'GET', `/recent-matches?username=${encodeURIComponent('Nobody#000')}`, { headers: H });
    ok(r.status === 200 && /not found/i.test(r.body.error || ''), 'an account that does not exist is a plain answer');
  }
  {
    const r = await call(coach, 'GET', '/recent-matches?username=nohash', { headers: H });
    ok(r.status === 200 && /Name#TAG/.test(r.body.error || ''), 'a malformed Riot ID is refused');
  }
  henrik.account = async () => ({ status: 200, json: { data: { region: 'eu' } } });

  // ── Riot's start and length come back with the rounds ───────────────────
  henrik.match = async () => ({ status: 200, json: { data: {
    ...V4, metadata: { ...V4.metadata, started_at: '2026-09-20T18:00:00.000Z', game_length_in_ms: 2400000 },
  } } });
  {
    const r = await call(coach, 'GET', `/match-rounds?matchId=m-started&username=${ME}`, { headers: H });
    ok(r.body.startedAt === Date.parse('2026-09-20T18:00:00.000Z') && r.body.lengthMs === 2400000,
      `Riot's start and length come back with the rounds (${r.body.startedAt}, ${r.body.lengthMs})`);
  }
  henrik.match = async () => ({ status: 200, json: { data: V4 } });
  {
    const r = await call(coach, 'GET', `/match-rounds?matchId=m-unstarted&username=${ME}`, { headers: H });
    ok(r.body.startedAt === null && r.body.lengthMs === null, 'and are null when Riot leaves them out');
  }
```

- [ ] **Step 2: Run it and watch it fail.** Run: `node scripts/test-tracker-routes.js`. Expected: the new checks FAIL (the route answers 404 through `call()`, the two fields are undefined).

- [ ] **Step 3: Add the two fields to `riot-rounds.js`.** Above `function parse(` add:

```js
/** When Riot says the match started, in ms, or null. */
function startedAtOf(d) {
  const m = (d && d.metadata) || {};
  const t = m.started_at ? Date.parse(m.started_at)
    : (typeof m.game_start === 'number' ? m.game_start * 1000 : NaN);
  return Number.isFinite(t) ? t : null;
}

/** How long the match ran, in ms, or null. */
function lengthOf(d) {
  const m = (d && d.metadata) || {};
  return typeof m.game_length_in_ms === 'number' && m.game_length_in_ms > 0 ? m.game_length_in_ms : null;
}
```

and in the object `parse()` returns, after `result: ...,`:

```js
    // When the match started and how long it ran, so a match graded after the
    // fact is filed where it was played (src/shared/riot-review.js).
    startedAt: startedAtOf(d),
    lengthMs: lengthOf(d),
```

- [ ] **Step 4: Add the route to `coach.js`** directly after the closing `});` of `router.get('/last-match', ...)`:

```js
// GET /api/coach/recent-matches?username=Name%23TAG
// The player's last matches with rounds, newest first, as the rows /last-match
// builds. When a Riot ID is connected, the client grades the ones it has never
// seen from Riot's record (src/main/services/backfill.js), so a new player's
// library, patterns and baseline are not empty on day one.
//
// ONE STORED-MATCHES CALL, and a second page only when deathmatches crowd the
// first: a player who warms up in deathmatch every session can have most of
// page one taken by it. Cached two minutes per Riot ID, because Connect can be
// pressed twice and every player shares one key. A failure that will pass is a
// 503 { error, retry: true }, exactly as /match-rounds answers one; what will
// not change on a retry is a 200 { error }.
const recentMatchesCache = new Map();
const RECENT_MATCHES_TTL_MS = 2 * 60 * 1000;
const RECENT_MATCHES_MAX = 10;
router.get('/recent-matches', async (req, res) => {
  const licenseKey = String(req.headers['x-license-key'] || '').trim().toUpperCase();
  if (!await admit(res, licenseKey)) return;
  if (!process.env.HENRIKDEV_API_KEY) return res.json({ error: 'No stats provider configured.' });

  const username = String(req.query.username || '');
  if (!username.includes('#')) return res.json({ error: 'Riot ID must be Name#TAG.' });
  const [name, tag] = username.split('#').map((s) => s.trim());
  const key = username.toLowerCase();
  const hit = recentMatchesCache.get(key);
  if (hit && Date.now() - hit.at < RECENT_MATCHES_TTL_MS) return res.json({ matches: hit.rows, cached: true });

  const enc = encodeURIComponent;
  const retry = (error) => res.status(503).json({ error, retry: true });
  try {
    const acct = await regionOf(name, tag);
    if (!acct.region) {
      if (!upstreamTransient(acct.status)) return res.json({ error: 'Account not found.' });
      return retry(acct.status === 429 ? 'Tracker rate limit, try again shortly.' : 'Could not resolve the account region.');
    }
    const base = `/valorant/v1/stored-matches/${acct.region}/${enc(name)}/${enc(tag)}?size=10`;
    const first = await henrikGet(base).catch(() => ({ status: 0, ok: false, json: null }));
    if (!first.ok) {
      if (upstreamTransient(first.status)) {
        return retry(first.status === 429 ? 'Tracker rate limit, try again shortly.' : 'The tracker could not list the matches yet.');
      }
      return res.json({ error: `The tracker refused the match list (status ${first.status}).` });
    }
    const page1 = Array.isArray(first.json && first.json.data) ? first.json.data : [];
    let rows = page1.filter((x) => x && x.stats && roundBased(x));
    if (rows.length < RECENT_MATCHES_MAX && page1.length >= 10) {
      const second = await henrikGet(`${base}&page=2`).catch(() => null);
      const page2 = second && second.ok && Array.isArray(second.json && second.json.data) ? second.json.data : [];
      rows = rows.concat(page2.filter((x) => x && x.stats && roundBased(x)));
    }
    const seen = new Set();
    rows = rows.filter((m) => {
      const id = m.meta && m.meta.id;
      if (!id || seen.has(id)) return false;
      seen.add(id);
      return true;
    });
    rows.sort((a, b) => (Date.parse(b.meta?.started_at || 0) || 0) - (Date.parse(a.meta?.started_at || 0) || 0));
    const out = rows.slice(0, RECENT_MATCHES_MAX).map(lastMatchRow);
    cacheSet(recentMatchesCache, key, { at: Date.now(), rows: out }, 500);
    res.json({ matches: out });
  } catch (e) {
    console.error('[coach] recent-matches failed:', e.message);
    retry('Recent match lookup failed.');
  }
});
```

`lastMatchRow`, `roundBased`, `regionOf`, `henrikGet`, `upstreamTransient`, `cacheSet` and `admit` already exist in this file; `lastMatchRow` and `roundBased` are function declarations, so the route may sit above them.

- [ ] **Step 5: Run the tests.** Run: `node scripts/test-tracker-routes.js`, `node scripts/check-server-boot.js`. Expected: all PASS.

---

### Task 2: Review cards carry structured facts; Riot only reviews; the ledger

**Files:**
- Create: `src/shared/agent-roles.js`
- Modify: `src/shared/valorant-review.js` (`roundFacts`, `build`, a new `ledgerOf`, exports)
- Modify: `src/main/services/review-store.js` (`metaOf`)
- Test: `scripts/test-valorant-review.js`

**Interfaces:**
- Produces `roleOf(agent) -> 'Duelist'|'Initiator'|'Controller'|'Sentinel'|null` from `src/shared/agent-roles.js`.
- Produces in every built Valorant review: `source: 'watched' | 'riot'`; each card gains `sideKey: 'attacking'|'defending'|null`, `verified: boolean`, `watched: boolean`, `spot: string|null`, `ultReady: boolean`, `riot: null | { sec, killer, weapon, firstDeath, firstKill, kills, traded, trades, clutch: {vs, won}|null, alive: {mates, enemies}|null, afterPlant }`.
- `build(input)` accepts `input.source === 'riot'`: then `watched: null`, no "Not watched by the coach" fact, `refused` is exactly one line containing "did not watch", `verification` is a line containing "Riot's record".
- Produces `ledgerOf(snap) -> { startedAt, endedAt, endedBy, context: { agent, agentConfirmed, map, teamScore, enemyScore, gameMode }, rounds: [{ n, side, result, died, deathSpot, deathClock, early, ultAtDeath, ultSeen, planted, plantSpot, locs, frames, reads: [{ text, death }] }] } | null`, exported from `valorant-review.js`.
- `metaOf()` rows gain `source: string|null`.

- [ ] **Step 1: Write the failing tests.** In `scripts/test-valorant-review.js` add `const verify = require('../src/shared/valorant-verify');` and `const { metaOf } = require('../src/main/services/review-store');` and `const { roleOf } = require('../src/shared/agent-roles');` beside the other requires (skip any already there), then insert this block immediately before the final `console.log(` summary line:

```js
// ── 8.0.3: cards carry what the breakdown counts, a Riot only review, the ledger ──
{
  const played = replay(load('valorant-match-abyss-13-11.json').frames, 'standard');
  const riotRec = load('riot-abyss-13-11.json');
  const { rounds: vr } = verify.reconcile(played.rounds, riotRec);
  const built = review.build({ rounds: vr, context: played.context, endedBy: 'score', ai: {}, role: 'Duelist',
    history: [], riotMe: riotRec.me, queue: riotRec.queue });
  const c6 = built.rounds.find((c) => c.n === 6);
  ok(c6.sideKey === 'defending' && c6.verified === true && c6.watched === true,
    'a card says its side, that Riot checked it, and that the coach watched it');
  ok(c6.riot && c6.riot.killer === 'Skye' && c6.riot.traded === false && c6.riot.afterPlant === true,
    "and carries Riot's facts for the round");
  ok(built.rounds.filter((c) => c.riot && c.riot.firstKill).length === 8, 'eight first kills, as Riot has them');
  ok(built.rounds.every((c) => c.spot === null || c.died), 'a death spot only on a round with a death');
  ok(built.rounds.some((c) => c.spot), 'and the screen keeps its locations where Riot confirms the death');
  ok(built.source === 'watched', 'a recorded review says so');

  const tracker = { matchId: 'm', map: 'Abyss', agent: 'Jett', result: 'Victory', score: '13-11', kills: 31, deaths: 21,
    assists: 4, kd: 1.48, acs: 382, adr: 243, headshotPct: 25 };
  const only = review.build({ rounds: verify.reconcile([], riotRec).rounds,
    context: { agent: 'Jett', map: 'Abyss', teamScore: 13, enemyScore: 11 }, endedBy: 'score', ai: {}, tracker,
    role: 'Duelist', history: [], riotMe: riotRec.me, queue: 'unrated', riotIdSet: true, source: 'riot' });
  ok(only.source === 'riot' && only.watched === null, 'a Riot only review claims no rounds watched');
  ok(only.rounds.length === 24 && only.rounds.every((c) => !c.facts.includes('Not watched by the coach')),
    'and does not print "Not watched" on every round');
  ok(only.rounds.every((c) => c.watched === false && c.verified === true), 'every card is Riot checked and unwatched');
  ok(only.refused.length === 1 && /did not watch/.test(only.refused[0]), 'one line says what the coach could not see');
  ok(/Riot's record/.test(only.verification || ''), "the verification line says it was graded from Riot's record");
  ok(only.grade && typeof only.grade.score === 'number', `and it is graded (${only.grade && only.grade.score})`);
  ok(only.game.mode === 'Unrated' && only.halftimeAfter === 12, 'with the queue Riot names and its halftime');

  const ledger = review.ledgerOf({ ...played, startedAt: 1000, endedAt: 2000 });
  ok(ledger && ledger.rounds.length === played.rounds.length && ledger.startedAt === 1000 && ledger.endedAt === 2000
    && ledger.endedBy === played.endedBy, 'the ledger keeps the window, how it ended, and every round');
  ok(ledger.rounds.every((r) => Array.isArray(r.reads) && r.reads.every((x) => typeof x.text === 'string'
    && typeof x.death === 'boolean')), 'with reads reconcile() can check');
  const again = verify.reconcile(ledger.rounds, riotRec);
  const live = verify.reconcile(played.rounds, riotRec);
  ok(again.checks.watched === live.checks.watched && again.checks.agreed === live.checks.agreed
    && again.checks.invented.join() === live.checks.invented.join(), 'and reconciles exactly as the live ledger does');
  ok(review.ledgerOf(null) === null, 'no snapshot, no ledger');

  ok(metaOf('valorant-1-abcd', 'valorant', { source: 'riot' }, 1).source === 'riot'
    && metaOf('valorant-1-abcd', 'valorant', {}, 1).source === null, 'the library row keeps where a review came from');
  ok(roleOf('Jett') === 'Duelist' && roleOf('jett') === 'Duelist' && roleOf('KAY/O') === 'Initiator' && roleOf('Nobody') === null,
    'roles are read case insensitively from the generated agent data');
}
```

- [ ] **Step 2: Run it and watch it fail.** Run: `node scripts/test-valorant-review.js`. Expected: FAIL, `agent-roles` not found.

- [ ] **Step 3: Create `src/shared/agent-roles.js`:**

```js
'use strict';

/**
 * An agent's role, for code under src/shared, which cannot reach
 * src/main/services/agent-data.js. Read from the same generated agent data,
 * and case insensitive, because Riot's record and the screen do not always
 * agree on how a name is cased.
 */

let ROLES = new Map();
try {
  const d = require('./valorant-data.generated.json');
  ROLES = new Map(Object.entries(d.agents || {}).map(([name, a]) => [name.toLowerCase(), (a && a.role) || null]));
} catch {
  ROLES = new Map();
}

function roleOf(agent) {
  return agent ? ROLES.get(String(agent).trim().toLowerCase()) || null : null;
}

module.exports = { roleOf };
```

- [ ] **Step 4: Change `valorant-review.js`.**

4a. `roundFacts(r)` becomes `roundFacts(r, opts)`, and its line `if (r.watched === false) facts.push('Not watched by the coach');` becomes:

```js
    // A review built from Riot's record alone was watched in no round, and
    // saying so on every card says nothing the header has not.
    if (r.watched === false && !(opts && opts.riotOnly)) facts.push('Not watched by the coach');
```

4b. In `build(input)`, after `const whys = ai.rounds || {};` add:

```js
  // A match the coach never watched, graded from Riot's record after the fact
  // (riot-review.js). It claims nothing only the screen could have seen.
  const riotOnly = input.source === 'riot';
```

4c. Replace the `const cards = rounds.map((r) => ({ ... }));` object with:

```js
  const cards = rounds.map((r) => ({
    n: r.n,
    side: sideLabel(r.side),
    // The side as Riot or the ledger names it, and the facts below as fields:
    // the label and the sentences are for reading, these are for counting
    // (breakdown.js). A card saved before these existed is read back from its
    // fact sentences instead.
    sideKey: r.side === 'attacking' || r.side === 'defending' ? r.side : null,
    result: r.result,
    died: r.died,
    early: !!r.early,
    planted: r.planted,
    verified: !!r.verified,
    watched: !riotOnly && r.watched !== false,
    // Where the screen placed the death. Riot records no locations.
    spot: r.died && r.deathSpot ? r.deathSpot : null,
    ultReady: !!(r.died && r.ultAtDeath === 'ready'),
    riot: r.verified ? {
      sec: typeof r.deathSec === 'number' ? r.deathSec : null,
      killer: r.killerAgent || null,
      weapon: r.weapon || null,
      firstDeath: !!r.firstDeath,
      firstKill: !!r.firstKill,
      kills: typeof r.kills === 'number' ? r.kills : null,
      traded: typeof r.traded === 'boolean' ? r.traded : null,
      trades: typeof r.trades === 'number' ? r.trades : null,
      clutch: r.clutch && typeof r.clutch.vs === 'number'
        ? { vs: r.clutch.vs, won: typeof r.clutch.won === 'boolean' ? r.clutch.won : null } : null,
      alive: r.aliveAtDeath && typeof r.aliveAtDeath.mates === 'number'
        ? { mates: r.aliveAtDeath.mates, enemies: r.aliveAtDeath.enemies } : null,
      afterPlant: !!r.afterPlant,
    } : null,
    facts: roundFacts(r, { riotOnly }),
    reads: r.reads.map((x) => x.text),
    why: typeof whys[r.n] === 'string' && whys[r.n] ? whys[r.n] : null,
    // The coach's look at the frame before the death, when it took one.
    forensics: r.forensics && r.forensics.cause ? {
      cause: r.forensics.cause, what: r.forensics.what || null, better: r.forensics.better || null,
      // The kept frame names; the library stores the images beside the review.
      frames: Array.isArray(r.forensics.frames) ? r.forensics.frames.slice(0, 2) : [],
    } : null,
  }));
```

4d. Replace the `refused` construction (from `const refused = isVerified` down to the end of the `if (!tracker && !isVerified) { ... }` block) with:

```js
  const refused = riotOnly
    ? ['The coach did not watch this match, so it has no death locations, no ultimate reads and no look at '
      + 'your deaths. Record your next match for the full review.']
    : isVerified
      ? ['Riot records when you died and to whom, not where. Death locations are read off the screen.']
      : ['Kills, damage and who won each fight are not printed on the HUD in a way the coach can read, '
        + 'so a round card says what was seen, not how the duel went.'];
  // STOPPED PARTWAY, SAID ONLY WHERE IT IS TRUE. From the screen alone a match
  // stopped halfway and one stopped on its end screen look the same, so the
  // line says only what is known: the coach never saw the end. Riot's record
  // knows, because its rounds after the last one watched are the match going
  // on, and it fills those in, so the old "this covers the rounds the coach
  // watched" was false the moment it linked.
  if (!riotOnly && !isVerified && input.endedBy === 'stop') {
    refused.push('Coaching was stopped before the coach saw the match end, so this covers the rounds it watched.');
  }
  // The next match began before this one was seen ending (a remake, an unrated
  // 13 to 12 with no menu read), so nothing on screen says how it ended.
  if (!riotOnly && !isVerified && input.endedBy === 'next-match') {
    refused.push('The next match started before the coach saw this one end, so this covers the rounds it watched.');
  }
  if (!riotOnly && isVerified && unseen.length) {
    const lastSeen = seen.reduce((a, r) => Math.max(a, r.n), 0);
    const stoppedEarly = input.endedBy === 'stop' && unseen.some((n) => n > lastSeen);
    refused.push(`${stoppedEarly ? 'Coaching was stopped before the match ended. ' : ''}`
      + `Riot's record fills in ${spans(unseen)}, which the coach did not watch, `
      + `so ${unseen.length === 1 ? 'that round has' : 'those rounds have'} no location or coach's read.`);
  }
  if (!riotOnly && !tracker && !isVerified) {
    refused.push(input.linkMissing === 'taken'
      ? "Riot's record of this match is already on another review in your library, so it is not repeated here."
      : input.linkMissing
      ? "Riot's record of this match was not found, so there is no scoreboard. "
        + 'A match played on another account than the Riot ID in Settings never links.'
      : input.riotIdSet
        ? 'The scoreboard comes from Riot once the match is published, and fills in here a few minutes after the match.'
        : 'The scoreboard comes from Riot once the match is published. '
          + 'Add your Riot ID in Settings, and it fills in here a few minutes after the match.');
  }
```

(Keep the existing comment block that sits above the `seen` and `unseen` lines unchanged.)

4e. In the returned object, change `watched: { ... },` to:

```js
    watched: riotOnly ? null : {
      rounds: seen.length,
      deaths,
      decided: decided.length,
      survival: seen.length ? pct(seen.length - deaths, seen.length) : null,
    },
```

change `verification: input.verification || null,` to:

```js
    verification: riotOnly
      ? "Graded from Riot's record of the match. The coach did not watch it, so everything here is what Riot records."
      : input.verification || null,
```

and add, right after `kind: 'valorant',`:

```js
    // Recorded and reviewed, or graded from Riot's record after the fact.
    source: riotOnly ? 'riot' : 'watched',
```

4f. Add, after the `historyEntry` function:

```js
/**
 * What a review needs to be checked against Riot's record later: the screen's
 * rounds as reconcile() reads them, and the window and context the match link
 * checks. Kept only while a review is unverified (index.js), so a Riot ID
 * added after the link gave up can still grade the match (backfill.js).
 * Reads are trimmed to the fields reconcile() uses; a location trail to eight.
 */
function ledgerOf(snap) {
  if (!snap || !Array.isArray(snap.rounds)) return null;
  const c = snap.context || {};
  return {
    startedAt: typeof snap.startedAt === 'number' ? snap.startedAt : null,
    endedAt: typeof snap.endedAt === 'number' ? snap.endedAt : null,
    endedBy: snap.endedBy || null,
    context: {
      agent: c.agent || null,
      agentConfirmed: !!c.agentConfirmed,
      map: c.map || null,
      teamScore: typeof c.teamScore === 'number' ? c.teamScore : null,
      enemyScore: typeof c.enemyScore === 'number' ? c.enemyScore : null,
      gameMode: c.gameMode || null,
    },
    rounds: snap.rounds.map((r) => ({
      n: r.n,
      side: r.side || null,
      result: r.result || null,
      died: !!r.died,
      deathSpot: r.deathSpot || null,
      deathClock: typeof r.deathClock === 'number' ? r.deathClock : null,
      early: !!r.early,
      ultAtDeath: r.ultAtDeath || null,
      ultSeen: r.ultSeen === undefined ? null : r.ultSeen,
      planted: !!r.planted,
      plantSpot: r.plantSpot || null,
      locs: Array.isArray(r.locs) ? r.locs.slice(0, 8) : [],
      frames: typeof r.frames === 'number' ? r.frames : 0,
      reads: (Array.isArray(r.reads) ? r.reads : []).slice(0, 12)
        .map((x) => ({ text: String((x && x.text) || ''), death: !!(x && x.death) })),
    })),
  };
}
```

and add `ledgerOf` to `module.exports`.

- [ ] **Step 5: `review-store.js` `metaOf`.** After `stoppedLive: !!r.stoppedLive,` add:

```js
    // 'riot' when it was graded from Riot's record of a match the coach never
    // watched, so the list can say so (backfill.js).
    source: r.source || null,
```

- [ ] **Step 6: Run the tests.** Run: `node scripts/test-valorant-review.js`, `node scripts/test-grade.js`, `node scripts/test-review-replay.js`, `node scripts/test-match-lifecycle.js`. Expected: all PASS. If an existing assertion compared a whole card or a whole `refused` list, update it only where the new fields legitimately change it, and say so in your report.

---

### Task 3: Reviews built from Riot's record

**Files:**
- Create: `src/shared/riot-review.js`
- Test: `scripts/test-riot-review.js`

**Interfaces:**
- Consumes (Task 2): `valorantReview.build(input)` with `input.source`, `valorantReview.ledgerOf`, card fields, `roleOf` from `./agent-roles`; `verify.reconcile(rows, riot) -> { rounds, checks }`, `verify.describe(checks)`.
- Produces:
  - `fromRiot({ row, riot, history, account }) -> { review, role, tracker }`. `review` has no `id`; `review.at` is the estimated end; `review.source === 'riot'`; `review.matchId`, `review.matchStartedAt`, `review.account` set.
  - `upgradeWatched({ saved: { id, at, review }, row, riot, history, account }) -> { review, role, tracker }`, keeping `saved.id` and `saved.at`, `lateLinked: true`.
  - `ledgerRows(review) -> { rows, legacy }`
  - `historyBefore(history, startedAt) -> rows` (oldest first, strictly before)
  - `trackerOf(row, riot)`, `endOf(row, riot)`, `ROUND_MS`.

- [ ] **Step 1: Write the failing test `scripts/test-riot-review.js`:**

```js
'use strict';

/**
 * Reviews built from Riot's record: a match the coach never watched, and a
 * watched one that never linked, checked after the fact. On the real Abyss
 * record and its real ledger.
 *
 * Run: npm run test:riotreview
 */

const { replay, load } = require('./fixtures/replay-match');
const verify = require('../src/shared/valorant-verify');
const grade = require('../src/shared/grade');
const valorantReview = require('../src/shared/valorant-review');
const riotReview = require('../src/shared/riot-review');

let fails = 0;
let checks = 0;
const ok = (cond, what) => {
  checks++;
  if (!cond) { fails++; console.log(`FAIL  ${what}`); } else console.log(`ok    ${what}`);
};

const riot = load('riot-abyss-13-11.json');
const played = replay(load('valorant-match-abyss-13-11.json').frames, 'standard');
const T0 = Date.parse('2026-09-20T18:00:00Z');
const HOUR = 3600000;
const ROW = { matchId: 'abyss-1', map: 'Abyss', agent: 'Jett', mode: 'Unrated', result: 'Victory', score: '13-11',
  kills: 31, deaths: 21, assists: 4, kd: 1.48, acs: 382, adr: 243, headshotPct: 25, startedAt: T0 };
const strip = (rv) => {
  const old = JSON.parse(JSON.stringify(rv));
  delete old.ledger;
  delete old.source;
  for (const c of old.rounds) {
    delete c.sideKey; delete c.spot; delete c.ultReady; delete c.riot; delete c.verified; delete c.watched;
  }
  return old;
};

// ── A match the coach never watched ─────────────────────────────────────────
{
  const { review: r, role, tracker } = riotReview.fromRiot({ row: ROW, riot, history: [], account: 'Me#EUW' });
  ok(role === 'Duelist', `Jett is graded as a Duelist (${role})`);
  ok(r.kind === 'valorant' && r.source === 'riot' && r.account === 'Me#EUW' && r.matchId === 'abyss-1',
    'a Riot only review, linked, with the account it came from');
  ok(r.game.agent === 'Jett' && r.game.map === 'Abyss' && r.game.mode === 'Unrated' && r.game.result === 'Victory'
    && r.game.score === '13-11', 'agent, map, queue, result and score are Riot\'s');
  ok(r.verified === true && r.watched === null && r.rounds.length === 24, 'every round is Riot\'s and none is claimed as watched');
  ok(r.rounds.every((c) => c.watched === false && c.spot === null && c.riot), 'no card has a location or claims the coach saw it');
  ok(r.rounds.filter((c) => c.died).length === 21, '21 deaths, as Riot has them');
  const direct = grade.valorant({ rounds: verify.reconcile([], riot).rounds, scoreline: r.scoreline, role: 'Duelist',
    history: [], totalRounds: 24, riotIdSet: true });
  ok(r.grade.score === direct.score && typeof r.grade.score === 'number',
    `graded exactly as grade.js grades Riot's rounds (${r.grade.score} ${r.grade.letter})`);
  ok(!r.grade.provisional, "with Riot's kill feed every category is measured");
  ok((r.insights.mistakes || []).some((m) => m.key === 'untraded'), 'the untraded deaths are a repeated mistake');
  ok(r.at === T0 + 24 * riotReview.ROUND_MS && r.matchStartedAt === T0,
    'with no length from Riot, it ends 100 seconds a round after it started');
  ok(r.summary === null && r.aiUnavailable === false && r.narrativePending === false && r.thin === false,
    'no model was asked, and the window does not say one failed');
  ok(tracker.acs === 382 && tracker.matchId === 'abyss-1' && tracker.agent === 'Jett', 'the tracker row is the listed one');
  const timed = riotReview.fromRiot({ row: ROW, riot: { ...riot, startedAt: T0 + 5000, lengthMs: 1800000 }, history: [] }).review;
  ok(timed.at === T0 + 5000 + 1800000 && timed.matchStartedAt === T0 + 5000, "Riot's own start and length win when it has them");
}

// ── Measured against the matches before it, never after ─────────────────────
{
  const mk = (at, acs) => ({ at, agent: 'Jett', role: 'Duelist', map: 'Bind', result: 'Victory', acs, adr: 150, kd: 1, headshotPct: 20 });
  const before = [1, 2, 3].map((i) => mk(T0 - i * HOUR, 300));
  const after = [1, 2].map((i) => mk(T0 + i * HOUR, 100));
  const kept = riotReview.historyBefore([...after, ...before], T0);
  ok(kept.length === 3 && kept.every((h, i) => !i || kept[i - 1].at < h.at), 'historyBefore keeps the earlier rows, oldest first');
  const r = riotReview.fromRiot({ row: ROW, riot, history: [...after, ...before] }).review;
  const acs = (r.against || []).find((a) => a.label === 'ACS');
  ok(acs && acs.baseline === 300 && acs.games === 3, `against the three matches before it (${acs && acs.baseline})`);
}

// ── The ledger a review keeps, and the one rebuilt from an older review ─────
{
  const snap = { ...played, startedAt: T0 - 60000, endedAt: T0 + 24 * riotReview.ROUND_MS + 60000 };
  const built = valorantReview.build({ rounds: played.rounds, context: played.context, endedBy: 'score',
    ai: { summary: 'You held A long well.' }, role: 'Duelist', history: [] });
  built.ledger = valorantReview.ledgerOf(snap);
  const fresh = riotReview.ledgerRows(built);
  ok(!fresh.legacy && fresh.rows.length === played.rounds.length, 'a review saved since 8.0.3 gives its ledger back');
  const rebuilt = riotReview.ledgerRows(strip(built));
  ok(rebuilt.legacy && rebuilt.rows.length === built.rounds.length, 'an older one is rebuilt from its cards');
  const spots = (rows) => rows.filter((x) => x.died && x.deathSpot).map((x) => `${x.n}:${x.deathSpot}`).join(',');
  ok(spots(rebuilt.rows) === spots(fresh.rows), `with every death location its cards printed (${spots(rebuilt.rows)})`);
  const sides = (rows) => rows.map((x) => x.side || '-').join(',');
  ok(sides(rebuilt.rows) === sides(fresh.rows), 'and every side');
  ok(rebuilt.rows.every((x) => x.reads.every((y) => y.death === false)), 'its reads cannot say they were about a death');
}

// ── A watched match that never linked, checked now ──────────────────────────
{
  const snap = { ...played, startedAt: T0 - 60000, endedAt: T0 + 24 * riotReview.ROUND_MS + 60000 };
  const built = valorantReview.build({ rounds: played.rounds, context: played.context, endedBy: 'score',
    ai: { summary: 'You held A long well.', focus: 'Trade more.' }, role: 'Duelist', history: [] });
  built.ledger = valorantReview.ledgerOf(snap);
  built.id = 'valorant-1758391200000-abcdef';
  built.at = snap.endedAt;
  const screenDeaths = built.rounds.filter((c) => c.died).length;
  const { review: up } = riotReview.upgradeWatched({ saved: { id: built.id, at: built.at, review: built }, row: ROW, riot,
    history: [], account: 'Me#EUW' });
  ok(up.id === built.id && up.at === built.at, 'it keeps its id and its place in the library');
  ok(up.verified && up.matchId === 'abyss-1' && up.lateLinked === true && up.source === 'watched',
    "it is linked and checked against Riot's record, and is still a recorded match");
  ok(up.rounds.filter((c) => c.died).length === 21, `Riot's 21 deaths replace the screen's ${screenDeaths}`);
  ok(up.summary === null && up.focus === null, 'the read written from the old facts is taken down');
  ok(up.refused.some((l) => /taken down/.test(l)), 'and the review says so');
  ok(/Checked against Riot's record/.test(up.verification || ''), 'with the usual line saying what the check changed');
  ok(up.rounds.some((c) => c.spot), 'it keeps the screen\'s death locations where Riot confirms the death');
  ok(!up.ledger, 'and a verified review carries no ledger');

  // The same review saved before the ledger existed, with a read in a round
  // the screen invented a death in and one in a round both agree on.
  const old = strip(built);
  const riotDied = (n) => !!(riot.perRound.find((p) => p.n === n) || {}).died;
  const invented = old.rounds.find((c) => c.died && !riotDied(c.n));
  const agreed = old.rounds.find((c) => c.died && riotDied(c.n));
  ok(!!invented && !!agreed, `the real ledger has an invented death (round ${invented && invented.n}) and an agreed one`);
  invented.reads = ['You went down on the spike.'];
  agreed.reads = ['Holding the long angle.'];
  const { review: up2 } = riotReview.upgradeWatched({ saved: { id: old.id, at: old.at, review: old }, row: ROW, riot, history: [] });
  ok(up2.verified && up2.rounds.filter((c) => c.died).length === 21, 'an older review upgrades the same way');
  ok(up2.rounds.find((c) => c.n === invented.n).reads.length === 0,
    'in a round where Riot says the screen invented the death, its reads are dropped');
  ok(up2.rounds.find((c) => c.n === agreed.n).reads.includes('Holding the long angle.'),
    'where Riot agrees, they stay');
}

console.log(`\n${fails ? fails + ' of ' + checks + ' failed' : 'all ' + checks + ' riot review checks passed'}`);
process.exit(fails ? 1 : 0);
```

- [ ] **Step 2: Run it and watch it fail.** Run: `node scripts/test-riot-review.js`. Expected: FAIL, module not found.

- [ ] **Step 3: Create `src/shared/riot-review.js`:**

```js
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
 *                   no ultimate read, no look at a death. It says so.
 *   upgradeWatched  a match the coach DID watch, saved before it could link (no
 *                   Riot ID yet, or the link gave up). The same reconcile the
 *                   end of a match runs, over the ledger the review kept, so it
 *                   keeps its locations and reads where Riot agrees.
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
  // was said about a moment that did not happen.
  if (legacy) for (const r of rounds) if (r.watched && r.screenDied !== r.died) r.reads = [];
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
  return { review, role, tracker };
}

module.exports = { fromRiot, upgradeWatched, ledgerRows, historyBefore, trackerOf, endOf, roleOf, ROUND_MS };
```

- [ ] **Step 4: Run the tests.** Run: `node scripts/test-riot-review.js`. Expected: PASS. If `played.context` lacks `map` or `agent`, set them in the test's `built` (`context: { ...played.context, map: 'Abyss', agent: 'Jett' }`) rather than changing the module.

---

### Task 4: The backfill service

**Files:**
- Create: `src/main/services/backfill.js`
- Test: `scripts/test-backfill.js`

**Interfaces:**
- Consumes (Task 3): `riotReview.fromRiot`, `riotReview.upgradeWatched`; (Task 2) `valorantReview.historyEntry`, `valorantReview.ledgerOf`, `BASELINE_GAMES`; `verifyCoachedMatch`, `ROUND_MS` from `./match-link`; `newId` from `./review-store`.
- Produces: `class Backfill` with `start(account) -> status`, `cancel()`, `getStatus() -> status`, and `promise` (the running run, for tests). `plan(rows, library, active)`, `windowOf(entry)`, `queueOk(mode)`, constants `GAP_MS = 3000`, `RETRY_MS = [30000, 60000]`, `MAX_MATCHES = 10`.
- `deps` (constructor): `get(path, timeoutMs) -> Promise<{ ok, status, data }>`, `library() -> [{ meta, review|null }]`, `activeIds() -> Set<id>`, `save(review)`, `history: { get(), set(rows) }`, `inMatch() -> boolean`, `onStatus(status)`, `notice(text)`, `sleep(ms) -> Promise`, `now() -> ms`, `log(...)`.
- Status: `{ state: 'idle'|'listing'|'waiting'|'grading'|'done'|'error', account, found, have, skipped, total, done, graded, upgraded, failed, items: [{ matchId, map, agent, mode, result, score, startedAt, status: 'pending'|'graded'|'upgraded'|'failed'|'have', id, grade: { score, letter, provisional }|null }], error: null|'not-found'|'unreachable'|'licence'|'failed', message }`. Items are newest first.

- [ ] **Step 1: Write the failing test `scripts/test-backfill.js`:**

```js
'use strict';

/**
 * Grading recent matches from Riot's record, against a fake server and a real
 * review store in a temp folder: the order, the baselines, never twice, the
 * old server, the pacing, the wait while a match is played, retries, cancel,
 * and what the status says.
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
const { ReviewStore, newId } = require('../src/main/services/review-store');
const { Backfill, plan, windowOf, queueOk, GAP_MS } = require('../src/main/services/backfill');

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
      review: !meta.matchId && meta.source !== 'riot' ? ((store.get(meta.id) || {}).review || null) : null,
    })),
    activeIds: () => h.active,
    save: (review) => {
      if (h.inMatchNow) h.savedInMatch++;
      store.save({ id: review.id, game: 'valorant', at: review.at, review });
    },
    history: { get: () => h.history, set: (rows) => { h.history = rows; } },
    inMatch: () => { h.inMatchNow = !!inMatch(h); return h.inMatchNow; },
    onStatus: (s) => h.statuses.push(s),
    notice: (t) => h.notices.push(t),
    sleep: async (ms) => { h.clock += ms; h.slept += ms; },
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
    h.done();
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
    watched(h.store, T0 + 1 * HOUR - 60000, { matchId: 'a' });
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
    ok(s.total === 0 && s.skipped === 1 && h.store.list('valorant').length === 2 && !h.rounds().length,
      'a match two recordings could both be is left alone');
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
    let reads = 0;
    // Free for the list, in a match from the first round record on, free again after.
    const h = harness({ rows: [row('a', 1)], inMatch: () => { reads++; return reads >= 3 && reads <= 5; } });
    await h.run();
    ok(h.savedInMatch === 0 && h.store.list('valorant').length === 1, 'and saves nothing while one is in progress');
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

  console.log(`\n${fails ? fails + ' of ' + checks + ' failed' : 'all ' + checks + ' backfill checks passed'}`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log('FAIL  the test crashed:', e.stack || e.message); process.exit(1); });
```

- [ ] **Step 2: Run it and watch it fail.** Run: `node scripts/test-backfill.js`. Expected: FAIL, module not found.

- [ ] **Step 3: Create `src/main/services/backfill.js`:**

```js
'use strict';

/**
 * Grade the player's recent matches from Riot's record, the moment a Riot ID
 * is connected.
 *
 * A new player's library was empty until they had recorded two matches, and
 * the patterns and the grade's own role baseline with it. Riot keeps a record
 * of every match they have played, so Connect now grades the last ten in the
 * queues the grade is built for, oldest first, each against the matches before
 * it, and the next match they record is graded against their own baseline from
 * the start.
 *
 * NEVER TWICE. Every match is planned before anything is fetched (plan()): one
 * already in the library is skipped, one a recording is still linking is left
 * to that recording, one a recording watched but never linked is checked
 * against Riot's record in place, and one two reviews could both be is skipped
 * rather than guessed. A duplicate is a match counted twice in every pattern.
 *
 * GENTLE ON THE ONE KEY. Every player shares one HenrikDev key, so requests
 * are three seconds apart, a failure that will pass is retried twice, and three
 * failed matches in a row end the run. It waits while a match is being played:
 * the reader's two reads in flight need the bandwidth more than a match from
 * last week does, and nothing new reaches a window mid match.
 *
 * No model is called (riot-review.js says why). Plain Node with every
 * dependency injected, so test-backfill.js drives it against a fake server.
 */

const { verifyCoachedMatch, ROUND_MS } = require('./match-link');
const { newId } = require('./review-store');
const riotReview = require('../../shared/riot-review');
const valorantReview = require('../../shared/valorant-review');

const MAX_MATCHES = 10;
const GAP_MS = 3000;
const RETRY_MS = [30000, 60000];
const WAIT_MS = 5000;
const MAX_FAILS_IN_A_ROW = 3;
// The queues the grade's curves were set against. The others have no rounds,
// or are played on rules the curves know nothing about.
const QUEUES = new Set(['competitive', 'unrated', 'swiftplay', 'premier']);
const SCORE_RE = /^\s*(\d+)\s*-\s*(\d+)\s*$/;

const queueOk = (mode) => QUEUES.has(String(mode || '').toLowerCase().replace(/[^a-z]/g, ''));
const sameAccount = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

function idle() {
  return { state: 'idle', account: null, found: 0, have: 0, skipped: 0, total: 0, done: 0,
    graded: 0, upgraded: 0, failed: 0, items: [], error: null, message: null };
}

/** The window, map, agent and score a saved review would be linked with. */
function windowOf(entry) {
  const r = (entry && entry.review) || {};
  const l = r.ledger || null;
  const lc = (l && l.context) || {};
  const g = r.game || {};
  const endedAt = (l && l.endedAt) || entry.meta.at;
  const watchedRounds = r.watched && typeof r.watched.rounds === 'number'
    ? r.watched.rounds : (Array.isArray(r.rounds) ? r.rounds.length : 0);
  const startedAt = (l && l.startedAt) || endedAt - (watchedRounds + 2) * ROUND_MS;
  const m = SCORE_RE.exec(String(g.score || ''));
  const team = typeof lc.teamScore === 'number' ? lc.teamScore : m ? Number(m[1]) : 0;
  const enemy = typeof lc.enemyScore === 'number' ? lc.enemyScore : m ? Number(m[2]) : 0;
  return {
    startedAt,
    endedAt,
    mctx: {
      map: lc.map || g.map || null,
      // Only an agent the player confirmed, the rule linkRiotRecord keeps. A
      // review saved before the ledger existed cannot say, so it offers none.
      agent: l && lc.agentConfirmed ? lc.agent || null : null,
      score: { team, enemy, final: ((l && l.endedBy) || r.endedBy) === 'score' },
    },
  };
}

/**
 * What to do with each listed match, before any round record is fetched.
 *
 * @param rows     the listed matches
 * @param library  [{ meta, review }]: every saved Valorant review's index row,
 *                 with the whole review for the ones not linked to Riot
 * @param active   Set of review ids whose own link is still running
 * @returns [{ row, action, savedId }], action one of
 *          'have' | 'pending' | 'upgrade' | 'ambiguous' | 'new'
 */
function plan(rows, library, active) {
  const lib = Array.isArray(library) ? library : [];
  const linked = new Set(lib.map((e) => e && e.meta && e.meta.matchId).filter(Boolean));
  const open = lib.filter((e) => e && e.meta && !e.meta.matchId && e.meta.source !== 'riot'
    && e.review && e.review.kind === 'valorant' && !e.review.verified);
  const fitsOf = new Map();
  const rowsOf = new Map();
  rows.forEach((row, i) => {
    if (linked.has(row.matchId)) return;
    for (const e of open) {
      const w = windowOf(e);
      if (!verifyCoachedMatch(row, w.startedAt, w.endedAt, w.mctx).ok) continue;
      fitsOf.set(i, [...(fitsOf.get(i) || []), e]);
      rowsOf.set(e.meta.id, [...(rowsOf.get(e.meta.id) || []), i]);
    }
  });
  return rows.map((row, i) => {
    if (linked.has(row.matchId)) return { row, action: 'have' };
    const fits = fitsOf.get(i) || [];
    if (fits.some((e) => active && active.has(e.meta.id))) return { row, action: 'pending' };
    if (fits.length === 1 && (rowsOf.get(fits[0].meta.id) || []).length === 1) {
      return { row, action: 'upgrade', savedId: fits[0].meta.id };
    }
    if (fits.length) return { row, action: 'ambiguous' };
    return { row, action: 'new' };
  });
}

function itemOf(row, status) {
  return {
    matchId: row.matchId, map: row.map || null, agent: row.agent || null, mode: row.mode || null,
    result: row.result || null, score: row.score || null, startedAt: row.startedAt || null,
    status, id: null, grade: null,
  };
}

/** Why the list could not be had, in words a player can act on. */
function whyNot(res) {
  const err = String((res && res.data && res.data.error) || '');
  if (res && (res.status === 401 || res.status === 403 || res.status === 402)) {
    return { error: 'licence', message: 'Your licence could not be checked, so nothing was graded. Try again in a minute.' };
  }
  if (/not found|Name#TAG/i.test(err)) {
    return { error: 'not-found', message: 'Riot has no account under that ID. Check the name and the tag.' };
  }
  return { error: 'unreachable', message: "Riot's record could not be reached. Try again in a few minutes from Matches." };
}

/** The closing line of a run. */
function summary(s, stopped) {
  const n = s.graded + s.upgraded;
  const parts = [];
  if (n) parts.push(`Graded ${plural(n, 'recent match', 'recent matches')} from Riot's record.`);
  else parts.push(stopped ? "Riot's record could not be reached, so nothing was graded." : 'There was nothing new to grade.');
  if (s.have) parts.push(`${plural(s.have, 'was', 'were')} already in your library.`);
  if (s.failed) parts.push(`${plural(s.failed, 'match', 'matches')} could not be fetched.`);
  if (stopped && n) parts.push('Riot stopped answering, so the rest can be graded later from Matches.');
  return parts.join(' ');
}

class Backfill {
  constructor(deps) {
    this.deps = deps;
    this.status = idle();
    this.running = null;
    this.promise = Promise.resolve();
    this.lastCall = -Infinity;
  }

  getStatus() {
    return JSON.parse(JSON.stringify(this.status));
  }

  /** Grade an account's recent matches, or report the run already doing it. */
  start(account) {
    const acct = String(account || '').trim();
    if (!acct.includes('#')) return this.getStatus();
    if (this.running && sameAccount(this.running.account, acct)) return this.getStatus();
    if (this.running) this.running.cancelled = true;
    const run = { account: acct, cancelled: false, resume: null };
    this.running = run;
    this.status = { ...idle(), state: 'listing', account: acct, message: "Finding your recent matches in Riot's record." };
    run.resume = { state: 'listing', message: this.status.message };
    this.emit();
    this.promise = this.work(run)
      .catch((e) => {
        this.deps.log('[backfill] stopped on an error:', e && e.message);
        this.update(run, { state: 'error', error: 'failed',
          message: 'Grading your recent matches stopped on an error. Try again from Matches.' });
      })
      .finally(() => { if (this.running === run) this.running = null; });
    return this.getStatus();
  }

  /** Stop at the next safe point. What is saved stays saved. */
  cancel() {
    if (this.running) this.running.cancelled = true;
  }

  emit() {
    try { this.deps.onStatus(this.getStatus()); } catch (e) { this.deps.log('[backfill] status push failed:', e.message); }
  }

  /** Change the status, unless a newer run owns it. */
  update(run, patch) {
    if (run !== this.running) return;
    Object.assign(this.status, patch);
    if (this.status.state !== 'waiting') run.resume = { state: this.status.state, message: this.status.message };
    this.emit();
  }

  /** Sleep in short steps, so a cancelled run lets go within seconds. */
  async pause(run, ms) {
    let left = ms;
    while (left > 0 && !run.cancelled) {
      const step = Math.min(left, WAIT_MS);
      await this.deps.sleep(step);
      left -= step;
    }
  }

  /** Wait while a match is being played. */
  async clear(run) {
    if (run.cancelled || !this.deps.inMatch()) return;
    const before = run.resume;
    this.update(run, { state: 'waiting', message: 'Waiting for your match to end. Grading carries on after it.' });
    while (!run.cancelled && this.deps.inMatch()) await this.deps.sleep(WAIT_MS);
    if (!run.cancelled && before) this.update(run, { state: before.state, message: before.message });
  }

  /** One request, at least GAP_MS after the last. Never throws. */
  async get(run, path, timeoutMs) {
    const wait = this.lastCall + GAP_MS - this.deps.now();
    if (wait > 0) await this.pause(run, wait);
    this.lastCall = this.deps.now();
    try {
      return (await this.deps.get(path, timeoutMs)) || { ok: false, status: 0, data: null };
    } catch (e) {
      return { ok: false, status: 0, data: null, error: e && e.message };
    }
  }

  /** A request, asked again while its failure is one that passes. */
  async getRetrying(run, path, timeoutMs) {
    let res = null;
    for (let i = 0; i <= RETRY_MS.length; i++) {
      if (i) await this.pause(run, RETRY_MS[i - 1]);
      if (run.cancelled) return res;
      await this.clear(run);
      if (run.cancelled) return res;
      res = await this.get(run, path, timeoutMs);
      if (!(res.status === 503 || res.status === 429 || res.status === 0)) return res;
    }
    return res;
  }

  /** The recent matches on the account, or why there are none. */
  async list(run) {
    const q = '?username=' + encodeURIComponent(run.account);
    let res = await this.getRetrying(run, '/api/coach/recent-matches' + q, 20000);
    if (run.cancelled) return null;
    if (res && res.status === 404) {
      // A server from before the route: the newest match and the four before it.
      res = await this.getRetrying(run, '/api/coach/last-match' + q, 30000);
      if (run.cancelled) return null;
      const lm = res && res.ok && res.data && !res.data.error ? res.data : null;
      if (lm) return { rows: [lm, ...(Array.isArray(lm.recent) ? lm.recent : [])] };
      if (res && res.ok && res.data && /no recent match/i.test(String(res.data.error || ''))) return { rows: [] };
    } else if (res && res.ok && res.data && Array.isArray(res.data.matches)) {
      return { rows: res.data.matches };
    }
    return { error: whyNot(res) };
  }

  /** Riot's round record of one match, or null. */
  async rounds(run, row) {
    const path = `/api/coach/match-rounds?matchId=${encodeURIComponent(row.matchId)}`
      + `&username=${encodeURIComponent(run.account)}`;
    const res = await this.getRetrying(run, path, 30000);
    const d = res && res.ok ? res.data : null;
    return d && !d.error && Array.isArray(d.perRound) && d.perRound.length ? d : null;
  }

  /** The review for one planned match: false when it is no longer this run's to save. */
  build(step, riot, account) {
    const d = this.deps;
    const library = d.library();
    if (library.some((e) => e && e.meta && e.meta.matchId === step.row.matchId)) return false;
    const history = d.history.get() || [];
    if (step.action === 'upgrade') {
      const saved = library.find((e) => e && e.meta && e.meta.id === step.savedId);
      if (!saved || !saved.review || saved.review.verified || saved.meta.matchId || d.activeIds().has(step.savedId)) {
        return false;
      }
      return riotReview.upgradeWatched({ saved: { id: saved.meta.id, at: saved.meta.at, review: saved.review },
        row: step.row, riot, history, account });
    }
    const out = riotReview.fromRiot({ row: step.row, riot, history, account });
    out.review.id = newId('valorant', out.review.at);
    return out;
  }

  /** One baseline row per graded match, in time order, never twice. */
  remember(built) {
    const row = valorantReview.historyEntry(built.tracker, built.role);
    if (!row) return;
    const entry = { ...row, at: built.review.matchStartedAt || built.review.at, matchId: built.review.matchId || null };
    const past = (this.deps.history.get() || []).filter((h) => !(h && entry.matchId && h.matchId === entry.matchId));
    const rows = [...past, entry].sort((a, b) => (a.at || 0) - (b.at || 0)).slice(-valorantReview.BASELINE_GAMES);
    this.deps.history.set(rows);
  }

  async work(run) {
    const d = this.deps;
    await this.clear(run);
    if (run.cancelled) return;
    const listed = await this.list(run);
    if (run.cancelled || !listed) return;
    if (listed.error) {
      this.update(run, { state: 'error', error: listed.error.error, message: listed.error.message });
      return;
    }
    const rows = listed.rows
      .filter((r) => r && r.matchId && queueOk(r.mode))
      .sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0))
      .slice(0, MAX_MATCHES);
    if (!rows.length) {
      this.update(run, { state: 'done', found: 0, message: 'No recent Competitive, Unrated, Swiftplay or Premier '
        + 'matches on this account yet. Your next recorded match is graded when it ends.' });
      return;
    }
    const steps = plan(rows, d.library(), d.activeIds());
    const todo = steps.filter((s) => s.action === 'new' || s.action === 'upgrade')
      .sort((a, b) => (a.row.startedAt || 0) - (b.row.startedAt || 0));
    const have = steps.filter((s) => s.action === 'have').length;
    this.update(run, {
      state: todo.length ? 'grading' : 'done',
      found: rows.length, have, skipped: steps.length - todo.length - have,
      total: todo.length, done: 0,
      items: todo.map((s) => itemOf(s.row, 'pending')).reverse(),
      message: todo.length ? `Grading ${plural(todo.length, 'match', 'matches')} from Riot's record.`
        : 'Your recent matches are already in your library.',
    });
    if (!todo.length) return;

    let failsInRow = 0;
    for (const step of todo) {
      if (run.cancelled) return;
      this.update(run, { message: `Grading match ${this.status.done + 1} of ${todo.length} from Riot's record.` });
      const riot = await this.rounds(run, step.row);
      if (run.cancelled) return;
      await this.clear(run);
      if (run.cancelled) return;
      let built = null;
      if (riot) {
        try { built = this.build(step, riot, run.account); } catch (e) { d.log('[backfill] could not build', step.row.matchId, e.message); }
      }
      const item = this.status.items.find((x) => x.matchId === step.row.matchId);
      if (built === false) {
        if (item) item.status = 'have';
        this.update(run, { done: this.status.done + 1, have: this.status.have + 1 });
        continue;
      }
      if (!built) {
        failsInRow++;
        if (item) item.status = 'failed';
        this.update(run, { done: this.status.done + 1, failed: this.status.failed + 1 });
        if (failsInRow >= MAX_FAILS_IN_A_ROW) {
          this.update(run, { state: 'error', error: 'unreachable', message: summary(this.status, true) });
          return;
        }
        continue;
      }
      failsInRow = 0;
      d.save(built.review);
      this.remember(built);
      const upgraded = step.action === 'upgrade';
      if (item) {
        const g = built.review.grade;
        const game = built.review.game || {};
        Object.assign(item, {
          status: upgraded ? 'upgraded' : 'graded',
          id: built.review.id,
          grade: g && typeof g.score === 'number' ? { score: g.score, letter: g.letter, provisional: !!g.provisional } : null,
          map: game.map || item.map, agent: game.agent || item.agent,
          result: game.result || item.result, score: game.score || item.score,
        });
      }
      this.update(run, {
        done: this.status.done + 1,
        graded: this.status.graded + (upgraded ? 0 : 1),
        upgraded: this.status.upgraded + (upgraded ? 1 : 0),
      });
    }
    if (run.cancelled) return;
    this.update(run, { state: 'done', message: summary(this.status, false) });
    const n = this.status.graded + this.status.upgraded;
    if (n) d.notice(`Graded ${plural(n, 'recent match', 'recent matches')} from Riot's record. ${n === 1 ? 'It is' : 'They are'} in Matches.`);
  }
}

module.exports = { Backfill, plan, windowOf, queueOk, MAX_MATCHES, GAP_MS, RETRY_MS, QUEUES };
```

- [ ] **Step 4: Run the tests.** Run: `node scripts/test-backfill.js`, `node scripts/test-match-link.js`. Expected: PASS. Fix the module, not the expectations, unless an expectation contradicts the spec; report any such change.

---

### Task 5: The breakdown module

**Files:**
- Create: `src/shared/breakdown.js`
- Test: `scripts/test-breakdown.js`

**Interfaces:**
- Consumes (Task 2): card fields (`sideKey`, `verified`, `watched`, `spot`, `riot`), `review.source`, `review.halftimeAfter`; `roleOf` from `./agent-roles`; `letter` from `./grade`. Must ALSO read cards saved before these fields existed, from their `facts` strings.
- Produces: `build(game, saved, opts) -> Breakdown` where `saved` is `[{ id, game, at, review }]` newest first and `opts.queue` is `'All'` or a queue label.

```
Breakdown = {
  game, matches, total, queue, queues: [{ label, matches }], left, checked,
  unknown: { [dimKey]: number },
  dims: [{ key, label, one, many }],
  rows: { [dimKey]: Row[] },          // sorted: matches desc, grade avg desc, label
  headline: [{ kind: 'strongest'|'weakest'|'best'|'most', dim, label, title, detail }],
  note: string|null,
}
Row = {
  key, label, sub, matches,
  record: { won, lost, drawn, known } | null,            // null for League
  winRate: { count, n, pct } | null,
  grade: { avg, raw, letter, n, provisional },
  stats: {...},                                          // per game below
  cross: [{ label, matches, record, grade }],
  spots: { placed, top: [{ spot, deaths }], callout: { spot, deaths, placed } | null } | null,
  mistake: { key, title, fix, matches, of } | null,
  strength: { key, title, matches, of } | null,
  vsRest: { grade, winRate, firstDeath } | null,         // integer deltas or null
}
Valorant stats: checked, rounds, attack, defence, pistol, postPlant, retake, firstKill, firstDeath, survived, traded
  (each { count, n, pct }), kd { value, kills, deaths, n }, acs { value, n }, adr { value, n }, hs { value, n }
Rivals stats: kd { value, kills, deaths, n }, damage { value, n }, duty { label, value, n } | null (hero only),
  accuracy { value, n } | null (hero only)
League stats: kda { value, n }, csPerMin { value, n }, visionPerMin { value, n }, deathsPer10 { value, n }
```

- [ ] **Step 1: Write the failing test `scripts/test-breakdown.js`:**

```js
'use strict';

/**
 * The breakdown on the real fixtures: what each map and agent row counts, the
 * floors that keep a small sample from reading as a rate, the headline rule,
 * old saved cards read back from their fact lines, and the other two games.
 *
 * Run: npm run test:breakdown
 */

const { replay, load } = require('./fixtures/replay-match');
const verify = require('../src/shared/valorant-verify');
const review = require('../src/shared/valorant-review');
const riotReview = require('../src/shared/riot-review');
const breakdown = require('../src/shared/breakdown');

let fails = 0;
let checks = 0;
const ok = (cond, what) => {
  checks++;
  if (!cond) { fails++; console.log(`FAIL  ${what}`); } else console.log(`ok    ${what}`);
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const riot = load('riot-abyss-13-11.json');
const played = replay(load('valorant-match-abyss-13-11.json').frames, 'standard');
const { rounds } = verify.reconcile(played.rounds, riot);
const TRACKER = { matchId: 'w1', map: 'Abyss', agent: 'Jett', result: 'Victory', score: '13-11', kills: 31,
  deaths: 21, assists: 4, kd: 1.48, acs: 382, adr: 243, headshotPct: 25 };
const watched = review.build({ rounds, context: { ...played.context, map: 'Abyss', agent: 'Jett' }, endedBy: 'score',
  ai: {}, role: 'Duelist', history: [], riotMe: riot.me, queue: riot.queue, tracker: TRACKER });

const T0 = Date.parse('2026-09-01T18:00:00Z');
const HOUR = 3600000;
const letterOf = (s) => (s >= 90 ? 'S' : s >= 80 ? 'A' : s >= 70 ? 'B' : s >= 60 ? 'C' : 'D');
let seq = 0;
/** A saved entry as reviewStore.recent() hands them over, with the fields a case needs changed. */
function saved(rv, over = {}) {
  seq++;
  const r = JSON.parse(JSON.stringify(rv));
  for (const k of ['map', 'agent', 'mode', 'result']) if (over[k] !== undefined) r.game[k] = over[k];
  if (over.grade !== undefined) {
    r.grade = over.grade === null ? null
      : { ...r.grade, score: over.grade, letter: letterOf(over.grade), provisional: !!over.provisional };
  }
  return { id: `valorant-${T0 + seq * HOUR}-t${String(seq).padStart(4, '0')}`, game: 'valorant', at: T0 + seq * HOUR, review: r };
}
const newestFirst = (list) => list.slice().sort((a, b) => b.at - a.at);

// ── One real match, counted by hand from Riot's record ─────────────────────
const one = breakdown.build('valorant', [saved(watched)]);
const abyss = one.rows.map[0];
{
  ok(one.matches === 1 && one.rows.map.length === 1 && abyss.label === 'Abyss' && abyss.matches === 1,
    'one match is one Abyss row');
  ok(same(abyss.record, { won: 1, lost: 0, drawn: 0, known: 1 }) && abyss.winRate.pct === null && abyss.winRate.n === 1,
    'a 1-0 record, and no win rate from one match');
  const s = abyss.stats;
  ok(same(s.attack, { count: 6, n: 12, pct: 50 }) && same(s.defence, { count: 7, n: 12, pct: 58 }),
    `attack 6 of 12 and defence 7 of 12, as Riot has them (${s.attack.count}/${s.attack.n}, ${s.defence.count}/${s.defence.n})`);
  ok(same(s.pistol, { count: 1, n: 2, pct: null }), 'pistol rounds are 1 and 13: one won, two too few for a rate');
  ok(same(s.postPlant, { count: 6, n: 10, pct: 60 }) && same(s.retake, { count: 2, n: 6, pct: 33 }),
    'post plants 6 of 10 on attack, retakes 2 of 6 on defence');
  ok(same(s.firstKill, { count: 8, n: 24, pct: 33 }) && same(s.firstDeath, { count: 4, n: 24, pct: 17 }),
    'first kill in 8 of 24 rounds, first death in 4');
  ok(same(s.survived, { count: 3, n: 24, pct: 13 }) && same(s.traded, { count: 1, n: 21, pct: 5 }),
    'alive at the end of 3 rounds, 1 of 21 deaths traded');
  ok(s.kd.value === 1.48 && s.kd.kills === 31 && s.kd.deaths === 21 && s.acs.value === 382 && s.adr.value === 243
    && s.hs.value === 25, 'the scoreboard is the scoreline, K/D as kills over deaths');
  ok(s.checked === 1 && s.rounds === 24 && one.checked === 1, 'one match checked against Riot, 24 rounds');
  const placed = watched.rounds.filter((c) => c.died && c.spot);
  const counts = {};
  for (const c of placed) counts[c.spot] = (counts[c.spot] || 0) + 1;
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  ok(abyss.spots.placed === placed.length && abyss.spots.top[0].spot === top[0] && abyss.spots.top[0].deaths === top[1],
    `where the coach placed the deaths: ${top[0]}, ${top[1]} of ${placed.length}`);
  ok(Boolean(abyss.spots.callout) === (top[1] >= 3 && top[1] * 4 >= placed.length), 'the spot callout follows its floor');
  ok(abyss.mistake === null && abyss.strength === null, 'one match repeats nothing');
  ok(abyss.vsRest === null, 'and has nothing to be compared with');
  ok(one.rows.agent.length === 1 && one.rows.agent[0].label === 'Jett' && one.rows.agent[0].sub === 'Duelist'
    && one.rows.agent[0].spots === null, 'the agent row names the role, and places no deaths');
  ok(abyss.sub === null, 'a map row has no role');
}

// ── An old saved review reads the same from its fact lines ─────────────────
{
  const legacy = JSON.parse(JSON.stringify(watched));
  delete legacy.source;
  for (const c of legacy.rounds) {
    delete c.sideKey; delete c.verified; delete c.watched; delete c.spot; delete c.ultReady; delete c.riot;
  }
  const old = breakdown.build('valorant', [saved(legacy)]).rows.map[0];
  ok(same(old.stats, abyss.stats), 'every round stat of a pre 8.0.3 review matches the structured cards');
  ok(same(old.spots, abyss.spots), 'and so do the death spots');
}

// ── A match graded from Riot's record alone ─────────────────────────────────
{
  const only = riotReview.fromRiot({ row: { ...TRACKER, matchId: 'r1', mode: 'Unrated', startedAt: T0 }, riot, history: [] }).review;
  const r = breakdown.build('valorant', [saved(only)]).rows.map[0];
  for (const k of ['attack', 'defence', 'pistol', 'postPlant', 'retake', 'firstKill', 'firstDeath', 'survived', 'traded']) {
    ok(same(r.stats[k], abyss.stats[k]), `Riot only rounds count the same ${k}`);
  }
  ok(r.spots.placed === 0 && r.spots.callout === null && r.spots.top.length === 0,
    'and a match the coach never watched places no death');
}

// ── Several matches: grouping, floors, repeats, the rest, the headline ─────
{
  const list = newestFirst([
    saved(watched, { grade: 80 }), saved(watched, { grade: 76 }), saved(watched, { grade: 72 }),
    saved(watched, { map: 'Bind', agent: 'Sova', result: 'Defeat', grade: 60 }),
    saved(watched, { map: 'Bind', agent: 'Sova', result: 'Defeat', grade: 64 }),
    saved(watched, { map: 'Bind', grade: 70 }),
    saved(watched, { map: 'Haven', agent: 'Omen', result: 'Defeat', grade: 50, provisional: true }),
  ]);
  const b = breakdown.build('valorant', list);
  const maps = b.rows.map.map((r) => `${r.label}:${r.matches}`).join();
  ok(maps === 'Abyss:3,Bind:3,Haven:1', `maps by matches, then grade (${maps})`);
  const [ab, bi, ha] = b.rows.map;
  ok(ab.winRate.pct === 100 && bi.winRate.pct === 33 && ha.winRate.pct === null, 'win rates from three matches up');
  ok(ab.grade.avg === 76 && ab.grade.letter === 'B' && ab.grade.n === 3, 'Abyss averages 76 over three graded matches');
  ok(ha.grade.avg === null && ha.grade.provisional === 1, 'a provisional grade is left out and counted as left out');
  ok(ab.mistake && ab.mistake.matches === 3 && ab.mistake.of === 3 && typeof ab.mistake.fix === 'string',
    `a mistake in all three Abyss matches repeats there (${ab.mistake && ab.mistake.title})`);
  ok(ab.vsRest && ab.vsRest.grade === 11 && ab.vsRest.winRate === 75,
    `Abyss against the rest: grade +11, win rate +75 points (${JSON.stringify(ab.vsRest)})`);
  const jett = b.rows.agent.find((r) => r.label === 'Jett');
  ok(jett.matches === 4 && jett.cross.map((c) => `${c.label}:${c.matches}`).join() === 'Abyss:3,Bind:1',
    'the agent row lists the maps it was played on');
  ok(jett.vsRest && jett.vsRest.firstDeath === null, 'an agent is not compared on first deaths, which differ by role');
  const kinds = b.headline.map((h) => `${h.kind}:${h.label}`).join();
  ok(kinds === 'strongest:Abyss,weakest:Bind,most:Jett', `the headline calls what clears the bar (${kinds})`);
  ok(b.headline.every((h) => h.title && h.detail && !/[\u2013\u2014]/.test(h.title + h.detail)), 'each with a title and a detail, no dashes');
  ok(b.note === null, 'and no note when something was called');
}
{
  const b = breakdown.build('valorant', newestFirst([saved(watched, { grade: 80 }), saved(watched, { map: 'Bind', grade: 60 })]));
  ok(!b.headline.some((h) => h.kind === 'strongest' || h.kind === 'weakest') && /stands out yet/.test(b.note || ''),
    'two matches call nothing, and say why');
}

// ── Queues, other modes, unknown maps ──────────────────────────────────────
{
  const list = newestFirst([
    saved(watched, { mode: 'Competitive' }), saved(watched, { mode: 'Unrated' }), saved(watched, { mode: 'Unrated' }),
    saved(watched, { mode: 'Spike Rush' }), saved(watched, { map: null }),
  ]);
  const all = breakdown.build('valorant', list);
  ok(all.left === 1 && all.matches === 4 && all.total === 4, 'Spike Rush is left out, and counted as left out');
  ok(all.queues.map((q) => `${q.label}:${q.matches}`).join() === 'Unrated:3,Competitive:1',
    `queues present, most played first (${all.queues.map((q) => q.label).join()})`);
  ok(all.unknown.map === 1 && all.rows.map.reduce((a, r) => a + r.matches, 0) === 3, 'a match with no map read is no map row');
  const comp = breakdown.build('valorant', list, { queue: 'Competitive' });
  ok(comp.queue === 'Competitive' && comp.matches === 1 && comp.total === 4, 'the queue filter keeps one queue');
  ok(breakdown.build('valorant', list, { queue: 'Nonsense' }).queue === 'All', 'an unknown queue falls back to All');
}

// ── Marvel Rivals ───────────────────────────────────────────────────────────
{
  const rv = (hero, role, map, result, sl, score) => ({ id: `rivals-${T0 + (++seq) * HOUR}-r${seq}`, game: 'rivals', at: T0 + seq * HOUR,
    review: { kind: 'rivals', empty: false, game: { hero, role, map, mode: 'Competitive', result },
      scoreline: sl, grade: { score, letter: letterOf(score), provisional: false, categories: [] },
      insights: { mistakes: [], strengths: [], missed: [] } } });
  const list = newestFirst([
    rv('Luna Snow', 'Strategist', 'Tokyo 2099', 'VICTORY', { kills: 10, deaths: 5, assists: 20, damage: 8000, healing: 15000, blocked: 0, accuracy: 40 }, 78),
    rv('Luna Snow', 'Strategist', 'Yggsgard', 'DEFEAT', { kills: 6, deaths: 7, assists: 18, damage: 6000, healing: 17000, blocked: 0, accuracy: 44 }, 66),
    rv('Hela', 'Duelist', 'Tokyo 2099', 'VICTORY', { kills: 30, deaths: 8, assists: 5, damage: 30000, healing: 0, blocked: 0, accuracy: 50 }, 85),
  ]);
  const b = breakdown.build('rivals', list);
  ok(same(b.dims.map((d) => d.key), ['map', 'hero']), 'Rivals is by map and by hero');
  const luna = b.rows.hero.find((r) => r.label === 'Luna Snow');
  ok(luna.sub === 'Strategist' && luna.stats.kd.value === 1.33 && luna.stats.duty.label === 'Healing'
    && luna.stats.duty.value === 16000 && luna.stats.accuracy.value === 42, 'a Strategist is read on healing and her own accuracy');
  ok(same(luna.record, { won: 1, lost: 1, drawn: 0, known: 2 }), 'VICTORY and DEFEAT read as a 1-1 record');
  const tokyo = b.rows.map.find((r) => r.label === 'Tokyo 2099');
  ok(tokyo.matches === 2 && tokyo.stats.accuracy === null && tokyo.stats.duty === null,
    'a map row never averages accuracy or duty across heroes');
}

// ── League of Legends ───────────────────────────────────────────────────────
{
  const lr = (champion, role, durationSec, sl, score) => ({ id: `lol-${T0 + (++seq) * HOUR}-l${seq}`, game: 'lol', at: T0 + seq * HOUR,
    review: { game: { champion, role, durationSec, mode: 'CLASSIC' }, scoreline: sl,
      grade: { score, letter: letterOf(score), provisional: false, categories: [] }, insights: { mistakes: [], strengths: [], missed: [] } } });
  const b = breakdown.build('lol', newestFirst([
    lr('Ahri', 'Middle', 1800, { kills: 8, deaths: 2, assists: 6, cs: 240, ward: 18 }, 80),
    lr('Ahri', 'Middle', 1800, { kills: 4, deaths: 6, assists: 4, cs: 210, ward: 12 }, 62),
  ]));
  const ahri = b.rows.champion[0];
  ok(same(b.dims.map((d) => d.key), ['champion']) && ahri.record === null && ahri.winRate === null,
    'League is by champion, with no record, since its reviews carry no result');
  ok(ahri.stats.csPerMin.value === 7.5 && ahri.stats.kda.value === 2.75 && ahri.stats.visionPerMin.value === 0.5
    && ahri.stats.deathsPer10.value === 1.3, 'CS, KDA, vision and deaths per ten from the totals');
}

ok(breakdown.build('valorant', []).matches === 0 && breakdown.build('nonsense', []).dims.length === 0, 'nothing in, nothing out');

console.log(`\n${fails ? fails + ' of ' + checks + ' failed' : 'all ' + checks + ' breakdown checks passed'}`);
process.exit(fails ? 1 : 0);
```

Expected values that are not obvious: the headline case has six firm grades (80, 76, 72, 60, 64, 70: mean 70.33, sample SD 7.42). Abyss (76, n 3) against Bind (64.67, n 3): gap 11.33, SE = 7.42 x sqrt(2/3) = 6.06, 1.5 SE = 9.09, so Abyss is strongest and Bind weakest. Jett (4 graded) against Sova (2) fails the 3 outside rule, so no best agent; Jett is most played with 4 of 7. Abyss against the rest: grade 76 minus 64.67 is 11; win rate 3 of 3 against 1 of 4 (Bind 1-2, Haven 0-1) is 100 minus 25, 75. League: CS (240 + 210) / 60 minutes = 7.5; KDA (12 + 10) / 8 = 2.75; vision 30 / 60 = 0.5; deaths 8 / 60 x 10 = 1.33, shown 1.3.

- [ ] **Step 2: Run it and watch it fail.** Run: `node scripts/test-breakdown.js`. Expected: FAIL, module not found.

- [ ] **Step 3: Create `src/shared/breakdown.js`:**

```js
'use strict';

/**
 * The breakdown: the same saved reviews the patterns count, cut by map and by
 * agent (by map and hero for Marvel Rivals, by champion for League).
 *
 * EVERY NUMBER IS COUNTED, NONE IS WRITTEN. The model never reaches this file.
 * The one model judgement inside a saved review, the death cause label, only
 * arrives here inside a mistake the review had already counted.
 *
 * EACH FACT COMES FROM THE ONLY PLACE THAT KNOWS IT.
 *   rounds (sides, pistols, post plants, retakes, openings, trades, survival)
 *     only Riot checked rounds. The screen files a round result a round late
 *     often enough (valorant-rounds.js) that a side win rate built on it
 *     would measure the lag, not the player.
 *   where the player died  only recorded rounds. Riot records no locations.
 *   the scoreboard         only matches that have one.
 *
 * EVERY NUMBER CARRIES ITS SAMPLE. A rate under its floor comes back with
 * pct null, and the window shows "3 of 7" instead of a percentage one round
 * would swing by fourteen points. The floors are in FLOOR, beside what they
 * guard.
 *
 * A HEADLINE IS A CLAIM, so it has to beat chance: a map is called strongest
 * or weakest, an agent best, only with three graded matches on it, three
 * elsewhere, six in all, and a gap of at least six points that is also at
 * least one and a half standard errors of the grade.
 *
 * OLD CARDS STILL COUNT. A card saved before 8.0.3 has no structured fields,
 * only the sentences roundFacts() wrote, and those are fixed strings, so they
 * are read back here. test-breakdown.js holds the two readings equal on the
 * real match.
 *
 * Pure, no Electron.
 */

const { roleOf } = require('./agent-roles');
const { letter } = require('./grade');

const FLOOR = {
  winMatches: 3,      // a match win rate
  sideRounds: 10,     // attack or defence rounds
  pistols: 4,         // pistol rounds
  plants: 5,          // post plants on attack, retakes on defence
  openings: 20,       // first kills, first deaths, survival, over rounds
  trades: 8,          // deaths whose trade Riot's feed could say
  spotDeaths: 3,      // a death spot: this many deaths there,
  spotShare: 0.25,    //   and this share of the deaths the screen placed
  spotsShown: 5,      // placed deaths before any spot is listed
  repeatMatches: 2,   // a mistake or strength repeated on one map or agent,
  repeatShare: 0.4,   //   in this share of its matches
  vsRest: 3,          // matches in the row and outside it, for a comparison
  headlineRow: 3,     // graded matches on a called row, and outside it
  headlineAll: 6,     // graded matches in all
  headlineGap: 6,     // points of grade
  headlineSe: 1.5,    // standard errors
  mostPlayed: 3,      // matches
};

// The queues the Valorant breakdown counts. Spike Rush, Replication,
// Escalation, customs and the deathmatches are played on other rules, and a
// side win rate that mixes them in is a number about nothing. 'Standard' is
// the screen's own name for a match whose queue Riot never named.
const VALORANT_QUEUES = new Set(['Competitive', 'Unrated', 'Swiftplay', 'Premier', 'Standard']);

const SPOT_RE = /^Died at ([^,]+)/;
const KILLS_RE = /^(\d+) kills?$/;
const SCORE_RE = /^\s*(\d+)\s*-\s*(\d+)\s*$/;

const keyOf = (s) => String(s || '').trim().toLowerCase();
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const round1 = (v) => Math.round(v * 10) / 10;
const round2 = (v) => Math.round(v * 100) / 100;
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function rate(count, n, floor) {
  return { count, n, pct: n > 0 && n >= floor ? Math.round((count / n) * 100) : null };
}

function roundsIn(score) {
  const m = SCORE_RE.exec(String(score || ''));
  return m ? Number(m[1]) + Number(m[2]) : 0;
}

/** 'won' | 'lost' | 'drawn' | null, for every game's way of writing a result. */
function outcome(result) {
  const r = String(result || '');
  if (/vict|\bwin\b|\bwon\b/i.test(r)) return 'won';
  if (/defeat|\bloss\b|\blost\b|\blose\b/i.test(r)) return 'lost';
  if (/\bdraw\b|\btie\b/i.test(r)) return 'drawn';
  return null;
}

function recordOf(entries) {
  const r = { won: 0, lost: 0, drawn: 0, known: 0 };
  for (const e of entries) {
    const o = outcome(e.result);
    if (!o) continue;
    r[o]++;
    r.known++;
  }
  return r;
}

/** The average of the grades that are not provisional, and how many were left out. */
function gradeOf(entries) {
  const scored = entries.filter((e) => e.grade && typeof e.grade.score === 'number');
  const firm = scored.filter((e) => !e.grade.provisional).map((e) => e.grade.score);
  const raw = mean(firm);
  const avg = raw === null ? null : Math.round(raw);
  return { avg, raw, letter: avg === null ? null : letter(avg), n: firm.length, provisional: scored.length - firm.length };
}

/** Whatever repeats in the row's matches, once a match, past its floor. */
function repeated(entries, list) {
  const tally = new Map();
  for (const e of entries) {
    const seen = new Set();
    for (const x of ((e.insights || {})[list] || [])) {
      if (!x || !x.key || seen.has(x.key)) continue;
      seen.add(x.key);
      const t = tally.get(x.key) || { key: x.key, title: x.title, fix: x.fix || null, weight: x.weight || 1, matches: 0, total: 0 };
      t.matches++;
      t.total += x.count || 1;
      tally.set(x.key, t);
    }
  }
  const best = [...tally.values()]
    .filter((t) => t.matches >= FLOOR.repeatMatches && t.matches >= entries.length * FLOOR.repeatShare)
    .sort((a, b) => b.matches - a.matches || b.weight - a.weight || b.total - a.total)[0];
  if (!best) return null;
  return list === 'mistakes'
    ? { key: best.key, title: best.title, fix: best.fix, matches: best.matches, of: entries.length }
    : { key: best.key, title: best.title, matches: best.matches, of: entries.length };
}

/** The other dimension inside a row: the agents on a map, the maps of an agent. */
function cross(entries, by) {
  const groups = new Map();
  for (const e of entries) {
    if (!e[by]) continue;
    const k = keyOf(e[by]);
    if (!groups.has(k)) groups.set(k, { label: e[by], list: [] });
    groups.get(k).list.push(e);
  }
  return [...groups.values()]
    .map((g) => ({ label: g.label, matches: g.list.length, record: recordOf(g.list), grade: gradeOf(g.list) }))
    .sort((a, b) => b.matches - a.matches || (b.grade.raw ?? -1) - (a.grade.raw ?? -1) || a.label.localeCompare(b.label));
}

/** Rows for one dimension, each made by `make(label, its entries, the rest)`. */
function rowsBy(entries, by, make) {
  const groups = new Map();
  for (const e of entries) {
    if (!e[by]) continue;
    const k = keyOf(e[by]);
    if (!groups.has(k)) groups.set(k, { label: e[by], list: [] });
    groups.get(k).list.push(e);
  }
  return [...groups.values()]
    .map((g) => make(g.label, g.list, entries.filter((e) => !g.list.includes(e))))
    .sort((a, b) => b.matches - a.matches || (b.grade.raw ?? -1) - (a.grade.raw ?? -1) || a.label.localeCompare(b.label));
}

/** This row against everything outside it. Null when neither side has enough. */
function against(es, rest, extra) {
  const a = gradeOf(es);
  const b = gradeOf(rest);
  const ra = recordOf(es);
  const rb = recordOf(rest);
  const out = {
    grade: a.n >= FLOOR.vsRest && b.n >= FLOOR.vsRest ? Math.round(a.raw - b.raw) : null,
    winRate: ra.known >= FLOOR.vsRest && rb.known >= FLOOR.vsRest
      ? Math.round((ra.won / ra.known - rb.won / rb.known) * 100) : null,
    firstDeath: extra && extra.firstDeath !== undefined ? extra.firstDeath : null,
  };
  return out.grade === null && out.winRate === null && out.firstDeath === null ? null : out;
}

/** The queues present, most played first. */
function queuesOf(entries) {
  const m = new Map();
  for (const e of entries) if (e.mode) m.set(e.mode, (m.get(e.mode) || 0) + 1);
  return [...m.entries()].map(([label, matches]) => ({ label, matches }))
    .sort((a, b) => b.matches - a.matches || a.label.localeCompare(b.label));
}

function pickQueue(entries, opts) {
  const queues = queuesOf(entries);
  const want = opts && typeof opts.queue === 'string' ? opts.queue : 'All';
  const queue = want !== 'All' && queues.some((q) => q.label === want) ? want : 'All';
  return { queues, queue, kept: queue === 'All' ? entries : entries.filter((e) => e.mode === queue) };
}

/**
 * The headline: strongest and weakest on the first dimension, best on the
 * second, most played on the second (or the only one). Every call beats
 * chance by the rule in the header; most played is a count and needs three.
 */
function headlineOf(dims, rows, entries) {
  const firm = entries.filter((e) => e.grade && typeof e.grade.score === 'number' && !e.grade.provisional)
    .map((e) => e.grade.score);
  const out = [];
  const say = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  if (firm.length >= FLOOR.headlineAll) {
    const m = mean(firm);
    const sd = Math.sqrt(firm.reduce((a, x) => a + (x - m) ** 2, 0) / (firm.length - 1));
    const callable = (list) => list.map((row) => {
      const n1 = row.grade.n;
      const n2 = firm.length - n1;
      if (n1 < FLOOR.headlineRow || n2 < FLOOR.headlineRow) return null;
      const rest = (m * firm.length - row.grade.raw * n1) / n2;
      const gap = row.grade.raw - rest;
      const se = sd * Math.sqrt(1 / n1 + 1 / n2);
      return Math.abs(gap) >= FLOOR.headlineGap && Math.abs(gap) >= FLOOR.headlineSe * se ? { row, gap } : null;
    }).filter(Boolean);
    const detail = (c, d) => `Average ${c.row.grade.avg} over ${say(c.row.grade.n, 'graded match', 'graded matches')}, `
      + `${Math.round(Math.abs(c.gap))} ${c.gap > 0 ? 'above' : 'below'} your other ${d.many}.`;
    const first = dims[0];
    const calls = callable(rows[first.key] || []);
    const top = calls.filter((c) => c.gap > 0).sort((a, b) => b.gap - a.gap)[0];
    const low = calls.filter((c) => c.gap < 0).sort((a, b) => a.gap - b.gap)[0];
    const two = dims.length > 1;
    if (top) out.push({ kind: 'strongest', dim: first.key, label: top.row.label, title: two ? `Strongest ${first.one}` : `Best ${first.one}`, detail: detail(top, first) });
    if (low) out.push({ kind: 'weakest', dim: first.key, label: low.row.label, title: `Weakest ${first.one}`, detail: detail(low, first) });
    if (two) {
      const second = dims[1];
      const best = callable(rows[second.key] || []).filter((c) => c.gap > 0).sort((a, b) => b.gap - a.gap)[0];
      if (best) out.push({ kind: 'best', dim: second.key, label: best.row.label, title: `Best ${second.one}`, detail: detail(best, second) });
    }
  }
  const d = dims[dims.length - 1];
  const list = (rows[d.key] || []).slice().sort((a, b) => b.matches - a.matches);
  if (list[0] && list[0].matches >= FLOOR.mostPlayed && !(list[1] && list[1].matches === list[0].matches)) {
    const r = list[0];
    const rec = r.record && r.record.known ? `, ${r.record.won}-${r.record.lost}${r.record.drawn ? `-${r.record.drawn}` : ''}` : '';
    out.push({ kind: 'most', dim: d.key, label: r.label, title: 'Most played',
      detail: `${r.matches} of your ${say(entries.length, 'match', 'matches')}${rec}.` });
  }
  const claims = out.filter((h) => h.kind !== 'most').length;
  const words = dims.map((x) => x.one).join(' or ');
  const note = entries.length && !claims
    ? `No ${words} stands out yet. That takes at least 3 graded matches on each and a gap bigger than chance.`
    : null;
  return { headline: out, note };
}

// ── Valorant ────────────────────────────────────────────────────────────────

/** Riot's per round facts from a card's fact lines, for a card saved before 8.0.3. */
function legacyRiot(facts, died) {
  let kills = 0;
  for (const f of facts) {
    const m = KILLS_RE.exec(String(f));
    if (m) kills = Number(m[1]);
  }
  return {
    firstDeath: facts.includes('First death of the round'),
    firstKill: facts.includes('First kill of the round'),
    kills,
    traded: !died ? null : facts.includes('Traded by a teammate') ? true : facts.includes('Not traded') ? false : null,
  };
}

/** One round card, as the breakdown counts it. */
function roundOf(card, review) {
  const facts = Array.isArray(card.facts) ? card.facts : [];
  const verified = typeof card.verified === 'boolean' ? card.verified : !!review.verified;
  const side = card.sideKey !== undefined ? card.sideKey
    : card.side === 'Attack' ? 'attacking' : card.side === 'Defence' ? 'defending' : null;
  const watched = typeof card.watched === 'boolean' ? card.watched
    : review.source !== 'riot' && !facts.includes('Not watched by the coach');
  let spot = null;
  if (card.died && watched) {
    if (card.spot !== undefined) spot = card.spot || null;
    else {
      for (const f of facts) {
        const m = SPOT_RE.exec(String(f));
        if (m) { spot = m[1].trim(); break; }
      }
    }
  }
  return {
    n: card.n, side, result: card.result || null, died: !!card.died, planted: !!card.planted, verified, watched, spot,
    riot: verified ? (card.riot || legacyRiot(facts, !!card.died)) : null,
  };
}

function valorantEntry(s) {
  const r = s.review || {};
  const g = r.game || {};
  const cards = Array.isArray(r.rounds) ? r.rounds : [];
  return {
    id: s.id, at: s.at,
    map: g.map || null, agent: g.agent || null, mode: g.mode || null, result: g.result || null,
    grade: r.grade || null, scoreline: r.scoreline || null, insights: r.insights || {},
    totalRounds: roundsIn(g.score),
    riotOnly: r.source === 'riot',
    halftime: typeof r.halftimeAfter === 'number' ? r.halftimeAfter : null,
    rounds: cards.map((c) => roundOf(c, r)),
  };
}

function roundStats(entries) {
  const c = { checked: 0, rounds: 0, aw: 0, a: 0, dw: 0, d: 0, pw: 0, p: 0, ppw: 0, pp: 0, rw: 0, rt: 0, fk: 0, fd: 0, lived: 0, tk: 0, td: 0 };
  for (const e of entries) {
    const rs = e.rounds.filter((r) => r.verified);
    if (!rs.length) continue;
    c.checked++;
    // Round 1, and the first round after halftime. Never overtime.
    const pistols = new Set([1]);
    if (e.halftime) pistols.add(e.halftime + 1);
    for (const r of rs) {
      c.rounds++;
      const decided = r.result === 'won' || r.result === 'lost';
      const won = r.result === 'won';
      if (decided && r.side === 'attacking') { c.a++; if (won) c.aw++; }
      if (decided && r.side === 'defending') { c.d++; if (won) c.dw++; }
      if (decided && pistols.has(r.n)) { c.p++; if (won) c.pw++; }
      if (decided && r.planted && r.side === 'attacking') { c.pp++; if (won) c.ppw++; }
      if (decided && r.planted && r.side === 'defending') { c.rt++; if (won) c.rw++; }
      if (r.riot && r.riot.firstKill) c.fk++;
      if (r.riot && r.riot.firstDeath) c.fd++;
      if (!r.died) c.lived++;
      if (r.died && r.riot && typeof r.riot.traded === 'boolean') { c.td++; if (r.riot.traded) c.tk++; }
    }
  }
  return {
    checked: c.checked,
    rounds: c.rounds,
    attack: rate(c.aw, c.a, FLOOR.sideRounds),
    defence: rate(c.dw, c.d, FLOOR.sideRounds),
    pistol: rate(c.pw, c.p, FLOOR.pistols),
    postPlant: rate(c.ppw, c.pp, FLOOR.plants),
    retake: rate(c.rw, c.rt, FLOOR.plants),
    firstKill: rate(c.fk, c.rounds, FLOOR.openings),
    firstDeath: rate(c.fd, c.rounds, FLOOR.openings),
    survived: rate(c.lived, c.rounds, FLOOR.openings),
    traded: rate(c.tk, c.td, FLOOR.trades),
  };
}

/** The scoreboard: K/D as total kills over total deaths, the rest weighted by rounds. */
function scoreStats(entries) {
  let kills = 0; let deaths = 0; let kdN = 0;
  const w = { acs: [0, 0, 0], adr: [0, 0, 0], hs: [0, 0, 0] };
  const add = (k, v, weight) => { if (num(v) === null) return; w[k][0] += v * weight; w[k][1] += weight; w[k][2]++; };
  for (const e of entries) {
    const s = e.scoreline;
    if (!s) continue;
    const weight = e.totalRounds || e.rounds.length || 1;
    if (num(s.kills) !== null && num(s.deaths) !== null) { kills += s.kills; deaths += s.deaths; kdN++; }
    add('acs', s.acs, weight);
    add('adr', s.adr, weight);
    add('hs', s.headshotPct, weight);
  }
  const avg = (k) => ({ value: w[k][2] ? Math.round(w[k][0] / w[k][1]) : null, n: w[k][2] });
  return {
    kd: { value: kdN ? round2(kills / Math.max(1, deaths)) : null, kills, deaths, n: kdN },
    acs: avg('acs'), adr: avg('adr'), hs: avg('hs'),
  };
}

/** Where the screen placed the deaths, recorded rounds only. */
function spotStats(entries) {
  const counts = new Map();
  let placed = 0;
  for (const e of entries) {
    if (e.riotOnly) continue;
    for (const r of e.rounds) {
      if (!r.died || !r.spot || !r.watched) continue;
      placed++;
      const k = keyOf(r.spot);
      const c = counts.get(k) || { spot: r.spot, deaths: 0 };
      c.deaths++;
      counts.set(k, c);
    }
  }
  const top = [...counts.values()].sort((a, b) => b.deaths - a.deaths || a.spot.localeCompare(b.spot));
  const lead = top[0];
  return {
    placed,
    top: placed >= FLOOR.spotsShown ? top.slice(0, 3) : [],
    callout: lead && lead.deaths >= FLOOR.spotDeaths && lead.deaths >= placed * FLOOR.spotShare
      ? { spot: lead.spot, deaths: lead.deaths, placed } : null,
  };
}

function valorantRow(dim, label, es, rest) {
  const stats = { ...roundStats(es), ...scoreStats(es) };
  const record = recordOf(es);
  let firstDeath;
  if (dim === 'map') {
    const r = roundStats(rest);
    firstDeath = stats.firstDeath.n >= FLOOR.openings && r.firstDeath.n >= FLOOR.openings
      ? Math.round((stats.firstDeath.count / stats.firstDeath.n - r.firstDeath.count / r.firstDeath.n) * 100) : null;
  }
  return {
    key: keyOf(label), label,
    sub: dim === 'agent' ? roleOf(label) : null,
    matches: es.length,
    record,
    winRate: rate(record.won, record.known, FLOOR.winMatches),
    grade: gradeOf(es),
    stats,
    cross: cross(es, dim === 'map' ? 'agent' : 'map'),
    spots: dim === 'map' ? spotStats(es) : null,
    mistake: repeated(es, 'mistakes'),
    strength: repeated(es, 'strengths'),
    vsRest: against(es, rest, dim === 'map' ? { firstDeath } : null),
  };
}

function valorant(list, opts) {
  const all = list.filter((s) => (s.review || {}).kind === 'valorant').map(valorantEntry);
  const eligible = all.filter((e) => !e.mode || VALORANT_QUEUES.has(e.mode));
  const { queues, queue, kept } = pickQueue(eligible, opts);
  const dims = [
    { key: 'map', label: 'By map', one: 'map', many: 'maps' },
    { key: 'agent', label: 'By agent', one: 'agent', many: 'agents' },
  ];
  const rows = {
    map: rowsBy(kept, 'map', (label, es, rest) => valorantRow('map', label, es, rest)),
    agent: rowsBy(kept, 'agent', (label, es, rest) => valorantRow('agent', label, es, rest)),
  };
  return {
    game: 'valorant', matches: kept.length, total: eligible.length, queue, queues,
    left: all.length - eligible.length,
    checked: kept.filter((e) => e.rounds.some((r) => r.verified)).length,
    unknown: { map: kept.filter((e) => !e.map).length, agent: kept.filter((e) => !e.agent).length },
    dims, rows, ...headlineOf(dims, rows, kept),
  };
}

// ── Marvel Rivals ───────────────────────────────────────────────────────────

const RIVALS_DUTY = { Strategist: ['healing', 'Healing'], Vanguard: ['blocked', 'Blocked'] };

function rivalsEntry(s) {
  const r = s.review || {};
  const g = r.game || {};
  return {
    id: s.id, at: s.at, map: g.map || null, hero: g.hero || null, role: g.role || null, mode: g.mode || null,
    result: g.result || null, grade: r.grade || null, scoreline: r.scoreline || {}, insights: r.insights || {},
  };
}

function avgOf(entries, key) {
  const xs = entries.map((e) => num(e.scoreline[key])).filter((v) => v !== null);
  return { value: xs.length ? Math.round(mean(xs)) : null, n: xs.length };
}

function rivalsRow(dim, label, es, rest) {
  let kills = 0; let deaths = 0; let kdN = 0;
  for (const e of es) {
    if (num(e.scoreline.kills) !== null && num(e.scoreline.deaths) !== null) {
      kills += e.scoreline.kills; deaths += e.scoreline.deaths; kdN++;
    }
  }
  const roles = cross(es, 'role');
  const role = dim === 'hero' && roles[0] ? roles[0].label : null;
  const duty = role && RIVALS_DUTY[role] ? { label: RIVALS_DUTY[role][1], ...avgOf(es, RIVALS_DUTY[role][0]) } : null;
  const record = recordOf(es);
  return {
    key: keyOf(label), label, sub: role, matches: es.length,
    record, winRate: rate(record.won, record.known, FLOOR.winMatches), grade: gradeOf(es),
    stats: {
      kd: { value: kdN ? round2(kills / Math.max(1, deaths)) : null, kills, deaths, n: kdN },
      damage: avgOf(es, 'damage'),
      // Duty and accuracy only on a hero: averaged across heroes they compare
      // a projectile hero's accuracy with a hitscan one's, and healing with
      // blocking.
      duty: duty && duty.value !== null ? duty : null,
      accuracy: dim === 'hero' ? avgOf(es, 'accuracy') : null,
    },
    cross: cross(es, dim === 'map' ? 'hero' : 'map'),
    spots: null,
    mistake: repeated(es, 'mistakes'),
    strength: repeated(es, 'strengths'),
    vsRest: against(es, rest),
  };
}

function rivals(list, opts) {
  const all = list.filter((s) => (s.review || {}).kind === 'rivals' && !(s.review || {}).empty).map(rivalsEntry);
  const { queues, queue, kept } = pickQueue(all, opts);
  const dims = [
    { key: 'map', label: 'By map', one: 'map', many: 'maps' },
    { key: 'hero', label: 'By hero', one: 'hero', many: 'heroes' },
  ];
  const rows = {
    map: rowsBy(kept, 'map', (label, es, rest) => rivalsRow('map', label, es, rest)),
    hero: rowsBy(kept, 'hero', (label, es, rest) => rivalsRow('hero', label, es, rest)),
  };
  return {
    game: 'rivals', matches: kept.length, total: all.length, queue, queues, left: 0, checked: 0,
    unknown: { map: kept.filter((e) => !e.map).length, hero: kept.filter((e) => !e.hero).length },
    dims, rows, ...headlineOf(dims, rows, kept),
  };
}

// ── League of Legends ───────────────────────────────────────────────────────

function lolEntry(s) {
  const r = s.review || {};
  const g = r.game || {};
  return {
    id: s.id, at: s.at, champion: g.champion || null, role: g.role || null, mode: g.mode || null,
    minutes: num(g.durationSec) ? g.durationSec / 60 : null,
    support: /support|utility/i.test(g.role || ''),
    result: null, grade: r.grade || null, scoreline: r.scoreline || {}, insights: r.insights || {},
  };
}

function lolRow(label, es, rest) {
  let k = 0; let d = 0; let a = 0; let kdaN = 0;
  let cs = 0; let csMin = 0; let csN = 0;
  let ward = 0; let wardMin = 0; let wardN = 0;
  let dMin = 0; let dSum = 0; let dN = 0;
  for (const e of es) {
    const s = e.scoreline;
    if (num(s.kills) !== null && num(s.deaths) !== null) { k += s.kills; d += s.deaths; a += num(s.assists) || 0; kdaN++; }
    if (!e.minutes) continue;
    if (!e.support && num(s.cs) !== null) { cs += s.cs; csMin += e.minutes; csN++; }
    if (num(s.ward) !== null) { ward += s.ward; wardMin += e.minutes; wardN++; }
    if (num(s.deaths) !== null) { dSum += s.deaths; dMin += e.minutes; dN++; }
  }
  const roles = cross(es, 'role');
  return {
    key: keyOf(label), label, sub: roles[0] ? roles[0].label : null, matches: es.length,
    record: null, winRate: null, grade: gradeOf(es),
    stats: {
      kda: { value: kdaN ? round2((k + a) / Math.max(1, d)) : null, n: kdaN },
      csPerMin: { value: csN ? round1(cs / csMin) : null, n: csN },
      visionPerMin: { value: wardN ? round1(ward / wardMin) : null, n: wardN },
      deathsPer10: { value: dN ? round1((dSum / dMin) * 10) : null, n: dN },
    },
    cross: [],
    spots: null,
    mistake: repeated(es, 'mistakes'),
    strength: repeated(es, 'strengths'),
    vsRest: against(es, rest),
  };
}

function lol(list, opts) {
  const all = list.filter((s) => s.game === 'lol' || ((s.review || {}).game && (s.review || {}).game.champion)).map(lolEntry);
  const { queues, queue, kept } = pickQueue(all, opts);
  const dims = [{ key: 'champion', label: 'By champion', one: 'champion', many: 'champions' }];
  const rows = { champion: rowsBy(kept, 'champion', lolRow) };
  return {
    game: 'lol', matches: kept.length, total: all.length, queue, queues, left: 0, checked: 0,
    unknown: { champion: kept.filter((e) => !e.champion).length },
    dims, rows, ...headlineOf(dims, rows, kept),
  };
}

/**
 * @param game   'valorant' | 'rivals' | 'lol'
 * @param saved  every saved review of that game, newest first ({ id, game, at, review })
 * @param opts   { queue: 'All' | a queue label }
 */
function build(game, saved, opts = {}) {
  const list = (Array.isArray(saved) ? saved : []).filter((s) => s && s.review);
  if (game === 'valorant') return valorant(list, opts);
  if (game === 'rivals') return rivals(list, opts);
  if (game === 'lol') return lol(list, opts);
  return { game, matches: 0, total: 0, queue: 'All', queues: [], left: 0, checked: 0, unknown: {}, dims: [], rows: {}, headline: [], note: null };
}

module.exports = { build, roundOf, outcome, FLOOR, VALORANT_QUEUES };
```

Note on `rowsBy(kept, 'champion', lolRow)`: `lolRow(label, es, rest)` takes three arguments, which is the `make` signature.

- [ ] **Step 4: Run the tests.** Run: `node scripts/test-breakdown.js`. Expected: PASS. Derive any expectation you believe is wrong by hand from the fixture before changing it, and report it.

---

### Task 6: Main process wiring and preloads

**Files:**
- Modify: `src/shared/channels.js`, `src/main/ipc/register-ipc.js`, `src/main/index.js`
- Modify: `src/preload/matches-preload.js`, `src/preload/settings-preload.js`, `src/preload/onboarding-preload.js`

**Interfaces:**
- Consumes: `Backfill` (Task 4), `breakdown.build` (Task 5), `valorantReview.ledgerOf` (Task 2), `MAX_REVIEWS` from `review-store`.
- Produces:
  - Channels `BREAKDOWN_GET: 'reviews:breakdown'`, `BACKFILL_START: 'backfill:start'`, `BACKFILL_STATUS: 'backfill:status'`, `PUSH_BACKFILL: 'push:backfill'` (in `PUSH_LIST`).
  - Controller: `getBreakdown(game, opts)`, `startBackfill()`, `getBackfillStatus()`; `testTracker()` starts the backfill and may answer `{ ok: true, stats: null, unranked: true }`.
  - Preload APIs: matches `getBreakdown(game, opts)`, `startBackfill()`, `getBackfill()`, `onBackfill(cb)`; settings `getBackfill()`, `onBackfill(cb)`, `openMatches()`; onboarding `testTracker()`, `getBackfill()`, `onBackfill(cb)`.

- [ ] **Step 1: `channels.js`.** In the request/response block, after `PATTERNS_GET`, add:

```js
  // The breakdown in Matches: by map and agent (hero, champion), counted from
  // the saved reviews of one game (src/shared/breakdown.js).
  BREAKDOWN_GET:   'reviews:breakdown',  // (game, { queue }) -> { game, matches, dims, rows, headline, ... }
  // Grading the recent matches of the Riot ID in config from Riot's record
  // (src/main/services/backfill.js).
  BACKFILL_START:  'backfill:start',     // () -> the run's status
  BACKFILL_STATUS: 'backfill:status',    // () -> the run's status
```

In the push block, after `PUSH_REVIEWS`:

```js
  // The backfill's status on every change: { state, account, total, done, items, message, ... }
  PUSH_BACKFILL:     'push:backfill',
```

and add `CHANNELS.PUSH_BACKFILL,` to `CHANNELS.PUSH_LIST`.

- [ ] **Step 2: `register-ipc.js`.** After the `PATTERNS_GET` handler:

```js
  safeHandle(C.BREAKDOWN_GET, async (_e, game, opts) => controller.getBreakdown(game, opts));
  safeHandle(C.BACKFILL_START, async () => controller.startBackfill());
  safeHandle(C.BACKFILL_STATUS, async () => controller.getBackfillStatus());
```

- [ ] **Step 3: `index.js` requires and caches.** Change `const { ReviewStore, newId } = require('./services/review-store');` to also take `MAX_REVIEWS`, and beside `const patternsOf  = require('../shared/patterns');` add:

```js
const breakdownOf = require('../shared/breakdown');
const { Backfill } = require('./services/backfill');
```

After `const reviewStore = new ReviewStore(...)` add:

```js
// The breakdown reads every saved review of a game, so it is kept until the
// next save or removal rather than read from disk on every repaint.
const breakdownCache = new Map();
```

- [ ] **Step 4: `saveReview`.** Replace its `try` body with:

```js
    const { frameData, ...clean } = review;
    const meta = reviewStore.save({ id: review.id, game, at: review.at || Date.now(), review: clean, frames });
    breakdownCache.clear();
    // THE PANEL'S "LAST MATCH" IS THE NEWEST SAVED MATCH. A review saved for an
    // older one (Riot's record graded after the fact, a late link) goes to the
    // library and leaves the panel alone.
    const newest = reviewStore.list()[0];
    if (meta && meta.grade && newest && newest.id === review.id) state.lastGrade = { ...meta.grade, game, id: review.id };
    registry.broadcast(C.PUSH_REVIEWS, { id: review.id, game });
    registry.broadcast(C.PUSH_STATE, buildState());
```

In `withdrawReview` and in both loops of `retireStopStubs`, add `breakdownCache.clear();` immediately before each `registry.broadcast(C.PUSH_REVIEWS, ...)` call that reports a removal.

- [ ] **Step 5: the backfill instance.** Directly after the `saveReview` function, add:

```js
// ── Grading recent matches from Riot's record ───────────────────────────────
// backfill.js says what it does and why. This is only what it is wired to.
const backfill = new Backfill({
  get: (p, timeoutMs) => api.get(p, store.get('licenseKey'), timeoutMs),
  library: () => reviewStore.list('valorant').map((meta) => ({
    meta,
    // The whole review only where the plan reads one: those not linked yet.
    review: !meta.matchId && meta.source !== 'riot' ? ((reviewStore.get(meta.id) || {}).review || null) : null,
  })),
  activeIds: () => new Set([...reviewJobs.values()].map((j) => j.id)),
  save: (review) => saveReview(review, 'valorant', null),
  history: {
    get: () => store.get('valorantHistory') || [],
    set: (rows) => store.set('valorantHistory', rows),
  },
  inMatch: () => matchInProgress(),
  onStatus: (s) => registry.broadcast(C.PUSH_BACKFILL, s),
  // Not while recording: the panel's line then says it is recording, and that
  // matters more than a library update.
  notice: (text) => { if (!state.isCoaching) pushNotice(text, 'review'); },
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  now: () => Date.now(),
  log: (...a) => console.log(...a),
});
```

(`reviewJobs` is a `const` declared further down the file; it is only read when the backfill runs, after the module has loaded.)

- [ ] **Step 6: keep the ledger.** In `buildValorantReview`, after `built.stoppedLive = !!snap.stoppedLive;` add:

```js
  // What a later Riot link needs, kept only while Riot's record is missing:
  // a Riot ID added after this review's link gave up can still grade it
  // (riot-review.js, backfill.js).
  built.ledger = built.verified ? null : valorantReview.ledgerOf(snap);
```

- [ ] **Step 7: `testTracker`** becomes:

```js
  /** Settings and onboarding "Connect": test the tracker link right now, and
   *  grade the account's recent matches from Riot's record. */
  async testTracker() {
    const riotId = (store.get('riotId') || '').trim();
    if (!riotId || !riotId.includes('#')) {
      return { ok: false, error: 'Enter your Riot ID as Name#TAG first.' };
    }
    const stats = await fetchTrackerStats(true);
    const error = stats ? null : (statsCache.lastError || 'Could not reach the stats service. Try again in a minute.');
    // AN ACCOUNT WITH NO RANKED PROFILE IS STILL AN ACCOUNT. HenrikDev answers
    // "found the account but no rank or match data yet" for a player who only
    // plays unrated, and their matches can still be graded. Only an account
    // that does not exist stops the backfill before it starts; anything else
    // is for it to find out and say.
    const unranked = !stats && /found the account/i.test(error || '');
    const missing = !stats && /could not find|must be name#tag/i.test(error || '');
    if (!missing) backfill.start(riotId);
    if (stats) return { ok: true, stats };
    if (unranked) return { ok: true, stats: null, unranked: true };
    return { ok: false, error };
  },
```

- [ ] **Step 8: controller methods.** After `getPatterns(game) { ... },` add:

```js
  /** By map and agent (hero, champion), counted from every saved review of one game. */
  getBreakdown(game, opts) {
    const g = game || gameRegistry.get(store.get('game')).id;
    const queue = opts && typeof opts.queue === 'string' ? opts.queue : 'All';
    const key = `${g}|${queue}`;
    if (!breakdownCache.has(key)) {
      breakdownCache.set(key, breakdownOf.build(g, reviewStore.recent(g, MAX_REVIEWS), { queue }));
    }
    return breakdownCache.get(key);
  },
  /** The Matches button: grade the recent matches of the Riot ID in Settings. */
  startBackfill() {
    const riotId = (store.get('riotId') || '').trim();
    if (!riotId.includes('#')) {
      return { ...backfill.getStatus(), state: 'error', error: 'no-riot-id', message: 'Add your Riot ID in Settings first.' };
    }
    return backfill.start(riotId);
  },
  getBackfillStatus() { return backfill.getStatus(); },
```

- [ ] **Step 9: preloads.**

`matches-preload.js`, inside `exposeInMainWorld`:

```js
  getBreakdown: (game, opts) => ipcRenderer.invoke(C.BREAKDOWN_GET, game || null, opts || {}),
  startBackfill: () => ipcRenderer.invoke(C.BACKFILL_START),
  getBackfill:  () => ipcRenderer.invoke(C.BACKFILL_STATUS),
  onBackfill:   (cb) => subscribe(C.PUSH_BACKFILL, cb),
```

`settings-preload.js`, inside `exposeInMainWorld`:

```js
  getBackfill:  () => ipcRenderer.invoke(C.BACKFILL_STATUS),
  onBackfill:   (cb) => subscribe(C.PUSH_BACKFILL, cb),
  openMatches:  () => ipcRenderer.send(C.OPEN_HISTORY),
```

`onboarding-preload.js`: add the whitelisted `subscribe` helper exactly as `matches-preload.js` defines it, then inside `exposeInMainWorld`:

```js
  // Connect tests the Riot ID and starts grading its recent matches; the
  // page then follows the grading as main pushes it.
  testTracker: () => ipcRenderer.invoke(C.STATS_TEST),
  getBackfill: () => ipcRenderer.invoke(C.BACKFILL_STATUS),
  onBackfill:  (cb) => subscribe(C.PUSH_BACKFILL, cb),
```

- [ ] **Step 10: Run the checks.** Run: `node scripts/check-client-boot.js`, `node scripts/check-config-bridge.js`, `node scripts/test-surfaces.js`, `node scripts/check-matches-window.js`, `node scripts/check-lol-review-window.js`, `node scripts/check-rivals-review-window.js`, `node scripts/test-backfill.js`, `node scripts/test-breakdown.js`. Expected: all PASS.

---

### Task 7: Matches: the Breakdown section and grading recent matches

**Files:**
- Modify: `src/renderer/matches/index.html`, `src/renderer/matches/matches.js`, `src/renderer/matches/matches.css`
- Modify: `scripts/check-matches-window.js`

**Interfaces:**
- Consumes (Task 6 preload): `getBreakdown(game, opts)`, `startBackfill()`, `getBackfill()`, `onBackfill(cb)`, `getConfig()`, `openSettings()`; the Breakdown shape (Task 5); `metaOf` rows with `source`.

- [ ] **Step 1: Extend the boot check first.** In `scripts/check-matches-window.js`:

1a. Require `riotReview` beside the other requires: `const riotReview = require(path.join(REPO, 'src/shared/riot-review'));`

1b. After the `ids` loop that saves three reviews, save a fourth, older, Riot only review on another map and agent:

```js
// A fourth match, graded from Riot's record alone, on another map and agent:
// the breakdown needs two of each to show it cuts by both.
const riotRec = JSON.parse(JSON.stringify(load('riot-abyss-13-11.json')));
riotRec.map = 'Bind';
riotRec.me.agent = 'Sova';
const riotOnly = riotReview.fromRiot({
  row: { matchId: 'check-bind', map: 'Bind', agent: 'Sova', mode: 'Competitive', result: 'Victory', score: '13-11',
    kills: 31, deaths: 21, assists: 4, kd: 1.48, acs: 382, adr: 243, headshotPct: 25, startedAt: now - 5 * 3600000 },
  riot: riotRec, history: [], account: 'Check#EUW',
}).review;
riotOnly.id = newId('valorant', riotOnly.at);
store.save({ id: riotOnly.id, game: 'valorant', at: riotOnly.at, review: riotOnly });
```

1c. Change the `rows !== 3` assertion and its message to 4.

1d. Before the line `// Click the newest row: it must open the review window on that match.` add:

```js
    // The breakdown: two maps, two agents, a row that opens in place.
    const bShown = await js("!document.getElementById('breakdown').hidden");
    const maps = await js("[...document.querySelectorAll('#b-table .b-row .b-name span:first-child')].map((n) => n.textContent).join(',')");
    lines.push(`breakdown shown=${bShown} maps=${maps}`);
    if (!bShown) return report(false, 'the breakdown section stayed hidden with four saved matches');
    if (maps !== 'Abyss,Bind') return report(false, `the breakdown listed maps ${maps}, expected Abyss,Bind`);
    await js("[...document.querySelectorAll('#b-dims button')].find((b) => b.textContent === 'By agent').click(); true");
    await new Promise((r) => setTimeout(r, 400));
    const agents = await js("[...document.querySelectorAll('#b-table .b-row .b-name span:first-child')].map((n) => n.textContent).join(',')");
    lines.push(`agents=${agents}`);
    if (agents !== 'Jett,Sova') return report(false, `By agent listed ${agents}, expected Jett,Sova`);
    await js("document.querySelector('#b-table .b-row').click(); true");
    await new Promise((r) => setTimeout(r, 400));
    const dts = await js("[...document.querySelectorAll('#b-table .b-detail .b-dt')].map((n) => n.textContent).join('|')");
    lines.push(`opened row: ${dts}`);
    if (!/Openings/.test(dts) || !/Maps/.test(dts)) return report(false, 'opening an agent row showed no openings or maps');
    const riotRow = await js("[...document.querySelectorAll('#list .m-meta')].some((n) => n.textContent.includes(\"from Riot's record\"))");
    if (!riotRow) return report(false, "the Riot only match does not say it is from Riot's record");
```

Run: `node scripts/check-matches-window.js`. Expected: FAIL, the breakdown section does not exist yet.

- [ ] **Step 2: `index.html`.** Between the closing `</section>` of `#patterns` and the `Every match` section, add:

```html
      <!-- WHERE AND ON WHAT. The patterns say what keeps happening; this says
           on which map and which agent, counted from the same saved reviews by
           src/shared/breakdown.js. Every number carries its sample. -->
      <section id="breakdown" class="block breakdown" hidden>
        <div class="b-head">
          <div>
            <h3>Breakdown</h3>
            <p id="b-sub" class="hint"></p>
          </div>
          <div id="b-dims" class="seg-mini" role="tablist" aria-label="Break down by"></div>
        </div>
        <div id="b-queues" class="b-queues" role="group" aria-label="Queue" hidden></div>
        <div id="b-headline" class="b-headline" hidden></div>
        <p id="b-note" class="b-note" hidden></p>
        <div id="b-table" class="b-table" role="table" aria-label="Breakdown"></div>
        <p id="b-empty" class="empty" hidden></p>
      </section>
```

and replace `<h3>Every match</h3>` with:

```html
        <div class="l-head">
          <h3>Every match</h3>
          <div id="bf" class="bf" hidden>
            <span id="bf-status" class="bf-status" aria-live="polite"></span>
            <button id="bf-go" class="btn btn-ghost bf-go" type="button">Grade my recent matches</button>
          </div>
        </div>
```

- [ ] **Step 3: `matches.js`.** 

3a. In `row(m)`, replace `m.verified ? "checked against Riot's record" : null` with:

```js
    m.source === 'riot' ? "from Riot's record" : m.verified ? "checked against Riot's record" : null
```

3b. Add, after `paintPatterns`:

```js
// ── The breakdown ───────────────────────────────────────────────────────────
// Painted and sorted here, never counted: breakdown.js counts, for the reason
// review.js gives, that a renderer doing arithmetic is a second place for the
// numbers to disagree. Formatting a rate as "57%" or "4 of 7" is all it does.

const DOT = '  ·  ';
const bstate = { dim: {}, queue: {}, sort: {}, open: null };
let lastBreakdown = null;

const col = (key, title, kind, o = {}) => ({ key, title, kind, ...o });
const COLS = {
  valorant: {
    map: [
      col('label', 'Map', 'label'), col('matches', 'Matches', 'int'), col('record', 'Record', 'record'),
      col('winRate', 'Win %', 'rate', { unit: 'matches won' }), col('grade', 'Grade', 'grade'),
      col('stats.attack', 'Attack', 'rate', { unit: 'attack rounds won', opt: true }),
      col('stats.defence', 'Defence', 'rate', { unit: 'defence rounds won', opt: true }),
      col('stats.firstDeath', 'First death', 'rate', { unit: 'rounds', opt: true }),
      col('stats.kd', 'K/D', 'kd', { opt: true }),
    ],
    agent: [
      col('label', 'Agent', 'label'), col('matches', 'Matches', 'int'), col('record', 'Record', 'record'),
      col('winRate', 'Win %', 'rate', { unit: 'matches won' }), col('grade', 'Grade', 'grade'),
      col('stats.kd', 'K/D', 'kd', { opt: true }), col('stats.acs', 'ACS', 'avg', { opt: true }),
      col('stats.firstKill', 'First kill', 'rate', { unit: 'rounds', opt: true }),
      col('stats.firstDeath', 'First death', 'rate', { unit: 'rounds', opt: true }),
    ],
  },
  rivals: {
    map: [
      col('label', 'Map', 'label'), col('matches', 'Matches', 'int'), col('record', 'Record', 'record'),
      col('winRate', 'Win %', 'rate', { unit: 'matches won' }), col('grade', 'Grade', 'grade'),
      col('stats.kd', 'K/D', 'kd', { opt: true }), col('stats.damage', 'Damage', 'avg', { opt: true }),
    ],
    hero: [
      col('label', 'Hero', 'label'), col('matches', 'Matches', 'int'), col('record', 'Record', 'record'),
      col('winRate', 'Win %', 'rate', { unit: 'matches won' }), col('grade', 'Grade', 'grade'),
      col('stats.kd', 'K/D', 'kd', { opt: true }), col('stats.damage', 'Damage', 'avg', { opt: true }),
      col('stats.duty', 'Role duty', 'duty', { opt: true }), col('stats.accuracy', 'Accuracy', 'pctavg', { opt: true }),
    ],
  },
  lol: {
    champion: [
      col('label', 'Champion', 'label'), col('matches', 'Games', 'int'), col('grade', 'Grade', 'grade'),
      col('stats.kda', 'KDA', 'kd'), col('stats.csPerMin', 'CS / min', 'dec1', { opt: true }),
      col('stats.visionPerMin', 'Vision / min', 'dec1', { opt: true }),
      col('stats.deathsPer10', 'Deaths / 10', 'dec1', { opt: true }),
    ],
  },
};

const get = (o, key) => key.split('.').reduce((v, k) => (v === null || v === undefined ? v : v[k]), o);
const matchesWord = (n, lol) => `${n} ${lol ? (n === 1 ? 'game' : 'games') : (n === 1 ? 'match' : 'matches')}`;
const signed = (n) => (n > 0 ? `+${n}` : String(n));
const recordText = (r) => `${r.won}-${r.lost}${r.drawn ? `-${r.drawn}` : ''}`;
const rateText = (r) => (r.pct !== null ? `${r.pct}% (${r.count} of ${r.n})` : `${r.count} of ${r.n}`);

function none(td) { td.textContent = '--'; td.classList.add('none'); return td; }

function cell(c, row) {
  const v = get(row, c.key);
  const td = el('div', 'b-td' + (c.kind === 'label' ? ' b-name' : '') + (c.opt ? ' b-opt' : ''));
  td.setAttribute('role', c.kind === 'label' ? 'rowheader' : 'cell');
  const over = (n) => `over ${matchesWord(n, false)}`;
  switch (c.kind) {
    case 'label':
      td.append(el('span', null, row.label));
      if (row.sub) td.append(el('small', null, row.sub));
      return td;
    case 'int':
      td.textContent = String(v);
      return td;
    case 'record':
      if (!v || !v.known) return none(td);
      td.textContent = recordText(v);
      td.title = `${v.won} won, ${v.lost} lost${v.drawn ? `, ${v.drawn} drawn` : ''}`;
      return td;
    case 'rate':
      if (!v || !v.n) return none(td);
      td.textContent = v.pct !== null ? `${v.pct}%` : `${v.count} of ${v.n}`;
      if (v.pct === null) td.classList.add('raw');
      td.title = `${v.count} of ${v.n} ${c.unit || ''}`.trim();
      return td;
    case 'grade': {
      if (!v || v.avg === null) {
        none(td);
        if (v && v.provisional) td.title = 'Only provisional grades so far';
        return td;
      }
      const wrap = el('span', 'b-grade');
      wrap.append(el('span', null, String(v.avg)),
        el('span', 'b-letter ' + gradeTone({ score: v.avg, letter: v.letter }), v.letter));
      td.append(wrap);
      td.title = `Average of ${v.n} graded ${v.n === 1 ? 'match' : 'matches'}`
        + (v.provisional ? `, ${v.provisional} provisional left out` : '');
      return td;
    }
    case 'kd':
      if (!v || v.value === null || v.value === undefined) return none(td);
      td.textContent = v.value.toFixed(2);
      td.title = v.kills !== undefined ? `${v.kills} kills, ${v.deaths} deaths, ${over(v.n)}` : over(v.n);
      return td;
    case 'duty':
      if (!v || v.value === null || v.value === undefined) return none(td);
      td.append(el('span', null, v.value.toLocaleString('en-US')), el('small', 'b-unit', v.label.toLowerCase()));
      td.title = `${v.label}, average ${over(v.n)}`;
      return td;
    default:
      if (!v || v.value === null || v.value === undefined) return none(td);
      td.textContent = c.kind === 'dec1' ? v.value.toFixed(1) : c.kind === 'pctavg' ? `${v.value}%` : v.value.toLocaleString('en-US');
      td.title = over(v.n);
      return td;
  }
}

function sortValue(c, row) {
  const v = get(row, c.key);
  switch (c.kind) {
    case 'label': return row.label.toLowerCase();
    case 'int': return v;
    case 'record': return v && v.known ? v.won / v.known : -1;
    case 'rate': return v && v.n ? v.count / v.n : -1;
    case 'grade': return v && v.avg !== null ? v.avg : -1;
    default: return v && typeof v.value === 'number' ? v.value : -1;
  }
}

function crossText(c) {
  return `${c.label} ${c.matches}`
    + (c.record && c.record.known ? ` (${recordText(c.record)})` : '')
    + (c.grade && c.grade.avg !== null ? `, avg ${c.grade.avg}` : '');
}

function vsText(v, dim) {
  return [
    v.grade !== null ? `Grade ${signed(v.grade)}` : null,
    v.winRate !== null ? `Win rate ${signed(v.winRate)} pts` : null,
    v.firstDeath !== null && dim === 'map' ? `First deaths ${signed(v.firstDeath)} pts` : null,
  ].filter(Boolean).join(DOT);
}

/** The opened row's lines: [label, text, fix?]. Each only where it has data. */
function detailLines(gameId, dim, row, dims) {
  const s = row.stats || {};
  const out = [];
  const d = dims.find((x) => x.key === dim) || { many: 'others' };
  if (gameId === 'valorant') {
    const sides = [s.attack && s.attack.n ? `Attack ${rateText(s.attack)}` : null,
      s.defence && s.defence.n ? `Defence ${rateText(s.defence)}` : null].filter(Boolean);
    if (sides.length) out.push(['Rounds won', sides.join(DOT)]);
    if (s.pistol && s.pistol.n) out.push(['Pistol rounds', `Won ${s.pistol.count} of ${s.pistol.n}`]);
    const spike = [s.postPlant && s.postPlant.n ? `Won ${s.postPlant.count} of ${s.postPlant.n} attack rounds after the plant` : null,
      s.retake && s.retake.n ? `${s.retake.count} of ${s.retake.n} retakes won on defence` : null].filter(Boolean);
    if (spike.length) out.push(['Spike down', spike.join(DOT)]);
    if (s.firstKill && s.firstKill.n) out.push(['Openings', `First kill ${rateText(s.firstKill)}${DOT}First death ${rateText(s.firstDeath)}`]);
    if (s.traded && s.traded.n) out.push(['Trades', `${s.traded.count} of ${s.traded.n} deaths traded by a teammate${s.traded.pct !== null ? ` (${s.traded.pct}%)` : ''}`]);
    if (s.survived && s.survived.n) out.push(['Survival', `Alive at the end of ${s.survived.count} of ${s.survived.n} rounds${s.survived.pct !== null ? ` (${s.survived.pct}%)` : ''}`]);
    const board = [s.acs && s.acs.value !== null ? `ACS ${s.acs.value}` : null, s.adr && s.adr.value !== null ? `ADR ${s.adr.value}` : null,
      s.kd && s.kd.value !== null ? `K/D ${s.kd.value.toFixed(2)}` : null, s.hs && s.hs.value !== null ? `Headshot ${s.hs.value}%` : null].filter(Boolean);
    if (board.length) out.push(['Scoreboard', board.join(DOT) + DOT + matchesWord(Math.max((s.kd && s.kd.n) || 0, (s.acs && s.acs.n) || 0), false)]);
  }
  if (gameId === 'rivals') {
    const line = [s.kd && s.kd.value !== null ? `K/D ${s.kd.value.toFixed(2)}` : null,
      s.damage && s.damage.value !== null ? `Damage ${s.damage.value.toLocaleString('en-US')}` : null,
      s.duty ? `${s.duty.label} ${s.duty.value.toLocaleString('en-US')}` : null,
      s.accuracy && s.accuracy.value !== null ? `Accuracy ${s.accuracy.value}%` : null].filter(Boolean);
    if (line.length) out.push(['Averages', line.join(DOT)]);
  }
  if (gameId === 'lol') {
    const line = [s.kda && s.kda.value !== null ? `KDA ${s.kda.value.toFixed(2)}` : null,
      s.csPerMin && s.csPerMin.value !== null ? `CS a minute ${s.csPerMin.value.toFixed(1)}` : null,
      s.visionPerMin && s.visionPerMin.value !== null ? `Vision a minute ${s.visionPerMin.value.toFixed(1)}` : null,
      s.deathsPer10 && s.deathsPer10.value !== null ? `Deaths per 10 minutes ${s.deathsPer10.value.toFixed(1)}` : null].filter(Boolean);
    if (line.length) out.push(['Averages', line.join(DOT)]);
  }
  if (row.cross && row.cross.length) {
    const title = dim === 'map' ? (gameId === 'rivals' ? 'Heroes here' : 'Agents here') : 'Maps';
    out.push([title, row.cross.slice(0, 6).map(crossText).join(DOT)]);
  }
  if (row.spots) {
    if (row.spots.callout) {
      out.push(['Where you die', `${row.spots.callout.spot}, ${row.spots.callout.deaths} of the ${row.spots.callout.placed} deaths the coach placed here`]);
    } else if (row.spots.top && row.spots.top.length) {
      out.push(['Where you die', row.spots.top.map((t) => `${t.spot} ${t.deaths}`).join(DOT) + `${DOT}of ${row.spots.placed} placed`]);
    }
  }
  if (row.mistake) out.push(['Repeated here', `${row.mistake.title}, in ${row.mistake.matches} of ${row.mistake.of} matches.`, row.mistake.fix]);
  if (row.strength) out.push(['Goes well', `${row.strength.title}, in ${row.strength.matches} of ${row.strength.of} matches.`]);
  if (row.vsRest) {
    const text = vsText(row.vsRest, dim);
    if (text) out.push([`Against your other ${d.many}`, text]);
  }
  return out;
}

function detail(b, dim, row) {
  const box = el('div', 'b-detail');
  box.setAttribute('role', 'region');
  box.setAttribute('aria-label', `${row.label} in detail`);
  for (const [label, text, fix] of detailLines(b.game, dim, row, b.dims)) {
    box.append(el('div', 'b-dt', label));
    const dd = el('p', 'b-dd', text);
    if (fix) {
      const f = el('span', 'b-fix');
      f.append(el('span', 'gv-fix-label', 'Fix'), document.createTextNode(fix));
      dd.append(f);
    }
    box.append(dd);
  }
  const checked = row.stats && typeof row.stats.checked === 'number' ? row.stats.checked : null;
  if (b.game === 'valorant' && checked !== null && checked < row.matches) {
    box.append(el('p', 'b-src', checked
      ? `Round numbers come from the ${checked} of these ${row.matches} matches checked against Riot's record.`
      : "None of these matches is checked against Riot's record yet, so there are no round numbers."));
  }
  return box;
}

function subLine(b) {
  if (!b.matches) return '';
  const lol = b.game === 'lol';
  const parts = [`Across ${matchesWord(b.matches, lol)}${b.queue && b.queue !== 'All' ? ` in ${b.queue}` : ''}.`];
  if (b.game === 'valorant' && b.checked < b.matches) {
    parts.push(`Round numbers come from the ${b.checked} checked against Riot's record.`);
  }
  if (b.left) parts.push(`${b.left} in other modes ${b.left === 1 ? 'is' : 'are'} left out, since ${b.left === 1 ? 'it is' : 'they are'} played on other rules.`);
  return parts.join(' ');
}

function paintBreakdown(b) {
  lastBreakdown = b;
  const host = $('breakdown');
  if (!b || !Array.isArray(b.dims) || !b.dims.length) { host.hidden = true; return; }
  host.hidden = false;
  const dims = b.dims;
  let dim = bstate.dim[b.game];
  if (!dims.some((d) => d.key === dim)) dim = bstate.dim[b.game] = dims[0].key;

  const dimsHost = $('b-dims');
  dimsHost.replaceChildren();
  dimsHost.hidden = dims.length < 2;
  for (const d of dims) {
    const btn = el('button', null, d.label);
    btn.type = 'button';
    btn.setAttribute('role', 'tab');
    btn.setAttribute('aria-selected', String(d.key === dim));
    btn.addEventListener('click', () => { bstate.dim[b.game] = d.key; bstate.open = null; paintBreakdown(lastBreakdown); });
    dimsHost.append(btn);
  }

  const qHost = $('b-queues');
  qHost.replaceChildren();
  const queues = Array.isArray(b.queues) ? b.queues : [];
  qHost.hidden = queues.length < 2;
  if (queues.length >= 2) {
    for (const q of [{ label: 'All', matches: b.total }, ...queues]) {
      const chip = el('button', 'b-chip', q.label);
      chip.type = 'button';
      chip.setAttribute('aria-pressed', String(q.label === b.queue));
      chip.append(el('small', null, q.matches));
      chip.addEventListener('click', () => { bstate.queue[b.game] = q.label; bstate.open = null; loadBreakdown(); });
      qHost.append(chip);
    }
  }

  $('b-sub').textContent = subLine(b);
  const hl = $('b-headline');
  hl.replaceChildren();
  const calls = Array.isArray(b.headline) ? b.headline : [];
  for (const h of calls) {
    const card = el('div', 'b-call');
    card.append(el('span', null, h.title), el('b', null, h.label), el('small', null, h.detail));
    hl.append(card);
  }
  hl.hidden = !calls.length;
  $('b-note').hidden = !b.note;
  $('b-note').textContent = b.note || '';

  const rows = (b.rows && b.rows[dim]) || [];
  const table = $('b-table');
  table.replaceChildren();
  table.hidden = !rows.length;
  $('b-empty').hidden = rows.length > 0;
  $('b-empty').textContent = b.game === 'valorant'
    ? 'Nothing to break down yet. Record a match, or grade your recent matches from Riot below.'
    : 'Nothing to break down yet.';
  if (!rows.length) return;

  const cols = (COLS[b.game] || {})[dim] || [];
  const track = (c, narrow) => (c.kind === 'label' ? `minmax(${narrow ? 96 : 112}px, 1.6fr)` : 'minmax(46px, 1fr)');
  table.style.setProperty('--cols', cols.map((c) => track(c, false)).join(' '));
  table.style.setProperty('--cols-narrow', cols.filter((c) => !c.opt).map((c) => track(c, true)).join(' '));
  const sortKey = `${b.game}:${dim}`;
  const s = bstate.sort[sortKey] || { key: 'matches', dir: 'desc' };

  const head = el('div', 'b-tr b-th');
  head.setAttribute('role', 'row');
  for (const c of cols) {
    const th = el('div', 'b-th-cell' + (c.opt ? ' b-opt' : ''));
    th.setAttribute('role', 'columnheader');
    th.setAttribute('aria-sort', s.key === c.key ? (s.dir === 'asc' ? 'ascending' : 'descending') : 'none');
    const btn = el('button', 'b-sort' + (c.kind === 'label' ? ' left' : ''), c.title);
    btn.type = 'button';
    btn.addEventListener('click', () => {
      const dir = s.key === c.key ? (s.dir === 'asc' ? 'desc' : 'asc') : (c.kind === 'label' ? 'asc' : 'desc');
      bstate.sort[sortKey] = { key: c.key, dir };
      paintBreakdown(lastBreakdown);
    });
    th.append(btn);
    head.append(th);
  }
  table.append(head);

  const sc = cols.find((c) => c.key === s.key) || cols[1];
  const sorted = rows.slice().sort((x, y) => {
    const a = sortValue(sc, x);
    const z = sortValue(sc, y);
    const cmp = typeof a === 'string' ? a.localeCompare(z) : a - z;
    return (s.dir === 'asc' ? cmp : -cmp) || y.matches - x.matches || x.label.localeCompare(y.label);
  });
  for (const row of sorted) {
    const id = `${sortKey}:${row.key}`;
    const open = bstate.open === id;
    const r = el('div', 'b-tr b-row');
    r.setAttribute('role', 'row');
    r.setAttribute('tabindex', '0');
    r.setAttribute('aria-expanded', String(open));
    for (const c of cols) r.append(cell(c, row));
    const toggle = () => { bstate.open = open ? null : id; paintBreakdown(lastBreakdown); };
    r.addEventListener('click', toggle);
    r.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
    });
    table.append(r);
    if (open) table.append(detail(b, dim, row));
  }
}

async function loadBreakdown() {
  const b = await window.occlara.getBreakdown(game, { queue: bstate.queue[game] || 'All' }).catch(() => null);
  paintBreakdown(b && !b.error ? b : null);
}

// ── Grading recent matches from Riot's record ───────────────────────────────
let backfill = null;
let riotId = '';

function paintBf() {
  const box = $('bf');
  box.hidden = game !== 'valorant';
  if (box.hidden) return;
  const s = backfill || { state: 'idle' };
  const busy = s.state === 'listing' || s.state === 'waiting' || s.state === 'grading';
  const btn = $('bf-go');
  const connected = riotId.includes('#');
  btn.disabled = busy && connected;
  btn.textContent = !connected ? 'Add your Riot ID' : busy ? 'Grading' : 'Grade my recent matches';
  $('bf-status').textContent = connected && s.state !== 'idle' ? (s.message || '') : '';
}

$('bf-go').addEventListener('click', async () => {
  if (!riotId.includes('#')) { window.occlara.openSettings(); return; }
  backfill = await window.occlara.startBackfill().catch(() => backfill);
  paintBf();
});
```

3c. In `load()`, change the `Promise.all` to also fetch the config, and after `paintPatterns(...)` paint the rest:

```js
  const [list, patterns, cfg] = await Promise.all([
    window.occlara.listReviews(game), window.occlara.getPatterns(game),
    window.occlara.getConfig().catch(() => null),
  ]);
  riotId = String((cfg && cfg.riotId) || '').trim();
```

and at the end of `load()`:

```js
  paintBf();
  await loadBreakdown();
```

3d. In the startup IIFE, after `await load();` add:

```js
  backfill = await window.occlara.getBackfill().catch(() => null);
  paintBf();
  window.occlara.onBackfill((s) => { backfill = s; paintBf(); });
```

- [ ] **Step 4: `matches.css`.** Append:

```css
/* ── The breakdown ───────────────────────────────────────────────────────────
   A table of rows that open in place. Digits in Geist Mono so columns line up;
   a grade always shows its number and letter beside its colour; a rate under
   its floor is drawn muted as "3 of 7", never as a percentage. */
.b-head { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--space-4); }
.seg-mini { display: flex; gap: 2px; padding: 2px; border-radius: var(--r-sm); background: rgba(0, 0, 0, 0.28); border: 1px solid var(--glass-border); flex: none; }
.seg-mini button {
  font: 600 11.5px var(--font); color: var(--text-dim);
  padding: 4px 10px; border-radius: 6px; border: 0; background: transparent; cursor: pointer;
  transition: background var(--t-fast) var(--ease), color var(--t-fast) var(--ease);
}
.seg-mini button:hover { color: var(--text); }
.seg-mini button[aria-selected="true"] { background: var(--text); color: var(--bg); }
.seg-mini button:focus-visible, .b-chip:focus-visible, .b-sort:focus-visible, .b-row:focus-visible, .bf-go:focus-visible {
  outline: 2px solid var(--text); outline-offset: 2px;
}

.b-queues { display: flex; flex-wrap: wrap; gap: 6px; }
.b-chip {
  font: 600 11px var(--font); color: var(--text-dim);
  padding: 4px 10px; border-radius: 999px; border: 1px solid var(--glass-border); background: transparent; cursor: pointer;
  transition: color var(--t-fast) var(--ease), border-color var(--t-fast) var(--ease);
}
.b-chip small { font-family: var(--font-mono); color: var(--text-mute); margin-left: 5px; }
.b-chip[aria-pressed="true"] { color: var(--text); border-color: rgba(255, 255, 255, 0.4); }

.b-headline { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: var(--space-2); }
.b-call {
  display: flex; flex-direction: column; gap: 3px; padding: var(--space-3);
  background: rgba(0, 0, 0, 0.24); border: 1px solid var(--glass-border); border-radius: var(--r-md);
}
.b-call span { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.07em; color: var(--text-mute); }
.b-call b { font-size: 15px; font-weight: 700; color: var(--text); }
.b-call small { font-size: 11.5px; color: var(--text-dim); line-height: 1.4; }
.b-note { font-size: 11.5px; color: var(--text-mute); line-height: 1.45; margin: 0; }

.b-table { display: flex; flex-direction: column; border: 1px solid var(--glass-border); border-radius: var(--r-md); overflow: hidden; }
.b-tr { display: grid; grid-template-columns: var(--cols); align-items: center; column-gap: var(--space-2); padding: 0 var(--space-3); }
.b-th { background: rgba(0, 0, 0, 0.28); border-bottom: 1px solid var(--glass-border); }
.b-th-cell { display: flex; justify-content: flex-end; min-width: 0; }
.b-th-cell:first-child { justify-content: flex-start; }
.b-sort {
  font: 700 10px var(--font); text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-mute);
  background: transparent; border: 0; padding: 9px 0; cursor: pointer; white-space: nowrap;
}
.b-sort:hover { color: var(--text-dim); }
[aria-sort="ascending"] > .b-sort::after { content: ' \2191'; }
[aria-sort="descending"] > .b-sort::after { content: ' \2193'; }
.b-row {
  min-height: 42px; border-top: 1px solid var(--glass-border); cursor: pointer;
  transition: background var(--t-fast) var(--ease);
}
.b-th + .b-row { border-top: 0; }
.b-row:hover { background: rgba(255, 255, 255, 0.03); }
.b-row[aria-expanded="true"] { background: rgba(255, 255, 255, 0.05); }
.b-td {
  font: 500 12.5px/1.2 var(--font-mono); color: var(--text); text-align: right;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; padding: 10px 0; min-width: 0;
}
.b-td.raw { color: var(--text-mute); font-size: 11.5px; }
.b-td.none { color: var(--text-mute); }
.b-td small { display: block; font: 500 10px var(--font); color: var(--text-mute); }
.b-name { font: 600 13px var(--font); text-align: left; display: flex; flex-direction: column; gap: 1px; }
.b-name span { overflow: hidden; text-overflow: ellipsis; }
.b-grade { display: inline-flex; align-items: center; gap: 6px; }
.b-letter {
  width: 20px; height: 20px; border-radius: 5px; border: 1px solid var(--glass-border);
  display: inline-flex; align-items: center; justify-content: center; font: 800 11px var(--font);
}
.b-letter.good { color: var(--good); border-color: rgba(var(--good-rgb), 0.45); }
.b-letter.mid  { color: var(--text); border-color: rgba(255, 255, 255, 0.28); }
.b-letter.warn { color: var(--warn); border-color: rgba(var(--warn-rgb), 0.45); }
.b-letter.bad  { color: var(--red); border-color: rgba(var(--red-rgb), 0.45); }

.b-detail {
  display: grid; grid-template-columns: 128px 1fr; gap: 8px var(--space-3);
  padding: var(--space-3) var(--space-4) var(--space-4);
  border-top: 1px solid var(--glass-border); background: rgba(0, 0, 0, 0.18);
  animation: rowIn 200ms var(--ease) both;
}
.b-dt { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-mute); padding-top: 3px; }
.b-dd { font-size: 12.5px; color: var(--text); line-height: 1.5; margin: 0; }
.b-fix { display: block; color: var(--text-dim); margin-top: 3px; }
.b-src { grid-column: 1 / -1; font-size: 11px; color: var(--text-mute); margin: 2px 0 0; }

.l-head { display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); }
.bf { display: flex; align-items: center; gap: var(--space-3); min-width: 0; }
.bf-status { font-size: 11.5px; color: var(--text-mute); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.bf-go { font-size: 11.5px; padding: 6px 10px; border-radius: var(--r-sm); flex: none; }

@media (max-width: 700px) {
  .b-tr { grid-template-columns: var(--cols-narrow); }
  .b-opt { display: none; }
  .b-detail { grid-template-columns: 1fr; gap: 4px; }
  .bf-status { display: none; }
}
@media (prefers-reduced-motion: reduce) {
  .b-detail { animation: none; }
}
```

- [ ] **Step 5: Run the checks and look.** Run: `node scripts/check-matches-window.js`, `node scripts/check-dom-ids.js`, `node scripts/check-palette.js`, `node scripts/check-i18n.js`, `node scripts/test-surfaces.js`. Expected: all PASS. If `test-surfaces.js` drives the Matches surface through `scripts/fixtures/fake-dom.js` and a DOM call you used is missing there (for example `style.setProperty` on a new element, `setAttribute('tabindex')`, `querySelector` selectors), add the smallest missing piece to `fake-dom.js` rather than avoiding it, and say so. Then capture the window at 760 by 720 and at 560 by 720 with saved reviews (adapt `scripts/check-matches-window.js` locally or write a scratch script that seeds the same four reviews and calls `win.webContents.capturePage()`), open the PNGs with the Read tool, and fix anything that is misaligned, clipped, or overflowing. Do not leave the scratch script in the repo.

---

### Task 8: Onboarding Riot ID page, Settings status line, review meta, onboarding boot check

**Files:**
- Modify: `src/renderer/onboarding/index.html`, `src/renderer/onboarding/onboarding.js`, `src/renderer/onboarding/onboarding.css`
- Modify: `src/renderer/settings/index.html`, `src/renderer/settings/settings.js`, `src/renderer/settings/settings.css` (only if a style is needed)
- Modify: `src/renderer/review/review.js`
- Create: `scripts/check-onboarding-riot.js`

**Interfaces:**
- Consumes (Task 6 preload): onboarding `testTracker()`, `getBackfill()`, `onBackfill(cb)`, `setConfig`, `getConfig`, `done()`; settings `getBackfill()`, `onBackfill(cb)`, `openMatches()`; the backfill status shape (Task 4); `testTracker()` replies `{ ok, stats }`, `{ ok: true, stats: null, unranked: true }` or `{ ok: false, error }`.

- [ ] **Step 1: Write the failing boot check `scripts/check-onboarding-riot.js`:**

```js
'use strict';

/**
 * The onboarding Riot ID page must paint, follow the grading main pushes, and
 * let the player skip.
 *
 * Nothing else covers the path: main broadcasting PUSH_BACKFILL, the
 * onboarding preload's whitelist, and the page painting the graded matches. A
 * channel drifting between them shows a page that looks like nothing was ever
 * graded, which is exactly what a player who connected would see on a broken
 * build.
 *
 * Results travel through a FILE, not stdout: an Electron main process on
 * Windows does not reliably flush a piped stdout.
 *
 * Run: npm run check:onboardingriot
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

const REPO = path.join(__dirname, '..');
const OUT = path.join(os.tmpdir(), 'occlara-onboarding-riot-check.json');

if (!process.versions.electron) {
  const { spawnSync } = require('child_process');
  const electron = require('electron');
  try { fs.unlinkSync(OUT); } catch { /* nothing to clear */ }
  const env = Object.assign({}, process.env, { OCCLARA_ONBOARDING_OUT: OUT });
  delete env.ELECTRON_RUN_AS_NODE;
  const r = spawnSync(electron, [__filename], { env, timeout: 120000 });
  let rec = null;
  try { rec = JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch { /* reported below */ }
  if (!rec) { console.error('FAIL: the check wrote no result (exit ' + r.status + ')'); process.exit(1); }
  for (const l of rec.lines) console.log('  ' + l);
  if (!rec.ok) { console.error('FAIL: ' + rec.detail); process.exit(1); }
  console.log('PASS: the Riot ID page paints, follows the grading, and skips');
  process.exit(0);
}

const { app, BrowserWindow } = require('electron');

const lines = [];
let reported = false;
function report(ok, detail) {
  if (reported) return;
  reported = true;
  try { fs.writeFileSync(process.env.OCCLARA_ONBOARDING_OUT || OUT, JSON.stringify({ ok, detail, lines })); }
  catch { /* exit code still carries it */ }
  app.exit(ok ? 0 : 1);
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const ud = path.join(os.tmpdir(), 'occlara-check-onboarding-riot');
fs.rmSync(ud, { recursive: true, force: true });
fs.mkdirSync(ud, { recursive: true });
fs.writeFileSync(path.join(ud, 'occlara-config.json'), JSON.stringify({
  game: 'valorant', onboardingCompleted: true, licenseKey: '', language: 'en',
}, null, 2));
process.env.OCCLARA_DEV_USERDATA = ud;

app.disableHardwareAcceleration();
app.on('window-all-closed', () => { /* the run below decides when we exit */ });

setTimeout(async () => {
  const onboardingWindow = require(path.join(REPO, 'src/main/windows/onboarding-window'));
  const registry = require(path.join(REPO, 'src/main/windows/registry'));
  const C = require(path.join(REPO, 'src/shared/channels'));
  try {
    onboardingWindow.create();
    await wait(3000);
    const find = () => BrowserWindow.getAllWindows()
      .find((w) => !w.isDestroyed() && (w.webContents.getURL() || '').includes('/onboarding/'));
    const win = find();
    if (!win) return report(false, 'the onboarding window never opened');
    const errs = [];
    win.webContents.on('console-message', (e, lvl, msg) => { if (lvl >= 2) errs.push(msg); });
    const js = (s) => win.webContents.executeJavaScript(s);

    await js('go(3); true');
    await wait(300);
    const shown = await js("!document.querySelector('.page[data-page=\"3\"]').hidden");
    const next = await js("document.getElementById('next').textContent");
    const parts = await js("!!document.getElementById('ob-riot') && !!document.getElementById('ob-connect')");
    const adv = await js("!!document.querySelector('.page[data-page=\"2\"] #advanced')");
    lines.push(`last page shown=${shown} next="${next}" field and connect=${parts} advanced on page 3=${adv}`);
    if (!shown || !parts) return report(false, 'the Riot ID page is missing its field or its Connect button');
    if (next !== 'Skip for now') return report(false, `the last page offers "${next}", not "Skip for now"`);
    if (!adv) return report(false, 'Advanced coaching did not move to the After every match page');

    registry.broadcast(C.PUSH_BACKFILL, {
      state: 'grading', account: 'Me#EUW', found: 2, have: 0, skipped: 0, total: 2, done: 1, graded: 1, upgraded: 0,
      failed: 0, error: null, message: "Grading match 2 of 2 from Riot's record.",
      items: [
        { matchId: 'b', map: 'Bind', agent: 'Sova', mode: 'Competitive', result: 'Defeat', score: '9-13',
          startedAt: 2, status: 'pending', id: null, grade: null },
        { matchId: 'a', map: 'Abyss', agent: 'Jett', mode: 'Competitive', result: 'Victory', score: '13-11',
          startedAt: 1, status: 'graded', id: 'valorant-1758391200000-abcdef', grade: { score: 74, letter: 'B', provisional: false } },
      ],
    });
    await wait(600);
    const rows = await js("document.querySelectorAll('#ob-bf-list .ob-bf-row').length");
    const text = await js("document.getElementById('ob-bf-list').textContent");
    const line = await js("document.getElementById('ob-bf-line').textContent");
    lines.push(`rows=${rows} text="${text}" line="${line}"`);
    if (rows !== 1 || !/Abyss/.test(text) || !/74/.test(text) || !/B/.test(text)) {
      return report(false, 'the pushed grading did not paint the graded match with its grade');
    }
    if (!/2 of 2/.test(line)) return report(false, 'the progress line did not follow the push');

    await js("document.getElementById('next').click(); true");
    await wait(2500);
    if (find()) return report(false, 'Skip for now did not finish the tour');
    if (errs.length) return report(false, 'renderer errors: ' + errs.join(' | '));
    report(true, 'ok');
  } catch (e) {
    report(false, 'threw: ' + e.message);
  }
}, 6500);

require(path.join(REPO, 'src/main/index.js'));
```

Run: `node scripts/check-onboarding-riot.js`. Expected: FAIL (no Connect button, label is "Let's go").

- [ ] **Step 2: onboarding `index.html`.**

2a. On page `data-page="2"`, after the `<p class="tip-note">` paragraph, add the Advanced coaching block moved from the last page:

```html
      <p class="lead small">Advanced coaching lets your reviews draw on damage breakpoints, utility timings and reads across rounds. Newer players usually leave it off.</p>
      <div class="seg" id="advanced">
        <button data-val="off" class="active">Off, fundamentals</button>
        <button data-val="on">On, advanced</button>
      </div>
```

2b. Replace the whole `<section class="page" data-page="3" hidden> ... </section>` with:

```html
    <!-- ── 4. Grade your last matches ─────────────────────────────────── -->
    <!-- Connect tests the Riot ID and main starts grading the account's recent
         matches from Riot's record (backfill.js). The rows below follow it as
         it works, and it carries on after the tour closes. -->
    <section class="page" data-page="3" hidden>
      <div class="hero">
        <h1>Grade your last matches</h1>
        <p class="sub">Connect your Riot ID and Occlara grades your recent matches from Riot's record.</p>
      </div>
      <div class="ob-riot">
        <input id="ob-riot" class="input" type="text" placeholder="PlayerName#TAG" maxlength="40" autocomplete="off" spellcheck="false" aria-label="Riot ID" />
        <button id="ob-connect" class="btn btn-primary ob-connect" type="button">Connect</button>
      </div>
      <p id="ob-riot-status" class="ob-riot-status" aria-live="polite" hidden></p>
      <div id="ob-bf" class="ob-bf" hidden>
        <div id="ob-bf-line" class="ob-bf-line" aria-live="polite"></div>
        <div id="ob-bf-list" class="ob-bf-list" role="list"></div>
      </div>
      <p class="lead small">Use the account you play Valorant on. Every match you record from now on is checked against Riot's record too: who killed you and when, your trades and your clutches.</p>
    </section>
```

2c. Load the grade colour helper: before `<script src="onboarding.js"></script>` add `<script src="../shared/grade-view.js"></script>` (after `i18n-apply.js`).

- [ ] **Step 3: `onboarding.js`.**

3a. In `go(next)`, replace the line setting `nextBtn.textContent` with:

```js
  // The last page finishes the tour. Until a Riot ID connects it says so
  // plainly: skipping is fine, and Settings connects one later.
  nextBtn.textContent = index === pages.length - 1 ? (connected ? "Let's go" : 'Skip for now') : 'Next';
```

and declare `let connected = false;` next to `let index = 0;`.

3b. Replace the field's `keydown` line (`riotEl.addEventListener('keydown', (e) => e.stopPropagation());`) with:

```js
// Enter in the field connects, and is never "next page".
riotEl.addEventListener('keydown', (e) => {
  e.stopPropagation();
  if (e.key === 'Enter') connectBtn.click();
});
```

3c. Add, after the Riot ID input wiring:

```js
// ── Connect, and the grading that follows it ─────────────────────────────
const connectBtn = document.getElementById('ob-connect');
const statusEl = document.getElementById('ob-riot-status');
const bfBox = document.getElementById('ob-bf');
const bfLine = document.getElementById('ob-bf-line');
const bfList = document.getElementById('ob-bf-list');

function showStatus(ok, text) {
  statusEl.hidden = !text;
  statusEl.textContent = text || '';
  statusEl.className = 'ob-riot-status' + (ok === true ? ' ok' : ok === false ? ' err' : '');
}

connectBtn.addEventListener('click', async () => {
  const id = riotEl.value.trim();
  const at = id.indexOf('#');
  if (at < 1 || at === id.length - 1) { showStatus(false, 'Enter your Riot ID as Name#TAG.'); return; }
  clearTimeout(riotTimer);
  connectBtn.disabled = true;
  connectBtn.textContent = 'Connecting';
  showStatus(null, 'Checking your account.');
  try {
    await window.occlara.setConfig({ riotId: id });
    const res = await window.occlara.testTracker();
    if (res && res.ok) {
      connected = true;
      const rank = res.stats && res.stats.rank ? `, ${res.stats.rank}` : '';
      showStatus(true, res.unranked ? 'Connected. No ranked profile on this account yet.' : `Connected${rank}.`);
    } else {
      showStatus(false, (res && res.error) || 'Could not connect. Try again in a minute.');
    }
  } catch {
    showStatus(false, 'Could not connect. Try again in a minute.');
  } finally {
    connectBtn.disabled = false;
    connectBtn.textContent = 'Connect';
    go(index);
  }
});

/** The matches graded so far, newest first, as main pushes them. */
function paintBackfill(s) {
  if (!s || s.state === 'idle') { bfBox.hidden = true; return; }
  bfBox.hidden = false;
  bfLine.textContent = s.message || '';
  bfList.replaceChildren();
  const done = (Array.isArray(s.items) ? s.items : [])
    .filter((x) => x.status === 'graded' || x.status === 'upgraded' || x.status === 'failed');
  for (const x of done.slice(0, 10)) {
    const row = document.createElement('div');
    row.className = 'ob-bf-row' + (x.status === 'failed' ? ' failed' : '');
    row.setAttribute('role', 'listitem');
    const name = document.createElement('span');
    name.className = 'ob-bf-name';
    name.textContent = [x.map, x.agent].filter(Boolean).join('  ·  ') || 'Match';
    const res = document.createElement('span');
    res.className = 'ob-bf-res' + (/vict/i.test(x.result || '') ? ' win' : /defeat/i.test(x.result || '') ? ' loss' : '');
    res.textContent = x.status === 'failed' ? 'Not fetched' : [x.result, x.score].filter(Boolean).join(' ');
    const grade = document.createElement('span');
    const tone = x.grade && window.GradeView ? window.GradeView.gradeTone(x.grade) : '';
    grade.className = 'ob-bf-grade' + (tone ? ' ' + tone : '');
    grade.textContent = x.grade ? `${x.grade.score} ${x.grade.letter}` : '';
    row.append(name, res, grade);
    bfList.append(row);
  }
}
window.occlara.onBackfill(paintBackfill);
window.occlara.getBackfill().then(paintBackfill).catch(() => {});
```

(`riotTimer` and `riotEl` already exist above this point; keep the debounced save as it is. Move the `connectBtn` declaration above the keydown handler in 3b if the handler is defined first, so the name exists when Enter is pressed: a `const` declared later in the same script is fine for a handler that runs later, but keep the order readable.)

- [ ] **Step 4: `onboarding.css`.** Append, using tokens only:

```css
/* The Riot ID page: the field and Connect side by side, a status line, and
   the matches graded so far in a short scrolling list. */
.ob-riot { display: flex; gap: var(--space-2); }
.ob-riot .input { flex: 1; min-width: 0; }
.ob-connect { flex: none; }
.ob-riot-status { font-size: 12px; color: var(--text-dim); margin: 6px 0 0; }
.ob-riot-status.ok { color: var(--good); }
.ob-riot-status.err { color: var(--red); }
.ob-bf { display: flex; flex-direction: column; gap: 6px; margin-top: var(--space-2); }
.ob-bf-line { font-size: 11.5px; color: var(--text-mute); }
.ob-bf-list { display: flex; flex-direction: column; max-height: 132px; overflow-y: auto; border: 1px solid var(--glass-border); border-radius: var(--r-md); }
.ob-bf-row { display: grid; grid-template-columns: 1fr auto auto; gap: var(--space-3); align-items: center; padding: 7px var(--space-3); border-top: 1px solid var(--glass-border); font-size: 12px; animation: obRowIn 200ms var(--ease) both; }
.ob-bf-row:first-child { border-top: 0; }
.ob-bf-name { color: var(--text); font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ob-bf-res { color: var(--text-mute); font-size: 11px; font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase; }
.ob-bf-res.win { color: var(--text); }
.ob-bf-res.loss { color: var(--red); }
.ob-bf-grade { font-family: var(--font-mono); font-weight: 600; color: var(--text); min-width: 44px; text-align: right; }
.ob-bf-grade.good { color: var(--good); }
.ob-bf-grade.warn { color: var(--warn); }
.ob-bf-grade.bad { color: var(--red); }
.ob-bf-row.failed .ob-bf-name { color: var(--text-mute); }
.lead.small { font-size: 12px; }
@keyframes obRowIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) { .ob-bf-row { animation: none; } }
```

If `.lead.small` or the moved Advanced block overflows the 480 by 528 card, adjust spacing on those two pages only (smaller margins, a shorter `max-height` for the list), never the window size.

- [ ] **Step 5: Settings.** In `settings/index.html`, directly after the element with `id="trk-status"`, add:

```html
        <p id="bf-status" class="trk-status" aria-live="polite" hidden></p>
        <button id="bf-open" class="btn btn-ghost bf-open" type="button" hidden>Open Matches</button>
```

In `settings.js`, change the Connect handler's success branch so `res.unranked` reads `'Connected. No ranked profile on this account yet. Its recent matches are still graded from Riot\'s record.'`, keep the existing message for `res.stats` and change its tail to `Your recent matches are being graded from Riot's record.`, and add after the handler:

```js
// The grading Connect started, followed as main pushes it.
const bfStatus = document.getElementById('bf-status');
const bfOpen = document.getElementById('bf-open');
function paintBackfill(s) {
  const show = !!s && s.state !== 'idle';
  bfStatus.hidden = !show;
  bfOpen.hidden = !(show && s.state === 'done' && (s.graded + s.upgraded) > 0);
  if (!show) return;
  bfStatus.textContent = s.message || '';
  bfStatus.className = 'trk-status' + (s.state === 'error' ? ' err' : s.state === 'done' ? ' ok' : '');
}
bfOpen.addEventListener('click', () => window.occlara.openMatches());
window.occlara.onBackfill(paintBackfill);
window.occlara.getBackfill().then(paintBackfill).catch(() => {});
```

Add a `.bf-open` rule to `settings.css` only if the button needs spacing (`margin-top: 6px; align-self: flex-start;`).

- [ ] **Step 6: Review window.** In `review.js` `paintValorant`, change the `v-meta` parts to:

```js
  $('v-meta').textContent = [
    g.agent, g.map, g.mode,
    r.source === 'riot' ? "From Riot's record" : null,
    w.rounds ? `${w.rounds} round${w.rounds === 1 ? '' : 's'} watched` : null,
  ].filter(Boolean).join('  ·  ');
```

(The existing line already uses a middot separator; keep exactly the separator it uses.)

- [ ] **Step 7: Run the checks and look.** Run: `node scripts/check-onboarding-riot.js`, `node scripts/check-dom-ids.js`, `node scripts/check-i18n.js`, `node scripts/check-palette.js`, `node scripts/test-surfaces.js`, `node scripts/check-config-bridge.js`. Expected: all PASS. Then screenshot onboarding pages 3 and 4 and Settings: `env -u ELECTRON_RUN_AS_NODE npx electron scripts/shot-surface.js onboarding settings` (read `scripts/shot-surface.js` for how it selects onboarding pages; extend it with a page argument only if it has none) and open the PNGs with the Read tool. Nothing may overflow the card, be clipped, or fall back from Geist.

---

## Self-review against the spec

- Spec 1 (backfill: triggers, queues, list route with fallback, planning, building, pacing, failure, notice, status): Tasks 1, 3, 4, 6.
- Spec 2 (card fields, ledger, Riot only review, metaOf source, legacy cards): Tasks 2, 3, 5.
- Spec 3 (onboarding page, Skip, rows, Advanced coaching moved): Task 8.
- Spec 4 (Settings line with Open Matches): Task 8.
- Spec 5 (breakdown module, channel, cache, rules, floors, headline, Rivals and League, Matches section): Tasks 5, 6, 7.
- Testing: every task has its tests; the lead runs the adversarial review, `npm test`, screenshots and CLAUDE.md afterwards.

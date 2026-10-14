'use strict';

/**
 * Which map a logged session was actually played on.
 *
 * The reason this needs testing at all is that the model's map read is wrong
 * often enough to be dangerous, but not often enough to look wrong. Real
 * sessions logged "Sunset x119, Bind x3, Lotus x3" for one continuous match, so
 * anything that trusts a frame's map read splits one game into seven and then
 * states each fragment confidently.
 *
 * So the cases below are mostly about what must NOT be marked.
 *
 * Run: npm run test:ailog-timeline
 */
const path = require('path');
const fs = require('fs');
const tl = require(path.join(__dirname, '..', 'src', 'main', 'services', 'ai-log-timeline.js'));

let fails = 0;
const ok = (cond, what) => { if (!cond) { fails++; console.log(`FAIL  ${what}`); } else console.log(`ok    ${what}`); };

// Callouts unique to one map each, taken from the generated data, so the label
// fingerprint has something real to work with.
const LABELS = {
  Bind:   ['Hookah', 'Bath', 'Showers', 'Lamps', 'Teleporter'],
  Lotus:  ['Waterfall', 'Mound', 'Rubble', 'Gravel', 'A Site'],
  Sunset: ['Boba', 'A Link', 'Mid Courtyard', 'B Market', 'A Elbow'],
  Abyss:  ['Library', 'A Site', 'Mid', 'B Site'],
};

/** n frames on one map, with a running score, and its own printed callouts. */
function frames(map, n, startScore = 0, opts = {}) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const total = startScore + Math.floor(i / 3);
    out.push({
      i, at: 0, frame: 'x.jpg',
      state: {
        map: opts.mapRead === undefined ? map : opts.mapRead,
        locLabel: LABELS[map][i % LABELS[map].length],
        teamScore: opts.noScore ? undefined : Math.ceil(total / 2),
        enemyScore: opts.noScore ? undefined : Math.floor(total / 2),
      },
      shown: null,
    });
  }
  return out;
}

// ── One match, one map, with the model flickering ───────────────────────────
// This is the shape every real session in the log has.
{
  const recs = frames('Sunset', 60);
  recs[3].state.map = 'Bind';        // the flickers that broke the first attempt
  recs[4].state.map = 'Bind';
  recs[30].state.map = 'Lotus';
  recs[47].state.map = 'Haven';
  const segs = tl.segments(recs);
  ok(segs.length === 1, `a flickering map read stays ONE segment (got ${segs.length})`);
  ok(segs[0].map === 'Sunset', `the plurality map wins (${segs[0].map})`);
  ok(segs[0].confirmed === true, 'model and labels agreeing marks it confirmed');
  ok(tl.mapsPlayed(recs).join() === 'Sunset', 'the session label names one map, not four');
}

// Two consecutive misreads at the very start, which is how a real session opened.
{
  const recs = frames('Sunset', 40);
  recs[0].state.map = 'Bind';
  recs[1].state.map = 'Bind';
  ok(tl.segments(recs).length === 1, 'two opening misreads do not create a segment');
}

// ── A real map change, marked by the scoreboard resetting ───────────────────
{
  const recs = [...frames('Bind', 30, 20), ...frames('Lotus', 30, 0)];
  const segs = tl.segments(recs);
  ok(segs.length === 2, `a score reset plus a new map gives two segments (got ${segs.length})`);
  ok(segs[0].map === 'Bind' && segs[1].map === 'Lotus', `and names them in order (${segs.map((s) => s.map).join(' then ')})`);
  ok(segs[1].from === 30, `the change is marked at the frame it happened (${segs[1].from})`);
  ok(segs.every((s) => s.confirmed), 'both segments are confirmed by both witnesses');
}

// A score reset on the SAME map is a new match but not a map change, so the
// timeline must not mark it: nothing changed that a marker would be pointing at.
{
  const recs = [...frames('Bind', 25, 20), ...frames('Bind', 25, 0)];
  ok(tl.segments(recs).length === 1, 'a new match on the same map is not a map change');
}

// ── A real map change the scoreboard missed ─────────────────────────────────
{
  const recs = [...frames('Bind', 30, 0, { noScore: true }), ...frames('Lotus', 30, 0, { noScore: true })];
  const segs = tl.segments(recs);
  ok(segs.length === 2, `a sustained change with agreeing labels is caught without a score (got ${segs.length})`);
  ok(segs[1].map === 'Lotus' && segs[1].from === 30, 'and is cut at the right frame');
}

// The same thing, but the labels keep saying Bind: one witness is not enough.
{
  const recs = frames('Bind', 60, 0, { noScore: true });
  for (let i = 20; i < 60; i++) recs[i].state.map = 'Lotus';   // model changes, labels do not
  const segs = tl.segments(recs);
  ok(segs.length === 1, 'the model alone cannot move the map without the labels agreeing');
  ok(segs[0].map === 'Bind', `the labels decide, so it stays Bind (${segs[0].map})`);
  ok(segs[0].confirmed === false, 'and it is reported UNCONFIRMED rather than asserted');
}

// A four-frame blip is under MIN_RUN and must never split, whatever it claims.
{
  const recs = frames('Sunset', 40, 0, { noScore: true });
  for (let i = 10; i < 14; i++) recs[i].state.map = 'Lotus';
  ok(tl.segments(recs).length === 1, `a ${tl.MIN_RUN - 1} frame run is too short to split`);
}

// ── The scoreboard is not trusted blindly either ────────────────────────────
// One frame misreading the score as 0-0 mid match would otherwise cut the
// session in half, which is the same class of bug as the map flicker.
{
  const recs = frames('Bind', 40, 20);
  recs[20].state.teamScore = 0;
  recs[20].state.enemyScore = 0;
  ok(tl.matchStarts(recs).length === 1, 'a single 0-0 misread does not start a new match');
  ok(tl.segments(recs).length === 1, 'and does not split the session');
}
{
  const recs = frames('Bind', 40, 20);
  for (let i = 20; i < 40; i++) { recs[i].state.teamScore = 0; recs[i].state.enemyScore = 0; }
  ok(tl.matchStarts(recs).length === 2, 'a reset that holds IS a new match');
}

// Unreadable scores are common during a killcam and must never split anything.
{
  const recs = frames('Bind', 40, 20);
  for (let i = 15; i < 25; i++) { delete recs[i].state.teamScore; delete recs[i].state.enemyScore; }
  ok(tl.matchStarts(recs).length === 1, 'an unreadable scoreboard does not start a match');
}

// ── Degenerate input ────────────────────────────────────────────────────────
ok(tl.segments([]).length === 0, 'an empty session has no segments');
ok(tl.segments(null).length === 0, 'a missing session has no segments');
{
  const recs = frames('Bind', 5).map((r) => ({ ...r, state: {} }));
  const segs = tl.segments(recs);
  ok(segs.length === 1 && segs[0].map === null && segs[0].confirmed === false,
    'a session the AI never read reports an unknown map rather than guessing');
}

// ── Deaths ──────────────────────────────────────────────────────────────────
// Every tell below is copied verbatim from a real logged session, and the ones
// asserted as alive were each confirmed by opening the screenshot.
const at = (tell, extra = {}) => ({ state: { aliveTell: tell, ...extra }, shown: null });
const dead = (tell, extra) => at(tell, extra);

{
  // The verdict on single frames, which is where both errors live.
  const v = (t, e) => tl.aliveVerdict({ aliveTell: t, ...(e || {}) });
  ok(v('spectating Fade with SWITCH PLAYER text bottom left') === 'dead', 'SWITCH PLAYER means dead');
  ok(v('Killed by Clove, spectating own death') === 'dead', 'a killcam means dead');
  ok(v('own HP 74 and Bandit bottom center') === 'alive', 'seeing your own hud means alive');

  // The screenshot for this frame shows a living player at 100 HP with the
  // scoreboard open. The server used to force it dead on the word "spectating"
  // alone, and the flag in the stored log is still wrong, so the evidence in the
  // tell has to win over the flag.
  ok(v('own HP 100 and knife bottom center, spectating scoreboard', { playerAlive: false }) === 'alive',
    'spectating the SCOREBOARD is not spectating a player');

  // The reverse trap: a health number read off the spectated teammate's hud.
  ok(v('Spectating THINKtwise with 87 HP and Vandal bottom center', { playerHp: 87, playerAlive: true }) === 'dead',
    "a teammate's health number does not make you alive");

  // THE SPECTATORS COUNTER counts who is watching the player, on a LIVING
  // player's hud: read as "Spectating 1" on the Sunset match it put a death in
  // the log's list that the engine (spectate-tells.js countsSpectators) no
  // longer registers, so the viewer said 6 deaths where the review said 5.
  ok(v('Spectating 1 top right and teammate shown, no own HP', { playerAlive: false }) !== 'dead'
    && v('SPECTATORS 1 top right, teammate centered with own weapon') !== 'dead',
  'the SPECTATORS counter is a living player\'s hud, never spectating');
  ok(v('Spectating 1 top right, SWITCH PLAYER bottom left') === 'dead',
    'and beside the spectator screen\'s own words, it is still dead');
}

{
  // A lone dead frame between living ones. Both of these were opened: the player
  // is mid round holding their own weapon, with a teammate merely visible.
  const recs = [
    at('own HP 100 and Vandal bottom center'),
    at('own HP 100 and Vandal bottom center'),
    dead('Spectating teammate at C Garage with Sheriff'),
    at('own HP 87 and Vandal bottom center'),
    at('own HP 87 and Vandal bottom center'),
  ];
  ok(tl.deaths(recs).length === 0, 'a single unproven dead frame is not a death');
}
{
  // The same shape, but the game printed SWITCH PLAYER, so it is real.
  const recs = [
    at('own HP 100 and Vandal bottom center'),
    dead('Spectating Reyna with SWITCH PLAYER text bottom left'),
    at('own HP 100 and knife bottom center'),
  ];
  ok(tl.deaths(recs).length === 1, 'a single PROVEN dead frame is a death');
}
{
  // Unproven but sustained: dying ends your round, so the spectator hud stays up.
  const recs = [
    at('own HP 100 and Vandal bottom center'),
    dead('Spectating Fade, own loadout replaced by teammate name'),
    dead('spectating Fade with no own HP'),
    at('own HP 100 and knife bottom center'),
  ];
  const d = tl.deaths(recs);
  ok(d.length === 1 && d[0].at === 1, 'an unproven death that LASTS counts, and is placed at its first frame');
}
{
  // Two deaths in a row must not merge, and a review only counts for its own.
  const recs = [
    at('own HP 100 and knife bottom center'),
    dead('Killed by Clove, spectating own death'),
    dead('Spectating Fade, own loadout not visible'),
    at('own HP 100 and knife bottom center'),
    at('own HP 100 and Vandal bottom center'),
    dead('spectating Fade with SWITCH PLAYER text bottom left'),
    dead('Spectating iphone5 with SWITCH PLAYER'),
  ];
  recs[1].shown = { text: 'you walked out alone', death: true };
  const d = tl.deaths(recs);
  ok(d.length === 2, `two separate deaths stay separate (got ${d.length})`);
  ok(d[0].reviewed === true && d[1].reviewed === false, 'reviewed is tracked per death');
  ok(d[0].killedBy === 'Clove', `the killer is read when it is stated (${d[0].killedBy})`);
}
{
  // Joining mid death still counts it, rather than reporting a session with a
  // visible death review as having had no deaths.
  const recs = [
    dead('Spectating Fade with SWITCH PLAYER text bottom left'),
    dead('Spectating Fade, killed by Clove'),
    at('own HP 100 and knife bottom center'),
  ];
  const d = tl.deaths(recs);
  ok(d.length === 1 && d[0].joinedInProgress === true, 'a session opening mid death still records it');
}
{
  // The stale combat report. "KILLED BY CLOVE" stays on screen through the end
  // of the round and into the next buy phase, and three real frames carried it
  // while the player was alive at full health.
  const recs = [
    at('own HP 100 and knife bottom center, KILLED BY CLOVE panel on right', { killFeed: 'Killed by Clove' }),
    at('own HP 100 and knife bottom center, combat report visible', { killFeed: 'Killed by Clove' }),
    at('own HP 100 and Vandal bottom center', { killFeed: 'Killed by Clove' }),
  ];
  ok(tl.deaths(recs).length === 0, 'a leftover KILLED BY panel is not a death');
}
{
  ok(tl.deaths([]).length === 0, 'an empty session has no deaths');
  ok(tl.deaths(null).length === 0, 'a missing session has no deaths');
}

// ── Not its own HUD when the tell says it is missing (8.4.1) ────────────────
// Every death of the player's Fracture swiftplay read KILLED BY and the COMBAT
// REPORT with "no own health number" (or "own HP not visible"), and "own
// health" read as the player's own HUD made the frame alive, so each real
// death was pinned a frame or two late. The tells are the model's words from
// that match, its player names left out.
{
  const v = (t, e) => tl.aliveVerdict({ aliveTell: t, ...(e || {}) });
  ok(!tl.ownHud('KILLED BY ASTRA and COMBAT REPORT panel visible, no own health number')
    && !tl.ownHud('Spectating teammate with SWITCH PLAYER bottom left, own HP not visible')
    && !tl.ownHud('KILLED BY Cypher and COMBAT REPORT with no own health number')
    && !tl.ownHud('KILLED BY upper right, COMBAT REPORT, own HP not')
    && !tl.ownHud('KILLED BY Sage combat report, no own HP')
    && !tl.ownHud('COMBAT REPORT and KILLED BY REYNA upper right, own health number not shown'),
  'a negation beside the words, before them or after them, is no own HUD');
  ok(tl.ownHud('own HP 100 and Ghost bottom left, no death overlay')
    && tl.ownHud('KILLED BY Reyna and COMBAT REPORT with own HP 120 shown, no ')
    && tl.ownHud('own HP 74 and Bandit bottom center')
    && tl.ownHud('no death screen, own abilities and Vandal visible'),
  'and the player\'s own HUD read plainly still is, a negation of something else beside it');
  ok(v('KILLED BY ASTRA and COMBAT REPORT panel visible, no own health number', { playerAlive: false }) === 'dead',
    'so a frame saying KILLED BY with no own health number, its flag dead, is dead');
  const recs = [
    at('own HP 57 and Spectre bottom center', { playerAlive: true }),
    dead('KILLED BY ASTRA and COMBAT REPORT panel visible, no own health number', { playerAlive: false }),
    dead('KILLED BY ASTRA and COMBAT REPORT shown, no own HP number', { playerAlive: false }),
    dead('Spectating teammate with SWITCH PLAYER bottom left, own HP not visible', { playerAlive: false }),
  ];
  const d = tl.deaths(recs);
  ok(d.length === 1 && d[0].at === 1 && d[0].lastAlive === 0,
    `in a log from before 8.0 the death is on its first dead frame, not the first that says nothing of the HUD (at ${d[0] && d[0].at})`);
  ok(v('Spectating 1 top right and teammate shown, no own HP', { playerAlive: false }) === 'unknown',
    'a dead flag on the SPECTATORS counter alone is no evidence either way, as the engine drops that read');
}

// ── The engine's own deaths, in a log it wrote (8.4.1) ──────────────────────
// Since 8.0 every record carries `died`, true on the frame the engine
// registered a death on, and `round`, the round its ledger filed the frame
// under; a death on trial is written with its verdict. Modelled on the
// player's Fracture swiftplay: the log's own runs listed 6 deaths there, the
// engine registered 5, its ledger kept 4 and Riot has 3.
{
  const M = 1791937491610;
  const rec = (k, round, state, died) => ({ i: k, at: M + k * 1000, frame: `frame-${String(k).padStart(5, '0')}.jpg`, state, round, died: !!died, match: M });
  const ALIVE = { playerAlive: true, playerHp: 100, aliveTell: 'own HP 100 and Classic bottom left' };
  const SWITCH = { playerAlive: false, aliveTell: "Spectating, teammate's portrait and name above SWITCH PLAYER" };
  const KILLED = (who) => ({ playerAlive: false, aliveTell: `KILLED BY ${who} and COMBAT REPORT panel visible, no own health number` });
  const SPECTATING = { playerAlive: false, aliveTell: 'Spectating teammate with SWITCH PLAYER bottom left' };
  const recs = [
    rec(0, 1, ALIVE), rec(1, 1, SWITCH, true), rec(2, 1, SWITCH), rec(3, 1, ALIVE),
    rec(4, 2, ALIVE), rec(5, 2, KILLED('ASTRA'), true), rec(6, 2, KILLED('ASTRA')), rec(7, 2, SPECTATING),
    // Round 3: a death on a weak tell the next read withdrew, written false
    // with its verdict, then one SWITCH PLAYER frame the cooldown held.
    rec(8, 3, ALIVE), rec(9, 3, { playerAlive: false, aliveTell: 'Spectating teammate, own HP not shown' }), rec(10, 3, ALIVE),
    rec(11, 3, { playerAlive: false, aliveTell: 'Spectating, teammate portrait and SWITCH PLAYER bottom left' }), rec(12, 3, ALIVE),
    rec(13, 5, ALIVE), rec(14, 5, KILLED('JETT'), true), rec(15, 5, KILLED('JETT')),
    // Round 6 registered twice, the second after a one read false return.
    rec(16, 6, ALIVE), rec(17, 6, KILLED('CHAMBER'), true), rec(18, 6, SPECTATING),
    rec(19, 6, { playerAlive: true, playerHp: 50, aliveTell: 'own HP 50 and Sheriff bottom center' }),
    rec(20, 6, SPECTATING, true), rec(21, 6, SPECTATING),
  ];
  ok(tl.engineWrote(recs) && !tl.engineWrote(recs.map(({ died, round, ...r }) => r)),
    'a log is the engine\'s when its records carry its verdict, and one from before 8.0 is not');
  const d = tl.deaths(recs);
  ok(JSON.stringify(d.map((x) => x.at)) === JSON.stringify([1, 5, 14, 17]) && d.every((x) => x.registered === true),
    `the deaths are the frames the engine registered, one a round, the withdrawn and the unregistered out (${d.map((x) => x.at).join(', ')}, as 48, 91, 301 and 324 were)`);
  ok(JSON.stringify(d.map((x) => x.round)) === JSON.stringify([1, 2, 5, 6]) && JSON.stringify(d.map((x) => x.killedBy)) === JSON.stringify([null, 'Astra', 'Jett', 'Chamber']),
    `each in the round its ledger filed it under, with its killer (${d.map((x) => `${x.round} ${x.killedBy}`).join(', ')})`);
  ok(d[0].lastAlive === 0 && d[0].gapMs === 1000 && JSON.stringify(d[0].runUp) === JSON.stringify([0, 1, 2]) && !d[0].joinedInProgress,
    'with its run up from the last frame of the player\'s own HUD');
  const runs = tl.deaths(recs.map(({ died, round, ...r }) => r));
  ok(runs.length === 6, `the same frames found in runs, as a log before 8.0 is, are the 6 the log said (${runs.length})`);
  // A record with no round of its own, read after the watch ended a match: the
  // ended match's, in the round its own score says, and with no score read the
  // round before it. The player's 8.0.1 Split session ended its match at 3 to 5
  // in round 9 and read on to 12 to 7 under no round, the engine registering
  // deaths all the way (here under the next match's stamp, as it wrote them).
  const after = [rec(0, 4, ALIVE), rec(1, null, KILLED('SAGE'), true), rec(2, 4, ALIVE), rec(3, 4, KILLED('SAGE'), true)];
  const da = tl.deaths(after);
  ok(da.length === 1 && da[0].at === 1 && da[0].round === 4, 'a death on a record with no round and no score is the round before it\'s, still one a round');
  const score = (team, enemy) => ({ ...KILLED('SAGE'), teamScore: team, enemyScore: enemy });
  const ended = [rec(0, 9, ALIVE), rec(1, 9, score(3, 5), true),
    { ...rec(2, null, score(3, 5)), match: M + 9 }, { ...rec(3, null, score(3, 5), true), match: M + 9 },
    { ...rec(4, null, score(4, 5), true), match: M + 9 }, { ...rec(5, null, score(4, 5), true), match: M + 9 },
    { ...rec(6, null, score(12, 7), true), match: M + 9 }];
  const de = tl.deaths(ended);
  ok(JSON.stringify(de.map((x) => [x.at, x.round])) === JSON.stringify([[1, 9], [4, 10], [6, 20]]),
    `after a match the watch ended, each death is in the round its score says, round 9's own counted once (${de.map((x) => `${x.at} r${x.round}`).join(', ')})`);
  ok(tl.deathSanity(ended).rounds === 20 && !tl.deathSanity(ended).overCeiling, 'and the rounds it counts against reach as far');
  // Two matches in one session each count their own rounds.
  const two = [rec(0, 1, ALIVE), rec(1, 1, KILLED('SAGE'), true), { ...rec(2, 1, ALIVE), match: M + 1 }, { ...rec(3, 1, KILLED('SAGE'), true), match: M + 1 }];
  ok(tl.deaths(two).length === 2, 'a round 1 death in each of two matches is two deaths');
  ok(tl.deathSanity(recs).deaths === 4 && tl.deathSanity(recs).rounds === 6 && !tl.deathSanity(recs).overCeiling,
    'and the sanity check counts them against the ledger\'s rounds');
}

// ── The engine's deaths are its ledger's, on five real sessions ─────────────
// The committed sessions, the player's Fracture swiftplay among them, read by
// read through the real reader on the clock they were recorded on (as
// scripts/fixtures/replay-session.js does), each frame kept as the AI log keeps
// it, and a death still on trial at the end settled as stop() settles it. The
// deaths the log lists are the rounds the ledger has a death in, round for
// round. And a death on the banner, driven through the same engine.
{
  const Module = require('module');
  const REPO = path.join(__dirname, '..');
  const realLoad = Module._load;
  Module._load = function patched(request, parent, isMain) {
    if (request === './api-client') return { post: async () => ({ ok: false, status: 0, data: null }), get: async () => ({ ok: false, status: 0, data: null }) };
    return realLoad(request, parent, isMain);
  };
  // A fresh copy with no network: ai-log-timeline.js loaded the real one above.
  const file = require.resolve(path.join(REPO, 'src', 'main', 'services', 'coaching-engine.js'));
  delete require.cache[file];
  let CoachingEngine;
  try { CoachingEngine = require(file); } finally { Module._load = realLoad; delete require.cache[file]; }
  const T0 = Date.parse('2026-10-04T20:00:00Z');
  const run = (frames) => {
    const records = [];
    let clock = T0;
    const realNow = Date.now;
    const realLog = console.log;
    Date.now = () => clock;
    console.log = () => {};
    let ledger = [];
    try {
      const e = new CoachingEngine({
        licenseKey: 'TEST', captureFunction: async () => null, experiments: () => ({}),
        diagnostics: (x) => records.push({ i: records.length, at: x.at, frame: `frame-${String(records.length).padStart(5, '0')}.jpg`,
          state: x.state || {}, round: typeof x.round === 'number' ? x.round : null, died: !!x.died, match: x.match || null }),
      });
      e.isRunning = true;
      for (const f of frames) {
        clock = T0 + f.t * 1000;
        const { t, ...context } = f;
        e.applyRead({ data: { context: { ...context } }, shot: null, at: clock });
      }
      e.settleTrial(true);
      ledger = e.ledger.list().filter((r) => r.died).map((r) => r.n);
    } finally {
      Date.now = realNow;
      console.log = realLog;
    }
    return { records, ledger };
  };
  for (const name of ['abyss-swiftplay', 'abyss-unrated', 'split-competitive', 'sunset-swiftplay', 'fracture-swiftplay']) {
    const { records, ledger } = run(require(path.join(__dirname, 'fixtures', `valorant-session-${name}.json`)).frames);
    const listed = tl.deaths(records).map((x) => x.round);
    const registered = records.filter((r) => r.died).length;
    ok(JSON.stringify(listed) === JSON.stringify(ledger),
      `${name}: the log lists the ledger's ${ledger.length} deaths, round for round, of the ${registered} the engine registered`
        + (JSON.stringify(listed) === JSON.stringify(ledger) ? '' : ` (log ${listed.join(',')}, ledger ${ledger.join(',')})`));
  }

  // A DEATH ON THE BANNER (8.4.1). Five rounds read a second, the player dying
  // in rounds 2, 3 and 4, round 3's death on the banner that already printed
  // the next score: read alive on the banner's first frame, dead on its second,
  // the read that takes the score's step. The engine's ledger files that death
  // back into round 3; its record carries round 4, the round the ledger was on,
  // as round 4's own death does.
  const frames = [];
  let t = 0;
  const alive = { playerAlive: true, playerHp: 100, playerWeapon: 'Vandal', aliveTell: 'own HP 100 and Vandal bottom right', map: 'Ascent', side: 'attacking' };
  const killed = { phase: 'dead', playerAlive: false, map: 'Ascent', aliveTell: 'KILLED BY REYNA and COMBAT REPORT shown, no own health number', killFeed: 'killed by Reyna' };
  const watching = { playerAlive: false, map: 'Ascent', aliveTell: 'Spectating teammate with SWITCH PLAYER bottom left' };
  const clockOf = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  const play = ([team, enemy], how, won) => {
    for (let s = 30; s >= 1; s--) frames.push({ t: t++, phase: 'buy', teamScore: team, enemyScore: enemy, clock: clockOf(s), ...alive });
    for (let s = 99; s >= 40; s--) {
      if (how === 'dies' && s === 60) {
        for (let k = 0; k < 2; k++) frames.push({ t: t++, teamScore: team, enemyScore: enemy, ...killed });
        for (let k = 0; k < 15; k++) frames.push({ t: t++, phase: 'dead', teamScore: team, enemyScore: enemy, ...watching });
        break;
      }
      frames.push({ t: t++, phase: 'active', teamScore: team, enemyScore: enemy, clock: clockOf(s), ...alive });
    }
    const next = won ? [team + 1, enemy] : [team, enemy + 1];
    if (how === 'banner') {
      frames.push({ t: t++, phase: 'active', teamScore: team, enemyScore: enemy, clock: '0:02', ...alive, playerHp: 20 });
      frames.push({ t: t++, phase: 'active', teamScore: next[0], enemyScore: next[1], clock: '0:01', ...alive, playerHp: 20 });
      for (let k = 0; k < 3; k++) frames.push({ t: t++, teamScore: next[0], enemyScore: next[1], ...killed });
    } else {
      for (let k = 0; k < 3; k++) frames.push({ t: t++, phase: 'active', teamScore: next[0], enemyScore: next[1], clock: '0:01', ...(how === 'dies' ? watching : alive) });
    }
    return next;
  };
  play(play(play(play(play([0, 0], 'lives', true), 'dies', false), 'banner', false), 'dies', false), 'lives', true);
  const { records, ledger } = run(frames);
  const stamped = records.filter((r) => r.died).map((r) => r.round);
  const listed = tl.deaths(records).map((x) => x.round);
  ok(JSON.stringify(ledger) === '[2,3,4]' && JSON.stringify(stamped) === '[2,4,4]',
    `the engine files round 3's banner death back and stamps its record round 4, as the case needs (ledger ${ledger}, records ${stamped})`);
  ok(JSON.stringify(listed) === JSON.stringify(ledger),
    `a death on the banner is the round before's, as the engine's ledger files it (log ${listed}, ledger ${ledger})`);
}

// ── The real 24 round Abyss match, its two banner deaths ────────────────────
// Replayed through its ledger as test-valorant-review.js does (replay-match.js),
// each frame as the AI log keeps it, with the round the ledger was on. Rounds 6
// and 24 died on the banner that already printed the next score: the ledger
// files both back, and their records carry rounds 7 and 25.
{
  const { replay, load } = require(path.join(__dirname, 'fixtures', 'replay-match.js'));
  const verify = require(path.join(__dirname, '..', 'src', 'shared', 'valorant-verify.js'));
  const reconcile = require(path.join(__dirname, '..', 'src', 'main', 'services', 'death-reconcile.js'));
  const abyss = replay(load('valorant-match-abyss-13-11.json').frames, 'standard');
  const ledger = abyss.rounds.filter((r) => r.died).map((r) => r.n);
  const listed = tl.deaths(abyss.records).map((d) => d.round);
  const stamped = abyss.records.filter((r) => r.died).map((r) => r.round);
  ok(stamped.filter((n) => n === 7).length === 2 && stamped.includes(25) && JSON.stringify(listed) === JSON.stringify(ledger),
    `the real Abyss match: the log lists the ledger's ${ledger.length} deaths, round for round, its banner deaths in rounds 6 and 24 (log ${listed.join(',')})`);
  // And Riot's check of them is the review's own sentence.
  const riot = require(path.join(__dirname, 'fixtures', 'riot-abyss-13-11.json'));
  const tracker = { rounds: riot.perRound.length, deaths: riot.perRound.filter((r) => r.died)
    .map((r) => ({ round: r.n, killer: r.killerAgent, weapon: r.weapon, atMs: r.deathMs })) };
  const line = reconcile.summarise(reconcile.reconcile(tl.deaths(abyss.records), tracker, abyss.records));
  const review = verify.describe(verify.reconcile(abyss.rounds, riot).checks);
  ok(line === review, `and Riot's check of them says what the review says (${line})`);
}

// ── Against the real log, if there is one ───────────────────────────────────
// Every session recorded so far is a single match on a single map, and each was
// misreported as two or three maps before this existed.
const root = path.join(require('./profile-path').profileDir(), 'ai-log');
if (fs.existsSync(root)) {
  for (const id of fs.readdirSync(root).filter((f) => /^session-/.test(f))) {
    const p = path.join(root, id, 'log.json');
    if (!fs.existsSync(p)) continue;
    let recs = [];
    try { recs = JSON.parse(fs.readFileSync(p, 'utf8')).records || []; } catch { continue; }
    if (recs.length < 20) continue;
    const segs = tl.segments(recs);
    const raw = new Set(recs.map((r) => r.state && r.state.map).filter(Boolean)).size;
    ok(segs.every((s) => s.confirmed),
      `${id.slice(8, 24)}: ${recs.length} frames, ${raw} maps read, ${segs.length} confirmed segment(s): ${segs.map((s) => s.map).join(' then ')}`);
    // A player dies at most once per round, so this is a hard ceiling and
    // breaking it means a run of frames was read as the wrong state.
    const san = tl.deathSanity(recs);
    ok(!san.overCeiling,
      `${id.slice(8, 24)}: ${san.deaths} deaths in ${san.rounds} rounds, ${san.reviewed} reviewed`);
  }
  // The player's Fracture swiftplay, while this PC keeps its log: the deaths
  // the engine kept, on the frames that registered them, where the log's own
  // runs listed 48, 92, 189, 303, 325 and 339.
  const fracture = path.join(root, 'session-2026-10-14T00-24-51-649Z', 'log.json');
  if (fs.existsSync(fracture)) {
    let recs = [];
    try { recs = JSON.parse(fs.readFileSync(fracture, 'utf8')).records || []; } catch { recs = []; }
    const got = tl.deaths(recs).map((d) => `${String(recs[d.at].frame).slice(6, 11)} r${d.round}`).join(', ');
    ok(got === '00048 r1, 00091 r2, 00301 r5, 00324 r6', `the Fracture swiftplay's deaths are the engine's four: ${got}`);
  }
}

console.log(fails ? `\n${fails} failure(s)` : '\nall ai-log timeline checks passed');
process.exit(fails ? 1 : 0);

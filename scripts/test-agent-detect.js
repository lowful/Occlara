'use strict';

/**
 * English is full of agent names, and the detector was a substring search.
 *
 *     validAgents.find(a => cleanText.toLowerCase().includes(a.toLowerCase()))
 *
 * So the model saying it could not tell was read as a positive identification:
 *
 *     "the icons are not visible at this moment"      -> OMEN     (m-OMEN-t)
 *     "cannot read the ability bar in this isolation" -> ISO       (ISO-lation)
 *     "please check the message area"                 -> SAGE      (mes-SAGE)
 *
 * A wrong lock is expensive. The ability gate validates every tip against the
 * locked agent's kit, so identifying Omen for a Jett player both green-lights
 * smoke advice they cannot follow and blocks the dash advice they can. Returning
 * null costs only a look at another frame.
 *
 * The refusals are the substance of this file: ambiguity and prose must both
 * resolve to null rather than to a guess.
 *
 * AND THE LOOK ON THE PLAYER'S OWN HUD (8.4.4), through the real engine on a
 * fake clock, detect-agent stood in for. No agent is asked of the player at
 * Start any more: a read's own frame of the player's own HUD in a buy phase
 * goes to detect-agent, and two answers on two frames three seconds apart that
 * agree lock the match's agent. Held here: agent select (a LOBBY read) is never
 * sent and Start arms nothing, one answer locks nothing, two agreeing lock it
 * for every guard, a disagreeing one never does, nothing of the death screen
 * or the spectator camera is ever sent, nor the round end countdown, the caps,
 * a new match looking again, the fallback for a player who never leaves the
 * shop and never in a round it did not read begin (Start pressed while dead, a
 * pause lifted while dead), and the route's live prompt byte for byte beside
 * its variant b, an admin bench's alone.
 *
 * AND THE CALL CARRIES THE PLAYER'S BAR ALONE (agent-crop.js): its bounds, its
 * scale and its quality, and nothing sent when it cannot be cut, never the
 * frame; a buy frame whose own timer ends away from the ledger's buy end is
 * none to look at, nor one after a death until a round has ended (the
 * spectator camera's teammate's HUD called own on a misread clock, a post
 * plant's, the round clock late in a round); and THE LOOK IS OFF
 * (AGENT_LOOKS_PER_MATCH 0), since the
 * crop's live bench locked the wrong agent: a default engine sends nothing and
 * locks nothing, and the rules above run on an engine turned on by hand, eight
 * looks a match, as they will once a reader passes its bench.
 *
 * Run: npm run test:agentdetect
 */
const path = require('path');

// coach.js builds a Supabase client at import time; detectAgentName never uses it.
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'test-key-not-used';

const { detectAgentName } = require(path.join(__dirname, '..', 'server', 'routes', 'coach.js'));

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const ok = got === want;
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `\n        got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`);
};

console.log('THE FALSE POSITIVES THAT SHIPPED, every one of these must be null:');
for (const [reply, wrongly] of [
  ['The icons are not visible at this moment', 'Omen'],
  ['Cannot read the ability bar in this isolation view', 'Iso'],
  ['Please check the message area', 'Sage'],
  ['I am not sure, the phoenix-like flames are unclear', 'Phoenix'],
  ['The moment the round starts I could tell', 'Omen'],
]) {
  check(`  "${reply.slice(0, 48)}" (was ${wrongly})`, detectAgentName(reply), null);
}

console.log('\nthe answer the prompt actually asks for:');
for (const a of ['Jett', 'Omen', 'Iso', 'Sage', 'Phoenix', 'KAY/O', 'Waylay', 'Tejo']) {
  check(`  "${a}"`, detectAgentName(a), a);
}

console.log('\ncase and stray punctuation do not matter:');
check('  "jett"',      detectAgentName('jett'), 'Jett');
check('  "KILLJOY"',   detectAgentName('KILLJOY'), 'Killjoy');
check('  "Jett."',     detectAgentName('Jett.'), 'Jett');
check('  "  Omen  "',  detectAgentName('  Omen  '), 'Omen');
check('  "Sova!"',     detectAgentName('Sova!'), 'Sova');

console.log('\nKAY/O survives the spellings a model reaches for:');
check('  "KAYO"',      detectAgentName('KAYO'), 'KAY/O');
check('  "KAY-O"',     detectAgentName('KAY-O'), 'KAY/O');
check('  "Kay O"',     detectAgentName('Kay O'), 'KAY/O');

console.log('\na short answer that still names one agent is accepted:');
check('  "Agent: Jett"',   detectAgentName('Agent: Jett'), 'Jett');
check('  "It is Jett"',    detectAgentName('It is Jett'), 'Jett');
check('  "Jett (Duelist)"', detectAgentName('Jett (Duelist)'), 'Jett');

console.log('\nthe refusals:');
check('  "UNKNOWN"',          detectAgentName('UNKNOWN'), null);
check('  empty',              detectAgentName(''), null);
check('  null',               detectAgentName(null), null);
check('  undefined',          detectAgentName(undefined), null);
check('  two agents named',   detectAgentName('Jett or Reyna'), null);
check('  a whole sentence',   detectAgentName('The agent appears to be Jett based on the four ability icons'), null);
check('  a non-agent word',   detectAgentName('Duelist'), null);
check('  a refusal sentence', detectAgentName('I cannot determine the agent from this frame'), null);

// ── THE LOOK ON THE PLAYER'S OWN HUD (8.4.4) ─────────────────────────────────
const crypto = require('crypto');
const Module = require('module');
const REPO = path.join(__dirname, '..');
const { API } = require(path.join(REPO, 'src', 'shared', 'config.js'));
const ok = (cond, name, detail) => {
  cond ? pass++ : fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond || !detail ? '' : `\n        ${detail}`}`);
};

// The clock every guard reads, moved by hand, and detect-agent stood in for:
// each call is kept, and answered when the test says, with the name it says.
const T0 = Date.parse('2026-10-14T00:24:00Z');
let clock = T0;
const realNow = Date.now;
const net = { calls: [] };
const CoachingEngine = (() => {
  const realLoad = Module._load;
  Module._load = function patched(request, parent, isMain) {
    if (request === './api-client') {
      return {
        post: (p, body, key, timeoutMs) => {
          if (p !== API.DETECT_AGENT) return new Promise(() => {});
          const call = { image: body && body.image, timeoutMs, at: clock };
          net.calls.push(call);
          return new Promise((resolve) => { call.answer = (agent) => resolve({ ok: true, status: 200, data: { agent } }); });
        },
        get: () => new Promise(() => {}),
      };
    }
    return realLoad(request, parent, isMain);
  };
  const file = require.resolve(path.join(REPO, 'src', 'main', 'services', 'coaching-engine.js'));
  delete require.cache[file];
  try { return require(file); } finally { Module._load = realLoad; }
})();

const settle = async () => { for (let i = 0; i < 4; i++) await new Promise((r) => setImmediate(r)); };
// The look as it runs once it is on: eight looks a match, what
// AGENT_LOOKS_PER_MATCH was before the crop's bench turned it off.
const LOOKS_WHEN_ON = 8;
/**
 * A reader as the app runs one, with no heartbeat: reads are applied by hand.
 * Its cropper stands in for agent-crop.js on Electron's nativeImage, the bar
 * of `frame-N` being `bar:frame-N` (`crop` another, or null for none), and
 * `on` turns the look on by hand, as a passed bench would.
 */
function reader({ on = true, crop } = {}) {
  net.calls.length = 0;
  const e = new CoachingEngine({ licenseKey: 'TEST', captureFunction: async () => null, experiments: () => ({}),
    cropAgent: crop === undefined ? (shot) => `bar:${shot}` : crop });
  e.isRunning = true;
  if (on) e.agentLooksPerMatch = LOOKS_WHEN_ON;
  return e;
}
/** One read applied, its frame captured `sec` seconds in: a context, or 'LOBBY'. */
function read(e, sec, ctx) {
  clock = T0 + sec * 1000;
  const data = ctx === 'LOBBY' ? { lobby: true, context: {} } : { lobby: false, context: JSON.parse(JSON.stringify(ctx)) };
  e.applyRead({ data, shot: `frame-${sec}`, at: clock });
}
/** The newest call still out answered with `agent`, and what it set off run to its end. */
async function answer(agent) {
  const call = [...net.calls].reverse().find((c) => !c.done);
  if (call) { call.done = true; call.answer(agent); }
  await settle();
}
// A buy phase frame of the player's own HUD, as the read reports one: round 1
// of the player's Fracture swiftplay, frame-00000, "0:39", own HP 100 and a
// Classic. `left` is the buy timer.
const BUY = (left, extra) => ({ phase: 'buy', clock: `0:${String(left).padStart(2, '0')}`, teamScore: 0, enemyScore: 0,
  side: 'defending', playerAlive: true, playerHp: 100, playerWeapon: 'Classic', aliveTell: 'own HP 100 and Classic bottom left', ...extra });
const LIVE = (clockText, extra) => ({ phase: 'active', clock: clockText, teamScore: 0, enemyScore: 0, side: 'defending',
  playerAlive: true, playerHp: 100, playerWeapon: 'Vandal', aliveTell: 'own HP 100 and Vandal bottom left', ...extra });
const agentOf = (e) => `${e.matchContext.agent} confirmed ${e.matchContext.agentConfirmed} source ${e.matchContext.agentSource}`;

(async () => {
  Date.now = () => clock;
  const quiet = console.log;
  const lines = [];
  const hush = () => { console.log = (...a) => lines.push(a.join(' ')); };
  const speak = () => { console.log = quiet; };
  try {
    // A TEAMMATE'S KIT AT AGENT SELECT IS NEVER THE PLAYER'S. Start is pressed
    // in the menus or in agent select, and the 8.4.3 engine captured a frame of
    // its own three seconds later and every 30 after, its answer asked of the
    // player nine seconds in: on the Fracture swiftplay it named a teammate's
    // KAY/O off agent select. Start arms nothing now, and a read the model
    // calls LOBBY, as agent select is, is never sent.
    console.log('\nthe look on the player\'s own HUD (8.4.4):');
    {
      // The screen as Start finds it, agent select: a capture made now would
      // be of it, so every capture is counted.
      const e = reader();
      let captures = 0;
      e.captureFunction = async () => { captures++; return 'agent-select-frame'; };
      e.isRunning = false;
      hush();
      e.start();
      clearInterval(e.loopTimer);
      e.loopTimer = null;
      speak();
      ok(e.timers.length === 0 && !e.agentTimer, 'Start arms nothing to look for the agent: no timer, no frame of its own',
        `${e.timers.length} timers, agent timer ${!!e.agentTimer}`);
      hush();
      for (let s = 0; s < 60; s++) read(e, s, 'LOBBY');
      // Past the three real seconds after which 8.4.3 captured its own frame.
      await new Promise((r) => setTimeout(r, 3300));
      await settle();
      speak();
      ok(net.calls.length === 0 && captures === 0 && e.matchContext.agent === null,
        'a minute of agent select, every read a LOBBY, captures nothing, sends no frame and names no agent',
        `${captures} captures, ${net.calls.length} sent, ${agentOf(e)}`);
      hush();
      read(e, 60, BUY(44));
      speak();
      ok(net.calls.length === 1 && net.calls[0].image === 'bar:frame-60' && net.calls[0].timeoutMs === 30000,
        'the first frame sent is the first buy phase read of the player\'s own HUD, that read\'s own frame cut to the bar, waited on 30 seconds',
        JSON.stringify(net.calls.map((c) => ({ image: c.image, timeoutMs: c.timeoutMs }))));
      hush();
      e.stop();
      speak();
    }

    // TWO AGREEING BUY PHASE LOOKS LOCK IT, AND ONE ALONE DOES NOT. Two frames
    // three seconds apart at the least, the second sent once the first came
    // back. Locked, it is the confirmed agent every guard holds the HUD to and
    // the read is told, found by the HUD, and nothing more is sent.
    {
      const e = reader();
      hush();
      read(e, 0, BUY(44));
      await answer('Jett');
      speak();
      ok(e.matchContext.agent === null && !e.matchContext.agentConfirmed && e.readContext().agent === null,
        'one answer locks nothing: the agent waits for a second frame to agree', agentOf(e));
      hush();
      read(e, 1, BUY(43));
      read(e, 2, BUY(42));
      speak();
      ok(net.calls.length === 1, 'and no frame closer than three seconds to the last one sent goes', `${net.calls.length} sent`);
      hush();
      read(e, 4, BUY(40));
      await answer('Jett');
      speak();
      ok(net.calls.length === 2 && net.calls[1].image === 'bar:frame-4' && e.matchContext.agent === 'Jett'
        && e.matchContext.agentConfirmed === true && e.matchContext.agentSource === 'hud',
      'two answers on two frames four seconds apart that agree lock it, confirmed and found by the HUD, in two calls',
      `${net.calls.length} calls, ${agentOf(e)}`);
      ok(e.readContext().agent === 'Jett', 'the read is told it, as it was told an agent the player confirmed', JSON.stringify(e.readContext()));
      hush();
      for (let s = 5; s < 45; s++) read(e, s, BUY(Math.max(0, 44 - s)));
      read(e, 46, LIVE('1:38'));
      read(e, 47, LIVE('1:37', { aliveTell: 'own HP 100 and Sova abilities bottom center' }));
      speak();
      ok(net.calls.length === 2, 'locked, nothing more is sent for the rest of the match', `${net.calls.length} calls`);
      ok(e.hudRead && e.hudRead.spectating && e.hudRead.signals.some((s) => /Sova/.test(s)),
        'and the spectate guard holds the HUD to it: a teammate\'s kit called "own" is somebody else\'s HUD',
        JSON.stringify(e.hudRead && e.hudRead.signals));
    }

    // ONE THAT DISAGREES NEVER LOCKS. The next answer is the one that must
    // agree with the one after it; an answer naming no agent is no evidence
    // either way.
    {
      const e = reader();
      hush();
      read(e, 0, BUY(44));
      await answer('KAY/O');
      read(e, 4, BUY(40));
      await answer('Jett');
      speak();
      ok(e.matchContext.agent === null && net.calls.length === 2, 'KAY/O then Jett: no lock, the look goes on', agentOf(e));
      hush();
      read(e, 8, BUY(36));
      await answer(null);
      speak();
      ok(e.matchContext.agent === null, 'an answer naming none locks nothing', agentOf(e));
      hush();
      read(e, 12, BUY(32));
      speak();
      ok(net.calls.length === 3, 'and a round sends three at most: the fourth waits for the next buy phase', `${net.calls.length} calls`);
      hush();
      read(e, 60, LIVE('1:30'));
      read(e, 150, BUY(29, { teamScore: 1, enemyScore: 0 }));
      await answer('Jett');
      speak();
      ok(e.matchContext.agent === 'Jett' && e.matchContext.agentSource === 'hud' && net.calls.length === 4,
        'where the Jett it sends agrees with round 1\'s Jett, across the answer that named none: locked in four calls',
        `${net.calls.length} calls, ${agentOf(e)}`);
    }
    {
      // A name the game data does not know, or one only near a real one, locks nothing.
      const e = reader();
      hush();
      read(e, 0, BUY(44)); await answer('Jettson');
      read(e, 4, BUY(40)); await answer('Jettson');
      speak();
      ok(e.matchContext.agent === null, 'a name the game data does not know locks nothing, never the agent it starts like', agentOf(e));
      const k = reader();
      hush();
      read(k, 0, BUY(44)); await answer('KAYO');
      read(k, 4, BUY(40)); await answer('kay/o');
      speak();
      ok(k.matchContext.agent === 'KAY/O', 'and KAYO and kay/o are both KAY/O, the game\'s own name', agentOf(k));
    }

    // SPECTATING NEVER LOOKS. A dead player's HUD is the spectated teammate's,
    // which is how detection named the wrong agent for a whole match, and the
    // buy phase is where the COMBAT REPORT of the round before shows the
    // killer's face: none of it is sent, whatever the read says of the health.
    {
      const e = reader();
      hush();
      read(e, 0, LIVE('1:30'));
      read(e, 4, LIVE('1:26', { playerAlive: false, playerHp: null, phase: 'dead', aliveTell: 'KILLED BY Astra and COMBAT REPORT, SWITCH PLAYER bottom left' }));
      read(e, 8, LIVE('1:22', { playerAlive: true, playerHp: 100, aliveTell: 'own HP 100 and Vandal bottom left' }));
      read(e, 12, LIVE('1:18', { playerAlive: true, playerHp: 100, aliveTell: 'own HP 100 and Vandal bottom left' }));
      speak();
      ok(net.calls.length === 0, 'a death and the spectator camera after it, the teammate\'s HUD read as "own", send nothing', `${net.calls.length} sent`);
      const e2 = reader();
      hush();
      read(e2, 0, BUY(44, { aliveTell: 'Spectating teammate laufey, own HP 100 shown' }));
      read(e2, 4, BUY(40, { aliveTell: 'COMBAT REPORT and KILLED BY ASTRA upper right, own HP 100' }));
      read(e2, 8, BUY(36, { killFeed: 'KILLED BY Astra' }));
      read(e2, 12, BUY(32, { playerHp: null, aliveTell: 'own HP not visible, Classic bottom left' }));
      read(e2, 16, BUY(28, { aliveTell: 'unclear, own HP 100 and Classic' }));
      speak();
      ok(net.calls.length === 0, 'nor a buy phase frame whose read names the spectator camera, the combat report or the killer, has no health of its own or is unsure',
        `${net.calls.length} sent: ${net.calls.map((c) => c.image).join(', ')}`);
      hush();
      read(e2, 20, BUY(24));
      speak();
      ok(net.calls.length === 1 && net.calls[0].image === 'bar:frame-20', 'and the next frame of the player\'s own HUD is', `${net.calls.map((c) => c.image)}`);
    }

    // NOT THE ROUND END COUNTDOWN, which reads like a buy timer (0:07 to 0:00
    // on the Fracture swiftplay, the TAB scoreboard with every agent's portrait
    // open over one), and no buy timer that began before the last frame of play.
    {
      // The player died early and watched the round out, so nothing since has
      // been play: the countdown's own clock puts its start after the last
      // frame of play, and the 0:08 floor alone keeps it out.
      const e = reader();
      hush();
      read(e, 0, LIVE('1:30'));
      read(e, 4, LIVE('1:26', { playerAlive: false, playerHp: null, phase: 'dead', aliveTell: 'KILLED BY Astra and COMBAT REPORT shown' }));
      for (let s = 10; s <= 60; s += 10) {
        read(e, s, LIVE(null, { playerAlive: false, playerHp: null, phase: 'dead', aliveTell: 'Spectating laufey with SWITCH PLAYER bottom left' }));
      }
      read(e, 70, BUY(7, { aliveTell: 'own HP 100 and Vandal bottom left' }));
      read(e, 74, BUY(3, { aliveTell: 'own HP 100 and Vandal bottom left' }));
      speak();
      ok(net.calls.length === 0, 'the round end countdown\'s 0:07 and 0:03 send nothing, though the HUD under them reads as the player\'s',
        `${net.calls.map((c) => c.image)}`);
      hush();
      read(e, 78, BUY(29, { teamScore: 0, enemyScore: 1 }));
      speak();
      ok(net.calls.length === 1 && net.calls[0].image === 'bar:frame-78', 'and the buy phase after it does', `${net.calls.map((c) => c.image)}`);
      // A buy timer whose own clock starts it inside the round still being
      // played is no buy phase (valorant-rounds.js beganAfterPlay).
      const f = reader();
      hush();
      for (let s = 0; s <= 40; s += 10) read(f, s, LIVE(`${s <= 10 ? 1 : 0}:${String((70 - s) % 60).padStart(2, '0')}`));
      read(f, 43, BUY(20));
      speak();
      ok(net.calls.length === 0, 'nor a 0:20 read three seconds after a 0:30 of the round: its start is ten seconds before that frame of play',
        `${net.calls.map((c) => c.image)}`);
    }

    // AT MOST THREE CALLS A ROUND AND EIGHT A MATCH, one out at a time.
    {
      const e = reader();
      hush();
      read(e, 0, BUY(44));
      read(e, 4, BUY(40));
      speak();
      ok(net.calls.length === 1, 'one look out at a time', `${net.calls.length} out`);
      hush();
      for (let s = 4; s <= 36; s += 4) { read(e, s, BUY(44 - s)); await answer(null); }
      speak();
      const round1 = net.calls.length;
      let sec = 100;
      for (let round = 1; round <= 6; round++) {
        hush();
        read(e, sec, LIVE('1:30', { teamScore: round, enemyScore: 0 }));
        read(e, sec + 1, LIVE('1:29', { teamScore: round, enemyScore: 0 }));
        sec += 60;
        for (let k = 0; k < 6; k++) { read(e, sec + k * 4, BUY(40 - k * 4, { teamScore: round, enemyScore: 0 })); await answer(null); }
        sec += 40;
        speak();
      }
      ok(round1 === 3 && net.calls.length === 8, `three calls in a round, eight in a match, however many frames go unanswered (${round1}, ${net.calls.length})`);
    }

    // A NEW MATCH LOOKS AGAIN, and an answer about the last match's frame
    // never lands in it.
    {
      const e = reader();
      hush();
      read(e, 0, BUY(44)); await answer('Jett');
      read(e, 4, BUY(40)); await answer('Jett');
      read(e, 8, BUY(36));
      e.beginMatch(true);
      speak();
      ok(e.matchContext.agent === null && e.matchContext.agentSource === null && !e.matchContext.agentConfirmed,
        'the agent goes with its match', agentOf(e));
      hush();
      read(e, 20, BUY(44)); const k = net.calls.length;
      e.beginMatch(true);
      net.calls[k - 1].done = true;
      net.calls[k - 1].answer('Reyna');
      await settle();
      read(e, 30, BUY(34)); await answer('Reyna');
      speak();
      ok(e.matchContext.agent === null, 'and an answer still out when the match ended is dropped, never one of the next match\'s two', agentOf(e));
      hush();
      read(e, 34, BUY(30)); await answer('Reyna');
      speak();
      ok(e.matchContext.agent === 'Reyna', 'the next match locks its own off two of its own frames', agentOf(e));
    }

    // THE FALLBACK, for a player who never leaves the shop in a buy phase,
    // every buy read a LOBBY: from round 4, a live round's first 20 seconds,
    // the tell claiming the player's own HUD, no sign of anyone else's.
    {
      const e = reader();
      hush();
      let sec = 0;
      const round = (team) => {
        read(e, sec, 'LOBBY');
        read(e, sec + 30, LIVE('1:38', { teamScore: team, enemyScore: 0 }));
        read(e, sec + 34, LIVE('1:34', { teamScore: team, enemyScore: 0 }));
        sec += 100;
      };
      round(0); round(1); round(2);
      speak();
      ok(net.calls.length === 0, 'no live round frame is sent in the first three rounds', `${net.calls.length} sent`);
      hush();
      round(3);
      await answer('Jett');
      read(e, sec + 30, LIVE('1:38', { teamScore: 4, enemyScore: 0 }));
      await answer('Jett');
      speak();
      ok(e.matchContext.agent === 'Jett' && net.calls.length === 2, 'from round 4 the first seconds of a live round are, and two agree',
        `${net.calls.length} sent, ${agentOf(e)}`);
      // Its one buy phase frame answered with no agent, then rounds 1 to 5
      // read live and nothing else, each score read twice so the step stands.
      const f = reader();
      hush();
      sec = 0;
      read(f, 0, BUY(44));
      await answer(null);
      for (const team of [0, 1, 2, 3, 4]) {
        read(f, sec + 50, LIVE('1:38', { teamScore: team, enemyScore: 0 }));
        read(f, sec + 54, LIVE('1:34', { teamScore: team, enemyScore: 0 }));
        sec += 100;
      }
      speak();
      ok(net.calls.length === 1 && net.calls[0].image === 'bar:frame-0' && f.ledger.current() === 5,
        'a match a buy phase frame has shown the HUD in never falls back to the live round, round 5 included',
        `${net.calls.map((c) => c.image)}, round ${f.ledger.current()}`);
    }

    // AND THE FALLBACK ONLY IN A ROUND READ AS IT BEGAN. Start is pressed mid
    // match too, and in Occlara's own window, read as a LOBBY: here while dead
    // in round 6's first 20 seconds, the spectated teammate's HUD read as the
    // player's own (the spectator trap) on frames no sign flagged and no death
    // registered. Sent, two answers naming the teammate's Sova locked it as
    // the player's. A pause lifted while dead is the same round unseen.
    {
      const e = reader();
      hush();
      const trap = { teamScore: 3, enemyScore: 2, playerWeapon: 'Ghost', aliveTell: 'own HP 100 and Ghost bottom left' };
      read(e, 0, 'LOBBY');
      read(e, 2, LIVE('1:30', trap));
      read(e, 6, LIVE('1:26', trap));
      await answer('Sova');
      read(e, 10, LIVE('1:22', trap));
      await answer('Sova');
      speak();
      ok(net.calls.length === 0 && e.matchContext.agent === null && e.ledger.current() === 6,
        'Start pressed while dead in round 6\'s first seconds, Occlara\'s own window a LOBBY before it, the teammate\'s HUD read as "own": nothing is sent',
        `${net.calls.map((c) => c.image)}, ${agentOf(e)}, round ${e.ledger.current()}`);
      // Round 7, read from its barriers dropping, alive: the fallback's.
      hush();
      const r7 = { teamScore: 4, enemyScore: 2 };
      read(e, 100, 'LOBBY');
      for (let s = 104; s <= 112; s++) read(e, s, LIVE(`1:${String(39 - (s - 104)).padStart(2, '0')}`, r7));
      await answer('Jett');
      read(e, 116, LIVE('1:27', r7));
      await answer('Jett');
      speak();
      ok(e.matchContext.agent === 'Jett' && e.matchContext.agentSource === 'hud' && net.calls.length === 2
        && net.calls.every((c) => Number(c.image.split('-')[1]) >= 104),
      'and the next round, read as it began, is the fallback\'s: two of its own frames lock the player\'s agent',
      `${net.calls.map((c) => c.image)}, ${agentOf(e)}`);
      // A pause from round 4 to round 7, lifted while dead in its first seconds.
      const p = reader();
      hush();
      read(p, 0, 'LOBBY');
      for (const team of [0, 1, 2, 3]) {
        read(p, team * 100 + 10, LIVE('1:38', { teamScore: team, enemyScore: 0 }));
        read(p, team * 100 + 11, LIVE('1:37', { teamScore: team, enemyScore: 0 }));
      }
      // Round 4's first frames were the fallback's: answered with no agent.
      while (net.calls.some((c) => !c.done)) await answer(null);
      const before = net.calls.length;
      const paused = { teamScore: 5, enemyScore: 1, playerWeapon: 'Ghost', aliveTell: 'own HP 100 and Ghost bottom left' };
      read(p, 700, LIVE('1:31', paused));
      read(p, 704, LIVE('1:27', paused));
      read(p, 708, LIVE('1:23', paused));
      speak();
      ok(before >= 1 && net.calls.length === before && p.matchContext.agent === null && p.ledger.current() === 7,
        'nor a round a pause was lifted in while dead, the frames before it three rounds earlier',
        `${before} sent before the pause, ${net.calls.length} after, round ${p.ledger.current()}, ${agentOf(p)}`);
    }

    // THE CALL CARRIES THE PLAYER'S BAR, NEVER THE FRAME (agent-crop.js). Sent
    // whole, the frame's 30 pixel icons read as Neon on the player's Jett, and
    // chat, the killer's panel and a teammate standing in front named others.
    console.log('\nthe look is sent the player\'s bar, never the frame:');
    {
      const handed = [];
      const e = reader({ crop: (shot) => { handed.push(shot); return `bar:${shot}`; } });
      hush();
      read(e, 0, BUY(44));
      read(e, 1, BUY(43));
      speak();
      ok(net.calls.length === 1 && net.calls[0].image === 'bar:frame-0' && handed.length === 1 && handed[0] === 'frame-0',
        'the call carries the crop of the read\'s own frame, cut once for the one frame sent, and never the frame itself',
        `${net.calls.map((c) => c.image)}, cut from ${handed.join(', ')}`);
    }
    {
      // A crop that cannot be made sends nothing and spends nothing of the look.
      let n = 0;
      const e = reader({ crop: (shot) => (n++ === 0 ? null : `bar:${shot}`) });
      hush();
      read(e, 0, BUY(44));
      speak();
      ok(net.calls.length === 0 && e.agentLook.sent === 0 && e.agentLook.lastAt === null,
        'a crop that comes back null sends nothing, never the whole frame, and spends no look', `${net.calls.map((c) => c.image)}, ${e.agentLook.sent} looks`);
      hush();
      read(e, 1, BUY(43));
      speak();
      ok(net.calls.length === 1 && net.calls[0].image === 'bar:frame-1', 'and the next frame whose bar is cut goes, a second later',
        `${net.calls.map((c) => c.image)}`);
      const t = reader({ crop: () => { throw new Error('no bar'); } });
      hush();
      read(t, 0, BUY(44));
      read(t, 4, BUY(40));
      speak();
      ok(net.calls.length === 0 && t.analyzedFrames === 2 && t.ledger.current() === 1,
        'one that throws sends nothing, and the reads go on into the ledger', `${net.calls.map((c) => c.image)}, ${t.analyzedFrames} reads`);
      const none = reader({ crop: null });
      hush();
      read(none, 0, BUY(44));
      read(none, 4, BUY(40));
      speak();
      ok(none.cropAgent === null && net.calls.length === 0, 'and an engine handed no cropper sends nothing at all', `${net.calls.map((c) => c.image)}`);
    }

    // A BUY FRAME'S OWN TIMER ENDS WITH THE LEDGER'S BUY PHASE. One the ledger
    // did not take is a buy read that was not: on the bench sessions a 0:00 as
    // the barriers dropped read "buy 0:10", a live round at 1:39 read "buy
    // 0:08", each the clock of a buy frame seconds before, and a post plant
    // read "buy 0:39" off the ammo counter.
    console.log('\na buy frame\'s timer must end with the ledger\'s buy phase:');
    {
      const e = reader();
      hush();
      read(e, 0, BUY(20));
      await answer(null);
      // "0:20" again ten seconds on: its own end 30 seconds in, the ledger's 20.
      read(e, 10, BUY(20));
      speak();
      ok(net.calls.length === 1 && Math.round((e.ledger.buyEndsAt - T0) / 1000) === 20,
        'a buy read whose timer ends ten seconds past the ledger\'s buy end is not sent', `${net.calls.map((c) => c.image)}, ledger end ${(e.ledger.buyEndsAt - T0) / 1000} s`);
      hush();
      read(e, 12, BUY(8));
      speak();
      ok(net.calls.length === 2 && net.calls[1].image === 'bar:frame-12', 'and the next one, ending with it, is', `${net.calls.map((c) => c.image)}`);
    }
    {
      // A post plant, its last frame five seconds before a "buy 0:39": a buy
      // start no frame of play rules out, and one the ledger refuses.
      const e = reader();
      hush();
      read(e, 0, BUY(30));
      await answer(null);
      for (let s = 31; s <= 60; s += 3) read(e, s, LIVE(`1:${String(39 - (s - 31)).padStart(2, '0')}`, { teamScore: 0, enemyScore: 0 }));
      for (let s = 62; s <= 95; s += 3) read(e, s, LIVE(null, { phase: 'postplant', spike: 'planted', clock: null }));
      read(e, 100, BUY(39));
      speak();
      const refused = net.calls.length === 1;
      ok(refused && e.ledger.beganAfterPlay(T0 + 100000, 39) && Math.round((e.ledger.buyEndsAt - T0) / 1000) === 30,
        'nor a post plant read "buy 0:39" five seconds after its last frame, its timer 109 seconds in against the ledger\'s 30',
        `${net.calls.map((c) => c.image)}, ledger end ${(e.ledger.buyEndsAt - T0) / 1000} s`);
    }

    // AND NEVER AFTER A DEATH UNTIL A ROUND HAS ENDED. Dead, the player is on a
    // teammate's camera, and a buy read there with the teammate's HUD called
    // "own" is the next buy phase to the ledger, whose spectator camera frames
    // are no play: that read's own timer set the buy end the rule above holds
    // it to, and two such reads three seconds apart, answered with the
    // teammate's Sova, locked Sova as the player's.
    console.log('\nnever after a death until a round has ended:');
    {
      const mmss = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
      const DEAD = (left, x) => ({ phase: 'dead', clock: left === null ? null : mmss(left), side: 'defending', playerAlive: false,
        aliveTell: 'Spectating laufey with SWITCH PLAYER bottom left', ...x });
      const TRAP = (left) => BUY(left, { playerWeapon: 'Vandal', aliveTell: 'own HP 100 and Vandal bottom left' });
      // Round 1: its buy phase (no agent read off it), the round played, the
      // death screen at 1:16 and twenty seconds of the spectator camera.
      const died = async (e) => {
        for (let s = 0; s <= 40; s += 4) { read(e, s, BUY(44 - s)); await answer(null); }
        for (let s = 46; s <= 68; s += 2) read(e, s, LIVE(mmss(100 - (s - 46))));
        read(e, 70, DEAD(76, { aliveTell: 'KILLED BY Astra and COMBAT REPORT, no own health number' }));
        for (let s = 71; s <= 92; s++) read(e, s, DEAD(76 - (s - 70)));
      };
      const traps = {
        'the teammate\'s ammo read as "buy 0:39", then "buy 0:36" three seconds on': async (e) => {
          read(e, 93, TRAP(39)); await answer('Sova');
          read(e, 94, DEAD(52)); read(e, 95, DEAD(51));
          read(e, 96, TRAP(36)); await answer('Sova');
        },
        'the round clock read as a buy timer late in the round, 0:30 down to 0:26': async (e) => {
          for (let s = 93; s <= 116; s++) read(e, s, DEAD(76 - (s - 70)));
          for (let s = 117; s <= 121; s++) { read(e, s, TRAP(30 - (s - 117))); await answer('Sova'); }
        },
        'a post plant\'s camera with no clock, then "buy 0:39" and "buy 0:36"': async (e) => {
          for (let s = 93; s <= 105; s++) read(e, s, DEAD(null, { phase: 'postplant', spike: 'planted' }));
          read(e, 106, TRAP(39)); await answer('Sova');
          read(e, 107, DEAD(null)); read(e, 108, DEAD(null));
          read(e, 109, TRAP(36)); await answer('Sova');
        },
      };
      for (const [what, play] of Object.entries(traps)) {
        const e = reader();
        hush();
        await died(e);
        const before = net.calls.length;
        await play(e);
        speak();
        ok(before === 3 && net.calls.length === before && e.matchContext.agent === null,
          `the spectator camera with the teammate's HUD called own sends nothing and locks no teammate: ${what}`,
          `${net.calls.slice(before).map((c) => c.image)}, ${agentOf(e)}, ledger round ${e.ledger.current()} ending ${(e.ledger.buyEndsAt - T0) / 1000} s`);
      }
      // The round over, its countdown printing the score a round on: the buy
      // phase after it goes.
      const n = reader();
      hush();
      await died(n);
      for (let s = 93; s <= 110; s++) read(n, s, DEAD(76 - (s - 70)));
      for (let s = 111; s <= 117; s++) read(n, s, DEAD(117 - s, { teamScore: 0, enemyScore: 1 }));
      const m = net.calls.length;
      read(n, 118, BUY(29, { enemyScore: 1 }));
      speak();
      ok(net.calls.length === m + 1 && net.calls[m].image === 'bar:frame-118',
        'and the buy phase once the round is over, its score printed a round on, is sent', `${net.calls.slice(m).map((c) => c.image)}`);
      // One whose frames print no score waits for the first that does.
      const q = reader();
      hush();
      await died(q);
      for (let s = 93; s <= 110; s++) read(q, s, DEAD(76 - (s - 70)));
      for (let s = 111; s <= 117; s++) read(q, s, DEAD(117 - s));
      const w = net.calls.length;
      read(q, 118, BUY(29, { teamScore: undefined, enemyScore: undefined }));
      read(q, 119, BUY(28, { teamScore: undefined, enemyScore: undefined }));
      const none = net.calls.length === w;
      read(q, 120, BUY(27, { enemyScore: 1 }));
      speak();
      ok(none && net.calls.length === w + 1 && net.calls[w].image === 'bar:frame-120',
        'and one whose first frames read no score waits for the first that reads it a round on', `${net.calls.slice(w).map((c) => c.image)}`);
      // A death the look saw before a match began is the last match's. The
      // watch ends a match and starts the look again (beginMatch(true)); a death
      // read on the frames it keeps in case that match goes on, then the next
      // match showing itself (the watch's new match, beginMatch(false), which
      // keeps the look), and its first buy phase at 0 to 0 is looked at.
      const g = reader();
      hush();
      await died(g);
      g.beginMatch(true);
      read(g, 140, LIVE('1:30'));
      read(g, 150, DEAD(60, { aliveTell: 'KILLED BY Astra and COMBAT REPORT, no own health number' }));
      g.beginMatch(false);
      const b0 = net.calls.length;
      read(g, 200, BUY(44));
      speak();
      ok(net.calls.length === b0 + 1 && net.calls[b0].image === 'bar:frame-200',
        'and a death before a match began is the last match\'s: the next match\'s first buy phase, at 0 to 0, is sent',
        `${net.calls.slice(b0).map((c) => c.image)}, death at ${g.agentLook.deathRounds}`);
    }

    // THE LOOK IS OFF (AGENT_LOOKS_PER_MATCH 0). The crop's live bench over the
    // five real sessions locked Neon on the player's Fracture Jett and Killjoy
    // on the Pearl Raze, so nothing is sent and nothing locks until a reader
    // passes its bench: the agent waits for Riot's record, as for a player who
    // never ticked in 8.4.3.
    console.log('\nthe look is off:');
    {
      let cut = 0;
      const e = reader({ on: false, crop: (shot) => { cut++; return `bar:${shot}`; } });
      hush();
      for (let s = 0; s <= 36; s += 4) { read(e, s, BUY(44 - s)); await answer('Jett'); }
      read(e, 60, LIVE('1:30'));
      for (let s = 150; s <= 170; s += 4) { read(e, s, BUY(29 - (s - 150), { teamScore: 1, enemyScore: 0 })); await answer('Jett'); }
      speak();
      ok(e.agentLooksPerMatch === 0 && net.calls.length === 0 && cut === 0 && e.matchContext.agent === null
        && !e.matchContext.agentConfirmed && e.readContext().agent === null,
      'two buy phases of the player\'s own HUD send nothing, cut no crop and lock no agent: it waits for Riot\'s record',
      `${e.agentLooksPerMatch} looks a match, ${net.calls.length} sent, ${cut} cut, ${agentOf(e)}`);
    }
  } finally {
    console.log = quiet;
    Date.now = realNow;
  }

  // ── The crop itself (agent-crop.js) ─────────────────────────────────────────
  // Electron's nativeImage stood in for: what it is asked, and what it gives.
  console.log('\nthe crop of the player\'s bar:');
  {
    const crop = require(path.join(REPO, 'src', 'main', 'services', 'agent-crop.js'));
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    const SHOT = Buffer.from('the read\'s frame').toString('base64');
    const JPEG = Buffer.from('the bar as a JPEG');
    const fake = (o = {}) => {
      const seen = {};
      const img = (size, what) => ({
        isEmpty: () => (what === 'frame' ? !!o.empty : false),
        getSize: () => size,
        crop: (rect) => { seen.crop = rect; return img(o.cropSize || { width: rect.width, height: rect.height }, 'bar'); },
        resize: (opt) => { seen.resize = opt; return img(o.resizeSize || { width: opt.width, height: opt.height }, 'big'); },
        toJPEG: (q) => { if (o.throws) throw new Error('no encoder'); seen.quality = q; return o.jpeg || JPEG; },
      });
      return { seen, ni: { createFromBuffer: (buf) => { seen.bytes = buf.toString(); return img(o.size || { width: 1280, height: 720 }, 'frame'); } } };
    };
    ok(same(crop.barRect(1280, 720), { x: 340, y: 636, width: 600, height: 84 }),
      'on the read\'s 1280x720 frame the bar is x 340 to 940 and y 636 to its foot: the health number to the ammo count',
      JSON.stringify(crop.barRect(1280, 720)));
    ok(same(crop.barRect(854, 480), { x: 227, y: 424, width: 400, height: 56 }) && crop.barRect(0, 720) === null && crop.barRect(NaN, 720) === null,
      'the same bar on the performance profile\'s 854x480, the bounds fractions of the frame, and none on a frame with no size',
      JSON.stringify(crop.barRect(854, 480)));
    const std = fake();
    const out = crop.cropAgentBar(SHOT, 70, std.ni);
    ok(out === JPEG.toString('base64') && std.seen.bytes === 'the read\'s frame' && same(std.seen.crop, { x: 340, y: 636, width: 600, height: 84 })
      && same(std.seen.resize, { width: 1800, height: 252, quality: 'best' }) && std.seen.quality === 70 && crop.AGENT_BAR_SCALE === 3,
    'the read\'s own frame cut to the bar, scaled up three times to 1800x252, and a JPEG of the read\'s own quality',
    JSON.stringify(std.seen));
    const perf = fake({ size: { width: 854, height: 480 } });
    crop.cropAgentBar(SHOT, 50, perf.ni);
    ok(same(perf.seen.resize, { width: 1200, height: 168, quality: 'best' }) && perf.seen.quality === 50,
      'and on the performance profile 1200x168 at its own quality, 50', JSON.stringify(perf.seen));
    const cannot = [
      ['no frame', () => crop.cropAgentBar(null, 70, fake().ni)],
      ['a frame that does not decode', () => crop.cropAgentBar(SHOT, 70, fake({ empty: true }).ni)],
      ['a crop that comes back another size', () => crop.cropAgentBar(SHOT, 70, fake({ cropSize: { width: 1280, height: 720 } }).ni)],
      ['a scale that comes back another size', () => crop.cropAgentBar(SHOT, 70, fake({ resizeSize: { width: 600, height: 84 } }).ni)],
      ['an encoder that throws', () => crop.cropAgentBar(SHOT, 70, fake({ throws: true }).ni)],
      ['an empty JPEG', () => crop.cropAgentBar(SHOT, 70, fake({ jpeg: Buffer.alloc(0) }).ni)],
      ['no quality', () => crop.cropAgentBar(SHOT, undefined, fake().ni)],
    ];
    const made = cannot.filter(([, f]) => f() !== null).map(([what]) => what);
    ok(made.length === 0, `and null, never the frame, when it cannot be made (${cannot.map(([what]) => what).join(', ')})`, made.join(', '));
  }

  // ── And no page tells the player to confirm one ─────────────────────────────
  // The tour's first page listed "Confirm your agent: when the sidebar asks
  // who you are playing, confirm it" after the sidebar had stopped asking.
  console.log('\nwhat the pages tell the player:');
  {
    const fs = require('fs');
    const RENDERER = path.join(REPO, 'src', 'renderer');
    const pages = fs.readdirSync(RENDERER).map((d) => path.join(RENDERER, d, 'index.html')).filter((f) => fs.existsSync(f));
    const ASKS = /confirm (it|your agent)|sidebar asks|who you are playing|type your agent|pick your agent|playing which agent/i;
    const said = pages.filter((f) => ASKS.test(fs.readFileSync(f, 'utf8').replace(/<!--[\s\S]*?-->/g, '')))
      .map((f) => path.relative(REPO, f));
    ok(pages.length >= 8 && said.length === 0, `no page tells the player to confirm, pick or type an agent (${pages.length} pages read)`, said.join(', '));
    const tour = fs.readFileSync(path.join(RENDERER, 'onboarding', 'index.html'), 'utf8');
    ok(/<b>Just play<\/b><span>Nothing asks which agent you are on\./.test(tour),
      'and the tour\'s first page says nothing asks which agent the player is on');
    ok(ASKS.test('When the sidebar asks who you are playing, confirm it') && !ASKS.test('Nothing asks which agent you are on'),
      'the check knows the old step and passes the new one');
  }

  // ── The route's prompt, and its variant b ───────────────────────────────────
  console.log('\nthe route\'s prompt:');
  const coach = require(path.join(REPO, 'server', 'routes', 'coach.js'));
  const { detectPrompt, detectVariant, AGENT_KIT_LINES } = coach.__test;
  const sha = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');
  // TODAY'S LIVE PROMPT, BYTE FOR BYTE, the kit lines aside (they grow with the
  // roster, sync:valorant's): its length and sha256 as every install has been
  // answered with, taken before b was written.
  const live = detectPrompt(null);
  const template = live.split(AGENT_KIT_LINES).join('{KIT}');
  ok(template.length === 392 && sha(template) === '14202e24904db15b7cd63b99d44ea494179805bbe0630e638cc21ce591443739' && live.includes(AGENT_KIT_LINES),
    'the live prompt is byte for byte the one every install is answered with, the kit lines in it', `${template.length} characters, ${sha(template)}`);
  const b = detectPrompt('b');
  // The player's bar reads C, Q, MB4 and X (E on a mouse button), and in a buy
  // phase the cards over teammates carry their portraits and ability icons.
  ok(/C, Q, E and X unless the player rebound one, as MB4/.test(b) && /cards over teammates in the buy phase carry each teammate's own portrait and ability icons/.test(b)
    && /never from a face, a name or any other icons/.test(b),
  'b takes the key under an icon as rebound, as the player\'s E is MB4, and holds no teammate\'s card over them to be the player\'s kit');
  ok(b !== live && b.includes(AGENT_KIT_LINES) && /C, Q, E and X/.test(b) && /ten portraits along the top bar/.test(b)
    && /COMBAT REPORT or KILLED BY/.test(b) && /SWITCH PLAYER/.test(b) && /UNKNOWN/.test(b) && !/just above their HP bar/.test(b),
  'b puts the four icons beside the health with C, Q, E and X under them, answers from no face or name, and UNKNOWN for a spectated bar');
  ok(![0x2013, 0x2014].some((c) => b.includes(String.fromCharCode(c))), 'with no en or em dash in it');
  const PW = 'the admin bench';
  process.env.ADMIN_PASSWORD = PW;
  ok(detectVariant({ body: { variant: 'b' }, headers: {} }) === null
    && detectVariant({ body: { variant: 'b' }, headers: { 'x-admin-password': 'guess' } }) === null
    && detectVariant({ body: { variant: 'b' }, headers: {}, query: { password: PW } }) === null,
  'a licence alone cannot switch its look to b, nor with a wrong admin password, nor with it in the query string');
  ok(detectVariant({ body: { variant: ' B ' }, headers: { 'x-admin-password': PW } }) === 'b'
    && detectVariant({ body: { variant: 'z' }, headers: { 'x-admin-password': PW } }) === null,
  'an admin bench naming b gets it, and only a variant there is');
  delete process.env.ADMIN_PASSWORD;

  console.log(`\n${fail ? 'FAIL' : 'PASS'}: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  Date.now = realNow;
  console.log('FAIL  the agent detection test threw:', e && e.stack ? e.stack : e);
  process.exit(1);
});

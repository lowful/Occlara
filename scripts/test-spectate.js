'use strict';

/**
 * Whose HUD is on screen, and does a death review survive the gates?
 *
 * EVERY FIXTURE BELOW IS A REAL FRAME from a real graded session (Icebox, Iso,
 * 13 minutes), taken verbatim out of the AI decision log. That session is the
 * reason all of this exists: the player's genuine first death was rejected twice
 * with "said the player was dead while they were alive at 100 HP", because the
 * model had switched to the spectated teammate's HUD and reported their health
 * as the player's own.
 *
 * Riot's own record of that match says 6 deaths. The coach wrote 26 death
 * reviews and 24 were dropped.
 *
 * A DEATH WORD ITS OWN CLAUSE NEGATES IS NO DEATH WORD (8.4.3). Variant b of
 * the read prompt, benched on the player's four sessions, wrote "SWITCH PLAYER
 * not shown" and "no SWITCH PLAYER or KILLED BY printed" on living players,
 * and both copies took each for the death screen. The nine reads it wrote are
 * below verbatim, and the server's copy is the real mapState, held equal to
 * the client's on them and on every tell of the committed session fixtures.
 *
 * AND EVERY FORM OF THE WORD READS ALIKE (8.4.3). The server's mirror read
 * "spectat" between word boundaries, so b's "the spectated teammate" was a
 * spectator screen to the client and none to the server, on four reads. A
 * tell of every form is held equal on both copies, the counter's forms the
 * counter on both.
 */

const assert = require('assert');
const path = require('path');
const spectate = require('../src/shared/spectate-tells');

// The server's copy, the real one: the route module builds a Supabase client
// at import time, which placeholders let it do (as test-alive-claims does).
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || 'test-key-not-used';
const coach = require(path.join(__dirname, '..', 'server', 'routes', 'coach.js'));
/** Run fn with the server's own log lines held back. */
function quietly(fn) {
  const log = console.log;
  console.log = () => {};
  try { return fn(); } finally { console.log = log; }
}
/**
 * Does the server's spectator rule (mapState) call the tell a spectator screen?
 * A living player's read at 100 HP: the rule drops the health and calls them
 * dead exactly when it does.
 */
function serverSays(tell) {
  const out = quietly(() => coach.mapState({ alive: true, hp: 100, aliveTell: tell }, { tellMax: 1000 }));
  return out.playerAlive === false && out.playerHp === undefined;
}

let checks = 0;
function ok(what, cond) {
  checks += 1;
  if (!cond) { console.error('FAIL: ' + what); process.exit(1); }
}

// ── The real frames, in the order they were captured ────────────────────────
// The player is Iso. Watch the HUD stop being theirs.
const FRAMES = [
  { tell: 'own HP 100 and Ghost bottom center',                        weapon: 'Ghost',  hp: 100, spectating: false },
  { tell: 'own HP 100 and Bandit bottom center',                       weapon: 'Bandit', hp: 100, spectating: false },
  { tell: 'own HP 19 and Sova abilities bottom center',                weapon: 'Sword',  hp: 19,  spectating: true  },
  { tell: 'Spectating iggly, teammate MILFSLAYER69 killed by Sage',    weapon: null,     hp: null, spectating: true },
  { tell: 'Spectating iggly with Classic and 12 HP bottom center',     weapon: 'Classic', hp: 12, spectating: true },
  { tell: 'LOST TEAM ELIMINATED and KILLED BY SAGE top right',         weapon: null,     hp: null, spectating: true },
  { tell: 'spectating teammate MILFSLAYER69 with combat report on',    weapon: null,     hp: null, spectating: true },
  { tell: 'Spectating tingsoon with SWITCH PLAYER text bottom left',   weapon: null,     hp: null, spectating: true },
  // Round 3 buy: alive again. A buy phase is a boundary, so the weapon and
  // health carried over from the spectated teammate do not count as evidence.
  { tell: 'own HP 87 and Vandal bottom center',   weapon: 'Vandal', hp: 87,  spectating: false, roundChanged: true },
  { tell: 'own HP 100 and abilities bottom center', weapon: null,   hp: 100, spectating: false, roundChanged: true },
];

{
  let prevWeapon = null;
  let prevHp = null;
  for (const f of FRAMES) {
    const r = spectate.readHudOwner({
      tell: f.tell, agent: 'Iso',
      weapon: f.weapon, prevWeapon,
      hp: f.hp, prevHp,
      roundChanged: !!f.roundChanged,
    });
    ok(`"${f.tell.slice(0, 46)}" reads as ${f.spectating ? 'spectating' : 'alive'}`,
      r.spectating === f.spectating);
    prevWeapon = f.weapon || prevWeapon;
    if (typeof f.hp === 'number') prevHp = f.hp;
  }
}

// ── The signal that nothing implemented, isolated ───────────────────────────
{
  // THE ONE THAT COST THE SESSION. No spectate word anywhere in this tell, and
  // the health number is perfectly readable. The only evidence is that the model
  // called SOVA's abilities "own" while the player was Iso.
  const r = spectate.readHudOwner({ tell: 'own HP 19 and Sova abilities bottom center', agent: 'Iso' });
  ok('a foreign agent in the tell is enough on its own', r.spectating === true);
  ok('and it is reported as strong evidence', r.confidence === 'strong');
  ok('and it names which agent gave it away', /Sova/.test(r.signals.join(' ')));

  // The same sentence about the player's OWN agent is not evidence of anything.
  const own = spectate.readHudOwner({ tell: 'own HP 19 and Iso abilities bottom center', agent: 'Iso' });
  ok('the player\'s own agent in the tell is NOT spectating', own.spectating === false);

  // With no locked agent there is nothing to compare against, so no guess.
  const noAgent = spectate.readHudOwner({ tell: 'own HP 19 and Sova abilities bottom center', agent: '' });
  ok('an unlocked agent produces no foreign-agent claim', noAgent.spectating === false);
}

// ── The false friend that broke this once before ────────────────────────────
{
  const r = spectate.readHudOwner({
    tell: 'own HP 100 and knife bottom center, spectating scoreboard', agent: 'Iso',
  });
  ok('spectating the SCOREBOARD is not spectating a player', r.spectating === false);

  const mini = spectate.readHudOwner({ tell: 'spectating the minimap', agent: 'Iso' });
  ok('spectating the minimap is not spectating a player', mini.spectating === false);

  // But a real spectator screen mentioned alongside it still wins.
  const both = spectate.readHudOwner({ tell: 'spectating scoreboard with SWITCH PLAYER text', agent: 'Iso' });
  ok('SWITCH PLAYER beats the scoreboard exception', both.spectating === true);
}

// ── A read the model was unsure about is never proof ────────────────────────
{
  const r = spectate.readHudOwner({ tell: 'unreadable, assuming spectating', agent: 'Iso' });
  ok('an unsure tell is not proof of spectating', r.spectating === false);
}

// ── Weak signals need two of them ───────────────────────────────────────────
{
  const one = spectate.readHudOwner({
    tell: 'own HP 100 and Bandit bottom center', agent: 'Iso',
    weapon: 'Bandit', prevWeapon: 'Ghost', hp: 100, prevHp: 100, roundChanged: false,
  });
  ok('a weapon change alone is not enough', one.spectating === false);

  const two = spectate.readHudOwner({
    tell: 'own HP 100 and Bandit bottom center', agent: 'Iso',
    weapon: 'Bandit', prevWeapon: 'Ghost', hp: 100, prevHp: 19, roundChanged: false,
  });
  ok('a weapon change AND health rising is enough', two.spectating === true);

  // A round boundary explains both, so neither counts.
  const fresh = spectate.readHudOwner({
    tell: 'own HP 100 and Vandal bottom center', agent: 'Iso',
    weapon: 'Vandal', prevWeapon: 'Ghost', hp: 100, prevHp: 19, roundChanged: true,
  });
  ok('a new round explains a new weapon and full health', fresh.spectating === false);
}

// ── The client and the server must share one vocabulary ─────────────────────
{
  // server/ cannot require src/, so the regex is mirrored there by hand. This is
  // the test that keeps the two copies honest, the same trade tip-visuals.js
  // makes with the agent list.
  const fs = require('fs');
  const src = fs.readFileSync(require('path').join(__dirname, '..', 'server/routes/coach.js'), 'utf8');
  const line = src.split(/\r?\n/).find((l) => l.indexOf('const SPECTATE_TELL =') === 0);
  ok('the server still declares SPECTATE_TELL', !!line);

  const serverRe = eval(line.slice(line.indexOf('/'), line.lastIndexOf('/i') + 2));  // eslint-disable-line no-eval
  const mustMatch = [
    'Spectating iggly, teammate MILFSLAYER69 killed by Sage',
    'LOST TEAM ELIMINATED and KILLED BY SAGE top right',
    'spectating teammate MILFSLAYER69 with combat report on',
    'Spectating tingsoon with SWITCH PLAYER text bottom left',
    'Spectating tingsoon with killcam on screen',
    // Every form of the word the client's list reads, word boundary or none.
    'health 100 bottom center belongs to the spectated teammate',
    'spectates a teammate',
    'SPECTATORS 1 top right',
  ];
  for (const t of mustMatch) {
    ok(`server matches "${t.slice(0, 40)}"`, serverRe.test(t));
    ok(`client matches "${t.slice(0, 40)}"`, spectate.SPECTATE_TELL.test(t));
  }
  const mustNotMatch = ['own HP 100 and Ghost bottom center', 'own HP 87 and Vandal bottom center'];
  for (const t of mustNotMatch) {
    ok(`server does not match "${t}"`, !serverRe.test(t));
    ok(`client does not match "${t}"`, !spectate.SPECTATE_TELL.test(t));
  }
}

// ── The spectator counter, from the player's Sunset swiftplay ───────────────
{
  // "SPECTATORS 1" at the top right counts who is watching the PLAYER, so it
  // is on a living player's HUD. The round 4 banner read as the first tell
  // below, the player at 99 health (the teammate's name taken out), the frame
  // after it as the second, and a death registered in a round Riot has the
  // player surviving. As the server keeps them: cut at 60 characters.
  const COUNTER = [
    'Spectating 1 top right and teammate shown, no own HP',
    'SPECTATORS 1 top right, teammate Phoenix centered with own w',
  ];
  for (const t of COUNTER) {
    ok(`the counter "${t.slice(0, 34)}" is no spectator screen`,
      spectate.readHudOwner({ tell: t, phase: 'dead' }).spectating === false);
    ok(`and is the counter alone ("${t.slice(0, 20)}")`, spectate.countsSpectators(t) === true);
  }
  ok('the death screen beside the counter still wins',
    spectate.readHudOwner({ tell: 'SPECTATORS 1 top right and KILLED BY Jett' }).spectating === true);
  ok('a teammate whose name ends in a number is spectated, not counted',
    spectate.readHudOwner({ tell: 'Spectating Rook7 with Vandal' }).spectating === true
    && !spectate.countsSpectators('Spectating Rook7 with Vandal'));
  ok("a teammate's health is no counter either",
    spectate.readHudOwner({ tell: 'spectating with 100 HP bottom center' }).spectating === true);

  // The server's copy decides it the same way on the same tells (its real
  // mapState): SPECTATE_TELL, less its two false friends unless the death
  // screen is beside them.
  ok('the server weighs the counter: it keeps the health beside it, and drops it beside the death screen',
    !serverSays(COUNTER[0]) && !serverSays(COUNTER[1]) && serverSays('SPECTATORS 1 top right and KILLED BY Jett'));
  const TELLS = [...COUNTER, 'SPECTATORS 1 top right and KILLED BY Jett', 'Spectating Rook7 with Vandal',
    'Spectating teammate with SWITCH PLAYER bottom left', 'own HP 100 and Ghost bottom right',
    'own HP 100 and knife bottom center, spectating scoreboard'];
  for (const t of TELLS) {
    ok(`server and client agree on "${t.slice(0, 34)}"`, serverSays(t) === spectate.tellSaysSpectating(t));
  }
}

// ── A death word its own clause negates is no death word (8.4.3) ────────────
const NEGATED = [];   // every tell below, held equal on both copies at the end
{
  // "no" or "not" right before the word, "not shown" right after it: no tell.
  // The "no" in "no own HP" is the health's, and the word beside it stands.
  const NONE = [
    'no SWITCH PLAYER',
    'SWITCH PLAYER not shown',
    'no own health, KILLED BY not visible',
    'own HP 100 and Vandal bottom left, not spectating',
    'without SWITCH PLAYER, own HP 87 and Ghost',
    'never SWITCH PLAYER, own HP 100',
    'neither SWITCH PLAYER nor KILLED BY on screen',
    'SWITCH PLAYER not printed, own HP 100 and knife',
    'SWITCH PLAYER not on screen, own HP 100',
    'killcam absent, own HP 100 and Ghost',
    'COMBAT REPORT panel missing, own HP 100',
    'death recap hidden, own HP 61 and Sheriff',
    'SWITCH PLAYER text is not visible, own HP 100',
    'SWITCH PLAYER or KILLED BY not shown',
  ];
  const STILL = [
    'SWITCH PLAYER bottom left, no own HP',
    'KILLED BY Sage, no own health',
    'no own HP, SWITCH PLAYER bottom left',
    'Spectating teammate, own HP not shown',
    'SWITCH PLAYER and KILLED BY not shown',
    'KILLED BY ASTRA and COMBAT REPORT panel visible, no own heal',
    'Spectating teammate someone with SWITCH PLAYER bottom-left, no o',
  ];
  for (const t of NONE) {
    ok(`"${t.slice(0, 44)}" names no spectator screen`, spectate.tellSaysSpectating(t) === false);
    ok(`and the server keeps the health beside "${t.slice(0, 30)}"`, serverSays(t) === false);
  }
  for (const t of STILL) {
    ok(`"${t.slice(0, 44)}" still names one`, spectate.tellSaysSpectating(t) === true);
    ok(`and the server drops the health beside "${t.slice(0, 30)}"`, serverSays(t) === true);
  }
  // A negated death screen outranks neither false friend.
  ok('the counter beside a negated SWITCH PLAYER is the counter alone',
    spectate.countsSpectators('SPECTATORS 1 top right, SWITCH PLAYER not shown') === true
    && spectate.tellSaysSpectating('SPECTATORS 1 top right, SWITCH PLAYER not shown') === false
    && serverSays('SPECTATORS 1 top right, SWITCH PLAYER not shown') === false);
  ok('and so is "Spectating 1 top right" beside it, on both copies',
    spectate.countsSpectators('Spectating 1 top right, SWITCH PLAYER not shown') === true
    && spectate.tellSaysSpectating('Spectating 1 top right, SWITCH PLAYER not shown') === false
    && serverSays('Spectating 1 top right, SWITCH PLAYER not shown') === false);
  ok('and the scoreboard beside a negated KILLED BY is the scoreboard',
    spectate.tellSaysSpectating('own HP 100 and knife, spectating scoreboard, no KILLED BY') === false
    && serverSays('own HP 100 and knife, spectating scoreboard, no KILLED BY') === false);

  // THE NINE READS b WROTE, verbatim as the server kept them, 90 characters:
  // two with no death word left, and seven that still print KILLED BY and the
  // COMBAT REPORT, which stand, as they must. Eight were a living player in a
  // buy phase, the round before's combat report; the ninth, the Abyss match's
  // frame 0204 in b's lag 4 run, is round 20's real death, 2.8 s after Riot's
  // moment.
  const B_NONE = [
    'scoreboard open, own HP and loadout hidden, no SWITCH PLAYER or KILLED BY printed, COMBAT ',   // Split 00046
    'SWITCH PLAYER not shown; scoreboard open with own HP 100 bottom center and knife in hand',      // Split 00148
  ];
  const B_STILL = [
    'SWITCH PLAYER not printed, KILLED BY PHOENIX panel and COMBAT REPORT shown, own HP absent,',    // Abyss 0117
    'KILLED BY PHOENIX and COMBAT REPORT panel printed, SWITCH PLAYER not visible',                   // Abyss 0204
    'COMBAT REPORT panel with KILLED BY Sage and SWITCH PLAYER not shown, own HP and abilities ',    // Split 00047
    'KILLED BY REYNA, COMBAT REPORT panel, SWITCH PLAYER not shown',                                  // Split 00173
    'KILLED BY REYNA at upper right and COMBAT REPORT panel with SWITCH PLAYER not printed but ',   // Split 00323
    'SWITCH PLAYER not printed, KILLED BY REYNA printed upper right, COMBAT REPORT panel open, ',   // Split 00330
    'KILLED BY JETT and COMBAT REPORT panel printed, SWITCH PLAYER not visible, own HP absent',     // Sunset 00192
  ];
  for (const t of B_NONE) {
    ok(`b's "${t.slice(0, 40)}" names no spectator screen and no death screen, on either copy`,
      !spectate.tellSaysSpectating(t) && !serverSays(t) && !spectate.affirms(spectate.DEATH_SCREEN, t)
      && !coach.__test.affirms(coach.__test.DEATH_SCREEN_WORDS, t));
  }
  for (const t of B_STILL) {
    ok(`b's "${t.slice(0, 40)}" still prints the death screen, on either copy`,
      spectate.tellSaysSpectating(t) && serverSays(t) && spectate.affirms(spectate.DEATH_SCREEN, t)
      && coach.__test.affirms(coach.__test.DEATH_SCREEN_WORDS, t));
  }
  // Held equal on both copies below, whichever way each falls: a word the list
  // cuts short ("SPECTATORS" matched to "spectator"), its clause read past the
  // rest of it, and a phrase that is no death word, which no negation touches.
  const MIRROR = ['SPECTATORS not shown, own HP 100 and Vandal', 'own HP 100, not watching a teammate'];
  NEGATED.push(...NONE, ...STILL, ...B_NONE, ...B_STILL, ...MIRROR);
}

// ── Every form of the word, alike on both copies (8.4.3) ────────────────────
const FORMS = [];   // every tell below, held equal on both copies at the end
{
  // The client's list reads "spectat" with no word boundary, and the server's
  // mirror read it with one: "spectating" and "spectator" on both, "spectated"
  // on the client alone. Variant b wrote it on four reads of the bench,
  // verbatim below as the server kept them, and the copies came apart on each.
  const B_SPECTATED = [
    'DEATH REVIEW panel printed, health bar shows 100 for the spectated teammate Sova',            // Abyss 0024
    'own HP 100 and Vandal bottom left belong to the spectated teammate, DEATH REVIEW panel pri',  // Abyss 0103, b's lag 4 run
    'DEATH REVIEW panel and a spectated teammate body, no own health number',                     // Abyss 0104, b's lag 4 run
    'health 100 bottom center belongs to the spectated teammate, no own weapon or abilities bot',  // Split 00423
  ];
  for (const t of B_SPECTATED) {
    ok(`b's "${t.slice(0, 40)}" names a spectator screen, on either copy`, spectate.tellSaysSpectating(t) && serverSays(t));
  }
  // A tell of each form, the screen's, the counter's and one its clause negates.
  const SCREEN = ['spectate teammate with Vandal bottom left', 'Spectated teammate with Vandal bottom left',
    'spectates a teammate, no own HP', 'Spectating someone with Phantom', 'spectator view of a teammate', 'SPECTATOR'];
  // The counter stays the counter whichever form it is written in, "spectated"
  // too: the player being watched, which read as a spectator screen proved a
  // death on one frame at 99 health, on the client's own guard.
  const COUNTER = ['SPECTATORS 1 top right', 'Spectating 1 top right', 'spectate 2 top right', 'spectator 1 top right',
    '2 spectators top right', 'spectators: 3, own HP 100', 'spectator count 2', 'SPECTATORS 1 top right and own HP 100 and Vandal',
    'Spectated 1 top right', 'SPECTATED 2 top right, own HP 99', 'spectated by 1 top right'];
  const NONE = ['not spectated, own HP 100 and Vandal', 'no spectators, own HP 100', 'not spectating, own HP 100 and Ghost'];
  ok('every form names a spectator screen on either copy: spectate, spectated, spectates, spectating, spectator',
    SCREEN.every((t) => spectate.tellSaysSpectating(t) && serverSays(t)));
  ok('and the counter, in every form, is the counter on either copy: SPECTATORS, Spectating, spectate, spectator, spectators, Spectated, spectated by',
    COUNTER.every((t) => spectate.countsSpectators(t) && !spectate.tellSaysSpectating(t) && !serverSays(t)));
  // A number further on is no counter: "the spectated teammate" is the dead
  // player's view whatever follows it.
  ok('but the spectated teammate is the spectator screen with a number after it, on either copy',
    ['the spectated teammate 1 bottom left', 'Spectated Sova, 2 enemies left', 'spectated teammate with 100 HP']
      .every((t) => !spectate.countsSpectators(t) && spectate.tellSaysSpectating(t) && serverSays(t)));
  ok('and a form its own clause negates names none, on either copy',
    NONE.every((t) => !spectate.tellSaysSpectating(t) && !serverSays(t)));
  FORMS.push(...B_SPECTATED, ...SCREEN, ...COUNTER, ...NONE, 'KILLED BY Sage, spectated teammate', 'Spectated 1 top right, KILLED BY Sage');
}

// ── Both copies on every committed tell ─────────────────────────────────────
{
  // Every tell of the committed session fixtures (scrubbed: no punctuation, a
  // placeholder for every name), every tell above, every form of the word,
  // and the four word lists each copy weighs, through both helpers; and each
  // copy's own spectator list through its own, so a word one list reads and
  // the other does not fails here even where the counter hides it.
  const fs = require('fs');
  const dir = path.join(__dirname, 'fixtures');
  const fixed = new Set();
  for (const f of fs.readdirSync(dir).filter((x) => /^valorant-session-.+\.json$/.test(x))) {
    for (const fr of JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')).frames || []) if (fr.aliveTell) fixed.add(fr.aliveTell);
  }
  const all = [...fixed, ...NEGATED, ...FORMS, ...FRAMES.map((f) => f.tell)];
  const lists = [spectate.SPECTATE_TELL, spectate.DEATH_SCREEN, coach.__test.SPECTATE_TELL, coach.__test.DEATH_SCREEN_WORDS];
  const apart = all.filter((t) => serverSays(t) !== spectate.tellSaysSpectating(t)
    || coach.__test.affirms(coach.__test.SPECTATE_TELL, t) !== spectate.affirms(spectate.SPECTATE_TELL, t)
    || lists.some((re) => coach.__test.affirms(re, t) !== spectate.affirms(re, t)));
  ok(`the server and the client decide all ${all.length} tells alike, ${fixed.size} of them the fixtures'`
    + `${apart.length ? ` (apart on "${apart[0].slice(0, 40)}")` : ''}`, fixed.size > 500 && apart.length === 0);
  ok('and the fixtures\' tells carry both answers', [...fixed].some((t) => spectate.tellSaysSpectating(t))
    && [...fixed].some((t) => !spectate.tellSaysSpectating(t)));
}

// ── Nothing throws on junk ──────────────────────────────────────────────────
{
  assert.doesNotThrow(() => spectate.readHudOwner(null), 'null frame');
  assert.doesNotThrow(() => spectate.readHudOwner({}), 'empty frame');
  assert.doesNotThrow(() => spectate.foreignAgentInTell(null, null), 'null tell');
  checks += 3;
}

/*
 * ── THE KILL FEED, from session 2026-09-18 frame 19 ─────────────────────────
 *
 * The state that frame produced, verbatim:
 *
 *   phase       "dead"
 *   killFeed    "Killed by Reyna"
 *   playerNote  "Died holding A Lobby alone while team committed to B"
 *   playerAlive true
 *   playerHp    100
 *   aliveTell   "own HP 100 and knife bottom center"
 *
 * Three signals said the player was dead and none of them reached this function,
 * so the spectated teammate's 100 HP won and the STATE contradicted itself. The
 * tip built on it was CORRECT and the accuracy gate flagged it anyway, which is
 * the worst shape a failure can take: the coach punished for being right.
 */
{
  const frame19 = {
    tell: 'own HP 100 and knife bottom center',
    killFeed: 'Killed by Reyna',
    phase: 'dead',
    hp: 100,
    agent: 'Jett',
  };
  ok('the real frame 19 reads as spectating', spectate.readHudOwner(frame19).spectating === true);
  ok('and on a strong signal, not a coincidence of weak ones',
    spectate.readHudOwner(frame19).confidence === 'strong');
  ok('"You were killed by" is the same fact in other words',
    spectate.readHudOwner({ killFeed: 'You were killed by Jett' }).spectating === true);
  checks += 3;

  // The anchor is the whole safety of this rule. A feed line about anyone else
  // must not declare the player dead, or the coach goes silent every time a
  // teammate trades.
  ok('a teammate dying is not the player dying',
    spectate.readHudOwner({ killFeed: 'Sova killed by Reyna', tell: 'own HP 100', hp: 100 }).spectating === false);
  ok('nor is a third party kill',
    spectate.readHudOwner({ killFeed: 'Reyna killed Sova' }).spectating === false);
  checks += 2;

  // phase is the MODEL's verdict rather than a printed fact, and trusting it
  // alone is the bug the HP-beats-death rule exists to prevent.
  ok('phase dead alone never decides',
    spectate.readHudOwner({ phase: 'dead', tell: 'own HP 100', hp: 100 }).spectating === false);
  ok('but phase dead plus the feed does',
    spectate.readHudOwner({ phase: 'dead', killFeed: 'Killed by Omen' }).spectating === true);
  ok('an ordinary living frame is still untouched',
    spectate.readHudOwner({ tell: 'own HP 87 and Vandal', hp: 87, agent: 'Jett' }).spectating === false);
  checks += 3;
}

console.log('PASS: all ' + checks + ' spectator and death-review checks passed');

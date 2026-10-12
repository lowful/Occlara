'use strict';

/**
 * The health a player died with is not health they still have.
 *
 * When a player dies, the server strips the health number before it is sent,
 * because the number on screen now belongs to the spectated teammate (see
 * test-alive-claims). The client merge then skipped the absent field and left
 * the player's LAST-ALIVE health sitting in match context.
 *
 * That number is not inert. The server decides whether to coach a living player
 * with `alive === true || hp > 0`, so a context of { playerAlive: false,
 * playerHp: 100 } resolves to ALIVE, and the prompt told the model:
 *
 *   "THE PLAYER IS ALIVE RIGHT NOW, at 100 HP, and is playing this round.
 *    Do NOT review a death..."
 *
 * while the player sat watching a killcam. Every deliberate guard downstream is
 * built on the client and the server agreeing about whether the player is
 * breathing, and this quietly broke that agreement on every frame after a death.
 *
 * Run: npm run test:deathhp
 */
const path = require('path');
const CoachingEngine = require(path.join(__dirname, '..', 'src', 'main', 'services', 'coaching-engine.js'));

let pass = 0, fail = 0;
const check = (name, ok, detail) => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : `\n        ${detail}`}`);
};

// The exact test the server applies to decide if it is coaching a live player.
const serverSeesAlive = (ctx) => ctx.playerAlive === true
  || (typeof ctx.playerHp === 'number' && ctx.playerHp > 0);

function alivePlayer() {
  const e = new CoachingEngine({});
  e.updateMatchContext({ phase: 'active', playerAlive: true, playerHp: 100, playerWeapon: 'Vandal', roundNumber: 4 });
  return e;
}

console.log('alive and being read normally:');
{
  const e = alivePlayer();
  check('  health is merged', e.matchContext.playerHp === 100);
  check('  the server sees a live player', serverSeesAlive(e.matchContext) === true);
}

console.log('\nthe frame the death lands on (health absent, dead tell named):');
{
  const e = alivePlayer();
  e.updateMatchContext({ playerAlive: false, aliveTell: 'SWITCH PLAYER prompt bottom left, killcam playing' });
  check('  the death registered', e.matchContext.playerAlive === false, 'a proven tell needs only one frame');
  check('  health was cleared', e.matchContext.playerHp == null,
    `still ${e.matchContext.playerHp}`);
  check('  THE SERVER NO LONGER SEES A LIVE PLAYER', serverSeesAlive(e.matchContext) === false,
    'this is the assertion the whole file exists for');
}

console.log('\nthe frames after it, showing the spectated teammate at full health:');
{
  const e = alivePlayer();
  e.updateMatchContext({ playerAlive: false, aliveTell: 'killcam playing, KILLED BY panel' });
  // Valorant shows the spectated teammate's HUD in the same slots. If a frame
  // does report a number, it is theirs, so it must not be adopted.
  e.updateMatchContext({ phase: 'dead', playerHp: 100, playerWeapon: 'Operator', playerCredits: 3200 });
  check('  a spectated health number is not adopted', e.matchContext.playerHp == null,
    `adopted ${e.matchContext.playerHp}`);
  check('  the spectated weapon is still ignored too', e.matchContext.playerWeapon === 'Vandal',
    `became ${e.matchContext.playerWeapon}`);
  check('  the server still sees a dead player', serverSeesAlive(e.matchContext) === false);
}

console.log('\nrespawning takes their own health back:');
{
  const e = alivePlayer();
  e.updateMatchContext({ playerAlive: false, aliveTell: 'spectating teammate, killcam playing' });

  // The respawn frame itself still reads as spectating, because the guard asks
  // what the context says and the context is only updated by the merge it
  // guards. Every spectator-owned field lags by exactly one frame this way, so
  // health lagging with them is the consistent behaviour, not a new quirk.
  e.updateMatchContext({ phase: 'buy', playerAlive: true, playerHp: 100, playerWeapon: 'Classic' });
  check('  alive again immediately', e.matchContext.playerAlive === true);
  check('  the server sees a live player again', serverSeesAlive(e.matchContext) === true,
    'this is what actually matters, and playerAlive carries it on its own');
  check('  health lags one frame, exactly like the weapon does',
    e.matchContext.playerHp == null && e.matchContext.playerWeapon === 'Vandal',
    `hp=${e.matchContext.playerHp} weapon=${e.matchContext.playerWeapon}`);

  e.updateMatchContext({ phase: 'buy', playerAlive: true, playerHp: 100, playerWeapon: 'Classic' });
  check('  and both read again on the next frame',
    e.matchContext.playerHp === 100 && e.matchContext.playerWeapon === 'Classic',
    `hp=${e.matchContext.playerHp} weapon=${e.matchContext.playerWeapon}`);
}

console.log('\nA NAMED SPECTATOR TELL NOW BEATS THE HEALTH NUMBER:');
{
  const e = alivePlayer();
  // THIS CASE CHANGED, deliberately, and it is worth saying why.
  //
  // It used to assert the opposite: that a readable health number refused a
  // dead read even when the tell said "spectating a teammate". Two things were
  // wrong with that.
  //
  // First, it contradicted the server, which has always dropped the health for
  // this exact tell ("the tell wins and the health number is DROPPED rather
  // than reassigned, because it belongs to somebody else"). So the combination
  // this asserted on could not reach the client in production at all; the test
  // only saw it because it feeds the engine directly.
  //
  // Second, it is the bug. In a real graded session the player's genuine first
  // death was rejected twice with "said the player was dead while they were
  // alive at 100 HP", because the spectator camera puts the SPECTATED
  // teammate's health in the same corner of the screen. Health is only ground
  // truth for being alive while the HUD is still the player's own.
  e.updateMatchContext({ playerAlive: false, playerHp: 87, aliveTell: 'spectating a teammate' });
  check('  an explicit spectator tell is believed', e.matchContext.playerAlive === false,
    'the tell names a spectator screen, so the health belongs to somebody else');
  check('  and the health is dropped, not adopted', e.matchContext.playerHp == null,
    `got ${e.matchContext.playerHp}`);
  check('  the server sees a dead player', serverSeesAlive(e.matchContext) === false);
}

console.log('\nBUT A HEDGED TELL STILL LOSES TO THE HEALTH NUMBER:');
{
  // The protection the case above was really reaching for. A model that is
  // guessing says so, and a guess must never silence a living player mid round.
  const e = alivePlayer();
  e.updateMatchContext({ playerAlive: false, playerHp: 87, aliveTell: 'unreadable, assuming spectating' });
  check('  an unsure tell does not kill the player', e.matchContext.playerAlive === true,
    'the model hedged, so the health number wins');
  check('  and that health is kept', e.matchContext.playerHp === 87,
    `got ${e.matchContext.playerHp}`);
}

console.log('\nan unproven dead read still waits for a second frame:');
{
  const e = alivePlayer();
  e.updateMatchContext({ playerAlive: false });          // no tell, no health: unproven
  check('  one bare alive:false does not kill the player', e.matchContext.playerAlive === true);
  check('  and health is untouched', e.matchContext.playerHp === 100,
    `got ${e.matchContext.playerHp}`);
  e.updateMatchContext({ playerAlive: false });          // second agreeing read
  check('  two agreeing reads do', e.matchContext.playerAlive === false);
  check('  and then health is cleared', e.matchContext.playerHp == null,
    `got ${e.matchContext.playerHp}`);
}

// The player's Sunset swiftplay (8.3.0, a read a second), its tells as the
// server keeps them, cut at 60 characters.
console.log('\nthe death screen proves a death on its own frame:');
{
  // Round 2's first frame of the death screen, its alive flag left unread.
  const e = alivePlayer();
  e.updateMatchContext({ phase: 'postplant', spike: 'planted', aliveTell: 'KILLED BY Jett upper right and COMBAT REPORT open, no own' });
  check('  KILLED BY and the COMBAT REPORT register at once', e.lastDeathAt > 0 && e.matchContext.playerAlive === false,
    'it waited a read, so the death registered a second late, on the next frame');
  const s = alivePlayer();
  s.updateMatchContext({ phase: 'active', playerAlive: false, aliveTell: 'SWITCH PLAYER bottom left with teammate portrait' });
  check('  and so does SWITCH PLAYER', s.lastDeathAt > 0);
}

console.log('\na "dead" phase needs the same proof as the alive flag:');
{
  // It registered a death on one frame of its own: the round 4 banner of that
  // match, at 99 health, is the case below it.
  const e = alivePlayer();
  e.updateMatchContext({ phase: 'dead', aliveTell: 'own HP not visible' });
  check('  one dead phase that proves nothing registers no death', e.lastDeathAt === 0 && e.matchContext.playerAlive === true,
    'the phase registered a death on one unchecked frame');
  check('  and leaves the phase as it was', e.matchContext.phase === 'active', `phase ${e.matchContext.phase}`);
  e.updateMatchContext({ phase: 'dead', aliveTell: 'own HP not visible' });
  check('  a second agreeing read does', e.lastDeathAt > 0);
}

console.log('\nthe SPECTATORS counter is a living player\'s HUD:');
{
  const e = alivePlayer();
  e.updateMatchContext({ phase: 'dead', playerAlive: false, aliveTell: 'Spectating 1 top right and teammate shown, no own HP' });
  e.updateMatchContext({ phase: 'dead', playerAlive: false, aliveTell: 'SPECTATORS 1 top right, teammate Phoenix centered with own w' });
  check('  the round 4 banner read as dead on two frames running registers no death', e.lastDeathAt === 0,
    'the second counter read was taken for the second agreeing read');
  check('  and the player is alive', e.matchContext.playerAlive === true);
  // Where another signal says the HUD is somebody else's, the counter still
  // proves nothing: the death waits for a read that does.
  const f = new CoachingEngine({});
  f.setAgent('Jett');
  f.updateMatchContext({ phase: 'active', playerAlive: true, playerHp: 100, playerWeapon: 'Vandal', roundNumber: 4 });
  f.updateMatchContext({ phase: 'dead', playerAlive: false, aliveTell: 'SPECTATORS 1 top right and Sova abilities' });
  check('  beside a teammate\'s kit, the counter is no proof on one frame', f.lastDeathAt === 0);
}

console.log('\na death on a weak tell is judged by the read after it:');
/** A living player at 100 with a Ghost in a post plant, then one read of a weak tell. */
function weakDeath() {
  const e = new CoachingEngine({});
  e.updateMatchContext({ phase: 'postplant', playerAlive: true, playerHp: 100, playerWeapon: 'Ghost', teamScore: 1, enemyScore: 3 });
  e.updateMatchContext({ phase: 'postplant', playerAlive: false, teamScore: 1, enemyScore: 3,
    aliveTell: 'Spectating teammate, own HP not shown, Ghost and abilities b' });
  return e;
}
{
  const e = weakDeath();
  check('  it registers at once', e.lastDeathAt > 0 && e.matchContext.playerAlive === false && e.matchContext.consecutiveDeaths === 1);
  // 460.1 s of that match: the player's own HUD as it stood before.
  e.updateMatchContext({ phase: 'postplant', playerAlive: true, playerHp: 100, playerWeapon: 'Ghost', teamScore: 1, enemyScore: 3,
    aliveTell: 'own HP 100 bottom center and Ghost bottom right' });
  check('  and is withdrawn when the next read is the player\'s own HUD again', e.matchContext.playerAlive === true
    && e.matchContext.consecutiveDeaths === 0 && !e.matchMemory.some((l) => /Player died/.test(l)),
    `alive ${e.matchContext.playerAlive}, deaths in a row ${e.matchContext.consecutiveDeaths}`);
  check('  with its own health and gun back', e.matchContext.playerHp === 100 && e.matchContext.playerWeapon === 'Ghost');
  const at = e.lastDeathAt;
  e.updateMatchContext({ phase: 'dead', playerAlive: false, teamScore: 1, enemyScore: 3,
    aliveTell: 'Spectating teammate, teammate portrait and name shown top ba' });
  check('  and the counter read again a second later is no second death', e.lastDeathAt === at);
}
{
  // Only a withdrawal takes the death's line out of the match memory.
  const stands = (x) => x.matchMemory.some((l) => /Player died/.test(l));
  // The Abyss swiftplay's round 1: the read after the death is the spectated
  // teammate's HUD, called the player's own.
  const e = weakDeath();
  e.updateMatchContext({ phase: 'postplant', playerAlive: true, playerHp: 61, playerWeapon: 'Knife', teamScore: 1, enemyScore: 3,
    aliveTell: 'own HP 61 and knife bottom left' });
  check('  a different health and gun is somebody else\'s HUD: the death stands', stands(e));
  const b = weakDeath();
  b.updateMatchContext({ phase: 'buy', playerAlive: true, playerHp: 100, playerWeapon: 'Ghost', teamScore: 1, enemyScore: 3 });
  check('  so does one the next round\'s buy phase follows', stands(b));
  const s = new CoachingEngine({});
  s.updateMatchContext({ phase: 'postplant', playerAlive: true, playerHp: 100, playerWeapon: 'Ghost', teamScore: 1, enemyScore: 3 });
  s.updateMatchContext({ phase: 'dead', playerAlive: false, teamScore: 1, enemyScore: 3, aliveTell: 'KILLED BY Neon and COMBAT REPORT shown' });
  s.updateMatchContext({ phase: 'postplant', playerAlive: true, playerHp: 100, playerWeapon: 'Ghost', teamScore: 1, enemyScore: 3,
    aliveTell: 'own HP 100 and Ghost bottom right' });
  check('  and one the death screen printed stands whatever the read after it says', s.lastDeathAt > 0 && stands(s));
}
{
  const stands = (x) => x.matchMemory.some((l) => /Player died/.test(l));
  // Each half of "as it stood" holds on its own.
  const hp = weakDeath();
  hp.updateMatchContext({ phase: 'postplant', playerAlive: true, playerHp: 61, playerWeapon: 'Ghost', teamScore: 1, enemyScore: 3,
    aliveTell: 'own HP 61 and Ghost bottom right' });
  const gun = weakDeath();
  gun.updateMatchContext({ phase: 'postplant', playerAlive: true, playerHp: 100, playerWeapon: 'Vandal', teamScore: 1, enemyScore: 3,
    aliveTell: 'own HP 100 and Vandal bottom right' });
  check('  the same gun at another health, or the same health with another gun, is not the HUD as it stood',
    stands(hp) && stands(gun), `stands at 61 with the Ghost ${stands(hp)}, at 100 with a Vandal ${stands(gun)}`);
  const score = weakDeath();
  score.updateMatchContext({ phase: 'postplant', playerAlive: true, playerHp: 100, playerWeapon: 'Ghost', teamScore: 2, enemyScore: 3,
    aliveTell: 'own HP 100 and Ghost bottom right' });
  check('  nor is a read at another score, the round after it', stands(score));
  const said = weakDeath();
  said.updateMatchContext({ phase: 'postplant', playerAlive: true, playerHp: 100, playerWeapon: 'Ghost', teamScore: 1, enemyScore: 3,
    aliveTell: 'Spectating teammate, unclear, own HP 100 and Ghost' });
  check('  nor one whose tell says spectating, however unsure of it', stands(said));
  const feed = weakDeath();
  feed.updateMatchContext({ phase: 'postplant', playerAlive: true, playerHp: 100, playerWeapon: 'Ghost', teamScore: 1, enemyScore: 3,
    aliveTell: 'own HP 100 and Ghost bottom right', killFeed: 'Killed by Reyna' });
  check('  nor one whose kill feed prints the player\'s own KILLED BY', stands(feed));
  // WHOSE HUD IS IT, asked of the read that would withdraw the death: the
  // spectated teammate's kit called "own", at the player's health and gun.
  const kit = new CoachingEngine({});
  kit.setAgent('Jett');
  kit.updateMatchContext({ phase: 'active', playerAlive: true, playerHp: 100, playerWeapon: 'Vandal', teamScore: 2, enemyScore: 2 });
  kit.updateMatchContext({ phase: 'active', playerAlive: false, teamScore: 2, enemyScore: 2, aliveTell: 'Spectating teammate, own HP not shown' });
  kit.updateMatchContext({ phase: 'active', playerAlive: true, playerHp: 100, playerWeapon: 'Vandal', teamScore: 2, enemyScore: 2,
    aliveTell: 'own HP 100 and Sova abilities bottom center' });
  check('  a teammate\'s kit called "own" at the player\'s health and gun is the teammate\'s HUD: the death stands',
    stands(kit));
  // THE VERY NEXT READ, in seconds: one after a pause or a server outage, its
  // score unread, can be a later round, the player at full health with the
  // same rifle bought again.
  const late = new CoachingEngine({});
  const t = Date.now();
  late.updateMatchContext({ phase: 'active', playerAlive: true, playerHp: 100, playerWeapon: 'Vandal', teamScore: 2, enemyScore: 2 }, t);
  late.updateMatchContext({ phase: 'active', playerAlive: false, teamScore: 2, enemyScore: 2,
    aliveTell: 'Spectating teammate, own HP not shown' }, t + 1000);
  late.updateMatchContext({ phase: 'active', playerAlive: true, playerHp: 100, playerWeapon: 'Vandal',
    aliveTell: 'own HP 100 and Vandal bottom left' }, t + 181000);
  check('  a read three minutes after the death judges nothing: it stands', stands(late));
}

console.log(`\n${fail ? 'FAIL' : 'PASS'}: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

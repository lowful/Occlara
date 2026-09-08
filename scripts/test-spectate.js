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
 */

const assert = require('assert');
const spectate = require('../src/shared/spectate-tells');

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

// ── Death reviews must survive the repetition gates ─────────────────────────
{
  // The engine decides deathness with DEATH_REVIEW_RE before the repetition
  // gates run. These are real tips from the session, 15 of which were dropped
  // for repetition and should not have been.
  const engineSrc = require('fs').readFileSync(
    require('path').join(__dirname, '..', 'src/main/services/coaching-engine.js'), 'utf8');
  const m = engineSrc.split(/\r?\n/).find((l) => l.indexOf('const DEATH_REVIEW_RE =') === 0);
  ok('the engine still declares DEATH_REVIEW_RE', !!m);
  const RE = eval(m.slice(m.indexOf('/'), m.lastIndexOf('/i') + 2));  // eslint-disable-line no-eval

  const reviews = [
    'You died holding A Nest alone after your teammate traded, so next time wait for a trade partner.',
    'You died to a wide angle with no cover, so next time retreat behind the box.',
    'You died to a Sage wall because you peeked A Nest wide with no trade partner.',
    'You died holding A Rafters alone with no crossfire, so next round find a partner.',
    'You died to a close-range pistol while holding a wide angle with no cover.',
  ];
  for (const t of reviews) ok(`recognised as a death review: "${t.slice(0, 38)}"`, RE.test(t));

  const notReviews = [
    'Stay tight to the wall on your right and hold a head-level crosshair.',
    'The spike is planting at B Site, so hold your angle tight.',
    'Set up a crossfire on A site with your Killjoy.',
  ];
  for (const t of notReviews) ok(`NOT a death review: "${t.slice(0, 38)}"`, !RE.test(t));
}

// ── Nothing throws on junk ──────────────────────────────────────────────────
{
  assert.doesNotThrow(() => spectate.readHudOwner(null), 'null frame');
  assert.doesNotThrow(() => spectate.readHudOwner({}), 'empty frame');
  assert.doesNotThrow(() => spectate.foreignAgentInTell(null, null), 'null tell');
  checks += 3;
}

console.log('PASS: all ' + checks + ' spectator and death-review checks passed');

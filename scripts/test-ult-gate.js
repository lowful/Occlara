'use strict';

/**
 * The coach may not tell a player to press an ultimate they do not have.
 *
 * WHY THIS COULD NOT EXIST BEFORE. The coach had no ability state at all. The
 * STATE contract carried no field for it, mapState parsed none, and
 * matchContext held none, so every ultimate tip the model ever wrote was
 * unchecked. The prompt told the model to READ the ability icons
 * (coach.js, "lit or colored icons are AVAILABLE") and never asked it to report
 * what it saw, so the information was looked at and thrown away.
 *
 * The cost of getting this wrong is higher than a mistimed basic ability. A
 * basic comes back in thirty seconds; an ultimate is a whole round's plan, so
 * "ult them now" on a half charged ultimate is not slightly early, it is advice
 * the player cannot act on at all.
 *
 * UNKNOWN MUST STAY PERMISSIVE. The icon is small and often obscured, so null
 * is the common read. A gate that fired on null would silence every ultimate
 * tip in the game rather than the wrong ones.
 *
 * Run: npm run test:ultgate
 */

const fs = require('fs');
const path = require('path');
const { __test } = require(path.join(__dirname, '..', 'src', 'main', 'services', 'coaching-engine.js'));
const { verifyTip } = __test;

let fails = 0;
const ok = (cond, what) => { if (!cond) { fails++; console.log(`FAIL  ${what}`); } else console.log(`ok    ${what}`); };

const base = {
  agent: 'Sova', agentConfirmed: true, map: 'Ascent', side: 'attacking',
  phase: 'active', playerAlive: true, teammatesAlive: 2, enemiesAlive: 3,
  roundNumber: 7, playerHp: 100,
};
const run = (tip, ult) => verifyTip(tip, 'ai', { ...base, playerUlt: ult });

// ── The pattern itself, asserted against known strings ──────────────────────
// CLAUDE.md requires this for every new regex, and it is why the live version
// of this pattern was caught: written as new RegExp with an escaped string it
// lost every backslash, \s+ became a literal "s", and it matched none of these.
{
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'services', 'coaching-engine.js'), 'utf8');
  const m = src.match(/const ULT_COMMAND = (\/.*\/i);/);
  ok(!!m, 'ULT_COMMAND is a regex literal, not an escaped string');
  if (m) {
    const ULT = eval(m[1]);                               // eslint-disable-line no-eval
    for (const t of ['Use your ult here.', 'Pop ult on the site take.', 'Go ult and take the space.',
      'Ult them now while they group.', 'Press X as you swing.',
      'Save your ultimate for the retake.', 'Cast your ultimate on the plant.']) {
      ok(ULT.test(t), `matches a real ult command: ${JSON.stringify(t)}`);
    }
    for (const t of ['Hold the angle and wait for a trade.', 'Your ultimate economy is fine this half.',
      'The enemy ulted, back off.', 'Use your smoke for the entry.', 'Reposition after the kill.']) {
      ok(!ULT.test(t), `does not match: ${JSON.stringify(t)}`);
    }
  }
}

// ── Charging: the one state that blocks ─────────────────────────────────────
{
  ok(run('Use your ult to take the site now.', 'charging') === null,
    'an ult command is blocked while the ultimate is charging');
  ok(run('Pop ult before they group up.', 'charging') === null,
    'and so is another phrasing of it');
}

// ── Ready and unknown both permit ───────────────────────────────────────────
{
  ok(run('Use your ult to take the site now.', 'ready') !== null,
    'the same tip passes when the ultimate is ready');
  ok(run('Use your ult to take the site now.', null) !== null,
    'and passes when the ult state is UNKNOWN, because null is not evidence');
  ok(run('Use your ult to take the site now.', undefined) !== null,
    'and when the field is absent entirely');
}

// ── The gate is about ultimates, not about every tip ────────────────────────
{
  ok(run('Hold the angle and let them come to you.', 'charging') !== null,
    'a tip that does not command an ult is untouched while charging');
  ok(run('Clear the corner before you step onto the site.', 'charging') !== null,
    'and so is ordinary positioning advice');
}

// ── The HUD stops being yours the moment you die ────────────────────────────
// SPECTATOR_OWNED is the reason this matters: after a death the ultimate icon
// belongs to the teammate being watched, so a charged ult down there is THEIRS.
{
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'services', 'coaching-engine.js'), 'utf8');
  const m = src.match(/const SPECTATOR_OWNED = \[([^\]]*)\]/);
  ok(!!m, 'SPECTATOR_OWNED exists');
  ok(m && /playerUlt/.test(m[1]),
    'playerUlt is spectator owned, so a dead player never inherits a teammate ultimate');
}

// ── The server contract carries the field ───────────────────────────────────
{
  const coach = fs.readFileSync(path.join(__dirname, '..', 'server', 'routes', 'coach.js'), 'utf8');
  ok(/"ult":null/.test(coach), 'the STATE schema line declares ult');
  ok(/^- ult:/m.test(coach), 'and the contract describes how to read it');
  ok(/out\.playerUlt = u;/.test(coach), 'and mapState parses it into playerUlt');
  // An enum, so an odd read lands absent rather than as a third state.
  ok(/u === 'ready' \|\| u === 'charging'/.test(coach),
    'only ready and charging are accepted, anything else is dropped');
}

console.log(`\n${fails ? fails + ' failure(s)' : 'all ult gate checks passed'}`);
process.exit(fails ? 1 : 0);

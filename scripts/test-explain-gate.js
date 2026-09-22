'use strict';

/**
 * The explanation card must never appear while the player can be shot.
 *
 * This is the safety property of the whole "why that tip" feature. The live tip
 * is one sentence because it is read mid fight; the explanation is three
 * paragraphs, and three paragraphs is not something anyone reads while holding
 * an angle. Offering it at the wrong moment would cost more rounds than the
 * depth wins.
 *
 * The gate therefore REFUSES BY DEFAULT, which is the opposite of how most
 * guards in this codebase treat an unreadable field. Elsewhere unknown means
 * "say nothing about that" and coaching carries on. Here the cost is asymmetric:
 * refusing when the player was safe costs one keypress, allowing when they were
 * mid duel costs the round.
 *
 * Run: npm run test:explaingate
 */

const fs = require('fs');
const path = require('path');
const { explainAllowed } = require(path.join(__dirname, '..', 'src', 'shared', 'explain-gate.js'));

let fails = 0;
const ok = (cond, what) => { if (!cond) { fails++; console.log(`FAIL  ${what}`); } else console.log(`ok    ${what}`); };

// ── The two safe moments ────────────────────────────────────────────────────
{
  ok(explainAllowed({ phase: 'buy', playerAlive: true }).ok,
    'the buy phase allows it, barriers are up and nobody can shoot you');
  ok(explainAllowed({ phase: 'dead', playerAlive: false }).ok,
    'being dead allows it');
  ok(explainAllowed({ phase: 'active', playerAlive: false }).ok,
    'playerAlive false allows it even when the phase still says active');
  ok(explainAllowed({ phase: 'dead', playerAlive: true }).ok,
    'and phase dead allows it even when playerAlive still says true');
}

/*
 * THOSE LAST TWO ARE NOT PADDING. The engine reads spectating as
 * `playerAlive === false || phase === 'dead'` precisely because the two
 * disagree on real frames, and a gate that demanded both would refuse a dead
 * player on exactly the frames where the HUD is ambiguous, which is most of
 * them right after a death.
 */

// ── Every other moment refuses, including unknown ───────────────────────────
{
  const mid = explainAllowed({ phase: 'active', playerAlive: true });
  ok(!mid.ok, 'mid round refuses');
  ok(/mid round/i.test(mid.why || ''), 'and says why, rather than doing nothing silently');

  ok(!explainAllowed({ phase: 'postplant', playerAlive: true }).ok,
    'post plant refuses, the round is still live');
  ok(!explainAllowed({}).ok, 'an empty context refuses');
  ok(!explainAllowed(null).ok, 'a missing context refuses');
  ok(!explainAllowed({ phase: 'unknown', playerAlive: true }).ok,
    'an unknown phase refuses, because unknown is not evidence of safety');
  ok(!explainAllowed({ phase: undefined, playerAlive: undefined }).ok,
    'and so does a context where nothing was read at all');
}

// ── The refusal is a sentence a player can act on ───────────────────────────
{
  const why = explainAllowed({ phase: 'active', playerAlive: true }).why;
  ok(typeof why === 'string' && why.length > 20, 'the refusal explains itself');
  ok(/buy phase|after you die/i.test(why), 'and names when to try again');
  ok(!/[–—]/.test(why), 'with no em or en dash');
}

// ── The wiring, which a pure function cannot cover ──────────────────────────
{
  const root = path.join(__dirname, '..');
  const ch = fs.readFileSync(path.join(root, 'src', 'shared', 'channels.js'), 'utf8');
  ok(/PUSH_EXPLAIN:\s*'push:explain'/.test(ch), 'the channel is declared in channels.js');
  // The whitelist is what lets a renderer subscribe at all; a channel missing
  // from it silently receives nothing, which is the failure the PUSH_LIST
  // comment in that file exists to prevent.
  ok(/CHANNELS\.PUSH_EXPLAIN,/.test(ch), 'and is on the renderer subscribe whitelist');

  const pre = fs.readFileSync(path.join(root, 'src', 'preload', 'overlay-preload.js'), 'utf8');
  ok(/onExplain:\s*\(cb\) => subscribe\(C\.PUSH_EXPLAIN, cb\)/.test(pre),
    'the overlay preload bridges it through the constant, never a typed string');

  const ov = fs.readFileSync(path.join(root, 'src', 'renderer', 'overlay', 'overlay.js'), 'utf8');
  ok(/function showExplain\(/.test(ov), 'the overlay renders it');
  ok(/explain-body/.test(ov), 'through a class that preserves paragraph breaks');
  // A screenshot caught this: textContent drops blank lines, so the first
  // version rendered three paragraphs as one unbroken wall.
  const css = fs.readFileSync(path.join(root, 'src', 'renderer', 'overlay', 'overlay.css'), 'utf8');
  ok(/\.explain-body\s*\{[^}]*white-space:\s*pre-wrap/.test(css),
    'and the CSS keeps those breaks with pre-wrap');
  ok(/setInteractive\(false\)/.test(ov),
    'and hands the mouse back to the game on dismiss');

  const main = fs.readFileSync(path.join(root, 'src', 'main', 'index.js'), 'utf8');
  ok(/explainAllowed\(/.test(main), 'main consults the shared gate rather than its own copy');
  ok(/explainTip:\s*\(\) => controller\.explainLastTip\(\)/.test(main),
    'and the hotkey action is wired');
  const hk = fs.readFileSync(path.join(root, 'src', 'main', 'hotkeys.js'), 'utf8');
  ok(/'explainTip'/.test(hk), 'to a real binding');
}

console.log(`\n${fails ? fails + ' failure(s)' : 'all explain gate checks passed'}`);
process.exit(fails ? 1 : 0);

'use strict';

/**
 * What the Rivals coach knows, and what it must stop claiming once it goes off.
 *
 * The split this file guards is durable game theory versus dated hero strength.
 * Valorant map knowledge stays true for years; Rivals rebalances constantly, and
 * a coach confidently naming last season's best pick is worse than one that says
 * nothing about heroes at all. So the tier list expires and the fundamentals do
 * not, and the coach is built on the half that never rots.
 *
 * Run: npm run test:rivalsknowledge
 */
const path = require('path');
const k = require(path.join(__dirname, '..', 'server', 'services', 'rivals-knowledge.js'));

let fails = 0;
const ok = (cond, what) => { if (!cond) { fails++; console.log(`FAIL  ${what}`); } else console.log(`ok    ${what}`); };

// ── The counter triangle must be a real triangle ────────────────────────────
// It is the single most useful durable fact in the game, and it is only useful
// if it is consistent. A typo here teaches the player a matchup backwards.
{
  const ids = Object.keys(k.ARCHETYPES);
  ok(ids.length === 3, `there are exactly three archetypes (${ids.join(', ')})`);
  for (const [id, a] of Object.entries(k.ARCHETYPES)) {
    ok(a.beats !== id && a.losesTo !== id, `${a.name} does not beat or lose to itself`);
    ok(k.ARCHETYPES[a.beats].losesTo === id, `${a.name} beats ${a.beats}, and ${a.beats} agrees it loses to ${id}`);
    ok(k.ARCHETYPES[a.losesTo].beats === id, `${a.name} loses to ${a.losesTo}, and ${a.losesTo} agrees it beats ${id}`);
    ok(a.why && a.why.length > 30, `${a.name} explains WHY rather than just asserting`);
  }
}

// ── Every role is covered, with the parts a tip actually needs ──────────────
{
  const roles = Object.keys(k.ROLE_CRAFT);
  ok(roles.join() === 'Vanguard,Duelist,Strategist', `all three roles present (${roles.join(', ')})`);
  for (const [r, c] of Object.entries(k.ROLE_CRAFT)) {
    for (const field of ['job', 'position', 'mistake', 'reads']) {
      ok(typeof c[field] === 'string' && c[field].length > 20, `${r} has a real ${field}`);
    }
  }
}

// ── The dated snapshot EXPIRES ──────────────────────────────────────────────
// The whole point of separating volatile from durable. Past the horizon the
// hero names are withheld rather than hedged, on the same principle as the
// callout gate: do not name a thing you cannot verify.
{
  const day = 86400000;
  ok(k.metaIsFresh(k.META.capturedAt), 'the snapshot is fresh on the day it was captured');
  ok(k.metaIsFresh(k.META.capturedAt + (k.META_MAX_AGE_DAYS - 1) * day), 'and just inside the horizon');
  ok(!k.metaIsFresh(k.META.capturedAt + (k.META_MAX_AGE_DAYS + 1) * day), 'and stale just outside it');

  const fresh = k.block({ now: k.META.capturedAt });
  const stale = k.block({ now: k.META.capturedAt + 400 * day });

  /*
   * Driven off META.strong rather than a hardcoded hero name, because this used
   * to assert /Peni Parker/ and that is a Season 9.5 fact living inside a test.
   * When Season 10 landed and the list was emptied, the test failed for being
   * out of date rather than for anything being wrong, which is the sort of
   * failure that gets a test deleted instead of read.
   *
   * Both states are legitimate. A populated list must reach the prompt. An empty
   * one must produce no strength claim at all, which is the honest position
   * right after a season rolls: the season is known, the tier list is not.
   */
  if (k.META.strong.length) {
    const first = k.META.strong[0];
    ok(fresh.includes(first), 'a fresh block names the strong heroes');
    ok(!stale.includes(first), 'a STALE block names no hero at all');
  } else {
    ok(!/performing strongly/i.test(fresh),
      'an empty strong list makes no strength claim, rather than an empty one');
    ok(fresh.includes(String(k.META.heroCount)),
      'but a fresh block still carries the season and the roster size');
  }
  ok(!/tier|win rate|strongest/i.test(k.metaBlock(k.META.capturedAt + 400 * day)), 'and makes no strength claim');

  // Losing the snapshot must not gut the coach. This is what makes the design
  // survivable: the durable half carries it alone.
  ok(stale.length > 2000, `the coach still knows plenty with no meta at all (${stale.length} chars)`);
  ok(/Beats poke/.test(stale), 'including the counter triangle');
  ok(/Vanguard\. Job:/.test(stale), 'and what every role is for');
}

// ── The snapshot must never become an instruction ───────────────────────────
// A tier list that reads as an order produces "switch to Peni" regardless of
// whether the player has ever played her, which is the opposite of coaching.
{
  const m = k.metaBlock(k.META.capturedAt);
  ok(/NEVER tell the player to switch/i.test(m), 'the meta block forbids switching on the strength of the list');
  ok(/never claim a hero is weak/i.test(m), 'and forbids calling a hero weak');
  ok(/own results.*outrank/i.test(m), "and says the player's own results outrank it");
}

// ── Nothing here may carry a dash, since the model copies its punctuation ───
for (const [name, text] of [['fundamentals', k.fundamentals()], ['meta', k.metaBlock(k.META.capturedAt)], ['block', k.block()]]) {
  ok(!/[—–]/.test(text), `the ${name} block has no em or en dashes`);
}

// ── Determinism, because a prompt that changes per call is untestable ───────
ok(k.block({ now: k.META.capturedAt }) === k.block({ now: k.META.capturedAt }),
  'block() is deterministic for the same moment');

// ── Aim model, which is what makes an accuracy number mean anything ─────────
{
  ok(/travel time/i.test(k.AIM_MODEL.projectile), 'projectile is defined by travel time');
  ok(/instant/i.test(k.AIM_MODEL.hitscan), 'hitscan is defined by being instant');
  ok(/do not coach the accuracy/i.test(k.fundamentals()),
    'and the coach is told NOT to judge accuracy when it cannot tell which applies');
}

// ── The dive target block, measured from the hero data ──────────────────────
// This existed as three unread fields on every hero record for weeks: the coach
// knew the SHAPE of a dive and not its target. These assert it is computed from
// the real data rather than typed, so a patch that moves a health pool moves the
// paragraph with it.
{
  const f = k.diveFacts();
  ok(f !== null, 'the dive facts are computable from the hero data');

  if (f) {
    // Derive the same numbers independently, so a bug in diveFacts cannot
    // agree with itself.
    const heroes = require(path.join(__dirname, '..', 'server', 'services', 'rivals-heroes.js'));
    const rows = Object.keys(heroes.HEROES).map((name) => heroes.traits(name))
      .filter((t) => t && typeof t.hp === 'number');
    const strat = rows.filter((t) => t.role === 'Strategist').map((t) => t.hp);

    ok(f.strat.n === strat.length, `every Strategist is counted (${f.strat.n} of ${strat.length})`);
    ok(f.strat.min === Math.min(...strat) && f.strat.max === Math.max(...strat),
      `the Strategist band is the real one (${f.strat.min} to ${f.strat.max})`);
    ok(f.vanguard.max > f.strat.max,
      'Vanguards are on a different scale from Strategists, which is the whole point');
    ok(f.divable > 0 && f.divable < f.total,
      `some heroes are divable and some are not (${f.divable} of ${f.total})`);

    const block = k.fundamentals();
    ok(block.includes('WHAT A DIVE IS HUNTING'), 'and the block reaches the prompt');
    ok(block.includes(String(f.strat.n)), 'carrying the real Strategist count');
    ok(block.includes(String(f.strat.max)), 'and the real health band');

    // THE REFUSAL. The coach cannot read enemy heroes off a scoreboard, so a
    // dive paragraph that named one would be teaching it to do the thing that
    // failed its gate.
    ok(/Do not name which enemy hero/.test(block),
      'and it forbids naming which enemy hero is where');
    for (const hero of ['mantis', 'luna snow', 'jeff', 'rocket']) {
      ok(!block.toLowerCase().includes(hero),
        `the dive block names no specific Strategist (${hero})`);
    }
  }
}

console.log(fails ? `\n${fails} failure(s)` : '\nall rivals knowledge checks passed');
process.exit(fails ? 1 : 0);

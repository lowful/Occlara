'use strict';

/**
 * What the Rivals coach knows about Marvel Rivals.
 *
 * The Valorant equivalent is knowledge.js, a retrieval store of pro habits. This
 * is deliberately built on a different principle, because the two games rot at
 * different speeds. Valorant map knowledge stays true for years. Rivals
 * rebalances constantly, and Season 9 alone reworked the entire team-up system.
 *
 * So knowledge here is split in two, and the split is the whole design:
 *
 *   DURABLE   how the game works. Archetypes, the counter triangle, what each
 *             role is actually for, what hitscan means. This survives patches
 *             because it describes shape rather than numbers, and it is safe to
 *             state plainly.
 *
 *   VOLATILE  which heroes are strong right now. Win rates, tier lists, "Peni
 *             is the best Vanguard". This is true for weeks, and a coach
 *             confidently naming last season's best pick is worse than a coach
 *             that says nothing about heroes at all.
 *
 * Volatile knowledge therefore carries a date and EXPIRES. Past the horizon it
 * is withheld entirely rather than hedged, on the same principle as the callout
 * gate: do not name a thing you cannot verify. The durable half keeps working
 * forever, which is why the coach is built on it and not on a tier list.
 */

// ─── Durable: how the game works ─────────────────────────────────────────────

/**
 * The three shapes a team can take, and the triangle between them.
 *
 * This is the single most useful durable fact in the game: it is transitive,
 * teachable in one sentence, and true regardless of which heroes are strong.
 */
const ARCHETYPES = {
  dive: {
    name: 'Dive',
    idea: 'get on top of the enemy backline before they can react, using mobility and off angles',
    beats: 'poke',
    losesTo: 'brawl',
    why: 'poke teams stand far apart to hold distance, so a diver reaches an isolated target, but a brawl team stands close enough to punish the diver together',
  },
  poke: {
    name: 'Poke',
    idea: 'hold distance and chip health from range, only committing once someone is already low',
    beats: 'brawl',
    losesTo: 'dive',
    why: 'a brawl team has to walk through open ground to reach you, but a dive team skips that ground entirely',
  },
  brawl: {
    name: 'Brawl',
    idea: 'stay close together and win the fight in contact, where healing and peel overlap',
    beats: 'dive',
    losesTo: 'poke',
    why: 'everyone is close enough to peel for each other, so a diver eats the whole team, but standing together is exactly what long range damage wants to see',
  },
};

/**
 * What each role is FOR, and the mistake that role makes.
 *
 * The mistakes are one idea rather than a list: nearly every role error is a
 * player importing another role's instincts. The Duelist tanking, the Vanguard
 * retreating like a support, the Strategist holding an angle like a sniper.
 * Framing it that way makes a tip land, because it names the impulse rather
 * than scolding the outcome.
 */
const ROLE_CRAFT = {
  Vanguard: {
    job: 'take and hold space, and be the reason the fight happens where you want it',
    position: 'at the edge of the point, between cover, in front of everyone',
    mistake: 'retreating like a Strategist the moment health drops, which hands over the space the team was fighting for',
    reads: 'low Damage Blocked for a Vanguard usually means space was never taken, not that the fight was unwinnable',
  },
  Duelist: {
    job: 'convert the space the Vanguard made into a pick',
    position: 'ahead of the Strategists and beside the Vanguard, not behind them. Standing directly behind the front line means every shot the team fires comes from one direction, and a single barrier stops all of it',
    mistake: 'tanking. Taking the fight at the front line without the health pool to survive it',
    reads: 'high deaths with low damage is almost always position rather than aim',
  },
  Strategist: {
    job: 'keep the team alive and decide who gets resources first',
    position: 'behind the fight with cover within one step, and never on the same sightline as the enemy backline',
    mistake: 'playing as a heal bot, or as a sniper. Staying alive and using utility on time beats raw healing done',
    reads: 'high healing on a loss often means the team was taking avoidable damage, not that healing was the problem',
  },
};

/**
 * What a dive is actually hunting, MEASURED rather than asserted.
 *
 * This was the one piece of the archetype work that got built and never
 * connected: rivals-heroes.js computes `squishy`, `hpShield` and `hpTotal` off
 * the official health values and nothing read any of them. So the coach knew
 * the shape of a dive and not its target.
 *
 * The numbers come from the game's own hero pages via npm run sync:rivals, and
 * they are computed here at load rather than typed, so a patch that moves a
 * health pool moves this paragraph with it. Measured on the current roster:
 *
 *   Vanguard    300 to 1400 base
 *   Duelist     150 to 375
 *   Strategist  250 to 275, ALL TEN OF THEM
 *
 * That last line is why "dive the healers" is a rule rather than a preference.
 * It is not that Strategists are usually fragile; it is that every Strategist in
 * the game sits inside a 25 point band that any dive hero's burst clears. No
 * judgement call, no tier list, and it stays true until NetEase moves it.
 *
 * THE COACH STILL CANNOT NAME AN ENEMY, because hero identity off a scoreboard
 * portrait failed its gate. This is written to be usable without naming one: a
 * player can act on "the enemy backline dies to one burst" without being told
 * which hero is standing there.
 */
function diveFacts() {
  let heroes = null;
  try { heroes = require('./rivals-heroes.js'); } catch { return null; }

  const rows = Object.keys(heroes.HEROES)
    .map((k) => heroes.traits(k))
    .filter((t) => t && typeof t.hp === 'number');
  if (rows.length < 20) return null;         // data missing, say nothing

  const band = (role) => {
    const hp = rows.filter((t) => t.role === role).map((t) => t.hp).sort((a, b) => a - b);
    return hp.length ? { min: hp[0], max: hp[hp.length - 1], n: hp.length } : null;
  };
  const strat = band('Strategist');
  if (!strat) return null;

  return {
    strat,
    vanguard: band('Vanguard'),
    duelist: band('Duelist'),
    divable: rows.filter((t) => t.squishy).length,
    total: rows.length,
  };
}

function diveBlock() {
  const f = diveFacts();
  if (!f) return '';
  const same = f.strat.min === f.strat.max;
  return `

WHAT A DIVE IS HUNTING, from the game's own health values:
- Every one of the ${f.strat.n} Strategists has ${same ? `${f.strat.min}` : `between ${f.strat.min} and ${f.strat.max}`} base health. That is
  why the backline is the dive target: it is not a judgement, it is the whole
  role sitting in one narrow band that a single burst clears.
- Vanguards run ${f.vanguard.min} to ${f.vanguard.max}, so diving one alone is not a plan.
- ${f.divable} of ${f.total} heroes have a base pool at or under 300 and are not Vanguards.
Do not name which enemy hero is where, because that cannot be read reliably off
a scoreboard. Coach the SHAPE: who is isolated, and whether the dive has a way
back out.`;
}

// Hitscan hits the instant you click; projectile has travel time and must be
// led. It matters for coaching because it changes what an accuracy number MEANS:
// a low percentage on a projectile hero can be correct play at range, while the
// same number on hitscan is an aim or a positioning problem.
const AIM_MODEL = {
  hitscan: 'hits instantly where the crosshair is, so accuracy reflects aim and positioning directly',
  projectile: 'has travel time and must be led, so accuracy is naturally lower at range and a low number is not automatically a mistake',
};

// ─── Volatile: who is strong right now ───────────────────────────────────────

/**
 * A dated snapshot. EVERY claim here expires.
 *
 * Kept small on purpose. A long tier list is a long list of things that will be
 * wrong in a month, and the coach is built so that losing this block entirely
 * costs it nothing structural.
 */
/*
 * SEASON 10 LANDED AND THIS SNAPSHOT DID NOT SURVIVE IT.
 *
 * A real scoreboard captured on 17 Sep 2026 prints "S10.0 BUTCHER'S BLASPHEMY"
 * in its own corner, and the official roster is 54 with Gorr the God Butcher
 * added. The season and the count below were Season 9.5 facts.
 *
 * `strong` is the part that cannot simply be renumbered. It was a Season 9.5
 * list, and a new season is exactly the event that invalidates one, so it is
 * emptied rather than relabelled. metaBlock() already omits the line when the
 * list is empty, which is the honest state: the coach knows the season and the
 * roster size and does not claim to know who is strong in it.
 *
 * capturedAt is deliberately NOT moved forward. Re-dating a snapshot to today
 * because one field was corrected would restart the 45 day clock on knowledge
 * nobody re-checked, which is the precise failure the expiry exists to prevent.
 */
const META = {
  capturedAt: Date.UTC(2026, 7, 22),          // 22 August 2026
  season: 'Season 10.0, Butcher’s Blasphemy',
  heroCount: 54,
  note: 'Season 10 added Gorr the God Butcher. Which heroes are strong in it has not been measured here.',
  strong: [],
};

// Past this the snapshot is withheld rather than hedged. Matches the horizon
// rivals-meta.js already uses for hero win rates, so the two cannot disagree
// about what counts as stale.
const META_MAX_AGE_DAYS = 45;

function metaIsFresh(now = Date.now()) {
  return (now - META.capturedAt) / 86400000 <= META_MAX_AGE_DAYS;
}

// ─── Prompt blocks ───────────────────────────────────────────────────────────

/** The durable half, always safe to send. */
function fundamentals() {
  const tri = Object.values(ARCHETYPES)
    .map((a) => `- ${a.name}: ${a.idea}. Beats ${a.name === 'Dive' ? 'poke' : a.beats}, loses to ${a.losesTo}, because ${a.why}.`)
    .join('\n');

  const roles = Object.entries(ROLE_CRAFT)
    .map(([r, c]) => `- ${r}. Job: ${c.job}. Position: ${c.position}. The mistake: ${c.mistake}. Reading the numbers: ${c.reads}.`)
    .join('\n');

  return `HOW MARVEL RIVALS ACTUALLY WORKS. Ground the tip in this rather than in generic shooter advice.

THE THREE COMP SHAPES, and the triangle between them:
${tri}
Nearly every comp is one of these three, and the triangle is transitive, so
naming the shape is usually more useful than naming a hero.

WHAT EACH ROLE IS FOR:
${roles}

Nearly every role mistake is a player importing another role's instincts. Name
the impulse rather than scolding the result.

AIM MODELS: hitscan ${AIM_MODEL.hitscan}. Projectile ${AIM_MODEL.projectile}.
So an accuracy number only means something once you know which the hero is, and
if you cannot tell, do not coach the accuracy.

A standard team is two Vanguards, two Duelists and two Strategists. Deviating is
not automatically wrong, but a role at zero is: no Strategist means nothing gets
healed, and no Vanguard means whoever is picked first decides the fight.${diveBlock()}`;
}

/** The volatile half, only while it is still true. */
/**
 * The official balance post, if one has been synced and is still current.
 *
 * THIS IS THE PART OF THE META THAT IS SOURCED. META above is hand written and
 * expires; this is fetched from marvelrivals.com/balancepost/ by
 * npm run sync:rivalsbalance, carries the game version and publish date, and is
 * NetEase describing their own changes.
 *
 * ONLY THE GLOBAL CHANGES GO IN THE PROMPT, plus a count. The post also carries
 * a one line summary for each of 38 heroes, and pasting 38 sentences into every
 * request would cost more context than it earns and would tempt the model to
 * bring up a hero it cannot see. The per hero lines are used by the post match
 * review instead, where the hero IS known and the player asked to read.
 *
 * The version number is the load bearing part. Without it the model reasons
 * from whatever it absorbed in training, which is a different patch, and does
 * so with no signal that it is out of date.
 */
function balanceBlock(now = Date.now()) {
  let b = null;
  try { b = require('../rivals-balance.generated.json'); } catch { return ''; }
  if (!b || !b.version) return '';

  const published = Date.parse(String(b.published) + 'T00:00:00Z');
  if (!isFinite(published)) return '';
  // The same horizon the rest of the volatile knowledge uses, so the coach
  // cannot be citing a live patch in one paragraph and a dead one in the next.
  if ((now - published) / 86400000 > META_MAX_AGE_DAYS) return '';

  const globals = (b.global || []).filter((g) => g && !/^\s*$/.test(g));
  const heroCount = Object.keys(b.heroes || {}).length
    || (Array.isArray(b.heroes) ? b.heroes.length : 0);

  return `
THE CURRENT PATCH IS VERSION ${b.version}, published ${b.published}. It changed
${heroCount} heroes. Anything you believe about hero numbers from before this
patch may be wrong, so do not quote specific damage, healing or cooldown values.${
  globals.length ? `
Changes that applied to everyone in that patch:
${globals.map((g) => '- ' + g).join(String.fromCharCode(10))}` : ''}`;
}

function metaBlock(now = Date.now()) {
  if (!metaIsFresh(now)) return '';
  // KNOWING THE SEASON AND NOT KNOWING THE TIER LIST IS A REAL STATE, and it is
  // the one this snapshot is in right after a season rolls. An empty list used
  // to render as "Heroes performing strongly right now: ." which is a claim
  // shaped like a sentence with nothing inside it. The line is omitted instead,
  // and with it the paragraph warning against acting on a list that is not
  // there, since there is then nothing to warn about.
  const strong = META.strong.length
    ? `\nHeroes performing strongly right now: ${META.strong.join(', ')}.
Treat this as background only.`
    : '';
  // THE GUARDRAILS ARE UNCONDITIONAL. Only the first of the three is about the
  // list; the other two hold whether or not a list exists, and an earlier pass
  // at this moved all three inside the conditional, which quietly dropped "never
  // claim a hero is weak" the moment the tier list was emptied. That is the
  // wrong half to lose: no list plus no rule against calling a hero weak is more
  // dangerous than a list with rules, not less.
  return `CURRENT META, captured ${new Date(META.capturedAt).toISOString().slice(0, 10)} for ${META.season} across ${META.heroCount} heroes. ${META.note}${strong}
NEVER tell the player to switch to a hero purely because a list says it is
strong, and never claim a hero is weak.
The player's own results with a hero outrank any tier list.`;
}

/**
 * Everything the prompt should carry.
 *
 * @param opts.meta include the dated snapshot (default true)
 */
function block(opts = {}) {
  const parts = [fundamentals()];
  if (opts.meta !== false) {
    // TWO SOURCES, TWO CLOCKS, added separately on purpose.
    //
    // metaBlock is the hand written snapshot; balanceBlock is fetched from the
    // game's own balance post. They go stale on different days. Nesting the
    // balance paragraph inside metaBlock meant the sourced, first party, current
    // one vanished the moment the hand written one aged out, which is exactly
    // backwards: that is the point at which the fetched one is the only meta
    // knowledge left worth having.
    const m = metaBlock(opts.now);
    if (m) parts.push(m);
    const b = balanceBlock(opts.now);
    if (b) parts.push(b.trim());
  }
  return parts.join('\n\n');
}

module.exports = {
  ARCHETYPES, ROLE_CRAFT, AIM_MODEL, META, META_MAX_AGE_DAYS,
  metaIsFresh, fundamentals, metaBlock, balanceBlock, diveFacts, diveBlock, block,
};

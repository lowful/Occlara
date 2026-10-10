'use strict';

/**
 * Why did the player die? One look at the moment itself.
 *
 * The round ledger and Riot's record say WHEN a player died, to WHOM and with
 * WHAT, and nothing about the decision that put them there. That decision is
 * what a coach reviews, and it is on the screen: the frame just before the
 * death shows where they stood, who was near them and what they were doing.
 *
 * So for the few deaths worth teaching (match-review.teachable picks them), the
 * client sends the last frame before Riot's death second, and the one just
 * after it when there is one, and this asks for three things:
 *
 *   cause    ONE label from a fixed list, so deaths can be counted across
 *            rounds and across matches. A free text reason cannot be counted,
 *            and "your most repeated mistake" is a count.
 *   what     one sentence, what the frame shows happening
 *   better   one sentence, the play that would have kept them alive
 *
 * A LOST DUEL IS NOT A MISTAKE. It is on the list so the model has somewhere
 * honest to put a fair fight that went the other way, rather than inventing a
 * positioning error to fill the slot. The grade counts it as unavoidable.
 *
 * Every sentence passes the same gates the rest of the review does: no other
 * map's callouts, no ability the player's agent does not have, and no killer
 * other than the one Riot names. A sentence that fails is dropped, never
 * repaired, and a death whose sentences all fail keeps only its label.
 *
 * FROM THE SCREEN ALONE (8.2), `source: 'screen'`. A review Riot's record never
 * reached sends the deaths the screen saw, framed by the frame the screen
 * registered each one on and the one before it. Then the facts are the
 * screen's, the round, the side, where it placed the death, a plant, and the
 * prompt says they were read off the screen and may be incomplete, never that
 * they are Riot's and exact. Riot's facts arriving beside that source are
 * dropped rather than stated as the screen's. The screen never knows who
 * killed the player, so no killer may be named at all: the killer gate drops
 * every sentence that names an agent as one, and in any language but English,
 * where its kill words cannot tell, every sentence naming an agent other than
 * the player's own. A body with no source is Riot's, which is every client
 * from before 8.2, and one with no language is English.
 */

const { promptName } = require('./languages');

// "a Vandal", "an Outlaw". The prompt's own grammar is what the model copies,
// and "with a Outlaw" came back in its sentences.
const withArticle = (w) => `${/^[aeiou]/i.test(String(w)) ? 'an' : 'a'} ${w}`;

let DATA = {};
try { DATA = require('../valorant-data.generated.json'); } catch { DATA = {}; }

const CAUSES = {
  'dry-peek':    'peeked an angle with no utility or information first',
  'isolated':    'too far from teammates to be traded',
  'repeek':      'peeked the same angle again after being seen or getting a kill',
  'crossfire':   'walked into two or more enemies holding different angles',
  'rotating':    'caught moving between areas, not set up for a fight',
  'overextend':  'pushed past the team or chased a kill into enemy ground',
  'exposed':     'stood in the open while planting, defusing or holding the spike',
  'lost-duel':   'a fair fight from a sound position, lost on the shot',
  'unclear':     'the frame does not show enough to say',
};
const AVOIDABLE = new Set(['dry-peek', 'isolated', 'repeek', 'crossfire', 'rotating', 'overextend', 'exposed']);

const clip = (v, n) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n);
const lower = (s) => String(s || '').toLowerCase();
// Whether the sentences are asked for in another language than English, the
// one test the prompt and the killer gate both read, so they cannot drift.
const otherLanguage = (input) => !!(input && input.language && input.language !== 'en');

function calloutsOf(map) {
  const geo = (DATA.mapGeometry || {})[lower(map)];
  return geo && Array.isArray(geo.callouts) ? [...new Set(geo.callouts.map((c) => c.n).filter(Boolean))] : [];
}

function kitOf(agent) {
  const a = (DATA.agents || {})[agent];
  return a && Array.isArray(a.abilities) ? a.abilities : [];
}

/** Every ability name in the game, to catch one that belongs to another agent. */
const ALL_ABILITIES = (() => {
  const out = new Map();
  for (const [agent, a] of Object.entries(DATA.agents || {})) {
    for (const ab of (a && a.abilities) || []) {
      if (String(ab).length >= 4) out.set(lower(ab), agent);
    }
  }
  return out;
})();

const AGENTS = Object.keys(DATA.agents || {});

/** A sentence naming a distinctive callout that does not exist on this map. */
function wrongMap(text, map) {
  const m = lower(map);
  const t = lower(text);
  for (const [word, maps] of Object.entries(DATA.mapCallouts || {})) {
    if (!new RegExp(`\\b${word}\\b`).test(t)) continue;
    if (!m || !maps.includes(m)) return word;
  }
  return null;
}

/** A sentence naming an ability the player's agent does not have. */
function foreignAbility(text, agent) {
  const mine = new Set(kitOf(agent).map(lower));
  const t = lower(text);
  for (const [ab, owner] of ALL_ABILITIES) {
    if (mine.has(ab)) continue;
    if (!new RegExp(`\\b${ab.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(t)) continue;
    // Naming the ENEMY'S ability, with its owner in the sentence, is allowed:
    // "the Sova dart revealed you" is the point, not a kit mistake.
    if (new RegExp(`\\b${lower(owner)}\\b`).test(t)) continue;
    return ab;
  }
  return null;
}

// A sentence about who won the fight. With Riot's killer on record, naming
// any other agent in one is the claim the gate drops.
const KILL_WORDS = /\b(kill|killed|shot|dropped|died to|traded|won the duel|lost the duel|beat you)\b/i;
// From the screen alone there is no killer on record at all, so every way of
// saying who did it is a claim, the killer and the one who took you out
// included.
const SCREEN_KILL_WORDS = /\b(kill|kills|killed|killer|killing|shot|dropped|died to|fell to|traded|won the duel|lost the duel|beat you|took you out|picked you off|eliminated)\b/i;

/**
 * A sentence naming an agent as the killer who is not the one Riot recorded.
 * From the screen alone (`source` 'screen'), a sentence naming any agent as
 * the killer, since the screen never records one.
 *
 * THE KILL WORDS ARE ENGLISH, and a look is written in the player's language
 * (buildPrompt): "Una Sova te mato" and "Der Sova hat dich erschossen"
 * matched none of them and kept a killer the screen never saw. A list of how
 * nine languages say it would have holes, so from the screen, in any language
 * but English, a sentence naming any agent other than the player's own is
 * taken as naming the killer. `opts` is the request, for its language and the
 * player's agent. A teammate's smoke goes with it, which is the safe
 * direction: a sentence is lost, never a killer made up. In English the words
 * decide, so "Your Omen smoke faded" still stands.
 */
function wrongKiller(text, killer, source, opts) {
  const screen = source === 'screen';
  if (!killer && !screen) return null;
  const t = String(text || '');
  const said = (screen ? SCREEN_KILL_WORDS : KILL_WORDS).test(t);
  // Outside English with no kill word read, the one agent a sentence may
  // still name is the player's own. Null when the words decide.
  const own = screen && !said && otherLanguage(opts) ? lower(opts.agent) : null;
  if (!said && own === null) return null;
  for (const a of AGENTS) {
    if (!screen && lower(a) === lower(killer)) continue;
    if (own !== null && lower(a) === own) continue;
    const name = a.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
    // With a kill word read, the name in any case is the claim. Without one
    // (outside English) the name alone decides, so it has to be the name as
    // the game prints it, capital and all: "plus sage" is French for wiser,
    // and dropping it took the better play with it. It may carry a case
    // ending, as Polish "Jetta" and German "Jetts" do. Its edges are cased
    // letters only: Japanese and Korean write the name straight against a
    // particle ("Sovaに", "Sova에게"), and kana, kanji and hangul are letters.
    const re = said
      ? new RegExp(`\\b${name}\\b`, 'i')
      : new RegExp(`(^|[^\\p{LC}\\p{N}])${name}\\p{Ll}{0,3}(?![\\p{LC}\\p{N}])`, 'u');
    if (re.test(t)) return a;
  }
  return null;
}

/** One death in, the prompt out. */
function buildPrompt(input, death) {
  const callouts = calloutsOf(input.map);
  const kit = kitOf(input.agent);
  // Read off the screen, and framed by when the screen read the death (8.2).
  const screen = input.source === 'screen';
  const facts = [];
  facts.push(`Round ${death.n}, ${death.side === 'attacking' ? 'on attack' : death.side === 'defending' ? 'on defence' : 'side unknown'}.`);
  if (typeof death.sec === 'number') facts.push(`Died ${death.sec} seconds after the barriers dropped.`);
  if (death.killer) facts.push(`Killed by ${death.killer}${death.weapon ? ` with ${withArticle(death.weapon)}` : ''}.`);
  if (death.firstDeath) facts.push('The first death of the round, on either team.');
  if (death.alive) facts.push(`Standing when it happened: ${death.alive.mates} of their team, player included, against ${death.alive.enemies}.`);
  if (death.traded === true) facts.push('A teammate killed the killer within five seconds (the death was traded).');
  if (death.traded === false) facts.push('Nobody on the team killed the killer within five seconds (not traded).');
  // The screen sees a plant and not when the death came against it, so a look
  // from the screen alone says only that there was one.
  if (death.planted) {
    facts.push(screen ? 'The screen saw the spike planted in this round.'
      : death.afterPlant ? 'The spike was already planted.' : 'The spike was planted later in the round.');
  }
  if (death.spot) facts.push(`The screen placed the death at ${death.spot}.`);
  if (typeof death.gap === 'number') {
    facts.push(death.gap <= 1 ? 'The first frame was taken in the second the player died.'
      : `The first frame was taken about ${death.gap} seconds before the player died.`);
  }

  const frames = screen
    ? (death.frames.length > 1
      ? 'Two frames from the player\'s own screen: the FIRST is the last one before the screen read the player as dead, the SECOND is the first one where it did.'
      : 'One frame from the player\'s own screen, the last one before the screen read the player as dead.')
    : death.frames.length > 1
      ? 'Two frames from the player\'s own screen: the FIRST is the last one before the death, the SECOND is just after it.'
      : 'One frame from the player\'s own screen, the last one before the death.';
  const header = screen
    ? "FACTS READ OFF THE SCREEN during the match. Riot's record of it was not available, so they may be incomplete:"
    : "FACTS FROM RIOT'S RECORD, exact, do not contradict them:";
  const killerRule = screen
    ? 'Name no killer: the screen does not record who killed the player, so never say which agent did.'
    : 'Name no killer other than the one in the facts.';
  // The spectator trap: the instant a player dies, the HUD becomes a
  // teammate's, alive and fighting, and the screen can take a few seconds to
  // read the death. So the frame before it may already be that teammate's.
  const late = screen
    ? '- The screen can read a death a few seconds late, and once the player is dead Valorant shows a teammate\'s view. If the first frame already shows the player dead or watching a teammate, the cause is unclear.\n'
    : '';

  return `You are reviewing one death of a Valorant player after the match, as their coach. ${frames}

${header}
${facts.join('\n')}

Player's agent: ${input.agent || 'unknown'}. Their abilities: ${kit.length ? kit.join(', ') : 'unknown, so name no abilities'}.
Map: ${input.map || 'unknown'}. Callouts that exist on it: ${callouts.length ? callouts.join(', ') : 'unknown, so name no callouts'}.

Pick the ONE cause that best fits what the frame shows:
${Object.entries(CAUSES).map(([k, v]) => `${k}: ${v}`).join('\n')}

Rules:
- Describe only what is visible in the frame and stated in the facts. If the frame does not show the moment (a menu, a death screen only, a blur), the cause is unclear.
- If the first frame shows no enemy and no fight, and was taken several seconds before the death, you cannot see what happened next: the cause is unclear unless the position itself is the mistake (alone far from every teammate on the minimap, standing in the open on the spike).
${late}- Where the player is: read the location name printed above the minimap in the top left. Do not guess a place from the scenery.
- Ignore any text boxes or cards drawn over the game by other apps. Judge from the game itself.
- Weapons and health are in the bottom HUD. Do not call a pistol a knife or an Operator a rifle.
- A fair fight from a sound position is lost-duel. Do not invent a positioning error to have something to say.
- Speak to the player as "you". Name no ability they do not have and no callout that is not in the list. ${killerRule}
- No dashes. Plain sentences, each ending with a period.

${otherLanguage(input) ? `Write "what" and "better" in ${promptName(input.language)}. Keep "cause" as the English label from the list, and keep callouts and agent names exactly as the game prints them.\n\n` : ''}Reply with JSON only, no other text:
{"cause": "<one label from the list>", "what": "<one sentence, what happened>", "better": "<one sentence, the play that keeps you alive>"}`;
}

/** The model's reply for one death, parsed and gated. Never throws. */
function parse(text, input, death) {
  const out = { n: death.n, cause: 'unclear', what: null, better: null, dropped: [] };
  let j = null;
  const raw = String(text || '');
  const m = raw.match(/\{[\s\S]*\}/);
  if (m) { try { j = JSON.parse(m[0]); } catch { j = null; } }
  if (!j || typeof j !== 'object') return out;
  const cause = lower(j.cause).trim().replace(/\s+/g, '-');
  out.cause = Object.prototype.hasOwnProperty.call(CAUSES, cause) ? cause : 'unclear';
  for (const field of ['what', 'better']) {
    let s = clip(j[field], 240).replace(/[\u2013\u2014]/g, ',').replace(/\s+-\s+/g, ', ');
    if (!s) continue;
    if (!/[.!?]$/.test(s)) s += '.';
    const bad = wrongMap(s, input.map) || foreignAbility(s, input.agent) || wrongKiller(s, death.killer, input.source, input);
    if (bad) { out.dropped.push({ field, why: bad }); continue; }
    out[field] = s;
  }
  // A cause the model could not explain in a single surviving sentence is not
  // one the review should count against the player.
  if (!out.what && out.cause !== 'unclear' && out.cause !== 'lost-duel') out.cause = 'unclear';
  // AN UNCLEAR FRAME GETS NO SENTENCES. On the bench, every unclear answer came
  // with a sentence about the frame itself ("this frame does not show what
  // caused your death", "use this frame only to reset"), which is the model
  // talking about its own input. The label and the picture say it better.
  if (out.cause === 'unclear') { out.what = null; out.better = null; }
  return out;
}

/**
 * The request body, checked: at most four deaths, at most two frames each.
 *
 * `source` is 'screen' only when the client says so (8.2), and 'riot'
 * otherwise, which is what every client before 8.2 sent its deaths as. From
 * the screen a death keeps what the screen can read, its round, its side,
 * its spot and a plant, and nothing only Riot records: no second, killer,
 * weapon, first death, trade, numbers standing or timing against the plant.
 */
function normalise(body) {
  const b = body || {};
  const screen = b.source === 'screen';
  const riot = (v) => (screen ? null : v);
  const deaths = (Array.isArray(b.deaths) ? b.deaths : []).slice(0, 12).map((d) => ({
    n: Number(d && d.n) || 0,
    side: d && d.side === 'attacking' ? 'attacking' : d && d.side === 'defending' ? 'defending' : null,
    sec: riot(typeof (d && d.sec) === 'number' ? Math.round(d.sec) : null),
    killer: riot(clip(d && d.killer, 24) || null),
    weapon: riot(clip(d && d.weapon, 24) || null),
    firstDeath: !screen && !!(d && d.firstDeath),
    traded: riot(d && typeof d.traded === 'boolean' ? d.traded : null),
    alive: riot(d && d.alive && typeof d.alive.mates === 'number' && typeof d.alive.enemies === 'number'
      ? { mates: d.alive.mates, enemies: d.alive.enemies } : null),
    planted: !!(d && d.planted),
    afterPlant: !screen && !!(d && d.afterPlant),
    spot: clip(d && d.spot, 32) || null,
    gap: riot(d && typeof d.gap === 'number' && d.gap >= 0 && d.gap <= 15 ? Math.round(d.gap) : null),
    frames: (Array.isArray(d && d.frames) ? d.frames : [])
      .filter((f) => typeof f === 'string' && f.length > 1000 && f.length < 1500000).slice(0, 2),
  })).filter((d) => d.n > 0 && d.frames.length).slice(0, 4);
  return { agent: clip(b.agent, 24) || null, map: clip(b.map, 24) || null,
    language: typeof b.language === 'string' ? clip(b.language, 8) : 'en',
    source: screen ? 'screen' : 'riot', deaths };
}

module.exports = { CAUSES, AVOIDABLE, buildPrompt, parse, normalise, wrongMap, foreignAbility, wrongKiller, calloutsOf };

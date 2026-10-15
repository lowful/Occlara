'use strict';

/**
 * THE DEATH LOOK AS 8.4.4 SHIPPED IT, frozen: server/services/death-forensics.js
 * at release 8.4.4 (ff3ebbc), its code untouched, only its two requires pointed
 * back at server/. Never served. scripts/test-forensics.js holds today's look,
 * as a client before 8.5.0 is answered, to this one byte for byte: the same
 * prompt for every body, and the same parse of every reply but where the two
 * gates every client gets since change it (a sentence naming someone dropped,
 * isolated on a death Riot records traded made unclear). Never edit it: it is
 * the record of what an installed client was built against.
 */

const { promptName } = require('../../server/services/languages');

// "a Vandal", "an Outlaw". The prompt's own grammar is what the model copies,
// and "with a Outlaw" came back in its sentences.
const withArticle = (w) => `${/^[aeiou]/i.test(String(w)) ? 'an' : 'a'} ${w}`;

let DATA = {};
try { DATA = require('../../server/valorant-data.generated.json'); } catch { DATA = {}; }

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

// "3 s", "0.7 s": a frame's distance from the death as the prompt says it.
const secs = (at) => {
  const s = Math.abs(at);
  return `${s >= 10 ? Math.round(s) : Math.round(s * 10) / 10} s`;
};

/**
 * What the frames are, frame by frame, when the client said when each was
 * taken (frameAt, 8.3.1): from the recording or the read, against Riot's death
 * second or, from the screen alone, the moment the screen read the death.
 */
function framesLines(death, screen) {
  const from = death.framesFrom === 'recording' ? "the player's own screen recording" : "the player's own screen";
  const mark = screen ? 'the screen read the player as dead' : 'the death';
  const lines = death.frameAt.map((at, i) => `Frame ${i + 1}: ${at === 0 ? `the moment ${mark}` : `${secs(at)} ${at < 0 ? 'before' : 'after'} ${mark}`}.`);
  const head = death.frameAt.length > 1 ? `${death.frameAt.length} frames from ${from}, in time order:` : `One frame from ${from}:`;
  const timing = screen
    ? 'The screen can read a death a few seconds late, so the death itself came at or before the moment it did, and may already show in an earlier frame.'
    : "The seconds are from Riot's death second, the moment its record has the player dying, good to a few tenths of a second.";
  return `${head}\n${lines.join('\n')}\n${timing}`;
}

/** One death in, the prompt out. */
function buildPrompt(input, death) {
  const callouts = calloutsOf(input.map);
  const kit = kitOf(input.agent);
  // Read off the screen, and framed by when the screen read the death (8.2).
  const screen = input.source === 'screen';
  const timed = Array.isArray(death.frameAt) && death.frameAt.length === death.frames.length;
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
  // The spot is the last place the screen read, which on the real Sunset match
  // put round 6's death at A Site, a round earlier's, while every frame of it
  // printed Mid Courtyard. Timed frames from around the death print the place
  // themselves, and win.
  if (death.spot) {
    facts.push(timed ? `The screen placed the death at ${death.spot}. If the frames print another place above the minimap, that is where it was.`
      : `The screen placed the death at ${death.spot}.`);
  }
  if (typeof death.gap === 'number' && !timed) {
    facts.push(death.gap <= 1 ? 'The first frame was taken in the second the player died.'
      : `The first frame was taken about ${death.gap} seconds before the player died.`);
  }

  const frames = timed ? framesLines(death, screen) : screen
    ? (death.frames.length > 1
      ? 'Two frames from the player\'s own screen: the FIRST is the last one before the screen read the player as dead, the SECOND is the first one where it did.'
      : 'One frame from the player\'s own screen, the last one before the screen read the player as dead.')
    : death.frames.length > 1
      ? 'Two frames from the player\'s own screen: the FIRST is the last one before the death, the SECOND is just after it.'
      : 'One frame from the player\'s own screen, the last one before the death.';
  // Several frames, timed: what to read in the ones before the death and the
  // one after it, and when there is too little to say.
  const sees = timed
    ? `- The frames before the death show where the player was and the fight, if there was one. A frame after it shows Valorant's death screen: KILLED BY and the combat report of the damage each side dealt, which tells a fight the player was in from one they never saw.
- If no frame before the death shows an enemy or the fight, you cannot see what happened: the cause is unclear unless the position itself is the mistake (alone far from every teammate on the minimap, standing in the open on the spike).
`
    : '- If the first frame shows no enemy and no fight, and was taken several seconds before the death, you cannot see what happened next: the cause is unclear unless the position itself is the mistake (alone far from every teammate on the minimap, standing in the open on the spike).\n';
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

Pick the ONE cause that best fits what the ${timed && death.frames.length > 1 ? 'frames show' : 'frame shows'}:
${Object.entries(CAUSES).map(([k, v]) => `${k}: ${v}`).join('\n')}

Rules:
- Describe only what is visible in the ${timed && death.frames.length > 1 ? 'frames' : 'frame'} and stated in the facts. If the frame does not show the moment (a menu, a death screen only, a blur), the cause is unclear.
${sees}${late}- Where the player is: read the location name printed above the minimap in the top left. Do not guess a place from the scenery.
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

// A frame as the look sends it: one JPEG, base64, of a sane size.
const isFrame = (f) => typeof f === 'string' && f.length > 1000 && f.length < 1500000;
// Frames a death, untimed (every client before 8.3.1) and timed (frameAt).
const MAX_FRAMES = 2;
const MAX_TIMED_FRAMES = 5;
// How far from the death a timed frame may be, either way, in seconds: a
// clip runs from 11 s before it to 4 s after.
const MAX_FRAME_AT = 15;

/**
 * A death's frames and, when the client gave them, each one's seconds from the
 * death (8.3.1): { frames, frameAt, framesFrom }. Timed, at most five, the
 * nearest the death kept, in time order whatever order they came in (a client
 * sends the last before the death and the first after it ahead of the rest,
 * which is what a server from before reads as its two). Untimed, or timed in
 * a way that does not add up (a time missing, one past a clip's length), at
 * most two in the order sent, as before, and frameAt null.
 */
function framesOf(d) {
  const raw = Array.isArray(d && d.frames) ? d.frames : [];
  const at = d && Array.isArray(d.frameAt) ? d.frameAt : null;
  const timed = at && at.length === raw.length
    && at.every((x) => typeof x === 'number' && Number.isFinite(x) && Math.abs(x) <= MAX_FRAME_AT);
  if (!timed) return { frames: raw.filter(isFrame).slice(0, MAX_FRAMES), frameAt: null, framesFrom: null };
  const pairs = raw.map((f, i) => ({ f, at: Math.round(at[i] * 100) / 100 })).filter((p) => isFrame(p.f))
    .sort((a, b) => Math.abs(a.at) - Math.abs(b.at)).slice(0, MAX_TIMED_FRAMES)
    .sort((a, b) => a.at - b.at);
  return {
    frames: pairs.map((p) => p.f),
    frameAt: pairs.length ? pairs.map((p) => p.at) : null,
    framesFrom: d.framesFrom === 'recording' ? 'recording' : 'reads',
  };
}

/**
 * The request body, checked: at most four deaths, at most two frames each, or
 * five each with their seconds from the death (framesOf).
 *
 * `source` is 'screen' only when the client says so (8.2), and 'riot'
 * otherwise, which is what every client before 8.2 sent its deaths as. From
 * the screen a death keeps what the screen can read, its round, its side,
 * its spot and a plant, and nothing only Riot records: no second, killer,
 * weapon, first death, trade, numbers standing or timing against the plant.
 * Its frames' seconds are from the moment the screen read the death, the
 * screen's own, and are kept.
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
    ...framesOf(d),
  })).filter((d) => d.n > 0 && d.frames.length).slice(0, 4);
  return { agent: clip(b.agent, 24) || null, map: clip(b.map, 24) || null,
    language: typeof b.language === 'string' ? clip(b.language, 8) : 'en',
    source: screen ? 'screen' : 'riot', deaths };
}

module.exports = {
  CAUSES, AVOIDABLE, MAX_FRAMES, MAX_TIMED_FRAMES, MAX_FRAME_AT,
  buildPrompt, parse, normalise, wrongMap, foreignAbility, wrongKiller, calloutsOf,
};

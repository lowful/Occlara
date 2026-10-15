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
 *
 * FROM THE PLAYER'S OWN RECORDING (8.3.1). A recorded match sends up to five
 * stills of the clip around each death, `frameAt` their seconds from it
 * (negative before), `framesFrom: 'recording'`: on the real Sunset match the
 * two frames the live read took showed none of the four fights and every look
 * came back unclear, while the recording held each one 32 times a second. The
 * prompt says what each frame is and when, in time order, from Riot's death
 * second or, from the screen alone, from the moment the screen read the death,
 * which comes up to a few seconds after it. The read's own frames timed by
 * Riot's record come with `frameAt` too ('reads'). A body without frameAt is
 * a client from before, and gets at most two frames and the words it always
 * did.
 *
 * TWO GATES FOR EVERY CLIENT (8.5.0). A what or better sentence that names a
 * player is dropped, as one naming another map's callout is (name-gate.js:
 * the client's read rule with its first word exempt, a handle's shape, and
 * the match's own names when the client sent its match id and this server
 * holds them). And a look labelled isolated on a death Riot records as
 * traded is unclear with no sentences: "too far from teammates to be traded"
 * beside Riot's own trade is the screen's word over Riot's. Both are logged
 * by round, never with the name.
 *
 * VARIANT B: THE FIGHT FIRST, THE LABEL LAST (8.5.0, admin only until bench
 * A). On the player's Fracture and Pearl matches four of the five looks that
 * spoke were "Lost the duel", a fair fight with nothing to fix, while the
 * better play under them said to fall back after the first shots: the reply
 * asked for the cause first and the advice after it. Variant b asks for what
 * happened, then a judgement of the fight (FIGHTS: right, wrong-spot,
 * wrong-time, not-needed, unclear), then the better play, the one thing it
 * changes (CHANGES), and only then a cause from that judgement's family, with
 * a second choice from the same family (`alt`). parse() holds the result in
 * code: a cause outside its fight's family gives way to `alt`, failing both
 * the look is unclear with no sentences and the conflict is logged by its
 * keys alone; a change outside its fight's set is saved as null and the label
 * kept; and a lost duel whose better play reads like a move (PHRASES) is only
 * logged, never relabelled, because the words cannot tell a hedge ("be ready
 * to step back if your first shots miss") from a lesson. No key is added and
 * none renamed: repeek is widened in b's words to staying on the angle as
 * well as coming back to it, so a match like the Fracture swiftplay can count
 * its one lesson in one key.
 *
 * WHO GETS WHICH is the route's to say (coach.js forensicsVariant, the one
 * version gate, clientAtLeast): b to 8.5.0 and later only once promoted
 * (FORENSICS_PROMPT=b), or to an admin bench naming it with the password, and
 * `input.variant` 'b' then. Anything else is a: a client before 8.5.0 is
 * answered with today's prompt and parse exactly, but for the two gates
 * above, and never sees b's words or fields. test:forensics holds variant a
 * to the look as 8.4.4 shipped it (scripts/fixtures/death-forensics-844.js),
 * byte for byte.
 */

const { promptName } = require('./languages');
const nameGate = require('./name-gate');

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

/*
 * VARIANT B'S WORDS FOR TWO OF THEM, the keys the same. Repeek widened to
 * staying on the angle, the Fracture swiftplay's lesson three times over;
 * lost-duel to a fight the player was right to take from where they took it.
 * The review quotes CAUSES (match-review.js), so today's words stay there.
 */
const CAUSES_B = {
  ...CAUSES,
  'repeek':    'fought again from the same angle after the first exchange or a kill, by staying on it or by peeking it again',
  'lost-duel': 'a fight you were right to take, from where you took it, lost on the shot: only the aim, the first shot or the movement in the duel could have changed it',
};

/*
 * THE FIGHT, JUDGED FIRST (variant b), and what each judgement allows: the
 * causes its label may be, and the one thing its better play may change most.
 */
const FIGHTS = {
  'right':      { causes: ['lost-duel'], changes: ['aim', 'none'] },
  'wrong-spot': { causes: ['isolated', 'crossfire', 'overextend', 'exposed', 'rotating'], changes: ['position', 'team', 'utility'] },
  'wrong-time': { causes: ['repeek', 'dry-peek', 'rotating'], changes: ['timing', 'utility', 'team'] },
  'not-needed': { causes: ['overextend', 'repeek', 'exposed', 'dry-peek'], changes: ['decision'] },
  'unclear':    { causes: ['unclear'], changes: ['none'] },
};
const CHANGES = ['aim', 'position', 'timing', 'decision', 'utility', 'team', 'none'];

/*
 * THE PHRASE LISTS: what a better play says it changes, in English, the
 * lists as they were first written (decision, team, reset and timing,
 * utility, aim). They set no label in any variant. A lost duel whose better
 * play trips one but aim is logged for the bench to read; Ask Coach is not
 * given a saved look's label when its better play trips one; and they are
 * Ask Coach's fair fight check. They cannot tell a hedge from a lesson, which
 * is why they only ever log: "be ready to step back if your first shots
 * miss" is a right fight's better play, and trips reset. One list, four
 * copies (this one, the client's in src/shared/death-causes.js, and Ask
 * Coach's in fact-gates.js and chat-context.js), which test:forensics holds
 * equal regex for regex.
 */
const PHRASES = {
  decision: /\b(let them come|let the clock|play for time|make them come to you|no need to|do not take the fight|don't take the fight|hold the spike)\b/i,
  team: /\b(teammates?|trade|swing with|with your team|together)\b/i,
  reset: /\b(fall back|step back|back behind cover|back into cover|reset|disengage|pull back|after your first shots|after the first exchange|after the first burst|instead of staying|stop firing and)\b/i,
  utility: /\b(smoke|flash|drone|recon|utility|information first)\b/i,
  aim: /\b(crosshair|aim|head level|counter ?strafe|tap|burst|first bullet|spray)\b/i,
};
const PHRASE_ORDER = ['decision', 'team', 'reset', 'utility', 'aim'];

/*
 * THE PROMPTS BESIDE THE LIVE ONE, which the route serves only to an admin
 * bench naming one, or once promoted (FORENSICS_PROMPT) only to a client of
 * 8.5.0 or later (coach.js forensicsVariant, by clientAtLeast). The live one,
 * a, is today's, and is what this module answers with for any variant it is
 * not given as 'b'. The reply each is given room for: b's is longer by its
 * judgement, change and alt.
 */
const VARIANTS = ['b'];
const TOKENS = { a: 320, b: 400 };

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

/**
 * Which phrase lists a better play trips, in PHRASE_ORDER: decision, team,
 * reset (and timing), utility (the player's own abilities by name among them)
 * and aim. English only; [] for nothing.
 */
function phraseHits(text, agent) {
  const t = String(text || '');
  if (!t.trim()) return [];
  const kit = kitOf(agent).map(lower);
  const out = [];
  for (const k of PHRASE_ORDER) {
    const kitSaid = k === 'utility' && kit.some((ab) => new RegExp(`\\b${ab.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(t));
    if (PHRASES[k].test(t) || kitSaid) out.push(k);
  }
  return out;
}

/** Whether a better play moves the player (any list but aim): never a fair fight's to the chat. */
function movesPlayer(text, agent) {
  return phraseHits(text, agent).some((k) => k !== 'aim');
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
  // Variant b judges the fight before it writes the better play, and names the
  // cause last, from that judgement's family. Variant a is today's, word for word.
  const b = input.variant === 'b';
  const many = timed && death.frames.length > 1;
  const pick = b ? 'The causes, one of which you pick last, from the group your judgement of the fight allows:'
    : `Pick the ONE cause that best fits what the ${many ? 'frames show' : 'frame shows'}:`;
  const judge = b ? `\n\n${judgement(many)}` : '';
  const fairRule = b ? '' : '- A fair fight from a sound position is lost-duel. Do not invent a positioning error to have something to say.\n';
  const language = !otherLanguage(input) ? ''
    : b ? `Write "what" and "better" in ${promptName(input.language)}. Keep "fight", "change", "cause" and "alt" as the English words from their lists, and keep callouts and agent names exactly as the game prints them.\n\n`
      : `Write "what" and "better" in ${promptName(input.language)}. Keep "cause" as the English label from the list, and keep callouts and agent names exactly as the game prints them.\n\n`;
  const reply = b ? REPLY_B : REPLY_A;

  return `You are reviewing one death of a Valorant player after the match, as their coach. ${frames}

${header}
${facts.join('\n')}

Player's agent: ${input.agent || 'unknown'}. Their abilities: ${kit.length ? kit.join(', ') : 'unknown, so name no abilities'}.
Map: ${input.map || 'unknown'}. Callouts that exist on it: ${callouts.length ? callouts.join(', ') : 'unknown, so name no callouts'}.

${pick}
${Object.entries(b ? CAUSES_B : CAUSES).map(([k, v]) => `${k}: ${v}`).join('\n')}${judge}

Rules:
- Describe only what is visible in the ${many ? 'frames' : 'frame'} and stated in the facts. If the frame does not show the moment (a menu, a death screen only, a blur), the cause is unclear.
${sees}${late}- Where the player is: read the location name printed above the minimap in the top left. Do not guess a place from the scenery.
- Ignore any text boxes or cards drawn over the game by other apps. Judge from the game itself.
- Weapons and health are in the bottom HUD. Do not call a pistol a knife or an Operator a rifle.
${fairRule}- Speak to the player as "you". Name no ability they do not have and no callout that is not in the list. ${killerRule}
- No dashes. Plain sentences, each ending with a period.

${language}${reply}`;
}

const REPLY_A = `Reply with JSON only, no other text:
{"cause": "<one label from the list>", "what": "<one sentence, what happened>", "better": "<one sentence, the play that keeps you alive>"}`;
// Its fields in the order they are decided: what happened, the fight, the
// better play, what it changes, and only then the label and a second choice.
const REPLY_B = `Reply with JSON only, its fields in this order, no other text:
{"what": "<one sentence, what happened>", "fight": "<right, wrong-spot, wrong-time, not-needed or unclear>", "better": "<one sentence, the play that keeps you alive>", "change": "<aim, position, timing, decision, utility, team or none>", "cause": "<one label from the group your judgement allows>", "alt": "<a second label from the same group, or none>"}`;

/** "isolated, crossfire, overextend, exposed or rotating" */
const either = (xs) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} or ${xs[xs.length - 1]}` : xs.join(''));

/**
 * VARIANT B'S JUDGEMENT, beside the cause list, in place of variant a's "a
 * fair fight from a sound position is lost-duel". Its families are FIGHTS',
 * written from them, so the prompt and parse() cannot drift.
 */
function judgement(many) {
  const groups = Object.entries(FIGHTS).map(([fight, f]) => `${fight} is ${either(f.causes)}`).join('; ');
  return `First write what happened. Then judge the fight in one word:
right: a fight to take, from where you took it. Only the shot, the first bullet or the movement in the duel could have changed it.
wrong-spot: a fight to take, but not from there: too far from a teammate to be traded, open to a second enemy, in the open on the spike, or past your team.
wrong-time: the right place at the wrong moment: before any utility or information, while rotating, or again after the first exchange or a kill instead of getting out of sight.
not-needed: a fight the round did not need: your team was ahead, the spike was down and the clock was on your side, or the kill was not worth chasing.
unclear: the ${many ? 'frames do' : 'frame does'} not show the fight.
Then write the better play, the play that keeps you alive. For a right fight it is about the duel itself: the crosshair, the first shot, stopping before you shoot, how you peek. It may tell you to be ready to step back if the first shots miss. A better play that moves you, delays you, gets you out after the first exchange, adds a teammate or an ability, or says not to fight belongs to another judgement.
Then say the one thing the better play changes most: ${CHANGES.slice(0, -1).join(', ')}, or none.
Then pick the cause that fits your judgement: ${groups}. alt is your second choice from the same group, or none.
A Duelist taking first contact with a teammate close enough to trade is doing the job, which is not a wrong spot on its own. A death the facts call traded is never isolated. Do not invent a mistake to have something to say: a fair fight lost is right, and lost-duel.`;
}

/** A word of the model's reply as a key: "Dry Peek" is dry-peek, "wrong spot" wrong-spot. */
const asKey = (v) => lower(v).trim().replace(/\s+/g, '-');
const isCause = (k) => Object.prototype.hasOwnProperty.call(CAUSES, k);
// What a conflict names of a reply's word: its key, 'unknown' for a word off
// the list, 'none' for no word. Never the word itself.
const named = (v, key) => key || (lower(v).trim() && lower(v).trim() !== 'none' ? 'unknown' : 'none');

/** The model's reply as the JSON it wrote, or null: for parse() and for the bench, which scores it before parse. */
function replyJson(text) {
  const m = String(text || '').match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const j = JSON.parse(m[0]);
    return j && typeof j === 'object' ? j : null;
  } catch { return null; }
}

/**
 * WHAT A BENCH IS SENT OF A REPLY, RAW (bench A, an admin's alone): the label
 * words as the model wrote them, before parse() enforced anything, each read
 * as its key, 'unknown' for a word off its list and null for none, and
 * whether it wrote a what at all. Never one of its sentences, nor a word off
 * a list: what the model writes can carry a player's name ("Bad luck from
 * Morvane" as a cause), and no name leaves the server, a bench's reply
 * included. bench-look-score.js scores it as it would the reply's text.
 */
function rawLabels(text) {
  const j = replyJson(text);
  if (!j) return { json: false, fight: null, cause: null, alt: null, change: null, what: false };
  const read = (v, keys) => {
    const k = asKey(v);
    return keys.includes(k) ? k : k && k !== 'none' ? 'unknown' : null;
  };
  const causes = Object.keys(CAUSES);
  return { json: true, fight: read(j.fight, Object.keys(FIGHTS)), cause: read(j.cause, causes), alt: read(j.alt, causes),
    change: read(j.change, CHANGES), what: !!clip(j.what, 240) };
}

// The language a look's sentences were asked for in, as the name gate reads
// it: English for 'en' and for a code the prompt does not know, which is
// asked in English (languages.js promptName), so the capital rule reads it.
const gateLanguage = (input) => (promptName(input && input.language) === 'English' ? 'en' : input.language);

/**
 * The model's reply for one death, parsed and gated. Never throws.
 *
 * Variant a's look is { n, cause, what, better } as it always was, and b's
 * adds { fight, change, variant }. `dropped` is what the route logs and takes
 * out, and `notes` (not enumerable, so never in a reply) what is only logged:
 * logLines() gives both, replyOf() the reply.
 */
function parse(text, input, death) {
  const b = !!(input && input.variant === 'b');
  const out = { n: death.n, cause: 'unclear', what: null, better: null };
  if (b) Object.assign(out, { fight: 'unclear', change: null, variant: 'b' });
  out.dropped = [];
  Object.defineProperty(out, 'notes', { value: [], enumerable: false });
  const j = replyJson(text);
  if (!j) return out;
  if (b) {
    // THE CAUSE MUST BE IN ITS FIGHT'S FAMILY, else its second choice, else
    // nothing: a reply that judged a fight right and labelled it a repeek has
    // contradicted itself, and the look says nothing rather than pick a side.
    const fight = Object.prototype.hasOwnProperty.call(FIGHTS, asKey(j.fight)) ? asKey(j.fight) : null;
    const cause = isCause(asKey(j.cause)) ? asKey(j.cause) : null;
    const alt = isCause(asKey(j.alt)) ? asKey(j.alt) : null;
    const family = fight ? FIGHTS[fight].causes : [];
    const label = family.includes(cause) ? cause : family.includes(alt) ? alt : null;
    if (label) {
      out.cause = label;
      out.fight = fight;
      // What the better play changes is data for the chat and the bench,
      // never the grade: outside its fight's set it is kept as nothing, and
      // the label stands.
      const change = asKey(j.change);
      if (FIGHTS[fight].changes.includes(change)) out.change = change;
      else if (change) {
        out.dropped.push({ field: 'change', why: `${CHANGES.includes(change) ? change : 'unknown'} is not a ${fight} fight's`, gate: 'change' });
      }
    } else {
      out.dropped.push({ field: 'cause', gate: 'conflict',
        why: `conflict: fight ${named(j.fight, fight)}, cause ${named(j.cause, cause)}, alt ${named(j.alt, alt)}` });
    }
  } else {
    const cause = asKey(j.cause);
    out.cause = isCause(cause) ? cause : 'unclear';
  }
  for (const field of ['what', 'better']) {
    let s = clip(j[field], 240).replace(/[\u2013\u2014]/g, ',').replace(/\s+-\s+/g, ', ');
    if (!s) continue;
    if (!/[.!?]$/.test(s)) s += '.';
    const bad = wrongMap(s, input.map) || foreignAbility(s, input.agent) || wrongKiller(s, death.killer, input.source, input);
    if (bad) { out.dropped.push({ field, why: bad }); continue; }
    // NO PLAYER NAMED (8.5.0, every client): the look sees KILLED BY and the
    // kill feed, and a name it copies is saved, shown and handed on. The
    // match's own names come with the input (the route's `names`, from the
    // match id an 8.5.0 client sends). Logged as a name, never as the name;
    // a check that throws drops the sentence, the safe direction.
    let person = null;
    try { person = nameGate.namesSomeone(s, { names: input.names || null, language: gateLanguage(input) }); } catch { person = 'unchecked'; }
    if (person) {
      out.dropped.push({ field, why: 'a name', gate: 'name' });
      continue;
    }
    out[field] = s;
  }
  // ISOLATED IS "too far from teammates to be traded", and a death Riot
  // records as traded was not (8.5.0, every client): Riot's facts win, and the
  // look says nothing rather than the screen's word over Riot's.
  if (out.cause === 'isolated' && death.traded === true) {
    out.cause = 'unclear';
    out.dropped.push({ field: 'cause', why: 'isolated on a death Riot records traded', gate: 'traded' });
  }
  // A cause the model could not explain in a single surviving sentence is not
  // one the review should count against the player.
  if (!out.what && out.cause !== 'unclear' && out.cause !== 'lost-duel') out.cause = 'unclear';
  // AN UNCLEAR FRAME GETS NO SENTENCES. On the bench, every unclear answer came
  // with a sentence about the frame itself ("this frame does not show what
  // caused your death", "use this frame only to reset"), which is the model
  // talking about its own input. The label and the picture say it better.
  if (out.cause === 'unclear') {
    out.what = null;
    out.better = null;
    if (b) { out.fight = 'unclear'; out.change = null; }
  }
  // A LOST DUEL WHOSE BETTER PLAY READS LIKE A MOVE is logged, never
  // relabelled (PHRASES): in English, for the bench to read.
  if (out.cause === 'lost-duel' && out.better && gateLanguage(input) === 'en') {
    const moves = phraseHits(out.better, input.agent).filter((k) => k !== 'aim');
    if (moves.length) out.notes.push(`lost-duel better play trips ${moves.join(', ')}`);
  }
  return out;
}

/**
 * The lines the route logs for one look, by round and keys only: a conflict,
 * what was dropped and why (a name only as "a name"), and a lost duel whose
 * better play trips a phrase list.
 */
function logLines(out) {
  const dropped = (out && out.dropped) || [];
  const conflicts = dropped.filter((d) => d.field === 'cause' && /^conflict: /.test(d.why));
  const rest = dropped.filter((d) => !conflicts.includes(d));
  const lines = conflicts.map((d) => `[forensics] R${out.n} ${d.why}`);
  if (rest.length) lines.push(`[forensics] R${out.n} dropped: ${rest.map((d) => `${d.field} (${d.why})`).join(', ')}`);
  for (const note of (out && out.notes) || []) lines.push(`[forensics] R${out.n} ${note}`);
  return lines;
}

/** One look as the reply carries it: without what is only logged. */
function replyOf(out) {
  const { dropped, ...reply } = out || {};
  return reply;
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
 *
 * `opts.variant` is the prompt the route chose (coach.js forensicsVariant),
 * never the body's word: 'a' unless it is 'b'. `matchId` (8.5.0 and later)
 * is only ever the key to the match's own names (the route's `names`), never
 * in a prompt.
 */
function normalise(body, opts) {
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
    source: screen ? 'screen' : 'riot', deaths,
    variant: opts && opts.variant === 'b' ? 'b' : 'a',
    matchId: typeof b.matchId === 'string' && b.matchId.trim() ? clip(b.matchId, 80) : null };
}

/** The reply's room for one look: b's is longer by its judgement, change and alt. */
function tokensFor(input) {
  return TOKENS[input && input.variant === 'b' ? 'b' : 'a'];
}

module.exports = {
  CAUSES, CAUSES_B, AVOIDABLE, FIGHTS, CHANGES, PHRASES, PHRASE_ORDER, VARIANTS, TOKENS, MAX_FRAMES, MAX_TIMED_FRAMES, MAX_FRAME_AT,
  buildPrompt, parse, normalise, wrongMap, foreignAbility, wrongKiller, calloutsOf,
  phraseHits, movesPlayer, replyJson, rawLabels, logLines, replyOf, tokensFor, judgement,
};

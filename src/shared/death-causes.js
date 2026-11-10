'use strict';

/**
 * Why a player died, as a label the review can COUNT.
 *
 * The server asks the model to pick one of these for each teachable death
 * (server/services/death-forensics.js), and this is the client's copy of the
 * same list, with the words the review shows. check:server forbids the server
 * reaching into src/, so the list lives twice, and npm run test:forensics
 * asserts the two copies carry exactly the same keys.
 *
 * A label is a count waiting to happen: "your most repeated mistake" is a
 * number, and a free text reason cannot be counted across rounds or matches.
 *
 * `title` names two or more, `one` names one (8.4.1): a single look's miss
 * under "What you missed" read "Repeeks" beside its round's "Repeek" chip on
 * the player's Fracture swiftplay (causeTitle, and insights.js inTodaysWords
 * for a review saved before).
 *
 * REPEEK, WIDENED (8.5.0), its key, chip and titles as they were. On that
 * Fracture match the coach's better play for rounds 2, 5 and 6 was the same
 * lesson, to get out of sight after the first shots, under three labels; a
 * look asked with variant b calls staying on the angle after the first
 * exchange a repeek too. Its words are drawn by key, so they must read true
 * of every repeek ever saved, the old "peeked it again" ones among them, and
 * "fought again from the same angle" is both.
 */

const CAUSES = {
  'dry-peek':   { title: 'Dry peeks',            one: 'Dry peek',                detail: 'peeked an angle with no utility or information first', avoidable: true },
  'isolated':   { title: 'Caught alone',          one: 'Caught alone',            detail: 'too far from the team for anyone to trade', avoidable: true },
  'repeek':     { title: 'Repeeks',               one: 'Repeek',                  detail: 'fought again from the same angle after the first exchange', avoidable: true },
  'crossfire':  { title: 'Walked into crossfires', one: 'Walked into a crossfire', detail: 'stepped into two enemies holding different angles', avoidable: true },
  'rotating':   { title: 'Caught rotating',       one: 'Caught rotating',         detail: 'moving between areas, not set for a fight', avoidable: true },
  'overextend': { title: 'Overextended',          one: 'Overextended',            detail: 'pushed past the team or chased a kill into their ground', avoidable: true },
  'exposed':    { title: 'Exposed on the spike',  one: 'Exposed on the spike',    detail: 'in the open while planting, defusing or holding the spike', avoidable: true },
  'no-escape':  { title: 'Risky spots, no escape', one: 'Risky spot, no escape',  detail: 'got a kill from a spot with no way out, and the next enemy killed you before you could leave it', avoidable: true },
  'lost-duel':  { title: 'Lost duels',            one: 'Lost the duel',           detail: 'a fair fight from a sound position that went the other way', avoidable: false },
  'unclear':    { title: 'Unclear',               one: 'Unclear',                 detail: 'the frame did not show enough to say', avoidable: false },
};

const isAvoidable = (key) => !!(CAUSES[key] && CAUSES[key].avoidable);

/** A cause's title for `count` of them: the singular for one, the plural for two or more. Null for no cause. */
function causeTitle(cause, count) {
  const c = CAUSES[cause];
  if (!c) return null;
  return count === 1 ? c.one : c.title;
}

/*
 * A RISKY SPOT WITH NO ESCAPE, FROM RIOT'S RECORD (8.9.6, the owner's Bind
 * match, round 6). On defence at Hookah the player killed the first attacker
 * through the door and the second killed them 1.07 s later: the look called it
 * a repeek, "stayed on the same angle", and its better play said to step back
 * behind cover. In about a second there is no choice to stay or to peek again:
 * the spot itself gave no way out once a second enemy came right behind the
 * first. So a look's repeek or lost duel is this cause in code, never the
 * model's word, when Riot's kill feed has the player's own kill and then their
 * death to ANOTHER enemy within NO_ESCAPE_SEC, and the player was on defence,
 * where nothing is an entry, or on attack with no teammate close (on attack
 * with one close it is a traded entry, a duelist's job). A look from the
 * screen alone has no feed and is never changed. Its sentences are the
 * record's alone: the place is Riot's callout, the killer Riot's agent, the
 * seconds Riot's, and nothing is said of cover the record does not hold. The
 * look's own label is kept as `was`. The model is never offered it
 * (death-forensics.js CODE_ONLY), so no prompt changed.
 */
const NO_ESCAPE_SEC = 1.5;
const NO_ESCAPE_FROM = new Set(['repeek', 'lost-duel']);

/**
 * The round's record as recordCause reads it, from a ledger row (build's
 * input) or a saved card: { side, feed, killer, mate, place }.
 */
function recordOf(r) {
  if (!r || typeof r !== 'object') return null;
  if (r.riot && typeof r.riot === 'object') {
    return { side: r.sideKey || null, feed: r.riot.feed, killer: r.riot.killer || null, mate: r.riot.mate || null, place: r.riot.place || null };
  }
  return { side: r.side || null, feed: r.feed, killer: r.killerAgent || null, mate: r.mateNear || null, place: r.riotSpot || null };
}

/** The player's own kill and the death right after it, or null: { gap, death } from Riot's kill feed. */
function answeredKill(rec) {
  const feed = rec && Array.isArray(rec.feed) ? rec.feed.filter((e) => e && Number.isFinite(e.ms)) : [];
  const death = feed.find((e) => e.on === 'me' && e.by === 'enemy');
  if (!death) return null;
  const kills = feed.filter((e) => e.by === 'me' && e.on === 'enemy' && e.ms <= death.ms);
  const kill = kills[kills.length - 1];
  if (!kill) return null;
  // Another enemy: the one the player killed cannot have killed them.
  if (!death.ka || !kill.va || death.ka === kill.va) return null;
  if (rec.killer && death.ka !== rec.killer) return null;
  const gap = (death.ms - kill.ms) / 1000;
  return gap >= 0 && gap <= NO_ESCAPE_SEC ? { gap, death } : null;
}

/**
 * A look as Riot's record has it: the look unchanged, or with cause
 * 'no-escape', the record's own sentences, and its own label as `was`.
 */
function recordCause(look, r) {
  if (!look || !NO_ESCAPE_FROM.has(look.cause) || look.source === 'screen') return look;
  const rec = recordOf(r);
  if (!rec || (rec.side !== 'defending' && !(rec.side === 'attacking' && rec.mate === 'far'))) return look;
  const hit = answeredKill(rec);
  if (!hit) return look;
  const secs = Math.round(hit.gap * 10) / 10;
  const when = secs <= 1 ? 'a second' : `${secs} seconds`;
  const place = typeof rec.place === 'string' && rec.place ? ` at ${rec.place}` : '';
  const out = {
    ...look,
    cause: 'no-escape',
    was: look.cause,
    what: `You got a kill${place}, and ${hit.death.ka} killed you ${when} later, too soon to leave the spot.`,
    better: rec.side === 'defending'
      ? 'On defence, hold from a spot you can step back from after the first kill, off a wide open angle, because the next enemy can come right behind the first.'
      : 'Take the first fight from a spot you can step back from after the kill, because the next enemy can come right behind the first.',
  };
  // A look asked with variant b keeps a judgement of its fight: the spot was
  // the mistake, so the fight was a wrong spot and the play changes position.
  if (look.fight) { out.fight = 'wrong-spot'; out.change = 'position'; }
  return out;
}

/*
 * WHAT A LOOK ASKED WITH VARIANT B ALSO SAYS (8.5.0): its judgement of the
 * fight, the one thing its better play changes most, and the prompt it was
 * asked with (death-forensics.js FIGHTS, CHANGES, variantFor; held equal by
 * test:forensics). Data for Ask Coach and the bench, never the grade. A look
 * saved with no variant was asked with a.
 */
const FIGHTS = ['right', 'wrong-spot', 'wrong-time', 'not-needed', 'unclear'];
const CHANGES = ['aim', 'position', 'timing', 'decision', 'utility', 'team', 'none'];
const VARIANTS = ['a', 'b'];
/** The prompt a saved look was asked with: 'b', or 'a' for every look saved before. */
const variantOf = (look) => (look && look.variant === 'b' ? 'b' : 'a');

/*
 * THE PHRASE LISTS, the client's copy of the server's (death-forensics.js
 * PHRASES), held equal by test:forensics: what a better play says it
 * changes, in English. They set no label. Ask Coach is not given a saved
 * lost duel's label when its better play trips one but aim (movesPlayer),
 * since a better play that moves the player is no fair fight's, and the chat
 * then teaches what the look saw and its better play.
 */
const PHRASES = {
  decision: /\b(let them come|let the clock|play for time|make them come to you|no need to|do not take the fight|don't take the fight|hold the spike)\b/i,
  team: /\b(teammates?|trade|swing with|with your team|together)\b/i,
  reset: /\b(fall back|step back|back behind cover|back into cover|reset|disengage|pull back|after your first shots|after the first exchange|after the first burst|instead of staying|stop firing and)\b/i,
  utility: /\b(smoke|flash|drone|recon|utility|information first)\b/i,
  aim: /\b(crosshair|aim|head level|counter ?strafe|tap|burst|first bullet|spray)\b/i,
};
const PHRASE_ORDER = ['decision', 'team', 'reset', 'utility', 'aim'];

let KITS = null;
function kitOf(agent) {
  if (!KITS) {
    try { KITS = require('./valorant-data.generated.json').agents || {}; } catch { KITS = {}; }
  }
  const a = KITS[agent];
  return a && Array.isArray(a.abilities) ? a.abilities.map((x) => String(x).toLowerCase()) : [];
}

/** Which phrase lists a better play trips, in PHRASE_ORDER, the player's own abilities by name counted as utility. */
function phraseHits(text, agent) {
  const t = String(text || '');
  if (!t.trim()) return [];
  const kit = kitOf(agent);
  const out = [];
  for (const k of PHRASE_ORDER) {
    const kitSaid = k === 'utility' && kit.some((ab) => new RegExp(`\\b${ab.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(t));
    if (PHRASES[k].test(t) || kitSaid) out.push(k);
  }
  return out;
}

/** Whether a better play moves the player: any phrase list but aim. */
function movesPlayer(text, agent) {
  return phraseHits(text, agent).some((k) => k !== 'aim');
}

module.exports = { CAUSES, isAvoidable, causeTitle, recordCause, recordOf, answeredKill, NO_ESCAPE_SEC, FIGHTS, CHANGES, VARIANTS, variantOf, PHRASES, PHRASE_ORDER, phraseHits, movesPlayer };

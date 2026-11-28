'use strict';

/**
 * FURTHER EXPLAIN (8.13): a deeper answer about one death, written for the
 * player after the match, from the same facts and pictures the look has, or
 * from Riot's facts alone when no picture of the death is kept.
 *
 * EVERY SENTENCE PASSES THE LOOK'S OWN GATES (death-forensics.js: another map's
 * callout, another agent's ability, the wrong killer, the wrong side, an entry
 * on defence, the kit, a player's name), and a sentence that fails is dropped,
 * never rewritten. With no picture, one that speaks of seeing goes too. The
 * economy is out of scope, as it is for Ask Coach.
 *
 * UTILITY THE PLAYER'S OWN AGENT DOES NOT HAVE (9.1, the final critic): the
 * look's own gate (death-forensics.js ownUtility, fact-gates.js
 * ownUtilityFix) over each sentence that stood the rest, the one sentence a
 * gate here may reword, exactly as the look and the review do: "throw a flash
 * before you peek" to a Jett, whose kit has none, becomes "wait for a
 * teammate's flash"; one the gate cannot turn is dropped. A sentence already
 * asking a teammate, naming an owner, said to an agent who has it, in another
 * language or with no agent known is left as written.
 */

const forensics = require('./death-forensics');
const nameGate = require('./name-gate');
const { promptName } = require('./languages');

const TOKENS = 700;
const FIELD_MAX = 520;
const SENTENCES_MAX = 4;

// The model talking about its input, wrong in any answer.
const INPUT_WORDS = /\b(?:screenshots?|frames?|stills?|images?|pictures?|footage)\b/i;
// Claims of sight, which an answer from facts alone cannot make.
const SIGHT_WORDS = /\b(?:you can see|we can see|is visible|was visible|the clip|the video|on screen|looks like|appears? to)\b/i;
const ECONOMY_WORDS = /\b(?:credits?|eco rounds?|force[- ]?buy|full[- ]?buy|half[- ]?buy|bonus round|loss bonus|save round|saving your)\b/i;

const gateLanguage = (input) => (promptName(input && input.language) === 'English' ? 'en' : input.language);

/** The request, checked: one death, its pictures optional. */
function normalise(body, opts) {
  const b = body || {};
  const look = b.look && typeof b.look === 'object' ? b.look : null;
  const input = forensics.normalise({ ...b, deaths: [b.death] },
    { variant: 'a', maxDeaths: 1, allowNoFrames: true, ...(opts || {}) });
  const clip = (v, n) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
  return { ...input, death: input.deaths[0] || null,
    look: look ? { cause: clip(look.cause, 32) || null, what: clip(look.what, 260) || null, better: clip(look.better, 260) || null } : null,
    why: clip(b.why, 400) || null,
    flagged: b.flagged === true };
}

function factLines(input, d) {
  const out = [`Round ${d.n}, ${d.side === 'attacking' ? 'on attack' : d.side === 'defending' ? 'on defence' : 'side unknown'}.`];
  if (input.agent) out.push(`The player is on ${input.agent}.`);
  if (input.map) out.push(`The map is ${input.map}.`);
  if (typeof d.sec === 'number') out.push(`They died ${d.sec} seconds after the barriers dropped.`);
  if (d.killer) out.push(`Killed by ${d.killer}${d.weapon ? ` with ${d.weapon}` : ''}.`);
  if (d.firstDeath) out.push('It was the first death of the round, on either team.');
  if (d.alive) out.push(`Standing at that moment: ${d.alive.mates} of their team, player included, against ${d.alive.enemies}.`);
  if (d.traded === true) out.push('A teammate killed the killer within five seconds.');
  if (d.traded === false) out.push('Nobody killed the killer within five seconds.');
  if (d.planted) out.push(d.afterPlant ? 'The spike was already planted.' : 'The spike was planted this round.');
  if (d.spot) out.push(`The screen placed the death at ${d.spot}.`);
  out.push(...forensics.recordLines(d));
  return out;
}

function buildPrompt(input) {
  const d = input.death;
  const seen = d.frames.length > 0;
  const lines = [
    'You are a Valorant coach going through one death with a player after the match. Be direct, specific and kind, in plain words a player at any rank understands.',
    '',
    'WHAT IS KNOWN',
    ...factLines(input, d).map((l) => `- ${l}`),
  ];
  if (input.look && (input.look.what || input.look.better)) {
    lines.push('', 'THE FIRST LOOK AT THIS DEATH');
    if (input.look.what) lines.push(`- ${input.look.what}`);
    if (input.look.better) lines.push(`- Better: ${input.look.better}`);
  }
  if (input.why) lines.push('', `THE REVIEW SAID: ${input.why}`);
  if (input.flagged) lines.push('', 'The player flagged this death during the match because they want to understand it.');
  const kit = forensics.kitBlockFor(input, d);
  if (kit) lines.push('', kit.trim());
  lines.push('',
    seen ? 'The attached pictures show the moments around the death, in time order. Use what they show, and do not guess at what they do not.'
      : 'No picture of this death is kept. Work only from the facts above, say nothing about what could be seen, and do not invent positions or utility.',
    '',
    'Go deeper than the first look: add what it did not say, never repeat it.',
    'Rules: never name a player. Never mention pictures, frames or screenshots. Never discuss buys, credits or the economy. Never tell the player where the enemy will go next. Use commas, no dashes.',
    `Write in ${promptName(input.language)}.`,
    '',
    'Reply with JSON only: {"happened":"one or two sentences on how the fight actually went","why":"one or two sentences on the real reason it was lost","instead":"one or two sentences on the one thing to do differently next time"}');
  return lines.join('\n');
}

function sentences(text) {
  return String(text || '').replace(/[\u2013\u2014]/g, ',').replace(/\s+-\s+/g, ', ').replace(/\s+/g, ' ').trim()
    .match(/[^.!?]+[.!?]*/g) || [];
}

/** Why a sentence may not stand, or null. */
function refusal(s, input, d) {
  if (INPUT_WORDS.test(s) || ECONOMY_WORDS.test(s)) return 'scope';
  if (!d.frames.length && SIGHT_WORDS.test(s)) return 'sight';
  const bad = forensics.wrongMap(s, input.map) || forensics.foreignAbility(s, input.agent)
    || forensics.wrongKiller(s, d.killer, input.source, input) || forensics.wrongSide(s, d, input);
  if (bad) return 'fact';
  if (gateLanguage(input) === 'en' && forensics.entryOnDefence(s, d.side, d.afterPlant)) return 'side';
  if (forensics.kitWrong(s, input, d)) return 'kit';
  try {
    if (nameGate.namesSomeone(s, { names: input.names || null, language: gateLanguage(input) })) return 'name';
  } catch { return 'name'; }
  return null;
}

/** The model's reply, gated: { explain, dropped }, explain null when nothing stands. */
function parse(raw, input) {
  const j = forensics.replyJson(raw);
  const dropped = [];
  if (!j) return { explain: null, dropped };
  const d = input.death;
  const out = {};
  for (const field of ['happened', 'why', 'instead']) {
    const kept = [];
    for (const one of sentences(j[field]).slice(0, SENTENCES_MAX)) {
      let s = one.trim();
      if (!s) continue;
      if (!/[.!?]$/.test(s)) s += '.';
      const why = refusal(s, input, d);
      if (why) { dropped.push({ field, why }); continue; }
      // The player's own kit (forensics.ownUtility): asked of a teammate, or dropped.
      const own = forensics.ownUtility(s, input);
      if (own && own.drop) { dropped.push({ field, why: 'own-utility' }); continue; }
      kept.push(own && own.rewrite ? own.rewrite : s);
    }
    out[field] = kept.join(' ').slice(0, FIELD_MAX) || null;
  }
  return { explain: out.happened || out.why || out.instead ? out : null, dropped };
}

module.exports = { TOKENS, normalise, buildPrompt, parse, refusal };

'use strict';

/**
 * The view only fields a served Valorant review carries (B2): each round's
 * facts as tags (factTags), the rounds that open by themselves (c.open), and
 * the summary as lines (summaryLines). None is on disk, a review saved by any
 * version gets them, and served() changes nothing else.
 *
 * The facts are roundFacts' own, from the real Abyss match (replayed, then laid
 * under Riot's record) and from rounds made to reach every sentence it writes,
 * so a template added there without a tag here fails the "no plain fact" check.
 *
 * Run: node scripts/test-fact-tags.js
 */

const { replay, load } = require('./fixtures/replay-match');
const review = require('../src/shared/valorant-review');
const verify = require('../src/shared/valorant-verify');

let fails = 0;
let checks = 0;
const ok = (cond, what) => {
  checks++;
  if (!cond) { fails++; console.log(`FAIL  ${what}`); } else console.log(`ok    ${what}`);
};

const { factTags, summaryLines, withoutView, roundFacts } = review;
const KINDS = ['death', 'firstdeath', 'odds', 'traded', 'untraded', 'ult', 'kill', 'firstkill', 'tradedmate', 'clutch',
  'plant', 'survived', 'unwatched'];
const TONES = ['good', 'bad', 'warn', 'even'];

// ── Every sentence roundFacts writes ────────────────────────────────────────
const played = replay(load('valorant-match-abyss-13-11.json').frames, 'standard');
const verified = verify.reconcile(played.rounds, load('riot-abyss-13-11.json')).rounds;
// Each branch of roundFacts, verified and from the screen alone.
const V = { verified: true };
const made = [
  { ...V, died: true, deathSpot: 'A Main', deathSec: 31, killerAgent: 'Astra', weapon: 'Sheriff', firstDeath: true,
    aliveAtDeath: { mates: 4, enemies: 2 }, traded: true, ultAtDeath: 'ready', planted: true, plantSpot: 'A Site' },
  { ...V, died: true, deathSec: 12, killerAgent: 'Jett', aliveAtDeath: { mates: 1, enemies: 3 }, traded: false, planted: true },
  { ...V, died: true, killerAgent: 'Omen', weapon: 'Outlaw', aliveAtDeath: { mates: 2, enemies: 2 } },
  { ...V, died: true },
  { ...V, died: true, deathSpot: 'B Tree' },
  { ...V, died: false, kills: 1, firstKill: true, trades: 1, clutch: { vs: 2, won: true }, watched: false },
  { ...V, died: false, kills: 3, trades: 2, clutch: { vs: 1, won: false } },
  { ...V, died: false, kills: 0, clutch: { vs: 3 } },
  { died: true, deathSpot: 'A Main', deathClock: 90, ultAtDeath: 'ready' },
  { died: true, deathClock: 50 },
  { died: true, deathSpot: 'Mid Courtyard', deathClock: 10 },
  { died: true, deathClock: 20, planted: true, plantSpot: 'B Site' },
  { died: true },
  { died: false, planted: true },
];
const facts = [...verified, ...played.rounds, ...made].flatMap((r) => roundFacts(r, {}));
const tags = factTags(facts);
const plain = tags.filter((t) => t.kind === 'fact').map((t) => t.text);
ok(facts.length > 60 && !plain.length, `every one of ${facts.length} facts is a tag of its own kind (plain: ${plain.join(' | ')})`);
const seen = new Set(tags.map((t) => t.kind));
ok(KINDS.every((k) => seen.has(k)), `and every kind is reached (missing: ${KINDS.filter((k) => !seen.has(k)).join(', ')})`);
ok(tags.every((t, i) => TONES.includes(t.tone) && t.text === facts[i]), 'each tag has a tone and its fact as its text, in order');
// The Riot only card leaves "Not watched" off, and that is roundFacts' own.
ok(!factTags(roundFacts({ ...V, died: false, watched: false }, { riotOnly: true })).some((t) => t.kind === 'unwatched'),
  'from Riot\'s record alone no card says it was not watched');

// ── Each template, by name ──────────────────────────────────────────────────
const one = (text) => factTags([text])[0];
const is = (text, kind, tone) => {
  const t = one(text);
  ok(t.kind === kind && t.tone === tone && t.text === text, `"${text}" is ${kind}, ${tone} (${t.kind}, ${t.tone})`);
};
is('Died at A Main, 31s in, to Astra with a Sheriff', 'death', 'bad');
is('Died at B Tree, 3s in, to Chamber', 'death', 'bad');
is('Died 12s in, to Jett', 'death', 'bad');
is('Died, to Omen with an Outlaw', 'death', 'bad');
is('Died', 'death', 'bad');
is('Died at A Main, late in the round', 'death', 'bad');
is('Died mid round', 'death', 'bad');
is('First death of the round', 'firstdeath', 'bad');
is('4 against 2 when you died', 'odds', 'warn');
is('2 against 2 when you died', 'odds', 'even');
is('1 against 3 when you died', 'odds', 'even');
is('Traded by a teammate', 'traded', 'even');
is('Not traded', 'untraded', 'warn');
is('Ultimate was ready', 'ult', 'warn');
is('Survived', 'survived', 'good');
is('1 kill', 'kill', 'good');
is('3 kills', 'kill', 'good');
is('First kill of the round', 'firstkill', 'good');
is('Traded a teammate', 'tradedmate', 'good');
is('Traded teammates 2 times', 'tradedmate', 'good');
is('Last one standing against 2, and won it', 'clutch', 'good');
is('Last one standing against 1, lost', 'clutch', 'even');
is('Last one standing against 3', 'clutch', 'even');
is('Spike planted', 'plant', 'even');
is('Spike planted at A Site', 'plant', 'even');
is('Not watched by the coach', 'unwatched', 'even');

// ── Known non matches: a plain fact, never a guess ──────────────────────────
for (const text of ['Diedre was there', 'Died.', 'died at A Main', 'First death', 'Traded', 'Not traded by anyone',
  '4 against 2', 'kills', '2 kills in a row', 'Traded teammates twice', 'Last one standing', 'Last one standing against 2, won',
  'Spike planted twice', 'Spike plantedat A', 'Survived the round', 'Ultimate was ready twice', 'Not watched']) {
  const t = one(text);
  ok(t.kind === 'fact' && t.tone === 'even' && t.text === text, `"${text}" is a plain fact (${t.kind})`);
}
ok(JSON.stringify(factTags(['', null, 4, 'Survived'])) === '[{"kind":"survived","tone":"good","text":"Survived"}]'
  && factTags(undefined).length === 0 && factTags('Survived').length === 0, 'what is no fact string is left out, and no facts is no tags');

// ── The summary as lines ────────────────────────────────────────────────────
const lines = (s, want) => {
  const got = summaryLines(s);
  ok(JSON.stringify(got) === JSON.stringify(want), `${JSON.stringify(s)} reads as ${got.length} lines (${got.join(' | ')})`);
};
lines('You died first in 6 rounds. Trade more. Your aim was strong!', ['You died first in 6 rounds.', 'Trade more.', 'Your aim was strong!']);
lines('Your K/D was 1.45 this match. Good work.', ['Your K/D was 1.45 this match.', 'Good work.']);
lines('Your duels vs. Jett went badly. Hold off angles.', ['Your duels vs. Jett went badly.', 'Hold off angles.']);
lines('Use utility first, e.g. Flash before you peek. Then trade.', ['Use utility first, e.g. Flash before you peek.', 'Then trade.']);
lines('You lost round 5. 3 of your deaths were early.', ['You lost round 5.', '3 of your deaths were early.']);
lines('The coach said "hold". Then you pushed.', ['The coach said "hold".', 'Then you pushed.']);
lines('one sentence with no stop', ['one sentence with no stop']);
lines('Ends lower. then goes on', ['Ends lower. then goes on']);
lines('  Spaced out.   Second one.  ', ['Spaced out.', 'Second one.']);
lines('', []);
lines(null, []);
lines(undefined, []);

// ── served(): the added fields, and nothing else changed ────────────────────
const AI = { summary: 'You died first too often. Trade your duelist. Your aim vs. Jett held.', focus: 'Enter second.',
  rounds: { 3: 'You peeked alone.' } };
const built = review.build({ rounds: verified, context: { ...played.context, agent: 'Jett' }, endedBy: 'score', ai: AI,
  role: 'Duelist', history: [] });
const before = JSON.stringify(built);
const shown = review.served(built);
ok(JSON.stringify(built) === before, 'the review handed in is not changed');
ok(JSON.stringify(withoutView(shown)) === before, 'one built today is shown as built, but for the view fields');
ok(shown.rounds.every((c, i) => JSON.stringify(c.tags) === JSON.stringify(factTags(built.rounds[i].facts)) && typeof c.open === 'boolean'),
  'every card has its facts as tags, and an open flag');
ok(JSON.stringify(shown.summaryLines) === JSON.stringify(['You died first too often.', 'Trade your duelist.', 'Your aim vs. Jett held.']),
  `the summary as lines (${shown.summaryLines.join(' | ')})`);
const top = built.insights.mistakes[0];
const openNs = shown.rounds.filter((c) => c.open).map((c) => c.n);
const wantOpen = built.rounds.filter((c) => c.forensics || c.why || (top && top.rounds.includes(c.n))).map((c) => c.n);
ok(top && top.rounds.length > 0 && JSON.stringify(openNs) === JSON.stringify(wantOpen) && openNs.includes(3)
  && top.rounds.every((n) => openNs.includes(n)) && openNs.length < shown.rounds.length,
  `open: the top mistake's rounds (${top && top.key}: ${top && top.rounds.join(', ')}) and the round with a why (${openNs.join(', ')})`);
const looked = JSON.parse(before);
const quiet = looked.rounds.find((c) => !c.why && !(top.rounds.includes(c.n)));
quiet.forensics = { cause: 'dry-peek', what: 'x', better: 'y' };
ok(review.served(looked).rounds.find((c) => c.n === quiet.n).open, `a round the coach looked at opens (round ${quiet.n})`);

// From Riot's record alone: tags, no mistake rounds opened.
const riotOnly = review.build({ rounds: verified, context: played.context, endedBy: 'score', ai: {}, source: 'riot', history: [] });
const riotBefore = JSON.stringify(riotOnly);
const riotShown = review.served(riotOnly);
ok(JSON.stringify(withoutView(riotShown)) === riotBefore && JSON.stringify(riotOnly) === riotBefore,
  "one from Riot's record alone is shown as built, but for the view fields");
ok(riotShown.rounds.every((c) => c.tags.length === c.facts.length && !c.open) && riotShown.summaryLines.length === 0,
  "its cards are tagged, none opens with no mistake counted, and no summary is no lines");

// A review the library saved in 8.0.1: no ledger fields, read back as tags.
const old = load('valorant-review-split-801.json');
const oldBefore = JSON.stringify(old);
const oldShown = review.served(old.review || old);
ok(JSON.stringify(old) === oldBefore, 'an 8.0.1 review on disk is left as it was saved');
ok(Array.isArray(oldShown.rounds) && oldShown.rounds.length > 0
  && oldShown.rounds.every((c) => Array.isArray(c.tags) && c.tags.length === (c.facts || []).length && typeof c.open === 'boolean')
  && oldShown.rounds.flatMap((c) => c.tags).every((t) => t.kind !== 'fact'),
  `an 8.0.1 review is shown with tags of its kinds (${oldShown.rounds.flatMap((c) => c.tags).map((t) => t.kind).join(',')})`);
ok(Array.isArray(oldShown.summaryLines) && oldShown.summaryLines.join(' ').replace(/\s+/g, ' ') === String((old.review || old).summary || '').trim().replace(/\s+/g, ' '),
  `and its summary as ${oldShown.summaryLines.length} lines, every word kept`);

const league = { kind: 'lol', rounds: [] };
ok(review.served(league) === league && review.served(null) === null, "another game's review is not touched");

console.log(`\n${checks - fails}/${checks} checks passed`);
if (fails) process.exit(1);

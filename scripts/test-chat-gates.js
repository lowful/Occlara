'use strict';

/**
 * Ask Coach v2's reply gates and prompt, offline (8.5.0).
 *
 *   server/services/fact-gates.js   every sentence of a reply checked, one gate at a time
 *   server/services/chat-prompt.js  normalise, buildPrompt, parseReply, retryPrompt
 *
 * On the repo's real Abyss 13 to 11, built as test:valorantreview builds it
 * and filled from Riot's record as the app's one time fill fills it, with the
 * primer's numbers as a stand-in for the Sheriff (so the gates' own rules are
 * pinned whatever the primer prints) and as game-primer.js renders them when
 * it loads. Every gate keeps one sentence and drops one, in English and in a
 * Spanish sample, and the named cases of spec 8.12 each have their line. Each
 * regex the gates read is asserted on a known positive and a known negative.
 *
 * Run: npm run test:chatgates
 */

const fs = require('fs');
const path = require('path');
const gates = require('../server/services/fact-gates');
const cp = require('../server/services/chat-prompt');
const chatContext = require('../src/shared/chat-context');
const { replay, load } = require('./fixtures/replay-match');
const verify = require('../src/shared/valorant-verify');
const review = require('../src/shared/valorant-review');
const riotReview = require('../src/shared/riot-review');

let fails = 0;
const ok = (cond, what, detail) => {
  if (!cond) { fails++; console.log(`FAIL  ${what}${detail ? `\n        ${detail}` : ''}`); }
  else console.log(`ok    ${what}`);
};
const DASHES = new RegExp('[' + String.fromCharCode(0x2013, 0x2014) + ']');

// ── The match ──────────────────────────────────────────────────────────────

// A match played an hour ago, so the primer withholds nothing a patch since
// could have touched (game-primer.js matchGate).
const AT = Date.now() - 60 * 60 * 1000;
function abyssReview() {
  const abyss = replay(load('valorant-match-abyss-13-11.json').frames, 'standard');
  const riot = load('riot-abyss-13-11.json');
  const { rounds, checks } = verify.reconcile(abyss.rounds, riot);
  const tracker = { matchId: 'abyss-test-match-0001', result: 'Victory', score: '13-11', agent: 'Jett', map: 'Abyss',
    kills: 31, deaths: 21, assists: 4, acs: 382, adr: 210, headshotPct: 24, kd: 1.48, mode: 'competitive' };
  const rv = review.build({ rounds, context: { ...abyss.context, agent: 'Jett' }, endedBy: 'score',
    verification: verify.describe(checks), tracker, queue: 'competitive' });
  // Riot's record with 8.5.0's feed: round 3's kills by agent and gun, as the
  // server now sends them, so the weapon and killer gates have them to read.
  const per = riot.perRound.map((r) => (r.n !== 3 ? r : { ...r, feed: r.feed.map((k, i) => ({ ...k,
    ...(i === 0 ? { ka: 'Skye', va: 'Sova', w: 'Vandal' } : {}),
    ...(i === 1 ? { ka: 'Jett', va: 'Raze', w: 'Vandal' } : {}),
    ...(i === 2 ? { ka: 'Jett', va: 'Omen', w: 'Vandal' } : {}),
    ...(i === 3 ? { ka: 'Cypher', va: 'Jett', w: 'Spectre' } : {}) })) }));
  let filled = chatContext.applyRoundRecord({ ...rv, id: 'valorant-1790000000000-abcdef', at: AT, matchId: tracker.matchId },
    { ...riot, perRound: per, comps: { us: [{ agent: 'Jett', role: 'Duelist' }, { agent: 'Sova', role: 'Initiator' }],
      them: [{ agent: 'Cypher', role: 'Sentinel' }, { agent: 'Skye', role: 'Initiator' }] } }, AT + 1000);
  // Three looks: round 2 a dry peek that saw damage, round 4 a fair duel lost
  // on the shot, round 6 a lost-duel whose better play moves the player.
  filled = { ...filled, rounds: filled.rounds.map((c) => {
    if (c.n === 2) return { ...c, forensics: { cause: 'dry-peek', what: 'You swung A Site with no utility and dealt 0 damage before dying.', better: 'Throw your Cloudburst before you swing.', source: 'riot' } };
    if (c.n === 4) return { ...c, forensics: { cause: 'lost-duel', what: 'You held the angle from cover and lost the first shot.', better: 'Keep your crosshair at head level and tap.', source: 'riot' } };
    if (c.n === 6) return { ...c, forensics: { cause: 'lost-duel', what: 'You traded shots on A Site.', better: 'Fall back after your first shots instead of staying on the angle.', source: 'riot' } };
    return c;
  }) };
  return filled;
}
const ABYSS = abyssReview();

function inputFor(rv, question, opts) {
  const o = opts || {};
  const ctx = chatContext.build(rv, { rows: o.rows || [], patterns: o.patterns || {}, breakdown: o.breakdown || {} },
    o.tracker || null, question, { game: o.game || 'valorant', language: o.language || 'en', now: Date.now() });
  return cp.normalise(ctx);
}

// The primer's numbers for the Sheriff, the round and the spike as its
// provenance gives them: a stand-in, so the gates' rules are tested on their
// own whatever game-primer.js prints today.
const band0 = { from: 0, to: 30 };
const band1 = { from: 30, to: 50 };
const sheriff = (attribute, value, extra) => ({ subject: 'Sheriff', subjectKind: 'gun', attribute, value, shown: value, ...extra });
const hits = (part, armor, value, band) => sheriff('hits', value, { part, armor, band });
const STAND_IN = [
  sheriff('head', 159.5, { part: 'head', band: band0, shown: 159 }), sheriff('head', 145, { part: 'head', band: band1 }),
  sheriff('body', 55, { part: 'body', band: band0 }), sheriff('body', 50, { part: 'body', band: band1 }),
  sheriff('metres', 30, { band: band0 }),
  hits('head', 'none', 1, band0), hits('head', 'Light Armor', 1, band0), hits('head', 'Heavy Armor', 1, band0),
  hits('body', 'none', 2, band0), hits('body', 'Light Armor', 3, band0), hits('body', 'Heavy Armor', 3, band0),
  hits('head', 'none', 1, band1), hits('head', 'Light Armor', 1, band1), hits('head', 'Heavy Armor', 2, band1),
  sheriff('price', 800),
  { subject: 'round', subjectKind: 'rule', attribute: 'seconds', value: 100, shown: 100, words: ['round lasts', 'round timer'] },
  { subject: 'spike timer', subjectKind: 'rule', attribute: 'seconds', value: 45, shown: 45, words: ['spike', 'detonat'] },
];

/** The facts of a question, the primer stood in. */
function factsFor(input, messages, primer) {
  const f = cp.factsOf(input, messages);
  if (primer) f.primer = primer;
  return f;
}

const verdict = (s, facts, opts) => gates.check(s, facts, opts || {});
const keeps = (s, facts, opts) => !verdict(s, facts, opts).drop;
const drops = (s, facts, gate, opts) => {
  const v = verdict(s, facts, opts);
  return !!v.drop && (!gate || v.drop.gate === gate);
};
const why = (s, facts, opts) => JSON.stringify(verdict(s, facts, opts).drop);

// ── The regexes, each on a known positive and a known negative ─────────────
{
  console.log('\nthe regexes the gates read:');
  const cases = [
    ['RIOT_ID', gates.RIOT_ID, 'killed by Morvane#EUW', 'a 4v3 in round 5'],
    ['META', gates.META, 'the strongest pick in the current meta', 'your own win rate on Jett'],
    ['HYPOTHETICAL', gates.HYPOTHETICAL, 'If you had stayed in cover', 'You stayed in cover'],
    ['IMPERATIVE', gates.IMPERATIVE, 'Take your shot from cover.', 'You took your shot from cover.'],
    ['INSTRUCTION_WORDS', gates.INSTRUCTION_WORDS, 'Next time, hold the angle.', 'You held the angle.'],
    ['STANDING', gates.STANDING, 'up 4 against 3', 'up four players'],
    ['CLOCK', gates.CLOCK, 'you died at 0:08', 'you died 8 s in'],
    ['ECONOMY', gates.ECONOMY, 'you had 3900 credits', 'you had the spike'],
    ['SPELLED', gates.SPELLED, 'two body shots', 'one burst and a step back'],
    ['LABELLING', gates.LABELLING, 'the coach calls it a dry peek', 'the coach saw you peek'],
    ['KILLED_YOU', gates.KILLED_YOU, 'their Cypher killed you', 'you killed their Cypher'],
    ['YOU_DIED_TO', gates.YOU_DIED_TO, 'you died to their Viper', 'you died alone'],
    ['YOU_KILLED', gates.YOU_KILLED, 'you killed their Raze', 'their Raze killed you'],
    ['PAST_ABOUT_YOU', gates.PAST_ABOUT_YOU, 'you peeked the angle', 'peek the angle'],
    ['NOT_TRADED', gates.NOT_TRADED, 'nobody traded you', 'a teammate traded you'],
    ['WAS_TRADED', gates.WAS_TRADED, 'you were traded', 'you traded a teammate'],
    ['TRADE_AS_HARM', gates.TRADE_AS_HARM, 'hesitating gets you traded', 'a teammate traded your killer'],
    ['TRADED_YOU', gates.TRADED_YOU, 'a teammate traded you', 'you traded a teammate'],
  ];
  gates.ATTRIBUTION.forEach((re, i) => cases.push([`ATTRIBUTION[${i}]`, re,
    ['According to the pros, trade.', 'As Brimo says, trade.', "Brimo's video shows it.", 'pro player Brimo plays it', "watch Brimo's stream", 'pros like Brimo do it'][i],
    'Review your own VOD after the match.']));
  for (const k of Object.keys(gates.PHRASES)) {
    const pos = { decision: 'let them come to you', team: 'swing with a teammate', reset: 'fall back after your first shots', utility: 'smoke the angle first', aim: 'keep your crosshair at head level' }[k];
    cases.push([`PHRASES.${k}`, gates.PHRASES[k], pos, 'hold the angle from cover']);
  }
  const units = [['%', '66% of each hit'], ['rate', '13.33 shots a second'], ['magazine', '25 rounds in the magazine'], ['seconds', '45 seconds'],
    ['metres', '30 m'], ['credits', '800 credits'], ['damage', '159 damage'], ['damage', '159 to the head'], ['hits', '2 body hits'],
    ['hits', '1 hit'], ['health', '57 health'], ['armor', '50 armour'], ['points', '7 ult points'], ['pellets', '15 pellets'], ['degrees', '0.25 degrees'],
    ['kills', '31 kills'], ['deaths', '21 deaths'], ['assists', '4 assists'], ['rounds', '24 rounds'], ['matches', '3 matches'],
    ['times', '7 times'], ['players', '2 teammates'], ['practice', '10 minutes'], ['acs', '382 ACS'], ['kd', '1.48 K/D'], ['adr', '210 ADR'],
    ['cs', '182 CS'], ['vision', '24 vision score']];
  gates.AFTER_UNITS.forEach(([re], i) => {
    const pos = units.find(([u, s]) => re.test(s.replace(/^[\d.]+/, '')));
    cases.push([`AFTER_UNITS[${i}]`, re, pos ? pos[1].replace(/^[\d.]+/, '') : '(none)', ' and then']);
  });
  const befores = ['K/D of ', 'ACS of ', 'ADR of ', 'grade of ', 'costs ', 'head hits do ', 'deals ', 'for ', 'win rate of ', 'headshot rate of '];
  gates.BEFORE_UNITS.forEach(([re], i) => cases.push([`BEFORE_UNITS[${i}]`, re, befores[i], 'and then ']));
  gates.ARMOR_NAMED.forEach(([re], i) => cases.push([`ARMOR_NAMED[${i}]`, re, ['an unarmoured player', 'through Light Armor', 'through Heavy Armor', 'a Regen Shield'][i], 'a player']));
  cases.push(['chat-prompt DASHES', new RegExp('[\\u2013\\u2014]'), `one${String.fromCharCode(0x2014)}two`, 'one-two']);
  for (const [name, re, pos, neg] of cases) {
    const r = new RegExp(re.source, re.flags.replace('g', ''));
    ok(r.test(pos) && !r.test(neg), `${name} matches "${pos}" and not "${neg}"`);
  }
}

// ── The cause titles and the review's trade words, mirrored ────────────────
{
  console.log('\nthe mirrors:');
  const { CAUSES } = require('../src/shared/death-causes');
  const want = new Set();
  for (const c of Object.values(CAUSES)) { want.add(c.title); want.add(c.one); }
  const reviewSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'review', 'review.js'), 'utf8');
  const chips = /const CAUSE_TITLE = \{([\s\S]*?)\};/.exec(reviewSrc);
  for (const m of (chips ? chips[1] : '').matchAll(/'([^']+)'(?=\s*[,\n}])/g)) if (!/^[a-z-]+$/.test(m[1])) want.add(m[1]);
  const have = new Set(Object.values(gates.CAUSE_TITLES).flat());
  ok(chips && [...want].every((x) => have.has(x)), 'every cause title and chip the client draws is a label the label gate reads',
    [...want].filter((x) => !have.has(x)).join(', '));
  ok(Object.keys(gates.CAUSE_TITLES).sort().join() === Object.keys(CAUSES).sort().join(), 'and the gate knows exactly the client\'s causes');
  const mr = fs.readFileSync(path.join(__dirname, '..', 'server', 'services', 'match-review.js'), 'utf8');
  for (const name of ['NOT_TRADED', 'WAS_TRADED', 'TRADE_AS_HARM']) {
    const m = new RegExp(`const ${name} = (/.+/[a-z]*);`).exec(mr);
    ok(m && m[1] === String(gates[name]), `${name} is match-review.js's own, word for word`);
  }
}

// ── Every gate keeps one and drops one, on the Abyss match ─────────────────
const Q3 = 'Why did I die in round 3?';
const M3 = [{ role: 'user', content: Q3 }];
const IN3 = inputFor(ABYSS, Q3);
const F3 = factsFor(IN3, M3, STAND_IN);
{
  console.log('\nevery gate, in English:');
  ok(IN3.ask.round === 3 && F3.asked === 3 && F3.oneRound, 'the question names round 3, and the facts know it');
  // Names, enforced.
  ok(drops('Your teammate Morvane#EUW left you alone.', F3, 'name'), 'a Riot ID drops', why('Your teammate Morvane#EUW left you alone.', F3));
  ok(drops('Your teammate xX_sniper_Xx left you alone.', F3, 'name'), 'a handle with an underscore drops');
  ok(drops('Your teammate Tenzor99 left you alone.', F3, 'name'), 'a handle of letters and digits drops');
  ok(keeps('It was a 4v3 in round 3, and you had the first two kills.', F3), 'a 4v3 and an R5 are no handles', why('It was a 4v3 in round 3, and you had the first two kills.', F3));
  const set = { has: (t) => /\bkestrel\b/i.test(t) };
  ok(drops('Kestrel was ahead of you on A.', F3, 'name', { nameSet: set }), 'a word of the match\'s own names drops, in any case');
  ok(keeps('Your teammate was ahead of you on A.', F3, { nameSet: set }), 'and a sentence with none of them stays');
  // Names, log mode: counted, never dropped.
  const log = verdict('Your teammate Brimo was ahead of you.', F3);
  ok(!log.drop && log.logged.includes('name-log'), 'THE NAME RULE IN LOG MODE DROPS NOTHING: an unknown capitalised word is counted, kept', JSON.stringify(log));
  // Attribution.
  ok(keeps('Review your own VOD after the match.', F3) && keeps('Record your games and watch your VODs.', F3), '"review your own VOD", "your VODs" and "record your games" stay');
  ok(drops('According to the pros, you should trade.', F3, 'attribution') && drops("Brimo's video shows the angle.", F3, 'attribution'),
    '"according to" and "(a name)\'s video" drop');
  // Meta.
  ok(drops('Jett is the strongest pick in the current meta.', F3, 'meta'), 'a meta ranking drops');
  ok(drops('Jett is the best agent on Abyss right now.', F3, 'meta') && drops('Omen and Viper are the strongest controllers.', F3, 'meta')
    && keeps('Jett is your best agent by grade.', F3) && keeps('Defence was your stronger side.', F3),
  '"X IS THE BEST AGENT ON A MAP" DROPS, "your best agent by grade" stays', why('Jett is your best agent by grade.', F3));
  // Round and result, with negation.
  ok(keeps("You didn't lose round 5, you won it.", F3), '"YOU DIDN\'T LOSE ROUND 5" ON A WON ROUND STAYS', why("You didn't lose round 5, you won it.", F3));
  ok(drops('You lost round 5.', F3, 'result'), 'and "you lost round 5" drops');
  ok(drops('They won round 5.', F3, 'result') && keeps("They didn't win round 5.", F3), 'what the other team did is the player\'s opposite');
  ok(drops('Round 30 was the turning point.', F3, 'round'), 'a round the match does not have drops');
  ok(keeps('You lost the duel in round 5, and your team won the round.', F3), 'a duel lost is no round lost');
  ok(drops('You survived round 3.', F3, 'result'), 'surviving a round the player died in drops');
  // Label.
  ok(keeps('The coach calls round 2 a dry peek.', F3) && drops('Round 2 was a Repeek.', F3, 'label'), 'a label said of a round is its look\'s, and no other');
  ok(drops('Round 3 was a Repeek.', F3, 'label'), 'a round with no look carries no label');
  ok(keeps('In round 5 set up a crossfire with your Sova.', F3), '"IN ROUND 5 SET UP A CROSSFIRE WITH YOUR SOVA" STAYS', why('In round 5 set up a crossfire with your Sova.', F3));
  ok(keeps('Round 4 was a fair fight you lost on the shot.', F3), '"fair fight" stays where the look is lost-duel and its better play is the duel', why('Round 4 was a fair fight you lost on the shot.', F3));
  ok(drops('Round 6 was a fair fight.', F3, 'label'), 'and drops where the better play moves the player (sent without its label)');
  ok(IN3.match.cards.find((c) => c.n === 6).look.cause === null && IN3.match.cards.find((c) => c.n === 4).look.cause === 'lost-duel',
    'a lost-duel whose better line trips the phrase list arrives without its label, one that does not keeps it');
  ok(drops('Round 6 was a lost duel, as the coach calls it.', F3, 'label'), 'and no label may be given it back');
  // Killer.
  ok(keeps('In round 3 their Cypher killed you with a Spectre.', F3), 'the round\'s Riot killer stays', why('In round 3 their Cypher killed you with a Spectre.', F3));
  ok(drops('In round 3 their Viper killed you.', F3, 'killer'), 'any other drops');
  ok(keeps('In round 3 you killed their Raze and their Omen before you died.', F3) && drops('In round 3 you killed their Viper.', F3, 'killer'),
    'who the player killed is the feed\'s');
  // Ability and map.
  ok(keeps('Press Q to Updraft out of the fight.', F3), '"PRESS Q TO UPDRAFT" STAYS FOR A JETT', why('Press Q to Updraft out of the fight.', F3));
  ok(drops('Use your Recon Bolt before you swing.', F3, 'ability'), 'another agent\'s ability as the player\'s drops');
  ok(keeps("In round 3 Sova's Recon Bolt found you first.", F3), 'and stays with its owner named');
  ok(drops('In round 3 you held Hookah.', F3, 'map') && keeps('In round 3 you held the Library.', F3), 'a round sentence names this map\'s callouts only');
  // Standing and timeline.
  ok(keeps('In round 3 you died with your team up 4 against 3.', F3) && drops('In round 3 you died 5 against 2.', F3, 'timeline'),
    'the numbers standing are the round\'s');
  ok(drops('In round 3 you were on attack.', F3, 'timeline') && keeps('In round 3 you were on defence.', F3), 'the side is the round\'s');
  ok(drops('In round 3 you were the first death.', F3, 'timeline') && keeps('In round 2 you were the first death.', F3), 'so is the first death');
  ok(drops('In round 3 you were traded right away.', F3, 'timeline') && drops('In round 3 a teammate traded you right away.', F3, 'timeline')
    && drops('In round 5 nobody traded you.', F3, 'timeline'), 'and the trade, either way');
  ok(drops('Your death was traded by a teammate.', F3, 'timeline') && keeps('Your death was not traded.', F3)
    && keeps('Your death matters less than the plant.', F3),
  '"YOUR DEATH WAS TRADED" IS A SENTENCE ABOUT THE ASKED ROUND, and Riot has round 3 untraded', why('Your death was not traded.', F3));
  ok(drops('In round 3 you were in a clutch.', F3, 'timeline'), 'a clutch the round never had drops');
  ok(keeps('If you had waited for your team, you would have been in a clutch.', F3), '"IF YOU HAD ..." IS EXEMPT FROM THE TIMELINE GATE');
  // Weapon.
  ok(keeps('In round 3 your Vandal got two kills.', F3), 'the player\'s gun stays where the feed has their kill with it', why('In round 3 your Vandal got two kills.', F3));
  ok(drops('In round 3 your Phantom got two kills.', F3, 'weapon'), 'and drops where it does not');
  ok(drops('In round 3 their Operator caught you.', F3, 'weapon'), 'a gun the round never had drops');
  // Economy and damage.
  ok(drops('In round 3 you had 3900 credits.', F3, 'economy'), 'a buy or credit claim about a round drops before Phase D');
  ok(keeps('In round 2 you dealt no damage before you died.', F3), 'and stays where the round\'s look said it', why('In round 2 you dealt no damage before you died.', F3));
  // Count and repetition.
  ok(keeps('20 of your 21 deaths went unanswered.', F3) && drops('19 of your 21 deaths went unanswered.', F3, 'count'), '"N of M" only as counted');
  ok(keeps('You kept dying at A Site.', F3) && drops('You kept peeking alone.', F3, 'count'), 'a repeat only where a counted entry says so');
  ok(keeps('Check the minimap every round.', F3), 'advice in the present is no claim');
  // Buy blame.
  ok(drops('In round 2 you stood in spawn during the buy phase, which is why you died.', F3, 'buy-blame'), 'a death blamed on the buy phase drops');
  ok(keeps('On a full buy, take a rifle and Heavy Armor.', F3), 'a rule about buying stays');
  // Time format.
  ok(drops('In round 3 you died at 0:19.', F3, 'time'), '"0:08" DROPS in a round sentence');
  ok(keeps('In round 3 you died 19 s in.', F3), 'and "19 s in" stays');
  // Numbers.
  ok(drops('The Sheriff does 160 to the head.', F3, 'number'), '"THE SHERIFF DOES 160 TO THE HEAD" DROPS', why('The Sheriff does 160 to the head.', F3));
  ok(keeps('The Sheriff does 159 to the head.', F3) && keeps('The Sheriff does 159.5 to the head.', F3), 'and 159, as the game shows it, or exactly, stays');
  ok(keeps('Two body shots kill an unarmoured player with a Sheriff.', F3), '"TWO BODY SHOTS KILL" A SHERIFF TARGET WITH NO ARMOUR STAYS', why('Two body shots kill an unarmoured player with a Sheriff.', F3));
  ok(drops('Two body shots from a Sheriff kill through Heavy Armor.', F3, 'number'), 'and against Heavy Armor drops');
  ok(drops('Two body shots from a Sheriff kill.', F3, 'number'), 'and said of every armour drops');
  ok(keeps('A Sheriff one taps inside 30 m.', F3), 'a one tap is one head hit, at the band it names');
  ok(keeps('You finished with 31 kills and a K/D of 1.48.', F3) && drops('You finished with 32 kills.', F3, 'number'), 'the scoreline\'s numbers are Riot\'s');
  ok(keeps('A round lasts 100 seconds.', F3) && drops('A round lasts 90 seconds.', F3, 'number'), 'a rule\'s number is the primer\'s, tied by its words');
  ok(drops('In round 3 you died 25 s in.', F3, 'number') && keeps('In round 3 you died 19 s in, a second after your second kill.', F3), 'a time is the round\'s, within a second');
  ok(keeps('Spend 10 minutes in Deathmatch before you queue.', F3), 'a practice amount in an instruction claims nothing');
  ok(drops('Your crosshair should sit 3 pixels lower.', F3, 'number'), 'a number tied to nothing drops');
}

// ── The verifier's probes (15 Oct): what passed or was dropped wrongly ──────
{
  console.log('\nthe verifier\'s probes:');
  // Each new regex on a known positive and a known negative.
  const cases = [
    ['GAME_CAPS', gates.GAME_CAPS, 'your K/D and your ACS', 'your teammate Kirax'],
    ['AGENT_RANKED', gates.AGENT_RANKED, 'Neon is better than Jett right now', 'your K/D on Jett is better than on Raze'],
    ['TIER', gates.TIER, 'Jett is S tier', 'a tier of cover'],
    ['RATE_RANKED', gates.RATE_RANKED, 'the highest win rate on Abyss', 'your win rate on Abyss'],
    ['MOST_PICKED', gates.MOST_PICKED, 'the most picked duelist', 'your most played agent'],
    ['PATCH_NOW', gates.PATCH_NOW, 'strong in the current patch', 'a patch changed it since'],
    ['META_REFUSED', gates.META_REFUSED, "I don't have pick rates", 'Jett has pick rates'],
    ['RESULT_NOUN_LOST', gates.RESULT_NOUN_LOST, 'round 5 was a loss', 'round 5 was a loss for them'],
    ['RESULT_NOUN_WON', gates.RESULT_NOUN_WON, 'round 5 was a win', 'round 5 was a win for the enemy'],
    ['YOUR_GUN_PAST', gates.YOUR_GUN_PAST, 'your Vandal lost to his Sheriff', 'your Vandal can win that fight'],
    ['THEIRS_FIRST', gates.THEIRS_FIRST, 'they were 3 against your 4', 'you were 4 against 3'],
    ['ABS_TIME', gates.ABS_TIME, ' s into the round', ' s after the plant'],
    ['DEATH_CLAIM', gates.DEATH_CLAIM, 'their Cypher killed you', 'you killed their Cypher'],
    ['OTHER_EVENT', gates.OTHER_EVENT, 'after your second kill', 'their Cypher killed you'],
    ['OWN_COUNT_BEFORE', gates.OWN_COUNT_BEFORE, 'In round 3 you got ', 'In round 3 your team got '],
    ['ECON_REFUSAL', gates.ECON_REFUSAL, "this match's record does not hold it", 'you bought a Vandal'],
    ['ROUND_TIMES', gates.ROUND_TIMES, 'the first kill of the round 8 times', 'the first kill in round 8'],
    ['CHAMPION_RANKED', gates.CHAMPION_RANKED, 'Ahri is better than Zed right now', 'Mid is better than top for you'],
    ['CHAMPION_META', gates.CHAMPION_META, 'the best champion right now', 'a champion with a dash'],
  ];
  for (const [name, re, pos, neg] of cases) {
    const r = re && new RegExp(re.source, re.flags.replace('g', ''));
    ok(!!r && r.test(pos) && !r.test(neg), `${name} matches "${pos}" and not "${neg}"`);
  }
  // The game's capitals are the review route's own list, word for word, and then the chat's.
  const coachSrc = fs.readFileSync(path.join(__dirname, '..', 'server', 'routes', 'coach.js'), 'utf8');
  ok(coachSrc.includes(`const REVIEW_WORDS = /\\b(?:${gates.REVIEW_CAPS})\\b/gi;`), 'THE GAME\'S CAPITALS ARE THE REVIEW ROUTE\'S REVIEW_WORDS, word for word');
  // A word the player capitalised is no name they typed.
  for (const q of ['Why is my K/D bad?', 'What happened in Overtime?', 'How do I play Attack better?', 'How was my Economy?', 'Explain my Grade please']) {
    const fq = factsFor(inputFor(ABYSS, q), [{ role: 'user', content: q }], STAND_IN);
    ok(fq.echo.size === 0, `"${q}" TYPES NO NAME: a word of the game's is no echo`, JSON.stringify([...fq.echo]));
  }
  const kd = factsFor(inputFor(ABYSS, 'Why is my K/D bad?'), [{ role: 'user', content: 'Why is my K/D bad?' }], STAND_IN);
  ok(keeps('Your K/D in this match was 1.48.', kd) && keeps('You finished the match with 31 kills and a 1.48 K/D.', kd),
    'AND AN ANSWER SAYING K/D STAYS, its K/D a number of the scoreboard\'s', why('You finished the match with 31 kills and a 1.48 K/D.', kd));
  const duo = factsFor(inputFor(ABYSS, 'My duo Kirax always lurks'), [{ role: 'user', content: 'My duo Kirax always lurks' }], STAND_IN);
  ok(duo.echo.has('Kirax') && drops('Kirax should have lurked closer to you.', duo, 'name'), 'while a name the player typed is still one');
  // The review's own sentences reach the prompt with the game's capitals in them.
  ok(cp.gateText('You went 31 and 21 as Jett, a 1.48 K/D, and your ACS of 245.5 led the lobby.', { language: 'en' }, 400) !== null
    && cp.gateText('A 13 to 11 Victory where you were the match MVP.', { language: 'en' }, 400) !== null
    && cp.gateText('Your teammate Tessik was ahead of you.', { language: 'en' }, 400) === null,
  'A REVIEW SENTENCE WITH K/D, ACS, VICTORY OR MVP IN IT REACHES THE PROMPT, and one naming someone does not');
  ok(!verdict('From this match alone I can see your ACS of 382 led the lobby.', F3).logged.length, 'and the name rule\'s log counts no "I" and no ACS');
  // The match's own names hold the review's own sentences too, a name in lower case among them.
  const riotRounds = require('../server/services/riot-rounds');
  const NAMED_MATCH = 'b1d2c3e4-0000-4000-8000-00000000abcd';
  riotRounds.noteNames(NAMED_MATCH, { players: [{ name: 'Kestrelvane', tag: 'EUW1' }] });
  const named = chatContext.build({ ...ABYSS, matchId: NAMED_MATCH }, { rows: [] }, null, Q3, { game: 'valorant', language: 'en' });
  named.match.cards.find((c) => c.n === 2).look.what = 'You swung A Site with no utility. kestrelvane was watching the door.';
  const nNamed = cp.normalise(named).match.cards.find((c) => c.n === 2).look.what;
  ok(nNamed === 'You swung A Site with no utility.', 'A NAME OF THE MATCH\'S OWN IN A REVIEW SENTENCE, EVEN IN LOWER CASE, NEVER REACHES THE PROMPT', JSON.stringify(nNamed));
  // The meta: a refusal is no meta, a ranking in other words is one.
  for (const s of ["I don't have pick rates or a tier list for the current patch, so I won't rank agents.",
    "I can't tell you the meta, because I don't have pick or win rates for this patch.", 'Rather than chase the meta, look at your own numbers.',
    'Your highest win rate is on Jett.']) {
    ok(keeps(s, F3), `A REFUSAL NAMES NO META: "${s}" stays`, why(s, F3));
  }
  for (const s of ['Neon is better than Jett right now.', 'Jett is S tier.', 'Jett has the highest win rate on Abyss.', 'Jett is the most picked duelist.',
    'Jett is very strong in the current patch.']) {
    ok(drops(s, F3, 'meta'), `A RANKING IN OTHER WORDS DROPS: "${s}"`, why(s, F3));
  }
  ok(drops('Pro players like Brimo peek wide.', F3, 'attribution') && drops('Pros like Brimo peek wide.', F3, 'attribution'),
    'A PRO NAMED AT A SENTENCE\'S START IS A SOURCE');
  // The label said with its round between the phrase and the label.
  ok(drops('The coach calls round 6 a lost duel.', F3, 'label') && drops('The look labelled round 3 as an overextension.', F3, 'label')
    && keeps('The coach calls round 2 a dry peek.', F3) && keeps('The coach calls round 4 a lost duel.', F3),
  'THE COACH CALLS ROUND 6 A LOST DUEL DROPS: a label is read past the round named', why('The coach calls round 6 a lost duel.', F3));
  // The result in other words.
  ok(drops('You lost the first round.', F3, 'result') && keeps('You won the first round.', F3) && keeps('You lost the first duel in round 5, and your team won the round.', F3),
    'YOU LOST THE FIRST ROUND DROPS on a match whose round 1 was won, and the first duel is still a fight', why('You lost the first round.', F3));
  ok(drops('Round 5 was a loss for you.', F3, 'result') && drops('The enemy took round 5.', F3, 'result') && keeps('Round 3 was a loss.', F3),
    'A ROUND\'S RESULT AS A NOUN, OR TAKEN, IS ITS RESULT', why('Round 5 was a loss for you.', F3));
  // The asked round in other words: round 5, won, the death traded.
  const Q5 = 'Why did I lose round 5?';
  const M5 = [{ role: 'user', content: Q5 }];
  const F5 = factsFor(inputFor(ABYSS, Q5), M5, STAND_IN);
  ok(F5.asked === 5 && F5.rounds.get(5).traded === true && F3.rounds.get(3).traded === false, 'round 5\'s death was traded, round 3\'s was not');
  ok(drops('Nobody traded you.', F5, 'timeline') && drops('No one traded your death.', F5, 'timeline') && keeps('A teammate traded you.', F5)
    && drops('A teammate traded you.', F3, 'timeline') && keeps('Nobody traded you.', F3),
  'NOBODY TRADED YOU IS ABOUT THE ASKED ROUND, and holds to its trade either way', why('Nobody traded you.', F5));
  ok(drops('You bought a Vandal.', F3) && drops('You saved that round.', F3, 'economy')
    && keeps("I cannot tell you what you bought, because this match's record does not hold it.", F3),
  'WHAT YOU BOUGHT OR SAVED IN THE ASKED ROUND DROPS, and saying the record does not hold it stays', why("I cannot tell you what you bought, because this match's record does not hold it.", F3));
  ok(drops('Your Phantom lost the fight.', F3, 'weapon') && keeps('Your Vandal got both kills.', F3), 'the player\'s own gun in the asked round is the feed\'s', why('Your Vandal got both kills.', F3));
  ok(drops('Your team was down 3 against 4 when you died.', F3, 'timeline') && keeps('Your team was up 4 against 3 when you died.', F3)
    && keeps('They were 3 against 4 when you died.', F3),
  'THE NUMBERS STANDING ARE THE PLAYER\'S SIDE FIRST, theirs first only when the sentence is about them', why('Your team was down 3 against 4 when you died.', F3));
  ok(drops('You died 27 s into the round.', F3, 'number') && drops('You died 30 s into the round.', F3, 'number')
    && drops('Their Cypher killed you with a Spectre 12 s in.', F3, 'number')
    && keeps('You died 19 s into the round.', F3) && keeps('Their Cypher killed you with a Spectre 19 s in.', F3)
    && keeps('You died 19 s in, a second after your second kill.', F3),
  'A DEATH\'S TIME IS RIOT\'S SECOND OF IT: another kill\'s 27 s and a counted 30 s drop', why('You died 27 s into the round.', F3));
  ok(drops('You got three kills in round 3.', F3, 'number') && keeps('You got two kills in round 3.', F3) && keeps('In round 11 you got 4 kills.', F3),
    'A NAMED ROUND\'S KILLS ARE THE PLAYER\'S OWN THERE', why('You got three kills in round 3.', F3));
  ok(keeps('Your grade for the match was 66, a C.', F3), 'and a grade said with where it was stays', why('Your grade for the match was 66, a C.', F3));
  ok(keeps('On Jett you went 31 and 21 with an ACS of 382.', F3) && drops('You went 30 and 21 on Jett.', F3, 'number'),
    'YOU WENT 31 AND 21 IS THE SCOREBOARD\'S KILLS AND DEATHS, and any other pair drops', why('On Jett you went 31 and 21 with an ACS of 382.', F3));
  // The counted line, quoted as the prompt asks.
  const opened = 'You got the first kill of the round 8 times, rounds 5, 11, 13, 16, 18, 21 and 2 more.';
  ok(IN3.match.lists.strengths.some((e) => e.detail && e.detail.startsWith('You got the first kill of the round 8 times')),
    'the Abyss counts the first kill of the round 8 times');
  ok(keeps(opened, F3) && keeps('You got the first kill of the round 8 times.', F3)
    && drops('You got the first kill of the round 9 times.', F3) && drops('You died 3 times in a row.', F3, 'count'),
  'A COUNTED LINE QUOTED STAYS: "the round 8 times" names no round 8 and "and 2 more" no round 2, and an uncounted repeat still drops', why(opened, F3));
  // The money words only where they are money, now that the asked round reads them.
  ok(keeps('You died 21 times in 24 rounds.', F3) && drops('You died 22 times.', F3, 'count'),
    'YOU DIED 21 TIMES IS THE SCOREBOARD\'S 21 DEATHS, and any other count of them drops', why('You died 21 times in 24 rounds.', F3));
  // League, the computed review's own words and numbers.
  const lolIn = cp.normalise({ v: 2, game: 'lol', language: 'en', match: { champion: 'Ahri', role: 'Mid', mode: 'CLASSIC', at: Date.now(), durationSec: 1800,
    scoreline: { kills: 7, deaths: 4, assists: 9, cs: 182 }, deaths: [{ n: 1, atSec: 754, fact: 'An ally had died in the 20 seconds before it.' }],
    grade: { score: 71, letter: 'B', categories: [{ key: 'farming', label: 'Farming', score: 64, evidence: ['182 CS'] }] } }, player: {}, ask: {} });
  const lolF = cp.factsOf(lolIn, [{ role: 'user', content: 'Why did I die so often?' }]);
  ok(keeps('Your first death came 12 minutes 34 seconds in.', lolF) && drops('Your first death came 15 minutes in.', lolF, 'number')
    && keeps('You died 4 times.', lolF) && drops('You died 5 times.', lolF, 'count'),
  'A LEAGUE DEATH BY THE GAME\'S CLOCK, AS THE PROMPT WRITES IT, AND ITS 4 DEATHS STAY, and other numbers drop', why('Your first death came 12 minutes 34 seconds in.', lolF));
  ok(drops('Ahri is better than Zed right now.', lolF, 'meta') && drops('Ahri is the best champion right now.', lolF, 'meta')
    && keeps('Your best champion by grade is Ahri.', lolF) && keeps('Mid is better than top for you.', lolF),
  'A CHAMPION RANKED IN LEAGUE DROPS, the player\'s own best champion stays', why('Your best champion by grade is Ahri.', lolF));
  ok(keeps('You bought time with your smoke.', F3) && keeps('You forced them to rotate.', F3) && keeps('You saved your Blade Storm for the retake.', F3)
    && keeps('You dealt with the Raze first.', F3) && drops('You forced in round 3.', F3, 'economy') && drops('You dealt 140 damage to the Cypher.', F3, 'economy'),
  'BOUGHT TIME, FORCED THEM, SAVED YOUR ULTIMATE AND DEALT WITH A RAZE ARE NO ECONOMY, and a force buy is one', why('You saved your Blade Storm for the retake.', F3));
}

// ── The named cases that live on the question ───────────────────────────────
{
  console.log('\nthe question:');
  ok(chatContext.roundOf('what happened in round #12?', ABYSS) === 12, '"WHAT HAPPENED IN ROUND #12?" KEEPS ITS ROUND');
  ok(gates.shapeOf('what happened in round #12?') === null, 'and is no Riot ID to the gates');
  ok(inputFor(ABYSS, 'what happened in round #12?').ask.round === 12, 'and reaches the server as round 12');
  // A teammate's name the player typed.
  const msgs = [{ role: 'user', content: 'My teammate Kestrelvane kept baiting me in round 3. Why did I die?' }];
  const input = inputFor(ABYSS, msgs[0].content);
  const f = factsFor(input, msgs, STAND_IN);
  ok(f.echo.has('Kestrelvane') && !f.echo.has('My') && !f.echo.has('Why'), 'the echo takes the capitalised word the player typed, never a sentence\'s first');
  ok(drops('Kestrelvane should have swung with you.', f, 'name'), 'A TEAMMATE\'S NAME THE PLAYER TYPED DROPS');
  ok(keeps('Your teammate should have swung with you.', f), 'and "your teammate" stays');
}

// ── A Spanish sample ───────────────────────────────────────────────────────
{
  console.log('\nin Spanish:');
  const msgs = [{ role: 'user', content: 'Mi compañero Kestrelvane me dejó solo en la ronda 3. ¿Por qué morí?' }];
  const input = inputFor(ABYSS, msgs[0].content, { language: 'es' });
  const f = factsFor(input, msgs, STAND_IN);
  ok(input.language === 'es' && input.ask.round === 3, 'the round of "la ronda 3" is read');
  ok(keeps('No perdiste la ronda 5, la ganaste.', f), 'a round and its result are left alone outside English');
  ok(drops('La ronda 30 fue la clave.', f, 'round'), 'a round the match does not have drops in any language');
  ok(keeps('El Sheriff hace 159 a la cabeza.', f) && drops('El Sheriff hace 161 a la cabeza.', f, 'number'), 'a number is checked by its value');
  ok(keeps('Moriste a los 19 s de la ronda 3.', f) && drops('Moriste a los 25 s de la ronda 3.', f, 'number'), 'and a time by its unit');
  ok(drops('Kestrelvane no te cubrió.', f, 'name'), 'a name the player typed drops');
  ok(drops('Tu compañero Morvane#EUW no te cubrió.', f, 'name'), 'and a Riot ID');
  ok(keeps('Tu compañero no te cubrió.', f), 'and the sentence without it stays');
}

// ── parseReply: paragraphs, dashes, markdown, the retry ────────────────────
{
  console.log('\nthe reply:');
  const raw = `You died 19 s in, a second after your second kill, to their Cypher with a Spectre ${String.fromCharCode(0x2014)} and nobody traded you.\n`
    + 'With your team up 4 against 3, the round was yours to hold.\n\n'
    + '**Next time**, take your second kill and step back out of sight.\n\n- Press Q to Updraft out of the fight.';
  const out = cp.parseReply(raw, IN3, { messages: M3 });
  ok(out.reply && !out.retry, 'a clean reply goes out as it is', JSON.stringify(out));
  ok(out.reply.split('\n\n').length === 3, 'ITS PARAGRAPHS ARE KEPT', JSON.stringify(out.reply));
  ok(!DASHES.test(out.reply) && !/\*\*/.test(out.reply) && !/^- /m.test(out.reply), 'DASHES GONE, and no markdown or list marks', JSON.stringify(out.reply));
  const bad = cp.parseReply('You lost round 5 because you peeked alone. Next time, wait for a teammate.', IN3, { messages: M3 });
  ok(bad.retry && bad.firstDropped && bad.dropped.result === 1, 'a first sentence dropped asks for the reply again', JSON.stringify(bad));
  ok(bad.reasons.some((r) => /round 5 was lost/.test(r) && /has it won/.test(r)), 'with the reason named', JSON.stringify(bad.reasons));
  const again = cp.retryPrompt('PROMPT', bad.reasons);
  ok(again.startsWith('PROMPT\n\n') && again.includes('Your reply said round 5 was lost') && /answer the question in your first sentence/.test(again),
    'the retry is the prompt again with the reasons named', again.slice(-300));
  const thin = cp.parseReply('Good question. The Sheriff does 160 to the head.', IN3, { messages: M3 });
  ok(thin.retry && !thin.firstDropped && thin.kept < 2, 'fewer than two sentences kept asks again too', JSON.stringify(thin));
  const twice = cp.parseReply('You lost round 5. You lost round 3.', IN3, { messages: M3 });
  ok(twice.retry, 'and a retry that fails again is still a retry: the route answers the honest line');
  ok(cp.HONEST_LINE === "I couldn't give you an answer I can stand behind for that one. Ask me about a round, a death or your agent in this match.",
    'the honest line is the spec\'s, word for word');
  const empty = cp.parseReply('', IN3, { messages: M3 });
  ok(empty.retry && empty.reasons.length === 1, 'an empty reply is asked for again');
  ok(cp.parseReply('As an AI language model I cannot assist with that.', IN3, { messages: M3 }).retry, 'and a refusal');
  const long = cp.parseReply(Array.from({ length: 80 }, () => 'Take your shot from cover and step back out of sight.').join(' '), IN3, { messages: M3 });
  ok(long.reply.length <= 4000 && /\.$/.test(long.reply), 'a reply is cut at 4,000 characters, on a sentence', String(long.reply.length));
  const named = cp.parseReply('Your teammate Brimo was ahead of you. Take the next fight with him.', IN3, { messages: M3 });
  ok(!named.retry && named.logged['name-log'] === 1 && !named.dropped.name, 'the name rule\'s hits are counted apart, and nothing is dropped for them');
  const set = cp.parseReply('Kestrel was ahead of you. Take the next fight with him. Then trade.', IN3, { messages: M3, nameSet: { has: (t) => /kestrel/i.test(t) } });
  ok(set.dropped.name === 1 && !/Kestrel/.test(set.reply), 'the match\'s name set, as the route hands it, drops its names', JSON.stringify(set));
  const both = cp.parseReply('Kestrel was ahead of you. Take the next fight with him. Then trade.', IN3, { messages: M3, names: { has: (t) => /kestrel/i.test(t) } });
  ok(both.dropped.name === 1, 'under either of the names the route passes it by');
}

// ── normalise: every field bounded, free text gated ────────────────────────
{
  console.log('\nnormalise:');
  const ctx = chatContext.build({ ...ABYSS, summary: 'Standing idle in spawn during buy phase was the repeated mistake occurring in rounds 1, 2, 3 and 4.',
    focus: 'Move to your first cover. Trade your entry.' }, { rows: [] }, null, 'Walk me through round 3', { game: 'valorant', language: 'en' });
  const c3 = ctx.match.cards.find((c) => c.n === 3);
  c3.screen = { spot: 'Hookah', ult: 'ready', lookDigits: [{ value: 57, unit: 'health' }] };
  c3.riot.killer = 'NotAnAgent';
  c3.riot.weapon = 'Lightsaber';
  ctx.match.cards[1].look.what = 'Morvane#EUW watched you swing. You swung A Site with no utility.';
  ctx.match.cards[1].look.cause = 'made-up-cause';
  ctx.match.agent = 'Nobody';
  const n = cp.normalise(ctx);
  ok(n.match.coach.summary === null, 'THE SUNSET 8.3.0 SUMMARY ARRIVES AS NOTHING (buy blame)', JSON.stringify(n.match.coach));
  ok(n.match.coach.focus === 'Move to your first cover. Trade your entry.', 'a focus with no blame in it arrives whole');
  const n3 = n.match.cards.find((c) => c.n === 3);
  ok(n3.screen.spot === null && n3.screen.ult === 'ready', 'a callout not on this map is no spot');
  ok(n3.riot.killer === null && n3.riot.weapon === null, 'an agent and a gun the game does not have are none');
  ok(n.match.cards[1].look.what === 'You swung A Site with no utility.' && n.match.cards[1].look.cause === null,
    'a look sentence naming a player loses that sentence, and an unknown cause is none');
  ok(n.match.agent === null, 'an unknown agent is none');
  ok(!JSON.stringify(n).includes('reads') && !JSON.stringify(n).includes('Mid Library alone'), 'and a card\'s screen reads are nowhere in it');
  const junk = cp.normalise({ v: 2, game: 'valorant', language: 'xx', match: { cards: [{ n: 99 }, { n: 2, riot: { sec: 5000, kills: 9 } }] }, ask: { round: 99 } });
  ok(junk.language === 'en' && junk.match.cards.length === 1 && junk.match.cards[0].riot.sec === null && junk.match.cards[0].riot.kills === null
    && junk.ask.round === null, 'numbers out of range are none, a round the match does not have is no question\'s');
  ok(cp.normalise(null).match === null && cp.normalise({ game: 'lol' }).game === 'lol', 'and nothing at all is a context too');
}

// ── buildPrompt: the order, the rules word for word, the budget ────────────
const SPEC_RULES = `You are Occlara's Valorant coach, talking with the player after a match to help them learn from it. You are never told about a match being played right now, and you never give advice for one.

WHAT YOU ARE GIVEN, AND HOW FAR TO TRUST IT
- VALORANT FACTS: the game's rules and numbers as the game is now, exact. Every number you say about the game itself (damage, hits or time to kill, prices, credits, timers, ranges, ultimate points) must be one of these. If an answer needs a game number that is not there, say you do not have it. A match played before a patch can differ, and a number left out for this match is one a patch has changed since.
- RIOT'S RECORD: what happened in the match, exact: who won each round, every kill with its time, the agents and the gun, the plant, both team comps. It wins over everything else.
- READ OFF THE SCREEN: where the player was and what the HUD showed, including numbers a look read off the HUD. It can be wrong, and Riot's record wins where they disagree.
- COUNTED: the grade, its categories and their evidence, the counted mistakes, strengths and misses, the patterns across matches and the breakdown. Code counted them from the record, so they are true. Quote their numbers exactly, and never compute a new grade, score, percentage or count.
- THE COACH'S LOOK at a death: what the frames showed, the better play, and, when it has one, a label from a closed list. Quote a label and explain it by its definition. Never give a death a label it does not have, and never label a death the coach did not look at or one given to you without a label: tell what the look saw and teach its better play. If a better play moves the player, teach that, and never call the fight fair.
- THE COACH'S EARLIER WORDS: the review's summary, focus and round lines, written by a model from the same facts. Use them only where the facts agree.
- COACHING NOTES: habits to draw on where the facts match. Never quote one word for word, and never say where any advice comes from.

WHAT YOU MUST NOT SAY
- Nothing the facts do not hold. This match's record does not hold what anyone bought, the credits, the damage dealt and taken, or the utility used: if asked, say so and teach the rule instead.
- No ranking of agents, no meta, no pick or win rates for the current patch: you do not have them. Answer from the kit, the player's own numbers and the facts.
- No player names, ever, even one the player typed: say your teammate, or the agent. No coach, player, team, video or other source for any advice.
- Only Valorant and the player's play.

HOW TO ANSWER
- Answer the question in your first sentence. If the question rests on something the facts contradict (a round called lost that was won, a death that did not happen), say so first, plainly, then answer what they meant.
- About a round, a death or a play: tell it in order from the record (the side and the kind of round, the opening, the plant, the death with the numbers standing, how it ended), then the decision that decided it for the player, then what to do instead, concretely enough to do next round, and why it works in game terms: the guns and the range, the numbers standing, the clock and the spike, the kit.
- A fair fight is one taken from where it should be taken, at a range the gun can fight. Whether a teammate could trade it is a separate question.
- About an agent: the player's own numbers on it first, then how its kit answers the problem, each ability by its name and key.
- About improving: the largest counted mistake or pattern with its count exactly as given, the habit that answers it, and one drill to build it.
- Name the match the first time you refer to it: the map, the agent and the result.
- Write times as seconds into the round, "8 s in", never as a clock such as 0:08, which reads as the time left.
- Speak to the player as you. Short paragraphs of plain text: no lists, no headings, no markdown. About 250 words, up to 400 when you walk through a round. Commas and periods, never dashes.`;
{
  console.log('\nthe prompt:');
  const p = cp.buildPrompt(IN3, M3, { variant: 'v2' });
  ok(cp.VALORANT_RULES === SPEC_RULES && p.startsWith(SPEC_RULES), 'THE STATIC RULES ARE THE SPEC\'S, WORD FOR WORD, and open the prompt');
  const at = (s) => p.indexOf(s);
  // Each section by its own heading line, never a word of the rules above it.
  const NL = String.fromCharCode(10);
  const order = [`${NL}THE PLAYER`, `${NL}THE MATCH (`, `${NL}ROUND 3 IN FULL`, `${NL}COACHING NOTES${NL}`, `${NL}THE CONVERSATION`,
    `${NL}Reply as the coach to the player's last message.`];
  ok(order.every((s, i) => at(s) > 0 && (i === 0 || at(s) > at(order[i - 1]))), 'then THE PLAYER, THE MATCH with the asked round in full, the notes, the conversation and the reply line',
    order.map((s) => `${s}@${at(s)}`).join(' '));
  ok(/Kills in order, from Riot's record: .*their Skye killed your teammate's Sova with a Vandal/.test(p)
    && /19 s in, their Cypher killed you with a Spectre \(then 3 against 3\)/.test(p), 'the asked round is told in order from the feed, by agent and gun, with the numbers standing');
  ok(/TEAMS, from Riot's record: yours Jett \(Duelist\), Sova \(Initiator\); theirs Cypher \(Sentinel\), Skye \(Initiator\)\./.test(p), 'both comps, from the fill');
  ok(/Its label: Lost the duel/.test(cp.buildPrompt(inputFor(ABYSS, 'Walk me through round 4'), [{ role: 'user', content: 'Walk me through round 4' }])),
    'a look\'s label is said with its definition');
  ok(/It is given to you without a label: tell what the look saw and teach its better play, and never call the fight fair\./
    .test(cp.buildPrompt(inputFor(ABYSS, 'Walk me through round 6'), [{ role: 'user', content: 'Walk me through round 6' }])), 'and a look sent without one says so');
  ok(!/this session|tips given|Radiant-level|strongest picks|Mid Library alone/i.test(p), 'no tip era words, no meta example, and no screen read');
  ok(!DASHES.test(p.slice(SPEC_RULES.length)), 'and no dash in what it renders');
  const noPrimer = cp.buildPrompt(IN3, M3, { variant: 'v2-noprimer' });
  ok(noPrimer.startsWith(SPEC_RULES) && noPrimer.length < p.length && /state no game number at all/.test(noPrimer), 'v2-noprimer leaves the primer out, and says no number may be given');
  const es = cp.buildPrompt(inputFor(ABYSS, '¿Por qué perdí la ronda 3?', { language: 'es' }), [{ role: 'user', content: '¿Por qué perdí la ronda 3?' }]);
  ok(/Write the whole reply in Spanish\. Keep agent, ability, weapon and map names exactly as the game prints them\.$/.test(es), 'the language line closes a Spanish prompt');
  const none = cp.buildPrompt(cp.normalise({ v: 2, game: 'valorant', language: 'en', match: null, player: {}, ask: {} }), [{ role: 'user', content: 'When should my team save?' }]);
  ok(none.includes('The player has no match in front of you: answer from the game facts, and never describe their play.'), 'no match says so');
  // A Riot only review: facts, no look, its own line.
  const split = load('riot-split-13-7.json');
  const row = { matchId: 'split-test-0001', map: 'Split', agent: split.me.agent, mode: 'Competitive', result: split.result, score: split.score,
    kills: split.me.kills, deaths: split.me.deaths, assists: split.me.assists, acs: 250, adr: 150, headshotPct: 20, startedAt: Date.now() - 3 * 3600000 };
  // Filled as the app fills an older review, so its rounds carry Riot's feed.
  const riotOnly = chatContext.applyRoundRecord(riotReview.fromRiot({ row, riot: split, history: [] }).review, split, Date.now());
  const rq = 'Walk me through round 15';
  const rin = inputFor({ ...riotOnly, id: 'valorant-1790000000001-split01' }, rq);
  const rp = cp.buildPrompt(rin, [{ role: 'user', content: rq }]);
  ok(rp.includes(cp.RIOT_ONLY) && !/Coach's look/.test(rp), 'a Riot only review carries its line and no look');
  // The budget: a 20 round match with its feed, eight notes and eight messages.
  const msgs = Array.from({ length: 8 }, (_v, i) => ({ role: i % 2 ? 'assistant' : 'user', content: i % 2 ? 'x '.repeat(900) : `${rq} again, number ${i}` }));
  const big = cp.buildPrompt(rin, msgs);
  const dynamic = big.slice(big.indexOf('THE PLAYER'));
  ok(dynamic.length <= cp.DYNAMIC_MAX_CHARS && /ROUND 15 IN FULL/.test(big) && /Kills in order/.test(big),
    'A 20 ROUND MATCH RENDERS UNDER BUDGET WITH THE ASKED ROUND IN FULL', `${dynamic.length} of ${cp.DYNAMIC_MAX_CHARS}`);
  // League: its computed review alone.
  const lol = cp.normalise({ v: 2, game: 'lol', language: 'en', match: { champion: 'Ahri', role: 'Mid', mode: 'CLASSIC', at: Date.now(),
    scoreline: { kills: 7, deaths: 4, assists: 9, cs: 182 }, deaths: [{ n: 1, atSec: 754, fact: 'An ally had died in the 20 seconds before it.' }],
    grade: { score: 71, letter: 'B', categories: [{ key: 'farming', label: 'Farming', score: 64, evidence: ['182 CS'] }] } }, player: {}, ask: {} });
  const lp = cp.buildPrompt(lol, [{ role: 'user', content: 'Why did I die so often?' }]);
  ok(lp.startsWith(cp.LEAGUE_RULES) && !/VALORANT|Valorant|agent/.test(lp) && /12 minutes 34 seconds in/.test(lp), 'League gets its computed review alone, no primer');
  const lf = cp.factsOf(lol, [{ role: 'user', content: 'Why did I die so often?' }]);
  ok(keeps('You had 182 CS by the end.', lf) && drops('You had 200 CS by the end.', lf, 'number'), 'League\'s numbers are its own record\'s');
  ok(drops('You finished with 9 kills.', lf, 'number') && keeps('You finished with 7 kills.', lf), 'and the number gate holds a reply to them');
}

// ── The real primer, when it loads ─────────────────────────────────────────
{
  console.log('\nwith game-primer.js as it renders today:');
  let primer = null;
  try { primer = require('../server/services/game-primer'); } catch { primer = null; }
  const real = cp.primerFacts('standard', AT);
  if (!primer || !real.some((e) => e.subject === 'Sheriff')) {
    console.log('skip  game-primer.js has no Sheriff in its provenance yet');
  } else {
    // A fresh input: the one above has the stand-in in its cached facts.
    const f = factsFor(inputFor(ABYSS, Q3), M3, null);
    ok(f.primer.length === real.length && f.primer.length > 0, 'the facts hold the primer\'s own numbers');
    ok(drops('The Sheriff does 160 to the head.', f, 'number') && keeps('The Sheriff does 159 to the head.', f), 'the Sheriff\'s 159, the primer\'s, stays and 160 drops');
    const sh = real.filter((e) => e.subject === 'Sheriff' && e.attribute === 'hits' && e.part === 'body' && e.band && e.band.from === 0);
    if (sh.length >= 3) {
      ok(keeps('Two body shots kill an unarmoured player with a Sheriff.', f) && drops('Two body shots from a Sheriff kill through Heavy Armor.', f, 'number'),
        'and its hits to kill decide the armour cases');
    } else console.log('skip  the primer prints no Sheriff hits to kill today');
    // CHAT_PRIMER_GUNS=slices: the gun table leaves the core for the guns the
    // question and the match name, and the roster stays (game-primer.js renderCore).
    const before = process.env.CHAT_PRIMER_GUNS;
    process.env.CHAT_PRIMER_GUNS = 'slices';
    let sliced = '';
    try {
      const msgs = [{ role: 'user', content: 'How many body shots does a Vandal need?' }];
      sliced = cp.buildPrompt(inputFor(ABYSS, msgs[0].content), msgs, { variant: 'v2' });
    } finally {
      if (before === undefined) delete process.env.CHAT_PRIMER_GUNS; else process.env.CHAT_PRIMER_GUNS = before;
    }
    const whole = cp.buildPrompt(inputFor(ABYSS, 'How many body shots does a Vandal need?'), [{ role: 'user', content: 'How many body shots does a Vandal need?' }], { variant: 'v2' });
    ok(!/\nGUNS \(/.test(sliced) && /\nAGENTS \(/.test(sliced) && /Vandal\. Price/.test(sliced) && !/Bucky\. Price/.test(sliced)
      && /\nGUNS \(/.test(whole) && /Bucky\. Price/.test(whole),
    'CHAT_PRIMER_GUNS=slices moves the gun table to the guns named and keeps the roster in the core');
  }
}

// ── The coaching notes leave out the review's own study list (8.5.0) ────────
// as either kind of client was given it: by cause since 8.5.0
// (match-review.js CAUSE_TOPICS, byCause), without it before. An Omen's two
// counted dry peeks bring a planning the peek note into the review's list by
// cause, which the chat must not hand back as a note of its own.
{
  const rev = require('../server/services/match-review');
  const dry = { n: 2, side: 'attacking', result: 'lost', died: true, verified: true,
    look: { cause: 'dry-peek', what: 'You swung the angle.', better: 'Wait for the team.', source: 'riot' } };
  const input = cp.normalise({ v: 2, game: 'valorant', language: 'en', advanced: false,
    match: { id: 'valorant-1790000000000-omen01', map: 'Pearl', agent: 'Omen', mode: 'Swiftplay', result: 'Defeat', score: '1-5', rounds: 2,
      verified: true, lists: { mistakes: [{ key: 'cause:dry-peek', title: 'Dry peeks', detail: 'Died 2 times', rounds: [2, 5], count: 2 }] },
      cards: [dry, { ...dry, n: 5 }] }, player: {}, ask: {} });
  const studied = (byCause) => rev.study({ context: { agent: 'Omen', map: 'Pearl', advancedTips: false }, patterns: [],
    rounds: input.match.cards.map((c) => ({ n: c.n, side: c.side, result: c.result, died: c.died, cause: c.look && c.look.cause })),
    mistakes: input.match.lists.mistakes, byCause }, 3).map((n) => n.text);
  const notes = cp.pickNotes(input, [{ role: 'user', content: 'What should I work on?' }]);
  const byCauseOnly = studied(true).filter((t) => !studied(false).includes(t));
  ok(notes.length >= 3 && byCauseOnly.length > 0 && [...studied(false), ...studied(true)].every((t) => !notes.includes(t)),
    'the chat\'s notes leave out the review\'s own study list as either kind of client was given it, by cause or not', `${byCauseOnly.length} by cause alone`);
}

// ── bench:chat counts a sentence the server withheld from a raw reply ───────
// (coach.js rawForBench puts name-gate.js WITHHELD where a sentence carried a
// word of the match's name set) as a name, beside the planted names.
{
  const bench = require('./bench-chat');
  const ng = require('../server/services/name-gate');
  const raw = `Round 5 went badly. ${ng.WITHHELD} Hold the angle with Varkalen next time.`;
  const n = bench.namesIn({ planted: ['Varkalen'] }, raw);
  ok(typeof ng.WITHHELD === 'string' && n.withheld === 1 && n.planted.length === 1 && n.count === 2 && bench.namesIn({ planted: [] }, 'Hold the angle.').count === 0,
    'bench:chat counts a sentence withheld from a raw reply as a name, beside a planted one', JSON.stringify(n));
}

console.log(fails ? `\nFAIL: ${fails} check(s) failed` : '\nPASS: every gate keeps and drops what it should, the prompt is the spec\'s, and the reply keeps its paragraphs');
process.exit(fails ? 1 : 0);

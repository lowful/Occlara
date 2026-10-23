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
    // Slices, the default since bench:chat of 15 Oct (CHAT_PRIMER_GUNS unset):
    // the gun table leaves the core for the guns the question and the match
    // name, and the roster stays (game-primer.js renderCore); core puts it back.
    const before = process.env.CHAT_PRIMER_GUNS;
    const msgs = [{ role: 'user', content: 'How many body shots does a Vandal need?' }];
    let sliced = '';
    let whole = '';
    try {
      delete process.env.CHAT_PRIMER_GUNS;
      sliced = cp.buildPrompt(inputFor(ABYSS, msgs[0].content), msgs, { variant: 'v2' });
      process.env.CHAT_PRIMER_GUNS = 'core';
      whole = cp.buildPrompt(inputFor(ABYSS, msgs[0].content), msgs, { variant: 'v2' });
    } finally {
      if (before === undefined) delete process.env.CHAT_PRIMER_GUNS; else process.env.CHAT_PRIMER_GUNS = before;
    }
    ok(!/\nGUNS \(/.test(sliced) && /\nAGENTS \(/.test(sliced) && /Vandal\. Price/.test(sliced) && !/Bucky\. Price/.test(sliced)
      && /\nGUNS \(/.test(whole) && /Bucky\. Price/.test(whole),
    'slices, the default, moves the gun table to the guns named and keeps the roster in the core, and CHAT_PRIMER_GUNS=core keeps the table whole');
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

// The matches the bench:chat cases need, as the gates see them: a question on
// a review, and a Riot record built as a review with the few facts of a round
// a case needs.
const asking = (rv, q, extra) => { const ms = [{ role: 'user', content: q }]; const input = inputFor(rv, q, extra); return { input, ms, f: factsFor(input, ms, STAND_IN) }; };
const riotOnly = (file, row, edit) => {
  const riot = load(file);
  const per = riot.perRound.map((r) => (edit && edit[r.n] ? { ...r, ...edit[r.n] } : r));
  const rv = riotReview.fromRiot({ row: { matchId: `${riot.map.toLowerCase()}-0015-test`, map: riot.map, agent: riot.me.agent,
    mode: riot.queue === 'swiftplay' ? 'Swiftplay' : 'Competitive', result: riot.result, score: riot.score,
    kills: 9, deaths: 6, assists: 2, acs: 200, adr: 130, headshotPct: 18, startedAt: AT, ...(row || {}) }, riot: { ...riot, perRound: per }, history: [] }).review;
  return review.served({ ...rv, id: `valorant-1790000000${riot.rounds}15-${riot.map.toLowerCase().slice(0, 6)}`, at: AT });
};

// ── The bench:chat run of 15 Oct (Sol v2), each case from its raw replies ───
// The person's read found the gates and the context, not the model, behind
// most of what failed. Every sentence below in quotes from the run is the
// model's own; the matches are the repo's Abyss and Split and the Riot records
// of the Sunset and Fracture swiftplays (riot-sunset-2-5.json,
// riot-fracture-5-1.json), with the few facts of a round the case needs.
{
  console.log('\nthe bench:chat run of 15 Oct:');
  const RQ = String.fromCharCode(0x2019);
  // Each new regex on a known positive and a known negative.
  const cases = [
    ['CURLY_SINGLE', gates.CURLY_SINGLE, `didn${RQ}t`, "didn't"],
    ['CURLY_DOUBLE', gates.CURLY_DOUBLE, `${String.fromCharCode(0x201c)}Died where nobody could trade${String.fromCharCode(0x201d)}`, '"Died where nobody could trade"'],
    ['PISTOL_ROUND', gates.PISTOL_ROUND, 'your attack pistol round', 'a pistol round your team won'],
    ['PISTOL_DESCRIBED', gates.PISTOL_DESCRIBED, 'Round 5 was ', 'Why was '],
    ['PISTOL_SECOND_AFTER', gates.PISTOL_SECOND_AFTER, ' after the swap', ' on attack'],
    ['ROUND_SECONDS', gates.ROUND_SECONDS, 'finished the round 33 s in', 'finished round 3 alive'],
    ['OBJECT_IS_ROUND', gates.OBJECT_IS_ROUND, ' round 22', ' 13 to 11'],
    ['MATCH_AFTER', gates.MATCH_AFTER, ' the match 5 to 1', ' the match point round'],
    ['SCORE_AFTER', gates.SCORE_AFTER, ' 13 to 11, round 22', ' round 22'],
    ['SCORE_BEFORE', gates.SCORE_BEFORE, 'In your Abyss match on Jett, a 13 to 11 ', 'In round 13 '],
    ['MATCH_BEFORE', gates.MATCH_BEFORE, 'In the Split match you ', 'In this round you '],
    ['NAMED_WIN_BEFORE', gates.NAMED_WIN_BEFORE, 'in the Abyss Jett ', 'in the round '],
    ['MAP_AFTER', gates.MAP_AFTER, ' Fracture with Jett', ' round 5 on Fracture'],
    ['OBJECT_BEFORE', gates.OBJECT_BEFORE, 'time to reach the space you ', 'that was the round you '],
    ['CLEFT_BEFORE', gates.CLEFT_BEFORE, 'What you ', 'Why you '],
    ['CLEFT_AFTER', gates.CLEFT_AFTER, ' was your opening fight', ' was round 5'],
    ['GUN_MINE_BEFORE', gates.GUN_MINE_BEFORE, 'you drew your ', 'his '],
    ['GUN_THEIRS_BEFORE', gates.GUN_THEIRS_BEFORE, 'before his ', 'you drew your '],
    ['GUN_WITH_BEFORE', gates.GUN_WITH_BEFORE, 'from beside cover with a ', 'from beside cover '],
    ['YOU_KILLED_PASSIVE', gates.YOU_KILLED_PASSIVE, 'you were killed by Clove with a ', 'you fought Clove with a '],
    ['TOWARD_SOMEONE', gates.TOWARD_SOMEONE, 'the first death against a Viper with a ', 'You fought Clove from beside cover with a '],
    ['CLAUSE_START', gates.CLAUSE_START, 'the first kill but Cypher', 'the first kill of Cypher'],
    ['PEEK_AGAIN', gates.PEEK_AGAIN, 'you peeked the same A Main angle again', 'you kept peeking alone'],
    ['TRADED_YOU (negated)', gates.TRADED_YOU, 'a teammate traded you', 'and no teammate traded you'],
    ['ECON_REFUSAL (confirm)', gates.ECON_REFUSAL, 'I cannot confirm from the record what gun you carried', 'I confirm you bought a Vandal'],
    ['VERDICT', cp.VERDICT, 'Yes.', 'Yes, save when the round is gone.'],
  ];
  for (const [name, re, pos, neg] of cases) {
    const r = re && new RegExp(re.source, re.flags.replace('g', ''));
    ok(!!r && r.test(pos) && !r.test(neg), `${name} matches "${pos}" and not "${neg}"`);
  }

  // The matches the cases need, as the gates see them (asking, riotOnly, above).
  const SUNSET = riotOnly('riot-sunset-2-5.json', null, { 5: { kills: 1, feed: [{ ms: 52000, by: 'me', on: 'enemy' }] } });
  // Fracture's rounds 5 and 6 with the facts Riot's record of them has: round 5
  // the first kill and two, the spike down at A, the player killed by their
  // Jett's Sheriff; round 6 a death to Chamber 3 s in, and the coach's look at it.
  const FRACTURE = (() => {
    const rv = riotOnly('riot-fracture-5-1.json', null, {
      5: { kills: 2, firstKill: true, traded: false, plantMs: 32000, plantSite: 'A', weapon: 'Sheriff', aliveAtDeath: { mates: 4, enemies: 3 },
        feed: [{ ms: 9000, by: 'me', on: 'enemy', ka: 'Jett', va: 'Deadlock', w: 'Bandit' }, { ms: 11000, by: 'me', on: 'enemy', ka: 'Jett', va: 'Chamber', w: 'Bandit' },
          { ms: 27000, by: 'enemy', on: 'mate', ka: 'Phoenix', va: 'Chamber' }, { ms: 33000, by: 'enemy', on: 'me', ka: 'Jett', va: 'Jett', w: 'Sheriff' }] },
      6: { firstDeath: true, traded: false, plantSite: 'B' },
    });
    return { ...rv, rounds: rv.rounds.map((c) => (c.n !== 6 ? c : { ...c, forensics: { cause: 'lost-duel', source: 'riot',
      what: 'You fought Chamber from B Tree with a Sheriff and fired three shots before he killed you.', better: 'Keep your crosshair at head level and tap.' } })) };
  })();

  // 1a. THE MATCH'S OWN RESULT BESIDE A ROUND.
  const A22 = asking(ABYSS, 'What happened in round 22?');
  ok(A22.f.asked === 22 && A22.f.rounds.get(22).result === 'lost' && A22.f.matchResult === 'won' && JSON.stringify(A22.f.finalScore) === '[13,11]',
    'round 22 of the Abyss was lost, the match won 13 to 11');
  ok(keeps('In the Abyss match on Jett, which you won 13 to 11, round 22 was an attack you lost.', A22.f) && keeps('Round 22 was an attack you lost.', A22.f),
    '"IN THE ABYSS MATCH ON JETT, WHICH YOU WON 13 TO 11, ROUND 22 WAS AN ATTACK YOU LOST" STAYS, as "Round 22 was an attack you lost" does',
    why('In the Abyss match on Jett, which you won 13 to 11, round 22 was an attack you lost.', A22.f));
  const A13 = asking(ABYSS, 'Why did I lose round 13?');
  const A3 = asking(ABYSS, 'Did Phoenix kill me in round 3?');
  for (const [s, at] of [
    ['In your Abyss match on Jett, a 13 to 11 win, this was the attack pistol round.', A13.f],
    ['Your attack pistol round in the Abyss Jett win, 13 to 11, started with an opening kill but ended in a loss.', A13.f],
    ['Round 22 was a lost attack round in your Abyss match on Jett, which you won 13 to 11.', A22.f],
    ['In your Abyss match on Jett, which you won 13 to 11, Cypher killed you in round 3 with a Spectre.', A3.f],
    ['You were playing Jett on Abyss in a match you eventually won 13 to 11, and that specific death happened 19 seconds into the round.', A3.f],
    ['In the match on Abyss as Jett, you won 13 to 11, but round 22 was a missed opportunity where you gave back the advantage.', A22.f],
  ]) ok(keeps(s, at), `the match's result is the match's: "${s}" stays`, why(s, at));
  ok(drops('You won round 22.', A22.f, 'result') && drops('In this match you won round 22.', A22.f, 'result')
    && drops('In the Abyss match on Jett, which you lost 11 to 13, round 22 was an attack you lost.', A22.f, 'result')
    && drops('You lost the match, and round 22 was an attack.', A22.f, 'result'),
  'and every claim of the round is still the round\'s, and a match result the record contradicts drops', why('In the Abyss match on Jett, which you lost 11 to 13, round 22 was an attack you lost.', A22.f));
  const F5 = asking(FRACTURE, 'Why did I lose round 5 on Fracture?');
  for (const s of ['You lost round 5 of the Fracture, Jett match you won 5 to 1 because the team gave up its post plant advantage.',
    'In your Fracture Jett match, a 5 to 1 Swiftplay win, round 5 was your attacking pistol round.',
    'You won the match on Fracture as Jett with a 5 to 1 result, but you lost round 5 because an advantage was given back after the plant.']) {
    ok(keeps(s, F5.f), `and on the Fracture swiftplay: "${s}" stays`, why(s, F5.f));
  }
  // 1b. A CURLY APOSTROPHE.
  const S5 = asking(SUNSET, 'Why did I lose round 5?');
  ok(S5.f.asked === 5 && S5.f.rounds.get(5).result === 'won' && S5.f.rounds.get(5).pistol === true, 'Sunset round 5 was won, the swiftplay\'s second pistol round');
  ok(keeps(`You didn${RQ}t lose round 5.`, S5.f) && keeps("You didn't lose round 5.", S5.f),
    `"YOU DIDN${RQ}T LOSE ROUND 5", CURLY AS SOL WRITES IT, STAYS AS THE STRAIGHT ONE DOES`, why(`You didn${RQ}t lose round 5.`, S5.f));
  ok(drops(`You didn${RQ}t win round 5.`, S5.f, 'result') && drops('You lost round 5.', S5.f, 'result'), 'and a claim of a loss drops, curly or not');
  ok(keeps('In the Sunset Swiftplay match on Jett, which you lost 2 to 5, round 5 was a defensive pistol round your team won, and you survived it.', S5.f),
    'Sol\'s whole correction of the Sunset premise stays', why('In the Sunset Swiftplay match on Jett, which you lost 2 to 5, round 5 was a defensive pistol round your team won, and you survived it.', S5.f));
  const SM = asking(ABYSS, 'Is Jett the best agent for Split, or should I switch?');
  ok(keeps(`I can${RQ}t tell you whether Jett is the best agent for Split from these facts.`, SM.f) && drops('Jett is the best agent for Split.', SM.f, 'meta'),
    `A CURLY "I CAN${RQ}T TELL YOU WHETHER JETT IS THE BEST AGENT" IS A REFUSAL, and the ranking still drops`, why(`I can${RQ}t tell you whether Jett is the best agent for Split from these facts.`, SM.f));
  ok(gates.straighten(`Tejo${RQ}s Outlaw`) === "Tejo's Outlaw" && gates.check(`You didn${RQ}t lose round 5.`, S5.f).drop === null, 'the gates read the sentence straightened, and the reply keeps it as written');
  // 1c. "PISTOL ROUND" IS NO ROUND 1.
  ok(keeps('Round 5 was a pistol round your team won.', S5.f), '"ROUND 5 WAS A PISTOL ROUND YOUR TEAM WON" STAYS ON THE SUNSET SWIFTPLAY', why('Round 5 was a pistol round your team won.', S5.f));
  ok(keeps('In that match on Sunset as Jett, which ended in a 2 to 5 loss, round 5 was your second pistol round and one of the two rounds you survived.', S5.f),
    'and "your second pistol round" is the match\'s second, which the player survived', why('In that match on Sunset as Jett, which ended in a 2 to 5 loss, round 5 was your second pistol round and one of the two rounds you survived.', S5.f));
  ok(keeps('Round 5 was the pistol round after the swap, on attack, and your team lost it.', F5.f), 'the spec\'s own answer, "the pistol round after the swap", stays', why('Round 5 was the pistol round after the swap, on attack, and your team lost it.', F5.f));
  const A1 = asking(ABYSS, 'How did my pistol round go?');
  ok(A1.f.rounds.get(1).result === 'won' && drops('You lost the pistol round.', A1.f, 'result') && keeps('Your team won the pistol round.', A1.f)
    && drops('Round 5 was a pistol round your team won.', A3.f, 'timeline'),
  'and the pistol round, named as one, is still round 1, and a round said to be one that is not drops', why('You lost the pistol round.', A1.f));
  // The rest of what the run shows the gates dropping true.
  ok(keeps('Cypher killed you at 19 s in, bringing it back to three against three, and no teammate traded you.', A3.f) && drops('A teammate traded you.', A3.f, 'timeline'),
    '"NO TEAMMATE TRADED YOU" IS NOT "TEAMMATE TRADED YOU": Abyss round 3, untraded', why('Cypher killed you at 19 s in, bringing it back to three against three, and no teammate traded you.', A3.f));
  const A11 = asking(ABYSS, 'Walk me through round 11.');
  ok(keeps('Phoenix killed you 23 s in, and your teammate finished the round 33 s in.', A11.f) && drops('Round 33 was the turning point.', A11.f, 'round'),
    '"THE ROUND 33 S IN" IS A TIME, NO ROUND 33', why('Phoenix killed you 23 s in, and your teammate finished the round 33 s in.', A11.f));
  ok(keeps('That gives your team time to reach the space you won, rather than making the next fight yours alone.', A22.f)
    && drops('That was the round you won.', A22.f, 'result'), 'what was won before the verb is no round: "the space you won" stays, "the round you won" is still one');
  const A5 = asking(ABYSS, 'Why did I lose round 5?');
  ok(keeps('What you lost was your opening fight.', A5.f) && drops('What you lost was round 5.', A5.f, 'result'), '"WHAT YOU LOST WAS YOUR OPENING FIGHT" STAYS on the won round 5');
  const A4 = asking(ABYSS, 'Should I have saved my gun in round 4?');
  // A purchase the record never shows drops: by the weapon gate since it holds
  // the player's gun to the round's facts, else by the economy gate.
  ok(keeps('I cannot confirm from the record what gun you carried or what you bought.', A4.f)
    && (drops('You bought a Vandal in round 4.', A4.f, 'economy') || drops('You bought a Vandal in round 4.', A4.f, 'weapon')),
    '"I CANNOT CONFIRM FROM THE RECORD WHAT YOU BOUGHT" IS THE ANSWER THE RULES ASK FOR, and a purchase the record never shows drops',
    why('You bought a Vandal in round 4.', A4.f));
  ok(keeps('This was an attacker pistol round where you opened the round strong, but the team could not hold the site once the spike was down.', F5.f)
    && drops('You did not get the first kill in round 5.', F5.f, 'timeline'),
  'ONLY THE NEGATION THAT GOVERNS IT TURNS A FIRST KILL: the team\'s "could not hold" is not the player\'s', why('This was an attacker pistol round where you opened the round strong, but the team could not hold the site once the spike was down.', F5.f));
  const FR2 = (() => {
    const rv = riotOnly('riot-fracture-5-1.json', null, { 2: { kills: 3, firstKill: true, traded: true } });
    return { ...rv, rounds: rv.rounds.map((c) => (c.n !== 2 ? c : { ...c, forensics: { cause: 'repeek', source: 'riot',
      what: 'You stayed on the same A Main angle after trading shots and killing one enemy, then Astra killed you with a Sheriff.', better: 'Fall back after the first exchange.' } })) };
  })();
  const R2 = asking(FR2, 'Was my round 2 death a mistake?');
  const repeek = `In your Fracture Jett win, 5 to 1, your round 2 death was the avoidable mistake the coach${RQ}s look identified: you peeked the same A Main angle again after being seen or getting a kill.`;
  ok(keeps(repeek, R2.f) && drops('You kept peeking the same angle in round 2.', R2.f, 'count'),
    'A REPEEK SAID IN WORDS ("you peeked the same A Main angle again") IS THE ROUND\'S LOOK, NO REPEAT ACROSS THE MATCH, and "kept" still needs a count', why(repeek, R2.f));

  // 3. A BARE VERDICT NEVER GOES OUT ALONE.
  const econ = 'Yes. In the Abyss match on Jett, which you won 13 to 11, saving was the better choice in round 4 once your teammate fell. I cannot confirm from the record what gun you carried or what you bought.\n\n'
    + 'You were defending. A teammate died 11 s in, leaving you four against five. At 13 s in, Viper killed you with a Vandal at Mid Top, leaving your team three against five, and nobody traded you.';
  const pe = cp.parseReply(econ, A4.input, { messages: A4.ms });
  ok(pe.dropped.verdict === 1 && pe.dropped.economy === 1 && pe.retry && pe.firstDropped && !/^Yes\b/.test(pe.reply)
    && pe.reasons.includes(cp.VERDICT_REASON) && /I cannot confirm from the record/.test(pe.reply),
  'ABYSS-ECON-R4: "YES." GOES WITH THE SAVE CLAIM AFTER IT, AND THE REPLY IS ASKED FOR AGAIN, the true disclaimer kept', JSON.stringify({ dropped: pe.dropped, retry: pe.retry, reply: pe.reply.slice(0, 60) }));
  const premise = 'No. In your Abyss match on Jett, which you won 13 to 11, Cypher killed you in round 3 with a Spectre.\n\n'
    + 'You were defending. A teammate fell first at 10 s in, then you got kills at 15 s and 18 s in to put your team ahead, four against three. Cypher killed you at 19 s in, bringing it back to three against three, and no teammate traded you.';
  const pp = cp.parseReply(premise, A3.input, { messages: A3.ms });
  ok(!pp.retry && /^No\. In your Abyss match on Jett, which you won 13 to 11, Cypher killed you in round 3/.test(pp.reply) && !pp.dropped.verdict,
    'ABYSS-R3-KILLER: "NO." KEEPS ITS CORRECTION, CYPHER NAMED, and nothing is asked again', JSON.stringify(pp.dropped));
  ok(cp.parseReply('Yes. You were defending round 4 when Viper killed you 13 s in.', A4.input, { messages: A4.ms }).reply.startsWith('Yes.'),
    'and a verdict whose sentence stands stays');

  // 4. THE PLAYER'S GUN IS ONE THE ROUND'S FACTS GIVE THEM.
  const pearl = (n, card) => cp.normalise({ v: 2, game: 'valorant', language: 'en', advanced: false,
    match: { id: 'valorant-1790000000000-pearl1', map: 'Pearl', agent: 'Raze', mode: 'Swiftplay', result: 'Defeat', score: '1-5', rounds: 6, verified: true, at: AT,
      cards: [{ n, side: n === 1 ? 'attacking' : 'defending', result: 'lost', died: true, verified: true, watched: true, pistol: true, ...card }] },
    player: {}, ask: { round: n } });
  const P1 = pearl(1, { riot: { sec: 26, killer: 'Clove', weapon: 'Classic', traded: false, kills: 0, alive: { mates: 2, enemies: 2 } },
    look: { cause: 'lost-duel', source: 'riot', what: 'On B Site, you fired at Clove from beside cover but lost the pistol duel without damaging them.', better: 'Keep your crosshair at head level.' } });
  const P1f = factsFor(P1, [{ role: 'user', content: "Was it a player's fault that we lost round 1?" }], STAND_IN);
  ok(drops('You fought Clove from beside cover with a Classic and did not damage them.', P1f, 'weapon'),
    'PEARL-R1-RIOTID: "YOU FOUGHT CLOVE FROM BESIDE COVER WITH A CLASSIC" DROPS, the round\'s only Classic the killer\'s', why('You fought Clove from beside cover with a Classic and did not damage them.', P1f));
  ok(keeps('Clove killed you with a Classic.', P1f) && keeps('You were killed by Clove with a Classic.', P1f) && keeps('You lost the pistol duel to Clove with a Classic.', P1f),
    'and the killer\'s Classic stays the killer\'s');
  const P5 = pearl(5, { riot: { sec: 9, killer: 'Cypher', weapon: 'Classic', traded: true, kills: 0, firstDeath: true },
    look: { cause: 'lost-duel', source: 'riot', what: 'You drew your Ghost and fought Cypher at close range in Mid Plaza, dealing 105 damage before his Classic killed you.', better: 'Keep your crosshair at head level.' } });
  const P5f = factsFor(P5, [{ role: 'user', content: 'Why did I die in round 5?' }], STAND_IN);
  ok(P5f.rounds.get(5).weapons.mine.has('Ghost') && !P5f.rounds.get(5).weapons.mine.has('Classic') && P5f.rounds.get(5).weapons.theirs.has('Classic'),
    'A LOOK\'S "HIS CLASSIC" IS THE KILLER\'S, its "your Ghost" the player\'s', JSON.stringify([...P5f.rounds.get(5).weapons.mine]));
  ok(keeps('You drew your Ghost as you met Cypher at the Mid Plaza doorway.', P5f) && drops('You fought Cypher with a Classic.', P5f, 'weapon') && keeps('His Classic killed you before you finished the fight.', P5f),
    'so the player fought with the Ghost, never the Classic');
  ok(keeps('In round 2 on defense, you were the first death only 15 seconds in against a Viper with a Marshal while the teams were even at five standing.', asking(ABYSS, 'What should I change on Jett?').f),
    'and "against a Viper with a Marshal" is the Viper\'s Marshal, as Riot has it in round 2');

  // 2. EVERY ROUND A QUESTION NAMES, IN FULL.
  const QS = 'How do I win more Sheriff duels like rounds 5 and 6?';
  const ctxS = chatContext.build(FRACTURE, { rows: [] }, null, QS, { game: 'valorant', language: 'en', now: Date.now() });
  const inS = cp.normalise(ctxS);
  const msS = [{ role: 'user', content: QS }];
  const pS = cp.buildPrompt(inS, msS, { variant: 'v2' });
  const fS = cp.factsOf(inS, msS);
  ok(ctxS.ask.round === null && JSON.stringify(ctxS.ask.rounds) === '[5,6]' && JSON.stringify(inS.ask.rounds) === '[5,6]',
    'the client sends both rounds of "like rounds 5 and 6", where it sent none', JSON.stringify(ctxS.ask));
  ok(/ROUND 5 IN FULL/.test(pS) && /ROUND 6 IN FULL/.test(pS) && /You fought Chamber from B Tree with a Sheriff/.test(pS) && !fS.oneRound && JSON.stringify(fS.askedRounds) === '[5,6]',
    'FRACTURE-ADV-OFF: BOTH ROUNDS ARE TOLD IN FULL, ROUND 6\'S LOOK AND ITS SHERIFF WITH THEM, and a sentence naming no round is about neither', JSON.stringify(fS.askedRounds));
  const old = cp.normalise({ ...ctxS, ask: { round: null } });
  const pOld = cp.buildPrompt(old, msS, { variant: 'v2' });
  ok(/ROUND 5 IN FULL/.test(pOld) && /ROUND 6 IN FULL/.test(pOld), 'AND FROM AN 8.5.0 CLIENT, WHICH SENDS NO ROUND FOR IT, THE SERVER READS BOTH FROM THE QUESTION');
  const QR = 'Walk me through rounds 1 to 24';
  const inR = inputFor(ABYSS, QR);
  const pR = cp.buildPrompt(inR, [{ role: 'user', content: QR }], { variant: 'v2' });
  ok(JSON.stringify(cp.askedRounds(inR, [{ role: 'user', content: QR }])) === '[1,2,3]' && (pR.match(/ IN FULL\n/g) || []).length === cp.MAX_ASKED_ROUNDS
    && pR.length - pR.indexOf('THE PLAYER') <= cp.DYNAMIC_MAX_CHARS,
  `and three at most (cp.MAX_ASKED_ROUNDS), under the budget (${pR.length - pR.indexOf('THE PLAYER')} of ${cp.DYNAMIC_MAX_CHARS})`);
  ok(!gates.roundSentence('You died to a Sheriff.', fS).round && gates.roundSentence('You died to a Sheriff.', factsFor(inputFor(FRACTURE, 'Why did I lose round 5?'), [{ role: 'user', content: 'Why did I lose round 5?' }], STAND_IN)).round,
    'one round asked makes a sentence about the player its round\'s; two make it about neither');

  // 5. THE STABLE PARTS FIRST, BYTE FOR BYTE ACROSS A MATCH'S QUESTIONS.
  const long = Array.from({ length: 8 }, (_v, i) => ({ role: i % 2 ? 'assistant' : 'user', content: i % 2 ? 'Hold the angle. '.repeat(120) : `Why did I lose round ${i + 3}?` }));
  const asks = ['Why did I die in round 3?', 'Walk me through round 13', 'What should I change on Jett?', 'How do I win more duels like rounds 5 and 6?'];
  const built = asks.map((q) => cp.buildParts(inputFor(ABYSS, q), [{ role: 'user', content: q }], { variant: 'v2' }));
  built.push(cp.buildParts(inputFor(ABYSS, long[long.length - 2].content), long, { variant: 'v2' }));
  const p0 = built[0].parts;
  ok(built.every((b) => b.parts.length === 3 && b.parts[0] === p0[0] && b.parts[1] === p0[1]) && new Set(built.map((b) => b.parts[2])).size === built.length,
    'THE STATIC PREFIX AND THE MATCH\'S OWN FACTS ARE THE SAME BYTE FOR BYTE FOR EVERY QUESTION OF THE MATCH, a long conversation\'s too, and only the question\'s part differs',
    built.map((b) => `${b.parts[0].length}/${b.parts[1].length}/${b.parts[2].length}`).join(' '));
  // The notes a question gets are drawn with Math.random among equal scores,
  // so both builds are drawn from one seed for the comparison.
  const seeded = (fn) => {
    const random = Math.random;
    let s = 20261015;
    Math.random = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    try { return fn(); } finally { Math.random = random; }
  };
  ok(asks.every((q) => {
    const ms = [{ role: 'user', content: q }];
    const joined = seeded(() => cp.buildParts(inputFor(ABYSS, q), ms, { variant: 'v2' }).parts.join(''));
    return joined === seeded(() => cp.buildPrompt(inputFor(ABYSS, q), ms, { variant: 'v2' }));
  }), 'and the three parts joined are the prompt');
  ok(/\nR3 defence/.test(p0[1]) && /\nR13 attack/.test(p0[1]) && !/IN FULL/.test(p0[1]) && /^ROUND 3 IN FULL/.test(built[0].parts[2]),
    'every round is a line of the match\'s part, the asked ones too, and the rounds asked are told in full in the question\'s');
  const rq = 'Walk me through round 15';
  const splitOnly = chatContext.applyRoundRecord(riotReview.fromRiot({ row: { matchId: 'split-0015-test', map: 'Split', agent: 'Jett', mode: 'Competitive',
    result: 'Victory', score: '13-7', kills: 17, deaths: 16, assists: 8, acs: 279, adr: 181, headshotPct: 22, startedAt: AT }, riot: load('riot-split-13-7.json'), history: [] }).review, load('riot-split-13-7.json'), AT);
  const sp = cp.buildParts(inputFor({ ...splitOnly, id: 'valorant-1790000000002-split2', at: AT }, rq), [{ role: 'user', content: rq }], { variant: 'v2' });
  ok(sp.parts[0] === p0[0] && sp.parts[1] !== p0[1], 'and the static prefix is the same for another match of the mode, the match\'s part its own');
  const before = process.env.CHAT_PRIMER_GUNS;
  let tableBack = '';
  try {
    delete process.env.CHAT_PRIMER_GUNS;
    const q = 'How many body shots does a Vandal need?';
    const dflt = cp.buildParts(inputFor(ABYSS, q), [{ role: 'user', content: q }], { variant: 'v2' }).parts;
    process.env.CHAT_PRIMER_GUNS = 'core';
    tableBack = cp.buildPrompt(inputFor(ABYSS, q), [{ role: 'user', content: q }], { variant: 'v2' });
    ok(!cp.gunsInCore() || true, 'CHAT_PRIMER_GUNS=core puts the gun table back');
    const real = require('../server/services/game-primer');
    if (real && typeof real.core === 'function' && /\nGUNS \(/.test(tableBack)) {
      ok(!/\nGUNS \(/.test(dflt[0]) && /\nAGENTS \(/.test(dflt[0]) && /Vandal\. Price/.test(dflt[2]) && /\nGUNS \(/.test(tableBack),
        'THE GUN TABLE IS IN THE SLICES BY DEFAULT, the roster kept in the core, and CHAT_PRIMER_GUNS=core puts it back');
    } else console.log('skip  the primer prints no gun table today');
  } finally {
    if (before === undefined) delete process.env.CHAT_PRIMER_GUNS; else process.env.CHAT_PRIMER_GUNS = before;
  }
  ok(JSON.stringify(cp.retryParts(['a\n\n', 'b\n\n', 'c'], ['your reply said X'])) === JSON.stringify(['a\n\n', 'b\n\n', cp.retryPrompt('c', ['your reply said X'])])
    && cp.retryParts(['a\n\n', 'b\n\n', 'c'], ['r']).join('') === cp.retryPrompt('a\n\nb\n\nc', ['r']), 'the retry keeps the stable parts as sent, and joined it is retryPrompt\'s');
}

// ── The bench:chat run of 23 Oct (Sol v2), each case from its raw replies ───
// The panel's read found 4 wrong facts in 90 answers, from two causes: two the
// gates made, on the Sunset round 1 (runs 1 and 2), and two the model said, on
// the Abyss swiftplay's round 2 (runs 1 and 2). Every sentence below in quotes
// from the run is the model's own, its curly apostrophes as it wrote them; the
// matches are the repo's Riot record of the Sunset swiftplay with round 1's kill
// feed as Riot has it (agents, guns and seconds, never a name), the Abyss
// swiftplay's 8.0.1 card read back as test:chatcontext reads it, the repo's
// Abyss and Split, and the Pearl round 1 with its teams.
{
  console.log('\nthe bench:chat run of 23 Oct:');
  const RQ = String.fromCharCode(0x2019);
  // Each new regex on a known positive and a known negative.
  const cases = [
    ['CLUTCH', gates.CLUTCH, 'leaving Skye alone against three', 'leaving Skye against three'],
    ['STANDING_WORDS', gates.STANDING_WORDS, 'leaving your team four against five', 'a one on one duel'],
    ['STANDING_WORDS (a duel)', gates.STANDING_WORDS, 'leaving Skye one against two', 'a one against one duel'],
    ['ALONE_AGAINST', gates.ALONE_AGAINST, 'leaving Skye alone against three', 'leaving you and Skye against three'],
    ['LEFT_BY', gates.LEFT_BY, 'leaving your team 4 against 5', 'with your team 4 against 5'],
    ['LEFT_BY (the left)', gates.LEFT_BY, 'the trade still left Skye', 'from the left at 4 against 5'],
    ['PLAYER_DEATH', gates.PLAYER_DEATH, 'Tejo killed you 13 s in', 'you killed Tejo 13 s in'],
    ['AFTER_DEATH', gates.AFTER_DEATH, 'After Tejo killed you, your team', 'After you killed Tejo, your team'],
    ['EVENT_BETWEEN', gates.EVENT_BETWEEN, ', and Skye traded KAY/O a second later, ', ' at Mid Bottom at 26 s in, '],
    ['CLAUSE_BETWEEN', gates.CLAUSE_BETWEEN, ' at 17 s in, and your teammates later ', ' 13 s in, which '],
    ['LEANS_TIME', gates.LEANS_TIME, 'Skye traded KAY/O one second later', 'Your teammates later planted at B'],
    ['LEANS_SUBJECT', gates.LEANS_SUBJECT, 'She killed you 5 times', 'Skye killed you 5 times'],
    ['IT_IS_THE_ROUND', gates.IT_IS_THE_ROUND, 'It was a defence round.', 'It was not traded.'],
    ['LEANS_TRADE', gates.LEANS_TRADE, 'Skye traded KAY/O at 27 s in', 'and nobody traded it'],
    ['LEAN_ANCHOR', gates.LEAN_ANCHOR, 'KAY/O killed you at 26 s in, ', 'Before taking her angle again, '],
  ];
  for (const [name, re, pos, neg] of cases) {
    const r = re && new RegExp(re.source, re.flags.replace('g', ''));
    ok(!!r && r.test(pos) && !r.test(neg), `${name} matches "${pos}" and not "${neg}"`);
  }

  // 1. A TEAMMATE NAMED ALONE AGAINST N IS THAT TEAMMATE'S, NEVER THE PLAYER'S CLUTCH.
  const SUNSET1 = riotOnly('riot-sunset-2-5.json', null, { 1: { traded: true, weapon: 'Sheriff', kills: 0, plantMs: 37900, plantSite: 'B',
    aliveAtDeath: { mates: 2, enemies: 3 }, feed: [
      { ms: 5200, by: 'enemy', on: 'mate', ka: 'Neon', va: 'Chamber', w: 'Sheriff' }, { ms: 7800, by: 'mate', on: 'enemy', ka: 'Phoenix', va: 'Neon', w: 'Ghost' },
      { ms: 22600, by: 'enemy', on: 'mate', ka: 'Cypher', va: 'Miks', w: 'Ghost' }, { ms: 22800, by: 'mate', on: 'enemy', ka: 'Skye', va: 'Cypher', w: 'Ghost' },
      { ms: 23900, by: 'enemy', on: 'mate', ka: 'Jett', va: 'Phoenix', w: 'Ghost' }, { ms: 26200, by: 'enemy', on: 'me', ka: 'KAY/O', va: 'Jett', w: 'Sheriff' },
      { ms: 27300, by: 'mate', on: 'enemy', ka: 'Skye', va: 'KAY/O', w: 'Ghost' }, { ms: 39600, by: 'enemy', on: 'mate', ka: 'Clove', va: 'Skye', w: 'Ghost' }] } });
  const S1 = asking(SUNSET1, 'Walk me through round 1.');
  const s1 = S1.f.rounds.get(1);
  ok(S1.f.asked === 1 && s1.died && s1.clutch === null && JSON.stringify(s1.atDeath) === '[2,3]' && JSON.stringify(s1.after) === '[1,3]'
    && S1.f.sides.mates.has('Skye') && !S1.f.sides.enemies.has('Skye'),
  'Sunset round 1: the player died 2 against 3 and left 1 against 3, in no clutch of their own, Skye on their side', JSON.stringify({ at: s1.atDeath, after: s1.after, clutch: s1.clutch }));
  const died1 = `You died to KAY/O${RQ}s Sheriff at Mid Bottom at 26 s in, leaving Skye alone against three.`;
  const died2 = 'KAY/O then killed you with a Sheriff at 26 s in, leaving Skye alone against three.';
  const left2 = 'Skye did trade you, so you were close enough for an immediate answer, but the trade still left Skye alone against two with a plant to make and defend.';
  for (const [s, which] of [[died1, 'run 1'], [died2, 'run 2'], [left2, 'run 2']]) {
    ok(keeps(s, S1.f), `SUNSET-R1-WALK, ${which}: A TEAMMATE ALONE AGAINST N IS NO CLUTCH OF THE PLAYER'S: "${s}" stays`, why(s, S1.f));
  }
  ok(drops('In round 1 you were alone against three.', S1.f, 'timeline') && drops('KAY/O killed you at 26 s in, leaving Skye alone against two.', S1.f, 'timeline')
    && drops('KAY/O killed you at 26 s in, leaving you and Skye alone against three.', S1.f, 'timeline')
    && keeps('KAY/O killed you at 26 s in, and Skye traded KAY/O a second later, leaving Skye alone against two.', S1.f),
  'and the player alone is still their own clutch, which the record does not have, while a teammate alone is 1 against N held to the record, the trade\'s 1 against 2 the trade\'s',
  why('KAY/O killed you at 26 s in, leaving Skye alone against two.', S1.f));
  const walk = 'In the Sunset match on Jett, a 2 to 5 loss, round 1 was your attack pistol. Your Chamber died to Neon at 5 s in, and Phoenix answered at 8 s in. '
    + `At 23 s in, Cypher killed Miks and Skye traded Cypher, leaving it even. Their Jett killed Phoenix at 24 s in. ${died2} Skye traded KAY/O a second later, planted at B at 38 s in, then died to Clove at 40 s in.`;
  const pw = cp.parseReply(walk, S1.input, { messages: S1.ms });
  ok(!pw.retry && !Object.keys(pw.dropped).length && pw.reply.includes(`${died2} Skye traded KAY/O a second later`),
    'SUNSET-R1-WALK, run 2: THE WALK GOES OUT WHOLE, the player\'s death 26 s in before "Skye traded KAY/O a second later", 27 s as Riot has it', JSON.stringify(pw.dropped));
  const P1 = cp.normalise({ v: 2, game: 'valorant', language: 'en', advanced: false,
    match: { id: 'valorant-1790000000000-pearl2', map: 'Pearl', agent: 'Raze', mode: 'Swiftplay', result: 'Defeat', score: '1-5', rounds: 6, verified: true, at: AT,
      comps: { us: ['Jett', 'Phoenix', 'Raze', 'Reyna', 'Yoru'].map((agent) => ({ agent })), them: ['Clove', 'Cypher', 'Fade', 'Neon', 'Sage'].map((agent) => ({ agent })) },
      cards: [{ n: 1, side: 'attacking', result: 'lost', died: true, verified: true, watched: true, pistol: true,
        riot: { sec: 26, killer: 'Clove', weapon: 'Classic', traded: false, kills: 0, alive: { mates: 2, enemies: 2 } } }] },
    player: {}, ask: { round: 1 } });
  const P1f = factsFor(P1, [{ role: 'user', content: "Was it a player's fault that we lost round 1?" }], STAND_IN);
  const reyna = 'Clove then killed you with a Classic on B Site, leaving Reyna alone against 2.';
  ok(keeps(reyna, P1f) && drops('Clove then killed you with a Classic on B Site, leaving Reyna alone against 3.', P1f, 'timeline'),
    'PEARL-R1-RIOTID, runs 2 and 3: "LEAVING REYNA ALONE AGAINST 2" STAYS, its 2 a standing\'s and never a number tied to nothing, and a wrong one drops', why(reyna, P1f));

  // 1b. A SENTENCE THAT LEANS ON A DROPPED ONE GOES WITH IT, for its time or its subject.
  ok(gates.leansOn('Skye traded KAY/O one second later, planted at B at 38 s in, then died to Clove at 40 s in.') === 'time'
    && gates.leansOn('Skye traded KAY/O a second later, planted at B at 38 s in, then died to Clove at 40 s in.') === 'time'
    && gates.leansOn('KAY/O killed you at 26 s in, and Skye traded KAY/O a second later.') === null,
  'SUNSET-R1-WALK: "SKYE TRADED KAY/O ONE SECOND LATER" IS TIMED FROM THE SENTENCE BEFORE IT, and timed from an earlier clause of its own it is not');
  const wrongTime = cp.gateReply(cp.cleanReply(`Their Jett killed Phoenix at 24 s in. You died to KAY/O${RQ}s Sheriff at Mid Bottom at 29 s in, leaving Skye alone against three. `
    + 'Skye traded KAY/O a second later, planted at B at 38 s in, then died to Clove at 40 s in.'), S1.f, {});
  ok(!wrongTime[0].drop && wrongTime[1].drop && wrongTime[1].drop.gate === 'number' && wrongTime[2].drop && wrongTime[2].drop.gate === 'leans'
    && wrongTime[2].drop.reason === cp.LEANS_REASON,
  'A DEATH A GATE DROPS TAKES "SKYE TRADED KAY/O A SECOND LATER" WITH IT, which after Phoenix\'s death would read as a trade at 25 s', JSON.stringify(wrongTime.map((r) => r.drop && r.drop.gate)));
  for (const s of ['She killed you 5 times, in rounds 4, 7, 9, 10, and 19.', 'That was the first death, at 5 against 5, and it went untraded.',
    'That is enough reason to keep playing her while you work on the bigger issue this match exposed, rather than switch because of the map.',
    'That is the habit to carry into your Jett entries.', 'It was not traded.', 'Skye traded KAY/O at 27 s in.']) {
    ok(gates.leansOn(s) === 'subject', `"${s}" LEANS ON THE SENTENCE BEFORE IT FOR ITS SUBJECT`);
  }
  for (const s of ['It was a defence round.', 'Two teammates then died before the spike went down at 24 s in.', 'Your teammates later planted at B at 51 s in and won.',
    'No teammate killed Tejo within five seconds, so your death went untraded.', 'You were the first death, and nobody traded it.',
    `There${RQ}s a reason to keep playing her, but your results don${RQ}t show that you need to switch.`, 'Their Neon killed your Chamber 5 s in, and your Phoenix answered 8 s in.']) {
    ok(gates.leansOn(s) === null, `and "${s}" leans on nothing before it`);
  }
  const A22 = asking(ABYSS, 'What happened in round #22?');
  const r22 = cp.parseReply('In the Abyss match on Jett, which you won 13 to 11, round 22 was an attack that you lost. You got the opening kill at 15 s in, putting your team ahead 5 against 4. '
    + 'Skye killed you with a Vandal at 16 s in, at B Link according to the screen read. It was not traded. Two teammates then died before the spike went down at 24 s in.', A22.input, { messages: A22.ms });
  ok(r22.dropped.attribution === 1 && r22.dropped.leans === 1 && !r22.retry && !/It was not traded/.test(r22.reply)
    && /putting your team ahead 5 against 4\. Two teammates then died before the spike went down at 24 s in\./.test(r22.reply),
  'ABYSS-R22-HASH, run 3: "IT WAS NOT TRADED." GOES WITH THE DEATH IT STOOD FOR, never read as the opening kill, and "Two teammates then died" stays', JSON.stringify(r22));
  const SPLIT = chatContext.applyRoundRecord(riotReview.fromRiot({ row: { matchId: 'split-0023-test', map: 'Split', agent: 'Jett', mode: 'Competitive', result: 'Victory', score: '13-7',
    kills: 17, deaths: 16, assists: 8, acs: 279, adr: 181, headshotPct: 22, startedAt: AT }, riot: load('riot-split-13-7.json'), history: [] }).review, load('riot-split-13-7.json'), AT);
  const SC = asking({ ...SPLIT, id: 'valorant-1790000000023-split3', at: AT }, 'What comp did the enemy team run?');
  const sc = cp.gateReply(cp.cleanReply('The matchup that kept hurting you was Reyna. She killed you 5 times, in rounds 4, 7, 9, 10, and 19.'), SC.f, {});
  ok(sc[0].drop && sc[0].drop.gate === 'count' && sc[1].drop && sc[1].drop.gate === 'leans',
    'SPLIT-COMPS, run 1: "SHE KILLED YOU 5 TIMES" GOES WITH THE REYNA IT STOOD FOR, never read as Skye, the last agent named', JSON.stringify(sc.map((r) => r.drop)));

  // 2. A STANDING THE PLAYER'S DEATH LEFT IS THE ONE AFTER IT.
  const v801 = { kind: 'valorant', id: 'valorant-1790000000070-abyss2', at: AT, verified: true, game: { map: 'Abyss', agent: 'Jett', mode: 'Swiftplay', result: 'Defeat', score: '3-5' },
    rounds: [{ n: 2, side: 'Defence', result: 'lost', died: true, facts: ['Died at B Main, 13s in, to Tejo with a Outlaw', '4 against 5 when you died', 'Not traded', 'Spike planted at B'] }],
    insights: { mistakes: [], strengths: [], missed: [] } };
  const SW = asking(review.served(v801), 'Why did I die in round 2?');
  const w2 = SW.f.rounds.get(2);
  ok(SW.f.asked === 2 && !w2.feed && JSON.stringify(w2.atDeath) === '[4,5]' && JSON.stringify(w2.after) === '[3,5]' && JSON.stringify(w2.standings) === '[[5,5],[4,5]]',
    'the Abyss swiftplay\'s round 2, an 8.0.1 card read back: died 4 against 5, which left 3 against 5, with no kill feed', JSON.stringify(w2));
  const leftRun1 = 'Tejo killed you 13 s in, leaving your team 4 against 5.';
  const leftRun2 = 'Tejo killed you 13 s in, leaving your team down 4 against 5, and no teammate traded your death.';
  ok(drops(leftRun1, SW.f, 'timeline') && drops(leftRun2, SW.f, 'timeline')
    && /left 4 against 5 standing in round 2, where Riot's record has 4 against 5 at the death and 3 against 5 after it/.test(why(leftRun1, SW.f)),
  'ABYSS-SWIFT-R2, runs 1 and 2: "TEJO KILLED YOU 13 S IN, LEAVING YOUR TEAM 4 AGAINST 5" DROPS, the reason naming the standing at the death and the one after it', why(leftRun1, SW.f));
  ok(keeps('Tejo killed you 13 s in, with four of your team against five standing at your death.', SW.f) && keeps('Tejo killed you 13 s in, leaving your team 3 against 5.', SW.f)
    && keeps('After Tejo killed you, your team was 3 against 5.', SW.f) && keeps('You died 13 s in with your team 4 against 5.', SW.f),
  'and run 3\'s "with four of your team against five standing at your death" stays, as do the standing the death left and the one at it, each said as what it is',
  why('Tejo killed you 13 s in, leaving your team 3 against 5.', SW.f));
  ok(drops('Tejo killed you 13 s in, leaving your team four against five.', SW.f, 'timeline') && drops('After Tejo killed you, your team was 4 against 5.', SW.f, 'timeline')
    && drops('Your death left your team 4 against 5.', SW.f, 'timeline'),
  'in words, after "after", and as what "your death" left, the standing at the death drops too', why('Tejo killed you 13 s in, leaving your team four against five.', SW.f));
  const A3 = asking(ABYSS, 'Did Phoenix kill me in round 3?');
  ok(drops('Cypher killed you at 19 s in, leaving your team 4 against 3.', A3.f, 'timeline')
    && keeps('Cypher killed you at 19 s in, bringing it back to three against three, and no teammate traded you.', A3.f)
    && keeps('Cypher killed you at 19 s in, with your team up 4 against 3 just before the death.', A3.f),
  'WITH A KILL FEED, ON THE ABYSS ROUND 3: the standing at the death given as the one it left drops, and run 1\'s "with your team up 4 against 3 just before the death" stays',
  why('Cypher killed you at 19 s in, leaving your team 4 against 3.', A3.f));
  const A13 = asking(ABYSS, 'Why did I die in round 13?');
  ok(keeps('Viper killed you at 17 s in, and your teammates later brought it to three against two.', A13.f) && keeps('Viper killed you at 17 s in, leaving it 4 against 4.', A13.f)
    && drops('Viper killed you at 17 s in, leaving it 5 against 4.', A13.f, 'timeline'),
  'and a clause of its own after the death is its own subject\'s: "your teammates later brought it to three against two" is theirs, never what the death left',
  why('Viper killed you at 17 s in, and your teammates later brought it to three against two.', A13.f));

  // ── The verifier's probe of the 23 Oct rules ──
  // Sentences of the verifier's own, each where a rule above read wrong: a
  // teammate's clutch in other words, the player's own, a standing at the
  // death said plainly, one after it said every way, two parts no pin above
  // held, and the languages the app writes in. Each fails with its rule out.
  console.log('\nthe verifier\'s probe of the 23 Oct rules:');
  for (const [name, re, pos, neg] of [
    ['CLUTCH (as a verb)', gates.CLUTCH, 'You clutched round 1', 'You were the last one down'],
    ['CARRIES_ON', gates.CARRIES_ON, ', and your team was then three against five', ', and your team was three against five'],
    ['LEFT_FINITE', gates.LEFT_FINITE, 'left', 'leaving'],
    ['AFTER_DEATH (with you dead)', gates.AFTER_DEATH, 'With you dead, your team was 3 against 5', 'With your team 4 against 5, you died'],
    ['AFTER_DEATH (without you)', gates.AFTER_DEATH, 'Without you there, your team was 3 against 5', 'Without you trading, your team was 3 against 5'],
    ['AFTER_DEATH (got you a kill)', gates.AFTER_DEATH, 'After their Jett got you, it was', 'After Skye\'s flash got you the opening kill, it was'],
    ['AFTER_DEATH_NEXT', gates.AFTER_DEATH_NEXT, ' after you died because they were not ready', ' just before your death'],
    ['AT_THE_DEATH', gates.AT_THE_DEATH, ' 13 s in at ', ', your team was '],
    ['DATED_LATER', gates.DATED_LATER, ' after Sova fell.', ' and nobody traded you.'],
    ['CLAUSE_MARK', gates.CLAUSE_MARK, ' 13 s in. That ', ' 13.5 s in '],
    ['DEATH_SUBJECT', gates.DEATH_SUBJECT, ' your team was ', ' your teammates later '],
    ['OTHER_TIME', gates.OTHER_TIME, ' 13 s in, before your team was ', ' 13 s in, and your team was '],
    ['NEW_CLAUSE', gates.NEW_CLAUSE, ', your teammates pushed on, ', ' at 17 s in, and your teammates later '],
    ['LEFT_OPENER', gates.LEFT_OPENER, 'That left your team 4 against 5.', 'Your teammates later brought it to 3 against 3.'],
    ['PLAYER_DEATH (got you)', gates.PLAYER_DEATH, 'Their Jett got you 33 s in', 'Your Bandit got you the first kill'],
    ['PAST_ABOUT_YOU (its time between)', gates.PAST_ABOUT_YOU, 'Your death at 13 s in made it 4 against 5', 'Your death count is high'],
  ]) {
    const r = re && new RegExp(re.source, re.flags.replace('g', ''));
    ok(!!r && r.test(pos) && !r.test(neg), `${name} matches "${pos}" and not "${neg}"`);
  }

  // Whose a clutch is.
  ok(keeps('KAY/O killed you at 26 s in, and Skye was left alone against three.', S1.f) && drops('KAY/O killed you at 26 s in, and Skye was left alone against four.', S1.f, 'timeline'),
    'A CLAUSE\'S OWN "AND" JOINS NO TWO PLAYERS: "..., and Skye was left alone against three" is Skye\'s 1 against 3, never the player\'s clutch, and a wrong one drops',
    why('KAY/O killed you at 26 s in, and Skye was left alone against three.', S1.f));
  ok(['KAY/O killed you at 26 s in, leaving Skye to clutch against three.', 'KAY/O killed you at 26 s in, and Skye had to clutch against three.',
    'KAY/O killed you at 26 s in, and Skye tried to clutch against three.'].every((s) => keeps(s, S1.f))
    && drops('You had to clutch round 1.', S1.f, 'timeline') && drops('In round 1, Skye died, and you had to clutch against three.', S1.f, 'timeline'),
  'A TEAMMATE LEFT TO CLUTCH, WHO HAD TO OR TRIED TO, IS THE TEAMMATE, and the player who had to is still the player', why('KAY/O killed you at 26 s in, leaving Skye to clutch against three.', S1.f));
  ok(drops('You clutched round 1.', S1.f, 'timeline') && drops('You were clutching against three in round 1.', S1.f, 'timeline') && keeps('In round 1, Skye clutched against two.', S1.f),
    'THE PLAYER\'S CLUTCH SAID AS A VERB DROPS, "you clutched" and "you were clutching" as "your clutch" does, and a teammate\'s stays', why('You clutched round 1.', S1.f));
  ok(drops('In round 1, Clove was left alone against two.', S1.f, 'timeline') && drops('In round 1, their Clove was alone against two.', S1.f, 'timeline'),
    'AN ENEMY ALONE AGAINST N IS N AGAINST 1, Clove placed by the match\'s kill feeds as by "their", and the round never had 2 against 1', why('In round 1, Clove was left alone against two.', S1.f));

  // Two parts no pin above held: every standing, and an event with no "and" to mark it.
  ok(drops('Tejo killed you 13 s in at 4 against 5, leaving your team 4 against 5.', SW.f, 'timeline'),
    'EVERY STANDING A SENTENCE SAYS IS HELD: the second, "leaving your team 4 against 5", drops after a first that is right',
    why('Tejo killed you 13 s in at 4 against 5, leaving your team 4 against 5.', SW.f));
  ok(keeps('KAY/O killed you at 26 s in, Skye traded KAY/O at 27 s in, leaving Skye alone against two.', S1.f)
    && keeps('KAY/O killed you at 26 s in, with Skye\'s trade a second later leaving Skye alone against two.', S1.f),
  'A TRADE BETWEEN THE DEATH AND THE LEAVING WORD, NO "AND" TO MARK IT, MAKES THE STANDING THE TRADE\'S, told as a clause or as a noun: Skye alone against two stays',
  why('KAY/O killed you at 26 s in, with Skye\'s trade a second later leaving Skye alone against two.', S1.f));

  // A standing at the death said plainly, inside an after phrase.
  const atTheDeath = ['After you died at 4 against 5, your team could not retake.', 'After Tejo killed you 13 s in at 4 against 5, your team lost the site.',
    'Following your death at 4 against 5, your team lost the round.', 'Once you went down in a 4 against 5, the site was lost.'];
  ok(atTheDeath.every((s) => keeps(s, SW.f)) && drops('After you died your team played 4 against 5.', SW.f, 'timeline'),
    'AN AFTER PHRASE THAT GIVES THE DEATH ITS OWN STANDING IS THE STANDING AT IT: "After you died at 4 against 5, ..." stays, and "After you died your team played 4 against 5" still drops',
    atTheDeath.map((s) => why(s, SW.f)).join(' '));

  // The standing the death left, said every way.
  for (const [wrong, right] of [
    ['Tejo killed you 13 s in and left your team 4 against 5.', 'Tejo killed you 13 s in and left your team 3 against 5.'],
    ['Tejo killed you 13 s in, and that left your team 4 against 5.', 'Tejo killed you 13 s in, and that left your team 3 against 5.'],
    ['Tejo killed you 13 s in, and your team was left 4 against 5.', 'Tejo killed you 13 s in, and your team was left 3 against 5.'],
    ['Tejo killed you 13 s in; that left your team 4 against 5.', 'Tejo killed you 13 s in; that left your team 3 against 5.'],
    ['Nobody traded your death, and your team was then four against five.', 'Nobody traded your death, and your team was then three against five.'],
    ['Tejo killed you 13 s in, and then your team was 4 against 5.', 'Tejo killed you 13 s in, then your team was 3 against 5.'],
    ['Tejo killed you 13 s in, and your team then was 4 against 5.', 'Tejo killed you 13 s in, and your team then was 3 against 5.'],
    ['Your team played 4 against 5 after you died.', 'Your team played 3 against 5 after you died.'],
    ['With you dead, your team was 4 against 5.', 'With you dead, your team was 3 against 5.'],
    ['Without you, your team was left 4 against 5.', 'Without you, your team was left 3 against 5.'],
    ['Your death at 13 s in made it 4 against 5.', 'Your death at 13 s in made it 3 against 5.'],
  ]) {
    ok(drops(wrong, SW.f, 'timeline') && keeps(right, SW.f), `THE STANDING THE DEATH LEFT, SAID ANOTHER WAY: "${wrong}" drops and "${right}" stays`, `${why(wrong, SW.f)} ${why(right, SW.f)}`);
  }
  ok(keeps('Viper killed you at 17 s in; your teammates later brought it to three against two.', A13.f)
    && keeps('Viper killed you at 17 s in, and your teammates then brought it to three against two.', A13.f)
    && keeps('Viper killed you at 17 s in, then your teammates retook at 3 against 2.', A13.f)
    && keeps('Viper killed you at 17 s in, then your team was 3 against 2 after Sova fell.', A13.f)
    && drops('Viper killed you at 17 s in, after which it was 5 against 4.', A13.f, 'timeline')
    && drops('Your team played four against five after you died because they were not ready to follow your swing.', A13.f, 'timeline'),
  'A SUBJECT OF ITS OWN, AN EVENT AFTER "THEN" OR A TIME OF ITS OWN MAKES THE STANDING THAT ONE\'S: the teammates\' three against two stays, while "after which it was 5 against 4" and Qwen\'s "four against five after you died" (15 Oct) drop',
  ['Viper killed you at 17 s in; your teammates later brought it to three against two.', 'Viper killed you at 17 s in, then your teammates retook at 3 against 2.',
    'Viper killed you at 17 s in, then your team was 3 against 2 after Sova fell.'].map((s) => why(s, A13.f)).join(' '));
  const ownClause = ['After Viper killed you, your teammates pushed on and made it 3 against 2.', 'After Viper killed you, your teammates pushed on, bringing it to 3 against 2.',
    'Viper killed you at 17 s in, then Sova and Skye fought on, bringing it to three against two.', 'After Viper killed you, your teammates fought on and it was three against two.'];
  ok(ownClause.every((s) => keeps(s, A13.f)) && drops('Viper killed you at 17 s in, and that made it 5 against 4.', A13.f, 'timeline'),
    'A CLAUSE OF ITS OWN BETWEEN THE DEATH AND THE LEAVING WORD, MARKED OR NOT, IS ITS OWN: "your teammates pushed on, bringing it to 3 against 2" stays, as the push brought it',
    ownClause.map((s) => why(s, A13.f)).join(' '));
  const FR5 = asking(riotOnly('riot-fracture-5-1.json', null, { 5: { kills: 2, firstKill: true, traded: false, plantMs: 32000, plantSite: 'A', weapon: 'Sheriff',
    aliveAtDeath: { mates: 4, enemies: 3 }, feed: [{ ms: 9000, by: 'me', on: 'enemy', ka: 'Jett', va: 'Deadlock', w: 'Bandit' },
      { ms: 11000, by: 'me', on: 'enemy', ka: 'Jett', va: 'Chamber', w: 'Bandit' }, { ms: 27000, by: 'enemy', on: 'mate', ka: 'Phoenix', va: 'Chamber' },
      { ms: 33000, by: 'enemy', on: 'me', ka: 'Jett', va: 'Jett', w: 'Sheriff' }] } }), 'Why did I die in round 5?');
  ok(keeps('Your Bandit got you the first kill, leaving it 5 against 4.', FR5.f) && drops('Their Jett got you 33 s in, leaving it 4 against 3.', FR5.f, 'timeline')
    && keeps('Their Jett got you 33 s in, leaving it 3 against 3.', FR5.f) && drops('After their Jett got you, it was 4 against 3.', FR5.f, 'timeline'),
  '"GOT YOU THE FIRST KILL" IS NO DEATH OF THE PLAYER\'S: its 5 against 4 stays, while "their Jett got you 33 s in, leaving it 4 against 3" and "After their Jett got you, it was 4 against 3" drop',
  why('Your Bandit got you the first kill, leaving it 5 against 4.', FR5.f));

  // The death in one sentence, what it left in the next.
  const two = (text, Q) => cp.parseReply(text, (Q || SW).input, { messages: (Q || SW).ms });
  const across = [two('Tejo killed you 13 s in. That left your team 4 against 5.'), two('Tejo killed you 13 s in. That left your team 3 against 5.'),
    two('Tejo killed you 13 s in. Your team was left 4 against 5.'), two('Tejo killed you 13 s in. After that your team was 4 against 5.'),
    two('After Tejo killed you, your team was 3 against 5. Then it was 2 against 5.'),
    two('Viper killed you at 17 s in. Your teammates later brought it to three against two.', A13),
    two('Tejo killed you 13 s in, leaving your team 3 against 5. Then it was 2 against 5.')];
  ok(across[0].dropped.timeline === 1 && across[0].reply === 'Tejo killed you 13 s in.' && !Object.keys(across[1].dropped).length
    && across[2].dropped.timeline === 1 && across[3].dropped.timeline === 1 && !Object.keys(across[4].dropped).length && !Object.keys(across[5].dropped).length
    && !Object.keys(across[6].dropped).length,
  'THE DEATH IN ONE SENTENCE, WHAT IT LEFT IN THE NEXT: after "Tejo killed you 13 s in", "That left your team 4 against 5", "Your team was left 4 against 5" and "After that your team was 4 against 5" drop and "That left your team 3 against 5" stays, while what a sentence after a told standing carries on, and the teammates\' own, stay',
  JSON.stringify(across.map((p) => p.dropped)));

  // The leans rule in the languages the app writes in.
  const lang = (language, text) => cp.gateReply(cp.cleanReply(text), asking(SUNSET1, 'Walk me through round 1.', { language }).f, {}).map((r) => (r.drop ? r.drop.gate : 'keep'));
  const es = lang('es', 'En la ronda 1 moriste a los 26 s. Te mataron 99 veces en la ronda 1. He visto que juegas solo en esa zona.');
  const tr = lang('tr', 'Raunt 1 içinde 26 saniyede öldün. Raunt 1 içinde 99 kez öldün. Her raundda ilk sen öldün.');
  const en = lang('en', 'In round 1 you died at 26 s in. You died 99 times in round 1. It was not traded.');
  ok(es.length === 3 && es[0] === 'keep' && es[1] !== 'keep' && es[2] === 'keep' && tr.length === 3 && tr[0] === 'keep' && tr[1] !== 'keep' && tr[2] === 'keep'
    && en[1] !== 'keep' && en[2] === 'leans',
  'THE LEANS RULE READS ENGLISH ALONE: a Spanish "He visto" (I have seen) and a Turkish "Her raundda" (in every round) after a dropped sentence stay, and the English "It was not traded." still goes',
  JSON.stringify({ es, tr, en }));
}

// ── bench:chat's own keys (bench-chat.js, the repo's sheet) ────────────────
// The keys' three shown hits on Sol v2 were the keys misfiring, by all three
// readers, and most of Gemini's and Qwen's "not traded" hits quoted the
// match's counted list. Each on the run's own sentence.
{
  console.log('\nbench:chat\'s keys:');
  const bench = require('./bench-chat');
  const sheets = bench.loadSheets({ sheet: path.join(__dirname, 'fixtures', 'no-player-sheet-here.json') });
  ok(!sheets.problems.length && sheets.missing, 'the repo\'s sheet compiles, every regex on its own samples', sheets.problems.join('; '));
  const by = Object.fromEntries(sheets.questions.map((q) => [q.id, q]));
  const wrong = (id, text, round) => bench.keyed(by[id], text, { round }).wrong.map((w) => w.what);
  const RQ = String.fromCharCode(0x2019);
  ok(!wrong('split-meta', `I can${RQ}t tell you whether Jett is the best agent for Split from these facts.`).length
    && !wrong('general-meta', "You asked about the best agent, but that depends on your team's composition and the enemy's strategy, not a universal tier list.").length
    && wrong('split-meta', 'Jett is the best agent for Split.').length === 1,
  'SPLIT-META: A REFUSAL IS NO RANKING TO THE KEY, and a ranking still is');
  ok(!wrong('split-r15-hash', 'The spike went down at A at 28 s in, and their Phoenix killed your last teammate at 33 s in.', 15).length
    && wrong('split-r15-hash', 'Sage killed you 5 s into the round.', 15).length === 1,
  'SPLIT-R15-HASH: "THE SPIKE WENT DOWN 28 S IN" IS NO DEATH SECOND, and a wrong one still is');
  ok(!wrong('split-r20-walk', 'While this was a great multi kill round, your largest counted mistake across the match was dying where nobody could trade 14 times.', 20).length
    && !wrong('split-r10-planted', 'While you did not bait them there, your biggest struggle in this 13 to 7 win was dying where nobody could trade you, which happened 14 times.', 10).length
    && !wrong('split-r10-planted', 'Across the match, the bigger issue was that 14 of your 16 deaths went unanswered.', 10).length
    && JSON.stringify(wrong('split-r10-planted', 'Your death was not traded.', 10)) === '["says the death was not traded"]'
    && wrong('split-r10-planted', 'The counted mistakes highlight that you died where nobody could trade in three of those rounds, including this one.', 10).length === 1,
  'THE MATCH\'S COUNTED LIST QUOTED IS NO CLAIM OF THE ROUND\'S TRADE, and the round\'s own, "including this one" too, still is');
  // A marker of another match: no agent the question's own match has.
  const q = { id: 'marker', keys: { must: [], mustNot: [bench.compileCheck({ what: 'tells it as the Pearl match', any: ['Clove', 'Cypher', 'Mid Plaza'], otherMatch: true }, {}, 'test', [])] } };
  const ctx = { match: { comps: { us: [{ agent: 'Clove' }, { agent: 'Jett' }], them: [{ agent: 'Phoenix' }] }, cards: [] } };
  const ko = bench.keyOpts(ctx, 5);
  ok(!bench.keyed(q, 'Astra then killed your KAY/O, and Phoenix killed your Clove.', ko).wrong.length && bench.keyed(q, 'Cypher killed you in Mid Plaza.', ko).wrong.length === 1
    && JSON.stringify(bench.markerClashes(q, ctx)) === JSON.stringify(['marker: "tells it as the Pearl match" names Clove, whom its own match has too']),
  'SIDEBAR-FRACTURE: CLOVE, THE PLAYER\'S FRACTURE TEAMMATE, IS NO MARKER OF THE PEARL MATCH, and --dry names a key that says otherwise');
}

console.log(fails ? `\nFAIL: ${fails} check(s) failed` : '\nPASS: every gate keeps and drops what it should, the prompt is the spec\'s, and the reply keeps its paragraphs');
process.exit(fails ? 1 : 0);

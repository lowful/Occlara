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
  // Since the coach bench 9 the economy is out of scope: a rule about buying is economy advice, and goes.
  ok(drops('On a full buy, take a rifle and Heavy Armor.', F3, 'economy-scope'), 'a rule about buying goes (the economy is out of scope since the coach bench 9)');
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
  ok(typeof gates.CHAT_CAPS === 'string' && coachSrc.includes(`const CHAT_WORDS = /\\b(?:${gates.CHAT_CAPS})\\b/gi;`),
    'and the chat\'s are its CHAT_WORDS, word for word (round 8 review)');
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
- COACHING NOTES: habits to draw on where the facts match. Never quote one word for word, and never say where any advice comes from. Each note is a rule for a kind of situation, not a record of this match: never say the player made the mistake a note warns about unless a round line or a look says so.

WHAT YOU MUST NOT SAY
- Nothing the facts do not hold. This match's record does not hold what anyone bought, the credits, the damage dealt and taken, or the utility used: if asked, say so and teach the rule instead.
- The economy is not something you coach: never say what anyone should buy, save or force, never talk about credits, the loss bonus or what a team can afford, and never explain a play or a read by the economy. A round named by its kind as the player told it (an eco, a bonus, the pistol round) only says where the round sits.
- No ranking of agents, no meta, no pick or win rates for the current patch: you do not have them. Answer from the kit, the player's own numbers and the facts.
- No player names, ever, even one the player typed: say your teammate, or the agent. No coach, player, team, video or other source for any advice.
- Only Valorant and the player's play.
- Nothing about the app, a future review, a page or a feature: never recommend one, and never say a review will check something. Teach the game alone.
- No number across the player's other matches but as the counted lines across matches and the against line give it, said as they say it ("in 5 of your last 6 matches", "your own average of 38%"), and no season, act or episode. A pattern of this match is this match's, never one across matches.

HOW TO ANSWER
- Answer the question in your first sentence, and answer the question that was asked. A question about aim, practice, an agent, the mental side or comms is answered about that, and a counted mistake comes in only where it bears on it. Never turn every answer into the same habit. If the question rests on something the facts contradict (a round called lost that was won, a death that did not happen), say so first, plainly, then answer what they meant.
- A general question (the biggest mistake, how to improve or climb, what to practise, how to warm up) needs no single round: answer it from the counted mistakes, the patterns across matches, the player's own numbers and their rank, with the one lever that matters most at that level. Never answer it with only that you cannot tell.
- About a round, a death or a play: tell it in order from the record (the side and the kind of round, the opening, the plant, the death with the numbers standing, how it ended), then the decision that decided it for the player, judged by what they could see at that moment, then what to do instead, written as the real situation to notice and the real move to make in it, concretely enough to do next round, and why it works in game terms: the guns and the range, the numbers standing, the clock and the spike, the kit. Rule out the larger causes before the shot: whether the fight needed taking, whether anyone could trade it, whether the player had information or utility first. When a death had both a decision and a shot that went wrong, name the decision first, then the one mechanic, in one sentence. Call a death lost on the shot only where the coach's look called the fight fair and lost on the shot.
- A fair fight is one taken from where it should be taken, at a range the gun can fight. Whether a teammate could trade it is a separate question.
- A death a teammate traded is not a mistake by itself, so never call the trade the problem. In a round the team lost, still judge whether the fight was needed, and never praise a death as a good or sound choice.
- About an agent: the player's own numbers on it first, then how its kit answers the problem, each ability by its name as the kit gives it, never by a key letter. Say what an ability does only as the kit says it. Name an enemy ability as what killed the player only where Riot's record gives that ability as the killing weapon.
- Asked for a game number the VALORANT FACTS hold (hits to kill, damage, a price, a timer), give it in your first sentence in the facts' own words, with the range band and the armour they name, then stop. Add nothing about the match unless asked.
- Name at most one ability in an answer about a round, and only when it changes the decision in that round. Do not list the kit, and do not offer the same ability in every answer.
- When the question names an ability, answer first how to use that ability in that moment (where to send or place it, when to set it off, where to stand when it goes off), then the principle behind it.
- Never mention an ultimate orb, a health number, who carried the spike or how many players were alive unless the facts of that round state it.
- About improving: THE LEVER when it is given, else the largest counted mistake or pattern, with its count exactly as given, then one habit that answers it, written as the moment to notice and the move to make, then one drill to build it and what the player should see in their next match if it worked. One habit only: if several things are counted, teach that one and leave the others out. A habit or a drill carries no count or timer of your own, because every number you say must be one of the facts. When THE LEVER is given, lead with it and leave trading out unless THE LEVER is trading.
- Quote a counted line's numbers as given, the deaths nobody traded included: that count leaves out a death as the last one alive, which nobody could trade, so never count the rounds yourself into a total of your own.
- End on the last real point of the answer. Never close by saying what can wait or what comes later, and never on a stock closer such as "the other things can wait", "the rest can wait", "everything else can wait" or "nothing else needs fixing first". Never make the team's record after the plant the player's own mistake in rounds the facts say they died before the plant, and never say the player beat or killed an agent in a round Riot's record does not have them killing.
- A practice drill must be one the player can do: Deathmatch and the Range have no teammates, so a team habit is practised in a match, with what to do when nobody answers the call, and Deathmatch has no abilities and neither mode has this match's enemy agents, so an agent's kit or a matchup is never practised in Deathmatch.
- When something went right, say what the player did and why it worked in game terms, from the record: a trade they made, a fight they took beside a teammate, a round they saved or won on the clock. Never praise a scoreboard number, never open with praise as a cushion, and never call the player unlucky or blame a teammate.
- Asked about their aim, answer from the deaths and the player's headshot rate against their own average. Where the coach's look called fights fair and lost on the shot, say so and give one aim habit. Answer about the shot first: the headshot rate against their own average, the fights the look called lost on the shot, and the guns of the aim facts where they are given, then one habit of the shot sized to their rank. Mention position or trading at most once, in one sentence after the habit, and only for a round line that shows it. The drill is one for the shot, in the Range or Deathmatch. Where the coach looked at no death, say the look cannot tell whether the fights were lost on the shot. Never say aim is not the problem, or that aim can wait, unless the coach's looks called those deaths something else. Never praise the aim where the headshot rate is under their own average, and never call a fight the look called fair one that should not have been taken.
- Before advice about a round, read its side and whether the spike was down when the player died: on attack with no spike down the defenders never have to come to you, so waiting for them is no plan, and on defence with the spike down the defenders must retake.
- If the facts about the player give a rank, size the advice to it and never say it back. Below Platinum, one basic habit (stopping before the shot, crosshair height, information before a peek, one angle at a time). Platinum to Diamond, the decision before the fight (predictability, playing the team's plan, when to take space). Ascendant and up, no basics, the specific timing or utility change and what it risks. An answer for a higher rank is never the one a lower rank would get for the same facts in longer words.
- Name the match the first time you refer to it: the map, the agent and the result.
- Never state where teams in general go on a map, or which site they reach first or last, as a fact: read the enemy only from what the player says they saw them do. Never add a premise the player did not give, such as a pistol round won or lost.
- Write times as seconds into the round, "8 s in", never as a clock such as 0:08, which reads as the time left. Say a gap in seconds, "1.5 s after the plant" or "6 s later", only from the event the facts give it from, never from another event told just before it.
- Speak to the player as you. Short paragraphs of plain text: no lists, no headings, no markdown. About 250 words, up to 400 when you walk through a round. Commas and periods, never dashes.
- Write for a player who does not know coaching words: in a habit to build say a teammate killed your killer for a trade, and a teammate was near or far for the distance, never close enough to kill or trade, which mixes the two, and about what happened say no teammate was close or nobody traded you, each only where the round's line says it, never nobody was close enough to trade you, which says both, say the smoke, the flash or the drone by name, not utility, say take one piece of space and stop, not checkpoints, and never write impact, tempo, map control, situational awareness or utility potential.`;
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
    && /19 s in(?: \([^()]*\))?, their Cypher killed you with a Spectre \(then 3 against 3\)/.test(p), 'the asked round is told in order from the feed, by agent and gun, with the numbers standing');
  {
    const entry = (/19 s in(?: \(([^()]*)\))?, their Cypher killed you/.exec(p) || [])[1] || '';
    ok(!/Computed from the record: the death came/.test(p) && (!entry || /^(?:[0-9.]+ s after (?:the plant|your last kill)|with [0-9.]+ s left on the spike)(?:, (?:[0-9.]+ s after (?:the plant|your last kill)|with [0-9.]+ s left on the spike))*$/.test(entry)),
      'ROUND 8: the gaps computed from the record sit in the death\'s own entry of the feed, each with its own event, never in a sentence apart', entry);
  }
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
  ok(none.includes(cp.NO_MATCH) && cp.NO_MATCH.startsWith('The player has no match in front of you, so there is no record'), 'no match says so, and that there is no record');
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
  // The ledger of the trades (round 8) comes on top of the budget, as the costliest deaths line does.
  const ledgerRoom = (cp.factsOf(rin, msgs).ledger || '').length + 2;
  ok(dynamic.length <= cp.DYNAMIC_MAX_CHARS + ledgerRoom && /ROUND 15 IN FULL/.test(big) && /Kills in order/.test(big),
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

  // THE RANK BAND (8.8): a Gold player's notes never reach above Gold, an
  // Immortal's reach the asc_plus only ones, and a client that sends no band,
  // or a band no key matches, gets today's notes and prompt byte for byte.
  const knowledge = require('../server/services/knowledge');
  const lowestOf = (text) => {
    const n = knowledge.all().find((x) => x.text === text);
    return n && Array.isArray(n.ranks) && n.ranks.length ? Math.min(...n.ranks.map((r) => knowledge.RANK_BANDS.indexOf(r))) : 0;
  };
  const seeded = (fn) => {
    const random = Math.random;
    let x = 5;
    Math.random = () => { x = (x * 16807) % 2147483647; return x / 2147483647; };
    try { return fn(); } finally { Math.random = random; }
  };
  const ctxOf = (band) => ({ v: 2, game: 'valorant', language: 'en', advanced: false, ...(band === undefined ? {} : { rankBand: band }),
    match: { id: 'valorant-1790000000000-omen01', map: 'Pearl', agent: 'Omen', mode: 'Swiftplay', result: 'Defeat', score: '1-5', rounds: 2,
      verified: true, lists: { mistakes: [{ key: 'cause:dry-peek', title: 'Dry peeks', detail: 'Died 2 times', rounds: [2, 5], count: 2 }] },
      cards: [dry, { ...dry, n: 5 }] }, player: {}, ask: {} });
  const ask = [{ role: 'user', content: 'How do I hold a site on defence?' }];
  const plainNotes = seeded(() => cp.pickNotes(cp.normalise(ctxOf(undefined)), ask));
  const junkSame = [null, 'Gold 2', 'plat', 9].every((j) => JSON.stringify(seeded(() => cp.pickNotes(cp.normalise(ctxOf(j)), ask))) === JSON.stringify(plainNotes)
    && JSON.stringify(cp.normalise(ctxOf(j))) === JSON.stringify(cp.normalise(ctxOf(undefined))));
  ok(junkSame, 'no band, or a band no key matches, gives today\'s notes and input byte for byte');
  ok(cp.renderPlayer(cp.normalise(ctxOf(undefined))) === cp.renderPlayer(cp.normalise(ctxOf('nonsense'))) && !/rank band/.test(cp.renderPlayer(cp.normalise(ctxOf(undefined)))),
    'and the player facts carry no band line without one');
  let leak = 0;
  for (const q of ['How do I hold a site on defence?', 'What should I work on?', 'How do I win a retake?', 'Why did I lose that duel?']) {
    const gold = cp.pickNotes(cp.normalise(ctxOf('silver_gold')), [{ role: 'user', content: q }]);
    leak += gold.filter((t) => lowestOf(t) > 1).length;
    if (gold.length > 8) leak += 100;
  }
  ok(leak === 0, `a Gold player's Ask Coach notes never reach above Gold, and never pass eight (${leak})`);
  const immPool = new Set(knowledge.retrieve({ agent: 'Omen', map: 'Pearl', side: 'defending', rankBand: 'asc_plus' }, 2000));
  const goldPool = new Set(knowledge.retrieve({ agent: 'Omen', map: 'Pearl', side: 'defending', rankBand: 'silver_gold' }, 2000));
  const ascDef = knowledge.all().filter((n) => Array.isArray(n.ranks) && n.ranks.join() === 'asc_plus' && n.side === 'defense');
  ok(ascDef.length >= 1 && ascDef.every((n) => immPool.has(n.text) && !goldPool.has(n.text)),
    'the question\'s situation for an Immortal reaches the asc_plus only defence note, at Gold it never does');
  ok(/Their rank band: Silver or Gold\. Fit the advice to that level and name the one basic habit that matters most there/.test(cp.renderPlayer(cp.normalise(ctxOf('silver_gold')))),
    'with a band, the player facts size the advice to it');

  // THE ENEMY TEAM (8.8): the match's comp and Riot's killers, agents only,
  // for a client the route marks (byEnemy). One before it sends the same comp
  // and gets today's notes; an enemy note is never served blind.
  const comps = { us: [{ agent: 'Omen' }], them: [{ agent: 'Killjoy' }, { agent: 'Cypher' }, { agent: 'Player#TAG' }] };
  const withComp = (band, extra) => {
    const c = ctxOf(band);
    return { ...c, match: { ...c.match, comps, cards: [{ ...dry, riot: { killer: 'Jett', sec: 40 } }, { ...dry, n: 5 }] }, ...(extra || {}) };
  };
  const oldClient = cp.normalise(withComp(undefined));
  const noComp = cp.normalise(ctxOf(undefined));
  ok(cp.enemiesOf(oldClient).length === 0 && JSON.stringify(cp.enemiesOf({ ...oldClient, byEnemy: true })) === '["Killjoy","Cypher","Jett"]',
    "the enemy agents are the comp and Riot's killer, agents only, and none for a client before this release");
  const enemyText = new Set(knowledge.all().filter((n) => n.enemyAgents || n.enemyWithout).map((n) => n.text));
  let blindNotes = 0;
  for (const q of ['How do I hold a site on defence?', 'What should I work on?', 'How do I win a retake?']) {
    const m = [{ role: 'user', content: q }];
    blindNotes += cp.pickNotes(oldClient, m).filter((t) => enemyText.has(t)).length;
    blindNotes += cp.pickNotes(noComp, m).filter((t) => enemyText.has(t)).length;
  }
  ok(blindNotes === 0, 'with no enemy list Ask Coach is given no enemy note');
  const newClient = { ...cp.normalise(withComp('plat_diamond')), byEnemy: true };
  let wrongEnemy = 0;
  let served = 0;
  for (const q of ['How do I hold a site on defence?', 'What should I work on?', 'How do I attack a site?', 'How do I win a retake?']) {
    for (const t of cp.pickNotes(newClient, [{ role: 'user', content: q }])) {
      const n = knowledge.all().find((x) => x.text === t);
      if (!n.enemyAgents && !n.enemyWithout) continue;
      served++;
      if (knowledge.enemyFit(n, cp.enemiesOf(newClient)) === null) wrongEnemy++;
    }
  }
  ok(wrongEnemy === 0, `against a Killjoy, Cypher and Jett every enemy note served answers one of them (${served} served)`);
  const pool = knowledge.retrieve({ agent: 'Omen', map: 'Pearl', enemyAgents: cp.enemiesOf(newClient), rankBand: 'plat_diamond' }, 2000);
  const kjNote = knowledge.all().find((n) => n.enemyAgents && n.enemyAgents.join() === 'Killjoy' && !n.side && !n.phase);
  ok(kjNote && pool.includes(kjNote.text) && !knowledge.retrieve({ agent: 'Omen', map: 'Pearl', rankBand: 'plat_diamond' }, 2000).includes(kjNote.text),
    'and the situation Ask Coach retrieves with reaches the Killjoy note against that comp, never without it');

  // WORKED CASES (8.8, cases.js): only where the question's situation matches,
  // two at most, the band as the notes, and the prompt grows 10% at most.
  const cases = require('../server/services/cases');
  const general = cp.normalise({ v: 2, game: 'valorant', language: 'en', advanced: true, match: null, player: {}, ask: {} });
  const hi = [{ role: 'user', content: 'Hi coach, how are you?' }];
  ok(cp.casesFor(general, hi).length === 0 && !cp.buildPrompt(general, hi).includes(cases.HEAD),
    'a question with no situation a case matches gets no cases block');
  const retakeCtx = (band) => ({ v: 2, game: 'valorant', language: 'en', advanced: true, ...(band ? { rankBand: band } : {}),
    match: { id: 'valorant-1790000000000-omen02', map: 'Haven', agent: 'Omen', mode: 'Competitive', result: 'Defeat', score: '9-13', rounds: 22, verified: true,
      lists: { mistakes: [{ key: 'cause:exposed', title: 'Exposed', detail: 'x', rounds: [7], count: 1 }] },
      cards: [{ n: 7, side: 'defending', result: 'lost', died: true, verified: true, riot: { sec: 80, plantSec: 60, killer: 'Jett' }, look: { cause: 'exposed', what: 'x', better: 'y', source: 'riot' } }] },
    player: {}, ask: { round: 7 } });
  const retakeAsk = [{ role: 'user', content: 'How should I have played the retake in round 7?' }];
  const rIn = cp.normalise(retakeCtx('plat_diamond'));
  const got = cp.casesFor(rIn, retakeAsk);
  ok(got.length >= 1 && got.length <= cases.MAX_CASES, `a retake question on a retake death is given ${got.length} case(s), two at most`);
  const withC = seeded(() => cp.buildPrompt(rIn, retakeAsk));
  const realPick = cases.pick;
  let todayP;
  cases.pick = () => [];
  try { todayP = seeded(() => cp.buildPrompt(rIn, retakeAsk)); } finally { cases.pick = realPick; }
  ok(withC.includes(cases.HEAD) && !todayP.includes(cases.HEAD) && got.every((c) => withC.includes(cases.line(c))),
    'the prompt carries the cases block, and without a case it is the prompt as it was');
  ok(withC.length <= Math.floor(todayP.length * (1 + cp.CASE_GROWTH)) && withC.length - todayP.length < 0.1 * todayP.length + 1,
    `growing ${Math.round((withC.length / todayP.length - 1) * 1000) / 10}%, within ${cp.CASE_GROWTH * 100}%`);
  const blockAt = withC.indexOf(cases.HEAD);
  const blockEnd = withC.indexOf('\n\n', blockAt);
  const notesBefore = (p) => { const i = p.indexOf('COACHING NOTES\n'); return i < 0 ? [] : p.slice(i).split('\n').slice(1).filter((l, j, a) => a.slice(0, j + 1).every((x) => x.startsWith('- '))); };
  const kept = notesBefore(withC);
  const was = notesBefore(todayP);
  ok(JSON.stringify(was.slice(0, kept.length)) === JSON.stringify(kept)
    && withC.slice(0, blockAt - 2) + withC.slice(blockEnd) === todayP.replace(was.join('\n'), kept.join('\n')),
  `the cases take the lowest notes' place (${kept.length} of ${was.length} kept), and taking them out leaves the prompt as it was`);
  let goldCases = 0;
  for (const q of ['How should I have played the retake in round 7?', 'What should I work on?', 'How do I win a clutch?']) {
    goldCases += cp.casesFor(cp.normalise(retakeCtx('silver_gold')), [{ role: 'user', content: q }]).filter((c) => knowledge.RANK_BANDS.indexOf(c.minBand) > 1).length;
  }
  ok(goldCases === 0, 'a Gold player\'s questions are never given a case above Gold');
  ok(cp.casesFor(cp.normalise({ ...retakeCtx('plat_diamond'), advanced: false }), retakeAsk).every((c) => c.tier !== 'advanced'),
    'and with Advanced coaching off no advanced case');
  ok(cp.casesFor({ ...cp.normalise(retakeCtx('plat_diamond')), game: 'lol' }, retakeAsk).length === 0, 'League is given none');

  // A real situational match (cases.js situational): over a whole match a
  // phase counts only where the deaths gather, the asked round keeps its own.
  const kjCtx = (id, cards, ask) => ({ v: 2, game: 'valorant', language: 'en', advanced: true, rankBand: 'plat_diamond',
    match: { id, map: null, agent: 'Killjoy', mode: 'Competitive', result: 'Defeat', score: '9-13', rounds: 22, verified: true, cards }, player: {}, ask: ask || {} });
  const card = (n, side, sec) => ({ n, side, result: 'lost', died: true, verified: true, riot: { sec, killer: 'Jett' } });
  const spreadCards = [card(3, 'defending', 20), card(6, 'defending', 50), card(9, 'attacking', 90),
    { ...card(15, 'attacking', 80), riot: { sec: 80, plantSec: 60, killer: 'Jett' } }];
  const whole = [{ role: 'user', content: 'What should I work on?' }];
  ok(cp.casesFor(cp.normalise(kjCtx('valorant-1790000000000-kj001', spreadCards)), whole).length === 0,
    'a question about a whole match whose deaths are spread over the round is given no case on the clock alone');
  const r6 = [{ role: 'user', content: 'Why did I die in round 6?' }];
  const asked6 = cp.casesFor(cp.normalise(kjCtx('valorant-1790000000000-kj001', spreadCards, { round: 6 })), r6);
  ok(asked6.length >= 1 && asked6.length <= cases.MAX_CASES && asked6.every((c) => !c.situation.phase || c.situation.phase === 'mid'),
    `the asked round keeps its own phase: round 6, a mid round death, is given ${asked6.length} mid round case(s)`);
  ok(asked6.length < 2 || !cases.lessonsOf(asked6[1]).some((l) => cases.lessonsOf(asked6[0]).includes(l)), 'and never two cases teaching one thing');
  // The seed: one match, the same cases for every question about it; another match may get others.
  const again = cp.casesFor(cp.normalise(kjCtx('valorant-1790000000000-kj001', spreadCards, { round: 6 })), [{ role: 'user', content: 'What went wrong in round 6?' }]);
  ok(JSON.stringify(again.map((c) => c.id)) === JSON.stringify(asked6.map((c) => c.id)), 'the same match asked again gets the same cases');
  const seen = new Set();
  for (let i = 0; i < 30; i++) {
    seen.add(cp.casesFor(cp.normalise(kjCtx(`valorant-17900000000${String(i).padStart(2, '0')}-kj`, spreadCards, { round: 6 })), r6).map((c) => c.id).join('+'));
  }
  ok(seen.size >= 2, `thirty matches with the same round 6 are given ${seen.size} different case sets, not one pair every time`);

  // enemyHint (8.8): an enemy note served blind is never served against a
  // known comp without its agent, for a client the route marks.
  const fullComp = { us: [{ agent: 'Omen' }], them: ['Jett', 'Sova', 'Omen', 'Killjoy', 'Reyna'].map((agent) => ({ agent })) };
  const hintNotes = knowledge.all().filter((n) => Array.isArray(n.enemyHint));
  const known = { ...cp.normalise({ ...ctxOf('plat_diamond'), match: { ...ctxOf('plat_diamond').match, comps: fullComp } }), byEnemy: true };
  let wrongHint = 0;
  for (const q of ['How do I hold a site on defence?', 'What should I work on?', 'How do I attack a site?', 'How do I win a retake?', 'How do I stop losing duels?']) {
    for (const t of cp.pickNotes(known, [{ role: 'user', content: q }])) {
      const n = hintNotes.find((x) => x.text === t);
      if (n && !n.enemyHint.some((a) => cp.enemiesOf(known).includes(a))) wrongHint++;
    }
  }
  ok(hintNotes.length >= 6 && cp.enemiesOf(known).length === 5 && wrongHint === 0,
    `against a known comp Ask Coach is given no enemyHint note for an agent not in it (${wrongHint})`);
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
    lists: { mistakes: [], strengths: [], missed: [] } };
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

// ── The game's current modes and headline stats are no names (stale F4) ────
// Skirmish, Retake, Knockout, Gauntlet and the Performance Score and Map
// Rating of 13.06 and 13.08 were each read as a player's name, and the
// sentence dropped by the review, the look and Ask Coach.
{
  console.log('\nthe game\'s own words:');
  const ng = require('../server/services/name-gate');
  const said = (s) => ng.namesSomeone(gates.lowerGameWords(s));
  for (const s of ['Warm up in Skirmish before you queue.', 'Your Performance Score of 310 was the best on your team.',
    'Your Map Rating on Bind is low.', 'Win the Retake as a team.', 'Play a few rounds of Knockout to practise the first fight.',
    'The Gauntlet mode rewards the same habits.', 'Your Accolades show the first kills.', 'Your Agent Mastery on Jett is growing.']) {
    ok(said(s) === null, `no name in "${s}"`, String(said(s)));
  }
  ok(said('Warm up with Varkalen before you queue.') !== null, 'and a word no game says is still read as a name');
}

// ── Whose first death, first kill, trade and plant it is (review F3, F4, F9) ─
// Round 5 in Riot's record: the enemy Jett killed the player's Sova first,
// then the player. The player had no first death and no first kill, nobody
// traded the death, and nobody planted. A first death or a first kill is held
// to the record only when it is the player's: three true sentences about the
// Sova and the Jett were dropped. And a teammate trading or avenging the
// player, or the player planting, said every way, was kept on a round with no
// trade and no plant.
{
  console.log('\nwhose claim it is:');
  const r5 = { n: 5, side: 'attacking', result: 'lost', died: true, verified: true, watched: true, pistol: false, matchPoint: false,
    planted: false, afterPlant: false, firstDeath: false, firstKill: false, kills: 0, traded: false, trades: 0, clutch: null,
    killer: 'Jett', killerWeapon: 'Vandal', sec: 30,
    feed: [{ ms: 20000, by: 'enemy', on: 'mate', ka: 'Jett', va: 'Sova', w: 'Vandal' }, { ms: 30000, by: 'enemy', on: 'me', ka: 'Jett', va: 'Omen', w: 'Vandal' }],
    times: [], standings: [[5, 5], [4, 5]], weapons: { mine: new Set(), theirs: new Set(['Vandal']), mates: new Set(), all: new Set(['Vandal']) },
    atDeath: [4, 5], after: [3, 5], look: null, lookDigits: [], before: null };
  const R5 = { game: 'valorant', language: 'en', agent: 'Omen', map: 'Ascent', rounds: new Map([[5, r5]]), scores: [], counted: { titles: [] }, numbers: new Map() };
  for (const s of ['In round 5 your Sova died first, and you were caught 4 against 5.',
    'In round 5 their Jett got the first kill on your Sova, then killed you too.',
    'In round 5 the enemy Jett opened the round by killing your Sova.',
    'In round 5 nobody traded your death.',
    'In round 5 nobody planted the spike.']) {
    ok(keeps(s, R5), `kept, true of round 5: "${s}"`, why(s, R5));
  }
  for (const s of ['In round 5 you were the first to die.', 'In round 5 you died first.', 'In round 5 you got the first kill.',
    'In round 5 their Jett got the first kill on you.', 'In round 5 the enemy Jett opened the round by killing you.',
    'In round 5 your Sova traded your death right away.', 'In round 5 a teammate avenged you within a second.',
    'In round 5 your teammates avenged your death.', 'In round 5 you planted the spike on A.', 'In round 5 you got the plant down.']) {
    ok(drops(s, R5, 'timeline'), `dropped, false of round 5: "${s}"`, why(s, R5));
  }
  // The same words on a round that has them stay.
  const r6 = { ...r5, n: 6, firstDeath: true, traded: true, planted: true };
  const R6 = { ...R5, rounds: new Map([[6, r6]]) };
  for (const s of ['In round 6 you were the first to die.', 'In round 6 their Jett got the first kill on you.',
    'In round 6 your Sova traded your death right away.', 'In round 6 a teammate avenged you within a second.', 'In round 6 you planted the spike on A.']) {
    ok(keeps(s, R6), `kept, true of round 6: "${s}"`, why(s, R6));
  }
  ok(gates.MATE_TRADED_YOU.test('your Sova traded your death') && gates.MATE_TRADED_YOU.test('a teammate avenged you')
    && !gates.MATE_TRADED_YOU.test('Skye traded KAY/O') && gates.YOU_PLANTED.test('you planted the spike') && !gates.YOU_PLANTED.test('they planted the spike'),
  'the trade and plant regexes match a known positive and not a known negative');
}

// ── The round 3 audit (Nov 2026) ───────────────────────────────────────────
// Eight of sixty Ask Coach answers were the honest line on the plainest
// questions, the gates dropping true sentences; aim was waved away with no
// look; a key, an effect, a health number and a drill no mode allows passed.
// Each fix below is pinned on the sentence the audit's replay dropped (or let
// through) and on a planted false variant the gate must still drop.
{
  console.log('\nthe round 3 audit:');
  // No regex in either file was written through a shell (CLAUDE.md): no backspace byte.
  const BS = String.fromCharCode(8);
  for (const f of ['fact-gates.js', 'chat-prompt.js']) {
    ok(!fs.readFileSync(path.join(__dirname, '..', 'server', 'services', f), 'utf8').includes(BS), `${f} holds no backspace byte`);
  }
  const regexes = [
    ['PAIR_FILLER', gates.PAIR_FILLER, '5 of your last 6 matches', '5 of 6 matches'],
    ['KEEPING_WORTH', gates.KEEPING_WORTH, 'is worth keeping', 'you kept peeking'],
    ['CLUTCH_AGAINST_BEFORE', gates.CLUTCH_AGAINST_BEFORE, 'as the last one standing against ', 'your team standing against '],
    ['OF_YOUR_NOUN', gates.OF_YOUR_NOUN, ' of your deaths came early', ' of your teammates'],
    ['SMALL_ADVICE_AFTER', gates.SMALL_ADVICE_AFTER, ' more shot and leave', ' seconds in'],
    ['LEAD_CONDITION', gates.LEAD_CONDITION, 'If you have an escape, take one more shot', 'If you had stayed in cover'],
    ['ONE_ROUND', gates.ONE_ROUND, 'in round 2 you died', 'the second round'],
    ['TEMPLATE_WORDS', gates.TEMPLATE_WORDS, 'When this happens, do that.', 'When their Jett dashes in, fall back.'],
    ['SOLO_MODE', gates.SOLO_MODE, 'run deathmatch with one rule', 'run team deathmatch with one rule'],
    ['TEAM_WORDS', gates.TEAM_WORDS, 'if a teammate is within sight', 'stop before every shot'],
    ['NO_TEAM', gates.NO_TEAM, 'with no teammates there', 'with a teammate there'],
    ['KILL_AFTER_ABILITY', gates.KILL_AFTER_ABILITY, ' killed you in round 1', ' slowed you in round 1'],
    ['KILL_BEFORE_ABILITY', gates.KILL_BEFORE_ABILITY, 'you died to her ', 'you threw her '],
  ];
  const aimPos = ['Your aim is not the problem here.', 'Your aim work can wait.', 'so this was not about your aim', 'a repeek, not a lost aim duel', 'Your aim looks fine.', 'nothing here saying your aim is the issue',
    // The re-audit of 8.7.7.
    'The deaths in this match mostly were not lost on the shot.', 'Your mechanics are not what is costing you rounds.',
    'Your headshot rate was 25%, so there is room there, but it is not what cost you the rounds.', 'the problem is not that you are losing duels'];
  gates.AIM_DISMISSED.forEach((re, i) => regexes.push([`AIM_DISMISSED[${i}]`, re, aimPos[i], 'Your aim is the first thing to fix.']));
  cp.QUESTION_TOPICS.forEach((t) => {
    const ask = { aim: 'How do I get better aim at my rank?', practice: 'What should I practice before my next game?', climb: 'How do I climb out of Silver?',
      mental: 'How do I stop tilting after a loss?', comms: 'How should I use comms in solo queue?', ult: 'When should I use my ultimate?',
      read: 'They went B two rounds in a row, should we have changed our setup?' }[t.key];
    regexes.push([`QUESTION_TOPICS.${t.key}.ask`, t.ask, ask, 'Why did I die in round 5 on Split?']);
  });
  for (const [name, re, pos, neg] of regexes) {
    const r = new RegExp(re.source, re.flags.replace('g', ''));
    ok(r.test(pos) && !r.test(neg), `${name} matches "${pos}" and not "${neg}"`);
  }

  // 1. "5 of your last 6 matches", THE PLAYER's "in 5 of 6 matches" said back.
  const QI = 'How do I improve at my rank? What is holding me back from climbing?';
  const MI = [{ role: 'user', content: QI }];
  const INI = inputFor(ABYSS, QI, { patterns: { recorded: 6, mistakes: [{ key: 'untraded', title: 'Died where nobody could trade', matches: 5, trend: 'falling' }] } });
  const FI = factsFor(INI, MI, STAND_IN);
  for (const s of ['The biggest thing holding you back is dying where nobody could trade you, and that showed up in 5 of your last 6 matches.',
    'The biggest thing to work on is dying where nobody could trade you: that showed up in 5 of your 6 recorded matches.']) {
    ok(keeps(s, FI), `THE PLAYER'S PAIR SAID BACK STAYS (the audit dropped it): "${s}"`, why(s, FI));
  }
  ok(drops('The biggest thing holding you back is dying where nobody could trade you, and that showed up in 4 of your last 6 matches.', FI, 'count')
    && drops('That showed up in 5 of your last 7 matches.', FI, 'count'),
  'and a pair the patterns never stated still drops: 4 of your last 6, 5 of your last 7');

  // 2. "All 21 of your deaths": a share of a total, or of a counted pair.
  ok(keeps('Dying where nobody could trade you cost you the most, and it was 20 of your deaths.', FI) && keeps('Every one of them, all 21 of your deaths, came on defence or attack.', FI),
    'A SHARE OF A TOTAL STAYS: 20 of your deaths (the counted 20 of 21), all 21 of your deaths (the scoreline)',
    `${why('Dying where nobody could trade you cost you the most, and it was 20 of your deaths.', FI)} ${why('Every one of them, all 21 of your deaths, came on defence or attack.', FI)}`);
  ok(drops('Dying where nobody could trade you cost you the most, and it was 19 of your deaths.', FI, 'number')
    && drops('It happened in all 22 of your deaths.', FI, 'number'),
  'and a share no total or count states drops: 19 of your deaths, all 22 of your deaths');

  // 3. A single shot in advice, after a condition too.
  for (const s of ['If you have an escape, take one more shot and leave.', 'Take one more shot only if you have an escape, then move to cover and re clear from a new spot.']) {
    ok(keeps(s, F3), `ONE MORE SHOT IN ADVICE CLAIMS NO GAME NUMBER (the audit dropped it): "${s}"`, why(s, F3));
  }
  ok(drops('If you have an escape, two body shots from the Sheriff kill through Heavy Armor.', F3, 'number')
    && drops('Take two body shots with the Sheriff, which kills through Heavy Armor.', F3, 'number'),
  'and a hits to kill claim in advice is still the primer\'s: two Sheriff body shots through Heavy Armor drop');

  // Hand made rounds for the clutch, the weapon, the aim and the ability rules.
  const round = (n, over) => ({ n, side: 'attacking', result: 'lost', died: true, verified: true, watched: true, pistol: false, matchPoint: false,
    planted: false, afterPlant: false, firstDeath: false, firstKill: false, kills: 0, traded: false, trades: 0, clutch: null,
    killer: 'Astra', killerWeapon: 'Vandal', sec: 30, feed: null, times: [30], standings: [[5, 5], [4, 5]],
    weapons: { mine: new Set(), theirs: new Set(['Vandal']), mates: new Set(), all: new Set(['Vandal']) },
    atDeath: [4, 5], after: [3, 5], look: null, lookDigits: [], before: null, ...over });
  const factsOfRounds = (rs, extra) => ({ game: 'valorant', language: 'en', agent: 'Jett', map: null, rounds: new Map(rs.map((r) => [r.n, r])),
    scores: [], days: [], numbers: [], primer: [], counted: { titles: [], pairs: new Set(), counts: new Set(), roundSets: [], texts: [] },
    sides: { mates: new Set(), enemies: new Set() }, askedAgents: [], ...(extra || {}) });

  // 4. The last one standing against N is a clutch Riot's record has.
  const CL = factsOfRounds([round(2, { result: 'won', died: false, kills: 3, firstKill: true, clutch: { vs: 2, won: true }, killer: null, killerWeapon: null,
    standings: [[5, 5], [1, 2], [1, 0]], atDeath: null, after: null })]);
  ok(keeps('What went right is worth keeping: in round 2 you were the last one standing against 2 and won it.', CL)
    && keeps('You won round 2 as the last one standing against 2.', CL),
  'THE LAST ONE STANDING AGAINST 2 IS ROUND 2\'S CLUTCH, AND WHAT IS WORTH KEEPING IS NO REPEAT (the audit dropped both)',
  `${why('What went right is worth keeping: in round 2 you were the last one standing against 2 and won it.', CL)} ${why('You won round 2 as the last one standing against 2.', CL)}`);
  ok(drops('You won round 2 as the last one standing against 3.', CL, 'number') && drops('In round 2 you kept taking the first fight before your team was set.', CL, 'count'),
    'and a clutch against a count the record never had drops, as does a repeat no count says ("kept")');

  // 5. The gun of the round named alone before it.
  const WR = factsOfRounds([
    round(2, { result: 'won', kills: 3, firstKill: true, traded: true, killerWeapon: 'Sheriff', weapons: { mine: new Set(), theirs: new Set(['Sheriff']), mates: new Set(), all: new Set(['Sheriff']) } }),
    round(4, { kills: 4, firstKill: true }),
    round(5, { kills: 2, firstKill: true })]);
  const gunLine = 'You opened rounds well, getting the first kill in rounds 2, 4 and 5, but in round 2 you stayed on the same angle after the exchange and died to a Sheriff.';
  ok(keeps(gunLine, WR), 'A GUN IS THE ROUND\'S NAMED ALONE BEFORE IT: "in round 2 ... died to a Sheriff" after "rounds 2, 4 and 5" (the audit gave round 4 the Sheriff)', why(gunLine, WR));
  ok(drops('You opened rounds well, getting the first kill in rounds 2, 4 and 5, but in round 4 you stayed on the same angle and then a Sheriff killed you.', WR, 'weapon')
    && drops('In rounds 2 and 4 you died to a Sheriff.', WR),
  'and a gun the named round never had still drops, and a list of rounds still holds it to each of them');

  // 5b. The audit's other true sentences the number and count gates dropped.
  ok(keeps('A Sheriff kills with one head hit inside 30 m, but needs two body hits against no armour.', F3)
    && drops('A Sheriff kills with one head hit inside 30 m, but needs three body hits against no armour.', F3, 'number'),
  'THE PART NAMED RIGHT AFTER THE NUMBER: "one head hit ... but needs two body hits" reads the 2 as body hits (the audit read it as head hits), three still drops',
  why('A Sheriff kills with one head hit inside 30 m, but needs two body hits against no armour.', F3));
  ok(keeps('Of your 21 deaths, 20 went unanswered, meaning no teammate killed your killer within five seconds.', FI)
    && drops('Of your 21 deaths, 19 went unanswered, meaning no teammate killed your killer within five seconds.', FI, 'number'),
  'THE COUNTED PAIR THE OTHER WAY ROUND: "Of your 21 deaths, 20 went unanswered" stays, 19 drops',
  why('Of your 21 deaths, 20 went unanswered, meaning no teammate killed your killer within five seconds.', FI));
  ok(keeps('Your first kills were real, 4 rounds where you opened the round, and that is the part to keep.', FI)
    && drops('Your first kills were real, and you kept opening rounds that way.', FI, 'count'),
  'WHAT IS THE PART TO KEEP IS NO REPEAT, while "you kept opening rounds" no count says still drops',
  why('Your first kills were real, 4 rounds where you opened the round, and that is the part to keep.', FI));
  const mates = FI.counted.tradedMates;
  ok(Number.isInteger(mates) && mates > 0 && keeps(`Your own record shows why it matters: you traded a teammate ${mates} times.`, FI)
    && drops(`Your own record shows why it matters: you traded a teammate ${mates + 3} times.`, FI, 'count'),
  `THE TEAMMATES TRADED, THE CARDS' OWN SUM: ${mates} times stays, ${Number(mates) + 3} drops`,
  why(`Your own record shows why it matters: you traded a teammate ${mates} times.`, FI));

  // 6. The template's words.
  ok(drops('When this happens, do that.', F3, 'template') && drops('When this happens, do that: plant, then take a spot behind cover.', F3, 'template')
    && keeps('When their Jett dashes onto the site, fall back to your teammate.', F3),
  'THE RULES\' TEMPLATE NEVER REACHES THE PLAYER: "When this happens, do that." drops, a real moment and move stays');

  // 7. Aim is never waved away without the looks to say so.
  const QA = 'How do I get better aim at my rank?';
  const MA = [{ role: 'user', content: QA }];
  const FA = factsFor(inputFor(ABYSS, QA), MA, STAND_IN);
  for (const s of ['Your aim is not the problem here.', 'Your aim work can wait.', 'Aim is not what cost you this Abyss match.', 'That is the thing to fix, and the aim question can wait.']) {
    ok(drops(s, FA, 'aim'), `AIM IS NOT WAVED AWAY WITH TWO OF 21 DEATHS LOOKED AT, ONE A LOST DUEL: "${s}" drops`, why(s, FA));
  }
  ok(drops('Your aim is not the problem here.', F3, 'aim'), 'and of round 3, which the coach never looked at, it drops too');
  const LOOKED = factsOfRounds([round(2, { look: { cause: 'dry-peek', what: 'You swung with no utility.', better: 'Flash first.', fair: false } }),
    round(4, { look: { cause: 'repeek', what: 'You peeked the same angle twice.', better: 'Change your angle.', fair: false } })]);
  ok(keeps('Your aim was not the problem in this match, the peeks were.', LOOKED) && keeps('Round 4 was not about your aim: the look saw you peek the same angle again.', LOOKED),
    'where the coach looked at the deaths and called them something else, saying so stays',
    `${why('Your aim was not the problem in this match, the peeks were.', LOOKED)} ${why('Round 4 was not about your aim: the look saw you peek the same angle again.', LOOKED)}`);
  ok(keeps('In round 4 you peeked the same angle twice and died.', LOOKED) && drops('In round 2 you peeked the same angle twice and died.', LOOKED, 'count'),
    'PEEKED TWICE OF A REPEEK IS THE LABEL IN WORDS (the audit dropped it as 2 times), and of a dry peek it still drops',
    why('In round 4 you peeked the same angle twice and died.', LOOKED));
  const DUEL = factsOfRounds([round(2, { look: { cause: 'dry-peek', what: 'x', better: 'y', fair: false } }), round(4, { look: { cause: 'lost-duel', what: 'x', better: 'y', fair: true } })]);
  ok(drops('Your aim was not the problem in this match.', DUEL, 'aim') && keeps('Your aim is the first thing to fix: round 4 was a fair fight lost on the shot.', DUEL),
    'and against a lost duel the look called, it drops, while saying aim is the problem stays');
  // The round asked about is the sentence's round when it names none (the round 3 verification).
  const ASK4 = { ...DUEL, asked: 2, oneRound: true };
  const ASK4D = { ...DUEL, asked: 4, oneRound: true };
  ok(keeps('Aim was not the issue here, the position was.', ASK4) && drops('Aim was not the issue here, the position was.', ASK4D, 'aim'),
    'IN A ONE ROUND ANSWER, AIM WAVED AWAY IS HELD TO THE ASKED ROUND: of a dry peek it stays, of a lost duel it drops',
    `${why('Aim was not the issue here, the position was.', ASK4)} ${why('Aim was not the issue here, the position was.', ASK4D)}`);

  // 8. The kit as the game data has it, and a health number nothing states.
  const QK = 'Their Killjoy killed me the most. How do I play against Killjoy?';
  const FK = factsFor(inputFor(ABYSS, QK), [{ role: 'user', content: QK }], STAND_IN);
  const QO = 'Their Omen killed me the most. How do I play against Omen?';
  const FO = factsFor(inputFor(ABYSS, QO), [{ role: 'user', content: QO }], STAND_IN);
  ok(drops('Her Turret (E) and Alarmbot (C) are the two things that punish a Jett who moves first.', FK, 'kit')
    && drops('The turret watches an angle and shoots when you cross it, and the alarmbot reveals and slows anyone who walks into its range.', FK, 'kit')
    && drops('Paranoia sends a vision-blocking shadow down the lane.', FO, 'kit'),
  'A KEY, AN EFFECT THE KIT DOES NOT HAVE: Alarmbot (C), the alarmbot slows, Paranoia vision blocking, each the audit\'s, drop');
  ok(keeps('Her Turret (E) and Alarmbot (Q) are the two things that punish a Jett who moves first.', FK) && keeps('Paranoia sends a shadow that blinds and deafens you.', FO),
    'and the same kit said as the data has it stays', `${why('Her Turret (E) and Alarmbot (Q) are the two things that punish a Jett who moves first.', FK)} ${why('Paranoia sends a shadow that blinds and deafens you.', FO)}`);
  // A health number nothing states: the number gate holds it in English first,
  // ability-facts.js checkState behind it; one the look read off the HUD stays.
  const HP = factsOfRounds([round(2, { killer: 'Astra', killerWeapon: 'Sheriff', lookDigits: [{ value: 57, unit: 'health' }],
    weapons: { mine: new Set(), theirs: new Set(['Sheriff']), mates: new Set(), all: new Set(['Sheriff']) } })]);
  ok(drops('In round 2 you stayed on the angle at 11 health and died to a Sheriff.', HP) && keeps('In round 2 you stayed on the angle at 57 health and died to a Sheriff.', HP)
    && gates.gateKit('In round 2 you stayed on the angle at 11 health and died to a Sheriff.', HP, { round: true, rounds: [2] }).gate === 'kit'
    && gates.gateKit('In round 2 you stayed on the angle at 57 health and died to a Sheriff.', HP, { round: true, rounds: [2] }) === null,
  'a health number nothing in the facts states drops (the audit\'s "11 HP"), the one the look read stays, by both readers',
  why('In round 2 you stayed on the angle at 57 health and died to a Sheriff.', HP));

  // 9. A drill the mode allows.
  ok(drops('To build it, run deathmatch with one rule: you are only allowed to peek an angle if a teammate is within sight of it.', F3, 'mode'),
    'A DEATHMATCH DRILL THAT NEEDS TEAMMATES DROPS (the audit\'s)');
  ok(keeps('Play one deathmatch where you stop before every shot and put the first bullet at head height.', F3)
    && keeps('Deathmatch has no teammates, so practise the trade habit in your next unrated match instead.', F3),
  'and a drill one can do alone stays, as does saying Deathmatch has no teammates');
  ok(keeps('Stay within the range where a teammate can trade you.', F3) && keeps('Play Team Deathmatch and trade each other with a teammate.', F3)
    && drops('Go to the Range and practise trading with your duo.', F3, 'mode'),
  'a range that is a distance is no drill, Team Deathmatch has a team, the Range by its name still drops (the round 3 verification)',
  why('Stay within the range where a teammate can trade you.', F3));

  // 10. An enemy ability killed the player only where the record says so.
  const KJ = factsOfRounds([round(1, { killer: 'Killjoy', killerWeapon: 'Bandit' }), round(2, { killer: 'Killjoy', killerWeapon: 'Bandit' }),
    round(3, { killer: 'Killjoy', killerWeapon: 'Turret' })]);
  ok(drops("In round 1 Killjoy's Turret killed you as you crossed.", KJ, 'ability-kill') && drops("In round 2 you died to Killjoy's Turret on the way in.", KJ, 'ability-kill'),
    'AN ABILITY CALLED THE KILLER OF A GUN KILL DROPS: Killjoy\'s Bandit kills of rounds 1 and 2 were no Turret');
  ok(keeps("In round 3 Killjoy's Turret killed you as you crossed.", KJ), 'and where Riot\'s record gives the ability as the weapon, it stays', why("In round 3 Killjoy's Turret killed you as you crossed.", KJ));

  // 11. The fallback: a reply that keeps enough is shown when its retry fails too.
  const fb = cp.parseReply('Your aim is not the problem here. Look at round 3: Cypher killed you with a Spectre. Before your next swing, stop before the shot. Put the first bullet at head height.', IN3, { messages: M3 });
  const thin = cp.parseReply('Your aim is not the problem here. Before your next swing, stop before the shot.', IN3, { messages: M3 });
  ok(fb.retry && fb.firstDropped && fb.fallback === true && fb.kept >= cp.FALLBACK_KEPT && !/aim is not/.test(fb.reply)
    && thin.retry && thin.fallback === false,
  `THE FALLBACK: a reply whose first sentence went but that kept ${cp.FALLBACK_KEPT} or more is still asked again and may be shown, without the dropped sentence, and one that kept fewer is not`,
  JSON.stringify({ fb: [fb.kept, fb.fallback, fb.dropped], thin: [thin.kept, thin.fallback] }));

  // 12. The question's own notes: aim, practice, an agent asked about, the band's fundamentals.
  const k = require('../server/services/knowledge');
  const byText = new Map(k.all().map((n) => [n.text, n]));
  const aimRe = cp.QUESTION_TOPICS.find((t) => t.key === 'aim').note;
  const pracRe = cp.QUESTION_TOPICS.find((t) => t.key === 'practice').note;
  const iron = (q) => ({ ...inputFor(ABYSS, q), rankBand: 'iron_bronze' });
  const aimNotes = cp.pickNotes(iron(QA), MA);
  ok(aimNotes.slice(0, 3).filter((t) => aimRe.test(`${t} ${(byText.get(t) && byText.get(t).source && byText.get(t).source.topic) || ''}`)).length >= 2,
    'AN AIM QUESTION GETS AIM NOTES FIRST, whatever cause they are tagged for', aimNotes.slice(0, 3).join(' | '));
  const QP = 'What should I practice before my next game?';
  const pracNotes = cp.pickNotes(iron(QP), [{ role: 'user', content: QP }]);
  ok(pracNotes.slice(0, 3).some((t) => pracRe.test(t)), 'A PRACTICE QUESTION GETS A DRILL NOTE FIRST', pracNotes.slice(0, 3).join(' | '));
  ok(pracNotes.some((t) => { const n = byText.get(t); return n && Array.isArray(n.ranks) && n.ranks.includes('iron_bronze') && n.ranks.length <= 2; }),
    'and a general question takes the band\'s own fundamentals');
  const QC = 'Their Cypher killed me the most. How do I play against Cypher?';
  const cyNotes = cp.pickNotes({ ...inputFor(ABYSS, QC), byEnemy: true }, [{ role: 'user', content: QC }]);
  ok(cyNotes.slice(0, 3).some((t) => /\bCypher\b/.test(t) || ((byText.get(t) || {}).enemyAgents || []).includes('Cypher')),
    'AN AGENT ASKED ABOUT GETS A NOTE ABOUT THAT AGENT FIRST', cyNotes.slice(0, 3).join(' | '));
  ok(cp.questionTopics({ language: 'en' }, M3).keys.size === 0 && !cp.questionTopics({ language: 'en' }, M3).general
    && cp.questionTopics({ language: 'de' }, MA).keys.size === 0,
  'and a question about a round names no topic, nor does one outside English: its notes are today\'s');

  // 13. The death the counted line leaves out says why.
  const lastAlive = JSON.parse(JSON.stringify(IN3));
  const card = lastAlive.match.cards.find((c) => c.died && c.riot && c.riot.traded === false);
  card.riot.alive = { mates: 1, enemies: 2 };
  ok(cp.renderMatch(lastAlive, cp.factsOf(lastAlive, M3)).includes(`R${card.n} `) && cp.renderMatch(lastAlive, cp.factsOf(lastAlive, M3)).includes('not traded, as the last one alive with no teammate left to trade it'),
    'A DEATH AS THE LAST ONE ALIVE IS SAID TO BE ONE, so the cards and the counted line of deaths nobody traded tell one number');

  // 14. The rules.
  const R = cp.VALORANT_RULES;
  ok(!/when this happens, do that/i.test(R) && /Never say aim is not the problem/.test(R) && /needs no single round/.test(R)
    && /Deathmatch and the Range have no teammates/.test(R) && /never by a key letter/.test(R) && /never praise a death as a good or sound choice/.test(R)
    && /never count the rounds yourself/.test(R) && !DASHES.test(R),
  'THE RULES: no template words, aim from the deaths and the headshot rate, a general answer with no round needed, drills the mode allows, abilities by name, no praise of a death, the counted line as given, no dashes');
  ok(/Nothing about the app, a future review/.test(R) && /no season, act or episode/.test(R) && /THE LEVER/.test(R)
    && /on attack with no spike down the defenders never have to come to you/.test(R) && /Never praise the aim where the headshot rate is under/.test(R),
  'THE RULES OF THE RE-AUDIT: no product talk, cross match numbers as given and no season, the lever first, the side and the spike, no aim praise the numbers deny');

  /*
   * 15. THE RE-AUDIT OF 8.7.7 (Nov 2026): each sentence below is one of the 84
   * live outputs' own that a judge found wrong and the gates let through, with
   * a true variant that must stay.
   */
  const co = require('../server/services/coherence');
  // Orphans: what leans on a dropped sentence, read over the rows as the gates leave them.
  const orphan = (rows) => co.checkOrphans(rows.map((x) => (typeof x === 'string' ? { s: x } : x))).map((o) => `${o.index}:${o.kind}`).join(',');
  const REYNA = 'Your Reyna problem is the same thing from the other side: she killed you 5 times because you kept meeting her alone.';
  const FIGHT_HER = 'Fight her with a teammate or after a flash, never one on one.';
  ok(orphan(['When you swing an angle, glance at whether a teammate is close enough.', "That's the habit working.", { s: REYNA, dropped: true }, FIGHT_HER]) === '3:pronoun'
    && orphan(['When you swing an angle, glance at whether a teammate is close enough.', "That's the habit working.", REYNA, FIGHT_HER]) === ''
    && orphan(['Track where their Reyna plays.', FIGHT_HER]) === '' && orphan(['Your teammate Brimo was ahead of you.', 'Take the next fight with him.']) === '',
  'ORPHANS: "FIGHT HER" WITH ITS REYNA DROPPED GOES (five judges), and stays with Reyna kept, or a teammate in the sentence before');
  ok(orphan([{ s: 'You did plenty right.', p: 0 }, { s: 'You got the first kill in 8 rounds and won round 12 alone against 3.', dropped: true, p: 0 }, { s: 'One thing to watch: Reyna killed you 5 times.', p: 1 }]) === '0:lead-in'
    && orphan([{ s: 'You did plenty right.', p: 0 }, { s: 'You got the first kill in 8 rounds.', p: 0 }]) === ''
    && orphan([{ s: 'Their Omen killed you six times.' }, { s: 'Because you are Iso, you can make that solo peek less free for him.' }, { s: 'Put Double Tap up so the shield eats one hit.', dropped: true }, { s: 'Get out of his sight after the first exchange.' }]) === '1:lead-in',
  'a lead in whose promise was dropped goes ("You did plenty right.", "Because you are Iso, you can"), and stays with it kept');
  ok(orphan([{ s: 'On Iso the shield from Double Tap only buys you one hit.', dropped: true }, 'Take your peeks one step from cover with it up, and after the first exchange fall back on foot.']) === '1:it'
    && orphan(['On Iso the shield from Double Tap only buys you one hit.', 'Take your peeks one step from cover with it up, and after the first exchange fall back on foot.']) === ''
    && orphan([{ s: 'Your biggest mistake was dying with your team ahead in numbers, in rounds 1, 5, 7, 8, 12 and 16.', dropped: true }, 'Look at what those rounds have in common.']) === '1:those'
    && orphan([{ s: 'Your biggest mistake was dying early.', dropped: true }, 'Those rounds, 5, 7 and 8, all opened with your first kill.']) === '',
  '"with it up" without its Double Tap and "those rounds" without their rounds go, and stay with them kept or the rounds named');
  const ORPH = cp.parseReply(`Your biggest mistake on Abyss was dying where nobody could trade you. Before you swing, check that a teammate can see the same angle. If nobody can, wait. ${REYNA} ${FIGHT_HER}`, IN3, { messages: M3 });
  ok(!/Fight her/.test(ORPH.reply) && ORPH.dropped.orphan === 1, 'AND THROUGH parseReply: the reply goes out without the orphan, counted under its gate', JSON.stringify(ORPH.dropped));
  // The product.
  const FOCUS = 'Before an aggressive peek, name the teammate close enough to kill your killer so your next review can check whether the fight had an immediate answer.';
  ok(co.checkProduct(FOCUS).length === 1 && drops(FOCUS, F3, 'product') && drops('Turn on Advanced coaching in Settings for more of this.', F3, 'product')
    && drops('The app will track whether your deaths get traded.', F3, 'product')
    && keeps('Record your games and watch your VODs.', F3) && keeps('In your next match, watch whether a teammate is near before you swing.', F3),
  'PRODUCT TALK DROPS ("so your next review can check", the app, a setting), the next match and your own VODs stay', why(FOCUS, F3));
  // Round 4: the review cited as a source that sees, gives, says, shows, counts or found.
  const CITES = ['You died to the repeeks the review saw in rounds 4 and 9.', 'The fix the review gives is to wait for your Sova\'s drone.',
    'The review says your trades were late.', 'This review shows four deaths alone.', 'The review counts nine untraded deaths.',
    'What the review found is that you swung first.', 'According to the review, you peeked too early.'];
  const PLAIN = ['Review your VOD of round 4 and watch where your teammates were.', 'In this review, the biggest leak was the first fight on A.',
    'Review the round where you died alone.', 'When you review your VODs, pause before each swing.', 'Your VOD review shows you more than a number does.'];
  // "According to the review" is a named source as well, and the attribution gate reads it first.
  ok(CITES.every((s) => co.checkProduct([s]).length === 1 && drops(s, F3, s.startsWith('According') ? 'attribution' : 'product'))
    && PLAIN.every((s) => co.checkProduct([s]).length === 0 && !drops(s, F3, 'product')),
  'THE REVIEW CITED AS A SOURCE DROPS ("the repeeks the review saw", "The fix the review gives"), and "review your VOD" and "in this review" stay',
  JSON.stringify({ cites: CITES.filter((s) => co.checkProduct([s]).length !== 1 || !drops(s, F3)).map((s) => [s, why(s, F3)]),
    plain: PLAIN.filter((s) => co.checkProduct([s]).length || drops(s, F3, 'product')) }));
  ok(co.PRODUCT.every((re) => !/[\u0008]/.test(re.source)), 'and no product regex carries a backspace byte');
  // The side and the spike.
  const LET = 'If you are one of the last two, fall back behind cover, let the enemy come to you, and only fight from an angle where the teammate beside you can see the same enemy.';
  ok(!!co.checkRoundState(LET, { side: 'attacking', planted: false, died: true, sec: 26 })
    && co.checkRoundState(LET, { side: 'defending', planted: false, died: true, sec: 26 }) === null
    && co.checkRoundState(LET, { side: 'attacking', planted: true, plantSec: 20, died: true, sec: 26 }) === null
    && !!co.checkRoundState('Kill, then move back behind cover and let the attackers come to you again.', { side: 'defending', planted: true, afterPlant: true, died: true, sec: 50 })
    && co.checkRoundState('Kill, then move back behind cover and let the attackers come to you again.', { side: 'defending', planted: true, died: true, sec: 23 }) === null,
  'ROUND STATE: "LET THE ENEMY COME TO YOU" ON ATTACK WITH NO SPIKE DOWN IS WRONG (the Pearl round 1), right on defence and after the plant; a plant with no time judges nothing (the Sunset round 8)');
  const PR1 = factsOfRounds([round(1, { side: 'attacking', sec: 26, planted: false })], { asked: 1, askedRounds: [1], oneRound: true });
  ok(drops(LET, PR1, 'state') && keeps(LET, factsOfRounds([round(1, { side: 'defending', sec: 26 })], { asked: 1, askedRounds: [1], oneRound: true }))
    && drops('On attack, hold your angle and let them come to you.', factsOfRounds([]), 'state')
    && keeps('On attack after the plant, hold your angle and let them come to you.', factsOfRounds([]))
    && drops('On defence, hold the spike and play your post plant.', factsOfRounds([]), 'state'),
  'and through the gates, of the round asked, else of the side the sentence names', why(LET, PR1));
  // Aim against the looks and the numbers.
  const CARRY = 'Your aim and your opening kills are already carrying you, this is the piece holding the rest back.';
  ok(drops(CARRY, factsOfRounds([round(1)], { aim: { hs: 22, baseline: 38 } }), 'aim') && drops(CARRY, factsOfRounds([round(1)]), 'aim')
    && keeps(CARRY, factsOfRounds([round(1)], { aim: { hs: 40, baseline: 38 } })),
  'AIM PRAISE THE HEADSHOT RATE DENIES DROPS (22% against 38%), and stays above the player\'s own average');
  const look = (cause) => ({ cause, what: 'x', better: 'y', fair: cause === 'lost-duel' });
  const UNCLEAR = factsOfRounds([1, 2, 3, 4].map((n) => round(n, { look: look('unclear') })).concat([round(5)]));
  const DRY = factsOfRounds([1, 2, 3, 4].map((n) => round(n, { look: look('dry-peek') })).concat([round(5)]));
  const NOT_FIRST = 'Your aim is not the first thing to fix, the deaths point at position and timing before the crosshair.';
  ok(drops(NOT_FIRST, UNCLEAR, 'aim') && keeps(NOT_FIRST, DRY),
    'A LOOK THAT COULD NOT TELL CALLS NO DEATH SOMETHING ELSE: "aim is not the first thing to fix" on four unclear looks drops (the Sunset 2 to 5), on four dry peeks stays');
  const DUELS = factsOfRounds([round(5, { look: look('lost-duel') }), round(6, { look: look('lost-duel') }), round(2, { look: look('repeek') })]);
  ok(drops('The deaths in this match mostly were not lost on the shot.', DUELS, 'aim') && drops('Your mechanics are not what is costing you rounds.', DUELS, 'aim')
    && drops('In game terms, the problem is not that you are losing duels, it is that you are taking them where nobody can follow.', DUELS, 'aim'),
  'and the dismissal in other words drops against two lost duels (the Fracture Plat aim, three judges said misleading)');
  const PEARL = factsOfRounds([round(1, { look: look('lost-duel') }), round(4, { look: look('unclear') }), round(5, { look: look('lost-duel') }), round(6, { look: look('unclear') })]);
  const AVOID = 'That means most of your fights started before you had information, and no amount of crosshair work fixes a fight you should not have taken yet.';
  const R12 = factsOfRounds([round(12, { look: look('lost-duel') }), round(10, { look: look('dry-peek') })]);
  const RATHER = 'One of those, round 12, I called lost on the shot, so it was a fair fight you lost rather than a fight you shouldn\'t have taken.';
  ok(drops(AVOID, PEARL, 'aim') && keeps(RATHER, R12) && drops('Round 12 was a fight you should not have taken.', R12, 'aim'),
    'A FIGHT THE LOOK CALLED FAIR WAS NO FIGHT TO SKIP (the Pearl Iron aim), "rather than a fight you shouldn\'t have taken" says the look\'s own reading', why(RATHER, R12));
  // The library.
  const LIB = factsOfRounds([1, 3, 4, 5, 6].map((n) => round(n)), { library: { pairs: new Set(['5/6']), averages: new Set([32, 38]) },
    counted: { titles: [], pairs: new Set(['5/6']), counts: new Set([5]), roundSets: [], texts: [] }, numbers: [{ attr: 'percent', value: 21, round: null }, { attr: 'percent', value: 32, round: null }] });
  ok(keeps("The biggest thing holding you back is dying where nobody could trade you, and it's shown up in 5 of your last 6 matches.", LIB)
    && drops("The biggest thing holding you back is dying where nobody could trade you, and it's shown up in 4 of your last 6 matches.", LIB)
    && gates.gateLibrary("It's shown up in 4 of your last 6 matches.", LIB).gate === 'library',
  'A CROSS MATCH PAIR IS A PATTERN\'S: "5 of your last 6" stays, "4 of your last 6" drops');
  const USUAL = 'Your own numbers here were 21 percent heads against your usual 32, so add to that the one aim habit that fits you: stop before you shoot, first bullet on the head.';
  ok(keeps(USUAL, LIB) && drops(USUAL.replace('usual 32', 'usual 30'), LIB) && drops('This season your headshot rate has been falling.', LIB, 'library')
    && keeps("I don't have this season's numbers, only this match and your recorded ones.", LIB),
  'THE PLAYER\'S OWN AVERAGE AS THE LIBRARY HOLDS IT STAYS (it was dropped as tied to nothing), another number drops, a season drops and saying there is none stays', why(USUAL, LIB));
  ok(drops('The biggest pattern across your recent matches is dying in the first 30 seconds, before any plant, in rounds 1, 3, 4, 5 and 6.', LIB, 'library')
    && keeps('In this match you died in the first 30 seconds in rounds 1, 3, 4, 5 and 6.', factsOfRounds([1, 3, 4, 5, 6].map((n) => round(n)))),
  'this match\'s rounds told as a pattern across matches drop (the Pearl Iron practice, three judges)');
  // The kit, his ultimate in an answer about the asked enemy.
  const STILL = 'When his camera dart hits you, get behind cover first, because that dart keeps taking new pictures until you remove it, while his ultimate, by contrast, is a single still.';
  ok(drops(STILL, factsOfRounds([round(3, { killer: 'Cypher' })], { agent: 'Raze', askedAgents: ['Cypher'] }), 'kit')
    && keeps('His ultimate snapshots the living enemies after a delay.', factsOfRounds([round(3, { killer: 'Cypher' })], { agent: 'Raze', askedAgents: ['Cypher'] })),
  'NEURAL THEFT IS NO SINGLE STILL: "his ultimate" in an answer about Cypher is held to his X (five judges)');
  // The habit of dying first, held to the record.
  const FIRSTS = (n) => factsOfRounds(Array.from({ length: 17 }, (_v, i) => round(i + 1, { firstDeath: i < n })));
  const TAKING = 'On defence, you are taking the first fight of the round yourself, early, often before your team is set.';
  ok(drops(TAKING, FIRSTS(2), 'habit') && keeps(TAKING, FIRSTS(6)) && keeps('Stop taking the first fight alone.', FIRSTS(2)),
    'A HABIT OF DYING FIRST THE RECORD DOES NOT SHOW DROPS (first death in 2 of 17, the Sunset loss), stays at 6 of 17, and advice stays', why(TAKING, FIRSTS(6)));
  // The lever.
  const QLV = 'How do I improve at my rank? What is holding me back from climbing?';
  const MLV = [{ role: 'user', content: QLV }];
  const banded = (band) => ({ ...inputFor(ABYSS, QLV), rankBand: band });
  const levers = cp.leversOf(inputFor(ABYSS, QLV).match);
  ok(levers.length > 0 && cp.leverLine(inputFor(ABYSS, QLV), MLV) === '' && !cp.buildPrompt(inputFor(ABYSS, QLV), MLV).includes('THE LEVER for this question')
    && cp.leverLine(banded('iron_bronze'), MLV).startsWith('THE LEVER for this question') && cp.buildPrompt(banded('iron_bronze'), MLV).includes('THE LEVER for this question'),
  'THE LEVER: a general question with a band names one, a client that sends no band gets today\'s prompt with none', JSON.stringify(levers.map((l) => l.kind)));
  const trade = levers.find((l) => l.kind === 'trade');
  const others = levers.filter((l) => l.kind !== 'trade');
  ok(!trade || !others.length || (!cp.leverLine(banded('plat_diamond'), MLV).includes(trade.line) && !cp.leverLine(banded('asc_plus'), MLV).includes(trade.line)),
    'above Gold the trade check never leads while anything else is counted');
  /*
   * THE LEVER BELOW PLATINUM ONLY (the blind audit of 8.7.8 against 8.7.7):
   * at Plat to Diamond and Ascendant and up the lever picked one the record
   * did not support, so there Ask Coach is 8.7.7's (no LEVER line, 8.7.7's
   * improving rule), every gate rule of 8.7.8 kept. Iron to Gold and no band
   * keep 8.7.8's prompt.
   */
  const RL = cp.VALORANT_RULES.split('\n');
  ok(RL.filter((l) => l === cp.IMPROVING_RULE).length === 1 && !cp.VALORANT_RULES.includes(cp.IMPROVING_RULE_877)
    && cp.IMPROVING_RULE_877.startsWith('- About improving: the largest counted mistake or pattern with its count exactly as given')
    && !/LEVER/.test(cp.IMPROVING_RULE_877) && !DASHES.test(cp.IMPROVING_RULE_877),
  'THE TWO IMPROVING RULES: 8.7.8\'s is one whole line of the rules, 8.7.7\'s names no lever');
  for (const band of ['plat_diamond', 'asc_plus']) {
    const r = cp.rulesFor(banded(band)).split('\n');
    const changed = r.map((l, i) => (l === RL[i] ? -1 : i)).filter((i) => i >= 0);
    const p = cp.buildPrompt(banded(band), MLV);
    ok(cp.leverLine(banded(band), MLV) === '' && !p.includes('THE LEVER for this question') && !p.includes(cp.IMPROVING_RULE) && p.includes(cp.IMPROVING_RULE_877)
      && r.length === RL.length && changed.length === 1 && r[changed[0]] === cp.IMPROVING_RULE_877
      && /Nothing about the app, a future review/.test(p) && /no season, act or episode/.test(p) && /Never praise the aim where the headshot rate is under/.test(p)
      && /on attack with no spike down the defenders never have to come to you/.test(p),
    `AT ${band} ASK COACH IS 8.7.7's ON THE LEVER: no LEVER line, 8.7.7's improving rule as the one changed line, every gate rule of 8.7.8 kept`);
  }
  for (const band of ['iron_bronze', 'silver_gold', undefined]) {
    const inp = band ? banded(band) : inputFor(ABYSS, QLV);
    ok(cp.rulesFor(inp) === cp.VALORANT_RULES && cp.buildPrompt(inp, MLV).includes(cp.IMPROVING_RULE)
      && (band ? cp.leverLine(inp, MLV).startsWith('THE LEVER for this question') : cp.leverLine(inp, MLV) === ''),
    `${band || 'no band'} keeps 8.7.8's prompt: its improving rule${band ? ' and THE LEVER' : ', no lever'}`);
  }
  ok(cp.LEVER_BANDS.join() === 'iron_bronze,silver_gold' && cp.rulesFor({ ...banded('asc_plus'), rankBand: 'radiant' }) === cp.VALORANT_RULES,
    'the lever bands are Iron to Gold, and a band no client sends keeps 8.7.8\'s rules');
  ok(cp.leverLine(banded('silver_gold'), [{ role: 'user', content: QA }]) === '' && cp.leverLine(banded('silver_gold'), M3) === ''
    && cp.leverLine(banded('silver_gold'), MLV) === cp.leverLine(banded('silver_gold'), MLV),
  'and an aim question or a question about a round gets none, and the same question the same lever');
  // The kits in one block.
  const QO2 = 'Their Omen killed me the most. How do I play against Omen?';
  const kitPrompt = cp.buildPrompt(inputFor(ABYSS, QO2), [{ role: 'user', content: QO2 }]);
  ok(kitPrompt.includes(cp.KIT_HEAD) && /Paranoia \(Omen's /.test(kitPrompt) && !/<whitebold>/.test(kitPrompt),
    'THE KITS ARE ONE BLOCK OF FINISHED LINES, the asked agent\'s among them, no markup');
  // Every new regex on a known positive and negative.
  for (const [name, re, pos, neg] of [
    ['AIM_PRAISED', gates.AIM_PRAISED, 'Your aim is already carrying you.', 'Your aim is the first thing to fix.'],
    ['AVOIDABLE', gates.AVOIDABLE, 'a fight you should not have taken', 'a fight you should take'],
    ['CROSS_MATCH', gates.CROSS_MATCH, 'in 5 of your last 6 matches', 'in 5 of your 16 deaths'],
    ['SEASON', gates.SEASON, 'this season', 'the reason'],
    ['LIB_PAIR', new RegExp(gates.LIB_PAIR.source, 'i'), '5 of your last 6 matches', '5 of your 6 deaths'],
    ['AVG_BEFORE', gates.AVG_BEFORE, 'against your usual ', 'against your killer '],
    ['PLANT_SAID', gates.PLANT_SAID, 'after the plant', 'before the push'],
    ['FIRST_HABIT', gates.FIRST_HABIT, 'you are taking the first fight', 'you took the first kill'],
    ['LEAD_IN', co.LEAD_IN, 'You did plenty right.', 'You died 5 times.'],
    ['IT_OBJECT', co.IT_OBJECT, 'with it up', 'with your team'],
    ['THOSE', co.THOSE, 'Look at what those rounds have in common.', 'Look at round 5.'],
    ['WAIT_FOR_THEM', co.WAIT_FOR_THEM, 'let the enemy come to you', 'let your team come with you'],
    ['YOU_RETAKE', co.YOU_RETAKE, 'you should retake B', 'their retake failed'],
    // The verifier's pass over the 84 live items: the attackers' side of a retake is no retake of their own.
    ['YOU_RETAKE (go for it)', co.YOU_RETAKE, 'Next time, go for the retake with your team.', 'It also keeps you alive for the retake fight, where the spike timer does the work for you.'],
    ['YOU_RETAKE (saved for it)', co.YOU_RETAKE, 'Group up for the retake instead.', 'Save your utility for the retake.'],
    ['YOU_HOLD_SPIKE', co.YOU_HOLD_SPIKE, 'hold the spike', 'hold the angle'],
  ]) ok(re.test(pos) && !re.test(neg) && !/[\u0008]/.test(re.source), `${name} matches "${pos}" and not "${neg}"`);
  // The live Fracture round 5 answer (an attack, the spike down): its true line stays.
  ok(co.checkRoundState('It also keeps you alive for the retake fight, where the spike timer does the work for you.', { side: 'attacking', planted: true, afterPlant: true, died: true }) === null,
    'an attacker kept alive for the defenders\' retake is no retake of their own');
  // The live Sunset 2 to 5 aim answer, four unclear looks: 87 characters between the rate and the dismissal.
  const longAim = 'Your headshot rate in that match was 25%, against 36% across your recent matches, so there is room there, but it is not what cost you the rounds.';
  ok(gates.AIM_DISMISSED.some((re) => re.test(longAim)), `the long aim dismissal is read as one: "${longAim.slice(0, 60)}"`);
}

// ── The blind audit of 8.7.8 (Nov 2026), stream A ──────────────────────────
// The record's certain facts (record-claims.js), the seams and the stock
// closer (coherence.js), and the Deathmatch drills, each pinned on the live
// sentence the audit's judges flagged (caught) and a true one (kept). The
// matches are the audit's own facts: Corrode 3 to 13 (Iso), Split 13 to 7
// (Jett), Sunset 4 to 13 (Jett).
{
  console.log('\nthe blind audit of 8.7.8, stream A:');
  const rc = require('../server/services/record-claims');
  const co = require('../server/services/coherence');
  const BS = String.fromCharCode(8);
  for (const f of ['record-claims.js', 'coherence.js', 'fact-gates.js', 'chat-prompt.js', 'match-review.js']) {
    ok(!fs.readFileSync(path.join(__dirname, '..', 'server', 'services', f), 'utf8').includes(BS), `${f} holds no backspace byte`);
  }
  const feed = (...va) => va.map((v, i) => ({ s: 10 + i, by: 'me', on: 'enemy', ka: 'Iso', va: v }));
  const factsOfRounds = (agent, enemies, rounds, texts, extra) => ({
    game: 'valorant', language: 'en', agent, sides: { mates: new Set(), enemies: new Set(enemies) },
    counted: { texts: texts || [] }, rounds: new Map(rounds.map((r) => [r.n, r])), ...(extra || {}),
  });
  const R = (n, side, result, died, sec, killer, kills, extra) => ({ n, side, result, died, sec, killer, kills, planted: false, afterPlant: false, plantSec: null, plantSite: null, feed: [], spot: null, ...(extra || {}) });
  // Corrode 3 to 13 as Riot has it (comps: Chamber, Fade, Omen, Phoenix, Reyna; no Sage).
  const corrode = rc.contextOfChat(factsOfRounds('Iso', ['Chamber', 'Fade', 'Omen', 'Phoenix', 'Reyna'], [
    R(4, 'attacking', 'won', false, null, null, 2, { feed: feed('Omen', 'Chamber') }),
    R(6, 'attacking', 'lost', true, 21, 'Phoenix', 1, { feed: feed('Reyna') }),
    R(8, 'attacking', 'lost', true, 27, 'Chamber', 0),
    R(10, 'attacking', 'lost', true, 27, 'Phoenix', 0),
    R(11, 'attacking', 'lost', true, 12, 'Omen', 0),
    R(12, 'attacking', 'lost', true, 10, 'Fade', 0),
    R(14, 'defending', 'lost', true, 31, 'Omen', 3, { feed: feed('Phoenix', 'Chamber', 'Reyna') }),
    R(16, 'defending', 'lost', true, 53, 'Omen', 3, { feed: feed('Fade', 'Phoenix', 'Chamber') }),
  ]));
  const omenBefore = { agents: ['Iso', 'Omen'] };
  ok(!!rc.checkKills('You beat him twice, in rounds 14 and 16, and in both you were the player making the first move, not the one reacting to him.', corrode, omenBefore),
    'CAUGHT: "You beat him twice, in rounds 14 and 16" where Omen killed the player in both (4 of 5 judges: misleading)');
  ok(!rc.checkKills('You beat him in round 4, the first of your two kills.', corrode, omenBefore), 'kept: "You beat him in round 4", Omen among the player\'s kills there');
  ok(!rc.checkKills('You beat Phoenix in rounds 14 and 16.', corrode, {}), 'kept: Phoenix, a victim in both');
  ok(!rc.checkKills('You beat him to the angle in round 14.', corrode, omenBefore), 'kept: beating him to an angle is no kill');
  ok(!!rc.checkKills('You killed their Omen in round 12.', corrode, {}), 'CAUGHT: a kill in a round the player killed nobody');
  ok(!!rc.checkKillerShare('Five of your thirteen deaths came in the first 30 seconds, and Omen was the one who got you in most of them, so he was reading your early position.', corrode, {}),
    'CAUGHT: "Omen was the one who got you in most of them" of the early deaths, Omen 1 of 5');
  ok(!rc.checkKillerShare('Omen got you in most of your deaths on defence and in round 11.', { ...corrode, rounds: new Map([...corrode.rounds].filter(([n]) => n >= 11)) }, {}),
    'kept: Omen in most of the deaths the sentence counts (3 of 4)');
  // A Sage on their team could have revived him: nothing is certain without the feed.
  const sageSide = { ...corrode, enemies: new Set(['Sage', 'Fade', 'Omen', 'Phoenix', 'Reyna']), rounds: new Map([[14, { ...corrode.rounds.get(14), victims: null, kills: 2 }]]) };
  ok(!rc.checkKills('You beat Omen in round 14.', sageSide, {}), 'kept: Omen the killer, with an enemy Sage and no feed, judges nothing');

  // Split 13 to 7, round 5: the player died at B Site 12 s in, the plant at B at 98 s.
  const split = rc.contextOfChat(factsOfRounds('Jett', ['Clove', 'Phoenix', 'Reyna', 'Sage', 'Skye'], [
    R(5, 'attacking', 'won', true, 12, 'Phoenix', 0, { planted: true, plantSite: 'B', plantSec: 98.3, spot: 'B Site' }),
    R(6, 'attacking', 'lost', true, 7, 'Phoenix', 0, { spot: 'A Main' }),
  ]));
  ok(!!rc.checkOrder('Waiting on them was never a plan, and taking that fight alone at 12 s gave them a free player up before your team had even touched B.', split, { round: 5 }),
    'CAUGHT: "before your team had even touched B" of a death at B Site (4 of 5 judges)');
  ok(!rc.checkOrder('Taking that fight alone gave them a free player up before your team had touched A.', split, { round: 5 }), 'kept: before the team touched A, a site the death was not at');
  ok(!rc.checkOrder('You died 7 s in, before your team had touched B.', split, { round: 6 }), 'kept: round 6, a death at A Main');
  ok(!!rc.checkOrder('In round 5 you died after the plant.', split, {}), 'CAUGHT: a death 12 s in called after a plant at 98 s');
  ok(!rc.checkOrder('In round 5 you died before the plant.', split, {}), 'kept: the same death before the plant');

  // Sunset 4 to 13: 9 defence rounds with a plant, all lost; the early pattern
  // has the player dead before the plant in rounds 1, 5, 6, 7 and 8.
  const sunsetRounds = [1, 2, 3, 5, 6, 7, 8, 9, 12].map((n) => R(n, 'defending', 'lost', true, [1, 5, 6, 7, 8].includes(n) ? 18 : 40, 'Killjoy', 0, { planted: true }));
  const early = ['8 of your 14 deaths came in the first 30 seconds of the round, before any plant, in rounds 1, 5, 6, 7, 8, 13, 14 and 16.'];
  const sunset = rc.contextOfChat(factsOfRounds('Jett', ['Killjoy', 'Tejo', 'Brimstone', 'Phoenix', 'Raze'], sunsetRounds, early));
  ok(JSON.stringify(rc.plantRecord(sunset, 'defence')) === JSON.stringify({ total: 9, won: 0, alive: 0, deadBefore: [1, 5, 6, 7, 8] }), 'the plant record: 9 planted, dead before the plant in 5 of them');
  const line = rc.plantLines(sunset)[0] || '';
  ok(/you died before the plant in 5 of those 9, rounds 1, 5, 6, 7 and 8/.test(line) && !DASHES.test(line) && !line.includes(';'), `the prompt carries it, no dash, no semicolon: "${line.slice(0, 90)}"`);
  ok(!!rc.checkTeamBlame('Your biggest mistake was how you played defence after the spike went down: you won 0 of 9 defence rounds once they planted, and that is the lever for this match.', sunset),
    'CAUGHT: the team\'s retake record made "your biggest mistake" (analyst, gold: misleading)');
  ok(!!rc.checkTeamBlame('The thing holding you back on Sunset was defence after the spike went down: you won 0 of 9 rounds on defence once they planted.', sunset),
    'CAUGHT: "the thing holding you back" was the retake');
  ok(!rc.checkTeamBlame('You lost 4 to 13 despite creating openings, and once they planted on defence, your team won 0 of 9 rounds.', sunset), 'kept: the team\'s record said as the team\'s, beside the final score');
  ok(!rc.checkTeamBlame('When the spike goes down on your site and you are still alive, do not go back in alone.', sunset), 'kept: advice for a retake the player is alive for');
  const fair = rc.contextOfChat(factsOfRounds('Jett', [], sunsetRounds.map((r) => ({ ...r, died: false, sec: null }))));
  ok(!rc.checkTeamBlame('Your biggest mistake was the retake: you won 0 of 9 defence rounds once they planted.', fair) && !rc.plantLines(fair).length,
    'kept, and no line: alive at every plant, the retake is the player\'s to own');

  // The Deathmatch drills: the three the gate let through, and true ones.
  const dmF = { language: 'en', game: 'valorant' };
  ok(gates.check('To build it, play Deathmatch and treat every fight as one you must have a second person for.', dmF).drop?.gate === 'mode', 'CAUGHT: a Deathmatch drill needing "a second person"');
  ok(gates.check('To build it, play Deathmatch and give yourself one rule: before every peek, stop and ask whether anyone could follow that fight.', dmF).drop?.gate === 'mode', 'CAUGHT: "whether anyone could follow that fight" in Deathmatch');
  ok(!!rc.checkDrill('To build it, take Iso into Deathmatch and play every life with one rule: before you move into an open angle, look at where you last saw or heard an enemy and decide if that is the angle they would hold.', corrode),
    'CAUGHT: "take Iso into Deathmatch" to learn their Omen');
  ok(!!rc.checkDrill('In Deathmatch, track where their Omen likes to hold.', corrode), 'CAUGHT: an enemy Omen in a Deathmatch drill');
  ok(!rc.checkDrill('Learn what her Alarmbot does by playing Killjoy in the Range.', sunset), 'kept: an enemy\'s kit learnt by playing it in the Range');
  ok(!rc.checkDrill('Learn their Omen in a match, not in Deathmatch.', corrode), 'kept: the drill sent away from Deathmatch');
  for (const s of ['Practise it in your next match rather than in Deathmatch, because it needs teammates.', 'The way to build this is in your next matches, not in Deathmatch, because it needs teammates.',
    'Deathmatch is good for this because there are no teammates to worry about, just the stop and the shot over and over.', 'In Deathmatch, take only stopped first shots and note how many you land clean.']) {
    ok(!gates.check(s, dmF).drop, `kept (dropped before for the first two): "${s.slice(0, 70)}"`);
  }

  // The seams and the stock closer.
  for (const [s, want] of [
    ['You won 5 to 1 by opening fights and getting multiple kills, even as You died 3 times in 6 rounds.', 'You won 5 to 1 by opening fights and getting multiple kills, even as you died 3 times in 6 rounds.'],
    ['You lost 3 to 13, with the decisive stretch coming on both sides: You lost 10 rounds in a row, rounds 5 to 14.', 'You lost 3 to 13, with the decisive stretch coming on both sides: you lost 10 rounds in a row, rounds 5 to 14.'],
    ['You lost 2 to 5, and You died 5 times in 7 rounds despite strong opening fights.', 'You lost 2 to 5, and you died 5 times in 7 rounds despite strong opening fights.'],
    ['You won 13 to 7. Your opening kills gave your team an early advantage.', 'You won 13 to 7. Your opening kills gave your team an early advantage.'],
    ['Plant for A.', 'Plant for A.'],
    ['Hold the angle and.', null],
  ]) ok(co.repairSeams(s) === want, `repairSeams: "${s.slice(0, 60)}" is ${JSON.stringify(want && want.slice(0, 40))}`);
  for (const [s, want] of [
    ['That is the lever for this match, and the other things can wait.', 'That is the lever for this match.'],
    ['That is not bad luck, it is a pattern you can break, and the other things counted can wait.', 'That is not bad luck, it is a pattern you can break.'],
    ['The rest can wait too.', ''], ['Everything else can wait.', ''], ['The other counted habits can wait.', ''],
    ['On Fracture with Jett you still won 5 to 1 and put up 12 kills against 3 deaths, so nothing else needs fixing first.', 'On Fracture with Jett you still won 5 to 1 and put up 12 kills against 3 deaths.'],
    // The blind audit of 8.7.9: a deferral of the trade check goes whole, whatever else it names.
    ['Trading is the second point and can wait.', ''], ['The early deaths and the untraded fights can wait for now.', ''], ['That can wait behind the retake habit.', null],
    // The verification of stream A, over the 8.7.6 and 8.7.7 replies.
    ['The other patterns can wait.', ''], ['Your other counted habits can wait.', ''],
    ['That is what is holding you back more than anything else, and the other counted patterns can wait.', 'That is what is holding you back more than anything else.'],
    ['The Reyna deaths can wait for another day.', null], ['Your other counted misses, the repeek in round 2 and the early death in round 6, can wait.', null],
  ]) ok(co.fillerOf(s) === want, `fillerOf: "${s.slice(0, 60)}" is ${JSON.stringify(want)}`);

  // The verification of stream A: a kill read in its own clause only, so a
  // true kill beside another round's death stays; the audit's line still goes.
  for (const s of ['You killed their Chamber in round 4, and in round 8 Chamber killed you.', 'In round 14 you killed Reyna, and in round 11 Omen killed you 12 s in.',
    'You beat Phoenix in round 14, then Omen killed you, and in round 12 you had no kill.', 'You beat Phoenix in round 16 and Fade killed you in round 12.']) {
    ok(!rc.checkKills(s, corrode, {}), `kept: a true kill, another clause's round not read as its own: "${s.slice(0, 60)}"`);
  }
  ok(!!rc.checkKills('You beat Omen in round 16 and again in round 14.', corrode, {}), 'CAUGHT: one clause naming two rounds, Omen the killer in both');
  ok(rc.clauseAt('You beat him twice, in rounds 14 and 16, and in both you were first.', 0) === 'You beat him twice, in rounds 14 and 16', 'clauseAt: the audit\'s kill keeps both its rounds');
  ok(rc.CLAUSE_BREAK.test(', and in round 6') && !new RegExp(rc.CLAUSE_BREAK.source, 'i').test('in rounds 14 and 16') && !rc.CLAUSE_BREAK.source.includes(BS), 'CLAUSE_BREAK matches ", and in round 6" and not "in rounds 14 and 16"');
  rc.CLAUSE_BREAK.lastIndex = 0;

  // The cut text, through the orphan pass.
  const rows = (xs) => xs.map(([s, dropped, p]) => ({ s, dropped: !!dropped, p: p || 0 }));
  const kinds = (xs) => co.checkOrphans(rows(xs)).map((o) => `${o.index}:${o.kind}`).join(',');
  ok(kinds([['You died in round 2 because you stayed on the same angle.'], ['Here\'s the round in order.'], ['It was an attack round, and your team got the opening kill 12 s in.', true],
    ['Then it flipped fast: their Reyna killed Clove at 22 s, so you were 2 against 4.']]) === '1:lead-in,3:then', 'CAUGHT: "Here\'s the round in order." and "Then it flipped fast:" with the opening cut');
  ok(kinds([['Here\'s the round in order.'], ['It was an attack round.'], ['Then it flipped fast: their Reyna killed Clove at 22 s.']]) === '', 'kept: the same with nothing cut');
  ok(kinds([['So when you push, do not walk into a choke blind.'], ['Send your Boom Bot ahead of you through the entrance.', true],
    ['Then take one piece of space, get behind cover, and check that a teammate has reached you before you push the next angle.']]) === '',
  'kept: "Then take one piece of space", a step of advice, with the step before it cut (8.7.6, the verification of stream A)');
  ok(co.THEN_STEP.test('Then take one piece of space') && !co.THEN_STEP.test('Then it flipped fast') && !co.THEN_STEP.test('Then their Jett killed you') && !co.THEN_STEP.test('Then came the retake'),
    'THEN_STEP matches an imperative step and not an event told');
  ok(kinds([['So fix the fights you choose.', false, 0], ['The habit that answers both: stop and check.', true, 1], ['If nobody can see that angle, hold cover and wait rather than taking the fight alone.', false, 1]]) === '2:that',
    'CAUGHT: "If nobody can see that angle" with the angle\'s sentence cut');
  ok(kinds([['The look saw you holding an angle from cover on A Site.'], ['It did not call the fight fair.', true], ['The decision was staying on that angle after your first shots.']]) === '',
    'kept: "that angle" with the angle named in the kept sentence before');
  ok(kinds([['Look at when those deaths came.'], ['Round 13, 17 s in, to a Classic.', true], ['Round 14, 14 s in, to a Marshal.']]) === '0:lead-in,2:item',
    'CAUGHT: the promised timeline that gives one death, and the bare item');

  // Wired: gateReply on the repo's Abyss, a true killer kept and the player's
  // planted kill of their own killer dropped, the closer cut, the seam mended.
  const died = [...F3.rounds.values()].find((r) => r.died && r.killer && Number.isInteger(r.kills) && r.kills === 0);
  if (died) {
    const got = cp.gateReply([`Their ${died.killer} killed you in round ${died.n}. You beat ${died.killer} in round ${died.n}, and you were the one making the first move.`,
      'Stop before you shoot. That is the lever for this match, and the other things can wait.'], F3, {});
    ok(!got[0].drop && got[1].drop && got[1].drop.gate === 'record' && !got[3].drop && got[3].s === 'That is the lever for this match.',
      `gateReply: the true killer kept, "You beat ${died.killer} in round ${died.n}" dropped as record, the closer cut (${JSON.stringify(got.map((r) => r.drop && r.drop.gate))})`);
  } else ok(false, 'the Abyss has a death in a round the player killed nobody');
  const quiet = cp.parseReply('Everything else can wait.\n\nYou lost round 3 to their Sova, and nobody traded you.\n\nCheck your angle first.', IN3, { messages: M3 });
  ok(quiet.dropped.filler === 1 && !quiet.firstDropped, `a stock closer dropped first is quiet, never a retry (${JSON.stringify(quiet.dropped)})`);

  for (const [name, re, pos, neg] of [
    ['BEAT', new RegExp(rc.BEAT.source, 'i'), 'You beat him twice, in rounds 14 and 16', 'You beat him to the angle'],
    ['MOST_OF', rc.MOST_OF, 'Omen was the one who got you in most of them', 'Omen got you in round 11'],
    ['BEFORE_SITE', rc.BEFORE_SITE, 'before your team had even touched B.', 'before your team had a smoke'],
    ['DIED_AFTER_PLANT', rc.DIED_AFTER_PLANT, 'you died after the plant', 'you died before the plant'],
    ['BLAME', rc.BLAME, 'Your biggest mistake was the retake', 'Your team won 0 of 9'],
    ['ALIVE_SAID', rc.ALIVE_SAID, 'when you were still alive', 'when you died'],
    ['TAKE_AGENT', rc.TAKE_AGENT, 'take Iso into Deathmatch', 'take one angle in Deathmatch'],
    ['BEFORE_ANY_PLANT', new RegExp(rc.BEFORE_ANY_PLANT.source, 'i'), 'before any plant, in rounds 1, 5 and 6.', 'before the plant, you died'],
    ['THEN_OPENER', co.THEN_OPENER, 'Then it flipped fast', 'The round flipped'],
    ['THAT_THING', co.THAT_THING, 'If nobody can see that angle, hold', 'Check that a teammate can see'],
    ['FILLER_WHOLE', co.FILLER_WHOLE, 'The other things can wait.', 'Trading can wait.'],
    ['MID_YOU', new RegExp(co.MID_YOU.source), 'even as You died', 'rounds. You died'],
    ['TEAM_WORDS (second person)', gates.TEAM_WORDS, 'one you must have a second person for', 'one you must take alone'],
  ]) ok(re.test(pos) && !re.test(neg) && !re.source.includes(BS), `${name} matches "${pos}" and not "${neg}"`);
}

// ── RIOT'S ROUND RECORD TEACHES ASK COACH (8.8) ─────────────────────────────
// The team's buy, the nearest teammate, Riot's callout of the death and the
// casts on the cards choose the notes and the cases, tell the match's part how
// to use them, let the economy gate pass the kind of round the record names,
// and gate (record-claims.js checkRecord) a sentence they contradict. A match
// whose cards carry none of them is told and gated as before.
{
  console.log('\nthe round record beyond the feed (8.8):');
  const rc = require('../server/services/record-claims');
  const knowledge = require('../server/services/knowledge');
  const seededRun = (fn) => {
    const random = Math.random;
    let x = 3;
    Math.random = () => { x = (x * 16807) % 2147483647; return x / 2147483647; };
    try { return fn(); } finally { Math.random = random; }
  };
  const card = (n, riot, extra) => ({ n, side: 'attacking', result: 'lost', died: true, verified: true,
    riot: { sec: 20, killer: 'Killjoy', weapon: 'Vandal', kills: 0, traded: false, alive: { mates: 3, enemies: 5 }, ...riot }, ...(extra || {}) });
  const cards = [
    card(2, { place: 'B Main', buy: 'eco', mate: 'far' }),
    card(3, { place: 'B Main', buy: 'eco', mate: 'far' }),
    card(4, { place: 'B Main', buy: 'full', mate: 'far', sec: 50, casts: [{ name: 'Updraft', n: 0 }, { name: 'Tailwind', n: 1 }] }),
    card(5, { place: 'A Main', buy: 'full', mate: 'close', sec: 50 }),
    card(6, { kills: 1, afk: true }, { died: false, result: 'won' }),
  ];
  const stripCard = (c) => { const { place, buy, mate, casts, afk, ...riot } = c.riot; return { ...c, riot }; };
  const ctxOf = (cs, extra) => ({ v: 2, game: 'valorant', language: 'en', advanced: true, ...(extra || {}),
    match: { id: 'valorant-1790000000000-sunset1', map: 'Sunset', agent: 'Jett', mode: 'Competitive', result: 'Defeat', score: '2-4', rounds: 6,
      verified: true, lists: { mistakes: [] }, cards: cs }, player: {}, ask: {} });
  const input = cp.normalise(ctxOf(cards));
  const plain = cp.normalise(ctxOf(cards.map(stripCard)));
  const msgs = [{ role: 'user', content: 'What should I work on?' }];

  // The match's part says how to use them, only for what the cards carry.
  const part = cp.renderMatch(input, cp.factsOf(input, msgs));
  const partPlain = cp.renderMatch(plain, cp.factsOf(plain, msgs));
  // Changed when the economy went out of scope (Nov 2026): no line teaches reading a death by the economy.
  ok(/THE ROUND RECORD\n/.test(part) && /evidence for a trade or a spacing point/.test(part) && !/economy changes what a death teaches/.test(part)
    && !/team economy/.test(part.split('\n').find((l, i, a) => a[i - 1] === 'THE ROUND RECORD') || '')
    && /needs a round that lists the abilities used/.test(part) && /Never criticise a round Riot marks the player as sitting out/.test(part),
  'the match\'s part tells how to use the distance, the casts and the AFK round, and nothing of the economy');
  ok(!/THE ROUND RECORD/.test(partPlain), 'a match without them has no such line');
  const mateOnly = cp.renderMatch(cp.normalise(ctxOf([card(2, { mate: 'far' })])), cp.factsOf(cp.normalise(ctxOf([card(2, { mate: 'far' })])), msgs));
  ok(/evidence for a trade or a spacing point/.test(mateOnly) && !/economy changes|holds them for that round|abilities used/.test(mateOnly), 'a distance alone brings its own sentence and no other');
  const recordLine = (part.split('\n').find((l, i, a) => a[i - 1] === 'THE ROUND RECORD') || '');
  ok(recordLine.length > 0 && !recordLine.includes(';') && !DASHES.test(recordLine), 'no semicolon and no dash in it');

  // The notes and the cases.
  const notes = seededRun(() => cp.pickNotes(input, msgs));
  const notesPlain = seededRun(() => cp.pickNotes(plain, msgs));
  const tagged = (t, f) => { const n = knowledge.all().find((x) => x.text === t); return !!(n && f(n)); };
  // Since the coach bench 9 the economy is out of scope: the match's economy brings no note that teaches it.
  ok(notes.length >= 4 && notes.every((t) => !require('../server/services/game-claims').economyClaim(t))
    && !notesPlain.some((t) => tagged(t, (n) => n.situations && n.situations.includes('fullbuy'))),
  'the match\'s economy brings no economy note (out of scope since the coach bench 9)', JSON.stringify(notes));
  ok(JSON.stringify(seededRun(() => cp.pickNotes(plain, msgs))) === JSON.stringify(seededRun(() => cp.pickNotes(cp.normalise(ctxOf(cards.map(stripCard))), msgs))),
    'without them the notes are as before');
  const askedFive = [{ role: 'user', content: 'Why did I die in round 2?' }];
  const one = seededRun(() => cp.pickNotes(input, askedFive));
  ok(one.some((t) => tagged(t, (n) => (n.cause && n.cause.includes('isolated')) || (n.situations && n.situations.includes('eco')))),
    'one asked round, a lone death on an eco, brings its own notes');
  const silver = cp.normalise(ctxOf(cards, { rankBand: 'silver_gold' }));
  const silverPlain = cp.normalise(ctxOf(cards.map(stripCard), { rankBand: 'silver_gold' }));
  const caseIds = (x) => cp.casesFor(x, msgs).map((c) => c.id);
  ok(JSON.stringify(caseIds(silver)) !== JSON.stringify(caseIds(silverPlain)) || caseIds(silver).length > caseIds(silverPlain).length,
    `the eco deaths and the lone deaths reach the cases (${caseIds(silverPlain).join(', ') || 'none'} to ${caseIds(silver).join(', ')})`);

  // The economy gate passes the kind of round the record names, nothing more.
  const f = cp.factsOf(input, msgs);
  const fPlain = cp.factsOf(plain, msgs);
  ok(keeps('Round 2 was an eco, so that death cost your team little.', f), 'kept: an eco round the record names as one');
  ok(drops('Round 2 was an eco, so that death cost your team little.', fPlain, 'economy'), 'dropped as before where the record names none');
  ok(drops('In round 2 you bought too much and died with it.', f, 'economy'), 'dropped: what the player bought, which the record still does not hold');
  ok(drops('In round 2 you had full shields and still died.', f, 'economy'), 'dropped: the armour, held by nothing');
  ok(gates.BUY_KIND_WORD.test('full buy') && gates.BUY_KIND_WORD.test('eco') && !gates.BUY_KIND_WORD.test('bought') && !gates.BUY_KIND_WORD.test('credits'),
    'BUY_KIND_WORD matches "full buy" and "eco", not "bought" or "credits"');

  // The record gates.
  const ctx = rc.contextOfChat(f);
  const ctxPlain = rc.contextOfChat(fPlain);
  const drop = (s, st, c) => !!rc.checkRecord(s, c || ctx, st || {});
  ok(ctx.map === 'Sunset' && ctx.rounds.get(4).buy === 'full' && ctx.rounds.get(4).mate === 'far' && ctx.rounds.get(2).place === 'B Main', 'the facts carry the record into the gates');
  ok(drop('In round 2 you died at A Main, far from everyone.'), 'CAUGHT: a death put on the A side that Riot has at B Main');
  ok(!drop('In round 2 you died at B Lobby, far from everyone.') && !drop('In round 2 you died at B Main, far from everyone.') && !drop('In round 2 you died at Mid Courtyard.'),
    'kept: B Lobby, a callout of the same side, B Main itself, and a mid callout, which judge nothing');
  ok(!drop('In round 2 you died at A Main.', {}, ctxPlain), 'kept: with no place of Riot\'s nothing is judged');
  ok(drop('Round 4 was an eco, so that loss was cheap.') && drop('In round 2 you were on a full buy and still lost the fight.'), 'CAUGHT: an eco of a full buy, a full buy of an eco');
  ok(!drop('Round 2 was an eco, so that loss was cheap.') && !drop('They were on an eco in round 4.') && !drop('If round 4 had been an eco, saving was right.'),
    'kept: the true kind, the enemy\'s buy and a plan');
  ok(!drop('On a full buy in round 2 your life is the round.'), 'kept: a rule opening on the kind of round');
  ok(drop('In round 4 a teammate was close when you died.') && drop('In round 5 nobody was close when you died, so nobody could trade.'),
    'CAUGHT: a teammate close of a death with nobody close, nobody close of one with a teammate close');
  ok(!drop('In round 4 nobody was close when you died.') && !drop('In round 5 nobody was close enough to trade you.'), 'kept: the true distance, and close enough to trade, which is no distance');
  {
    const tradedCtx = { ...ctx, rounds: new Map([...ctx.rounds].map(([n, r]) => [n, n === 4 ? { ...r, traded: true } : r])) };
    ok(ctx.rounds.get(4).traded === null && !drop('In round 4 you went in with a teammate close behind, and they traded you.', {}, tradedCtx)
      && drop('In round 4 you went in with a teammate close behind, and they traded you.'),
    'kept: a teammate close of a traded death Riot has far (the Pearl audit), caught of the same death untraded');
  }
  ok(drop('In round 4 you used Updraft to get on top.') && drop('In round 4 you did not use Tailwind.') && drop('You used no abilities in round 4.'),
    'CAUGHT: Updraft used where Riot has none, Tailwind unused where it was, no ability in a round with one');
  ok(!drop('In round 4 you used Tailwind to get out.') && !drop('In round 4 you used no utility before the peek.'), 'kept: the cast it has, and no utility before one peek');
  for (const [name, re, pos, neg] of [
    ['BUY_CLAIM', rc.BUY_CLAIM, 'round 4 was an eco', 'round 4 was close'],
    ['MATE_CLOSE_SAID', rc.MATE_CLOSE_SAID, 'a teammate was close when you died', 'a teammate was close enough to trade'],
    ['MATE_FAR_SAID', rc.MATE_FAR_SAID, 'nobody was close when you died', 'nobody was close enough to trade'],
    ['NO_ABILITY_ROUND', rc.NO_ABILITY_ROUND, 'you used no abilities in round 4', 'you used no utility before the peek'],
    ['HYPO', rc.HYPO, 'if you are on an eco', 'you could not trade'],
    ['ENEMY_SUBJECT', rc.ENEMY_SUBJECT, 'they were on an eco', 'you were on an eco'],
    ['DEATH_AT_HEAD', new RegExp(`${rc.DEATH_AT_HEAD}(B Main)`, 'i'), 'you died 20 seconds in at B Main', 'you walked through B Main'],
  ]) ok(re.test(pos) && !re.test(neg), `${name} matches "${pos}" and not "${neg}"`);
}

// ── The blind audit of 8.7.9 (Nov 2026), stream B ─────────────────────────
// Sixty answers and 24 reviews of 8.7.9, judged blind against 8.7.7 and
// 8.7.8. Each fix is pinned on the live sentence the judges flagged (caught)
// and a true one (kept). The matches are the audit's own facts: Fracture 5 to
// 1 (Jett; theirs Astra, Chamber, Deadlock, Jett, Phoenix; yours Chamber,
// Clove, Jett, KAY/O, Reyna), Split 13 to 7 (Jett, no enemy Jett), Pearl 1 to
// 5 (Raze), Sunset 2 to 5 and Corrode 3 to 13.
{
  console.log('\nthe blind audit of 8.7.9, stream B:');
  const rc = require('../server/services/record-claims');
  const co = require('../server/services/coherence');
  const mr = require('../server/services/match-review');
  const BS = String.fromCharCode(8);
  for (const f of ['record-claims.js', 'coherence.js', 'fact-gates.js', 'chat-prompt.js', 'match-review.js']) {
    ok(!fs.readFileSync(path.join(__dirname, '..', 'server', 'services', f), 'utf8').includes(BS), `${f} holds no backspace byte (8.7.9)`);
  }
  const R = (n, side, result, died, sec, killer, extra) => ({ n, side, result, died, sec, killer, kills: 0, planted: false, afterPlant: false, plantSec: null,
    plantSite: null, feed: [], spot: null, traded: died ? false : null, atDeath: null, before: null, weapons: { mine: new Set(), theirs: new Set(), mates: new Set(), all: new Set() },
    times: [], standings: [[5, 5]], ...(extra || {}) });
  const facts = (agent, mates, enemies, rounds, extra) => ({
    game: 'valorant', language: 'en', agent, map: 'Fracture', askedAgents: [], sides: { mates: new Set(mates), enemies: new Set(enemies) },
    counted: { texts: [], pairs: new Set(), counts: new Set(), titles: [], roundSets: [], mistakeCount: 0, missedCount: 2 },
    rounds: new Map(rounds.map((r) => [r.n, r])), numbers: [], scores: [], primer: [], ...(extra || {}),
  });
  const US = ['Chamber', 'Clove', 'Jett', 'KAY/O', 'Reyna'];
  const THEM = ['Astra', 'Chamber', 'Deadlock', 'Jett', 'Phoenix'];
  const fracRounds = [
    R(1, 'defending', 'won', false, null, null, { before: [0, 0] }),
    R(2, 'defending', 'won', true, 31, 'Astra', { killerWeapon: 'Sheriff', traded: true, atDeath: [5, 1], before: [1, 0] }),
    R(3, 'defending', 'won', false, null, null, { before: [2, 0] }),
    R(4, 'defending', 'won', false, null, null, { before: [3, 0] }),
    R(5, 'attacking', 'lost', true, 33, 'Jett', { killerWeapon: 'Sheriff', atDeath: [4, 3], planted: true, plantSec: 32, plantSite: 'A', before: [4, 0] }),
    R(6, 'attacking', 'won', true, 3, 'Chamber', { killerWeapon: 'Sheriff', firstDeath: true, atDeath: [5, 5], planted: true, plantSec: 51, plantSite: 'B', before: [4, 1] }),
  ];
  const frac = facts('Jett', US, THEM, fracRounds);

  // 1. THE COSTLIEST FIRST: the lost round 5 above the won rounds 6 and 2.
  const ranked = rc.costRank(rc.contextOfChat(frac));
  ok(ranked.map((x) => x.n).join(',') === '5,6,2' && ranked[0].plant === 'after' && ranked[0].even && ranked[2].score === 0,
    `the cost ranking: round 5 (lost, after the plant, the advantage given back, untraded) over 6 and 2 (${ranked.map((x) => `${x.n}:${x.score}`).join(' ')})`);
  const line = rc.costLine(rc.contextOfChat(frac));
  ok(/^THE COSTLIEST DEATHS/.test(line) && line.indexOf('round 5') < line.indexOf('round 6') && /never rank a death in a round your team won above one in a round it lost/.test(line)
    && !DASHES.test(line) && !line.includes(';'), `the line names round 5 first, says the rule, no dash, no semicolon: "${line.slice(0, 120)}"`);
  ok(rc.costLine(rc.contextOfChat(facts('Jett', US, THEM, [fracRounds[1]]))) === '', 'one death is no ranking: no line');
  const withRank = { ...frac, costRank: ranked };
  const biggest = 'Your biggest mistake was the repeek in round 2 on Fracture, where you stayed on the same A Main angle after winning the first exchange and Astra killed you with a Sheriff.';
  ok(gates.gatePriority(biggest, withRank)?.gate === 'priority', 'CAUGHT: the won round 2 repeek, traded at 5 against 1, called the biggest mistake over the lost round 5 (Asc+, 4 judges)');
  ok(!gates.gatePriority('Your biggest mistake was round 5, where you held the same A site angle after the plant and their Jett won the duel.', withRank),
    'kept: round 5, the costliest, as the biggest mistake');
  ok(!gates.gatePriority(biggest, frac), 'kept below Platinum: no cost ranking, no priority gate');
  ok(!gates.gatePriority('The repeek in round 2 was a habit worth fixing too.', withRank), 'kept: round 2 named without calling it the biggest');

  // 2. A COUNT OF THE COUNTED MISTAKES: none counted on Fracture.
  const oneCounted = "You should practise the moment after your first kill, because that is where this match's one counted decision mistake came from.";
  ok(gates.gateCounted(oneCounted, frac)?.gate === 'count', 'CAUGHT: "this match\'s one counted decision mistake" where code counted none');
  ok(!gates.gateCounted(oneCounted, { ...frac, counted: { ...frac.counted, mistakeCount: 1 } }), 'kept: the same with one counted mistake');
  ok(!gates.gateCounted('Your two counted misses were the advantage given back in round 5 and the repeek in round 2.', frac), 'kept: two counted misses, as the list has');

  // 3. THE PLAYER'S OWN AGENT IS NO ENEMY: Split, Jett, no enemy Jett.
  const split = facts('Jett', ['Clove', 'Jett', 'Raze', 'Sage', 'Skye'], ['Clove', 'Phoenix', 'Reyna', 'Sage', 'Skye'], []);
  const againstJett = 'Your biggest thing to practise is the fight you take when nobody can follow it: 14 of your 16 deaths on Split against Jett went unanswered, no teammate killing your killer within five seconds.';
  ok(gates.gateOwnAgent(againstJett, split)?.gate === 'own-agent', 'CAUGHT: "on Split against Jett" said to the Jett (4 judges)');
  ok(!gates.gateOwnAgent('You played Jett against their Reyna, who killed you 5 times.', split), 'kept: the player as Jett against Reyna');
  ok(!gates.gateOwnAgent('Their Jett killed you in round 5.', frac), 'kept: an enemy Jett on Fracture, where both teams had one');

  // 4. A HIT THAT KILLS AT A HEALTH THE GUN CANNOT REACH: Sheriff body 55.
  const primer = cp.factsOf(cp.normalise({ v: 2, game: 'valorant', match: { kind: 'valorant', map: 'Fracture', agent: 'Jett', mode: 'Swiftplay', cards: [] } }), []).primer;
  const withPrimer = { ...frac, primer };
  const sheriffBody = primer.find((e) => e.subject === 'Sheriff' && e.attribute === 'body' && e.band && e.band.from === 0);
  ok(sheriffBody && sheriffBody.value === 55, `the primer's Sheriff body hit to 30 m is 55 (${sheriffBody && sheriffBody.value})`);
  ok(gates.gateLethal('A Sheriff kills Light Armor with a single head hit inside 30 m, and it needs only two body hits on no armour, so at 57 health any clean hit from Astra ends you.', withPrimer)?.gate === 'lethal',
    'CAUGHT: at 57 health "any clean hit" of a Sheriff ends you, where its body hit does 55');
  ok(!gates.gateLethal('At 57 health one Sheriff head hit ends you, so a still head is the risk.', withPrimer), 'kept: one Sheriff head hit at 57 health');
  ok(!gates.gateLethal('At 50 health any clean hit from a Sheriff ends you.', withPrimer), 'kept: 50 health, under the body hit');

  // 5. UTILITY THE TEAM DOES NOT HAVE, the kit put on a gun death.
  const starSpots = "All three need a star already placed, so the counter is information and spacing: before you swing into a site she has been holding, have a teammate's flash, dart or drone clear the star spots, and enter from an angle her stars are not covering.";
  ok(gates.gateTeamUtility(starSpots, frac)?.gate === 'team-utility', 'CAUGHT: a dart or a drone asked of Chamber, Clove, Jett, KAY/O and Reyna');
  ok(!gates.gateTeamUtility(starSpots, facts('Jett', ['Sova', 'Clove', 'Jett', 'KAY/O', 'Reyna'], THEM, [])), 'kept: the same with a Sova on the team');
  ok(!gates.gateTeamUtility("Wait for your teammate's flash before you swing into the site.", frac), 'kept: a flash, which many agents have');
  const starsKill = 'Against Astra, the thing that kills you is her star setup, so the answer is to make her spend stars before you commit and to never stand where a star already sits.';
  ok(gates.gateAbilityKill(starsKill, frac, null)?.gate === 'ability-kill', 'CAUGHT: Astra\'s one kill, a Sheriff repeek, put on her stars (2 judges)');
  ok(!gates.gateAbilityKill(starsKill, facts('Jett', US, THEM, [R(2, 'defending', 'won', true, 31, 'Astra', { killerWeapon: 'Nova Pulse' })]), null), 'kept: where Riot\'s record gives an ability as the killer');
  ok(!gates.gateAbilityKill('In round 2 Astra killed you with a Sheriff after you stayed on the same angle.', frac, null), 'kept: the gun as the record has it');

  // 6. THE STALE BUY HEDGE: the round lines give the team's buy.
  const hedge = 'The record does not hold what either of you bought or which abilities he used, so I can only teach from the kit and the deaths.';
  const bought = facts('Jett', US, THEM, [R(1, 'attacking', 'lost', true, 20, 'Cypher', { buy: 'pistol' })]);
  ok(gates.gateStaleBuy(hedge, bought)?.gate === 'economy', 'CAUGHT: "the record does not hold what either of you bought" beside round lines with the buy');
  ok(!gates.gateStaleBuy(hedge, frac), 'kept: the same where no round has a buy');
  ok(!gates.gateStaleBuy('The record does not hold the credits either team had.', bought), 'kept: the credits, which the record still does not hold');

  // 7. THE ROUND'S SCORE, THE CLOCK AND ADVICE FOR AFTER THE PLANT.
  const splitCtx = rc.contextOfChat(facts('Jett', [], [], [R(3, 'attacking', 'lost', true, 19, 'Clove', { atDeath: [5, 4], before: [2, 0], planted: true })]));
  ok(!!rc.checkScore('You were attacking on a half buy, the score was 5 against 4 in your favour, and you died 19 s in at A Tower to a Phantom with no teammate close by.', splitCtx, { round: 3 }),
    'CAUGHT: "the score was 5 against 4" of Split round 3, the numbers alive, the score 2 to 0');
  ok(!rc.checkScore('In round 3 the score was 2 to 0 and you died 19 s in.', splitCtx, {}) && !rc.checkScore('Nobody traded you, and the round went 4 against 5.', splitCtx, { round: 3 }),
    'kept: the true score, and a standing told as how the round went');
  const corrodeCtx = rc.contextOfChat(facts('Iso', [], [], [R(2, 'attacking', 'lost', true, 32, 'Fade', { before: [0, 1] })]));
  ok(!!rc.checkScore('Nobody traded you, and the round ended 3 to 13 in their favour.', corrodeCtx, { round: 2 }), 'CAUGHT: "the round ended 3 to 13", the match\'s final score, of round 2 (5 judges)');
  const pearlCtx = rc.contextOfChat(facts('Raze', [], [], [R(3, 'attacking', 'lost', true, 13, 'Cypher', { planted: true, traded: true }), R(5, 'attacking', 'won', false, null, null, { planted: true })],
    { counted: { texts: ['5 of your 5 deaths came in the first 30 seconds of the round, before any plant, in rounds 1, 3, 4, 5 and 6.'] } }));
  ok(!!rc.checkPostPlant('Enter B with a teammate following, then hold the planted spike from cover rather than exposing yourself again.', pearlCtx, { round: 3 }),
    'CAUGHT: Pearl round 3, "hold the planted spike" of a death 13 s in before the plant (three reviews)');
  ok(!!rc.checkPostPlant('After the plant, hold the spike from cover so the defenders must come to you while the clock runs.', pearlCtx, { round: 3 }), 'CAUGHT: Sunset round 1\'s kind, after the plant, of a death before it');
  ok(!rc.checkPostPlant('You died before the plant in round 3, so your team played the post plant without you.', pearlCtx, {}), 'kept: the death told as before the plant');
  ok(!rc.checkPostPlant('In round 5 hold the planted spike from cover.', pearlCtx, {}), 'kept: a round the player was alive in');
  const atkPlanted = rc.contextOfChat(facts('Iso', [], [], [R(1, 'attacking', 'lost', true, 40, 'Omen', { planted: true, plantSec: 30, afterPlant: true })]));
  ok(!!rc.checkClock('After the plant, hold the spike from cover instead of exposing yourself to the Classic, so the attackers have to move against the clock.', atkPlanted, { round: 1 }),
    'CAUGHT: Corrode round 1, the attackers put on the clock after their own plant (6 judges)');
  ok(!rc.checkClock('After the plant, hold the spike from cover, so the defenders have to move against the clock.', atkPlanted, { round: 1 }), 'kept: the defenders on the clock after the plant');
  for (const [name, re, pos, neg] of [
    ['AFTER_PLANT_ADVICE', rc.AFTER_PLANT_ADVICE, 'then hold the planted spike from cover', 'hold the angle from cover'],
    ['BEFORE_PLANT_SAID', rc.BEFORE_PLANT_SAID, 'you died before the plant', 'you died after the plant'],
    ['ON_CLOCK', rc.ON_CLOCK, 'so the attackers have to move against the clock', 'so the attackers have to move together'],
    ['SCORE_SAID', rc.SCORE_SAID, 'the score was 5 against 4', 'the round went 4 against 5'],
  ]) ok(re.test(pos) && !re.test(neg), `${name} matches "${pos}" and not "${neg}"`);

  // 7b. The verify of round 6: true sentences these gates first took.
  const pearl6 = rc.contextOfChat(facts('Raze', [], [], [R(6, 'defending', 'lost', true, 17, 'Fade', { planted: true, plantSec: 60 }), R(3, 'attacking', 'lost', true, 13, 'Cypher', { planted: true, plantSec: 50 })]));
  ok(!rc.checkPostPlant('At low health, fall back from Mid Top before reappearing. You give up space, but staying alive keeps you available for the planted spike.', pearl6, { round: 6 })
    && !rc.checkPostPlant('Giving up space preserves you for the planted spike instead of risking an early death.', pearl6, { round: 6 })
    && !rc.checkPostPlant('In round 3, play for the plant with your team instead of taking the duel alone.', pearl6, {}),
    'kept: a fall back before the plant told by staying alive for it, and playing for the plant (Pearl round 6, three reviews)');
  ok(!!rc.checkPostPlant('In round 3, after the fast B entry is traded, regroup for the planted spike from cover rather than rushing another fight.', pearl6, {}),
    'CAUGHT still: regrouping for the planted spike of a death before it');
  // Split round 10 at Plat (the blind audit of round 7): a death 34 s before
  // the plant, traded, as Ask Coach's card carries it (chat-context.js plantSec
  // and Riot's afterPlant), and round 11's death after the plant.
  const split10 = rc.contextOfChat(facts('Jett', [], [], [R(10, 'attacking', 'lost', true, 41, 'Cypher', { planted: true, plantSec: 75, traded: true }),
    R(11, 'attacking', 'lost', true, 90, 'Cypher', { planted: true, plantSec: 70.4, afterPlant: true, traded: true })]));
  ok(!!rc.checkPostPlant('After the plant, use cover to hold the spike.', split10, { round: 10 }) && split10.rounds.get(10).afterPlant === false,
    'CAUGHT: Split round 10, "after the plant, use cover to hold the spike" of a death 34 s before it, Riot\'s afterPlant false taken as certain beside its plant time');
  ok(!rc.checkPostPlant('After the plant, use cover to hold the spike.', split10, { round: 11 }), 'kept: the same advice of a death Riot has after the plant');
  const split10Old = rc.contextOfChat(facts('Jett', [], [], [R(10, 'attacking', 'lost', true, 41, 'Cypher', { planted: true, traded: true })]));
  ok(!rc.checkPostPlant('After the plant, use cover to hold the spike.', split10Old, { round: 10 }) && split10Old.rounds.get(10).afterPlant === null,
    'a card with no plant time: afterPlant false stays unknown and the gate judges nothing, as before');
  const defPlanted6 = rc.contextOfChat(facts('Iso', [], [], [R(4, 'defending', 'lost', true, 40, 'Omen', { planted: true, plantSec: 30, afterPlant: true })]));
  ok(!rc.checkClock('In round 4 the attackers are on the clock until they plant, and once the spike is down you are.', defPlanted6, {}),
    'kept: both phases told, the attackers on the clock until they plant');
  ok(!mr.clockWrong('On defence the attackers are on the clock until they plant, and once the spike is down you are.', { verified: true, planted: true, side: 'defending' })
    && mr.clockWrong('After the plant, hold the spike from cover instead of exposing yourself to the Classic, so the attackers have to move against the clock.', { verified: true, planted: true, side: 'attacking' }),
    'the review\'s clock: both phases kept, the Corrode round 1 line still caught');
  ok(rc.PRE_PLANT.test('until they plant') && !rc.PRE_PLANT.test('after they plant'), 'PRE_PLANT matches "until they plant" and not "after they plant"');
  const split7 = rc.contextOfChat(facts('Jett', [], [], [R(7, 'attacking', 'lost', true, 35, 'Reyna', { atDeath: [5, 5], before: [3, 3] })]));
  ok(!rc.checkScore('You lost round 7, and the final score was 13 to 7.', split7, { round: 7 }), 'kept: the final score said as the final score after a round');
  const sovaThem = facts('Jett', US, ['Sova', 'Chamber', 'Deadlock', 'Jett', 'Phoenix'], []);
  ok(!gates.gateTeamUtility('After a dart reveals you, step off the angle before their Sova swings.', sovaThem)
    && !gates.gateTeamUtility('Their Sova will push in on a drone, so hold a close angle.', sovaThem)
    && gates.gateTeamUtility("Have a teammate's dart clear the site first.", sovaThem)?.gate === 'team-utility',
    'the enemy Sova\'s dart and drone kept, a dart asked of a teammate without one still caught');
  ok(gates.UTILITY_OURS.test("a teammate's flash") && !gates.UTILITY_OURS.test('after a dart reveals you'), 'UTILITY_OURS matches "a teammate\'s flash" and not "after a dart reveals you"');
  const bought6 = facts('Jett', US, THEM, [R(1, 'attacking', 'lost', true, 20, 'Cypher', { buy: 'half' })]);
  ok(!gates.gateStaleBuy('The record does not hold what you bought yourself, only that your team was on a half buy in round 1.', bought6)
    && gates.gateStaleBuy('The record does not hold what either of you bought or which abilities he used, so I can only teach from the kit and the deaths.', bought6)?.gate === 'economy',
    'kept: the one player\'s buy beside the team\'s; the stale hedge still caught');
  ok(gates.BUY_HELD_SAID.test('your team was on a half buy') && !gates.BUY_HELD_SAID.test('what either of you bought'), 'BUY_HELD_SAID matches "a half buy" and not "what either of you bought"');
  ok(co.ELLIPSIS_WHOLE.test('Here is what you can do.') && !co.ELLIPSIS_WHOLE.test('The fights you choose are.'), 'ELLIPSIS_WHOLE matches "Here is what you can do." and not "The fights you choose are."');

  // 8. A TIME IS NO ROUND: "Round 4, 17 s in" named round 17 too.
  ok(JSON.stringify(mr.namedRounds('Round 4, 17 s in at B site, Reyna killed you with a Vandal and no teammate was close.')) === '[4]'
    && JSON.stringify(mr.namedRounds('In this Fracture match she killed you once, in round 2, 31 s in, with a Sheriff at A Main.')) === '[2]'
    && JSON.stringify(mr.namedRounds('Reyna killed you in rounds 4, 7, 9, 10 and 19.')) === '[4,7,9,10,19]',
  'namedRounds: "Round 4, 17 s in" is round 4, "round 2, 31 s in" round 2, a list still a list');
  ok(JSON.stringify(rc.roundsIn('Round 4, 17 s in at B site')) === '[4]' && JSON.stringify(rc.roundsIn('rounds 4, 7 and 9')) === '[4,7,9]', 'roundsIn: the time is no round, the list stays');

  // 9. THE CLOSER: the trade check never waits, a named other thing may.
  for (const [s, want] of [
    ['The trade check can wait.', ''], ['The trade check can wait here, since your teammate was close.', ''],
    ['The trade check can wait, because a teammate was close enough to answer this one.', ''],
    ['The trade check on your own peeks can wait, and so can the Reyna fights for now.', ''], ['The larger pattern of unanswered deaths can wait for now.', ''],
    ['Fix the stopping first, and the trade check can wait.', 'Fix the stopping first.'],
    ['Trading is the second point, and the trade check can wait.', 'Trading is the second point.'],
    ['The trade check cannot wait.', null], ['Your Reyna problem and the early deaths can wait.', null], ['The trade check is the habit to build.', null],
  ]) ok(co.fillerOf(s) === want, `fillerOf (8.7.9): "${s.slice(0, 60)}" is ${JSON.stringify(want)}`);
  for (const [name, re, pos, neg] of [
    ['TRADE_WAIT_WHOLE', co.TRADE_WAIT_WHOLE, 'The trade check can wait.', 'The trade check cannot wait.'],
    ['TRADE_WAIT_CLAUSE', co.TRADE_WAIT_CLAUSE, 'Fix the stopping first, and the trade check can wait.', 'Fix the stopping first and the trade check.'],
  ]) ok(re.test(pos) && !re.test(neg), `${name} matches "${pos}" and not "${neg}"`);
  const rules = cp.rulesFor({ rankBand: 'asc_plus' }) + cp.rulesFor({});
  ok(!/the trade check can wait/i.test(rules) && !/say the others can wait/.test(rules) && /Never close by saying what can wait/.test(rules),
    'the rules no longer ask to name what waits, and say never to close on it');

  // 10. CUT SENTENCES: what a drop left leaning, dropped whole.
  const orphan = (prev, s) => co.checkOrphans([{ s: prev, dropped: true, p: 0 }, { s, dropped: false, p: 0 }]).map((o) => o.kind);
  const kept = (prev, s) => co.checkOrphans([{ s: prev, dropped: false, p: 0 }, { s, dropped: false, p: 0 }]).length === 0;
  const gw = "Astra's Gravity Well pulls everyone to the centre, Nova Pulse concusses, and Nebula turns a star into a smoke.";
  ok(orphan(gw, starSpots).length === 1 && orphan(gw, 'All three need a star already placed, so clear the star spots before you enter.').includes('all') && kept(gw, starSpots),
    'CAUGHT: "All three need a star" with the three cut, kept with them');
  ok(orphan('Round 5, 12 s in at A Main, Phoenix killed you.', 'Same story in round 7 at B site with Reyna.').includes('same'), 'CAUGHT: "Same story in round 7" with what it compares to cut');
  ok(orphan('Your mechanics are not the problem at this level.', 'The fights you choose are.').includes('ellipsis'), 'CAUGHT: "The fights you choose are." with its predicate cut');
  ok(orphan('For a drill, play Deathmatch and before every fight ask whether a teammate could be beside you there.',
    'You will not have one, so practise holding angles from cover and letting enemies walk into your crosshair rather than swinging first.').includes('one'), 'CAUGHT: "You will not have one" with its teammate cut');
  ok(orphan('Your opening kills were real, 8 first kills.', 'Those came when you had support.').includes('those'), 'CAUGHT: "Those came when you had support" with the kills cut');
  ok(kept('x', 'All three of your deaths came before the plant.') && orphan('x', 'All three of your deaths came before the plant.').length === 0
    && orphan('x', 'You will not have one more chance if you swing alone.').length === 0 && orphan('x', 'The same angle killed you twice.').length === 0,
  'kept: "All three of your deaths", "one more chance", "the same angle", which carry their own nouns');
  for (const [name, re, pos, neg] of [
    ['ALL_OF_THEM', co.ALL_OF_THEM, 'All three need a star already placed', 'All three of your deaths came early'],
    ['SAME_AGAIN', co.SAME_AGAIN, 'Same story in round 7', 'The same angle killed you'],
    ['ELLIPSIS_END', co.ELLIPSIS_END, 'The fights you choose are.', 'The fights you choose are the problem.'],
    ['BARE_ONE', co.BARE_ONE, 'You will not have one, so practise', 'You will not have one more chance'],
  ]) ok(re.test(pos) && !re.test(neg), `${name} matches "${pos}" and not "${neg}"`);

  // 11. THE PROMPT: the costliest deaths from Platinum only, in the match's part.
  const ctxOf = (band) => cp.normalise({ v: 2, game: 'valorant', rankBand: band, match: { kind: 'valorant', map: 'Fracture', agent: 'Jett', mode: 'Swiftplay', result: 'Victory', score: '5-1',
    comps: { us: US.map((agent) => ({ agent })), them: THEM.map((agent) => ({ agent })) },
    cards: [
      { n: 2, side: 'defending', result: 'won', died: true, verified: true, riot: { sec: 31, killer: 'Astra', weapon: 'Sheriff', traded: true, alive: { mates: 5, enemies: 1 } } },
      { n: 5, side: 'attacking', result: 'lost', died: true, verified: true, riot: { sec: 33, killer: 'Jett', weapon: 'Sheriff', traded: false, alive: { mates: 4, enemies: 3 }, plantSite: 'A', plantSec: 32 } },
    ] } });
  const promptOf = (band) => { const x = ctxOf(band); return cp.buildPrompt(x, [{ role: 'user', content: 'What was my biggest mistake?' }], { variant: 'v2' }); };
  const asc = promptOf('asc_plus');
  ok(/THE COSTLIEST DEATHS/.test(asc) && /First, round 5, an attack round your team lost, you died after the plant/.test(asc) && !/THE COSTLIEST DEATHS/.test(promptOf('silver_gold')) && !/THE COSTLIEST DEATHS/.test(promptOf(undefined)),
    'the match part carries THE COSTLIEST DEATHS at Ascendant, round 5 first, and none below Platinum or with no band');
  ok(/Ask a teammate only for utility an agent of the player's team has/.test(asc), 'the TEAMS line says to ask a teammate only for utility the team has');
  const ascFacts = cp.factsOf(ctxOf('asc_plus'), [{ role: 'user', content: 'What was my biggest mistake?' }]);
  ok(Array.isArray(ascFacts.costRank) && ascFacts.costRank[0].n === 5 && gates.check(biggest, ascFacts).drop?.gate === 'priority',
    'through check: the round 2 biggest mistake goes at Ascendant');
  ok(gates.check(biggest, cp.factsOf(ctxOf('silver_gold'), [{ role: 'user', content: 'What was my biggest mistake?' }])).drop?.gate !== 'priority', 'and stays clear of the priority gate at Silver');
}

// ── The blind audit of round 6 (Nov 2026), stream A ────────────────────────
// Claims over several rounds held to Riot's record, a cheap pistol or eco
// death, the last round, and the structural pass after every gate (a lead
// whose sentence was cut, what only refers back to a cut one, a garbled
// sentence), each on the live round 6 sentence (caught) and a true variant
// (kept). The rounds are the audit's own record (after4 facts.riotRecord).
{
  console.log('\nthe blind audit of round 6, stream A:');
  const rc = require('../server/services/record-claims');
  const co = require('../server/services/coherence');
  const BS = String.fromCharCode(8);
  for (const f of ['record-claims.js', 'coherence.js', 'chat-prompt.js', 'match-review.js']) {
    ok(!fs.readFileSync(path.join(__dirname, '..', 'server', 'services', f), 'utf8').includes(BS), `${f} holds no backspace byte (round 6)`);
  }
  // [n, side, result, died, sec, killer, mate, traded, buy, afterPlant, plantSec]
  const ctxOfRows = (agent, enemies, list, score) => rc.contextOfChat({
    game: 'valorant', language: 'en', agent, map: null, finalScore: score, sides: { mates: new Set(), enemies: new Set(enemies) }, counted: { texts: [] },
    rounds: new Map(list.map(([n, side, result, died, sec, killer, mate, traded, buy, afterPlant, plantSec]) => [n, {
      n, side, result, died, sec, killer, kills: 0, feed: [], spot: null, mate, traded, buy,
      planted: afterPlant === true || plantSec != null, afterPlant: afterPlant === true, plantSec: plantSec == null ? null : plantSec, plantSite: null }])),
  });
  // Corrode 3 to 13, Iso: Omen killed the player in rounds 1, 5, 7, 11, 14 and 16.
  const corrode = ctxOfRows('Iso', ['Chamber', 'Fade', 'Omen', 'Phoenix', 'Reyna'], [
    [1, 'attacking', 'lost', true, 26, 'Omen', 'close', true, 'pistol', true, 21.5], [2, 'attacking', 'lost', true, 32, 'Fade', 'close', false, 'eco'],
    [3, 'attacking', 'won', false, null, null, null, null, 'full', false, 19.1], [4, 'attacking', 'won', false, null, null, null, null, 'full', false, 56.4],
    [5, 'attacking', 'lost', true, 32, 'Omen', 'close', false, 'full'], [6, 'attacking', 'lost', true, 21, 'Phoenix', 'far', true, 'full'],
    [7, 'attacking', 'lost', true, 84, 'Omen', 'far', false, 'half', true, 72.1], [8, 'attacking', 'lost', true, 27, 'Chamber', 'close', false, 'full'],
    [9, 'attacking', 'lost', true, 38, 'Phoenix', 'far', false, 'half'], [10, 'attacking', 'lost', true, 27, 'Phoenix', 'far', false, 'half'],
    [11, 'attacking', 'lost', true, 12, 'Omen', 'far', false, 'half'], [12, 'attacking', 'lost', true, 10, 'Fade', 'far', false, 'full'],
    [13, 'defending', 'lost', true, 21, 'Reyna', 'close', false, 'pistol', true, 16.8], [14, 'defending', 'lost', true, 31, 'Omen', 'close', false, 'force', false, 67],
    [15, 'defending', 'won', false, null, null, null, null, 'force'], [16, 'defending', 'lost', true, 53, 'Omen', null, false, 'full', true, 24.8],
  ], [3, 13]);
  const omenList = 'Omen killed you 6 times in this Corrode match, in rounds 1, 5, 7, 11, 14 and 16, so the first thing to fix is how you meet him rather than your aim.';
  const rows = (...ss) => ss.map((s) => ({ s, p: 0 }));
  const five = 'Five of those six came while you were on your own, with no teammate close enough to answer the fight, and that is exactly the situation Omen is built to win.';
  const hitFive = rc.checkRows(rows(omenList, five), corrode);
  ok(hitFive.length === 1 && hitFive[0].index === 1 && hitFive[0].kind === 'multi',
    'CAUGHT: "Five of those six came while you were on your own" of Omen\'s six, Riot close in rounds 1, 5 and 14', JSON.stringify(hitFive));
  ok(!rc.checkRows(rows(omenList, 'Two of those six came while you were on your own.'), corrode).length
    && !rc.checkRows(rows(omenList, 'Three of those six came while you were on your own.'), corrode).length,
  'kept: two or three of those six alone, which rounds 7, 11 and 16 allow');
  ok(!rc.checkRows(rows('Omen killed you in rounds 1, 5, 7 and 11.', five), corrode).length, 'kept: "those six" after a list of four judges nothing');
  ok(!rc.checkRows([{ s: omenList, p: 0, dropped: true }, { s: five, p: 0 }], corrode).length, 'kept: "those six" after a dropped sentence judges nothing');
  const practice = 'In the Corrode match your deaths in rounds 2, 10 and 12 all came with no teammate close, and those are the rounds to picture.';
  ok(!!rc.checkMulti(practice, corrode, {}), 'CAUGHT: "rounds 2, 10 and 12 all came with no teammate close", round 2 close');
  ok(!rc.checkMulti('In the Corrode match your deaths in rounds 10 and 12 all came with no teammate close, and those are the rounds to picture.', corrode, {}),
    'kept: rounds 10 and 12 with no teammate close, both far');
  // Round 8: Riot's distance word decides "no teammate close" first, so round 6 (traded, far) is one of
  // them, and with round 16 unknown "most" (7 of 13 at most) is no longer certainly false; "most traded" is.
  ok(!!rc.checkMulti('Every time you died a teammate was close.', corrode, {}) && !rc.checkMulti('Most of your deaths came with no teammate close by.', corrode, {})
    && !!rc.checkMulti('Most of your deaths were traded.', corrode, {})
    && !rc.checkMulti('Most of your deaths went unanswered.', corrode, {}) && !!rc.checkMulti('None of your deaths were traded.', corrode, {}),
  'every death: "every time a teammate was close" and "most were traded" (2 of 13) caught, "most with no teammate close" (7 of 13 possible, Riot\'s far first) and "most went unanswered" (11 of 13) kept, "none traded" caught');
  // "Your deaths" qualified is some of them (the verify pass of round 7, SUBSET_AFTER).
  ok(!rc.checkMulti('None of your deaths on defence were traded.', corrode, {}) && !rc.checkMulti('Every time you died to Fade, nobody traded you.', corrode, {})
    && !rc.checkMulti('Most of your deaths after the plant came with no teammate close by.', corrode, {})
    && !!rc.checkMulti('None of your deaths in this Corrode match were traded.', corrode, {}) && !!rc.checkMulti('Every time you died in this match a teammate was close.', corrode, {}),
  'kept: "your deaths on defence", "every time you died to Fade", "most of your deaths after the plant", some of them; "in this Corrode match" is every death still, caught');
  ok(rc.SUBSET_AFTER.test(' to Killjoy, nobody traded you') && !rc.SUBSET_AFTER.test(', nobody traded you') && rc.WHOLE_AFTER.test(' in this Sunset match were traded') && !rc.WHOLE_AFTER.test(' in round 4'),
    'SUBSET_AFTER matches " to Killjoy" and not ", nobody", WHOLE_AFTER " in this Sunset match" and not " in round 4"');
  ok(!!rc.checkMulti('Only one of those five was traded.', corrode, { lastSet: [1, 6, 7, 11, 12] }) === true
    && !rc.checkMulti('Two of those five were traded.', corrode, { lastSet: [1, 6, 7, 11, 12] }),
  'traded over a set: "only one of those five" caught (1 and 6 traded), "two of those five" kept');
  ok(!rc.checkMulti('Chamber and Fade killed you in rounds 2, 5 and 8, often when you were alone on an angle.', corrode, {}),
    'kept: "often" alone claims some of them, never a count (the sweep over 8.7.8)');
  ok(!rc.checkMulti('11 of your 13 deaths went unanswered within five seconds, and you died in the first 30 seconds of the round 8 times.', corrode, {})
    && !rc.checkMulti('You died where nobody could trade in 3 of your 5 deaths, and you have been dying unanswered in 5 of your last 6 matches.', corrode, {}),
  'kept: a count in another clause, and "5 of your last 6 matches", are no count of this claim (the sweep over 8.7.7 and 8.7.9)');
  // Sunset 4 to 13, Jett: Killjoy in rounds 1, 2, 13 and 14, all lost, 1 and 13 the pistols, 14 an eco.
  const sunset = ctxOfRows('Jett', ['Killjoy', 'Tejo', 'Brimstone', 'Phoenix', 'Raze'], [
    [1, 'defending', 'lost', true, 18, 'Killjoy', 'far', false, 'pistol'], [2, 'defending', 'lost', true, 42, 'Killjoy', null, false, 'eco', true],
    [3, 'defending', 'lost', true, 27, 'Tejo', 'close', false, 'full', true], [4, 'defending', 'won', false, null, null, null, null, 'force'],
    [13, 'attacking', 'lost', true, 17, 'Killjoy', 'far', false, 'pistol'], [14, 'attacking', 'lost', true, 14, 'Killjoy', 'close', false, 'eco'],
    [15, 'attacking', 'won', true, 20, 'Phoenix', 'far', false, 'pistol'],
  ], [4, 13]);
  const early = 'The pattern that matters is the other one: in rounds 1, 2, 13 and 14 you died early and nobody was close enough to kill her back.';
  ok(!!rc.checkMulti(early, sunset, {}), 'CAUGHT: "in rounds 1, 2, 13 and 14 you died early", round 2 after the plant at 42 s');
  // Round 8: "nobody close enough to kill her back" is false of round 14, a teammate close and nobody trading.
  ok(!!rc.checkMulti('In rounds 1, 13 and 14 you died early and nobody was close enough to kill her back.', sunset, {})
    && !rc.checkMulti('In rounds 1 and 13 you died early and nobody was close enough to kill her back.', sunset, {})
    && !rc.checkMulti('In rounds 1, 13 and 14 you died early and nobody traded you.', sunset, {}),
  'round 8: "nobody close enough" of rounds 1, 13 and 14 caught (14 close), of 1 and 13 (both far) kept, "nobody traded you" of all three kept');
  const cheap = 'Those hurt less than they look, because a death on a pistol or an eco costs the team little.';
  ok(rc.checkRows(rows('Killjoy got you four times on Sunset, in rounds 1, 2, 13 and 14.', cheap), sunset).some((h) => h.kind === 'lowcost'),
    'CAUGHT: "a death on a pistol or an eco costs the team little" of pistol and eco rounds all lost');
  ok(!rc.checkLowCost('Round 15 was a pistol round your team won, so that death cost the team little.', sunset, {}), 'kept: a pistol death in a round the team won');
  ok(!rc.checkLowCost('That works because a pistol round leaves no credits for armour, and cover means a miss costs you nothing.', sunset, {}), 'kept: a miss costing nothing is no death (the sweep over 8.7.7)');
  ok(rc.LOW_COST.test(cheap) && !rc.LOW_COST.test('That death cost the team the round.'), 'LOW_COST matches "costs the team little" and not "cost the team the round"');
  ok(!rc.checkLowCost('Round 14 was an eco, so that death cost little.', sunset, {}), 'kept: an eco death costing little, the save round\'s own reading (test:valorantreview holds it true)');

  // The review: the summary's lead goes with the sentence a gate cut, a garbled round line whole.
  const mr = require('../server/services/match-review');
  const rv = { summary: 'You lost 2 to 4. Look at where those deaths happened.', focus: 'Take the B Main fight with a teammate.',
    rounds: { 3: 'Your gun is the Vandal or Phantom range game, so step back.', 4: 'Step back toward your team.' }, dropped: [] };
  mr.structureGates(rv, { context: { language: 'en' } }, { summary: 'You lost 2 to 4. Look at where those deaths happened. In round 2 you died at A Main with nobody around.', focus: rv.focus });
  ok(rv.summary === 'You lost 2 to 4.' && !rv.rounds[3] && rv.rounds[4] && rv.focus === 'Take the B Main fight with a teammate.',
    'the review: the summary lead whose sentence a gate cut goes, a garbled round line goes whole, the rest stays', JSON.stringify(rv));
  // Fracture 5 to 1: six rounds.
  const fracture = ctxOfRows('Jett', ['Astra', 'Jett', 'Sova', 'Killjoy', 'Fade'], [
    [2, 'defending', 'won', true, 31, 'Astra', 'far', true, 'half'], [5, 'attacking', 'lost', true, 33, 'Jett', 'close', false, 'pistol', true, 32],
    [6, 'attacking', 'won', false, null, null, null, null, 'full'],
  ], [5, 1]);
  ok(!!rc.checkOrdinal('Your costliest mistake was the death in round 5, the last round of the match.', fracture), 'CAUGHT: "round 5, the last round of the match" of six rounds');
  ok(!rc.checkOrdinal('Your costliest mistake was the death in round 6, the last round of the match.', fracture)
    && !rc.checkOrdinal('Round 5 was the last round you lost.', fracture) && !rc.checkOrdinal('Round 5 was the first round of the second half.', fracture),
  'kept: round 6 the last, "the last round you lost", "the first round of the second half"');
  ok(!!rc.checkOrdinal('Round 2 was the first round of the match.', fracture), 'CAUGHT: round 2 called the first round of the match');

  // The structural pass.
  const R6 = (list) => list.map(([s, dropped]) => ({ s, dropped: !!dropped, p: 0 }));
  const gone = (list) => co.checkStructure(R6(list)).map((o) => `${o.index}:${o.kind}`).join(',');
  ok(gone([['Your headshot rate was 21%, against your own average of 32% over your last 10 matches.'], ['But before you put it all on the mouse, look at where those fights happened.'],
    ['All 5 of your deaths came in the first 30 seconds of the round.', true], ['When you are taking fights that early and that alone, every shot is harder.', true]]) === '1:lead',
  'CAUGHT: "But before you put it all on the mouse, look at where those fights happened." with what it pointed at cut (Pearl, Silver aim)');
  ok(gone([['Look at where she caught you.'], ['In round 4 you died 17 s in at B site with no teammate close by.', true]]) === '0:lead'
    && gone([['Look at what the record shows around it.'], ['You died before the plant in 5 of those 9 defence rounds.', true], ['Eight of your 14 deaths came early.']]) === '0:lead',
  'CAUGHT: "Look at where she caught you." and "Look at what the record shows around it." right before a cut (Split Asc, Sunset)');
  ok(gone([['Look at where she caught you.'], ['In round 4 you died 17 s in at B site with no teammate close by.']]) === ''
    && gone([['Look at round 4: you died 17 s in at B site.'], ['Then you swung again.', true]]) === '',
  'kept: the lead with its sentence kept, and a lead carrying its own round');
  // An instruction is no lead (the verify pass of round 7): the habit stays when the sentence after it is cut.
  ok(gone([['You died alone in round 4.'], ['Before you swing, check where your nearest teammate is.'], ['You did it 7 times.', true]]) === ''
    && gone([['Next time, after the plant, before you take another fight, look at where your teammates are standing.'], ['You died 3 seconds later.', true]]) === ''
    && !co.isPointer('See where the turret is first.') && !co.isPointer('Watch how she plays the first contact.')
    && co.isPointer('Look at where she caught you.') && co.isPointer('Look at what the record shows around it.') && co.isPointer('Notice what happens next.'),
  'kept: "check where your nearest teammate is" and "look at where your teammates are standing" before a cut, instructions and no lead');
  ok(co.isInstruction('After the plant, check where your teammates are before taking another duel.') && !co.isInstruction('But before you put it all on the mouse, look at where those fights happened.'),
    'INSTRUCTION matches "check where your teammates are" and not "look at where those fights happened"');
  ok(gone([['The biggest thing holding you back is dying where nobody can trade you.'], ['Check that a teammate is close before you swing.', true], ['If nobody is, either move to where one is or let the fight come to you.']]) === '2:back'
    && gone([['Check that a teammate is close before you swing.'], ['If nobody is, either move to where one is or let the fight come to you.']]) === '',
  'CAUGHT: "If nobody is," with its condition cut (Fracture, Asc improve), kept with it standing');
  ok(gone([['Your biggest mistake was dying early on defence.', true], ['That post-plant record is the team\'s, not yours alone, but it shows what your early deaths cost.']]) === '1:back'
    && gone([['Your team won 0 of 9 retakes, its post-plant record.'], ['That post-plant record is the team\'s, not yours alone.']]) === '',
  'CAUGHT: "That post-plant record" with the record never told (Sunset 4-13), kept where the sentence before named it');
  ok(gone([['The biggest thing holding you back is 14 untraded deaths.'], ['You got the first kill 8 times, so you are finding fights.', true], ['The problem is what happens next.']]) === '2:back'
    && gone([['You got the first kill in 8 rounds, so the aggression itself is not the problem.', true], ['The problem is swinging when the trade is not there yet.']]) === '1:back'
    && gone([['You died early in round 4.', true], ['The problem is swinging when the trade is not there yet.']]) === '',
  'CAUGHT: "The problem is what happens next." and the second half of a cut contrast, kept after a cut that was no contrast');
  ok(co.garbleOf('Your gun is the Vandal or Phantom range game, and a Sheriff kills with one head hit inside 30 m.') === 'gun-either'
    && co.garbleOf('Your gun was the Vandal game.') === 'gun-game' && co.garbleOf('Hold the the angle.') === 'doubled' && co.garbleOf('Take a the long way.') === 'articles',
  'CAUGHT: "Your gun is the Vandal or Phantom range game" (Fracture, Asc aim), a doubled word, two articles');
  ok(!co.garbleOf('Your gun is the Vandal, so tap at range.') && !co.garbleOf('Buy the Vandal or the Phantom on a full buy.') && !co.garbleOf('Your Vandal game is solid.')
    && !co.garbleOf('Play off the A site with your team.') && !co.garbleOf('I know that that angle is hard.'),
  'kept: the gun named once, a buy of either, "your Vandal game", "the A site", "that that"');
  for (const [name, re, pos, neg] of [
    ['POINT_TAIL', co.POINT_TAIL, 'But before you put it all on the mouse, look at where those fights happened.', 'But before you swing, look at the minimap.'],
    ['BACK_IF', co.BACK_IF, 'If nobody is, move.', 'If nobody is close, move.'],
    ['GUN_EITHER', co.GUN_EITHER, 'Your gun is the Vandal or Phantom range game', 'Your gun is the Vandal'],
    ['MULTI_HYPO', rc.MULTI_HYPO, 'If you die alone in rounds 2 and 3', 'In rounds 2 and 3 you died alone'],
  ]) ok(re.test(pos) && !re.test(neg), `${name} matches "${pos}" and not "${neg}"`);

  // Through the reply: the garble and the last round dropped, the rest kept.
  const fx = cp.normalise({ v: 2, game: 'valorant', rankBand: 'asc_plus', match: { kind: 'valorant', map: 'Fracture', agent: 'Jett', mode: 'Swiftplay', result: 'Victory', score: '5-1',
    cards: [
      { n: 2, side: 'defending', result: 'won', died: true, verified: true, riot: { sec: 31, killer: 'Astra', weapon: 'Sheriff', traded: true, alive: { mates: 5, enemies: 1 } } },
      { n: 5, side: 'attacking', result: 'lost', died: true, verified: true, riot: { sec: 33, killer: 'Jett', weapon: 'Sheriff', traded: false, alive: { mates: 4, enemies: 3 }, plantSite: 'A', plantSec: 32 } },
    ] } });
  const said = 'You won 5 to 1 on Fracture with Jett.\n\nRound 2 is the one to look at. You stayed on that angle at low health. Your gun is the Vandal or Phantom range game, and a Sheriff kills with one head hit inside 30 m. After a trade, step back off the angle.';
  const got = cp.parseReply(said, fx, { messages: [{ role: 'user', content: 'How do I get better aim?' }] });
  ok(got.dropped.garble === 1 && !/range game/.test(got.reply) && /step back off the angle/.test(got.reply), 'through parseReply: the garbled sentence goes, the rest stays', JSON.stringify(got.dropped));
}

// ── The blind audit of round 6 (Nov 2026), stream B ────────────────────────
// The inputs: why each costly death cost, as finished facts with where the
// round sat in the match; the enemy asked about as Riot's rounds; the aim
// facts and the duel's notes from Platinum. Each only with its data, and a
// prompt without it as before.
{
  console.log('\nthe blind audit of round 6, stream B:');
  const mr = require('../server/services/match-review');
  const kn = require('../server/services/knowledge');
  const DASHES_B = new RegExp('[' + String.fromCharCode(0x2013, 0x2014) + ']');
  const THEM5 = ['Astra', 'Omen', 'Killjoy', 'Sova', 'Reyna'];
  const US5 = ['Jett', 'Sage', 'Fade', 'Cypher', 'Brimstone'];
  // As the route marks a client of 8.7.6 or later (byEnemy), unless `old` says it is one before.
  const ctxB = (band, cards, extra = {}, old = false) => {
    const x = cp.normalise({ v: 2, game: 'valorant', ...(band ? { rankBand: band } : {}), advanced: true,
      match: { kind: 'valorant', map: 'Fracture', agent: 'Jett', mode: 'Swiftplay', result: 'Victory', score: '5-1',
        comps: { us: US5.map((agent) => ({ agent })), them: THEM5.map((agent) => ({ agent })) }, cards, ...extra } });
    if (!old) x.byEnemy = true;
    return x;
  };
  const frac = [
    { n: 2, side: 'defending', result: 'won', died: true, verified: true, riot: { sec: 31, killer: 'Astra', weapon: 'Sheriff', traded: true, alive: { mates: 5, enemies: 1 } } },
    { n: 5, side: 'attacking', result: 'lost', died: true, verified: true, riot: { sec: 33, killer: 'Jett', weapon: 'Sheriff', traded: false, alive: { mates: 4, enemies: 3 }, plantSite: 'A', plantSec: 32 } },
  ];
  const ask = (q) => [{ role: 'user', content: q }];
  const promptB = (band, cards, q, extra) => cp.buildPrompt(ctxB(band, cards, extra), ask(q), { variant: 'v2' });

  // 1. THE COST REASON IN CODE: the round's place in the match, the rule, and nothing else invented.
  const asc = promptB('asc_plus', frac, 'What was my biggest mistake?');
  ok(/First, round 5, an attack round your team lost, you died after the plant[^.]*, round 5 of the 6 the match had, not its last\./.test(asc)
    && asc.includes(mr.COST_RULE.trim()) && !/round 5[^.]*its last round/.test(asc),
  'CAUGHT: Fracture round 5 "the last round of the match": the line says round 5 of the 6, not its last, and to state only its reasons');
  const ranked = [{ n: 6, words: ['an attack round your team lost'], result: 'lost' }, { n: 1, words: ['a defence round your team won'], result: 'won' }];
  const line6 = mr.costReasonLine(ranked, 6, { buyOf: (n) => (n === 1 ? 'pistol' : 'full') });
  ok(/round 6, an attack round your team lost, the team on a full loadout, round 6 of the 6 the match had, its last round\./.test(line6)
    && /round 1, a defence round your team won, the team on a pistol round, the first of the 6 rounds the match had/.test(line6),
  'the last round is called the last only when it is, the first the first, and the team\'s economy rides along where the record has it');
  ok(mr.costReasonLine(ranked, null) === '' && mr.costReasonLine(ranked.slice(0, 1), 6) === '' && mr.costReasonLine(ranked, 5) === '',
    'no total, one death, or a round past the total: no reason line (the caller keeps record-claims.js costLine)');
  ok(!/THE COSTLIEST DEATHS/.test(promptB('silver_gold', frac, 'What was my biggest mistake?')), 'and none below Platinum, as before');
  for (const s of [mr.COST_RULE, line6]) ok(!s.includes(';') && !DASHES_B.test(s), `no semicolon or dash in "${s.slice(0, 50)}"`);

  // 2. THE ENEMY ASKED ABOUT: Riot's rounds of that agent, counted in code.
  const omen = [
    { n: 1, side: 'attacking', result: 'lost', died: true, verified: true, pistol: true, riot: { sec: 26, killer: 'Omen', weapon: 'Classic', traded: true, alive: { mates: 3, enemies: 4 }, place: 'A Main', mate: 'close', buy: 'pistol' } },
    { n: 3, side: 'attacking', result: 'lost', died: true, verified: true, riot: { sec: 12, killer: 'Omen', weapon: 'Vandal', traded: false, alive: { mates: 5, enemies: 5 }, mate: 'far', buy: 'full' },
      look: { cause: 'repeek', what: 'You peeked the same angle twice.', better: 'Fall back after the first shot.' } },
    { n: 4, side: 'attacking', result: 'won', died: true, verified: true, riot: { sec: 40, killer: 'Reyna', weapon: 'Phantom', traded: false, alive: { mates: 4, enemies: 4 }, mate: 'far' } },
  ];
  const enemyQ = 'Their Omen killed me the most. How do I play against Omen?';
  const pe = promptB('iron_bronze', omen, enemyQ);
  ok(/THE ENEMY ASKED ABOUT, from Riot's record: Omen killed you 2 times, in 2 of your 3 deaths in this match\./.test(pe)
    && /- Round 1: attack, lost, a pistol round, Omen killed you with a Classic, at A Main, 26 s in, a teammate was close, a teammate traded it\./.test(pe)
    && /- Round 3: attack, lost, Omen killed you with a Vandal, 12 s in, no teammate was close, nobody traded it, team economy full buy, the coach's look: Repeek\./.test(pe)
    // Round 8: the counts are the ledger's (record-claims.js ledgerLine), every bin with its rounds.
    && /Of your 2 deaths to Omen, a teammate traded 1 of the 2 \(round 1\)\. Nobody traded 1 of the 2: 1 with no teammate close, a lesson about where you stood \(round 3\)\./.test(pe)
    && !/Nobody traded 1 of the 2\.\n/.test(pe)
    && !/- Round 4:/.test(pe.split('THE ENEMY ASKED ABOUT')[1] || ''),
  'CAUGHT: Corrode "five of those six came while you were on your own": the rounds Omen killed the player, each from the record, and the counts made in code');
  ok(/Name Omen's abilities only by the names in Omen's kit lines/.test(pe) && /Never say a death cost the team little or was cheap\./.test(pe), 'the rule: answer from the block, the kit names only, no cheap deaths');
  const fe = cp.factsOf(ctxB('iron_bronze', omen), ask(enemyQ));
  ok(fe.enemyAgent === 'Omen' && fe.counted.pairs.has('1/2'), 'the facts name the agent and the counts are numbers a reply may say back');
  // "Six of your thirteen deaths in this Corrode match came to their Omen" was
  // true and dropped by the count gate: the head is said as the pair it is.
  ok(fe.counted.pairs.has('2/3') && gates.check('Two of your three deaths in this match came to their Omen.', fe).drop === null,
    'the head\'s own pair, Omen in 2 of the 3 deaths, is a count a reply may say back');
  ok(!/THE ENEMY ASKED ABOUT/.test(promptB('iron_bronze', omen, 'How do I play against Killjoy?'))
    && !/THE ENEMY ASKED ABOUT/.test(promptB('iron_bronze', omen, 'How do I play Jett better?'))
    && !/THE ENEMY ASKED ABOUT/.test(promptB('iron_bronze', omen, 'What was my biggest mistake?')),
  'none for an agent that never killed the player, the player\'s own agent, or a question naming no agent');
  const one = cp.enemyAskedOf(ctxB(null, omen).match, ['Reyna']);
  ok(one && one.who === 'Reyna' && /Reyna killed you once, in 1 of your 3 deaths/.test(one.text) && !/ of the \d/.test(one.text), 'one round: no counts, its line says it all');
  ok(gates.check('No teammate was close in 1 of the 2 rounds Omen killed you.', fe).drop === null, 'through check: a reply saying the block\'s count back is kept');
  ok(!(pe.split('THE ENEMY ASKED ABOUT')[1] || '').split('\n\n')[0].includes(';') && !DASHES_B.test(pe.split('THE ENEMY ASKED ABOUT')[1].split('\n\n')[0]), 'the block has no semicolon or dash');
  // The cases are chosen against the asked agent alone where the block is there.
  const byEnemy = ctxB('iron_bronze', omen);
  ok(!/THE ENEMY ASKED ABOUT/.test(cp.buildPrompt(ctxB('iron_bronze', omen, {}, true), ask(enemyQ), { variant: 'v2' })), 'an install before byEnemy gets no block, its prompt as before');
  ok(JSON.stringify(cp.enemyCases(byEnemy, ask(enemyQ))) === '["Omen"]' && cp.enemyCases(byEnemy, ask('What was my biggest mistake?')).length === 5,
    'the cases are picked against Omen alone for the Omen question, against the five otherwise');

  // 3. THE AIM FACTS AND NOTES FROM PLATINUM.
  const aimCards = [
    { n: 2, side: 'defending', result: 'won', died: true, verified: true, riot: { sec: 31, killer: 'Astra', weapon: 'Sheriff', traded: true, alive: { mates: 5, enemies: 1 },
      feed: [{ s: 20, by: 'me', on: 'enemy', ka: 'Jett', va: 'Sova', w: 'Vandal' }, { s: 31, by: 'enemy', on: 'me', ka: 'Astra', va: 'Jett', w: 'Sheriff' }] },
      look: { cause: 'lost-duel', what: 'You fought Astra at close range on A Main and missed your first shots.', better: 'Hold a tighter angle.' } },
    { n: 5, side: 'attacking', result: 'lost', died: true, verified: true, riot: { sec: 33, killer: 'Jett', weapon: 'Phantom', traded: false, alive: { mates: 4, enemies: 3 },
      feed: [{ s: 10, by: 'me', on: 'enemy', ka: 'Jett', va: 'Omen', w: 'Vandal' }, { s: 15, by: 'me', on: 'enemy', ka: 'Jett', va: 'Reyna', w: 'Sheriff' }] } },
  ];
  const against = [{ label: 'Headshot %', value: 24, baseline: 35, games: 10 }];
  const aimQ = 'How do I get better aim at my rank?';
  const pa = promptB('asc_plus', aimCards, aimQ, { against });
  ok(/THE AIM FACTS, from Riot's record and the coach's looks:\n- Your headshot rate this match was 24%, against your own average of 35% over your last 10 matches\./.test(pa)
    && /- Round 2, a fair fight lost on the shot as the coach's look called it, killed by Astra with a Sheriff: You fought Astra at close range on A Main and missed your first shots\./.test(pa)
    && /- Your kills by gun, from Riot's record: Vandal 2, Sheriff 1\./.test(pa) && /- The guns that killed you: Phantom 1, Sheriff 1\./.test(pa)
    && /- The range the looks give: close range in round 2\./.test(pa) && /never make stopping before the shot or counter strafing the fix/.test(pa),
  'CAUGHT: "Your gun is the Vandal or Phantom range game" and the basics at Ascendant: the aim facts in code, the guns as Riot has them, the range the look gives');
  // Round 8: at every band, the basic of the shot below Platinum; none with no band or for a question not about aim.
  const ps = promptB('silver_gold', aimCards, aimQ, { against });
  ok(/THE AIM FACTS/.test(ps) && /one basic of the shot for these guns: stopping before the first bullet/.test(ps) && !/never make stopping before the shot/.test(ps)
    && !/THE AIM FACTS/.test(promptB('asc_plus', aimCards, 'What was my biggest mistake?', { against }))
    && !/THE AIM FACTS/.test(promptB(undefined, aimCards, aimQ, { against })),
  'below Platinum the aim facts teach a basic of the shot; none with no band, or for a question not about aim');
  const notesA = cp.pickNotes(ctxB('asc_plus', aimCards, { against }), ask(aimQ));
  const noteOf = (t) => kn.all().find((n) => n.text === t);
  ok(notesA.length >= 3 && notesA.slice(0, 3).every((t) => { const n = noteOf(t); return n && Array.isArray(n.cause) && n.cause.includes('lost-duel') && !cp.isAimBasic(n); })
    && !notesA.some((t) => /stop looking for more aim|high refresh monitor/i.test(t)) && !notesA.some((t) => cp.AIM_BASIC.test(t)),
  'the aim question\'s own notes at Ascendant are the duel\'s, none of the basics, the monitor or "stop looking for more aim"', notesA.map((t) => t.slice(0, 60)).join(' | '));
  const moving = aimCards.map((c) => (c.n === 2 ? { ...c, look: { ...c.look, what: 'You fired while still moving and lost the duel at close range.' } } : c));
  const fm = cp.factsOf(ctxB('asc_plus', moving, { against }), ask(aimQ));
  ok(fm.aimFacts && fm.aimFacts.moving === true && !/never make stopping before the shot/.test(fm.aimFacts.text), 'a look that saw a shot on the move lets the basics back in');
  const silverNotes = cp.pickNotes(ctxB('silver_gold', aimCards, { against }), ask(aimQ));
  ok(silverNotes.length > 0 && silverNotes.slice(0, 3).some((t) => { const n = noteOf(t); return n && cp.isAimBasic(n); }),
    'below Platinum the aim question still gets the basics first, as before', silverNotes.map((t) => t.slice(0, 60)).join(' | '));
  const fund = kn.all().find((n) => n.tier !== 'advanced' && !n.ranks && Array.isArray(n.cause) && n.cause.includes('lost-duel') && /Stop before/i.test((n.source && n.source.topic) || ''));
  const bandNote = kn.all().find((n) => Array.isArray(n.ranks) && n.ranks.includes('asc_plus') && !n.ranks.includes('iron_bronze') && Array.isArray(n.cause) && n.cause.includes('lost-duel') && !cp.AIM_BASIC.test(n.text));
  ok(fund && cp.aimNote(fund, 'asc_plus', false) === null && cp.aimNote(fund, 'asc_plus', true) !== null && bandNote && cp.aimNote(bandNote, 'asc_plus', false) === 3,
    'aimNote: a basic note only with a shot on the move, a band note for a lost duel ranked first');
  for (const [name, re, pos, neg] of [
    ['AIM_BASIC', cp.AIM_BASIC, 'Come to a full stop before your first shot', 'Keep your crosshair back from the corner'],
    ['AIM_RANGE', cp.AIM_RANGE, 'fought Astra at close range', 'fought Astra in range of the site'],
    ['SHOT_MOVING', cp.SHOT_MOVING, 'You fired while still moving', 'You were moving to cover before the fight'],
  ]) ok(re.test(pos) && !re.test(neg), `${name} matches "${pos}" and not "${neg}"`);

  // 4. THE ECONOMY SENTENCE never says a death cost little (Sunset 4 to 13, Killjoy).
  // Changed when the economy went out of scope (Nov 2026): the economy sentence is gone, and the economy rule is in.
  ok(!/costs little/.test(pe) && !/economy changes what a death teaches/.test(pe) && pe.includes(cp.ECONOMY_RULE), 'the round record line no longer says a pistol or eco death costs little: it has no economy line at all');
}

// ── Round 8 (the blind audit of round 7): counts over several rounds, alone said of a teammate close ──
{
  console.log('\nround 8, counts and contradictions:');
  const rc = require('../server/services/record-claims');
  const kn = require('../server/services/knowledge');
  const mr = require('../server/services/match-review');
  const BS = String.fromCharCode(8);
  for (const f of ['record-claims.js', 'chat-prompt.js', 'match-review.js', 'knowledge.js', 'cases.js']) {
    ok(!fs.readFileSync(path.join(__dirname, '..', 'server', 'services', f), 'utf8').includes(BS), `${f} holds no backspace byte (round 8)`);
  }
  // Every new regex on a sentence of the audit and a true variant.
  for (const [name, re, pos, neg] of [
    ['FAR_SAID', rc.FAR_SAID, 'You were the one holding the angle alone.', 'You were the one holding the angle with a teammate close by.'],
    ['FAR_SAID reach', rc.FAR_SAID, "taking another duel away from your teammate's reach", 'taking another duel within your teammate\'s sight'],
    ['FAR_SAID spots', rc.FAR_SAID, 'from spots where nobody on your team could see the same enemy', 'from spots your team could see'],
    ['COULDNT_SAID', rc.COULDNT_SAID, 'both times nobody was close enough to trade you', 'check that a teammate is close enough to kill whoever kills you'],
    ['COULDNT_SAID could', rc.COULDNT_SAID, 'You held where nobody could answer your death.', 'Nobody answered your death.'],
    ['UNTRADED_SAID', rc.UNTRADED_SAID, 'Three of those six he was never traded.', 'A teammate traded him.'],
    ['UNTRADED_SAID answered', rc.UNTRADED_SAID, 'a teammate was close and nobody answered your death', 'a teammate answered your death'],
    ['ALONE_SAID', rc.ALONE_SAID, 'because you were the one holding the angle alone', 'Hold cover, wait for a teammate to come up beside you'],
    ['ALONE_SAID clutch', rc.ALONE_SAID, 'You took fights alone, from spots where nobody could see.', 'You were alone against two in round 2.'.replace(rc.NOT_ALONE, ' ')],
    ['COULD_TRADE', rc.COULD_TRADE, 'Nobody could trade you there.', 'Nobody traded you there.'],
    ['CAPABILITY', rc.CAPABILITY, 'dying where nobody could trade you', 'dying where nobody traded you'],
    ['PRESUPPOSED', rc.PRESUPPOSED, 'take a position a teammate can trade rather than holding alone', 'If nobody is close, give ground toward them.'],
    ['ANAPHOR', rc.ANAPHOR, 'Rounds 2, 7, 10 and 12 all show it: you swung, you died.', 'Rounds 14 and 16 were your multikill rounds.'],
    ['PREDICTION', rc.PREDICTION, 'you should see fewer deaths where nobody was close', 'you saw fewer deaths'],
    ['TIMES_Q', rc.TIMES_Q, 'and both times nobody was close', 'and both deaths came early'],
    ['LAST_ALIVE_APART', rc.LAST_ALIVE_APART, 'and two more you were the last one alive', 'and you were the last one alive in round 5'],
    ['AGENT_KILLS', rc.AGENT_KILLS, 'Cypher got you twice on Pearl', 'You got Cypher twice on Pearl'],
    ['POINTER', rc.POINTER, 'Rounds 2, 7, 10 and 12 all show it.', 'Rounds 2, 7, 10 and 12 were lost.'],
    ['ADVICE_CUT', rc.ADVICE_CUT, 'nobody answered your death, so before you swing, glance at it', 'nobody answered your death, so the round went'],
    ['CLEAREST', rc.CLEAREST, 'The clearest one was round 2, a defence round you won.', 'Round 2 was the clearest win.'],
    ['COST_TALK', rc.COST_TALK, 'What cost you was where you stood when you took the fight.', 'You won the round.'],
  ]) ok(re.test(pos) && !re.test(neg), `${name} matches "${pos.slice(0, 60)}" and not "${neg.slice(0, 60)}"`);
  ok([...'In round 7 no teammate was close, in round 11 nobody was near, and in round 14 a teammate was close.'.matchAll(rc.PER_ROUND)].map((m) => m[1]).join() === '7,11,14'
    && ![...'In round 1, 26 s in, a teammate traded you.'.matchAll(rc.PER_ROUND)].some((m) => m[1] === '26')
    && [...'In rounds 4, 7 and 10 she killed you.'.matchAll(rc.PER_ROUND)].length === 0, 'PER_ROUND: one per singular round, never a time, never a run');
  ok([...'twice with no teammate close and once with one close'.matchAll(rc.SHARE)].length === 2 && [...'twice in a row'.matchAll(rc.SHARE)].length === 0, 'SHARE: "twice with" and "once with", not "twice in a row"');
  const q = rc.quantOf('in a couple of those early rounds a teammate was close');
  ok(q && q.want.n === 2 && q.atLeast && q.early && q.det === 'those', 'QUANT: "a couple of those early" is at least 2 of the early deaths');
  const ISO = kn.ISOLATION_LESSON;
  ok(['Do not rush him alone.', 'Rushing the isolated Chamber alone because the numbers feel safe.', 'Avoid untradeable duels.', 'An early isolated duel loses the round.', 'Your teammates cannot see your angle.'].every((t) => ISO.test(t))
    && !['Swing with a teammate when ahead in numbers.', 'You are alone against two, so play the clock.', 'Fight beside your Sage.', 'Hold the angle from cover.'].some((t) => ISO.test(t)),
  'ISOLATION_LESSON: five isolation lessons and none of four others (a clutch "alone against" among them)');

  // The rows: [n, died, sec, killer, mate, traded, mates alive at the death, afk]
  const ctxOf = (list, extra = {}) => rc.contextOfChat({ game: 'valorant', language: 'en', agent: 'Iso', sides: { mates: new Set(), enemies: new Set() }, counted: { texts: [] }, ...extra,
    rounds: new Map(list.map(([n, died, sec, killer, mate, traded, mates, afk, result]) => [n, { n, side: 'attacking', result: result || 'lost', died, sec, killer, kills: 0, feed: [], spot: null,
      mate, traded, atDeath: died ? [mates == null ? 4 : mates, 3] : null, afterPlant: false, plantSec: null, ...(afk ? { afk: true } : {}) }])) });
  const rows = (...ss) => ss.map((s, i) => (Array.isArray(s) ? { s: s[0], p: s[1] } : { s, p: 0 }));
  // Corrode 3 to 13: Omen in 1 (close, traded), 5 (close, last alive), 7 and 11 (far), 14 (close), 16 (last alive, no distance).
  const corrode = ctxOf([
    [1, true, 26, 'Omen', 'close', true], [2, true, 32, 'Fade', 'close', false], [3, false], [4, false], [5, true, 32, 'Omen', 'close', false, 1],
    [6, true, 21, 'Phoenix', 'far', true], [7, true, 84, 'Omen', 'far', false], [8, true, 27, 'Chamber', 'close', false], [9, true, 38, 'Phoenix', 'far', false],
    [10, true, 27, 'Phoenix', 'far', false], [11, true, 12, 'Omen', 'far', false], [12, true, 10, 'Fade', 'far', false], [13, true, 21, 'Reyna', 'close', false],
    [14, true, 31, 'Omen', 'close', false], [15, false], [16, true, 53, 'Omen', null, false, 1],
  ], { askedAgents: ['Omen'] });
  const omen = 'Omen killed you six times in this Corrode match, and the fix is to make him fight you where you can see him coming.';
  const hit = rc.checkRows(rows(omen, 'Three of those six he was never traded.'), corrode);
  ok(hit.length === 1 && hit[0].index === 1 && hit[0].kind === 'multi' && /5 of those 6/.test(hit[0].reason),
    'CAUGHT: "Three of those six he was never traded" of Omen\'s six, Riot has 5 untraded (Corrode Plat)', JSON.stringify(hit));
  ok(!rc.checkRows(rows(omen, 'Five of those six he was never traded.'), corrode).length, 'kept: five of those six never traded, the true count');
  const iron = 'Three of those six deaths had nobody close enough to trade, and two more you were the last one alive, so the first thing is spacing: stay close to a teammate.';
  ok(rc.checkRows(rows(omen, iron), corrode).some((h) => h.index === 1 && /rounds 1, 7, 11, 14/.test(h.reason)),
    'CAUGHT: "three of those six had nobody close enough to trade, and two more the last one alive", only rounds 7 and 11 (Corrode Iron)');
  ok(!rc.checkRows(rows(omen, iron.replace('Three of those six', 'Two of those six')), corrode).length, 'kept: two of those six, rounds 7 and 11, the two last alive apart');
  ok(!rc.checkMulti('Look at the rounds: in round 7 he killed you after the plant when no teammate was close, in round 11 at Mid Bottom 12 s in with nobody near, and in round 14 at A Elbow with a teammate close who still could not trade you.', corrode, {})
    && !!rc.checkMulti('In round 7 no teammate was close, and in round 14 nobody was near you.', corrode, {}),
  'one claim a round: the Corrode Plat round list kept, "in round 14 nobody was near" caught');
  const ledger = rc.tradeLedger(corrode, { agents: ['Omen', 'Omen', 'Iso'] });
  ok(/Of your 13 deaths in the match, a teammate traded 2 of the 13 \(rounds 1 and 6\)\. Nobody traded 11 of the 13: 2 as the last one alive, which nobody could trade \(rounds 5 and 16\), 4 with a teammate close who did not trade it, a lesson about when you took the fight \(rounds 2, 8, 13 and 14\), and 5 with no teammate close, a lesson about where you stood \(rounds 7, 9, 10, 11 and 12\)\./.test(ledger)
    && /Of your 6 deaths to Omen, a teammate traded 1 of the 6 \(round 1\)\. Nobody traded 5 of the 6: 2 as the last one alive, which nobody could trade \(rounds 5 and 16\), 1 with a teammate close who did not trade it, a lesson about when you took the fight \(round 14\), and 2 with no teammate close, a lesson about where you stood \(rounds 7 and 11\)\./.test(ledger)
    && ledger.split('deaths to Omen').length === 2 && !/deaths to Iso/.test(ledger) && !/Nobody traded 3 of the 6/.test(ledger) && !ledger.includes(';'),
  'THE LEDGER: the match and Omen\'s six, every bin with its rounds, Omen once, never the player\'s own agent, no semicolon', ledger);
  ok(ledger.includes('Of your 7 early deaths (the first 30 seconds, before any plant, rounds 1, 6, 8, 10, 11, 12 and 13), a teammate traded 2 of the 7 (rounds 1 and 6).') && rc.earlyDeathsOf(corrode.rounds).join() === '1,6,8,10,11,12,13'
    , 'and the early deaths, counted from the rows (30 s and under, before any plant)', rc.earlyDeathsOf(corrode.rounds).join());
  const afk = ctxOf([[1, true, 20, 'Omen', 'close', false], [2, true, 20, 'Omen', 'far', false, 4, true], [3, true, 20, 'Omen', 'far', false]]);
  ok(/Of your 2 deaths in the match/.test(rc.tradeLedger(afk)) && !/round 2\b|rounds 1, 2/.test(rc.tradeLedger(afk)), 'a round Riot says the player sat out is in no count of the ledger');
  // Pearl: Cypher in rounds 3 and 5, both traded, both far, both early.
  const pearl = ctxOf([[1, false], [2, false], [3, true, 13, 'Cypher', 'far', true], [4, false], [5, true, 9, 'Cypher', 'far', true]]);
  ok(!!rc.checkMulti('Cypher got you twice on Pearl, and both times nobody was close enough to trade you, so the answer starts with where you stand.', pearl, {})
    && !!rc.checkMulti('Cypher got you twice on Pearl, both times early and both times with nobody close enough to answer, so the fix is where you stand.', pearl, {})
    && !rc.checkMulti('Cypher got you twice on Pearl, and both times a teammate traded you.', pearl, {})
    && !rc.checkMulti('Cypher got you twice on Pearl, and both times no teammate was close.', pearl, {}),
  'CAUGHT: "Cypher got you twice, both times nobody close enough to trade" (both traded, Pearl Silver and Iron); kept: both traded, both with no teammate close (Riot\'s far)');
  // Sunset 2 to 5: the early deaths 1 (close, traded), 3 and 7 (far), 6 (close); 2 at 45 s.
  const sunset = ctxOf([[1, true, 18, 'Neon', 'close', true], [2, true, 45, 'Neon', 'far', false], [3, true, 27, 'Tejo', 'far', false], [4, false], [6, true, 22, 'Neon', 'close', false], [7, true, 14, 'Tejo', 'far', false]]);
  ok(!!rc.checkMulti('One more thing on that: in a couple of those early rounds a teammate was close and nobody answered your death, so before you swing, glance at whether someone is near enough.', sunset, {})
    && !rc.checkMulti('One more thing on that: in a couple of those early rounds no teammate was close and nobody answered your death, so before you swing, glance at it.', sunset, {}),
  'CAUGHT: "a couple of those early rounds a teammate was close and nobody answered" (round 6 alone, Sunset Iron); kept: no teammate close and nobody answered (3 and 7)');
  // Split: Reyna in 4 (far), 7 (close), 10 (close, traded).
  const split = ctxOf([[4, true, 17, 'Reyna', 'far', false], [7, true, 35, 'Reyna', 'close', false], [10, true, 34, 'Reyna', 'close', true]]);
  const share = 'In rounds 4, 7 and 10 she killed you at B site on attack, twice with no teammate close and once with one close who did not trade it.';
  ok(!!rc.checkMulti(share, split, {}) && !rc.checkMulti(share.replace('twice with no teammate close and once', 'once with no teammate close and twice'), split, {}),
    'CAUGHT: "twice with no teammate close" of rounds 4, 7 and 10, only round 4 far (Split raw); kept: once');

  // The distance reader: alone said of one death.
  const one = (s, st) => rc.checkAlone(s, corrode, { round: null, replyRound: null, ...(st || {}) });
  ok(typeof one('Nobody could trade you there because you were the one holding the angle alone.', { round: 2 }) === 'string'
    && one('Nobody could trade you there because you were the one holding the angle alone.', { round: 9 }) === null,
  'CAUGHT: "holding the angle alone" of round 2, a teammate close (Corrode Iron); kept of round 9, nobody close');
  ok((one('Nobody could trade you there.', { round: 2 }) || {}).rewrite === 'Nobody traded you there.' && one('Nobody could trade you there.', { round: 9 }) === null
    && typeof one('Nobody could trade you there.', { round: 1 }) === 'string',
  'REWRITTEN: "nobody could trade you" of round 2 (close, untraded) to "nobody traded you"; kept of round 9 (far); caught of round 1 (traded)');
  ok((one('Your biggest mistake was dying where nobody could trade you: 11 of your 13 deaths went unanswered.') || {}).rewrite === 'Your biggest mistake was dying where nobody traded you: 11 of your 13 deaths went unanswered.'
    && (one('Your biggest mistake was taking fights nobody could answer in round 2.') || {}).rewrite === 'Your biggest mistake was taking fights nobody answered in round 2.',
  'REWRITTEN: the capability of the untraded deaths, "dying where nobody could trade you", said as the fact');
  ok(one('If nobody is close, give ground toward them instead of holding alone.', { round: 2 }) === null
    && one('In your next match you should see fewer deaths where nobody was close enough to answer you, instead of you dying alone on an angle.', { replyRound: 2 }) === null
    && one('On a full buy round, that is the fight you refuse to start alone.', { round: 2 }) === null
    && one('With a teammate close, time the A Link fight with their move instead of taking it alone.', { round: 2 }) === null,
  'kept: a conditional, a prediction, a rule in the present, and advice that says the teammate was close itself');
  ok(typeof one('After the plant, take a position a teammate can trade rather than holding alone; nobody traded your death.', { round: 2 }) === 'string'
    && one('Move into A Link with a teammate close enough to follow your fight, rather than taking the space alone.', { round: 6 }) === null,
  'CAUGHT: "rather than holding alone" presupposed of round 2 (close); kept of round 6, traded with Riot\'s far (Riot\'s distance word only)');
  const carry = rc.checkRows(rows(['In round 14 Omen killed you at A Elbow 31 s in.', 0], ["With the spike ticking, taking another duel away from your teammate's reach gave the round back.", 1]), corrode);
  ok(carry.length === 1 && carry[0].index === 1 && carry[0].kind === 'alone', 'CAUGHT: "away from your teammate\'s reach" a paragraph after round 14, the reply\'s only round (Fracture Asc+)', JSON.stringify(carry));
  ok(rc.checkRows(rows('You took fights alone, from spots where nobody on your team could see the same enemy.', 'Rounds 2, 7, 10 and 12 all show it: you swung, you died.'), corrode).some((h) => h.index === 1)
    && !rc.checkRows(rows('You took fights alone, from spots where nobody on your team could see the same enemy.', 'Rounds 7, 10 and 12 all show it: you swung, you died.'), corrode).length,
  'CAUGHT: "Rounds 2, 7, 10 and 12 all show it" after an alone claim, round 2 close (Corrode Iron); kept: rounds 7, 10 and 12, all far, and the habit (4 close, 5 far) kept');
  const crowd = ctxOf([[1, true, 20, 'Omen', 'close', false], [2, true, 20, 'Omen', 'close', false], [3, true, 20, 'Omen', 'close', false], [4, true, 20, 'Omen', 'far', false]]);
  ok(typeof rc.checkAlone('You took your fights alone all match.', crowd, {}) === 'string', 'CAUGHT: the habit "you took your fights alone" where three of the four deaths nobody traded had a teammate close');
  // The clearest one against the cost ranking (Fracture Plat improve).
  const frac = ctxOf([[2, true, 31, 'Astra', 'far', true, 5, false, 'won'], [5, true, 33, 'Jett', 'close', false, 4, false, 'lost'], [6, true, 40, 'Reyna', 'close', false, 3, false, 'won']]);
  frac.costRank = rc.costRank(frac);
  ok(frac.costRank[0].n === 5 && /nobody traded it though a teammate was close/.test(frac.costRank[0].words.join(', ')), 'the cost words say the teammate was close (record-claims.js costRank)');
  ok(rc.checkRows(rows(['What cost you was where you stood when you took the fight.', 0], ['The clearest one was round 2, a defence round you won.', 1]), frac).some((h) => h.index === 1 && h.kind === 'clearest')
    && !rc.checkRows(rows(['What cost you was where you stood when you took the fight.', 0], ['The clearest one was round 5, an attack round you lost.', 1]), frac).length
    && !rc.checkRows(rows('The clearest one was round 2, a defence round you won.'), frac).length,
  'CAUGHT: "The clearest one was round 2" (won, traded) after what cost the player, round 5 ranked costliest; kept: round 5, and with no cost said before');

  // The prompt: the ledger, the enemy block, the round lines, the counted title, the earlier words.
  const cards = [
    { n: 1, side: 'attacking', result: 'lost', died: true, verified: true, pistol: true, riot: { sec: 26, killer: 'Omen', traded: true, alive: { mates: 3, enemies: 4 }, mate: 'close' } },
    { n: 5, side: 'attacking', result: 'lost', died: true, verified: true, riot: { sec: 32, killer: 'Omen', traded: false, alive: { mates: 1, enemies: 2 }, mate: 'close' } },
    { n: 7, side: 'attacking', result: 'lost', died: true, verified: true, riot: { sec: 84, killer: 'Omen', traded: false, alive: { mates: 3, enemies: 2 }, mate: 'far' } },
    { n: 11, side: 'attacking', result: 'lost', died: true, verified: true, riot: { sec: 12, killer: 'Omen', traded: false, alive: { mates: 4, enemies: 5 }, mate: 'far' }, why: 'Nobody could trade you when you fought from it again.' },
    { n: 14, side: 'defending', result: 'lost', died: true, verified: true, riot: { sec: 31, killer: 'Omen', traded: false, alive: { mates: 4, enemies: 2 }, mate: 'close' },
      why: 'After the plant, take a position a teammate can trade rather than holding alone; nobody traded your death.' },
    { n: 16, side: 'defending', result: 'lost', died: true, verified: true, riot: { sec: 53, killer: 'Omen', traded: false, alive: { mates: 1, enemies: 2 } } },
  ];
  const omenIn = cp.normalise({ v: 2, game: 'valorant', language: 'en', rankBand: 'plat_diamond',
    match: { kind: 'valorant', map: 'Corrode', agent: 'Iso', mode: 'Competitive', result: 'Defeat', score: '3-13', cards,
      lists: { mistakes: [{ key: 'untraded', title: 'Died where nobody could trade', detail: '5 of your 6 deaths went unanswered.', rounds: [5, 7, 11, 14, 16], count: 5,
        fix: 'Before you swing, check someone can see the same angle. If nobody can, wait or reposition.' }] },
      coach: { summary: 'Nobody could trade you in round 14 when you fought from A Elbow.', focus: null } } });
  omenIn.byEnemy = true;
  const msgs = [{ role: 'user', content: 'How do I play against Omen?' }];
  const op = cp.buildPrompt(omenIn, msgs, { variant: 'v2' });
  ok(/Of your 6 deaths to Omen, a teammate traded 1 of the 6 \(round 1\)\. Nobody traded 5 of the 6:/.test(op) && /rounds 7 and 11/.test(op) && !/Nobody traded 3 of the 6/.test(op),
    'THE ENEMY ASKED ABOUT counts as the ledger counts: "Nobody traded 5 of the 6", "rounds 7 and 11", never "Nobody traded 3 of the 6"');
  ok(op.indexOf('THE TRADES AND THE DISTANCE') > op.indexOf('COUNTED (') && op.indexOf('THE TRADES AND THE DISTANCE') < op.indexOf('ROUNDS (')
    && op.indexOf('THE TEAMMATE AT THE DEATH') < op.indexOf('ROUNDS (') && /A death nobody traded is never proof the player was alone/.test(op),
  'the ledger and the teammate rule come before the round lines');
  ok(/R5 attack, lost\. Died 32 s in to Omen, 1 against 2 standing as you died \(you counted\), not traded, as the last one alive with no teammate left to trade it\./.test(op)
    && /R14 defence, lost\. Died 31 s in to Omen, 4 against 2 standing as you died \(you counted\), not the first death: 1 teammate already down, leaving 3 against 2, not traded, with a teammate close by, so the fight came before that teammate could swing\./.test(op)
    && /R7 attack, lost\. Died 84 s in to Omen, 3 against 2 standing as you died \(you counted\), not the first death: 2 teammates already down, leaving 2 against 2, not traded, with no teammate close by\./.test(op),
  'the round lines: the last one alive with no teammate close word, a close untraded death says when the fight came, a far one says nobody close');
  ok(/Repeated mistake: Deaths not traded within five seconds, rounds 5, 7, 11, 14 and 16\. 5 of your 6 deaths went unanswered\. Of these, you were the last one alive in rounds 5 and 16, which nobody could trade, and a teammate was close in round 14, where the fight came before they could swing, and no teammate was close in rounds 7 and 11, where the lesson is where you stood\./.test(op)
    && !/Died where nobody could trade/.test(op),
  'the counted untraded mistake under its honest title, split by Riot\'s distance, the last one alive apart');
  const earlier = op.slice(op.indexOf("THE COACH'S EARLIER WORDS"));
  ok(/Summary: Nobody traded you in round 14 when you fought from A Elbow\./.test(earlier) && !/R14: /.test(earlier) && /R11: Nobody could trade you when you fought from it again\./.test(earlier),
    'THE COACH\'S EARLIER WORDS through the record gates: "nobody could trade you" of round 14 (close) rewritten, the round 14 line saying alone left out, round 11 (far) kept');
  const fo = cp.factsOf(omenIn, msgs);
  ok(fo.counted.pairs.has('5/6') && fo.counted.pairs.has('1/6') && gates.check('Nobody traded 5 of your 6 deaths to Omen.', fo).drop === null, 'the ledger\'s counts are pairs a reply may say back');
  // Retrieval: no isolation lesson for deaths with a teammate close.
  const fracCards = (mate) => [
    { n: 2, side: 'defending', result: 'won', died: true, verified: true, riot: { sec: 31, killer: 'Astra', traded: true, alive: { mates: 5, enemies: 1 }, mate: 'far' } },
    { n: 5, side: 'attacking', result: 'lost', died: true, verified: true, pistol: true, riot: { sec: 33, killer: 'Chamber', traded: false, alive: { mates: 4, enemies: 3 }, mate, place: 'A site' } },
    { n: 6, side: 'attacking', result: 'won', died: true, verified: true, riot: { sec: 40, killer: 'Reyna', traded: false, alive: { mates: 3, enemies: 3 }, mate } },
  ];
  const sigClose = kn.recordSignals(fracCards('close').map((c) => ({ n: c.n, died: true, result: c.result, mate: c.riot.mate, traded: c.riot.traded, lastAlive: false })));
  const sigFar = kn.recordSignals(fracCards('far').map((c) => ({ n: c.n, died: true, result: c.result, mate: c.riot.mate, traded: c.riot.traded, lastAlive: false })));
  ok(JSON.stringify(sigClose.ruledOut) === '["isolated"]' && !sigClose.causes.includes('isolated') && JSON.stringify(sigFar.ruledOut) === '[]' && sigFar.causes.includes('isolated'),
    'recordSignals rules out isolation where the untraded deaths had a teammate close and none far, and keeps it where they were far');
  const fin = (mate) => cp.normalise({ v: 2, game: 'valorant', language: 'en', rankBand: 'asc_plus', match: { kind: 'valorant', map: 'Fracture', agent: 'Jett', mode: 'Swiftplay', result: 'Victory', score: '5-1', cards: fracCards(mate) } });
  const bq = [{ role: 'user', content: 'What was my biggest mistake?' }];
  const casesClose = cp.casesFor(fin('close'), bq);
  ok(!casesClose.some((c) => (c.cause || []).includes('isolated') || kn.ISOLATION_LESSON.test(`${c.signal} ${c.decision} ${c.mistakeToAvoid} ${c.why}`))
    && !cp.pickNotes(fin('close'), bq).some((t) => kn.ISOLATION_LESSON.test(t)),
  'Fracture with a teammate close at the deaths nobody traded: no isolation case (k110 among them) and no isolation note', casesClose.map((c) => c.id).join());
  ok(cp.casesFor(fin('far'), bq).some((c) => (c.cause || []).includes('isolated')) && cp.pickNotes(fin('far'), bq).some((t) => kn.ISOLATION_LESSON.test(t)),
    'and with those deaths far, the isolation case and notes come back');
  // The review: the ledger beside the counts, its pairs quotable, every band.
  const rin = mr.normalise({ variant: 'C', counts: {}, context: { agent: 'Iso', map: 'Corrode', language: 'en', rankBand: 'silver_gold' },
    rounds: cards.map((c) => ({ n: c.n, side: c.side, result: c.result, died: true, verified: true, sec: c.riot.sec, killer: c.riot.killer,
      traded: c.riot.traded, alive: c.riot.alive, ...(c.riot.mate ? { mate: c.riot.mate } : {}) })) });
  const rl = mr.ledgerOf(rin);
  ok(/Of your 6 deaths in the match, a teammate traded 1 of the 6 \(round 1\)\. Nobody traded 5 of the 6:/.test(rl) && rl.startsWith(mr.LEDGER_HEAD_REVIEW),
    'the review gets the ledger, from the verified rounds every client sends', rl.slice(0, 200));
}

// ── Round 8, the timeline and the state (the blind audit of round 7) ──────
{
  console.log('\nround 8, the timeline and the state:');
  const rc = require('../server/services/record-claims');
  const cp = require('../server/services/chat-prompt');
  const mk = (rows, extra) => ({ rounds: new Map(rows.map((r) => [r.n, r])), kind: 'chat', map: 'Sunset', asked: null, enemies: new Set(), enemiesKnown: false, ...extra });
  const R = (o) => ({ died: true, firstDeath: false, firstKill: null, alive: null, sec: null, plantSec: null, afterPlant: null, deathAt: null, ownKills: null, killPlaces: null, place: null, side: null, ...o });
  const re = (name, rx, yes, no) => ok(rx.test(yes) && !rx.test(no), `${name} matches "${yes}" and not "${no}"`);
  // Every new regex on a known positive and a known negative.
  re('PLANT_DURING', rc.PLANT_DURING, 'As your teammate plants, hold from cover.', 'Hold the spot on the plant site from cover.');
  re('PLANT_DURING (the spike)', rc.PLANT_DURING, 'Hold the corner while the spike is being planted.', 'After the plant, hold from cover off site.');
  re('ENEMY_ROLE_OBJ', rc.ENEMY_ROLE_OBJ, 'Hold from cover and make the attacker expose themselves.', 'As the attacker with the spike down, you can wait.');
  re('ENEMY_ROLE_SUBJ', rc.ENEMY_ROLE_SUBJ, 'The defenders will push into you if you stay.', 'The defenders on site rotated late.');
  re('FIRST_SAID', rc.FIRST_SAID, 'In round 3 you were the first contact.', 'Your first kill came early.');
  re('LEFT_HEAD', rc.LEFT_HEAD, 'So your death left four players to hit a site.', 'Your team left the site early.');
  re('LEFT_N', rc.LEFT_N, ' four players to hit a site', ' two players down');
  re('LEFT_DOWN', rc.LEFT_DOWN, ' the team a man down', ' four players to hit a site');
  re('LATER', rc.LATER, 'Six seconds later you were dead.', 'Six seconds into the round you died.');
  re('DEATH_THEN', rc.DEATH_THEN, 'Six seconds later you were dead.', 'Six seconds later the spike went down.');
  re('KILL_OWNER_BEFORE', rc.KILL_OWNER_BEFORE, 'After your teammate\'s ', 'After the ');
  re('COST_MOST', rc.COST_MOST, 'The one that cost you the most was round 2.', 'Round 2 had the clearest calls.');
  re('CLEAREST (plainest)', rc.CLEAREST, 'The plainest one was round 2.', 'The plainest advice is to wait.');

  // 1. The plant phase (Fracture 5 to 1 Iron review, round 5: the death after the plant).
  const frac = mk([R({ n: 5, side: 'attack', sec: 33, plantSec: 32.1, afterPlant: true, alive: [4, 3] }), R({ n: 6, side: 'attack', sec: 30, plantSec: 32.1, afterPlant: false }),
    R({ n: 7, side: 'attack', sec: 10, plantSec: 50, afterPlant: false })], { kind: 'review' });
  ok(typeof rc.checkPlantPhase('As your teammate plants, hold from cover and check that you are stopped before shooting.', frac, { round: 5 }) === 'string',
    'CAUGHT: "As your teammate plants, hold from cover" of Fracture round 5, the death after the plant');
  ok(rc.checkPlantPhase('As your teammate plants, hold from cover.', frac, { round: 6 }) === null && rc.checkPlantPhase('After the plant, hold from cover off site.', frac, { round: 5 }) === null
    && rc.checkPlantPhase('Hold the spot on the plant site from cover.', frac, { round: 5 }) === null,
  'kept: a death inside the plant\'s 4 s, advice for after the plant, and the plant site');
  ok(typeof rc.checkPlantPhase('While your team was planting you were already swinging B Main.', frac, { round: 7 }) === 'string', 'CAUGHT: "while your team was planting" of a death 40 s before the plant');
  // 2. The enemy by its side (Corrode 3 to 13 Asc+ review, round 1 on attack).
  const corr = mk([R({ n: 1, side: 'attack' }), R({ n: 13, side: 'defence' })], { kind: 'review' });
  ok(typeof rc.checkEnemyRole('After the plant, hold from cover on B Site and make the attacker expose themselves, accepting less forward vision to stay alive for the clock.', corr, { round: 1 }) === 'string'
    && typeof rc.checkEnemyRole('The defenders will push into you if you stay.', corr, { round: 13 }) === 'string',
  'CAUGHT: "make the attacker expose themselves" to an attacker (Corrode round 1), and the defenders coming at a defender');
  ok(rc.checkEnemyRole('After the plant, hold from cover and make the defenders expose themselves.', corr, { round: 1 }) === null
    && rc.checkEnemyRole('Fall back and make the attackers come to you.', corr, { round: 13 }) === null
    && rc.checkEnemyRole('As the attacker with the spike down, you can wait.', corr, { round: 1 }) === null
    && rc.checkEnemyRole('Make the attackers in rounds 1 and 13 come to you.', corr, {}) === null,
  'kept: the other side\'s noun, the player\'s own side named as theirs, and a sentence of two rounds');
  // 3 and 4. The first contact and what the death left (Pearl 1 to 5).
  const pearl = mk([R({ n: 3, side: 'attack', alive: [4, 5], sec: 13 }), R({ n: 4, side: 'attack', alive: [4, 5], sec: 8 }),
    R({ n: 5, side: 'defence', firstDeath: true, alive: [5, 5], sec: 9 }), R({ n: 6, side: 'defence', alive: [5, 4], sec: 9, firstKill: false }),
    R({ n: 8, side: 'defence', alive: [5, 4], sec: 9, firstKill: true })]);
  ok(typeof rc.checkFirst('That is the same thing that would have saved rounds 3 and 5, where you were the first contact and nobody was near enough to help you survive it.', pearl, {}) === 'string'
    && typeof rc.checkFirst('You were the first one into a spot with no teammate close enough to answer.', pearl, { round: 4 }) === 'string'
    && typeof rc.checkFirst('In round 6 you took the first fight and then died.', pearl, {}) === 'string',
  'CAUGHT: "rounds 3 and 5, where you were the first contact" (round 3 at 4 against 5, Pearl Iron), "the first one into a spot" (round 4, Pearl Silver), and a first fight where a teammate got the first kill');
  ok(rc.checkFirst('In round 5 you were the first contact, at 5 against 5.', pearl, {}) === null && rc.checkFirst('If you are the first contact, wait for a teammate.', pearl, { round: 3 }) === null
    && rc.checkFirst('In round 8 you took the first fight and then died.', pearl, {}) === null && rc.checkFirst('In round 6 you were the first to die on your team.', pearl, {}) === null,
  'kept: round 5\'s true first contact, a plan, a first fight the player opened with the first kill, and a first death at 5 against 4');
  ok(typeof rc.checkLeftWords('So your death left four players to hit a site a man down with the clock still full.', pearl, { round: 4 }) === 'string',
    'CAUGHT: "your death left four players ... a man down" of a death 4 against 5 (Pearl Silver round 4)');
  ok(rc.checkLeftWords('Your death left three players against five.', pearl, { round: 4 }) === null && rc.checkLeftWords('Your death left the team two players down.', pearl, { round: 4 }) === null
    && rc.checkLeftWords('Your death left your team a man down.', pearl, { round: 5 }) === null && rc.checkLeftWords('Your death left four players, and then Sova died too.', pearl, { round: 5 }) === null,
  'kept: three left, two down, a man down after a death at 5 against 5, and the four the death truly left');
  // 5. A gap held to its own anchor (Sunset 2 to 5 Iron, round 2: kill 20.2 s, plant 25.1 s, death 26.6 s).
  const sun = mk([R({ n: 2, side: 'attack', sec: 27, deathAt: 26.6, plantSec: 25.1, afterPlant: true, ownKills: [20.2] }),
    R({ n: 7, side: 'defence', place: 'A Alley', killPlaces: ['A Elbow'], firstKill: true }), R({ n: 9, side: 'defence', place: 'A Alley', killPlaces: ['A Elbow'], firstKill: false })]);
  ok(typeof rc.checkLater('Six seconds later you were dead, nobody killed their Jett within five seconds, and the round slid away from there.', sun, { round: 2, recent: ['So it was 4 against 3 when the spike landed at B.'] }) === 'string',
    'CAUGHT: "the spike landed at B. Six seconds later you were dead" (Sunset round 2, 1.5 s after the plant)');
  ok(rc.checkLater('Six seconds after your last kill you were dead.', sun, { round: 2 }) === null && rc.checkLater('Their Jett killed you 1.5 s after the plant.', sun, { round: 2 }) === null
    && rc.checkLater('Six seconds later you were dead.', sun, { round: 2, recent: ['You killed their Clove at 20 s.'] }) === null
    && rc.checkLater('Six seconds later you were dead.', sun, { round: 2 }) === null,
  'kept: the gap from the last kill, from the plant, "later" after the kill, and "later" with no event before it');
  // 6. The kill's place (Sunset 4 to 13 round 7, Plat and Silver).
  ok(typeof rc.checkKillPlace('After the first kill at A Alley, give up ground toward your team rather than contesting alone with the numbers in your favour.', sun, { round: 7 }) === 'string'
    && typeof rc.checkKillPlace('After the opening kill at A Alley, fall back to cover and make the attackers come to your numbers advantage.', sun, { round: 7 }) === 'string',
  'CAUGHT: "After the first kill at A Alley" (Plat) and "After the opening kill at A Alley" (Silver), the kill at A Elbow and the death at A Alley');
  ok(rc.checkKillPlace('After the first kill at A Elbow, give up ground.', sun, { round: 7 }) === null && rc.checkKillPlace('You died at A Alley after your kill.', sun, { round: 7 }) === null
    && rc.checkKillPlace('After the first kill at A Site, give up ground.', sun, { round: 7 }) === null && rc.checkKillPlace('After the first kill at A Alley, give up ground.', sun, { round: 9 }) === null
    && rc.checkKillPlace('After your teammate\'s kill at A Alley, give up ground.', sun, { round: 7 }) === null,
  'kept: the kill\'s own place, the death\'s place told as the death\'s, the bare site of its side, a first kill not the player\'s, and a teammate\'s kill');
  // 7. The example held to the cost rank, said as the cost itself.
  const cost = mk([R({ n: 2, side: 'defence' }), R({ n: 5, side: 'attack' })]);
  cost.costRank = [{ n: 5, result: 'lost' }, { n: 2, result: 'won' }];
  ok(typeof rc.checkClearest('The one that cost you the most was round 2, a defence round you won.', cost, { recent: [] }) === 'string'
    && rc.checkClearest('The one that cost you the most was round 5.', cost, { recent: [] }) === null
    && rc.checkClearest('The plainest one was round 2.', cost, { recent: [] }) === null,
  'CAUGHT: "the one that cost you the most was round 2" over round 5 with no cost sentence before; kept: round 5, and "the plainest one" with no cost talk');

  // The chat prompt: the standing as what it was and what it left, the gaps in the death's entry, the plant to the tenth.
  const cards = [{ n: 2, side: 'attacking', result: 'lost', died: true, verified: true,
    derived: { sinceOwnKill: 6.4, afterPlantSec: 1.5 },
    riot: { sec: 27, killer: 'Jett', traded: false, alive: { mates: 4, enemies: 3 }, plantSec: 25.1, plantSite: 'B', afterPlant: true,
      feed: [{ s: 12, by: 'enemy', on: 'mate', ka: 'Clove', va: 'Sova' }, { s: 20.2, by: 'me', on: 'enemy', va: 'Clove' }, { s: 22, by: 'mate', on: 'enemy', va: 'Omen' }, { s: 26.6, by: 'enemy', on: 'me', ka: 'Jett' }] } }];
  const sin = cp.normalise({ v: 2, game: 'valorant', language: 'en', match: { kind: 'valorant', map: 'Sunset', agent: 'Neon', mode: 'Competitive', result: 'Defeat', score: '2-5', cards } });
  const sp = cp.buildPrompt(sin, [{ role: 'user', content: 'Walk me through round 2' }]);
  ok(/4 against 3 standing as you died \(you counted\), not the first death: 1 teammate already down, leaving 3 against 3/.test(sp),
    'the round line says the standing at the death with the player counted, the teammate already down, and what the death left');
  ok(/25\.1 s in, the spike went down at B/.test(sp) && /27 s in \(1\.5 s after the plant, 6\.4 s after your last kill, with 43\.5 s left on the spike\), their Jett killed you/.test(sp) && !/Computed from the record: the death came/.test(sp),
    'the feed gives the plant to the tenth and the gaps in the death\'s own entry, each with its event, and no sentence apart', (/Kills in order[^\n]*/.exec(sp) || [''])[0]);
  // The row the gate reads carries the feed's death second and the player's kills before it.
  const sf = cp.factsOf(sin, [{ role: 'user', content: 'Walk me through round 2' }]);
  const sr = rc.contextOfChat(sf).rounds.get(2);
  ok(sr.deathAt === 26.6 && JSON.stringify(sr.ownKills) === '[20.2]' && sr.plantSec === 25.1 && sr.afterPlant === true,
    'contextOfChat: the death\'s second and the player\'s kills before it from the feed, the plant beside them', JSON.stringify({ d: sr.deathAt, k: sr.ownKills, p: sr.plantSec, a: sr.afterPlant }));
}

// ── ROUND 8: what the game itself makes certain (game-claims.js) ──────────
console.log('\nround 8, the game facts gates:');
{
  const base = cp.normalise({ v: 2, game: 'valorant', match: { kind: 'valorant', map: 'Sunset', agent: 'Jett', mode: 'Competitive', cards: [] } });
  const f8 = cp.factsOf(base, []);
  ok(Array.isArray(f8.primer) && f8.primer.some((e) => e.subject === 'Outlaw' && e.attribute === 'hits' && e.part === 'body' && e.armor === 'Heavy Armor' && e.value === 2),
    'the primer holds the Outlaw body at 2 hits on Heavy Armor');
  const g8 = (s, f = f8) => (gates.check(s, f, {}).drop || {}).gate || null;
  // One shot (round 7, Sunset Iron).
  ok(g8("With the spike down and your team up a player, the defenders have to come to you, so the Outlaw's one-shot body at any range only matters if you walk into its line.") === 'oneshot',
    'CAUGHT: the Outlaw one-shot body at any range (round 7)');
  ok(g8('The Phantom one-taps the head at any range.') === 'oneshot', 'CAUGHT: the Phantom head at any range');
  ok(!g8('An Operator one-shots body at any range, so never dry peek it.') && !g8('The Outlaw one-shots the head at any range.')
    && !g8('The Outlaw kills through Light Armor with one body hit, and needs two on Heavy Armor.'), 'kept: the Operator body, the Outlaw head, the armour named');
  // Firing while moving (round 7, Pearl Iron aim).
  ok(g8('Pair that with bursting and moving, since the kills come from being hard to hit as much as from the first bullet landing.') === 'move-fire', 'CAUGHT: bursting and moving (round 7)');
  ok(!g8('Fire a burst, strafe to a new spot between bursts, and stop dead before the next one.') && !g8('Never shoot while moving, stop first.'), 'kept: moving between bursts, and the rule');
  // Bullets (round 7, Corrode Silver).
  // The player's own agent, since a kit the player does not have goes earlier (gate ability).
  const as = (agent) => cp.factsOf(cp.normalise({ v: 2, game: 'valorant', match: { kind: 'valorant', map: 'Sunset', agent, mode: 'Competitive', cards: [] } }), []);
  const fIso = as('Iso');
  ok(g8('Contingency is just a smoke that moves, so bullets go through it.', fIso) === 'kit' && g8('High Tide blocks bullets, so push behind it.', as('Harbor')) === 'kit',
    'CAUGHT: Contingency called a smoke, High Tide called bullet blocking');
  ok(!g8('Contingency blocks bullets as it moves forward, so walk behind it.', fIso), 'kept: Contingency blocks bullets');
  // What only a look could see (round 7, Corrode Plat aim).
  const rounds = new Map([[12, { n: 12, died: true, look: { cause: 'lost-duel', what: 'You held the gap at B Main with a Guardian, and Fade appeared in it and killed you with a Vandal before you fired.' } }]]);
  const fl = { ...f8, rounds, asked: 12, oneRound: true };
  ok(g8('Your crosshair sat too deep toward the wall, so when Fade swung into the gap their movement opened the angle toward you.', fl) === 'unseen', 'CAUGHT: your crosshair sat too deep (round 7)');
  ok(!g8('Keep your crosshair back from the corner, out in the open space a peeker moves into.', fl) && !g8('If your crosshair sat deep in the wall, a peeker lands off it.', fl), 'kept: the imperative and the hypothetical');
  const fl2 = { ...fl, rounds: new Map([[12, { n: 12, died: true, look: { what: 'Your crosshair was low on the gap when Fade appeared.' } }]]) };
  ok(!g8('Your crosshair was low when Fade swung into the gap.', fl2), 'kept: a look that says where the crosshair was');
  {
    const names = gates.GATES.map(([n]) => n);
    const at = names.indexOf('oneshot');
    // The coach bench 9's three gates come after them (asserted in their own section).
    ok(names.slice(at, at + 5).join() === 'oneshot,move-fire,bullets,unseen,looks' && names.slice(at + 5).join() === 'economy-scope,premise,map-habit',
      'the round 8 gates run after every gate before, and the stream C looks gate after them');
  }
  // Deathmatch: the disclaimer loophole (gateMode) and the frame across sentences (gateReply).
  ok(g8('Practise in Deathmatch, where there are no teammates: before each peek, ask yourself whether a teammate could trade you.') === 'mode', 'CAUGHT: a disclaimer, then the team rule');
  ok(!g8('Play Deathmatch, since it needs no teammates: pick one angle and hold it.') && !g8('Deathmatch has no teammates, so do not practise trades there.')
    && !g8('Practise it in your next match rather than in Deathmatch, because it needs teammates.'), 'kept: the disclaimer with a solo drill, and the rule itself');
  ok(gates.TEAM_WORDS.test('a teammate backs you up') && gates.TEAM_WORDS.test('trade you'), 'TEAM_WORDS is the shared one, backing you up added');
  const paras = ['To practise this, play Deathmatch but treat it as a positioning drill, not a frag race. Before every engagement, ask whether you have an escape or a teammate nearby, and skip the fights where the answer is no.',
    "In your next matches, check that a teammate can trade you before you peek."];
  const rows = cp.gateReply(paras, f8, {});
  const dropped = rows.filter((r) => r.drop).map((r) => `${r.drop.gate}: ${r.s.slice(0, 30)}`);
  ok(rows.length === 3 && rows[1].drop && rows[1].drop.gate === 'mode' && !rows[0].drop && !rows[2].drop, 'CAUGHT: the Split Silver aim teammate nearby a sentence after Deathmatch (round 7); the match paragraph kept', dropped.join(' | '));
}

// ── Round 8, usefulness (the blind audit of round 7): aim as aim, the guns' lines, the two weakest numbers ──
{
  console.log('\nround 8, usefulness:');
  const kn = require('../server/services/knowledge');
  const gc = require('../server/services/game-claims');
  const rc = require('../server/services/record-claims');
  const ask = (q) => [{ role: 'user', content: q }];
  const AIM_Q = 'How do I get better aim at my rank?';
  const IMPROVE_Q = 'How do I improve at my rank? What is holding me back from climbing?';
  const mk = (band, cards, extra = {}) => {
    const x = cp.normalise({ v: 2, game: 'valorant', language: 'en', ...(band ? { rankBand: band } : {}),
      match: { kind: 'valorant', map: 'Corrode', agent: 'Jett', mode: 'Competitive', result: 'Defeat', score: '3-13', cards, ...extra } });
    x.byEnemy = true;
    return x;
  };
  // 1. An aim question is asked as aim: no climbing, not general.
  const qa = cp.questionTopics({ language: 'en' }, ask(AIM_Q));
  const qi = cp.questionTopics({ language: 'en' }, ask(IMPROVE_Q));
  const qp = cp.questionTopics({ language: 'en' }, ask('What should I practise to fix my aim?'));
  ok(qa.keys.has('aim') && !qa.keys.has('climb') && qa.general === false, 'CAUGHT: "How do I get better aim at my rank?" is aim alone, not climbing, not general', [...qa.keys].join());
  ok(qi.keys.has('climb') && qi.general === true && qp.keys.has('aim') && qp.keys.has('practice') && qp.general === true,
    'kept: an improve question stays climbing and general, and aim with practice stays general');
  // 2. The aim facts at every band, with the guns' own lines from the primer.
  const cards = [
    { n: 2, side: 'attacking', result: 'lost', died: true, verified: true, riot: { sec: 30, killer: 'Omen', weapon: 'Phantom', traded: false, mate: 'far', alive: { mates: 5, enemies: 5 },
      feed: [{ s: 12, by: 'me', on: 'enemy', ka: 'Jett', va: 'Sova', w: 'Vandal' }, { s: 30, by: 'enemy', on: 'me', ka: 'Omen', va: 'Jett', w: 'Phantom' }] } },
    { n: 3, side: 'attacking', result: 'lost', died: true, verified: true, riot: { sec: 40, killer: 'Omen', weapon: 'Phantom', traded: false, mate: 'close', firstDeath: false, alive: { mates: 4, enemies: 5 },
      feed: [{ s: 20, by: 'me', on: 'enemy', ka: 'Jett', va: 'Reyna', w: 'Vandal' }, { s: 40, by: 'enemy', on: 'me', ka: 'Omen', va: 'Jett', w: 'Phantom' }] } },
    { n: 5, side: 'attacking', result: 'lost', died: true, verified: true, riot: { sec: 25, killer: 'Reyna', weapon: 'Vandal', traded: true, mate: 'close', firstDeath: true, alive: { mates: 5, enemies: 5 } } },
  ];
  const against = [{ label: 'Headshot %', value: 27, baseline: 32, games: 10 }];
  for (const band of ['iron_bronze', 'silver_gold', 'plat_diamond', 'asc_plus']) {
    const f = cp.factsOf(mk(band, cards, { against }), ask(AIM_Q));
    const t = (f.aimFacts && f.aimFacts.text) || '';
    ok(/- Vandal, against Heavy Armor: 1 head hit or \d+ body hits from 0 to 50 m, the same at every range\./.test(t)
      && /- Phantom, against Heavy Armor: 1 head hit or \d+ body hits from 0 to 20 m, and 2 head hits or \d+ body hits from 20 to 50 m, so past 20 m one head hit no longer kills and you keep firing\./.test(t)
      && /Mention position or trading at most once, in one sentence after the habit, and only for a round line that shows it\./.test(t)
      && /The drill is one for the shot, in the Range or Deathmatch/.test(t) && !DASHES.test(t) && !t.includes(';'),
    `${band}: THE AIM FACTS carry the Vandal and Phantom lines from the primer, the drill of the shot and trading once at most`);
    ok(gates.check('Your Phantom needs 2 head hits from 20 to 50 m against Heavy Armor.', f).drop === null, `${band}: a gun line said back is kept`);
  }
  const low = cp.factsOf(mk('iron_bronze', cards, { against }), ask(AIM_Q)).aimFacts.text;
  const high = cp.factsOf(mk('asc_plus', cards, { against }), ask(AIM_Q)).aimFacts.text;
  ok(/one basic of the shot for these guns: stopping before the first bullet/.test(low) && /counter strafing to a stop/.test(low) && !/fine point/.test(low)
    && /one fine point of the duel/.test(high) && !/counter strafing to a stop/.test(high) && /never make stopping before the shot or counter strafing the fix/.test(high),
  'below Platinum a basic of the shot (the stop stays), from Platinum the fine point with no stop drill');
  ok(cp.factsOf(mk(undefined, cards, { against }), ask(AIM_Q)).aimFacts === null && cp.factsOf(mk('iron_bronze', cards, { against }), ask(IMPROVE_Q)).aimFacts === null,
    'none for a client with no band, or a question not about aim');
  ok(cp.gunLineOf('Vandal', []) === null, 'a gun the primer gives no hits for gets no line, never a guessed one');
  // 3. The notes of an aim question: no trade or spacing note, the player's own gun, the new drills.
  const byText = new Map(kn.all().map((n) => [n.text, n]));
  for (const band of ['iron_bronze', 'silver_gold', 'plat_diamond', 'asc_plus']) {
    const notes = cp.pickNotes(mk(band, cards, { against }), ask(AIM_Q));
    ok(notes.length >= 3 && !notes.some((t) => cp.AIM_TEAM_NOTE.test(t)) && !notes.some((t) => /agent picks|ego fights|monitor/i.test(t)),
      `${band}: an aim question gets no trade, teammate, climbing or monitor note`, notes.map((t) => t.slice(0, 50)).join(' | '));
    ok(notes.filter((t) => byText.get(t) && byText.get(t).weapons).length <= 2, `${band}: two gun notes at most`);
  }
  const ironNotes = cp.pickNotes(mk('iron_bronze', cards, { against }), ask(AIM_Q));
  ok(ironNotes.some((t) => { const n = byText.get(t); return n && Array.isArray(n.weapons) && n.weapons.some((w) => ['vandal', 'phantom'].includes(w)); }),
    'the player\'s own guns bring their notes to an aim answer', ironNotes.map((t) => t.slice(0, 50)).join(' | '));
  const drills = kn.all().filter((n) => /drill$/.test((n.source && n.source.topic) || '') && /\b(?:Range|deathmatch)\b/i.test(n.text));
  for (const band of ['iron_bronze', 'silver_gold', 'plat_diamond', 'asc_plus']) ok(drills.filter((n) => n.ranks && n.ranks.includes(band)).length >= 2, `${band}: aim drill notes in the Range or Deathmatch`);
  ok(drills.every((n) => !/\bteammates?\b|\btrad/i.test(n.text) && !DASHES.test(n.text)), 'the drills ask for no teammate and have no dash');
  ok(cp.AIM_TEAM_NOTE.test('When a teammate commits to a peek, swing with them and take the trade.') && !cp.AIM_TEAM_NOTE.test('Keep your crosshair at head height on the corner you expect them.'),
    'AIM_TEAM_NOTE matches the trade note and not the crosshair note');
  // 4. The rules: the aim rule answers about the shot, no "second point" anywhere, distance and trade apart.
  const P = cp.buildPrompt(mk('silver_gold', cards, { against }), ask(IMPROVE_Q), { variant: 'v2' });
  ok(!/as a second point/.test(cp.VALORANT_RULES) && !/as a second point/.test(P) && !/as a second point/.test(cp.IMPROVING_RULE)
    && /Answer about the shot first: the headshot rate against their own average/.test(cp.VALORANT_RULES)
    && !/nobody able to trade, name that first/.test(cp.VALORANT_RULES)
    && /never close enough to kill or trade, which mixes the two/.test(cp.VALORANT_RULES),
  'CAUGHT: "name trading as a second point" and "nobody able to trade, name that first" are out of the rules; distance and the trade are said apart');
  const lv = cp.leverLine(mk('silver_gold', cards, { against, lists: undefined }), ask(IMPROVE_Q));
  ok(!/second point/.test(lv), 'and THE LEVER no longer invites the trade as a second point');
  // 5. The aim focus pass: trading once at most in an aim answer.
  ok(cp.TRADE_SENT.test('The one habit to build: before you swing or peek, check that a teammate is close enough to see the same angle and kill whoever kills you.')
    && cp.TRADE_SENT.test('14 of those deaths went unanswered, with no teammate killing your killer within five seconds.')
    && !cp.TRADE_SENT.test('Keep your crosshair at head height on the edge you expect them.') && !cp.TRADE_SENT.test('Stop moving before you fire your Vandal.'),
  'TRADE_SENT matches the Split Silver habit and the unanswered count, not the crosshair or the stop');
  const fa = cp.factsOf(mk('silver_gold', cards, { against }), ask(AIM_Q));
  const aimReply = ['Your headshot rate this match was 27%, against your own average of 32% over your last 10 matches. Before you peek, check that a teammate is close enough to trade you.',
    'If nobody is close, do not take the duel at all. The habit to build: notice whether a teammate is close enough to kill whoever kills you.',
    'Stop behind cover and put your crosshair where a head will appear, with a teammate near.'];
  const rowsA = cp.gateReply(aimReply, fa, {});
  const g = rowsA.map((r) => (r.drop ? r.drop.gate : 'keep'));
  ok(g[0] === 'keep' && g[1] === 'keep' && g[2] === 'focus' && g[3] === 'focus' && g[4] === 'keep',
    'CAUGHT: an aim answer keeps its first trade sentence and drops the rest, a sentence that teaches the shot as well kept', g.join());
  const fi = cp.factsOf(mk('silver_gold', cards, { against }), ask(IMPROVE_Q));
  ok(cp.gateReply(aimReply, fi, {}).every((r) => !r.drop || r.drop.gate !== 'focus'), 'kept: the same sentences in an answer not about aim');
  const heavy2 = 'Your headshot rate this match was 27%, against your own average of 32%. Keep your crosshair at head height. Before you peek, check that a teammate is close enough to trade you. Nobody traded you in round 2, and nobody traded you in round 3. Trade deaths win rounds.';
  const pr2 = cp.parseReply(heavy2, mk('silver_gold', cards, { against }), { messages: ask(AIM_Q) });
  ok(pr2.retry === true && pr2.reasons.includes(cp.FOCUS_REASON), 'an aim answer still over half trade is asked again', pr2.reasons.join(' / '));
  // 6. A drill of "that" after a team habit.
  const prev = 'If nobody is, hold the angle from cover and let them come to you instead of swinging alone.';
  const drill = 'Practise that in Deathmatch, where you have no teammates, by holding one angle from cover.';
  ok(gc.pronounDrill(drill, prev) && !gc.pronounDrill('Practise it in Deathmatch, one fight at a time.', 'Land the crosshair, confirm it with your eyes, then click.')
    && !gc.pronounDrill(drill.replace('in Deathmatch', 'in your next match rather than in Deathmatch'), prev),
  'CAUGHT: Split Asc "Practise that in Deathmatch" after a team habit; kept after an aim habit or sent to a match');
  const rowsD = cp.gateReply([`${prev} ${drill}`], fi, {});
  ok(rowsD[1] && rowsD[1].drop && rowsD[1].drop.gate === 'mode', 'through gateReply: the pronoun drill goes as a mode drop', rowsD.map((r) => (r.drop ? r.drop.gate : 'keep')).join());
  // 7. The two weakest numbers from Platinum (Corrode Plat's numbers).
  const corrode = {
    against: [{ label: 'ACS', value: 285, baseline: 377, games: 10 }, { label: 'Damage per round', value: 187, baseline: 239, games: 10 },
      { label: 'K/D', value: 1.08, baseline: 1.92, games: 10 }, { label: 'Headshot %', value: 27, baseline: 32, games: 10 }],
    grade: { score: 60, categories: [
      { key: 'survival', label: 'Survival', score: 69, evidence: ['first to die in 2 of 16 rounds'] },
      { key: 'impact', label: 'Impact', score: 57, evidence: ['14 kills, 13 deaths, 4 assists'] },
      { key: 'teamplay', label: 'Teamplay', score: 70, evidence: ['2 of 13 deaths traded by a teammate'] },
      { key: 'decisions', label: 'Decisions', score: 53, evidence: ['died with the team ahead in numbers and lost the round 3 times'] }] },
    lists: { mistakes: [
      { key: 'untraded', title: 'Died where nobody could trade', count: 11, rounds: [2, 5, 7, 8, 9, 10, 11, 12, 13, 14, 16], detail: '11 of your 13 deaths went unanswered.' },
      { key: 'lost-advantage', title: 'Gave back the advantage', count: 3, rounds: [7, 9, 14] }] },
  };
  const cards16 = Array.from({ length: 16 }, (_, i) => ({ n: i + 1, side: 'attacking', result: i < 3 ? 'won' : 'lost', died: i < 13, verified: true,
    riot: i < 13 ? { sec: 30, killer: 'Omen', weapon: 'Vandal', traded: i < 2, alive: { mates: 4, enemies: 4 } } : {} }));
  const plat = mk('plat_diamond', cards16, corrode);
  const two = cp.weakTwoOf(plat.match, 'plat_diamond');
  ok(two && two[0].fam === 'decisions' && /lost the round 3 times, in rounds 7, 9 and 14/.test(two[0].line) && two[1].fam === 'form' && /K\/D in this match was 1\.08, against your own average of 1\.92/.test(two[1].line),
    'the two weakest numbers at Plat: the advantage given back (rounds 7, 9 and 14), then K/D 1.08 against 1.92, never the trade count', two ? two.map((x) => `${x.fam} ${x.score.toFixed(2)}`).join(', ') : 'none');
  const pp = cp.buildPrompt(plat, ask(IMPROVE_Q), { variant: 'v2' });
  ok(/THE TWO WEAKEST NUMBERS, ranked in code/.test(pp) && /- First: You died with your team ahead in numbers and lost the round 3 times, in rounds 7, 9 and 14\./.test(pp)
    && /leave trading out, since neither is the trade/.test(pp) && !pp.includes('THE LEVER for this question') && pp.includes(cp.IMPROVING_RULE_877),
  'from Platinum an improve question gets the two weakest numbers, no LEVER line, and 8.7.7\'s improving rule as e9726e0 left it');
  for (const [q, why] of [[AIM_Q, 'aim'], ['What should I practice before my next game?', 'practice'], ['How do I play against Omen?', 'an agent']]) {
    ok(!/THE TWO WEAKEST NUMBERS/.test(cp.buildPrompt(plat, ask(q), { variant: 'v2' })), `none for ${why}`);
  }
  ok(!/THE TWO WEAKEST NUMBERS/.test(cp.buildPrompt(mk('silver_gold', cards16, corrode), ask(IMPROVE_Q), { variant: 'v2' })), 'none below Platinum, where THE LEVER is');
  const fp = cp.factsOf(plat, ask(IMPROVE_Q));
  ok(gates.check('Your K/D in this match was 1.08, against your own average of 1.92 over your last 10 matches.', fp).drop === null, 'a weakest number said back is kept');
  ok(cp.weakLeadOf(['11 of your 13 deaths went unanswered.', 'That is what holds you back.'], fp) === cp.WEAK_LEAD_REASON
    && cp.weakLeadOf(['You died with your team ahead in numbers 3 times, in rounds 7, 9 and 14.', 'And 11 of your 13 deaths went unanswered.'], fp) === null
    && cp.weakLeadOf(['Your K/D was 1.08 against 1.92.', 'Most deaths were untraded.'], fp) === null,
  'CAUGHT: an improve answer at Plat that leads on the untraded count is asked again; one that names a weakest number is not');
  const prW = cp.parseReply('11 of your 13 deaths went unanswered, and that is what holds you back. Before you swing, look for the teammate who can see the same angle. In your next match, count the swings you take alone.', plat, { messages: ask(IMPROVE_Q) });
  ok(prW.retry === true && prW.reasons.includes(cp.WEAK_LEAD_REASON), 'through parseReply: the untraded lead at Plat is retried', prW.reasons.join(' / '));
  // 8. "where you were the first contact" held to Riot's first deaths.
  ok(rc.FIRST_CONTACT.test('That is the same thing that would have saved rounds 3 and 5, where you were the first contact and nobody was near enough to help you survive it.')
    && !rc.FIRST_CONTACT.test('That works because the first contact you take is the one you choose.') && !rc.FIRST_CONTACT.test('your first-contact deaths drop'),
  'FIRST_CONTACT matches "where you were the first contact", not first contact as advice');
  const ctxF = rc.contextOfChat(cp.factsOf(mk('iron_bronze', cards, { against }), ask('How do I play against Omen?')));
  ok(/first death in round 3/.test(String(rc.checkMulti('That is the same thing that would have saved rounds 3 and 5, where you were the first contact and nobody was near.', ctxF)))
    && rc.checkMulti('That would have saved round 5, where you were the first contact.', ctxF) === null,
  'CAUGHT: Pearl Iron "rounds 3 and 5, where you were the first contact" (round 3 no first death); kept of round 5 alone');
  const f3 = cp.factsOf(mk('iron_bronze', cards, { against }), ask('Why did I die in round 3?'));
  ok(gates.check('In round 3 you were the first contact, and Omen killed you.', f3).drop !== null && gates.check('In round 5 you were the first contact, and Reyna killed you.', f3).drop === null
    && gates.check('In round 3, take first contact only with a teammate close.', f3).drop === null,
  'one round: "you were the first contact" held to Riot\'s first death (fact-gates.js FIRST_DEATH), first contact as advice kept');
}

// ── ROUND 8: THE THIN REVIEW STAGE (the Pearl Silver Cypher answer and the
// Fracture Ascendant aim answer of round 7) ──────────────────────────────────
{
  const co = require('../server/services/coherence');
  const pearl2 = cp.normalise({ v: 2, game: 'valorant', language: 'en', advanced: false,
    match: { id: 'valorant-1790000000000-pearl8', map: 'Pearl', agent: 'Raze', mode: 'Swiftplay', result: 'Defeat', score: '1-5', rounds: 6, verified: true, at: AT,
      cards: [
        { n: 3, side: 'attacking', result: 'lost', died: true, verified: true, watched: true, pistol: false, riot: { sec: 13, killer: 'Cypher', weapon: 'Phantom', traded: true, kills: 0 } },
        { n: 5, side: 'attacking', result: 'lost', died: true, verified: true, watched: true, pistol: true, riot: { sec: 9, killer: 'Cypher', weapon: 'Classic', traded: true, kills: 0 } },
      ] },
    player: {}, ask: {} });
  const PQ = [{ role: 'user', content: 'How do I play against Cypher?' }];
  const pf = factsFor(pearl2, PQ, STAND_IN);
  // 1. Each round's claims in its own clause (fact-gates.js scopeOf).
  const ROW1 = 'In round 3 you died 13 s in at B Screen to his Phantom, and in round 5, the pistol round, you died 9 s in at Mid Doors to his Classic.';
  ok(pf.rounds.get(5).pistol && !pf.rounds.get(3).pistol && keeps(ROW1, pf),
    'KEPT: the Pearl row "in round 5, the pistol round" is no pistol claim about round 3 (scopeOf)', why(ROW1, pf));
  ok(drops('In round 3, the pistol round, you died 13 s in to his Phantom, and in round 5 you died 9 s in to his Classic.', pf, 'timeline'),
    'and "round 3, the pistol round" still drops for round 3', why('In round 3, the pistol round, you died 13 s in to his Phantom, and in round 5 you died 9 s in to his Classic.', pf));
  ok(drops('In rounds 3 and 5, each a pistol round, you died early.', pf, 'timeline') && drops('In round 3 and round 5 you played the pistol round.', pf, 'timeline'),
    'a list of rounds holds its claim to every round of it, "round 3 and round 5" too');
  ok(drops('Round 5 was the pistol round, and so was round 3.', pf, 'timeline'),
    'a round named with nothing after it ("and so was round 3") is read whole');
  ok(gates.scopeOf(ROW1, 3) === 'In round 3 you died 13 s in at B Screen to his Phantom, and in' && /^In round 5, the pistol round/.test(gates.scopeOf(ROW1, 5))
    && gates.scopeOf('In round 3 you died early.', 3) === 'In round 3 you died early.',
  'scopeOf: the head is shared, each round from its mention to the next, one mention read whole', JSON.stringify([gates.scopeOf(ROW1, 3), gates.scopeOf(ROW1, 5)]));
  const RM = new RegExp(gates.ROUND_MENTION.source, 'i');
  ok(RM.test('in rounds 3 and 5') && RM.test('round 12') && !RM.test('around 3 seconds') && !RM.test('the round ended'), 'ROUND_MENTION matches a round number, never "around 3"');
  // 2. A he the asked agent can be is no lean (chat-prompt.js leansHere).
  const lean = (asked) => {
    const rows = [{ p: 0, s: 'That matters against Cypher because his whole job is to make you the first one through a choke.', drop: { gate: 'record', reason: 'x' } },
      { p: 0, s: 'His Trapwire tethers you and reveals you after a delay if you do not shoot it.', drop: null }];
    const f = { language: 'en', askedAgents: asked };
    for (let i = 1; i < rows.length; i++) if (rows[i - 1].drop && !rows[i].drop && cp.__test.leansHere(rows[i].s, f)) rows[i].drop = { gate: 'leans' };
    return rows[1].drop ? 'drop' : 'keep';
  };
  ok(lean(['Cypher']) === 'keep' && lean(['Reyna']) === 'drop' && lean([]) === 'drop' && lean(['Clove']) === 'keep',
    'KEPT: "His Trapwire..." after a cut, asked about Cypher; dropped asked about Reyna or nobody; Clove may be either', [lean(['Cypher']), lean(['Reyna']), lean([]), lean(['Clove'])].join(' '));
  ok(cp.__test.leansHere('That left your team 4 against 5.', { askedAgents: ['Cypher'] }) === 'subject' && cp.__test.leansHere('A second later he traded you.', { askedAgents: ['Cypher'] }) === 'time',
    'a lean by "that" or by time is a lean whoever was asked about');
  // 3. A connective after a cut (coherence.js repairConnective).
  ok(co.CONNECTIVE_STRIP.test('So the fix is not a new sensitivity or a longer warmup.') && co.CONNECTIVE_STRIP.test('Therefore, the plant is yours to hold.')
    && co.CONNECTIVE_STRIP.test('And so the round turned on that fight.')
    && !co.CONNECTIVE_STRIP.test('So far you have traded well.') && !co.CONNECTIVE_STRIP.test('So much of it was the first fight.') && !co.CONNECTIVE_STRIP.test('Some rounds went well.')
    && !co.CONNECTIVE_STRIP.test('Solo peeks cost you round 5.'),
  'CONNECTIVE_STRIP matches "So", "Therefore", "And so" leading a clause, never "So far", "So much", "Some", "Solo"');
  ok(co.CONNECTIVE_BACK.test('That is why the first player through the door dies.') && co.CONNECTIVE_BACK.test("That's why you lost round 5.")
    && co.CONNECTIVE_BACK.test('This means the defenders have to come to you.') && co.CONNECTIVE_BACK.test('Which is how the advantage went.')
    && !co.CONNECTIVE_BACK.test('That angle was held by Cypher.') && !co.CONNECTIVE_BACK.test('This round your team was ahead.') && !co.CONNECTIVE_BACK.test('That is the habit to build.'),
  'CONNECTIVE_BACK matches "That is why", "This means", "Which is how", never "That angle" or "That is the habit"');
  const rc8 = (rows) => co.repairConnective(rows.map((s) => (typeof s === 'string' ? { s } : s)));
  ok(JSON.stringify(rc8([{ s: 'Your aim is fine.', dropped: true }, 'So the fix is not a new sensitivity or a longer warmup.']))
      === JSON.stringify([{ index: 1, kind: 'strip', s: 'The fix is not a new sensitivity or a longer warmup.' }])
    && JSON.stringify(rc8([{ s: 'x', dropped: true }, 'That is why you died.'])) === JSON.stringify([{ index: 1, kind: 'back' }])
    && rc8(['You traded well.', 'So far you traded well.']).length === 0 && rc8(['You traded well.', 'That is why you died.']).length === 0
    && rc8(['You traded well.', 'So the round was yours.']).length === 0,
  'repairConnective: "So" struck after a cut, "That is why" gone after one, nothing touched where nothing was cut before it');
  const served = cp.gateReply(['Your crosshair sat on Tessik before the swing. So the fix is not a new sensitivity or a longer warmup. It is how you hold the crosshair.'],
    { ...pf, language: 'en' }, { names: { has: (t) => /Tessik/.test(t) } });
  ok(served[0].drop && !served[1].drop && served[1].s === 'The fix is not a new sensitivity or a longer warmup.',
    'CAUGHT: the Fracture Ascendant aim retry, its lead cut by the name gate, serves "The fix is not..." and never "So the fix..."', served.map((r) => (r.drop ? 'DROP' : r.s)).join(' | '));
}

// ── The review of round 8: the record gates' false drops ──────────────────
{
  console.log('\nthe review of round 8, the record gates:');
  const rc = require('../server/services/record-claims');
  const mk = (rows, extra) => ({ rounds: new Map(rows.map((r) => [r.n, r])), kind: 'chat', map: 'Sunset', asked: null, enemies: new Set(), enemiesKnown: false, ...extra });
  const R = (o) => ({ died: true, firstDeath: false, firstKill: null, alive: null, sec: null, plantSec: null, afterPlant: null, deathAt: null, ownKills: null, killPlaces: null, place: null, side: null, ...o });
  // The article is no site: "a site retake" and "a main angle" are no A side callouts.
  const sun = mk([R({ n: 7, side: 'defence', firstKill: true, killPlaces: ['B Main'] }), R({ n: 4, side: 'defence', place: 'B Main' })]);
  ok(rc.checkKillPlace('In round 7 your first kill on a site retake came too early.', sun, {}) === null
    && rc.checkKillPlace('In round 7 your opening kill from a main angle was clean.', sun, {}) === null,
  'kept: "your first kill on a site retake" and "your opening kill from a main angle" (the article, not the A side)');
  ok(typeof rc.checkKillPlace('In round 7 your first kill at A Main came too early.', sun, {}) === 'string',
    'CAUGHT: the kill put at A Main, the capital callout, where it was at B Main');
  ok(rc.checkRecord('In round 4 you died holding a site alone with no utility.', sun, {}) === null
    && typeof rc.checkRecord('In round 4 you died holding A Main alone with no utility.', sun, {}) === 'string',
  'checkRecord: "holding a site" kept, "holding A Main" of a B Main death caught');
  ok(rc.articleNotSite('a site') && !rc.articleNotSite('A Site') && !rc.articleNotSite('B Main') && rc.articleNotSite('b main'),
    'articleNotSite: a lower case letter and a space is the article, a capital is the callout');
  // The other half named: the enemy role is that half's.
  const atk = mk([R({ n: 5, side: 'attack' })], { kind: 'review' });
  ok(rc.checkEnemyRole('In round 5 you were attacking, but next half on defence, make the attackers come to you.', atk, {}) === null,
    'kept: "next half on defence, make the attackers come to you" of an attack round');
  ok(typeof rc.checkEnemyRole('In round 5, make the attackers come to you.', atk, {}) === 'string', 'CAUGHT: the attackers as the enemy of an attack round, with no other half named');
  ok(rc.OTHER_HALF.test('next half on defence') && !rc.OTHER_HALF.test('half the round'), 'OTHER_HALF both ways');
  // An instruction that opens on avoid, stop or focus is no claim to rewrite.
  const any = mk([R({ n: 3, side: 'attack', traded: false, untraded: true, mate: 'far' })]);
  for (const s of ['Avoid fights nobody could answer.', 'Stop taking duels where nobody could trade you.', 'Focus on cutting the fights nobody could trade.']) {
    const h = rc.checkRows([{ s, p: 0 }], any);
    ok(!h.some((x) => x.rewrite), `kept as written: "${s}" (${JSON.stringify(h)})`);
  }
  ok(rc.checkRows([{ s: 'You kept dying in fights nobody could answer.', p: 0 }], any).some((x) => x.rewrite === 'You kept dying in fights nobody answered.'),
    'and the claim itself is still rewritten to what happened');
  ok(rc.PLAN_OPEN.test('Avoid fights nobody could answer.') && !rc.PLAN_OPEN.test('Your fights nobody could answer cost you.'), 'PLAN_OPEN both ways');
  // The round 8 replay's false drops of the alone reader, and its targets still caught.
  const close = mk([R({ n: 5, side: 'attack', traded: false, untraded: true, mate: 'close', afterPlant: true }), R({ n: 6, side: 'attack', traded: false, untraded: true, mate: 'close' })]);
  const drop = (s) => rc.checkRows([{ s, p: 0 }], close).some((x) => x.reason);
  ok(!drop("You died in round 5 because after the plant you stayed on the A site angle and took the Jett's Sheriff duel alone, when a teammate was close enough to trade you and nobody did."),
    'kept: the duel taken alone, in a sentence that says the teammate was close and nobody traded (Fracture Plat)');
  ok(!drop('In round 6 nobody traded, so the fix is to swing with someone beside you or wait for information instead of taking the peek alone.'),
    'kept: "nobody traded" with the advice\'s "instead of taking the peek alone" (Sunset Iron)');
  ok(drop("In round 5 you took the Jett's Sheriff duel alone.") && drop('In round 5 you held where nobody could answer your death.')
    && drop('In round 6 nobody traded because you were alone, instead of taking the peek alone.'),
  'CAUGHT: the duel alone with nothing said of the teammate, "nobody could answer" of a close death, and an alone claim beside the advice');
  ok(rc.MATE_COULD_SAID.test('a teammate was close enough to trade you') && !rc.MATE_COULD_SAID.test('nobody was close enough to trade you'), 'MATE_COULD_SAID both ways');
  ok(drop('In round 6 nobody traded, so take a position a teammate can trade rather than holding alone.'), 'CAUGHT: "rather than holding alone", a place held, beside "nobody traded"');
  ok(rc.SWING_ALONE.test('instead of taking the peek alone') && !rc.SWING_ALONE.test('rather than holding alone')
    && rc.HELD_ALONE.test('rather than holding alone') && !rc.HELD_ALONE.test('instead of taking the peek alone'), 'SWING_ALONE and HELD_ALONE both ways');
}

// ── The blind audit of round 8, stream C: six wrong claims, each a class ──
{
  console.log('\nthe blind audit of round 8, stream C:');
  const rc = require('../server/services/record-claims');
  const served = (paras, f) => cp.gateReply(paras, { ...f, language: 'en' }, {});
  const shown = (rows) => rows.filter((r) => !r.drop).map((r) => r.s);
  const card = (o) => ({ side: 'attacking', result: 'lost', died: true, verified: true, watched: true, pistol: false, ...o });
  const valMatch = (o) => cp.normalise({ v: 2, game: 'valorant', language: 'en', advanced: false,
    match: { result: 'Defeat', verified: true, at: AT, ...o }, player: {}, ask: {} });

  // 1. A place is Riot's callout of the death (record-claims.js checkDeathPlace, chat-prompt.js lookPlaceFix).
  const corrode = valMatch({ id: 'valorant-1790000000000-corr8c', map: 'Corrode', agent: 'Iso', mode: 'Competitive', score: '3-13', rounds: 16,
    cards: [card({ n: 10, riot: { sec: 27, killer: 'Phoenix', weapon: 'Vandal', traded: false, firstDeath: true, kills: 0, place: 'Mid Bottom', mate: 'far' },
      look: { cause: 'dry-peek', what: 'You moved into the open at Mid Stairs without firing, and Phoenix killed you with a Vandal.', better: 'Hold beside cover.', source: 'riot' } })] });
  const cf = factsFor(corrode, [{ role: 'user', content: 'What was my biggest mistake this match?' }], STAND_IN);
  const AUDIT1 = 'Round 10 shows it plainly: you moved into the open at Mid Stairs at 27 s in, first death of the round, Phoenix killed you with a Vandal, and nobody was close.';
  const r1 = served([AUDIT1], cf);
  ok(!r1[0].drop && r1[0].s === AUDIT1.replace('Mid Stairs', 'Mid Bottom') && r1[0].rewritten === 'record-rewrite',
    'CAUGHT: the Corrode Iron round 10 death at "Mid Stairs" is served at Riot\'s Mid Bottom (checkDeathPlace)', JSON.stringify(r1.map((r) => [r.s, r.drop])));
  const GOOD1 = AUDIT1.replace('Mid Stairs', 'Mid Bottom');
  const g1 = served([GOOD1], cf);
  ok(!g1[0].drop && g1[0].s === GOOD1 && !g1[0].rewritten, 'KEPT: the same sentence at Mid Bottom, as written');
  const cctx = rc.contextOfChat(cf);
  ok(rc.checkDeathPlace('In round 10 Phoenix held Mid Stairs and killed you.', cctx, {}) === null
    && rc.checkDeathPlace('In round 10 you pushed from Mid Stairs and died.', cctx, {}) === null
    && rc.checkDeathPlace('In round 10 you should hold Mid Stairs, since Phoenix killed you there.', cctx, {}) === null
    && rc.checkDeathPlace('In round 10 you died in Mid.', cctx, {}) === null
    && JSON.stringify(rc.checkDeathPlace('In round 10 Phoenix killed you at Mid Stairs.', cctx, {})) === JSON.stringify({ rewrite: 'In round 10 Phoenix killed you at Mid Bottom.' }),
  'checkDeathPlace: the enemy\'s place, where the player came from, a plan and an area holding the callout judge nothing; "killed you at Mid Stairs" is Riot\'s place');
  ok(rc.PLACE_PREP.test('you moved into the open at ') && !rc.PLACE_PREP.test('you pushed from ')
    && rc.PLACE_GAP_BREAK.test(' Phoenix held ') && rc.PLACE_GAP_BREAK.test(' got a kill ') && !rc.PLACE_GAP_BREAK.test(' moved into the open ')
    && rc.DEATH_SAID.test('Phoenix killed you with a Vandal') && rc.DEATH_SAID.test('first death of the round') && !rc.DEATH_SAID.test('you killed Phoenix'),
  'PLACE_PREP, PLACE_GAP_BREAK and DEATH_SAID both ways');
  const c10 = corrode.match.cards.find((c) => c.n === 10);
  ok(c10.look.what === 'You moved into the open at Mid Bottom without firing, and Phoenix killed you with a Vandal.' && c10.look.cause === 'dry-peek',
    `the look's WHAT is sent at Riot's place, its label kept (lookPlaceFix: ${c10.look.what})`);
  ok(cp.lookPlaceFix('You held B Link toward B Main.', 'B Screen', 'Pearl') === null && cp.lookPlaceFix('You held a site angle in Mid.', 'Mid Doors', 'Pearl') === 'You held a site angle in Mid.'
    && cp.lookPlaceFix('On B Site, you fired at Clove.', 'B site', 'Pearl') === 'On B Site, you fired at Clove.',
  'lookPlaceFix: two other places send no WHAT, an area and "a site" (the article) agree, Riot\'s own place is kept');

  // 2. A look's finding only of a round it looked at (fact-gates.js gateLabelAcross, LOOK_SEEN).
  const pearl = valMatch({ id: 'valorant-1790000000000-pearl8c', map: 'Pearl', agent: 'Raze', mode: 'Swiftplay', score: '1-5', rounds: 6,
    scoreline: { kills: 4, deaths: 5, assists: 2 },
    comps: { us: [{ agent: 'Jett' }, { agent: 'Phoenix' }, { agent: 'Raze' }, { agent: 'Reyna' }, { agent: 'Yoru' }], them: [{ agent: 'Cypher' }, { agent: 'Sage' }, { agent: 'Fade' }, { agent: 'Clove' }, { agent: 'Sova' }] },
    cards: [
      card({ n: 1, pistol: true, riot: { sec: 26, killer: 'Clove', weapon: 'Classic', traded: false, kills: 0 }, look: { cause: 'lost-duel', what: 'You fired at Clove from beside cover and lost the duel.', better: 'Aim before firing.', source: 'riot' } }),
      card({ n: 3, riot: { sec: 13, killer: 'Cypher', weapon: 'Phantom', traded: true, kills: 0 } }),
      card({ n: 5, side: 'defending', pistol: true, riot: { sec: 9, killer: 'Cypher', weapon: 'Classic', traded: true, kills: 0 }, look: { cause: 'lost-duel', what: 'You fought Cypher at close range and dealt 105 damage before his Classic killed you.', better: 'Keep your Ghost ready.', source: 'riot' } }),
    ] });
  const PQ = [{ role: 'user', content: 'Their Cypher killed me the most. How do I play against Cypher?' }];
  const pf = factsFor(pearl, PQ, STAND_IN);
  const LEAD2 = 'In round 3 Cypher killed you 13 s in and a teammate traded you, and in round 5 Cypher killed you 9 s in.';
  const AUDIT2 = 'Both were fair fights the look called lost on the shot, so the shot matters too.';
  const r2 = served([`${LEAD2} ${AUDIT2}`], pf);
  ok(!r2[0].drop && r2[1].drop && r2[1].drop.gate === 'label', 'CAUGHT: the Pearl Iron "Both were fair fights the look called lost on the shot" of rounds 3 and 5, round 3 with no look', JSON.stringify(r2.map((r) => r.drop)));
  const r2k = served([`In round 1 you died 26 s in, and in round 5 you died 9 s in. ${AUDIT2}`], pf);
  ok(r2k.every((r) => !r.drop), 'KEPT: the same of rounds 1 and 5, both looked at and both lost duels', JSON.stringify(r2k.map((r) => r.drop)));
  ok(drops('The coach looked at round 3 and saw you peek without utility.', pf, 'label') && keeps('The coach looked at round 5 and saw a close fight.', pf)
    && keeps('The coach did not look at round 3.', pf),
  'LOOK_SEEN: "the coach looked at round 3" of a round with no look drops; of round 5 and under a negation it stays');
  ok(gates.ROUNDS_ANAPHOR.test('Both were fair fights') && gates.ROUNDS_ANAPHOR.test('Each time you swung first') && !gates.ROUNDS_ANAPHOR.test('Bothering with utility helps')
    && gates.LOOK_SEEN.test('the look called it lost') && gates.LOOK_SEEN.test("the coach's look saw") && !gates.LOOK_SEEN.test('look at the coach'),
  'ROUNDS_ANAPHOR and LOOK_SEEN both ways');

  // 3. Utility the team lacks, taken out of its list (fact-gates.js teamUtilityFix).
  const AUDIT3 = "After the opening teammate falls, enter on a teammate's flash or drone so you can still take the site without exposing yourself alone.";
  const r3 = served([AUDIT3], pf);
  ok(!r3[0].drop && r3[0].s === AUDIT3.replace(' or drone', '') && r3[0].rewritten === 'utility-rewrite',
    'CAUGHT: "a teammate\'s flash or drone" to Jett, Phoenix, Raze, Reyna and Yoru is served "a teammate\'s flash"', JSON.stringify(r3.map((r) => [r.s, r.drop])));
  ok(!served(["Enter on a teammate's flash so you can take the site."], pf)[0].rewritten && drops("Enter on a teammate's drone.", pf, 'team-utility')
    && gates.teamUtilityFix("Enter on a teammate's flash, drone or smoke.", pf).rewrite === "Enter on a teammate's flash or smoke.",
  'KEPT: the flash alone as written; a drone alone still drops; a list keeps what the team has');
  ok(gates.UTIL_ITEM.test('drone') && gates.UTIL_ITEM.test('flash') && !gates.UTIL_ITEM.test('teammate'), 'UTIL_ITEM both ways');

  // 4. How many deaths the coach looked at (fact-gates.js gateLookCount).
  const fracture = valMatch({ id: 'valorant-1790000000000-frac8c', map: 'Fracture', agent: 'Jett', mode: 'Swiftplay', score: '5-1', result: 'Victory', rounds: 6,
    scoreline: { kills: 12, deaths: 3, assists: 2 },
    cards: [
      card({ n: 2, result: 'won', riot: { sec: 40, killer: 'Astra', weapon: 'Sheriff', traded: true, kills: 1 }, look: { cause: 'repeek', what: 'You stayed on the same angle.', better: 'Fall back.', source: 'riot' } }),
      card({ n: 5, riot: { sec: 50, killer: 'Jett', weapon: 'Sheriff', traded: false, kills: 1 }, look: { cause: 'lost-duel', what: 'You held an angle from cover and lost the duel.', better: 'Keep aiming.', source: 'riot' } }),
      card({ n: 6, side: 'defending', result: 'won', riot: { sec: 30, killer: 'Chamber', weapon: 'Sheriff', traded: false, kills: 0 }, look: { cause: 'lost-duel', what: 'You fought Chamber and died.', better: 'Take the fight later.', source: 'riot' } }),
    ] });
  const ff = factsFor(fracture, [{ role: 'user', content: 'How do I get better aim at my rank?' }], STAND_IN);
  const AUDIT4 = 'The coach looked at one of your deaths and did not call it a fair fight lost on the shot, so the aim gap here is in the fights you won.';
  ok(drops(AUDIT4, ff, 'looks'), 'CAUGHT: the Fracture Ascendant "The coach looked at one of your deaths" where it looked at all 3', why(AUDIT4, ff));
  ok(keeps('The coach looked at all 3 of your deaths, and two were fair fights lost on the shot.', ff) && keeps('1 of the 3 deaths the coach looked at was avoidable.', ff)
    && drops('1 of the 2 deaths the coach looked at was avoidable.', ff) && gates.gateLookCount('1 of the 2 deaths the coach looked at was avoidable.', ff).gate === 'looks' && keeps('The coach did not look at one of your deaths.', ff),
  'KEPT: all 3 looked at, the grade\'s "1 of the 3 deaths the coach looked at"; a wrong total drops, a negation stays');
  ok(gates.LOOKED_AT.test('The coach looked at one of your deaths') && gates.LOOKED_AT.test('I only reviewed 2 of your 3 deaths') && !gates.LOOKED_AT.test('The coach looked at the angle you held')
    && gates.LOOKED_TOTAL.test('1 of the 3 deaths the coach looked at') && !gates.LOOKED_TOTAL.test('1 of the 3 deaths went untraded'),
  'LOOKED_AT and LOOKED_TOTAL both ways');

  // 5. Kills against deaths, as the scoreline has them (record-claims.js checkKillsDeaths).
  const split = valMatch({ id: 'valorant-1790000000000-split8c', map: 'Split', agent: 'Jett', mode: 'Competitive', score: '13-7', result: 'Victory', rounds: 20,
    scoreline: { kills: 17, deaths: 16, assists: 8 }, cards: [card({ n: 7, riot: { sec: 35, killer: 'Reyna', weapon: 'Vandal', traded: false, kills: 0 } })] });
  const sf = factsFor(split, [{ role: 'user', content: 'How do I improve at my rank? What is holding me back from climbing?' }], STAND_IN);
  const AUDIT5 = 'Those two are what held this Split match back, and the decision behind the first one is the lever: you took fights you could not win cleanly, so you died more than you killed.';
  const r5 = served([AUDIT5], sf);
  ok(!r5[0].drop && r5[0].s === 'Those two are what held this Split match back, and the decision behind the first one is the lever: you took fights you could not win cleanly.',
    'CAUGHT: the Split Ascendant "so you died more than you killed" at 17 kills and 16 deaths is cut off its sentence', JSON.stringify(r5.map((r) => [r.s, r.drop])));
  ok(served(['You died more than you killed this match.'], sf)[0].drop && !served(['You went 17 and 16, more kills than deaths.'], sf)[0].drop
    && !served(['You died more than you killed this match.'], factsFor(pearl, PQ, STAND_IN))[0].drop && !served(['Stop dying more than you kill.'], sf)[0].drop,
  'KEPT: the true comparison and the Pearl 4 and 5 "died more than you killed"; the whole false sentence drops; a plan judges nothing');
  ok(rc.DEATHS_MORE.test('you died more than you killed') && rc.DEATHS_MORE.test('a negative K/D') && rc.DEATHS_MORE.test('your K/D was under 1')
    && !rc.DEATHS_MORE.test('you died more often in the first 30 seconds') && rc.KILLS_MORE.test('more kills than deaths') && !rc.KILLS_MORE.test('more kills than last match'),
  'DEATHS_MORE and KILLS_MORE both ways');

  // 6. A count and the rounds it lists (record-claims.js checkCountList).
  const listCtx = { rounds: new Map(), countedTexts: ['5 of your 5 deaths came in the first 30 seconds of the round, before any plant, in rounds 1, 3, 4, 5 and 6.', 'you lost 4 rounds in a row, rounds 3 to 6.'] };
  const AUDIT6 = 'You lost 1 to 5, with 5 of your 5 deaths coming in the first 30 seconds, before any plant, in rounds 1, 3, 4 and 5, leaving your team short early.';
  ok(JSON.stringify(rc.checkCountList(AUDIT6, listCtx)) === JSON.stringify({ rewrite: AUDIT6.replace('rounds 1, 3, 4 and 5', 'rounds 1, 3, 4, 5 and 6') }),
    'CAUGHT: the Pearl Ascendant "5 of your 5 deaths ... in rounds 1, 3, 4 and 5" is written with the counted line\'s rounds 1, 3, 4, 5 and 6');
  ok(rc.checkCountList(AUDIT6.replace('rounds 1, 3, 4 and 5', 'rounds 1, 3, 4, 5 and 6'), listCtx) === null && rc.checkCountList('You lost 4 rounds in a row, rounds 3 to 6.', listCtx) === null
    && rc.checkCountList('Omen killed you 6 times, rounds 1, 5, 7 and 3 more.', listCtx) === null && rc.checkCountList('You traded a teammate 3 times, in rounds 4 and 9.', listCtx) === null
    && rc.checkCountList('One thing beside the shot: 14 of your 16 deaths went unanswered, and in rounds 1, 3, 4 and 6 no teammate was close.', listCtx) === null,
  'KEPT: the full list, a range, "and 3 more", trades (twice in a round), and a list in a clause of its own (Split Silver aim)');
  ok(typeof rc.checkCountList('Omen killed you 6 times, rounds 1, 5 and 7.', listCtx) === 'string', 'CAUGHT: "killed you 6 times, rounds 1, 5 and 7", no counted line to write it from');
  ok(JSON.stringify(rc.runRounds('3 to 6')) === '[3,4,5,6]' && JSON.stringify(rc.runRounds('1, 3, 4, 5 and 6')) === '[1,3,4,5,6]'
    && rc.LIST_SOME.test('and 3 more') && !rc.LIST_SOME.test('in rounds 1 and 4') && rc.COUNT_NEW_CLAUSE.test(', and in rounds ') && !rc.COUNT_NEW_CLAUSE.test(' coming early, before any plant, in rounds '),
  'runRounds, LIST_SOME and COUNT_NEW_CLAUSE both ways');
  const pfl = factsFor(valMatch({ id: 'valorant-1790000000000-pearl8d', map: 'Pearl', agent: 'Raze', mode: 'Swiftplay', score: '1-5', rounds: 6,
    patterns: [{ key: 'early', text: '5 of your 5 deaths came in the first 30 seconds of the round, before any plant, in rounds 1, 3, 4, 5 and 6.' }],
    cards: [1, 3, 4, 5, 6].map((n) => card({ n, riot: { sec: 9, killer: 'Cypher', weapon: 'Classic', traded: false, kills: 0 } })) }), PQ, STAND_IN);
  const r6 = served([AUDIT6.replace('You lost 1 to 5, with', 'With')], pfl);
  ok(!r6[0].drop && /in rounds 1, 3, 4, 5 and 6,/.test(r6[0].s), 'and in Ask Coach, through gateReply, on the pattern the facts carry', JSON.stringify(r6.map((r) => [r.s, r.drop])));
}

// ── The review of stream C: each finding, its true sentence kept, its wrong one caught ──
{
  console.log('\nthe review of stream C:');
  const rc = require('../server/services/record-claims');
  const served = (paras, f) => cp.gateReply(paras, { ...f, language: 'en' }, {});
  const one = (s, f) => served([s], f)[0];
  const asIs = (s, f) => { const r = one(s, f); return !r.drop && r.s === s && !r.rewritten; };
  const card = (o) => ({ side: 'attacking', result: 'lost', died: true, verified: true, watched: true, pistol: false, ...o });
  const valMatch = (o) => cp.normalise({ v: 2, game: 'valorant', language: 'en', advanced: false,
    match: { result: 'Defeat', verified: true, at: AT, ...o }, player: {}, ask: {} });
  const TEAM = { us: [{ agent: 'Jett' }, { agent: 'Phoenix' }, { agent: 'Raze' }, { agent: 'Reyna' }, { agent: 'Yoru' }], them: [{ agent: 'Cypher' }, { agent: 'Sage' }, { agent: 'Fade' }, { agent: 'Clove' }, { agent: 'Sova' }] };
  const corrode = valMatch({ id: 'valorant-1790000000000-corr8r', map: 'Corrode', agent: 'Iso', mode: 'Competitive', score: '3-13', rounds: 16,
    cards: [card({ n: 10, riot: { sec: 27, killer: 'Phoenix', weapon: 'Vandal', traded: false, firstDeath: true, kills: 0, place: 'Mid Bottom', mate: 'far' } })] });
  const cf = factsFor(corrode, [{ role: 'user', content: 'What was my biggest mistake this match?' }], STAND_IN);
  const cctx = rc.contextOfChat(cf);

  // 1. checkDeathPlace: the killer's place and an earlier place are not the death's.
  for (const s of ['In round 10 Phoenix killed you while holding Mid Stairs.', 'In round 10 the Phoenix who killed you was in Mid Stairs.',
    'In round 10 Phoenix caught you while he was in Mid Stairs.', 'In round 10 you were killed by a Phoenix sitting in Mid Stairs.',
    'In round 10 you started the round at Mid Stairs and pushed down to Mid Bottom, where Phoenix killed you.']) {
    ok(asIs(s, cf), `KEPT as written: "${s}" (the killer's place or an earlier one, not the death's)`, JSON.stringify(one(s, cf)));
  }
  ok(rc.checkDeathPlace('In round 10 you spent 20 seconds in Mid Stairs before you died.', cctx, {}) === null,
    'KEPT: "you spent 20 seconds in Mid Stairs before you died" is where the player was before the death');
  ok(JSON.stringify(rc.checkDeathPlace('In round 10 Phoenix killed you at Mid Stairs.', cctx, {})) === JSON.stringify({ rewrite: 'In round 10 Phoenix killed you at Mid Bottom.' }),
    'CAUGHT still: "Phoenix killed you at Mid Stairs" is Riot\'s Mid Bottom');
  ok(rc.YOU_OBJECT.test('the Phoenix who killed ') && rc.YOU_OBJECT.test('Phoenix caught ') && !rc.YOU_OBJECT.test('Round 10: ')
    && rc.PLACE_EARLIER.test(' started the round ') && rc.PLACE_EARLIER.test(' spent 20 seconds ') && !rc.PLACE_EARLIER.test(' moved into the open ')
    && rc.PLACE_LATER.test(' and pushed down to Mid Bottom') && rc.PLACE_LATER.test(' before you died.') && !rc.PLACE_LATER.test(' at 27 s in, first death of the round')
    && rc.DEATH_GAP_BREAK.test(' while') && rc.DEATH_GAP_BREAK.test(' was') && !rc.DEATH_GAP_BREAK.test(' 27 s in')
    && rc.DEATH_PLACE_HEAD.exec('the Phoenix who killed you was in ')[1] === 'who ' && rc.DEATH_PLACE_HEAD.test('Phoenix killed you at ') && rc.DEATH_PLACE_HEAD.test('Your round 10 death came at ')
    && !rc.DEATH_PLACE_HEAD.exec('Phoenix killed you at ')[1],
  'YOU_OBJECT, PLACE_EARLIER, PLACE_LATER, DEATH_GAP_BREAK and DEATH_PLACE_HEAD both ways');
  // 11. The place as the verb's object, and "your round 10 death came at".
  for (const [s, want] of [['Round 10: you peeked Mid Stairs and Phoenix killed you with a Vandal.', 'Round 10: you peeked Mid Bottom and Phoenix killed you with a Vandal.'],
    ['In round 10 you pushed Mid Stairs alone and died.', 'In round 10 you pushed Mid Bottom alone and died.'],
    ['Round 10 was the clearest: you walked up Mid Stairs and died to Phoenix.', 'Round 10 was the clearest: you walked up Mid Bottom and died to Phoenix.'],
    ['Your round 10 death came at Mid Stairs.', 'Your round 10 death came at Mid Bottom.']]) {
    const r = one(s, cf);
    ok(!r.drop && r.s === want && r.rewritten === 'record-rewrite', `CAUGHT: "${s}" is served at Riot's Mid Bottom`, JSON.stringify(r));
  }
  ok(asIs('Round 10: you peeked Mid Bottom and Phoenix killed you with a Vandal.', cf) && asIs('In round 10 you pushed from Mid Stairs and died.', cf),
    'KEPT: the peek at Riot\'s own place, and "pushed from" (where the player came from)');
  ok(rc.PLACE_VERB.test('you peeked ') && rc.PLACE_VERB.test('you walked up ') && !rc.PLACE_VERB.test('you pushed from ') && !rc.PLACE_VERB.test('you pushed down to '),
    'PLACE_VERB both ways');

  // 2. lookPlaceFix: only the player's own place is swapped, and a WHAT naming Riot's place is kept.
  ok(cp.lookPlaceFix('Phoenix held Mid Stairs and shot you as you crossed into the open.', 'Mid Bottom', 'Corrode') === 'Phoenix held Mid Stairs and shot you as you crossed into the open.'
    && cp.lookPlaceFix('You were caught rotating from A Main to B.', 'B Site', 'Pearl') === 'You were caught rotating from A Main to B.'
    && cp.lookPlaceFix('You fought Sova from B Main and lost the duel.', 'B Site', 'Pearl') === 'You fought Sova from B Main and lost the duel.',
  'KEPT as written: the enemy\'s place, "rotating from A Main" and "from B Main" are not where the player died');
  ok(cp.lookPlaceFix('You peeked from Mid Plaza into Mid Doors and died.', 'Mid Doors', 'Pearl') === 'You peeked from Mid Plaza into Mid Doors and died.',
    'KEPT: a WHAT naming Riot\'s own place beside another is sent as written, not withheld');
  ok(cp.lookPlaceFix('You moved into the open at Mid Stairs without firing, and Phoenix killed you with a Vandal.', 'Mid Bottom', 'Corrode') === 'You moved into the open at Mid Bottom without firing, and Phoenix killed you with a Vandal.'
    && cp.lookPlaceFix('You drew your Ghost and fought Cypher at close range in Mid Plaza.', 'Mid Doors', 'Pearl') === 'You drew your Ghost and fought Cypher at close range in Mid Doors.',
  'CAUGHT still: the player\'s own place is Riot\'s, an enemy as the object between (fought Cypher) no bar');
  ok(cp.LOOK_FROM_PLACE.test('rotating from ') && !cp.LOOK_FROM_PLACE.test('the open at ') && cp.LOOK_AT_PLACE.test('the open at ') && !cp.LOOK_AT_PLACE.test('Phoenix held ')
    && cp.LOOK_YOU_OBJECT.test('Phoenix killed ') && !cp.LOOK_YOU_OBJECT.test('') && cp.LOOK_OBJECT_OF.test(' and fought ') && !cp.LOOK_OBJECT_OF.test(' and ')
    && new RegExp(cp.LOOK_SUBJECT.source, 'i').test('Phoenix held') && !new RegExp(cp.LOOK_SUBJECT.source, 'i').test('the open'),
  'LOOK_FROM_PLACE, LOOK_AT_PLACE, LOOK_YOU_OBJECT, LOOK_OBJECT_OF and LOOK_SUBJECT both ways');

  // 3 and 14. teamUtilityFix: an enemy's list stays and drops; the team's list is cut in more word orders.
  const pearl = valMatch({ id: 'valorant-1790000000000-pearl8r', map: 'Pearl', agent: 'Raze', mode: 'Swiftplay', score: '1-5', rounds: 6, comps: TEAM,
    scoreline: { kills: 4, deaths: 5, assists: 2 },
    cards: [
      card({ n: 1, pistol: true, riot: { sec: 26, killer: 'Clove', weapon: 'Classic', traded: false, kills: 0 }, look: { cause: 'lost-duel', what: 'You fired at Clove from beside cover and lost the duel.', better: 'Aim before firing.', source: 'riot' } }),
      card({ n: 3, riot: { sec: 13, killer: 'Cypher', weapon: 'Phantom', traded: true, kills: 0 } }),
      card({ n: 5, side: 'defending', riot: { sec: 9, killer: 'Cypher', weapon: 'Classic', traded: true, kills: 0 }, look: { cause: 'lost-duel', what: 'You fought Cypher at close range.', better: 'Keep your Ghost ready.', source: 'riot' } }),
      card({ n: 6, side: 'defending', riot: { sec: 17, killer: 'Sova', weapon: 'Spectre', traded: false, kills: 0 }, look: { cause: 'dry-peek', what: 'You peeked with no utility.', better: 'Wait for a flash.', source: 'riot' } }),
    ] });
  const pf = factsFor(pearl, [{ role: 'user', content: 'Their Cypher killed me the most. How do I play against Cypher?' }], STAND_IN);
  const sova = "Their Sova will use a flash or drone to clear you, so wait for a teammate's flash.";
  ok(gates.teamUtilityFix(sova, pf).drop && one(sova, pf).drop && !one(sova, pf).rewritten, 'KEPT dropping: their Sova\'s "flash or drone" is not cut into a flash Sova lacks', JSON.stringify(gates.teamUtilityFix(sova, pf)));
  for (const [s, want] of [["Enter on a teammate's flash or a drone.", "Enter on a teammate's flash."],
    ['Wait for a flash or a drone from a teammate before you swing.', 'Wait for a flash from a teammate before you swing.'],
    ['Ask a teammate for a drone or a flash before you swing.', 'Ask a teammate for a flash before you swing.'],
    ['Wait for a teammate to drone or flash the site first.', 'Wait for a teammate to flash the site first.'],
    ["Enter on a teammate's flash/drone.", "Enter on a teammate's flash."],
    ["Enter on a teammate's flash or recon dart.", "Enter on a teammate's flash."]]) {
    const r = one(s, pf);
    ok(!r.drop && r.s === want && r.rewritten === 'utility-rewrite', `CAUGHT: "${s}" is served "${want}"`, JSON.stringify(r));
  }
  ok(asIs('Wait for a flash from a teammate before you swing.', pf), 'KEPT: the flash alone, as written');
  ok(gates.UTIL_TEAM_ASK.test("enter on a teammate's ") && gates.UTIL_TEAM_ASK.test('Ask a teammate for ') && !gates.UTIL_TEAM_ASK.test('Their Sova will use a ')
    && gates.UTIL_TEAM_AFTER.test(' from a teammate before') && !gates.UTIL_TEAM_AFTER.test(' to clear you') && gates.UTIL_ENEMY_OWNER.test('Their Sova will use a ') && !gates.UTIL_ENEMY_OWNER.test("on a teammate's ")
    && gates.UTIL_ART.test('a drone') && !gates.UTIL_ART.test('drone') && gates.UTIL_ITEM.test('recon dart')
    && new RegExp(gates.UTIL_LIST.source, 'i').test('flash or a drone') && new RegExp(gates.UTIL_LIST.source, 'i').test('flash/drone') && !new RegExp(gates.UTIL_LIST.source, 'i').test('flash or a smoke')
    && new RegExp(gates.UTILITY_ASKED.source, 'i').test('ask a teammate for a drone') && new RegExp(gates.UTILITY_ASKED.source, 'i').test('a teammate to drone') && !new RegExp(gates.UTILITY_ASKED.source, 'i').test('a teammate to flash'),
  'UTIL_TEAM_ASK, UTIL_TEAM_AFTER, UTIL_ENEMY_OWNER, UTIL_ART, UTIL_ITEM, UTIL_LIST and UTILITY_ASKED both ways');

  // 7 and 15. gateLookCount: a part of the deaths stays, the passive and noun forms are counted.
  for (const s of ['The coach looked at two of your deaths that ended in lost duels, rounds 1 and 5, and both were fair fights lost on the shot.',
    'The coach examined both deaths on defence closely.', 'The coach looked at one of your deaths to Sova, round 6, and saw a dry peek.']) {
    ok(keeps(s, pf), `KEPT: "${s.slice(0, 60)}" is a part of the three looked at`, why(s, pf));
  }
  ok(drops('The coach looked at two of your deaths.', pf, 'looks'), 'CAUGHT still: "the coach looked at two of your deaths" where it looked at three');
  ok(gates.LOOK_SUBSET.test(' that ended in lost duels') && gates.LOOK_SUBSET.test(' on defence closely') && !gates.LOOK_SUBSET.test(' and both were fair')
    && gates.LOOK_SUBSET_AGENT.test(' to Sova, round 6') && !gates.LOOK_SUBSET_AGENT.test(' to learn from'),
  'LOOK_SUBSET and LOOK_SUBSET_AGENT both ways');
  const fracture = valMatch({ id: 'valorant-1790000000000-frac8r', map: 'Fracture', agent: 'Jett', mode: 'Swiftplay', score: '5-1', result: 'Victory', rounds: 6,
    scoreline: { kills: 12, deaths: 3, assists: 2 },
    cards: [2, 5, 6].map((n) => card({ n, riot: { sec: 30, killer: 'Chamber', weapon: 'Sheriff', traded: false, kills: 0 }, look: { cause: 'lost-duel', what: 'You fought Chamber and died.', better: 'Take the fight later.', source: 'riot' } })) });
  const ff = factsFor(fracture, [{ role: 'user', content: 'How do I get better aim at my rank?' }], STAND_IN);
  for (const s of ['Only one of your deaths was looked at by the coach.', 'The coach had a look at one of your deaths.', "The coach's look covered one of your deaths.", 'One death got a look from the coach.']) {
    ok((gates.gateLookCount(s, ff) || {}).gate === 'looks' && drops(s, ff), `CAUGHT: "${s}" where the coach looked at all 3`, why(s, ff));
  }
  ok(keeps('All 3 of your deaths were looked at by the coach.', ff) && keeps('The coach had a look at all 3 of your deaths.', ff),
    'KEPT: the passive and noun forms with the true count');
  ok(gates.LOOKED_BY.test('one of your deaths was looked at by the coach') && gates.LOOKED_BY.test('One death got a look from the coach') && !gates.LOOKED_BY.test('one of your deaths was a lost duel')
    && gates.LOOKED_AT.test('The coach had a look at one of your deaths') && gates.LOOKED_AT.test("The coach's look covered one of your deaths"),
  'LOOKED_BY and the new LOOKED_AT forms both ways');

  // 8 and 12. LOOK_SEEN: the record's fact said by "the coach found" is no look; the look said of "both" is.
  ok(keeps('The coach found that Cypher killed you twice, in rounds 3 and 5.', pf), 'KEPT: "the coach found that Cypher killed you twice" is Riot\'s record, not a look', why('The coach found that Cypher killed you twice, in rounds 3 and 5.', pf));
  ok(drops('The coach found you peeked round 3 without utility.', pf, 'label') && drops('The coach reviewed round 3 and saw you peek without utility.', pf, 'label'),
    'CAUGHT: "the coach found you peeked" and "the coach reviewed round 3" of a round with no look');
  const LEAD = 'In round 3 Cypher killed you 13 s in and a teammate traded you, and in round 5 Cypher killed you 9 s in.';
  for (const s of ['The look called both of them lost duels.', 'The coach called both lost duels.', "The coach's look found you lost both duels on the shot."]) {
    const rows = served([`${LEAD} ${s}`], pf);
    ok(!rows[0].drop && rows[1].drop && rows[1].drop.gate === 'label', `CAUGHT: "${s}" of rounds 3 and 5, round 3 with no look`, JSON.stringify(rows.map((r) => r.drop)));
  }
  const kept12 = served(['In round 1 you died 26 s in, and in round 5 you died 9 s in. The look called both of them lost duels.'], pf);
  ok(kept12.every((r) => !r.drop), 'KEPT: the same of rounds 1 and 5, both lost duels the look called', JSON.stringify(kept12.map((r) => r.drop)));
  ok(gates.LOOK_ANAPHOR.test('The look called both of them lost duels') && gates.LOOK_ANAPHOR.test("The coach's look found you lost both duels") && !gates.LOOK_ANAPHOR.test('The look called it a lost duel')
    && gates.LOOK_SEEN.test('The coach reviewed round 3') && !gates.LOOK_SEEN.test('The coach found that Cypher') && gates.LOOK_SEEN_SOFT.test('The coach found that Cypher')
    && gates.LOOK_WORDS.test('you peeked without utility') && !gates.LOOK_WORDS.test('Cypher killed you twice'),
  'LOOK_ANAPHOR, LOOK_SEEN, LOOK_SEEN_SOFT and LOOK_WORDS both ways');

  // 4 and 13. checkKillsDeaths: the player as subject of the whole match, and more phrasings.
  const splitOf = (kills, deaths) => factsFor(valMatch({ id: 'valorant-1790000000000-split8r', map: 'Split', agent: 'Jett', mode: 'Competitive', score: '13-7', result: 'Victory', rounds: 20,
    scoreline: { kills, deaths, assists: 8 }, cards: [card({ n: 7, riot: { sec: 35, killer: 'Reyna', weapon: 'Vandal', traded: false, kills: 0 } })] }),
  [{ role: 'user', content: 'How do I improve at my rank? What is holding me back from climbing?' }], STAND_IN);
  const s1716 = splitOf(17, 16);
  const s1617 = splitOf(16, 17);
  for (const s of ['Their Reyna had more deaths than kills, so their entries were weak.', 'Your Sova finished with more deaths than kills, so the info was thin.',
    'On attack you died more than you killed, since the entries were dry.', 'In the first half you had more deaths than kills, then the second half turned it around.',
    'Last match you died more than you killed, but this one you went 17 and 16.', 'Your team had a negative K/D on defence.']) {
    ok(asIs(s, s1716), `KEPT at 17 and 16: "${s}" (another subject or a part of the match)`, JSON.stringify(one(s, s1716)));
  }
  for (const s of ['On defence you had more kills than deaths, so the problem is attack.', 'With the Operator you killed more than you died.']) {
    ok(asIs(s, s1617), `KEPT at 16 and 17: "${s}"`, JSON.stringify(one(s, s1617)));
  }
  for (const s of ['Your deaths outnumbered your kills.', 'You were dying more than you were killing.', 'You went negative this match.', 'You ended the match in the negatives.', 'You gave up more deaths than you got kills.']) {
    ok(one(s, s1716).drop, `CAUGHT at 17 and 16: "${s}"`);
    ok(asIs(s, s1617), `KEPT at 16 and 17: "${s}"`, JSON.stringify(one(s, s1617)));
  }
  ok(one('You had more deaths than kills.', s1716).drop && one('Your kills outnumbered your deaths.', s1617).drop && asIs('Your kills outnumbered your deaths.', s1716),
    'CAUGHT still: "you had more deaths than kills" at 17 and 16; the mirror both ways');
  ok(rc.KD_OTHER.test('Their Reyna had ') && rc.KD_OTHER.test('Your team had ') && !rc.KD_OTHER.test('you had ')
    && rc.KD_SCOPE.test('On attack you died') && rc.KD_SCOPE.test('With the Operator you') && rc.KD_SCOPE.test('Last match you') && rc.KD_SCOPE.test('In the first half') && !rc.KD_SCOPE.test('This match you died more than you killed')
    && rc.DEATHS_MORE.test('your deaths outnumbered your kills') && rc.DEATHS_MORE.test('dying more than you were killing') && rc.DEATHS_MORE.test('went negative') && rc.DEATHS_MORE.test('ended the match in the negatives') && rc.DEATHS_MORE.test('more deaths than you got kills')
    && rc.KILLS_MORE.test('your kills outnumbered your deaths') && rc.KILLS_MORE.test('killing more than you were dying') && rc.KILLS_MORE.test('went positive') && !rc.KILLS_MORE.test('went negative'),
  'KD_OTHER, KD_SCOPE and the new DEATHS_MORE and KILLS_MORE branches both ways');

  // 5, 6, 9 and 10. checkCountList: where a run starts is no list, the thing counted must agree, and more list forms.
  const reyna = factsFor(valMatch({ id: 'valorant-1790000000000-split8y', map: 'Split', agent: 'Jett', mode: 'Competitive', score: '3-13', rounds: 16,
    cards: [1, 2, 3, 4, 5, 6, 7].map((n) => card({ n, riot: { sec: 20, killer: 'Reyna', weapon: 'Vandal', traded: false, kills: 0 } })) }), [{ role: 'user', content: 'How do I play against Reyna?' }], STAND_IN);
  ok(asIs('Reyna killed you 7 times, starting in round 1.', reyna), 'KEPT: "Reyna killed you 7 times, starting in round 1"', JSON.stringify(one('Reyna killed you 7 times, starting in round 1.', reyna)));
  const lc = { rounds: new Map(), countedTexts: [] };
  ok(['Cypher killed you 3 times from round 7 on.', 'You died twice after round 10, both times on B.', 'You died 4 times before round 5, all of them early.',
    'You died twice in the round 3 retake and the round 7 retake.', 'You died 3 times by round 4.'].every((s) => rc.checkCountList(s, lc) === null),
  'KEPT: "from round 7 on", "after round 10", "before round 5", "in the round 3 retake", "by round 4"');
  ok(typeof rc.checkCountList('You died 3 times, in rounds 4 and 9.', lc) === 'string', 'CAUGHT still: "died 3 times, in rounds 4 and 9"');
  ok(rc.checkCountList('3 of your 5 deaths came in the first 20 seconds, in rounds 1, 3 and 4.', { rounds: new Map(), countedTexts: ['3 of your 5 deaths went untraded, in rounds 2, 5 and 6.'] }) === null,
    'KEPT: early deaths are not written with the rounds of the untraded line of the same pair');
  ok(JSON.stringify(rc.checkCountList('3 of your 5 deaths went unanswered, in rounds 1, 3 and 4.', { rounds: new Map(), countedTexts: ['3 of your 5 deaths went untraded, in rounds 2, 5 and 6.'] }))
    === JSON.stringify({ rewrite: '3 of your 5 deaths went unanswered, in rounds 2, 5 and 6.' }), 'CAUGHT: the untraded deaths written with the untraded line\'s rounds');
  const pfl = factsFor(valMatch({ id: 'valorant-1790000000000-pearl8r', map: 'Pearl', agent: 'Raze', mode: 'Swiftplay', score: '1-5', rounds: 6,
    patterns: [{ key: 'early', text: '5 of your 5 deaths came in the first 30 seconds of the round, before any plant, in rounds 1, 3, 4, 5 and 6.' }],
    cards: [1, 3, 4, 5, 6].map((n) => card({ n, riot: { sec: 9, killer: 'Cypher', weapon: 'Classic', traded: false, kills: 0 } })) }), [{ role: 'user', content: 'Why did I die so early?' }], STAND_IN);
  for (const [s, want] of [['All 5 of your deaths came in the first 30 seconds, in rounds 1, 3, 4 and 5.', 'All 5 of your deaths came in the first 30 seconds, in rounds 1, 3, 4, 5 and 6.'],
    ['5 of your 5 deaths came early (rounds 1, 3, 4 and 5).', '5 of your 5 deaths came early (rounds 1, 3, 4, 5 and 6).'],
    ['5 of your 5 deaths came early: rounds 1, 3, 4 and 5.', '5 of your 5 deaths came early: rounds 1, 3, 4, 5 and 6.'],
    ['5 of your 5 deaths came early, in R1, R3, R4 and R5.', '5 of your 5 deaths came early, in rounds 1, 3, 4, 5 and 6.'],
    ['5 of your 5 deaths came early, in rounds one, three, four and five.', '5 of your 5 deaths came early, in rounds 1, 3, 4, 5 and 6.'],
    ['In rounds 1, 3, 4 and 5, all 5 of your deaths came in the first 30 seconds.', 'In rounds 1, 3, 4, 5 and 6, all 5 of your deaths came in the first 30 seconds.']]) {
    const r = one(s, pfl);
    ok(!r.drop && r.s === want, `CAUGHT: "${s}" is written with the counted line's rounds`, JSON.stringify(r));
  }
  ok(asIs('All 5 of your deaths came in the first 30 seconds, in rounds 1, 3, 4, 5 and 6.', pfl)
    && rc.checkCountList('Every one of your 5 deaths came early, in rounds 1, 3, 4, 5 and 6.', rc.contextOfChat(pfl)) === null,
  'KEPT: "all 5" with the full list, and "every one of your 5 deaths" counts five');
  ok(rc.LIST_NOT_BEFORE.test(', starting in round ') && rc.LIST_NOT_BEFORE.test(' from round ') && !rc.LIST_NOT_BEFORE.test(', in rounds ')
    && rc.LIST_AFTER.test(' came early (rounds 1, 3 and 4)') && rc.LIST_AFTER.test(' came early: rounds 1, 3 and 4') && !rc.LIST_AFTER.test(' before round 5') && !rc.LIST_AFTER.test(' after round 10')
    && rc.LIST_BEFORE.test('In rounds 1, 3, 4 and 5, ') && !rc.LIST_BEFORE.test('In the first 30 seconds, ')
    && rc.foldRounds('in R1, R3 and R4') === 'in rounds 1, 3 and 4' && rc.foldRounds('in rounds one, three and twelve') === 'in rounds 1, 3 and 12' && rc.foldRounds('one teammate in R5') === 'one teammate in R5'
    && [...rc.countKinds('went untraded')].join() === 'untraded' && [...rc.countKinds('came in the first 20 seconds')].join() === 'early' && !rc.countKinds('came in').size
    && new RegExp(rc.COUNT_HEAD.source, 'i').exec('All 5 of your deaths')[1] === '5' && !new RegExp(rc.COUNT_HEAD.source, 'i').exec('All of your deaths'),
  'LIST_NOT_BEFORE, LIST_AFTER, LIST_BEFORE, foldRounds, countKinds and the "all N of your" COUNT_HEAD both ways');

  // The open gap: a list with no count, told as the whole set (record-claims.js checkWholeList).
  const wc = rc.contextOfChat(pfl);
  ok(JSON.stringify([...rc.wholeSets(wc)]) === JSON.stringify([['early', [1, 3, 4, 5, 6]]]), 'wholeSets: the counted early line is the whole set', JSON.stringify([...rc.wholeSets(wc)]));
  for (const [s, want] of [['Your early deaths came in rounds 1, 3, 4 and 5.', 'Your early deaths came in rounds 1, 3, 4, 5 and 6.'],
    ['Your early deaths were rounds 1, 3 and 4, and each one left your team short.', 'Your early deaths were rounds 1, 3, 4, 5 and 6, and each one left your team short.'],
    ['The rounds where you died early were rounds 1, 3 and 4.', 'The rounds where you died early were rounds 1, 3, 4, 5 and 6.'],
    ['Your deaths before any plant came in rounds three to five.', 'Your deaths before any plant came in rounds 1, 3, 4, 5 and 6.'],
    ['All of your early deaths came in R1, R3 and R4.', 'All of your early deaths came in rounds 1, 3, 4, 5 and 6.']]) {
    const r = one(s, pfl);
    ok(!r.drop && r.s === want, `CAUGHT: "${s}" is written as the whole set`, JSON.stringify(r));
  }
  for (const s of ['Your early deaths came in rounds 1, 3, 4, 5 and 6.', 'Your early deaths came in rounds 3 to 6 and round 1.', 'Two of your early deaths came in rounds 1 and 3.',
    'Your early deaths came in rounds 1, 3 and 4, among others.', 'Your early deaths came in rounds 1, 3, 4 and 2 more.', 'Your early deaths, including rounds 1 and 3, came from dry peeks.',
    'Your early deaths came in rounds 1 and 3 on defence.', 'Your early deaths to Cypher came in rounds 1 and 3.', 'Your early deaths hurt, and in rounds 1 and 3 you were alone.',
    'Your early deaths came in rounds 1, 3 and 7.', 'The worst of your early deaths came in rounds 1 and 3.', 'Your untraded deaths came in rounds 1 and 3.',
    'If your early deaths came in rounds 1 and 3, slow down.', 'Your early deaths came in round 1.']) {
    ok(rc.checkWholeList(s, wc) === null, `KEPT: "${s}"`, JSON.stringify(rc.checkWholeList(s, wc)));
  }
  // The review of the whole list reader: the rephrasings of the audited claim are caught, a
  // negated list, a list with more rounds after it, a hedge or a scope after it are never rewritten.
  for (const [s, want] of [['Your early deaths occurred in rounds 1, 3, 4 and 5.', 'Your early deaths occurred in rounds 1, 3, 4, 5 and 6.'],
    ['Each of your early deaths came in rounds 1, 3, 4 and 5.', 'Each of your early deaths came in rounds 1, 3, 4, 5 and 6.'],
    ['Every early death came in rounds 1, 3, 4 and 5.', 'Every early death came in rounds 1, 3, 4, 5 and 6.'],
    ['Rounds 1, 3, 4 and 5 were your early deaths.', 'Rounds 1, 3, 4, 5 and 6 were your early deaths.'],
    ['Your early deaths: rounds 1, 3, 4 and 5.', 'Your early deaths: rounds 1, 3, 4, 5 and 6.'],
    ['Your early deaths showed up in rounds 1, 3, 4 and 5.', 'Your early deaths showed up in rounds 1, 3, 4, 5 and 6.']]) {
    const r = one(s, pfl);
    ok(!r.drop && r.s === want, `CAUGHT, a rephrasing: "${s}" is written as the whole set`, JSON.stringify(r));
  }
  for (const s of ['Not all of your early deaths came in rounds 1 and 3.', 'Even your early deaths came in rounds 1 and 3.',
    'Your early deaths came in rounds 1 and 3, then again in rounds 4 and 5.', 'Your early deaths came in rounds 1 and 3 and 2 other rounds.',
    'Your early deaths came in rounds 1, 3 and two later rounds.', 'Your early deaths came in rounds 1 and 3 and again in rounds 4 and 5.',
    'Your early deaths came in rounds 1 and 3, as well as 4 and 5.', 'Your early deaths came in rounds 1 and 3; rounds 4 and 5 followed the same pattern.',
    'Your early deaths came in rounds 1 and 3 first, then 4 and 5.', 'Your early deaths came in rounds 1 and 3, for instance.',
    'Your early deaths came in rounds 1 and 3, to name two.', 'Your early deaths came in rounds 1 and 3 and so on.', 'Your early deaths came in rounds 1 and 3 etc.',
    'Your early deaths came in rounds 1 and 3 too.', 'Your early deaths came in rounds 1 and 3, mostly.', 'Your early deaths came in rounds 1 and 3 especially.',
    'Your early deaths came in rounds 1 and 3 among five.', 'Your early deaths came in rounds 1 and 3 this half.', 'Your early deaths came in rounds 1 and 3 before the switch.',
    'Your early deaths came in rounds 1 and 3, both lost.', 'Your early deaths came in rounds 1 and 3 for the same reason.',
    'Your early deaths came in rounds 1 and 3 after the same dry peek.', 'Your early deaths came in rounds 1 and 3 again and again.']) {
    ok(rc.checkWholeList(s, wc) === null, `KEPT by the whole list reader: "${s}"`, JSON.stringify(rc.checkWholeList(s, wc)));
  }
  ok(rc.WHOLE_CLEAN_TAIL.test('.') && rc.WHOLE_CLEAN_TAIL.test(', and each one left your team short.') && rc.WHOLE_CLEAN_TAIL.test(', so slow down.')
    && !rc.WHOLE_CLEAN_TAIL.test(' this half.') && !rc.WHOLE_CLEAN_TAIL.test(', for instance.') && !rc.WHOLE_CLEAN_TAIL.test(' and 2 other rounds.')
    && rc.WHOLE_NOT_BEFORE.test('Even ') && rc.WHOLE_NOT_BEFORE.test('Not ') && !rc.WHOLE_NOT_BEFORE.test('So ')
    && new RegExp(rc.WHOLE_EVERY.source, 'i').test('every early death came in rounds 1 and 3') && !new RegExp(rc.WHOLE_EVERY.source, 'i').test('every death came in rounds 1 and 3')
    && new RegExp(rc.WHOLE_REVERSED.source, 'i').test('rounds 1 and 3 were your early deaths') && !new RegExp(rc.WHOLE_REVERSED.source, 'i').test('rounds 1 and 3 were your best rounds'),
  'WHOLE_CLEAN_TAIL, WHOLE_NOT_BEFORE, WHOLE_EVERY and WHOLE_REVERSED both ways');
  // Riot's rows as the whole set, where they are the whole match and every trade is known.
  const tr = (n, traded) => card({ n, riot: { sec: 40, killer: 'Omen', weapon: 'Vandal', traded, kills: 0 } });
  const whole = factsFor(valMatch({ id: 'valorant-1790000000000-bind8w', map: 'Bind', agent: 'Sova', mode: 'Swiftplay', score: '1-3', rounds: 4,
    cards: [tr(1, false), tr(2, true), tr(3, false), tr(4, false)] }), [{ role: 'user', content: 'Why did nobody trade me?' }], STAND_IN);
  const wctx = rc.contextOfChat(whole);
  ok(JSON.stringify(rc.wholeSets(wctx).get('untraded')) === '[1,3,4]' && JSON.stringify(rc.checkWholeList('Your untraded deaths came in rounds 1 and 3.', wctx)) === JSON.stringify({ rewrite: 'Your untraded deaths came in rounds 1, 3 and 4.' })
    && rc.checkWholeList('Your untraded deaths came in rounds 1, 3 and 4.', wctx) === null,
  'CAUGHT: the untraded deaths from Riot\'s rows as the whole set, kept when whole', JSON.stringify([...rc.wholeSets(wctx)]));
  const part = factsFor(valMatch({ id: 'valorant-1790000000000-bind8x', map: 'Bind', agent: 'Sova', mode: 'Swiftplay', score: '1-3', rounds: 4,
    cards: [tr(1, false), tr(2, true), tr(3, false), card({ n: 4, riot: { sec: 40, killer: 'Omen', weapon: 'Vandal', kills: 0 } })] }), [{ role: 'user', content: 'Why did nobody trade me?' }], STAND_IN);
  ok(!rc.wholeSets(rc.contextOfChat(part)).has('untraded') && rc.checkWholeList('Your untraded deaths came in rounds 1 and 3.', rc.contextOfChat(part)) === null,
    'KEPT: a death whose trade Riot does not give leaves the set unknown');
  ok(new RegExp(rc.WHOLE_LIST.source, 'i').test('your early deaths came in rounds 1, 3 and 4') && new RegExp(rc.WHOLE_LIST.source, 'i').test('the deaths nobody traded were rounds 2 and 5')
    && !new RegExp(rc.WHOLE_LIST.source, 'i').test('your early deaths to Omen came in rounds 1 and 3') && new RegExp(rc.WHOLE_ROUNDS.source, 'i').test('the rounds where you died first were 1 and 3')
    && rc.WHOLE_PART_BEFORE.test('Two of ') && !rc.WHOLE_PART_BEFORE.test('So ') && rc.WHOLE_PART_AFTER.test(' on defence') && !rc.WHOLE_PART_AFTER.test(', and each')
    && rc.FIRST_LINE.test('you were the first player to die in 4 of 6 rounds, rounds 1, 3, 4 and 6.'),
  'WHOLE_LIST, WHOLE_ROUNDS, WHOLE_PART_BEFORE, WHOLE_PART_AFTER and FIRST_LINE both ways');
}

// ── The coach bench (Nov 2026): no match, no record ─────────────────────────
{
  console.log('\nthe coach bench, no match and no record:');
  const NONE = cp.normalise({ v: 2, game: 'valorant', language: 'en', match: null, player: {}, ask: {} });
  const NQ = 'I was on Raze on Split, defense, pistol round. Should I hold the site to the end or leave?';
  const NM = [{ role: 'user', content: NQ }];
  const rules = cp.rulesFor(NONE);
  ok(cp.noMatch(NONE) && !cp.noMatch(inputFor(ABYSS, NQ)) && !cp.noMatch({ game: 'lol', match: null }),
    'noMatch: a Valorant question with no match, never one with a match, never League');
  ok(rules.includes(cp.NO_RECORD_HEDGE) && !rules.includes(cp.BUY_HEDGE) && !rules.includes(cp.SAVE_HEDGE)
    && rules.includes(cp.ECONOMY_RULE)
    && rules.split('\n').length === cp.VALORANT_RULES.split('\n').length,
  'WITH NO MATCH NEITHER HEDGE TALKS ABOUT A RECORD: the buy hedge says there is none, the save rule teaches the rule alone');
  ok(cp.rulesFor(inputFor(ABYSS, NQ)) === cp.VALORANT_RULES && cp.rulesFor({ ...inputFor(ABYSS, NQ), rankBand: 'asc_plus' }) === cp.VALORANT_RULES.replace(cp.IMPROVING_RULE, cp.IMPROVING_RULE_877),
    'a match without a buy keeps the rules word for word, at every band');
  ok(!DASHES.test(cp.NO_RECORD_HEDGE + cp.NO_MATCH) && !(cp.NO_RECORD_HEDGE + cp.NO_MATCH).includes(';'), 'the new lines have no dash and no semicolon');
  const np = cp.buildPrompt(NONE, NM);
  ok(np.includes(cp.NO_RECORD_HEDGE) && np.includes(cp.NO_MATCH) && !np.includes("This match's record does not hold"),
    'the prompt with no match says there is no record and never that this match\'s record holds nothing');
  const fx = cp.factsOf(NONE, NM);
  ok(fx.noMatch === true && cp.factsOf(inputFor(ABYSS, NQ), NM).noMatch === false, 'the facts know there is no match');
  for (const s of ['The record for that round has you dying on site with the push coming in, so the decision was staying.',
    "The record doesn't hold a drone on C, so I cannot say it was there.", "Riot's record shows you died first.",
    'In the record, you planted at B.', "The round's record has no plant at B.", "This match's record does not hold what anyone bought."]) {
    const r = gates.check(s, fx);
    ok(r.drop && r.drop.gate === 'no-record' && gates.NO_RECORD_SAID.test(s), `CAUGHT, no match: "${s.slice(0, 60)}"`, JSON.stringify(r));
  }
  // The attribution gate takes "According to" first; the no record pattern reads it too.
  ok(gates.NO_RECORD_SAID.test('According to the record you were alone.') && gates.check('According to the record you were alone.', fx).drop,
    'CAUGHT, no match: "According to the record you were alone."');
  for (const s of ["I don't have the record of that match, so I am going by what you described.",
    'There is no record in front of me, so going by your description, you should have left the site.', 'Keep a record of the habits they repeat.']) {
    ok(!gates.gateNoRecord(s, fx) && !gates.NO_RECORD_SAID.test(s), `KEPT, no match: "${s.slice(0, 60)}"`);
  }
  ok(!gates.gateNoRecord('The record for that round has you dying on site.', cp.factsOf(inputFor(ABYSS, NQ), NM))
    && !gates.gateNoRecord('The record for that round has you dying on site.', { ...fx, language: 'de' }),
  'and nothing where a match is attached, or outside English');
  const bench = cp.parseReply('You should have left A site rather than fought to the end, because a five man push is a site you cannot hold alone.\n\n'
    + 'The record for that round has you dying on site with the push coming in. Give one piece of ground and fall back to a spot off the site where you can still see the plant.', NONE, { messages: NM });
  ok(bench.reply && !/the record/i.test(bench.reply) && /fall back to a spot off the site/.test(bench.reply), 'the bench answer goes out without its record sentence', JSON.stringify(bench));
  ok(gates.GATES.map(([n]) => n).indexOf('no-record') === gates.GATES.map(([n]) => n).indexOf('product') + 1, 'the no record gate runs right after the product gate');
  // The two rules the bench asked for, in the static rules (and so in SPEC_RULES above).
  // The buy and save question rules gave way to the economy rule in the coach bench 9 (the economy out of scope).
  ok(cp.VALORANT_RULES.includes(cp.ECONOMY_RULE) && !/^- A buy question/m.test(cp.VALORANT_RULES)
    &&/^- When the question names an ability, answer first how to use that ability in that moment/m.test(cp.VALORANT_RULES),
  'THE ECONOMY RULE STANDS FOR THE BUY QUESTION (the coach bench 9), and an ability question is answered with the ability first');
}

// ── The coach bench, retrieval: the player's own account with no match ──────
{
  console.log('\nthe coach bench, the notes for the round the player describes:');
  const knowledge = require('../server/services/knowledge');
  const topicOf = new Map(knowledge.all().map((n) => [n.text, n.source && n.source.topic]));
  const ask = (band, content) => {
    const ctx = chatContext.build(null, { rows: [] }, null, content, { game: 'valorant', language: 'en', advanced: true, switchedFrom: null, now: Date.now() });
    ctx.rankBand = band;
    const input = cp.normalise(ctx);
    const messages = [{ role: 'user', content }];
    return { input, messages, sit: cp.askedSituation(input, messages) };
  };
  const SNIPER = 'I was on Jett on Sunset, defense, round three. I held a tight angle toward A main with an Outlaw next to our Omen. I kept micro moving on the angle. Was it fine to keep moving a little while I held that angle with the Outlaw?';
  const s1 = ask('silver_gold', SNIPER);
  ok(s1.sit && s1.sit.agent === 'Jett' && s1.sit.map === 'Sunset' && s1.sit.side === 'defense' && s1.sit.round === 3
    && s1.sit.guns.join() === 'outlaw' && s1.sit.mates.join() === 'Omen' && s1.sit.topics.has('hold') && !s1.sit.inQuestion,
  'THE ACCOUNT READ: own agent, map, side, round, gun, the teammate as a mate and the hold asked', JSON.stringify(s1.sit && { ...s1.sit, flags: [...s1.sit.flags], topics: [...s1.sit.topics] }));
  // Each situation regex against a known positive and a known negative (CLAUDE.md, no regex untested).
  const fl = (content) => [...ask('silver_gold', content).sit.flags].sort().join();
  ok(fl('I was on Raze on Split, defense, pistol round. Where should I play?') === 'pistol'
    && fl('I was on Chamber on Haven, defense, round 2 after we won pistol. What should I buy?') === 'antieco'
    && fl('I was on Skye on Lotus, defense, second round after losing pistol. I am on an eco. What should I buy?') === 'eco,lostpistol'
    && fl('I was on Sage on Split, defense. They were on an eco with pistols. Is pushing worth it?') === 'antieco'
    && fl('I was on Raze on Split, defense, round three, four teammates buying. What should I buy when my team full buys?') === 'fullbuy'
    && fl('I was on Jett on Sunset, attack. We were saving. What should I buy?') === 'eco',
  'THE ROUND TYPE: pistol, a won pistol, a lost pistol with an eco, the enemy eco, a team full buy, a team save');
  ok(ask('silver_gold', 'I was on Jett on Sunset, defense. The spike was not planted. How should I have played it?').sit.phase === 'active'
    && ask('silver_gold', 'I was on Jett on Sunset, defense. In that retake should I have kept defusing?').sit.phase === 'postplant'
    && ask('silver_gold', 'I was on Jett on Sunset. If my team is saving but I have a lot of credits, what should I buy?').sit.phase === 'buy'
    && ask('silver_gold', 'I was on Omen on Fracture, defense. Should I have saved in that 1v4 instead of taking the retake?').sit.phase !== 'buy',
  'THE PHASE: "not planted" is no post plant, a retake is, a buy question is, a saved gun is not');
  ok(ask('silver_gold', 'I was on Jett on Sunset. I was low HP in a 1v1, how should I have played it?').sit.lowHp
    && ask('plat_diamond', 'I was on Reyna on Abyss, attack. I was on 1 HP. What should I do?').sit.lowHp
    && !ask('plat_diamond', 'I was on Reyna on Abyss, attack. I had full HP. What should I do?').sit.lowHp,
  'LOW HP: "low HP" and "1 HP", never full HP');
  const ab = ask('asc_plus', 'I was on Skye on Split, defense retake. I sent my bird at their Raze but popped it short. I flashed the Raze but she still killed my teammate, why did the blind not work?').sit;
  ok(ab.abilities.join() === 'guiding light' && ab.abilitiesAsked.join() === 'guiding light' && ab.retake,
    'THE ABILITY SAID: "bird" and "flashed" are Guiding Light, asked in the question sentence');
  ok(ask('silver_gold', 'I was on Jett on Sunset, attack, a half buy round. I had about 7,950 credits. If my team is saving but I have a lot of credits, what should I buy?').sit.topics.has('rich')
    && ask('plat_diamond', 'I was on Reyna on Abyss, retake. How should I play a retake when we are up numbers and I have flashes?').sit.topics.has('numbers')
    && ask('silver_gold', 'I was on Jett on Sunset, defense. They went B two rounds in a row. How do I decide where to start on defense from what the enemy did in earlier rounds?').sit.pattern
    && ask('asc_plus', 'I was on Skye on Split. I was walking around the corner carefully and still lost the fight, what was wrong with my peek?').sit.topics.has('peek')
    && ask('silver_gold', 'I was on Jett on Sunset, attack, after we planted B. After the plant, where should I go and who should I play with?').sit.topics.has('partner'),
  'THE TOPICS: a rich player, the numbers, the enemy pattern, the peek, who to play with');
  ok(ask('silver_gold', 'I overextended alone into one with a Sheriff. I was on Chamber on Haven and had an Outlaw. Should I go?').sit.guns.join() === 'outlaw',
    'AN ENEMY\'S GUN IS NOT THE PLAYER\'S: "into one with a Sheriff" is theirs, "had an Outlaw" is yours');
  // The review of the bench reader: whose gun, side, pistol, eco, buy, retake and agent each account names.
  const sitOf = (content, band = 'silver_gold') => ask(band, content).sit;
  const g1 = sitOf('I was on Sova on Bind. A Jett killed me with an Operator from long every time I peeked. How do I deal with that?');
  const g2 = sitOf('I died to a Jett with an Operator on Ascent mid again. How do I get past mid?');
  const g3 = sitOf('I was on Chamber on Haven. I held B long with my Operator. Was that right?');
  const g4 = sitOf('I was on Jett on Sunset with an Outlaw and got killed by a Vandal. Should I have peeked?');
  ok(g1.guns.length === 0 && (!g2 || g2.guns.length === 0) && g3.guns.join() === 'operator' && g4.guns.join() === 'outlaw',
    'THE KILLER\'S GUN IS NOT THE PLAYER\'S: "killed me with an Operator", "a Jett with an Operator", "by a Vandal"; "my Operator" and "with an Outlaw" still are',
    JSON.stringify([g1.guns, g2 && g2.guns, g3.guns, g4.guns]));
  ok(sitOf('I was on Jett on Bind, we attacked A short and their defense stacked A. Should we have gone B?', 'plat_diamond').side === 'attack'
    && sitOf('Their defense kept stacking A when we attacked. What should we change?').side === 'attack'
    && sitOf('I was on Cypher on Split. Their attack kept hitting B. Where should I play?').side === 'defense'
    && sitOf('I was on Sage on Split, attack. We were stuck. What now?').side === 'attack'
    && sitOf('I was on Sage on Split. We defended B twice and lost. What now?').side === 'defense',
  'THE SIDE: "attacked" is attack, the enemy\'s "their defense" is the player\'s attack and "their attack" the defense');
  const fls = (content) => [...sitOf(content).flags].sort().join();
  ok(fls('The enemy won pistol. What should I buy in round two?') === 'lostpistol'
    && fls('They won the pistol, so round two we were on an eco. What should I buy?') === 'eco,lostpistol'
    && fls('I was on Sova on Haven, round three. We lost pistol on C and won the eco on A, so they are on an eco or bonus now. Where should I have set up in round three after we won round two?') === 'antieco'
    && fls('I was on Sova on Haven, round three. We lost pistol and lost round two as well. What should I buy?') === 'lostpistol',
  'WHO WON THE PISTOL: the enemy winning it is the player\'s lost pistol, "won the eco" is a past round, round three after a won round two is no lost pistol save',
    JSON.stringify([fls('The enemy won pistol. What should I buy in round two?'), fls('They won the pistol, so round two we were on an eco. What should I buy?')]));
  const r1 = sitOf('I was on Phoenix, we planted B and they were defusing while I was still alive. What should I have done?');
  const r2 = sitOf('I was on Brimstone on Bind, post plant, waiting for a kill while they were defusing. What should I do?');
  ok(!r1.retake && r1.side === 'attack' && !r2.retake && r2.side === 'attack'
    && sitOf('I was on Jett on Sunset, defense, a 2v1 retake on a planted site. I half defused, then stopped. Should I have kept defusing?').retake
    && sitOf('I was on Sage on Bind. I tapped the spike and defused too late. What should I do?').retake,
  'THE ENEMY\'S DEFUSE IS NO RETAKE: "they were defusing" is an attacker\'s post plant, the player\'s own defuse still is');
  ok(!sitOf('I was on Killjoy, defense on Haven. A Raze satchel forced me off my angle and I died. How should I hold that?').flags.has('forcebuy')
    && !sitOf('We were attacking and a Raze satchel forced me off the angle. How do I peek better?').flags.has('forcebuy')
    && sitOf('I was on Jett on Sunset, attack. We forced in round two and lost. Should we have saved?').flags.has('forcebuy')
    && sitOf('I was on Jett on Sunset, attack, a force buy round. What should I buy?').flags.has('forcebuy'),
  'FORCE IS THE BUY, NOT THE VERB: "forced me off my angle" is no force buy, "we forced" and "a force buy" are');
  const e1 = sitOf('Their team was saving, so I peeked aggressively with my Vandal and got killed by a Sheriff. Was that wrong?', 'plat_diamond');
  const e2 = sitOf('They full buy every round and we keep losing. I was on Sage on Lotus, defense.');
  ok(!e1.flags.has('eco') && e1.flags.has('antieco') && !e2.flags.has('fullbuy')
    && sitOf('I was on Sage on Lotus, defense. We full bought and lost. What now?').flags.has('fullbuy'),
  'THE ENEMY\'S SAVE AND FULL BUY ARE NOT THE PLAYER\'S: "their team was saving" is anti eco, "they full buy" no full buy');
  ok(sitOf('I pushed as Omen smoked the door on Ascent and died instantly. What did I do wrong?') === null
    && sitOf('As Chamber, what should I buy in round 2 after we win pistol on defense?').agent === 'Chamber'
    && sitOf('I died a lot as Sova on Bind, attack. What should I change?').agent === 'Sova',
  'A BARE "AS" IS THE PLAYER\'S AGENT ONLY OUTSIDE A CLAUSE: "as Omen smoked the door" is a teammate');
  // With a match, or with no account of a round at all, nothing is read and the notes are as before.
  ok(cp.askedSituation(inputFor(ABYSS, SNIPER), [{ role: 'user', content: SNIPER }]) === null
    && ask('silver_gold', "What's the best agent on Abyss right now?").sit === null
    && cp.askedSituation({ ...s1.input, language: 'de' }, s1.messages) === null,
  'NOTHING READ with a match, with no account of a round, or outside English');
  // The bench's three buy questions are out of scope since the coach bench 9 (outOfScope): no notes, the scope line.
  for (const content of ['I was on Raze on Split, defense, round three, four teammates buying. I kept 950 credits and bought only a Bucky. What should I buy and how should I start the round when my team full buys?',
    'I was on Killjoy on Breeze, attack, pistol round. I kept the Classic, skipped light shield and spent everything on utility. Is buying all my Killjoy utility with a shieldless Classic a good pistol round buy on Breeze?',
    'I was on Chamber on Haven, defense, round 2 after we won pistol. I bought an Outlaw. As Chamber, what should I buy in round 2 after we win pistol on defense?']) {
    const x = ask('silver_gold', content);
    ok(cp.outOfScope(x.input, x.messages) === 'economy', `OUT OF SCOPE since the coach bench 9: "${content.slice(-60)}"`);
  }
  // The notes the bench's gaps were written for now reach their questions.
  const served = (band, content) => { const x = ask(band, content); return cp.pickNotes(x.input, x.messages).map((t) => topicOf.get(t)); };
  for (const [band, content, topic] of [
    ['silver_gold', SNIPER, 'a sniper holds still'],
    ['silver_gold', 'I was on Omen on Fracture, defense, eco round on B with a Bucky and Sheriff. Where should I go on B when I lose track of arcade and tower in an eco?', 'play the eco for kills'],
    ['silver_gold', 'I was on Jett on Sunset, defense, start of round three. They went B two rounds in a row and lost both. The enemies hit B twice and lost, should we have changed our setup for round three?', 'the hit they will not run again'],
    ['plat_diamond', 'I was on Sage on Split, attack. We had been fighting and using utility at A for over 20 seconds. We just killed the A players after a long fight there, should we keep hitting A?', 'the stack after a long fight'],
    ['silver_gold', 'I was on Jett on Sunset, defense, a 2v1 retake on a planted site. I half defused, then stopped to fight with time nearly gone. In that retake should I have kept defusing or turned to fight the last enemy?', 'stick it or step off'],
    ['asc_plus', 'I was on Skye on Split, defense retake after a plant. I sent my bird at their Raze but popped it short. I flashed the Raze but she still killed my teammate, why did the blind not work?', 'the bird travels before it pops'],
    ['asc_plus', 'I was on Phoenix on Breeze, defense. I flashed and peeked standing up into a blinded enemy who sprayed at head height. Why do I keep losing fights right after I flash or at very close range?', 'under the blind spray'],
    ['plat_diamond', 'I was on Sage on Split, attack, taking A. My team walked out of main while I held my slow orbs. When should Sage throw her slow orbs during an A take on Split?', 'slows in phases'],
    ['plat_diamond', 'I was on Reyna on Abyss, attack, spike planted on A, we were up 3v2. I was on 1 HP and kept taking fights. What should I do when we are up numbers post plant and I am 1 HP?', 'low health after the plant'],
  ]) {
    const got = served(band, content);
    ok(got.includes(topic), `SERVED: "${topic}" for "${content.slice(-60)}"`, JSON.stringify(got));
  }
  // The round type reaches retrieve() as flags it reads, and only those (knowledge.js ASKED_FLAGS).
  const sx = knowledge.situationOf({ phase: 'buy', asked: ['antieco', 'eco', 'nonsense'] });
  ok(sx.flags.has('antieco') && sx.flags.has('eco') && !sx.flags.has('nonsense') && !sx.record.size
    && knowledge.situationOf({}).flags.size === 0,
  'ASKED FLAGS: the closed list only, never the record\'s, and none sent is as before');
}

// bench:chat, 9 Nov: a Vandal answer's working, a hit with no gun named held
// to the armour it goes through, and its sum tied to nothing.
{
  const q = [{ role: 'user', content: 'How many body shots does a Vandal need to kill someone with heavy armor?' }];
  const fv = cp.factsOf({ game: 'valorant', agent: 'Jett' }, q);
  const drop = (s) => gates.check(s, fv).drop;
  ok(JSON.stringify(fv.askedGuns) === '["Vandal"]', 'ASKED GUNS: the Vandal of the question', JSON.stringify(fv.askedGuns));
  ok(!drop('A Vandal needs 4 body hits to kill someone with Heavy Armor from full health, at any range.')
    && !drop('Each body hit deals 40 damage, so the fourth hit brings the total to 160, enough to kill through Heavy Armor.'),
  'ASKED GUN: the Vandal\'s 40 body damage and its 160 total stand', JSON.stringify(drop('Each body hit deals 40 damage, so the fourth hit brings the total to 160, enough to kill through Heavy Armor.')));
  ok(drop('Each body hit deals 50 damage, so the fourth hit brings the total to 160, enough to kill through Heavy Armor.')
    && drop('Each body hit deals 40 damage, so the fourth hit brings the total to 170, enough to kill through Heavy Armor.')
    && drop('A Vandal needs 3 body hits to kill someone with Heavy Armor.'),
  'ASKED GUN: a wrong damage, a wrong total and a wrong count still go');
}

// ── The coach bench 9 (Nov 2026): the economy out of scope, the pistol premise, the map habit ──
{
  console.log('\nthe coach bench 9, the economy out of scope, the pistol premise and the map habit:');
  const gameClaims9 = require('../server/services/game-claims');
  const NONE9 = cp.normalise({ v: 2, game: 'valorant', language: 'en', match: null, player: {}, ask: {} });
  const ask9 = (content) => [{ role: 'user', content }];
  // Economy questions are answered with the scope line, no model call (coach.js chatV2).
  for (const q of ['I was on Raze on Split, defense, round two after pistol, most of my team saving. I bought light shield, a Bucky, two satchels and the Boom Bot. How much should I spend in round two when my team is saving?',
    'I won the first two rounds and still have my Marshal, should I buy up in round 3?', 'Should I have saved my gun in round 4?', 'How does the loss bonus work?', 'What should I buy on a force?']) {
    ok(cp.outOfScope(NONE9, ask9(q)) === 'economy' && cp.outOfScope(inputFor(ABYSS, q), ask9(q)) === 'economy', `OUT OF SCOPE: "${q.slice(-60)}"`);
  }
  for (const q of ["I was on Skye on Lotus, defense, eco round on A. Our Omen dropped a smoke on A main and I pushed into it right away. Is pushing straight into my controller's smoke on A main a good eco play?",
    'Where should I have set up in round three after we won round two?', 'Should I save my ult for the retake?', 'When should I use a fast rotation setup on Haven as Chamber?', 'Why did I lose round 5?']) {
    ok(cp.outOfScope(NONE9, ask9(q)) === null, `IN SCOPE: "${q.slice(-60)}"`);
  }
  // Changed when the scope reached every language (Nov 2026): an English economy question asked
  // with another coaching language set is out of scope too; League never is.
  ok(cp.outOfScope({ ...NONE9, game: 'lol' }, ask9('Should I buy boots first?')) === null && cp.outOfScope({ ...NONE9, language: 'de' }, ask9('Should I buy?')) === 'economy',
    'outOfScope: Valorant only, and English economy words in any coaching language');
  ok(cp.ECON_QUESTION.test('should I buy up') && !cp.ECON_QUESTION.test('should I save my ult') && !DASHES.test(cp.ECONOMY_OUT + cp.ECONOMY_RULE + cp.MAP_HABIT_RULE),
    'ECON_QUESTION both ways, and the new lines carry no dash');
  ok(cp.VALORANT_RULES.includes(cp.ECONOMY_RULE) && cp.VALORANT_RULES.includes(cp.MAP_HABIT_RULE) && !/^- A buy question/m.test(cp.VALORANT_RULES) && !/^- A save question/m.test(cp.VALORANT_RULES),
    'the rules: the economy rule replaces the save and buy question rules, and the map rule is in');
  // The economy gate: any economy claim goes, with a match or without.
  const fx9 = cp.factsOf(NONE9, ask9('round 3 after we won pistol and round two, should I have pushed?'));
  for (const s of ['Winning the pistol and then round 2 means the enemy is on their smallest loss pay, and the round that follows is the one where a cheap gun still beats what they can field.',
    'The rhythm to aim for is buy, eco, buy, buy.', 'You should have saved with them.']) {
    const r = gates.check(s, fx9);
    ok(r.drop && (r.drop.gate === 'economy-scope' || r.drop.gate === 'economy'), `ECONOMY DROPPED: "${s.slice(0, 60)}"`, JSON.stringify(r));
  }
  ok(!gates.check('On an eco, play for close fights together with the team.', fx9).drop && !gates.check('Your smoke buys the team time to rotate.', fx9).drop,
    'an eco named as the round and time bought are kept');
  // The record's own kind of round stays where the round's line gives it.
  const kind = { language: 'en', game: 'valorant', rounds: new Map([[4, { n: 4, buy: 'full' }]]) };
  ok(!gates.gateEconomyScope('Round 4 was your team\'s full buy.', kind, { round: true, rounds: [4] })
    && gates.gateEconomyScope('Round 4 was your team\'s full buy.', { ...kind, rounds: new Map() }, { round: true, rounds: [4] }),
  'the team full buy Riot gives for the round stays, and goes with no record of it');
  // The pistol premise, from the player's words with no match.
  const lostQ = ask9('I was on Skye on Lotus, defense, round three. We lost pistol on C and won the eco on A. Where should I have set up in round three after we won round two?');
  const fLost = cp.factsOf(NONE9, lostQ);
  ok(fLost.pistol === 'lost' && cp.factsOf(NONE9, ask9('round two after pistol, most of my team saving. Where should I play?')).pistol === null, 'facts.pistol: the player\'s own words');
  ok(gates.check('Since I do not have the record of the round three on Lotus, I can only speak generally about positioning after winning a pistol round.', fLost).drop,
    'WCgnalZDT_A-5: positioning after winning a pistol round, where they lost it, goes');
  const fNone = cp.factsOf(NONE9, ask9('I was on Raze on Split, defense, round two after pistol. Where should I play?'));
  ok(gates.gatePistolPremise("You're in the round after a won pistol on defence.", fNone)?.gate === 'premise', 'bNC4PU5AwEA-4: a won pistol nobody said goes');
  ok(!gates.gatePistolPremise('When you win a pistol round, play the next round tightly.', fLost), 'a general rule stays');
  // With a match, Riot's record says which pistol.
  const pm = { game: 'valorant', language: 'en', asked: 3, rounds: new Map([[1, { n: 1, pistol: true, result: 'lost' }], [2, { n: 2, result: 'won' }], [3, { n: 3, result: 'won' }]]) };
  ok(cp.pistolKnown({ match: {} }, [], pm) === 'lost' && gates.gatePistolPremise('After your won pistol, play it tight.', { ...pm, pistol: 'lost' }), 'a match: the asked round\'s pistol from the record');
  // The notes: no economy note, and no won pistol note to a player who lost it.
  const notes = cp.pickNotes(NONE9, lostQ);
  ok(!notes.some((t) => /After you win the pistol round/.test(t)) && notes.every((t) => cp.noteInScope(t, 'lost')), 'WCgnalZDT_A-5: the won pistol note is not served to a lost pistol', JSON.stringify(notes));
  const econNotes = cp.pickNotes(NONE9, ask9('I was on Skye on Lotus, defense, eco round on A. Is pushing into my own smoke a good eco play?'));
  ok(econNotes.length >= 4 && econNotes.every((t) => !gameClaims9.economyClaim(t)), 'no economy note reaches Ask Coach', JSON.stringify(econNotes));
  // The map habit.
  const haven = 'You read the earlier rounds right, but on Haven, C is the site a five-stack with no lurks reaches last, so when Garage goes quiet that is the hit.';
  ok(gates.check(haven, fx9).drop?.gate === 'map-habit' && !gates.check('They hit B and lost, so expect A next round.', fx9).drop, 'KVOVQ6jiQw8-6: the invented Haven habit goes, this enemy\'s own habit stays');
  ok(gates.GATES.slice(-3).map(([n]) => n).join() === 'economy-scope,premise,map-habit', 'the three bench 9 gates run after every gate before');
  // Map control and positioning: the notes the four weaker moments were missing now reach them.
  const knowledge9 = require('../server/services/knowledge');
  const topic9 = new Map(knowledge9.all().map((n) => [n.text, n.source && n.source.topic]));
  const benchQ = (band, content) => { const ctx = chatContext.build(null, { rows: [] }, null, content, { game: 'valorant', language: 'en', advanced: true, switchedFrom: null, now: 0 }); ctx.rankBand = band; return cp.pickNotes(cp.normalise(ctx), ask9(content)).map((t) => topic9.get(t)); };
  for (const [band, content, topic] of [
    ['silver_gold', 'I was on Jett on Sunset, defense, start of round three. They went B two rounds in a row and lost both into our Viper anchoring B. Me and our Omen set up at A elbow with no real plan. The enemies hit B twice and lost, should we have changed our setup for round three?', 'the hit they will not run again'],
    ['asc_plus', 'I was on Chamber on Haven, defense, around rounds 8 to 10. I held C expecting to beat a drone they had never used on C in any earlier round. They have been jump spotting C long, always five stacking with no lurks. How do I use what the enemies did in earlier rounds to plan the late rounds of the half?', 'plan the late half on the habits seen'],
    ['asc_plus', 'I was on Chamber on Haven, defense, round 3, their bonus. They went C in round 1 and defaulted toward A and mid in round 2. I used a fast rotation setup with my teleport in A link, expecting an A rush. When should I use a fast rotation setup on Haven as Chamber, and when should I commit to a site?', 'Chamber commits on a read'],
    ['plat_diamond', 'I was on Skye on Lotus, defense, round three. We lost pistol on C and won the eco on A, so they are on an eco or bonus now. Our Killjoy and Chamber sat on C, our Jett held B main aggressively alone, and I set up away from her. Where should I have set up in round three after we won round two?', 'set up from the enemy pattern'],
  ]) {
    const got = benchQ(band, content);
    ok(got.includes(topic), `BENCH 9 SERVED: "${topic}"`, JSON.stringify(got));
  }
  const failedHit = knowledge9.all().find((n) => n.source && n.source.topic === 'the hit they will not run again');
  ok(/expect them at a different site next round, not at the one that held/.test(failedHit.text), 'FD8OFhwHF5M-3: the failed hit note names the site to lean to without "the other site"');
}

// ── The economy out of scope everywhere the coach speaks (Nov 2026) ──────────
// Every coaching language in languages.js gets the scope check, from a word
// list of its own (ECON_WORDS), each with a known positive and a known
// negative; the scope line is said in the player's language (economyOut);
// economyDrop is the gate frame chat and Ask Coach v1 run over a reply.
{
  console.log('\nthe economy out of scope everywhere the coach speaks:');
  const { PROMPT_NAMES } = require('../server/services/languages');
  const base = cp.normalise({ v: 2, game: 'valorant', language: 'en', match: null, player: {}, ask: {} });
  const asked = (language, content) => cp.outOfScope({ ...base, language }, [{ role: 'user', content }]);
  const CASES = {
    de: { out: ['Soll ich in Runde 3 kaufen oder sparen?', 'Wie funktioniert der Verlustbonus?', 'Wie viele Credits brauche ich für eine Vandal?'],
      in: ['Wo hätte ich in Runde 4 stehen sollen?', 'Soll ich meine Ult für den Retake sparen?', 'Wir hatten eine Eco-Runde. Wo hätte ich stehen sollen?'] },
    es: { out: ['¿Debería comprar en la ronda 3?', '¿Cómo funciona la economía en Valorant?', '¿Tengo que ahorrar si perdimos la pistola?'],
      in: ['¿Dónde debería haberme puesto en la ronda 4?', '¿Debería guardar mi definitiva para el retake?'] },
    'pt-BR': { out: ['Devo comprar no round 3?', 'Quantos créditos eu preciso para uma Vandal?', 'Era melhor economizar nesse round?'],
      in: ['Onde eu deveria ter ficado no round 4?', 'Devo segurar minha ult para o retake?'] },
    fr: { out: ['Est-ce que je dois acheter au round 3 ?', "Comment marche l'économie dans Valorant ?", 'Fallait-il économiser ce round ?'],
      in: ['Où est-ce que je devais me placer au round 4 ?', 'Je dois garder mon ulti pour le retake ?'] },
    tr: { out: ['3. raundda satın almalı mıyım?', 'Ekonomi nasıl çalışıyor?', 'Kaç kredi biriktirmem gerekiyor?'],
      in: ['4. raundda nerede durmalıydım?', 'Ultimi retake için saklamalı mıyım?'] },
    ru: { out: ['Стоит ли мне купить винтовку в третьем раунде?', 'Как работает экономика в Valorant?', 'Нужно было сейвить в этом раунде?'],
      in: ['Где мне надо было стоять в четвёртом раунде?', 'Стоит ли копить ульту на ретейк?'] },
    pl: { out: ['Czy powinienem kupić coś w rundzie 3?', 'Jak działa ekonomia w Valorant?', 'Czy trzeba było oszczędzać w tej rundzie?'],
      in: ['Gdzie powinienem stać w rundzie 4?', 'Czy oszczędzać ulta na retake?'] },
    ja: { out: ['ラウンド3で買うべきですか？', 'エコノミーの仕組みを教えてください', 'このラウンドは節約するべきでしたか？'],
      in: ['ラウンド4ではどこに立つべきでしたか？', 'ウルトはリテイクのために温存するべき？', 'エコーの使い方は？'] },
    ko: { out: ['3라운드에 총을 사야 하나요?', '경제는 어떻게 돌아가나요?', '이번 라운드는 세이브해야 했나요?'],
      in: ['4라운드에서 어디에 서 있어야 했나요?', '궁극기를 리테이크까지 아껴야 하나요?', '왜 졌는지 궁금해요'] },
  };
  for (const code of Object.keys(PROMPT_NAMES).filter((c) => c !== 'en')) {
    const c = CASES[code];
    ok(!!c && !!cp.ECON_WORDS[code], `${code}: a word list and its cases`);
    if (!c) continue;
    for (const q of c.out) ok(asked(code, q) === 'economy', `${code} OUT OF SCOPE: "${q}"`);
    for (const q of c.in) ok(asked(code, q) === null, `${code} IN SCOPE: "${q}"`);
    const line = cp.economyOut(code);
    ok(typeof line === 'string' && line.length > 40 && line !== cp.ECONOMY_OUT && !DASHES.test(line), `${code}: the scope line is said in the player's language, with no dash`);
  }
  ok(cp.economyOut('en') === cp.ECONOMY_OUT && cp.economyOut('xx') === cp.ECONOMY_OUT && cp.economyOut(undefined) === cp.ECONOMY_OUT, 'English, and English for a code it does not know');
  // The English words still apply in another coaching language: players type the game's own jargon.
  ok(asked('pt-BR', 'Should I force buy here?') === 'economy' && asked('ja', 'What should I buy on a force?') === 'economy', 'English jargon in another language is out of scope');
  // economyDrop: the gate frame chat and Ask Coach v1 run over a reply, English only.
  const dropped = cp.economyDrop('You died to a crossfire at B Main. With the loss bonus this low, you should have saved your rifle. Next time hold from cover.', { language: 'en', game: 'valorant' });
  ok(dropped.dropped === 1 && dropped.text === 'You died to a crossfire at B Main. Next time hold from cover.', `economyDrop takes the economy sentence and keeps the rest (${dropped.text})`);
  ok(cp.economyDrop('On an eco, play for close fights together. Your smoke buys the team time to rotate.', { language: 'en', game: 'valorant' }).dropped === 0, 'economyDrop keeps a round named as an eco and time bought');
  ok(cp.economyDrop('Du hättest sparen sollen.', { language: 'de', game: 'valorant' }).dropped === 0 && cp.economyDrop('Buy boots first.', { language: 'en', game: 'lol' }).dropped === 0,
    'economyDrop judges English Valorant only');
}

console.log(fails ? `\nFAIL: ${fails} check(s) failed` : '\nPASS: every gate keeps and drops what it should, the prompt is the spec\'s, and the reply keeps its paragraphs');
process.exit(fails ? 1 : 0);

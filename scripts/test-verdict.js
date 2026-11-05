'use strict';

/**
 * The Verdict (8.6.0): what it says, and its share image.
 *
 *   src/shared/verdict.js                what the top of a graded review says,
 *                                        on the real fixtures, with the values
 *                                        the site shows
 *   src/renderer/shared/verdict-card.js  the share image, drawn in its three
 *                                        sizes and on both grounds on a stand
 *                                        in canvas, with the real theme tokens
 *
 * The Abyss 13 to 11 is built the way the app's Riot link builds it
 * (src/main/index.js riotLook and buildValorantReview): Riot's agent, Riot's
 * own line for the scoreboard, Riot's queue, no tracker. The player's saved
 * reviews are read too when this PC has them, through served() as the page
 * gets them, and a run without them says so and skips them.
 *
 * Run: npm run test:verdict
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { replay, load } = require('./fixtures/replay-match');
const review = require('../src/shared/valorant-review');
const verify = require('../src/shared/valorant-verify');
const agentData = require('../src/main/services/agent-data');
const lolReview = require('../src/shared/lol-review');
const grade = require('../src/shared/grade');
const insights = require('../src/shared/insights');
const verdict = require('../src/shared/verdict');

const ROOT = path.join(__dirname, '..');
const CARD = path.join(ROOT, 'src', 'renderer', 'shared', 'verdict-card.js');
const GRADE_VIEW = path.join(ROOT, 'src', 'renderer', 'shared', 'grade-view.js');
const THEME = path.join(ROOT, 'src', 'renderer', 'shared', 'theme.css');
const DOT = ' · ';

let fails = 0;
let checks = 0;
const ok = (cond, what, detail) => {
  checks++;
  if (!cond) { fails++; console.log(`FAIL  ${what}${detail !== undefined ? `  [${detail}]` : ''}`); } else console.log(`ok    ${what}`);
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const copy = (x) => JSON.parse(JSON.stringify(x));

/** No key for a person, and no '#', anywhere in a Verdict. */
const PERSON_KEY = /name|puuid|tag|riot ?id|player|user|account|email|summoner|^me$/i;
function leaks(v) {
  const out = [];
  const walk = (x, where) => {
    if (Array.isArray(x)) { x.forEach((y, i) => walk(y, `${where}[${i}]`)); return; }
    if (x && typeof x === 'object') {
      for (const [k, y] of Object.entries(x)) {
        if (PERSON_KEY.test(k)) out.push(`${where}.${k}: a key for a person`);
        walk(y, `${where}.${k}`);
      }
      return;
    }
    if (typeof x === 'string' && x.includes('#')) out.push(`${where}: a '#'`);
  };
  walk(v, 'verdict');
  return out;
}

// ── The Abyss match, as the app's Riot link builds its review ───────────────
function abyssAsTheAppLinksIt() {
  const abyss = replay(load('valorant-match-abyss-13-11.json').frames, 'standard');
  const riot = load('riot-abyss-13-11.json');
  const { rounds, checks: c } = verify.reconcile(abyss.rounds, riot);
  const context = { ...abyss.context, agent: (riot.me && riot.me.agent) || abyss.context.agent };
  const agent = (riot.me && riot.me.agent) || context.agent;
  return review.served(review.build({
    rounds, context, endedBy: 'score', ai: {}, tracker: null, role: agentData.getRole(agent), history: [],
    verification: verify.describe(c), riotMe: riot.me, queue: riot.queue, riotIdSet: true, linkMissing: false,
    comps: riot.comps || null,
  }));
}
const abyss = abyssAsTheAppLinksIt();
const av = verdict.of(abyss);

ok(PERSON_KEY.test('riotId') && PERSON_KEY.test('summonerName') && PERSON_KEY.test('me') && PERSON_KEY.test('account')
  && !PERSON_KEY.test('game') && !PERSON_KEY.test('sub') && !PERSON_KEY.test('title') && !PERSON_KEY.test('mode'),
'the person detector names a Riot ID, a summoner, me and an account, and passes over the Verdict\'s own fields');
ok(!!av && av.letter === 'B' && av.score === 71 && av.provisional === false,
  'the Abyss match, linked as the app links it, is a B 71, not provisional', av && `${av.letter} ${av.score}`);
ok(!!av && av.reason === '20 of your 21 deaths went untraded.', 'its one reason is its first mistake, counted: 20 of your 21 deaths went untraded.', av && av.reason);
ok(!!av && av.right === `Abyss${DOT}13-11${DOT}Win` && av.title === 'Abyss' && av.game === 'valorant',
  'it says the map, the score and the result, Win for a Victory', av && av.right);
ok(!!av && av.sub === `Jett${DOT}Unrated`, "its agent is Riot's and its mode Riot's queue: Jett, Unrated", av && av.sub);
ok(!!av && same(av.stats, [['K/D/A', '31/21/4'], ['ACS', 382], ['ADR', 243]]),
  "Riot's numbers, and no HS: a review built from Riot's own line has no headshot share, so it is left out", av && JSON.stringify(av.stats));
ok(!!av && typeof av.at === 'number', 'it keeps when the review was made, for the date on its image');
ok(!!av && Object.keys(av).sort().join() === 'at,game,letter,provisional,reason,right,score,stats,sub,title',
  'and nothing else: game, title, right, letter, score, provisional, reason, stats, sub, at', av && Object.keys(av).join());

// ── Change 3: the trade denominator is Riot's, under riot ───────────────────
{
  const known = abyss.rounds.filter((r) => r.died && r.riot && typeof r.riot.traded === 'boolean').length;
  ok(known === 21 && abyss.rounds.every((r) => r.traded === undefined),
    "every one of the 21 deaths carries its trade under riot, and no card carries one on itself", `${known}`);
  // Since 8.7.2 the entry carries its own denominator (of), and the cards are
  // read only for an entry saved without one, as here.
  const ownOf = abyss.insights.mistakes.find((e) => e.key === 'untraded');
  ok(!!ownOf && ownOf.of === 21, 'the untraded entry carries its own denominator, 21', ownOf && `${ownOf.of}`);
  const noTrade = copy(abyss);
  for (const e of noTrade.insights.mistakes) delete e.of;
  for (const r of noTrade.rounds) if (r.riot) r.riot.traded = null;
  ok(verdict.reason(noTrade) === '20 of your deaths went untraded.',
    'with no trade known on any card the line keeps its count and says no denominator', verdict.reason(noTrade));
  const onItself = copy(noTrade);
  for (const r of onItself.rounds) if (r.died) r.traded = false;
  ok(verdict.reason(onItself) === '20 of your deaths went untraded.', 'and a trade written on the card itself is not Riot\'s, so it is not read', verdict.reason(onItself));
}

// ── 8.7.2: each line says the count it counts ───────────────────────────────
// Since 8.7.2 a traded first death and a death as the last one alive leave
// the counts. 24 verified rounds: first deaths in rounds 1 to 7 (1 to 3
// traded), deaths alone in 8 to 12, untraded deaths with mates in 13 to 16.
// Riot has 7 first deaths and 13 of 16 deaths untraded; the counts are 4 and
// 8 of 11, and the Verdict said "First to die in 4 of 24 rounds" and "8 of
// your 16 deaths went untraded", each false.
{
  const rows = [];
  for (let n = 1; n <= 24; n++) {
    const r = { n, verified: true, side: n <= 12 ? 'attacking' : 'defending', result: n % 2 ? 'won' : 'lost', died: false,
      kills: 1, firstKill: false, firstDeath: false, trades: 0, feedKnown: true };
    if (n <= 7) Object.assign(r, { died: true, firstDeath: true, traded: n <= 3, aliveAtDeath: { mates: 5, enemies: 5 }, deathSec: 10 });
    else if (n <= 12) Object.assign(r, { died: true, traded: false, aliveAtDeath: { mates: 1, enemies: 3 }, deathSec: 80 });
    else if (n <= 16) Object.assign(r, { died: true, traded: false, aliveAtDeath: { mates: 3, enemies: 3 }, deathSec: 40 });
    rows.push(r);
  }
  const base = { rounds: rows, context: { map: 'Ascent', agent: 'Sova', teamScore: 13, enemyScore: 11 }, endedBy: 'score', ai: {},
    tracker: null, role: 'Initiator', history: [], riotMe: { agent: 'Sova', kills: 24, deaths: 16, assists: 5, score: 4800, damage: 3000 },
    queue: 'competitive', riotIdSet: true };
  const rv = review.served(review.build(base));
  const only = (key) => ({ ...rv, grade: { ...rv.grade, letter: 'C' }, insights: { ...rv.insights, strengths: [], mistakes: rv.insights.mistakes.filter((e) => e.key === key) } });
  ok(verdict.reason(only('untraded')) === '8 of your 11 deaths went untraded.',
    'the untraded line takes its denominator from its own count, the deaths a teammate was alive to trade', verdict.reason(only('untraded')));
  ok(verdict.reason(only('first-death')) === 'First to die and not traded in 4 of 24 rounds.',
    'the first death line says it counts the ones nobody traded', verdict.reason(only('first-death')));
  // A review saved before 8.7.2 counted every first death, and keeps its words.
  const old = only('first-death');
  old.insights.mistakes = old.insights.mistakes.map((e) => ({ ...e, untradedOnly: undefined, detail: 'You were the first player down in 4 rounds.' }));
  ok(verdict.reason(old) === 'First to die in 4 of 24 rounds.', 'one saved before keeps the line its count was made for', verdict.reason(old));
  const ro = review.build({ ...base, source: 'riot' });
  const title = (key) => (ro.insights.facts.find((f) => f.key === key) || {}).title;
  ok(title('first-death') === 'First to die and not traded' && title('untraded') === 'Deaths not traded, a teammate alive to trade',
    'a Riot only review\'s facts are titled for what they count', `${title('first-death')} | ${title('untraded')}`);
}

// ── No Verdict without a grade ───────────────────────────────────────────────
const split = load('valorant-review-split-801.json').review;
ok(verdict.of(split) === null, 'the saved 8.0.1 Split review, too thin to grade, has no Verdict');
ok(verdict.reason(split) === '2 of your 7 deaths were at B Back.',
  "and its reason would be its first pattern's first clause, with no mistakes or facts above it", verdict.reason(split));
ok(verdict.of({ ...abyss, work: { stage: 'deaths' } }) === null, 'a review still being built (work set) has no Verdict');
ok(verdict.of({ ...abyss, grade: { ...abyss.grade, score: null } }) === null, 'nor does one with no score');
ok(verdict.of({ ...abyss, grade: { ...abyss.grade, letter: null } }) === null, 'nor one whose score has no letter beside it');
ok(verdict.of({ ...abyss, kind: 'rivals' }) === null && verdict.of({ ...abyss, kind: undefined }) === null,
  "nor a review of neither game: one game's data is never drawn under another's name");
ok(verdict.of(null) === null && verdict.reason(null) === null, 'and nothing at all gives nothing');

// ── The first clause of every pattern ────────────────────────────────────────
const TEMPLATES = [
  ['6 of your 22 deaths were at A Site, in rounds 2, 5 and 9.', '6 of your 22 deaths were at A Site.'],
  ['You were the first player to die in 6 of 24 rounds, rounds 2, 3 and 5.', 'You were the first player to die in 6 of 24 rounds.'],
  ['16 of your 21 deaths came in the first 30 seconds of the round, before any plant, in rounds 1, 2 and 3.', '16 of your 21 deaths came in the first 30 seconds of the round.'],
  ['Skye killed you 7 times, more than anyone else.', 'Skye killed you 7 times.'],
  ['You died with your ultimate ready in 2 rounds, 4, 9.', 'You died with your ultimate ready in 2 rounds.'],
  ['You lost 3 rounds in a row, rounds 6 to 8.', 'You lost 3 rounds in a row.'],
  ['Attack was your stronger side: won 3 of 5 on attack and 0 of 3 on defence.', 'Attack was your stronger side.'],
  ['On attack, won 1 of 2 rounds once the spike was down.', 'On attack, won 1 of 2 rounds once the spike was down.'],
  ['You got the first kill of the round 5 times, rounds 1, 4 and 7.', 'You got the first kill of the round 5 times.'],
];
for (const [text, want] of TEMPLATES) ok(verdict.firstClause(text) === want, `firstClause: "${want}"`, verdict.firstClause(text));
{
  const CUT = verdict.CLAUSE_CUT;
  ok(CUT.test(', in rounds 2') && CUT.test('rounds, 4, 9') && CUT.test(', more than anyone') && CUT.test(', before any plant') && CUT.test('side: won'),
    'the cut matches ", in rounds 2", ", 4", ", more than", ", before" and ": "');
  ok(!CUT.test('On attack, won 1 of 2') && !CUT.test('On defence, won 2 of 3') && !CUT.test('6 of your 22 deaths'),
    'and not "On attack, won" or a clause with no comma');
  ok(verdict.firstClause('') === null && verdict.firstClause(null) === null, 'an empty pattern has no clause');
  // On the real match: each of its patterns' first clause is the start of the
  // pattern itself, and none carries a list of rounds.
  const pats = abyss.patterns || [];
  const clauses = pats.map((p) => verdict.firstClause(p.text));
  ok(pats.length >= 3 && clauses.every((c, i) => c && pats[i].text.startsWith(c.slice(0, -1)) && !/,\s\d/.test(c)),
    `on the real match each of its ${pats.length} patterns cuts to its own first words, no round list in them`, clauses.join(' | '));
  ok(/,\s\d/.test('rounds 1, 2') && !/,\s\d/.test('6 of your 22 deaths.'), 'the round list detector matches a list and not a clause');
}

// ── The reason's order, and what is passed over ─────────────────────────────
{
  const strong = copy(abyss);
  strong.grade.letter = 'A';
  ok(verdict.reason(strong) === 'First kill of the round 3 times.' || /^First kill of the round/.test(verdict.reason(strong)),
    'for an S or an A the reason is the first strength', verdict.reason(strong));
  const firstStrength = abyss.insights.strengths[0];
  ok(firstStrength && firstStrength.key === 'first-kill' && verdict.reason(strong) === `First kill of the round ${firstStrength.count} times.`,
    "and it is the real match's own first strength, its count", firstStrength && `${firstStrength.key} ${firstStrength.count}`);

  const judged = copy(abyss);
  judged.insights.mistakes.unshift({ key: 'cause:repeek', title: 'Repeeks', detail: 'The coach looked at the moment.', rounds: [2, 5, 9], count: 3, judged: true, weight: 9 });
  ok(verdict.reason(judged) === '20 of your 21 deaths went untraded.', "an entry the coach's look judged is passed over, however it ranks", verdict.reason(judged));

  const allJudged = copy(abyss);
  allJudged.insights = { mistakes: [{ key: 'cause:dry-peek', title: 'Dry peeks', rounds: [1, 2], count: 2, judged: true }], strengths: [], missed: [] };
  allJudged.summary = 'The model wrote this sentence.';
  allJudged.focus = 'And this focus.';
  ok(verdict.reason(allJudged) === verdict.firstClause(abyss.patterns[0].text),
    'with only judged entries the reason is the first pattern\'s first clause, never the summary or the focus', verdict.reason(allJudged));
  allJudged.patterns = [];
  ok(verdict.reason(allJudged) === null && verdict.of(allJudged).reason === null,
    'and with nothing counted at all there is no reason rather than an invented one');

  const facts = copy(abyss);
  facts.source = 'riot';
  facts.insights = insights.asFacts(abyss.insights);
  ok(verdict.reason(facts) === `First kill of the round ${facts.insights.facts[0].count} times.` && facts.insights.facts[0].key === 'first-kill',
    "a match graded from Riot's record alone says Riot's first fact", verdict.reason(facts));

  const titled = copy(abyss);
  titled.insights = { mistakes: [{ key: 'same-spot', title: 'Dying at A Site', rounds: [2, 5, 9, 12], count: 4 }], strengths: [], missed: [] };
  ok(verdict.reason(titled) === 'Dying at A Site, 4 rounds.', 'an entry with no short line says its title and how many rounds', verdict.reason(titled));
  titled.insights.mistakes[0].title = 'Dying at A Site. ';
  ok(verdict.reason(titled) === 'Dying at A Site, 4 rounds.', 'a title that ends in its own stop loses it before the count', verdict.reason(titled));
  titled.insights.mistakes[0] = { key: 'scoreline', title: 'Strong scoreline', rounds: [], count: 1 };
  ok(verdict.reason(titled) === 'Strong scoreline.', 'and one with no rounds says its title alone', verdict.reason(titled));
  titled.insights.mistakes[0] = { key: 'toString', title: 'Odd key', rounds: [], count: 1 };
  ok(verdict.reason(titled) === 'Odd key.', 'a key an object inherits is no short line: "[object Object]" is never a reason', verdict.reason(titled));
}

// ── Unknown numbers are left out ─────────────────────────────────────────────
{
  const thin = copy(abyss);
  thin.scoreline.acs = null;
  const tv = verdict.of(thin);
  ok(same(tv.stats, [['K/D/A', '31/21/4'], ['ADR', 243]]), 'a number the review does not have is left out, never shown as "--"', JSON.stringify(tv.stats));
  const partKda = copy(abyss);
  partKda.scoreline.assists = undefined;
  ok(same(verdict.of(partKda).stats.map((s) => s[0]), ['ACS', 'ADR']), 'and K/D/A needs all three of its numbers');
  const none = copy(abyss);
  none.scoreline = null;
  ok(same(verdict.of(none).stats, []), 'a review with no scoreboard has a Verdict with no numbers');
  const hs = copy(abyss);
  hs.scoreline.headshotPct = 24;
  ok(same(verdict.of(hs).stats[3], ['HS', '24%']), "a tracker's headshot share is the fourth number, as a percentage");
  ok(!JSON.stringify([tv, verdict.of(partKda), verdict.of(none)]).includes('"--"'), 'no Verdict carries a "--"');
}

// ── No name, no '#' ──────────────────────────────────────────────────────────
{
  ok(leaks({ a: 'x#y' }).length === 1 && leaks({ riotId: 'x' }).length === 1 && leaks({ right: `Abyss${DOT}13-11` }).length === 0,
    'the leak walk finds a planted # and a name key, and passes a clean Verdict');
  const planted = copy(abyss);
  planted.account = 'Somebody#EUW';
  planted.game.agent = 'Jett#EUW';
  planted.game.map = 'Abyss';
  planted.insights.mistakes.unshift({ key: 'same-killer', title: 'Somebody#EUW kept winning', rounds: [1, 2, 3], count: 3 });
  const pv = verdict.of(planted);
  ok(leaks(pv).length === 0, "a review carrying a Riot ID in its account, its agent and a title gives a Verdict with no '#' in it", leaks(pv).join(', '));
  ok(pv.sub === 'Unrated' && pv.reason === '20 of your 21 deaths went untraded.', 'the string with the Riot ID is left out and the next counted line is the reason', `${pv.sub} | ${pv.reason}`);
  ok(leaks(av).length === 0, "the Abyss match's Verdict carries no name and no '#'");
}

// ── League: champion and length, no result, and never game.me ────────────────
function leagueReview() {
  const me = 'Summoner#EUW';
  const ally = 'Ally#EUW';
  const kill = (t, victim) => ({ EventName: 'ChampionKill', EventTime: t, VictimName: victim, KillerName: 'Foe#EUW' });
  const record = {
    champion: 'Ahri', mode: 'CLASSIC', role: 'Mid', me, allies: [ally], map: "Summoner's Rift",
    stats: { gameTimeSec: 1865, csAt10: 71 },
    final: { kills: 8, deaths: 6, assists: 11, cs: 212, ward: 24, level: 16 },
    // Six deaths: two just after an ally's, four with nobody near.
    events: [kill(200, me), kill(390, ally), kill(400, me), kill(600, me), kill(790, ally), kill(800, me), kill(1000, me), kill(1200, me)],
  };
  const r = lolReview.buildReview(record, []);
  r.kind = 'lol';
  r.at = Date.UTC(2026, 9, 21, 19);
  r.grade = grade.lol(r);
  r.insights = insights.lol(r);
  return r;
}
{
  const lol = leagueReview();
  let readMe = 0;
  const game = { ...lol.game, result: 'Victory' };
  delete game.me;
  Object.defineProperty(game, 'me', { enumerable: true, get() { readMe++; return 'Summoner#EUW'; } });
  const lv = verdict.of({ ...lol, game });
  ok(!!lv && lv.game === 'lol' && lv.right === `Ahri${DOT}31:05` && lv.title === 'Ahri',
    "League's Verdict says the champion and the game's length, and no result even where one is set", lv && lv.right);
  ok(readMe === 0, "and League's game.me is never read", `${readMe} reads`);
  ok(!!lv && lv.sub === `Mid${DOT}CLASSIC`, 'its sub line is the role and the mode', lv && lv.sub);
  ok(!!lv && same(lv.stats, [['K/D/A', '8/6/11'], ['CS', 212], ['CS at 10', 71], ['Ward', 24]]),
    'its numbers are K/D/A, CS, CS at 10 and Ward', lv && JSON.stringify(lv.stats));
  ok(!!lv && typeof lv.score === 'number' && lv.letter === grade.letter(lv.score), 'and its grade is the League grader\'s', lv && `${lv.letter} ${lv.score}`);
  const first = lol.insights.mistakes[0];
  ok(first && first.key === 'caught-alone' && lv.reason === first.detail && lv.reason === '4 of your 6 deaths happened with no ally dying anywhere near.',
    'its reason is its first mistake in its own counted line, never the bare title', lv && lv.reason);
  const bare = copy(lol);
  bare.insights = { mistakes: [{ key: 'skill:csAt10', title: 'CS at 10:00', detail: 'CS at 10:00', rounds: [], count: 1 }], strengths: [], missed: [] };
  ok(verdict.reason(bare) === null, 'a League skill measured without its numbers says nothing, so there is no reason', verdict.reason(bare));
  const measured = copy(lol);
  measured.insights = { mistakes: [{ key: 'skill:csAt10', title: 'CS at 10:00', detail: 'CS at 10:00: 52 this game, against your average of 61.', rounds: [], count: 1 }], strengths: [], missed: [] };
  ok(verdict.reason(measured) === 'CS at 10:00: 52 this game, against your average of 61.', 'and one measured says its number against the player\'s own average', verdict.reason(measured));
  ok(leaks(lv).length === 0 && !JSON.stringify(lv).includes('Summoner'), "and no summoner name or '#' anywhere in it", leaks(lv).join(', '));
}

// ── The player's saved reviews, the values the site shows (spec 7.2) ─────────
{
  const DIR = path.join(process.env.APPDATA || '', 'Occlara', 'reviews');
  const SAVED = [
    ['valorant-1791938248922-eq7o3v', 'A', 84, 'First kill of the round 3 times.', `Fracture${DOT}5-1${DOT}Win`, [['K/D/A', '12/3/2'], ['ACS', 569], ['ADR', 320], ['HS', '24%']], `Jett${DOT}Swiftplay`],
    ['valorant-1791775567276-l7eesy', 'B', 73, '4 of your 5 deaths went untraded.', `Sunset${DOT}2-5${DOT}Loss`, [['K/D/A', '10/5/1'], ['ACS', 406], ['ADR', 264], ['HS', '25%']], `Jett${DOT}Swiftplay`],
    ['valorant-1791154485218-610vb4', 'S', 97, 'First kill of the round 4 times.', `Abyss${DOT}3-5${DOT}Loss`, [['K/D/A', '11/5/2'], ['ACS', 417], ['ADR', 285], ['HS', '33%']], `Jett${DOT}Swiftplay`],
    ['valorant-1791156085077-nut54a', 'B', 71, '14 of your 16 deaths went untraded.', `Split${DOT}13-7${DOT}Win`, [['K/D/A', '17/16/8'], ['ACS', 279], ['ADR', 181], ['HS', '22%']], `Jett${DOT}Competitive`],
  ];
  const have = SAVED.filter(([id]) => fs.existsSync(path.join(DIR, `${id}.json`)));
  if (!have.length) console.log('skip  the four saved reviews of spec 7.2 are not on this PC');
  for (const [id, letter, score, reason, right, stats, sub] of have) {
    const raw = JSON.parse(fs.readFileSync(path.join(DIR, `${id}.json`), 'utf8'));
    const v = verdict.of(review.served(raw.review || raw));
    ok(!!v && v.letter === letter && v.score === score && v.reason === reason && v.right === right && same(v.stats, stats) && v.sub === sub,
      `saved ${id.slice(-6)}: ${letter} ${score}, "${reason}"`, v && `${v.letter} ${v.score} | ${v.reason} | ${v.right} | ${JSON.stringify(v.stats)} | ${v.sub}`);
  }
  // Every review on this PC: no name, no '#', and no word of this PC's Riot ID.
  let own = null;
  try {
    const { profileDir, configPath } = require('./profile-path');
    const cfg = JSON.parse(fs.readFileSync(configPath(profileDir(process.env.APPDATA || '')), 'utf8'));
    const id = String(cfg.riotId || '').trim();
    if (id.includes('#')) own = id.split('#').map((x) => x.trim().toLowerCase()).filter((x) => x.length >= 3);
  } catch (e) { own = null; }
  const files = fs.existsSync(DIR) ? fs.readdirSync(DIR).filter((f) => /^(valorant|lol)-.*\.json$/.test(f)) : [];
  let made = 0;
  const bad = [];
  for (const f of files) {
    let v = null;
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
      const r = raw.review || raw;
      v = verdict.of(r.kind === 'valorant' ? review.served(r) : r);
    } catch (e) { bad.push(`${f}: ${e.message}`); continue; }
    if (!v) continue;
    made++;
    const text = JSON.stringify(v).toLowerCase();
    if (leaks(v).length || (own && own.some((w) => text.includes(w)))) bad.push(f.slice(-11, -5));
  }
  if (files.length) {
    ok(!bad.length, `every Verdict of the ${made} graded reviews on this PC carries no name, no '#' and no word of its Riot ID`, bad.join(', '));
  } else {
    console.log('skip  no saved reviews on this PC');
  }
}

// ── The share image, on a stand in canvas ────────────────────────────────────
/** theme.css's :root custom properties, each with its var() resolved, as getComputedStyle gives them. */
function themeTokens() {
  const css = fs.readFileSync(THEME, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const root = /:root\s*\{([^}]*)\}/.exec(css);
  const raw = {};
  for (const m of (root ? root[1] : '').matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) raw[m[1]] = m[2].trim();
  const resolve = (v, depth) => v.replace(/var\((--[\w-]+)\)/g, (_m, n) => (depth > 8 || !(n in raw) ? '' : resolve(raw[n], depth + 1)));
  return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, resolve(v, 0)]));
}
const TOKENS = themeTokens();
ok(TOKENS['--font'] && /Geist/.test(TOKENS['--font']) && /Geist Mono/.test(TOKENS['--font-mono']) && /^#/.test(TOKENS['--bg']) && !Object.values(TOKENS).some((v) => /var\(/.test(v)),
  'the theme is read as the browser computes it: the font stacks, the ground, every var() resolved', `${Object.keys(TOKENS).length} tokens`);

function harness(opts) {
  const o = opts || {};
  const tokens = o.tokens || TOKENS;
  const calls = [];
  const texts = [];
  const canvases = [];
  const anchors = [];
  const clip = [];
  const fontsLoaded = [];
  function context2d() {
    const state = { fillStyle: '#000000', strokeStyle: '#000000', font: '10px sans-serif', letterSpacing: '0px',
      textAlign: 'start', textBaseline: 'alphabetic', lineWidth: 1, lineCap: 'butt' };
    const stack = [];
    const ctx = {
      save() { stack.push({ ...state }); },
      restore() { Object.assign(state, stack.pop() || {}); },
      scale(x, y) { calls.push(['scale', x, y]); },
      translate(x, y) { calls.push(['translate', x, y]); },
      fillRect(x, y, w, h) { calls.push(['fillRect', state.fillStyle, x, y, w, h]); },
      beginPath() {}, moveTo() {}, lineTo() {},
      stroke() { calls.push(['stroke', state.strokeStyle]); },
      fill(p) { calls.push(['fill', state.fillStyle, p && p.d]); },
      fillText(text, x, y) { texts.push({ text: String(text), font: state.font, fill: state.fillStyle, x, y, spacing: state.letterSpacing, align: state.textAlign }); },
      measureText(text) {
        const px = Number((/(\d+(?:\.\d+)?)px/.exec(state.font) || [])[1]) || 10;
        return { width: String(text).length * px * 0.6, actualBoundingBoxLeft: -px * 0.04 };
      },
    };
    for (const kind of ['createLinearGradient', 'createRadialGradient', 'createConicGradient', 'createPattern']) {
      ctx[kind] = () => { calls.push(['gradient', kind]); return { addColorStop() {} }; };
    }
    for (const k of Object.keys(state)) {
      Object.defineProperty(ctx, k, { get: () => state[k], set: (v) => { calls.push(['set', k, String(v)]); state[k] = v; } });
    }
    return ctx;
  }
  const document = {
    documentElement: {},
    body: { append(a) { anchors.push(a); } },
    fonts: { load(face) { fontsLoaded.push(face); return Promise.resolve([]); } },
    createElement(tag) {
      if (tag === 'a') return { tag, click() { this.clicked = true; }, remove() { this.removed = true; } };
      const cv = { width: 300, height: 150, ctx: null,
        getContext(kind) { if (kind !== '2d' || o.noCanvas) return null; if (!cv.ctx) cv.ctx = context2d(); return cv.ctx; },
        toBlob(cb, type) { cb({ type }); } };
      canvases.push(cv);
      return cv;
    },
  };
  const window = {};
  const sandbox = {
    window, document, console, Promise, setTimeout: (fn) => fn,
    getComputedStyle: () => ({ getPropertyValue: (name) => (name in tokens ? ` ${tokens[name]}` : '') }),
    Path2D: class { constructor(d) { this.d = d; } },
    URL: { createObjectURL: () => 'blob:occlara/1', revokeObjectURL() {} },
    ClipboardItem: class { constructor(items) { this.items = items; } },
    navigator: { clipboard: { write: async (items) => { if (o.refuse) throw new Error('denied'); clip.push(items); } } },
  };
  vm.createContext(sandbox);
  if (o.gradeView !== false) vm.runInContext(fs.readFileSync(GRADE_VIEW, 'utf8'), sandbox, { filename: 'grade-view.js' });
  vm.runInContext(fs.readFileSync(CARD, 'utf8'), sandbox, { filename: 'verdict-card.js' });
  return { VC: window.VerdictCard, calls, texts, canvases, anchors, clip, fontsLoaded, reset() { calls.length = 0; texts.length = 0; } };
}

const AT = new Date(2026, 9, 4, 18, 30).getTime();   // 4 Oct 2026, local
const ABYSS_V = { ...av, at: AT };
{
  const h = harness();
  const VC = h.VC;
  ok(!!VC && typeof VC.draw === 'function' && typeof VC.save === 'function' && typeof VC.copy === 'function',
    'verdict-card.js sets window.VerdictCard with draw, save and copy');
  ok(same(VC.SIZES, { card: { w: 1586, h: 1000 }, post: { w: 1080, h: 1350 }, discord: { w: 1200, h: 628 } }) && VC.SCALE === 2.5,
    'three sizes: the card 1586 by 1000, the post 1080 by 1350, Discord 1200 by 628, each at 2.5 times its box');
  ok(VC.MARK === 'M76.294,4.281 A50,50 0 1,0 116.705,74.274 A42,42 0 1,1 76.294,4.281 Z', 'the mark is the crescent\'s own path');
  const P = TOKENS;
  for (const size of ['card', 'post', 'discord']) {
    for (const paper of [true, false]) {
      h.reset();
      const cv = VC.draw(ABYSS_V, { size, paper });
      const where = `${size}, ${paper ? 'paper' : 'dark'}`;
      ok(cv.width === VC.SIZES[size].w && cv.height === VC.SIZES[size].h, `${where}: drawn at ${VC.SIZES[size].w} by ${VC.SIZES[size].h}`);
      const sets = h.calls.filter((c) => c[0] === 'set');
      const styled = sets.filter((c) => c[1] === 'fillStyle' || c[1] === 'strokeStyle' || c[1] === 'font');
      ok(!styled.some((c) => /var\(/.test(c[2])), `${where}: no var() in any fillStyle, strokeStyle or font`, styled.filter((c) => /var\(/.test(c[2])).map((c) => c[2]).join(', '));
      ok(!h.calls.some((c) => c[0] === 'gradient'), `${where}: no gradient and no pattern`);
      const fontsUsed = [...new Set(sets.filter((c) => c[1] === 'font').map((c) => c[2]))];
      const weightOk = (f) => (f.includes(P['--font-mono']) ? /^500 /.test(f) : f.includes(P['--font']) && /^(500|600) /.test(f));
      ok(fontsUsed.length && fontsUsed.every(weightOk), `${where}: Geist 500 and 600 and Geist Mono 500 only, the token stacks`, fontsUsed.filter((f) => !weightOk(f)).join(' | '));
      const said = h.texts.map((x) => x.text);
      const want = ['VERDICT', `ABYSS${DOT}13-11${DOT}WIN`, 'B', '71', '/100', 'K/D/A', '31/21/4', 'ACS', '382', 'ADR', '243', `JETT${DOT}UNRATED`, 'occlara.app', '4 OCT 2026'];
      ok(want.every((w) => said.includes(w)), `${where}: VERDICT, the right line, the letter, the score, /100, the numbers, the sub line, occlara.app and the date`,
        want.filter((w) => !said.includes(w)).join(', '));
      const reasonText = h.texts.filter((x) => /^500 /.test(x.font) && x.font.includes(P['--font'])).map((x) => x.text).join(' ');
      ok(reasonText === ABYSS_V.reason, `${where}: the reason, in Geist 500, every word of it`, reasonText);
      ok(!said.includes('HS') && !said.includes('--') && !said.includes('PROVISIONAL') && !said.some((s) => s.includes('#')),
        `${where}: no HS (the review has none), no "--", no PROVISIONAL on a grade that is not, no '#'`);
      const ground = h.calls.find((c) => c[0] === 'fillRect');
      ok(ground && ground[1] === (paper ? P['--paper'] || '#E9EBF0' : P['--bg']) && ground[2] === 0 && ground[3] === 0,
        `${where}: the ground is ${paper ? '--paper' : '--bg'}`, ground && ground[1]);
      const letter = h.texts.find((x) => x.text === 'B');
      ok(letter && letter.fill === (paper ? P['--paper-ink'] || '#0A0B0E' : P['--text']) && /^600 /.test(letter.font),
        `${where}: the B in Geist 600, ${paper ? 'ink on paper' : 'ink on the dark ground, a B is neutral'}`, letter && `${letter.fill} ${letter.font}`);
      const scales = h.calls.filter((c) => c[0] === 'scale');
      ok(scales.length >= 2 && scales.every((c) => c[1] === c[2]), `${where}: every scale is the same on both axes, so the mark is never stretched`);
      ok(h.calls.some((c) => c[0] === 'fill' && c[2] === VC.MARK), `${where}: the mark is drawn from its path`);
      ok(h.calls.filter((c) => c[0] === 'stroke').length === 1, `${where}: the four corner brackets, as lines`);
    }
  }
  h.reset();
  ok(VC.draw(ABYSS_V).width === 1586 && h.calls.find((c) => c[0] === 'fillRect')[1] === (TOKENS['--paper'] || '#E9EBF0'), 'with no options it is the card on paper');
  h.reset();
  VC.draw(ABYSS_V, { size: 'billboard' });
  ok(h.canvases[h.canvases.length - 1].width === 1586, 'an unknown size is the card');

  // The letter's tone, dark, by the one grade colour rule; on paper, ink.
  const toneCases = [['S', 97, '--good'], ['A', 84, '--good'], ['B', 71, '--text'], ['C', 61, '--warn'], ['D', 52, '--bad']];
  for (const [letter, score, token] of toneCases) {
    h.reset();
    VC.draw({ ...ABYSS_V, letter, score }, { paper: false });
    const dark = h.texts.find((x) => x.text === letter);
    h.reset();
    VC.draw({ ...ABYSS_V, letter, score }, { paper: true });
    const light = h.texts.find((x) => x.text === letter);
    ok(dark && dark.fill === TOKENS[token] && light && light.fill === (TOKENS['--paper-ink'] || '#0A0B0E') && h.texts.some((x) => x.text === String(score)),
      `${letter} ${score}: ${token} on the dark ground, ink on paper, the number beside it`, `${dark && dark.fill} / ${light && light.fill}`);
  }
  const bare = harness({ gradeView: false });
  bare.VC.draw({ ...ABYSS_V, letter: 'D', score: 52 }, { paper: false });
  const bareD = bare.texts.find((x) => x.text === 'D');
  ok(bareD && bareD.fill === TOKENS['--text'], 'without GradeView the letter is ink: the card keeps no grade colour table of its own', bareD && bareD.fill);
  const COPY = /letter\s*===\s*'[SABCD]'/;
  ok(COPY.test("v.letter === 'S'") && !COPY.test(fs.readFileSync(CARD, 'utf8')), 'and none is written in it (the detector matches a copy)');

  // PROVISIONAL, and a long reason cut with an ellipsis.
  const LONG = 'Died with the team up in numbers in 6 lost rounds, and then again in the overtime rounds after that, which is a long line to wrap on any card at all.';
  for (const [size, lines] of [['card', 2], ['post', 3], ['discord', 2]]) {
    h.reset();
    VC.draw({ ...ABYSS_V, provisional: true, reason: LONG }, { size });
    const reasonLines = h.texts.filter((x) => /^500 /.test(x.font) && x.font.includes(TOKENS['--font']) && !x.font.includes(TOKENS['--font-mono']));
    ok(reasonLines.length === lines && reasonLines[lines - 1].text.endsWith('…'), `${size}: a long reason wraps to ${lines} lines, the last cut with an ellipsis`,
      reasonLines.map((x) => x.text).join(' / '));
    ok(h.texts.some((x) => x.text === 'PROVISIONAL'), `${size}: PROVISIONAL when the grade is`);
  }
  // The cut line loses the punctuation it ends on before its ellipsis, and
  // keeps a word that ends in none. The stand in measures 9 a letter at
  // 15px, so the card's 300 holds 33: three words of ten to a line.
  const w10 = 'aaaaaaaaaa';
  h.reset();
  VC.draw({ ...ABYSS_V, reason: `${w10} ${w10} ${w10} ${w10} ${w10} aaaaaaaaa, ${w10} ${w10}` });
  const cutComma = h.texts.filter((x) => /^500 15px /.test(x.font)).map((x) => x.text);
  h.reset();
  VC.draw({ ...ABYSS_V, reason: `${w10} ${w10} ${w10} ${w10} ${w10} ${w10} ${w10} ${w10}` });
  const cutWord = h.texts.filter((x) => /^500 15px /.test(x.font)).map((x) => x.text);
  ok(cutComma[1] === `${w10} ${w10} aaaaaaaaa…` && cutWord[1] === `${w10} ${w10} ${w10}…`,
    'a cut line drops the comma it ends on before the ellipsis, and a whole word keeps every letter', `${cutComma[1]} / ${cutWord[1]}`);
  h.reset();
  VC.draw(ABYSS_V);
  const markAt = h.calls.find((c) => c[0] === 'translate');
  ok(markAt && Math.abs(markAt[1] + 14 * (21 / 120) - 32) < 1e-9, "the crescent's ink stands on the left margin, where the letter and the reason start", markAt && markAt[1]);
  const bigB = h.texts.find((x) => x.text === 'B');
  ok(bigB && bigB.spacing === `${Number((112 * parseFloat(TOKENS['--track-display'] || '-0.02em')).toFixed(2))}px`,
    'the letter is tracked at --track-display', bigB && bigB.spacing);
  h.reset();
  VC.draw({ ...ABYSS_V, reason: null, stats: [], sub: '' });
  ok(!h.texts.some((x) => x.text === '' || x.text === 'null') && h.texts.some((x) => x.text === 'B'), 'with no reason, no numbers and no sub line it draws the rest and nothing empty');
  h.reset();
  VC.draw({ ...ABYSS_V, at: null });
  ok(!h.texts.some((x) => /\d{4}$/.test(x.text) && /OCT|SEP|NOV/.test(x.text)), 'with no date it draws none');
  h.reset();
  VC.draw({ ...ABYSS_V, right: 'Abyss · Somebody#EUW', stats: [['K/D/A', '1/2/3'], ['ACS', null], ['ADR', 99]] });
  ok(!h.texts.some((x) => x.text.includes('#')) && !h.texts.some((x) => x.text === 'ACS') && h.texts.some((x) => x.text === 'ADR'),
    "a string with a '#' is never drawn, and a number given as null is left out with its label");

  // The tokens, read off :root; a var() never reaches the canvas.
  const broken = harness({ tokens: { ...TOKENS, '--paper': 'var(--nowhere)', '--text': 'var(--ink)', '--track-label': '1px', '--font-mono': '' } });
  broken.VC.draw(ABYSS_V, { paper: true });
  const g2 = broken.calls.find((c) => c[0] === 'fillRect');
  ok(g2 && g2[1] === '#E9EBF0', 'a token that still reads as a var() gives its fallback, the token\'s own value', g2 && g2[1]);
  broken.reset();
  broken.VC.draw(ABYSS_V, { paper: false });
  ok(broken.texts.find((x) => x.text === 'B').fill === '#F5F5F7', 'the same for the ink on the dark ground');
  const verdictLabel = broken.texts.find((x) => x.text === 'VERDICT');
  ok(verdictLabel && verdictLabel.spacing === '0.88px' && /Geist Mono/.test(verdictLabel.font),
    'a tracking token that is not in ems gives the app\'s 0.08em, and a missing mono stack its fallback', verdictLabel && `${verdictLabel.spacing} ${verdictLabel.font}`);
  const good = harness();
  good.VC.draw(ABYSS_V);
  const vl = good.texts.find((x) => x.text === 'VERDICT');
  ok(vl && vl.spacing === `${Number((11 * parseFloat(TOKENS['--track-label'] || '0.08em')).toFixed(2))}px`,
    'labels are tracked at --track-label', vl && vl.spacing);

  // The file name, the date, the faces, Save and Copy.
  const day = (at) => { const d = new Date(at); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  ok(VC.fileName(ABYSS_V) === `occlara-verdict-abyss-71-${day(AT)}.png`, 'Save names it occlara-verdict-<map>-<score>-<yyyy-mm-dd>.png', VC.fileName(ABYSS_V));
  ok(VC.fileName({ title: "Kai'Sa", score: 64, at: null }) === 'occlara-verdict-kai-sa-64.png' && VC.fileName({ title: 'Somebody#EUW', score: 50 }) === 'occlara-verdict-match-50.png'
    && VC.fileName({}) === 'occlara-verdict-match.png', 'a champion with an apostrophe, a name with a #, and nothing at all', [VC.fileName({ title: "Kai'Sa", score: 64 }), VC.fileName({ title: 'Somebody#EUW', score: 50 })].join(', '));
  ok(VC.fileName({ title: ' Lotus! ', score: 70 }) === 'occlara-verdict-lotus-70.png' && VC.fileName({ title: 'Abyss', score: 71 }) === 'occlara-verdict-abyss-71.png',
    'the name loses the marks around a word and keeps a plain one whole', VC.fileName({ title: ' Lotus! ', score: 70 }));
  ok(VC.dateLabel(AT) === '4 Oct 2026' && VC.dateLabel(null) === null, 'the date reads 4 Oct 2026, drawn in capitals');
  (async () => {
    const r = harness();
    await r.VC.ready();
    const F = TOKENS;
    ok(r.fontsLoaded.length === 3 && r.fontsLoaded.includes(`600 40px ${F['--font']}`) && r.fontsLoaded.includes(`500 40px ${F['--font']}`)
      && r.fontsLoaded.includes(`500 20px ${F['--font-mono']}`), 'ready() loads Geist 600 and 500 and Geist Mono 500 before drawing', r.fontsLoaded.join(' | '));
    const s = harness();
    const saved = await s.VC.save(ABYSS_V, { size: 'post', paper: false });
    const a = s.anchors[0];
    ok(saved === true && a && a.download === `occlara-verdict-abyss-71-${day(AT)}.png` && a.href === 'blob:occlara/1' && a.clicked && a.removed,
      'Save hands the PNG over as a download from a blob URL, under its name', a && `${a.download} ${a.href}`);
    ok(s.canvases.some((c) => c.width === 1080 && c.height === 1350), 'at the size asked for');
    ok(s.fontsLoaded.length === 3, 'and only once the three faces are loaded', `${s.fontsLoaded.length}`);
    const copied = await r.VC.copy(ABYSS_V);
    const item = r.clip[0] && r.clip[0][0];
    ok(copied === true && item && item.items && item.items['image/png'] && item.items['image/png'].type === 'image/png',
      'Copy puts an image/png ClipboardItem on the clipboard');
    const odd = harness();
    ok(await odd.VC.copy({ ...ABYSS_V, stats: 'not a list' }) === true, 'a Verdict with no list of numbers still copies, its numbers left out');
    // A clipboard that refuses, and a canvas that cannot draw: false, never a throw.
    const refused = harness({ refuse: true });
    ok(await refused.VC.copy(ABYSS_V) === false && await refused.VC.save(ABYSS_V) === true,
      'a clipboard that refuses makes Copy false, and Save still works');
    const blind = harness({ noCanvas: true });
    ok(await blind.VC.copy(ABYSS_V) === false && await blind.VC.save(ABYSS_V) === false && !blind.anchors.length,
      'a canvas that cannot draw makes both false, and nothing is handed over');
    const src = fs.readFileSync(CARD, 'utf8');

    // No channel, no network, and none of the signal's tokens.
    const SIGNAL = /--(?:red|signal|glow-red)\b/;
    const NET = /ipcRenderer|window\.occlara|\bfetch\(|XMLHttpRequest|WebSocket|sendBeacon|https?:\/\//;
    ok(SIGNAL.test('color: var(--red);') && SIGNAL.test('var(--signal-rgb)') && !SIGNAL.test('var(--text-dim)')
      && NET.test("fetch('x')") && NET.test('https://occlara.app') && !NET.test('occlara.app'),
    'the signal and network detectors match a positive and pass a negative');
    ok(!SIGNAL.test(src) && !NET.test(src), 'verdict-card.js names no channel, no network call, no URL and none of the signal\'s tokens');
    ok(!/require\(/.test(fs.readFileSync(path.join(ROOT, 'src', 'shared', 'verdict.js'), 'utf8')), 'verdict.js requires nothing: pure');

    console.log(`\n${fails ? 'FAIL' : 'PASS'}: ${checks - fails} of ${checks} checks`);
    process.exit(fails ? 1 : 0);
  })().catch((e) => { console.log(`FAIL  ${e && e.stack}`); process.exit(1); });
}

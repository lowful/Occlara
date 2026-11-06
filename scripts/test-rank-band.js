'use strict';

/**
 * The player's rank band (8.8): src/shared/rank-band.js, which main sends with
 * the review, the look and Ask Coach, and the server halves that read it.
 *
 * The band is derived from what main already holds (the rank history's newest
 * rated game, the tracker profile's rank, its peak) and is one of four keys or
 * nothing. Nothing must be today's request byte for byte, and the server must
 * read an unknown word as nothing. Both halves are asserted here: the pure
 * derivation with its edge cases (unrated, unknown words, a promotion), and
 * each server reader dropping a band it does not know.
 *
 * Run: npm run test:rank-band
 */

const path = require('path');
const rb = require(path.join(__dirname, '..', 'src', 'shared', 'rank-band.js'));
const knowledge = require(path.join(__dirname, '..', 'server', 'services', 'knowledge.js'));
const review = require(path.join(__dirname, '..', 'server', 'services', 'match-review.js'));
const forensics = require(path.join(__dirname, '..', 'server', 'services', 'death-forensics.js'));
const chat = require(path.join(__dirname, '..', 'server', 'services', 'chat-prompt.js'));

let fails = 0;
const ok = (cond, what) => { if (!cond) { fails++; console.log(`FAIL  ${what}`); } else console.log(`ok    ${what}`); };

// ── The four keys, the same everywhere ─────────────────────────────────────
const KEYS = ['iron_bronze', 'silver_gold', 'plat_diamond', 'asc_plus'];
ok(JSON.stringify(rb.BANDS) === JSON.stringify(KEYS), 'the client has the four bands, in ladder order');
ok(JSON.stringify(knowledge.RANK_BANDS) === JSON.stringify(KEYS), 'and the server retrieval has the same four');
ok(JSON.stringify(chat.RANK_BANDS) === JSON.stringify(KEYS), 'and Ask Coach has the same four');
ok(KEYS.every((k) => forensics.BAND_WORDS[k]) && Object.keys(forensics.BAND_WORDS).length === 4, 'and the look words each of them');

// ── Every tier to its band ─────────────────────────────────────────────────
const TIERS = {
  'Iron 1': 'iron_bronze', 'Iron 3': 'iron_bronze', 'Bronze 2': 'iron_bronze',
  'Silver 1': 'silver_gold', 'Gold 3': 'silver_gold',
  'Platinum 1': 'plat_diamond', 'Diamond 3': 'plat_diamond',
  'Ascendant 1': 'asc_plus', 'Immortal 2': 'asc_plus', 'Radiant': 'asc_plus',
};
for (const [tier, band] of Object.entries(TIERS)) ok(rb.bandOfTier(tier) === band, `"${tier}" is ${band}`);
ok(rb.bandOfTier('gold 2') === 'silver_gold' && rb.bandOfTier('  IMMORTAL 3 ') === 'asc_plus', 'case and spaces do not matter');

// ── What is no tier ────────────────────────────────────────────────────────
for (const word of ['Unranked', 'Unrated', '', 'Goldfish', 'Silver Surfer', 'Gold 4', 'Diamond 0', 'rank 5', 'Radiant 2x',
  'Immortal#EUW', 'iron_bronze', '<script>']) {
  ok(rb.bandOfTier(word) === null, `"${word}" is no tier`);
}
for (const v of [null, undefined, 3, {}, ['Gold 2'], true]) ok(rb.bandOfTier(v) === null, `${JSON.stringify(v)} is no tier`);

// ── The order the sources are read in ──────────────────────────────────────
ok(rb.rankBand({ current: 'Platinum 1', rank: 'Gold 3', peak: 'Gold 3' }) === 'plat_diamond',
  'a promotion: the history\'s newest game leads a tracker profile that has not caught up');
ok(rb.rankBand({ current: 'Gold 3', rank: 'Platinum 1', peak: 'Platinum 1' }) === 'silver_gold',
  'a demotion reads the same way, the newest game wins');
ok(rb.rankBand({ current: null, rank: 'Diamond 2', peak: 'Ascendant 1' }) === 'plat_diamond',
  'no history: the tracker\'s current rank, not the peak');
ok(rb.rankBand({ current: null, rank: 'Unranked', peak: 'Immortal 1' }) === 'asc_plus',
  'unrated this act: the peak stands in');
ok(rb.rankBand({ current: 'Unrated', rank: 'Unranked', peak: null }) === null, 'unrated with no peak is no band');
ok(rb.rankBand({ current: 'Mystery', rank: 'Gold 9', peak: 'Champion' }) === null, 'words this file does not know are no band');
ok(rb.rankBand({}) === null && rb.rankBand(null) === null && rb.rankBand('Gold 2') === null, 'nothing held is no band');

// ── validBand, the reader's gate ───────────────────────────────────────────
for (const k of KEYS) ok(rb.validBand(k) === k && knowledge.validBand(k) === k, `${k} passes both gates`);
for (const v of ['gold', 'Silver_Gold', 'asc', 'diamond', '', null, 7, ['asc_plus']]) {
  ok(rb.validBand(v) === null && knowledge.validBand(v) === null, `${JSON.stringify(v)} is no band on either side`);
}

// ── The server reads an unknown band as nothing ────────────────────────────
const body = (extra) => ({
  rounds: [{ n: 1, side: 'attacking', result: 'lost', died: true }, { n: 2, side: 'attacking', result: 'won' }, { n: 3, side: 'attacking', result: 'won' }],
  context: { agent: 'Jett', map: 'Ascent', ...extra },
  final: { team: 2, enemy: 1 },
});
const plain = review.normalise(body({}));
ok(!('rankBand' in plain.context), 'the review reads no band from a client that sends none');
ok(JSON.stringify(review.normalise(body({ rankBand: 'radiant' }))) === JSON.stringify(plain), 'a band it does not know is read as none, byte for byte');
ok(review.normalise(body({ rankBand: 'silver_gold' })).context.rankBand === 'silver_gold', 'a real band is kept');
{
  // retrieve() jitters near ties, so both prompts are built on one fixed draw.
  const random = Math.random;
  Math.random = () => 0.5;
  try {
    ok(review.buildPrompt({ ...plain, variant: 'C' }) === review.buildPrompt({ ...review.normalise(body({ rankBand: 'Gold 2' })), variant: 'C' }),
      'and the review prompt with an unknown band is today\'s');
  } finally {
    Math.random = random;
  }
}
const withBand = review.buildPrompt({ ...review.normalise(body({ rankBand: 'silver_gold' })), variant: 'C' });
ok(/PLAYER LEVEL: the player is ranked Silver or Gold\./.test(withBand) && !/PLAYER LEVEL/.test(review.buildPrompt({ ...plain, variant: 'C' })),
  'a known band adds the level line, and only then');

const look = (extra) => ({ agent: 'Jett', map: 'Ascent', source: 'riot', deaths: [{ n: 2, side: 'attacking', frames: ['aGVsbG8='] }], ...extra });
const lookPlain = forensics.normalise(look({}));
ok(!('rankBand' in lookPlain), 'the look reads no band from a client that sends none');
ok(JSON.stringify(forensics.normalise(look({ rankBand: 'immortal' }))) === JSON.stringify(lookPlain), 'and an unknown band as none');
ok(forensics.rankRule(lookPlain) === '' && /ranked Platinum or Diamond/.test(forensics.rankRule(forensics.normalise(look({ rankBand: 'plat_diamond' })))),
  'the look\'s level rule is there only with a band');

const chatPlain = chat.normalise({ game: 'valorant' });
ok(!('rankBand' in chatPlain), 'Ask Coach reads no band from a client that sends none');
ok(JSON.stringify(chat.normalise({ game: 'valorant', rankBand: 'Diamond 2' })) === JSON.stringify(chatPlain), 'and an unknown band as none');
ok(chat.normalise({ game: 'valorant', rankBand: 'asc_plus' }).rankBand === 'asc_plus', 'a real band is kept');
ok(!/rank band/.test(chat.renderPlayer(chatPlain)) && /Their rank band: Iron or Bronze\./.test(chat.renderPlayer(chat.normalise({ game: 'valorant', rankBand: 'iron_bronze' }))),
  'the player facts name the band only when one came');

// ── No dash and no semicolon in any line the band adds ─────────────────────
const added = [
  ...KEYS.map((k) => review.rankRule(k)),
  ...KEYS.map((k) => forensics.rankRule({ rankBand: k })),
  ...KEYS.map((k) => chat.renderPlayer(chat.normalise({ game: 'valorant', rankBand: k }))),
].join('\n');
const DASH = new RegExp('[' + String.fromCharCode(0x2013, 0x2014) + ']');
ok(!DASH.test(added) && !/;/.test(added), 'the band lines carry no dash and no semicolon');

// ── What main reads the band from: the rank history it already holds ──────
// RankHistory.held (src/main/services/rank-history.js) answers the held
// history for the Riot ID in Settings with no request, and nothing for any
// other Riot ID, so a switched account never sends the old one's band.
(async () => {
  const { RankHistory } = require(path.join(__dirname, '..', 'src', 'main', 'services', 'rank-history.js'));
  let asked = 0;
  const h = new RankHistory({ get: async () => { asked++; return { ok: true, data: { points: [{ tier: 'Gold 3' }, { tier: 'Platinum 1' }], current: { tier: 'Platinum 1' } } }; } });
  ok(h.held('Me#EUW') === null, 'nothing held before a read');
  await h.read('Me#EUW');
  const n = asked;
  const held = h.held('Me#EUW');
  ok(held && held.current.tier === 'Platinum 1' && asked === n, 'after a read the history is held, and held() asks nothing');
  ok(h.held('Other#EUW') === null && h.held('') === null, 'and another Riot ID gets nothing');
  ok(rb.rankBand({ current: held.current.tier, rank: 'Gold 3', peak: 'Gold 3' }) === 'plat_diamond', 'so the promotion in the history is the band sent');
  h.clear();
  ok(h.held('Me#EUW') === null, 'cleared, nothing is held');
})().catch((e) => ok(false, `the rank history check threw: ${e.message}`)).then(() => finish());

// ── check:playbook holds a note's ranks to the four keys ───────────────────
// Planted through CHECK_PLAYBOOK_PLANT (check:primer's hook): a misspelled
// band, a band listed twice, an empty list and a list that is not one must
// each fail the run, and the corpus as it is passes.
{
  const fs = require('fs');
  const os = require('os');
  const { spawnSync } = require('child_process');
  const run = (notes) => {
    const file = path.join(os.tmpdir(), `occlara-rank-plant-${process.pid}-${Math.random().toString(36).slice(2)}.json`);
    fs.writeFileSync(file, JSON.stringify(notes));
    try {
      return spawnSync(process.execPath, [path.join(__dirname, 'check-playbook.js')], { encoding: 'utf8', env: { ...process.env, CHECK_PLAYBOOK_PLANT: file } });
    } finally {
      fs.unlinkSync(file);
    }
  };
  const clean = spawnSync(process.execPath, [path.join(__dirname, 'check-playbook.js')], { encoding: 'utf8' });
  ok(clean.status === 0, 'check:playbook passes the corpus as it is');
  const bad = [
    [{ text: 'Planted control note one for the rank check.', ranks: ['gold'] }, 'rank band "gold"', 'misspell a band'],
    [{ text: 'Planted control note two for the rank check.', ranks: ['asc_plus', 'asc_plus'] }, 'lists a rank band twice', 'list a band twice'],
    [{ text: 'Planted control note three for the rank check.', ranks: [] }, 'ranks is an empty array', 'are an empty list'],
    [{ text: 'Planted control note four for the rank check.', ranks: 'silver_gold' }, 'ranks must be an array', 'are not a list'],
  ];
  for (const [note, want, label] of bad) {
    const r = run([note]);
    ok(r.status === 1 && r.stdout.includes(want), `check:playbook fails a planted note whose ranks ${label}`);
  }
  const good = run([{ text: 'Planted control note five for the rank check.', ranks: ['iron_bronze', 'silver_gold'] }]);
  ok(good.status === 0, 'and passes one whose ranks are real bands');
  // enemyHint (8.8): the soft enemy tag is held to the game's agents, and
  // never sits beside a strict one.
  const hintBad = run([{ text: 'Planted control note six for the hint check.', enemyHint: ['Hushh'] }]);
  const hintBoth = run([{ text: 'Planted control note seven for the hint check.', enemyHint: ['Hush'], enemyAgents: ['Hush'] }]);
  const hintGood = run([{ text: 'Planted control note eight for the hint check.', enemyHint: ['Hush'] }]);
  ok(hintBad.status === 1 && hintBad.stdout.includes('enemyHint names unknown agent "Hushh"')
    && hintBoth.status === 1 && hintBoth.stdout.includes('carries enemyHint beside enemyAgents') && hintGood.status === 0,
  'check:playbook fails an enemyHint with an unknown agent or beside enemyAgents, and passes a real one');
}

// THE WORKED CASES (8.8) carry the same four bands, and are served by them
// exactly as notes: at every band no case above it, whatever the situation.
{
  const cases = require(path.join(__dirname, '..', 'server', 'services', 'cases.js'));
  ok(cases.size() > 100 && cases.all().every((c) => c.ranks.length && c.ranks.every((r) => rb.BANDS.includes(r))),
    'every worked case lists real bands, the client\'s four');
  const everything = { agent: 'Sova', map: 'Haven', sides: ['attack', 'defense'], advanced: true,
    phases: ['early', 'mid', 'execute', 'postplant', 'retake', 'clutch', 'late'], economies: ['pistol', 'antieco', 'lostpistol'],
    causes: ['dry-peek', 'isolated', 'repeek', 'crossfire', 'rotating', 'overextend', 'exposed', 'lost-duel'],
    patterns: ['early', 'spot', 'ult', 'streak', 'postplant', 'retake'], enemies: ['Chamber', 'Killjoy', 'Omen', 'Jett', 'Cypher'] };
  let above = 0;
  for (const band of rb.BANDS) {
    for (const { c } of cases.scored({ ...everything, rankBand: band })) if (rb.BANDS.indexOf(c.minBand) > rb.BANDS.indexOf(band)) above++;
  }
  ok(above === 0, `at every band no case above it is served (${above})`);
  ok(cases.scored({ ...everything, rankBand: 'Gold 2' }).length === cases.scored(everything).length,
    'and a band no key matches is no band');
}

// THE ADVANCED RESERVE FOLLOWS THE BAND (8.8, knowledge.ADVANCED_SLOTS_BY_BAND):
// one of eight at Iron and Bronze, two at Silver and Gold, today's six from
// Platinum, keyed by the client's own four bands, and a band no key matches
// is today's reserve with the same notes and draws.
{
  const S = knowledge.ADVANCED_SLOTS_BY_BAND;
  ok(JSON.stringify(Object.keys(S)) === JSON.stringify(rb.BANDS), 'the reserve has a share for each of the client\'s four bands, in order');
  ok(rb.BANDS.every((b, i) => i === 0 || S[b] >= S[rb.BANDS[i - 1]]) && S.iron_bronze < S.plat_diamond,
    `the share grows with the band (${rb.BANDS.map((b) => S[b]).join(', ')})`);
  const adv = new Set(knowledge.all().filter((n) => n.tier === 'advanced').map((n) => n.text));
  const seeded = (fn) => { const random = Math.random; let x = 3, d = 0; Math.random = () => { d++; x = (x * 16807) % 2147483647; return x / 2147483647; }; try { return { out: fn(), d }; } finally { Math.random = random; } };
  const ctx = { agent: 'Reyna', map: 'Sunset', side: 'attacking', phase: 'buy', playerCredits: 1500, roundNumber: 4 };
  for (const band of rb.BANDS) {
    const got = knowledge.retrieve({ ...ctx, rankBand: band }, 8, { advanced: true }).filter((t) => adv.has(t)).length;
    ok(got <= S[band], `an eco at ${band} with Advanced coaching on is served ${got} advanced notes of at most ${S[band]}`);
  }
  const none = seeded(() => knowledge.retrieve(ctx, 8, { advanced: true }));
  ok(['Gold 2', 'immortal', '', null].every((b) => JSON.stringify(seeded(() => knowledge.retrieve({ ...ctx, rankBand: b }, 8, { advanced: true }))) === JSON.stringify(none)),
    'a band no key matches gets today\'s reserve, the same notes and draws');
}

function finish() {
  console.log(fails ? `\n${fails} rank band check(s) failed` : '\nall rank band checks passed');
  process.exit(fails ? 1 : 0);
}

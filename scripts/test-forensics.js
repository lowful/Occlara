'use strict';

/**
 * Death forensics, the half that can be checked offline: the request is
 * bounded, the reply is parsed to one label from the list, and every sentence
 * passes the map, ability and killer gates or is dropped.
 *
 * Every gate is asserted against a sentence it must catch AND one it must let
 * through, because a regex that only ever proved it matches will also match
 * ordinary English, which in this repo has happened with "a" three times.
 *
 * Run: npm run test:forensics
 */

const df = require('../server/services/death-forensics');

let fails = 0;
let checks = 0;
const ok = (cond, what) => {
  checks++;
  if (!cond) { fails++; console.log(`FAIL  ${what}`); } else console.log(`ok    ${what}`);
};

const frame = 'x'.repeat(5000);
const input = df.normalise({
  agent: 'Jett', map: 'Abyss',
  deaths: [
    { n: 2, side: 'defending', sec: 14, killer: 'Viper', weapon: 'Marshal', firstDeath: true, traded: false,
      alive: { mates: 5, enemies: 5 }, frames: [frame, frame, frame] },
    { n: 3, frames: [] },
    { n: 4, frames: ['short'] },
    { n: 5, frames: [frame] }, { n: 6, frames: [frame] }, { n: 7, frames: [frame] }, { n: 8, frames: [frame] },
  ],
});

// ── The request is bounded ──────────────────────────────────────────────────
ok(input.deaths.length === 4, `at most four deaths are read, and one with no usable frame is dropped (${input.deaths.map((d) => d.n)})`);
ok(input.deaths[0].frames.length === 2, 'at most two frames a death');
const d2 = input.deaths[0];

// ── The prompt carries Riot's facts and the closed lists ─────────────────────
const prompt = df.buildPrompt(input, d2);
ok(/Killed by Viper with a Marshal/.test(prompt) && /first death of the round/i.test(prompt), 'Riot\'s facts are in the prompt');
ok(/not traded/.test(prompt) && /5 of their team, player included, against 5/.test(prompt), 'and the trade and the numbers standing');
ok(/tailwind|updraft|cloudburst|blade storm/i.test(prompt), 'the player\'s own kit is listed');
ok(Object.keys(df.CAUSES).every((c) => prompt.includes(c + ':')), 'every cause label is offered');
ok(!/[\u2013\u2014]/.test(prompt), 'no dashes in the prompt');

// ── Parsing ─────────────────────────────────────────────────────────────────
const good = df.parse('```json\n{"cause": "dry-peek", "what": "You swung wide into mid with no utility thrown", "better": "Dash in behind a cloudburst or wait for the flash."}\n```', input, d2);
ok(good.cause === 'dry-peek' && /no utility thrown\.$/.test(good.what) && good.better, `a clean reply parses (${good.cause})`);
ok(df.parse('{"cause": "Dry Peek", "what": "You peeked.", "better": "Wait."}', input, d2).cause === 'dry-peek', 'a label in words is normalised');
ok(df.parse('{"cause": "bad luck", "what": "You peeked.", "better": "Wait."}', input, d2).cause === 'unclear', 'a label off the list is unclear, never invented');
ok(df.parse('I think you dry peeked.', input, d2).cause === 'unclear', 'no JSON is unclear');
ok(df.parse('{"cause": "lost-duel", "what": "", "better": ""}', input, d2).cause === 'lost-duel', 'a lost duel needs no explanation');
ok(df.parse('{"cause": "isolated", "what": "", "better": "Stay near your team."}', input, d2).cause === 'unclear',
  'a mistake with no surviving sentence is not counted against the player');
ok(!/\u2014/.test(df.parse('{"cause": "isolated", "what": "You held alone \u2014 too far out.", "better": "x."}', input, d2).what || ''),
  'dashes are turned into commas');

// ── The map gate ────────────────────────────────────────────────────────────
ok(df.wrongMap('You died holding Hookah alone.', 'Abyss') === 'hookah', 'Hookah on Abyss is caught');
ok(df.wrongMap('You died holding Hookah alone.', 'Bind') === null, 'Hookah on Bind is allowed');
ok(df.wrongMap('You held the A site doorway alone.', 'Abyss') === null, 'a site and a doorway are not callouts of another map');
const onBind = df.parse('{"cause": "isolated", "what": "You held Hookah alone.", "better": "Play closer to A Main."}', input, d2);
ok(onBind.what === null && onBind.cause === 'unclear', 'the sentence is dropped, and with it the unexplained label');

// ── The ability gate ────────────────────────────────────────────────────────
ok(df.foreignAbility('Use your updraft to take the high ground.', 'Jett') === null, 'Jett\'s own Updraft is allowed');
ok(!!df.foreignAbility('Throw a recon bolt before you peek.', 'Jett'), 'Sova\'s Recon Bolt on Jett is caught');
ok(df.foreignAbility('The Sova recon bolt found you before the peek.', 'Jett') === null,
  'naming the enemy\'s ability with its owner is allowed');

// ── The killer gate ─────────────────────────────────────────────────────────
ok(df.wrongKiller('Omen killed you from behind.', 'Viper') === 'Omen', 'the wrong killer is caught');
ok(df.wrongKiller('Viper killed you from the long angle.', 'Viper') === null, 'the right one is allowed');
ok(df.wrongKiller('Your Omen smoke faded early.', 'Viper') === null, 'an agent named without a kill is not a killer claim');

console.log(`\n${fails ? fails + ' of ' + checks + ' failed' : 'all ' + checks + ' forensics checks passed'}`);
process.exit(fails ? 1 : 0);

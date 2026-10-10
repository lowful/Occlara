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
 * And a look from the screen alone (8.2), for a review Riot's record never
 * reached: its source survives the request, its prompt says the facts were
 * read off the screen and may be incomplete, and no killer survives in it,
 * in English or in the player's own language.
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
const unclear = df.parse('{"cause": "unclear", "what": "This frame does not show the fight.", "better": "Use this frame to reset."}', input, d2);
ok(unclear.what === null && unclear.better === null, 'an unclear frame carries no sentences about itself');
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

// ── From the screen alone (8.2) ─────────────────────────────────────────────
// A review Riot's record never reached sends the deaths the screen saw. Its
// facts are the screen's and the prompt says so, and since the screen never
// records who killed the player, no killer may be named at all.
const DASH = new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`);
ok(DASH.test(`a ${String.fromCharCode(0x2014)} b`) && !DASH.test('a - b'), 'the dash detector catches a dash and lets a hyphen through');
const fromScreen = df.normalise({
  agent: 'Jett', map: 'Abyss', source: 'screen',
  deaths: [{ n: 14, side: 'attacking', sec: 30, killer: 'Viper', weapon: 'Marshal', firstDeath: true, traded: false,
    alive: { mates: 5, enemies: 3 }, planted: true, afterPlant: true, spot: 'A Site', gap: 3, frames: [frame, frame] }],
});
const s14 = fromScreen.deaths[0];
ok(fromScreen.source === 'screen', 'a body from the screen keeps its source through normalise');
ok(input.source === 'riot' && df.normalise({ deaths: [] }).source === 'riot' && df.normalise({ source: 'Screen ' }).source === 'riot',
  'and one with no source, or any other, is Riot\'s, as every client before 8.2 sent it');
ok(s14.killer === null && s14.weapon === null && s14.sec === null && !s14.firstDeath && s14.traded === null
  && s14.alive === null && !s14.afterPlant && s14.gap === null,
  "Riot's facts arriving beside it are dropped rather than stated as the screen's");
ok(s14.planted && s14.spot === 'A Site' && s14.side === 'attacking' && s14.frames.length === 2,
  'and what the screen reads is kept: the plant, the spot, the side, the frames');
const screenPrompt = df.buildPrompt(fromScreen, s14);
ok(/FACTS READ OFF THE SCREEN/.test(screenPrompt) && /may be incomplete/.test(screenPrompt)
  && !/FACTS FROM RIOT'S RECORD/.test(screenPrompt) && !/\bexact\b/.test(screenPrompt),
  'its prompt says the facts were read off the screen and may be incomplete, never that they are Riot\'s and exact');
ok(/Name no killer: the screen does not record who killed the player/.test(screenPrompt)
  && !/Name no killer other than the one in the facts/.test(screenPrompt), 'and forbids naming any killer');
// Each of Riot's fact sentences, matched as the Riot prompt carries it.
const RIOT_FACTS = /Killed by|seconds after the barriers|first death of the round|killed the killer|player included|before the player died/;
ok(RIOT_FACTS.test(prompt) && !RIOT_FACTS.test(screenPrompt), 'with none of Riot\'s facts in it, which the Riot prompt carries');
ok(/The screen saw the spike planted in this round\./.test(screenPrompt) && !/planted later|already planted/.test(screenPrompt),
  'a plant, without the timing against it the screen cannot know');
ok(/last one before the screen read the player as dead/.test(screenPrompt) && /watching a teammate, the cause is unclear/.test(screenPrompt),
  'the frames are said to be framed by when the screen read the death, which can be late');
ok(/The screen placed the death at A Site\./.test(screenPrompt) && Object.keys(df.CAUSES).every((c) => screenPrompt.includes(c + ':')),
  'and it keeps the screen\'s spot and every cause label');
ok(!DASH.test(screenPrompt), 'no dashes in the screen prompt');
ok(/FACTS FROM RIOT'S RECORD, exact/.test(prompt) && /Name no killer other than the one in the facts\./.test(prompt)
  && !/FACTS READ OFF THE SCREEN|read the player as dead/.test(prompt), "while a look from Riot's record still says its facts are Riot's");

// The killer gate from the screen: a sentence naming any agent as the killer,
// in any of the words a killer is named with, each one tried.
ok(df.wrongKiller('A Reyna killed you from Heaven.', null, 'screen') === 'Reyna', 'from the screen, any agent named as the killer is caught');
for (const s of ['You fell to the Sova holding mid.', 'Their Sova took you out at the door.', 'The Sova picked you off from range.',
  'You were eliminated by the Sova.', 'The Sova was your killer.', 'Sova kills you there every time.']) {
  ok(df.wrongKiller(s, null, 'screen') === 'Sova', `and in "${s}"`);
}
ok(df.wrongKiller('A Reyna killed you from Heaven.', null) === null, 'with no source and no killer on record, the gate stays as it was');
ok(df.wrongKiller('Your Omen smoke faded before you crossed.', null, 'screen') === null, 'an agent named with no kill is not a killer claim');
ok(df.wrongKiller('You were shot crossing alone.', null, 'screen') === null, 'and a kill with nobody named is allowed');
const keptWhat = df.parse('{"cause": "isolated", "what": "You held the site alone, far from your team.", '
  + '"better": "Do not peek the Viper who killed you from that angle again."}', fromScreen, s14);
ok(keptWhat.cause === 'isolated' && keptWhat.what === 'You held the site alone, far from your team.' && keptWhat.better === null
  && keptWhat.dropped.some((d) => d.field === 'better' && d.why === 'Viper'), 'a reply\'s sentence naming the killer is dropped, the rest kept');
const lostWhat = df.parse('{"cause": "isolated", "what": "A Viper killed you as you held alone.", "better": "Stay near your team."}', fromScreen, s14);
ok(lostWhat.cause === 'unclear' && lostWhat.what === null && lostWhat.better === null,
  'and a cause whose only explanation named the killer is not counted against the player');
ok(df.parse('{"cause": "dry-peek", "what": "You swung wide into mid with no utility thrown.", "better": "Wait for the flash."}', fromScreen, s14).what
  === 'You swung wide into mid with no utility thrown.', 'a sentence that names nobody passes, as from Riot\'s record');

// In the player's language. The kill words are English, and the look is
// written in the language the player set, so from the screen, in any other,
// a sentence naming any agent but the player's own is taken as naming the
// killer, in whatever words it uses. Each tried through parse, as the route
// runs it. English keeps its words, so a teammate's smoke still stands there.
const screenIn = (language, agent) => df.normalise({ agent, map: 'Abyss', source: 'screen', language,
  deaths: [{ n: 14, side: 'attacking', planted: true, spot: 'A Site', frames: [frame, frame] }] });
const look = (input, what, better) => df.parse(JSON.stringify({ cause: 'isolated', what, better }), input, input.deaths[0]);
const es = screenIn('es', 'Jett');
const de = screenIn('de', 'Jett');
ok(es.language === 'es' && es.source === 'screen' && de.language === 'de', 'a body from the screen keeps its language too');
for (const [input, what, better, killer] of [
  [es, 'Una Sova te mató mientras sostenías solo el sitio.', 'Juega cerca de tu equipo.', 'Sova'],
  [es, 'Sova te eliminó desde la puerta, lejos de tu equipo.', 'Juega cerca de tu equipo.', 'Sova'],
  [es, 'Moriste contra la Reyna que vigilaba el sitio.', 'Juega cerca de tu equipo.', 'Reyna'],
  [de, 'Der Sova hat dich von oben erschossen.', 'Bleib bei deinem Team.', 'Sova'],
  [de, 'Eine Reyna hat dich auf A Site getötet, weit weg von deinem Team.', 'Bleib bei deinem Team.', 'Reyna'],
  // A name with a case ending is still the name.
  [screenIn('pl', 'Sova'), 'Zginąłeś od strzału Jetta, daleko od drużyny.', 'Trzymaj się drużyny.', 'Jett'],
  [screenIn('de', 'Sova'), 'Du bist durch Jetts Schuss gefallen, allein auf A Site.', 'Bleib bei deinem Team.', 'Jett'],
  // Japanese and Korean write the name straight against a particle.
  [screenIn('ja', 'Jett'), '相手のSovaに倒されました。', '味方の近くで戦いましょう。', 'Sova'],
  [screenIn('ko', 'Jett'), '적 Sova가 당신을 처치했습니다.', '팀 가까이에서 싸우세요.', 'Sova'],
]) {
  ok(df.wrongKiller(what, null, 'screen') === null, `the English words alone miss "${what}"`);
  const r = look(input, what, better);
  ok(r.what === null && r.cause === 'unclear' && r.dropped.some((d) => d.field === 'what' && d.why === killer),
    `in ${input.language} it names ${killer} as the killer the screen never saw, and is dropped with its cause`);
}
const keptBetter = look(es, 'Una Sova te mató desde lejos.', 'Usa tu Updraft para no pelear solo.');
ok(keptBetter.what === null && keptBetter.dropped.length === 1 && keptBetter.better === null && keptBetter.cause === 'unclear',
  'the better play beside it, naming nobody, goes with the cause it explained');
const ownEs = look(es, 'Usaste el dash de Jett para entrar solo, lejos de tu equipo.', 'Espera a que tu equipo pueda cambiarte.');
ok(ownEs.cause === 'isolated' && ownEs.what === 'Usaste el dash de Jett para entrar solo, lejos de tu equipo.' && !ownEs.dropped.length,
  "naming the player's own agent is no killer claim in any language");
const mateEs = look(es, 'El humo de tu Omen se acabó antes de que cruzaras solo.', 'Cruza con tu equipo.');
ok(mateEs.what === null && mateEs.dropped.some((d) => d.why === 'Omen'),
  "outside English a teammate named goes too, the safe direction: a sentence is lost, never a killer made up");
// Outside English only the name as the game prints it counts: an agent's
// name that is also a word, in lower case, is that word. "Plus sage" is
// French for wiser, and dropping it lost the better play and the cause.
const frWiser = look(screenIn('fr', 'Reyna'), 'Tu as pris le duel seul, loin de ton équipe.',
  "Il aurait été plus sage d'attendre un coéquipier avant de pousser.");
ok(frWiser.cause === 'isolated' && frWiser.better === "Il aurait été plus sage d'attendre un coéquipier avant de pousser."
  && !frWiser.dropped.length, 'an agent name in lower case, an ordinary word in that language, is no killer claim');
ok(!df.wrongKiller('Un fade lent vers la gauche, puis le neon de la porte.', null, 'screen', { language: 'fr', agent: 'Reyna' }),
  'nor are fade and neon as words');
const unsure = look(screenIn('es', null), 'Usaste el dash de Jett para entrar solo.', 'Cruza con tu equipo.');
ok(unsure.what === null && unsure.dropped.some((d) => d.why === 'Jett'),
  "and with the player's agent unconfirmed, nobody may be named at all");
const ownEn = look(fromScreen, 'You used your Jett dash to go in alone, far from your team.', 'Wait until a teammate can trade you.');
ok(ownEn.cause === 'isolated' && ownEn.what === 'You used your Jett dash to go in alone, far from your team.' && !ownEn.dropped.length,
  "in English, a sentence naming the player's own agent with no kill in it stands");
const mateEn = look(fromScreen, 'Your Omen smoke faded before you crossed alone.', 'Cross with your team.');
ok(fromScreen.language === 'en' && mateEn.what === 'Your Omen smoke faded before you crossed alone.' && !mateEn.dropped.length,
  'and so does a teammate named with no kill: in English the words decide');
ok(look(screenIn('en', 'Jett'), 'A Sova killed you as you held alone.', 'Cross with your team.').what === null
  && look(screenIn('es', 'Jett'), 'A Jett killed you from mid as you held alone.', 'Cruza con tu equipo.').what === null,
  'English kill words still drop a killer, whichever language was asked for, the player\'s own agent included');
const riotEs = df.normalise({ agent: 'Jett', map: 'Abyss', language: 'es',
  deaths: [{ n: 2, side: 'defending', sec: 14, killer: 'Viper', weapon: 'Marshal', frames: [frame] }] });
ok(look(riotEs, 'Viper te mató con la Marshal mientras sostenías solo.', 'Juega cerca de tu equipo.').what
  === 'Viper te mató con la Marshal mientras sostenías solo.', "while a look from Riot's record may still name Riot's killer in Spanish");

console.log(`\n${fails ? fails + ' of ' + checks + ' failed' : 'all ' + checks + ' forensics checks passed'}`);
process.exit(fails ? 1 : 0);

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
 * And a look from Riot's record the round clock could not frame (8.3), on
 * the real Split session through the real reader, says nothing of when its
 * first frame was taken.
 *
 * And 8.5.0's, for every client: no player named in a look (name-gate.js),
 * held on every look sentence and round line on record and on names planted
 * in them; isolated refused on a death Riot records traded. Variant b, the
 * fight judged first: its reply's order, its families and their second
 * choice, a conflict falling to unclear and logged by its keys alone, a
 * change outside its fight kept as nothing. The phrase lists, each held to a
 * phrase it must catch and one it must not, and never changing a label on
 * any of the 23 lost duels on record. And a client before 8.5.0 answered
 * byte for byte as 8.4.4 answered it (scripts/fixtures/death-forensics-844.js),
 * but for those two gates. Variant b2, b with the evidence each judgement
 * rests on written out from bench A: b's prompt but for its judgement and its
 * reply's two sentences, b's judgement as bench A ran it, its checks against
 * Riot's facts where they apply and never from the screen, its rules, b's
 * parse, b's labels on its looks, and the route's gate on its own source:
 * served only beside the admin password, or promoted to 8.5.0 and later.
 *
 * Run: npm run test:forensics
 */

const fs = require('fs');
const path = require('path');
const df = require('../server/services/death-forensics');
const nameGate = require('../server/services/name-gate');
const shipped = require('./fixtures/death-forensics-844');
const clientCauses = require('../src/shared/death-causes');

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

// ── A look from Riot's record timed by its round's clock (8.3.1) ───────────
// Riot's death on the wall clock, from its round's barriers dropping and
// Riot's milliseconds (death-frames.js deathMoment), so each frame is sent
// with its own seconds from the death. On the real Split match the frame
// before round 15's death is a buy phase frame the model read as the round
// clock, 82 s in by it where Riot has the death 2 s in, and the prompt once
// told the model it was taken in the second the player died; then said
// nothing of when. The session replayed through the real reader, the deaths
// as index.js sends them (askForensics, look-stills.js sendOrder).
{
  const deathFrames = require('../src/shared/death-frames');
  const lookStills = require('../src/main/services/look-stills');
  const { replaySession } = require('./fixtures/replay-session');
  const SPLIT_RIOT = require('./fixtures/riot-split-13-7.json');
  const split = replaySession('valorant-session-split-competitive.json', SPLIT_RIOT);
  const looks = deathFrames.looksFor(split.records, deathFrames.withRiotTimes(split.rounds, SPLIT_RIOT), split.window, 'riot');
  const body = df.normalise({ agent: 'Jett', map: 'Split', deaths: looks.map(({ round: r, frames: recs, gap, frameAt }) => {
    const order = lookStills.sendOrder(frameAt);
    return {
      n: r.n, side: r.side, sec: r.deathSec, killer: r.killerAgent, weapon: r.weapon, firstDeath: r.firstDeath, traded: r.traded,
      alive: r.aliveAtDeath, planted: r.planted, afterPlant: r.afterPlant, spot: r.deathSpot, gap,
      frames: order.map((i) => frame + i), frameAt: order.map((i) => frameAt[i]), framesFrom: 'reads',
    };
  }) });
  const promptOf = (n) => { const d = body.deaths.find((x) => x.n === n); return d ? df.buildPrompt(body, d) : ''; };
  ok(body.deaths.map((d) => d.n).join() === '3,7,8,15' && body.deaths.every((d) => d.frameAt && d.framesFrom === 'reads'),
    `the real Split match's looks reach the server, each frame with its seconds from the death (${body.deaths.map((d) => `R${d.n} ${(d.frameAt || ['untimed']).join(' / ')}`).join('; ')})`);
  ok(/Frame 1: 2\.3 s before the death\.\nFrame 2: 0\.7 s after the death\./.test(promptOf(15)) && /Killed by/.test(promptOf(15))
    && !/The first frame was taken/.test(promptOf(15)) && !/in the second the player died/.test(promptOf(15)),
  "round 15's prompt says when each of its frames was taken against Riot's death second, the buy phase's last 2.3 s before it, never that it was the second the player died");
  ok(/2 frames from the player's own screen, in time order:/.test(promptOf(7)) && /Frame 1: 1\.2 s before the death\./.test(promptOf(7))
    && !/The first frame was taken about/.test(promptOf(7)) && /Riot's death second/.test(promptOf(7)),
  "and round 7's, by its round clock 1.2 s before the death, with no second count of it beside");
}

// ── A look from the player's own recording (8.3.1) ─────────────────────────
// Up to five stills of the clip around each death, their seconds from it
// (frameAt), from the recording (framesFrom): the client sends the last
// before the death and the first after it ahead of the rest, so a server from
// before 8.3.1 keeps those two; this one puts them back in time order.
{
  const lookStills = require('../src/main/services/look-stills');
  const AT = [-3, -1.5, -0.7, -0.3, 0.7];
  const order = lookStills.sendOrder(AT);
  const sent = (extra) => df.normalise({ agent: 'Jett', map: 'Sunset', deaths: [{ n: 6, side: 'defending', sec: 20, killer: 'KAY/O', weapon: 'Sheriff',
    traded: false, alive: { mates: 4, enemies: 3 }, spot: 'Mid Courtyard', gap: 1,
    frames: order.map((i) => frame + i), frameAt: order.map((i) => AT[i]), framesFrom: 'recording', ...(extra || {}) }] });
  const rec = sent();
  const d6 = rec.deaths[0];
  ok(df.MAX_FRAMES === 2 && df.MAX_TIMED_FRAMES === 5 && df.MAX_FRAME_AT === 15, 'two frames a death untimed, five timed, each within 15 s of the death');
  ok(d6.frames.length === 5 && d6.frames.map((f) => f.slice(-1)).join('') === '01234' && String(d6.frameAt) === AT.join() && d6.framesFrom === 'recording',
    `five timed frames are kept, put back in time order (sent ${order.join(', ')}, read ${String(d6.frameAt)})`);
  const p6 = df.buildPrompt(rec, d6);
  ok(/5 frames from the player's own screen recording, in time order:\nFrame 1: 3 s before the death\.\nFrame 2: 1\.5 s before the death\.\nFrame 3: 0\.7 s before the death\.\nFrame 4: 0\.3 s before the death\.\nFrame 5: 0\.7 s after the death\./.test(p6),
    'its prompt says they are from the player\'s own screen recording, each at its seconds from the death');
  ok(/The seconds are from Riot's death second, the moment its record has the player dying/.test(p6),
    "and that the seconds are from Riot's death second");
  ok(/A frame after it shows Valorant's death screen: KILLED BY and the combat report/.test(p6) && /If no frame before the death shows an enemy or the fight/.test(p6)
    && /what the frames show:/.test(p6) && /visible in the frames and stated/.test(p6) && !/The first frame was taken/.test(p6),
  'what to read in the frames before the death and the one after it, and no count of the first frame\'s seconds beside them');
  ok(/The screen placed the death at Mid Courtyard\. If the frames print another place above the minimap, that is where it was\./.test(p6),
    "the screen's spot, the last place it read, gives way to the place the frames print (on the real Sunset match round 6's spot was a round earlier's)");
  ok(/FACTS FROM RIOT'S RECORD, exact/.test(p6) && /Killed by KAY\/O with a Sheriff\./.test(p6) && Object.keys(df.CAUSES).every((c) => p6.includes(c + ':'))
    && /Name no killer other than the one in the facts\./.test(p6) && /map|Callouts that exist/.test(p6) && !DASH.test(p6),
  "with Riot's facts, every cause, the killer and map rules kept, and no dash");
  const seven = df.normalise({ deaths: [{ n: 2, frames: [-6, -4, -3, -2, -1, 1, 3].map((s) => frame + s), frameAt: [-6, -4, -3, -2, -1, 1, 3], framesFrom: 'recording' }] }).deaths[0];
  ok(seven.frames.length === 5 && String(seven.frameAt) === '-3,-2,-1,1,3' && seven.frames.map((f) => f.slice(5000)).join() === '-3,-2,-1,1,3',
    `more than five: the five nearest the death are kept, each with its own frame (${String(seven.frameAt)})`);
  const loose = [
    ['a time missing', { frameAt: AT.slice(0, 4) }],
    ['a time past a clip\'s length', { frameAt: [-3, -1.5, -0.7, -0.3, 22] }],
    ['a time that is not a number', { frameAt: [-3, -1.5, '-0.7', -0.3, 0.7] }],
  ].map(([why, extra]) => [why, sent(extra).deaths[0]]);
  ok(loose.every(([, d]) => d.frames.length === 2 && d.frameAt === null && d.framesFrom === null),
    `timed in a way that does not add up (${loose.map(([w]) => w).join(', ')}), a death keeps two frames, untimed, as from a client before`);
  const fromScreen = df.normalise({ agent: 'Jett', map: 'Sunset', source: 'screen', deaths: [{ n: 6, side: 'defending', spot: 'Mid Courtyard',
    frames: [-4.5, -3, -2, -1, 0].map((s) => frame + s), frameAt: [-4.5, -3, -2, -1, 0], framesFrom: 'recording' }] });
  const ps = df.buildPrompt(fromScreen, fromScreen.deaths[0]);
  ok(String(fromScreen.deaths[0].frameAt) === '-4.5,-3,-2,-1,0'
    && /Frame 1: 4\.5 s before the screen read the player as dead\./.test(ps) && /Frame 5: the moment the screen read the player as dead\./.test(ps)
    && /The screen can read a death a few seconds late, so the death itself came at or before the moment it did/.test(ps)
    && /FACTS READ OFF THE SCREEN/.test(ps) && /Name no killer: the screen does not record who killed the player/.test(ps) && !/Riot's death second/.test(ps),
  'from the screen alone, its seconds are from the moment the screen read the death, which comes at or after it, and no killer may be named');
  const old = sent({ frameAt: undefined, framesFrom: undefined }).deaths[0];
  ok(old.frames.length === 2 && old.frameAt === null && /Two frames from the player's own screen: the FIRST is the last one before the death, the SECOND is just after it\./.test(df.buildPrompt(rec, old))
    && /The first frame was taken in the second the player died\./.test(df.buildPrompt(rec, old)),
  'and a body from a client before 8.3.1, no frameAt, gets its two frames and the words it always did');
  ok(order.slice(0, 2).map((i) => AT[i]).join() === '-0.3,0.7', 'the two such a server keeps are the last before the death and the first after it');
  // From the screen the last still is its read of the death, and the frame on
  // screen then is a frame early as often as not (check:clips took -0.03 s).
  // A server from before keeps the first two sent, untimed, and calls them the
  // last before the screen read the player as dead and the first where it did.
  const SCREEN_AT = [-4.51, -3.03, -2.01, -1.02, -0.03];
  const sOrder = lookStills.sendOrder(SCREEN_AT);
  const before831 = df.normalise({ source: 'screen', deaths: [{ n: 6, side: 'defending', frames: sOrder.map((i) => frame + i) }] }).deaths[0];
  ok(before831.frames.map((f) => SCREEN_AT[Number(f.slice(frame.length))]).join() === '-1.02,-0.03'
    && /the FIRST is the last one before the screen read the player as dead, the SECOND is the first one where it did/.test(df.buildPrompt({ source: 'screen' }, before831)),
  `with nothing after the moment, the two it keeps are the last before the screen's read and the read's own (sent ${sOrder.map((i) => SCREEN_AT[i]).join(', ')})`);
}

// ── No player named in a look (8.5.0, every client) ────────────────────────
// The server's copy of the client's read rule (name-gate.js), with each
// sentence's first word exempt, a word after "teammate" counted only when it
// is capitalised, and the game's own words grown. Run as the client's is over
// the 122 look sentences and round lines on record it called 66 names; this
// one calls none, and still catches the names planted in them.
const SENTENCES = require('./fixtures/look-sentences.json').sentences;
const ANSWERS = require('./fixtures/lost-duel-answers.json').answers;
{
  const { namesSomeone } = require('../src/shared/valorant-rounds');
  ok(SENTENCES.length === 122 && SENTENCES.filter((s) => s.from === 'bench').length === 98,
    `the look sentences and round lines on record: ${SENTENCES.length}, 98 of them the bench's own words`);
  const called = SENTENCES.filter((s) => nameGate.namesSomeone(s.text));
  ok(!called.length, `none of them is taken for a name (${called.map((s) => s.text).join(' | ') || 'none'})`);
  const clientCalled = SENTENCES.filter((s) => namesSomeone(s.text)).length;
  ok(clientCalled >= 40, `where the client's rule, run on them as it is, calls ${clientCalled} of them names`);
  for (const [s, word] of [
    ['You were killed by Morvane with a Vandal.', 'Morvane'],
    ['Your teammate Tessik was ahead of you.', 'Tessik'],
    ['You held B Main while your teammate Kraxis pushed past you.', 'Kraxis'],
    ['You died to Morvane#EUW at B.', 'Morvane#EUW'],
    ['You died to Morvane #1234 on A Site.', 'Morvane #1234'],
    ['Your teammate big_boss pushed ahead.', 'big_boss'],
    ['xXmorvane99Xx held A Main against you.', 'xXmorvane99Xx'],
  ]) ok(nameGate.namesSomeone(s) === word, `a planted name is caught: "${s}" (${nameGate.namesSomeone(s)})`);
  for (const s of ['Press Q to Updraft out of the fight.', 'Practise this in Deathmatch and the Range.',
    'Hold the angle with 100hp and win your 1v1s with the first shot.', 'Teammate Sage was ahead of you on B Site.',
    'what happened in round #12?', 'Stay behind cover in A Main until Sova clears it.', 'Your Duelist was Radiant last act, and you are Gold.',
    'The Attackers took 4v3 into A Site at 30s, R5.']) {
    ok(nameGate.namesSomeone(s) === null, `and the game's own words are no name: "${s}" (${nameGate.namesSomeone(s)})`);
  }
  // The client's own read cases, the rule's two copies side by side: equal,
  // but where the server's differs by design, a lowercase word after teammate.
  const READS = [
    ['player at B Site stairs with 22 HP, teammate Zorbo ahead', 'Zorbo', 'Zorbo'],
    ['player watching Klumpf walk through B Site', 'Klumpf', 'Klumpf'],
    ['holding A Lobby with teammate zorbo', 'zorbo', null],
    ['teammate Sage running ahead toward mid, player holding A Lobby', null, null],
    ['holding A Lobby with teammates Brimstone, Sova, Skye and Phoenix nearby', null, null],
    ['ALLY DEFUSING, player holding A Site', null, null],
    ['player holding Mid Courtyard with Ghost, signature ability charged', null, null],
    ['holding A Main with KAY/O behind, knife out with dash ready', null, null],
  ];
  ok(READS.every(([t, client, server]) => namesSomeone(t) === client && nameGate.namesSomeone(t) === server),
    `on the client's own read cases the two copies agree, but "teammate zorbo", a lowercase word the server's lets be (${READS.map(([t]) => `${namesSomeone(t)}/${nameGate.namesSomeone(t)}`).join(', ')})`);
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'shared', 'valorant-rounds.js'), 'utf8');
  const clientPlain = (/const PLAIN_WORDS = `([^`]*)`/.exec(src) || [])[1];
  const wordList = (s) => String(s || '').trim().split(/\s+/).join(' ');
  ok(clientPlain && wordList(clientPlain) === wordList(nameGate.PLAIN_WORDS) && wordList(clientPlain).split(' ').length > 300,
    `the server's plain words are the client's, word for word (${wordList(clientPlain).split(' ').length})`);
  // The match's own names (riot-rounds.js nameSetOf), handed in as the route
  // has them: something that answers has(text), in any language, first word
  // included, and says nothing of which.
  const held = new Set(['morvane', 'tessik']);
  const names = { has: (text) => String(text).toLowerCase().split(/[^\p{L}\p{N}]+/u).some((w) => held.has(w)) };
  ok(nameGate.namesSomeone('Morvane killed you from A Main.') === null
    && nameGate.namesSomeone('Morvane killed you from A Main.', { names }) === nameGate.MATCH_NAME
    && nameGate.namesSomeone('the morvane push came late.', { names }) === nameGate.MATCH_NAME,
  "a name as a sentence's first word, or in lower case, is the match's own, once the match's names are held");
  ok(nameGate.namesSomeone('Tu compañero Tessik estaba delante de ti.', { language: 'es' }) === null
    && nameGate.namesSomeone('Tu compañero Tessik estaba delante de ti.', { language: 'es', names }) === nameGate.MATCH_NAME
    && nameGate.namesSomeone('Dein Teammate Kraxis hat gepusht.', { language: 'de' }) === null
    && nameGate.namesSomeone('Du bist durch den Schuss von Morvane#EUW gefallen.', { language: 'de' }) === 'Morvane#EUW',
  "outside English the capital rule rests (German writes every noun with one), while a handle's shape and the match's names still count");
  ok(nameGate.namesSomeone('Der Sova hat dich erschossen.', { language: 'de' }) === null && nameGate.namesSomeone('Du bist durch Jetts Schuss gefallen.', { language: 'de' }) === null,
    'so a German look is not dropped for its nouns');

  // Through parse, for every client: the sentence goes, logged as a name and never as the name.
  const riotLook = df.normalise({ agent: 'Jett', map: 'Abyss', deaths: [{ n: 4, side: 'attacking', sec: 20, killer: 'Viper', weapon: 'Vandal', traded: false, frames: [frame] }] });
  const r4 = riotLook.deaths[0];
  const named = df.parse(JSON.stringify({ cause: 'dry-peek', what: 'You swung wide into A Main with no utility.',
    better: 'Let your teammate Kraxis flash it for you first.' }), riotLook, r4);
  ok(named.cause === 'dry-peek' && named.what === 'You swung wide into A Main with no utility.' && named.better === null
    && named.dropped.some((d) => d.field === 'better' && d.why === 'a name' && d.gate === 'name'),
  'a better play naming a teammate is dropped, its what and label kept');
  ok(!JSON.stringify(named.dropped).includes('Kraxis') && !df.logLines(named).join(' ').includes('Kraxis')
    && df.logLines(named).join(' ') === '[forensics] R4 dropped: better (a name)', `and the log says a name, never which (${df.logLines(named).join(' ')})`);
  const onlyName = df.parse(JSON.stringify({ cause: 'isolated', what: 'You were killed by Morvane far from your team.', better: 'Play near your team.' }), riotLook, r4);
  ok(onlyName.cause === 'unclear' && onlyName.what === null && onlyName.better === null,
    "a cause whose only explanation named a player is not counted against the player");
  const withNames = { ...riotLook, names };
  const first = df.parse(JSON.stringify({ cause: 'dry-peek', what: 'Morvane caught you swinging A Main with no utility.', better: 'Wait for a flash first.' }), withNames, r4);
  ok(first.what === null && first.cause === 'unclear' && df.parse(JSON.stringify({ cause: 'dry-peek', what: 'Morvane caught you swinging A Main with no utility.',
    better: 'Wait for a flash first.' }), riotLook, r4).what === 'Morvane caught you swinging A Main with no utility.',
  "with the match's names held (an 8.5.0 client sends the match id), a name opening the sentence goes too; without them it is the first word, exempt");
  const broken = { ...riotLook, names: { has: () => { throw new Error('no set'); } } };
  const failed = df.parse(JSON.stringify({ cause: 'dry-peek', what: 'You swung wide into A Main with no utility.', better: 'Wait for a flash first.' }), broken, r4);
  ok(failed.what === null && failed.better === null && failed.cause === 'unclear',
    'a name check that throws drops the sentence: the safe direction');
  const bLook = { ...riotLook, variant: 'b' };
  const namedB = df.parse(JSON.stringify({ what: 'Your teammate Tessik was ahead of you when the Viper swung.', fight: 'wrong-spot',
    better: 'Hold back with your team.', change: 'team', cause: 'isolated', alt: 'none' }), bLook, r4);
  ok(namedB.what === null && namedB.cause === 'unclear' && namedB.fight === 'unclear', 'and so in variant b');
}

// ── The name gate's edges (8.5.0, verified) ────────────────────────────────
// Where a sentence ends decides which word is exempt, and the death screen a
// look reads off its last frame prints its own words in capitals.
{
  // A semicolon, "vs." and the death screen's "BY:" go on with the sentence:
  // the word after them is no first word.
  for (const [s, word] of [
    ['The death screen read KILLED BY: Zorbo with a Vandal.', 'Zorbo'],
    ['You died to: Klumpf, from A Main.', 'Klumpf'],
    ['You pushed alone; Klumpf held the angle.', 'Klumpf'],
    ['You lost the duel vs. Zorbo at B Main.', 'Zorbo'],
    ['You lost the duel VS. Zorbo at B Main.', 'Zorbo'],
  ]) ok(nameGate.namesSomeone(s) === word, `a name after a semicolon, "vs." or "BY:" is caught: "${s}" (${nameGate.namesSomeone(s)})`);
  ok(nameGate.namesSomeone('Hold A Main. Then fall back to B Site!') === null && nameGate.namesSomeone('Did you see it? Stay behind cover.') === null
    && nameGate.namesSomeone('One thing to fix: Trade your entry first.') === null
    && nameGate.sentencesOf('One. Two! Three? Four: five; six vs. seven, by: eight.').length === 5,
  'while a full stop, a question, an exclamation mark and a colon still end one, its next word exempt');
  // The death screen's words and the armour by the shop's names are the
  // game's, a word of them alone read as it stands.
  for (const s of ['The COMBAT REPORT shows you dealt 0 damage.', 'The Combat Report shows you took 159 damage.',
    'SWITCH PLAYER was on screen, so you were SPECTATING a teammate.', 'You had no Heavy Shields when the Jett swung.',
    'Your Light Armor broke before the second shot.', 'You bought a Regen Shield and still lost the duel.',
    'You lost the Clutch with a Headshot to the Raze.']) {
    ok(nameGate.namesSomeone(s) === null, `the HUD's own words are no name: "${s}" (${nameGate.namesSomeone(s)})`);
  }
  ok(nameGate.namesSomeone('You were killed by Report from A Main.') === 'Report' && nameGate.namesSomeone('Your teammate Combat pushed.') === 'Combat',
    "a word of them alone is read as it stands");
  const look = df.normalise({ agent: 'Jett', map: 'Fracture', deaths: [{ n: 5, side: 'attacking', sec: 33, killer: 'Jett', weapon: 'Sheriff', traded: false, frames: [frame] }] });
  const said = df.parse(JSON.stringify({ cause: 'repeek', what: 'The COMBAT REPORT shows you dealt 0 damage before the Jett swung again.',
    better: 'After the first exchange, fall back behind cover.' }), look, look.deaths[0]);
  ok(said.cause === 'repeek' && said.what && said.better, `so a look reading the combat report keeps its label and its sentences (${said.cause}, ${!!said.what})`);
  // The capital rule reads the language the look was asked in: a code the
  // prompt does not know is asked in English, and read as English.
  const asked = (language) => df.normalise({ agent: 'Jett', map: 'Abyss', language, deaths: [{ n: 4, side: 'attacking', sec: 20, killer: 'Viper', traded: false, frames: [frame] }] });
  const reply = JSON.stringify({ cause: 'dry-peek', what: 'You swung wide into A Main with no utility.', better: 'Let your teammate Zorbo flash it for you first.' });
  const enGB = asked('en-GB');
  const de = asked('de');
  ok(/Write "what" and "better" in English/.test(df.buildPrompt(enGB, enGB.deaths[0])) && df.parse(reply, enGB, enGB.deaths[0]).better === null
    && df.parse(reply, de, de.deaths[0]).better === 'Let your teammate Zorbo flash it for you first.',
  "a code the prompt does not know is asked in English, and its name caught; German's capitals stay its own");
  const duel = JSON.stringify({ cause: 'lost-duel', what: 'You lost the duel at A Main.', better: 'Fall back after your first shots.' });
  ok(df.logLines(df.parse(duel, enGB, enGB.deaths[0])).join() === '[forensics] R4 lost-duel better play trips reset'
    && !df.logLines(df.parse(duel, de, de.deaths[0])).length, "and its lost duel's better play is read by the English phrase lists, a German one's not");
}

// ── Isolated against Riot's trade (8.5.0, every client) ────────────────────
{
  const look = (traded, extra) => df.normalise({ agent: 'Jett', map: 'Abyss', ...(extra || {}),
    deaths: [{ n: 9, side: 'defending', sec: 31, killer: 'Viper', weapon: 'Vandal', traded, frames: [frame] }] });
  const reply = JSON.stringify({ cause: 'isolated', what: 'You held B Main alone, far from your team.', better: 'Play closer to your team.' });
  const tr = look(true);
  const traded = df.parse(reply, tr, tr.deaths[0]);
  ok(traded.cause === 'unclear' && traded.what === null && traded.better === null
    && traded.dropped.some((d) => d.field === 'cause' && d.gate === 'traded'),
  '"too far from teammates to be traded" on a death Riot records as traded is unclear, with no sentences');
  ok(df.logLines(traded).join(' ') === '[forensics] R9 dropped: cause (isolated on a death Riot records traded)', `logged by its round (${df.logLines(traded).join(' ')})`);
  const nt = look(false);
  ok(df.parse(reply, nt, nt.deaths[0]).cause === 'isolated', 'a death Riot records as not traded keeps it');
  const scr = look(true, { source: 'screen' });
  ok(scr.deaths[0].traded === null && df.parse(reply, scr, scr.deaths[0]).cause === 'isolated',
    "and from the screen alone there is no trade on record to refuse it with");
  ok(df.parse(JSON.stringify({ cause: 'dry-peek', what: 'You swung with no utility.', better: 'Flash first.' }), tr, tr.deaths[0]).cause === 'dry-peek',
    'a traded death keeps any other label');
  const b = { ...tr, variant: 'b' };
  const tb = df.parse(JSON.stringify({ what: 'You held B Main alone.', fight: 'wrong-spot', better: 'Play closer to your team.', change: 'team',
    cause: 'isolated', alt: 'crossfire' }), b, b.deaths[0]);
  ok(tb.cause === 'unclear' && tb.fight === 'unclear' && tb.what === null, 'and so in variant b, its second choice not taken in its place');
}

// ── Variant b: the fight judged first, the label last (8.5.0) ──────────────
{
  const body = { agent: 'Jett', map: 'Fracture', deaths: [{ n: 5, side: 'attacking', sec: 33, killer: 'Jett', weapon: 'Sheriff', traded: false,
    alive: { mates: 4, enemies: 3 }, planted: true, afterPlant: true, spot: 'A Site',
    frames: [-3, -1.5, -0.7, -0.3, 0.7].map((s) => frame + s), frameAt: [-3, -1.5, -0.7, -0.3, 0.7], framesFrom: 'recording' }] };
  const a = df.normalise(body);
  const b = { ...df.normalise(body), variant: 'b' };
  const pa = df.buildPrompt(a, a.deaths[0]);
  const pb = df.buildPrompt(b, b.deaths[0]);
  const json = pb.slice(pb.lastIndexOf('{'));
  const at = (k) => json.indexOf(`"${k}":`);
  ok(['what', 'fight', 'better', 'change', 'cause', 'alt'].every((k, i, ks) => at(k) >= 0 && (i === 0 || at(ks[i - 1]) < at(k))),
    `b's reply comes in the order it is decided: what, fight, better, change, cause, alt (${json})`);
  ok(/"cause": "<one label from the list>", "what"/.test(pa) && !/"fight"|"alt"/.test(pa), "a's is today's: cause, what, better");
  ok(pb.includes('First write what happened. Then judge the fight in one word:\nright: a fight to take, from where you took it.')
    && pb.includes('Then pick the cause that fits your judgement: right is lost-duel; wrong-spot is isolated, crossfire, overextend, exposed or rotating; '
      + 'wrong-time is repeek, dry-peek or rotating; not-needed is overextend, repeek, exposed or dry-peek; unclear is unclear. alt is your second choice from the same group, or none.')
    && pb.includes('Then say the one thing the better play changes most: aim, position, timing, decision, utility, team, or none.')
    && pb.includes('A death the facts call traded is never isolated.') && pb.includes('a fair fight lost is right, and lost-duel.'),
  "b judges the fight in the spec's words, its families written from FIGHTS");
  ok(!pb.includes('A fair fight from a sound position is lost-duel.') && pa.includes('- A fair fight from a sound position is lost-duel.'),
    "in place of a's fair fight rule, which a keeps");
  ok(pb.includes(`repeek: ${df.CAUSES_B.repeek}`) && df.CAUSES_B.repeek === 'fought again from the same angle after the first exchange or a kill, by staying on it or by peeking it again'
    && pb.includes(`lost-duel: ${df.CAUSES_B['lost-duel']}`) && pa.includes(`repeek: ${df.CAUSES.repeek}`)
    && df.CAUSES.repeek === 'peeked the same angle again after being seen or getting a kill',
  "b's cause list widens repeek and sharpens lost-duel; a's, which the review quotes too, is as it was");
  ok(Object.keys(df.CAUSES_B).join() === Object.keys(df.CAUSES).join() && Object.keys(df.CAUSES).join() === Object.keys(clientCauses.CAUSES).join(),
    'no key is added and none renamed, in either copy');
  ok(!DASH.test(pb) && !DASH.test(df.judgement(true)), 'no dashes in b');
  ok(df.tokensFor(a) === 320 && df.tokensFor(b) === 400 && df.TOKENS.b === 400, 'the reply is given 400 tokens in b, 320 as before in a');
  ok(Array.isArray(df.VARIANTS) && df.VARIANTS.join() === 'b,b2', 'the variants beside the live prompt, as the route reads them: b and b2');
  const es = { ...df.normalise({ ...body, language: 'es' }), variant: 'b' };
  ok(/Keep "fight", "change", "cause" and "alt" as the English words from their lists/.test(df.buildPrompt(es, es.deaths[0])),
    'in another language, its four words stay English, as the label always has');
  // Every family holds known causes only, lost-duel only for a right fight,
  // and every avoidable cause is some judgement's.
  const fam = Object.values(df.FIGHTS).flatMap((f) => f.causes);
  ok(fam.every((c) => df.CAUSES[c]) && df.FIGHTS.right.causes.join() === 'lost-duel'
    && [...df.AVOIDABLE].every((c) => fam.includes(c)) && !Object.entries(df.FIGHTS).some(([k, f]) => k !== 'right' && f.causes.includes('lost-duel')),
  'the families: known causes only, lost-duel only for a right fight, every avoidable cause in one');
  ok(Object.keys(df.FIGHTS).join() === clientCauses.FIGHTS.join() && df.CHANGES.join() === clientCauses.CHANGES.join(),
    "the client's lists of fights and changes are the server's");

  const d5 = b.deaths[0];
  const reply = (o) => JSON.stringify({ what: 'You held A Site from cover and shot at the Jett.', better: 'Stop before you shoot and aim at head level.', ...o });
  const kept = df.parse(reply({ fight: 'right', change: 'aim', cause: 'lost-duel', alt: 'none' }), b, d5);
  ok(kept.cause === 'lost-duel' && kept.fight === 'right' && kept.change === 'aim' && kept.variant === 'b' && kept.what && kept.better,
    'a right fight lost on the shot is lost-duel, its change aim');
  ok(Object.keys(df.replyOf(kept)).join() === 'n,cause,what,better,fight,change,variant',
    `b's look carries its fight, change and variant beside its label (${Object.keys(df.replyOf(kept)).join()})`);
  const viaAlt = df.parse(reply({ fight: 'wrong-time', change: 'timing', cause: 'lost-duel', alt: 'repeek' }), b, d5);
  ok(viaAlt.cause === 'repeek' && viaAlt.fight === 'wrong-time' && viaAlt.change === 'timing', `a cause outside its fight's family gives way to its second choice (${viaAlt.cause})`);
  const conflict = df.parse(reply({ fight: 'right', change: 'timing', cause: 'repeek', alt: 'none' }), b, d5);
  ok(conflict.cause === 'unclear' && conflict.what === null && conflict.better === null && conflict.fight === 'unclear' && conflict.change === null,
    'failing both, the look is unclear, with no sentences');
  ok(df.logLines(conflict).join(' ') === '[forensics] R5 conflict: fight right, cause repeek, alt none',
    `and the conflict is logged by its keys alone (${df.logLines(conflict).join(' ')})`);
  const words = df.parse(reply({ fight: 'a brave one', cause: 'Bad luck from Morvane', alt: 'his fault' }), b, d5);
  ok(words.cause === 'unclear' && df.logLines(words).join(' ') === '[forensics] R5 conflict: fight unknown, cause unknown, alt unknown'
    && !df.logLines(words).join(' ').includes('Morvane'), "a word off the lists is logged as unknown, never as what the model wrote");
  const missing = df.parse(JSON.stringify({ cause: 'lost-duel', what: 'You lost the duel.', better: 'Aim first.' }), b, d5);
  ok(missing.cause === 'unclear' && /fight none/.test(df.logLines(missing).join(' ')), "a reply with no judgement has no family, and says nothing");
  const outside = df.parse(reply({ fight: 'right', change: 'position', cause: 'lost-duel', alt: 'none' }), b, d5);
  ok(outside.cause === 'lost-duel' && outside.change === null && outside.dropped.some((d) => d.field === 'change' && d.gate === 'change'),
    "a change outside its fight's set is kept as nothing and logged, the label kept");
  const words2 = df.parse(reply({ fight: 'Wrong Spot', change: 'Team', cause: 'Caught alone', alt: 'Isolated' }), b, d5);
  ok(words2.fight === 'wrong-spot' && words2.change === 'team' && words2.cause === 'isolated', "a judgement in words is read as its key, and a title off the list gives way to its second choice");
  const unclear = df.parse(reply({ fight: 'unclear', change: 'none', cause: 'unclear', alt: 'none' }), b, d5);
  ok(unclear.cause === 'unclear' && unclear.what === null && unclear.better === null && !unclear.dropped.length, 'an unclear look says nothing, and nothing is logged');
  const noWhat = df.parse(JSON.stringify({ what: '', fight: 'wrong-time', better: 'Wait for the flash.', change: 'utility', cause: 'dry-peek', alt: 'none' }), b, d5);
  ok(noWhat.cause === 'unclear' && noWhat.better === null, 'a mistake with no surviving what is unclear, as in a');
  const noWhatDuel = df.parse(JSON.stringify({ what: '', fight: 'right', better: '', change: 'none', cause: 'lost-duel', alt: 'none' }), b, d5);
  ok(noWhatDuel.cause === 'lost-duel' && noWhatDuel.fight === 'right', 'and a lost duel needs none, as in a');
  ok(df.parse('no JSON at all', b, d5).cause === 'unclear' && df.parse('no JSON at all', b, d5).fight === 'unclear', 'no JSON is unclear');
  // What the route reads (coach.js): anything but 'b' is a, its null for the live prompt among them.
  const asA = (v) => { const x = { ...df.normalise(body), variant: v }; return df.buildPrompt(x, x.deaths[0]) === pa; };
  ok([null, undefined, 'a', 'c', 'B ', ''].every(asA) && df.buildPrompt(b, d5) === pb, "only 'b' asks with b: the route's null, and any other word, is a");
}

// ── Variant b2: b, with the evidence each judgement rests on (8.5.0) ───────
// Bench A ran b on 16 of the player's deaths against a key three panels
// wrote. b's families held, and its judgements wandered where it left the
// evidence to the model: a long fight opened from the open grass was right,
// one exchange from a pillar's edge a repeek, a push to a new place a
// repeek, two frames of another round a lost duel. b2 is b's prompt with that
// judgement written out (judgementB2) and nothing else moved: its causes,
// families, changes, room and parse are b's, and its looks carry b's labels.
{
  const crypto = require('crypto');
  const vm = require('vm');
  const sha = (s) => crypto.createHash('sha256').update(String(s), 'utf8').digest('hex');
  const AT = [-3, -1.5, -0.7, -0.3, 0.7];
  // Round 6 on attack, a first death 3 s in, the spike planted later: Riot's facts, five recording stills.
  const death = (extra) => ({ n: 6, side: 'attacking', sec: 3, killer: 'Chamber', firstDeath: true, traded: false,
    alive: { mates: 5, enemies: 5 }, planted: true, afterPlant: false, spot: 'B Tree',
    frames: AT.map((s) => frame + s), frameAt: AT, framesFrom: 'recording', ...(extra || {}) });
  const body = (extra, top) => ({ agent: 'Jett', map: 'Fracture', ...(top || {}), deaths: [death(extra)] });
  const asked = (b, variant) => { const x = df.normalise(b, { variant }); return df.buildPrompt(x, x.deaths[0]); };
  const swap = (s, from, to) => { const i = s.indexOf(from); return i < 0 ? s : s.slice(0, i) + to + s.slice(i + from.length); };
  const part = (p) => p.slice(p.indexOf('\n\nFirst '), p.indexOf('\n\nRules:'));
  const tail = (p) => p.slice(p.lastIndexOf('Reply with JSON'));
  const p2 = asked(body(), 'b2');
  const pb = asked(body(), 'b');

  // Served as b is: the route's word alone, its room b's.
  ok(df.normalise(body(), { variant: 'b2' }).variant === 'b2' && ['B2', 'b2 ', 'b3', 'B', '', null, undefined].every((v) => df.normalise(body(), { variant: v }).variant === 'a')
    && df.normalise({ ...body(), variant: 'b2' }).variant === 'a',
  "b2 is asked only when the route chose it, never on the body's word, and any other word is a");
  ok(df.TOKENS.b2 === 400 && df.tokensFor(df.normalise(body(), { variant: 'b2' })) === 400 && df.tokensFor({ variant: 'constructor' }) === 320
    && df.judgesFight('b') && df.judgesFight('b2') && !df.judgesFight('a') && !df.judgesFight(null),
  "its reply is given b's 400 tokens, and it judges the fight first as b does");

  // Nothing else moved: b's prompt, but for its judgement and its reply's two sentences.
  ok(swap(swap(p2, part(p2), part(pb)), tail(p2), tail(pb)) === pb && part(pb) === `\n\n${df.judgement(true)}`
    && tail(p2) === tail(pb).replace('what happened>', 'what happened, or empty when the fight is unclear>')
      .replace('keeps you alive>', 'keeps you alive, or empty when the fight is unclear>'),
  "b2's prompt is b's but for its judgement and its reply's two sentences, asked for empty when the fight is unclear");
  ok(sha(df.judgement(true) + df.judgement(false)) === '706e601f6db67995baa24a7a6c521547799a9f9f3164e1fc6434c72385eac132',
    "and b's judgement is the one bench A ran, byte for byte");
  const json = p2.slice(p2.lastIndexOf('{'));
  const at = (k) => json.indexOf(`"${k}":`);
  ok(['what', 'fight', 'better', 'change', 'cause', 'alt'].every((k, i, ks) => at(k) >= 0 && (i === 0 || at(ks[i - 1]) < at(k))),
    `its reply comes in b's order: what, fight, better, change, cause, alt (${json})`);
  const kept = df.judgement(true).split('\n').filter((l) => /^(Then write the better play|Then say the one thing|Then pick the cause|A Duelist)/.test(l));
  ok(kept.length === 4 && kept.every((l) => part(p2).includes(`\n${l}`)),
    "b's better play, its change, its families written from FIGHTS and its Duelist line stand in b2 word for word");

  // First, whether the frames are of this death at all, against Riot's facts.
  const CHECK = 'First check that the frames are of this death. They are of another moment, and the fight is unclear, when the frame after the death '
    + 'still shows you alive and playing, with no death screen; when the spike is already planted in them while the facts say it was planted later; '
    + 'or when the two scores at the top of the frames before the death do not add up to 5, as they must in round 6.';
  ok(p2.includes(CHECK), 'b2 first checks the frames are of this death: alive after it, the spike down before its plant, another round\'s score');
  ok(!asked(body({ afterPlant: true }), 'b2').includes('planted later') && !asked(body({ planted: false }), 'b2').includes('planted later')
    && /alive and playing, with no death screen; or when the two scores at the top of the frames before the death do not add up to 5/.test(asked(body({ afterPlant: true }), 'b2')),
  'the spike is weighed only where the facts say it went down later in the round: not after it, and not in a round with none');
  const one = asked(body({ frames: [frame], frameAt: undefined, framesFrom: undefined }), 'b2');
  ok(one.includes('First check that the frame is of this death. It is of another moment, and the fight is unclear, when the spike is already planted in it while the facts say it was planted later; '
    + 'or when the two scores at the top of the frame do not add up to 5, as they must in round 6.') && !one.includes('frame after the death') && !one.includes('frame by frame'),
  'one frame is one frame: no frame after the death is said to exist, and nothing is read frame by frame');
  const pair = asked(body({ frames: [frame, frame], frameAt: undefined, framesFrom: undefined }), 'b2');
  const reads = asked(body({ frames: [frame + 1, frame + 2], frameAt: [-2.3, 0.7], framesFrom: 'reads' }), 'b2');
  const beforeOnly = asked(body({ frames: [frame + 1, frame + 2], frameAt: [-4.5, -1], framesFrom: 'reads' }), 'b2');
  ok(/when the frame after the death still shows you alive and playing/.test(pair) && /when the frame after the death still shows you alive and playing/.test(reads)
    && !/frame after the death/.test(beforeOnly) && /do not add up to 9, as they must in round 10\./.test(asked(body({ n: 10 }), 'b2')),
  "the frame after the death is checked where there is one, the read's second frame of a client before 8.3.1 among them, and the score is the round's own");
  const scr = asked(body({}, { source: 'screen' }), 'b2');
  ok(!/another moment, and the fight is unclear|scores at the top|planted later/.test(scr)
    && scr.includes('First check that the frames before the death show the fight. It is unclear when they show none of it:'),
  "from the screen alone nothing is checked against its facts, whose round can be a round out: only whether the frames show the fight");
  ok(p2.includes("The fight is unclear too when the frames before the death show none of it: only the time before any contact, the death screen, or a teammate's view "
    + '(SWITCH PLAYER at the bottom left, another agent\'s abilities in the HUD; the SPECTATORS count at the top right is how many watch you, on your own HUD).')
    && p2.includes("After the death, a frame should show the death screen or a teammate's view.")
    && p2.includes('\nunclear: the frames do not show the fight, or show another moment.')
    && p2.includes('\nWhen the fight is unclear, what and better stay empty, and change and alt are none.'),
  "and the fight is unclear when the frames show none of it, before contact, the death screen, a teammate's view, the SPECTATORS count no such view, with no sentences");

  // What to read, and the judgements by it.
  ok(p2.includes('\nThen read the fight in the frames, which decides the judgement: where you stood, at the edge of cover you could step back behind or in the open; '
    + 'whether an enemy was already holding the angle you came into, or came into yours; your health and ammo in the HUD, frame by frame, which show when the shooting '
    + 'started and what it cost; and on the death screen, the damage each side dealt. Then write what happened, in one sentence.\nThen judge the fight in one word:\n'),
  "it reads the fight from the frames' own evidence before it writes what happened: where you stood, who held the angle, health and ammo, the damage dealt");
  ok(p2.includes('\nright: a fight worth taking, from a sound spot, lost on the shots. Either you were set at the edge of cover and the enemy came into your sight, '
    + 'or you met at the same moment with neither of you set; both of you were exposed to each other, and it was one exchange.')
    && p2.includes('Shots that missed and damage you took inside that one exchange are the duel itself, not another judgement.'),
  'a right fight: set at the edge of cover with the enemy coming into sight, or a meeting with neither set, both exposed, one exchange, missed shots inside it the duel');
  ok(p2.includes('You walked or swung into an angle an enemy was already holding, or opened a long fight from the open with no cover beside you, before any utility '
    + 'or information: dry-peek, even if you saw them first or shot first.'),
  'a held angle walked into, or a long fight opened from the open, with no utility first is a dry peek, even shooting first');
  ok(p2.includes('Or the frames show an exchange of shots end, with your kill or with one of you going out of sight, and then you fought on the same angle again, '
    + 'by staying in the spot they had just seen you in or by peeking it again: repeek.')
    && p2.includes('\nLook for a repeek before the other judgements: a second fight on the same angle after an exchange the frames show ending is a repeek however the shots went. '
      + 'Seeing an enemy before any shot is no exchange, and a kill earlier in the round that the frames do not show starts no repeek. Moving on to a new place '
      + 'after a kill is no repeek either: pushing on into their ground is overextend, and meeting two enemies there is crossfire.'),
  'a repeek needs an exchange the frames show ending, is judged before the rest, and a new place after a kill is never one');
  ok(p2.includes('\nnot-needed: a fight you went looking for that the round did not need: your team was ahead, the spike was down and the clock was on your side, '
    + 'or the kill was not worth chasing. A fight that came to you where you were set is never not-needed.'),
  'a fight the round did not need is one you went looking for, never one that came to you where you were set');
  const timeLine = part(p2).split('\n').find((l) => l.startsWith('wrong-time: '));
  const named = Object.keys(df.CAUSES).filter((c) => new RegExp(`(^|[^a-z-])${c}([^a-z-]|$)`).test(timeLine));
  ok(named.join() === 'dry-peek,repeek,rotating' && named.every((c) => df.FIGHTS['wrong-time'].causes.includes(c))
    && new RegExp('(^|[^a-z-])repeek([^a-z-]|$)').test('it was a repeek.') && !new RegExp('(^|[^a-z-])repeek([^a-z-]|$)').test('a repeeks lesson'),
  `every cause the wrong-time line names is of its own family, so the label still comes from the judgement (${named.join(', ')})`);
  ok(!DASH.test(p2) && !DASH.test(one) && !DASH.test(scr) && !DASH.test(df.judgementB2({ many: true, after: true, riot: true, round: 2, plantedLater: true })), 'no dashes in b2');
  const es = df.normalise(body({}, { language: 'es' }), { variant: 'b2' });
  ok(/Keep "fight", "change", "cause" and "alt" as the English words from their lists/.test(df.buildPrompt(es, es.deaths[0])),
    'in another language its four words stay English, as b\'s do');

  // Its parse is b's, and its looks carry b's labels, the word an 8.5.0 client keeps.
  const b2 = df.normalise(body(), { variant: 'b2' });
  const d6 = b2.deaths[0];
  const reply = (o) => JSON.stringify({ what: 'You fired at the Chamber from the open grass at B Tree.', better: 'Stop before you shoot and aim at head level.', ...o });
  const look = df.parse(reply({ fight: 'right', change: 'aim', cause: 'lost-duel', alt: 'none' }), b2, d6);
  ok(look.cause === 'lost-duel' && look.fight === 'right' && look.change === 'aim' && look.variant === 'b' && df.LABELS.b2 === 'b'
    && Object.keys(df.replyOf(look)).join() === 'n,cause,what,better,fight,change,variant',
  `a b2 look carries b's fields, its variant b's labels (${JSON.stringify(df.replyOf(look))})`);
  const { lookJudgement } = require('../src/shared/valorant-review');
  ok(lookJudgement({ ...df.replyOf(look), variant: look.variant || 'b2' }).variant === 'b' && !('variant' in lookJudgement({ ...df.replyOf(look), variant: 'b2' }))
    && clientCauses.variantOf({ variant: 'b2' }) === 'a',
  "which an 8.5.0 client keeps, where a look named b2 would be kept with none and read as a, beside a's narrower repeek");
  const viaAlt = df.parse(reply({ fight: 'wrong-time', change: 'utility', cause: 'lost-duel', alt: 'dry-peek' }), b2, d6);
  const conflict = df.parse(reply({ fight: 'right', change: 'timing', cause: 'repeek', alt: 'none' }), b2, d6);
  const outside = df.parse(reply({ fight: 'right', change: 'position', cause: 'lost-duel', alt: 'none' }), b2, d6);
  const emptyUnclear = df.parse(JSON.stringify({ what: '', fight: 'unclear', better: '', change: 'none', cause: 'unclear', alt: 'none' }), b2, d6);
  const said = df.parse(reply({ fight: 'unclear', change: 'position', cause: 'unclear', alt: 'none' }), b2, d6);
  const noWhat = df.parse(JSON.stringify({ what: '', fight: 'wrong-time', better: 'Wait for the flash.', change: 'utility', cause: 'dry-peek', alt: 'none' }), b2, d6);
  ok(viaAlt.cause === 'dry-peek' && viaAlt.fight === 'wrong-time'
    && conflict.cause === 'unclear' && conflict.what === null && df.logLines(conflict).join(' ') === '[forensics] R6 conflict: fight right, cause repeek, alt none'
    && outside.cause === 'lost-duel' && outside.change === null && outside.dropped.some((d) => d.gate === 'change')
    && emptyUnclear.cause === 'unclear' && emptyUnclear.what === null && !emptyUnclear.dropped.length
    && said.cause === 'unclear' && said.what === null && said.better === null && said.change === null
    && noWhat.cause === 'unclear' && noWhat.better === null,
  "b's parse holds it: a second choice inside the family, a conflict unclear and logged by its keys, a change outside kept as none, unclear with no sentences");
  const tr = df.normalise(body({ traded: true }), { variant: 'b2' });
  ok(df.parse(reply({ fight: 'wrong-spot', change: 'team', cause: 'isolated', alt: 'crossfire' }), tr, tr.deaths[0]).cause === 'unclear',
    "and isolated on a death Riot records traded is unclear, its second choice not taken in its place");

  // The route, on its own source (coach.js forensicsVariant, run in a sandbox):
  // b2 only beside the admin password, or promoted only to 8.5.0 and later.
  const coachText = fs.readFileSync(path.join(__dirname, '..', 'server', 'routes', 'coach.js'), 'utf8').replace(/\r\n/g, '\n');
  const lineOf = (head) => { const i = coachText.indexOf(head); const j = i < 0 ? -1 : coachText.indexOf('\n', i + head.length); return j < 0 ? '' : coachText.slice(i, j + 1); };
  const fnOf = (head) => { const i = coachText.indexOf(head); const j = i < 0 ? -1 : coachText.indexOf('\n}\n', i); return j < 0 ? '' : coachText.slice(i, j + 3); };
  const env = {};
  try {
    const src = [lineOf('\nconst V85 = '), fnOf('\nfunction clientAtLeast('), lineOf('\nconst lookVariants = '), fnOf('\nfunction forensicsVariant(')];
    if (src.some((s) => !s)) throw new Error('the route gate is not where test:forensics reads it in coach.js');
    const box = vm.createContext({ deathForensics: df, process: { env }, String, Number, Array,
      isAdmin: (req) => !!(req && req.headers && req.headers['x-admin-password'] === 'stand-in-admin') });
    const gate = vm.runInContext(`${src.join('\n')}\n;({ forensicsVariant })`, box).forensicsVariant;
    const req = (variant, headers) => ({ body: variant === undefined ? {} : { variant }, headers: headers || {} });
    const admin = { 'x-admin-password': 'stand-in-admin' };
    ok(gate(req('b2')) === null && gate(req('b2', { 'x-admin-password': 'guess' })) === null && gate(req('b2', { 'x-occlara-version': '8.5.0' })) === null
      && gate(req('b2', admin)) === 'b2' && gate(req(' B2 ', admin)) === 'b2' && gate(req('b3', admin)) === null && gate(req('b', admin)) === 'b',
    'the route serves b2 only beside the admin password: a licence naming it, a wrong password or a version alone is looked at with a');
    env.FORENSICS_PROMPT = 'b2';
    ok(gate(req(undefined, { 'x-occlara-version': '8.5.0' })) === 'b2' && gate(req(undefined, { 'x-occlara-version': '8.6.1' })) === 'b2'
      && gate(req(undefined, { 'x-occlara-version': '8.4.4' })) === null && gate(req(undefined)) === null
      && gate(req('a', { ...admin, 'x-occlara-version': '8.5.0' })) === null,
    'promoted, b2 goes to 8.5.0 and later alone, never to a client before it, and an admin bench naming a still gets the control');
    const input = df.normalise(body(), { variant: gate(req(undefined, { 'x-occlara-version': '8.5.0' })) || 'a' });
    ok(input.variant === 'b2' && df.tokensFor(input) === 400 && df.buildPrompt(input, input.deaths[0]) === p2,
      'and what the route hands the look is b2, its room and its prompt');
  } catch (e) {
    ok(false, `the route's gate in its sandbox threw: ${e.message}`);
  }
}

// ── The phrase lists: what a better play says it changes ────────────────────
{
  for (const [list, yes, no] of [
    ['decision', 'With the spike down and a man up, let them come to you.', 'Come out of cover only once you have a teammate.'],
    ['team', 'Take the fight where a teammate can trade you.', 'Take the fight from a tighter angle.'],
    ['reset', 'Fall back after your first shots instead of staying on the angle.', 'Hold that angle with your crosshair at head level.'],
    ['utility', 'Smoke the long angle before you cross.', 'Cross when the long angle is clear.'],
    ['aim', 'Keep your crosshair at head level and tap.', 'Wait behind the wall until they come.'],
  ]) {
    ok(df.PHRASES[list].test(yes) && !df.PHRASES[list].test(no), `the ${list} list catches "${yes}" and lets "${no}" be`);
  }
  ok(df.phraseHits('Use your Updraft to take the high ground.', 'Jett').includes('utility') && !df.phraseHits('Use your Updraft to take the high ground.', 'Sova').includes('utility'),
    "the player's own ability by name is utility");
  ok(df.PHRASES.team.test('so a teammate can trade you') && !df.PHRASES.team.test('a tradeoff') && df.PHRASES.decision.test("Don't take the fight there.")
    && !df.PHRASES.aim.test('a tapestry') && !df.PHRASES.reset.test('a preset'), 'whole words only: no trade in a tradeoff, no tap in a tapestry, no reset in a preset');
  ok(df.movesPlayer('Fall back after your first shots.') && !df.movesPlayer('Aim before firing.') && !df.movesPlayer(''),
    'a better play moves the player when it trips any list but aim');

  // THEY SET NO LABEL, on any of the 23 lost duels on record: each one parsed
  // as it came, and as variant b's and b2's right fight, is still a lost duel.
  ok(ANSWERS.length === 23 && ANSWERS.filter((a) => a.from === 'bench').length === 18, `the lost duels on record: ${ANSWERS.length}, 18 the bench's own words`);
  let moved = 0;
  let logged = 0;
  let still = 0;
  for (const ans of ANSWERS) {
    // Each one as its own match's look: its map, the player's agent, Riot's killer.
    const at = df.normalise({ agent: ans.agent, map: ans.map, deaths: [{ n: ans.round, side: 'defending', sec: 14, killer: ans.killer,
      weapon: ans.weapon, traded: false, frames: [frame] }] });
    const bt = { ...at, variant: 'b' };
    const b2t = { ...at, variant: 'b2' };
    const ra = df.parse(JSON.stringify({ cause: 'lost-duel', what: ans.what, better: ans.better }), at, at.deaths[0]);
    const rb = df.parse(JSON.stringify({ what: ans.what, fight: 'right', better: ans.better, change: 'aim', cause: 'lost-duel', alt: 'none' }), bt, bt.deaths[0]);
    const rb2 = df.parse(JSON.stringify({ what: ans.what, fight: 'right', better: ans.better, change: 'aim', cause: 'lost-duel', alt: 'none' }), b2t, b2t.deaths[0]);
    if (ra.cause !== 'lost-duel' || rb.cause !== 'lost-duel' || ra.better !== rb.better) moved++;
    if (JSON.stringify(df.replyOf(rb2)) !== JSON.stringify(df.replyOf(rb)) || df.logLines(rb2).join() !== df.logLines(rb).join()) moved++;
    if (df.movesPlayer(ans.better, ans.agent)) {
      logged += df.logLines(rb).some((l) => /lost-duel better play trips/.test(l)) ? 1 : 0;
    } else still++;
  }
  ok(moved === 0, `the phrase lists change no label on any of them (${moved} changed)`);
  ok(logged === ANSWERS.length - still && still === 2, `each one whose better play moves the player is logged for the bench, ${logged} of them; the two that do not, the Pearl swiftplay's, are not`);

  // The client's copy (src/shared/death-causes.js), for Ask Coach's label rule.
  ok(df.PHRASE_ORDER.join() === clientCauses.PHRASE_ORDER.join()
    && df.PHRASE_ORDER.every((k) => df.PHRASES[k].source === clientCauses.PHRASES[k].source && df.PHRASES[k].flags === clientCauses.PHRASES[k].flags),
  "the client's phrase lists are the server's, regex for regex");
  // ONE LIST, FOUR COPIES: Ask Coach's two (its gates and its context) are
  // the look's too, where they are deployed beside it.
  const optional = (p) => { try { return require(p); } catch { return null; } };
  const copies = [['fact-gates.js', optional('../server/services/fact-gates')], ['chat-context.js', optional('../src/shared/chat-context')]]
    .filter(([, m]) => m && m.PHRASES);
  ok(copies.every(([, m]) => df.PHRASE_ORDER.every((k) => m.PHRASES[k] && m.PHRASES[k].source === df.PHRASES[k].source && m.PHRASES[k].flags === df.PHRASES[k].flags)),
    `and so are Ask Coach's, regex for regex (${copies.map(([n]) => n).join(', ') || 'none deployed beside it'})`);
  const texts = [...ANSWERS.map((x) => x.better), ...SENTENCES.map((x) => x.text)];
  ok(texts.every((t) => df.phraseHits(t, 'Jett').join() === clientCauses.phraseHits(t, 'Jett').join()),
    `and they read every better play and sentence on record alike (${texts.length})`);
}

// ── A client before 8.5.0, answered as 8.4.4 answered it ────────────────────
// The look as 8.4.4 shipped it, frozen beside the tests: the same prompt for
// every body, as the route reads it (its live variant null, the version, the
// match's names), and the same reply to every answer, but where a name or
// Riot's trade decides.
{
  const live = (body, extra) => Object.assign(df.normalise(body), { variant: null, version: '8.4.4', names: null }, extra || {});
  const bodies = [];
  const timedAt = { recording: [-3, -1.5, -0.7, -0.3, 0.7], reads: [-2.3, 0.7], screen: [-4.5, -3, -2, -1, 0] };
  for (const source of [undefined, 'screen']) {
    for (const language of [undefined, 'en', 'es', 'de', 'ja']) {
      for (const shape of ['one', 'two', 'recording', 'reads', 'screen']) {
        for (const facts of [0, 1, 2]) {
          const at = timedAt[shape] || null;
          const frames = shape === 'one' ? [frame] : shape === 'two' ? [frame, frame] : at.map((s) => frame + s);
          bodies.push({
            agent: facts === 2 ? null : 'Jett', map: facts === 2 ? null : facts ? 'Sunset' : 'Abyss', source, language,
            deaths: [{
              n: 6, side: facts === 1 ? 'attacking' : facts ? null : 'defending',
              ...(facts !== 2 ? { sec: 20, killer: facts ? 'KAY/O' : 'Omen', weapon: facts ? 'Outlaw' : 'Sheriff', firstDeath: !facts,
                traded: facts ? true : false, alive: { mates: 4, enemies: 3 }, planted: true, afterPlant: !!facts, spot: 'Mid Courtyard', gap: facts ? 3 : 1 } : {}),
              frames, ...(at ? { frameAt: at, framesFrom: shape === 'reads' ? 'reads' : 'recording' } : {}),
            }],
          });
        }
      }
    }
  }
  const differ = bodies.filter((body) => {
    const now = live(body);
    const then = shipped.normalise(body);
    return df.buildPrompt(now, now.deaths[0]) !== shipped.buildPrompt(then, then.deaths[0]);
  });
  ok(bodies.length === 150 && !differ.length, `every one of ${bodies.length} bodies is asked with 8.4.4's prompt, byte for byte (${differ.length} differ)`);
  // And on the same bodies b2, beside it, is b's prompt but for its judgement
  // and its reply's two sentences, with no dash: from the screen, in every
  // language, on one frame, two, the read's and the recording's.
  {
    const asked = (body, variant) => { const x = df.normalise(body, { variant }); return df.buildPrompt(x, x.deaths[0]); };
    const swap = (s, from, to) => { const i = s.indexOf(from); return i < 0 ? s : s.slice(0, i) + to + s.slice(i + from.length); };
    const part = (p) => p.slice(p.indexOf('\n\nFirst '), p.indexOf('\n\nRules:'));
    const tail = (p) => p.slice(p.lastIndexOf('Reply with JSON'));
    const off = bodies.filter((body) => {
      const pb = asked(body, 'b');
      const p2 = asked(body, 'b2');
      return p2 === pb || swap(swap(p2, part(p2), part(pb)), tail(p2), tail(pb)) !== pb || DASH.test(p2) || !/\n\nFirst check that /.test(p2);
    });
    ok(!off.length, `and b2's, beside it on every one of them, is b's but for its judgement and its reply's two sentences, with no dash (${off.length} otherwise)`);
  }

  // The replies: every answer on record and the cases above, as each body's look.
  const replies = [
    ...ANSWERS.map((x) => ({ cause: 'lost-duel', what: x.what, better: x.better })),
    ...SENTENCES.map((x) => ({ cause: x.cause || 'isolated', what: x.text, better: x.text })),
    { cause: 'Dry Peek', what: 'You peeked.', better: 'Wait.' }, { cause: 'bad luck', what: 'You peeked.', better: 'Wait.' },
    { cause: 'unclear', what: 'This frame does not show the fight.', better: 'Use this frame to reset.' }, { cause: 'lost-duel', what: '', better: '' },
    { cause: 'isolated', what: '', better: 'Stay near your team.' }, { cause: 'isolated', what: `You held alone ${String.fromCharCode(0x2014)} too far out.`, better: 'x' },
    { cause: 'isolated', what: 'You held Hookah alone.', better: 'Play closer to A Main.' }, { cause: 'dry-peek', what: 'Throw a recon bolt before you peek.', better: 'Wait.' },
    { cause: 'isolated', what: 'Omen killed you from behind.', better: 'Wait.' }, { cause: 'exposed', what: 'You planted in the open', better: 'Plant behind the box' },
  ].map((o) => JSON.stringify(o)).concat(['I think you dry peeked.', '```json\n{"cause": "dry-peek", "what": "You swung wide.", "better": "Wait."}\n```', '{"cause": "repeek"']);
  let same = 0;
  const unexplained = [];
  let gated = 0;
  for (const body of bodies.filter((x, i) => i % 5 === 0)) {
    const now = live(body);
    const then = shipped.normalise(body);
    for (const text of replies) {
      const got = df.parse(text, now, now.deaths[0]);
      const old = shipped.parse(text, then, then.deaths[0]);
      delete old.dropped;
      const reply = df.replyOf(got);
      if (JSON.stringify(reply) === JSON.stringify(old)) { same++; continue; }
      // Only the two gates every client gets may tell them apart.
      const byName = got.dropped.some((d) => d.gate === 'name');
      const byTrade = got.dropped.some((d) => d.gate === 'traded');
      const explained = (byTrade && old.cause === 'isolated' && reply.cause === 'unclear' && reply.what === null && reply.better === null)
        || (byName && !byTrade && ['what', 'better'].some((f) => old[f] && reply[f] === null));
      if (explained) gated++; else unexplained.push(text.slice(0, 60));
    }
  }
  ok(!unexplained.length && same > 4000, `every reply reads as 8.4.4 read it (${same} the same), or differs only by a name or Riot's trade (${gated}); unexplained ${unexplained.length}${unexplained.length ? `: ${unexplained.slice(0, 3).join(' | ')}` : ''}`);
  const plainBody = bodies[0];
  const plain = df.replyOf(df.parse(replies[0], live(plainBody), live(plainBody).deaths[0]));
  ok(Object.keys(plain).join() === 'n,cause,what,better', `its look carries no new field (${Object.keys(plain).join()})`);
}

// ── Bench A's score, on raw replies (bench-look-score.js) ───────────────────
// The arithmetic bench A is passed or failed by, without a model: a set of
// six deaths, a key, and five runs of replies as a model writes them, the
// parsed look beside each. Each bar is held to the number it must give.
{
  const S = require('./bench-look-score');
  const raw = (fight, cause, change, alt) => JSON.stringify({ what: 'x.', fight, better: 'y.', change, cause, alt: alt || 'none' });
  ok(S.rawLook(raw('Wrong Spot', 'Caught alone', 'Team')).fight === 'wrong-spot' && S.rawLook(raw('Wrong Spot', 'Caught alone', 'Team')).cause === 'unknown'
    && S.rawLook('no JSON').json === false && S.rawLook(raw('right', 'repeek', 'timing')).cause === 'repeek',
  'a raw reply is read as the model wrote it: its words as keys, nothing enforced');
  ok(S.contradicts(S.rawLook(raw('right', 'repeek', 'aim'))) && S.contradicts(S.rawLook(raw('right', 'lost-duel', 'timing')))
    && !S.contradicts(S.rawLook(raw('right', 'lost-duel', 'aim'))) && !S.contradicts(S.rawLook(raw('wrong-time', 'repeek', 'timing')))
    && !S.contradicts(S.rawLook(raw('unclear', 'unclear', 'none'))),
  'a raw self contradiction: a cause outside its fight\'s family, or a right fight changing more than the aim');
  ok(S.conflicts(S.rawLook(raw('right', 'repeek', 'timing'))) && !S.conflicts(S.rawLook(raw('wrong-spot', 'lost-duel', 'team', 'isolated')))
    && S.conflicts(S.rawLook(JSON.stringify({ cause: 'repeek', what: 'x.' }))),
  'and a conflict, what parse() turns to unclear: neither the cause nor its second choice in the family');
  const set = { deaths: [
    { key: 'f:2', match: 'Fracture swiftplay', body: 'recording' }, { key: 'f:5', match: 'Fracture swiftplay', body: 'recording' },
    { key: 'f:6', match: 'Fracture swiftplay', body: 'recording' }, { key: 'p:1', match: 'Pearl swiftplay', body: 'recording' },
    { key: 's:3', match: 'Sunset swiftplay', body: 'recording' }, { key: 'a:2', match: 'Abyss competitive', body: 'reads' }] };
  const key = { deaths: [
    { key: 'f:2', acceptable: ['repeek'], forbidden: ['lost-duel'] }, { key: 'f:5', acceptable: ['repeek', 'overextend'], forbidden: ['lost-duel', 'isolated'] },
    { key: 'f:6', acceptable: ['repeek', 'dry-peek'], forbidden: ['isolated'] }, { key: 'p:1', fair: true, acceptable: ['lost-duel'], forbidden: ['dry-peek'] },
    { key: 's:3', unclear: true, acceptable: ['unclear'], forbidden: [] }, { key: 'a:2', acceptable: ['isolated', 'dry-peek'], forbidden: ['lost-duel'] }] };
  ok(!S.keyProblems(set, key).length, 'a key that answers every death is scored');
  ok(S.keyProblems(set, { deaths: key.deaths.slice(1) }).join() === 'f:2: not in the key'
    && /both acceptable and forbidden/.test(S.keyProblems({ deaths: [set.deaths[0]] }, { deaths: [{ key: 'f:2', acceptable: ['repeek'], forbidden: ['repeek'] }] }).join())
    && /lost-duel alone/.test(S.keyProblems({ deaths: [set.deaths[3]] }, { deaths: [{ key: 'p:1', fair: true, acceptable: ['lost-duel', 'repeek'] }] }).join()),
  'and one that misses a death, lists a label both ways, or calls a fight fair with another label is refused before the bench');
  const looks = [];
  const add = (k, run, text, ms) => looks.push({ key: k, run, raw: text, parsed: { cause: S.rawLook(text).cause }, ms: ms || 2500 });
  for (let run = 1; run <= 5; run++) {
    add('f:2', run, raw('wrong-time', 'repeek', 'timing'));
    add('f:5', run, run < 5 ? raw('wrong-time', 'repeek', 'timing') : raw('right', 'lost-duel', 'aim'));
    add('f:6', run, raw('wrong-time', 'dry-peek', 'utility'), run === 5 ? 4500 : 2500);
    add('p:1', run, run < 5 ? raw('right', 'lost-duel', 'aim') : raw('wrong-time', 'dry-peek', 'utility'), run === 4 ? 4500 : 2500);
    add('s:3', run, raw('unclear', 'unclear', 'none'));
    add('a:2', run, run <= 3 ? raw('wrong-spot', 'isolated', 'team') : run === 4 ? raw('right', 'repeek', 'timing') : raw('wrong-spot', 'lost-duel', 'team', 'isolated'), 9000);
  }
  const r = S.score({ set, key, looks, variant: 'b', runs: 5 });
  const b = (name) => r.bars.find((x) => x.name === name);
  ok(b('forbidden').value === '3 in 30' && b('forbidden').pass === false,
    `forbidden labels: three in 30 looks (round 5's lost duel, the fair duel's dry peek, the Abyss lost duel), over the 2 in 80 a bench of 80 may have (${b('forbidden').value}, ${b('forbidden').limit})`);
  ok(b('fair').pass === true && b('fair').value === '1 of 1 fair duels', 'the fair duel is a lost duel in 4 runs of 5, enough');
  ok(b('avoidable').value === '63%' && /67%/.test(b('avoidable').limit) && b('avoidable').pass === true,
    `the share calling a death avoidable, 19 of 30, against the key's four deaths of six and 5 points (${b('avoidable').value}, ${b('avoidable').limit})`);
  ok(b('unclear').pass === true && b('fracture').value === '4 of 5 runs' && b('fracture').pass === true,
    'unclear every run where the key says so, and the Fracture three all acceptable in 4 runs of 5');
  ok(b('contradict').value === '2 of 25 that spoke' && b('contradict').pass === false && b('conflicts').value === '1 of 25 that spoke' && b('conflicts').pass === true,
    `two raw contradictions in 25 that spoke is over 5%, one conflict under 10% (${b('contradict').value}; ${b('conflicts').value})`);
  ok(b('p90').value === '2.50 s' && b('p90').pass === true && !r.pass, `the p90 is the five still body's alone, the read frames' 9 s left out (${b('p90').value}), and the bench does not pass`);
  const control = S.score({ set, key, looks, variant: 'a', runs: 5 });
  ok(!control.bars.some((x) => x.name === 'contradict' || x.name === 'conflicts'), 'the control, variant a, has no judgement to contradict');
  ok(S.VARIANTS.join() === 'a,b,b2' && JSON.stringify(S.score({ set, key, looks, variant: 'b2', runs: 5 }).bars) === JSON.stringify(r.bars),
    "b2, which judges the fight as b does, is scored on b's bars, its contradictions and conflicts among them; a bench may name a, b or b2");
  const bd = S.bodyDeath({ facts: { n: 2, side: 'defending' }, frames: ['x1', 'x2', 'x3'], frameAt: [-3, -0.3, 0.7], framesFrom: 'recording' },
    (rel) => Buffer.from(rel));
  ok(bd.frameAt.join() === '-0.3,0.7,-3' && Buffer.from(bd.frames[0], 'base64').toString() === 'x2' && bd.framesFrom === 'recording' && bd.n === 2,
    "each death goes as the client sends it: the last frame before the death and the first after it lead");
  ok(S.estimate({ body: 'recording' }) === 0.0165 && S.estimate({ body: 'reads' }) === 0.008, 'a look is reckoned at $0.0165 on five stills and $0.008 on two frames before the ledger answers');
  // WHAT A BENCH IS SENT RAW is the label words, never a sentence of the
  // model's (death-forensics.js rawLabels), and it scores as the text does.
  const planted = JSON.stringify({ what: 'Zorbo#EUW killed you while Klumpf watched.', fight: 'Wrong Spot', better: 'Ask Klumpf to flash for you.',
    change: 'Team', cause: 'Bad luck from Zorbo', alt: 'Isolated' });
  const labels = df.rawLabels(planted);
  ok(JSON.stringify(labels) === '{"json":true,"fight":"wrong-spot","cause":"unknown","alt":"isolated","change":"team","what":true}'
    && !/Zorbo|Klumpf|killed|flash/i.test(JSON.stringify(labels)),
  `the raw reply a bench is sent carries its label words as keys and no sentence, nor any word off a list (${JSON.stringify(labels)})`);
  ok(JSON.stringify(df.rawLabels('no JSON at all')) === '{"json":false,"fight":null,"cause":null,"alt":null,"change":null,"what":false}',
    'and a reply with no JSON is said to be one');
  const texts = [planted, ...looks.map((l) => l.raw), 'no JSON', JSON.stringify({ cause: 'repeek', what: '' }), JSON.stringify({ fight: 'right', cause: 'none', alt: 'none', change: 'none' })];
  ok(texts.every((t) => JSON.stringify(S.rawLook(df.rawLabels(t))) === JSON.stringify({ ...S.rawLook(t), better: null })),
    `a bench scores the label words exactly as it scores the reply's text (${texts.length} replies)`);
  const labelled = S.score({ set, key, looks: looks.map((l) => ({ ...l, raw: df.rawLabels(l.raw) })), variant: 'b', runs: 5 });
  ok(JSON.stringify(labelled.bars) === JSON.stringify(r.bars), 'and every bar of the bench reads the same off them');
  // BENCH A STOPS AT $3, both prompts together: each run, b and its control
  // a, at half, which still covers a run of the spec's set (11 deaths on five
  // stills, 5 on two frames, five runs).
  const variantRun = 5 * (11 * S.estimate({ body: 'recording' }) + 5 * S.estimate({ body: 'reads' }));
  ok(S.BENCH_A_USD === 3 && S.RUN_USD * 2 <= S.BENCH_A_USD && S.RUN_USD >= variantRun * 1.25,
    `a run of bench A stops at $${S.RUN_USD.toFixed(2)}, so b and a together stop at $${(S.RUN_USD * 2).toFixed(2)}, while one run of the set reckons at $${variantRun.toFixed(2)}`);
  const benchSrc = fs.readFileSync(path.join(__dirname, 'bench-forensics.js'), 'utf8');
  ok(/flag\('budget', score\.RUN_USD\)/.test(benchSrc) && !/flag\('budget', 3\)/.test(benchSrc), "and bench-forensics.js --own takes it as its --budget's default");
}

// ── Bench A's run, end to end and offline ───────────────────────────────────
// bench-forensics.js --own against a stand in server on 127.0.0.1 that
// answers as the route will (the real normalise, parse and rawLabels) and
// books each look under 'bench', with a profile of its own: a look set of
// three deaths, a key, and a stand in licence, never the player's. A look the
// server failed is asked once more; the run sends the admin password, the
// variant, 8.5.0 and raw: true; and what it writes holds no licence and no
// sentence of the model's but the gated ones.
(async () => {
  // MAIN'S LOOK SENDS RIOT'S MATCH ID AND KEEPS WHAT VARIANT B SAYS (8.5.0,
  // index.js askForensics, run in a sandbox): the match id is the key to the
  // match's own name set on the server, for the look's name gate; and each
  // look keeps its fight, its change and the prompt it was asked with, which
  // a cause's trend is held to (patterns.js lookVariant). A look of a server
  // from before keeps none of them, and a word off their lists is kept as none.
  try {
    const vm = require('vm');
    const review = require('../src/shared/valorant-review');
    const mainText = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'index.js'), 'utf8').replace(/\r\n/g, '\n');
    const fnOf = (head) => { const i = mainText.indexOf(head); const j = i < 0 ? -1 : mainText.indexOf('\n}\n', i); return j < 0 ? '' : mainText.slice(i, j + 3); };
    const ask = fnOf('\nasync function askForensics(');
    const posted = [];
    let answer = null;
    const lookBox = vm.createContext({
      console: { log() {} }, Date, Math, Number, JSON, Object, Array, String, Promise, Map, Set, Buffer,
      require: (m) => { if (m !== '../shared/valorant-review') throw new Error(`${m} is not in the sandbox`); return review; },
      clips: { momentOf: () => 1000, stillName: (n, k) => `r${n}-rec${k}.jpg` },
      lookStills: { sendOrder: (at) => at.map((_x, i) => i) },
      fs: { readFileSync: () => Buffer.from('frame') }, path: { join: (...p) => p.join('/') },
      API: { DEATH_FORENSICS: '/api/coach/death-forensics' },
      store: { get: () => 'GC-TEST' },
      api: { post: async (p, body) => { posted.push(body); return { ok: true, data: answer }; } },
    });
    const askMain = vm.runInContext(`${ask}\n;({ askForensics })`, lookBox);
    const look = (n) => ({ round: { n, side: 'attacking', deathSec: 20, killerAgent: 'Jett', weapon: 'Sheriff', traded: false },
      frames: [{ frame: 'f1.jpg' }, { frame: 'f2.jpg' }], names: [`r${n}-a.jpg`, `r${n}-b.jpg`], frameAt: [-1, 0.5], at: 5000 });
    const lookSnap = { context: { agent: 'Jett', map: 'Fracture', language: 'en' } };
    answer = { variant: 'b', deaths: [{ n: 2, cause: 'repeek', what: 'You stayed on the angle.', better: 'Fall back.', fight: 'wrong-time', change: 'timing', variant: 'b' },
      { n: 5, cause: 'lost-duel', what: 'You lost the duel.', better: 'Aim at the head.', fight: 'a brave one', change: 'none' }] };
    const got = await askMain.askForensics([look(2), look(5)], new Map(), lookSnap, 'riot', { dir: 'd', records: [] }, 'riot-match-1');
    ok(posted[0] && posted[0].matchId === 'riot-match-1' && got.byRound[2].fight === 'wrong-time' && got.byRound[2].change === 'timing'
      && got.byRound[2].variant === 'b' && !('fight' in got.byRound[5]) && got.byRound[5].change === 'none' && got.byRound[5].variant === 'b',
    `main's look sends Riot's match id, and keeps each look's fight, change and prompt, a word off a list kept as none (${JSON.stringify(got.byRound[5])})`);
    answer = { deaths: [{ n: 2, cause: 'repeek', what: 'You stayed on the angle.', better: 'Fall back.' }] };
    const old = await askMain.askForensics([look(2)], new Map(), lookSnap, 'screen', { dir: 'd', records: [] }, null);
    ok(!('matchId' in posted[1]) && !('fight' in old.byRound[2]) && !('change' in old.byRound[2]) && !('variant' in old.byRound[2]),
      'and with no match id sends none, and a server from before gives a look none of the three: it was asked with a');
    answer = { variant: 'a', deaths: [{ n: 2, cause: 'repeek', what: 'You stayed on the angle.', better: 'Fall back.' }] };
    const a = await askMain.askForensics([look(2)], new Map(), lookSnap, 'riot', { dir: 'd', records: [] }, 'riot-match-1');
    ok(a.byRound[2].variant === 'a', 'a look the reply says was asked with a keeps a');
    // And what main hands it: Riot's match id from Riot's look, the
    // scoreboard's for the look from the screen; the review written again is
    // sent it too, and the review keeps Riot's comps.
    const forSrc = fnOf('\nasync function forensicsFor(');
    const linkSrc = mainText.slice(mainText.indexOf('const riotLook = async'), mainText.indexOf('const riotThen = '));
    ok(/\(opts && opts\.matchId\) \|\| \(job && job\.tracker && job\.tracker\.matchId\)/.test(forSrc) && /askForensics\(looks, stills, snap, source, log, matchId\)/.test(forSrc)
      && /if \(lm\.matchId\) body\.matchId = lm\.matchId;/.test(linkSrc) && /matchId: lm\.matchId \}\)/.test(linkSrc) && /comps: riot\.comps \|\| null/.test(linkSrc),
    "and main hands it Riot's match id, sends the review written again the same, and keeps Riot's comps on the review");
    // The card keeps them (valorant-review.js build), as it keeps the cause.
    const card = review.build({ rounds: [{ n: 2, side: 'attacking', result: 'lost', died: true, verified: true,
      forensics: { ...got.byRound[2], source: 'riot' } }], context: {}, endedBy: 'stop', ai: {} }).rounds[0].forensics;
    const before = review.build({ rounds: [{ n: 2, side: 'attacking', result: 'lost', died: true, verified: true,
      forensics: { cause: 'repeek', what: 'x.', better: 'y.', frames: [], source: 'riot' } }], context: {}, endedBy: 'stop', ai: {} }).rounds[0].forensics;
    ok(card.fight === 'wrong-time' && card.change === 'timing' && card.variant === 'b' && !('fight' in before) && !('variant' in before),
      'and the review card keeps the fight, the change and the prompt where the look has them, and a look saved before keeps its keys');
    // THE RECORD'S SHAPE TO THE DEBUG LOG ON EACH LINK (8.5.0, spec 5.5): key
    // names only, as the server sends them (riot-rounds.js deeperShape).
    const roundsSrc = fnOf('\nasync function riotRoundsFor(');
    const logged = [];
    const linkBox = vm.createContext({
      console: { log: (...a) => logged.push(a.join(' ')) }, JSON, String, encodeURIComponent,
      store: { get: (k) => (k === 'riotId' ? 'Me#EUW' : 'GC-TEST') },
      api: { get: async () => ({ ok: true, data: { perRound: [{ n: 1 }], shape: { top: ['metadata', 'rounds'], 'kills[0].weapon': ['name', 'type'] } } }) },
    });
    const linkMain = vm.runInContext(`${roundsSrc}\n;({ riotRoundsFor })`, linkBox);
    const rec = await linkMain.riotRoundsFor({ matchId: 'riot-match-1' });
    ok(rec && logged.some((l) => l === '[review] Riot round record shape: {"top":["metadata","rounds"],"kills[0].weapon":["name","type"]}'),
      `each link writes the record's shape, key names only, to the debug log (${logged.join(' | ')})`);
  } catch (e) {
    ok(false, `main's look in its sandbox threw: ${e.stack || e.message}`);
  }

  const os = require('os');
  const http = require('http');
  const { spawn } = require('child_process');
  const appData = fs.mkdtempSync(path.join(os.tmpdir(), 'occlara-bench-a-'));
  const looksDir = path.join(appData, 'Occlara', 'bench', 'looks');
  try {
    fs.mkdirSync(path.join(looksDir, 'f'), { recursive: true });
    fs.writeFileSync(path.join(appData, 'Occlara', 'occlara-config.json'), JSON.stringify({ licenseKey: 'STAND-IN-LICENCE-0000' }));
    const img = (name) => { fs.writeFileSync(path.join(looksDir, 'f', name), Buffer.alloc(3000, 7)); return `f/${name}`; };
    const at5 = [-3, -1.5, -0.7, -0.3, 0.7];
    const facts = (n) => ({ n, side: 'attacking', sec: 30, killer: 'Jett', weapon: 'Sheriff', firstDeath: false, traded: false, alive: { mates: 4, enemies: 3 } });
    const death = (n, body) => ({ key: `frac:${n}`, match: 'Fracture swiftplay', map: 'Fracture', agent: 'Jett', source: 'riot', facts: facts(n), body,
      ...(body === 'recording' ? { frames: at5.map((s, i) => img(`r${n}-${i}.jpg`)), frameAt: at5, framesFrom: 'recording' }
        : { frames: [img(`r${n}-a.jpg`), img(`r${n}-b.jpg`)], frameAt: [-2.3, 0.7], framesFrom: 'reads' }) });
    fs.writeFileSync(path.join(looksDir, 'set.json'), JSON.stringify({ deaths: [death(2, 'recording'), death(5, 'recording'), death(6, 'reads')] }));
    fs.writeFileSync(path.join(looksDir, 'key.json'), JSON.stringify({ deaths: [
      { key: 'frac:2', acceptable: ['repeek'], forbidden: ['lost-duel'] }, { key: 'frac:5', acceptable: ['repeek', 'overextend'], forbidden: ['isolated'] },
      { key: 'frac:6', acceptable: ['repeek', 'dry-peek'], forbidden: ['isolated'] }] }));
    const wrote = {
      2: { what: 'Zorbo watched you stay on the A Main angle.', fight: 'wrong-time', better: 'Fall back after the first exchange.', change: 'timing', cause: 'repeek', alt: 'none' },
      5: { what: 'You stayed on A Site after your first shots.', fight: 'wrong-time', better: 'Get out of sight, Klumpf was trading.', change: 'timing', cause: 'repeek', alt: 'none' },
      6: { what: 'You fought from B Tree.', fight: 'wrong-time', better: 'Wait for a flash.', change: 'utility', cause: 'Bad luck from Zorbo', alt: 'dry-peek' },
    };
    const asked = [];
    let booked = 0;
    let failedOnce = false;
    const server = http.createServer((req, res) => {
      let data = '';
      req.on('data', (c) => { data += c; });
      req.on('end', () => {
        if (req.method === 'GET' && req.url === '/api/admin/costs') {
          res.end(JSON.stringify({ spend: { today: { routes: { bench: { real: booked, estimated: 0, calls: asked.length } } } } }));
          return;
        }
        const b = JSON.parse(data || '{}');
        asked.push({ admin: req.headers['x-admin-password'], version: req.headers['x-occlara-version'], variant: b.variant, raw: b.raw,
          model: b.benchModel, frameAt: b.deaths && b.deaths[0] && b.deaths[0].frameAt });
        booked += 0.0172;
        const input = df.normalise(b, { variant: b.variant });
        const d = input.deaths[0];
        if (d.n === 5 && !failedOnce) {
          failedOnce = true;
          res.end(JSON.stringify({ deaths: [{ n: 5, cause: 'unclear', what: null, better: null, failed: true }], model: b.benchModel, variant: b.variant }));
          return;
        }
        const text = JSON.stringify(wrote[d.n]);
        const look = df.replyOf(df.parse(text, input, d));
        if (b.raw) look.raw = df.rawLabels(text);
        res.end(JSON.stringify({ deaths: [look], model: b.benchModel, variant: b.variant }));
      });
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const env = { ...process.env, APPDATA: appData, OCCLARA_SERVER: `http://127.0.0.1:${server.address().port}`, ADMIN_PASSWORD: 'stand-in-admin' };
    const run = await new Promise((resolve) => {
      const child = spawn(process.execPath, [path.join(__dirname, 'bench-forensics.js'), 'openai/gpt-6-sol', '--own', '--key', '--variant', 'b',
        '--runs', '2', '--costs', '--gap', '0'], { cwd: path.join(__dirname, '..'), env });
      let out = '';
      child.stdout.on('data', (c) => { out += c; });
      child.stderr.on('data', (c) => { out += c; });
      const timer = setTimeout(() => child.kill(), 60000);
      child.on('close', (code) => { clearTimeout(timer); resolve({ code, out }); });
    });
    server.close();
    const runs = fs.existsSync(path.join(looksDir, 'runs')) ? fs.readdirSync(path.join(looksDir, 'runs')) : [];
    const file = runs.length ? fs.readFileSync(path.join(looksDir, 'runs', runs[0]), 'utf8') : '';
    const written = file ? JSON.parse(file) : { looks: [] };
    ok(asked.length === 7 && /frac:5 +FAILED on the server, \d+ ms, asking once more/.test(run.out) && written.looks.length === 6 && !written.stopped,
      `a look the server failed is asked once more, and the run goes on: ${asked.length} asked for 6 looks (${written.stopped || 'not stopped'})`);
    ok(asked.every((a) => a.admin === 'stand-in-admin' && a.version === '8.5.0' && a.variant === 'b' && a.raw === true && a.model === 'openai/gpt-6-sol')
      && asked[0].frameAt.join() === '-0.3,0.7,-3,-1.5,-0.7',
    "each look goes with the admin password, the variant asked, 8.5.0, raw: true and the bench's model, its frames as the client orders them");
    ok(Math.abs(written.spent - 7 * 0.0172) < 1e-9 && /\$0\.1204 spent/.test(run.out),
      `what it spent is the ledger's, the failed look's too, where it passes the estimate (${written.spent})`);
    ok(written.looks.every((l) => l.raw && typeof l.raw === 'object') && written.result.perDeath.find((p) => p.key === 'frac:6').raw.join() === 'wrong-time/unknown (utility),wrong-time/unknown (utility)'
      && /PASS {2}forbidden/.test(run.out) && /FAIL {2}fracture/.test(run.out) && run.code === 1,
    'the label words are scored raw, a cause off the list read as unknown though parse took its second choice, and the bars printed');
    ok(!/STAND-IN-LICENCE/.test(file) && !/Klumpf/.test(file) && !/Bad luck/.test(file),
      'and the run it writes holds no licence, no word off a list, and of the model\'s sentences only those the gates let pass');
    // --variant b2 is a run the bench will make, and a word off the list one it refuses, before anything is sent.
    const dry = (variant) => new Promise((resolve) => {
      const child = spawn(process.execPath, [path.join(__dirname, 'bench-forensics.js'), '--own', '--dry', '--variant', variant], { cwd: path.join(__dirname, '..'), env });
      let out = '';
      child.stdout.on('data', (c) => { out += c; });
      child.stderr.on('data', (c) => { out += c; });
      const timer = setTimeout(() => child.kill(), 30000);
      child.on('close', (code) => { clearTimeout(timer); resolve({ code, out }); });
    });
    const asB2 = await dry('b2');
    const asB3 = await dry('b3');
    ok(asB2.code === 0 && /variant b2: 3 looks/.test(asB2.out) && /--dry: nothing sent\./.test(asB2.out)
      && asB3.code === 1 && /--variant is a, b or b2, not b3/.test(asB3.out),
    `the bench names b2, and refuses a variant the server does not serve before anything is sent (${asB2.code}, ${asB3.code})`);
  } catch (e) {
    ok(false, `bench A's offline run crashed: ${e.stack || e.message}`);
  } finally {
    fs.rmSync(appData, { recursive: true, force: true });
  }
  console.log(`\n${fails ? fails + ' of ' + checks + ' failed' : 'all ' + checks + ' forensics checks passed'}`);
  process.exit(fails ? 1 : 0);
})();

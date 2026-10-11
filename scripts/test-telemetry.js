'use strict';

/**
 * Aggregate coaching telemetry: useful counts, no player content.
 *
 * The AI decision log is what has found nearly every real bug in this app, and
 * it exists only on the player's own machine. That stays true. A frame is a
 * photograph of somebody's screen, complete with their Discord, their tabs and
 * their stream chat, so collecting frames centrally would turn a low-risk local
 * tool into a genuine liability.
 *
 * The useful part was never the picture, it was the COUNTS. Repetition being
 * roughly three quarters of all rejections is obvious in aggregate and
 * invisible in any single session.
 *
 * So the tests that matter here are the ones proving nothing else gets through.
 * The reject reason is matched against a closed list and reduced to a slug, so a
 * future reason that interpolates a callout, a player name or a tip cannot leak
 * by accident. That is asserted below rather than assumed.
 *
 * The match recorder's block (8.3) is held the same way and harder: its words
 * from closed lists or 'other', its numbers clamped, its version a version, and
 * every other field dropped, read back field by field from what is kept. The
 * block is built by the client's own reportBlock(), and the tip era's reports
 * are shown to count exactly as before beside it.
 *
 * Run: npm run test:telemetry
 */
const path = require('path');
const t = require(path.join(__dirname, '..', 'server', 'services', 'telemetry.js'));

let pass = 0, fail = 0;
const check = (name, ok, detail) => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : `\n        ${detail}`}`);
};

// Verbatim reject reasons from real sessions.
const REAL = {
  'too similar to a recent tip': 55,
  'failed the final verify gate (ai)': 27,
  'already recommended a trade in the last two tips': 20,
  'repeated the same ability (wall) back to back': 13,
  'the tip was cut off mid sentence': 3,
};

console.log('real reject reasons reduce to stable kinds:');
const EXPECT = [
  ['too similar to a recent tip', 'similar'],
  ['already recommended a crossfire in the last two tips', 'repeat-play'],
  ['repeated the same ability (wall) back to back', 'repeat-play'],
  ['the tip was cut off mid sentence', 'truncated'],
  ['failed the final verify gate (ai)', 'verify-gate'],
  ['every enemy is dead, the round is already decided, staying quiet until the next one', 'round-decided'],
];
for (const [reason, kind] of EXPECT) {
  check(`  ${kind.padEnd(14)} <- ${reason.slice(0, 46)}`, t.kindOf(reason) === kind, `got "${t.kindOf(reason)}"`);
}

console.log('\nA REASON THAT LEAKS CONTENT IS NEVER STORED, ONLY COUNTED:');
// The real hazard: a future reject reason that interpolates something personal.
const LEAKY = [
  'said the death was at "A Heaven" but the player died at "B Market"',
  'used the callout "Hookah" which does not belong to the map Breeze',
  'the player TenZ#NA1 was told to hold Mid Top',
];
for (const reason of LEAKY) {
  const kind = t.kindOf(reason);
  const inClosedSet = t.REJECT_KINDS.some(([k]) => k === kind) || kind === 'other';
  check(`  reduced to "${kind}"`, inClosedSet && !/heaven|market|hookah|tenz|breeze/i.test(kind),
    'the raw reason survived into the stored kind');
}

console.log('\nthe published summary contains no content at all:');
t.record({ version: '2.9.9', durationMin: 12, tipsShown: 23, tipsGenerated: 73, rejects: REAL }, 'abcd1234ffff');
t.record({ version: '2.9.9', durationMin: 9, tipsShown: 12, tipsGenerated: 48,
  rejects: { 'used the callout "Hookah" which does not belong to the map Breeze': 4 } }, 'zzzz9999');
const s = t.summary();
const blob = JSON.stringify(s);
check('  no map, callout, agent or player name anywhere',
  !/hookah|breeze|bind|icebox|tenz|jett|iso|stay tight|peek/i.test(blob), blob.slice(0, 200));
check('  the licence tag is truncated to 8 characters',
  !/abcd1234ffff|zzzz9999z/.test(blob));

console.log('\nthe numbers that make it worth collecting:');
check('  show rate is computed', s.showRate === Math.round((35 / 121) * 100), `got ${s.showRate}`);
check('  sessions and users counted', s.sessions === 2 && s.distinctUsers === 2);
check('  rejects ranked with the biggest first',
  s.rejects[0].kind === 'similar' && s.rejects[0].n >= s.rejects[1].n);
check('  repetition is visible as the dominant failure',
  s.rejects.filter((r) => r.kind === 'similar' || r.kind === 'repeat-play')
    .reduce((a, r) => a + r.pct, 0) > 50);

console.log('\nmalformed input cannot take the endpoint down:');
check('  null report is ignored', (t.record(null, 'x'), true));
check('  junk fields are clamped, not stored',
  (t.record({ tipsShown: 1e9, durationMin: -5, rejects: null }, 'y'), t.summary().sessions === 3));

// ── The match recorder's sessions (8.3) ────────────────────────────────────
// The client's block, built by the client's own reportBlock() so the two
// cannot drift, then everything a careless or hostile client might add.
const { reportBlock, OUTCOMES, GAMES } = require(path.join(__dirname, '..', 'src', 'main', 'services', 'recorder.js'));
const before = JSON.stringify(t.summary());
const tipFields = (x) => { const { recording, ...rest } = x; return JSON.stringify(rest); };

console.log('\nthe recorder\'s block is counted, field by field, and kept apart from the tip era\'s:');
const block = reportBlock({ game: 'lol', mode: 'auto', res: '720', outcome: 'recorded', recordedMs: 41 * 60000 + 30000,
  fps: [29, 31, 30, 30.5], recorderCpu: [3.1, 2.9, 3.4], systemCpu: [40, 55, 61, 72, 90], encoderOk: true }, '8.3.0');
check('  the client sends exactly the ten fields, and no others',
  JSON.stringify(Object.keys(block).sort()) === JSON.stringify(['encoderOk', 'fpsP50', 'game', 'minutes', 'mode', 'outcome', 'recorderCpuP50', 'res', 'systemCpuP90', 'version']),
  JSON.stringify(block));
check('  the server knows the same outcomes and games the client can send',
  JSON.stringify(t.RECORDING_OUTCOMES) === JSON.stringify(OUTCOMES) && JSON.stringify(t.RECORDING_GAMES) === JSON.stringify(GAMES)
    && JSON.stringify(GAMES) === JSON.stringify(['valorant', 'lol']),
  `${t.RECORDING_OUTCOMES} against ${OUTCOMES}, ${t.RECORDING_GAMES} against ${GAMES}`);
check('  a session the client cannot name a game for is sent as Valorant\'s, never a word off its list',
  reportBlock({ outcome: 'off' }, '8.3.0').game === 'valorant' && reportBlock({ game: 'rivals', outcome: 'off' }, '8.3.0').game === 'valorant');
t.record(block, 'feedbeef00');
const row = t.recordingRows()[0];
check('  every field kept as sent: League, auto, 720, recorded, 41.5 minutes, the medians, the gate',
  row && row.version === '8.3.0' && row.game === 'lol' && row.mode === 'auto' && row.res === '720' && row.outcome === 'recorded'
    && row.minutes === 41.5 && row.fpsP50 === 30 && row.recorderCpuP50 === 3.1 && row.systemCpuP90 === 90
    && row.encoderOk === true && row.user === 'feedbeef', JSON.stringify(row));
check('  and it is not a tip era session: their counts are what they were',
  t.summary().sessions === 3 && tipFields(t.summary()) === tipFields(JSON.parse(before)), tipFields(t.summary()));

console.log('\nNOTHING OUTSIDE THE CLOSED LISTS OR THE NUMBERS GETS THROUGH:');
t.record({
  version: 'Hookah 1.0 TenZ#NA1', game: 'Breeze B Market', mode: 'manual', res: '3440x1440', outcome: 'busy in Breeze B Market',
  minutes: 1e9, fpsP50: -5, recorderCpuP50: 'lots', systemCpuP90: 150, encoderOk: 'yes',
  map: 'Breeze', agent: 'Jett', riotId: 'TenZ#NA1', frame: '/9j/4AAQSkZJRg', tip: 'stay tight on Hookah',
}, 'leaky123456');
// A block from before the game was sent: the nine fields, no game.
const nine = { version: '8.3.0', mode: 'off', res: 1080, outcome: 'off', minutes: 0, fpsP50: null, recorderCpuP50: '',
  systemCpuP90: undefined, encoderOk: null };
t.record(nine, 'offuser1');
t.record({ version: '8.3.1', game: 'valorant', mode: 'auto', res: '1080', outcome: 'busy', minutes: 12.34, fpsP50: 9.96,
  recorderCpuP50: 71.25, systemCpuP90: 97, encoderOk: true }, 'busyuser');
t.record({ version: '8.3.1', game: 'valorant', mode: 'auto', res: '720', outcome: 'no-hw-encoder', minutes: 0, fpsP50: null,
  recorderCpuP50: null, systemCpuP90: null, encoderOk: false }, 'nohwuser');
const rows = t.recordingRows();
const leaky = rows[1];
const KEYS = ['at', 'user', 'version', 'game', 'mode', 'res', 'outcome', 'minutes', 'fpsP50', 'recorderCpuP50', 'systemCpuP90', 'encoderOk'];
check('  a word off the list is the word other, a version that is not one is other',
  leaky.version === 'other' && leaky.game === 'other' && leaky.mode === 'other' && leaky.res === 'other' && leaky.outcome === 'other', JSON.stringify(leaky));
check('  an old client\'s nine field block is still a recorder session, every field kept as before, its game other',
  rows.length === 5 && rows[2].user === 'offuser1' && rows[2].version === '8.3.0' && rows[2].mode === 'off' && rows[2].outcome === 'off'
    && rows[2].minutes === 0 && rows[2].encoderOk === null && rows[2].game === 'other', JSON.stringify(rows[2]));
check('  every number clamped or dropped: 600 minutes, 0 fps, no CPU, 100%, no gate',
  leaky.minutes === 600 && leaky.fpsP50 === 0 && leaky.recorderCpuP50 === null && leaky.systemCpuP90 === 100 && leaky.encoderOk === null,
  JSON.stringify(leaky));
check('  and no other field is kept, in any row', rows.every((r) => JSON.stringify(Object.keys(r)) === JSON.stringify(KEYS)),
  rows.map((r) => Object.keys(r).join(',')).join(' | '));
check('  a resolution sent as a number is the same word, and an empty number is none',
  rows[2].res === '1080' && rows[2].recorderCpuP50 === null && rows[2].systemCpuP90 === null && rows[2].fpsP50 === null, JSON.stringify(rows[2]));
const rs = t.summary().recording;
const rblob = JSON.stringify(t.summary());
check('  the summary holds no map, agent, name, frame, tip or stray word',
  !/hookah|breeze|market|jett|tenz|9j\/4|stay tight|manual|3440|lots|leaky/i.test(rblob), rblob.slice(0, 300));

console.log('\nwhat makes it worth collecting: how PCs cope, by version:');
check('  outcomes counted, one each, the stray one as other',
  rs.outcomes.recorded === 1 && rs.outcomes.busy === 1 && rs.outcomes.off === 1 && rs.outcomes['no-hw-encoder'] === 1
    && rs.outcomes.other === 1 && rs.reports === 5, JSON.stringify(rs.outcomes));
check('  the share that recorded, of the sessions that tried (Auto): 1 of 3', rs.recordedShare === 33, `got ${rs.recordedShare}`);
// 30, the stray row's -5 clamped to 0, and 9.96 rounded to 10: a session
// with none (off, no encoder) is left out rather than counted as 0.
check('  the median frame rate across sessions, a session without one left out',
  rs.medianFps === 10, `fps ${rs.medianFps}`);
check('  the median recorder CPU and the median of the PC\'s p90',
  rs.medianRecorderCpu === 37.2 && rs.medianSystemCpuP90 === 97, `recorder ${rs.medianRecorderCpu}, PC ${rs.medianSystemCpuP90}`);
check('  by version: 8.3.0 recorded 1 of 1 that tried, 8.3.1 recorded 0 of 2',
  rs.byVersion['8.3.0'] && rs.byVersion['8.3.0'].reports === 2 && rs.byVersion['8.3.0'].recordedShare === 100
    && rs.byVersion['8.3.1'] && rs.byVersion['8.3.1'].recordedShare === 0 && rs.byVersion.other && rs.byVersion.other.reports === 1,
  JSON.stringify(rs.byVersion));
check('  the hardware gate, of the sessions that ran it: 2 of 3', rs.encoderOkShare === 67, `got ${rs.encoderOkShare}`);
check('  by game: League 1 recorded of 1, Valorant 0 of 2, the old block and the stray one as other',
  rs.byGame.lol && rs.byGame.lol.reports === 1 && rs.byGame.lol.recordedShare === 100
    && rs.byGame.valorant && rs.byGame.valorant.reports === 2 && rs.byGame.valorant.recordedShare === 0
    && rs.byGame.other && rs.byGame.other.reports === 2 && Object.keys(rs.byGame).length === 3,
  JSON.stringify(rs.byGame));
const shownBefore = t.summary().tipsShown;
t.record({ version: '2.9.9', durationMin: 5, tipsShown: 4, tipsGenerated: 8, rejects: { 'too similar to a recent tip': 2 } }, 'oldclient');
check('  an old client\'s report still counts as it always did, and as a tip era session only',
  t.summary().sessions === 4 && t.summary().tipsShown === shownBefore + 4 && t.summary().recording.reports === 5,
  JSON.stringify({ sessions: t.summary().sessions, shown: t.summary().tipsShown, recordings: t.summary().recording.reports }));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

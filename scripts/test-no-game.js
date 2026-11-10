'use strict';

/**
 * A START THAT NEVER REACHES A GAME IS CANCELLED (src/main/services/no-game-watch.js,
 * index.js controller.cancelNoGame; docs/claude/match-to-review.md, "A Start
 * that never reaches a game").
 *
 * Held here, offline, on a fake clock:
 *   the watch's rules at their boundaries: Riot's client and Valorant both
 *     gone for NO_GAME_PROCESS_MS cancels and a moment less does not; the game
 *     open in its menus (a LOBBY read lately) for MENUS_ONLY_MS cancels and a
 *     queue under it does not; a launcher still up (patching) never counts as
 *     gone; a probe that cannot tell never cancels; menus with no LOBBY read
 *     lately (reads failing, a capped account) never cancel; a pause restarts
 *     both clocks; and any reply that was not LOBBY disarms it for good, so a
 *     match (and so a game the server may have reserved) always wins
 *   the thresholds are the documented ones, and the notice has no dash and
 *     says nothing about a match
 *   the process list as tasklist prints it, read into game, launcher or none
 *   the real reader (coaching-engine.js): a LOBBY reply sets lastLobbyAt and
 *     leaves sawGame false, the first reply that is not LOBBY sets sawGame,
 *     and Start clears both. sawGame is a superset of the server's
 *     inMatchState (server/routes/coach.js), the only thing that reserves a
 *     live game, so a session the watch may cancel never reserved one
 *
 * check:nogame boots the real index.js for the rest: the recording and the AI
 * log discarded, no review, nothing claimed or released, the notice, Start
 * again at once, and no cancel while a match is under way.
 *
 * Run: npm run test:nogame
 */

const path = require('path');
const NG = require('../src/main/services/no-game-watch');

let fails = 0;
let checks = 0;
const ok = (cond, what, detail) => {
  checks++;
  if (!cond) { fails++; console.log(`FAIL  ${what}${detail ? `\n        ${detail}` : ''}`); } else console.log(`ok    ${what}`);
};
const MIN = 60 * 1000;
const T0 = Date.UTC(2026, 10, 9, 18, 0, 0);
const DASHES = new RegExp('[' + String.fromCharCode(0x2013) + String.fromCharCode(0x2014) + ']');

/** A watch on a fake clock, armed at T0, and a step that checks at a time. */
function watchAt() {
  let now = T0;
  const w = NG.createNoGameWatch({ now: () => now });
  w.arm();
  const at = (ms, s) => { now = T0 + ms; return w.check(s); };
  return { w, at };
}

console.log('\nthe thresholds:');
ok(NG.NO_GAME_PROCESS_MS === 5 * MIN, 'no Riot client and no Valorant: 5 minutes');
ok(NG.MENUS_ONLY_MS === 30 * MIN, 'the game open in its menus with nothing played: 30 minutes');
ok(NG.LOBBY_FRESH_MS === 2 * MIN && NG.TICK_MS === 15 * 1000, 'a LOBBY read counts for 2 minutes, checked every 15 seconds');
ok(typeof NG.NOTICE === 'string' && !DASHES.test(NG.NOTICE) && !/match|round|score/i.test(NG.NOTICE)
  && NG.NOTICE === 'Stopped watching: no game started. Press Start when you are ready.',
  'the notice is the calm line, no dash and nothing about a match', NG.NOTICE);
ok(DASHES.test(String.fromCharCode(0x2014)) && !DASHES.test('a-b'), 'and the dash detector matches a dash and not a hyphen');

console.log('\nthe game never opened:');
{
  const { at } = watchAt();
  const s = { sawGame: false, paused: false, inLobby: true, lastLobbyAt: 0, process: 'none' };
  ok(at(0, s) === null, 'Start with neither Riot client nor Valorant running: not yet');
  ok(at(5 * MIN - 1, s) === null, 'a moment under 5 minutes: not yet');
  const v = at(5 * MIN, s);
  ok(v && v.reason === 'no-game-process', '5 minutes with neither running: cancelled', JSON.stringify(v));
}
{
  const { at } = watchAt();
  ok(at(0, { process: 'none', inLobby: true }) === null && at(4 * MIN, { process: 'launcher', inLobby: true }) === null
    && at(8 * MIN, { process: 'none', inLobby: true }) === null,
  'Riot\'s client came up at minute 4 (launching, patching): the 5 minutes start again when it goes');
  const v = at(13 * MIN, { process: 'none', inLobby: true });
  ok(v && v.reason === 'no-game-process', 'and gone again for 5 minutes: cancelled', JSON.stringify(v));
}
{
  const { at } = watchAt();
  let any = null;
  for (let t = 0; t <= 25 * MIN; t += NG.TICK_MS) any = any || at(t, { process: 'launcher', inLobby: true, lastLobbyAt: T0 + t });
  ok(any === null, 'the Riot client open (a long patch, the launcher) for 25 minutes: never the 5 minute rule');
}
{
  const { at } = watchAt();
  let any = null;
  for (let t = 0; t <= 40 * MIN; t += NG.TICK_MS) any = any || at(t, { process: null, inLobby: false });
  ok(any === null, 'a probe that cannot tell (not Windows, tasklist failed) and no read: never cancelled');
}

console.log('\nthe game open, only menus (queueing):');
{
  const { at } = watchAt();
  let any = null;
  for (let t = 0; t < 30 * MIN; t += NG.TICK_MS) any = any || at(t, { process: 'game', inLobby: true, lastLobbyAt: T0 + t - 5000 });
  ok(any === null, 'queueing in the menus for 29 minutes and 45 seconds: never cancelled');
  const v = at(30 * MIN, { process: 'game', inLobby: true, lastLobbyAt: T0 + 30 * MIN - 5000 });
  ok(v && v.reason === 'menus', '30 minutes of nothing but menus: cancelled', JSON.stringify(v));
}
{
  const { at } = watchAt();
  ok(at(45 * MIN, { process: 'game', inLobby: true, lastLobbyAt: T0 + 45 * MIN - NG.LOBBY_FRESH_MS - 1 }) === null,
    'menus whose last LOBBY read is older than 2 minutes (reads failing, a capped account): not cancelled');
  ok(at(46 * MIN, { process: 'game', inLobby: false, lastLobbyAt: T0 + 46 * MIN }) === null,
    'the last reply not a LOBBY: not cancelled');
  ok(at(46 * MIN, { process: 'game', inLobby: true }) === null, 'no LOBBY read ever: not cancelled');
}

console.log('\na game seen always wins:');
{
  const { w, at } = watchAt();
  ok(at(3 * MIN, { sawGame: true, process: 'game', inLobby: true, lastLobbyAt: T0 }) === null, 'a reply that was not LOBBY at minute 3');
  let any = null;
  for (let t = 3 * MIN; t <= 120 * MIN; t += NG.TICK_MS) any = any || at(t, { sawGame: false, process: 'none', inLobby: true, lastLobbyAt: T0 + t });
  ok(any === null && !w.armed(), 'disarmed for good: two hours of menus with the game closed after it never cancel (the session is the player\'s after a match)');
}
{
  const { w, at } = watchAt();
  ok(at(10 * MIN, { sawGame: true, process: 'none', inLobby: true, lastLobbyAt: T0 + 10 * MIN }) === null && !w.armed(),
    'a game seen on the very tick the 5 minutes ran out: the game wins');
}
{
  const w = NG.createNoGameWatch({ now: () => T0 + 99 * MIN });
  ok(w.check({ process: 'none', inLobby: true, lastLobbyAt: T0 + 99 * MIN }) === null, 'never armed (League, or stopped): nothing');
}

console.log('\npaused:');
{
  const { at } = watchAt();
  ok(at(4 * MIN, { process: 'none' }) === null, 'four minutes of no game');
  ok(at(20 * MIN, { paused: true, process: 'none' }) === null, 'then paused for sixteen: nothing while paused');
  ok(at(24 * MIN, { process: 'none' }) === null && at(29 * MIN - 1, { process: 'none' }) === null,
    'resumed (seen at minute 24): the clocks start again there, a moment under 5 minutes on is not 5');
  const v = at(29 * MIN, { process: 'none' });
  ok(v && v.reason === 'no-game-process', 'and 5 minutes after the resume: cancelled', JSON.stringify(v));
  const { at: at2 } = watchAt();
  ok(at2(29 * MIN, { paused: true, process: 'game', inLobby: true, lastLobbyAt: T0 + 29 * MIN }) === null
    && at2(40 * MIN, { process: 'game', inLobby: true, lastLobbyAt: T0 + 40 * MIN }) === null,
  'menus: a pause at minute 29 restarts the 30 minutes too');
}

console.log('\nthe process list:');
{
  const csv = [
    '"System Idle Process","0","Services","0","8 K"',
    '"RiotClientServices.exe","1204","Console","1","98,112 K"',
    '"VALORANT-Win64-Shipping.exe","8812","Console","1","2,401,220 K"',
    '"Occlara.exe","2200","Console","1","180,000 K"',
  ].join('\r\n');
  const names = NG.parseTasklist(csv);
  ok(names.has('valorant-win64-shipping.exe') && names.has('riotclientservices.exe') && names.has('occlara.exe') && !names.has('0'),
    'tasklist /FO CSV /NH read into lower case image names', JSON.stringify([...names]));
  ok(NG.stateOf(names) === 'game', 'Valorant running: game');
  ok(NG.stateOf(NG.parseTasklist('"RiotClientServices.exe","1","Console","1","1 K"\r\n"RiotClientUx.exe","2","Console","1","1 K"')) === 'launcher',
    'only Riot\'s client: launcher');
  ok(NG.stateOf(NG.parseTasklist('"VALORANT.exe","1","Console","1","1 K"')) === 'launcher', 'the VALORANT.exe stub alone: launcher');
  ok(NG.stateOf(NG.parseTasklist('"explorer.exe","1","Console","1","1 K"\r\n"vgc.exe","2","Services","0","1 K"')) === 'none',
    'neither (Vanguard\'s service runs always and is no game): none');
  ok(NG.stateOf(NG.parseTasklist('')) === null && NG.stateOf(null) === null, 'an empty or missing list: cannot tell');
}

(async () => {
  console.log('\nthe probe:');
  {
    const got = await NG.probeValorant({ platform: 'linux', exec: () => { throw new Error('never run'); } });
    ok(got === null, 'not Windows: cannot tell, and nothing is run');
    const seen = [];
    const g = await NG.probeValorant({ platform: 'win32',
      exec: (file, args, opts, cb) => { seen.push([file, args, opts && opts.windowsHide]); cb(null, '"VALORANT-Win64-Shipping.exe","1","Console","1","1 K"'); } });
    ok(g === 'game' && seen.length === 1 && seen[0][0] === 'tasklist' && seen[0][2] === true,
      'Windows: tasklist, hidden, read for the game', JSON.stringify(seen));
    const e = await NG.probeValorant({ platform: 'win32', exec: (f, a, o, cb) => cb(new Error('denied')) });
    ok(e === null, 'tasklist failing: cannot tell');
  }

  // FILTERED, THE GAME FIRST (owner, 2026-11-09, "make recording lighter"):
  // the whole list cost 300 to 530 ms of CPU a probe, every 15 s; filtered by
  // name it is a sixth of that or less. Two /FI on one field AND together, so
  // the game's names and Riot's client are a call each, the client's only when
  // the game is absent. The verdicts are the ones the whole list gave.
  console.log('\nthe probe, filtered by name, the game first:');
  {
    const NO_MATCH = 'INFO: No tasks are running which match the specified criteria.\r\n';
    const row = (n) => `"${n}","1","Console","1","1 K"`;
    // A fake tasklist that answers each filter as the real one does, from a list of running names.
    const fakeExec = (running, seen, fail) => (file, args, opts, cb) => {
      seen.push({ file, args: args.slice(), hide: opts && opts.windowsHide });
      const at = args.indexOf('/FI');
      if (fail && fail(seen.length)) { cb(new Error('denied')); return; }
      if (at < 0) { cb(null, running.map(row).join('\r\n')); return; }
      const m = String(args[at + 1]).match(/^IMAGENAME eq (.+)$/i);
      const pat = m ? m[1].toLowerCase() : '';
      const hit = running.filter((n) => (pat.endsWith('*') ? n.toLowerCase().startsWith(pat.slice(0, -1)) : n.toLowerCase() === pat));
      cb(null, hit.length ? hit.map(row).join('\r\n') : NO_MATCH);
    };
    const filterOf = (call) => { const i = call.args.indexOf('/FI'); return i >= 0 ? call.args[i + 1] : null; };
    const ALL = ['System Idle Process', 'explorer.exe', 'vgc.exe', 'RiotClientServices.exe', 'VALORANT-Win64-Shipping.exe', 'Occlara.exe'];

    let seen = [];
    const game = await NG.probeValorant({ platform: 'win32', exec: fakeExec(ALL, seen) });
    ok(game === 'game' && seen.length === 1 && seen[0].file === 'tasklist' && seen[0].hide === true
      && filterOf(seen[0]) === 'IMAGENAME eq VALORANT*' && seen[0].args.includes('/NH') && seen[0].args.includes('CSV'),
    'the game running: one call, filtered to VALORANT*, and Riot\'s client is never asked', JSON.stringify(seen));

    seen = [];
    const stub = await NG.probeValorant({ platform: 'win32', exec: fakeExec(['explorer.exe', 'VALORANT.exe'], seen) });
    ok(stub === 'launcher' && seen.length === 1, 'the VALORANT.exe stub alone: launcher, from the first call', JSON.stringify(seen));

    seen = [];
    const client = await NG.probeValorant({ platform: 'win32', exec: fakeExec(['explorer.exe', 'RiotClientServices.exe', 'RiotClientUx.exe'], seen) });
    ok(client === 'launcher' && seen.length === 2 && filterOf(seen[0]) === 'IMAGENAME eq VALORANT*'
      && filterOf(seen[1]) === 'IMAGENAME eq RiotClient*',
    'only Riot\'s client: the game first, then RiotClient*, launcher', JSON.stringify(seen.map(filterOf)));

    seen = [];
    const none = await NG.probeValorant({ platform: 'win32', exec: fakeExec(['explorer.exe', 'vgc.exe', 'Occlara.exe'], seen) });
    ok(none === 'none' && seen.length === 2, 'neither (Vanguard\'s service is no game): none, after two calls', JSON.stringify(seen.map(filterOf)));

    seen = [];
    const secondFails = await NG.probeValorant({ platform: 'win32', exec: fakeExec(['explorer.exe'], seen, (n) => n === 2) });
    ok(secondFails === null && seen.length === 2, 'the game absent and the second call failing: cannot tell, never none');

    seen = [];
    const firstFails = await NG.probeValorant({ platform: 'win32', exec: fakeExec(ALL, seen, (n) => n === 1) });
    ok(firstFails === null && seen.length === 1, 'the first call failing: cannot tell, and nothing more is run');

    // A call that prints nothing at all is not tasklist saying no match.
    seen = [];
    const silent = await NG.probeValorant({ platform: 'win32', exec: (f, a, o, cb) => { seen.push(a); cb(null, ''); } });
    ok(silent === null && seen.length === 1, 'a call that prints nothing: cannot tell');
    seen = [];
    const silent2 = await NG.probeValorant({ platform: 'win32',
      exec: (f, a, o, cb) => { seen.push(a); cb(null, seen.length === 1 ? NO_MATCH : '  \r\n'); } });
    ok(silent2 === null && seen.length === 2, 'the game absent and the second call printing nothing: cannot tell');

    // The same verdicts as the whole list gave, for every mix.
    const mixes = [ALL, ['RiotClientServices.exe'], ['VALORANT.exe'], ['explorer.exe'], ['VALORANT-Win64-Shipping.exe'],
      ['RiotClientCrashHandler.exe', 'explorer.exe'], ['valorant-win64-shipping.exe', 'riotclientux.exe']];
    const differ = [];
    for (const mix of mixes) {
      const whole = NG.stateOf(NG.parseTasklist(mix.map(row).join('\r\n')));
      const got = await NG.probeValorant({ platform: 'win32', exec: fakeExec(mix, []) });
      if (got !== whole) differ.push({ mix, whole, got });
    }
    ok(differ.length === 0, `the filtered probe gives the whole list's verdict for all ${mixes.length} mixes`, JSON.stringify(differ));
  }

  console.log('\nthe real reader:');
  {
    const Module = require('module');
    const realLoad = Module._load;
    Module._load = function patched(request, parent, isMain) {
      if (request === './api-client') return { post: async () => ({ ok: true, status: 200, data: {} }), get: async () => ({ ok: false }) };
      return realLoad(request, parent, isMain);
    };
    let CoachingEngine;
    try { CoachingEngine = require('../src/main/services/coaching-engine.js'); } finally { Module._load = realLoad; }
    const realLog = console.log;
    console.log = () => {};
    let e;
    try {
      e = new CoachingEngine({ licenseKey: 'TEST', captureFunction: async () => null, experiments: () => ({}) });
      e.start();
      e.applyRead({ data: { lobby: true }, shot: null, at: T0 + 1000 });
      e.applyRead({ data: { lobby: true }, shot: null, at: T0 + 6000 });
    } finally { console.log = realLog; }
    ok(e.sawGame === false && e.lastLobbyAt === T0 + 6000 && e.inLobby === true,
      'two LOBBY replies: no game seen, the last LOBBY at its capture time', JSON.stringify({ saw: e.sawGame, at: e.lastLobbyAt }));
    console.log = () => {};
    try { e.applyRead({ data: { lobby: false, parsed: true, context: { phase: 'buy', clock: '0:40', teamScore: 0, enemyScore: 0 } }, shot: null, at: T0 + 9000 }); }
    finally { console.log = realLog; }
    ok(e.sawGame === true, 'a reply that is not LOBBY (the server\'s inMatchState is one of these): a game seen');
    console.log = () => {};
    try { e.applyRead({ data: { lobby: true }, shot: null, at: T0 + 12000 }); } finally { console.log = realLog; }
    ok(e.sawGame === true, 'and menus after it never take it back');
    console.log = () => {};
    try { e.stop(); e.start(); } finally { console.log = realLog; }
    ok(e.sawGame === false && e.lastLobbyAt === 0, 'a new Start forgets both');
    console.log = () => {};
    try { e.stop(); } finally { console.log = realLog; }
  }

  console.log(fails ? `\nFAIL: ${fails} of ${checks} no game checks failed` : `\nPASS: all ${checks} no game checks passed`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log(`FAIL  the test itself threw: ${e.stack || e}`); process.exit(1); });

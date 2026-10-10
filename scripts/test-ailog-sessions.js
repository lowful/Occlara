'use strict';

/**
 * The AI log's session browser, against a fixture directory.
 *
 * Three of these guard failures that produce a confident, wrong-looking-right
 * result rather than an error:
 *
 *   - listing sessions must not read frames. If it ever does, filling a dropdown
 *     costs 30MB+ of base64 through one IPC call and the window hangs on open
 *     with nothing in the log to say why.
 *   - the session id comes from a renderer. Joined onto a path unchecked, "../"
 *     reads outside the log folder entirely.
 *   - an id the log no longer keeps is gone, never the newest session in its
 *     place (8.2). That fallback was for a session pruned while its window was
 *     open, and a prune runs at every Start, after which the newest folder is
 *     the session being written: served in its place, past a seal that checked
 *     only the id asked for, it showed the match in progress mid match. So the
 *     session a read serves is decided first, and the seal on it.
 *
 * And for one match, which a review's eye opens (8.2), the read is stricter
 * still: only the match's frames, and { gone: true } once they are no longer
 * kept, because another match's frames would be shown under this one's name.
 * A review saved before 8.2 kept no place in the log, and is found by when its
 * match ended.
 *
 * Run: npm run test:ailog
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const store = require(path.join(__dirname, '..', 'src', 'main', 'services', 'ai-log-store.js'));

let fails = 0;
const ok = (cond, what) => { if (!cond) { fails++; console.log(`FAIL  ${what}`); } else console.log(`ok    ${what}`); };

// ── Fixture ─────────────────────────────────────────────────────────────────
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'occlara-ailog-'));
const jpeg = Buffer.from('ffd8ffe000104a464946', 'hex');   // enough to be a file

function makeSession(stamp, recs, mtime) {
  const dir = path.join(root, `session-${stamp}`);
  fs.mkdirSync(dir, { recursive: true });
  const records = recs.map((r, i) => {
    const frame = `frame-${String(i).padStart(4, '0')}.jpg`;
    fs.writeFileSync(path.join(dir, frame), jpeg);
    return { i, at: r.at, frame, state: r.state || {}, aiTip: '', shown: r.shown || null, reject: null };
  });
  fs.writeFileSync(path.join(dir, 'log.json'), JSON.stringify({ startedAt: records[0] && records[0].at, records }));
  fs.utimesSync(dir, mtime / 1000, mtime / 1000);
  return dir;
}

const T = Date.UTC(2026, 7, 10, 20, 0, 0);
// A REAL DEATH, not just a tip that mentions one. The listing used to count
// `shown.death` flags and call that "deaths", so a session with six real deaths
// and one review was labelled "2 deaths" in the picker while the log's own
// header said six: the same word for two different numbers, one of them wrong.
// The fixture now carries an actual alive-to-dead transition so both counts are
// exercised.
makeSession('2026-08-10T20-00-00-000Z', [
  { at: T, state: { map: 'Bind', locLabel: 'Hookah', playerAlive: true, playerHp: 100 } },
  // A DEATH LASTS. Dying ends your round, so the spectator HUD stays up until
  // the next one; at a ten second capture that is never a single frame, and the
  // detector requires either two frames or printed proof for exactly that reason.
  { at: T + 600000, state: { map: 'Bind', locLabel: 'Showers', playerAlive: false, phase: 'dead', aliveTell: 'spectating a teammate' },
    shown: { text: 'died', death: true } },
  { at: T + 610000, state: { map: 'Bind', locLabel: 'Showers', playerAlive: false, phase: 'dead', aliveTell: 'spectating a teammate' } },
], T);
makeSession('2026-08-12T21-35-10-405Z', [
  { at: T + 86400000, state: { map: 'Haven' } },
  { at: T + 86400000, state: { map: 'Lotus' } },
  { at: T + 86400000, state: { map: 'Abyss' } },
], T + 86400000);
// A session whose records were never written: it must still list, not crash.
const empty = path.join(root, 'session-2026-08-13T10-00-00-000Z');
fs.mkdirSync(empty);
fs.writeFileSync(path.join(empty, 'log.json'), JSON.stringify({ records: [] }));
fs.utimesSync(empty, (T + 172800000) / 1000, (T + 172800000) / 1000);
// A folder with no index at all is not a session.
fs.mkdirSync(path.join(root, 'session-broken'));

// ── Listing ─────────────────────────────────────────────────────────────────
const list = store.sessions(root, 'session-2026-08-12T21-35-10-405Z');
ok(list.length === 3, `lists the 3 real sessions and skips the index-less one (got ${list.length})`);
ok(list[0].id === 'session-2026-08-13T10-00-00-000Z', 'newest session comes first');

// THE size rule. Metadata carries counts, never pictures.
const listJson = JSON.stringify(list);
ok(!/frameData|base64|data:image/.test(listJson), 'the session list carries NO frame data');
ok(listJson.length < 2000, `the session list stays small (${listJson.length} bytes)`);

const bind = list.find((s) => s.id === 'session-2026-08-10T20-00-00-000Z');
ok(bind.frames === 3, `frame count is right (got ${bind.frames})`);
ok(bind.deaths === 1, `deaths counts what HAPPENED (got ${bind.deaths})`);
ok(bind.deathsReviewed === 1, `and deathsReviewed counts what the coach said (got ${bind.deathsReviewed})`);
ok(bind.mins === 10, `duration is read from the records (${bind.mins} min)`);
ok(bind.live === false, 'a finished session is not marked live');

// THE BUG THIS ASSERTION EXISTS FOR. This session's three frames each name a
// different map, which is what a real session looks like when the model
// flickers. Listing the raw reads labelled all five real sessions on this
// machine with two or three maps when every one of them was a single map, so a
// map must be corroborated before it is named at all.
const multi = list.find((s) => s.id === 'session-2026-08-12T21-35-10-405Z');
ok(multi.maps.length === 0, `three contradictory one-frame reads name no map (got ${JSON.stringify(multi.maps)})`);
ok(multi.live === true, 'the session being written is marked live');

// A session with a plurality and agreeing callouts DOES get named.
ok(bind.maps.join() === 'Bind', `a corroborated map is named (${JSON.stringify(bind.maps)})`);

// An empty session still gets a time, recovered from its folder name.
const blank = list.find((s) => s.id === 'session-2026-08-13T10-00-00-000Z');
ok(blank.frames === 0 && blank.at === Date.UTC(2026, 7, 13, 10, 0, 0),
  'an empty session lists with a time recovered from its folder name');

// ── Opening one ─────────────────────────────────────────────────────────────
const newest = store.read(root);
ok(newest.session === 'session-2026-08-13T10-00-00-000Z', 'no id opens the newest session');

const chosen = store.read(root, 'session-2026-08-10T20-00-00-000Z');
ok(chosen.session === 'session-2026-08-10T20-00-00-000Z', 'an id opens that session');
ok(chosen.records.length === 3, `its records come back (got ${chosen.records.length})`);
ok(String(chosen.records[0].frameData).startsWith('data:image/jpeg;base64,'),
  'frames ARE inlined when a session is opened');
ok(Array.isArray(chosen.sessions) && chosen.sessions.length === 3,
  'opening a session also returns the list, so the picker repaints');

// ── The id is untrusted ─────────────────────────────────────────────────────
const goneRead = (r) => r.gone === true && r.session === null && Array.isArray(r.records) && !r.records.length;
for (const bad of ['../../secrets', '..\\..\\secrets', '/etc/passwd', 'session-2026-08-10T20-00-00-000Z/../..']) {
  ok(goneRead(store.read(root, bad)), `a crafted id (${JSON.stringify(bad)}) is gone, never a path and never another session`);
}
ok(store.read(root, '').session === store.dirs(root)[0], 'an empty id is no id, and opens the newest');
// A SESSION PRUNED WHILE ITS WINDOW WAS OPEN (8.2) is gone, with the list
// beside it for the picker, and never the newest folder in its place.
const prunedRead = store.read(root, 'session-deleted-while-open');
ok(goneRead(prunedRead) && prunedRead.sessions.length === 3,
  'a pruned session is gone rather than the newest, and the list comes back for the picker');

// ── Pruning keeps the newest ────────────────────────────────────────────────
// A frameless session leaves a folder with no log.json. dirs() skips those on
// purpose, so a prune built on dirs() can never see them and they pile up
// forever in the one directory that exists to stay bounded. The app creates one
// every time it starts and stops before capturing a frame.
ok(fs.existsSync(path.join(root, 'session-broken')), 'the index-less folder is still on disk before pruning');
store.prune(root, 2);
const left = store.dirs(root);
ok(left.length === 2 && left[0] === 'session-2026-08-13T10-00-00-000Z',
  `prune keeps the 2 newest (${left.join(', ')})`);
ok(!fs.existsSync(path.join(root, 'session-broken')), 'and prune removes the frameless folder it cannot index');

// ── The live session is never pruned ────────────────────────────────────────
// The expensive one. A live session has no log.json until its first frame
// lands, so it matches the frameless rule above exactly. Between 3.3.0 and
// 3.9.0 startAiLog() created the folder and pruned on the very next line,
// which deleted the session it had just started. Every frame after that wrote
// into a path that no longer existed and the error went into the "a dropped
// frame is not worth interrupting coaching" catch. Two weeks of decision logs
// were lost in silence, and the only symptom was the log window showing
// nothing newer than the release that broke it.
const liveRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'occlara-ailog-live-'));
for (let i = 1; i <= 4; i++) {
  const d = path.join(liveRoot, 'session-keep-' + i);
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'log.json'), JSON.stringify({ records: [] }));
  fs.utimesSync(d, 1000 + i, 1000 + i);
}
const liveDir = path.join(liveRoot, 'session-live');
fs.mkdirSync(liveDir, { recursive: true });

store.prune(liveRoot, 5, 'session-live');
ok(fs.existsSync(liveDir), 'the session being recorded survives a prune');

// And it counts against the budget, or starting one always keeps keep+1.
ok(fs.readdirSync(liveRoot).length === 5,
  `the live session counts toward the cap (${fs.readdirSync(liveRoot).length} folders)`);

// Without being named it is indistinguishable from a frameless leftover, which
// is why the caller must pass it rather than relying on ordering.
const naiveDir = path.join(liveRoot, 'session-unnamed');
fs.mkdirSync(naiveDir, { recursive: true });
store.prune(liveRoot, 5);
ok(!fs.existsSync(naiveDir), 'an unnamed frameless folder is still removed');

fs.rmSync(liveRoot, { recursive: true, force: true });

// ── One match of a session, for a review's eye (8.2) ───────────────────────
// Session A holds two matches back to back, as the engine writes them: every
// record carries its match's stamp (the moment the engine began that match),
// and the frame read as match 1 ended was logged after the engine had begun
// match 2, so it carries match 2's stamp with a capture time inside match 1.
// Session B is a later session with a match of its own.
const scopeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'occlara-ailog-scope-'));
const M1 = Date.UTC(2026, 9, 1, 18, 0, 0);
const E1 = M1 + 30 * 60000;          // match 1 ends half an hour in
const M2 = E1 + 4;                   // the engine begins match 2 at once
const E2 = M2 + 25 * 60000;
const M3 = E2 + 2 * 3600000;         // a later session's match
const E3 = M3 + 20 * 60000;
const ALIVE = { map: 'Abyss', playerAlive: true, playerHp: 100, teamScore: 3, enemyScore: 2 };
const DEAD = { map: 'Abyss', playerAlive: false, phase: 'dead', aliveTell: 'killed by Jett, spectating a teammate', teamScore: 3, enemyScore: 2 };
const LOTUS = { map: 'Lotus', playerAlive: true, playerHp: 100, teamScore: 1, enemyScore: 1 };
function writeSession(name, recs, mtime, opts) {
  const dir = path.join(scopeRoot, name);
  fs.mkdirSync(dir, { recursive: true });
  const records = recs.map((r, i) => {
    const frame = `frame-${String(i).padStart(5, '0')}.jpg`;
    if (!(opts && opts.noFrames)) fs.writeFileSync(path.join(dir, frame), jpeg);
    return { i, at: r.at, frame, state: r.state, round: 4, died: false, match: r.match };
  });
  fs.writeFileSync(path.join(dir, 'log.json'), JSON.stringify({ startedAt: records[0].at, records }));
  fs.utimesSync(dir, mtime / 1000, mtime / 1000);
  return dir;
}
const A = 'session-2026-10-01T17-59-00-000Z';
const B = 'session-2026-10-01T21-00-00-000Z';
const aDir = writeSession(A, [
  // Match 1: alive, a death that lasts two frames, alive again. Its last
  // frame under its own stamp is half a minute before it ended.
  { at: M1 + 60000, state: ALIVE, match: M1 },
  { at: M1 + 70000, state: ALIVE, match: M1 },
  { at: M1 + 80000, state: DEAD, match: M1 },
  { at: M1 + 90000, state: DEAD, match: M1 },
  { at: E1 - 30000, state: ALIVE, match: M1 },
  // Read as match 1 ended, logged under match 2's stamp.
  { at: E1 - 500, state: ALIVE, match: M2 },
  // Match 2, on Lotus, no death.
  { at: M2 + 60000, state: LOTUS, match: M2 },
  { at: M2 + 70000, state: LOTUS, match: M2 },
  { at: E2 - 20000, state: LOTUS, match: M2 },
], E2);
writeSession(B, [
  { at: M3 + 60000, state: ALIVE, match: M3 },
  { at: E3 - 10000, state: ALIVE, match: M3 },
], E3);

// What a review keeps at its match's end (index.js) is what the read is handed back.
const place1 = store.placeOf(aDir, M1, E1);
ok(place1 && place1.session === A && place1.match === M1 && place1.from === M1 && place1.to === E1,
  `a review keeps its session folder, its match's stamp and its window (${JSON.stringify(place1)})`);
ok(store.placeOf(null, M1, E1) === null && store.placeOf(aDir, null, E1) === null,
  'and nothing when the log was off or the match has no window');

const one = store.read(scopeRoot, A, null, place1);
const ats = (log) => (log.records || []).map((r) => r.at);
ok(one.scoped === true && one.session === A && !one.gone, 'a scoped read opens that session, marked scoped');
ok(JSON.stringify(ats(one)) === JSON.stringify([M1 + 60000, M1 + 70000, M1 + 80000, M1 + 90000, E1 - 30000, E1 - 500]),
  `only match 1's frames, the one read as it ended included (${ats(one).length} frames)`);
ok(one.records.every((r) => String(r.frameData).startsWith('data:image/jpeg;base64,')), 'each one inlined');
ok(one.deaths.length === 1 && one.deaths[0].at === 2 && one.records[2].at === M1 + 80000,
  'its deaths are its own, indexed into its own frames');
ok(Array.isArray(one.sessions) && !one.sessions.length, 'and it lists no sessions, since the picker is not shown');

const two = store.read(scopeRoot, A, null, store.placeOf(aDir, M2, E2));
ok(JSON.stringify(ats(two)) === JSON.stringify([M2 + 60000, M2 + 70000, E2 - 20000]),
  'match 2 gets its own frames, and not the one read as match 1 ended though it carries match 2\'s stamp');
ok(!two.deaths.length && two.segments.every((s) => s.map !== 'Abyss'), 'with no death and nothing of match 1\'s map');

// A FALSE END. The engine resumed a match it had ended too early, and the
// frames read in between carry the stamp of the match it thought had begun.
// The review of the whole match covers them by its window.
const resumed = store.read(scopeRoot, A, null, { match: M1, from: M1, to: E2 });
ok(resumed.records.length === 9, `a match whose window covers frames under another stamp gets them (${resumed.records.length} of 9)`);

// GONE, and never another session's frames in their place.
const goneOf = (log) => log.gone === true && log.session === null && !log.records.length;
ok(goneOf(store.read(scopeRoot, 'session-2026-09-01T10-00-00-000Z', null, place1)),
  'a pruned session is gone');
ok(goneOf(store.read(scopeRoot, 'session-2026-09-01T10-00-00-000Z')),
  'and so it is read whole, since 8.2: neither read stands another session in for one that is gone');
ok(goneOf(store.read(scopeRoot, B, null, place1)), 'a kept session that does not hold the match is gone, not shown');
for (const bad of ['../../secrets', '/etc/passwd', `${A}/../..`, '']) {
  ok(goneOf(store.read(scopeRoot, bad, null, place1)), `a crafted id (${JSON.stringify(bad)}) is gone, never a path`);
}
for (const bad of [{ gone: true }, { match: 'x', from: M1, to: E1 }, { match: M1, from: M1 }, { match: M1, from: M1, to: Infinity }]) {
  ok(goneOf(store.read(scopeRoot, A, null, bad)), `a scope that is not three numbers is gone (${JSON.stringify(bad)})`);
}
writeSession('session-2026-10-01T12-00-00-000Z', [
  { at: M1 + 60000, state: ALIVE, match: M1 }, { at: M1 + 70000, state: ALIVE, match: M1 },
], M1 + 70000, { noFrames: true });
ok(goneOf(store.read(scopeRoot, 'session-2026-10-01T12-00-00-000Z', null, place1)),
  'records whose frames are no longer on disk are gone too');

// ── A review saved before 8.2, found by when its match ended ───────────────
const spansA = store.matchesIn(scopeRoot, A);
ok(JSON.stringify(spansA.map((s) => [s.match, s.frames])) === JSON.stringify([[M1, 5], [M2, 4]])
  && spansA[0].last === E1 - 30000, 'a session lists its matches from its index alone, by stamp');
const kept = [{ id: A, spans: spansA }, { id: B, spans: store.matchesIn(scopeRoot, B) }];
ok(JSON.stringify(store.locate(kept, E1)) === JSON.stringify(place1),
  'match 1, from its end alone, is the scope its review would have kept');
ok(JSON.stringify(store.locate(kept, E2)) === JSON.stringify(store.placeOf(aDir, M2, E2)), 'and match 2 is match 2');
ok(store.locate(kept, M2).match === M1, 'an end at the next match\'s stamp is still the match before it');
ok(store.locate(kept, E2 + store.END_GAP_MS + 60000) === null,
  'a review whose end is long after every kept frame finds nothing, rather than the nearest match');
ok(store.locate(kept, M1) === null && store.locate(kept, null) === null, 'nor does one from before them, or with no end');
ok(store.locate(kept, E3).session === B, 'a later session\'s match is found in that session');

// Which review gets which eye, and what it opens.
const look = { calls: 0 };
const finished = () => { look.calls++; return kept; };
const own = { valorant: true, source: 'watched', at: E1, aiLog: place1 };
ok(store.scopeFor({ ...own, source: 'riot' }, [A], finished) === null, 'a match graded from Riot\'s record alone has no log to open');
ok(store.scopeFor({ ...own, valorant: false }, [A], finished) === null, 'nor does Marvel Rivals or League');
ok(store.scopeFor(own, [A, B], finished) === place1, 'a review that kept its place opens it while the session is kept');
ok(store.scopeFor(own, [B], finished) === false, 'and is gone once the session is pruned');
// THE LOG OFF IS NO EYE, null, as for a match graded from Riot's record alone:
// false is the disabled eye whose tooltip says the log was pruned, and with the
// log off nothing was ever written to prune and the review looked at no frame.
ok(store.scopeFor({ ...own, aiLog: null }, [A, B], finished) === null, 'one recorded with the log off has no log to open, and so no eye');
ok(look.calls === 0, 'and none of those looks through the sessions');
const listed = { calls: 0 };
const folders = () => { listed.calls++; return [A, B]; };
ok(store.scopeFor({ ...own, valorant: false }, folders, finished) === null && listed.calls === 0
  && store.scopeFor(own, folders, finished) === place1 && listed.calls === 1,
'the kept folders can be handed as a function, read only for a review that can have a log');
const old = store.scopeFor({ valorant: true, source: 'watched', at: E1 }, [A, B], finished);
ok(JSON.stringify(old) === JSON.stringify(place1) && look.calls === 1, 'one saved before 8.2 is looked up by its end');
ok(store.scopeFor({ valorant: true, at: E2 + 3600000 }, [A, B], finished) === false, 'and is gone when no kept session holds it');
fs.rmSync(scopeRoot, { recursive: true, force: true });

// ── Which session a read serves, and the seal on it (8.2) ──────────────────
// Three kept sessions, the newest by folder time being the one recorded right
// now, as it always is while it is written: a frame lands every second. And an
// id pruned at a Start while its window was open. The log used to serve that
// id as the newest folder, past a seal that knew only the live session's own
// id, so pressing Whole session mid match showed the match being played, and a
// question sent one of its frames to the coach.
const servedRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'occlara-ailog-served-'));
const S0 = Date.UTC(2026, 9, 3, 18, 0, 0);
function servedLog(name, map, n, mtime) {
  const dir = path.join(servedRoot, name);
  fs.mkdirSync(dir, { recursive: true });
  const stamp = mtime - n * 10000;
  const records = Array.from({ length: n }, (_v, i) => {
    const frame = `frame-${String(i).padStart(5, '0')}.jpg`;
    fs.writeFileSync(path.join(dir, frame), jpeg);
    return { i, at: stamp + i * 10000, frame, state: { map, playerAlive: true, playerHp: 100 }, round: 2, died: false, match: stamp };
  });
  fs.writeFileSync(path.join(dir, 'log.json'), JSON.stringify({ startedAt: stamp, records }));
  fs.utimesSync(dir, mtime / 1000, mtime / 1000);
  return { match: stamp, from: stamp, to: mtime };
}
const OLDS = 'session-2026-10-03T17-00-00-000Z';
const PAST = 'session-2026-10-03T19-00-00-000Z';
const LIVE = 'session-2026-10-03T21-00-00-000Z';
const PRUNED = 'session-2026-10-02T17-00-00-000Z';
servedLog(OLDS, 'Bind', 3, S0 + 3600000);
const pastMatch = servedLog(PAST, 'Lotus', 4, S0 + 2 * 3600000);
const liveMatch = servedLog(LIVE, 'Ascent', 7, S0 + 4 * 3600000);
const keptNow = store.dirs(servedRoot);
const sameAs = (a, b) => JSON.stringify(a) === JSON.stringify(b);
ok(sameAs(keptNow, [LIVE, PAST, OLDS]), 'the session being recorded is the newest folder, as it is while it is written');

// The rule, before anything is read.
ok(sameAs(store.served(keptNow, PRUNED, LIVE, false), { id: null, refused: 'gone' }),
  'a pruned id is gone, never the newest folder, which is the session being recorded');
ok(sameAs(store.served(keptNow, PRUNED, LIVE, true), { id: null, refused: 'gone' }), 'and gone mid match too, decided before the seal');
ok(sameAs(store.served(keptNow, LIVE, LIVE, true), { id: null, refused: 'sealed' }), 'mid match the session being recorded is sealed, asked for by name');
ok(sameAs(store.served(keptNow, undefined, LIVE, true), { id: null, refused: 'sealed' }), 'and asked for as the newest, which it is');
ok(sameAs(store.served(keptNow, PAST, LIVE, true), { id: PAST }), 'a finished session is served mid match');
ok(sameAs(store.served(keptNow, undefined, LIVE, false), { id: LIVE }) && sameAs(store.served(keptNow, LIVE, LIVE, false), { id: LIVE }),
  'between matches the session being recorded is served, named or as the newest');
ok(sameAs(store.served([], undefined, null, true), { id: null }), 'and with nothing kept, nothing');

// A whole session, as the viewer is served it (main's getAiLog).
const listedIds = (log) => (log.sessions || []).map((s) => s.id);
const prunedOpen = store.serve(servedRoot, PRUNED, LIVE, false);
ok(goneRead(prunedOpen) && !prunedOpen.sealed && sameAs(listedIds(prunedOpen), [LIVE, PAST, OLDS]),
  'a pruned id is served nothing, never the session being recorded, with the list for the picker');
const prunedMid = store.serve(servedRoot, PRUNED, LIVE, true);
ok(goneRead(prunedMid) && sameAs(listedIds(prunedMid), [PAST, OLDS]),
  'mid match a pruned id is served no frame of the match in progress, nor the session in its list');
const liveMid = store.serve(servedRoot, LIVE, LIVE, true);
const newestMid = store.serve(servedRoot, undefined, LIVE, true);
ok(liveMid.sealed === true && liveMid.session === PAST && liveMid.records.length === 4,
  'mid match the session being recorded, asked for by name, is the newest finished one in its place, marked sealed');
ok(newestMid.sealed === true && newestMid.session === PAST && newestMid.records.length === 4,
  'and so is asking for the newest, as the log has always opened mid match');
ok(sameAs(listedIds(liveMid), [PAST, OLDS]) && sameAs(listedIds(newestMid), [PAST, OLDS]), 'and neither lists the session being recorded');
// A finished session picked mid match lists no Current entry either: its
// map, frames and death count are the match being played, recounted on every
// pick, where the sealed answer and the picker's own list always left it out.
const oldMid = store.serve(servedRoot, OLDS, LIVE, true);
ok(oldMid.session === OLDS && !oldMid.sealed && !oldMid.gone && oldMid.records.length === 3,
  'mid match a finished session asked for is served as itself, not sealed');
ok(sameAs(listedIds(oldMid), [PAST, OLDS]) && !oldMid.sessions.some((s) => s.live),
  'and its list carries nothing of the session being recorded');
const liveOpen = store.serve(servedRoot, LIVE, LIVE, false);
ok(liveOpen.session === LIVE && !liveOpen.sealed && liveOpen.records.length === 7 && liveOpen.sessions[0].live === true,
  'between matches the session being recorded is served, and listed as the current one');
const lonelyRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'occlara-ailog-lonely-'));
fs.cpSync(path.join(servedRoot, LIVE), path.join(lonelyRoot, LIVE), { recursive: true });
ok(sameAs(store.serve(lonelyRoot, undefined, LIVE, true), { records: [], sessions: [], sealed: true }),
  'mid match with no finished session kept, nothing is served, marked sealed');
fs.rmSync(lonelyRoot, { recursive: true, force: true });

// The frames a question is answered from (main's askAboutFrame).
const askPruned = store.askAbout(servedRoot, PRUNED, null, LIVE, false);
ok(askPruned.refused === 'gone' && !askPruned.records.length,
  'a question about a pruned session is refused as gone, and no frame of another goes with it');
ok(store.askAbout(servedRoot, PRUNED, null, LIVE, true).refused === 'gone', 'gone before sealed, mid match');
ok(store.askAbout(servedRoot, LIVE, null, LIVE, true).refused === 'sealed', 'mid match the session being recorded is sealed');
ok(store.askAbout(servedRoot, '', null, LIVE, false).refused === 'gone' && store.askAbout(servedRoot, undefined, null, LIVE, false).refused === 'gone',
  'a question naming no session is answered from none, never the newest');
const askPast = store.askAbout(servedRoot, PAST, null, LIVE, true);
ok(!askPast.refused && askPast.records.length === 4 && askPast.records.every((r) => String(r.frameData).startsWith('data:image/jpeg;base64,')),
  'mid match a finished session is asked about, on its own frames');
ok(!store.askAbout(servedRoot, LIVE, null, LIVE, false).refused, 'and between matches the session being recorded is');
const askScoped = store.askAbout(servedRoot, PAST, pastMatch, LIVE, true);
ok(!askScoped.refused && askScoped.records.length === 4, 'one match of a finished session is asked about on that match\'s frames');
ok(store.askAbout(servedRoot, LIVE, liveMatch, LIVE, true).refused === 'sealed', 'one match of the session being recorded is sealed mid match');
ok(store.askAbout(servedRoot, PRUNED, pastMatch, LIVE, false).refused === 'gone', 'and one match of a pruned session is gone');
fs.rmSync(servedRoot, { recursive: true, force: true });

// MAIN READS THROUGH THESE, asserted against the real source as test:games
// does for start(): a whole session read straight off the store, or a seal
// checked on the id asked for, would let the match in progress through again.
const mainSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'index.js'), 'utf8');
const between = (src, head, tail) => {
  const i = src.indexOf(head);
  const j = i < 0 ? -1 : src.indexOf(tail, i + head.length);
  return j < 0 ? '' : src.slice(i, j);
};
ok(between('x\n  f(a) {\n    body;\n  },\n  g() {}', '\n  f(a) {', '\n  },') === '\n  f(a) {\n    body;',
  'the source cutter finds a method\'s body');
const getAiLogSrc = between(mainSrc, '\n  getAiLog(id, scope) {', '\n  },');
const askSrc = between(mainSrc, '\n  async askAboutFrame(payload) {', '\n  },');
const confirmSrc = between(mainSrc, '\nasync function confirmDeaths(id, scope) {', '\n}');
ok(getAiLogSrc.includes('aiLogStore.serve(aiLogRoot(), id, aiLogLiveId(), liveLogSealed())') && !getAiLogSrc.includes('aiLogSessions('),
  'main serves a whole session through serve(), the seal decided on the session served');
ok(askSrc.includes('aiLogStore.askAbout(aiLogRoot(), p.session, p.scope, aiLogLiveId(), liveLogSealed())')
  && askSrc.indexOf('aiLogStore.askAbout(') < askSrc.indexOf('/api/coach/frame-chat'),
'its frame chat reads its frames through askAbout(), before anything is sent');
ok(confirmSrc.includes('aiLogStore.served(aiLogStore.dirs(aiLogRoot()), id, aiLogLiveId(), liveLogSealed())'),
  'its death check picks its session through served()');
ok(!mainSrc.includes('readAiLog('), 'and main keeps no reader of its own that could forgive an id');

// ── Missing root ────────────────────────────────────────────────────────────
ok(store.sessions(path.join(root, 'nope')).length === 0, 'a missing log folder lists nothing');
ok(store.read(path.join(root, 'nope')).records.length === 0, 'a missing log folder reads nothing');

fs.rmSync(root, { recursive: true, force: true });
console.log(fails ? `\n${fails} failure(s)` : '\nall ai-log session checks passed');
process.exit(fails ? 1 : 0);

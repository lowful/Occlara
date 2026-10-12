'use strict';

/**
 * A review's clips (8.3), offline: what each is called, which seconds it
 * covers, how it is kept beside its review and under the cap, how a page is
 * told to play it or that it is gone, and the scheme that serves it by range.
 *
 * The numbers asserted are the SPEC's, written here and never read back from
 * the module: 11 seconds before a death to 4 after it, six clips a review at
 * most, a cap of 5, 10, 20 or 50 GB with 10 the default, the oldest review's
 * clips the first to go, video/x-matroska. So a constant moved in the module
 * fails a line here.
 *
 * Held here:
 *   the names a clip may have, and every name it may not (a frame, a path, a
 *     temp file, another type)
 *   when a look's death was: Riot's second off the frame before it, on the
 *     real Abyss match; on the real Split session, replayed through the real
 *     reader, a Riot look the clock could not frame (a post plant death, a
 *     buy timer read as the round clock) at its registering frame, its clip
 *     holding the death; on the real Abyss session, a death after the plant
 *     given no gap whatever its frame's clock reads; each between the frame
 *     before and the one after, where a look has both; the screen's
 *     registering frame; two seconds after a frame alone
 *   the clips cut for a review's looks: the window asked of the recording,
 *     six at most, nothing written once the review is withdrawn, a moment the
 *     recording never held left out; and one cut from the real recording of a
 *     canvas reads as a clip that covers its window
 *   the recorder cuts a moment out of the recording that holds it, when a
 *     window reaches into the one before (a pause between them), and out of
 *     none that does not: a death seconds after a recording ended, or before
 *     it began, has no clip
 *   no clip once the player chose Off, and Auto turning itself off is not that
 *   the store: a clip written by path into its review's folder and nowhere
 *     else, gone with its review (removed, or pushed out of the library),
 *     the last look's clips kept and an earlier look's that it replaced gone
 *   the cap: past it the oldest review's clips go first, a folder no review
 *     owns before any, each review that lost them keeps its frames and facts
 *     and says why; Clear clips takes every one and says so
 *   a late link: the clips its cards name kept, the one of a look Riot
 *     contradicts gone
 *   the review as a page is shown it: a clip on disk played from its URL, one
 *     cleared said to be, one merely missing left out, the review handed in
 *     unchanged
 *   valorant-review.js carries a look's clip onto its card, and never a path
 *   the scheme: the URL, ranges as HTTP reads them, 206 and 416 and the
 *     clip's type, and a 404 for anything that is not a clip of a review
 *
 * Run: npm run test:clips
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const util = require('util');

const clips = require('../src/shared/clips');
const webm = require('../src/shared/webm');
const scheme = require('../src/main/services/clip-scheme');
const reviewClips = require('../src/main/services/review-clips');
const { ReviewStore, newId, MAX_REVIEWS } = require('../src/main/services/review-store');
const { Recorder, Segment } = require('../src/main/services/recorder');
const deathFrames = require('../src/shared/death-frames');
const clipFrames = require('../src/shared/clip-frames');
const lookStills = require('../src/main/services/look-stills');
const verify = require('../src/shared/valorant-verify');
const valorantReview = require('../src/shared/valorant-review');
const riotReview = require('../src/shared/riot-review');
const { replay, load } = require('./fixtures/replay-match');
const { replaySession } = require('./fixtures/replay-session');

let fails = 0;
let checks = 0;
let finished = false;
process.on('exit', () => {
  if (finished) return;
  console.log('FAIL  the run ended before its last check: something awaited never settled');
  process.exitCode = 1;
});
const ok = (cond, what, detail) => {
  checks++;
  if (!cond) { fails++; console.log(`FAIL  ${what}${detail ? `\n        ${detail}` : ''}`); } else console.log(`ok    ${what}`);
};
const same = (a, b) => util.isDeepStrictEqual(a, b);
// Main's own source, read for what it does (recordingStills, the look run in a
// sandbox), its lines ended as the checks below cut it. Git on Windows writes
// it with CRLF (core.autocrlf), and cut on '\n}\n' those checks found no
// function end at all and failed with main unchanged.
const lfOf = (text) => String(text).replace(/\r\n/g, '\n');
const mainText = () => lfOf(fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'index.js'), 'utf8'));
async function section(title, fn) {
  console.log(`\n${title}`);
  try { await fn(); } catch (e) { ok(false, 'the section ran to the end', (e && e.stack) || String(e)); }
}

// ── The spec's numbers ──────────────────────────────────────────────────────
const SPEC = { beforeMs: 11000, afterMs: 4000, max: 6, capsGB: [5, 10, 20, 50], defaultGB: 10, mime: 'video/x-matroska' };
const GB = 1024 ** 3;
// The two dashes the house rules ban, built from their code points so this file carries neither.
const DASHES = new RegExp('[' + String.fromCharCode(0x2013) + String.fromCharCode(0x2014) + ']');

const FIXTURE = path.join(__dirname, 'fixtures', 'recording-canvas.mkv');
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'occlara-clips-'));
process.on('exit', () => { try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* the OS clears it */ } });
let dirSeq = 0;
const freshDir = () => { const d = path.join(tmpRoot, `r${++dirSeq}`); fs.mkdirSync(d, { recursive: true }); return d; };

const T0 = Date.UTC(2026, 9, 10, 18, 0, 0);

/** A plain review, in the library's shape, with a look on round 2 and 9 that each name a clip. */
function reviewOf(id, at, extra) {
  return {
    id, at, kind: 'valorant', source: 'watched', game: { map: 'Abyss', agent: 'Jett', result: 'Defeat', score: '11-13' },
    rounds: [
      { n: 2, facts: ['Died at A Site'], reads: [], forensics: { cause: 'dry-peek', what: 'You swung wide.', better: 'Wait.', frames: ['r2-before.jpg'], source: 'screen', at, clip: 'r2-clip.mkv' } },
      { n: 5, facts: ['Survived'], reads: [], forensics: null },
      { n: 9, facts: ['Died at B Main'], reads: [], forensics: { cause: 'isolated', what: 'Alone.', better: 'Hold with a teammate.', frames: ['r9-before.jpg'], source: 'screen', at, clip: 'r9-clip.mkv' } },
    ],
    grade: { score: 61, letter: 'C', provisional: false, categories: [] },
    insights: { mistakes: [{ key: 'cause:isolated', title: 'Caught alone', detail: '1 of 2 deaths' }], strengths: [], missed: [] },
    ...(extra || {}),
  };
}
const b64 = (s) => Buffer.from(s).toString('base64');

(async () => {
  await section('the names a clip may have:', () => {
    ok(clips.CLIP_RE.test('r2-clip.mkv') && clips.CLIP_RE.test('r24-clip.mkv') && clips.CLIP_RE.test('r100-clip.mkv') && clips.CLIP_RE.test('d1-clip.mkv'),
      'a round\'s clip and a League death\'s: r2-clip.mkv, r24-clip.mkv, r100-clip.mkv, d1-clip.mkv');
    const never = ['r2-before.jpg', 'r2-clip.mkv.tmp', '../r2-clip.mkv', 'r2-clip.mkv/x', 'sub/r2-clip.mkv', 'R2-clip.mkv', 'x2-clip.mkv',
      'r-clip.mkv', 'r1000-clip.mkv', 'r2-clip.webm', 'r2-clip.mp4', 'r2clip.mkv', ' r2-clip.mkv', 'r2-clip.mkv ', '', 'index.json'];
    ok(never.every((n) => !clips.CLIP_RE.test(n)), 'and none of a frame, a temp file, a path, another letter, another type, a padded name', never.filter((n) => clips.CLIP_RE.test(n)).join(', '));
    ok(clips.roundClip(2) === 'r2-clip.mkv' && clips.roundClip('14') === 'r14-clip.mkv' && clips.deathClip(3) === 'd3-clip.mkv'
      && clips.roundClip(0) === null && clips.roundClip(2.5) === null && clips.roundClip('x') === null && clips.deathClip(-1) === null,
    'named for their round or death, and nothing for anything else');
    ok(same(clips.CAPS_GB, SPEC.capsGB) && clips.capGB(undefined) === SPEC.defaultGB && clips.capGB('20') === 20 && clips.capGB(50) === 50
      && clips.capGB(7) === SPEC.defaultGB && clips.capGB('lots') === SPEC.defaultGB, 'the cap is 5, 10, 20 or 50 GB, and 10 for anything else');
    ok(clips.MAX_CLIPS === SPEC.max && clips.MIME === SPEC.mime, 'six clips a review at most, served as video/x-matroska');
    const w = clips.windowOf(T0);
    ok(w && w.from === T0 - SPEC.beforeMs && w.to === T0 + SPEC.afterMs && clips.windowOf(NaN) === null,
      'a clip covers 11 seconds before the death to 4 after it');
    const nums = (n) => Array.from({ length: n }, (_v, i) => i + 1);
    ok(same(clips.pickSpread(nums(3), 6), [1, 2, 3]) && same(clips.pickSpread(nums(10), 6), [1, 3, 5, 6, 8, 10])
      && same(clips.pickSpread(nums(7), 6), [1, 2, 3, 5, 6, 7]) && same(clips.pickSpread(nums(10), 1), [1]) && same(clips.pickSpread(null, 6), []),
    'a League game\'s deaths: all of them when six or fewer, else six spread from the first to the last');
  });

  await section('when a look\'s death was:', () => {
    // RIOT'S DEATH ON THE WALL CLOCK (8.3.1): its round's barriers dropping,
    // read off every frame of the round that shows the round clock, plus Riot's
    // own milliseconds (death-frames.js barrierDrop, deathMoment), laid beside
    // the reconciled rounds as index.js lays them (withRiotTimes).
    //
    // THE REAL SUNSET MATCH, read once a second by 8.3.0 and recorded, through
    // the real reader. Its clips show the deaths of rounds 2, 3, 6 and 7 at
    // 163.5, 252.62, 518.1 and 614.7 s, matched to its AI log frame by frame.
    // Riot's record of it is not in the repo: each death's milliseconds here
    // are the seconds from its round's buy timer reading 0:00, the barriers'
    // last second, to the death its clip shows, so what is held is the drop
    // the rounds' own clocks give and the frames it picks.
    const sunset = replaySession('valorant-session-sunset-swiftplay.json', null);
    const ss = (ms) => (Number.isFinite(ms) ? Math.round((ms - sunset.t0) / 10) / 100 : null);
    const CLIP_DEATH = { 2: 163.5, 3: 252.62, 6: 518.1, 7: 614.7 };
    const zeroOf = (n) => {
      const z = sunset.records.filter((x) => x.round === n && x.state.phase === 'buy' && x.state.clock === '0:00').pop();
      return z ? z.at : null;
    };
    // Round 2's death came after the plant, which is the first frame the
    // screen read the spike down on.
    const plantOf = (n) => {
      const p = sunset.records.find((x) => x.round === n && (x.state.phase === 'postplant' || x.state.spike === 'planted'));
      return p ? Math.round(p.at - (zeroOf(n) + 500)) : null;
    };
    const sunsetRows = sunset.rounds.map((r) => (CLIP_DEATH[r.n] && zeroOf(r.n) !== null ? {
      ...r, verified: true, died: true, result: 'lost', traded: false, screenDied: !!r.died, afterPlant: r.n === 2,
      deathMs: Math.round(sunset.t0 + CLIP_DEATH[r.n] * 1000 - (zeroOf(r.n) + 500)),
      deathSec: Math.round((sunset.t0 + CLIP_DEATH[r.n] * 1000 - (zeroOf(r.n) + 500)) / 1000),
      plantMs: r.n === 2 ? plantOf(2) : null,
    } : r));
    const sunsetLooks = deathFrames.looksFor(sunset.records, sunsetRows, sunset.window, 'riot');
    const drops = [2, 3, 6, 7].map((n) => [n, deathFrames.barrierDrop(sunset.records, n, sunset.window), zeroOf(n)]);
    ok(drops.every(([, d, z]) => d && z !== null && d.at >= z && d.at < z + 1000 && d.frames >= 20 && d.frames >= d.of - 2),
      `each round's barriers drop where its clocked frames agree, inside the last second its buy timer showed (${drops.map(([n, d, z]) => `R${n} ${d ? `${ss(d.at)} s, ${d.frames} of ${d.of}` : 'none'}, 0:00 at ${ss(z)} s`).join('; ')})`);
    const err = (l) => ss(clips.momentOf(l)) - CLIP_DEATH[l.round.n];
    ok(sunsetLooks.map((l) => l.round.n).join() === '2,3,6,7' && sunsetLooks.every((l) => Math.abs(err(l)) <= 0.6),
      `and the four deaths land within 0.6 s of where their clips show them, round 2 after its plant included (${sunsetLooks.map((l) => `R${l.round.n} ${ss(clips.momentOf(l))} s, ${err(l) >= 0 ? '+' : ''}${err(l).toFixed(2)}`).join('; ')}; the rule before put round 2's 2.65 s late and round 6's 1.15 s early)`);
    ok(sunsetLooks.every((l) => l.frames[0].at <= l.moment - deathFrames.FRAME_MARGIN_MS && l.frames[1] && l.frames[1].at > l.moment
      && same(l.frameAt, l.frames.map((f) => Math.sign(f.at - l.moment) * Math.round(Math.abs(f.at - l.moment) / 10) / 100))),
    `framed by the last frame at least 0.3 s before each death and the first after it, with each one's seconds from it (${sunsetLooks.map((l) => `R${l.round.n} ${l.frameAt.join(' / ')}`).join('; ')})`);

    const abyss = replay(load('valorant-match-abyss-13-11.json').frames, 'standard');
    const ABYSS_RIOT = load('riot-abyss-13-11.json');
    const riotRounds = deathFrames.withRiotTimes(verify.reconcile(abyss.rounds, ABYSS_RIOT).rounds, ABYSS_RIOT);
    const riotLooks = deathFrames.looksFor(abyss.records, riotRounds, {}, 'riot');
    // THE ABYSS LOOKS ARE NO WORSE. Read every nine seconds or so, rounds 2, 3
    // and 19 have clocked frames enough for a drop, and land within a second
    // and a half of where the rule before put them, the frame before plus
    // Riot's second off its own clock: that took the earliest second the clock
    // allows and Riot's second rounded, each half a second on average. Round
    // 10's frames agree on no drop and it keeps that rule.
    const before = (l) => { const t = deathFrames.secondsIn(l.frames[0]); return l.at + (l.round.deathSec - t) * 1000; };
    const got = riotLooks.map((l) => ({ n: l.round.n, moment: clips.momentOf(l), drop: deathFrames.barrierDrop(abyss.records, l.round.n, {}), old: before(l) }));
    ok(got.map((g) => g.n).join() === '2,3,10,19' && got.every((g) => g.moment - g.old >= 0 && g.moment - g.old <= 1500)
      && got.filter((g) => g.drop).every((g) => g.moment === g.drop.at + riotRounds.find((r) => r.n === g.n).deathMs)
      && got.filter((g) => !g.drop).map((g) => g.n).join() === '10',
    `Riot's looks on the real Abyss match: from the drop where the clock gives one, within 1.5 s after the rule before (${got.map((g) => `R${g.n} ${g.drop ? 'drop' : 'no drop'}, +${((g.moment - g.old) / 1000).toFixed(2)} s`).join('; ')})`);

    // THE REAL SPLIT SESSION, through the real reader (coaching-engine.js), its
    // frames logged as the AI log logs them and Riot's record laid over the
    // ledger, the way a review is looked at. Read every one to five seconds,
    // and with the frames the model misread that the simple replay never has.
    const SPLIT_RIOT = load('riot-split-13-7.json');
    const split = replaySession('valorant-session-split-competitive.json', SPLIT_RIOT);
    const splitRounds = deathFrames.withRiotTimes(split.rounds, SPLIT_RIOT);
    const sec = (ms) => (Number.isFinite(ms) ? Math.round((ms - split.t0) / 100) / 10 : null);
    const four = deathFrames.looksFor(split.records, splitRounds, split.window, 'riot');
    // Every death Riot has in it, looked at as one of the four would be.
    const every = deathFrames.looksFor(split.records, splitRounds, split.window, 'riot', 24);
    const of = (list, n) => list.find((l) => l.round.n === n) || null;
    const shown = (l) => (l ? `R${l.round.n} ${l.frames.map((f) => `${sec(f.at)} s ${f.state.phase} ${f.state.clock || ''}`.trim()).join(' / ')}` : 'none');
    // Where Riot's death was on the wall clock, by the buy timer: the frame
    // that read 0:00, the barriers' last second, its middle, plus Riot's own
    // milliseconds. Good to half a second either way.
    const dropAt = (t) => {
      const r = split.records.find((x) => sec(x.at) === t);
      return r && r.state.phase === 'buy' && r.state.clock === '0:00' ? r.at + 500 : null;
    };
    const riotDeath = (n, drop) => (dropAt(drop) === null ? null : dropAt(drop) + SPLIT_RIOT.perRound.find((p) => p.n === n).deathMs);
    const holds = (l, death) => {
      const w = clips.windowOf(clips.momentOf(l));
      return !!w && death !== null && w.from <= death && death <= w.to;
    };
    ok(four.map((l) => l.round.n).join() === '3,7,8,15' && four.every((l) => Number.isFinite(l.moment)),
      `the Split match's looks are rounds 3, 7, 8 and 15, each timed by its round's clock (${four.map((l) => `R${l.round.n} ${sec(l.moment)} s`).join(', ')})`);
    // Round 15: Riot has the death 2 s into the round. No clocked frame comes
    // before it (the one before it is a buy phase frame the model read as
    // "active 0:18", 82 s into the round by that clock), but the round clock
    // runs on over the frames after it, the camera on a teammate.
    const r15 = of(four, 15);
    ok(r15 && Math.abs(r15.moment - riotDeath(15, 1547.4)) <= 500 && r15.frames.length === 2 && r15.frames[1].died
      && r15.frames[0].at < r15.moment && r15.frames[1].at > r15.moment,
    `round 15, its frames the buy phase's last and the death's, is timed by the round's clock after it: ${sec(r15.moment)} s, by the buy timer ${sec(riotDeath(15, 1547.4))} s (${shown(r15)}; the rule before put it at its registering frame, 1550.4 s, and before that at 1518.1 to 1533.1 s, inside the buy phase)`);
    ok(r15 && holds(r15, riotDeath(15, 1547.4)), 'and its clip\'s 15 seconds hold the death');
    // Round 1, a post plant death: the clock on its frames after the plant is
    // the spike's, and the clock before it times the death.
    const r1 = of(every, 1);
    ok(r1 && r1.round.afterPlant && Math.abs(r1.moment - riotDeath(1, 43.4)) <= 500 && r1.frames.length === 2 && r1.frames[1].died,
      `round 1, after the plant, is timed by the clock before the plant: ${sec(r1.moment)} s, by the buy timer ${sec(riotDeath(1, 43.4))} s (${shown(r1)}; the rule before put it at its registering frame, 77.8 s, and before that around 98.8 s)`);
    ok(r1 && holds(r1, riotDeath(1, 43.4)), 'and its clip holds the death');
    ok(every.length >= 12 && every.every((l) => Number.isFinite(l.moment)),
      `every death Riot has in the match is timed by its round's clock (${every.length} of them)`);
    const byTimer = every.map((l) => {
      const z = split.records.filter((x) => x.round === l.round.n && x.state.phase === 'buy' && x.state.clock === '0:00').pop();
      return z ? { l, d: (l.moment - (z.at + 500 + l.round.deathMs)) / 1000 } : null;
    }).filter(Boolean);
    ok(byTimer.length >= 8 && byTimer.every((x) => Math.abs(x.d) <= 0.5),
      `and where its round's buy timer was read to 0:00, within half a second of what that says (${byTimer.map((x) => `R${x.l.round.n} ${x.d >= 0 ? '+' : ''}${x.d.toFixed(2)}`).join(', ')})`);
    // THE PLANT ALONE SAYS SO, whatever the clock reads. Once the spike is down
    // the round clock leaves the screen, and a frame read after it carries one
    // read before. On the real Abyss match, read every ten seconds, through the
    // real reader, rounds 6 and 16 died after the plant on frames still reading
    // 1:20 and 1:23, readings first taken about 18 s earlier: 10 and 8 s before
    // Riot's second by those clocks, though by their rounds' buy timers both
    // frames came after the death. Their clocked frames before the plant agree
    // on no drop, so they are timed as before, by their registering frames.
    const abyssSession = replaySession('valorant-session-abyss-unrated.json', ABYSS_RIOT);
    const planted = deathFrames.looksFor(abyssSession.records, deathFrames.withRiotTimes(abyssSession.rounds, ABYSS_RIOT),
      abyssSession.window, 'riot', 24).filter((l) => l.round.afterPlant);
    const byClock = (l) => { const t = deathFrames.secondsIn(l.frames[0]); return t === null ? null : l.round.deathSec - t; };
    // What times a post plant death that is timed: its frames before Riot's plant, and only those.
    const beforePlant = (l) => {
      const all = deathFrames.barrierDrop(abyssSession.records, l.round.n, abyssSession.window);
      const pre = all && deathFrames.barrierDrop(abyssSession.records, l.round.n, { ...abyssSession.window, before: all.at + l.round.plantMs });
      return !!pre && l.moment === pre.at + l.round.deathMs;
    };
    ok(planted.filter((l) => !Number.isFinite(l.moment)).map((l) => l.round.n).join() === '6,16'
      && planted.every((l) => !Number.isFinite(l.moment) ? l.gap === null : beforePlant(l)),
    `a death after the plant is never timed by a clock read after it: rounds 6 and 16, their frames reading within ten seconds of Riot's second and agreeing on no drop before it, are not timed, and one that is is timed by its frames before the plant (${planted.map((l) => `R${l.round.n} `
      + `${byClock(l) === null ? 'no clock' : `${byClock(l)} s by its clock`}, ${Number.isFinite(l.moment) ? `timed ${Math.round((l.moment - abyssSession.t0) / 100) / 10} s` : 'not timed'}`).join('; ')})`);
    // Each moment between the frame before the death and the one after it,
    // where a look has both.
    const pairs = [...riotLooks, ...every, ...sunsetLooks].filter((l) => l.frames.length === 2);
    const between = (l) => { const m = clips.momentOf(l); return m >= l.frames[0].at && m <= l.frames[1].at; };
    ok(pairs.length >= 10 && pairs.every((l) => Number.isFinite(l.moment)) && pairs.every(between),
      `and each lands between the frame before the death and the one after it (${pairs.length} looks with both)`);
    const screenLooks = deathFrames.looksFor(abyss.records, abyss.rounds, {}, 'screen');
    ok(screenLooks.length === 4 && screenLooks.every((l) => clips.momentOf(l) === l.frames[1].at && l.frames[1].died),
      `the screen's looks: the death at the frame the screen registered it on (${screenLooks.map((l) => `R${l.round.n} +${(l.frames[1].at - l.at) / 1000}s`).join(', ')})`);
    ok(clips.momentOf({ at: T0, gap: null, frames: [{ at: T0 }] }) === T0 + 2000 && clips.momentOf({ at: T0 }) === T0 + 2000,
      'a look of one frame: two seconds after it, the margin the frame picker keeps');
    ok(clips.momentOf({ at: null, gap: 3 }) === null && clips.momentOf(null) === null, 'and a look with no time has no moment');
    ok(clips.momentOf({ moment: T0 + 1234, at: T0, gap: 9 }) === T0 + 1234, 'and a look that carries its moment is that moment, whatever its frames say');
  });

  await section('the barriers dropping, read off the round\'s own clock:', () => {
    // A round read about once a second, its clock showing the seconds left
    // rounded down, as the HUD does: t seconds after the drop it reads 100 - t
    // rounded down, 1:37 at 2.4 s.
    const DROP = T0;
    const clockAt = (t) => { const left = Math.floor(100 - t); return `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`; };
    const rec = (i, t, extra) => ({ i, at: Math.round(DROP + t * 1000), frame: `f${i}.jpg`, round: 4, died: false,
      state: { phase: 'active', clock: clockAt(t), ...(extra || {}) } });
    const steady = Array.from({ length: 20 }, (_v, k) => rec(k, 2.4 + k * 1.01));
    const d = deathFrames.barrierDrop(steady, 4, {});
    ok(d && Math.abs(d.at - DROP) <= 500 && d.frames === 20 && d.of === 20,
      `twenty frames of a round's clock put its barriers within half a second of when they dropped (${d && (d.at - DROP)} ms, ${d && d.frames} of ${d && d.of})`);
    const misread = steady.concat([{ ...rec(90, 10.9), state: { phase: 'active', clock: '1:30' } }]);
    const m = deathFrames.barrierDrop(misread, 4, {});
    ok(m && m.at === d.at && m.frames === 20 && m.of === 21, 'a clock misread by a second agrees with no other frame and is outvoted');
    const buy = steady.concat(Array.from({ length: 30 }, (_v, k) => ({ ...rec(100 + k, -30 + k), state: { phase: 'buy', clock: `0:${String(30 - k).padStart(2, '0')}` } })));
    ok(deathFrames.barrierDrop(buy, 4, {}).at === d.at && deathFrames.barrierDrop(buy, 4, {}).of === 20,
      'a buy timer, 45 seconds or less, is not the round clock');
    const asBuy = steady.map((r, k) => (k < 2 ? { ...r, state: { ...r.state, phase: 'buy' } } : r));
    ok(deathFrames.barrierDrop(asBuy, 4, {}).of === 20, 'while the round clock read on a frame the model called buy still counts');
    // After the plant the clock leaves the screen, and a read carries the clock
    // of the read before it: each frame after it reads 1:14, the clock when
    // the spike went down 26 s in, the later the frame the later the drop it
    // says. Outvoted, they still count against the frames before the plant;
    // Riot's plant takes them out.
    const stale = (k, t) => ({ ...rec(200 + k, t), state: { phase: 'active', clock: '1:14' } });
    const before = steady.slice(0, 18);
    // The first one a fifth of a second after the plant, which carries the
    // clock of the plant's own second and so meets the frames before at
    // their edge: counted, it moves the drop by a third of a second.
    const after = before.concat([26.2, 27.5, 28.5, 29.5, 30.5].map((t, k) => stale(k, t)));
    const unplanted = deathFrames.barrierDrop(after, 4, {});
    const r4 = { n: 4, died: true, verified: true, deathMs: 30123, plantMs: 26000 };
    const planted = deathFrames.deathMoment(after, r4, {});
    const preOnly = deathFrames.barrierDrop(before, 4, {});
    ok(unplanted && unplanted.of === 23 && unplanted.at - preOnly.at > 200 && planted === preOnly.at + 30123 && Math.abs(planted - (DROP + 30123)) <= 500,
      `a post plant death is timed by the clock before the plant: the five frames read after it, each a copy of 1:14, are left out, the one that moved the drop by ${unplanted && unplanted.at - preOnly.at} ms with them (${unplanted && unplanted.of} clocked frames, ${preOnly.of} before the plant, ${planted - DROP - 30123} ms off)`);
    ok(deathFrames.deathMoment(after, { ...r4, afterPlant: true, plantMs: null }, {}) === null
      && deathFrames.deathMoment(after, { ...r4, afterPlant: true }, {}) === planted,
    "and without Riot's plant time a post plant death is not timed at all, since nothing tells the frames after the plant from those before");
    ok(deathFrames.barrierDrop(steady.map((r) => ({ ...r, state: { ...r.state, phase: 'postplant' } })), 4, {}) === null
      && deathFrames.barrierDrop(steady.map((r) => ({ ...r, state: { ...r.state, spike: 'planted' } })), 4, {}) === null,
    'and a frame read after the plant, by its phase or its spike, never counts');
    // Two rounds' frames filed under one: two answers, and no drop.
    const twice = steady.slice(0, 8).concat(steady.slice(0, 8).map((r, k) => ({ ...r, i: 300 + k, at: r.at + 40000 })));
    const lopsided = steady.slice(0, 9).concat(steady.slice(0, 4).map((r, k) => ({ ...r, i: 400 + k, at: r.at + 40000 })));
    const close = steady.slice(0, 7).concat(steady.slice(0, 4).map((r, k) => ({ ...r, i: 500 + k, at: r.at + 40000 })));
    ok(deathFrames.barrierDrop(twice, 4, {}) === null && deathFrames.barrierDrop(close, 4, {}) === null
      && Math.abs(deathFrames.barrierDrop(lopsided, 4, {}).at - d.at) <= 500,
    'two groups of frames each agreeing on its own drop are no answer, unless one is twice the other');
    ok(deathFrames.barrierDrop([steady[0], { ...steady[1], state: { phase: 'active', clock: '1:20' } }], 4, {}) === null
      && deathFrames.barrierDrop([steady[3]], 4, {}) !== null, 'two frames that disagree are no answer, while one alone is');
    ok(deathFrames.barrierDrop(steady, 5, {}) === null && deathFrames.barrierDrop([], 4, {}) === null, 'a round with no clocked frame has none');
    ok(deathFrames.deathMoment(steady, { n: 4, died: true, deathMs: 3000 }, {}) === d.at + 3000
      && deathFrames.deathMoment(steady, { n: 4, died: true, deathSec: 3 }, {}) === d.at + 3000
      && deathFrames.deathMoment(steady, { n: 4, died: false, deathMs: 3000 }, {}) === null
      && deathFrames.deathMoment(steady, { n: 4, died: true }, {}) === null,
    "Riot's death is the drop plus its milliseconds, or its second from an older record, and a round with no death or no time has none");
    ok(deathFrames.deathMoment(steady, { n: 4, died: true, deathMs: 90000 }, {}) === null,
      "and none outside the round's own frames: one frame of the next round filed under this one would put its death there");
    const riotIn = { perRound: [{ n: 4, deathMs: 12345, plantMs: 25000 }, { n: 5, deathMs: 999 }] };
    const rows = [{ n: 4, died: true, deathSec: 12 }, { n: 5, died: false, deathSec: null }];
    const timed = deathFrames.withRiotTimes(rows, riotIn);
    ok(timed[0].deathMs === 12345 && timed[0].plantMs === 25000 && timed[1].deathMs === null && !('deathMs' in rows[0])
      && same(deathFrames.withRiotTimes(rows, null), rows),
    "Riot's milliseconds are laid beside the rounds it records, a death only where there was one, the rounds handed in unchanged");
  });

  await section('the stills a look takes from its clip:', async () => {
    ok(same(clips.LOOK_AT.riot, [-3, -1.5, -0.7, -0.3, 0.7]) && same(clips.LOOK_AT.screen, [-4.5, -3, -2, -1, 0]),
      "Riot's look takes 3, 1.5, 0.7 and 0.3 s before the death and 0.7 s after it, the screen's 4.5, 3, 2 and 1 s before its read of the death and that moment");
    const names = clips.LOOK_AT.riot.map((at, k) => clips.stillName(6, k + 1, at));
    const { FRAME_RE } = require('../src/main/services/review-store');
    ok(same(names, ['r6-rec1-before.jpg', 'r6-rec2-before.jpg', 'r6-rec3-before.jpg', 'r6-rec4-before.jpg', 'r6-rec5-after.jpg'])
      && names.every((n) => FRAME_RE.test(n)) && clips.stillName(6, 1, 0) === 'r6-rec1-after.jpg'
      && clips.stillName(0, 1, -1) === null && clips.stillName(6, 0, -1) === null && clips.stillName(6, 1, NaN) === null,
    `named for the round, the order and the side of the death, as the library keeps frames (${names.join(', ')})`);
    // AROUND RIOT'S OWN MOMENT OR NONE. The server is told a Riot look's
    // seconds are from Riot's death, good to a few tenths, so its stills are
    // taken only around the moment the round's clock and Riot's milliseconds
    // give; the rule before (a frame's clock read to the second, the frame
    // that registered the death) can be two seconds and more out. The
    // screen's are around its read of the death, which it says they are.
    const reg = { at: T0, gap: null, frames: [{ at: T0 }, { at: T0 + 1700 }] };
    ok(clips.stillsMomentOf({ ...reg, moment: T0 + 1234 }, 'riot') === T0 + 1234
      && clips.stillsMomentOf(reg, 'riot') === null && clips.stillsMomentOf({ at: T0, gap: 3 }, 'riot') === null
      && clips.stillsMomentOf(reg, 'screen') === T0 + 1700 && clips.stillsMomentOf(null, 'riot') === null,
    "a Riot look's stills are taken around Riot's own moment or not at all, the screen's around its read of the death");
    const mainSrc = mainText();
    const stillsSrc = mainSrc.slice(mainSrc.indexOf('\nasync function recordingStills('), mainSrc.indexOf('\n}\n', mainSrc.indexOf('\nasync function recordingStills(')));
    ok(stillsSrc.includes('clips.stillsMomentOf(look, source)') && !stillsSrc.includes('clips.momentOf('),
      'and main takes the stills by that rule (recordingStills in index.js)');
    ok(lfOf(mainSrc.replace(/\n/g, '\r\n')) === mainSrc && !/\n(async )?function /.test(stillsSrc.slice(1)),
      'main is cut the same as git on Windows writes it, with CRLF, and what is cut is the one function');
    const order = lookStills.sendOrder(clips.LOOK_AT.riot);
    ok(same(order, [3, 4, 0, 1, 2]) && same(lookStills.sendOrder([-1, 2]), [0, 1]) && same(lookStills.sendOrder([-4.5, -3, -2, -1, 0]), [3, 4, 0, 1, 2]),
      'sent with the last before the death and the first after it ahead of the rest, the two a server from before 8.3.1 keeps and reads as those');

    // A clip cut from the real recording of a canvas, its own 0 on the wall
    // clock at W, the death at M: the frame on screen at each second asked.
    const W = T0 + 1022;
    const rd = webm.indexFile(FIXTURE, { keepBytes: true });
    const clip = webm.cutClip({ init: rd.init, clusters: rd.clusters, from: 2000, to: 8000 });
    const idx = clipFrames.indexClip(clip);
    const whole = clipFrames.indexClip(fs.readFileSync(FIXTURE));
    ok(idx && idx.codec === 'avc1.42c01f' && idx.width === 640 && idx.height === 360 && idx.frames[0].ms === 0 && idx.frames[0].key
      && whole && whole.frames.length === 407 && whole.frames.filter((f) => f.key).length === 14,
    `a clip's frames read off its blocks, its codec off its SPS: ${idx && idx.frames.length} frames, ${idx && idx.codec} at ${idx && idx.width}x${idx && idx.height}, and the whole recording's 407 in its Clusters of unknown size`);
    const M = W + 4000;
    let asked = null;
    const fake = async (job) => { asked = job; return { ok: true, frames: job.picks.map((ts) => (ts === null ? null : Buffer.from(`still ${ts}`))) }; };
    const stills = await lookStills.stillsOf({ bytes: clip, startWall: W, moment: M, offsets: [-3, -1.5, -0.7, 0.7, 30], decode: fake,
      size: { width: 1280, height: 720, quality: 0.7 } });
    const onScreen = (t) => { let k = 0; while (k + 1 < idx.frames.length && idx.frames[k + 1].ms <= t) k += 1; return idx.frames[k].ms; };
    const want = [-3, -1.5, -0.7, 0.7].map((s) => onScreen(4000 + s * 1000));
    ok(asked && asked.outWidth === 1280 && asked.outHeight === 720 && asked.quality === 0.7 && asked.codec === 'avc1.42c01f'
      && same(asked.picks.slice(0, 4), want.map((ms) => Math.round(ms * 1000))) && asked.picks[4] === null,
    `the page is asked for the frame on screen at each second, in microseconds of the clip, and nothing for a second past its end (${asked && asked.picks.join(', ')})`);
    ok(asked && asked.chunks.length && asked.chunks[0].key && asked.chunks.every((c, k) => k === 0 || c.ts > asked.chunks[k - 1].ts)
      && asked.chunks.length < idx.frames.length,
    `decoded from the keyframe at or before each, in order, never the whole clip (${asked && asked.chunks.length} of ${idx.frames.length} frames)`);
    const hundredths = (ms) => (ms < 0 ? -1 : 1) * Math.round(Math.abs(ms) / 10) / 100;
    ok(stills.length === 4 && same(stills.map((s) => s.at), want.map((ms) => hundredths(W + ms - M)))
      && stills.every((s, k) => s.jpeg.toString() === `still ${Math.round(want[k] * 1000)}`),
    `the stills come back in time order, each at its own frame's seconds from the death (${stills.map((s) => s.at).join(', ')})`);
    ok((await lookStills.stillsOf({ bytes: clip, startWall: W, moment: M, offsets: [-3], decode: async () => ({ ok: false, frames: [] }) })).length === 0
      && (await lookStills.stillsOf({ bytes: Buffer.from('not a clip'), startWall: W, moment: M, offsets: [-3], decode: fake })).length === 0
      && (await lookStills.stillsOf({ bytes: clip, startWall: null, moment: M, offsets: [-3], decode: fake })).length === 0,
    'and none when the page could not decode it, the bytes are not a clip, or its 0 on the wall clock is not known');
  });

  // ── The recording, as the recorder keeps it: the real fixture on the wall clock
  const reader = webm.indexFile(FIXTURE, { keepBytes: true });
  const ZERO = T0;   // the recording's 0 on the wall clock
  const fixtureCut = (from, to) => {
    const bytes = webm.cutClip({ init: reader.init, clusters: reader.clusters, from: from - ZERO, to: to - ZERO });
    return bytes ? { bytes, mime: 'video/x-matroska' } : null;
  };

  await section('the clips cut for a review\'s looks:', async () => {
    const asked = [];
    const saved = [];
    const looks = Array.from({ length: 8 }, (_v, i) => ({ key: i + 1, name: clips.roundClip(i + 1), moment: T0 + i * 60000 }));
    const r = await reviewClips.cutClips({
      looks,
      cut: (from, to, at) => { asked.push([from, to, at]); return { bytes: Buffer.from(`clip ${asked.length}`) }; },
      save: (name, bytes) => { saved.push([name, bytes.toString()]); return true; },
      stopped: () => false,
      yieldTo: async () => {},
    });
    ok(same(asked.slice(0, 2), [[T0 - SPEC.beforeMs, T0 + SPEC.afterMs, T0], [T0 + 60000 - SPEC.beforeMs, T0 + 60000 + SPEC.afterMs, T0 + 60000]]),
      'the recording is asked for 11 s before each death to 4 s after it, and told when the death was', JSON.stringify(asked.slice(0, 2)));
    ok(r.kept.length === SPEC.max && saved.length === SPEC.max && asked.length === SPEC.max && same(r.kept.map((k) => k.name), looks.slice(0, 6).map((l) => l.name)),
      `six at most, in the order the looks came (${r.kept.length} of 8)`);
    const started = await reviewClips.cutClips({
      looks: looks.slice(0, 2),
      cut: (from) => ({ bytes: Buffer.from('a clip'), startWall: from - 700 }),
      save: () => true, stopped: () => false, yieldTo: async () => {},
    });
    ok(same(started.kept.map((k) => k.startWall), [T0 - SPEC.beforeMs - 700, T0 + 60000 - SPEC.beforeMs - 700]),
      "each clip kept says where its own 0 is on the wall clock, as the recorder cut it, for the look's stills");
    let stop = false;
    const written = [];
    const s = await reviewClips.cutClips({
      looks: looks.slice(0, 4),
      cut: () => { if (written.length === 1) stop = true; return { bytes: Buffer.from('x') }; },
      save: (name) => { written.push(name); return true; },
      stopped: () => stop,
      yieldTo: async () => {},
    });
    ok(written.length === 1 && s.kept.length === 1, 'a review withdrawn while its clips are cut: nothing more is written for it', written.join(', '));
    const m = await reviewClips.cutClips({
      looks: looks.slice(0, 3), cut: (from) => (from < T0 + 30000 ? { bytes: Buffer.from('x') } : null),
      save: () => true, stopped: () => false, yieldTo: async () => {},
    });
    ok(m.kept.length === 1 && m.missed === 2 && m.tried === 3, 'a moment the recording does not hold has no clip, and is counted as missed');
    const bad = await reviewClips.cutClips({ looks: [{ key: 1, name: '../x.mkv', moment: T0 }, { key: 2, name: 'r2-clip.mkv', moment: NaN }],
      cut: () => { throw new Error('never asked'); }, save: () => true, stopped: () => false, yieldTo: async () => {} });
    ok(bad.tried === 0 && !bad.kept.length, 'a look with no clip name or no moment is not cut at all');

    // One cut from the real recording of a canvas: a death 6 s in.
    let realBytes = null;
    const real = await reviewClips.cutClips({
      looks: [{ key: 2, name: 'r2-clip.mkv', moment: ZERO + 6000 }],
      cut: fixtureCut, save: (name, bytes) => { realBytes = bytes; return true; }, stopped: () => false, yieldTo: async () => {},
    });
    const clipReader = webm.createReader();
    if (realBytes) { clipReader.push(realBytes); clipReader.end(); }
    const cc = clipReader.clusters;
    const plan = webm.planClip(reader.clusters, 6000 - SPEC.beforeMs, 6000 + SPEC.afterMs);
    ok(real.kept.length === 1 && !clipReader.error && cc.length && cc[0].timecode === 0 && cc.every((c) => c.keyframe === true),
      `cut from the real recording, it reads as a clip: ${cc.length} Clusters from 0, each on a keyframe (${realBytes ? realBytes.length : 0} bytes)`);
    const head = webm.parseInit(clipReader.init || Buffer.alloc(0));
    ok(head && head.info.some((k) => k.id === 0x4489) && head.mime === SPEC.mime, 'with a Duration, typed video/x-matroska');
    const lastFrame = plan.start + cc[cc.length - 1].last;
    ok(plan.start <= Math.max(0, 6000 - SPEC.beforeMs) && lastFrame >= Math.min(6000 + SPEC.afterMs, reader.clusters[reader.clusters.length - 1].last) - 40,
      `covering its window: from ${plan.start} ms of the recording (the start, 11 s before reaches past it) to ${Math.round(lastFrame)} ms (4 s after is 10000)`);
  });

  await section('the recorder cuts a moment out of the recording that holds it:', async () => {
    // Two recordings of one session, a minute apart (a pause between them):
    // a window that reaches back into the first is still the second's moment.
    const mem = new Map();
    const files = {
      mkdir() {}, write: (f, b) => mem.set(f, Buffer.from(b)), append: (f, b) => mem.set(f, Buffer.concat([mem.get(f) || Buffer.alloc(0), Buffer.from(b)])),
      read: (f, off, size) => mem.get(f).subarray(off, off + size), remove: (f) => mem.delete(f), removeTree() {}, list: () => [],
    };
    const segOf = (dir, wall) => {
      const g = new Segment(dir, files, 60000);
      g.startWall = wall;
      const meta = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'recording-canvas.json'), 'utf8'));
      const file = fs.readFileSync(FIXTURE);
      let off = 0;
      for (const c of meta.chunks) { g.push(file.subarray(off, off + c.size), wall + c.atMs); off += c.size; }
      g.finish();
      return g;
    };
    const rec = new Recorder({ root: '/x', prefs: { get: () => null, set() {} }, files, log: () => {} });
    const first = segOf(path.join('/x', 'rec-a'), T0);
    const second = segOf(path.join('/x', 'rec-b'), T0 + 14000);
    rec.segments = [first, second];
    const at = second.zero() + 3000;
    const fromFirst = rec.cutClip(first.zero() + 1000, first.zero() + 5000);
    const reach = rec.cutClip(at - SPEC.beforeMs, at + SPEC.afterMs, at);
    const own = (g, from, to) => webm.cutClip({ init: g.init, clusters: g.clusters(), from: from - g.zero(), to: to - g.zero(), read: (c) => files.read(c.file, c.offset, c.size) });
    ok(fromFirst && fromFirst.bytes.equals(own(first, first.zero() + 1000, first.zero() + 5000)), 'a window inside the first recording is cut from it');
    ok(reach && reach.bytes.equals(own(second, at - SPEC.beforeMs, at + SPEC.afterMs)),
      'a window reaching back into the first is cut from the second, the one the moment is in');
    // Where the clip's own 0 is on the wall clock (8.3.1), so the look's stills
    // are taken at their seconds from the death: the keyframe it opens on.
    const plan = webm.planClip(second.clusters(), at - SPEC.beforeMs - second.zero(), at + SPEC.afterMs - second.zero());
    const reachIdx = reach && clipFrames.indexClip(reach.bytes);
    ok(reach && plan && reach.startWall === second.zero() + plan.start
      && reachIdx && reachIdx.frames[0].ms === 0 && fromFirst.startWall === first.zero() + webm.planClip(first.clusters(), 1000, 5000).start,
    `and it says where its own 0 is on the wall clock, the keyframe it opens on: here the recording's first, ${reach && at - reach.startWall} ms before the death`);

    // AND ONLY ONE THAT HOLDS THE MOMENT. A recording that stopped a few
    // seconds before the death (given up, paused, stopped) or began a few
    // after it still overlaps the clip's window, and cut from it the clip was
    // the lead up alone, or the aftermath, kept as the death's. The moment's
    // own estimate is good to a second, so a second either side still holds.
    const solo = new Recorder({ root: '/x', prefs: { get: () => null, set() {} }, files, log: () => {} });
    const only = segOf(path.join('/x', 'rec-c'), T0 + 100000);
    solo.segments = [only];
    const cs = only.clusters();
    const start = only.zero() + cs[0].timecode;
    const end = only.zero() + cs[cs.length - 1].last;
    const cutAt = (when) => solo.cutClip(when - SPEC.beforeMs, when + SPEC.afterMs, when);
    const late = [1000, 1500, 2000, 5000, 10500].map((d) => [d, cutAt(end + d)]);
    ok(late.every(([, c]) => c === null),
      `a death 1, 1.5, 2, 5 or 10.5 s after a recording ended: no clip, though its window reaches back into it (${late.filter(([, c]) => c).map(([d, c]) => `${d / 1000} s: ${c.bytes.length} bytes`).join(', ') || 'none cut'})`);
    const early = [1000, 2500, 3900].map((d) => [d, cutAt(start - d)]);
    ok(early.every(([, c]) => c === null),
      `a death 1, 2.5 or 3.9 s before one began: no clip, though its window reaches into it (${early.filter(([, c]) => c).map(([d, c]) => `${d / 1000} s: ${c.bytes.length} bytes`).join(', ') || 'none cut'})`);
    const inside = cutAt(start + 6000);
    ok(inside && inside.bytes.equals(own(only, start + 6000 - SPEC.beforeMs, start + 6000 + SPEC.afterMs)) && cutAt(end + 500) && cutAt(start - 500),
      'one inside it still is, and one within a second of either end, the moment\'s own estimate');
    ok(solo.cutClip(end - 5000, end + 5000) && solo.cutClip(start - 3000, start + 2000), 'and a window asked for with no moment is cut wherever it overlaps, as before');
    const counted = await reviewClips.cutClips({
      looks: [{ key: 7, name: 'r7-clip.mkv', moment: end + 3000 }, { key: 8, name: 'r8-clip.mkv', moment: start + 6000 }],
      cut: (from, to, when) => solo.cutClip(from, to, when), save: () => true, stopped: () => false, yieldTo: async () => {},
    });
    ok(counted.missed === 1 && counted.kept.length === 1 && counted.kept[0].name === 'r8-clip.mkv',
      'and a moment no recording holds is counted as missed, the one it holds clipped');
  });

  await section('what Settings is told of the recording, and what a League notice says:', () => {
    const data = { recordingMode: 'auto', recordingRes: '720', recordingStrikes: [], recordingAutoOff: null, recordingLast: { outcome: 'black', at: 1 } };
    const prefs = { get: (k) => data[k], set: (k, v) => { data[k] = v; } };
    const timers = { setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {} };
    const mk = (extra) => new Recorder({ root: '/x', prefs, files: { list: () => [] }, timers, now: () => T0, log: () => {}, ...(extra || {}) });
    const idle = mk();
    ok(idle.view().session === null && idle.view().live === null && idle.view().last.outcome === 'black',
      'no session: no live line, and the last session\'s outcome for Settings to say');
    // Recording, and the frames a second the capture delivered while the picture changed.
    const rec = mk();
    rec.state = 'recording';
    rec.seg = { session: { res: '1080' } };
    ok(same(rec.liveView(), { res: '1080', fps: null }), 'recording on a still screen: the size, and no frame rate to give');
    rec.liveFps = [29.1, 30.2, 31.4, 28.8, 30.6];
    ok(same(rec.liveView(), { res: '1080', fps: 30 }), 'about 30 a second: the median, to the nearest five');
    rec.liveFps = [21.2, 22.1, 21.6];
    ok(rec.liveView().fps === 20 && (rec.liveFps = [3.2, 3.6, 2.9]) && rec.liveView().fps === 3, 'about 20, and a crawl said as it is');
    rec.state = 'stopping';
    ok(rec.liveView() === null, 'and nothing once it is not recording');
    const off = mk();
    data.recordingMode = 'off';
    off.startSession();
    ok(off.view().session && off.view().session.outcome === 'off', 'a session in progress says its own outcome, before the last session\'s');
    data.recordingMode = 'auto';
    // League's screen is not read: its notice says what goes on instead.
    const notices = [];
    const lol = mk({ still: () => "The review is still built from the game's own record." });
    lol.on('notice', (n) => notices.push(n.text));
    data.recordingMode = 'off';
    lol.startSession();
    data.recordingMode = 'auto';
    lol.giveUp(lol.session, 'busy', {});
    ok(notices[0] === "Recording stopped for this session: your PC was busy. The review is still built from the game's own record.",
      'a League session given up as busy says the review goes on from the game\'s record, not that the screen is read', notices[0]);
    const val = mk();
    const vn = [];
    val.on('notice', (n) => vn.push(n.text));
    data.recordingMode = 'off';
    val.startSession();
    data.recordingMode = 'auto';
    val.giveUp(val.session, 'black', {});
    ok(vn[0] === 'Recording needs Windowed Fullscreen in this game. The coach still reads your screen every second.', 'and Valorant\'s as before', vn[0]);
  });

  await section('no clip is cut once the player chose Off:', () => {
    // index.js asks before every look's clips and every League game's
    // (cutLookClips, clipLolDeaths); check:clips holds the two booted. Here,
    // what the config says, as the recorder itself writes it.
    const as = (o) => ({ get: (k) => o[k] });
    ok(clips.cutsClips(as({ recordingMode: 'auto' })) && clips.cutsClips(as({})) && clips.cutsClips(null), 'Auto, or nothing set: clips are cut');
    ok(!clips.cutsClips(as({ recordingMode: 'off' })) && !clips.cutsClips(as({ recordingMode: 'off', recordingAutoOff: null })), 'Off chosen: none is');
    const data = { recordingMode: 'auto', recordingRes: '720', recordingStrikes: [], recordingAutoOff: null };
    const prefs = { get: (k) => data[k], set: (k, v) => { data[k] = v; } };
    const timers = { setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {} };
    const rec = new Recorder({ root: '/x', prefs, files: { list: () => [], removeTree() {} }, timers, now: () => T0, log: () => {} });
    rec.strike();
    rec.strike();
    ok(data.recordingMode === 'off' && data.recordingAutoOff && data.recordingAutoOff.reason === 'busy' && clips.cutsClips(prefs),
      'Auto turned off by the recorder itself, two busy sessions in a week, is not the player\'s choice: the match it gave up in keeps the clips of what it recorded');
    data.recordingMode = 'auto';
    rec.prefsChanged();
    data.recordingMode = 'off';
    rec.prefsChanged();
    ok(data.recordingAutoOff === null && !clips.cutsClips(prefs), 'and Off chosen after "Try again" is, the setting as Settings writes it: no clip');
  });

  await section('the store keeps a clip by path, in its review\'s folder alone:', () => {
    const root = freshDir();
    const store = new ReviewStore(root);
    const id = newId('valorant', T0);
    const rv = reviewOf(id, T0);
    store.save({ id, game: 'valorant', at: T0, review: rv, frames: { 'r2-before.jpg': b64('frame two'), 'r9-before.jpg': b64('frame nine') } });
    const bytes = Buffer.from('a clip of round two');
    ok(store.saveClip(id, 'r2-clip.mkv', bytes) === bytes.length && fs.readFileSync(path.join(root, id, 'r2-clip.mkv')).equals(bytes),
      'written by path beside the review: reviews/<id>/r2-clip.mkv, byte for byte');
    ok(store.clipFile(id, 'r2-clip.mkv') === path.join(root, id, 'r2-clip.mkv') && store.hasClip(id, 'r2-clip.mkv') && !store.hasClip(id, 'r9-clip.mkv'),
      'its path is the store\'s to give, and it knows which are there');
    const refused = [[id, '../evil-clip.mkv'], [id, 'r2-before.jpg'], [id, 'r2-clip.mkv.tmp'], ['../../etc', 'r2-clip.mkv'], ['valorant-1-x', 'r2-clip.mkv']];
    ok(refused.every(([i, n]) => store.saveClip(i, n, bytes) === 0 && store.clipFile(i, n) === null),
      'a name that is not a clip\'s, or an id that is not a review\'s, is refused and written nowhere');
    ok(!fs.existsSync(path.join(root, 'evil-clip.mkv')) && !fs.existsSync(path.join(root, '..', 'evil-clip.mkv')), 'nothing outside the folder');
    ok(store.saveClip(id, 'r9-clip.mkv', Buffer.alloc(0)) === 0 && !store.hasClip(id, 'r9-clip.mkv'), 'and an empty clip is not kept');
    ok(!fs.readdirSync(path.join(root, id)).some((n) => n.endsWith('.tmp')), 'no temp file is left behind');
    ok(same(store.clipsOf(id), [{ name: 'r2-clip.mkv', bytes: bytes.length }]) && same(Object.keys(store.framesOf(id)).sort(), ['r2-before.jpg', 'r9-before.jpg']),
      'its clips are listed apart from its frames, which stay as they were');
    // A newer look replaces the clips of the one before it.
    store.saveClip(id, 'r9-clip.mkv', Buffer.from('round nine'));
    store.saveClip(id, 'r14-clip.mkv', Buffer.from('round fourteen, an earlier look'));
    const dropped = store.keepClips(id, ['r2-clip.mkv', 'r9-clip.mkv']);
    ok(dropped === 1 && same(store.clipsOf(id).map((c) => c.name).sort(), ['r2-clip.mkv', 'r9-clip.mkv']),
      'the last look\'s clips are kept, and one an earlier look cut that it did not goes');
    store.remove(id);
    ok(!fs.existsSync(path.join(root, id)) && !store.hasClip(id, 'r2-clip.mkv'), 'and they go with their review');
  });

  await section('a review pushed out of the library takes its clips with it:', () => {
    const root = freshDir();
    const store = new ReviewStore(root);
    const oldest = newId('valorant', T0 - 1e9);
    store.save({ id: oldest, game: 'valorant', at: T0 - 1e9, review: reviewOf(oldest, T0 - 1e9) });
    store.saveClip(oldest, 'r2-clip.mkv', Buffer.from('the oldest clip'));
    for (let i = 0; i < MAX_REVIEWS; i++) {
      const id = `valorant-${T0 + i}-k${String(i).padStart(4, '0')}`;
      store.save({ id, game: 'valorant', at: T0 + i, review: { id, kind: 'valorant', rounds: [] } });
    }
    ok(store.list().length === MAX_REVIEWS && !store.get(oldest) && !fs.existsSync(path.join(root, oldest)),
      `one review past the ${MAX_REVIEWS} pushes the oldest out, and its folder, clips and all, is gone`);
  });

  await section('the cap: past it, the oldest reviews\' clips go first:', () => {
    const root = freshDir();
    const store = new ReviewStore(root);
    const mk = (at, sizes) => {
      const id = newId('valorant', at);
      store.save({ id, game: 'valorant', at, review: reviewOf(id, at), frames: { 'r2-before.jpg': b64(`frame ${at}`) } });
      sizes.forEach((n, i) => store.saveClip(id, i ? 'r9-clip.mkv' : 'r2-clip.mkv', Buffer.alloc(n, 7)));
      return id;
    };
    const a = mk(T0 - 3 * 3600000, [3000, 1000]);   // the oldest: 4000 bytes
    const b = mk(T0 - 2 * 3600000, [2500]);
    const c = mk(T0 - 1 * 3600000, [2000, 500]);    // the newest: 2500
    // A folder of clips no review owns any more (written as its review went).
    const orphan = 'valorant-1759000000000-orph01';
    fs.mkdirSync(path.join(root, orphan));
    fs.writeFileSync(path.join(root, orphan, 'r3-clip.mkv'), Buffer.alloc(800));
    const u = store.clipUsage();
    ok(u.bytes === 4000 + 2500 + 2500 + 800 && u.clips === 6 && u.reviews === 4, `the clips are counted across every review's folder: ${u.bytes} bytes in ${u.clips}`);
    const cleared = store.capClips(3000);
    ok(same(cleared, [orphan, a, b]) && store.clipUsage().bytes === 2500, `9800 bytes against a cap of 3000: the stray folder, then the oldest, then the next go (${cleared.join(', ')})`);
    ok(!fs.existsSync(path.join(root, orphan)), 'the stray folder is gone whole');
    ok(!store.clipsOf(a).length && !store.clipsOf(b).length && store.clipsOf(c).length === 2, 'and the newest review keeps its clips');
    const ra = store.get(a).review;
    ok(store.frame(a, 'r2-before.jpg') === b64(`frame ${T0 - 3 * 3600000}`) && ra.rounds[0].forensics.cause === 'dry-peek'
      && same(ra.grade, reviewOf(a, 0).grade) && same(ra.insights, reviewOf(a, 0).insights),
    'a review that lost its clips keeps its frames and its facts');
    ok(ra.clipsCleared && ra.clipsCleared.reason === 'space' && typeof ra.clipsCleared.at === 'number' && !store.get(c).review.clipsCleared,
      'and says why: cleared for space; one that kept its clips says nothing', JSON.stringify(ra.clipsCleared));
    const rows = store.list();
    ok(rows.length === 3 && rows.find((r) => r.id === a).grade.score === 61, 'the library index is as it was');
    ok(!store.capClips(10 * GB).length && store.clipUsage().bytes === 2500, 'under the cap, nothing goes');
    const all = store.clearClips('cleared');
    ok(same(all, [c]) && store.clipUsage().bytes === 0 && store.get(c).review.clipsCleared.reason === 'cleared'
      && store.frame(c, 'r2-before.jpg') !== null, 'Clear clips takes every clip, keeps every frame, and each review says it was cleared');
    ok(store.get(a).review.clipsCleared.reason === 'space', 'a review cleared for space before says so still');
  });

  await section('a late link keeps the clips its cards name:', () => {
    // The real Abyss match looked at from the screen in rounds 2, 14, 17 and
    // 19, a clip of each beside it, never linked. Riot's record says the round
    // 17 death never happened, and the upgrade drops its look (riot-review.js
    // upgradeWatched). The backfill's save in index.js then keeps the clips
    // the cards name, as here (check:clips holds that one booted).
    const abyss = replay(load('valorant-match-abyss-13-11.json').frames, 'standard');
    const snap = { ...abyss, startedAt: T0 - 60000, endedAt: T0 + 24 * riotReview.ROUND_MS + 60000 };
    const LOOKED = [2, 14, 17, 19];
    const rows = abyss.rounds.map((r) => (LOOKED.includes(r.n) ? { ...r, forensics: { cause: 'isolated', what: 'You held the site alone.',
      better: 'Hold it with a teammate.', frames: [`r${r.n}-before.jpg`], source: 'screen', at: snap.startedAt + r.n * 100000, clip: clips.roundClip(r.n) } } : r));
    const rv = valorantReview.build({ rounds: rows, context: abyss.context, endedBy: 'score', ai: {}, role: 'Duelist', history: [] });
    rv.ledger = valorantReview.ledgerOf({ ...snap, rounds: rows });
    const id = newId('valorant', snap.endedAt);
    Object.assign(rv, { id, at: snap.endedAt, kind: 'valorant' });
    const root = freshDir();
    const store = new ReviewStore(root);
    store.save({ id, game: 'valorant', at: rv.at, review: rv });
    for (const n of LOOKED) store.saveClip(id, clips.roundClip(n), Buffer.from(`the clip of round ${n}`));
    const ROW = { matchId: 'abyss-1', map: 'Abyss', agent: 'Jett', mode: 'Unrated', result: 'Victory', score: '13-11',
      kills: 31, deaths: 21, assists: 4, kd: 1.48, acs: 382, adr: 243, headshotPct: 25, startedAt: T0 };
    const { review: up } = riotReview.upgradeWatched({ saved: { id, at: rv.at, review: rv }, row: ROW, riot: load('riot-abyss-13-11.json'),
      history: [], account: 'Me#EUW' });
    store.save({ id, game: 'valorant', at: up.at, review: up });
    const named = reviewClips.namedClips(up).sort();
    ok(up.lateLinked && same(named, ['r14-clip.mkv', 'r19-clip.mkv', 'r2-clip.mkv']) && store.clipsOf(id).length === 4,
      `upgraded, its cards name the clips of the three deaths Riot confirms, while four are on disk (${named.join(', ')})`);
    const gone = store.keepClips(id, reviewClips.namedClips(up));
    ok(gone === 1 && same(store.clipsOf(id).map((c) => c.name), named) && !store.hasClip(id, 'r17-clip.mkv') && store.clipUsage().clips === 3,
      'kept to those, the clip of the death that never happened goes, and no longer counts against the cap');
    const page = reviewClips.presentClips(store.get(id).review, { has: (n) => store.hasClip(id, n), url: (n) => scheme.urlFor(id, n) });
    ok(page.rounds.filter((c) => c.forensics && c.forensics.clipUrl).map((c) => c.n).join() === '2,14,19', 'and the three it names still play');
  });

  await section('the review as a page is shown it:', () => {
    const id = newId('valorant', T0);
    const on = new Set(['r2-clip.mkv']);
    const io = { has: (n) => on.has(n), url: (n) => scheme.urlFor(id, n) };
    const rv = reviewOf(id, T0);
    const before = JSON.stringify(rv);
    const out = reviewClips.presentClips(rv, io);
    const f = (r, n) => r.rounds.find((c) => c.n === n).forensics;
    ok(f(out, 2).clipUrl === `occlara-clip://review/${id}/r2-clip.mkv` && !f(out, 2).clipGone, 'a clip on disk is played from its URL');
    ok(!f(out, 9).clipUrl && !f(out, 9).clipGone, 'one simply missing (a review restored without its clips) is left out, its frames as before');
    ok(JSON.stringify(rv) === before && out !== rv, 'and the review handed in is never changed');
    const space = reviewClips.presentClips({ ...rv, clipsCleared: { reason: 'space', at: T0 } }, io);
    const gone = reviewClips.presentClips({ ...rv, clipsCleared: { reason: 'cleared', at: T0 } }, io);
    ok(f(space, 9).clipGone === 'space' && f(gone, 9).clipGone === 'cleared' && f(space, 2).clipUrl && !f(space, 2).clipGone,
      'one cleared says so, for space or from Settings, while one on disk still plays');
    ok(out.rounds[1] === rv.rounds[1], 'a round with no look is the same round');
    const lol = reviewClips.presentClips({ kind: 'lol', deathList: [{ n: 1, atSec: 300, clip: 'd1-clip.mkv' }, { n: 2, atSec: 600, clip: 'd2-clip.mkv' }] },
      { has: (n) => n === 'd1-clip.mkv', url: (n) => scheme.urlFor(id, n) });
    ok(lol.deathList[0].clipUrl === `occlara-clip://review/${id}/d1-clip.mkv` && !lol.deathList[1].clipUrl, 'and a League review\'s deaths the same way');
    ok(same(reviewClips.namedClips(rv), ['r2-clip.mkv', 'r9-clip.mkv']), 'every clip a review names, from its cards');
  });

  await section('the review carries a look\'s clip onto its card:', () => {
    const abyss = replay(load('valorant-match-abyss-13-11.json').frames, 'standard');
    const rows = abyss.rounds.map((r) => ({ ...r }));
    const two = rows.find((r) => r.died);
    const other = rows.filter((r) => r.died)[1];
    two.forensics = { cause: 'dry-peek', what: 'x.', better: 'y.', frames: [`r${two.n}-before.jpg`], source: 'screen', at: T0, clip: clips.roundClip(two.n), moment: T0 + 2000 };
    other.forensics = { cause: 'isolated', what: 'x.', better: 'y.', frames: [], source: 'screen', at: T0, clip: '../../evil.mkv' };
    const rv = valorantReview.build({ rounds: rows, context: abyss.context, endedBy: 'score', ai: {} });
    const card = (n) => rv.rounds.find((c) => c.n === n);
    ok(card(two.n).forensics.clip === `r${two.n}-clip.mkv`, `round ${two.n}'s card names its clip`);
    ok(card(other.n).forensics.clip === null, 'and one named like a path is never carried');
    ok(!('moment' in card(two.n).forensics), 'the moment it was cut at stays with the look and out of the saved review');
  });

  await section('the scheme serves a clip by range, and nothing else:', async () => {
    ok(scheme.SCHEME === 'occlara-clip' && same(scheme.PRIVILEGED, { scheme: 'occlara-clip', privileges: { standard: true, secure: true, stream: true } }),
      'occlara-clip, registered standard, secure and stream');
    const id = newId('valorant', T0);
    ok(scheme.urlFor(id, 'r2-clip.mkv') === `occlara-clip://review/${id}/r2-clip.mkv`, 'a clip\'s URL is its review and its name');
    ok(same(scheme.parse(`occlara-clip://review/${id}/r2-clip.mkv`), { id, name: 'r2-clip.mkv' }), 'and the URL reads back to the two');
    const notClips = [`occlara-clip://review/${id}/r2-before.jpg`, `occlara-clip://other/${id}/r2-clip.mkv`, `occlara-clip://review/${id}/x/r2-clip.mkv`,
      `occlara-clip://review/r2-clip.mkv`, `occlara-clip://review/${id}/r2-clip.mkv?x=1`, `occlara-clip://review/${id}/r2-clip.mkv#t=2`,
      `file:///review/${id}/r2-clip.mkv`, `occlara-clip://review/${id}/..%2Fr2-clip.mkv`, 'not a url'];
    ok(notClips.every((u) => scheme.parse(u) === null), 'and any other URL reads as nothing', notClips.filter((u) => scheme.parse(u)).join(' '));
    const R = (h, size) => scheme.rangeOf(h, size);
    ok(R(undefined, 1000) === null && R('', 1000) === null, 'no Range: the whole clip');
    ok(same(R('bytes=0-', 1000), { start: 0, end: 999 }) && same(R('bytes=0-99', 1000), { start: 0, end: 99 })
      && same(R('bytes=500-', 1000), { start: 500, end: 999 }) && same(R('bytes=900-5000', 1000), { start: 900, end: 999 })
      && same(R('bytes=-100', 1000), { start: 900, end: 999 }) && same(R('bytes=-5000', 1000), { start: 0, end: 999 }) && same(R(' bytes=0-0 ', 1000), { start: 0, end: 0 }),
    'a range from a byte, to a byte, open ended, past the end, and the last n bytes, as HTTP reads them');
    ok(R('bytes=1000-', 1000) === 'unsatisfiable' && R('bytes=-0', 1000) === 'unsatisfiable' && R('bytes=0-', 0) === 'unsatisfiable',
      'one starting at or past the end cannot be satisfied');
    ok(R('bytes=0-1,5-9', 1000) === 'ignore' && R('items=0-1', 1000) === 'ignore' && R('bytes=9-1', 1000) === 'ignore' && R('bytes=-', 1000) === 'ignore',
      'several ranges, another unit, an end before its start: ignored, as HTTP allows');

    const root = freshDir();
    const store = new ReviewStore(root);
    store.save({ id, game: 'valorant', at: T0, review: reviewOf(id, T0), frames: { 'r2-before.jpg': b64('frame') } });
    const clip = reader.clusters.length ? webm.cutClip({ init: reader.init, clusters: reader.clusters, from: 2000, to: 6000 }) : null;
    store.saveClip(id, 'r2-clip.mkv', clip);
    const handle = scheme.createHandler({ fileOf: (i, n) => store.clipFile(i, n) });
    const url = scheme.urlFor(id, 'r2-clip.mkv');
    const ask = (u, init) => handle(new Request(u, init));
    const whole = await ask(url);
    const body = Buffer.from(await whole.arrayBuffer());
    ok(whole.status === 200 && whole.headers.get('content-type') === SPEC.mime && whole.headers.get('accept-ranges') === 'bytes'
      && whole.headers.get('content-length') === String(clip.length) && body.equals(clip),
    `no Range: 200, the whole clip (${clip.length} bytes), video/x-matroska, Accept-Ranges bytes`);
    const first = await ask(url, { headers: { Range: 'bytes=0-' } });
    ok(first.status === 206 && first.headers.get('content-range') === `bytes 0-${clip.length - 1}/${clip.length}`
      && Buffer.from(await first.arrayBuffer()).equals(clip), 'Chromium\'s first ask, bytes=0-: 206 with its Content-Range, every byte');
    const mid = await ask(url, { headers: { Range: 'bytes=100-199' } });
    ok(mid.status === 206 && mid.headers.get('content-range') === `bytes 100-199/${clip.length}` && mid.headers.get('content-length') === '100'
      && Buffer.from(await mid.arrayBuffer()).equals(clip.subarray(100, 200)), 'a seek\'s range: 206, those 100 bytes and no others');
    const tail = await ask(url, { headers: { Range: 'bytes=-64' } });
    ok(tail.status === 206 && Buffer.from(await tail.arrayBuffer()).equals(clip.subarray(clip.length - 64)), 'the last 64 bytes');
    const past = await ask(url, { headers: { Range: `bytes=${clip.length}-` } });
    ok(past.status === 416 && past.headers.get('content-range') === `bytes */${clip.length}` && !(await past.arrayBuffer()).byteLength,
      'past the end: 416, with the size');
    const multi = await ask(url, { headers: { Range: 'bytes=0-1,4-5' } });
    ok(multi.status === 200 && Buffer.from(await multi.arrayBuffer()).equals(clip), 'several ranges: the whole clip, 200');
    const head = await ask(url, { method: 'HEAD', headers: { Range: 'bytes=0-9' } });
    ok(head.status === 206 && head.headers.get('content-length') === '10' && !(await head.arrayBuffer()).byteLength, 'HEAD: the headers, no body');
    const post = await ask(url, { method: 'POST', body: 'x' });
    ok(post.status === 405, 'any other method: 405');
    const refused = [`occlara-clip://review/${id}/r2-before.jpg`, scheme.urlFor(id, 'r9-clip.mkv'),
      scheme.urlFor('valorant-1-x', 'r2-clip.mkv'), `occlara-clip://review/${id}/r2-clip.mkv/extra`, `occlara-clip://review/../r2-clip.mkv`];
    const answers = [];
    for (const u of refused) answers.push((await ask(u)).status);
    ok(answers.every((s) => s === 404), `a frame, a clip not on disk, an id that is not a review's, a longer path: 404, and nothing said (${answers.join(', ')})`);
    // A clip's name for a file that is not one: a folder named like a clip.
    fs.mkdirSync(path.join(root, id, 'r5-clip.mkv'));
    ok((await ask(scheme.urlFor(id, 'r5-clip.mkv'))).status === 404, 'and a folder named like a clip is not a clip');
    const nothingBody = await ask(scheme.urlFor(id, 'r9-clip.mkv'));
    ok(!(await nothingBody.arrayBuffer()).byteLength, 'a 404 carries no body');
  });

  await section('the match\'s recording goes once Riot\'s look has cut its clips:', async () => {
    // index.js's own look (forensicsFor and all it calls) run in a sandbox,
    // with the real recorder's holds and cut over the canvas fixture, the real
    // store, a stand in for the server and the frames page, and the next match
    // in progress while the look waits to take its stills (afterMatch). Held
    // to the link's end, the match before's recording, about 1.6 GB at 1080p,
    // was kept through the whole of the next one (8.3.1).
    const vm = require('vm');
    const mainSrc = mainText();
    const fnOf = (head) => { const i = mainSrc.indexOf(head); const j = i < 0 ? -1 : mainSrc.indexOf('\n}\n', i); return j < 0 ? '' : mainSrc.slice(i, j + 3); };
    const lineOf = (head) => { const i = mainSrc.indexOf(head); return i < 0 ? '' : mainSrc.slice(i, mainSrc.indexOf('\n', i) + 1); };
    const needed = ['\nasync function forensicsFor(', '\nasync function askForensics(', '\nasync function afterMatch(', '\nasync function recordingStills(',
      '\nfunction clipLooks(', '\nasync function cutLookClips(', '\nfunction keepLookClips('].map(fnOf);
    ok(needed.every(Boolean) && lineOf('const AFTER_MATCH_POLL_MS'), 'the look\'s own code is found in main');
    const src = [lineOf('const AFTER_MATCH_MAX_MS'), lineOf('const AFTER_MATCH_POLL_MS'), ...needed, fnOf('\nfunction recordingCut(')].join('\n');

    // The recording: the canvas fixture, its death 9 s in.
    const mem = new Map();
    const files = {
      mkdir() {}, write: (f, b) => mem.set(f, Buffer.from(b)), append: (f, b) => mem.set(f, Buffer.concat([mem.get(f) || Buffer.alloc(0), Buffer.from(b)])),
      read: (f, off, size) => mem.get(f).subarray(off, off + size), remove: (f) => mem.delete(f), removeTree() {}, list: () => [],
    };
    const seg = new Segment(path.join('/x', 'rec-look'), files, 60000);
    seg.startWall = T0 + 7200000;
    const meta = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'recording-canvas.json'), 'utf8'));
    const bytesOf = fs.readFileSync(FIXTURE);
    let off = 0;
    for (const c of meta.chunks) { seg.push(bytesOf.subarray(off, off + c.size), seg.startWall + c.atMs); off += c.size; }
    seg.finish();
    const rec = new Recorder({ root: '/x', prefs: { get: () => null, set() {} }, files, log: () => {} });
    rec.segments = [seg];
    const M = seg.zero() + seg.clusters()[0].timecode + 9000;
    // The AI log of the round: its clock read a second until a second before
    // the death, Riot's 7.4 s after the barriers dropped, then the death read.
    const logDir = freshDir();
    const records = [];
    const add = (at, state, died) => {
      const i = records.length;
      const frame = `frame-${String(i).padStart(5, '0')}.jpg`;
      fs.writeFileSync(path.join(logDir, frame), Buffer.from(`frame ${i}`));
      records.push({ i, at: Math.round(at), frame, state, round: 2, died: !!died, match: M - 70000 });
    };
    const DROP = M - 7400;
    for (let k = 0; k < 7; k++) add(DROP + (0.4 + k) * 1000, { phase: 'active', clock: `1:${String(39 - k).padStart(2, '0')}` });
    add(M + 1500, { phase: 'dead' }, true);
    add(M + 2500, { phase: 'dead' });
    const snap = { log: { dir: logDir, records }, startedAt: M - 70000, endedAt: M + 60000,
      context: { agent: 'Jett', agentConfirmed: true, map: 'Sunset', language: 'en' } };
    const riotRows = [{ n: 2, verified: true, died: true, result: 'lost', firstDeath: true, traded: false, deathSec: 7, deathMs: 7400,
      plantMs: null, afterPlant: false, screenDied: true, side: 'attacking', killerAgent: 'Sova', weapon: 'Vandal', deathSpot: 'B Main' }];
    const library = new ReviewStore(freshDir());
    const reviewFor = (at) => {
      const id = newId('valorant', at);
      library.save({ id, game: 'valorant', at, review: { id, at, kind: 'valorant', rounds: [] } });
      // As onValorantMatchEnded holds it: the match, and five minutes past its end.
      return { id, cancelled: false, recording: rec.hold(snap.startedAt - 5000, snap.endedAt + 300000) };
    };

    let playing = true;
    let asked = 0;
    let mode = 'auto';
    const cutsAt = [];
    const sent = [];
    const box = vm.createContext({
      console: { log() {}, warn() {}, error() {} }, fs, path, Buffer, Map, Set, Promise, Date, Math, Number, JSON, Object, Array, String,
      setTimeout: (f, ms) => setTimeout(f, Math.min(ms, 20)),
      deathFrames, clips, reviewClips, lookStills, reviewStore: library,
      recorder: { cutClip: (...a) => { cutsAt.push(rec.holds.length); return rec.cutClip(...a); } },
      releaseRecording: (h) => rec.release(h),
      store: { get: (k) => ({ recordingMode: mode, licenseKey: 'TEST' })[k] },
      CAPTURE: { profiles: { standard: { targetW: 1280, targetH: 720, jpegQuality: 70 } } },
      API: { DEATH_FORENSICS: '/api/coach/death-forensics' },
      api: { post: async (_p, body) => {
        sent.push(body);
        return { ok: true, data: { deaths: body.deaths.map((d) => ({ n: d.n, cause: 'isolated', what: 'You held it alone.', better: 'Hold it with a teammate.' })) } };
      } },
      matchInProgress: () => { asked++; return playing; },
      applyClipCap() {},
      require: (m) => {
        if (m !== './windows/frames-window') throw new Error(`${m} is not in the sandbox`);
        return { open: async () => ({ decode: async (j) => ({ ok: true, frames: j.picks.map(() => Buffer.from('a still')) }), close() {} }) };
      },
    });
    const main = vm.runInContext(`${src}\n;({ forensicsFor })`, box);
    const until = async (fn, ms) => { const end = Date.now() + ms; while (!fn() && Date.now() < end) await new Promise((r) => setTimeout(r, 10)); return !!fn(); };

    const job = reviewFor(M + 60000);
    ok(rec.holds.length === 1, 'the match ended: its recording is held');
    const out = main.forensicsFor(riotRows, snap, { job, stale: () => job.cancelled });
    const waited = await until(() => asked >= 4, 5000);
    const heldWhileWaiting = rec.holds.length;
    const clipped = library.hasClip(job.id, 'r2-clip.mkv');
    playing = false;
    const looked = await out;
    ok(cutsAt.length === 1 && cutsAt[0] === 1, `Riot's look cut its clip while the match's recording was held (${cutsAt.join(', ')} hold at the cut)`);
    ok(waited && clipped && heldWhileWaiting === 0 && rec.stats().holds === 0,
      `and let it go once the clip was cut: while the look waited for the match in progress, ${heldWhileWaiting} hold, the clip ${clipped ? 'beside the review' : 'missing'}`);
    const d2 = sent[0] && sent[0].deaths.find((x) => x.n === 2);
    ok(sent.length === 1 && d2 && d2.framesFrom === 'recording' && d2.frames.length === 5 && looked.byRound[2] && looked.byRound[2].clip === 'r2-clip.mkv',
      `its stills were still taken once that match was over, from the clip beside the review (${d2 ? `${d2.frames.length} from the ${d2.framesFrom}` : 'none sent'})`);
    const again = await main.forensicsFor(riotRows, snap, { job, stale: () => job.cancelled });
    ok(cutsAt.length === 1 && again.byRound[2] && again.byRound[2].clip === 'r2-clip.mkv' && sent[1] && sent[1].deaths[0].framesFrom === 'recording'
      && library.hasClip(job.id, 'r2-clip.mkv'),
    'and a look of the match after it, Riot\'s again after a failure, takes that clip and asks the recorder for nothing');

    // The screen's look comes before Riot's when no Riot ID is set, and Riot's
    // may still follow it: it cuts, and lets nothing go.
    const job2 = reviewFor(M + 61000);
    const cutsBefore = cutsAt.length;
    const screenRows = [{ n: 2, died: true, verified: false, result: 'lost', early: true, side: 'attacking', deathSpot: 'B Main' }];
    const fromScreen = await main.forensicsFor(screenRows, snap, { source: 'screen', job: job2, stale: () => job2.cancelled });
    ok(cutsAt.length === cutsBefore + 1 && fromScreen.byRound[2] && fromScreen.byRound[2].clip === 'r2-clip.mkv' && rec.holds.includes(job2.recording),
      `while a look from the screen cuts its clip and lets the recording go no sooner (${rec.holds.includes(job2.recording) ? 'still held' : 'let go'} after it)`);
    rec.release(job2.recording);

    // OFF CHOSEN WHILE THE LOOK WAITS for the match in progress, its clip cut
    // already: the look lands naming none and keeps none, and is sent the
    // read's frames, as a look taken after Off is. 8.3.0 cut a look's clips
    // after it landed, so Off chosen before then kept none.
    const job3 = reviewFor(M + 62000);
    playing = true;
    const asks3 = asked;
    const late = main.forensicsFor(riotRows, snap, { job: job3, stale: () => job3.cancelled });
    const cutFirst = await until(() => asked >= asks3 + 2 && library.hasClip(job3.id, 'r2-clip.mkv'), 5000);
    mode = 'off';
    playing = false;
    const offLook = await late;
    const d3 = sent.length > 2 ? sent[sent.length - 1].deaths.find((x) => x.n === 2) : null;
    const f3 = offLook.byRound[2];
    ok(cutFirst && f3 && !f3.clip && !library.hasClip(job3.id, 'r2-clip.mkv') && d3 && d3.framesFrom === 'reads',
      `and Off chosen while it waited, its clip already cut, leaves no clip named or kept and sends the read's frames (clip ${f3 && f3.clip ? f3.clip : 'none'}, `
      + `${library.hasClip(job3.id, 'r2-clip.mkv') ? 'kept' : 'gone'}, sent from the ${d3 ? d3.framesFrom : 'nothing'})`);
    mode = 'auto';
  });

  await section('the words:', () => {
    const own = ['src/shared/clips.js', 'src/main/services/clip-scheme.js', 'src/main/services/review-clips.js', 'src/shared/clip-frames.js',
      'src/main/services/look-stills.js', 'src/main/windows/frames-window.js', 'src/preload/frames-preload.js', 'src/renderer/frames/frames.js',
      'src/renderer/frames/index.html', 'src/shared/death-frames.js'];
    ok(own.every((f) => !DASHES.test(fs.readFileSync(path.join(__dirname, '..', f), 'utf8')))
      && DASHES.test(String.fromCharCode(0x2014)) && DASHES.test(String.fromCharCode(0x2013)) && !DASHES.test('a-b'),
    'no dash in the clips\' modules (the detector matches both dashes and not a hyphen)');
  });

  console.log(fails ? `\nFAIL: ${fails} of ${checks} clip checks failed` : `\nPASS: all ${checks} clip checks passed`);
  finished = true;
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log(`FAIL  the test itself threw: ${e.stack || e}`); process.exit(1); });

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
    const abyss = replay(load('valorant-match-abyss-13-11.json').frames, 'standard');
    const riotRounds = verify.reconcile(abyss.rounds, load('riot-abyss-13-11.json')).rounds;
    const riotLooks = deathFrames.looksFor(abyss.records, riotRounds, {}, 'riot');
    // Riot gives the second into the round; the frame before it gives its own
    // second off the round clock and the wall time it was captured. The death
    // is that capture plus the seconds between them, and so it falls between
    // the frame before and the one after it, where there is one.
    const got = riotLooks.map((l) => ({ n: l.round.n, gap: l.gap, moment: clips.momentOf(l), at: l.at, next: l.frames[1] ? l.frames[1].at : null }));
    ok(got.length === 4 && same(got.map((g) => [g.n, g.gap]), [[2, 4], [3, 1], [10, 3], [19, 5]])
      && got.every((g) => g.moment === g.at + g.gap * 1000),
      `Riot's looks on the real Abyss match: the death at the frame before it plus Riot's seconds past it (${got.map((g) => `R${g.n} +${g.gap}s`).join(', ')})`);
    ok(got.some((g) => g.gap > clips.LEAD_MS / 1000), 'where a fixed two seconds would have put at least one death early', got.map((g) => g.gap).join(', '));

    // THE REAL SPLIT SESSION, through the real reader (coaching-engine.js), its
    // frames logged as the AI log logs them and Riot's record laid over the
    // ledger, the way a review is looked at. Read every one to five seconds,
    // and with the frames the model misread that the simple replay never has.
    const SPLIT_RIOT = load('riot-split-13-7.json');
    const split = replaySession('valorant-session-split-competitive.json', SPLIT_RIOT);
    const sec = (ms) => (Number.isFinite(ms) ? Math.round((ms - split.t0) / 100) / 10 : null);
    const four = deathFrames.looksFor(split.records, split.rounds, split.window, 'riot');
    // Every death Riot has in it, looked at as one of the four would be.
    const every = deathFrames.looksFor(split.records, split.rounds, split.window, 'riot', 24);
    const of = (list, n) => list.find((l) => l.round.n === n) || null;
    const shown = (l) => (l ? `R${l.round.n} ${l.frames.map((f) => `${sec(f.at)} s ${f.state.phase} ${f.state.clock || ''}`.trim()).join(' / ')}` : 'none');
    // Where Riot's death was on the wall clock: the frame its round's buy
    // timer read 0:00 on, the barriers dropping, plus Riot's own milliseconds.
    const dropAt = (t) => {
      const r = split.records.find((x) => sec(x.at) === t);
      return r && r.state.phase === 'buy' && r.state.clock === '0:00' ? r.at : null;
    };
    const riotDeath = (n, drop) => (dropAt(drop) === null ? null : dropAt(drop) + SPLIT_RIOT.perRound.find((p) => p.n === n).deathMs);
    const holds = (l, death) => {
      const w = clips.windowOf(clips.momentOf(l));
      return !!w && death !== null && w.from <= death && death <= w.to;
    };
    ok(four.map((l) => l.round.n).join() === '3,7,8,15' && four.filter((l) => l.gap !== null).map((l) => `${l.round.n}+${l.gap}`).join() === '3+2,7+3,8+3',
      `the Split match's looks are rounds 3, 7, 8 and 15, the clock framing three of them by Riot's second (${four.map((l) => `R${l.round.n} ${l.gap === null ? 'no gap' : `+${l.gap}s`}`).join(', ')})`);
    // Round 15: Riot has the death 2 s into the round. No clocked frame comes
    // before it, so its frames are the screen's: the one before the death (a
    // buy phase frame the model read as "active 0:18", 82 s into the round by
    // that clock) and the one that registered it.
    const r15 = of(four, 15);
    ok(r15 && r15.gap === null && r15.frames.length === 2 && sec(r15.frames[0].at) === 1529.1 && r15.frames[0].state.clock === '0:18'
      && r15.frames[1].died && sec(clips.momentOf(r15)) === 1550.4,
    `round 15, framed by the buy timer read as the round clock, has no gap: its death is the frame that registered it, 1550.4 s in (${shown(r15)}, moment ${sec(clips.momentOf(r15))} s)`);
    ok(r15 && holds(r15, riotDeath(15, 1547.4)),
      `and its clip's 15 seconds hold the death, ${sec(riotDeath(15, 1547.4))} s in by the buy timer's end and Riot's 2.13 s (cut by that clock, they were 1518.1 to 1533.1 s, inside the buy phase)`);
    // Round 1, a post plant death: the clock on its frames is the spike's.
    const r1 = of(every, 1);
    ok(r1 && r1.round.afterPlant && r1.gap === null && r1.frames.length === 2 && r1.frames[1].died && sec(clips.momentOf(r1)) === 77.8,
      `round 1, after the plant, has no gap either: its death is its registering frame, 77.8 s in (${shown(r1)}, moment ${sec(clips.momentOf(r1))} s)`);
    ok(r1 && holds(r1, riotDeath(1, 43.4)), `and its clip holds the death, ${sec(riotDeath(1, 43.4))} s in (cut by the spike's clock, it was around 98.8 s, 21 s past it)`);
    // THE PLANT ALONE SAYS SO, whatever the clock reads. Once the spike is down
    // the round clock leaves the screen, and a frame read after it carries one
    // read before. On the real Abyss match, read every ten seconds, through the
    // real reader, rounds 6 and 16 died after the plant on frames still reading
    // 1:20 and 1:23, readings first taken about 18 s earlier: 10 and 8 s before
    // Riot's second by those clocks, though by their rounds' buy timers both
    // frames came after the death.
    const abyssSession = replaySession('valorant-session-abyss-unrated.json', load('riot-abyss-13-11.json'));
    const planted = deathFrames.looksFor(abyssSession.records, abyssSession.rounds, abyssSession.window, 'riot', 24)
      .filter((l) => l.round.afterPlant);
    const byClock = (l) => { const t = deathFrames.secondsIn(l.frames[0]); return t === null ? null : l.round.deathSec - t; };
    const near = planted.filter((l) => { const d = byClock(l); return d !== null && d >= 0 && d <= deathFrames.BEFORE_MS / 1000; });
    ok(near.map((l) => l.round.n).join() === '6,16' && planted.every((l) => l.gap === null),
      `a death after the plant has no gap, even where its frame's clock reads within ten seconds of Riot's second (${planted.map((l) => `R${l.round.n} `
      + `${byClock(l) === null ? 'no clock' : `${byClock(l)} s by its clock`}, ${l.gap === null ? 'no gap' : `+${l.gap}s`}`).join('; ')})`);
    // Each moment between the frame before the death and the one after it,
    // where a look has both: none on Abyss, some on Split, the clock's and
    // the screen's.
    const pairs = [...riotLooks, ...every].filter((l) => l.frames.length === 2);
    const between = (l) => { const m = clips.momentOf(l); return m >= l.frames[0].at && m <= l.frames[1].at; };
    ok(pairs.length >= 2 && pairs.some((l) => l.gap !== null) && pairs.some((l) => l.gap === null) && pairs.every(between),
      `and each lands between the frame before the death and the one after it (${pairs.length} looks with both: `
      + `${pairs.map((l) => `R${l.round.n} ${sec(clips.momentOf(l))} s in [${sec(l.frames[0].at)}, ${sec(l.frames[1].at)}]`).join(', ')})`);
    const screenLooks = deathFrames.looksFor(abyss.records, abyss.rounds, {}, 'screen');
    ok(screenLooks.length === 4 && screenLooks.every((l) => clips.momentOf(l) === l.frames[1].at && l.frames[1].died),
      `the screen's looks: the death at the frame the screen registered it on (${screenLooks.map((l) => `R${l.round.n} +${(l.frames[1].at - l.at) / 1000}s`).join(', ')})`);
    ok(clips.momentOf({ at: T0, gap: null, frames: [{ at: T0 }] }) === T0 + 2000 && clips.momentOf({ at: T0 }) === T0 + 2000,
      'a look of one frame: two seconds after it, the margin the frame picker keeps');
    ok(clips.momentOf({ at: null, gap: 3 }) === null && clips.momentOf(null) === null, 'and a look with no time has no moment');
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

  await section('the words:', () => {
    ok(!DASHES.test(fs.readFileSync(path.join(__dirname, '..', 'src', 'shared', 'clips.js'), 'utf8'))
      && !DASHES.test(fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'services', 'clip-scheme.js'), 'utf8'))
      && !DASHES.test(fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'services', 'review-clips.js'), 'utf8'))
      && DASHES.test(String.fromCharCode(0x2014)) && DASHES.test(String.fromCharCode(0x2013)) && !DASHES.test('a-b'),
    'no dash in the clips\' modules (the detector matches both dashes and not a hyphen)');
  });

  console.log(fails ? `\nFAIL: ${fails} of ${checks} clip checks failed` : `\nPASS: all ${checks} clip checks passed`);
  finished = true;
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log(`FAIL  the test itself threw: ${e.stack || e}`); process.exit(1); });

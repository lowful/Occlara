'use strict';

/**
 * THE FLAG KEY AND FURTHER EXPLAIN (8.13): which keys may be bound, which death
 * a press means, the flagged clip's window and its place ahead of the cap, what
 * a review shows, the client's one saved answer and the server's gates.
 * Offline: no model is called.
 *
 * Run: npm run test:deathflags
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const flagKey = require('../src/shared/flag-key');
const flags = require('../src/shared/death-flags');
const clips = require('../src/shared/clips');
const deathFrames = require('../src/shared/death-frames');
const review = require('../src/shared/valorant-review');
const { pageWritable } = require('../src/main/ipc/config-keys');
const { ReviewStore } = require('../src/main/services/review-store');
const reviewClips = require('../src/main/services/review-clips');
const { createDeathExplain } = require('../src/main/services/death-explain');
const serverExplain = require('../server/services/death-explain');
const forensics = require('../server/services/death-forensics');

let failed = 0;
let passed = 0;
function ok(cond, what) {
  if (cond) { passed += 1; return; }
  failed += 1;
  console.log(`  FAIL ${what}`);
}

// ── The key ─────────────────────────────────────────────────────────────────
for (const k of ['F8', 'F1', 'F24', 'Insert', 'PageDown', 'num5', 'Alt+G', 'Ctrl+Alt+7', 'Ctrl+Shift+G', 'Shift+F9']) ok(flagKey.check(k).ok, `${k} may be bound`);
for (const k of ['', 'G', '4', 'Space', 'Tab', 'Enter', 'Escape', 'Shift+W', 'Ctrl+W', 'F12', 'Alt+F4', 'Ctrl+Shift+E', 'Ctrl+Shift+P', 'Meta+G', 'Ctrl+Ctrl+G']) ok(!flagKey.check(k).ok, `"${k}" may not be bound`);
ok(flagKey.normal('Shift+Ctrl+G') === 'Ctrl+Shift+G', 'modifiers come back in one order');
ok(flagKey.fromEvent({ code: 'ShiftLeft', shiftKey: true }).pending === true, 'a modifier alone waits for the key');
ok(flagKey.fromEvent({ code: 'F8' }).accel === 'F8', 'F8 from a key event');
ok(flagKey.fromEvent({ code: 'KeyG', altKey: true }).accel === 'Alt+G', 'Alt+G from a key event');
ok(flagKey.fromEvent({ code: 'Numpad3' }).accel === 'num3', 'a numpad key from a key event');
ok(!flagKey.fromEvent({ code: 'KeyW' }).ok, 'a bare W from a key event is refused');
ok(!flagKey.fromEvent({ code: 'F8', metaKey: true }).ok, 'the Windows key is refused');
ok(flagKey.label('num3') === 'Numpad 3' && flagKey.label('PageUp') === 'Page Up', 'keys are said in words');
ok(pageWritable({ flagKey: 'F9' }).flagKey === 'F9' && pageWritable({ flagKey: '' }).flagKey === '', 'a page may set a key or none');
ok(!('flagKey' in pageWritable({ flagKey: 'W' })) && !('flagKey' in pageWritable({ flagKey: 5 })), 'a page may not set a key the game needs');

// ── Which death a press means ───────────────────────────────────────────────
const D = (n, start, until) => ({ n, start, until });
const deaths = [D(3, 100000, 190000), D(5, 300000, 390000)];
let r = flags.resolve([120000], deaths);
ok(r.rounds.length === 1 && r.rounds[0].n === 3, 'a press while dead flags that death');
r = flags.resolve([189000], deaths);
ok(r.rounds[0].n === 3, 'a press in the next buy phase still flags it');
r = flags.resolve([191000], deaths);
ok(!r.rounds.length && r.unmatched.length === 1, 'a press back in play matches nothing');
r = flags.resolve([50000], deaths);
ok(!r.rounds.length && r.unmatched.length === 1, 'a press before any death matches nothing');
r = flags.resolve([99000], deaths);
ok(r.rounds[0] && r.rounds[0].n === 3, 'a press a moment before the read start still counts');
r = flags.resolve([110000, 120000, 310000], deaths);
ok(r.rounds.length === 2 && r.rounds[0].presses.length === 2, 'two presses on one death are one flag');
const eight = Array.from({ length: 8 }, (_, i) => D(i + 1, i * 100000, i * 100000 + 90000));
r = flags.resolve(eight.map((d) => d.start + 1000), eight);
ok(r.rounds.length === flags.MAX_FLAGS && r.over.length === 2 && r.rounds.map((x) => x.n).join() === '1,2,3,4,5,6', 'the first six are kept and the rest counted');
ok(flags.addPress([1000], 1200).length === 1 && flags.addPress([1000], 1500).length === 2, 'a held key is one press');
ok(flags.pressesIn([1, 5, 9], 2, 8).join() === '5', 'only the presses in the match');

// Riot's record replaces the screen's deaths.
const screen = flags.merge(null, flags.resolve([120000], [D(3, 100000, 190000)]));
screen.rounds[0].clip = 'r3-clip.mkv';
const same = flags.merge(screen, flags.resolve([120000], [D(3, 110000, 190000)]));
ok(same.rounds[0].clip === 'r3-clip.mkv' && !same.rounds[0].noDeath, 'a flag keeps its clip when the death is confirmed');
const none = flags.merge(screen, flags.resolve([120000], []));
ok(none.rounds[0].n === 3 && none.rounds[0].noDeath === true && none.rounds[0].clip === 'r3-clip.mkv' && !none.unmatched.length,
  "a death Riot says never happened keeps its flag and clip, and says so");
const kept = flags.merge({ rounds: [{ n: 3, presses: [120000], target: { n: 3, start: 1, read: 2 } }] }, flags.resolve([120000], []));
ok(kept.rounds[0].noDeath && kept.rounds[0].target.n === 3, 'a flag Riot denies remembers where to cut its clip');
const v = flags.view(none, false);
ok(!('presses' in v.rounds[0]) && !('target' in v.rounds[0]) && v.rounds[0].noDeath === true, 'a review keeps no press times');
ok(flags.view({ rounds: [], unmatched: [], over: [] }, false) === null && flags.view(null, true).keyFailed === true, 'nothing to say saves nothing, a held key is said');

// ── The clip ────────────────────────────────────────────────────────────────
let w = clips.flagWindow({ moment: 100000 });
ok(w.from === 80000 && w.to === 106000, "around Riot's moment, 20 s before and 6 s after");
w = clips.flagWindow({ moment: 100000, drop: 95000 });
ok(w.from === 94000 + 3000 - 4000 || w.from <= 97000, 'an early death keeps its first still');
ok(w.from >= 80000 && w.from <= 97000, 'and does not run back through the buy phase');
w = clips.flagWindow({ start: 100000, read: 110000 });
ok(w.from === 88000 && w.to === 114000, 'from the screen it covers the whole span the death lies in');
w = clips.flagWindow({ start: 100000, read: 180000 });
ok(w.to - w.from === clips.FLAG_MAX_MS, 'and is never longer than the limit');
ok(clips.flagWindow({}) === null, 'no time, no window');

// ── Which deaths are looked at ──────────────────────────────────────────────
const round = (n, extra) => ({ n, died: true, verified: true, deathSec: 20, result: 'won', ...extra });
const rounds = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => round(n, n < 5 ? { result: 'lost', firstDeath: true } : {}));
const records = [];
for (const r0 of rounds) {
  const t = r0.n * 200000;
  records.push({ at: t, frame: `f${r0.n}a.jpg`, round: r0.n, state: {} }, { at: t + 2000, frame: `f${r0.n}b.jpg`, round: r0.n, died: true, state: {} });
}
const picks = (f) => deathFrames.looksFor(records, rounds, {}, 'riot', 4, f).map((l) => l.round.n);
ok(picks([]).length === 4 && picks([]).join() === deathFrames.looksFor(records, rounds, {}, 'riot').map((l) => l.round.n).join(), 'with none flagged the choice is as it was');
ok(picks([8]).includes(8) && picks([8]).length === 4, 'a flagged death is looked at, within the four');
ok(picks([5, 6, 7, 8, 1, 2]).length === 6, 'six flagged are all looked at');
const dd = deathFrames.flagDeaths(records, rounds, {});
ok(dd.length === 8 && dd[0].start === 200000 && dd[0].read === 202000 && dd[0].until > dd[0].start, 'each death has its span on the wall clock');

// ── The cap and what a review shows ─────────────────────────────────────────
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'occlara-flags-'));
try {
  const store = new ReviewStore(root);
  const old = 'valorant-1700000000000-aaaaaa';
  const fresh = 'valorant-1700000100000-bbbbbb';
  store.save({ id: old, game: 'valorant', at: 1700000000000, review: { kind: 'valorant', deathFlags: { rounds: [{ n: 3, clip: 'r3-clip.mkv' }], unmatched: 0, over: 0 } } });
  store.save({ id: fresh, game: 'valorant', at: 1700000100000, review: { kind: 'valorant' } });
  store.saveClip(old, 'r3-clip.mkv', Buffer.alloc(100));
  store.saveClip(old, 'r4-clip.mkv', Buffer.alloc(100));
  store.saveClip(fresh, 'r1-clip.mkv', Buffer.alloc(100));
  const gone = store.capClips(150);
  ok(gone.includes(old) && store.hasClip(old, 'r3-clip.mkv') && !store.hasClip(old, 'r4-clip.mkv'), 'the cap passes over a flagged clip and takes the rest');
  ok(store.list()[1].flaggedClips.join() === 'r3-clip.mkv', 'the library row names it');
  store.saveClip(fresh, 'r2-clip.mkv', Buffer.alloc(100));
  store.capClips(50, new Map([[fresh, ['r2-clip.mkv']]]));
  ok(store.hasClip(fresh, 'r2-clip.mkv') && !store.hasClip(fresh, 'r1-clip.mkv'), 'and one flagged a moment ago, not saved yet');
  // Flagged clips past the cap on their own leave every other clip alone.
  store.saveClip(fresh, 'r5-clip.mkv', Buffer.alloc(40));
  store.save({ id: old, game: 'valorant', at: 1700000000000, review: { kind: 'valorant', deathFlags: { rounds: [{ n: 3, clip: 'r3-clip.mkv' }], unmatched: 0, over: 0 } } });
  store.capClips(50, new Map([[fresh, ['r2-clip.mkv']]]));
  ok(store.hasClip(fresh, 'r5-clip.mkv'), 'flagged clips do not count against the cap');
  store.clearClips();
  ok(!store.hasClip(old, 'r3-clip.mkv'), 'Clear clips still takes it');
} finally { fs.rmSync(root, { recursive: true, force: true }); }

const saved = { kind: 'valorant', rounds: [{ n: 3, died: true, facts: [] }, { n: 4, died: false, facts: [] }],
  deathFlags: { rounds: [{ n: 3, clip: 'r3-clip.mkv', clipDeath: 20000 }], unmatched: 1, over: 0 },
  deathExplains: { 3: { happened: 'A.', why: 'B.', instead: 'C.', from: 'facts' }, 4: { happened: 'never' } } };
const shown = review.served(saved);
ok(shown.rounds[0].flag && shown.rounds[0].open === true && shown.rounds[0].explain.why === 'B.', 'a flagged death opens, with its flag and answer');
ok(!shown.rounds[1].explain, 'an answer never shows on a round with no death');
ok(JSON.stringify(review.withoutView(shown).rounds) === JSON.stringify(saved.rounds), 'none of it is written to the cards');
const played = reviewClips.presentClips(shown, { has: () => true, url: (n) => `clip://${n}` });
ok(played.rounds[0].flag.clipUrl === 'clip://r3-clip.mkv', 'its clip is played from the library');
ok(reviewClips.namedClips(saved).includes('r3-clip.mkv'), 'and a late link keeps it');

// ── Further explain, the client ─────────────────────────────────────────────
(async () => {
  const card = { n: 3, died: true, verified: true, sideKey: 'attacking', riot: { sec: 12, killer: 'Jett', traded: false }, forensics: { cause: 'repeek', what: 'W.', frames: ['a.jpg'], frameAt: [-1], framesFrom: 'recording' } };
  const entry = { id: 'valorant-1700000000000-aaaaaa', review: { kind: 'valorant', game: { agent: 'Sova', map: 'Bind' }, rounds: [card, { n: 4, died: false }] } };
  const sent = [];
  let sealed = false;
  let answer = { ok: true, status: 200, data: { explain: { happened: 'H.', why: 'W.', instead: 'I.' }, from: 'recording' } };
  const savedOut = [];
  const svc = createDeathExplain({
    get: () => entry, frame: () => 'x'.repeat(2000), logFrames: () => [], language: () => 'en', rankBand: () => null, now: () => 5,
    sealed: () => sealed, post: async (b) => { sent.push(b); return answer; },
    save: (id, n, a) => { savedOut.push(a); entry.review.deathExplains = { [n]: a }; },
  });
  sealed = true;
  ok((await svc.explain(entry.id, 3)).error === 'match', 'refused mid match, before any call');
  sealed = false;
  ok((await svc.explain(entry.id, 4)).error === 'gone', 'a round with no death is refused');
  answer = { ok: false, status: 429, data: { error: 'chat-cap' } };
  ok((await svc.explain(entry.id, 3)).error === 'locked', 'no games left is said as locked');
  answer = { ok: false, status: 429, data: {} };
  ok((await svc.explain(entry.id, 3)).error === 'later', 'a rate limit is said as later');
  answer = { ok: true, status: 200, data: { explain: { happened: 'H.', why: 'W.', instead: 'I.' }, from: 'recording' } };
  sent.length = 0;
  const [a, b] = await Promise.all([svc.explain(entry.id, 3), svc.explain(entry.id, 3)]);
  ok(a.ok && b.ok && sent.length === 1, 'two clicks are one paid call');
  ok(sent[0].death.frames.length === 1 && sent[0].death.framesFrom === 'recording' && sent[0].look.cause === 'repeek', 'it sends the kept stills and the first look');
  ok(savedOut.length === 1 && savedOut[0].why === 'W.', 'the answer is saved');
  sent.length = 0;
  ok((await svc.explain(entry.id, 3)).ok && !sent.length, 'asked again it costs nothing');

  // ── Further explain, the server ───────────────────────────────────────────
  const input = serverExplain.normalise({ agent: 'Sova', map: 'Bind', language: 'en', source: 'riot', flagged: true,
    death: { n: 3, side: 'attacking', sec: 12, killer: 'Jett', weapon: 'Vandal', traded: false, frames: [] }, look: { cause: 'repeek', what: 'You repeeked.' } });
  ok(input.death && input.death.n === 3 && !input.death.frames.length, 'a death with no picture is accepted');
  const prompt = serverExplain.buildPrompt(input);
  ok(/No picture of this death is kept/.test(prompt) && /Killed by Jett/.test(prompt) && /flagged this death/.test(prompt), 'the prompt says what it has');
  const parsed = serverExplain.parse(JSON.stringify({
    happened: 'You took a second duel with Jett. You can see it in the frame.',
    why: 'Nobody could trade you. Save your credits next time.',
    instead: 'Fall back to your teammate after the first shot.',
  }), input);
  ok(parsed.explain.happened === 'You took a second duel with Jett.', 'a sentence about the frame is dropped, the rest stands');
  ok(parsed.explain.why === 'Nobody could trade you.', 'an economy sentence is dropped');
  ok(parsed.explain.instead.startsWith('Fall back'), 'the fix stands');
  ok(serverExplain.refusal('You can see the angle was open.', input, input.death) === 'sight', 'with no picture it claims no sight');
  ok(serverExplain.parse('no json', input).explain === null, 'a reply that is not JSON is nothing');
  ok(forensics.normalise({ deaths: Array.from({ length: 7 }, (_, i) => ({ n: i + 1, frames: ['x'.repeat(2000)] })) }, { maxDeaths: 6 }).deaths.length === 6, 'a flagging client may send six looks');
  ok(forensics.normalise({ deaths: Array.from({ length: 7 }, (_, i) => ({ n: i + 1, frames: ['x'.repeat(2000)] })) }, {}).deaths.length === 4, 'every other client stays at four');

  console.log(`${failed ? 'FAILED' : 'OK'}: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

'use strict';

/**
 * THE LIVE RATING'S FEED (src/shared/live-rating.js, docs/claude/rating.md
 * "Live"): what main hands it every applied read, the reader's guarded
 * context and the kill feed detector's rows, turned into the rating engine's
 * events once each. Held here: a row seen on many frames counted once, the
 * player's kill only on the yellow seen twice, a row moving up the feed, late
 * rows and stale rounds, a missed round, a false match end and its resume, a
 * new match, a death a guard took back, the highlight that follows the
 * teammate being spectated, the view's fields, and the whole path from drawn
 * pixels through the detector.
 *
 * Pure node, no window. Run: npm run test:liverating
 */
const { createLiveRating, clockLeft } = require('../src/shared/live-rating');
const kf = require('../src/shared/killfeed');
const { drawFrame, cut } = require('./fixtures/killfeed-frames');

let checks = 0;
let fails = 0;
function ok(cond, msg) {
  checks++;
  if (cond) console.log(`  ok  ${msg}`);
  else { fails++; console.log(`  FAIL ${msg}`); }
}

const T0 = 1_800_000_000_000;
const sig = (v, r) => ({ v, r: r || 150, g: 110, b: 120 });
const ROW = {
  myKill: (v) => ({ killer: 'ally', victim: 'enemy', mine: 'kill', sig: sig(v || 0.05) }),
  mateKill: (v) => ({ killer: 'ally', victim: 'enemy', mine: null, sig: sig(v || 0.07, 90) }),
  myDeath: (v) => ({ killer: 'enemy', victim: 'ally', mine: 'death', sig: sig(v || 0.06, 200) }),
  mateDeath: (v) => ({ killer: 'enemy', victim: 'ally', mine: null, sig: sig(v || 0.08, 60) }),
  spectatedKill: (v) => ({ killer: 'ally', victim: 'enemy', mine: 'kill', sig: sig(v || 0.09, 40) }),
};

/**
 * A little match: f(sec, opts) is one applied read sec seconds in, rows the
 * feed's rows top to bottom (each placed at its slot by its index).
 */
function play(opts) {
  const live = createLiveRating(opts || {});
  const state = { match: T0, round: 1, team: 0, enemy: 0, side: 'attacking', phase: 'active' };
  const f = (sec, o) => {
    const x = { ...state, ...(o || {}) };
    const { died, withdrew, rows: r0, ...keep } = o || {};
    Object.assign(state, keep);
    const rows = (x.rows || []).map((r, i) => ({ slot: r.slot !== undefined ? r.slot : i, ...r }));
    live.frame({ at: T0 + sec * 1000, match: x.match, round: x.round, side: x.side, phase: x.phase, alive: x.alive !== undefined ? x.alive : true,
      died: !!x.died, withdrew: !!x.withdrew, spike: x.spike || null, team: x.team, enemy: x.enemy, clock: x.clock || '1:30', mode: x.mode || null,
      det: x.rows === null ? null : { list: rows } });
  };
  return { live, f, kills: () => live.events().filter((e) => e.kind === 'kill' && e.out && !e.out.ignored) };
}
const me = (evs) => evs.filter((e) => e.killer === 'me').length;
const myDeaths = (evs) => evs.filter((e) => e.victim === 'me').length;

// The clock.
ok(clockLeft('1:39') === 99 && clockLeft('0:05') === 5 && clockLeft('buy') === null && clockLeft(null) === null, 'a round clock read as seconds left');

// A row on many frames is one kill; the player's needs the yellow twice.
{
  const g = play();
  g.f(10, { clock: '1:30' });
  for (let s = 0; s < 5; s++) g.f(12 + s, { rows: [ROW.myKill()] });
  const k = g.kills();
  ok(k.length === 1 && me(k) === 1, `the player's kill seen on five frames is one kill (${k.length})`);
  ok(/^First kill, 5v5$/.test(g.live.view().last.label) && g.live.view().last.up, `labelled by the engine, "${g.live.view().last.label}", a move up`);
  const h = play();
  h.f(10);
  h.f(12, { rows: [ROW.myKill()] });
  h.f(13, { rows: [ROW.mateKill(0.05)] });   // the same row, the yellow not seen again
  h.f(14, { rows: [ROW.mateKill(0.05)] });
  h.f(15, { rows: [ROW.mateKill(0.05)] });
  h.f(17, { rows: [] });
  const hk = h.kills();
  ok(hk.length === 1 && me(hk) === 0 && hk[0].killer === 'us', 'one frame of yellow is not enough: the kill is counted as a teammate\'s, never the player\'s');
  const t = play();
  t.f(10);
  for (let s = 0; s < 9; s++) t.f(12 + s * 0.2, { rows: [ROW.mateKill()] });
  ok(t.kills().length === 1 && t.kills()[0].killer === 'us' && t.live.view().last === null, 'a teammate\'s kill counts once, as theirs, and is no move of the player\'s');
}

// The feed moves up: the top row leaves, the player's moves to its place.
{
  const g = play();
  g.f(10);
  g.f(11, { rows: [ROW.mateDeath(), ROW.myKill()] });
  g.f(12, { rows: [ROW.mateDeath(), ROW.myKill()] });
  g.f(13, { rows: [{ ...ROW.myKill(), slot: 0 }] });
  g.f(14, { rows: [{ ...ROW.myKill(), slot: 0 }] });
  const k = g.kills();
  ok(k.length === 2 && me(k) === 1 && k.filter((e) => e.victim === 'us').length === 1, `a row moving up a place is the same row (${k.map((e) => e.killer + '>' + e.victim).join(', ')})`);
  // A frame that misses the top row: the one under it is not taken for it.
  const m = play();
  m.f(10);
  m.f(11, { rows: [ROW.mateDeath()] });
  m.f(12, { rows: [ROW.mateDeath()] });
  m.f(13, { rows: [{ ...ROW.myDeath(0.081), slot: 1 }] });
  m.f(13.2, { rows: [{ ...ROW.myDeath(0.081), slot: 1 }] });
  ok(myDeaths(m.kills()) === 1, 'a frame that missed the top row: the player\'s death under it is still the player\'s (Split round 6)');
  // A row first seen more than a row's life ago has left: one alike in its place is new.
  const n = play();
  n.f(10);
  n.f(11, { rows: [ROW.myKill(0.05)] });
  n.f(12, { rows: [ROW.myKill(0.05)] });
  n.f(18, { rows: [ROW.myKill(0.052)] });
  n.f(19, { rows: [ROW.myKill(0.052)] });
  ok(me(n.kills()) === 2, 'two kills alike, seven seconds apart, are two kills');
}

// The player dead: the yellow is the spectated teammate's.
{
  const g = play();
  g.f(10);
  g.f(11, { rows: [ROW.myDeath()] });
  g.f(12, { rows: [ROW.myDeath()], alive: false, phase: 'dead' });
  for (let s = 0; s < 3; s++) g.f(14 + s, { rows: [ROW.myDeath(), ROW.spectatedKill()], alive: false, phase: 'dead' });
  g.f(18, { rows: [ROW.myDeath(0.09)], alive: false, phase: 'dead' });   // the spectated teammate dies: yellow at the victim's end
  g.f(19, { rows: [ROW.myDeath(0.09)], alive: false, phase: 'dead' });
  g.f(21, { rows: [], alive: false, phase: 'dead' });
  const k = g.kills();
  ok(myDeaths(k) === 1 && me(k) === 0 && k.filter((e) => e.killer === 'us').length === 1 && k.filter((e) => e.victim === 'us').length === 1,
    `dead, the highlighted kill is the teammate's and the second highlighted death too (${k.map((e) => e.killer + '>' + e.victim).join(', ')})`);
  ok(/^Died first, 5v5/.test(k.find((e) => e.victim === 'me').out.label), 'the player\'s own death, labelled by the engine');
}

// Rounds: the score closes them, late rows are no kills, a missed round.
{
  const g = play();
  g.f(10);
  g.f(12, { rows: [ROW.myKill()] });
  g.f(13, { rows: [ROW.myKill()] });
  g.f(20, { team: 1, enemy: 0, rows: [] });              // round 1 won
  g.f(24, { rows: [] });                                  // 2.5 s later: closed
  const ends = g.live.events().filter((e) => e.kind === 'end' && !e.out.ignored);
  ok(ends.length === 1 && ends[0].round === 1 && ends[0].won === true, 'the score moving closes the round, won');
  g.f(30, { round: 2, phase: 'buy', clock: '0:25', rows: [{ ...ROW.mateKill(0.11) }] });   // a row seen in the next buy phase
  g.f(31, { round: 2, phase: 'buy', clock: '0:24', rows: [{ ...ROW.mateKill(0.11) }] });
  g.f(60, { round: 2, phase: 'active', clock: '1:39', rows: [] });
  ok(!g.kills().some((e) => e.round === 2), 'a row first seen after the round closed is no kill of the next');
  g.f(70, { round: 2, team: 1, enemy: 0, rows: [ROW.myKill(0.06)] });
  g.f(71, { round: 2, rows: [ROW.myKill(0.06)] });
  // Reads missed: the score jumps from 1 : 0 to 3 : 0.
  g.f(120, { round: 4, team: 3, enemy: 0, phase: 'buy', clock: '0:20', rows: [] });
  g.f(150, { round: 4, phase: 'active', clock: '1:38', rows: [] });
  const e2 = g.live.events().filter((e) => e.kind === 'end' && !e.out.ignored).map((e) => `${e.round}:${e.won}`);
  ok(e2.join() === '1:true,2:true,3:true', `a jump of two rounds closes both, each won since both went one way (${e2.join()})`);
  ok(g.live.snapshot().rounds === 3, 'three rounds counted, none twice');
  // An older round's frame after a newer opened: nothing reopens.
  g.f(151, { round: 3, phase: 'active', clock: '1:37', rows: [] });
  ok(!g.live.events().some((e) => e.kind === 'round' && e.round === 3 && e.at > T0 + 150500), 'a read filed under an older round opens nothing');
  // A score read back lower in the same match: never a result.
  g.f(152, { round: 4, team: 2, enemy: 0, rows: [] });
  g.f(160, { round: 4, team: 3, enemy: 0, rows: [] });
  ok(g.live.events().filter((e) => e.kind === 'end' && !e.out.ignored).length === 3, 'a score misread lower, then right again, ends nothing');
  // Both sides scored between two reads: the order is not known.
  const b = play();
  b.f(10);
  b.f(20, { team: 1, enemy: 1, round: 3, phase: 'buy', clock: '0:20' });
  b.f(50, { round: 3, phase: 'active', clock: '1:39' });
  const e3 = b.live.events().filter((e) => e.kind === 'end' && !e.out.ignored).map((e) => `${e.round}:${e.won}`);
  ok(e3.join() === '1:null,2:null', `one round each between two reads: both closed with no result (${e3.join()})`);
  // Every pushed event carries an id, and no id twice.
  const ids = g.live.events().map((e) => e.id);
  ok(ids.every(Boolean) && new Set(ids).size === ids.length, 'every event has its own id');
}

// Another match id is another match, whatever its first score reads (the
// service keeps one rating a match id, so a resume goes back to its own:
// test-live-rating-wiring.js).
{
  for (const [what, first] of [['the last match\'s stale score', { team: 1, enemy: 0, round: 2 }], ['no score at all', { team: null, enemy: null, round: null }]]) {
    const g = play();
    g.f(10);
    g.f(12, { rows: [ROW.myKill()] });
    g.f(13, { rows: [ROW.myKill()] });
    g.f(20, { team: 1, enemy: 0 });
    g.f(25, { team: 1, enemy: 0 });
    ok(g.live.value() > 6, 'the first match is rated');
    g.f(4000, { match: T0 + 9, phase: 'buy', clock: '0:40', ...first });
    ok(g.live.value() === 6 && g.live.view().last === null, `a new match id whose first read carries ${what} starts at 6.0 with nothing of the last`);
    g.f(4001, { match: T0 + 9, round: 1, team: 0, enemy: 0, phase: 'active', clock: '1:39' });
    g.f(4010, { match: T0 + 9, round: 1, rows: [ROW.myDeath()] });
    g.f(4010.2, { match: T0 + 9, round: 1, rows: [ROW.myDeath()] });
    const d = g.live.events().filter((e) => e.kind === 'kill' && e.victim === 'me' && !e.out.ignored);
    ok(d.length === 1 && d[0].round === 1, `and its first death is filed under its own round 1 (${d.map((e) => e.round).join()})`);
  }
}

// Round 3's guards: two frames for a death, the spectating window, the caps,
// a flood of rows, a counted row never taking a yellow one, the feed unread.
{
  const one = play();
  one.f(10);
  one.f(11, { rows: [ROW.myDeath()] });
  one.f(11.2, { rows: [ROW.mateDeath(0.06)] });
  for (let s = 0; s < 10; s++) one.f(11.4 + s * 0.2, { rows: [ROW.mateDeath(0.06)] });
  ok(myDeaths(one.kills()) === 0, 'one frame of yellow at the victim\'s end is no death of the player\'s');
  const spec = play();
  spec.f(10);
  spec.f(11, { rows: [ROW.mateDeath()] });
  for (let s = 1; s <= 5; s++) spec.f(11 + s * 0.2, { rows: [ROW.mateDeath(), ROW.myKill()] });
  spec.f(20, { rows: [] });
  ok(me(spec.kills()) === 0, 'a yellow kill row coming within 1.5 s of a teammate\'s death row is not the player\'s (the death may have been missed)');
  const trade = play();
  trade.f(10);
  for (let s = 0; s < 5; s++) trade.f(11 + s * 0.2, { rows: [ROW.myKill(), ROW.mateDeath()] });
  trade.f(20, { rows: [] });
  ok(me(trade.kills()) === 1, 'a kill already on the feed above a teammate\'s death row still counts (a trade)');
  const buy = play();
  buy.f(10, { phase: 'buy' });
  for (let s = 0; s < 5; s++) buy.f(11 + s * 0.2, { rows: [ROW.myKill()], phase: 'buy' });
  buy.f(20, { rows: [] });
  ok(me(buy.kills()) === 0, 'outside the live round no yellow kill is the player\'s');
  const cap = play();
  cap.f(10);
  for (let k = 0; k < 7; k++) { const t = 11 + k * 7; for (let s = 0; s < 9; s++) cap.f(t + s * 0.2, { rows: [ROW.mateKill(0.03 + k * 0.02)] }); cap.f(t + 5.5, { rows: [] }); }
  ok(cap.kills().filter((e) => e.victim === 'them').length === 5, `a side loses five players a round at most (${cap.kills().filter((e) => e.victim === 'them').length})`);
  // Round 4: three rows new on one frame are real once they stay (a Raze
  // ult, the feed read again after a stall); colours crossing do not stay.
  const raze = play();
  raze.f(10);
  for (let s = 0; s <= 10; s++) raze.f(11 + s * 0.2, { rows: [ROW.myKill(0.03), { ...ROW.myKill(0.06), sig: sig(0.06, 110) }, { ...ROW.myKill(0.09), sig: sig(0.09, 190) }] });
  raze.f(20, { rows: [] });
  ok(me(raze.kills()) === 3, `three of the player's kills new on one frame (a Raze ult) are three kills once they stay a second (${me(raze.kills())})`);
  const flicker = play();
  flicker.f(10);
  flicker.f(11, { rows: [ROW.mateKill(0.03), ROW.mateDeath(0.05), ROW.mateKill(0.09)] });
  flicker.f(11.2, { rows: [{ ...ROW.mateKill(0.06), sig: sig(0.06, 250) }, { ...ROW.mateDeath(0.09), sig: sig(0.09, 0) }, ROW.mateKill(0.03)] });
  flicker.f(11.4, { rows: [] });
  for (let s = 0; s < 10; s++) flicker.f(11.6 + s * 0.2, { rows: [] });
  ok(flicker.kills().length === 0, 'three rows new on one frame that flicker and wander, colours crossing the corner, count nothing');
  const stall = play();
  stall.f(10);
  stall.f(11, { rows: [ROW.mateDeath()] }); stall.f(11.2, { rows: [ROW.mateDeath()] });
  for (let s = 0; s < 15; s++) stall.f(12.4 + s * 0.2, { rows: [ROW.mateDeath(), ROW.myKill(0.05), ROW.mateKill(0.06), { ...ROW.mateDeath(0.065), sig: sig(0.065, 70) }] });
  stall.f(20, { rows: [] });
  const sk = stall.kills().map((e) => `${e.killer}>${e.victim}`);
  ok(sk.join() === 'them>us,me>them,us>them,them>us', `the recorder stalls a second, then three rows at once: each counted once, the row from before not again (${sk.join()})`);
  const blip = play();
  blip.f(10);
  blip.f(11, { rows: [ROW.mateKill(0.05)] });
  for (let s = 1; s < 10; s++) blip.f(11 + s * 0.2, { rows: [] });
  ok(blip.kills().length === 0, 'a row seen on one frame only and gone is noise, no kill');
  const seven = play();
  seven.f(10);
  for (let s = 0; s <= 35; s++) seven.f(11 + s * 0.2, { rows: [ROW.myKill(0.05)] });
  seven.f(20, { rows: [] });
  ok(me(seven.kills()) === 1, 'a row on screen seven seconds is one kill (rows live by when last seen)');
  // A counted row is never refused on yellow alone (the round 3 rule did,
  // and counted kills twice): a noise yellow frame, the spectated teammate's
  // highlight, three teammate kills that never fill the cap.
  const noise = play();
  noise.f(10);
  for (let s = 0; s < 13; s++) noise.f(11 + s * 0.2, { rows: [ROW.mateKill(0.05)] });
  noise.f(13.6, { rows: [{ ...ROW.mateKill(0.05), mine: 'kill' }] });
  for (let s = 0; s < 8; s++) noise.f(13.8 + s * 0.2, { rows: [ROW.mateKill(0.05)] });
  noise.f(20, { rows: [] });
  ok(noise.kills().length === 1 && me(noise.kills()) === 0, `one noise yellow frame on a counted teammate's row counts nothing again (${noise.kills().length})`);
  const watch = play();
  watch.f(10);
  for (let s = 0; s < 13; s++) watch.f(11 + s * 0.2, { rows: [ROW.mateKill(0.05), ROW.mateDeath(0.07)] });
  for (let s = 0; s < 12; s++) watch.f(13.6 + s * 0.2, { rows: [{ ...ROW.mateKill(0.05), mine: 'kill' }, ROW.mateDeath(0.07)], alive: false, phase: 'dead' });
  watch.f(20, { rows: [], alive: false, phase: 'dead' });
  ok(watch.kills().length === 2 && me(watch.kills()) === 0, `dead and spectating, a counted row turning yellow is not counted again (${watch.kills().length})`);
  const fill = play();
  fill.f(10);
  const mates = [[2, 0.05, 150, 4.6], [8, 0.06, 110, 10.6], [14, 0.045, 190, 16.6], [20, 0.08, 30, null], [22, 0.055, 220, null]];
  for (let t = 10.2; t < 35; t = Math.round((t + 0.2) * 10) / 10) {
    const vis = mates.filter(([at]) => t >= 10 + at && t < 10 + at + 5);
    fill.f(t, { rows: vis.map(([at, v, r, n], i) => ({ slot: i, killer: 'ally', victim: 'enemy', sig: sig(v, r), mine: n === null ? 'kill' : Math.abs(t - 10 - n) < 0.05 ? 'kill' : null })) });
  }
  const fk = fill.kills().map((e) => `${e.killer}>${e.victim}`);
  ok(fk.join() === 'us>them,us>them,us>them,me>them,me>them', `three teammate kills each with a noise yellow frame, then the player's two: none twice, the cap not filled (${fk.join()})`);
  const blind = play();
  blind.f(10);
  blind.f(20, { team: 1, enemy: 0, rows: [] }); blind.f(24, { rows: [] });
  blind.f(30, { round: 2, rows: [] }); blind.f(60, { round: 2, team: 1, enemy: 1, rows: [] }); blind.f(64, { round: 2, rows: [] });
  blind.f(70, { round: 3, rows: [] });
  ok(blind.live.reading() === false, 'two rounds closed with no kill feed row seen: not reading the feed');
  blind.f(80, { round: 3, rows: [ROW.mateKill()] });
  ok(blind.live.reading() === true, 'a row seen again: reading');
}

// A death a guard took back never reaches the rating.
{
  const on = play({ engineDeaths: true });
  on.f(10);
  on.f(11, { died: true, alive: false });
  on.f(12, { withdrew: true, alive: true });
  on.f(20, { team: 0, enemy: 1 });
  on.f(24, {});
  ok(myDeaths(on.kills()) === 0, 'the engine\'s death on trial, taken back by the next read, is no death');
  const stood = play({ engineDeaths: true });
  stood.f(10);
  stood.f(11, { died: true, alive: false });
  stood.f(12, { alive: false, phase: 'dead' });
  stood.f(20, { team: 0, enemy: 1 });
  stood.f(24, {});
  ok(myDeaths(stood.kills()) === 1, 'with engineDeaths on, one that stood counts at the round\'s end');
  const off = play();
  off.f(10);
  off.f(11, { died: true, alive: false });
  off.f(12, { alive: false, phase: 'dead' });
  off.f(20, { team: 0, enemy: 1 });
  off.f(24, {});
  ok(myDeaths(off.kills()) === 0, 'by default the engine\'s registration alone counts nothing: only the row Valorant draws does');
}

// The view: only what a window may show.
{
  const g = play();
  g.f(10);
  g.f(12, { rows: [ROW.myKill()] });
  g.f(13, { rows: [ROW.myKill()] });
  const v = g.live.view();
  ok(Object.keys(v).sort().join() === 'last,line,shown,tier,value' && Object.keys(v.last).sort().join() === 'delta,down,label,up',
    `the view is the value, its tier, the last move and its label, and the line (${Object.keys(v).join(', ')})`);
  ok(v.shown === v.value.toFixed(1) && v.line[0] === 6 && v.line[v.line.length - 1] === v.value && /^\+\d\.\d$/.test(v.last.delta), `"${v.shown}", ${v.last.delta}, the line from 6.0 (${v.line.join(' ')})`);
  const s = JSON.stringify(v);
  ok(!/hp|credit|spot|enemy|alive|spike|map|agent/i.test(s.replace(/"label":"[^"]*"/, '')), 'nothing of the reader\'s context is in it');
  // Swiftplay: the shorter match's length rule.
  const sp = play();
  sp.f(5, { mode: 'swiftplay' });
  sp.f(10, { mode: 'swiftplay' });
  sp.f(12, { rows: [ROW.myKill()], mode: 'swiftplay' });
  sp.f(13, { rows: [ROW.myKill()], mode: 'swiftplay' });
  ok(sp.live.value() > v.value, `a Swiftplay kill moves the number more (${sp.live.value()} against ${v.value})`);
  // A read handed over late (a death on trial is logged a read later) is older: skipped.
  const late = play();
  late.f(10);
  late.f(12, { rows: [ROW.mateKill()] });
  late.f(11, { rows: [ROW.myKill(0.03)] });
  late.f(13, { rows: [ROW.mateKill()] });
  late.f(20, { rows: [] });
  ok(late.kills().length === 1 && me(late.kills()) === 0, 'a read older than one already applied changes nothing');
  // No detector this frame (switched on mid frame, a frame not read): nothing invented.
  const none = play();
  none.f(10, { rows: null });
  none.f(11, { rows: null });
  ok(none.kills().length === 0 && none.live.view().last === null, 'frames with no feed read count nothing');
}

// The whole path: drawn pixels, the detector, the feed.
{
  const live = createLiveRating({});
  const frame = (sec, rows, o) => {
    const fr = drawFrame({ W: 1280, H: 720, rows });
    const det = kf.detect(cut(fr, kf.regionOf(1280, 720)), 720);
    live.frame({ at: T0 + sec * 1000, match: T0, round: 1, side: 'defending', phase: 'active', alive: true, team: 0, enemy: 0, clock: '1:20', det, ...(o || {}) });
  };
  frame(10, []);
  frame(11, [{ slot: 0, killer: 'enemy', victim: 'ally', vlen: 0.08 }]);
  frame(12, [{ slot: 0, killer: 'enemy', victim: 'ally', vlen: 0.08 }, { slot: 1, killer: 'ally', victim: 'enemy', mine: 'kill', vlen: 0.06 }]);
  frame(13, [{ slot: 0, killer: 'enemy', victim: 'ally', vlen: 0.08 }, { slot: 1, killer: 'ally', victim: 'enemy', mine: 'kill', vlen: 0.06 }]);
  frame(14, [{ slot: 0, killer: 'ally', victim: 'enemy', mine: 'kill', vlen: 0.06 }]);
  frame(15, [{ slot: 0, killer: 'ally', victim: 'enemy', mine: 'kill', vlen: 0.06 }]);
  const k = live.events().filter((e) => e.kind === 'kill' && !e.out.ignored).map((e) => `${e.killer}>${e.victim}`);
  ok(k.join() === 'them>us,me>them', `drawn frames through the detector: a teammate down, then the player's kill, each once (${k.join()})`);
  ok(/^Kill, 4v5$/.test(live.view().last.label), `"${live.view().last.label}": the numbers standing from the feed, a teammate down before it`);
}

console.log(`\n${fails ? fails + ' of ' + checks + ' failed' : 'all ' + checks + ' live rating checks passed'}`);
process.exit(fails ? 1 : 0);

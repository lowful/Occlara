'use strict';

/**
 * THE TRAINER'S NUMBERS (docs/claude/trainer.md): every row of the accuracy
 * spec held against src/shared/trainer-data.json through trainer-math.js
 * numbers(), the data file's own shape, the scenarios file, and main's half
 * (services/trainer-store.js) on a fake store. Offline, plain Node.
 *
 * The expected values are worked out here from the data file, never copied
 * out of trainer-math.js, so a change to the maths that drifts from the data
 * fails here.
 *
 * The last lines print the data file's unverified values (unverified()), for
 * the owner to check in the game. That list is information, not a failure.
 *
 * Run: npm run test:trainerphysics
 */

const fs = require('fs');
const path = require('path');
const T = require('../src/shared/trainer-math');
const { createTrainer } = require('../src/main/services/trainer-store');

const ROOT = path.join(__dirname, '..');
const DATA_FILE = path.join(ROOT, 'src', 'shared', 'trainer-data.json');
const SCEN_FILE = path.join(ROOT, 'src', 'shared', 'trainer-scenarios.json');
const DRILL_FILE = path.join(ROOT, 'src', 'shared', 'drill-library.json');
const RAW = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
const SCEN = JSON.parse(fs.readFileSync(SCEN_FILE, 'utf8'));
const n = T.numbers(RAW);

let failed = 0;
let passed = 0;
function ok(cond, what) {
  if (cond) { passed += 1; return; }
  failed += 1;
  console.log(`  FAIL ${what}`);
}
const near = (a, b, eps) => typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) <= (eps == null ? 1e-9 : eps);
const TICK = 1 / n.tick;
const WEAPONS = Object.keys(n.weapons);

// ── Sensitivity ─────────────────────────────────────────────────────────────
ok(n.sens.yawPerCount === 0.07, 'yaw is 0.07 degrees a count in the data');
ok(n.sens.pitchPerCount === n.sens.yawPerCount, 'pitch turns the same as yaw a count');
for (const s of [0.1, 0.25, 0.4, 0.5, 1, 2.5, 10]) {
  ok(near(T.degPerCount(n, s), 0.07 * s, 1e-12), `degrees per count at sens ${s} is 0.07 x sens`);
  ok(near(360 / T.degPerCount(n, s), 360 / (0.07 * s), 1e-6), `a full turn at sens ${s} takes 360 / (0.07 x sens) counts`);
  ok(near(T.degPerCount(n, s, null), 0.07 * s, 1e-12) && near(T.degPerCount(n, s, { zoom: 1, multiplier: 0.5 }), 0.07 * s, 1e-12), `unscoped (no zoom, zoom 1) at sens ${s} ignores the multiplier`);
}
for (const [dpi, sens] of [[400, 0.5], [800, 0.4], [800, 0.3], [1600, 0.2], [3200, 0.1], [1200, 0.35]]) {
  ok(near(T.cm360(n, dpi, sens), 914.4 / (dpi * sens * 0.07), 1e-6), `cm360 at ${dpi} dpi and sens ${sens} is 914.4 / (dpi x sens x 0.07)`);
}
ok(T.cm360(n, 0, 0.4) === null && T.cm360(n, 800, 0) === null, 'cm360 of no dpi or no sens is null');

// ── The field of view ───────────────────────────────────────────────────────
ok(n.fov.horizontal === 103, 'the data holds 103 degrees across');
ok(T.verticalFov(n, 16 / 9).toFixed(2) === '70.53', '103 across at 16:9 is 70.53 up and down');
ok(T.verticalFov(n, 16 / 9).toFixed(2) === n.fov.vertical.toFixed(2), 'the vertical FOV matches the data file');
ok(T.horizontalFov(n, 16 / 9).toFixed(2) === '103.00', '16:9 is 103 across');
ok(T.horizontalFov(n, 4 / 3).toFixed(2) === '86.63', 'at 4:3 the horizontal is 86.63');
ok(T.horizontalFov(n, 16 / 10).toFixed(2) === '97.06', 'at 16:10 the horizontal is 97.06 (the data note)');
ok(T.verticalFov(n, 4 / 3).toFixed(2) === '70.53', 'a narrower screen keeps 70.53 up and down');
for (const a of [21 / 9, 32 / 9, 2.0]) ok(T.horizontalFov(n, a).toFixed(2) === '103.00', `wider than 16:9 (${a.toFixed(3)}) stays 103 across`);
ok(near(T.zoomedFov(n, 16 / 9, 1), T.verticalFov(n, 16 / 9), 1e-12) && T.zoomedFov(n, 16 / 9, 2) < T.verticalFov(n, 16 / 9), 'zoomedFov leaves zoom 1 alone and narrows a zoom');
{
  // Linear in the 16:9 horizontal view (data: sens.scopedRule's note): 103 / zoom across.
  const across = (v, a) => 2 * Math.atan(Math.tan(v * Math.PI / 360) * a) * 180 / Math.PI;
  for (const [z, want] of [[1.25, 82.4], [2.5, 41.2], [3.5, 29.43], [5, 20.6]]) {
    ok(near(across(T.zoomedFov(n, 16 / 9, z), 16 / 9), want, 0.01), `zoomed ${z}x shows ${want} degrees across at 16:9 (got ${across(T.zoomedFov(n, 16 / 9, z), 16 / 9).toFixed(3)})`);
    ok(near(across(T.zoomedFov(n, 21 / 9, z), 21 / 9), 103 / z, 1e-9), `zoomed ${z}x on a wider screen still shows 103 / zoom across`);
    ok(near(T.zoomedFov(n, 4 / 3, z), T.zoomedFov(n, 16 / 9, z), 1e-9), `zoomed ${z}x on a narrower screen keeps the 16:9 height`);
  }
  ok(T.zoomedFov(n, 16 / 9, 1.25).toFixed(1) === '52.4', 'rifles aimed at 1.25x are 52.4 degrees up and down at 16:9');
}
ok(n.sens.pitchMax === 89.9, 'the view pitches up and down to 89.9 degrees (Unreal Engine 4 default)');

// ── Scoped ─────────────────────────────────────────────────────────────────
ok(n.sens.scopedRule === 'zoom', 'the data says scoped turning divides by the zoom');
for (const z of [1.25, 2.5, 3.5, 5]) {
  for (const m of [1, 0.8, 1.5]) {
    for (const s of [0.3, 0.5]) {
      ok(near(T.degPerCount(n, s, { zoom: z, multiplier: m }), 0.07 * s * m / z, 1e-12), `scoped at sens ${s}, zoom ${z}, multiplier ${m} is 0.07 x sens x m / z`);
    }
  }
}

// ── Run speeds ──────────────────────────────────────────────────────────────
for (const id of WEAPONS) {
  const w = n.weapons[id];
  const run = RAW.weapons[id].runSpeed.value;
  ok(T.topSpeed(n, w, 'run') === run, `${id} runs at the data's ${run} m/s`);
  ok(near(T.topSpeed(n, w, 'walk'), run * n.move.walkMult, 1e-12), `${id} walks at run x walkMult`);
  ok(near(T.topSpeed(n, w, 'crouch'), run * n.move.crouchMult, 1e-12), `${id} crouches at run x crouchMult`);
  ok(near(T.topSpeed(n, w, 'run', true), run * w.adsMoveMult, 1e-12), `${id} aimed down sights runs at run x adsMoveMult (${w.adsMoveMult})`);
  ok(near(T.topSpeed(n, w, 'walk', true), run * w.adsMoveMult * n.move.walkMult, 1e-12), `${id} aimed and walking multiplies both`);
}
ok(T.topSpeed(n, null, 'run') === n.move.knifeSpeed, 'with no gun (the knife) the top speed is the knife speed');
ok(n.move.knifeSpeed === 6.75, 'the knife runs at 6.75 m/s in the data');

// ── The speed curve ─────────────────────────────────────────────────────────
const rifle = n.weapons['heavy-rifle'];
const rifleRun = T.topSpeed(n, rifle, 'run');
const knife = n.move.knifeSpeed;
for (const [what, top] of [['the rifle', rifleRun], ['the knife', knife]]) {
  const t = T.timeToSpeed(n, top, 1);
  ok(t != null && Math.abs(t - n.move.accelTime) <= TICK + 1e-9, `${what} reaches its top speed within one tick of accelTime (${t} s against ${n.move.accelTime})`);
}
{
  // Riot_Classick's 2020 Phantom table (move.brakingDecel): from a run, 61%
  // of the run speed in 0.055 s, 25% in 0.104 s, a full stop in 0.160 s.
  // Braking scales with the top speed, so every weapon, the knife and aimed
  // stop in the same time.
  const RIOT = [[0.61, 0.055, 0.010], [0.25, 0.104, 0.005], [0, 0.160, 0.008]];
  const tops = [['the rifle', rifleRun], ['the knife', knife], ['the rifle aimed', T.topSpeed(n, rifle, 'run', true)], ['the light pistol', T.topSpeed(n, n.weapons.sidearm, 'run')]];
  for (const [what, top] of tops) {
    for (const [frac, want, eps] of RIOT) {
      const t = T.timeToStop(n, top, true, frac * top);
      ok(t != null && Math.abs(t - want) <= eps, `${what}: a counter-strafe from a run reaches ${frac * 100}% in about ${want} s, Riot's table (got ${t})`);
    }
  }
  const r = T.timeToStop(n, rifleRun, false, 0);
  const k = T.timeToStop(n, knife, false, 0);
  ok(near(r, k, 1e-9), `the rifle and the knife stop in the same time (${r} and ${k} s)`);
  ok(k != null && Math.abs(k - 0.145) <= 0.015, `the knife's stop is within 15 ms of the 2022 study's 0.145 s (got ${k})`);
  ok(near(T.brakeFlat(n.move, n.move.knifeSpeed), n.move.brakingDecel, 1e-12) && near(T.brakeFlat(n.move, rifleRun), n.move.brakingDecel * rifleRun / n.move.knifeSpeed, 1e-12), 'the flat braking is the data\'s at the knife speed and scales with the top');
}
for (const [what, top] of [['the rifle', rifleRun], ['the knife', knife], ['the light pistol', T.topSpeed(n, n.weapons.sidearm, 'run')]]) {
  for (const under of [undefined, 0, 1]) {
    const release = T.timeToStop(n, top, false, under);
    const counter = T.timeToStop(n, top, true, under);
    const lbl = under === undefined ? 'the accuracy gate' : `${under} m/s`;
    ok(counter != null && release != null && counter <= release + 1e-9, `${what}: a counter-strafe to ${lbl} is never slower than letting go`);
    ok(counter != null && release != null && release - counter <= TICK + 1e-9, `${what}: a counter-strafe to ${lbl} is never faster by more than one tick`);
  }
}
{
  // Ground steps: a stop with no input ends at rest, never reversed.
  const v = { x: rifleRun, z: 0 };
  for (let i = 0; i < n.tick; i++) T.stepGround(v, { x: 0, z: 0 }, rifleRun, n.move, TICK);
  ok(v.x === 0 && v.z === 0, 'letting go for a second ends at rest');
  const u = { x: 0, z: 0 };
  for (let i = 0; i < n.tick; i++) T.stepGround(u, { x: 1, z: 0 }, rifleRun, n.move, TICK);
  ok(near(Math.hypot(u.x, u.z), rifleRun, 1e-9), 'a second of input holds the top speed and no more');
}
{
  // The braking is scaled by the weapon's run top (brakeTop), never by the
  // cap of the moment: letting go from a run with walk or crouch held, or
  // tagged, stops no slower than letting go with nothing held (engine.js
  // passes the run top, bots.js the untagged one).
  const stopFrom = (cap, brakeTop, under) => {
    const v = { x: rifleRun, z: 0 };
    for (let i = 0, t = 0; i < 5 * n.tick; i++, t += TICK) {
      if (Math.hypot(v.x, v.z) <= under + 1e-9) return t;
      T.stepGround(v, { x: 0, z: 0 }, cap, n.move, TICK, brakeTop);
    }
    return null;
  };
  const free = stopFrom(rifleRun, rifleRun, 0);
  ok(free != null && Math.abs(free - 0.156) <= TICK + 1e-9, `letting go from a run stops in about 0.156 s (got ${free})`);
  const gate = rifleRun * n.move.accurateFrac;
  const freeGate = stopFrom(rifleRun, rifleRun, gate);
  const caps = [
    ['walk held', T.topSpeed(n, rifle, 'walk')],
    ['crouch held', T.topSpeed(n, rifle, 'crouch')],
    ['tagged', T.taggedTop(n, rifleRun, 0, 1)],
  ];
  for (const [what, cap] of caps) {
    const s = stopFrom(cap, rifleRun, 0), g = stopFrom(cap, rifleRun, gate);
    ok(near(s, free, 1e-9), `${what}: letting go from a run stops in the same ${free.toFixed(3)} s (got ${s})`);
    ok(near(g, freeGate, 1e-9), `${what}: and reaches the accuracy gate in the same ${freeGate.toFixed(3)} s (got ${g})`);
  }
  // Walk held reaches the dead zone in about Riot_Classick's walk-held 0.110 s.
  ok(Math.abs(freeGate - 0.110) <= 0.012, `the gate is reached in about Riot_Classick's walk-held 0.110 s (got ${freeGate})`);
  // Without a brakeTop, the cap is the brake reference (timeToStop's case).
  const a = { x: 3, z: 0 }, b = { x: 3, z: 0 };
  T.stepGround(a, { x: 0, z: 0 }, rifleRun, n.move, TICK);
  T.stepGround(b, { x: 0, z: 0 }, rifleRun, n.move, TICK, rifleRun);
  ok(a.x === b.x, 'with no brakeTop the braking is scaled by the top passed');
  // A bot hit at full speed falls to its tagged top as fast as letting go
  // would bring it there, not more slowly.
  const tagTop = T.taggedTop(n, rifleRun, 0, 1);
  const pressed = { x: rifleRun, z: 0 };
  let tHeld = null;
  for (let i = 0, t = 0; i < n.tick; i++, t += TICK) {
    if (Math.hypot(pressed.x, pressed.z) <= tagTop + 1e-9) { tHeld = t; break; }
    T.stepGround(pressed, { x: 1, z: 0 }, tagTop, n.move, TICK, rifleRun);
  }
  const tLet = stopFrom(rifleRun, rifleRun, tagTop);
  ok(tHeld != null && near(tHeld, tLet, 1e-9), `a tagged bot pressing on falls to the tagged top in ${tHeld} s, as fast as letting go (${tLet})`);
}

// ── The accuracy gate ───────────────────────────────────────────────────────
ok(n.move.accurateFrac === 0.275, 'the gate is 27.5% of the top speed in the data');
for (const id of WEAPONS) {
  const w = n.weapons[id];
  // Walking or running the gate is 27.5% of the RUN top speed (Riot_Classick
  // 2020); crouched, of the crouch top speed.
  for (const mode of ['run', 'walk', 'crouch']) {
    const top = T.topSpeed(n, w, mode === 'crouch' ? 'crouch' : 'run');
    const gate = top * 0.275;
    ok(near(T.gateSpeed(n, w, mode), gate, 1e-12), `${id} ${mode}: the gate is 27.5% of ${top.toFixed(3)} m/s`);
    ok(T.accurate(n, gate, w, mode) === true, `${id} ${mode}: accurate at exactly 27.5% of ${top.toFixed(3)} m/s`);
    ok(T.accurate(n, gate + 1e-6, w, mode) === false, `${id} ${mode}: not accurate just above 27.5%`);
    ok(T.accurate(n, 0, w, mode) === true, `${id} ${mode}: standing still is accurate`);
  }
  const runGate = T.topSpeed(n, w, 'run') * 0.275;
  ok(T.accurate(n, runGate, w, 'walk') === true, `${id}: walking, the run gate is accurate (the gate follows the run top speed, walk held or not)`);
  ok(T.accurate(n, runGate, w, 'crouch') === false, `${id}: the run gate is too fast crouched`);
  if (w.adsMoveMult < 1) ok(T.accurate(n, runGate, w, 'run', true) === false, `${id}: aimed, the gate follows the aimed top speed`);
}

// ── Spread ──────────────────────────────────────────────────────────────────
for (const id of WEAPONS) {
  const w = n.weapons[id];
  const sp = w.spread;
  const reachesMaxAt = RAW.weapons[id].spread.growth.reachesMaxAt;
  ok(T.spread(n, w, { shot: 1, speed: 0 }) === sp.first, `${id}: the first shot standing is the data's ${sp.first}`);
  ok(T.spread(n, w, {}) === sp.first, `${id}: a shot with nothing said is the first shot standing`);
  // The cone bullet by bullet: the data's curve, its last value held.
  const curve = RAW.weapons[id].spread.curve;
  ok(curve && Array.isArray(curve.value) && curve.value.length >= 2, `${id}: the data gives the cone bullet by bullet`);
  if (curve) {
    ok(curve.value[0] === sp.first && curve.value[curve.value.length - 1] === sp.max, `${id}: the curve starts at the published first shot ${sp.first} and ends at the published max ${sp.max}`);
    let rising = true;
    for (let i = 1; i < curve.value.length; i++) if (!(curve.value[i] > curve.value[i - 1])) rising = false;
    ok(rising, `${id}: the curve only opens`);
    for (let k = 1; k <= 40; k++) {
      const s = T.spread(n, w, { shot: k });
      const want = curve.value[Math.min(k - 1, curve.value.length - 1)];
      if (!near(s, want, 1e-12)) { ok(false, `${id}: shot ${k} of a spray is the curve's ${want} (got ${s})`); break; }
      if (k === 40) ok(true, `${id}: the spray follows the curve and holds its last value`);
    }
  }
  // With no curve, the linear growth is the fallback.
  const lin = { ...w, spread: { ...sp, curve: undefined } };
  for (let k = 1; k <= 40; k++) {
    const s = T.spread(n, lin, { shot: k });
    const want = Math.min(sp.max, sp.first + sp.growth * (k - 1));
    if (!near(s, want, 1e-9)) { ok(false, `${id}: with no curve, shot ${k} of a spray is ${want} (got ${s})`); break; }
    if (s > sp.max) { ok(false, `${id}: with no curve, shot ${k} grows past the max ${sp.max}`); break; }
    if (k === 40) ok(true, `${id}: with no curve the spray grows by its growth a bullet`);
  }
  if (Number.isInteger(reachesMaxAt)) {
    ok(near(T.spread(n, lin, { shot: reachesMaxAt }), sp.max, 1e-9), `${id}: with no curve the cone reaches the max at bullet ${reachesMaxAt}, as the data note says`);
    ok(T.spread(n, lin, { shot: reachesMaxAt - 1 }) < sp.max - 1e-9, `${id}: and not before bullet ${reachesMaxAt}`);
  }
  ok(T.spread(n, w, { shot: 40 }) === sp.max, `${id}: a long spray is exactly the max ${sp.max}, no further`);
  ok(near(T.spread(n, w, { shot: 1, crouch: true }), sp.first * sp.crouchMult, 1e-12), `${id}: crouched the first shot is smaller by crouchMult`);
  ok(near(T.spread(n, w, { shot: 40, crouch: true }), sp.max * sp.crouchMult, 1e-12), `${id}: crouched the max is smaller by crouchMult`);
  if (curve) ok(near(T.spread(n, w, { shot: 3, crouch: true }), curve.value[Math.min(2, curve.value.length - 1)] * sp.crouchMult, 1e-12), `${id}: crouched, the curve is smaller by crouchMult`);
  const run = T.topSpeed(n, w, 'run');
  const walk = T.topSpeed(n, w, 'walk');
  const crouch = T.topSpeed(n, w, 'crouch');
  const gate = run * n.move.accurateFrac;
  ok(near(T.spread(n, w, { shot: 1, speed: run }), sp.first + sp.run, 1e-9), `${id}: at full run speed the running error is added`);
  ok(near(T.spread(n, w, { shot: 1, speed: walk, walk: true }), sp.first + sp.walk, 1e-9), `${id}: at walk speed with walk held the walking error is added`);
  // Walking and running errors are states, not ramps.
  for (const walkHeld of [false, true]) {
    const lbl = walkHeld ? 'walk held' : 'walk not held';
    ok(near(T.spread(n, w, { shot: 1, speed: gate + 0.01, walk: walkHeld }), sp.first + sp.walk, 1e-9), `${id}, ${lbl}: just over the gate the full walking error is added`);
    ok(near(T.spread(n, w, { shot: 1, speed: (gate + walk) / 2, walk: walkHeld }), sp.first + sp.walk, 1e-9), `${id}, ${lbl}: between the gate and walk speed it is the full walking error`);
    ok(near(T.spread(n, w, { shot: 1, speed: walk + 0.01, walk: walkHeld }), sp.first + sp.run, 1e-9), `${id}, ${lbl}: just over walk speed the full running error is added`);
  }
  ok(near(T.spread(n, w, { shot: 1, speed: crouch, crouch: true }), sp.first * sp.crouchMult + sp.crouchMove, 1e-9), `${id}: crouch walking at its top speed adds the crouch moving error`);
  ok(near(T.spread(n, w, { shot: 1, air: true }), sp.first + sp.air, 1e-9), `${id}: in the air the airborne error is added`);
  ok(near(T.spread(n, w, { shot: 1, landing: n.move.landingSec / 2 }), sp.first + n.move.landingSpread, 1e-9), `${id}: just after landing the landing error is added`);
  ok(near(T.spread(n, w, { shot: 1, landing: n.move.landingSec + 0.01 }), sp.first, 1e-9), `${id}: after the landing time the landing error is gone`);
  ok(T.spread(n, w, { shot: 1, speed: run * 0.275 }) === sp.first, `${id}: at the gate no movement error is added`);
  const ads = T.spread(n, w, { shot: 1, ads: true });
  if (sp.adsFirst != null) ok(ads === sp.adsFirst, `${id}: aimed, the first shot is the ADS value ${sp.adsFirst}`);
  else ok(ads === sp.first, `${id}: with no ADS value, aimed is the hip first shot`);
  if (sp.adsMax != null) {
    ok(near(T.spread(n, w, { shot: 40, ads: true }), sp.adsMax, 1e-12), `${id}: aimed, a long spray is the published aimed max ${sp.adsMax}`);
    ok(near(T.spread(n, w, { shot: 40, ads: true, crouch: true }), sp.adsMax * sp.crouchMult, 1e-12), `${id}: aimed and crouched, the aimed max is smaller by crouchMult`);
    let firstMax = null, hipFirstMax = null;
    for (let k = 1; k <= 40 && (firstMax == null || hipFirstMax == null); k++) {
      if (firstMax == null && near(T.spread(n, w, { shot: k, ads: true }), sp.adsMax, 1e-12)) firstMax = k;
      if (hipFirstMax == null && near(T.spread(n, w, { shot: k }), sp.max, 1e-12)) hipFirstMax = k;
    }
    ok(firstMax != null && firstMax === hipFirstMax, `${id}: aimed, the cone reaches its max on the same bullet as the hip cone (${firstMax}, ${hipFirstMax})`);
    let between = true;
    for (let k = 1; k <= 12; k++) {
      const a = T.spread(n, w, { shot: k, ads: true });
      if (!(a >= sp.adsFirst - 1e-12 && a <= sp.adsMax + 1e-12)) between = false;
    }
    ok(between, `${id}: aimed, every bullet's cone is between the aimed first ${sp.adsFirst} and max ${sp.adsMax}`);
  }
}
ok(near(n.weapons['heavy-rifle'].spread.adsMax, 1.02, 1e-12) && near(n.weapons['silenced-rifle'].spread.adsMax, 0.91, 1e-12), 'the rifles\' aimed maxima are the wiki\'s 1.02 and 0.91');
{
  const v = n.weapons['heavy-rifle'];
  ok(near(T.spread(n, v, { shot: 4 }), 0.567, 1e-12) && near(T.spread(n, v, { shot: 6 }), 1, 1e-12) && T.spread(n, v, { shot: 5 }) < 1, 'the heavy rifle\'s cone is 0.567 at bullet 4 and reaches its max at bullet 6');
}

// ── Where a shot lands inside its cone (error power) ────────────────────────
ok(n.errorPower.steady === 0.75 && n.errorPower.moving === 0.52, 'the data biases steady shots to the middle (0.75) and moving ones near even (0.52)');
for (const id of WEAPONS) {
  const w = n.weapons[id];
  const walk = T.topSpeed(n, w, 'walk');
  ok(T.errorPower(n, w, { speed: 0 }) === n.errorPower.steady, `${id}: standing, the steady exponent`);
  ok(T.errorPower(n, w, { speed: walk, walk: true }) === n.errorPower.steady, `${id}: walking at walk speed, the steady exponent`);
  ok(T.errorPower(n, w, { speed: T.topSpeed(n, w, 'crouch'), crouch: true }) === n.errorPower.steady, `${id}: crouch walking, the steady exponent`);
  ok(T.errorPower(n, w, { speed: walk + 0.01 }) === n.errorPower.moving, `${id}: over walk speed, the moving exponent`);
  ok(T.errorPower(n, w, { speed: 0, air: true }) === n.errorPower.moving, `${id}: in the air, the moving exponent`);
}
{
  ok(T.coneRadius(2, 0, 0.75) === 0 && near(T.coneRadius(2, 1, 0.75), 2, 1e-12), 'a shot lands from the middle out to the cone\'s edge');
  ok(near(T.coneRadius(1, 0.25, 0.5), 0.5, 1e-12), 'the exponent 0.5 is the square root, even over the disc');
  // Steady shots land nearer the middle than moving ones, on average.
  let a = 0, b = 0;
  for (let i = 0; i < 1000; i++) { const u = (i + 0.5) / 1000; a += T.coneRadius(1, u, n.errorPower.steady); b += T.coneRadius(1, u, n.errorPower.moving); }
  ok(a / 1000 < b / 1000 && near(a / 1000, 1 / 1.75, 0.002), `steady shots land at a mean of ${(a / 1000).toFixed(3)} of the cone, moving ones at ${(b / 1000).toFixed(3)}`);
}

// ── Aimed fire rate ─────────────────────────────────────────────────────────
for (const id of WEAPONS) {
  const w = n.weapons[id];
  ok(T.fireRateOf(w, false) === w.fireRate, `${id}: from the hip it fires at the data's ${w.fireRate} a second`);
  if (w.alt === 'ads') {
    ok(w.adsFireRateMult === 0.9, `${id}: aimed it fires at 0.9 of that in the data`);
    ok(near(T.fireRateOf(w, true), w.fireRate * 0.9, 1e-12), `${id}: aimed it fires at ${(w.fireRate * 0.9).toFixed(3)} a second`);
  } else ok(T.fireRateOf(w, true) === w.fireRate, `${id}: with no aim down sights the rate never changes`);
}
ok(near(T.fireRateOf(n.weapons['heavy-rifle'], true), 8.775, 1e-9) && near(T.fireRateOf(n.weapons['silenced-rifle'], true), 9.9, 1e-9), 'aimed, the rifles fire 8.775 and 9.9 a second, valorant-api.com\'s numbers');

// ── Recoil ──────────────────────────────────────────────────────────────────
{
  const climb = (w, upTo) => { let c = 0; for (let s = 1; s < upTo; s++) c += T.recoilKick(w, s).up; return c; };
  const v = n.weapons['heavy-rifle'], p = n.weapons['silenced-rifle'], sh = n.weapons['heavy-pistol'], cl = n.weapons.sidearm;
  ok(near(climb(v, 2), 0.4, 1e-9) && near(climb(v, 3), 0.9, 1e-9) && near(climb(v, 8), 7.6, 1e-9), 'the heavy rifle\'s bullets climb 0.4, 0.9 and 7.6 degrees at bullets 2, 3 and 8');
  ok(near(climb(v, 25), 7.6, 1e-9), 'and level off at 7.6 to the end of the magazine');
  ok(near(climb(p, 2), 0.3, 1e-9) && near(climb(p, 3), 0.7, 1e-9) && near(climb(p, 8), 6.4, 1e-9) && near(climb(p, 30), 6.81, 1e-9), 'the silenced rifle\'s bullets climb 0.3, 0.7 and 6.4 degrees at bullets 2, 3 and 8, then hold about 6.8');
  ok(near(climb(sh, 2), 1, 1e-9) && near(climb(sh, 3), 2, 1e-9) && near(climb(sh, 6), 2, 1e-9), 'the heavy pistol climbs 1 degree a shot twice, then holds at 2');
  ok(near(climb(cl, 4), 1, 1e-9) && near(climb(cl, 12), 1, 1e-9), 'the light pistol climbs 1 degree over three shots, then holds');
  for (const id of WEAPONS) ok(n.weapons[id].recoil.tailMult === 0, `${id}: no climb past the pattern`);
  for (const id of ['heavy-pistol', 'sidearm']) {
    ok(n.weapons[id].recoil.horiz === 0, `${id}: no sideways recoil in the data`);
    let none = true;
    for (let s = 1; s <= 12; s++) if (T.yawDrift(n.weapons[id], s) !== 0) none = false;
    ok(none, `${id}: no sideways drift on any shot`);
  }
}

// ── The sideways drift (Riot 11.08's yaw switch) ────────────────────────────
for (const id of ['heavy-rifle', 'silenced-rifle']) {
  const w = n.weapons[id];
  const r = w.recoil;
  ok(r.yawSwitchChance === 0.1 && r.yawSwitchSec === 0.6, `${id}: switches side with a chance of 10% a bullet over 0.6 s (patch 11.08)`);
  ok(r.horizStart === (id === 'heavy-rifle' ? 6 : 8), `${id}: ${r.horizStart} protected bullets (patch 11.08)`);
  ok(T.yawDrift(w, 1) === 0, `${id}: the first bullet has no drift`);
  ok(near(T.yawDrift(w, 1 + r.horizRamp), r.horiz, 1e-12) && near(T.yawDrift(w, 30), r.horiz, 1e-12), `${id}: the drift grows to ${r.horiz} degrees at bullet ${1 + r.horizRamp} and holds`);
  ok(T.yawDrift(w, 2) > 0 && T.yawDrift(w, 2) < T.yawDrift(w, 3), `${id}: the drift begins before the protected bullets and grows`);
  // openVaim's yaw curves read raw, on the scale of the climbs: the heavy
  // rifle's reaches 2.0, the silenced rifle's 1.8 (never one of them times
  // that copy's 0.55 and the other not).
  ok(r.horiz === (id === 'heavy-rifle' ? 2 : 1.8), `${id}: the drift's full size is ${r.horiz} degrees, the copy's curve read raw`);
  // A spray: the side is picked on the first bullet and never switches
  // within the protected bullets, whatever the dice say.
  const always = () => 0;     // every roll a switch, if one is allowed
  const side = { dir: 0, from: 0, at: -Infinity };
  const rate = T.fireRateOf(w, false);
  const f1 = T.yawSide(w, side, 1, 0, always);
  ok(f1 === -1 || f1 === 1, `${id}: the first bullet picks a side`);
  let held = true;
  for (let s = 2; s <= r.horizStart; s++) if (T.yawSide(w, side, s, (s - 1) / rate, always) !== f1) held = false;
  ok(held, `${id}: the side holds through the ${r.horizStart} protected bullets`);
  const tSwitch = r.horizStart / rate;
  const f7 = T.yawSide(w, side, r.horizStart + 1, tSwitch, always);
  ok(f7 === f1 && side.dir === -f1, `${id}: past the protected bullets a switch may start, eased from where the drift was`);
  const mid = T.yawSide(w, side, r.horizStart + 2, tSwitch + r.yawSwitchSec / 2, always);
  ok(Math.abs(mid) < 1e-9, `${id}: halfway through the switch time the drift is in the middle (got ${mid})`);
  ok(side.dir === -f1, `${id}: no second switch starts while one is easing`);
  const done = T.yawSide(w, side, r.horizStart + 3, tSwitch + r.yawSwitchSec + 0.001, () => 0.99);
  ok(done === -f1, `${id}: after the switch time the drift is on the other side`);
  const never = () => 0.99;
  const s2 = { dir: 0, from: 0, at: -Infinity };
  const g1 = T.yawSide(w, s2, 1, 0, () => 0.7);
  let kept = true;
  for (let s = 2; s <= 25; s++) if (T.yawSide(w, s2, s, (s - 1) / rate, never) !== g1) kept = false;
  ok(kept, `${id}: with no switch rolled the spray stays on its side to the end`);
  const s3 = { dir: 1, from: 1, at: -Infinity };
  T.yawSide(w, s3, 1, 0, () => 0.2);
  ok(s3.dir === -1, `${id}: a new spray picks its side again`);
}

// ── Damage ──────────────────────────────────────────────────────────────────
for (const id of WEAPONS) {
  const w = n.weapons[id];
  const bands = RAW.weapons[id].damage.value;
  let from = 0;
  bands.forEach((b, i) => {
    const points = [from + 0.5, Math.min(b.to, from + 50)];
    if (b.to < 1e8) points.push(b.to);
    for (const d of points) {
      for (const zone of ['head', 'body', 'leg']) {
        ok(T.rawDamage(w, zone, d) === b[zone], `${id} band ${i + 1} at ${d} m: ${zone} is the data's ${b[zone]}`);
      }
    }
    from = b.to;
  });
}
// The absorb rule worked out here: armour takes `absorb` of each hit until it is gone.
function myShotsToKill(dmg, hp, armour) {
  let h = hp, a = armour;
  for (let i = 1; i <= 100; i++) {
    const toArmour = Math.min(a, dmg * n.armour.absorb);
    a -= toArmour;
    h -= dmg - toArmour;
    if (h <= 0) return i;
  }
  return null;
}
ok(n.armour.absorb === 0.66, 'armour absorbs 66% of each hit in the data');
ok(n.player.hp === 100 && n.player.armour === 50, 'a player has 100 HP and heavy armour is 50 in the data');
{
  const w = n.weapons['heavy-rifle'];
  for (const d of [1, 10, 25, 50, 100]) ok(T.shotsToKill(n, w, 'head', d, 100, 50) === 1, `heavy rifle head kills in 1 at ${d} m with 50 armour`);
  const body = myShotsToKill(T.rawDamage(w, 'body', 10), 100, 50);
  ok(body === 4, `the absorb rule gives 4 heavy rifle body shots against 100 + 50 (worked out: ${body})`);
  ok(T.shotsToKill(n, w, 'body', 10, 100, 50) === body, `heavy rifle body against 100 + 50 is ${body} shots`);
  ok(T.shotsToKill(n, w, 'body', 10, 100, 0) === myShotsToKill(40, 100, 0), 'heavy rifle body against no armour follows the rule');
}
{
  const w = n.weapons['silenced-rifle'];
  const bands = RAW.weapons['silenced-rifle'].damage.value;
  const near20 = myShotsToKill(bands[0].head, 100, 50);
  const far = myShotsToKill(bands[bands.length - 1].head, 100, 50);
  ok(near20 === 1, `the silenced rifle's close head (${bands[0].head}) kills 100 + 50 in 1 by the rule`);
  for (const d of [1, 10, 19.9, 20]) ok(T.shotsToKill(n, w, 'head', d, 100, 50) === near20, `silenced rifle head at ${d} m against 100 + 50 kills in ${near20}`);
  for (const d of [20.1, 30, 50]) ok(T.shotsToKill(n, w, 'head', d, 100, 50) === far, `silenced rifle head at ${d} m against 100 + 50 takes ${far} (the far head ${bands[bands.length - 1].head})`);
  ok(far > 1, 'beyond 20 m the silenced rifle head does not kill 100 + 50 in 1');
}
for (const id of WEAPONS) {
  const w = n.weapons[id];
  for (const zone of ['head', 'body', 'leg']) {
    for (const d of [5, 40]) {
      for (const [hp, armour] of [[100, 0], [100, 25], [100, 50]]) {
        const want = myShotsToKill(T.rawDamage(w, zone, d), hp, armour);
        if (T.shotsToKill(n, w, zone, d, hp, armour) !== want) ok(false, `${id} ${zone} at ${d} m against ${hp} + ${armour} is ${want} shots`);
      }
    }
  }
}
ok(true, 'every weapon, zone and armour follows the absorb rule');
{
  const t = { hp: 100, armour: 50 };
  const dealt = T.applyDamage(n, t, 40);
  ok(near(dealt, 40 - 40 * 0.66, 1e-9) && near(t.armour, 50 - 26.4, 1e-9), 'one hit into armour takes 66% off the armour');
}

// ── The spray's reset ───────────────────────────────────────────────────────
for (const id of WEAPONS) {
  const w = n.weapons[id];
  let held = true;
  for (let shot = 1; shot <= 30; shot++) if (T.sprayAfter(w, shot, 1 / w.fireRate) !== shot) held = false;
  ok(held, `${id}: holding the trigger at ${w.fireRate} a second never resets the spray`);
  let heldAds = true;
  for (let shot = 1; shot <= 30; shot++) if (T.sprayAfter(w, shot, 1 / T.fireRateOf(w, true), true) !== shot) heldAds = false;
  ok(heldAds, `${id}: holding the trigger aimed, at ${T.fireRateOf(w, true).toFixed(3)} a second, never resets the spray`);
  ok(T.sprayAfter(w, 10, w.recoil.recoverSec) === 0, `${id}: resting the recovery time (${w.recoil.recoverSec} s) resets the spray to 0 (got ${T.sprayAfter(w, 10, w.recoil.recoverSec)})`);
  ok(T.sprayAfter(w, 10, w.recoil.recoverSec + 1) === 0, `${id}: resting longer than the recovery time resets the spray to 0`);
  const mid = T.sprayAfter(w, 10, w.recoil.recoverSec / 2);
  ok(mid >= 0 && mid <= 10, `${id}: a part rest leaves the spray between 0 and where it was`);
}

// ── The settings ────────────────────────────────────────────────────────────
{
  const d = T.normaliseSettings(null);
  ok(T.validSettings(d), 'normaliseSettings(null) is valid under validSettings');
  ok(T.validSettings(T.normaliseSettings(undefined)) && T.validSettings(T.normaliseSettings('x')) && T.validSettings(T.normaliseSettings([1, 2])), 'normalising any garbage is valid');
  ok(!T.validSettings(null) && !T.validSettings('x') && !T.validSettings([]) && !T.validSettings({}), 'garbage is not valid as it stands');
  ok(T.normaliseSettings({ sens: 50 }).sens === 10, 'a sens over 10 is held at 10');
  ok(T.normaliseSettings({ sens: -1 }).sens === 0.01, 'a sens under 0.01 is held at 0.01');
  ok(T.normaliseSettings({ sens: 'fast' }).sens === d.sens && T.normaliseSettings({ sens: NaN }).sens === d.sens, 'a sens that is no number takes the default');
  ok(T.normaliseSettings({ dpi: 50 }).dpi === d.dpi && T.normaliseSettings({ dpi: 1e6 }).dpi === d.dpi && T.normaliseSettings({ dpi: 800.5 }).dpi === d.dpi, 'an out of range or broken dpi takes the default');
  ok(T.normaliseSettings({ dpi: 1600 }).dpi === 1600, 'a good dpi stands');
  ok(!T.validSettings({ ...d, sens: 50 }), 'an out of range sens is not valid');
  ok(!T.validSettings({ ...d, dpi: 50 }), 'an out of range dpi is not valid');
  ok(T.validSettings({ ...d, sens: 0.35, dpi: 1600 }), 'a good sens and dpi are valid');
  ok(!T.validSettings({ ...d, binds: { ...d.binds, back: d.binds.forward } }), 'two actions on one key are refused');
  ok(!T.validSettings({ ...d, extra: 1 }), 'a key that is no setting is refused');
  ok(!T.validSettings({ ...d, primary: 'gold-rifle' }), 'a primary that is no profile is refused');
  for (const c of ['yellow', 'red', 'purple', 'cyan']) ok(T.normaliseSettings({ enemy: c }).enemy === c && T.validSettings({ ...d, enemy: c }), `the enemy colour ${c} stands`);
  ok(T.normaliseSettings({ enemy: 'green' }).enemy === d.enemy && !T.validSettings({ ...d, enemy: 'green' }), 'an enemy colour that is none of the four takes the default, and is not valid');
  ok(T.BIND_ACTIONS.every((a) => typeof d.binds[a] === 'string') && Object.keys(d.binds).length === T.BIND_ACTIONS.length, 'the default binds name every action and nothing else');
  const c = T.parseCrosshairCode('0;P;c;5;h;0;0l;4;0o;2;0a;1;0f;0;1b;0');
  ok(c && c.color === '#00FFFF', 'the crosshair code reads cyan');
  ok(c && c.outline === false, 'the crosshair code reads no outline');
  ok(c && c.innerLength === 4 && c.innerOffset === 2, 'the crosshair code reads inner length 4 and offset 2');
  ok(c && c.outer === false, 'the crosshair code reads the outer lines off');
  ok(c && T.validSettings({ ...d, crosshair: c }), 'a read crosshair makes valid settings');
  for (const g of [null, undefined, 42, '', 'hello', 'x;y;z', '1;P;c;5', '0;zz;qq', '0;P;q;q;w;w', 'x'.repeat(700)]) {
    ok(T.parseCrosshairCode(g) === null, `the garbage crosshair code ${JSON.stringify(typeof g === 'string' && g.length > 40 ? `${g.slice(0, 10)}...` : g)} returns null`);
  }
}

// ── The store's state ───────────────────────────────────────────────────────
const EMPTY = JSON.stringify(T.emptyState());
for (const g of [null, undefined, 'x', 7, [], {}, { schema: 2, runs: [] }, { schema: 1, runs: 'x' }, { schema: 1 }]) {
  ok(JSON.stringify(T.normaliseState(g)) === EMPTY, `normaliseState of ${JSON.stringify(g)} is empty`);
}
// Fight it again's seenAt (trainer-store.js replays): kept beside the runs, still schema 1.
ok(T.emptyState().seenAt === null && T.emptyState().schema === 1, 'an empty state has seenAt null, schema 1');
ok(T.normaliseState({ schema: 1, runs: [] }).seenAt === null, 'a schema 1 value saved before seenAt reads it as null');
ok(T.normaliseState({ schema: 1, runs: [], seenAt: 1763500000000 }).seenAt === 1763500000000, 'a seenAt that is a time survives');
for (const g of ['x', -5, 0, 1.5, NaN, Infinity, null, {}, [7]]) {
  ok(T.normaliseState({ schema: 1, runs: [], seenAt: g }).seenAt === null, `a seenAt of ${JSON.stringify(g)} is dropped`);
}
ok(T.addRun({ schema: 1, runs: [], seenAt: 99 }, { scenario: 'replay', at: 5 }).seenAt === 99, 'addRun keeps seenAt');
{
  const run = (i, score) => ({ scenario: 'flick-grid', at: 1000 + i, score, kills: 1, bots: 1, shots: 2, hits: 1 });
  let s = T.emptyState();
  for (let i = 0; i < T.RUNS_MAX + 7; i++) s = T.addRun(s, run(i, i));
  ok(s.runs.length === T.RUNS_MAX, `addRun caps at RUNS_MAX (${T.RUNS_MAX})`);
  ok(s.runs[0].at === 1007 && s.runs[s.runs.length - 1].at === 1000 + T.RUNS_MAX + 6, 'addRun keeps the newest runs');
  ok(T.normaliseState({ schema: 1, runs: [...s.runs, ...s.runs] }).runs.length === T.RUNS_MAX, 'a stored list over the cap is cut to it');
  let h = T.emptyState();
  h = T.addRun(h, run(1, 300));
  h = T.addRun(h, run(2, 900));
  h = T.addRun(h, run(3, 500));
  h = T.addRun(h, { ...run(4, 2000), scenario: 'micro-flicks' });
  const hist = T.historyOf(h, 'flick-grid', 2);
  ok(hist.plays === 3, 'historyOf counts the plays of one scenario');
  ok(hist.best && hist.best.score === 900, 'historyOf names the best score of that scenario only');
  ok(hist.last.length === 2 && hist.last[0].score === 900 && hist.last[1].score === 500, 'historyOf gives the last n oldest first');
  ok(T.historyOf(h, 'spray-wall').plays === 0 && T.historyOf(h, 'spray-wall').best === null, 'a scenario never played has no best');
  for (const bad of [null, 'x', {}, { scenario: 'flick-grid' }, { scenario: 'Flick Grid', at: 5 }, { scenario: 'flick-grid', at: -1 }, { scenario: 'flick-grid', at: 'now' }, { scenario: 7, at: 5 }]) {
    ok(T.addRun(T.emptyState(), bad) === null, `a run of unknown shape ${JSON.stringify(bad)} is refused`);
  }
}

// ── The cone in its two parts (the report's shooting error graph) ───────────
for (const id of WEAPONS) {
  const w = n.weapons[id];
  const sp = w.spread;
  const run = T.topSpeed(n, w, 'run'), walk = T.topSpeed(n, w, 'walk');
  const states = [
    { shot: 1, speed: 0 }, { shot: 5, speed: 0 }, { shot: 3, ads: true }, { shot: 2, crouch: true },
    { shot: 1, speed: run }, { shot: 4, speed: run }, { shot: 1, speed: walk, walk: true }, { shot: 1, speed: run * 0.5 },
    { shot: 1, air: true }, { shot: 6, air: true }, { shot: 1, landing: 0.05 }, { shot: 2, crouch: true, speed: T.topSpeed(n, w, 'crouch') },
    { shot: 2, ads: true, speed: run },
  ];
  let sums = true, steadyFire = true;
  for (const s of states) {
    const p = T.spreadParts(n, w, s);
    if (!near(p.fire + p.move, T.spread(n, w, s), 1e-12)) sums = false;
    // The firing part is the cone the same shot would have standing still on the ground.
    if (!s.air && !near(p.fire, T.spread(n, w, { shot: s.shot, ads: s.ads, crouch: s.crouch, speed: 0 }), 1e-12)) steadyFire = false;
  }
  ok(sums, `${id}: the firing and movement errors add up to the cone, in every state`);
  ok(steadyFire, `${id}: the firing error is the cone the same shot has standing still`);
  ok(T.spreadParts(n, w, { shot: 1, speed: 0 }).move === 0, `${id}: standing, no movement error`);
  ok(T.spreadParts(n, w, { shot: 1, speed: T.gateSpeed(n, w, 'run') }).move === 0, `${id}: at the accuracy gate, no movement error`);
  ok(T.spreadParts(n, w, { shot: 1, speed: run }).move === sp.run, `${id}: running, the movement error is the running error ${sp.run}`);
  ok(T.spreadParts(n, w, { shot: 1, speed: walk, walk: true }).move === sp.walk, `${id}: walking, it is the walking error ${sp.walk}`);
  const air = T.spreadParts(n, w, { shot: 3, air: true });
  ok(air.move === sp.air && near(air.fire, T.spread(n, w, { shot: 3 }), 1e-12), `${id}: in the air the movement error is the airborne ${sp.air} and the firing error the spray's`);
  ok(T.spreadParts(n, w, { shot: 1, landing: 0.05 }).move === n.move.landingSpread, `${id}: just landed, it is the landing error ${n.move.landingSpread}`);
  ok(T.spreadParts(n, w, { shot: 1, landing: n.move.landingSec + 0.01 }).move === 0, `${id}: after the landing time, none`);
}
{
  const g0 = T.errorGraph([], 120);
  ok(g0.shots === 0 && g0.moving === 0 && g0.bars.length === 0 && g0.top === 0.5, 'no shot: an empty graph, scale 0.5');
  ok(T.errorGraph(null, 120).shots === 0, 'nothing given is no shot, never a throw');
  const shots = [];
  for (let i = 0; i < 300; i++) shots.push({ fire: 0.25 + (i % 7) * 0.1, move: i % 3 === 0 ? 1.5 : 0 });
  const g = T.errorGraph(shots, 120);
  ok(g.shots === 300 && g.bars.length === 120, 'the graph counts every shot and draws the last 120');
  ok(g.bars[0] === shots[180] && g.bars[119] === shots[299], 'the bars are the last shots, oldest first');
  ok(g.moving === 100, 'it counts every shot with movement error, not only those drawn');
  ok(g.top === 3, `the scale is the tallest bar (${(0.25 + 0.6 + 1.5).toFixed(2)}) rounded up to 1, 1.5, 2, 3, 5 or 7.5 a power of ten: 3 (got ${g.top})`);
  ok(T.errorGraph(shots).bars.length === 300, 'with no cap every shot is drawn');
  ok(T.errorGraph([{ fire: 0.2, move: 0 }], 120).top === 0.5, 'a small cone keeps the least scale, 0.5');
  ok(T.errorGraph([{ fire: 0.9, move: 0 }], 120).top === 1, '0.9 scales to 1');
  ok(T.errorGraph([{ fire: 1, move: 0 }], 120).top === 1, 'exactly 1 scales to 1');
  ok(T.errorGraph([{ fire: 1.1, move: 0.3 }], 120).top === 1.5, '1.4 scales to 1.5');
  ok(T.errorGraph([{ fire: 1.1, move: 0.6 }], 120).top === 2, '1.7 scales to 2');
  ok(T.errorGraph([{ fire: 0.25, move: 6 }], 120).top === 7.5, '6.25 (a first shot running) scales to 7.5');
  ok(T.errorGraph([{ fire: 2.75, move: 7 }], 120).top === 10, '9.75 scales to 10');
  ok(T.errorGraph([{ fire: 0.25, move: 10 }], 120).top === 15, '10.25 (a first shot in the air) scales to 15');
  ok(T.errorGraph([{ fire: 1.8, move: 18.5 }], 120).top === 30, '20.3 scales to 30');
  ok(T.errorGraph([{ fire: 1, move: 0 }, { fire: NaN, move: 0 }, null, { fire: 1 }], 120).shots === 1, 'a shot that is not two numbers is left out');
  let fits = true;
  for (const b of g.bars) if (b.fire + b.move > g.top + 1e-9) fits = false;
  ok(fits, 'every bar fits under the scale');
}

// ── Tagging: the player and the bots ────────────────────────────────────────
{
  const top = T.topSpeed(n, n.weapons['heavy-rifle'], 'run');
  ok(near(T.taggedTop(n, top, 1.0, 1.2), top * (1 - n.move.tagSlow), 1e-12), `tagged, the top speed is ${((1 - n.move.tagSlow) * 100).toFixed(1)}% of it`);
  ok(T.taggedTop(n, top, 1.2, 1.2) === top && T.taggedTop(n, top, 2, 0) === top, 'once the tag has run out, the whole top speed');
  // A bot strafing at full speed is hit: on the same stepGround, still
  // pressing its way, it is held to the tagged top within a stop's time,
  // and back to full speed once the tag is gone.
  const v = { x: top, z: 0 };
  const hitAt = 0, until = hitAt + n.move.tagSec;
  let t = 0, held = null, over = false;
  for (; t < until - 1e-9; t += TICK) {
    T.stepGround(v, { x: 1, z: 0 }, T.taggedTop(n, top, t, until), n.move, TICK, top);
    const s = Math.hypot(v.x, v.z);
    if (held == null && s <= top * (1 - n.move.tagSlow) + 1e-9) held = t + TICK;
    if (held != null && s > top * (1 - n.move.tagSlow) + 1e-9) over = true;
  }
  ok(held != null && held <= 0.11, `a bot hit at full speed is slowed to the tagged top in ${held == null ? 'never' : held.toFixed(3)} s (at most 0.11, as letting go: the tag lowers the cap, not the braking)`);
  ok(!over, 'and holds no faster while the tag lasts');
  for (let i = 0; i < n.tick; i++, t += TICK) T.stepGround(v, { x: 1, z: 0 }, T.taggedTop(n, top, t, until), n.move, TICK, top);
  ok(near(Math.hypot(v.x, v.z), top, 1e-9), 'a second after the tag, it runs at full speed again');
  ok(n.move.tagSec > 0 && n.move.tagSlow > 0 && n.move.tagSlow < 1, 'the tag numbers are the data file\'s, no new ones');
}

// ── Seeded randomness and the strafing targets ──────────────────────────────
{
  const a = T.rng(12345), b = T.rng(12345), c = T.rng(54321);
  let same = true, differ = false, inRange = true;
  for (let i = 0; i < 1000; i++) { const x = a(), y = b(), z = c(); if (x !== y) same = false; if (x !== z) differ = true; if (!(x >= 0 && x < 1)) inRange = false; }
  ok(same && differ && inRange, 'rng: the same seed gives the same numbers in [0, 1), another seed others');
  const z0 = T.rng(0);
  ok(z0() !== z0(), 'rng: a seed of 0 is not stuck');

  const st = n.strafe;
  for (const k of ['lane', 'travel', 'dwell', 'tap']) ok(Array.isArray(st[k]) && st[k].length === 2 && st[k][0] > 0 && st[k][0] <= st[k][1], `strafe.${k} is a least and a most`);
  ok(st.tapChance > 0 && st.tapChance < 1, 'strafe.tapChance is a chance');
  ok(st.travel[1] <= 1, 'a long leg never covers more than the lane\'s width');
  ok(st.tap[1] < 2 * st.lane[0], 'a tap is shorter than the narrowest lane');
  for (const k of ['lane', 'travel', 'dwell', 'tapChance', 'tap']) {
    const leaf = RAW.strafe[k];
    ok(leaf.verified === false && leaf.source === 'trainer design' && typeof leaf.note === 'string' && leaf.note.length > 40, `strafe.${k} is the Trainer's own design, unverified, with its note`);
  }

  const walkOut = (seed, count) => { const s = T.strafer(st, T.rng(seed)); const legs = []; for (let i = 0; i < count; i++) legs.push(s.next()); return { half: s.half, legs }; };
  const x1 = walkOut(777, 50), x2 = walkOut(777, 50), x3 = walkOut(778, 50);
  ok(JSON.stringify(x1) === JSON.stringify(x2), 'a strafing target moves the same from the same seed');
  ok(JSON.stringify(x1) !== JSON.stringify(x3), 'and otherwise from another seed');

  let halves = true, inside = true, holds = true, reverses = 0, turns = 0, taps = 0, legs = 0, tapLen = true, longLen = true, tapAt = 0, longs = 0, cutLongs = 0;
  const lens = [];
  for (let seed = 1; seed <= 200; seed++) {
    const { half, legs: L } = walkOut(seed * 2654435761 >>> 0, 40);
    if (!(half >= st.lane[0] - 1e-12 && half <= st.lane[1] + 1e-12)) halves = false;
    let prev = 0, prevDir = 0;
    for (const l of L) {
      legs++;
      if (Math.abs(l.off) > half + 1e-9) inside = false;
      if (!(l.hold >= st.dwell[0] - 1e-12 && l.hold <= st.dwell[1] + 1e-12)) holds = false;
      const d = l.off - prev;
      const dir = Math.sign(d);
      if (prevDir && dir === -prevDir) reverses++; else if (prevDir) turns++;
      const len = Math.abs(d);
      lens.push(len);
      if (l.tap) { taps++; if (len > st.tap[1] + 1e-9) tapLen = false; if (len < st.tap[0] - 1e-9) tapAt++; }
      else {
        longs++;
        if (len > st.travel[1] * 2 * half + 1e-9) longLen = false;
        // Short of the least travel only when it was cut at the lane's edge.
        if (len < st.travel[0] * 2 * half - 1e-9) { if (Math.abs(Math.abs(l.off) - half) > 1e-9) longLen = false; else cutLongs++; }
      }
      prev = l.off; prevDir = dir;
    }
  }
  ok(halves, `every lane is ${st.lane[0]} to ${st.lane[1]} m each side`);
  ok(inside, 'a target never leaves its lane');
  ok(holds, `every hold at a turn is ${st.dwell[0]} to ${st.dwell[1]} s`);
  ok(reverses / (reverses + turns) > 0.97, `every leg reverses the last (${reverses} of ${reverses + turns}), save a turn back at the edge`);
  ok(Math.abs(taps / legs - st.tapChance) < 0.03, `about ${st.tapChance * 100}% of the legs are taps (${(taps / legs * 100).toFixed(1)}%)`);
  ok(tapLen, `a tap goes no more than ${st.tap[1]} m`);
  ok(tapAt / Math.max(1, taps) < 0.15, `a tap is cut short of ${st.tap[0]} m only at an edge (${tapAt} of ${taps})`);
  ok(longLen, 'a long leg covers its share of the lane, or stops at the edge');
  ok(cutLongs < longs, 'not every long leg is cut at the edge');
  const distinct = new Set(lens.map((x) => x.toFixed(6))).size;
  ok(distinct > lens.length * 0.75, `no fixed pattern: ${distinct} different leg lengths in ${lens.length}`);
  ok(lens.some((x) => x < 1.2) && lens.some((x) => x > 4), 'both short taps and long legs across the lane');
  // The lane is wide enough for a leg at full speed on stepGround.
  const top = T.topSpeed(n, n.weapons['heavy-rifle'], 'run');
  ok(0.5 * top * n.move.accelTime < 2 * st.lane[0], 'the narrowest lane has room to reach the run speed');

  // Walking the legs as bots.js steer does (trainer-math.js walkLeg): a
  // strafing leg (`still`) stands its dwell once stopped, every leg; a
  // leg without it counts its hold from letting go, the stop included.
  const walkPlan = (legs, seconds) => {
    const b = { x: 0, z: 0, v: { x: 0, z: 0 } }, wish = { x: 0, z: 0 }, pl = { legs, i: 0 };
    const stood = legs.map(() => 0), ends = [];
    let t = 0;
    while (pl.i < legs.length && t < seconds) {
      const leg = legs[pl.i];
      const done = T.walkLeg(pl, leg, b.x, b.z, b.v, top, n.move, TICK, wish);
      if (Math.hypot(b.v.x, b.v.z) < n.move.stopSpeed && pl.holding) stood[pl.i] += TICK;
      if (done) { ends.push({ i: pl.i, d: Math.hypot(leg.to[0] - b.x, leg.to[1] - b.z) }); pl.i++; }
      T.stepGround(b.v, wish, top, n.move, TICK, top);
      b.x += b.v.x * TICK; b.z += b.v.z * TICK; t += TICK;
    }
    return { stood, ends, i: pl.i };
  };
  const sw = T.strafer(st, T.rng(12345));
  const swLegs = [];
  for (let i = 0; i < 40; i++) { const l = sw.next(); swLegs.push({ to: [l.off, 0], hold: l.hold, still: true }); }
  const w = walkPlan(swLegs, 60);
  ok(w.i === swLegs.length, `a strafing target walks all ${swLegs.length} legs (walked ${w.i})`);
  let short = 0, worst = 0;
  for (let i = 0; i < w.i; i++) { const lack = swLegs[i].hold - w.stood[i]; if (lack > TICK + 1e-9) short++; worst = Math.max(worst, lack); }
  ok(short === 0, `at every turn it stands its whole dwell once stopped (${short} short, the worst by ${(worst * 1000).toFixed(1)} ms)`);
  ok(w.stood.slice(0, w.i).every((x, i) => x <= swLegs[i].hold + 2 * TICK + 1e-9), 'and no more than a tick or two over it');
  ok(w.ends.every((e) => e.d < 0.3), `each leg ends near its mark (the furthest ${Math.max(...w.ends.map((e) => e.d)).toFixed(3)} m off)`);
  // A peek's hold (no `still`) counts from letting go: a hold shorter than
  // the stop turns back the moment the bot stands.
  const peek = walkPlan([{ to: [4, 0], hold: 0.1 }, { to: [0, 0], hold: 0 }], 10);
  ok(peek.i === 2 && peek.stood[0] <= 2 * TICK + 1e-9, `a peek's 0.1 s hold, counted from letting go, stands no more than a tick or two (stood ${peek.stood[0].toFixed(4)} s)`);
}

// ── The report and the score ────────────────────────────────────────────────
{
  const base = { shots: 20, hits: 10, heads: 4, kills: 5, bots: 5, firstShots: 8, firstHits: 6, ttk: [600, 600, 600, 600, 600], headKills: [], damageTaken: 0, seconds: 30, limit: 0 };
  const r = T.report(base);
  ok(r.accuracy === 50, 'accuracy is hits over shots');
  ok(r.headshots === 40, 'headshots are heads over hits');
  ok(r.firstShot === 75, 'first shot is first hits over first shots');
  ok(T.report({}).accuracy === null && T.report({}).score === 0, 'an empty run has no accuracy and scores 0');
  ok(T.report({ ...base, hits: 50 }).accuracy === 100, 'hits are never more than shots');
  ok(T.report({ ...base, damageTaken: 100000 }).score === 0, 'the score is never negative');
  const fast = T.report({ ...base, ttk: [300, 300, 300, 300, 300] }).score;
  const slow = T.report({ ...base, ttk: [1200, 1200, 1200, 1200, 1200] }).score;
  ok(fast > slow, `a faster kill scores more (${fast} against ${slow})`);
  ok(T.report({ ...base, damageTaken: 40 }).score < r.score, 'damage taken lowers the score');
  ok(T.report({ ...base, hits: 15 }).score > r.score, 'better accuracy scores more');
}

// ── The data file itself ────────────────────────────────────────────────────
{
  const LEAF_KEYS = ['value', 'unit', 'source', 'patch', 'verified'];
  const bad = [];
  let leaves = 0;
  const walk = (v, at) => {
    if (!v || typeof v !== 'object' || Array.isArray(v)) { bad.push(`${at} is not a leaf object`); return; }
    if (Object.prototype.hasOwnProperty.call(v, 'value')) {
      leaves += 1;
      for (const k of LEAF_KEYS) if (!Object.prototype.hasOwnProperty.call(v, k)) bad.push(`${at} has no ${k}`);
      if (typeof v.source !== 'string' || !v.source.trim()) bad.push(`${at} has an empty source`);
      if (typeof v.verified !== 'boolean') bad.push(`${at} verified is not true or false`);
      if (typeof v.unit !== 'string' || !v.unit.trim()) bad.push(`${at} has an empty unit`);
      return;
    }
    const keys = Object.keys(v).filter((k) => k !== '_about');
    if (!keys.length) bad.push(`${at} is an empty group`);
    for (const k of keys) walk(v[k], at ? `${at}.${k}` : k);
  };
  walk(RAW, '');
  ok(leaves > 50, `the data file has its values (${leaves} leaves)`);
  ok(!bad.length, `every leaf has value, unit, source, patch and verified${bad.length ? `: ${bad.slice(0, 8).join('; ')}` : ''}`);
  const EM = String.fromCharCode(8212);
  const EN = String.fromCharCode(8211);
  for (const f of [DATA_FILE, SCEN_FILE, path.join(ROOT, 'src', 'shared', 'trainer-math.js')]) {
    const text = fs.readFileSync(f, 'utf8');
    const parsed = f.endsWith('.json') ? JSON.stringify(JSON.parse(text)) : '';
    const has = text.includes(EM) || text.includes(EN) || parsed.includes(EM) || parsed.includes(EN);
    ok(!has, `no em or en dash in ${path.basename(f)}`);
  }
  for (const id of WEAPONS) {
    for (const k of ['runSpeed', 'fireRate', 'mag', 'adsMoveMult']) ok(typeof n.weapons[id][k] === 'number' && n.weapons[id][k] > 0, `${id} has a ${k}`);
    ok(Array.isArray(n.weapons[id].damage) && n.weapons[id].damage.length >= 1, `${id} has its damage bands`);
    ok(n.weapons[id].damage.every((b, i, a) => i === 0 || b.to > a[i - 1].to), `${id} damage bands run outwards`);
  }
}

// ── The scenarios file ──────────────────────────────────────────────────────
{
  const ID_RE = /^[a-z0-9-]{1,48}$/;
  ok(ID_RE.test('site-preaim-hard') && !ID_RE.test('Site Preaim') && !ID_RE.test(''), 'the id pattern matches a known id and refuses a bad one');
  const list = SCEN.scenarios;
  ok(Array.isArray(list) && list.length === 16, `the scenarios file holds 16 scenarios (${list && list.length})`);
  const ids = list.map((s) => s.id);
  ok(new Set(ids).size === ids.length, 'the scenario ids are unique');
  const drills = JSON.parse(fs.readFileSync(DRILL_FILE, 'utf8'));
  const known = new Set((drills.drills || []).map((d) => d.cause).filter((c) => typeof c === 'string'));
  ok(known.size > 5 && known.has('lost-duel'), `the drill library names its causes (${known.size})`);
  known.add('low-headshots');
  const ARENAS = ['range', 'site', 'lane', 'stack', 'corner', 'plant'];
  for (const s of list) {
    ok(ID_RE.test(s.id), `${s.id}: the id is lower case letters, digits and hyphens`);
    ok(ARENAS.includes(s.arena), `${s.id}: the arena ${s.arena} is one of ${ARENAS.join(', ')}`);
    ok(!('weapon' in s) && !('hp' in s), `${s.id}: names no weapon and no HP, the loadout is the player's and the HP the data's`);
    ok(Array.isArray(s.causes), `${s.id}: has a causes list`);
    for (const c of s.causes || []) ok(known.has(c), `${s.id}: the cause ${c} is one the drill library knows, or low-headshots`);
    ok(typeof s.title === 'string' && s.title.trim() && typeof s.about === 'string' && s.about.trim(), `${s.id}: has a title and an about`);
    ok(Number.isFinite(s.limit) && s.limit >= 0 && Number.isInteger(s.bots) && s.bots >= 0, `${s.id}: limit and bots are numbers`);
    if (s.level === 'hard') {
      ok(s.limit > 0, `${s.id}: a hard level has a time limit`);
      ok(s.botShoot === true, `${s.id}: on hard the bots shoot`);
    } else if (s.level === 'easy') {
      ok(s.botShoot === false, `${s.id}: on easy the bots never shoot`);
    } else {
      ok(s.level === null && s.botShoot === false, `${s.id}: a scenario with no level never shoots back`);
    }
  }
}

// ── Main's half on a fake store ─────────────────────────────────────────────
{
  const mem = {};
  let isBusy = false;
  let opened = [];
  let pushes = 0;
  const tr = createTrainer({
    store: { get: (k) => mem[k], set: (k, v) => { mem[k] = JSON.parse(JSON.stringify(v)); } },
    busy: () => isBusy,
    open: (p) => opened.push(p),
    changed: () => { pushes += 1; },
    now: () => 1234567,
  });
  const g = tr.get();
  ok(g && Array.isArray(g.runs) && g.runs.length === 0 && g.opened === null, 'an empty store gets no runs and nothing opened');
  const good = { scenario: 'flick-grid', at: 5, score: 100, kills: 1, bots: 1, shots: 1, hits: 1 };
  const saved = tr.save(good);
  ok(saved.ok === true && saved.run.at === 1234567, 'save stamps main\'s own time, not the page\'s');
  ok(saved.best === true, 'the first run of a scenario is its best');
  ok(mem.trainer && mem.trainer.runs.length === 1, 'save writes the store\'s trainer key');
  ok(pushes === 1, 'save tells the pages');
  ok(tr.save({ ...good, score: 50 }).best === false, 'a lower score is no best');
  const unknown = tr.save({ ...good, scenario: 'not-a-scenario' });
  ok(unknown.ok === false && unknown.error === 'run', 'save refuses an unknown scenario id');
  ok(tr.save(null).ok === false && tr.save('x').ok === false, 'save refuses no run');
  ok(tr.save({ scenario: 'flick-grid', score: 'x' }).ok === true, 'a run with junk fields is cleaned, never thrown');
  ok(tr.open('not-a-scenario') === false && opened.length === 0, 'open only opens a known id');
  ok(tr.open('spray-wall') === true && opened.length === 1 && opened[0] === 'trainer', 'open shows the Trainer page');
  ok(tr.get().opened === 'spray-wall', 'the scenario asked for is answered by get');
  ok(tr.get().opened === null, 'and answered once');
  ok(tr.clear('not-a-scenario').ok === false, 'clear refuses an unknown scenario id');
  ok(tr.clear('micro-flicks').ok === true && tr.get().runs.length === 3, 'clearing another scenario keeps these runs');
  ok(tr.clear('flick-grid').ok === true && tr.get().runs.length === 0, 'clear takes one scenario\'s runs');

  isBusy = true;
  const before = JSON.stringify(mem);
  ok(tr.get() === null, 'mid match get answers null');
  const s2 = tr.save(good);
  ok(s2.ok === false && s2.error === 'match', 'mid match save answers { ok: false, error: match }');
  const c2 = tr.clear(null);
  ok(c2.ok === false && c2.error === 'match', 'mid match clear answers { ok: false, error: match }');
  const c3 = tr.clear('flick-grid');
  ok(c3.ok === false && c3.error === 'match', 'mid match clear of one scenario answers { ok: false, error: match }');
  ok(!tr.open('spray-wall') && opened.length === 1, 'mid match open refuses and shows nothing');
  ok(JSON.stringify(mem) === before, 'mid match nothing is written');
  isBusy = false;
  ok(tr.get().opened === null, 'an open refused mid match leaves nothing pending');

  // A busy() that throws counts as busy.
  const thrower = createTrainer({ store: { get: () => undefined, set: () => {} }, busy: () => { throw new Error('x'); } });
  ok(thrower.get() === null && thrower.save(good).error === 'match', 'a busy() that throws is busy');
  // A store that throws is nothing saved, never a throw.
  const broken = createTrainer({ store: { get: () => { throw new Error('x'); }, set: () => { throw new Error('y'); } }, busy: () => false });
  ok(broken.get() && broken.get().runs.length === 0, 'a store that cannot read is no runs');
  ok(broken.save(good).ok === false, 'a store that cannot write answers not ok');
  ok(tr.has('calibration') && !tr.has('nope'), 'has knows the scenario ids');
}

// ── The report's graph line (shot-graph.js, an ES module of the page) ───────
async function graphLine() {
  // Read as a data URL, an ES module by definition (it imports nothing), so
  // Node does not warn that the repo's package.json names no module type.
  const G = await import(`data:text/javascript,${encodeURIComponent(fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'trainer', 'shot-graph.js'), 'utf8'))}`);
  const say = (shots, moving) => G.shotGraphLine({ shots, moving, bars: [], top: 1 });
  ok(say(0, 0) === '', 'no shot, no line');
  ok(say(24, 0) === 'None of your 24 shots carried movement error.', 'no movement error says so');
  ok(say(1, 0) === 'None of your 1 shot carried movement error.', 'one shot is a shot');
  ok(say(40, 9).startsWith('9 of your 40 shots carried movement error'), 'some shots with movement error are counted');
  ok(say(5, 5).startsWith('Every one of your 5 shots carried movement error'), 'every shot with movement error says so');
  const EM = String.fromCharCode(8212), EN = String.fromCharCode(8211);
  const src = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'trainer', 'shot-graph.js'), 'utf8');
  ok(![say(24, 0), say(40, 9), say(5, 5), src].some((t) => t.includes(EM) || t.includes(EN)), 'no em or en dash in the graph or its lines');
  ok(!/#[0-9a-fA-F]{3,8}\b|rgb\(/.test(src), 'the graph names no colour: trainer.css gives them');
}

graphLine().catch((e) => ok(false, `the graph module loads in Node: ${e.message}`)).then(() => {
  console.log(`${failed ? 'FAILED' : 'OK'}: ${passed} passed, ${failed} failed`);

  // The values the owner still has to check in the game: information, not a failure.
  const left = T.unverified(RAW);
  console.log(`unverified: ${left.length} values in trainer-data.json`);
  for (const p of left) console.log(`  ${p}`);

  process.exit(failed ? 1 : 0);
});

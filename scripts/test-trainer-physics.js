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
ok(T.zoomedFov(70, 1) === 70 && T.zoomedFov(70, 2) < 70, 'zoomedFov leaves zoom 1 alone and narrows a zoom');

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
  const r = T.timeToStop(n, rifleRun, false, 0);
  const k = T.timeToStop(n, knife, false, 0);
  ok(r != null && Math.abs(r - 0.125) <= 0.012, `the rifle at run speed stops in 0.125 s measured (got ${r})`);
  ok(k != null && Math.abs(k - 0.145) <= 0.012, `the knife at run speed stops in 0.145 s measured (got ${k})`);
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

// ── The accuracy gate ───────────────────────────────────────────────────────
ok(n.move.accurateFrac === 0.275, 'the gate is 27.5% of the top speed in the data');
for (const id of WEAPONS) {
  const w = n.weapons[id];
  for (const mode of ['run', 'walk', 'crouch']) {
    const top = T.topSpeed(n, w, mode);
    const gate = top * 0.275;
    ok(T.accurate(n, gate, w, mode) === true, `${id} ${mode}: accurate at exactly 27.5% of ${top.toFixed(3)} m/s`);
    ok(T.accurate(n, gate + 1e-6, w, mode) === false, `${id} ${mode}: not accurate just above 27.5%`);
    ok(T.accurate(n, 0, w, mode) === true, `${id} ${mode}: standing still is accurate`);
  }
  const runGate = T.topSpeed(n, w, 'run') * 0.275;
  ok(T.accurate(n, runGate, w, 'walk') === false, `${id}: the run gate is too fast when walking (the gate follows the walk top speed)`);
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
  for (let k = 1; k <= 40; k++) {
    const s = T.spread(n, w, { shot: k });
    const want = Math.min(sp.max, sp.first + sp.growth * (k - 1));
    if (!near(s, want, 1e-9)) { ok(false, `${id}: shot ${k} of a spray is ${want} (got ${s})`); break; }
    if (s > sp.max) { ok(false, `${id}: shot ${k} grows past the max ${sp.max}`); break; }
    if (k === 40) ok(true, `${id}: the spray grows by its growth a bullet`);
  }
  ok(T.spread(n, w, { shot: 40 }) === sp.max, `${id}: a long spray is exactly the max ${sp.max}, no further`);
  if (Number.isInteger(reachesMaxAt)) {
    ok(near(T.spread(n, w, { shot: reachesMaxAt }), sp.max, 1e-9), `${id}: the cone reaches the max at bullet ${reachesMaxAt}, as the data note says`);
    ok(T.spread(n, w, { shot: reachesMaxAt - 1 }) < sp.max - 1e-9, `${id}: and not before bullet ${reachesMaxAt}`);
  }
  ok(near(T.spread(n, w, { shot: 1, crouch: true }), sp.first * sp.crouchMult, 1e-12), `${id}: crouched the first shot is smaller by crouchMult`);
  ok(near(T.spread(n, w, { shot: 40, crouch: true }), sp.max * sp.crouchMult, 1e-12), `${id}: crouched the max is smaller by crouchMult`);
  const run = T.topSpeed(n, w, 'run');
  const walk = T.topSpeed(n, w, 'walk');
  const crouch = T.topSpeed(n, w, 'crouch');
  ok(near(T.spread(n, w, { shot: 1, speed: run }), sp.first + sp.run, 1e-9), `${id}: at full run speed the running error is added`);
  ok(near(T.spread(n, w, { shot: 1, speed: walk, walk: true }), sp.first + sp.walk, 1e-9), `${id}: at walk speed with walk held the walking error is added`);
  ok(near(T.spread(n, w, { shot: 1, speed: crouch, crouch: true }), sp.first * sp.crouchMult + sp.crouchMove, 1e-9), `${id}: crouch walking at its top speed adds the crouch moving error`);
  ok(near(T.spread(n, w, { shot: 1, air: true }), sp.first + sp.air, 1e-9), `${id}: in the air the airborne error is added`);
  ok(near(T.spread(n, w, { shot: 1, landing: n.move.landingSec / 2 }), sp.first + n.move.landingSpread, 1e-9), `${id}: just after landing the landing error is added`);
  ok(near(T.spread(n, w, { shot: 1, landing: n.move.landingSec + 0.01 }), sp.first, 1e-9), `${id}: after the landing time the landing error is gone`);
  ok(T.spread(n, w, { shot: 1, speed: run * 0.275 }) === sp.first, `${id}: at the gate no movement error is added`);
  const ads = T.spread(n, w, { shot: 1, ads: true });
  if (sp.adsFirst != null) ok(ads === sp.adsFirst, `${id}: aimed, the first shot is the ADS value ${sp.adsFirst}`);
  else ok(ads === sp.first, `${id}: with no ADS value, aimed is the hip first shot`);
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
  ok(Array.isArray(list) && list.length === 12, `the scenarios file holds 12 scenarios (${list && list.length})`);
  const ids = list.map((s) => s.id);
  ok(new Set(ids).size === ids.length, 'the scenario ids are unique');
  const drills = JSON.parse(fs.readFileSync(DRILL_FILE, 'utf8'));
  const known = new Set((drills.drills || []).map((d) => d.cause).filter((c) => typeof c === 'string'));
  ok(known.size > 5 && known.has('lost-duel'), `the drill library names its causes (${known.size})`);
  known.add('low-headshots');
  const ARENAS = ['range', 'site', 'lane', 'stack'];
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

console.log(`${failed ? 'FAILED' : 'OK'}: ${passed} passed, ${failed} failed`);

// The values the owner still has to check in the game: information, not a failure.
const left = T.unverified(RAW);
console.log(`unverified: ${left.length} values in trainer-data.json`);
for (const p of left) console.log(`  ${p}`);

process.exit(failed ? 1 : 0);

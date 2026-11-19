// THE SCENARIOS' RULES (docs/claude/trainer.md, "Scenarios"). Each kind in
// trainer-scenarios.json gets a controller here: where bots appear and how
// they move, when the run is done, and what its line on the HUD says. The
// page counts shots and hits (app.js) and a fallen bot leaves by itself
// (bots.js); the controller places bots and decides the end.
//
// A scenario whose bots shoot back (botShoot, the Hard levels): each reacts
// 0.45 s after it sees the player and taps 1.6 times a second. Most taps
// miss: one in seven lands once it has settled (over a second and a half of
// seeing the player), fewer before that and further off. Only two bots fire
// at once (bots.js FIRING_MAX), a hit is the light pistol's body damage, and
// never two land within 0.6 s (engine.js BOT_GUN, HURT_GAP). Tuned on the
// site so that standing in the open in front of the whole site lasts about
// twenty seconds, and a player who clears each angle as it opens loses little. They wear armour, the player's armour is on too and
// the time limit runs.

const M = window.OcclaraTrainerMath;
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[(Math.random() * arr.length) | 0];
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; }

/** The spray wall: the range with a wall behind the target, to see where the bullets went. */
export const EXTRA = { spray: [[-5, 0, -11.7, 5, 3.6, -11.3]] };

const SHOOTS = { shoot: true, reaction: 0.45, hitChance: 0.14, rate: 1.6, armour: 50 };

/**
 * @param sc   the scenario (trainer-scenarios.json)
 * @param eng  what the controller sees of the engine: N, P, bots, arena, guns, now
 * @param run  the counters the page keeps ({ kills, bots, ... })
 * @returns { start(now), tick(now), killed(b, zone, res, now), shot(res), allowHit(res), line(), done }
 */
export function controllerFor(sc, eng, run) {
  const base = sc.botShoot ? SHOOTS : { shoot: false };
  const N = eng.N;
  const c = { done: false };

  // ── Range kinds: one target at a time in front of the player ──────────
  if (sc.arena === 'range' && sc.kind !== 'calibration') {
    let left = sc.bots;
    let lastYaw = 0;
    function place(now) {
      if (left <= 0) { c.done = true; return; }
      let yaw, dist, plan = null;
      if (sc.kind === 'flick') { yaw = rnd(-55, 55) * M.DEG; dist = rnd(8, 22); }
      else if (sc.kind === 'micro') { yaw = lastYaw + (Math.random() < 0.5 ? -1 : 1) * rnd(1.2, 4) * M.DEG; if (Math.abs(yaw) > 25 * M.DEG) yaw = rnd(-5, 5) * M.DEG; dist = rnd(13, 16); }
      else if (sc.kind === 'spray') { yaw = 0; dist = 10; }
      else { yaw = rnd(-35, 35) * M.DEG; dist = rnd(11, 18); }
      lastYaw = yaw;
      const x = -Math.sin(yaw) * dist, z = -Math.cos(yaw) * dist;
      if (sc.kind === 'track') {
        // It strafes across the player's view and stops, as a player does.
        const ax = Math.cos(yaw), az = -Math.sin(yaw);
        const span = rnd(2.5, 4.5);
        const legs = [];
        for (let i = 0; i < 6; i++) {
          const s = (i % 2 ? -1 : 1) * span * rnd(0.6, 1);
          legs.push({ to: [x + ax * s, z + az * s], hold: rnd(0.2, 0.55) });
        }
        plan = { legs, loop: true };
      }
      eng.bots.spawn({ x, y: 0, z, plan, hp: N.player.hp, god: sc.kind === 'spray' }, now);
      if (sc.kind !== 'spray') left -= 1;
    }
    if (sc.kind === 'spray') {
      // A spray: from the first bullet to letting go, at least 8 bullets long.
      let sprays = 0, inSpray = 0, sprayHits = 0;
      c.sprays = [];
      c.shot = (res) => { inSpray++; if (res.hit) sprayHits++; };
      c.tick = () => {
        const g = eng.guns;
        if (inSpray && (!g.st.trigger || g.reloading())) {
          if (inSpray >= 8) { sprays++; c.sprays.push({ shots: inSpray, hits: sprayHits }); run.kills = sprays; }
          inSpray = 0; sprayHits = 0;
          if (sprays >= sc.bots) c.done = true;
        }
      };
      c.line = () => `Spray ${Math.min(sprays + 1, sc.bots)} of ${sc.bots}. Hold fire for 8 bullets or more.`;
    } else {
      c.killed = (b, zone, res, now) => place(now);
      c.line = () => `${run.kills} of ${sc.bots}`;
    }
    if (sc.kind === 'strafe') {
      // A hit counts only when the player was accurate as the bullet left.
      c.allowHit = (res) => res.accurate;
      c.line = () => `${run.kills} of ${sc.bots}${run.early ? `, ${run.early} fired while moving` : ''}`;
    }
    c.start = (now) => { run.bots = sc.bots; place(now); };
    return c;
  }

  // ── Calibration ──────────────────────────────────────────────────────────
  if (sc.kind === 'calibration') {
    const lane = eng.arena.lane;
    let turned = 0, laneStart = -1, laneTime = null, inLane = false, pz = eng.P.z;
    c.turn = (deg) => { turned += deg; };
    c.resetTurn = () => { turned = 0; };
    c.tick = (now) => {
      const P = eng.P;
      const inX = P.x > lane.x0 && P.x < lane.x1;
      if (inX && P.z <= lane.z0 && pz > lane.z0) { laneStart = now; laneTime = null; inLane = true; }
      if (inLane && inX && P.z <= lane.z1 && pz > lane.z1) { laneTime = now - laneStart; inLane = false; }
      if (!inX) inLane = false;
      pz = P.z;
    };
    c.calibration = () => {
      const top = M.topSpeed(N, eng.guns.weapon(), 'run');
      return { turned: Math.abs(turned), lane: laneTime, running: inLane ? eng.now - laneStart : null, expect: 20 / top, speed: top };
    };
    c.line = () => {
      const k = c.calibration();
      const lap = k.lane != null ? `Lane ${k.lane.toFixed(2)} s. At full speed the game takes ${k.expect.toFixed(2)} s.`
        : k.running != null ? `Lane ${k.running.toFixed(2)} s`
          : 'Run through the lane on the right at full speed.';
      return `Turned ${k.turned.toFixed(1)}° (reload resets). ${lap}`;
    };
    c.start = () => { run.bots = 0; };
    return c;
  }

  const arena = eng.arena;

  // ── The site: a pre-aim route ─────────────────────────────────────────────
  if (sc.kind === 'route') {
    c.start = (now) => {
      const spots = shuffle(arena.spots.slice()).slice(0, sc.bots);
      for (const s of spots) eng.bots.spawn({ x: s.x, y: s.y, z: s.z, yaw: s.yaw, stance: s.stance, hp: N.player.hp, ...base }, now);
      run.bots = spots.length;
    };
    c.killed = () => { if (run.kills >= run.bots) c.done = true; };
    c.line = () => `${run.kills} of ${run.bots} cleared`;
    return c;
  }

  // A bot that walks its plan out alive got away.
  let resolved = 0;
  const away = (bot) => { if (bot.alive) { run.missed = (run.missed || 0) + 1; eng.bots.remove(bot); resolved++; } };

  // ── The lane: hold the main ──────────────────────────────────────────────
  if (sc.kind === 'hold') {
    let spawned = 0, next = 1.0;
    const spawnOne = (now) => {
      const s = pick(arena.spots);
      let plan;
      if (s.id === 'choke') {
        const ox = rnd(-2.6, 2.6), oz = rnd(-36, -28);
        plan = { legs: [{ to: [rnd(-0.8, 0.8), -44], hold: 0 }, { to: [ox, oz], hold: rnd(0.6, 1.4) }, { to: [ox + rnd(-1.2, 1.2), oz + rnd(2, 5)], hold: 2.5 }], done: away };
      } else {
        plan = { legs: [{ to: s.out, hold: 2.2 }, { to: [s.x, s.z], hold: 0 }], done: away };
      }
      if (eng.bots.spawn({ x: s.x, y: 0, z: s.z, plan, hp: N.player.hp, ...base }, now)) spawned++;
    };
    c.start = () => { run.bots = sc.bots; };
    c.tick = (now) => {
      if (spawned < sc.bots && now >= next) { spawnOne(now); next = now + rnd(1.3, 2.6); }
      if (resolved >= sc.bots) c.done = true;
    };
    c.killed = () => { resolved++; };
    c.line = () => `${run.kills} of ${sc.bots}${run.missed ? `, ${run.missed} got away` : ''}`;
    return c;
  }

  // ── The stack: peeks on two levels ──────────────────────────────────────
  if (sc.kind === 'peek') {
    let spawned = 0, next = 1.0;
    const spawnOne = (now) => {
      const s = pick(arena.spots);
      const [fx, fz] = s.from, [tx, tz] = s.to;
      let legs;
      if (s.behave === 'jiggle') {
        legs = [];
        const n = 2 + ((Math.random() * 2) | 0);
        for (let i = 0; i < n; i++) { legs.push({ to: [tx, tz], hold: rnd(0.14, 0.38) }); legs.push({ to: [fx, fz], hold: rnd(0.3, 0.7) }); }
      } else if (s.behave === 'wide') {
        legs = [{ to: [tx, tz], hold: sc.botShoot ? 1.8 : 1.4 }, { to: [fx, fz], hold: 0 }];
      } else {
        legs = [{ to: [tx, tz], hold: rnd(0.25, 0.5) }, { to: [fx, fz], hold: rnd(0.25, 0.5) }, { to: [tx, tz], hold: 0.3 }, { to: [fx, fz], hold: 0 }];
      }
      if (eng.bots.spawn({ x: fx, y: s.y, z: fz, plan: { legs, done: away }, hp: N.player.hp, ...base }, now)) spawned++;
    };
    c.start = () => { run.bots = sc.bots; };
    c.tick = (now) => {
      let live = 0;
      for (const b of eng.bots.list) if (b.alive) live++;
      if (spawned < sc.bots && now >= next && live < 2) { spawnOne(now); next = now + rnd(0.6, 1.6); }
      if (resolved >= sc.bots) c.done = true;
    };
    c.killed = () => { resolved++; };
    c.line = () => `${run.kills} of ${sc.bots}${run.missed ? `, ${run.missed} got away` : ''}`;
    return c;
  }

  c.start = () => {};
  c.line = () => '';
  return c;
}

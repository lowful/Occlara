// THE BOTS (docs/claude/trainer.md, "Bots"). Our own figure, a training
// dummy in a dark suit with a pale head and a bright outline so it reads
// against any wall, built in code from a few shapes (kit.js) and drawn
// instanced: a body, a head, their outlines and a soft shadow, five draws
// in all however many bots are on the field. The hitboxes are the researched sizes
// (trainer-data.json hitbox), and hits are worked out analytically, a ray
// against a sphere and two upright capsules, never by picking the scene.
//
// They move the way the player does (trainer-math.js stepGround, the same
// acceleration and braking), so a strafing bot's stop takes the time a real
// stop takes. Shooting back (hard levels): a bot that has seen the player for
// its reaction time fires taps at its rate, each landing with its hit chance
// as it stands then: lower at first and further off, and only FIRING_MAX of
// them fire at once (scenarios.js says how it was tuned).
import * as THREE from './vendor/three.module.min.js';
import { at, between, dist, box, cyl, capsule, sphere, merge } from './kit.js';
import { SUN } from './world.js';

const M = window.OcclaraTrainerMath;
export const MAX_BOTS = 16;
const DIE_SEC = 0.26;
const FIRING_MAX = 2;

const SUIT = 0x2b303a, SUIT2 = 0x3a414d, SUIT3 = 0x20242c, PALE = 0xe4e7ed, VISOR = 0x1c2027;
export const OUTLINES = { yellow: 0xffd23f, red: 0xff5a4d, purple: 0xc77dff, cyan: 0x45e0e8 };

/** The figure's body, feet at the origin, facing -z. The head is its own mesh so a crouch never squashes it. */
function bodyGeometry() {
  const parts = [];
  const add = (g, c, m) => parts.push([g, c, m]);
  for (const s of [-1, 1]) {
    add(cyl(0.088, 0.062, 0.84, 10), SUIT, at(s * 0.095, 0.46, 0));                    // leg
    add(box(0.1, 0.07, 0.24), SUIT3, at(s * 0.095, 0.035, -0.04));                     // foot
    // The arms: shoulder to elbow, elbow to the hands in front of the chest.
    const sh = [s * 0.24, 1.4, 0], el = [s * 0.27, 1.12, -0.03], hd = [s * 0.05 + 0.07, 1.12, -0.27];
    add(capsule(0.052, dist(...sh, ...el) - 0.06, 8), SUIT, between(...sh, ...el));
    add(capsule(0.045, dist(...el, ...hd) - 0.05, 8), SUIT2, between(...el, ...hd));
  }
  add(cyl(0.15, 0.14, 0.17, 12), SUIT3, at(0, 0.93, 0, 0, 0, 0, 1, 1, 0.72));          // hips
  add(cyl(0.205, 0.15, 0.5, 12), SUIT2, at(0, 1.22, 0, 0, 0, 0, 1, 1, 0.64));          // torso
  add(capsule(0.075, 0.32, 8), SUIT, at(0, 1.42, 0, 0, 0, 90));                        // shoulders
  add(cyl(0.05, 0.058, 0.09, 10), SUIT3, at(0, 1.5, 0));                               // neck
  add(box(0.22, 0.05, 0.012), PALE, at(0, 1.3, -0.128));                               // chest mark
  add(box(0.05, 0.075, 0.46), SUIT3, at(0.07, 1.13, -0.36));                           // what it holds
  add(box(0.04, 0.11, 0.05), SUIT3, at(0.07, 1.07, -0.26));
  return merge(parts);
}
function headGeometry() {
  return merge([
    [sphere(0.118, 18, 14), PALE, at(0, 0, 0)],
    [box(0.19, 0.05, 0.07), VISOR, at(0, 0.012, -0.085)],
  ]);
}

/** A hull pushed out by a fixed number of pixels and drawn inside out: the outline. */
function outlineMaterial(res) {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide,
    uniforms: { uRes: { value: res }, uPx: { value: 2.0 } },
    vertexShader: /* glsl */`
      uniform vec2 uRes; uniform float uPx;
      varying vec3 vCol;
      void main() {
        vCol = instanceColor;
        mat4 im = instanceMatrix;
        vec4 mv = modelViewMatrix * im * vec4(position, 1.0);
        vec3 nv = normalize(normalMatrix * mat3(im) * normal);
        vec4 clip = projectionMatrix * mv;
        vec2 dir = nv.xy / max(length(nv.xy), 1e-4);
        clip.xy += dir * uPx * 2.0 / uRes * clip.w;
        gl_Position = clip;
      }`,
    fragmentShader: /* glsl */`
      varying vec3 vCol;
      void main() {
        gl_FragColor = vec4(vCol, 1.0);
        #include <colorspace_fragment>
      }`,
  });
}

export function createBots(N, scene) {
  const hb = N.hitbox;
  const res = new THREE.Vector2(1920, 1080);
  const lit = () => new THREE.MeshLambertMaterial({ vertexColors: true });
  const gBody = bodyGeometry(), gHead = headGeometry();
  const body = new THREE.InstancedMesh(gBody, lit(), MAX_BOTS);
  const head = new THREE.InstancedMesh(gHead, lit(), MAX_BOTS);
  const oMat = outlineMaterial(res);
  const bodyO = new THREE.InstancedMesh(gBody, oMat, MAX_BOTS);
  const headO = new THREE.InstancedMesh(gHead, oMat, MAX_BOTS);
  // The shadow under each: a quad whose darkness falls off from its middle.
  const gShade = new THREE.PlaneGeometry(1, 1);
  gShade.rotateX(-Math.PI / 2);
  const shade = new THREE.InstancedMesh(gShade, new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0); }',
    fragmentShader: 'varying vec2 vUv; void main() { float d = clamp(1.0 - length(vUv - 0.5) * 2.0, 0.0, 1.0); gl_FragColor = vec4(0.0, 0.0, 0.0, d * d * 0.55); }',
  }), MAX_BOTS);
  shade.renderOrder = 3;
  const meshes = [body, head, bodyO, headO, shade];
  const white = new THREE.Color(1, 1, 1);
  for (const m of meshes) {
    m.count = 0; m.frustumCulled = false;
    if (m !== shade) for (let i = 0; i < MAX_BOTS; i++) m.setColorAt(i, white);
    scene.add(m);
  }
  const sky = new THREE.HemisphereLight(0xc9d4e8, 0x5c5750, 2.3);
  const sun = new THREE.DirectionalLight(0xfff1dc, 1.7);
  sun.position.set(SUN[0], SUN[1], SUN[2]);
  scene.add(sky, sun);
  const outline = new THREE.Color(OUTLINES.yellow);

  const list = [];
  for (let i = 0; i < MAX_BOTS; i++) {
    list.push({
      i, active: false, alive: false, x: 0, y: 0, z: 0, px: 0, pz: 0, yaw: 0, crouch: 0,
      v: { x: 0, z: 0 }, wish: { x: 0, z: 0 }, hp: 100, armour: 0, god: false,
      plan: null, t: 0, seenAt: -1, firstHitAt: -1, visFor: 0, nextShot: 0, flash: 0, downAt: -1, dying: 0,
      spawnedAt: 0, shoot: false, reaction: 0.35, hitChance: 0.3, rate: 3,
    });
  }

  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s1 = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  const c = new THREE.Color();

  const scaleY = (b) => 1 - b.crouch * (1 - hb.crouchScale);

  /** One bot out where `a` says: { x, y, z, plan, hp, armour, shoot, ... }. */
  function spawn(a, now) {
    const b = list.find((x) => !x.active);
    if (!b) return null;
    Object.assign(b, {
      active: true, alive: true, x: a.x, y: a.y || 0, z: a.z, px: a.x, pz: a.z, yaw: a.yaw || 0,
      crouch: a.stance === 'crouch' ? 1 : 0, hp: a.hp || N.player.hp, armour: a.armour || 0, god: !!a.god,
      plan: a.plan || null, t: 0, seenAt: -1, firstHitAt: -1, visFor: 0, nextShot: 0, flash: 0, downAt: -1, dying: 0, firing: false,
      spawnedAt: now, shoot: !!a.shoot, reaction: a.reaction || 0.35, hitChance: a.hitChance || 0.3, rate: a.rate || 3,
    });
    b.v.x = 0; b.v.z = 0;
    return b;
  }
  function remove(b) { b.active = false; b.alive = false; }
  function clear() { for (const b of list) remove(b); }

  /**
   * The bot's movement for this tick. A plan is a list of legs, each
   * { to: [x, z], hold: seconds }, walked at the run speed with the player's
   * own acceleration and braking; `loop` repeats it, `done` is called when
   * the last leg is held.
   */
  function steer(b, dt) {
    const pl = b.plan;
    b.wish.x = 0; b.wish.z = 0;
    if (!pl || !pl.legs || !pl.legs.length) return;
    const leg = pl.legs[pl.i || 0];
    if (!leg) return;
    const dx = leg.to[0] - b.x, dz = leg.to[1] - b.z;
    const d = Math.hypot(dx, dz);
    const speed = Math.hypot(b.v.x, b.v.z);
    // The keys are let go early enough that braking stops on the mark.
    const brakeDist = (speed * speed) / (2 * Math.max(1, N.move.brakingDecel + N.move.friction * speed * 0.5));
    if (!pl.holding && d > Math.max(0.05, brakeDist)) { b.wish.x = dx / d; b.wish.z = dz / d; return; }
    if (!pl.holding) { pl.holding = true; pl.heldFor = 0; }
    pl.heldFor += dt;
    if (speed < 0.05 && pl.heldFor >= (leg.hold || 0)) {
      pl.holding = false;
      pl.i = (pl.i || 0) + 1;
      if (pl.i >= pl.legs.length) {
        if (pl.loop) pl.i = 0;
        else { const done = pl.done; pl.legs = null; if (done) done(b); }
      }
    }
  }

  /** One simulation tick: movement, facing the player, shooting back, and the fallen leaving. */
  function tick(now, dt, player, see, onShot) {
    const top = M.topSpeed(N, N.weapons['heavy-rifle'], 'run');
    let firing = 0;
    for (const b of list) { if (b.active && b.alive && b.firing) firing++; else b.firing = false; }
    for (const b of list) {
      if (!b.active) continue;
      b.px = b.x; b.pz = b.z;
      b.flash = Math.max(0, b.flash - dt * 9);
      if (!b.alive) {
        b.dying = Math.min(1, (now - b.downAt) / DIE_SEC);
        if (b.dying >= 1) remove(b);
        continue;
      }
      b.t += dt;
      steer(b, dt);
      if (!b.active) continue;      // it walked its plan out and was taken away
      M.stepGround(b.v, b.wish, top, N.move, dt);
      b.x += b.v.x * dt; b.z += b.v.z * dt;
      b.yaw = Math.atan2(-(player.x - b.x), -(player.z - b.z));
      if (!b.shoot) continue;
      if (see(b.x, b.y + hb.head.center * scaleY(b), b.z)) {
        b.visFor += dt;
        // Only FIRING_MAX of them fire at once; the rest hold, and one takes
        // over when a firing bot falls or loses sight of the player.
        if (!b.firing && b.visFor >= b.reaction && firing < FIRING_MAX) { b.firing = true; firing++; }
        if (b.firing && now >= b.nextShot) {
          b.nextShot = now + 1 / b.rate;
          // Its first taps mostly miss and it settles over a second and a
          // half of seeing the player; further off, fewer land.
          const far = Math.hypot(player.x - b.x, player.z - b.z);
          const settled = Math.max(0.35, Math.min(1, 0.35 + (b.visFor - b.reaction) / 1.5));
          onShot(b, Math.random() < b.hitChance * settled * Math.max(0.4, Math.min(1, 16 / Math.max(1, far))));
        }
      } else { b.visFor = 0; b.firing = false; }
    }
  }

  function raySphere(ox, oy, oz, dx, dy, dz, cx, cy, cz, r) {
    const lx = ox - cx, ly = oy - cy, lz = oz - cz;
    const bq = lx * dx + ly * dy + lz * dz;
    const disc = bq * bq - (lx * lx + ly * ly + lz * lz - r * r);
    if (disc < 0) return Infinity;
    const t = -bq - Math.sqrt(disc);
    return t >= 0 ? t : Infinity;
  }
  // A ray against an upright capsule whose axis runs from y0 to y1.
  function rayCapsule(ox, oy, oz, dx, dy, dz, cx, cz, y0, y1, r) {
    let best = Infinity;
    const a = dx * dx + dz * dz;
    if (a > 1e-12) {
      const lx = ox - cx, lz = oz - cz;
      const bq = lx * dx + lz * dz;
      const disc = bq * bq - a * (lx * lx + lz * lz - r * r);
      if (disc >= 0) {
        const t = (-bq - Math.sqrt(disc)) / a;
        const y = oy + dy * t;
        if (t >= 0 && y >= y0 && y <= y1) best = t;
      }
    }
    return Math.min(best, raySphere(ox, oy, oz, dx, dy, dz, cx, y0, cz, r), raySphere(ox, oy, oz, dx, dy, dz, cx, y1, cz, r));
  }

  /** The nearest bot part the ray meets before `maxD`: `out` filled and returned, or null. */
  function rayHit(ox, oy, oz, dx, dy, dz, maxD, out) {
    out.bot = null; out.t = maxD; out.zone = null;
    for (const b of list) {
      if (!b.alive) continue;
      const k = scaleY(b);
      const th = raySphere(ox, oy, oz, dx, dy, dz, b.x, b.y + hb.head.center * k, b.z, hb.head.radius);
      if (th < out.t) { out.t = th; out.bot = b; out.zone = 'head'; }
      const tb = rayCapsule(ox, oy, oz, dx, dy, dz, b.x, b.z, b.y + (hb.body.bottom + hb.body.radius) * k, b.y + (hb.body.top - hb.body.radius) * k, hb.body.radius);
      if (tb < out.t) { out.t = tb; out.bot = b; out.zone = 'body'; }
      const tl = rayCapsule(ox, oy, oz, dx, dy, dz, b.x, b.z, b.y + hb.legs.radius, b.y + Math.max(hb.legs.radius, (hb.legs.top - hb.legs.radius) * k), hb.legs.radius);
      if (tl < out.t) { out.t = tl; out.bot = b; out.zone = 'leg'; }
    }
    return out.bot ? out : null;
  }

  /** The instanced meshes laid out for this frame, `f` the share of a tick since the last one. */
  function draw(f) {
    let n = 0;
    for (const b of list) {
      if (!b.active) continue;
      const x = b.px + (b.x - b.px) * f, z = b.pz + (b.z - b.pz) * f;
      const k = scaleY(b);
      // Falling: it swells a little, then folds into the floor.
      const d = b.dying, e = d * d;
      const wide = 1 + 0.5 * d * (1 - d) * 2 - e * 0.9, tall = 1 - e;
      q.setFromAxisAngle(up, b.yaw);
      p.set(x, b.y, z); s1.set(wide, k * tall, wide);
      m4.compose(p, q, s1);
      body.setMatrixAt(n, m4); bodyO.setMatrixAt(n, m4);
      p.set(x, b.y + hb.head.center * k * tall, z); s1.set(wide, Math.max(0.02, tall), wide);
      m4.compose(p, q, s1);
      head.setMatrixAt(n, m4); headO.setMatrixAt(n, m4);
      const fl = 1 + b.flash * 2.2 + d * 3;
      c.setRGB(fl, fl, fl);
      body.setColorAt(n, c); head.setColorAt(n, c);
      c.copy(outline).lerp(white, Math.min(1, b.flash + d));
      bodyO.setColorAt(n, c); headO.setColorAt(n, c);
      q.identity(); p.set(x, b.y + 0.012, z); s1.set(1.15 * wide, 1, 1.15 * wide);
      m4.compose(p, q, s1);
      shade.setMatrixAt(n, m4);
      n++;
    }
    for (const m of meshes) {
      m.count = n;
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
  }

  return {
    list, spawn, remove, clear, tick, rayHit, draw, scaleY, meshes,
    setOutline(name) { outline.setHex(OUTLINES[name] || OUTLINES.yellow); },
    setResolution(w, h) { res.set(w, h); },
  };
}

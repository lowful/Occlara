// THE BOTS (docs/claude/trainer.md, "Bots"). A figure in plain dark tactical
// clothing and a helmet, aiming a rifle at the player, with a bright outline
// so it reads against any wall. The figure, its skeleton and its clips are
// made ahead of time from CC0 models (scripts/trainer-models/build.js,
// native/trainer-models-NOTICE.txt) and load from models/figure.js. Every
// bot on the field is one instance of one skinned mesh: the body, its outline
// and a soft shadow are three draws in all, however many bots there are.
//
// THE SKELETON. 22 bones. Each frame of a clip holds, for each bone, its turn
// from its parent and its place in its parent. A bot's pose is a blend of
// clips (standing or crouched and aiming, a run forward, back, left or right
// driven by its real speed, the fall when it is killed), worked out here on
// the CPU and written, one row a bot, into a small float texture the vertex
// shader skins from.
//
// The hitboxes are the researched sizes (trainer-data.json hitbox), and hits
// are worked out analytically, a ray against a sphere and two upright
// capsules, never by picking the scene. The figure is sized so its helmet
// stands where the head's sphere is, standing and crouched.
//
// They move the way the player does (trainer-math.js stepGround, the same
// acceleration and braking), so a strafing bot's stop takes the time a real
// stop takes. Shooting back (hard levels): a bot that has seen the player for
// its reaction time fires taps at its rate, each landing with its hit chance
// as it stands then: lower at first and further off, and only FIRING_MAX of
// them fire at once (scenarios.js says how it was tuned).
import * as THREE from './vendor/three.module.min.js';
import { unpack, floats, LIT, litUniforms, LIGHT } from './kit.js';
import { SUN } from './world.js';
import { FIGURE } from './models/figure.js';

const M = window.OcclaraTrainerMath;
export const MAX_BOTS = 16;
// A bot killed falls for FALL_SEC, lies, and from LIE_SEC sinks into the
// floor; at DIE_SEC it is taken away.
const FALL_SEC = 0.42, LIE_SEC = 0.6, DIE_SEC = 0.85;
const FIRING_MAX = 2;

export const OUTLINES = { yellow: 0xffd23f, red: 0xff5a4d, purple: 0xc77dff, cyan: 0x45e0e8 };

// ── The skeleton and its clips ─────────────────────────────────────────────
const NB = FIGURE.bones.parent.length;
const PARENT = FIGURE.bones.parent;
const BIND = new Float32Array(NB * 3);
FIGURE.bones.bind.forEach((v, i) => { BIND[i * 3] = v[0]; BIND[i * 3 + 1] = v[1]; BIND[i * 3 + 2] = v[2]; });
const POSES = floats(FIGURE.poses);       // frames x bones x (turn xyzw, place xyz)
const STRIDE = NB * 7;
const CLIP = FIGURE.clips;
const RUNS = [CLIP.runF, CLIP.runB, CLIP.runL, CLIP.runR];
// How far a bot runs in one turn of its run clip: the clip's own time at the
// run speed it was drawn for, a little short so the feet look quick, not floaty.
const RUN_LEN = 3.6;
// The bone the aim leans from, up or down to where the player is, and the height it is judged from.
const CHEST = FIGURE.bones.names.indexOf('Chest');
const AIM_FROM = 1.38, AIM_MAX = 0.7;

const SKIN = /* glsl */`
attribute vec4 aJoint; attribute vec4 aWeight;
uniform highp sampler2D uBones;
vec3 turn(vec4 q, vec3 v) { return v + 2.0 * cross(q.xyz, cross(q.xyz, v) + q.w * v); }
// The point and its normal carried by up to four bones: this bot's row of the texture, two texels a bone.
void bone(float joint, float w, vec3 p, vec3 n, inout vec3 sp, inout vec3 sn) {
  if (w <= 0.0) return;
  int j = int(joint + 0.5) * 2;
  vec4 q = texelFetch(uBones, ivec2(j, gl_InstanceID), 0);
  vec3 o = texelFetch(uBones, ivec2(j + 1, gl_InstanceID), 0).xyz;
  sp += w * (turn(q, p) + o);
  sn += w * turn(q, n);
}
void skin(in vec3 p, in vec3 n, out vec3 sp, out vec3 sn) {
  sp = vec3(0.0); sn = vec3(0.0);
  bone(aJoint.x, aWeight.x, p, n, sp, sn);
  bone(aJoint.y, aWeight.y, p, n, sp, sn);
  bone(aJoint.z, aWeight.z, p, n, sp, sn);
  bone(aJoint.w, aWeight.w, p, n, sp, sn);
}`;

const BODY_VERT = /* glsl */`
${SKIN}
attribute vec4 aCol;
varying vec3 vCol; varying float vGloss; varying vec3 vN; varying vec3 vW; varying float vDist; varying float vHit;
void main() {
  vCol = pow(aCol.rgb, vec3(2.2)); vGloss = aCol.a; vHit = instanceColor.r;
  vec3 p; vec3 n;
  skin(position, normal, p, n);
  vec4 w = modelMatrix * instanceMatrix * vec4(p, 1.0);
  vW = w.xyz;
  vN = mat3(instanceMatrix) * n;
  vec4 mv = viewMatrix * w;
  vDist = -mv.z;
  gl_Position = projectionMatrix * mv;
}`;
const BODY_FRAG = /* glsl */`
${LIT}
uniform vec3 uHaze; uniform float uHazeNear; uniform float uHazeFar;
varying vec3 vCol; varying float vGloss; varying vec3 vN; varying vec3 vW; varying float vDist; varying float vHit;
void main() {
  vec3 col = lit(vCol, vGloss, normalize(vN), normalize(cameraPosition - vW));
  col = mix(col, vec3(1.0), vHit * 0.8);          // hit: it flashes white for a moment
  col = mix(col, uHaze, smoothstep(uHazeNear, uHazeFar, vDist) * 0.92);
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`;

/** The same skinned hull pushed out by a fixed number of pixels and drawn inside out: the outline. */
function outlineMaterial(res, bones) {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide,
    uniforms: { uRes: { value: res }, uPx: { value: 2.0 }, uBones: { value: bones } },
    vertexShader: /* glsl */`
      ${SKIN}
      attribute vec3 aSmooth;
      uniform vec2 uRes; uniform float uPx;
      varying vec3 vCol;
      void main() {
        vCol = instanceColor;
        vec3 p; vec3 n;
        skin(position, aSmooth, p, n);
        mat4 im = instanceMatrix;
        vec4 mv = modelViewMatrix * im * vec4(p, 1.0);
        vec3 nv = normalize(normalMatrix * mat3(im) * n);
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
  // One row a bot, two texels a bone: its turn, and where that turn leaves its origin.
  const boneData = new Float32Array(MAX_BOTS * NB * 8);
  const boneTex = new THREE.DataTexture(boneData, NB * 2, MAX_BOTS, THREE.RGBAFormat, THREE.FloatType);
  boneTex.needsUpdate = true;
  const geo = unpack(FIGURE.mesh);
  const bodyMat = new THREE.ShaderMaterial({
    vertexShader: BODY_VERT, fragmentShader: BODY_FRAG,
    uniforms: {
      ...litUniforms(), uBones: { value: boneTex },
      uHaze: { value: new THREE.Color(LIGHT.haze) }, uHazeNear: { value: LIGHT.hazeNear }, uHazeFar: { value: LIGHT.hazeFar },
    },
  });
  bodyMat.uniforms.uSun.value.set(SUN[0], SUN[1], SUN[2]).normalize();
  const body = new THREE.InstancedMesh(geo, bodyMat, MAX_BOTS);
  const bodyO = new THREE.InstancedMesh(geo, outlineMaterial(res, boneTex), MAX_BOTS);
  bodyO.instanceMatrix = body.instanceMatrix;      // the same places: one upload
  // The shadow under each: a quad whose darkness falls off from its middle.
  const gShade = new THREE.PlaneGeometry(1, 1);
  gShade.rotateX(-Math.PI / 2);
  const shade = new THREE.InstancedMesh(gShade, new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0); }',
    fragmentShader: 'varying vec2 vUv; void main() { float d = clamp(1.0 - length(vUv - 0.5) * 2.0, 0.0, 1.0); gl_FragColor = vec4(0.0, 0.0, 0.0, d * d * 0.55); }',
  }), MAX_BOTS);
  shade.renderOrder = 3;
  const meshes = [body, bodyO, shade];
  const white = new THREE.Color(1, 1, 1);
  for (const m of meshes) {
    m.count = 0; m.frustumCulled = false;
    if (m !== shade) for (let i = 0; i < MAX_BOTS; i++) m.setColorAt(i, white);
    scene.add(m);
  }
  const outline = new THREE.Color(OUTLINES.yellow);

  const list = [];
  for (let i = 0; i < MAX_BOTS; i++) {
    list.push({
      i, active: false, alive: false, x: 0, y: 0, z: 0, px: 0, pz: 0, yaw: 0, crouch: 0,
      v: { x: 0, z: 0 }, wish: { x: 0, z: 0 }, hp: 100, armour: 0, god: false,
      plan: null, t: 0, seenAt: -1, firstHitAt: -1, visFor: 0, nextShot: 0, flash: 0, downAt: -1, dying: 0, pdying: 0,
      spawnedAt: 0, shoot: false, reaction: 0.35, hitChance: 0.3, rate: 3,
      run: new Float32Array(4), phase: 0, pphase: 0,      // how much of each run clip, and where in its turn
      pitch: 0,                                           // how far up or down it aims, radians
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
      plan: a.plan || null, t: 0, seenAt: -1, firstHitAt: -1, visFor: 0, nextShot: 0, flash: 0, downAt: -1, dying: 0, pdying: 0, firing: false,
      spawnedAt: now, shoot: !!a.shoot, reaction: a.reaction || 0.35, hitChance: a.hitChance || 0.3, rate: a.rate || 3,
      phase: 0, pphase: 0, pitch: 0,
      dmg: a.dmg || 0, dmgFar: a.dmgFar || 0, farFrom: a.farFrom || 0,
    });
    b.v.x = 0; b.v.z = 0;
    b.run.fill(0);
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

  /**
   * Which run a bot's legs show, from how it really moves: the clip for the
   * way it goes as it faces (ahead, back, left or right) eased in by its
   * speed, and the clip turned on by the ground it covers.
   */
  function stride(b, dt) {
    const speed = Math.hypot(b.v.x, b.v.z);
    const sy = Math.sin(b.yaw), cy = Math.cos(b.yaw);
    const ahead = -sy * b.v.x - cy * b.v.z, right = cy * b.v.x - sy * b.v.z;
    const want = Math.max(0, Math.min(1, (speed - 0.25) / 1.6));
    const way = Math.abs(right) >= Math.abs(ahead) ? (right > 0 ? 3 : 2) : (ahead > 0 ? 0 : 1);
    const k = Math.min(1, dt * 14);
    for (let i = 0; i < 4; i++) b.run[i] += ((i === way ? want : 0) - b.run[i]) * k;
    b.pphase = b.phase;
    b.phase += (speed * dt) / RUN_LEN;
    if (b.phase > 64) { b.phase -= 64; b.pphase -= 64; }
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
        b.pdying = b.dying;
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
      stride(b, dt);
      // Up or down to the player's eye: the chest, the head and the rifle lean to it.
      const rise = player.y + N.player.eyeStand - N.player.crouchDrop * (player.crouch || 0) - (b.y + AIM_FROM * scaleY(b));
      const aim = Math.atan2(rise, Math.max(0.5, Math.hypot(player.x - b.x, player.z - b.z)));
      b.pitch += (Math.max(-AIM_MAX, Math.min(AIM_MAX, aim)) - b.pitch) * Math.min(1, dt * 10);
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

  // ── A bot's pose ─────────────────────────────────────────────────────────
  // The blend is gathered bone by bone as turns and places in the parent,
  // then walked down the tree. Nothing is made here: every array is kept.
  const acc = new Float32Array(NB * 7);       // the blend so far
  const wq = new Float32Array(NB * 4);        // each bone's turn in the figure's space
  const wc = new Float32Array(NB * 3);        // and where its joint is
  let accN = 0;

  /** A clip added to the blend: `u` is how far through it (0 to 1), `w` its share. */
  function blend(clip, u, w) {
    if (w <= 1e-4) return;
    const n = clip.frames;
    let at = clip.loop ? (u - Math.floor(u)) * n : Math.max(0, Math.min(1, u)) * (n - 1);
    let i0 = Math.floor(at);
    if (i0 >= n) i0 = n - 1;
    const f = at - i0;
    const i1 = clip.loop ? (i0 + 1) % n : Math.min(n - 1, i0 + 1);
    const a = (clip.at + i0) * STRIDE, b = (clip.at + i1) * STRIDE;
    for (let k = 0; k < NB; k++) {
      const o = k * 7;
      let x0 = POSES[a + o], y0 = POSES[a + o + 1], z0 = POSES[a + o + 2], w0 = POSES[a + o + 3];
      let x1 = POSES[b + o], y1 = POSES[b + o + 1], z1 = POSES[b + o + 2], w1 = POSES[b + o + 3];
      if (x0 * x1 + y0 * y1 + z0 * z1 + w0 * w1 < 0) { x1 = -x1; y1 = -y1; z1 = -z1; w1 = -w1; }
      x0 += (x1 - x0) * f; y0 += (y1 - y0) * f; z0 += (z1 - z0) * f; w0 += (w1 - w0) * f;
      // The same side of the sphere as what is gathered already, so turns add and never cancel.
      let s = w;
      if (accN && acc[o] * x0 + acc[o + 1] * y0 + acc[o + 2] * z0 + acc[o + 3] * w0 < 0) s = -w;
      acc[o] += x0 * s; acc[o + 1] += y0 * s; acc[o + 2] += z0 * s; acc[o + 3] += w0 * s;
      acc[o + 4] += (POSES[a + o + 4] + (POSES[b + o + 4] - POSES[a + o + 4]) * f) * w;
      acc[o + 5] += (POSES[a + o + 5] + (POSES[b + o + 5] - POSES[a + o + 5]) * f) * w;
      acc[o + 6] += (POSES[a + o + 6] + (POSES[b + o + 6] - POSES[a + o + 6]) * f) * w;
    }
    accN++;
  }

  /** The blend walked down the tree and written to the bot's row of the texture, the chest leant `pitch` up. */
  function settle(row, pitch) {
    const ps = Math.sin(pitch / 2), pc = Math.cos(pitch / 2);
    const out = row * NB * 8;
    for (let k = 0; k < NB; k++) {
      const o = k * 7;
      let x = acc[o], y = acc[o + 1], z = acc[o + 2], w = acc[o + 3];
      const l = Math.hypot(x, y, z, w) || 1;
      x /= l; y /= l; z /= l; w /= l;
      let lx = acc[o + 4], ly = acc[o + 5], lz = acc[o + 6];
      const par = PARENT[k];
      if (par >= 0) {
        const px = wq[par * 4], py = wq[par * 4 + 1], pz = wq[par * 4 + 2], pw = wq[par * 4 + 3];
        // The place turned by the parent, then the parent's turn times this one.
        const tx = 2 * (py * lz - pz * ly), ty = 2 * (pz * lx - px * lz), tz = 2 * (px * ly - py * lx);
        lx += pw * tx + (py * tz - pz * ty) + wc[par * 3];
        ly += pw * ty + (pz * tx - px * tz) + wc[par * 3 + 1];
        lz += pw * tz + (px * ty - py * tx) + wc[par * 3 + 2];
        const qx = pw * x + px * w + py * z - pz * y, qy = pw * y - px * z + py * w + pz * x, qz = pw * z + px * y - py * x + pz * w, qw = pw * w - px * x - py * y - pz * z;
        x = qx; y = qy; z = qz; w = qw;
      }
      if (k === CHEST && pitch) {
        // Turned about the figure's own right, in its space: everything above the chest follows.
        const qx = pc * x + ps * w, qy = pc * y - ps * z, qz = pc * z + ps * y, qw = pc * w - ps * x;
        x = qx; y = qy; z = qz; w = qw;
      }
      wq[k * 4] = x; wq[k * 4 + 1] = y; wq[k * 4 + 2] = z; wq[k * 4 + 3] = w;
      wc[k * 3] = lx; wc[k * 3 + 1] = ly; wc[k * 3 + 2] = lz;
      // What the shader needs: the turn, and the joint's place less its bind place turned.
      const bx = BIND[k * 3], by = BIND[k * 3 + 1], bz = BIND[k * 3 + 2];
      const tx = 2 * (y * bz - z * by), ty = 2 * (z * bx - x * bz), tz = 2 * (x * by - y * bx);
      const t = out + k * 8;
      boneData[t] = x; boneData[t + 1] = y; boneData[t + 2] = z; boneData[t + 3] = w;
      boneData[t + 4] = lx - (bx + w * tx + (y * tz - z * ty));
      boneData[t + 5] = ly - (by + w * ty + (z * tx - x * tz));
      boneData[t + 6] = lz - (bz + w * tz + (x * ty - y * tx));
    }
  }

  /** The instanced meshes laid out for this frame, `f` the share of a tick since the last one. */
  function draw(f) {
    let n = 0;
    for (const b of list) {
      if (!b.active) continue;
      const x = b.px + (b.x - b.px) * f, z = b.pz + (b.z - b.pz) * f;
      // Killed: it falls where it stood, lies, then sinks into the floor.
      const d = b.alive ? 0 : b.pdying + (b.dying - b.pdying) * f;
      const down = d * DIE_SEC;
      const sink = down > LIE_SEC ? (down - LIE_SEC) / (DIE_SEC - LIE_SEC) : 0;
      q.setFromAxisAngle(up, b.yaw);
      p.set(x, b.y - sink * sink * 0.5, z); s1.set(1, 1, 1);
      m4.compose(p, q, s1);
      body.setMatrixAt(n, m4);
      // The pose: aiming, standing or crouched, with the run its speed calls for; or the fall.
      acc.fill(0); accN = 0;
      const fall = b.alive ? 0 : Math.min(1, down / 0.07);
      const run = b.run[0] + b.run[1] + b.run[2] + b.run[3];
      const still = Math.max(0, 1 - run) * (1 - fall);
      const breath = (b.t + b.i * 0.37) / CLIP.aim.seconds;
      blend(CLIP.aim, breath, still * (1 - b.crouch));
      blend(CLIP.crouch, breath, still * b.crouch);
      if (run > 1e-4) {
        const ph = b.pphase + (b.phase - b.pphase) * f;
        for (let i = 0; i < 4; i++) blend(RUNS[i], ph, b.run[i] * (1 - fall));
      }
      blend(CLIP.fall, down / FALL_SEC, fall);
      settle(n, b.pitch * (1 - fall));
      c.setRGB(Math.min(1, b.flash + (b.alive ? 0 : 0.1 * (1 - sink))), 0, 0);
      body.setColorAt(n, c);
      c.copy(outline).lerp(white, Math.min(1, b.flash + d * 1.4));
      bodyO.setColorAt(n, c);
      const wide = 1.15 * (1 - sink) * (b.alive ? 1 : 1 + Math.min(1, down / FALL_SEC) * 0.5);
      q.identity(); p.set(x, b.y + 0.012, z); s1.set(wide, 1, wide);
      m4.compose(p, q, s1);
      shade.setMatrixAt(n, m4);
      n++;
    }
    for (const m of meshes) {
      m.count = n;
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
    if (n) boneTex.needsUpdate = true;
  }

  return {
    list, spawn, remove, clear, tick, rayHit, draw, scaleY, meshes,
    setOutline(name) { outline.setHex(OUTLINES[name] || OUTLINES.yellow); },
    setResolution(w, h) { res.set(w, h); },
  };
}

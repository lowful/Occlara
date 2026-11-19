// THE ENGINE (docs/claude/trainer.md, "The loop"). One WebGL renderer, the
// arena and bots in one scene, the gun in its own over it.
//
// THE LOOP. The simulation steps at a fixed 128 Hz (Valorant's tick rate,
// trainer-data.json tick); rendering runs every animation frame and draws the
// player and the bots between their last two ticks. Mouse look is applied on
// every mouse event, never per tick, so a turn reaches the next frame drawn.
// The per tick state (the player, the bots, the hit and its result, every
// vector and matrix) is made once and reused; what is still made fresh is
// small and per event, a shot's own record and the nodes of a sound played.
// The loop runs only while a run is played: it stops when the page leaves, hides, loses focus or the pointer
// lock goes (a covered view gets no frames anyway, main-window.js). The menu
// shows one still frame of an arena, drawn once.
import * as THREE from './vendor/three.module.min.js';
import { buildArena, disposeArena, rayWorld, buildSky, setDetail } from './world.js';
import { createBots } from './bots.js';
import { createGuns } from './gun.js';

const M = window.OcclaraTrainerMath;
const DEG = Math.PI / 180;
// What a bot that shoots back hits with: the light pistol's damage, so a
// player caught in the open is hurt and slowed, not deleted.
const BOT_GUN = 'sidearm';
const HURT_GAP = 0.6;

export function createEngine({ canvas, N, audio, hooks }) {
  const TICK = 1 / N.tick;
  // desynchronized lets Chromium show a frame without waiting on the compositor.
  const gl = canvas.getContext('webgl2', { antialias: true, alpha: false, desynchronized: true, powerPreference: 'high-performance', preserveDrawingBuffer: false });
  if (!gl) throw new Error('no WebGL2');
  const renderer = new THREE.WebGLRenderer({ canvas, context: gl, antialias: true });
  renderer.autoClear = false;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0x8494ad, 1);
  const scene = new THREE.Scene();
  scene.add(buildSky());
  const camera = new THREE.PerspectiveCamera(70.53, 16 / 9, 0.03, 600);
  camera.rotation.order = 'YXZ';
  const vmCamera = new THREE.PerspectiveCamera(62, 16 / 9, 0.01, 5);
  const bots = createBots(N, scene);

  // Tracers, bullet marks and the puff where a bullet lands: all pooled.
  const TRACERS = 16;
  const trGeo = new THREE.BufferGeometry();
  const trPos = new Float32Array(TRACERS * 6);
  trGeo.setAttribute('position', new THREE.BufferAttribute(trPos, 3));
  const trLife = new Float32Array(TRACERS);
  const tracers = new THREE.LineSegments(trGeo, new THREE.LineBasicMaterial({ color: 0xfff0cf, transparent: true, opacity: 0.5, depthWrite: false }));
  tracers.frustumCulled = false;
  scene.add(tracers);
  let trNext = 0;
  const MARKS = 200;
  const marks = new THREE.InstancedMesh(new THREE.CircleGeometry(0.022, 8), new THREE.MeshBasicMaterial({ color: 0x14161b, transparent: true, opacity: 0.8, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }), MARKS);
  marks.count = 0; marks.frustumCulled = false; marks.renderOrder = 4;
  scene.add(marks);
  let markNext = 0;
  const PUFFS = 12;
  const puffMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */`
      varying vec2 vUv; varying vec3 vC;
      void main() {
        vUv = uv; vC = instanceColor;
        vec4 mv = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        float s = length(instanceMatrix[0].xyz);
        mv.xy += position.xy * s;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      varying vec2 vUv; varying vec3 vC;
      void main() {
        float d = length(vUv - 0.5) * 2.0;
        float ring = smoothstep(1.0, 0.72, d) * smoothstep(0.2, 0.62, d) + pow(max(0.0, 1.0 - d), 3.0);
        gl_FragColor = vec4(vC * ring, ring);
      }`,
  });
  const puffs = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), puffMat, PUFFS);
  puffs.frustumCulled = false; puffs.renderOrder = 5;
  const puffLife = new Float32Array(PUFFS), puffPos = new Float32Array(PUFFS * 3), puffKind = new Uint8Array(PUFFS);
  for (let i = 0; i < PUFFS; i++) puffs.setColorAt(i, new THREE.Color(0, 0, 0));
  scene.add(puffs);
  let puffNext = 0;

  let arena = null;
  let arenaKey = '';
  let guns = null;
  let settings = M.normaliseSettings(null);
  let degPer = M.degPerCount(N, settings.sens);
  let previewing = null;      // { pos, look, fov } while the menu shows a still

  // ── The player ───────────────────────────────────────────────────────────
  const P = {
    x: 0, y: 0, z: 0, px: 0, py: 0, pz: 0, v: { x: 0, z: 0 }, vy: 0, ground: true, crouch: 0, pcrouch: 0,
    yaw: 0, pitch: 0, hp: 100, armour: 0, landedAt: -10, tagUntil: 0, stepAcc: 0, dead: false, stopFrom: -1,
  };
  const keys = new Set();
  let jumpQueued = false;
  const wish = { x: 0, z: 0 };
  const move = { speed: 0, air: false, crouch: false, walk: false, ads: false, landing: 10 };
  const state = { playing: false, now: 0, acc: 0, last: 0, frame: 0, ft: new Float32Array(1200), ftN: 0 };

  // ── Input ────────────────────────────────────────────────────────────────
  const bound = (code) => {
    const b = settings.binds;
    for (const a in b) if (b[a] === code) return a;
    return null;
  };
  function onMove(e) {
    if (!state.playing || document.pointerLockElement !== canvas) return;
    const z = guns ? guns.zoom() : 1;
    const d = z > 1 ? M.degPerCount(N, settings.sens, { zoom: z, multiplier: settings.scoped }) : degPer;
    P.yaw -= e.movementX * d * DEG;
    P.pitch -= e.movementY * d * (N.sens.pitchPerCount / N.sens.yawPerCount) * DEG;
    const lim = N.sens.pitchMax * DEG;
    if (P.pitch > lim) P.pitch = lim; else if (P.pitch < -lim) P.pitch = -lim;
    if (hooks.turned) hooks.turned(e.movementX * d);
  }
  function action(a, down) {
    if (!state.playing || !down) return;
    if (a === 'jump') jumpQueued = true;
    else if (a === 'reload') guns.reload(state.now);
    else if ((a === 'primary' || a === 'secondary' || a === 'knife') && guns.equip(a, state.now)) audio.play('equip', 0, 0.7);
  }
  function onKey(e, down) {
    const a = bound(e.code);
    if (!a) return;
    if (state.playing) e.preventDefault();
    if (down) { if (keys.has(a)) return; keys.add(a); } else keys.delete(a);
    action(a, down);
  }
  function onMouse(e, down) {
    if (!state.playing || document.pointerLockElement !== canvas) return;
    if (e.button === 0) guns.setTrigger(down, state.now);
    else if (e.button === 2) guns.setAlt(down);
    else { const a = bound(`Mouse${e.button + 1}`); if (a) { if (down) keys.add(a); else keys.delete(a); action(a, down); } }
  }
  const kd = (e) => onKey(e, true), ku = (e) => onKey(e, false);
  const md = (e) => onMouse(e, true), mu = (e) => onMouse(e, false);
  const noMenu = (e) => e.preventDefault();
  document.addEventListener('mousemove', onMove);
  document.addEventListener('keydown', kd);
  document.addEventListener('keyup', ku);
  document.addEventListener('mousedown', md);
  document.addEventListener('mouseup', mu);
  canvas.addEventListener('contextmenu', noMenu);

  // ── Collision ────────────────────────────────────────────────────────────
  const R = N.player.radius;
  const height = () => N.player.height - (N.player.height - N.player.crouchHeight) * P.crouch;
  function overlaps(x, y, z, h) {
    const s = arena.solids;
    for (let i = 0; i < s.length; i++) {
      const b = s[i];
      if (x + R > b.min[0] && x - R < b.max[0] && z + R > b.min[2] && z - R < b.max[2] && y + h > b.min[1] + 1e-4 && y < b.max[1] - 1e-4) return b;
    }
    return null;
  }
  /** The player moved along one axis, stepping up a ledge no taller than stepHeight. */
  function slide(axis, d) {
    if (d === 0) return;
    const h = height();
    const nx = axis === 0 ? P.x + d : P.x, nz = axis === 2 ? P.z + d : P.z;
    const hit = overlaps(nx, P.y, nz, h);
    if (!hit) { if (axis === 0) P.x = nx; else P.z = nz; return; }
    const rise = hit.max[1] - P.y;
    if (P.ground && rise > 0 && rise <= N.player.stepHeight && !overlaps(nx, hit.max[1], nz, h)) {
      P.y = hit.max[1];
      if (axis === 0) P.x = nx; else P.z = nz;
      return;
    }
    if (axis === 0) { P.x = d > 0 ? hit.min[0] - R - 1e-4 : hit.max[0] + R + 1e-4; P.v.x = 0; }
    else { P.z = d > 0 ? hit.min[2] - R - 1e-4 : hit.max[2] + R + 1e-4; P.v.z = 0; }
  }
  function groundBelow(maxDrop) {
    let top = -Infinity;
    const s = arena.solids;
    for (let i = 0; i < s.length; i++) {
      const b = s[i];
      if (P.x + R > b.min[0] && P.x - R < b.max[0] && P.z + R > b.min[2] && P.z - R < b.max[2] && b.max[1] <= P.y + 1e-3 && b.max[1] >= P.y - maxDrop && b.max[1] > top) top = b.max[1];
    }
    return top;
  }

  // ── One tick ─────────────────────────────────────────────────────────────
  const hitOut = { bot: null, t: 0, zone: null };
  const res = { hit: false, zone: null, bot: null, first: false, accurate: false, shot: 0, dist: 0, counted: true, kill: false, emptied: false };
  let wasReloading = false;

  function tick() {
    const now = state.now;
    P.px = P.x; P.py = P.y; P.pz = P.z; P.pcrouch = P.crouch;
    const w = guns.weapon();
    const ads = guns.zoom() > 1;
    // Crouching takes its measured time either way.
    const wantCrouch = keys.has('crouch');
    const cstep = TICK / N.move.crouchTime;
    P.crouch = wantCrouch ? Math.min(1, P.crouch + cstep) : Math.max(0, P.crouch - cstep);
    if (!wantCrouch && P.crouch > 0 && overlaps(P.x, P.y, P.z, height() + 0.02)) P.crouch = Math.min(1, P.crouch + cstep);
    const mode = P.crouch > 0.5 ? 'crouch' : keys.has('walk') ? 'walk' : 'run';
    let top = M.topSpeed(N, w, mode, ads);
    if (now < P.tagUntil) top *= 1 - N.move.tagSlow;
    // The wished direction in the world, from the keys and the yaw.
    const f = (keys.has('forward') ? 1 : 0) - (keys.has('back') ? 1 : 0);
    const r = (keys.has('right') ? 1 : 0) - (keys.has('left') ? 1 : 0);
    const sy = Math.sin(P.yaw), cy = Math.cos(P.yaw);
    wish.x = -sy * f + cy * r;
    wish.z = -cy * f - sy * r;
    const wl = Math.hypot(wish.x, wish.z);
    if (wl > 0) { wish.x /= wl; wish.z /= wl; }
    const before = Math.hypot(P.v.x, P.v.z);
    if (P.ground) M.stepGround(P.v, wish, top, N.move, TICK); else M.stepAir(P.v, wish, top, N.move, TICK);
    const speed = Math.hypot(P.v.x, P.v.z);
    // The stop: from letting go, or pressing against the motion, near full
    // speed, to under the accuracy gate.
    const runTop = M.topSpeed(N, w, 'run', ads);
    const gate = runTop * N.move.accurateFrac;
    if (P.stopFrom < 0 && P.ground && before >= runTop * 0.9 && (wl === 0 || P.v.x * wish.x + P.v.z * wish.z < 0)) P.stopFrom = now;
    if (P.stopFrom >= 0 && speed <= gate) { if (hooks.stopped) hooks.stopped((now - P.stopFrom + TICK) * 1000); P.stopFrom = -1; }
    if (P.stopFrom >= 0 && speed > before + 1e-6) P.stopFrom = -1;
    // Jump and gravity.
    if (jumpQueued && P.ground && P.crouch < 0.5) { P.vy = M.jumpSpeed(N); P.ground = false; }
    jumpQueued = false;
    if (!P.ground) P.vy -= N.move.gravity * TICK;
    slide(0, P.v.x * TICK);
    slide(2, P.v.z * TICK);
    if (!P.ground) {
      const ny = P.y + P.vy * TICK;
      const h = height();
      const hit = overlaps(P.x, ny, P.z, h);
      if (hit && P.vy <= 0) { P.y = hit.max[1]; P.landedAt = now; audio.play('land', 0, 0.6); P.vy = 0; P.ground = true; }
      else if (hit) { P.y = hit.min[1] - h - 1e-4; P.vy = 0; }
      else P.y = ny;
    } else {
      // Off a ledge: down a step stays on the ground, further is a fall.
      const g = groundBelow(N.player.stepHeight);
      if (g === -Infinity) P.ground = false; else P.y = g;
    }
    const bd = arena.bounds;
    if (P.x < bd.min[0] + R) { P.x = bd.min[0] + R; P.v.x = 0; } else if (P.x > bd.max[0] - R) { P.x = bd.max[0] - R; P.v.x = 0; }
    if (P.z < bd.min[2] + R) { P.z = bd.min[2] + R; P.v.z = 0; } else if (P.z > bd.max[2] - R) { P.z = bd.max[2] - R; P.v.z = 0; }
    if (P.y < -5) { P.y = arena.start.y; P.vy = 0; P.ground = true; }
    // Footsteps: running only. Walking and crouching are silent, as in the game.
    if (P.ground && mode === 'run' && speed > runTop * 0.62) {
      P.stepAcc += speed * TICK;
      if (P.stepAcc > 2.2) { P.stepAcc = 0; audio.play(`step-${1 + ((now * 997) | 0) % 3}`, 0, 0.45); }
    } else if (speed < 0.5) P.stepAcc = 1.4;
    move.speed = speed; move.air = !P.ground; move.crouch = P.crouch > 0.5; move.walk = mode === 'walk'; move.ads = ads;
    move.landing = now - P.landedAt;
    // The gun.
    const shot = guns.fire(now, move);
    if (shot && shot.dry) audio.play('dry', 0, 0.6);
    else if (shot) shoot(shot, w);
    const rl = guns.reloading();
    if (rl && !wasReloading) audio.play('reload', 0.1, 0.75, guns.cur().long ? 1 : 1.2);
    wasReloading = rl;
    guns.recover(now, TICK);
    bots.tick(now, TICK, P, canSee, botShot);
    if (hooks.tick) hooks.tick(now, TICK);
  }

  // ── Shooting ─────────────────────────────────────────────────────────────
  const eye = { x: 0, y: 0, z: 0 };
  function eyeAt() { eye.x = P.x; eye.z = P.z; eye.y = P.y + N.player.eyeStand - N.player.crouchDrop * P.crouch; return eye; }
  const dir = new THREE.Vector3(), eul = new THREE.Euler(0, 0, 0, 'YXZ');
  function shoot(shot, w) {
    eyeAt();
    eul.set(P.pitch + shot.pitch * DEG, P.yaw - shot.yaw * DEG, 0, 'YXZ');
    dir.set(0, 0, -1).applyEuler(eul);
    const wallD = rayWorld(arena.solids, eye.x, eye.y, eye.z, dir.x, dir.y, dir.z, 300);
    const hit = bots.rayHit(eye.x, eye.y, eye.z, dir.x, dir.y, dir.z, wallD, hitOut);
    audio.play(`shot-${shot.weapon}`, 0, 0.75, 0.97 + Math.random() * 0.06);
    addTracer(hit ? hit.t : wallD);
    res.hit = false; res.zone = null; res.bot = null; res.kill = false; res.counted = true; res.dist = 0;
    res.first = shot.first; res.shot = shot.shot; res.emptied = shot.emptied;
    res.accurate = !move.air && M.accurate(N, move.speed, w, move.crouch ? 'crouch' : move.walk ? 'walk' : 'run', move.ads);
    if (hit) {
      const b = hit.bot;
      res.hit = true; res.zone = hit.zone; res.bot = b; res.dist = hit.t;
      res.counted = hooks.allowHit ? hooks.allowHit(res) !== false : true;
      if (res.counted) {
        b.flash = 1;
        if (!b.god) M.applyDamage(N, b, M.rawDamage(w, hit.zone, hit.t));
        if (b.firstHitAt < 0) b.firstHitAt = state.now;
        // Hit before its head was in the open: that hit is when it was seen.
        if (b.seenAt < 0) b.seenAt = state.now;
        audio.play(hit.zone === 'head' ? 'hit-head' : 'hit-body', 0, 0.7);
        addPuff(eye.x + dir.x * hit.t, eye.y + dir.y * hit.t, eye.z + dir.z * hit.t, hit.zone === 'head' ? 2 : 1);
        if (b.hp <= 0 && b.alive) {
          b.alive = false; b.downAt = state.now; res.kill = true;
          audio.play('kill', 0, 0.6);
          if (hooks.killed) hooks.killed(b, hit.zone, res);
        }
      }
    } else if (wallD < 300) {
      addMark(wallD);
      addPuff(eye.x + dir.x * (wallD - 0.02), eye.y + dir.y * (wallD - 0.02), eye.z + dir.z * (wallD - 0.02), 0);
    }
    if (hooks.shot) hooks.shot(res);
  }
  function addTracer(d) {
    const i = trNext; trNext = (trNext + 1) % TRACERS;
    const s = Math.min(d, 120);
    if (s < 3) return;
    const rx = Math.cos(P.yaw) * 0.1, rz = -Math.sin(P.yaw) * 0.1;
    trPos[i * 6] = eye.x + dir.x * 1.6 + rx; trPos[i * 6 + 1] = eye.y - 0.09 + dir.y * 1.6; trPos[i * 6 + 2] = eye.z + dir.z * 1.6 + rz;
    trPos[i * 6 + 3] = eye.x + dir.x * s; trPos[i * 6 + 4] = eye.y + dir.y * s; trPos[i * 6 + 5] = eye.z + dir.z * s;
    trLife[i] = 0.035;
    trGeo.attributes.position.needsUpdate = true;
  }
  const mk = new THREE.Matrix4(), mq = new THREE.Quaternion(), mp = new THREE.Vector3(), ms = new THREE.Vector3(1, 1, 1), mn = new THREE.Vector3(), fwd = new THREE.Vector3(0, 0, 1);
  /** Which way the face a ray struck looks: the box side the hit point lies on. */
  function faceNormal(hx, hy, hz) {
    const s = arena.solids;
    let best = 1e9;
    mn.set(-dir.x, -dir.y, -dir.z);
    for (let i = 0; i < s.length; i++) {
      const b = s[i];
      if (hx < b.min[0] - 0.01 || hx > b.max[0] + 0.01 || hy < b.min[1] - 0.01 || hy > b.max[1] + 0.01 || hz < b.min[2] - 0.01 || hz > b.max[2] + 0.01) continue;
      let d = Math.abs(hx - b.min[0]); if (d < best) { best = d; mn.set(-1, 0, 0); }
      d = Math.abs(hx - b.max[0]); if (d < best) { best = d; mn.set(1, 0, 0); }
      d = Math.abs(hy - b.min[1]); if (d < best) { best = d; mn.set(0, -1, 0); }
      d = Math.abs(hy - b.max[1]); if (d < best) { best = d; mn.set(0, 1, 0); }
      d = Math.abs(hz - b.min[2]); if (d < best) { best = d; mn.set(0, 0, -1); }
      d = Math.abs(hz - b.max[2]); if (d < best) { best = d; mn.set(0, 0, 1); }
    }
    return mn;
  }
  function addMark(d) {
    const hx = eye.x + dir.x * d, hy = eye.y + dir.y * d, hz = eye.z + dir.z * d;
    faceNormal(hx, hy, hz);
    mp.set(hx + mn.x * 0.004, hy + mn.y * 0.004, hz + mn.z * 0.004);
    mq.setFromUnitVectors(fwd, mn);
    mk.compose(mp, mq, ms);
    marks.setMatrixAt(markNext, mk);
    markNext = (markNext + 1) % MARKS;
    marks.count = Math.min(MARKS, marks.count + 1);
    marks.instanceMatrix.needsUpdate = true;
  }
  function addPuff(x, y, z, kind) {
    const i = puffNext; puffNext = (puffNext + 1) % PUFFS;
    puffPos[i * 3] = x; puffPos[i * 3 + 1] = y; puffPos[i * 3 + 2] = z;
    puffLife[i] = 1; puffKind[i] = kind;
  }
  const pc = new THREE.Color();
  function drawPuffs(dt) {
    for (let i = 0; i < PUFFS; i++) {
      let life = puffLife[i];
      if (life > 0) { life = Math.max(0, life - dt * 9); puffLife[i] = life; }
      const kind = puffKind[i];
      const size = life > 0 ? (kind === 0 ? 0.1 : kind === 2 ? 0.42 : 0.26) * (1.25 - life) : 0;
      mp.set(puffPos[i * 3], puffPos[i * 3 + 1], puffPos[i * 3 + 2]);
      ms.set(size, size, size);
      mk.compose(mp, mq.identity(), ms);
      puffs.setMatrixAt(i, mk);
      const a = life * life;
      if (kind === 2) pc.setRGB(1.0 * a, 0.86 * a, 0.35 * a); else if (kind === 1) pc.setRGB(0.9 * a, 0.9 * a, 0.9 * a); else pc.setRGB(0.55 * a, 0.5 * a, 0.42 * a);
      puffs.setColorAt(i, pc);
    }
    ms.set(1, 1, 1);
    puffs.instanceMatrix.needsUpdate = true;
    puffs.instanceColor.needsUpdate = true;
  }

  // A bot sees the player when nothing solid is between its eye and the
  // player's eye or chest.
  function canSee(x, y, z) {
    eyeAt();
    for (let k = 0; k < 2; k++) {
      const ty = k === 0 ? eye.y : P.y + 1.2 - 0.3 * P.crouch;
      const dx = P.x - x, dy = ty - y, dz = P.z - z;
      const d = Math.hypot(dx, dy, dz);
      if (d < 1e-3) return true;
      if (rayWorld(arena.solids, x, y, z, dx / d, dy / d, dz / d, d) >= d - 0.05) return true;
    }
    return false;
  }
  const hurtT = { hp: 0, armour: 0 };
  let hurtNext = 0;
  function botShot(b, lands) {
    const dx = b.x - P.x, dz = b.z - P.z;
    // Which side it came from, as the player faces: for the pan and the HUD.
    const pan = Math.sin(P.yaw - Math.atan2(-dx, -dz));
    const dist = Math.hypot(dx, dz);
    audio.play('shot-bot', pan, Math.max(0.25, Math.min(1, 14 / Math.max(1, dist))));
    // One hit lands at a time: caught by five at once, the player is hurt by
    // them in turn, not by all of them in the same instant.
    if (!lands || P.dead || state.now < hurtNext) return;
    hurtNext = state.now + HURT_GAP;
    // Always the body: a bot is no aimbot, and one lucky head would be half the run.
    const zone = 'body';
    hurtT.hp = P.hp; hurtT.armour = P.armour;
    M.applyDamage(N, hurtT, M.rawDamage(N.weapons[BOT_GUN], zone, dist));
    P.hp = hurtT.hp; P.armour = hurtT.armour;
    P.tagUntil = state.now + N.move.tagSec;
    audio.play('hurt', pan, 0.8);
    if (hooks.hurt) hooks.hurt(pan, zone);
    if (P.hp <= 0) { P.dead = true; if (hooks.died) hooks.died(); }
  }

  // ── Frames ───────────────────────────────────────────────────────────────
  function resize() {
    const w = canvas.clientWidth | 0, h = canvas.clientHeight | 0;
    if (!w || !h) return;
    const ratio = Math.min(window.devicePixelRatio || 1, settings.graphics === 'low' ? 1 : 1.5);
    renderer.setPixelRatio(ratio);
    renderer.setSize(w, h, false);
    bots.setResolution(w, h);
    camera.aspect = vmCamera.aspect = w / h;
    vmCamera.updateProjectionMatrix();
    camera.updateProjectionMatrix();
  }
  const look = new THREE.Vector3();
  function draw(f, dt) {
    let fov;
    if (previewing) {
      const v = previewing;
      camera.position.set(v.pos[0], v.pos[1], v.pos[2]);
      camera.lookAt(look.set(v.look[0], v.look[1], v.look[2]));
      fov = v.fov || M.verticalFov(N, camera.aspect);
    } else {
      const c = P.pcrouch + (P.crouch - P.pcrouch) * f;
      camera.position.set(P.px + (P.x - P.px) * f, P.py + (P.y - P.py) * f + N.player.eyeStand - N.player.crouchDrop * c, P.pz + (P.z - P.pz) * f);
      camera.rotation.set(P.pitch, P.yaw, 0);
      const w = guns && guns.weapon();
      const zoom = w && w.zoom > 1 ? 1 + (w.zoom - 1) * guns.adsAmount() : 1;
      fov = M.zoomedFov(M.verticalFov(N, camera.aspect), zoom);
    }
    if (Math.abs(camera.fov - fov) > 1e-6) { camera.fov = fov; camera.updateProjectionMatrix(); }
    bots.draw(f);
    drawPuffs(dt);
    for (let i = 0; i < TRACERS; i++) if (trLife[i] > 0) { trLife[i] -= dt; if (trLife[i] <= 0) { trPos.fill(0, i * 6, i * 6 + 6); trGeo.attributes.position.needsUpdate = true; } }
    renderer.clear();
    renderer.render(scene, camera);
    if (guns && !previewing) {
      renderer.clearDepth();
      renderer.render(guns.scene, vmCamera);
    }
  }
  function frame(t) {
    if (!state.playing) return;
    state.frame = requestAnimationFrame(frame);
    const now = t / 1000;
    let dt = now - state.last;
    state.last = now;
    if (dt > 0.25) dt = 0.25;
    if (dt < 0) dt = 0;
    state.ft[state.ftN++ % state.ft.length] = dt * 1000;
    state.acc += dt;
    while (state.acc >= TICK) { state.acc -= TICK; state.now += TICK; tick(); if (!state.playing) return; }
    guns.pose(state.now, dt, move, P.yaw, P.pitch);
    draw(state.acc / TICK, dt);
    if (hooks.frame) hooks.frame(dt);
  }

  function setArena(arenaId, extra) {
    const key = arenaId + (extra ? `+${JSON.stringify(extra)}` : '');
    if (arena && arenaKey === key) return;
    if (arena) disposeArena(arena, scene);
    arena = buildArena(arenaId, scene, extra);
    arenaKey = key;
  }
  function clearField() {
    bots.clear();
    marks.count = 0;
    puffLife.fill(0);
    trLife.fill(0); trPos.fill(0); trGeo.attributes.position.needsUpdate = true;
  }
  const viewV = new THREE.Vector3();

  // ── What the page drives ─────────────────────────────────────────────────
  return {
    N, P, bots, keys, move,
    get arena() { return arena; },
    get guns() { return guns; },
    get now() { return state.now; },
    get playing() { return state.playing; },
    setSettings(s) {
      settings = s;
      degPer = M.degPerCount(N, s.sens);
      bots.setOutline(s.enemy);
      setDetail(s.graphics === 'low' ? 0.6 : 1);
      resize();
    },
    /** A fresh run in `arenaId`: the arena, the player at its start, the loadout in hand. */
    load(arenaId, extra) {
      previewing = null;
      setArena(arenaId, extra);
      clearField();
      const s = arena.start;
      Object.assign(P, { x: s.x, y: s.y, z: s.z, px: s.x, py: s.y, pz: s.z, vy: 0, ground: true, crouch: 0, pcrouch: 0, yaw: s.yaw, pitch: 0, hp: N.player.hp, armour: 0, landedAt: -10, tagUntil: 0, dead: false, stopFrom: -1, stepAcc: 1.4 });
      P.v.x = 0; P.v.z = 0;
      if (guns) guns.dispose();
      guns = createGuns(N, { primary: settings.primary, secondary: settings.secondary }, (Math.random() * 1e9) | 0);
      state.now = 0; state.acc = 0;
      guns.reset(0);
      guns.pose(0, 0.016, move, P.yaw, P.pitch);
      keys.clear();
      wasReloading = false;
      hurtNext = 0;
      resize();
      draw(1, 0);
      return arena;
    },
    /**
     * The menu's still: the arena from its own camera with a few bots standing
     * in it, or (first) from the player's eye with one bot ahead, for the
     * crosshair preview.
     */
    preview(arenaId, first) {
      state.playing = false;
      cancelAnimationFrame(state.frame);
      setArena(arenaId, null);
      clearField();
      const s = arena.start;
      const v = first
        ? { pos: [s.x, s.y + N.player.eyeStand, s.z], look: [s.x, s.y + N.player.eyeStand, s.z - 10], fov: 0 }
        : arena.view;
      previewing = v;
      const pts = first ? [[s.x, s.y, s.z - 14]] : (arena.sample || []);
      for (const [x, y, z, crouch] of pts) {
        const b = bots.spawn({ x, y, z, stance: crouch ? 'crouch' : 'stand' }, 0);
        if (b) b.yaw = Math.atan2(-(v.pos[0] - x), -(v.pos[2] - z));
      }
      resize();
      draw(1, 0);
    },
    start() {
      if (state.playing || previewing) return;
      state.playing = true;
      state.last = performance.now() / 1000;
      state.acc = 0;
      state.frame = requestAnimationFrame(frame);
    },
    stop() {
      state.playing = false;
      cancelAnimationFrame(state.frame);
      keys.clear();
      jumpQueued = false;
      if (guns) { guns.setTrigger(false, state.now); guns.setAlt(false); }
    },
    /** One frame drawn where things stand: after a resize, or behind the pause. */
    still() { resize(); if (arena) draw(1, 0); },
    resize,
    canSee,
    /** The frame times of the last 1200 frames, ms. */
    frameTimes() { return Array.from(state.ft.subarray(0, Math.min(state.ftN, state.ft.length))); },
    resetFrameTimes() { state.ftN = 0; },
    /** How far, in CSS pixels up from the centre, the spray's recoil has carried the aim. */
    recoilPx() {
      if (!guns) return 0;
      return Math.tan(guns.st.recoilPitch * DEG) / Math.tan((camera.fov * DEG) / 2) * ((canvas.clientHeight || 1) / 2);
    },
    /** The radius in CSS pixels of a cone `deg` wide, for the crosshair's firing error. */
    conePx(deg) { return Math.tan(deg * DEG) / Math.tan((camera.fov * DEG) / 2) * ((canvas.clientHeight || 1) / 2); },
    /** Whether a point is in front of the camera and on screen. */
    inView(x, y, z) {
      const v = viewV.set(x, y, z).project(camera);
      return v.z < 1 && Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1;
    },
    destroy() {
      this.stop();
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('keydown', kd);
      document.removeEventListener('keyup', ku);
      document.removeEventListener('mousedown', md);
      document.removeEventListener('mouseup', mu);
      canvas.removeEventListener('contextmenu', noMenu);
      renderer.dispose();
    },
  };
}

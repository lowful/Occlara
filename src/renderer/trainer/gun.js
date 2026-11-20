// THE GUNS (docs/claude/trainer.md, "Weapons"). Four profiles with plain names
// whose numbers follow four Valorant weapons (trainer-data.json says which and
// where each number comes from), and a knife to run with. The view models are
// generic firearms, none of them any game's: a battle rifle, a carbine with a
// suppressor, a revolver, a compact pistol and a combat knife, each held by a
// gloved hand or two. They are made ahead of time from CC0 models
// (scripts/trainer-models/build.js, native/trainer-models-NOTICE.txt) and
// load from models/guns.js, one mesh per weapon with its hands in it.
//
// The rules a shot follows, in order: the weapon must be up and not
// reloading, the fire interval must have passed, there must be a round. The
// bullet leaves along the view, plus the recoil the spray has built (the
// crosshair rises with it), plus a random point in the spread cone
// (trainer-math.js spread: first shot, spray growth, moving, crouched, in the
// air, just landed). Recoil settles when the trigger rests.
import * as THREE from './vendor/three.module.min.js';
import { unpack, LIT, litUniforms } from './kit.js';
import { SUN } from './world.js';
import { GUNS } from './models/guns.js';

const M = window.OcclaraTrainerMath;

/** A seeded random in [0, 1). */
export function rng(seed) {
  let s = seed >>> 0 || 0x9e3779b9;
  return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; };
}

// Where each view model is held: at rest (`hip`, with its turn in radians),
// and aimed (`ads`, how far ahead of the eye; how far below is worked out
// from the mesh, so its highest point stays CLEAR degrees under the middle of
// the screen and the crosshair is never covered). `kick` is how hard a shot
// throws it, `flash` the muzzle flash's size.
const CLEAR = 3.0;
const VIEW = {
  'heavy-rifle': { hip: [0.118, -0.128, -0.43], turn: [0.035, 0.075, 0], ads: -0.42, kick: 9, flash: 0.26 },
  'silenced-rifle': { hip: [0.118, -0.122, -0.43], turn: [0.035, 0.075, 0], ads: -0.42, kick: 9, flash: 0 },
  'heavy-pistol': { hip: [0.092, -0.096, -0.4], turn: [0.02, 0.05, 0], ads: -0.46, kick: 13, flash: 0.24 },
  sidearm: { hip: [0.088, -0.088, -0.38], turn: [0.02, 0.05, 0], ads: -0.44, kick: 13, flash: 0.18 },
  knife: { hip: [0.115, -0.135, -0.36], turn: [0.0, 0.3, 0.28], ads: -0.4, kick: 10, flash: 0 },
};

// Each mesh is unpacked once and kept: a run's guns are made again on every
// load, and the meshes never change.
const made = new Map();
function model(id) {
  let m = made.get(id);
  if (m) return m;
  const src = GUNS[id] || GUNS.knife;
  const view = VIEW[id] || VIEW.knife;
  const geo = unpack(src);
  // How far the aimed model must drop: the least that puts every point ahead
  // of the eye at least CLEAR degrees under the line of sight.
  const p = geo.attributes.position;
  const t = Math.tan(CLEAR * Math.PI / 180);
  let drop = 0;
  for (let i = 0; i < p.count; i++) {
    const z = p.getZ(i) + view.ads;
    if (z > -0.03) continue;
    drop = Math.min(drop, t * z - p.getY(i));
  }
  m = { geo, muzzle: src.muzzle, view, adsY: drop };
  made.set(id, m);
  return m;
}

const GUN_VERT = /* glsl */`
attribute vec4 aCol;
varying vec3 vCol; varying float vGloss; varying vec3 vN; varying vec3 vP;
void main() {
  vCol = pow(aCol.rgb, vec3(2.2)); vGloss = aCol.a;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalMatrix * normal;
  vP = mv.xyz;
  gl_Position = projectionMatrix * mv;
}`;
// The view model's own camera never turns, so its space is the eye's: the
// sun and the sky's way up are turned into it each frame (pose).
const GUN_FRAG = /* glsl */`
${LIT}
uniform vec3 uFlashAt; uniform float uFlash;
varying vec3 vCol; varying float vGloss; varying vec3 vN; varying vec3 vP;
void main() {
  vec3 n = normalize(vN);
  vec3 col = lit(vCol, vGloss, n, normalize(-vP));
  // A shot lights the gun from its own muzzle for a moment.
  vec3 d = uFlashAt - vP;
  float fall = 1.0 / (1.0 + dot(d, d) * 26.0);
  col += (vCol * 2.0 + 0.02) * vec3(1.0, 0.72, 0.4) * uFlash * fall * max(dot(n, normalize(d)), 0.0);
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`;

const FLASH_FRAG = /* glsl */`
uniform float uSeed; varying vec2 vUv;
void main() {
  vec2 p = vUv - 0.5;
  float d = length(p) * 2.0;
  float a = atan(p.y, p.x) + uSeed;
  float spikes = 0.55 + 0.45 * abs(cos(a * 2.5));
  float core = pow(max(0.0, 1.0 - d / spikes), 2.2);
  gl_FragColor = vec4(vec3(1.0, 0.86, 0.6) * core * 1.6, core);
}`;

/**
 * @param N        the numbers (trainer-math.js numbers)
 * @param loadout  { primary, secondary } weapon profile ids
 */
export function createGuns(N, loadout, seed) {
  const rand = rng(seed || 1);
  const scene = new THREE.Scene();
  const holder = new THREE.Group();
  scene.add(holder);
  const mat = new THREE.ShaderMaterial({
    vertexShader: GUN_VERT, fragmentShader: GUN_FRAG,
    uniforms: { ...litUniforms(), uFlashAt: { value: new THREE.Vector3() }, uFlash: { value: 0 } },
  });
  const sunWorld = new THREE.Vector3(SUN[0], SUN[1], SUN[2]).normalize();
  const eyeTurn = new THREE.Quaternion(), eyeEuler = new THREE.Euler(0, 0, 0, 'YXZ');
  const flashMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
    uniforms: { uSeed: { value: 0 } },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: FLASH_FRAG,
  });

  const flashGeo = new THREE.PlaneGeometry(1, 1);
  const slots = {
    primary: { id: loadout.primary, w: N.weapons[loadout.primary] },
    secondary: { id: loadout.secondary, w: N.weapons[loadout.secondary] },
    knife: { id: 'knife', w: null },
  };
  for (const k of Object.keys(slots)) {
    const s = slots[k];
    s.ammo = s.w ? s.w.mag : 0;
    const b = model(s.id);
    s.view = b.view; s.adsY = b.adsY;
    s.model = new THREE.Group();
    const mesh = new THREE.Mesh(b.geo, mat);
    mesh.frustumCulled = false;       // always before the eye, its near end behind it
    s.model.add(mesh);
    s.flash = new THREE.Mesh(flashGeo, flashMat);
    s.flash.scale.setScalar(b.view.flash || 0.2);
    s.flash.position.set(b.muzzle[0], b.muzzle[1], b.muzzle[2] - 0.02);
    s.flash.visible = false;
    s.model.add(s.flash);
    s.long = s.id === 'heavy-rifle' || s.id === 'silenced-rifle';
    s.silenced = s.id === 'silenced-rifle';
    s.model.visible = false;
    holder.add(s.model);
  }

  const st = {
    slot: '',
    equipUntil: 0, equipFrom: 0, reloadUntil: 0, reloadFrom: 0,
    nextShot: 0, lastShot: -10, shot: 0,          // the spray: the last bullet's place in it
    recoilPitch: 0, recoilYaw: 0,                  // degrees, what the spray has built
    trigger: false, alt: false, burstLeft: 0,
    kick: 0, kickV: 0, flashUntil: 0, bob: 0, ads: 0, swayX: 0, swayY: 0, lastYaw: 0, lastPitch: 0, swing: 0,
  };
  const cur = () => slots[st.slot] || slots.primary;

  function equip(slot, now) {
    if (!slots[slot] || st.slot === slot) return false;
    st.slot = slot;
    for (const k of Object.keys(slots)) slots[k].model.visible = k === slot;
    const w = cur().w;
    st.equipFrom = now;
    st.equipUntil = now + (w ? w.equip : 0.5);
    st.reloadUntil = 0;
    st.shot = 0; st.burstLeft = 0; st.alt = false;
    return true;
  }

  function reload(now) {
    const s = cur();
    if (!s.w || s.ammo >= s.w.mag || st.reloadUntil || now < st.equipUntil) return false;
    st.reloadFrom = now;
    st.reloadUntil = now + s.w.reload;
    st.burstLeft = 0;
    return true;
  }

  /**
   * Whether a bullet leaves this tick, and its direction offsets in degrees
   * (pitch up, yaw right, from the view): the recoil built so far, plus a
   * point in the spread cone. Null when no bullet leaves, { dry } on an
   * empty click, { reloaded } on the tick a reload completes.
   */
  function fire(now, move) {
    const s = cur();
    const w = s.w;
    if (!w) return null;
    if (st.reloadUntil && now >= st.reloadUntil) { s.ammo = w.mag; st.reloadUntil = 0; }
    if (now < st.equipUntil || st.reloadUntil) return null;
    const burst = st.burstLeft > 0 && w.burst;
    if (!st.trigger && !burst) return null;
    if (now < st.nextShot) return null;
    if (s.ammo <= 0) { st.trigger = false; st.burstLeft = 0; return { dry: true }; }
    const rate = burst ? w.burst.rate : w.fireRate;
    // Where the spray stands: put back by the rest since the last bullet.
    st.shot = M.sprayAfter(w, st.shot, now - st.lastShot) + 1;
    const ads = st.alt && w.alt === 'ads';
    const cone = M.spread(N, w, { shot: st.shot, ads, speed: move.speed, air: move.air, crouch: move.crouch, walk: move.walk, landing: move.landing })
      + (burst ? w.burst.spreadAdd : 0);
    const k = M.recoilKick(w, st.shot, rand() * 2 - 1);
    // The bullet leaves along the recoil built before this shot; this shot's
    // kick moves the crosshair for the next one.
    const pitch = st.recoilPitch, yaw = st.recoilYaw;
    st.recoilPitch += k.up * (burst ? w.burst.recoilMult : 1);
    st.recoilYaw += k.side;
    const r = cone * Math.sqrt(rand());       // a point evenly in the cone's disc
    const a = rand() * Math.PI * 2;
    s.ammo -= 1;
    st.lastShot = now;
    st.nextShot = now + 1 / rate;
    if (burst) { st.burstLeft -= 1; if (st.burstLeft <= 0) st.nextShot = now + w.burst.cooldown; }
    else if (!w.auto) st.trigger = false;
    st.kickV += s.view.kick;
    st.flashUntil = now + 0.03;
    flashMat.uniforms.uSeed.value = rand() * 6.28;
    const last = s.ammo <= 0;
    if (last) reload(now);
    return { pitch: pitch + r * Math.sin(a), yaw: yaw + r * Math.cos(a), first: st.shot === 1, shot: st.shot, cone, weapon: s.id, emptied: last };
  }

  /** The crosshair settles back as the trigger rests. */
  function recover(now, dt) {
    const w = cur().w;
    if (!w) { st.recoilPitch = 0; st.recoilYaw = 0; return; }
    if (now - st.lastShot < 1 / w.fireRate + 0.012) return;
    const k = Math.min(1, (dt / Math.max(0.05, w.recoil.recoverSec)) * 3.2);
    st.recoilPitch -= st.recoilPitch * k;
    st.recoilYaw -= st.recoilYaw * k;
    if (Math.abs(st.recoilPitch) < 1e-4) st.recoilPitch = 0;
    if (Math.abs(st.recoilYaw) < 1e-4) st.recoilYaw = 0;
  }

  const ease = (t) => t * t * (3 - 2 * t);
  /**
   * The view model's pose for this frame: it lags a turn, bobs with the
   * steps, kicks on a shot and springs back, dips through a reload, rises
   * when drawn and slides to the eye when aimed.
   */
  function pose(now, dt, move, yaw, pitch) {
    const s = cur();
    const m = s.model;
    // A spring for the kick: stiff, a little under damped.
    st.kickV += (-st.kick * 260 - st.kickV * 22) * dt;
    st.kick += st.kickV * dt;
    // The lag behind a turn, from how far the view moved this frame.
    let dy = yaw - st.lastYaw, dp = pitch - st.lastPitch;
    st.lastYaw = yaw; st.lastPitch = pitch;
    if (Math.abs(dy) > 1) dy = 0;
    const k = Math.min(1, dt * 14);
    st.swayX += (Math.max(-0.03, Math.min(0.03, dy * 0.35)) - st.swayX) * k;
    st.swayY += (Math.max(-0.03, Math.min(0.03, dp * 0.35)) - st.swayY) * k;
    const walking = !move.air && move.speed > 0.4;
    st.bob += dt * (walking ? 5 + move.speed * 1.5 : 0);
    const bobA = walking ? Math.min(1, move.speed / 5.4) : 0;
    const wantAds = st.alt && s.w && s.w.alt === 'ads' ? 1 : 0;
    st.ads += (wantAds - st.ads) * Math.min(1, dt * 16);
    let dip = 0;
    if (st.reloadUntil) dip = Math.sin(Math.min(1, Math.max(0, (now - st.reloadFrom) / Math.max(0.01, st.reloadUntil - st.reloadFrom))) * Math.PI);
    dip = ease(Math.min(1, dip * 1.6));
    const rise = now < st.equipUntil ? 1 - ease(Math.min(1, (now - st.equipFrom) / Math.max(0.01, Math.min(0.35, st.equipUntil - st.equipFrom)))) : 0;
    const land = move.landing != null && move.landing < 0.25 ? Math.sin((move.landing / 0.25) * Math.PI) * 0.012 : 0;
    const a = st.ads, hip = 1 - a;
    const bx = Math.sin(st.bob) * 0.004 * bobA * hip, by = -Math.abs(Math.cos(st.bob)) * 0.005 * bobA * hip;
    const v = s.view;
    m.position.set(
      v.hip[0] * hip + bx + st.swayX * 0.6,
      v.hip[1] * hip + s.adsY * a + by - dip * 0.16 - rise * 0.3 - land - st.swayY * 0.5,
      v.hip[2] * hip + v.ads * a + st.kick * 0.012,
    );
    m.rotation.set(v.turn[0] * hip + st.kick * 0.022 * (0.4 + 0.6 * hip) - dip * 0.5 + rise * 0.9 + st.swayY * 0.8, v.turn[1] * hip + st.swayX * 1.4, v.turn[2] * hip - dip * 0.4 - st.swayX * 1.2);
    const lit = now < st.flashUntil && !s.silenced && !!s.w;
    s.flash.visible = lit;
    s.flash.rotation.z = flashMat.uniforms.uSeed.value;
    // Aimed, the muzzle sits just under the crosshair: the flash is kept small there.
    s.flash.scale.setScalar((v.flash || 0.2) * (1 - 0.5 * a));
    // The light: the world's sun and its sky, turned into the eye's space, so
    // the gun is lit from where the arena is; and the shot's own flash.
    eyeTurn.setFromEuler(eyeEuler.set(pitch, yaw, 0, 'YXZ')).invert();
    mat.uniforms.uSun.value.copy(sunWorld).applyQuaternion(eyeTurn);
    mat.uniforms.uUp.value.set(0, 1, 0).applyQuaternion(eyeTurn);
    mat.uniforms.uFlash.value = lit ? 1 : 0;
    if (lit) { m.updateMatrix(); mat.uniforms.uFlashAt.value.copy(s.flash.position).applyMatrix4(m.matrix); }
  }

  return {
    scene, st, slots, cur,
    weapon: () => cur().w,
    id: () => cur().id,
    equip, reload, fire, recover, pose,
    setTrigger(on, now) {
      const s = cur();
      st.trigger = !!on;
      if (on && !s.w) { st.kickV += 10; return; }
      if (on && s.w && s.ammo <= 0 && !st.reloadUntil) reload(now);
    },
    setAlt(on) {
      const w = cur().w;
      if (!w) { st.alt = false; return; }
      if (w.alt === 'burst') { if (on && st.burstLeft <= 0 && cur().ammo > 0) st.burstLeft = Math.min(w.burst.count, cur().ammo); st.alt = false; return; }
      st.alt = !!on && w.alt === 'ads';
    },
    zoom: () => { const w = cur().w; return st.alt && w && w.alt === 'ads' ? w.zoom : 1; },
    /** 0 to 1: how far the aim down sights has come in, for the view's own zoom. */
    adsAmount: () => st.ads,
    reloading: () => !!st.reloadUntil,
    /** 0 to 1 through a reload, or -1. */
    reloadProgress: (now) => (st.reloadUntil ? Math.min(1, (now - st.reloadFrom) / Math.max(0.01, st.reloadUntil - st.reloadFrom)) : -1),
    reset(now) {
      for (const k of Object.keys(slots)) if (slots[k].w) slots[k].ammo = slots[k].w.mag;
      st.slot = '';
      st.recoilPitch = 0; st.recoilYaw = 0; st.shot = 0; st.lastShot = -10; st.nextShot = 0;
      st.trigger = false; st.alt = false; st.burstLeft = 0; st.reloadUntil = 0; st.kick = 0; st.kickV = 0; st.ads = 0;
      equip('primary', now);
      st.equipUntil = now;
    },
    dispose() {
      // The meshes are kept for the next run (model); what was made here goes.
      flashGeo.dispose(); mat.dispose(); flashMat.dispose();
    },
  };
}

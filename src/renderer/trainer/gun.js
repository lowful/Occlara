// THE GUNS (docs/claude/trainer.md, "Weapons"). Four profiles with plain names
// whose numbers follow four Valorant weapons (trainer-data.json says which and
// where each number comes from), and a knife to run with. The models are our
// own, put together in code from boxes and cylinders (kit.js): no shape here
// is taken from any game's gun.
//
// The rules a shot follows, in order: the weapon must be up and not
// reloading, the fire interval must have passed, there must be a round. The
// bullet leaves along the view, plus the recoil the spray has built (the
// crosshair rises with it), plus a random point in the spread cone
// (trainer-math.js spread: first shot, spray growth, moving, crouched, in the
// air, just landed). Recoil settles when the trigger rests.
import * as THREE from './vendor/three.module.min.js';
import { at, between, dist, box, cyl, capsule, merge } from './kit.js';

const M = window.OcclaraTrainerMath;

/** A seeded random in [0, 1). */
export function rng(seed) {
  let s = seed >>> 0 || 0x9e3779b9;
  return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return (s >>> 0) / 4294967296; };
}

const METAL = 0x424854, METAL2 = 0x2a2e37, METAL3 = 0x565d6b, GLOVE = 0x23262d, SLEEVE = 0x343a45;
const ACCENT = { 'heavy-rifle': 0x3f8f98, 'silenced-rifle': 0xd9dde4, 'heavy-pistol': 0xe3aa3c, sidearm: 0x7f8a9c, knife: 0xd9dde4 };
const tube = (r, len, seg) => { const g = cyl(r, r, len, seg || 12); g.rotateX(Math.PI / 2); return g; };

/** The hands: the one on the grip, and for a long gun the one under the barrel. */
function hands(parts, grip, support) {
  // Each forearm runs down and back out of the frame, so only a wrist shows.
  const arm = (from, to) => parts.push([capsule(0.038, dist(...from, ...to), 8), SLEEVE, between(...from, ...to)]);
  parts.push([box(0.056, 0.074, 0.068), GLOVE, at(grip[0], grip[1], grip[2], 16)]);
  arm([grip[0] + 0.005, grip[1] - 0.04, grip[2] + 0.03], [grip[0] + 0.05, grip[1] - 0.42, grip[2] + 0.08]);
  if (support) {
    parts.push([box(0.066, 0.046, 0.085), GLOVE, at(support[0], support[1], support[2])]);
    arm([support[0] - 0.01, support[1] - 0.03, support[2] + 0.02], [support[0] - 0.1, support[1] - 0.42, support[2] + 0.05]);
  }
}

function rifle(silenced, accent) {
  const p = [];
  p.push([box(0.056, 0.086, 0.34), METAL, at(0, 0, -0.02)]);                           // receiver
  p.push([box(0.058, 0.02, 0.2), accent, at(0, 0.018, -0.05)]);                        // its painted band
  p.push([box(0.03, 0.014, 0.4), METAL2, at(0, 0.05, -0.1)]);                          // top rail
  p.push([box(0.03, 0.024, 0.014), METAL2, at(0, 0.068, 0.07)]);                       // rear sight
  p.push([box(0.008, 0.03, 0.01), METAL2, at(0, 0.07, -0.29)]);                        // front sight
  p.push([box(0.05, 0.062, silenced ? 0.2 : 0.26), METAL3, at(0, 0.002, silenced ? -0.29 : -0.32)]);   // handguard
  p.push([box(0.052, 0.01, silenced ? 0.16 : 0.22), METAL2, at(0, -0.024, silenced ? -0.29 : -0.32)]);
  if (silenced) {
    p.push([tube(0.012, 0.08), METAL2, at(0, 0.012, -0.43)]);
    p.push([tube(0.026, 0.27, 14), METAL2, at(0, 0.012, -0.6)]);                       // the silencer
    p.push([tube(0.027, 0.02, 14), accent, at(0, 0.012, -0.5)]);
  } else {
    p.push([tube(0.011, 0.2), METAL2, at(0, 0.012, -0.55)]);                           // barrel
    p.push([tube(0.018, 0.055), METAL3, at(0, 0.012, -0.665)]);                        // muzzle
  }
  p.push([box(0.034, 0.13, 0.06), METAL2, at(0, -0.1, -0.085, silenced ? -16 : -8)]);  // magazine
  p.push([box(0.034, 0.1, 0.046), METAL3, at(0, -0.085, 0.07, 16)]);                   // grip
  p.push([box(0.01, 0.008, 0.075), METAL2, at(0, -0.052, 0.0)]);                       // trigger guard
  p.push([box(0.05, 0.07, 0.03), METAL2, at(0, -0.004, 0.16)]);                        // end cap: a carbine, no stock
  hands(p, [0, -0.09, 0.075], [0, -0.05, -0.3]);
  return { geo: merge(p), muzzle: [0, 0.012, silenced ? -0.74 : -0.7] };
}

function pistol(heavy, accent) {
  const p = [];
  if (heavy) {
    p.push([box(0.034, 0.05, 0.15), METAL, at(0, 0.008, -0.03)]);                      // frame
    p.push([box(0.03, 0.046, 0.17), METAL3, at(0, 0.016, -0.19)]);                     // slab barrel
    p.push([box(0.012, 0.012, 0.16), accent, at(0, 0.044, -0.19)]);                    // its rib
    p.push([tube(0.03, 0.058, 8), METAL2, at(0, 0.012, -0.075)]);                      // cylinder
    p.push([box(0.008, 0.022, 0.01), METAL2, at(0, 0.058, -0.265)]);
    p.push([box(0.026, 0.018, 0.012), METAL2, at(0, 0.045, 0.035)]);
    p.push([box(0.033, 0.11, 0.05), METAL2, at(0, -0.062, 0.03, 20)]);                 // grip
    hands(p, [0, -0.062, 0.035], null);
    return { geo: merge(p), muzzle: [0, 0.016, -0.3] };
  }
  p.push([box(0.03, 0.042, 0.2), METAL3, at(0, 0.02, -0.08)]);                         // slide
  p.push([box(0.031, 0.008, 0.12), accent, at(0, 0.036, -0.05)]);
  p.push([box(0.028, 0.026, 0.16), METAL, at(0, -0.012, -0.07)]);                      // frame
  p.push([box(0.007, 0.012, 0.008), METAL2, at(0, 0.046, -0.17)]);
  p.push([box(0.022, 0.012, 0.008), METAL2, at(0, 0.045, 0.012)]);
  p.push([box(0.03, 0.1, 0.046), METAL2, at(0, -0.066, 0.0, 14)]);                     // grip
  hands(p, [0, -0.066, 0.004], null);
  return { geo: merge(p), muzzle: [0, 0.02, -0.2] };
}

function knife(accent) {
  const p = [];
  p.push([box(0.028, 0.03, 0.11), METAL2, at(0, 0, 0.02)]);
  p.push([box(0.05, 0.012, 0.014), METAL3, at(0, 0, -0.04)]);
  p.push([box(0.006, 0.034, 0.19), accent, at(0, 0.004, -0.14)]);
  p.push([box(0.007, 0.012, 0.19), METAL3, at(0, 0.024, -0.14)]);
  hands(p, [0, -0.01, 0.03], null);
  return { geo: merge(p), muzzle: [0, 0, -0.24] };
}

function build(kind) {
  const accent = ACCENT[kind] || ACCENT.knife;
  if (kind === 'knife') return knife(accent);
  if (kind === 'heavy-pistol') return pistol(true, accent);
  if (kind === 'sidearm') return pistol(false, accent);
  return rifle(kind === 'silenced-rifle', accent);
}

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
  scene.add(new THREE.HemisphereLight(0xd6e0f0, 0x4a4640, 2.4));
  const sun = new THREE.DirectionalLight(0xfff3e0, 2.2);
  sun.position.set(-1.2, 2.2, 1.4);
  scene.add(sun);
  const holder = new THREE.Group();
  scene.add(holder);
  const mat = new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 28, specular: 0x30343c });
  const flashMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
    uniforms: { uSeed: { value: 0 } },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: FLASH_FRAG,
  });

  const slots = {
    primary: { id: loadout.primary, w: N.weapons[loadout.primary] },
    secondary: { id: loadout.secondary, w: N.weapons[loadout.secondary] },
    knife: { id: 'knife', w: null },
  };
  for (const k of Object.keys(slots)) {
    const s = slots[k];
    s.ammo = s.w ? s.w.mag : 0;
    const b = build(s.id);
    s.model = new THREE.Group();
    s.model.add(new THREE.Mesh(b.geo, mat));
    s.flash = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.2), flashMat);
    s.flash.position.set(b.muzzle[0], b.muzzle[1], b.muzzle[2] - 0.03);
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
    st.kickV += s.long ? 9 : 13;
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
    const baseX = s.long ? 0.155 : 0.13, baseY = s.long ? -0.17 : -0.125, baseZ = s.long ? -0.48 : -0.42;
    m.position.set(
      baseX * hip + bx + st.swayX * 0.6,
      baseY * hip + (s.long ? -0.13 : -0.1) * a + by - dip * 0.14 - rise * 0.3 - land - st.swayY * 0.5,
      baseZ * hip + (s.long ? -0.62 : -0.54) * a + st.kick * 0.012,
    );
    m.rotation.set((s.long ? 0.05 : 0.02) * hip + st.kick * 0.022 * (0.4 + 0.6 * hip) - dip * 0.55 + rise * 0.9 + st.swayY * 0.8, 0.055 * hip + st.swayX * 1.4, -dip * 0.35 - st.swayX * 1.2);
    s.flash.visible = now < st.flashUntil && !s.silenced;
    s.flash.rotation.z = flashMat.uniforms.uSeed.value;
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
      for (const k of Object.keys(slots)) slots[k].model.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
      mat.dispose(); flashMat.dispose();
    },
  };
}

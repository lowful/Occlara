// Builds the Trainer's models from the downloaded sources (README.md):
//
//   node scripts/trainer-models/build.js <raw dir> [--dry] [--preview <dir>] [--clips <list>]
//
// <raw dir> holds one folder per source, <name>/<name>.glb, as fetch.js
// leaves them. It writes src/renderer/trainer/models/guns.js (the five first
// person view models, each one mesh with its hands) and figure.js (the bots'
// figure, its skeleton's poses and clips). With --preview it also writes .ply
// files to look at in Blender (preview.py); with --clips Idle@0,Run@0.25 too it
// writes only the source figure in those of its own clips, at that share of
// each, to choose from. --dry writes no module. Nothing here runs in the app.
//
// Every source is CC0 (native/trainer-models-NOTICE.txt). What this script
// changes is said there too: colours, normals, the hands' and the figure's
// poses, which are worked out here, and the parts put together.
'use strict';
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { readGlb, primitives } = require('./glb');
const MESH = require('./mesh');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(ROOT, 'src', 'renderer', 'trainer', 'models');
const args = process.argv.slice(2);
const RAW = args[0] && !args[0].startsWith('--') ? args[0] : path.join(__dirname, 'raw');
const PREVIEW = args.includes('--preview') ? args[args.indexOf('--preview') + 1] : null;

const hex = (h) => [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255];
const deg = (d) => d * Math.PI / 180;

// ── Colours ────────────────────────────────────────────────────────────────
// The sources' own colours are near black. Each material is given the
// Trainer's colour and a gloss: 0 is cloth, about 0.3 polymer, 0.7 and up
// metal (kit.js LIT reads it: the gloss sets the highlight and how much of
// the sky a face mirrors).
const KIT = {           // the weapon kit's materials (Pichuliru)
  'M_PCL_Flat_Black_Lighter': [0x2b2e34, 0.34],
  'M_PCL_Flat_Black': [0x1b1d21, 0.30],
  'M_PCL_Flat_Grey_Darker': [0x3a3e46, 0.72],
  'M_PCL_Flat_Grey_Dark': [0x565b65, 0.78],
  'M_PCL_Flat_Grey_Light': [0x7d838d, 0.82],
  'M_PCL_Flat_Yellow.Brass': [0xa98a45, 0.85],
  'M_PCL_Flat_Brown.Chestnut': [0x8a5a3e, 0.8],
  'M_PCL_Flat_White': [0xc4c8cf, 0.25],
  'M_PCL_Flat_Brown.Wine': [0x33302e, 0.22],
  'M_PCL_Flat_Glass': [0x1d2a33, 0.98],
  'M_PCL_Flat_Blue.Cerulean': [0x24313b, 0.9],
};
const REVOLVER = { DarkWood: [0x2a2523, 0.24], Metal: [0x3d4149, 0.76], Grey: [0x2c2f35, 0.7], LightMetal: [0x6a707b, 0.86] };
const SWAT = { Swat: [0x4b5565, 0.04], Swat_Black: [0x23262d, 0.2], Skin: [0x23262d, 0.2], Visor: [0x0b0e12, 0.97] };
// The same figure's sleeves and gloves up close, in the view models: a shade darker.
const ARMS = { Swat: [0x3a424f, 0.04], Swat_Black: [0x1e2127, 0.24], Skin: [0x1e2127, 0.24], Visor: [0x0b0e12, 0.97] };
const paint = (table) => (name) => { const e = table[name]; if (!e) throw new Error(`no colour for material ${name}`); return { col: hex(e[0]), gloss: e[1] }; };

async function main() {
  const THREE = await import(pathToFileURL(path.join(ROOT, 'src', 'renderer', 'trainer', 'vendor', 'three.module.min.js')).href);
  const K = require('./rig')(THREE);
  const { Matrix4, Vector3, Quaternion } = THREE;
  const V = (x, y, z) => (Array.isArray(x) ? new Vector3(x[0], x[1], x[2]) : new Vector3(x, y, z));

  const cache = {};
  function load(name) {
    if (cache[name]) return cache[name];
    const g = readGlb(path.join(RAW, name, `${name}.glb`));
    const rig = K.loadRig(g);
    return (cache[name] = { name, g, rig, prims: primitives(g) });
  }

  /**
   * A model's triangles in its own world, in a pose (the rest pose when none
   * is given). A skinned mesh is skinned; the mesh keeps the joints and
   * weights too when `keepSkin` is set.
   */
  function gather(model, colours, pose, keepSkin) {
    const { rig, prims } = model;
    const W = K.world(rig, pose || K.rest(rig));
    const out = MESH.empty(!!keepSkin);
    const v = new Vector3(), n = new Vector3(), o = new Vector3(), on = new Vector3(), m = new Matrix4();
    for (const pr of prims) {
      const c = colours(pr.material.name);
      if (!c) continue;
      const part = MESH.empty(!!keepSkin);
      const sk = pr.skin >= 0 ? rig.skins[pr.skin] : null;
      const skinM = sk ? sk.joints.map((j, k) => new Matrix4().multiplyMatrices(W[j], sk.ibm[k])) : null;
      for (let i = 0; i < pr.count; i++) {
        if (sk) {
          o.set(0, 0, 0); on.set(0, 0, 0);
          for (let k = 0; k < 4; k++) {
            const w = pr.weights[i * 4 + k];
            if (!w) continue;
            m.copy(skinM[pr.joints[i * 4 + k]]);
            o.addScaledVector(v.fromArray(pr.pos, i * 3).applyMatrix4(m), w);
            on.addScaledVector(n.fromArray(pr.nrm, i * 3).transformDirection(m), w);
          }
        } else {
          o.fromArray(pr.pos, i * 3).applyMatrix4(W[pr.node]);
          on.fromArray(pr.nrm, i * 3).transformDirection(W[pr.node]);
        }
        on.normalize();
        part.pos.push(o.x, o.y, o.z); part.nrm.push(on.x, on.y, on.z); part.col.push(c.col[0], c.col[1], c.col[2]); part.gloss.push(c.gloss);
        if (keepSkin) for (let k = 0; k < 4; k++) { part.joints.push(sk ? sk.joints[pr.joints[i * 4 + k]] : 0); part.weights.push(sk ? pr.weights[i * 4 + k] : (k === 0 ? 1 : 0)); }
      }
      part.idx = pr.idx.slice();
      MESH.append(out, part);
    }
    return out;
  }
  const jointPos = (model, name) => K.posOf(K.world(model.rig, K.rest(model.rig)), model.rig.byName[name]);

  // ── The hands ────────────────────────────────────────────────────────────
  // The figure's own arms, posed onto each weapon. A hand is placed by where
  // its wrist goes, which way its knuckles lie from the wrist (F), which way
  // its palm looks (N), where its elbow is, and how far each finger curls.
  const swat = load('swat');
  const SR = swat.rig;
  const J = (n) => { const i = SR.byName[n]; if (i == null) throw new Error(`no joint ${n}`); return i; };
  const FINGERS = ['Index', 'Middle', 'Ring', 'Pinky'];
  const armJoints = (side) => ['UpperArm', 'LowerArm', 'Wrist', ...FINGERS.flatMap((f) => [1, 2, 3, 4].map((k) => `${f}${k}`)), 'Thumb1', 'Thumb2', 'Thumb3'].map((n) => J(`${n}.${side}`));

  /** The hand's own frame in a pose: F to the knuckles, S to the thumb side, N out of the palm. */
  function handFrame(pose, side) {
    const W = K.world(SR, pose);
    const wrist = K.posOf(W, J(`Wrist.${side}`));
    const F = K.posOf(W, J(`Middle2.${side}`)).sub(wrist).normalize();
    const S = K.posOf(W, J(`Index2.${side}`)).sub(K.posOf(W, J(`Pinky2.${side}`)));
    S.addScaledVector(F, -S.dot(F)).normalize();
    const N = side === 'L' ? new Vector3().crossVectors(F, S) : new Vector3().crossVectors(S, F);
    return { wrist, F, S, N: N.normalize() };
  }

  /** The fingers and the thumb curled, each angle in degrees: curl: { Index: [a, b, c], ..., thumb: { opp, in, curl: [a, b] } }. */
  function curlHand(pose, side, curl) {
    const c = curl || {};
    for (const f of FINGERS) {
      const a = c[f] || c.all || [0, 0, 0];
      const h = handFrame(pose, side);
      const axis = new Vector3().crossVectors(h.F, h.N).normalize();   // turning about it bends toward the palm
      // A little spread or squeeze first, about the palm's normal.
      const sp = (c.spread && c.spread[f]) || 0;
      if (sp) K.turnWorld(SR, pose, J(`${f}2.${side}`), new Quaternion().setFromAxisAngle(h.N, deg(sp) * (side === 'L' ? 1 : -1)));
      for (let k = 0; k < 3; k++) if (a[k]) K.turnWorld(SR, pose, J(`${f}${k + 2}.${side}`), new Quaternion().setFromAxisAngle(axis, deg(a[k])));
    }
    const t = c.thumb;
    if (t) {
      const h = handFrame(pose, side);
      const sgn = side === 'L' ? 1 : -1;
      if (t.opp) K.turnWorld(SR, pose, J(`Thumb1.${side}`), new Quaternion().setFromAxisAngle(h.F, deg(t.opp) * sgn));
      if (t.in) K.turnWorld(SR, pose, J(`Thumb1.${side}`), new Quaternion().setFromAxisAngle(h.N, deg(t.in) * sgn));
      if (t.down) K.turnWorld(SR, pose, J(`Thumb1.${side}`), new Quaternion().setFromAxisAngle(h.S, deg(t.down) * sgn));
      if (t.curl) {
        const W = K.world(SR, pose);
        const dir = K.posOf(W, J(`Thumb3.${side}`)).sub(K.posOf(W, J(`Thumb2.${side}`))).normalize();
        const axis = new Vector3().crossVectors(dir, h.N).normalize();
        K.turnWorld(SR, pose, J(`Thumb2.${side}`), new Quaternion().setFromAxisAngle(axis, deg(t.curl[0])));
        K.turnWorld(SR, pose, J(`Thumb3.${side}`), new Quaternion().setFromAxisAngle(axis, deg(t.curl[1] || 0)));
      }
    }
  }

  /** The wrist turned so the hand's frame is (F, N), the forearm first rolled to follow it. */
  function setHand(pose, side, F, N) {
    const lower = J(`LowerArm.${side}`), wrist = J(`Wrist.${side}`);
    // Roll the forearm about its own length so the hand it carries looks as
    // near N as a roll can bring it: what is left for the wrist is a bend.
    const W = K.world(SR, pose);
    const axis = K.posOf(W, wrist).sub(K.posOf(W, lower)).normalize();
    const h = handFrame(pose, side);
    const flat = (v) => v.clone().addScaledVector(axis, -v.dot(axis));
    const a = flat(h.N), b = flat(N);
    if (a.length() > 1e-3 && b.length() > 1e-3) {
      a.normalize(); b.normalize();
      const ang = Math.atan2(new Vector3().crossVectors(a, b).dot(axis), a.dot(b));
      K.turnWorld(SR, pose, lower, new Quaternion().setFromAxisAngle(axis, ang * 0.85));
    }
    const h2 = handFrame(pose, side);
    K.turnWorld(SR, pose, wrist, K.frameTurn(h2.F, h2.N, F, N));
  }

  /**
   * One forearm and hand for a view model, in the weapon's own space. The
   * hand is set to (F, N), curled, and moved so its middle knuckle is at
   * `knuckle`; the forearm runs from the wrist along `elbow` (a direction),
   * stretched to `long` times its length so its cut end is out of the frame.
   */
  function viewArm(side, spec) {
    const pose = K.rest(SR);
    const lower = J(`LowerArm.${side}`), wrist = J(`Wrist.${side}`);
    const back = V(spec.elbow).normalize();
    K.aim(SR, pose, lower, wrist, back.clone().negate());
    setHand(pose, side, V(spec.F).normalize(), V(spec.N).normalize());
    curlHand(pose, side, spec.curl);
    const set = new Set(armJoints(side).slice(1));       // not the upper arm: the sleeve ends at the elbow
    const all = gather(swat, paint(ARMS), pose, true);
    const arm = MESH.filter(all, (a, b, c) => [a, b, c].every((i) => { let s = 0; for (let k = 0; k < 4; k++) if (set.has(all.joints[i * 4 + k])) s += all.weights[i * 4 + k]; return s > 0.5; }));
    arm.joints = null; arm.weights = null;
    const W = K.world(SR, pose);
    const kn = K.posOf(W, J(`Middle2.${side}`)), wr = K.posOf(W, wrist);
    const sc = spec.scale || 0.8, long = spec.long || 1.7;
    const k = V(spec.knuckle);
    MESH.transform(THREE, arm, new Matrix4().makeTranslation(k.x, k.y, k.z).multiply(new Matrix4().makeScale(sc, sc, sc)).multiply(new Matrix4().makeTranslation(-kn.x, -kn.y, -kn.z)));
    const w = wr.sub(kn).multiplyScalar(sc).add(k);      // where the wrist came to
    for (let i = 0; i < arm.pos.length; i += 3) {
      const t = (arm.pos[i] - w.x) * back.x + (arm.pos[i + 1] - w.y) * back.y + (arm.pos[i + 2] - w.z) * back.z - 0.035;
      if (t > 0) { arm.pos[i] += back.x * t * (long - 1); arm.pos[i + 1] += back.y * t * (long - 1); arm.pos[i + 2] += back.z * t * (long - 1); }
    }
    return arm;
  }

  // ── The guns ─────────────────────────────────────────────────────────────
  // Each view model in its own space: the barrel down -z, up +y, metres, the
  // origin near the grip. `hip` is where pose() holds it at rest.
  const rotX = (d) => new Matrix4().makeRotationX(deg(d));
  const rotY = (d) => new Matrix4().makeRotationY(deg(d));
  const move = (x, y, z) => new Matrix4().makeTranslation(x, y, z);
  const scale = (s) => new Matrix4().makeScale(s, s, s);

  const FIST = { Index: [62, 78, 40], Middle: [70, 82, 44], Ring: [74, 84, 46], Pinky: [78, 86, 48] };
  const GUNS = {
    'heavy-rifle': {
      parts: [{ model: 'p-rifle-west', colours: KIT }],
      muzzle: () => jointPos(load('p-rifle-west'), 'Attach_Muzzle').add(V(0, 0, -0.045)),
      right: { knuckle: [0.03, -0.085, 0.105], elbow: [0.34, -0.78, 0.52], F: [0.07, -0.22, -0.97], N: [-1, 0, -0.05], curl: { ...FIST, Index: [40, 50, 25], thumb: { opp: 14, in: -78, curl: [8, 8] } } },
      left: { knuckle: [0.015, -0.04, -0.15], elbow: [-0.5, -0.55, 0.67], F: [0.66, 0.27, -0.7], N: [-0.2, 0.95, 0.18], curl: { Index: [55, 60, 30], Middle: [60, 62, 32], Ring: [62, 64, 34], Pinky: [64, 66, 36], thumb: { opp: 20, in: 0, curl: [10, 10] } } },
    },
    'silenced-rifle': {
      parts: [{ model: 'p-ar-west', colours: KIT }, { model: 'p-supp-a', colours: KIT, at: ['p-ar-west', 'Attach_Muzzle'] }],
      muzzle: () => jointPos(load('p-ar-west'), 'Attach_Muzzle').add(V(0, 0, -0.152)),
      right: { knuckle: [0.03, -0.085, 0.105], elbow: [0.34, -0.78, 0.52], F: [0.07, -0.22, -0.97], N: [-1, 0, -0.05], curl: { ...FIST, Index: [40, 50, 25], thumb: { opp: 14, in: -78, curl: [8, 8] } } },
      left: { knuckle: [0.015, -0.04, -0.15], elbow: [-0.5, -0.55, 0.67], F: [0.66, 0.27, -0.7], N: [-0.2, 0.95, 0.18], curl: { Index: [55, 60, 30], Middle: [60, 62, 32], Ring: [62, 64, 34], Pinky: [64, 66, 36], thumb: { opp: 20, in: 0, curl: [10, 10] } } },
    },
    'heavy-pistol': {
      parts: [{ model: 'revolver', colours: REVOLVER, matrix: rotY(90).multiply(scale(0.16)) }],
      muzzle: null,
      right: { knuckle: [0.027, -0.023, 0.0], elbow: [0.34, -0.78, 0.52], F: [0.07, -0.22, -0.97], N: [-1, 0, -0.05], curl: { ...FIST, Index: [40, 50, 25], thumb: { opp: 14, in: -78, curl: [8, 8] } } },
    },
    sidearm: {
      parts: [{ model: 'p-pistol-west-b', colours: KIT }],
      muzzle: () => jointPos(load('p-pistol-west-b'), 'Attach_Muzzle'),
      right: { knuckle: [0.024, -0.045, 0.022], elbow: [0.34, -0.78, 0.52], F: [0.07, -0.22, -0.97], N: [-1, 0, -0.05], curl: { ...FIST, Index: [40, 50, 25], thumb: { opp: 14, in: -78, curl: [8, 8] } } },
    },
    knife: {
      parts: [{ model: 'p-kabar', colours: KIT, matrix: rotX(-40) }],
      muzzle: () => V(0, 0.17, -0.14),
      right: { knuckle: [0.022, -0.059, 0.023], elbow: [0.35, -0.45, 0.8], F: [0, -0.64, -0.77], N: [-1, 0, 0], curl: { ...FIST, thumb: { opp: 70, in: 20, curl: [30, 30] } } },
    },
  };

  function buildGun(id) {
    const d = GUNS[id];
    const gun = MESH.empty(false);
    for (const p of d.parts) {
      const part = gather(load(p.model), paint(p.colours));
      let m = p.matrix ? p.matrix.clone() : new Matrix4();
      if (p.at) { const a = jointPos(load(p.at[0]), p.at[1]); m = move(a.x, a.y, a.z).multiply(m); }
      MESH.transform(THREE, part, m);
      MESH.append(gun, part);
    }
    const bd = MESH.bounds(gun);
    const all = MESH.append(MESH.empty(false), MESH.smooth(gun, 38));
    if (d.right) MESH.append(all, MESH.smooth(viewArm('R', d.right), 62));
    if (d.left) MESH.append(all, MESH.smooth(viewArm('L', d.left), 62));
    const muzzle = d.muzzle ? d.muzzle() : V(0, (bd.lo[1] + bd.hi[1]) / 2, bd.lo[2]);
    return { id, mesh: all, bare: gun, gunBounds: bd, muzzle: [muzzle.x, muzzle.y, muzzle.z].map((v) => +v.toFixed(4)) };
  }

  const guns = {};
  for (const id of Object.keys(GUNS)) {
    const b = buildGun(id);
    guns[id] = b;
    console.log(id.padEnd(15), 'vertices', b.mesh.pos.length / 3, 'triangles', b.mesh.idx.length / 3, 'gun', b.gunBounds.lo.map((v) => v.toFixed(3)).join(' '), '..', b.gunBounds.hi.map((v) => v.toFixed(3)).join(' '), 'muzzle', b.muzzle.join(' '));
  }

  // ── The figure ───────────────────────────────────────────────────────────
  // The bots' figure: the source's mesh and skeleton, holding a rifle. The
  // source's clips give the legs and the fall; the upper body is posed here,
  // aiming, with each hand reached onto the rifle. The fingers are curled
  // once and baked into the mesh (they ride the wrists), so the page's
  // skeleton is 22 bones.
  const skin = SR.skins[0];
  const jointSet = new Set(skin.joints);
  const ibmOf = new Map(skin.joints.map((j, k) => [j, skin.ibm[k]]));
  const restW = K.world(SR, K.rest(SR));
  // The bind pose in the world: metres, y up, facing +z.
  const Mb = new Matrix4().multiplyMatrices(restW[J('Root')], ibmOf.get(J('Root')));
  Mb.setPosition(0, 0, 0);
  const bindPose = K.rest(SR);
  {
    const W = new Array(SR.nodes.length);
    const m = new Matrix4();
    for (const i of SR.order) {
      const par = SR.nodes[i].parent;
      const pw = par < 0 ? new Matrix4() : W[par];
      if (jointSet.has(i)) {
        W[i] = new Matrix4().multiplyMatrices(Mb, ibmOf.get(i).clone().invert());
        m.copy(pw).invert().multiply(W[i]).decompose(bindPose.t[i], bindPose.r[i], bindPose.s[i]);
      } else {
        m.compose(bindPose.t[i], bindPose.r[i], bindPose.s[i]);
        W[i] = new Matrix4().multiplyMatrices(pw, m);
      }
    }
  }
  const bindW = K.world(SR, bindPose);
  const bindRot = (name) => K.rotOf(bindW, J(name));
  const fingerJoints = (side) => [...FINGERS.flatMap((f) => [1, 2, 3, 4].map((k) => `${f}${k}`)), 'Thumb1', 'Thumb2', 'Thumb3'].map((n) => J(`${n}.${side}`));

  // The rifle the bots hold: the carbine, a little small, in its own space.
  const BOT_GUN = { model: 'p-ar-west', size: 0.9, butt: [0, 0.02, 0.33], right: { knuckle: [0.03, -0.08, 0.075], F: [0.07, -0.22, -0.97], N: [-1, 0, -0.05] }, left: { knuckle: [0.012, -0.036, -0.1], F: [0.66, 0.27, -0.7], N: [-0.2, 0.95, 0.18] } };
  const BOT_CURL = {
    R: { ...FIST, Index: [45, 55, 25], thumb: { opp: 50, in: 10, curl: [20, 20] } },
    L: { Index: [55, 60, 30], Middle: [60, 62, 32], Ring: [62, 64, 34], Pinky: [64, 66, 36], thumb: { opp: 20, in: 0, curl: [10, 10] } },
  };
  // The bind pose with the fingers curled: what the mesh is baked in.
  const curled = K.clone(bindPose);
  curlHand(curled, 'R', BOT_CURL.R);
  curlHand(curled, 'L', BOT_CURL.L);
  const palm = K.posOf(bindW, J('Middle2.R')).distanceTo(K.posOf(bindW, J('Wrist.R')));
  /** A pose's fingers put back to the baked curl, so the hand's frame is the mesh's. */
  const bakeFingers = (p) => { for (const side of ['L', 'R']) for (const j of fingerJoints(side)) { p.r[j].copy(curled.r[j]); p.t[j].copy(curled.t[j]); } };

  const qAxis = (x, y, z, d) => new Quaternion().setFromAxisAngle(new Vector3(x, y, z).normalize(), deg(d));
  /** Where the rifle is in the world for a pose: the right hand holds its grip. */
  function gunWorld(p) {
    const h = handFrame(p, 'R');
    const g = BOT_GUN.right;
    const R = new Matrix4().makeRotationFromQuaternion(K.frameTurn(V(g.F).normalize(), V(g.N).normalize(), h.F, h.N));
    const kn = K.posOf(K.world(SR, p), J('Middle2.R'));
    const k = V(g.knuckle).multiplyScalar(BOT_GUN.size).applyMatrix4(R);
    return new Matrix4().makeTranslation(kn.x - k.x, kn.y - k.y, kn.z - k.z).multiply(R);
  }

  /**
   * The upper body set to aim the rifle, over any pose of the legs: the
   * spine squared up and bladed a little, the head level, the stock in the
   * right shoulder, each hand reached onto the rifle. `keep` is how much of
   * the base pose's own spine stays (a run leans and twists).
   */
  function aimUpper(base, o) {
    const opt = { keep: 0, lean: 7, blade: -22, aimYaw: 5, aimPitch: 0, ...o };
    const p = K.clone(base);
    bakeFingers(p);
    // Longer upper arms: the source's are short for a rifle.
    for (const side of ['L', 'R']) {
      p.t[J(`LowerArm.${side}`)].copy(bindPose.t[J(`LowerArm.${side}`)]).multiplyScalar(1.3);
      p.t[J(`Wrist.${side}`)].copy(bindPose.t[J(`Wrist.${side}`)]).multiplyScalar(1.08);
      for (const n of ['Shoulder', 'UpperArm', 'LowerArm', 'Wrist']) p.r[J(`${n}.${side}`)].copy(bindPose.r[J(`${n}.${side}`)]);
    }
    const spine = (name, lean, blade) => {
      const W = K.world(SR, p);
      const want = qAxis(0, 1, 0, blade).multiply(qAxis(1, 0, 0, lean)).multiply(bindRot(name));
      K.setWorldRot(SR, p, J(name), want.slerp(K.rotOf(W, J(name)), opt.keep));
    };
    spine('Torso', opt.lean * 0.6, opt.blade * 0.5);
    spine('Chest', opt.lean, opt.blade);
    const keep = opt.keep; opt.keep = 0;
    spine('Neck', opt.lean * 0.6, opt.blade * 0.3);
    spine('Head', 9, 0);
    opt.keep = keep;
    // The rifle: its butt in the right shoulder, pointing ahead and a touch inward.
    let W = K.world(SR, p);
    const sh = K.posOf(W, J('UpperArm.R'));
    const Rg = new Matrix4().makeRotationFromQuaternion(qAxis(0, 1, 0, 180 + opt.aimYaw).multiply(qAxis(1, 0, 0, opt.aimPitch)));
    const butt = sh.clone().add(V(0.04, -0.012, 0.05));
    const origin = butt.sub(V(BOT_GUN.butt).multiplyScalar(BOT_GUN.size).applyMatrix4(Rg));
    const at = (v) => V(v).multiplyScalar(BOT_GUN.size).applyMatrix4(Rg).add(origin);
    const dirOf = (v) => V(v).normalize().transformDirection(Rg);
    // The right hand on the grip.
    const gr = BOT_GUN.right;
    const Fr = dirOf(gr.F), Nr = dirOf(gr.N);
    K.reach(SR, p, J('UpperArm.R'), J('LowerArm.R'), J('Wrist.R'), at(gr.knuckle).addScaledVector(Fr, -palm), sh.clone().add(V(-0.08, -0.6, 0.02)));
    setHand(p, 'R', Fr, Nr);
    // The left hand under the handguard, wherever the right hand's hold put the rifle.
    const G = gunWorld(p);
    const gl = BOT_GUN.left;
    const Fl = V(gl.F).normalize().transformDirection(G), Nl = V(gl.N).normalize().transformDirection(G);
    W = K.world(SR, p);
    const shL = K.posOf(W, J('UpperArm.L'));
    K.reach(SR, p, J('UpperArm.L'), J('LowerArm.L'), J('Wrist.L'), V(gl.knuckle).multiplyScalar(BOT_GUN.size).applyMatrix4(G).addScaledVector(Fl, -palm), shL.clone().add(V(0.2, -0.5, 0.15)));
    setHand(p, 'L', Fl, Nl);
    return p;
  }

  /**
   * A pose lowered by `drop` metres at the hips, each foot moved by `feet`
   * ([sideways, ahead] in metres, the figure's own left and ahead) and the
   * knees bent to suit.
   */
  function crouch(base, drop, o) {
    const opt = { fwd: 0.02, feet: {}, ...o };
    const p = K.clone(base);
    const W0 = K.world(SR, p);
    const local = (node, v) => {
      const par = SR.nodes[node].parent;
      const sc = new Vector3().setFromMatrixScale(W0[par]).x || 1;
      return v.applyQuaternion(K.rotOf(W0, par).invert()).multiplyScalar(1 / sc);
    };
    const body = J('Body');
    p.t[body].add(local(body, V(0, -drop, opt.fwd)));
    for (const side of ['L', 'R']) {
      const up = J(`UpperLeg.${side}`), low = J(`LowerLeg.${side}`), end = J(`LowerLeg.${side}_end`), foot = J(`Foot.${side}`);
      const f = opt.feet[side] || [0, 0];
      const shift = V(f[0], 0, f[1]);
      p.t[foot].add(local(foot, shift.clone()));
      const ankle = K.posOf(W0, end).add(shift);
      const hip = K.posOf(K.world(SR, p), up);
      K.reach(SR, p, up, low, end, ankle, hip.clone().add(V(side === 'L' ? 0.1 : -0.1, -0.2, 1)));
    }
    return p;
  }

  // The page's skeleton: every joint that carries the mesh, less the fingers.
  const fingerOf = new Map();
  for (const side of ['L', 'R']) for (const j of fingerJoints(side)) fingerOf.set(j, J(`Wrist.${side}`));
  const figAll = gather(swat, paint(SWAT), curled, true);
  for (let i = 0; i < figAll.joints.length; i++) if (fingerOf.has(figAll.joints[i])) figAll.joints[i] = fingerOf.get(figAll.joints[i]);
  const used = new Set();
  for (let i = 0; i < figAll.joints.length; i++) if (figAll.weights[i] > 0) used.add(figAll.joints[i]);
  // A used joint's parents are kept too, so the tree holds together.
  const keepJoint = new Set();
  for (const j of used) { let k = j; while (k >= 0 && jointSet.has(k)) { keepJoint.add(k); k = SR.nodes[k].parent; } }
  for (const j of fingerOf.keys()) keepJoint.delete(j);
  const bones = SR.order.filter((i) => keepJoint.has(i));
  const boneIndex = new Map(bones.map((j, k) => [j, k]));
  const boneParent = bones.map((j) => { let k = SR.nodes[j].parent; while (k >= 0 && !boneIndex.has(k)) k = SR.nodes[k].parent; return k < 0 ? -1 : boneIndex.get(k); });

  // The figure's own space: metres, feet on the ground, facing -z, sized so
  // the helmet's middle stands at the head hitbox's height when it aims.
  const HIT = JSON.parse(fs.readFileSync(path.join(ROOT, 'src', 'shared', 'trainer-data.json'), 'utf8')).hitbox;
  const HEAD_Y = HIT.head.center.value, CROUCH = HIT.crouchScale.value;
  const helmet = (() => {
    const head = J('Head'), hy = K.posOf(bindW, head).y;
    const lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
    for (let i = 0; i < figAll.pos.length / 3; i++) {
      let w = 0;
      for (let k = 0; k < 4; k++) if (figAll.joints[i * 4 + k] === head) w += figAll.weights[i * 4 + k];
      if (w < 0.9 || figAll.pos[i * 3 + 1] < hy + 0.03) continue;
      for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], figAll.pos[i * 3 + a]); hi[a] = Math.max(hi[a], figAll.pos[i * 3 + a]); }
    }
    return { centre: V((lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2), size: [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]] };
  })();
  const helmetAt = (p) => helmet.centre.clone().applyMatrix4(new Matrix4().multiplyMatrices(K.world(SR, p)[J('Head')], bindW[J('Head')].clone().invert()));

  // Standing: the source's level stance (feet under the hips, so the legs sit
  // in their hitbox), the knees eased and the left foot a little ahead.
  const idleClip = SR.clips.Idle_Neutral;
  const STAND = { feet: { L: [0, 0.1], R: [0, -0.07] } }, KNEEL = { feet: { L: [0.01, 0.2], R: [0, -0.16] } };
  const standing = (t) => aimUpper(crouch(K.sample(SR, idleClip, t), 0.035, STAND));
  const SIZE = HEAD_Y / helmetAt(standing(0)).y;
  const G0 = new Matrix4().makeRotationY(Math.PI).multiply(new Matrix4().makeScale(SIZE, SIZE, SIZE));
  const G0i = G0.clone().invert();

  /** One frame for the page: each bone's turn from its parent and its place in its parent, the head over the origin. */
  function frame(p, centre) {
    const W = K.world(SR, p);
    const c = centre || helmetAt(p);
    const shift = new Matrix4().makeTranslation(c.x * SIZE, 0, c.z * SIZE);   // G0 turns x and z over: + here is - there
    const D = [], C = [];
    const s3 = new Vector3();
    for (const j of bones) {
      const B = new Matrix4().copy(shift).multiply(G0).multiply(W[j]).multiply(bindW[j].clone().invert()).multiply(G0i);
      const q = new Quaternion(), t = new Vector3();
      B.decompose(t, q, s3);
      if (Math.abs(s3.x - 1) > 2e-3 || Math.abs(s3.y - 1) > 2e-3) throw new Error(`bone ${SR.nodes[j].name} is not rigid (${s3.toArray()})`);
      D.push(q);
      C.push(K.posOf(bindW, j).applyMatrix4(G0).applyMatrix4(B));
    }
    const out = [];
    bones.forEach((j, k) => {
      const par = boneParent[k];
      const q = par < 0 ? D[k].clone() : D[par].clone().invert().multiply(D[k]);
      const l = par < 0 ? C[k].clone() : C[k].clone().sub(C[par]).applyQuaternion(D[par].clone().invert());
      out.push(q.x, q.y, q.z, q.w, l.x, l.y, l.z);
    });
    return out;
  }

  // The clips. Each is a list of frames, evenly spaced over its time.
  const CLIPS = {};
  const addClip = (name, frames, seconds, loop) => { CLIPS[name] = { frames, seconds, loop }; };
  {
    const n = 10;
    addClip('aim', Array.from({ length: n }, (_, i) => frame(standing((i / n) * idleClip.duration))), idleClip.duration, true);
  }
  // Crouched: the hips dropped until the helmet's middle is at the crouched head's height.
  const crouched = (t) => {
    const base = K.sample(SR, idleClip, t);
    let drop = 0.36;
    let p = null;
    for (let i = 0; i < 9; i++) {
      p = aimUpper(crouch(base, drop, KNEEL), { lean: 16 });
      drop += helmetAt(p).y - (HEAD_Y * CROUCH) / SIZE;
    }
    return p;
  };
  {
    const n = 6;
    addClip('crouch', Array.from({ length: n }, (_, i) => frame(crouched((i / n) * idleClip.duration))), idleClip.duration, true);
  }
  for (const [name, src] of [['runF', 'Run'], ['runB', 'Run_Back'], ['runL', 'Run_Left'], ['runR', 'Run_Right']]) {
    const clip = SR.clips[src];
    const n = 16;
    addClip(name, Array.from({ length: n }, (_, i) => frame(aimUpper(K.sample(SR, clip, (i / n) * clip.duration), { keep: 0.3, lean: 12 }))), clip.duration, true);
  }
  {
    // The fall: the source's own, the rifle staying in the right hand. It
    // falls from where it stood, so every frame is centred as the first is.
    const clip = SR.clips.Death;
    const n = 14, upTo = 0.62;
    const first = K.sample(SR, clip, 0);
    const c0 = helmetAt(first);
    const fr = [];
    for (let i = 0; i < n; i++) {
      const p = K.sample(SR, clip, (i / (n - 1)) * upTo * clip.duration);
      bakeFingers(p);
      fr.push(frame(p, c0));
    }
    addClip('fall', fr, upTo * clip.duration, false);
  }

  // The mesh: the body in its bind pose with the fingers curled, and the
  // rifle laid where the right hand holds it in that pose.
  const figure = MESH.empty(true);
  {
    const body = figAll;
    for (let i = 0; i < body.joints.length; i++) body.joints[i] = boneIndex.get(body.joints[i]) || 0;
    MESH.append(figure, body);
    const rifle = gather(load(BOT_GUN.model), paint(KIT));
    MESH.transform(THREE, rifle, gunWorld(curled).multiply(scale(BOT_GUN.size)));
    const held = MESH.empty(true);
    MESH.append(held, rifle);
    const wr = boneIndex.get(J('Wrist.R'));
    for (let i = 0; i < held.joints.length; i += 4) held.joints[i] = wr;
    MESH.append(figure, held);
    MESH.transform(THREE, figure, G0);
  }
  const figureMesh = MESH.smooth(figure, 48);
  const boneBind = bones.map((j) => K.posOf(bindW, j).applyMatrix4(G0).toArray().map((v) => +v.toFixed(5)));
  console.log('figure'.padEnd(15), 'vertices', figureMesh.pos.length / 3, 'triangles', figureMesh.idx.length / 3, 'bones', bones.length, 'size', SIZE.toFixed(4), 'helmet', helmet.size.map((v) => (v * SIZE).toFixed(3)).join(' x '));
  console.log('  bones:', bones.map((j, k) => `${k} ${SR.nodes[j].name}<${boneParent[k]}`).join(', '));
  console.log('  clips:', Object.entries(CLIPS).map(([k, c]) => `${k} ${c.frames.length} frames ${c.seconds.toFixed(2)} s`).join(', '));

  /** A pose's mesh as the page would skin it, for the previews. */
  function posed(fr) {
    const D = [], C = [];
    bones.forEach((j, k) => {
      const q = new Quaternion(fr[k * 7], fr[k * 7 + 1], fr[k * 7 + 2], fr[k * 7 + 3]), l = new Vector3(fr[k * 7 + 4], fr[k * 7 + 5], fr[k * 7 + 6]);
      const par = boneParent[k];
      D.push(par < 0 ? q : D[par].clone().multiply(q));
      C.push(par < 0 ? l : l.applyQuaternion(D[par]).add(C[par]));
    });
    const out = MESH.empty(false);
    const v = new Vector3(), o = new Vector3(), nn = new Vector3(), on = new Vector3();
    const n = figureMesh.pos.length / 3;
    for (let i = 0; i < n; i++) {
      o.set(0, 0, 0); on.set(0, 0, 0);
      for (let k = 0; k < 4; k++) {
        const w = figureMesh.weights[i * 4 + k];
        if (!w) continue;
        const b = figureMesh.joints[i * 4 + k];
        v.fromArray(figureMesh.pos, i * 3).sub(V(boneBind[b])).applyQuaternion(D[b]).add(C[b]);
        o.addScaledVector(v, w);
        on.addScaledVector(nn.fromArray(figureMesh.nrm, i * 3).applyQuaternion(D[b]), w);
      }
      on.normalize();
      out.pos.push(o.x, o.y, o.z); out.nrm.push(on.x, on.y, on.z);
      out.col.push(figureMesh.col[i * 3], figureMesh.col[i * 3 + 1], figureMesh.col[i * 3 + 2]); out.gloss.push(figureMesh.gloss[i]);
    }
    out.idx = figureMesh.idx.slice();
    return out;
  }

  // How the figure sits in its hitboxes (trainer-data.json hitbox): the
  // helmet's middle against the head's sphere, and how far the body and the
  // legs reach sideways against their capsules. Said on every build.
  {
    const wr = boneIndex.get(J('Wrist.R'));
    const say = (name, at, k) => {
      const m = posed(CLIPS[name].frames[at]);
      const head = boneIndex.get(J('Head'));
      const lo = [9, 9, 9], hi = [-9, -9, -9];
      let body = 0, legs = 0, top = 0;
      for (let i = 0; i < m.pos.length / 3; i++) {
        const x = m.pos[i * 3], y = m.pos[i * 3 + 1], z = m.pos[i * 3 + 2];
        top = Math.max(top, y);
        if (figureMesh.joints[i * 4] === wr && figureMesh.weights[i * 4] > 0.99 && figureMesh.gloss[i] > 0.25) continue;   // the rifle
        if (figureMesh.joints[i * 4] === head && figureMesh.weights[i * 4] > 0.9 && y > 1.5 * k) for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], m.pos[i * 3 + a]); hi[a] = Math.max(hi[a], m.pos[i * 3 + a]); }
        if (y > HIT.body.bottom.value * k && y < HIT.body.top.value * k) body = Math.max(body, Math.abs(x));
        if (y < HIT.legs.top.value * k) legs = Math.max(legs, Math.abs(x));
      }
      console.log(`  ${name} ${at}`.padEnd(12), 'helmet middle', [0, 1, 2].map((a) => ((lo[a] + hi[a]) / 2).toFixed(3)).join(' '), `(head ${(HEAD_Y * k).toFixed(2)}, r ${HIT.head.radius.value})`, 'top', top.toFixed(2), 'body reaches', body.toFixed(2), `(r ${HIT.body.radius.value})`, 'legs', legs.toFixed(2), `(r ${HIT.legs.radius.value})`);
    };
    say('aim', 0, 1); say('aim', 5, 1); say('crouch', 0, CROUCH); say('runF', 4, 1); say('runL', 4, 1); say('runR', 12, 1); say('runB', 8, 1);
  }

  // ── What the page loads ──────────────────────────────────────────────────
  const header = '// Made by scripts/trainer-models/build.js from the sources named in\n// native/trainer-models-NOTICE.txt. Not edited by hand: change the script and run it again.\n';
  if (!args.includes('--dry')) {
    fs.mkdirSync(OUT, { recursive: true });
    const gunsOut = {};
    for (const id of Object.keys(guns)) gunsOut[id] = { ...MESH.pack(guns[id].mesh), muzzle: guns[id].muzzle };
    fs.writeFileSync(path.join(OUT, 'guns.js'), `${header}export const GUNS = ${JSON.stringify(gunsOut)};\n`);
    const clips = {};
    const all = [];
    for (const [name, c] of Object.entries(CLIPS)) {
      clips[name] = { at: all.length, frames: c.frames.length, seconds: +c.seconds.toFixed(4), loop: c.loop };
      for (const f of c.frames) all.push(f);
    }
    const poses = new Float32Array(all.length * bones.length * 7);
    all.forEach((f, i) => poses.set(f, i * bones.length * 7));
    const fig = {
      mesh: MESH.pack(figureMesh),
      bones: { names: bones.map((j) => SR.nodes[j].name), parent: boneParent, bind: boneBind },
      clips,
      poses: MESH.b64(poses),
    };
    fs.writeFileSync(path.join(OUT, 'figure.js'), `${header}export const FIGURE = ${JSON.stringify(fig)};\n`);
    for (const f of ['guns.js', 'figure.js']) console.log(f, (fs.statSync(path.join(OUT, f)).size / 1024).toFixed(0), 'KB');
  }

  if (PREVIEW) {
    fs.mkdirSync(PREVIEW, { recursive: true });
    if (args.includes('--clips')) {
      // The source's own clips, to choose from.
      for (const spec of args[args.indexOf('--clips') + 1].split(',')) {
        const [name, t] = spec.split('@');
        const clip = SR.clips[name];
        const m = gather(swat, paint(SWAT), K.sample(SR, clip, (+t || 0) * clip.duration));
        fs.writeFileSync(path.join(PREVIEW, `clip-${name}-${t || 0}.ply`), MESH.ply(m));
      }
      return;
    }
    for (const id of Object.keys(guns)) {
      fs.writeFileSync(path.join(PREVIEW, `gun-${id}.ply`), MESH.ply(guns[id].mesh));
      fs.writeFileSync(path.join(PREVIEW, `bare-${id}.ply`), MESH.ply(guns[id].bare));
      // As the first person camera sees it at rest (gun.js pose, hip).
      const long = id.endsWith('rifle');
      const fp = MESH.append(MESH.empty(false), guns[id].mesh);
      MESH.transform(THREE, fp, move(long ? 0.155 : 0.13, long ? -0.17 : -0.125, long ? -0.48 : -0.42).multiply(new Matrix4().makeRotationFromEuler(new THREE.Euler(long ? 0.05 : 0.02, 0.055, 0))));
      fs.writeFileSync(path.join(PREVIEW, `fp-${id}.ply`), MESH.ply(fp));
    }
    for (const [name, at] of [['aim', 0], ['crouch', 0], ['runF', 0], ['runF', 4], ['runF', 8], ['runL', 4], ['runR', 4], ['runB', 4], ['fall', 5], ['fall', 13]]) {
      fs.writeFileSync(path.join(PREVIEW, `fig-${name}-${at}.ply`), MESH.ply(posed(CLIPS[name].frames[at])));
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });

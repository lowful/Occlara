// A skeleton read from a .glb and posed in code: the node tree, clips sampled
// at a time, world matrices, and the few tools a pose is built with (aim a
// bone, a two bone reach, turn a joint to a frame, curl a finger). Used only
// at build time (build.js); nothing here runs in the app.
'use strict';
const { accessor } = require('./glb');

module.exports = function makeRig(THREE) {
  const { Matrix4, Quaternion, Vector3 } = THREE;
  const tmpS = new Vector3();

  function loadRig(g) {
    const nodes = g.json.nodes.map((n, i) => {
      const o = { i, name: n.name || '', parent: -1, children: n.children || [], t: new Vector3(), r: new Quaternion(), s: new Vector3(1, 1, 1) };
      if (n.matrix) new Matrix4().fromArray(n.matrix).decompose(o.t, o.r, o.s);
      else {
        if (n.translation) o.t.fromArray(n.translation);
        if (n.rotation) o.r.fromArray(n.rotation);
        if (n.scale) o.s.fromArray(n.scale);
      }
      return o;
    });
    for (const n of nodes) for (const c of n.children) nodes[c].parent = n.i;
    const order = [];
    const visit = (i) => { order.push(i); for (const c of nodes[i].children) visit(c); };
    nodes.forEach((n) => { if (n.parent < 0) visit(n.i); });
    const byName = {};
    nodes.forEach((n) => { if (!(n.name in byName)) byName[n.name] = n.i; });
    const skins = (g.json.skins || []).map((s) => {
      const m = accessor(g, s.inverseBindMatrices).array;
      return { joints: s.joints.slice(), ibm: s.joints.map((_, k) => new Matrix4().fromArray(Array.from(m.subarray(k * 16, k * 16 + 16)))) };
    });
    const clips = {};
    for (const a of g.json.animations || []) {
      let duration = 0;
      const channels = a.channels.map((c) => {
        const sm = a.samplers[c.sampler];
        const times = accessor(g, sm.input).array;
        const values = accessor(g, sm.output).array;
        duration = Math.max(duration, times[times.length - 1]);
        return { node: c.target.node, path: c.target.path, times, values, interp: sm.interpolation || 'LINEAR' };
      });
      clips[(a.name || '').split('|').pop()] = { name: a.name, duration, channels };
    }
    return { nodes, order, byName, skins, clips };
  }

  const rest = (rig) => ({ t: rig.nodes.map((n) => n.t.clone()), r: rig.nodes.map((n) => n.r.clone()), s: rig.nodes.map((n) => n.s.clone()) });
  const clone = (p) => ({ t: p.t.map((v) => v.clone()), r: p.r.map((v) => v.clone()), s: p.s.map((v) => v.clone()) });

  const qa = new Quaternion(), qb = new Quaternion();
  /** The pose a clip gives at `time` seconds, over the rest pose. */
  function sample(rig, clip, time) {
    const p = rest(rig);
    for (const c of clip.channels) {
      const n = c.times.length;
      const size = c.path === 'rotation' ? 4 : 3;
      const stride = c.interp === 'CUBICSPLINE' ? size * 3 : size;
      const off = c.interp === 'CUBICSPLINE' ? size : 0;
      let i = 0;
      while (i < n - 2 && time >= c.times[i + 1]) i++;
      const j = Math.min(n - 1, i + 1);
      const span = c.times[j] - c.times[i];
      let f = span > 0 ? (time - c.times[i]) / span : 0;
      f = Math.max(0, Math.min(1, f));
      if (c.interp === 'STEP') f = 0;
      const a = i * stride + off, b = j * stride + off;
      if (c.path === 'rotation') {
        qa.fromArray(c.values, a); qb.fromArray(c.values, b);
        p.r[c.node].copy(qa).slerp(qb, f).normalize();
      } else {
        const tgt = c.path === 'translation' ? p.t[c.node] : c.path === 'scale' ? p.s[c.node] : null;
        if (tgt) tgt.set(c.values[a] + (c.values[b] - c.values[a]) * f, c.values[a + 1] + (c.values[b + 1] - c.values[a + 1]) * f, c.values[a + 2] + (c.values[b + 2] - c.values[a + 2]) * f);
      }
    }
    return p;
  }

  /** Every node's world matrix for a pose. */
  function world(rig, p) {
    const W = new Array(rig.nodes.length);
    const m = new Matrix4();
    for (const i of rig.order) {
      m.compose(p.t[i], p.r[i], p.s[i]);
      const par = rig.nodes[i].parent;
      W[i] = par < 0 ? m.clone() : new Matrix4().multiplyMatrices(W[par], m);
    }
    return W;
  }
  const posOf = (W, i) => new Vector3().setFromMatrixPosition(W[i]);
  const rotOf = (W, i) => { const q = new Quaternion(); W[i].decompose(new Vector3(), q, tmpS); return q; };

  /** A joint's world rotation set to `q`, by its local rotation. */
  function setWorldRot(rig, p, i, q) {
    const par = rig.nodes[i].parent;
    if (par < 0) { p.r[i].copy(q); return; }
    const W = world(rig, p);
    p.r[i].copy(rotOf(W, par).invert().multiply(q)).normalize();
  }
  /** A joint turned by `q` in world space, about its own head. */
  function turnWorld(rig, p, i, q) {
    const W = world(rig, p);
    setWorldRot(rig, p, i, q.clone().multiply(rotOf(W, i)));
  }
  /** A bone swung, by the shortest turn, so that `child` lies along `dir` from it. */
  function aim(rig, p, i, child, dir) {
    const W = world(rig, p);
    const cur = posOf(W, child).sub(posOf(W, i)).normalize();
    turnWorld(rig, p, i, new Quaternion().setFromUnitVectors(cur, dir.clone().normalize()));
  }
  /**
   * A two bone reach: `a` (the upper bone), `b` (the lower) and `c` (the end)
   * are turned so that `c` lands on `target`, the middle joint bending toward
   * `pole` (a point in the world). Out of reach, it stretches as far as it can.
   */
  function reach(rig, p, a, b, c, target, pole) {
    let W = world(rig, p);
    const pa = posOf(W, a);
    const l1 = posOf(W, b).distanceTo(pa), l2 = posOf(W, c).distanceTo(posOf(W, b));
    const to = target.clone().sub(pa);
    const d = Math.max(Math.abs(l1 - l2) + 1e-4, Math.min(l1 + l2 - 1e-4, to.length()));
    const dirT = to.clone().normalize();
    const pd = pole.clone().sub(pa);
    pd.addScaledVector(dirT, -pd.dot(dirT)).normalize();
    const cosA = Math.max(-1, Math.min(1, (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d)));
    const elbow = pa.clone().addScaledVector(dirT, l1 * cosA).addScaledVector(pd, l1 * Math.sqrt(1 - cosA * cosA));
    aim(rig, p, a, b, elbow.clone().sub(pa));
    W = world(rig, p);
    aim(rig, p, b, c, pa.clone().addScaledVector(dirT, d).sub(posOf(W, b)));
    return to.length() - d;      // how far short it fell
  }
  /** The rotation that carries the frame (f0, n0) onto (f1, n1): each a forward and a normal, made square. */
  function frameTurn(f0, n0, f1, n1) {
    const basis = (f, n) => {
      const x = f.clone().normalize();
      const z = new Vector3().crossVectors(x, n).normalize();
      const y = new Vector3().crossVectors(z, x).normalize();
      return new Matrix4().makeBasis(x, y, z);
    };
    const m = basis(f1, n1).multiply(basis(f0, n0).invert());
    return new Quaternion().setFromRotationMatrix(m);
  }

  return { loadRig, rest, clone, sample, world, posOf, rotOf, setWorldRot, turnWorld, aim, reach, frameTurn };
};

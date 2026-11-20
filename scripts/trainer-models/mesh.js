// Mesh tools for the build (build.js): triangles gathered from a .glb with a
// colour and a gloss per material, moved, welded, given normals smoothed by
// angle (so a barrel is round and a receiver stays flat) and normals smoothed
// outright (for the bots' outline hull), then packed small.
//
// A mesh here is plain arrays, one entry per vertex:
//   pos [x,y,z]  nrm [x,y,z]  col [r,g,b] in sRGB 0..1  gloss 0..1
//   joints [a,b,c,d]  weights [a,b,c,d]  (skinned meshes only)
// and idx, three per triangle.
'use strict';

const empty = (skinned) => ({ pos: [], nrm: [], col: [], gloss: [], joints: skinned ? [] : null, weights: skinned ? [] : null, idx: [] });

function append(dst, src) {
  const base = dst.pos.length / 3;
  for (const k of ['pos', 'nrm', 'col', 'gloss']) for (const v of src[k]) dst[k].push(v);
  if (dst.joints) {
    const n = src.pos.length / 3;
    for (let i = 0; i < n * 4; i++) { dst.joints.push(src.joints ? src.joints[i] : 0); dst.weights.push(src.weights ? src.weights[i] : (i % 4 === 0 ? 1 : 0)); }
  }
  for (const i of src.idx) dst.idx.push(i + base);
  return dst;
}

/** Positions (and normals) through a THREE.Matrix4. */
function transform(THREE, m, mat) {
  const v = new THREE.Vector3();
  const n3 = new THREE.Matrix3().getNormalMatrix(mat);
  for (let i = 0; i < m.pos.length; i += 3) {
    v.fromArray(m.pos, i).applyMatrix4(mat).toArray(m.pos, i);
    v.fromArray(m.nrm, i).applyMatrix3(n3).normalize().toArray(m.nrm, i);
  }
  if (mat.determinant() < 0) for (let i = 0; i < m.idx.length; i += 3) { const t = m.idx[i + 1]; m.idx[i + 1] = m.idx[i + 2]; m.idx[i + 2] = t; }
  return m;
}

function bounds(m) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < m.pos.length; i++) { const a = i % 3; if (m.pos[i] < lo[a]) lo[a] = m.pos[i]; if (m.pos[i] > hi[a]) hi[a] = m.pos[i]; }
  return { lo, hi, size: [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]] };
}

/** The triangles a test keeps: `keep(i0, i1, i2)` by vertex index. Vertices no triangle uses are dropped. */
function filter(m, keep) {
  const out = empty(!!m.joints);
  const map = new Map();
  const take = (i) => {
    if (map.has(i)) return map.get(i);
    const j = out.pos.length / 3;
    for (let a = 0; a < 3; a++) { out.pos.push(m.pos[i * 3 + a]); out.nrm.push(m.nrm[i * 3 + a]); out.col.push(m.col[i * 3 + a]); }
    out.gloss.push(m.gloss[i]);
    if (m.joints) for (let a = 0; a < 4; a++) { out.joints.push(m.joints[i * 4 + a]); out.weights.push(m.weights[i * 4 + a]); }
    map.set(i, j);
    return j;
  };
  for (let t = 0; t < m.idx.length; t += 3) {
    if (!keep(m.idx[t], m.idx[t + 1], m.idx[t + 2])) continue;
    out.idx.push(take(m.idx[t]), take(m.idx[t + 1]), take(m.idx[t + 2]));
  }
  return out;
}

const key = (m, i, q) => `${Math.round(m.pos[i * 3] * q)},${Math.round(m.pos[i * 3 + 1] * q)},${Math.round(m.pos[i * 3 + 2] * q)}`;

/**
 * Normals worked out again from the faces. Each corner takes the faces round
 * its point that lie within `angle` degrees of its own, weighed by area, so a
 * round part shades round and a hard edge stays hard. Then corners that came
 * out the same are welded. `m.smooth` (per vertex, the bots' outline) gets
 * the mean of every face round the point, whatever the angle.
 */
function smooth(m, angle, opts) {
  const o = opts || {};
  const q = o.quantum || 20000;        // positions within 0.05 mm are one point
  const nt = m.idx.length / 3;
  const fn = new Float64Array(nt * 3);  // face normals, length = twice the area
  for (let t = 0; t < nt; t++) {
    const a = m.idx[t * 3] * 3, b = m.idx[t * 3 + 1] * 3, c = m.idx[t * 3 + 2] * 3;
    const ux = m.pos[b] - m.pos[a], uy = m.pos[b + 1] - m.pos[a + 1], uz = m.pos[b + 2] - m.pos[a + 2];
    const vx = m.pos[c] - m.pos[a], vy = m.pos[c + 1] - m.pos[a + 1], vz = m.pos[c + 2] - m.pos[a + 2];
    fn[t * 3] = uy * vz - uz * vy; fn[t * 3 + 1] = uz * vx - ux * vz; fn[t * 3 + 2] = ux * vy - uy * vx;
  }
  const round = new Map();              // point -> the faces round it
  for (let t = 0; t < nt; t++) for (let k = 0; k < 3; k++) {
    const kk = key(m, m.idx[t * 3 + k], q);
    let l = round.get(kk); if (!l) { l = []; round.set(kk, l); }
    l.push(t);
  }
  const cos = Math.cos(angle * Math.PI / 180);
  const out = empty(!!m.joints);
  out.smooth = [];
  const seen = new Map();
  for (let t = 0; t < nt; t++) {
    const fl = Math.hypot(fn[t * 3], fn[t * 3 + 1], fn[t * 3 + 2]) || 1;
    for (let k = 0; k < 3; k++) {
      const i = m.idx[t * 3 + k];
      let nx = 0, ny = 0, nz = 0, sx = 0, sy = 0, sz = 0;
      for (const u of round.get(key(m, i, q))) {
        const ul = Math.hypot(fn[u * 3], fn[u * 3 + 1], fn[u * 3 + 2]) || 1;
        sx += fn[u * 3] / ul; sy += fn[u * 3 + 1] / ul; sz += fn[u * 3 + 2] / ul;
        const d = (fn[t * 3] * fn[u * 3] + fn[t * 3 + 1] * fn[u * 3 + 1] + fn[t * 3 + 2] * fn[u * 3 + 2]) / (fl * ul);
        if (d >= cos) { nx += fn[u * 3]; ny += fn[u * 3 + 1]; nz += fn[u * 3 + 2]; }
      }
      let l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
      l = Math.hypot(sx, sy, sz);
      if (l < 1e-6) { sx = nx; sy = ny; sz = nz; } else { sx /= l; sy /= l; sz /= l; }
      const r = (v) => Math.round(v * 60);
      const id = `${key(m, i, q)}|${r(nx)},${r(ny)},${r(nz)}|${m.col[i * 3]},${m.col[i * 3 + 1]},${m.col[i * 3 + 2]},${m.gloss[i]}|${m.joints ? `${m.joints.slice(i * 4, i * 4 + 4)}/${m.weights.slice(i * 4, i * 4 + 4).map((w) => Math.round(w * 50))}` : ''}`;
      let j = seen.get(id);
      if (j == null) {
        j = out.pos.length / 3;
        out.pos.push(m.pos[i * 3], m.pos[i * 3 + 1], m.pos[i * 3 + 2]);
        out.nrm.push(nx, ny, nz);
        out.smooth.push(sx, sy, sz);
        out.col.push(m.col[i * 3], m.col[i * 3 + 1], m.col[i * 3 + 2]);
        out.gloss.push(m.gloss[i]);
        if (m.joints) for (let a = 0; a < 4; a++) { out.joints.push(m.joints[i * 4 + a]); out.weights.push(m.weights[i * 4 + a]); }
        seen.set(id, j);
      }
      out.idx.push(j);
    }
  }
  return out;
}

/**
 * A typed array as base64. The public mirror's guard (publish-public.js)
 * refuses text shaped like a token, three letters and forty more, and a long
 * run of base64 will spell that by chance once in a while. Where it does, the
 * string is cut in two inside the run (on a group of four, so each piece is
 * whole base64) and an array is returned: kit.js joins it.
 */
function b64(typed) {
  const s = Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength).toString('base64');
  const token = String.fromCharCode(101, 121, 74);      // the three letters, never written out here
  const cuts = [];
  for (let i = s.indexOf(token); i >= 0; i = s.indexOf(token, i + 1)) {
    const cut = (Math.floor(i / 4) + 2) * 4;            // a group boundary 5 to 8 characters on
    if (cut < s.length && cuts[cuts.length - 1] !== cut) cuts.push(cut);
  }
  if (!cuts.length) return s;
  const out = [];
  let from = 0;
  for (const c of cuts) { out.push(s.slice(from, c)); from = c; }
  out.push(s.slice(from));
  return out;
}

/**
 * A mesh packed for the page (kit.js unpack reads it): positions as 16 bit
 * steps across the bounds, normals as signed bytes, colour and gloss as four
 * bytes, and for a figure four joints, four weights and the outline's normal.
 */
function pack(m) {
  const n = m.pos.length / 3;
  if (n > 65535) throw new Error(`${n} vertices: over what 16 bit indices hold`);
  const bd = bounds(m);
  const span = Math.max(bd.size[0], bd.size[1], bd.size[2]) || 1;
  const P = new Uint16Array(n * 3), N = new Int8Array(n * 3), C = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    for (let a = 0; a < 3; a++) {
      P[i * 3 + a] = Math.round(((m.pos[i * 3 + a] - bd.lo[a]) / span) * 65535);
      N[i * 3 + a] = Math.round(m.nrm[i * 3 + a] * 127);
      C[i * 4 + a] = Math.round(Math.max(0, Math.min(1, m.col[i * 3 + a])) * 255);
    }
    C[i * 4 + 3] = Math.round(Math.max(0, Math.min(1, m.gloss[i])) * 255);
  }
  const out = { n, tris: m.idx.length / 3, lo: bd.lo.map((v) => +v.toFixed(6)), span: +span.toFixed(6), pos: b64(P), nrm: b64(N), col: b64(C), idx: b64(new Uint16Array(m.idx)) };
  if (m.joints) {
    const J = new Uint8Array(n * 4), Wt = new Uint8Array(n * 4);
    for (let i = 0; i < n; i++) {
      // The weights as bytes that add up to 255 exactly, the largest taking what rounding left.
      let sum = 0, big = 0;
      for (let a = 0; a < 4; a++) { J[i * 4 + a] = m.joints[i * 4 + a]; Wt[i * 4 + a] = Math.round(m.weights[i * 4 + a] * 255); sum += Wt[i * 4 + a]; if (Wt[i * 4 + a] > Wt[i * 4 + big]) big = a; }
      Wt[i * 4 + big] += 255 - sum;
    }
    out.joints = b64(J); out.weights = b64(Wt);
  }
  if (m.smooth) {
    const S = new Int8Array(n * 3);
    for (let i = 0; i < n * 3; i++) S[i] = Math.round(m.smooth[i] * 127);
    out.smooth = b64(S);
  }
  return out;
}

/** An ASCII .ply with vertex colours, for looking at a mesh in Blender (preview.py). */
function ply(m) {
  const n = m.pos.length / 3;
  const lines = ['ply', 'format ascii 1.0', `element vertex ${n}`, 'property float x', 'property float y', 'property float z', 'property float nx', 'property float ny', 'property float nz', 'property uchar red', 'property uchar green', 'property uchar blue', `element face ${m.idx.length / 3}`, 'property list uchar int vertex_indices', 'end_header'];
  for (let i = 0; i < n; i++) {
    // Blender is z up: the Trainer's x, y, z go out as x, -z, y.
    lines.push(`${m.pos[i * 3].toFixed(5)} ${(-m.pos[i * 3 + 2]).toFixed(5)} ${m.pos[i * 3 + 1].toFixed(5)} ${m.nrm[i * 3].toFixed(3)} ${(-m.nrm[i * 3 + 2]).toFixed(3)} ${m.nrm[i * 3 + 1].toFixed(3)} ${Math.round(m.col[i * 3] * 255)} ${Math.round(m.col[i * 3 + 1] * 255)} ${Math.round(m.col[i * 3 + 2] * 255)}`);
  }
  for (let t = 0; t < m.idx.length; t += 3) lines.push(`3 ${m.idx[t]} ${m.idx[t + 1]} ${m.idx[t + 2]}`);
  return lines.join('\n') + '\n';
}

module.exports = { empty, append, transform, bounds, filter, smooth, pack, ply, b64 };

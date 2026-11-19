// A small modelling kit: primitives merged into one geometry with a colour
// per part, so a figure or a gun is one draw. Everything the Trainer shows is
// built from these few shapes in code; no model file ships.
import * as THREE from './vendor/three.module.min.js';

const m4 = new THREE.Matrix4();
const q = new THREE.Quaternion();
const e = new THREE.Euler();
const v3 = new THREE.Vector3();
const s3 = new THREE.Vector3();
const n3 = new THREE.Matrix3();
const col = new THREE.Color();

/** A matrix from a position, rotation in degrees and scale. */
export function at(x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  e.set(rx * Math.PI / 180, ry * Math.PI / 180, rz * Math.PI / 180, 'XYZ');
  q.setFromEuler(e);
  return new THREE.Matrix4().compose(v3.set(x, y, z), q, s3.set(sx, sy, sz));
}

/** A matrix that lays a shape made along y (a capsule, a cylinder) from one point to another. */
export function between(ax, ay, az, bx, by, bz) {
  const d = new THREE.Vector3(bx - ax, by - ay, bz - az).normalize();
  const rot = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d);
  return new THREE.Matrix4().compose(new THREE.Vector3((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2), rot, new THREE.Vector3(1, 1, 1));
}
export const dist = (ax, ay, az, bx, by, bz) => Math.hypot(bx - ax, by - ay, bz - az);

export const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
export const cyl = (rTop, rBottom, h, seg = 12) => new THREE.CylinderGeometry(rTop, rBottom, h, seg);
export const capsule = (r, len, seg = 10) => new THREE.CapsuleGeometry(r, len, 4, seg);
export const sphere = (r, w = 16, h = 12) => new THREE.SphereGeometry(r, w, h);

/**
 * One geometry from parts: [geometry, colour hex, matrix]. Positions and
 * normals are baked through each part's matrix; the colour goes to a vertex
 * colour. The part geometries are disposed.
 */
export function merge(parts) {
  let nv = 0, ni = 0;
  for (const [g] of parts) { nv += g.attributes.position.count; ni += g.index ? g.index.count : g.attributes.position.count; }
  const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), colr = new Float32Array(nv * 3);
  const idx = new (nv > 65535 ? Uint32Array : Uint16Array)(ni);
  let vo = 0, io = 0;
  for (const [g, hex, mat] of parts) {
    const p = g.attributes.position, n = g.attributes.normal;
    m4.copy(mat || m4.identity());
    n3.getNormalMatrix(m4);
    col.setHex(hex);
    for (let i = 0; i < p.count; i++) {
      v3.fromBufferAttribute(p, i).applyMatrix4(m4);
      pos[(vo + i) * 3] = v3.x; pos[(vo + i) * 3 + 1] = v3.y; pos[(vo + i) * 3 + 2] = v3.z;
      v3.fromBufferAttribute(n, i).applyMatrix3(n3).normalize();
      nor[(vo + i) * 3] = v3.x; nor[(vo + i) * 3 + 1] = v3.y; nor[(vo + i) * 3 + 2] = v3.z;
      colr[(vo + i) * 3] = col.r; colr[(vo + i) * 3 + 1] = col.g; colr[(vo + i) * 3 + 2] = col.b;
    }
    if (g.index) for (let i = 0; i < g.index.count; i++) idx[io++] = g.index.getX(i) + vo;
    else for (let i = 0; i < p.count; i++) idx[io++] = vo + i;
    vo += p.count;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.BufferAttribute(colr, 3));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  out.computeBoundingSphere();
  return out;
}

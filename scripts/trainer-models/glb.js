// A small reader for binary glTF (.glb), enough for the models the Trainer is
// built from (scripts/trainer-models/README.md): meshes with positions,
// normals, joints and weights, materials by base colour, the node tree, skins
// and animations. No textures, no sparse accessors, no morph targets, no
// Draco or meshopt: a file that needs one of those is refused, not guessed at.
'use strict';
const fs = require('fs');

const TYPES = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
const ARRAYS = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };
const NORMS = { 5120: 127, 5121: 255, 5122: 32767, 5123: 65535 };

function readGlb(file) {
  const b = fs.readFileSync(file);
  if (b.readUInt32LE(0) !== 0x46546c67) throw new Error(`${file}: not a .glb`);
  const jsonLen = b.readUInt32LE(12);
  const json = JSON.parse(b.slice(20, 20 + jsonLen).toString('utf8'));
  const binAt = 20 + jsonLen;
  const bin = binAt < b.length ? b.slice(binAt + 8, binAt + 8 + b.readUInt32LE(binAt)) : Buffer.alloc(0);
  for (const ext of json.extensionsRequired || []) throw new Error(`${file}: needs ${ext}, which this reader does not do`);
  return { json, bin, file };
}

/** An accessor as a plain Float64Array (normalised integers turned to floats) or, with `raw`, its own integers. */
function accessor(g, index, raw) {
  const a = g.json.accessors[index];
  if (a.sparse) throw new Error('sparse accessor');
  const view = g.json.bufferViews[a.bufferView];
  const size = TYPES[a.type];
  const Arr = ARRAYS[a.componentType];
  const stride = view.byteStride || size * Arr.BYTES_PER_ELEMENT;
  const start = (view.byteOffset || 0) + (a.byteOffset || 0);
  const out = raw ? new Arr(a.count * size) : new Float64Array(a.count * size);
  const dv = new DataView(g.bin.buffer, g.bin.byteOffset, g.bin.byteLength);
  const get = { 5120: 'getInt8', 5121: 'getUint8', 5122: 'getInt16', 5123: 'getUint16', 5125: 'getUint32', 5126: 'getFloat32' }[a.componentType];
  const norm = !raw && a.normalized ? NORMS[a.componentType] : 0;
  for (let i = 0; i < a.count; i++) {
    for (let k = 0; k < size; k++) {
      const v = dv[get](start + i * stride + k * Arr.BYTES_PER_ELEMENT, true);
      out[i * size + k] = norm ? Math.max(-1, v / norm) : v;
    }
  }
  return { array: out, size, count: a.count };
}

/** A material's base colour, linear RGB (glTF stores it linear). */
function materialColour(g, index) {
  const m = (g.json.materials || [])[index];
  const f = m && m.pbrMetallicRoughness && m.pbrMetallicRoughness.baseColorFactor;
  return { name: m ? m.name || '' : '', rgb: f ? [f[0], f[1], f[2]] : [0.8, 0.8, 0.8] };
}

/** Every primitive of every mesh node: { node, skin, material, pos, nrm, joints, weights, idx }. */
function primitives(g) {
  const out = [];
  (g.json.nodes || []).forEach((n, node) => {
    if (n.mesh == null) return;
    for (const p of g.json.meshes[n.mesh].primitives) {
      if (p.mode != null && p.mode !== 4) continue;
      const pos = accessor(g, p.attributes.POSITION);
      const nrm = p.attributes.NORMAL != null ? accessor(g, p.attributes.NORMAL) : null;
      const joints = p.attributes.JOINTS_0 != null ? accessor(g, p.attributes.JOINTS_0, true) : null;
      const weights = p.attributes.WEIGHTS_0 != null ? accessor(g, p.attributes.WEIGHTS_0) : null;
      let idx;
      if (p.indices != null) idx = Array.from(accessor(g, p.indices, true).array);
      else { idx = []; for (let i = 0; i < pos.count; i++) idx.push(i); }
      out.push({
        node, name: n.name || '', skin: n.skin == null ? -1 : n.skin, material: materialColour(g, p.material),
        pos: pos.array, nrm: nrm ? nrm.array : null, joints: joints ? joints.array : null, weights: weights ? weights.array : null, idx, count: pos.count,
      });
    }
  });
  return out;
}

module.exports = { readGlb, accessor, primitives, materialColour };

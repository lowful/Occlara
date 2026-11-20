// What the Trainer's models are made of at run time. The guns and the bots'
// figure are not built here: they are made ahead of time by
// scripts/trainer-models/build.js from CC0 sources
// (native/trainer-models-NOTICE.txt) and ship as plain modules under models/,
// each mesh packed as base64. `unpack` turns one into a geometry, and `LIT`
// is how every model is lit.
import * as THREE from './vendor/three.module.min.js';

// A packed array is base64, or a few pieces of it to be joined (mesh.js b64 says why).
function bytes(b64, Type) {
  const s = atob(Array.isArray(b64) ? b64.join('') : b64);
  const u = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
  return new Type(u.buffer);
}
/** A base64 string of 32 bit floats. */
export const floats = (b64) => bytes(b64, Float32Array);

/**
 * A packed mesh (build.js, mesh.js pack) as a geometry: `position`, `normal`,
 * `aCol` (the colour in sRGB and, in its fourth part, the gloss), and for a
 * figure `aJoint`, `aWeight` and `aSmooth` (the outline's normal).
 */
export function unpack(m) {
  const g = new THREE.BufferGeometry();
  const P = bytes(m.pos, Uint16Array);
  const pos = new Float32Array(m.n * 3);
  const k = m.span / 65535;
  for (let i = 0; i < pos.length; i++) pos[i] = P[i] * k + m.lo[i % 3];
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(bytes(m.nrm, Int8Array), 3, true));
  g.setAttribute('aCol', new THREE.BufferAttribute(bytes(m.col, Uint8Array), 4, true));
  g.setIndex(new THREE.BufferAttribute(bytes(m.idx, Uint16Array), 1));
  if (m.joints) {
    g.setAttribute('aJoint', new THREE.BufferAttribute(bytes(m.joints, Uint8Array), 4, false));
    g.setAttribute('aWeight', new THREE.BufferAttribute(bytes(m.weights, Uint8Array), 4, true));
  }
  if (m.smooth) g.setAttribute('aSmooth', new THREE.BufferAttribute(bytes(m.smooth, Int8Array), 3, true));
  g.computeBoundingSphere();
  return g;
}

// ── How a model is lit ─────────────────────────────────────────────────────
// One function for the guns and the bots, no lights in the scene and no
// shadow maps: a sky above and the ground's bounce below, one key light (the
// world's SUN), a highlight, and a mirror of the sky that is all a dark metal
// has to be read by at night. `gloss` says what a face is made of: 0 cloth
// (it wraps the light and catches a sheen at its edges), about 0.3 polymer,
// 0.7 and up metal (a tight highlight and the sky in it).
// The colours are world.js SKY's, kept in step by hand.
export const LIGHT = { sky: 0x8a93a8, ground: 0x2c2f38, sun: 0xdde7ff, glow: 0x1f5a66, haze: 0x1b4853, hazeNear: 45, hazeFar: 240 };

export const LIT = /* glsl */`
uniform vec3 uSun; uniform vec3 uUp;
uniform vec3 uSunLight; uniform vec3 uSkyLight; uniform vec3 uGroundLight; uniform vec3 uGlow;
vec3 lit(vec3 base, float gloss, vec3 n, vec3 v) {
  float metal = smoothstep(0.55, 0.8, gloss);
  float up = dot(n, uUp);
  vec3 ambient = mix(uGroundLight, uSkyLight, up * 0.5 + 0.5);
  float nl = dot(n, uSun);
  float wrap = max((nl + 0.4) / 1.4, 0.0);
  float hard = max(nl, 0.0);
  float soft = 1.0 - smoothstep(0.08, 0.5, gloss);
  vec3 col = base * (ambient + uSunLight * mix(hard, wrap, soft)) * (1.0 - 0.45 * metal);
  // The highlight: broad and faint on polymer, tight and tinted on metal.
  vec3 h = normalize(uSun + v);
  float shine = mix(8.0, 120.0, gloss * gloss);
  float spec = pow(max(dot(n, h), 0.0), shine) * (shine + 8.0) / 40.0 * hard;
  col += uSunLight * spec * gloss * mix(vec3(0.05), base * 3.0 + 0.12, metal);
  // The sky mirrored: the dome above, the dark ground below, the horizon's glow between.
  vec3 r = reflect(-v, n);
  float ru = dot(r, uUp);
  vec3 env = mix(uGroundLight * 0.55, uSkyLight, smoothstep(-0.25, 0.45, ru)) + uGlow * exp(-abs(ru) * 4.0) * 0.9;
  float edge = pow(1.0 - max(dot(n, v), 0.0), 4.0);
  col += env * mix(vec3(0.03 + 0.35 * edge) * smoothstep(0.1, 0.4, gloss), base * 2.6 + 0.06 + 0.5 * edge, metal);
  // Cloth catches the sky along its edges.
  col += base * uSkyLight * pow(1.0 - max(dot(n, v), 0.0), 2.5) * soft * 1.1;
  return col;
}`;

/** The uniforms LIT reads, with the night's colours; `uSun` and `uUp` are the caller's to point. */
export function litUniforms() {
  const c = (hex, k) => new THREE.Color(hex).multiplyScalar(k);
  return {
    uSun: { value: new THREE.Vector3(0.35, 0.8, 0.45).normalize() }, uUp: { value: new THREE.Vector3(0, 1, 0) },
    uSunLight: { value: c(LIGHT.sun, 0.95) }, uSkyLight: { value: c(LIGHT.sky, 0.95) }, uGroundLight: { value: c(LIGHT.ground, 1.1) }, uGlow: { value: c(LIGHT.glow, 1) },
  };
}

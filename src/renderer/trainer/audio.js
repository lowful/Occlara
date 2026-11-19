// THE TRAINER'S SOUNDS (docs/claude/trainer.md, "Sounds"). Every one is made
// here, by Web Audio, from noise and tones: nothing is recorded, downloaded or
// taken from any game, and no audio file ships. Each is drawn once into a
// buffer (OfflineAudioContext) when the page loads, the loud ones through a
// short room made of decaying noise so a shot has a tail, then levelled to
// one peak. They play through one gain (the Trainer's volume, and silence
// when the app's Sounds switch is off) with stereo panning by where the sound
// comes from.

const RATE = 44100;

/** Seeded noise, so each sound is the same every time. */
function noise(seed) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) / 4294967296) * 2 - 1; };
}
function noiseBuffer(ctx, sec, seed, shape) {
  const n = Math.max(1, Math.ceil(RATE * sec));
  const buf = ctx.createBuffer(1, n, RATE);
  const d = buf.getChannelData(0);
  const r = noise(seed);
  for (let i = 0; i < n; i++) d[i] = r() * (shape ? shape(i / n) : 1);
  return buf;
}

function env(g, t, a, peak, d) {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
}

/** A burst of filtered noise into `out`. */
function burst(ctx, out, t, { dur, a = 0.001, peak = 1, type = 'lowpass', f = 2000, q = 0.7, f2 = null, seed = 7 }) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx, dur + a + 0.02, seed);
  const flt = ctx.createBiquadFilter();
  flt.type = type; flt.frequency.setValueAtTime(f, t); flt.Q.value = q;
  if (f2) flt.frequency.exponentialRampToValueAtTime(f2, t + a + dur);
  const g = ctx.createGain();
  env(g, t, a, peak, dur);
  src.connect(flt).connect(g).connect(out);
  src.start(t);
}

/** A tone with a pitch sweep into `out`. */
function tone(ctx, out, t, { dur, a = 0.002, peak = 0.5, wave = 'sine', f, f2 = null }) {
  const o = ctx.createOscillator();
  o.type = wave;
  o.frequency.setValueAtTime(f, t);
  if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + a + dur);
  const g = ctx.createGain();
  env(g, t, a, peak, dur);
  o.connect(g).connect(out);
  o.start(t); o.stop(t + a + dur + 0.02);
}

// Each sound: how long, what draws it, and for the loud ones a room (its
// decay in seconds and how much of it is heard). A gun is a crack (bright
// noise, gone in an instant), a body (noise falling in pitch) and a thump (a
// low tone falling); the four differ in weight, brightness and length.
const SOUNDS = {
  'shot-heavy-rifle': { dur: 0.5, room: 0.32, wet: 0.5, draw: (c, o) => { burst(c, o, 0, { dur: 0.035, peak: 1, type: 'highpass', f: 2600, seed: 11 }); burst(c, o, 0, { dur: 0.2, peak: 0.8, f: 3400, f2: 280, seed: 12 }); tone(c, o, 0, { dur: 0.13, peak: 0.9, f: 150, f2: 46 }); } },
  'shot-silenced-rifle': { dur: 0.32, room: 0.14, wet: 0.25, draw: (c, o) => { burst(c, o, 0, { dur: 0.07, peak: 0.7, type: 'bandpass', f: 1500, q: 1.1, seed: 21 }); burst(c, o, 0.003, { dur: 0.04, peak: 0.3, type: 'highpass', f: 5200, seed: 22 }); tone(c, o, 0, { dur: 0.07, peak: 0.55, f: 190, f2: 72 }); burst(c, o, 0.03, { dur: 0.03, peak: 0.2, type: 'bandpass', f: 2600, q: 4, seed: 23 }); } },
  'shot-heavy-pistol': { dur: 0.62, room: 0.4, wet: 0.55, draw: (c, o) => { burst(c, o, 0, { dur: 0.045, peak: 1, type: 'highpass', f: 2000, seed: 31 }); burst(c, o, 0, { dur: 0.3, peak: 0.85, f: 2700, f2: 190, seed: 32 }); tone(c, o, 0, { dur: 0.2, peak: 1, f: 124, f2: 38 }); } },
  'shot-sidearm': { dur: 0.3, room: 0.2, wet: 0.4, draw: (c, o) => { burst(c, o, 0, { dur: 0.025, peak: 0.85, type: 'highpass', f: 3200, seed: 41 }); burst(c, o, 0, { dur: 0.11, peak: 0.6, f: 4400, f2: 620, seed: 42 }); tone(c, o, 0, { dur: 0.06, peak: 0.55, f: 230, f2: 92 }); } },
  'shot-bot': { dur: 0.6, room: 0.45, wet: 0.8, draw: (c, o) => { burst(c, o, 0, { dur: 0.24, peak: 0.6, f: 1300, f2: 220, seed: 51 }); tone(c, o, 0, { dur: 0.12, peak: 0.4, f: 112, f2: 42 }); } },
  reload: { dur: 1.3, draw: (c, o) => { burst(c, o, 0.05, { dur: 0.04, peak: 0.5, type: 'bandpass', f: 2200, q: 3, seed: 61 }); burst(c, o, 0.09, { dur: 0.05, peak: 0.25, type: 'bandpass', f: 900, q: 2, seed: 65 }); burst(c, o, 0.55, { dur: 0.05, peak: 0.6, type: 'bandpass', f: 1600, q: 3, seed: 62 }); burst(c, o, 1.0, { dur: 0.04, peak: 0.6, type: 'bandpass', f: 2700, q: 4, seed: 63 }); burst(c, o, 1.07, { dur: 0.06, peak: 0.5, type: 'bandpass', f: 1200, q: 3, seed: 64 }); } },
  equip: { dur: 0.3, draw: (c, o) => { burst(c, o, 0, { dur: 0.12, peak: 0.25, type: 'bandpass', f: 900, q: 1, seed: 71 }); burst(c, o, 0.1, { dur: 0.04, peak: 0.4, type: 'bandpass', f: 2400, q: 4, seed: 72 }); } },
  dry: { dur: 0.12, draw: (c, o) => { burst(c, o, 0, { dur: 0.03, peak: 0.5, type: 'bandpass', f: 3200, q: 5, seed: 81 }); } },
  'step-1': { dur: 0.16, draw: (c, o) => { burst(c, o, 0, { dur: 0.09, peak: 0.35, f: 700, f2: 200, seed: 91 }); burst(c, o, 0.01, { dur: 0.03, peak: 0.1, type: 'highpass', f: 3000, seed: 92 }); } },
  'step-2': { dur: 0.16, draw: (c, o) => { burst(c, o, 0, { dur: 0.08, peak: 0.32, f: 800, f2: 220, seed: 93 }); burst(c, o, 0.012, { dur: 0.03, peak: 0.09, type: 'highpass', f: 3400, seed: 94 }); } },
  'step-3': { dur: 0.16, draw: (c, o) => { burst(c, o, 0, { dur: 0.1, peak: 0.36, f: 650, f2: 180, seed: 95 }); burst(c, o, 0.008, { dur: 0.03, peak: 0.1, type: 'highpass', f: 2800, seed: 96 }); } },
  land: { dur: 0.25, draw: (c, o) => { burst(c, o, 0, { dur: 0.15, peak: 0.5, f: 500, f2: 120, seed: 97 }); tone(c, o, 0, { dur: 0.08, peak: 0.3, f: 90, f2: 50 }); } },
  'hit-body': { dur: 0.12, draw: (c, o) => { burst(c, o, 0, { dur: 0.05, peak: 0.5, type: 'bandpass', f: 950, q: 1.5, seed: 101 }); tone(c, o, 0, { dur: 0.04, peak: 0.25, f: 320, f2: 180 }); } },
  'hit-head': { dur: 0.32, draw: (c, o) => { tone(c, o, 0, { dur: 0.2, peak: 0.34, wave: 'triangle', f: 2093 }); tone(c, o, 0, { dur: 0.1, peak: 0.14, f: 4186 }); burst(c, o, 0, { dur: 0.025, peak: 0.3, type: 'highpass', f: 4200, seed: 102 }); } },
  kill: { dur: 0.42, draw: (c, o) => { tone(c, o, 0, { dur: 0.11, peak: 0.24, wave: 'triangle', f: 880 }); tone(c, o, 0.085, { dur: 0.27, peak: 0.26, wave: 'triangle', f: 1318.5 }); tone(c, o, 0.085, { dur: 0.2, peak: 0.08, f: 2637 }); } },
  hurt: { dur: 0.3, draw: (c, o) => { tone(c, o, 0, { dur: 0.18, peak: 0.6, f: 96, f2: 46 }); burst(c, o, 0, { dur: 0.09, peak: 0.4, f: 620, seed: 111 }); } },
  beep: { dur: 0.15, draw: (c, o) => { tone(c, o, 0, { dur: 0.11, peak: 0.25, f: 660 }); } },
  go: { dur: 0.32, draw: (c, o) => { tone(c, o, 0, { dur: 0.25, peak: 0.3, f: 1320 }); tone(c, o, 0, { dur: 0.2, peak: 0.1, f: 1980 }); } },
  finish: { dur: 0.95, draw: (c, o) => { tone(c, o, 0, { dur: 0.17, peak: 0.22, wave: 'triangle', f: 659.3 }); tone(c, o, 0.13, { dur: 0.17, peak: 0.22, wave: 'triangle', f: 880 }); tone(c, o, 0.26, { dur: 0.55, peak: 0.24, wave: 'triangle', f: 1318.5 }); } },
};
// How loud each sits beside the others once levelled to one peak.
const LEVEL = { reload: 0.5, equip: 0.4, dry: 0.4, 'step-1': 0.3, 'step-2': 0.3, 'step-3': 0.3, land: 0.45, 'hit-body': 0.6, 'hit-head': 0.7, kill: 0.6, hurt: 0.8, beep: 0.45, go: 0.5, finish: 0.55, 'shot-silenced-rifle': 0.7, 'shot-sidearm': 0.8, 'shot-bot': 0.8 };

export function createAudio() {
  let ctx = null;
  let master = null;
  const buffers = new Map();
  let volume = 0.7;
  let on = true;

  async function render(name, spec) {
    const tail = spec.room ? spec.room + 0.05 : 0.05;
    const off = new OfflineAudioContext(1, Math.ceil(RATE * (spec.dur + tail)), RATE);
    const bus = off.createGain();
    bus.connect(off.destination);
    if (spec.room) {
      // The room: noise that dies away, which a convolver turns into a tail.
      const conv = off.createConvolver();
      conv.normalize = true;
      conv.buffer = noiseBuffer(off, spec.room, 4242, (p) => Math.pow(1 - p, 3));
      const wet = off.createGain();
      wet.gain.value = spec.wet;
      bus.connect(conv).connect(wet).connect(off.destination);
    }
    spec.draw(off, bus);
    const buf = await off.startRendering();
    // Levelled: every sound to the same peak, then its own place in the mix.
    const d = buf.getChannelData(0);
    let peak = 0;
    for (let i = 0; i < d.length; i++) { const v = Math.abs(d[i]); if (v > peak) peak = v; }
    const k = peak > 0 ? (0.9 / peak) * (LEVEL[name] || 1) : 1;
    for (let i = 0; i < d.length; i++) d[i] *= k;
    buffers.set(name, buf);
  }

  const apply = () => { if (master) master.gain.value = on ? volume : 0; };

  return {
    /** Draws every sound once. The AudioContext itself starts on the first click (wake). */
    async load() {
      await Promise.all(Object.entries(SOUNDS).map(([n, s]) => render(n, s).catch(() => null)));
    },
    /** The context starts here, on a click or a key, as Chromium requires. */
    wake() {
      if (!ctx) {
        ctx = new AudioContext({ latencyHint: 'interactive' });
        master = ctx.createGain();
        // A limiter, so a spray with a kill on top never clips.
        const lim = ctx.createDynamicsCompressor();
        lim.threshold.value = -6; lim.knee.value = 6; lim.ratio.value = 12; lim.attack.value = 0.002; lim.release.value = 0.12;
        master.connect(lim).connect(ctx.destination);
        apply();
      }
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    },
    sleep() { if (ctx && ctx.state === 'running') ctx.suspend().catch(() => {}); },
    setVolume(v) { volume = Math.max(0, Math.min(1, v)); apply(); },
    setOn(v) { on = !!v; apply(); },
    /**
     * @param pan   -1 left to 1 right
     * @param gain  0 to 1, for distance
     * @param rate  playback rate, to vary one sound a little
     */
    play(name, pan, gain, rate) {
      if (!ctx || !on || ctx.state !== 'running') return;
      const b = buffers.get(name);
      if (!b) return;
      const s = ctx.createBufferSource();
      s.buffer = b;
      if (rate) s.playbackRate.value = rate;
      let node = s;
      if (gain != null && gain !== 1) { const g = ctx.createGain(); g.gain.value = gain; node.connect(g); node = g; }
      if (pan) { const p = ctx.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, pan)); node.connect(p); node = p; }
      node.connect(master);
      s.start();
    },
    names: () => Object.keys(SOUNDS),
    /** How many of them are drawn and ready. */
    ready: () => buffers.size,
  };
}

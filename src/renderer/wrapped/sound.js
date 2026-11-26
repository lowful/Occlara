/**
 * WRAPPED'S SOUND (docs/claude/wrapped.md): an original score, made in the
 * page by Web Audio as it plays, the way shared/sfx.js makes the app's cues.
 * No file, no sample and nobody's music: oscillators, filtered noise and a
 * short delay, so nothing can be blocked by the page's CSP and nothing is
 * added to the installer.
 *
 * A pad of four slow chords (F major 9, A minor 7, C major 7, G six, each
 * eight seconds, voiced low and soft under a sub), a breath of filtered noise
 * as a slide turns, a bell from the same scale as a slide's big number lands,
 * and a rising arpeggio for the player's title. Quiet on purpose: it is a
 * mood under the numbers, never a tune to sit through. Muted, paused and
 * closed, it fades out over a fifth of a second rather than cutting.
 *
 * It starts muted when the app's Sounds setting is off (main says, WRAPPED_GET
 * `sounds`), and the page's mute button is the player's either way.
 */
(function () {
  'use strict';

  const MASTER = 0.2;
  // F major 9, A minor 7, C major 7, G six, around the octave under middle C.
  const CHORDS = [
    [174.61, 220.0, 261.63, 329.63, 392.0],
    [220.0, 261.63, 329.63, 392.0, 493.88],
    [130.81, 196.0, 246.94, 329.63, 392.0],
    [196.0, 246.94, 293.66, 329.63, 392.0],
  ];
  const BASS = [87.31, 110.0, 65.41, 98.0];
  const BELLS = [523.25, 587.33, 659.25, 783.99, 880.0, 1046.5];
  const CHORD_S = 8;

  let ctx = null;
  let master = null;
  let wet = null;
  let pad = null;          // the running pad: { voices, timer }
  let muted = false;
  let playing = false;

  function audio() {
    if (ctx) return ctx;
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return null;
    try { ctx = new Ctor(); } catch (e) { ctx = null; return null; }
    master = ctx.createGain();
    master.gain.value = 0.0001;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 3;
    master.connect(comp).connect(ctx.destination);
    // A short feedback delay, filtered, for space.
    const delay = ctx.createDelay(1.2);
    delay.delayTime.value = 0.38;
    const fb = ctx.createGain();
    fb.gain.value = 0.32;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2400;
    wet = ctx.createGain();
    wet.gain.value = 0.35;
    wet.connect(delay);
    delay.connect(lp).connect(fb).connect(delay);
    lp.connect(master);
    return ctx;
  }

  function level() { return muted || !playing ? 0.0001 : MASTER; }

  function ramp(to, s) {
    if (!ctx || !master) return;
    const t = ctx.currentTime;
    master.gain.cancelScheduledValues(t);
    master.gain.setValueAtTime(Math.max(0.0001, master.gain.value), t);
    master.gain.exponentialRampToValueAtTime(Math.max(0.0001, to), t + (s || 0.2));
  }

  /** One chord of the pad, faded in and out over its length. */
  function chord(i, at) {
    const c = audio();
    if (!c) return;
    const notes = CHORDS[i % CHORDS.length];
    const filter = c.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(520, at);
    filter.frequency.linearRampToValueAtTime(1100, at + CHORD_S * 0.5);
    filter.frequency.linearRampToValueAtTime(600, at + CHORD_S + 2);
    filter.Q.value = 0.7;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(0.11, at + 2.2);
    g.gain.setValueAtTime(0.11, at + CHORD_S - 0.6);
    g.gain.exponentialRampToValueAtTime(0.0001, at + CHORD_S + 2.4);
    filter.connect(g);
    g.connect(master);
    g.connect(wet);
    const oscs = [];
    notes.forEach((f, k) => {
      for (const det of [-7, 6]) {
        const o = c.createOscillator();
        o.type = k === 0 ? 'triangle' : 'sawtooth';
        o.frequency.setValueAtTime(f, at);
        o.detune.setValueAtTime(det + (k % 2 ? 3 : -2), at);
        const v = c.createGain();
        v.gain.value = (k === 0 ? 0.5 : 0.17) / 2;
        o.connect(v).connect(filter);
        o.start(at);
        o.stop(at + CHORD_S + 2.6);
        oscs.push(o);
      }
    });
    // The sub under it.
    const sub = c.createOscillator();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(BASS[i % BASS.length], at);
    const sg = c.createGain();
    sg.gain.setValueAtTime(0.0001, at);
    sg.gain.exponentialRampToValueAtTime(0.16, at + 1.6);
    sg.gain.exponentialRampToValueAtTime(0.0001, at + CHORD_S + 1.8);
    sub.connect(sg).connect(master);
    sub.start(at);
    sub.stop(at + CHORD_S + 2);
    oscs.push(sub);
    return oscs;
  }

  function startPad() {
    const c = audio();
    if (!c || pad) return;
    let i = 0;
    let next = c.currentTime + 0.05;
    const voices = [];
    const tick = () => {
      // Schedule a chord ahead, so a busy main thread never leaves a gap.
      while (next < c.currentTime + CHORD_S + 0.5) {
        voices.push(...(chord(i, next) || []));
        i += 1;
        next += CHORD_S;
      }
      while (voices.length > 80) voices.shift();
    };
    tick();
    pad = { voices, timer: setInterval(tick, 2000) };
  }

  function stopPad() {
    if (!pad) return;
    clearInterval(pad.timer);
    const t = ctx ? ctx.currentTime + 0.4 : 0;
    for (const o of pad.voices) { try { o.stop(t); } catch (e) { /* already stopped */ } }
    pad = null;
  }

  /** The breath as a slide turns: noise swept through a band. */
  function whoosh(strength) {
    const c = audio();
    if (!c || muted || !playing) return;
    const t = c.currentTime + 0.01;
    const len = 0.9;
    const buf = c.createBuffer(1, Math.floor(c.sampleRate * len), c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.sin(Math.PI * (i / d.length));
    const src = c.createBufferSource();
    src.buffer = buf;
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 1.4;
    bp.frequency.setValueAtTime(260, t);
    bp.frequency.exponentialRampToValueAtTime(2600, t + len * 0.8);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.16 * (strength || 1), t + 0.25);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    src.connect(bp).connect(g);
    g.connect(master);
    g.connect(wet);
    src.start(t);
  }

  /** A bell: a sine and its fifth over it, struck and left to ring. */
  function bell(n, at, peak) {
    const c = audio();
    if (!c || muted || !playing) return;
    const t = (at || c.currentTime) + 0.01;
    const f = BELLS[Math.abs(n | 0) % BELLS.length];
    for (const [mult, amp, dur] of [[1, 1, 1.6], [2, 0.32, 0.9], [3.01, 0.12, 0.5]]) {
      const o = c.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(f * mult, t);
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime((peak || 0.1) * amp, t + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g);
      g.connect(master);
      g.connect(wet);
      o.start(t);
      o.stop(t + dur + 0.05);
    }
  }

  /** The title's rise: the scale climbing, bell on bell. */
  function rise() {
    const c = audio();
    if (!c) return;
    for (let i = 0; i < BELLS.length; i++) bell(i, c.currentTime + i * 0.09, 0.07 + i * 0.008);
  }

  window.WrappedSound = {
    /** Begin: the pad fades in (unless muted). Needs no gesture in this app's views. */
    play() {
      const c = audio();
      if (!c) return;
      playing = true;
      if (c.state === 'suspended') { try { void c.resume(); } catch (e) { /* no gesture */ } }
      startPad();
      ramp(level(), 1.4);
    },
    pause() { playing = false; ramp(0.0001, 0.2); },
    resume() { if (!ctx) { this.play(); return; } playing = true; if (ctx.state === 'suspended') { try { void ctx.resume(); } catch (e) { /* */ } } startPad(); ramp(level(), 0.6); },
    stop() { playing = false; ramp(0.0001, 0.2); setTimeout(stopPad, 260); },
    setMuted(on) { muted = !!on; ramp(level(), 0.22); },
    muted: () => muted,
    turn: (s) => whoosh(s),
    land: (n) => bell(n, 0, 0.09),
    rise,
    /** For the checks: whether anything could be heard right now. */
    audible: () => !!(ctx && playing && !muted && ctx.state === 'running'),
    state: () => ({ playing, muted, context: ctx ? ctx.state : 'none', pad: !!pad }),
  };
})();

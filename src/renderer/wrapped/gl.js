/**
 * WRAPPED'S GROUND (docs/claude/wrapped.md): a living field of colour and a
 * drift of light behind every slide, drawn in WebGL on this PC.
 *
 * Two passes a frame, both small: a full screen pass of domain warped noise
 * mixing the slide's three colours over the night ground, with a slow aurora
 * band and a vignette, and a few hundred points of light flying toward the
 * viewer, added on top. No library: plain WebGL 1, so it starts on any GPU
 * the app runs on and adds nothing to the installer.
 *
 * IT HOLDS ITS FRAME RATE OR STEPS DOWN. It renders at a fraction of the
 * window's pixels (the field is soft, so it upscales without a seam) and
 * watches its own frame times against the display's own cadence (tooSlow):
 * when frames are being dropped, or the cadence itself is under half the
 * panel's rate and under 29 a second, it drops a level (fewer pixels, fewer points), down to a field
 * drawn a few times a second and then to none at all, the CSS ground under it
 * showing instead. A game running behind the app is what this is for. Its
 * numbers are in stats(), for the measurement docs/claude/wrapped.md reports.
 *
 * Under reduced motion it draws one still frame, and again only when the
 * slide's colours change.
 */
(function () {
  'use strict';

  const VERT_QUAD = 'attribute vec2 a;void main(){gl_Position=vec4(a,0.,1.);}';
  const FRAG_FIELD = [
    'precision mediump float;',
    'uniform vec2 uRes;uniform float uTime;uniform float uEnergy;',
    'uniform vec3 uA;uniform vec3 uB;uniform vec3 uC;uniform vec3 uGround;',
    'float h(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}',
    'float n(vec2 p){vec2 i=floor(p);vec2 f=fract(p);vec2 u=f*f*(3.-2.*f);',
    ' return mix(mix(h(i),h(i+vec2(1.,0.)),u.x),mix(h(i+vec2(0.,1.)),h(i+vec2(1.,1.)),u.x),u.y);}',
    'float fbm(vec2 p){float v=0.;float a=.5;mat2 m=mat2(1.6,1.2,-1.2,1.6);',
    ' for(int i=0;i<5;i++){v+=a*n(p);p=m*p;a*=.5;}return v;}',
    'void main(){',
    ' vec2 p=(gl_FragCoord.xy-.5*uRes)/uRes.y;',
    ' float t=uTime*.035;',
    ' vec2 q=vec2(fbm(p*1.3+vec2(t,-t*.6)),fbm(p*1.3+vec2(3.1-t*.8,1.7+t)));',
    ' vec2 r=vec2(fbm(p*1.7+2.2*q+vec2(1.7,9.2)+t*1.4),fbm(p*1.7+2.2*q+vec2(8.3,2.8)-t*1.1));',
    ' float f=fbm(p*1.1+2.6*r);',
    ' vec3 col=uGround;',
    ' col=mix(col,uA,smoothstep(.32,.92,f)*.92);',
    ' col=mix(col,uB,smoothstep(.45,1.15,length(q))*.70);',
    ' col=mix(col,uC,smoothstep(.58,1.,r.y)*.55);',
    ' float wave=p.y-.22*sin(p.x*1.4+uTime*.16)-.18*(f-.5)+.08;',
    ' float band=exp(-wave*wave*14.);',
    ' col+=mix(uC,uB,.5+.5*sin(p.x*2.+uTime*.1))*band*.28*uEnergy;',
    ' float vig=smoothstep(1.35,.15,length(p*vec2(.85,1.15)));',
    ' col*=mix(.28,1.,vig);',
    ' col=col*.74;',
    ' gl_FragColor=vec4(col,1.);',
    '}',
  ].join('\n');

  const VERT_STARS = [
    'attribute vec3 a;attribute float s;',
    'uniform float uTime;uniform vec2 uRes;uniform float uScale;uniform float uSpeed;',
    'varying float vA;varying float vS;',
    'void main(){',
    ' float z=fract(a.z-uTime*uSpeed*(.6+.4*s));',
    ' z=mix(.06,1.,z);',
    ' vec2 xy=a.xy/z;',
    ' xy.x*=uRes.y/uRes.x;',
    ' gl_Position=vec4(xy*.55,0.,1.);',
    ' float near=1.-z;',
    ' gl_PointSize=(1.2+5.5*near*near)*uScale*(.6+.8*s);',
    ' vA=smoothstep(1.,.75,z)*smoothstep(.06,.2,z)*(.35+.65*s);',
    ' vS=s;',
    '}',
  ].join('\n');
  const FRAG_STARS = [
    'precision mediump float;',
    'uniform vec3 uA;uniform vec3 uC;',
    'varying float vA;varying float vS;',
    'void main(){',
    ' vec2 d=gl_PointCoord-.5;float r=dot(d,d)*4.;',
    ' float g=exp(-r*3.2);',
    ' vec3 c=mix(vec3(1.),mix(uA,uC,vS),.45);',
    ' gl_FragColor=vec4(c*g*vA,1.);',
    '}',
  ].join('\n');

  // The quality levels, best first: the share of the window's pixels drawn,
  // the points of light, and the frames a second (60 means every frame).
  const LEVELS = [
    { scale: 0.62, stars: 900, fps: 60 },
    { scale: 0.46, stars: 520, fps: 60 },
    { scale: 0.34, stars: 220, fps: 60 },
    { scale: 0.26, stars: 0, fps: 24 },
  ];
  /**
   * WHETHER THE GROUND IS KEEPING UP, measured against the display's own
   * cadence, never a fixed number of ms: a 48 or 50 Hz panel, or Chromium's
   * 30 frames a second on battery, runs every frame on time and is no reason
   * to step down. Two signs of a GPU that cannot keep up:
   *   jank   a second of frames averaging well over the cadence the frames
   *          usually come at (their 20th percentile): frames being dropped
   *   slow   that usual cadence itself under half the panel's rate (main
   *          says the panel's Hz) and under 29 frames a second
   * @param mean   the last second's mean frame interval, ms
   * @param times  the recent frame intervals, ms
   * @param hz     the panel's refresh rate, or nothing
   */
  function tooSlow(mean, times, hz) {
    const xs = (times || []).filter((x) => Number.isFinite(x) && x > 0).sort((a, b) => a - b);
    if (!xs.length || !Number.isFinite(mean)) return false;
    const base = xs[Math.floor(xs.length * 0.2)];
    const interval = Number.isFinite(hz) && hz > 0 ? 1000 / hz : base;
    const jank = mean > base * 1.35 + 2;
    const slow = base > Math.max(2.2 * interval, 34);
    return jank || slow;
  }
  const MAX_INTERNAL = 1400; // the field is never drawn wider than this many pixels

  function hex(c) {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(c || ''));
    const v = m ? parseInt(m[1], 16) : 0x222233;
    return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
  }
  const mixc = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

  function compile(gl, type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || 'shader');
    return s;
  }
  function program(gl, vs, fs) {
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
    gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) || 'link');
    return p;
  }

  /**
   * @param canvas      the full window canvas
   * @param opts.reduced  draw stills only
   * @param opts.onFail   () => void, the field could not run: the CSS ground shows
   */
  function create(canvas, opts) {
    const o = opts || {};
    let gl = null;
    try {
      gl = canvas.getContext('webgl', { antialias: false, alpha: false, depth: false, stencil: false, powerPreference: 'low-power', preserveDrawingBuffer: false });
    } catch (e) { gl = null; }
    if (!gl) { if (o.onFail) o.onFail('nogl'); return null; }

    let field;
    let stars;
    try {
      field = program(gl, VERT_QUAD, FRAG_FIELD);
      stars = program(gl, VERT_STARS, FRAG_STARS);
    } catch (e) {
      if (o.onFail) o.onFail('shader');
      return null;
    }
    const quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const U = (p, n) => gl.getUniformLocation(p, n);
    const uf = { res: U(field, 'uRes'), time: U(field, 'uTime'), energy: U(field, 'uEnergy'), A: U(field, 'uA'), B: U(field, 'uB'), C: U(field, 'uC'), ground: U(field, 'uGround') };
    const us = { time: U(stars, 'uTime'), res: U(stars, 'uRes'), scale: U(stars, 'uScale'), speed: U(stars, 'uSpeed'), A: U(stars, 'uA'), C: U(stars, 'uC') };
    const aField = gl.getAttribLocation(field, 'a');
    const aStar = gl.getAttribLocation(stars, 'a');
    const sStar = gl.getAttribLocation(stars, 's');

    // The points: a fixed cloud, seeded, so every run draws the same sky.
    const MAXS = LEVELS[0].stars;
    const cloud = new Float32Array(MAXS * 4);
    let seed = 7;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (let i = 0; i < MAXS; i++) {
      const ang = rnd() * Math.PI * 2;
      const rad = 0.08 + Math.pow(rnd(), 0.7) * 1.3;
      cloud[i * 4] = Math.cos(ang) * rad;
      cloud[i * 4 + 1] = Math.sin(ang) * rad * 0.8;
      cloud[i * 4 + 2] = rnd();
      cloud[i * 4 + 3] = rnd();
    }
    const starBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, starBuf);
    gl.bufferData(gl.ARRAY_BUFFER, cloud, gl.STATIC_DRAW);

    const ground = hex('#05060A');
    let from = [hex('#2A1B5C'), hex('#5B1A44'), hex('#123A5C')];
    let to = from;
    let blendAt = 0;
    let blendMs = 1;
    let energy = 0.6;
    let energyTo = 0.6;
    let level = 0;
    let running = false;
    let raf = 0;
    let last = 0;
    let t0 = performance.now();
    let paused = 0;          // time spent paused, taken off the clock
    let pausedAt = 0;
    let lastDraw = 0;
    let lost = false;
    const reduced = !!o.reduced;
    // Frame times, for the step down and for stats().
    const times = [];
    let windowSum = 0;
    let windowN = 0;
    let frames = 0;
    let steps = 0;

    function size() {
      const L = LEVELS[level];
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const cw = canvas.clientWidth || window.innerWidth;
      const ch = canvas.clientHeight || window.innerHeight;
      let w = Math.max(64, Math.round(cw * dpr * L.scale));
      let h = Math.max(64, Math.round(ch * dpr * L.scale));
      if (w > MAX_INTERNAL) { h = Math.round(h * (MAX_INTERNAL / w)); w = MAX_INTERNAL; }
      if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    }

    function colours(now) {
      const t = Math.min(1, Math.max(0, (now - blendAt) / blendMs));
      const k = ease(t);
      energy += (energyTo - energy) * 0.04;
      return [mixc(from[0], to[0], k), mixc(from[1], to[1], k), mixc(from[2], to[2], k)];
    }

    function draw(now) {
      if (lost) return;
      size();
      const L = LEVELS[level];
      const time = (now - t0 - paused) / 1000;
      const c = colours(now);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.disable(gl.BLEND);
      gl.useProgram(field);
      gl.bindBuffer(gl.ARRAY_BUFFER, quad);
      gl.enableVertexAttribArray(aField);
      gl.vertexAttribPointer(aField, 2, gl.FLOAT, false, 0, 0);
      gl.uniform2f(uf.res, canvas.width, canvas.height);
      gl.uniform1f(uf.time, reduced ? 40 : time);
      gl.uniform1f(uf.energy, energy);
      gl.uniform3fv(uf.A, c[0]);
      gl.uniform3fv(uf.B, c[1]);
      gl.uniform3fv(uf.C, c[2]);
      gl.uniform3fv(uf.ground, ground);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.disableVertexAttribArray(aField);
      if (L.stars && !reduced) {
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.ONE, gl.ONE);
        gl.useProgram(stars);
        gl.bindBuffer(gl.ARRAY_BUFFER, starBuf);
        gl.enableVertexAttribArray(aStar);
        gl.vertexAttribPointer(aStar, 3, gl.FLOAT, false, 16, 0);
        gl.enableVertexAttribArray(sStar);
        gl.vertexAttribPointer(sStar, 1, gl.FLOAT, false, 16, 12);
        gl.uniform1f(us.time, time);
        gl.uniform2f(us.res, canvas.width, canvas.height);
        gl.uniform1f(us.scale, canvas.height / 720);
        gl.uniform1f(us.speed, 0.018 + energy * 0.03);
        gl.uniform3fv(us.A, c[0]);
        gl.uniform3fv(us.C, c[2]);
        gl.drawArrays(gl.POINTS, 0, L.stars);
        gl.disableVertexAttribArray(aStar);
        gl.disableVertexAttribArray(sStar);
      }
      lastDraw = now;
    }

    function stepDown() {
      steps += 1;
      if (level < LEVELS.length - 1) { level += 1; return; }
      // The last level still too slow: the field goes, the CSS ground shows.
      stop();
      lost = true;
      canvas.hidden = true;
      if (o.onFail) o.onFail('slow');
    }

    function loop(now) {
      if (!running) return;
      raf = requestAnimationFrame(loop);
      const dt = last ? now - last : 16.7;
      last = now;
      // Frames a while apart (the window hidden, a debugger) say nothing of speed.
      if (dt < 250) {
        times.push(dt);
        if (times.length > 600) times.shift();
        windowSum += dt;
        windowN += 1;
        frames += 1;
        if (windowSum >= 1000) {
          if (frames > 90 && tooSlow(windowSum / windowN, times, o.hz)) stepDown();
          windowSum = 0;
          windowN = 0;
        }
      }
      const L = LEVELS[level];
      if (L.fps < 60 && now - lastDraw < 1000 / L.fps) return;
      draw(now);
    }

    function start() {
      if (running || lost) return;
      if (pausedAt) { paused += performance.now() - pausedAt; pausedAt = 0; }
      if (reduced) { draw(performance.now()); return; }
      running = true;
      last = 0;
      raf = requestAnimationFrame(loop);
    }
    function stop() {
      if (!running) return;
      running = false;
      cancelAnimationFrame(raf);
      pausedAt = performance.now();
    }

    canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); lost = true; stop(); canvas.hidden = true; if (o.onFail) o.onFail('lost'); });
    window.addEventListener('resize', () => { if (reduced && !lost) draw(performance.now()); });

    return {
      ok: true,
      /** The slide's three colours, eased in over `ms`. */
      setPalette(cols, ms) {
        const now = performance.now();
        from = colours(now);
        to = (cols || []).slice(0, 3).map(hex);
        while (to.length < 3) to.push(to[to.length - 1] || hex('#222233'));
        blendAt = now;
        blendMs = reduced ? 1 : Math.max(1, ms || 1200);
        if (reduced) { from = to; draw(now + 2); }
      },
      setEnergy(e) { energyTo = Math.max(0, Math.min(1.4, Number(e) || 0)); },
      start, stop,
      stats() {
        const xs = times.slice().sort((a, b) => a - b);
        const mean = xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
        return {
          level, levels: LEVELS.length, scale: LEVELS[level].scale, stars: LEVELS[level].stars, steps, frames, lost,
          width: canvas.width, height: canvas.height,
          meanMs: mean === null ? null : Math.round(mean * 100) / 100,
          p95Ms: xs.length ? Math.round(xs[Math.floor(xs.length * 0.95)] * 100) / 100 : null,
          maxMs: xs.length ? Math.round(xs[xs.length - 1] * 100) / 100 : null,
        };
      },
      /** Measure from here: the frame times so far forgotten. */
      resetStats() { times.length = 0; frames = 0; windowSum = 0; windowN = 0; },
      /** For a check: start on a given level. */
      setLevel(n) { level = Math.max(0, Math.min(LEVELS.length - 1, n | 0)); },
    };
  }

  if (typeof window !== 'undefined') window.WrappedGL = { create, LEVELS, tooSlow };
  // The step down's rule, for scripts/test-wrapped.js.
  if (typeof module !== 'undefined' && module.exports) module.exports = { tooSlow, LEVELS };
})();

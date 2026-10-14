'use strict';

/**
 * THE MATCH RECORDER'S PAGE (8.3). A window that is never shown, with nothing
 * in it to show: it opens the primary display as OBS's Display Capture does
 * (getUserMedia, chromeMediaSource 'desktop', no audio) and records it, and
 * main (src/main/services/recorder.js) decides everything else.
 *
 * THE GATE COMES FIRST. A hardware H.264 encoder at the size asked, or no
 * recording at all, and the screen is not even opened: VideoEncoder's
 * prefer-hardware answer told the GPU's encoder apart in the 8.3 spike (yes
 * for H.264, no for VP9, which then took a whole core in software).
 *
 * ONE CAPTURE, TWO USES. The capture is asked for up to 60 frames a second,
 * and the recording is handed 30 of them (8.4.2): a MediaStreamTrackProcessor
 * on the capture track hands this page every frame, grid.js keeps thirty a
 * second by each frame's own timestamp and writes them to a track generator,
 * and MediaRecorder records the generator, a chunk a second with the page's
 * wall clock; every other frame is closed at once. Handed the capture track
 * itself, MediaRecorder gave each frame the bits of a thirtieth of a second
 * however many came, and the player's match ran at twice the bitrate asked
 * (grid.js says it whole). A clone of the capture track feeds a second
 * processor, whose newest VideoFrame is kept for the live read. A frame left
 * open holds one of the capture's few buffers, which stalls the capture. The
 * processors live in the page because this Chromium has none in a worker.
 *
 * Once a second it tells main how the capture is coping: frames delivered,
 * frames recorded, whether the picture changed since the second before (a
 * still screen delivers a couple of frames a second by design, and is not a
 * busy PC), how old the newest frame is, and how late the next chunk is. The
 * first four are health.js's, loaded before this file as grid.js is, so
 * test:recorder runs that account and that grid themselves.
 *
 * With `fake` set (OCCLARA_FAKE_CAPTURE, unpackaged builds only) it records
 * frames it draws itself instead of the screen, so a check never records the
 * desktop; 'black' draws black, as a game the capture cannot see reads.
 */
(function () {
  const bridge = window.occlaraRecorder;
  if (!bridge) return;
  // The once a second account (health.js): fps, whether the picture changed,
  // and the brightness difference the comparison with GDI uses too.
  const account = window.OcclaraRecorderHealth;
  // The recording's thirty frames a second (grid.js).
  const thirty = window.OcclaraRecorderGrid;

  const THUMB_W = 64;
  const THUMB_H = 36;
  // A newest frame older than this is not handed to the read (main uses the
  // GDI helper for that read). Measured, a still desktop still delivers about
  // two frames a second, so a frame this old is a capture that has stopped.
  const STALE_MS = 2000;

  let rec = null;            // the recording in progress
  let newest = null;         // the newest VideoFrame, kept open for the read
  let newestAt = 0;
  let frames = 0;            // frames the read's processor handed over, ever
  let recorded = 0;          // frames handed to the recording, ever
  let firstWall = null;      // the wall clock when the first of them was
  // VideoFrames open right now, clones included: the newest, for a few
  // milliseconds the clone a read or a thumbnail draws from, and the frame
  // the grid is handing on or closing. Reported each second and at the stop,
  // because a frame never closed is the capture's buffer never given back,
  // and a screen capture has only a few before it stalls.
  let open = 0;
  const hold = (f) => { open += 1; return f; };
  const release = (f) => { if (f) { f.close(); open -= 1; } };

  const errText = (e) => (e && e.name && e.message ? e.name + ': ' + e.message : String((e && e.message) || e));
  const r1 = (x) => Math.round(x * 10) / 10;
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  addEventListener('error', (e) => bridge.status({ type: 'error', where: 'page', message: String(e.message) }));
  addEventListener('unhandledrejection', (e) => bridge.status({ type: 'error', where: 'page', message: errText(e.reason) }));

  // A 64x36 picture of a frame, as brightness: the change from second to
  // second, and the comparison with a GDI frame, are both read off it.
  const small = new OffscreenCanvas(THUMB_W, THUMB_H);
  const smallCtx = small.getContext('2d', { willReadFrequently: true });
  function thumb(source) {
    smallCtx.drawImage(source, 0, 0, THUMB_W, THUMB_H);
    const px = smallCtx.getImageData(0, 0, THUMB_W, THUMB_H).data;
    const luma = new Float32Array(THUMB_W * THUMB_H);
    let sum = 0;
    for (let i = 0, j = 0; i < px.length; i += 4, j++) {
      const y = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
      luma[j] = y;
      sum += y;
    }
    return { luma, mean: sum / luma.length };
  }
  /** The newest frame's thumbnail, through a clone closed at once. */
  function newestThumb() {
    if (!newest) return null;
    const f = hold(newest.clone());
    try { return thumb(f); } finally { release(f); }
  }

  // The read's frame, at the size asked: one canvas per size, kept.
  const grabCanvases = new Map();
  function grabCanvas(w, h) {
    const key = w + 'x' + h;
    if (!grabCanvases.has(key)) {
      const c = new OffscreenCanvas(w, h);
      grabCanvases.set(key, { c, ctx: c.getContext('2d') });
    }
    return grabCanvases.get(key);
  }

  /**
   * A moving picture of its own for the checks, never the screen: frames drawn
   * on a canvas thirty times a second and written to a track generator, so
   * they arrive as a screen's do, whatever this page paints. A canvas's own
   * captureStream was tried first and is not that: measured here, with the
   * main window open, a second recorder page's canvas delivered one frame a
   * second, then none, while its timers and animation frames ran on.
   *
   * `fakeFps` draws it that many times a second instead (a capture asked for
   * 60 delivers up to 60), and 'busy' draws four hundred blocks that move
   * every frame, a picture the encoder has to spend its whole budget on, as
   * it does on a game; the flat picture asks it for less (8.4.2).
   */
  function fakeStream(cmd) {
    const W = cmd.width;
    const H = cmd.height;
    const oc = new OffscreenCanvas(W, H);
    const g = oc.getContext('2d');
    const track = new MediaStreamTrackGenerator({ kind: 'video' });
    const writer = track.writable.getWriter();
    const t0 = performance.now();
    const black = cmd.fake === 'black';
    const busy = cmd.fake === 'busy';
    const fps = Number(cmd.fakeFps) > 0 ? Math.min(240, Number(cmd.fakeFps)) : 30;
    let writing = false;
    let drawn = 0;
    const draw = (ms) => {
      drawn += 1;
      if (black) { g.fillStyle = '#000000'; g.fillRect(0, 0, W, H); return; }
      if (busy) {
        g.fillStyle = 'hsl(' + ((ms / 10) % 360) + ', 60%, 45%)';
        g.fillRect(0, 0, W, H);
        for (let i = 0; i < 400; i++) {
          g.fillStyle = 'rgb(' + ((i * 37 + drawn * 11) % 255) + ',' + ((i * 91 + drawn * 5) % 255) + ',' + ((i * 13 + drawn * 3) % 255) + ')';
          g.fillRect((i * 97 + drawn * 23) % W, (i * 61 + drawn * 17) % H, W / 18, H / 14);
        }
        return;
      }
      g.fillStyle = 'hsl(' + ((ms / 40) % 360) + ', 55%, 45%)';
      g.fillRect(0, 0, W, H);
      g.fillStyle = '#ffffff';
      g.beginPath();
      g.arc(((ms / 3) % (W + 80)) - 40, H / 2, H / 8, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#1a1a1a';
      g.fillRect(W - ((ms / 2) % W), H / 8, Math.max(8, W / 60), H * 0.6);
    };
    const timer = setInterval(() => {
      if (writing) return;
      writing = true;
      const ms = performance.now() - t0;
      draw(ms);
      const f = new VideoFrame(oc, { timestamp: Math.round(ms * 1000) });
      writer.write(f).catch(() => {}).finally(() => { f.close(); writing = false; });
    }, 1000 / fps);
    return {
      stream: new MediaStream([track]),
      size: { width: W, height: H },
      stopFake: () => { clearInterval(timer); writer.close().catch(() => {}); },
    };
  }

  /**
   * What MediaRecorder records: a track generator, written by the grid
   * (grid.js) from a processor on the capture track, thirty frames a second.
   * start() begins the pump once the recorder has started; end() cancels the
   * processor, waits for the pump to hand back every frame it held, then
   * closes the generator. Built again for every recording: a page records
   * once (recorder-window.js), and a display change is a stop and a new page.
   */
  function recordingTrack(track, cmd) {
    const reader = new MediaStreamTrackProcessor({ track, maxBufferSize: 1 }).readable.getReader();
    const gen = new MediaStreamTrackGenerator({ kind: 'video' });
    const writer = gen.writable.getWriter();
    let pumping = null;
    return {
      stream: new MediaStream([gen]),
      /** Whether the generator is still live: once end() is done, no. */
      live: () => gen.readyState === 'live',
      start() {
        pumping = thirty.pump({
          reader, writer, grid: thirty.createGrid(cmd.recordFps), hold, release, now: () => performance.now(),
          kept: () => { recorded += 1; if (firstWall === null) firstWall = Date.now(); },
        });
      },
      async end() {
        try { await reader.cancel(); } catch { /* closed already */ }
        // Every frame the pump held, a write in flight's included, closed.
        if (pumping) await pumping;
        try { await writer.close(); } catch { /* closed already */ }
        try { gen.stop(); } catch { /* stopped already */ }
      },
    };
  }

  /** Every frame read as it comes, the newest kept and every other closed. */
  async function drain(reader) {
    for (;;) {
      let r;
      try { r = await reader.read(); } catch { break; }
      if (r.done) break;
      frames += 1;
      release(newest);
      newest = hold(r.value);
      newestAt = performance.now();
    }
  }

  // A stop that comes while a start is still asking (the gate, the screen)
  // cancels it, so nothing is left recording behind the stop's answer.
  let starting = false;
  let cancelled = false;

  async function start(cmd) {
    if (rec || starting) { bridge.status({ type: 'started', ok: false, outcome: 'error', why: 'already recording' }); return; }
    starting = true;
    cancelled = false;
    try { await begin(cmd); } finally { starting = false; }
  }

  /**
   * THE GATE: can this PC's GPU encode this codec at this size? It is asked
   * for prefer-hardware, and the spike measured that it tells the GPU's
   * encoder apart: yes for H.264, no for VP9, which then ran in software.
   */
  async function hardwareGate(cmd) {
    try {
      const s = await VideoEncoder.isConfigSupported({
        codec: cmd.codec, width: cmd.width, height: cmd.height, bitrate: cmd.bitrate, framerate: 30,
        hardwareAcceleration: 'prefer-hardware',
      });
      return !!(s && s.supported);
    } catch { return false; }
  }

  async function begin(cmd) {
    // THE GATE, before the screen is opened.
    const hardware = await hardwareGate(cmd);
    const mimeType = (cmd.mimeTypes || []).find((m) => { try { return MediaRecorder.isTypeSupported(m); } catch { return false; } });
    if (!hardware || !mimeType) {
      bridge.status({
        type: 'started', ok: false, outcome: 'no-hw-encoder', encoderOk: false,
        why: !hardware ? 'no hardware H.264 encoder at ' + cmd.width + 'x' + cmd.height : 'MediaRecorder records no H.264 type',
      });
      return;
    }
    if (cancelled) return;
    let src;
    try {
      src = cmd.fake ? fakeStream(cmd) : {
        stream: await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: cmd.sourceId, maxWidth: cmd.width, maxHeight: cmd.height, maxFrameRate: cmd.fps } },
        }),
      };
    } catch (e) {
      bridge.status({ type: 'started', ok: false, outcome: 'error', encoderOk: true, why: 'the screen could not be opened: ' + errText(e) });
      return;
    }
    if (cancelled) {
      src.stream.getTracks().forEach((t) => t.stop());
      if (src.stopFake) src.stopFake();
      return;
    }
    const track = src.stream.getVideoTracks()[0];
    // A generated track has no size in its settings; it is the canvas's.
    const s0 = track.getSettings() || {};
    const settings = { ...s0, width: s0.width || (src.size && src.size.width), height: s0.height || (src.size && src.size.height) };
    // What is recorded: thirty frames a second of the capture, never the
    // capture track itself (recordingTrack, grid.js).
    let recording;
    let recorder;
    try {
      recording = recordingTrack(track, cmd);
      recorder = new MediaRecorder(recording.stream, { mimeType, videoBitsPerSecond: cmd.bitrate, videoKeyFrameIntervalDuration: cmd.keyframeMs });
    } catch (e) {
      if (recording) await recording.end();
      src.stream.getTracks().forEach((t) => t.stop());
      if (src.stopFake) src.stopFake();
      bridge.status({ type: 'started', ok: false, outcome: 'error', encoderOk: true, why: 'MediaRecorder refused: ' + errText(e) });
      return;
    }
    const state = { seq: 0, queue: Promise.resolve(), lastChunkAt: Date.now() };
    // In order, and stamped when the chunk was handed over, not when its bytes
    // were read out of the Blob.
    recorder.ondataavailable = (ev) => {
      const wall = Date.now();
      state.lastChunkAt = wall;
      if (!ev.data || !ev.data.size) return;
      const n = state.seq++;
      state.queue = state.queue
        .then(async () => bridge.chunk({ seq: n, wall, data: await ev.data.arrayBuffer() }))
        .catch((e) => bridge.status({ type: 'error', where: 'chunk', message: errText(e) }));
    };
    recorder.onerror = (ev) => bridge.status({ type: 'error', where: 'recorder', message: errText(ev.error || ev) });
    const stopped = new Promise((resolve) => { recorder.onstop = () => resolve(); });
    const clone = track.clone();
    const reader = new MediaStreamTrackProcessor({ track: clone, maxBufferSize: 1 }).readable.getReader();
    const draining = drain(reader);
    // A screen that goes away by itself (the display unplugged) ends the
    // track; stop() never fires this.
    track.addEventListener('ended', () => bridge.status({ type: 'error', where: 'track', message: 'the capture ended by itself' }));
    const startWall = Date.now();
    recorder.start(cmd.timesliceMs);
    recording.start();
    rec = {
      src, track, clone, reader, draining, recorder, recording, stopped, state, timeslice: cmd.timesliceMs,
      tally: account.createTally({ now: performance.now(), frames, recorded }), healthTimer: null,
    };
    rec.healthTimer = setInterval(health, 1000);
    bridge.status({
      type: 'started', ok: true, encoderOk: true, mime: recorder.mimeType, startWall,
      settings: { width: settings.width, height: settings.height, frameRate: settings.frameRate, aspectRatio: settings.aspectRatio, resizeMode: settings.resizeMode },
      // The bitrate MediaRecorder took, which can differ from the one asked.
      videoBitsPerSecond: Number.isFinite(recorder.videoBitsPerSecond) ? recorder.videoBitsPerSecond : null,
    });
  }

  /**
   * The track's own settings as Chromium reports them now, its frame rate and
   * size, the canvas's size for a generated track (which reports none). Read
   * each second for main's minute line (recorder.js logStatus), beside the
   * frames that came: on the player's Fracture swiftplay the recording fell
   * from 57 to 32 frames a second for its last two minutes, and nothing in the
   * log said whether the capture had been asked for less (8.4.1).
   */
  function trackSettings(r) {
    let s = {};
    try { s = r.track.getSettings() || {}; } catch { s = {}; }
    const size = r.src && r.src.size;
    return {
      width: s.width || (size && size.width) || null,
      height: s.height || (size && size.height) || null,
      frameRate: Number.isFinite(s.frameRate) ? r1(s.frameRate) : null,
    };
  }

  /**
   * Once a second, how the capture is coping (health.js keeps the account):
   * `fps` what it delivered, which the busy rule judges, and `recordedFps`
   * what the recording kept of it, which Settings and the counts say;
   * `firstWall` the wall clock its first frame was handed over at, which the
   * recording's 0 is (MediaRecorder stamps a generator's frame when it is
   * written), for main to hold its own reckoning of that 0 against; and
   * `mono`, this page's monotonic clock at `at`, the clock MediaRecorder
   * stamps by, so main can follow the wall clock as Windows moves it against
   * that one (recorder.js Segment.zeroAt).
   */
  function health() {
    const r = rec;
    if (!r) return;
    const a = r.tally.second({ now: performance.now(), frames, recorded, newestAt: newest ? newestAt : null, thumb: newestThumb });
    bridge.status({
      type: 'health', at: Date.now(), mono: performance.now(), fps: a.fps, recordedFps: a.recordedFps, changing: a.changing, luma: a.luma, frameAgeMs: a.frameAgeMs,
      lagMs: Math.max(0, Date.now() - r.state.lastChunkAt - r.timeslice),
      framesOpen: open,
      firstWall,
      track: trackSettings(r),
    });
  }

  /** The read's frame: the newest, stretched to the size asked, as the GDI helper does. */
  async function grab(cmd) {
    if (!newest) { bridge.reply({ id: cmd.id, ok: false, why: 'no frame yet' }); return; }
    const age = performance.now() - newestAt;
    if (age > STALE_MS) { bridge.reply({ id: cmd.id, ok: false, why: 'stale', ageMs: Math.round(age) }); return; }
    const t = grabCanvas(cmd.width, cmd.height);
    const f = hold(newest.clone());
    // STRETCHED, with no regard for the shape, exactly as OcclaraCapture.cs's
    // new Bitmap(shot, w, h): the read was benched on that frame.
    try { t.ctx.drawImage(f, 0, 0, cmd.width, cmd.height); } finally { release(f); }
    const blob = await t.c.convertToBlob({ type: 'image/jpeg', quality: cmd.quality });
    bridge.reply({ id: cmd.id, ok: true, jpeg: await blob.arrayBuffer(), ageMs: Math.round(age) });
  }

  /** The stream's newest frame against the GDI frame main took just before. */
  async function compare(cmd) {
    const s = newestThumb();
    if (!s) { bridge.reply({ id: cmd.id, ok: false, why: 'no frame yet' }); return; }
    const out = { id: cmd.id, ok: true, streamLuma: r1(s.mean), gdiLuma: null, mad: null, ageMs: Math.round(performance.now() - newestAt) };
    if (cmd.gdi) {
      let bmp;
      try { bmp = await createImageBitmap(new Blob([cmd.gdi], { type: 'image/jpeg' })); } catch (e) {
        bridge.reply({ id: cmd.id, ok: false, why: 'the GDI frame did not decode: ' + errText(e) });
        return;
      }
      let g;
      try { g = thumb(bmp); } finally { bmp.close(); }
      out.gdiLuma = r1(g.mean);
      out.mad = r1(account.mad(g.luma, s.luma));
    }
    bridge.reply(out);
  }

  /**
   * A clean stop: the last chunk handed over, then the recording's track torn
   * down and the read's, before main is told, with how many frames are still
   * open (none, or a capture buffer was never given back), how many tracks
   * are still live (none: the capture, its clone and the generator all
   * ended), and how many frames were recorded.
   */
  async function stop() {
    const r = rec;
    if (!r) {
      if (starting) cancelled = true;
      bridge.status({ type: 'stopped', chunks: 0, framesOpen: open, tracksLive: 0, recorded });
      return;
    }
    rec = null;
    clearInterval(r.healthTimer);
    try { if (r.recorder.state !== 'inactive') r.recorder.stop(); } catch { /* stopped already */ }
    await Promise.race([r.stopped, sleep(5000)]);
    await r.state.queue;
    await r.recording.end();
    try { await r.reader.cancel(); } catch { /* closed already */ }
    await r.draining;
    release(newest);
    newest = null;
    r.clone.stop();
    r.src.stream.getTracks().forEach((t) => t.stop());
    if (r.src.stopFake) r.src.stopFake();
    const tracksLive = [r.track, r.clone].filter((t) => t.readyState === 'live').length + (r.recording.live() ? 1 : 0);
    bridge.status({ type: 'stopped', chunks: r.state.seq, framesOpen: open, tracksLive, recorded });
  }

  /** The gate's answer alone, for a codec and size main asks about (check:recorder asks it of VP9). */
  async function gate(cmd) {
    bridge.reply({ id: cmd.id, ok: true, supported: await hardwareGate(cmd) });
  }

  // A read or a comparison that fails answers no, and the recording goes on.
  const answering = (fn) => (cmd) => fn(cmd).catch((e) => bridge.reply({ id: cmd.id, ok: false, why: errText(e) }));
  const handlers = { start, stop, grab: answering(grab), compare: answering(compare), gate: answering(gate) };
  bridge.onCommand((cmd) => {
    const h = cmd && handlers[cmd.type];
    if (!h) return;
    Promise.resolve().then(() => h(cmd)).catch((e) => bridge.status({ type: 'error', where: cmd.type, message: errText(e) }));
  });
  bridge.status({ type: 'ready' });
}());

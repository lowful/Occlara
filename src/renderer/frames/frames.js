'use strict';

/**
 * THE FRAMES PAGE (8.3.1). A window that is never shown, with nothing in it to
 * show: main hands it a clip's encoded frames (src/shared/clip-frames.js
 * decodeJob) and which of them it wants, and it answers with those frames as
 * stills, JPEG at the read's size and quality, for the look at a death.
 *
 * WEBCODECS, NOT A <video>. Both were measured on the real Sunset match's
 * round 3 clip (1920x1080 H.264, a keyframe a second) in a window never
 * shown, for six frames around the death, against ffmpeg's decode of the same
 * frames by index: every still from either was that frame, 2 to 5 of 255
 * apart on average, the JPEG's own loss. A VideoDecoder fed the 101 frames
 * from the keyframes before them took 116 ms preferring the GPU, 358 ms with
 * no preference and 599 ms in software. A <video> seeked to each took 6.3 s,
 * about a second a seek, and requestVideoFrameCallback fired on three of the
 * six: a paused element in a page nobody sees presents frames when it
 * pleases. A decoder outputs every frame it is fed, in order, whatever the
 * page's state.
 *
 * Each frame is closed as soon as it is drawn or passed over: a decoder holds
 * few output buffers, and one left open stalls it, as a capture's does in the
 * recorder's page.
 */
(function () {
  const bridge = window.occlaraFrames;
  if (!bridge) return;
  const errText = (e) => (e && e.name && e.message ? e.name + ': ' + e.message : String((e && e.message) || e));

  /** The wanted frames of one job, decoded with one choice of hardware. */
  async function decode(job, accel) {
    const config = {
      codec: job.codec, codedWidth: job.width, codedHeight: job.height,
      hardwareAcceleration: accel, optimizeForLatency: true,
    };
    const support = await VideoDecoder.isConfigSupported(config);
    if (!support || !support.supported) throw new Error(`${job.codec} at ${job.width}x${job.height} is not decoded here (${accel})`);
    // Which picks each decoded frame is, by its timestamp.
    const want = new Map();
    job.picks.forEach((ts, i) => {
      if (typeof ts !== 'number') return;
      if (!want.has(ts)) want.set(ts, []);
      want.get(ts).push(i);
    });
    const out = new Array(job.picks.length).fill(null);
    const stills = [];
    let failed = null;
    const decoder = new VideoDecoder({
      output: (frame) => {
        try {
          const idx = want.get(frame.timestamp);
          if (!idx) return;
          // Stretched to the read's size, as the read's own frame is, on a
          // canvas of its own so no still waits on another.
          const c = new OffscreenCanvas(job.outWidth, job.outHeight);
          c.getContext('2d').drawImage(frame, 0, 0, job.outWidth, job.outHeight);
          stills.push(c.convertToBlob({ type: 'image/jpeg', quality: job.quality })
            .then((b) => b.arrayBuffer())
            .then((buf) => { for (const i of idx) out[i] = buf; }));
        } finally {
          frame.close();
        }
      },
      error: (e) => { failed = e; },
    });
    try {
      decoder.configure(config);
      for (const c of job.chunks) {
        if (failed) break;
        decoder.decode(new EncodedVideoChunk({ type: c.key ? 'key' : 'delta', timestamp: c.ts, data: c.data }));
      }
      if (!failed) await decoder.flush();
    } finally {
      if (decoder.state !== 'closed') decoder.close();
    }
    await Promise.all(stills);
    if (failed) throw failed;
    return out;
  }

  bridge.onJob(async (job) => {
    const t0 = performance.now();
    let lastError = null;
    // The GPU's decoder first, then whatever this Chromium has.
    for (const accel of ['prefer-hardware', 'no-preference']) {
      try {
        const frames = await decode(job, accel);
        bridge.reply({ id: job.id, ok: true, frames, accel, ms: Math.round(performance.now() - t0) });
        return;
      } catch (e) {
        lastError = errText(e);
      }
    }
    bridge.reply({ id: job.id, ok: false, frames: [], error: lastError, ms: Math.round(performance.now() - t0) });
  });
  bridge.reply({ type: 'ready' });
})();

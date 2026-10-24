'use strict';

/**
 * THE CLIP PLAYER (8.4.4): every clip a review shows, a Valorant round's and a
 * League death's alike, with the controls the player asked for. It played,
 * muted and looping, and a click played or paused it; nothing else.
 *
 * WHAT IT HAS. Under the picture, a timeline and a row: play and pause, back
 * to the start, back and forward a second, back and forward one frame (which
 * pause first), the time as seconds from the death, and the speed, 1x, 0.5x
 * and 0.25x. The timeline is an input of type range, read out as the seconds
 * from the death, with the death marked on it in --bad and the coach's stills
 * where they were taken (their frameAt): where the death's place in the clip
 * is not known (a review saved before 8.4.4, a look that never timed its
 * frames) nothing is marked, and the time is the clip's own seconds.
 *
 * A FRAME STEP LANDS ON A REAL FRAME: the next or previous frame, from the
 * clip's frames main read off its blocks, at the time inside it where by
 * Chromium's own estimate the frame before is over and this one is not
 * (clip-time.js says what was measured). A second either way and the
 * timeline land inside a frame the same way. And the frame the compositor
 * then presents is checked against it, the seek going again when it is not
 * (SEEN, NOT ASSUMED, below), so the time beside the clip is the frame shown.
 *
 * THE KEYBOARD, ONLY WHILE THE PLAYER HAS FOCUS: Space or K plays and pauses,
 * comma and full stop step a frame, the arrows a second, Home goes back to the
 * start. Nothing takes focus by itself, so the page's own scroll keys are
 * never stolen; a click on the picture, or on one of the controls, hands the
 * player the keyboard (its root, out of the tab order), and Space on a control
 * reached by Tab presses that control, as a button's Space does everywhere.
 * The stills under it hear the same keys (keysFrom): each is a place in the
 * clip, so a still clicked and then full stop steps on from that frame.
 *
 * CHEAP AND CALM. Nothing loads until the clip is first played or moved: the
 * poster is the frame the coach looked at, and a review of six clips open
 * between matches sets up no decoder at all (measured, a clip loading its
 * metadata took about 40% of a core in the GPU process for a second). ONE
 * SEEK IN FLIGHT at a time: a seek decodes from the keyframe before it, and a
 * scrub asks for one each pointer move, so the next waits for `seeked` and
 * only the newest waits at all. And NONE TO WHERE IT ALREADY STANDS, paused:
 * at the last frame Chromium answers that one by looping the clip back to
 * its start, so a step on at the end was frame 0. Out of view, or with the
 * page hidden, it pauses. No animation of its own under reduced motion
 * (review.css).
 *
 * DOM built with textContent only, every control a button or an input with
 * its own accessible name.
 */
(function () {
  const T = window.ClipTime;
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const SPEEDS = [1, 0.5, 0.25];
  // A seek that never says it landed lets the next one go after this long.
  const SEEK_GIVE_UP_MS = 3000;
  // Two times this close are one place in a clip: its frames are 15 ms apart or more.
  const SAME_S = 0.0005;
  // A seek that showed another frame than the one it was for goes again this often at most.
  const MAX_TRIES = 6;
  // How long a landed seek waits for the frame it shows to be presented, at most.
  const SHOWN_WAIT_MS = 250;
  const KEYS = 'Space or K plays and pauses, comma and full stop step one frame, the arrows one second, and Home goes back to the start.';

  // The marks, on the 24 unit grid the app's icons use, filled.
  const PATHS = {
    play: 'M8 5.5v13l10.5-6.5z',
    pause: 'M7.5 5.5h3v13h-3zM13.5 5.5h3v13h-3z',
    start: 'M5 6h2v12H5zM13 6v12l-5.5-6zM18.5 6v12L13 12z',
    backSecond: 'M11.5 6v12L5 12zM18.5 6v12L12 12z',
    backFrame: 'M14.5 6v12L7 12zM16 6h2.2v12H16z',
    forwardFrame: 'M5.8 6H8v12H5.8zM9.5 6L17 12l-7.5 6z',
    forwardSecond: 'M5.5 6L12 12l-6.5 6zM12.5 6L19 12l-6.5 6z',
  };

  let seq = 0;
  let watch = null;

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = String(text);
    return n;
  }

  function mark(kind) {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('class', `v-clip-mark ${kind}`);
    const p = document.createElementNS(SVG_NS, 'path');
    p.setAttribute('d', PATHS[kind]);
    p.setAttribute('fill', 'currentColor');
    svg.append(p);
    return svg;
  }

  /** A control of the row: its name, the key that does the same, and its mark. */
  function control(act, name, key, keys) {
    const b = el('button', 'icon-btn cp-btn');
    b.type = 'button';
    b.dataset.act = act;
    b.setAttribute('aria-label', name);
    b.setAttribute('aria-keyshortcuts', keys);
    b.title = `${name} (${key})`;
    b.append(mark(act));
    return b;
  }

  /** Out of view, a clip pauses (IntersectionObserver), where the page has one. */
  function watchClip(v) {
    if (typeof IntersectionObserver !== 'function') return;
    if (!watch) {
      watch = new IntersectionObserver((entries) => {
        for (const e of entries) if (!e.isIntersecting && e.target.paused === false) e.target.pause();
      }, { threshold: 0 });
    }
    watch.observe(v);
  }

  /** Every clip in `host` stopped and let go, so a repaint leaves no decoder running behind it. */
  function release(host) {
    if (!host) return;
    for (const v of host.querySelectorAll('video')) {
      if (watch) watch.unobserve(v);
      if (typeof v.pause === 'function') v.pause();
      v.removeAttribute('src');
      if (typeof v.load === 'function') v.load();
    }
  }

  // A page hidden (another page, the seal) pauses every clip on it.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) return;
    for (const v of document.querySelectorAll('video')) if (v.paused === false) v.pause();
  });

  /**
   * One clip's player.
   *
   *   url      where it plays from (occlara-clip://)
   *   poster   the picture until it is first played, or none
   *   label    what the player is called: "The clip of round 6"
   *   frames   its frames, { times, end } (review-clips.js frameTimes), or none
   *   death    the death's place in it, ms (clipDeath), or none
   *   screen   a look from the screen: the time counts from its read of the death
   *   stills   the coach's stills, their seconds from the death (frameAt)
   *   onStill  (i) => the still the clip now shows, null once it moves on
   *
   * Returns { el, video, canShow(at), showStill(at, i), keysFrom(host) }: the
   * figure, its <video>, and for the filmstrip under it whether a still's
   * moment is in the clip, the clip moved there and paused, and its keys
   * heard there too.
   */
  function create(opts) {
    const o = opts || {};
    const n = ++seq;
    const frames = T.framesOf(o.frames);
    const death = typeof o.death === 'number' && Number.isFinite(o.death) && o.death >= 0
      && (!frames || o.death <= frames.end) ? o.death : null;
    const screen = !!o.screen;
    const stills = death === null ? [] : (Array.isArray(o.stills) ? o.stills : [])
      .map((at, i) => ({ at, i })).filter((s) => typeof s.at === 'number' && Number.isFinite(s.at));
    const onStill = typeof o.onStill === 'function' ? o.onStill : () => {};

    const fig = el('figure', 'v-clip');
    fig.setAttribute('role', 'group');
    fig.setAttribute('aria-label', o.label || 'The clip');
    fig.tabIndex = -1;
    const keysId = `cp-keys-${n}`;
    fig.setAttribute('aria-describedby', keysId);

    const v = document.createElement('video');
    v.className = 'v-clip-video';
    // The attributes are what a reader of the markup sees; muted is set as the
    // property too, since the attribute alone only sets where muted starts.
    v.muted = true;
    for (const a of ['muted', 'loop', 'playsinline']) v.setAttribute(a, '');
    v.setAttribute('preload', 'none');
    if (o.poster) v.setAttribute('poster', o.poster);
    v.setAttribute('src', o.url);
    // The mark over the picture until it is first played or moved: a picture
    // of the play button below, never one of its own, and never over a frame
    // being studied.
    const big = el('span', 'v-clip-big');
    big.setAttribute('aria-hidden', 'true');
    big.append(mark('play'));
    const frame = el('div', 'v-clip-frame');
    frame.append(v, big);

    // The timeline: a track drawn under the range, its fill and its marks.
    const line = el('div', 'cp-line');
    const track = el('div', 'cp-track');
    track.setAttribute('aria-hidden', 'true');
    const fill = el('span', 'cp-fill');
    track.append(fill);
    const marks = [];
    for (const s of stills) {
      const m = el('i', 'cp-mark still');
      marks.push({ el: m, ms: death + s.at * 1000 });
      track.append(m);
    }
    if (death !== null) {
      const m = el('i', 'cp-mark death');
      marks.push({ el: m, ms: death });
      track.append(m);
    }
    const range = el('input', 'cp-seek');
    range.setAttribute('type', 'range');
    range.setAttribute('min', '0');
    range.setAttribute('step', '1');
    range.setAttribute('aria-label', 'Time in the clip');
    if (death !== null) {
      range.title = stills.length
        ? `The red mark is ${screen ? 'where the screen read the death' : 'the death'}, the white ones the coach's stills`
        : `The red mark is ${screen ? 'where the screen read the death' : 'the death'}`;
    }
    line.append(track, range);

    const playBtn = el('button', 'icon-btn cp-btn v-clip-play');
    playBtn.type = 'button';
    playBtn.setAttribute('aria-keyshortcuts', 'Space K');
    playBtn.append(mark('play'), mark('pause'));
    const startBtn = control('start', 'Back to the start', 'Home', 'Home');
    const backS = control('backSecond', 'Back one second', '←', 'ArrowLeft');
    const backF = control('backFrame', 'Back one frame', ',', ',');
    const fwdF = control('forwardFrame', 'Forward one frame', '.', '.');
    const fwdS = control('forwardSecond', 'Forward one second', '→', 'ArrowRight');
    const time = el('span', 'cp-time');
    time.setAttribute('aria-hidden', 'true');
    const speed = el('div', 'cp-speed');
    speed.setAttribute('role', 'group');
    speed.setAttribute('aria-label', 'Playback speed');
    const rates = SPEEDS.map((s) => {
      const b = el('button', 'cp-rate', `${s}x`);
      b.type = 'button';
      b.title = `Play at ${s}x`;
      b.setAttribute('aria-pressed', s === 1 ? 'true' : 'false');
      b.addEventListener('click', () => setRate(s));
      speed.append(b);
      return b;
    });
    const row = el('div', 'cp-row');
    row.append(playBtn, startBtn, backS, backF, fwdF, fwdS, time, speed);
    const bar = el('div', 'cp-bar');
    bar.append(line, row);

    const keys = el('span', 'sr-only', KEYS);
    keys.id = keysId;
    // Said once a discrete move lands (a step, a second, the start, a still),
    // never while the clip plays or the timeline is dragged, which says its own.
    const said = el('span', 'sr-only');
    said.setAttribute('aria-live', 'polite');
    fig.append(frame, bar, keys, said);

    // ── State ──
    let asked = 0;          // the time last asked for, seconds
    let inFlight = false;   // a seek of ours has not said it landed
    let queued = null;      // the newest time asked for meanwhile
    let sent = null;        // the time the seek on its way was set to
    let rest = null;        // where a seek of ours left the clip paused, until anything moves it
    let restFrame = null;   // and the frame it was for there, by its index
    let giveUp = null;
    let scrubbing = false;
    let resume = false;
    let shownStill = null;
    let aim = null;         // the frame the seek on its way is for, by its index in the clip's frames
    let tries = 0;          // how often that seek has gone again to show it
    let token = 0;          // which seek a wait for its frame belongs to
    let onScreen = null;    // the frame seen on screen once a seek of ours landed, paused, by its index
    let past = null;        // a frame that would not show after every try: the next move counts from it
    let lo = null;          // in a seek's tries, the latest time seen to show a frame before the one aimed at
    let hi = null;          // and the earliest seen to show one after it
    let tried = [];         // and each try, { at, j }: the time sent and the frame it showed
    let toward = 0;         // the way the move goes, 1 on and -1 back, for the try kept when none showed it
    let final = false;      // the last seek of a move, to the try kept: whatever it shows stays
    let shownMs = null;     // the newest frame the compositor presented: its own time, ms
    let shownCount = 0;     // how many it has presented
    let countAtSeek = 0;
    const known = new Map(); // frame index => a time seen to show it, seconds

    const lengthMs = () => (Number.isFinite(v.duration) && v.duration > 0 ? v.duration * 1000 : frames ? frames.end : 0);
    const playing = () => v.paused === false;
    const current = () => (Number.isFinite(v.currentTime) ? v.currentTime : asked);
    const words = (t) => T.timeWords(t, { death, screen, frames, duration: lengthMs() / 1000 });

    // SEEN, NOT ASSUMED. Paused, Chromium shows the first frame whose end by
    // its own estimate reaches the time asked for, an average of the frames'
    // lengths that takes in those decoded ahead of it (clip-time.js): beside a
    // capture stall, or short frames after long ones, a step inside a frame
    // showed the one before it (measured on a real 30 a second clip: frames
    // after a 313 ms stall shown for none of their own times). So the frame a
    // seek of ours shows is read off the compositor (requestVideoFrameCallback,
    // each presented frame's own time), and when it is not the frame the move
    // was for, the seek goes again by what it saw, MAX_TRIES times at most:
    // the time it was shown the frame before for says how long Chromium takes
    // that frame to last, and the frame wanted is shown up to that much past
    // its own start. The time beside the clip, and the next step, then count
    // from the frame on screen, which can lie a frame or two before where the
    // clock stands. Without the clip's frames, or the callback, nothing is
    // checked, as before.
    const canSee = !!frames && typeof v.requestVideoFrameCallback === 'function';
    const watchShown = () => v.requestVideoFrameCallback((_now, meta) => {
      shownMs = meta && Number.isFinite(meta.mediaTime) ? meta.mediaTime * 1000 : null;
      shownCount += 1;
      watchShown();
    });
    if (canSee) watchShown();
    /** The frame the compositor last presented, by its index, or -1. */
    const shownIndex = () => {
      if (!frames || shownMs === null) return -1;
      const i = T.frameIndex(frames.times, shownMs + 0.5);
      return i >= 0 && Math.abs(frames.times[i] - shownMs) < 1 ? i : -1;
    };
    /** Where the clip stands for its words and the next step: the frame seen on screen, paused, else its clock. */
    const here = () => (onScreen !== null && !playing() ? T.insideOf(frames, onScreen) : current());

    function setLength() {
      const len = Math.round(lengthMs());
      range.setAttribute('max', String(len));
      range.max = String(len);
      for (const k of marks) {
        const p = len > 0 ? k.ms / len : -1;
        k.el.hidden = !(p >= 0 && p <= 1);
        k.el.style.setProperty('--p', String(Math.min(1, Math.max(0, p))));
      }
    }

    function paint(t) {
      const len = lengthMs();
      const p = len > 0 ? Math.min(1, Math.max(0, (t * 1000) / len)) : 0;
      line.style.setProperty('--p', String(Math.round(p * 10000) / 10000));
      if (!scrubbing) range.value = String(Math.round(t * 1000));
      const w = words(t);
      if (time.textContent !== w.text) time.textContent = w.text;
      time.classList.toggle('at-death', w.death);
      range.setAttribute('aria-valuetext', w.label);
    }

    function sync() {
      const on = playing();
      fig.classList.toggle('playing', on);
      if (on) fig.classList.add('started');
      const label = on ? 'Pause the clip' : 'Play the clip';
      playBtn.setAttribute('aria-label', label);
      playBtn.title = `${label} (K)`;
    }

    function play() {
      const started = typeof v.play === 'function' ? v.play() : null;
      if (started && typeof started.catch === 'function') started.catch(() => sync());
    }
    function toggle() {
      leaveStill();
      if (playing()) v.pause(); else play();
    }

    function setRate(s) {
      v.playbackRate = s;
      v.defaultPlaybackRate = s;
      rates.forEach((b, i) => b.setAttribute('aria-pressed', SPEEDS[i] === s ? 'true' : 'false'));
    }

    // Moved before it was ever played: the clip loads now, its seek kept for
    // when its length is known. A preload of none is how Chromium defers it.
    function load() {
      if (v.readyState >= 1 || v.getAttribute('preload') === 'auto') return;
      v.setAttribute('preload', 'auto');
    }

    function go(t) {
      aim = frames ? Math.max(0, T.frameIndex(frames.times, t * 1000)) : null;
      const base = frames ? T.frameIndex(frames.times, here() * 1000) : -1;
      toward = aim === null ? 0 : Math.sign(aim - base);
      tries = 0;
      lo = null;
      hi = null;
      tried = [];
      final = false;
      // A frame seen shown before by another time goes to that time again.
      const to = aim !== null && known.has(aim) ? known.get(aim) : t;
      // ALREADY THERE, NO SEEK. Paused where a seek of ours left it, a move to
      // the same place for the same frame is none: its frame is on screen.
      // And at the clip's last frame, once its pipeline has ended there,
      // Chromium answers one by looping the clip back to its start (the loop
      // attribute): measured on the player's own clips, a step forward at the
      // last frame, a second on there and the timeline at its end twice each
      // showed frame 0. The same frame, never only the same time: a time a
      // frame was shown by can lie inside the next frame, and the next frame's
      // own time there, taken for the same place, held a step still for good.
      if (rest !== null && aim === restFrame && Math.abs(to - rest) < SAME_S && !playing() && !v.seeking) {
        inFlight = false;
        aim = null;
        paint(here());
        return;
      }
      send(to);
    }

    function send(t) {
      inFlight = true;
      sent = t;
      rest = null;
      onScreen = null;
      past = null;
      countAtSeek = shownCount;
      token += 1;
      clearTimeout(giveUp);
      giveUp = setTimeout(() => settle(-1), SEEK_GIVE_UP_MS);
      try { v.currentTime = t; } catch { settle(-1); }
    }

    /**
     * A seek of ours landed: wait for the frame it shows, two animation
     * frames after one is presented (a frame painted ahead of the seek's own
     * comes before it), SHOWN_WAIT_MS at most, then judge it.
     */
    function look() {
      const mine = token;
      let after = 2;
      const until = (typeof performance === 'object' ? performance.now() : 0) + SHOWN_WAIT_MS;
      const now = () => (typeof performance === 'object' ? performance.now() : until);
      const check = () => {
        if (mine !== token || !inFlight) return;
        if (queued !== null) { settle(-1); return; }
        if (shownCount > countAtSeek && --after <= 0) { judge(); return; }
        if (now() >= until) { judge(); return; }
        requestAnimationFrame(check);
      };
      requestAnimationFrame(check);
      // Hidden, a page paints no frame: the wait ends all the same.
      setTimeout(() => { if (mine === token && inFlight) judge(); }, SHOWN_WAIT_MS + 50);
    }

    /** The frame the seek showed, against the one it was for: kept, or sent again by what was seen. */
    function judge() {
      const j = shownCount > countAtSeek ? shownIndex() : -1;
      if (final || j < 0 || j === aim || queued !== null || playing()) { settle(j); return; }
      tried.push({ at: sent, j });
      if (j < aim) lo = lo === null ? sent : Math.max(lo, sent);
      else hi = hi === null ? sent : Math.min(hi, sent);
      if (tries >= MAX_TRIES) { keepBest(j); return; }
      tries += 1;
      const start = frames.times[aim];
      const end = aim + 1 < frames.times.length ? frames.times[aim + 1] : frames.end;
      const margin = Math.min(T.INSIDE_MS, (end - start) / 4);
      const at = sent * 1000;
      // Between the latest time seen to show a frame too early and the
      // earliest seen to show one too late, the middle. Before both are
      // known: shown the frame just before, Chromium takes it to last at
      // least from its own time to there, and the frame aimed at as long, so
      // just short of that past its own start; shown one further back (beside
      // a stall Chromium has shown a frame nine before it), a frame's length
      // later; shown a later frame, halfway back to the frame's own start.
      let next;
      if (lo !== null && hi !== null) next = (lo + hi) * 500;
      else if (j === aim - 1) next = start + (at - frames.times[j]) - margin;
      else if (j < aim) next = at + (end - start);
      else next = start + Math.max(margin, (at - start) / 2);
      const to = Math.max(0, Math.min(lengthMs() - margin, next)) / 1000;
      if (Math.abs(to - sent) < SAME_S) { keepBest(j); return; }
      send(to);
    }

    /**
     * Every try spent and none showed the frame aimed at: back to the try
     * that showed the frame nearest it, one on the way the move goes before
     * one behind, and whatever that shows stays. Kept to the last try, a
     * step on beside a stall stood nine frames back.
     */
    function keepBest(j) {
      const score = (x) => Math.abs(x.j - aim) * 2 + (toward !== 0 && Math.sign(x.j - aim) !== toward ? 1 : 0);
      const best = tried.reduce((a, b) => (score(b) < score(a) ? b : a), tried[0]);
      if (!best || best.j === j || Math.abs(best.at - sent) < SAME_S) { settle(j); return; }
      final = true;
      send(best.at);
    }

    /** The seek's work is done: what it shows kept for the words and the next step, then the next seek asked for. */
    function settle(j) {
      const seen = canSee && j >= 0 && !playing();
      onScreen = seen ? j : null;
      // A frame Chromium would not show for any time tried: the time beside
      // the clip is the frame on screen, and the next move counts on from the
      // one aimed at, so a step is never stuck behind it.
      past = seen && aim !== null && j !== aim ? aim : null;
      if (seen && j === aim) known.set(aim, sent);
      rest = playing() ? null : sent;
      restFrame = seen ? j : aim;
      landed();
    }

    function landed() {
      clearTimeout(giveUp);
      giveUp = null;
      inFlight = false;
      aim = null;
      tries = 0;
      if (queued !== null && v.readyState >= 1) {
        const t = queued;
        queued = null;
        go(t);
        return;
      }
      if (queued === null) paint(here());
    }

    /** The clip moved to `t` seconds: one seek in flight, the newest asked waiting for it. */
    function seek(t) {
      const len = lengthMs() / 1000;
      const to = Math.max(0, len > 0 ? Math.min(len, t) : t);
      asked = to;
      fig.classList.add('started');
      paint(to);
      if (!(v.readyState >= 1)) { queued = to; load(); return; }
      if (inFlight) { queued = to; return; }
      go(to);
    }

    /** Where a move counts from: the newest time asked for while one is on its way, else where the clip is. */
    const from = () => {
      if (inFlight || queued !== null) return asked;
      return past !== null && !playing() ? T.insideOf(frames, past) : here();
    };

    function leaveStill() {
      if (shownStill === null) return;
      shownStill = null;
      onStill(null);
    }

    function say(t) { said.textContent = words(t).label; }

    function act(what) {
      if (what === 'toggle') { toggle(); return; }
      leaveStill();
      let to = null;
      if (what === 'start') to = T.startOf(frames);
      // A second either way lands inside the frame there, so the time said is the frame shown.
      else if (what === 'backSecond') to = T.landOn(frames, from() - 1);
      else if (what === 'forwardSecond') to = T.landOn(frames, from() + 1);
      else if (what === 'backFrame' || what === 'forwardFrame') {
        // A frame is studied paused.
        if (playing()) v.pause();
        to = T.stepFrom(frames, from(), what === 'backFrame' ? -1 : 1, lengthMs() / 1000);
      }
      if (to === null) return;
      seek(to);
      say(asked);
    }

    // ── The controls ──
    playBtn.addEventListener('click', () => toggle());
    for (const b of [startBtn, backS, backF, fwdF, fwdS]) b.addEventListener('click', () => act(b.dataset.act));
    // A control pressed with the pointer hands the keyboard to the player, not
    // to itself: Space after a click on a step plays, rather than stepping again.
    bar.addEventListener('mousedown', (e) => {
      const b = e.target && typeof e.target.closest === 'function' ? e.target.closest('button') : null;
      if (!b) return;
      e.preventDefault();
      fig.focus({ preventScroll: true });
    });
    v.addEventListener('click', () => {
      toggle();
      fig.focus({ preventScroll: true });
    });

    // The timeline: dragged, the clip waits paused at each place and plays on
    // when let go if it was playing. LET GO ANYWHERE: grabbed, dragged off the
    // timeline and let go there with its place unchanged, the range heard
    // neither its pointerup nor a change, and the clip stayed paused with its
    // timeline and its time stopped for good while it played (measured), so
    // the page's own pointerup lets go too.
    const letGo = () => {
      window.removeEventListener('pointerup', letGo, true);
      window.removeEventListener('pointercancel', letGo, true);
      if (!scrubbing) return;
      scrubbing = false;
      if (resume) { resume = false; play(); }
    };
    range.addEventListener('pointerdown', () => {
      leaveStill();
      scrubbing = true;
      resume = playing();
      if (resume) v.pause();
      load();
      window.addEventListener('pointerup', letGo, true);
      window.addEventListener('pointercancel', letGo, true);
    });
    range.addEventListener('pointerup', letGo);
    range.addEventListener('pointercancel', letGo);
    range.addEventListener('change', letGo);
    range.addEventListener('input', () => {
      leaveStill();
      seek(T.landOn(frames, Number(range.value) / 1000));
    });

    function onKey(e) {
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      const k = e.key;
      const onRange = e.target === range;
      const onButton = !!e.target && e.target.tagName === 'BUTTON';
      let what = null;
      if (k === 'k' || k === 'K') what = 'toggle';
      // Space on a control reached by Tab presses that control.
      else if (k === ' ' || k === 'Spacebar') what = onButton ? null : 'toggle';
      else if (k === ',') what = 'backFrame';
      else if (k === '.') what = 'forwardFrame';
      else if (k === 'ArrowLeft' || (onRange && k === 'ArrowDown')) what = 'backSecond';
      else if (k === 'ArrowRight' || (onRange && k === 'ArrowUp')) what = 'forwardSecond';
      else if (k === 'Home') what = 'start';
      if (!what) return;
      e.preventDefault();
      act(what);
    }
    fig.addEventListener('keydown', onKey);

    // ── The clip's own events ──
    v.addEventListener('play', sync);
    v.addEventListener('pause', sync);
    v.addEventListener('playing', leaveStill);
    v.addEventListener('loadedmetadata', () => {
      setLength();
      if (queued !== null && !inFlight) {
        const t = queued;
        queued = null;
        go(t);
      }
    });
    v.addEventListener('durationchange', setLength);
    v.addEventListener('seeked', () => {
      if (!inFlight) {
        if (queued === null && !scrubbing) paint(here());
        return;
      }
      clearTimeout(giveUp);
      giveUp = null;
      // A seek of ours landed: the frame it shows is looked at before it
      // counts as done (SEEN, NOT ASSUMED), unless a newer move waits.
      if (canSee && aim !== null && queued === null && !playing() && !document.hidden) { look(); return; }
      settle(-1);
    });
    // Moved by anything but a seek of ours (played, looped, let go): no longer where one left it.
    const moved = () => { rest = null; onScreen = null; past = null; };
    v.addEventListener('seeking', () => { if (!inFlight) moved(); });
    v.addEventListener('play', moved);
    v.addEventListener('emptied', moved);
    v.addEventListener('timeupdate', () => {
      if (!inFlight && queued === null && !scrubbing) paint(here());
    });

    setLength();
    paint(0);
    sync();
    watchClip(v);

    /** Whether a still `at` seconds from the death is a place in this clip. */
    const canShow = (at) => {
      if (death === null || typeof at !== 'number' || !Number.isFinite(at)) return false;
      const ms = death + at * 1000;
      return ms >= 0 && (!frames || ms <= frames.end);
    };
    /** The clip moved to a still's own frame, and paused there. */
    const showStill = (at, i) => {
      if (!canShow(at)) return;
      if (playing()) v.pause();
      seek(T.stillAt(frames, death, at));
      say(asked);
      shownStill = Number.isInteger(i) ? i : null;
      onStill(shownStill);
    };
    /**
     * The player's keys heard on `host` as well: the stills under it, which
     * are places in it. A still clicked keeps the focus, and full stop pressed
     * then did nothing; now it steps on from the still's frame.
     */
    const keysFrom = (host) => {
      if (host && typeof host.addEventListener === 'function') host.addEventListener('keydown', onKey);
    };
    return { el: fig, video: v, canShow, showStill, keysFrom };
  }

  window.ClipPlayer = { create, release };
})();

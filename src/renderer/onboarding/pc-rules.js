'use strict';

/**
 * HOW THIS PC SHOULD WATCH (8.3.1): Record gameplay or Frames only, and at
 * what size, from what the PC check found (src/main/services/pc-check.js) and
 * what the GPU's encoder answered the onboarding page. Its own file, loaded by
 * the page before onboarding.js (the page's CSP is 'self'), so that
 * scripts/test-pc-check.js runs these very rules on every branch, not a copy.
 *
 * THE RULES, in order:
 *   1. No hardware encoder (the encoder said no to both of the recorder's
 *      asks), or under 8 GB free where the recordings go: Frames only, and
 *      Record cannot be chosen, because the recorder refuses to start then
 *      (recorder.js: the gate's 'no-hw-encoder', DISK_START_BYTES).
 *   2. A modest PC, under 8 GB of RAM or under 4 CPU threads: Frames only is
 *      recommended, and Record can still be chosen. A session the PC cannot
 *      keep up with stops recording by itself (recorder.js HEALTH).
 *   3. An encoder that never answered: Record at 720p, the recorder's own
 *      default, which turns itself off where the PC cannot afford it.
 *   4. Otherwise Record: at 1080p when the encoder takes 1080p, the display is
 *      at least 1920x1080, and there are 16 GB of RAM and 8 threads; at 720p
 *      when any of those falls short, and the line says which.
 *
 * A fact that could not be read decides nothing: no rule fires on it, and no
 * 1080p is recommended without it.
 */
(function (root) {
  const GB = 1024 * 1024 * 1024;
  // recorder.js DISK_START_BYTES: no recording starts with less free than
  // this. test:pccheck holds the two equal.
  const MIN_FREE_BYTES = 8 * GB;
  const MODEST = { ramGB: 8, threads: 4 };
  const FULL_HD = { ramGB: 16, threads: 8, width: 1920, height: 1080 };

  // WHAT A PC'S MEMORY IS SOLD AS. os.totalmem() is what Windows can use,
  // short of what is installed by what the hardware keeps for itself, an
  // integrated GPU's share above all: 31.8 GB on a 32 GB PC here, and a 16 GB
  // laptop that gives its graphics 2 GB reads under 14. Judged on the raw
  // number, every 8 and 16 GB PC fell short of its own size. So the reading
  // is taken up to the smallest size memory is sold in that holds it, which
  // is the "Installed RAM" Windows itself shows.
  const SOLD = [2, 3, 4, 6, 8, 12, 16, 20, 24, 32, 48, 64, 96, 128, 192, 256, 384, 512];
  function installedGB(bytes) {
    const gb = Number(bytes) / GB;
    if (!Number.isFinite(gb) || gb <= 0) return null;
    return SOLD.find((s) => s >= gb - 0.05) || Math.ceil(gb);
  }

  /** The encoder's answers, each true, false, or null for one never given. */
  function encoderOf(encoder) {
    const e = encoder || {};
    const at = (r) => (e[r] === true ? true : e[r] === false ? false : null);
    return { 720: at('720'), 1080: at('1080') };
  }

  /** 103 GB, 7.9 GB: rounded down, so a drive just short of 8 never reads as 8.0. */
  function gbText(bytes) {
    const gb = Number(bytes) / GB;
    if (!Number.isFinite(gb) || gb < 0) return null;
    return gb < 10 ? `${(Math.floor(gb * 10) / 10).toFixed(1)} GB` : `${Math.floor(gb)} GB`;
  }

  function factsOf(facts) {
    const f = facts || {};
    const d = f.display && f.display.width > 0 && f.display.height > 0
      ? { width: Math.round(f.display.width), height: Math.round(f.display.height) } : null;
    return {
      enc: encoderOf(f.encoder),
      ram: installedGB(f.ramBytes),
      threads: Number.isFinite(f.threads) && f.threads > 0 ? Math.round(f.threads) : null,
      free: Number.isFinite(f.freeBytes) && f.freeBytes >= 0 ? f.freeBytes : null,
      drive: typeof f.drive === 'string' && f.drive ? f.drive : null,
      display: d,
      gpu: typeof f.gpu === 'string' && f.gpu.trim() ? f.gpu.trim() : null,
    };
  }

  const KEEP_UP = 'You can still record: it stops by itself if the PC cannot keep up.';
  /** Why a size cannot be chosen: the encoder said no to it. */
  const REFUSED = (r) => `Its encoder does not take ${r}p.`;

  /**
   * The recommendation for one PC check:
   *   tier        'none' | 'disk' | 'modest' | 'unknown' | 'capable'
   *   mode, res   what to pre select: recordingMode 'auto' (Record) or 'off'
   *               (Frames only), recordingRes '720' or '1080', never a size
   *               the encoder refused while the other can be recorded
   *   recordable  whether Record can be chosen at all
   *   sizes       { 720, 1080 }: whether each size can be chosen
   *   refused     { 720, 1080 }: why a size cannot be, or null
   *   why, tone   the line the page shows, and 'good', 'warn' or '' for it
   */
  function recommend(facts) {
    const x = factsOf(facts);
    const { enc, ram, threads, free, display } = x;
    const sizes = { 720: enc[720] !== false, 1080: enc[1080] !== false };
    const refused = { 720: sizes[720] ? null : REFUSED('720'), 1080: sizes[1080] ? null : REFUSED('1080') };
    // The smaller size the encoder did not refuse, for a recommendation that
    // names no size of its own: 720p, the recorder's default, where it can.
    const small = sizes[720] || !sizes[1080] ? '720' : '1080';
    const out = (o) => Object.assign({ sizes, refused, ram, threads, free, display, encoder: enc }, o);

    if (enc[720] === false && enc[1080] === false) {
      return out({ tier: 'none', mode: 'off', res: '720', recordable: false, tone: 'warn',
        why: 'This PC has no hardware video encoder Occlara can record with.' });
    }
    if (free !== null && free < MIN_FREE_BYTES) {
      const on = x.drive || 'this drive';
      return out({ tier: 'disk', mode: 'off', res: '720', recordable: false, tone: 'warn',
        why: `Recording needs 8 GB free on ${on}, and it has ${gbText(free)}. Free some space, then turn it on in Settings.` });
    }
    const low = [];
    if (ram !== null && ram < MODEST.ramGB) low.push(`${ram} GB of RAM`);
    if (threads !== null && threads < MODEST.threads) low.push(`${threads} CPU thread${threads === 1 ? '' : 's'}`);
    if (low.length) {
      return out({ tier: 'modest', mode: 'off', res: small, recordable: true, tone: 'warn',
        why: `With ${low.join(' and ')}, recording could slow your game. ${KEEP_UP}` });
    }
    if (enc[720] !== true && enc[1080] !== true) {
      return out({ tier: 'unknown', mode: 'auto', res: small, recordable: true, tone: '',
        why: 'This PC could not be checked. If it cannot keep up while you play, recording stops for that session.' });
    }
    // The first thing 1080p is short of, in the order a player can see it.
    let short = null;
    if (enc[1080] === false) short = REFUSED('1080');
    else if (enc[1080] !== true) short = 'Its encoder did not answer for 1080p.';
    else if (!display || display.width < FULL_HD.width || display.height < FULL_HD.height) short = '1080p is for a display of 1920x1080 or more.';
    else if (ram === null || ram < FULL_HD.ramGB) short = `1080p is for ${FULL_HD.ramGB} GB of RAM or more.`;
    else if (threads === null || threads < FULL_HD.threads) short = `1080p is for ${FULL_HD.threads} CPU threads or more.`;
    // An encoder that takes 1080p and refused 720p can only record at 1080p.
    if (!short || enc[720] === false) {
      return out({ tier: 'capable', mode: 'auto', res: '1080', recordable: true, tone: 'good', short: null,
        why: 'This PC can record at 1080p.' });
    }
    return out({ tier: 'capable', mode: 'auto', res: '720', recordable: true, tone: 'good', short,
      why: `This PC can record at 720p. ${short}` });
  }

  /** The encoder's answer in words: the sizes it takes, none, or not checked. */
  function encoderText(encoder) {
    const e = encoderOf(encoder);
    if (e[720] === true && e[1080] === true) return '720p and 1080p';
    if (e[720] === true) return '720p';
    if (e[1080] === true) return '1080p';
    if (e[720] === false && e[1080] === false) return 'None found';
    return 'Not checked';
  }

  /**
   * What the check found, as the page lists it: { k, v } in reading order,
   * two to a row, the GPU's name on a row of its own (wide), since in half a
   * row even "NVIDIA GeForce RTX 5060" was cut.
   */
  function factRows(facts) {
    const x = factsOf(facts);
    const NA = 'Not known';
    return [
      { k: 'GPU', v: x.gpu || NA, wide: true },
      { k: 'Encoder', v: encoderText(facts && facts.encoder) },
      { k: 'CPU', v: x.threads ? `${x.threads} threads` : NA },
      { k: 'RAM', v: x.ram ? `${x.ram} GB` : NA },
      { k: 'Display', v: x.display ? `${x.display.width}x${x.display.height}` : NA },
      { k: 'Free', v: x.free !== null ? `${gbText(x.free)} on ${x.drive || 'this drive'}` : NA },
    ];
  }

  const api = { recommend, factRows, encoderText, installedGB, gbText, REFUSED, MIN_FREE_BYTES, MODEST, FULL_HD, SOLD };
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  else root.OcclaraPcRules = api;
}(typeof window !== 'undefined' ? window : globalThis));

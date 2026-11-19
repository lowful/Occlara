'use strict';

/**
 * THE TRAINER'S MATHS (docs/claude/trainer.md). Pure: no DOM, no Electron, no
 * three.js. Main, the tests and the Trainer page all run this one file: the
 * page loads it as a classic script (window.OcclaraTrainerMath), Node
 * requires it.
 *
 * Every number it works with comes from src/shared/trainer-data.json, where
 * each value carries its source and patch. Nothing here is a game number of
 * its own: a constant in this file is a unit conversion or a rule of the
 * trainer itself (the score, the settings' bounds, the store's caps).
 *
 * Units: metres, seconds, degrees. Valorant's engine works in centimetres;
 * the data file says which unit each value is in and `numbers()` turns the
 * file into plain numbers in these units.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.OcclaraTrainerMath = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const DEG = Math.PI / 180;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

  // ── The data file ────────────────────────────────────────────────────────

  /** A leaf of the data file ({ value, unit, source, patch, verified }) as its value; anything else walked. */
  function numbers(data) {
    const walk = (v) => {
      if (Array.isArray(v)) return v.map(walk);
      if (v && typeof v === 'object') {
        if (Object.prototype.hasOwnProperty.call(v, 'value') && Object.prototype.hasOwnProperty.call(v, 'source')) return walk(v.value);
        const o = {};
        for (const k of Object.keys(v)) if (k !== '_about') o[k] = walk(v[k]);
        return o;
      }
      return v;
    };
    return walk(data);
  }

  /** Every leaf of the data file still marked unverified, as dotted paths. */
  function unverified(data) {
    const out = [];
    const walk = (v, at) => {
      if (Array.isArray(v)) { v.forEach((x, i) => walk(x, `${at}[${i}]`)); return; }
      if (!v || typeof v !== 'object') return;
      if (Object.prototype.hasOwnProperty.call(v, 'value') && Object.prototype.hasOwnProperty.call(v, 'source')) {
        if (v.verified !== true) out.push(at);
        return;
      }
      for (const k of Object.keys(v)) if (k !== '_about') walk(v[k], at ? `${at}.${k}` : k);
    };
    walk(data, '');
    return out;
  }

  // ── Sensitivity and the view ─────────────────────────────────────────────

  /** Degrees the view turns for one mouse count: yaw per count times sens, times the scoped multiplier and zoom rule when scoped. */
  function degPerCount(n, sens, scope) {
    const base = n.sens.yawPerCount * sens;
    if (!scope || !(scope.zoom > 1)) return base;
    // Valorant scales scoped turning by the zoom, so a scoped swipe moves the
    // same distance across the screen as unscoped (data: sens.scopedRule),
    // then by the player's scoped multiplier.
    const mult = num(scope.multiplier, 1);
    if (n.sens.scopedRule === 'fov') {
      const hip = n.fov.horizontal * DEG / 2;
      const zoomed = 2 * Math.atan(Math.tan(hip) / scope.zoom);
      return base * (zoomed / (2 * hip)) * mult;
    }
    return (base / scope.zoom) * mult;
  }

  /** Centimetres of mouse travel for a full turn. */
  function cm360(n, dpi, sens) {
    if (!(dpi > 0) || !(sens > 0)) return null;
    return (360 / (n.sens.yawPerCount * sens)) / dpi * 2.54;
  }

  /**
   * The camera's vertical field of view in degrees for a viewport's aspect.
   * Valorant fixes 103 degrees across at 16:9 (70.53 up and down). A
   * narrower screen keeps the 70.53 and sees less across (data: fov.narrower).
   * A wider one is held at 103 across (data: fov.wider); the Trainer shows
   * less height there rather than black bars, the same degrees per pixel
   * across as the game.
   */
  function verticalFov(n, aspect) {
    const h = n.fov.horizontal * DEG;
    const a = Math.max(aspect, n.fov.aspect);
    return 2 * Math.atan(Math.tan(h / 2) / a) / DEG;
  }

  /** The horizontal field of view in degrees that verticalFov gives at this aspect. */
  function horizontalFov(n, aspect) {
    const v = verticalFov(n, aspect) * DEG;
    return 2 * Math.atan(Math.tan(v / 2) * aspect) / DEG;
  }

  /** The vertical field of view zoomed by `zoom` (a scope or aim down sights). */
  function zoomedFov(vfovDeg, zoom) {
    if (!(zoom > 1)) return vfovDeg;
    return 2 * Math.atan(Math.tan(vfovDeg * DEG / 2) / zoom) / DEG;
  }

  // ── Movement ─────────────────────────────────────────────────────────────

  /** The top ground speed in m/s for a weapon held, walking or crouched, and aimed down sights. */
  function topSpeed(n, weapon, mode, ads) {
    let run = weapon && weapon.runSpeed ? weapon.runSpeed : n.move.knifeSpeed;
    if (ads && weapon && weapon.adsMoveMult) run *= weapon.adsMoveMult;
    if (mode === 'crouch') return run * n.move.crouchMult;
    if (mode === 'walk') return run * n.move.walkMult;
    return run;
  }

  /**
   * One step of ground velocity. `v` is { x, z } in m/s, changed in place;
   * `wish` is { x, z }, a unit vector or zero; `top` the top speed now.
   *
   * As measured (data: move): with input the speed rises in a straight line
   * and reaches the top in accelTime whatever the top is (so the rate is
   * top / accelTime); with none it brakes as dv/dt = -(brakingDecel +
   * friction * speed). Pressing against the motion brakes at that same rate
   * and no faster (move.counterStrafe: measured as no quicker than letting
   * go), and only then accelerates the other way. The part of the motion
   * across the wished line is braked the same way, so a turn is not a skate.
   */
  function stepGround(v, wish, top, m, dt) {
    const wl = Math.hypot(wish.x, wish.z);
    const speed = Math.hypot(v.x, v.z);
    const brake = (s) => (m.brakingDecel + m.friction * s) * dt;
    if (wl < 1e-6) {
      if (speed < 1e-9) { v.x = 0; v.z = 0; return v; }
      const next = speed - brake(speed);
      if (next <= m.stopSpeed) { v.x = 0; v.z = 0; return v; }
      const k = next / speed;
      v.x *= k; v.z *= k;
      return v;
    }
    const dx = wish.x / wl, dz = wish.z / wl;
    let along = v.x * dx + v.z * dz;
    let sx = v.x - dx * along, sz = v.z - dz * along;   // across the wished line
    const side = Math.hypot(sx, sz);
    if (side > 1e-9) {
      const next = side - brake(side);
      const k = next <= m.stopSpeed ? 0 : next / side;
      sx *= k; sz *= k;
    }
    const accel = top / m.accelTime;
    if (along < 0) {
      along += brake(-along);
      if (along > -m.stopSpeed) along = 0;
    } else if (along > top) {
      // Over the top (walk pressed while running): braked down to it.
      along = Math.max(top, along - brake(along));
    } else {
      along = Math.min(top, along + accel * dt);
    }
    v.x = dx * along + sx;
    v.z = dz * along + sz;
    return v;
  }

  /** Air: a little steering, no braking (data: move.airControl). */
  function stepAir(v, wish, top, m, dt) {
    const wl = Math.hypot(wish.x, wish.z);
    if (wl < 1e-6) return v;
    const before = Math.hypot(v.x, v.z);
    const a = (top / m.accelTime) * m.airControl * dt;
    v.x += (wish.x / wl) * a;
    v.z += (wish.z / wl) * a;
    const s = Math.hypot(v.x, v.z);
    const cap = Math.max(top, before);
    if (s > cap && s > 1e-9) { const k = cap / s; v.x *= k; v.z *= k; }
    return v;
  }

  /** Seconds from standing to `frac` of the top speed, simulated at the tick rate. */
  function timeToSpeed(n, top, frac) {
    const v = { x: 0, z: 0 };
    const dt = 1 / n.tick;
    for (let i = 0, t = 0; i < 5 * n.tick; i++, t += dt) {
      if (Math.hypot(v.x, v.z) >= top * frac - 1e-9) return t;
      stepGround(v, { x: 1, z: 0 }, top, n.move, dt);
    }
    return null;
  }

  /** Seconds from the top speed down to `under` m/s (default the accuracy gate), letting go or counter-strafing. */
  function timeToStop(n, top, counter, under) {
    const v = { x: top, z: 0 };
    const dt = 1 / n.tick;
    const gate = under == null ? top * n.move.accurateFrac : under;
    for (let i = 0, t = 0; i < 5 * n.tick; i++, t += dt) {
      if (Math.hypot(v.x, v.z) <= gate + 1e-9) return t;
      stepGround(v, counter ? { x: -1, z: 0 } : { x: 0, z: 0 }, top, n.move, dt);
    }
    return null;
  }

  /** Whether a shot at this speed is accurate: at or under the gate's share of the top speed of how the player moves now. */
  function accurate(n, speed, weapon, mode, ads) {
    return speed <= topSpeed(n, weapon, mode || 'run', ads) * n.move.accurateFrac + 1e-9;
  }

  /** Metres per second of upward speed a jump starts with. */
  function jumpSpeed(n) {
    return n.move.jumpSpeed;
  }

  /** Metres a jump rises on flat ground. */
  function jumpHeight(n) {
    return (n.move.jumpSpeed * n.move.jumpSpeed) / (2 * n.move.gravity);
  }

  // ── Weapons ──────────────────────────────────────────────────────────────

  /**
   * The spread cone's half angle in degrees for one shot.
   * @param w        the weapon's numbers
   * @param s.shot   the shot's place in the spray (1 the first)
   * @param s.ads    aimed down sights
   * @param s.speed  ground speed m/s; s.air in the air; s.crouch crouched;
   *                 s.walk walk held; s.landing seconds since landing
   *
   * The cone: the first shot's (aimed or not), growing by `growth` a bullet
   * of the spray up to the maximum, smaller crouched. Moving over the gate
   * (27.5% of the top speed of how the player moves now) adds the weapon's
   * moving error, scaled from the gate up to that top speed: crouched to the
   * crouch-walking error, walking to the walking error, running through the
   * walking error at walk speed to the running error at full speed. In the
   * air the airborne error; just landed, the landing error.
   */
  function spread(n, w, s) {
    const sp = w.spread;
    let base = s.ads && sp.adsFirst != null ? sp.adsFirst : sp.first;
    const k = Math.max(0, (s.shot || 1) - 1);
    base = Math.min(Math.max(sp.max, base), base + sp.growth * k);
    if (s.crouch && !s.air) base *= sp.crouchMult;
    if (s.air) return base + sp.air;
    if (s.landing != null && s.landing < n.move.landingSec) return base + n.move.landingSpread;
    const speed = s.speed || 0;
    const mode = s.crouch ? 'crouch' : s.walk ? 'walk' : 'run';
    if (accurate(n, speed, w, mode, s.ads)) return base;
    const run = topSpeed(n, w, 'run', s.ads);
    const gateOf = (top) => top * n.move.accurateFrac;
    let add;
    if (mode === 'crouch') {
      const top = topSpeed(n, w, 'crouch', s.ads);
      add = sp.crouchMove * clamp((speed - gateOf(top)) / Math.max(1e-6, top - gateOf(top)), 0, 1);
    } else {
      const walk = topSpeed(n, w, 'walk', s.ads);
      const g = gateOf(mode === 'walk' ? walk : run);
      add = speed <= walk
        ? sp.walk * clamp((speed - g) / Math.max(1e-6, walk - g), 0, 1)
        : sp.walk + (sp.run - sp.walk) * clamp((speed - walk) / Math.max(1e-6, run - walk), 0, 1);
    }
    return base + add;
  }

  /** The shot's place in the spray after `idleSec` without firing: the spray resets over the weapon's recovery time. */
  function sprayAfter(w, shot, idleSec) {
    // Holding the trigger is no rest: nothing comes back within one fire
    // interval. From there it falls away to nothing at the recovery time.
    const held = 1.05 / w.fireRate;
    if (idleSec <= held) return shot;
    if (idleSec >= w.recoil.recoverSec) return 0;
    return Math.max(0, Math.round(shot * (1 - (idleSec - held) / Math.max(1e-6, w.recoil.recoverSec - held))));
  }

  /**
   * The recoil offset in degrees ({ pitch up, yaw }) the next bullet leaves
   * with, for the `shot`-th bullet of a spray. Vertical climbs by the
   * pattern; past `horizStart` it sways side to side by `rand` in [-1, 1].
   */
  function recoilKick(w, shot, rand) {
    const r = w.recoil;
    const i = Math.max(0, shot - 1);
    const up = i < r.vertical.length ? r.vertical[i] : r.vertical[r.vertical.length - 1] * r.tailMult;
    const side = shot > r.horizStart ? r.horiz * rand : 0;
    return { up, side };
  }

  /** Damage of one bullet: by zone and range band, before armour. */
  function rawDamage(w, zone, dist) {
    const bands = w.damage;
    let b = bands[bands.length - 1];
    for (const x of bands) { if (dist <= x.to) { b = x; break; } }
    return zone === 'head' ? b.head : zone === 'leg' ? b.leg : b.body;
  }

  /** Damage dealt into { hp, armour }: armour takes its share of each hit until it is gone. Mutates the target. */
  function applyDamage(n, t, dmg) {
    let toArmour = 0;
    if (t.armour > 0) toArmour = Math.min(t.armour, dmg * n.armour.absorb);
    t.armour -= toArmour;
    const toHp = dmg - toArmour;
    t.hp = Math.max(0, t.hp - toHp);
    return toHp;
  }

  /** Bullets needed to kill a target of `hp` and `armour` hitting `zone` at `dist`. */
  function shotsToKill(n, w, zone, dist, hp, armour) {
    const t = { hp: hp == null ? n.player.hp : hp, armour: armour || 0 };
    const d = rawDamage(w, zone, dist);
    for (let i = 1; i <= 100; i++) { applyDamage(n, t, d); if (t.hp <= 0) return i; }
    return null;
  }

  // ── The settings (one config key, trainerSettings) ───────────────────────

  // The weapon profiles a slot can hold (trainer-data.json weapons).
  const PRIMARIES = ['heavy-rifle', 'silenced-rifle'];
  const SECONDARIES = ['heavy-pistol', 'sidearm'];
  // The colour of the outline round a bot (bots.js OUTLINES).
  const ENEMY_COLOURS = ['yellow', 'red', 'purple', 'cyan'];
  const BIND_ACTIONS = ['forward', 'back', 'left', 'right', 'walk', 'crouch', 'jump', 'reload', 'primary', 'secondary', 'knife'];
  const DEFAULT_BINDS = Object.freeze({
    forward: 'KeyW', back: 'KeyS', left: 'KeyA', right: 'KeyD',
    walk: 'ShiftLeft', crouch: 'ControlLeft', jump: 'Space', reload: 'KeyR',
    primary: 'Digit1', secondary: 'Digit2', knife: 'Digit3',
  });
  const DEFAULT_CROSSHAIR = Object.freeze({
    color: '#00FF00', outline: true, outlineOpacity: 0.5, outlineThickness: 1,
    dot: false, dotOpacity: 1, dotThickness: 2,
    inner: true, innerOpacity: 0.8, innerLength: 6, innerThickness: 2, innerOffset: 3,
    outer: false, outerOpacity: 0.35, outerLength: 2, outerThickness: 2, outerOffset: 10,
    firingError: false,
  });
  const DEFAULT_SETTINGS = Object.freeze({
    v: 1,
    sens: 0.4, dpi: 800, scoped: 1,
    graphics: 'high', fps: false, volume: 0.7,
    primary: 'heavy-rifle', secondary: 'heavy-pistol', enemy: 'yellow',
    binds: DEFAULT_BINDS,
    crosshair: DEFAULT_CROSSHAIR,
  });
  const CODE_RE = /^(Key[A-Z]|Digit[0-9]|Numpad[0-9]|F([1-9]|1[0-2])|Space|Tab|CapsLock|Shift(Left|Right)|Control(Left|Right)|Alt(Left|Right)|Mouse[45]|Backquote|Minus|Equal|BracketLeft|BracketRight|Backslash|Semicolon|Quote|Comma|Period|Slash)$/;
  const HEX_RE = /^#[0-9A-F]{6}$/;
  /** Whether a key or mouse button code may be bound. */
  const validKey = (code) => typeof code === 'string' && CODE_RE.test(code);

  const round = (v, p) => Math.round(v * 10 ** p) / 10 ** p;
  const inRange = (v, a, b, p, d) => (typeof v === 'number' && Number.isFinite(v) ? round(clamp(v, a, b), p) : d);

  function normaliseCrosshair(c) {
    const d = DEFAULT_CROSSHAIR;
    const x = c && typeof c === 'object' ? c : {};
    const b = (v, def) => (typeof v === 'boolean' ? v : def);
    return {
      color: typeof x.color === 'string' && HEX_RE.test(x.color.toUpperCase()) ? x.color.toUpperCase() : d.color,
      outline: b(x.outline, d.outline),
      outlineOpacity: inRange(x.outlineOpacity, 0, 1, 2, d.outlineOpacity),
      outlineThickness: inRange(x.outlineThickness, 1, 6, 0, d.outlineThickness),
      dot: b(x.dot, d.dot),
      dotOpacity: inRange(x.dotOpacity, 0, 1, 2, d.dotOpacity),
      dotThickness: inRange(x.dotThickness, 1, 6, 0, d.dotThickness),
      inner: b(x.inner, d.inner),
      innerOpacity: inRange(x.innerOpacity, 0, 1, 2, d.innerOpacity),
      innerLength: inRange(x.innerLength, 0, 20, 0, d.innerLength),
      innerThickness: inRange(x.innerThickness, 0, 10, 0, d.innerThickness),
      innerOffset: inRange(x.innerOffset, 0, 20, 0, d.innerOffset),
      outer: b(x.outer, d.outer),
      outerOpacity: inRange(x.outerOpacity, 0, 1, 2, d.outerOpacity),
      outerLength: inRange(x.outerLength, 0, 10, 0, d.outerLength),
      outerThickness: inRange(x.outerThickness, 0, 10, 0, d.outerThickness),
      outerOffset: inRange(x.outerOffset, 0, 40, 0, d.outerOffset),
      firingError: b(x.firingError, d.firingError),
    };
  }

  /** A settings value made whole and in bounds: anything missing or wrong takes its default. */
  function normaliseSettings(v) {
    const d = DEFAULT_SETTINGS;
    const x = v && typeof v === 'object' && !Array.isArray(v) ? v : {};
    const binds = {};
    const given = x.binds && typeof x.binds === 'object' ? x.binds : {};
    for (const a of BIND_ACTIONS) binds[a] = typeof given[a] === 'string' && CODE_RE.test(given[a]) ? given[a] : DEFAULT_BINDS[a];
    // Two actions on one key: the page never saves that (it swaps the two),
    // so a stored value that has it is not the page's, and every bind goes
    // back to its default.
    if (new Set(Object.values(binds)).size !== BIND_ACTIONS.length) Object.assign(binds, DEFAULT_BINDS);
    return {
      v: 1,
      sens: inRange(x.sens, 0.01, 10, 3, d.sens),
      dpi: Number.isInteger(x.dpi) && x.dpi >= 100 && x.dpi <= 32000 ? x.dpi : d.dpi,
      scoped: inRange(x.scoped, 0.01, 5, 3, d.scoped),
      graphics: x.graphics === 'low' || x.graphics === 'high' ? x.graphics : d.graphics,
      fps: typeof x.fps === 'boolean' ? x.fps : d.fps,
      volume: inRange(x.volume, 0, 1, 2, d.volume),
      primary: PRIMARIES.includes(x.primary) ? x.primary : d.primary,
      secondary: SECONDARIES.includes(x.secondary) ? x.secondary : d.secondary,
      enemy: ENEMY_COLOURS.includes(x.enemy) ? x.enemy : d.enemy,
      binds,
      crosshair: normaliseCrosshair(x.crosshair),
    };
  }

  /** Whether `v` is already exactly what normaliseSettings makes of it: the config rule. */
  function validSettings(v) {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
    try {
      const n = normaliseSettings(v);
      const binds = Object.values(n.binds);
      if (new Set(binds).size !== binds.length) return false;
      // The same own keys at every level: an extra one (an own __proto__
      // among them, which a plain copy would swallow) is not the page's.
      if (!sameKeys(v, n) || !sameKeys(v.binds, n.binds) || !sameKeys(v.crosshair, n.crosshair)) return false;
      return JSON.stringify(sortKeys(n)) === JSON.stringify(sortKeys(v));
    } catch { return false; }
  }
  function sameKeys(a, b) {
    if (!a || typeof a !== 'object' || Array.isArray(a)) return false;
    const ka = Object.getOwnPropertyNames(a).sort(), kb = Object.keys(b).sort();
    return ka.length === kb.length && ka.every((k, i) => k === kb[i]);
  }
  function sortKeys(o) {
    if (Array.isArray(o)) return o.map(sortKeys);
    if (!o || typeof o !== 'object') return o;
    const out = {};
    for (const k of Object.keys(o).sort()) out[k] = sortKeys(o[k]);
    return out;
  }

  /**
   * A crosshair profile code as Valorant's settings export it ("0;P;c;5;h;0;
   * 0l;4;..."), read into the trainer's crosshair: the primary profile's
   * colour, outline, dot, inner and outer lines. Unknown fields are skipped.
   * Returns null when no field of it could be read.
   */
  const CODE_COLORS = ['#FFFFFF', '#00FF00', '#7FFF00', '#DFFF00', '#FFFF00', '#00FFFF', '#FF00FF', '#FF0000'];
  function parseCrosshairCode(code) {
    if (typeof code !== 'string' || code.length > 600) return null;
    const bits = code.trim().split(';');
    if (bits.length < 3 || bits[0] !== '0') return null;
    const c = { ...DEFAULT_CROSSHAIR };
    // Valorant's defaults where a code leaves a field out.
    Object.assign(c, { color: '#FFFFFF', outline: true, outlineOpacity: 0.5, outlineThickness: 1, dot: false, dotOpacity: 1, dotThickness: 2,
      inner: true, innerOpacity: 0.8, innerLength: 6, innerThickness: 2, innerOffset: 3,
      outer: true, outerOpacity: 0.35, outerLength: 2, outerThickness: 2, outerOffset: 10, firingError: true });
    let section = 'P';
    let read = 0;
    for (let i = 1; i + 1 < bits.length || (i < bits.length && /^[PAS]$/.test(bits[i])); ) {
      const k = bits[i];
      if (k === 'P' || k === 'A' || k === 'S') { section = k; i += 1; continue; }
      const v = bits[i + 1];
      i += 2;
      if (section !== 'P') continue;
      const f = Number(v);
      const set = (name, val) => { c[name] = val; read++; };
      switch (k) {
        case 'c': if (Number.isInteger(f) && f >= 0 && f < CODE_COLORS.length) set('color', CODE_COLORS[f]); break;
        case 'u': if (/^[0-9A-Fa-f]{8}$/.test(v)) set('color', `#${v.slice(0, 6).toUpperCase()}`); break;
        case 'h': set('outline', f === 1); break;
        case 't': if (f >= 1 && f <= 6) set('outlineThickness', Math.round(f)); break;
        case 'o': if (f >= 0 && f <= 1) set('outlineOpacity', f); break;
        case 'd': set('dot', f === 1); break;
        case 'z': if (f >= 1 && f <= 6) set('dotThickness', Math.round(f)); break;
        case 'a': if (f >= 0 && f <= 1) set('dotOpacity', f); break;
        case 'f': set('firingError', f === 1); break;
        case '0b': set('inner', f !== 0); break;
        case '0t': if (f >= 0 && f <= 10) set('innerThickness', Math.round(f)); break;
        case '0l': if (f >= 0 && f <= 20) set('innerLength', Math.round(f)); break;
        case '0o': if (f >= 0 && f <= 20) set('innerOffset', Math.round(f)); break;
        case '0a': if (f >= 0 && f <= 1) set('innerOpacity', f); break;
        case '1b': set('outer', f !== 0); break;
        case '1t': if (f >= 0 && f <= 10) set('outerThickness', Math.round(f)); break;
        case '1l': if (f >= 0 && f <= 10) set('outerLength', Math.round(f)); break;
        case '1o': if (f >= 0 && f <= 40) set('outerOffset', Math.round(f)); break;
        case '1a': if (f >= 0 && f <= 1) set('outerOpacity', f); break;
        default: break;
      }
    }
    if (!read) return null;
    return normaliseCrosshair(c);
  }

  // ── A run, its score and the store ───────────────────────────────────────

  /**
   * The report of one run from what the page counted.
   * @param r.shots, r.hits, r.heads, r.kills, r.bots, r.firstShots,
   *        r.firstHits, r.ttk [ms], r.reactions [ms], r.stops [ms],
   *        r.damageTaken, r.died, r.seconds, r.limit (seconds or 0)
   */
  function report(r) {
    const mean = (a) => (a && a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
    const pct = (a, b) => (b > 0 ? Math.round((a / b) * 1000) / 10 : null);
    const shots = r.shots | 0;
    const hits = Math.min(r.hits | 0, shots);
    const accuracy = pct(hits, shots);
    const out = {
      kills: r.kills | 0,
      bots: r.bots | 0,
      shots, hits,
      accuracy,
      headshots: pct(Math.min(r.heads | 0, hits), hits),
      firstShot: pct(r.firstHits | 0, r.firstShots | 0),
      ttk: mean(r.ttk) == null ? null : Math.round(mean(r.ttk)),
      reaction: mean(r.reactions) == null ? null : Math.round(mean(r.reactions)),
      stop: mean(r.stops) == null ? null : Math.round(mean(r.stops)),
      damageTaken: r.damageTaken | 0,
      died: !!r.died,
      seconds: Math.round((r.seconds || 0) * 10) / 10,
    };
    out.score = score(r, out);
    return out;
  }

  /**
   * One kill's points before the accuracy factor: 100, 50 more for a head
   * kill, up to 100 more for its speed (a kill in 300 ms or less earns it
   * all, 1500 ms or more none).
   */
  function killPoints(ttkMs, head) {
    let pts = 100 + (head ? 50 : 0);
    if (typeof ttkMs === 'number') pts += Math.round(100 * clamp((1500 - ttkMs) / 1200, 0, 1));
    return pts;
  }

  /**
   * The score: every kill's points (killPoints), times the accuracy factor
   * (half the score always, the other half by accuracy), less 2 a point of
   * damage taken. Clearing every bot inside a time limit without dying adds
   * 10 a second left. Never below zero.
   */
  function score(r, rep) {
    const ttk = Array.isArray(r.ttk) ? r.ttk : [];
    let pts = 0;
    for (let i = 0; i < (r.kills | 0); i++) pts += killPoints(ttk[i], Array.isArray(r.headKills) ? r.headKills[i] : false);
    const acc = rep.accuracy == null ? 0 : rep.accuracy / 100;
    pts *= 0.5 + 0.5 * acc;
    pts -= 2 * (r.damageTaken | 0);
    if (r.limit > 0 && (r.kills | 0) >= (r.bots | 0) && (r.bots | 0) > 0 && !r.died) pts += 10 * Math.max(0, Math.floor(r.limit - (r.seconds || 0)));
    return Math.max(0, Math.round(pts));
  }

  const SCHEMA = 1;
  const RUNS_MAX = 500;
  const ID_RE = /^[a-z0-9-]{1,48}$/;

  function emptyState() { return { schema: SCHEMA, runs: [] }; }

  function cleanRun(x) {
    if (!x || typeof x !== 'object') return null;
    if (typeof x.scenario !== 'string' || !ID_RE.test(x.scenario)) return null;
    const at = Number.isFinite(x.at) ? Math.round(x.at) : null;
    if (at == null || at <= 0) return null;
    const n0 = (v) => (Number.isFinite(v) ? v : null);
    const int = (v, max) => (Number.isInteger(v) && v >= 0 && v <= max ? v : 0);
    return {
      scenario: x.scenario,
      at,
      score: int(x.score, 10000000),
      kills: int(x.kills, 10000),
      bots: int(x.bots, 10000),
      shots: int(x.shots, 100000),
      hits: int(x.hits, 100000),
      accuracy: n0(x.accuracy),
      headshots: n0(x.headshots),
      firstShot: n0(x.firstShot),
      ttk: n0(x.ttk),
      reaction: n0(x.reaction),
      stop: n0(x.stop),
      damageTaken: int(x.damageTaken, 100000),
      died: x.died === true,
      seconds: Number.isFinite(x.seconds) && x.seconds >= 0 && x.seconds < 86400 ? x.seconds : 0,
      weapon: typeof x.weapon === 'string' && ID_RE.test(x.weapon) ? x.weapon : null,
      sens: Number.isFinite(x.sens) && x.sens > 0 && x.sens <= 10 ? x.sens : null,
    };
  }

  /** The store's `trainer` value made whole: a missing or malformed one is nothing saved, never a throw. */
  function normaliseState(v) {
    if (!v || typeof v !== 'object' || v.schema !== SCHEMA || !Array.isArray(v.runs)) return emptyState();
    const runs = v.runs.map(cleanRun).filter(Boolean).sort((a, b) => a.at - b.at);
    return { schema: SCHEMA, runs: runs.slice(-RUNS_MAX) };
  }

  /** The state with one more run, the oldest dropped past RUNS_MAX; null for a run that is not one. */
  function addRun(state, run) {
    const r = cleanRun(run);
    if (!r) return null;
    const s = normaliseState(state);
    s.runs.push(r);
    if (s.runs.length > RUNS_MAX) s.runs = s.runs.slice(-RUNS_MAX);
    return s;
  }

  /** For one scenario: its best, how many runs, and the last `n` scores oldest first for the chart. */
  function historyOf(state, scenario, n) {
    const s = normaliseState(state);
    const runs = s.runs.filter((r) => r.scenario === scenario);
    let best = null;
    for (const r of runs) if (!best || r.score > best.score) best = r;
    return { plays: runs.length, best, last: runs.slice(-(n || 20)) };
  }

  return {
    DEG, numbers, unverified,
    degPerCount, cm360, verticalFov, zoomedFov,
    topSpeed, stepGround, stepAir, timeToSpeed, timeToStop, accurate, jumpSpeed, jumpHeight, horizontalFov,
    spread, sprayAfter, recoilKick, rawDamage, applyDamage, shotsToKill,
    PRIMARIES, SECONDARIES, ENEMY_COLOURS, validKey, BIND_ACTIONS, DEFAULT_BINDS, DEFAULT_CROSSHAIR, DEFAULT_SETTINGS, normaliseSettings, validSettings, normaliseCrosshair, parseCrosshairCode,
    report, score, killPoints, SCHEMA, RUNS_MAX, emptyState, normaliseState, addRun, historyOf, cleanRun,
  };
});

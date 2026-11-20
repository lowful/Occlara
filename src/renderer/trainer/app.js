// THE TRAINER PAGE (docs/claude/trainer.md): the rail (scenarios, settings),
// the chosen scenario's panel, a run from its countdown to its report, and
// the HUD. The simulation is engine.js; the rules of each scenario are
// scenarios.js; every number is trainer-data.json through trainer-math.js.
//
// A RUN IS PLAYED ONLY WHILE THIS PAGE IS IN FRONT. The pointer is locked on
// a click or a key (Chromium needs one), with raw input asked for. Losing the
// lock (Esc), the page being told to leave, hidden, or the window losing
// focus all pause the run and stop the loop. Main is told whenever the lock
// comes or goes, so it lets go of its Ctrl+Shift keys only while the Trainer
// has the mouse (hotkeys.js suspend). In the menu nothing runs: the stage
// shows one still frame.
import { createEngine } from './engine.js';
import { createAudio } from './audio.js';
import { controllerFor, EXTRA } from './scenarios.js';
import { arenaPlan } from './world.js';

const M = window.OcclaraTrainerMath;
const bridge = window.occlara;
const $ = (id) => document.getElementById(id);
const root = $('tr');
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const fmt = (n) => Math.round(n).toLocaleString('en-US');

const fail = (text) => { const e = $('tr-error'); e.textContent = text; e.hidden = false; };

let N, SCENARIOS, RAW;
try {
  const d = bridge.data();
  RAW = d.numbers;
  N = M.numbers(d.numbers);
  SCENARIOS = d.scenarios;
} catch (e) {
  fail('The Trainer could not read its numbers.');
  throw e;
}
// The player's deaths that can be fought again (main's list, trainer-replay.js).
let replays = [];
let fresh = [];
let allDeaths = false;
const REPLAY = 'replay:';
/** One of those deaths as a scenario: every replay saves under the one id `replay`. */
function replayScenario(id) {
  const r = replays.find((x) => REPLAY + x.id === id);
  if (!r) return null;
  const n = Math.max(1, Math.min(3, (r.spec && r.spec.enemies) || 1));
  return { id: 'replay', pick: id, title: [r.title, r.map].filter(Boolean).join(', '), arena: 'duel', kind: 'replay', level: null, limit: 0, bots: N.replay.fights * n, botShoot: true, about: r.line, spec: r.spec, causes: [] };
}
const byId = (id) => (typeof id === 'string' && id.startsWith(REPLAY) ? replayScenario(id) : SCENARIOS.find((s) => s.id === id) || null);
// The rows: a scenario, or an Easy and Hard pair of one.
const ENTRIES = [];
for (const sc of SCENARIOS) {
  const key = `${sc.arena}:${sc.kind}`;
  let e = ENTRIES.find((x) => x.key === key);
  if (!e) { e = { key, arena: sc.arena, kind: sc.kind, title: sc.title, list: [] }; ENTRIES.push(e); }
  e.list.push(sc);
}
const entryOf = (id) => (typeof id === 'string' && id.startsWith(REPLAY) ? { key: id, arena: 'duel', kind: 'replay', title: '', list: [byId(id)].filter(Boolean), pick: id } : ENTRIES.find((e) => e.list.some((s) => s.id === id)));
/** What the player has chosen, as the row and the panel know it: a scenario's id, or a replay's. */
const pickOf = (sc) => sc.pick || sc.id;

let settings = M.normaliseSettings(null);
let soundsOn = true;
let runs = [];
let selected = SCENARIOS.find((s) => s.kind === 'flick') ? 'flick-grid' : SCENARIOS[0].id;
let asked = null;        // the scenario Practice asked for
let current = null;      // the scenario of the run on screen
let ctl = null;          // its controller
let run = null;          // its counters
let phase = 'menu';      // menu | countdown | playing | paused | report
let tabNow = 'play';
let rawInput = true;
let countTimer = null;
let reportAt = 0;
let starting = false;

function setPhase(p) {
  phase = p;
  root.dataset.state = p;
  $('hud').hidden = !(p === 'playing' || p === 'countdown');
  $('pause').hidden = p !== 'paused';
  $('report').hidden = p !== 'report';
}

// ── The engine ──────────────────────────────────────────────────────────────
const audio = createAudio();
audio.load();
let eng;
try {
  eng = createEngine({
    canvas: $('view'), N, audio,
    hooks: {
      shot: onShot, killed: onKilled, stopped: onStopped, hurt: onHurt, died: onDied, tick: onTick, frame: onFrame,
      allowHit: (res) => (ctl && ctl.allowHit ? ctl.allowHit(res) : true),
      turned: (deg) => { if (ctl && ctl.turn) ctl.turn(deg); },
    },
  });
} catch (e) {
  fail('This PC could not start the 3D view.');
  throw e;
}
/** What a scenario's controller sees of the engine. */
const view = { N, bots: eng.bots, respawn: () => eng.respawn(), get P() { return eng.P; }, get arena() { return eng.arena; }, get guns() { return eng.guns; }, get now() { return eng.now; } };

const newRun = () => ({ shots: 0, hits: 0, heads: 0, kills: 0, bots: 0, firstShots: 0, firstHits: 0, ttk: [], headKills: [], reactions: [], stops: [], damageTaken: 0, died: false, seconds: 0, limit: 0, early: 0, missed: 0, start: 0 });

function onShot(res) {
  if (!run || phase !== 'playing') return;
  if (ctl && ctl.shot) ctl.shot(res);
  run.shots++;
  if (res.first) run.firstShots++;
  if (!res.accurate) run.early++;
  if (res.hit && res.counted) {
    run.hits++;
    if (res.zone === 'head') run.heads++;
    if (res.first) run.firstHits++;
    if (!res.kill) mark(res.zone === 'head' ? 'head' : '');
  }
}
function onKilled(b, zone, res) {
  if (!run) return;
  const seen = b.seenAt >= 0 ? b.seenAt : b.spawnedAt;
  const ttk = Math.max(0, Math.round((eng.now - seen) * 1000));
  run.kills++;
  run.headKills.push(zone === 'head');
  run.ttk.push(ttk);
  if (b.firstHitAt >= 0) run.reactions.push(Math.max(0, Math.round((b.firstHitAt - seen) * 1000)));
  mark('kill');
  pop(`+${M.killPoints(ttk, zone === 'head')}`, zone === 'head');
  if (ctl && ctl.killed) ctl.killed(b, zone, res, eng.now);
}
function onStopped(ms) { if (run && phase === 'playing') run.stops.push(Math.round(ms)); }
let hurtTimer = null;
function onHurt(pan) {
  const h = $('h-hurt');
  h.className = `tr-hurt on${pan > 0.3 ? ' right' : pan < -0.3 ? ' left' : ''}`;
  clearTimeout(hurtTimer);
  hurtTimer = setTimeout(() => h.classList.remove('on'), 70);
}
function onDied() {
  if (!run) return;
  // A scenario of several fights stands the player up again; any other ends here.
  if (ctl && ctl.died) ctl.died(eng.now);
  else { run.died = true; finish(); }
}

function onTick(now) {
  if (!run) return;
  // When each bot is first on screen and in the open: what reaction and time
  // to kill count from.
  for (const b of eng.bots.list) {
    if (!b.alive || b.seenAt >= 0) continue;
    const hy = b.y + N.hitbox.head.center * eng.bots.scaleY(b);
    if (eng.inView(b.x, hy, b.z) && eng.canSee(b.x, hy, b.z)) b.seenAt = now;
  }
  if (current.kind !== 'replay') run.damageTaken = Math.round(run.start - eng.P.hp - eng.P.armour);
  if (ctl && ctl.tick) ctl.tick(now);
  run.seconds = now;
  if ((ctl && ctl.done) || (run.limit > 0 && now >= run.limit)) finish();
}

// ── The HUD ─────────────────────────────────────────────────────────────────
function retrigger(node, cls) {
  node.className = cls;
  void node.offsetWidth;      // so the same animation plays again
  node.classList.add('on');
}
const mark = (kind) => retrigger($('h-mark'), `tr-mark ${kind}`);
function pop(text, head) { const p = $('h-pop'); p.textContent = text; retrigger(p, `tr-pop${head ? ' head' : ''}`); }

let hudAcc = 1, fpsAcc = 0, fpsN = 0, lastRecoil = -1, lastErr = -1, lastReload = -2, lastGate = null;
function onFrame(dt) {
  fpsAcc += dt; fpsN++;
  const g = eng.guns;
  // The crosshair rises with the recoil the spray has built.
  const rp = Math.round(eng.recoilPx() * 2) / 2;
  if (rp !== lastRecoil) { lastRecoil = rp; $('xhair').style.transform = `translateY(${-rp}px)`; $('h-mark').style.transform = `translateY(${-rp}px)`; }
  if (settings.crosshair.firingError) {
    const w = g.weapon();
    const cone = w ? M.spread(N, w, { shot: Math.max(1, M.sprayAfter(w, g.st.shot, eng.now - g.st.lastShot) + 1), ads: eng.move.ads, speed: eng.move.speed, air: eng.move.air, crouch: eng.move.crouch, walk: eng.move.walk, landing: eng.move.landing }) - w.spread.first : 0;
    const px = Math.max(0, Math.min(40, Math.round(eng.conePx(cone))));
    if (px !== lastErr) { lastErr = px; drawCrosshair($('xhair'), settings.crosshair, px); }
  }
  const rl = g.reloadProgress(eng.now);
  if (rl !== lastReload) { lastReload = rl; $('h-reload').style.transform = `scaleX(${rl < 0 ? 0 : rl.toFixed(3)})`; }
  if (current.kind === 'strafe') {
    const ok = !eng.move.air && M.accurate(N, eng.move.speed, g.weapon(), eng.move.crouch ? 'crouch' : eng.move.walk ? 'walk' : 'run', eng.move.ads);
    if (ok !== lastGate) { lastGate = ok; $('h-gate').classList.toggle('on', ok); $('h-gate-t').textContent = ok ? 'Accurate' : 'Moving'; }
  }
  hudAcc += dt;
  if (hudAcc < 0.08) return;
  hudAcc = 0;
  paintHud();
  if (settings.fps && fpsAcc > 0.4) { $('h-fps').textContent = `${Math.round(fpsN / fpsAcc)} fps`; fpsAcc = 0; fpsN = 0; }
}
const hud = { score: -1, time: '', acc: '', hp: -1, armour: -1, ammo: -1, weapon: '', line: '' };
const put = (key, id, value) => { if (hud[key] !== value) { hud[key] = value; $(id).textContent = value; } };
function paintHud() {
  if (!run) return;
  const rep = M.report(run);
  put('score', 'h-score', fmt(rep.score));
  const t = run.limit > 0 ? Math.max(0, run.limit - run.seconds) : run.seconds;
  put('time', 'h-time', `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`);
  put('acc', 'h-acc', rep.accuracy == null ? '0%' : `${Math.round(rep.accuracy)}%`);
  const P = eng.P;
  const hp = Math.ceil(P.hp);
  if (hud.hp !== hp) { hud.hp = hp; $('h-hp').textContent = String(hp); $('h-hp-bar').style.transform = `scaleX(${Math.max(0, hp / N.player.hp)})`; $('h-hp-box').classList.toggle('low', hp <= 30); }
  const ar = Math.ceil(P.armour);
  if (hud.armour !== ar) { hud.armour = ar; $('h-armour').hidden = ar <= 0; $('h-armour').textContent = `${ar} armour`; }
  const g = eng.guns, w = g.weapon();
  put('ammo', 'h-ammo', w ? String(g.cur().ammo) : '');
  put('weapon', 'h-weapon', g.reloading() ? 'Reloading' : w ? w.name : 'Knife');
  $('h-mag').textContent = w ? `/ ${w.mag}` : '';
  put('line', 'h-line', phase === 'playing' && ctl && ctl.line ? ctl.line() : '');
}

// ── The crosshair ───────────────────────────────────────────────────────────
/** @param grow extra pixels on every gap: the firing error */
function drawCrosshair(cv, x, grow) {
  const ctx = cv.getContext('2d');
  const W = cv.width, H = cv.height;
  ctx.clearRect(0, 0, W, H);
  const cx = W / 2, cy = H / 2;
  const rect = (rx, ry, rw, rh, color, alpha) => { ctx.globalAlpha = alpha; ctx.fillStyle = color; ctx.fillRect(Math.round(rx), Math.round(ry), Math.max(1, Math.round(rw)), Math.max(1, Math.round(rh))); };
  const o = x.outline ? x.outlineThickness : 0;
  const bar = (px, py, w, h, alpha) => {
    if (o) rect(px - o, py - o, w + 2 * o, h + 2 * o, 'rgb(0, 0, 0)', x.outlineOpacity * alpha);
    rect(px, py, w, h, x.color, alpha);
  };
  const lines = (len, th, off, alpha) => {
    if (!len || !th || !alpha) return;
    const O = off + (grow || 0);
    bar(cx - th / 2, cy - O - len, th, len, alpha);
    bar(cx - th / 2, cy + O, th, len, alpha);
    bar(cx - O - len, cy - th / 2, len, th, alpha);
    bar(cx + O, cy - th / 2, len, th, alpha);
  };
  if (x.outer) lines(x.outerLength, x.outerThickness, x.outerOffset, x.outerOpacity);
  if (x.inner) lines(x.innerLength, x.innerThickness, x.innerOffset, x.innerOpacity);
  if (x.dot) bar(cx - x.dotThickness / 2, cy - x.dotThickness / 2, x.dotThickness, x.dotThickness, x.dotOpacity);
  ctx.globalAlpha = 1;
}

// ── A run ───────────────────────────────────────────────────────────────────
/** Locks the pointer with raw input, or without it where that is refused. Resolves whether it is locked. */
async function lock() {
  const cv = $('view');
  audio.wake();
  try {
    await cv.requestPointerLock({ unadjustedMovement: true });
    rawInput = true;
  } catch (e) {
    if (e && e.name === 'NotSupportedError') {
      // No raw input on this PC: the plain lock, and the report says so.
      rawInput = false;
      try { await cv.requestPointerLock(); } catch { /* answered below */ }
    }
  }
  return document.pointerLockElement === cv;
}

const KEY_HINTS = [['forward', 'left', 'back', 'right', 'Move'], ['walk', 'Walk'], ['crouch', 'Crouch'], ['jump', 'Jump'], ['reload', 'Reload'], ['primary', 'secondary', 'knife', 'Weapons']];
function paintKeys() {
  const box = $('h-keys');
  box.textContent = '';
  for (const row of KEY_HINTS) {
    const s = el('span');
    for (const a of row.slice(0, -1)) s.append(el('kbd', null, keyName(settings.binds[a])));
    s.append(document.createTextNode(row[row.length - 1]));
    box.append(s);
  }
}

/** Whether a run may be played now: this page in front, and main saying no match is on. */
async function free() {
  if (document.visibilityState !== 'visible' || !document.hasFocus()) return false;
  const got = await bridge.getRuns().catch(() => null);
  if (got && got.replay && got.replay.id && !replays.some((r) => r.id === got.replay.id)) replays.unshift(got.replay);
  if (got && got.opened && byId(got.opened)) asked = got.opened;
  return !!got;
}
/** No button keeps the keyboard into a run: Space is the jump, not a click. */
const letGo = () => { const a = document.activeElement; if (a && a !== document.body && a.blur) a.blur(); };

async function begin(sc) {
  if (!sc || phase === 'countdown' || starting) return;
  starting = true;
  const ok = await free();
  starting = false;
  if (!ok) return;
  letGo();
  if (sc.kind === 'replay') seenReplays();
  clearInterval(countTimer);
  current = sc;
  selected = pickOf(sc);
  run = newRun();
  run.limit = sc.limit || 0;
  eng.load(sc.arena, EXTRA[sc.kind] || null, sc.spec || null);
  eng.setArmour(sc.botShoot ? N.player.armour : 0);
  run.start = eng.P.hp + eng.P.armour;
  ctl = controllerFor(sc, view, run);
  $('h-gate').hidden = sc.kind !== 'strafe';
  $('hud').classList.toggle('plain', sc.kind === 'calibration');
  document.querySelector('.tr-top').hidden = sc.kind === 'calibration';
  $('h-hp-box').hidden = !sc.botShoot;
  lastRecoil = -1; lastErr = -1; lastReload = -2; lastGate = null; hudAcc = 1;
  for (const k in hud) hud[k] = k === 'score' || k === 'hp' || k === 'armour' || k === 'ammo' ? -1 : null;
  drawCrosshair($('xhair'), settings.crosshair, 0);
  $('xhair').style.transform = '';
  paintKeys();
  setPhase('countdown');
  eng.still();
  paintHud();
  if (!await lock()) { held(false, 'The mouse could not be locked. Click Resume to try again.'); return; }
  if (phase === 'countdown') countdown();
}

/** The pause panel, over the run where it stands. */
function held(begun, text) {
  setPhase('paused');
  $('p-what').textContent = text;
  $('p-sens').value = String(settings.sens);
}

function countdown() {
  clearInterval(countTimer);
  const c = $('h-count');
  if (current.kind === 'calibration') { c.hidden = true; $('h-keys').hidden = true; go(); return; }
  let n = 3;
  const show = () => { c.textContent = String(n); c.className = 'tr-count'; void c.offsetWidth; c.classList.add('tick'); audio.play('beep'); };
  c.hidden = false;
  $('h-keys').hidden = false;
  show();
  countTimer = setInterval(() => {
    n--;
    if (n > 0) { show(); return; }
    clearInterval(countTimer);
    c.hidden = true;
    $('h-keys').hidden = true;
    audio.play('go');
    go();
  }, 650);
}

function go() {
  if (phase !== 'countdown') return;
  setPhase('playing');
  run.started = true;
  eng.resetFrameTimes();
  eng.start();
  if (ctl.start) ctl.start(eng.now);
}

function pause() {
  if (phase !== 'playing' && phase !== 'countdown') return;
  clearInterval(countTimer);
  $('h-count').hidden = true;
  $('h-keys').hidden = true;
  // A run that had not begun goes back to before its countdown.
  const begun = !!(run && run.started);
  eng.stop();
  held(begun, `${nameOf(current)}${begun ? '' : ', not started yet'}`);
  if (document.pointerLockElement) document.exitPointerLock();
  audio.sleep();
  eng.still();
}

async function resume() {
  if (phase !== 'paused' || !run) return;
  if (!await free() || phase !== 'paused') return;
  letGo();
  const begun = !!run.started;
  setPhase('countdown');
  if (!await lock()) { held(begun, 'The mouse could not be locked yet. Click Resume again.'); return; }
  if (phase !== 'countdown') return;
  if (!run.started) { countdown(); return; }
  setPhase('playing');
  eng.start();
}

function toMenu() {
  clearInterval(countTimer);
  eng.stop();
  if (document.pointerLockElement) document.exitPointerLock();
  run = null; ctl = null; current = null;
  setPhase('menu');
  paintList();
  paintDetail();
  preview();
}

async function finish() {
  if (!run || phase !== 'playing') return;
  eng.stop();
  if (document.pointerLockElement) document.exitPointerLock();
  audio.play('finish');
  const sc = current, done = run, c = ctl;
  if (sc.kind !== 'replay') done.damageTaken = Math.round(done.start - Math.max(0, eng.P.hp) - eng.P.armour);
  const rep = M.report(done);
  const ft = eng.frameTimes().sort((a, b) => a - b);
  window.occlaraTrainer.lastFrames = ft.length ? { n: ft.length, p50: ft[Math.floor(ft.length / 2)], p99: ft[Math.floor(ft.length * 0.99)] } : null;
  const before = M.historyOf({ schema: M.SCHEMA, runs }, sc.id, 20);
  setPhase('report');
  reportAt = performance.now();
  eng.still();
  let best = false;
  const saved = await bridge.saveRun({ scenario: sc.id, ...rep, weapon: settings.primary, sens: settings.sens }).catch(() => null);
  if (saved && saved.ok) { best = saved.best; runs.push(saved.run); }
  paintReport(sc, rep, done, c, before, best, !!(saved && saved.ok));
}

function paintReport(sc, rep, done, c, before, best, kept) {
  $('r-title').textContent = `${nameOf(sc)}${rep.died ? ', you were killed' : ''}`;
  // The score counts up once, through CSS (trainer.css --tr-n).
  const s = $('r-score');
  s.setAttribute('aria-label', `Score ${fmt(rep.score)}`);
  s.style.transition = 'none';
  s.style.setProperty('--tr-n', '0');
  void s.offsetWidth;
  s.style.transition = '';
  s.style.setProperty('--tr-n', String(rep.score));
  const b = $('r-best');
  if (sc.kind === 'replay') { best = false; before = { ...before, best: null }; }
  b.classList.toggle('new', best && !!before.best);
  b.textContent = sc.kind === 'replay' ? '' : best && before.best ? `New best, ${fmt(rep.score - before.best.score)} more than before` : before.best && before.best.score ? `Best ${fmt(before.best.score)}` : before.best ? '' : 'First run';

  // The chart: the last 20 scores, oldest first, with the best as a dashed line.
  const svg = $('r-chart');
  svg.textContent = '';
  const NS = 'http://www.w3.org/2000/svg';
  const line = (cls, x1, y1, x2, y2) => { const l = document.createElementNS(NS, 'line'); l.setAttribute('class', cls); l.setAttribute('x1', x1); l.setAttribute('y1', y1); l.setAttribute('x2', x2); l.setAttribute('y2', y2); svg.append(l); };
  const pts = before.last.map((r) => r.score).concat(kept ? [rep.score] : []).slice(-20);
  line('base', 0, 92, 400, 92);
  if (pts.length) {
    const top = Math.max(1, ...pts, before.best ? before.best.score : 0) * 1.12;
    const xy = pts.map((v, i) => [pts.length > 1 ? 6 + (i * 388) / (pts.length - 1) : 200, 92 - (v / top) * 84]);
    if (before.best) { const y = 92 - (before.best.score / top) * 84; line('best', 0, y, 400, y); }
    if (xy.length > 1) { const pl = document.createElementNS(NS, 'polyline'); pl.setAttribute('class', 'ln'); pl.setAttribute('points', xy.map((p) => p.map((n) => n.toFixed(1)).join(',')).join(' ')); svg.append(pl); }
    xy.forEach(([x, y], i) => line(i === xy.length - 1 ? 'pt last' : 'pt', x, y, x, y));
  }

  // The stats, each with its change from the run before.
  const prev = before.last.length ? before.last[before.last.length - 1] : null;
  const delta = (key, unit, lowerIsBetter) => {
    if (!prev || rep[key] == null || prev[key] == null) return null;
    const d = Math.round((rep[key] - prev[key]) * 10) / 10;
    if (!d) return { text: 'Same as last run', cls: '' };
    return { text: `${d > 0 ? '+' : ''}${d}${unit} from last run`, cls: (d > 0) !== !!lowerIsBetter ? 'up' : 'down' };
  };
  const show = (v, unit) => (v == null ? 'None' : `${v}${unit || ''}`);
  const stats = [
    sc.kind === 'replay' ? ['Fights won', `${done.wins || 0} of ${done.fights || 0}`, null] : [sc.kind === 'spray' ? 'Sprays' : 'Kills', sc.kind === 'spray' ? String(rep.kills) : `${rep.kills} of ${rep.bots}`, null],
    ['Accuracy', show(rep.accuracy, '%'), delta('accuracy', '%')],
    ['Headshots', show(rep.headshots, '%'), delta('headshots', '%')],
    ['First bullet hit', show(rep.firstShot, '%'), delta('firstShot', '%')],
    ['Reaction', show(rep.reaction, ' ms'), delta('reaction', ' ms', true)],
    ['Time to kill', show(rep.ttk, ' ms'), delta('ttk', ' ms', true)],
    ['Stop time', show(rep.stop, ' ms'), delta('stop', ' ms', true)],
    sc.kind === 'replay' ? ['Kills', `${rep.kills} of ${rep.bots}`, null] : sc.botShoot ? ['Damage taken', String(rep.damageTaken), delta('damageTaken', '', true)] : ['Time', `${rep.seconds.toFixed(1)} s`, null],
  ];
  const box = $('r-stats');
  box.textContent = '';
  // A scenario that never measures a thing does not list it.
  const never = sc.kind === 'spray' ? ['Reaction', 'Time to kill', 'Stop time', 'Headshots'] : sc.kind === 'strafe' || sc.arena !== 'range' ? [] : ['Stop time'];
  for (const [label, value, d] of stats) {
    if (never.includes(label)) continue;
    const cell = el('div', 'tr-r-stat');
    cell.append(el('b', value === 'None' ? 'none' : null, value), el('span', null, label), el('em', d ? d.cls : '', d ? d.text : ''));
    box.append(cell);
  }
  const notes = [];
  if (sc.kind === 'replay') notes.push(done.wins >= done.fights ? 'You won every one of them. That fight is yours now.' : done.wins ? `You lost this fight in your match and won it ${done.wins} time${done.wins === 1 ? '' : 's'} out of ${done.fights} here.` : 'Not yet. Try it slower: get your crosshair where their head will be before you can see them.');
  if (sc.kind === 'strafe' && done.early) notes.push(`${done.early} of your shots left while you were still moving, so they could not count. Come under the accuracy gate first, then fire.`);
  if (sc.kind === 'spray' && c && c.sprays) notes.push(`Bullets on the target in each spray: ${c.sprays.map((x) => `${x.hits} of ${x.shots}`).join(', ')}.`);
  if (done.missed) notes.push(`${done.missed} got away alive.`);
  if (!rawInput) notes.push('Raw mouse input was not available, so Windows pointer settings may have changed how far the view turned.');
  if (!kept) notes.push('This run could not be saved.');
  $('r-note').textContent = notes.join(' ');
  $('r-next').hidden = !nextOf(sc);
}
function nextOf(sc) { if (sc.kind === 'replay') { const i = replays.findIndex((x) => REPLAY + x.id === sc.pick); return i >= 0 && i < replays.length - 1 ? byId(REPLAY + replays[i + 1].id) : null; } const i = SCENARIOS.findIndex((x) => x.id === sc.id); return i >= 0 && i < SCENARIOS.length - 1 ? SCENARIOS[i + 1] : null; }

// ── The rail: scenarios ─────────────────────────────────────────────────────
const nameOf = (sc) => `${sc.title}${sc.level ? `, ${sc.level === 'hard' ? 'Hard' : 'Easy'}` : ''}`;
function factsOf(sc) {
  const f = [];
  if (sc.kind === 'calibration') return ['No score'];
  if (sc.limit) f.push(`${sc.limit} seconds`);
  if (sc.kind === 'spray') f.push(`${sc.bots} sprays`);
  else if (sc.bots) f.push(`${sc.bots} ${sc.arena === 'range' ? 'targets' : 'bots'}`);
  if (sc.botShoot) f.push('they shoot back');
  return f;
}
// One glyph for each range drill. App authored markup.
const GLYPH = {
  calibration: '<path d="M19 12a7 7 0 1 1-2.6-5.4"/><path d="M19.2 3.8v4.4h-4.4"/>',
  flick: '<circle cx="5.5" cy="8" r="1.7"/><circle cx="18.5" cy="6" r="1.7"/><circle cx="14" cy="18" r="1.7"/><path d="M7 9.4l5.9 7.2M14.8 16.2l3-8.4"/>',
  micro: '<circle cx="12" cy="12" r="8.2"/><circle cx="11" cy="12.4" r="1.3"/><circle cx="14.6" cy="10.6" r="1.3"/><circle cx="8.4" cy="10.2" r="1.3"/>',
  track: '<path d="M3.5 12h17"/><path d="M7 8.5L3.5 12 7 15.5M17 8.5l3.5 3.5-3.5 3.5"/>',
  strafe: '<path d="M12 5v14"/><path d="M4 12h5M20 12h-5"/><path d="M6.5 9.5L4 12l2.5 2.5M17.5 9.5L20 12l-2.5 2.5"/>',
  replay: '<path d="M4.5 12a7.5 7.5 0 1 0 2.4-5.5"/><path d="M4 4.5v4h4"/><circle cx="12" cy="12" r="1.6"/>',
  spray: '<path d="M11.5 20.5c0-5 .2-7.5 1-10.5s1.6-4 1.6-6.5"/><circle cx="11.5" cy="20" r="1"/><circle cx="11.8" cy="15" r="1"/><circle cx="12.6" cy="10.4" r="1"/><circle cx="13.8" cy="6.6" r="1"/>',
};
function planIcon(arena) {
  const p = arenaPlan(arena);
  const cv = document.createElement('canvas');
  cv.width = cv.height = 80;
  const g = cv.getContext('2d');
  const [x0, , z0] = p.bounds.min, [x1, , z1] = p.bounds.max;
  const pad = 8, k = Math.min((80 - 2 * pad) / (x1 - x0), (80 - 2 * pad) / (z1 - z0));
  const ox = (80 - (x1 - x0) * k) / 2 - x0 * k, oz = (80 - (z1 - z0) * k) / 2 - z0 * k;
  g.fillStyle = 'rgba(255, 255, 255, 0.10)';
  g.fillRect(x0 * k + ox, z0 * k + oz, (x1 - x0) * k, (z1 - z0) * k);
  for (const b of p.blocks) {
    const bx0 = Math.max(x0, b.x0), bx1 = Math.min(x1, b.x1), bz0 = Math.max(z0, b.z0), bz1 = Math.min(z1, b.z1);
    if (bx1 <= bx0 || bz1 <= bz0) continue;
    g.fillStyle = b.tall ? 'rgba(255, 255, 255, 0.78)' : 'rgba(255, 255, 255, 0.42)';
    g.fillRect(bx0 * k + ox, bz0 * k + oz, Math.max(1.5, (bx1 - bx0) * k), Math.max(1.5, (bz1 - bz0) * k));
  }
  g.fillStyle = 'rgb(255, 255, 255)';
  g.beginPath(); g.arc(p.start.x * k + ox, p.start.z * k + oz, 3.2, 0, Math.PI * 2); g.fill();
  return cv;
}
const iconCache = new Map();

function paintList() {
  const list = $('list');
  list.textContent = '';
  const hist = { schema: M.SCHEMA, runs };
  const note = $('fresh');
  note.hidden = !fresh.length;
  if (fresh.length) {
    // The newest match alone is counted: the list is newest first.
    const last = replays.find((r) => fresh.includes(r.id));
    const n = last ? replays.filter((r) => r.reviewId === last.reviewId && fresh.includes(r.id)).length : 0;
    $('fresh-text').textContent = `Your last match${last && last.map ? ` on ${last.map}` : ''} has ${n} death${n === 1 ? '' : 's'} you can fight again. Pick one under Your deaths.`;
  }
  if (replays.length) {
    list.append(el('p', 'tr-sub', 'Your deaths'));
    // The newest few, the chosen one always among them, and the rest behind one line.
    const shown = allDeaths ? replays : replays.filter((r, i) => i < 5 || REPLAY + r.id === selected || REPLAY + r.id === asked);
    for (const r of shown) {
      const id = REPLAY + r.id;
      const b = el('button', `tr-item${fresh.includes(r.id) ? ' fresh' : ''}${r.spec && r.spec.flagged ? ' flagged' : ''}`);
      b.type = 'button';
      b.dataset.id = id;
      b.setAttribute('aria-current', String(selected === id));
      if (asked === id) b.classList.add('asked', 'from-review');
      const ico = el('span', 'tr-item-ico');
      ico.innerHTML = `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${GLYPH.replay}</svg>`;
      const text = el('span', 'tr-item-text');
      text.append(el('span', 'tr-item-name', [r.title, r.map].filter(Boolean).join(', ')), el('span', 'tr-item-sub', r.line));
      b.append(ico, text, el('span', 'tr-item-best', ''));
      b.title = r.line;
      b.addEventListener('click', () => select(id));
      b.addEventListener('dblclick', () => begin(byId(selected)));
      list.append(b);
    }
    if (replays.length > shown.length || allDeaths) {
      const more = el('button', 'btn btn-link sm tr-more', allDeaths ? 'Show fewer' : `Show all ${replays.length}`);
      more.type = 'button';
      more.addEventListener('click', () => { allDeaths = !allDeaths; paintList(); });
      list.append(more);
    }
  }
  for (const [name, items] of [['Range', ENTRIES.filter((e) => e.arena === 'range')], ['Arenas', ENTRIES.filter((e) => e.arena !== 'range')]]) {
    list.append(el('p', 'tr-sub', name));
    for (const e of items) {
      const on = e.list.some((s) => s.id === selected);
      const b = el('button', 'tr-item');
      b.type = 'button';
      b.dataset.id = e.list[0].id;
      b.setAttribute('aria-current', String(on));
      if (asked && e.list.some((s) => s.id === asked)) b.classList.add('asked');
      const ico = el('span', 'tr-item-ico');
      if (e.arena === 'range') ico.innerHTML = `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${GLYPH[e.kind] || ''}</svg>`;
      else { if (!iconCache.has(e.arena)) iconCache.set(e.arena, planIcon(e.arena)); const cv = document.createElement('canvas'); cv.width = cv.height = 80; cv.getContext('2d').drawImage(iconCache.get(e.arena), 0, 0); ico.append(cv); }
      const text = el('span', 'tr-item-text');
      text.append(el('span', 'tr-item-name', e.title), el('span', 'tr-item-sub', e.list.length > 1 ? 'Easy and Hard' : factsOf(e.list[0]).join(', ')));
      let best = 0;
      for (const s of e.list) { const h = M.historyOf(hist, s.id).best; if (h && h.score > best) best = h.score; }
      b.append(ico, text, el('span', 'tr-item-best', best ? fmt(best) : ''));
      b.addEventListener('click', () => select(e.list.some((s) => s.id === selected) ? selected : e.list[0].id));
      b.addEventListener('dblclick', () => begin(byId(selected)));
      list.append(b);
    }
  }
}

function paintDetail() {
  // A choice that is gone (a review deleted, a death no longer listed) falls back to the first drill.
  if (!byId(selected)) selected = 'flick-grid';
  const sc = byId(selected);
  const e = entryOf(selected);
  $('d-kind').textContent = sc.kind === 'replay' ? `Your death, ${N.replay.fights} fights, they shoot back` : [sc.arena === 'range' ? 'Range' : 'Arena'].concat(factsOf(sc)).join(', ');
  $('d-title').textContent = sc.title;
  $('d-about').textContent = sc.about;
  const lv = $('d-level');
  lv.hidden = e.list.length < 2;
  if (e.list.length > 1) segOf(lv, e.list.map((s) => [s.id, s.level === 'hard' ? 'Hard' : 'Easy']), selected, (id) => select(id));
  const a = $('d-asked');
  a.hidden = asked !== selected;
  a.textContent = asked !== selected ? '' : sc.kind === 'replay' ? 'Your review sent you here to fight this one again.' : 'Practice sent you here for this one.';
  const h = M.historyOf({ schema: M.SCHEMA, runs }, sc.id, 5);
  const accs = h.last.map((r) => r.accuracy).filter((v) => v != null);
  const stats = sc.kind === 'calibration'
    ? [['Turn', '360°'], ['Lane', '20 m'], ['Sensitivity', String(settings.sens)]]
    : [['Best', h.best ? fmt(h.best.score) : 'None yet'], ['Runs', String(h.plays)], ['Accuracy, last 5', accs.length ? `${Math.round(accs.reduce((x, y) => x + y, 0) / accs.length)}%` : 'None yet']];
  const box = $('d-stats');
  box.textContent = '';
  box.className = sc.kind !== 'calibration' && !h.plays ? 'tr-d-none' : 'tr-d-stats';
  if (sc.kind === 'replay') { box.className = 'tr-d-none'; box.textContent = sc.spec && sc.spec.dist != null
    ? `Laid out from Riot's record of this death: ${Math.round(sc.spec.dist)} metres away, what they held and how it began. It is not the place it happened.`
    : `Laid out from Riot's record of this death: what they held and how it began. This match was reviewed before distances were kept, so the range is judged from the weapon. It is not the place it happened.`; return; }
  if (sc.kind !== 'calibration' && !h.plays) { box.textContent = 'You have not played this one yet.'; return; }
  for (const [label, value] of stats) { const c = el('div', 'tr-d-stat'); c.append(el('b', null, value), el('span', null, label)); box.append(c); }
}

function preview() {
  if (phase !== 'menu') return;
  $('x-note').hidden = tabNow !== 'settings';
  if (tabNow === 'settings') { eng.preview('range', true); drawCrosshair($('xhair'), settings.crosshair, 0); $('xhair').style.transform = ''; }
  else { const sc = byId(selected) || byId('flick-grid'); eng.preview(sc.arena, false, sc.spec || null); }
}

function select(id) {
  if (!byId(id)) return;
  selected = id;
  if (phase !== 'menu') return;
  for (const b of document.querySelectorAll('.tr-item')) { const e = entryOf(b.dataset.id); b.setAttribute('aria-current', String(b.dataset.id === id || (!!e && !e.pick && e.list.some((s) => s.id === id)))); }
  paintDetail();
  if (tabNow === 'play') preview();
}

function aboutText() {
  const un = M.unverified(RAW);
  const box = $('about-text');
  box.textContent = '';
  for (const t of [
    'Matched to the game, each from a stated source: 0.07 degrees per mouse count times your sensitivity with raw input, the 103 degree view, run speeds by weapon, the accuracy gate at 27.5% of your top speed, the first shot\'s cone, the moving, jumping and landing errors, fire rates, magazines, reloads, armour and damage by range.',
    `Measured by players, or set by us where nothing is published (${un.length} values): how fast you speed up and stop, walk and crouch speeds, the jump, the recoil's climb, hitbox sizes and eye height.`,
    'To check it yourself, play Calibration with your game\'s sensitivity: one full swipe of your mouse pad should turn the same angle as in the game\'s own Range, and the 20 metre lane should take the time shown.',
  ]) box.append(el('p', null, t));
}

// ── The rail: settings ──────────────────────────────────────────────────────
let saveTimer = null;
function apply(next, save) {
  settings = M.normaliseSettings(next);
  eng.setSettings(settings);
  audio.setVolume(settings.volume);
  $('h-fps').hidden = !settings.fps;
  paintSettings();
  if (phase === 'menu') preview();
  if (save) { clearTimeout(saveTimer); saveTimer = setTimeout(() => { bridge.saveSettings(settings).catch(() => {}); }, 250); }
}

const NAMES = { forward: 'Forward', back: 'Back', left: 'Left', right: 'Right', walk: 'Walk', crouch: 'Crouch', jump: 'Jump', reload: 'Reload', primary: 'Primary', secondary: 'Sidearm', knife: 'Knife' };
const KEY_NAMES = { Space: 'Space', ShiftLeft: 'Shift', ShiftRight: 'R Shift', ControlLeft: 'Ctrl', ControlRight: 'R Ctrl', AltLeft: 'Alt', AltRight: 'R Alt', CapsLock: 'Caps', Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\', Semicolon: ';', Quote: '\'', Comma: ',', Period: '.', Slash: '/' };
function keyName(code) {
  if (KEY_NAMES[code]) return KEY_NAMES[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return `Num ${code.slice(6)}`;
  if (code.startsWith('Mouse')) return `Mouse ${code.slice(5)}`;
  return code;
}
let listening = null;

function segOf(box, options, value, set) {
  // Built once, then only its state moves, so the thumb slides.
  if (box.dataset.opts !== options.map((o) => o[0]).join('|')) {
    // Its buttons alone: the sliding thumb seg.js put in the row stays.
    for (const old of [...box.querySelectorAll('button')]) old.remove();
    box.dataset.opts = options.map((o) => o[0]).join('|');
    for (const [v, label] of options) {
      const b = el('button', null, label);
      b.type = 'button';
      b.setAttribute('role', 'radio');
      b.dataset.v = String(v);
      b.addEventListener('click', () => box.onpick && box.onpick(v));
      box.append(b);
    }
    if (window.occlaraSeg) window.occlaraSeg(box);
  }
  box.onpick = set;
  for (const b of box.querySelectorAll('button')) b.setAttribute('aria-checked', String(b.dataset.v === String(value)));
}
const onOff = (box, value, set) => segOf(box, [[true, 'On'], [false, 'Off']], value, set);
const setVal = (node, v) => { if (document.activeElement !== node) node.value = String(v); };

function paintSettings() {
  const s = settings, x = s.crosshair;
  setVal($('s-sens'), s.sens); setVal($('s-dpi'), s.dpi); setVal($('s-scoped'), s.scoped);
  const cm = M.cm360(N, s.dpi, s.sens);
  $('s-cm').textContent = cm ? `${cm.toFixed(1)} cm, ${(cm / 2.54).toFixed(1)} in` : '';
  $('x-color').value = x.color.toLowerCase();
  for (const [id, v] of [['x-len', x.innerLength], ['x-thick', x.innerThickness], ['x-gap', x.innerOffset]]) { $(id).value = String(v); $(`${id}-v`).textContent = String(v); }
  const xset = (patch) => apply({ ...settings, crosshair: { ...settings.crosshair, ...patch } }, true);
  onOff($('x-dot'), x.dot, (v) => xset({ dot: v }));
  onOff($('x-outline'), x.outline, (v) => xset({ outline: v }));
  onOff($('x-error'), x.firingError, (v) => xset({ firingError: v }));
  segOf($('s-enemy'), M.ENEMY_COLOURS.map((c) => [c, c[0].toUpperCase() + c.slice(1)]), s.enemy, (v) => apply({ ...settings, enemy: v }, true));
  segOf($('s-primary'), M.PRIMARIES.map((id) => [id, N.weapons[id].name]), s.primary, (v) => apply({ ...settings, primary: v }, true));
  segOf($('s-secondary'), M.SECONDARIES.map((id) => [id, N.weapons[id].name]), s.secondary, (v) => apply({ ...settings, secondary: v }, true));
  $('s-follows').textContent = `Each uses one weapon's numbers: ${[s.primary, s.secondary].map((id) => `the ${N.weapons[id].name.toLowerCase()} the ${N.weapons[id].follows}'s`).join(', ')}.`;
  segOf($('s-graphics'), [['high', 'High'], ['low', 'Low']], s.graphics, (v) => apply({ ...settings, graphics: v }, true));
  onOff($('s-fps'), s.fps, (v) => apply({ ...settings, fps: v }, true));
  $('s-volume').value = String(s.volume);
  $('s-volume-v').textContent = `${Math.round(s.volume * 100)}`;
  $('s-runs').textContent = runs.length ? `${fmt(runs.length)} run${runs.length === 1 ? '' : 's'} kept on this PC, the newest ${M.RUNS_MAX} at most.` : 'No runs yet. They are kept on this PC only.';
  $('s-clear').disabled = !runs.length;
  const binds = $('binds');
  binds.textContent = '';
  for (const a of M.BIND_ACTIONS) {
    const row = el('div', 'tr-bind');
    const k = el('button', `kbd${listening === a ? ' listening' : ''}`, listening === a ? 'Press a key' : keyName(s.binds[a]));
    k.type = 'button';
    k.setAttribute('aria-label', `${NAMES[a]}: ${keyName(s.binds[a])}. Change`);
    k.addEventListener('click', () => { listening = listening === a ? null : a; paintSettings(); });
    row.append(el('span', null, NAMES[a] || a), k);
    binds.append(row);
  }
}

function rebind(code) {
  const a = listening;
  listening = null;
  if (!a || code === 'Escape') { paintSettings(); return; }
  if (!M.validKey(code)) { $('binds-said').textContent = 'That key cannot be used here. Pick a letter, a digit, a function key, Space, Tab, Shift, Ctrl, Alt or a side mouse button.'; paintSettings(); return; }
  $('binds-said').textContent = `${NAMES[a]} is now ${keyName(code)}.`;
  const b = { ...settings.binds };
  // A key already on another action swaps with it.
  const other = Object.keys(b).find((k) => b[k] === code);
  if (other && other !== a) b[other] = b[a];
  b[a] = code;
  apply({ ...settings, binds: b }, true);
}

const num = (node) => Number(String(node.value).replace(',', '.'));
$('s-sens').addEventListener('change', () => apply({ ...settings, sens: num($('s-sens')) }, true));
$('s-dpi').addEventListener('change', () => apply({ ...settings, dpi: Math.round(num($('s-dpi'))) }, true));
$('s-scoped').addEventListener('change', () => apply({ ...settings, scoped: num($('s-scoped')) }, true));
$('p-sens').addEventListener('change', () => apply({ ...settings, sens: num($('p-sens')) }, true));
$('s-volume').addEventListener('input', () => apply({ ...settings, volume: Number($('s-volume').value) }, true));
const xpatch = (patch) => apply({ ...settings, crosshair: { ...settings.crosshair, ...patch } }, true);
$('x-color').addEventListener('input', () => xpatch({ color: $('x-color').value.toUpperCase() }));
$('x-len').addEventListener('input', () => xpatch({ innerLength: Number($('x-len').value) }));
$('x-thick').addEventListener('input', () => xpatch({ innerThickness: Number($('x-thick').value) }));
$('x-gap').addEventListener('input', () => xpatch({ innerOffset: Number($('x-gap').value) }));
$('x-apply').addEventListener('click', () => {
  const x = M.parseCrosshairCode($('x-code').value);
  $('x-said').textContent = x ? 'Crosshair set from your code.' : 'That is not a crosshair code. In your game, open Settings, Crosshair, and export the profile code.';
  if (x) apply({ ...settings, crosshair: x }, true);
});
let clearArmed = null;
$('s-clear').addEventListener('click', async () => {
  const btn = $('s-clear');
  if (!clearArmed) {
    // Armed for four seconds: the next click clears.
    btn.textContent = 'Click again to clear them all';
    clearArmed = setTimeout(() => { clearArmed = null; btn.textContent = 'Clear every run'; }, 4000);
    return;
  }
  clearTimeout(clearArmed); clearArmed = null;
  btn.textContent = 'Clear every run';
  const r = await bridge.clearRuns(null).catch(() => null);
  if (r && r.ok) { runs = []; paintList(); paintDetail(); paintSettings(); }
});

function tab(which) {
  tabNow = which;
  root.dataset.tab = which;
  $('tab-play').setAttribute('aria-selected', String(which === 'play'));
  $('tab-settings').setAttribute('aria-selected', String(which === 'settings'));
  $('pane-play').hidden = which !== 'play';
  $('pane-settings').hidden = which !== 'settings';
  preview();
}
$('tab-play').addEventListener('click', () => tab('play'));
$('tab-settings').addEventListener('click', () => tab('settings'));
if (window.occlaraSeg) window.occlaraSeg(document.querySelector('.tr-tabs'));

$('play').addEventListener('click', () => begin(byId(selected)));
function seenReplays() { if (!fresh.length) return; fresh = []; if (typeof bridge.replaysSeen === 'function') bridge.replaysSeen(); }
$('fresh-ok').addEventListener('click', () => { seenReplays(); paintList(); });
$('p-resume').addEventListener('click', resume);
$('p-restart').addEventListener('click', () => begin(current));
$('p-menu').addEventListener('click', toMenu);
$('r-retry').addEventListener('click', () => begin(current));
$('r-next').addEventListener('click', () => begin(nextOf(current) || current));
$('r-menu').addEventListener('click', toMenu);

// The keyboard outside a run: a bind being set, Enter to play, the report's three keys.
document.addEventListener('keydown', (e) => {
  if (listening && phase === 'menu') { e.preventDefault(); e.stopPropagation(); rebind(e.code); return; }
  const typing = e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA');
  if (phase === 'playing') {
    // Calibration's own key: reload puts the turn count back to zero.
    if (ctl && ctl.resetTurn && e.code === settings.binds.reload) ctl.resetTurn();
    return;
  }
  if (typing || e.repeat) return;
  if (phase === 'menu' && tabNow === 'play' && e.code === 'Enter') { e.preventDefault(); begin(byId(selected)); }
  else if (phase === 'report' && performance.now() - reportAt > 700) {
    // Not in its first moments: a reload pressed as the run ended is no Retry.
    if (e.code === 'KeyR') begin(current);
    else if (e.code === 'Enter') { e.preventDefault(); begin(nextOf(current) || current); }
    else if (e.code === 'Escape') toMenu();
  }
}, true);
document.addEventListener('mousedown', (e) => { if (listening && phase === 'menu' && e.button >= 3) { e.preventDefault(); rebind(`Mouse${e.button + 1}`); } }, true);

// ── The pointer and the page ────────────────────────────────────────────────
document.addEventListener('pointerlockchange', () => {
  const locked = document.pointerLockElement === $('view');
  bridge.playing(locked);
  if (!locked) pause();
});
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') pause(); });
window.addEventListener('blur', pause);
bridge.onPage((m) => { if (m && m.phase === 'leave') pause(); });
window.addEventListener('resize', () => { if (!eng.playing) eng.still(); else eng.resize(); });
// The app's Sounds switch may have moved: asked again on every state push.
bridge.onState(async () => {
  const cfg = await bridge.getConfig().catch(() => null);
  const on = !cfg || cfg.sounds !== false;
  if (on !== soundsOn) { soundsOn = on; audio.setOn(on); $('s-sounds').hidden = on; }
});
bridge.onTrainer(() => { load(); });

async function load() {
  const got = await bridge.getRuns().catch(() => null);
  if (!got) return;
  runs = got.runs || [];
  if (typeof bridge.getReplays === 'function') {
    const rp = await bridge.getReplays().catch(() => null);
    if (rp) { const had = replays; replays = Array.isArray(rp.list) ? rp.list : []; for (const r of had) if (!replays.some((x) => x.id === r.id) && [selected, asked, current && current.pick].includes(REPLAY + r.id)) replays.unshift(r); fresh = Array.isArray(rp.fresh) ? rp.fresh.filter((id) => replays.some((r) => r.id === id)) : []; }
  }
  if (got.replay && got.replay.id && !replays.some((r) => r.id === got.replay.id)) replays.unshift(got.replay);
  if (!byId(selected)) selected = 'flick-grid';
  if (got.opened && byId(got.opened)) {
    asked = got.opened;
    if (phase !== 'menu') toMenu();
    if (tabNow !== 'play') tab('play');
    selected = asked;
  }
  if (phase !== 'menu') return;
  paintList();
  paintDetail();
  paintSettings();
  if (got.opened) { preview(); const row = document.querySelector('.tr-item.asked'); if (row) row.scrollIntoView({ block: 'nearest' }); }
}

// For the boot check (scripts/check-trainer.js).
window.occlaraTrainer = {
  get phase() { return phase; },
  get playing() { return eng.playing; },
  get raw() { return rawInput; },
  get selected() { return selected; },
  /** The ids of the deaths that can be fought again. */
  get replays() { return replays.map((r) => REPLAY + r.id); },
  /** How many sounds are drawn, of how many. */
  get sounds() { return [audio.ready(), audio.names().length]; },
  /** Where the player stands and how fast, read only. */
  get player() { const P = eng.P; return { x: P.x, y: P.y, z: P.z, speed: Math.hypot(P.v.x, P.v.z), ground: P.ground, crouch: P.crouch, hp: P.hp, armour: P.armour }; },
  select,
  /** For the checks: the deaths list as main would give it, painted. */
  setReplays(list) { replays = Array.isArray(list) ? list : []; fresh = []; if (phase === 'menu') paintList(); },
  lastFrames: null,
  frameTimes: () => eng.frameTimes(),
  scenarios: () => SCENARIOS.map((s) => s.id),
};

bridge.playing(false);
(async () => {
  const cfg = await bridge.getConfig().catch(() => null);
  soundsOn = !cfg || cfg.sounds !== false;
  audio.setOn(soundsOn);
  $('s-sounds').hidden = soundsOn;
  setPhase('menu');
  apply(cfg ? cfg.trainerSettings : null, false);
  aboutText();
  paintList();
  paintDetail();
  await load();
  preview();
})();

'use strict';

/**
 * OCCLARA WRAPPED, booted for real (docs/claude/wrapped.md): the real index.js,
 * its one window and Wrapped's own view, on the sample library with a year
 * record of the sample year, the clock set to 16 December 2026 (the dev
 * switch OCCLARA_DEV_WRAPPED_NOW).
 *
 *  1. THE ONE TIME AUTO OPEN. The launch records, on the Recording view:
 *     nothing opens while recording (every animation is held still, 9.1),
 *     there or over Home. Recording stopped, in the window of the year, no
 *     match live: Wrapped opens by itself, over the WHOLE window (the bar
 *     too), and the year is kept.
 *  2. THE KEYBOARD. The right arrow and Space go on, the left goes back, P
 *     pauses, M mutes, Escape closes and the view goes, page and all.
 *  3. NEVER AGAIN BY ITSELF. Hidden and shown, minimised and restored,
 *     focused again: nothing opens; the player's own ask from Home does.
 *  4. THE SEAL. With Wrapped up, recording starts and holds the story still,
 *     then a match starts: the view is closed in the
 *     seal's tick, no page left to play, and Home's ask and the page's own
 *     ask are both refused mid match; the match over, nothing comes back by
 *     itself.
 *  5. THE SOUND SETTING. Sounds off in Settings: Wrapped opens muted.
 *  6. LESS MOTION. prefers-reduced-motion emulated: nothing loops, no frame
 *     of the ground is drawn but the still, every slide still reads.
 *
 * Results travel through a FILE, as the other boot checks' do.
 *
 * Run: npm run check:wrapped
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

const REPO = path.join(__dirname, '..');
const OUT = path.join(os.tmpdir(), 'occlara-wrapped-check.json');
const NOW = new Date(2026, 11, 16, 20, 0).getTime();

if (!process.versions.electron) {
  const { spawnSync } = require('child_process');
  const electron = require('electron');
  try { fs.unlinkSync(OUT); } catch { /* nothing to clear */ }
  const env = Object.assign({}, process.env, { OCCLARA_WRAPPED_OUT: OUT });
  delete env.ELECTRON_RUN_AS_NODE;
  const r = spawnSync(electron, [__filename], { env, timeout: 150000 });
  let rec = null;
  try { rec = JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch { /* reported below */ }
  if (!rec) { console.error('FAIL: the check wrote no result (exit ' + r.status + ')'); process.exit(1); }
  for (const l of rec.lines) console.log('  ' + l);
  if (!rec.ok) { console.error('FAIL: ' + rec.detail); process.exit(1); }
  console.log('PASS: Wrapped never opens by itself while recording, on the Recording view or over Home; recording stopped, it opens by itself once, over the whole window, in its window with no match live, and never again; its keys move, pause, mute and close it; out of focus it pauses and the focus back resumes it; it opens by itself only over Home; the player opens it from Home; recording started holds its story still; a match starting closes it in the seal\'s tick and every ask mid match is refused; Sounds off opens it muted; and under less motion nothing loops');
  process.exit(0);
}

const { app } = require('electron');
const surfaces = require('./fixtures/surfaces');
const proof = require('./fixtures/proof-reviews');
const sample = require('./fixtures/wrapped-sample');
const C = require(path.join(REPO, 'src/shared/channels'));

const lines = [];
let reported = false;
function report(ok, detail) {
  if (reported) return;
  reported = true;
  try { fs.writeFileSync(process.env.OCCLARA_WRAPPED_OUT || OUT, JSON.stringify({ ok, detail, lines })); } catch { /* exit code */ }
  app.exit(ok ? 0 : 1);
}

proof.installStandIns();
const ud = path.join(os.tmpdir(), 'occlara-check-wrapped');
proof.seed(ud, { now: new Date(2026, 11, 14, 21).getTime() });
// The year record: the sample year, and the one time fill marked done.
{
  const dir = path.join(ud, 'wrapped');
  fs.mkdirSync(dir, { recursive: true });
  const rows = {};
  for (const r of sample.rows()) rows[r.id] = r;
  fs.writeFileSync(path.join(dir, '2026.json'), JSON.stringify({ v: 1, year: 2026, rows }));
  fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify({ v: 1, backfilledAt: Date.now(), rows: 0 }));
  const cfgFile = path.join(ud, 'occlara-config.json');
  const cfg = JSON.parse(fs.readFileSync(cfgFile, 'utf8'));
  cfg.sounds = true;
  fs.writeFileSync(cfgFile, JSON.stringify(cfg, null, 2));
}
process.env.OCCLARA_DEV_USERDATA = ud;
process.env.OCCLARA_DEV_AUTOLAUNCH = '1';
process.env.OCCLARA_DEV_NOQUIT = '1';
process.env.OCCLARA_DEV_WRAPPED_NOW = String(NOW);
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
app.on('window-all-closed', () => {});

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms) {
  const end = Date.now() + ms;
  for (;;) {
    let v = null;
    try { v = await fn(); } catch { v = null; }
    if (v) return v;
    if (Date.now() > end) return null;
    await wait(150);
  }
}

setTimeout(async () => {
  const mainWindow = require(path.join(REPO, 'src/main/windows/main-window'));
  const store = require(path.join(REPO, 'src/main/services/store'));
  try {
    const win = await until(() => { const w = mainWindow.get(); return w && w.isVisible() ? w : null; }, 15000);
    if (!win) return report(false, 'the window never came up');
    win.focus();
    const shell = await until(() => surfaces.find('/shell/'), 6000);
    if (!shell) return report(false, 'the shell never loaded');
    const shjs = (s) => shell.webContents.executeJavaScript(s);

    // 1. The one time auto open. The dev launch starts recording, and Start
    // lands on the Recording view (9.1, item 14). Recording holds every
    // animation in the app still (html.rec-still, item 9), the story's too,
    // so the year's one opening waits: on the Recording view, and over Home
    // while recording, nothing opens. Recording stopped, it opens by itself.
    const recOn = await until(() => mainWindow.current().rec && mainWindow.current(), 8000);
    await wait(1800);
    const overRec = mainWindow.wrappedState().open;
    mainWindow.show('home');
    await until(() => mainWindow.motionState().onScreen === 'home', 4000);
    win.focus();
    await wait(1800);
    const overHomeRec = mainWindow.wrappedState().open;
    lines.push(`recording on: the Recording view up=${!!recOn}, opened over it=${overRec}, over Home while recording=${overHomeRec}`);
    if (!recOn) return report(false, 'the launch started recording but Start did not land on the Recording view');
    if (overRec || overHomeRec) return report(false, 'Wrapped opened by itself while recording, with every animation held still');
    await shjs('window.occlara.stopCoaching(), true');
    const opened = await until(() => mainWindow.wrappedState().open, 8000);
    const ws = mainWindow.wrappedState();
    const [cw, ch] = win.getContentSize();
    const kept = store.get('wrappedAutoOpened') || {};
    lines.push(`shown on 16 December, recording stopped: Wrapped opened by itself=${!!opened} bounds=${JSON.stringify(ws.bounds)} kept=${JSON.stringify(Object.keys(kept))}`);
    if (!opened) return report(false, 'shown in its window with enough matches and the recording stopped, Wrapped did not open by itself');
    if (!ws.bounds || ws.bounds.x !== 0 || ws.bounds.y !== 0 || ws.bounds.width !== cw || ws.bounds.height !== ch) return report(false, 'Wrapped does not cover the whole window, the bar included');
    if (!kept[2026]) return report(false, 'the year it opened by itself was not kept');
    const wc = ws.view.webContents;
    const wjs = (s) => wc.executeJavaScript(s);
    const st0 = await until(() => wjs('window.__wrapped && window.__wrapped.state().ready && window.__wrapped.state()'), 8000);
    lines.push(`the story: ${st0 ? st0.slides.join(',') : 'none'} | sound ${JSON.stringify(st0 && st0.sound)}`);
    if (!st0 || st0.slides.length < 10 || st0.kind !== 'open') return report(false, 'the story did not start on its opening');
    if (st0.muted) return report(false, 'with Sounds on, Wrapped opened muted');
    const kids = win.contentView.children;
    if (kids[kids.length - 1] !== ws.view) return report(false, 'Wrapped is not on top of every page');

    // 2. The keyboard. The window in front first: out of focus the story pauses
    // (3b), and the weekly report this seeded profile is due opens over it.
    for (const other of require('electron').BrowserWindow.getAllWindows()) if (other !== win && other.getTitle() === 'Your week') other.close();
    await wait(300);
    win.focus();
    const playing = await until(() => wjs('!window.__wrapped.state().paused'), 3000);
    if (!playing) return report(false, `with the window in front the story is paused (focused=${win.isFocused()})`);
    const key = async (k) => { wc.sendInputEvent({ type: 'keyDown', keyCode: k }); wc.sendInputEvent({ type: 'keyUp', keyCode: k }); await wait(300); };
    await key('Right');
    const s1 = await wjs('window.__wrapped.state()');
    await key('Space');
    const s2 = await wjs('window.__wrapped.state()');
    await key('Left');
    const s3 = await wjs('window.__wrapped.state()');
    await key('P');
    const s4 = await wjs('window.__wrapped.state()');
    const frozen = await wjs("document.getAnimations().filter((a) => a.playState === 'running').length");
    await key('P');
    await key('M');
    const s5 = await wjs('window.__wrapped.state()');
    await key('M');
    lines.push(`keys: right ${s1.index}, space ${s2.index}, left ${s3.index}, P paused=${s4.paused} (running animations ${frozen}), M muted=${s5.muted}`);
    if (s1.index !== 1 || s2.index !== 2 || s3.index !== 1) return report(false, 'the arrows and Space do not move through the story');
    if (!s4.paused || frozen !== 0) return report(false, 'P does not pause the story, every animation with it');
    if (!s5.muted) return report(false, 'M does not mute');
    const focusInside = await wjs("document.activeElement === document.body || document.getElementById('wr').contains(document.activeElement)");
    if (!focusInside) return report(false, 'the keyboard is not in Wrapped');
    await key('Escape');
    const closed = await until(() => !mainWindow.wrappedState().open, 3000);
    lines.push(`Escape: closed=${!!closed} its page gone=${wc.isDestroyed()}`);
    if (!closed || !wc.isDestroyed()) return report(false, 'Escape did not close Wrapped and its page');

    // 3. Never again by itself.
    win.hide();
    await wait(300);
    win.show();
    win.focus();
    await wait(1800);
    win.minimize();
    await wait(300);
    win.restore();
    win.focus();
    await wait(1800);
    lines.push(`hidden and shown, minimised and restored: opened again=${mainWindow.wrappedState().open}`);
    if (mainWindow.wrappedState().open) return report(false, 'Wrapped opened by itself a second time');
    const home = await until(() => surfaces.find('/home/'), 6000);
    if (!home) return report(false, 'Home never loaded');
    const hjs = (s) => home.webContents.executeJavaScript(s);
    const invite = await until(() => hjs("(() => { const h = document.getElementById('h-wrapped'); return h && !h.hidden ? document.getElementById('h-wrapped-text').textContent + ' | ' + document.getElementById('h-wrapped-open').textContent : null; })()"), 5000);
    lines.push(`Home's invitation: "${invite}"`);
    if (!invite || !/Play your 2026 Wrapped$/.test(invite)) return report(false, 'Home shows no invitation in the window');
    // OCCLARA_SHOTS=1: Home with the invitation, and Profile's Your year, as a player sees them.
    if (process.env.OCCLARA_SHOTS === '1') {
      const { composite } = require('./fixtures/window-shot');
      const dir = path.join(REPO, 'dist-surface-shots');
      fs.mkdirSync(dir, { recursive: true });
      await wait(600);
      const homePic = await composite(mainWindow, win);
      if (homePic) { fs.writeFileSync(path.join(dir, 'main-home-wrapped.png'), homePic.png); lines.push('shot main-home-wrapped.png'); }
      mainWindow.show('profile');
      const prof = await until(() => surfaces.find('/profile/'), 6000);
      const shown = prof && await until(() => prof.webContents.executeJavaScript("(() => { const s = document.getElementById('pr-wrapped'); if (!s || s.hidden) return false; s.scrollIntoView({ block: 'center' }); return true; })()"), 6000);
      await wait(900);
      const profPic = shown ? await composite(mainWindow, win) : null;
      if (profPic) { fs.writeFileSync(path.join(dir, 'main-profile-wrapped.png'), profPic.png); lines.push('shot main-profile-wrapped.png'); }
      mainWindow.show('home');
      await wait(800);
    }
    await hjs("document.getElementById('h-wrapped-open').click()");
    const again = await until(() => mainWindow.wrappedState().open, 4000);
    lines.push(`opened from Home: ${!!again}`);
    if (!again) return report(false, 'Home\'s button did not open Wrapped');
    const wc2 = mainWindow.wrappedState().view.webContents;
    await until(() => wc2.executeJavaScript('window.__wrapped && window.__wrapped.state().ready'), 6000);

    // 3b. Out of focus it pauses, story and sound; the focus back resumes it.
    win.blur();
    const blurred = await until(() => wc2.executeJavaScript('window.__wrapped.state().paused && window.__wrapped.state()'), 3000);
    win.focus();
    const refocused = await until(() => wc2.executeJavaScript('!window.__wrapped.state().paused && window.__wrapped.state()'), 3000);
    lines.push(`out of focus: paused=${!!blurred} sound playing=${blurred && blurred.sound && blurred.sound.playing} | focus back: playing again=${!!refocused}`);
    if (!blurred || (blurred.sound && blurred.sound.playing)) return report(false, 'out of focus, the story or its sound played on');
    if (!refocused) return report(false, 'the focus back did not resume the story it had paused');

    // 3c. The auto open waits for Home: a new year's chance, given over Settings, does nothing until Home is shown.
    mainWindow.closeWrapped();
    store.set('wrappedAutoOpened', {});
    mainWindow.show('settings');
    await until(() => mainWindow.motionState().onScreen === 'settings', 4000);
    win.focus();
    await wait(1800);
    const overSettings = mainWindow.wrappedState().open;
    mainWindow.show('home');
    const onHome = await until(() => mainWindow.wrappedState().open, 5000);
    lines.push(`auto open over Settings=${overSettings}, then on Home=${!!onHome}`);
    if (overSettings) return report(false, 'Wrapped opened by itself over Settings');
    if (!onHome) return report(false, 'Home shown again did not give the auto open its chance');
    const wc2b = mainWindow.wrappedState().view.webContents;
    await until(() => wc2b.executeJavaScript('window.__wrapped && window.__wrapped.state().ready'), 6000);

    // 4. The seal. Recording starts with Wrapped up (the hotkey, the tray),
    // which holds the story still, then a match starts.
    const readersBefore = proof.readers.length;
    await shjs('window.occlara.startCoaching(), true');
    const started = await until(() => proof.readers.length > readersBefore && mainWindow.current().rec, 5000);
    const heldStill = started && await until(() => wc2b.executeJavaScript("document.documentElement.classList.contains('rec-still') && window.__wrapped.state().paused"), 3000);
    lines.push(`recording started with Wrapped up: recording=${!!started} the story held still=${!!heldStill}`);
    if (!started) return report(false, 'Start did not start recording again');
    if (!heldStill) return report(false, 'recording started and Wrapped\'s story played on');
    const reader = proof.readers[proof.readers.length - 1];
    if (!reader) return report(false, 'no reader to play a match with');
    reader.inLobby = false;
    const sealed = await until(() => mainWindow.current().sealed && !mainWindow.wrappedState().open, 3000);
    lines.push(`a match starts: sealed=${mainWindow.current().sealed} Wrapped open=${mainWindow.wrappedState().open} its page gone=${wc2b.isDestroyed()}`);
    if (!sealed || !(await until(() => wc2b.isDestroyed(), 3000))) return report(false, 'a match started and Wrapped stayed up');
    const askHome = await hjs('window.occlara.openWrapped(2026)');
    const entryMid = await hjs('window.occlara.getWrapped()');
    await wait(400);
    lines.push(`mid match: Home's ask ${JSON.stringify(askHome)}, entry ${JSON.stringify(entryMid)}, open=${mainWindow.wrappedState().open}`);
    if (!askHome || askHome.ok !== false || askHome.error !== 'match' || entryMid !== null || mainWindow.wrappedState().open) return report(false, 'mid match, Wrapped could be asked for');
    reader.inLobby = true;
    const lifted = await until(() => !mainWindow.current().sealed, 4000);
    win.focus();
    await wait(1600);
    lines.push(`the match over: unsealed=${!!lifted} Wrapped came back by itself=${mainWindow.wrappedState().open}`);
    if (!lifted) return report(false, 'the seal never lifted');
    if (mainWindow.wrappedState().open) return report(false, 'Wrapped came back by itself after the match');

    // 5. Sounds off: opened muted.
    store.set('sounds', false);
    await hjs('window.occlara.openWrapped(2026)');
    const wc3 = (await until(() => mainWindow.wrappedState().open && mainWindow.wrappedState().view, 4000)).webContents;
    const s6 = await until(() => wc3.executeJavaScript('window.__wrapped && window.__wrapped.state().ready && window.__wrapped.state()'), 6000);
    lines.push(`Sounds off: muted=${s6 && s6.muted} audible=${await wc3.executeJavaScript('window.WrappedSound.audible()')}`);
    if (!s6 || !s6.muted) return report(false, 'with Sounds off, Wrapped opened with sound');

    // 6. Less motion: the page loaded again under prefers-reduced-motion.
    wc3.debugger.attach('1.3');
    await wc3.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    wc3.reload();
    await wait(400);
    const s7 = await until(() => wc3.executeJavaScript('window.__wrapped && window.__wrapped.state().ready && window.__wrapped.state()'), 6000);
    await wait(1500);
    const loops = await wc3.executeJavaScript("document.getAnimations().filter((a) => a.playState === 'running' && a.effect && a.effect.getComputedTiming().iterations === Infinity).length");
    const glFrames = await wc3.executeJavaScript('(window.__wrapped.state().gl || { frames: 0 }).frames');
    const text = await wc3.executeJavaScript("document.getElementById('wr-stage').textContent.slice(0, 80)");
    lines.push(`less motion: reduced=${s7 && s7.reduced} looping animations=${loops} ground frames looped=${glFrames} reads "${text}"`);
    if (!s7 || !s7.reduced || loops !== 0 || glFrames !== 0 || !/2026/.test(text)) return report(false, 'under less motion, something still loops or the slide does not read');
    try { wc3.debugger.detach(); } catch { /* gone */ }
    mainWindow.closeWrapped();
    report(true, 'ok');
  } catch (e) {
    report(false, 'threw: ' + (e && e.stack || e));
  }
}, 2500);

require(path.join(REPO, 'src/main/index.js'));

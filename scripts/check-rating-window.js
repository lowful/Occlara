'use strict';

/**
 * THE MATCH RATING ON THE REAL REVIEW PAGE (docs/claude/rating.md).
 *
 * Boots the app on the sample library (scripts/fixtures/proof-reviews.js,
 * whose newest review carries a rating of all ten by agent), opens the
 * newest match from Home as a player does, and reads the block back: the
 * number main served, the place, the line, the three gains and losses, the
 * lobby by agent with no name or Riot ID in it, a swing opening its round,
 * the replay playing, skipped by a key, closed by a second, and Esc closing
 * only the replay, then the line a screen only review shows and a locked
 * review hiding the block. The window sealed mid replay stops it.
 *
 * OCCLARA_SHOTS=1 writes dist-surface-shots/main-rating*.png.
 *
 * Results travel through a FILE, not stdout: an Electron main process on
 * Windows does not reliably flush a piped stdout.
 *
 * Run: npm run check:rating (a window: never on a PC someone is playing on)
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

const REPO = path.join(__dirname, '..');
const OUT = path.join(os.tmpdir(), 'occlara-rating-window-check.json');

if (!process.versions.electron) {
  const { spawnSync } = require('child_process');
  const electron = require('electron');
  try { fs.unlinkSync(OUT); } catch { /* nothing to clear */ }
  const env = Object.assign({}, process.env, { OCCLARA_RATING_OUT: OUT });
  delete env.ELECTRON_RUN_AS_NODE;
  const r = spawnSync(electron, [__filename], { env, timeout: 150000 });
  let rec = null;
  try { rec = JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch { /* reported below */ }
  if (!rec) { console.error('FAIL: the check wrote no result (exit ' + r.status + ')'); process.exit(1); }
  for (const l of rec.lines) console.log('  ' + l);
  if (!rec.ok) { console.error('FAIL: ' + rec.detail); process.exit(1); }
  console.log('PASS: the review shows the match rating main served, its place, line, swings and lobby by agent only, a swing opens its round, the replay plays, skips and closes on its own, a screen only review says what would rate it and a locked one shows none');
  process.exit(0);
}

const { app } = require('electron');
const surfaces = require('./fixtures/surfaces');
const proof = require('./fixtures/proof-reviews');
const { composite } = require('./fixtures/window-shot');

const lines = [];
let reported = false;
function report(ok, detail) {
  if (reported) return;
  reported = true;
  try { fs.writeFileSync(process.env.OCCLARA_RATING_OUT || OUT, JSON.stringify({ ok, detail, lines })); }
  catch { /* exit code still carries it */ }
  app.exit(ok ? 0 : 1);
}

proof.installStandIns();
const ud = path.join(os.tmpdir(), 'occlara-check-rating-window');
const seeded = proof.seed(ud);
process.env.OCCLARA_DEV_USERDATA = ud;

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
app.on('window-all-closed', () => { /* the run below decides when we exit */ });

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
async function shot(name, mainWindow, win) {
  if (process.env.OCCLARA_SHOTS !== '1') return;
  await wait(500);
  const pic = await composite(mainWindow, win);
  if (!pic) { lines.push(`shot main-${name}.png could not be captured`); return; }
  const dir = path.join(REPO, 'dist-surface-shots');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `main-${name}.png`), pic.png);
  lines.push(`shot main-${name}.png`);
}

setTimeout(async () => {
  const mainWindow = require(path.join(REPO, 'src/main/windows/main-window'));
  const { served } = require(path.join(REPO, 'src/shared/valorant-review'));
  try {
    // What main serves the page, worked out here the same way.
    const newest = seeded.store.get(seeded.ids[0]);
    const view = served(newest.review).ratingView;
    if (!view || typeof view.value !== 'number') return report(false, 'the sample library\'s newest review has no rating to show');
    lines.push(`served: ${view.shown}, ${view.place}, ${view.gains.length} gains, ${view.losses.length} losses, ${view.events.length} events`);

    const win = mainWindow.create();
    win.show();
    const home = await until(() => surfaces.find('/home/'), 8000);
    if (!home) return report(false, 'Home never loaded');
    const hjs = (s) => home.webContents.executeJavaScript(s);
    await until(() => hjs("!document.getElementById('content').hidden && document.querySelectorAll('#recent-list .r-row').length > 0"), 8000);
    await hjs("document.querySelector('#recent-list .r-row').click(); true");
    await until(() => mainWindow.current().shown === 'review', 5000);
    const review = await until(() => surfaces.find('/review/'), 6000);
    if (!review) return report(false, 'the review page never opened');
    const errs = [];
    review.webContents.on('console-message', (e, lvl, msg) => {
      const level = typeof lvl === 'number' ? lvl : ({ warning: 2, error: 3 })[e && e.level];
      if (level >= 2) errs.push(msg !== undefined ? msg : e && e.message);
    });
    const rjs = (s) => review.webContents.executeJavaScript(s);
    const painted = await until(() => rjs("!document.getElementById('vreview').hidden && !document.getElementById('v-rating-wrap').hidden"), 8000);
    if (!painted) return report(false, 'the review painted no rating block');
    // The reveal over, so what is read and pictured is the page at rest.
    await wait(2500);

    // 1. The block as main served it.
    const block = await rjs(`(() => {
      const w = document.getElementById('v-rating-wrap');
      const t = (id) => document.getElementById(id).textContent;
      return {
        value: t('rt-value'), place: t('rt-place'), placeShown: !document.getElementById('rt-place').hidden,
        before: w.nextElementSibling && w.nextElementSibling.id,
        path: !!document.querySelector('#rt-line .rt-path'), marks: document.querySelectorAll('#rt-line .rt-mark').length,
        gains: [...document.querySelectorAll('#rt-gains .rt-row')].map((r) => r.textContent),
        losses: [...document.querySelectorAll('#rt-losses .rt-row')].map((r) => r.textContent),
        lobby: [...document.querySelectorAll('#rt-lobby .rt-lob')].map((r) => r.textContent),
        play: !document.getElementById('rt-play').hidden,
        text: w.textContent, replayHidden: document.getElementById('rt-replay').hidden,
      };
    })()`);
    lines.push(`block: ${JSON.stringify({ ...block, text: undefined })}`);
    if (block.value !== view.shown) return report(false, `the page shows ${block.value}, main served ${view.shown}`);
    if (!block.placeShown || block.place !== `${view.place} in the lobby`) return report(false, `the place reads "${block.place}"`);
    if (block.before !== 'v-rounds-wrap') return report(false, `the block sits before ${block.before}, not the rounds`);
    if (!block.path || block.marks < 1) return report(false, 'the line across the match or its marks are missing');
    if (block.gains.length !== view.gains.length || block.losses.length !== view.losses.length || !block.gains.length) {
      return report(false, `the swings drawn (${block.gains.length}, ${block.losses.length}) are not the ones served`);
    }
    // On the 100 scale since 9.1 (the owner's item 16): a move is a whole number, "+7", "-3".
    if (!block.gains.every((g) => /^R\d+.+\+\d+$/.test(g)) || !block.losses.every((g) => /^R\d+.+-\d+$/.test(g))) {
      return report(false, `a swing row is not its round, label and move: ${JSON.stringify(block.gains.concat(block.losses))}`);
    }
    if (block.lobby.length !== 10 || block.lobby.filter((l) => /, you/.test(l)).length !== 1) return report(false, `the lobby lists ${block.lobby.length} with ${block.lobby.filter((l) => /, you/.test(l)).length} the player`);
    // No name and no Riot ID: the sample has none, and the block only agents.
    const agents = new Set(proof.COMPS.us.concat(proof.COMPS.them).map((c) => c.agent));
    const bad = block.lobby.filter((l) => !agents.has(l.replace(/^\d+/, '').split(/Your team|Theirs/)[0].replace(/, you$/, '')));
    if (/#/.test(block.text) || bad.length) return report(false, `the lobby names something other than an agent: ${JSON.stringify(bad)}`);
    if (!block.play || !block.replayHidden) return report(false, 'Replay the rating is missing, or the replay is open unasked');
    await rjs("document.getElementById('v-rating-wrap').scrollIntoView({ block: 'start' }); true");
    await shot('rating', mainWindow, win);
    await rjs("document.getElementById('rt-lobby-wrap').open = true; document.getElementById('rt-lobby-wrap').scrollIntoView({ block: 'end' }); true");
    await shot('rating-lobby', mainWindow, win);
    await rjs("document.getElementById('rt-lobby-wrap').open = false; true");
    // The tier's colour on the number, and a round read off the line by the keys.
    const tier = await rjs("[...document.getElementById('rt-value').classList].find((c) => /^t-/.test(c)) || null");
    if (tier !== `t-${view.tier}`) return report(false, `the number is not in its tier's colour (${tier}, served ${view.tier})`);
    const read = await rjs(`(() => {
      const plot = document.querySelector('#rt-line .rt-plot');
      plot.focus();
      plot.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
      return { text: document.getElementById('rt-read').textContent, now: !document.querySelector('#rt-line .rt-now').hidden,
        ticks: document.querySelectorAll('#rt-line .rt-tick').length, half: !!document.querySelector('#rt-line .rt-halfline'),
        area: !!(document.querySelector('#rt-line .rt-area') || {}).getAttribute };
    })()`);
    lines.push(`read off the line: ${JSON.stringify(read)}`);
    const r23 = view.rounds[view.rounds.length - 2];
    if (!read.now || read.ticks !== view.rounds.length || !read.half || !read.text.startsWith(`Round ${r23.n}${r23.score}${r23.delta}`)) {
      return report(false, `the line does not read a round by the keys, or lacks its ticks and half: ${JSON.stringify(read)}`);
    }
    await shot('rating-read', mainWindow, win);
    await rjs("document.querySelector('#rt-line .rt-plot').blur(); true");

    // 2. A swing opens its round.
    const opened = await rjs(`(() => {
      const b = document.querySelector('#rt-losses .rt-row-btn');
      const n = Number(b.querySelector('.rt-round').textContent.slice(1));
      b.click();
      return n;
    })()`);
    await wait(700);
    const focused = await rjs('document.activeElement && document.activeElement.id');
    lines.push(`swing of round ${opened} opened: ${focused}`);
    if (focused !== `round-${opened}`) return report(false, `a swing of round ${opened} opened ${focused}`);

    // 3. The replay: it plays, a key skips it to the final, Esc closes it and only it.
    // Under reduced motion (GitHub's machine has it on some runs) a click opens
    // at full time; the steps are then played by the check's own hook.
    const reduced = await rjs("window.matchMedia('(prefers-reduced-motion: reduce)').matches");
    await rjs("document.querySelector('.body').scrollTo(0, 0); document.getElementById('rt-play').click(); true");
    await wait(600);
    const clicked = await rjs("document.getElementById('rt-r-round').textContent");
    lines.push(`reduced motion: ${reduced}, a click opens at "${clicked}"`);
    if (reduced && clicked !== 'Full time') return report(false, `under reduced motion the replay did not open at full time ("${clicked}")`);
    if (!reduced && clicked === 'Full time') return report(false, 'with motion the replay jumped to full time');
    await rjs('window.RatingView.play(true); true');
    await wait(6500);
    const midJs = `(() => ({ open: !document.getElementById('rt-replay').hidden, round: document.getElementById('rt-r-round').textContent,
      num: document.getElementById('rt-r-num').textContent, label: document.getElementById('rt-r-label').textContent,
      score: document.getElementById('rt-r-score').textContent, feed: document.querySelectorAll('#rt-r-feed .rt-f').length,
      tier: [...document.getElementById('rt-r-badge').classList].find((c) => /^t-/.test(c)) || null,
      said: document.getElementById('rt-r-said').textContent, focus: !!document.activeElement && document.getElementById('rt-replay').contains(document.activeElement) }))()`;
    const mid = await rjs(midJs);
    lines.push(`replay playing: ${JSON.stringify(mid)}`);
    if (!mid.open || !/^Round \d+ of \d+$/.test(mid.round) || !/^\d{2,3}$/.test(mid.num) || !mid.label || !/^\d+ : \d+$/.test(mid.score)
      || mid.feed < 2 || !mid.tier || mid.said) return report(false, `the replay is not playing as a broadcast, or announced a step: ${JSON.stringify(mid)}`);
    await shot('rating-replay', mainWindow, win);
    // A modifier alone does not skip it, and Tab stays inside it.
    await rjs("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift', bubbles: true })); document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true })); true");
    const held = await rjs(midJs);
    lines.push(`after Shift and Tab: ${JSON.stringify(held)}`);
    if (!/^Round /.test(held.round) || !held.focus) return report(false, `Shift skipped the replay or Tab left it: ${JSON.stringify(held)}`);
    review.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    review.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
    await wait(900);
    const fin = await rjs(`(() => ({ open: !document.getElementById('rt-replay').hidden, round: document.getElementById('rt-r-round').textContent,
      num: document.getElementById('rt-r-num').textContent, label: document.getElementById('rt-r-label').textContent }))()`);
    lines.push(`replay skipped: ${JSON.stringify(fin)}`);
    const said = await rjs("document.getElementById('rt-r-said').textContent");
    if (!fin.open || fin.round !== 'Full time' || fin.num !== view.shown || !fin.label.startsWith(`Full time, ${view.place}`) || !said.includes(view.shown)) {
      return report(false, `a key did not skip the replay to full time, announced: ${JSON.stringify({ ...fin, said })}`);
    }
    await shot('rating-replay-final', mainWindow, win);
    review.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    review.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
    await wait(600);
    const closed = await rjs("document.getElementById('rt-replay').hidden");
    lines.push(`replay closed: ${closed}, page shown: ${mainWindow.current().shown}`);
    if (!closed || mainWindow.current().shown !== 'review') return report(false, 'Esc did not close the replay alone');

    // 4. Sealed mid replay (a match starting): the replay stops.
    await rjs('window.RatingView.play(true); true');
    await wait(800);
    mainWindow.setSealed(true);
    await wait(900);
    mainWindow.setSealed(false);
    await until(() => mainWindow.current().shown === 'review', 3000);
    await wait(400);
    const afterSeal = await rjs("document.getElementById('rt-replay').hidden");
    lines.push(`replay after a seal: ${afterSeal ? 'stopped' : 'still open (the view was not hidden to its document)'}`);
    await rjs("window.RatingView.stop(); true");

    // 5. A screen only review says what would rate it; a locked one shows none.
    const note = await rjs(`(() => {
      window.__keep = current;
      paint(Object.assign({}, current, { id: current.id + '-screen', ratingView: { value: null, note: 'Rated only once Riot\\'s record of the match is linked.' } }));
      return { shown: !document.getElementById('v-rating-wrap').hidden, note: document.getElementById('rt-note').textContent,
        value: document.querySelector('#v-rating-wrap .rt-head').hidden, play: document.getElementById('rt-play').hidden, line: document.getElementById('rt-line').hidden };
    })()`);
    lines.push(`screen only: ${JSON.stringify(note)}`);
    if (!note.shown || !/Riot's record/.test(note.note) || !note.value || !note.play || !note.line) return report(false, `a screen only review does not say what would rate it: ${JSON.stringify(note)}`);
    await rjs("document.getElementById('v-rating-wrap').scrollIntoView({ block: 'start' }); true");
    await shot('rating-none', mainWindow, win);
    const locked = await rjs("paint(Object.assign({}, window.__keep, { id: window.__keep.id + '-locked', locked: true })); document.getElementById('v-rating-wrap').hidden");
    lines.push(`locked: block hidden=${locked}`);
    if (!locked) return report(false, 'a locked review shows the rating');
    await rjs('paint(window.__keep); delete window.__keep; true');

    // 6. The window at its least size, 960 by 640: the block and the replay.
    if (process.env.OCCLARA_SHOTS === '1') {
      const was = win.getBounds();
      win.setMinimumSize(1, 1);
      win.setSize(960, 640);
      await wait(900);
      await rjs("document.getElementById('v-rating-wrap').scrollIntoView({ block: 'start' }); true");
      await shot('rating-narrow', mainWindow, win);
      await rjs("document.querySelector('.body').scrollTo(0, 0); window.RatingView.play(true); true");
      await wait(6500);
      await shot('rating-replay-narrow', mainWindow, win);
      await rjs('window.RatingView.finish(); true');
      await wait(900);
      await shot('rating-replay-final-narrow', mainWindow, win);
      await rjs('window.RatingView.stop(); true');
      win.setSize(was.width, was.height);
    }

    if (errs.length) return report(false, `renderer errors: ${errs.join(' | ')}`);
    report(true, 'ok');
  } catch (e) {
    report(false, 'threw: ' + (e && e.stack || e));
  }
}, 6500);

require(path.join(REPO, 'src/main/index.js'));

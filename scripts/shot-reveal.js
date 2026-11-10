'use strict';

/*
 * Pictures of the games reveal (8.10.4): each look at six moments of its
 * timeline, written to dist-surface-shots/ as reveal-<look>-<ms>.png and
 * gathered into reveal-sheet.png. The real page (src/renderer/toast) over a
 * stand-in page, no main window needed.
 *
 *   env -u ELECTRON_RUN_AS_NODE npx electron scripts/shot-reveal.js
 */

const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const { words } = require('../src/main/services/games-toast');

const OUT = path.join(__dirname, '..', 'dist-surface-shots');
const TIMES = [150, 600, 1000, 1300, 1800, 2600];
const LOOKS = [
  { name: 'gift-invite', ev: { kind: 'invite', n: 4 } },
  { name: 'gift-pro', ev: { kind: 'gift', n: 25, tier: 'pro', from: 'Sam' } },
  { name: 'plan-pro', ev: { kind: 'plan', n: 25, tier: 'pro' } },
  { name: 'plan-max', ev: { kind: 'plan', n: 70, tier: 'max' } },
];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
app.disableHardwareAcceleration();
app.whenReady().then(async () => {
 try {
  fs.mkdirSync(OUT, { recursive: true });
  const files = [];
  const win = new BrowserWindow({
    width: 1200, height: 780, show: false, frame: false, opacity: 0, focusable: false, skipTaskbar: true, backgroundColor: '#10131A',
    webPreferences: { preload: path.join(__dirname, 'fixtures', 'reveal-preload.js'), contextIsolation: true, backgroundThrottling: false },
  });
  await win.loadFile(path.join(__dirname, '..', 'src', 'renderer', 'toast', 'index.html'));
  win.setIgnoreMouseEvents(true);
  win.showInactive();
  for (const look of LOOKS) {
    const w = words(look.ev);
    const t0 = Date.now();
    win.webContents.send('reveal-push', { toast: { id: look.name + Date.now(), kind: look.ev.kind, ...w } });
    for (const ms of TIMES) {
      await wait(Math.max(0, ms - (Date.now() - t0)));
      const img = await win.webContents.capturePage();
      const file = path.join(OUT, `reveal-${look.name}-${ms}.png`);
      fs.writeFileSync(file, img.toPNG());
      files.push({ file, label: `${look.name} ${ms} ms` });
    }
    win.webContents.send('reveal-push', { clear: true });
    await wait(200);
  }
  // One sheet of all of them, three to a row.
  const html = `<!doctype html><meta charset="utf-8"><body style="margin:0;background:#000;display:grid;grid-template-columns:repeat(6,400px);gap:6px;padding:6px;font:12px sans-serif;color:#fff">${
    files.map((f) => `<figure style="margin:0"><img src="file:///${f.file.replace(/\\/g, '/')}" width="400" height="260"><figcaption>${f.label}</figcaption></figure>`).join('')}</body>`;
  const sheetHtml = path.join(OUT, 'reveal-sheet.html');
  fs.writeFileSync(sheetHtml, html);
  const sheet = new BrowserWindow({ width: 2460, height: 1240, show: false, frame: false, opacity: 0, focusable: false, skipTaskbar: true });
  await sheet.loadFile(sheetHtml);
  sheet.setIgnoreMouseEvents(true);
  sheet.showInactive();
  await wait(600);
  fs.writeFileSync(path.join(OUT, 'reveal-sheet.png'), (await sheet.webContents.capturePage()).toPNG());
  console.log('wrote', files.length, 'frames and reveal-sheet.png to', OUT);
  app.quit();
 } catch (e) { console.error('shot-reveal failed:', e && e.stack || e); app.exit(1); }
});

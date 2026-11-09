'use strict';

/**
 * THE ONE WINDOW, PICTURED AS A PLAYER SEES IT. The shell and the page are
 * two webContents, so each is captured and the page is drawn over the shell
 * at the sidebar's edge. Shared by check:mainwindow (OCCLARA_SHOTS=1, to
 * dist-surface-shots/main-<name>.png) and scripts/export-site-proof.js, so
 * the website's pictures are taken by the machinery the check uses.
 *
 * `verify` asks for a picture that is settled and not blank: the shell and
 * the page are captured twice, a beat apart, and taken only when both pairs
 * are the same bytes (a reveal still counting, a row still rising or a thumb
 * still sliding gives two different frames), up to `tries` times; and the
 * composite must hold ink, some share of pixels that is not the ground.
 *
 * Runs in the Electron main process only.
 */

const { BrowserWindow } = require('electron');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function capture(wc) {
  for (let i = 0; i < 5; i++) {
    try { return await wc.capturePage(); } catch { await wait(500); }
  }
  return null;
}

/** The shell and the page on screen, as images, or null when either could not be captured. */
async function pair(mainWindow, win) {
  const shellImg = await capture(win.webContents);
  const s = mainWindow.current().shown;
  const v = s && mainWindow.pageViews().get(s);
  const pageImg = v ? await capture(v.webContents) : null;
  if (!shellImg || (v && !pageImg)) return null;
  // The account menu (8.9.1), a view of its own over the page while open.
  const m = typeof mainWindow.menuState === 'function' ? mainWindow.menuState() : null;
  const menuImg = m && m.open && m.view ? await capture(m.view.webContents) : null;
  // The games toast (8.9.1), a view of its own at the top right while one is up.
  const t = typeof mainWindow.toastState === 'function' ? mainWindow.toastState() : null;
  const toastImg = t && t.shown && t.view ? await capture(t.view.webContents) : null;
  return { shellImg, pageImg, menuImg, menuAt: menuImg ? m.bounds : null, toastImg, toastAt: toastImg ? t.bounds : null };
}

const sameImage = (a, b) => (!a && !b) || (!!a && !!b && a.toBitmap().equals(b.toBitmap()));

/**
 * One picture of the window: { png: Buffer, width, height, ink, settled }.
 * @param opts.verify   settle and ink checks (above); off, the first capture is taken
 * @param opts.beat     ms between the two captures of a settle check (350)
 * @param opts.tries    settle attempts before the last capture is taken (8)
 * @param opts.minInk   the least share of pixels that are not the ground (0.015)
 */
async function composite(mainWindow, win, opts) {
  const o = opts || {};
  let shot = await pair(mainWindow, win);
  let settled = !o.verify;
  if (o.verify) {
    const tries = o.tries || 8;
    for (let i = 0; i < tries && shot; i++) {
      await wait(o.beat || 350);
      const again = await pair(mainWindow, win);
      if (again && sameImage(shot.shellImg, again.shellImg) && sameImage(shot.pageImg, again.pageImg)) { settled = true; break; }
      shot = again;
    }
  }
  if (!shot) return null;
  const { shellImg, pageImg, menuImg, menuAt, toastImg, toastAt } = shot;
  const scale = shellImg.getSize().width / win.getContentSize()[0];
  const comp = new BrowserWindow({ show: false, width: 200, height: 200 });
  try {
    await comp.loadURL('data:text/html,<canvas id="c"></canvas>');
    const out = await comp.webContents.executeJavaScript(`(async () => {
      const load = (src) => new Promise((r) => { const i = new Image(); i.onload = () => r(i); i.src = src; });
      const a = await load(${JSON.stringify(shellImg.toDataURL())});
      const c = document.getElementById('c'); c.width = a.width; c.height = a.height;
      const g = c.getContext('2d'); g.drawImage(a, 0, 0);
      ${pageImg ? `const b = await load(${JSON.stringify(pageImg.toDataURL())});
      g.drawImage(b, ${Math.round(mainWindow.SIDEBAR_W * scale)}, ${Math.round(mainWindow.TOP_H * scale)});` : ''}
      ${toastImg ? `const ti = await load(${JSON.stringify(toastImg.toDataURL())});
      g.drawImage(ti, ${Math.round(toastAt.x * scale)}, ${Math.round(toastAt.y * scale)});` : ''}
      ${menuImg ? `const mi = await load(${JSON.stringify(menuImg.toDataURL())});
      g.drawImage(mi, ${Math.round(menuAt.x * scale)}, ${Math.round(menuAt.y * scale)});` : ''}
      // The ink: the share of pixels brighter than the ground, read off a small copy.
      const s = document.createElement('canvas'); s.width = 256; s.height = Math.max(1, Math.round(256 * c.height / c.width));
      const sg = s.getContext('2d'); sg.drawImage(c, 0, 0, s.width, s.height);
      const d = sg.getImageData(0, 0, s.width, s.height).data;
      let ink = 0;
      for (let i = 0; i < d.length; i += 4) if (Math.max(d[i], d[i + 1], d[i + 2]) > 40) ink++;
      return { data: c.toDataURL('image/png'), width: c.width, height: c.height, ink: ink / (d.length / 4) };
    })()`);
    return { png: Buffer.from(String(out.data).split(',')[1], 'base64'), width: out.width, height: out.height, ink: out.ink, settled,
      blank: out.ink < (o.minInk === undefined ? 0.015 : o.minInk) };
  } finally {
    comp.destroy();
  }
}

module.exports = { composite, capture, wait };

'use strict';

const { BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const C = require('../../shared/channels');
const registry = require('./registry');

/**
 * THE FRAMES PAGE, IN A WINDOW NOBODY SEES (8.3.1).
 *
 * The look at a death takes its stills from the clip of it (src/shared/
 * clip-frames.js), and a clip is decoded in a page: this one. Created with
 * show false and never shown, not in the taskbar, not focusable, no frame, as
 * the recorder's page is (recorder-window.js), with backgroundThrottling off
 * so nothing it waits on is slowed for a page Chromium cannot see. Loaded
 * from a file: WebCodecs is for a secure context, and a data: URL is not one
 * (measured: VideoDecoder is not defined there). Context isolation on, the
 * preload hands the page two calls; sandbox off only so the preload can read
 * the shared channel names, as every other preload here does.
 *
 * OPENED FOR A REVIEW'S LOOK AND CLOSED AFTER IT (lookFrames in index.js):
 * nothing of it is left running between matches, and it is never opened while
 * one is being played.
 *
 * Only that page's own replies reach its handle, checked against the sender.
 */
const READY_MS = 15000;
const JOB_MS = 30000;

function open() {
  return new Promise((resolve, reject) => {
    const win = new BrowserWindow({
      show: false,
      width: 320,
      height: 180,
      frame: false,
      skipTaskbar: true,
      focusable: false,
      resizable: false,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        backgroundThrottling: false,
        preload: path.join(__dirname, '../../preload/frames-preload.js'),
      },
    });
    const wcId = win.webContents.id;
    const waiting = new Map();
    let ready = false;
    let seq = 0;

    const failAll = (why) => {
      for (const [, w] of waiting) { clearTimeout(w.timer); w.resolve({ ok: false, frames: [], error: why }); }
      waiting.clear();
    };
    const handle = {
      /** One decode job (clip-frames.js decodeJob, plus the stills' size): resolves with the page's answer, never rejects. */
      decode(job) {
        return new Promise((done) => {
          if (win.isDestroyed()) { done({ ok: false, frames: [], error: 'the frames page is closed' }); return; }
          const id = ++seq;
          const timer = setTimeout(() => {
            waiting.delete(id);
            done({ ok: false, frames: [], error: `no answer within ${JOB_MS / 1000} s` });
          }, JOB_MS);
          waiting.set(id, { resolve: done, timer });
          win.webContents.send(C.PUSH_FRAMES, { ...job, id });
        });
      },
      close() {
        failAll('closed');
        if (!win.isDestroyed()) win.destroy();
      },
    };

    const onReply = (e, msg) => {
      if (!e || !e.sender || e.sender.id !== wcId || !msg) return;
      if (msg.type === 'ready') {
        if (!ready) { ready = true; clearTimeout(timer); resolve(handle); }
        return;
      }
      const w = waiting.get(msg.id);
      if (!w) return;
      waiting.delete(msg.id);
      clearTimeout(w.timer);
      w.resolve(msg);
    };
    ipcMain.on(C.FRAMES_REPLY, onReply);

    const timer = setTimeout(() => {
      if (ready) return;
      if (!win.isDestroyed()) win.destroy();
      reject(new Error('the frames page was not ready within ' + READY_MS / 1000 + ' s'));
    }, READY_MS);

    win.webContents.on('render-process-gone', () => failAll('the frames page went away'));
    win.on('closed', () => {
      ipcMain.removeListener(C.FRAMES_REPLY, onReply);
      clearTimeout(timer);
      failAll('closed');
      if (!ready) reject(new Error('the frames page closed before it was ready'));
    });

    // Its console reaches debug.log, as every surface's does.
    registry.register('frames', win);
    win.loadFile(path.join(__dirname, '../../renderer/frames/index.html')).catch((e) => {
      if (ready) return;
      if (!win.isDestroyed()) win.destroy();
      reject(e);
    });
  });
}

module.exports = { open, JOB_MS };

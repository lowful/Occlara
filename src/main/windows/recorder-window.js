'use strict';

const { app, BrowserWindow, desktopCapturer, ipcMain, screen } = require('electron');
const os = require('os');
const path = require('path');
const C = require('../../shared/channels');
const registry = require('./registry');

/**
 * THE RECORDER'S PAGE, IN A WINDOW NOBODY SEES (8.3).
 *
 * Created with show false and never shown: not in the taskbar, not focusable,
 * no frame, nothing in it to paint. backgroundThrottling is off, or Chromium
 * would slow the timers of a page it cannot see, and those timers are the
 * capture's once a second health and the read's frame. Context isolation is
 * on and the preload hands the page four calls and nothing else; sandbox is
 * off only so the preload can read the shared channel names, as every other
 * preload here does.
 *
 * A NEW PAGE FOR EACH RECORDING. open() resolves once the page has said it is
 * ready, and the handle's close() destroys the window, so a recording stopped
 * leaves no capture and no page behind it (the spike watched a page's memory
 * climb in a sawtooth over minutes; a fresh one each session starts low).
 *
 * Only that page's own messages reach its handle: every message is checked
 * against the sender, so no other page can feed the recorder a chunk.
 */
const READY_MS = 15000;

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
        preload: path.join(__dirname, '../../preload/recorder-preload.js'),
      },
    });
    const wcId = win.webContents.id;
    let listener = null;
    let ready = false;
    let closing = false;

    const handle = {
      send(msg) { if (!win.isDestroyed()) win.webContents.send(C.PUSH_RECORDER, msg); },
      pid() {
        try { return win.isDestroyed() ? null : win.webContents.getOSProcessId(); } catch { return null; }
      },
      close() {
        closing = true;
        if (!win.isDestroyed()) win.destroy();
      },
      onMessage(fn) { listener = typeof fn === 'function' ? fn : null; },
    };

    const from = (kind) => (e, msg) => {
      if (!e || !e.sender || e.sender.id !== wcId) return;
      if (kind === 'status' && msg && msg.type === 'ready') {
        if (!ready) { ready = true; clearTimeout(timer); resolve(handle); }
        return;
      }
      if (listener) listener(kind, msg);
    };
    const onChunk = from('chunk');
    const onStatus = from('status');
    const onReply = from('reply');
    ipcMain.on(C.RECORDER_CHUNK, onChunk);
    ipcMain.on(C.RECORDER_STATUS, onStatus);
    ipcMain.on(C.RECORDER_REPLY, onReply);

    const timer = setTimeout(() => {
      if (ready) return;
      if (!win.isDestroyed()) win.destroy();
      reject(new Error('the recorder page was not ready within ' + READY_MS / 1000 + ' s'));
    }, READY_MS);

    win.webContents.on('render-process-gone', (_e, d) => {
      if (listener && !closing) listener('gone', { why: d && d.reason });
    });
    win.on('closed', () => {
      ipcMain.removeListener(C.RECORDER_CHUNK, onChunk);
      ipcMain.removeListener(C.RECORDER_STATUS, onStatus);
      ipcMain.removeListener(C.RECORDER_REPLY, onReply);
      clearTimeout(timer);
      if (!ready) reject(new Error('the recorder page closed before it was ready'));
      else if (listener && !closing) listener('gone', { why: 'closed' });
    });

    // Its console reaches debug.log, as every surface's does.
    registry.register('recorder', win);
    win.loadFile(path.join(__dirname, '../../renderer/recorder/index.html')).catch((e) => {
      if (ready) return;
      if (!win.isDestroyed()) win.destroy();
      reject(e);
    });
  });
}

/**
 * The primary display's capture source, matched on its display_id, its id
 * (`displayId`, which the recorder holds the recording to: recorder.js
 * displaysChanged) and its size in physical pixels. GDI reads the primary
 * display, so the recording and the read are the same screen. With no match,
 * one screen only stands in, since it can only be that one; with several and
 * no match, null, never another screen in its place.
 */
async function primarySource() {
  const display = screen.getPrimaryDisplay();
  const physical = {
    width: Math.round(display.size.width * display.scaleFactor),
    height: Math.round(display.size.height * display.scaleFactor),
  };
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } });
  const match = sources.find((s) => String(s.display_id) === String(display.id))
    || (sources.length === 1 && screen.getAllDisplays().length === 1 ? sources[0] : null);
  return match ? { sourceId: match.id, displayId: display.id, display: physical } : null;
}

function cpuTimes() {
  let idle = 0;
  let total = 0;
  for (const c of os.cpus()) {
    const t = c.times;
    idle += t.idle;
    total += t.user + t.nice + t.sys + t.idle + t.irq;
  }
  return { idle, total };
}

/**
 * What the recorder costs, sampled once a second: the page's process in % of
 * ONE core, the whole machine in %, and the page's memory in MB.
 *
 * percentCPUUsage is per process since the last call, and in Electron 41 it
 * is ALREADY DIVIDED BY THE CORE COUNT: one core kept busy for two seconds
 * read 6.24 on a 16 thread machine, and Windows' own counters matched the
 * reading times 16 to within 2 points (the 8.3 spike). So it is multiplied
 * back, and 100 is one whole core.
 */
function createMetrics() {
  const cores = os.cpus().length || 1;
  let prev = cpuTimes();
  return (pid) => {
    const now = cpuTimes();
    const dt = now.total - prev.total;
    const systemCpu = dt > 0 ? Math.max(0, Math.min(100, 100 * (1 - (now.idle - prev.idle) / dt))) : null;
    prev = now;
    let recorderCpu = null;
    let memoryMB = null;
    if (pid) {
      const m = app.getAppMetrics().find((x) => x.pid === pid);
      if (m && m.cpu) recorderCpu = (m.cpu.percentCPUUsage || 0) * cores;
      if (m && m.memory) memoryMB = Math.round((m.memory.privateBytes || m.memory.workingSetSize || 0) / 1024);
    }
    return { recorderCpu, systemCpu, memoryMB };
  };
}

module.exports = { open, primarySource, createMetrics };

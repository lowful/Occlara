'use strict';

// A stand-in for toast-preload.js, for scripts/shot-reveal.js only: the same
// three members of window.occlaraToast, fed by the script over one channel.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('occlaraToast', {
  onToast: (cb) => { ipcRenderer.on('reveal-push', (_e, payload) => cb(payload)); return () => {}; },
  done: (id) => ipcRenderer.send('reveal-act', { done: String(id || '') }),
  open: (id) => ipcRenderer.send('reveal-act', { open: String(id || '') }),
});

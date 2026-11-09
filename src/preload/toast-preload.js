'use strict';

const { contextBridge, ipcRenderer } = require('electron');
const C = require('../shared/channels');

/**
 * Bridge for the games toast's own view (8.9.1, main-window.js toast): a
 * see-through view at the top right over the page, showing "You got 2 games"
 * one at a time. It draws what main sends and says when one is done or was
 * clicked. It can open no page itself, read no config and send nothing else:
 * main opens Profile for a click, and only while nothing is sealed.
 */
contextBridge.exposeInMainWorld('occlaraToast', {
  onToast: (cb) => {
    const h = (_e, payload) => cb(payload);
    ipcRenderer.on(C.PUSH_TOAST, h);
    return () => ipcRenderer.removeListener(C.PUSH_TOAST, h);
  },
  done: (id) => ipcRenderer.send(C.TOAST_ACT, { done: String(id || '') }),
  open: (id) => ipcRenderer.send(C.TOAST_ACT, { open: String(id || '') }),
});

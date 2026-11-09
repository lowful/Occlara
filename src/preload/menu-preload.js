'use strict';

const { contextBridge, ipcRenderer } = require('electron');
const C = require('../shared/channels');

/**
 * Bridge for the account menu's own view (8.9.1, main-window.js openMenu): a
 * see-through view laid over the page while the avatar's menu is open. It
 * draws what the shell sends and says what was chosen. It can open no page,
 * read no config and send nothing else: the shell, which owns the menu,
 * carries a choice out on its own rows, with the seal's locks they have.
 */
contextBridge.exposeInMainWorld('occlaraMenu', {
  onMenu: (cb) => {
    const h = (_e, payload) => cb(payload);
    ipcRenderer.on(C.PUSH_MENU, h);
    return () => ipcRenderer.removeListener(C.PUSH_MENU, h);
  },
  choose: (id) => ipcRenderer.send(C.MENU_ACT, { choose: String(id || '') }),
  close: (refocus) => ipcRenderer.send(C.MENU_ACT, { close: true, refocus: !!refocus }),
});

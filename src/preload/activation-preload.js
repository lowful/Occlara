'use strict';

const { contextBridge, ipcRenderer } = require('electron');
const C = require('../shared/channels');
const I18N = require('../shared/i18n');

/**
 * The Sign in window's bridge (8.7): sign in through the browser, or submit a
 * licence key, the old form kept behind "Use a licence key".
 */
contextBridge.exposeInMainWorld('occlara', {
  // i18n: the catalogue is required here (preloads have Node) and handed to the
  // renderer as a plain translator, so no surface needs Node access to be
  // translated. Read at call time, so a language change repaints correctly.
  i18n: {
    languages: () => I18N.LANGUAGES,
    t: (code, key) => I18N.t(code, key),
    hasUi: (code) => I18N.hasUi(code),
  },

  activate:     (key) => ipcRenderer.invoke(C.LICENSE_ACTIVATE, key),
  openPurchase: () => ipcRenderer.send(C.OPEN_PURCHASE, 'signup'),
  quit:         () => ipcRenderer.send(C.APP_QUIT),

  // Sign in (8.7): the browser flow, its Cancel, and "Create a free account"
  // (occlara.app/signup, the same page openPurchase opens). signIn resolves
  // once the flow ends: { ok: true, account } (main then closes this window
  // and opens the app) or { ok: false, error: 'cancelled' | 'timeout' |
  // 'refused' | 'unreachable' | 'browser' | 'listen' }.
  signIn:       () => ipcRenderer.invoke(C.ACCOUNT_SIGNIN),
  cancelSignIn: () => ipcRenderer.send(C.ACCOUNT_SIGNIN_CANCEL),
  openSignup:   () => ipcRenderer.send(C.OPEN_PURCHASE, 'signup'),
  getAccount:   () => ipcRenderer.invoke(C.ACCOUNT_GET),
  onAccount:    (cb) => {
    const h = (_e, v) => cb(v);
    ipcRenderer.on(C.ACCOUNT_CHANGED, h);
    return () => ipcRenderer.removeListener(C.ACCOUNT_CHANGED, h);
  },
});

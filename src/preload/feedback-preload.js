'use strict';

const { contextBridge, ipcRenderer } = require('electron');
const C = require('../shared/channels');
const { pageMotion } = require('./page-motion');

/**
 * Bridge for the Report a problem page (src/renderer/feedback/,
 * docs/claude/feedback.md). The page writes the words and picks the
 * pictures; main checks each picture, downscales it and recompresses it, and
 * sends the report with the account's own auth. Every answer carries main's
 * finished sentence (`said`), so the page only paints. Main refuses all four
 * mid match or sealed, and the seal hides the page then.
 */
contextBridge.exposeInMainWorld('occlara', {
  // Moving between pages (shared/embed.js).
  ...pageMotion(ipcRenderer),
  /** What a report carries, for the page's note, or null mid match. */
  info:    () => ipcRenderer.invoke(C.FEEDBACK_INFO),
  /** One picture: { type, size, bytes (ArrayBuffer) } -> { ok, token, preview } | { ok: false, error }. */
  prepare: (file) => ipcRenderer.invoke(C.FEEDBACK_PREPARE, file),
  drop:    (token) => ipcRenderer.invoke(C.FEEDBACK_DROP, token),
  /** { kind, text, tokens, withReview } -> { ok, id, said } | { ok: false, error, said }. */
  send:    (report) => ipcRenderer.invoke(C.FEEDBACK_SEND, report),
  go:      (page) => ipcRenderer.send(C.SHELL_NAV, page),
});

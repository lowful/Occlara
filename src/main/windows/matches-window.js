'use strict';

const { BrowserWindow } = require('electron');
const path = require('path');
const registry = require('./registry');

/**
 * The match library: every reviewed match, for every game, and what keeps
 * repeating across them.
 *
 * It replaced the tip history. With nothing shown during a match there are no
 * tips to look back on, and the review of each match is the record worth
 * keeping. Opening a row opens that review in the review window.
 */
function open() {
  const existing = registry.get('matches');
  if (existing) { existing.show(); existing.focus(); return existing; }

  const win = new BrowserWindow({
    width:  760,
    height: 720,
    minWidth:  560,
    minHeight: 520,
    frame:       false,
    resizable:   true,
    transparent: true,
    center:      true,
    skipTaskbar: false,
    show:        false,
    backgroundColor: '#00000000',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration:  false,
      sandbox:          false, // false so the preload can require the shared modules
      preload: path.join(__dirname, '../../preload/matches-preload.js'),
    },
  });

  win.loadFile(path.join(__dirname, '../../renderer/matches/index.html'));
  win.once('ready-to-show', () => win.show());

  registry.register('matches', win);
  return win;
}

function get() { return registry.get('matches'); }

function close() {
  const win = registry.get('matches');
  if (win) win.close();
}

module.exports = { open, get, close };

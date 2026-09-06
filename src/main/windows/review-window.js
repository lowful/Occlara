'use strict';

const { BrowserWindow } = require('electron');
const path = require('path');
const registry = require('./registry');

/**
 * The post-game League review.
 *
 * Opens ONLY when a recorded game has finished, never during one. Nothing about
 * League reaches the player mid match, by design: Riot's policy bans overlays
 * that hand over game-session information the player did not already have, and
 * names coaching "game over game" as the legitimate alternative.
 *
 * Resizable, because the length of a review depends on how much actually
 * happened in the game.
 */
function open() {
  const existing = registry.get('review');
  if (existing) { existing.focus(); return existing; }

  const win = new BrowserWindow({
    width:  560,
    height: 720,
    minWidth:  460,
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
      preload: path.join(__dirname, '../../preload/review-preload.js'),
    },
  });

  win.loadFile(path.join(__dirname, '../../renderer/review/index.html'));
  win.once('ready-to-show', () => win.show());

  registry.register('review', win);
  return win;
}

function get() { return registry.get('review'); }

function close() {
  const win = registry.get('review');
  if (win) win.close();
}

module.exports = { open, get, close };

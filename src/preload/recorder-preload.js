'use strict';

const { contextBridge, ipcRenderer } = require('electron');
const C = require('../shared/channels');

/**
 * The match recorder's page (src/renderer/recorder): main's commands in, and
 * the recording, its health and its answers out. Nothing else crosses: the
 * page has no other channel to listen on and none to send on, and it has no
 * Node of its own. A chunk's bytes cross as an ArrayBuffer, copied once into
 * this world and once more over IPC, a few hundred KB a second.
 */
contextBridge.exposeInMainWorld('occlaraRecorder', {
  onCommand: (cb) => { ipcRenderer.on(C.PUSH_RECORDER, (_e, cmd) => cb(cmd)); },
  status: (msg) => ipcRenderer.send(C.RECORDER_STATUS, msg),
  chunk: (msg) => ipcRenderer.send(C.RECORDER_CHUNK, msg),
  reply: (msg) => ipcRenderer.send(C.RECORDER_REPLY, msg),
});

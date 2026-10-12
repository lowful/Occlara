'use strict';

const { contextBridge, ipcRenderer } = require('electron');
const C = require('../shared/channels');

/**
 * The frames page (src/renderer/frames, 8.3.1): a clip's frames in from main,
 * the stills of them out, and nothing else. The page has no Node, no other
 * channel to listen on and none to send on. The encoded frames cross as typed
 * arrays, a megabyte or so a death, and each still back as an ArrayBuffer.
 */
contextBridge.exposeInMainWorld('occlaraFrames', {
  onJob: (cb) => { ipcRenderer.on(C.PUSH_FRAMES, (_e, job) => cb(job)); },
  reply: (msg) => ipcRenderer.send(C.FRAMES_REPLY, msg),
});

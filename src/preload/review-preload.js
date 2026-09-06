'use strict';

const { contextBridge, ipcRenderer } = require('electron');
const C = require('../shared/channels');

/**
 * Bridge for the post-game review.
 *
 * Read only by design: this surface reports what a finished game contained and
 * has nothing to command. The one write is opening a lesson, which is a window
 * request rather than a change to anything.
 */
contextBridge.exposeInMainWorld('occlara', {
  // The window can be opened by the push OR by hand later, so it can always ask
  // for the last review rather than depending on having caught the event.
  getReview: () => ipcRenderer.invoke(C.LOL_REVIEW_GET),
  onReview:  (cb) => {
    const h = (_e, r) => cb(r);
    ipcRenderer.on(C.PUSH_LOL_REVIEW, h);
    return () => ipcRenderer.removeListener(C.PUSH_LOL_REVIEW, h);
  },
  openLearn: () => ipcRenderer.send(C.OPEN_LEARN),
  close:     () => window.close(),
});

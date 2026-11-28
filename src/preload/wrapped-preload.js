'use strict';

const { contextBridge, ipcRenderer } = require('electron');
const C = require('../shared/channels');
const { iconOf, mapArtOf } = require('../shared/agent-icons');
const { killIcon } = require('../shared/kit-icons');

/**
 * Bridge for Occlara Wrapped's own view (docs/claude/wrapped.md): a view over
 * the whole window, made for one showing and closed after it. The page asks
 * main for the year's story (null mid match or sealed, and then it draws
 * nothing), hears a pause when the window is hidden, and says when the player
 * closed it. It can open no page, read no config and send nothing anywhere.
 *
 * THE PICTURES ARE MAIN'S BUNDLED FILES, named here and never by the page: an
 * agent's icon and a map's splash only for a name the game data knows
 * (agent-icons.js), a gun's kill feed icon only from the index (kit-icons.js).
 */

/** A path under assets/ as the page loads it, or null. */
const asset = (rel) => (rel ? `../../../assets/${rel}` : null);
const agentArt = (name) => asset(iconOf('valorant', name));
const champArt = (name) => asset(iconOf('lol', name));
const mapArt = (name) => asset(mapArtOf(name));
const gunArt = (name) => {
  const k = name ? killIcon(name) : null;
  return k && k.kind === 'weapon' && /^valorant\/weapons\/[A-Za-z]+\.png$/.test(k.file) ? asset(k.file) : null;
};

/** The pictures each slide draws, by name, laid beside the story. */
function artOf(story) {
  const art = { agents: {}, maps: {}, guns: {}, champions: {} };
  const agent = (n) => { if (n && !(n in art.agents)) art.agents[n] = agentArt(n); };
  const map = (n) => { if (n && !(n in art.maps)) art.maps[n] = mapArt(n); };
  const v = story && story.valorant;
  if (v) {
    for (const a of v.agents || []) agent(a.name);
    for (const m of v.maps || []) map(m.name);
    if (v.best) { agent(v.best.agent); map(v.best.map); }
    if (v.highlights && v.highlights.clip) { agent(v.highlights.clip.agent); map(v.highlights.clip.map); }
    if (v.fights && v.fights.nemesis) agent(v.fights.nemesis.agent);
    if (v.fights && v.fights.gun) art.guns[v.fights.gun.name] = gunArt(v.fights.gun.name);
  }
  const l = story && story.lol;
  if (l) for (const c of l.champions || []) art.champions[c.name] = champArt(c.name);
  if (l && l.champion && !(l.champion.name in art.champions)) art.champions[l.champion.name] = champArt(l.champion.name);
  return art;
}

contextBridge.exposeInMainWorld('occlaraWrapped', {
  async get() {
    const got = await ipcRenderer.invoke(C.WRAPPED_GET);
    if (!got || !got.story) return null;
    return { ...got, art: artOf(got.story) };
  },
  close: () => ipcRenderer.send(C.WRAPPED_ACT, { close: true }),
  // The window hidden, minimised or out of focus: pause. Its focus back: resume.
  onPause: (cb) => {
    const h = (_e, m) => { if (m && m.pause) cb(); };
    ipcRenderer.on(C.PUSH_WRAPPED, h);
    return () => ipcRenderer.removeListener(C.PUSH_WRAPPED, h);
  },
  onResume: (cb) => {
    const h = (_e, m) => { if (m && m.resume) cb(); };
    ipcRenderer.on(C.PUSH_WRAPPED, h);
    return () => ipcRenderer.removeListener(C.PUSH_WRAPPED, h);
  },
});

// Still while a match is recorded (9.1, the owner's item 9): html.rec-still on this document (still.js).
require('./still').stillSync(ipcRenderer);

'use strict';

/*
 * WHAT'S NEW: the changelog, newest version first.
 *
 * Painted at once from the entries the app ships with (the preload's
 * bundled()), then once more if main's background refresh from the server
 * (refresh(), 4 s at most, null on any failure) brings something different.
 * The second paint has no entrance: the list rises once, as one block, when
 * it first appears, never on a repaint. Every word is the changelog's, set as text,
 * never as markup. The version the player runs is marked "Your version".
 *
 * The seal hides this page mid match like every page, so nothing here is on
 * screen while a match is played, and nothing here moves or plays then.
 */

const $ = (id) => document.getElementById(id);
const api = window.occlara || {};

let shownKey = '';
let current = '';
let painted = false;

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};

function entry(e, i, rise) {
  const sec = el('section', `wn-entry${i === 0 ? ' first' : ''}${rise ? ' rise' : ''}`);
  sec.setAttribute('aria-labelledby', `wn-t-${i}`);
  sec.dataset.version = e.version;

  const meta = el('p', 'wn-meta');
  meta.append(el('span', 'wn-ver', e.version));
  const day = typeof api.dayOf === 'function' ? api.dayOf(e.date) : e.date;
  if (day) meta.append(el('span', 'wn-date', day));
  if (current && e.version === current) meta.append(el('span', 'wn-mine', 'Your version'));
  sec.append(meta);

  const title = el('h3', 'wn-title', e.title);
  title.id = `wn-t-${i}`;
  sec.append(title);
  sec.append(el('p', 'wn-summary', e.summary));

  const ul = el('ul', 'wn-items');
  for (const it of e.items) {
    const li = el('li', `wn-item ${it.kind}`);
    li.append(el('span', 'wn-kind', typeof api.kindWord === 'function' ? api.kindWord(it.kind) : it.kind));
    li.append(el('span', 'wn-text', it.text));
    ul.append(li);
  }
  sec.append(ul);
  return sec;
}

function paint(entries) {
  const list = Array.isArray(entries) ? entries : [];
  const key = JSON.stringify(list);
  if (key === shownKey) return;
  shownKey = key;
  const rise = !painted;
  painted = true;
  const host = $('wn-list');
  host.textContent = '';
  // One entrance, every entry together (8.8), never one after another.
  list.forEach((e, i) => host.append(entry(e, i, rise)));
  $('wn-empty').hidden = list.length > 0;
}

(async () => {
  // The running version, for "Your version", known before the first paint.
  current = typeof api.version === 'function' ? String(api.version() || '') : '';
  paint(typeof api.bundled === 'function' ? api.bundled() : []);
  if (typeof api.refresh === 'function') {
    try {
      const fresh = await api.refresh();
      if (Array.isArray(fresh) && fresh.length) paint(fresh);
    } catch { /* the bundled list stays, silently */ }
  }
})();

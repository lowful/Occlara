'use strict';

/*
 * THE MOMENTS PAGE (8.7), called Clips. The player's deaths and highlights,
 * compiled from the saved reviews by main (src/shared/moments.js), newest
 * match first.
 *
 * Under each match's line its moments: a death with what the coach saw there
 * (its cause from the closed list, or Riot's facts), when in the round it
 * came, the mark of each repeated mistake it belongs to, and the clip of it
 * where one was kept; a highlight Riot's record proves (a 2K, 3K, 4K or 5K
 * round, a clutch won, the first kill rounds running), with its own clip of
 * its kills where one was cut (8.17), the cuts and the kills marked on its
 * timeline, and over the compilation the reel of every one. A row opens its
 * review at that round. Over the list the compilation by repeated mistake,
 * with Play all, which plays the kept clips of those deaths back to back in a
 * player over the page: Esc closes it, the arrows move, Space plays and
 * pauses.
 *
 * 9.1 (the owner's items 12, 13 and 18): the page scrolls as one, title and
 * all, so nothing is cut by an edge that stays put; ONE hero, the player's
 * best recent clip, large, playing muted while the page is on screen (main's
 * bestOf picks it); filters by kind, map, agent, result and repeated mistake;
 * each kept clip's menu opens its file location on this PC or deletes it,
 * after a confirm; the play mark sits optically centred in its circle; and
 * Storage, a press away from the title, says what Occlara keeps on this PC,
 * what can be cleared and how.
 *
 * Nothing here counts: every title, line and number is main's. And nothing
 * here plays mid match: the seal hides the page, the player asks main whether
 * the window is sealed before it opens, the hero is held still while a match
 * is recorded (Motion.onAmbient), and leaving the page closes and stills both.
 */

const $ = (id) => document.getElementById(id);
const api = window.occlara || {};
const { el, gradeTone } = window.GradeView;

// The empty states' words; every other line on the page is main's
// (moments.js NOTES and GONE come with the data).
const EMPTY = {
  none: ['No matches yet', 'Press Start, play a match, and its deaths and highlights land here when the review opens.'],
  quiet: ['Nothing to show yet', 'Your saved matches have no deaths or highlights on record. A match checked against Riot\'s record fills this page.'],
};

/*
 * THE PLAY MARK (9.1, the owner's item 12: "the play button is not centred on
 * its circle"). A triangle's weight sits a third of its width from its base,
 * so a triangle boxed in the middle of a circle reads as sitting left. This
 * one's corners are rounded (1.4 on the 24 grid) and its area's centroid is
 * on (12, 12), the circle's centre: centred as the eye measures it.
 */
const PLAY_PATH = 'M10.43 6.98L17.18 10.78A1.4 1.4 0 0 1 17.18 13.22L10.43 17.02A1.4 1.4 0 0 1 8.34 15.8L8.34 8.2A1.4 1.4 0 0 1 10.43 6.98Z';
const playSvg = (size) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="currentColor" stroke="none" aria-hidden="true"><path d="${PLAY_PATH}"/></svg>`;
const MORE_SVG = '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" stroke="none" aria-hidden="true"><circle cx="6" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="18" cy="12" r="1.6"/></svg>';

let game = null;
let data = null;
let ask = 0;
// The filters (9.1): the kind, the repeated mistake (a compilation chip or
// its dropdown, the same state), and the match's map, agent and result.
const state = { kind: 'all', pattern: null, map: '', agent: '', result: '' };
let risen = null;   // the game whose rows have risen once

function fmtWhen(at) {
  const d = new Date(at);
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ', '
    + d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}
const fmtDay = (at) => new Date(at).toLocaleDateString([], { month: 'short', day: 'numeric' });

const resultClass = (r) => {
  const s = String(r || '').toLowerCase();
  return /victory|win|won/.test(s) ? 'win' : /defeat|loss|lost/.test(s) ? 'loss' : /draw|tie/.test(s) ? 'draw' : '';
};
const RESULT_WORD = { win: 'Victory', loss: 'Defeat', draw: 'Draw' };

const MB = 1024 * 1024;
/** 340 MB, 1.2 GB: a size as Settings says one (binary, as Windows counts). */
function sizeText(bytes) {
  const b = Number(bytes) || 0;
  if (b >= 1024 * MB) return `${(Math.round((b / (1024 * MB)) * 10) / 10).toLocaleString('en-US')} GB`;
  return b < MB ? 'less than 1 MB' : `${Math.round(b / MB)} MB`;
}
const plural = (n, one, many) => `${n} ${n === 1 ? one : (many || `${one}s`)}`;

/** Every moment on the page, by its key. */
function momentByKey() {
  const m = new Map();
  for (const match of (data && data.matches) || []) for (const x of match.moments) m.set(x.key, { ...x, match });
  return m;
}

// ── The compilation ───────────────────────────────────────────────────────
function paintCompilation() {
  const host = $('mo-comp-rows');
  host.replaceChildren();
  const list = (data && data.compilation) || [];
  $('mo-comp').hidden = !list.length;
  for (const c of list) {
    const row = el('div', 'mo-crow');
    row.setAttribute('role', 'listitem');
    const pick = el('button', 'mo-cpick');
    pick.type = 'button';
    pick.dataset.key = c.key;
    pick.setAttribute('aria-pressed', String(state.pattern === c.key));
    pick.append(el('span', 'mo-ctitle', c.title), el('span', 'mo-cline', c.line));
    pick.title = state.pattern === c.key ? 'Show every moment again' : 'Show only these deaths';
    pick.addEventListener('click', () => {
      setPattern(state.pattern === c.key ? null : c.key);
    });
    row.append(pick);
    if (c.clips > 0) {
      const play = el('button', 'btn btn-ghost sm', 'Play all');
      play.type = 'button';
      play.setAttribute('aria-label', `Play all ${c.clips} clips of ${c.title}`);
      play.addEventListener('click', () => openPlayer(c));
      row.append(play);
    } else {
      row.append(el('span', 'mo-cnone', 'No clip kept'));
    }
    host.append(row);
  }
}

// ── The highlights reel (8.17) ────────────────────────────────────────────
// Every highlight clip kept, main's line and items: its row shows only the
// highlights below, and Play all plays them back to back.
function paintReel() {
  const host = $('mo-reel-rows');
  host.replaceChildren();
  const r = data && data.reel;
  $('mo-reel').hidden = !r;
  if (!r) return;
  const row = el('div', 'mo-crow');
  row.setAttribute('role', 'listitem');
  const pick = el('button', 'mo-cpick');
  pick.type = 'button';
  pick.title = 'Show only highlights';
  pick.append(el('span', 'mo-ctitle', r.title), el('span', 'mo-cline', r.line));
  pick.addEventListener('click', () => {
    // A pattern chosen in the compilation shows deaths alone: let it go first,
    // or the Highlights filter under it shows nothing.
    if (state.pattern) setPattern(null, true);
    const b = $('mo-filter').querySelector('button[data-kind="highlight"]');
    if (b) b.click();
  });
  const play = el('button', 'btn btn-ghost sm', 'Play all');
  play.type = 'button';
  play.setAttribute('aria-label', `Play all ${r.clips} highlight clips`);
  play.addEventListener('click', () => openPlayer(r));
  row.append(pick, play);
  host.append(row);
}

// ── The filters (9.1) ─────────────────────────────────────────────────────
// The kind is the capsule (#mo-filter); the map, the agent, the result and the
// repeated mistake are the app's own dropdowns, their choices the values the
// saved matches hold, so none ever offers what would show nothing. A match
// passes by its map, agent and result; a moment by its kind and mistake.
const matchShown = (m) => (!state.map || m.map === state.map)
  && (!state.agent || m.title === state.agent)
  && (!state.result || resultClass(m.result) === state.result);

function shown(x) {
  if (state.kind !== 'all' && x.kind !== state.kind) return false;
  if (state.pattern && !(x.kind === 'death' && x.repeats.some((r) => r.key === state.pattern))) return false;
  return true;
}

const filtering = () => state.kind !== 'all' || !!state.pattern || !!state.map || !!state.agent || !!state.result;

const drops = {};
function makeDrops() {
  if (!window.Dropdown || typeof window.Dropdown.create !== 'function') return;
  const make = (key, label) => {
    const mount = $(`mo-f-${key}`);
    if (!mount) return;
    drops[key] = window.Dropdown.create(mount, {
      label, options: [], value: '',
      onChange: (v) => {
        if (key === 'mistake') { setPattern(v || null); return; }
        state[key] = v || '';
        paintFilters();
        paintList(false);
      },
    });
  };
  make('map', 'Map');
  make('agent', 'Agent');
  make('result', 'Result');
  make('mistake', 'Repeated mistake');
}

/** The dropdowns' choices from what is saved, each led by its "Any". */
function paintFilters() {
  const ms = ((data && data.matches) || []).filter((m) => m.moments && m.moments.length);
  const uniq = (xs) => [...new Set(xs.filter((v) => typeof v === 'string' && v))].sort((a, b) => a.localeCompare(b));
  const lol = game === 'lol';
  const mistakes = [];
  const seen = new Set();
  for (const c of (data && data.compilation) || []) { if (!seen.has(c.key)) { seen.add(c.key); mistakes.push({ value: c.key, label: c.title }); } }
  const rest = new Map();
  for (const m of ms) for (const x of m.moments) for (const r of x.repeats || []) if (r && r.key && !seen.has(r.key) && !rest.has(r.key)) rest.set(r.key, r.title);
  [...rest.entries()].sort((a, b) => String(a[1]).localeCompare(String(b[1]))).forEach(([value, label]) => mistakes.push({ value, label }));
  const sets = {
    map: [{ value: '', label: 'Any map' }, ...uniq(ms.map((m) => m.map)).map((v) => ({ value: v, label: v }))],
    agent: [{ value: '', label: lol ? 'Any champion' : 'Any agent' }, ...uniq(ms.map((m) => m.title)).map((v) => ({ value: v, label: v }))],
    result: [{ value: '', label: 'Any result' }, ...['win', 'loss', 'draw'].filter((r) => ms.some((m) => resultClass(m.result) === r)).map((r) => ({ value: r, label: RESULT_WORD[r] }))],
    mistake: [{ value: '', label: 'Any mistake' }, ...mistakes],
  };
  // A choice the saved matches no longer hold (a match deleted, the game
  // changed) lets go rather than showing nothing.
  for (const key of ['map', 'agent', 'result']) if (state[key] && !sets[key].some((o) => o.value === state[key])) state[key] = '';
  if (state.pattern && !sets.mistake.some((o) => o.value === state.pattern)) state.pattern = null;
  const values = { map: state.map, agent: state.agent, result: state.result, mistake: state.pattern || '' };
  for (const key of Object.keys(sets)) {
    const d = drops[key];
    if (!d) continue;
    d.setOptions(sets[key], true);
    d.setValue(values[key]);
    d.el.classList.toggle('on', !!values[key]);
  }
  $('mo-f-clear').hidden = !filtering();
}

/** The repeated mistake chosen, by a chip or the dropdown: the same state. */
function setPattern(key, quiet) {
  state.pattern = key || null;
  paintCompilation();
  paintFilters();
  if (!quiet) paintList(false);
}

function clearFilters() {
  state.pattern = null;
  state.map = '';
  state.agent = '';
  state.result = '';
  const all = $('mo-filter').querySelector('button[data-kind="all"]');
  if (state.kind !== 'all' && all) { all.click(); }
  paintCompilation();
  paintFilters();
  paintList(false);
}

// ── The list ──────────────────────────────────────────────────────────────
function matchHead(m) {
  const head = el('div', 'mo-mhead');
  const res = el('span', 'mo-res ' + resultClass(m.result));
  res.textContent = [m.result, m.score].filter(Boolean).join(' ') || 'No result';
  const who = el('span', 'mo-who', [[m.title, m.map ? `on ${m.map}` : null].filter(Boolean).join(' '), m.mode].filter(Boolean).join(', '));
  const when = el('span', 'mo-when', fmtWhen(m.at));
  head.append(res, who, when);
  if (m.grade) {
    const g = el('span', 'mo-grade');
    g.append(el('b', 'mo-score ' + gradeTone(m.grade), m.grade.score));
    g.title = m.grade.provisional ? 'Grade, provisional' : 'Grade';
    head.append(g);
  }
  return head;
}

/*
 * What killed the player, as the bundled icon main named (moments.js
 * killIcon, kit-icons.js): the gun's kill feed silhouette or the killer's
 * ability, white on transparent. Only a file under assets/valorant/ of the
 * index's shape is drawn; one that does not load is taken away.
 */
const ICON_FILE = /^valorant\/(weapons\/[A-Za-z0-9]+|abilities\/[A-Za-z0-9]+-[A-Za-z0-9]+)\.png$/;
function killIconImg(k) {
  if (!k || typeof k.file !== 'string' || !ICON_FILE.test(k.file)) return null;
  const img = document.createElement('img');
  img.className = 'mo-gun' + (k.kind === 'ability' ? ' ability' : '');
  img.src = '../../../assets/' + k.file;
  img.alt = typeof k.label === 'string' ? k.label : '';
  if (img.alt) img.title = img.alt;
  img.loading = 'lazy';
  img.addEventListener('error', () => img.remove());
  return img;
}

/*
 * A MOMENT'S FRAME (Orbit's Clips, 28 Nov 2026): the clip's own poster, one
 * real still main made once with ffmpeg and keeps beside the clip
 * (services/clip-posters.js); while it is being made, or where no clip was
 * kept, the map's bundled splash, dimmed, and where none was kept a small
 * "No clip kept" (or why it went). Never a frame that is not this moment's.
 */
const mapArt = (map) => (typeof api.mapArt === 'function' && map ? api.mapArt(map) : null);
const posterOf = (x) => (x.clip && typeof x.clip.poster === 'string' && x.clip.poster.startsWith('data:image/jpeg;base64,') ? x.clip.poster : null);
function frameEl(m, x, big) {
  const poster = posterOf(x);
  const f = el('div', 'mo-frame' + (poster ? '' : ' art') + (big ? ' big' : ''));
  const src = poster || mapArt(m.map);
  if (src) {
    const img = document.createElement('img');
    img.className = 'mo-frame-img';
    img.src = src;
    img.alt = '';
    img.decoding = 'async';
    img.loading = big ? 'eager' : 'lazy';
    img.addEventListener('error', () => img.remove());
    f.append(img);
  }
  return f;
}

/** A clip's more button: its menu opens the file's location or deletes it (9.1). */
function moreButton(m, x, cls) {
  const b = el('button', 'icon-btn mo-more' + (cls ? ` ${cls}` : ''));
  b.type = 'button';
  b.title = 'More';
  b.setAttribute('aria-label', `More for the ${x.kind === 'highlight' ? 'highlight' : 'clip'} of round ${x.round}`);
  b.setAttribute('aria-haspopup', 'menu');
  b.setAttribute('aria-expanded', 'false');
  b.innerHTML = MORE_SVG;
  b.addEventListener('click', (e) => { e.stopPropagation(); openMenu(b, m, x); });
  return b;
}

// ── The hero (9.1, the owner's item 13) ───────────────────────────────────
// ONE: the player's best recent clip, main's pick (moments.js bestOf) and
// main's words over it. Large, its poster first and its own clip over it,
// muted and looping while the page is on screen and in view, so it is sharp
// at any size; held on its moment under reduced motion, and paused while a
// match is recorded, the page is left or a dialog is over it. Pressed, the
// clip plays in the player; Open its review opens the round.
let heroSig = null;
let heroVideo = null;
let heroInView = true;
let pageOn = false;
let heroWatch = null;

/** Where the poster was taken, so the still the clip shows first is the same moment (index.js withPosters). */
function posterAt(c) {
  const kill = Array.isArray(c.kills) && c.kills.length ? c.kills[0] : null;
  const ms = typeof c.death === 'number' ? c.death - 800 : typeof kill === 'number' ? kill - 300 : 1000;
  return Math.max(0, ms) / 1000;
}

function heroMayPlay() {
  const Mo = window.Motion;
  if (!heroVideo || !pageOn || !heroInView || player.open || cf.open) return false;
  if (Mo && typeof Mo.ambientOn === 'function' && !Mo.ambientOn()) return false;
  if (Mo && typeof Mo.reduced === 'function' && Mo.reduced()) return false;
  return document.visibilityState !== 'hidden';
}

/** Play the hero's clip when it may, else hold it: called on every change that could matter. */
function heroWake() {
  const v = heroVideo;
  if (!v) return;
  if (heroMayPlay()) {
    const p = typeof v.play === 'function' ? v.play() : null;
    if (p && typeof p.catch === 'function') p.catch(() => {});
  } else if (typeof v.pause === 'function' && !v.paused) {
    v.pause();
  }
}

function stopHero() {
  const v = heroVideo;
  heroVideo = null;
  if (heroWatch) { try { heroWatch.disconnect(); } catch { /* gone */ } heroWatch = null; }
  if (!v) return;
  try { if (typeof v.pause === 'function') v.pause(); } catch { /* no decoder */ }
  v.removeAttribute('src');
  if (typeof v.load === 'function') { try { v.load(); } catch { /* nothing loaded */ } }
}

function heroCard(x, best) {
  const m = x.match;
  const card = el('div', 'mo-hcard big');
  card.dataset.key = x.key;
  const f = frameEl(m, x, true);
  // The clip itself over its poster, muted, faded in once it shows a frame.
  const v = document.createElement('video');
  v.className = 'mo-hvideo';
  v.muted = true;
  v.loop = true;
  for (const a of ['muted', 'loop', 'playsinline', 'disablepictureinpicture']) v.setAttribute(a, '');
  v.setAttribute('preload', 'metadata');
  v.setAttribute('aria-hidden', 'true');
  v.setAttribute('tabindex', '-1');
  const at = posterAt(x.clip);
  v.addEventListener('loadedmetadata', () => {
    try { if (Number.isFinite(v.duration) && at < v.duration) v.currentTime = at; } catch { /* not seekable yet */ }
    heroWake();
  });
  const show = () => f.classList.add('live');
  v.addEventListener('playing', show);
  v.addEventListener('seeked', show);
  v.addEventListener('error', () => { f.classList.remove('live'); v.remove(); if (heroVideo === v) heroVideo = null; });
  v.setAttribute('src', x.clip.url);
  f.append(v);
  f.append(el('span', 'mo-hshade'));
  // The whole picture is the play button.
  const play = el('button', 'mo-hplay');
  play.type = 'button';
  play.setAttribute('aria-label', `Play ${x.kind === 'highlight' ? 'the highlight' : 'the clip'} of round ${x.round}: ${x.title}`);
  const ring = el('span', 'mo-frame-play');
  ring.innerHTML = playSvg(46);
  play.append(ring);
  play.addEventListener('click', () => openPlayer({ title: `${x.title}, round ${x.round}`, items: [x.key], clips: 1 }));
  f.append(play);
  // Main's words over it, then the moment: its title large, where and when.
  const cap = el('div', 'mo-hcap');
  cap.append(el('span', 'mo-heyebrow', best.label));
  cap.append(el('b', 'mo-htitle', x.title));
  const meta = el('div', 'mo-hmeta');
  meta.append(el('span', 'mo-hround', `Round ${x.round}`));
  const who = [m.title, m.map ? `on ${m.map}` : null].filter(Boolean).join(' ');
  if (who) meta.append(el('span', 'mo-hwho', who));
  const res = [m.result, m.score].filter(Boolean).join(' ');
  if (res) meta.append(el('span', 'mo-hres ' + resultClass(m.result), res));
  if (m.at) meta.append(el('span', 'mo-hday', fmtDay(m.at)));
  if (x.time) meta.append(el('span', 'mo-htime', x.time));
  cap.append(meta);
  if (best.line) cap.append(el('span', 'mo-hline', best.line));
  f.append(cap);
  const acts = el('div', 'mo-hacts');
  const open = el('button', 'btn btn-primary sm mo-hopen', 'Open its review');
  open.type = 'button';
  open.addEventListener('click', () => api.openReview(m.id, x.round));
  acts.append(open, moreButton(m, x, 'mo-hmore'));
  f.append(acts);
  card.append(f);
  heroVideo = v;
  // Out of view (scrolled past), it holds; back in view it plays on.
  if (typeof window.IntersectionObserver === 'function') {
    heroWatch = new window.IntersectionObserver((es) => {
      for (const e of es) heroInView = e.intersectionRatio >= 0.2;
      heroWake();
    }, { threshold: [0, 0.2, 0.6] });
    heroWatch.observe(f);
  }
  return card;
}

function paintHero() {
  const host = $('mo-hero');
  const best = data && data.best;
  const x = best && best.key ? momentByKey().get(best.key) : null;
  if (!x || !x.clip) {
    stopHero();
    heroSig = null;
    host.replaceChildren();
    host.hidden = true;
    return;
  }
  const sig = `${game}|${x.key}|${x.clip.url}|${best.label}|${best.line}`;
  if (sig === heroSig && host.firstChild) {
    // The same clip: its poster may have landed since, nothing restarts.
    const f = host.querySelector('.mo-frame');
    const poster = posterOf(x);
    const img = f && f.querySelector('.mo-frame-img');
    if (f && poster && f.classList.contains('art')) {
      f.classList.remove('art');
      if (img) img.src = poster;
    }
    host.hidden = false;
    return;
  }
  stopHero();
  heroSig = sig;
  host.replaceChildren(heroCard(x, best));
  host.classList.add('solo');
  host.hidden = false;
  const Mo = window.Motion;
  if (Mo && typeof Mo.whenShown === 'function') Mo.whenShown(() => { pageOn = true; heroWake(); });
  else { pageOn = true; heroWake(); }
}

function momentRow(m, x) {
  const row = el('div', 'mo-row');
  row.dataset.key = x.key;
  // ORBIT: the card's frame first, its round in the corner; the play button
  // or why no clip is kept sits on it (below, .mo-clip).
  const frame = frameEl(m, x, false);
  frame.append(el('span', 'mo-frame-cap', `Round ${x.round}`));
  row.append(frame);
  const open = el('button', 'mo-open');
  open.type = 'button';
  open.setAttribute('aria-label', `${x.kind === 'death' ? 'Death' : 'Highlight'} in round ${x.round}: ${x.title}. Open the review at this round`);
  open.append(el('span', 'mo-round', `R${x.round}`));
  open.append(el('span', `mo-kind ${x.kind}`, x.kind === 'death' ? 'Death' : 'Highlight'));
  const main = el('div', 'mo-main');
  const gun = x.kind === 'death' ? killIconImg(x.killIcon) : null;
  if (gun) {
    const head = el('span', 'mo-titlerow');
    head.append(el('span', 'mo-mtitle', x.title), gun);
    main.append(head);
  } else {
    main.append(el('span', 'mo-mtitle', x.title));
  }
  if (x.line) main.append(el('span', 'mo-mline', x.line));
  if (x.repeats && x.repeats.length) {
    const marks = el('div', 'mo-marks');
    for (const r of x.repeats) {
      const mk = el('span', 'mo-mark' + (r.across ? ' across' : ''), r.title);
      mk.title = r.across ? 'One of your repeated mistakes across matches' : 'Repeated in this match';
      marks.append(mk);
    }
    main.append(marks);
  }
  open.append(main);
  open.append(el('span', 'mo-time', x.time || ''));
  open.addEventListener('click', () => api.openReview(m.id, x.round));
  row.append(open);
  const clip = el('div', 'mo-clip');
  if (x.clip) {
    const b = el('button', 'icon-btn mo-play');
    b.type = 'button';
    b.title = x.kind === 'highlight' ? `Play the highlight of round ${x.round}` : `Play the clip of round ${x.round}`;
    b.setAttribute('aria-label', b.title);
    b.innerHTML = playSvg(24);
    b.addEventListener('click', () => openPlayer({ title: `${x.title}, round ${x.round}`, items: [x.key], clips: 1 }));
    clip.append(b);
    frame.append(moreButton(m, x));
  } else if (x.clipGone) {
    clip.append(el('span', 'mo-gone mo-frame-tag', x.clipGoneText || 'Clip gone'));
  } else {
    clip.append(el('span', 'mo-frame-tag', 'No clip kept'));
  }
  frame.append(clip);
  return row;
}

/**
 * @param rise  the rows rise once as the list first appears for this game,
 *              40ms apart and capped at the sixth; a repaint draws them as
 *              they are
 */
function paintList(rise) {
  const host = $('mo-list');
  host.replaceChildren();
  // The clip column is only there while a clip is kept in these matches
  // (moments.css .clips): without one the time is the last column, on the rule.
  host.classList.toggle('clips', !!(data && data.counts && data.counts.clips > 0));
  const rows = [];
  for (const m of (data && data.matches) || []) {
    if (!matchShown(m)) continue;
    const xs = m.moments.filter(shown);
    if (!xs.length) continue;
    const sec = el('section', 'mo-match');
    sec.setAttribute('aria-label', [m.result, m.score, m.title, m.map].filter(Boolean).join(' '));
    sec.append(matchHead(m));
    const list = el('div', 'mo-rows');
    for (const x of xs) { const r = momentRow(m, x); list.append(r); rows.push(r); }
    sec.append(list);
    host.append(sec);
  }
  const none = $('mo-none');
  none.hidden = rows.length > 0;
  if (!rows.length) {
    none.textContent = (state.map || state.agent || state.result) ? 'No moments match these filters. Clear them to see every moment again.'
      : state.pattern ? 'No deaths of this pattern under the filter.'
        : state.kind === 'death' ? 'No deaths on record in these matches.'
          : state.kind === 'highlight' ? 'No highlights on record yet: a 2K, 3K, 4K or 5K round, a clutch won or the first kill rounds running.'
            : 'Nothing to show.';
  }
  $('mo-f-clear').hidden = !filtering();
  if (rise && rows.length && risen !== game) {
    risen = game;
    const go = () => rows.forEach((r, i) => {
      if (!host.contains(r)) return;   // painted again meanwhile
      r.style.setProperty('--i', String(Math.min(i, 5)));
      r.classList.add('rise');
    });
    if (typeof window.occlaraOnShown === 'function') window.occlaraOnShown(go); else go();
  }
}

function paintCounts() {
  const c = (data && data.counts) || { matches: 0, deaths: 0, highlights: 0, clips: 0 };
  const say = (n, one, many) => `${n} ${n === 1 ? one : (many || `${one}s`)}`;
  $('mo-counts').textContent = `${say(c.deaths, 'death')}, ${say(c.highlights, 'highlight')}, ${say(c.clips, 'clip')} across ${say(c.matches, 'match', 'matches')}`;
}

function paintNote() {
  const note = $('mo-note');
  note.textContent = (data && typeof data.clipsNoteText === 'string') ? data.clipsNoteText : '';
  note.hidden = !note.textContent;
}

function paint(first) {
  $('mo-wait').hidden = true;
  const matches = (data && data.matches) || [];
  const any = matches.some((m) => m.moments.length);
  const empty = $('mo-empty');
  empty.hidden = any;
  $('mo-log').hidden = !any;
  if (!any) {
    $('mo-comp').hidden = true;
    $('mo-reel').hidden = true;
    stopHero();
    heroSig = null;
    $('mo-hero').replaceChildren();
    $('mo-hero').hidden = true;
    const [title, hint] = matches.length ? EMPTY.quiet : EMPTY.none;
    $('mo-empty-title').textContent = title;
    $('mo-empty-hint').textContent = hint;
    return;
  }
  paintHero();
  paintReel();
  paintFilters();
  paintCompilation();
  paintCounts();
  paintNote();
  paintList(first);
  // THE CARDS FADE UP once per visit (8.9.2), the hero, the compilation then
  // the log --stagger apart, only once the page is on screen; nothing under
  // reduced motion, and a refresh paints them as they are (moments.css .mo-in).
  const Mo = window.Motion;
  if (Mo && !Mo.reduced() && Mo.once($('mo-log'), 'cards')) {
    Mo.whenShown(() => {
      if (Mo.reduced()) return;
      const cards = [$('mo-hero'), $('mo-reel'), $('mo-comp'), $('mo-log')].filter((c) => !c.hidden);
      cards.forEach((c, i) => { c.style.setProperty('--i', String(i)); c.classList.add('mo-in'); });
      setTimeout(() => cards.forEach((c) => c.classList.remove('mo-in')), 480 + 3 * 40 + 120);
    });
  }
}

async function load() {
  const mine = ++ask;
  const got = await api.getMoments(game).catch(() => null);
  if (mine !== ask) return;
  data = got && !got.error ? got : { matches: [], compilation: [], counts: { matches: 0, deaths: 0, highlights: 0, clips: 0 }, clipsNote: null };
  closeMenu(false);
  paint(risen !== game);
}

// ── The kind ──────────────────────────────────────────────────────────────
for (const b of $('mo-filter').querySelectorAll('button')) {
  b.addEventListener('click', () => {
    state.kind = b.dataset.kind || 'all';
    for (const o of $('mo-filter').querySelectorAll('button')) o.setAttribute('aria-pressed', String(o === b));
    paintList(false);
  });
}
try { if (typeof window.occlaraSeg === 'function') window.occlaraSeg($('mo-filter')); } catch { /* drawn flat */ }
try { makeDrops(); } catch { /* the kind alone */ }
$('mo-f-clear').addEventListener('click', clearFilters);

// ── A clip's menu (9.1) ───────────────────────────────────────────────────
// One menu for the page, opened from a clip's more button: Open file location
// (main opens Explorer on the file, by the review's id and the clip's name)
// and Delete clip (after the confirm). The arrows move inside it, Esc and Tab
// close it and give the keyboard back to its button; a press elsewhere or a
// scroll closes it too.
const menu = { open: false, btn: null, m: null, x: null };
const menuItems = () => [...$('mo-menu').querySelectorAll('.mo-mi')].filter((n) => !n.hidden && !n.disabled);

function openMenu(btn, m, x) {
  if (menu.open && menu.btn === btn) { closeMenu(true); return; }
  closeMenu(false);
  if (!x || !x.clip) return;
  Object.assign(menu, { open: true, btn, m, x });
  const host = $('mo-menu');
  const reveal = host.querySelector('[data-act="reveal"]');
  if (reveal) reveal.hidden = typeof api.revealClip !== 'function';
  host.hidden = false;
  btn.setAttribute('aria-expanded', 'true');
  btn.classList.add('on');
  // Under its button, its right edge on the button's; up where there is no room below.
  const r = btn.getBoundingClientRect();
  const w = host.offsetWidth || 220;
  const h = host.offsetHeight || 96;
  const left = Math.max(8, Math.min(r.right - w, (window.innerWidth || 1280) - w - 8));
  const below = (window.innerHeight || 800) - r.bottom - 6;
  const up = below < h + 8 && r.top > h + 8;
  host.style.left = `${Math.round(left)}px`;
  host.style.top = `${Math.round(up ? r.top - 6 - h : r.bottom + 6)}px`;
  host.classList.toggle('up', up);
  host.classList.remove('open');
  void host.offsetWidth;
  host.classList.add('open');
  const first = menuItems()[0];
  if (first) first.focus();
  heroWake();
}

function closeMenu(refocus) {
  if (!menu.open) return;
  const btn = menu.btn;
  Object.assign(menu, { open: false, btn: null, m: null, x: null });
  const host = $('mo-menu');
  host.classList.remove('open');
  host.hidden = true;
  if (btn) { btn.setAttribute('aria-expanded', 'false'); btn.classList.remove('on'); }
  if (refocus && btn && btn.isConnected !== false && typeof btn.focus === 'function') btn.focus();
}

for (const item of $('mo-menu').querySelectorAll('.mo-mi')) {
  item.addEventListener('click', () => {
    // The more button it came from takes the keyboard back: at once for an
    // open, once the confirm closes for a delete.
    const { m, x, btn } = menu;
    const act = item.dataset.act;
    closeMenu(act !== 'delete');
    if (!m || !x) return;
    if (act === 'reveal') revealClip(m, x);
    else if (act === 'delete') askDelete(m, x, btn);
  });
}
$('mo-menu').addEventListener('keydown', (e) => {
  const items = menuItems();
  const i = items.indexOf(document.activeElement);
  if (e.key === 'ArrowDown') { e.preventDefault(); (items[(i + 1) % items.length] || items[0]).focus(); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); (items[(i - 1 + items.length) % items.length] || items[0]).focus(); }
  else if (e.key === 'Home') { e.preventDefault(); if (items[0]) items[0].focus(); }
  else if (e.key === 'End') { e.preventDefault(); if (items.length) items[items.length - 1].focus(); }
  else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeMenu(true); }
  else if (e.key === 'Tab') { closeMenu(true); e.preventDefault(); }
});
document.addEventListener('mousedown', (e) => {
  if (!menu.open) return;
  if ($('mo-menu').contains(e.target) || (menu.btn && menu.btn.contains && menu.btn.contains(e.target))) return;
  closeMenu(false);
});
window.addEventListener('blur', () => closeMenu(false));
document.addEventListener('scroll', () => closeMenu(false), true);

// What a delete or an open did, said once in the page's own toast.
let toastTimer = null;
function toast(text, bad) {
  const t = $('mo-toast');
  clearTimeout(toastTimer);
  t.textContent = text;
  t.classList.toggle('bad', !!bad);
  t.hidden = false;
  t.classList.remove('on');
  void t.offsetWidth;
  t.classList.add('on');
  toastTimer = setTimeout(() => {
    t.classList.remove('on');
    toastTimer = setTimeout(() => { t.hidden = true; }, 260);
  }, 3800);
}

// Main's refusals, in the page's words (CLIP_DELETE and CLIP_REVEAL).
const FAILED = {
  match: 'Not while a match is being recorded.',
  working: 'Its review is still being finished. Try again in a moment.',
  gone: 'That clip is already gone from this PC.',
  bad: 'That clip could not be found.',
};

async function revealClip(m, x) {
  if (typeof api.revealClip !== 'function') return;
  const r = await api.revealClip(m.id, x.clip.name).catch(() => null);
  if (!r || !r.ok) toast(FAILED[r && r.error] || 'Its file could not be shown.', true);
}

/** What a clip is called in a sentence: "your death in round 4 on Split", "your 3K in round 7". */
function clipWords(m, x) {
  const what = x.kind === 'death' ? 'death' : x.what === 'ace' ? 'ace' : x.what === 'clutch' ? 'clutch' : x.title;
  return `your ${what} in round ${x.round}${m.map ? ` on ${m.map}` : ''}`;
}

function askDelete(m, x, back) {
  askConfirm({
    title: 'Delete this clip?',
    body: `The clip of ${clipWords(m, x)} goes from this PC for good. Its review keeps its grade, its frames and what the coach saw.`,
    yes: 'Delete clip', no: 'Keep it', back,
    run: async () => {
      // The hero playing this very clip lets it go first, so nothing holds the file.
      if (heroVideo && heroSig && heroSig.includes(`|${x.key}|`)) { stopHero(); heroSig = null; }
      const r = typeof api.deleteClip === 'function' ? await api.deleteClip(m.id, x.clip.name).catch(() => null) : null;
      if (r && r.ok) {
        toast(`Clip deleted${r.bytes ? `, ${sizeText(r.bytes)} freed` : ''}.`);
        refreshStorage(true);
        load();
      } else {
        toast(FAILED[r && r.error] || 'That clip could not be deleted.', true);
      }
    },
  });
}

// ── The confirm (9.1) ─────────────────────────────────────────────────────
// Over the page, the page behind inert; the safe answer has the keyboard,
// Esc is the safe answer, and Tab stays inside. Yes runs once.
const cf = { open: false, run: null, back: null };
function askConfirm(o) {
  closeMenu(false);
  closeStore(false);
  cf.open = true;
  cf.run = o.run;
  cf.back = o.back || document.activeElement;
  $('mo-cf-title').textContent = o.title;
  $('mo-cf-body').textContent = o.body;
  $('mo-cf-yes').textContent = o.yes;
  $('mo-cf-no').textContent = o.no;
  $('mo-cf-yes').disabled = false;
  $('mo-cf-no').disabled = false;
  const host = $('mo-confirm');
  host.hidden = false;
  void host.offsetWidth;
  host.classList.add('open');
  for (const n of behind()) { n.inert = true; n.setAttribute('inert', ''); }
  heroWake();
  $('mo-cf-no').focus();
}
function closeConfirm() {
  if (!cf.open) return;
  cf.open = false;
  cf.run = null;
  const host = $('mo-confirm');
  host.classList.remove('open');
  host.hidden = true;
  for (const n of behind()) { n.inert = false; n.removeAttribute('inert'); }
  const back = cf.back;
  cf.back = null;
  if (back && typeof back.focus === 'function' && back.isConnected !== false) back.focus();
  heroWake();
}
$('mo-cf-no').addEventListener('click', closeConfirm);
$('mo-cf-yes').addEventListener('click', async () => {
  const run = cf.run;
  if (!run) return;
  cf.run = null;
  $('mo-cf-yes').disabled = true;
  $('mo-cf-no').disabled = true;
  try { await run(); } finally { closeConfirm(); }
});
$('mo-confirm').addEventListener('click', (e) => { if (e.target === $('mo-confirm')) closeConfirm(); });

// ── Storage (9.1, the owner's item 18) ────────────────────────────────────
// What Occlara keeps on this PC, main's count off the disk (STORAGE_GET,
// services/storage-usage.js): the pill beside the title says the total, its
// card the clips, the recordings, the frames and the rest, each with what it
// is and whether and how it can be cleared, the room left on the drive, and
// the clips against the limit set in Settings. Only clips are the player's to
// clear: one at a time from its menu here, all at once in Settings, where the
// limit is (the recordings go by themselves, the frames thin themselves).
let store = null;
let storeAsk = 0;
let storeAt = 0;
const STORE_PARTS = [
  { key: 'clips', name: 'Clips' },
  { key: 'recordings', name: 'Recordings' },
  { key: 'frames', name: 'Frames' },
  { key: 'other', name: 'Reviews and logs' },
];

async function refreshStorage(force) {
  if (typeof api.getStorage !== 'function') return;
  if (!force && Date.now() - storeAt < 2000) return;
  storeAt = Date.now();
  const mine = ++storeAsk;
  const s = await api.getStorage().catch(() => null);
  if (mine !== storeAsk) return;
  store = s && typeof s === 'object' && typeof s.total === 'number' ? s : null;
  paintStorage();
}

const partBytes = (s, key) => Math.max(0, Number(s && s[key] && s[key].bytes) || 0);

function partLine(s, key) {
  if (key === 'clips') {
    const n = Number(s.clips.count) || 0;
    return n ? `${plural(n, 'clip')} from ${plural(Number(s.clips.matches) || 0, 'match', 'matches')}. Delete one from its menu here, or clear them all in Settings.`
      : 'No clips kept right now.';
  }
  if (key === 'recordings') return 'Held only until a match\'s clips are cut, then removed when Occlara quits.';
  if (key === 'frames') return 'Stills of your screen the coach read. The AI log thins its own as it goes.';
  return 'Your saved reviews. Deleting a match on Matches removes it and everything kept with it.';
}

function paintStorage() {
  const btn = $('mo-store-btn');
  const s = store;
  btn.hidden = !s;
  if (!s) { closeStore(false); return; }
  $('mo-store-btn-text').textContent = sizeText(s.total);
  btn.title = `What Occlara keeps on this PC: ${sizeText(s.total)}`;
  btn.setAttribute('aria-label', `Storage, ${sizeText(s.total)} on this PC`);
  // The pill's small bar and the card's large one: the same four parts.
  const total = Math.max(1, s.total);
  const bars = (host, min) => {
    host.replaceChildren();
    for (const p of STORE_PARTS) {
      const b = partBytes(s, p.key);
      if (!b) continue;
      const seg = el('i', `mo-seg ${p.key}`);
      seg.style.flexGrow = String(Math.max(b / total, min));
      seg.style.setProperty('--i', String(host.children.length));
      seg.title = `${p.name}, ${sizeText(b)}`;
      host.append(seg);
    }
  };
  bars($('mo-store-mini'), 0.08);
  bars($('mo-store-bar'), 0.012);
  $('mo-store-bar').setAttribute('aria-label', STORE_PARTS.map((p) => `${p.name} ${sizeText(partBytes(s, p.key))}`).join(', '));
  $('mo-store-total').textContent = sizeText(s.total);
  const free = s.free && typeof s.free.bytes === 'number' ? s.free : null;
  $('mo-store-where').textContent = free ? ` on this PC, ${sizeText(free.bytes)} free on ${free.drive || 'this drive'}` : ' on this PC';
  const rows = $('mo-store-rows');
  rows.replaceChildren();
  for (const p of STORE_PARTS) {
    const row = el('div', `mo-srow ${p.key}`);
    row.append(el('i', `mo-swatch ${p.key}`));
    const words = el('div', 'mo-swords');
    const top = el('div', 'mo-stop');
    top.append(el('b', 'mo-sname', p.name), el('span', 'mo-sbytes', sizeText(partBytes(s, p.key))));
    words.append(top, el('span', 'mo-sline', partLine(s, p.key)));
    row.append(words);
    rows.append(row);
  }
  // The clips against the limit the player set, and where to change it.
  const cap = $('mo-store-cap');
  cap.replaceChildren();
  const capGB = Number(s.capGB) || 10;
  const clipsBytes = partBytes(s, 'clips');
  const line = el('div', 'mo-cap-line');
  line.append(el('span', 'mo-cap-words', `Clips are kept under ${capGB} GB, the oldest go first.`),
    el('span', 'mo-cap-num', `${sizeText(clipsBytes)} of ${capGB} GB`));
  const meter = el('div', 'mo-cap-meter');
  const fill = el('i', 'mo-cap-fill');
  fill.style.transform = `scaleX(${Math.min(1, clipsBytes / (capGB * 1024 * MB)).toFixed(4)})`;
  meter.append(fill);
  meter.setAttribute('role', 'meter');
  meter.setAttribute('aria-label', 'Clips against the limit');
  meter.setAttribute('aria-valuemin', '0');
  meter.setAttribute('aria-valuemax', String(capGB));
  meter.setAttribute('aria-valuenow', String(Math.round((clipsBytes / (1024 * MB)) * 10) / 10));
  // To Settings, where Clear clips and the limit are: the arrow slides in under the pointer (ui.css).
  const settings = el('button', 'btn btn-ghost sm mo-cap-set');
  settings.type = 'button';
  settings.append(el('span', 'btn-label', 'Clear clips or change the limit'));
  const arrow = el('span', 'btn-arrow');
  arrow.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14"/><path d="M13 6l6 6-6 6"/></svg>';
  settings.append(arrow);
  settings.title = 'Opens Settings';
  settings.addEventListener('click', () => { closeStore(false); if (typeof api.openSettings === 'function') api.openSettings(); });
  cap.append(line, meter, settings);
  // The recorder's disk guard: under its floor, no match is recorded.
  const warn = $('mo-store-warn');
  const needs = Number(s.recordNeeds) || 0;
  const low = !!(free && needs && free.bytes < needs);
  warn.hidden = !low;
  warn.textContent = low ? `Less than ${Math.round(needs / (1024 * MB))} GB is free on ${free.drive || 'this drive'}, so matches are not recorded until there is more room.` : '';
  btn.classList.toggle('low', low);
}

function openStore() {
  if (!store) return;
  const card = $('mo-store');
  // Hung from its pill: just under it, its right edge on the pill's.
  const btn = $('mo-store-btn');
  const head = btn.parentNode;
  if (head && btn.offsetWidth) {
    card.style.top = `${Math.round(btn.offsetTop + btn.offsetHeight + 10)}px`;
    card.style.right = `${Math.max(16, Math.round(head.clientWidth - (btn.offsetLeft + btn.offsetWidth)))}px`;
  }
  card.hidden = false;
  void card.offsetWidth;
  card.classList.add('open');
  $('mo-store-btn').setAttribute('aria-expanded', 'true');
  $('mo-store-close').focus();
  refreshStorage(true);
}
function closeStore(refocus) {
  const card = $('mo-store');
  if (card.hidden) return;
  card.classList.remove('open');
  card.hidden = true;
  $('mo-store-btn').setAttribute('aria-expanded', 'false');
  if (refocus) $('mo-store-btn').focus();
}
$('mo-store-btn').addEventListener('click', () => { if ($('mo-store').hidden) openStore(); else closeStore(true); });
$('mo-store-close').addEventListener('click', () => closeStore(true));
$('mo-store').addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeStore(true); } });
document.addEventListener('mousedown', (e) => {
  if ($('mo-store').hidden) return;
  if ($('mo-store').contains(e.target) || $('mo-store-btn').contains(e.target)) return;
  closeStore(false);
});

// ── The compilation player ────────────────────────────────────────────────
// The kept clips of one pattern's deaths, back to back, each in THE REVIEW'S
// OWN CLIP PLAYER (review/clip-player.js, loaded by this page too): the
// death marked on the timeline in --bad, the time as seconds from the death,
// a frame step, the speed, and the same keys while the clip has the focus.
// One player a clip, built on #mo-pl-stage as each clip comes up (the marks
// are the clip's own: its death and its frames, main's by the data), and
// advanced on `ended`, so the loop the review's clip has is taken off.
// Keyboard on the dialog: Esc closes, the arrows move between clips, Space
// plays and pauses; inside the clip, where the player heard the key first
// (defaultPrevented), the arrows move a second, as on the review. The page
// behind the dialog is inert while it is open, so Tab and Shift+Tab cycle
// inside it, and a focus that lands behind anyway is sent to the dialog's
// far end in the direction it was going. Opened only after a match: main is
// asked whether the window is sealed, and a sealed answer opens nothing.
// Leaving the page, or the page going hidden, closes it, so no clip plays
// where nobody is watching.
const player = {
  open: false, items: [], at: 0, title: '', returnTo: null,
};
let video = null;        // the clip now on the stage, its <video>
let backwards = false;   // the last Tab was Shift+Tab

/** The page's two parts behind the dialog, made inert while it is open. */
const behind = () => [...document.querySelectorAll('.sheet > header, .sheet > main')];

function playerSay(x) {
  const m = x && x.match;
  const who = m ? [m.title, m.map ? `on ${m.map}` : null].filter(Boolean).join(' ') : '';
  $('mo-pl-line').textContent = x ? `${who ? `${who}, ` : ''}round ${x.round}: ${x.title}${x.line ? `. ${x.line}` : ''}` : '';
  $('mo-pl-line').classList.remove('bad');
  $('mo-pl-count').textContent = player.items.length ? `${player.at + 1} of ${player.items.length}` : '';
  // What changed: the moment's line and its count fade in as a clip takes the
  // stage (moments.css .mo-swap), not under reduced motion.
  const Mo = window.Motion;
  if (Mo && !Mo.reduced()) {
    for (const n of [$('mo-pl-line'), $('mo-pl-count')]) { n.classList.remove('mo-swap'); void n.offsetWidth; n.classList.add('mo-swap'); }
  }
  $('mo-pl-prev').disabled = player.at <= 0;
  $('mo-pl-next').disabled = player.at >= player.items.length - 1;
}

/** The clip now on the stage let go: paused, its source dropped, its decoder freed. */
function releaseStage() {
  const stage = $('mo-pl-stage');
  if (window.ClipPlayer && typeof window.ClipPlayer.release === 'function') window.ClipPlayer.release(stage);
  else {
    for (const v of stage.querySelectorAll('video')) {
      try { if (typeof v.pause === 'function') v.pause(); } catch { /* no decoder */ }
      v.removeAttribute('src');
      if (typeof v.load === 'function') { try { v.load(); } catch { /* nothing loaded */ } }
    }
  }
}

/** One clip's player on the stage, in place of the last: the review's, with the death and the frames marked. */
function stageClip(x) {
  const stage = $('mo-pl-stage');
  releaseStage();
  stage.replaceChildren();
  const label = x.kind === 'highlight' ? `The highlight of round ${x.round}` : `The clip of round ${x.round}`;
  let v;
  if (window.ClipPlayer && typeof window.ClipPlayer.create === 'function') {
    // A highlight's kills and cuts are marked on its timeline (8.17), main's numbers.
    const p = window.ClipPlayer.create({ url: x.clip.url, death: x.clip.death, frames: x.clip.frames || null, label,
      kills: x.clip.kills || null, cuts: x.clip.cuts || null });
    v = p.video;
    // Back to back, never round: the next clip follows on `ended`.
    v.removeAttribute('loop');
    v.loop = false;
    stage.append(p.el);
  } else {
    v = document.createElement('video');
    v.muted = true;
    for (const a of ['muted', 'playsinline']) v.setAttribute(a, '');
    v.setAttribute('preload', 'metadata');
    v.setAttribute('aria-label', label);
    v.setAttribute('src', x.clip.url);
    stage.append(v);
  }
  v.id = 'mo-video';
  v.addEventListener('ended', () => { if (player.open && player.at < player.items.length - 1) playAt(player.at + 1); else setToggle(); });
  v.addEventListener('play', setToggle);
  v.addEventListener('pause', setToggle);
  video = v;
  return v;
}

function playAt(i) {
  if (!player.open || !player.items.length) return;
  player.at = Math.max(0, Math.min(player.items.length - 1, i));
  const x = player.items[player.at];
  playerSay(x);
  const v = stageClip(x);
  const p = typeof v.play === 'function' ? v.play() : null;
  if (p && typeof p.catch === 'function') p.catch(() => { $('mo-pl-line').classList.add('bad'); $('mo-pl-line').textContent = 'This clip could not be played.'; });
  setToggle();
}

/** The toggle says what it does next, Play or Pause; its label is the whole of it. */
function setToggle() {
  const paused = !video || !!video.paused;
  $('mo-pl-toggle').textContent = paused ? 'Play' : 'Pause';
}

async function openPlayer(c) {
  // Nothing plays mid match: the seal is main's word.
  let sealed = false;
  try { const s = typeof api.getShell === 'function' ? await api.getShell() : null; sealed = !!(s && s.sealed); } catch { sealed = false; }
  if (sealed) return;
  const all = momentByKey();
  const items = (c.items || []).map((k) => all.get(k)).filter((x) => x && x.clip);
  if (!items.length) return;
  closeMenu(false);
  closeStore(false);
  player.items = items;
  player.title = c.title;
  player.returnTo = document.activeElement;
  player.open = true;
  heroWake();
  $('mo-pl-title').textContent = c.title;
  const host = $('mo-player');
  host.hidden = false;
  // Painted hidden first, so the fade runs from there.
  void host.offsetWidth;
  host.classList.add('open');
  for (const n of behind()) { n.inert = true; n.setAttribute('inert', ''); }
  playAt(0);
  $('mo-pl-close').focus();
}

function closePlayer() {
  if (!player.open) return;
  player.open = false;
  releaseStage();
  const host = $('mo-player');
  host.classList.remove('open');
  host.hidden = true;
  for (const n of behind()) { n.inert = false; n.removeAttribute('inert'); }
  const back = player.returnTo;
  player.returnTo = null;
  player.items = [];
  if (back && typeof back.focus === 'function' && back.isConnected !== false) back.focus();
  heroWake();
}

$('mo-pl-close').addEventListener('click', closePlayer);
$('mo-pl-prev').addEventListener('click', () => playAt(player.at - 1));
$('mo-pl-next').addEventListener('click', () => playAt(player.at + 1));
$('mo-pl-toggle').addEventListener('click', () => {
  if (!player.open || !video) return;
  if (video.paused) { const p = typeof video.play === 'function' ? video.play() : null; if (p && p.catch) p.catch(() => {}); }
  else if (typeof video.pause === 'function') video.pause();
  setToggle();
});
$('mo-pl-open').addEventListener('click', () => {
  const x = player.items[player.at];
  if (!x) return;
  closePlayer();
  api.openReview(x.id, x.round);
});
// The veil closes it, the panel does not.
$('mo-player').addEventListener('click', (e) => { if (e.target === $('mo-player')) closePlayer(); });
document.addEventListener('keydown', (e) => {
  if (e.key === 'Tab') backwards = !!e.shiftKey;
  // The confirm first: Esc is its safe answer.
  if (cf.open) {
    if (e.key === 'Escape') { e.preventDefault(); closeConfirm(); }
    return;
  }
  if (!player.open) {
    if (e.key === 'Escape' && !$('mo-store').hidden) { e.preventDefault(); closeStore(true); }
    return;
  }
  if (e.altKey || e.ctrlKey || e.metaKey) return;
  // Heard first by the clip's own player (the arrows a second, Space a pause): its word.
  if (e.defaultPrevented) return;
  const k = e.key;
  if (k === 'Escape') { e.preventDefault(); closePlayer(); return; }
  if (k === 'ArrowRight') { e.preventDefault(); playAt(player.at + 1); return; }
  if (k === 'ArrowLeft') { e.preventDefault(); playAt(player.at - 1); return; }
  const onButton = e.target && e.target.tagName === 'BUTTON';
  if ((k === ' ' || k === 'Spacebar') && !onButton) { e.preventDefault(); $('mo-pl-toggle').click(); }
});
// Keep the keyboard inside the player (or the confirm) while it is open: a
// focus that lands behind it goes to the dialog's far end in the direction it
// was travelling, so Shift+Tab from Close reaches the controls as Tab does.
function focusables(host) {
  return [...host.querySelectorAll('button, input, [tabindex]:not([tabindex="-1"])')]
    .filter((n) => !n.disabled && !n.hidden && !n.closest('[hidden]'));
}
document.addEventListener('focusin', (e) => {
  const host = cf.open ? $('mo-confirm') : player.open ? $('mo-player') : null;
  if (!host || host.contains(e.target)) return;
  const list = focusables(host);
  const to = backwards ? list[list.length - 1] : list[0];
  (to || (cf.open ? $('mo-cf-no') : $('mo-pl-close'))).focus();
});
// Out of sight, nothing plays: the player closes, the hero holds.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') { closePlayer(); closeMenu(false); }
  heroWake();
});
if (typeof api.onPage === 'function') {
  api.onPage((m) => {
    if (!m) return;
    if (m.phase === 'leave' || m.phase === 'arm') { closePlayer(); closeMenu(false); closeStore(false); pageOn = false; heroWake(); }
    else if (m.phase === 'enter') { pageOn = true; heroWake(); refreshStorage(false); }
  });
}
// Still while a match is recorded (html.rec-still), and whenever ambient
// motion is off: the hero's loop holds with the rest of the app's motion.
if (window.Motion && typeof window.Motion.onAmbient === 'function') window.Motion.onAmbient(() => heroWake());

// A page of the main window has no window of its own to close.
const closeWindow = () => { if (!(window.occlaraEmbedded && window.occlaraEmbedded())) api.close(); };
$('close').addEventListener('click', closeWindow);

(async () => {
  const st = await api.getState().catch(() => null);
  const games = typeof api.games === 'function' ? api.games() : [];
  game = (st && st.gameId) || (games[0] && games[0].id) || 'valorant';
  await load();
  refreshStorage(true);
  // A review saved or improved (Riot's record landing, a look taken, a clip
  // cut or deleted) repaints the page; so does a change of game.
  // A poster made (Orbit): the page shows it, unless the player is open, where a repaint would cut in.
  if (typeof api.onReviews === 'function') {
    api.onReviews((msg) => {
      if (msg && msg.posters && !$('mo-player').hidden) return;
      load();
      if (!(msg && msg.posters)) refreshStorage(!!(msg && msg.removed));
    });
  }
  if (typeof api.onReviewWork === 'function') api.onReviewWork((m) => { if (m && !m.work) load(); });
  if (typeof api.onGame === 'function') {
    api.onGame((g) => {
      if (g && g.id) {
        game = g.id;
        Object.assign(state, { pattern: null, map: '', agent: '', result: '' });
        closePlayer();
        closeMenu(false);
        load();
      }
    });
  }
  console.log('[moments] ready');
})();

'use strict';

/*
 * THE MOMENTS PAGE (8.7). The player's deaths and highlights, compiled from
 * the saved reviews by main (src/shared/moments.js), newest match first.
 *
 * Under each match's ruled line its moments: a death with what the coach saw
 * there (its cause from the closed list, or Riot's facts), when in the round
 * it came, the mark of each repeated mistake it belongs to, and the clip of it
 * where one was kept; a highlight Riot's record proves (a 2K, 3K, 4K or 5K round,
 * a clutch won, the first kill rounds running). A row opens its
 * review at that round. Over the list the compilation by repeated mistake,
 * with Play all, which plays the kept clips of those deaths back to back in a
 * player over the page: Esc closes it, the arrows move, Space plays and
 * pauses. The filter is a row of secondary rectangles, a radiogroup (8.8).
 *
 * Nothing here counts: every title, line and number is main's. And nothing
 * here plays mid match: the seal hides the page, the player asks main whether
 * the window is sealed before it opens, and leaving the page closes it.
 */

const $ = (id) => document.getElementById(id);
const api = window.occlara || {};
const { el, letter } = window.GradeView;

// The empty states' words, each heading the next thing to do (8.8); every
// other line on the page is main's (moments.js NOTES and GONE come with the
// data).
const EMPTY = {
  none: ['Press Start before your next match', 'When it ends, its deaths and highlights land here with its review.'],
  quiet: ['Record your next match', "Your saved matches have no deaths or highlights on record yet. A match checked against Riot's record fills this page."],
};

let game = null;
let data = null;
let ask = 0;
const state = { kind: 'all', pattern: null };
let risen = false;  // the rows rise on the page's first entry alone (8.8)

// Dates, times and counts through one helper (shared/intl.js, 8.8), in the
// interface's language; the fallbacks are for a page loaded without it.
const INTL = window.occlaraIntl || null;
const fmtDay = (at) => (INTL ? INTL.date(at) : new Date(at).toLocaleDateString([], { month: 'short', day: 'numeric' }));
const fmtTime = (at) => (INTL ? INTL.time(at) : new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }));
/** One whole sentence for count n (intl.js plural), {n} and any {name} filled. */
function say(n, forms, values) {
  if (INTL) return INTL.plural(n, forms, values);
  const msg = n === 1 && forms.one != null ? forms.one : forms.other;
  return String(msg).replace(/\{(\w+)\}/g, (m, k) => (k === 'n' ? String(n) : values && k in values ? String(values[k]) : m));
}

const resultClass = (r) => {
  const s = String(r || '').toLowerCase();
  return /victory|win|won/.test(s) ? 'win' : /defeat|loss|lost/.test(s) ? 'loss' : '';
};

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
  if (state.pattern && !list.some((c) => c.key === state.pattern)) state.pattern = null;
  for (const c of list) {
    const row = el('div', 'mo-crow');
    row.setAttribute('role', 'listitem');
    const pick = el('button', 'mo-cpick');
    pick.type = 'button';
    pick.dataset.key = c.key;
    pick.setAttribute('aria-pressed', String(state.pattern === c.key));
    pick.append(el('span', 'mo-ctitle', c.title), el('span', 'mo-cline', c.line));
    pick.title = state.pattern === c.key ? 'Show every moment again' : 'Show only these deaths';
    row.classList.toggle('on', state.pattern === c.key);
    pick.addEventListener('click', () => {
      state.pattern = state.pattern === c.key ? null : c.key;
      paintCompilation();
      paintList(false);
    });
    row.append(pick);
    // Play all is the row's tertiary action (8.8): text, not a capsule on
    // every row; the row's title is what chooses it.
    if (c.clips > 0) {
      // Named for what it plays (8.8 critique): "Play all" beside 80 deaths
      // promised 80 clips where one was kept.
      const words = c.clips === 1 ? `Play ${c.clips} clip` : `Play ${c.clips} clips`;
      const play = el('button', 'btn btn-link sm mo-playall', words);
      play.type = 'button';
      play.setAttribute('aria-label', c.clips === 1 ? `Play the kept clip of ${c.title}` : `Play the ${c.clips} kept clips of ${c.title}`);
      play.addEventListener('click', () => openPlayer(c));
      row.append(play);
    } else {
      row.append(el('span', 'mo-cnone', 'No clip kept'));
    }
    host.append(row);
  }
}

// ── The list ──────────────────────────────────────────────────────────────
function shown(x) {
  if (state.kind !== 'all' && x.kind !== state.kind) return false;
  if (state.pattern && !(x.kind === 'death' && x.repeats.some((r) => r.key === state.pattern))) return false;
  return true;
}

/*
 * THE MATCH'S LINE (8.8): the day in the margin, where its moments' rounds
 * are, the result and who and where as the line, the grade at its end.
 */
function matchHead(m) {
  const head = el('div', 'mo-mhead');
  const when = el('time', 'mo-when', fmtDay(m.at));
  when.title = `${fmtDay(m.at)}, ${fmtTime(m.at)}`;
  if (Number.isFinite(new Date(m.at).getTime())) when.setAttribute('datetime', new Date(m.at).toISOString());
  const line = el('div', 'mo-mline-head');
  const res = el('span', 'mo-res ' + resultClass(m.result));
  res.textContent = [m.result, m.score].filter(Boolean).join(' ') || 'No result';
  const who = el('span', 'mo-who', [[m.title, m.map ? `on ${m.map}` : null].filter(Boolean).join(' '), m.mode].filter(Boolean).join(', '));
  line.append(res, who);
  head.append(when, line);
  if (m.grade) {
    const g = el('span', 'mo-grade');
    g.append(el('b', 'mo-score', m.grade.score), letter(m.grade, { size: 'sm' }));
    g.title = m.grade.provisional ? 'Provisional grade' : 'Grade';
    head.append(g);
  }
  return head;
}

function momentRow(m, x) {
  const row = el('div', 'mo-row');
  row.dataset.key = x.key;
  const open = el('button', 'mo-open');
  open.type = 'button';
  open.setAttribute('aria-label', `${x.kind === 'death' ? 'Death' : 'Highlight'} in round ${x.round}: ${x.title}. Open the review at this round`);
  // THE MARGIN (8.8): the round and, under it, when in the round, figures
  // that read down the match; the words in the column beside them.
  const margin = el('span', 'mo-margin');
  margin.append(el('span', 'mo-round', `R${x.round}`));
  if (x.time) margin.append(el('span', 'mo-time', x.time));
  open.append(margin);
  const main = el('div', 'mo-main');
  const top = el('span', 'mo-mtop');
  // The kind as a word in its tone after the title, no dot before it.
  top.append(el('span', 'mo-mtitle', x.title), el('span', `mo-kind ${x.kind}`, x.kind === 'death' ? 'Death' : 'Highlight'));
  main.append(top);
  if (x.line) main.append(el('span', 'mo-mline', x.line));
  if (x.repeats && x.repeats.length) {
    // The repeated mistakes it belongs to, named in a quiet line, a comma
    // between two, the ones across matches a step brighter.
    const marks = el('div', 'mo-marks');
    x.repeats.forEach((r, i) => {
      if (i) marks.append(document.createTextNode(', '));
      const mk = el('span', 'mo-mark' + (r.across ? ' across' : ''), r.title);
      mk.title = r.across ? 'One of your repeated mistakes across matches' : 'Repeated in this match';
      marks.append(mk);
    });
    main.append(marks);
  }
  open.append(main);
  open.addEventListener('click', () => api.openReview(m.id, x.round));
  row.append(open);
  const clip = el('div', 'mo-clip');
  if (x.clip) {
    const b = el('button', 'icon-btn mo-play');
    b.type = 'button';
    b.title = `Play the clip of round ${x.round}`;
    b.setAttribute('aria-label', b.title);
    b.innerHTML = '<svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor" stroke="none" aria-hidden="true"><path d="M8 5.5v13l10.5-6.5z"/></svg>';
    b.addEventListener('click', () => openPlayer({ title: `${x.title}, round ${x.round}`, items: [x.key], clips: 1 }));
    clip.append(b);
  } else if (x.clipGone) {
    clip.append(el('span', 'mo-gone', x.clipGoneText || 'Clip gone'));
  }
  row.append(clip);
  return row;
}

/**
 * @param rise  the rows rise once, on the page's first entry (ui.css
 *              .rise-in, the shared stagger, held to its sixth step); every
 *              later paint, a visit, a filter, a change of game, draws them
 *              as they are
 */
function paintList(rise) {
  const host = $('mo-list');
  host.replaceChildren();
  // The clip column is only there while a clip is kept in these matches
  // (moments.css .clips): without one the time is the last column, on the rule.
  host.classList.toggle('clips', !!(data && data.counts && data.counts.clips > 0));
  const rows = [];
  for (const m of (data && data.matches) || []) {
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
    none.textContent = state.pattern ? 'No deaths of this pattern under the filter.'
      : state.kind === 'death' ? 'No deaths on record in these matches.'
        : state.kind === 'highlight' ? 'No highlights on record yet: a 2K, 3K, 4K or 5K round, a clutch won or the first kill rounds running.'
          : 'Nothing to show.';
  }
  if (rise && rows.length && !risen) {
    risen = true;
    const go = () => rows.forEach((r, i) => {
      if (!host.contains(r)) return;   // painted again meanwhile
      r.style.setProperty('--i', String(Math.min(i, 5)));
      r.classList.add('rise', 'rise-in');
    });
    if (typeof window.occlaraOnShown === 'function') window.occlaraOnShown(go); else go();
  }
}

function paintCounts() {
  const c = (data && data.counts) || { matches: 0, deaths: 0, highlights: 0, clips: 0 };
  const across = say(c.matches, { one: 'across {n} match', other: 'across {n} matches' });
  $('mo-counts').textContent = [
    say(c.deaths, { one: '{n} death', other: '{n} deaths' }),
    say(c.highlights, { one: '{n} highlight', other: '{n} highlights' }),
    `${say(c.clips, { one: '{n} clip', other: '{n} clips' })} ${across}`,
  ].join(', ');
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
    const [title, hint] = matches.length ? EMPTY.quiet : EMPTY.none;
    $('mo-empty-title').textContent = title;
    $('mo-empty-hint').textContent = hint;
    return;
  }
  paintCompilation();
  paintCounts();
  paintNote();
  paintList(first);
}

async function load() {
  const mine = ++ask;
  const got = await api.getMoments(game).catch(() => null);
  if (mine !== ask) return;
  data = got && !got.error ? got : { matches: [], compilation: [], counts: { matches: 0, deaths: 0, highlights: 0, clips: 0 }, clipsNote: null };
  paint(!risen);
}

// ── The filter ────────────────────────────────────────────────────────────
// A radiogroup, ui.css's row of words (8.8): a click chooses, the arrow
// keys (Home and End to the ends) move the choice and the focus with it, and
// the chosen one is the group's one tab stop.
const filterButtons = () => [...$('mo-filter').querySelectorAll('button')];
function chooseKind(b) {
  state.kind = b.dataset.kind || 'all';
  for (const o of filterButtons()) {
    o.setAttribute('aria-checked', String(o === b));
    o.tabIndex = o === b ? 0 : -1;
  }
  paintList(false);
}
for (const b of filterButtons()) b.addEventListener('click', () => { if (b.getAttribute('aria-checked') !== 'true') chooseKind(b); });
$('mo-filter').addEventListener('keydown', (e) => {
  const all = filterButtons();
  const at = all.indexOf(document.activeElement);
  if (at < 0) return;
  const next = { ArrowRight: at + 1, ArrowDown: at + 1, ArrowLeft: at - 1, ArrowUp: at - 1, Home: 0, End: all.length - 1 }[e.key];
  if (next === undefined) return;
  e.preventDefault();
  const to = all[(next + all.length) % all.length];
  to.focus();
  chooseKind(to);
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
  const label = `The clip of round ${x.round}`;
  let v;
  if (window.ClipPlayer && typeof window.ClipPlayer.create === 'function') {
    const p = window.ClipPlayer.create({ url: x.clip.url, death: x.clip.death, frames: x.clip.frames || null, label });
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
  player.items = items;
  player.title = c.title;
  player.returnTo = document.activeElement;
  player.open = true;
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
  if (!player.open) return;
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
// Keep the keyboard inside the player while it is open: a focus that lands
// behind it goes to the dialog's far end in the direction it was travelling,
// so Shift+Tab from Close reaches the controls as Tab does.
function focusables() {
  return [...$('mo-player').querySelectorAll('button, input, [tabindex]:not([tabindex="-1"])')]
    .filter((n) => !n.disabled && !n.hidden && !n.closest('[hidden]'));
}
document.addEventListener('focusin', (e) => {
  if (!player.open) return;
  if ($('mo-player').contains(e.target)) return;
  const list = focusables();
  const to = backwards ? list[list.length - 1] : list[0];
  (to || $('mo-pl-close')).focus();
});
// Out of sight, nothing plays.
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') closePlayer(); });
if (typeof api.onPage === 'function') api.onPage((m) => { if (m && (m.phase === 'leave' || m.phase === 'arm')) closePlayer(); });

// A page of the main window has no window of its own to close.
const closeWindow = () => { if (!(window.occlaraEmbedded && window.occlaraEmbedded())) api.close(); };
$('close').addEventListener('click', closeWindow);

(async () => {
  const st = await api.getState().catch(() => null);
  const games = typeof api.games === 'function' ? api.games() : [];
  game = (st && st.gameId) || (games[0] && games[0].id) || 'valorant';
  await load();
  // A review saved or improved (Riot's record landing, a look taken, a clip
  // cut) repaints the page; so does a change of game.
  if (typeof api.onReviews === 'function') api.onReviews(() => load());
  if (typeof api.onReviewWork === 'function') api.onReviewWork((m) => { if (m && !m.work) load(); });
  if (typeof api.onGame === 'function') api.onGame((g) => { if (g && g.id) { game = g.id; state.pattern = null; closePlayer(); load(); } });
  console.log('[moments] ready');
})();

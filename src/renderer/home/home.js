'use strict';

/*
 * Home: paints what src/shared/home-model.js read from the library (the
 * preload hands it over whole). textContent only, because the focus line and
 * the mistake titles come from reviews a model helped write.
 */

const $ = (id) => document.getElementById(id);
const GV = window.GradeView;
const el = (tag, cls, text) => GV.el(tag, cls, text);
const SVG = 'http://www.w3.org/2000/svg';

let game = 'valorant';
let cfg = null;
// The RR of each rated match, by review id, from the last rank answer, kept so
// a repaint shows them at once instead of blinking out until it is asked again.
let rr = {};
// Every paint asks for the rank again, and only the newest answer is painted.
let rankAsk = 0;
// And every paint reads the library again, and only the newest read is
// painted: a change of game while the last read was out left that one to land
// after it, painting the game left behind under the new game's name.
let paintAsk = 0;
// The cards are to arrive with the next paint that lands (arrive()), so a
// paint that was to bring them in and was overtaken hands that on.
let arriving = false;
// The last match's id, for its RR chip and the Fix card's Open review.
let lastId = null;

/*
 * THE NEWEST RATED MATCH WITHOUT ITS RR (8.2.1) is asked about again once the
 * five minutes main and the server each keep the history are over, at most
 * twice after a paint (home-model.js rrWaiting says which match and why):
 * Riot puts the game in the history minutes after the match, after the reads
 * its review's saves make. Each paint sets it going again.
 */
const RANK_AGAIN_MS = 6 * 60 * 1000;
const RANK_AGAIN_TRIES = 2;
let rankAgain = null;
let rankTries = 0;

function when(at) {
  if (!at) return '';
  return new Date(at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}
const isWin = (result) => /vict|win/i.test(String(result || ''));
const isLoss = (result) => /defeat|loss/i.test(String(result || ''));

/** "+24 RR", "-15 RR", "0 RR", as the Stats rank tile writes it. */
const rrText = (change) => `${change > 0 ? '+' : ''}${change} RR`;
/** A gain in --good, a loss in --bad, no change dim (home.css). */
const rrTone = (change) => (change > 0 ? 'gain' : change < 0 ? 'loss' : 'even');

/** An agent's portrait, or nothing when the file is not bundled or fails to load. */
function portrait(src, cls, alt) {
  if (!src) return null;
  const img = document.createElement('img');
  img.className = cls;
  img.src = src;
  img.alt = alt || '';
  img.decoding = 'async';
  img.addEventListener('error', () => img.remove());
  return img;
}

/** A map's splash laid behind a card, under its scrim; nothing without one. */
function backdrop(host, src, at) {
  if (!src) return;
  const art = el('div', 'art');
  const img = portrait(src, 'art-img', '');
  if (!img) return;
  if (at) img.style.objectPosition = at;
  art.append(img, el('div', 'art-scrim'));
  host.prepend(art);
}

/** A grade's change since the match before it in the trend, or null without one. */
function deltaOf(trend, id) {
  const i = trend.findIndex((t) => t.id === id);
  if (i < 1) return null;
  const a = Number(trend[i].score), b = Number(trend[i - 1].score);
  return Number.isFinite(a) && Number.isFinite(b) ? a - b : null;
}
function deltaEl(d) {
  if (d === null) return null;
  return el('span', 'delta ' + (d > 0 ? 'up' : d < 0 ? 'down' : 'even'), `${d > 0 ? '+' : ''}${d}`);
}

/**
 * THE LAST MATCH (Progress v3): its map dimmed behind it, the result and the
 * map as chips with the RR at the right once the rank has answered, the
 * agent's portrait and name, the grade large with its letter and its change
 * since the match before, the eye and Open review, and the grade line at its
 * foot. STILL BEING CHECKED (8.4.1): its result, score and grade are the
 * screen's until the review is whole, so the card says what it waits for in
 * their place, as its review page shows a loading screen.
 */
function paintLast(last, model) {
  const host = $('last');
  host.replaceChildren();
  const art = (model.art && model.art.last) || {};
  backdrop(host, art.map, 'center 40%');
  const inner = el('div', 'in');
  const head = el('div', 'last-head');
  head.append(el('span', 'label', `Last match${last.at ? ', ' + when(last.at) : ''}`));
  if (last.result && !last.work) {
    const res = el('span', 'chip result ' + (isWin(last.result) ? 'win' : isLoss(last.result) ? 'loss' : ''));
    res.append(document.createTextNode(last.result + ' '));
    if (last.score) res.append(el('span', 'score', String(last.score).split('-').map((x) => x.trim()).join(' : ')));
    head.append(res);
  }
  if (last.map) head.append(el('span', 'chip', last.map));
  // The mode is the who line's (Standard, Competitive), not a third chip.
  // The RR the match moved, once the rank has answered (fillRank), and
  // nothing at all where Riot's record has none.
  const rrChip = el('span', 'rr-chip last-rr');
  rrChip.hidden = true;
  head.append(rrChip);
  inner.append(head);

  const who = el('div', 'last-who');
  const face = portrait(art.agent, 'agent-face lg', last.title || '');
  if (face) who.append(face);
  if (last.title) {
    const names = el('div', 'who-names');
    names.append(el('b', 'who-name', last.title), el('span', 'who-sub', ['Your last agent', last.mode].filter(Boolean).join(' · ')));
    who.append(names);
  }
  if (who.childNodes.length) inner.append(who);

  const checking = last.work ? GV.checking(last.work, { full: true }) : null;
  const row = el('div', 'last-grade-row');
  if (checking) row.append(checking);
  else if (last.grade) {
    const g = el('div', 'gv-grade last-grade');
    g.title = 'Match grade, out of 100, from what the record shows';
    g.append(el('span', 'gv-score big', String(last.grade.score)));
    const side = el('span', 'grade-side');
    side.append(GV.letter(last.grade, { size: 'sm' }));
    const d = deltaEl(deltaOf(model.trend || [], last.id));
    if (d) { d.title = 'Since the match before'; side.append(d); }
    g.append(side);
    row.append(g);
  }
  // THE K/D OF THE LAST GAME (9.0, the player's ask): kills over deaths from
  // the review's own scoreline (home-model.js kdOf), and nothing at all
  // without one or while the review is still being checked.
  const kd = !checking && last.kd ? last.kd : null;
  if (kd) {
    const box = el('div', 'last-kd');
    box.title = `${kd.kills} kills and ${kd.deaths} deaths in your last match`;
    box.append(el('span', 'kd-label', 'K/D'));
    const nums = el('span', 'kd-nums');
    nums.append(el('b', 'kd-ratio', kd.ratio), el('span', 'kd-split', `${kd.kills} / ${kd.deaths}`));
    box.append(nums);
    row.append(box);
  }
  /*
   * THE FOOT CARRIES TWO BUTTONS AND NOTHING ELSE (8.2.1): the eye, "View
   * match", which opens the match's AI log as its row in Matches does, and
   * Open review. No eye where nothing was recorded, a match graded from
   * Riot's record alone, and a disabled one with its reason once the log no
   * longer holds the match: the rule every eye follows (shared/log-eye.js).
   */
  const foot = el('div', 'last-foot');
  const eye = window.LogEye ? window.LogEye.labelled(last.aiLog, () => window.occlara.openAiLog(last.id), 'View match') : null;
  if (eye) foot.append(eye);
  const open = el('button', 'btn btn-ghost sm', 'Open review');
  open.type = 'button';
  open.addEventListener('click', () => window.occlara.openReview(last.id));
  foot.append(open);
  inner.append(row);

  const lineHost = el('div', 'last-line-host');
  const svg = !last.work ? GV.gradeLine(model.trend || [], 400, 112) : null;
  if (svg) lineHost.append(svg);
  const under = el('div', 'last-under');
  if (svg && typeof model.average === 'number') under.append(el('span', 'line-avg', `Average ${model.average}`));
  under.append(foot);
  lineHost.append(under);
  inner.append(lineHost);
  host.append(inner);
}

/*
 * THE FIX FOR NEXT MATCH, over its picture: the kept clip's poster of the
 * first death the coach looked at, with the round and where, and a play
 * mark that opens the review at that round, where the clip plays. With no
 * clip and no still kept (disk space, Clear clips, a match graded from
 * Riot's record) the map stands in, and says the clip was not kept when
 * only its stills stayed. THE FIX STAYS WHILE A REVIEW IS WRITTEN (8.7): the
 * last whole review's, its label saying so.
 */
function paintFix(model) {
  const host = $('focus');
  host.hidden = !model.focus;
  if (!model.focus) { stopClip(); return; }
  host.querySelector('.label').textContent = model.focusPrevious ? 'Fix for next match, from the last review' : 'Fix for next match';
  $('focus-text').textContent = model.focus;
  const media = $('fix-media');
  const fix = model.focusPrevious ? null : model.fix;
  const art = (model.art && model.art.last) || {};
  // A clip already playing here is the same clip after a repaint (a review
  // saved, Riot's record landing): it plays on rather than going back to
  // its poster under the player's eyes.
  if (fix && fix.url && media.dataset.playing === fix.url) return;
  stopClip();
  media.replaceChildren();
  host.classList.toggle('no-media', !(fix && fix.poster) && !art.map);
  if (fix && fix.poster) {
    const img = portrait(fix.poster, 'fix-poster', `Round ${fix.round}, the moment before the death`);
    if (img) media.append(img);
  } else if (art.map) {
    const img = portrait(art.map, 'fix-poster map', '');
    if (img) media.append(img, el('div', 'art-scrim'));
  }
  if (fix) {
    const chips = el('div', 'fix-chips');
    chips.append(el('span', 'chip over', `Round ${fix.round}${fix.place ? ' · Died at ' + fix.place : ''}`));
    if (!fix.clip) chips.append(el('span', 'chip over quiet', 'Clip not kept'));
    media.append(chips);
    if (fix.clip) {
      // PLAYED RIGHT HERE (9.0, the player's ask): the play mark puts the
      // review's own clip player (review/clip-player.js, the Moments page's
      // and Ask Coach's too) in the poster's place, with the death marked on
      // its timeline. Without the player or the clip's URL it opens the
      // review at that round, where the clip plays, as it did before.
      const inline = !!(fix.url && window.ClipPlayer && typeof window.ClipPlayer.create === 'function');
      const play = el('button', 'play-mark');
      play.type = 'button';
      play.title = inline ? 'Play the clip' : 'Play it in the review';
      play.setAttribute('aria-label', inline ? `Play the clip of round ${fix.round}` : `Play the clip of round ${fix.round} in the review`);
      play.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M8 5.2v13.6a.6.6 0 0 0 .93.5l10.2-6.8a.6.6 0 0 0 0-1l-10.2-6.8A.6.6 0 0 0 8 5.2z"/></svg>';
      play.addEventListener('click', () => {
        if (inline) playClip(fix);
        else window.occlara.openReview(model.last.id, fix.round);
      });
      media.append(play);
    }
  }
}

/** The clip on the Fix card stopped and let go, so no decoder runs behind a repaint. */
function stopClip() {
  const media = $('fix-media');
  delete media.dataset.playing;
  media.classList.remove('playing');
  if (window.ClipPlayer && typeof window.ClipPlayer.release === 'function') window.ClipPlayer.release(media);
}

/**
 * The Fix card's clip played in place of its poster, in the review's own
 * player: muted and looping as every clip is, the poster its picture until
 * the first frame, the death marked on the timeline, the same keys. The
 * round and the place stay above it as a line, and the card's Open review
 * still opens the whole review.
 */
function playClip(fix) {
  const media = $('fix-media');
  stopClip();
  media.replaceChildren();
  const label = `The clip of round ${fix.round}`;
  const p = window.ClipPlayer.create({ url: fix.url, poster: fix.poster || null, death: fix.death, frames: fix.frames || null, label });
  media.dataset.playing = fix.url;
  media.classList.add('playing');
  media.append(el('span', 'fix-clip-line', `Round ${fix.round}${fix.place ? ' · Died at ' + fix.place : ''}`), p.el);
  const v = p.video;
  if (v && typeof v.play === 'function') {
    const tried = v.play();
    if (tried && typeof tried.catch === 'function') tried.catch(() => {});
  }
  try { p.el.focus({ preventScroll: true }); } catch { /* not focusable here */ }
}

/*
 * THE PLAYER'S OWN RIOT ID (9.0, the player's ask), from Settings (the state
 * main pushes carries it): the name, then its tag quieter. Only ever the ID
 * in Settings, never another player's. Without a whole one (Name#TAG), a
 * quiet Connect your Riot ID that opens Settings, where it is set.
 */
function paintPlayer(riotId) {
  const id = String(riotId || '').trim();
  const at = id.lastIndexOf('#');
  const name = at > 0 ? id.slice(0, at).trim() : '';
  const tag = at > 0 ? id.slice(at + 1).trim() : '';
  const whole = !!(name && tag);
  const host = $('h-player');
  host.hidden = !whole;
  $('h-player-connect').hidden = whole;
  host.replaceChildren();
  if (!whole) return;
  host.title = 'Your Riot ID, from Settings';
  host.append(el('span', 'hp-name', name), el('span', 'hp-tag', `#${tag}`));
}

/** The most repeated mistakes, each with how often it happened. */
function paintMistakes(model) {
  const list = Array.isArray(model.mistakes) ? model.mistakes : [];
  $('top').hidden = !list.length;
  const host = $('top-list');
  host.replaceChildren();
  for (const m of list) {
    const row = el('div', 'top-row');
    row.setAttribute('role', 'listitem');
    row.append(el('span', 'top-mark'), el('span', 'top-title', m.title));
    if (typeof m.total === 'number') {
      const n = el('span', 'top-n', `${m.total}x`);
      if (typeof m.matches === 'number' && typeof model.recorded === 'number') n.title = `In ${m.matches} of your last ${model.recorded} recorded matches`;
      row.append(n);
    }
    host.append(row);
  }
}

function paintRecent(recent, model) {
  const host = $('recent-list');
  host.replaceChildren();
  const rows = (model && model.art && model.art.rows) || {};
  recent.forEach((m, j) => {
    const b = el('button', 'r-row');
    b.type = 'button';
    b.setAttribute('role', 'listitem');
    b.dataset.id = m.id;
    // Its place in the list (--j), for the rows to rise one after another as
    // the section arrives (home.css), and never on a repaint.
    b.style.setProperty('--j', String(j));
    const face = portrait(rows[m.id] && rows[m.id].agent, 'agent-face sm', m.title || '');
    if (face) b.append(face);
    const main = el('span', 'r-main');
    const title = el('span', 'r-title', [m.title, m.map].filter(Boolean).join(' on ') || 'Match');
    // Still being checked (8.4.1): the screen's result and grade are not said
    // until Riot's record has had its say, the pill in their place.
    if (m.result && !m.work) {
      title.append(el('span', 'r-res ' + (isWin(m.result) ? 'win' : isLoss(m.result) ? 'loss' : ''),
        [m.result, m.score].filter(Boolean).join(' ')));
    }
    // Its marks (8.7, home-model.js marks): "Best in 23", "First A", "3 in a
    // row". None while the match is still being checked.
    if (!m.work && Array.isArray(m.marks)) {
      for (const k of m.marks) {
        if (!k || typeof k.text !== 'string' || !k.text) continue;
        const mark = el('span', 'r-mark' + (k.kind ? ' ' + k.kind : ''), k.text);
        mark.title = k.text;
        title.append(mark);
      }
    }
    main.append(title);
    main.append(el('span', 'r-meta', [when(m.at), m.mode,
      m.source === 'riot' ? "from Riot's record" : m.verified ? "checked against Riot's record" : null].filter(Boolean).join('  ·  ')));
    b.append(main);
    // The RR the match moved, beside its grade, once the rank has answered.
    b.append(el('span', 'r-rr'));
    const checking = m.work ? GV.checking(m.work) : null;
    const g = m.grade;
    if (checking) b.append(checking);
    else {
      b.append(el('span', 'r-score', g ? String(g.score) : '--'));
      b.append(el('span', 'gv-letter ' + (g ? GV.gradeTone(g) : 'none'), g ? g.letter : '?'));
    }
    b.addEventListener('click', () => window.occlara.openReview(m.id));
    host.append(b);
  });
  paintRowRR();
}

/** Each recent match's RR, and the last match's chip, from the last rank answer; nothing where none is known. */
function paintRowRR() {
  for (const b of $('recent-list').querySelectorAll('.r-row')) {
    const span = b.querySelector('.r-rr');
    if (!span) continue;
    const change = rr[b.dataset.id];
    const known = typeof change === 'number' && Number.isFinite(change);
    span.hidden = !known;
    span.textContent = known ? rrText(change) : '';
    span.className = 'r-rr' + (known ? ' ' + rrTone(change) : '');
    span.title = known ? 'RR from this match' : '';
  }
  const chip = document.querySelector('#last .last-rr');
  if (chip) {
    const change = lastId ? rr[lastId] : null;
    const known = typeof change === 'number' && Number.isFinite(change);
    chip.hidden = !known;
    chip.textContent = known ? `RR ${change > 0 ? '+' : ''}${change}` : '';
    chip.title = known ? 'RR from this match' : '';
  }
}

/*
 * THE RANK (8.2.1), Valorant's, with a Riot ID: the rank the newest rated game
 * left, the RR the last one moved and the RR inside the tier as a bar, by the
 * rules Stats keeps (home-model.js rankModel), and a way to the journey on
 * Stats. Filled in once the page is painted, because the history can be a
 * network read away, and gone without a rated game. RR only, never MMR.
 */
function paintRank(card) {
  const host = $('rank');
  const was = host.hidden;
  host.hidden = !card;
  if (card) {
    $('rank-tier').textContent = card.tier;
    const span = $('rank-rr');
    const known = typeof card.change === 'number' && Number.isFinite(card.change);
    span.hidden = !known;
    span.textContent = known ? rrText(card.change) : '';
    span.className = 'rr-chip rank-rr' + (known ? ' ' + rrTone(card.change) : '');
    const inTier = typeof card.rr === 'number' && Number.isFinite(card.rr) ? card.rr : null;
    $('rank-bar').hidden = inTier === null;
    $('rank-foot').hidden = inTier === null;
    if (inTier !== null) {
      $('rank-fill').style.width = `${Math.max(1, Math.min(100, inTier))}%`;
      $('rank-in').textContent = `${inTier} RR`;
      $('rank-to').textContent = `${100 - inTier} to the next rank`;
    }
  }
  closeUp();
  if (was && card) rise(host);
}

/** The row of the rank and the mistakes closes up as its cards go. */
function closeUp() {
  const row = $('rank').parentNode;
  row.hidden = $('rank').hidden && $('top').hidden;
  row.classList.toggle('single', $('rank').hidden !== $('top').hidden);
}

/*
 * THE ARRIVAL ENDS (8.7). card-in gates the rows', bars' and category fills'
 * entrances (home.css), and left on, a repaint (a review saved: load() with
 * no arrive) rebuilt them under it and they rose again, the list and the
 * trend vanishing for a moment on every save. So the class is taken off once
 * the longest entrance is through: every keyframe's end state is the natural
 * state, so nothing visible changes when it goes.
 */
const ARRIVAL_MS = 1200;
let arrivalEnd = null;
function endArrival(cards) {
  clearTimeout(arrivalEnd);
  arrivalEnd = setTimeout(() => {
    arrivalEnd = null;
    for (const c of cards) c.classList.remove('card-in');
  }, ARRIVAL_MS);
}

/** A card shown after the others arrived rises in by itself, as they did. */
function rise(card) {
  card.classList.remove('card-in');
  void card.offsetWidth;   // taken off and put back, so it plays again
  card.style.setProperty('--i', '0');
  card.classList.add('card-in');
  endArrival([...document.querySelectorAll('.home .card.card-in')]);
}

/**
 * The rank card and the recent matches' RR, asked for after the page is
 * painted. Only Valorant, and only with a Riot ID: the rank history is read
 * for the ID in Settings, and another game's Home has no rank of this kind.
 * Not asked while Home has no match to show, since nothing would show it.
 *
 * @param again  asked by its own timer for a match still waiting for its RR,
 *               not by a paint, so the tries already made still count
 */
async function fillRank(again) {
  const ask = ++rankAsk;
  clearTimeout(rankAgain);
  rankAgain = null;
  if (!again) rankTries = 0;
  const riot = game === 'valorant' && !$('content').hidden && String((cfg && cfg.riotId) || '').includes('#');
  const r = riot ? await window.occlara.getRank(game).catch(() => null) : null;
  if (ask !== rankAsk) return;   // a newer paint asked again meanwhile
  rr = (r && r.rr) || {};
  paintRank((r && r.card) || null);
  paintRowRR();
  if (r && r.waiting && rankTries < RANK_AGAIN_TRIES) {
    rankTries++;
    rankAgain = setTimeout(() => { rankAgain = null; fillRank(true); }, RANK_AGAIN_MS);
  }
}

/*
 * THE CARDS ARRIVE ONE AFTER ANOTHER (8.2), the first time Home is painted and
 * on a change of game, never when a review saved in the meantime repaints it.
 * Run once the page is on screen (embed.js), or they would play out while it
 * is still out of sight, waiting to come in.
 */
function arrive() {
  const run = () => {
    const cards = [...document.querySelectorAll('.home .card')].filter((c) => !c.hidden && !c.closest('[hidden]'));
    for (const c of cards) c.classList.remove('card-in');
    void document.body.offsetWidth;   // taken off and put back, so it plays again
    cards.forEach((c, i) => {
      c.style.setProperty('--i', String(i));
      c.classList.add('card-in');
    });
    endArrival(cards);
  };
  if (typeof window.occlaraOnShown === 'function') window.occlaraOnShown(run); else run();
}

/**
 * PAINTED FIRST, THEN THE RANK: the library is on this machine and the rank
 * history may be a network read away, so Home never waits for it. Asked for
 * before the cards arrive, so a card that is not this game's (the rank, after
 * a change of game) is gone before they do. A paint overtaken by a newer one
 * asks for nothing: the newer one does.
 *
 * @param opts.arrive  the cards come in one after another once painted
 */
async function load(opts) {
  if (opts && opts.arrive) arriving = true;
  if (!(await paint())) return;
  const ranked = fillRank();
  if (arriving) { arriving = false; arrive(); }
  await ranked;
}

/** @returns {Promise<boolean>} false when a newer paint was asked for meanwhile, and nothing was painted */
async function paint() {
  const ask = ++paintAsk;
  const [model, config] = await Promise.all([
    window.occlara.getHome(game).catch(() => null),
    window.occlara.getConfig().catch(() => null),
  ]);
  if (ask !== paintAsk) return false;
  cfg = config;
  const games = window.occlara.games();
  const g = games.find((x) => x.id === game);
  $('h-game').textContent = g ? g.label : '';
  const has = !!(model && model.last);
  $('empty').hidden = has;
  $('content').hidden = !has;
  if (!has) return true;
  lastId = model.last.id;
  paintLast(model.last, model);
  paintFix(model);
  $('last').parentNode.classList.toggle('single', $('focus').hidden);
  paintMistakes(model);
  closeUp();
  paintRecent(model.recent || [], model);
  return true;
}

$('top-more').addEventListener('click', () => window.occlara.go('patterns'));
$('fix-open').addEventListener('click', () => { if (lastId) window.occlara.openReview(lastId); });
// The Start strip: the same Start as the sidebar's (COACH_START).
$('h-start').addEventListener('click', () => { if (typeof window.occlara.startCoaching === 'function') window.occlara.startCoaching(); });
$('recent-all').addEventListener('click', () => window.occlara.go('matches'));
// Connect your Riot ID: Settings, where the Riot ID is set.
$('h-player-connect').addEventListener('click', () => window.occlara.go('settings'));
// Stats with the journey open, which this button names (8.4.1): it opened
// Stats with the journey folded in the Rank tile, one more click away.
$('rank-more').addEventListener('click', () => window.occlara.openRankJourney());
// The games left (8.7) are the rail's line under Start (shell.js), said once;
// Home carries no copy of it.

/*
 * LISTENING BEFORE THE FIRST PAINT (8.2.1). The first load waits for the rank,
 * a network read that can take fifteen seconds, and with the listeners set up
 * after it, a game picked in the sidebar meanwhile was never heard (PUSH_GAME
 * comes once, on the change), and Home stayed on the game left behind for the
 * session. So they are set up as soon as the state says which game Home is
 * for, and a paint overtaken by a newer one paints nothing (paint()).
 */
/*
 * THE UPDATE LINE: "Occlara updated to 8.7.3." and See what's new, main's
 * words, said once after an update (index.js changelogIpc). Main answers null
 * mid match or while sealed and pushes the line once the seal lifts; the line
 * counts as seen only once this page is on screen with it.
 */
function paintNews(n) {
  const line = n && typeof n.text === 'string' && n.text ? n : null;
  const host = document.getElementById('h-news');
  if (!host) return;
  host.hidden = !line;
  if (!line) return;
  document.getElementById('h-news-text').textContent = line.text;
  document.getElementById('h-news-open').textContent = line.link || "See what's new";
  const seen = () => { if (typeof window.occlara.newsSeen === 'function') window.occlara.newsSeen(line.version); };
  if (typeof window.occlaraOnShown === 'function') window.occlaraOnShown(seen); else seen();
}
document.getElementById('h-news-open').addEventListener('click', () => {
  if (typeof window.occlara.openWhatsNew === 'function') window.occlara.openWhatsNew();
});
if (typeof window.occlara.onNews === 'function') window.occlara.onNews(paintNews);
if (typeof window.occlara.getNews === 'function') {
  Promise.resolve(window.occlara.getNews()).then((n) => { if (n) paintNews(n); }).catch(() => {});
}

/*
 * THE START STRIP FOLLOWS THE RECORDING (Progress v3): ready, it is Start;
 * recording between matches (Home is sealed mid match), it says so and its
 * Start goes, Stop being the bar's.
 */
function paintStrip(s) {
  if (!s || typeof s.isCoaching !== 'boolean') return;
  const rec = s.isCoaching;
  $('start-strip').classList.toggle('recording', rec);
  document.querySelector('.ss-word').textContent = rec ? 'Recording' : 'Ready';
  document.querySelector('.ss-line').textContent = rec
    ? 'Occlara is recording. Your review opens here when the match ends. Stop is at the top right.'
    : 'Press Start before you queue. Occlara records the match and grades it when it ends.';
  $('h-start').hidden = rec;
}

(async () => {
  const state = await window.occlara.getState().catch(() => null);
  game = (state && state.gameId) || 'valorant';
  paintStrip(state);
  let riotId = String((state && state.riotId) || '').trim();
  paintPlayer(riotId);
  // A review saved or improved (Riot's record landing after the match, a match
  // graded from it) repaints Home, and so does a change of game, whose cards
  // arrive again.
  window.occlara.onReviews(() => load());
  // A review still being built moving on, or whole at last (8.4.1): its last
  // match card and its row say so, or show its grade.
  if (typeof window.occlara.onReviewWork === 'function') window.occlara.onReviewWork(() => load());
  window.occlara.onGame((g) => { if (g && g.id) { game = g.id; load({ arrive: true }); } });
  // A Riot ID changed in Settings is another account's rank, or none: the
  // state main pushes on every config write carries it, and only a change of
  // it paints Home again.
  if (typeof window.occlara.onState === 'function') {
    window.occlara.onState((s) => {
      paintStrip(s);
      if (!s || typeof s.riotId !== 'string' || s.riotId.trim() === riotId) return;
      riotId = s.riotId.trim();
      paintPlayer(riotId);
      load();
    });
  }
  await load({ arrive: true });
  console.log('[home] ready');
})();

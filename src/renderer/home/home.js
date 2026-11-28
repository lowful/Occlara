'use strict';

/*
 * Home: paints what src/shared/home-model.js read from the library (the
 * preload hands it over whole). textContent only, because the focus line and
 * the mistake titles come from reviews a model helped write.
 */

const $ = (id) => document.getElementById(id);
const GV = window.GradeView;
const el = (tag, cls, text) => GV.el(tag, cls, text);

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
/**
 * The grade's change on the match before: "+7" in --good, "-4" in --bad,
 * "Level" in the grey, under the grade's name, with the whole sentence in
 * its tooltip. Null with no match before.
 */
function deltaEl(d) {
  if (d === null) return null;
  const words = d > 0 ? `+${d}` : d < 0 ? `${d}` : 'Level';
  const s = el('span', 'delta ' + (d > 0 ? 'up' : d < 0 ? 'down' : 'even'), words);
  s.title = d > 0 ? `Up ${d} on your last match` : d < 0 ? `Down ${-d} on your last match` : 'Level with your last match';
  return s;
}

/** "13 : 11" from a saved "13-11", or '' without one. */
const scoreText = (score) => (score ? String(score).split('-').map((x) => x.trim()).join(' : ') : '');

/**
 * THE LAST MATCH (9.1, the owner's item 1). The whole card opens the match's
 * review (it is a link, from the keyboard too: home.js wires it once, below),
 * and the match is its body, with no buttons and no dead space: the map's
 * picture with the agent and the K/D over it; under it the result and the
 * score large ("Victory 13 : 11") with the agent, the map, the queue and
 * when; the grade at the right with its name and its change on the match
 * before; and one quiet line under all of it, main's own progress line
 * ("Best grade in your last 4") when it counted one. The RR the match moved
 * waits at the top right for the rank.
 *
 * NOT GRADED (9.1): a newest match with no grade (a recording stopped after
 * two rounds) says so where the grade would be, and why on the line under
 * (home-model.js noGradeOf), and still opens. STILL BEING CHECKED (8.4.1):
 * its result, score and grade are the screen's until the review is whole,
 * so the card says what it waits for in their place.
 */
function paintLast(last, model) {
  const host = $('last');
  host.replaceChildren();
  const art = (model.art && model.art.last) || {};
  const checking = last.work ? GV.checking(last.work, { full: true }) : null;
  const who = [last.title, last.map].filter(Boolean).join(' on ');
  host.classList.toggle('checking', !!checking);
  host.classList.toggle('ungraded', !checking && !last.grade);
  // No map picture (League, a map newer than the bundled art): the picture's
  // room goes to one slim line (home.css #last.no-map).
  host.classList.toggle('no-map', !art.map);

  const head = el('div', 'last-head');
  head.append(el('p', 'o-eyebrow', 'Last match'));
  // When, beside the eyebrow in the mono of times: "Today 9:25 PM", "Nov 22, 9:34 PM".
  if (last.at) {
    const day = dayWord(last.at);
    head.append(el('span', 'last-when', /^(Today|Yesterday)$/.test(day) ? `${day} ${timeWord(last.at)}` : when(last.at)));
  }
  // The RR the match moved, once the rank has answered (fillRank), and
  // nothing at all where Riot's record has none.
  const rrChip = el('span', 'rr-chip last-rr');
  rrChip.hidden = true;
  head.append(rrChip);
  host.append(head);

  // THE PICTURE: the map, the agent's head over its foot, the K/D at its top
  // right, and the way in, an arrow that comes in under the pointer.
  const media = el('div', 'lm-media' + (art.map ? '' : ' no-map'));
  const map = portrait(art.map, 'lm-map', '');
  if (map) media.append(map);
  media.append(el('span', 'lm-scrim'));
  const face = portrait(art.agent, 'lm-agent', '');
  if (face) media.append(face);
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
    media.append(box);
  }
  const cue = el('span', 'lm-open');
  cue.setAttribute('aria-hidden', 'true');
  cue.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';
  media.append(cue);
  host.append(media);

  if (checking) {
    host.append(checking);
  } else {
    // THE MATCH: the result and the score in their own line, large, then
    // who, the queue and when; the grade at the right.
    const lm = el('div', 'lm-row');
    const meta = el('div', 'lm-meta');
    const line = el('b', 'lm-result');
    if (last.result) {
      line.append(el('span', 'result ' + (isWin(last.result) ? 'win' : isLoss(last.result) ? 'loss' : ''), last.result));
      if (last.score) line.append(document.createTextNode(' '), el('span', 'score', scoreText(last.score)));
    } else line.textContent = who || 'Your last match';
    // Who, the queue and when; who only once, when the line above is not already it.
    meta.append(line, el('span', 'lm-who', [last.result ? who : null, last.mode].filter(Boolean).join(', ') || 'Recorded match'));
    lm.append(meta);
    if (last.grade) {
      const g = el('div', 'gv-grade last-grade');
      g.title = `${GV.GRADE_NAME}. ${GV.GRADE_TIP}`;
      const tone = GV.gradeTone(last.grade);
      g.append(el('span', 'gv-score big' + (tone ? ' ' + tone : '') + (last.grade.provisional ? ' prov' : ''), String(last.grade.score)));
      const side = el('span', 'grade-side');
      side.append(el('span', 'grade-name', GV.GRADE_NAME));
      const d = deltaEl(deltaOf(model.trend || [], last.id));
      if (d) side.append(d);
      g.append(side);
      lm.append(g);
    } else {
      // Not graded, said plainly where the grade would be; why, on the line under.
      const g = el('span', 'last-nograde chip quiet', 'Not graded');
      g.title = last.noGrade ? last.noGrade.text : 'This match has no grade';
      lm.append(g);
    }
    host.append(lm);
    // ONE QUIET LINE: why there is no grade, or main's own progress line.
    const milestone = model.milestone && typeof model.milestone.text === 'string' && model.milestone.text ? model.milestone.text : null;
    const note = !last.grade ? (last.noGrade ? last.noGrade.text : null) : milestone;
    if (note) {
      const p = el('p', 'lm-note' + (last.grade ? ' last-title mark ' + ((model.milestone && model.milestone.tone) || 'even') : ' why'), note);
      p.title = note;
      host.append(p);
    }
  }
  // Said whole to a screen reader: what the card is and where it goes.
  const said = checking ? 'being checked' : [last.result ? [last.result, scoreText(last.score)].filter(Boolean).join(' ') : null, who,
    last.grade ? `${GV.GRADE_NAME.toLowerCase()} ${last.grade.score}` : 'not graded'].filter(Boolean).join(', ');
  host.setAttribute('aria-label', `Last match, ${said}. Open its review`);
}
// THE WHOLE CARD OPENS THE REVIEW (9.1), the pointer or Enter or Space.
function openLast() { if (lastId) window.occlara.openReview(lastId); }
$('last').addEventListener('click', openLast);
$('last').addEventListener('keydown', (e) => {
  if (e.target !== $('last') || (e.key !== 'Enter' && e.key !== ' ')) return;
  e.preventDefault();
  openLast();
});

/*
 * A TREND'S ARROW (9.1, the owner's item 4): up, down or a flat line, in the
 * colour of what it means (getting better in --good, worse in --bad, steady
 * in the grey), and its words in a tooltip that says exactly what was
 * compared (home-model.js). `better` is the way that is good: up for the
 * grade, down for a mistake.
 */
const WAY_PATH = {
  up: '<path d="M12 19V5M6 11l6-6 6 6"/>',
  down: '<path d="M12 5v14M6 13l6 6 6-6"/>',
  flat: '<path d="M5 12h14"/>',
};
function wayMark(way, better, words, label) {
  const tone = way === 'flat' ? 'steady' : way === better ? 'better' : 'worse';
  const m = el('span', `way ${way} ${tone} has-tip`);
  m.setAttribute('role', 'img');
  m.setAttribute('aria-label', words);
  m.dataset.tip = words;
  m.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${WAY_PATH[way]}</svg>`;
  if (label) m.append(el('span', 'way-n', label));
  return m;
}

/*
 * A DAY IN WORDS (9.1, the owner's item 4: the axis showed times of day for
 * matches on different days): "Today", "Yesterday" or "Nov 22", for the last
 * match's eyebrow and the line under the trend. The trend's own axis names
 * each day once under its matches (shared/trend-chart.js), the time in its
 * tooltip.
 */
const dayKey = (at) => new Date(at).toDateString();
function dayWord(at) {
  const d = new Date(at), now = new Date();
  if (dayKey(d) === dayKey(now)) return 'Today';
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (dayKey(d) === dayKey(y)) return 'Yesterday';
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}
const timeWord = (at) => new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

/*
 * THE TREND (Orbit; 9.1): the last grades as the shared trend chart Matches
 * draws (shared/trend-chart.js, the moonlit area, the owner's pick in item
 * 21): one line, a dot a match, the newest the bright one with its number,
 * each day named once under its matches, and a tooltip under the pointer or
 * the arrow keys saying when, who, the result and the grade, a click or
 * Enter opening that match. Over it a title that is the fact it shows, their
 * average, with the grade's own arrow beside it (home-model.js
 * gradeTrendOf). With one graded match, the card goes.
 */
let trendChart = null;
function paintTrend(model) {
  const host = $('trend');
  const trend = (Array.isArray(model.trend) ? model.trend : []).filter((t) => Number.isFinite(Number(t.score)));
  const last = model.last;
  if (trendChart) { trendChart.destroy(); trendChart = null; }
  host.replaceChildren();
  host.hidden = !last || !!last.work || trend.length < 2;
  if (host.hidden) return;
  const n = trend.length;
  const mean = Math.round(trend.reduce((s, t) => s + Number(t.score), 0) / n);
  const head = el('div', 'trend-head');
  head.append(el('h3', 'o-title', `Averaging ${mean}`));
  const gt = model.gradeTrend;
  if (gt && WAY_PATH[gt.way]) {
    const label = gt.way === 'flat' ? 'Steady' : String(Math.abs(gt.delta));
    head.append(wayMark(gt.way, 'up', gt.words, label));
  }
  host.append(el('p', 'o-eyebrow', 'Trend'), head);
  const lineHost = el('div', 'trend-host');
  const dated = trend.every((t) => typeof t.at === 'number' && Number.isFinite(t.at));
  const oneDay = dated && trend.every((t) => dayKey(t.at) === dayKey(trend[0].at));
  const chartHost = el('div', 'trend-chart');
  lineHost.append(chartHost);
  host.append(lineHost);
  const points = trend.map((t, i) => ({
    id: t.id, grade: Number(t.score), at: dated ? t.at : null, provisional: !!t.provisional,
    agent: t.agent || null, map: t.map || null, result: t.result || null,
    scoreline: t.scoreline ? String(t.scoreline).replace(/\s*[-:]\s*/, ' : ') : null,
    delta: i > 0 ? Number(t.score) - Number(trend[i - 1].score) : null,
  }));
  // The grades it draws, oldest first, for a reader of the page (the site
  // proof's export): the chart labels only the newest.
  chartHost.dataset.grades = points.map((p) => p.grade).join(',');
  const word = n === 2 ? 'two' : n === 3 ? 'three' : n === 4 ? 'four' : n === 5 ? 'five' : String(n);
  if (window.TrendChart) {
    trendChart = window.TrendChart.draw(chartHost, points, {
      height: 150, average: mean, guides: [60, 70, 80, 90],
      label: `Grade over your last ${n} graded matches`,
      onOpen: (p) => { if (p && p.id) window.occlara.openReview(p.id); },
    });
  }
  const day = oneDay ? dayWord(trend[0].at) : null;
  const span = !day ? '' : day === 'Today' || day === 'Yesterday' ? `, all ${day.toLowerCase()}` : `, all on ${day}`;
  lineHost.append(el('span', 'line-avg', `Your last ${word} graded matches${span}`));
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
  // ORBIT: the fix itself is the hero now; this card is the moment behind it,
  // the first death the coach looked at, so it shows only with that moment.
  const fix = model.focusPrevious ? null : model.fix;
  host.hidden = !model.focus || !fix;
  if (host.hidden) { stopClip(); return; }
  host.querySelector('.label').textContent = 'The moment';
  $('focus-text').textContent = `Round ${fix.round}${fix.place ? ', you died at ' + fix.place : ', the first death the coach looked at'}`;
  const media = $('fix-media');
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
      play.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true"><path d="M10.43 6.98L17.18 10.78A1.4 1.4 0 0 1 17.18 13.22L10.43 17.02A1.4 1.4 0 0 1 8.34 15.8L8.34 8.2A1.4 1.4 0 0 1 10.43 6.98Z"/></svg>';
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

/*
 * THE HERO (Orbit): the fix for the next match split at its colon into a
 * headline and a grey sub line ("Enter second for a match" and "Let a
 * teammate or your utility take first contact, then trade."), Start and Open
 * last review, and the last match's agent in front of the moon. Without a
 * colon the whole fix is the headline. Before any match, the line that the
 * first fix lands here.
 */
const AGENT_KEY = 'agent';
function splitFix(text) {
  const s = String(text || '').trim();
  const at = s.indexOf(':');
  if (at < 1 || at > s.length - 3) return { head: s, sub: '' };
  const sub = s.slice(at + 1).trim();
  return { head: s.slice(0, at).trim(), sub: sub.charAt(0).toUpperCase() + sub.slice(1) };
}
/*
 * THE HERO'S WORDS WITHOUT A FIX (9.1). The owner's Home said "Your last
 * match is graded." over a two round recording with no grade. Each case says
 * what is true: graded, still being checked, or not graded and why.
 */
function heroWords(model) {
  const last = model && model.last;
  if (!last) return { head: 'Play one match and your first fix lands here.', sub: '' };
  if (last.work) return { head: 'Your last match is being checked.', sub: 'Its grade and your fix land here when the review is done.' };
  if (!last.grade) return { head: 'Your last match was not graded.', sub: last.noGrade ? last.noGrade.text : 'Play a full match for a grade and a fix.' };
  return { head: 'Your last match is graded.', sub: 'Open its review for every round.' };
}
function paintHero(model) {
  const has = !!(model && model.last);
  const fix = has && model.focus ? splitFix(model.focus) : null;
  // 9.1, the owner's item 8: no "Your fix for next match" label. The kicker
  // speaks only when the fix is an older review's, and says whose.
  const from = has && fix && model.focusPrevious ? model.focusFrom : null;
  $('h-kicker').textContent = from === 'ungraded' ? 'From your last graded match' : from === 'writing' ? 'From your last review, while this one is checked' : '';
  $('h-kicker').hidden = !from;
  const words = fix || heroWords(model);
  $('h-fix-head').textContent = words.head;
  $('h-fix-sub').textContent = words.sub;
  $('h-open').hidden = !has;
  // The agent in front of the moon: the last match's, standing (its full
  // portrait), or its head icon in the ring when there is no portrait.
  const host = $('h-agent');
  const art = has && model.art && model.art.last ? model.art.last : null;
  const full = art ? art.full || null : null;
  const face = art ? art.agent || null : null;
  const key = `${full || ''}|${face || ''}`;
  if ((host.dataset[AGENT_KEY] || '') !== key) {
    host.dataset[AGENT_KEY] = key;
    putAgent(host, full, face);
  }
}

/*
 * THE AGENT, STANDING (Orbit): the full portrait (assets/agents-full, cut to
 * the figure, sync:agentportraits) in front of the moon's lit limb, fading in
 * once it has decoded and floating slowly (motion.css m-drift, still while a
 * match is recorded, the window is hidden or less motion is asked for). A
 * portrait that fails to load gives way to the head icon in its ring, and an
 * icon that fails too leaves nothing.
 */
function putAgent(host, full, face) {
  const ring = () => {
    host.replaceChildren();
    host.classList.remove('full');
    const img = portrait(face, 'h-agent-face m-drift', '');
    if (img) {
      img.addEventListener('error', () => { host.hidden = true; });
      host.append(img);
    }
    host.hidden = !host.querySelector('img');
  };
  if (!full) { ring(); return; }
  host.replaceChildren();
  host.classList.add('full');
  const img = document.createElement('img');
  img.className = 'h-agent-full m-drift';
  img.alt = '';
  img.decoding = 'async';
  img.draggable = false;
  img.addEventListener('load', () => img.classList.add('ready'), { once: true });
  img.addEventListener('error', ring, { once: true });
  img.src = full;
  host.append(img);
  host.hidden = false;
}
$('h-open').addEventListener('click', () => { if (lastId) window.occlara.openReview(lastId); });

// Each repeated mistake's mark: a figure alone, a clock for one about time,
// a scale for one about numbers, a crosshair otherwise. Words decide, never
// a colour; app authored paths only.
const MISTAKE_ICO = {
  alone: '<circle cx="12" cy="9.5" r="2.8"/><path d="M7.4 17.6c.9-2.3 2.6-3.5 4.6-3.5s3.7 1.2 4.6 3.5"/><circle cx="12" cy="12" r="9" stroke-dasharray="2.2 3.1"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  scale: '<path d="M12 4.5v15M8 19.5h8M5 8h14M5 8l-2.4 5.5a2.6 2.6 0 0 0 4.8 0zM19 8l-2.4 5.5a2.6 2.6 0 0 0 4.8 0z"/>',
  cross: '<circle cx="12" cy="12" r="6.5"/><path d="M12 2.5v5M12 16.5v5M2.5 12h5M16.5 12h5"/>',
};
function mistakeIcon(title) {
  const t = String(title || '').toLowerCase();
  const k = /trade|alone|nobody|isolat/.test(t) ? 'alone' : /second|early|first \d|time|late/.test(t) ? 'clock' : /advantage|numbers|up in|man/.test(t) ? 'scale' : 'cross';
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${MISTAKE_ICO[k]}</svg>`;
}

/**
 * The most repeated mistakes, each with how often it happened and in how many
 * matches, every row in the full ink (9.1, the owner's item 3: the fourth
 * faded to grey), and each with its arrow (item 4): up getting worse, down
 * getting better, flat steady, its tooltip saying what it compares.
 */
function paintMistakes(model) {
  const list = Array.isArray(model.mistakes) ? model.mistakes : [];
  $('top').hidden = !list.length;
  const host = $('top-list');
  host.replaceChildren();
  // Every row keeps the arrow's room when any has one, so the counts line up.
  const anyWay = list.some((m) => m && WAY_PATH[m.trend]);
  list.forEach((m, j) => {
    const row = el('div', 'top-row');
    row.setAttribute('role', 'listitem');
    // Its place (--j), for the rows to rise one after another as the section
    // arrives (home.css), never on a repaint.
    row.style.setProperty('--j', String(j));
    const bubble = el('span', 'top-bubble');
    bubble.innerHTML = mistakeIcon(m.title);
    const text = el('span', 'top-text');
    const t = el('span', 'top-title', m.title);
    // Whole under the pointer where a narrow card cuts it.
    t.title = m.title || '';
    text.append(t);
    if (typeof m.matches === 'number' && typeof model.recorded === 'number') text.append(el('span', 'top-sub', `In ${m.matches} of your last ${model.recorded} matches`));
    row.append(bubble, text);
    if (WAY_PATH[m.trend]) row.append(wayMark(m.trend, 'down', m.trendWords || '', null));
    else if (anyWay) row.append(el('span', 'way none'));
    if (typeof m.total === 'number') {
      const n = el('span', 'top-n', String(m.total));
      n.title = `${m.total} times${typeof m.matches === 'number' && typeof model.recorded === 'number' ? `, in ${m.matches} of your last ${model.recorded} recorded matches` : ''}`;
      row.append(n);
    }
    host.append(row);
  });
}

/*
 * THE RECENT MATCHES (9.1, the owner's item 11): the Matches row, so the two
 * lists read alike. Five things in columns: the agent's portrait (the map's
 * picture without one), the agent on the map over the day and time, the
 * result and the score in the outcome's tone, the grade in its band's tone
 * (dashed when provisional), its change on the graded match before. The rest
 * (the queue, where the grade came from, the milestones, the RR the match
 * moved) is one step away, in the row's tooltip, or in the review. A row with
 * no grade says why where its result would read (GradeView.whyUngraded, the
 * Matches words), and one still being checked has its pill.
 */
const PIN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/></svg>';
/** A row's face: the agent, else the map's picture, else a quiet pin, never an empty circle. */
function rowFace(art) {
  const blank = () => { const s = el('span', 'r-face blank'); s.innerHTML = PIN; s.setAttribute('aria-hidden', 'true'); return s; };
  const src = (art && (art.agent || art.map)) || null;
  if (!src) return blank();
  const img = el('img', 'r-face' + (art.agent ? '' : ' map'));
  img.src = src;
  img.alt = '';
  img.decoding = 'async';
  img.setAttribute('aria-hidden', 'true');
  img.addEventListener('error', () => img.replaceWith(blank()));
  return img;
}
/** "Today, 9:25 PM", "Yesterday, 9:25 PM", "Nov 22, 9:25 PM": the Matches row's date. */
function rowWhen(at) {
  const TC = window.TrendChart;
  return TC && typeof TC.whenWord === 'function' ? TC.whenWord(at) : when(at);
}
/** What the row leaves to its tooltip: the queue, where the grade came from, the milestones. */
function rowRest(m) {
  const source = m.imported ? (m.matchId || m.verified ? 'Imported recording' : "Imported, not matched to Riot's record")
    : m.source === 'riot' ? "From Riot's record" : m.verified ? "Checked against Riot's record" : null;
  const marks = !m.work && Array.isArray(m.marks) ? m.marks.filter((k) => k && typeof k.text === 'string' && k.text).map((k) => k.text) : [];
  return { meta: [m.mode, source].filter(Boolean).join('  ·  '), marks };
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
    const name = el('span', 'r-name');
    const who = [m.title, m.map].filter(Boolean).join(' on ') || 'Match';
    name.append(el('span', 'r-title', who), el('span', 'r-when', rowWhen(m.at)));
    // Still being checked (8.4.1): the screen's result and grade are not said
    // until Riot's record has had its say, the pill in their place.
    const checking = m.work ? GV.checking(m.work) : null;
    const g = checking ? null : m.grade;
    const res = el('span', 'r-result');
    const grade = el('span', 'r-grade');
    let delta = el('span', 'r-delta none');
    const resText = m.result ? [m.result, scoreText(m.score)].filter(Boolean).join(' ') : '';
    if (checking) grade.append(checking);
    else if (g) {
      // The score as the last match card and Matches write it, "13 : 11".
      if (resText) res.append(el('span', 'r-res ' + (isWin(m.result) ? 'win' : isLoss(m.result) ? 'loss' : ''), resText));
      else if (m.mode) res.append(el('span', 'r-res quiet', m.mode));
      const sc = el('span', 'r-score ' + GV.gradeTone(g) + (g.provisional ? ' prov' : ''), String(g.score));
      sc.title = `${GV.GRADE_NAME} ${g.score}${g.provisional ? ', provisional: some of the record was missing' : ''}. ${GV.GRADE_TIP}`;
      grade.append(sc);
      if (m.delta === 'first') delta = el('span', 'r-delta first', 'First');
      else if (typeof m.delta === 'number' && Number.isFinite(m.delta)) {
        delta = el('span', 'r-delta ' + (m.delta > 0 ? 'up' : m.delta < 0 ? 'down' : 'even'), m.delta > 0 ? `+${m.delta}` : String(m.delta));
        delta.title = 'Since the graded match before';
      }
    } else {
      const [short, long] = GV.whyUngraded(m);
      if (resText) res.append(el('span', 'r-res ' + (isWin(m.result) ? 'win' : isLoss(m.result) ? 'loss' : ''), resText));
      const why = el('span', 'r-why', short);
      why.title = long;
      res.append(why);
      grade.append(el('span', 'r-score none', '--'));
      b.classList.add('ungraded');
    }
    b.append(rowFace(rows[m.id]), name, res, grade, delta);
    const rest = rowRest(m);
    b.dataset.marks = rest.marks.join('|');
    b.dataset.meta = rest.meta;
    // Said whole to a screen reader, as the Matches row is: what the eye sees across it.
    b.dataset.label = [who, rowWhen(m.at), checking ? 'still being checked' : null, !checking && resText ? resText : null,
      g ? `grade ${g.score}${g.provisional ? ', provisional' : ''}` : checking ? null : 'not graded',
      g && typeof m.delta === 'number' ? `${m.delta > 0 ? '+' : ''}${m.delta} on the match before` : null].filter(Boolean).join(', ');
    b.addEventListener('click', () => window.occlara.openReview(m.id));
    host.append(b);
  });
  paintRowRR();
}

/**
 * Each recent match's RR, and the last match's chip, from the last rank
 * answer; nothing where none is known. A row keeps it one step away, in its
 * tooltip with the queue and the milestones (data-rr for a reader), and the
 * last match card shows it.
 */
function paintRowRR() {
  for (const b of $('recent-list').querySelectorAll('.r-row')) {
    const change = rr[b.dataset.id];
    const known = typeof change === 'number' && Number.isFinite(change);
    if (known) { b.dataset.rr = rrText(change); b.dataset.rrTone = rrTone(change); } else { delete b.dataset.rr; delete b.dataset.rrTone; }
    const marks = (b.dataset.marks || '').split('|').filter(Boolean);
    const tip = [b.dataset.meta, ...marks, known ? `${rrText(change)} from this match` : null].filter(Boolean);
    b.title = tip.join('. ') + (tip.length ? '.' : '');
    b.setAttribute('aria-label', [b.dataset.label, ...marks, known ? `${rrText(change)}` : null].filter(Boolean).join(', ') + '. Open its review');
  }
  const chip = document.querySelector('#last .last-rr');
  if (chip) {
    const change = lastId ? rr[lastId] : null;
    const known = typeof change === 'number' && Number.isFinite(change);
    chip.hidden = !known;
    // "+11 RR", as the rank card and the rows write it.
    chip.textContent = known ? rrText(change) : '';
    chip.className = 'rr-chip last-rr' + (known ? ' ' + rrTone(change) : '');
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
/*
 * 9.1, the owner's item 10: the tier's own icon beside it (the bundled set,
 * sync:rankicons; the preload names the file), the RR in the tier under the
 * tier, the last game's RR beside it, and the way to the next tier as a bar
 * with how far it is and what it is ("43 RR to Diamond 2"). From Immortal 1
 * the RR is not capped at 100 and the next rank follows the leaderboard, so
 * there is no bar, only the RR and that line. Every tier draws its own icon;
 * one that fails to load leaves the words alone.
 */
function paintRank(card) {
  const host = $('rank');
  const was = host.hidden;
  host.hidden = !card;
  if (card) {
    $('rank-tier').textContent = card.tier;
    const icon = $('rank-icon');
    const src = typeof card.icon === 'string' && card.icon ? card.icon : null;
    if (!src) { icon.hidden = true; icon.removeAttribute('src'); }
    else if (icon.getAttribute('src') !== src) {
      icon.hidden = false;
      icon.classList.remove('ready');
      icon.setAttribute('src', src);
    }
    icon.title = card.tier;
    const span = $('rank-rr');
    const known = typeof card.change === 'number' && Number.isFinite(card.change);
    span.hidden = !known;
    span.textContent = known ? rrText(card.change) : '';
    span.className = 'rr-chip rank-rr' + (known ? ' ' + rrTone(card.change) : '');
    const inTier = typeof card.rr === 'number' && Number.isFinite(card.rr) ? card.rr : null;
    // Below Immortal unless the model says otherwise (a model from before 9.1 has no `capped`).
    const capped = card.capped !== false;
    // Below Immortal the RR is the bar's, under it; from Immortal 1, with no
    // bar, it stands under the tier.
    $('rank-points').hidden = inTier === null || capped;
    $('rank-points').textContent = inTier === null || capped ? '' : `${inTier} RR`;
    $('rank-bar').hidden = inTier === null || !capped;
    $('rank-foot').hidden = inTier === null;
    host.classList.toggle('uncapped', !capped);
    if (inTier !== null) {
      $('rank-fill').style.width = `${Math.max(1, Math.min(100, inTier))}%`;
      // From Immortal 1 the foot says why there is no bar, on the left.
      $('rank-in').textContent = capped ? `${inTier} RR` : card.next ? `${card.next} follows the leaderboard` : 'The highest rank';
      $('rank-to').textContent = capped ? `${100 - inTier} RR to ${card.next || 'the next rank'}` : '';
    }
  }
  closeUp();
  if (was && card) rise(host);
}
// The icon fades in once decoded, and a file that fails leaves the words alone.
$('rank-icon').addEventListener('load', () => $('rank-icon').classList.add('ready'));
$('rank-icon').addEventListener('error', () => { $('rank-icon').hidden = true; });

/** The row of the rank and the mistakes closes up as its cards go. */
function closeUp() {
  // ORBIT: the moment and the rank share the row under the bento.
  const row = $('rank').parentNode;
  row.hidden = $('rank').hidden && $('focus').hidden;
  row.classList.toggle('single', $('rank').hidden !== $('focus').hidden);
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
    const head = document.querySelector('.home .h-head');
    const cards = [...document.querySelectorAll('.home .card')].filter((c) => !c.hidden && !c.closest('[hidden]'));
    for (const c of cards) c.classList.remove('card-in');
    if (head) head.classList.remove('card-in');
    // Under less motion the classes still go on (the check and the site
    // proof read them) and home.css plays nothing for them.
    void document.body.offsetWidth;   // taken off and put back, so it plays again
    // The head first (no --i: no delay), then the cards, each --i, which
    // home.css caps at the sixth.
    if (head) head.classList.add('card-in');
    cards.forEach((c, i) => {
      c.style.setProperty('--i', String(i));
      c.classList.add('card-in');
    });
    endArrival(head ? [head, ...cards] : cards);
    const last = $('last');
    const at = cards.indexOf(last);
    if (at >= 0) playLast(Math.min(at + 1, 5) * STAGGER_MS);
    const player = $('h-player');
    if (player && !player.hidden) play(player, 'h-fade', 600);
  };
  if (typeof window.occlaraOnShown === 'function') window.occlaraOnShown(run); else run();
}

/*
 * THE MOTION OF HOME (8.9.2), on the shared layer (shared/motion.css,
 * motion.js). Everything here plays from arrive() only, so once per visit of
 * the page and on a change of game, and never on a repaint for the same data
 * (a review saved, the rank answering): a repaint rebuilds the cards plainly,
 * in their end state. Nothing plays under reduced motion, and nothing here
 * knows of a match: Home is sealed mid match and not on screen.
 */
const STAGGER_MS = 40;   // --stagger
const reduced = () => !!(window.Motion && window.Motion.reduced());

/** A class put on, played once, and taken off after ms. */
function play(node, cls, ms) {
  if (!node || reduced()) return;
  node.classList.remove(cls);
  void node.offsetWidth;   // taken off and put back, so it plays again
  node.classList.add(cls);
  setTimeout(() => node.classList.remove(cls), ms);
}

/**
 * The last match card's own entrance, delayMs after the arrival starts (the
 * card's own delay): the grade counts up from 0 (CSS, home.css hCount), the
 * K/D counts up to its exact two places (Motion.countUp), and the trend's
 * line draws itself, its dots arriving as it passes them (TrendChart.play).
 */
function playLast(delayMs) {
  if (reduced()) return;
  const host = $('last');
  const d = `${delayMs}ms`;
  const score = host.querySelector('.gv-score.big');
  const to = score ? Number(score.textContent) : NaN;
  if (score && Number.isInteger(to) && to > 0) {
    score.style.setProperty('--to', String(to));
    score.style.setProperty('--d', d);
    play(score, 'counting', delayMs + 800 + 120);   // --dur-count
  }
  const ratio = host.querySelector('.kd-ratio');
  if (ratio && window.Motion) {
    // The true value, never the text on screen: a visit that replays the
    // entrance while an earlier count is still running would read its
    // number mid count (0.25) and count to that. countUp keeps the final
    // text in data-value from its first call.
    const value = Number(ratio.dataset.value || ratio.textContent);
    if (Number.isFinite(value)) window.Motion.countUp(ratio, value, { format: (n) => n.toFixed(2), dur: 800 });
  }
  // The trend's line draws itself as its card comes in, once a visit
  // (shared/trend-chart.js play: one shot, nothing under less motion).
  if (trendChart) trendChart.play();
}

// A new visit of the page (embed.js, 'occlara-page-enter'): the cards arrive
// again, once. The first enter is the visit the page loaded in, whose first
// paint brings them in (load({ arrive: true })).
window.addEventListener('occlara-page-enter', (e) => {
  if (e && e.detail && e.detail.first) return;
  arrive();
});

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
  paintHero(model);
  if (!has) return true;
  lastId = model.last.id;
  paintLast(model.last, model);
  paintTrend(model);
  paintFix(model);
  paintPractice();
  paintMistakes(model);
  closeUp();
  paintRecent(model.recent || [], model);
  return true;
}

/*
 * TODAY'S PRACTICE (the Practice page): one quiet line under the Fix card,
 * main's words, "Today's practice: <drill>, 10 minutes", only with a plan
 * and before the day's first drill is marked. Main answers null mid match,
 * for League and with no plan, and the line goes.
 */
let practiceAsk = 0;
async function paintPractice() {
  const n = ++practiceAsk;
  const host = $('h-practice');
  let t = null;
  try { t = typeof window.occlara.getPracticeToday === 'function' ? await window.occlara.getPracticeToday() : null; } catch { t = null; }
  if (n !== practiceAsk) return;
  const text = t && typeof t.text === 'string' ? t.text : '';
  host.hidden = !text;
  $('h-practice-open').textContent = text;
  $('h-practice-open').setAttribute('aria-label', text ? `${text}. Open Practice` : 'Open Practice');
}
$('h-practice-open').addEventListener('click', () => window.occlara.go('practice'));
if (typeof window.occlara.onPractice === 'function') window.occlara.onPractice(() => paintPractice());
// A new day asks again: the page coming back to the front.
if (typeof window.occlara.onPage === 'function') window.occlara.onPage((m) => { if (m && m.phase === 'arm') paintPractice(); });

$('top-more').addEventListener('click', () => window.occlara.go('patterns'));
$('fix-open').addEventListener('click', () => { if (lastId) window.occlara.openReview(lastId); });
// The Start strip: the same Start as the sidebar's (COACH_START).
$('h-start').addEventListener('click', () => { if (typeof window.occlara.startCoaching === 'function') window.occlara.startCoaching(); });
$('recent-all').addEventListener('click', () => window.occlara.go('matches'));
// Connect your Riot ID: Settings, where the Riot ID is set.
$('h-player-connect').addEventListener('click', () => window.occlara.go('settings'));
// Find players (docs/claude/social.md): shown only while player search is
// open; main answers null mid match, and the link is left as it was.
$('h-players').addEventListener('click', () => window.occlara.go('players'));
async function paintPlayersLink() {
  if (typeof window.occlara.socialLive !== 'function') return;
  const s = await Promise.resolve(window.occlara.socialLive()).catch(() => null);
  if (s) $('h-players').hidden = s.live !== true;
}
paintPlayersLink();
if (typeof window.occlara.onSocial === 'function') window.occlara.onSocial(() => paintPlayersLink());
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
 * THE UPDATE LINE moved to the bar in 9.1 (the shell's What's new pill, the
 * owner's item 2: it sat faint on the moon here).
 */
/*
 * OCCLARA WRAPPED (docs/claude/wrapped.md): from 15 December to 31 January,
 * main's line and its button ("Play your 2026 Wrapped"), or, without enough
 * matches, the line alone saying so. Out of the window, mid match (main
 * answers null) or with nothing to say, the strip is hidden.
 */
let wrappedAsk = 0;
async function paintWrapped() {
  const mine = ++wrappedAsk;
  const host = document.getElementById('h-wrapped');
  let e = null;
  try { e = typeof window.occlara.getWrapped === 'function' ? await window.occlara.getWrapped() : null; } catch { e = null; }
  if (mine !== wrappedAsk || !host) return;
  if (!e || !e.open || typeof e.line !== 'string') { host.hidden = true; return; }
  document.getElementById('h-wrapped-text').textContent = e.line;
  const b = document.getElementById('h-wrapped-open');
  b.hidden = !e.button;
  b.textContent = e.button || '';
  b.dataset.year = String(e.year);
  host.classList.toggle('thin', !e.enough);
  host.hidden = false;
}
document.getElementById('h-wrapped-open').addEventListener('click', () => {
  const y = Number(document.getElementById('h-wrapped-open').dataset.year);
  if (typeof window.occlara.openWrapped === 'function') window.occlara.openWrapped(Number.isInteger(y) ? y : null);
});
// Asked again on a review saved (Home's one review listener, below) and as Home arms.
paintWrapped();
if (typeof window.occlara.onPage === 'function') window.occlara.onPage((m) => { if (m && m.phase === 'arm') paintWrapped(); });


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
    : 'Press Start before you queue. Your review opens when the match ends.';
  $('h-start').hidden = rec;
  // The sky and the agent are still while a match is recorded (motion.js).
  if (window.Motion) window.Motion.ambient(!rec);
}

/*
 * THE SKY (Orbit, shared/sky.js): the stars drawn in the window's own
 * coordinates, this view sitting the bar's height down it (main-window.js
 * TOP_H, 56px), so they carry on from the strip the bar shows; a few that
 * twinkle; and the moon, drawn once and kept. Drawn again only when the
 * window's size changes. Its slow motion is paused while the window is hidden
 * and while a match is recorded (paintStrip, motion.js).
 */
const BAR_PX = 56;
function paintSky() {
  const sky = window.OcclaraSky;
  if (!sky) return;
  const top = document.documentElement.classList.contains('embedded') ? BAR_PX : 0;
  sky.stars($('h-stars'), { top, height: (window.innerHeight || 0) + top });
  sky.twinkles($('h-twinkles'), 10);
  sky.moon($('h-moon'));
}
let skyResize = 0;
window.addEventListener('resize', () => { clearTimeout(skyResize); skyResize = setTimeout(paintSky, 150); });
paintSky();

(async () => {
  const state = await window.occlara.getState().catch(() => null);
  game = (state && state.gameId) || 'valorant';
  paintStrip(state);
  let riotId = String((state && state.riotId) || '').trim();
  paintPlayer(riotId);
  // A review saved or improved (Riot's record landing after the match, a match
  // graded from it) repaints Home, and so does a change of game, whose cards
  // arrive again.
  window.occlara.onReviews(() => { load(); paintWrapped(); });
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
      // A new ID fades in where the old one was (what changed), on screen.
      const chip = $('h-player');
      if (!chip.hidden) {
        const fade = () => play(chip, 'h-fade', 140 + 220 + 120);
        if (typeof window.occlaraOnShown === 'function') window.occlaraOnShown(fade); else fade();
      }
      load();
    });
  }
  await load({ arrive: true });
  console.log('[home] ready');
})();

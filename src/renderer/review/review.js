'use strict';

/**
 * The post-game League review.
 *
 * Paints what lol-review.js computed and adds nothing of its own. Every number
 * here was observed by the recorder during the game; nothing is inferred in the
 * renderer, because a renderer that does arithmetic is a second place for the
 * numbers to disagree.
 */

const $ = (id) => document.getElementById(id);

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined && text !== null) n.textContent = String(text);
  return n;
}

/** One big number with a label under it. */
function stat(label, value, note) {
  const box = el('div', 'stat');
  box.append(el('div', 'stat-value', value === null || value === undefined ? '--' : value));
  box.append(el('div', 'stat-label', label));
  if (note) box.append(el('div', 'stat-note', note));
  return box;
}

function paintScores(s) {
  const host = $('r-scores');
  host.replaceChildren();
  const kda = [s.kills, s.deaths, s.assists].every((v) => v !== null && v !== undefined)
    ? `${s.kills}/${s.deaths}/${s.assists}` : null;
  host.append(stat('K / D / A', kda));
  host.append(stat('CS', s.cs));
  // Only shown when the recorder actually caught the ten minute mark. A game
  // that ended before 10:00, or a recorder started late, has no value here and
  // must not show a zero.
  host.append(stat('CS at 10:00', s.csAt10, s.csAt10 === null ? 'not reached' : ''));
  host.append(stat('Ward score', s.ward));
}

function paintObjectives(o) {
  const host = $('r-obj');
  host.replaceChildren();
  const rows = [
    ['Dragons', o.dragonsFor, o.dragonsAgainst],
    ['Barons', o.baronsFor, o.baronsAgainst],
    ['Turrets', o.turretsFor, o.turretsAgainst],
  ];
  for (const [name, forUs, against] of rows) {
    const row = el('div', 'obj-row');
    row.append(el('span', 'obj-name', name));
    const score = el('span', 'obj-score');
    const a = el('b', forUs >= against ? 'good' : '', String(forUs));
    const b = el('b', against > forUs ? 'bad' : '', String(against));
    score.append(a, el('span', 'obj-sep', ' to '), b);
    row.append(score);
    host.append(row);
  }
}

function paintMoments(list) {
  const wrap = $('r-moments-wrap');
  if (!list || !list.length) { wrap.hidden = true; return; }
  wrap.hidden = false;
  const host = $('r-moments');
  host.replaceChildren();
  for (const m of list) {
    const row = el('div', 'moment');
    row.append(el('span', 'moment-at', m.at));
    row.append(el('span', 'moment-why', m.why));
    host.append(row);
  }
}

/**
 * Per skill, against the player's own recent average.
 *
 * Empty on the first few games and that is SAID rather than hidden: a baseline
 * computed from one game would swing wildly and read as authority.
 */
function paintSkills(r) {
  const host = $('r-skills');
  host.replaceChildren();
  const note = $('r-skills-note');

  if (!r.scored.length) {
    note.textContent = r.gamesRecorded < 3
      ? `This is game ${r.gamesRecorded + 1}. After three the coach can compare you against your own average, and this fills in.`
      : 'Nothing in this game carried the data to compare.';
    return;
  }
  note.textContent = `Compared against your last ${r.gamesRecorded} games.`;

  for (const s of r.scored) {
    const row = el('div', 'skill-row ' + s.verdict);
    row.append(el('span', 'skill-dot'));
    const body = el('div', 'skill-body');
    body.append(el('div', 'skill-metric', s.metric));
    const delta = typeof s.delta === 'number'
      ? (s.delta > 0 ? '+' : '') + s.delta : '';
    body.append(el('div', 'skill-num',
      `${s.measured}` + (s.baseline !== null && s.baseline !== undefined ? `  (average ${s.baseline}${delta ? ', ' + delta : ''})` : '')));
    row.append(body);
    host.append(row);
  }
}

/**
 * The Marvel Rivals review, which is a different shape with a different set of
 * honest claims in it.
 *
 * IT REUSES THE IDENTITY AND SCORELINE SLOTS and hides everything else. Deaths,
 * moments, objectives and the skill table are all computed from a League
 * recording that watched a whole game; a Rivals review is built from one frame
 * at the end of a match and has none of it. Leaving those sections visible and
 * empty would claim the data exists and happened to be zero.
 */
function paintRivals(r) {
  const g = r.game || {};
  $('r-champ').textContent = g.hero || 'Your match';
  // A middot, not two spaces. The League line gets away with spaces because its
  // parts are short words; a Rivals line carries "Tokyo 2099: Shin-Shibuya" and
  // the screenshot read as one run-on string. Not a dash, which this repo bans.
  $('r-meta').textContent = [
    g.role, g.mode, g.map,
    g.result ? g.result[0].toUpperCase() + g.result.slice(1) : null,
  ].filter(Boolean).join('  ·  ');

  const s = r.scoreline || {};
  const host = $('r-scores');
  host.replaceChildren();
  const kda = [s.kills, s.deaths, s.assists].every((v) => v !== null && v !== undefined)
    ? `${s.kills}/${s.deaths}/${s.assists}` : null;
  host.append(stat('K / D / A', kda));
  host.append(stat('Damage', s.damage === null ? null : s.damage.toLocaleString()));
  // Each of these is shown only when the column was actually read. A dash says
  // "not captured"; a zero would say "you did none of it", and those are
  // different claims about the same missing number.
  host.append(stat('Healing', s.healing === null ? null : s.healing.toLocaleString()));
  host.append(stat('Blocked', s.blocked === null ? null : s.blocked.toLocaleString()));
  host.append(stat('Accuracy', s.accuracy === null ? null : s.accuracy + '%'));

  // The one judgement the review makes, where it makes one.
  const shape = r.shape;
  $('r-verdict-head').textContent = 'Did you play the role';
  $('r-death-head').textContent = shape ? (shape.ok ? 'You did the job' : 'The role went unplayed') : '';
  $('r-death-detail').textContent = shape ? shape.text : '';
  document.querySelector('#r-death-head').closest('.block').hidden = !shape;

  const arch = r.archetype;
  $('r-arch-wrap').hidden = !arch;
  if (arch) {
    $('r-arch').textContent = `${arch.name[0].toUpperCase() + arch.name.slice(1)} is about `
      + `${arch.purpose}.`;
  }

  // The patch note. Quoted from the official balance post, never characterised
  // as a buff or a nerf, because the review has no safe way to decide which.
  const patch = r.patch;
  $('r-patch-wrap').hidden = !patch;
  if (patch) {
    $('r-patch').textContent = patch.summary || '';
    const n = patch.count;
    $('r-patch-meta').textContent = `Version ${patch.version}, published ${patch.published}`
      + (n ? `  ·  ${n} change${n === 1 ? '' : 's'}` : '');
  }

  // AGAINST YOUR OWN AVERAGE, reusing the League skill table because it is the
  // same idea rendered the same way: a metric, this match, and the mean.
  //
  // `.pass` and `.fail` here mean ABOVE and BELOW the player's own average, not
  // good and bad. Deaths carry lowerIsBetter, so a green dot on Deaths means
  // fewer than usual. The row text always shows both numbers, so the colour is
  // a hint rather than the claim.
  const against = Array.isArray(r.against) ? r.against : [];
  const skills = $('r-skills');
  const note = $('r-skills-note');
  skills.replaceChildren();
  if (!against.length) {
    const n = r.historyCount || 0;
    note.textContent = n < 3
      ? `This is match ${n + 1}. After three in the same role the coach can compare you `
        + 'against your own average, and this fills in.'
      : 'No column in this match had enough matching history to compare against.';
  } else {
    note.textContent = `Compared against your own recent matches, in the same role. `
      + 'Accuracy is compared only against the same hero, because a projectile hero '
      + 'is naturally lower than a hitscan one.';
    for (const a of against) {
      const dir = a.better === null ? '' : (a.better ? ' pass' : ' fail');
      const row = el('div', 'skill-row' + dir);
      row.append(el('span', 'skill-dot'));
      const body = el('div', 'skill-body');
      body.append(el('div', 'skill-metric', a.label));
      const sign = a.delta > 0 ? '+' : '';
      body.append(el('div', 'skill-num',
        `${a.value.toLocaleString()}  (average ${a.baseline.toLocaleString()}`
        + `${a.delta === 0 ? '' : ', ' + sign + a.delta.toLocaleString()}, ${a.games} matches)`));
      row.append(body);
      skills.append(row);
    }
  }

  const refused = Array.isArray(r.refused) ? r.refused : [];
  $('r-refused-wrap').hidden = !refused.length;
  const list = $('r-refused');
  list.replaceChildren();
  for (const line of refused) list.append(el('li', 'r-refused-item', line));

  // Every League-only section, off. r-skills-wrap is NOT among them any more:
  // Rivals fills it with its own comparison.
  for (const id of ['r-moments-wrap', 'r-next-wrap']) $(id).hidden = true;
  document.querySelector('#r-obj').closest('.block').hidden = true;
}

/**
 * The Valorant review, round by round.
 *
 * Paints what valorant-review.js computed and adds nothing of its own, for the
 * reason the League painter gives: a renderer that does arithmetic is a second
 * place for the numbers to disagree. The one thing it decides is layout.
 *
 * Every section that has nothing to say is HIDDEN rather than shown empty,
 * except the scoreboard, which says it is waiting for Riot, because an empty
 * scoreboard with no explanation reads as a broken one.
 */
function paintValorant(r) {
  const g = r.game || {};
  const resultEl = $('v-result');
  resultEl.textContent = g.result ? g.result.toUpperCase() : 'MATCH REVIEW';
  resultEl.className = 'v-result' + (g.result === 'Victory' ? ' win' : g.result === 'Defeat' ? ' loss' : '');
  const score = String(g.score || '').split('-');
  $('v-score').textContent = score.length === 2 ? `${score[0]} : ${score[1]}` : '';
  $('v-score').hidden = score.length !== 2;
  const w = r.watched || {};
  $('v-meta').textContent = [
    g.agent, g.map, g.mode,
    // A match graded after the fact (riot-review.js), which the coach never
    // watched, says where its facts came from instead of a rounds count.
    r.source === 'riot' ? "From Riot's record" : null,
    w.rounds ? `${w.rounds} round${w.rounds === 1 ? '' : 's'} watched` : null,
  ].filter(Boolean).join('  ·  ');

  // What Riot's record changed, said out loud. A review whose numbers moved
  // between one look and the next reads as one that cannot decide, unless it
  // says why they moved.
  const ver = $('v-verified');
  ver.hidden = !r.verification;
  ver.textContent = r.verification || '';

  // Riot's scoreboard, or an honest wait for it.
  const stats = $('v-stats');
  stats.replaceChildren();
  const s = r.scoreline;
  const note = $('v-stats-note');
  if (s) {
    const kda = [s.kills, s.deaths, s.assists].every((v) => v !== null && v !== undefined)
      ? `${s.kills}/${s.deaths}/${s.assists}` : null;
    stats.append(stat('K / D / A', kda));
    stats.append(stat('ACS', s.acs));
    stats.append(stat('ADR', s.adr));
    stats.append(stat('Headshot', typeof s.headshotPct === 'number' ? s.headshotPct + '%' : null));
    stats.hidden = false;
    note.hidden = true;
  } else {
    stats.hidden = true;
    note.hidden = false;
    note.textContent = 'Kills, ACS and damage come from Riot once the match is published, usually a few '
      + 'minutes after it ends. This fills in on its own if your Riot ID is set in Settings.';
  }

  paintStrip(r);

  // The coach's read. Missing when the model was unreachable or the match was
  // too short to narrate, and each case says which.
  const summary = r.summary;
  $('v-summary-wrap').hidden = !summary && !r.focus && !r.aiUnavailable && !r.thin && !r.narrativePending;
  $('v-summary').textContent = summary
    || (r.narrativePending ? "Rewriting the coach's read with Riot's record of the match. This takes a few seconds."
      : r.thin ? 'Too little of this match was seen to write a read of it. The rounds below are what the coach recorded.'
      : r.aiUnavailable ? 'The coach could not be reached to write this part. Everything else on this page was computed from the match.'
        : '');
  $('v-focus-wrap').hidden = !r.focus;
  $('v-focus').textContent = r.focus || '';

  // The patterns the insight lists above already say are left out here, so a
  // fact is never shown twice on one page; what remains (the sides, a losing
  // streak, the retakes) is context the lists do not carry.
  const SAID = { spot: 'same-spot', early: 'early', killer: 'same-killer', firstkill: 'first-kill',
    firstdeath: 'first-death', ult: 'ult-held', postplant: 'postplant', retake: 'retake' };
  const ins = r.insights || {};
  const shown = new Set([...(ins.mistakes || []), ...(ins.strengths || []), ...(ins.missed || []), ...(ins.facts || [])]
    .map((e) => e.key));
  const pats = (Array.isArray(r.patterns) ? r.patterns : []).filter((p) => !shown.has(SAID[p.key]));
  $('v-patterns-wrap').hidden = !pats.length;
  const pHost = $('v-patterns');
  pHost.replaceChildren();
  for (const p of pats) {
    const row = el('div', 'v-pattern');
    row.append(el('span', 'v-pattern-dot ' + (p.key || '')));
    row.append(el('span', 'v-pattern-text', p.text));
    pHost.append(row);
  }

  paintRoundCards(r);

  // Against the player's own average, the Rivals rendering reused.
  const against = Array.isArray(r.against) ? r.against : [];
  $('v-against-wrap').hidden = !against.length;
  const aHost = $('v-against');
  aHost.replaceChildren();
  if (against.length) {
    $('v-against-note').textContent = `Compared against your last ${against[0].games} verified matches in the same role.`;
    for (const a of against) {
      const dir = a.better === null ? '' : (a.better ? ' pass' : ' fail');
      const row = el('div', 'skill-row' + dir);
      row.append(el('span', 'skill-dot'));
      const body = el('div', 'skill-body');
      body.append(el('div', 'skill-metric', a.label));
      const sign = a.delta > 0 ? '+' : '';
      body.append(el('div', 'skill-num',
        `${a.value}  (average ${a.baseline}${a.delta === 0 ? '' : ', ' + sign + a.delta})`));
      row.append(body);
      aHost.append(row);
    }
  }

  const study = Array.isArray(r.study) ? r.study : [];
  $('v-study-wrap').hidden = !study.length;
  const sHost = $('v-study');
  sHost.replaceChildren();
  // A note is its text alone: the review never says where its knowledge comes
  // from, and main hands it nothing else (present() in src/main/index.js).
  for (const n of study) {
    const card = el('div', 'v-study-card');
    card.append(el('p', 'v-study-text', n.text));
    sHost.append(card);
  }

  const refused = Array.isArray(r.refused) ? r.refused : [];
  $('v-refused-wrap').hidden = !refused.length;
  const list = $('v-refused');
  list.replaceChildren();
  for (const line of refused) list.append(el('li', 'r-refused-item', line));

  paintLooks(r);
}

/** One cell per round, halftime as a gap, the side named over each half. */
function paintStrip(r) {
  const host = $('v-strip');
  host.replaceChildren();
  const rounds = Array.isArray(r.rounds) ? r.rounds : [];
  if (!rounds.length) return;
  const half = r.halftimeAfter;
  let group = null;
  let groupSide = null;
  const flush = () => { if (group) host.append(group); };
  for (const c of rounds) {
    const h = half && c.n > half ? 2 : 1;
    if (!group || group.dataset.half !== String(h)) {
      flush();
      group = el('div', 'v-half');
      group.dataset.half = String(h);
      groupSide = el('div', 'v-half-side', c.side || '');
      group.append(groupSide, el('div', 'v-cells'));
    }
    if (!groupSide.textContent && c.side) groupSide.textContent = c.side;
    const cell = el('button', 'v-cell ' + (c.result || 'unknown'));
    cell.type = 'button';
    cell.setAttribute('role', 'listitem');
    cell.title = `Round ${c.n}${c.result ? ', ' + c.result : ''}${c.facts.length ? '. ' + c.facts.join('. ') : ''}`;
    cell.append(el('span', 'v-cell-n', c.n));
    const marks = el('span', 'v-cell-marks');
    if (c.died) marks.append(el('i', 'mk died'));
    if (c.planted) marks.append(el('i', 'mk planted'));
    cell.append(marks);
    cell.addEventListener('click', () => goRound(c.n));
    group.lastChild.append(cell);
  }
  flush();
}

/** A card for every round the coach has something to say about. */
function paintRoundCards(r) {
  const host = $('v-rounds');
  host.replaceChildren();
  const cards = (Array.isArray(r.rounds) ? r.rounds : [])
    .filter((c) => c.facts.length || c.reads.length || c.why || c.forensics);
  $('v-rounds-wrap').hidden = !cards.length;
  for (const c of cards) {
    const card = el('article', 'v-round' + (c.why ? ' has-why' : ''));
    card.id = `round-${c.n}`;
    const head = el('div', 'v-round-head');
    head.append(el('span', 'v-rn', `R${c.n}`));
    if (c.result) head.append(el('span', 'v-chip ' + c.result, c.result === 'won' ? 'Won' : 'Lost'));
    if (c.side) head.append(el('span', 'v-side', c.side));
    card.append(head);
    if (c.facts.length) card.append(el('div', 'v-facts', c.facts.join('  ·  ')));
    // The cause alone, and the way down to the moment, which is shown whole
    // at the bottom of the review (paintLooks).
    if (c.forensics) card.append(lookLink(c));
    if (c.why) {
      const why = el('div', 'v-why-wrap');
      why.append(el('div', 'v-reads-label', 'Why it went this way'));
      why.append(el('p', 'v-why', c.why));
      card.append(why);
    }
    if (c.reads.length) {
      const reads = el('div', 'v-reads');
      reads.append(el('div', 'v-reads-label', 'What the coach saw at the time'));
      for (const t of c.reads) reads.append(el('p', 'v-read', t));
      card.append(reads);
    }
    host.append(card);
  }
}

/**
 * The coach's look at one death: the frame before it (and after, when there is
 * one), the cause as a label, what it saw and the better play. The label is the
 * part that gets counted across rounds and matches, so it is shown as a chip,
 * on the round's card and at its moment, and the sentences, at the moment
 * alone, are marked as the coach's read of a picture.
 */
const CAUSE_TITLE = {
  'dry-peek': 'Dry peek', 'isolated': 'Caught alone', 'repeek': 'Repeek', 'crossfire': 'Crossfire',
  'rotating': 'Caught rotating', 'overextend': 'Overextended', 'exposed': 'Exposed on the spike',
  'lost-duel': 'Lost the duel', 'unclear': 'Frame unclear',
};
function causeChip(f) {
  return el('span', 'v-cause ' + (f.cause === 'lost-duel' || f.cause === 'unclear' ? 'neutral' : 'bad'),
    CAUSE_TITLE[f.cause] || f.cause);
}

/** On a round's card: the look's cause, and a link down to its moment. */
function lookLink(c) {
  const row = el('div', 'v-look-link');
  row.append(el('span', 'v-reads-label', "The coach's look"), causeChip(c.forensics));
  const link = el('button', 'v-moment-link', 'See where you died');
  link.type = 'button';
  link.addEventListener('click', () => goMoment(c.n));
  row.append(link);
  return row;
}

// A look Riot's record never timed (8.2): the coach found the moment by when
// the screen read the death, which can come a few seconds after it.
const SCREEN_TIMING = "When this happened is the coach's own read of the screen, not Riot's record of the match.";

/**
 * WHERE YOU DIED, AND HOW (8.2): every death the coach looked at, at the
 * bottom of the review, its frames across the column, then the round's facts,
 * the cause, what the coach saw and the better play. A review checked against
 * Riot's record and one Riot's record never reached are painted alike, and the
 * second says its timing is the coach's own read. An unclear frame keeps its
 * picture and says nothing about it, as the server already makes sure.
 */
function paintLooks(r) {
  const host = $('v-looks');
  host.replaceChildren();
  const frames = r.frameData || {};
  const looked = (Array.isArray(r.rounds) ? r.rounds : []).filter((c) => c.forensics);
  $('v-looks-wrap').hidden = !looked.length;
  for (const c of looked) host.append(moment(r, c, frames));
}

function moment(r, c, frames) {
  const f = c.forensics;
  const box = el('article', 'v-moment');
  box.id = `moment-${c.n}`;
  const head = el('div', 'v-moment-head');
  head.append(el('span', 'v-rn', `Round ${c.n}`));
  if (c.side) head.append(el('span', 'v-side', c.side));
  // The AI log at that moment, while it still holds the match: the eye in the
  // header opens the match on its first death, this one at the frame looked at.
  const eye = r.id && r.aiLog === 'kept' && typeof f.at === 'number' && window.LogEye
    ? window.LogEye.button('kept', () => window.occlara.openAiLog(r.id, f.at), window.LogEye.MOMENT) : null;
  if (eye) head.append(eye);
  box.append(head);
  const shots = (f.frames || []).filter((n) => frames[n]);
  if (shots.length) {
    const strip = el('div', 'v-shots' + (shots.length > 1 ? ' two' : ''));
    shots.forEach((n) => {
      const fig = el('figure', 'v-shot');
      const img = document.createElement('img');
      img.src = frames[n];
      img.alt = n.includes('after') ? 'Just after the death' : 'Just before the death';
      img.loading = 'lazy';
      img.addEventListener('click', () => zoomShot(strip, fig));
      fig.append(img, el('figcaption', null, n.includes('after') ? 'Just after' : 'Just before'));
      strip.append(fig);
    });
    box.append(strip);
  }
  if (c.facts.length) box.append(el('div', 'v-facts', c.facts.join('  ·  ')));
  const cause = el('div', 'v-moment-cause');
  cause.append(causeChip(f));
  box.append(cause);
  if (f.cause !== 'unclear') {
    if (f.what) box.append(el('p', 'v-look-what', f.what));
    if (f.better) {
      const b = el('p', 'v-look-better');
      b.append(el('span', 'gv-fix-label', 'Better'), document.createTextNode(f.better));
      box.append(b);
    }
  }
  if (f.source === 'screen') box.append(el('p', 'v-moment-src', SCREEN_TIMING));
  return box;
}

/*
 * A FRAME ZOOMS BY SCALING (8.2), in and out. Zoomed, a frame takes the whole
 * row and its neighbour drops under it, which is a jump in layout, so each
 * frame of the strip is measured, the zoom is applied, and each is drawn back
 * where it was and let go: the CSS transition on .v-shot img (review.css)
 * carries it from there to where it now is.
 */
function zoomShot(strip, fig) {
  const imgs = [...strip.querySelectorAll('.v-shot img')];
  const before = imgs.map((i) => i.getBoundingClientRect());
  fig.classList.toggle('zoom');
  imgs.forEach((img, k) => {
    const a = before[k];
    const b = img.getBoundingClientRect();
    if (!a.width || !b.width) return;
    img.style.transition = 'none';
    img.style.transform = `translate(${a.left - b.left}px, ${a.top - b.top}px) scale(${a.width / b.width})`;
  });
  void strip.offsetWidth;   // drawn where it was before it is let go
  for (const img of imgs) {
    img.style.transition = '';
    img.style.transform = '';
  }
}

/**
 * Bring one card into view, flash it, and hand it the keyboard. Scrolled to
 * and nothing more, focus stayed on the control that jumped, so the next Tab
 * went on from there, back up the page, and a screen reader read on from the
 * round card: since 8.2 the look itself is at the bottom of the review, and
 * its eye was reachable only by tabbing through every card above it. A card
 * takes focus without joining the tab order (tabindex -1), and without a
 * scroll of its own, which would cut the smooth one short.
 */
function flashTo(card) {
  if (!card) return;
  card.scrollIntoView({ behavior: 'smooth', block: 'center' });
  if (!card.hasAttribute('tabindex')) card.tabIndex = -1;
  card.focus({ preventScroll: true });
  card.classList.remove('flash');
  void card.offsetWidth;
  card.classList.add('flash');
}

/** Jump to one round's card. */
function goRound(n) { flashTo(document.getElementById(`round-${n}`)); }

/** Jump to one death's moment, at the bottom of the review. */
function goMoment(n) { flashTo(document.getElementById(`moment-${n}`)); }

/**
 * The grade and the three lists, for every game, placed under whichever
 * game's header is showing. Hidden when the review carries neither, which is
 * a review saved before grades existed.
 *
 * A REVIEW GRADED FROM RIOT'S RECORD ALONE HAS NO LISTS. Riot records what
 * happened and never why, so main hands it facts in their place, whenever it
 * was saved (present() in src/main/index.js), and GradeView draws them as one
 * neutral list, "What Riot's record shows", with no fix on any of them.
 */
function paintCommon(r, anchor) {
  const common = $('common');
  const has = !!(r.grade || r.insights);
  common.hidden = !has;
  if (!has) return;
  if (anchor && anchor.parentNode) anchor.after(common);
  const gHost = $('grade-host');
  gHost.replaceChildren();
  if (r.grade) gHost.append(window.GradeView.gradeCard(r.grade));
  const iHost = $('insights-host');
  iHost.replaceChildren();
  if (r.insights) {
    iHost.append(window.GradeView.insightLists(r.insights, {
      onRound: r.kind === 'valorant' ? goRound : false,
      empty: r.kind === 'valorant' && !r.verified
        ? 'Most of what this section counts comes from Riot\'s record of the match. It fills in once the match links.'
        : undefined,
    }));
  }
}

/** Show every block, so neither game's review inherits the other's hidden flags. */
function resetSections() {
  for (const id of ['r-moments-wrap', 'r-skills-wrap', 'r-next-wrap',
    'r-arch-wrap', 'r-refused-wrap', 'r-patch-wrap']) {
    const n = $(id);
    if (n) n.hidden = false;
  }
  for (const sel of ['#r-death-head', '#r-obj']) {
    const block = document.querySelector(sel);
    if (block && block.closest('.block')) block.closest('.block').hidden = false;
  }
}

/**
 * The eye beside "Ask about this match": the AI log on this match's frames,
 * by the rule its row in Matches follows (shared/log-eye.js), from the one
 * word main sends with the review. Gone with the review it belonged to.
 */
function paintEye(r) {
  const host = $('eye-host');
  const eye = r && r.id && window.LogEye ? window.LogEye.button(r.aiLog, () => window.occlara.openAiLog(r.id)) : null;
  host.replaceChildren(...(eye ? [eye] : []));
  host.hidden = !eye;
}

function paint(r) {
  paintEye(r);
  if (!r) {
    $('common').hidden = true;
    $('empty').hidden = false;
    $('review').hidden = true;
    $('vreview').hidden = true;
    return;
  }
  $('empty').hidden = true;
  current = r;
  $('ask').hidden = !r.id;
  // Valorant has its own container, so the League and Rivals one is simply
  // hidden rather than having each of its sections turned off one by one.
  if (r.kind === 'valorant') {
    $('review').hidden = true;
    $('vreview').hidden = false;
    paintValorant(r);
    paintCommon(r, $('v-stats-note'));
    return;
  }
  $('vreview').hidden = true;
  $('review').hidden = false;

  // EVERY SECTION BACK ON FIRST, because this window renders two shapes and
  // each hides what the other needs. Without the reset, a League review opened
  // after a Rivals one keeps Rivals' hidden flags: no deaths, no objectives, no
  // skill table, and nothing to indicate they were suppressed rather than
  // missing. The sections that are genuinely conditional are hidden again by
  // whichever painter runs next.
  resetSections();

  // Branch on what the review SAYS it is, not on which fields it happens to
  // carry. A League review with no lesson attached is still a League review.
  if (r.kind === 'rivals') { paintRivals(r); paintCommon(r, $('r-scores')); return; }

  const g = r.game || {};
  $('r-champ').textContent = g.champion || 'Your game';
  const bits = [g.role, g.mode, g.duration].filter(Boolean);
  $('r-meta').textContent = bits.join('  ');

  // The two Rivals-only sections, which the reset above just turned back on.
  $('r-arch-wrap').hidden = true;
  $('r-refused-wrap').hidden = true;
  $('r-patch-wrap').hidden = true;
  // And the shared heading, back to what this block means in League.
  $('r-verdict-head').textContent = 'How you died';

  paintScores(r.scoreline || {});
  paintCommon(r, $('r-scores'));
  $('r-death-head').textContent = (r.deaths || {}).headline || '';
  $('r-death-detail').textContent = (r.deaths || {}).detail || '';
  paintMoments(r.moments);
  paintObjectives(r.objectives || {});
  paintSkills(r);

  const next = r.next;
  $('r-next-wrap').hidden = !next;
  if (next) {
    $('r-next-title').textContent = next.title;
    $('r-next-mistake').textContent = next.mistake;
    $('r-next-open').onclick = () => window.occlara.openLearn();
  }
}

let current = null;
// A page of the main window has no window of its own to close: the sidebar
// and All matches are how a player leaves it.
const closeWindow = () => { if (!(window.occlaraEmbedded && window.occlaraEmbedded())) window.occlara.close(); };
$('close').addEventListener('click', closeWindow);
$('matches').addEventListener('click', () => window.occlara.openMatches());
$('ask').addEventListener('click', () => { if (current && current.id) window.occlara.askAbout(current.id); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeWindow(); });

// Both paths, because the window can be opened by the push OR by hand later.
window.occlara.onReview(paint);
if (window.occlara.onRivalsReview) window.occlara.onRivalsReview(paint);
if (window.occlara.onValorantReview) window.occlara.onValorantReview(paint);
window.occlara.getReview().then(paint).catch(() => paint(null));
console.log('[review] ready');

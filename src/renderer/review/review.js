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

/**
 * YOUR DEATHS, a League game's (8.3): each by the game's clock, the clip of it
 * from the recording on this PC where the game was recorded, and the one fact
 * the record gives about it (lol-review.js deathList). Hidden when the player
 * did not die, or the review was saved before there was a list.
 *
 * Drawn as a Valorant review draws its rounds (8.3.1): one list, a death with
 * its clip a row with the clip beside its fact, and one with nothing but its
 * fact a single line.
 */
function paintLolDeaths(r) {
  const host = $('r-deaths');
  releaseClips(host);
  host.replaceChildren();
  const list = Array.isArray(r.deathList) ? r.deathList : [];
  $('r-deaths-wrap').hidden = !list.length;
  for (const d of list) {
    const box = el('article', 'v-round l-death' + (d.clipUrl ? '' : ' quiet'));
    box.id = `death-${d.n}`;
    const head = el('div', 'v-round-head');
    head.append(el('span', 'v-rn', `Death ${d.n}`));
    if (d.at) head.append(el('span', 'v-side', d.at));
    box.append(head);
    const fact = d.fact ? el('p', 'v-look-what', d.fact) : null;
    if (d.clipUrl) {
      const moment = el('div', 'v-moment');
      const side = el('div', 'v-media');
      side.append(clipPlayer(d, null));
      const advice = el('div', 'v-advice');
      if (fact) advice.append(fact);
      moment.append(side, advice);
      box.append(moment);
    } else {
      // Nothing to watch: its fact on its line, and where its clip went under it.
      if (fact) head.append(fact);
      if (d.clipGone) box.append(el('p', 'v-clip-gone', clipGoneText(d.clipGone, 'Its facts stay.')));
    }
    host.append(box);
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
  // A middot, not two spaces: a Rivals line carries "Tokyo 2099: Shin-Shibuya"
  // and the screenshot read as one run-on string. League's line has taken it
  // too (8.3.1), so the three reviews agree. Not a dash, which this repo bans.
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
  for (const id of ['r-moments-wrap', 'r-next-wrap', 'r-deaths-wrap']) $(id).hidden = true;
  releaseClips($('r-deaths'));
  $('r-deaths').replaceChildren();
  document.querySelector('#r-obj').closest('.block').hidden = true;
}

/**
 * The Valorant review, round by round.
 *
 * Paints what valorant-review.js computed and adds nothing of its own, for the
 * reason the League painter gives: a renderer that does arithmetic is a second
 * place for the numbers to disagree. What it decides is layout, and what is
 * not said twice.
 *
 * ONE SCREEN, THEN THE ROUNDS (8.3.1). The player's own latest review, seven
 * rounds with four looks, painted 8,096px: every looked at death's facts line
 * twice (on its round's card, and again at its moment at the bottom of the
 * page), three raw reads under every card, the four scoreboard numbers twice,
 * and two sections both headed "Round by round". Each of those is now said
 * once, where it belongs.
 *
 * Every section that has nothing to say is HIDDEN rather than shown empty. A
 * review with no scoreboard yet has no scoreboard at all, not four empty boxes
 * under a note saying why: the grade's note under it says the full grade waits
 * for Riot's record, and "What this review cannot tell you" says where the
 * scoreboard comes from, so that note was the page saying it a third time.
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

  paintStats(r);

  // The coach's read. Missing when the model was unreachable or the match was
  // too short to narrate, and each case says which.
  const summary = r.summary;
  $('v-summary-wrap').hidden = !summary && !r.focus && !r.aiUnavailable && !r.thin && !r.narrativePending;
  $('v-summary').textContent = summary
    || (r.narrativePending ? "Rewriting the coach's read with Riot's record of the match. This takes a few seconds."
      : r.thin ? 'Too little of this match was seen to write a read of it.'
      : r.aiUnavailable ? 'The coach could not be reached to write this part. Everything else on this page was computed from the match.'
        : '');
  // A focus with no read above it: no empty line between the heading and it.
  $('v-summary').hidden = !$('v-summary').textContent;
  $('v-focus-wrap').hidden = !r.focus;
  $('v-focus').textContent = r.focus || '';

  paintStrip(r);
  paintPatterns(r);
  paintRounds(r);
  paintStudy(r);

  const refused = Array.isArray(r.refused) ? r.refused : [];
  $('v-refused-wrap').hidden = !refused.length;
  const list = $('v-refused');
  list.replaceChildren();
  for (const line of refused) list.append(el('li', 'r-refused-item', line));
}

/*
 * AGAINST YOUR OWN AVERAGE, under the number it is about (8.3.1). It was a
 * section of its own further down: four rows repeating the scoreboard's four
 * numbers, each with the average beside it. Each row is matched to its number
 * by the label against() in valorant-review.js gives it, and test:surfaces
 * builds the rows with that function, so a renamed label fails there rather
 * than dropping its comparison here without a word.
 */
const AGAINST_OF = { 'K/D': 'kd', ACS: 'acs', 'Damage per round': 'adr', 'Headshot %': 'headshot' };

/** "+22", "-11", or "average", coloured by better or worse, never by colour alone: the sign says it. */
function versus(a, name) {
  if (!a || typeof a.delta !== 'number') return null;
  const by = a.delta === 0 ? 'average' : `${a.delta > 0 ? '+' : ''}${a.delta}`;
  const line = el('div', 'v-stat-vs ' + (a.better === null || a.better === undefined ? 'even' : a.better ? 'good' : 'bad'),
    name ? `${name} ${by}` : by);
  line.title = `Your average${name ? ` ${name}` : ''}: ${a.baseline}`;
  return line;
}

/** One of Riot's numbers, its label, and how it compares, inside the result's card. */
function vStat(label, value, a, name) {
  const box = el('div', 'v-stat');
  box.append(el('div', 'v-stat-value', value === null || value === undefined ? '--' : value));
  box.append(el('div', 'v-stat-label', label));
  const vs = versus(a, name);
  if (vs) box.append(vs);
  return box;
}

/** Riot's scoreboard beside the result, once the match has linked; nothing before. */
function paintStats(r) {
  const s = r.scoreline;
  const host = $('v-stats');
  host.replaceChildren();
  $('v-stats-wrap').hidden = !s;
  const note = $('v-against-note');
  note.hidden = true;
  note.textContent = '';
  if (!s) return;
  const vs = {};
  const against = Array.isArray(r.against) ? r.against : [];
  for (const a of against) if (a && AGAINST_OF[a.label]) vs[AGAINST_OF[a.label]] = a;
  const kda = [s.kills, s.deaths, s.assists].every((v) => v !== null && v !== undefined)
    ? `${s.kills}/${s.deaths}/${s.assists}` : null;
  host.append(
    vStat('K / D / A', kda, vs.kd, 'K/D'),
    vStat('ACS', s.acs, vs.acs),
    vStat('ADR', s.adr, vs.adr),
    vStat('Headshot', typeof s.headshotPct === 'number' ? s.headshotPct + '%' : null, vs.headshot),
  );
  // What the comparison is over, once: every number carries its sample.
  const over = Object.values(vs)[0];
  if (over && over.games) {
    note.hidden = false;
    note.textContent = `Against your average over your last ${over.games} verified matches in the same role.`;
  }
}

/*
 * WHAT THE NUMBERS SAY ABOUT THE ROUNDS, under the strip they describe, and
 * only what the lists above have not said. A pattern is left out where an
 * entry of the lists carries the same count: on the player's latest review,
 * "On attack, won 1 of 3 rounds once the spike was down" sat under "Post
 * plants that slipped: Won only 1 of 3 attack rounds with the spike down",
 * because only the strength of that name was mapped, never the miss.
 */
const SAID = {
  spot: ['same-spot'], early: ['early'], killer: ['same-killer'], firstkill: ['first-kill'],
  firstdeath: ['first-death'], ult: ['ult-held'], postplant: ['postplant', 'postplant-lost'], retake: ['retake'],
};

function paintPatterns(r) {
  const ins = r.insights || {};
  const shown = new Set([...(ins.mistakes || []), ...(ins.strengths || []), ...(ins.missed || []), ...(ins.facts || [])]
    .map((e) => e && e.key));
  const pats = (Array.isArray(r.patterns) ? r.patterns : [])
    .filter((p) => p && p.text && !(SAID[p.key] || []).some((k) => shown.has(k)));
  const host = $('v-patterns');
  host.replaceChildren();
  host.hidden = !pats.length;
  for (const p of pats) {
    const row = el('li', 'v-pattern');
    row.append(el('span', 'v-pattern-dot ' + (p.key || '')), el('span', 'v-pattern-text', p.text));
    host.append(row);
  }
}

/*
 * A STUDY NOTE THE FOCUS ALREADY SAYS IS NOT SAID AGAIN. The model writes the
 * focus with the study notes in its prompt (match-review.js promptRounds), so
 * the focus can be one of them in other words. A note counts as said when it
 * shares at least three of its words with the focus, and half the words of the
 * shorter of the two. On the player's own two reviews with both, no note comes
 * near: four words shared at most, where half the shorter was six, so this
 * takes only a note the focus repeats.
 */
const COMMON_WORDS = new Set(('the and for you your with that this then they them their are was were but not '
  + 'all any can its it\'s from into onto out off one two than when where what which who how why get got '
  + 'has have had did does just only very too also each every before after while until again more most '
  + 'less own same such there here been being will would could should').split(' '));

/** The words that say what a sentence is about, cut to a rough stem so "trade" meets "trading". */
function wordsOf(text) {
  const out = new Set();
  for (const w of String(text || '').toLowerCase().match(/[a-z']+/g) || []) {
    if (w.length < 3 || COMMON_WORDS.has(w)) continue;
    out.add(w.replace(/(?:ing|ed|es|e|s)$/, ''));
  }
  return out;
}

function restates(note, focus) {
  const a = wordsOf(note);
  const b = wordsOf(focus);
  if (!a.size || !b.size) return false;
  let shared = 0;
  for (const w of a) if (b.has(w)) shared++;
  return shared >= 3 && shared * 2 >= Math.min(a.size, b.size);
}

function paintStudy(r) {
  // A note is its text alone: the review never says where its knowledge comes
  // from, and main hands it nothing else (present() in src/main/index.js).
  const study = (Array.isArray(r.study) ? r.study : [])
    .filter((n) => n && typeof n.text === 'string' && n.text && !restates(n.text, r.focus));
  $('v-study-wrap').hidden = !study.length;
  const host = $('v-study');
  host.replaceChildren();
  for (const n of study) host.append(el('li', 'v-study-note', n.text));
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

/**
 * EVERY ROUND, ONCE (8.3.1). A round the coach has something to say about is
 * a row: its facts, then its look where the coach took one (the clip, the
 * frames, the cause, what it saw and the better play), or else its why. Any
 * other round is one line, its facts beside its number. A death the coach
 * looked at was a card here with a link down to a section of its own at the
 * bottom of the page, where its facts were said again: a player read a round,
 * scrolled to the bottom for its death, and back up for the next round.
 *
 * The coach's notes as it read each frame are not shown: they were three a
 * round of raw reads ("in spawn during buy phase holding Ghost"), what the
 * review is built from rather than what it says.
 */
function paintRounds(r) {
  const host = $('v-rounds');
  releaseClips(host);
  host.replaceChildren();
  const rounds = Array.isArray(r.rounds) ? r.rounds : [];
  $('v-rounds-wrap').hidden = !rounds.length;
  const frames = r.frameData || {};
  for (const c of rounds) host.append(roundRow(r, c, frames));
}

function roundRow(r, c, frames) {
  const f = c.forensics || null;
  // What the look says, when it says anything: an unclear frame says nothing
  // (the server makes sure), and then the round's why is the advice it has.
  // A LOOK THAT SPEAKS TAKES THE WHY'S PLACE FOR RIOT'S LOOK ONLY: it is sent
  // to the narrative that writes the why (valorant-review.js requestBody sends
  // its cause and what it saw), so the two are one account of the death. The
  // screen's look lands after the lines are written (screenLook in
  // src/main/index.js, once the narrative is in) and nothing writes them
  // again, so its round keeps the why written without it: the look first,
  // then the why, each a block of its own under its own label (look()).
  const speaks = !!(f && f.cause !== 'unclear' && (f.what || f.better));
  const why = c.why && !(speaks && f.source !== 'screen') ? c.why : null;
  const facts = (Array.isArray(c.facts) ? c.facts : []).join('  ·  ');
  const row = el('article', 'v-round' + (f || why ? '' : ' quiet'));
  row.id = `round-${c.n}`;
  const head = el('div', 'v-round-head');
  head.append(el('span', 'v-rn', `R${c.n}`));
  if (c.result) head.append(el('span', 'v-chip ' + c.result, c.result === 'won' ? 'Won' : 'Lost'));
  if (c.side) head.append(el('span', 'v-side', c.side));
  row.append(head);
  if (!f && !why) {
    if (facts) head.append(el('span', 'v-facts', facts));
    return row;
  }
  // The AI log at the moment the coach looked at, while it still holds the
  // match: the eye in the page's header opens the match on its first death.
  const eye = f && r.id && r.aiLog === 'kept' && typeof f.at === 'number' && window.LogEye
    ? window.LogEye.button('kept', () => window.occlara.openAiLog(r.id, f.at), window.LogEye.MOMENT) : null;
  if (eye) head.append(eye);
  if (facts) row.append(el('div', 'v-facts', facts));
  row.append(f ? look(c, frames, why) : whyLine(why));
  return row;
}

/**
 * The round's why, marked as the coach's read: the model writes two kinds of
 * sentence in a review, the summary and this, and both say whose they are.
 * `apart` under a look that said something too (a screen look's), so the two
 * accounts read as two.
 */
function whyLine(why, apart) {
  const p = el('p', 'v-why-line' + (apart ? ' apart' : ''));
  p.append(el('span', 'gv-fix-label', "Coach's read"), el('span', 'v-why', why));
  return p;
}

/**
 * The coach's look at one death. The label is the part that gets counted
 * across rounds and matches, so it is a chip, marked as the coach's look; the
 * sentences after it are its read of a picture.
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

// A look Riot's record never timed (8.2): the coach found the moment by when
// the screen read the death, which can come a few seconds after it.
const SCREEN_TIMING = "Timed from the coach's read of the screen, not Riot's record.";
// The frame a look from the screen took at that read (frameLabel).
const READ_AS_DEAD = 'Read as dead';

/*
 * THE FRAMES OF A LOOK, each with its label. Since 8.3.1 a look can be up to
 * five frames in time order, from the match's recording, with their seconds
 * against the death beside them (frameAt, written by the death look); a look
 * from before is the frames the coach read, named for before and after it.
 *
 * TO THE TENTH, never rounded to a whole second it was not taken at: the look
 * takes its stills at half seconds as well as whole ones (shared/clips.js
 * LOOK_AT, 1.5 s before for the approach, 4.5 s before the screen's moment),
 * and rounded, those read "2 s before" and "5 s before".
 *
 * EVERY STILL BEFORE THE DEATH BY ITS OWN TENTH, the last second's too:
 * Riot's look takes two in it, 0.7 and 0.3 s before (LOOK_AT), and both read
 * "Just before", two frames under one name. The one after the death is "Just
 * after" within a second of it, and by its seconds past that.
 *
 * A LOOK FROM THE SCREEN COUNTS FROM ITS READ OF THE DEATH (`screen`), never
 * from the death: the screen read the player's Sunset deaths 0.7 to 2.7 s
 * after they happened, so its stills of 1 s before and 0 s were named "Just
 * before" and "At the death" on frames that can show the player already dead.
 * Each is named by its seconds against the read, the read's own frame "Read
 * as dead", as the server is told (death-forensics.js framesLines).
 */
function frameLabel(s, screen) {
  if (typeof s.at === 'number' && Number.isFinite(s.at)) {
    const secs = Math.round(Math.abs(s.at) * 10) / 10;
    if (screen) return secs === 0 ? READ_AS_DEAD : `${secs} s ${s.at < 0 ? 'before' : 'after'}`;
    if (secs === 0) return 'At the death';
    if (s.at < 0) return `${secs} s before`;
    return secs <= 1 ? 'Just after' : `${secs} s after`;
  }
  return /after/.test(String(s.name)) ? 'Just after' : 'Just before';
}

/** The look's frames the review still has, in its order, each with its seconds when the look gave them. */
function shotsOf(f, frames) {
  const names = Array.isArray(f.frames) ? f.frames : [];
  const at = Array.isArray(f.frameAt) && f.frameAt.length === names.length ? f.frameAt : null;
  return names.map((name, i) => ({ name, src: frames[name], at: at ? at[i] : null })).filter((s) => s.src);
}

/** The clip's picture until it plays: the frame nearest the death from before it, else the first. */
function posterOf(shots) {
  const before = shots.filter((s) => typeof s.at === 'number' && s.at < 0);
  const s = before.length ? before[before.length - 1] : shots[0];
  return s ? s.src : null;
}

/**
 * A strip of frames, each zoomed by a click. Under a clip they are a
 * filmstrip, four to the row at least, since the clip's picture until it
 * plays is already one of them: at half the width, the two read frames under
 * the player's own round 2 clip made its row 538px tall beside 102px of
 * words, and four to the row it is 466. Without a clip they are all the
 * moment has to show, the two read frames two a row and the recording's five
 * stills, their clip gone (the cap, Clear clips), three: two a row stacked
 * them three frames tall, 520px beside four lines of words.
 */
function shotStrip(shots, underClip, screen) {
  const strip = el('div', 'v-shots');
  strip.style.setProperty('--n', String(underClip ? Math.max(4, shots.length) : Math.min(3, shots.length)));
  for (const s of shots) {
    const label = frameLabel(s, screen);
    const fig = el('figure', 'v-shot');
    const img = document.createElement('img');
    img.src = s.src;
    // Against the read for a look from the screen whose frames carry their
    // seconds, against the death otherwise.
    const timedRead = screen && typeof s.at === 'number' && Number.isFinite(s.at);
    img.alt = timedRead ? (label === READ_AS_DEAD ? 'The frame the screen read the death on' : `${label} the screen read the death`)
      : label === 'At the death' ? label : `${label} the death`;
    img.loading = 'lazy';
    img.addEventListener('click', () => zoomShot(strip, fig));
    fig.append(img, el('figcaption', null, label));
    strip.append(fig);
  }
  return strip;
}

/**
 * A death the coach looked at, inside its round: what there is to watch on
 * one side (the clip from the recording, the frames under it) and what the
 * coach made of it on the other. A review checked against Riot's record and
 * one Riot's record never reached are painted alike, and the second says its
 * timing is the coach's own read.
 */
function look(c, frames, why) {
  const f = c.forensics;
  const box = el('div', 'v-moment');
  box.id = `moment-${c.n}`;
  const shots = shotsOf(f, frames);
  const media = el('div', 'v-media');
  if (f.clipUrl) {
    box.classList.add('has-clip');
    media.append(clipPlayer(f, posterOf(shots)));
  }
  const gone = !f.clipUrl && f.clipGone ? el('p', 'v-clip-gone', clipGoneText(f.clipGone, 'The frames and facts stay.')) : null;
  // Where a cleared clip was, above the frames that stay, or with the words
  // when no frame stayed either.
  if (gone && shots.length) media.append(gone);
  if (shots.length) media.append(shotStrip(shots, !!f.clipUrl, f.source === 'screen'));
  const advice = el('div', 'v-advice');
  const tag = el('div', 'v-look-tag');
  tag.append(el('span', 'gv-fix-label', "Coach's look"), causeChip(f));
  advice.append(tag);
  const said = f.cause !== 'unclear' && !!(f.what || f.better);
  if (said) {
    if (f.what) advice.append(el('p', 'v-look-what', f.what));
    if (f.better) {
      const b = el('p', 'v-look-better');
      b.append(el('span', 'gv-fix-label', 'Better'), document.createTextNode(f.better));
      advice.append(b);
    }
  }
  // The timing is the look's, so it closes the look's block, and the why
  // (the advice of an unclear look, or the line a screen look landed after:
  // roundRow) comes under it.
  if (f.source === 'screen') advice.append(el('p', 'v-moment-src', SCREEN_TIMING));
  if (why) advice.append(whyLine(why, said));
  if (gone && !shots.length) advice.append(gone);
  if (media.children.length) box.append(media);
  else box.classList.add('no-media');
  box.append(advice);
  return box;
}

/*
 * THE CLIP OF A MOMENT (8.3): the seconds around the death, from the match's
 * own recording, played from occlara-clip:// (main serves it by range,
 * clip-scheme.js). Muted, inline and looping, the frame the coach looked at
 * as its picture until it plays. A click plays or pauses it; out of view, or
 * with the page hidden, it pauses, so a review of six never decodes a clip
 * nobody is watching. The frames stay under it: they are what the coach
 * looked at, and what the moment shows once its clip is gone.
 */
const CLIP_GONE = {
  space: 'Its clip was cleared to keep your clips under the space set in Settings.',
  cleared: 'Its clip was cleared in Settings.',
};
/** Why a moment's clip is gone, and what it still has: its frames and facts, or its facts. */
const clipGoneText = (why, stays) => `${CLIP_GONE[why] || CLIP_GONE.cleared} ${stays}`;
const SVG_NS = 'http://www.w3.org/2000/svg';
let clipWatch = null;

/** Out of view, a clip pauses (IntersectionObserver), where the page has one. */
function watchClip(v) {
  if (typeof IntersectionObserver !== 'function') return;
  if (!clipWatch) {
    clipWatch = new IntersectionObserver((entries) => {
      for (const e of entries) if (!e.isIntersecting && e.target.paused === false) e.target.pause();
    }, { threshold: 0 });
  }
  clipWatch.observe(v);
}

/** Every clip in `host` stopped and let go, so a repaint leaves no decoder running behind it. */
function releaseClips(host) {
  for (const v of host.querySelectorAll('video')) {
    if (clipWatch) clipWatch.unobserve(v);
    if (typeof v.pause === 'function') v.pause();
    v.removeAttribute('src');
    if (typeof v.load === 'function') v.load();
  }
}

/** A play or a pause mark, drawn on the 24 unit grid the app's icons use. */
function clipMark(kind) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', `v-clip-mark ${kind}`);
  const p = document.createElementNS(SVG_NS, 'path');
  p.setAttribute('d', kind === 'play' ? 'M8 5.5v13l10.5-6.5z' : 'M7.5 5.5h3v13h-3zM13.5 5.5h3v13h-3z');
  p.setAttribute('fill', 'currentColor');
  svg.append(p);
  return svg;
}

function clipPlayer(f, poster) {
  const fig = el('figure', 'v-clip');
  const v = document.createElement('video');
  v.className = 'v-clip-video';
  // The attributes are what a reader of the markup sees; muted is set as the
  // property too, since the attribute alone only sets where muted starts.
  v.muted = true;
  for (const a of ['muted', 'loop', 'playsinline']) v.setAttribute(a, '');
  // NOTHING LOADS UNTIL IT IS PLAYED: the poster is the frame, and a review of
  // six clips open between matches, with the next match being recorded, sets
  // up no decoder at all. Measured, a clip loading its metadata took about
  // 40% of a core in the GPU process for a second, a 640x360 one playing
  // about 8%, and one paused nothing.
  v.setAttribute('preload', 'none');
  if (poster) v.setAttribute('poster', poster);
  v.setAttribute('src', f.clipUrl);
  const btn = el('button', 'v-clip-play');
  btn.type = 'button';
  btn.append(clipMark('play'), clipMark('pause'));
  const sync = () => {
    const playing = v.paused === false;
    fig.classList.toggle('playing', playing);
    const label = playing ? 'Pause the clip' : 'Play the clip';
    btn.setAttribute('aria-label', label);
    btn.title = label;
  };
  const toggle = () => {
    if (v.paused === false) { v.pause(); return; }
    const started = typeof v.play === 'function' ? v.play() : null;
    if (started && typeof started.catch === 'function') started.catch(() => sync());
  };
  v.addEventListener('click', toggle);
  btn.addEventListener('click', toggle);
  v.addEventListener('play', sync);
  v.addEventListener('pause', sync);
  sync();
  // The mark sits over the picture, so the two share a frame of their own.
  // No caption: the clip sits in its own death's row, and saying what it is
  // under it was a line on every death saying what the row already said.
  const frame = el('div', 'v-clip-frame');
  frame.append(v, btn);
  fig.append(frame);
  watchClip(v);
  return fig;
}

// A page hidden (another page, the seal) pauses every clip on it.
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) return;
  for (const v of document.querySelectorAll('video')) if (v.paused === false) v.pause();
});

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
 * Bring one round into view, flash it, and hand it the keyboard. Scrolled to
 * and nothing more, focus stayed on the control that jumped (a round in the
 * strip, a round chip in the lists), so the next Tab went on from there, back
 * up the page, and a screen reader read on from it rather than from the round.
 * A row takes focus without joining the tab order (tabindex -1), and without a
 * scroll of its own, which would cut the smooth one short. Asked for reduced
 * motion, the scroll is a jump.
 */
function flashTo(card) {
  if (!card) return;
  const still = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  card.scrollIntoView({ behavior: still ? 'auto' : 'smooth', block: 'center' });
  if (!card.hasAttribute('tabindex')) card.tabIndex = -1;
  card.focus({ preventScroll: true });
  card.classList.remove('flash');
  void card.offsetWidth;
  card.classList.add('flash');
}

/** Jump to one round's row. */
function goRound(n) { flashTo(document.getElementById(`round-${n}`)); }

/*
 * SAID IN ITS ROUND, NOT TWICE (8.3.1). Each death the coach looked at is a
 * miss of its own under "What you missed" (insights.js): "Round 6:" and what
 * the look saw, its better play as the fix. That round's row says the same
 * two sentences beside its clip, so here the entry is its title and its round
 * chip, which jumps to the row. Only where the row does say both: a look that
 * speaks, in a round on this page, whose sentences are the entry's. The
 * library and Home draw the entry whole, with no rounds to jump to, and the
 * lists are counted across matches by key, so nothing in them changes.
 */
function saidInRound(r) {
  const looks = new Map();
  for (const c of Array.isArray(r.rounds) ? r.rounds : []) {
    const f = c && c.forensics;
    if (f && f.cause !== 'unclear' && (f.what || f.better)) looks.set(c.n, f);
  }
  return (e) => {
    const f = e && e.judged && Array.isArray(e.rounds) && e.rounds.length === 1 ? looks.get(e.rounds[0]) : null;
    if (!f) return false;
    const detail = String(e.detail || '');
    return (!e.fix || e.fix === f.better) && [f.what, f.better].some((s) => !!s && detail.endsWith(s));
  };
}

/**
 * The grade and the three lists, for every game, placed under whichever
 * game's header is showing. Hidden when the review carries neither, which is
 * a review saved before grades existed.
 *
 * A VALORANT REVIEW TAKES THE TWO APART (8.3.1): the grade under the result,
 * the lists under the coach's read, so the score, the grade and the read are
 * the first screen and the repeated mistakes come straight after. League and
 * Rivals keep them together under their scores.
 *
 * A REVIEW GRADED FROM RIOT'S RECORD ALONE HAS NO LISTS. Riot records what
 * happened and never why, so main hands it facts in their place, whenever it
 * was saved (present() in src/main/index.js), and GradeView draws them as one
 * neutral list, "What Riot's record shows", with no fix on any of them.
 *
 * @param at.grade  what the grade goes after
 * @param at.lists  what the lists go after, when not straight after the grade
 */
function paintCommon(r, at) {
  const common = $('common');
  const gHost = $('grade-host');
  const iHost = $('insights-host');
  gHost.replaceChildren();
  iHost.replaceChildren();
  if (at.lists) {
    if (at.grade && at.grade.parentNode) at.grade.after(gHost);
    if (at.lists.parentNode) at.lists.after(iHost);
  } else {
    common.append(gHost, iHost);
    if (at.grade && at.grade.parentNode) at.grade.after(common);
  }
  common.hidden = !!at.lists || !(r.grade || r.insights);
  gHost.hidden = !r.grade;
  iHost.hidden = !r.insights;
  if (r.grade) gHost.append(window.GradeView.gradeCard(r.grade));
  if (r.insights) {
    iHost.append(window.GradeView.insightLists(r.insights, {
      onRound: r.kind === 'valorant' ? goRound : false,
      saidInRound: r.kind === 'valorant' ? saidInRound(r) : null,
      empty: r.kind === 'valorant' && !r.verified
        ? 'Most of what this section counts comes from Riot\'s record of the match. It fills in once the match links.'
        : undefined,
    }));
  }
}

/** Show every block, so neither game's review inherits the other's hidden flags. */
function resetSections() {
  for (const id of ['r-moments-wrap', 'r-skills-wrap', 'r-next-wrap', 'r-deaths-wrap',
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
    releaseClips($('v-rounds'));
    releaseClips($('r-deaths'));
    for (const id of ['common', 'grade-host', 'insights-host']) $(id).hidden = true;
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
    // The other container's clips stop with it, hidden or not.
    releaseClips($('r-deaths'));
    $('review').hidden = true;
    $('vreview').hidden = false;
    paintValorant(r);
    paintCommon(r, { grade: $('v-hero'), lists: $('v-summary-wrap') });
    return;
  }
  releaseClips($('v-rounds'));
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
  if (r.kind === 'rivals') { paintRivals(r); paintCommon(r, { grade: $('r-scores') }); return; }

  const g = r.game || {};
  $('r-champ').textContent = g.champion || 'Your game';
  // The middot the Valorant and Rivals lines carry, so the three agree.
  const bits = [g.role, g.mode, g.duration].filter(Boolean);
  $('r-meta').textContent = bits.join('  ·  ');

  // The two Rivals-only sections, which the reset above just turned back on.
  $('r-arch-wrap').hidden = true;
  $('r-refused-wrap').hidden = true;
  $('r-patch-wrap').hidden = true;
  // And the shared heading, back to what this block means in League.
  $('r-verdict-head').textContent = 'How you died';

  paintScores(r.scoreline || {});
  paintCommon(r, { grade: $('r-scores') });
  $('r-death-head').textContent = (r.deaths || {}).headline || '';
  $('r-death-detail').textContent = (r.deaths || {}).detail || '';
  paintLolDeaths(r);
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

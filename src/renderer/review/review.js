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
 * fact a single line. Its clip has the player a round's has (8.4.4), the death
 * marked where the game's clock put it (index.js clipLolDeaths), and no stills.
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
      side.append(window.ClipPlayer.create({
        url: d.clipUrl, label: `The clip of death ${d.n}`, frames: d.clipFrames, death: d.clipDeath,
      }).el);
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
function paintValorant(r, verdict) {
  const g = r.game || {};
  // The Verdict's letter, number and standout, when the review has a grade to
  // show; the result, the score and the scoreboard are there either way.
  // ONE HEADER FOR EVERY STATE (8.7): the grade's slot stays where it is;
  // without a grade to show it is the dashed "Not graded", with the one
  // reason the grade card used to carry beside its question mark (not enough
  // measured, grade.js). AS THE SHARE IMAGE DRAWS IT (8.8): the agent's icon
  // in its tile, no VERDICT word, and the standout where the reason was.
  paintVerdictIcon($('v-icon'), verdict);
  // ORBIT: the hero sits on the ground, no map behind it; the agent floats
  // at its right instead (the same bundled portrait as the icon).
  paintVerdictArt($('v-art'), null);
  paintVerdictAgent($('v-agent'), verdict);
  // 9.1: the match's best highlight, where its clip was kept, in the agent's place.
  paintHighlight(r);
  $('v-grade').replaceChildren(verdict ? verdictGrade(verdict) : notGraded(
    r.grade && typeof r.grade.score !== 'number' ? 'Not enough measured to grade this match' : 'Not graded'));
  $('v-grade').hidden = false;
  paintVerdictStat($('v-stat'), verdict);
  paintMedals(r, null);
  $('v-verdict').classList.toggle('graded', !!verdict);
  const resultEl = $('v-result');
  // Sentence case (Orbit): "Victory", never shouted.
  resultEl.textContent = g.result ? g.result : 'Match review';
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
    // A recording the player imported (8.12).
    r.imported ? (r.matchId || r.verified ? 'Imported recording' : "Imported recording, not matched to Riot's record") : null,
    w.rounds ? `${w.rounds} round${w.rounds === 1 ? '' : 's'} ${r.imported ? 'read' : 'watched'}` : null,
  ].filter(Boolean).join('  ·  ');

  // What Riot's record changed, said out loud. A review whose numbers moved
  // between one look and the next reads as one that cannot decide, unless it
  // says why they moved.
  const ver = $('v-verified');
  ver.hidden = !r.verification;
  ver.textContent = r.verification || '';

  paintStats(r);
  paintFlags(r);

  // The coach's read. Missing when the model was unreachable or the match was
  // too short to narrate, and each case says which. Short lines (8.7): the
  // summary as served() split it into its sentences, a line each, where it was
  // one paragraph; a review served without them is its summary in one line.
  const summary = r.summary;
  // The focus is the Verdict's own line now (8.7), so the read is shown only
  // with a line to read.
  $('v-summary-wrap').hidden = !summary && !r.aiUnavailable && !r.thin && !r.narrativePending;
  const said = summary
    || (r.narrativePending ? "Rewriting the coach's read with Riot's record of the match. This takes a few seconds."
      : r.thin ? 'Too little of this match was seen to write a read of it.'
      : r.aiUnavailable ? 'The coach could not be reached to write this part. Everything else on this page was computed from the match.'
        : '');
  const lines = summary && Array.isArray(r.summaryLines) && r.summaryLines.length ? r.summaryLines : said ? [said] : [];
  // The match's biggest repeat, counted over every death's chain (Nov 2026,
  // insights.js chainCounts via served()), under the coach's read.
  const repeat = summary && r.context && r.context.chains && typeof r.context.chains.main === 'string' ? r.context.chains.main : null;
  $('v-summary').replaceChildren(...lines.map((line) => el('li', 'v-summary-line', line)),
    ...(repeat ? [el('li', 'v-summary-line v-chain-main', repeat)] : []));
  // A focus with no read above it: no empty line between the heading and it.
  $('v-summary').hidden = !lines.length;
  $('v-focus-wrap').hidden = !r.focus;
  paintFixLine($('v-focus'), r.focus || '');
  // PRACTISE THIS (the Practice page): the review's top mistake, its drills
  // on the Practice page, opened on it. Valorant's alone. The mistake the
  // focus is about when the server named it (`focusKey`, Nov 2026) and the
  // list holds it, else the first card.
  {
    const listed = r.kind === 'valorant' && r.insights && Array.isArray(r.insights.mistakes)
      ? r.insights.mistakes.filter((m) => m && typeof m.key === 'string' && m.key) : [];
    const top = (typeof r.focusKey === 'string' && r.focusKey && listed.find((m) => m.key === r.focusKey)) || listed[0] || null;
    let practice = $('v-focus-wrap').querySelector('.v-practice');
    if (!practice) {
      practice = el('button', 'btn btn-link sm v-practice', 'Practice this');
      practice.type = 'button';
      practice.addEventListener('click', () => {
        if (practice.dataset.key) window.occlara.openPractice(practice.dataset.key, practice.dataset.title || null);
      });
      $('v-focus').after(practice);
    }
    const can = !!top && typeof window.occlara.openPractice === 'function';
    practice.hidden = !can;
    practice.dataset.key = can ? top.key : '';
    practice.dataset.title = can && typeof top.title === 'string' ? top.title : '';
  }
  // Last match's result on its top mistake comes with the progress, after.
  $('v-focus-was').hidden = true;
  $('v-focus-was').textContent = '';
  $('v-focus-was-wrap').hidden = true;

  paintComps(r);
  paintPatterns(r);
  paintRounds(r);
  paintStudy(r);
  // The match rating (rating-view.js), as main served it: its swings open
  // their round's row, the clip in it where one was kept.
  // Since 9.1 its replay shows each event's moment where one was kept
  // (mediaOf), over the match's map where none was.
  if (window.RatingView) {
    const art = g.map && typeof window.occlara.mapArt === 'function' ? window.occlara.mapArt(g.map) : null;
    const best = () => {
      const c = current && current.id === r.id ? bestHighlight(current) : null;
      return c ? { clip: c.highlight.clipUrl, at: null, cap: `${highlightTitle(c)}, your best highlight` } : null;
    };
    window.RatingView.paint(r.ratingView || null, { goRound, mediaOf, art, best });
  }

  const refused = Array.isArray(r.refused) ? r.refused : [];
  $('v-refused-wrap').hidden = !refused.length;
  const keptRefused = openedFor(r);
  $('v-refused-wrap').open = keptRefused.refused;
  $('v-refused-wrap').ontoggle = (e) => { keptRefused.refused = e.target.open; };
  const list = $('v-refused');
  list.replaceChildren();
  for (const line of refused) list.append(el('li', 'r-refused-item', line));
}

/*
 * THE VERDICT'S GRADE (8.7; one score, no letter since 9.1): the number out
 * of 100 in its band's tone from GradeView, the one grade colour rule, its
 * name "Grade" beside it with what it measures on hover, PROVISIONAL when the
 * grade is. Each part keeps a class of its own (.vd-name, .vd-score) for the
 * reveal to find.
 */
function verdictGrade(v) {
  // ORBIT (27 Nov 2026): the number is the hero, at the left; beside it its
  // name, "out of 100" and, once main has counted it, the change on the last
  // match (.vd-delta, paintProgress).
  const box = el('div', 'vd-grade');
  const num = el('div', 'vd-num');
  const line = el('div', 'vd-num-line');
  line.append(el('span', 'vd-score ' + (window.GradeView.gradeTone({ score: v.score }) || ''), v.score));
  num.append(line);
  const side = el('div', 'vd-side');
  const name = el('span', 'vd-name', window.GradeView.GRADE_NAME);
  name.title = window.GradeView.GRADE_TIP;
  side.append(name);
  if (v.provisional) side.append(el('span', 'vd-prov', 'Provisional'));
  side.append(el('span', 'vd-out', 'out of 100'));
  const delta = el('span', 'vd-delta');
  delta.hidden = true;
  side.append(delta);
  box.append(num, side);
  return box;
}

/*
 * THE MEDALS (Orbit): a medal for a real thing only, each main's own fact,
 * never another player's name. The place in the lobby by rating when it is
 * first, second or third (the served rating view), and from the progress
 * against the matches before (progress.js, once main answers): a first
 * letter or the best grade in the last graded matches, gold; a run, silver;
 * the best of a category, bronze. Three at most. Built with textContent.
 */
const MEDAL_NS = 'http://www.w3.org/2000/svg';
function medalSvg(tier, n) {
  const svg = document.createElementNS(MEDAL_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 28');
  svg.setAttribute('class', 'medal');
  svg.setAttribute('aria-hidden', 'true');
  const add = (tag, attrs) => { const x = document.createElementNS(MEDAL_NS, tag); for (const [k, val] of Object.entries(attrs)) x.setAttribute(k, String(val)); svg.append(x); return x; };
  add('path', { d: 'M7.6 16 5.2 26.2l3.5-1.5 2.4 2.5 1.5-9z', fill: `url(#mg-${tier})`, opacity: '.7' });
  add('path', { d: 'M16.4 16l2.4 10.2-3.5-1.5-2.4 2.5-1.5-9z', fill: `url(#mg-${tier})`, opacity: '.7' });
  add('circle', { cx: 12, cy: 11, r: 9.6, fill: `url(#mg-${tier})` });
  add('circle', { cx: 12, cy: 11, r: 7.1, fill: `url(#mg-${tier}-in)` });
  if (n) { const t = add('text', { x: 12, y: 14.7, 'text-anchor': 'middle', class: `medal-n ${tier}` }); t.textContent = String(n); }
  return svg;
}
function paintMedals(r, p) {
  const host = $('v-medals');
  if (!host) return;
  const out = [];
  const lines = p && Array.isArray(p.lines) ? p.lines : [];
  const said = (kind) => lines.find((l) => l && l.kind === kind && typeof l.text === 'string' && l.text);
  const plain = (t) => t.replace(/\.$/, '');
  const best = said('first') || said('best');
  if (best) out.push({ tier: 'gold', n: 1, text: plain(best.text) });
  const v = r && r.ratingView;
  const place = v && typeof v.value === 'number' && typeof v.place === 'string' ? /^(\d+)\w*\s+of\s+(\d+)$/.exec(v.place) : null;
  if (place && Number(place[1]) <= 3) {
    out.push({ tier: ['gold', 'silver', 'bronze'][Number(place[1]) - 1], n: Number(place[1]), text: `${v.place} in the lobby by match rating, ${v.shown}` });
  }
  const run = said('run');
  if (run) out.push({ tier: 'silver', n: null, text: plain(run.text) });
  const cat = said('category');
  if (cat) out.push({ tier: 'bronze', n: null, text: plain(cat.text) });
  const shown = out.slice(0, 3);
  host.replaceChildren(...shown.map((m, k) => {
    const item = el('span', 'medal-item');
    item.style.setProperty('--k', String(k));
    item.append(medalSvg(m.tier, m.n), el('span', 'medal-text', m.text));
    return item;
  }));
  host.hidden = !shown.length;
}

/** The fix for the next match, its first clause in the ink and the rest grey; the whole sentence stays its text. */
function paintFixLine(host, text) {
  host.replaceChildren();
  const s = String(text || '');
  const at = s.indexOf(': ');
  if (at < 1) { host.textContent = s; return; }
  host.append(el('span', 'vf-head', s.slice(0, at + 1)), document.createTextNode(' '), el('span', 'vf-sub', s.slice(at + 2)));
}

/** The grade's slot with no grade in it (8.7): the words over a dashed rule. */
function notGraded(text) {
  return el('span', 'vd-none', text);
}

/*
 * THE VERDICT AS THE SHARE IMAGE DRAWS IT (8.8, docs/claude/verdict.md): the
 * character's icon in a rounded tile, and the standout, its value large and
 * its line beside it, where the reason sentence was. Both are verdict.js's
 * own fields (icon, stat), counted there; the page does no arithmetic. The
 * icon's URL is VerdictCard.iconUrl's, the same file the image draws and the
 * same two bundled shapes only, and one that fails to load takes its tile
 * away. No icon, or no standout, and the slot is hidden.
 */
/** The map behind the Verdict (Progress v3), or nothing without its file. */
function paintVerdictArt(host, map) {
  if (!host) return;
  host.replaceChildren();
  const url = typeof window.occlara.mapArt === 'function' ? window.occlara.mapArt(map) : null;
  host.hidden = !url;
  if (!url) return;
  const img = document.createElement('img');
  img.className = 'vd-art-img';
  img.src = url;
  img.alt = '';
  img.addEventListener('error', () => { host.replaceChildren(); host.hidden = true; });
  host.append(img, Object.assign(document.createElement('div'), { className: 'vd-art-scrim' }));
}

/*
 * The agent at the hero's right (Orbit): standing, its full portrait
 * (assets/agents-full through the preload, agent-portraits.js) in front of
 * the moon, fading in once decoded and floating slowly (m-drift, still when
 * the window is hidden, mid match or under less motion). A portrait that
 * fails to load gives way to the head icon, larger and round in its ring;
 * an icon that fails too leaves nothing. Painted again only for another agent.
 */
function paintVerdictAgent(host, v) {
  if (!host) return;
  const face = v && v.icon && window.VerdictCard && typeof window.VerdictCard.iconUrl === 'function'
    ? window.VerdictCard.iconUrl(v.icon) : null;
  const full = v && v.icon && typeof window.occlara.agentPortrait === 'function' ? window.occlara.agentPortrait(v.icon) : null;
  const key = `${full || ''}|${face || ''}`;
  if (host.dataset.agent === key && host.firstChild) return;
  host.dataset.agent = key;
  host.replaceChildren();
  const ring = () => {
    host.replaceChildren();
    host.classList.remove('full');
    host.hidden = !face;
    if (!face) return;
    const img = document.createElement('img');
    img.className = 'vd-agent-img m-drift';
    img.src = face;
    img.alt = '';
    img.addEventListener('error', () => { host.replaceChildren(); host.hidden = true; });
    host.append(img);
  };
  if (!full) { ring(); return; }
  host.classList.add('full');
  host.hidden = false;
  const img = document.createElement('img');
  img.className = 'vd-agent-full m-drift';
  img.alt = '';
  img.decoding = 'async';
  img.draggable = false;
  img.addEventListener('load', () => img.classList.add('ready'), { once: true });
  img.addEventListener('error', ring, { once: true });
  img.src = full;
  host.append(img);
}

/*
 * THE BEST HIGHLIGHT (9.1, the owner's item 16): where a highlight's clip
 * was kept (8.17, main names it on the round's card and presents its URL
 * while it is on disk, review-clips.js presentClips), the best of the match
 * plays at the hero's right, muted, in a loop, in the agent's place; with
 * none kept the agent stands there as before, and nothing says a clip is
 * missing. THE BEST is clips.js highlightRank's order, the order the clips
 * were cut in: an ace, a 4K, a clutch won, a 3K, a 2K, then the earlier
 * round. Its line is Riot's facts of the round ("Round 17, 4K"), a clutch
 * named only where the player was alive at the end (insights.js
 * clutchWonAlive). It plays only while it can be seen and ambient motion is
 * on (Motion.ambientOn: never mid match, with the window hidden or less
 * motion asked), and its own button pauses it, which a repaint keeps.
 */
function highlightRankOf(c) {
  const r = c && c.riot;
  const h = c && c.highlight;
  const kills = r && typeof r.kills === 'number' ? r.kills : h && Array.isArray(h.kills) ? h.kills.length : 0;
  if (kills < 1) return null;
  // A clutch won ranks only where Riot says the player lived through it
  // (9.1, insights.js clutchWonAlive): a round won after the player died is
  // no clutch of theirs, and its lone kill is no highlight.
  const won = !!(r && r.clutch && typeof r.clutch.vs === 'number' && r.clutch.won === true && c.died === false);
  if (kills >= 5) return 0;
  if (kills === 4) return 1;
  if (won) return 2;
  if (kills === 3) return 3;
  if (kills === 2) return 4;
  return null;
}
function bestHighlight(r) {
  let best = null;
  for (const c of Array.isArray(r && r.rounds) ? r.rounds : []) {
    const h = c && c.highlight;
    if (!h || typeof h.clipUrl !== 'string' || !h.clipUrl || !Number.isInteger(c.n)) continue;
    const rank = highlightRankOf(c);
    const k = rank === null ? 9 : rank;
    if (!best || k < best.k || (k === best.k && c.n < best.c.n)) best = { c, k };
  }
  return best ? best.c : null;
}
function highlightTitle(c) {
  const r = c.riot || {};
  const h = c.highlight || {};
  const kills = typeof r.kills === 'number' ? r.kills : Array.isArray(h.kills) ? h.kills.length : 0;
  const alive = !!(r.clutch && r.clutch.won === true && r.clutch.vs >= 1 && c.died === false);
  const parts = [`Round ${c.n}`];
  if (kills >= 5) parts.push('an ace');
  else if (kills >= 2) parts.push(`${kills}K`);
  if (alive) parts.push(`won alone against ${r.clutch.vs === 1 ? 'one' : r.clutch.vs}`);
  else if (kills === 1) parts.push('a kill');
  return parts.join(', ');
}
/*
 * THE ROUND'S HIGHLIGHT IN ITS ROW (9.1): where a highlight's clip was kept,
 * its player under the round's own words, its kills and its cuts marked on
 * the timeline (clip-player.js, 8.17), beside the same line of Riot's facts
 * the hero's card says ("4K", "An ace"). So the best highlight's line at the
 * top, and Clips' way into a round, open a row with its clip in it. Null
 * with none kept.
 */
function highlightPart(c) {
  const h = c && c.highlight;
  if (!h || typeof h.clipUrl !== 'string' || !h.clipUrl || !window.ClipPlayer) return null;
  const box = el('div', 'v-moment has-clip v-hl-moment');
  const media = el('div', 'v-media');
  media.append(window.ClipPlayer.create({
    url: h.clipUrl, label: `The highlight of round ${c.n}`, frames: h.clipFrames,
    kills: Array.isArray(h.kills) ? h.kills : [], cuts: Array.isArray(h.cuts) ? h.cuts : [],
  }).el);
  const side = el('div', 'v-advice');
  const tag = el('div', 'v-look-tag');
  tag.append(el('span', 'gv-fix-label', 'Your highlight'));
  const words = highlightTitle(c).split(', ').slice(1).join(', ');
  side.append(tag);
  if (words) side.append(el('p', 'v-look-what', words.charAt(0).toUpperCase() + words.slice(1)));
  box.append(media, side);
  return box;
}
const hl = { url: null, user: null, inView: true, watch: null, stall: null };
const HL_STALL_MS = 8000;
function paintHighlight(r) {
  const host = $('v-hl');
  if (!host) return;
  const c = r && r.kind === 'valorant' && r.locked !== true && !r.work ? bestHighlight(r) : null;
  const url = c ? c.highlight.clipUrl : null;
  $('v-verdict').classList.toggle('has-hl', !!url);
  const sky = $('v-sky');
  if (sky) sky.classList.toggle('with-hl', !!url);
  if (!url) { stopHighlight(); host.hidden = true; return; }
  host.hidden = false;
  const title = highlightTitle(c);
  const go = $('v-hl-round');
  go.textContent = title;
  go.dataset.round = String(c.n);
  go.setAttribute('aria-label', `${title}. Open round ${c.n}`);
  go.title = `Open round ${c.n}`;
  const v = $('v-hl-video');
  if (hl.url !== url) {
    stopHighlight();
    hl.url = url;
    hl.user = null;
    host.classList.remove('ready');
    // Where it cannot play by itself, its picture is the first kill, not the walk to it.
    const first = Array.isArray(c.highlight.kills) && c.highlight.kills.length ? c.highlight.kills[0] / 1000 : null;
    // A clip that never shows a frame gives the place back to the agent, as one that fails does.
    clearTimeout(hl.stall);
    hl.stall = setTimeout(() => { if (hl.url === url && !host.classList.contains('ready') && v.onerror) v.onerror(); }, HL_STALL_MS);
    v.onloadeddata = () => {
      clearTimeout(hl.stall);
      host.classList.add('ready');
      if (v.paused && first !== null && v.currentTime < 0.05) { try { v.currentTime = Math.max(0, first - 0.3); } catch (e) { /* not seekable yet */ } }
    };
    // A clip that will not play takes its card away, and the agent stands there again.
    v.onerror = () => {
      stopHighlight();
      host.hidden = true;
      $('v-verdict').classList.remove('has-hl');
      if (sky) sky.classList.remove('with-hl');
    };
    v.preload = 'auto';
    v.setAttribute('src', url);
  }
  if (!hl.watch && typeof IntersectionObserver === 'function') {
    hl.watch = new IntersectionObserver((entries) => {
      for (const e of entries) hl.inView = e.isIntersecting;
      syncHighlight();
    }, { threshold: 0.2 });
    hl.watch.observe(v);
  }
  syncHighlight();
}
/** Plays or pauses the highlight by what is allowed now and what the player asked. */
function syncHighlight() {
  const host = $('v-hl');
  const v = $('v-hl-video');
  if (!host || !v || host.hidden || !hl.url) return;
  const M = window.Motion;
  const seen = hl.inView && document.visibilityState !== 'hidden' && !(M && typeof M.still === 'function' && M.still());
  const auto = !M || typeof M.ambientOn !== 'function' || M.ambientOn();
  const may = seen && (hl.user === 'play' || (hl.user !== 'pause' && auto));
  if (may && v.paused && typeof v.play === 'function') { const p = v.play(); if (p && typeof p.catch === 'function') p.catch(() => {}); }
  else if (!may && !v.paused && typeof v.pause === 'function') v.pause();
  const playing = may;
  host.classList.toggle('paused', !playing);
  const t = $('v-hl-toggle');
  t.setAttribute('aria-label', playing ? 'Pause the highlight' : 'Play the highlight');
  t.title = playing ? 'Pause' : 'Play';
}
function stopHighlight() {
  const v = $('v-hl-video');
  hl.url = null;
  clearTimeout(hl.stall);
  if (!v) return;
  v.onloadeddata = null;
  v.onerror = null;
  if (typeof v.pause === 'function') v.pause();
  if (v.getAttribute('src')) { v.removeAttribute('src'); if (typeof v.load === 'function') v.load(); }
}
$('v-hl-toggle').addEventListener('click', () => {
  const host = $('v-hl');
  hl.user = host.classList.contains('paused') ? 'play' : 'pause';
  syncHighlight();
});
$('v-hl-round').addEventListener('click', () => { const n = Number($('v-hl-round').dataset.round); if (n) goRound(n); });
document.addEventListener('visibilitychange', () => {
  syncHighlight();
  // A page put away takes its open menu with it (the confirm stays: it is a question asked).
  if (document.visibilityState === 'hidden' && typeof closeMore === 'function') closeMore(false);
});
if (window.Motion && typeof window.Motion.onAmbient === 'function') window.Motion.onAmbient(syncHighlight);

/*
 * THE MOMENT OF ONE RATING EVENT, FOR THE REPLAY (9.1, the owner's item 16):
 * what was kept of it on this PC, or null. The player's death: the round's
 * death clip from just before the death (the coach's look, else a flagged
 * death's), else the look's frame nearest before it. The player's kill: the
 * round's highlight clip at that kill (its nth in the round, on the clip's
 * own timeline). Anything else, or nothing kept: null, and the replay says
 * so. `role` and `nth` are the replay's (rating-view.js roleOf).
 */
function mediaOf(e, role, nth) {
  const r = current;
  if (!r || !e || !Number.isInteger(e.round)) return null;
  const c = (Array.isArray(r.rounds) ? r.rounds : []).find((x) => x && x.n === e.round);
  if (!c) return null;
  const sec = (ms) => (typeof ms === 'number' && Number.isFinite(ms) && ms >= 0 ? ms / 1000 : null);
  if (role === 'death' && c.died) {
    const f = c.forensics || null;
    if (f && f.clipUrl) return { clip: f.clipUrl, at: sec(f.clipDeath), cap: `Round ${c.n}, the clip of your death` };
    const flag = c.flag || null;
    if (flag && flag.clipUrl) return { clip: flag.clipUrl, at: sec(flag.clipDeath), cap: `Round ${c.n}, the clip of your death` };
    const shot = f ? posterOf(shotsOf(f, r.frameData || {})) : null;
    if (shot) return { frame: shot, cap: `Round ${c.n}, the frame the coach looked at` };
    return null;
  }
  if (role === 'kill') {
    const h = c.highlight || null;
    if (h && typeof h.clipUrl === 'string' && h.clipUrl) {
      const kills = Array.isArray(h.kills) ? h.kills : [];
      const at = kills.length ? sec(kills[Math.min(Math.max(0, nth || 0), kills.length - 1)]) : null;
      return { clip: h.clipUrl, at, cap: `Round ${c.n}, from your highlight` };
    }
  }
  return null;
}

function paintVerdictIcon(host, v) {
  host.replaceChildren();
  const url = v && v.icon && window.VerdictCard && typeof window.VerdictCard.iconUrl === 'function'
    ? window.VerdictCard.iconUrl(v.icon) : null;
  host.hidden = !url;
  if (!url) return;
  const img = document.createElement('img');
  img.className = 'vd-icon-img';
  img.src = url;
  img.alt = '';
  img.addEventListener('error', () => { host.replaceChildren(); host.hidden = true; });
  host.append(img);
}
function paintVerdictStat(host, v) {
  const s = v && v.stat;
  host.replaceChildren();
  host.hidden = !(s && s.value && s.label);
  if (host.hidden) return;
  host.append(el('span', 'vd-stat-value', s.value), el('span', 'vd-stat-label', s.label));
}

/** League's Verdict, as the Valorant one: the icon and the role, the grade and the standout. */
function paintLolVerdict(v) {
  const host = $('r-verdict');
  host.replaceChildren();
  host.hidden = !v;
  if (!v) return;
  const top = el('div', 'vd-top');
  const who = el('div', 'vd-who');
  const icon = el('span', 'vd-icon');
  paintVerdictIcon(icon, v);
  who.append(icon);
  if (v.sub) who.append(el('div', 'v-meta', v.sub));
  top.append(who);
  if (v.right) top.append(el('span', 'v-result', v.right));
  const main = el('div', 'vd-main');
  const said = el('div', 'vd-said');
  const stat = el('p', 'vd-stat');
  paintVerdictStat(stat, v);
  said.append(stat);
  main.append(verdictGrade(v), said);
  host.append(top, main);
}

/*
 * THIS MATCH AGAINST THE ONES BEFORE IT (8.7), asked of main once the page is
 * painted (shared/progress.js matchProgress through PROGRESS_GET): its lines a
 * chip each under the Verdict, and on a Valorant review with a focus, the line
 * on last match's top mistake above that focus rather than among the chips.
 * An answer for a review the page has moved on from is dropped.
 */
let progressFor = null;
// The answer asked for last, kept for the reveal's sound to wait on (a best
// plays 'best'), so the page asks main once.
let progressAsked = null;
/*
 * RIOT'S RANK RECORD OF THIS MATCH (8.7.9, REVIEW_RIOT through the preload's
 * riotOf): the RR it moved as a chip beside the result, "RR +18", and Riot's
 * own accolades (top frag, an ace, an act record) as lines of "What went
 * well", each marked as Riot's record. Main matches both by the match's Riot
 * id and sends finished words; the page counts nothing. Only RR as the game
 * shows it, never a rating. Asked once per paint, and an answer for a review
 * no longer on the page, or one being built or locked, paints nothing.
 *
 * A review opened before Riot publishes its game (8.7.9): main answers
 * `waiting` for a rated match that ended within the hour with no RR yet, and
 * the page asks again RIOT_AGAIN_MS later (Home's own RANK_AGAIN_MS), at most
 * RIOT_TRIES times, under the same guards. Every paint and clearRR stops the
 * timer, and main still answers null mid match or sealed, so nothing shows
 * during a match.
 */
const RIOT_AGAIN_MS = 6 * 60 * 1000;
const RIOT_TRIES = 2;
let riotFor = null;
let riotAgain = null;
function clearRR() {
  if (riotAgain) { clearTimeout(riotAgain); riotAgain = null; }
  const chip = $('v-rr');
  chip.hidden = true;
  chip.textContent = '';
  chip.className = 'v-rr';
  chip.title = '';
}
function paintRiot(r) {
  clearRR();
  const id = r && r.id;
  riotFor = id || null;
  if (!id || r.kind !== 'valorant' || typeof window.occlara.riotOf !== 'function') return;
  askRiot(id, 0);
}
function askRiot(id, tries) {
  Promise.resolve(window.occlara.riotOf(id)).then((x) => {
    if (riotFor !== id || !current || current.id !== id || current.work || current.locked === true || !x) return;
    const painted = !!(x.rr && typeof x.rr.text === 'string' && x.rr.text);
    if (painted) {
      const chip = $('v-rr');
      chip.textContent = x.rr.text;
      chip.className = 'v-rr' + (x.rr.tone ? ' ' + x.rr.tone : '');
      chip.title = x.rr.title || '';
      chip.hidden = false;
    }
    if (Array.isArray(x.accolades) && x.accolades.length) paintAccolades(x.accolades);
    if (x.waiting === true && !painted && tries < RIOT_TRIES) {
      if (riotAgain) clearTimeout(riotAgain);
      riotAgain = setTimeout(() => {
        riotAgain = null;
        if (riotFor !== id || !current || current.id !== id || current.work || current.locked === true) return;
        askRiot(id, tries + 1);
      }, RIOT_AGAIN_MS);
    }
  }).catch(() => {});
}

/** Riot's accolades as "What went well" lines, into that list or a new one after the first. */
function paintAccolades(list) {
  const host = $('insights-host');
  if (!host || host.hidden) return;
  const wrap = host.querySelector('.gv-insights');
  if (!wrap) return;
  for (const old of wrap.querySelectorAll('.v-accolade, .v-accolade-block')) old.remove();
  let ul = null;
  for (const block of wrap.querySelectorAll('.gv-block')) {
    const h = block.querySelector('h3');
    if (h && h.textContent === 'What went well') { ul = block.querySelector('.gv-list'); break; }
  }
  if (!ul) {
    const block = el('section', 'gv-block v-accolade-block');
    block.append(el('h3', null, 'What went well'));
    ul = el('ul', 'gv-list');
    block.append(ul);
    const first = wrap.querySelector('.gv-block');
    if (first) first.after(block); else wrap.prepend(block);
    const empty = wrap.querySelector('.gv-empty');
    if (empty) empty.remove();
  }
  for (const a of list) {
    if (!a || typeof a.title !== 'string' || !a.title) continue;
    const li = el('li', 'gv-item good v-accolade');
    const head = el('div', 'gv-item-head');
    head.append(el('span', 'gv-dot'), el('b', 'gv-item-title', a.title), el('span', 'gv-badge', "Riot's record"));
    li.append(head);
    if (typeof a.detail === 'string' && a.detail) li.append(el('p', 'gv-item-detail', a.detail));
    ul.append(li);
  }
}

function paintProgress(r) {
  const valorant = r.kind === 'valorant';
  const host = $(valorant ? 'v-prog' : 'r-prog');
  for (const id of ['v-prog', 'r-prog']) { $(id).replaceChildren(); $(id).hidden = true; }
  const id = r.id;
  progressFor = id || null;
  progressAsked = null;
  if (!id || !window.occlara.progressOf) return;
  const asked = Promise.resolve(window.occlara.progressOf(id));
  progressAsked = { id, asked };
  asked.then((p) => {
    if (progressFor !== id || !current || current.id !== id || current.work || !p) return;
    const lines = Array.isArray(p.lines) ? p.lines : [];
    // ORBIT: the medals main's progress earns, and the change on the last
    // match beside the grade, its sign in its words and an arrow.
    if (valorant) {
      paintMedals(r, p);
      const delta = document.querySelector('#v-grade .vd-delta');
      const vs = p.vsLast && typeof p.vsLast.delta === 'number' ? p.vsLast.delta : null;
      if (delta) {
        delta.hidden = vs === null;
        delta.className = 'vd-delta ' + (vs > 0 ? 'up' : vs < 0 ? 'down' : 'even');
        delta.textContent = vs === null ? '' : vs > 0 ? `+${vs} on your last match` : vs < 0 ? `${vs} on your last match` : 'Level with your last match';
      }
    }
    const focusLine = valorant && r.focus ? lines.find((l) => l && l.kind === 'focus' && l.text) : null;
    const strip = window.GradeView.progressStrip(p, { omit: focusLine ? ['focus'] : [] });
    // Replaced, never added to: a review painted twice asks twice.
    host.replaceChildren(...(strip ? [strip] : []));
    host.hidden = !strip;
    if (focusLine) {
      const was = $('v-focus-was');
      was.textContent = focusLine.text;
      was.className = 'v-focus-was ' + (focusLine.tone || 'even');
      was.hidden = false;
      $('v-focus-was-wrap').hidden = false;
    }
  }).catch(() => {});
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

/**
 * One of Riot's numbers, its label, and how it compares, in the Verdict's
 * row. A number the review does not have is left out, never drawn as "--",
 * as the Verdict leaves it out (shared/verdict.js statsOf).
 */
function vStat(label, value, a, name) {
  if (value === null || value === undefined) return null;
  const box = el('div', 'v-stat');
  box.append(el('div', 'v-stat-value', value));
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
  host.append(...[
    vStat('K / D / A', kda, vs.kd, 'K/D'),
    vStat('ACS', s.acs, vs.acs),
    vStat('ADR', s.adr, vs.adr),
    vStat('Headshot', typeof s.headshotPct === 'number' ? s.headshotPct + '%' : null, vs.headshot),
  ].filter(Boolean));
  // What the comparison is over, once: every number carries its sample.
  const over = Object.values(vs)[0];
  if (over && over.games) {
    note.hidden = false;
    note.textContent = `Against your average over your last ${over.games} verified matches in the same role.`;
  }
}

/*
 * THE DEATHS THE PLAYER FLAGGED (8.13), in yellow: the flag is the player's own
 * mark, a thing to come back to, so it takes --warn and not a death's --bad.
 */
const FLAG_PATH = 'M5.5 21V4.5M5.5 4.5h11.2a.6.6 0 0 1 .5.92L15.2 8.5l2 3.08a.6.6 0 0 1-.5.92H5.5';
function flagIcon() {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'v-flag-icon');
  const p = document.createElementNS(SVG_NS, 'path');
  p.setAttribute('d', FLAG_PATH);
  p.setAttribute('fill', 'currentColor');
  p.setAttribute('stroke', 'currentColor');
  p.setAttribute('stroke-width', '2');
  p.setAttribute('stroke-linecap', 'round');
  p.setAttribute('stroke-linejoin', 'round');
  svg.append(p);
  return svg;
}

function paintFlags(r) {
  const host = $('v-flags');
  host.replaceChildren();
  const f = r.deathFlags || null;
  const rounds = f && Array.isArray(f.rounds) ? f.rounds : [];
  const notes = [];
  if (f && f.unmatched) notes.push(`${f.unmatched === 1 ? 'One press' : `${f.unmatched} presses`} of the flag key matched no death.`);
  if (f && f.over) notes.push('A match keeps six flagged deaths, the first six.');
  if (f && f.keyFailed) notes.push('Another app held your flag key for part of this match. You can change it in Settings.');
  host.hidden = !rounds.length && !notes.length;
  if (host.hidden) return;
  if (rounds.length) {
    const line = el('p', 'v-flags-line');
    line.append(flagIcon(), el('span', null, `You flagged ${rounds.length} death${rounds.length === 1 ? '' : 's'}:`));
    for (const x of rounds) {
      const b = el('button', 'v-flags-round', `Round ${x.n}`);
      b.type = 'button';
      b.addEventListener('click', () => goRound(x.n));
      line.append(b);
    }
    host.append(line);
  }
  for (const n of notes) host.append(el('p', 'v-flags-note', n));
}

/*
 * FURTHER EXPLAIN (8.13): under every death, one saved answer from the coach,
 * asked once. Which deaths are being answered is kept here, since Riot's record
 * can repaint the page while one is out.
 */
const explaining = new Set();
const explainErrors = new Map();
const EXPLAIN_SAID = {
  locked: 'You have used all your games. Get more in your Profile to ask the coach.',
  later: 'The coach is busy. Try again in a minute.',
  match: 'This opens once your match is over.',
  gone: 'This death can no longer be explained.',
  failed: 'The coach could not explain this death. Try again.',
};

function explainAnswer(a) {
  const box = el('div', 'v-explain-answer');
  for (const [label, text] of [['What happened', a.happened], ['Why it went wrong', a.why], ['What to do instead', a.instead]]) {
    if (!text) continue;
    const p = el('p', 'v-explain-line');
    p.append(el('span', 'gv-fix-label', label), document.createTextNode(text));
    box.append(p);
  }
  if (a.from === 'facts') box.append(el('p', 'v-moment-src', "From Riot's record of the round. No picture of this death was kept."));
  return box;
}

function explainBlock(r, c) {
  const box = el('div', 'v-explain');
  if (c.explain) { box.append(explainAnswer(c.explain)); return box; }
  const key = `${r.id}|${c.n}`;
  const busy = explaining.has(key);
  const b = el('button', 'btn btn-ghost sm v-explain-btn', busy ? 'Explaining' : 'Further explain');
  b.type = 'button';
  b.disabled = busy;
  b.setAttribute('aria-busy', busy ? 'true' : 'false');
  const said = explainErrors.get(key);
  b.addEventListener('click', async () => {
    explaining.add(key);
    explainErrors.delete(key);
    b.disabled = true;
    b.textContent = 'Explaining';
    b.setAttribute('aria-busy', 'true');
    if (err) err.hidden = true;
    let got = null;
    try { got = await window.occlara.explainDeath(r.id, c.n); } catch { got = null; }
    explaining.delete(key);
    // The row as it stands now: Riot's record may have repainted the page.
    const row = document.getElementById(`round-${c.n}`);
    const live = current && current.id === r.id && row ? row.querySelector('.v-explain') : null;
    if (got && got.ok && got.explain) {
      c.explain = got.explain;
      if (live) live.replaceChildren(explainAnswer(got.explain));
      return;
    }
    explainErrors.set(key, EXPLAIN_SAID[(got && got.error) || 'failed'] || EXPLAIN_SAID.failed);
    if (live) live.replaceChildren(...[...explainBlock(r, c).children]);
  });
  const err = el('p', 'v-explain-error', said || '');
  err.hidden = !said;
  err.setAttribute('role', 'status');
  box.append(b, err);
  return box;
}

// An answer saved, asked here or by itself for a flagged death: its row alone.
if (window.occlara && window.occlara.onDeathExplained) {
  window.occlara.onDeathExplained((a) => {
    if (!a || !current || current.id !== a.id) return;
    const card = (current.rounds || []).find((c) => c && c.n === a.n);
    if (card) card.explain = a.explain;
    const row = document.getElementById(`round-${a.n}`);
    const box = row && row.querySelector('.v-explain');
    if (box) box.replaceChildren(explainAnswer(a.explain));
  });
}

/*
 * FIGHT IT AGAIN (Nov 2026, shared/trainer-replay.js): a death main says the
 * Trainer can replay carries that replay's id (`c.replay`, index.js present),
 * and its row has the button beside Further explain. A click asks main to open
 * the Trainer on it; main checks the id again and opens nothing mid match.
 */
const REPLAY_ID = /^[a-z]+-\d{10,}-[a-z0-9]{4,}:\d{1,3}$/;
function replayButton(c) {
  const b = el('button', 'btn btn-ghost sm v-replay-btn', 'Fight it again');
  b.type = 'button';
  b.setAttribute('aria-label', `Round ${c.n}, fight it again in the Trainer`);
  b.addEventListener('click', () => { window.occlara.openReplay(c.replay); });
  return b;
}

/** What a death's row adds: a flagged death's own clip and note, Further explain, and Fight it again. */
function deathExtras(r, c) {
  const flag = c.flag || null;
  const canExplain = !!(c.died && r.id && r.kind === 'valorant' && window.occlara && window.occlara.explainDeath && !c.tags?.some?.((t) => t && t.kind === 'afk'));
  const canReplay = !!(c.died && r.kind === 'valorant' && typeof c.replay === 'string' && REPLAY_ID.test(c.replay)
    && window.occlara && window.occlara.openReplay);
  if (!flag && !canExplain && !canReplay) return null;
  const box = el('div', 'v-death-extra');
  const lookHasClip = c.forensics && c.forensics.clipUrl;
  if (flag && flag.clipUrl && !lookHasClip) {
    const player = window.ClipPlayer.create({ url: flag.clipUrl, label: `The clip of round ${c.n}`,
      frames: flag.clipFrames, death: flag.clipDeath, screen: !c.verified, stills: [] });
    const media = el('div', 'v-media');
    media.append(player.el);
    box.append(media);
  } else if (flag && !flag.clipUrl && flag.clipGone) {
    box.append(el('p', 'v-clip-gone', clipGoneText(flag.clipGone, 'The flag stays.')));
  }
  if (flag && flag.noDeath) box.append(el('p', 'v-moment-src', "You flagged this round, but Riot's record has no death for you in it."));
  if (canReplay) {
    // One row: Further explain, then Fight it again beside it; an answer
    // already given drops below the button (review.css .v-death-actions).
    const actions = el('div', 'v-death-actions');
    if (canExplain) actions.append(explainBlock(r, c));
    actions.append(replayButton(c));
    box.append(actions);
  } else if (canExplain) {
    box.append(explainBlock(r, c));
  }
  return box.children.length ? box : null;
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
  // Closed on every new review (8.7): reading for later, under the rounds.
  // A repaint of the same review keeps it as the player left it.
  const keptStudy = openedFor(r);
  $('v-study-wrap').open = keptStudy.study;
  $('v-study-wrap').ontoggle = (e) => { keptStudy.study = e.target.open; };
  const host = $('v-study');
  host.replaceChildren();
  for (const n of study) host.append(el('li', 'v-study-note', n.text));
}

/*
 * BOTH TEAM COMPS, ONE LINE OVER THE ROUNDS (8.5.0, the player's choice):
 * "Your team: Breach, Jett (you), Killjoy, Omen, Sova. Theirs: ...", as
 * valorant-review.js compsLine computed it from Riot's record when main
 * presented the review, agents only. Set by textContent; no line without one.
 */
function paintComps(r) {
  const line = typeof r.compsLine === 'string' ? r.compsLine : '';
  const host = $('v-comps');
  host.textContent = line;
  host.hidden = !line;
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
/*
 * WHAT THE PLAYER OPENED STAYS OPEN ON A REPAINT OF THE SAME REVIEW (8.7): the
 * screen look lands after the review and pushes the same id again, and a fold
 * or the study notes snapping shut under the player's hand reads as a bug.
 * Another review starts closed.
 */
const opened = { id: null, rounds: new Set(), study: false, refused: false };
function openedFor(r) {
  const id = (r && r.id) || null;
  if (!id || opened.id !== id) {
    opened.id = id;
    opened.rounds = new Set();
    opened.study = false;
    opened.refused = false;
  }
  return opened;
}

function paintRounds(r) {
  const host = $('v-rounds');
  releaseClips(host);
  host.replaceChildren();
  const rounds = Array.isArray(r.rounds) ? r.rounds : [];
  $('v-rounds-wrap').hidden = !rounds.length;
  // Every round goes nowhere with no rounds to go to (9.1).
  $('v-every').hidden = !rounds.length;
  const frames = r.frameData || {};
  const kept = openedFor(r);
  // The two halves headed by their side (8.7): one heading where the half
  // changes, the strip of cells that used to say it gone.
  const half = r.halftimeAfter;
  const moves = roundMoves(r);
  let lastHalf = 0;
  for (const c of rounds) {
    const h = half && c.n > half ? 2 : 1;
    if (h !== lastHalf && c.side) host.append(el('div', 'v-half-side', c.side));
    lastHalf = h;
    const row = roundRow(r, c, frames);
    placeMove(row, moves.get(c.n));
    host.append(row);
    if (kept.rounds.has(c.n)) openRow(row);
  }
}

/*
 * WHAT MOVED THE RATING IN EACH ROUND (9.1, the owner's item 16): on every
 * round's line, the round's move of the match rating on the 100 scale, as
 * the rating's own view counted it (rating.js viewOf: each round's delta is
 * the difference of the two shown numbers, so the rounds add up to the
 * match), and the engine's label of what happened ("Quadra kill with the
 * opening kill, then died"). The page works out nothing: a review with no
 * rating, or a round the view has no label for, shows none. Its colour is
 * the move's sign (rating-badge.js wayOf), the sign itself always the text.
 */
function roundMoves(r) {
  const v = r && r.ratingView;
  const out = new Map();
  if (!v || typeof v.value !== 'number' || !Array.isArray(v.rounds)) return out;
  for (const x of v.rounds) {
    if (!x || !Number.isInteger(x.n) || typeof x.delta !== 'string' || !x.delta) continue;
    const label = typeof x.label === 'string' && x.label ? x.label : null;
    if (!label) continue;
    out.set(x.n, { delta: x.delta, label });
  }
  return out;
}
function placeMove(row, m) {
  if (!row || !m) return;
  const head = row.querySelector('.v-round-head');
  if (!head) return;
  const way = window.RatingBadge && typeof window.RatingBadge.wayOf === 'function' ? window.RatingBadge.wayOf(m.delta) : null;
  const box = el('span', 'v-rt-move' + (way ? ` ${way}` : ' even'));
  box.title = `Match rating ${m.delta} this round: ${m.label}`;
  box.append(el('span', 'sr-only', 'Match rating '), el('span', 'v-rt-label', m.label), el('span', 'v-rt-d', m.delta));
  // Before the round's own controls (its eye, its fold), after its words.
  const before = [...head.children].find((n) => n.classList && (n.classList.contains('log-eye') || n.classList.contains('v-fold')));
  if (before) head.insertBefore(box, before); else head.append(box);
  row.classList.add('has-move');
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
  // THE KILLER CARD IS RIOT'S, NOT THE COACH'S (8.8): a died round the coach
  // neither looked at nor wrote about still has the card when the record
  // has one, alone in the row's body, folded or open as served() says.
  const killerOnly = !f && !why ? killerCardEl(c.killerCard) : null;
  // The death as a chain of mistakes (Nov 2026, served() from death-chain.js).
  const chain = chainEl(c.chain);
  // A flagged death's clip and Further explain (8.13).
  const extra = deathExtras(r, c);
  // The round's highlight, where its clip was kept (9.1, highlightPart).
  const hlPart = highlightPart(c);
  const row = el('article', 'v-round' + (f || why || killerOnly || chain || extra || hlPart ? '' : ' quiet'));
  row.id = `round-${c.n}`;
  const head = el('div', 'v-round-head');
  // The number is the row's anchor (8.7): a click brings the row into view
  // and flashes it, as the mistakes' round chips do. Out of the tab order.
  const rn = el('button', 'v-rn', `R${c.n}`);
  rn.type = 'button';
  rn.tabIndex = -1;
  rn.title = `Round ${c.n}`;
  rn.addEventListener('click', (e) => { e.stopPropagation(); goRound(c.n); });
  head.append(rn);
  if (c.result) head.append(el('span', 'v-chip ' + c.result, c.result === 'won' ? 'Won' : 'Lost'));
  if (c.side) head.append(el('span', 'v-side', c.side));
  if (c.flag) {
    const mark = el('span', 'v-flag');
    mark.append(flagIcon(), document.createTextNode('Flagged'));
    head.append(mark);
    row.classList.add('flagged');
  }
  // A round whose death holds more than one mistake says so on its line.
  const many = c.chain && Number.isInteger(c.chain.mistakes) && c.chain.mistakes > 1 ? c.chain.mistakes : 0;
  if (many) {
    const mark = el('span', 'v-tag warn', `${many} mistakes`);
    mark.dataset.kind = 'chain';
    head.append(mark);
  }
  row.append(head);
  if (!f && !why && !killerOnly && !chain && !extra && !hlPart) {
    const facts = factsOf(c, 'span');
    if (facts) head.append(facts);
    return row;
  }
  // The AI log at the moment the coach looked at, while it still holds the
  // match: the eye in the page's header opens the match on its first death.
  const eye = f && r.id && r.aiLog === 'kept' && typeof f.at === 'number' && window.LogEye
    ? window.LogEye.button('kept', () => window.occlara.openAiLog(r.id, f.at), window.LogEye.MOMENT) : null;
  const plain = f ? look(c, frames, why, chain) : why ? whyWithKiller(c, why) : killerOnly;
  // With no look, the chain leads the row's words, the why or the killer card under it.
  let said = plain;
  if (chain && !f) {
    said = el('div', 'v-why-block');
    said.append(chain);
    if (plain) said.append(plain);
  }
  // The flagged clip and Further explain sit under the row's own words, the
  // round's highlight last.
  const parts = [said, extra, hlPart].filter(Boolean);
  // A row whose highlight is all it has folds to its line until asked (9.1):
  // six open players down the page would bury the rounds.
  const onlyHl = !said && !extra && !!hlPart;
  /*
   * A ROUND NOT OPEN IS ONE LINE UNTIL ASKED (8.7): served() opens a round
   * with a look or a why, or one of the top mistake's, and the rest of the
   * rows with something to say fold to their number, result, side and tags,
   * opened by a click anywhere on the line or the chevron's own key. A row
   * served before there was `open` is open.
   */
  if (c.open === false || onlyHl) {
    const facts = factsOf(c, 'span');
    if (facts) head.append(facts);
    if (eye) head.append(eye);
    const body = el('div', 'v-round-body');
    body.id = `round-${c.n}-body`;
    body.hidden = true;
    body.append(...parts);
    const more = el('button', 'v-fold');
    more.type = 'button';
    more.setAttribute('aria-expanded', 'false');
    more.setAttribute('aria-controls', body.id);
    more.setAttribute('aria-label', killerOnly ? `Round ${c.n}, show what killed you`
      : said ? `Round ${c.n}, show what the coach said` : extra ? `Round ${c.n}, show Further explain` : `Round ${c.n}, show the highlight`);
    head.append(more);
    row.classList.add('fold');
    head.addEventListener('click', (e) => {
      const t = e && e.target;
      if (t && t.closest && t.closest('.log-eye')) return;
      if (row.classList.contains('open')) foldRow(row, false);
      else openRow(row);
    });
    row.append(body);
    return row;
  }
  if (eye) head.append(eye);
  const facts = factsOf(c, 'div');
  if (facts) row.append(facts);
  row.append(...parts);
  return row;
}

/** A folded round opened, or folded again; a row that does not fold is left as it is. */
function foldRow(row, open) {
  if (!row || !row.classList.contains('fold')) return;
  const body = row.querySelector('.v-round-body');
  const more = row.querySelector('.v-fold');
  row.classList.toggle('open', open);
  const n = Number(String(row.id).replace('round-', ''));
  if (open) opened.rounds.add(n); else opened.rounds.delete(n);
  if (body) body.hidden = !open;
  if (more) more.setAttribute('aria-expanded', open ? 'true' : 'false');
}
const openRow = (row) => foldRow(row, true);

/*
 * THE ROUND'S FACTS AS TAGS (8.7): served() maps each fact roundFacts wrote
 * to a kind and a tone (valorant-review.js factTags), and each is drawn as a
 * chip, an icon by its kind and the fact's own words. The icon is a lookup
 * and decides nothing; a kind it does not know has none. A round served
 * before there were tags is its facts in one line, as it was.
 */
const TAG_ICON = {
  death: 'M6 6l12 12M18 6L6 18',
  firstdeath: 'M6 6l12 12M18 6L6 18M4 3v4',
  kill: 'M12 3v5M12 16v5M3 12h5M16 12h5',
  firstkill: 'M12 3v5M12 16v5M3 12h5M16 12h5M12 11.5v1',
  traded: 'M4 9h13l-3-3M20 15H7l3 3',
  untraded: 'M4 12h16M12 4v4',
  tradedmate: 'M4 9h13l-3-3M20 15H7l3 3',
  odds: 'M5 18V10M10 18V6M15 18v-5M20 18v-9',
  ult: 'M12 3l2.6 5.6L20 9.5l-4 4 1 6-5-2.8-5 2.8 1-6-4-4 5.4-.9z',
  clutch: 'M12 3l7 3v6c0 4-3 7-7 9-4-2-7-5-7-9V6z',
  plant: 'M12 4v16M7 9l5-5 5 5',
  survived: 'M5 12.5l4.5 4.5L19 7.5',
  unwatched: 'M3 12s3.5-6 9-6 9 6 9 6-3.5 6-9 6-9-6-9-6zM4 4l16 16',
  // 8.8: the team's buy (a wallet), and a round Riot says was sat out (a clock).
  buy: 'M4 7h16v11H4zM4 7l3-3h10l3 3M15 12.5h2',
  afk: 'M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z',
};
const TAG_TONES = new Set(['good', 'bad', 'warn', 'even']);

function tagIcon(kind) {
  const d = TAG_ICON[kind];
  if (!d) return null;
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'v-tag-icon');
  const p = document.createElementNS(SVG_NS, 'path');
  p.setAttribute('d', d);
  p.setAttribute('fill', 'none');
  p.setAttribute('stroke', 'currentColor');
  p.setAttribute('stroke-width', '2');
  p.setAttribute('stroke-linecap', 'round');
  p.setAttribute('stroke-linejoin', 'round');
  svg.append(p);
  return svg;
}

/** The round's facts: its tags as chips, or its facts in one line; null with neither. */
function factsOf(c, tag) {
  if (Array.isArray(c.tags)) {
    const tags = c.tags.filter((t) => t && t.text);
    if (!tags.length) return null;
    const box = el(tag, 'v-facts v-tags');
    for (const t of tags) {
      const chip = el('span', `v-tag ${TAG_TONES.has(t.tone) ? t.tone : 'even'}`);
      chip.dataset.kind = String(t.kind || 'fact');
      const icon = tagIcon(t.kind);
      if (icon) chip.append(icon);
      chip.append(document.createTextNode(t.text));
      box.append(chip);
    }
    return box;
  }
  const facts = (Array.isArray(c.facts) ? c.facts : []).join('  ·  ');
  return facts ? el(tag, 'v-facts', facts) : null;
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

/** A round with a why and no look: the why, and the killer card under it when Riot's record has one. */
function whyWithKiller(c, why) {
  const line = whyLine(why);
  const killer = killerCardEl(c.killerCard);
  if (!killer) return line;
  const box = el('div', 'v-why-block');
  box.append(line, killer);
  return box;
}

/*
 * THE KILLER CARD (8.7): the game's death recap again, under the coach's
 * words. valorant-review.js killerCard wrote every string from Riot's record
 * (the killer's agent, the gun, the damage it dealt the player, head, body
 * and legs) and named each icon under assets/, bundled, so nothing loads off
 * the network. Set by textContent; an icon that does not load is taken away
 * and its words stay. A round with no card (no Riot record, a screen only
 * review, a death not to an enemy) draws nothing.
 */
const ASSETS = '../../../assets/';
function iconImg(path, cls, name) {
  if (typeof path !== 'string' || !/^valorant\/((agents|weapons)\/[A-Za-z0-9]+|abilities\/[A-Za-z0-9]+-[A-Za-z0-9]+)\.png$/.test(path)) return null;
  const img = document.createElement('img');
  img.className = cls;
  img.src = ASSETS + path;
  img.alt = name || '';
  if (name) img.title = name;
  img.loading = 'lazy';
  img.addEventListener('error', () => img.remove());
  return img;
}
function killerCardEl(k) {
  if (!k || typeof k !== 'object' || !k.agent) return null;
  const card = el('div', 'v-killer');
  card.setAttribute('role', 'group');
  card.setAttribute('aria-label', `${k.label || 'Killed by'} ${k.agent}${k.weapon ? `, ${k.weapon}` : ''}`);
  const face = iconImg(k.agentIcon, 'v-killer-face');
  if (face) card.append(face);
  const who = el('div', 'v-killer-who');
  who.append(el('span', 'v-killer-label', k.label || 'Killed by'), el('span', 'v-killer-agent', k.agent));
  if (k.weapon) {
    const gun = el('span', 'v-killer-gun');
    // The gun's kill feed icon, or the ability's (kit-icons.js), named by main.
    const icon = iconImg(k.weaponIcon, k.weaponKind === 'ability' ? 'v-killer-gun-icon ability' : 'v-killer-gun-icon', k.weapon);
    if (icon) gun.append(icon);
    gun.append(el('span', null, k.weapon));
    who.append(gun);
  }
  card.append(who);
  if (k.damage) {
    const dmg = el('div', 'v-killer-dmg');
    dmg.append(el('span', 'v-killer-dmg-n', k.damage), el('span', 'v-killer-dmg-label', k.damageLabel || 'damage to you'));
    if (Array.isArray(k.hits) && k.hits.length) {
      const hits = el('div', 'v-killer-hits');
      for (const h of k.hits) {
        if (!h || !h.label) continue;
        const cell = el('span', 'v-killer-hit');
        cell.append(el('span', 'v-killer-hit-n', String(h.value)), el('span', 'v-killer-hit-label', h.label));
        hits.append(cell);
      }
      dmg.append(hits);
    }
    card.append(dmg);
  }
  return card;
}

/**
 * The coach's look at one death. The label is the part that gets counted
 * across rounds and matches, so it is a chip, marked as the coach's look; the
 * sentences after it are its read of a picture.
 */
const CAUSE_TITLE = {
  'dry-peek': 'Dry peek', 'isolated': 'Caught alone', 'repeek': 'Repeek', 'crossfire': 'Crossfire',
  'rotating': 'Caught rotating', 'overextend': 'Overextended', 'exposed': 'Exposed on the spike',
  'no-escape': 'Risky spot, no escape', 'lost-duel': 'Lost the duel', 'unclear': 'Frame unclear',
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
 *
 * UNDER ITS CLIP A STILL IS A PLACE IN IT (8.4.4): a click on one moves the
 * clip to that still's own frame and pauses it there, the clip at the width a
 * zoomed frame takes, so the click is the zoom with the frames either side of
 * it a step away. A still the clip cannot show (its place in the clip not
 * known, or outside it) zooms as before, as every frame does with no clip.
 */
function shotStrip(shots, player, screen) {
  const strip = el('div', 'v-shots');
  strip.style.setProperty('--n', String(player ? Math.max(4, shots.length) : Math.min(3, shots.length)));
  shots.forEach((s, k) => {
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
    if (player && player.canShow(s.at)) {
      const go = el('button', 'v-shot-go');
      go.type = 'button';
      go.setAttribute('aria-label', `Show the clip at ${img.alt === 'At the death' ? 'the death' : img.alt.charAt(0).toLowerCase() + img.alt.slice(1)}`);
      go.title = 'Show this moment in the clip';
      go.append(img);
      go.addEventListener('click', () => player.showStill(s.at, k));
      fig.append(go, el('figcaption', null, label));
    } else {
      img.addEventListener('click', () => zoomShot(strip, fig));
      fig.append(img, el('figcaption', null, label));
    }
    strip.append(fig);
  });
  return strip;
}

/** The still the clip now shows, marked in its strip; none once the clip moves on. */
function markShown(strip, i) {
  strip.querySelectorAll('.v-shot').forEach((fig, k) => {
    const on = i === k;
    fig.classList.toggle('shown', on);
    const go = fig.querySelector('.v-shot-go');
    if (!go) return;
    if (on) go.setAttribute('aria-current', 'true');
    else go.removeAttribute('aria-current');
  });
}

/**
 * A death the coach looked at, inside its round: what there is to watch on
 * one side (the clip from the recording, the frames under it) and what the
 * coach made of it on the other. A review checked against Riot's record and
 * one Riot's record never reached are painted alike, and the second says its
 * timing is the coach's own read.
 */
/*
 * A DEATH AS A CHAIN OF MISTAKES (Nov 2026, valorant-review.js withView from
 * death-chain.js): the first mistake, what made it worse, and what came
 * before it in the match, one plain line each, every word computed from
 * Riot's record and the look's label. Set by textContent. Null with none.
 */
const capital = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
function chainEl(ch) {
  if (!ch || typeof ch !== 'object') return null;
  const box = el('div', 'v-why-block v-chain');
  const line = (label, text) => {
    const p = el('p', 'v-why-line');
    p.append(el('span', 'gv-fix-label', label), el('span', 'v-why', text));
    box.append(p);
  };
  const item = (w) => (w && w.title ? `${w.title}${w.short ? ` (${w.short})` : ''}` : null);
  if (ch.first && item(ch.first)) line('The first mistake', `${item(ch.first)}.`);
  else if (ch.fair) line('The fight', "A fair duel, by the coach's look.");
  const worse = (Array.isArray(ch.worse) ? ch.worse : []).map(item).filter(Boolean);
  if (worse.length) line(ch.first ? 'What made it worse' : 'What made it cost more', `${worse.join(', and ')}.`);
  const earlier = (Array.isArray(ch.earlier) ? ch.earlier : []).filter((t) => typeof t === 'string' && t);
  if (earlier.length) line('Earlier in the match', `${capital(earlier.join(', '))}.`);
  return box.children.length ? box : null;
}

function look(c, frames, why, chain) {
  const f = c.forensics;
  const box = el('div', 'v-moment');
  box.id = `moment-${c.n}`;
  const shots = shotsOf(f, frames);
  const media = el('div', 'v-media');
  let strip = null;
  let player = null;
  if (f.clipUrl) {
    box.classList.add('has-clip');
    // Its player (8.4.4): the death and the stills marked on its timeline
    // where the card says the death falls in the clip (clipDeath), stepped by
    // the clip's own frames (clipFrames, main's reading of them).
    player = window.ClipPlayer.create({
      url: f.clipUrl, poster: posterOf(shots), label: `The clip of round ${c.n}`,
      frames: f.clipFrames, death: f.clipDeath, screen: f.source === 'screen', stills: shots.map((s) => s.at),
      onStill: (i) => { if (strip) markShown(strip, i); },
    });
    media.append(player.el);
  }
  const gone = !f.clipUrl && f.clipGone ? el('p', 'v-clip-gone', clipGoneText(f.clipGone, 'The frames and facts stay.')) : null;
  // Where a cleared clip was, above the frames that stay, or with the words
  // when no frame stayed either.
  if (gone && shots.length) media.append(gone);
  // NO STRIP UNDER A CLIP (8.7, the player's ask): the row of stills ("3 s
  // before" to "Just after") only took room, since the clip plays every one
  // of them and its timeline still marks each still's place. The stills stay
  // in the review (the look's evidence, the clip's poster, the marks), and a
  // moment with no clip still shows them: then they are all it has.
  if (shots.length && !player) {
    strip = shotStrip(shots, null, f.source === 'screen');
    media.append(strip);
  }
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
  if (chain) advice.append(chain);
  if (why) advice.append(whyLine(why, said));
  if (gone && !shots.length) advice.append(gone);
  const killer = killerCardEl(c.killerCard);
  if (killer) advice.append(killer);
  if (media.children.length) box.append(media);
  else box.classList.add('no-media');
  box.append(advice);
  return box;
}

/*
 * THE CLIP OF A MOMENT (8.3): the seconds around the death, from the match's
 * own recording, played from occlara-clip:// (main serves it by range,
 * clip-scheme.js). Muted, inline and looping, the frame the coach looked at
 * as its picture until it plays, and since 8.4.4 a player of its own under
 * it (clip-player.js): played and paused, back to the start, a second and a
 * frame either way, the timeline as seconds from the death with the death and
 * the stills marked, and the speed. Out of view, or with the page hidden, it
 * pauses, so a review of six never decodes a clip nobody is watching. The
 * frames stay under it: they are what the coach looked at, a click on one
 * moves the clip there, and they are what the moment shows once its clip is
 * gone. No caption: the clip sits in its own death's row, and saying what it
 * is under it was a line on every death saying what the row already said.
 */
const CLIP_GONE = {
  space: 'Its clip was cleared to keep your clips under the space set in Settings.',
  cleared: 'Its clip was cleared in Settings.',
};
/** Why a moment's clip is gone, and what it still has: its frames and facts, or its facts. */
const clipGoneText = (why, stays) => `${CLIP_GONE[why] || CLIP_GONE.cleared} ${stays}`;
const SVG_NS = 'http://www.w3.org/2000/svg';

/** Every clip in `host` stopped and let go, so a repaint leaves no decoder running behind it. */
const releaseClips = (host) => window.ClipPlayer.release(host);

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
  // A folded round opens first, so the jump lands on what it was for and the
  // scroll is to the row's whole height.
  openRow(card);
  settleRow(card);
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
 * OPENED AT ONE ROUND (8.7): a Moments row opens its review at the round it
 * names, which main hands over as `jumpTo` on the review for a few seconds,
 * stamped `jumpAt` (index.js setReviewJump). Jumped once per open, keyed on
 * the review, the round and the stamp: the page can be painted twice for one
 * open (the push, then its own ask as it loads), which jumps once, while the
 * same review opened at the same round again from Moments, a new stamp, jumps
 * again. And only once it is on screen, so the scroll is seen.
 */
let jumped = null;
function jumpIfAsked(r) {
  const n = r && Number.isInteger(r.jumpTo) && r.jumpTo > 0 ? r.jumpTo : null;
  if (!n || !r.id) return;
  const key = `${r.id}:${n}:${Number.isFinite(r.jumpAt) ? r.jumpAt : 0}`;
  if (jumped === key) return;
  jumped = key;
  const go = () => { if (current && current.id === r.id) goRound(n); };
  if (typeof window.occlaraOnShown === 'function') window.occlaraOnShown(go); else go();
}

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
 * the first screen and the repeated mistakes come straight after. League
 * keeps them together under its scores.
 *
 * A REVIEW GRADED FROM RIOT'S RECORD ALONE HAS NO LISTS. Riot records what
 * happened and never why, so main hands it facts in their place, whenever it
 * was saved (present() in src/main/index.js), and GradeView draws them as one
 * neutral list, "What Riot's record shows", with no fix on any of them.
 *
 * @param at.grade  what the grade goes after
 * @param at.lists  what the lists go after, when not straight after the grade
 */
function paintCommon(r, at, verdict) {
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
  // Under a Verdict the grade is compact: the Verdict says the letter and the
  // number, so the card keeps the categories and their evidence (8.7).
  // A Valorant review's header says the letter and the number, or that there
  // is none (8.7, notGraded), so its card is always the categories alone.
  if (r.grade) {
    const card = window.GradeView.gradeCard(r.grade, { compact: !!verdict || r.kind === 'valorant', reveal: true,
      onAddRiot: () => window.occlara.openSettings() });
    gHost.append(card);
    // The one action is only worth drawing without a Riot ID: with one, the
    // record is what is missing and Settings has nothing to add.
    const btn = card.querySelector('.gv-empty .btn');
    if (btn && typeof window.occlara.getConfig === 'function') {
      Promise.resolve(window.occlara.getConfig()).then((c) => { if (c && String(c.riotId || '').includes('#')) btn.remove(); }).catch(() => {});
    }
  }
  if (r.insights) {
    iHost.append(window.GradeView.insightLists(r.insights, {
      hero: true,
      onRound: r.kind === 'valorant' ? goRound : false,
      saidInRound: r.kind === 'valorant' ? saidInRound(r) : null,
      empty: r.kind === 'valorant' && !r.verified
        ? 'Most of what this section counts comes from Riot\'s record of the match. It fills in once the match links.'
        : undefined,
    }));
    paintTarget(r, iHost);
  }
}

/*
 * THE TARGET UNDER THE TOP MISTAKE'S FIX (Nov 2026, insights.js targetLine):
 * this match's count and the count at which the card goes away, computed in
 * code when the review was built, one small line under the hero card's fix.
 * A review saved before has none and shows none. The page is sealed mid match.
 */
function paintTarget(r, host) {
  const top = r.kind === 'valorant' && r.insights && Array.isArray(r.insights.mistakes) ? r.insights.mistakes[0] : null;
  const card = host.querySelector('.gv-hero');
  if (!top || !card || typeof top.target !== 'string' || !top.target) return;
  const line = el('p', 'v-target', top.target);
  const fix = card.querySelector('.gv-action');
  if (fix) fix.after(line); else card.append(line);
}

/** Show every block, so no League review inherits the hidden flags of the one before it. */
function resetSections() {
  for (const id of ['r-moments-wrap', 'r-skills-wrap', 'r-next-wrap', 'r-deaths-wrap', 'r-death-wrap', 'r-obj-wrap']) {
    const n = $(id);
    if (n) n.hidden = false;
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

/*
 * A REVIEW STILL BEING BUILT IS A LOADING SCREEN (8.4.1). The page used to
 * paint the screen's review at the match's end and repaint it as each half
 * landed: Riot's scoreboard, Riot's rounds with the summary marked as being
 * rewritten, the coach's look at the deaths, the summary again. Now a review
 * that arrives with its work (index.js present(), shared/review-work.js) shows
 * the steps it is on, the one under way with the time since the match ended,
 * and is painted whole once main says the work is done (PUSH_REVIEW_WORK with
 * none), from the version the page holds by then. Main says so at six minutes
 * if Riot's record is not in, and the review then carries its note that the
 * scoreboard fills in once the match is published. Nothing is a loading
 * screen once it has been painted whole, nor a review saved before.
 */
const BUILD_STEPS = {
  saved: { label: 'Match saved', note: 'Kept in Matches' },
  riot: { label: "Waiting for Riot's record", note: 'Riot publishes a match 1 to 4 minutes after it ends' },
  deaths: { label: 'Checking your deaths against it' },
  look: { label: "The coach's look at your deaths" },
  writing: { label: 'Writing your review' },
};
const BUILD_TEXT = {
  riot: { title: 'Checking your match',
    sub: "Your review opens here once Riot's record is laid over what the coach read and the coach has looked at your deaths." },
  screen: { title: 'Writing your review', sub: 'Your review opens here once it is whole, usually in a minute or two.' },
};
const STEP_SAID = { done: 'Done', now: 'Under way', next: 'Next' };
let buildTick = null;

/** 0:42, 3:05: minutes and seconds. */
function clockOf(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** A done step's mark, on the 24 unit grid the app's icons use. */
function doneMark() {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS(SVG_NS, 'path');
  p.setAttribute('d', 'M5 12.5l4.5 4.5L19 7.5');
  p.setAttribute('fill', 'none');
  p.setAttribute('stroke', 'currentColor');
  p.setAttribute('stroke-width', '2.4');
  p.setAttribute('stroke-linecap', 'round');
  p.setAttribute('stroke-linejoin', 'round');
  svg.append(p);
  return svg;
}

/** The loading screen for `work`, or none: the review painted, or nothing to paint. */
function paintBuilding(work) {
  const host = $('building');
  clearInterval(buildTick);
  buildTick = null;
  if (!work) { host.hidden = true; return; }
  // Nothing of the review shows behind it, nor the clips of the one before.
  releaseClips($('v-rounds'));
  releaseClips($('r-deaths'));
  for (const id of ['empty', 'review', 'vreview', 'common']) $(id).hidden = true;
  const text = BUILD_TEXT[work.path] || BUILD_TEXT.riot;
  $('b-title').textContent = text.title;
  $('b-sub').textContent = text.sub;
  const steps = Array.isArray(work.steps) && work.steps.length ? work.steps : ['saved'];
  const at = steps.indexOf(work.step);
  const list = $('b-steps');
  list.replaceChildren();
  steps.forEach((key, i) => {
    const s = BUILD_STEPS[key] || { label: key };
    const state = at < 0 ? (i === 0 ? 'done' : 'next') : i < at ? 'done' : i === at ? 'now' : 'next';
    const li = el('li', `b-step ${state}`);
    li.dataset.step = key;
    if (state === 'now') li.setAttribute('aria-current', 'step');
    const mark = el('span', 'b-state');
    mark.setAttribute('aria-hidden', 'true');
    if (state === 'done') mark.append(doneMark());
    const body = el('span', 'b-text');
    body.append(el('span', 'sr-only', `${STEP_SAID[state]}: `), el('b', null, s.label));
    if (s.note && (state === 'now' || key === 'saved')) body.append(el('small', null, s.note));
    li.append(mark, body);
    if (state === 'now') {
      const time = el('span', 'b-time');
      time.setAttribute('aria-hidden', 'true');
      li.append(time);
    }
    list.append(li);
  });
  const now = BUILD_STEPS[work.step];
  const said = now ? now.label : '';
  if ($('b-now').textContent !== said) $('b-now').textContent = said;
  host.hidden = false;
  tickIn(list, (current && current.id) || '');
  const tick = () => tickBuilding(work);
  tick();
  buildTick = setInterval(tick, 1000);
}

/** The second's hand: the time since the match ended, and how long the page waits for Riot's record. */
function tickBuilding(work) {
  const now = Date.now();
  const time = $('b-steps').querySelector('.b-time');
  if (time && Number.isFinite(work.endedAt)) time.textContent = clockOf(now - work.endedAt);
  const foot = $('b-foot');
  if (work.path === 'riot' && work.step === 'riot' && Number.isFinite(work.until)) {
    foot.textContent = work.until > now
      ? `If Riot's record is not out within ${clockOf(work.until - now)}, the review opens with what the screen read, and fills in when the record comes.`
      : 'Opening with what the screen read.';
  } else {
    foot.textContent = work.path === 'riot' && work.step !== 'riot' ? "Riot's record is in." : '';
  }
  foot.hidden = !foot.textContent;
}

/*
 * MOTION ON THE PAGE (8.9.2, shared/motion.js and motion.css, review.css).
 * Each piece plays once and only on screen (Motion.whenShown, embed.js
 * occlaraOnShown), so nothing moves on a sealed page or one nobody sees, and
 * under reduced motion none of it is put on at all: the page is painted as it
 * ends. No figure is worked out here and no animation event is read: a
 * class goes on, and a timer takes it off.
 *
 *   tickIn      the loading screen's steps rise one after another the first
 *               time it shows for a review, each done step's check drawn as
 *               its row arrives; after that only a step that has just become
 *               done draws its check. A repaint never rises again.
 *   scrollIn    a round, a League death or a mistake below the fold rises in
 *               once as it is scrolled to, --stagger apart for the ones that
 *               arrive together. Keyed by review and row for the visit, so a
 *               repaint of the same review (the screen look landing) leaves a
 *               row already seen alone. A row in view when painted is never
 *               held back, and with no IntersectionObserver nothing is.
 *   fadeThumbs  a still and a clip's picture fade in as they load, where they
 *               would have gone from a black box to a frame at once.
 */
const Mo = () => window.Motion || null;
const still = () => { const m = Mo(); return !m || m.reduced(); };
// The longest an arrival here takes: --dur-slow, five staggers, a margin.
const ARRIVE_MS = 380 + 5 * 40 + 120;

const built = { id: null, done: new Set() };
/** The loading screen's steps, as painted for review `id`. */
function tickIn(list, id) {
  try { tickNow(list, id); } catch (e) { /* motion never costs a paint */ }
}
function tickNow(list, id) {
  const done = new Set([...list.children].filter((li) => li.classList.contains('done')).map((li) => li.dataset.step));
  const before = built.id === id ? built.done : null;
  built.id = id;
  built.done = done;
  const m = Mo();
  if (still()) return;
  const first = m.stagger(list, `build:${id}`);
  for (const li of [...list.children]) {
    if (!li.classList.contains('done') || (!first && before && before.has(li.dataset.step))) continue;
    const path = li.querySelector('.b-state path');
    if (!path) continue;
    path.setAttribute('pathLength', '1');
    m.whenShown(() => { if (!still()) path.classList.add('m-draw'); });
  }
}

const scrolled = new Set();
const rowKey = new WeakMap();
const watched = new Set();
let rowWatch = null;
// A new visit of the page sees its rows arrive again; a repaint does not.
window.addEventListener('occlara-page-enter', (e) => { if (!(e && e.detail && e.detail.first)) scrolled.clear(); });

function watcher() {
  if (rowWatch) return rowWatch;
  rowWatch = new IntersectionObserver((entries) => {
    const come = entries.filter((e) => e.isIntersecting).map((e) => e.target);
    come.forEach((n, i) => {
      rowWatch.unobserve(n);
      watched.delete(n);
      const k = rowKey.get(n);
      if (k) scrolled.add(k);
      if (!n.classList.contains('in-wait')) return;
      n.style.setProperty('--i', String(Math.min(i, 5)));
      n.classList.remove('in-wait');
      n.classList.add('in-play');
      setTimeout(() => { n.classList.remove('in-play'); n.style.removeProperty('--i'); }, ARRIVE_MS);
    });
  });
  return rowWatch;
}

/** A row there now, at once: one jumped to (flashTo) is not left to arrive. */
function settleRow(n) {
  if (!n || !n.classList) return;
  const k = rowKey.get(n);
  if (k) scrolled.add(k);
  n.classList.remove('in-wait');
  if (rowWatch && watched.has(n)) { rowWatch.unobserve(n); watched.delete(n); }
}

/** `nodes` rise in as they are scrolled to, once each, keyed in `scope`. */
function scrollIn(nodes, scope) {
  if (still() || typeof IntersectionObserver !== 'function') return;
  const m = Mo();
  const id = (current && current.id) || '';
  const rows = [...nodes].map((n, i) => [n, `${id}|${scope}|${n.id || i}`]).filter(([, k]) => !scrolled.has(k));
  for (const n of [...watched]) if (!n.isConnected) { watcher().unobserve(n); watched.delete(n); }
  if (!rows.length) return;
  m.whenShown(() => {
    if (still()) return;
    const fold = window.innerHeight || document.documentElement.clientHeight || 0;
    for (const [n, k] of rows) {
      if (!n.isConnected || scrolled.has(k)) continue;
      const box = n.getBoundingClientRect();
      // In view, or nothing to measure (hidden): there, not arriving.
      if (!box.height || box.top < fold) { scrolled.add(k); continue; }
      rowKey.set(n, k);
      n.classList.add('in-wait');
      watched.add(n);
      watcher().observe(n);
    }
  });
}

/** A still or a clip's picture fades in once it has loaded. */
function fadeThumbs(host) {
  if (!host || still() || typeof Image !== 'function') return;
  const wait = (node, src) => {
    let shown = false;
    const show = () => {
      if (shown) return;
      shown = true;
      node.classList.remove('th-wait');
      node.classList.add('th-in');
      setTimeout(() => node.classList.remove('th-in'), ARRIVE_MS);
    };
    node.classList.add('th-wait');
    src.addEventListener('load', show, { once: true });
    src.addEventListener('error', show, { once: true });
    // Never left unseen: a picture that says nothing is shown anyway.
    setTimeout(show, 4000);
  };
  for (const img of host.querySelectorAll('.v-shot img')) {
    if (!('complete' in img) || (img.complete && img.naturalWidth) || typeof img.addEventListener !== 'function') continue;
    wait(img, img);
  }
  for (const v of host.querySelectorAll('video.v-clip-video')) {
    const poster = v.getAttribute('poster');
    if (!poster) continue;
    const probe = new Image();
    probe.src = poster;
    if ((probe.complete && probe.naturalWidth) || typeof probe.addEventListener !== 'function') continue;
    wait(v, probe);
  }
}

/** The page's rows and pictures, as a review is painted whole. */
function arriveRows() {
  try { arriveNow(); } catch (e) { /* motion never costs a paint */ }
}
function arriveNow() {
  if (still()) return;
  for (const id of ['v-rounds', 'r-deaths']) {
    const host = $(id);
    if (!host || (host.closest && host.closest('[hidden]'))) continue;
    fadeThumbs(host);
    scrollIn(host.children, id);
  }
  const ins = $('insights-host');
  if (ins && !ins.hidden) scrollIn(ins.querySelectorAll('.gv-item'), 'insights');
}

/*
 * THE REVEAL (8.7, docs/claude/ui.md "The reveal"): the review the loading
 * screen gives way to arrives in order, once per review in this page's
 * memory. The number counts up, the letter stamps in, the bars fill one after
 * another, the progress chips rise in, and the letter landing is heard
 * (shared/sfx.js 'reveal', or 'best' with a best in the progress). A review
 * opened later, from the library or Home, is painted as it ends.
 *
 * The motion is all CSS (review.css, grade-view.css): the page sets the
 * classes and the number to count to, and the count is @property --n through
 * counter(), so no figure is worked out here and the real number stays the
 * text. Nothing reads an animation event (theme.css): the sound is a timer
 * matched to the stamp's delay, and the end is a timer too.
 *
 * NOTHING MID MATCH. It runs inside occlaraOnShown (embed.js): a sealed page
 * is never on screen, so a review made whole during the next match waits,
 * its reveal and its sound with it. And main is asked as the letter lands:
 * the sound plays only with sounds on and coaching off
 * (docs/claude/screen-silence.md). A click or a key ends it at once
 * (.reveal-done).
 */
const revealed = new Set();
// --t-slow (theme.css): the letter's stamp waits this long, its sound with it.
const STAMP_MS = 420;
// Past the chips' rise (review.css, grade-view.css): over, whatever is left.
const REVEAL_MS = 2000;
let reveal = null;

const lessMotion = () => typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Once per review, from the branch where its loading screen gave way. With
 * `ready` (Orbit, not under less motion) the review is said ready first and
 * opens out of that card (readyFirst); without, it arrives as it always did.
 */
function startReveal(r, verdict, ready) {
  if (!r.id || revealed.has(r.id)) return;
  revealed.add(r.id);
  const mine = { id: r.id, verdict, ready: !!ready, wholeAt: Date.now(), opened: false, started: false, cued: false, stamp: null, done: null, skip: null, t: [] };
  reveal = mine;
  const shown = typeof window.occlaraOnShown === 'function' ? window.occlaraOnShown : (fn) => fn();
  shown(() => runReveal(mine));
}

function runReveal(mine) {
  if (reveal !== mine || !current || current.id !== mine.id || current.work) return;
  if (!mine.skip) {
    mine.skip = () => endReveal(mine);
    document.addEventListener('pointerdown', mine.skip, true);
    document.addEventListener('keydown', mine.skip, true);
  }
  mine.started = true;
  if (mine.ready && !mine.opened && !lessMotion()) {
    // Motion never costs the reveal: a card that cannot be laid out plays it plain.
    try { readyFirst(mine); return; } catch (e) { clearReady(); }
  }
  playReveal(mine);
}

/** The count, the stamp, the bars and the chips (8.7), and the letter heard as it lands. */
function playReveal(mine) {
  const root = $('vreview');
  root.classList.remove('reveal-done');
  const still = lessMotion();
  // Counted up only to a whole number, and not when asked for less motion.
  const score = root.querySelector('.vd-score');
  if (score && !still && mine.verdict && Number.isInteger(mine.verdict.score)) {
    score.style.setProperty('--to', String(mine.verdict.score));
    score.classList.add('counting');
  }
  root.classList.add('revealing');
  mine.stamp = setTimeout(() => cueReveal(mine), still ? 0 : STAMP_MS);
  mine.done = setTimeout(() => endReveal(mine), still ? 0 : REVEAL_MS);
}

/*
 * REVIEW READY (Orbit's signature, Nov 2026, docs/claude/ui.md "Review
 * ready"). As the loading screen gives way to the whole review, the loading
 * screen falls away (ghostBuilding, from the paint), a notification drops in
 * on the gentle spring, "Review ready" with the grade and how it moved on the
 * last match, holds a beat, and opens into the review: the review grows out
 * of the card's corners (a clip-path on #vreview over a ground that fades),
 * and the count, the stamp, the bars and the medals play as before.
 *
 * HONEST. It is said only from the branch where the loading screen gave way,
 * so only once the review is whole (work null: Riot's record laid over and the
 * read rewritten, the link given up, or the screen's own review done), never
 * for a review opened later from the library or Home.
 *
 * NOTHING MID MATCH. It runs inside occlaraOnShown like the reveal it leads,
 * so a review made whole while the next match records waits for the seal to
 * lift and a page to be shown. Under less motion there is no card: the review
 * is painted as it ends. A click or a key ends it all at once (endReveal).
 */
const READY_IN = 240;    // the card drops in as the loading screen falls away
const READY_OPEN = 1280; // the beat it holds, then it opens
const READY_MORPH = 520; // the clip on the drawer curve
const READY_PLAY = 90;   // the count starts as the window is still opening

function readyFirst(mine) {
  const root = $('vreview');
  const card = $('v-ready');
  if (!card) { playReveal(mine); return; }
  root.classList.add('ready-pre');
  $('v-ready-line').replaceChildren(...readyLine(mine.verdict, null));
  const asked = progressAsked && progressAsked.id === mine.id ? progressAsked.asked : null;
  if (asked) asked.then((p) => { if (reveal === mine && !mine.opened) $('v-ready-line').replaceChildren(...readyLine(mine.verdict, p)); }).catch(() => {});
  // Inside the review's own box, so the window it opens into starts at the card.
  const sheet = root.closest('.sheet') || document.body;
  const top = root.getBoundingClientRect().top - sheet.getBoundingClientRect().top;
  card.style.top = `${Math.max(16, Math.round(top + 16))}px`;
  // When it was made whole, said truly: a review that waited for the seal to
  // lift or for its page to be opened says how long ago, never "now".
  const ago = Math.floor((Date.now() - mine.wholeAt) / 60000);
  $('v-ready-time').textContent = ago < 1 ? 'now' : ago < 60 ? `${ago} min ago` : 'earlier';
  card.classList.remove('in', 'morphing');
  card.hidden = false;
  mine.t.push(setTimeout(() => { if (reveal === mine) card.classList.add('in'); }, READY_IN));
  mine.t.push(setTimeout(() => openReady(mine), READY_OPEN));
}

/** The card's line: "Grade 71, up 7 on your last match", or the result and score where nothing is counted. */
function readyLine(v, p) {
  const out = [];
  const vs = p && p.vsLast && typeof p.vsLast.delta === 'number' ? p.vsLast.delta : null;
  const g = (current && current.game) || {};
  const result = [g.result, String(g.score || '').split('-').join(' : ')].filter(Boolean).join(' ');
  const graded = v && Number.isInteger(v.score) ? `Grade ${v.score}` : '';
  if (vs !== null && vs > 0) out.push(el('i', 'v-ready-up'));
  const moved = vs === null ? '' : vs > 0 ? `up ${vs} on your last match` : vs < 0 ? `down ${-vs} on your last match` : 'level with your last match';
  out.push(document.createTextNode([graded, moved || (graded ? result : '')].filter(Boolean).join(', ') || result || 'Your match is graded'));
  return out;
}

function openReady(mine) {
  if (reveal !== mine) return;
  mine.opened = true;
  try {
    const root = $('vreview');
    const card = $('v-ready');
    const rr = root.getBoundingClientRect();
    const cr = card.getBoundingClientRect();
    root.classList.remove('ready-pre');
    root.classList.add('ready-open');
    root.style.transition = 'none';
    root.style.clipPath = `inset(${Math.max(0, cr.top - rr.top).toFixed(1)}px ${Math.max(0, rr.right - cr.right).toFixed(1)}px ${Math.max(0, rr.bottom - cr.bottom).toFixed(1)}px ${Math.max(0, cr.left - rr.left).toFixed(1)}px round 20px)`;
    void root.offsetWidth;
    card.classList.add('morphing');
    root.style.transition = `clip-path ${READY_MORPH}ms var(--ease-drawer)`;
    root.style.clipPath = 'inset(0px 0px 0px 0px round 0px)';
    root.classList.add('ready-opened');
  } catch (e) { clearReady(); }
  mine.t.push(setTimeout(() => { if (reveal === mine) playReveal(mine); }, READY_PLAY));
  mine.t.push(setTimeout(clearReady, READY_MORPH + 80));
}

/** The card and the window gone, the review as it is: safe at any point and more than once. */
function clearReady() {
  const root = $('vreview');
  root.classList.remove('ready-pre', 'ready-open', 'ready-opened');
  root.style.clipPath = '';
  root.style.transition = '';
  const card = $('v-ready');
  if (card) { card.classList.remove('in', 'morphing'); card.hidden = true; }
}

/*
 * The loading screen falling away as the review it waited for is whole: a
 * copy of it laid where it was, fading down and out while the page goes on.
 * Only on screen and with motion; it is gone in under half a second either way.
 */
function ghostBuilding() {
  try {
    const b = $('building');
    if (lessMotion() || document.visibilityState !== 'visible' || document.documentElement.classList.contains('page-armed')) return;
    const box = b.getBoundingClientRect();
    if (!box.height) return;
    const g = b.cloneNode(true);
    g.removeAttribute('id');
    g.querySelectorAll('[id]').forEach((n) => n.removeAttribute('id'));
    g.querySelectorAll('[aria-live]').forEach((n) => n.removeAttribute('aria-live'));
    g.setAttribute('aria-hidden', 'true');
    g.classList.add('b-ghost');
    Object.assign(g.style, { left: `${box.left}px`, top: `${box.top}px`, width: `${box.width}px`, height: `${box.height}px` });
    (b.closest('.sheet') || document.body).append(g);
    requestAnimationFrame(() => requestAnimationFrame(() => g.classList.add('b-out')));
    setTimeout(() => g.remove(), 480);
  } catch (e) { /* motion never costs a paint */ }
}

function unhookReveal(mine) {
  clearTimeout(mine.stamp);
  clearTimeout(mine.done);
  (mine.t || []).forEach(clearTimeout);
  mine.t = [];
  if (!mine.skip) return;
  document.removeEventListener('pointerdown', mine.skip, true);
  document.removeEventListener('keydown', mine.skip, true);
}

/** Its end state, now. Ended before the letter landed, it lands now, and is heard now. */
function endReveal(mine) {
  if (reveal !== mine) return;
  reveal = null;
  unhookReveal(mine);
  clearReady();
  const root = $('vreview');
  root.classList.add('reveal-done');
  const score = root.querySelector('.vd-score.counting');
  if (score) score.classList.remove('counting');
  cueReveal(mine);
}

/** The letter landing, heard: main asked now, and the progress asked with the paint. */
function cueReveal(mine) {
  if (mine.cued || !mine.started) return;
  mine.cued = true;
  clearTimeout(mine.stamp);
  const state = window.occlara.getState ? Promise.resolve(window.occlara.getState()).catch(() => null) : Promise.resolve(null);
  const asked = progressAsked && progressAsked.id === mine.id ? progressAsked.asked.catch(() => null) : null;
  Promise.all([state, asked]).then(([s, p]) => {
    if (!s || s.sounds === false || s.isCoaching !== false) return;
    // Not over the loading screen: the review went back to being built.
    if (!current || current.id !== mine.id || current.work) return;
    const sfx = window.occlaraSfx;
    if (!sfx || typeof sfx.play !== 'function') return;
    sfx.play(p && p.best && (p.best.grade || p.best.firstLetter) ? 'best' : 'reveal');
  }).catch(() => {});
}

/**
 * A paint over a reveal. The same review painted again ends its reveal where
 * it was going, or, still waiting to be on screen, leaves it waiting; any
 * other paint drops it, silent, and the page is painted as it ends.
 */
function settleReveal(r) {
  const mine = reveal;
  if (mine && r && !r.work && r.id === mine.id) {
    if (mine.started) endReveal(mine);
    return;
  }
  if (mine) { reveal = null; unhookReveal(mine); }
  clearReady();
  $('vreview').classList.remove('revealing', 'reveal-done');
}

/*
 * THE SKY (Orbit, shared/sky.js): the stars and the moon's lit limb behind a
 * Valorant review and its loading screen, the agent standing in front of it.
 * Put up only once the page is on screen (a sealed page never is, so the moon
 * is never drawn mid match; drawn once, it is kept for every page), drawn
 * again only when the window's size changes, and sliding up at SKY_DRIFT of
 * the page's scroll, so the hero leaves it behind. League keeps the plain
 * ground.
 */
const SKY_DRIFT = 0.6;
// The sky's drift at which it has faded out (9.1): past the moon's middle.
const SKY_FADE = 300;
let skyAt = '';
function paintSky(on, building) {
  const host = $('v-sky');
  if (!host) return;
  host.hidden = !on;
  if (!on) return;
  // 9.1: the moon stands clear of what the page shows, the loading screen's
  // centred column or the hero's text (review.css .v-moon).
  host.classList.toggle('building', !!building);
  const shown = typeof window.occlaraOnShown === 'function' ? window.occlaraOnShown : (fn) => fn();
  shown(() => {
    const sky = window.OcclaraSky;
    if (!sky || host.hidden) return;
    const key = `${window.innerWidth}x${window.innerHeight}`;
    if (skyAt !== key) { skyAt = key; sky.stars($('v-stars')); }
    sky.moon($('v-moon'));
  });
}
window.addEventListener('resize', () => { skyAt = ''; const host = $('v-sky'); if (host && !host.hidden) paintSky(true); });
(() => {
  const scroller = document.querySelector('main.body');
  if (!scroller) return;
  let frame = 0;
  scroller.addEventListener('scroll', () => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      const y = scroller.scrollTop * SKY_DRIFT;
      const host = $('v-sky');
      // 9.1: only the inner layer slides; the frame and its soft top edge
      // stay where they are, so what rises under the head fades through it.
      const layer = $('v-sky-in');
      if (layer) layer.style.transform = y ? `translate3d(0, ${(-y).toFixed(1)}px, 0)` : '';
      // And it fades as it goes, so the moon is all but gone before it
      // reaches the head.
      if (host) host.style.opacity = y ? String(Math.max(0, 1 - y / SKY_FADE).toFixed(3)) : '';
      // 9.1: once the page has moved, what scrolls under the head fades out
      // through a soft edge (review.css .body.scrolled), never a cut.
      scroller.classList.toggle('scrolled', scroller.scrollTop > 2);
    });
  }, { passive: true });
})();

function paint(r) {
  settleReveal(r);
  paintSky(!!r && (!!r.work || r.kind === 'valorant'), !!(r && r.work));
  paintEye(r);
  // The share sheet stays open over a new version of the review it was
  // opened on, drawn again; over any other, or none, it closes.
  const sameReview = !!(r && current && r.id && r.id === current.id);
  // The match's menu, with a saved review that is whole; the menu and the
  // confirm close over any other review, or none.
  $('more').hidden = !r || !r.id || !!r.work || typeof window.occlara.deleteMatch !== 'function';
  if (!sameReview || $('more').hidden) { closeMore(false); closeDelete(false); }
  $('share').hidden = true;
  if (!r || r.work) { closeShare(false); shareVerdict = null; }
  if (window.RatingView && (!r || r.work || r.kind !== 'valorant' || r.locked === true)) window.RatingView.paint(null);
  if (!r || r.work || r.kind !== 'valorant' || r.locked === true) paintHighlight(null);
  if (!r) {
    progressFor = null;
    paintBuilding(null);
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
  // Asked about half built, the coach would talk about a review about to change.
  $('ask').hidden = !r.id || !!r.work;
  if (r.work) { progressFor = null; paintBuilding(r.work); return; }
  const wasBuilding = !$('building').hidden;
  // Whole at last: the loading screen falls away where it stood (Orbit).
  if (wasBuilding) ghostBuilding();
  paintBuilding(null);
  // LOCKED (8.7): its numbers and the upgrade card, and nothing else: no
  // Verdict, no progress, no reveal and no sound (paintLocked).
  if (r.locked === true) { paintLocked(r); return; }
  $('locked').hidden = true;
  // The Verdict, built by the preload from the review as served, or null
  // with no grade to show (shared/verdict.js of()). Share image goes with it.
  const verdict = window.occlara.verdictOf ? window.occlara.verdictOf(r) : null;
  shareVerdict = verdict;
  $('share').hidden = !verdict || !window.VerdictCard;
  if (!verdict || !sameReview) closeShare(false);
  else if (shareOpen()) drawShare();
  // Valorant has its own container, so the League one is simply hidden
  // rather than having each of its sections turned off one by one.
  if (r.kind === 'valorant') {
    // The other container's clips stop with it, hidden or not.
    releaseClips($('r-deaths'));
    $('review').hidden = true;
    $('vreview').hidden = false;
    paintValorant(r, verdict);
    // The Verdict, the strip against the matches before it, then the grade.
    paintCommon(r, { grade: $('v-prog'), lists: $('v-summary-wrap') }, verdict);
    paintProgress(r);
    paintRiot(r);
    // Whole at last, it rises in where the loading screen was.
    // With motion it is said ready first and opens out of that card (Orbit,
    // readyFirst); without, it rises in as it always did.
    if (wasBuilding) {
      const ready = !lessMotion() && !!$('v-ready');
      $('vreview').classList.remove('v-arrive');
      if (!ready) { void $('vreview').offsetWidth; $('vreview').classList.add('v-arrive'); }
      startReveal(r, verdict, ready);
    }
    arriveRows();
    jumpIfAsked(r);
    return;
  }
  releaseClips($('v-rounds'));
  $('vreview').hidden = true;
  $('review').hidden = false;

  // EVERY SECTION BACK ON FIRST, so a League review never keeps the hidden
  // flags of the one painted before it, with nothing to indicate they were
  // suppressed rather than missing. The sections that are genuinely
  // conditional are hidden again by the painter below.
  resetSections();

  const g = r.game || {};
  $('r-champ').textContent = g.champion || 'Your game';
  // The middot the Valorant line carries, so the two agree.
  const bits = [g.role, g.mode, g.duration].filter(Boolean);
  $('r-meta').textContent = bits.join('  ·  ');

  paintLolVerdict(verdict);
  paintScores(r.scoreline || {});
  paintCommon(r, { grade: $('r-scores') }, verdict);
  paintProgress(r);
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
  arriveRows();
}

/*
 * A LOCKED REVIEW (8.7, docs/claude/ui.md). The account had no games left
 * when the match was played (the server's 402 on the read, the look or the
 * narrative, or a claim refused for a review from Riot's record or a League
 * game), so main saved it `locked: true` with Riot's record its only numbers.
 * The page shows the result and those numbers, then the upgrade card, and
 * nothing that grades or reads the match: no Verdict and no share image, no
 * progress strip, no grade or lists, no coach's read, no rounds and no Ask
 * about this match. It is painted as it is, never revealed, and so never
 * heard: startReveal is the only way to the reveal's sound.
 *
 * The card's lines are main's (usage.js capState, through the account's view
 * when this page's bridge carries it): "You have used your 4 free games" and
 * its way on. A page with no account to ask, or an account with games again
 * since, keeps the card's own plain lines, which count nothing.
 */
const LOCK_TITLE = 'This review is locked';
const LOCK_BODY = 'Upgrade for more games each month, or invite friends for free games.';
const UPGRADE_TO = { pro: 'Upgrade to Pro', max: 'Upgrade to Max' };
let lockAsk = 0;

function paintLockCard(view) {
  const cap = view && view.cap && typeof view.cap.title === 'string' ? view.cap : null;
  $('lk-title').textContent = cap ? cap.title : LOCK_TITLE;
  $('lk-body').textContent = cap && typeof cap.body === 'string' && cap.body ? cap.body : LOCK_BODY;
  const canUpgrade = typeof window.occlara.openUpgrade === 'function';
  // From Max there is no plan above: its card says to invite friends.
  const offer = cap ? cap.upgrade : 'any';
  $('lk-upgrade').hidden = !canUpgrade || offer === null;
  $('lk-upgrade').textContent = UPGRADE_TO[offer] || 'Upgrade';
  $('lk-invite').hidden = typeof window.occlara.openInvite !== 'function';
}

function paintLocked(r) {
  const valorant = r.kind === 'valorant';
  // Nothing that grades, compares or reads the match.
  shareVerdict = null;
  $('share').hidden = true;
  closeShare(false);
  progressFor = null;
  progressAsked = null;
  for (const id of ['v-prog', 'r-prog']) { $(id).replaceChildren(); $(id).hidden = true; }
  for (const id of ['common', 'grade-host', 'insights-host']) $(id).hidden = true;
  $('grade-host').replaceChildren();
  $('insights-host').replaceChildren();
  $('ask').hidden = true;
  const card = $('locked');
  if (valorant) {
    releaseClips($('r-deaths'));
    releaseClips($('v-rounds'));
    $('review').hidden = true;
    $('vreview').hidden = false;
    $('vreview').classList.remove('v-arrive', 'revealing', 'reveal-done');
    paintLockedValorant(r);
    $('v-verdict').after(card);
  } else {
    releaseClips($('v-rounds'));
    releaseClips($('r-deaths'));
    $('vreview').hidden = true;
    $('review').hidden = false;
    resetSections();
    const g = r.game || {};
    $('r-champ').textContent = g.champion || 'Your game';
    $('r-meta').textContent = [g.role, g.mode, g.duration].filter(Boolean).join('  ·  ');
    paintLolVerdict(null);
    paintScores(r.scoreline || {});
    for (const id of ['r-death-wrap', 'r-deaths-wrap', 'r-moments-wrap', 'r-obj-wrap', 'r-skills-wrap', 'r-next-wrap']) $(id).hidden = true;
    $('r-deaths').replaceChildren();
    $('r-scores').after(card);
  }
  paintLockCard(null);
  card.hidden = false;
  // The account's own lines, when this page can ask for them.
  const mine = ++lockAsk;
  if (typeof window.occlara.getAccount === 'function') {
    Promise.resolve(window.occlara.getAccount()).then((view) => {
      if (mine !== lockAsk || !current || current.id !== r.id || current.locked !== true) return;
      paintLockCard(view);
    }).catch(() => {});
  }
}

/** The result, where it came from, and Riot's scoreboard: what a locked review keeps. */
function paintLockedValorant(r) {
  const g = r.game || {};
  riotFor = null;
  clearRR();
  paintVerdictIcon($('v-icon'), null);
  $('v-grade').replaceChildren(notGraded('Not graded'));
  $('v-grade').hidden = false;
  $('v-focus-wrap').hidden = true;
  $('v-focus').textContent = '';
  paintVerdictStat($('v-stat'), null);
  // A locked review judges nothing: no agent floating, no medal.
  paintVerdictAgent($('v-agent'), null);
  paintMedals(null, null);
  $('v-verdict').classList.remove('graded');
  const resultEl = $('v-result');
  resultEl.textContent = g.result ? g.result : 'Match review';
  resultEl.className = 'v-result' + (g.result === 'Victory' ? ' win' : g.result === 'Defeat' ? ' loss' : '');
  const score = String(g.score || '').split('-');
  $('v-score').textContent = score.length === 2 ? `${score[0]} : ${score[1]}` : '';
  $('v-score').hidden = score.length !== 2;
  $('v-meta').textContent = [g.agent, g.map, g.mode, (r.scoreline || r.source === 'riot') ? "From Riot's record" : null,
    r.imported ? (r.matchId || r.verified ? 'Imported recording' : "Imported recording, not matched to Riot's record") : null].filter(Boolean).join('  ·  ');
  $('v-verified').hidden = true;
  $('v-verified').textContent = '';
  paintStats(r);
  // The comparison under each number is the player's own average, kept: it
  // is Riot's numbers against Riot's numbers, no grade in it.
  for (const id of ['v-summary-wrap', 'v-rounds-wrap', 'v-study-wrap', 'v-refused-wrap', 'v-rating-wrap']) $(id).hidden = true;
  $('v-rounds').replaceChildren();
  // With the rounds hidden, Every round has nowhere to go (9.1).
  $('v-every').hidden = true;
}

$('lk-upgrade').addEventListener('click', () => { if (typeof window.occlara.openUpgrade === 'function') window.occlara.openUpgrade(); });
$('lk-invite').addEventListener('click', () => { if (typeof window.occlara.openInvite === 'function') window.occlara.openInvite(); });

/*
 * SHARE IMAGE (8.7, docs/claude/verdict.md "The share image"): a sheet under
 * the header with the image as it will be saved, drawn by VerdictCard from
 * the Verdict on the page, in the size and on the ground picked, and Save and
 * Copy, each saying it worked (or that it did not) for 1.4 s. Nothing leaves
 * the PC from here: Save is a download the player places, Copy the clipboard.
 */
const SAID_FOR_MS = 1400;
const share = { size: 'card', paper: true, drawn: 0 };
let shareVerdict = null;
const shareOpen = () => !$('share-sheet').hidden;

/** The preview drawn again; a drawing overtaken by a newer one is dropped. */
function drawShare() {
  const host = $('sh-preview');
  const v = shareVerdict;
  if (!v || !window.VerdictCard) { host.replaceChildren(); return; }
  const n = ++share.drawn;
  host.dataset.size = share.size;
  Promise.resolve().then(() => window.VerdictCard.render(v, { size: share.size, paper: share.paper })).then((cv) => {
    if (n !== share.drawn || !shareOpen()) return;
    cv.classList.add('sh-canvas');
    cv.setAttribute('role', 'img');
    cv.setAttribute('aria-label', 'The share image as it will be saved');
    host.replaceChildren(cv);
  }).catch(() => {
    if (n === share.drawn) host.replaceChildren(el('p', 'sh-none', 'The image could not be drawn.'));
  });
}

function openShare() {
  if (!shareVerdict) return;
  $('share-sheet').hidden = false;
  $('share').setAttribute('aria-expanded', 'true');
  drawShare();
}

/** Closed, and the keyboard handed back to Share image when it was in the sheet. */
function closeShare(refocus) {
  const sheet = $('share-sheet');
  if (sheet.hidden) return;
  sheet.hidden = true;
  share.drawn++;
  $('sh-preview').replaceChildren();
  $('share').setAttribute('aria-expanded', 'false');
  if (refocus && !$('share').hidden) $('share').focus();
}

/** The buttons of one group pressed by the value picked. */
function pressOptions() {
  for (const b of $('share-sheet').querySelectorAll('.sh-opt')) {
    const on = b.dataset.size ? b.dataset.size === share.size : (b.dataset.ground === 'paper') === share.paper;
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
  }
}

/** A button's own label swapped for what happened, then back after 1.4 s. */
function sayOn(btn, text) {
  if (!btn.dataset.label) btn.dataset.label = btn.textContent;
  clearTimeout(btn._said);
  btn.textContent = text;
  btn.classList.add('said');
  $('sh-said').textContent = text;
  btn._said = setTimeout(() => {
    btn.textContent = btn.dataset.label;
    btn.classList.remove('said');
  }, SAID_FOR_MS);
}

// Each group one capsule with a sliding thumb (shared/seg.js), where the page
// can watch its buttons; the buttons' own aria-pressed stays the state.
if (typeof window.occlaraSeg === 'function' && typeof MutationObserver === 'function') {
  for (const g of $('share-sheet').querySelectorAll('.sh-seg')) window.occlaraSeg(g);
}
for (const b of $('share-sheet').querySelectorAll('.sh-opt')) {
  b.addEventListener('click', () => {
    if (b.dataset.size) share.size = b.dataset.size;
    else share.paper = b.dataset.ground === 'paper';
    pressOptions();
    drawShare();
  });
}
$('share').addEventListener('click', () => (shareOpen() ? closeShare(false) : openShare()));
$('sh-close').addEventListener('click', () => closeShare(true));
$('sh-save').addEventListener('click', () => {
  const v = shareVerdict;
  if (!v || !window.VerdictCard) return;
  Promise.resolve(window.VerdictCard.save(v, { size: share.size, paper: share.paper }))
    .then((done) => sayOn($('sh-save'), done ? 'Saved' : 'Could not save'));
});
$('sh-copy').addEventListener('click', () => {
  const v = shareVerdict;
  if (!v || !window.VerdictCard) return;
  Promise.resolve(window.VerdictCard.copy(v, { size: share.size, paper: share.paper }))
    .then((done) => sayOn($('sh-copy'), done ? 'Copied' : 'Could not copy'));
});

let current = null;
// A page of the main window has no window of its own to close: the bar's
// links, the back arrow and the mouse's back button are how a player leaves it.
const closeWindow = () => { if (!(window.occlaraEmbedded && window.occlaraEmbedded())) window.occlara.close(); };
$('close').addEventListener('click', closeWindow);

/*
 * THE WAY BACK (9.1, the owner's item 7): the arrow at the head's left goes
 * back to where the player came from, the app's own history (shell-nav.js
 * createHistory through the bridge's `history`), with Matches when there is
 * nothing behind this page (opened from a toast, or the window made again).
 * It says where it goes: "Matches", "Home", "Clips", by the history's
 * backLabel, kept current by its pushes. "All matches" is gone: this is it.
 */
const BACK_FALLBACK = 'matches';
const BACK_DEFAULT = 'Matches';
const historyApi = () => (window.occlara && window.occlara.history && typeof window.occlara.history.back === 'function' ? window.occlara.history : null);
function backTo(s) {
  const label = s && s.back === true && typeof s.backLabel === 'string' && s.backLabel.trim() ? s.backLabel.trim() : BACK_DEFAULT;
  $('back-label').textContent = label;
  $('back').setAttribute('aria-label', `Back to ${label}`);
  $('back').title = `Back to ${label}`;
}
function goBack() {
  const h = historyApi();
  if (h) { Promise.resolve(h.back({ fallback: BACK_FALLBACK })).catch(() => {}); return; }
  if (typeof window.occlara.openMatches === 'function') window.occlara.openMatches();
}
$('back').addEventListener('click', goBack);
{
  const h = historyApi();
  if (h && typeof h.state === 'function') Promise.resolve(h.state()).then(backTo).catch(() => {});
  if (h && typeof h.onChange === 'function') h.onChange(backTo);
}

/*
 * THE MATCH'S MENU AND DELETE MATCH (9.1, the owner's item 18). The menu
 * under the head's three dots holds Delete match; it opens on a press, or
 * the down arrow with the focus on its first row, and closes on Escape, Tab,
 * a press outside it or a row chosen. Delete match asks first, plainly, Keep
 * it focused; Delete match then asks main (MATCH_DELETE), which removes the
 * review, its clips and its frames and takes this page back where the player
 * came from, or to Matches. Main refuses mid match and while the review is
 * still being built, and the confirm says why.
 */
const DELETE_SAID = {
  match: 'You can delete it once your match is over.',
  working: 'This review is still being made. You can delete it once it is whole.',
  gone: 'This match was already deleted.',
  bad: 'This match could not be deleted.',
  failed: 'This match could not be deleted. Try again.',
};
const DELETE_BODY = 'Its review, its clips and the frames kept of it are removed from this PC. This cannot be undone.';
const DELETE_IMPORT = ' Your video file is kept, and the game it used is not given back.';
const menuOpen = () => !$('more-menu').hidden;
const deleteOpen = () => !$('del-scrim').hidden;
let menuOutside = null;
function openMore(focusFirst) {
  if ($('more').hidden) return;
  $('more-menu').hidden = false;
  $('more').setAttribute('aria-expanded', 'true');
  if (focusFirst) $('delete-match').focus();
  if (!menuOutside) {
    menuOutside = (e) => { if (!e.target || !e.target.closest || !e.target.closest('.v-more-wrap')) closeMore(false); };
    document.addEventListener('pointerdown', menuOutside, true);
  }
}
function closeMore(refocus) {
  if (menuOutside) { document.removeEventListener('pointerdown', menuOutside, true); menuOutside = null; }
  if (!menuOpen()) return;
  $('more-menu').hidden = true;
  $('more').setAttribute('aria-expanded', 'false');
  if (refocus) $('more').focus();
}
// Opened from the keyboard (Enter or Space: a click with no pointer, detail
// 0), the menu takes the focus onto its first row, as the arrows do.
$('more').addEventListener('click', (e) => (menuOpen() ? closeMore(false) : openMore(!!e && e.detail === 0)));
$('more').addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); openMore(true); }
});
$('more-menu').addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeMore(true); return; }
  if (e.key === 'Tab') { closeMore(false); return; }
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Home' || e.key === 'End') { e.preventDefault(); $('delete-match').focus(); }
});
$('delete-match').addEventListener('click', () => askDelete());

function askDelete() {
  closeMore(false);
  if (!current || !current.id || typeof window.occlara.deleteMatch !== 'function') return;
  $('del-said').hidden = true;
  $('del-said').textContent = '';
  // What goes, as Matches says it: an import's own video file stays (9.1).
  $('del-body').textContent = DELETE_BODY + (current.imported ? DELETE_IMPORT : '');
  $('del-go').disabled = false;
  $('del-go').textContent = 'Delete match';
  $('del-scrim').hidden = false;
  $('del-keep').focus();
}
function closeDelete(refocus) {
  if (!deleteOpen()) return;
  $('del-scrim').hidden = true;
  if (refocus && !$('more').hidden) $('more').focus();
}
async function doDelete() {
  const id = current && current.id;
  if (!id || $('del-go').disabled) return;
  $('del-go').disabled = true;
  $('del-go').textContent = 'Deleting';
  let got = null;
  try { got = await window.occlara.deleteMatch(id); } catch { got = null; }
  $('del-go').textContent = 'Delete match';
  // Main has taken the page back already; the dialog goes with it.
  if (got && got.ok) { closeDelete(false); return; }
  const why = (got && got.error) || 'failed';
  if (why === 'gone') { closeDelete(false); goBack(); return; }
  $('del-said').textContent = DELETE_SAID[why] || DELETE_SAID.failed;
  $('del-said').hidden = false;
  $('del-go').disabled = false;
}
$('del-keep').addEventListener('click', () => closeDelete(true));
$('del-go').addEventListener('click', () => { doDelete(); });
$('del-scrim').addEventListener('pointerdown', (e) => { if (e.target === $('del-scrim')) closeDelete(true); });
// The confirm keeps the keyboard: Tab between its two buttons, Escape keeps the match.
$('del-scrim').addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeDelete(true); return; }
  if (e.key !== 'Tab') return;
  const btns = [$('del-keep'), $('del-go')].filter((b) => !b.disabled);
  if (!btns.length) return;
  e.preventDefault();
  const i = btns.indexOf(document.activeElement);
  btns[(i + (e.shiftKey ? -1 : 1) + btns.length) % btns.length].focus();
});

$('ask').addEventListener('click', () => { if (current && current.id) window.occlara.askAbout(current.id); });
// Every round (Orbit): down to the rounds, smoothly unless asked for less motion.
$('v-every').addEventListener('click', () => {
  const to = $('v-rounds-wrap');
  if (!to || typeof to.scrollIntoView !== 'function') return;
  const calm = !!(window.Motion && window.Motion.reduced());
  to.scrollIntoView({ behavior: calm ? 'auto' : 'smooth', block: 'start' });
});
// Esc closes what is open over the page first, the confirm, then the menu,
// then the share sheet, and only with none open the page.
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (deleteOpen()) { closeDelete(true); return; }
  if (menuOpen()) { closeMore(true); return; }
  if (shareOpen()) { closeShare(true); return; }
  closeWindow();
});

// Both paths, because the window can be opened by the push OR by hand later.
window.occlara.onReview(paint);
if (window.occlara.onValorantReview) window.occlara.onValorantReview(paint);
// The review on the page moving on a step, or whole (8.4.1): its loading
// screen follows, and once its work is done the version held is painted. A
// review the page is not showing is not its business.
if (window.occlara.onReviewWork) {
  window.occlara.onReviewWork((m) => {
    if (!m || !current || !current.id || m.id !== current.id) return;
    if (m.work) {
      current = { ...current, work: m.work };
      paintHighlight(null);
      paintSky(true, true);
      $('ask').hidden = true;
      closeShare(false);
      $('share').hidden = true;
      $('more').hidden = true;
      closeMore(false);
      closeDelete(false);
      paintBuilding(m.work);
      return;
    }
    if (current.work) paint({ ...current, work: null });
  });
}
window.occlara.getReview().then(paint).catch(() => paint(null));
console.log('[review] ready');

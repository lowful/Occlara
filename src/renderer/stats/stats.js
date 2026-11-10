'use strict';

const cardsEl        = document.getElementById('cards');
const matchListEl    = document.getElementById('match-list');
const matchEmptyEl   = document.getElementById('match-empty');
const sessionListEl  = document.getElementById('session-list');
const sessionEmptyEl = document.getElementById('session-empty');
const updatedEl      = document.getElementById('updated');
const refreshBtn     = document.getElementById('refresh');

const ARROW = { up: '▲', down: '▼', flat: '·' };
let lastFetchedAt = 0;
let refreshBlockedUntil = 0;
let matchMode = 'competitive';   // always opens on Competitive; Unrated = unrated + swiftplay

// ── Top score badges ─────────────────────────────────────────────────────────
// A graded match is linked to the tracker row by time and map: a tracker match
// that started in the hour before the review was written is that match. Matches from every loaded mode bucket accumulate in knownMatches.
// THE BADGE NAMES WHAT IT COUNTS: the top combat score. Since 13.06 the
// game names its MVP by Performance Score, so a badge reading MVP named a
// player the game did not.
const mvpText = (kind) => (kind === 'match' ? 'Top score' : 'Team top score');
const knownMatches = new Map();   // match id -> { startedAt, map, mvp }
const sessionMvpSlots = [];       // { s, slot } placeholders on rendered session rows

function annotateSessionMvps() {
  for (const { s, slot } of sessionMvpSlots) {
    if (slot.dataset.done) continue;
    // A review is stamped when its match ended, so the match started in the
    // hour before it.
    const start = (s.at || 0) - 70 * 60000;
    const end   = (s.at || 0) + 2 * 60000;
    for (const m of knownMatches.values()) {
      if (!m.mvp || !m.startedAt || m.startedAt < start || m.startedAt > end) continue;
      if (s.map && m.map && s.map !== m.map) continue;
      slot.dataset.done = '1';
      slot.className = `mvp ${m.mvp}`;
      slot.textContent = mvpText(m.mvp);
      slot.hidden = false;
      break;
    }
  }
}

// Mode toggle: same ratings, same treatment, just not ranked.
// Sequenced so a slow older response can never overwrite a newer mode, and
// re-clicking always retries (the old early-return left it stuck when the
// first fetch failed, the "have to click a couple times" glitch).
let matchSeq = 0;
async function loadMatches(mode) {
  const seq = ++matchSeq;
  matchListEl.innerHTML = '';
  matchEmptyEl.hidden = false;
  matchEmptyEl.textContent = 'Loading matches...';
  try {
    const res = await window.occlara.matchesFor(mode);
    if (seq !== matchSeq || mode !== matchMode) return;   // superseded by a newer click
    renderMatches(res);
  } catch {
    if (seq === matchSeq) matchEmptyEl.textContent = 'Could not load matches. Click the mode again to retry.';
  }
}

const modeSeg = document.getElementById('modeseg');
// One capsule, one thumb that slides to the chosen mode (shared/seg.js). The
// buttons keep their .active, which is what the thumb follows.
try { if (typeof window.occlaraSeg === 'function') window.occlaraSeg(modeSeg); } catch { /* the buttons stand as they are */ }
modeSeg.addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  matchMode = btn.dataset.mode;   // re-clicking the same mode retries on purpose
  for (const b of modeSeg.querySelectorAll('button')) b.classList.toggle('active', b === btn);
  refreshBlockedUntil = 0;
  loadMatches(matchMode);
  refreshDashboardForMode(matchMode);   // overview + agents follow the queue too
});

// ── Overview cards ────────────────────────────────────────────────────────────
function card(label, value, direction, small) {
  const el = document.createElement('div');
  el.className = 'card';
  const l = document.createElement('span');
  l.className = 'label';
  l.textContent = label;
  const row = document.createElement('div');
  row.className = 'val-row';
  const v = document.createElement('span');
  v.className = 'value' + (small ? ' small' : '') + (value == null ? ' none' : '');
  v.textContent = value == null ? '·' : value;
  const a = document.createElement('span');
  a.className = `arrow ${direction || 'flat'}`;
  // No number, no trend: a flat mark beside nothing would read as "no change".
  a.textContent = value == null ? '' : (ARROW[direction] || ARROW.flat);
  row.append(v, a);
  el.append(l, row);
  return el;
}

// Per-rank field notes: what the rank is about and the mistakes that keep
// players hardstuck there, distilled from Radiant coaching material.
const RANK_NOTES = {
  iron: { summary: 'The foundations rank, rounds are decided by raw gun handling before anything else.',
    issues: ['Spamming pistols instead of respecting each gun\'s reset time, the Ghost, Classic, and Sheriff each have their own rhythm between accurate shots',
      'Crosshair drifting to the floor or walls between fights',
      'Fix it in the Range at 10 meters: slow down until your shots stop flying up, then speed back up'] },
  bronze: { summary: 'Utility exists here, but it works against the team as often as for it.',
    issues: ['Panic dumping abilities the moment enemies are seen or heard, a solo dart at round start that nobody can swing on helps no one',
      'Bad utility is worse than none, a bad smoke blocks your own team\'s crossfires and gives free space',
      'Before every ability, ask what it does for the team right now. No answer in one sentence, do not press the key'] },
  silver: { summary: 'Aim starts landing, and confidence becomes the trap.',
    issues: ['Ego peeking and overheating: one kill, then an instant swing for more into someone you missed',
      'Chasing clips instead of winning rounds',
      'The fix is disciplined aggression: after a kill ask if more is risky, and if yes, reposition and play with your team'] },
  gold: { summary: 'Just enough map awareness to talk yourself into bad rotations.',
    issues: ['Panic rotating off one utility sound or a few footsteps, gold is the easiest rank in the game to fake',
      'Leaving your site free the moment noise happens elsewhere',
      'Learn to anchor: pick your site and do not leave until enemies are actually confirmed hitting the other one'] },
  platinum: { summary: 'The duels are fine, the economy and macro are out of sync with the team.',
    issues: ['Hero buys while the team saves, one selfish rifle creates two or three mismatched rounds after it',
      'Buying on feeling instead of what the team can afford together',
      'Press Tab before every buy and match the team: save together, buy together'] },
  diamond: { summary: 'Skilled but predictable, the same script every round gets pre aimed.',
    issues: ['Running the same "if X then Y" in the same spot every round, enemies need only a few rounds to read it',
      'Feeling constantly one tapped is often just being predictable',
      'Condition your opponents: teach them a pattern, then break it, and rotate your setups between rounds'] },
  ascendant: { summary: 'The accidental baiter rank: smart positioning that leaves teammates fighting alone.',
    issues: ['Sitting too far behind the entry to trade, arriving after the duelist is already dead',
      'The trade window is 1 to 2 seconds after contact, outside it the trade is gone forever',
      'Stay within a step or two of your entry on attack, and pair up on defense so every fight gets answered'] },
  immortal: { summary: 'Mechanics are Radiant level, the gap is mental endurance and consistency.',
    issues: ['Checking out after unlucky clutches or toxic teammates, then throwing the rounds that decide the game',
      'Inconsistency across a full match, not a lack of skill',
      'Play every round like the score is 12 to 12: three seconds of breath before each buy phase, then the best play'] },
  radiant: { summary: 'The top. Staying here is pure consistency, every round played like overtime.',
    issues: ['Complacency, streaks end on relaxed rounds',
      'Keep the 12 to 12 mindset that got you here'] },
};

function rankTier(rankValue) {
  const l = String(rankValue || '').toLowerCase();
  return Object.keys(RANK_NOTES).find((t) => l.startsWith(t)) || null;
}

const rankNotesEl = document.getElementById('rank-notes');
const rankReveal = document.getElementById('rank-reveal');

/*
 * THE RANK NOTES OPEN BY HEIGHT IN PLACE (8.2): #rank-reveal grows its one row
 * from nothing to the notes' height (.reveal, ui.css) and back, and is hidden
 * once closed, so a closed one is nothing at all to a screen reader. rankOpen
 * is the state: hidden only comes some time after the close.
 */
/** --t-med in ms, read from theme.css so the timer and the reveal agree. */
function revealMs() {
  try {
    const v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--t-med'));
    return Number.isFinite(v) ? v : 220;
  } catch { return 220; }
}
let rankOpen = false;
let rankCloseTimer = null;
function openRankNotes() {
  clearTimeout(rankCloseTimer);
  rankOpen = true;
  rankReveal.hidden = false;
  void rankReveal.offsetHeight;   // at 0fr first, or there is nothing to grow from
  rankReveal.classList.add('open');
  markRankCard();
}
function closeRankNotes(now) {
  rankOpen = false;
  rankReveal.classList.remove('open');
  markRankCard();
  clearTimeout(rankCloseTimer);
  if (now) { rankReveal.hidden = true; return; }
  rankCloseTimer = setTimeout(() => { if (!rankOpen) rankReveal.hidden = true; }, revealMs());
}
/** The rank tile's chevron turns over while its notes are open. */
function markRankCard() {
  const tile = cardsEl && cardsEl.querySelector('.card.clickable');
  if (tile) tile.classList.toggle('notes-open', rankOpen);
}

// ── Rank journey graph: competitive RR movement, drawn as an SVG line ────────
// Its colours are stats.css's (.rg-area, .rg-line, .rg-dot), tokens over one
// solid fill, the line and its dot as Home draws the same journey (8.4.1). It
// was the retired cyan over a gradient fill, written into the markup. The dot
// is a span over the line, as Home's is: a circle in a box stretched to the
// card (preserveAspectRatio none) is drawn as an ellipse.
async function renderRankGraph(host, opts) {
  const old = host.querySelector('.rank-graph');
  if (old) old.remove();
  const wrap = document.createElement('div');
  wrap.className = 'rank-graph';
  wrap.innerHTML = '<div class="rg-loading">Loading your rank journey...</div>';
  host.prepend(wrap);
  // Through the tile's shared read (rrPoints), so a Refresh with the notes
  // open asks for the history once, not twice at once on the one stats key.
  let points = [];
  try { points = (await rrPoints(!!(opts && opts.force))).slice(); } catch {}
  // Placements and act resets make elo leap by hundreds and fake absurd RR
  // gains (+1535 from "Unrated" to Diamond). Keep only rated games, then cut
  // at the newest discontinuity so the graph covers one honest stretch, and
  // report net RR as the sum of per-game changes, what was actually gained.
  points = points.filter((p) => p.elo > 0 && p.tier && !/unrated|unranked/i.test(p.tier));
  let startIdx = 0;
  for (let i = points.length - 1; i > 0; i--) {
    if (Math.abs(points[i].elo - points[i - 1].elo) > 300) { startIdx = i; break; }
  }
  points = points.slice(startIdx);
  if (points.length < 2) { wrap.remove(); return; }

  const W = 560, H = 130, PAD = 10;
  const elos = points.map((p) => p.elo);
  const min = Math.min(...elos), max = Math.max(...elos);
  const span = Math.max(max - min, 20);
  const x = (i) => PAD + (i / (points.length - 1)) * (W - PAD * 2);
  const y = (e) => H - PAD - ((e - min) / span) * (H - PAD * 2);
  const path = points.map((p, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(p.elo).toFixed(1)).join(' ');
  const net = points.reduce((sum, p) => sum + (p.change || 0), 0);
  const last = points[points.length - 1];

  // Tiers and numbers come from the server: text is escaped and numbers are
  // made numbers before they go into the markup (8.11).
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  wrap.innerHTML = `
    <div class="rg-head">
      <span class="rg-title">Rank journey · last ${points.length} comp games</span>
      <span class="rg-net ${net >= 0 ? 'up' : 'down'}">${net >= 0 ? '+' : ''}${num(net)} RR</span>
    </div>
    <div class="rg-plot">
      <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
        <path class="rg-area" d="${path} L ${x(points.length - 1).toFixed(1)} ${H - PAD} L ${x(0).toFixed(1)} ${H - PAD} Z"/>
        <path class="rg-line" d="${path}"/>
      </svg>
      <span class="rg-dot" style="left: ${((x(points.length - 1) / W) * 100).toFixed(2)}%; top: ${((y(last.elo) / H) * 100).toFixed(2)}%"></span>
    </div>
    <div class="rg-foot">
      <span>${esc(points[0].tier)}</span>
      <span>${esc(last.tier)}${last.change != null ? ' · last game ' + (num(last.change) >= 0 ? '+' : '') + num(last.change) + ' RR' : ''}</span>
    </div>`;
}

function toggleRankNotes(rankValue) {
  if (rankOpen) { closeRankNotes(); return; }
  const tier = rankTier(rankValue);
  rankNotesEl.innerHTML = '';
  renderRankGraph(rankNotesEl);   // graph on top, insights below
  const title = document.createElement('h4');
  const body  = document.createElement('p');
  if (!tier) {
    title.textContent = 'Rank insights';
    body.textContent = 'Connect your Riot ID in Settings and play ranked to see what typically holds players back at your rank.';
    rankNotesEl.append(title, body);
  } else {
    const n = RANK_NOTES[tier];
    title.textContent = `About ${tier.charAt(0).toUpperCase() + tier.slice(1)}`;
    body.textContent = n.summary;
    const label = document.createElement('div');
    label.className = 'rn-label';
    label.textContent = 'Why players get stuck here';
    const ul = document.createElement('ul');
    for (const issue of n.issues) {
      const li = document.createElement('li');
      li.textContent = issue;
      ul.append(li);
    }
    rankNotesEl.append(title, body, label, ul);
  }
  openRankNotes();
}

/*
 * OPENED FOR THE JOURNEY (8.4.1). Home's Rank journey opened this page with
 * the journey folded in the Rank tile, one more click from what the button
 * names. Main keeps what the page was opened to show until the page asks
 * (STATS_OPENED_FOR, taken once): as it loads, since a page still loading
 * misses what main sends it, and each time it is about to be shown again
 * (PUSH_PAGE's arm) or comes in (its enter: a page called back before the one
 * replacing it arrived comes back with an enter and no arm). The journey then
 * opens, never toggles, once the tile it opens under is painted with this
 * account's rank, and the overview is scrolled to, for a page kept between
 * visits further down.
 */
let shownRank;               // the rank the tile shows, undefined until it is painted
let journeyWanted = false;   // asked for before the tile was there to open it under
function showJourney() {
  if (!journeyWanted || shownRank === undefined) return;
  journeyWanted = false;
  if (!rankOpen) toggleRankNotes(shownRank);
  const overview = document.getElementById('sec-overview');
  if (overview && typeof overview.scrollIntoView === 'function') overview.scrollIntoView({ block: 'start' });
}
async function askOpenedFor() {
  if (typeof window.occlara.openedFor !== 'function') return;
  let what = null;
  try { what = await window.occlara.openedFor(); } catch { return; }
  if (what !== 'journey') return;
  journeyWanted = true;
  showJourney();
}

/*
 * THE RANK TILE SAYS WHAT THE LAST RATED GAME DID, IN RR. Its arrow was a trend
 * between two tracker snapshots, and with no older snapshot to compare it was a
 * flat dash beside every rank, which reads as "no change" when it means "not
 * known". The rank history (the points the rank journey draws, cached in main
 * for five minutes) has the real number: its newest rated point, elo above zero
 * with a change of 60 or less, because placements and act resets move the elo
 * by hundreds. Not known, the tile shows nothing at all.
 */
function rankDelta(points) {
  const list = Array.isArray(points) ? points : [];
  for (let i = list.length - 1; i >= 0; i--) {
    const p = list[i];
    if (p && p.elo > 0 && Number.isFinite(p.change) && Math.abs(p.change) <= 60) return p.change;
  }
  return null;
}

async function paintRankDelta(el) {
  const change = rankDelta(await rrPoints());
  if (change === null) return;
  el.textContent = `${change > 0 ? '+' : ''}${change} RR`;
  el.classList.add(change > 0 ? 'gain' : change < 0 ? 'loss' : 'even');
  el.title = 'RR from your last rated game';
}

/** Nothing to count yet: no rank and no number, as before a Riot ID is connected. */
function nothingToShow(d) {
  const c = d.categories || {};
  return !(d.rank && d.rank.value) && ['impact', 'positioning', 'utility', 'aim'].every((k) => c[k] == null || c[k].avg == null)
    && !(d.winRate && d.winRate.value != null);
}

function renderCards(d) {
  cardsEl.innerHTML = '';
  const rankCard = card('Rank', d.rank?.value, d.rank?.direction, true);
  // Empty until the rank history answers, never the trend's dash.
  const rr = rankCard.querySelector('.arrow');
  rr.className = 'arrow rr';
  rr.textContent = '';
  paintRankDelta(rr);
  rankCard.classList.add('clickable');
  const chev = document.createElement('span');
  chev.className = 'rank-chev';
  chev.textContent = '▾';
  rankCard.querySelector('.label').append(' ', chev);
  rankCard.title = 'What holds players back at this rank';
  // The whole line opens the notes, from the keyboard as well.
  rankCard.setAttribute('role', 'button');
  rankCard.tabIndex = 0;
  rankCard.addEventListener('click', () => toggleRankNotes(d.rank && d.rank.value));
  rankCard.addEventListener('keydown', (e) => {
    if (e.target !== rankCard || (e.key !== 'Enter' && e.key !== ' ')) return;
    e.preventDefault();
    toggleRankNotes(d.rank && d.rank.value);
  });
  // Built again by the mode toggle, Refresh and a Riot ID switch, any of which
  // can come while the notes stay open under it, so the chevron is read off
  // rankOpen here too, not only as the notes open and close (markRankCard).
  rankCard.classList.toggle('notes-open', rankOpen);
  // THE RANK'S QUIET LINE (8.7.9): main's finished words from Riot's MMR
  // (riot-rank.js rankLine), the RR in the tier, the peak and its act,
  // shields, the leaderboard place and this act's wins, and the account's
  // aces and clutches as Riot counts them. Only what the game itself shows,
  // never a rating, and nothing at all from a server before it.
  const said = (Array.isArray(d.rankLine) ? d.rankLine : []).filter((s) => typeof s === 'string' && s)
    .concat(typeof d.accolades === 'string' && d.accolades ? [d.accolades] : []);
  if (said.length && d.rank && d.rank.value) {
    const sub = document.createElement('span');
    sub.className = 'rank-sub';
    sub.textContent = said.join('  ·  ');
    rankCard.append(sub);
  }
  // NO RIOT ID, NO EMPTY COLUMNS (8.7): six quiet marks under their labels
  // read as a broken page. The rank row alone stays, its value one line
  // saying what is missing and one ghost button to Settings; its notes still
  // open under it (the journey Home asks for), and the five columns are
  // painted once there is a number to show.
  if (nothingToShow(d)) {
    const p = document.createElement('p');
    p.id = 'cards-none';
    p.textContent = 'Connect your Riot ID in Settings to see your rank and numbers here.';
    const row = rankCard.querySelector('.val-row');
    row.replaceChildren(p);
    if (typeof window.occlara.go === 'function') {
      const go = document.createElement('button');
      go.type = 'button';
      go.id = 'cards-settings';
      go.className = 'btn btn-ghost sm';
      go.textContent = 'Open Settings';
      go.addEventListener('click', (e) => { e.stopPropagation(); window.occlara.go('settings'); });
      row.append(go);
    }
    cardsEl.append(rankCard);
    shownRank = null;
    showJourney();
    return;
  }
  const c = d.categories || {};
  // The rank first, the page's hero on a line of its own; the five numbers
  // under it in columns (stats.css .cards).
  cardsEl.append(
    rankCard,
    card('Impact',      c.impact?.avg,      c.impact?.direction),
    card('Positioning', c.positioning?.avg, c.positioning?.direction),
    card('Utility',     c.utility?.avg,     c.utility?.direction),
    card('Aim',         c.aim?.avg,         c.aim?.direction),
    card('Win rate',    d.winRate?.value != null ? d.winRate.value + '%' : null, d.winRate?.direction),
  );
  shownRank = (d.rank && d.rank.value) || null;
  showJourney();   // Home asked for the journey before the tile was painted
}

// ── Recent matches ────────────────────────────────────────────────────────────
// The TRACKER's match rating (the server's computeMatchRating: a base for the
// result plus a K/D bonus), not Occlara's grade, so it keeps its own bands. A
// review's grade is coloured by its letter, below in Graded matches.
function ratingClass(r) { return r >= 85 ? 'great' : r >= 70 ? 'good' : r >= 55 ? 'mid' : 'low'; }

// The one grade colour rule (shared/grade-view.js), keyed to the letter bands.
// Without the script a grade only loses its colour; the number and the letter
// are still printed.
const gradeTone = (g) => (window.GradeView ? window.GradeView.gradeTone(g) : '');

// Grade a per-match stat for the tile colors: g = good, y = okay, r = bad.
// Thresholds follow common tracker expectations for competitive play.
function grade(kind, v) {
  if (v == null) return '';
  switch (kind) {
    case 'kd':   return v >= 1.2 ? 'g' : v >= 0.9  ? 'y' : 'r';
    case 'acs':  return v >= 230 ? 'g' : v >= 180  ? 'y' : 'r';
    case 'adr':  return v >= 150 ? 'g' : v >= 120  ? 'y' : 'r';
    case 'hs':   return v >= 20  ? 'g' : v >= 12   ? 'y' : 'r';
    case 'kpr':  return v >= 0.8 ? 'g' : v >= 0.6  ? 'y' : 'r';
    case 'dpr':  return v <= 0.7 ? 'g' : v <= 0.85 ? 'y' : 'r';   // lower is better
    case 'apr':  return v >= 0.4 ? 'g' : v >= 0.2  ? 'y' : 'r';
    case 'dmg':  return v >= 20  ? 'g' : v >= -20  ? 'y' : 'r';   // damage +/- per round
    default:     return '';
  }
}

function statTile(label, value, gradeClass) {
  const tile = document.createElement('div');
  tile.className = 'tile';
  const l = document.createElement('span');
  l.className = 't-label';
  l.textContent = label;
  const v = document.createElement('span');
  v.className = `t-val ${gradeClass || ''}`;
  v.textContent = value == null ? '·' : value;
  tile.append(l, v);
  return tile;
}

/*
 * A ROW'S DROP DOWN OPENS BY HEIGHT IN PLACE (8.2), as the rank notes do: the
 * detail sits in a .reveal under the row's top line, and .open on the row
 * grows it from nothing (stats.css). Closed, what is in it is out of reach as
 * well as out of sight.
 */
/** A row that opens on a click, and on Enter or Space from the keyboard. */
function expandable(row) {
  row.setAttribute('role', 'button');
  row.tabIndex = 0;
  row.setAttribute('aria-expanded', 'false');
  const toggle = () => {
    row.classList.toggle('open');
    row.setAttribute('aria-expanded', row.classList.contains('open') ? 'true' : 'false');
  };
  row.addEventListener('click', (e) => {
    // A click on what the row opened (a number, the team) is reading, not folding.
    const t = e && e.target;
    if (t && t !== row && typeof t.closest === 'function' && t.closest('.detail')) return;
    toggle();
  });
  row.addEventListener('keydown', (e) => {
    if (e.target !== row || (e.key !== 'Enter' && e.key !== ' ')) return;
    e.preventDefault();
    toggle();
  });
}

function dropDown(detail) {
  const reveal = document.createElement('div');
  reveal.className = 'reveal';
  const clip = document.createElement('div');
  clip.className = 'reveal-clip';
  clip.append(detail);
  reveal.append(clip);
  return reveal;
}

function matchRow(m) {
  const row = document.createElement('div');
  row.className = `row expandable ${m.result === 'Victory' ? 'win' : m.result === 'Defeat' ? 'loss' : ''}`;
  const top = document.createElement('div');
  top.className = 'top';
  const chev = document.createElement('span');
  chev.className = 'chev';
  chev.innerHTML = '<svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7"/></svg>';
  const place = document.createElement('span');
  place.className = 'place';
  place.textContent = m.map || 'Unknown';
  const sub = document.createElement('span');
  sub.className = 'sub';
  sub.textContent = [m.agent, m.queue && m.queue !== 'Competitive' ? m.queue : null].filter(Boolean).join(' · ');
  const spacer = document.createElement('span');
  spacer.className = 'spacer';
  const kda = document.createElement('span');
  kda.className = 'kda';
  kda.textContent = `${m.kills}/${m.deaths}/${m.assists}`;
  const res = document.createElement('span');
  res.className = `res ${m.result === 'Victory' ? 'win' : 'loss'}`;
  res.textContent = m.result === 'Victory' ? `Win ${m.score}` : `Loss ${m.score}`;
  const rating = document.createElement('span');
  rating.className = `rating ${ratingClass(m.rating)}`;
  rating.textContent = m.rating;
  rating.title = 'Match rating (0-100)';
  top.append(chev, place, sub, spacer, kda, res);
  if (m.mvp) {
    const mvp = document.createElement('span');
    mvp.className = `mvp ${m.mvp}`;
    mvp.textContent = mvpText(m.mvp);
    mvp.title = m.mvp === 'match'
      ? 'Top combat score on the winning team'
      : 'Top combat score on your team';
    top.append(mvp);
  }
  top.append(rating);

  // Drop-down: the tracker's most important stats, graded green/yellow/red.
  const detail = document.createElement('div');
  detail.className = 'detail';
  const tiles = document.createElement('div');
  tiles.className = 'tiles';
  const dmgVal = m.dmgDelta == null ? null : (m.dmgDelta > 0 ? '+' + m.dmgDelta : String(m.dmgDelta));
  tiles.append(
    statTile('K/D',        m.kd,          grade('kd',  m.kd)),
    statTile('ACS',        m.acs,         grade('acs', m.acs)),
    statTile('ADR',        m.adr,         grade('adr', m.adr)),
    statTile('HS%',        m.headshotPct != null ? m.headshotPct + '%' : null, grade('hs', m.headshotPct)),
    statTile('Kills/Rd',   m.kpr,         grade('kpr', m.kpr)),
    statTile('Deaths/Rd',  m.dpr,         grade('dpr', m.dpr)),
    statTile('Assists/Rd', m.apr,         grade('apr', m.apr)),
    statTile('Dmg +/- Rd', dmgVal,        grade('dmg', m.dmgDelta)),
  );
  // HOW THE TEAM PLAYED: each teammate by agent, with their numbers, ordered
  // by combat score like the in-game scoreboard, the player's own row marked
  // "You" rather than removed, so the row they are looking for is where they
  // expect it.
  //
  // NEVER ANOTHER PLAYER'S NAME OR TAG (8.4.1). This list showed every
  // teammate's full Riot ID, and Valorant lets a player hide theirs from
  // anyone outside their party; Riot's policy is that a product shows no
  // player's identity to others without their opt in. The server sends none
  // since, and a name an older server still sends is never read here.
  let teamEl = null;
  if (Array.isArray(m.team) && m.team.length) {
    const team = document.createElement('div');
    team.className = 'team-list';
    const head = document.createElement('div');
    head.className = 'team-head';
    head.textContent = 'Your team';
    team.append(head);
    for (const p of m.team) {
      const row = document.createElement('div');
      row.className = 'team-row' + (p.me ? ' me' : '');
      const agent = document.createElement('span');
      agent.className = 'team-agent';
      agent.textContent = p.agent || 'Unknown agent';
      const you = document.createElement('span');
      you.className = 'team-you';
      you.textContent = p.me ? 'You' : '';
      const line = document.createElement('span');
      line.className = 'team-line';
      line.textContent = `${p.kills}/${p.deaths}/${p.assists}${p.acs != null ? '  ACS ' + p.acs : ''}`;
      row.append(agent, you, line);
      team.append(row);
    }
    teamEl = team;
  }

  detail.append(tiles);
  if (teamEl) detail.append(teamEl);
  row.append(top, dropDown(detail));
  expandable(row);
  return row;
}

function timeAgo(ts) {
  if (!ts) return '';
  const m = Math.max(0, Math.round((Date.now() - ts) / 60000));
  return m < 1 ? 'just now' : m === 1 ? '1 minute ago' : m < 60 ? `${m} minutes ago` : `${Math.round(m / 60)}h ago`;
}

function renderMatches(res) {
  matchListEl.innerHTML = '';
  const matches = (res && res.matches) || [];
  lastFetchedAt = (res && res.fetchedAt) || lastFetchedAt;
  if (res && res.refreshBlockedFor) refreshBlockedUntil = Date.now() + res.refreshBlockedFor;
  updatedEl.textContent = lastFetchedAt ? `Last updated ${timeAgo(lastFetchedAt)}` : '';

  renderMaps(matches);
  // Top agents counts this list when Riot's profile sent none.
  agentFeed.matches = matches;
  if (!agentFeed.top.length) renderAgents();
  if (!matches.length) {
    matchEmptyEl.hidden = false;
    const noRiot = !!(res && res.error === 'no-riot-id');
    matchEmptyEl.textContent = noRiot
      ? 'Connect your Riot ID in Settings to see your recent matches here.'
      : 'No recent matches found yet. Matches appear a few minutes after they end.';
    // The queue switch and Refresh wait for a Riot ID too (8.7): with none,
    // nothing they do can answer.
    matchTools(!noRiot);
    return;
  }
  matchTools(true);
  matchEmptyEl.hidden = true;
  // A row already on screen is settled (8.7): it does not rise again on a
  // Refresh or a dashboard repaint, as a graded match's row does not.
  const had = new Set(knownMatches.keys());
  for (const m of matches) if (m.id) knownMatches.set(m.id, m);
  annotateSessionMvps();
  matches.forEach((m, i) => {
    const r = matchRow(m);
    if (m.id && had.has(m.id)) r.classList.add('settled');
    else r.style.animationDelay = Math.min(i, 8) * 40 + 'ms';   // rows rise once, 40ms apart, eight at most
    matchListEl.append(r);
  });
}

/** The queue capsule and Refresh, shown only where a Riot ID can answer them. */
function matchTools(on) {
  const seg = document.getElementById('modeseg');
  if (seg) seg.hidden = !on;
  refreshBtn.hidden = !on;
  updatedEl.hidden = !on;
}

// Manual refresh, rate limited to once per 3 minutes (mirrored on the server).
refreshBtn.addEventListener('click', async () => {
  refreshBtn.disabled = true;
  refreshBtn.textContent = 'Refreshing';
  try {
    const seq = ++matchSeq;
    const res = await window.occlara.refreshMatches(matchMode);
    if (!(res && res.refreshBlockedFor)) refreshBlockedUntil = Date.now() + 3 * 60 * 1000;
    if (seq === matchSeq && (!res.mode || res.mode === matchMode)) renderMatches(res);
  } catch {}
  // RR moved? The rank history is read again FORCED, because main keeps it
  // five minutes: a Refresh just after Riot published a game showed the game
  // before it on the tile as "RR from your last rated game", beside a match
  // list that already had the new one. Started before the dashboard, so the
  // tile it repaints reads this one.
  rrPoints(true);
  refreshDashboardForMode(matchMode, true);   // agents + overview stay fresh too
  // Not forced again: rrPoints(true) above is the read, and the graph shares it.
  if (rankOpen) renderRankGraph(rankNotesEl);
  tickRefresh();
});

function tickRefresh() {
  const left = refreshBlockedUntil - Date.now();
  if (left > 0) {
    refreshBtn.disabled = true;
    refreshBtn.textContent = `Refresh in ${Math.ceil(left / 1000)}s`;
  } else {
    refreshBtn.disabled = false;
    refreshBtn.textContent = 'Refresh';
  }
  if (lastFetchedAt) updatedEl.textContent = `Last updated ${timeAgo(lastFetchedAt)}`;
}
setInterval(tickRefresh, 1000);

// ── Coaching sessions ─────────────────────────────────────────────────────────
function fmtDate(ts) {
  const d = new Date(ts);
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' +
         d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

/** The grade counts up from 0 as the review's does, in CSS alone (stats.css
 *  .grade-chip.counting, @property --n): the real number is the text from the
 *  start, and the count is drawn over it, so nothing here does arithmetic. */
function revealScore(el, target, delay) {
  // Less motion: the number, at once (the count drew a 0 through its delay).
  if (typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  el.style.setProperty('--to', String(target));
  el.style.animationDelay = delay + 'ms';
  el.classList.add('counting');
}

/**
 * One graded match from the library. The number is the review's grade; opening
 * the row shows what it was built on, and the button opens the whole review.
 *
 * `settled` is a row that was already on screen with the same grade and is
 * being repainted because another review was saved. It skips the count up and
 * the entrance, so only the match that is new or changed draws the eye.
 */
function sessionRow(s, i, settled) {
  const row = document.createElement('div');
  row.className = 'row expandable session' + (settled ? ' settled' : '');
  row.dataset.id = s.id || '';
  if (!settled) row.style.animationDelay = Math.min(i, 8) * 40 + 'ms';   // rows rise once, 40ms apart, eight at most
  const top = document.createElement('div');
  top.className = 'top';
  const chev = document.createElement('span');
  chev.className = 'chev';
  chev.innerHTML = '<svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M9 5l7 7-7 7"/></svg>';
  const place = document.createElement('span');
  place.className = 'place';
  place.textContent = fmtDate(s.at);
  const sub = document.createElement('span');
  sub.className = 'sub';
  // Result in the collapsed row: whether the match was a win is the first
  // thing anyone wants next to its grade, and it should not need a click.
  sub.textContent = [s.map, s.title, s.result && s.score ? `${s.result} ${s.score}` : s.score]
    .filter(Boolean).join(' · ');
  const spacer = document.createElement('span');
  spacer.className = 'spacer';
  const mvpSlot = document.createElement('span');
  mvpSlot.hidden = true;   // fills in when a known match links to this one
  sessionMvpSlots.push({ s, slot: mvpSlot });
  // Coloured by the grade's LETTER, as everywhere else. This chip used the
  // tracker rating's bands at 85, 70 and 55, so an 82 A was white here and green
  // in the review, the library and the panel.
  const tone = gradeTone(s.grade);
  const target = (s.grade && s.grade.score) || 0;
  const score = document.createElement('span');
  score.className = 'grade-chip';
  score.title = s.grade && s.grade.provisional ? 'Match grade, provisional' : 'Match grade';
  score.textContent = String(target);
  if (tone) score.classList.add(tone);
  if (!settled) revealScore(score, target, Math.min(i, 8) * 40);
  const letter = document.createElement('span');
  letter.className = 'grade-letter' + (tone ? ' ' + tone : '');
  letter.textContent = s.grade ? s.grade.letter : '';
  top.append(chev, place, sub, spacer, mvpSlot, score, letter);

  const detail = document.createElement('div');
  detail.className = 'detail';
  if (s.topMistake) {
    const wl = document.createElement('div'); wl.className = 'd-label w'; wl.textContent = 'Top repeated mistake';
    const wp = document.createElement('p');   wp.textContent = s.topMistake;
    detail.append(wl, wp);
  }
  const note = document.createElement('p');
  note.className = 'd-note';
  note.textContent = s.verified ? "Checked against Riot's record of the match." : 'Graded from what the screen showed.';
  detail.append(note);
  const actions = document.createElement('div');
  actions.className = 'd-actions';
  const open = document.createElement('button');
  open.className = 'btn sm ask-btn no-drag';
  open.textContent = 'Open the review';
  open.addEventListener('click', (e) => { e.stopPropagation(); window.occlara.openReview(s.id); });
  const ask = document.createElement('button');
  ask.className = 'btn sm ask-btn no-drag';
  ask.textContent = 'Ask Coach about this';
  ask.addEventListener('click', (e) => { e.stopPropagation(); window.occlara.askAboutSession({ reviewId: s.id }); });
  actions.append(open, ask);
  detail.append(actions);
  row.append(top, dropDown(detail));
  expandable(row);
  return row;
}

function matchForSession(s) {
  const start = (s.at || 0) - ((s.durationMin || 0) + 20) * 60000;
  const end   = (s.at || 0) + 10 * 60000;
  let best = null;
  for (const m of knownMatches.values()) {
    if (!m.startedAt || m.startedAt < start || m.startedAt > end) continue;
    if (s.map && m.map && s.map !== m.map) continue;
    if (!best || m.startedAt > best.startedAt) best = m;
  }
  return best;
}
function mvpForSession(s) {
  const m = matchForSession(s);
  return m ? m.mvp || null : null;
}

// The rank history points, cached per window as the read itself, so whoever
// asks while it is out shares it and an older read landing late never
// replaces a newer one. Refresh starts a forced one, past main's own five
// minute cache, and the rank tile repainted after it reads that.
//
// SHARED FOR A MOMENT, NOT FOR THE PAGE'S LIFE. The page is kept between
// visits, and main drops its own cache when a recording stops so the match
// just played shows at once; a read held here for good left it out of the
// rank graph until a Refresh. So a read is shared for RR_SHARE_MS, which
// covers one paint's tile and match rows, and main is asked again after.
const RR_SHARE_MS = 30 * 1000;
let rrPointsCache = null;
let rrPointsAt = 0;
function rrPoints(force) {
  const now = performance.now();
  if (rrPointsCache && !force && now - rrPointsAt < RR_SHARE_MS) return rrPointsCache;
  rrPointsAt = now;
  rrPointsCache = (async () => {
    try {
      const r = await window.occlara.rankHistory(!!force);
      return (r && !r.error && Array.isArray(r.points)) ? r.points : [];
    } catch { return []; }
  })();
  return rrPointsCache;
}

// The grade each row on screen is showing, by review id, so a repaint can tell
// a new or changed grade (counts up, slides in) from one already there.
const shownGrades = new Map();

/**
 * Every graded review in the library, newest first; the empty state only
 * appears with none at all. A review is saved the moment its match ends, so
 * there is no "grading" placeholder any more: the row is the review, and it
 * repaints when Riot's record improves it (onReviews below).
 */
function renderSessions(d) {
  // A row someone has opened stays open through a repaint, rather than folding
  // shut under the cursor because a different match was saved.
  const open = new Set([...sessionListEl.querySelectorAll('.row.session.open')].map((r) => r.dataset.id));
  sessionListEl.innerHTML = '';
  sessionMvpSlots.length = 0;   // rows are being rebuilt, drop stale slots
  const sessions = d.sessions || [];
  const before = new Map(shownGrades);
  shownGrades.clear();
  if (!sessions.length) {
    sessionEmptyEl.hidden = false;
    return;
  }
  sessionEmptyEl.hidden = true;
  sessions.forEach((s, i) => {
    const score = s.grade ? s.grade.score : null;
    const row = sessionRow(s, i, before.has(s.id) && before.get(s.id) === score);
    if (open.has(s.id)) row.classList.add('open');
    shownGrades.set(s.id, score);
    sessionListEl.append(row);
  });
  annotateSessionMvps();   // matches may have loaded first
}

// ── Top Agents ────────────────────────────────────────────────────────────────
const agentTilesEl = document.getElementById('agent-tiles');
const agentEmptyEl = document.getElementById('agent-empty');

// Agent portraits from the official Valorant asset API, cached for 7 days.
// Offline or blocked, tiles fall back to a lettered badge and stay clean.
let agentIconMap = null;
async function loadAgentIcons() {
  if (agentIconMap) return agentIconMap;
  try {
    const cached = JSON.parse(localStorage.getItem('agentIcons2') || 'null');
    if (cached && cached.map && Date.now() - cached.at < 7 * 24 * 3600000) return (agentIconMap = cached.map);
  } catch {}
  try {
    const r = await fetch('https://valorant-api.com/v1/agents?isPlayableCharacter=true');
    const j = await r.json();
    const map = {};
    for (const a of (j && j.data) || []) {
      map[String(a.displayName).toLowerCase()] = { icon: a.displayIcon, portrait: a.fullPortrait };
    }
    localStorage.setItem('agentIcons2', JSON.stringify({ at: Date.now(), map }));
    return (agentIconMap = map);
  } catch {
    return (agentIconMap = {});
  }
}

function agentLetterBadge(name) {
  const s = document.createElement('span');
  s.className = 'agent-icon letter';
  s.textContent = (name || '?').slice(0, 1).toUpperCase();
  return s;
}

// What Top agents is drawn from, kept so the match list landing after the
// dashboard (or the other way round) draws it again from the newest of both.
const agentFeed = { top: [], matches: [], sessions: [], riot: true };
let agentSeq = 0;

/**
 * Top agents, never saying "play a few matches" over matches that are there.
 * Riot's profile first; with none from it, the match list on this page counted
 * by agent (stats-profile.js agents); with neither, a line that agrees with
 * what the page does show: graded matches named, a Riot ID asked for.
 */
function agentsEmptyLine() {
  const graded = (agentFeed.sessions || []).some((s) => s && typeof s.title === 'string' && s.title.trim());
  if (!agentFeed.riot) return 'Connect your Riot ID in Settings to see your agent numbers here.';
  if (graded) return 'Your agent numbers come from Riot\'s record, which has none for this queue yet.';
  return 'Play a few matches to see your most played agents here.';
}

function renderAgents(d) {
  if (d && typeof d === 'object') {
    if ('topAgents' in d) agentFeed.top = Array.isArray(d.topAgents) ? d.topAgents : [];
    if (d.matches && Array.isArray(d.matches.matches)) agentFeed.matches = d.matches.matches;
    if (Array.isArray(d.sessions)) agentFeed.sessions = d.sessions;
    if (typeof d.riotConnected === 'boolean') agentFeed.riot = d.riotConnected;
  }
  const list = agentFeed.top.length ? agentFeed.top
    : (StatsProfile ? StatsProfile.agents(agentFeed.matches) : []);
  return drawAgents(list);
}

async function drawAgents(list) {
  const seq = ++agentSeq;
  agentTilesEl.innerHTML = '';
  agentEmptyEl.textContent = agentsEmptyLine();
  agentEmptyEl.hidden = list.length > 0;
  if (!list.length) return;
  const icons = await loadAgentIcons();
  if (seq !== agentSeq) return;   // drawn again while the icons loaded
  list.forEach((a, i) => {
    const tile = document.createElement('div');
    tile.className = 'agent-tile';
    const entry = icons[String(a.name || '').toLowerCase()];
    const url = entry && entry.icon;
    let icon;
    if (url) {
      icon = document.createElement('img');
      icon.className = 'agent-icon';
      icon.src = url;
      icon.alt = a.name;
      icon.onerror = () => icon.replaceWith(agentLetterBadge(a.name));
    } else {
      icon = agentLetterBadge(a.name);
    }
    const info = document.createElement('div');
    info.className = 'agent-info';
    const nm = document.createElement('div');
    nm.className = 'agent-name';
    nm.textContent = a.name || 'Unknown';
    const chips = document.createElement('div');
    chips.className = 'agent-chips';
    // How often the agent was played, in the row's numbers, said once.
    const count = document.createElement('span');
    count.className = 'agent-chip played';
    count.textContent = `${a.matches} ${a.matches === 1 ? 'match' : 'matches'} · ${a.pct}%`;
    count.title = `${a.pct}% of your recent games`;
    chips.append(count);
    const wr = document.createElement('span');
    wr.className = `agent-chip ${a.winRate >= 55 ? 'good' : a.winRate <= 45 ? 'bad' : 'mid'}`;
    wr.textContent = `${a.winRate}% WR`;
    const kd = document.createElement('span');
    kd.className = `agent-chip ${a.kd >= 1.1 ? 'good' : a.kd < 0.9 ? 'bad' : 'mid'}`;
    kd.textContent = `${a.kd} KD`;
    const acs = document.createElement('span');
    acs.className = `agent-chip ${a.acs >= 220 ? 'good' : a.acs < 150 ? 'bad' : 'mid'}`;
    acs.textContent = `${a.acs} ACS`;
    // Counted from the match list, a number no match carried is left out.
    chips.append(wr);
    if (a.kd != null) chips.append(kd);
    if (a.acs != null) chips.append(acs);
    info.append(nm, chips);
    tile.append(icon, info);
    tile.style.animationDelay = Math.min(i, 8) * 40 + 'ms';
    agentTilesEl.append(tile);
  });
}

// ── Your numbers, Maps, Acts ──────────────────────────────────────────────────
// What the profile and the match list already carry and the page did not show
// (shared/stats-profile.js reads it safely). The combat score is the lead,
// K/D and damage beside it, the per round numbers a ruled list, the shot split
// one bar in the ink's three strengths, never a colour per part. Maps are
// counted from the match list of this queue, acts come from Riot's record.
// The player's own numbers only; a section with nothing in it is hidden.
const StatsProfile = window.StatsProfile || null;
const queueWord = () => (matchMode === 'unrated' ? 'unrated and swiftplay' : 'competitive');
const fmtNum = (v, digits) => (v == null ? '·' : (digits ? Number(v).toFixed(digits) : String(Math.round(v))));

/*
 * MOTION (8.9.2, shared/motion.js), once per visit of the page and only once
 * it is on screen, keyed on the host that stays, so a refresh of the numbers
 * (a mode switch, a Refresh) paints them as they are. Nothing under reduced
 * motion. fn returns what takes the classes off again once played.
 */
const M = window.Motion || null;
function entrance(host, key, fn) {
  if (!M || !host || !M.once(host, key) || M.reduced()) return;
  M.whenShown(() => {
    if (M.reduced()) return;
    const undo = fn();
    if (typeof undo === 'function') setTimeout(undo, 800 + 120);
  });
}

function leadItem(label, value, lead) {
  const el = document.createElement('div');
  el.className = 'nl-item' + (lead ? ' lead' : '');
  const v = document.createElement('span');
  v.className = 'nl-val' + (value === '·' ? ' none' : '');
  v.textContent = value;
  const l = document.createElement('span');
  l.className = 'nl-label';
  l.textContent = label;
  el.append(v, l);
  return el;
}

function ruledRow(label, value) {
  const row = document.createElement('div');
  row.className = 'nr-row';
  const l = document.createElement('span');
  l.className = 'nr-label';
  l.textContent = label;
  const v = document.createElement('span');
  v.className = 'nr-val' + (value === '·' ? ' none' : '');
  v.textContent = value;
  row.append(l, v);
  return row;
}

function renderNumbers(d) {
  const sec = document.getElementById('sec-numbers');
  if (!sec) return;
  const n = StatsProfile ? StatsProfile.numbers(d && d.profile) : null;
  sec.hidden = !n;
  if (!n) return;
  document.getElementById('numbers-span').textContent =
    `Averages over your last ${n.matches} ${queueWord()} ${n.matches === 1 ? 'match' : 'matches'}`;
  const lead = document.getElementById('numbers-lead');
  lead.replaceChildren(
    leadItem('Combat score a round', fmtNum(n.acs), true),
    leadItem('K/D', fmtNum(n.kd, 2)),
    leadItem('Damage a round', fmtNum(n.adr)),
  );
  // The three results count up once per visit, each ending on the text it was
  // painted with (fmtNum's digits), tabular so the width holds still.
  entrance(lead, 'count', () => {
    const vals = [[n.acs, 0], [n.kd, 2], [n.adr, 0]];
    const counted = [];
    [...lead.querySelectorAll('.nl-val')].forEach((v, i) => {
      const [x, digits] = vals[i] || [];
      if (x == null || !Number.isFinite(Number(x))) return;
      if (!digits) {
        // A whole number: counted in CSS over its real text (stats.css .m-counting).
        v.style.setProperty('--to', fmtNum(x));
        v.classList.add('m-counting');
        counted.push(v);
      } else {
        M.countUp(v, Number(x), { format: (k) => fmtNum(k, digits) });
      }
    });
    return () => counted.forEach((v) => v.classList.remove('m-counting'));
  });
  const list = document.getElementById('numbers-list');
  list.replaceChildren(
    ruledRow('Kills a round', fmtNum(n.kpr, 2)),
    ruledRow('Deaths a round', fmtNum(n.dpr, 2)),
    ruledRow('Assists a round', fmtNum(n.apr, 2)),
  );
  const shots = document.getElementById('numbers-shots');
  shots.replaceChildren();
  shots.hidden = !n.shots;
  if (!n.shots) return;
  const head = document.createElement('div');
  head.className = 'shots-head';
  head.textContent = 'Where your shots land';
  const bar = document.createElement('div');
  bar.className = 'shots-bar';
  bar.setAttribute('role', 'img');
  bar.setAttribute('aria-label', `Head ${n.shots.head}%, body ${n.shots.body}%, legs ${n.shots.legs}%`);
  const key = document.createElement('div');
  key.className = 'shots-key';
  for (const [part, label] of [['head', 'Head'], ['body', 'Body'], ['legs', 'Legs']]) {
    const v = n.shots[part];
    if (v > 0) {
      const seg = document.createElement('span');
      seg.className = `shots-seg sh-${part}`;
      seg.style.width = v + '%';
      bar.append(seg);
    }
    const k = document.createElement('span');
    k.className = `shots-k sh-${part}`;
    const sw = document.createElement('span');
    sw.className = 'sw';
    const t = document.createElement('span');
    t.textContent = `${label} ${v}%`;
    k.append(sw, t);
    key.append(k);
  }
  shots.append(head, bar, key);
  // The split fills from the left once per visit (stats.css .sh-fill).
  entrance(shots, 'fill', () => {
    const b = shots.querySelector('.shots-bar');
    if (!b) return null;
    b.classList.add('sh-fill');
    return () => b.classList.remove('sh-fill');
  });
}

/** One row of a ledger: cells in the order of the head, the first one a name,
 *  `words` the indexes of cells that are words (a rank), not numbers. */
function ledgerRow(cells, head, words) {
  const row = document.createElement('div');
  row.className = 'lg-row' + (head ? ' lg-head' : '');
  row.setAttribute('role', 'row');
  cells.forEach((c, i) => {
    const cell = document.createElement('span');
    cell.className = 'lg-cell' + (i === 0 ? ' name' : '') + (words && words.includes(i) ? ' word' : '') + (c === '·' ? ' none' : '');
    cell.setAttribute('role', head ? 'columnheader' : 'cell');
    cell.textContent = c;
    row.append(cell);
  });
  return row;
}

function renderMaps(matches) {
  const sec = document.getElementById('sec-maps');
  if (!sec) return;
  const list = Array.isArray(matches) ? matches : [];
  const rows = StatsProfile ? StatsProfile.byMap(list) : [];
  sec.hidden = !rows.length;
  if (!rows.length) return;
  const counted = rows.reduce((s, r) => s + r.played, 0);
  document.getElementById('maps-span').textContent =
    `From your last ${counted} ${queueWord()} ${counted === 1 ? 'match' : 'matches'}`;
  const table = document.getElementById('maps-table');
  table.replaceChildren(ledgerRow(['Map', 'Played', 'Won', 'K/D', 'ACS'], true));
  for (const r of rows) {
    table.append(ledgerRow([r.map, String(r.played), String(r.won), fmtNum(r.kd, 2), fmtNum(r.acs)]));
  }
  // The rows rise once per visit, --stagger apart, six at most (motion.css).
  if (M) M.stagger(table, 'rows');
}

function renderActs(d) {
  const sec = document.getElementById('sec-acts');
  if (!sec) return;
  const rows = StatsProfile ? StatsProfile.acts(d && d.profile && d.profile.acts) : [];
  sec.hidden = !rows.length;
  if (!rows.length) return;
  const table = document.getElementById('acts-table');
  table.replaceChildren(ledgerRow(['Act', 'Rank', 'Wins', 'Games', 'Win rate'], true, [1]));
  for (const a of rows) {
    table.append(ledgerRow([a.season, a.rank || '·', a.wins == null ? '·' : String(a.wins),
      a.games == null ? '·' : String(a.games), a.winRate == null ? '·' : a.winRate + '%'], false, [1]));
  }
  if (M) M.stagger(table, 'rows');
}

// The whole dashboard follows the mode toggle: overview numbers, agent tiles,
// and the match list all re-pull for the selected queue.
let dashSeq = 0;
async function refreshDashboardForMode(mode, force) {
  const seq = ++dashSeq;
  try {
    const d = await window.occlara.getDashboard(mode, !!force);
    if (!d || seq !== dashSeq || mode !== matchMode) return;   // superseded
    renderCards(d);
    renderNumbers(d);
    renderAgents(d);
    renderActs(d);
  } catch {}
}

// A skeleton for the overview cards so a cold open (which waits on a live
// tracker fetch) reads as loading rather than frozen. Cleared by renderCards.
function showCardSkeleton() {
  cardsEl.innerHTML = '';
  for (let i = 0; i < 6; i++) {
    const s = document.createElement('div');
    s.className = 'card skeleton';
    cardsEl.append(s);
  }
}

// ── Boot ──────────────────────────────────────────────────────────────────────
/**
 * Show the whole dashboard, or the "no stats for this game" panel instead.
 *
 * Every section below the header is Valorant shaped: a Valorant rank ladder,
 * agent tiles, and a competitive/unrated split that only Valorant has. Painting
 * them under another game is not a cosmetic mismatch, it is showing one game's
 * numbers while naming a different game.
 */
function showDashboard(on) {
  for (const id of ['sec-overview', 'sec-agents', 'sec-matches', 'sec-sessions']) {
    const el = document.getElementById(id);
    if (el) el.hidden = !on;
  }
  // Shown by their own renders, and only with something in them.
  if (!on) {
    for (const id of ['sec-numbers', 'sec-maps', 'sec-acts']) {
      const el = document.getElementById(id);
      if (el) el.hidden = true;
    }
  }
  const ns = document.getElementById('nostats');
  if (ns) ns.hidden = on;
}

async function load() {
  showCardSkeleton();
  matchEmptyEl.hidden = false;
  matchEmptyEl.textContent = 'Loading matches...';
  try {
    const d = await window.occlara.getDashboard(matchMode);
    if (!d) return;

    // A game with no stats source says so and stops. It must never fall through
    // to the render calls below, which would paint the Valorant tracker's last
    // response under whatever game is now selected.
    if (d.statsSupported === false) {
      const label = d.gameLabel || 'This game';
      document.getElementById('nostats-title').textContent = label + ' stats';
      document.getElementById('nostats-body').textContent =
        'Occlara has no stats source for ' + label + ' yet, so there is nothing here to show. '
        + 'Rank and match history need a connection this app does not have yet. '
        + 'Switch to Valorant in Settings for the full dashboard.';
      showDashboard(false);
      return;
    }
    showDashboard(true);

    renderCards(d);
    renderNumbers(d);
    renderMatches(d.matches);
    renderAgents(d);
    renderActs(d);
    renderSessions(d);
  } catch (e) {
    console.error('[stats] load failed', e);
  }
}

/*
 * A REVIEW SAVED WHILE THIS WINDOW IS OPEN lands in Graded matches without
 * reopening it. It used to wait on a 4 second poll that only ran while the
 * dashboard reported a grade in flight, and the dashboard never reports one
 * (grading is always null since reviews are saved when the match ends), so a
 * Stats window left open on a second monitor never showed the match just
 * played.
 *
 * Only that list is repainted. The tracker sections did not change, and a
 * skeleton over them on every save reads as the dashboard reloading for
 * nothing. A Valorant review is saved again every time Riot's record improves
 * it, so a burst of pushes is folded into one fetch, and the sequence number
 * drops an older answer that lands after a newer one.
 */
let reviewsTimer = null;
let reviewsSeq = 0;
async function refreshSessions() {
  const seq = ++reviewsSeq;
  try {
    const d = await window.occlara.getDashboard(matchMode);
    // A dashboard that failed comes back as { ok: false, error } from
    // safeHandle, with no sessions in it. renderSessions reads a missing list as
    // an empty library, so painting it would wipe the graded matches already on
    // screen and show "no graded matches" over a hiccup. Keep what is there.
    if (!d || seq !== reviewsSeq || d.statsSupported === false || !Array.isArray(d.sessions)) return;
    renderSessions(d);
    renderAgents(d);   // its empty line names graded matches
  } catch {}
}
if (window.occlara.onReviews) {
  window.occlara.onReviews(() => {
    clearTimeout(reviewsTimer);
    reviewsTimer = setTimeout(refreshSessions, 400);
  });
}

document.getElementById('weekly').addEventListener('click', () => window.occlara.openWeekly());
document.getElementById('ailog').addEventListener('click', () => window.occlara.openAiLog());
// A page of the main window has no window of its own to close.
document.getElementById('close').addEventListener('click', () => {
  if (!(window.occlaraEmbedded && window.occlaraEmbedded())) window.close();
});

// Follow a Riot ID switch made in Settings while this window is open: the
// tracker caches are already cleared in main, so wipe the local match/RR
// caches, snap back to Competitive, and reload every panel from the new
// account. Guarded so the frequent state pushes during coaching are no-ops.
let lastSeenRiot = null;
window.occlara.onState((s) => {
  if (!s || typeof s.riotId !== 'string') return;
  if (lastSeenRiot === null) { lastSeenRiot = s.riotId; return; }
  if (s.riotId === lastSeenRiot) return;
  lastSeenRiot = s.riotId;
  knownMatches.clear();
  rrPointsCache = null;
  matchMode = 'competitive';
  for (const b of modeSeg.querySelectorAll('button')) b.classList.toggle('active', b.dataset.mode === 'competitive');
  load();
  if (rankOpen) renderRankGraph(rankNotesEl, { force: true });
});

// Follow a game switch made in Settings while this window is open. Main has
// already stopped any running session and cleared every tracker cache, so this
// only has to drop what the renderer itself is holding and reload.
//
// This is the bug the channel exists for: PUSH_STATE has always carried gameId,
// but the handler above only diffs riotId, so switching to League left a
// Valorant rank, a Valorant agent list and Valorant matches on screen.
window.occlara.onGame(() => {
  knownMatches.clear();
  rrPointsCache = null;
  matchMode = 'competitive';
  for (const b of modeSeg.querySelectorAll('button')) b.classList.toggle('active', b.dataset.mode === 'competitive');
  closeRankNotes(true);
  journeyWanted = false;   // the journey asked for was the last game's
  shownRank = undefined;
  load();
});

// What Home opened this page for: asked as it loads, and as it is about to
// be shown again or comes in (showJourney, above).
if (typeof window.occlara.onPage === 'function') {
  window.occlara.onPage((m) => { if (m && (m.phase === 'arm' || m.phase === 'enter')) askOpenedFor(); });
}
askOpenedFor();
load();
console.log('[stats] ready');

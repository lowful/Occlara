'use strict';

/*
 * PLAYERS (docs/claude/social.md): search, results, and one profile.
 *
 * Every line is main's (src/shared/social.js through the preload): this page
 * counts nothing, and sets every string as text. The art is the bundled
 * files the preload names (agent-icons.js), a picture that fails to load is
 * taken away. Main answers null mid match or sealed, when the seal hides this
 * page, so nothing here is ever on screen during a match.
 */

const $ = (id) => document.getElementById(id);
const api = window.occlara || {};

const SAID = {
  offline: 'Occlara could not reach its server. Check your connection and try again.',
  'signed-out': 'Sign in to an Occlara account to search for players and see their profiles.',
  'not-live': 'Player search is not open yet. It turns on with an Occlara update soon.',
  busy: 'Too many searches in a short time. Wait a minute and try again.',
  failed: 'Something went wrong on our side. Try again in a moment.',
  short: 'Type at least 3 letters of a username.',
  shortRiot: 'Type at least 3 letters of a username, or a whole Riot ID as Name#TAG.',
  empty: 'No public profile matches that. A player shows here only once they make their profile public.',
  emptyRiot: 'No public profile matches that. A player shows here only once they make their profile public, and is found by Riot ID only once they proved it is theirs.',
  searching: 'Searching',
  opening: 'Opening the profile',
  'not-found': 'This profile is not available. It may be private now, or its username may have changed.',
};

let ask = 0;
let lastQuery = '';
let current = null;       // the profile on screen
let reason = null;        // the report's reason picked
let segReady = false;

function stateLine(word, action) {
  const box = $('pl-state');
  box.hidden = !word;
  $('pl-state-line').textContent = word ? (SAID[word] || word) : '';
  const b = $('pl-state-act');
  b.hidden = !action;
  b.textContent = action ? action.label : '';
  b.onclick = action ? action.fn : null;
}

const assetUrl = (rel) => (typeof rel === 'string' && /^valorant\/(agents|maps)\/[A-Za-z0-9]+\.(png|jpg)$/.test(rel) ? `../../../assets/${rel}` : null);
function picture(rel, alt, cls) {
  const src = assetUrl(rel);
  if (!src) return null;
  const img = document.createElement('img');
  img.src = src;
  img.alt = alt || '';
  img.className = cls;
  img.addEventListener('error', () => img.remove());
  return img;
}
const agentArt = (name) => (name && typeof api.agentArt === 'function' ? api.agentArt(name) : null);
const mapArt = (name) => (name && typeof api.mapArt === 'function' ? api.mapArt(name) : null);

function showFind() {
  $('pl-find').hidden = false;
  $('pl-view').hidden = true;
  current = null;
}
function showView() {
  $('pl-find').hidden = true;
  $('pl-view').hidden = false;
}

// ── Search ─────────────────────────────────────────────────────────────────
function paintResults(list) {
  const ul = $('pl-results');
  ul.replaceChildren(...list.map((r, i) => {
    const li = document.createElement('li');
    li.className = 'pl-result rise-in';
    li.style.setProperty('--i', String(Math.min(i, 8)));
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'pl-result-btn';
    const face = picture(agentArt(r.agent), '', 'pl-face');
    const who = document.createElement('span');
    who.className = 'pl-who';
    const name = document.createElement('span');
    name.className = 'pl-name';
    name.textContent = r.username;
    who.append(name);
    if (r.riot) {
      const riot = document.createElement('span');
      riot.className = 'pl-riot';
      riot.textContent = r.riot;
      who.append(riot);
    }
    const line = document.createElement('span');
    line.className = 'pl-line';
    line.textContent = r.line;
    if (face) b.append(face); else b.append(Object.assign(document.createElement('span'), { className: 'pl-face none' }));
    b.append(who, line);
    b.setAttribute('aria-label', [r.username, r.riot, r.line].filter(Boolean).join(', '));
    b.addEventListener('click', () => open(r.username));
    li.append(b);
    return li;
  }));
  ul.hidden = !list.length;
}

async function search(e) {
  if (e) e.preventDefault();
  const q = $('pl-q').value.trim();
  if (!q) return;
  const mine = ++ask;
  lastQuery = q;
  $('pl-go').disabled = true;
  stateLine('searching');
  $('pl-results').hidden = true;
  const r = typeof api.search === 'function' ? await Promise.resolve(api.search(q)).catch(() => ({ ok: false, error: 'offline' })) : null;
  if (mine !== ask) return;
  $('pl-go').disabled = false;
  if (!r) { stateLine(null); return; }
  if (!r.ok) { problem(r.error, () => search()); return; }
  paintResults(r.results);
  stateLine(r.results.length ? null : 'empty');
}

function problem(word, retry) {
  if (word === 'signed-out') return stateLine('signed-out', { label: 'Sign in', fn: signIn });
  if (word === 'offline' || word === 'failed' || word === 'busy') return stateLine(word, retry ? { label: 'Try again', fn: retry } : null);
  return stateLine(word);
}

async function signIn() {
  if (typeof api.signIn !== 'function') return;
  const r = await Promise.resolve(api.signIn()).catch(() => null);
  if (r && r.ok) boot();
}

// ── One profile ────────────────────────────────────────────────────────────
function row(cls, parts) {
  const li = document.createElement('li');
  li.className = `pl-row ${cls || ''}`.trim();
  for (const p of parts) if (p) li.append(p);
  return li;
}
const span = (cls, text) => Object.assign(document.createElement('span'), { className: cls, textContent: text == null ? '' : String(text) });

function paintProfile(p) {
  current = p;
  $('pv-name').textContent = p.username;
  $('pv-riot').textContent = p.riot || p.riotNote || '';
  $('pv-riot').classList.toggle('none', !p.riot);
  $('pv-verified').textContent = p.riot ? (p.riotNote || '') : '';
  $('pv-verified').hidden = !p.riot;
  $('pv-private').textContent = p.privateNote || '';
  $('pv-private').hidden = !p.privateNote;
  const face = $('pv-face');
  const main = p.agents[0] ? p.agents[0].name : null;
  const img = picture(agentArt(main), main || '', 'pv-face-img');
  face.replaceChildren(...(img ? [img] : []));
  face.hidden = !img;

  $('pv-rank').textContent = p.rank ? p.rank.current : 'No rank';
  $('pv-rank').classList.toggle('dim', !p.rank);
  $('pv-peak').textContent = p.rank && p.rank.peak ? `Peak ${p.rank.peak}` : '';
  // One rank, and where it comes from: the server's for a proved Riot ID, else the player's own PC.
  $('pv-rank-src').textContent = p.rank ? p.rank.label : '';
  $('pv-rank-src').classList.toggle('verified', !!(p.rank && p.rank.label === 'Verified'));
  $('pv-grade').textContent = p.grade ? p.grade.avg : '-';
  $('pv-letter').textContent = p.grade ? p.grade.letter : '';
  $('pv-grade-n').textContent = p.grade ? p.grade.sample : 'No graded match yet';
  $('pv-record').textContent = p.record || '-';
  $('pv-matches').textContent = p.matches || '';
  $('pv-kd').textContent = p.kd || '-';
  $('pv-hs').textContent = p.hs || '-';
  $('pv-title').textContent = p.title || '-';
  $('pv-title').classList.toggle('dim', !p.title);
  $('pv-empty').textContent = p.empty || '';
  $('pv-empty').hidden = !p.empty;

  $('pv-agents').replaceChildren(...p.agents.map((a) => row('pv-agent', [picture(agentArt(a.name), '', 'pl-face'), span('pl-name', a.name), span('pl-line', a.line)])));
  $('pv-maps').replaceChildren(...p.maps.map((m) => row('pv-map', [picture(mapArt(m.name), '', 'pv-map-img'), span('pl-name', m.name), span('pl-line', m.line)])));
  $('pv-mains').hidden = !p.agents.length && !p.maps.length;
  $('pv-recent').replaceChildren(...p.recent.map((r) => row(`pv-match ${r.r === 'W' ? 'win' : r.r === 'L' ? 'loss' : 'draw'}`, [
    span('pv-res', r.word), picture(agentArt(r.agent), '', 'pl-face sm'), span('pl-name', r.agent || 'Agent not known'),
    span('pl-line', r.map || ''), span('pv-g', r.grade || 'No grade')])));
  $('pv-form-sec').hidden = !p.recent.length;
  $('pv-multi').replaceChildren(...p.multi.map((m) => {
    const d = document.createElement('div');
    d.className = 'stat';
    d.append(Object.assign(document.createElement('b'), { className: 'stat-n', textContent: m.n }), span('pl-label', m.label));
    return d;
  }));
  $('pv-multi-sec').hidden = !p.multi.length;
  $('pv-from').textContent = p.fromPc || '';
  $('pv-from').hidden = !p.fromPc;
  $('pv-updated').textContent = p.updated || '';
  $('pv-acts').hidden = !!p.self;
  $('pv-report').hidden = true;
  $('pv-report-open').setAttribute('aria-expanded', 'false');
  $('pv-said').textContent = '';
  $('pv-block').disabled = false;
  setReason(null);
}

async function open(username) {
  const mine = ++ask;
  stateLine('opening');
  const r = typeof api.view === 'function' ? await Promise.resolve(api.view(username)).catch(() => ({ ok: false, error: 'offline' })) : null;
  if (mine !== ask) return;
  if (!r) { stateLine(null); return; }
  if (!r.ok) { showFind(); problem(r.error, () => open(username)); return; }
  stateLine(null);
  paintProfile(r.profile);
  showView();
  document.querySelector('.body').scrollTop = 0;
}

function setReason(v) {
  reason = v;
  for (const b of $('pv-reasons').querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.reason === v));
  $('pv-report-send').disabled = !v;
}

$('pv-back').addEventListener('click', () => { showFind(); $('pl-q').focus(); });
$('pv-block').addEventListener('click', async () => {
  if (!current || typeof api.block !== 'function') return;
  $('pv-block').disabled = true;
  const r = await Promise.resolve(api.block(current.username, true)).catch(() => null);
  $('pv-said').textContent = (r && r.line) || 'Could not block right now. Try again in a moment.';
  if (r && r.ok) {
    // Blocked: the profile is gone from this player's view at once.
    const said = r.line;
    const gone = current.username;
    showFind();
    const left = [...$('pl-results').children].filter((li) => { const n = li.querySelector('.pl-name'); return !n || n.textContent !== gone; });
    $('pl-results').replaceChildren(...left);
    $('pl-results').hidden = !left.length;
    stateLine(said);
  } else $('pv-block').disabled = false;
});
$('pv-report-open').addEventListener('click', () => {
  const open = $('pv-report').hidden;
  $('pv-report').hidden = !open;
  $('pv-report-open').setAttribute('aria-expanded', String(open));
  if (open && !segReady && typeof window.occlaraSeg === 'function') { segReady = true; window.occlaraSeg($('pv-reasons')); }
});
for (const b of $('pv-reasons').querySelectorAll('button')) b.addEventListener('click', () => setReason(b.dataset.reason));
$('pv-report-send').addEventListener('click', async () => {
  if (!current || !reason || typeof api.report !== 'function') return;
  $('pv-report-send').disabled = true;
  const r = await Promise.resolve(api.report(current.username, reason)).catch(() => null);
  $('pv-said').textContent = (r && r.line) || 'The report could not be sent. Try again in a moment.';
  if (r && r.ok) { $('pv-report').hidden = true; $('pv-report-open').setAttribute('aria-expanded', 'false'); setReason(null); }
  else $('pv-report-send').disabled = false;
});

$('pl-form').addEventListener('submit', search);

/** Opened at a profile (from Profile, or a link elsewhere): show it. */
async function takeOpen() {
  const name = typeof api.take === 'function' ? await Promise.resolve(api.take()).catch(() => null) : null;
  if (name) open(name);
}

/*
 * THE RIOT ID SEARCH is the server's to open (SOCIAL_RIOT_PROOF): closed, the
 * page speaks of usernames alone; open, of a whole Riot ID too.
 */
function paintProof(on) {
  $('pl-hint').textContent = on
    ? 'Search Occlara players who made their profile public, by the start of a username or by a whole Riot ID as Name#TAG.'
    : 'Search Occlara players who made their profile public, by the start of their username.';
  $('pl-q').placeholder = on ? 'Username or Name#TAG' : 'Username';
  $('pl-q-label').textContent = on ? 'Username or Riot ID' : 'Username';
  SAID.short = on ? SAID.shortRiot : 'Type at least 3 letters of a username.';
  SAID.empty = on ? SAID.emptyRiot : 'No public profile matches that. A player shows here only once they make their profile public.';
}

async function boot() {
  const s = typeof api.state === 'function' ? await Promise.resolve(api.state()).catch(() => ({ live: null, problem: 'offline' })) : null;
  if (!s) return;   // mid match: the seal hides this page
  paintProof(s.riotProof === true);
  const blocked = s.problem === 'not-live' || s.problem === 'signed-out' || s.problem === 'offline';
  $('pl-q').disabled = s.problem === 'not-live' || s.problem === 'signed-out';
  $('pl-go').disabled = $('pl-q').disabled;
  if (blocked) { showFind(); problem(s.problem, s.problem === 'offline' ? boot : null); return; }
  if (!lastQuery) stateLine(null);
  await takeOpen();
}

if (typeof api.onSocial === 'function') api.onSocial((m) => { if (m && m.open) takeOpen(); });
if (typeof api.onAccount === 'function') api.onAccount(() => boot());

boot().then(() => console.log('[players] ready')).catch(() => {});

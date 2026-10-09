'use strict';

/**
 * Welcome tour. Four short pages instead of one long list, because the old
 * single card asked the player to read five numbered steps and a settings
 * question before they could get to a match.
 *
 * Every choice saves the moment it is made, so closing the tour at any point
 * (button, ✕, Esc) keeps whatever was picked.
 */

const pages   = [...document.querySelectorAll('.page')];
const dotsEl  = document.getElementById('dots');
const backBtn = document.getElementById('back');
const nextBtn = document.getElementById('next');
let index = 0;
// THE RIOT ID PAGE IS ABOUT ONE RIOT ID: the one in the field. Connect
// connects one (connectedId, '' until it does), the line under the field is
// about one (statusAbout), and the run main pushes is for one (its account).
// Each shows only while the field holds its ID, compared without case as
// Riot compares them: Let's go, a line or rows about an ID the player has
// since edited away are about nothing they are looking at.
let connectedId = '';
let statusAbout = '';
let checking = false;
let lastBf = null;
// Whether the account that connected is known to exist: a profile came back,
// or Riot said it has no ranked one. A profile that could not be loaded
// connects without knowing.
let confirmed = false;
const sameId = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();

// Progress dots, clickable so the tour can be skimmed in either direction.
const dots = pages.map((_, i) => {
  const d = document.createElement('button');
  d.className = 'dot-nav';
  d.type = 'button';
  d.title = `Step ${i + 1}`;
  d.addEventListener('click', () => go(i));
  dotsEl.append(d);
  return d;
});

function go(next) {
  index = Math.max(0, Math.min(pages.length - 1, next));
  pages.forEach((p, i) => { p.hidden = i !== index; });
  dots.forEach((d, i) => {
    d.classList.toggle('active', i === index);
    d.classList.toggle('done', i < index);
  });
  backBtn.style.visibility = index === 0 ? 'hidden' : 'visible';
  // The last page finishes the tour. Until a Riot ID connects it says so
  // plainly: skipping is fine, and Settings connects one later.
  const last = index === pages.length - 1;
  const connected = isConnected();
  nextBtn.textContent = last ? (connected ? "Let's go" : 'Skip for now') : 'Next';
  // ONE RED BUTTON A PAGE. On the Riot ID page Connect is the action until a
  // Riot ID connects, so until then the footer is the quiet way out rather
  // than a second red button recommending the skip; after it, Let's go is.
  nextBtn.classList.toggle('btn-primary', !last || connected);
  connectBtn.classList.toggle('btn-primary', !connected);
}

backBtn.addEventListener('click', () => go(index - 1));
nextBtn.addEventListener('click', () => {
  if (index === pages.length - 1) window.occlara.done();
  else go(index + 1);
});

document.getElementById('close').addEventListener('click', () => window.occlara.done());
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') window.occlara.done();
  else if (e.key === 'Enter' || e.key === 'ArrowRight') nextBtn.click();
  else if (e.key === 'ArrowLeft') backBtn.click();
});

// ── Choices (each saves immediately) ────────────────────────────────────────

function wireSeg(seg, onPick) {
  seg.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    for (const b of seg.querySelectorAll('button')) b.classList.toggle('active', b === btn);
    onPick(btn.dataset.val);
  });
}

wireSeg(document.getElementById('advanced'), (v) => {
  window.occlara.setConfig({ advancedTips: v === 'on' }).catch(() => {});
});

// The Riot ID saves as it is typed, like Settings, so leaving the tour at any
// point keeps it.
const riotEl = document.getElementById('ob-riot');
let riotTimer = null;
riotEl.addEventListener('input', () => {
  clearTimeout(riotTimer);
  riotTimer = setTimeout(() => window.occlara.setConfig({ riotId: riotEl.value.trim() }).catch(() => {}), 500);
  // An edited Riot ID is not the one that connected: the page stops saying
  // Connected about it and asks for Connect again, until the field holds the
  // ID that connected again.
  syncRiot();
});

/** Connected, for the Riot ID in the field now. */
function isConnected() {
  return !!connectedId && sameId(connectedId, riotEl.value);
}

// ── Connect, and the grading that follows it ─────────────────────────────
// Connect tests the Riot ID, and main then grades the account's recent matches
// from Riot's record (backfill.js) and pushes every step. The grading carries
// on after the tour closes; Settings and Matches follow the same push.
const connectBtn = document.getElementById('ob-connect');
const statusEl = document.getElementById('ob-riot-status');
const bfBox = document.getElementById('ob-bf');
const bfLine = document.getElementById('ob-bf-line');
const bfList = document.getElementById('ob-bf-list');

// Enter in the field connects, and is never "next page".
riotEl.addEventListener('keydown', (e) => {
  e.stopPropagation();
  if (e.key === 'Enter') connectBtn.click();
});
// NOR IS ENTER ON THE CONNECT BUTTON. A button pressed with Enter clicks
// itself, and the window's Enter handler above would press Next as well,
// which on this page ends the tour: one keystroke would connect and close the
// page that reports on it.
connectBtn.addEventListener('keydown', (e) => { if (e.key === 'Enter') e.stopPropagation(); });

const STALE = 'Your Riot ID changed while it was being checked. Press Connect again.';
const PROFILE_NOT_LOADED = "Your rank could not be loaded right now. Your recent matches are being graded from Riot's record.";
const CONFIRMED_NO_RANK = 'Connected. Your rank could not be loaded right now.';

/**
 * The line under the field: tone true is good news, false a failure, null
 * neither. It is about the ID in the field when it is written, unless told
 * which.
 */
function showStatus(tone, text, about) {
  statusEl.textContent = text || '';
  statusEl.className = 'ob-riot-status' + (tone === true ? ' ok' : tone === false ? ' err' : '');
  statusAbout = about === undefined ? riotEl.value : about;
  syncRiot();
}

/** Show what is about the Riot ID now in the field, and nothing else. */
function syncRiot() {
  // "Checking" stays up through an edit: the answer says the ID changed.
  statusEl.hidden = !statusEl.textContent || !(checking || sameId(statusAbout, riotEl.value));
  bfBox.hidden = !(lastBf && lastBf.state !== 'idle' && sameId(lastBf.account, riotEl.value));
  go(index);
}

/** "Connected, Gold 2.", from the profile Riot answered with. */
function connectedLine(stats) {
  return `Connected${stats && stats.rank ? `, ${stats.rank}` : ''}.`;
}

connectBtn.addEventListener('click', async () => {
  const id = riotEl.value.trim();
  const at = id.indexOf('#');
  if (at < 1 || at === id.length - 1) { showStatus(false, 'Enter your Riot ID as Name#TAG.'); return; }
  clearTimeout(riotTimer);
  connectBtn.disabled = true;
  connectBtn.textContent = 'Connecting';
  checking = true;
  showStatus(null, 'Checking your account.', id);
  let res = null;
  try {
    await window.occlara.setConfig({ riotId: id });
    res = await window.occlara.testTracker();
  } catch {
    res = null;
  }
  checking = false;
  connectBtn.disabled = false;
  connectBtn.textContent = 'Connect';
  connectedId = '';
  if ((res && res.stale) || !sameId(riotEl.value, id)) {
    // THE ANSWER IS ABOUT THE ID THAT WAS CHECKED, and the field saves as it
    // is typed, so it may hold another by now. Main refuses that itself; an
    // edit in the half second before the field saved is caught here.
    showStatus(false, (res && res.stale && res.error) || STALE);
  } else if (res && res.ok) {
    connectedId = id;
    confirmed = !res.profileError;
    // NOT A FAILED CONNECT. The profile could not be loaded right now (a rate
    // limit, the stats service down) and the grading started all the same.
    // The line claims nothing it did not see: no rank, and not "Connected",
    // since nothing has shown the account exists yet.
    if (res.profileError) showStatus(null, PROFILE_NOT_LOADED, id);
    else if (res.unranked) showStatus(true, 'Connected. No ranked profile on this account yet.', id);
    else showStatus(true, connectedLine(res.stats), id);
  } else {
    showStatus(false, (res && res.error) || 'Could not connect. Try again in a minute.', id);
  }
});

// Rows already painted once. Every push repaints the list, and without this
// every row would replay its entrance on every push, twice a match, so the
// list would blink while it worked. Only a row seen for the first time slides
// in.
const bfSeen = new Set();

/**
 * The matches graded so far, newest first, as main pushes them. Shown only
 * for the run of the Riot ID in the field (syncRiot): a run for another ID
 * is not this page's.
 */
function paintBackfill(s) {
  lastBf = s || null;
  // THE RUN SETTLES A CONNECT THAT NEVER SAW THE ACCOUNT. A profile that
  // could not be loaded connected without knowing the account exists. A run
  // that lists its matches proves it does, and the page says Connected. One
  // that ends in any error (no such account, Riot unreachable, the licence)
  // leaves it unproven: the page stops saying it connected, and the run's
  // own red line below says why. Only a not found used to, and a typo the
  // rate limit hid finished the tour looking connected.
  if (s && connectedId && !confirmed && sameId(s.account, connectedId)) {
    if (s.state === 'grading' || s.state === 'done') {
      confirmed = true;
      if (sameId(statusAbout, connectedId)) showStatus(true, CONFIRMED_NO_RANK, connectedId);
    } else if (s.state === 'error') {
      connectedId = '';
      if (sameId(statusAbout, s.account)) statusEl.textContent = '';
    }
  }
  if (!s || s.state === 'idle') { syncRiot(); return; }
  bfLine.textContent = s.message || '';
  bfLine.className = 'ob-bf-line' + (s.state === 'error' ? ' err' : '');
  bfList.replaceChildren();
  const done = (Array.isArray(s.items) ? s.items : [])
    .filter((x) => x.status === 'graded' || x.status === 'upgraded' || x.status === 'failed');
  // No rows yet is no list at all, rather than an empty bordered box.
  bfList.hidden = !done.length;
  for (const x of done.slice(0, 10)) {
    const row = document.createElement('div');
    const key = `${x.matchId}|${x.status}`;
    row.className = 'ob-bf-row' + (x.status === 'failed' ? ' failed' : '') + (bfSeen.has(key) ? ' settled' : '');
    bfSeen.add(key);
    row.setAttribute('role', 'listitem');
    const name = document.createElement('span');
    name.className = 'ob-bf-name';
    name.textContent = [x.map, x.agent].filter(Boolean).join('  ·  ') || 'Match';
    const res = document.createElement('span');
    res.className = 'ob-bf-res' + (/vict/i.test(x.result || '') ? ' win' : /defeat/i.test(x.result || '') ? ' loss' : '');
    res.textContent = x.status === 'failed' ? 'Not fetched' : [x.result, x.score].filter(Boolean).join(' ');
    const grade = document.createElement('span');
    const tone = x.grade && window.GradeView ? window.GradeView.gradeTone(x.grade) : '';
    grade.className = 'ob-bf-grade' + (tone ? ' ' + tone : '');
    grade.textContent = x.grade ? `${x.grade.score} ${x.grade.letter}` : '';
    if (x.grade && x.grade.provisional) grade.title = 'Provisional: some of the record was missing';
    row.append(name, res, grade);
    bfList.append(row);
  }
  syncRiot();
}
window.occlara.onBackfill(paintBackfill);
window.occlara.getBackfill().then(paintBackfill).catch(() => {});

// Reflect whatever is already saved, so re-running the tour never silently
// resets a choice the player made in Settings.
window.occlara.getConfig().then((cfg) => {
  if (!cfg) return;
  if (typeof cfg.riotId === 'string') riotEl.value = cfg.riotId;
  for (const b of document.getElementById('advanced').querySelectorAll('button')) {
    b.classList.toggle('active', (b.dataset.val === 'on') === (cfg.advancedTips === true));
  }
  // SHOWN AGAIN TO A CONNECTED PLAYER (a logout runs the tour again), the
  // Riot ID page is connected from the start, exactly as after a Connect: the
  // Riot ID in config has the profile Riot answered for it. Saying nothing
  // was connected sent a connected player to press Connect again.
  const id = String(cfg.riotId || '').trim();
  const stats = cfg.playerStats;
  if (id.includes('#') && stats && sameId(stats._riotId, id) && !connectedId && !checking) {
    connectedId = id;
    confirmed = true;
    showStatus(true, connectedLine(stats), id);
  } else if (id.includes('#') && sameId(cfg.riotConnected, id) && !connectedId && !checking) {
    // Shown to exist with no profile kept: no ranked one, or a profile that
    // could not be loaded when its matches were graded.
    connectedId = id;
    confirmed = true;
    showStatus(true, 'Connected.', id);
  } else {
    // The field was filled after the run's status may have arrived for it.
    syncRiot();
  }
}).catch(() => {});


// ── Language ────────────────────────────────────────────────────────────────
// Chosen on page one, so the rest of onboarding and every review that follows
// arrive in the player's language rather than being switched later.
const obLang = document.getElementById('ob-language');
const obLangNote = document.getElementById('ob-language-note');

function obShowNote(code) {
  if (!obLangNote || !window.occlara.i18n) return;
  const translated = window.occlara.i18n.hasUi(code);
  obLangNote.hidden = translated;
  if (!translated) {
    obLangNote.textContent =
      'Your reviews will be in this language. The app’s own buttons stay English for now.';
  }
}

if (obLang && window.occlara.i18n && window.Dropdown) {
  // The app's own dropdown, not a native <select>. This is the very first
  // screen a new player sees, and on Windows the native control drew a white
  // box in the middle of the dark card: the most obviously foreign thing in
  // the whole interface, on first run.
  window.occlara.getConfig().then((cfg) => {
    const current = (cfg && cfg.language) || 'en';
    window.Dropdown.create(obLang, {
      label: 'Language',
      value: current,
      options: window.occlara.i18n.languages().map((l) => ({
        value: l.code,
        label: l.name,
        tag: window.occlara.i18n.hasUi(l.code) ? '' : 'reviews only',
      })),
      onChange: async (code) => {
        await window.occlara.setConfig({ language: code });
        obShowNote(code);
        if (window.initI18n) window.initI18n();
      },
    });
    obShowNote(current);
  }).catch(() => {});
}

if (window.initI18n) window.initI18n().catch(() => {});

go(0);
console.log('[onboarding] ready');

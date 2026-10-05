'use strict';

function markSeg(seg, value) {
  for (const btn of seg.querySelectorAll('button')) {
    btn.classList.toggle('active', btn.dataset.val === value);
  }
}

function wireSeg(seg, key) {
  seg.addEventListener('click', async (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    markSeg(seg, btn.dataset.val);
    await window.occlara.setConfig({ [key]: btn.dataset.val });
  });
}

// Capture speed: 'auto', or a pinned gap in ms. Stored as the string the
// button carries, and read back the same way.
const speedSeg = document.getElementById('capturespeed');
speedSeg.addEventListener('click', async (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  markSeg(speedSeg, btn.dataset.val);
  const v = btn.dataset.val === 'auto' ? 'auto' : Number(btn.dataset.val);
  await window.occlara.setConfig({ captureSpeed: v }).catch(() => {});
});
const cadenceEl = document.getElementById('cadence-now');
function paintCadence(s) {
  if (!s) return;
  const on = s.isCoaching && typeof s.cadence === 'number';
  cadenceEl.hidden = !on;
  if (on) {
    const every = s.cadence < 1000 ? `${s.cadence}ms` : `${Math.round(s.cadence / 100) / 10}s`;
    cadenceEl.textContent = `Reading every ${every} right now${s.captureSpeed === 'auto' ? ', chosen automatically' : ''}.`;
  }
}

// Booleans under the hood, on/off buttons in the UI.
function wireBoolSeg(id, key) {
  const seg = document.getElementById(id);
  seg.addEventListener('click', async (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    markSeg(seg, btn.dataset.val);
    await window.occlara.setConfig({ [key]: btn.dataset.val === 'on' }).catch(() => {});
  });
  return seg;
}
const advancedSeg = wireBoolSeg('advanced', 'advancedTips');
const aiLogSeg    = wireBoolSeg('ailog', 'aiLog');
const soundsSeg   = wireBoolSeg('sounds', 'sounds');
// Capture quality is a VALUE segment, not a boolean: 'standard' or
// 'performance'. Naming the values rather than on/off keeps the meaning in the
// stored config, where a future third profile would slot in without a migration.
const captureSeg  = document.getElementById('capturequality');
wireSeg(captureSeg, 'captureQuality');

/**
 * Game picker, built from the shared registry rather than hand-written markup.
 *
 * The section stays hidden while only one game can be coached. A picker with a
 * single option is not a choice, and a picker whose second option does nothing
 * is worse: it would let someone select Marvel Rivals and then be coached by
 * the Valorant engine wearing a different palette. Games appear here only once
 * their coaching genuinely exists, or when devGames is set for development.
 */
const gamePickEl = document.getElementById('gamepick');
let gameDD = null;

/**
 * What a preview game's review is built from, as the row's tooltip. Every game
 * is reviewed after the match and shows nothing during one; what differs is
 * where the review's facts come from and what is not there yet, which is what
 * the preview label is about. Taken from games.js and the engine each game
 * starts: Rivals reads its hero from hero select and its end of match
 * scoreboard, League records the game in silence through Riot's own local
 * game data, and neither has a stats source.
 */
const GAME_NOTES = {
  rivals: 'Graded after every match from the end of match scoreboard. No stats page for this game yet.',
  lol: 'Recorded in silence and graded after every game. No stats page for this game yet.',
};

/**
 * Which game is being coached, in the HEADER.
 *
 * It used to be a segmented control in a section partway down the page, which
 * put the one setting that changes the meaning of most of the others behind a
 * scroll. As the game list grows a row of segments also stops fitting, where a
 * dropdown does not.
 *
 * Hidden outright when there is a single game: one option is not a choice, and
 * a control that always says "Valorant" is furniture.
 */
function buildGamePicker(current, includeUnavailable) {
  if (!gamePickEl || !window.occlara.games || !window.Dropdown) return;
  const games = window.occlara.games.list(includeUnavailable);
  if (games.length < 2) { gamePickEl.hidden = true; return; }
  gamePickEl.hidden = false;

  const opts = games.map((g) => ({
    value: g.id,
    label: g.label,
    // A game that is only partly finished says so plainly rather than hiding
    // behind a colour. The label is the registry's own preview flag, and the
    // note says what its review is made from. It used to say "Coaching for this
    // game is not built yet" about Rivals and League, which Start records and
    // grades, and that "the look and layout are real", about palettes that are
    // gone. Only a game Start would refuse is called unbuilt.
    tag: g.preview || !g.coaching ? 'preview' : '',
    note: !g.coaching ? 'Recording is not built for this game yet. Start will say so and do nothing.'
      : (GAME_NOTES[g.id] || ''),
  }));

  if (!gameDD) {
    gameDD = window.Dropdown.create(gamePickEl, {
      label: 'Game',
      options: opts,
      value: current,
      onChange: (id) => window.occlara.setConfig({ game: id }).catch(() => {}),
    });
  } else {
    gameDD.setOptions(opts, true).setValue(current);
  }
}

// ── Version + update state ──────────────────────────────────────────────────
// So it is obvious which build is running and whether an update already landed,
// instead of having to guess after a release.
const UPDATE_TEXT = {
  checking:    'checking for updates...',
  current:     'up to date',
  downloading: (v) => `downloading ${v}...`,
  ready:       (v) => `${v} ready, restart to apply`,
  offline:     'could not reach the update server',
  dev:         'dev build',
  idle:        '',
};
function paintVersion(info) {
  if (!info) return;
  const vEl = document.getElementById('version');
  const sEl = document.getElementById('update-state');
  vEl.textContent = 'Version ' + (info.current || '?');
  const t = UPDATE_TEXT[info.state];
  sEl.textContent = typeof t === 'function' ? t(info.version || '') : (t || '');
  sEl.classList.toggle('ok', info.state === 'current');
  sEl.classList.toggle('new', info.state === 'ready' || info.state === 'downloading');
}
window.occlara.getVersion().then(paintVersion).catch(() => {});
// Clicking the line forces a fresh check, so the player can confirm on demand.
document.getElementById('version').addEventListener('click', () => {
  paintVersion({ current: null, state: 'checking' });
  window.occlara.getVersion().then((cur) => {
    paintVersion({ ...cur, state: 'checking' });
    return window.occlara.checkUpdate();
  }).then(paintVersion).catch(() => {});
});

document.getElementById('open-ailog').addEventListener('click', () => window.occlara.openAiLog());

// Riot ID: save on change/blur (debounced enough for a text field).
const riotEl = document.getElementById('riotid');
let riotTimer = null;
riotEl.addEventListener('input', () => {
  clearTimeout(riotTimer);
  riotTimer = setTimeout(() => window.occlara.setConfig({ riotId: riotEl.value.trim() }).catch(() => {}), 500);
});

// Connect: save the ID, test the tracker link live, show exactly what happened.
const trkBtn = document.getElementById('trk-connect');
const trkStatus = document.getElementById('trk-status');
function showTrk(ok, msg) {
  trkStatus.className = `trk-status ${ok ? 'ok' : 'err'}`;
  trkStatus.textContent = msg;
  trkStatus.hidden = false;
}
trkBtn.addEventListener('click', async () => {
  trkBtn.classList.add('busy');
  trkBtn.textContent = 'Connecting';
  showTrk(true, 'Checking your tracker profile...');
  trkStatus.className = 'trk-status';
  try {
    await window.occlara.setConfig({ riotId: riotEl.value.trim() });
    const res = await window.occlara.testTracker();
    if (res && res.ok && res.stats) {
      const s = res.stats;
      const bits = [`rank ${s.rank || 'unknown'}`];
      if (s.peakRank) bits.push(`peak ${s.peakRank}`);
      if (s.kd) bits.push(`K/D ${s.kd}`);
      if (s.kpr != null) bits.push(`${s.kpr} kills/round`);
      if (s.adr) bits.push(`ADR ${s.adr}`);
      if (s.acs) bits.push(`ACS ${s.acs}`);
      if (s.headshotPct) bits.push(`HS ${s.headshotPct}%`);
      showTrk(true, `Connected. ${bits.join(', ')}. Your reviews now use Riot's record of each match.`);
    } else {
      showTrk(false, (res && res.error) || 'Could not connect. Try again in a minute.');
    }
  } catch {
    showTrk(false, 'Could not connect. Try again in a minute.');
  } finally {
    trkBtn.classList.remove('busy');
    trkBtn.textContent = 'Connect';
  }
});

// Render the license block. Accepts either a getLicense() result or a state
// snapshot (both carry licensePlan / licenseStatus / licenseExpiry).
const ENDED_MESSAGES = {
  expired:        'Your subscription has expired. Renew to keep getting reviews.',
  cancelled:      'Your subscription was cancelled. Resubscribe to keep getting reviews.',
  payment_failed: 'Your last payment failed. Update your payment method to keep getting reviews.',
  device_mismatch:'This key is active on another device.',
};

function renderLicense(lic) {
  if (!lic) return;
  document.getElementById('lic-plan').textContent = lic.licensePlan || '·';
  // Reflect a lapsed subscription immediately, even before the server re-check.
  let status = lic.licenseStatus || '';
  if (lic.licenseExpiry && new Date(lic.licenseExpiry) < new Date()) status = 'expired';
  const statusEl = document.getElementById('lic-status');
  statusEl.textContent = status || '·';
  statusEl.className = `badge ${status}`;
  document.getElementById('lic-expiry').textContent = formatExpiry(lic.licenseExpiry);

  // Big red notice when the subscription is no longer active.
  const ended = !!status && status !== 'active';
  const noticeEl = document.getElementById('lic-ended');
  if (noticeEl) {
    noticeEl.textContent = ENDED_MESSAGES[status] || 'Your subscription has ended. Renew to keep getting reviews.';
    noticeEl.hidden = !ended;
  }
}

async function refreshLicense() {
  try { renderLicense(await window.occlara.getLicense()); } catch (e) {}
}

// Load current config + license.
// ── Language ────────────────────────────────────────────────────────────────
const langEl  = document.getElementById('language');
let langDD = null;   // the shared Dropdown bound to langEl
const langNote = document.getElementById('language-note');

/**
 * Fill the picker and explain, honestly, what the choice actually changes.
 *
 * Reviews are written by the model, so every language here is native
 * quality. The interface is hand translated, so some languages get English
 * chrome for now. Saying so up front is better than a player picking Japanese,
 * seeing English buttons, and assuming the feature is broken.
 */
function buildLanguagePicker(current) {
  if (!langEl || !window.occlara.i18n) return;
  // Languages whose UI chrome is NOT translated are tagged in the list, so the
  // caveat is visible while choosing rather than only after.
  const opts = window.occlara.i18n.languages().map((l) => ({
    value: l.code,
    label: l.name,
    tag: window.occlara.i18n.hasUi(l.code) ? '' : 'reviews only',
  }));
  if (!langDD) {
    langDD = window.Dropdown.create(langEl, {
      label: 'Language',
      options: opts,
      value: current,
      onChange: (code) => {
        // Preview only: the note describes the language being CONSIDERED, so
        // the caveat about English chrome is visible before committing.
        showLanguageNote(code);
        if (langStatusEl) langStatusEl.hidden = true;
        syncLangSave();
      },
    });
  } else {
    langDD.setOptions(opts, true).setValue(current);
  }
  showLanguageNote(current);
}

function showLanguageNote(code) {
  if (!langNote || !window.occlara.i18n) return;
  const translated = window.occlara.i18n.hasUi(code);
  langNote.hidden = translated;
  if (!translated) {
    langNote.textContent =
      'Your reviews will be written in this language. The app’s own buttons and labels are still English for now.';
  }
}

/**
 * Language is applied on SAVE, not on selection.
 *
 * It used to switch the moment the dropdown changed, which meant scrolling the
 * list with a keyboard or a mouse wheel re-rendered the whole app on every
 * option it passed through, and there was no way to look at the list without
 * committing to whatever you landed on. Every other setting here is a toggle
 * whose effect is obvious; a language change repaints everything, so it earns a
 * deliberate press.
 *
 * The button is dead until the choice actually differs from what is saved, so
 * the control itself says whether there is anything to apply.
 */
const langSaveEl = document.getElementById('lang-save');
const langStatusEl = document.getElementById('lang-status');
let savedLang = 'en';

function syncLangSave() {
  if (!langSaveEl || !langDD) return;
  langSaveEl.disabled = langDD.value === savedLang;
}

if (langSaveEl) {
  langSaveEl.addEventListener('click', async () => {
    const pick = langDD.value;
    langSaveEl.classList.add('busy');
    try {
      await window.occlara.setConfig({ language: pick });
      savedLang = pick;
      // Repaint this window immediately; the config push handles the others.
      if (window.initI18n) window.initI18n();
      if (langStatusEl) {
        // t takes (code, key). Passing the key alone reads it as a language
        // code and returns undefined, which renders as the word "undefined".
        // Confirm in the language just chosen, not the one being left.
        const say = (window.occlara.i18n && window.occlara.i18n.t
          && window.occlara.i18n.t(pick, 'common.languageSaved')) || 'Language saved.';
        langStatusEl.textContent = say;
        langStatusEl.className = 'trk-status ok';
        langStatusEl.hidden = false;
      }
    } catch (e) {
      if (langStatusEl) {
        langStatusEl.textContent = 'Could not save the language, try again.';
        langStatusEl.className = 'trk-status err';
        langStatusEl.hidden = false;
      }
    } finally {
      langSaveEl.classList.remove('busy');
      syncLangSave();
    }
  });
}

async function load() {
  try {
    const cfg = await window.occlara.getConfig();
    if (cfg) {
      savedLang = cfg.language || 'en';
      buildLanguagePicker(savedLang);
      syncLangSave();   // nothing to apply yet, so Save starts dead
      markSeg(speedSeg, String(cfg.captureSpeed || 'auto'));
      markSeg(captureSeg, cfg.captureQuality || 'standard');
      buildGamePicker(cfg.game || 'valorant', cfg.devGames === true);
      // OFF is the default here, so the test is for an explicit true.
      markSeg(advancedSeg, cfg.advancedTips === true ? 'on' : 'off');
      markSeg(aiLogSeg, cfg.aiLog === false ? 'off' : 'on');
      // Default on, so an older config with no key set reads as on rather than
      // as off, which is what `=== true` would do here.
      markSeg(soundsSeg, cfg.sounds === false ? 'off' : 'on');
      if (typeof cfg.riotId === 'string') riotEl.value = cfg.riotId;
      // Already connected from a previous session? Show it, no reconnect needed.
      if (cfg.playerStats && cfg.playerStats.rank) {
        const s = cfg.playerStats;
        const bits = [`rank ${s.rank}`];
        if (s.kd) bits.push(`K/D ${s.kd}`);
        if (s.kpr != null) bits.push(`${s.kpr} kills/round`);
        if (s.adr) bits.push(`ADR ${s.adr}`);
        if (s.headshotPct) bits.push(`HS ${s.headshotPct}%`);
        showTrk(true, `Connected. ${bits.join(', ')}.`);
      }
    }
    await refreshLicense();
  } catch (err) {
    console.error('[settings] load failed', err);
  }
}

window.occlara.getState().then(paintCadence).catch(() => {});
window.occlara.onState(paintCadence);

// Keep the license block consistent: on every pushed state, on window focus, and
// on a slow poll (so an expiry/renewal shows without reopening Settings).
window.occlara.onState((s) => renderLicense(s));
window.addEventListener('focus', refreshLicense);
setInterval(refreshLicense, 15000);

function formatExpiry(value) {
  if (!value) return 'Never';
  const d = new Date(value);
  return isNaN(d) ? value : d.toLocaleDateString();
}

document.getElementById('purchase').addEventListener('click', () => window.occlara.openPurchase());
document.getElementById('logout').addEventListener('click', () => window.occlara.logout());
document.getElementById('quit').addEventListener('click', () => window.occlara.quit());
document.getElementById('close').addEventListener('click', () => window.close());

// Support email: click to copy to clipboard (falls back to selecting the text).
// The address is READ FROM THE MARKUP rather than repeated here. It used to be
// hardcoded in both places, so changing the address in one would have left the
// panel showing one thing and the clipboard holding another, with nothing on
// screen to reveal it. Captured once at load, because the element's text is
// swapped for "Copied!" during the flash.
const emailEl = document.getElementById('support-email');
if (emailEl) {
  const email = emailEl.textContent.trim();
  emailEl.addEventListener('click', () => {
    const flash = () => {
      const orig = emailEl.textContent;
      emailEl.textContent = 'Copied!';
      emailEl.classList.add('copied');
      setTimeout(() => { emailEl.textContent = orig; emailEl.classList.remove('copied'); }, 1200);
    };
    const selectIt = () => {
      const r = document.createRange(); r.selectNodeContents(emailEl);
      const s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
    };
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(email).then(flash).catch(selectIt);
      } else selectIt();
    } catch { selectIt(); }
  });
}

load();
if (window.initI18n) window.initI18n();
console.log('[settings] ready');

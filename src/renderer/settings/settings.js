'use strict';

/*
 * THE SLIDING THUMB (8.7): shared/seg.js lays one thumb behind each row of
 * buttons and slides it to the chosen one (.active). The buttons and their
 * state are untouched, so markSeg below and every test that reads .active
 * are as they were. Guarded on MutationObserver, which the offline DOM the
 * tests run the page in does not have; there the buttons draw their own fill
 * (settings.css .seg:not(.seg-slide)).
 */
function slideSeg(id) {
  const el = document.getElementById(id);
  if (el && typeof window.occlaraSeg === 'function' && typeof MutationObserver === 'function') window.occlaraSeg(el);
  return el;
}
for (const id of ['capturespeed', 'recording', 'recordingres', 'clipcap', 'advanced', 'capturequality', 'sounds', 'ailog', 'livemap', 'liveagent', 'livescore', 'liveround']) slideSeg(id);

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
    // The gap is the live round's: menus, a confirmed buy phase and the time
    // spent dead are read less often (read-cadence.js, 8.3.2), and this line
    // is mostly seen between matches, so it says which it means.
    cadenceEl.textContent = `Reading every ${every} in a live round right now`
      + `${s.captureSpeed === 'auto' ? ', chosen automatically' : ''}. Menus, buy phases and the time spent dead are read less often.`;
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
/*
 * THE AI LOG, LOCKED ON BOTH WAYS (8.9, the owner's rule: "if the recording
 * setting is on, lock the captures, vice versa"). A Valorant review finds
 * each death it looks at in the AI log's frames (index.js forensicsFor: no
 * log, no look), so the log is always shown on, cannot be pressed, and says
 * why, with a line for each state: with recording on the clips are cut from
 * the recording where the frames say; with it off the frames are the only
 * thing the review can look at. Main writes the log whatever is stored
 * (index.js startAiLog), so the lock is what happens, not only what is drawn.
 */
const aiLogSeg    = document.getElementById('ailog');
const aiLogLock   = document.getElementById('ailog-lock');
let aiLogRecOn = true;       // which line the lock says: recording on or off
const AILOG_LOCK = {
  valorant: 'Locked on while Record match video is on: the review finds each death in these frames and cuts its clips from the recording where they say, so with this off there would be no look at your deaths and no clips.',
  lol: "Locked on while Record match video is on. In League of Legends this does nothing: its review is built from the game's own record.",
};
const AILOG_LOCK_OFF = {
  valorant: 'Locked on while Record match video is off: with no video, these frames are the only thing the review can look at your deaths through.',
  lol: "Locked on while Record match video is off. In League of Legends this does nothing: its review is built from the game's own record.",
};
function paintAiLog() {
  markSeg(aiLogSeg, 'on');
  for (const btn of aiLogSeg.querySelectorAll('button')) btn.disabled = true;
  aiLogSeg.classList.add('locked');
  aiLogSeg.setAttribute('aria-disabled', 'true');
  const lines = aiLogRecOn ? AILOG_LOCK : AILOG_LOCK_OFF;
  const text = lines[recGame] || lines.valorant;
  if (aiLogLock.textContent !== text) aiLogLock.textContent = text;
  aiLogLock.hidden = false;
}
const soundsSeg   = wireBoolSeg('sounds', 'sounds');
// Match status while recording (Progress v3): one switch each, on by default.
const LIVE_SEGS = [['livemap', 'liveMap'], ['liveagent', 'liveAgent'], ['livescore', 'liveScore'], ['liveround', 'liveRound']]
  .map(([id, key]) => [wireBoolSeg(id, key), key]);
// Capture quality is a VALUE segment, not a boolean: 'standard' or
// 'performance'. Naming the values rather than on/off keeps the meaning in the
// stored config, where a future third profile would slot in without a migration.
const captureSeg  = document.getElementById('capturequality');
wireSeg(captureSeg, 'captureQuality');

/*
 * RECORD MATCH VIDEO (8.3): On or Off, the words the player asked for, stored
 * as 'auto' and 'off', the values the setting shipped with (On is Auto: it
 * turns itself off on a PC that cannot afford it); and 480p, 720p or 1080p,
 * 480p the light one (8.7, 15 frames a second). Under
 * them ONE STATUS LINE: recording now, at what size and about how many frames
 * a second, or why it is not, this session's reason before the last session's
 * (no hardware encoder, the PC busy, not enough disk, a game the capture read
 * black). Where it turned itself off, two busy sessions in a week, it says so
 * with a way to try again (On chosen again is the try: main forgets the busy
 * sessions). Off chosen by hand says nothing: the player knows. Painted from
 * the config at load and from every state push, because main starts and stops
 * recording, and turns it off, while this page is open.
 */
const recSeg = document.getElementById('recording');
const recResSeg = document.getElementById('recordingres');
const recHint = document.getElementById('rec-hint');
const recNote = document.getElementById('rec-note');
const recRetry = document.getElementById('rec-retry');
wireSeg(recResSeg, 'recordingRes');
// What goes on without the recording: the coach's read of the screen, or, in
// League, whose screen is never read, the review built from the game's record.
let recGame = 'valorant';
/*
 * OFF ASKS FIRST (8.9, the owner's ask). On saves at once, and turns the AI
 * log on with it, since the lock says it is on. Off, from On, opens a
 * question under the row: what the recording gives the review, and that the
 * AI log is turned on with it. Turn recording off saves both, and the log stays
 * locked on with its recording-off line; Keep recording leaves everything as it was. Already off (turned off by
 * itself, say), Off asks nothing.
 */
const recConfirm = document.getElementById('rec-confirm');
const recConfirmBody = document.getElementById('rec-confirm-body');
const recOffYes = document.getElementById('rec-off-yes');
const recOffKeep = document.getElementById('rec-off-keep');
const REC_OFF_ASK = {
  valorant: "Recording is what makes the coaching good. With it on, the review looks at each death through stills from the match's video and keeps a clip of each moment. With it off nothing is recorded: the review has no clips, and its look at each death has only the frames the AI log keeps from the reads, taken a second or more apart. So turning recording off turns the AI log on.",
  lol: "Recording is what lets the review show your deaths: with it off nothing is recorded and the review keeps no clips. Your review is still built from the game's own record. Turning recording off turns the AI log on.",
};
function recordingOn() {
  const b = recSeg.querySelector('button.active');
  return !b || b.dataset.val !== 'off';
}
function closeRecConfirm() { recConfirm.hidden = true; }
recSeg.addEventListener('click', async (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  if (btn.dataset.val === 'off') {
    if (!recordingOn()) return;
    recConfirmBody.textContent = REC_OFF_ASK[recGame] || REC_OFF_ASK.valorant;
    recConfirm.hidden = false;
    recOffKeep.focus();
    return;
  }
  closeRecConfirm();
  markSeg(recSeg, 'auto');
  aiLogRecOn = true;
  paintAiLog();
  await window.occlara.setConfig({ recordingMode: 'auto', aiLog: true }).catch(() => {});
});
recOffKeep.addEventListener('click', () => { closeRecConfirm(); });
recOffYes.addEventListener('click', async () => {
  closeRecConfirm();
  markSeg(recSeg, 'off');
  aiLogRecOn = false;
  paintAiLog();
  await window.occlara.setConfig({ recordingMode: 'off', aiLog: true }).catch(() => {});
});
const still = () => (recGame === 'lol' ? "Your review is still built from the game's own record." : 'The coach still reads your screen.');
/*
 * WHAT ON AND OFF DO, TRUE IN EACH GAME, which is why it is written per game.
 * A Valorant match is recorded while its screen is read, and a League game
 * while its own record is (Settings never says League's screen is read).
 */
const REC_HINT = {
  valorant: 'On records each match on this PC at about 30 frames a second (15 at 480p, the lightest size, whose death moments are less sharp) while the coach reads your screen; if your PC cannot keep up while you play, recording stops for that session and the coach keeps reading. Off records nothing, and the coach still reads your screen at the speed set above. The video stays on this PC: once a review is built, a short clip of each moment it looked at is kept beside it and the rest is deleted.',
  lol: "On records each game on this PC at about 30 frames a second (15 at 480p, the lightest size, whose death moments are less sharp); if your PC cannot keep up while you play, recording stops for that session. Off records nothing. Either way your review is built from the game's own record. The video stays on this PC: once a review is built, short clips of up to six of your deaths, spread across the game, are kept beside it and the rest is deleted.",
};
// Capture speed and Performance are about reading the screen, and say what
// they do in each game. Both are the Valorant engine's alone: League's
// session never reads the screen (index.js readSize).
const OWN_RECORD = "its review is built from the game's own record";
const READ_HINTS = [
  { el: document.getElementById('capture-hint'), lol: `In League of Legends this does nothing: ${OWN_RECORD}. It sets how often a Valorant match is read.` },
  { el: document.getElementById('perf-hint'), lol: `In League of Legends this does nothing: ${OWN_RECORD}. It is for Valorant.` },
].filter((h) => h.el).map((h) => ({ ...h, own: h.el.textContent }));
function paintRecHint() {
  recHint.textContent = REC_HINT[recGame] || REC_HINT.valorant;
  for (const h of READ_HINTS) h.el.textContent = h[recGame] || h.own;
}
// Before anything asks main: the hint is the page's own words.
paintRecHint();
const REC_NOTE = {
  autoOff: () => `Recording turned itself off: your PC was busy in two sessions this week. ${still()}`,
  noEncoder: () => `This PC has no hardware video encoder Occlara can record with, so matches are not recorded. ${still()}`,
};
// Why a session did not record, by its outcome (recorder.js OUTCOMES).
const REC_WHY = {
  busy: (when) => `Recording stopped in ${when}: your PC was busy. It tries again next session, and turns itself off after two busy sessions in a week.`,
  disk: (when) => `Not enough free disk to record in ${when}: recording needs 8 GB free on this drive. ${still()}`,
  black: (when) => `Recording needs Windowed Fullscreen: the game read black to it in ${when}. ${still()}`,
  error: (when) => `Recording stopped on an error in ${when}. It tries again next session.`,
};
/**
 * The size it records at: the rows of the track itself where main gives them
 * (liveView's height), since a display that is not 16:9 records another
 * number of rows than the setting names (a 1280x1024 display at 1080p records
 * 1024, and says 1024p); the setting where main does not give them.
 */
/** A saved size as Settings shows it: '480' and '1080' as they are, anything else '720' (recorder.js resOf). */
function resOf(v) {
  const s = String(v);
  return s === '480' || s === '1080' ? s : '720';
}
function recordingRows(live) {
  const h = live && live.height;
  if (Number.isFinite(h) && h > 0) return String(Math.round(h));
  return resOf(live && live.res);
}
/** The status line's words, and whether Try again goes under them; null to say nothing. */
function recordingLine(r) {
  const off = r.mode === 'off';
  if (r.live) {
    const fps = typeof r.live.fps === 'number' && r.live.fps > 0 ? `, about ${r.live.fps} fps` : '';
    return { text: `Recording now at ${recordingRows(r.live)}p${fps}.`, live: true };
  }
  if (off) return r.autoOff ? { text: REC_NOTE.autoOff(), retry: true } : null;
  const now = r.session && r.session.outcome;
  const outcome = now || (r.last && r.last.outcome);
  const when = now ? 'this session' : 'your last session';
  if (outcome === 'no-hw-encoder') return { text: REC_NOTE.noEncoder() };
  const say = Object.prototype.hasOwnProperty.call(REC_WHY, outcome) ? REC_WHY[outcome] : null;
  return say ? { text: say(when) } : null;
}
function paintRecording(r) {
  if (!r) return;
  const off = r.mode === 'off';
  markSeg(recSeg, off ? 'off' : 'auto');
  if (off) closeRecConfirm();
  aiLogRecOn = !off;
  paintAiLog();
  markSeg(recResSeg, resOf(r.res));
  paintRecHint();
  const line = recordingLine(r);
  // Written only when it changes: it is a live region, and the state is
  // pushed on every config write and status tick.
  const text = line ? line.text : '';
  if (recNote.textContent !== text) recNote.textContent = text;
  recNote.classList.toggle('live', !!(line && line.live));
  recNote.hidden = !line;
  recRetry.hidden = !(line && line.retry);
}
// The state's view is the config's and what only main knows besides (live,
// this session), so once one has painted, the config read at load, which may
// answer after it, does not paint over it.
let recordingFromState = false;
function paintRecordingState(r, game) {
  recordingFromState = true;
  if (game) recGame = game;
  paintRecording(r);
}
recRetry.addEventListener('click', async () => {
  markSeg(recSeg, 'auto');
  recNote.hidden = true;
  recRetry.hidden = true;
  aiLogRecOn = true;
  paintAiLog();
  await window.occlara.setConfig({ recordingMode: 'auto', aiLog: true }).catch(() => {});
});

/*
 * THE CLIPS (8.3): what the clips kept beside the reviews take together,
 * against the cap, the cap itself (5, 10, 20 or 50 GB), and Clear clips. Read
 * from main at load, after the cap or Clear changes it, and after any review
 * is saved, since saving one is when its clips are kept and the cap applied.
 */
const clipUsage = document.getElementById('clip-usage');
const clipCapSeg = document.getElementById('clipcap');
const clipClear = document.getElementById('clip-clear');
const MB = 1024 * 1024;
/** 340 MB, 1.2 GB: what a clip total reads as. */
function sizeText(bytes) {
  const b = Number(bytes) || 0;
  if (b >= 1024 * MB) return `${(Math.round((b / (1024 * MB)) * 10) / 10).toLocaleString('en-US')} GB`;
  return b < MB ? 'less than 1 MB' : `${Math.round(b / MB)} MB`;
}
function paintClips(u) {
  if (!u || typeof u !== 'object' || u.ok === false) return;
  const cap = Number(u.capGB) || 10;
  markSeg(clipCapSeg, String(cap));
  const n = Number(u.clips) || 0;
  clipUsage.textContent = n
    ? `Clips kept beside your reviews: ${sizeText(u.bytes)} of ${cap} GB, ${n} clip${n === 1 ? '' : 's'} from ${u.reviews} review${u.reviews === 1 ? '' : 's'}.`
    : `No clips kept yet. They take up to ${cap} GB together.`;
  clipClear.disabled = !n;
}
let clipsTimer = null;
function readClips() {
  clearTimeout(clipsTimer);
  clipsTimer = setTimeout(() => {
    window.occlara.getClipsUsage().then(paintClips).catch(() => {});
  }, 200);
}
clipCapSeg.addEventListener('click', async (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  markSeg(clipCapSeg, btn.dataset.val);
  await window.occlara.setConfig({ clipCapGB: Number(btn.dataset.val) }).catch(() => {});
  readClips();
});
// TWO PRESSES. Every clip of every review goes and none comes back, so the
// first press only asks, for four seconds, and the second clears.
const CLEAR_LABEL = clipClear.textContent;
const CLEAR_ASK = 'Press again to clear every clip';
let clearArmed = null;
function disarmClear() {
  clearTimeout(clearArmed);
  clearArmed = null;
  clipClear.textContent = CLEAR_LABEL;
  clipClear.classList.remove('armed');
}
clipClear.addEventListener('click', async () => {
  if (!clearArmed) {
    clipClear.textContent = CLEAR_ASK;
    clipClear.classList.add('armed');
    clearArmed = setTimeout(disarmClear, 4000);
    return;
  }
  disarmClear();
  clipClear.disabled = true;
  const u = await window.occlara.clearClips().catch(() => null);
  if (u) paintClips(u);
  else readClips();
});
window.occlara.onReviews(() => readClips());

/**
 * Game picker, built from the shared registry rather than hand-written markup.
 *
 * The section stays hidden while only one game can be coached. A picker with a
 * single option is not a choice, and a picker whose second option does nothing
 * is worse: it would let someone select another game and then be coached by
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
 * starts: League records the game in silence through Riot's own local game
 * data, and has no stats source.
 */
const GAME_NOTES = {
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
    // game is not built yet" about League, which Start records and
    // grades, and that "the look and layout are real", about palettes that are
    // gone. Only a game Start would refuse is called unbuilt.
    tag: g.comingSoon ? 'coming soon' : (g.preview || !g.coaching ? 'preview' : ''),
    note: !g.coaching ? 'Recording is not built for this game yet. Start will say so and do nothing.'
      : (GAME_NOTES[g.id] || ''),
  }));

  if (!gameDD) {
    gameDD = window.Dropdown.create(gamePickEl, {
      label: 'Game',
      options: opts,
      value: current,
      onChange: (id) => {
        // A game that is coming soon cannot be chosen: put the list back.
        if (games.some((g) => g.id === id && g.comingSoon)) { gameDD.setValue(current); return; }
        window.occlara.setConfig({ game: id }).catch(() => {});
      },
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
// The version opens What's new (the changelog page); Check for updates beside
// it forces a fresh check, so the player can confirm on demand.
document.getElementById('version').addEventListener('click', () => window.occlara.openWhatsNew());
document.getElementById('whatsnew-open').addEventListener('click', () => window.occlara.openWhatsNew());
document.getElementById('discord-open').addEventListener('click', () => {
  Promise.resolve(window.occlara.openDiscord()).catch(() => {});
});
document.getElementById('update-check').addEventListener('click', () => {
  paintVersion({ current: null, state: 'checking' });
  window.occlara.getVersion().then((cur) => {
    paintVersion({ ...cur, state: 'checking' });
    return window.occlara.checkUpdate();
  }).then(paintVersion).catch(() => {});
});

document.getElementById('open-ailog').addEventListener('click', () => window.occlara.openAiLog());

// ── Riot ID ─────────────────────────────────────────────────────────────────
// THE LINES UNDER THE FIELD ARE ABOUT ONE RIOT ID EACH: the Connect line
// about the ID it checked (trkAbout), the grading line about the account its
// run is for. Each shows only while the field holds its ID, compared without
// case as Riot compares them. Edited, the field used to keep "Connected ...
// being graded" and the grading line on screen for an ID no longer in it.
const riotEl = document.getElementById('riotid');
const trkBtn = document.getElementById('trk-connect');
const trkStatus = document.getElementById('trk-status');
const bfStatus = document.getElementById('bf-status');
const bfOpen = document.getElementById('bf-open');
const STALE = 'Your Riot ID changed while it was being checked. Press Connect again.';
const PROFILE_NOT_LOADED = "Your rank could not be loaded right now. Your recent matches are being graded from Riot's record.";
const sameId = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
let trkAbout = '';
let checking = false;
// The ID a Connect connected without a profile, so without knowing the
// account exists ('' otherwise), and the run's last status.
let unconfirmed = '';
let lastBf = null;

// Save on change (debounced enough for a text field).
let riotTimer = null;
riotEl.addEventListener('input', () => {
  clearTimeout(riotTimer);
  riotTimer = setTimeout(() => window.occlara.setConfig({ riotId: riotEl.value.trim() }).catch(() => {}), 500);
  syncRiot();
});

/** The Connect line: tone true is good news, false a failure, null neither. */
function showTrk(tone, msg, about) {
  trkStatus.className = 'trk-status' + (tone === true ? ' ok' : tone === false ? ' err' : '');
  trkStatus.textContent = msg || '';
  trkAbout = about === undefined ? riotEl.value : about;
  syncRiot();
}

/** Show what is about the Riot ID now in the field, and nothing else. */
function syncRiot() {
  // "Checking" stays up through an edit: the answer says the ID changed.
  trkStatus.hidden = !trkStatus.textContent || !(checking || sameId(trkAbout, riotEl.value));
  const s = lastBf;
  const show = !!s && s.state !== 'idle' && !!s.message && sameId(s.account, riotEl.value);
  bfStatus.hidden = !show;
  bfOpen.hidden = !(show && s.state === 'done' && (s.graded + s.upgraded) > 0);
}

/** A profile Riot answered with, as the facts it holds. */
function profileLine(s) {
  const bits = [`rank ${s.rank || 'unknown'}`];
  if (s.peakRank) bits.push(`peak ${s.peakRank}`);
  if (s.kd) bits.push(`K/D ${s.kd}`);
  if (s.kpr != null) bits.push(`${s.kpr} kills/round`);
  if (s.adr) bits.push(`ADR ${s.adr}`);
  if (s.acs) bits.push(`ACS ${s.acs}`);
  if (s.headshotPct) bits.push(`HS ${s.headshotPct}%`);
  return `Connected. ${bits.join(', ')}.`;
}

// Connect: save the ID, test the tracker link live, show exactly what happened.
trkBtn.addEventListener('click', async () => {
  const id = riotEl.value.trim();
  clearTimeout(riotTimer);
  trkBtn.classList.add('busy');
  trkBtn.textContent = 'Connecting';
  checking = true;
  showTrk(null, 'Checking your tracker profile...', id);
  let res = null;
  try {
    await window.occlara.setConfig({ riotId: id });
    res = await window.occlara.testTracker();
  } catch {
    res = null;
  }
  checking = false;
  trkBtn.classList.remove('busy');
  trkBtn.textContent = 'Connect';
  unconfirmed = '';
  if ((res && res.stale) || !sameId(riotEl.value, id)) {
    // The answer is about the ID that was checked, and the field saves as it
    // is typed. Main refuses an ID changed mid check itself; an edit in the
    // half second before the field saved is caught here.
    showTrk(false, (res && res.stale && res.error) || STALE);
  } else if (res && res.ok && res.stats) {
    // THE CONNECT LINE IS ABOUT THE ACCOUNT ONLY. The grading has a line of its
    // own below, which follows it to its end: written here, "being graded"
    // stayed up over a run that had found nothing to grade, or failed.
    showTrk(true, profileLine(res.stats), id);
  } else if (res && res.ok && res.unranked) {
    // Found, with no ranked profile: someone who only plays unrated. Their
    // matches still have Riot's record, and the grading line below says so.
    showTrk(true, 'Connected. No ranked profile on this account yet.', id);
  } else if (res && res.ok) {
    // NOT A FAILED CONNECT. The profile could not be loaded right now (a rate
    // limit, the stats service down) and the grading started all the same.
    // Neither red nor "Connected": nothing has shown the account exists yet,
    // and the grading line below says if it turns out not to.
    unconfirmed = id;
    showTrk(null, PROFILE_NOT_LOADED, id);
  } else {
    showTrk(false, (res && res.error) || 'Could not connect. Try again in a minute.', id);
  }
});

// The grading Connect started, followed as main pushes it.
function paintBackfill(s) {
  lastBf = s || null;
  // THE RUN SETTLES A CONNECT THAT NEVER SAW THE ACCOUNT: one that lists its
  // matches proves it exists, and the line says Connected; one that ends in
  // any error leaves it unproven, the line above goes, and this one says why.
  if (s && unconfirmed && sameId(s.account, unconfirmed)) {
    if (s.state === 'grading' || s.state === 'done') {
      if (sameId(trkAbout, unconfirmed)) showTrk(true, 'Connected. Your rank could not be loaded right now.', unconfirmed);
      unconfirmed = '';
    } else if (s.state === 'error') {
      if (sameId(trkAbout, unconfirmed)) trkStatus.textContent = '';
      unconfirmed = '';
    }
  }
  if (s && s.message) {
    bfStatus.textContent = s.message;
    // A run that ended with failures and nothing graded is not a success,
    // whatever its state says.
    const empty = s.failed > 0 && !((s.graded || 0) + (s.upgraded || 0));
    bfStatus.className = 'trk-status' + (s.state === 'error' ? ' err' : s.state === 'done' && !empty ? ' ok' : '');
  }
  syncRiot();
}
bfOpen.addEventListener('click', () => window.occlara.openMatches());
window.occlara.onBackfill(paintBackfill);
window.occlara.getBackfill().then(paintBackfill).catch(() => {});

// Render the license block. Accepts either a getLicense() result or a state
// snapshot (both carry licensePlan / licenseStatus / licenseExpiry).
// A plan bought after the last one ended is a new key, so an ended one says
// to log out and enter it (license-service.js, ENDED_NOTICES). A failed
// payment is a grace: the key works until its expiry while the card is tried
// again, and this says so beside it.
const RENEW_HERE = 'Renew with Manage subscription, then Log out and enter your new key.';
const ENDED_MESSAGES = {
  expired:        `Your subscription has ended. ${RENEW_HERE}`,
  cancelled:      `Your subscription was cancelled. ${RENEW_HERE}`,
  payment_failed: 'Your last payment failed. Update your card with Manage subscription to keep getting reviews.',
  refunded:       'This key was refunded, so it no longer works. Log out to enter another key.',
  disputed:       'This key\'s payment is disputed, so it no longer works. Email support@occlara.app.',
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
    noticeEl.textContent = ENDED_MESSAGES[status] || `Your subscription has ended. ${RENEW_HERE}`;
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
      if (!recordingFromState) {
        if (cfg.game) recGame = cfg.game;
        paintRecording({ mode: cfg.recordingMode, res: cfg.recordingRes, autoOff: cfg.recordingAutoOff, last: cfg.recordingLast });
      }
      markSeg(clipCapSeg, String(cfg.clipCapGB || 10));
      buildGamePicker(cfg.game || 'valorant', cfg.devGames === true);
      // ON is the default since 8.8, so the test is for an explicit false.
      markSeg(advancedSeg, cfg.advancedTips !== false ? 'on' : 'off');
      paintAiLog();
      // The log stored off (an install from before the lock): main writes it
      // whatever is stored (index.js startAiLog), and it is stored on here so
      // the config says what happens, with recording on or off.
      if (cfg.aiLog === false) window.occlara.setConfig({ aiLog: true }).catch(() => {});
      // Default on, so an older config with no key set reads as on rather than
      // as off, which is what `=== true` would do here.
      markSeg(soundsSeg, cfg.sounds === false ? 'off' : 'on');
      for (const [seg, key] of LIVE_SEGS) markSeg(seg, cfg[key] === false ? 'off' : 'on');
      if (typeof cfg.riotId === 'string') riotEl.value = cfg.riotId;
      // Already connected from a previous session? Show it, no reconnect
      // needed: the profile saved for the Riot ID in config. Connected means
      // Connect was pressed for it (riotConnected), as the sidebar and the
      // launch's check against Riot's record read it: a profile alone is one
      // the launch's own refresh saves for any ranked ID typed here.
      const id = String(cfg.riotId || '').trim();
      const s = cfg.playerStats;
      const connected = sameId(cfg.riotConnected, id);
      if (id.includes('#') && connected && s && s.rank && sameId(s._riotId, id) && !checking) showTrk(true, profileLine(s), id);
      // Shown to exist with no profile kept (no ranked one, or one that
      // could not be loaded when its matches were graded).
      else if (id.includes('#') && connected && !checking) showTrk(true, 'Connected.', id);
      // The field was filled after the run's status may have arrived for it.
      else syncRiot();
    }
    await refreshLicense();
  } catch (err) {
    console.error('[settings] load failed', err);
  }
}

window.occlara.getState().then((s) => {
  paintCadence(s);
  // Recording now, as the page opens: the config alone cannot say it is.
  if (s && s.recording) paintRecordingState(s.recording, s.gameId);
}).catch(() => {});
window.occlara.onState(paintCadence);
// Recording starts and stops, and Auto can turn itself off (a second busy
// session), while this page is open.
window.occlara.onState((s) => { if (s && s.recording) paintRecordingState(s.recording, s.gameId); });
readClips();

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
// A page of the main window has no window of its own to close.
document.getElementById('close').addEventListener('click', () => {
  if (!(window.occlaraEmbedded && window.occlaraEmbedded())) window.close();
});

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

/*
 * THE ACCOUNT SECTION (8.7). Every line is main's view of the account
 * (account-service.js view, its games and the cap written by usage.js), so
 * nothing here counts a game or works out a date. Signed in through the
 * browser: email, plan, games left, the account key with Copy, and Sign out.
 * On a licence key alone: the key, whatever the server said of its games,
 * and Sign in with your browser, the key working on either way.
 */
const ACCT_SIGNIN_ERRORS = {
  timeout: 'The sign in took too long. Try again.',
  refused: 'That sign in was not accepted. Try again.',
  unreachable: 'Occlara could not reach its server. Check your connection and try again.',
  browser: 'Your browser could not be opened. Try again.',
  listen: 'Sign in could not start on this PC. Try again.',
};
const acct = (id) => document.getElementById(id);
let acctSigningIn = false;
let acctCopied = null;

function acctRow(row, value) {
  const text = typeof value === 'string' ? value : '';
  acct(row).hidden = !text;
  return text;
}

function paintAccount(view) {
  const v = view || {};
  acct('acct-email').textContent = acctRow('acct-email-row', v.signedIn ? v.email : '');
  acct('acct-tier').textContent = acctRow('acct-tier-row', v.tierLabel);
  acct('acct-games').textContent = acctRow('acct-games-row', v.gamesLeft);
  const key = acctRow('acct-key-row', v.accountKey);
  acct('acct-key').textContent = key;
  acct('acct-key').title = key;
  const waiting = acctSigningIn || !!v.pending;
  acct('acct-out').hidden = !!v.signedIn || waiting;
  acct('acct-wait').hidden = !waiting;
  acct('acct-signin').hidden = !!v.signedIn || waiting;
  acct('acct-cancel').hidden = !waiting;
  acct('acct-signout').hidden = !v.signedIn;
  // Upgrade on a plan that has one above it: Free and Pro.
  acct('acct-upgrade').hidden = !(v.tier === 'free' || v.tier === 'pro');
  // Invites need an account behind them: a session, or a key the server knows.
  acct('acct-invite').hidden = !v.via;
  // Signed in, the Account section is the whole story: the old License
  // section would show a key plan of "·" and the footer would repeat Manage
  // plan and Sign out, so both step aside. On a key alone they stay, and the
  // footer's Manage subscription is the one way to the plan.
  const signedIn = !!v.signedIn;
  acct('lic').hidden = signedIn;
  acct('purchase').hidden = signedIn;
  acct('logout').hidden = signedIn;
  acct('acct-manage').hidden = !signedIn;
}

async function refreshAccount() {
  if (typeof window.occlara.getAccount !== 'function') { acct('acct').hidden = true; return; }
  const view = await Promise.resolve(window.occlara.getAccount()).catch(() => null);
  paintAccount(view);
}

acct('acct-copy').addEventListener('click', async () => {
  const r = await Promise.resolve(window.occlara.copyAccountKey()).catch(() => null);
  const done = !!(r && r.ok);
  acct('acct-copy').textContent = done ? 'Copied' : 'Could not copy';
  acct('acct-said').textContent = done ? 'Your account key is copied.' : 'The account key could not be copied.';
  clearTimeout(acctCopied);
  acctCopied = setTimeout(() => { acct('acct-copy').textContent = 'Copy'; }, 1400);
});
acct('acct-signin').addEventListener('click', async () => {
  if (acctSigningIn) return;
  acctSigningIn = true;
  acct('acct-error').hidden = true;
  await refreshAccount();
  let r = null;
  try { r = await window.occlara.signIn(); } catch { r = { ok: false, error: null }; }
  acctSigningIn = false;
  if (!(r && r.ok) && r && r.error !== 'cancelled') {
    acct('acct-error').textContent = ACCT_SIGNIN_ERRORS[r.error] || 'The sign in did not finish. Try again.';
    acct('acct-error').hidden = false;
  }
  await refreshAccount();
});
acct('acct-cancel').addEventListener('click', () => window.occlara.cancelSignIn());
acct('acct-signout').addEventListener('click', () => window.occlara.signOut());
acct('acct-manage').addEventListener('click', () => window.occlara.openAccount());
acct('acct-upgrade').addEventListener('click', () => window.occlara.openUpgrade());
acct('acct-invite').addEventListener('click', () => window.occlara.openInvite());
if (typeof window.occlara.onAccount === 'function') window.occlara.onAccount((v) => { if (!acctSigningIn) paintAccount(v); });
window.addEventListener('focus', refreshAccount);
refreshAccount();

load();
if (window.initI18n) window.initI18n();
console.log('[settings] ready');

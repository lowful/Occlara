'use strict';

/**
 * Connect a Riot ID on the onboarding Riot ID page, through the real app, and
 * follow the grading main runs for it. Settings follows the same run.
 *
 * ONLY THE SERVER IS FAKED. The API client's get is replaced before main
 * loads (index.js calls api.get through the module object, so the property is
 * what it calls), and answers the profile, the recent matches, and Riot's
 * record of each: the real Abyss record, on the row's map and agent. A Riot
 * ID is typed into the real field and the real Connect is pressed, so what
 * paints came through testTracker, backfill.js, PUSH_BACKFILL, both preloads
 * and both pages, and the grades on the rows are compared with the reviews
 * the run saved. The check this replaced painted statuses it broadcast
 * itself, and passed with every one of those broken.
 *
 * In order:
 *   - the tour pages fit their card
 *   - How Occlara watches (8.3.1): the PC check on this PC as it is, its
 *     facts the ones main reads and its line the one the rules give for what
 *     the GPU's encoder answers here, saved through the real store; then PCs
 *     stood in for (main's facts by pc-check.js's gather, the GPU's answers
 *     by a VideoEncoder laid over the page's, since this check runs with
 *     hardware acceleration off and the encoder then refuses everything): a
 *     PC that records at 1080p, both choices clicked, a modest PC, a full
 *     drive, and the tour shown again to a player who chose Off
 *   - the Riot ID page before a Connect
 *   - a Riot ID edited while it was being checked: its error, not connected,
 *     and nothing graded
 *   - a profile that could not be loaded right now: connected, worded
 *     honestly, while the run grades its match
 *   - a Riot ID edited away from the one that connected: no line, no rows
 *     and no Let's go about an ID that is no longer in the field
 *   - a run that finds no such account: the page stops saying it connected
 *   - a profile found: Connected with the rank, Let's go, the rows from the
 *     run with the grades it saved, and Settings following the same run
 *   - the tour shown again to a connected player: connected, with the rank;
 *     another ID typed is not connected, and Skip for now finishes the tour
 *   - Settings: no line about an ID no longer in the field, a profile that
 *     could not be loaded is not a failed Connect, and a run that finds no
 *     such account takes its "being graded" back
 *
 * A formatting pass sits among them: a Defeat and the fullest list are
 * painted from statuses shaped as backfill.js pushes them, because one real
 * record is one 13 to 11 win. It checks the page's own drawing, not the path.
 *
 * The pages are also MEASURED: a page that overflows its card pushes the hero
 * under the close button and the last line under the footer, which every DOM
 * assertion here would still pass.
 *
 * Results travel through a FILE, not stdout: an Electron main process on
 * Windows does not reliably flush a piped stdout. Set OCCLARA_ONBOARDING_SHOTS
 * to a folder and it also writes a picture of each state worth looking at.
 *
 * Run: npm run check:onboardingriot
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

const REPO = path.join(__dirname, '..');
const OUT = path.join(os.tmpdir(), 'occlara-onboarding-riot-check.json');

if (!process.versions.electron) {
  const { spawnSync } = require('child_process');
  const electron = require('electron');
  try { fs.unlinkSync(OUT); } catch { /* nothing to clear */ }
  const env = Object.assign({}, process.env, { OCCLARA_ONBOARDING_OUT: OUT });
  delete env.ELECTRON_RUN_AS_NODE;
  // Five grading runs, one of four matches three seconds apart.
  const r = spawnSync(electron, [__filename], { env, timeout: 240000 });
  let rec = null;
  try { rec = JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch { /* reported below */ }
  if (!rec) { console.error('FAIL: the check wrote no result (exit ' + r.status + ')'); process.exit(1); }
  for (const l of rec.lines) console.log('  ' + l);
  if (!rec.ok) { console.error('FAIL: ' + rec.detail); process.exit(1); }
  console.log('PASS: How Occlara watches checks this PC and saves its choice, Connect grades through the real app, the Riot ID page and Settings follow the run, and the tour fits its card');
  process.exit(0);
}

const { app, BrowserWindow } = require('electron');

const lines = [];
let reported = false;
function report(ok, detail) {
  if (reported) return;
  reported = true;
  try { fs.writeFileSync(process.env.OCCLARA_ONBOARDING_OUT || OUT, JSON.stringify({ ok, detail, lines })); }
  catch { /* exit code still carries it */ }
  app.exit(ok ? 0 : 1);
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
/** The first truthy answer of fn, asked every quarter second, or null after ms. */
async function until(fn, ms) {
  const end = Date.now() + ms;
  for (;;) {
    let v = null;
    try { v = await fn(); } catch { v = null; }
    if (v) return v;
    if (Date.now() > end) return null;
    await wait(250);
  }
}

const ud = path.join(os.tmpdir(), 'occlara-check-onboarding-riot');
fs.rmSync(ud, { recursive: true, force: true });
fs.mkdirSync(ud, { recursive: true });
fs.writeFileSync(path.join(ud, 'occlara-config.json'), JSON.stringify({
  game: 'valorant', onboardingCompleted: true, licenseKey: '', language: 'en',
}, null, 2));
process.env.OCCLARA_DEV_USERDATA = ud;

// Two windows overlap here, and Windows stops painting a window it calculates
// as covered: its transitions freeze and a picture of it is a stale frame.
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
app.disableHardwareAcceleration();
app.on('window-all-closed', () => { /* the run below decides when we exit */ });

// ── The server, faked before main loads ─────────────────────────────────────
const HOUR = 3600000;
const RIOT = JSON.parse(fs.readFileSync(path.join(REPO, 'scripts/fixtures/riot-abyss-13-11.json'), 'utf8'));
const T0 = Date.now() - 96 * HOUR;
const PROFILE = { source: 'henrikdev', rank: 'Gold 2', peakRank: 'Platinum 1', mode: 'competitive',
  kd: 1.12, kpr: 0.81, adr: 141, acs: 214, headshotPct: 23, winRate: 52, topAgent: 'Jett', topAgents: [] };
const RATE_LIMITED = 'Tracker rate limit, try again shortly.';
/** A /recent-matches row, the fields lastMatchRow gives one. */
const row = (matchId, i, map, agent) => ({ matchId, map, mode: 'Competitive', agent, result: 'Victory', score: '13-11',
  kills: 31, deaths: 21, assists: 4, kd: 1.48, acs: 382, adr: 243, headshotPct: 25, startedAt: T0 + i * HOUR });
const ACCOUNTS = {
  // Found, with four matches, one of them a match Riot says this ID did not play.
  'me#euw': { profile: PROFILE, notPlayed: ['chk-c'], rows: [row('chk-a', 0, 'Abyss', 'Jett'),
    row('chk-b', 1, 'Bind', 'Sova'), row('chk-c', 2, 'Lotus', 'Omen'), row('chk-d', 3, 'Haven', 'Killjoy')] },
  // The profile could not be loaded right now, and its match is graded anyway.
  'busy#euw': { profileError: RATE_LIMITED, rows: [row('chk-e', 4, 'Split', 'Raze')] },
  // The profile could not be loaded, and the run finds no such account.
  'ghost#euw': { profileError: RATE_LIMITED, listError: 'Account not found.' },
  // The profile could not be loaded, and the run cannot reach Riot either.
  'stuck#euw': { profileError: RATE_LIMITED, listError: 'The tracker refused the server key.' },
  // Connected once, renamed since: HenrikDev no longer has the ID.
  'gone#euw': { profileError: 'HenrikDev could not find that Riot ID. Check Name#TAG is exact.',
    listError: 'Account not found.' },
  // Answers slowly, so the field can be edited while it is checked.
  'slow#euw': { profile: PROFILE, delay: 2500, rows: [] },
};
const calls = [];
const param = (p, k) => {
  const m = new RegExp('[?&]' + k + '=([^&]*)').exec(p);
  return m ? decodeURIComponent(m[1]) : '';
};
const api = require(path.join(REPO, 'src/main/services/api-client'));
api.get = async (p) => {
  calls.push(p);
  const answer = (data, status = 200) => ({ ok: status < 400, status, data });
  const acct = ACCOUNTS[param(p, 'username').toLowerCase()];
  if (!acct) return answer({ error: 'Not part of this check.' }, 404);
  if (p.startsWith('/api/coach/player-stats')) {
    if (acct.delay) await wait(acct.delay);
    return answer(acct.profile ? { ...acct.profile } : { error: acct.profileError });
  }
  if (p.startsWith('/api/coach/recent-matches')) {
    return answer(acct.listError ? { error: acct.listError } : { matches: acct.rows });
  }
  if (p.startsWith('/api/coach/match-rounds')) {
    const r = (acct.rows || []).find((x) => x.matchId === param(p, 'matchId'));
    if (!r || (acct.notPlayed || []).includes(r.matchId)) return answer({ error: 'That Riot ID is not in this match.' });
    return answer({ ...JSON.parse(JSON.stringify(RIOT)), matchId: r.matchId, map: r.map,
      queue: r.mode.toLowerCase(), me: { ...RIOT.me, agent: r.agent } });
  }
  return answer({ error: 'Not part of this check.' }, 404);
};

// ── Reading the pages ───────────────────────────────────────────────────────
/** The Riot ID page as a player sees it. */
const PAGE = `(() => {
  const $ = (id) => document.getElementById(id);
  const st = $('ob-riot-status');
  return {
    field: $('ob-riot').value,
    status: st.hidden ? null : st.textContent,
    tone: st.className,
    next: $('next').textContent,
    reds: [...document.querySelectorAll('.card .btn-primary')].filter((b) => b.offsetParent).map((b) => b.id),
    box: !$('ob-bf').hidden,
    line: $('ob-bf-line').textContent,
    lineErr: $('ob-bf-line').classList.contains('err'),
    rows: [...document.querySelectorAll('#ob-bf-list .ob-bf-row')].map((r) => ({
      failed: r.classList.contains('failed'),
      name: r.querySelector('.ob-bf-name').textContent,
      res: r.querySelector('.ob-bf-res').textContent,
      resTone: r.querySelector('.ob-bf-res').className,
      grade: r.querySelector('.ob-bf-grade').textContent,
    })),
  };
})()`;
/** The Riot ID section of Settings. */
const SET = `(() => {
  const $ = (id) => document.getElementById(id);
  return {
    field: $('riotid').value,
    trk: $('trk-status').hidden ? null : $('trk-status').textContent,
    trkTone: $('trk-status').className,
    bf: $('bf-status').hidden ? null : $('bf-status').textContent,
    bfTone: $('bf-status').className,
    open: !$('bf-open').hidden,
    busy: $('trk-connect').classList.contains('busy'),
  };
})()`;
/** Type into a field the way a player does: the value, then its input event. */
const typeInto = (run, id, value) => run(`(() => {
  const el = document.getElementById('${id}');
  el.value = ${JSON.stringify(value)};
  el.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
})()`);
const GRADED = /^\d{1,3} [SABCD]$/;
const failedReds = (s) => s.reds.join() !== 'ob-connect';
const connectedReds = (s) => s.reds.join() !== 'next';

/**
 * Whether every visible block on one tour page sits inside the page's box.
 * Pages centre their content, so an overflow spills out at BOTH ends. Measured
 * with animations off, because a page mid entrance is offset by its own
 * transform and would read as an overflow that is not there.
 */
const FITS = (n) => `(() => {
  if (!document.getElementById('no-motion')) {
    const s = document.createElement('style');
    s.id = 'no-motion';
    s.textContent = '*, *::before, *::after { animation: none !important; transition: none !important; }';
    document.head.append(s);
  }
  const page = document.querySelector('.page[data-page="${n}"]');
  const box = page.getBoundingClientRect();
  const out = [...page.children].filter((k) => !k.hidden && k.getClientRects().length)
    .map((k) => ({ k, r: k.getBoundingClientRect() }))
    .filter(({ r }) => r.top < box.top - 0.5 || r.bottom > box.bottom + 0.5)
    .map(({ k, r }) => (k.id || k.className) + ' ' + Math.round(r.top) + '..' + Math.round(r.bottom));
  return out.length ? 'page ' + Math.round(box.top) + '..' + Math.round(box.bottom) + ', out: ' + out.join(', ') : '';
})()`;

/**
 * A picture of one window, when OCCLARA_ONBOARDING_SHOTS names a folder,
 * scrolled to the section holding the element `focus` names when it scrolls.
 * Settings is a page of the main window since 8.1, handed in as its
 * { webContents } (fixtures/surfaces.js), which has no isDestroyed of its
 * own: asked of it, the pictures stopped the check at the first Settings one.
 */
const SHOTS = process.env.OCCLARA_ONBOARDING_SHOTS || '';
async function shot(win, name, focus) {
  if (!SHOTS || !win || !win.webContents || win.webContents.isDestroyed()) return;
  try {
    // The windows are transparent; the app's own ground keeps the card legible.
    await win.webContents.executeJavaScript(`(() => {
      document.documentElement.style.background = 'var(--bg)';
      const el = ${JSON.stringify(focus || '')} && document.getElementById(${JSON.stringify(focus || '')});
      if (el) (el.closest('section') || el).scrollIntoView({ block: 'start' });
      return true;
    })()`);
    await wait(250);
    const img = await win.webContents.capturePage();
    fs.mkdirSync(SHOTS, { recursive: true });
    fs.writeFileSync(path.join(SHOTS, name + '.png'), img.toPNG());
  } catch (e) {
    lines.push(`picture ${name} failed: ${e.message}`);
  }
}

const LEVELS = { debug: 0, verbose: 0, info: 1, warning: 2, error: 3 };

setTimeout(async () => {
  const onboardingWindow = require(path.join(REPO, 'src/main/windows/onboarding-window'));
  // Since 8.1 Settings is a page of the main window, in a view of its own.
  const mainWindow = require(path.join(REPO, 'src/main/windows/main-window'));
  const surfaces = require('./fixtures/surfaces');
  const registry = require(path.join(REPO, 'src/main/windows/registry'));
  const C = require(path.join(REPO, 'src/shared/channels'));
  const { ReviewStore } = require(path.join(REPO, 'src/main/services/review-store'));
  // A window first (the tour), else a page view of the main window (Settings).
  const find = (part) => BrowserWindow.getAllWindows()
    .find((w) => !w.isDestroyed() && (w.webContents.getURL() || '').includes(part)) || surfaces.find(part);
  const errs = [];
  // Electron 35 moved the level and the text onto the event; read either.
  const watch = (w, label) => w.webContents.on('console-message', (e, lvl, msg) => {
    const level = typeof lvl === 'number' ? lvl : LEVELS[e && e.level];
    if (level >= 2) errs.push(`${label}: ${msg !== undefined ? msg : e && e.message}`);
  });
  try {
    onboardingWindow.create();
    await wait(3000);
    const win = find('/onboarding/');
    if (!win) return report(false, 'the onboarding window never opened');
    watch(win, 'onboarding');
    const js = (s) => win.webContents.executeJavaScript(s);
    const page = () => js(PAGE);
    const connect = async () => {
      await js("document.getElementById('ob-connect').click(); true");
      return until(() => js("(() => { const b = document.getElementById('ob-connect'); return !b.disabled && b.textContent === 'Connect'; })()"), 10000);
    };

    // ── The welcome page and the shortcuts page fit their card ─────────────
    // The welcome page is the first screen a player ever sees, and with the
    // language picker drawn it spilled out of the card at both ends: the logo
    // cut off at the top, the third step under the footer.
    for (const n of [0, 1]) {
      await js(`go(${n}); true`);
      await wait(400);
      const over = await js(FITS(n));
      lines.push(`page ${n} fits=${!over}${over ? ` (${over})` : ''}`);
      if (over) return report(false, `onboarding page ${n} overflows its card: ${over}`);
    }
    const picker = await js("document.getElementById('ob-language').children.length > 0");
    if (!picker) return report(false, 'the language picker was not drawn, so page 0 was measured without it');

    // ── After every match: the Advanced coaching switch moved here ─────────
    await js('go(2); true');
    await wait(300);
    const over2 = await js(FITS(2));
    const red2 = await js("document.getElementById('next').classList.contains('btn-primary')");
    lines.push(`after every match page fits=${!over2}${over2 ? ` (${over2})` : ''} next is red=${red2}`);
    if (over2) return report(false, `the After every match page overflows its card: ${over2}`);
    if (!red2) return report(false, 'Next lost its red on a page with nothing else to press');

    // ── How Occlara watches: the PC check, both choices, what they save ─────
    // Through the real preload, the real PC_CHECK handler and the real store.
    const pcCheck = require(path.join(REPO, 'src/main/services/pc-check'));
    const pcRules = require(path.join(REPO, 'src/renderer/onboarding/pc-rules'));
    const store = require(path.join(REPO, 'src/main/services/store'));
    const GB = 1024 * 1024 * 1024;
    const WATCH = `(() => {
      const $ = (id) => document.getElementById(id);
      const line = $('ob-pc-line');
      const sizes = [...document.querySelectorAll('#ob-res button')];
      return {
        checking: line.classList.contains('checking'),
        line: line.textContent,
        facts: [...document.querySelectorAll('#ob-pc-facts dd')].map((d) => d.textContent),
        rec: $('ob-rec').getAttribute('aria-checked') === 'true',
        frames: $('ob-frames').getAttribute('aria-checked') === 'true',
        recOff: $('ob-rec').disabled,
        res: sizes.filter((b) => b.classList.contains('active')).map((b) => b.dataset.res).join(),
        open: sizes.filter((b) => !b.disabled).map((b) => b.dataset.res).join(),
        recTag: !$('ob-rec-tag').hidden,
        framesTag: !$('ob-frames-tag').hidden,
      };
    })()`;
    // What the store holds for the recorder: mode and size.
    const recSaved = () => `${store.get('recordingMode')} ${store.get('recordingRes')}`;
    const watched = () => until(async () => { const s = await js(WATCH); return s.checking ? null : s; }, 15000);
    const click = (sel) => js(`document.querySelector(${JSON.stringify(sel)}).click(); true`).then(() => wait(300));

    // This PC as it is. The check's userData is fresh: the store's defaults.
    const facts = await pcCheck.gather();
    await js('go(3); true');
    const here = await watched();
    if (!here) return report(false, 'the PC check never finished on the How Occlara watches page');
    // The GPU's answers to the very asks main gave the page, asked in it again.
    const encoder = await js(`Promise.all(${JSON.stringify(facts.asks)}.map((a) => VideoEncoder.isConfigSupported({
      codec: a.codec, width: a.width, height: a.height, bitrate: a.bitrate, framerate: 30, hardwareAcceleration: 'prefer-hardware',
    }).then((s) => [a.res, !!(s && s.supported)], () => [a.res, false]))).then((x) => Object.fromEntries(x))`);
    const want = pcRules.recommend({ ...facts, encoder });
    const wantFacts = pcRules.factRows({ ...facts, encoder }).map((r) => r.v);
    const wantSaved = want.recordable ? `${want.mode} ${want.res}` : 'off 720';
    lines.push(`this PC: "${here.line}" facts=${JSON.stringify(here.facts)} encoder=${JSON.stringify(encoder)} `
      + `record=${here.rec} frames=${here.frames} res=${here.res} saved="${recSaved()}"`);
    await shot(win, 'onboarding-watch-0-this-pc');
    if (here.line !== want.why) return report(false, `this PC's line is "${here.line}", the rules give "${want.why}"`);
    // The free space can move between two reads: every fact but it exactly, and it to within a GB.
    const freeGb = (s) => parseFloat(String(s));
    if (JSON.stringify(here.facts.slice(0, 5)) !== JSON.stringify(wantFacts.slice(0, 5))
      || Math.abs(freeGb(here.facts[5]) - freeGb(wantFacts[5])) > 1) {
      return report(false, `the page lists ${JSON.stringify(here.facts)}, main read ${JSON.stringify(wantFacts)}`);
    }
    if (here.rec !== (wantSaved.startsWith('auto')) || here.frames === here.rec || recSaved() !== wantSaved) {
      return report(false, `this PC: the page shows record=${here.rec}, the store holds "${recSaved()}", the rules want "${wantSaved}"`);
    }
    const over3 = await js(FITS(3));
    lines.push(`how Occlara watches fits=${!over3}${over3 ? ` (${over3})` : ''}`);
    if (over3) return report(false, `the How Occlara watches page overflows its card: ${over3}`);

    // PCs stood in for: the tour loaded again, main telling it `f`, the GPU
    // answering `yes` to each ask, and the store holding `mode` and `res`.
    const realGather = pcCheck.gather;
    const STAND = { ok: true, gpu: 'NVIDIA GeForce RTX 4070 Laptop GPU', cpu: 'Check CPU', threads: 16, ramBytes: 31.84 * GB,
      display: { width: 1920, height: 1080 }, freeBytes: 200 * GB, drive: 'C:', asks: pcCheck.asks({ width: 1920, height: 1080 }) };
    const standIn = async (f, yes, mode, res) => {
      pcCheck.gather = async () => JSON.parse(JSON.stringify(f));
      store.set('recordingMode', mode);
      store.set('recordingRes', res);
      const loaded = new Promise((r) => win.webContents.once('did-finish-load', r));
      win.webContents.reload();
      await loaded;
      await until(() => js("document.getElementById('dots').children.length === 5"), 10000);
      await js(`window.asked = []; window.VideoEncoder = { isConfigSupported: async (c) => { window.asked.push(c); return { supported: ${yes}, config: c }; } }; true`);
      await js('go(3); true');
      return watched();
    };
    try {
      const big = await standIn(STAND, true, 'auto', '720');
      const asked = await js('window.asked');
      lines.push(`records at 1080p: "${big && big.line}" record=${big && big.rec} res=${big && big.res} tagged=${big && big.recTag} saved="${recSaved()}" asked=${JSON.stringify(asked)}`);
      await shot(win, 'onboarding-watch-1-records-1080p');
      if (!big || !big.rec || big.res !== '1080' || !big.recTag || recSaved() !== 'auto 1080') {
        return report(false, 'a PC that records at 1080p, on a first run, did not pre select and save Record at 1080p');
      }
      const wantAsked = STAND.asks.map((a) => ({ codec: a.codec, width: a.width, height: a.height, bitrate: a.bitrate, framerate: 30, hardwareAcceleration: 'prefer-hardware' }));
      if (JSON.stringify(asked) !== JSON.stringify(wantAsked)) return report(false, `the page asked the encoder ${JSON.stringify(asked)}`);
      await click('#ob-frames');
      const framesSaved = recSaved();
      await click('#ob-res [data-res="1080"]');
      const sizeSaved = recSaved();
      await click('#ob-res [data-res="720"]');
      lines.push(`clicked: Frames only saved "${framesSaved}", 1080p saved "${sizeSaved}", 720p saved "${recSaved()}"`);
      if (framesSaved !== 'off 1080' || sizeSaved !== 'auto 1080' || recSaved() !== 'auto 720') {
        return report(false, 'a choice clicked on the page did not reach the store as it was made');
      }

      const modest = await standIn({ ...STAND, ramBytes: 3.8 * GB, threads: 2 }, true, 'auto', '720');
      lines.push(`a modest PC: "${modest && modest.line}" frames=${modest && modest.frames} tagged=${modest && modest.framesTag} record open=${modest && !modest.recOff} saved="${recSaved()}"`);
      // The longest line the page has, two short facts named: the page still fits.
      const overModest = await js(FITS(3));
      await shot(win, 'onboarding-watch-2-modest');
      if (overModest) return report(false, `the How Occlara watches page overflows its card with its longest line: ${overModest}`);
      if (!modest || !modest.frames || !modest.framesTag || modest.recOff || recSaved() !== 'off 720') {
        return report(false, 'a modest PC did not pre select and save Frames only with Record still open');
      }

      const fullDrive = await standIn({ ...STAND, freeBytes: 5.26 * GB }, true, 'auto', '1080');
      await click('#ob-rec');
      const fullAfter = await js(WATCH);
      lines.push(`a full drive: "${fullDrive && fullDrive.line}" record disabled=${fullDrive && fullDrive.recOff} sizes open="${fullDrive && fullDrive.open}" saved="${recSaved()}" after a click record=${fullAfter.rec}`);
      await shot(win, 'onboarding-watch-3-full-drive');
      if (!fullDrive || !fullDrive.recOff || fullDrive.open !== '' || !fullAfter.frames || recSaved() !== 'off 1080' || !/5\.2 GB/.test(fullDrive.line)) {
        return report(false, 'under 8 GB free, Record could be chosen, or Frames only was not saved');
      }

      const chose = await standIn(STAND, true, 'off', '720');
      lines.push(`shown again after choosing Off: frames=${chose && chose.frames} record tagged=${chose && chose.recTag} saved="${recSaved()}"`);
      await shot(win, 'onboarding-watch-4-chose-off');
      if (!chose || !chose.frames || !chose.recTag || recSaved() !== 'off 720') {
        return report(false, 'the tour shown again reset the Off the player had chosen');
      }

      // A saved 1080p the GPU refuses never records: the recorder's gate asks
      // the same question before every recording. It was kept, shown picked
      // and disabled at once; it is shown unavailable with its reason, and
      // the recommended 720p picked and saved in its place.
      const refused = await standIn(STAND, 'c.width < 1900', 'auto', '1080');
      const refusedTitle = await js("document.querySelector('#ob-res [data-res=\"1080\"]').title");
      lines.push(`a saved 1080p the GPU refuses: "${refused && refused.line}" res=${refused && refused.res} open="${refused && refused.open}" 1080p says "${refusedTitle}" saved="${recSaved()}"`);
      await shot(win, 'onboarding-watch-5-saved-1080p-refused');
      if (!refused || !refused.rec || refused.res !== '720' || refused.open !== '720' || recSaved() !== 'auto 720'
        || refusedTitle !== 'Its encoder does not take 1080p.' || refused.line !== 'This PC can record at 720p. Its encoder does not take 1080p.') {
        return report(false, 'a saved 1080p the GPU refuses was not shown unavailable with its reason, Record at 720p saved in its place');
      }
      // On a modest PC the line did not say it, so the reason is added: the
      // longest line the page can have now, two short facts and the reason.
      const refusedModest = await standIn({ ...STAND, ramBytes: 3.8 * GB, threads: 2 }, 'c.width < 1900', 'auto', '1080');
      const overRefused = await js(FITS(3));
      lines.push(`a modest PC whose GPU refuses a saved 1080p: "${refusedModest && refusedModest.line}" record=${refusedModest && refusedModest.rec} res=${refusedModest && refusedModest.res} saved="${recSaved()}" fits=${!overRefused}`);
      await shot(win, 'onboarding-watch-5b-modest-refused');
      if (overRefused) return report(false, `the How Occlara watches page overflows its card with its longest line: ${overRefused}`);
      if (!refusedModest || !refusedModest.rec || refusedModest.res !== '720' || recSaved() !== 'auto 720'
        || !/keep up\. Its encoder does not take 1080p\.$/.test(refusedModest.line)) {
        return report(false, 'on a modest PC a saved 1080p the GPU refuses was not put right with its reason said');
      }

      // THE KEYS, as a player presses them: sendInputEvent is trusted input,
      // so the browser's own click on Enter is in play, which a dispatched
      // KeyboardEvent never shows. The choices are radios: an arrow moves
      // between them and turns no page; Enter picks one and stays, and on
      // Frames only, the page's last control, picks and goes on.
      const keyed = await standIn(STAND, true, 'auto', '720');
      if (!keyed || recSaved() !== 'auto 1080') return report(false, 'the keyboard walk did not start from Record at 1080p');
      await js("window.keysSeen = 0; window.addEventListener('keydown', () => { window.keysSeen++; }, true); window.recClicks = 0; document.getElementById('ob-rec').addEventListener('click', () => { window.recClicks++; }); true");
      const press = async (sel, code) => {
        await js(`document.querySelector(${JSON.stringify(sel)}).focus(); true`);
        win.focus();
        win.webContents.focus();
        win.webContents.sendInputEvent({ type: 'keyDown', keyCode: code });
        if (code === 'Return') win.webContents.sendInputEvent({ type: 'char', keyCode: '\r' });
        win.webContents.sendInputEvent({ type: 'keyUp', keyCode: code });
        await wait(400);
        return js(`(() => ({ page: [...document.querySelectorAll('.page')].findIndex((p) => !p.hidden), on: document.activeElement && document.activeElement.id,
          rec: document.getElementById('ob-rec').getAttribute('aria-checked') === 'true', frames: document.getElementById('ob-frames').getAttribute('aria-checked') === 'true',
          recClicks: window.recClicks, keys: window.keysSeen }))()`);
      };
      // Each key judged as it lands: an Enter that turned the page put the
      // next one on the last page, where Enter ends the tour.
      const down = await press('#ob-rec', 'Down');
      lines.push(`keys: an arrow on Record ${JSON.stringify(down)} saved="${recSaved()}"`);
      if (!down.keys) return report(false, 'the keys sent never reached the page');
      if (down.page !== 3 || down.on !== 'ob-frames' || !down.frames || recSaved() !== 'off 1080') {
        return report(false, `an arrow on Record did not move to Frames only and pick it on the same page (${JSON.stringify(down)}, "${recSaved()}")`);
      }
      const enterRec = await press('#ob-rec', 'Return');
      lines.push(`keys: Enter on Record ${JSON.stringify(enterRec)} saved="${recSaved()}"`);
      await shot(win, 'onboarding-watch-6-enter-on-record');
      if (enterRec.page !== 3 || !enterRec.rec || enterRec.recClicks !== 1 || recSaved() !== 'auto 1080') {
        return report(false, `Enter on Record did not pick it once and stay on the page (${JSON.stringify(enterRec)}, "${recSaved()}")`);
      }
      const enterFrames = await press('#ob-frames', 'Return');
      lines.push(`keys: Enter on Frames only ${JSON.stringify(enterFrames)} saved="${recSaved()}"`);
      if (enterFrames.page !== 4 || recSaved() !== 'off 1080') {
        return report(false, `Enter on Frames only, the page's last control, did not pick it and go on (${JSON.stringify(enterFrames)}, "${recSaved()}")`);
      }
    } finally {
      pcCheck.gather = realGather;
    }

    // ── The Riot ID page, before anything connects ─────────────────────────
    await js('go(4); true');
    await wait(300);
    const shown = await js("!document.querySelector('.page[data-page=\"4\"]').hidden");
    const parts = await js("!!document.getElementById('ob-riot') && !!document.getElementById('ob-connect')");
    const adv = await js("!!document.querySelector('.page[data-page=\"2\"] #advanced')");
    const fresh = await page();
    lines.push(`riot id page shown=${shown} next="${fresh.next}" field and connect=${parts} advanced on after every match=${adv} idle box hidden=${!fresh.box}`);
    if (!shown || !parts) return report(false, 'the Riot ID page is missing its field or its Connect button');
    if (fresh.next !== 'Skip for now') return report(false, `the last page offers "${fresh.next}", not "Skip for now"`);
    if (!adv) return report(false, 'Advanced coaching did not move to the After every match page');
    if (fresh.box) return report(false, 'with nothing being graded the progress box is already showing');
    // One red button: Connect is the action here until a Riot ID connects, and
    // a red Skip beside it would recommend skipping.
    lines.push(`red buttons on the Riot ID page=${JSON.stringify(fresh.reds)}`);
    if (failedReds(fresh)) {
      return report(false, `the Riot ID page should have Connect as its one red button, has ${JSON.stringify(fresh.reds)}`);
    }

    // Enter in the field is Connect, never "next page": with the field empty
    // it says how a Riot ID is written, without asking the server anything.
    // Enter on the Connect button itself must not also press Next, which on
    // this page would finish the tour.
    const enter = (id) => js(`document.getElementById('${id}').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); true`);
    await js("document.getElementById('ob-riot').value = ''; true");
    await enter('ob-riot');
    await wait(300);
    const hint = (await page()).status || '';
    await enter('ob-connect');
    await wait(1500);
    const still = !!find('/onboarding/');
    lines.push(`enter in the field="${hint}" tour open after enter on connect=${still}`);
    if (!/Name#TAG/.test(hint)) return report(false, 'Enter in an empty field did not say how a Riot ID is written');
    if (!still) return report(false, 'Enter on the Connect button finished the tour');
    if (calls.some((p) => p.startsWith('/api/coach/player-stats'))) {
      return report(false, `an empty field asked the server: ${calls.join(', ')}`);
    }

    // ── A Riot ID edited while it was being checked ─────────────────────────
    // The field saves as it is typed, so by the time the profile answers the
    // field can hold another ID. The answer is about neither: the page says
    // so, stays unconnected, and nothing is graded.
    await typeInto(js, 'ob-riot', 'Slow#EUW');
    await js("document.getElementById('ob-connect').click(); true");
    await wait(400);
    await typeInto(js, 'ob-riot', 'Other#EUW');
    await until(() => js("!document.getElementById('ob-connect').disabled"), 10000);
    await wait(300);
    const stale = await page();
    lines.push(`edited while checked: status="${stale.status}" tone="${stale.tone}" next="${stale.next}" reds=${JSON.stringify(stale.reds)} box=${stale.box}`);
    await shot(win, 'onboarding-1-edited-while-checked');
    if (!/changed while it was being checked/i.test(stale.status || '') || !/\berr\b/.test(stale.tone)) {
      return report(false, `a Riot ID edited while it was being checked did not say so ("${stale.status}")`);
    }
    if (stale.next !== 'Skip for now' || failedReds(stale)) {
      return report(false, 'a Riot ID edited while it was being checked left the page connected');
    }
    if (stale.box) return report(false, 'a progress box shows for a Riot ID that never connected');
    if (calls.some((p) => p.startsWith('/api/coach/recent-matches'))) {
      return report(false, 'a Riot ID edited while it was being checked started grading');
    }

    // ── A profile that could not be loaded right now ────────────────────────
    // A rate limit or the stats service down is not a failed Connect: the run
    // starts all the same and grades the account's matches. The page counts
    // it as connected and says what it does not know: it never saw the rank,
    // and it does not yet know the account exists.
    await typeInto(js, 'ob-riot', 'Busy#EUW');
    await connect();
    const busy = await page();
    lines.push(`profile not loaded: status="${busy.status}" tone="${busy.tone}" next="${busy.next}" reds=${JSON.stringify(busy.reds)}`);
    // Before its run lists the matches nothing has shown the account exists,
    // so not Connected; once the list comes back it is, and the line says so.
    // Which one this read catches depends on how fast the run lists.
    const early = busy.status === "Your rank could not be loaded right now. Your recent matches are being graded from Riot's record."
      && !/\b(ok|err)\b/.test(busy.tone);
    const settled = busy.status === 'Connected. Your rank could not be loaded right now.' && /\bok\b/.test(busy.tone);
    if (!early && !settled) {
      return report(false, `a profile that could not be loaded is not worded honestly ("${busy.status}", ${busy.tone})`);
    }
    if (busy.next !== "Let's go" || connectedReds(busy)) {
      return report(false, `a Connect that started grading offers "${busy.next}" with ${JSON.stringify(busy.reds)} red`);
    }
    const busyRun = await until(async () => {
      const s = await page();
      return /^Graded/.test(s.line) && s.rows.some((r) => r.name.startsWith('Split') && GRADED.test(r.grade)) ? s : null;
    }, 20000);
    lines.push(`its run: line="${busyRun && busyRun.line}" rows=${JSON.stringify(busyRun && busyRun.rows)}`);
    await shot(win, 'onboarding-2-profile-not-loaded');
    if (!busyRun) return report(false, 'the run a Connect without a profile started never painted its graded match');
    if (busyRun.status !== 'Connected. Your rank could not be loaded right now.' || !/\bok\b/.test(busyRun.tone)) {
      return report(false, `a run that listed the account's matches did not settle the Connect as connected ("${busyRun.status}")`);
    }

    // What one real record cannot show, from statuses shaped as backfill.js
    // pushes them, on the fullest the page gets: the two line status above,
    // a two line summary and a full list. These check the page's own
    // formatting and layout, and nothing about the path.
    const status = (over) => Object.assign({
      state: 'done', account: 'Busy#EUW', found: 2, have: 0, skipped: 0, pending: 0, ambiguous: 0, old: 0,
      total: 2, done: 2, graded: 2, upgraded: 0, failed: 0, error: null,
      message: "Graded 2 recent matches from Riot's record.", items: [],
    }, over);
    const item = (over) => Object.assign({
      matchId: 'x', map: 'Abyss', agent: 'Jett', mode: 'Competitive', result: 'Victory', score: '13-11',
      startedAt: 1, status: 'graded', id: 'valorant-1758391200000-abcdef', grade: { score: 74, letter: 'B', provisional: false },
    }, over);
    registry.broadcast(C.PUSH_BACKFILL, status({ items: [
      item({ matchId: 'b', map: 'Bind', agent: 'Sova', result: 'Defeat', score: '9-13', startedAt: 2,
        grade: { score: 58, letter: 'D', provisional: false } }),
      item({ matchId: 'a' }),
    ] }));
    await wait(500);
    const two = await page();
    lines.push(`a loss and a win: ${JSON.stringify(two.rows.map((r) => r.resTone + '|' + r.res + '|' + r.grade))}`);
    if (!/\bloss\b/.test((two.rows[0] || {}).resTone || '') || (two.rows[0] || {}).grade !== '58 D') {
      return report(false, 'a Defeat is not painted as a loss with its grade');
    }
    if (!/\bwin\b/.test((two.rows[1] || {}).resTone || '')) return report(false, 'a Victory is not marked as a win');
    const full = ['Haven', 'Split', 'Sunset', 'Ascent', 'Pearl', 'Icebox'].map((map, i) => item({
      matchId: 'f' + i, map, startedAt: 10 + i, id: 'valorant-1758391200000-f' + i,
      grade: { score: 70 + i, letter: 'B', provisional: false } }));
    full.push(item({ matchId: 'f6', status: 'failed', map: 'Breeze', agent: 'Omen', result: null, score: null, startedAt: 9, id: null, grade: null }));
    registry.broadcast(C.PUSH_BACKFILL, status({
      done: 7, total: 7, graded: 6, have: 2, failed: 1,
      message: "Graded 6 recent matches from Riot's record. 2 were already in your library. 1 match could not be fetched.",
      items: full,
    }));
    await wait(600);
    const over4 = await js(FITS(4));
    lines.push(`riot id page with a two line status, a two line summary and a full list fits=${!over4}${over4 ? ` (${over4})` : ''}`);
    await shot(win, 'onboarding-3-fullest');
    if (over4) return report(false, `the Riot ID page overflows its card with rows in it: ${over4}`);

    // ── A Riot ID edited away from the one that connected ──────────────────
    // The line, the rows and Let's go were all about Busy#EUW. With another ID
    // in the field none of them are about what the player is looking at.
    await typeInto(js, 'ob-riot', 'Ghost#EUW');
    await wait(200);
    const away = await page();
    lines.push(`edited away: status="${away.status}" box=${away.box} next="${away.next}" reds=${JSON.stringify(away.reds)}`);
    if (away.status !== null || away.box) return report(false, 'the page kept a line or rows about a Riot ID no longer in the field');
    if (away.next !== 'Skip for now' || failedReds(away)) {
      return report(false, 'the page kept saying connected about a Riot ID no longer in the field');
    }

    // ── A run that finds no such account ───────────────────────────────────
    // The profile could not be loaded, so nothing knew the account does not
    // exist until the run asked Riot. Once it says so, the page stops saying
    // it connected, and the run's own red line says why.
    await connect();
    const ghost = await until(async () => { const s = await page(); return s.box && s.lineErr ? s : null; }, 15000);
    lines.push(`no such account: status="${ghost && ghost.status}" line="${ghost && ghost.line}" next="${ghost && ghost.next}" reds=${JSON.stringify(ghost && ghost.reds)}`);
    await shot(win, 'onboarding-4-no-such-account');
    if (!ghost || !/no account under that ID/i.test(ghost.line)) return report(false, 'the run never said the account does not exist');
    if (ghost.status !== null || ghost.next !== 'Skip for now' || failedReds(ghost)) {
      return report(false, 'a run that found no such account left the page saying it connected');
    }

    // ── A run that cannot reach Riot ────────────────────────────────────────
    // Not only a missing account leaves a Connect without a profile unproven:
    // any run that ends in an error does, and the page stops saying it
    // connected. A typo hidden by a rate limit otherwise finished the tour
    // looking connected.
    await typeInto(js, 'ob-riot', 'Stuck#EUW');
    await connect();
    const stuck = await until(async () => { const s = await page(); return s.box && s.lineErr ? s : null; }, 15000);
    lines.push(`riot unreachable: status="${stuck && stuck.status}" line="${stuck && stuck.line}" next="${stuck && stuck.next}"`);
    if (!stuck || !/could not be reached/i.test(stuck.line)) return report(false, 'the run never said Riot could not be reached');
    if (stuck.status !== null || stuck.next !== 'Skip for now' || failedReds(stuck)) {
      return report(false, 'a run that could not reach Riot left the page saying it connected');
    }

    // ── A profile found: the run, through the real app ─────────────────────
    await typeInto(js, 'ob-riot', 'Me#EUW');
    await connect();
    const me = await page();
    lines.push(`connected: status="${me.status}" tone="${me.tone}" next="${me.next}" reds=${JSON.stringify(me.reds)}`);
    if (me.status !== 'Connected, Gold 2.' || !/\bok\b/.test(me.tone)) {
      return report(false, `Connect with a profile found did not say Connected with the rank ("${me.status}")`);
    }
    if (me.next !== "Let's go" || connectedReds(me)) {
      return report(false, `after Connect the footer offers "${me.next}" with ${JSON.stringify(me.reds)} red, not Let's go`);
    }
    const first = await until(async () => { const s = await page(); return s.rows.some((r) => GRADED.test(r.grade)) ? s : null; }, 20000);
    if (!first) return report(false, 'no graded match was painted from the run Connect started');
    lines.push(`first graded: line="${first.line}" rows=${JSON.stringify(first.rows.map((r) => r.name + '|' + r.grade))}`);

    // Settings, opened while the run works, follows the same run.
    mainWindow.show('settings');
    const sw = await until(() => find('/settings/'), 5000);
    if (!sw) return report(false, 'the Settings page never opened');
    watch(sw, 'settings');
    const sjs = (s) => sw.webContents.executeJavaScript(s);
    const settings = () => sjs(SET);
    const sMid = await until(async () => {
      const a = (await page()).line;
      const s = await settings();
      const b = (await page()).line;
      return s.trk && s.bf && a === b && s.bf === a ? s : null;
    }, 10000);
    lines.push(`settings while it works: profile="${sMid && sMid.trk}" line="${sMid && sMid.bf}" open=${sMid && sMid.open}`);
    await shot(sw, 'settings-0-while-grading', 'riotid');
    if (!sMid) return report(false, 'Settings did not paint the line the Riot ID page shows for the same run');
    if (!/^Connected\. rank Gold 2/.test(sMid.trk) || !/\bok\b/.test(sMid.trkTone)) {
      return report(false, `Settings does not show the connected profile ("${sMid.trk}")`);
    }
    if (/^Grading/.test(sMid.bf) && sMid.open) return report(false, 'Settings offered Open Matches before the run finished');

    const done = await until(async () => { const s = await page(); return /^Graded/.test(s.line) ? s : null; }, 30000);
    if (!done) return report(false, 'the run Connect started never finished on the Riot ID page');
    lines.push(`done: line="${done.line}" rows=${JSON.stringify(done.rows.map((r) => r.name + '|' + r.res + '|' + r.grade))}`);
    await shot(win, 'onboarding-5-graded');
    if (done.line !== "Graded 3 recent matches from Riot's record. 1 match could not be fetched.") {
      return report(false, `the run ended with "${done.line}"`);
    }
    // Newest first; the match Riot says this ID did not play is not fetched;
    // every other row carries the grade of the review the run saved.
    const saved = new ReviewStore(path.join(ud, 'reviews')).list('valorant');
    const order = ['Haven', 'Lotus', 'Bind', 'Abyss'];
    if (done.rows.length !== 4 || !done.rows.every((r, i) => r.name.startsWith(order[i]))) {
      return report(false, `the rows are ${done.rows.map((r) => r.name).join(', ')}, not the run's four matches newest first`);
    }
    const lotus = done.rows[1];
    if (!lotus.failed || lotus.res !== 'Not fetched' || lotus.grade) return report(false, 'a match Riot has no record of is not marked Not fetched');
    for (const r of done.rows.filter((x) => !x.failed)) {
      const map = order.find((m) => r.name.startsWith(m));
      const meta = saved.find((m) => m.map === map && m.source === 'riot');
      const want = meta && meta.grade ? `${meta.grade.score} ${meta.grade.letter}` : null;
      if (!want || r.grade !== want) return report(false, `${map}: the row says "${r.grade}", the review the run saved says "${want}"`);
      if (r.res !== 'Victory 13-11' || !/\bwin\b/.test(r.resTone)) return report(false, `${map}: the result reads "${r.res}"`);
    }
    const sDone = await until(async () => { const s = await settings(); return s.bf === done.line ? s : null; }, 5000);
    lines.push(`settings at the end: line="${sDone && sDone.bf}" tone="${sDone && sDone.bfTone}" open=${sDone && sDone.open}`);
    await shot(sw, 'settings-1-graded', 'riotid');
    if (!sDone || !/\bok\b/.test(sDone.bfTone) || !sDone.open) {
      return report(false, 'Settings did not end the run with its outcome and Open Matches');
    }

    await js("document.getElementById('next').click(); true");
    if (!await until(() => !find('/onboarding/'), 5000)) return report(false, "Let's go did not finish the tour");

    // ── The tour shown again to a player already connected ─────────────────
    // A logout shows the tour again. The Riot ID in config has its profile,
    // so the page is connected from the start, exactly as after Connect, and
    // shows the run that already graded the account.
    onboardingWindow.create();
    const again = await until(() => find('/onboarding/'), 5000);
    if (!again) return report(false, 'the tour did not open a second time');
    watch(again, 'onboarding again');
    const ajs = (s) => again.webContents.executeJavaScript(s);
    await until(() => ajs("document.getElementById('ob-riot').value === 'Me#EUW' && document.getElementById('dots').children.length > 0"), 8000);
    await wait(400);
    await ajs('go(4); true');
    await wait(400);
    const rerun = await ajs(PAGE);
    lines.push(`tour again: field="${rerun.field}" status="${rerun.status}" next="${rerun.next}" reds=${JSON.stringify(rerun.reds)} rows=${rerun.rows.length}`);
    await shot(again, 'onboarding-6-tour-again');
    if (rerun.field !== 'Me#EUW' || rerun.status !== 'Connected, Gold 2.' || !/\bok\b/.test(rerun.tone)) {
      return report(false, `the tour shown again to a connected player says "${rerun.status}", not Connected with the rank`);
    }
    if (rerun.next !== "Let's go" || connectedReds(rerun)) {
      return report(false, `the tour shown again to a connected player offers "${rerun.next}" with ${JSON.stringify(rerun.reds)} red`);
    }
    if (!rerun.box || rerun.rows.length !== 4) return report(false, 'the tour shown again does not show the run that graded the account');
    // Connected from config is connected like any other: another ID in the
    // field is not it, and the quiet way out still finishes the tour.
    await typeInto(ajs, 'ob-riot', 'Me#EUX');
    await wait(200);
    const edited = await ajs(PAGE);
    lines.push(`tour again, another ID typed: status=${JSON.stringify(edited.status)} next="${edited.next}" reds=${JSON.stringify(edited.reds)} box=${edited.box}`);
    if (edited.status !== null || edited.box || edited.next !== 'Skip for now' || failedReds(edited)) {
      return report(false, 'the tour shown again kept saying connected for another Riot ID');
    }
    await ajs("document.getElementById('next').click(); true");
    if (!await until(() => !find('/onboarding/'), 5000)) return report(false, 'Skip for now did not finish the tour');

    // ── The tour shown again to a player connected with no ranked profile ──
    // Main remembers the last Riot ID shown to exist (riotConnected): the Me
    // run listed its matches, so it is Me#EUW now. One shown to exist with no
    // profile kept is connected from the start too.
    const remembered = store.get('riotConnected');
    lines.push(`remembered as connected: ${remembered}`);
    if (String(remembered || '').toLowerCase() !== 'me#euw') return report(false, `main did not remember the Riot ID its run proved (${remembered})`);
    store.set('riotId', 'Busy#EUW');
    store.set('riotConnected', 'Busy#EUW');
    onboardingWindow.create();
    const third = await until(() => find('/onboarding/'), 5000);
    if (!third) return report(false, 'the tour did not open a third time');
    const tjs = (s) => third.webContents.executeJavaScript(s);
    await until(() => tjs("document.getElementById('ob-riot').value === 'Busy#EUW' && document.getElementById('dots').children.length > 0"), 8000);
    await wait(400);
    await tjs('go(4); true');
    await wait(400);
    const plain = await tjs(PAGE);
    lines.push(`tour again, no ranked profile: status="${plain.status}" next="${plain.next}"`);
    if (plain.status !== 'Connected.' || !/\bok\b/.test(plain.tone) || plain.next !== "Let's go") {
      return report(false, `the tour shown again to a player connected without a profile says "${plain.status}"`);
    }
    await tjs("document.getElementById('next').click(); true");
    if (!await until(() => !find('/onboarding/'), 5000)) return report(false, "Let's go did not finish the third tour");
    store.set('riotId', 'Me#EUW');

    // ── Settings: no line about an ID that is no longer in the field ────────
    const before = await settings();
    await typeInto(sjs, 'riotid', 'Me#EUX');
    await wait(200);
    const off = await settings();
    await shot(sw, 'settings-1b-edited-away', 'riotid');
    await typeInto(sjs, 'riotid', 'me#euw');
    await wait(200);
    const back = await settings();
    lines.push(`settings edited away: profile=${JSON.stringify(off.trk)} line=${JSON.stringify(off.bf)} open=${off.open}`);
    lines.push(`settings, the same ID in another case: profile=${JSON.stringify(back.trk)} line=${JSON.stringify(back.bf)} open=${back.open}`);
    if (!before.trk || !before.bf || !before.open) return report(false, 'Settings lost its lines before the field was edited');
    if (off.trk !== null || off.bf !== null || off.open) {
      return report(false, 'Settings kept Connected or the grading line for a Riot ID no longer in the field');
    }
    if (back.trk !== before.trk || back.bf !== before.bf || !back.open) {
      return report(false, 'the same Riot ID typed back in another case did not bring its lines back');
    }
    await typeInto(sjs, 'riotid', 'Me#EUW');
    await wait(900);

    // ── Settings: a profile that could not be loaded is not a failure ──────
    await typeInto(sjs, 'riotid', 'Busy#EUW');
    await sjs("document.getElementById('trk-connect').click(); true");
    const sBusy = await until(async () => {
      const s = await settings();
      return !s.busy && s.trk && !/^Checking/.test(s.trk) ? s : null;
    }, 10000);
    lines.push(`settings, profile not loaded: "${sBusy && sBusy.trk}" (${sBusy && sBusy.trkTone})`);
    await shot(sw, 'settings-2-profile-not-loaded', 'riotid');
    if (!sBusy || !/rank could not be loaded right now/i.test(sBusy.trk) || /\berr\b/.test(sBusy.trkTone)) {
      return report(false, `Settings reports a Connect that is grading as a failure ("${sBusy && sBusy.trk}")`);
    }

    // ── Settings: a run that finds no such account ─────────────────────────
    // The line above the grading line said the matches were being graded; once
    // the run finds no such account it stops saying so, and the red grading
    // line says why.
    await typeInto(sjs, 'riotid', 'Ghost#EUW');
    await sjs("document.getElementById('trk-connect').click(); true");
    const sGhost = await until(async () => {
      const s = await settings();
      return !s.busy && s.bf && /\berr\b/.test(s.bfTone) ? s : null;
    }, 15000);
    lines.push(`settings, no such account: profile=${JSON.stringify(sGhost && sGhost.trk)} line="${sGhost && sGhost.bf}"`);
    await shot(sw, 'settings-3-no-such-account', 'riotid');
    if (!sGhost || !/no account under that ID/i.test(sGhost.bf)) return report(false, 'Settings never said the account does not exist');
    if (sGhost.trk !== null) return report(false, 'Settings kept saying the matches of an account that does not exist are being graded');

    // ── Settings: an ID connected once that Riot no longer has ─────────────
    // A renamed account. Its profile from the earlier Connect is on disk, and
    // Settings reopened read it back as "Connected, rank Gold 2" over the
    // Connect that had just said the ID does not exist.
    store.set('playerStats', { ...PROFILE, _riotId: 'Gone#EUW' });
    store.set('riotConnected', 'Gone#EUW');
    await typeInto(sjs, 'riotid', 'Gone#EUW');
    await wait(1200);
    await sjs("document.getElementById('trk-connect').click(); true");
    const sGone = await until(async () => {
      const s = await settings();
      return !s.busy && s.trk && /could not find/i.test(s.trk) ? s : null;
    }, 10000);
    if (!sGone) return report(false, 'Connect never said the renamed Riot ID could not be found');
    sw.webContents.reload();
    const reopened = await until(async () => {
      const s = await settings().catch(() => null);
      return s && s.field === 'Gone#EUW' ? s : null;
    }, 10000);
    await wait(1500);
    const after = await settings().catch(() => null);
    lines.push(`settings reopened on a renamed ID: profile=${JSON.stringify(after && after.trk)} `
      + `kept=${JSON.stringify(store.get('playerStats'))} connected=${JSON.stringify(store.get('riotConnected'))}`);
    if (!reopened || !after) return report(false, 'Settings did not reopen');
    if (/connected/i.test(after.trk || '')) return report(false, `Settings reopened says a Riot ID Riot has no record of is connected ("${after.trk}")`);
    if (store.get('playerStats') || store.get('riotConnected')) return report(false, 'the profile of a Riot ID that does not exist was kept');

    if (errs.length) return report(false, 'renderer errors: ' + errs.join(' | '));
    report(true, 'ok');
  } catch (e) {
    report(false, 'threw: ' + e.message);
  }
}, 6500);

require(path.join(REPO, 'src/main/index.js'));

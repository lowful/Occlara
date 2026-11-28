'use strict';

/**
 * THE WINDOW ON THE SAMPLE LIBRARY, PICTURED FOR LOOKING (Orbit, 27 Nov 2026).
 *
 * shot-surface.js loads a surface with no preload, so the shell draws no
 * links and Home only its empty state: fine for a stylesheet, blind to a
 * page with data. This boots the shell and a page each with its REAL preload
 * and answers their IPC from the sample library (scripts/fixtures/
 * proof-reviews.js, the Jett on Abyss, 13 : 11, a B of 71), then draws the
 * page over the shell at TOP_H, as the window composes them, into
 * dist-surface-shots/demo-<scene>.png. Nothing is asked of the network, no
 * licence or account is real, and nothing is recorded.
 *
 * Dev tool, never shipped (electron-builder packages src/ and assets/). Its
 * windows open hidden behind a zero opacity, ignoring the mouse, so nothing
 * shows on the desktop or takes a click. Run one Electron at a time.
 *
 *   env -u ELECTRON_RUN_AS_NODE npx electron scripts/shot-demo.js home review recording
 *
 * Scenes: home, matches, patterns, stats, practice, trainer, clips, coach,
 * settings, profile, invite, whatsnew, feedback, players, duos, review, recording,
 * waiting, held, stop (recording between matches, on Matches), building (a
 * review still being built), ready and opening (Review ready, then opening).
 * The live rating and the Recording view (9.1): waiting is the Recording view
 * Start opens (no seal), waitingrated the same with the live rating on,
 * sealedwait the sealed screen before the reader has seen a game, rated the
 * match with the rating's row, ratingoff with the kill feed unread,
 * ratedsmall the rated screen at the window's least (960 by 640), homelr and
 * homeconfirm Home's switch on and its confirm open, settingslr Settings at
 * the live rating's rows, and leaguewait League's quiet Recording view.
 */
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'dist-surface-shots');
const C = require('../src/shared/channels');
const { PAGES } = require('../src/shared/shell-nav');
const proof = require('./fixtures/proof-reviews');
const patterns = require('../src/shared/patterns');
const progress = require('../src/shared/progress');
const moments = require('../src/shared/moments');
const { served } = require('../src/shared/valorant-review');
const { scrubText } = require('../src/shared/plain-text');

const TOP_H = Number((fs.readFileSync(path.join(ROOT, 'src', 'main', 'windows', 'main-window.js'), 'utf8').match(/const TOP_H = (\d+);/) || [])[1]) || 56;
const W = Number(process.env.SHOT_W) || 1280;
const H = Number(process.env.SHOT_H) || 800;

app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
// 9.1: SHOT_DPR=2 draws every scene as a 2x screen does (the moon's sharpness).
if (Number(process.env.SHOT_DPR) > 0) app.commandLine.appendSwitch('force-device-scale-factor', String(Number(process.env.SHOT_DPR)));
app.on('window-all-closed', () => {});

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Each scene: the shell's state, the page under it (or none), what main has said.
const SCENES = {
  home: { page: 'home' },
  matches: { page: 'matches' },
  patterns: { page: 'patterns' },
  stats: { page: 'stats' },
  practice: { page: 'practice' },
  clips: { page: 'moments' },
  trainer: { page: 'trainer' },
  coach: { page: 'coach' },
  settings: { page: 'settings' },
  profile: { page: 'profile' },
  invite: { page: 'invite' },
  whatsnew: { page: 'whatsnew' },
  feedback: { page: 'feedback' },
  players: { page: 'players' },
  duos: { page: 'duos' },
  review: { page: 'review' },
  // The match rating block (9.1: out of 100), and its replay at full time.
  reviewrating: { page: 'review', act: "document.getElementById('v-rating-wrap').scrollIntoView({ block: 'start' }); true" },
  // The share image (9.1: the number, no letter), its sheet open on the dark card.
  share: { page: 'review', act: "document.getElementById('share').click(); true" },
  replay: { page: 'review', act: "document.getElementById('rt-play').click(); setTimeout(() => { const s = document.getElementById('rt-r-skip'); if (s) s.click(); }, 400); true" },
  // The review still being built, then made whole: Review ready (review.js
  // readyFirst). `whole` is how long after the whole review lands to take
  // the picture: the card dropped in, then the window opening out of it.
  building: { page: 'review', work: true },
  ready: { page: 'review', work: true, whole: 980 },
  opening: { page: 'review', work: true, whole: 1440 },
  stop: { page: 'matches', coaching: true },
  recording: { page: null, sealed: true, coaching: true, live: 'live' },
  waiting: { page: 'home', rec: true, coaching: true, live: 'waiting' },
  waitingrated: { page: 'home', rec: true, coaching: true, live: 'waiting', lr: true },
  sealedwait: { page: null, sealed: true, coaching: true, live: 'waiting' },
  rated: { page: null, sealed: true, coaching: true, live: 'rated', lr: true },
  ratingoff: { page: null, sealed: true, coaching: true, live: 'blind', lr: true },
  ratedsmall: { page: null, sealed: true, coaching: true, live: 'rated', lr: true, w: 960, h: 640 },
  homelr: { page: 'home', lr: true },
  homeconfirm: { page: 'home', act: "document.getElementById('h-lr-switch').click(); true" },
  settingslr: { page: 'settings', lr: true, act: "document.getElementById('lr-row').scrollIntoView({ block: 'start' }); true" },
  leaguewait: { page: 'home', rec: true, coaching: true, live: null, game: 'lol' },
  held: { page: null, sealed: true, held: true },
  // 9.1, Home (the owner's items 1, 4, 8, 9, 10): the rank card on a tier
  // (`rank`, its RR and the last game's change), the newest match ungraded
  // (a two round Haven recording), the page scrolled to its foot, the last
  // match card under the pointer (`hover`, a selector), and every bundled
  // rank icon on one sheet. SHOT_DPR=2 draws any scene at 2x.
  homerank: { page: 'home', rank: { tier: 'Diamond 1', rr: 57, change: 11 } },
  homeimmortal: { page: 'home', rank: { tier: 'Immortal 2', rr: 312, change: -14 }, act: "document.querySelector('.home').scrollTop = 99999; true" },
  homeradiant: { page: 'home', rank: { tier: 'Radiant', rr: 544, change: 24 }, act: "document.querySelector('.home').scrollTop = 99999; true" },
  homeiron: { page: 'home', rank: { tier: 'Iron 1', rr: 8, change: -19 }, act: "document.querySelector('.home').scrollTop = 99999; true" },
  // The moon held at two moments two minutes apart (sky.js reads window.__occlaraMoonTime), to see it turn.
  moont0: { page: 'home', act: 'window.__occlaraMoonTime = 1000000; true' },
  moont1: { page: 'home', act: 'window.__occlaraMoonTime = 1000120; true' },
  homeungraded: { page: 'home', ungraded: true, rank: { tier: 'Gold 3', rr: 88, change: 21 } },
  homefoot: { page: 'home', rank: { tier: 'Diamond 1', rr: 57, change: 11 }, act: "document.querySelector('.home').scrollTop = 99999; true" },
  homehover: { page: 'home', rank: { tier: 'Diamond 1', rr: 57, change: 11 }, hover: '#last' },
  hometip: { page: 'home', hover: '#top-list .way' },
  homerecording: { page: 'home', coaching: true },
  statsrank: { page: 'stats', rank: { tier: 'Diamond 1', rr: 57, change: 11 } },
  rankicons: { page: 'home', act: `(() => {
    const names = ['iron-1','iron-2','iron-3','bronze-1','bronze-2','bronze-3','silver-1','silver-2','silver-3','gold-1','gold-2','gold-3',
      'platinum-1','platinum-2','platinum-3','diamond-1','diamond-2','diamond-3','ascendant-1','ascendant-2','ascendant-3',
      'immortal-1','immortal-2','immortal-3','radiant','unranked'];
    const s = document.createElement('div');
    s.style.cssText = 'position:fixed;inset:0;z-index:99;background:#060510;display:grid;grid-template-columns:repeat(9,1fr);gap:10px;padding:24px;align-content:start';
    for (const n of names) {
      const c = document.createElement('div');
      c.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:6px;font:12px sans-serif;color:#9899a3';
      const i = new Image(); i.src = '../../../assets/ranks/' + n + '.webp'; i.width = 64; i.height = 64;
      i.onerror = () => { c.style.outline = '2px solid red'; };
      c.append(i, n); s.append(c);
    }
    document.body.append(s); return true; })()` },
};

/** A rank history whose newest rated game is `r.tier` at `r.rr` RR, the last game `r.change` (rank-tiers.js: elo is the place times 100 plus the RR). */
function historyOf(r) {
  if (!r) return { points: [] };
  const Tiers = require('../src/shared/rank-tiers');
  const place = Tiers.placeOf(r.tier);
  const elo = place * 100 + r.rr;
  const steps = [-18, 21, -15, 19, r.change];
  const points = [];
  let e = elo;
  for (let i = steps.length - 1; i >= 0; i--) { points.unshift({ date: Date.now() - (steps.length - i) * 86400000, elo: e, change: steps[i] }); e -= steps[i]; }
  for (const p of points) {
    const at = Math.max(0, Math.min(Tiers.TIERS.length - 1, Math.floor(p.elo / 100)));
    p.tier = Tiers.capped(Tiers.TIERS[at]) ? Tiers.TIERS[at] : r.tier;
  }
  points[points.length - 1].tier = r.tier;
  return { points };
}

function liveOf(kind) {
  if (!kind) return null;
  const startedAt = Date.now() - 24 * 60 * 1000;
  if (kind === 'waiting') return { state: 'waiting', startedAt };
  const v = { state: 'live', startedAt, mode: 'standard', map: 'Abyss', agent: 'Jett', team: 7, enemy: 6,
    tape: ['W', 'L', 'L', 'W', 'L', 'W', 'W', 'W', 'L', 'W', 'W', 'L', 'L'], round: 14 };
  // The live rating's own fields (live-rating-service.js pick), as main sends them.
  if (kind === 'rated') v.rating = { value: 6.8, shown: '6.8', tier: 'fair', last: { delta: '+0.4', up: true, down: false, label: 'Opening kill' }, line: [6, 6.1, 5.8, 6.2, 6.4, 6.3, 6.8] };
  if (kind === 'blind') v.rating = { reading: false };
  return v;
}

async function load(win, file, query) {
  for (let i = 0; i < 6; i++) {
    try { await win.loadFile(file, query ? { query } : undefined); return true; } catch { await wait(400); }
  }
  return false;
}

async function capture(wc) {
  for (let i = 0; i < 5; i++) {
    try { return await wc.capturePage(); } catch { await wait(400); }
  }
  return null;
}

function makeWindow(w, h, preload) {
  const win = new BrowserWindow({
    width: w, height: h, show: false, frame: false, backgroundColor: '#060510',
    opacity: 0, focusable: false, skipTaskbar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: false, preload },
  });
  win.setIgnoreMouseEvents(true);
  return win;
}

app.whenReady().then(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'occlara-demo-'));
  const seeded = proof.seed(path.join(ud, 'profile'), { now: Date.now() - 30 * 60 * 1000 });
  const store = seeded.store;
  const recent = () => store.recent('valorant', patterns.LOOK_BACK);
  const present = (review) => scrubText({ ...served(review) });

  let scene = SCENES.home;
  const shellState = () => ({ page: scene.page || 'home', shown: scene.sealed || scene.rec ? null : scene.page, sealed: !!scene.sealed, held: !!scene.held, rec: !!scene.rec, maximized: false });
  // A scene with a rank has a Riot ID, so Home asks for it (9.1).
  const riotId = () => (scene.rank ? 'Me#EUW' : '');
  const state = () => ({ gameId: scene.game || 'valorant', isCoaching: !!scene.coaching, isPaused: false, licenseActive: true, sounds: false, riotId: riotId(),
    live: { liveMap: true, liveAgent: true, liveScore: true, liveRound: true, liveRating: !!scene.lr, liveRatingStream: false }, notice: null });
  // 9.1: the newest match a two round Haven recording, ungraded.
  const UNGRADED_ID = `valorant-${Date.now() - 5 * 60 * 1000}-ungrad`;
  const ungradedRow = () => ({ id: UNGRADED_ID, game: 'valorant', at: Date.now() - 5 * 60 * 1000, title: null, map: 'Haven', mode: null, result: null, score: null,
    grade: null, verified: false, source: null, aiLog: null, work: null });
  const handlers = {
    [C.STATE_GET]: () => state(),
    [C.CONFIG_GET]: () => ({ game: scene.game || 'valorant', language: 'en', liveMap: true, liveAgent: true, liveScore: true, liveRound: true, liveRating: !!scene.lr, liveRatingStream: false, riotId: riotId(), recordingMode: 'auto', recordingRes: '1080' }),
    [C.LIVE_RATING_SET]: (_e, on) => ({ ok: true, on: on === true }),
    [C.SHELL_GET]: () => shellState(),
    [C.LIVE_GET]: () => liveOf(scene.live),
    [C.ACCOUNT_GET]: () => proof.SEEDED_VIEW,
    [C.SOCIAL_STATE]: () => ({ live: false }),
    [C.DUOS_STATE]: () => ({ duos: false }),
    [C.REVIEWS_LIST]: (_e, game) => (scene.ungraded && (game || 'valorant') === 'valorant' ? [ungradedRow()] : [])
      .concat(store.list(game || null).map((r) => ({ ...r, aiLog: null, work: null }))),
    [C.REVIEW_GET]: (_e, id) => {
      if (id === UNGRADED_ID) return { id, kind: 'valorant', game: { map: 'Haven' }, watched: { rounds: 2, deaths: 1 }, grade: { score: null, categories: [], notes: [] }, focus: null, rounds: [] };
      const e = store.get(id); return e ? present({ ...e.review, id: e.review.id || id }) : null;
    },
    [C.PATTERNS_GET]: () => ({ game: 'valorant', ...patterns.summarise(recent()), progress: progress.libraryProgress(recent()) }),
    [C.PROGRESS_GET]: (_e, id) => progress.matchProgress(recent(), id),
    [C.MOMENTS_GET]: () => moments.build('valorant', recent(), { patterns: patterns.summarise(recent()), clips: (id) => store.clipsOf(id).map((c) => c.name), url: (id, name) => `occlara-clip://review/${id}/${name}`, frames: () => null, recordingMode: 'auto' }),
    [C.STATS_RANK_HISTORY]: () => (scene.rank ? historyOf(scene.rank) : []),
    // Stats (9.1, its rank card): a dashboard with the scene's rank and nothing more.
    [C.STATS_DASHBOARD]: () => (scene.rank ? { game: 'valorant', gameLabel: 'Valorant', statsSupported: true, mode: 'competitive',
      categories: { impact: { avg: 71, direction: 'up' }, positioning: { avg: 64, direction: 'flat' }, utility: { avg: 58, direction: 'down' }, aim: { avg: 69, direction: 'flat' } },
      rank: { value: scene.rank.tier, direction: 'flat' }, winRate: { value: 54, direction: 'up' },
      rankLine: [`${scene.rank.rr} RR`, 'Peak Diamond 2 in E9A3'], accolades: '', profile: null, topAgents: [], sessions: [], sessionCount: 0,
      patterns: null, grading: null, matches: { matches: [], fetchedAt: Date.now(), mode: 'competitive' }, riotId: 'Me#EUW', riotConnected: true } : null),
    [C.STATS_MATCHES]: () => ({ matches: [], fetchedAt: Date.now(), mode: 'competitive' }),
    [C.STATS_OPENED_FOR]: () => null,
    [C.CHANGELOG_NOTICE]: () => null,
    [C.PRACTICE_TODAY]: () => null,
    [C.WRAPPED_ENTRY]: () => null,
    [C.REVIEW_RIOT]: () => null,
    [C.LOL_REVIEW_GET]: () => null,
    // Practice: the real practice store over the sample library and the drill library.
    [C.PRACTICE_GET]: (_e, game, asked) => practice.get(typeof game === 'string' ? game : null, asked || null),
    [C.PRACTICE_MARK]: () => ({ ok: false, error: 'demo' }),
    // The Trainer: no runs kept.
    [C.TRAINER_GET]: () => ({ runs: [], opened: null, replay: null }),
    [C.TRAINER_REPLAYS]: () => ({ list: [], fresh: [] }),
    // Profile: the real builder on the sample library and the seeded account.
    [C.PROFILE_GET]: () => profileModel.build(proof.SEEDED_VIEW, store.recent('valorant', 50), { riotId: '', peak: null, peakSeason: null, history: null }, undefined, null),
    [C.REFERRAL_GET]: () => proof.SEEDED_REFERRAL,
    [C.LICENSE_GET]: () => ({}),
    [C.APP_VERSION]: () => ({ current: require('../package.json').version, state: 'current' }),
    [C.CLIPS_USAGE]: () => ({ bytes: 0, count: 0, cap: 10 * 1024 * 1024 * 1024 }),
    [C.BACKFILL_STATUS]: () => null,
    [C.CHANGELOG_REFRESH]: () => null,
    [C.FEEDBACK_INFO]: () => null,
    [C.CHAT_MATCHES]: () => null,
    // 9.1: still while recording, the history, the storage.
    [C.STILL_GET]: () => ({ still: !!scene.coaching }),
    [C.HISTORY_GET]: () => ({ back: true, forward: false, backTo: 'matches', forwardTo: null, backLabel: 'Matches', forwardLabel: null, at: 1, length: 2 }),
    [C.HISTORY_GO]: () => null,
    [C.STORAGE_GET]: () => null,
  };
  const memo = new Map();
  const practice = require('../src/main/services/practice-store').createPractice({
    store: { get: (k) => memo.get(k), set: (k, v) => memo.set(k, v) },
    recent: (g) => store.recent(g, patterns.LOOK_BACK), summarise: (s) => patterns.summarise(s),
    band: () => null, riotId: () => '', busy: () => false, game: () => 'valorant', gameLabel: () => 'Valorant',
    open: () => {}, changed: () => {}, reviews: store,
  });
  const profileModel = require('../src/shared/profile');
  for (const [ch, fn] of Object.entries(handlers)) if (ch && ch !== 'undefined') ipcMain.handle(ch, async (e, ...a) => fn(e, ...a));
  // A page that painted itself armed is let in at once, as main-window.js would.
  ipcMain.on(C.PAGE_READY, (e) => { try { e.sender.send(C.PUSH_PAGE, { phase: 'enter', dir: 'none' }); } catch { /* gone */ } });

  const wanted = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  for (const name of (wanted.length ? wanted : ['home'])) {
    scene = SCENES[name];
    if (!scene) { console.log(`skip ${name}: no such scene`); continue; }
    const sw = scene.w || W, sh = scene.h || H;
    const shellWin = makeWindow(sw, sh, path.join(ROOT, 'src', 'preload', 'shell-preload.js'));
    let pageWin = null;
    try {
      if (!await load(shellWin, path.join(ROOT, 'src', 'renderer', 'shell', 'index.html'))) { console.log(`FAILED ${name}: the shell did not load`); continue; }
      shellWin.showInactive();
      const page = scene.sealed || scene.rec ? null : PAGES.find((p) => p.id === scene.page);
      if (page) {
        pageWin = makeWindow(sw, sh - TOP_H, path.join(ROOT, 'src', 'preload', page.preload));
        if (!await load(pageWin, path.join(ROOT, 'src', 'renderer', page.surface, 'index.html'), { embed: '1', ...page.query })) { console.log(`FAILED ${name}: its page did not load`); continue; }
        pageWin.showInactive();
        if (page.id === 'review') {
          await wait(400);
          const id = seeded.ids[0];
          const e = store.get(id);
          const whole = present({ ...e.review, id });
          if (scene.work) {
            const endedAt = Date.now() - 95 * 1000;
            const work = { path: 'riot', steps: ['saved', 'riot', 'deaths', 'look', 'writing'], step: 'riot', endedAt, until: endedAt + 6 * 60 * 1000, scoreboard: false };
            pageWin.webContents.send(C.PUSH_VALORANT_REVIEW, { ...whole, work });
            if (scene.whole) {
              await wait(3000);
              pageWin.webContents.send(C.PUSH_VALORANT_REVIEW, whole);
              await wait(scene.whole);
            }
          } else {
            pageWin.webContents.send(C.PUSH_VALORANT_REVIEW, whole);
          }
        }
      }
      // Fonts, the moon and every entrance settle before the picture (a
      // scene timed from a review made whole is taken at its own moment).
      if (!scene.whole) await wait(Number(process.env.SHOT_WAIT) || 3600);
      // A scene's own act in its page (a click, a scroll), then a moment to settle.
      if (scene.act && pageWin) { await pageWin.webContents.executeJavaScript(scene.act).catch(() => null); await wait(900); }
      // A scene's pointer over an element of its page (9.1): its hover state, pictured.
      if (scene.hover && pageWin) {
        const at = await pageWin.webContents.executeJavaScript(`(() => { const e = document.querySelector(${JSON.stringify(scene.hover)}); if (!e) return null;
          const r = e.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`).catch(() => null);
        if (at) {
          pageWin.webContents.sendInputEvent({ type: 'mouseEnter', x: at.x, y: at.y });
          pageWin.webContents.sendInputEvent({ type: 'mouseMove', x: at.x, y: at.y });
          await wait(900);
        }
      }
      // SHOT_EVAL=<module>: a module that reads the laid out pages (the site
      // proof's readers, say) gets the scene's two webContents, and what it
      // returns is written beside the picture as demo-<scene>.json.
      if (process.env.SHOT_EVAL) {
        const read = require(path.resolve(process.env.SHOT_EVAL));
        const got = await read({ scene: name, shell: shellWin.webContents, page: pageWin ? pageWin.webContents : null }).catch((e) => ({ error: String(e && e.stack || e) }));
        fs.writeFileSync(path.join(OUT, `demo-${name}.json`), JSON.stringify(got, null, 2) + '\n');
      }
      const a = await capture(shellWin.webContents);
      const b = pageWin ? await capture(pageWin.webContents) : null;
      if (!a) { console.log(`FAILED ${name}: no picture`); continue; }
      const comp = new BrowserWindow({ show: false, width: 200, height: 200 });
      try {
        await comp.loadURL('data:text/html,<canvas id="c"></canvas>');
        const png = await comp.webContents.executeJavaScript(`(async () => {
          const load = (src) => new Promise((r) => { const i = new Image(); i.onload = () => r(i); i.src = src; });
          const a = await load(${JSON.stringify(a.toDataURL())});
          const c = document.getElementById('c'); c.width = a.width; c.height = a.height;
          const g = c.getContext('2d'); g.drawImage(a, 0, 0);
          ${b ? `const b = await load(${JSON.stringify(b.toDataURL())}); g.drawImage(b, 0, Math.round(${TOP_H} * a.width / ${sw}));` : ''}
          return c.toDataURL('image/png');
        })()`);
        const out = path.join(OUT, `demo-${name}.png`);
        fs.writeFileSync(out, Buffer.from(png.split(',')[1], 'base64'));
        console.log(`shot ${name} -> ${path.relative(ROOT, out)}`);
      } finally { comp.destroy(); }
    } catch (e) {
      console.log(`FAILED ${name}: ${e.message}`);
    } finally {
      shellWin.destroy();
      if (pageWin) pageWin.destroy();
    }
  }
  try { fs.rmSync(ud, { recursive: true, force: true }); } catch { /* left in temp */ }
  app.quit();
});

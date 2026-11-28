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
 * ratedsmall the rated screen at the window's least (960 by 640), ratedmove
 * the match's next push after it (68 to 72, its +4 drawn), homelr and
 * homeconfirm Home's switch on and its confirm open, settingslr Settings at
 * the live rating's rows, and leaguewait League's quiet Recording view.
 * The bar (9.1, items 2 and 22): news is What's new in the bar after an
 * update, on Home; updating and updatingsoon the updater downloading (with a
 * percent, and before main has one), on Matches; updateready "Restart to
 * update" on Home; barall both and the game picker on Matches, barnarrow the
 * same at the window's least width and barmid at 1100, homenarrow Home
 * with both at the least width; updatefocus the
 * keyboard's ring on Restart to update. Scenes also take news, update and
 * sact (JS run in the bar's own document before the picture).
 * Matches (9.1) on a fuller library (fixtures/many-matches.js): matchesmany,
 * matchestip (a point of the trend read), matchespeek and matchesfoot (a
 * row's peek, under and over its row), matcheslist, matchesmenu,
 * matchesconfirm (Delete match, asked), matchesdraw (the trend mid draw),
 * matchesnarrow and matchesnarrowrows (960 by 700), matcheslol (League).
 * Clips (9.1, items 12, 13, 18) on a fuller library (fixtures/clips-demo.js):
 * clipsrich, clipsstore (Storage open), clipslow (the drive nearly full),
 * clipsmenu (a clip's menu), clipsconfirm (Delete clip asking), clipsfilter
 * (a map chosen), clipsscroll (scrolled under the bar), clipssmall (960 by
 * 640), and clipsplay (the hero's clip playing: every clip URL answers the
 * generated canvas recording through the app's own clip scheme).
 * Practice (9.1, item 17): practicetall the page whole, practiceopen a drill
 * opened, practicetrainer the Trainer under Mechanics, practicesmall at 960 by
 * 640, practiceblank with no matches yet, practiceasked and practiceinplan
 * opened from a review, practicetrend a plan made before every sample match
 * with a log of seven marks, and trainerstill the arena its still is cut from.
 */
const { app, BrowserWindow, ipcMain, protocol, nativeImage } = require('electron');
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
const { manyRows } = require('./fixtures/many-matches');

const TOP_H = Number((fs.readFileSync(path.join(ROOT, 'src', 'main', 'windows', 'main-window.js'), 'utf8').match(/const TOP_H = (\d+);/) || [])[1]) || 56;
const W = Number(process.env.SHOT_W) || 1280;
const H = Number(process.env.SHOT_H) || 800;

app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
// 9.1: SHOT_DPR=2 draws every scene as a 2x screen does (the moon's sharpness).
if (Number(process.env.SHOT_DPR) > 0) app.commandLine.appendSwitch('force-device-scale-factor', String(Number(process.env.SHOT_DPR)));
app.on('window-all-closed', () => {});
// Clips are played from occlara-clip://, registered before the app is ready as
// main does (9.1): the review's scenes and the clips scenes answer it.
const clipScheme = require('../src/main/services/clip-scheme');
const reviewClips = require('../src/main/services/review-clips');
protocol.registerSchemesAsPrivileged([clipScheme.PRIVILEGED]);
const clipsDemo = require('./fixtures/clips-demo');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// What's new as main says it after an update (changelog.js noticeFor).
const NEWS = { version: '9.1.0', text: 'Occlara updated to 9.1.0.', link: "See what's new" };
// Each scene: the shell's state, the page under it (or none), what main has said.
const SCENES = {
  home: { page: 'home' },
  matches: { page: 'matches' },
  patterns: { page: 'patterns' },
  stats: { page: 'stats' },
  practice: { page: 'practice' },
  // 9.1, item 17: the Practice page whole (a tall window), a drill opened in
  // place, the log, the page at the window's least, with no matches yet
  // (blank: the practice store reads no reviews), and opened from a review.
  practicetall: { page: 'practice', h: 2200 },
  practiceopen: { page: 'practice', act: "(() => { const r = document.querySelector('.pc-group[data-group=\"awareness\"] .pc-d-head') || document.querySelector('.pc-d-head'); r.click(); setTimeout(() => r.closest('.pc-drill').scrollIntoView({ block: 'center' }), 600); return true; })()" },
  practicetrainer: { page: 'practice', act: "document.querySelector('.pc-group[data-group=\"mechanics\"]').scrollIntoView({ block: 'start' }); true" },
  practicesmall: { page: 'practice', w: 960, h: 640, act: "document.getElementById('pc-groups').scrollIntoView({ block: 'start' }); true" },
  practiceblank: { page: 'practice', blank: true, h: 1400 },
  practiceasked: { page: 'practice', asked: { key: 'cause:repeek', title: 'Repeeked the same angle' }, h: 1200 },
  practiceinplan: { page: 'practice', asked: { key: 'untraded', title: 'Deaths nobody traded' } },
  // A plan made before every sample match, so Is it working has something to say, and a log of seven marks.
  practicetrend: { page: 'practice', practiceState: 'old', h: 2400 },
  // The Trainer's arena alone, its panel hidden: the still Practice shows under Mechanics (src/renderer/practice/trainer-still.jpg).
  trainerstill: { page: 'trainer', settle: 3000, act: "(() => { const r = document.querySelector('.tr-item[data-id=\"site-preaim-easy\"]'); if (r) r.click(); setTimeout(() => { document.getElementById('detail').style.visibility = 'hidden'; }, 200); return true; })()" },
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
  // The rating moved after its first paint: its move drawn, as players see it.
  ratedmove: { page: null, sealed: true, coaching: true, live: 'rated', livenext: 'ratedmove', lr: true },
  homelr: { page: 'home', lr: true },
  homeconfirm: { page: 'home', act: "document.getElementById('h-lr-switch').click(); true" },
  // The same at 1600 and at the window's least: the confirm stands under the switch that asked.
  homeconfirmwide: { page: 'home', w: 1600, h: 1000, act: "document.getElementById('h-lr-switch').click(); true" },
  homeconfirmnarrow: { page: 'home', w: 960, h: 640, act: "document.getElementById('h-lr-switch').click(); true" },
  settingslr: { page: 'settings', lr: true, act: "document.getElementById('lr-row').scrollIntoView({ block: 'start' }); true" },
  leaguewait: { page: 'home', rec: true, coaching: true, live: null, game: 'lol' },
  held: { page: null, sealed: true, held: true },
  // 9.1: a recording paused, the bar's resume icon (the centred play mark) on the
  // Recording view and on the sealed screen (paused).
  recpaused: { page: 'home', rec: true, coaching: true, live: 'waiting', paused: true },
  sealedpaused: { page: null, sealed: true, coaching: true, live: 'live', paused: true },
  // The bar (9.1): What's new and the updater.
  news: { page: 'home', news: NEWS },
  updating: { page: 'matches', update: { state: 'downloading', version: '9.1.1', percent: 42 } },
  updatingsoon: { page: 'matches', update: { state: 'downloading', version: '9.1.1', percent: null } },
  updateready: { page: 'home', update: { state: 'ready', version: '9.1.1' } },
  barall: { page: 'matches', news: NEWS, update: { state: 'ready', version: '9.1.1' } },
  barnarrow: { page: 'matches', news: NEWS, update: { state: 'ready', version: '9.1.1' }, w: 960, h: 640 },
  barmid: { page: 'matches', news: NEWS, update: { state: 'ready', version: '9.1.1' }, w: 1100 },
  updatefocus: { page: 'matches', update: { state: 'ready', version: '9.1.1' }, sact: "document.getElementById('upd').focus(); true" },
  // Home at the window's least width, What's new and the update ready.
  homenarrow: { page: 'home', news: NEWS, update: { state: 'ready', version: '9.1.1' }, w: 960, h: 640 },
  // Mid match the bar shows neither, even were main to answer (leak).
  sealedbar: { page: null, sealed: true, coaching: true, live: 'live', leak: true, news: NEWS, update: { state: 'ready', version: '9.1.1' } },
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
  hometrendtip: { page: 'home', hover: '#trend .way' },
  home960: { page: 'home', w: 960, h: 640 },
  home1100: { page: 'home', w: 1100, h: 760, rank: { tier: 'Gold 3', rr: 88, change: 21 } },
  homelol: { page: 'home', game: 'lol' },
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
  // Matches on a fuller library (9.1, scripts/fixtures/many-matches.js): the
  // grade trend, when you play best, every kind of row; a point of the trend
  // read, a row's peek, its menu and the delete it asks first; and the
  // window at its least.
  matchesmany: { page: 'matches', many: true },
  matchestip: { page: 'matches', many: true, act: "chart.select(14); true" },
  matchespeek: { page: 'matches', many: true, act: "(() => { const r = document.querySelectorAll('#list .m-row')[4]; r.scrollIntoView({ block: 'center' }); setTimeout(() => { r.focus(); r.closest('.m-item').classList.add('peek-show'); }, 300); return true; })()" },
  matcheslist: { page: 'matches', many: true, act: "document.getElementById('list').scrollIntoView({ block: 'start' }); true" },
  matchesmenu: { page: 'matches', many: true, act: "(() => { const b = document.querySelectorAll('#list .m-more')[4]; b.scrollIntoView({ block: 'center' }); setTimeout(() => b.click(), 300); return true; })()" },
  matchesconfirm: { page: 'matches', many: true, act: "(() => { const b = document.querySelectorAll('#list .m-more')[2]; b.click(); setTimeout(() => { const d = document.querySelector('#m-menu [data-action=delete]'); if (d) d.click(); }, 200); return true; })()" },
  matchesnarrow: { page: 'matches', many: true, w: 960, h: 700 },
  matchesnarrowrows: { page: 'matches', many: true, w: 960, h: 700, act: "document.getElementById('list').scrollIntoView({ block: 'start' }); true" },
  matchesfoot: { page: 'matches', many: true, act: "(() => { const all = document.querySelectorAll('#list .m-row'); const r = all[all.length - 1]; r.scrollIntoView({ block: 'end' }); setTimeout(() => { r.closest('.m-item').dispatchEvent(new Event('pointerenter')); r.closest('.m-item').classList.add('peek-show'); }, 300); return true; })()" },
  // The trend mid draw: played again, pictured 420ms in.
  matchesdraw: { page: 'matches', many: true, act: 'chart.play(); true', after: 420 },
  matcheslol: { page: 'matches', game: 'lol' },
  matcheswhen: { page: 'matches', many: true, act: "document.getElementById('when').scrollIntoView({ block: 'start' }); true" },
  // Delete refused (the demo answers nothing): the dialog says so and stays.
  matchesrefused: { page: 'matches', many: true, act: "(() => { const it = [...document.querySelectorAll('#list .m-item')].find((x) => /import/.test(x.dataset.id)); it.scrollIntoView({ block: 'center' }); setTimeout(() => { it.querySelector('.m-more').click(); setTimeout(() => { document.querySelector('#m-menu [data-action=delete]').click(); setTimeout(() => document.getElementById('m-confirm-go').click(), 150); }, 150); }, 300); return true; })()", after: 1400 },
  // 9.1, the review page (items 6, 7, 16, 18): `media` seeds the newest match
  // with a real highlight clip (round 17, the 4K) and a death clip and look
  // (round 2), made by the bundled ffmpeg from the map's art, served the way
  // main serves clips (occlara-clip://, clip-scheme.js).
  reviewhl: { page: 'review', media: true },
  reviewscrolled: { page: 'review', media: true, act: "document.querySelector('main.body').scrollTo(0, 260); true" },
  reviewrounds: { page: 'review', media: true, act: "document.getElementById('v-rounds-wrap').scrollIntoView({ block: 'start' }); true" },
  reviewmenu: { page: 'review', media: true, act: "document.getElementById('more').click(); true" },
  reviewdelete: { page: 'review', media: true, act: "document.getElementById('more').click(); document.getElementById('delete-match').click(); true" },
  // The replay paused on a kill with its highlight's clip, and on a death with its own.
  replayclip: { page: 'review', media: true, act: "window.RatingView.play(true); window.RatingView.pause(); for (let k = 0; k < 300; k++) { const s = window.RatingView.state(); if (s && /h17-clip/.test(s.media || '')) break; window.RatingView.nextEvent(); } true" },
  replaydeath: { page: 'review', media: true, act: "window.RatingView.play(true); window.RatingView.pause(); for (let k = 0; k < 300; k++) { const s = window.RatingView.state(); if (s && /r2-clip/.test(s.media || '')) break; window.RatingView.nextEvent(); } true" },
  replaynone: { page: 'review', media: true, act: "window.RatingView.play(true); window.RatingView.pause(); window.RatingView.nextEvent(); window.RatingView.nextEvent(); window.RatingView.nextEvent(); true" },
  replayend: { page: 'review', media: true, act: "window.RatingView.play(true); window.RatingView.finish(); true" },
  reviewnarrow: { page: 'review', media: true, w: 960, h: 640 },
  // 9.1 after the review: a League review, its Verdict saying the champion,
  // the role, the queue and the length once (the plain line over it gone).
  reviewlol: { page: 'review', lolReview: true, game: 'lol' },
  // 9.1 after the review: round 17's highlight in its row, its poster (or,
  // made later, the map's art until it lands), and the poster landing.
  reviewhlrow: { page: 'review', media: true, posters: true, act: "(() => { const r = document.getElementById('round-17'); r.querySelector('.v-fold').click(); setTimeout(() => r.scrollIntoView({ block: 'center' }), 300); return true; })()", after: 1400 },
  reviewhlrowart: { page: 'review', media: true, act: "(() => { const r = document.getElementById('round-17'); r.querySelector('.v-fold').click(); setTimeout(() => r.scrollIntoView({ block: 'center' }), 300); return true; })()", after: 1400 },
  replaynarrow: { page: 'review', media: true, w: 960, h: 640, act: "window.RatingView.play(true); window.RatingView.pause(); for (let k = 0; k < 300; k++) { const s = window.RatingView.state(); if (s && /h17-clip/.test(s.media || '')) break; window.RatingView.nextEvent(); } true" },
  // Clips, 9.1 (fixtures/clips-demo.js).
  clipsrich: { page: 'moments', clips: 'rich', storage: 'some' },
  clipsstore: { page: 'moments', clips: 'rich', storage: 'some', act: "document.getElementById('mo-store-btn').click(); true" },
  clipslow: { page: 'moments', clips: 'rich', storage: 'low', act: "document.getElementById('mo-store-btn').click(); true" },
  clipsmenu: { page: 'moments', clips: 'rich', storage: 'some', act: "(() => { const b = document.querySelectorAll('#mo-list .mo-row .mo-more')[2]; b.closest('.mo-row').scrollIntoView({ block: 'center' }); setTimeout(() => b.click(), 300); return true; })()" },
  clipsconfirm: { page: 'moments', clips: 'rich', storage: 'some', act: "(() => { const b = document.querySelector('#mo-hero .mo-more'); b.click(); setTimeout(() => document.querySelector('#mo-menu [data-act=\"delete\"]').click(), 200); return true; })()" },
  clipsfilter: { page: 'moments', clips: 'rich', storage: 'some', act: "(() => { document.querySelector('#mo-f-map .dd-btn').click(); setTimeout(() => { const o = [...document.querySelectorAll('.dd-opt')].find((n) => n.textContent === 'Split'); if (o) o.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); document.getElementById('mo-log').scrollIntoView({ block: 'start' }); }, 300); return true; })()" },
  clipsscroll: { page: 'moments', clips: 'rich', storage: 'some', act: "document.querySelector('.sheet').scrollTop = 250; true" },
  clipssmall: { page: 'moments', clips: 'rich', storage: 'some', w: 960, h: 640 },
  clipsplay: { page: 'moments', clips: 'rich', storage: 'some', video: true },
  // A filter's list open, and the line a delete leaves.
  clipsdd: { page: 'moments', clips: 'rich', storage: 'some', act: "(() => { document.getElementById('mo-log').scrollIntoView({ block: 'start' }); setTimeout(() => document.querySelector('#mo-f-agent .dd-btn').click(), 300); return true; })()" },
  clipsdeleted: { page: 'moments', clips: 'rich', storage: 'some', act: "(() => { document.querySelector('#mo-hero .mo-more').click(); setTimeout(() => { document.querySelector('#mo-menu [data-act=\"delete\"]').click(); setTimeout(() => document.getElementById('mo-cf-yes').click(), 200); }, 200); return true; })()" },
  // The keyboard's ring on the hero's play mark, then on a clip's more button.
  clipsfocus: { page: 'moments', clips: 'rich', storage: 'some', act: "document.querySelector('#mo-hero .mo-hplay').focus(); true" },
  clipsfocus2: { page: 'moments', clips: 'rich', storage: 'some', act: "(() => { const b = document.querySelectorAll('#mo-list .mo-row .mo-more')[0]; b.closest('.mo-row').scrollIntoView({ block: 'center' }); b.focus(); return true; })()" },
  // After the 9.1 review: the player at the window's least, whole (its title,
  // Close, the line and the controls on screen), and the drive too full to
  // record said under the title at the same size.
  clipsplayer960: { page: 'moments', clips: 'rich', storage: 'some', video: true, w: 960, h: 640, act: "document.querySelector('#mo-hero .mo-hplay').click(); true", after: 2500 },
  clipslow960: { page: 'moments', clips: 'rich', storage: 'low', w: 960, h: 640 },
  // 9.1: a row's clip deleted, the row read back as main would ("Clip deleted").
  clipsdeletedrow: { page: 'moments', clips: 'rich', storage: 'some', after: 2600, act: "(() => { const b = document.querySelectorAll('#mo-list .mo-row .mo-more')[1]; const key = b.closest('.mo-row').dataset.key; b.closest('.mo-row').scrollIntoView({ block: 'center' }); setTimeout(() => { b.click(); setTimeout(() => { document.querySelector('#mo-menu [data-act=\"delete\"]').click(); setTimeout(() => { document.getElementById('mo-cf-yes').click(); setTimeout(() => { const r = document.querySelector('.mo-row[data-key=\"' + key + '\"]'); if (r) r.scrollIntoView({ block: 'center' }); }, 1200); }, 200); }, 200); }, 300); return true; })()" },
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

/*
 * THE REVIEW'S CLIPS FOR A PICTURE (9.1): two real clips beside the newest
 * sample match, a slow push into a map's art, H.264 in Matroska as a clip is
 * kept, and its review naming them: round 17's highlight with its four kills
 * marked, round 2's death with the coach's look. Made once per run.
 */
async function demoMedia(store, id, review) {
  const ffmpeg = require('ffmpeg-static');
  const { execFileSync } = require('child_process');
  const make = (name, map, secs) => {
    if (store.hasClip(id, name)) return;
    const out = path.join(os.tmpdir(), `occlara-demo-${process.pid}-${name}`);
    const frames = secs * 30;
    execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-loop', '1', '-i', path.join(ROOT, 'assets', 'valorant', 'maps', `${map}.jpg`),
      '-vf', `scale=2560:-2,zoompan=z='min(zoom+0.0007,1.22)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=1280x720:fps=30,format=yuv420p`,
      '-t', String(secs), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '24', '-an', out]);
    store.saveClip(id, name, fs.readFileSync(out));
    try { fs.unlinkSync(out); } catch { /* temp */ }
  };
  make('h17-clip.mkv', 'Abyss', 9);
  make('r2-clip.mkv', 'Split', 15);
  // Their posters (9.1), one still each as services/clip-posters.js makes it,
  // where clips.js posterAt says: the highlight's just before its first kill.
  const poster = (name, atSec) => {
    if (store.poster(id, name)) return;
    try {
      const jpg = execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-ss', atSec.toFixed(2), '-i', store.clipFile(id, name), '-frames:v', '1',
        '-vf', 'scale=480:-2', '-q:v', '5', '-f', 'image2', '-vcodec', 'mjpeg', 'pipe:1']);
      store.savePoster(id, name, jpg);
    } catch { /* no poster: the art stands in */ }
  };
  const clipsMod = require('../src/shared/clips');
  poster('h17-clip.mkv', clipsMod.posterAt({ kills: [2400] }));
  poster('r2-clip.mkv', clipsMod.posterAt({ death: 11000 }));
  const r = JSON.parse(JSON.stringify(review));
  const at = (n) => r.rounds.find((c) => c.n === n);
  if (at(17)) at(17).highlight = { clip: 'h17-clip.mkv', length: 9000, kills: [2400, 3600, 4700, 7400], cuts: [] };
  if (at(2) && at(2).died) at(2).forensics = { cause: 'isolated', what: 'You swung the angle alone.', better: 'Wait for a teammate before you swing.', source: 'riot', at: Date.now(), clip: 'r2-clip.mkv', clipDeath: 11000 };
  return r;
}

function liveOf(kind) {
  if (!kind) return null;
  const startedAt = Date.now() - 24 * 60 * 1000;
  if (kind === 'waiting') return { state: 'waiting', startedAt };
  const v = { state: 'live', startedAt, mode: 'standard', map: 'Abyss', agent: 'Jett', team: 7, enemy: 6,
    tape: ['W', 'L', 'L', 'W', 'L', 'W', 'W', 'W', 'L', 'W', 'W', 'L', 'L'], round: 14 };
  // The live rating's own fields (live-rating-service.js pick), as main sends them.
  if (kind === 'rated') v.rating = { value: 6.8, shown: '68', tier: 'fair', last: { delta: '+4', up: true, down: false, label: 'Opening kill' }, line: [6, 6.1, 5.8, 6.2, 6.4, 6.3, 6.8] };
  // The next push of the same match: the rating moved 68 to 72, so the
  // screen draws the move (+4, the difference of the two shown numbers, as
  // live-rating.js moveOf gives it) beside the engine's label. The first
  // paint never draws a move, so `livenext` sends this one after it.
  if (kind === 'ratedmove') {
    Object.assign(v, { team: 8, tape: [...v.tape.slice(0, 13), 'W'], round: 15 });
    v.rating = { value: 7.2, shown: '72', tier: 'good', last: { delta: '+4', up: true, down: false, label: 'Double kill' }, line: [6, 6.1, 5.8, 6.2, 6.4, 6.3, 6.8, 7.2] };
  }
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
  // As main presents a review (index.js present): served, and its clips on
  // disk given their URLs and, 9.1, the posters made beside them (a scene's
  // `posters`; without, the review shows the map's art in their place).
  const present = (review) => {
    const out = scrubText({ ...served(review) });
    return review && review.id ? reviewClips.presentClips(out, { has: (n) => store.hasClip(review.id, n), url: (n) => clipScheme.urlFor(review.id, n),
      poster: (n) => { const b = scene.posters ? store.poster(review.id, n) : null; return b ? `data:image/jpeg;base64,${b}` : null; } }) : out;
  };
  // Clips deleted in a scene (9.1): the page reads them back as main would,
  // "Clip deleted". By the match's last word and the clip's name, since the
  // demo library's ids follow the clock and change between two reads.
  const deletedClips = new Set();
  const deletedKey = (rid, name) => `${String(rid).split('-').pop()}/${name}`;
  const markDeleted = (model) => {
    for (const m of (model && model.matches) || []) {
      for (const x of m.moments || []) {
        if (x.clip && deletedClips.has(deletedKey(m.id, x.clip.name))) Object.assign(x, { clip: null, clipGone: 'deleted', clipGoneText: moments.GONE.deleted });
      }
    }
    if (model && deletedClips.size) model.best = moments.bestOf(model.matches, model.compilation, model.game);
    return model;
  };
  let scene = SCENES.home;
  const shellState = () => ({ page: scene.page || 'home', shown: scene.sealed || scene.rec ? null : scene.page, sealed: !!scene.sealed, held: !!scene.held, rec: !!scene.rec, maximized: false });
  // A scene with a rank has a Riot ID, so Home asks for it (9.1).
  const riotId = () => (scene.rank ? 'Me#EUW' : '');
  const state = () => ({ gameId: scene.game || 'valorant', isCoaching: !!scene.coaching, isPaused: !!scene.paused, licenseActive: true, sounds: false, riotId: riotId(),
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
    [C.REVIEWS_LIST]: (_e, game) => (scene.many ? manyRows(Date.now() - 20 * 60 * 1000)
      : (scene.ungraded && (game || 'valorant') === 'valorant' ? [ungradedRow()] : [])
        .concat(store.list(game || null).map((r) => ({ ...r, aiLog: null, work: null })))),
    [C.REVIEW_GET]: (_e, id) => {
      if (id === UNGRADED_ID) return { id, kind: 'valorant', game: { map: 'Haven' }, watched: { rounds: 2, deaths: 1 }, grade: { score: null, categories: [], notes: [] }, focus: null, rounds: [] };
      const e = store.get(id); return e ? present({ ...e.review, id: e.review.id || id }) : null;
    },
    [C.PATTERNS_GET]: () => ({ game: 'valorant', ...patterns.summarise(recent()), progress: progress.libraryProgress(recent()) }),
    [C.PROGRESS_GET]: (_e, id) => progress.matchProgress(recent(), id),
    [C.MOMENTS_GET]: () => (scene.clips === 'rich' ? markDeleted(clipsDemo.withPosters(clipsDemo.model({ now: Date.now() }), nativeImage))
      : moments.build('valorant', recent(), { patterns: patterns.summarise(recent()), clips: (id) => store.clipsOf(id).map((c) => c.name), url: (id, name) => `occlara-clip://review/${id}/${name}`, frames: () => null, recordingMode: 'auto' })),
    [C.STATS_RANK_HISTORY]: () => (scene.rank ? historyOf(scene.rank) : []),
    // Stats (9.1, its rank card): a dashboard with the scene's rank and nothing more.
    [C.STATS_DASHBOARD]: () => (scene.rank ? { game: 'valorant', gameLabel: 'Valorant', statsSupported: true, mode: 'competitive',
      categories: { impact: { avg: 71, direction: 'up' }, positioning: { avg: 64, direction: 'flat' }, utility: { avg: 58, direction: 'down' }, aim: { avg: 69, direction: 'flat' } },
      rank: { value: scene.rank.tier, direction: 'flat' }, winRate: { value: 54, direction: 'up' },
      rankLine: [`${scene.rank.rr} RR`, 'Peak Diamond 2 in E9A3'], accolades: '', profile: null, topAgents: [], sessions: [], sessionCount: 0,
      patterns: null, grading: null, matches: { matches: [], fetchedAt: Date.now(), mode: 'competitive' }, riotId: 'Me#EUW', riotConnected: true } : null),
    [C.STATS_MATCHES]: () => ({ matches: [], fetchedAt: Date.now(), mode: 'competitive' }),
    [C.STATS_OPENED_FOR]: () => null,
    // The bar (9.1): What's new and the updater as the scene has them, as main
    // would answer: nothing while recording.
    // (leak: main answering anyway, to see the bar hold them back itself.)
    [C.CHANGELOG_NOTICE]: () => (scene.coaching && !scene.leak ? null : scene.news || null),
    [C.UPDATE_GET]: () => (scene.coaching && !scene.leak ? null : scene.update || null),
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
    [C.STORAGE_GET]: () => (scene.storage ? clipsDemo.storage(scene.storage) : null),
    // Nothing on disk is touched: a delete and an open only answer as main would.
    [C.CLIP_DELETE]: (_e, rid, name) => { deletedClips.add(deletedKey(rid, name)); return { ok: true, id: rid, clip: name, bytes: 24 * 1024 * 1024 }; },
    [C.CLIP_REVEAL]: () => ({ ok: true }),
  };
  // One handler for the clip scheme, the app's own: a clips scene that plays
  // gets the generated canvas recording (fixtures/recording-canvas.mkv) for
  // every clip URL; every other scene gets the sample store's own clips (the
  // review's, made by demoMedia). A scheme takes one handler, so both are here.
  const canvasClip = path.join(ROOT, 'scripts', 'fixtures', 'recording-canvas.mkv');
  const fromStore = clipScheme.createHandler({ fileOf: (id, name) => store.clipFile(id, name) });
  const fromCanvas = clipScheme.createHandler({ fileOf: () => canvasClip });
  protocol.handle(clipScheme.SCHEME, (req) => (scene.video ? fromCanvas(req) : scene.clips === 'rich' ? new Response(null, { status: 404 }) : fromStore(req)));
  const memo = new Map();
  const practice = require('../src/main/services/practice-store').createPractice({
    store: { get: (k) => memo.get(k), set: (k, v) => memo.set(k, v) },
    recent: (g) => (scene.blank ? [] : store.recent(g, patterns.LOOK_BACK)), summarise: (s) => patterns.summarise(s),
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
    // The review's Practice this, answered by the page's first ask.
    if (scene.asked) practice.open(scene.asked.key, scene.asked.title);
    if (scene.practiceState === 'old') {
      const day = 24 * 3600 * 1000;
      memo.set('practice', { v: 1, plans: { valorant: { madeAt: 1, focus: [
        { key: 'lost-advantage', title: 'Gave back the advantage', since: 1, drills: [] },
        { key: 'untraded', title: 'Deaths nobody traded', since: 1, drills: [] },
      ] } }, log: Array.from({ length: 7 }, (_v, i) => ({ id: 'demo' + i, drill: i % 2 ? 'untraded-swing-after' : 'lost-advantage-move-together',
        title: i % 2 ? 'Swing right after your teammate' : 'Up in numbers, move together', minutes: 20, at: Date.now() - (i + 1) * day })) });
    }
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
          const review = scene.media ? await demoMedia(store, id, e.review) : e.review;
          const whole = present({ ...review, id });
          if (scene.lolReview) {
            // A League game as check:lolreview builds it (lol-review.js), its
            // players' names fixture words the review never shows.
            const lol = require('../src/shared/lol-review');
            const ME = 'Me#EUW';
            const built = lol.buildReview({
              me: ME, allies: ['Ally1#EUW', 'Ally2#EUW'], champion: 'Ahri', role: 'Mid', band: 2, mode: 'CLASSIC',
              stats: { gameTimeSec: 1800, csAt10: 52, deathsBy15: 2, wardScore: 9.5, deathsAhead: null, goldHeldSec: null },
              final: { cs: 180, kills: 5, deaths: 2, assists: 7, ward: 9.5, level: 16 },
              events: [
                { EventID: 1, EventName: 'ChampionKill', EventTime: 300, KillerName: 'Foe#EUW', VictimName: 'Ally1#EUW' },
                { EventID: 2, EventName: 'ChampionKill', EventTime: 310, KillerName: 'Foe#EUW', VictimName: ME },
                { EventID: 3, EventName: 'ChampionKill', EventTime: 900, KillerName: 'Foe#EUW', VictimName: ME },
                { EventID: 4, EventName: 'DragonKill', EventTime: 950, KillerName: 'Ally2#EUW' },
              ],
            }, []);
            // Graded, so its Verdict shows (a grade's letter is internal, never drawn).
            pageWin.webContents.send(C.PUSH_LOL_REVIEW, scrubText({ ...built, kind: 'lol', id: `lol-${Date.now() - 600000}-demo`,
              grade: { score: 81, letter: 'A', provisional: false, categories: [], notes: [] } }));
          } else if (scene.work) {
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
      // The match's next push to the shell, as main sends it (9.1, ratedmove).
      if (scene.livenext) { shellWin.webContents.send(C.PUSH_LIVE, liveOf(scene.livenext)); await wait(1400); }
      // A scene's own act in its page (a click, a scroll), then a moment to settle.
      if (scene.act && pageWin) { await pageWin.webContents.executeJavaScript(scene.act).catch(() => null); await wait(scene.after || scene.settle || 900); }
      // And in the bar's own document (sact).
      if (scene.sact) { await shellWin.webContents.executeJavaScript(scene.sact).catch(() => null); await wait(600); }
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

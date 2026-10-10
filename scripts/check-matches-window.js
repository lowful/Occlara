'use strict';

/**
 * The match library must list what was saved, and a row must open its review.
 *
 * test:grade covers the store and the patterns offline, test:breakdown the
 * breakdown. What they cannot see is the path through the real app: main
 * reading the store behind REVIEWS_LIST, PATTERNS_GET and BREAKDOWN_GET, the
 * preload bridge, the renderer painting rows, and a click travelling back
 * through REVIEW_OPEN to open the review window on THAT match with its kept
 * frame. A channel drifting between main and preload shows an empty library
 * that looks exactly like a player who has not played yet.
 *
 * It also reads what the window makes of what arrives: a sort that keeps a
 * rate under its floor below every real rate, a grading line that follows
 * only the Riot ID in Settings, a cut with no rows that says why, and League
 * broken down one mode at a time, with no All that folds them together. And
 * the record beside the title (3:1 here) and the K/D/A column, through the
 * real bridge and the real stylesheet. And a match graded from Riot's record
 * alone, saved by 8.0.3 with three lists: its row names no top mistake, and
 * its review reaches the window as facts. And the eye beside a recorded row
 * (8.2), which opens the AI log window on that match's frames alone, through
 * REVIEW_AILOG and the strict read, for a review that kept its place in the
 * log and for one saved before, found by its end; disabled where the session
 * is gone, absent for Riot's record, and in the review's header too. And the
 * review's last section, "Where you died, and how" (8.2): the kept frame
 * painted there across the section and not on the round's card, and the eye
 * on that moment opening the AI log at the frame the coach looked at.
 *
 * Results travel through a FILE, not stdout: an Electron main process on Windows
 * does not reliably flush a piped stdout.
 *
 * Run: npm run check:matches
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

const REPO = path.join(__dirname, '..');
const OUT = path.join(os.tmpdir(), 'occlara-matches-check.json');

if (!process.versions.electron) {
  const { spawnSync } = require('child_process');
  const electron = require('electron');
  try { fs.unlinkSync(OUT); } catch { /* nothing to clear */ }
  const env = Object.assign({}, process.env, { OCCLARA_MATCHES_OUT: OUT });
  delete env.ELECTRON_RUN_AS_NODE;
  const r = spawnSync(electron, [__filename], { env, timeout: 120000 });
  let rec = null;
  try { rec = JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch { /* reported below */ }
  if (!rec) { console.error('FAIL: the check wrote no result (exit ' + r.status + ')'); process.exit(1); }
  for (const l of rec.lines) console.log('  ' + l);
  if (!rec.ok) { console.error('FAIL: ' + rec.detail); process.exit(1); }
  console.log('PASS: saved reviews are listed, patterns and the breakdown paint and sort for every game, the grading line follows the Riot ID, a row opens its review with its kept frame under Where you died, and how, its eyes open the AI log on that match alone and at the moment looked at, and a match graded from Riot\'s record alone states facts');
  process.exit(0);
}

const { app } = require('electron');
const surfaces = require('./fixtures/surfaces');
const { replay, load } = require('./fixtures/replay-match');
const verify = require(path.join(REPO, 'src/shared/valorant-verify'));
const valorantReview = require(path.join(REPO, 'src/shared/valorant-review'));
const riotReview = require(path.join(REPO, 'src/shared/riot-review'));
const insightsOf = require(path.join(REPO, 'src/shared/insights'));
const { ReviewStore, newId } = require(path.join(REPO, 'src/main/services/review-store'));

const lines = [];
let reported = false;
function report(ok, detail) {
  if (reported) return;
  reported = true;
  try { fs.writeFileSync(process.env.OCCLARA_MATCHES_OUT || OUT, JSON.stringify({ ok, detail, lines })); }
  catch { /* exit code still carries it */ }
  app.exit(ok ? 0 : 1);
}

/** fn's first truthy answer, polled, or null once `ms` have passed. */
async function until(fn, ms) {
  const end = Date.now() + ms;
  for (;;) {
    let v = null;
    try { v = await fn(); } catch { v = null; }
    if (v) return v;
    if (Date.now() > end) return null;
    await new Promise((r) => setTimeout(r, 150));
  }
}

/** A page's answer to `code`, or null when a page still loading does not answer within a second. */
function settled(w, code) {
  return Promise.race([w.webContents.executeJavaScript(code), new Promise((r) => setTimeout(() => r(null), 1000))]);
}

// A profile holding three saved Valorant reviews, built from the real match, a
// fourth graded from Riot's record alone, and three each of Marvel Rivals and
// League (below).
const ud = path.join(os.tmpdir(), 'occlara-check-matches');
fs.rmSync(ud, { recursive: true, force: true });
fs.mkdirSync(ud, { recursive: true });
fs.writeFileSync(path.join(ud, 'occlara-config.json'), JSON.stringify({
  game: 'valorant', onboardingCompleted: true, licenseKey: '', language: 'en',
  // The Riot ID the grading line follows (below). With no licence the main
  // surfaces never launch, so nothing is fetched for it.
  riotId: 'New#EUW',
}, null, 2));
const played = replay(load('valorant-match-abyss-13-11.json').frames, 'standard');
const { rounds } = verify.reconcile(played.rounds, load('riot-abyss-13-11.json'));
const now = Date.now();
const NEWEST = now - 40 * 60000;               // the newest match, ending now
// The coach's look at round 2, at a moment of the newest match: the second
// frame the AI log keeps of it (below), which the eye on the moment opens at
// in the review's "Where you died, and how" (8.2).
const LOOK_AT = NEWEST + 70000;
rounds.find((r) => r.n === 2).forensics = { cause: 'dry-peek', what: 'You swung wide with nothing thrown.', better: 'Wait for the flash.',
  frames: ['r2-before.jpg'], source: 'riot', at: LOOK_AT };
// The agent Riot's record names for this match. The replayed context carries
// none, and the breakdown's By agent cut needs one to list the match under.
const built = valorantReview.build({ rounds, context: { ...played.context, agent: 'Jett' }, endedBy: 'score', ai: {}, role: 'Duelist', history: [],
  riotMe: { kills: 31, deaths: 21, assists: 4, score: 9168 } });
const store = new ReviewStore(path.join(ud, 'reviews'));
// THE EYE (8.2), on two AI log sessions. The newer holds a match before the
// newest one and then the newest one, whose review keeps its place in it. The
// older holds the oldest match, saved as 8.1 saved it with no place kept, so
// it is found by when it ended. The middle match points at a session pruned
// since. A real JPEG is not needed: the check counts frames, not pixels.
const aiLogStore = require(path.join(REPO, 'src/main/services/ai-log-store'));
const ALIVE = { map: 'Abyss', playerAlive: true, playerHp: 100, teamScore: 3, enemyScore: 2 };
const DEAD = { map: 'Abyss', playerAlive: false, phase: 'dead', aliveTell: 'killed by Jett, spectating a teammate', teamScore: 3, enemyScore: 2 };
const sessionName = (at) => 'session-' + new Date(at).toISOString().replace(/[:.]/g, '-');
function logSession(at, recs) {
  const dir = path.join(ud, 'ai-log', sessionName(at));
  fs.mkdirSync(dir, { recursive: true });
  const records = recs.map(([t, state, match], i) => {
    const frame = `frame-${String(i).padStart(5, '0')}.jpg`;
    fs.writeFileSync(path.join(dir, frame), Buffer.from('frame'));
    return { i, at: t, frame, state, round: 3, died: false, match };
  });
  fs.writeFileSync(path.join(dir, 'log.json'), JSON.stringify({ startedAt: records[0].at, records }));
  return dir;
}
const frameRun = (match, n, deathAt) => Array.from({ length: n },
  (_v, k) => [match + 60000 + k * 10000, k === deathAt || k === deathAt + 1 ? DEAD : ALIVE, match]);
const BEFORE = now - 90 * 60000;               // the match before the newest one
const OLDEST = now - 2 * 3600000 - 40 * 60000; // the oldest, ending two hours ago
const newestFrames = frameRun(NEWEST, 6, 2);   // one death, frames 2 and 3; frame 1 is LOOK_AT
const newDir = logSession(BEFORE - 60000, [...frameRun(BEFORE, 3, -9), ...newestFrames]);
// Its last frame half a minute before its end, as the menus after a match leave it.
logSession(OLDEST - 60000, [...frameRun(OLDEST, 3, -9), [now - 2 * 3600000 - 30000, ALIVE, OLDEST]]);
const AILOG = { newest: newestFrames.length, session: 3 + newestFrames.length, oldest: 4 };
// The newest match is saved as 8.1 saved it: its study note beside the name it
// was imported from, which main must never hand a window (present(), below).
const STUDY_TEXT = 'Trade your entry within a second of contact.';
const ids = [0, 1, 2].map((i) => {
  const id = newId('valorant', now - i * 3600000);
  const review = { ...built, id, at: now - i * 3600000, kind: 'valorant' };
  if (i === 0) review.study = [{ text: STUDY_TEXT, coach: 'A Coach (A Team)' }];
  if (i === 0) review.aiLog = aiLogStore.placeOf(newDir, NEWEST, review.at);
  if (i === 1) review.aiLog = { session: 'session-2026-01-01T00-00-00-000Z', match: review.at - 1800000, from: review.at - 1800000, to: review.at };
  // The oldest of the three was lost, so Abyss is 2-1, a win rate past its
  // floor, beside Bind's 1-0, which is under it (the sort, below).
  if (i === 2) review.game = { ...built.game, result: 'Defeat', score: '11-13' };
  // A real JPEG header is not needed: the check only asserts the data URL arrives.
  store.save({ id, game: 'valorant', at: review.at, review, frames: i === 0 ? { 'r2-before.jpg': Buffer.from('frame').toString('base64') } : null });
  return id;
});
// A fourth match, graded from Riot's record alone, on another map and agent:
// the breakdown needs two of each to show it cuts by both.
const riotRec = JSON.parse(JSON.stringify(load('riot-abyss-13-11.json')));
riotRec.map = 'Bind';
riotRec.me.agent = 'Sova';
const riotOnly = riotReview.fromRiot({
  row: { matchId: 'check-bind', map: 'Bind', agent: 'Sova', mode: 'Competitive', result: 'Victory', score: '13-11',
    kills: 31, deaths: 21, assists: 4, kd: 1.48, acs: 382, adr: 243, headshotPct: 25, startedAt: now - 5 * 3600000 },
  riot: riotRec, history: [], account: 'Check#EUW',
}).review;
riotOnly.id = newId('valorant', riotOnly.at);
// Saved as 8.0.3 saved one: the three lists a recorded match has, fix lines
// and all, its first mistake written into the index as the row's top one.
// Main serves it as facts (present()) and the row names no top mistake.
riotOnly.insights = insightsOf.valorant(verify.reconcile([], riotRec).rounds, { role: 'Initiator' });
store.save({ id: riotOnly.id, game: 'valorant', at: riotOnly.at, review: riotOnly });
// Marvel Rivals with no hero read in any match and no map in one: By hero has
// no row to show and has to say why, and By map has to say what it left out.
['Tokyo 2099', 'Yggsgard', null].forEach((map, i) => {
  const at = now - (10 + i) * 3600000;
  const id = newId('rivals', at);
  store.save({ id, game: 'rivals', at, review: { id, at, kind: 'rivals', empty: false,
    game: { hero: null, role: null, map, mode: 'Competitive', result: 'VICTORY' },
    scoreline: { kills: 12, deaths: 6, assists: 8, damage: 14000, healing: 0, blocked: 0, accuracy: 41 },
    grade: { score: 72, letter: 'B', provisional: false, categories: [] },
    insights: { mistakes: [], strengths: [], missed: [] } } });
});
// League: two Summoner's Rift games and an ARAM, broken down one mode at a time.
['CLASSIC', 'CLASSIC', 'ARAM'].forEach((mode, i) => {
  const at = now - (20 + i) * 3600000;
  const id = newId('lol', at);
  store.save({ id, game: 'lol', at, review: { id, at,
    game: { champion: 'Ahri', role: 'Middle', mode, durationSec: 1800 },
    scoreline: { kills: 6, deaths: 3, assists: 7, cs: 220, ward: 15 },
    grade: { score: 74, letter: 'B', provisional: false, categories: [] },
    insights: { mistakes: [], strengths: [], missed: [] } } });
});
process.env.OCCLARA_DEV_USERDATA = ud;

app.disableHardwareAcceleration();
app.on('window-all-closed', () => { /* the run below decides when we exit */ });

setTimeout(async () => {
  // Since 8.1 the library is three pages of the main window, each a view.
  const mainWindow = require(path.join(REPO, 'src/main/windows/main-window'));
  try {
    mainWindow.create();
    mainWindow.show('matches');
    // WAITED FOR, not given a fixed few seconds: on a machine busy with a game
    // the page committed after the 3.2 seconds this used to allow, and the run
    // failed before it had checked anything. Its rows paint in one go with the
    // patterns, which the lines below read.
    const win = await until(async () => {
      const w = surfaces.find('section=list');
      return w && await settled(w, "document.querySelectorAll('#list .m-row').length") ? w : null;
    }, 20000) || surfaces.find('section=list');
    if (!win) return report(false, 'the Matches page never opened');
    const errs = [];
    win.webContents.on('console-message', (e, lvl, msg) => { if (lvl >= 2) errs.push(msg); });
    const js = (s) => win.webContents.executeJavaScript(s);

    const rows = await js("document.querySelectorAll('#list .m-row').length");
    const grade = await js("(document.querySelector('#list .m-row .m-score') || {}).textContent || ''");
    const pats = await js("document.querySelectorAll('#p-lists .gv-item').length");
    const avg = await js("document.getElementById('p-avg-num').textContent");
    lines.push(`rows=${rows} first grade=${grade} pattern items=${pats} average=${avg}`);
    if (rows !== 4) return report(false, `listed ${rows} matches, expected 4`);
    if (String(grade) !== String(built.grade.score)) return report(false, `the row shows grade ${grade}, the review says ${built.grade.score}`);
    if (!pats) return report(false, 'three matches painted no patterns');

    // ONE SURFACE, THREE PAGES: each shows its own section, titled for it, and
    // none of them the window chrome of the old library window.
    const displayed = (js2, id) => js2(`getComputedStyle(document.getElementById('${id}')).display !== 'none'`);
    const pageOf = async (section, title, visible, hiddenIds) => {
      if (section !== 'list') { mainWindow.show(section); await new Promise((r) => setTimeout(r, 2500)); }
      const w = surfaces.find(`section=${section}`);
      if (!w) return `the ${title} page never opened`;
      const pjs = (s) => w.webContents.executeJavaScript(s);
      const h2 = await pjs("document.querySelector('.sheet > header h2').textContent");
      const embedded = await pjs("document.documentElement.classList.contains('embedded')");
      const closeShown = await pjs("getComputedStyle(document.getElementById('close')).display !== 'none'");
      const own = await displayed(pjs, visible);
      const others = [];
      for (const id of hiddenIds) if (await displayed(pjs, id)) others.push(id);
      lines.push(`${section} page: title=${h2} embedded=${embedded} close=${closeShown} own=${own} others=${others.join(',') || 'none'}`);
      if (h2 !== title) return `the ${section} page is titled ${h2}`;
      if (!embedded || closeShown) return `the ${section} page still draws its old window chrome`;
      if (!own || others.length) return `the ${section} page shows ${others.join(', ') || 'nothing of its own'}`;
      return null;
    };
    for (const [section, title, visible, hiddenIds] of [
      ['list', 'Matches', 'every', ['patterns', 'breakdown']],
      ['patterns', 'Patterns', 'patterns', ['every', 'breakdown']],
      ['breakdown', 'Breakdown', 'breakdown', ['every', 'patterns']],
    ]) {
      const why = await pageOf(section, title, visible, hiddenIds);
      if (why) return report(false, why);
    }
    mainWindow.show('matches');
    await new Promise((r) => setTimeout(r, 400));

    // WON AND LOST BESIDE THE TITLE, on the list page alone, through the real
    // bridge. Abyss is 2-1 and Bind's match from Riot's record a win, so 3:1,
    // in Geist Mono at the title's size, wins in --good and losses in --red.
    // The Patterns and Breakdown pages, titled for what they count, carry none.
    const recordOf = (pjs) => pjs(`(() => {
      const b = document.getElementById('wl');
      const cs = (n) => getComputedStyle(n);
      const probe = (v) => { const p = document.createElement('i'); p.style.color = v; document.body.append(p); const c = cs(p).color; p.remove(); return c; };
      return { shown: !b.hidden && cs(b).display !== 'none', w: b.querySelector('.wl-w').textContent, l: b.querySelector('.wl-l').textContent,
        sr: b.querySelector('.wl-sr').textContent, size: cs(b).fontSize, titleSize: cs(document.querySelector('.sheet > header h2')).fontSize,
        weight: cs(b).fontWeight, family: cs(b).fontFamily, win: cs(b.querySelector('.wl-w')).color, loss: cs(b.querySelector('.wl-l')).color,
        good: probe('var(--good)'), red: probe('var(--red)') };
    })()`);
    const rec = await recordOf(js);
    lines.push(`record: shown=${rec.shown} ${rec.w}:${rec.l} "${rec.sr}" ${rec.weight} ${rec.size} (title ${rec.titleSize}) wins ${rec.win} losses ${rec.loss}`);
    if (!rec.shown || rec.w !== '3' || rec.l !== '1' || rec.sr !== '3 wins, 1 loss') {
      return report(false, `the Matches title reads ${rec.w}:${rec.l} ("${rec.sr}"), expected 3:1`);
    }
    if (rec.size !== rec.titleSize || rec.weight !== '800' || !/Geist Mono/.test(rec.family)) {
      return report(false, `the record is ${rec.weight} ${rec.size} ${rec.family}, beside a ${rec.titleSize} title`);
    }
    if (rec.win !== rec.good || rec.loss !== rec.red) return report(false, `wins are ${rec.win} and losses ${rec.loss}, not --good and --red`);
    for (const section of ['patterns', 'breakdown']) {
      const w = surfaces.find(`section=${section}`);
      const none = w && await w.webContents.executeJavaScript("document.getElementById('wl').hidden");
      if (!none) return report(false, `the ${section} page carries the record`);
    }

    // The breakdown: two maps, two agents, a row that opens in place.
    const bShown = await js("!document.getElementById('breakdown').hidden");
    const maps = await js("[...document.querySelectorAll('#b-table .b-row .b-name span:first-child')].map((n) => n.textContent).join(',')");
    lines.push(`breakdown shown=${bShown} maps=${maps}`);
    if (!bShown) return report(false, 'the breakdown section stayed hidden with four saved matches');
    if (maps !== 'Abyss,Bind') return report(false, `the breakdown listed maps ${maps}, expected Abyss,Bind`);
    // K/D/A: the three Abyss matches carry the real match's 31/21/4, and the
    // tooltip is the K/D the column sorts on, over its sample.
    const kda = await js(`(() => {
      const heads = [...document.querySelectorAll('#b-table .b-sort')].map((b) => b.textContent);
      const td = document.querySelector('#b-table .b-row').children[heads.indexOf('K/D/A')];
      return { text: td ? td.textContent : '', title: td ? td.title : '' };
    })()`);
    lines.push(`K/D/A: Abyss ${kda.text} "${kda.title}"`);
    if (kda.text !== '31/21/4' || kda.title !== 'K/D 1.48 over 3 matches') {
      return report(false, `Abyss's K/D/A reads "${kda.text}" ("${kda.title}"), expected 31/21/4, K/D 1.48 over 3 matches`);
    }

    // A RATE UNDER ITS FLOOR NEVER OUTRANKS A RATE. Bind is 1-0, "1 of 1" and
    // under the three match floor; Abyss is 2-1, 67%. Sorted on count over n,
    // Bind's 1 of 1 read as 100% and went first.
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const order = () => js("[...document.querySelectorAll('#b-table .b-row .b-name span:first-child')].map((n) => n.textContent).join(',')");
    const sortBy = async (title) => {
      await js(`[...document.querySelectorAll('#b-table .b-sort')].find((b) => b.textContent === ${JSON.stringify(title)}).click(); true`);
      await wait(300);
      return order();
    };
    const winDown = await sortBy('Win %');
    const winUp = await sortBy('Win %');
    const recDown = await sortBy('Record');
    lines.push(`sorted: win % down=${winDown} up=${winUp} record down=${recDown}`);
    if (winDown !== 'Abyss,Bind' || winUp !== 'Abyss,Bind') {
      return report(false, `Win % sorted ${winDown}, then ${winUp}: Bind's 1 of 1 is under the floor and goes after Abyss's 67% either way`);
    }
    if (recDown !== 'Abyss,Bind') return report(false, `Record sorted ${recDown}: 1-0 is under the win rate floor and goes after 2-1`);
    await sortBy('Matches');

    await js("[...document.querySelectorAll('#b-dims button')].find((b) => b.textContent === 'By agent').click(); true");
    await new Promise((r) => setTimeout(r, 400));
    const agents = await js("[...document.querySelectorAll('#b-table .b-row .b-name span:first-child')].map((n) => n.textContent).join(',')");
    lines.push(`agents=${agents}`);
    if (agents !== 'Jett,Sova') return report(false, `By agent listed ${agents}, expected Jett,Sova`);
    await js("document.querySelector('#b-table .b-row').click(); true");
    await new Promise((r) => setTimeout(r, 400));
    const dts = await js("[...document.querySelectorAll('#b-table .b-detail .b-dt')].map((n) => n.textContent).join('|')");
    lines.push(`opened row: ${dts}`);
    if (!/Openings/.test(dts) || !/Maps/.test(dts)) return report(false, 'opening an agent row showed no openings or maps');
    const riotRow = await js("[...document.querySelectorAll('#list .m-meta')].some((n) => n.textContent.includes(\"from Riot's record\"))");
    if (!riotRow) return report(false, "the Riot only match does not say it is from Riot's record");

    // THE GRADING LINE FOLLOWS THE RIOT ID IN SETTINGS, New#EUW. A run for the
    // ID before it, finished or still winding down, says nothing here and
    // holds no button; a run for this one is shown however it is cased.
    const C = require(path.join(REPO, 'src/shared/channels'));
    const push = async (s) => {
      win.webContents.send(C.PUSH_BACKFILL, s);
      await wait(500);
      return js("({ text: document.getElementById('bf-status').textContent, btn: document.getElementById('bf-go').textContent, off: document.getElementById('bf-go').disabled })");
    };
    const oldDone = await push({ state: 'done', account: 'Old#EUW', message: "Graded 4 recent matches from Riot's record. They are in Matches." });
    const oldRun = await push({ state: 'grading', account: 'Old#EUW', message: "Grading your recent matches from Riot's record: 2 of 10." });
    const mine = "Graded 2 recent matches from Riot's record. They are in Matches.";
    const newDone = await push({ state: 'done', account: 'new#euw', message: mine });
    lines.push(`grading line: old done="${oldDone.text}" old running="${oldRun.text}" (${oldRun.btn}, disabled ${oldRun.off}) new="${newDone.text}"`);
    if (oldDone.text) return report(false, `the grading line shows the previous Riot ID's outcome: "${oldDone.text}"`);
    if (oldRun.text || oldRun.off || oldRun.btn !== 'Grade my recent matches') {
      return report(false, 'a run for the previous Riot ID holds the grading line or the button');
    }
    if (newDone.text !== mine) return report(false, `a run for the Riot ID in Settings is not shown: "${newDone.text}"`);
    // An ID changed in Settings with no run behind it pushes nothing, so the
    // window reads it again when it comes back to the front.
    const cfgStore = require(path.join(REPO, 'src/main/services/store'));
    const refocus = async () => {
      await js("window.dispatchEvent(new Event('focus')); true");
      await wait(400);
      return js("document.getElementById('bf-status').textContent");
    };
    cfgStore.set('riotId', 'Other#EUW');
    const changed = await refocus();
    cfgStore.set('riotId', 'New#EUW');
    const restored = await refocus();
    lines.push(`grading line after the ID changed="${changed}", and back="${restored}"`);
    if (changed) return report(false, `after the Riot ID changed in Settings the grading line still says "${changed}"`);
    if (restored !== mine) return report(false, `back on the Riot ID the run was for, the grading line says "${restored}"`);

    // NONE CHECKED IS A SENTENCE, not "the 0 checked". Every Valorant match
    // saved here is checked, and seeding one that is not would change what
    // everything above counts, so the window's own subLine is asked.
    const sub = (b) => js(`subLine(${JSON.stringify({ game: 'valorant', left: 0, queue: 'All', dims: [], unknown: {}, ...b })}, 'map')`);
    const none = await sub({ matches: 2, checked: 0 });
    const some = await sub({ matches: 3, checked: 1 });
    lines.push(`sub none checked="${none}" one checked="${some}"`);
    if (none !== "Across 2 matches. None of these matches is checked against Riot's record yet, so there are no round numbers.") {
      return report(false, `with none checked the sub line reads "${none}"`);
    }
    if (!some.includes("Round numbers come from the 1 match checked against Riot's record.")) {
      return report(false, `with one checked the sub line reads "${some}"`);
    }

    const tab = async (label) => {
      await js(`[...document.querySelectorAll('#tabs .tab')].find((b) => b.textContent === ${JSON.stringify(label)}).click(); true`);
      await wait(900);
    };
    // A CUT WITH NO ROWS SAYS WHY. No Rivals match here has a hero read, and
    // one has no map: By map leaves that one out and says so, and By hero,
    // with nothing to list, says it is the hero that is missing rather than
    // asking for a match that was already played.
    await tab('Marvel Rivals');
    const rvMap = await js("({ sub: document.getElementById('b-sub').textContent, maps: [...document.querySelectorAll('#b-table .b-row .b-name span:first-child')].map((n) => n.textContent).join(',') })");
    lines.push(`rivals by map: ${rvMap.maps} | ${rvMap.sub}`);
    if (rvMap.maps !== 'Tokyo 2099,Yggsgard') return report(false, `Rivals By map listed ${rvMap.maps}, expected Tokyo 2099,Yggsgard`);
    const rvRec = await recordOf(js);
    lines.push(`rivals record: shown=${rvRec.shown} ${rvRec.w}:${rvRec.l}`);
    if (!rvRec.shown || rvRec.w !== '3' || rvRec.l !== '0') {
      return report(false, `on Marvel Rivals the title reads ${rvRec.w}:${rvRec.l}, expected its three VICTORY matches as 3:0`);
    }
    if (!rvMap.sub.includes('1 match with no map read is not in a row.')) return report(false, `the Rivals sub line does not say a match is in no row: "${rvMap.sub}"`);
    await js("[...document.querySelectorAll('#b-dims button')].find((b) => b.textContent === 'By hero').click(); true");
    await wait(400);
    const rvHero = await js("({ empty: document.getElementById('b-empty').textContent, shown: !document.getElementById('b-empty').hidden, table: !document.getElementById('b-table').hidden, sub: document.getElementById('b-sub').textContent })");
    lines.push(`rivals by hero: "${rvHero.empty}" | ${rvHero.sub}`);
    if (!rvHero.shown || rvHero.table || rvHero.empty !== 'None of these matches has a confirmed hero yet.') {
      return report(false, `By hero with no hero read says "${rvHero.empty}"`);
    }
    // LEAGUE IS ONE MODE AT A TIME, the most played first, with no All chip.
    await tab('League of Legends');
    const lol = await js("({ sub: document.getElementById('b-sub').textContent, chips: document.querySelectorAll('#b-queues .b-chip').length, shown: !document.getElementById('b-queues').hidden, champs: [...document.querySelectorAll('#b-table .b-row .b-name span:first-child')].map((n) => n.textContent).join(',') })");
    lines.push(`league: ${lol.champs} chips=${lol.chips} | ${lol.sub}`);
    if (!lol.shown || lol.chips !== 2) return report(false, `League shows ${lol.chips} mode chips, expected Summoner's Rift and ARAM`);
    if ((await recordOf(js)).shown) return report(false, 'League, whose reviews carry no result, shows a record beside the title');
    // A library whose every match is in a mode the breakdown leaves out says
    // so, rather than asking for a match over a library that has some.
    const leftMany = await js("emptyLine({ game: 'valorant', matches: 0, left: 3, dims: [{ key: 'map', one: 'map' }] }, 'map')");
    const leftOne = await js("emptyLine({ game: 'lol', matches: 0, left: 1, dims: [{ key: 'champion', one: 'champion' }] }, 'champion')");
    lines.push(`left out only: "${leftMany}" | "${leftOne}"`);
    if (!/^All 3 of your saved matches are in modes played on other rules/.test(leftMany) || !/^Your one saved game is in a mode/.test(leftOne)) {
      return report(false, 'a library of left out modes is not told why there is no breakdown');
    }
    if (lol.champs !== 'Ahri' || lol.sub !== "Across 2 games in Summoner's Rift.") {
      return report(false, `League counted ${lol.champs}: "${lol.sub}"`);
    }
    await tab('Valorant');
    const back = await js("document.querySelectorAll('#list .m-row').length");
    if (back !== 4) return report(false, `back on Valorant the list shows ${back} matches`);

    // THE EYE (8.2), through the real REVIEWS_LIST, REVIEW_AILOG and the AI
    // log window. A sibling of the row's button, never inside it: kept for the
    // newest match, which kept its place in the log, and for the oldest, saved
    // before 8.2 and found by its end; disabled for the one whose session is
    // gone; and none for the match graded from Riot's record alone. No row
    // says Ask any more.
    const eyes = await js(`[...document.querySelectorAll('#list .m-item')].map((it) => {
      const row = it.querySelector('.m-row');
      const eye = [...it.children].find((c) => c.classList.contains('log-eye'));
      return { riot: row.querySelector('.m-meta').textContent.includes("from Riot's record"), inner: row.querySelectorAll('button').length,
        eye: eye ? { disabled: eye.disabled, name: eye.getAttribute('aria-label'), title: eye.title } : null };
    })`);
    lines.push(`eyes: ${eyes.map((e) => `${e.riot ? 'riot' : 'recorded'}:${e.eye ? (e.eye.disabled ? 'disabled' : 'open') : 'none'}`).join(',')}`);
    if (eyes.length !== 4) return report(false, `the list has ${eyes.length} match items, expected 4`);
    if (eyes.some((e) => e.inner)) return report(false, 'a row carries a control inside its own button');
    if (await js("document.querySelectorAll('#list .m-ask').length")) return report(false, 'a row still carries Ask');
    const [eNew, eGone, eOld, eRiot] = eyes;
    if (!eNew.eye || eNew.eye.disabled || eNew.eye.name !== 'Open the AI log of this match') {
      return report(false, `the newest match's eye is ${JSON.stringify(eNew.eye)}, though its session is kept`);
    }
    if (!eGone.eye || !eGone.eye.disabled || !/No AI log is kept for this match/.test(eGone.eye.title)) {
      return report(false, `the match whose session is gone has the eye ${JSON.stringify(eGone.eye)}`);
    }
    if (!eOld.eye || eOld.eye.disabled) return report(false, 'the match saved before 8.2 has no open eye, though a kept session holds its frames');
    if (!eRiot.riot || eRiot.eye) return report(false, "the match graded from Riot's record alone has an eye");

    // Pressed, the AI log opens on that match's frames alone, on its death.
    // Each step waits for the window to show what it is expected to, and is
    // then read once more for the verdict, so a slow machine is not a failure.
    const eyeAt = (i) => js(`[...document.querySelectorAll('#list .m-item')][${i}].querySelector('.log-eye').click(); true`);
    const VIEW = `(() => {
      const $ = (id) => document.getElementById(id);
      return { frames: Number($('slider').max) + 1, at: Number($('slider').value), main: !$('main').hidden,
        picker: !$('session').hidden, whole: !$('whole').hidden, pos: $('death-pos').textContent, sub: $('subtitle').textContent };
    })()`;
    await eyeAt(0);
    const lwin = await until(async () => {
      const w = surfaces.find('/ailog/');
      const v = w && await settled(w, VIEW);
      return v && v.main ? w : null;
    }, 20000);
    if (!lwin) return report(false, 'the eye did not open the AI log on a match');
    const logView = () => lwin.webContents.executeJavaScript(VIEW);
    const viewWhen = async (test) => (await until(async () => { const v = await logView(); return test(v) ? v : null; }, 10000)) || logView();
    let lv = await logView();
    lines.push(`ai log on the newest match: ${JSON.stringify(lv)}`);
    if (!lv.main || lv.frames !== AILOG.newest) return report(false, `the AI log opened on ${lv.frames} frames, not the match's ${AILOG.newest}`);
    if (lv.picker || !lv.whole) return report(false, 'opened on one match, the AI log still shows the session picker, or no Whole session');
    if (lv.pos !== 'Death 1 of 1' || lv.at !== 2) return report(false, `the AI log did not open on the match's death: "${lv.pos}" at ${lv.at}`);
    await lwin.webContents.executeJavaScript("document.getElementById('whole').click(); true");
    lv = await viewWhen((v) => !v.whole);
    lines.push(`ai log, whole session: ${JSON.stringify(lv)}`);
    if (lv.frames !== AILOG.session || lv.whole || lv.at !== 5) {
      return report(false, `Whole session shows ${lv.frames} frames at ${lv.at}, expected the session's ${AILOG.session} at the same frame, 5`);
    }
    // The oldest match's eye moves the open log to that match, in another session.
    await eyeAt(2);
    lv = await viewWhen((v) => v.whole);
    lines.push(`ai log on the oldest match: ${JSON.stringify(lv)}`);
    if (lv.frames !== AILOG.oldest || !lv.whole || lv.picker) {
      return report(false, `the oldest match's eye showed ${lv.frames} frames, expected its own ${AILOG.oldest}`);
    }

    // Click the newest row: it must open the review window on that match.
    // Every push to the review page is kept, to read what main sent it.
    const registry = require(path.join(REPO, 'src/main/windows/registry'));
    const broadcast = registry.broadcast;
    const pushed = [];
    registry.broadcast = (ch, data) => { if (ch === C.PUSH_VALORANT_REVIEW) pushed.push(data); return broadcast(ch, data); };
    await js("document.querySelector('#list .m-row').click(); true");
    await new Promise((r) => setTimeout(r, 3500));
    registry.broadcast = broadcast;
    const rwin = surfaces.find('/review/');
    if (!rwin) return report(false, 'clicking a row did not open the review page');
    if (mainWindow.current().shown !== 'review') return report(false, `the page showing is ${mainWindow.current().shown}, not the review`);
    const rjs = (s) => rwin.webContents.executeJavaScript(s);
    const shown = await rjs("!document.getElementById('vreview').hidden");
    const letter = await rjs("(document.querySelector('.gv-letter') || {}).textContent || ''");
    // The kept frame is painted in "Where you died, and how" (8.2), the last
    // section, and no longer on the round's card, which keeps a link down to it.
    const img = await rjs("(document.querySelector('.v-moment img') || {}).src || ''");
    const look = await rjs(`(() => {
      const wrap = document.getElementById('v-looks-wrap');
      const card = document.getElementById('round-2');
      const m = document.getElementById('moment-2');
      return { shown: !wrap.hidden, last: wrap.nextElementSibling && wrap.nextElementSibling.classList.contains('v-foot'),
        heading: wrap.querySelector('h3').textContent, cardImgs: card ? card.querySelectorAll('img').length : -1,
        link: !!(card && card.querySelector('.v-moment-link')), eye: !!(m && m.querySelector('.v-moment-head .log-eye')),
        width: m ? Math.round(m.querySelector('.v-shot img').getBoundingClientRect().width) : 0,
        column: Math.round(wrap.getBoundingClientRect().width) };
    })()`);
    const ask = await rjs("!document.getElementById('ask').hidden");
    // The same eye in the review's header, right before Ask about this match.
    const reye = await rjs(`(() => {
      const host = document.getElementById('eye-host');
      const e = host.querySelector('.log-eye');
      return e ? { shown: !host.hidden, disabled: e.disabled, next: host.nextElementSibling && host.nextElementSibling.id } : null;
    })()`);
    lines.push(`review shown=${shown} letter=${letter} frame=${img.slice(0, 30)} ask=${ask} eye=${JSON.stringify(reye)}`);
    lines.push(`where you died: ${JSON.stringify(look)}`);
    if (!shown) return report(false, 'the review window opened empty');
    if (letter !== built.grade.letter) return report(false, `the review painted grade ${letter}, expected ${built.grade.letter}`);
    if (!img.startsWith('data:image/jpeg;base64,')) return report(false, 'the kept frame did not reach "Where you died, and how"');
    if (!look.shown || !look.last || look.heading !== 'Where you died, and how') {
      return report(false, `the moments section is ${JSON.stringify(look)}, not the last one on the review`);
    }
    if (look.cardImgs !== 0 || !look.link) return report(false, `round 2's card still paints ${look.cardImgs} frame(s), or has no link down to its moment`);
    // A frame on its own takes the whole width of the section, less the card's padding.
    if (!look.width || look.width < look.column - 48) return report(false, `the kept frame is ${look.width}px wide in a ${look.column}px section`);
    if (!look.eye) return report(false, 'the moment has no eye, though the AI log still holds its match');
    if (!ask) return report(false, 'a saved review offers no Ask about this match');
    if (!reye || !reye.shown || reye.disabled || reye.next !== 'ask') {
      return report(false, `the review's header has the eye ${JSON.stringify(reye)}, not an open one beside Ask about this match`);
    }
    // The eye on the moment moves the open AI log to that match, on the frame
    // the coach looked at, through REVIEW_AILOG with its time and AILOG_SHOW.
    await rjs("document.querySelector('#moment-2 .v-moment-head .log-eye').click(); true");
    lv = await viewWhen((v) => v.frames === AILOG.newest && v.at === 1);
    lines.push(`ai log at the moment: ${JSON.stringify(lv)}`);
    if (lv.frames !== AILOG.newest || lv.at !== 1 || !lv.whole || lv.picker) {
      return report(false, `the moment's eye showed ${lv.frames} frames at ${lv.at}, expected the newest match's ${AILOG.newest} at its frame 1`);
    }

    // THE REVIEW REACHES THE WINDOW THROUGH present() (index.js). What the
    // page was pushed, what it gets asking again (LOL_REVIEW_GET) and what it
    // paints carry the study note's text alone, never where it came from.
    const want = JSON.stringify([{ text: STUDY_TEXT }]);
    const sent = pushed.length ? JSON.stringify(pushed[pushed.length - 1].study) : null;
    const asked = await rjs("window.occlara.getReview().then((r) => JSON.stringify((r && r.study) || null))");
    const study = await rjs("({ cards: document.querySelectorAll('#v-study .v-study-card').length, text: document.getElementById('v-study').textContent, shown: !document.getElementById('v-study-wrap').hidden })");
    lines.push(`study: pushed=${sent} asked=${asked} painted=${study.cards} "${study.text}"`);
    if (sent !== want) return report(false, `the review page was pushed the study notes ${sent}`);
    if (asked !== want) return report(false, `the review page, asking for the review, got the study notes ${asked}`);
    if (!study.shown || study.cards !== 1 || study.text !== STUDY_TEXT) {
      return report(false, `the study card painted ${study.cards} note(s): "${study.text}"`);
    }

    // A MATCH GRADED FROM RIOT'S RECORD ALONE STATES FACTS (8.2), saved by
    // 8.0.3 with three lists as this one was. Its row names no top mistake,
    // though the index on disk holds one (review-store.js list()), and its
    // review is pushed, asked for and painted as one list of facts with no
    // fix line (present() in index.js).
    mainWindow.show('matches');
    await wait(800);
    const tops = await js("[...document.querySelectorAll('#list .m-row')].map((b) => ({ riot: b.querySelector('.m-meta').textContent.includes(\"from Riot's record\"), top: !!b.querySelector('.m-top-mistake') }))");
    lines.push(`top mistake lines: ${tops.map((t) => `${t.riot ? 'riot' : 'recorded'}:${t.top}`).join(',')}`);
    if (!tops.some((t) => !t.riot && t.top)) return report(false, 'no recorded row names its top mistake, so the Riot row proves nothing');
    if (!tops.some((t) => t.riot) || tops.some((t) => t.riot && t.top)) {
      return report(false, "the row graded from Riot's record alone names a top mistake");
    }
    pushed.length = 0;
    registry.broadcast = (ch, data) => { if (ch === C.PUSH_VALORANT_REVIEW) pushed.push(data); return broadcast(ch, data); };
    await js("[...document.querySelectorAll('#list .m-row')].find((b) => b.querySelector('.m-meta').textContent.includes(\"from Riot's record\")).click(); true");
    await wait(3000);
    registry.broadcast = broadcast;
    const lists = (ins) => (ins ? { lists: ins.mistakes.length + ins.strengths.length + ins.missed.length, facts: (ins.facts || []).length } : null);
    const sentFacts = pushed.length ? lists(pushed[pushed.length - 1].insights) : null;
    const askedFacts = await rjs("window.occlara.getReview().then((r) => r && r.insights ? { lists: r.insights.mistakes.length + r.insights.strengths.length + r.insights.missed.length, facts: (r.insights.facts || []).length } : null)");
    const painted = await rjs("(() => { const h = document.getElementById('insights-host'); return { heads: [...h.querySelectorAll('h3')].map((x) => x.textContent), facts: h.querySelectorAll('.gv-item.fact').length, fixes: h.querySelectorAll('.gv-item-fix').length, meta: document.getElementById('v-meta').textContent, eye: !!document.querySelector('#eye-host .log-eye') }; })()");
    lines.push(`riot review: pushed=${JSON.stringify(sentFacts)} asked=${JSON.stringify(askedFacts)} painted=${JSON.stringify(painted)}`);
    if (!/From Riot's record/.test(painted.meta)) return report(false, `the review page shows "${painted.meta}", not the match graded from Riot's record`);
    if (!sentFacts || sentFacts.lists || !sentFacts.facts) return report(false, `the Riot only review was pushed with ${JSON.stringify(sentFacts)}`);
    if (!askedFacts || askedFacts.lists || askedFacts.facts !== sentFacts.facts) {
      return report(false, `the review page, asking for it, got ${JSON.stringify(askedFacts)}`);
    }
    if (JSON.stringify(painted.heads) !== JSON.stringify(["What Riot's record shows"]) || painted.facts !== sentFacts.facts || painted.fixes) {
      return report(false, `the Riot only review painted ${JSON.stringify(painted)}`);
    }
    if (painted.eye) return report(false, "the review graded from Riot's record alone has an eye, with nothing recorded");
    if (errs.length) return report(false, 'renderer errors: ' + errs.join(' | '));
    report(true, 'ok');
  } catch (e) {
    report(false, 'threw: ' + e.message);
  }
}, 6500);

require(path.join(REPO, 'src/main/index.js'));

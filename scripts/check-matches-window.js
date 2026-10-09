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
 * broken down one mode at a time, with no All that folds them together.
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
  console.log('PASS: saved reviews are listed, patterns and the breakdown paint and sort for every game, the grading line follows the Riot ID, and a row opens its review');
  process.exit(0);
}

const { app, BrowserWindow } = require('electron');
const { replay, load } = require('./fixtures/replay-match');
const verify = require(path.join(REPO, 'src/shared/valorant-verify'));
const valorantReview = require(path.join(REPO, 'src/shared/valorant-review'));
const riotReview = require(path.join(REPO, 'src/shared/riot-review'));
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
rounds.find((r) => r.n === 2).forensics = { cause: 'dry-peek', what: 'You swung wide with nothing thrown.', better: 'Wait for the flash.', frames: ['r2-before.jpg'] };
// The agent Riot's record names for this match. The replayed context carries
// none, and the breakdown's By agent cut needs one to list the match under.
const built = valorantReview.build({ rounds, context: { ...played.context, agent: 'Jett' }, endedBy: 'score', ai: {}, role: 'Duelist', history: [],
  riotMe: { kills: 31, deaths: 21, assists: 4, score: 9168 } });
const store = new ReviewStore(path.join(ud, 'reviews'));
const now = Date.now();
const ids = [0, 1, 2].map((i) => {
  const id = newId('valorant', now - i * 3600000);
  const review = { ...built, id, at: now - i * 3600000, kind: 'valorant' };
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
  const matchesWindow = require(path.join(REPO, 'src/main/windows/matches-window'));
  try {
    matchesWindow.open();
    await new Promise((r) => setTimeout(r, 3200));
    const win = BrowserWindow.getAllWindows().find((w) => (w.webContents.getURL() || '').includes('/matches/'));
    if (!win) return report(false, 'the matches window never opened');
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

    // The breakdown: two maps, two agents, a row that opens in place.
    const bShown = await js("!document.getElementById('breakdown').hidden");
    const maps = await js("[...document.querySelectorAll('#b-table .b-row .b-name span:first-child')].map((n) => n.textContent).join(',')");
    lines.push(`breakdown shown=${bShown} maps=${maps}`);
    if (!bShown) return report(false, 'the breakdown section stayed hidden with four saved matches');
    if (maps !== 'Abyss,Bind') return report(false, `the breakdown listed maps ${maps}, expected Abyss,Bind`);

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

    // Click the newest row: it must open the review window on that match.
    await js("document.querySelector('#list .m-row').click(); true");
    await new Promise((r) => setTimeout(r, 3500));
    const rwin = BrowserWindow.getAllWindows().find((w) => (w.webContents.getURL() || '').includes('/review/'));
    if (!rwin) return report(false, 'clicking a row did not open the review window');
    const rjs = (s) => rwin.webContents.executeJavaScript(s);
    const shown = await rjs("!document.getElementById('vreview').hidden");
    const letter = await rjs("(document.querySelector('.gv-letter') || {}).textContent || ''");
    const img = await rjs("(document.querySelector('.v-shot img') || {}).src || ''");
    const ask = await rjs("!document.getElementById('ask').hidden");
    lines.push(`review shown=${shown} letter=${letter} frame=${img.slice(0, 30)} ask=${ask}`);
    if (!shown) return report(false, 'the review window opened empty');
    if (letter !== built.grade.letter) return report(false, `the review painted grade ${letter}, expected ${built.grade.letter}`);
    if (!img.startsWith('data:image/jpeg;base64,')) return report(false, 'the kept frame did not reach the review');
    if (!ask) return report(false, 'a saved review offers no Ask about this match');
    if (errs.length) return report(false, 'renderer errors: ' + errs.join(' | '));
    report(true, 'ok');
  } catch (e) {
    report(false, 'threw: ' + e.message);
  }
}, 6500);

require(path.join(REPO, 'src/main/index.js'));

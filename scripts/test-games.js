'use strict';

/**
 * The game registry, the promise that an unfinished game is never sold, and
 * what an install kept of a game Occlara no longer coaches.
 *
 * The dangerous failure here is not a crash, it is a plausible lie: a player
 * selects a game, the app looks right, and the Valorant engine keeps coaching
 * underneath. Everything would look right and every tip would be about a game
 * they are not playing. So `coaching: false` is enforced rather than trusted,
 * and the picker hides a game until its coach genuinely exists.
 *
 * TWO GAMES, VALORANT AND LEAGUE OF LEGENDS. Marvel Rivals was coached until
 * 8.3.2 and is not any more, so a profile that version left is put away at
 * launch (src/main/services/retired-games.js): a stored game of it becomes
 * Valorant, its config keys go, and its saved reviews are deleted with their
 * folders and library rows, logged in one line, and never listed, opened or
 * counted before that either (review-store.js). rivalsTitlesRepaired is NOT
 * one of its keys: it says an install ran 8.0.3 (index.js keepOldConnection),
 * and it stays. Each of those is held below on the real store library (conf,
 * which electron-store wraps) and the real review store, in temp folders.
 *
 * Run: npm run test:games
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const games = require(path.join(__dirname, '..', 'src', 'shared', 'games.js'));

let pass = 0, fail = 0;
const check = (name, ok, detail) => {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : `\n        ${detail}`}`);
};

console.log('two games, Valorant and League of Legends:');
check('  the registry holds exactly Valorant and League',
  Object.keys(games.GAMES).join(',') === 'valorant,lol', Object.keys(games.GAMES).join(','));
check('  and the picker offers exactly those, in that order, even with devGames on',
  games.list().map((g) => g.id).join(',') === 'valorant,lol' && games.list(true).map((g) => g.id).join(',') === 'valorant,lol',
  `${games.list().map((g) => g.id).join(',')} | ${games.list(true).map((g) => g.id).join(',')}`);
check('  Marvel Rivals is retired, in any case, and nothing else is',
  games.isRetired('rivals') && games.isRetired('RIVALS') && !games.isRetired('valorant') && !games.isRetired('lol')
    && !games.isRetired('') && !games.isRetired(null) && games.RETIRED.join(',') === 'rivals');
check('  and its id falls back to the default like any unknown one', games.get('rivals').id === 'valorant');

console.log('\na game is selectable only when it is coachable OR marked preview:');
check('  every listed game is coachable or a labelled preview',
  games.list().every((g) => g.coaching || g.preview),
  games.list().map((g) => `${g.id}(${g.coaching ? 'coach' : g.preview ? 'preview' : 'NEITHER'})`).join(', '));
// Coaching is not one switch. League's review is built and its live coach
// must never be, so it carries a feature map and counts as coachable when
// any of it works.
check('  League IS coachable, because its review works', games.canCoach('lol') === true);
check('  its live feature is OFF, and must stay so', games.hasFeature('lol', 'live') === false);
check('  and it has no stats source, said explicitly', games.get('lol').features.stats === false);
check('  Valorant has every feature without listing them',
  games.hasFeature('valorant', 'review') === true && games.hasFeature('valorant', 'live') === true);
check('  an unknown feature is not silently granted',
  games.hasFeature('lol', 'nonsense') === false);
check('  and League is flagged preview so the UI can say so',
  games.get('lol').preview === true,
  'without this the picker offers it as if it were finished');
check('  Valorant is coachable', games.canCoach('valorant') === true);

// THE SAFETY PROPERTY. Selecting a game must refuse to coach it rather than
// coach it with the Valorant engine. Those tips would read perfectly and
// describe a game the player is not in, which is worse than silence because
// it is believable. Asserted against the real source, not against a comment.
const mainSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'index.js'), 'utf8');
const startBody = (mainSrc.match(/\n  start\(\)\s*\{[\s\S]*?\n    engine = new CoachingEngine/) || [''])[0];
check('  start() refuses a game it cannot coach',
  /canCoach\(/.test(startBody),
  'start() would construct the Valorant engine whatever game is selected');
check('  and it refuses BEFORE building the engine',
  startBody.indexOf('canCoach(') < startBody.indexOf('new CoachingEngine'));
check('  and it starts no engine for Marvel Rivals any more',
  !!startBody && !/chosenGame === 'rivals'|RivalsEngine/.test(mainSrc) && !fs.existsSync(path.join(__dirname, '..', 'src', 'main', 'services', 'rivals-engine.js')));

console.log('\nlookups never throw:');
check('  an unknown id falls back to the default', games.get('fortnite').id === 'valorant');
check('  so do null and undefined', games.get(null).id === 'valorant' && games.get().id === 'valorant');
check('  ids are case insensitive', games.get('VALORANT').id === 'valorant');

console.log('\nevery game is complete enough to render:');
for (const g of Object.values(games.GAMES)) {
  // Readiness is declared either way round: a single `coaching` boolean, or a
  // per-feature map for a game whose halves are not equally finished. What is
  // NOT allowed is declaring neither, which would leave canCoach guessing.
  const declaresReadiness = typeof g.coaching === 'boolean'
    || (g.features && typeof g.features === 'object' && Object.keys(g.features).length > 0);
  check(`  ${g.id}`, !!(g.id && g.label && g.cadence && declaresReadiness),
    JSON.stringify(g).slice(0, 90));
}

console.log('\nthe palette matches the stylesheet:');
// A palette declared here but absent from theme.css would silently do nothing,
// which is the same class of bug as a config key that is written and never read.
const theme = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'shared', 'theme.css'), 'utf8');
for (const [id, g] of Object.entries(games.GAMES)) {
  if (!g.palette) continue;
  const block = theme.match(new RegExp(`:root\\[data-game="${id}"\\]\\s*\\{([\\s\\S]*?)\\n\\}`));
  check(`  ${id} has a :root[data-game] block`, !!block);
  if (!block) continue;
  const missing = Object.keys(g.palette).filter((t) => !block[1].includes(t + ':'));
  check(`  ${id} declares every token it claims`, missing.length === 0, `missing: ${missing.join(', ')}`);
}
check('  and no game repaints the app any more: one palette, no per-game block',
  Object.values(games.GAMES).every((g) => !g.palette) && !/:root\[data-game=/.test(theme));

console.log('\nstatus and structural tokens are NOT overridden per game:');
// A win must be green in every game, and radii/motion/type are shared. The
// first attempt at a per-game block swallowed --r-sm, --ease, --lift and
// --font, which would have stripped Valorant of its radii and typeface.
const MUST_NOT_MOVE = ['--good', '--bad', '--warn', '--r-sm', '--r-md', '--ease', '--lift', '--font', '--t-fast'];
for (const [id, g] of Object.entries(games.GAMES)) {
  if (!g.palette) continue;
  const bad = MUST_NOT_MOVE.filter((t) => Object.keys(g.palette).includes(t));
  check(`  ${id} leaves shared tokens alone`, bad.length === 0, `overrides: ${bad.join(', ')}`);
  const block = theme.match(new RegExp(`:root\\[data-game="${id}"\\]\\s*\\{([\\s\\S]*?)\\n\\}`));
  if (block) {
    const leaked = MUST_NOT_MOVE.filter((t) => block[1].includes(t + ':'));
    check(`  ${id} block does not swallow shared tokens`, leaked.length === 0,
      `found in the block: ${leaked.join(', ')}`);
  }
}

// ── What 8.3.2 kept of Marvel Rivals, put away at launch ────────────────────
const retired = require(path.join(__dirname, '..', 'src', 'main', 'services', 'retired-games.js'));
const { ReviewStore, newId } = require(path.join(__dirname, '..', 'src', 'main', 'services', 'review-store.js'));
const { STORE_DEFAULTS } = require(path.join(__dirname, '..', 'src', 'shared', 'config.js'));
const Conf = require('conf');

console.log('\nthe config a Rivals player left:');
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'occlara-games-config-'));
  try {
    // The real store library, on the real defaults, as electron-store opens it.
    const open = () => new Conf({ cwd: dir, configName: 'occlara-config', projectName: 'occlara-test', defaults: STORE_DEFAULTS });
    check('  the defaults carry no Rivals key, so none is written back on the next launch',
      !Object.keys(STORE_DEFAULTS).some((k) => /^rivals/i.test(k)), Object.keys(STORE_DEFAULTS).filter((k) => /rivals/i.test(k)).join(', '));
    fs.writeFileSync(path.join(dir, 'occlara-config.json'), JSON.stringify({
      ...STORE_DEFAULTS, game: 'rivals', riotId: 'Me#EUW', riotConnected: 'Me#EUW', riotConnectedKept: true,
      rivalsTitlesRepaired: true, rivalsHistory: [{ at: 1, hero: 'Luna Snow', role: 'Strategist', kills: 10 }],
      lolHistory: [{ at: 2 }], valorantHistory: [{ at: 3 }],
    }));
    const store = open();
    const said = retired.config(store);
    check('  a stored game of Marvel Rivals becomes Valorant', store.get('game') === 'valorant', store.get('game'));
    check('  its history goes', !store.has('rivalsHistory'));
    check('  and it says what it did', said.game === 'rivals' && said.keys.join(',') === 'rivalsHistory', JSON.stringify(said));
    check('  rivalsTitlesRepaired STAYS: it says this install ran 8.0.3, and is no Rivals key',
      store.get('rivalsTitlesRepaired') === true && !retired.KEYS.includes('rivalsTitlesRepaired'));
    check('  and nothing else moves: the Riot ID, its connection, the other games\' history',
      store.get('riotId') === 'Me#EUW' && store.get('riotConnected') === 'Me#EUW' && store.get('riotConnectedKept') === true
        && store.get('lolHistory').length === 1 && store.get('valorantHistory').length === 1);
    const onDisk = JSON.parse(fs.readFileSync(path.join(dir, 'occlara-config.json'), 'utf8'));
    check('  on disk too', onDisk.game === 'valorant' && !('rivalsHistory' in onDisk) && onDisk.rivalsTitlesRepaired === true);
    const next = open();
    const again = retired.config(next);
    check('  the next launch finds nothing to do, and the history does not come back',
      !again.game && !again.keys.length && !next.has('rivalsHistory') && next.get('game') === 'valorant', JSON.stringify(again));
    for (const g of ['valorant', 'lol']) {
      next.set('game', g);
      const left = retired.config(next);
      check(`  a stored game of ${g} is left as it is`, next.get('game') === g && !left.game);
    }
    next.set('game', 'Rivals');
    retired.config(next);
    check('  and Rivals saved in another case is Valorant too', next.get('game') === 'valorant');
    // An install that never ran 8.0.3 has no rivalsTitlesRepaired, and the
    // put away must not write one: keepOldConnection reads its absence.
    next.delete('rivalsTitlesRepaired');
    retired.config(next);
    check('  and an install that never ran 8.0.3 is not made to look as if it had', !next.has('rivalsTitlesRepaired'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

console.log('\nthe Rivals reviews a library kept:');
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'occlara-games-reviews-'));
  try {
    const store = new ReviewStore(dir);
    const T = 1759000000000;
    const graded = (score) => ({ score, letter: 'B', provisional: false, categories: [] });
    const jpeg = Buffer.from('a kept frame').toString('base64');
    // A Valorant and a League review whose own sentences name the game, the
    // way a player's words or a model's can: they are no Rivals reviews. Only
    // the game a review was saved under, and the id that starts with it, say
    // whose it is.
    // The library row carries words of its own too (its top mistake's title),
    // so one names the game there as well.
    const NAMED = {
      summary: 'Your rivals traded every entry, and the Marvel Rivals habit of diving alone cost round 9.',
      title: 'Died where your rivals could not be traded',
      fix: 'Swing beside a teammate, so your rivals never get you alone.',
      death: 'An ally died in the 20 s before, to the same rivals.',
    };
    const val = newId('valorant', T);
    store.save({ id: val, game: 'valorant', at: T, frames: { 'r2-before.jpg': jpeg },
      review: { id: val, kind: 'valorant', game: { map: 'Abyss', agent: 'Jett', result: 'Victory' }, grade: graded(71), summary: NAMED.summary,
        insights: { mistakes: [{ key: 'untraded', title: NAMED.title, count: 3, rounds: [2, 5, 9], fix: NAMED.fix }], strengths: [], missed: [] } } });
    store.saveClip(val, 'r2-clip.mkv', Buffer.from('a clip'));
    const lol = newId('lol', T - 3600000);
    store.save({ id: lol, game: 'lol', at: T - 3600000, review: { id: lol, kind: 'lol', game: { champion: 'Ahri' }, grade: graded(64),
      deaths: [{ at: 610, fact: NAMED.death }] } });
    const asSaved = () => {
      const v = store.get(val);
      const l = store.get(lol);
      return !!v && !!l && v.review.summary === NAMED.summary && v.review.insights.mistakes[0].fix === NAMED.fix
        && l.review.deaths[0].fact === NAMED.death;
    };
    check('  seeded: a Valorant and a League review whose sentences name Marvel Rivals, the Valorant one\'s row too',
      asSaved() && /Marvel Rivals/.test(NAMED.summary) && /rivals/.test(NAMED.death)
        && store.index().find((r) => r.id === val).topMistake === NAMED.title && /rivals/.test(NAMED.title));
    // Marvel Rivals, newest of all and graded higher, as 8.3.2 saved it.
    const rv = [1, 2].map((i) => {
      const id = newId('rivals', T + i * 3600000);
      store.save({ id, game: 'rivals', at: T + i * 3600000, frames: i === 1 ? { 'scoreboard.jpg': jpeg } : undefined,
        review: { id, kind: 'rivals', empty: false, game: { hero: 'Luna Snow', role: 'Strategist', map: 'Tokyo 2099', result: 'VICTORY' },
          grade: graded(90), insights: { mistakes: [{ key: 'vs:deaths', title: 'Deaths up 38%', count: 1, rounds: [] }], strengths: [], missed: [] } } });
      return id;
    });
    // A file of one left without a row, and a row left without its file.
    const orphan = newId('rivals', T + 5 * 3600000);
    fs.writeFileSync(path.join(dir, `${orphan}.json`), JSON.stringify({ id: orphan, game: 'rivals', at: T, review: { kind: 'rivals' } }));
    const ghost = newId('rivals', T + 6 * 3600000);
    fs.writeFileSync(path.join(dir, 'index.json'), JSON.stringify([
      { id: ghost, game: 'rivals', at: T + 6 * 3600000, title: 'Hela', grade: { score: 95, letter: 'S' } },
      ...JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8')),
    ]));
    const onDisk = () => fs.readdirSync(dir).filter((n) => n.startsWith('rivals-')).sort();
    check('  seeded: two Rivals reviews, one with a frame, a file with no row and a row with no file',
      onDisk().length === 4 && store.index().filter((r) => r.game === 'rivals').length === 3, onDisk().join(', '));

    // BEFORE THE LAUNCH PUTS THEM AWAY, NONE OF IT IS LISTED, OPENED OR COUNTED.
    check('  the library never lists one, of every game or of its own',
      store.list().map((r) => r.id).join(',') === `${val},${lol}` && !store.list('rivals').length,
      store.list().map((r) => r.id).join(','));
    check('  so the newest graded match, the panel\'s last grade, is Valorant\'s and never a Rivals one',
      store.list().find((r) => r.grade).id === val);
    check('  none opens, by its id', [...rv, orphan, ghost].every((id) => store.get(id) === null));
    check('  and none is counted: the last matches of its game are none, and Valorant\'s are Valorant\'s alone',
      !store.recent('rivals').length && store.recent('valorant').map((e) => e.id).join(',') === val);
    const patterns = require(path.join(__dirname, '..', 'src', 'shared', 'patterns.js'));
    const breakdown = require(path.join(__dirname, '..', 'src', 'shared', 'breakdown.js'));
    const p = patterns.summarise(store.recent('rivals', patterns.LOOK_BACK));
    const b = breakdown.build('rivals', store.recent('rivals', 300));
    check('  not in the patterns or the breakdown either', p.matches === 0 && !p.mistakes.length && b.matches === 0 && !b.dims.length,
      `patterns over ${p.matches}, breakdown over ${b.matches}`);

    // THE LAUNCH: deleted, each with its folder and its row, said in one line.
    const said = [];
    const out = retired.putAway({ store: { get: () => 'valorant', has: () => false }, reviewStore: store, log: (l) => said.push(l) });
    check('  the launch deletes all four', out.reviews === 4, String(out.reviews));
    check('  their files and the folder of frames are gone', onDisk().length === 0, onDisk().join(', '));
    check('  and their rows', store.index().map((r) => r.id).join(',') === `${val},${lol}`, store.index().map((r) => r.id).join(','));
    check('  logged in one line', said.length === 1 && /deleted 4 saved reviews of a game Occlara no longer coaches/.test(said[0]), said.join(' | '));
    check('  the Valorant review keeps its frame and its clip, and League its review',
      store.frame(val, 'r2-before.jpg') === jpeg && store.hasClip(val, 'r2-clip.mkv') && store.get(lol) && store.get(val).review.grade.score === 71);
    check('  and the two whose sentences name Marvel Rivals survive it, listed, opened whole and counted, every sentence as saved',
      asSaved() && store.list('valorant').map((r) => r.id).join(',') === val && store.list('lol').map((r) => r.id).join(',') === lol
        && store.list('valorant')[0].topMistake === NAMED.title && store.recent('valorant').length === 1 && store.recent('lol').length === 1);
    const index = fs.readFileSync(path.join(dir, 'index.json'), 'utf8');
    const said2 = [];
    const out2 = retired.putAway({ store: { get: () => 'valorant', has: () => false }, reviewStore: store, log: (l) => said2.push(l) });
    check('  once: the next launch deletes nothing, rewrites nothing and says nothing',
      out2.reviews === 0 && !said2.length && fs.readFileSync(path.join(dir, 'index.json'), 'utf8') === index && store.list().length === 2);
    const emptyDir = path.join(dir, 'none-yet');
    check('  and a profile with no library at all is left without one', new ReviewStore(emptyDir).removeRetired() === 0 && !fs.existsSync(emptyDir));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

console.log('\nthe library\'s index, read once by the launch and never written blind:');
{
  // The put away reads the index once and writes it back from that read
  // alone. It read it again after the deletes, and an index the disk did not
  // hand over at that moment (a scanner holding the file) read as no rows,
  // which it wrote back empty over every Valorant and League row.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'occlara-games-index-'));
  const realRead = fs.readFileSync;
  try {
    const store = new ReviewStore(dir);
    const T = 1759000000000;
    const INDEX = path.join(dir, 'index.json');
    const keep = [newId('valorant', T), newId('lol', T - 3600000)];
    store.save({ id: keep[0], game: 'valorant', at: T, review: { id: keep[0], kind: 'valorant', game: { map: 'Bind', agent: 'Sova' } } });
    store.save({ id: keep[1], game: 'lol', at: T - 3600000, review: { id: keep[1], kind: 'lol', game: { champion: 'Ahri' } } });
    const rivalsReview = (at) => {
      const id = newId('rivals', at);
      store.save({ id, game: 'rivals', at, review: { id, kind: 'rivals', empty: false, game: { map: 'Tokyo 2099' } } });
      return id;
    };
    const first = rivalsReview(T + 3600000);
    // The disk holding the index back from its `from`th read on.
    const holdIndex = (from) => {
      let n = 0;
      fs.readFileSync = function (p, ...rest) {
        if (path.resolve(String(p)) === path.resolve(INDEX) && ++n >= from) {
          throw Object.assign(new Error('EBUSY: resource busy or locked'), { code: 'EBUSY' });
        }
        return realRead.call(this, p, ...rest);
      };
    };
    const rowsOnDisk = () => JSON.parse(realRead(INDEX, 'utf8')).map((r) => r.id).sort().join(',');
    const KEPT = [...keep].sort().join(',');
    const launch = () => retired.putAway({ store: { get: () => 'valorant', has: () => false }, reviewStore: store, log: () => {} });
    check('  the disk stand in holds the index back from the read it is told to, and only the index',
      (() => {
        holdIndex(2);
        try { return store.index().length === 3 && store.index().length === 0 && !!store.get(keep[0]); } finally { fs.readFileSync = realRead; }
      })());

    holdIndex(2);
    let out;
    try { out = launch(); } finally { fs.readFileSync = realRead; }
    check('  held back after its first read, the launch still deletes the Rivals review and keeps every Valorant and League row',
      out.reviews === 1 && rowsOnDisk() === KEPT && !fs.existsSync(path.join(dir, `${first}.json`)), rowsOnDisk());

    const second = rivalsReview(T + 7200000);
    const before = realRead(INDEX, 'utf8');
    holdIndex(1);
    try { out = launch(); } finally { fs.readFileSync = realRead; }
    check('  held back from the first read, the review\'s file goes and the index it could not read is never written over',
      out.reviews === 1 && realRead(INDEX, 'utf8') === before && !fs.existsSync(path.join(dir, `${second}.json`)));
    check('  where its row is never listed or opened in the meantime',
      store.list().map((r) => r.id).sort().join(',') === KEPT && store.get(second) === null);
    out = launch();
    check('  and the next launch that reads it drops that row, every other row kept',
      out.reviews === 1 && rowsOnDisk() === KEPT && store.list().length === 2, rowsOnDisk());
  } finally {
    fs.readFileSync = realRead;
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

console.log('\nthe launch puts it away before any page can ask:');
{
  // index.js, as the app is ready: after the log opens, before the IPC is
  // registered, so no page can list or open a review the launch is about to
  // delete, and on every launch, licence or not.
  const ready = (mainSrc.match(/app\.whenReady\(\)\.then\(\(\) => \{[\s\S]*?registerIpc\(/) || [''])[0];
  check('  retiredGames.putAway runs when the app is ready, on the store and the review store',
    /retiredGames\.putAway\(\{ store, reviewStore \}\)/.test(ready), ready.slice(0, 120));
  check('  after the debug log opens, so its one line is kept',
    ready.indexOf('logger.init(app)') >= 0 && ready.indexOf('logger.init(app)') < ready.indexOf('retiredGames.putAway'));
  // rivalsTitlesRepaired is still written at the first launch, where the
  // repair that named it wrote it: keepOldConnection reads its absence as an
  // install that never ran 8.0.3.
  const surfacesBody = (mainSrc.match(/function createAppSurfaces\(opts\) \{[\s\S]*?\n\}/) || [''])[0];
  check('  and createAppSurfaces still writes rivalsTitlesRepaired at the first launch',
    /if \(!store\.get\('rivalsTitlesRepaired'\)\)[\s\S]{0,80}store\.set\('rivalsTitlesRepaired', true\)/.test(surfacesBody));
  check('  which keepOldConnection still reads',
    /\(function keepOldConnection\(\) \{[\s\S]*?if \(store\.get\('rivalsTitlesRepaired'\)\) return;/.test(mainSrc));
}

console.log('\nnothing else in src/ names it:');
{
  // games.js names the retired id and retired-games.js puts its data away.
  // Anywhere else in src/ a line naming it is index.js beside the launch's
  // put away or beside rivalsTitlesRepaired, the 8.0.3 marker that only
  // carries the name: no engine, no review kind, no copy, no channel.
  const SRC = path.join(__dirname, '..', 'src');
  const named = (line) => /rivals|marvel|netease/i.test(line.replace(/arrivals?/gi, ''));
  check('  the detector finds the name and passes over "arrivals"',
    named('Marvel Rivals') && named("game: 'rivals'") && named('NetEase') && !named('the frames arrivals') && !named('League of Legends'));
  const hits = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      if (!/[.](js|json|html|css)$/.test(e.name)) continue;
      const rel = path.relative(SRC, p).split(path.sep).join('/');
      if (rel === 'shared/games.js' || rel === 'main/services/retired-games.js') continue;
      const lines = fs.readFileSync(p, 'utf8').split('\n');
      lines.forEach((line, i) => {
        if (!named(line)) return;
        const near = lines.slice(Math.max(0, i - 8), i + 9).join('\n');
        const allowed = rel === 'main/index.js' && /rivalsTitlesRepaired|retiredGames\.putAway/.test(near);
        if (!allowed) hits.push(`src/${rel}:${i + 1}`);
      });
    }
  };
  walk(SRC);
  check('  outside them, only index.js beside the put away and rivalsTitlesRepaired', !hits.length, hits.slice(0, 10).join(', '));
  const gone = ['main/services/rivals-engine.js', 'main/services/tip-hygiene.js', 'main/services/review-repair.js',
    'shared/rivals-abilities.js', 'shared/rivals-abilities.generated.json', 'shared/rivals-balance.generated.json', 'shared/rivals-comp.js',
    'shared/rivals-draft.js', 'shared/rivals-meta.js', 'shared/rivals-moments.js', 'shared/rivals-review.js'];
  const still = gone.filter((f) => fs.existsSync(path.join(SRC, f)));
  check('  and its engine, its game data, its review and the repair of its titles are gone', !still.length, still.join(', '));
}

// ── The AI log a Rivals player's 8.3.2 kept ─────────────────────────────────
// Only the Valorant reader ever wrote the AI log, so every session in it is a
// Valorant session, whatever was on screen. One recorded with Valorant chosen
// while Marvel Rivals was played is the reader's misreads of it: a map
// Valorant does not have, a hero's health, no score and no match. It is the
// player's log, and it lists and opens as any other session does, through the
// real store and the real AI log page, and holds no match a review is found
// in. A Start with nothing read leaves a folder with no index, listed nowhere.
async function aiLogKept() {
  console.log('\nthe AI log a Rivals player\'s 8.3.2 kept opens as any other:');
  const aiLogStore = require(path.join(__dirname, '..', 'src', 'main', 'services', 'ai-log-store.js'));
  const C = require(path.join(__dirname, '..', 'src', 'shared', 'channels.js'));
  const { loadSurface, settle } = require('./fixtures/fake-dom');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'occlara-games-ailog-'));
  try {
    const jpeg = Buffer.from('ffd8ffe000104a464946', 'hex');
    const session = (name, recs, mtime) => {
      const dir = path.join(root, name);
      fs.mkdirSync(dir, { recursive: true });
      const records = recs.map(([at, state, match, died], i) => {
        const frame = `frame-${String(i).padStart(5, '0')}.jpg`;
        fs.writeFileSync(path.join(dir, frame), jpeg);
        return { i, at, frame, state, round: match ? 3 : null, died: !!died, match };
      });
      fs.writeFileSync(path.join(dir, 'log.json'), JSON.stringify({ startedAt: records[0].at, records }));
      fs.utimesSync(dir, mtime / 1000, mtime / 1000);
      return name;
    };
    // A Valorant match whose review was saved before 8.2, found by its end.
    const M = Date.UTC(2026, 9, 10, 19, 30, 0);
    const END = M + 30 * 60000;
    const ALIVE = { map: 'Abyss', playerAlive: true, playerHp: 100, teamScore: 3, enemyScore: 2 };
    const DEAD = { map: 'Abyss', playerAlive: false, phase: 'dead', aliveTell: 'killed by Jett, spectating a teammate', teamScore: 3, enemyScore: 2 };
    const valS = session('session-2026-10-10T19-29-00-000Z',
      [[M + 60000, ALIVE, M], [M + 70000, DEAD, M, true], [M + 80000, DEAD, M], [END - 30000, ALIVE, M]], END - 30000);
    // An hour later, what the Valorant reader made of a Marvel Rivals screen.
    const R = END + 3600000;
    const MISREAD = { map: 'Tokyo 2099', playerAlive: true, playerHp: 250, playerWeapon: 'Ice Arts', playerNote: 'a Strategist healing a Vanguard' };
    const rivS = session('session-2026-10-10T21-00-00-000Z',
      [[R, MISREAD, null], [R + 1000, { ...MISREAD, playerHp: 0, playerAlive: false, aliveTell: 'KO by Hela' }, null], [R + 2000, MISREAD, null]], R + 2000);
    fs.mkdirSync(path.join(root, 'session-2026-10-10T22-00-00-000Z'));

    const listed = aiLogStore.sessions(root, null);
    check('  both sessions with an index are listed, the newest first, the folder with none is not',
      listed.map((s) => s.id).join(',') === `${rivS},${valS}` && listed[0].frames === 3 && listed[1].frames === 4,
      JSON.stringify(listed.map((s) => [s.id, s.frames])));
    const plain = aiLogStore.serve(root, null, null, false);
    check('  opened plainly, the log serves the newest session whole, every frame, no error',
      plain.session === rivS && plain.records.length === 3 && plain.records.every((r) => r.frameData) && !plain.error && !plain.gone,
      JSON.stringify({ session: plain.session, frames: plain.records.length, error: plain.error }));
    check('  it holds no match, so no review is ever found in it', !aiLogStore.matchesIn(root, rivS).length);
    const finished = aiLogStore.dirs(root).map((id) => ({ id, spans: aiLogStore.matchesIn(root, id) }));
    const found = aiLogStore.locate(finished, END);
    check('  and a Valorant review saved before 8.2 still finds its match in the session before it',
      !!found && found.session === valS && found.match === M, JSON.stringify(found));

    // What the page logs when it throws or cannot load, never what it logs when well.
    const THROWN = /error|undefined|cannot|not a function|failed/i;
    check('  the detector finds what a page throws or fails to load, and passes over what it says when well',
      THROWN.test('TypeError: x is not a function') && THROWN.test('Cannot read properties of undefined')
        && THROWN.test('[ailog] load failed nope') && !THROWN.test('[ailog] ready'));
    for (const [hash, frames, what, death] of [['', 3, 'opened plainly, on that session', null], [`#${valS}`, 4, 'and on the Valorant one, with its death', 1]]) {
      const page = loadSurface('ailog', {
        handlers: {
          [C.AILOG_GET]: (id, scope) => (scope ? aiLogStore.read(root, id, null, scope) : aiLogStore.serve(root, id, null, false)),
          [C.AILOG_CONFIRM]: () => ({ status: 'unavailable' }),
          [C.CONFIG_GET]: () => ({ ailogHintSeen: 3 }),
        },
        window: { location: { hash, search: '' } },
      });
      await settle();
      const shown = Number(page.$('slider').max) + 1;
      const deaths = page.document.querySelectorAll('#marks .mark-death').length;
      const errors = page.logs.filter((l) => THROWN.test(l));
      check(`  the AI log page paints it ${what}: ${frames} frames`,
        !page.$('main').hidden && page.$('empty').hidden && shown === frames && (death === null || deaths === death) && !errors.length,
        JSON.stringify({ main: !page.$('main').hidden, shown, deaths, errors, sub: page.$('subtitle').textContent }));
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

aiLogKept()
  .catch((e) => check('the AI log a Rivals player kept was read without throwing', false, e && e.stack))
  .then(() => {
    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
  });

'use strict';

/**
 * THE SITE'S PROOF, FROM THE REAL APP (8.7, the 8.9 pages since 8.9.2). The website's demos are made
 * from pictures of the app itself and the strings its pages print, never
 * invented: this boots the one window on the sample library
 * (scripts/fixtures/proof-reviews.js, the same four reviews check:mainwindow
 * asserts on), walks the real pages, and writes into --out:
 *
 *   proof.generated.json   finished display strings read off the pages: the
 *                          Verdict, the four categories with their evidence
 *                          chips, the coach's read, the fix line, the repeated
 *                          mistakes, the rounds, the progress lines, the
 *                          Moments entries. No player name, no Riot ID, no
 *                          dash, no date, no id: deterministic, and stamped
 *                          with the git commit.
 *   home.webp, matches.webp, moments.webp, review-top.webp, review-rounds.webp,
 *   settings.webp, invite.webp, sealed.webp
 *                          the window at 1280 by 800 and a device scale of 2,
 *                          taken through scripts/fixtures/window-shot.js, the
 *                          machinery check:mainwindow shoots with, each only
 *                          once two captures a beat apart are the same bytes
 *                          (nothing mid animation) and the picture holds ink.
 *   verdict-card.webp      the Verdict's share image, drawn by the review
 *                          page's own verdict-card.js.
 *   mark.json              the crescent's path and the ground and ink tokens.
 *
 * ORBIT (28 Nov 2026): the top bar is four links (Home, Matches, Practice,
 * Clips), Matches holding Patterns and Stats behind its sub switch, so the
 * walk reaches Patterns by that switch as a player does. The JSON names the
 * bar's height (window.bar, main-window.js TOP_H) for the site to lay a page
 * under a picture's bar, and `places` holds where the site's pointer goes on
 * each picture, read off the laid out pages: the four links, the sub switch
 * and the rows on Matches, the chips of the compilation and their Play all,
 * the hero and the filter on Clips, and Ask about this match, Every round,
 * the grade and the fix on the review. The ambient loops (the agent's drift,
 * the twinkling stars) are paused before each picture, or two captures never
 * agree.
 *
 * NOT WRITTEN HERE: the site's two clips of real matches (clip.mp4,
 * clip2.mp4, their posters and their clip-review.json, clip2-review.json).
 * The sample library's one kept clip is a stub of a few bytes, and no clip or
 * frame of a real session ever reaches this repo, so those six files are put
 * beside this export by hand from the owner's own library, and a new export
 * must be copied over them, never in place of the folder.
 *
 * Everything that leaves the repo is labelled "Sample match". The PNGs are
 * converted to WebP with ffmpeg; the whole set must stay under 3 MB.
 *
 * Results travel through a FILE, not stdout: an Electron main process on
 * Windows does not reliably flush a piped stdout.
 *
 *   node scripts/export-site-proof.js --out <dir> [--json-only]
 *
 * --json-only writes proof.generated.json and mark.json alone, at the
 * display's own scale, for test:siteproof.
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

const REPO = path.join(__dirname, '..');
const WORK = process.env.OCCLARA_PROOF_WORK || path.join(os.tmpdir(), 'occlara-site-proof');
const RESULT = path.join(WORK, 'result.json');
const SHOT_NAMES = ['home', 'matches', 'moments', 'review-top', 'review-rounds', 'settings', 'invite', 'sealed'];
const WIN = { width: 1280, height: 800, scale: 2 };
const MAX_BYTES = 3 * 1024 * 1024;
// The two dashes the house rules ban, as escapes so this file carries neither.
const DASHES = new RegExp('[\\u2013\\u2014]');

function argOf(name) {
  const i = process.argv.indexOf(name);
  return i === -1 ? null : process.argv[i + 1] || null;
}

// ── The node side: spawn Electron, then convert and report ──────────────────
if (!process.versions.electron) {
  const { spawnSync } = require('child_process');
  const outArg = argOf('--out');
  if (!outArg) { console.error('usage: node scripts/export-site-proof.js --out <dir> [--json-only]'); process.exit(2); }
  const out = path.resolve(outArg);
  const jsonOnly = process.argv.includes('--json-only');
  fs.mkdirSync(out, { recursive: true });
  fs.rmSync(WORK, { recursive: true, force: true });
  fs.mkdirSync(WORK, { recursive: true });

  const git = (args) => { const r = spawnSync('git', args, { cwd: REPO, encoding: 'utf8' }); return r.status === 0 ? String(r.stdout).trim() : ''; };
  const commit = git(['rev-parse', 'HEAD']);
  const dirty = git(['status', '--porcelain']) !== '';

  const electron = require('electron');
  const env = Object.assign({}, process.env, { OCCLARA_PROOF_WORK: WORK, OCCLARA_PROOF_COMMIT: commit, OCCLARA_PROOF_DIRTY: dirty ? '1' : '0',
    OCCLARA_PROOF_JSON_ONLY: jsonOnly ? '1' : '0',
    // The site shows what a player has today: public profiles and Players are
    // off until the owner's switch is set (docs/claude/social.md), so the proof
    // boots with the feature not live. Set OCCLARA_PROOF_SOCIAL=on once it is.
    OCCLARA_PROOF_SOCIAL: process.env.OCCLARA_PROOF_SOCIAL === 'on' ? 'on' : 'off',
    // Occlara Duos (docs/claude/duos.md) is off until the owner's switch too:
    // the site shows no trace of it. OCCLARA_PROOF_DUOS=on once it is live.
    OCCLARA_PROOF_DUOS: process.env.OCCLARA_PROOF_DUOS === 'on' ? 'on' : 'off' });
  delete env.ELECTRON_RUN_AS_NODE;
  const r = spawnSync(electron, [__filename], { env, timeout: 240000 });
  let rec = null;
  try { rec = JSON.parse(fs.readFileSync(RESULT, 'utf8')); } catch { /* reported below */ }
  if (!rec) { console.error(`FAIL: the exporter wrote no result (exit ${r.status}${r.error ? ', ' + r.error.message : ''})`); process.exit(1); }
  for (const l of rec.lines) console.log('  ' + l);
  if (!rec.ok) { console.error('FAIL: ' + rec.detail); process.exit(1); }

  // THE JSON, held to its rules before it is written: no dash, no '#' (the
  // mark of a Riot ID), none of the seeded account's strings.
  const text = JSON.stringify(rec.proof, null, 2) + '\n';
  const proofFixture = require('./fixtures/proof-reviews');
  const banned = [['a dash', DASHES], ['a Riot ID mark (#)', /#/], ['an email', /@/],
    ['the seeded account key', new RegExp(proofFixture.SEEDED_STATE.account_key)], ['a review id', /valorant-\d{10,}/]];
  for (const [what, re] of banned) {
    if (re.test(text)) { console.error(`FAIL: proof.generated.json holds ${what}`); process.exit(1); }
  }
  fs.writeFileSync(path.join(out, 'proof.generated.json'), text);

  // THE MARK: the crescent's path from the source SVG, the ground and the ink
  // from theme.css, the signal as DESIGN.md names it.
  const svg = fs.readFileSync(path.join(REPO, 'assets', 'logo-mark.svg'), 'utf8');
  const theme = fs.readFileSync(path.join(REPO, 'src', 'renderer', 'shared', 'theme.css'), 'utf8');
  const attr = (s, name) => { const m = new RegExp(`\\s${name}="([^"]*)"`).exec(s); return m ? m[1] : null; };
  const token = (name) => { const m = new RegExp(`${name}:\\s*(#[0-9A-Fa-f]{6})`).exec(theme); return m ? m[1].toUpperCase() : null; };
  const mark = { label: proofFixture.SAMPLE_LABEL, name: 'Occlara', viewBox: attr(svg, 'viewBox'), path: attr(svg, 'd'),
    color: attr(svg, 'color'), ground: token('--bg'), ink: token('--text'), signal: token('--signal') || token('--red'), commit };
  if (!mark.path || !mark.viewBox || !mark.ground || !mark.ink || !mark.signal) { console.error('FAIL: the mark could not be read: ' + JSON.stringify(mark)); process.exit(1); }
  fs.writeFileSync(path.join(out, 'mark.json'), JSON.stringify(mark, null, 2) + '\n');

  const files = [['proof.generated.json', 'the display strings'], ['mark.json', 'the crescent and the tokens']];
  if (!jsonOnly) {
    // THE PICTURES, PNG to WebP through ffmpeg. Lossy at a quality where UI
    // text stays crisp on the dark ground; the set must fit under 3 MB.
    const convert = (name, quality) => {
      const src = path.join(WORK, `${name}.png`);
      const dst = path.join(out, `${name}.webp`);
      const c = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', src, '-c:v', 'libwebp', '-quality', String(quality), '-compression_level', '6', dst], { encoding: 'utf8' });
      if (c.status !== 0) { console.error(`FAIL: ffmpeg could not write ${name}.webp: ${c.stderr || c.error}`); process.exit(1); }
      return fs.statSync(dst).size;
    };
    const names = rec.shots.map((s) => s.name);
    let quality = 82;
    let total = 0;
    for (;;) {
      total = 0;
      for (const n of names) total += convert(n, quality);
      if (total <= MAX_BYTES || quality <= 50) break;
      quality -= 8;
    }
    if (total > MAX_BYTES) { console.error(`FAIL: the pictures weigh ${total} bytes, over ${MAX_BYTES}`); process.exit(1); }
    for (const s of rec.shots) files.push([`${s.name}.webp`, `${s.what} (${s.width}x${s.height}, ink ${(s.ink * 100).toFixed(1)}%)`]);
    console.log(`  pictures: ${names.length} at quality ${quality}, ${total} bytes`);
  }
  console.log(`PASS: site proof written to ${out}`);
  for (const [f, what] of files) {
    const size = fs.statSync(path.join(out, f)).size;
    console.log(`  ${f.padEnd(24)} ${String(size).padStart(9)} B  ${what}`);
  }
  process.exit(0);
}

// ── The Electron side: the real window on the sample library ────────────────
const { app } = require('electron');
const proof = require('./fixtures/proof-reviews');
const surfaces = require('./fixtures/surfaces');
const { composite, wait } = require('./fixtures/window-shot');

const JSON_ONLY = process.env.OCCLARA_PROOF_JSON_ONLY === '1';
const lines = [];
const shots = [];
let reported = false;
function finish(ok, detail, proofJson) {
  if (reported) return;
  reported = true;
  try { fs.writeFileSync(RESULT, JSON.stringify({ ok, detail, lines, shots, proof: proofJson || null })); }
  catch { /* exit code still carries it */ }
  app.exit(ok ? 0 : 1);
}

proof.installStandIns();
const ud = path.join(os.tmpdir(), 'occlara-site-proof-userdata');
// A fixed clock, so every run prints the same library; no date reaches the JSON.
const NOW = Date.UTC(2026, 9, 24, 19, 30);
const seeded = proof.seed(ud, { now: NOW });
process.env.OCCLARA_DEV_USERDATA = ud;

if (!JSON_ONLY) app.commandLine.appendSwitch('force-device-scale-factor', String(WIN.scale));
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
app.on('window-all-closed', () => { /* finish() decides when we exit */ });

async function until(fn, ms) {
  const end = Date.now() + ms;
  for (;;) {
    let v = null;
    try { v = await fn(); } catch { v = null; }
    if (v) return v;
    if (Date.now() > end) return null;
    await wait(150);
  }
}

/*
 * THE READERS, run inside each page: every string is the page's own
 * textContent, whitespace collapsed. A date, an id and the seeded account's
 * lines are left out on purpose, so the JSON is the same on every machine.
 */
const READ_HELPERS = `
  const T = (el) => (el ? String(el.textContent || '').replace(/\\s+/g, ' ').trim() : '');
  const Q = (sel, root) => (root || document).querySelector(sel);
  const QA = (sel, root) => [...(root || document).querySelectorAll(sel)];
  const shown = (el) => !!el && !el.hidden && getComputedStyle(el).display !== 'none';
  const txt = (sel, root) => T(Q(sel, root));
  const list = (sel, root) => QA(sel, root).map(T).filter(Boolean);
  // The middle of an element, in the CSS pixels of its own document.
  const centre = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };
  // And only of what shows: a hidden element has no place on a picture.
  const placeOf = (el) => (el && shown(el) && el.getClientRects().length ? centre(el) : null);
  const noDate = (s) => s.split(/\\s+\\u00b7\\s+/).slice(1).join(' \\u00b7 ');
`;
/*
 * HOME, ORBIT (27 Nov 2026): the hero is the fix for the next match, split
 * at its colon into a headline and a grey sub line (home.js splitFix), with
 * Start and Open last review; then the bento of the last match (its eyebrow,
 * a title that is a fact, the grade with its change on the match before, the
 * K/D, and one ruled row of the result and the score, who and the queue, the
 * eye and Open review), the trend card (the grade line and its average) and
 * what repeats (the mistakes, each with how many matches and how many
 * times); then the moment the coach looked at, the rank, the recent matches.
 * The old keys stay where the page still says them: `fix` is the hero's
 * headline and `fixSub` its sub line, the meta is the agent, the map and the
 * queue with one separator each (the ruled row's own "Jett on Abyss,
 * Standard", its time left off), the grade's label and line are the two
 * halves of its own title ("Match grade, out of 100, ..."), the change is the
 * card's own words ("+7 on your last match"), and the milestone is the newest
 * row's marks ("Best in 4"). The categories are not on Home and stay empty.
 * The player's Riot ID chip is never read: only whether it shows, and the
 * Connect link's words when it is the link that shows.
 */
const READ_HOME = `(() => { ${READ_HELPERS}
  const last = Q('#last');
  const g = Q('.last-grade', last);
  const gTitle = g ? String(g.title || '').trim() : '';
  // 'Grade. How well you played...' since 9.1 (its name, then its tooltip); ', ' before it.
  const cut = gTitle.indexOf('. ') > 0 ? gTitle.indexOf('. ') : gTitle.indexOf(', ');
  const cap = (s) => s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
  // The ruled row says "Jett on Abyss, Standard, Oct 24, 7:30 PM": who and
  // the queue are the parts before the first with a digit, which is its time.
  const parts = txt('.lm-meta > span', last).split(/,\\s*/);
  const timeAt = parts.findIndex((s) => /\\d/.test(s));
  const said = timeAt < 0 ? parts : parts.slice(0, timeAt);
  const who = String(said[0] || '');
  const on = who.indexOf(' on ');
  const agent = on > 0 ? who.slice(0, on) : who;
  const map = on > 0 ? who.slice(on + 4) : '';
  const queue = said.slice(1).filter(Boolean);
  const kd = Q('.last-kd', last);
  const newest = Q('#recent-list .r-row');
  const delta = Q('.last-grade .delta', last);
  const trend = Q('#trend');
  return {
    fix: txt('#h-fix-head'),
    fixSub: txt('#h-fix-sub'),
    fixLabel: txt('#h-kicker'),
    start: { word: txt('#start-strip .ss-word'), line: txt('#start-strip .ss-line'), button: txt('#h-start'),
      open: shown(Q('#h-open')) ? txt('#h-open') : '' },
    player: { idShown: shown(Q('#h-player')), connect: shown(Q('#h-player-connect')) ? txt('#h-player-connect') : '' },
    // The moment behind the fix: the first death the coach looked at.
    moment: shown(Q('#focus')) ? { label: txt('#focus .label'), text: txt('#focus-text') } : null,
    last: {
      label: txt('.last-head .o-eyebrow', last),
      title: txt('.last-title', last),
      result: txt('.lm-meta .result', last), score: txt('.lm-meta .score', last),
      agent, map, queue: queue.join(' \\u00b7 '),
      meta: [agent, map, ...queue].filter(Boolean).join(' \\u00b7 '),
      milestone: newest ? list('.r-mark', newest) : [],
      change: delta ? T(delta) : '',
      changeLabel: delta ? String(delta.title || '') : '',
      grade: { score: txt('.gv-score', last),
        label: cut > 0 ? gTitle.slice(0, cut) : gTitle, sub: cut > 0 ? cap(gTitle.slice(cut + 2)) : '' },
      kd: kd ? { label: txt('.kd-label', kd), ratio: txt('.kd-ratio', kd), split: txt('.kd-split', kd) } : null,
      categories: [],
      // The average is the trend card's now, beside the line it is of.
      average: txt('#trend .line-avg'),
      buttons: list('.last-foot button', last),
    },
    // The top of what repeats; its trend and fix are the Patterns page's own
    // for the same mistake, filled in once that page is read.
    top: shown(Q('#top')) ? { title: txt('#top-list .top-title'), count: txt('#top-list .top-n'),
      detail: txt('#top-list .top-sub'), trend: '', fix: '' } : null,
    mistakesHeading: txt('#top .o-eyebrow'),
    mistakesTitle: txt('#top .o-title'),
    mistakes: QA('#top-list .top-row').map((r) => ({ title: txt('.top-title', r), sub: txt('.top-sub', r), count: txt('.top-n', r) })),
    // The trend card: its eyebrow, its title (the fact the line shows), the
    // average and the grades as the line labels them.
    // 9.1: the line is the shared trend chart, which labels the newest alone;
    // the grades it draws, oldest first, are on its host (home.js paintTrend).
    trend: trend && shown(trend) && Q('svg.tc-svg', trend) ? { label: txt('.o-eyebrow', trend), title: txt('.o-title', trend),
      average: txt('.line-avg', trend), grades: (Q('.trend-chart', trend) ? Q('.trend-chart', trend).dataset.grades || '' : '').split(',').filter(Boolean) } : null,
    recentHeading: txt('#recent .card-head .label'),
    recent: QA('#recent-list .r-row').map((r) => ({ title: T(Q('.r-title', r).firstChild), result: txt('.r-res', r), marks: list('.r-mark', r),
      meta: noDate(txt('.r-meta', r)), grade: txt('.r-score', r) })),
  };
})()`;
/*
 * THE SHELL, ORBIT (27 Nov 2026): the top bar's four links (shell-nav.js
 * TOP: Home, Matches, Practice, Clips) and Start. The account menu (8.9.1)
 * is a view of its own over the page, drawing the shell's rows: its rows and
 * its games line are read from that view while it is open (READ_MENU), never
 * the account row itself.
 */
const READ_SHELL = `(() => { ${READ_HELPERS}
  return { pages: list('#nav .nav-item'), start: txt('#toggle .t-label'), brand: txt('.bar .brand .name'),
    menu: (Q('#menu-btn') && Q('#menu-btn').getAttribute('aria-label')) || '' };
})()`;
const READ_MENU = `(() => { ${READ_HELPERS}
  const m = Q('#menu');
  if (!m || m.hidden) return null;
  return { foot: QA('.foot > button', m).filter((b) => !b.hidden).map(T).filter(Boolean), games: txt('#rail-games', m) };
})()`;
const READ_SEALED = `(() => { ${READ_HELPERS}
  // Progress v3: in a Valorant match the screen is the live status, here
  // before the match is under way (the stand-in reader has no round), so its
  // facts are what it says while it waits and the line that the review opens
  // when the match ends. The four facts are the switches under "Shown while
  // recording" (map, agent, score, round); the time it started is never read.
  // ORBIT'S RECORDING SCREEN has no tape note: the tape and its round label
  // ("Round") show only once a round is under way, so while it waits the
  // tape is said not shown. The mode chip is the queue, empty until then.
  const tape = Q('#live-tape-block');
  return { title: txt('.live-word'), sub: txt('.live-wait p'),
    facts: [{ label: txt('.live-review-title'), text: txt('.live-review-sub') }],
    mode: txt('#live-mode'), shownLabel: txt('.live-choose .live-note'), shown: list('#live-chips button'),
    stop: txt('#live-stop'),
    tape: { shown: shown(tape), roundLabel: txt('#live-round-block .live-label') },
    quiet: { title: txt('#sealed-title'), sub: txt('#sealed-sub'),
      facts: QA('#sealed-facts li').map((li) => ({ label: txt('b', li), text: txt('span', li) })) } };
})()`;
/*
 * MATCHES, PROGRESS V3 (8.9): every row is "Jett on Abyss" with its result,
 * its marks, the queue and whether Riot's record checked it, its top mistake,
 * its grade and its change since the match before; beside the rows, the
 * chart card of the grade over the last matches. ORBIT: the page's title and
 * its grey sub line, and the sub switch of the pages the Matches link holds
 * (Matches, Patterns, Stats), the current one pressed.
 */
const READ_MATCHES = `(() => { ${READ_HELPERS}
  return { title: txt('.sheet > header .h-brand h2'), sub: txt('.sheet > header .page-sub'),
    subnav: QA('.subnav button').map((b) => ({ page: T(b), current: b.getAttribute('aria-pressed') === 'true' })),
    heading: txt('#every .l-head h3'),
    rows: QA('#list .m-item').map((m) => ({ title: txt('.m-title', m), result: txt('.m-res', m), marks: list('.m-mark', m),
      meta: txt('.m-meta', m), topMistake: txt('.m-top-mistake', m).replace(/^Top mistake:\\s*/, ''),
      grade: txt('.m-score', m), change: txt('.m-delta', m) })),
    // 9.1: the trend across the top (its eyebrow, its title, the latest with
    // its change, the average and the best) and when the player plays best.
    chart: shown(Q('#m-chart')) ? { label: txt('#m-chart .m-chart-label'), title: txt('#m-chart-title'), now: txt('#m-chart-big'),
      since: txt('#m-chart-since'), average: txt('#m-chart-avg') ? 'Average ' + txt('#m-chart-avg') : '', best: txt('#m-chart-best') } : null,
    when: shown(Q('#when')) ? { title: txt('#when-title'), note: txt('#when-note'),
      best: shown(Q('#when-calls')) ? { label: txt('#when-best'), line: txt('#when-best-line') } : null,
      worst: shown(Q('#when-calls')) ? { label: txt('#when-worst'), line: txt('#when-worst-line') } : null } : null };
})()`;
/*
 * PATTERNS, PROGRESS V3 (8.9): the chart of the grades with its bands by
 * number ("70", one score and no letters since 9.1), its average line and its key; the four category averages, each
 * against the latest match; then the ranked lists, the top mistake a card
 * whose fix is its action line, every entry with its chips (how many of the
 * recorded matches, how many times, the trend word). The dates under the
 * bars are left out: only "Latest" is read.
 */
const READ_PATTERNS = `(() => { ${READ_HELPERS}
  const item = (li) => ({ title: txt('.gv-item-title', li), hero: li.classList.contains('gv-hero'), count: txt('.gv-count', li),
    chips: list('.p-chips .gv-chip', li), detail: txt('.gv-item-detail', li),
    fix: (txt('.gv-item-fix', li) || txt('.gv-action', li)).replace(/^(?:\\u2192\\s*)?Fix\\s*/, ''), rounds: list('.gv-rchip', li) });
  return { heading: txt('#patterns .p-head h3'), sub: txt('#p-sub'), average: shown(Q('#p-avg')) ? txt('#p-avg-num') : '',
    averageLabel: shown(Q('#p-avg')) ? txt('#p-avg .p-avg-label') : '',
    grades: QA('#p-trend .p-bar').map((b) => txt(':scope > span', b)),
    chart: shown(Q('#p-trend')) ? { caption: txt('#p-trend .p-trend-cap'), bands: list('#p-trend .p-guide span'), average: txt('#p-trend .p-avgline span'),
      latest: list('#p-trend .p-bar small').filter((s) => s === 'Latest'), key: list('#p-trend .p-key-item > span') } : null,
    categoriesCaption: txt('#p-cats .p-cats-cap'),
    categories: QA('#p-cats .p-cat').map((c) => ({ average: txt('b', c), label: txt('span', c), last: txt('small', c), versus: txt('em', c) })),
    lists: QA('#p-lists .gv-block').map((b) => ({ heading: txt('h3', b), items: QA('.gv-item', b).map(item) })) };
})()`;
/*
 * CLIPS, ORBIT (28 Nov 2026), the page whose id stays "moments": the title
 * and its sub line; the hero, the newest match's best moments, the first
 * large, each its clip's poster or the map's art with "No clip kept"; the
 * compilation as chips, each a repeated mistake and its line, with Play all
 * where a clip was kept (a chip without one shows no action, so none is
 * read); then every moment under its match, as frames.
 */
const READ_MOMENTS = `(() => { ${READ_HELPERS}
  const action = (r) => Q('button.btn', r) || Q('.mo-cnone', r);
  return {
    title: txt('.sheet > header .h-brand h2'), sub: txt('.sheet > header .page-sub'),
    hero: QA('#mo-hero .mo-hcard').map((c) => ({ big: c.classList.contains('big'), round: txt('.mo-hround', c), title: txt('.mo-htitle', c),
      time: txt('.mo-htime', c), clip: !!Q('.mo-frame-play', c), tag: txt('.mo-frame-tag', c), poster: !!Q('.mo-frame:not(.art) .mo-frame-img', c) })),
    reel: shown(Q('#mo-reel')) ? { heading: txt('#mo-reel-title'), rows: QA('#mo-reel-rows .mo-crow').map((r) => ({ title: txt('.mo-ctitle', r), line: txt('.mo-cline', r),
      action: shown(action(r)) ? T(action(r)) : '' })) } : null,
    compilation: { heading: txt('#mo-comp-title'), rows: QA('#mo-comp-rows .mo-crow').map((r) => ({ title: txt('.mo-ctitle', r), line: txt('.mo-cline', r),
      action: shown(action(r)) ? T(action(r)) : '' })) },
    heading: txt('#mo-log-title'), counts: txt('#mo-counts'), filter: list('#mo-filter button'), note: shown(Q('#mo-note')) ? txt('#mo-note') : '',
    matches: QA('#mo-list .mo-match').map((m) => ({ result: txt('.mo-res', m), who: txt('.mo-who', m), grade: txt('.mo-score', m),
      moments: QA('.mo-row', m).map((x) => ({ round: txt('.mo-round', x), kind: txt('.mo-kind', x), title: txt('.mo-mtitle', x), line: txt('.mo-mline', x),
        marks: QA('.mo-mark', x).map((k) => ({ text: T(k), across: k.classList.contains('across') })), time: txt('.mo-time', x),
        // Play where a clip was kept, else the tag on its frame: why there is none.
        clip: Q('.mo-play', x) ? 'Play' : txt('.mo-clip .mo-frame-tag', x) || '' })) })),
  };
})()`;
const READ_REVIEW = `(() => { ${READ_HELPERS}
  // The top mistake's fix is its action line (an arrow, the label, the sentence); every other item's is its fix line.
  const item = (li) => ({ title: txt('.gv-item-title', li), hero: li.classList.contains('gv-hero'), count: txt('.gv-count', li), badge: txt('.gv-badge', li),
    detail: txt('.gv-item-detail', li), fix: (txt('.gv-item-fix', li) || txt('.gv-action', li)).replace(/^(?:\\u2192\\s*)?Fix\\s*/, ''), rounds: list('.gv-rchip', li) });
  const round = (r) => ({ n: txt('.v-rn', r), result: txt('.v-chip', r), side: txt('.v-side', r), tags: list('.v-tag', r),
    look: Q('.v-look-tag', r) ? { cause: txt('.v-cause', r), what: txt('.v-look-what', r), better: txt('.v-look-better', r).replace(/^Better\\s*/, '') } : null,
    read: txt('.v-why', r), folded: r.classList.contains('fold') && !r.classList.contains('open') });
  // THE VERDICT SINCE 8.8 has no VERDICT word and no reason line: the page's
  // own heading ("Match review") is its label, and the standout's line, which
  // stands where the reason was, its reason. ORBIT's hero: the number with
  // its name "Grade" (no letter since 9.1) and "out of 100", the result in sentence case ("Victory"),
  // the medals for real things, the fix in two tones (its head to the colon
  // and the rest), then Ask about this match and Every round.
  const visible = (sel) => QA(sel).filter((b) => shown(b) && !b.closest('[hidden]')).map(T).filter(Boolean);
  return {
    verdict: { label: txt('header .h-brand h2'), reason: txt('#v-stat .vd-stat-label'),
      icon: shown(Q('#v-icon')) && !!Q('#v-icon .vd-icon-img'), name: txt('#v-grade .vd-name'), score: txt('#v-grade .vd-score'), out: txt('#v-grade .vd-out'),
      provisional: !!Q('#v-grade .vd-prov'), stat: { value: txt('#v-stat .vd-stat-value'), label: txt('#v-stat .vd-stat-label') },
      result: txt('#v-result'), scoreline: txt('#v-score'), meta: txt('#v-meta'),
      stats: QA('#v-stats .v-stat').map((s) => ({ value: txt('.v-stat-value', s), label: txt('.v-stat-label', s), versus: txt('.v-stat-vs', s) })),
      verified: shown(Q('#v-verified')) ? txt('#v-verified') : '',
      medals: shown(Q('#v-medals')) ? list('#v-medals .medal-text') : [] },
    fix: { heading: txt('#v-focus-wrap > .v-focus-label'), text: txt('#v-focus'), head: txt('#v-focus .vf-head'), sub: txt('#v-focus .vf-sub'),
      was: shown(Q('#v-focus-was')) ? txt('#v-focus-was') : '',
      wasHeading: shown(Q('#v-focus-was-wrap')) ? txt('#v-focus-was-wrap .v-focus-label') : '' },
    actions: visible('#v-verdict .vd-actions button'),
    progress: QA('#v-prog .gv-prog').map((p) => ({ text: T(p), tone: [...p.classList].find((c) => ['good', 'bad', 'warn', 'even'].includes(c)) || 'even' })),
    read: { heading: txt('#v-summary-wrap h3, #v-summary-wrap .label'), lines: list('#v-summary li:not(.v-chain-main)'), repeat: txt('#v-summary li.v-chain-main') },
    grade: { categories: QA('#grade-host .gv-cat').map((c) => ({ name: txt('.gv-cat-name', c), score: txt('.gv-cat-score', c), evidence: list('.gv-chip', c) })) },
    lists: QA('#insights-host .gv-block').map((b) => ({ heading: txt('h3', b), items: QA('.gv-item', b).map(item) })),
    comps: txt('#v-comps'), patterns: list('#v-patterns li'),
    rounds: { heading: txt('#v-rounds-wrap h3, #v-rounds-wrap .label'), halves: list('#v-rounds .v-half-side'), rows: QA('#v-rounds .v-round').map(round) },
    study: list('#v-study li'), refused: list('#v-refused li'),
    buttons: visible('header button').filter((b) => b !== 'Close'),
  };
})()`;
const READ_INVITE = `(() => { ${READ_HELPERS}
  return { label: txt('#inv-link-label'), progress: txt('#inv-progress'), how: list('#inv-how li'), copy: txt('#inv-copy') };
})()`;

setTimeout(async () => {
  const mainWindow = require(path.join(REPO, 'src/main/windows/main-window'));
  try {
    const win = mainWindow.create();
    win.show();
    win.setPosition(0, 0);
    // NO HOVER IN A PICTURE: the real mouse never reaches the window (every
    // step here clicks through the page's own scripts), so wherever the
    // cursor rests on the desktop, no row picks up its hover tint.
    win.setIgnoreMouseEvents(true);
    // NOTHING FROZEN IN A PICTURE: a window behind another still reads
    // visible but gets no animation frames, so a count up stops on 0.00 and
    // two captures agree on it. On top, nothing on the desktop covers it.
    win.setAlwaysOnTop(true, 'screen-saver');
    win.moveTop();
    // A frameless window at a scale of 2 comes out a few DIPs over what was
    // asked (Windows' invisible resize border): asked again, less the delta.
    win.setContentSize(WIN.width, WIN.height);
    for (let i = 0; i < 4; i++) {
      const got = win.getContentSize();
      if (got[0] === WIN.width && got[1] === WIN.height) break;
      win.setContentSize(WIN.width - (got[0] - WIN.width), WIN.height - (got[1] - WIN.height));
    }
    await until(() => surfaces.find('/shell/'), 6000);
    const shell = surfaces.find('/shell/');
    if (!shell) return finish(false, 'the shell never loaded');
    const sjs = (s) => shell.webContents.executeJavaScript(s);
    const errs = [];
    const watch = (wc, label) => wc.on('console-message', (e, lvl, msg) => {
      const level = typeof lvl === 'number' ? lvl : ({ warning: 2, error: 3 })[e && e.level];
      if (level >= 3) errs.push(`${label}: ${msg !== undefined ? msg : e && e.message}`);
    });
    watch(shell.webContents, 'shell');
    await until(() => sjs("document.querySelectorAll('#nav .nav-item').length > 0"), 4000);
    const size = win.getContentSize();
    lines.push(`window ${size[0]}x${size[1]} at scale ${JSON_ONLY ? 'the display\'s' : WIN.scale}`);
    if (size[0] !== WIN.width || size[1] !== WIN.height) return finish(false, `the window is ${size.join('x')}, not ${WIN.width}x${WIN.height}`);

    const settled = (page) => () => { const m = mainWindow.motionState(); return m.onScreen === page && !m.coming && !m.staged; };
    const pjs = (id) => (s) => mainWindow.pageViews().get(id).webContents.executeJavaScript(s);
    const show = async (page) => {
      mainWindow.show(page);
      if (!await until(settled(page), 6000)) throw new Error(`the ${page} page never came in`);
      await wait(400);
      return pjs(page);
    };
    /** One picture: settled, not blank, at the window's size times the scale. */
    const shot = async (name, what) => {
      if (JSON_ONLY) return;
      await wait(600);
      // And a hover the cursor left before the window went click-through, or
      // one a page set itself, is cleared: every surface on screen is told
      // the mouse left it, then asked that nothing matches :hover.
      const views = [shell, ...mainWindow.pageViews().values()];
      const m = typeof mainWindow.menuState === 'function' ? mainWindow.menuState() : null;
      if (m && m.open && m.view) views.push(m.view);
      const t = typeof mainWindow.toastState === 'function' ? mainWindow.toastState() : null;
      if (t && t.shown && t.view) views.push(t.view);
      // NOTHING DRIFTING IN A PICTURE (Orbit): the agent's float and the
      // twinkling stars loop for ever (motion.css m-drift, home.css
      // sky-twinkle), so two captures a beat apart would never agree. Every
      // surface holds its ambient motion where it stands (motion.js
      // Motion.ambient(false), html.ambient-off), as it does mid match.
      for (const v of views) {
        if (v.webContents.isDestroyed()) continue;
        await v.webContents.executeJavaScript("(() => { if (window.Motion && typeof window.Motion.ambient === 'function') window.Motion.ambient(false); return true; })()").catch(() => null);
        // A count up runs on frames, and this hidden window gives too few to
        // finish one: the picture held a K/D of 0.23 where the match had 1.48.
        // Every counter carries its final text in data-value from the start
        // (motion.js countUp), so the picture shows that.
        await v.webContents.executeJavaScript("(() => { for (const e of document.querySelectorAll('.m-count[data-value]')) e.textContent = e.dataset.value; return true; })()").catch(() => null);
      }
      for (const v of views) {
        if (v.webContents.isDestroyed()) continue;
        v.webContents.sendInputEvent({ type: 'mouseMove', x: -1000, y: -1000 });
        v.webContents.sendInputEvent({ type: 'mouseLeave', x: -1000, y: -1000 });
      }
      await wait(300);
      for (const v of views) {
        if (v.webContents.isDestroyed()) continue;
        const hovered = await v.webContents.executeJavaScript("document.querySelectorAll(':hover').length");
        if (hovered) throw new Error(`${name}: ${hovered} elements still hovered on ${v.webContents.getURL().split('/').slice(-2).join('/')}`);
      }
      const pic = await composite(mainWindow, win, { verify: true });
      if (!pic) throw new Error(`${name}: the window could not be captured`);
      const want = [WIN.width * WIN.scale, WIN.height * WIN.scale];
      lines.push(`shot ${name}: ${pic.width}x${pic.height} ink ${(pic.ink * 100).toFixed(1)}% settled=${pic.settled}`);
      if (!pic.settled) throw new Error(`${name}: the picture never settled, something is still moving`);
      if (pic.blank) throw new Error(`${name}: the picture is blank`);
      if (pic.width !== want[0] || pic.height !== want[1]) throw new Error(`${name}: the picture is ${pic.width}x${pic.height}, not ${want.join('x')}`);
      fs.writeFileSync(path.join(WORK, `${name}.png`), pic.png);
      shots.push({ name, what, width: pic.width, height: pic.height, ink: pic.ink });
    };
    const out = { label: proof.SAMPLE_LABEL,
      note: 'Every string here was read off the real pages of the app, booted on the sample library in scripts/fixtures/proof-reviews.js: a Jett on Abyss, 13 to 11, built from a real match and its Riot record. Nothing is written by hand. No player name, no Riot ID, no date.',
      commit: process.env.OCCLARA_PROOF_COMMIT || '', dirty: process.env.OCCLARA_PROOF_DIRTY === '1',
      version: require(path.join(REPO, 'package.json')).version,
      // The bar's height in the window's own pixels (main-window.js TOP_H):
      // a page sits under it, so the site lays a page it draws there too.
      window: { ...WIN, bar: mainWindow.TOP_H } };

    /*
     * WHERE THINGS SIT ON THE PICTURES, for the site's pointer: the middle of
     * each link in the top bar, of the sub switch and the rows on Matches, of
     * each chip of the compilation and its Play all and of the hero and the
     * filter on Clips, and of the review's actions, its grade and its fix, as
     * fractions of the window (the pictures are the window at twice the
     * size), read off the laid out pages once a picture is taken and never
     * measured by hand. A place off its picture, or of a thing that does not
     * show, is null.
     */
    const places = {};
    const frac = (n) => Math.round(n * 10000) / 10000;
    const inWindow = (p, onPage) => (p ? { x: frac((p.x + (onPage ? mainWindow.SIDEBAR_W : 0)) / WIN.width),
      y: frac((p.y + (onPage ? mainWindow.TOP_H : 0)) / WIN.height) } : null);
    const onPicture = (p) => (p && p.x > 0 && p.x < 1 && p.y > 0 && p.y < 1 ? p : null);
    const onPage = (p) => onPicture(inWindow(p, true));
    /** A page's places, read until two reads a beat apart agree: nothing moving under them, in either mode. */
    const steady = async (js, script) => {
      let a = await js(script);
      for (let i = 0; i < 12; i++) {
        await wait(250);
        const b = await js(script);
        if (JSON.stringify(a) === JSON.stringify(b)) return b;
        a = b;
      }
      return a;
    };

    // 1. The shell and Home, the page the window opens on.
    const home = await until(() => surfaces.find('/home/'), 6000);
    if (!home) return finish(false, 'Home never loaded');
    watch(home.webContents, 'home');
    const hjs = (s) => home.webContents.executeJavaScript(s);
    if (!await until(() => hjs("!document.getElementById('content').hidden"), 6000)) return finish(false, 'Home never painted');
    if (!await until(settled('home'), 6000)) return finish(false, 'Home never came in');
    await until(() => hjs("document.querySelectorAll('.home .card.card-in').length >= 3 && !document.documentElement.classList.contains('page-armed')"), 4000);
    await until(() => sjs("(() => { const g = document.getElementById('rail-games'); return g && !g.hidden && g.textContent; })()"), 3000);
    out.shell = await sjs(READ_SHELL);
    // The K/D counts up to its two places as the card arrives (Motion.countUp):
    // read once it has landed, the same text a beat apart.
    // Landed means its text is the final one countUp keeps in data-value, not
    // only the same twice: a frozen count reads the same twice too.
    const ratioLanded = "(() => { const n = document.querySelector('#last .kd-ratio'); return !!n && !!n.textContent && n.textContent === (n.dataset.value || n.textContent); })()";
    if (!await until(() => hjs(ratioLanded), 4000)) return finish(false, 'the K/D never landed on its value, the window is likely covered and gets no frames');
    out.home = await hjs(READ_HOME);
    lines.push(`home: fix "${out.home.fix.slice(0, 40)}" grade ${out.home.last.grade.score} recent ${out.home.recent.length}`);
    if (!out.home.fix || out.home.last.grade.score !== String(seeded.built.grade.score) || out.home.recent.length !== seeded.SEEDED) {
      return finish(false, `Home does not show the sample library: ${JSON.stringify(out.home.last)}`);
    }
    if (out.home.player.idShown) return finish(false, 'Home shows a Riot ID chip, and the sample library has none');
    await shot('home', 'Home: the top bar with its four links, the fix for next match as the hero with Start and Open last review, the agent before the moon, the last match with its grade, change and K/D, the trend and what repeats');
    // The four links of the top bar, where they sit on every picture.
    const tabs = await steady(sjs, `(() => { ${READ_HELPERS} return QA('#nav .nav-item').map((b) => ({ page: T(b), at: placeOf(b) })); })()`);
    places.tabs = Object.fromEntries(tabs.map((t) => [t.page, onPicture(inWindow(t.at, false))]));

    // 1b. The account menu, opened from the avatar as a player opens it: its
    // rows and the games line are read off the menu's own view, then it shuts.
    await sjs("document.getElementById('menu-btn').click(); true");
    const menuView = await until(() => { const m = mainWindow.menuState(); return m.open && m.view ? m.view : null; }, 4000);
    if (!menuView) return finish(false, 'the account menu never opened');
    const menu = await until(() => menuView.webContents.executeJavaScript(READ_MENU).then((x) => (x && x.foot.length && x.games ? x : null)), 4000);
    if (!menu) return finish(false, 'the account menu drew no rows');
    out.shell.foot = menu.foot;
    out.shell.games = menu.games;
    await sjs("document.getElementById('menu-btn').click(); true");
    if (!await until(() => !mainWindow.menuState().open, 3000)) return finish(false, 'the account menu never shut');
    lines.push(`menu: ${menu.foot.join(', ')} | ${menu.games}`);

    // 2. Matches, from its link in the top bar.
    await sjs("document.querySelector('#nav .nav-item[data-page=\"matches\"]').click(); true");
    if (!await until(settled('matches'), 6000)) return finish(false, 'Matches never came in');
    const mjs = pjs('matches');
    await until(() => mjs(`document.querySelectorAll('#list .m-item').length >= ${seeded.SEEDED}`), 6000);
    await wait(400);
    out.matches = await mjs(READ_MATCHES);
    lines.push(`matches: ${out.matches.rows.length} rows`);
    if (out.matches.rows.length !== seeded.SEEDED) return finish(false, `Matches lists ${out.matches.rows.length} rows`);
    await shot('matches', 'Matches: its title and sub line, the sub switch to Patterns and Stats, every saved match as a row with its result, top mistake, grade and change, beside the chart of the grade over the last matches');
    // The sub switch (Matches, Patterns, Stats) and the rows, where they sit on its picture.
    // 9.1: the grade trend leads the page and when you play follows it, so
    // the rows start under the first screen; a row off the picture is null.
    const mplaces = await steady(mjs, `(() => { ${READ_HELPERS}
      return { subnav: QA('.subnav button').map((b) => ({ page: T(b), at: placeOf(b) })),
        chart: placeOf(Q('#m-chart')), when: placeOf(Q('#when')),
        rows: QA('#list .m-item').map((m) => placeOf(Q('.m-title', m) || m)) };
    })()`);
    places.matches = { subnav: Object.fromEntries(mplaces.subnav.map((b) => [b.page, onPage(b.at)])),
      chart: onPage(mplaces.chart), when: onPage(mplaces.when), rows: mplaces.rows.map(onPage) };

    // 3. Patterns, for the JSON alone, reached as a player reaches it: by the
    // sub switch at the head of Matches (Orbit), not by a link of its own.
    const toPatterns = await mjs("(() => { const b = document.querySelector('.subnav button[data-page=\"patterns\"]'); if (!b) return false; b.click(); return true; })()");
    if (!toPatterns) return finish(false, 'Matches draws no sub switch to Patterns');
    if (!await until(settled('patterns'), 6000)) return finish(false, 'Patterns never came in from the sub switch');
    await wait(400);
    const pajs = pjs('patterns');
    await until(() => pajs("document.querySelectorAll('#p-lists .gv-item').length > 0"), 6000);
    await until(() => pajs("document.querySelectorAll('#p-trend .p-bar').length > 0"), 4000);
    await wait(800);   // the bars grown, the averages counted up
    out.patterns = await pajs(READ_PATTERNS);
    lines.push(`patterns: ${out.patterns.lists.map((l) => `${l.heading} ${l.items.length}`).join(', ')}`);
    if (!out.patterns.lists.length) return finish(false, 'Patterns lists nothing');
    // Home's old keys, from the page that says them now: the top mistake's
    // trend word and fix as Patterns says them. (The trend card on Home has
    // words of its own since Orbit, so its label is no longer borrowed.)
    const ptop = out.patterns.lists[0].items[0];
    if (out.home.top && ptop && ptop.title === out.home.top.title) {
      out.home.top.trend = (ptop.chips.find((c) => /^(?:steady|more often lately|less often lately)$/.test(c)) || '');
      out.home.top.fix = ptop.fix;
      out.home.top.chips = ptop.chips;
    }

    // 4. Clips (the page's id stays "moments"), from its link in the top bar.
    await sjs("document.querySelector('#nav .nav-item[data-page=\"moments\"]').click(); true");
    if (!await until(settled('moments'), 6000)) return finish(false, 'Clips never came in from its link');
    await wait(400);
    const mojs = pjs('moments');
    if (!await until(() => mojs("!document.getElementById('mo-log').hidden && document.querySelectorAll('#mo-list .mo-row').length > 0"), 8000)) {
      return finish(false, 'the Clips page never listed its moments');
    }
    await wait(800);   // the rows risen
    out.moments = await mojs(READ_MOMENTS);
    lines.push(`clips: ${out.moments.counts} | hero ${out.moments.hero.length} | ${out.moments.compilation.rows.length} compilation chips`);
    if (out.moments.matches.length !== seeded.SEEDED || !out.moments.compilation.rows.length) return finish(false, `Clips: ${JSON.stringify(out.moments.counts)}`);
    if (!out.moments.hero.length) return finish(false, 'the Clips page drew no hero');
    await shot('moments', 'Clips: its title and sub line, the hero of the newest match\'s best moments, the repeated mistakes as chips with Play all where a clip was kept, the filter, and every death and highlight as a frame under its match');
    // Where the compilation's chips and their Play all sit on the picture, as
    // the page lays them out, moved by where the page sits in the window
    // (under the top bar); a chip with no clip kept has no Play all, and so
    // no action place. And the hero's cards and the filter's buttons.
    const cplaces = await steady(mojs, `(() => {
      ${READ_HELPERS}
      return { rows: QA('#mo-comp-rows .mo-crow').map((r) => ({ title: txt('.mo-ctitle', r), row: placeOf(Q('.mo-ctitle', r)), action: placeOf(Q('button.btn', r)) })),
        hero: QA('#mo-hero .mo-hcard').map((c) => ({ round: txt('.mo-hround', c), title: txt('.mo-htitle', c), at: placeOf(c) })),
        filter: QA('#mo-filter button').map((b) => ({ kind: T(b), at: placeOf(b) })) };
    })()`);
    places.moments = cplaces.rows.map((c) => ({ title: c.title, row: onPage(c.row), action: onPage(c.action) }));
    places.clips = { hero: cplaces.hero.map((h) => ({ round: h.round, title: h.title, at: onPage(h.at) })),
      filter: Object.fromEntries(cplaces.filter.map((f) => [f.kind, onPage(f.at)])) };

    // 5. The review, opened from Home's first recent match, as a player opens it.
    await show('home');
    await hjs("document.querySelector('#recent-list .r-row').click(); true");
    if (!await until(settled('review'), 8000)) return finish(false, 'the review never came in');
    const review = await until(() => surfaces.find('/review/'), 5000);
    if (!review) return finish(false, 'the review page was not found');
    watch(review.webContents, 'review');
    const rjs = (s) => review.webContents.executeJavaScript(s);
    if (!await until(() => rjs("!document.getElementById('vreview').hidden"), 8000)) return finish(false, 'the review never painted');
    // The reveal through, the progress strip answered, every fold as served.
    await until(() => rjs("document.getElementById('vreview').classList.contains('reveal-done')"), 6000);
    await until(() => rjs("document.querySelectorAll('#v-prog .gv-prog').length > 0"), 4000);
    await wait(500);
    out.review = await rjs(READ_REVIEW);
    lines.push(`review: ${out.review.verdict.name} ${out.review.verdict.score} "${out.review.verdict.stat.value} ${out.review.verdict.stat.label}" cats ${out.review.grade.categories.length} rounds ${out.review.rounds.rows.length} progress ${out.review.progress.length}`);
    const v = out.review.verdict;
    if (v.name !== 'Grade' || v.score !== String(seeded.built.grade.score) || out.review.grade.categories.length !== 4
      || !out.review.rounds.rows.length || !out.review.fix.text || !out.review.read.lines.length) {
      return finish(false, `the review does not show the sample match whole: ${JSON.stringify({ v, cats: out.review.grade.categories.length })}`);
    }
    await rjs("document.querySelector('.body').scrollTo(0, 0); true");
    await shot('review-top', 'The review: the hero with the number, its name and its change on the last match, the result and the standout, the medals, the fix for next match in two tones, Ask about this match and Every round, and Riot\'s numbers');
    // The hero's actions, its grade and its fix, where they sit on that picture.
    const rplaces = await steady(rjs, `(() => { ${READ_HELPERS}
      return { ask: placeOf(Q('#ask')), every: placeOf(Q('#v-every')), grade: placeOf(Q('#v-grade .vd-score')), fix: placeOf(Q('#v-focus')) };
    })()`);
    places.review = Object.fromEntries(Object.entries(rplaces).map(([k, p]) => [k, onPage(p)]));
    await rjs("document.getElementById('v-rounds-wrap').scrollIntoView({ block: 'start' }); true");
    await shot('review-rounds', 'The review\'s rounds: the two halves headed by their side, every round a ruled row with its tags, the rounds with something to say opened');
    await rjs("document.querySelector('.body').scrollTo(0, 0); true");
    // THE SHARE IMAGE, drawn by the page's own verdict-card.js from the
    // Verdict it shows, as Save image draws it.
    if (!JSON_ONLY) {
      const card = await rjs(`(async () => {
        const v = window.occlara.verdictOf(current);
        const cv = await window.VerdictCard.render(v, { size: 'card' });
        return { data: cv.toDataURL('image/png'), width: cv.width, height: cv.height };
      })()`);
      if (!card || !card.data) return finish(false, 'the share image could not be drawn');
      fs.writeFileSync(path.join(WORK, 'verdict-card.png'), Buffer.from(String(card.data).split(',')[1], 'base64'));
      shots.push({ name: 'verdict-card', what: 'The Verdict\'s share image, as Save image writes it', width: card.width, height: card.height, ink: 1 });
      lines.push(`verdict card: ${card.width}x${card.height}`);
    }

    // 6. Settings and Invite.
    const setjs = await show('settings');
    await until(() => setjs("(() => { const n = document.getElementById('acct-email'); return n && !n.hidden && n.textContent; })()"), 6000);
    await setjs("document.querySelector('.body').scrollTop = 0; true");
    await shot('settings', 'Settings: its title and grey sub line, then each group with its heading, its line and its control');
    const ijs = await show('invite');
    await until(() => ijs("!document.getElementById('inv-body').hidden"), 6000);
    out.invite = await ijs(READ_INVITE);
    lines.push(`invite: "${out.invite.progress}"`);
    await shot('invite', 'Invite: the player\'s link, the progress line and how it works');

    // 7. The Recording screen: the window sealed, as it is mid match.
    mainWindow.setSealed(true);
    await wait(600);
    const sealedUp = await sjs("!document.getElementById('sealed').hidden");
    const anyShown = [...mainWindow.pageViews().values()].some((x) => x.getVisible());
    if (!sealedUp || anyShown) return finish(false, 'sealed, a page still shows or the Recording screen is down');
    out.sealed = await sjs(READ_SEALED);
    await shot('sealed', 'The Recording screen: the live status waiting for the match to begin, Stop, the line that the review opens when the match ends and what shows while recording, the links locked, as the window is mid match');
    mainWindow.setSealed(false);
    await wait(400);

    out.places = places;
    if (errs.length) return finish(false, 'renderer errors: ' + errs.join(' | '));
    const text = JSON.stringify(out);
    if (DASHES.test(text)) return finish(false, 'a dash reached the proof');
    if (/#/.test(text)) return finish(false, 'a # reached the proof');
    finish(true, 'ok', out);
  } catch (e) {
    finish(false, 'threw: ' + (e && e.stack || e));
  }
}, 6500);

require(path.join(REPO, 'src/main/index.js'));

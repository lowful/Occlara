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
    OCCLARA_PROOF_JSON_ONLY: jsonOnly ? '1' : '0' });
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
  const noDate = (s) => s.split(/\\s+\\u00b7\\s+/).slice(1).join(' \\u00b7 ');
`;
/*
 * HOME, PROGRESS V3 (8.9): the Start strip; the last match as an art led
 * card (the result chip and its score, the map chip, the agent and the
 * queue, the grade with its change since the match before, the K/D, the
 * grade line and its average, View match and Open review); the fix for the
 * next match; the repeated mistakes as a counted list; the recent matches.
 * The old keys stay, filled from what the new card says in their place: the
 * meta is the agent, the map and the queue with one separator each, the
 * grade's label and line are the two halves of its own title ("Match grade,
 * out of 100, ..."), and the milestone is the newest row's marks ("Best in
 * 4"). The categories are not on Home any more and stay empty. The player's
 * Riot ID chip is never read: only whether it shows, and the Connect link's
 * words when it is the link that shows.
 */
const READ_HOME = `(() => { ${READ_HELPERS}
  const last = Q('#last');
  const res = Q('.chip.result', last);
  const g = Q('.last-grade', last);
  const gTitle = g ? String(g.title || '').trim() : '';
  const cut = gTitle.indexOf(', ');
  const cap = (s) => s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
  const agent = txt('.who-name', last);
  const map = txt('.last-head .chip:not(.result):not(.quiet)', last);
  // The who line is "Your last agent \\u00b7 Standard": the queue alone.
  const queue = txt('.who-sub', last).split(/\\s*\\u00b7\\s*/).filter((s) => s && s !== 'Your last agent');
  const kd = Q('.last-kd', last);
  const newest = Q('#recent-list .r-row');
  const topN = Q('#top-list .top-n');
  return {
    fix: txt('#focus-text'),
    fixLabel: txt('#focus .label'),
    start: { word: txt('#start-strip .ss-word'), line: txt('#start-strip .ss-line'), button: txt('#h-start') },
    player: { idShown: shown(Q('#h-player')), connect: shown(Q('#h-player-connect')) ? txt('#h-player-connect') : '' },
    last: {
      label: txt('.last-head .label', last).split(',')[0],
      result: res ? T(res.firstChild) : '', score: txt('.chip.result .score', last),
      agent, map, queue: queue.join(' \\u00b7 '),
      meta: [agent, map, ...queue].filter(Boolean).join(' \\u00b7 '),
      milestone: newest ? list('.r-mark', newest) : [],
      change: txt('.last-grade .delta', last),
      changeLabel: Q('.last-grade .delta', last) ? String(Q('.last-grade .delta', last).title || '') : '',
      grade: { score: txt('.gv-score', last), letter: txt('.gv-letter', last),
        label: cut > 0 ? gTitle.slice(0, cut) : gTitle, sub: cut > 0 ? cap(gTitle.slice(cut + 2)) : '' },
      kd: kd ? { label: txt('.kd-label', kd), ratio: txt('.kd-ratio', kd), split: txt('.kd-split', kd) } : null,
      categories: [],
      average: txt('.line-avg', last),
      buttons: list('.last-foot button', last),
    },
    // The top of the counted list; its trend and fix are the Patterns
    // page's own for the same mistake, filled in once that page is read.
    top: shown(Q('#top')) ? { title: txt('#top-list .top-title'), count: txt('#top-list .top-n'),
      detail: topN && topN.title ? String(topN.title).trim() + '.' : '', trend: '', fix: '' } : null,
    mistakesHeading: txt('#top .card-head .label'),
    mistakes: QA('#top-list .top-row').map((r) => ({ title: txt('.top-title', r), count: txt('.top-n', r) })),
    // The label is the Matches page's chart's ("Grade over your last 4"),
    // filled in once that page is read; Home's line says it only to a reader.
    trend: Q('#last .grade-line') ? { label: '', average: txt('#last .line-avg'), grades: list('#last .gl-num') } : null,
    recentHeading: txt('#recent .card-head .label'),
    recent: QA('#recent-list .r-row').map((r) => ({ title: T(Q('.r-title', r).firstChild), result: txt('.r-res', r), marks: list('.r-mark', r),
      meta: noDate(txt('.r-meta', r)), grade: txt('.r-score', r), letter: txt('.gv-letter', r) })),
  };
})()`;
/*
 * THE SHELL, PROGRESS V3 (8.9): the top bar's pill tabs and Start. The
 * account menu (8.9.1) is a view of its own over the page, drawing the
 * shell's rows: its rows and its games line are read from that view while it
 * is open (READ_MENU), never the account row itself.
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
  // facts are what it says while it waits and the locked review beside it.
  // The four facts are the switches under "Shown while recording" (map,
  // agent, score, round); the time it started is never read.
  return { title: txt('.live-word'), sub: txt('.live-wait p'),
    facts: [{ label: txt('.live-review-title'), text: txt('.live-review-sub') }],
    mode: txt('#live-mode'), shownLabel: txt('.live-choose .live-note'), shown: list('#live-chips button'),
    tape: { label: txt('.live-tape-head .live-label'), note: txt('.live-tape-head .live-note') },
    quiet: { title: txt('#sealed-title'), sub: txt('#sealed-sub'),
      facts: QA('#sealed-facts li').map((li) => ({ label: txt('b', li), text: txt('span', li) })) } };
})()`;
/*
 * MATCHES, PROGRESS V3 (8.9): every row is "Jett on Abyss" with its result,
 * its marks, the queue and whether Riot's record checked it, its top mistake,
 * its grade and its change since the match before; beside the rows, the
 * chart card of the grade over the last matches.
 */
const READ_MATCHES = `(() => { ${READ_HELPERS}
  return { heading: txt('#every .l-head h3'),
    rows: QA('#list .m-item').map((m) => ({ title: txt('.m-title', m), result: txt('.m-res', m), marks: list('.m-mark', m),
      meta: noDate(txt('.m-meta', m)), topMistake: txt('.m-top-mistake', m).replace(/^Top mistake:\\s*/, ''),
      grade: txt('.m-score', m), letter: txt('.m-letter', m), change: txt('.m-delta', m) })),
    chart: shown(Q('#m-chart')) ? { label: txt('.m-chart-label'), now: txt('#m-chart-big'), since: txt('#m-chart-since'), average: txt('#m-chart-avg') } : null };
})()`;
/*
 * PATTERNS, PROGRESS V3 (8.9): the chart of the grades with its letter bands
 * ("B 70"), its average line and its key; the four category averages, each
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
const READ_MOMENTS = `(() => { ${READ_HELPERS}
  return {
    compilation: { heading: txt('#mo-comp-title'), rows: QA('#mo-comp-rows .mo-crow').map((r) => ({ title: txt('.mo-ctitle', r), line: txt('.mo-cline', r),
      action: txt('button.btn', r) || txt('.mo-cnone', r) })) },
    heading: txt('#mo-log-title'), counts: txt('#mo-counts'), filter: list('#mo-filter button'), note: shown(Q('#mo-note')) ? txt('#mo-note') : '',
    matches: QA('#mo-list .mo-match').map((m) => ({ result: txt('.mo-res', m), who: txt('.mo-who', m), grade: txt('.mo-score', m), letter: txt('.mo-grade .gv-letter', m),
      moments: QA('.mo-row', m).map((x) => ({ round: txt('.mo-round', x), kind: txt('.mo-kind', x), title: txt('.mo-mtitle', x), line: txt('.mo-mline', x),
        marks: QA('.mo-mark', x).map((k) => ({ text: T(k), across: k.classList.contains('across') })), time: txt('.mo-time', x),
        clip: Q('.mo-play', x) ? 'Play' : txt('.mo-gone', x) || '' })) })),
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
  // stands where the reason was, its reason.
  return {
    verdict: { label: txt('header .h-brand h2'), reason: txt('#v-stat .vd-stat-label'),
      icon: shown(Q('#v-icon')) && !!Q('#v-icon .vd-icon-img'), letter: txt('#v-grade .vd-letter'), score: txt('#v-grade .vd-score'), out: txt('#v-grade .vd-out'),
      provisional: !!Q('#v-grade .vd-prov'), stat: { value: txt('#v-stat .vd-stat-value'), label: txt('#v-stat .vd-stat-label') },
      result: txt('#v-result'), scoreline: txt('#v-score'), meta: txt('#v-meta'),
      stats: QA('#v-stats .v-stat').map((s) => ({ value: txt('.v-stat-value', s), label: txt('.v-stat-label', s), versus: txt('.v-stat-vs', s) })),
      verified: shown(Q('#v-verified')) ? txt('#v-verified') : '' },
    fix: { heading: txt('#v-focus-wrap > .v-focus-label'), text: txt('#v-focus'), was: shown(Q('#v-focus-was')) ? txt('#v-focus-was') : '',
      wasHeading: shown(Q('#v-focus-was-wrap')) ? txt('#v-focus-was-wrap .v-focus-label') : '' },
    progress: QA('#v-prog .gv-prog').map((p) => ({ text: T(p), tone: [...p.classList].find((c) => ['good', 'bad', 'warn', 'even'].includes(c)) || 'even' })),
    read: { heading: txt('#v-summary-wrap h3, #v-summary-wrap .label'), lines: list('#v-summary li') },
    grade: { categories: QA('#grade-host .gv-cat').map((c) => ({ name: txt('.gv-cat-name', c), score: txt('.gv-cat-score', c), evidence: list('.gv-chip', c) })) },
    lists: QA('#insights-host .gv-block').map((b) => ({ heading: txt('h3', b), items: QA('.gv-item', b).map(item) })),
    comps: txt('#v-comps'), patterns: list('#v-patterns li'),
    rounds: { heading: txt('#v-rounds-wrap h3, #v-rounds-wrap .label'), halves: list('#v-rounds .v-half-side'), rows: QA('#v-rounds .v-round').map(round) },
    study: list('#v-study li'), refused: list('#v-refused li'),
    buttons: list('header button, .top button').filter((b) => b && b !== 'Close'),
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
      version: require(path.join(REPO, 'package.json')).version, window: WIN };

    /*
     * WHERE THINGS SIT ON THE PICTURES, for the site's pointer: the middle of
     * each tab in the top bar and of each compilation row and its Play all,
     * as fractions of the window (the pictures are the window at twice the
     * size), read off the laid out pages and never measured by hand.
     */
    const places = {};
    const frac = (n) => Math.round(n * 10000) / 10000;
    const inWindow = (p, onPage) => (p ? { x: frac((p.x + (onPage ? mainWindow.SIDEBAR_W : 0)) / WIN.width),
      y: frac((p.y + (onPage ? mainWindow.TOP_H : 0)) / WIN.height) } : null);

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
    const tabs = await sjs(`(() => { ${READ_HELPERS} return QA('#nav .nav-item').map((b) => ({ page: T(b), at: centre(b) })); })()`);
    places.tabs = Object.fromEntries(tabs.map((t) => [t.page, inWindow(t.at, false)]));
    // The K/D counts up to its two places as the card arrives (Motion.countUp):
    // read once it has landed, the same text a beat apart.
    const ratioNow = "(() => { const n = document.querySelector('#last .kd-ratio'); return n ? n.textContent : ''; })()";
    await until(async () => { const a = await hjs(ratioNow); await wait(300); return a === await hjs(ratioNow); }, 4000);
    out.home = await hjs(READ_HOME);
    lines.push(`home: fix "${out.home.fix.slice(0, 40)}" grade ${out.home.last.grade.score} recent ${out.home.recent.length}`);
    if (!out.home.fix || out.home.last.grade.score !== String(seeded.built.grade.score) || out.home.recent.length !== seeded.SEEDED) {
      return finish(false, `Home does not show the sample library: ${JSON.stringify(out.home.last)}`);
    }
    if (out.home.player.idShown) return finish(false, 'Home shows a Riot ID chip, and the sample library has none');
    await shot('home', 'Home: the top bar, the Start strip, the last match with its grade, change, K/D and grade line, the fix for next match, the repeated mistakes and the recent matches');

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

    // 2. Matches, from its tab in the top bar.
    await sjs("document.querySelector('#nav .nav-item[data-page=\"matches\"]').click(); true");
    if (!await until(settled('matches'), 6000)) return finish(false, 'Matches never came in');
    const mjs = pjs('matches');
    await until(() => mjs(`document.querySelectorAll('#list .m-item').length >= ${seeded.SEEDED}`), 6000);
    await wait(400);
    out.matches = await mjs(READ_MATCHES);
    lines.push(`matches: ${out.matches.rows.length} rows`);
    if (out.matches.rows.length !== seeded.SEEDED) return finish(false, `Matches lists ${out.matches.rows.length} rows`);
    await shot('matches', 'Matches: every saved match as a row with its result, top mistake, grade and change, beside the chart of the grade over the last matches');

    // 3. Patterns, for the JSON alone.
    const pajs = await show('patterns');
    await until(() => pajs("document.querySelectorAll('#p-lists .gv-item').length > 0"), 6000);
    await until(() => pajs("document.querySelectorAll('#p-trend .p-bar').length > 0"), 4000);
    await wait(800);   // the bars grown, the averages counted up
    out.patterns = await pajs(READ_PATTERNS);
    lines.push(`patterns: ${out.patterns.lists.map((l) => `${l.heading} ${l.items.length}`).join(', ')}`);
    if (!out.patterns.lists.length) return finish(false, 'Patterns lists nothing');
    // Home's old keys, from the pages that say them now: the top mistake's
    // trend word and fix as Patterns says them, the trend's label as the
    // Matches chart says it.
    const ptop = out.patterns.lists[0].items[0];
    if (out.home.top && ptop && ptop.title === out.home.top.title) {
      out.home.top.trend = (ptop.chips.find((c) => /^(?:steady|more often lately|less often lately)$/.test(c)) || '');
      out.home.top.fix = ptop.fix;
      out.home.top.chips = ptop.chips;
    }
    if (out.home.trend && out.matches.chart) out.home.trend.label = out.matches.chart.label;

    // 4. Moments.
    const mojs = await show('moments');
    if (!await until(() => mojs("!document.getElementById('mo-log').hidden && document.querySelectorAll('#mo-list .mo-row').length > 0"), 8000)) {
      return finish(false, 'the Moments page never listed its moments');
    }
    await wait(800);   // the rows risen
    out.moments = await mojs(READ_MOMENTS);
    // Where the compilation's rows and their Play all sit on the picture, as
    // the page lays them out at the top of the page, moved by where the page
    // sits in the window (under the top bar).
    const crows = await mojs(`(() => {
      ${READ_HELPERS}
      return QA('#mo-comp-rows .mo-crow').map((r) => ({ title: txt('.mo-ctitle', r), row: centre(Q('.mo-ctitle', r)), action: centre(Q('button.btn', r) || Q('.mo-cnone', r)) }));
    })()`);
    places.moments = crows.map((c) => ({ title: c.title, row: inWindow(c.row, true), action: inWindow(c.action, true) }));
    lines.push(`moments: ${out.moments.counts} | ${out.moments.compilation.rows.length} compilation rows`);
    if (out.moments.matches.length !== seeded.SEEDED || !out.moments.compilation.rows.length) return finish(false, `Moments: ${JSON.stringify(out.moments.counts)}`);
    await shot('moments', 'Moments: the compilation by repeated mistake, the filter capsule, and every death and highlight under its match');

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
    lines.push(`review: ${out.review.verdict.letter} ${out.review.verdict.score} "${out.review.verdict.stat.value} ${out.review.verdict.stat.label}" cats ${out.review.grade.categories.length} rounds ${out.review.rounds.rows.length} progress ${out.review.progress.length}`);
    const v = out.review.verdict;
    if (v.letter !== seeded.built.grade.letter || v.score !== String(seeded.built.grade.score) || out.review.grade.categories.length !== 4
      || !out.review.rounds.rows.length || !out.review.fix.text || !out.review.read.lines.length) {
      return finish(false, `the review does not show the sample match whole: ${JSON.stringify({ v, cats: out.review.grade.categories.length })}`);
    }
    await rjs("document.querySelector('.body').scrollTo(0, 0); true");
    await shot('review-top', 'The review: the Verdict with its icon, letter, number and standout, Riot\'s numbers, the fix for next match, the progress lines and the four categories');
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
    await shot('settings', 'Settings: each group a heading, one line and its capsule control, the first group the page\'s hero');
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
    await shot('sealed', 'The Recording screen: the live status waiting for the match to begin, what it shows while recording, and the review locked beside it, every tab locked, as the window is mid match');
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

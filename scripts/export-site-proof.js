'use strict';

/**
 * THE SITE'S PROOF, FROM THE REAL APP (8.7). The website's demos are made
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
  const noDate = (s) => s.split(/\\s+\\u00b7\\s+/).slice(1).join(' \\u00b7 ');
`;
const READ_HOME = `(() => { ${READ_HELPERS}
  const last = Q('#last');
  return {
    fix: txt('#focus-text'),
    last: {
      result: txt('.result', last), score: txt('.score', last), meta: txt('.meta', last),
      milestone: list('.last-prog .gv-prog', last),
      grade: { score: txt('.gv-score', last), letter: txt('.gv-letter', last), label: txt('.gv-label', last), sub: txt('.gv-sub', last) },
      categories: QA('.gv-cat', last).map((c) => ({ name: txt('.gv-cat-name', c), score: txt('.gv-cat-score', c) })),
      buttons: list('.last-foot button', last),
    },
    top: shown(Q('#top')) ? { title: txt('#top-title'), trend: txt('#top-trend'), detail: txt('#top-detail'), fix: txt('#top-fix') } : null,
    trend: shown(Q('#trend')) ? { label: txt('#trend .label'), average: txt('#trend-avg'), grades: list('#trend-bars .bar-num') } : null,
    recent: QA('#recent-list .r-row').map((r) => ({ title: T(Q('.r-title', r).firstChild), result: txt('.r-res', r), marks: list('.r-mark', r),
      meta: noDate(txt('.r-meta', r)), grade: txt('.r-score', r), letter: txt('.gv-letter', r) })),
  };
})()`;
const READ_SHELL = `(() => { ${READ_HELPERS}
  return { pages: list('#nav .nav-item'), foot: list('.side .foot button'), start: txt('#toggle .t-label'), games: txt('#rail-games') };
})()`;
const READ_SEALED = `(() => { ${READ_HELPERS}
  return { title: txt('#sealed-title'), sub: txt('#sealed-sub'),
    facts: QA('#sealed-facts li').filter(shown).map((li) => ({ label: txt('b', li), text: txt('span', li) })) };
})()`;
const READ_MATCHES = `(() => { ${READ_HELPERS}
  return { heading: txt('#every h3, #every h2, #every .block-title'),
    rows: QA('#list .m-item').map((m) => ({ title: txt('.m-title', m), result: txt('.m-res', m), marks: list('.m-mark', m),
      meta: noDate(txt('.m-meta', m)), topMistake: txt('.m-top-mistake', m).replace(/^Top mistake:\\s*/, ''),
      grade: txt('.m-score', m), letter: txt('.m-letter', m) })) };
})()`;
const READ_PATTERNS = `(() => { ${READ_HELPERS}
  const item = (li) => ({ title: txt('.gv-item-title', li), count: txt('.gv-count', li), detail: txt('.gv-item-detail', li),
    fix: txt('.gv-item-fix', li).replace(/^Fix\\s*/, ''), rounds: list('.gv-rchip', li) });
  return { sub: txt('#p-sub'), average: shown(Q('#p-avg')) ? txt('#p-avg-num') : '',
    grades: list('#p-trend .p-bar span'),
    categories: QA('#p-cats .p-cat').map((c) => ({ average: txt('b', c), label: txt('span', c), last: txt('small', c) })),
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
  return {
    verdict: { icon: shown(Q('#v-icon')) && !!Q('#v-icon .vd-icon-img'), letter: txt('#v-grade .vd-letter'), score: txt('#v-grade .vd-score'), out: txt('#v-grade .vd-out'),
      provisional: !!Q('#v-grade .vd-prov'), stat: { value: txt('#v-stat .vd-stat-value'), label: txt('#v-stat .vd-stat-label') },
      result: txt('#v-result'), scoreline: txt('#v-score'), meta: txt('#v-meta'),
      stats: QA('#v-stats .v-stat').map((s) => ({ value: txt('.v-stat-value', s), label: txt('.v-stat-label', s), versus: txt('.v-stat-vs', s) })),
      verified: shown(Q('#v-verified')) ? txt('#v-verified') : '' },
    fix: { heading: txt('#v-focus-wrap .label, #v-focus-wrap h3, #v-focus-wrap .v-focus-label'), text: txt('#v-focus'), was: shown(Q('#v-focus-was')) ? txt('#v-focus-was') : '' },
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
    out.home = await hjs(READ_HOME);
    lines.push(`home: fix "${out.home.fix.slice(0, 40)}" grade ${out.home.last.grade.score} recent ${out.home.recent.length}`);
    if (!out.home.fix || out.home.last.grade.score !== String(seeded.built.grade.score) || out.home.recent.length !== seeded.SEEDED) {
      return finish(false, `Home does not show the sample library: ${JSON.stringify(out.home.last)}`);
    }
    await shot('home', 'Home: the fix for next match, the last match as one ruled line with its grade, the trend and the recent matches');

    // 2. Matches, from the sidebar.
    await sjs("document.querySelector('#nav .nav-item[data-page=\"matches\"]').click(); true");
    if (!await until(settled('matches'), 6000)) return finish(false, 'Matches never came in');
    const mjs = pjs('matches');
    await until(() => mjs(`document.querySelectorAll('#list .m-item').length >= ${seeded.SEEDED}`), 6000);
    await wait(400);
    out.matches = await mjs(READ_MATCHES);
    lines.push(`matches: ${out.matches.rows.length} rows`);
    if (out.matches.rows.length !== seeded.SEEDED) return finish(false, `Matches lists ${out.matches.rows.length} rows`);
    await shot('matches', 'Matches: every saved match as a ruled row with its result, top mistake and grade');

    // 3. Patterns, for the JSON alone.
    const pajs = await show('patterns');
    await until(() => pajs("document.querySelectorAll('#p-lists .gv-item').length > 0"), 6000);
    out.patterns = await pajs(READ_PATTERNS);
    lines.push(`patterns: ${out.patterns.lists.map((l) => `${l.heading} ${l.items.length}`).join(', ')}`);
    if (!out.patterns.lists.length) return finish(false, 'Patterns lists nothing');

    // 4. Moments.
    const mojs = await show('moments');
    if (!await until(() => mojs("!document.getElementById('mo-log').hidden && document.querySelectorAll('#mo-list .mo-row').length > 0"), 8000)) {
      return finish(false, 'the Moments page never listed its moments');
    }
    await wait(800);   // the rows risen
    out.moments = await mojs(READ_MOMENTS);
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
    await shot('sealed', 'The Recording screen: the crescent, one line and three facts, every page locked, as the window is mid match');
    mainWindow.setSealed(false);
    await wait(400);

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

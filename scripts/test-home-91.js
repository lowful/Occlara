'use strict';

/**
 * test:home91. HOME AS THE OWNER ASKED FOR IT IN 9.1 (RELEASE-9.1-PLAN.md,
 * items 1, 3, 4, 8, 9 and 10), run in node against Home's real markup,
 * scripts and preload (scripts/fixtures/fake-dom.js), and its stylesheets
 * and the sky read as text:
 *
 *   1  the last match card has no buttons and is one link to its review; a
 *      newest match with no grade says so and why, and the hero no longer
 *      calls an ungraded recording graded
 *   3  every row of what repeats in the full ink
 *   4  each repeated mistake and the grade with an arrow and a tooltip that
 *      says what it compares; the trend's title is its average and its axis
 *      names days
 *   8  no "Your fix for next match" label; Start and Open last review at
 *      60px, the label centred with the arrow's room unseen; the hero never
 *      shrinks into the cards
 *   9  the moon is drawn at the device's resolution, turns by the wall clock
 *      at 30 frames at most, and stands still while a match is recorded
 *  10  the rank card: the tier's icon, the RR, the way to the next tier
 *
 * Run: npm run test:home91
 */

const fs = require('fs');
const path = require('path');
const { loadSurface, settle } = require('./fixtures/fake-dom');
const C = require('../src/shared/channels');
const HM = require('../src/shared/home-model');

const ROOT = path.join(__dirname, '..');
const RENDERER = path.join(ROOT, 'src', 'renderer');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

let fails = 0;
let checks = 0;
const ok = (cond, what, detail) => {
  checks++;
  if (!cond) { fails++; console.log(`FAIL  ${what}${detail ? `\n        ${detail}` : ''}`); } else console.log(`ok    ${what}`);
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.now();
const row = (id, ago, extra) => ({ id, game: 'valorant', at: NOW - ago, title: 'Jett', map: 'Split', mode: 'Swiftplay', result: 'Victory', score: '5-2',
  verified: true, source: 'watched', aiLog: null, grade: { score: 84 }, ...(extra || {}) });

/** Home on a library, main stood in for. */
async function openHome(o) {
  const opts = o || {};
  const rows = opts.rows;
  const reviews = opts.reviews || {};
  const h = loadSurface('home', {
    handlers: {
      [C.STATE_GET]: () => ({ gameId: 'valorant', isCoaching: false, riotId: opts.riotId || '', live: { liveRating: false } }),
      [C.CONFIG_GET]: () => ({ language: 'en', riotId: opts.riotId || '', recordingMode: 'auto', recordingRes: '1080' }),
      [C.REVIEWS_LIST]: () => rows,
      [C.PATTERNS_GET]: () => ({ matches: rows.length, recorded: opts.recorded || rows.length, enough: true, mistakes: opts.mistakes || [],
        strengths: [], missed: [], grades: opts.grades || rows.filter((r) => r.grade).map((r) => ({ id: r.id, at: r.at, score: r.grade.score })), average: 70, categories: [] }),
      [C.REVIEW_GET]: (id) => reviews[id] || null,
      [C.STATS_RANK_HISTORY]: opts.history || (() => ({ points: [] })),
    },
  });
  await settle();
  return h;
}

(async () => {
  // ── 1: the last match card ─────────────────────────────────────────────────
  {
    const rows = [row('valorant-1-a', 60000), row('valorant-2-b', DAY, { grade: { score: 65 } })];
    const h = await openHome({ rows, reviews: { 'valorant-1-a': { id: 'valorant-1-a', focus: 'Enter second: let a teammate go first.', grade: { score: 84 } } } });
    const last = h.$('last');
    ok(last.querySelectorAll('button').length === 0 && last.getAttribute('role') === 'link' && last.tabIndex === 0, 'the last match card: no buttons, one link in the tab order');
    ok(last.querySelector('.lm-result').textContent === 'Victory 5 : 2' && last.querySelector('.lm-who').textContent === 'Jett on Split, Swiftplay',
      'its body: the result and the score, then who and the queue', last.querySelector('.lm-result').textContent);
    ok(last.querySelector('.gv-score').textContent === '84' && last.querySelector('.grade-name').textContent === 'Grade'
      && last.querySelector('.delta').textContent === '+19' && last.querySelector('.delta').title === 'Up 19 on your last match',
    'the grade, its name and its change on the match before, the sentence in its tooltip');
    ok(/^Today /.test(last.querySelector('.last-when').textContent), 'when, beside its eyebrow, "Today" and the time', last.querySelector('.last-when').textContent);
    last.click();
    ok(same(h.bridge.sent.filter((s) => s[0] === C.REVIEW_OPEN), [[C.REVIEW_OPEN, 'valorant-1-a']]), 'and the whole card opens its review');
    ok(h.$('h-kicker').hidden && h.$('h-kicker').textContent === '' && h.$('h-fix-head').textContent === 'Enter second'
      && h.$('h-fix-sub').textContent === 'Let a teammate go first.', 'item 8: the fix is the hero, with no label over it');
  }
  {
    // The owner's library: a two round Haven recording, ungraded, the newest.
    const rows = [row('valorant-1-h', 60000, { title: null, map: 'Haven', mode: null, result: null, score: null, grade: null, verified: false }),
      row('valorant-2-s', DAY, { grade: { score: 84 } })];
    const reviews = { 'valorant-1-h': { id: 'valorant-1-h', watched: { rounds: 2 }, grade: { score: null, notes: [] }, focus: null } };
    const bare = await openHome({ rows, reviews });
    const last = bare.$('last');
    ok(!last.querySelector('.gv-grade') && last.querySelector('.last-nograde').textContent === 'Not graded'
      && last.querySelector('.lm-note.why').textContent === 'Only 2 rounds were recorded, too few to grade.',
    'a newest match with no grade says so where the grade would be, and why under it', last.textContent);
    ok(last.querySelector('.lm-result').textContent === 'Haven' && !/Haven, /.test(last.querySelector('.lm-who').textContent),
      'its map once, not again in the line under it', last.querySelector('.lm-who').textContent);
    last.click();
    ok(same(bare.bridge.sent.filter((s) => s[0] === C.REVIEW_OPEN), [[C.REVIEW_OPEN, 'valorant-1-h']]), 'and it still opens');
    ok(bare.$('h-fix-head').textContent === 'Your last match was not graded.' && bare.$('h-fix-sub').textContent === 'Only 2 rounds were recorded, too few to grade.'
      && !/is graded/.test(bare.$('h-fix').textContent), 'the hero no longer calls it graded: it says it was not, and why', bare.$('h-fix').textContent);
    const building = await openHome({ rows: [row('valorant-1-w', 60000, { work: { path: 'riot', step: 'riot' } })] });
    ok(building.$('h-fix-head').textContent === 'Your last match is being checked.' && !/is graded/.test(building.$('h-fix').textContent),
      'a match still being built is said to be checked, not graded', building.$('h-fix').textContent);
    // With an older graded match's fix, it stands in and says whose.
    const lent = await openHome({ rows, reviews: { ...reviews, 'valorant-2-s': { id: 'valorant-2-s', focus: 'Trade your entry: stay close.', grade: { score: 84 } } } });
    ok(lent.$('h-fix-head').textContent === 'Trade your entry' && !lent.$('h-kicker').hidden && lent.$('h-kicker').textContent === 'From your last graded match',
      'the last graded match lends its fix, and the hero says it is that one\'s', lent.$('h-kicker').textContent);
  }

  // ── The model's words ──────────────────────────────────────────────────────
  ok(same(HM.noGradeOf({ id: 'a' }, { watched: { rounds: 1 } }), { rounds: 1, text: 'Only 1 round was recorded, too few to grade.' })
    && HM.noGradeOf({ id: 'a' }, { watched: { rounds: 0 } }).text === 'No round was recorded, so there is nothing to grade.'
    && HM.noGradeOf({ id: 'a' }, { watched: { rounds: 14 }, grade: { notes: ["Riot's record has you sitting out every round it verified, so there is nothing to grade."] } }).text.startsWith("Riot's record has you")
    && HM.noGradeOf({ id: 'a' }, null).text === 'Too little of this match was seen to grade it.'
    && HM.noGradeOf({ id: 'a', grade: { score: 70 } }, null) === null && HM.noGradeOf({ id: 'a', work: { path: 'riot' } }, null) === null,
  'why a match has no grade: its rounds, a sat out record, or too little seen; nothing for a graded one or one being built');
  const gt = HM.gradeTrendOf([84, 65, 61, 73, 84, 71, 97, 73].map((score) => ({ score })));
  ok(gt && gt.way === 'down' && gt.recent === 73 && gt.before === 80 && gt.words === 'Getting worse: your last 5 graded matches average 73, the 3 before them 80.',
    "the grade's way: the line's five against the ones before, its tooltip saying so", JSON.stringify(gt));
  const halves = HM.gradeTrendOf([71, 64, 61, 58].map((score) => ({ score })));
  ok(halves && halves.way === 'up' && halves.words === 'Getting better: your newest 2 graded matches average 68, the 2 before them 60.',
    'with four or five, the newer half of the line against the older', JSON.stringify(halves));
  ok(HM.gradeTrendOf([70, 71, 69, 70].map((score) => ({ score }))).way === 'flat' && HM.gradeTrendOf([70, 80, 60].map((score) => ({ score }))) === null,
    'within 3 points it is steady, and below four grades there is no way at all');
  ok(HM.mistakeTrendWords({ key: 'untraded', newer: 4, older: 1 }, 'up', 10) === 'Getting worse: in 4 of your 5 newest recorded matches, up from 1 of the 5 before them.'
    && HM.mistakeTrendWords({ key: 'untraded', newer: 1, older: 4 }, 'down', 9) === 'Getting better: in 1 of your 5 newest recorded matches, down from 4 of the 4 before them.'
    && HM.mistakeTrendWords({ key: 'cause:repeek', newer: 3, older: 1 }, 'up', 10) === 'Getting worse: it shows up in more of your newer recorded matches than the ones before.',
  "a mistake's way in words: what was counted in each half, and no counts that are not a look's own");

  // ── 3 and 4: what repeats, the trend ───────────────────────────────────────
  {
    const rows = [0, 1, 2, 3, 4].map((i) => row(`valorant-${i}-t`, 60000 + i * DAY * 2, { grade: { score: [84, 65, 61, 73, 84][i] } }));
    const mistakes = [
      { key: 'untraded', title: 'Deaths nobody traded', total: 57, matches: 7, trend: 'rising', newer: 4, older: 3 },
      { key: 'early', title: 'Dying in the first 30 seconds', total: 9, matches: 2, trend: 'falling', newer: 0, older: 2 },
      { key: 'advantage', title: 'Gave back the advantage', total: 5, matches: 2, trend: 'steady', newer: 1, older: 1 },
      { key: 'agent:Reyna', title: 'Reyna kept winning', total: 4, matches: 2, trend: null },
    ];
    const h = await openHome({ rows, mistakes, recorded: 10 });
    const tops = h.document.querySelectorAll('#top-list .top-row');
    ok(tops.length === 4 && tops.every((r) => !r.classList.contains('faded')), 'item 3: four rows, none faded');
    const ways = tops.map((r) => { const w = r.querySelector('.way'); return w ? w.className : ''; });
    ok(/\bup worse\b/.test(ways[0]) && /\bdown better\b/.test(ways[1]) && /\bflat steady\b/.test(ways[2]) && /\bnone\b/.test(ways[3]),
      'item 4: up and worse, down and better, flat and steady, and an empty place keeping the counts in line', JSON.stringify(ways));
    const w0 = tops[0].querySelector('.way');
    ok(w0.getAttribute('role') === 'img' && w0.getAttribute('aria-label') === 'Getting worse: in 4 of your 5 newest recorded matches, up from 3 of the 5 before them.'
      && w0.dataset.tip === w0.getAttribute('aria-label'), 'its words, as a tooltip and to a screen reader', w0.getAttribute('aria-label'));
    const trend = h.$('trend');
    ok(trend.querySelector('.o-title').textContent === 'Averaging 73', "the trend's title is the average its line draws", trend.querySelector('.o-title').textContent);
    const tw = trend.querySelector('.trend-head .way');
    ok(tw && /\bflat\b/.test(tw.className) || (tw && /\b(up|down)\b/.test(tw.className)), "and the grade's own arrow beside it", tw && tw.className);
    const foot = trend.querySelectorAll('.gl-time').map((t) => t.textContent);
    ok(foot.length >= 2 && foot.every((t) => /^(Today|Yesterday|[A-Z][a-z]{2} \d{1,2})$/.test(t)), 'matches on different days are named by their day under the line', JSON.stringify(foot));
    ok(trend.querySelector('.line-avg').textContent === 'Your last five graded matches', 'and the line under it says what it is of');
    const one = await openHome({ rows: rows.map((r, i) => ({ ...r, at: NOW - 60000 - i * 3600000 })).filter((r) => new Date(r.at).toDateString() === new Date(NOW).toDateString()) });
    const oneFoot = one.$('trend').querySelectorAll('.gl-time').map((t) => t.textContent);
    if (oneFoot.length) {
      ok(oneFoot.every((t) => /\d{1,2}:\d{2}/.test(t)) && /, all today$/.test(one.$('trend').querySelector('.line-avg').textContent),
        'all on one day, by their time, and the line says the day', JSON.stringify(oneFoot));
    }
  }

  // ── 10: the rank ───────────────────────────────────────────────────────────
  {
    const rows = [row('valorant-1-r', 60000, { mode: 'Competitive', score: '13-11' })];
    const hist = (tier, elos) => () => ({ points: elos.map((elo, i) => ({ date: NOW - (elos.length - i) * DAY, elo, change: i ? elos[i] - elos[i - 1] : 10, tier })) });
    const d = await openHome({ rows, riotId: 'Me#EUW', history: hist('Diamond 1', [1546, 1557]) });
    ok(!d.$('rank').hidden && d.$('rank-tier').textContent === 'Diamond 1' && d.$('rank-icon').getAttribute('src') === '../../../assets/ranks/diamond-1.webp' && !d.$('rank-icon').hidden,
      'the tier and its own icon');
    ok(d.$('rank-rr').textContent === '+11 RR' && d.$('rank-fill').style.width === '57%' && d.$('rank-in').textContent === '57 RR' && d.$('rank-to').textContent === '43 RR to Diamond 2',
      'the last change, the RR in the tier as a bar, and how far to the next tier, named');
    const i = await openHome({ rows, riotId: 'Me#EUW', history: hist('Immortal 2', [2290, 2312]) });
    ok(i.$('rank-bar').hidden && !i.$('rank-points').hidden && i.$('rank-points').textContent === '112 RR' && i.$('rank-in').textContent === 'Immortal 3 follows the leaderboard'
      && i.$('rank').classList.contains('uncapped') && i.$('rank-icon').getAttribute('src') === '../../../assets/ranks/immortal-2.webp',
    'Immortal: its RR uncapped, no bar, and why');
    const r = await openHome({ rows, riotId: 'Me#EUW', history: hist('Radiant', [2900, 2944]) });
    ok(r.$('rank-points').textContent === '544 RR' && r.$('rank-in').textContent === 'The highest rank' && r.$('rank-icon').getAttribute('src') === '../../../assets/ranks/radiant.webp',
      'Radiant: its RR, and that it is the top');
    r.fire(r.$('rank-icon'), 'error');
    ok(r.$('rank-icon').hidden, 'an icon that fails to load leaves the words alone');
  }

  // ── 8: the hero's layout, read from the stylesheet ─────────────────────────
  const css = read('src', 'renderer', 'home', 'home.css');
  const rule = (sel) => {
    const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return (css.match(new RegExp(`(?:^|\\n)${esc}\\s*\\{([^}]*)\\}`)) || [])[1] || '';
  };
  const prop = (body, name) => ((body.match(new RegExp(`(?:^|[;\\s])${name}\\s*:\\s*([^;]+);`)) || [])[1] || '').trim();
  ok(prop(rule('.home > *'), 'flex-shrink') === '0', 'no section of Home shrinks: the hero keeps its height and the page scrolls');
  ok(!/\.top-row\.faded/.test(css), 'item 3: no faded row rule left');
  const big = rule('.h-actions .btn.h-big');
  ok(prop(big, 'height') === '60px' && parseInt(prop(big, 'min-width'), 10) >= 220, 'item 8: Start and Open last review at 60px', big);
  const gap = parseInt(prop(big, 'gap'), 10);
  const shift = parseFloat((prop(rule('.h-actions .btn.h-big:has(> .btn-arrow) > .btn-label'), 'transform').match(/translateX\(([\d.]+)px\)/) || [])[1]);
  ok(gap === 12 && shift === (gap + 16) / 2, "the label moves by half the arrow's room (its gap and its 16px), so the icon and the word stand in the middle", `${gap} ${shift}`);
  const html = read('src', 'renderer', 'home', 'index.html');
  const actions = html.slice(html.indexOf('<div class="h-actions">'), html.indexOf('<div id="h-lr-confirm"'));
  ok(/id="h-start"/.test(actions) && /id="h-open"/.test(actions) && /id="h-lr"/.test(actions), 'the live rating switch stands beside Start, on its line');
  ok(!/Your fix for next match/.test(html.replace(/<!--[\s\S]*?-->/g, '')), 'no "Your fix for next match" in the markup');

  // ── 9: the moon ────────────────────────────────────────────────────────────
  const sky = read('src', 'renderer', 'shared', 'sky.js');
  ok(/getContext\('webgl'/.test(sky) && /devicePixelRatio/.test(sky) && /canvas\.width !== bw/.test(sky), 'the moon is drawn on the GPU at the device\'s own resolution');
  ok(/regionOf\(host\)/.test(sky) && /const WHOLE_PX = 2048/.test(sky), 'only the part this document shows, a turned host whole at 2048 at most');
  ok(/Date\.now\(\) \/ 1000/.test(sky) && /const TURN_S = \d+/.test(sky) && Number(sky.match(/const TURN_S = (\d+)/)[1]) >= 600,
    'it turns by the wall clock, so every document agrees, and slowly (one turn in ten minutes or more)');
  ok(/const FPS = 30;/.test(sky) && /1000 \/ FPS/.test(sky), 'at 30 frames a second at most');
  ok(/Motion\.onAmbient/.test(sky) && /ambientOn\(\)/.test(sky) && /rec-still/.test(sky) && /if \(sealedHere\(\)\) return;/.test(sky)
    && /\.app\.is-sealed/.test(sky), 'still while a match is recorded (ambient off and html.rec-still), and never baked mid match (the shell sealed)');
  ok(/page-armed/.test(sky) && /page-leaving/.test(sky) && /visibilityState === 'hidden'/.test(sky) && /hiddenAbove\(host\)/.test(sky),
    'and while its page or window is out of sight, or an ancestor holds it at no opacity');
  ok(/software\(gl\)/.test(sky) && /imageMoon\(host, true\)/.test(sky), 'where WebGL is missing or is the software renderer, the image moon stands in');
  // In a DOM with no WebGL at all, putting the moon up throws nothing.
  const h = await openHome({ rows: [row('valorant-1-m', 60000)] });
  let threw = null;
  try { h.window.OcclaraSky.moon(h.$('h-moon')); h.window.OcclaraSky.moon(h.$('h-moon')); } catch (e) { threw = e; }
  ok(!threw && typeof h.window.OcclaraSky.hasMoon() === 'boolean', 'with no WebGL, the moon goes up as before and nothing throws', threw && threw.message);

  console.log(`\n${fails ? `FAIL: ${fails} of ${checks}` : `all ${checks} Home 9.1 checks passed`}`);
  process.exit(fails ? 1 : 0);
})();

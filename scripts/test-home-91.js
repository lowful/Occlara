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
const { loadSurface, settle, makeEvent } = require('./fixtures/fake-dom');
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
    ok(!last.classList.contains('no-map') && last.querySelector('.lm-media .lm-map'), 'a map with its bundled art: the picture leads the card');
  }
  {
    // A map the bundled art does not know (a new map before sync:mapart, and
    // every League match): no empty raised box where the picture would be.
    const rows = [row('valorant-1-n', 60000, { map: 'Nowhere', score: '13-11' }), row('valorant-2-n', DAY, { grade: { score: 65 } })];
    const h = await openHome({ rows });
    const last = h.$('last');
    ok(last.classList.contains('no-map') && !!last.querySelector('.lm-media.no-map') && !last.querySelector('.lm-map'),
      'no map picture: the card and its picture\'s place are marked no-map, and no map is drawn', last.className);
    ok(last.querySelector('.lm-result').textContent === 'Victory 13 : 11', 'the score whole, "Victory 13 : 11"', last.querySelector('.lm-result').textContent);
    // Recent matches write the score as the card and Matches do.
    const res = h.document.querySelectorAll('#recent-list .r-res').map((r) => r.textContent);
    ok(same(res, ['Victory 13 : 11', 'Victory 5 : 2']), 'recent matches write the score as the last match card does, "13 : 11"', JSON.stringify(res));
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
    // Its way to Patterns in its head, as Rank journey is on the rank card:
    // at the foot it fell under the card's clipped edge, still in the tab order.
    const more = h.$('top-more');
    const kids = h.$('top').children;
    ok(more.parentNode.classList.contains('card-head') && more.parentNode.parentNode === h.$('top')
      && kids.indexOf(more.parentNode) < kids.indexOf(h.$('top-list')), "What repeats: All patterns in the card's head, above its rows");
    ok(tops.every((r) => r.querySelector('.top-title').title === r.querySelector('.top-title').textContent),
      'each title whole in its tooltip, where a narrow card cuts it');
    const w0 = tops[0].querySelector('.way');
    ok(w0.getAttribute('role') === 'img' && w0.getAttribute('aria-label') === 'Getting worse: in 4 of your 5 newest recorded matches, up from 3 of the 5 before them.'
      && w0.dataset.tip === w0.getAttribute('aria-label'), 'its words, as a tooltip and to a screen reader', w0.getAttribute('aria-label'));
    const trend = h.$('trend');
    ok(trend.querySelector('.o-title').textContent === 'Averaging 73', "the trend's title is the average its line draws", trend.querySelector('.o-title').textContent);
    const tw = trend.querySelector('.trend-head .way');
    ok(tw && /\bflat\b/.test(tw.className) || (tw && /\b(up|down)\b/.test(tw.className)), "and the grade's own arrow beside it", tw && tw.className);
    // 9.1: the line is the shared trend chart Matches draws (trend-chart.js):
    // each day named once under its matches, never a time of day.
    ok(trend.querySelector('.trend-chart.tc') && trend.querySelector('svg.tc-svg') && trend.querySelectorAll('.tc-dot').length === 5
      && trend.querySelectorAll('.tc-dot.now').length === 1, 'the trend is the shared chart, a dot a match, the newest the bright one');
    const foot = trend.querySelectorAll('.tc-foot-label').map((t) => t.textContent);
    ok(foot.length >= 2 && foot.every((t) => /^(Today|Yesterday|[A-Z][a-z]{2} \d{1,2})$/.test(t)), 'matches on different days are named by their day under the line', JSON.stringify(foot));
    ok(trend.querySelector('.line-avg').textContent === 'Your last five graded matches', 'and the line under it says what it is of');
    // Its tooltip, under the arrow keys as under the pointer: when, who, the
    // result and the grade with its change; Enter opens that match.
    const chartEl = trend.querySelector('.trend-chart');
    const key = (k) => chartEl.dispatchEvent(makeEvent('keydown', { key: k }));
    key('ArrowLeft');
    const tip = chartEl.querySelector('.tc-tip');
    ok(tip && !tip.hidden && tip.querySelector('.tc-tip-name').textContent === 'Jett on Split' && tip.querySelector('.tc-tip-num').textContent === '84'
      && tip.querySelector('.tc-tip-res').textContent === 'Victory 5 : 2' && tip.querySelector('.tc-tip-delta').textContent === '+19'
      && /^Today, /.test(tip.querySelector('.tc-tip-when').textContent),
    'a match under the keys shows when, who, the result and its grade with the change', tip && tip.textContent);
    key('Enter');
    ok(same(h.bridge.sent.filter((s) => s[0] === C.REVIEW_OPEN).pop(), [C.REVIEW_OPEN, 'valorant-0-t']), 'and Enter opens that match', JSON.stringify(h.bridge.sent.filter((s) => s[0] === C.REVIEW_OPEN)));
    const one = await openHome({ rows: rows.map((r, i) => ({ ...r, at: NOW - 60000 - i * 3600000 })).filter((r) => new Date(r.at).toDateString() === new Date(NOW).toDateString()) });
    const oneFoot = one.$('trend').querySelectorAll('.tc-foot-label').map((t) => t.textContent);
    if (one.$('trend').querySelectorAll('.tc-dot').length >= 2) {
      ok(oneFoot.length === 1 && oneFoot[0] === 'Today' && /, all today$/.test(one.$('trend').querySelector('.line-avg').textContent),
        'all on one day, the day named once under them, and the line says the day', JSON.stringify(oneFoot));
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
    // Iron 1 at 0 RR is an elo of 0, as an unrated point is: it is a rank,
    // never the game before it ("+19 RR" after a game that cost 19).
    const iron = await openHome({ rows, riotId: 'Me#EUW', history: hist('Iron 1', [19, 0]) });
    ok(!iron.$('rank').hidden && iron.$('rank-tier').textContent === 'Iron 1' && iron.$('rank-rr').textContent === '-19 RR'
      && iron.$('rank-in').textContent === '0 RR' && iron.$('rank-to').textContent === '100 RR to Iron 2',
    'Iron 1 at 0 RR: its own tier, the game that took it there, and 100 to Iron 2',
    [iron.$('rank-tier').textContent, iron.$('rank-rr').textContent, iron.$('rank-in').textContent, iron.$('rank-to').textContent].join(' | '));
    const unrated = await openHome({ rows, riotId: 'Me#EUW', history: () => ({ points: [{ date: NOW - DAY, elo: 0, change: 0, tier: 'Unrated' }] }) });
    ok(unrated.$('rank').hidden, 'an unrated point at an elo of 0 is still no rank');
  }

  // ── 10 on Stats: the rank tile ─────────────────────────────────────────────
  {
    const stats = async (tier, rankLine, elos) => {
      const st = loadSurface('stats', {
        handlers: {
          [C.STATS_DASHBOARD]: () => ({ game: 'valorant', statsSupported: true, categories: {}, rank: { value: tier, direction: 'flat' },
            rankLine, winRate: { value: 52, direction: 'up' }, topAgents: [], sessions: [], sessionCount: 0,
            matches: { matches: [], fetchedAt: 0, mode: 'competitive' }, grading: null, riotId: 'Me#EUW' }),
          [C.STATS_MATCHES]: () => ({ matches: [] }),
          [C.STATS_RANK_HISTORY]: () => ({ points: elos.map((elo, i) => ({ date: NOW - (elos.length - i) * DAY, elo, change: i ? elos[i] - elos[i - 1] : 10, tier })) }),
        },
      });
      await settle();
      st.clock.flushFrames();
      await settle();
      const tile = st.document.querySelectorAll('#cards .card').find((c) => c.querySelector('.label') && /^Rank/.test(c.querySelector('.label').textContent));
      const foot = tile ? tile.querySelectorAll('.rank-progress .rank-foot span').map((s) => s.textContent) : null;
      return { tile, foot, rr: tile && tile.querySelector('.arrow') ? tile.querySelector('.arrow').textContent : null,
        sub: tile && tile.querySelector('.rank-sub') ? tile.querySelector('.rank-sub').textContent : null };
    };
    const imm = await stats('Immortal 2', ['112 RR', 'Peak Immortal 3'], [2290, 2312]);
    ok(imm.tile && same(imm.foot, ['', 'Immortal 3 follows the leaderboard']) && /^112 RR/.test(imm.sub || ''),
      'Stats at Immortal: the RR said once, by the line under the tile, the foot saying why there is no bar', JSON.stringify(imm.foot));
    const bare = await stats('Immortal 2', [], [2290, 2312]);
    ok(same(bare.foot, ['112 RR', 'Immortal 3 follows the leaderboard']), 'and without that line the foot says the RR', JSON.stringify(bare.foot));
    const dia = await stats('Diamond 1', ['57 RR', 'Peak Diamond 2'], [1546, 1557]);
    ok(same(dia.foot, ['', '43 RR to Diamond 2']) && dia.tile.querySelector('.rank-progress .rank-bar'), 'below Immortal: the bar and how far to go, the RR in the line under', JSON.stringify(dia.foot));
    const iron = await stats('Iron 1', ['0 RR'], [19, 0]);
    ok(iron.rr === '-19 RR' && same(iron.foot, ['', '100 RR to Iron 2']), "Stats at Iron 1, 0 RR: the game that took it there, and 100 to Iron 2", `${iron.rr} ${JSON.stringify(iron.foot)}`);
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
  // Item 4: steady is a mark in its own round as up and down are, never a
  // bare line before a count, which read as a minus ("- 24").
  const steady = prop(rule('.way.steady'), 'background');
  ok(steady && steady !== 'none' && steady !== 'transparent', 'item 4: the steady mark stands in a round of its own', steady);
  // Item 1: the score is never cut. The line breaks between the result and
  // the score, each whole, and a narrower card puts the grade's words under it.
  ok(prop(rule('.lm-result'), 'white-space') === 'normal' && !/text-overflow/.test(rule('.lm-result'))
    && prop(rule('.lm-result .result, .lm-result .score'), 'white-space') === 'nowrap',
  'item 1: "Victory 13 : 11" is never cut to "Victory 13 : ..."', rule('.lm-result'));
  const block = (head) => { const at = css.indexOf(head); if (at < 0) return ''; let depth = 0; for (let i = css.indexOf('{', at); i < css.length; i++) { if (css[i] === '{') depth++; else if (css[i] === '}' && --depth === 0) return css.slice(at, i + 1); } return ''; };
  ok(/flex-direction:\s*column/.test(block('@container (max-width: 290px)')), "a narrow card stacks the grade's words under the number", block('@container (max-width: 290px)').slice(0, 80));
  // The narrow window: two across, what repeats the whole width under them
  // with its rows two by two, a card alone on its line taking all of it.
  const narrow = block('@media (max-width: 1160px)');
  ok(/\.bento, \.bento:has\(> \.card\[hidden\]\) \{ grid-template-columns: minmax\(0, [\d.]+fr\) minmax\(0, [\d.]+fr\); \}/.test(narrow)
    && /\.bento > #top, \.bento:has\(> #trend\[hidden\]\) > #last \{ grid-column: 1 \/ -1; \}/.test(narrow)
    && /#top \.top-list \{ display: grid; grid-template-columns: repeat\(2,/.test(narrow),
  'a narrower window: the bento two across, what repeats the whole width, its rows two by two', narrow.slice(0, 120));
  ok(!/\.top-sub \{ display: none; \}/.test(css), "and no width hides the mistakes' lines any more");
  // No map picture: the empty raised box is gone.
  const noMap = rule('.lm-media.no-map');
  ok(/background:\s*none/.test(noMap) && /border:\s*0/.test(noMap) && /flex:\s*none/.test(noMap) && prop(rule('.bento > #last.no-map'), 'height') === 'auto',
    'no map picture: no empty box, one slim line, the card as tall as it holds', noMap);
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
  ok(/Motion\.onAmbient/.test(sky) && /ambientOn\(\)/.test(sky) && /rec-still/.test(sky) && /const held = \(\) => sealedHere\(\) \|\| still\(\);/.test(sky) && /if \(held\(\)\) \{ standIn\(\); return; \}/.test(sky)
    && /\.app\.is-sealed/.test(sky), 'still while a match is recorded (ambient off and html.rec-still), and never baked mid match (the shell sealed)');
  // The bake is a canvas loop too (item 9): it waits under html.rec-still
  // between matches as well, and is taken up again as the recording ends.
  const wakeFn = sky.slice(sky.indexOf('function wake()'), sky.indexOf('function layout()'));
  ok(/if \(held\(\)\) standIn\(\);\s+else if \(!st\.bakeRaf\) st\.bakeRaf = requestAnimationFrame\(bakeStep\);/.test(wakeFn),
    'the bake never starts while a match is recorded, between matches included', wakeFn.slice(0, 200));
  ok(/if \(still\(\)\) \{ cancelAnimationFrame\(st\.bakeRaf\); st\.bakeRaf = 0; standIn\(\); \}/.test(sky) && /if \(now\) m\.stop\(\); else m\.wake\(\);/.test(sky),
    'a bake under way stops as a recording starts and is taken up where it stopped as it ends');
  ok(/const standIn = \(\) => \{ if \(!st\.baked\) imageMoon\(host, !sealedHere\(\)\); \};/.test(sky),
    'while it waits unbaked the image moon stands in, a still picture, mid match only one already kept');
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

'use strict';

/**
 * THE GRADE TREND (9.1, the owner's items 15 and 21): the shared chart,
 * src/renderer/shared/trend-chart.js, the moonlit area Matches draws across
 * its top and Home's trend card can draw too.
 *
 * Its pure parts in node (the smooth line never overshoots a match, the foot
 * is days and never runs together, the plot's range), then the chart itself
 * in the fake DOM inside the Matches page that loads it: what a screen
 * reader is told, the keyboard, the tooltip, the average, a provisional
 * grade, the draw played once and not at all under less motion, and a new
 * width drawn again.
 *
 * Run: npm run test:trendchart
 */
const { loadSurface, settle, makeEvent } = require('./fixtures/fake-dom');
const C = require('../src/shared/channels');
const TC = require('../src/renderer/shared/trend-chart');

let fails = 0;
const ok = (cond, what, detail) => {
  if (!cond) { fails++; console.log(`FAIL  ${what}${detail ? `\n        ${detail}` : ''}`); }
  else console.log(`ok    ${what}`);
};
const DASHES = /[\u2013\u2014]/;
const HOUR = 3600000;
const DAY = 24 * HOUR;

console.log('\nthe line never draws a grade nobody played:');
{
  const xy = [[0, 80], [50, 20], [100, 20], [150, 90], [200, 60], [250, 61], [300, 10]];
  const d = TC.smoothPath(xy);
  // Every cubic segment, sampled: its y stays between its two matches'.
  const segs = [...d.matchAll(/C([\d.-]+),([\d.-]+) ([\d.-]+),([\d.-]+) ([\d.-]+),([\d.-]+)/g)].map((m) => m.slice(1).map(Number));
  ok(segs.length === xy.length - 1, 'one curve between each two matches', `${segs.length} curves`);
  let worst = 0;
  segs.forEach((s, i) => {
    const [y0, y3] = [xy[i][1], xy[i + 1][1]];
    const lo = Math.min(y0, y3), hi = Math.max(y0, y3);
    for (let t = 0; t <= 1.0001; t += 0.02) {
      const u = 1 - t;
      const y = u * u * u * y0 + 3 * u * u * t * s[1] + 3 * u * t * t * s[3] + t * t * t * s[5];
      worst = Math.max(worst, lo - y, y - hi);
    }
  });
  ok(worst <= 0.01, 'between any two matches the curve stays within their two grades', `overshoot ${worst.toFixed(3)}`);
  ok(TC.smoothPath([[0, 10], [10, 20]]) === 'M0,10 L10,20', 'two matches are a straight line');
  ok(TC.smoothPath([[0, 10]]) === '', 'and one is no line');
}

console.log('\nthe range it plots:');
{
  ok(TC.domain([71, 88, 64]).lo === 50 && TC.domain([71, 88, 64]).hi === 100, 'up to 100, and down to 50 for grades in the 60s');
  ok(TC.domain([44, 80]).lo === 40 && TC.domain([31]).lo === 20, 'a ten under the lowest grade for a low one');
  ok(TC.domain([2]).lo === 0, 'never under 0');
}

console.log('\nthe foot is days, never times, and never runs together:');
{
  const now = new Date(2026, 10, 28, 22, 0).getTime();
  ok(TC.dayWord(now - HOUR, now) === 'Today' && TC.dayWord(now - DAY, now) === 'Yesterday', 'Today and Yesterday');
  ok(/^[A-Za-z]{3} \d{1,2}$/.test(TC.dayWord(now - 3 * DAY, now)), 'else the short date', TC.dayWord(now - 3 * DAY, now));
  ok(/^Today, \d{1,2}:\d{2}\s?[AP]M$/.test(TC.whenWord(now - HOUR, now)), 'the tooltip has the time: "Today, 9:00 PM"', TC.whenWord(now - HOUR, now));
  const x = (i) => 30 + i * 40;
  // Eight matches one evening: one label, the day, not eight times.
  const evening = Array.from({ length: 8 }, (_, i) => ({ grade: 70, at: now - (8 - i) * 25 * 60000 }));
  const one = TC.footLabels(evening, x, 400, now);
  ok(one.length === 1 && one[0].text === 'Today', 'one evening of matches is labelled once, by its day', JSON.stringify(one));
  ok(Math.abs(one[0].x - (x(0) + x(7)) / 2) < 0.5, 'centred under that day\'s matches');
  // Twenty matches over ten days, two a day, at 22px apart: labels thinned.
  const tight = (i) => 30 + i * 22;
  const days = Array.from({ length: 20 }, (_, i) => ({ grade: 70, at: now - Math.floor((19 - i) / 2) * DAY - (i % 2) * HOUR }));
  const many = TC.footLabels(days, tight, 30 + 19 * 22 + 18, now);
  const half = (l) => (l.text.length * 6.2) / 2;
  ok(many.length >= 3 && many.length < 10, 'ten days in a narrow chart keep some of their labels, not all', JSON.stringify(many.map((l) => l.text)));
  ok(many.every((l, i) => !many[i + 1] || l.x + half(l) + 14 <= many[i + 1].x - half(many[i + 1]) + 0.5), 'no two labels touch');
  ok(many[many.length - 1].text === 'Today', 'the newest day is always labelled');
  ok(many.every((l) => !/\d:\d\d/.test(l.text)), 'and no label is a time of day');
  ok(new Set(many.map((l) => l.text)).size === many.length, 'no day is said twice');
}

/** A chart drawn in the Matches page's own document, which loads the module. */
async function page(opts) {
  const o = opts || {};
  const m = loadSurface('matches', {
    handlers: {
      [C.STATE_GET]: () => ({ gameId: 'valorant' }),
      [C.REVIEWS_LIST]: () => [],
      [C.PATTERNS_GET]: () => ({ matches: 0, enough: false, grades: [], categories: [], average: null, mistakes: [], strengths: [], missed: [] }),
    },
    window: { location: { hash: '', search: '?embed=1&section=list' },
      matchMedia: (q) => ({ matches: !!o.reduce && /prefers-reduced-motion: reduce/.test(q), addEventListener() {}, addListener() {} }) },
  });
  await settle();
  return m;
}

const NOW = new Date(2026, 10, 28, 22, 0).getTime();
const pts = [
  { id: 'a', grade: 64, at: NOW - 3 * DAY, agent: 'Jett', map: 'Split', result: 'Defeat', scoreline: '9 : 13' },
  { id: 'b', grade: 71, at: NOW - 2 * DAY, agent: 'Jett', map: 'Abyss', result: 'Victory', scoreline: '13 : 11', delta: 7, provisional: true },
  { id: 'c', grade: 84, at: NOW - 2 * HOUR, agent: 'Sova', map: 'Bind', result: 'Victory', scoreline: '13 : 7', delta: 13 },
];

(async () => {
  console.log('\nthe chart, drawn:');
  {
    const m = await page();
    const host = m.document.createElement('div');
    m.document.body.append(host);
    host.getBoundingClientRect = () => ({ left: 0, top: 0, width: 900, height: 180, right: 900, bottom: 180 });
    const opened = [];
    const chart = m.window.TrendChart.draw(host, pts, { average: 73, label: 'Grade over your last 3 graded matches', now: NOW, onOpen: (p) => opened.push(p.id) });
    const svg = host.querySelector('svg.tc-svg');
    ok(svg && svg.getAttribute('width') === '900', 'drawn in its own pixels at the host\'s width', svg && svg.getAttribute('width'));
    ok(host.querySelectorAll('.tc-dot').length === 3 && host.querySelector('.tc-dot.now') && host.querySelector('.tc-dot.prov'),
      'a dot a match, the newest brighter, a provisional one dashed');
    ok(host.querySelector('.tc-now-label').textContent === '84', 'the newest grade over its dot');
    ok(host.querySelector('.tc-avg-label').textContent === 'avg 73', 'the average dashed and labelled');
    ok(host.querySelector('.tc-fill .tc-area') && host.querySelector('.tc-line').getAttribute('pathLength') === '1', 'the area on its own layer, the line ready to draw');
    const guides = host.querySelectorAll('.tc-guide-label').map((t) => t.textContent);
    ok(JSON.stringify(guides) === '["60","70","80","90"]', 'the guides at 60, 70, 80 and 90', JSON.stringify(guides));
    const foot = host.querySelectorAll('.tc-foot-label').map((t) => t.textContent);
    ok(foot[foot.length - 1] === 'Today' && foot.every((t) => !/\d:\d\d/.test(t)), 'the foot says the days', JSON.stringify(foot));
    ok(host.getAttribute('tabindex') === '0' && host.getAttribute('role') === 'group' && host.getAttribute('aria-roledescription') === 'chart',
      'it takes the keyboard, as a chart');
    ok(host.getAttribute('aria-label') === 'Grade over your last 3 graded matches, oldest first, from 64 to 84. Average 73. Use the left and right arrow keys to read each match, and Enter to open it.',
      'a screen reader is told what it is and how to read it', host.getAttribute('aria-label'));
    ok(!DASHES.test(host.getAttribute('aria-label')), 'no dash in it');

    // The keyboard: the first Left lands on the newest, then steps back.
    const key = (k) => host.dispatchEvent(makeEvent('keydown', { key: k }));
    key('ArrowLeft');
    ok(chart.active === 2 && !host.querySelector('.tc-tip').hidden && host.classList.contains('tc-active'), 'Left first lands on the newest match, its tooltip up');
    key('ArrowLeft');
    const live = host.querySelector('.tc-live').textContent;
    ok(chart.active === 1 && /Jett on Abyss\. Victory 13 : 11\. Grade 71, provisional, up 7\.$/.test(live), 'then the match before, read out', live);
    const tip = host.querySelector('.tc-tip');
    ok(tip.querySelector('.tc-tip-name').textContent === 'Jett on Abyss' && tip.querySelector('.tc-tip-num').textContent === '71'
      && tip.querySelector('.tc-tip-word').textContent === 'Grade, provisional' && tip.querySelector('.tc-tip-delta').textContent === '+7'
      && tip.querySelector('.tc-tip-res').classList.contains('win'), 'the tooltip: the agent and map, the result, the grade and its change');
    key('Home');
    ok(chart.active === 0, 'Home goes to the oldest');
    key('End');
    key('Enter');
    ok(JSON.stringify(opened) === '["c"]', 'Enter opens the match under it', JSON.stringify(opened));
    key('Escape');
    ok(chart.active === -1 && host.querySelector('.tc-tip').hidden, 'Escape lets go');

    // Drawn once, then still.
    chart.play();
    ok(host.classList.contains('tc-play'), 'play() draws it');
    m.clock.advance(TC.DRAW_MS + 800);
    ok(!host.classList.contains('tc-play'), 'and the class comes off once it has drawn');

    // A new width is drawn again; under two matches nothing is.
    host.getBoundingClientRect = () => ({ left: 0, top: 0, width: 600, height: 180, right: 600, bottom: 180 });
    m.resized(host);
    ok(host.querySelector('svg.tc-svg').getAttribute('width') === '600', 'a new width draws it again');
    chart.set([pts[0]]);
    ok(!host.querySelector('svg.tc-svg') && host.classList.contains('tc-empty'), 'one match draws no line');
    chart.destroy();
    ok(!host.classList.contains('tc') && !host.children.length, 'destroy() takes it all away');
  }

  console.log('\nless motion:');
  {
    const m = await page({ reduce: true });
    const host = m.document.createElement('div');
    m.document.body.append(host);
    const chart = m.window.TrendChart.draw(host, pts, {});
    chart.play();
    ok(!host.classList.contains('tc-play'), 'asked for less motion, it does not draw itself, it is there');
  }

  console.log('\nthe stylesheet:');
  {
    const fs = require('fs');
    const path = require('path');
    const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'shared', 'trend-chart.css'), 'utf8');
    ok(css.split(/\r?\n/)[0].trim() === '/* palette: tokens only */', 'tokens only, by its first line');
    ok(!/infinite/.test(css), 'nothing runs forever, so nothing runs while a match is recorded');
    ok(!/--accent|--btn\b|--signal/.test(css.replace(/\/\*[\s\S]*?\*\//g, '')), 'no accent: the keyboard\'s ring is the global one');
    ok(/prefers-reduced-motion: reduce/.test(css), 'and less motion is honoured');
  }

  console.log(fails ? `\n${fails} FAILED` : '\nall passed');
  process.exit(fails ? 1 : 0);
})();

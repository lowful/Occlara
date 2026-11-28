'use strict';

/**
 * THE MATCHES PAGE, 9.1 (the owner's items 5, 11, 15, 18 and 21), run in
 * node against its real markup, scripts and preload (scripts/fixtures/
 * fake-dom.js):
 *
 *   5   no "Grade my recent matches"; Import a recording in the page head
 *       with an upload icon, Valorant's list page alone
 *   11  a row is six things (portrait, agent and map, date, result and score,
 *       grade, change) and the rest is in its peek; a row with no grade
 *       says why; a mistake title inside a line is lower cased
 *   15  the grade trend across the top; when you play best, with its counts,
 *       and how many more below the threshold
 *   18  a row's menu, Delete match through MATCH_DELETE after a confirm
 *       that says what goes
 *   21  the trend is the shared chart (trend-chart.js)
 *
 * Run: npm run test:matchespage
 */
const fs = require('fs');
const path = require('path');
const { loadSurface, settle, makeEvent } = require('./fixtures/fake-dom');
const C = require('../src/shared/channels');
const { manyRows } = require('./fixtures/many-matches');

const ROOT = path.join(__dirname, '..');
const DIR = path.join(ROOT, 'src', 'renderer', 'matches');
let fails = 0;
const ok = (cond, what, detail) => {
  if (!cond) { fails++; console.log(`FAIL  ${what}${detail ? `\n        ${detail}` : ''}`); }
  else console.log(`ok    ${what}`);
};
const DASHES = /[\u2013\u2014]/;
process.on('unhandledRejection', (e) => { fails++; console.log(`FAIL  a promise was rejected\n        ${(e && e.stack) || e}`); });

const EMPTY_PATTERNS = { matches: 0, enough: false, grades: [], categories: [], average: null, mistakes: [], strengths: [], missed: [] };
const HOUR = 3600000;
const DAY = 24 * HOUR;
const NOW = Date.now();

async function open(opts) {
  const o = opts || {};
  const m = loadSurface('matches', {
    handlers: {
      [C.STATE_GET]: () => ({ gameId: o.game || 'valorant' }),
      [C.CONFIG_GET]: () => ({ riotId: o.riotId || '' }),
      [C.REVIEWS_LIST]: () => (o.list ? o.list() : o.rows || []),
      [C.PATTERNS_GET]: () => o.patterns || EMPTY_PATTERNS,
      [C.BACKFILL_STATUS]: () => o.backfill || null,
      [C.MATCH_DELETE]: o.del || (() => ({ ok: true })),
      [C.REVIEWS_RR]: () => o.rr || {},
    },
    window: { location: { hash: '', search: `?embed=1&section=${o.section || 'list'}` },
      matchMedia: (q) => ({ matches: /prefers-reduced-motion: reduce/.test(q), addEventListener() {}, addListener() {} }) },
  });
  await settle(10);
  return m;
}
const row = (over) => ({ id: `valorant-${NOW}-r`, game: 'valorant', at: NOW - HOUR, title: 'Jett', map: 'Split', mode: 'Competitive',
  result: 'Victory', score: '13-11', grade: { score: 84, provisional: false }, verified: true, matchId: 'm1', aiLog: 'kept', work: null, ...over });

(async () => {
  console.log('\nitem 5, the head:');
  {
    const html = fs.readFileSync(path.join(DIR, 'index.html'), 'utf8');
    const js = fs.readFileSync(path.join(DIR, 'matches.js'), 'utf8');
    ok(!/Grade my recent matches/.test(html) && !/Grade my recent matches'/.test(js) && !/bf-go/.test(html + js) && !/startBackfill\(/.test(js),
      'no "Grade my recent matches", no button and no call to start one');
    const m = await open({ rows: [row()] });
    const go = m.$('imp-go');
    ok(go && go.closest('header') && go.parentNode.classList.contains('h-actions'), 'Import a recording is in the page head, among its actions');
    ok(go && !go.hidden && go.querySelector('svg.imp-ico') && go.textContent.trim() === 'Import a recording', 'with its upload icon and its words');
    const lol = await open({ game: 'lol', rows: [] });
    ok(lol.$('imp-go').hidden, 'not for League');
    const pat = await open({ section: 'patterns', rows: [row()] });
    ok(pat.$('imp-go').hidden, 'and not on Patterns, where its panel is not drawn');
  }

  console.log('\nitem 5, a run grading recent matches is one line, never a button:');
  {
    const run = { state: 'grading', account: 'Me#EUW', message: "Grading your recent matches from Riot's record: 2 of 10." };
    const m = await open({ riotId: 'Me#EUW', backfill: run, rows: [row()] });
    ok(!m.$('bf').hidden && m.$('bf-status').textContent === run.message && m.$('bf').classList.contains('busy'), 'a run for the Riot ID in Settings shows its line');
    ok(!m.$('bf').querySelector('button'), 'and no button');
    const other = await open({ riotId: 'New#EUW', backfill: run, rows: [row()] });
    ok(other.$('bf').hidden, "another Riot ID's run says nothing here");
    const none = await open({ riotId: 'Me#EUW', rows: [row()] });
    ok(none.$('bf').hidden, 'and with no run there is no line');
  }

  console.log('\nitem 11, a row is six things, the rest one step away:');
  {
    const rows = [
      row({ id: 'n', at: NOW - HOUR, topMistake: 'Dying in the first 30 seconds', rating: { value: 8.3, shown: '83' } }),
      row({ id: 'o', at: NOW - 2 * DAY, title: 'Sova', map: 'Bind', result: 'Defeat', score: '7-13', grade: { score: 65 } }),
    ];
    const marks = { n: [{ kind: 'best', text: 'Best in 4' }, { kind: 'cleared', text: '3 without dying in the first 30 seconds' }] };
    const m = await open({ rows, patterns: { ...EMPTY_PATTERNS, progress: { marks } }, rr: { n: { text: 'RR +18', tone: 'gain', title: 'RR this match moved' } } });
    const items = m.document.querySelectorAll('#list .m-item');
    const first = items[0];
    const b = first.querySelector('.m-row');
    const txt = (sel, n) => { const e = (n || first).querySelector(sel); return e ? e.textContent : null; };
    ok(b.querySelector('.m-face') && txt('.m-title', b) === 'Jett on Split' && /^Today, /.test(txt('.m-when', b)),
      'the portrait, the agent and the map, the date', `${txt('.m-title', b)} | ${txt('.m-when', b)}`);
    ok(txt('.m-res', b) === 'Victory 13 : 11' && b.querySelector('.m-res').classList.contains('win'), 'the result and the score, in its tone');
    ok(txt('.m-score', b) === '84' && b.querySelector('.m-score').classList.contains('good'), 'the grade, its number in its band\'s tone');
    ok(txt('.m-delta', b) === '+19' && b.querySelector('.m-delta').classList.contains('up'), 'its change on the match before', txt('.m-delta', b));
    ok(txt('.m-delta', items[1].querySelector('.m-row')) === 'First', 'the oldest graded is the first');
    ok(!b.querySelector('.m-meta, .m-top-mistake, .m-mark, .m-rr'), 'nothing else in the row itself');
    const peek = first.querySelector('.m-peek');
    ok(peek && peek.getAttribute('role') === 'tooltip' && b.getAttribute('aria-describedby') === peek.id, 'the rest is the row\'s peek, its description');
    ok(txt('.m-meta', peek) === "Competitive  ·  Checked against Riot's record" && txt('.m-top-mistake', peek) === 'Dying in the first 30 seconds',
      'the peek: the queue, where the grade came from, the top mistake', txt('.m-meta', peek));
    ok(JSON.stringify(peek.querySelectorAll('.m-mark').map((x) => x.textContent)) === '["Best in 4","3 without dying in the first 30 seconds"]',
      'the milestones, a mistake title inside them lower cased');
    ok(/Match rating/.test(peek.textContent) && /83/.test(txt('.m-rating', peek)), 'the match rating by its name, on the 100 scale');
    ok(!first.querySelector('.m-rr-fact').hidden && txt('.m-rr', peek) === '+18' && peek.querySelector('.m-rr').classList.contains('gain'), 'the RR, once main answers');
    ok(items[1].querySelector('.m-rr-fact').hidden, 'and none where it has none');
    const label = b.getAttribute('aria-label');
    ok(/^Jett on Split, Today, .+, Victory 13 : 11, grade 84, \+19 on the match before, top mistake dying in the first 30 seconds$/.test(label),
      'a screen reader hears the row as one line, the title inside it lower cased', label);
    ok(!DASHES.test(first.textContent + label), 'no dash anywhere in a row');
  }

  console.log('\nitem 11, a row with no grade says why:');
  {
    const rows = [
      row({ id: 'part', title: null, map: 'Haven', result: null, score: null, grade: null }),
      row({ id: 'lock', grade: null, locked: true, result: 'Defeat', score: '9-13' }),
      row({ id: 'stop', grade: null, stoppedLive: true, result: null, score: '4-3' }),
      row({ id: 'imp', grade: null, imported: true, matchId: null, verified: false }),
      row({ id: 'thin', grade: null }),
      row({ id: 'chk', work: { path: 'riot' } }),
    ];
    const m = await open({ rows });
    const by = (id) => m.document.querySelectorAll('#list .m-item').find((it) => it.dataset.id === id);
    const why = (id) => { const w = by(id).querySelector('.m-why'); return w ? [w.textContent, w.title] : [null, null]; };
    ok(why('part')[0] === 'Too little read to grade' && /never on screen long enough/.test(why('part')[1]), 'too little of it read', why('part').join(' | '));
    ok(why('lock')[0] === 'No games left, not graded' && by('lock').querySelector('.m-res').textContent === 'Defeat 9 : 13', 'saved with no games left, its result still shown');
    ok(why('stop')[0] === 'Stopped early, not graded', 'stopped before the end');
    ok(why('imp')[0] === "Not matched to Riot's record", 'an import not matched');
    ok(why('thin')[0] === 'Not enough measured to grade', 'else, not enough measured');
    ok(['part', 'lock', 'stop', 'imp', 'thin'].every((id) => by(id).querySelector('.m-score').textContent === '--' && by(id).classList.contains('ungraded')
      && /not graded/.test(by(id).querySelector('.m-row').getAttribute('aria-label'))), 'each with -- for its grade, and said to a screen reader');
    ok(by('chk').querySelector('.m-grade .gv-checking') && !by('chk').querySelector('.m-why'), 'one still being checked has its pill, no reason');
    ok(['part', 'lock', 'stop', 'imp', 'thin'].every((id) => by(id).querySelector('.m-peek-note')), 'and each peek says the long reason');
    // 9.1: a row with no agent read shows its map in the circle, never an
    // empty grey circle that reads as a picture that failed.
    const pf = by('part').querySelector('.m-face');
    ok(pf && pf.tagName === 'IMG' && pf.classList.contains('map') && /maps\//.test(String(pf.src || pf.getAttribute('src') || '')), "no agent read: the map's picture in the face", pf && `${pf.className} ${pf.src}`);
    const nowhere = await open({ rows: [row({ id: 'nw', title: null, map: 'Nowhere', result: null, score: null, grade: null })] });
    const nf = nowhere.document.querySelector('#list .m-face');
    ok(nf && nf.classList.contains('blank') && nf.querySelector('svg'), 'and with no map picture either, a quiet pin', nf && nf.className);
  }

  console.log('\nitem 11, a League row, which keeps no result:');
  {
    const lol = await open({ game: 'lol', rows: [row({ id: 'l1', game: 'lol', title: 'Ahri', map: "Summoner's Rift", mode: 'Ranked Solo', result: null, score: null, grade: { score: 72 } })] });
    const r = lol.document.querySelector('#list .m-item .m-row');
    const res = r.querySelector('.m-result .m-res');
    ok(res && res.textContent === 'Ranked Solo' && res.classList.contains('quiet'), 'its queue stands quietly where the result would be, never an empty column', res && res.textContent);
    ok(r.querySelector('.m-score').textContent === '72', 'and its grade beside it');
    const why = await open({ game: 'lol', rows: [row({ id: 'l2', game: 'lol', title: 'Ahri', map: "Summoner's Rift", mode: 'Ranked Solo', result: null, score: null, grade: null })] });
    const w = why.document.querySelector('#list .m-why');
    ok(w && w.textContent === 'Not enough measured to grade' && /this game/.test(w.title) && !/score was never on screen/.test(w.title),
      "an ungraded League row is never told its score was not on screen, a Valorant reason", w && w.title);
  }

  console.log('\nitem 18, a row\'s menu and Delete match, asked first:');
  {
    const asked = [];
    let answer = { ok: true, id: 'b' };
    const rows = [row({ id: 'a' }), row({ id: 'b', title: 'Sova', map: 'Bind', at: NOW - DAY, imported: true }), row({ id: 'c', work: { path: 'riot' } })];
    const gone = new Set();
    const m = await open({ rows, list: () => rows.filter((r) => !gone.has(r.id)), del: (id) => { asked.push(id); if (answer.ok) gone.add(id); return answer; } });
    const item = (id) => m.document.querySelectorAll('#list .m-item').find((it) => it.dataset.id === id);
    const more = item('b').querySelector('.m-more');
    ok(more && more.getAttribute('aria-haspopup') === 'menu' && more.getAttribute('aria-label') === 'More for Sova on Bind', 'each row has a named menu button');
    ok(!item('b').querySelector('.m-row .m-more'), 'beside the row, never inside it');
    more.dispatchEvent(makeEvent('click', { detail: 0 }));
    const menu = m.$('m-menu');
    const words = () => menu.querySelectorAll('.m-menu-item').map((x) => x.textContent);
    ok(!menu.hidden && more.getAttribute('aria-expanded') === 'true' && JSON.stringify(words()) === '["Open review","Open AI log","Delete match"]',
      'it opens on Open review, Open AI log and Delete match', JSON.stringify(words()));
    ok(menu.getAttribute('role') === 'menu' && menu.querySelectorAll('[role="menuitem"]').length === 3, 'a menu of menu items');
    ok(m.document.activeElement === menu.querySelector('.m-menu-item'), 'from the keyboard, the first item has it');
    menu.dispatchEvent(makeEvent('keydown', { key: 'Escape' }));
    ok(menu.hidden && m.document.activeElement === more && more.getAttribute('aria-expanded') === 'false', 'Escape closes it, back on its button');
    item('c').querySelector('.m-more').click();
    ok(!words().includes('Delete match'), 'a match still being checked cannot be deleted');
    m.document.body.click();
    ok(menu.hidden, 'a click elsewhere closes it');

    more.click();
    menu.querySelector('[data-action="delete"]').click();
    const box = m.$('m-confirm');
    ok(!box.hidden && menu.hidden, 'Delete match asks first');
    ok(m.$('m-confirm-title').textContent === 'Delete this match?' && /^Sova on Bind, Victory 13 : 11, Yesterday, /.test(m.$('m-confirm-what').textContent),
      'naming the match', m.$('m-confirm-what').textContent);
    ok(m.$('m-confirm-body').textContent === 'Its review, its clips and its frames are deleted from this PC. This cannot be undone. Your video file is kept, and the game it used is not given back.',
      'and what goes: the review, its clips and its frames; an import\'s video stays', m.$('m-confirm-body').textContent);
    ok(m.document.activeElement === m.$('m-confirm-keep') && m.$('m-confirm-keep').textContent === 'Keep it', 'Keep it has the keyboard');
    box.querySelector('.m-confirm-card') && box.dispatchEvent(makeEvent('keydown', { key: 'Escape' }));
    ok(box.hidden && !asked.length, 'Escape keeps it, and nothing is asked of main');

    answer = { ok: false, error: 'working' };
    more.click();
    menu.querySelector('[data-action="delete"]').click();
    m.$('m-confirm-go').click();
    await settle();
    ok(JSON.stringify(asked) === '["b"]', 'Delete match sends the review\'s id alone over MATCH_DELETE', JSON.stringify(asked));
    ok(!box.hidden && !m.$('m-confirm-error').hidden && m.$('m-confirm-error').textContent === 'This review is still being written. Try again in a minute.',
      'a refusal is said in the dialog, which stays');
    ok(!m.$('m-confirm-go').disabled && m.$('m-confirm-go').textContent === 'Delete match', 'and the button is back');
    answer = { ok: true, id: 'b' };
    const lists = m.bridge.invoked.filter((x) => x[0] === C.REVIEWS_LIST).length;
    m.$('m-confirm-go').click();
    await settle();
    ok(box.hidden && !item('b'), 'deleted, the dialog closes and the row is gone');
    ok(m.bridge.invoked.filter((x) => x[0] === C.REVIEWS_LIST).length > lists, 'and the list is read again');
    const js = fs.readFileSync(path.join(DIR, 'matches.js'), 'utf8');
    ok(!/deleteImport\(/.test(js), 'an import is deleted the same way, no second delete of its own');
  }

  console.log('\nitem 18, main\'s own push for a delete waits for the fold, and the keyboard lands on the next row:');
  {
    // As main does (index.js deleteMatch): PUSH_REVIEWS { removed } goes out
    // inside MATCH_DELETE, before its answer reaches the page.
    const rows = [row({ id: 'a' }), row({ id: 'b', title: 'Sova', map: 'Bind', at: NOW - DAY }), row({ id: 'c', title: 'Omen', map: 'Lotus', at: NOW - 2 * DAY })];
    const gone = new Set();
    let m = null;
    let listedDuring = -1;
    m = await open({ rows, list: () => rows.filter((r) => !gone.has(r.id)),
      del: (id) => {
        gone.add(id);
        m.bridge.emit(C.PUSH_REVIEWS, { id, game: 'valorant', removed: true });
        listedDuring = m.bridge.invoked.filter((x) => x[0] === C.REVIEWS_LIST).length;
        return { ok: true, id };
      } });
    const lists = () => m.bridge.invoked.filter((x) => x[0] === C.REVIEWS_LIST).length;
    const before = lists();
    const item = (id) => m.document.querySelectorAll('#list .m-item').find((it) => it.dataset.id === id);
    item('b').querySelector('.m-more').click();
    m.$('m-menu').querySelector('[data-action="delete"]').click();
    m.$('m-confirm-go').click();
    await settle(10);
    ok(listedDuring === before, 'the push that lands while the delete is asked paints nothing yet', `${listedDuring} vs ${before}`);
    ok(lists() === before + 1, 'and the list is read once, after it, not twice', `${lists() - before} reads`);
    ok(!item('b') && item('a') && item('c'), 'the row is gone and the others stay');
    const fe = m.document.activeElement;
    ok(fe && fe.classList && fe.classList.contains('m-row') && fe.closest('.m-item').dataset.id === 'c',
      'the keyboard is on the row now in its place, never dropped to the page', fe ? `${fe.tagName}.${fe.className} ${fe.closest && fe.closest('.m-item') ? fe.closest('.m-item').dataset.id : ''}` : 'none');
    // The last row deleted: the keyboard goes to the one before it.
    item('c').querySelector('.m-more').click();
    m.$('m-menu').querySelector('[data-action="delete"]').click();
    m.$('m-confirm-go').click();
    await settle(10);
    const fe2 = m.document.activeElement;
    ok(fe2 && fe2.closest && fe2.closest('.m-item') && fe2.closest('.m-item').dataset.id === 'a', 'the last row deleted, the one before it takes the keyboard');
  }

  console.log('\nitems 15 and 21, the grade trend across the top:');
  {
    const rows = [];
    for (let i = 0; i < 24; i++) rows.push(row({ id: `g${i}`, at: NOW - i * 9 * HOUR, grade: { score: 60 + (i % 7) * 4, provisional: i === 3 } }));
    rows.splice(2, 0, row({ id: 'w', at: NOW, work: { path: 'riot' } }));
    const m = await open({ rows });
    const box = m.$('m-chart');
    ok(!box.hidden && box.querySelector('.tc svg'), 'the list page draws it, as the shared chart');
    ok(m.$('m-chart-n').textContent === '20' && box.querySelectorAll('.tc-dot').length === 20, 'over the last 20 graded matches, one still being checked left out');
    ok(m.$('m-chart-big').textContent === '60' && m.$('m-chart-best').textContent === '84', 'the latest and the best of them');
    const pts = rows.filter((r) => !r.work).slice(0, 20);
    const finals = pts.filter((r) => !r.grade.provisional);
    const avg = Math.round(finals.reduce((a, r) => a + r.grade.score, 0) / finals.length);
    ok(m.$('m-chart-avg').textContent === String(avg) && box.querySelector('.tc-avg-label').textContent === `avg ${avg}`,
      'the average of the same matches, a provisional grade left out, on the chart as well', `${m.$('m-chart-avg').textContent} vs ${avg}`);
    ok(box.querySelectorAll('.tc-foot-label').every((t) => !/\d:\d\d/.test(t.textContent)), 'the foot is days, never times of day');
    ok(/^Grade over your last 20 graded matches, oldest first/.test(box.querySelector('.tc').getAttribute('aria-label')), 'named for a screen reader');
    const opened = m.bridge.sent.filter((s) => s[0] === C.REVIEW_OPEN).length;
    const host = box.querySelector('.tc');
    host.dispatchEvent(makeEvent('keydown', { key: 'End' }));
    host.dispatchEvent(makeEvent('keydown', { key: 'Enter' }));
    const sent = m.bridge.sent.filter((s) => s[0] === C.REVIEW_OPEN);
    ok(sent.length === opened + 1 && sent[sent.length - 1][1] === 'g0', 'Enter on a match opens its review');
    const pat = await open({ section: 'patterns', rows });
    ok(pat.$('m-chart').hidden, 'not on Patterns');
    const one = await open({ rows: [row()] });
    ok(one.$('m-chart').hidden, 'and not under two grades');
  }

  console.log('\nitem 15, when you play best:');
  {
    const eveningOf = (days) => { const s = new Date(NOW - days * DAY); s.setHours(20, 10, 0, 0); return s.getTime(); };
    const few = await open({ rows: [row({ id: 'a', at: eveningOf(1) + 2400000, matchStartedAt: eveningOf(1) }), row({ id: 'b', at: eveningOf(2) + 2400000, matchStartedAt: eveningOf(2) })] });
    ok(!few.$('when').hidden && few.$('when-calls').hidden && !few.$('when-progress').hidden, 'below the threshold: no best or worst, a progress line');
    ok(/^Shows after at least 8 more graded matches, with 4 or more at each of two times of day\. Both so far started between .+\.$/.test(few.$('when-note').textContent),
      'saying how many more it needs at the least, and why', few.$('when-note').textContent);
    ok(few.$('when-title').textContent === 'When you play' && few.$('when').classList.contains('counting'),
      'named for what it counts, never "Best time to play" before a best time is known, and quiet', few.$('when-title').textContent);
    ok(few.$('when-fig').hidden && !few.$('when-hours').querySelector('.when-col'), 'and no columns over nothing to compare');
    // The evening player: a second time of day is what is missing, said so.
    const evenings = [];
    for (let i = 0; i < 14; i++) {
      const s = new Date(NOW - (i + 1) * DAY);
      s.setHours(20, 10, 0, 0);
      evenings.push(row({ id: `e${i}`, at: s.getTime() + 2400000, matchStartedAt: s.getTime() }));
    }
    const eve = await open({ rows: evenings });
    ok(eve.$('when-note').textContent === 'Shows once a second time of day has 4 graded matches. All 14 so far started between 6 PM and 9 PM.',
      'fourteen evenings: what is missing is a second time of day, never "4 more" that more evenings would not bring down', eve.$('when-note').textContent);
    const bar = eve.$('when-progress');
    ok(bar.getAttribute('aria-valuenow') === '0' && bar.getAttribute('aria-valuemax') === '4' && /second time of day/.test(bar.getAttribute('aria-label')),
      'its progress counts the second time of day', `${bar.getAttribute('aria-valuenow')} of ${bar.getAttribute('aria-valuemax')}`);
    const many = await open({ rows: manyRows(NOW) });
    const P = require('../src/shared/play-times');
    const r = P.playTimes(manyRows(NOW));
    ok(!many.$('when-calls').hidden && many.$('when-best').textContent === r.text.best.label && many.$('when-worst').textContent === r.text.worst.label,
      'with enough, the best and the worst time to play', `${many.$('when-best').textContent} / ${many.$('when-worst').textContent}`);
    ok(many.$('when-best-line').textContent === r.text.best.line && /^Average grade \d+ over \d+ matches, won \d+ of \d+/.test(many.$('when-best-line').textContent),
      'each with its average, its count and its wins', many.$('when-best-line').textContent);
    const cols = many.$('when-hours').querySelectorAll('.when-col');
    ok(cols.length === 8 && cols.filter((c) => c.classList.contains('best')).length === 1 && cols.filter((c) => c.classList.contains('worst')).length === 1,
      'eight times of day, one best, one worst');
    ok(cols.every((c, i) => c.querySelector('.when-n').textContent === (r.slots[i].n ? String(r.slots[i].n) : '')), 'each with how many matches started in it');
    const thin = cols.filter((c) => c.classList.contains('thin'));
    ok(thin.length && thin.every((c) => /Too few to compare: compared once 4 are graded here/.test(c.title)), 'a thin one says it is not compared');
    ok(thin.every((c) => !c.querySelector('.when-avg') && c.style.getPropertyValue('--h') === '9%'),
      'and stands as a short stub with no number over it, never at its average like a time compared', thin.map((c) => c.style.getPropertyValue('--h')).join(','));
    ok(cols.filter((c) => c.classList.contains('compared')).every((c) => c.querySelector('.when-avg')), 'a time compared carries its average');
    ok(many.$('when-title').textContent === r.text.title && !many.$('when').classList.contains('counting') && !many.$('when-fig').hidden,
      'with enough, the card is titled by what it found, its columns drawn', many.$('when-title').textContent);
    ok(/^Average grade by the time of day each match started: /.test(many.$('when-hours').getAttribute('aria-label')), 'read out as a whole');
    const none = await open({ rows: [row({ grade: null })] });
    ok(none.$('when').hidden, 'and nothing with no graded match');
  }

  console.log(fails ? `\n${fails} FAILED` : '\nall passed');
  process.exit(fails ? 1 : 0);
})();

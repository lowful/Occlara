'use strict';

/**
 * test:clipspage. THE CLIPS PAGE, 9.1 (the owner's items 12, 13 and 18), on
 * the fuller sample library (fixtures/clips-demo.js: the real Abyss match laid
 * out as six matches) and on made up moments:
 *
 *   - the ONE hero is main's pick (moments.js bestOf): the kept highlight
 *     worth the most from the last ten matches, the newer of two alike, else
 *     a death of the most repeated mistake, else the newest death, and none
 *     with no clip kept; the page draws exactly one, its clip muted and
 *     looping, and plays it in the player when pressed;
 *   - the filters by kind, map, agent, result and repeated mistake, a chip and
 *     the mistake dropdown one state, and Clear filters;
 *   - a kept clip's menu: Open file location and Delete clip by the review's
 *     id and the clip's name (never a path), the delete asking first, its
 *     safe answer holding the keyboard, Esc keeping the clip, main's
 *     refusals said in words;
 *   - Storage: the pill, the card's four parts, the clips against the limit,
 *     the drive too full to record, and nothing at all when main says null;
 *   - the play mark's centroid on its circle's centre, and the page scrolls
 *     as one so nothing is cut by an edge that stays put.
 *
 * Pure node: the page runs in the fake DOM (fixtures/fake-dom.js).
 */
const fs = require('fs');
const path = require('path');
const C = require('../src/shared/channels');
const moments = require('../src/shared/moments');
const demo = require('./fixtures/clips-demo');
const { loadSurface, settle } = require('./fixtures/fake-dom');

let checks = 0;
let fails = 0;
function ok(cond, msg, detail) {
  checks++;
  if (cond) console.log(`ok    ${msg}`);
  else { fails++; console.log(`FAIL  ${msg}${detail !== undefined ? `\n        ${detail}` : ''}`); }
}
const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
// The two dashes the house rules ban, as escapes so this file carries neither.
const DASHES = new RegExp('[\\u2013\\u2014]');
const GB = 1024 * 1024 * 1024;

(async () => {
  // ── bestOf, on made up moments ───────────────────────────────────────────
  const T0 = Date.UTC(2026, 10, 20, 20);
  const clip = (name) => ({ url: `occlara-clip://review/x/${name}`, name, death: 11000, frames: null });
  const hl = (id, n, kills, extra) => ({ kind: 'highlight', id, round: n, key: `${id}:h${n}`, title: `${kills}K`, line: `${kills} kills in the round`,
    kills, vs: null, clip: clip(`h${n}-clip.mkv`), repeats: [], ...(extra || {}) });
  const death = (id, n, repeats, withClip) => ({ kind: 'death', id, round: n, key: `${id}:r${n}`, title: 'Caught alone', line: null,
    repeats: repeats || [], clip: withClip === false ? null : clip(`r${n}-clip.mkv`) });
  const match = (i, ms) => ({ id: `valorant-${T0 - i * 3600000}-t${i}`, at: T0 - i * 3600000, moments: ms });
  const id = (i) => `valorant-${T0 - i * 3600000}-t${i}`;

  let b = moments.bestOf([match(0, [hl(id(0), 3, 2), hl(id(0), 9, 4)]), match(1, [hl(id(1), 5, 3)])], []);
  ok(b && b.key === `${id(0)}:h9` && b.kind === 'highlight' && b.label === 'Your best recent clip' && b.line === 'The best highlight kept from your last 2 matches.',
    'the best recent clip is the kept highlight worth the most, a 4K over a 3K and a 2K', JSON.stringify(b));
  b = moments.bestOf([match(0, [hl(id(0), 4, 3)]), match(1, [hl(id(1), 7, 3)])], []);
  ok(b && b.key === `${id(0)}:h4`, 'of two alike, the newer match\'s', JSON.stringify(b));
  b = moments.bestOf([match(0, [hl(id(0), 2, 2, { vs: 2, title: '2K' })]), match(1, [hl(id(1), 7, 3)])], []);
  ok(b && b.key === `${id(0)}:h2` && moments.weightOf(hl('a', 1, 2, { vs: 2 })) === 45 && moments.weightOf(hl('a', 1, 5)) === 50,
    'a 2K that won a one against two (45) is worth more than a 3K (30), less than an ace (50)', JSON.stringify(b));
  b = moments.bestOf([match(0, [hl(id(0), 2, 4, { clip: null })]), match(1, [hl(id(1), 7, 2)])], []);
  ok(b && b.key === `${id(1)}:h7`, 'only a clip kept counts: a 4K with no clip is passed over', JSON.stringify(b));
  const across = [{ key: 'cause:isolated', title: 'Caught alone', across: true }];
  const comp = [{ key: 'untraded', title: 'Deaths nobody traded' }, { key: 'cause:isolated', title: 'Caught alone' }];
  b = moments.bestOf([match(0, [death(id(0), 2)]), match(1, [death(id(1), 6, across)])], comp);
  ok(b && b.key === `${id(1)}:r6` && b.kind === 'death' && b.label === 'Worth another look' && b.line === 'Caught alone, one of your repeated mistakes.',
    'no highlight clip: the newest kept death of the most repeated mistake that has one, worth another look', JSON.stringify(b));
  b = moments.bestOf([match(0, [death(id(0), 2)]), match(1, [death(id(1), 6)])], comp);
  ok(b && b.key === `${id(0)}:r2` && b.label === 'Your latest clip' && b.line === 'No highlight clip was kept from your last 2 matches.',
    'and with none of a pattern, the newest kept death, saying why', JSON.stringify(b));
  b = moments.bestOf([match(0, [death(id(0), 2)])], [], 'lol');
  ok(b && b.label === 'Your latest clip' && b.line === null, 'in League, which has no highlights to miss, no line under the latest clip', JSON.stringify(b));
  ok(moments.bestOf([match(0, [death(id(0), 2, [], false)])], []) === null && moments.bestOf([], []) === null, 'no clip kept: no hero at all');
  const eleven = Array.from({ length: 11 }, (_v, i) => match(i, i === 10 ? [hl(id(10), 4, 5)] : [death(id(i), 3, [], i === 0)]));
  b = moments.bestOf(eleven, []);
  ok(b && b.key === `${id(0)}:r3` && moments.RECENT === 10, 'recent is the last ten matches: an ace eleven matches back is not the hero', JSON.stringify(b));

  // ── The page, on the fuller library ──────────────────────────────────────
  const model = demo.model({ now: T0 });
  ok(model.best && model.best.kind === 'highlight' && model.matches.length === 6, 'main\'s model of the fuller library carries its best clip', JSON.stringify(model.best));
  let storageAnswer = demo.storage('some');
  let deleteAnswer = { ok: true, id: null, clip: null, bytes: 24 * 1024 * 1024 };
  let revealAnswer = { ok: true };
  const open = async (got, extra) => {
    const q = loadSurface('moments', { handlers: {
      [C.STATE_GET]: () => ({ gameId: 'valorant', isCoaching: false }),
      [C.SHELL_GET]: () => ({ page: 'moments', shown: 'moments', sealed: false, held: false }),
      [C.MOMENTS_GET]: () => got,
      [C.STORAGE_GET]: () => storageAnswer,
      [C.CLIP_DELETE]: () => deleteAnswer,
      [C.CLIP_REVEAL]: () => revealAnswer,
      ...(extra || {}),
    } });
    await settle();
    return q;
  };
  const q = await open(model);
  const $ = q.$;
  const D = q.document;
  const rows = () => D.querySelectorAll('#mo-list .mo-row');
  const sections = () => D.querySelectorAll('#mo-list .mo-match');

  // The hero: one, main's pick, its clip muted and looping.
  const cards = D.querySelectorAll('#mo-hero .mo-hcard');
  const best = model.matches.flatMap((m) => m.moments.map((x) => ({ ...x, m }))).find((x) => x.key === model.best.key);
  ok(!$('mo-hero').hidden && cards.length === 1 && cards[0].classList.contains('big') && cards[0].dataset.key === model.best.key,
    'ONE hero, large: main\'s best recent clip, not three cards of different sizes', `${cards.length} ${cards[0] && cards[0].dataset.key}`);
  const hc = cards[0];
  ok(hc.querySelector('.mo-hround').textContent === `Round ${best.round}` && hc.querySelector('.mo-htitle').textContent === best.title
    && hc.querySelector('.mo-heyebrow').textContent === model.best.label && hc.querySelector('.mo-hline').textContent === model.best.line,
    'its round, its title large, main\'s eyebrow and line over it', hc.textContent);
  const hv = hc.querySelector('video.mo-hvideo');
  ok(hv && hv.getAttribute('src') === best.clip.url && hv.hasAttribute('muted') && hv.hasAttribute('loop') && hv.getAttribute('aria-hidden') === 'true',
    'its own clip under it, muted and looping, hidden from the screen reader', hv && hv.getAttribute('src'));
  ok(hc.querySelector('.mo-hplay .mo-frame-play svg path') && hc.querySelector('.mo-hplay').getAttribute('aria-label') === `Play the highlight of round ${best.round}: ${best.title}`,
    'the whole picture is its play button, named for the screen reader');
  hc.querySelector('.mo-hplay').click();
  await settle();
  ok(!$('mo-player').hidden && $('mo-pl-count').textContent === '1 of 1' && $('mo-video').getAttribute('src') === best.clip.url,
    'pressed, the clip plays in the player', $('mo-pl-count').textContent);
  q.fire($('mo-pl-close'), 'keydown', { key: 'Escape' });
  ok($('mo-player').hidden, 'and Esc closes it');
  hc.querySelector('.mo-hopen').click();
  ok(q.bridge.sent.some(([ch, rid, round]) => ch === C.REVIEW_OPEN && rid === best.id && round === best.round), 'Open its review opens that round');

  // The filters.
  const all = rows().length;
  const dd = (key) => D.querySelector(`#mo-f-${key} .dd-btn`);
  // The open list only: a closed one lingers in the fake DOM, whose clock never runs its fade.
  const openOpts = () => D.querySelectorAll('.dd-list').filter((l) => !l.hidden && !l.classList.contains('dd-closing')).flatMap((l) => l.querySelectorAll('.dd-opt'));
  const choose = (key, label) => {
    dd(key).click();
    const opt = openOpts().find((o) => o.textContent === label);
    if (opt) q.fire(opt, 'mousedown');
    return !!opt;
  };
  const optionsOf = (key) => { dd(key).click(); const xs = openOpts().map((o) => o.textContent); q.fire(D.body, 'mousedown'); return xs; };
  ok(optionsOf('map').join() === 'Any map,Abyss,Ascent,Bind,Haven,Lotus,Split', 'the map dropdown offers every map saved, after Any map', optionsOf('map').join());
  ok(optionsOf('agent').join() === 'Any agent,Jett,Raze,Reyna' && optionsOf('result').join() === 'Any result,Victory,Defeat',
    'the agent and the result offer what the matches hold', `${optionsOf('agent').join()} | ${optionsOf('result').join()}`);
  ok(optionsOf('mistake')[0] === 'Any mistake' && optionsOf('mistake')[1] === model.compilation[0].title, 'the mistakes, the compilation\'s order first');
  ok($('mo-f-clear').hidden, 'nothing chosen: no Clear filters');
  ok(choose('map', 'Split') && sections().length === 1 && /on Split/.test(sections()[0].querySelector('.mo-who').textContent) && !$('mo-f-clear').hidden
    && D.querySelector('#mo-f-map').classList.contains('on') && dd('map').textContent.startsWith('Split'),
    'a map chosen: only its match, the control lit, Clear filters shown', `${sections().length}`);
  choose('map', 'Any map');
  ok(rows().length === all, 'Any map: every moment again');
  choose('agent', 'Reyna');
  ok(sections().length === 2 && sections().every((s) => /^Reyna on /.test(s.querySelector('.mo-who').textContent)), 'an agent chosen: its matches alone', `${sections().length}`);
  choose('result', 'Defeat');
  ok(sections().length === 1 && /Defeat/.test(sections()[0].querySelector('.mo-res').textContent), 'and with a result: both hold', `${sections().length}`);
  choose('map', 'Split');
  ok(rows().length === 0 && !$('mo-none').hidden && $('mo-none').textContent === 'No moments match these filters. Clear them to see every moment again.',
    'filters that leave nothing say so plainly', $('mo-none').textContent);
  $('mo-f-clear').click();
  ok(rows().length === all && $('mo-f-clear').hidden && !D.querySelector('#mo-f-agent').classList.contains('on'), 'Clear filters: every moment, every control back to Any');
  const top = model.compilation[0];
  choose('mistake', top.title);
  const pick = D.querySelector(`#mo-comp-rows .mo-cpick[data-key="${top.key}"]`);
  ok(pick.getAttribute('aria-pressed') === 'true' && rows().length > 0 && rows().every((r) => r.querySelector('.mo-kind').classList.contains('death')),
    'a mistake chosen in its dropdown chooses its chip, its deaths alone below', `${rows().length}`);
  pick.click();
  ok(dd('mistake').textContent.startsWith('Any mistake') && rows().length === all, 'the chip let go lets the dropdown go: one state');
  pick.click();
  ok(dd('mistake').textContent.startsWith(top.title), 'and a chip chosen shows in the dropdown');
  $('mo-f-clear').click();
  D.querySelector('#mo-filter button[data-kind="highlight"]').click();
  ok(rows().every((r) => r.querySelector('.mo-kind').classList.contains('highlight')) && !$('mo-f-clear').hidden, 'the kind is a filter like the others');
  $('mo-f-clear').click();
  ok(D.querySelector('#mo-filter button[data-kind="all"]').getAttribute('aria-pressed') === 'true' && rows().length === all, 'and Clear filters takes the kind back to All');

  // A kept clip's menu.
  const kept = rows().filter((r) => r.querySelector('.mo-play'));
  ok(kept.length > 0 && kept.every((r) => r.querySelector('.mo-frame > .mo-more')) && rows().filter((r) => !r.querySelector('.mo-play')).every((r) => !r.querySelector('.mo-more')),
    'every kept clip has its more button, a moment with no clip has none', `${kept.length}`);
  const row = kept[1];
  const key = row.dataset.key;
  const x = model.matches.flatMap((m) => m.moments).find((y) => y.key === key);
  const more = row.querySelector('.mo-more');
  ok(more.getAttribute('aria-haspopup') === 'menu' && more.getAttribute('aria-expanded') === 'false', 'it says it opens a menu');
  more.click();
  ok(!$('mo-menu').hidden && more.getAttribute('aria-expanded') === 'true' && D.activeElement === $('mo-menu').querySelector('[data-act="reveal"]'),
    'pressed, its menu opens with the keyboard on its first item');
  const asked = q.bridge.invoked.filter(([ch]) => ch === C.MOMENTS_GET).length;
  q.bridge.emit(C.PUSH_REVIEWS, { posters: true });
  await settle();
  ok(!$('mo-menu').hidden && q.bridge.invoked.filter(([ch]) => ch === C.MOMENTS_GET).length === asked,
    'a poster landing does not repaint the page under an open menu');
  q.fire(D.activeElement, 'keydown', { key: 'ArrowDown' });
  ok(D.activeElement === $('mo-menu').querySelector('[data-act="delete"]'), 'the arrows move inside it');
  q.fire(D.activeElement, 'keydown', { key: 'Escape' });
  ok($('mo-menu').hidden && D.activeElement === more && more.getAttribute('aria-expanded') === 'false', 'Esc closes it and gives the keyboard back to its button');
  more.click();
  $('mo-menu').querySelector('[data-act="reveal"]').click();
  await settle();
  const reveals = q.bridge.invoked.filter(([ch]) => ch === C.CLIP_REVEAL);
  ok(reveals.length === 1 && reveals[0][1] === x.id && reveals[0][2] === x.clip.name && $('mo-menu').hidden,
    'Open file location asks main by the review\'s id and the clip\'s name, never a path', JSON.stringify(reveals));
  revealAnswer = { ok: false, error: 'gone' };
  more.click();
  $('mo-menu').querySelector('[data-act="reveal"]').click();
  await settle();
  ok(!$('mo-toast').hidden && $('mo-toast').textContent === 'That clip is already gone from this PC.' && $('mo-toast').classList.contains('bad'),
    'a refusal is said in words', $('mo-toast').textContent);

  // Delete, asked first.
  const before = q.bridge.invoked.filter(([ch]) => ch === C.MOMENTS_GET).length;
  more.click();
  $('mo-menu').querySelector('[data-act="delete"]').click();
  ok(!$('mo-confirm').hidden && $('mo-cf-title').textContent === 'Delete this clip?' && $('mo-cf-yes').textContent === 'Delete clip'
    && $('mo-cf-no').textContent === 'Keep it' && D.activeElement === $('mo-cf-no'),
    'Delete clip asks first, the safe answer holding the keyboard', $('mo-cf-body').textContent);
  ok($('mo-cf-body').textContent.includes(`round ${x.round}`) && /goes from this PC for good\. Its review keeps its grade, its frames and what the coach saw\.$/.test($('mo-cf-body').textContent),
    'it says which clip, that it is gone for good, and what the review keeps', $('mo-cf-body').textContent);
  ok(D.querySelector('.sheet > main').hasAttribute('inert') && D.querySelector('.sheet > header').hasAttribute('inert'), 'the page behind is inert while it asks');
  q.fire($('mo-cf-no'), 'keydown', { key: 'Escape' });
  ok($('mo-confirm').hidden && !q.bridge.invoked.some(([ch]) => ch === C.CLIP_DELETE) && D.activeElement === more && !D.querySelector('.sheet > main').hasAttribute('inert'),
    'Esc keeps the clip, and the keyboard goes back to its more button');
  more.click();
  $('mo-menu').querySelector('[data-act="delete"]').click();
  $('mo-cf-yes').click();
  await settle();
  const deletes = q.bridge.invoked.filter(([ch]) => ch === C.CLIP_DELETE);
  ok(deletes.length === 1 && deletes[0][1] === x.id && deletes[0][2] === x.clip.name, 'Delete clip deletes it by its review\'s id and its name', JSON.stringify(deletes));
  ok($('mo-confirm').hidden && $('mo-toast').textContent === 'Clip deleted, 24 MB freed.' && !$('mo-toast').classList.contains('bad'),
    'and says so, with what it freed', $('mo-toast').textContent);
  ok(q.bridge.invoked.filter(([ch]) => ch === C.MOMENTS_GET).length > before && q.bridge.invoked.filter(([ch]) => ch === C.STORAGE_GET).length >= 2,
    'the page is read again, and the storage');
  deleteAnswer = { ok: false, error: 'working' };
  const row2 = rows().filter((r) => r.querySelector('.mo-more'))[0];
  row2.querySelector('.mo-more').click();
  $('mo-menu').querySelector('[data-act="delete"]').click();
  $('mo-cf-yes').click();
  await settle();
  ok($('mo-toast').textContent === 'Its review is still being finished. Try again in a moment.' && $('mo-toast').classList.contains('bad'), 'main refusing says why', $('mo-toast').textContent);
  // The hero's own clip: its menu deletes it too, and the hero lets go of the file first.
  deleteAnswer = { ok: true, bytes: 3 * 1024 * 1024 };
  const heroMore = D.querySelector('#mo-hero .mo-more');
  heroMore.click();
  $('mo-menu').querySelector('[data-act="delete"]').click();
  ok($('mo-cf-body').textContent.startsWith(`The clip of your ${best.title} in round ${best.round} on ${best.m.map}`), 'the hero\'s clip can be deleted from its own menu', $('mo-cf-body').textContent);
  $('mo-cf-yes').click();
  ok(!hv.getAttribute('src'), 'the hero lets go of its clip before it is deleted');
  await settle();

  // Storage.
  const pill = $('mo-store-btn');
  ok(!pill.hidden && $('mo-store-btn-text').textContent === '3.9 GB' && D.querySelectorAll('#mo-store-mini .mo-seg').length === 4,
    'the Storage pill says the total and draws its four parts', $('mo-store-btn-text').textContent);
  pill.click();
  ok(!$('mo-store').hidden && pill.getAttribute('aria-expanded') === 'true', 'pressed, the storage card opens');
  const names = D.querySelectorAll('#mo-store-rows .mo-sname').map((n) => n.textContent).join();
  const bytes = D.querySelectorAll('#mo-store-rows .mo-sbytes').map((n) => n.textContent).join();
  ok(names === 'Clips,Recordings,Frames,Reviews and logs' && bytes === '2.3 GB,1.1 GB,386 MB,47 MB', 'clips, recordings, frames and the rest, each its size', `${names} | ${bytes}`);
  ok($('mo-store-total').textContent === '3.9 GB' && $('mo-store-where').textContent === ' on this PC, 212.4 GB free on C:', 'the total, and the room left on the drive', $('mo-store-where').textContent);
  const lines = D.querySelectorAll('#mo-store-rows .mo-sline').map((n) => n.textContent);
  ok(/^14 clips from 5 matches\. Delete one from its menu here, or clear them all in Settings\.$/.test(lines[0]) && /removed when Occlara quits/.test(lines[1]) && /thins its own/.test(lines[2]),
    'what each is, and whether and how it is cleared', lines.join(' | '));
  ok(D.querySelector('#mo-store-cap .mo-cap-num').textContent === '2.3 GB of 10 GB' && /kept under 10 GB, the oldest go first/.test(D.querySelector('#mo-store-cap .mo-cap-words').textContent),
    'the clips against the limit set in Settings');
  ok($('mo-store-warn').hidden, 'with room on the drive, no warning');
  D.querySelector('#mo-store-cap .mo-cap-set').click();
  ok(q.bridge.sent.some(([ch]) => ch === C.OPEN_SETTINGS) && $('mo-store').hidden, 'Clear clips or change the limit opens Settings');
  pill.click();
  q.fire($('mo-store-close'), 'keydown', { key: 'Escape' });
  ok($('mo-store').hidden && D.activeElement === pill, 'Esc closes the card, the keyboard back on the pill');
  storageAnswer = demo.storage('low');
  const low = await open(model);
  low.$('mo-store-btn').click();
  ok(!low.$('mo-store-warn').hidden && low.$('mo-store-warn').textContent === 'Less than 8 GB is free on C:, so matches are not recorded until there is more room.'
    && low.$('mo-store-btn').classList.contains('low'), 'under the recorder\'s floor the card says matches are not recorded', low.$('mo-store-warn').textContent);
  storageAnswer = null;
  const none = await open(model);
  ok(none.$('mo-store-btn').hidden && none.$('mo-store').hidden, 'main saying null (mid match), no Storage at all');

  // No clip kept anywhere: no hero, and the page still lists every moment.
  const bare = demo.model({ now: T0, keep: 0 });
  const nq = await open(bare);
  ok(bare.best === null && nq.$('mo-hero').hidden && nq.document.querySelectorAll('#mo-list .mo-row').length > 0, 'no clip kept: no hero, the moments still listed');

  // ── The play mark: its centroid on the circle's centre ───────────────────
  const page = read('src/renderer/moments/moments.js');
  const css = read('src/renderer/moments/moments.css');
  const PATH = (page.match(/const PLAY_PATH = '([^']+)'/) || [])[1];
  const centroid = (() => {
    if (!PATH) return null;
    const toks = PATH.match(/[MLAZ]|-?\d+(?:\.\d+)?/g);
    const pts = [];
    let i = 0;
    let cur = null;
    while (i < toks.length) {
      const t = toks[i++];
      if (t === 'M' || t === 'L') { cur = [Number(toks[i++]), Number(toks[i++])]; pts.push(cur); }
      else if (t === 'A') {
        const r = Number(toks[i++]); i += 4;   // ry, rotation, large arc, sweep
        const to = [Number(toks[i++]), Number(toks[i++])];
        // The arc's centre: on the chord's perpendicular, to the side a clockwise sweep turns about.
        const mx = (cur[0] + to[0]) / 2, my = (cur[1] + to[1]) / 2;
        const dx = to[0] - cur[0], dy = to[1] - cur[1];
        const d = Math.hypot(dx, dy);
        const h = Math.sqrt(Math.max(0, r * r - (d / 2) * (d / 2)));
        const c = [mx - (dy / d) * h, my + (dx / d) * h];
        let a0 = Math.atan2(cur[1] - c[1], cur[0] - c[0]);
        let a1 = Math.atan2(to[1] - c[1], to[0] - c[0]);
        while (a1 < a0) a1 += 2 * Math.PI;
        for (let s = 1; s <= 16; s++) { const a = a0 + ((a1 - a0) * s) / 16; pts.push([c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)]); }
        cur = to;
      }
    }
    let A = 0, cx = 0, cy = 0;
    for (let k = 0; k < pts.length; k++) {
      const [x0, y0] = pts[k];
      const [x1, y1] = pts[(k + 1) % pts.length];
      const cr = x0 * y1 - x1 * y0;
      A += cr; cx += (x0 + x1) * cr; cy += (y0 + y1) * cr;
    }
    A /= 2;
    return [cx / (6 * A), cy / (6 * A)];
  })();
  ok(centroid && Math.abs(centroid[0] - 12) < 0.08 && Math.abs(centroid[1] - 12) < 0.05,
    'THE PLAY MARK: its centroid on (12, 12), the circle\'s centre, so it sits centred as the eye measures it', JSON.stringify(centroid));
  ok(D.querySelectorAll('.mo-play svg path, .mo-frame-play svg path').length > 0
    && D.querySelectorAll('.mo-play svg path, .mo-frame-play svg path').every((p) => p.getAttribute('d') === PATH),
    'every play mark on the page is that one');
  ok(!page.includes('M8 5.5v13l10.5-6.5z') && !/border-left:\s*\d+px solid var\(--text\)/.test(css), 'and the old marks, boxed left of centre, are gone');
  // Everywhere a clip's play mark sits in its circle: the clip player (the
  // review's, Clips' own player and Ask Coach's), Home's fix card and
  // Practice's clip tile draw the same mark, with no nudge of their own.
  const elsewhere = ['src/renderer/review/clip-player.js', 'src/renderer/home/home.js', 'src/renderer/practice/practice.js'];
  ok(elsewhere.every((rel) => read(rel).includes(PATH)), 'every clip play mark in its circle is the same centred one', elsewhere.filter((rel) => !read(rel).includes(PATH)).join());
  ok(!/\.play-mark svg\s*\{[^}]*margin-left/.test(read('src/renderer/home/home.css')), 'and Home\'s fix card no longer nudges it by hand');

  // ── The page scrolls as one ───────────────────────────────────────────────
  const rule = (sel) => { const m = css.match(new RegExp(`(?:^|\\n)${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`)); return m ? m[1] : ''; };
  ok(/overflow-y:\s*auto/.test(rule('.sheet')) && !/overflow-y:\s*auto/.test(rule('.body')),
    'NOTHING CUT BY THE BAR: the sheet scrolls, title and all, never a body under a title that stays put', `${rule('.sheet')} | ${rule('.body')}`);
  ok(/position:\s*sticky/.test(rule('.sheet::before')) && /mask-image/.test(rule('.sheet::before')), 'and what passes under the bar fades into the ground');

  // ── Main's side, read as text ─────────────────────────────────────────────
  const index = read('src/main/index.js');
  ok(/recordNeeds: require\('\.\/services\/recorder'\)\.DISK_START_BYTES/.test(index) && require('../src/main/services/recorder').DISK_START_BYTES === 8 * GB,
    'Storage carries the recorder\'s own floor (8 GB), never a number of the page\'s');

  // ── No dash in anything this added ─────────────────────────────────────────
  for (const rel of ['src/renderer/moments/moments.js', 'src/renderer/moments/moments.css', 'src/renderer/moments/index.html', 'scripts/fixtures/clips-demo.js']) {
    ok(!DASHES.test(read(rel)), `no dash in ${rel}`);
  }
  ok(DASHES.test(String.fromCharCode(0x2014)) && !DASHES.test('-'), 'the dash detector matches a dash and not a hyphen');
  ok(q.logs.every((l) => !/error|TypeError/i.test(l)), 'the page logged no error', q.logs.join(' | '));

  console.log(`\n${fails ? `${fails} of ${checks} clips page checks FAILED` : `all ${checks} clips page checks passed`}`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

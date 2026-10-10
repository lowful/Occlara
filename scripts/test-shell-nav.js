'use strict';

/**
 * The one window's page table and navigation state (src/shared/shell-nav.js),
 * and the registry reaching page views as well as windows.
 *
 * Run: npm run test:shellnav
 */

const fs = require('fs');
const path = require('path');
const { PAGES, pageOf, createNav } = require('../src/shared/shell-nav');
const registry = require('../src/main/windows/registry');

let fails = 0;
let checks = 0;
const ok = (cond, what) => {
  checks++;
  if (!cond) { fails++; console.log(`FAIL  ${what}`); } else console.log(`ok    ${what}`);
};

// ── The page table ────────────────────────────────────────────────────────
const ids = PAGES.map((p) => p.id);
ok(new Set(ids).size === ids.length, `page ids are unique (${ids.join(', ')})`);
ok(PAGES.every((p) => fs.existsSync(path.join(__dirname, '..', 'src', 'renderer', p.surface, 'index.html'))),
  'every page loads a surface that exists');
ok(PAGES.every((p) => fs.existsSync(path.join(__dirname, '..', 'src', 'preload', p.preload))),
  'and a preload that exists');
ok(pageOf('matches') && pageOf('matches').query.section === 'list'
  && pageOf('patterns').surface === 'matches' && pageOf('breakdown').query.section === 'breakdown',
  'Matches, Patterns and Breakdown are three sections of the library surface');
ok(!pageOf('nope'), 'an unknown page is none');
ok(PAGES.filter((p) => p.nav).map((p) => p.id).join() === 'home,matches,patterns,breakdown,stats,coach',
  'the sidebar lists Home, Matches, Patterns, Breakdown, Stats and Ask Coach, in that order');

// ── Navigation, and the seal ──────────────────────────────────────────────
{
  const nav = createNav();
  let s = nav.state();
  ok(s.page === 'home' && s.shown === 'home' && !s.sealed, 'it opens on Home');
  s = nav.go('matches');
  ok(s.page === 'matches' && s.shown === 'matches', 'going to Matches shows Matches');
  s = nav.go('nope');
  ok(s.page === 'matches', 'an unknown page changes nothing');
  s = nav.seal(true);
  ok(s.sealed && s.shown === null && s.page === 'matches', 'sealed, no page shows');
  s = nav.go('review');
  ok(s.shown === null && s.page === 'review', 'and going to the review while sealed only remembers it');
  s = nav.seal(false);
  ok(!s.sealed && s.shown === 'review', 'unsealed, the page it was sent to shows');
}

// ── The registry reaches views ────────────────────────────────────────────
{
  const sent = [];
  const listeners = {};
  const fakeContents = (name) => ({
    destroyed: false,
    send: (ch, data) => sent.push({ name, ch, data }),
    on: (ev, fn) => { (listeners[name] = listeners[name] || {})[ev] = fn; },
    isDestroyed() { return this.destroyed; },
  });
  const win = { webContents: fakeContents('win'), destroyed: false, isDestroyed() { return this.destroyed; },
    on: (ev, fn) => { (listeners.winEvents = listeners.winEvents || {})[ev] = fn; } };
  const view = { webContents: fakeContents('view') };
  registry.register('t-win', win);
  registry.register('t-view', view);
  registry.broadcast('push:test', 1);
  ok(sent.some((x) => x.name === 'win') && sent.some((x) => x.name === 'view'),
    'a broadcast reaches a window and a page view');
  registry.sendTo('t-view', 'push:one', 2);
  ok(sent.some((x) => x.name === 'view' && x.ch === 'push:one'), 'and sendTo reaches a view by name');
  ok(registry.get('t-view') === view, 'a view is found by its name');
  view.webContents.destroyed = true;
  if (listeners.view && listeners.view.destroyed) listeners.view.destroyed();
  ok(!registry.get('t-view'), 'a destroyed view is forgotten');
}

console.log(`\n${fails ? fails + ' of ' + checks + ' failed' : 'all ' + checks + ' shell navigation checks passed'}`);
process.exit(fails ? 1 : 0);

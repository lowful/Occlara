'use strict';

/**
 * The one window's page table and navigation state (src/shared/shell-nav.js),
 * the way it moves from page to page (8.2: which direction, and the order of
 * a switch, the seal and a page that never answers included, and a staged
 * page waiting on while the window cannot be seen), and the registry reaching
 * page views as well as windows. Then main-window.js itself on stand-in views:
 * the window's own state deciding whether it can be seen, its show, restore
 * and focus starting a staged page's wait again, and a page loading again
 * ignoring the ready of the document it replaces; and the shell drawn to the
 * sizes the pages are laid at, its notice line (8.3) one line in the top
 * strip. check:mainwindow carries the same switch out on real views.
 *
 * Run: npm run test:shellnav
 */

const fs = require('fs');
const path = require('path');
const { PAGES, pageOf, createNav, direction, createMotion, READY_MS, LOAD_MS } = require('../src/shared/shell-nav');
const registry = require('../src/main/windows/registry');

let fails = 0;
let checks = 0;
const ok = (cond, what, detail) => {
  checks++;
  if (!cond) { fails++; console.log(`FAIL  ${what}${detail ? `\n        ${detail}` : ''}`); } else console.log(`ok    ${what}`);
};

// ── The page table ────────────────────────────────────────────────────────
const ids = PAGES.map((p) => p.id);
ok(new Set(ids).size === ids.length, `page ids are unique (${ids.join(', ')})`);
ok(PAGES.every((p) => fs.existsSync(path.join(__dirname, '..', 'src', 'renderer', p.surface, 'index.html'))),
  'every page loads a surface that exists');
ok(PAGES.every((p) => fs.existsSync(path.join(__dirname, '..', 'src', 'preload', p.preload))),
  'and a preload that exists');
ok(pageOf('matches') && pageOf('matches').query.section === 'list'
  && pageOf('patterns').surface === 'matches' && pageOf('patterns').query.section === 'patterns',
  'Matches and Patterns are two sections of the library surface');
// MOMENTS (8.7) took the Breakdown tab's place: its own surface and preload,
// in the nav list where Breakdown was, and no breakdown page is left.
ok(pageOf('moments') && pageOf('moments').surface === 'moments' && pageOf('moments').preload === 'moments-preload.js'
  && pageOf('moments').nav === true && !pageOf('moments').query.section,
  'Moments is a page with its own surface and preload, in the nav list', JSON.stringify(pageOf('moments')));
ok(!pageOf('breakdown') && !PAGES.some((p) => p.query && p.query.section === 'breakdown'), 'the Breakdown page is gone');
ok(!pageOf('nope'), 'an unknown page is none');
ok(PAGES.filter((p) => p.nav).map((p) => p.id).join() === 'home,matches,patterns,practice,trainer,moments,stats,coach',
  'the bar lists Home, Matches, Patterns, Practice, Trainer, Moments, Stats and Ask Coach, in that order');
// PRACTICE (ui.md, "The Practice page"): its own surface and preload, a tab
// right after Patterns, whose repeated mistakes its plan is made from.
ok(pageOf('practice') && pageOf('practice').surface === 'practice' && pageOf('practice').preload === 'practice-preload.js' && pageOf('practice').nav === true
  && direction('patterns', 'practice') === 'forward' && direction('practice', 'trainer') === 'forward' && direction('practice', 'patterns') === 'back',
  'Practice is a page with its own surface and preload, between Patterns and the Trainer');
// THE TRAINER (docs/claude/trainer.md): its own surface and preload, a tab
// right after Practice, whose drills link into it, and before Moments.
ok(pageOf('trainer') && pageOf('trainer').surface === 'trainer' && pageOf('trainer').preload === 'trainer-preload.js' && pageOf('trainer').nav === true
  && !pageOf('trainer').query.section
  && direction('practice', 'trainer') === 'forward' && direction('trainer', 'moments') === 'forward'
  && direction('trainer', 'practice') === 'back' && direction('moments', 'trainer') === 'back',
  'the Trainer is a page with its own surface and preload, between Practice and Moments', JSON.stringify(pageOf('trainer')));
{
  const n = createNav();
  n.seal(true);
  const s = n.go('trainer');
  ok(s.shown === null && s.page === 'trainer' && n.seal(false).shown === 'trainer', 'sealed, the Trainer is only remembered, and shows once the seal lifts');
}
// THE INVITE PAGE (8.7): its own surface and preload, out of the nav list (its
// button is in the sidebar's foot, directly above Settings), and just before
// Settings, so the window moves forward into it from every page above it.
ok(pageOf('invite') && pageOf('invite').surface === 'invite' && pageOf('invite').preload === 'invite-preload.js' && pageOf('invite').nav === false,
  'Invite is a page with its own surface and preload, not in the nav list');
ok(ids.indexOf('invite') === ids.indexOf('settings') - 2, 'and sits two before Settings, Profile between them', ids.join(', '));
ok(direction('coach', 'invite') === 'forward' && direction('invite', 'settings') === 'forward' && direction('settings', 'invite') === 'back'
  && direction('invite', 'review') === 'forward' && direction('review', 'invite') === 'back',
  'down the sidebar into Invite and on to Settings is forward, back up is back, and the review is deeper still');
{
  const n = createNav();
  n.seal(true);
  const s = n.go('invite');
  ok(s.shown === null && s.page === 'invite' && n.seal(false).shown === 'invite', 'sealed, Invite is only remembered, and shows once the seal lifts');
}
// WHAT'S NEW (the changelog): its own surface and preload, out of the nav
// list (reached from Settings and Home's update line), one step deeper than
// Settings, and sealed like every page.
ok(pageOf('whatsnew') && pageOf('whatsnew').surface === 'whatsnew' && pageOf('whatsnew').preload === 'whatsnew-preload.js' && pageOf('whatsnew').nav === false,
  "What's new is a page with its own surface and preload, not in the nav list", JSON.stringify(pageOf('whatsnew')));
ok(ids.indexOf('whatsnew') === ids.indexOf('settings') + 1 && direction('settings', 'whatsnew') === 'forward' && direction('whatsnew', 'settings') === 'back'
  && direction('home', 'whatsnew') === 'forward' && direction('whatsnew', 'review') === 'forward' && direction('review', 'whatsnew') === 'back',
  "and comes right after Settings: forward into it, back out, the review deeper still", ids.join(', '));
{
  const n = createNav();
  n.seal(true);
  const s = n.go('whatsnew');
  ok(s.shown === null && s.page === 'whatsnew' && n.seal(false).shown === 'whatsnew', "sealed, What's new is only remembered, and shows once the seal lifts");
}

// THE PROFILE PAGE (8.8): its own surface and preload, out of the nav list
// (its button is in the sidebar's foot between Invite and Settings), and
// between them in the order, so the window moves forward from Invite into it
// and on to Settings.
ok(pageOf('profile') && pageOf('profile').surface === 'profile' && pageOf('profile').preload === 'profile-preload.js' && pageOf('profile').nav === false,
  'Profile is a page with its own surface and preload, not in the nav list', JSON.stringify(pageOf('profile')));
ok(ids.indexOf('profile') === ids.indexOf('invite') + 1 && ids.indexOf('profile') === ids.indexOf('settings') - 1,
  'and sits between Invite and Settings', ids.join(', '));
ok(direction('invite', 'profile') === 'forward' && direction('profile', 'settings') === 'forward' && direction('settings', 'profile') === 'back'
  && direction('profile', 'invite') === 'back' && direction('home', 'profile') === 'forward'
  && direction('profile', 'review') === 'forward' && direction('review', 'profile') === 'back',
  'from Invite into Profile and on to Settings is forward, back up is back, and the review is deeper still');
{
  const n = createNav();
  n.seal(true);
  const s = n.go('profile');
  ok(s.shown === null && s.page === 'profile' && n.seal(false).shown === 'profile', 'sealed, Profile is only remembered, and shows once the seal lifts');
}
// Report a problem (docs/claude/feedback.md): a page of its own, out of the
// nav list (its icon is at the end of Profile's row, above the Discord),
// deeper than Settings and What's new, so the window moves forward into it,
// and the review deeper still.
ok(pageOf('feedback') && pageOf('feedback').surface === 'feedback' && pageOf('feedback').preload === 'feedback-preload.js' && pageOf('feedback').nav === false,
  'Report a problem is a page with its own surface and preload, not in the nav list', JSON.stringify(pageOf('feedback')));
ok(ids.indexOf('feedback') === ids.indexOf('whatsnew') + 1 && ids.indexOf('feedback') === ids.indexOf('review') - 1,
  'and sits after What\'s new, before the review', ids.join(', '));
ok(direction('settings', 'feedback') === 'forward' && direction('profile', 'feedback') === 'forward' && direction('feedback', 'home') === 'back'
  && direction('feedback', 'review') === 'forward' && direction('review', 'feedback') === 'back',
  'into it from any page is forward, out of it back, and the review deeper still');
{
  const n = createNav();
  n.seal(true);
  const s = n.go('feedback');
  ok(s.shown === null && s.page === 'feedback' && n.seal(false).shown === 'feedback', 'sealed, Report a problem is only remembered, and shows once the seal lifts');
}

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

// ── The Recording view (9.1, the owner's item 14) ─────────────────────────
// Start takes the window to the Recording screen at once, in its waiting
// state: no page shows, but nothing is sealed, so the player may open one.
{
  const nav = createNav();
  nav.go('matches');
  let s = nav.recording(true);
  ok(s.rec && !s.sealed && s.shown === null && s.page === 'matches', 'Start: the Recording view, no page shown and no seal, the page the player was on kept');
  s = nav.seal(true);
  ok(s.sealed && s.shown === null, 'the match seen: the seal comes on, the same screen');
  s = nav.seal(false);
  ok(!s.sealed && s.rec && s.shown === null, 'the match over with no page asked for: the Recording view again, waiting for the next');
  nav.seal(true);
  s = nav.go('review');
  ok(s.shown === null && s.page === 'review' && !s.rec, "the review asked for while sealed is remembered, and takes the Recording view's place");
  s = nav.seal(false);
  ok(s.shown === 'review' && !s.rec, 'so it shows the moment the seal lifts');
  nav.recording(true);
  s = nav.go('moments');
  ok(s.shown === 'moments' && !s.rec, 'between matches a page the player opens takes its place');
  nav.recording(true);
  s = nav.go('nope');
  ok(s.rec && s.shown === null, 'an unknown page changes nothing');
  s = nav.recording(false);
  ok(!s.rec && s.shown === 'moments', 'recording stopped: the page the player was on comes back');
}

// ── Which way the window moves (8.2) ──────────────────────────────────────
ok(direction('home', 'matches') === 'forward' && direction('matches', 'moments') === 'forward'
  && direction('coach', 'settings') === 'forward', 'down the sidebar is forward, Settings at its foot last');
ok(direction('stats', 'home') === 'back' && direction('settings', 'coach') === 'back' && direction('moments', 'patterns') === 'back',
  'up it is back');
ok(PAGES.filter((p) => p.id !== 'review').every((p) => direction(p.id, 'review') === 'forward' && direction('review', p.id) === 'back'),
  'the review is deeper than every page: forward into it from anywhere, back out of it to anywhere');
ok(direction(null, 'home') === 'none' && direction('home', null) === 'none' && direction(null, null) === 'none'
  && direction('stats', 'stats') === 'none' && direction('nope', 'home') === 'none',
  'no page at either end, or the same page, is no direction');

// ── Moving between pages: the order of it (8.2) ──────────────────────────
// A fake of what main-window.js does to its views, logging every effect in
// order, a clock the test moves by hand, and whether the window can be seen
// (see(false): hidden, minimised or behind the game).
function rig() {
  const log = [];
  const shown = new Set();
  const dead = new Set();
  let now = 0;
  let seq = 0;
  let seeable = true;
  const timers = new Map();
  const fx = {
    under: (to, from) => { log.push(`under ${to}<${from}`); shown.add(to); },
    stage: (to) => { log.push(`stage ${to}`); shown.add(to); },
    place: (to) => log.push(`place ${to}`),
    hide: (id) => { log.push(`hide ${id}`); shown.delete(id); },
    keep: (id) => log.push(`keep ${id}`),
    send: (id, m) => log.push(`${m.phase} ${id}${m.dir ? ' ' + m.dir : ''}`),
    alive: (id) => !dead.has(id),
    canSee: () => seeable,
    later: (fn, ms) => { const h = ++seq; timers.set(h, { fn, at: now + ms }); return h; },
    cancel: (h) => { timers.delete(h); },
  };
  const tick = (ms) => {
    now += ms;
    for (const [h, t] of [...timers]) if (t.at <= now) { timers.delete(h); t.fn(); }
  };
  return { m: createMotion(fx), log, shown, dead, tick, timers, see: (on) => { seeable = !!on; },
    take: () => log.splice(0).join(' | ') };
}

{
  const r = rig();
  const { m } = r;
  // The window's first page: nothing on screen to go under, so staged.
  m.show('home');
  ok(r.take() === 'stage home | arm home none' && m.state().coming.staged, 'the first page is staged out of sight and told to arm', r.log.join());
  m.ready('home');
  ok(r.take() === 'place home | enter home none' && m.state().onScreen === 'home' && !m.state().coming,
    'ready, it is placed and comes in');

  // Forward: Matches under Home, Home told to leave, Matches to arm.
  m.show('matches');
  let t = r.take();
  ok(t === 'under matches<home | leave home | arm matches forward', 'a page is shown UNDER the page on screen, then armed, forward down the sidebar', t);
  ok(r.shown.has('home') && r.shown.has('matches') && m.state().onScreen === 'home',
    'and until it is ready the page on screen stays, over it');
  ok(!m.ready('stats') && !m.ready('home') && m.state().coming.to === 'matches' && !r.log.length,
    'a ready from any other page, the one leaving included, changes nothing');
  m.ready('matches');
  t = r.take();
  ok(t === 'hide home | enter matches forward' && !r.shown.has('home') && m.state().onScreen === 'matches',
    'ready: the page on screen goes, THEN the new one comes in', t);
  // Back.
  m.show('home');
  ok(r.take() === 'under home<matches | leave matches | arm home back', 'up the sidebar it arms back');
  m.ready('home');
  r.take();

  // A page that never answers is let in after READY_MS, and not before.
  m.show('stats');
  r.take();
  r.tick(READY_MS - 1);
  ok(!r.log.length && r.shown.has('home'), `with no answer, the page on screen holds for ${READY_MS - 1}ms`);
  r.tick(1);
  t = r.take();
  ok(t === 'hide home | enter stats forward' && m.state().onScreen === 'stats', `and at ${READY_MS}ms the page comes in anyway`, t);
  ok(m.ready('stats') && r.take() === 'enter stats forward', 'a late answer from it only says enter again, the way it came');

  // Sealing mid switch: both pages go in that call, and the timer is off.
  m.show('patterns');
  r.take();
  m.show(null);
  t = r.take();
  ok(t === 'hide patterns | hide stats' && !r.shown.size && !m.state().onScreen && !m.state().coming,
    'sealed mid switch, the page on its way and the page on screen go at once', t);
  r.tick(LOAD_MS * 2);
  ok(!r.log.length && !r.shown.size, 'and nothing comes back when its timer would have run');
  ok(!m.ready('patterns') && !r.log.length, 'nor on a late ready');

  // Unsealed: nothing on screen to go under, so the remembered page is staged.
  m.show('review');
  ok(r.take() === 'stage review | arm review none', 'the seal lifting stages the page and arms it');
  m.ready('review');
  ok(r.take() === 'place review | enter review none', 'and places it once it is ready');

  // Asked for another page while one is on its way.
  m.show('coach');
  r.take();
  m.show('settings');
  t = r.take();
  ok(t === 'hide coach | under settings<review | leave review | arm settings back',
    'a page asked for while another is on its way: that one goes back, and the new one goes under the page still on screen', t);
  ok(!m.ready('coach') && m.state().coming.to === 'settings', 'the first one\'s ready is stale');
  m.ready('settings');
  r.take();

  // Called back to the page on screen before the new one arrived.
  m.show('stats');
  r.take();
  m.show('settings');
  t = r.take();
  ok(t === 'hide stats | keep settings | enter settings none' && m.state().onScreen === 'settings' && !m.state().coming,
    'called back before the page on its way arrived: it goes, and the page told to leave stays and comes back', t);
  m.show('settings');
  ok(!r.log.length, 'showing the page already on screen does nothing');

  // A page loading again: its old document is never told to arm, and its new
  // one, which arms itself as it loads, is waited for longer.
  m.show('coach', { reload: true });
  t = r.take();
  ok(t === 'under coach<settings | leave settings', 'a page loading again goes under with no arm sent to the document it replaces', t);
  r.tick(READY_MS);
  ok(!r.log.length, `and is not let in at ${READY_MS}ms`);
  m.ready('coach');
  ok(r.take() === 'hide settings | enter coach back', 'but on its new document\'s ready');
  m.show('home');
  m.ready('home');
  r.take();
  m.show('stats', { reload: true });
  r.take();
  r.tick(LOAD_MS - 1);
  ok(!r.log.length, `nor at ${LOAD_MS - 1}ms`);
  r.tick(1);
  ok(r.take() === 'hide home | enter stats forward', `but at ${LOAD_MS}ms, answer or not`);

  // The page on screen arming itself as it loads (a reload in place, or a page
  // let in by the timer before it had loaded) is let in on its ready.
  ok(m.ready('stats') && r.take() === 'enter stats forward', 'the page on screen, ready late, comes in the way it came');
  m.show('stats', { reload: true });
  ok(!r.log.length && m.ready('stats') && r.take() === 'enter stats none', 'loaded again in place, it comes in where it is');

  // A page on screen whose view is gone is nothing to go under.
  r.dead.add('stats');
  m.show('matches');
  ok(r.take() === 'stage matches | arm matches none', 'with the view on screen closed, the next page is staged instead');
  m.ready('matches');
  r.take();
  r.dead.clear();

  // forget(): a view closing mid switch.
  m.show('patterns');
  r.take();
  m.forget('patterns');
  t = r.take();
  ok(t === 'keep matches | enter matches none' && m.state().onScreen === 'matches' && !m.state().coming && !r.timers.size,
    'the page on its way closing calls the switch off, and the page on screen stays', t);
  m.show('patterns');
  r.take();
  m.forget('matches');
  t = r.take();
  ok(t === 'hide matches | enter patterns forward' && m.state().onScreen === 'patterns',
    'the page leaving closing lets the page under it in', t);
  m.forget('patterns');
  ok(m.state().onScreen === null, 'and the page on screen closing leaves none on screen');
  m.reset();
  ok(!m.state().onScreen && !m.state().coming, 'reset leaves nothing on screen and nothing on its way');
}

// ── A staged page waits on while the window cannot be seen (8.2) ─────────
// At a match's end the seal lifts with the game in front: the review's view
// can paint nothing, so it can never answer, and placed by its timer it
// showed the frame it last painted, the previous match's review, the moment
// the player looked. Shown, restored or focused, the window is seen().
{
  const r = rig();
  const { m } = r;
  r.see(false);
  m.show('review');
  ok(r.take() === 'stage review | arm review none', 'the seal lifting behind the game stages the review and arms it');
  r.tick(READY_MS);
  ok(!r.log.length && m.state().coming && m.state().coming.staged && m.state().coming.to === 'review' && !r.timers.size,
    `with the window out of sight, its timer at ${READY_MS}ms leaves it staged`, r.log.join(' | '));
  r.tick(LOAD_MS * 10);
  ok(!r.log.length && m.state().coming.to === 'review' && !m.state().onScreen, 'and nothing lets it in later');
  r.see(true);
  m.seen();
  ok(r.timers.size === 1 && !r.log.length, 'the window seen, its wait starts again');
  r.tick(READY_MS - 1);
  ok(!r.log.length, `the whole ${READY_MS}ms of it, counted from then`);
  ok(m.ready('review') && r.take() === 'place review | enter review none' && m.state().onScreen === 'review' && !r.timers.size,
    'and the review\'s own ready, sent now that its view can paint, places it');
  m.seen();
  ok(!r.log.length && !r.timers.size, 'seen with nothing on its way, nothing happens');

  // Seen while it still cannot be (shown, but behind the game): the timer
  // runs again and still waits on. Its own ready lets it in at any time.
  m.show(null);
  r.take();
  r.see(false);
  m.show('home');
  r.take();
  r.tick(READY_MS);
  m.seen();
  r.tick(READY_MS);
  ok(!r.log.length && m.state().coming.to === 'home' && !r.timers.size,
    'seen while it still cannot be, the timer runs again and waits on', r.log.join(' | '));
  ok(m.ready('home') && r.take() === 'place home | enter home none', 'its own ready lets it in, seen or not');

  // A page that never answers comes in once the window can be seen.
  m.show(null);
  r.take();
  m.show('review');
  r.take();
  r.tick(READY_MS * 3);
  r.see(true);
  m.seen();
  r.tick(READY_MS);
  ok(r.take() === 'place review | enter review none', `one that never answers comes in ${READY_MS}ms after the window is seen`);

  // Sealing takes a page waiting on away at once, and nothing brings it back.
  m.show(null);
  r.take();
  r.see(false);
  m.show('stats');
  r.take();
  r.tick(READY_MS);
  m.show(null);
  ok(r.take() === 'hide stats' && !m.state().coming && !m.state().onScreen, 'sealed, a staged page waiting on goes at once');
  r.see(true);
  m.seen();
  r.tick(LOAD_MS * 2);
  ok(!r.log.length && !r.timers.size, 'and the window seen later brings nothing back');

  // A staged page loading again waits its LOAD_MS again from the moment the
  // window is seen: its new document is given that long to paint.
  r.see(false);
  m.show('coach', { reload: true });
  ok(r.take() === 'stage coach', 'staged while loading again, the document it replaces is not told to arm');
  r.tick(LOAD_MS);
  ok(!r.log.length && m.state().coming.to === 'coach', `with the window out of sight, its timer at ${LOAD_MS}ms leaves it staged too`);
  r.see(true);
  m.seen();
  r.tick(LOAD_MS - 1);
  ok(!r.log.length, `seen, it waits its whole ${LOAD_MS}ms again`);
  r.tick(1);
  ok(r.take() === 'place coach | enter coach none', 'then comes in, answer or not');

  // With a page on screen to go under, the switch is the player's own, made
  // in the window, and its timer lets it in as before, seen or not; seen()
  // leaves its wait alone.
  r.see(false);
  m.show('matches');
  ok(r.take() === 'under matches<coach | leave coach | arm matches back', 'a page asked for over another goes under it, seen or not');
  r.tick(READY_MS - 50);
  m.seen();
  r.tick(50);
  ok(r.take() === 'hide coach | enter matches back', `and its timer still lets it in at ${READY_MS}ms, its wait untouched by seen()`);
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

// ── main-window.js carries it out (8.2), on stand-in views ───────────────
// The real module, with Electron and the config store stood in for and the
// switch's timers on a clock moved by hand (main-window.js sets them with the
// global setTimeout, swapped here for this block only). What is real: how the
// window's own state decides whether it can be seen, its show, restore and
// focus giving a staged page its wait again, and a page loading again
// refusing the ready of the document it replaces.
{
  const EventEmitter = require('events');
  const Module = require('module');
  let ids = 0;
  class Contents extends EventEmitter {
    constructor() { super(); this.id = ++ids; this.sent = []; this.dead = false; this.reloads = 0; }
    loadFile() {}
    reload() { this.reloads++; }
    send(ch, msg) { this.sent.push({ ch, msg }); }
    focus() {}
    isDestroyed() { return this.dead; }
    close() { this.dead = true; this.emit('destroyed'); }
  }
  class View {
    constructor() { this.webContents = new Contents(); this.visible = true; this.bounds = null; }
    setBackgroundColor() {}
    setVisible(on) { this.visible = !!on; }
    getVisible() { return this.visible; }
    setBounds(b) { this.bounds = b; }
    getBounds() { return this.bounds; }
  }
  const wins = [];
  // A window as Windows keeps one: shown or not, minimised (its content then
  // measuring 0 by 0) or not, and with the focus or not. focus() is refused
  // while `refused` (a background app asking, the game in front).
  class Win extends EventEmitter {
    constructor() {
      super();
      this.webContents = new Contents();
      Object.assign(this, { visible: false, minimized: false, focused: false, dead: false, refused: false });
      const kids = [];
      this.contentView = {
        children: kids,
        addChildView: (v) => { const i = kids.indexOf(v); if (i !== -1) kids.splice(i, 1); kids.push(v); },
        removeChildView: (v) => { const i = kids.indexOf(v); if (i !== -1) kids.splice(i, 1); },
      };
      wins.push(this);
    }
    loadFile() {}
    isDestroyed() { return this.dead; }
    // Asked to close, as its X, Alt+F4 and the taskbar's Close ask: the event
    // a listener can hold, and closed for real when none does.
    close() {
      const e = { prevented: false, preventDefault() { this.prevented = true; } };
      this.emit('close', e);
      if (!e.prevented) { this.visible = false; this.dead = true; this.emit('closed'); }
      return e;
    }
    getContentSize() { return this.minimized ? [0, 0] : [1200, 780]; }
    getBounds() { return { x: 0, y: 0, width: 1200, height: 780 }; }
    isVisible() { return this.visible; }
    isMinimized() { return this.minimized; }
    isFocused() { return this.focused; }
    isMaximized() { return false; }
    show() { this.visible = true; this.emit('show'); }
    showInactive() { this.visible = true; this.emit('show'); }
    hide() { this.visible = false; this.focused = false; this.emit('hide'); }
    focus() { if (this.refused) return; this.focused = true; this.emit('focus'); }
    minimize() { this.minimized = true; this.focused = false; this.emit('minimize'); }
    restore() { this.minimized = false; this.emit('restore'); }
    maximize() {}
    unmaximize() {}
    // Out of every capture or not (8.3), and how often Windows was asked.
    setContentProtection(on) { this.protected = !!on; this.protectAsks = (this.protectAsks || 0) + 1; }
  }
  let quits = 0;
  const ipc = new EventEmitter();
  const electron = { app: { on() {}, quit() { quits++; } }, BrowserWindow: Win, WebContentsView: View, screen: { getAllDisplays: () => [] }, ipcMain: ipc };
  const clock = { now: 0, seq: 0, timers: new Map() };
  const tick = (ms) => {
    clock.now += ms;
    for (const [h, t] of [...clock.timers]) if (t.at <= clock.now) { clock.timers.delete(h); t.fn(); }
  };
  const real = { setTimeout: global.setTimeout, clearTimeout: global.clearTimeout, setImmediate: global.setImmediate };
  global.setTimeout = (fn, ms) => { const h = ++clock.seq; clock.timers.set(h, { fn, at: clock.now + ms }); return h; };
  global.clearTimeout = (h) => { clock.timers.delete(h); };
  // The next turn, run by hand (turn()): a close is handed to index.js there.
  const immediates = [];
  global.setImmediate = (fn, ...args) => { immediates.push(() => fn(...args)); return immediates.length; };
  const turn = () => { while (immediates.length) immediates.shift()(); };
  const file = require.resolve('../src/main/windows/main-window');
  const load = Module._load;
  Module._load = function (request, parent, ...rest) {
    if (request === 'electron') return electron;
    if (request === '../services/store' && parent && parent.filename === file) return { get: () => undefined, set() {} };
    return load.call(this, request, parent, ...rest);
  };
  try {
    let mw = null;
    try { mw = require(file); } finally { Module._load = load; }
    const viewOf = (id) => mw.pageViews().get(id);
    const settled = (page) => { const s = mw.motionState(); return s.onScreen === page && !s.coming && !s.staged; };
    const waiting = (page) => { const s = mw.motionState(); return !!(s.coming && s.coming.to === page && s.staged === page && !s.onScreen); };
    const readyFrom = (id) => mw.pageReady(id, viewOf(id).webContents);

    // Made out of sight, as at launch behind the splash: its first page is
    // staged, and the timer lets nothing in while the window is hidden.
    mw.create({ deferShow: true });
    const w = wins[wins.length - 1];
    ok(waiting('home'), 'made out of sight, the window\'s first page is staged');
    tick(READY_MS * 3);
    ok(waiting('home'), 'and while the window is hidden its timer leaves it staged');
    w.show();
    w.focus();
    tick(READY_MS - 1);
    ok(waiting('home'), 'shown and focused, its wait starts again');
    ok(readyFrom('home') && settled('home'), 'and its ready, its view painting at last, places it');

    // OUT OF THE RECORDING WHILE SEALED (8.3): the match is recorded off the
    // screen, and the window sealed over it would be in the video.
    ok(w.protected === false, 'unsealed, the window is in captures: a review can be screenshotted or streamed');
    mw.setSealed(true);
    ok(w.protected === true, 'sealed, it is out of every capture, the match\'s recording included');
    const asks = w.protectAsks;
    mw.setSealed(true);
    mw.setSealed(true, { held: true });
    ok(w.protectAsks === asks && w.protected === true, 'the seal checked again each second asks Windows nothing more, held or not');
    mw.setSealed(false);
    ok(w.protected === false, 'unsealed, back in captures');

    // A match: sealed. Its end, with the game in front: shown, but the focus
    // a background app asks for is refused.
    mw.setSealed(true);
    w.focused = false;
    w.refused = true;
    mw.setSealed(false);
    mw.show('review');
    ok(waiting('review'), 'the seal lifting behind the game stages the review');
    tick(READY_MS * 3);
    ok(waiting('review'), 'and its timer leaves it staged: the window cannot be seen, so the view cannot paint');
    w.refused = false;
    w.focus();
    tick(READY_MS - 1);
    ok(waiting('review'), 'the player tabbing to the window starts its wait again');
    tick(1);
    ok(settled('review'), `and a review that never answered comes in ${READY_MS}ms after the window is seen`);

    // Minimised, then restored with the focus it had. Staged while the
    // window's content measured 0 by 0, the page was laid out 0 by 0, and no
    // resize comes on the way back: restored, the views are laid out again,
    // or it could never paint.
    mw.setSealed(true);
    w.minimize();
    mw.setSealed(false);
    tick(READY_MS * 3);
    ok(waiting('review'), 'minimised, a staged page is not let in by its timer');
    w.focused = true;
    w.restore();
    const edge = viewOf('review').getBounds();
    ok(edge.x === 1200 - mw.STAGE_PX && edge.y === mw.TOP_H && edge.width === 1200 - mw.SIDEBAR_W && edge.height === 780 - mw.TOP_H,
      `restored, the staged page is laid out again at the page area's edge, where it can paint (${JSON.stringify(edge)})`);
    tick(READY_MS);
    ok(settled('review'), 'and it comes in once its wait has run again');

    // Hidden to the tray, then shown with the focus.
    mw.setSealed(true);
    w.hide();
    mw.setSealed(false);
    tick(READY_MS * 3);
    ok(waiting('review'), 'hidden, a staged page is not let in by its timer');
    w.focused = true;
    w.show();
    tick(READY_MS);
    ok(settled('review'), 'shown again, it comes in once its wait has run again');

    // THE RECORDING VIEW (9.1): Start takes every page away, with no seal
    // and so no protection from capture; a page opened takes its place.
    mw.setRecordingView(true);
    ok(mw.current().rec && !mw.current().sealed && mw.motionState().onScreen === null && !viewOf('review').getVisible() && w.protected === false,
      'Start: the Recording view, no page on screen, not sealed and so still in captures', JSON.stringify(mw.current()));
    ok(mw.shellState().rec === true && mw.shellState().held === false, 'and the shell is told so (PUSH_SHELL, SHELL_GET)');
    mw.setSealed(true);
    mw.setSealed(false);
    ok(mw.current().rec && mw.motionState().onScreen === null && !mw.motionState().coming, 'a match sealed and over with no page asked for: still the Recording view');
    mw.show('matches');
    ok(!mw.current().rec && waiting('matches'), 'a page opened between matches takes its place, staged as from the seal');
    tick(READY_MS);
    ok(settled('matches'), 'and comes in');
    mw.setRecordingView(true);
    mw.setRecordingView(false);
    ok(!mw.current().rec && waiting('matches'), 'recording stopped: the page the player was on comes back');
    tick(READY_MS);
    ok(settled('matches'), 'and settles');

    // A PAGE LOADING AGAIN. Ask Coach was on screen, the review came over it,
    // and Ask about this match loads Ask Coach again: until its new document
    // commits, the old one's ready (its two frames queued in a view that could
    // not paint them) is not the switch's.
    mw.show('coach');
    readyFrom('coach');
    mw.show('review');
    readyFrom('review');
    ok(settled('review'), 'the review on screen, over Ask Coach');
    mw.show('coach', { reload: true });
    const coach = viewOf('coach').webContents;
    ok(coach.reloads === 1 && mw.motionState().coming && mw.motionState().coming.to === 'coach' && mw.motionState().onScreen === 'review',
      'Ask about this match loads the page again, under the review');
    ok(!readyFrom('coach') && mw.motionState().coming.to === 'coach' && mw.motionState().onScreen === 'review',
      'a ready from the document being replaced changes nothing: the review stays over it');
    coach.emit('did-fail-load', {}, -6, 'ERR_FILE_NOT_FOUND', 'file:///chat/frame.html', false);
    ok(!readyFrom('coach') && mw.motionState().onScreen === 'review', 'nor once a frame inside it fails to load');
    coach.emit('did-navigate', {}, 'file:///chat/index.html', 200, 'OK');
    ok(readyFrom('coach') && settled('coach'), 'the new document committed, its ready lets the page in');
    mw.show('coach', { reload: true });
    ok(!readyFrom('coach'), 'loaded again in place, the old document\'s ready is refused as well');
    coach.emit('did-fail-load', {}, -6, 'ERR_FILE_NOT_FOUND', 'file:///chat/index.html', true);
    ok(readyFrom('coach'), 'and an error page taking the old document\'s place ends the wait for it too');

    // A window made again starts with nothing loading.
    mw.show('coach', { reload: true });
    ok(mw.motionState().reloading.includes('coach'), 'loading again, the page is marked so');
    w.dead = true;
    w.emit('closed');
    mw.show('review');
    ok(wins.length === 2 && !mw.motionState().reloading.length, 'the window gone and made again, no page is left marked loading');
    // Made again mid match, it keeps the seal, and is out of captures from
    // before its first frame.
    mw.setSealed(true);
    const again = wins[wins.length - 1];
    again.dead = true;
    again.emit('closed');
    mw.show('review');
    const third = wins[wins.length - 1];
    ok(wins.length === 3 && mw.current().sealed && third.protected === true && third.protectAsks === 1,
      'made again while sealed, the new window is out of captures from its creation');

    // THE ACCOUNT MENU FLOATS OVER THE PAGE (8.9.1). The shell opens it with
    // its rows and rectangle (SHELL_MENU); main lays a see-through view of its
    // own over the page, at that rectangle cut to the window, on top of every
    // page, and the page keeps its bounds. Only the shell may open it and only
    // the menu's view may choose or shut it from inside.
    {
      const CH = require('../src/shared/channels');
      mw.setSealed(false);
      const page = viewOf('review');
      const before = JSON.stringify(page.bounds);
      const rows = '<button id="nav-settings" role="menuitem">Settings</button>';
      const ask = { open: true, html: rows, rect: { x: 1200 - 296 - 28, y: 64, width: 336, height: 300 },
        inset: { left: 28, top: 8 }, box: { width: 280, height: 252 }, focus: 'first' };
      ipc.emit(CH.SHELL_MENU, { sender: viewOf('review').webContents }, ask);
      ok(!mw.menuState().open, 'a page cannot open the account menu: only the shell can');
      ipc.emit(CH.SHELL_MENU, { sender: third.webContents }, ask);
      const ms = mw.menuState();
      const kids = third.contentView.children;
      ok(ms.open && ms.view && kids[kids.length - 1] === ms.view && JSON.stringify(page.bounds) === before,
        'the shell opens it: a view of its own on top of every page, and the page keeps its bounds, no strip taken from it', JSON.stringify(page.bounds));
      ok(ms.bounds.x === 876 && ms.bounds.y === 64 && ms.bounds.width === 1200 - 876 && ms.bounds.height === 300,
        'laid at the rectangle the shell asked, cut at the window\'s right edge', JSON.stringify(ms.bounds));
      ms.view.webContents.emit('did-finish-load');
      const drawn = ms.view.webContents.sent.filter((s) => s.ch === CH.PUSH_MENU);
      ok(drawn.length === 1 && drawn[0].msg.html === rows && drawn[0].msg.left === 28 && drawn[0].msg.top === 8 && drawn[0].msg.fresh && drawn[0].msg.focus === 'first',
        'what it draws waits for its document, then is the shell\'s rows, where the menu sits in it, and the first row focused', JSON.stringify(drawn[0] && drawn[0].msg));
      // A page coming in under the motion is raised over the old one, and the menu stays above both.
      mw.show('coach');
      ok(kids[kids.length - 1] === ms.view, 'a page made or raised while it is open stays under the menu');
      const toShell = () => third.webContents.sent.filter((s) => s.ch === CH.PUSH_MENU_ACT).map((s) => s.msg);
      ipc.emit(CH.MENU_ACT, { sender: third.webContents }, { choose: 'nav-settings' });
      ok(!toShell().length, 'only the menu\'s view says what was chosen');
      ipc.emit(CH.MENU_ACT, { sender: ms.view.webContents }, { choose: 'nav-settings' });
      ok(toShell().length === 1 && toShell()[0].choose === 'nav-settings', 'and the shell is told, to carry it out on its own row');
      ipc.emit(CH.MENU_ACT, { sender: ms.view.webContents }, { close: true, refocus: true });
      const shut = toShell();
      ok(!mw.menuState().open && !ms.view.visible && shut[1] && shut[1].closed && shut[1].refocus,
        'shut from inside (Escape, Tab), its view hides and the shell is told, to give the avatar the focus');
      ok(ms.view.webContents.sent[ms.view.webContents.sent.length - 1].msg.html === '', 'and the view forgets its rows, so the next opening never flashes the last');
      ipc.emit(CH.SHELL_MENU, { sender: third.webContents }, ask);
      ok(mw.menuState().open && mw.menuState().view === ms.view, 'opened again, the same view, kept between openings');
      third.emit('blur');
      ok(!mw.menuState().open, 'the window losing the focus shuts it');
      ipc.emit(CH.SHELL_MENU, { sender: third.webContents }, ask);
      ipc.emit(CH.SHELL_MENU, { sender: third.webContents }, { open: false });
      ok(!mw.menuState().open && toShell().length === 3, 'the shell shutting it is not told back');
      mw.show('review');
    }

    // THE GAMES TOAST (8.9.1, ui.md "The games toast"): a see-through view of
    // its own at the top right under the bar, over every page, one toast at a
    // time. Never while sealed: it waits, and one on screen as the seal comes
    // on goes in the same tick and is put back at the front. Hidden or
    // minimised, the same. Only its own view may say one is done or clicked,
    // and a click opens Profile through index.js.
    {
      const CH = require('../src/shared/channels');
      mw.setSealed(false);
      third.show();
      third.minimized = false;
      const page = viewOf('review');
      const before = JSON.stringify(page.bounds);
      const clicked = [];
      mw.onToastClick(() => clicked.push('profile'));
      const T = (id, n) => ({ id, kind: 'invite', pre: 'You got ', n, post: ' games', line: 'Your invite paid off.' });
      mw.setSealed(true);
      ok(mw.toast(T('g1', 4)), 'a toast is taken');
      let ts = mw.toastState();
      ok(!ts.shown && ts.queued.join() === 'g1', 'sealed (a match on): it waits, nothing on screen', JSON.stringify({ shown: ts.shown, q: ts.queued }));
      mw.setSealed(false);
      ts = mw.toastState();
      const kids = third.contentView.children;
      ok(ts.shown && ts.now.id === 'g1' && kids[kids.length - 1] === ts.view && JSON.stringify(page.bounds) === before,
        'the seal lifted: it comes, on top of every page, and the page keeps its bounds');
      ok(ts.bounds.x === 0 && ts.bounds.y === 0 && ts.bounds.width === 1200 && ts.bounds.height === 780,
        'over the whole window, so the scrim covers every page and the bar', JSON.stringify(ts.bounds));
      ts.view.webContents.emit('did-finish-load');
      const drawn = () => ts.view.webContents.sent.filter((x) => x.ch === CH.PUSH_TOAST).map((x) => x.msg);
      ok(drawn().length === 1 && drawn()[0].toast.id === 'g1' && drawn()[0].toast.n === 4, 'what it draws waits for its document');
      mw.toast(T('g2', 10));
      ok(mw.toastState().now.id === 'g1' && mw.toastState().queued.join() === 'g2', 'a second waits its turn');
      ok(!mw.toast(T('g2', 10)), 'and the same toast is never queued twice');
      mw.setSealed(true);
      ts = mw.toastState();
      ok(!ts.shown && !ts.view.visible && ts.queued.join() === 'g1,g2' && drawn()[drawn().length - 1].clear,
        'the seal coming on with one on screen: gone in the same tick, back at the front, its view told to clear');
      mw.setSealed(false);
      ok(mw.toastState().shown && mw.toastState().now.id === 'g1', 'lifted: the first again, whole');
      ipc.emit(CH.TOAST_ACT, { sender: third.webContents }, { done: 'g1' });
      ok(mw.toastState().now.id === 'g1', 'only the toast\'s own view may say it is done');
      ipc.emit(CH.TOAST_ACT, { sender: ts.view.webContents }, { done: 'zz' });
      ok(mw.toastState().now.id === 'g1', 'nor for a toast not on screen');
      ipc.emit(CH.TOAST_ACT, { sender: ts.view.webContents }, { done: 'g1' });
      ok(mw.toastState().shown && mw.toastState().now.id === 'g2', 'done: the next comes');
      ipc.emit(CH.TOAST_ACT, { sender: ts.view.webContents }, { open: 'g2' });
      ok(!mw.toastState().shown && !ts.view.visible && clicked.join() === 'profile', 'clicked: over, its view hidden, and Profile asked for');
      third.hide();
      mw.toast(T('g3', 2));
      ok(!mw.toastState().shown && mw.toastState().queued.join() === 'g3', 'the window hidden: it waits');
      third.show();
      ok(mw.toastState().shown && mw.toastState().now.id === 'g3', 'shown again: it comes');
      third.minimize();
      ok(!mw.toastState().shown && mw.toastState().queued.join() === 'g3', 'minimised with it on screen: it goes, and waits');
      third.restore();
      ok(mw.toastState().shown, 'restored: back');
      ipc.emit(CH.TOAST_ACT, { sender: ts.view.webContents }, { done: 'g3' });
      ok(!mw.toastState().shown && !mw.toastState().queued.length, 'and done');
      mw.onToastClick(null);
      mw.show('review');
    }

    // OCCLARA WRAPPED (docs/claude/wrapped.md): a view of its own over the
    // WHOLE window, the bar included, made for one showing and closed after
    // it. Never while sealed, hidden or minimised; the seal closes it in the
    // same tick, its page with it; hidden or minimised it is told to pause;
    // only its own view may close it from inside.
    {
      const CH = require('../src/shared/channels');
      mw.setSealed(false);
      third.show();
      third.minimized = false;
      mw.setSealed(true);
      ok(!mw.openWrapped() && !mw.wrappedState().open, 'sealed (a match on): Wrapped does not open');
      mw.setSealed(false);
      third.hide();
      ok(!mw.openWrapped(), 'the window hidden: Wrapped does not open to nobody');
      third.show();
      third.minimize();
      ok(!mw.openWrapped(), 'minimised: nor then');
      third.restore();
      const page = viewOf('review');
      const before = JSON.stringify(page.bounds);
      ok(mw.openWrapped(), 'shown and unsealed: it opens');
      let ws = mw.wrappedState();
      const kids = third.contentView.children;
      ok(ws.open && kids[kids.length - 1] === ws.view && JSON.stringify(page.bounds) === before, 'on top of every page, which keeps its bounds');
      ok(ws.bounds.x === 0 && ws.bounds.y === 0 && ws.bounds.width === 1200 && ws.bounds.height === 780, 'over the whole window, the bar included', JSON.stringify(ws.bounds));
      const T = { id: 'w1', kind: 'invite', pre: 'You got ', n: 2, post: ' games', line: 'Your invite paid off.' };
      mw.toast(T);
      ok(mw.toastState().shown && kids.indexOf(mw.toastState().view) > kids.indexOf(ws.view), 'a games reveal comes over it, not under');
      let wrappedFocused = 0;
      ws.view.webContents.focus = () => { wrappedFocused += 1; };
      ipc.emit(CH.TOAST_ACT, { sender: mw.toastState().view.webContents }, { done: 'w1' });
      ok(wrappedFocused === 1, 'the reveal done, the keyboard goes back to Wrapped, not the shell');
      // Out of focus (the game in front on another monitor): paused; the focus back: resumed.
      const sentNow = () => ws.view.webContents.sent.filter((x) => x.ch === CH.PUSH_WRAPPED).map((x) => x.msg);
      third.emit('blur');
      ok(sentNow().slice(-1)[0].pause === true, 'the window losing the focus pauses it, story and sound');
      third.emit('focus');
      ok(sentNow().slice(-1)[0].resume === true, 'and the focus back resumes it (the page plays on only if this paused it)');
      third.hide();
      ok(ws.view.webContents.sent.some((x) => x.ch === CH.PUSH_WRAPPED && x.msg.pause), 'hidden: it is told to pause');
      third.show();
      ipc.emit(CH.WRAPPED_ACT, { sender: page.webContents }, { close: true });
      ok(mw.wrappedState().open, 'a page cannot close it: only its own view');
      const wcOne = ws.view.webContents;
      // THE SEAL NEVER REFOCUSES: no page, no shell given the keyboard as it
      // closes Wrapped (focusing web contents on Windows raises its window).
      let focusedOnSeal = 0;
      const views0 = [...mw.pageViews().values()].map((v) => v.webContents);
      for (const c of [...views0, third.webContents]) { const f = c.focus; c.focus = () => { focusedOnSeal += 1; f.call(c); }; }
      mw.setSealed(true);
      ok(focusedOnSeal === 0, 'the seal closes Wrapped and focuses nothing', String(focusedOnSeal));
      ws = mw.wrappedState();
      ok(!ws.open && wcOne.dead && !third.contentView.children.includes(ws.view || {}), 'the seal coming on: gone in the same tick, its page closed, nothing left to play');
      mw.setSealed(false);
      ok(!mw.wrappedState().open, 'and the seal lifting brings nothing back by itself');
      ok(mw.openWrapped(), 'opened again: a new view');
      const wcTwo = mw.wrappedState().view.webContents;
      ok(wcTwo !== wcOne, 'never the old page');
      ipc.emit(CH.WRAPPED_ACT, { sender: wcTwo }, { close: true });
      ok(!mw.wrappedState().open && wcTwo.dead, 'closed from inside (Escape, its X): its view goes and its page is closed');
      mw.show('review');
    }

    // CLOSING QUITS (8.4.1). Its X, Alt+F4 and the taskbar's Close are the
    // window's 'close': held, and handed to index.js, which quits by the
    // tray's own path, asking first when that would lose something. Never
    // hidden in the tray any more, which is what a close used to do.
    mw.setSealed(false);
    third.visible = true;
    const asked = [];
    let hides = 0;
    third.on('hide', () => { hides++; });
    mw.onCloseAsk(() => asked.push('close'));
    const held = third.close();
    // NEVER INSIDE THE CLOSE EVENT: Electron takes a close prevented there for
    // a quit cancelled, so a quit index.js decides in the same turn closed
    // every window and the process ran on with none (main-window.js).
    ok(held.prevented && asked.length === 0, 'a close is held, and index.js is not handed it inside the close event itself');
    turn();
    ok(asked.length === 1 && third.visible && !third.dead && !hides,
      'but on the next turn, the window left as it was, never hidden in the tray');
    mw.close();
    turn();
    ok(asked.length === 2 && third.visible && !third.dead, 'and the top strip\'s X is that same close');
    mw.onCloseAsk(null);
    const quitsBefore = quits;
    const bare = third.close();
    const quitsInEvent = quits;
    turn();
    ok(bare.prevented && quitsInEvent === quitsBefore && quits === quitsBefore + 1 && !third.dead,
      'with nothing set to ask, a close quits the app, on the next turn too');
    mw.onCloseAsk(() => asked.push('close'));
    third.close();
    third.emit('session-end');
    turn();
    ok(asked.length === 2, 'a close whose turn comes after Windows began ending its session asks nothing');
    const ending = third.close();
    turn();
    ok(!ending.prevented && asked.length === 2 && third.dead,
      'Windows ending its session: the window closes for real, and nothing is asked');

    // THE SHELL IS DRAWN TO THE SIZES ITS PAGES ARE LAID BESIDE (change them
    // together, CLAUDE.md). A page is laid at x = SIDEBAR_W and y = TOP_H over
    // the shell's own document, so its top strip is TOP_H tall, and the notice
    // line in that strip (8.3, the record card's line until then) one line,
    // cut rather than wrapped: wrapped, its second line would be under the page.
    const shellDir = path.join(__dirname, '..', 'src', 'renderer', 'shell');
    const css = fs.readFileSync(path.join(shellDir, 'shell.css'), 'utf8');
    const markup = fs.readFileSync(path.join(shellDir, 'index.html'), 'utf8');
    const rule = (sel) => {
      const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return (css.match(new RegExp(`(?:^|\\n)${esc}\\s*\\{([^}]*)\\}`)) || [])[1] || '';
    };
    const prop = (body, name) => ((body.match(new RegExp(`(?:^|[;\\s])${name}\\s*:\\s*([^;]+);`)) || [])[1] || '').trim();
    // TOP NAVIGATION (Progress v3): no sidebar (SIDEBAR_W 0) and the bar
    // TOP_H tall. THE MENU FLOATS OVER THE PAGE (8.9.1): the page gives up no
    // width for it (DRAWER_W is gone), and the shell's #drawer is laid out,
    // never painted, its rows drawn by the menu's own view.
    const drawer = rule('.drawer');
    ok(mw.SIDEBAR_W === 0 && !/class="side"/.test(markup) && prop(rule('.bar'), 'height') === `${mw.TOP_H}px`
      && prop(rule('.bar'), 'flex') === `0 0 ${mw.TOP_H}px`
      && prop(drawer, 'width') === '280px' && /var\(--space-4\)/.test(prop(drawer, 'margin'))
      && mw.DRAWER_W === undefined && prop(rule('#drawer'), 'visibility') === 'hidden',
    `the shell has no sidebar, its bar is TOP_H (${mw.TOP_H}px) tall, and its 280px menu takes no width from the pages, drawn over them`);
    const strip = (markup.match(/<header class="bar drag"[^>]*>([\s\S]*?)<div class="bar-end/) || [])[1] || '';
    ok(/<p id="notice" class="top-notice no-drag" aria-live="polite"><\/p>/.test(strip)
      && prop(rule('.top-notice'), 'white-space') === 'nowrap' && prop(rule('.top-notice'), 'text-overflow') === 'ellipsis'
      && !/id="line"|rec-line/.test(markup + css),
    'and the notice line is in that bar, before its end, empty and never hidden until it has something to say, and one line when it does');
  } finally {
    Object.assign(global, real);
  }
}

// ── The tray icon opens the app (8.4.1) ───────────────────────────────────
// The real tray.js on a stand-in Tray. The icon had a double click alone, and
// that toggled the window, so a click did nothing and a double click on a
// window behind the game hid it. A click and a double click bring it up, and
// the context menu is as it was.
{
  const EventEmitter = require('events');
  const Module = require('module');
  const made = [];
  class Tray extends EventEmitter {
    constructor(image) { super(); this.menu = null; this.tip = ''; this.image = image; made.push(this); }
    setToolTip(t) { this.tip = t; }
    setContextMenu(m) { this.menu = m; }
    setImage(image) { this.image = image; }
    destroy() {}
  }
  // THE CRESCENT FOLLOWS THE TASKBAR (8.6): a stand-in for Windows' theme, and
  // pictures that remember the file they were drawn from. A shrink, the 16px
  // resize of icon.png the tray used before, is counted.
  const theme = Object.assign(new EventEmitter(), { shouldUseDarkColorsForSystemIntegratedUI: true });
  let resized = 0;
  const electron = {
    Tray, Menu: { buildFromTemplate: (t) => t }, app: {}, nativeTheme: theme,
    nativeImage: {
      createFromPath: (p) => ({ file: path.basename(p), resize: () => { resized++; return {}; } }),
      createEmpty: () => ({ file: null }),
    },
  };
  let filesThere = true;
  const trayFs = { ...fs, existsSync: (p) => filesThere && fs.existsSync(p) };
  const file = require.resolve('../src/main/tray');
  const load = Module._load;
  Module._load = function (request, parent, ...rest) {
    if (request === 'electron' && parent && parent.filename === file) return electron;
    if (request === 'fs' && parent && parent.filename === file) return trayFs;
    return load.call(this, request, parent, ...rest);
  };
  let trayMod = null;
  try { delete require.cache[file]; trayMod = require(file); } finally { Module._load = load; }
  const calls = [];
  const actions = { isMinimized: () => true };
  for (const k of ['start', 'stop', 'show', 'toggleMinimize', 'openReview', 'openHistory', 'openWeekly', 'openAiLog', 'openSettings', 'quit']) {
    actions[k] = () => calls.push(k);
  }
  trayMod.create(actions);
  const t = made[0];
  ok(!!t && !!t.image && t.image.file === 'tray-dark.ico' && !resized,
    'on a dark taskbar the tray draws the moon in the ink, tray-dark.ico, shrunk from nothing', t && t.image && t.image.file);
  theme.shouldUseDarkColorsForSystemIntegratedUI = false;
  theme.emit('updated');
  ok(!!t && !!t.image && t.image.file === 'tray-light.ico' && !resized,
    'and Windows going light repaints it in the ground, tray-light.ico', t && t.image && t.image.file);
  // Recording, the record ring with the moon as its dot; stopped, the moon again.
  trayMod.update(true, actions);
  ok(!!t && !!t.image && t.image.file === 'tray-rec-light.ico', 'recording, the tray is the record ring with the moon as its dot, tray-rec-light.ico', t && t.image && t.image.file);
  theme.shouldUseDarkColorsForSystemIntegratedUI = true;
  theme.emit('updated');
  ok(!!t && !!t.image && t.image.file === 'tray-rec-dark.ico', 'and a theme change while recording keeps the ring, tray-rec-dark.ico', t && t.image && t.image.file);
  trayMod.update(false, actions);
  ok(!!t && !!t.image && t.image.file === 'tray-dark.ico', 'stopped, the moon alone again', t && t.image && t.image.file);
  theme.shouldUseDarkColorsForSystemIntegratedUI = false;
  theme.emit('updated');
  ok(['tray-dark.ico', 'tray-light.ico', 'tray-rec-dark.ico', 'tray-rec-light.ico'].every((f) => fs.existsSync(path.join(__dirname, '..', 'assets', f))),
    'all four pictures are in assets, drawn by scripts/generate-icon.js');
  filesThere = false;
  theme.emit('updated');
  ok(!!t && !!t.image && t.image.file === null, 'a picture missing from assets is an empty one, never a throw');
  filesThere = true;
  theme.shouldUseDarkColorsForSystemIntegratedUI = true;
  theme.emit('updated');
  ok(!!t && t.listenerCount('click') === 1 && t.listenerCount('double-click') === 1, 'the icon listens for a click and a double click');
  if (t) t.emit('click');
  ok(calls.join() === 'show', 'a click on the icon brings the window up and to the front');
  if (t) t.emit('double-click');
  ok(calls.join() === 'show,show', 'and so does a double click, which never hides it any more');
  const labels = (t && t.menu ? t.menu : []).map((i) => (i.type === 'separator' ? '-' : i.label));
  ok(labels.join('|') === 'Start Recording|Show Occlara|Last Review…|Matches…|Weekly Report…|AI Log…|Settings…|-|Quit Occlara',
    'the context menu is as it was', labels.join('|'));
  calls.length = 0;
  if (t) t.menu[1].click();
  if (t) t.menu[8].click();
  ok(calls.join() === 'toggleMinimize,quit', 'its Show or Hide still toggles the window, and its Quit still quits');
  trayMod.update(true, { ...actions, isMinimized: () => false });
  ok(t && t.menu[0].label === 'Stop Recording' && t.menu[1].label === 'Hide Occlara' && t.tip === 'Occlara, recording',
    'and it follows the recording and the window as before');
  ok(theme.listenerCount('updated') === 1, 'it listens for the theme once');
  trayMod.destroy();
  ok(theme.listenerCount('updated') === 0, 'and gone, it no longer does');
}

// ── Closing quits, and asks first when that would lose something (8.4.1) ──
// shared/quit-ask.js, every wording, and shared/review-work.js leftOf(), what
// a review still being built would lose.
{
  const { matchQuestion, reviewQuestion, clipsQuestion, STAY_RECORDING, STAY_OPEN } = require('../src/shared/quit-ask');
  const { leftOf } = require('../src/shared/review-work');
  const DASH = new RegExp(`[${String.fromCharCode(0x2013)}${String.fromCharCode(0x2014)}]`);
  ok(DASH.test(String.fromCharCode(0x2014)) && DASH.test(String.fromCharCode(0x2013)) && !DASH.test('-'), 'the dash test finds both dashes and no hyphen');
  const all = [];
  const q = (x) => { if (x) all.push(x); return x; };

  const m7 = q(matchQuestion({ game: 'valorant', rounds: 7, connected: true, clips: true }));
  ok(m7 && m7.message === 'A match is being recorded. Quit and stop recording?'
    && m7.detail === 'The 7 rounds recorded so far are kept in Matches as part of a match, as the screen read them, '
      + "with no coach's read and no video clips. It is checked against Riot's record at a later launch, once the match is over. "
      + 'Keep recording and the whole match is reviewed when it ends.',
  'a match being recorded: its rounds kept in Matches as a part, with no read or clips, checked at a later launch', m7 && m7.detail);
  const m1 = q(matchQuestion({ game: 'valorant', rounds: 1, connected: false, clips: false }));
  ok(m1 && m1.detail === "The round recorded so far is kept in Matches as part of a match, as the screen read it, with no coach's read. "
    + 'Keep recording and the whole match is reviewed when it ends.',
  'one round, no Riot ID connected and nothing recorded on this PC: nothing said of either', m1 && m1.detail);
  const m0 = q(matchQuestion({ game: 'valorant', rounds: 0, connected: true, clips: true }));
  ok(m0 && m0.detail === 'No round of it has been recorded yet, so nothing of it is kept. Keep recording and the match is reviewed when it ends.',
    'no round read yet: nothing of it is kept, and it says so', m0 && m0.detail);
  const lol = q(matchQuestion({ game: 'lol', rounds: 0, connected: true, clips: true }));
  ok(lol && lol.message === 'A game is being recorded. Quit and stop recording?'
    && lol.detail === 'A game stopped part way is not reviewed, so nothing of this one is kept. Keep recording and it is reviewed when it ends.',
  'a League game being recorded: one stopped part way is not graded (lol-recorder.js stop())', lol && lol.detail);
  ok(matchQuestion(null) === null && reviewQuestion(null) === null && reviewQuestion({ left: null }) === null, 'nothing at stake, nothing asked');

  const riotLeft = { path: 'riot', narrated: true, recordIn: false, scoreboard: false, part: false };
  const rc = q(reviewQuestion({ left: riotLeft, riotIdSet: true, connected: true, clips: true }));
  ok(rc && rc.message === "Your last match is still being checked against Riot's record. Quit now?"
    && rc.detail === 'Quit now and it is checked at a later launch instead, once Riot has the match, without the coach\'s look '
      + 'at your deaths, their video clips or a written read. Keep Occlara open and it finishes by itself.',
  'a review checked against Riot\'s record: a later launch checks it, without the look, the clips or a read (riot-review.js upgradeWatched)', rc && rc.detail);
  const rt = q(reviewQuestion({ left: riotLeft, riotIdSet: true, connected: false, clips: false }));
  ok(rt && rt.detail === 'Quit now and it stays as the screen read it until you press Grade my recent matches in Matches, '
    + "which lays Riot's record over it without the coach's look at your deaths or a written read. Keep Occlara open and it finishes by itself.",
  'a Riot ID typed and never connected runs no late link: Grade my recent matches is what checks it then', rt && rt.detail);
  const rn = q(reviewQuestion({ left: riotLeft, riotIdSet: false, connected: false, clips: true }));
  ok(rn && rn.detail === "Quit now and it is kept as the screen read it, without Riot's record, the coach's look at your deaths "
    + 'or their video clips. Keep Occlara open and it finishes by itself.',
  'the Riot ID taken out of Settings meanwhile: nothing will check it, and its read stays', rn && rn.detail);
  const sw = q(reviewQuestion({ left: { path: 'screen', narrated: false }, riotIdSet: false, connected: false, clips: true }));
  ok(sw && sw.message === "Your last match's review is still being written. Quit now?"
    && sw.detail === "Quit now and it is kept as the screen read it, without the coach's read, its look at your deaths or their video clips. "
      + 'Keep Occlara open and it finishes by itself, usually in a minute or two.',
  'from the screen alone, the narrative still to come: kept without the read or the look', sw && sw.detail);
  const sl = q(reviewQuestion({ left: { path: 'screen', narrated: true }, riotIdSet: false, connected: false, clips: false }));
  ok(sl && sl.detail === "Quit now and it is kept without the coach's look at your deaths. Keep Occlara open and it finishes by itself, usually in a minute or two.",
    'the narrative in, the look still out: kept without the look', sl && sl.detail);
  // A League game's deaths are cut six seconds after its review opens
  // (index.js clipLolDeaths), from the recording a quit deletes.
  const cq = q(clipsQuestion({ cutting: 1 }));
  ok(cq && cq.message === "Your last game's death clips are still being saved. Quit now?"
    && cq.detail === 'Quit now and its review is kept without the video clips of your deaths. '
      + 'Keep Occlara open and they are saved by themselves in a few seconds.',
  'a League game\'s death clips still being cut: its review is kept, without them', cq && cq.detail);
  ok(clipsQuestion(null) === null && clipsQuestion({ cutting: 0 }) === null, 'and with none being cut, nothing is asked');
  ok(all.length === 10 && all.every((x) => x.buttons.length === 2 && x.quit === 1
    && x.buttons[0] === (x.kind === 'match' ? STAY_RECORDING : STAY_OPEN) && /^Quit/.test(x.buttons[1])),
  'every question keeps Occlara as it is on its first button, the default and what Escape answers, and quits on its second');
  ok(all.every((x) => !DASH.test(x.message + x.detail + x.buttons.join(''))), 'and none of them carries a dash');

  // What a review still being built would lose (review-work.js leftOf).
  const END = 1_800_000_000_000;
  const HOLD = 60 * 60 * 1000;
  const job = (extra) => ({ id: 'valorant-x', snap: { endedAt: END, endedBy: 'score' }, ...extra });
  const left = (j, at, riot) => leftOf(j, at === undefined ? END + 60000 : at, riot === undefined ? true : riot, HOLD);
  ok(JSON.stringify(left(job({ byRiot: true, narrated: true }))) === JSON.stringify({ path: 'riot', narrated: true, recordIn: false, scoreboard: false, part: false }),
    'a review waiting for Riot\'s record has the check left to lose');
  ok(left(job({ byRiot: true, riotLooked: true })) === null && left(job({ byRiot: true, linkMissing: true })) === null
    && left(job({ byRiot: true, finished: true })) === null && left(job({ byRiot: true, cancelled: true })) === null,
  'and nothing once Riot\'s look has landed, the link has given up, its work is over or it was withdrawn');
  ok(left(job({ byRiot: false, narrated: true, screenLooked: true })) === null && left(job({ byRiot: false })).path === 'screen'
    && left(job({ byRiot: false, narrated: true })).narrated === true, 'from the screen alone, the narrative and the look are what is left');
  ok(left(job({ byRiot: true }), END + HOLD) === null && left(job({ byRiot: true }), END + HOLD - 1) !== null,
    'counted for the hour its match is held at most, as the update\'s question counts it');
  ok(left(job({ byRiot: true, snap: { endedAt: END, endedBy: 'stop', stoppedLive: true } })).part === true,
    'a match recording was stopped in still has its link to lose, and is said to be a part');
  ok(left(job({}), undefined, false).path === 'screen' && left(job({}), undefined, true).path === 'riot',
    'before its narrative, the Riot ID in Settings says which way it is finished');
}

console.log(`\n${fails ? fails + ' of ' + checks + ' failed' : 'all ' + checks + ' shell navigation checks passed'}`);
process.exit(fails ? 1 : 0);

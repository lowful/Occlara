'use strict';

/**
 * What the renderer surfaces do with what arrives, run in node against their
 * real markup, scripts and preloads (scripts/fixtures/fake-dom.js).
 *
 * Every case below was a bug that reached players while every other check in
 * this repo passed, because each one is a surface doing the wrong thing with a
 * correct message:
 *
 *   - the panel never followed the language, because its bridge had no
 *     getConfig, so initI18n threw inside its own try and stayed English
 *   - with the licence ended, the panel's status line kept "Press Start" and
 *     never showed why
 *   (the panel's controls are the shell's sidebar since 8.1, and these cases
 *   run against the shell)
 *   - Settings promised a sound on start and stop, and nothing had played one
 *     since the overlay was removed
 *   - one grade was three colours: red in its library row, yellow in the trend
 *     above it, white in Stats
 *   - the library's trend drew every grade from 77 up at the same height
 *   - Stats never showed a review saved while it was open
 *   - Settings said coaching for League was not built
 *   - the AI log called every 8.0 death a miss, because 8.0 shows nothing
 *     during a match by design and the log still counted reviews
 *   - the activation screen sold "Real-time Valorant AI coaching"
 *
 * Expected colours come from the SPEC (grade.js letters and the tone each
 * letter reads as), never from the module under test, so a wrong rule in
 * grade-view.js cannot agree with itself. Each section fails on its own, so a
 * surface that throws does not hide what the others did. Run against the
 * renderer as it was before these fixes, every section above fails.
 *
 * Layout is not measured here. A CSS change is still looked at
 * (npx electron scripts/shot-surface.js), and only its structure is held below.
 *
 * Run: npm run test:surfaces
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadSurface, loadPreload, Document, settle, nextTab } = require('./fixtures/fake-dom');
const C = require('../src/shared/channels');
const I18N = require('../src/shared/i18n');
const grade = require('../src/shared/grade');
const aiLogStore = require('../src/main/services/ai-log-store');

const ROOT = path.join(__dirname, '..');
const RENDERER = path.join(ROOT, 'src', 'renderer');

let fails = 0;
const ok = (cond, what, detail) => {
  if (!cond) { fails++; console.log(`FAIL  ${what}${detail ? `\n        ${detail}` : ''}`); }
  else console.log(`ok    ${what}`);
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// The two dashes the house rules ban from every string, written as escapes so
// this file carries neither character. Asserted below against both dashes
// built from their code points, and against a plain hyphen it must not match.
const DASHES = /[\u2013\u2014]/;

/** The tone each letter reads as: S and A good, B neutral, C a warning, D a problem. */
const TONE = { S: 'good', A: 'good', B: 'mid', C: 'warn', D: 'bad' };
const toneFor = (score) => TONE[grade.letter(score)];
const toneOf = (el) => ['good', 'mid', 'warn', 'bad'].find((t) => el.classList.contains(t)) || '';

let GradeView = null;
let gradeViewError = null;
try { GradeView = require('../src/renderer/shared/grade-view'); } catch (e) { gradeViewError = e.message; }

/** One area of the app. A throw inside it is that area failing, not the run. */
async function section(title, fn) {
  console.log(`\n${title}`);
  try { await fn(); } catch (e) { ok(false, 'the section ran to the end', (e && e.stack) || String(e)); }
}

// A rejection inside a surface is a surface throwing on a message, which is a
// failure even when every assertion after it happens to pass.
process.on('unhandledRejection', (e) => {
  fails++;
  console.log(`FAIL  a surface rejected a promise: ${(e && e.stack) || e}`);
});

/** Web Audio, enough for shared/sfx.js to really run: it counts what started. */
function fakeAudio() {
  const stats = { started: 0, contexts: 0 };
  const param = () => ({ setValueAtTime() {}, exponentialRampToValueAtTime() {} });
  const node = (extra) => Object.assign({ connect: (n) => n }, extra);
  class AudioContext {
    constructor() { stats.contexts++; this.currentTime = 0; this.sampleRate = 48000; this.state = 'running'; this.destination = {}; }
    createOscillator() { return node({ type: '', frequency: param(), start() { stats.started++; }, stop() {} }); }
    createGain() { return node({ gain: param() }); }
    createBuffer(_ch, frames) { return { getChannelData: () => new Float32Array(frames) }; }
    createBufferSource() { return node({ buffer: null, start() { stats.started++; } }); }
    createBiquadFilter() { return node({ type: '', frequency: param(), Q: param() }); }
    resume() { return Promise.resolve(); }
  }
  return { AudioContext, stats };
}

const BASE = {
  isCoaching: false, isPaused: false, status: 'idle', gameId: 'valorant', licenseActive: true,
  sounds: true, notice: null, lastGrade: null, cadence: null, captureSpeed: 'auto', topAgents: [],
};

async function openShell(cfg, state, opts) {
  const audio = fakeAudio();
  const p = loadSurface('shell', {
    handlers: {
      [C.STATE_GET]: () => ({ ...BASE, ...(state || {}) }), [C.CONFIG_GET]: () => ({ ...cfg }),
      [C.SHELL_GET]: () => ({ page: 'home', shown: 'home', sealed: false, maximized: false }),
    },
    preload: opts && opts.preload,
    window: { AudioContext: audio.AudioContext },
  });
  // Every sound the shell asks for, while the real shared/sfx.js still plays it.
  p.sfx = [];
  p.audio = audio.stats;
  const sfx = p.window.occlaraSfx;
  if (sfx) {
    const real = sfx.play;
    sfx.play = (kind, volume) => { p.sfx.push(kind); return real(kind, volume); };
  }
  await settle();
  // The notice line in the top strip (8.3): its words while it shows, null
  // while it is empty, which is whenever there is nothing to say. It is never
  // hidden, so its live region is there from the start.
  p.notice = () => (p.$('notice').hidden || !p.$('notice').textContent ? null : p.$('notice').textContent);
  p.label = () => p.$('toggle').querySelector('.t-label').textContent;
  return p;
}

(async () => {
  await section('the fake DOM itself:', () => {
    const d = new Document('<div id="a" class="x y" hidden data-i18n="k"><span class="t">hi</span>'
      + '<svg><path d="M1 2"/></svg><img src="a.svg"><b>two</b></div>');
    const a = d.getElementById('a');
    ok(a && a.hidden && a.classList.contains('y') && a.getAttribute('data-i18n') === 'k',
      'parses ids, classes, bare attributes and data attributes');
    ok(a.querySelector('span.t').textContent === 'hi' && d.querySelectorAll('div[data-i18n="k"] > b').length === 1
      && d.querySelectorAll('#a path').length === 1 && a.textContent === 'hitwo',
      'and its selectors, self closing tags and void tags behave');
    // Focus lands where the browser lets it, and Tab goes on in page order.
    const f = new Document('<body><button id="one">1</button><article id="card"><p>text</p>'
      + '<button id="two">2</button></article><button id="off" disabled>3</button>'
      + '<div hidden><button id="tucked">4</button></div><button id="three">5</button></body>');
    const [one, card, two, three] = ['one', 'card', 'two', 'three'].map((id) => f.getElementById(id));
    one.focus();
    card.focus();
    ok(f.activeElement === one && card.tabIndex === -1 && one.tabIndex === 0,
      'a card with no tabindex takes no focus, and a button keeps it');
    ok(nextTab(f) === two, 'Tab from the button goes to the next control in the page', nextTab(f) && nextTab(f).id);
    card.tabIndex = -1;
    card.focus();
    ok(f.activeElement === card && card.getAttribute('tabindex') === '-1' && nextTab(f) === two,
      'given tabindex -1 it takes focus, out of the tab order, and Tab goes on to what is inside it');
    two.focus();
    ok(nextTab(f) === three, 'a disabled control and one in a hidden box are passed over', nextTab(f) && nextTab(f).id);
    f.getElementById('off').focus();
    ok(f.activeElement === two, 'and neither takes focus');
    two.remove();
    ok(f.activeElement === f.body, 'focus taken out of the page is back on the body');
  });

  await section('one grade colour rule, keyed to the letters in grade.js:', () => {
    ok(GradeView && typeof GradeView.letterOf === 'function' && typeof GradeView.gradeTone === 'function',
      'shared/grade-view.js exports the rule to node', gradeViewError || 'letterOf or gradeTone missing');
    const scores = Array.from({ length: 101 }, (_v, i) => i);
    const letterOff = scores.filter((s) => GradeView.letterOf(s) !== grade.letter(s));
    ok(!letterOff.length, 'GradeView.letterOf matches grade.js letter() on every score 0 to 100',
      `disagree at ${letterOff.join(', ')}`);
    const toneOff = scores.filter((s) => {
      const want = toneFor(s);
      return GradeView.scoreTone(s) !== want || GradeView.gradeTone({ score: s, letter: grade.letter(s) }) !== want
        || GradeView.gradeTone(s) !== want || GradeView.tone(grade.letter(s)) !== want;
    });
    ok(!toneOff.length, 'a bare score, a grade and a letter take one colour at every score', `differ at ${toneOff.join(', ')}`);
    ok(GradeView.gradeTone({ score: 58, letter: 'D' }) === 'bad', 'a 58 D is red, where the trend drew it yellow');
    ok(GradeView.gradeTone({ score: 69, letter: 'C' }) === 'warn', 'a 69 C is a warning, where the trend drew it white');
    ok(GradeView.gradeTone({ score: 82, letter: 'A' }) === 'good', 'an 82 A is green, where Stats drew it white');
    ok(GradeView.letterOf(null) === null && grade.letter(null) === null, 'no score, no letter');
    ok(GradeView.scoreTone(null) === '' && GradeView.gradeTone({ score: null, letter: null }) === '' && GradeView.gradeTone(undefined) === '',
      'and no colour: a grade that does not exist is not painted as a bad one');

    // Nobody keeps a private copy of the rule. A copy agrees on the day it is
    // written and drifts the first time the bands move.
    const COPY = /letter\s*===\s*'[SABCD]'/;
    ok(COPY.test("g.letter === 'S' || g.letter === 'A'"), 'the copy detector matches the copy the panel used to keep');
    const copies = [];
    const walk = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.name.endsWith('.js') && !p.endsWith(path.join('shared', 'grade-view.js'))
          && COPY.test(fs.readFileSync(p, 'utf8'))) copies.push(path.relative(RENDERER, p));
      }
    };
    walk(RENDERER);
    ok(!copies.length, 'no surface colours a grade with its own letter table', copies.join(', '));
  });

  await section('the record controls follow the language setting:', async () => {
    const de = await openShell({ language: 'de' });
    ok(de.label() === I18N.t('de', 'panel.start') && de.label() === 'Starten', 'Start reads Starten in German', `read "${de.label()}"`);
    ok(de.notice() === null, 'with nothing to say, the notice line says nothing in any language', `read "${de.notice()}"`);
    ok(de.$('nav-settings').textContent.includes(I18N.t('de', 'common.settings')), 'and the labels the markup marks for translation');
    de.bridge.emit(C.PUSH_STATUS, { status: 'coaching' });
    ok(de.label() === 'Stoppen', 'recording, the button is German', `read "${de.label()}"`);
    // Paused, the notice line is what says so (8.3; the card's line from
    // 8.2.1, the status word before it), and it says it in German, as
    // "Pausiert" did.
    de.bridge.emit(C.PUSH_STATUS, { status: 'paused' });
    ok(de.notice() === I18N.t('de', 'panel.pausedLine') && de.notice() === 'Pausiert. Bis du fortsetzt, wird nichts gelesen.',
      'paused, the notice line says so in German', `read "${de.notice()}"`);
    const uiLangs = I18N.LANGUAGES.filter((l) => I18N.hasUi(l.code) && l.code !== 'en');
    const untranslated = uiLangs.filter((l) => I18N.t(l.code, 'panel.pausedLine') === I18N.t('en', 'panel.pausedLine')).map((l) => l.code);
    ok(uiLangs.length >= 4 && !untranslated.length && I18N.t('en', 'panel.pausedLine') === 'Paused. Nothing is read until you resume.',
      'and the paused line is written in every language the interface has', `English in ${untranslated.join(', ')}`);

    // The bug, reproduced: the same controls on the bridge as the panel had it, without getConfig.
    const before = await openShell({ language: 'de' }, null, {
      preload: (api) => { const bare = { ...api }; delete bare.getConfig; return bare; },
    });
    ok(before.label() === 'Start', 'without getConfig on the bridge it stays English, which is what players got');

    const en = await openShell({ language: 'en' });
    ok(en.label() === 'Start' && en.notice() === null,
      'English keeps the panel\'s own word, Start, with nothing said beside it', `read "${en.label()}" and "${en.notice()}"`);
    let channel = null;
    if (typeof en.bridge.api.getConfig === 'function') {
      await en.bridge.api.getConfig();
      channel = (en.bridge.invoked[en.bridge.invoked.length - 1] || [])[0];
    }
    ok(channel === C.CONFIG_GET, 'getConfig goes over CONFIG_GET, the channel Settings reads');
  });

  // A FAILED PAYMENT IS A GRACE, AND AN ENDED PLAN SAYS HOW BACK (8.3.2). The
  // server keeps a payment_failed key usable until its expiry while Stripe
  // tries the card again; refused here, a declined card stopped the match
  // being recorded within three minutes. And a plan bought after the last
  // one ended is a new key, which "Renew at occlara.app" never said to enter.
  await section('a failed payment is a grace, and an ended plan says how to get back:', async () => {
    const Module = require('module');
    const file = path.join(ROOT, 'src', 'main', 'services', 'license-service.js');
    const mem = {};
    const stubs = {
      './store': { get: (k) => mem[k], set: (k, v) => { mem[k] = v; } },
      './api-client': { post: async () => ({ ok: false, status: 0, data: {} }) },
    };
    const realLoad = Module._load;
    Module._load = function stand(request, parent, ...rest) {
      if (parent && parent.filename === file && Object.prototype.hasOwnProperty.call(stubs, request)) return stubs[request];
      return realLoad.call(this, request, parent, ...rest);
    };
    let L;
    try { delete require.cache[file]; L = require(file); } finally { Module._load = realLoad; delete require.cache[file]; }
    const soon = new Date(Date.now() + 3600e3).toISOString();
    const gone = new Date(Date.now() - 60e3).toISOString();
    ok(L.usable('payment_failed', soon) && !L.usable('payment_failed', gone) && !L.usable('payment_failed', '')
      && L.usable('active', '') && L.usable('active', soon) && !L.usable('active', gone)
      && !L.usable('cancelled', soon) && !L.usable('refunded', soon) && !L.usable('disputed', soon) && !L.usable('expired', soon),
    'a failed payment works until its expiry and never without one; active as ever; cancelled, refunded, disputed and expired never');
    Object.assign(mem, { licenseKey: 'GC-AAAA-BBBB-CCCC-DDDD', licenseStatus: 'payment_failed', licenseExpiry: soon });
    ok(L.isLocallyValid(), 'a key in its payment grace is valid on this PC, so the minute check does not stop the match being recorded');
    mem.licenseExpiry = gone;
    ok(!L.isLocallyValid(), 'and not once its expiry has passed');
    // A REFUSAL STAYS ONE THROUGH AN OUTAGE. A server that refuses a failed
    // payment (any before 8.3.2) left it stored usable by the grace's rule,
    // and the next re-check that could not reach a server, which answers with
    // isLocallyValid, revived the key it had refused.
    Object.assign(mem, { licenseStatus: 'active', licenseExpiry: soon, licenseRefused: false });
    const api = stubs['./api-client'];
    api.post = async () => ({ ok: true, status: 200, data: { valid: false, status: 'payment_failed', error: 'License status: payment_failed' } });
    const no = await L.revalidate();
    api.post = async () => { throw new Error('fetch failed'); };
    const offline = await L.revalidate();
    api.post = async () => ({ ok: false, status: 503, data: { error: 'licence-check-unavailable', retry: true } });
    const outage = await L.revalidate();
    const refusedHere = L.isLocallyValid();
    api.post = async () => ({ ok: true, status: 200, data: { valid: true, plan: 'monthly', status: 'payment_failed', expiresAt: soon } });
    const yes = await L.revalidate();
    ok(no.valid === false && offline.valid === false && outage.valid === false && !refusedHere
      && yes.valid === true && L.isLocallyValid() && mem.licenseStatus === 'payment_failed',
    'a key the server refused as a failed payment stays refused offline and through an outage, until the server says yes',
    JSON.stringify({ no, offline, outage, yes }));
    api.post = async () => ({ ok: false, status: 0, data: {} });
    const say = L.graceStep(false, true, 'payment_failed');
    const again = L.graceStep(say.warned, true, 'payment_failed');
    const paid = L.graceStep(again.warned, true, 'active');
    const ended = L.graceStep(true, false, 'payment_failed');
    ok(say.act === 'say' && say.warned && again.act === null && paid.act === 'clear' && !paid.warned
      && ended.act === 'clear' && L.graceStep(false, true, 'active').act === null,
    'the notice line says the grace once as it begins, never again over another notice, and is cleared once paid or ended',
    JSON.stringify({ say, again, paid, ended }));
    // A key made lifetime by hand answers expiresAt null: the old date kept on
    // this PC ended it again each time it came round.
    Object.assign(mem, { licenseKey: 'GC-AAAA-BBBB-CCCC-DDDD', licenseStatus: 'active', licenseExpiry: gone, licenseRefused: false });
    stubs['./api-client'].post = async () => ({ ok: true, status: 200, data: { valid: true, status: 'active', plan: 'lifetime', expiresAt: null } });
    const lifetime = await L.revalidate();
    const lifetimeExpiry = mem.licenseExpiry;
    stubs['./api-client'].post = async () => ({ ok: true, status: 200, data: { valid: true, status: 'active', plan: 'monthly' } });
    mem.licenseExpiry = soon;
    await L.revalidate();
    ok(lifetime.valid && lifetimeExpiry === '' && mem.licenseExpiry === soon && L.isLocallyValid(),
      'a key the server answers with no expiry keeps none on this PC, and an answer without the field keeps the date it had', mem.licenseExpiry);
    mem.licenseExpiry = gone;
    stubs['./api-client'].post = async () => ({ ok: true, status: 200, data: { valid: true, status: 'active', plan: 'lifetime', expires_at: null } });
    await L.revalidate();
    ok(mem.licenseExpiry === '' && L.isLocallyValid(), 'and the snake case field reads the same', JSON.stringify(mem.licenseExpiry));
    const NEW_KEY = /Renew at occlara\.app\/account, then log out in Settings and enter your new key\./;
    ok(NEW_KEY.test(L.endedMessage('expired')) && NEW_KEY.test(L.endedMessage('cancelled')) && NEW_KEY.test(L.endedMessage('anything else')),
      'an ended plan says to renew, then log out in Settings and enter the new key', L.endedMessage('expired'));
    ok(/Update your card at occlara\.app\/account/.test(L.endedMessage('payment_failed'))
      && /enter the new key it gives you/.test(L.messageForStatus('expired')) && /refunded/.test(L.messageForStatus('refunded')),
    'a failed payment says to update the card, and the licence window says which key to enter');
    const idx = fs.readFileSync(path.join(ROOT, 'src', 'main', 'index.js'), 'utf8');
    ok((idx.match(/notePaymentGrace\(\);/g) || []).length >= 3
      && (idx.match(/pushNotice\(licenseService\.endedMessage\(state\.licenseReason\)\)/g) || []).length === 3,
    'main says the grace at launch and on each re-check, and an ended plan, at Start, as it ends or for a new reason, in those words');
    const set = fs.readFileSync(path.join(ROOT, 'src', 'renderer', 'settings', 'settings.js'), 'utf8');
    ok(/RENEW_HERE = 'Renew with Manage subscription, then Log out and enter your new key\.'/.test(set)
      && /payment_failed: 'Your last payment failed\. Update your card with Manage subscription/.test(set),
    'and Settings says the same beside its own buttons');

    // The licence's life in main, main's own code in a sandbox. A Log out
    // keeps main's state, so the ended plan's line, "log out in Settings and
    // enter your new key", was still the notice when the new key opened the
    // window. And the grace is said once and taken down once paid.
    const vm = require('vm');
    const cut = (src, head, tail) => { const i = src.indexOf(head); const j = i < 0 ? -1 : src.indexOf(tail, i); return j < 0 ? '' : src.slice(i, j); };
    const LIFE = cut(idx, '\nconst license = {', '\n// Tear down the running session');
    const box = {
      console: { log() {}, warn() {}, error() {} },
      state: { licenseActive: true, licenseReason: '', notice: null, isCoaching: false },
      store: { get: (k) => mem[k] },
      C, registry: { broadcast() {} }, buildState: () => ({}),
      controller: { stop() {} },
      activationWindow: { close() {} }, launchMainApp() {},
      licenseService: { ...L, activate: async () => ({ ok: true, valid: true, status: 'active' }), revalidate: async () => ({ valid: true }) },
    };
    box.pushNotice = (text, kind) => { box.state.notice = text ? { text: String(text), at: 1, kind: kind || null } : null; };
    vm.createContext(box);
    const life = LIFE ? vm.runInContext(`${LIFE}\n;({ license, enterLicenseEnded, notePaymentGrace })`, box) : null;
    ok(!!life, 'main\'s licence code is found and runs in the sandbox');
    if (life) {
      mem.licenseStatus = 'expired';
      life.enterLicenseEnded('expired');
      const endedLine = box.state.notice && box.state.notice.text;
      mem.licenseStatus = 'active';
      await life.license.activate('GC-EEEE-FFFF-GGGG-HHHH');
      ok(NEW_KEY.test(endedLine || '') && box.state.licenseActive === true && box.state.notice === null,
        'a new key entered after a Log out opens on no notice from the plan that ended, which said to do just that',
        JSON.stringify(box.state.notice));
      mem.licenseStatus = 'payment_failed';
      life.notePaymentGrace();
      const said = box.state.notice;
      life.notePaymentGrace();
      const again = box.state.notice;
      mem.licenseStatus = 'active';
      life.notePaymentGrace();
      ok(said && said.kind === 'payment' && /Update your card/.test(said.text) && again === said && box.state.notice === null,
        'the grace is said once as it begins, not again, and taken down once paid', JSON.stringify({ said, now: box.state.notice }));
      // Ended for one reason, then another: the line says the newer.
      box.state.licenseActive = true;
      box.state.licenseReason = '';
      life.enterLicenseEnded('payment_failed');
      const first = box.state.notice && box.state.notice.text;
      life.enterLicenseEnded('cancelled');
      const second = box.state.notice && box.state.notice.text;
      life.enterLicenseEnded('cancelled');
      ok(/Update your card/.test(first || '') && NEW_KEY.test(second || '') && box.state.notice.text === second,
        'ended for a failed payment, then cancelled, the line says the cancelled plan\'s words, once', JSON.stringify({ first, second }));
    }
    // At launch, a stored key that ended is asked about beside the licence
    // window: renewed while the app was closed, the window goes and the app
    // opens; refused, it stays; with no key, nothing is asked.
    const LAUNCH = cut(idx, '\nfunction launchWithLicence() {', '\n// Authoritative check');
    const runLaunch = async ({ key, valid, renewed }) => {
      const seen = { activation: 0, closed: 0, launched: 0, asked: 0 };
      const local = { licenseKey: key, licenseStatus: 'expired' };
      const lb = {
        console: { log() {}, warn() {}, error() {} },
        state: { licenseActive: true, licenseReason: '', notice: { text: 'old', kind: null } },
        store: { get: (k) => local[k] }, mainLaunched: false,
        showActivation: () => { seen.activation++; },
        activationWindow: { close: () => { seen.closed++; } },
        launchMainApp: () => { seen.launched++; },
        notePaymentGrace() {}, enterLicenseEnded() {},
        licenseService: {
          isLocallyValid: () => (valid ? true : local.licenseStatus === 'active'),
          revalidate: async () => { seen.asked++; if (renewed) local.licenseStatus = 'active'; return { valid: !!renewed }; },
        },
      };
      vm.createContext(lb);
      vm.runInContext(`${LAUNCH}\n;launchWithLicence();`, lb);
      await new Promise((r) => setTimeout(r, 10));
      return { ...seen, notice: lb.state.notice };
    };
    const renewedRun = LAUNCH ? await runLaunch({ key: 'GC-AAAA-BBBB-CCCC-DDDD', renewed: true }) : null;
    const refusedRun = LAUNCH ? await runLaunch({ key: 'GC-AAAA-BBBB-CCCC-DDDD', renewed: false }) : null;
    const noKeyRun = LAUNCH ? await runLaunch({ key: '', renewed: false }) : null;
    const validRun = LAUNCH ? await runLaunch({ key: 'GC-AAAA-BBBB-CCCC-DDDD', valid: true }) : null;
    ok(!!LAUNCH && renewedRun.activation === 1 && renewedRun.asked === 1 && renewedRun.closed === 1 && renewedRun.launched === 1
      && renewedRun.notice === null
      && refusedRun.activation === 1 && refusedRun.closed === 0 && refusedRun.launched === 0
      && noKeyRun.asked === 0 && noKeyRun.activation === 1
      && validRun.launched === 1 && validRun.activation === 0,
    'at launch a stored key renewed while the app was closed opens the app from the licence window; refused it stays, with no key nothing is asked',
    JSON.stringify({ renewedRun, refusedRun, noKeyRun, validRun }));
    ok(/licenseService\.revalidate\(\)\s*\.then\(\(r\) => \{ if \(r\.valid === false\) enterLicenseEnded\(r\.status\); notePaymentGrace\(\); \}\)/.test(idx),
      'and the launch\'s own re-check says or takes down the grace on its answer, not three minutes on');
  });

  await section('with the licence ended, the notice line says why:', async () => {
    const p = await openShell({ language: 'en' });
    const notice = 'Your license has expired. Renew at occlara.app.';
    p.bridge.emit(C.PUSH_STATE, { ...BASE, licenseActive: false, notice: { text: notice, at: 1 } });
    ok(p.notice() === notice && p.$('notice').classList.contains('system') && p.$('notice').title === notice,
      'the notice main pushed is on the notice line, marked as a system notice, whole in its title', `read "${p.notice()}"`);
    ok(p.$('toggle').disabled && p.label() === 'Subscription ended' && p.$('toggle').classList.contains('ended'),
      'beside a locked button that says so itself', `read "${p.label()}"`);
    p.bridge.emit(C.PUSH_STATE, { ...BASE, licenseActive: false, notice: null });
    ok(/Open Settings to renew and enter your new key/.test(p.notice() || '') && !/Press Start/.test(p.notice() || ''),
      'with no notice it still says to renew and enter the new key, never Press Start', `read "${p.notice()}"`);
    p.bridge.emit(C.PUSH_STATE, { ...BASE, licenseActive: true, notice: null });
    ok(p.notice() === null && !p.$('notice').hasAttribute('title') && !p.$('toggle').disabled
      && p.label() === 'Start' && !p.$('toggle').classList.contains('ended'),
      'renewed, the button is Start and the notice line is empty again, with no Press Start hint in its place', `read "${p.notice()}"`);
  });

  // THE RECORD CARD IS ITS TWO BUTTONS (8.3). "Ready", "Recording" and
  // "Paused" over them went in 8.2.1, and the line under them in 8.3, both at
  // the player's ask ("remove any text under it just leave it with the two
  // buttons"). What state it is in is the button's word, the pause button's
  // icon and the live colour; what the line said when there was something to
  // say is the notice line in the window's top strip, hidden otherwise.
  await section('the record card is its two buttons, and the top strip\'s notice line says only what they cannot:', async () => {
    const html = fs.readFileSync(path.join(RENDERER, 'shell', 'index.html'), 'utf8');
    const js = fs.readFileSync(path.join(RENDERER, 'shell', 'shell.js'), 'utf8');
    const p = await openShell({ language: 'en' });
    const rec = p.$('rec');
    const note = p.$('notice');
    const top = p.document.querySelector('.top');
    ok(!p.$('status-text') && !p.$('dot') && !rec.querySelector('.rec-state') && !/\bReady\b/.test(rec.textContent)
      && !/id="status-text"|id="dot"|rec-state/.test(html), 'no status row: no dot, no Ready, in the markup or on the card');
    ok(rec.children.map((c) => c.id || c.className).join() === 'rec-controls' && !p.$('line') && !rec.querySelector('p')
      && rec.querySelector('.rec-controls').children.map((c) => c.id).join() === 'toggle,pause',
    'the card holds the two buttons and nothing else, no agent check over them and no line of text under them',
    rec.children.map((c) => c.id || c.className).join());
    ok(note && top.children.map((c) => c.id || c.className).join() === 'notice,win-controls no-drag' && top.classList.contains('drag')
      && note.classList.contains('no-drag') && note.getAttribute('aria-live') === 'polite',
    'the notice line is in the top strip, left of the window\'s buttons, a polite live region, out of the drag region the strip still is',
    top.children.map((c) => c.id || c.className).join());
    const pauseIcon = () => (p.$('pause').querySelector('path') || { getAttribute: () => '' }).getAttribute('d');
    ok(p.label() === 'Start' && p.$('pause').disabled && !rec.classList.contains('live') && !note.hidden && !note.textContent && !note.hasAttribute('title'),
      'ready: Start, the pause button off, the card at rest, and the notice line empty with nothing to say (never hidden, so its live region is there when a notice comes): no Press Start', `read "${note.textContent}"`);
    p.bridge.emit(C.PUSH_STATE, { ...BASE, isCoaching: true, status: 'coaching', cadence: 1000, sounds: false });
    ok(p.label() === 'Stop' && !p.$('pause').disabled && rec.classList.contains('live') && pauseIcon() === 'M9 5v14' && p.notice() === null,
      'recording: Stop, the pause icon and the live card say it, and the notice line says nothing, no "Reading your game"', `read "${p.notice()}"`);
    // The live round's gap (read-cadence.js reads menus, a confirmed buy
    // phase and the time spent dead less often), as Settings' line says it.
    ok(p.$('sealed-capture').textContent === 'Reading your game every 1s in a live round, as fast as the connection keeps up',
      'while the Recording screen\'s capture row still says how often the game is read, in a live round', p.$('sealed-capture').textContent);
    p.bridge.emit(C.PUSH_STATE, { ...BASE, isCoaching: true, status: 'coaching', cadence: 2000, captureSpeed: 2000, sounds: false });
    ok(p.$('sealed-capture').textContent === 'Reading your game every 2s in a live round, pinned in Settings' && p.notice() === null,
      'and follows the cadence as it moves, with the notice line still silent', p.$('sealed-capture').textContent);
    p.bridge.emit(C.PUSH_STATE, { ...BASE, isCoaching: true, isPaused: true, status: 'paused', cadence: 1000, sounds: false });
    ok(p.label() === 'Stop' && !rec.classList.contains('live') && p.notice() === 'Paused. Nothing is read until you resume.'
      && !note.classList.contains('system') && note.title === p.notice() && /^M8 5\.2/.test(pauseIcon()),
    'paused: the play icon, the card at rest, and the notice line says paused, dim, whole in its title', `read "${p.notice()}", icon ${pauseIcon()}`);
    ok(/^M8 5\.2/.test('M8 5.2v13.6') && !/^M8 5\.2/.test('M9 5v14'), 'the play icon detector matches the play path and not the pause one');
    // A League session puts "Recording..." up as a notice for its whole
    // length (kind 'recording'): Stop and the live card already say it, so it
    // is never shown, and paused the paused line is.
    const PAUSED = I18N.t('en', 'panel.pausedLine');
    const REC = { text: 'Recording. Nothing appears during your game, and the graded review opens when it ends.', at: 1, kind: 'recording' };
    const DOWN = { text: 'Cannot reach the coach server right now. Reading resumes when it is back.', at: 2, kind: 'read-failed' };
    const live = (paused, notice, game) => ({ ...BASE, gameId: game || 'lol', isCoaching: true, isPaused: paused,
      status: paused ? 'paused' : 'coaching', sounds: false, notice });
    const lg = await openShell({ language: 'en' }, { gameId: 'lol' });
    lg.bridge.emit(C.PUSH_STATE, live(false, REC));
    ok(lg.notice() === null, 'the "Recording..." a League session keeps up is not shown: the button and the live card say it', `read "${lg.notice()}"`);
    lg.bridge.emit(C.PUSH_STATE, live(true, REC));
    ok(lg.notice() === PAUSED && !lg.$('notice').classList.contains('system'),
      'paused, the notice line says paused, and is no notice', `read "${lg.notice()}"`);
    lg.bridge.emit(C.PUSH_STATE, live(false, REC));
    ok(lg.notice() === null, 'resumed, it says nothing again', `read "${lg.notice()}"`);
    // Paused, nothing is read, so a notice about the reading is out of date:
    // the paused line says what is true. A notice that is not about the
    // reading (the licence ending) still takes the line.
    lg.bridge.emit(C.PUSH_STATE, live(false, DOWN));
    ok(lg.notice() === DOWN.text && lg.$('notice').classList.contains('system'), 'recording, a notice of something wrong is shown, as a notice');
    lg.bridge.emit(C.PUSH_STATE, live(true, DOWN));
    ok(lg.notice() === PAUSED, 'paused, a read that failed before the pause no longer holds the line', `read "${lg.notice()}"`);
    const LICENCE = { text: 'Your subscription has ended. Renew in Settings to start coaching.', at: 3 };
    lg.bridge.emit(C.PUSH_STATE, live(true, LICENCE));
    ok(lg.notice() === LICENCE.text && lg.$('notice').classList.contains('system'), 'while a notice that is not about the reading still is, paused or not');
    // Capture blocked: shown whole in its title however long, and paused,
    // the paused line over it.
    const BLOCKED = { text: 'Windows blocked screen capture. Add Occlara to your antivirus exclusions (Windows Security, Virus and threat protection, Exclusions), then start again.', at: 4, kind: 'capture' };
    const va = await openShell({ language: 'en' });
    va.bridge.emit(C.PUSH_STATE, live(false, BLOCKED, 'valorant'));
    ok(va.notice() === BLOCKED.text && va.$('notice').title === BLOCKED.text && va.$('notice').classList.contains('system'),
      'capture blocked is shown, as a notice, the whole of it in its title', `read "${va.notice()}"`);
    // The text is a hole in the strip's drag region, so its title can show,
    // and no part of the strip's caption: a double click on it maximises
    // nothing, while one on the strip around it still does.
    const maximised = () => va.bridge.sent.filter(([ch, a]) => ch === C.SHELL_WINDOW && a === 'maximize').length;
    va.fire(va.$('notice'), 'dblclick');
    ok(maximised() === 0, 'a double click on the notice line maximises nothing');
    va.fire(va.document.querySelector('.top'), 'dblclick');
    ok(maximised() === 1, 'one on the strip around it still maximises the window');
    va.bridge.emit(C.PUSH_STATE, live(true, BLOCKED, 'valorant'));
    ok(va.notice() === PAUSED && va.$('notice').title === PAUSED, 'paused, the paused line is shown over a capture notice', `read "${va.notice()}"`);
    // Recording stopped for the session, and between matches a review saved
    // in Matches or checked against Riot's record: all said.
    const BUSY = { text: 'Recording stopped for this session: your PC was busy. The coach still reads your screen up to once a second.', at: 5, kind: 'recorder' };
    va.bridge.emit(C.PUSH_STATE, live(false, BUSY, 'valorant'));
    ok(va.notice() === BUSY.text, 'recording stopped for the session is shown', `read "${va.notice()}"`);
    // Its last words are that the coach still reads the screen every second,
    // untrue while paused: the paused line takes its place, and the resume
    // puts it back, true again.
    va.bridge.emit(C.PUSH_STATE, live(true, BUSY, 'valorant'));
    ok(va.notice() === PAUSED, 'paused, the paused line over recording stopped for the session, which says the screen is still read', `read "${va.notice()}"`);
    va.bridge.emit(C.PUSH_STATE, live(false, BUSY, 'valorant'));
    ok(va.notice() === BUSY.text, 'and resumed, recording stopped for the session is said again', `read "${va.notice()}"`);
    // Mid match the server down puts its notice up while Auto steps the reads
    // down: the Recording screen's capture row follows the cadence with the
    // notice up too. The card's line returned before the row whenever a notice
    // took it, so the row kept saying every 1s.
    va.bridge.emit(C.PUSH_STATE, { ...live(false, DOWN, 'valorant'), cadence: 3000 });
    ok(va.notice() === DOWN.text && va.$('sealed-capture').textContent === 'Reading your game every 3s in a live round, as fast as the connection keeps up',
      'with a notice up, the Recording screen\'s capture row still follows the cadence', va.$('sealed-capture').textContent);
    const CHECKED = { text: "Checked 1 recent match against Riot's record. It is in Matches.", at: 6, kind: 'review' };
    va.bridge.emit(C.PUSH_STATE, { ...BASE, notice: CHECKED });
    ok(va.notice() === CHECKED.text && va.$('notice').classList.contains('system'), 'a review notice between matches is shown', `read "${va.notice()}"`);
    // Written once: the state comes on every config write and status tick,
    // and a live region given the same words again reads them out again.
    const written = va.$('notice').firstChild;
    va.bridge.emit(C.PUSH_STATE, { ...BASE, notice: { ...CHECKED } });
    ok(va.$('notice').firstChild === written && va.notice() === CHECKED.text, 'the same notice pushed again is not written again');
    va.bridge.emit(C.PUSH_STATE, { ...BASE, notice: null });
    ok(va.notice() === null && !va.$('notice').textContent && !va.$('notice').hasAttribute('title') && !va.$('notice').classList.contains('system'),
      'cleared, the line is hidden again, with no words or title left on it');
    // Balanced: Start fills the width beside the square pause button, both
    // 48px tall, one padding all round; and the notice line is one line.
    const css = fs.readFileSync(path.join(RENDERER, 'shell', 'shell.css'), 'utf8');
    const rule = (sel) => {
      const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return (css.match(new RegExp(`(?:^|\\n)${esc}\\s*\\{([^}]*)\\}`)) || [])[1] || '';
    };
    const prop = (body, name) => ((body.match(new RegExp(`(?:^|[;\\s])${name}\\s*:\\s*([^;]+);`)) || [])[1] || '').trim();
    ok(prop(rule('.nav'), 'display') === 'flex', 'the rule reader finds a known rule');
    ok(prop(rule('.toggle'), 'flex') === '1 1 auto' && prop(rule('.toggle'), 'height') === '48px'
      && prop(rule('.icon-btn.lg'), 'width') === '48px' && prop(rule('.icon-btn.lg'), 'height') === '48px'
      && prop(rule('.icon-btn.lg'), 'flex') === 'none', 'Start fills the width beside a 48px square pause button, the two the same height');
    ok(prop(rule('.rec'), 'padding') === 'var(--space-3)' && !rule('.rec-line') && !/rec-line/.test(css + html + js),
      'with one padding on every side of them, and the line\'s styles gone with it');
    ok(!rule('.rec-state') && !rule('#status-text.ended') && !/\.dot\b/.test(css), 'and the status row\'s styles went with it');
    const tn = rule('.top-notice');
    const widest = prop(tn, 'max-width');
    ok(prop(tn, 'white-space') === 'nowrap' && prop(tn, 'overflow') === 'hidden' && prop(tn, 'text-overflow') === 'ellipsis'
      && prop(tn, 'min-width') === '0' && prop(tn, 'flex') === '0 1 auto' && /^\d+%$/.test(widest) && parseInt(widest, 10) < 100,
    'the notice line is one line, cut with an ellipsis rather than wrapped, and never the whole strip, so the strip still drags', tn);
    ok([400, 500, 600, 700, 800].includes(Number(prop(tn, 'font-weight'))) && /^var\(--[\w-]+\)$/.test(prop(tn, 'color'))
      && /^var\(--[\w-]+\)$/.test(prop(rule('.top-notice.system'), 'color')) && prop(rule('.top'), 'height') === '40px',
    'in a Geist weight that ships and the theme\'s colours, in a strip still 40px tall');
    // Read as code, comments out: they may say what went.
    const code = (src) => src.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    const OLD_LINES = /panel\.noTips|Press Start|Your review opens when the match ends|\(pinned\)/;
    ok(OLD_LINES.test(code("tr('panel.noTips')")) && OLD_LINES.test(code("x + ' (pinned)'")) && !OLD_LINES.test(code('a(); // Press Start\n/* Press Start */')),
      'the old line detector finds the old line in code and passes over a comment');
    ok(!OLD_LINES.test(code(html) + code(js)), 'the Press Start and the Reading your game lines are gone from the shell');
  });

  await section('the start and stop sounds, on real transitions only:', async () => {
    const p = await openShell({ language: 'en' });
    ok(p.window.occlaraSfx && p.scripts.some((s) => /sfx\.js$/.test(s)), 'the shell loads shared/sfx.js');
    ok(!p.sfx.length, 'opening the window plays nothing: its first state is what is already true');

    // A Valorant start is a status and then the state push setStatus sends after it.
    p.bridge.emit(C.PUSH_STATUS, { status: 'coaching' });
    p.bridge.emit(C.PUSH_STATE, { ...BASE, isCoaching: true, status: 'coaching' });
    ok(same(p.sfx, ['start']), 'Start plays the start sound once, though status and state both say so', p.sfx.join(','));
    ok(p.audio.started > 0, 'and shared/sfx.js really plays it: oscillators started');

    p.bridge.emit(C.PUSH_STATUS, { status: 'paused' });
    p.bridge.emit(C.PUSH_STATE, { ...BASE, isCoaching: true, isPaused: true, status: 'paused' });
    ok(same(p.sfx, ['start']), 'pausing is silent', p.sfx.join(','));
    p.bridge.emit(C.PUSH_STATUS, { status: 'coaching' });
    ok(same(p.sfx, ['start', 'start']), 'resuming is recording starting again', p.sfx.join(','));
    p.bridge.emit(C.PUSH_STATUS, { status: 'paused' });
    p.bridge.emit(C.PUSH_STATUS, { status: 'stopped' });
    p.bridge.emit(C.PUSH_STATE, { ...BASE, status: 'stopped' });
    ok(same(p.sfx, ['start', 'start', 'stop']), 'stopping from a pause is still the end, once', p.sfx.join(','));

    // League starts through a state push alone.
    p.bridge.emit(C.PUSH_STATE, { ...BASE, gameId: 'lol', isCoaching: true });
    ok(same(p.sfx.slice(3), ['start']), 'a League start, carried by state alone, still sounds', p.sfx.join(','));
    p.bridge.emit(C.PUSH_STATUS, { status: 'stopped' });
    ok(same(p.sfx.slice(3), ['start', 'stop']), 'and its stop', p.sfx.join(','));

    p.bridge.emit(C.PUSH_STATE, { ...BASE, sounds: false });
    p.bridge.emit(C.PUSH_STATUS, { status: 'coaching' });
    p.bridge.emit(C.PUSH_STATUS, { status: 'stopped' });
    ok(p.sfx.length === 5, 'Sounds off in Settings means silence', p.sfx.join(','));
    p.bridge.emit(C.PUSH_STATE, { ...BASE });
    p.bridge.emit(C.PUSH_STATUS, { status: 'coaching' });
    ok(p.sfx.length === 6, 'and a config with no sounds key reads as on, the default', p.sfx.join(','));
  });

  // NO AGENT CHECK, AT START OR IN THE MATCH, IN ANY GAME (8.4.4). The card
  // asked "Playing" and the agent with a tick, off a frame taken three seconds
  // after Start, usually agent select (a teammate's KAY/O on the player's
  // Fracture swiftplay), nine seconds in it offered a field to type the agent
  // and the player's mains, and it asked mid match as readily. The engine
  // reads the agent off the player's own HUD in the match now
  // (coaching-engine.js lookForAgent), Riot's record names it after, and
  // nothing of it reaches the screen: the card is its two buttons throughout.
  await section('nothing asks for the agent, at Start or in the match, in any game:', async () => {
    const html = fs.readFileSync(path.join(RENDERER, 'shell', 'index.html'), 'utf8');
    const js = fs.readFileSync(path.join(RENDERER, 'shell', 'shell.js'), 'utf8');
    const css = fs.readFileSync(path.join(RENDERER, 'shell', 'shell.css'), 'utf8');
    ok(!/agent-bubble|id="ab-|Reading your agent|Type your agent|locked in|Your mains/.test(html)
      && !/agent-bubble|\bab-|setAgent|confirmAgent|onAgent/.test(js) && !/\.agent-bubble|\.ab-/.test(css),
    'the shell has no agent check: no bubble, no field, no quick picks, in its markup, its script or its styles');
    for (const gameId of ['valorant', 'lol']) {
      const p = await openShell({ language: 'en' }, { gameId });
      const rec = p.$('rec');
      const card = () => ({ kids: rec.children.map((c) => c.id || c.className).join(), text: rec.textContent.replace(/\s+/g, ' ').trim(),
        notice: p.notice() });
      const plain = (c) => c.kids === 'rec-controls' && c.text === 'Stop' && !/agent/i.test(`${c.text} ${c.notice || ''}`);
      p.bridge.emit(C.PUSH_STATUS, { status: 'coaching' });
      p.bridge.emit(C.PUSH_STATE, { ...BASE, gameId, isCoaching: true, status: 'coaching', cadence: 1000, sounds: false });
      // Past the nine seconds the old card waited before asking.
      p.clock.advance(10000);
      await settle();
      const started = card();
      p.bridge.emit(C.PUSH_SHELL, { page: 'home', shown: null, sealed: true });
      p.clock.advance(60000);
      await settle();
      const sealed = card();
      p.bridge.emit(C.PUSH_SHELL, { page: 'home', shown: 'home', sealed: false });
      p.bridge.emit(C.PUSH_STATUS, { status: 'stopped' });
      p.bridge.emit(C.PUSH_STATE, { ...BASE, gameId, status: 'stopped' });
      await settle();
      const stopped = card();
      ok(plain(started) && plain(sealed) && stopped.kids === 'rec-controls' && stopped.text === 'Start',
        `${gameId === 'lol' ? 'League' : 'Valorant'}: recording, mid match and after it the card is its two buttons and says nothing of an agent`,
        JSON.stringify({ started, sealed, stopped }));
    }
    const bridge = loadPreload('shell', {}).api;
    ok(!('setAgent' in bridge) && !('confirmAgent' in bridge) && !('onAgent' in bridge),
      'and the shell\'s bridge can neither set nor confirm an agent, nor hear of one', Object.keys(bridge).join(', '));
    ok(!Object.keys(C).some((k) => /AGENT/.test(k)) && !C.PUSH_LIST.some((ch) => /agent/i.test(ch)),
      'no channel carries an agent to a window or from one', Object.keys(C).filter((k) => /AGENT/.test(k)).join(', '));
  });

  // THE GAMES' OWN LOGOS (8.2.1), the player's decision of 2026-10-10 after
  // reading Riot's policy: they replaced the marks Occlara drew. Each is drawn
  // inline in currentColor, so the picker's colours hold, and each is held to
  // its source file in assets/games. Two games, Valorant and League.
  await section('the game picker shows each game\'s own logo, named in full:', async () => {
    const NAMES = ['Valorant', 'League of Legends'];
    const p = await openShell({ language: 'en' }, { gameId: 'lol' });
    const buttons = () => p.$('gamepick').querySelectorAll('button');
    ok(!p.$('gamepick').hidden && buttons().length === 2, 'two buttons, one per game', `${buttons().length} buttons`);
    ok(same(buttons().map((b) => b.getAttribute('aria-label')), NAMES) && buttons().every((b) => b.title === b.getAttribute('aria-label')),
      'each named in full, as its accessible name and its tooltip', buttons().map((b) => `${b.getAttribute('aria-label')}/${b.title}`).join(', '));
    ok(same(buttons().map((b) => b.getAttribute('aria-pressed')), ['false', 'true']), 'the game in use, and only it, is pressed');
    ok(buttons().every((b) => b.querySelectorAll('svg').length === 1 && !b.textContent.trim()), 'each is a logo with no text in it');
    ok(p.scripts.some((x) => /game-logos\.js$/.test(x)) && !p.scripts.some((x) => /game-marks\.js$/.test(x)),
      'drawn by shared/game-logos.js, the marks Occlara drew gone');
    p.bridge.emit(C.PUSH_STATUS, { status: 'coaching' });
    ok(buttons().every((b) => b.disabled && b.title === 'Stop recording to switch game')
      && same(buttons().map((b) => b.getAttribute('aria-label')), NAMES),
      'recording, every logo is locked with the tooltip saying why, and keeps its name');

    const logos = require('../src/renderer/shared/game-logos');
    ok(same(logos.ids(), ['valorant', 'lol']) && logos.svg('nope') === '' && logos.path('nope') === null
      && logos.svg('rivals') === '' && logos.path('rivals') === null,
      'a logo for each game, none for anything else, Marvel Rivals included');
    ok(same(fs.readdirSync(path.join(ROOT, 'assets', 'games')).sort(), ['lol.svg', 'valorant.svg']),
      'and assets/games holds those two sources alone', fs.readdirSync(path.join(ROOT, 'assets', 'games')).join(', '));
    /** Every point a path's commands end on, in absolute units: the box it draws in. */
    const pathPoints = (d) => {
      const toks = String(d).match(/[a-zA-Z]|-?(?:\d*\.\d+|\d+)(?:e-?\d+)?/g) || [];
      const ARGS = { m: 2, l: 2, h: 1, v: 1, c: 6, s: 4, q: 4, t: 2, a: 7 };
      const out = [];
      let i = 0, cmd = null, x = 0, y = 0, sx = 0, sy = 0;
      while (i < toks.length) {
        if (/^[a-zA-Z]$/.test(toks[i])) cmd = toks[i++];
        const lc = String(cmd).toLowerCase();
        const rel = cmd === lc;
        if (lc === 'z') { x = sx; y = sy; continue; }
        if (!(lc in ARGS)) throw new Error(`unread path command ${cmd}`);
        const a = Array.from({ length: ARGS[lc] }, () => Number(toks[i++]));
        if (lc === 'h') x = rel ? x + a[0] : a[0];
        else if (lc === 'v') y = rel ? y + a[0] : a[0];
        else { x = rel ? x + a[a.length - 2] : a[a.length - 2]; y = rel ? y + a[a.length - 1] : a[a.length - 1]; }
        if (lc === 'm') { sx = x; sy = y; cmd = rel ? 'l' : 'L'; }
        out.push([x, y]);
      }
      return out;
    };
    ok(same(pathPoints('M.077 2.166c-.077.038-.074.132-.076.205z').map((q) => q.map((n) => Math.round(n * 1000) / 1000)), [[0.077, 2.166], [0.001, 2.371]])
      && same(pathPoints('M1 2H5v3L0 0Z'), [[1, 2], [5, 2], [5, 5], [0, 0]]), 'the path reader reads joined, relative and absolute numbers');
    for (const id of logos.ids()) {
      const markup = logos.svg(id);
      const svgEl = new Document(markup).querySelector('svg');
      const attrs = ['viewBox', 'fill', 'stroke', 'aria-hidden'].map((a) => svgEl && svgEl.getAttribute(a)).join('|');
      ok(attrs === '0 0 24 24|currentColor||true' && svgEl.querySelectorAll('path').length === 1 && !/<text|#[0-9a-f]{3}|rgb/i.test(markup),
        `${id}: one filled path on a 24 unit box, in currentColor, with no text and no colour of its own`, attrs);
      const file = fs.readFileSync(path.join(ROOT, 'assets', 'games', `${id}.svg`), 'utf8');
      const fileD = (file.match(/<path[^>]*\sd="([^"]+)"/) || [])[1];
      ok(fileD && fileD === logos.path(id) && svgEl.querySelector('path').getAttribute('d') === fileD,
        `${id}: the very path of its source, assets/games/${id}.svg`);
      const pts = pathPoints(fileD);
      const out = pts.filter(([px, py]) => px < -0.01 || px > 24.01 || py < -0.01 || py > 24.01);
      ok(pts.length > 4 && !out.length, `${id}: inside its 24 unit box, so nothing of it is clipped`, JSON.stringify(out.slice(0, 3)));
    }
    ok(/<path[^>]*\sd="([^"]+)"/.test('<path fill="currentColor" d="M0 0Z"/>') && /<text|#[0-9a-f]{3}|rgb/i.test('<text>V</text>')
      && /<text|#[0-9a-f]{3}|rgb/i.test('fill="#FF4655"'), 'the path and no colour detectors match what they look for');
    // Both logos are the icon size, on the tokens, and none is sized apart:
    // the rule that drew the Marvel Rivals emblem a size up went with it.
    const css = fs.readFileSync(path.join(RENDERER, 'shell', 'shell.css'), 'utf8');
    ok(/\.game-seg button \.game-logo \{ width: var\(--icon-md\); height: var\(--icon-md\);/.test(css)
      && !/\.game-logo\[data-game=/.test(css) && logos.ids().every((id) => logos.svg(id).includes(`data-game="${id}"`)),
    'the logos are the icon size, on the tokens, with no logo sized apart', (css.match(/\.game-logo\[[^\n]*/) || [''])[0]);

    // THE PICKED GAME'S LOGO STAYS ON ITS GROUND UNDER THE POINTER. A logo is
    // drawn in currentColor, and the hover rule outranked the pressed one, so
    // over the pressed button's --text ground it set --text: white on white.
    // Every rule on a picker button itself is cascaded here, by specificity
    // and then source order, for a button picked or not, hovered or not.
    const cascade = (text) => {
      const rules = [];
      for (const m of text.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/(?:^|\n)([^{}\n]+)\{([^}]*)\}/g)) {
        for (const sel of m[1].split(',').map((x) => x.trim())) {
          // The button itself only: a rule on the logo inside it has a space.
          if (sel.startsWith('.game-seg button') && !/\s/.test(sel.slice(16))) rules.push({ rest: sel.slice(16), body: m[2] });
        }
      }
      const partsOf = (rest) => rest.match(/:not\([^)]*\)|:[a-z-]+|\[[^\]]*\]|\.[\w-]+/g) || [];
      const holds = (part, st) => {
        if (part.startsWith(':not(')) return !holds(part.slice(5, -1), st);
        if (part === ':hover') return st.hover;
        if (part === ':disabled') return false;
        if (part === '[aria-pressed="true"]') return st.pressed;
        if (part === '.named') return false;
        throw new Error(`unread picker selector part ${part}`);
      };
      const declared = (body, name) => ((body.match(new RegExp(`(?:^|[;\\s])${name}\\s*:\\s*([^;]+);`)) || [])[1] || '').trim();
      // Past ".game-seg button", which every rule shares, each part weighs one
      // class, a :not() its argument's: the specificity is the count.
      return (st, name) => {
        let best = null;
        rules.forEach((r, i) => {
          const parts = partsOf(r.rest);
          const v = declared(r.body, name);
          if (!v || parts.join('') !== r.rest || !parts.every((p) => holds(p, st))) return;
          if (!best || parts.length >= best.w) best = { w: parts.length, v, i };
        });
        return best ? best.v : '';
      };
    };
    const seg = cascade(css);
    const PICKED = { pressed: true, hover: false };
    const PICKED_HOVER = { pressed: true, hover: true };
    ok(seg(PICKED, 'color') === 'var(--bg)' && seg(PICKED, 'background') === 'var(--text)'
      && seg({ pressed: false, hover: false }, 'color') === 'var(--text-dim)', 'the cascade reads the picker: the picked game dark on white, the others dim');
    ok(seg(PICKED_HOVER, 'color') === seg(PICKED, 'color') && seg(PICKED_HOVER, 'color') !== seg(PICKED_HOVER, 'background'),
      'hovered, the picked game\'s logo keeps its colour on its ground', `${seg(PICKED_HOVER, 'color')} on ${seg(PICKED_HOVER, 'background')}`);
    ok(seg({ pressed: false, hover: true }, 'color') === 'var(--text)', 'while hovering a game not picked still lights it');
    const was = cascade(css.replace(':hover:not(:disabled):not([aria-pressed="true"])', ':hover:not(:disabled)'));
    ok(was(PICKED_HOVER, 'color') === was(PICKED_HOVER, 'background'), 'the cascade catches the rule as 8.2.0 wrote it, white on white');
  });

  await section('Home\'s grades:', async () => {
    const at = Date.UTC(2026, 9, 1, 20);
    const rows = [58, 82].map((score, i) => ({ id: `h${i}`, at: at - i * 3600000, title: 'Jett', map: 'Abyss',
      result: 'Victory', score: '13-11', grade: { score, letter: grade.letter(score) } }));
    const h = loadSurface('home', {
      handlers: {
        [C.STATE_GET]: () => ({ ...BASE }), [C.CONFIG_GET]: () => ({ language: 'en' }),
        [C.REVIEWS_LIST]: () => rows,
        [C.PATTERNS_GET]: () => ({ matches: 2, enough: true, mistakes: [], strengths: [], missed: [],
          grades: rows.map((r) => ({ id: r.id, at: r.at, score: r.grade.score, letter: r.grade.letter })), average: 70, categories: [] }),
        [C.REVIEW_GET]: (id) => ({ id, kind: 'valorant', grade: { score: 58, letter: 'D', categories: [] } }),
      },
    });
    await settle();
    const letters = h.$('recent-list').querySelectorAll('.gv-letter');
    ok(letters.length === 2 && toneOf(letters[0]) === toneFor(58) && letters[0].textContent === 'D'
      && toneOf(letters[1]) === toneFor(82), 'each recent match takes the shared colour, with its letter beside it');
    ok(h.scripts.some((x) => /grade-view\.js$/.test(x)), 'from shared/grade-view.js rather than a copy');
  });

  await section('the match library:', async () => {
    const at = Date.UTC(2026, 9, 1, 20);
    // Newest first, as patterns.js returns them.
    const grades = [95, 77, 82, 69, 58].map((score, i) => ({ id: `g${i}`, at: at - i * 3600000, score, letter: grade.letter(score) }));
    const rows = grades.map((g) => ({ id: g.id, at: g.at, title: 'Jett', grade: { score: g.score, letter: g.letter } }));
    const m = loadSurface('matches', {
      handlers: {
        [C.STATE_GET]: () => ({ gameId: 'valorant' }),
        [C.REVIEWS_LIST]: () => rows,
        [C.PATTERNS_GET]: () => ({ matches: 5, enough: false, grades, categories: [], average: 76,
          mistakes: [], strengths: [], missed: [] }),
      },
    });
    await settle();
    const bars = m.document.querySelectorAll('#p-trend .p-bar');
    ok(bars.length === 5 && !m.$('p-trend').hidden, 'one bar per graded match');
    const read = bars.map((b) => ({
      score: Number(b.querySelector('span').textContent),
      // Wherever the score's height is set, on the bar or on its fill.
      h: parseFloat(b.style.getPropertyValue('--h') || b.querySelector('i').style.getPropertyValue('--h')),
      fill: b.querySelector('i'),
    }));
    ok(same(read.map((r) => r.score), [58, 69, 82, 77, 95]), 'oldest on the left');
    ok(read.every((r) => r.h === r.score), 'each bar is its grade as a share of the full height', read.map((r) => r.h).join(','));
    ok(read.every((r) => toneOf(r.fill) === toneFor(r.score)),
      'and each bar is its letter\'s colour', read.map((r) => `${r.score}:${r.fill.className}`).join(' '));

    // Structure, since nothing here measures layout: the number must not share
    // a flex column with the fill, which is what capped every bar near 77%.
    const css = fs.readFileSync(path.join(RENDERER, 'matches', 'matches.css'), 'utf8');
    const rule = (sel) => {
      const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return (css.match(new RegExp(`(?:^|\\n)${esc}\\s*\\{([^}]*)\\}`)) || [])[1] || '';
    };
    ok(/border-radius/.test(rule('.p-trend')), 'the rule reader finds a known rule');
    ok(/position:\s*absolute/.test(rule('.p-bar span')) && /position:\s*absolute/.test(rule('.p-bar i'))
      && /position:\s*relative/.test(rule('.p-bar')) && !/flex-direction/.test(rule('.p-bar')),
      'the number is positioned off the fill, outside the layout that sizes it');
    ok(/height:\s*var\(--h/.test(rule('.p-bar i')) && /bottom:\s*calc\(var\(--h/.test(rule('.p-bar span')),
      'and both read the same --h');

    const letters = m.document.querySelectorAll('#list .m-row .m-letter');
    ok(letters.length === 5 && letters.every((el) => toneOf(el) === TONE[el.textContent]),
      'the rows colour the same grades the same way');
  });

  // K/D/A took K/D's place in the breakdown (8.2): the cell is an average
  // match as a scoreboard prints it, the tooltip the K/D it sorts on and its
  // sample, and it is still one of the columns a narrow window drops.
  await section('the breakdown\'s K/D/A column:', async () => {
    const breakdown = require('../src/shared/breakdown');
    const at = Date.UTC(2026, 9, 1, 20);
    let seq = 0;
    const entry = (game, review) => { seq++; return { id: `${game}-${at - seq * 3600000}-k${seq}`, game, at: at - seq * 3600000, review }; };
    const graded = { score: 70, letter: 'B', provisional: false, categories: [] };
    const val = (map, line) => entry('valorant', { kind: 'valorant', rounds: [], insights: {}, grade: graded,
      game: { map, agent: 'Jett', mode: 'Competitive', result: 'Victory', score: '13-11' },
      scoreline: { acs: 250, adr: 160, headshotPct: 22, ...line } });
    const saved = {
      // Abyss: 31/21/4 and 20/15/7, an average 26/18/6 at K/D 1.42. Lotus:
      // one line of the two has no assists. Haven: 15/10/3. Bind: no assists.
      valorant: [val('Abyss', { kills: 31, deaths: 21, assists: 4 }), val('Abyss', { kills: 20, deaths: 15, assists: 7 }),
        val('Lotus', { kills: 31, deaths: 21, assists: 4 }), val('Lotus', { kills: 20, deaths: 15 }),
        val('Haven', { kills: 15, deaths: 10, assists: 3 }), val('Bind', { kills: 10, deaths: 12 })],
      lol: [entry('lol', { game: { champion: 'Ahri', role: 'Middle', durationSec: 1800, mode: 'CLASSIC' }, grade: graded,
        scoreline: { kills: 8, deaths: 2, assists: 6, cs: 240, ward: 18 }, insights: {} })],
    };
    const m = loadSurface('matches', {
      handlers: {
        [C.STATE_GET]: () => ({ gameId: 'valorant' }),
        [C.REVIEWS_LIST]: () => [],
        [C.PATTERNS_GET]: () => ({ matches: 0, enough: false, grades: [], categories: [], average: null, mistakes: [], strengths: [], missed: [] }),
        [C.BREAKDOWN_GET]: (g, opts) => breakdown.build(g, saved[g] || [], opts),
      },
    });
    await settle();
    const heads = () => m.document.querySelectorAll('#b-table .b-sort').map((b) => b.textContent);
    const rows = () => m.document.querySelectorAll('#b-table .b-row');
    const name = (r) => r.querySelector('.b-name span').textContent;
    const order = () => rows().map(name).join(',');
    const kdaCell = (label) => {
      const r = rows().find((x) => name(x) === label);
      return r ? r.children[heads().indexOf('K/D/A')] : null;
    };
    const sortBy = (title) => m.document.querySelectorAll('#b-table .b-sort').find((b) => b.textContent === title).click();
    // A row opened, and the line under one of its labels in the detail that
    // follows that row.
    const lineOf = (label, dt) => {
      rows().find((x) => name(x) === label).click();
      const all = m.$('b-table').children;
      const at = all.findIndex((x) => x.classList.contains('b-row') && name(x) === label);
      const holder = all[at + 1];
      const box = holder && holder.classList.contains('b-detail-row') ? holder.querySelector('.b-detail') : null;
      const kids = box ? box.children : [];
      const i = kids.findIndex((k) => k.textContent === dt);
      return i === -1 ? '' : kids[i + 1].textContent;
    };

    ok(heads().includes('K/D/A') && !heads().includes('K/D'), 'the Valorant map cut has a K/D/A column, and no K/D one', heads().join(','));
    const abyss = kdaCell('Abyss');
    ok(abyss && abyss.textContent === '26/18/6' && abyss.title === 'K/D 1.42 over 2 matches',
      'its cell is an average match, 26/18/6, its tooltip the K/D and the sample', abyss && `"${abyss.textContent}" "${abyss.title}"`);
    const haven = kdaCell('Haven');
    ok(haven && haven.textContent === '15/10/3' && haven.title === 'K/D 1.50 over 1 match', 'one match is "over 1 match"',
      haven && `"${haven.textContent}" "${haven.title}"`);
    const lotus = kdaCell('Lotus');
    ok(lotus && lotus.textContent === '31/21/4' && lotus.title === 'K/D 1.48 over 1 match',
      'a line with no assists is left out of the cell and its sample', lotus && `"${lotus.textContent}" "${lotus.title}"`);
    const bind = kdaCell('Bind');
    ok(bind && bind.textContent === '--' && bind.classList.contains('none'), 'and a row with no line that has assists shows none');
    ok([abyss, haven, lotus, bind].every((c) => c && c.classList.contains('b-opt'))
      && m.document.querySelectorAll('#b-table .b-th-cell')[heads().indexOf('K/D/A')].classList.contains('b-opt'),
    'it is one of the columns a narrow window drops, header and cells');
    // Its track is the only one held at 64px, so the grids say where it is.
    const table = m.$('b-table');
    const cols = table.style.getPropertyValue('--cols');
    const narrowCols = table.style.getPropertyValue('--cols-narrow');
    ok(cols.split(' minmax')[heads().indexOf('K/D/A')] === '(64px, 1fr)' && !/64px/.test(narrowCols),
      'its track never narrows under its eight characters, and the narrow grid leaves it out', `${cols} | ${narrowCols}`);

    sortBy('K/D/A');
    const down = order();
    sortBy('K/D/A');
    const up = order();
    ok(down === 'Haven,Lotus,Abyss,Bind' && up === 'Abyss,Lotus,Haven,Bind',
      'it sorts on the K/D, 1.50 over 1.48 over 1.42, with the row that has none last either way', `down ${down}, up ${up}`);

    const board = lineOf('Abyss', 'Scoreboard');
    ok(board.startsWith('ACS 250') && board.includes('K/D/A 26/18/6') && board.includes('K/D 1.42') && board.endsWith('2 matches'),
      'the opened row\'s Scoreboard line carries the K/D/A beside the K/D', `read "${board}"`);
    const short = lineOf('Lotus', 'Scoreboard');
    ok(short.includes('K/D/A 31/21/4 (1 match)') && short.endsWith('2 matches'),
      'over fewer matches than the line it sits in, it says its own sample', `read "${short}"`);
    const bare = lineOf('Bind', 'Scoreboard');
    ok(bare.includes('K/D 0.83') && !/K\/D\/A/.test(bare), 'and with no assists read, the line has its K/D and no K/D/A', `read "${bare}"`);

    m.document.querySelectorAll('#b-dims button').find((b) => b.textContent === 'By agent').click();
    ok(heads().includes('K/D/A') && kdaCell('Jett'), 'the agent cut has the column too', heads().join(','));

    // League's KDA is its own ratio, (kills plus assists) over deaths.
    m.bridge.emit(C.PUSH_GAME, { id: 'lol' });
    await settle();
    ok(heads().includes('KDA') && !heads().includes('K/D/A'), 'League keeps its KDA ratio', heads().join(','));
  });

  // RIOT RECORDS WHAT HAPPENED AND NEVER WHY (8.2). A review graded from its
  // record alone paints one neutral list where a recorded one paints three,
  // with no fix line and no verdict colour, whether it was built today or
  // saved by 8.0.3 with three lists and served the way main serves every
  // review (valorant-review.js served()).
  await section('a review graded from Riot\'s record alone states facts:', async () => {
    const { load } = require('./fixtures/replay-match');
    const verify = require('../src/shared/valorant-verify');
    const insights = require('../src/shared/insights');
    const valorantReview = require('../src/shared/valorant-review');
    const riotReview = require('../src/shared/riot-review');
    const rec = load('riot-abyss-13-11.json');
    const fresh = riotReview.fromRiot({ row: { matchId: 'f1', map: 'Abyss', agent: 'Jett', mode: 'Unrated', result: 'Victory',
      score: '13-11', kills: 31, deaths: 21, assists: 4, kd: 1.48, acs: 382, adr: 243, headshotPct: 25,
      startedAt: Date.UTC(2026, 9, 1, 18) }, riot: rec, history: [] }).review;
    fresh.id = 'valorant-1759341600000-facts1';
    const old = { ...JSON.parse(JSON.stringify(fresh)), insights: insights.valorant(verify.reconcile([], rec).rounds, { role: 'Duelist' }) };
    const paintOf = async (r) => {
      const v = loadSurface('review', { handlers: { [C.LOL_REVIEW_GET]: () => r } });
      await settle();
      const host = v.$('insights-host');
      return {
        heads: host.querySelectorAll('h3').map((h) => h.textContent),
        titles: host.querySelectorAll('.gv-item-title').map((t) => t.textContent),
        facts: host.querySelectorAll('.gv-item.fact').length,
        fixes: host.querySelectorAll('.gv-item-fix').length,
        verdicts: host.querySelectorAll('.gv-item.bad').length + host.querySelectorAll('.gv-item.good').length
          + host.querySelectorAll('.gv-item.warn').length,
        patterns: v.document.querySelectorAll('#v-patterns .v-pattern-text').map((p) => p.textContent),
      };
    };
    const a = await paintOf(valorantReview.served(fresh));
    ok(same(a.heads, ["What Riot's record shows"]) && a.facts === fresh.insights.facts.length && a.facts >= 6,
      'one list headed "What Riot\'s record shows", an item for every fact', JSON.stringify(a.heads));
    ok(!a.fixes && !a.verdicts && a.titles.includes('Deaths not traded within five seconds')
      && !a.titles.includes('Died where nobody could trade'), 'with no fix line, no verdict colour and no verdict for a title',
    a.titles.join(' | '));
    ok(!a.patterns.some((t) => /killed you/.test(t)) && a.titles.includes('Deaths to Skye'),
      'and what the list says is not said again under it', a.patterns.join(' | '));
    const b = await paintOf(valorantReview.served(old));
    ok(same(a, b), 'an 8.0.3 one, served, paints exactly the same', JSON.stringify(b.titles));
    // The bug, reproduced: as 8.0.3 saved it, unconverted.
    const raw = await paintOf(old);
    ok(raw.heads.includes('Your repeated mistakes') && raw.fixes > 0, 'unconverted, it paints repeated mistakes with fix lines, which is what players were shown');
    // A recorded review keeps its three lists.
    const recorded = valorantReview.build({ rounds: verify.reconcile([], rec).rounds, context: { agent: 'Jett', map: 'Abyss' },
      endedBy: 'score', ai: {}, role: 'Duelist', history: [], riotMe: rec.me });
    const c = await paintOf(valorantReview.served({ ...recorded, id: 'valorant-1759341600000-recd1' }));
    ok(c.heads.includes('Your repeated mistakes') && c.heads.includes('What went well') && !c.facts && c.fixes > 0,
      'while a recorded match keeps its mistakes, what went well, and the fix for each', JSON.stringify(c.heads));
  });

  // The patterns are over the recorded matches and say so, the grades over
  // every match; the breakdown's repeats likewise.
  await section('the library says the patterns are the recorded matches\':', async () => {
    const breakdown = require('../src/shared/breakdown');
    const mistake = { key: 'untraded', title: 'Died where nobody could trade', matches: 2, total: 5, weight: 2, share: 1,
      judged: false, fix: 'Check someone can see the same angle.', trend: null, examples: [{ id: 'x', at: 1, detail: '3 of your 5 deaths went unanswered.' }] };
    const open = async (p, saved) => {
      const m = loadSurface('matches', {
        handlers: {
          [C.STATE_GET]: () => ({ gameId: 'valorant' }), [C.REVIEWS_LIST]: () => [],
          [C.PATTERNS_GET]: () => ({ grades: [], categories: [], average: null, mistakes: [], strengths: [], missed: [], ...p }),
          [C.BREAKDOWN_GET]: (g, opts) => breakdown.build(g, saved || [], opts),
        },
      });
      await settle();
      return m;
    };
    const mixed = await open({ matches: 9, fromRiot: 7, recorded: 2, enough: true, mistakes: [mistake] });
    ok(mixed.$('p-sub').textContent === 'Grades across your last 9 matches, patterns across the last 2 you recorded. A pattern needs two of them to count.',
      'with Riot only matches among them, the grades and the patterns each say what they are over', mixed.$('p-sub').textContent);
    const detail = mixed.document.querySelector('#p-lists .gv-item-detail');
    ok(detail && detail.textContent.startsWith('In 2 of your last 2 recorded matches.'), 'and a pattern is counted out of the recorded ones',
      detail && detail.textContent);
    const plain = await open({ matches: 3, fromRiot: 0, recorded: 3, enough: true, mistakes: [mistake] });
    ok(plain.$('p-sub').textContent === 'Across your last 3 matches. A pattern needs two of them to count.',
      'with none, one line for both', plain.$('p-sub').textContent);
    const riotOnly = await open({ matches: 7, fromRiot: 7, recorded: 0, enough: false });
    ok(/graded from Riot's record, which says what happened and not why/.test(riotOnly.$('p-sub').textContent)
      && !riotOnly.document.querySelectorAll('#p-lists .gv-item').length, 'every match from Riot\'s record: no pattern, and why',
    riotOnly.$('p-sub').textContent);
    const one = await open({ matches: 8, fromRiot: 7, recorded: 1, enough: false });
    ok(one.$('p-sub').textContent === 'One match recorded. After the next one, this shows what repeats.', 'one recorded match waits for the next',
      one.$('p-sub').textContent);
    const none = await open({ matches: 0, fromRiot: 0, recorded: 0, enough: false });
    ok(none.$('p-sub').textContent === 'Play two matches and this shows what keeps happening across them.', 'and an empty library asks for two');

    // A breakdown row: two recorded matches on Abyss with the same mistake,
    // and one graded from Riot's record alone, saved by 8.0.3 with it too.
    const graded = { score: 70, letter: 'B', provisional: false, categories: [] };
    const ins = { mistakes: [{ key: 'untraded', title: 'Died where nobody could trade', fix: 'Check the angle.', count: 5, weight: 2, rounds: [] }],
      strengths: [], missed: [] };
    const at = Date.UTC(2026, 9, 1, 20);
    const row = (i, source) => ({ id: `valorant-${at - i * 3600000}-rep${i}`, game: 'valorant', at: at - i * 3600000,
      review: { kind: 'valorant', source, rounds: [], insights: ins, grade: graded,
        game: { map: 'Abyss', agent: 'Jett', mode: 'Competitive', result: 'Victory', score: '13-11' } } });
    const b = await open({ matches: 0, enough: false }, [row(1, 'riot'), row(2, 'watched'), row(3, 'watched')]);
    const r0 = b.document.querySelector('#b-table .b-row');
    if (r0) r0.click();
    const kids = (b.document.querySelector('#b-table .b-detail') || { children: [] }).children;
    const at2 = kids.findIndex((k) => k.textContent === 'Repeated here');
    const said = at2 === -1 ? '' : kids[at2 + 1].textContent;
    ok(said.startsWith('Died where nobody could trade, in 2 of 2 recorded matches.'),
      'a breakdown row counts its repeat out of its recorded matches, and says so', `read "${said}"`);
  });

  // The record beside the Matches title (8.2): "2:1" in Geist Mono at the
  // title's size, wins green and losses red, on the list page alone.
  await section('the Matches title carries the matches won and lost:', async () => {
    const at = Date.UTC(2026, 9, 1, 20);
    const results = {
      valorant: ['Victory', 'Defeat', 'Victory', 'Draw', null, 'Victory', 'Defeat'],
      lol: [null, null],
    };
    const rowsFor = (g) => (results[g] || []).map((result, i) => ({ id: `${g}-${i}`, at: at - i * 3600000, title: 'Jett',
      result, score: result ? '13-11' : null, grade: { score: 70, letter: 'B' } }));
    const open = async (sectionName) => {
      const p = loadSurface('matches', {
        handlers: {
          [C.STATE_GET]: () => ({ gameId: 'valorant' }),
          [C.REVIEWS_LIST]: (g) => rowsFor(g),
          [C.PATTERNS_GET]: () => ({ matches: 0, enough: false, grades: [], categories: [], average: null, mistakes: [], strengths: [], missed: [] }),
        },
        window: { location: { hash: '', search: `?embed=1&section=${sectionName}` } },
      });
      await settle();
      return p;
    };
    const m = await open('list');
    const wl = m.$('wl');
    const read = () => ({ shown: !wl.hidden, w: wl.querySelector('.wl-w').textContent, l: wl.querySelector('.wl-l').textContent,
      sr: wl.querySelector('.wl-sr').textContent, title: wl.title });
    let r = read();
    ok(r.shown && r.w === '3' && r.l === '2', 'three won and two lost read 3 and 2', JSON.stringify(r));
    const painted = (cls) => m.document.querySelectorAll(`#list .m-res.${cls}`).length;
    ok(painted('win') === 3 && painted('loss') === 2, 'exactly the rows below it painted as won and as lost',
      `rows: ${painted('win')} won, ${painted('loss')} lost`);
    ok(r.sr === '3 wins, 2 losses', 'a screen reader is told "3 wins, 2 losses"', `read "${r.sr}"`);
    ok(r.title === '3 wins, 2 losses, 1 draw. 1 match with no result is not counted.',
      'the tooltip adds the draw and the match with no result', `read "${r.title}"`);
    ok(!DASHES.test(r.title + r.sr), 'with no dash in either');
    const h2 = m.document.querySelector('.sheet > header .h-brand h2');
    ok(h2 && h2.textContent === 'Matches' && wl.parentNode === h2.parentNode, 'beside the Matches title, in its header');
    ok(['.wl-w', '.wl-sep', '.wl-l'].every((s) => wl.querySelector(s).getAttribute('aria-hidden') === 'true')
      && wl.querySelector('.wl-sep').textContent === ':' && wl.querySelector('.wl-sr').classList.contains('sr-only'),
    'the digits and the colon are for the eye, the sentence for a screen reader');

    results.valorant = ['Victory', ...results.valorant];
    m.bridge.emit(C.PUSH_REVIEWS, { id: 'valorant-new', game: 'valorant' });
    await settle();
    r = read();
    ok(r.w === '4' && r.l === '2' && r.sr === '4 wins, 2 losses', 'a review saved while it is open repaints it', JSON.stringify(r));
    // A result is counted in whatever case it was saved in, as its row is painted.
    results.valorant = ['VICTORY', 'defeat', 'victory'];
    m.bridge.emit(C.PUSH_REVIEWS, { id: 'valorant-case', game: 'valorant' });
    await settle();
    r = read();
    ok(r.shown && r.w === '2' && r.l === '1' && r.title === '2 wins, 1 loss.' && painted('win') === 2 && painted('loss') === 1,
      'a result is counted in whatever case it was saved in, as its row is painted', JSON.stringify(r));
    m.bridge.emit(C.PUSH_GAME, { id: 'lol' });
    await settle();
    ok(wl.hidden && m.document.querySelectorAll('#list .m-row').length === 2,
      'League, whose reviews carry no result, shows no record over its two games');
    results.valorant = [];
    m.bridge.emit(C.PUSH_GAME, { id: 'valorant' });
    await settle();
    ok(wl.hidden, 'nor does an empty library');
    results.valorant = ['Victory', 'Defeat'];
    for (const s of ['patterns', 'breakdown']) {
      const p = await open(s);
      ok(p.$('wl').hidden && p.document.querySelectorAll('#list .m-res').length === 2,
        `the ${s} page, titled for what it counts, carries no record`);
    }

    // The look, read off the stylesheets: Geist Mono 800 at the title's two
    // sizes, a window's 13px and a page's 24px, wins --good and losses --bad.
    const css = fs.readFileSync(path.join(RENDERER, 'matches', 'matches.css'), 'utf8');
    const ui = fs.readFileSync(path.join(RENDERER, 'shared', 'ui.css'), 'utf8');
    const rule = (src, sel) => {
      const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return (src.match(new RegExp(`(?:^|\\n)${esc}\\s*\\{([^}]*)\\}`)) || [])[1] || '';
    };
    const prop = (body, name) => ((body.match(new RegExp(`(?:^|[;\\s])${name}\\s*:\\s*([^;]+);`)) || [])[1] || '').trim();
    ok(prop(rule(css, '.p-trend'), 'border-radius') === 'var(--r-md)' && prop('a: 1; font-size: 13px;', 'font-size') === '13px',
      'the rule and property readers find a known rule and property');
    const base = rule(css, '.wl');
    ok(prop(base, 'font-family') === 'var(--font-mono)' && prop(base, 'font-weight') === '800'
      && prop(rule(css, '.wl b'), 'font-weight') === 'inherit', 'Geist Mono at 800, its bold tags inheriting it', base.trim());
    ok(prop(base, 'font-size') === prop(rule(css, '.h-brand h2'), 'font-size')
      && prop(rule(css, 'html.embedded .sheet > header .wl'), 'font-size') === prop(rule(ui, 'html.embedded .sheet > header .h-brand h2'), 'font-size')
      && prop(rule(css, 'html.embedded .sheet > header .wl'), 'font-size') === '24px',
    'at the title\'s size in a window and as a page');
    ok(prop(rule(css, '.wl-w'), 'color') === 'var(--good)' && prop(rule(css, '.wl-l'), 'color') === 'var(--bad)'
      && prop(rule(css, '.wl-sep'), 'color') === 'var(--text-mute)', 'wins --good, losses --bad, the colon dim');
    ok(/clip:/.test(rule(ui, '.sr-only')) && !/\n\.sr-only\s*\{/.test(fs.readFileSync(path.join(RENDERER, 'shell', 'shell.css'), 'utf8')),
      'the screen reader class is the shared one in ui.css, which the library loads, not a copy');
  });

  // THE EYE (8.2): a recorded match's AI log, from its row. A button beside the
  // row's own, never inside it; disabled with its reason once the log no
  // longer holds the match; none where nothing was recorded. The "Ask" the
  // row carried inside its own button is gone.
  const LogEye = require('../src/renderer/shared/log-eye');
  // The eye Stats opens the AI log with, read off its markup, so the two
  // cannot drift into two icons for one thing.
  const statsDoc = new Document(fs.readFileSync(path.join(RENDERER, 'stats', 'index.html'), 'utf8'));
  const statsEye = statsDoc.querySelector('#ailog svg');
  const eyeShape = (svg) => (svg ? [svg.querySelector('path') && svg.querySelector('path').getAttribute('d'),
    ...['cx', 'cy', 'r'].map((a) => svg.querySelector('circle') && svg.querySelector('circle').getAttribute(a)),
    svg.getAttribute('viewBox'), svg.getAttribute('stroke')].join('|') : '');
  await section('a library row opens its match\'s AI log, with the eye beside it:', async () => {
    const at = Date.UTC(2026, 9, 1, 20);
    const ROWS = {
      valorant: [
        { id: `valorant-${at}-kept01`, at, game: 'valorant', title: 'Jett', source: 'watched', aiLog: 'kept', grade: { score: 82, letter: 'A' } },
        { id: `valorant-${at - 3600000}-gone01`, at: at - 3600000, game: 'valorant', title: 'Jett', source: 'watched', aiLog: 'gone', grade: { score: 70, letter: 'B' } },
        { id: `valorant-${at - 7200000}-riot01`, at: at - 7200000, game: 'valorant', title: 'Sova', source: 'riot', aiLog: null, grade: { score: 75, letter: 'B' } },
      ],
      lol: [{ id: `lol-${at}-lol001`, at, game: 'lol', title: 'Ahri', aiLog: null, grade: { score: 72, letter: 'B' } }],
    };
    const m = loadSurface('matches', {
      handlers: {
        [C.STATE_GET]: () => ({ gameId: 'valorant' }),
        [C.REVIEWS_LIST]: (g) => ROWS[g] || [],
        [C.PATTERNS_GET]: () => ({ matches: 0, enough: false, grades: [], categories: [], average: null, mistakes: [], strengths: [], missed: [] }),
      },
    });
    await settle();
    const items = () => m.document.querySelectorAll('#list .m-item');
    const rowOf = (it) => it.children.find((c) => c.classList.contains('m-row')) || null;
    const eyeOf = (it) => it.children.find((c) => c.classList.contains('log-eye')) || null;
    const sent = (ch) => m.bridge.sent.filter((s) => s[0] === ch);
    ok(items().length === 3 && items().every((it) => it.getAttribute('role') === 'listitem' && rowOf(it)),
      'each match is a list item holding its row');
    ok(items().every((it) => rowOf(it).tagName === 'BUTTON' && !rowOf(it).querySelectorAll('button').length
      && !rowOf(it).querySelector('.log-eye') && rowOf(it).getAttribute('role') === null),
    'the row is a plain button with no control inside it');
    const kept = eyeOf(items()[0]);
    ok(kept && kept.tagName === 'BUTTON' && kept.type === 'button' && !kept.disabled
      && kept.getAttribute('aria-label') === 'Open the AI log of this match' && kept.title === 'Open the AI log of this match',
    'a recorded match has the eye, a sibling of its row, named for what it opens');
    ok(kept && eyeShape(kept.querySelector('svg')) === eyeShape(statsEye) && eyeShape(statsEye).startsWith('M2 12')
      && kept.querySelector('svg').getAttribute('aria-hidden') === 'true',
    'drawn as the Stats header draws the AI log\'s eye', `${eyeShape(kept && kept.querySelector('svg'))} | ${eyeShape(statsEye)}`);
    if (kept) kept.click();
    ok(same(sent(C.REVIEW_AILOG), [[C.REVIEW_AILOG, ROWS.valorant[0].id]]) && !sent(C.REVIEW_OPEN).length,
      'pressed, it sends that review\'s id alone over REVIEW_AILOG, and does not open the review', JSON.stringify(m.bridge.sent));
    const gone = eyeOf(items()[1]);
    ok(gone && gone.disabled && gone.title === LogEye.GONE && gone.getAttribute('aria-label') === 'Open the AI log of this match'
      && /No AI log is kept for this match/.test(gone.title) && /frames the coach looked at/.test(gone.title),
    'once the log no longer holds the match, the eye is disabled and its tooltip says why', gone && gone.title);
    if (gone) gone.click();
    ok(sent(C.REVIEW_AILOG).length === 1, 'and a disabled eye sends nothing');
    ok(!eyeOf(items()[2]), 'a match graded from Riot\'s record alone, with nothing recorded, has no eye');
    const gapOf = (it) => it.children.find((c) => c.classList.contains('m-eye-gap')) || null;
    ok(gapOf(items()[2]) && gapOf(items()[2]).getAttribute('aria-hidden') === 'true' && !gapOf(items()[0]) && !gapOf(items()[1]),
      'and keeps the eye\'s room, hidden from a screen reader, so the grades line up down the list');
    ok(!m.document.querySelectorAll('#list .m-ask').length && !items().some((it) => /\bAsk\b/.test(it.textContent)),
      'and no row says Ask any more');
    rowOf(items()[0]).click();
    ok(same(sent(C.REVIEW_OPEN), [[C.REVIEW_OPEN, ROWS.valorant[0].id]]) && sent(C.REVIEW_AILOG).length === 1,
      'the row itself still opens the review, and only the review');
    ok(typeof m.bridge.api.openAiLog === 'function' && typeof m.bridge.api.askAbout === 'undefined',
      'the library\'s bridge opens the AI log and no longer asks about a match');
    m.bridge.emit(C.PUSH_GAME, { id: 'lol' });
    await settle();
    ok(items().length === 1 && !eyeOf(items()[0]) && !gapOf(items()[0]),
      'League writes no AI log, so its rows have no eye, nor room kept for one');
    ok(!DASHES.test(LogEye.NAME + LogEye.GONE), 'with no dash in its name or its tooltip');
  });

  await section('the review\'s header opens its match\'s AI log, beside Ask about this match:', async () => {
    const base = { id: 'valorant-1759348800000-kept01', kind: 'valorant', source: 'watched', rounds: [],
      game: { map: 'Abyss', agent: 'Jett', result: 'Victory', score: '13-11' } };
    const open = async (r) => {
      const v = loadSurface('review', { handlers: { [C.LOL_REVIEW_GET]: () => r } });
      await settle();
      return v;
    };
    const eyeIn = (v) => v.$('eye-host').querySelector('.log-eye');
    const v = await open({ ...base, aiLog: 'kept' });
    const eye = eyeIn(v);
    ok(!v.$('eye-host').hidden && eye && !eye.disabled && eye.getAttribute('aria-label') === LogEye.NAME,
      'a recorded review shows the eye in its header');
    const actions = v.$('ask').parentNode;
    ok(v.$('eye-host').parentNode === actions && actions.classList.contains('h-actions')
      && actions.children.indexOf(v.$('eye-host')) === actions.children.indexOf(v.$('ask')) - 1,
    'right beside Ask about this match');
    ok(eye && eyeShape(eye.querySelector('svg')) === eyeShape(statsEye) && v.scripts.some((s) => /log-eye\.js$/.test(s)),
      'the same eye as its row in Matches, from shared/log-eye.js');
    if (eye) eye.click();
    ok(same(v.bridge.sent.filter((s) => s[0] === C.REVIEW_AILOG), [[C.REVIEW_AILOG, base.id]]),
      'pressed, it sends this review\'s id over REVIEW_AILOG', JSON.stringify(v.bridge.sent));
    const g = await open({ ...base, aiLog: 'gone' });
    ok(eyeIn(g) && eyeIn(g).disabled && eyeIn(g).title === LogEye.GONE, 'disabled with its reason once the log no longer holds it');
    const riot = await open({ ...base, source: 'riot', aiLog: null });
    ok(riot.$('eye-host').hidden && !eyeIn(riot) && !riot.$('ask').hidden,
      'a review graded from Riot\'s record alone has no eye, and still has Ask');
    // The page is kept between reviews, so the eye follows whichever is painted.
    v.bridge.emit(C.PUSH_LOL_REVIEW, { id: 'lol-1759348800000-lol001', kind: 'lol', aiLog: null,
      game: { champion: 'Ahri', role: 'Middle', mode: 'CLASSIC', duration: '31:04' },
      scoreline: { kills: 10, deaths: 5, assists: 20, cs: 210, csAt10: 70, ward: 14 },
      deaths: { headline: '', detail: '' }, deathList: [], moments: [], objectives: {}, scored: [], unmeasured: [], next: null, gamesRecorded: 0 });
    await settle();
    ok(v.$('eye-host').hidden && !eyeIn(v), 'a League review painted after it takes the eye away');
    v.bridge.emit(C.PUSH_VALORANT_REVIEW, { ...base, aiLog: 'kept' });
    await settle();
    ok(!v.$('eye-host').hidden && eyeIn(v) && !eyeIn(v).disabled, 'and the next recorded one brings it back');
    ok(v.bridge.api.openAiLog && typeof v.bridge.api.askAbout === 'function', 'the review\'s bridge opens the AI log and still asks about a match');
  });

  // A REVIEW STILL BEING BUILT IS A LOADING SCREEN (8.4.1): "if the match
  // review is not complete, loading and verifying from Riot, have it as a
  // loading screen until everything is complete". What is left of a job's
  // work (shared/review-work.js workOf), then the page: the steps while it is
  // built, and the review whole once main says the work is done.
  await section('a review still being built is a loading screen, painted whole once its work is done:', async () => {
    const reviewWork = require('../src/shared/review-work');
    const { workOf, RIOT_WAIT_MS, BUILD_MAX_MS, STEPS } = reviewWork;
    const END = Date.UTC(2026, 9, 13, 20, 0, 0);
    const job = (extra, snap) => ({ id: 'valorant-1792000000000-build1', snap: { endedAt: END, endedBy: 'score', ...(snap || {}) }, ...(extra || {}) });
    const at = (j, ms, riot) => workOf(j, END + ms, riot === undefined ? true : riot);
    const w0 = at(job({ byRiot: true }), 30000);
    ok(w0 && w0.path === 'riot' && w0.step === 'riot' && same(w0.steps, ['saved', 'riot', 'deaths', 'look', 'writing'])
      && w0.endedAt === END && w0.until === END + RIOT_WAIT_MS && w0.scoreboard === false,
    'with a Riot ID, a match just over waits for Riot\'s record, and says until when', JSON.stringify(w0));
    ok(RIOT_WAIT_MS === 6 * 60000 && BUILD_MAX_MS === 12 * 60000 && same(STEPS.screen, ['saved', 'writing', 'look']),
      'Riot\'s record waited for six minutes, nothing a loading screen past twelve, and from the screen alone the review written before the look');
    ok(at(job({ byRiot: true, tracker: { matchId: 'm1' } }), 90000).scoreboard === true, 'the scoreboard linked, still waiting for the rounds');
    const busy = at(job({ byRiot: true, riotBusy: true, stage: 'look' }), 7 * 60000);
    ok(busy && busy.step === 'look' && busy.until === null, 'Riot\'s rounds in at the last moment, the look and the review still come after six minutes', JSON.stringify(busy));
    ok(at(job({ byRiot: true, riotBusy: true }), 60000).step === 'deaths' && at(job({ byRiot: true, riotBusy: true, stage: 'nope' }), 60000).step === 'deaths',
      'its rounds in with no step said yet, or one it does not know: laying them over the screen\'s');
    ok(at(job({ byRiot: true }), RIOT_WAIT_MS) === null && at(job({ byRiot: true }), RIOT_WAIT_MS - 1) !== null,
      'Riot\'s record not in after six minutes: the review is painted from the screen');
    ok(at(job({ byRiot: true, riotBusy: true }), BUILD_MAX_MS) === null, 'and past twelve nothing is a loading screen, whatever is still going on');
    ok([{ riotLooked: true }, { linkMissing: true }, { linkMissing: 'later' }, { finished: true }, { cancelled: true }, { released: true }]
      .every((x) => at(job({ byRiot: true, ...x }), 60000) === null),
    'none once Riot\'s look has landed and the read is written, the link has given up, the work is over, it was withdrawn, or it was once painted whole');
    ok(at(job({ byRiot: false }), 10000).step === 'writing' && at(job({ byRiot: false, narrated: true }), 10000).step === 'look'
      && at(job({ byRiot: false, narrated: true, screenLooked: true }), 10000) === null && at(job({ byRiot: false }), 10000).until === null,
    'from the screen alone: the review written, then the look from the screen, then whole');
    ok(at(job({}), 10000, false).path === 'screen' && at(job({}), 10000, true).path === 'riot'
      && at(job({ byRiot: false }), 10000, true).path === 'screen' && at(job({ byRiot: true }), 10000, false).path === 'riot',
    'which way, decided as the narrative comes back, and the Riot ID in Settings until then');
    ok(at(job({ byRiot: true }, { stoppedLive: true }), 10000) === null && at(job({ byRiot: true }, { endedBy: 'next-match' }), 10000) === null,
      'never for a part of a match, saved and not shown: one recording was stopped in, or the next began over');
    ok(at(job({ byRiot: true }), -60000).step === 'riot' && workOf(null, END, true) === null && workOf(job({}, { endedAt: null }), END, true) === null,
      'a clock set back counts from the end, and no job or no end is no loading screen');

    // The page.
    const BUILT = { id: 'valorant-1792000000000-build1', kind: 'valorant', source: 'watched', aiLog: 'kept', rounds: [],
      game: { map: 'Abyss', agent: 'Jett', result: 'Defeat', score: '3-5' },
      grade: { score: 61, letter: 'C', provisional: false, categories: [], notes: [] },
      summary: 'The screen\'s read of the match.', insights: { mistakes: [], strengths: [], missed: [] } };
    const ended = Date.now() - 100000;
    const RIOT_WORK = { path: 'riot', steps: ['saved', 'riot', 'deaths', 'look', 'writing'], step: 'riot', endedAt: ended, until: ended + RIOT_WAIT_MS, scoreboard: false };
    const v = loadSurface('review', { handlers: { [C.LOL_REVIEW_GET]: () => ({ ...BUILT, work: RIOT_WORK }) } });
    await settle();
    const steps = () => v.document.querySelectorAll('#b-steps .b-step').map((li) => `${li.dataset.step}:${li.className.split(' ')[1]}`);
    ok(!v.$('building').hidden && v.$('vreview').hidden && v.$('review').hidden && v.$('empty').hidden && v.$('common').hidden,
      'a review still being built arrives as its loading screen, nothing of the review behind it');
    ok(same(steps(), ['saved:done', 'riot:now', 'deaths:next', 'look:next', 'writing:next']), 'its steps in order, the one it is on marked', steps().join(' '));
    ok(v.$('b-title').textContent === 'Checking your match'
      && v.$('b-sub').textContent === "Your review opens here once Riot's record is laid over what the coach read and the coach has looked at your deaths.",
    'it says what it is waiting for', v.$('b-sub').textContent);
    const now = v.document.querySelector('#b-steps .b-step.now');
    ok(now && now.getAttribute('aria-current') === 'step' && /Riot publishes a match 1 to 4 minutes after it ends/.test(now.textContent)
      && /^1:4\d$/.test((now.querySelector('.b-time') || {}).textContent || ''),
    'the wait for Riot\'s record says how long it usually takes, and how long since the match ended', now && now.textContent);
    ok(/^If Riot's record is not out within 4:\d\d, the review opens with what the screen read, and fills in when the record comes\.$/.test(v.$('b-foot').textContent),
      'and how long the page waits for it before painting what the screen read', v.$('b-foot').textContent);
    ok(v.$('b-now').getAttribute('aria-live') === 'polite' && v.$('b-now').textContent === "Waiting for Riot's record"
      && (now.querySelector('.b-time') || {}).getAttribute('aria-hidden') === 'true',
    'the step is said once to a screen reader, the ticking clock never');
    ok(v.$('ask').hidden && !v.$('eye-host').hidden, 'Ask about this match waits for the whole review; the eye on its frames does not');
    // A minute on, by the page's own clock: its second's tick says so.
    v.window.Date = class extends Date { static now() { return Date.now() + 60000; } };
    v.clock.advance(1000);
    ok(/^2:4\d$/.test((v.document.querySelector('#b-steps .b-step.now .b-time') || {}).textContent || ''), 'the clock goes on ticking, a second at a time');
    // The record lands: the steps move on, said once.
    v.bridge.emit(C.PUSH_REVIEW_WORK, { id: BUILT.id, work: { ...RIOT_WORK, step: 'look', until: null } });
    await settle();
    ok(same(steps(), ['saved:done', 'riot:done', 'deaths:done', 'look:now', 'writing:next']) && v.$('b-now').textContent === "The coach's look at your deaths"
      && v.$('b-foot').textContent === "Riot's record is in.",
    'Riot\'s record in, the steps move on to the coach\'s look', steps().join(' '));
    v.bridge.emit(C.PUSH_REVIEW_WORK, { id: 'valorant-1792000000000-other1', work: null });
    await settle();
    ok(!v.$('building').hidden, 'another review\'s work is not this page\'s business');
    // A newer version arrives while it is still being built: held, not painted.
    v.bridge.emit(C.PUSH_VALORANT_REVIEW, { ...BUILT, summary: "Riot's read of the match.", work: { ...RIOT_WORK, step: 'writing', until: null } });
    await settle();
    ok(!v.$('building').hidden && v.$('vreview').hidden && same(steps().slice(-1), ['writing:now']), 'a newer version of it while it is built is held, the loading screen on');
    // Whole: the version held is painted.
    v.bridge.emit(C.PUSH_REVIEW_WORK, { id: BUILT.id, work: null });
    await settle();
    ok(v.$('building').hidden && !v.$('vreview').hidden && v.$('v-summary').textContent === "Riot's read of the match."
      && (v.document.querySelector('#grade-host .gv-score') || {}).textContent === '61' && !v.$('ask').hidden,
    'its work done, the review is painted whole from the version the page holds, its grade, its read and Ask with it');
    ok(v.$('vreview').classList.contains('v-arrive'), 'and it rises in where the loading screen was');

    // From the screen alone.
    const s = loadSurface('review', { handlers: { [C.LOL_REVIEW_GET]: () => ({ ...BUILT,
      work: { path: 'screen', steps: ['saved', 'writing', 'look'], step: 'writing', endedAt: Date.now() - 20000, until: null, scoreboard: false } }) } });
    await settle();
    const sSteps = s.document.querySelectorAll('#b-steps .b-step').map((li) => `${li.dataset.step}:${li.className.split(' ')[1]}`);
    ok(!s.$('building').hidden && s.$('b-title').textContent === 'Writing your review' && same(sSteps, ['saved:done', 'writing:now', 'look:next'])
      && s.$('b-foot').hidden && s.$('b-sub').textContent === 'Your review opens here once it is whole, usually in a minute or two.',
    'with no Riot ID, the review written, then the coach\'s look, and no wait for Riot', sSteps.join(' '));
    // A review with no work, saved before or done long ago, is never one.
    const done = loadSurface('review', { handlers: { [C.LOL_REVIEW_GET]: () => ({ ...BUILT, work: null }) } });
    await settle();
    const plain = loadSurface('review', { handlers: { [C.LOL_REVIEW_GET]: () => ({ ...BUILT }) } });
    await settle();
    ok(done.$('building').hidden && !done.$('vreview').hidden && plain.$('building').hidden && !plain.$('vreview').hidden,
      'a review with no work, or saved before there was any, is painted whole at once');
    // The page is kept between reviews: another one shown over the loading screen takes it away.
    v.bridge.emit(C.PUSH_VALORANT_REVIEW, { ...BUILT, work: RIOT_WORK });
    await settle();
    v.bridge.emit(C.PUSH_LOL_REVIEW, { id: 'lol-1759348800000-lol002', kind: 'lol', aiLog: null,
      game: { champion: 'Ahri', role: 'Middle', mode: 'CLASSIC', duration: '31:04' },
      scoreline: { kills: 10, deaths: 5, assists: 20, cs: 210, csAt10: 70, ward: 14 },
      deaths: { headline: '', detail: '' }, deathList: [], moments: [], objectives: {}, scored: [], unmeasured: [], next: null, gamesRecorded: 0 });
    await settle();
    ok(v.$('building').hidden && !v.$('review').hidden, 'another review painted over a loading screen takes it away');
    ok(v.bridge.listening(C.PUSH_REVIEW_WORK) === 1 && C.PUSH_LIST.includes(C.PUSH_REVIEW_WORK), 'over PUSH_REVIEW_WORK, a channel from channels.js');

    // In the app's own design: tokens, no gradient, and still asked for less motion.
    const css = fs.readFileSync(path.join(RENDERER, 'review', 'review.css'), 'utf8');
    const part = css.slice(css.indexOf('A review still being built (8.4.1)'), css.indexOf('Every game: the grade, the lists'));
    ok(part.length > 200 && !/gradient/i.test(part) && !/#[0-9a-f]{3,8}\b/i.test(part) && /var\(--bg-2\)/.test(part) && /var\(--r-md\)/.test(part),
      'its rules use the theme\'s tokens and no gradient');
    // NOTHING ON IT MOVES FOR LONG: an animation that never ends kept the page
    // composited every frame, and the look's stills, decoded on the GPU while
    // it waits, timed out in check:clips. Its arrival alone moves, and not
    // when asked for less motion.
    ok(!/infinite/.test(part) && /\.building \{[^}]*animation: riseIn/.test(part)
      && /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.building, #vreview\.v-arrive \{ animation: none; \}/.test(part),
    'nothing on it moves for long, its arrival alone, and that not when asked for less motion; the clock ticking is what says it goes on');
  });

  // THE CLOCK THAT ENDS A LOADING SCREEN, and the latch that keeps it ended,
  // are main's (index.js workOfJob, noteWork, watchWork), run here in a
  // sandbox on a fake clock. workOf() alone says when the work is null; it is
  // main's second's tick that tells the page so at six minutes, when nothing
  // else happens, and main's `released` that keeps Riot's rounds landing at
  // seven minutes from turning a review painted whole back into a loading
  // screen. Neither was held by any check.
  await section('main ends a review\'s loading screen by the clock, and never brings it back:', async () => {
    const vm = require('vm');
    const reviewWork = require('../src/shared/review-work');
    const { RIOT_WAIT_MS, BUILD_MAX_MS } = reviewWork;
    const idx = fs.readFileSync(path.join(ROOT, 'src', 'main', 'index.js'), 'utf8').replace(/\r\n/g, '\n');
    const head = '\nconst riotIdSet = ';
    const from = idx.indexOf(head);
    const to = from < 0 ? -1 : idx.indexOf('\n/**\n * The engine says the last end was wrong', from);
    const WIRING = to < 0 ? '' : idx.slice(from, to);
    ok(/function workOfJob\(/.test(WIRING) && /function noteWork\(/.test(WIRING) && /function watchWork\(/.test(WIRING),
      'main\'s work wiring is found in index.js');
    const END = Date.UTC(2026, 9, 13, 21, 0, 0);
    let clock = END + 30000;
    const timers = new Map();
    let seq = 0;
    const pushes = [];
    const box = {
      console: { log() {}, warn() {}, error() {} },
      Date: { now: () => clock },
      setInterval: (fn, ms) => { const id = ++seq; timers.set(id, { fn, ms, next: clock + ms }); return id; },
      clearInterval: (id) => { timers.delete(id); },
      store: { get: (k) => (k === 'riotId' ? 'Player#EUW' : null) },
      reviewWork, reviewJobs: new Map(), C,
      registry: { broadcast: (ch, msg) => pushes.push({ ch, ...msg }) },
    };
    // Each timer due by then runs in order, the clock at its moment.
    const advance = (ms) => {
      const until = clock + ms;
      for (;;) {
        let due = null;
        for (const t of timers.values()) if (t.next <= until && (!due || t.next < due.next)) due = t;
        if (!due) break;
        clock = due.next;
        due.next += due.ms;
        due.fn();
      }
      clock = until;
    };
    vm.createContext(box);
    const w = WIRING ? vm.runInContext(`${WIRING}\n;({ workOfJob, workForId, noteWork })`, box) : null;
    if (!w) return;
    const job = { id: 'valorant-1792000000000-wire1', snap: { endedAt: END, endedBy: 'score' }, byRiot: true, narrated: true };
    box.reviewJobs.set(END - 40 * 60000, job);
    w.noteWork(job);
    ok(pushes.length === 1 && pushes[0].ch === C.PUSH_REVIEW_WORK && pushes[0].id === job.id
      && pushes[0].work && pushes[0].work.step === 'riot' && timers.size === 1,
    'a review waiting for Riot\'s record says so, once, and main\'s second\'s tick starts', JSON.stringify(pushes));
    advance(60000);
    ok(pushes.length === 1, 'the tick says nothing while nothing has changed');
    advance(RIOT_WAIT_MS - 90000 - 1000);
    ok(pushes.length === 1 && !job.released, 'still waiting a second before six minutes');
    advance(1000);
    ok(pushes.length === 2 && pushes[1].id === job.id && pushes[1].work === null && job.released === true && timers.size === 0,
      'Riot\'s record not in at six minutes: the tick says the work is done, once, with nothing else happening, and stops', JSON.stringify(pushes[1]));
    advance(60000);
    job.riotBusy = true;
    job.stage = 'deaths';
    w.noteWork(job);
    ok(pushes.length === 2 && w.workForId(job.id) === null && timers.size === 0,
      'Riot\'s rounds landing at seven minutes never turn the review painted whole back into a loading screen', JSON.stringify(pushes.slice(2)));
    // Riot's rounds in at the last moment: the look and the read still come,
    // and twelve minutes after the end the page is painted whatever is left.
    const late = { id: 'valorant-1792000000000-wire2', snap: { endedAt: clock - (BUILD_MAX_MS - 2000), endedBy: 'score' },
      byRiot: true, narrated: true, riotBusy: true, stage: 'look' };
    box.reviewJobs.set(END - 20 * 60000, late);
    w.noteWork(late);
    ok(pushes.length === 3 && pushes[2].work && pushes[2].work.step === 'look' && timers.size === 1, 'its look still out, the page is told the step');
    advance(3000);
    ok(pushes.length === 4 && pushes[3].id === late.id && pushes[3].work === null && timers.size === 0,
      'and twelve minutes after the end the tick paints it, whatever is still going on');
    // Withdrawn, a review is said nothing more about, and no review it is not is ever one.
    const gone = { id: 'valorant-1792000000000-wire3', snap: { endedAt: clock, endedBy: 'score' }, byRiot: true, cancelled: true };
    box.reviewJobs.set(END - 10 * 60000, gone);
    w.noteWork(gone);
    ok(pushes.length === 4 && w.workForId('valorant-1792000000000-none') === null, 'a withdrawn review is said nothing more about, and an id with no job has no work');
  });

  // EVERY ROUND, ONCE (8.3.1): one list of rounds, and a death the coach looked
  // at inside its own round, where it was a section of its own at the bottom of
  // the page ("Where you died, and how") with the round's facts said again. A
  // look is its clip, its frames (up to five from the recording with their
  // seconds against the death, or the two the coach read), the cause, what
  // happened and the better play; a round with no look carries its why; a round
  // with nothing to say is one line; and the coach's raw notes are never shown.
  await section('the review is one list of rounds, each death the coach looked at inside its own:', async () => {
    const clipsAt = require('../src/shared/clips');
    const AT = Date.UTC(2026, 9, 1, 18, 4, 0);
    const READS = ['in spawn during buy phase holding Ghost', 'standing in attacker spawn with combat report open', 'buy menu open'];
    const row = (n, result, side, facts, extra) => ({ n, side, result, died: result === 'lost', facts, reads: READS.slice(), why: null, forensics: null, ...(extra || {}) });
    const base = {
      id: 'valorant-1759341600000-look01', kind: 'valorant', source: 'watched', aiLog: 'kept',
      game: { map: 'Abyss', agent: 'Jett', result: 'Defeat', score: '11-13' },
      summary: 'You lost 11 to 13.', focus: 'Enter second: let a teammate take first contact, then trade.',
      grade: { score: 64, letter: 'C', provisional: false, categories: [], notes: [] },
      insights: { mistakes: [{ key: 'untraded', title: 'Died where nobody could trade', detail: '3 of your 4 deaths went unanswered.',
        fix: 'Check someone can see the same angle.', rounds: [14, 19], weight: 2, count: 3 }], strengths: [], missed: [] },
      rounds: [
        row(1, 'won', 'Defence', ['Survived', '2 kills']),
        // A look from the recording (8.3.1): four frames in time order, their
        // seconds against the death, and the clip. Its why is the look's own
        // cause in a sentence, and the look says it better.
        row(2, 'lost', 'Defence', ['Died at A Site, 15s in, to Viper with a Marshal', 'First death of the round'], {
          why: 'An early dry peek gave them the round.',
          forensics: { cause: 'dry-peek', what: 'You swung wide into mid with nothing thrown.', better: 'Wait for the flash.',
            frames: ['r2-f1.jpg', 'r2-f2.jpg', 'r2-f3.jpg', 'r2-f4.jpg'], frameAt: [-3, -1, 0.5, 2], framesFrom: 'recording',
            source: 'riot', at: AT, clip: 'r2-clip.mkv', clipUrl: 'occlara-clip://review/valorant-1759341600000-look01/r2-clip.mkv' } }),
        row(5, 'won', 'Defence', ['Died at Mid Bend', 'Traded by a teammate'], { why: 'Holding back for the trade won this one.' }),
        // Today's look: the two frames the coach read, before and after, no clip.
        row(9, 'lost', 'Defence', ['Died at B Main, 30s in, to Skye with a Phantom'], {
          forensics: { cause: 'isolated', what: 'You held B Main alone.', better: 'Hold closer to your team.',
            frames: ['r9-before.jpg', 'r9-after.jpg'], source: 'riot', at: AT + 300000 } }),
        row(14, 'lost', 'Attack', ['Died at A Site', 'Spike planted'], {
          forensics: { cause: 'crossfire', what: 'You walked into two angles at once.', better: 'Clear one angle at a time.',
            frames: ['r14-before.jpg'], source: 'screen', at: AT + 600000 } }),
        row(19, 'lost', 'Attack', ['Died at Mid Bottom, early in the round'], {
          why: 'Caught early before any plant, the round went four against five.',
          forensics: { cause: 'unclear', what: null, better: null, frames: ['r19-before.jpg', 'r19-after.jpg'], source: 'riot', at: AT + 900000 } }),
      ],
      frameData: {
        'r2-f1.jpg': 'data:image/jpeg;base64,AAA2f1', 'r2-f2.jpg': 'data:image/jpeg;base64,AAA2f2',
        'r2-f3.jpg': 'data:image/jpeg;base64,AAA2f3', 'r2-f4.jpg': 'data:image/jpeg;base64,AAA2f4',
        'r9-before.jpg': 'data:image/jpeg;base64,AAA9b', 'r9-after.jpg': 'data:image/jpeg;base64,AAA9a',
        'r14-before.jpg': 'data:image/jpeg;base64,AAA14b',
        'r19-before.jpg': 'data:image/jpeg;base64,AAA19b', 'r19-after.jpg': 'data:image/jpeg;base64,AAA19a',
      },
    };
    const open = async (r) => {
      const v = loadSurface('review', { handlers: { [C.LOL_REVIEW_GET]: () => r } });
      await settle();
      return v;
    };
    const v = await open(base);
    const classes = (n) => n.children.map((c) => c.className.split(' ')[0]);
    const vText = v.$('vreview').textContent;
    ok(!v.$('v-looks-wrap') && !v.document.querySelectorAll('.v-moment-link').length
      && !v.document.querySelectorAll('h3').some((h) => h.textContent === 'Where you died, and how'),
    'no section of its own at the bottom for the deaths, and no link down to one');
    ok(v.document.querySelectorAll('#vreview h3').filter((h) => h.textContent === 'Round by round').length === 1
      && v.$('v-rounds-wrap').querySelector('#v-strip') && v.$('v-rounds-wrap').querySelector('#v-rounds'),
    'one "Round by round", the strip on top of the list it leads to');
    const rows = v.document.querySelectorAll('#v-rounds .v-round');
    ok(same(rows.map((r) => r.id), ['round-1', 'round-2', 'round-5', 'round-9', 'round-14', 'round-19']), 'a row for every round, in order',
      rows.map((r) => r.id).join());
    ok(!v.document.querySelectorAll('.v-read').length && !READS.some((t) => vText.includes(t)) && !/What the coach saw at the time/.test(vText),
      'and the coach\'s raw notes are not shown anywhere');
    const rc = (n) => v.$(`round-${n}`);
    ok(rc(1).classList.contains('quiet') && rc(1).children.length === 1 && same(classes(rc(1).children[0]), ['v-rn', 'v-chip', 'v-side', 'v-facts'])
      && rc(1).querySelector('.v-facts').textContent === 'Survived  ·  2 kills',
    'a round with nothing to say is one line: its number, the result, the side and its facts', classes(rc(1).children[0]).join(' | '));
    ok(rows.filter((r) => r !== rc(1)).every((r) => !r.classList.contains('quiet')), 'and only that one');
    // The look from the recording, inside its round.
    ok(same(classes(rc(2)), ['v-round-head', 'v-facts', 'v-moment']) && rc(2).querySelector('.v-facts').textContent === base.rounds[1].facts.join('  ·  '),
      'a death the coach looked at is its round\'s row: the round, its facts once, then the look', classes(rc(2)).join(' | '));
    const m2 = v.$('moment-2');
    ok(m2 && m2.parentNode === rc(2) && same(classes(m2), ['v-media', 'v-advice']) && same(classes(m2.children[0]), ['v-clip', 'v-shots']),
      'the clip and its frames on one side, what the coach made of them on the other', m2 && classes(m2).join(' | '));
    const caps = (m) => m.querySelectorAll('.v-shot figcaption').map((f) => f.textContent);
    const imgs = (m) => m.querySelectorAll('.v-shot img');
    ok(same(caps(m2), ['3 s before', '1 s before', 'Just after', '2 s after'])
      && same(imgs(m2).map((i) => i.src), ['f1', 'f2', 'f3', 'f4'].map((k) => base.frameData[`r2-${k}.jpg`]))
      && same(imgs(m2).map((i) => i.alt), ['3 s before the death', '1 s before the death', 'Just after the death', '2 s after the death']),
    'four frames from the recording, in time order, each named by its seconds against the death', caps(m2).join(' | '));
    ok(m2.querySelector('.v-shots').style['--n'] === '4' && m2.querySelector('video').getAttribute('poster') === base.frameData['r2-f2.jpg'],
      'a filmstrip under the clip, the clip\'s picture the frame nearest the death from before it',
      `${m2.querySelector('.v-shots').style['--n']} ${m2.querySelector('video').getAttribute('poster')}`);
    // The look takes stills at half seconds too (shared/clips.js LOOK_AT), and
    // each is named by the second it was taken at: rounded to whole seconds,
    // the 1.5 s still read "2 s before" and the 4.5 s one "5 s before".
    const halves = await open({ ...base, rounds: [{ ...base.rounds[1], forensics: { ...base.rounds[1].forensics, frameAt: [-4.5, -1.5, -0.3, 0.7] } }] });
    ok(same(caps(halves.$('moment-2')), ['4.5 s before', '1.5 s before', '0.3 s before', 'Just after'])
      && imgs(halves.$('moment-2'))[1].alt === '1.5 s before the death',
    'a still taken at a half second is named by it, never by the second rounded up', caps(halves.$('moment-2')).join(' | '));
    // Riot's look takes five stills (clips.js LOOK_AT), two of them in the
    // last second before the death, and both read "Just before": two frames,
    // one name. Each before the death is named by its own tenth.
    const riotStills = clipsAt.LOOK_AT.riot;
    const five = await open({ ...base, rounds: [{ ...base.rounds[1], forensics: { ...base.rounds[1].forensics,
      frames: riotStills.map((_s, k) => `r2-f${k + 1}.jpg`), frameAt: riotStills } }],
    frameData: { ...base.frameData, 'r2-f5.jpg': 'data:image/jpeg;base64,AAA2f5' } });
    const fiveCaps = caps(five.$('moment-2'));
    ok(same(riotStills, [-3, -1.5, -0.7, -0.3, 0.7]) && same(fiveCaps, ['3 s before', '1.5 s before', '0.7 s before', '0.3 s before', 'Just after'])
      && new Set(fiveCaps).size === 5 && imgs(five.$('moment-2'))[2].alt === '0.7 s before the death',
    'Riot\'s five stills each have a name of their own: every one before the death by its tenth, and Just after the one after it', fiveCaps.join(' | '));
    const advice = (m) => m.querySelector('.v-advice');
    ok(same(classes(advice(m2)), ['v-look-tag', 'v-look-what', 'v-look-better'])
      && advice(m2).querySelector('.v-look-tag').textContent === "Coach's lookDry peek" && advice(m2).querySelector('.v-cause').classList.contains('bad')
      && advice(m2).querySelector('.v-look-what').textContent === 'You swung wide into mid with nothing thrown.'
      && advice(m2).querySelector('.v-look-better').textContent === 'BetterWait for the flash.',
    'the cause, marked as the coach\'s look, what happened and the better play', classes(advice(m2)).join(' | '));
    ok(!rc(2).querySelector('.v-why'), 'and Riot\'s look that speaks takes its round\'s why\'s place, the why being written from that look');
    // THE CHIPS ARE AS THEY WERE (8.5.0): a look asked with variant b carries
    // its fight, change and variant beside its cause, and draws the chip and
    // the words a look of the same cause always drew, none of the three shown.
    const chipOf = async (forensics) => {
      const page = await open({ ...base, rounds: [{ ...base.rounds[1], forensics: { ...base.rounds[1].forensics, ...forensics } }] });
      const a = advice(page.$('moment-2'));
      return { tag: a.querySelector('.v-look-tag').textContent, tone: a.querySelector('.v-cause').className, text: page.$('vreview').textContent };
    };
    const repA = await chipOf({ cause: 'repeek' });
    const repB = await chipOf({ cause: 'repeek', fight: 'wrong-time', change: 'timing', variant: 'b' });
    const duelB = await chipOf({ cause: 'lost-duel', fight: 'right', change: 'aim', variant: 'b' });
    ok(repA.tag === "Coach's lookRepeek" && repB.tag === repA.tag && repB.tone === repA.tone && /\bbad\b/.test(repB.tone)
      && duelB.tag === "Coach's lookLost the duel" && /\bneutral\b/.test(duelB.tone)
      && !/wrong-time|wrong time|timing|variant/i.test(repB.text.replace(repA.text, '')),
    'a look asked with variant b draws the chip its cause always had, Repeek and Lost the duel, and none of its fight, change or variant',
    `${repB.tag} | ${duelB.tag}`);
    // The screen's look lands after the narrative wrote the round's why
    // (screenLook in src/main/index.js), so that why was written without it:
    // both are shown, the look's block first, then the why's, set apart.
    const SCREEN_WHY = 'Two angles at once on the ramp, with the round still yours to take.';
    const screenWhy = await open({ ...base, rounds: [{ ...base.rounds[4], why: SCREEN_WHY }, base.rounds[5]] });
    const a14 = advice(screenWhy.$('moment-14'));
    ok(same(classes(a14), ['v-look-tag', 'v-look-what', 'v-look-better', 'v-moment-src', 'v-why-line'])
      && a14.querySelector('.v-why-line').classList.contains('apart') && a14.querySelector('.v-why-line').textContent === "Coach's read" + SCREEN_WHY
      && a14.querySelector('.v-look-better').textContent === 'BetterClear one angle at a time.',
    'a look from the screen keeps the why written before it: its own lines and its timing first, then the why, a block of its own', classes(a14).join(' | '));
    const a19 = advice(screenWhy.$('moment-19'));
    ok(same(classes(a19), ['v-look-tag', 'v-why-line']) && !a19.querySelector('.v-why-line').classList.contains('apart')
      && /\.v-why-line\.apart \{ padding-top: var\(--space-2\); border-top: 1px solid var\(--glass-border\); \}/.test(fs.readFileSync(path.join(RENDERER, 'review', 'review.css'), 'utf8')),
    'while an unclear look\'s why, the only advice it has, sits under its chip with nothing between', classes(a19).join(' | '));
    // Today's two read frames.
    const m9 = v.$('moment-9');
    ok(same(caps(m9), ['Just before', 'Just after']) && m9.querySelector('.v-shots').style['--n'] === '2' && !m9.querySelector('video')
      && same(classes(m9.children[0]), ['v-shots']), 'the two frames the coach read, just before and just after, two a row with no clip');
    // A look from the screen, and one whose frame was unclear.
    const src = (n) => rc(n).querySelector('.v-moment-src');
    ok(src(14) && src(14).textContent === "Timed from the coach's read of the screen, not Riot's record." && !src(2) && !src(9) && !src(19),
      'a look from the screen says, shorter, that its timing is the coach\'s own read, and one Riot timed says nothing of the kind');
    ok(imgs(v.$('moment-14')).length === 1 && v.$('moment-14').querySelector('.v-shots').style['--n'] === '1', 'a frame on its own takes the whole side');
    // A look from the screen with stills from its clip (8.3.1): their seconds
    // count from the screen's READ of the death, which on the player's Sunset
    // match came 0.7 to 2.7 s after the death itself, so the frame it read the
    // death on is no "At the death", nor the one a second before it "Just
    // before" the death: each is named against the read, as the server is told.
    const recNames = [1, 2, 3, 4, 5].map((k) => `r14-rec${k}-before.jpg`);
    const screenRec = await open({ ...base, rounds: [{ ...base.rounds[4], forensics: { ...base.rounds[4].forensics,
      frames: recNames, frameAt: [-4.5, -3, -2, -1.01, -0.03], framesFrom: 'recording' } }],
    frameData: Object.fromEntries(recNames.map((n, k) => [n, `data:image/jpeg;base64,AAA14r${k}`])) });
    const m14r = screenRec.$('moment-14');
    ok(same(caps(m14r), ['4.5 s before', '3 s before', '2 s before', '1 s before', 'Read as dead'])
      && imgs(m14r).every((i) => /the screen read the death/.test(i.alt) && !/^(At|Just)/.test(i.alt)),
    'a look from the screen names its stills against its read of the death, and none of them the death',
    `${caps(m14r).join(' | ')} / ${imgs(m14r).map((i) => i.alt).join(' | ')}`);
    const m19 = v.$('moment-19');
    ok(m19.querySelector('.v-cause').textContent === 'Frame unclear' && m19.querySelector('.v-cause').classList.contains('neutral')
      && !m19.querySelector('.v-look-what') && !m19.querySelector('.v-look-better') && imgs(m19).length === 2,
    'an unclear frame keeps its pictures and says nothing about them');
    ok(m19.querySelector('.v-why-line') && m19.querySelector('.v-why').textContent === base.rounds[5].why
      && m19.querySelector('.v-why-line').textContent === "Coach's read" + base.rounds[5].why,
    'so its round\'s why is the advice it gives, marked as the coach\'s read');
    ok(same(classes(rc(5)), ['v-round-head', 'v-facts', 'v-why-line']) && rc(5).querySelector('.v-why').textContent === base.rounds[2].why
      && !rc(5).querySelector('.log-eye'), 'a round with no look carries its why, and no eye');
    const fig = imgs(m2)[0].parentNode;
    imgs(m2)[0].click();
    const zoomed = fig.classList.contains('zoom');
    imgs(m2)[0].click();
    ok(zoomed && !fig.classList.contains('zoom'), 'a click zooms a frame, and another puts it back');
    // The eye at the moment, in the round's own line.
    const eyeOf = (n) => rc(n).querySelector('.v-round-head .log-eye');
    ok([2, 9, 14, 19].every((n) => eyeOf(n) && !eyeOf(n).disabled && eyeOf(n).getAttribute('aria-label') === LogEye.MOMENT)
      && !eyeOf(1) && LogEye.MOMENT !== LogEye.NAME, 'each round with a look has the eye at its moment, in its own line');
    eyeOf(14).click();
    const toLog = () => v.bridge.sent.filter((s) => s[0] === C.REVIEW_AILOG);
    ok(same(toLog(), [[C.REVIEW_AILOG, base.id, AT + 600000]]), 'pressed, it sends the review and when the frame it looked at was captured',
      JSON.stringify(toLog()));
    v.$('eye-host').querySelector('.log-eye').click();
    ok(same(toLog()[1], [C.REVIEW_AILOG, base.id]), 'while the header\'s eye still sends the review alone', JSON.stringify(toLog()));
    // The round strip and a mistake's round chip both land on the round's row.
    const id = (n) => (n ? n.id || n.className : 'nothing');
    let asked = null;
    const row14 = rc(14);
    const focusOf = row14.focus;
    row14.focus = function (o) { asked = o || {}; return focusOf.call(this, o); };
    const cell14 = v.document.querySelectorAll('#v-strip .v-cell').find((c) => c.querySelector('.v-cell-n').textContent === '14');
    cell14.focus();
    cell14.click();
    ok(row14.classList.contains('flash') && v.document.activeElement === row14 && row14.tabIndex === -1 && !!asked && asked.preventScroll === true,
      'a round in the strip brings its row into view, flashes it and hands it the focus, out of the tab order',
      `focus on ${id(v.document.activeElement)}, tabindex ${row14.tabIndex}, asked ${JSON.stringify(asked)}`);
    ok(nextTab(v.document) === eyeOf(14), 'so the next Tab is that death\'s own eye', `next Tab: ${id(nextTab(v.document))}`);
    const chip19 = v.document.querySelectorAll('#insights-host .gv-rchip').find((c) => c.textContent === 'R19');
    chip19.click();
    ok(v.document.activeElement === rc(19) && rc(19).classList.contains('flash'), 'and a mistake\'s round chip lands on its round, look and all');
    // SAID ONCE (8.3.1): each death the coach looked at is a miss of its own,
    // "Round 2:" and what the look saw, the better play its fix, as
    // insights.js writes it, and its round's row says both again. On this
    // page that entry is its title and its round chip; every other entry, and
    // the same list drawn anywhere else, is as it was.
    const lookMiss = (n, f, title) => ({ key: `cause:${f.cause}`, title, detail: `Round ${n}: ${f.what || f.better}`, fix: f.better, rounds: [n], judged: true });
    const looksOf = (n) => base.rounds.find((c) => c.n === n).forensics;
    const missed = [
      lookMiss(2, looksOf(2), 'Dry peeks'), lookMiss(9, looksOf(9), 'Caught alone'), lookMiss(14, looksOf(14), 'Walked into crossfires'),
      { key: 'lost-advantage', title: 'An advantage given back', detail: 'Round 2: 4 against 3 when you died, and the round was lost.', rounds: [2] },
      { ...lookMiss(9, looksOf(9), 'Caught alone'), detail: 'Round 9: You were somewhere else entirely.' },
      { key: 'cause:isolated', title: 'Caught alone', detail: 'Round 19: You held mid alone.', fix: 'Stay where a teammate can trade you.', rounds: [19], judged: true },
    ];
    const listed = { ...base.insights, mistakes: [...base.insights.mistakes, { key: 'cause:dry-peek', title: 'Dry peeks', judged: true, rounds: [2, 9],
      detail: 'The coach looked at the moment before 2 deaths and saw the same thing: peeked an angle with no utility or information first, rounds 2 and 9.',
      fix: 'Throw your utility or wait for a teammate\'s before you take the angle.' }], missed };
    const lv = await open({ ...base, insights: listed });
    const block = (title) => lv.$('insights-host').querySelectorAll('.gv-block').find((b) => b.querySelector('h3').textContent === title);
    const items = (title) => block(title).querySelectorAll('.gv-item');
    const shape = (li) => [li.classList.contains('brief') ? 'brief' : 'whole', ...li.children.map((c) => c.className.split(' ')[0]),
      ...li.querySelector('.gv-item-head').children.map((c) => c.className.split(' ')[0])].join(' ');
    const misses = items('What you missed');
    ok(misses.slice(0, 3).every((li) => shape(li) === 'brief gv-item-head gv-dot gv-item-title gv-rounds gv-badge')
      && same(misses.slice(0, 3).map((li) => li.querySelector('.gv-rchip').textContent), ['R2', 'R9', 'R14'])
      && !misses.slice(0, 3).some((li) => li.querySelector('.gv-item-detail') || li.querySelector('.gv-item-fix'))
      && same(misses.slice(0, 3).map((li) => li.textContent), ["Dry peeksR2coach's look", "Caught aloneR9coach's look", "Walked into crossfiresR14coach's look"]),
    'a death the coach looked at, listed under What you missed, is its title and its round chip here, its sentences in its round',
    misses.map(shape).join(' / '));
    misses[1].querySelector('.gv-rchip').click();
    ok(lv.document.activeElement === lv.$('round-9') && lv.$('round-9').classList.contains('flash')
      && lv.$('round-9').querySelector('.v-look-what').textContent === looksOf(9).what && lv.$('round-9').querySelector('.v-look-better').textContent === 'Better' + looksOf(9).better,
    'and its chip lands on the round, where both of them are');
    const WHOLE = 'whole gv-item-head gv-item-detail gv-item-fix gv-rounds gv-dot gv-item-title gv-badge';
    ok(same(misses.slice(3).map(shape), ['whole gv-item-head gv-item-detail gv-rounds gv-dot gv-item-title', WHOLE, WHOLE])
      && misses[4].querySelector('.gv-item-detail').textContent === 'Round 9: You were somewhere else entirely.'
      && misses[5].querySelector('.gv-item-fix').textContent === 'FixStay where a teammate can trade you.',
    'any other entry is whole: a miss that is no look\'s, one whose sentences its round does not say, and one for a round whose frame was unclear',
    misses.slice(3).map(shape).join(' / '));
    const repeated = items('Your repeated mistakes').find((li) => li.querySelector('.gv-item-title').textContent === 'Dry peeks');
    ok(repeated && shape(repeated) === WHOLE,
      'and so is a cause the coach saw twice, which is a count of looks, said nowhere else', repeated && shape(repeated));
    const elsewhere = lv.window.GradeView.insightLists(listed, { onRound: false, saidInRound: () => true });
    const elsewhereBrief = lv.window.GradeView.insightLists(listed, { onRound: () => {} });
    ok(!elsewhere.querySelectorAll('.gv-item.brief').length && elsewhere.querySelectorAll('.gv-item-detail').length === 8
      && !elsewhereBrief.querySelectorAll('.gv-item.brief').length && elsewhereBrief.querySelectorAll('.gv-item-detail').length === 8,
    'the lists drawn with no round to jump to, or without the review\'s rule, keep every sentence: the library\'s and Home\'s are as they were');
    // The order of the page: the score, the grade and the read, then the mistakes, then the rounds.
    const order = v.$('vreview').children.filter((c) => !c.hidden).map((c) => c.id || c.className);
    ok(same(order, ['v-hero', 'grade-host', 'v-summary-wrap', 'insights-host', 'v-rounds-wrap', 'v-foot']),
      'the result, the grade and the coach\'s read first, then the repeated mistakes, then the rounds', order.join(' | '));
    ok(!DASHES.test(vText), 'with no dash anywhere on the page');
    const gone = await open({ ...base, aiLog: 'gone' });
    ok(!gone.document.querySelectorAll('#v-rounds .log-eye').length && gone.document.querySelectorAll('#v-rounds .v-shot img').length === 9,
      'with the AI log gone, the rounds keep their frames and lose their eyes');
    const older = await open({ ...base, rounds: base.rounds.map((c) => (c.forensics ? { ...c, forensics: { ...c.forensics, source: undefined, at: undefined } } : c)) });
    ok(older.document.querySelectorAll('#v-rounds .v-moment').length === 4 && !older.document.querySelectorAll('#v-rounds .log-eye').length
      && !older.document.querySelectorAll('.v-moment-src').length, 'a review saved before 8.2 paints its looks as Riot\'s, with no eye at a moment it never kept');
    // A clip the cap took from a look whose frames were not kept either: said
    // with the coach's words, where there is nothing to watch beside them.
    const bare = await open({ ...base, rounds: [{ ...base.rounds[4], forensics: { ...base.rounds[4].forensics, frames: [], clip: 'r14-clip.mkv', clipGone: 'space' } }] });
    const mb = bare.$('moment-14');
    ok(mb.classList.contains('no-media') && same(classes(mb), ['v-advice']) && mb.querySelector('.v-advice .v-clip-gone')
      && mb.querySelector('.v-clip-gone').textContent === 'Its clip was cleared to keep your clips under the space set in Settings. The frames and facts stay.',
    'a look with neither its clip nor a frame left says where its clip went, beside nothing', classes(mb).join(' | '));
    // Five stills from the recording, and the clip they came from gone (the
    // cap, Clear clips): two a row, as the two read frames are, stacked them
    // three frames tall beside four lines of words. Three a row at the most.
    const stillNames = [1, 2, 3, 4].map((k) => `r2-rec${k}-before.jpg`).concat(['r2-rec5-after.jpg']);
    const noClip = await open({ ...base, rounds: [{ ...base.rounds[1], forensics: { ...base.rounds[1].forensics, clip: 'r2-clip.mkv', clipUrl: null,
      clipGone: 'cleared', frames: stillNames, frameAt: [-3, -1.5, -0.7, -0.3, 0.7] } }],
    frameData: Object.fromEntries(stillNames.map((n, k) => [n, `data:image/jpeg;base64,AAA2s${k}`])) });
    const mn = noClip.$('moment-2');
    ok(mn.querySelector('.v-shots').style['--n'] === '3' && imgs(mn).length === 5 && !mn.querySelector('video') && mn.querySelector('.v-clip-gone')
      && v.$('moment-9').querySelector('.v-shots').style['--n'] === '2' && v.$('moment-14').querySelector('.v-shots').style['--n'] === '1',
    'five stills whose clip is gone are three a row, and the read frames two and one as before', mn.querySelector('.v-shots').style['--n']);
    // Asked for reduced motion, a jump to a round is a jump, not a smooth scroll.
    const jumps = [];
    for (const reduce of [false, true]) {
      const j = loadSurface('review', { handlers: { [C.LOL_REVIEW_GET]: () => base },
        window: { matchMedia: (q) => ({ matches: reduce && /prefers-reduced-motion: reduce/.test(q) }) } });
      await settle();
      j.$('round-14').scrollIntoView = (o) => jumps.push(o && o.behavior);
      j.document.querySelectorAll('#v-strip .v-cell').find((c) => c.querySelector('.v-cell-n').textContent === '14').click();
    }
    const rcss = fs.readFileSync(path.join(RENDERER, 'review', 'review.css'), 'utf8');
    ok(same(jumps, ['smooth', 'auto']) && /@media \(prefers-reduced-motion: reduce\) \{\s*\.v-cell, \.v-round\.flash, \.v-shot img \{ transition: none; animation: none; \}/.test(rcss),
      'asked for reduced motion, a jump to a round does not scroll smoothly, and the flash and the zoom do not move', JSON.stringify(jumps));
    v.bridge.emit(C.PUSH_VALORANT_REVIEW, { ...base, rounds: [] });
    await settle();
    ok(v.$('v-rounds-wrap').hidden && !v.document.querySelectorAll('.v-round').length && !v.document.querySelectorAll('#v-rounds video').length,
      'and a version with no rounds painted over one clears the list, strip and all');
  });

  // THE RESULT CARRIES RIOT'S SCOREBOARD (8.3.1), and under each number how it
  // compares with the player's own average, which was a section of its own
  // repeating the same four numbers. Before the match links there is no
  // scoreboard at all, and no note saying why: the grade's note and the
  // refusals both say it.
  await section('the result carries Riot\'s scoreboard, each number against the player\'s own average:', async () => {
    const valorantReview = require('../src/shared/valorant-review');
    const tracker = { result: 'Victory', score: '13-11', kills: 31, deaths: 21, assists: 4, acs: 382, adr: 243, headshotPct: 25, kd: 1.48, agent: 'Jett', map: 'Abyss' };
    const history = [300, 310, 320, 330, 340].map((acs, i) => ({ at: i, agent: 'Jett', role: 'Duelist', map: 'Abyss', result: 'Victory', acs, adr: 190, kd: 1.2, headshotPct: 28 }));
    const against = valorantReview.against(tracker, 'Duelist', history);
    ok(same(against.map((a) => a.label), ['ACS', 'Damage per round', 'K/D', 'Headshot %']), 'the rows against() gives, by the labels the page matches them on',
      against.map((a) => a.label).join());
    const open = async (r) => {
      const v = loadSurface('review', { handlers: { [C.LOL_REVIEW_GET]: () => r } });
      await settle();
      return v;
    };
    const base = { id: 'valorant-1759341600000-hero01', kind: 'valorant', source: 'watched', aiLog: null, rounds: [],
      game: { map: 'Abyss', agent: 'Jett', mode: 'Competitive', result: 'Victory', score: '13-11' },
      scoreline: { kills: 31, deaths: 21, assists: 4, acs: 382, adr: 243, headshotPct: 25, kd: 1.48 }, against };
    const v = await open(base);
    const stats = v.document.querySelectorAll('#v-hero #v-stats .v-stat');
    const part = (s, cls) => (s.querySelector(cls) || { textContent: null }).textContent;
    ok(same(stats.map((s) => part(s, '.v-stat-label')), ['K / D / A', 'ACS', 'ADR', 'Headshot'])
      && same(stats.map((s) => part(s, '.v-stat-value')), ['31/21/4', '382', '243', '25%']), 'Riot\'s four numbers, inside the result\'s card');
    ok(same(stats.map((s) => part(s, '.v-stat-vs')), ['K/D +0.28', '+62', '+53', '-3'])
      && same(stats.map((s) => toneOf(s.querySelector('.v-stat-vs')) || ['good', 'bad', 'even'].find((k) => s.querySelector('.v-stat-vs').classList.contains(k))),
        ['good', 'good', 'good', 'bad'])
      && stats[1].querySelector('.v-stat-vs').title === 'Your average: 320' && stats[0].querySelector('.v-stat-vs').title === 'Your average K/D: 1.2',
    'under each, how it compares with the player\'s own average, the sign saying it as well as the colour',
    stats.map((s) => part(s, '.v-stat-vs')).join(' | '));
    ok(!v.$('v-against-note').hidden && v.$('v-against-note').textContent === 'Against your average over your last 5 verified matches in the same role.',
      'and once, what the comparison is over', v.$('v-against-note').textContent);
    ok(!v.$('v-against-wrap') && !v.$('v-against') && !v.document.querySelectorAll('#vreview .skill-row').length,
      'with no section of its own saying the same four numbers again');
    const level = await open({ ...base, against: [{ ...against[0], value: 320, delta: 0, better: null }] });
    ok(same(level.document.querySelectorAll('#v-stats .v-stat-vs').map((x) => `${x.textContent}:${x.className}`), ['average:v-stat-vs even']),
      'a number at the average says so, in no colour');
    const first = await open({ ...base, against: [] });
    ok(!first.document.querySelectorAll('#v-stats .v-stat-vs').length && first.$('v-against-note').hidden && first.document.querySelectorAll('#v-stats .v-stat').length === 4,
      'with too few matches to compare, the four numbers alone');
    // Before the match links: the review as the screen alone built it, with
    // the refusal and the grade's note build() gives it.
    const screenOnly = valorantReview.build({ rounds: [], context: { agent: 'Jett', map: 'Abyss' },
      endedBy: 'score', ai: {}, role: 'Duelist', history: [], riotIdSet: true });
    const s = await open({ ...screenOnly, id: 'valorant-1759341600000-hero02' });
    const sText = s.$('vreview').textContent;
    ok(s.$('v-stats-wrap').hidden && !s.document.querySelectorAll('.v-stat').length && !s.$('v-stats-note')
      && !/Kills, ACS and damage come from Riot/.test(sText),
    'before the match links there is no scoreboard, and no note under it saying why');
    ok(/comes from Riot once the match is published/.test(sText), 'the refusal still says where the scoreboard comes from', sText.slice(0, 200));
  });

  // WHAT THE LISTS SAID IS NOT SAID AGAIN (8.3.1): a pattern under the strip
  // that counts what an entry of the lists already counts, and a study note
  // the focus already says.
  await section('the review says what the lists and the focus said once:', async () => {
    const open = async (r) => {
      const v = loadSurface('review', { handlers: { [C.LOL_REVIEW_GET]: () => r } });
      await settle();
      return v;
    };
    const base = { id: 'valorant-1759341600000-once01', kind: 'valorant', source: 'watched', aiLog: null,
      game: { map: 'Sunset', agent: 'Jett', result: 'Defeat', score: '2-5' },
      rounds: [{ n: 1, side: 'Attack', result: 'lost', died: true, facts: ['Died at Mid'], reads: [], why: null, forensics: null }],
      patterns: [
        { key: 'postplant', text: 'On attack, won 1 of 3 rounds once the spike was down.' },
        { key: 'streak', text: 'You lost 3 rounds in a row, rounds 1 to 3.' },
        { key: 'early', text: '4 of your 5 deaths came in the first 30 seconds of the round, before any plant, in rounds 1, 3, 6 and 7.' },
      ],
      insights: { mistakes: [{ key: 'early', title: 'Dying in the first 30 seconds', detail: '4 of your 5 deaths came in the first 30 seconds, before any plant.', rounds: [1] }],
        strengths: [], missed: [{ key: 'postplant-lost', title: 'Post plants that slipped', detail: 'Won only 1 of 3 attack rounds with the spike down.', rounds: [1] }] },
      focus: 'Enter second for a match: let a teammate or your utility take first contact, then trade.',
      study: [
        { text: 'Enter second: let a teammate or your utility take first contact, then trade the fight.' },
        { text: 'Entry in checkpoints, take one piece of space, survive behind cover, then wait for the team to reach you before you take the next.' },
      ],
    };
    const v = await open(base);
    const pats = v.document.querySelectorAll('#v-patterns .v-pattern-text').map((p) => p.textContent);
    ok(same(pats, ['You lost 3 rounds in a row, rounds 1 to 3.']) && v.$('v-patterns').parentNode === v.$('v-rounds-wrap'),
      'under the strip, only what the lists do not count: not the post plants a miss already counts, nor the early deaths', pats.join(' | '));
    const notes = v.document.querySelectorAll('#v-study .v-study-note').map((n) => n.textContent);
    ok(same(notes, [base.study[1].text]), 'a study note the focus already says is not said again under it', notes.join(' | '));
    const noFocus = await open({ ...base, focus: null });
    ok(noFocus.document.querySelectorAll('#v-study .v-study-note').length === 2, 'and with no focus, every note');
    const allSaid = await open({ ...base, study: [base.study[0]] });
    ok(allSaid.$('v-study-wrap').hidden, 'a list with nothing left in it is not shown');
    const none = await open({ ...base, patterns: [base.patterns[0], base.patterns[2]] });
    ok(none.$('v-patterns').hidden && !none.document.querySelectorAll('#v-patterns li').length, 'and no pattern left is no lines at all');
    // A focus with no read written above it: no empty line under the heading.
    const read = await open({ ...base, summary: 'You lost 2 to 5.' });
    ok(v.$('v-summary').hidden && !v.$('v-summary-wrap').hidden && !v.$('v-focus-wrap').hidden
      && !read.$('v-summary').hidden && read.$('v-summary').textContent === 'You lost 2 to 5.',
    'the coach\'s read with only a focus shows the focus under its heading, and no empty line for the read');
  });

  // BOTH TEAM COMPS, ONE LINE UNDER THE STRIP (8.5.0, the player's choice),
  // as main presents the review (valorant-review.js served, compsLine):
  // agents the game data knows and nothing else, the player's own marked, set
  // by textContent, and no line at all for a review that kept no comps.
  await section('the review names both team comps in one line under the strip:', async () => {
    const vr = require('../src/shared/valorant-review');
    const open = async (r) => {
      const v = loadSurface('review', { handlers: { [C.LOL_REVIEW_GET]: () => vr.served(r) } });
      await settle();
      return v;
    };
    const base = { id: 'valorant-1759341600000-comps1', kind: 'valorant', source: 'watched', aiLog: null,
      game: { map: 'Fracture', agent: 'Jett', result: 'Victory', score: '5-1' },
      rounds: [{ n: 1, side: 'Attack', result: 'won', died: false, facts: ['Survived'], reads: [], why: null, forensics: null }],
      patterns: [], insights: { mistakes: [], strengths: [], missed: [] },
      comps: { us: [{ agent: 'Breach', role: 'Initiator' }, { agent: 'Jett', role: 'Duelist' }, { agent: 'Killjoy', role: 'Sentinel' },
        { agent: 'Omen', role: 'Controller' }, { agent: 'Sova', role: 'Initiator' }],
      them: [{ agent: 'Cypher' }, { agent: 'Fade' }, { agent: 'Reyna' }, { agent: 'Sage' }, { agent: 'Morvane#EUW' }] } };
    const v = await open(base);
    const line = v.$('v-comps');
    ok(!line.hidden && line.textContent === 'Your team: Breach, Jett (you), Killjoy, Omen, Sova. Theirs: Cypher, Fade, Reyna, Sage.'
      && line.parentNode === v.$('v-rounds-wrap') && !/Morvane/.test(v.$('vreview').textContent),
    'one line of agents under the strip, the player\'s own marked, and nothing that is no agent', line.textContent);
    const none = await open({ ...base, comps: undefined });
    ok(none.$('v-comps').hidden && none.$('v-comps').textContent === '', 'and a review that kept no comps has no line at all');
    const oneSide = await open({ ...base, comps: { us: base.comps.us, them: [] } });
    ok(oneSide.$('v-comps').hidden, 'nor one with only its own team known');
  });

  await section('Stats, graded matches:', async () => {
    const at = Date.UTC(2026, 9, 1, 20);
    const s = (id, score, i) => ({ id, at: at - i * 3600000, map: 'Abyss', title: 'Jett', grade: { score, letter: grade.letter(score) } });
    let sessions = [s('a', 82, 0), s('b', 58, 1), s('c', 69, 2)];
    let dashCalls = 0;
    const dash = () => {
      dashCalls++;
      return { game: 'valorant', statsSupported: true, categories: {}, rank: { value: null, direction: 'flat' },
        winRate: { value: null, direction: 'flat' }, topAgents: [], sessions: sessions.slice(), sessionCount: sessions.length,
        matches: { matches: [], fetchedAt: 0, mode: 'competitive' }, grading: null, riotId: '' };
    };
    const st = loadSurface('stats', {
      handlers: { [C.STATS_DASHBOARD]: dash, [C.STATS_MATCHES]: () => ({ matches: [] }), [C.STATS_RANK_HISTORY]: () => ({ points: [] }) },
    });
    await settle();
    st.clock.flushFrames();
    // The number in each graded row, whatever class the chip carries.
    const chips = () => st.document.querySelectorAll('#session-list .row.session .top')
      .map((top) => top.children.find((c) => /^\d+$/.test(c.textContent) && !c.classList.contains('kda')))
      .filter(Boolean);
    const shown = () => chips().map((c) => `${c.textContent}:${toneOf(c)}`);
    ok(same(shown(), [`82:${toneFor(82)}`, `58:${toneFor(58)}`, `69:${toneFor(69)}`]),
      'each grade is its letter\'s colour: an 82 A green, a 58 D red, a 69 C a warning', shown().join(' '));
    const letters = st.document.querySelectorAll('#session-list .grade-letter');
    ok(letters.length === 3 && letters.every((l) => toneOf(l) === TONE[l.textContent]), 'and the letter beside it agrees');
    ok(st.scripts.some((x) => /grade-view\.js$/.test(x)), 'Stats loads the shared rule rather than keeping its own');

    // A review saved while the window is open, then improved, in a burst.
    ok(st.bridge.listening(C.PUSH_REVIEWS) === 1, 'Stats listens for saved reviews through its preload');
    st.document.querySelector('#session-list .row.session').click();   // someone is reading the 82
    sessions = [s('d', 91, 0), ...sessions.map((x, i) => ({ ...x, at: x.at - (i + 1) }))];
    st.bridge.emit(C.PUSH_REVIEWS, { id: 'd', game: 'valorant' });
    st.bridge.emit(C.PUSH_REVIEWS, { id: 'd', game: 'valorant' });
    st.clock.advance(500);
    await settle();
    st.clock.flushFrames();
    const rows = st.document.querySelectorAll('#session-list .row.session');
    ok(rows.length === 4 && shown()[0] === `91:${toneFor(91)}`,
      'the new match appears without reopening the window', `rows ${rows.length}, first ${shown()[0]}`);
    ok(dashCalls === 2, 'two pushes in a burst cost one fetch', `fetched ${dashCalls} times`);
    ok(!rows[0].classList.contains('settled') && rows.slice(1).every((r) => r.classList.contains('settled')),
      'only the new row counts up and slides in');
    ok(rows[1] && rows[1].dataset.id === 'a' && rows[1].classList.contains('open'), 'the row being read stays open');
  });

  // The rank tile's arrow was a trend between two tracker snapshots, a flat
  // dash beside every rank with no older snapshot, which read as "no change".
  await section('Stats, the rank tile says what the last rated game did:', async () => {
    const open = async (history) => {
      const st = loadSurface('stats', {
        handlers: {
          [C.STATS_DASHBOARD]: () => ({ game: 'valorant', statsSupported: true, categories: {},
            rank: { value: 'Gold 2', direction: 'flat' }, winRate: { value: 52, direction: 'up' }, topAgents: [],
            sessions: [], sessionCount: 0, matches: { matches: [], fetchedAt: 0, mode: 'competitive' }, grading: null, riotId: 'Me#EUW' }),
          [C.STATS_MATCHES]: () => ({ matches: [] }),
          [C.STATS_RANK_HISTORY]: () => history,
        },
      });
      await settle();
      st.clock.flushFrames();
      const tile = st.document.querySelectorAll('#cards .card').find((c) => /^Rank/.test(c.querySelector('.label').textContent));
      const rr = tile && tile.querySelector('.arrow');
      return { st, rr, tone: rr ? ['gain', 'loss', 'even'].filter((t) => rr.classList.contains(t)).join('') : null };
    };
    // Oldest first, as the rank history route returns them.
    const pt = (elo, change, tier) => ({ date: Date.UTC(2026, 9, 1), elo, change, tier: tier || 'Gold 2' });
    const gain = await open({ points: [pt(1180, -21), pt(1218, 18)] });
    ok(gain.rr && gain.rr.textContent === '+18 RR' && gain.tone === 'gain',
      'a gain reads +18 RR, in the good colour', gain.rr && `read "${gain.rr.textContent}" ${gain.rr.className}`);
    const loss = await open({ points: [pt(1218, 18), pt(1203, -15)] });
    ok(loss.rr && loss.rr.textContent === '-15 RR' && loss.tone === 'loss',
      'a loss reads -15 RR, in red', loss.rr && `read "${loss.rr.textContent}" ${loss.rr.className}`);
    const placed = await open({ points: [pt(1203, -15), pt(1500, 297, 'Gold 3'), pt(0, 0, 'Unrated')] });
    ok(placed.rr && placed.rr.textContent === '-15 RR',
      'a placement jump and an unrated point are passed over for the newest rated game', placed.rr && `read "${placed.rr.textContent}"`);
    const even = await open({ points: [pt(1203, 0)] });
    ok(even.rr && even.rr.textContent === '0 RR' && even.tone === 'even', 'no change reads 0 RR, dim');
    for (const [what, history] of [['no history', { points: [] }], ['no Riot ID', { error: 'no-riot-id' }]]) {
      const none = await open(history);
      ok(none.rr && none.rr.textContent === '' && !none.tone, `${what}: the tile shows nothing, not a flat dash`,
        none.rr && `read "${none.rr.textContent}"`);
    }
    // The colours are the tokens, read off the stylesheet the tile is drawn with.
    const css = fs.readFileSync(path.join(RENDERER, 'stats', 'stats.css'), 'utf8');
    const colour = (sel) => {
      const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return ((css.match(new RegExp(`(?:^|\\n)${esc}\\s*\\{([^}]*)\\}`)) || [])[1] || '').trim();
    };
    ok(colour('.arrow.flat') === 'color: var(--text-mute);', 'the rule reader finds a known rule');
    ok(colour('.arrow.rr.gain') === 'color: var(--good);' && colour('.arrow.rr.loss') === 'color: var(--bad);'
      && colour('.arrow.rr.even') === 'color: var(--text-mute);', 'a gain is --good, a loss --bad, no change dim');
    // Ask Coach is a page in the sidebar; "Ask Coach about this" on a graded match stays.
    ok(!gain.st.$('askcoach') && typeof gain.st.bridge.api.openChat === 'undefined'
      && typeof gain.st.bridge.api.askAboutSession === 'function',
      'the Stats header has no chat button, and its bridge no openChat, while a match can still be asked about');
  });

  // The Stats page with a rank, its tile found by its label (a skeleton card
  // has none), and main stood in for by `rankHistory(force)`.
  const statsWithRank = (rankHistory) => loadSurface('stats', {
    handlers: {
      [C.STATS_DASHBOARD]: (mode) => ({ game: 'valorant', statsSupported: true, categories: {},
        rank: { value: 'Gold 2', direction: 'flat' }, winRate: { value: 52, direction: 'up' }, topAgents: [],
        sessions: [], sessionCount: 0, matches: { matches: [], fetchedAt: 0, mode: mode || 'competitive' }, grading: null, riotId: 'Me#EUW' }),
      [C.STATS_REFRESH]: (mode) => ({ matches: [], fetchedAt: 0, mode: mode || 'competitive' }),
      [C.STATS_MATCHES]: () => ({ matches: [] }),
      [C.STATS_RANK_HISTORY]: rankHistory,
    },
  });
  const rankTileOf = (st) => st.document.querySelectorAll('#cards .card')
    .find((c) => c.querySelector('.label') && /^Rank/.test(c.querySelector('.label').textContent)) || null;
  const repainted = async (st) => { await settle(); st.clock.flushFrames(); };

  // REFRESH READS THE RR AGAIN, PAST MAIN'S CACHE. Main keeps the rank history
  // five minutes (getRankHistory), and a Refresh just after Riot published a
  // game put the game before it on the tile, as "RR from your last rated game",
  // beside a match list that already had the new one. The stand in answers as
  // main does: what it cached, unless the read is forced.
  await section('Stats, Refresh reads the rank tile\'s RR past main\'s cache:', async () => {
    const pt = (elo, change) => ({ date: Date.UTC(2026, 9, 1), elo, change, tier: 'Gold 2' });
    const cached = { points: [pt(1180, -21), pt(1218, 18)] };
    const published = { points: [pt(1180, -21), pt(1218, 18), pt(1203, -15)] };
    const reads = [];
    // The forced read answers AFTER the forced dashboard, as it can in the app,
    // so a tile that read whatever points were held when it repainted, rather
    // than waiting on the forced read, shows the game before.
    const later = (v) => new Promise((r) => { let n = 3; const spin = () => (--n ? setImmediate(spin) : r(v)); setImmediate(spin); });
    const st = statsWithRank((force) => { reads.push(force === true); return force === true ? later(published) : cached; });
    await repainted(st);
    const rr = () => rankTileOf(st).querySelector('.arrow');
    ok(rr().textContent === '+18 RR' && same(reads, [false]), 'opened, the tile reads the history main holds',
      `read "${rr().textContent}", forced ${JSON.stringify(reads)}`);
    st.$('refresh').click();
    await repainted(st);
    await repainted(st);
    ok(rr().textContent === '-15 RR' && rr().classList.contains('loss'), 'after Refresh it shows the game Riot has just published',
      `read "${rr().textContent}"`);
    ok(same(reads, [false, true]), 'from one more read, a forced one', `forced ${JSON.stringify(reads)}`);
  });

  // A READ IS SHARED FOR A MOMENT, NOT FOR THE PAGE'S LIFE. The page is kept
  // between visits, and main drops its cache when a recording stops so the
  // match just played shows at once; held here for good, the rank graph left
  // it out until a Refresh.
  await section('Stats, the rank graph asks main again once the shared read is old:', async () => {
    const pt = (elo, change) => ({ date: Date.UTC(2026, 9, 1), elo, change, tier: 'Gold 2' });
    const reads = [];
    const st = statsWithRank((force) => { reads.push(force === true); return { points: [pt(1180, -21), pt(1218, 18)] }; });
    await repainted(st);
    rankTileOf(st).click();   // the notes open, and the graph reads the history
    await repainted(st);
    ok(same(reads, [false]), 'opened at once, the graph shares the tile\'s read', `reads ${JSON.stringify(reads)}`);
    rankTileOf(st).click();   // closed
    await repainted(st);
    st.clock.advance(31 * 1000);
    rankTileOf(st).click();   // opened again, half a minute on
    await repainted(st);
    ok(same(reads, [false, false]), 'opened half a minute later, it asks main again', `reads ${JSON.stringify(reads)}`);
  });

  // THE CHEVRON FOLLOWS THE NOTES THROUGH A REPAINT. The mode toggle, Refresh
  // and a Riot ID switch all build the tile again while its notes stay open
  // under it, and it came back with its chevron closed over open notes.
  await section('Stats, the rank tile\'s chevron stays turned over while its notes are open:', async () => {
    const st = statsWithRank(() => ({ points: [] }));
    await repainted(st);
    const open = () => st.$('rank-reveal').classList.contains('open') && !st.$('rank-reveal').hidden;
    const turned = () => rankTileOf(st).classList.contains('notes-open');
    rankTileOf(st).click();
    await settle();
    ok(open() && turned(), 'the notes open and the chevron turns over');
    const first = rankTileOf(st);
    st.$('modeseg').querySelector('button[data-mode="unrated"]').click();
    await repainted(st);
    ok(rankTileOf(st) !== first && open() && turned(), 'the mode toggle builds the tile again, and it stays turned over');
    const second = rankTileOf(st);
    st.$('refresh').click();
    await repainted(st);
    ok(rankTileOf(st) !== second && open() && turned(), 'so does Refresh');
    const third = rankTileOf(st);
    st.bridge.emit(C.PUSH_STATE, { riotId: 'Me#EUW' });
    st.bridge.emit(C.PUSH_STATE, { riotId: 'Other#EUW' });
    await repainted(st);
    ok(rankTileOf(st) !== third && open() && turned(), 'and a Riot ID switch, which keeps the notes open');
    rankTileOf(st).click();
    ok(!st.$('rank-reveal').classList.contains('open') && !turned(), 'closed, the chevron turns back');
    st.$('modeseg').querySelector('button[data-mode="competitive"]').click();
    await repainted(st);
    ok(!turned(), 'and a repaint while they are closed leaves it closed');
  });

  // HOME'S RANK JOURNEY OPENS THE JOURNEY (8.4.1). It opened Stats with the
  // journey folded in the Rank tile. Main keeps what the page was opened for
  // until the page asks (STATS_OPENED_FOR, taken once, stood in for here as
  // main answers it), as it loads and each time it is about to show.
  await section('Stats, opened from Home\'s Rank journey, opens with the journey open:', async () => {
    const pt = (elo, change) => ({ date: Date.UTC(2026, 9, 1), elo, change, tier: 'Gold 2' });
    const history = { points: [pt(1180, -21), pt(1218, 18), pt(1203, -15)] };
    let pending = null;   // what main was last asked to open Stats for
    const asked = [];
    const statsOpened = () => loadSurface('stats', {
      handlers: {
        [C.STATS_DASHBOARD]: (mode) => ({ game: 'valorant', statsSupported: true, categories: {},
          rank: { value: 'Gold 2', direction: 'flat' }, winRate: { value: 52, direction: 'up' }, topAgents: [],
          sessions: [], sessionCount: 0, matches: { matches: [], fetchedAt: 0, mode: mode || 'competitive' }, grading: null, riotId: 'Me#EUW' }),
        [C.STATS_MATCHES]: () => ({ matches: [] }),
        [C.STATS_RANK_HISTORY]: () => history,
        [C.STATS_OPENED_FOR]: () => { const w = pending; asked.push(w); pending = null; return w; },
      },
    });
    const isOpen = (st) => !st.$('rank-reveal').hidden && st.$('rank-reveal').classList.contains('open')
      && !!rankTileOf(st) && rankTileOf(st).classList.contains('notes-open');
    pending = 'journey';
    const st = statsOpened();
    await repainted(st);
    await repainted(st);
    ok(isOpen(st) && !!st.document.querySelector('#rank-notes .rank-graph path.rg-line') && /About Gold/.test(st.$('rank-notes').textContent),
      'opened for the journey, the page loads with it open under the Rank tile, the journey drawn',
      `open ${isOpen(st)}, notes "${st.$('rank-notes').textContent.slice(0, 60)}"`);
    ok(same(asked, ['journey']), 'asked once as the page loads, which takes it', JSON.stringify(asked));
    // Kept between visits: shown again from the sidebar, it asks and nothing opens.
    rankTileOf(st).click();
    st.clock.advance(220);
    st.bridge.emit(C.PUSH_PAGE, { phase: 'arm', dir: 'forward' });
    await repainted(st);
    ok(!isOpen(st) && same(asked, ['journey', null]), 'closed by the player and shown again from the sidebar, it asks as it arms, and stays closed');
    // From Home again: open, the overview scrolled to, and never toggled shut.
    let scrolled = 0;
    st.$('sec-overview').scrollIntoView = () => { scrolled++; };
    pending = 'journey';
    st.bridge.emit(C.PUSH_PAGE, { phase: 'arm', dir: 'forward' });
    await repainted(st);
    ok(isOpen(st) && scrolled === 1, 'from Home again, the arm asks and the journey opens, the overview scrolled to');
    pending = 'journey';
    st.bridge.emit(C.PUSH_PAGE, { phase: 'arm', dir: 'forward' });
    await repainted(st);
    ok(isOpen(st), 'asked for again while it is open, it stays open, never toggled shut');
    // Called back mid switch (Home asked for, then Stats again before Home came
    // in), the page on screen is told to enter with no arm: that asks too.
    rankTileOf(st).click();
    st.clock.advance(220);
    pending = 'journey';
    st.bridge.emit(C.PUSH_PAGE, { phase: 'enter', dir: 'none' });
    await repainted(st);
    ok(isOpen(st) && asked[asked.length - 1] === 'journey', 'and called back mid switch, an enter with no arm before it asks as well, and it opens');
    // Opened plainly, it loads closed.
    pending = null;
    const plain = statsOpened();
    await repainted(plain);
    await repainted(plain);
    ok(!isOpen(plain) && plain.$('rank-reveal').hidden, 'opened any other way, it loads with the journey closed, as before');
  });

  // And main's half: its own two lines in a sandbox (index.js openStats and
  // takeStatsOpen), and the wiring to them (register-ipc.js, electron stood in for).
  await section('Main keeps what Stats was opened for until the page asks, once:', async () => {
    const vm = require('vm');
    const idxSrc = fs.readFileSync(path.join(ROOT, 'src', 'main', 'index.js'), 'utf8');
    const at = idxSrc.indexOf('  openStats(what) {');
    const end = at < 0 ? -1 : idxSrc.indexOf('\n', idxSrc.indexOf('takeStatsOpen() {', at));
    const CTL = end < 0 ? '' : idxSrc.slice(at, end);
    const opened = [];
    const box = { state: {}, openPage: (id) => opened.push(id) };
    vm.createContext(box);
    const ctl = CTL ? vm.runInContext(`({\n${CTL}\n})`, box) : null;
    ok(!!ctl && typeof ctl.openStats === 'function' && typeof ctl.takeStatsOpen === 'function',
      'main\'s two lines are found and run in the sandbox', CTL.slice(0, 120));
    if (ctl) {
      ctl.openStats('journey');
      ok(same(opened, ['stats']) && ctl.takeStatsOpen() === 'journey' && ctl.takeStatsOpen() === null,
        'Home\'s Rank journey opens Stats, and the page that asks is told the journey, once');
      ctl.openStats('journey');
      ctl.openStats(null);
      ok(ctl.takeStatsOpen() === null && same(opened, ['stats', 'stats', 'stats']), 'opened plainly after it, Stats is told nothing');
    }
    const Module = require('module');
    const file = require.resolve('../src/main/ipc/register-ipc');
    const on = {};
    const handled = {};
    const electron = {
      ipcMain: { handle: (ch, fn) => { handled[ch] = fn; }, on: (ch, fn) => { on[ch] = fn; } },
      shell: { openExternal: () => Promise.resolve() },
    };
    const stubs = { '../services/store': { get: () => undefined, set() {} }, '../updater': {}, '../services/pc-check': {} };
    const calls = [];
    const controller = { openStats: (w) => { calls.push(['open', w]); }, takeStatsOpen: () => { calls.push(['take']); return 'journey'; } };
    const realLoad = Module._load;
    Module._load = function stand(request, parent, ...rest) {
      if (request === 'electron') return electron;
      if (parent && parent.filename === file && Object.prototype.hasOwnProperty.call(stubs, request)) return stubs[request];
      return realLoad.call(this, request, parent, ...rest);
    };
    try {
      delete require.cache[file];
      require(file)({ controller, license: {} });
    } finally {
      Module._load = realLoad;
      delete require.cache[file];
    }
    if (on[C.OPEN_STATS]) { on[C.OPEN_STATS]({}, 'journey'); on[C.OPEN_STATS]({}); on[C.OPEN_STATS]({}, 'https://evil.example'); }
    const told = handled[C.STATS_OPENED_FOR] ? await handled[C.STATS_OPENED_FOR]({}) : undefined;
    ok(same(calls, [['open', 'journey'], ['open', null], ['open', null], ['take']]) && told === 'journey',
      'OPEN_STATS hands main the journey and nothing else a page sends, and STATS_OPENED_FOR is main\'s take', JSON.stringify(calls));
  });

  // NEVER ANOTHER PLAYER'S NAME OR TAG (8.4.1). "Your team" showed every
  // teammate's full Riot ID; Valorant lets a player hide theirs, and Riot's
  // policy is that no product shows a player's identity to others without
  // their opt in. The server sends none since, and a name an older server
  // still sends is never painted.
  await section('Stats, a match\'s team: agents and numbers, never another player\'s name or tag:', async () => {
    const team = [
      { name: 'Fade#EUW', agent: 'Sova', kills: 20, deaths: 12, assists: 6, acs: 260, me: false },   // as an 8.4.0 server sends it
      { agent: 'Jett', kills: 18, deaths: 10, assists: 3, acs: 240, me: true },
      { agent: null, kills: 5, deaths: 14, assists: 9, acs: 110, me: false },
    ];
    const match = { id: 'tm1', map: 'Fracture', agent: 'Jett', queue: 'Swiftplay', result: 'Victory', score: '5-1',
      kills: 18, deaths: 10, assists: 3, kd: 1.8, acs: 240, adr: 150, headshotPct: 25, kpr: 1, dpr: 0.5, apr: 0.2,
      dmgDelta: 30, rating: 86, startedAt: Date.UTC(2026, 9, 14), mvp: null, team };
    const st = loadSurface('stats', {
      handlers: {
        [C.STATS_DASHBOARD]: () => ({ game: 'valorant', statsSupported: true, categories: {},
          rank: { value: null, direction: 'flat' }, winRate: { value: null, direction: 'flat' }, topAgents: [],
          sessions: [], sessionCount: 0, matches: { matches: [match], fetchedAt: 1, mode: 'competitive' }, grading: null, riotId: 'Me#EUW' }),
        [C.STATS_MATCHES]: () => ({ matches: [match] }),
        [C.STATS_RANK_HISTORY]: () => ({ points: [] }),
      },
    });
    await repainted(st);
    const rows = st.document.querySelectorAll('#match-list .team-row');
    const read = rows.map((r) => r.children.map((c) => c.textContent));
    ok(same(read, [['Sova', '', '20/12/6  ACS 260'], ['Jett', 'You', '18/10/3  ACS 240'], ['Unknown agent', '', '5/14/9  ACS 110']]),
      'each teammate is their agent and their numbers, the player\'s own row "You"', JSON.stringify(read));
    ok(rows.length === 3 && rows[1].classList.contains('me') && !rows[0].classList.contains('me'), 'the player\'s own row is the one marked');
    ok(/Your team/.test(st.$('match-list').textContent) && !/Fade|#EUW/.test(st.$('match-list').textContent),
      'and no name or tag is painted, not even one an older server still sends');
  });

  // THE RANK JOURNEY IN THE TOKENS (8.4.1): it was the retired cyan over a
  // gradient fill, written into stats.js's markup, which check:palette never
  // read. Now its colours are stats.css's, as Home draws the same journey.
  await section('Stats\' rank journey is drawn in the tokens over one solid fill:', async () => {
    const pt = (elo, change) => ({ date: Date.UTC(2026, 9, 1), elo, change, tier: 'Gold 2' });
    const st = statsWithRank(() => ({ points: [pt(1180, -21), pt(1218, 18), pt(1203, -15)] }));
    await repainted(st);
    rankTileOf(st).click();
    await repainted(st);
    const graph = st.document.querySelector('#rank-notes .rank-graph');
    const svg = graph ? graph.innerHTML : '';
    ok(!!graph && !!graph.querySelector('svg path.rg-area') && !!graph.querySelector('svg path.rg-line') && !!graph.querySelector('.rg-plot > span.rg-dot')
      && !graph.querySelector('circle'), 'the journey is drawn: the area under it, its line and the newest game\'s dot, a span over the line as Home\'s is');
    ok(/stroke="#00F0FF"/.test('<path stroke="#00F0FF"/>') && /gradient/i.test('<linearGradient id="rgFill">'),
      'the markup check finds the cyan and the gradient it replaced');
    ok(svg.length > 200 && !/gradient/i.test(svg) && !/#[0-9a-f]{3,8}\b/i.test(svg) && !/\b(?:fill|stroke|stop-color)="/.test(svg),
      'with no gradient and no colour of its own in the markup', svg.slice(0, 160));
    const css = fs.readFileSync(path.join(RENDERER, 'stats', 'stats.css'), 'utf8');
    const rule = (sel) => {
      const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return (css.match(new RegExp(`(?:^|\\n)${esc}\\s*\\{([^}]*)\\}`)) || [])[1] || '';
    };
    const prop = (body, name) => ((body.match(new RegExp(`(?:^|[;\\s])${name}\\s*:\\s*([^;]+);`)) || [])[1] || '').trim();
    ok(prop(rule('.rank-graph svg'), 'height') === '96px', 'the rule reader finds a known rule');
    ok(prop(rule('.rank-graph .rg-line'), 'stroke') === 'var(--text-dim)' && prop(rule('.rank-graph .rg-dot'), 'background') === 'var(--text)'
      && prop(rule('.rank-graph .rg-area'), 'fill') === 'rgba(var(--cyan-rgb),0.06)',
    'its line is --text-dim, its dot --text, over one solid tint of the accent');
    const home = fs.readFileSync(path.join(RENDERER, 'home', 'home.css'), 'utf8');
    ok(/\.rank-line path \{[^}]*stroke: var\(--text-dim\)/.test(home) && /\.rank-dot \{[^}]*background: var\(--text\)/.test(home),
      'the line and the dot Home draws the same journey with');
  });

  // ── Home (8.2.1) ─────────────────────────────────────────────────────────
  // A library of five Valorant matches, newest first as main lists them,
  // three of them Competitive, the newest with its AI log still kept; and a
  // rank history whose three newest games are those three, each dated when
  // its match started, as the rank history dates a game.
  const HOME_AT = Date.UTC(2026, 9, 1, 20);
  const MIN = 60000;
  const homeRow = (id, minsAgo, map, mode, score, gr, extra) => ({ id, game: 'valorant', at: HOME_AT - minsAgo * MIN, title: 'Jett',
    map, mode, result: 'Victory', score, verified: true, source: 'watched', aiLog: null, grade: { score: gr, letter: grade.letter(gr) },
    ...(extra || {}) });
  const HOME_ROWS = [
    homeRow('valorant-1759348800000-homea', 0, 'Ascent', 'Competitive', '13-9', 83, { aiLog: 'kept' }),
    homeRow('valorant-1759344300000-homeb', 75, 'Bind', 'Competitive', '10-13', 64, { result: 'Defeat', aiLog: 'gone' }),
    homeRow('valorant-1759338000000-homec', 180, 'Haven', 'Unrated', '13-7', 74),
    homeRow('valorant-1759330800000-homed', 300, 'Lotus', 'Competitive', '13-11', 97, { source: 'riot' }),
    homeRow('valorant-1759320000000-homee', 480, 'Split', 'Swiftplay', '3-5', 58, { result: 'Defeat' }),
  ];
  const homeStart = (r) => r.at - r.score.split('-').map(Number).reduce((x, y) => x + y) * 100000;
  const ELOS = [1712, 1735, 1719, 1748, 1771, 1755, 1782, 1798, 1815, 1836, 1820, 1844];
  const HOME_HISTORY = { points: ELOS.map((elo, i) => ({
    date: i < 9 ? HOME_AT - (11 - i) * 24 * 60 * MIN : homeStart(HOME_ROWS[[3, 1, 0][i - 9]]) + 2 * MIN,
    elo, change: i ? elo - ELOS[i - 1] : 18, tier: elo >= 1800 ? 'Diamond 1' : 'Platinum 3' })) };
  const MISTAKE = { key: 'untraded', title: 'Died where nobody could trade', matches: 4, fix: 'Check someone can see the same angle.', trend: 'steady' };
  /**
   * Home on that library, main stood in for; `h.cfg` is the config main would
   * read back. `opts.list(game)` answers the library in place of `rows`.
   */
  async function openHome(o) {
    const opts = o || {};
    const rows = opts.rows || HOME_ROWS;
    const cfg = { language: 'en', riotId: opts.riotId === undefined ? 'Me#EUW' : opts.riotId };
    const h = loadSurface('home', {
      handlers: {
        [C.STATE_GET]: () => ({ ...BASE, gameId: opts.game || 'valorant', riotId: cfg.riotId }),
        [C.CONFIG_GET]: () => ({ ...cfg }),
        [C.REVIEWS_LIST]: opts.list || (() => rows),
        [C.PATTERNS_GET]: () => ({ matches: rows.length, recorded: rows.length, enough: true, mistakes: opts.mistakes || [],
          strengths: [], missed: [], grades: rows.map((r) => ({ id: r.id, at: r.at, score: r.grade.score, letter: r.grade.letter })),
          average: 75, categories: [] }),
        [C.REVIEW_GET]: (id) => ({ id, kind: 'valorant', focus: opts.focus === undefined ? 'Enter second, and trade.' : opts.focus,
          grade: { score: rows[0].grade.score, letter: rows[0].grade.letter, categories: [] } }),
        [C.STATS_RANK_HISTORY]: opts.history || (() => HOME_HISTORY),
      },
    });
    h.cfg = cfg;
    await settle();
    return h;
  }
  const homeCss = fs.readFileSync(path.join(RENDERER, 'home', 'home.css'), 'utf8');
  const homeRule = (sel) => {
    const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return (homeCss.match(new RegExp(`(?:^|\\n)${esc}\\s*\\{([^}]*)\\}`)) || [])[1] || '';
  };
  const cssProp = (body, name) => ((body.match(new RegExp(`(?:^|[;\\s])${name}\\s*:\\s*([^;]+);`)) || [])[1] || '').trim();

  // "There's no point of it saying 'from what the screen read'": the foot of
  // the last match is the eye, View match, and Open review, and nothing else.
  await section('Home\'s last match ends on two buttons, the eye\'s View match and Open review, and nothing else:', async () => {
    const h = await openHome();
    const foot = h.document.querySelector('#last .last-foot');
    const btns = foot ? foot.children : [];
    const eye = btns[0];
    ok(btns.length === 2 && btns.every((b) => b.tagName === 'BUTTON') && foot.textContent === 'View matchOpen review',
      'the foot holds View match and Open review, and no other word', foot && foot.textContent);
    ok(!/screen read|Riot's record|Graded from/i.test(h.$('last').textContent) && !h.document.querySelector('#last .checked'),
      'the line saying where the grade came from is gone', h.$('last').textContent);
    ok(eye && eye.classList.contains('log-eye') && !eye.disabled && eye.getAttribute('aria-label') === null && eye.title === LogEye.NAME
      && eyeShape(eye.querySelector('svg')) === eyeShape(statsEye) && eye.querySelector('svg').getAttribute('aria-hidden') === 'true',
    'View match is the eye the Matches rows draw, named by its word, its tooltip what it opens');
    if (eye) eye.click();
    ok(same(h.bridge.sent.filter((s) => s[0] === C.REVIEW_AILOG), [[C.REVIEW_AILOG, HOME_ROWS[0].id]]),
      'pressed, it sends the match\'s review id alone over REVIEW_AILOG, as its row in Matches does', JSON.stringify(h.bridge.sent));
    if (btns[1]) btns[1].click();
    ok(same(h.bridge.sent.filter((s) => s[0] === C.REVIEW_OPEN), [[C.REVIEW_OPEN, HOME_ROWS[0].id]]), 'and Open review opens its review');
    // The rule every eye keeps: disabled, with its reason, once the log no
    // longer holds the match, and none where nothing was recorded.
    const gone = await openHome({ rows: HOME_ROWS.slice(1) });
    const gEye = gone.document.querySelector('#last .log-eye');
    ok(gEye && gEye.disabled && gEye.title === LogEye.GONE && gEye.textContent === 'View match',
      'the log no longer holding the match, the eye stays, disabled, its tooltip saying why');
    if (gEye) gEye.click();
    ok(!gone.bridge.sent.some((s) => s[0] === C.REVIEW_AILOG), 'and pressed, it sends nothing');
    const riot = await openHome({ rows: HOME_ROWS.slice(3) });
    const rFoot = riot.document.querySelector('#last .last-foot');
    ok(!riot.document.querySelector('#last .log-eye') && rFoot && rFoot.children.length === 1 && rFoot.textContent === 'Open review',
      'a match graded from Riot\'s record alone has no eye, only Open review');
    ok(h.scripts.some((x) => /log-eye\.js$/.test(x)) && typeof h.bridge.api.openAiLog === 'function',
      'the eye is shared/log-eye.js\'s, over a bridge that opens the AI log');
    const pageEye = h.window.LogEye;
    ok(pageEye.labelled(null, () => {}, 'View match') === null && pageEye.labelled('kept', null, 'View match').classList.contains('labelled'),
      'labelled() follows button(): no word from main, no eye');
  });

  // A REVIEW STILL BEING BUILT (8.4.1), where its grade would show half done:
  // Home's last match and its recent row, and its row in Matches, say it is
  // being checked, until main says its work is done.
  await section('Home and Matches say a review still being built is being checked, where its grade would be:', async () => {
    const WORK = { path: 'riot', steps: ['saved', 'riot', 'deaths', 'look', 'writing'], step: 'riot', endedAt: HOME_AT, until: HOME_AT + 360000, scoreboard: false };
    let building = true;
    const rowsNow = () => [{ ...HOME_ROWS[0], work: building ? WORK : null }, ...HOME_ROWS.slice(1)];
    const h = await openHome({ list: () => rowsNow() });
    const last = h.$('last');
    const card = last.querySelector('.gv-checking-card');
    ok(card && !last.querySelector('.gv-grade') && !last.querySelector('.result') && !last.querySelector('.score'),
      'Home\'s last match: the checking card in place of its grade, and the screen\'s result and score unsaid', last.textContent);
    ok(card && card.getAttribute('role') === 'status' && /Being checked against Riot's record/.test(card.textContent)
      && /Riot publishes a match 1 to 4 minutes after it ends\. Its grade shows here once the review is complete\./.test(card.textContent)
      && card.querySelector('.gv-checking').textContent === 'Checking',
    'saying what it waits for and how long that usually takes', card && card.textContent);
    ok(last.querySelector('.last-foot') && last.querySelector('.last-foot').textContent === 'View matchOpen review',
      'its foot is as it was: the review opens on its loading screen');
    const first = h.$('recent-list').querySelector('.r-row');
    const second = h.$('recent-list').querySelectorAll('.r-row')[1];
    ok(first.querySelector('.gv-checking') && !first.querySelector('.r-score') && !first.querySelector('.gv-letter') && !first.querySelector('.r-res'),
      'its recent row: the pill where the grade and the result were');
    ok(second.querySelector('.r-score') && second.querySelector('.gv-letter') && !second.querySelector('.gv-checking'), 'and every other row its grade');
    const asks = () => h.bridge.invoked.filter((x) => x[0] === C.REVIEWS_LIST).length;
    const before = asks();
    building = false;
    h.bridge.emit(C.PUSH_REVIEW_WORK, { id: HOME_ROWS[0].id, work: null });
    await settle();
    ok(asks() > before && h.$('last').querySelector('.gv-grade') && !h.$('last').querySelector('.gv-checking-card')
      && h.$('last').querySelector('.score').textContent === '13 : 9' && h.$('recent-list').querySelector('.r-row .r-score'),
    'its work done, Home reads the library again and shows the grade, the result and the score');
    ok(h.bridge.listening(C.PUSH_REVIEW_WORK) === 1, 'Home listens on PUSH_REVIEW_WORK');

    // From the screen alone, the words are its own.
    const s = await openHome({ rows: [{ ...HOME_ROWS[0], work: { path: 'screen', step: 'writing' } }, ...HOME_ROWS.slice(1)] });
    const sCard = s.$('last').querySelector('.gv-checking-card');
    ok(sCard && /The review is being written/.test(sCard.textContent) && sCard.querySelector('.gv-checking').textContent === 'Writing'
      && !/Riot/.test(sCard.textContent), 'from the screen alone it says it is being written, and nothing of Riot', sCard && sCard.textContent);

    // Matches.
    let mBuilding = true;
    const mRows = () => [{ id: 'valorant-1759348800000-homea', at: HOME_AT, title: 'Jett', map: 'Ascent', mode: 'Competitive',
      result: 'Victory', score: '13-9', topMistake: 'Died where nobody could trade', grade: { score: 83, letter: 'A' }, aiLog: 'kept',
      work: mBuilding ? WORK : null },
    { id: 'valorant-1759344300000-homeb', at: HOME_AT - 75 * MIN, title: 'Jett', map: 'Bind', mode: 'Competitive',
      result: 'Defeat', score: '10-13', grade: { score: 64, letter: 'C' }, aiLog: 'gone', work: null }];
    const m = loadSurface('matches', {
      handlers: {
        [C.STATE_GET]: () => ({ gameId: 'valorant' }),
        [C.REVIEWS_LIST]: () => mRows(),
        [C.PATTERNS_GET]: () => ({ matches: 2, enough: false, grades: [], categories: [], average: null, mistakes: [], strengths: [], missed: [] }),
      },
    });
    await settle();
    const mFirst = m.document.querySelector('#list .m-row');
    ok(mFirst && mFirst.querySelector('.m-grade .gv-checking') && !mFirst.querySelector('.m-score') && !mFirst.querySelector('.m-letter')
      && !mFirst.querySelector('.m-res') && !mFirst.querySelector('.m-top-mistake'),
    'its row in Matches: the pill where its grade was, and neither the screen\'s result nor its top mistake');
    const mSecond = m.document.querySelectorAll('#list .m-row')[1];
    ok(mSecond && mSecond.querySelector('.m-score').textContent === '64' && !mSecond.querySelector('.gv-checking'), 'every other row as it was');
    mBuilding = false;
    m.bridge.emit(C.PUSH_REVIEW_WORK, { id: 'valorant-1759348800000-homea', work: null });
    await settle();
    const mAfter = m.document.querySelector('#list .m-row');
    ok(mAfter && mAfter.querySelector('.m-score') && mAfter.querySelector('.m-score').textContent === '83' && !mAfter.querySelector('.gv-checking')
      && mAfter.querySelector('.m-top-mistake'), 'its work done, the row shows its grade, its result and its top mistake');
    ok(m.bridge.listening(C.PUSH_REVIEW_WORK) === 1, 'Matches listens on PUSH_REVIEW_WORK');

    // One drawing of it, shared/grade-view.js's, as every grade is.
    const GV = h.window.GradeView;
    ok(GV.checking(null) === null && GV.checking({ path: 'other' }) === null && GV.checking({ path: 'riot' }).className === 'gv-checking'
      && GV.checking({ path: 'riot' }, { full: true }).className === 'gv-checking-card',
    'GradeView.checking draws the pill and the card, and nothing for no work');
    const gvCss = fs.readFileSync(path.join(RENDERER, 'shared', 'grade-view.css'), 'utf8');
    const gvPart = gvCss.slice(gvCss.indexOf('A review still being checked'), gvCss.indexOf('@media (max-width: 520px)'));
    ok(gvPart.length > 200 && /\.gv-checking-dot \{/.test(gvPart) && !/animation|infinite|gradient/.test(gvPart),
      'its dot is still, as the loading screen is, and nothing of it is a gradient');
  });

  // "Bring the bars lower so it's balanced and there's no dead space."
  await section('Home\'s grade trend fills its card, each bar its grade of the whole height:', async () => {
    const h = await openHome();
    const tracks = h.document.querySelectorAll('#trend-bars .bar-track');
    const read = tracks.map((t) => ({ h: t.style.getPropertyValue('--h'), num: (t.querySelector('.bar-num') || {}).textContent, bar: t.querySelector('.bar') }));
    ok(tracks.length === 5 && same(read.map((r) => r.num), ['58', '97', '74', '64', '83']) && read.every((r) => r.bar && r.h === `${r.num}%`),
      'a track per match, oldest first, its --h the grade as a share of the whole', JSON.stringify(read.map((r) => r.h)));
    ok(read.every((r) => toneOf(r.bar) === toneFor(Number(r.num))), 'each bar its letter\'s colour, the number beside it');
    ok(cssProp(homeRule('.hint'), 'font-size') === '13px', 'the rule reader finds a known rule');
    ok(cssProp(homeRule('.bars'), 'flex') === '1 1 auto' && !cssProp(homeRule('.bars'), 'height') && cssProp(homeRule('#trend'), 'flex') === '1 1 auto'
      && cssProp(homeRule('.bar-track'), 'flex') === '1 1 auto', 'the bars\' area grows to the card\'s foot, with no fixed height to stop short of it');
    ok(cssProp(homeRule('.bar'), 'position') === 'absolute' && cssProp(homeRule('.bar'), 'height') === 'var(--h, 0%)'
      && cssProp(homeRule('.bar-num'), 'position') === 'absolute' && /^calc\(var\(--h, 0%\)/.test(cssProp(homeRule('.bar-num'), 'bottom')),
    'the bar and its number both read --h, the number off the bar\'s top rather than stacked in its column');
  });

  // "Show the player's rank journey and their most recent RR loss and gain."
  await section('Home\'s rank: the rank, the last game\'s RR and the journey, and each rated match\'s RR:', async () => {
    const h = await openHome();
    ok(!h.$('rank').hidden && h.$('rank-tier').textContent === 'Diamond 1', 'the rank the newest rated game left', h.$('rank-tier').textContent);
    const rrEl = h.$('rank-rr');
    ok(!rrEl.hidden && rrEl.textContent === '+24 RR' && rrEl.classList.contains('gain'), 'the last game\'s RR, a gain in its colour', rrEl.textContent);
    const line = h.$('rank-line');
    const d = (line.querySelector('path') || { getAttribute: () => '' }).getAttribute('d') || '';
    ok(!line.hidden && (d.match(/[ML]/g) || []).length === 12 && line.querySelector('.rank-dot')
      && line.getAttribute('aria-label') === 'Rank journey over your last 12 rated games, from Platinum 3 to Diamond 1',
    'the journey as a line through its twelve games, the newest a dot, and said in words', line.getAttribute('aria-label'));
    const rowRR = (x) => x.document.querySelectorAll('#recent-list .r-row').map((b) => {
      const s = b.querySelector('.r-rr');
      return !s || s.hidden ? '' : `${s.textContent}:${['gain', 'loss', 'even'].find((t) => s.classList.contains(t)) || ''}`;
    });
    ok(same(rowRR(h), ['+24 RR:gain', '-16 RR:loss', '', '+21 RR:gain', '']),
      'each Competitive match shows the RR its own game moved; Unrated and Swiftplay none', JSON.stringify(rowRR(h)));
    h.$('rank-more').click();
    // With the journey open (8.4.1): it opened Stats with the journey folded
    // in the Rank tile. Stats' half is 'Stats, opened from Home's Rank journey'.
    ok(same(h.bridge.sent.filter((s) => s[0] === C.SHELL_NAV || s[0] === C.OPEN_STATS), [[C.OPEN_STATS, 'journey']]),
      'Rank journey asks main for Stats with the journey open (OPEN_STATS, \'journey\')', JSON.stringify(h.bridge.sent));
    ok(h.bridge.invoked.filter((x) => x[0] === C.STATS_RANK_HISTORY).every((x) => x[1] === false),
      'read from the history main keeps, never forced past its cache');
    // Where it sits: under the focus, in the room the last match leaves; with
    // the most repeated mistake there too, above the grade trend.
    const side = h.$('side');
    ok(h.$('rank').parentNode === side && side.children.indexOf(h.$('rank')) === side.children.indexOf(h.$('focus')) + 1,
      'it sits under the next match\'s focus');
    const full = await openHome({ mistakes: [MISTAKE] });
    ok(!full.$('top').hidden && full.$('rank').parentNode === full.$('lower') && full.$('lower').children[0] === full.$('rank')
      && !full.$('rank').hidden, 'with the focus and the most repeated mistake beside the last match, it stands above the grade trend');
    const noFocus = await openHome({ mistakes: [MISTAKE], focus: null });
    ok(noFocus.$('focus').hidden && !noFocus.$('top').hidden && noFocus.$('rank').parentNode === noFocus.$('side')
      && !noFocus.$('rank').hidden, 'with the mistake but no focus (a match graded from Riot\'s record alone), the column has the room, and it stays there');
    ok(cssProp(homeRule('#side .rank'), 'flex') === '1 1 auto' && cssProp(homeRule('.rank-line'), 'min-height') === '40px'
      && cssProp(homeRule('.rank-line svg'), 'position') === 'absolute',
    'beside the last match it fills what is left of the column, its line growing with it');

    // Painted first, filled in after: a slow rank history never holds Home back.
    let answer = null;
    const slow = await openHome({ history: () => new Promise((r) => { answer = r; }) });
    ok(!slow.$('content').hidden && slow.document.querySelector('#last .score') && slow.document.querySelectorAll('#recent-list .r-row').length === 5
      && slow.$('rank').hidden && rowRR(slow).every((x) => x === ''), 'with the rank history not answering yet, Home is painted all the same');
    answer(HOME_HISTORY);
    await settle();
    ok(!slow.$('rank').hidden && same(rowRR(slow), rowRR(h)), 'and the rank and the RR are filled in when it answers');
    ok(slow.$('rank').classList.contains('card-in') && slow.$('rank').style.getPropertyValue('--i') === '0',
      'the rank card, shown after the others arrived, rises in by itself');
    // A review saved meanwhile repaints Home, and the RR does not blink out
    // while the rank is asked again.
    let calls = 0;
    let release = null;
    const re = await openHome({ history: () => (++calls === 1 ? HOME_HISTORY : new Promise((r) => { release = r; })) });
    re.bridge.emit(C.PUSH_REVIEWS, { id: HOME_ROWS[0].id, game: 'valorant' });
    await settle();
    ok(calls === 2 && same(rowRR(re), rowRR(h)) && !re.$('rank').hidden,
      'a repaint keeps the rank and each match\'s RR while the rank is asked again', `asked ${calls} times, ${JSON.stringify(rowRR(re))}`);
    if (release) release(HOME_HISTORY);
    await settle();
  });

  await section('Home has a rank only for Valorant, with a Riot ID and a rated game, and the column closes up:', async () => {
    const asked = (x) => x.bridge.invoked.some((c) => c[0] === C.STATS_RANK_HISTORY);
    const noId = await openHome({ riotId: '' });
    ok(noId.$('rank').hidden && !asked(noId) && !noId.$('side').hidden, 'no Riot ID: no rank card, nothing asked, and the focus keeps its column');
    const none = await openHome({ history: () => ({ points: [] }), focus: null });
    ok(none.$('rank').hidden && none.$('side').hidden && !none.$('last').hidden,
      'no rated game: no rank card, and with no focus either the column goes and the last match takes the row');
    const error = await openHome({ history: () => ({ error: 'no-riot-id' }) });
    ok(error.$('rank').hidden && error.document.querySelectorAll('#recent-list .r-rr').every((s) => s.hidden), 'a history that did not answer: none');
    const league = await openHome({ game: 'lol' });
    ok(league.$('rank').hidden && !asked(league), 'League of Legends: no rank card, and nothing asked');
    const emptyLib = await openHome({ rows: [] });
    ok(emptyLib.$('content').hidden && !emptyLib.$('empty').hidden && !asked(emptyLib),
      'no match in the library yet: Home asks for no rank it would not show');
    // A change of game takes the rank away before the cards arrive again: it
    // keeps the place it rose in by itself with (--i 0), and takes none in
    // the new arrival, which a card still shown as it began would.
    const h = await openHome();
    ok(!h.$('rank').hidden && h.$('rank').style.getPropertyValue('--i') === '0', 'the setup: the rank rose in by itself, after the others');
    h.bridge.emit(C.PUSH_GAME, { id: 'lol', label: 'League of Legends' });
    await settle();
    ok(h.$('rank').hidden && h.document.querySelectorAll('#recent-list .r-rr').every((s) => s.hidden) && h.$('rank').style.getPropertyValue('--i') === '0',
      'switched to League of Legends, the rank and the RR are gone before the cards arrive, and the rank takes no place among them',
      `--i ${h.$('rank').style.getPropertyValue('--i')}`);
    // A Riot ID taken out in Settings takes its rank with it; a state push
    // that does not change the Riot ID repaints nothing.
    const s = await openHome();
    const lists = () => s.bridge.invoked.filter((c) => c[0] === C.REVIEWS_LIST).length;
    const before = lists();
    s.bridge.emit(C.PUSH_STATE, { ...BASE, riotId: 'Me#EUW' });
    await settle();
    ok(lists() === before, 'a state push with the same Riot ID repaints nothing');
    s.cfg.riotId = '';
    s.bridge.emit(C.PUSH_STATE, { ...BASE, riotId: '' });
    await settle();
    ok(s.$('rank').hidden && s.document.querySelectorAll('#recent-list .r-rr').every((x) => x.hidden) && lists() > before,
      'the Riot ID taken out in Settings, Home paints again, with no rank');
  });

  // LISTENING FROM THE START (8.2.1). The first load waits for the rank, a
  // network read, and Home set up its listeners only after it: a game picked
  // in the sidebar meanwhile was never heard (PUSH_GAME comes once, on the
  // change), and Home stayed on Valorant for the session. And an answer that
  // lands after a change of game, a rank or a library read, paints nothing.
  await section('Home follows a change of game made while it is still reading:', async () => {
    const named = (x) => x.$('h-game').textContent;
    const listed = (x, g) => x.bridge.invoked.filter((c) => c[0] === C.REVIEWS_LIST && c[1] === g).length;
    const noRank = (x) => x.$('rank').hidden && x.document.querySelectorAll('#recent-list .r-rr').every((r) => r.hidden);
    // The first rank answer held, as a slow history holds it.
    let first = null;
    const h = await openHome({ history: () => new Promise((r) => { if (!first) first = r; }) });
    ok(first && !h.$('content').hidden && named(h) === 'Valorant', 'the setup: Valorant painted, its first rank answer still out');
    ok(h.bridge.listening(C.PUSH_GAME) === 1 && h.bridge.listening(C.PUSH_REVIEWS) === 1 && h.bridge.listening(C.PUSH_STATE) === 1,
      'and Home already listening for a change of game, a review saved and the Riot ID',
      `game ${h.bridge.listening(C.PUSH_GAME)}, reviews ${h.bridge.listening(C.PUSH_REVIEWS)}, state ${h.bridge.listening(C.PUSH_STATE)}`);
    h.bridge.emit(C.PUSH_GAME, { id: 'lol', label: 'League of Legends' });
    await settle();
    ok(named(h) === 'League of Legends' && listed(h, 'lol') === 1 && noRank(h),
      'League of Legends picked meanwhile: Home follows, its name, its library, and no rank', `named "${named(h)}", asked for League ${listed(h, 'lol')} times`);
    const valorantReads = listed(h, 'valorant');
    first(HOME_HISTORY);
    await settle();
    ok(noRank(h) && named(h) === 'League of Legends', 'and the Valorant rank answer landing after it paints nothing there');
    h.bridge.emit(C.PUSH_REVIEWS, { id: 'lol-1759348800000-abcd', game: 'lol' });
    await settle();
    ok(listed(h, 'lol') === 2 && listed(h, 'valorant') === valorantReads && named(h) === 'League of Legends',
      'a review saved after it paints League of Legends again, never Valorant', `League ${listed(h, 'lol')}, valorant ${listed(h, 'valorant') - valorantReads} more`);

    // A rank answer held across the change, asked for by a repaint (a review
    // saved) rather than the first paint, paints nothing on the other game.
    let calls = 0;
    let late = null;
    const s = await openHome({ history: () => (++calls === 1 ? HOME_HISTORY : new Promise((r) => { late = r; })) });
    ok(!s.$('rank').hidden, 'the setup: Valorant\'s rank is shown');
    s.bridge.emit(C.PUSH_REVIEWS, { id: HOME_ROWS[0].id, game: 'valorant' });
    await settle();
    ok(calls === 2 && typeof late === 'function', 'a review saved asks for the rank again, and that answer is held');
    s.bridge.emit(C.PUSH_GAME, { id: 'lol', label: 'League of Legends' });
    await settle();
    ok(noRank(s) && named(s) === 'League of Legends', 'switched to League of Legends: no rank');
    if (late) late(HOME_HISTORY);
    await settle();
    ok(noRank(s) && named(s) === 'League of Legends', 'and the Valorant answer released after it stays off League of Legends\' Home: no rank card, no RR');

    // The library read for Valorant held until League of Legends' is painted:
    // landing after it, it paints nothing, or Valorant's matches would stand
    // under League of Legends' name.
    let release = null;
    const p = await openHome({ list: (g) => (g === 'lol' ? []
      : release ? HOME_ROWS : new Promise((r) => { release = () => r(HOME_ROWS); })) });
    ok(typeof release === 'function' && p.$('content').hidden, 'the setup: Valorant\'s library read is still out');
    p.bridge.emit(C.PUSH_GAME, { id: 'lol', label: 'League of Legends' });
    await settle();
    ok(named(p) === 'League of Legends' && !p.$('empty').hidden && p.$('content').hidden, 'League of Legends, with nothing in its library, is painted meanwhile');
    if (release) release();
    await settle();
    ok(named(p) === 'League of Legends' && !p.$('empty').hidden && p.$('content').hidden && !p.document.querySelector('#recent-list .r-row'),
      'and the Valorant read landing after it paints nothing: no Valorant match under League of Legends\' name');
    // The first paint overtaken by a review saved meanwhile: the cards it was
    // to bring in arrive with the paint that lands instead.
    let hold = null;
    const q = await openHome({ list: () => (hold ? HOME_ROWS : new Promise((r) => { hold = () => r(HOME_ROWS); })) });
    q.bridge.emit(C.PUSH_REVIEWS, { id: HOME_ROWS[0].id, game: 'valorant' });
    await settle();
    if (hold) hold();
    await settle();
    const came = ['last', 'focus', 'trend', 'recent'].filter((id) => q.$(id).classList.contains('card-in'));
    ok(!q.$('content').hidden && came.length === 4,
      'the first paint overtaken by a review saved meanwhile, its cards arrive with the paint that lands', `arrived: ${came.join(', ')}`);
  });

  // ASKED AGAIN FOR A GAME RIOT HAD NOT PUBLISHED (8.2.1). Riot puts a game in
  // the rank history minutes after the match, and main and the server each
  // keep the history five minutes, so the reads a review's saves make as the
  // match ends come back without it, and Home showed the newest match with no
  // RR until the next one. It asks again six minutes on, twice at most after
  // a paint, and only for a match that ended within the hour.
  await section('Home asks again for the RR of a match Riot had not put in the rank history yet:', async () => {
    const AGAIN = 6 * 60 * 1000;
    const now = Date.now();
    const rowRR = (x) => x.document.querySelectorAll('#recent-list .r-row').map((b) => {
      const sp = b.querySelector('.r-rr');
      return !sp || sp.hidden ? '' : sp.textContent;
    });
    const ROWS = [
      { ...homeRow('valorant-1760000000000-newa', 0, 'Ascent', 'Competitive', '13-9', 83), at: now - 3 * MIN },
      { ...homeRow('valorant-1759990000000-oldb', 0, 'Bind', 'Competitive', '10-13', 64, { result: 'Defeat' }), at: now - 75 * MIN },
    ];
    const B_GAME = { date: homeStart(ROWS[1]) + 2 * MIN, elo: 1800, change: -16, tier: 'Diamond 1' };
    const A_GAME = { date: homeStart(ROWS[0]) + 2 * MIN, elo: 1824, change: 24, tier: 'Diamond 1' };
    let reads = 0;
    let out = false;
    const h = await openHome({ rows: ROWS, history: () => { reads++; return { points: out ? [B_GAME, A_GAME] : [B_GAME] }; } });
    ok(reads === 1 && same(rowRR(h), ['', '-16 RR']) && h.$('rank-rr').textContent === '-16 RR',
      'the setup: the newest Competitive match has no RR, its game not in the history yet, and the rank card says the game before\'s', JSON.stringify(rowRR(h)));
    h.clock.advance(AGAIN - 1000);
    await settle();
    ok(reads === 1, 'not asked again inside the minutes both caches would answer from');
    out = true;
    h.clock.advance(1000);
    await settle();
    ok(reads === 2 && same(rowRR(h), ['+24 RR', '-16 RR']) && h.$('rank-rr').textContent === '+24 RR',
      'six minutes on it is asked again, and the RR Riot published meanwhile is on the match and in the rank card', `${reads} reads, ${JSON.stringify(rowRR(h))}`);
    h.clock.advance(60 * MIN);
    await settle();
    ok(reads === 2, 'and with it shown, nothing more is asked');

    // Never published: asked twice more, then left, until a paint sets it going again.
    let n = 0;
    const never = await openHome({ rows: ROWS, history: () => { n++; return { points: [B_GAME] }; } });
    for (let i = 0; i < 4; i++) { never.clock.advance(AGAIN); await settle(); }
    ok(n === 3, 'a game that never comes is asked for twice more, then no more', `${n} reads`);
    never.bridge.emit(C.PUSH_REVIEWS, { id: ROWS[0].id, game: 'valorant' });
    await settle();
    never.clock.advance(AGAIN);
    await settle();
    ok(n === 5, 'a review saved paints Home again, and the asking starts over', `${n} reads`);

    // A match that ended hours ago is not waited on: its game is not coming.
    let m = 0;
    const old = await openHome({ rows: ROWS.map((r) => ({ ...r, at: r.at - 3 * 60 * MIN })), history: () => { m++; return { points: [] }; } });
    old.clock.advance(AGAIN);
    await settle();
    ok(m === 1 && rowRR(old)[0] === '', 'the newest Competitive match ended hours ago: not asked again', `${m} reads`);
  });

  // Home reads the rank history main keeps for Stats, by Stats' rules, so the
  // two pages can never disagree about the same game.
  await section('Home and Stats read one rank history the same way:', async () => {
    const pt = (elo, change, tier) => ({ date: Date.UTC(2026, 9, 1), elo, change, tier: tier || 'Gold 2' });
    for (const [what, history] of [['a gain', { points: [pt(1180, -21), pt(1218, 18)] }], ['a loss', { points: [pt(1218, 18), pt(1203, -15)] }],
      ['a placement jump and an unrated point', { points: [pt(1203, -15), pt(1500, 297, 'Gold 3'), pt(0, 0, 'Unrated')] }],
      ['no change', { points: [pt(1203, 0)] }]]) {
      const st = statsWithRank(() => history);
      await repainted(st);
      const h = await openHome({ history: () => history });
      const tile = rankTileOf(st).querySelector('.arrow').textContent;
      ok(tile && h.$('rank-rr').textContent === tile, `${what}: Home says ${h.$('rank-rr').textContent || 'nothing'}, the Stats tile ${tile || 'nothing'}`);
    }
    // And the journey is the stretch the Stats graph draws, cut at the jump.
    const reset = { points: [pt(420, 20, 'Iron 3'), pt(445, 25, 'Iron 3'), pt(1200, 755, 'Gold 1'), pt(1221, 21, 'Gold 1'), pt(1250, 29)] };
    const st = statsWithRank(() => reset);
    await repainted(st);
    rankTileOf(st).click();
    await repainted(st);
    const graph = (st.document.querySelector('.rg-title') || {}).textContent || '';
    const h = await openHome({ history: () => reset });
    ok(/last 3 comp games/.test(graph) && /last 3 rated games, from Gold 1 to Gold 2/.test(h.$('rank-line').getAttribute('aria-label') || ''),
      'after an act reset both draw the three games since it', `Stats "${graph}", Home "${h.$('rank-line').getAttribute('aria-label')}"`);
  });

  await section('Settings, the game picker:', async () => {
    const se = loadSurface('settings', {
      handlers: {
        [C.CONFIG_GET]: () => ({ game: 'valorant', language: 'en', devGames: false }),
        [C.LICENSE_GET]: () => ({}), [C.STATE_GET]: () => ({}),
        [C.APP_VERSION]: () => ({ current: '8.0.1', state: 'current' }),
      },
    });
    await settle();
    const games = se.bridge.api.games.list(false);
    ok(same(games.map((g) => g.id), ['valorant', 'lol']) && (games.find((g) => g.id === 'lol') || {}).coaching === true,
      'the bridge lists Valorant and League alone, and calls League coachable, as Start does', games.map((g) => g.id).join(','));
    ok(same(se.bridge.api.games.list(true).map((g) => g.id), ['valorant', 'lol']), 'and so it does with devGames on');
    se.document.querySelector('#gamepick .dd-btn').click();   // open the real dropdown
    const row = (id) => se.document.querySelector(`.dd-opt[data-value="${id}"]`);
    ok(same(se.document.querySelectorAll('.dd-opt').map((o) => o.getAttribute('data-value')), ['valorant', 'lol']) && !row('rivals'),
      'the dropdown offers Valorant and League of Legends, and no Marvel Rivals');
    const r = row('lol');
    const note = r ? r.title : '';
    ok(r && /graded after every/i.test(note) && !/not built|look and layout/i.test(note) && !DASHES.test(note),
      'lol: the tooltip says how it is graded, never that coaching is not built', `read "${note}"`);
    const tag = r && r.querySelector('.dd-opt-tag');
    ok(tag && tag.textContent === 'preview', 'lol: still labelled preview, the registry\'s own flag');
    const v = row('valorant');
    ok(v && !v.title && !v.querySelector('.dd-opt-tag'), 'Valorant carries no label');
  });

  // CONNECTED MEANS CONNECT WAS PRESSED (riotConnected), as the sidebar and the
  // launch's check against Riot's record read it. A profile alone is one the
  // launch's own refresh saves for any ranked ID typed into Settings, a duo
  // partner's included, and Settings said "Connected" with their rank.
  await section('Settings, a typed Riot ID with a profile is not shown as connected:', async () => {
    const profile = { rank: 'Gold 2', peakRank: 'Platinum 1', kd: 1.12, winRate: 52, _riotId: 'Pal#EUW' };
    const open = async (extra) => {
      const se = loadSurface('settings', {
        handlers: {
          [C.CONFIG_GET]: () => ({ game: 'valorant', language: 'en', devGames: false, riotId: 'Pal#EUW', playerStats: profile, ...extra }),
          [C.LICENSE_GET]: () => ({}), [C.STATE_GET]: () => ({}),
          [C.APP_VERSION]: () => ({ current: '8.2.1', state: 'current' }),
        },
      });
      await settle();
      const el = se.document.querySelector('.trk-status');
      return { shown: !!el && !el.hidden && /\bok\b/.test(el.className), text: el ? el.textContent : '' };
    };
    const typed = await open({});
    ok(!typed.shown, 'typed and never connected, its profile is not shown as a connection', JSON.stringify(typed));
    const connected = await open({ riotConnected: 'Pal#EUW' });
    ok(connected.shown && /Gold 2/.test(connected.text), 'connected, it is, with its rank', JSON.stringify(connected));
  });

  // RECORD MATCH VIDEO (8.3): On or Off, as the player asked for a setting
  // that toggles recording, stored as the 'auto' and 'off' it shipped with.
  // Turned off by itself it says so, with a way to try again, and main can
  // turn it off while the page is open (a second busy session), which a
  // state push paints. What On and Off do is said per game, true in each.
  await section('Settings, record match video:', async () => {
    const autoOff = { at: Date.UTC(2026, 9, 10), reason: 'busy', sessions: 2 };
    const open = async (cfg) => {
      const se = loadSurface('settings', {
        handlers: {
          [C.CONFIG_GET]: () => ({ game: 'valorant', language: 'en', devGames: false, ...cfg }),
          [C.CONFIG_SET]: () => ({ ok: true }),
          [C.LICENSE_GET]: () => ({}), [C.STATE_GET]: () => ({}),
          [C.APP_VERSION]: () => ({ current: '8.3.0', state: 'current' }),
        },
      });
      await settle();
      return se;
    };
    const active = (se, id) => { const b = se.document.querySelector(`#${id} button.active`); return b ? b.dataset.val : null; };
    const lastSet = (se) => (se.bridge.invoked.filter(([ch]) => ch === C.CONFIG_SET).pop() || [])[1] || null;
    const plain = await open({ recordingMode: 'auto', recordingRes: '720' });
    const sec = plain.$('recording').parentNode;
    const buttons = plain.document.querySelectorAll('#recording button').map((b) => `${b.dataset.val}:${b.textContent}`);
    ok(sec.querySelector('h3').textContent === 'Record match video' && same(buttons, ['auto:On', 'off:Off']),
      'the section is Record match video, On and Off, On stored as the auto it shipped as', buttons.join(', '));
    ok(!/\bAuto\b/.test(sec.textContent), 'and nothing in it names Auto any more', sec.textContent);
    ok(active(plain, 'recording') === 'auto' && active(plain, 'recordingres') === '720' && plain.$('rec-note').hidden && plain.$('rec-retry').hidden,
      'On and 720p, and nothing to say');
    plain.$('recording').querySelector('button[data-val="off"]').click();
    await settle();
    ok(lastSet(plain) && lastSet(plain).recordingMode === 'off' && active(plain, 'recording') === 'off', 'Off is saved as off', JSON.stringify(lastSet(plain)));
    plain.$('recording').querySelector('button[data-val="auto"]').click();
    await settle();
    ok(lastSet(plain) && lastSet(plain).recordingMode === 'auto' && active(plain, 'recording') === 'auto', 'and On as auto, the value it always had', JSON.stringify(lastSet(plain)));
    plain.$('recordingres').querySelector('button[data-val="1080"]').click();
    await settle();
    ok(lastSet(plain) && lastSet(plain).recordingRes === '1080' && active(plain, 'recordingres') === '1080', '1080p is a choice', JSON.stringify(lastSet(plain)));
    const off = await open({ recordingMode: 'off', recordingRes: '720', recordingAutoOff: autoOff });
    const note = off.$('rec-note').textContent;
    ok(active(off, 'recording') === 'off' && !off.$('rec-note').hidden
      && note === 'Recording turned itself off: your PC was busy in two sessions this week. The coach still reads your screen.' && !DASHES.test(note),
    'turned off by itself: Off is marked, and the note says why, and that the screen is still read', note);
    ok(!off.$('rec-retry').hidden && off.$('rec-retry').textContent === 'Try again', 'with Try again under it');
    off.$('rec-retry').click();
    await settle();
    ok(lastSet(off) && lastSet(off).recordingMode === 'auto' && active(off, 'recording') === 'auto' && off.$('rec-note').hidden && off.$('rec-retry').hidden,
      'Try again sets it back On (main forgets the busy sessions), and the note goes', JSON.stringify(lastSet(off)));
    const hand = await open({ recordingMode: 'off' });
    ok(hand.$('rec-note').hidden && hand.$('rec-retry').hidden, 'Off chosen by hand: no note, nothing to try again');
    hand.bridge.emit(C.PUSH_STATE, { recording: { mode: 'off', res: '720', autoOff, last: null } });
    ok(!hand.$('rec-note').hidden && !hand.$('rec-retry').hidden && active(hand, 'recording') === 'off',
      'a state push while the page is open (turned off by itself mid session) paints the note and Try again');
    const noenc = await open({ recordingMode: 'auto', recordingLast: { outcome: 'no-hw-encoder', at: 1 } });
    const why = noenc.$('rec-note').textContent;
    ok(!noenc.$('rec-note').hidden && /no hardware video encoder/.test(why) && noenc.$('rec-retry').hidden && !DASHES.test(why),
      'a PC with no hardware encoder is told so, and offered nothing to retry', why);

    // WHAT ON AND OFF DO, per game. Valorant is recorded while its screen is
    // read; League while its own record is, and Settings never says League's
    // screen is read.
    const hint = (se) => se.$('rec-hint').textContent;
    const val = hint(plain);
    ok(val === 'On records each match on this PC at about 30 frames a second while the coach reads your screen; if your PC cannot keep up while you play, '
      + 'recording stops for that session and the coach keeps reading. Off records nothing, and the coach still reads your screen at the speed set above. '
      + 'The video stays on this PC: once a review is built, a short clip of each moment it looked at is kept beside it and the rest is deleted.',
    'Valorant: what On and Off do, and that the coach reads the screen either way', val);
    const lol = await open({ game: 'lol', recordingMode: 'off', recordingAutoOff: autoOff });
    const lolHint = hint(lol);
    const lolNote = lol.$('rec-note').textContent;
    const SCREEN_READ = /reads? (?:your |the )?screen|screen is read|read(?:s|ing)? your game/i;
    ok(SCREEN_READ.test(val) && SCREEN_READ.test('the coach reads the screen') && !SCREEN_READ.test("the review is built from the game's own record"),
      'the screen read detector finds the Valorant hint and passes over the League sentence');
    ok(/^On records each game on this PC/.test(lolHint) && /Off records nothing/.test(lolHint) && /built from the game's own record/.test(lolHint)
      && /up to six of your deaths/.test(lolHint) && !SCREEN_READ.test(lolHint) && !/screen/i.test(lolHint),
    'League: what On and Off do, its review built from the game\'s own record either way, and no word of a screen', lolHint);
    ok(!lol.$('rec-note').hidden && !SCREEN_READ.test(lolNote) && /Your review is still built from the game's own record\.$/.test(lolNote)
      && !lol.$('rec-retry').hidden, 'and its note, turned off by itself, says the same', lolNote);
    // Capture speed and Performance are about reading the screen: in League
    // they say they do nothing there, and in the other games what they did.
    const readHints = (se) => [se.$('capture-hint').textContent, se.$('perf-hint').textContent];
    const valRead = readHints(plain);
    const lolRead = readHints(lol);
    ok(lolRead.every((t) => /^In League of Legends this does nothing: its review is built from the game's own record\./.test(t) && !/screen/i.test(t) && !DASHES.test(t))
      && /It sets how often a Valorant match is read\.$/.test(lolRead[0]) && /It is for Valorant\.$/.test(lolRead[1])
      // In a live round: the rest is read less often (read-cadence.js, 8.3.2).
      && /^How often Occlara reads your screen in a live round\. Menus, buy phases and the time spent dead are read less often\./.test(valRead[0])
      && /^Screenshots are read at 720p/.test(valRead[1]),
    'League: Capture speed and Performance say they do nothing there, never that its screen is read, and Capture speed that it is Valorant\'s; Valorant keeps what they do', lolRead.join(' | '));
    // The game switched while the page is open: each game's words, and the
    // status line, which is about the recorder, in both.
    const sw = await open({ game: 'valorant', recordingMode: 'auto', recordingLast: { outcome: 'busy', at: 1 } });
    ok(hint(sw) === val && !sw.$('rec-note').hidden && /your PC was busy/.test(sw.$('rec-note').textContent),
      'Valorant: its hint, and its status line', sw.$('rec-note').textContent);
    sw.bridge.emit(C.PUSH_STATE, { gameId: 'lol', recording: { mode: 'auto', res: '720', autoOff: null, last: null } });
    ok(hint(sw) === lolHint, 'the game switched to League while the page is open: League\'s');
    ok(readHints(sw).every((t) => /^In League of Legends this does nothing/.test(t)), 'and its Capture speed and Performance say so too', readHints(sw).join(' | '));
    sw.bridge.emit(C.PUSH_STATE, { gameId: 'valorant', recording: { mode: 'auto', res: '720', autoOff: null, last: { outcome: 'busy', at: 1 } } });
    ok(hint(sw) === val && !sw.$('rec-note').hidden && /your PC was busy/.test(sw.$('rec-note').textContent) && same(readHints(sw), valRead),
      'and back to Valorant: its hint, its status line back, and what Capture speed and Performance do', readHints(sw).join(' | '));
    ok([val, lolHint, ...valRead, ...lolRead].every((t) => t && !DASHES.test(t) && !/Rivals|Marvel/.test(t)),
      'with no dash in any of them, and none naming a game Occlara no longer coaches');
    // The page's own words before main has answered anything (the
    // screenshot tool runs it with no bridge to answer at all).
    const never = () => new Promise(() => {});
    const waiting = loadSurface('settings', {
      handlers: Object.fromEntries([C.CONFIG_GET, C.STATE_GET, C.LICENSE_GET, C.APP_VERSION, C.BACKFILL_STATUS, C.CLIPS_USAGE].map((ch) => [ch, never])),
    });
    await settle();
    ok(hint(waiting) === val, 'with main yet to answer, the hint already says what On and Off do, Valorant\'s until the game is known', hint(waiting));
  });

  // THE CADENCE LINE SAYS WHICH GAP IT MEANS (8.3.2). The gap is the live
  // round's, and menus, a confirmed buy phase and the time spent dead are read
  // less often (read-cadence.js): "Reading every 1s right now", mostly seen
  // between matches, was not true there.
  await section('Settings, the cadence line:', async () => {
    const se = loadSurface('settings', {
      handlers: {
        [C.CONFIG_GET]: () => ({ game: 'valorant', language: 'en', captureSpeed: 'auto' }),
        [C.CONFIG_SET]: () => ({ ok: true }),
        [C.LICENSE_GET]: () => ({}), [C.STATE_GET]: () => ({}),
        [C.APP_VERSION]: () => ({ current: '8.3.2', state: 'current' }),
        [C.CLIPS_USAGE]: () => ({ bytes: 0, clips: 0, reviews: 0, capGB: 10 }),
      },
    });
    await settle();
    se.bridge.emit(C.PUSH_STATE, { isCoaching: true, cadence: 1000, captureSpeed: 'auto' });
    const line = se.$('cadence-now').hidden ? null : se.$('cadence-now').textContent;
    ok(line === 'Reading every 1s in a live round right now, chosen automatically. Menus, buy phases and the time spent dead are read less often.'
      && !DASHES.test(line || ''),
    'recording, it gives the live round\'s gap, and says the rest is read less often', line);
    se.bridge.emit(C.PUSH_STATE, { isCoaching: false });
    ok(se.$('cadence-now').hidden, 'and with no session there is no line');
    se.bridge.emit(C.PUSH_STATE, { isCoaching: true, cadence: null });
    const idxSrc = fs.readFileSync(path.join(ROOT, 'src', 'main', 'index.js'), 'utf8');
    ok(se.$('cadence-now').hidden && /revalidateNow\(\);\s*return;\s*\}\s*(?:\/\/[^\n]*\n\s*)*state\.cadence = null;/.test(idxSrc),
      'and a session starts with no gap until its engine says one, so a League one after Valorant shows none');
  });

  // ONE STATUS LINE AND THE CLIPS (8.3): recording now, at what size and about
  // how many frames a second, or why it is not, this session's reason before
  // the last one's; and under it what the clips kept beside the reviews take
  // against the cap, the cap, and Clear clips, all through the real preload.
  await section('Settings, the recording\'s status line and the clips:', async () => {
    const MB = 1024 * 1024;
    const GBYTES = 1024 * MB;
    let usage = { bytes: 0, clips: 0, reviews: 0, capGB: 10 };
    const open = async (cfg, state) => {
      const se = loadSurface('settings', {
        handlers: {
          [C.CONFIG_GET]: () => ({ game: 'valorant', language: 'en', devGames: false, recordingMode: 'auto', recordingRes: '720', clipCapGB: 10, ...(cfg || {}) }),
          [C.CONFIG_SET]: () => ({ ok: true }),
          [C.LICENSE_GET]: () => ({}), [C.STATE_GET]: () => ({ ...(state || {}) }),
          [C.APP_VERSION]: () => ({ current: '8.3.0', state: 'current' }),
          [C.CLIPS_USAGE]: () => ({ ...usage }),
          [C.CLIPS_CLEAR]: () => { usage = { bytes: 0, clips: 0, reviews: 0, capGB: usage.capGB }; return { ...usage }; },
        },
      });
      await settle();
      se.clock.advance(250);
      await settle();
      return se;
    };
    const view = (over) => ({ mode: 'auto', res: '720', autoOff: null, last: null, recording: false, live: null, session: null, ...(over || {}) });
    const note = (se) => (se.$('rec-note').hidden ? null : se.$('rec-note').textContent);
    const live = await open({}, { recording: view({ recording: true, live: { res: '720', width: 1280, height: 720, fps: 30 }, session: { outcome: null } }) });
    ok(note(live) === 'Recording now at 720p, about 30 fps.' && live.$('rec-note').classList.contains('live') && live.$('rec-retry').hidden,
      'recording now: the size and about how many frames a second, from the state as the page opens', note(live));
    const writtenOnce = live.$('rec-note').firstChild;
    live.bridge.emit(C.PUSH_STATE, { recording: view({ recording: true, live: { res: '720', width: 1280, height: 720, fps: 30 }, session: { outcome: null } }) });
    ok(writtenOnce && live.$('rec-note').firstChild === writtenOnce && note(live) === 'Recording now at 720p, about 30 fps.',
      'the same line pushed again is not written again: it is a live region, and the state comes on every tick');
    // THE TRACK'S OWN ROWS, not the setting's, where main gives them: a
    // display that is not 16:9 records another number of rows than the
    // setting names. Without them (a main that never sends them) the setting.
    const rowsOf = (lv) => {
      live.bridge.emit(C.PUSH_STATE, { recording: view({ res: lv.res, recording: true, live: lv, session: { outcome: null } }) });
      return note(live);
    };
    ok(rowsOf({ res: '1080', width: 1280, height: 1024, fps: 30 }) === 'Recording now at 1024p, about 30 fps.',
      'a 1280x1024 display at 1080p records 1024 rows, and says 1024p', note(live));
    ok(rowsOf({ res: '1080', width: 1366, height: 768, fps: 30 }) === 'Recording now at 768p, about 30 fps.',
      'a 1366x768 laptop at 1080p, 768p', note(live));
    ok(rowsOf({ res: '1080', width: null, height: null, fps: 30 }) === 'Recording now at 1080p, about 30 fps.'
      && rowsOf({ res: '720', fps: 30 }) === 'Recording now at 720p, about 30 fps.'
      && rowsOf({ res: '1080', height: '1024', fps: 30 }) === 'Recording now at 1080p, about 30 fps.',
    'with no height given, or one that is no number, the setting\'s', note(live));
    live.bridge.emit(C.PUSH_STATE, { recording: view({ res: '1080', recording: true, live: { res: '1080', width: 1920, height: 1080, fps: null }, session: { outcome: null } }) });
    ok(note(live) === 'Recording now at 1080p.', 'a still screen has no frame rate to give, so none is said', note(live));
    live.bridge.emit(C.PUSH_STATE, { recording: view({ session: { outcome: 'busy' }, last: { outcome: 'recorded', at: 1 } }) });
    ok(/^Recording stopped in this session: your PC was busy\./.test(note(live) || '') && !live.$('rec-note').classList.contains('live'),
      'given up mid session: this session\'s reason, before the last session\'s', note(live));
    const lastOf = async (outcome) => note(await open({ recordingLast: { outcome, at: 1 } }));
    const disk = await lastOf('disk');
    const black = await lastOf('black');
    const busy = await lastOf('busy');
    const err = await lastOf('error');
    ok(/^Not enough free disk to record in your last session: recording needs 8 GB free on this drive\./.test(disk || ''), 'not enough disk', disk);
    ok(/^Recording needs Windowed Fullscreen: the game read black to it in your last session\./.test(black || ''), 'Windowed Fullscreen needed', black);
    ok(/^Recording stopped in your last session: your PC was busy\. It tries again next session/.test(busy || ''), 'one busy session, and it tries again', busy);
    ok(/^Recording stopped on an error in your last session\./.test(err || ''), 'an error', err);
    ok(note(await open({ recordingLast: { outcome: 'recorded', at: 1 } })) === null && note(await open({ recordingMode: 'off', recordingLast: { outcome: 'busy', at: 1 } })) === null,
      'a last session that recorded, or Off chosen by hand, says nothing');
    // League's screen is never read: what goes on is its review, from the game's record.
    const lolBlack = note(await open({ game: 'lol', recordingLast: { outcome: 'black', at: 1 } }));
    const lolState = await open({ game: 'valorant' }, { gameId: 'lol', recording: view({ last: { outcome: 'disk', at: 1 } }) });
    ok(/the game read black to it in your last session\. Your review is still built from the game's own record\.$/.test(lolBlack || '')
      && /Your review is still built from the game's own record\.$/.test(note(lolState) || '') && /The coach still reads your screen\.$/.test(black || ''),
    'with League chosen, the line says the review is still built from the game\'s record, never that the screen is read', `${lolBlack} | ${note(lolState)}`);
    ok([disk, black, busy, err, note(live)].every((t) => t && !DASHES.test(t)), 'with no dash in any of it');

    // The clips: 1.2 GB of 10 GB kept, then the cap, then Clear clips.
    usage = { bytes: Math.round(1.24 * GBYTES), clips: 7, reviews: 2, capGB: 10 };
    const se = await open({ clipCapGB: 10 });
    const active = (id) => { const b = se.document.querySelector(`#${id} button.active`); return b ? b.dataset.val : null; };
    ok(se.$('clip-usage').textContent === 'Clips kept beside your reviews: 1.2 GB of 10 GB, 7 clips from 2 reviews.' && active('clipcap') === '10' && !se.$('clip-clear').disabled,
      'what the clips take against the cap, read from main, the cap marked, Clear clips ready', se.$('clip-usage').textContent);
    ok(same(se.document.querySelectorAll('#clipcap button').map((b) => b.dataset.val), ['5', '10', '20', '50']), 'the cap is 5, 10, 20 or 50 GB');
    usage = { ...usage, bytes: 380 * MB, clips: 3, reviews: 1, capGB: 5 };
    se.$('clipcap').querySelector('button[data-val="5"]').click();
    await settle();
    se.clock.advance(250);
    await settle();
    const set = se.bridge.invoked.filter(([ch]) => ch === C.CONFIG_SET).pop();
    ok(set && set[1].clipCapGB === 5 && typeof set[1].clipCapGB === 'number' && active('clipcap') === '5', 'a cap chosen is saved as its number', JSON.stringify(set && set[1]));
    ok(se.$('clip-usage').textContent === 'Clips kept beside your reviews: 380 MB of 5 GB, 3 clips from 1 review.',
      'and the line read again, since a lower cap clears the oldest at once', se.$('clip-usage').textContent);
    usage = { ...usage, bytes: 420 * MB, clips: 4 };
    se.bridge.emit(C.PUSH_REVIEWS, { id: 'valorant-1759341600000-abcd01', game: 'valorant' });
    se.clock.advance(250);
    await settle();
    ok(/^Clips kept beside your reviews: 420 MB of 5 GB, 4 clips/.test(se.$('clip-usage').textContent), 'a review saved meanwhile, its clips just kept, reads it again', se.$('clip-usage').textContent);
    const cleared = () => se.bridge.invoked.filter(([ch]) => ch === C.CLIPS_CLEAR).length;
    se.$('clip-clear').click();
    await settle();
    ok(!cleared() && se.$('clip-clear').textContent === 'Press again to clear every clip' && se.$('clip-clear').classList.contains('armed'),
      'one press of Clear clips only asks, since nothing it clears comes back', se.$('clip-clear').textContent);
    se.clock.advance(4100);
    ok(!cleared() && se.$('clip-clear').textContent === 'Clear clips' && !se.$('clip-clear').classList.contains('armed'), 'and four seconds on, it has stopped asking');
    se.$('clip-clear').click();
    se.$('clip-clear').click();
    await settle();
    ok(cleared() === 1 && se.$('clip-usage').textContent === 'No clips kept yet. They take up to 5 GB together.' && se.$('clip-clear').disabled
      && se.$('clip-clear').textContent === 'Clear clips',
    'pressed twice, it asks main to clear them, and the line says none are kept', se.$('clip-usage').textContent);
    usage = { bytes: 300 * 1024, clips: 1, reviews: 1, capGB: 5 };
    se.bridge.emit(C.PUSH_REVIEWS, { id: 'valorant-1759341600000-abcd02', game: 'valorant' });
    se.clock.advance(250);
    await settle();
    ok(se.$('clip-usage').textContent === 'Clips kept beside your reviews: less than 1 MB of 5 GB, 1 clip from 1 review.',
      'a total under a megabyte is said to be, never rounded up to one', se.$('clip-usage').textContent);
    ok(!DASHES.test(se.$('clip-usage').textContent + se.document.querySelector('.rec-cap-hint').textContent), 'no dash in the clips\' words');
    const b = loadPreload('settings', {});
    ok(b.api && typeof b.api.getClipsUsage === 'function' && typeof b.api.clearClips === 'function' && typeof b.api.onReviews === 'function',
      'the settings bridge reads the clips, clears them, and hears a review saved');
    await b.api.getClipsUsage();
    await b.api.clearClips();
    b.api.onReviews(() => {});
    ok(same(b.invoked.map(([ch]) => ch), [C.CLIPS_USAGE, C.CLIPS_CLEAR]) && b.listening(C.PUSH_REVIEWS) === 1
      && C.CLIPS_USAGE === 'clips:usage' && C.CLIPS_CLEAR === 'clips:clear', 'over CLIPS_USAGE, CLIPS_CLEAR and PUSH_REVIEWS', JSON.stringify(b.invoked));
  });

  // THE CLIP OF A MOMENT (8.3): played from occlara-clip in its death's own
  // round (8.3.1), above the frames, muted, inline and looping, the frame the
  // coach looked at as its picture; a click plays and pauses it, and it pauses
  // out of view or with the page hidden. A clip the cap or Settings took is
  // said to be gone, and the frames stay.
  await section('the review plays the clip of each moment:', async () => {
    const AT = Date.UTC(2026, 9, 1, 18, 4, 0);
    const ID = 'valorant-1759341600000-clip01';
    const card = (n, forensics) => ({ n, side: 'Defence', result: 'lost', died: true, facts: ['Died at A Site'], reads: [], why: null, forensics });
    const look = (n, extra) => ({ cause: 'dry-peek', what: 'You swung wide.', better: 'Wait for the flash.',
      frames: [`r${n}-before.jpg`, `r${n}-after.jpg`], source: 'riot', at: AT, clip: `r${n}-clip.mkv`, ...(extra || {}) });
    const base = {
      id: ID, kind: 'valorant', source: 'watched', aiLog: null,
      game: { map: 'Abyss', agent: 'Jett', result: 'Defeat', score: '11-13' },
      rounds: [
        card(2, look(2, { clipUrl: `occlara-clip://review/${ID}/r2-clip.mkv` })),
        card(9, look(9, { clipGone: 'space' })),
        card(14, look(14, { clipGone: 'cleared' })),
        card(19, look(19, { clip: null })),
      ],
      frameData: { 'r2-before.jpg': 'data:image/jpeg;base64,AAA2b', 'r2-after.jpg': 'data:image/jpeg;base64,AAA2a',
        'r9-before.jpg': 'data:image/jpeg;base64,AAA9b', 'r14-before.jpg': 'data:image/jpeg;base64,AAA14b', 'r19-before.jpg': 'data:image/jpeg;base64,AAA19b' },
    };
    // The browser's half of a <video> and an IntersectionObserver, which the
    // fake DOM has neither of: play() and pause() fire what the page listens
    // to, and the observer is told by hand when a clip leaves the view.
    const observers = [];
    class FakeIO {
      constructor(cb, opts) { this.cb = cb; this.opts = opts; this.seen = new Set(); observers.push(this); }
      observe(el) { this.seen.add(el); }
      unobserve(el) { this.seen.delete(el); }
      disconnect() { this.seen.clear(); }
    }
    const media = (v) => {
      v.paused = true;
      v.calls = [];
      v.play = () => { v.calls.push('play'); v.paused = false; v.dispatchEvent({ type: 'play' }); return Promise.resolve(); };
      v.pause = () => { v.calls.push('pause'); if (!v.paused) { v.paused = true; v.dispatchEvent({ type: 'pause' }); } };
      v.load = () => { v.calls.push('load'); };
      return v;
    };
    const open = async (r) => {
      const v = loadSurface('review', { handlers: { [C.LOL_REVIEW_GET]: () => r }, window: { IntersectionObserver: FakeIO } });
      const make = v.document.createElement.bind(v.document);
      v.document.createElement = (tag) => { const e = make(tag); return String(tag).toLowerCase() === 'video' ? media(e) : e; };
      await settle();
      return v;
    };
    const v = await open(base);
    const m = (n) => v.$(`moment-${n}`);
    const kids = (n) => m(n).children.map((c) => c.className.split(' ')[0]);
    const side = (n) => m(n).children[0].children.map((c) => c.className.split(' ')[0]);
    ok(same(kids(2), ['v-media', 'v-advice']) && same(side(2), ['v-clip', 'v-shots']) && m(2).parentNode === v.$('round-2'),
      'a moment with its clip, in its round: the clip, the frames still under it, and the coach\'s words beside', `${kids(2).join(' | ')} / ${side(2).join(' | ')}`);
    const rcss = fs.readFileSync(path.join(RENDERER, 'review', 'review.css'), 'utf8');
    const across = (n) => m(n).querySelector('.v-shots').style['--n'];
    ok(m(2).classList.contains('has-clip') && !m(9).classList.contains('has-clip') && !m(19).classList.contains('has-clip')
      && across(2) === '4' && across(9) === '1' && across(19) === '1'
      && /\.v-shots \{ display: grid; grid-template-columns: repeat\(var\(--n, 1\), minmax\(0, 1fr\)\);/.test(rcss),
    'the frames under a clip are a filmstrip four to the row; a moment with no clip keeps its frame across its side',
    `${across(2)} ${across(9)} ${across(19)}`);
    ok(!m(2).querySelector('.v-clip figcaption') && !/From your recording/.test(v.$('vreview').textContent),
      'and no caption under the clip saying what its row already says');
    const vid = m(2).querySelector('.v-clip .v-clip-frame video.v-clip-video');
    ok(vid && vid.getAttribute('src') === `occlara-clip://review/${ID}/r2-clip.mkv`, 'a <video> playing it from occlara-clip', vid && vid.getAttribute('src'));
    ok(vid && vid.muted === true && ['muted', 'loop', 'playsinline'].every((a) => vid.hasAttribute(a)) && vid.getAttribute('preload') === 'none',
      'muted, looping, inline, and nothing loaded until it is played');
    ok(vid && vid.getAttribute('poster') === base.frameData['r2-before.jpg'], 'the frame the coach looked at as its picture until it plays');
    ok(vid && vid.calls.length === 0, 'and it does not play by itself');
    const btn = m(2).querySelector('.v-clip-play');
    ok(btn && btn.tagName === 'BUTTON' && btn.getAttribute('aria-label') === 'Play the clip' && btn.querySelectorAll('svg').length === 2,
      'a button over it says play, for the keyboard as well as the mouse');
    btn.click();
    ok(same(vid.calls, ['play']) && m(2).querySelector('.v-clip').classList.contains('playing') && btn.getAttribute('aria-label') === 'Pause the clip',
      'pressed, it plays, and says pause', JSON.stringify(vid.calls));
    vid.click();
    ok(same(vid.calls, ['play', 'pause']) && !m(2).querySelector('.v-clip').classList.contains('playing') && btn.getAttribute('aria-label') === 'Play the clip',
      'a click on the picture pauses it again', JSON.stringify(vid.calls));
    const io = observers[0];
    ok(io && io.seen.has(vid), 'it is watched for leaving the view');
    vid.play();
    io.cb([{ target: vid, isIntersecting: false }], io);
    ok(vid.paused === true && vid.calls[vid.calls.length - 1] === 'pause', 'scrolled out of view while playing, it pauses');
    vid.play();
    io.cb([{ target: vid, isIntersecting: true }], io);
    ok(vid.paused === false, 'and coming into view does not stop one playing');
    v.document.hidden = true;
    for (const fn of v.document._listeners.visibilitychange || []) fn({ type: 'visibilitychange' });
    ok(vid.paused === true, 'the page hidden (another page, the seal) pauses it');
    v.document.hidden = false;
    const gone = (n) => m(n).querySelector('.v-clip-gone');
    ok(!m(9).querySelector('video') && gone(9) && gone(9).textContent === 'Its clip was cleared to keep your clips under the space set in Settings. The frames and facts stay.'
      && m(9).querySelectorAll('.v-shot img').length === 1, 'a clip the cap took: no player, said so, and its frame kept');
    ok(!m(14).querySelector('video') && gone(14) && gone(14).textContent === 'Its clip was cleared in Settings. The frames and facts stay.', 'one cleared from Settings says that');
    ok(!m(19).querySelector('video') && !gone(19) && same(kids(19), ['v-media', 'v-advice']) && same(side(19), ['v-shots'])
      && same(m(19).children[1].children.map((c) => c.className.split(' ')[0]), ['v-look-tag', 'v-look-what', 'v-look-better']),
    'a match that was not recorded: its frames, the coach\'s words beside them, and nothing said');
    ok(!DASHES.test(v.$('v-rounds').textContent), 'no dash in the rounds');
    // A repaint lets the old player go: stopped, its source taken off, loaded empty.
    vid.calls.length = 0;
    v.bridge.emit(C.PUSH_VALORANT_REVIEW, { ...base, rounds: [base.rounds[3]] });
    await settle();
    ok(same(vid.calls, ['pause', 'load']) && !vid.hasAttribute('src') && !io.seen.has(vid) && !v.document.querySelectorAll('#v-rounds video').length,
      'a repaint stops the clip it replaces, takes its source off and lets it go', JSON.stringify(vid.calls));
    const csp = (v.document.querySelector('meta[http-equiv="Content-Security-Policy"]') || { getAttribute: () => '' }).getAttribute('content');
    ok(/(^|;)\s*media-src 'self' occlara-clip:;/.test(csp) && /default-src 'self'/.test(csp), 'the page may play media from itself and occlara-clip, and nothing else', csp);

    // LEAGUE (8.3): "Your deaths", each by the game's clock with its one fact,
    // and the clip of it where the game was recorded.
    const LID = 'lol-1759341600000-deaths1';
    const lol = {
      id: LID, kind: 'lol', game: { champion: 'Ahri', role: 'Middle', mode: 'CLASSIC', duration: '31:04' },
      scoreline: { kills: 4, deaths: 3, assists: 6, cs: 210, csAt10: 70, ward: 14 },
      deaths: { headline: 'You died 3 times.', detail: 'No single pattern.' },
      deathList: [
        { n: 1, atSec: 210, at: '3:30', fact: 'An ally had died in the 20 seconds before it.', clip: 'd1-clip.mkv', clipUrl: `occlara-clip://review/${LID}/d1-clip.mkv` },
        { n: 2, atSec: 600, at: '10:00', fact: 'No ally died within 20 seconds of it.', clip: 'd2-clip.mkv', clipGone: 'space' },
        { n: 3, atSec: 900, at: '15:00', fact: 'An ally died in the 20 seconds after it.' },
      ],
      moments: [], objectives: { dragonsFor: 1, dragonsAgainst: 2, baronsFor: 0, baronsAgainst: 1, turretsFor: 3, turretsAgainst: 5 },
      scored: [], unmeasured: [], next: null, gamesRecorded: 0,
    };
    const l = await open(lol);
    const ld = (n) => l.$(`death-${n}`);
    ok(!l.$('r-deaths-wrap').hidden && l.$('r-deaths-wrap').querySelector('h3').textContent === 'Your deaths'
      && same(l.document.querySelectorAll('#r-deaths .l-death').map((d) => d.id), ['death-1', 'death-2', 'death-3']),
    'a League review lists every death, under "Your deaths"');
    // Six at most are clipped, spread across the game (clips.js pickSpread),
    // and the hint says so: the rest show no clip, and it said nothing of why.
    const deathsHint = l.$('r-deaths-wrap').querySelector('.hint').textContent;
    const clipsLib = require('../src/shared/clips');
    ok(clipsLib.MAX_CLIPS === 6 && /up to six deaths, spread across the game, have a clip/.test(deathsHint)
      && /from 11 seconds before the death to 4 after it/.test(deathsHint) && clipsLib.BEFORE_MS === 11000 && clipsLib.AFTER_MS === 4000
      && !DASHES.test(deathsHint), 'its hint says up to six deaths, spread across the game, have a clip, and over which seconds', deathsHint);
    ok(!/Click a clip|by the game's clock/.test(deathsHint), 'and nothing the rows themselves show: how to play a clip, or that each is by the clock', deathsHint);
    ok(ld(1).querySelector('.v-round-head .v-rn').textContent === 'Death 1' && ld(1).querySelector('.v-round-head .v-side').textContent === '3:30',
      'each by its number and the game\'s clock');
    ok(l.$('r-deaths').classList.contains('v-rounds') && same(ld(1).children.map((c) => c.className.split(' ')[0]), ['v-round-head', 'v-moment'])
      && ld(3).classList.contains('quiet') && ld(3).children.length === 1 && ld(3).querySelector('.v-round-head .v-look-what'),
    'drawn as a Valorant review draws its rounds: a death with its clip a row with the clip beside its fact, one with its fact alone a line');
    ok(l.$('r-meta').textContent === 'Middle  ·  CLASSIC  ·  31:04', 'and its line about the game is in middots, as the Valorant one is',
      l.$('r-meta').textContent);
    // In fixed columns a number past the last sat alone on a second row.
    const scoreRule = (rcss.match(/(?:^|\n)\.scoreline \{([^}]*)\}/) || [])[1] || '';
    ok(/grid-template-columns: repeat\(auto-fit, minmax\(110px, 1fr\)\);/.test(scoreRule),
      'and the scores are one row however many a game has', scoreRule.trim());
    const lv = ld(1).querySelector('video.v-clip-video');
    ok(lv && lv.getAttribute('src') === `occlara-clip://review/${LID}/d1-clip.mkv` && lv.muted === true && lv.hasAttribute('loop') && lv.getAttribute('preload') === 'none'
      && !lv.hasAttribute('poster'), 'a recorded death plays its clip, as a Valorant moment does, with no frame to show before it plays');
    ok(ld(1).querySelector('.v-look-what').textContent === 'An ally had died in the 20 seconds before it.', 'and says the one fact the record gives');
    ok(!ld(2).querySelector('video') && ld(2).querySelector('.v-clip-gone').textContent === 'Its clip was cleared to keep your clips under the space set in Settings. Its facts stay.',
      'a death whose clip the cap took says so');
    ok(!ld(3).querySelector('video') && !ld(3).querySelector('.v-clip-gone') && ld(3).querySelector('.v-look-what'), 'one never recorded has its fact alone');
    ld(1).querySelector('.v-clip-play').click();
    ok(lv.paused === false, 'and its clip plays on a click');
    // The page is kept between reviews: a Valorant review painted after it
    // takes the window, and the League clip still playing goes with it.
    l.bridge.emit(C.PUSH_VALORANT_REVIEW, { id: 'valorant-1759341600000-val001', kind: 'valorant', source: 'watched', rounds: [],
      game: { map: 'Abyss', agent: 'Jett', result: 'Victory', score: '13-11' } });
    await settle();
    ok(l.$('review').hidden && !l.$('vreview').hidden && lv.paused === true && !lv.hasAttribute('src'),
      'a Valorant review painted after it takes the window, and the playing clip is stopped and let go');
    l.bridge.emit(C.PUSH_LOL_REVIEW, { ...lol, deathList: [] });
    await settle();
    ok(!l.$('review').hidden && l.$('vreview').hidden && l.$('r-deaths-wrap').hidden && !l.document.querySelectorAll('#r-deaths .l-death').length,
      'and a League game with no death after it takes the window back, with no such list');
  });

  // THE CLIP PLAYER (8.4.4): every clip a review shows, both games, with play
  // and pause, back to the start, a second and a frame either way, a timeline
  // read out as the seconds from the death with the death in --bad and the
  // coach's stills marked, and the speed. A step lands on the clip's own
  // frames, one seek is in flight at a time, the keyboard works only while
  // the player has focus, and a still under its clip is a place in it. A
  // review saved before has no marks, and one with no clip times steps a
  // thirtieth of a second.
  await section('the clip player: its controls and their names, its marks, its words and its steps:', async () => {
    const CT = require('../src/renderer/review/clip-time');
    const ID = 'valorant-1759341600000-play01';
    // A clip's frames as main reads them: a frame a thirtieth of a second, and
    // a dropped one after frame 60, as a clip recorded unevenly has.
    const TIMES = Array.from({ length: 120 }, (_v, i) => Math.round((i * 1000) / 30) + (i > 60 ? 15 : 0));
    const FR = { times: TIMES, end: TIMES[TIMES.length - 1] + 33 };
    const F = CT.framesOf(FR);
    const DEATH = TIMES[90] + 12;
    // The stills' seconds from the death, each its own frame's, to the hundredth.
    const STILL_FRAMES = [15, 45, 69, 81, 111];
    const AT = STILL_FRAMES.map((k) => Math.round((TIMES[k] - DEATH) / 10) / 100);
    const names = AT.map((a, k) => `r2-rec${k + 1}-${a < 0 ? 'before' : 'after'}.jpg`);
    const look = { cause: 'dry-peek', what: 'You swung wide.', better: 'Wait for the flash.', frames: names, frameAt: AT, framesFrom: 'recording',
      source: 'riot', at: Date.UTC(2026, 9, 1, 18, 4, 0), clip: 'r2-clip.mkv', clipUrl: `occlara-clip://review/${ID}/r2-clip.mkv`, clipFrames: FR, clipDeath: DEATH };
    const card = (n, forensics) => ({ n, side: 'Defence', result: 'lost', died: true, facts: ['Died at A Site'], reads: [], why: null, forensics });
    const base = {
      id: ID, kind: 'valorant', source: 'watched', aiLog: null, game: { map: 'Abyss', agent: 'Jett', result: 'Defeat', score: '11-13' },
      rounds: [card(2, look)],
      frameData: Object.fromEntries(names.map((n, k) => [n, `data:image/jpeg;base64,AAA2s${k}`])),
    };
    class FakeIO { constructor() { this.seen = new Set(); } observe(e) { this.seen.add(e); } unobserve(e) { this.seen.delete(e); } disconnect() {} }
    // The browser's half of a <video>: play and pause fire what the page
    // listens to, a seek is recorded and lands when the test says so, and the
    // clip's length is known once its metadata is "loaded".
    const media = (v) => {
      let at = 0;
      Object.assign(v, { paused: true, calls: [], seeks: [], readyState: 0, duration: NaN, playbackRate: 1, defaultPlaybackRate: 1 });
      Object.defineProperty(v, 'currentTime', { configurable: true, get: () => at, set: (x) => { at = x; v.seeks.push(x); } });
      v.play = () => { v.calls.push('play'); if (v.paused) { v.paused = false; v.dispatchEvent({ type: 'play' }); } return Promise.resolve(); };
      v.pause = () => { v.calls.push('pause'); if (!v.paused) { v.paused = true; v.dispatchEvent({ type: 'pause' }); } };
      v.load = () => { v.calls.push('load'); };
      return v;
    };
    const loaded = (v, sec) => { v.readyState = 4; v.duration = sec; v.dispatchEvent({ type: 'loadedmetadata' }); };
    const land = (v) => v.dispatchEvent({ type: 'seeked' });
    const open = async (r, handler, also) => {
      const p = loadSurface('review', { handlers: { [handler || C.LOL_REVIEW_GET]: () => r }, window: { IntersectionObserver: FakeIO } });
      const make = p.document.createElement.bind(p.document);
      p.document.createElement = (tag) => {
        const e = make(tag);
        if (String(tag).toLowerCase() !== 'video') return e;
        media(e);
        if (also) also(e);
        return e;
      };
      await settle();
      return p;
    };
    const p = await open(base);
    const fig = p.$('moment-2').querySelector('.v-clip');
    const vid = fig.querySelector('video.v-clip-video');
    const range = fig.querySelector('.cp-seek');
    const time = fig.querySelector('.cp-time');
    const btn = (act) => fig.querySelector(`.cp-btn[data-act="${act}"]`);
    const playBtn = fig.querySelector('.v-clip-play');
    const words = (t) => CT.timeWords(t, { death: DEATH, frames: F, duration: FR.end / 1000 });

    // ── The markup, and every control's name ──
    ok(fig.getAttribute('role') === 'group' && fig.getAttribute('aria-label') === 'The clip of round 2' && fig.getAttribute('tabindex') === '-1'
      && fig.querySelector(`#${fig.getAttribute('aria-describedby')}`)
      && fig.querySelector(`#${fig.getAttribute('aria-describedby')}`).textContent
        === 'Space or K plays and pauses, comma and full stop step one frame, the arrows one second, and Home goes back to the start.',
    'the player is a group named for its round, focusable out of the tab order, and says its keys to a screen reader');
    ok(same(fig.children.map((c) => c.className.split(' ')[0]), ['v-clip-frame', 'cp-bar', 'sr-only', 'sr-only'])
      && same(fig.querySelector('.cp-bar').children.map((c) => c.className), ['cp-line', 'cp-row'])
      && same(fig.querySelector('.v-clip-frame').children.map((c) => c.className), ['v-clip-video', 'v-clip-big'])
      && fig.querySelector('.v-clip-big').getAttribute('aria-hidden') === 'true' && fig.querySelector('.v-clip-big').tagName === 'SPAN',
    'the picture with its mark over it, a picture and no button, then the timeline and one row of controls under it');
    const row = fig.querySelector('.cp-row').children;
    const controls = row.filter((c) => c.tagName === 'BUTTON');
    ok(same(controls.map((b) => b.getAttribute('aria-label')),
      ['Play the clip', 'Back to the start', 'Back one second', 'Back one frame', 'Forward one frame', 'Forward one second'])
      && controls.every((b) => b.getAttribute('type') === 'button' || b.type === 'button')
      && same(controls.map((b) => b.title), ['Play the clip (K)', 'Back to the start (Home)', 'Back one second (←)', 'Back one frame (,)',
        'Forward one frame (.)', 'Forward one second (→)'])
      && same(controls.map((b) => b.getAttribute('aria-keyshortcuts')), ['Space K', 'Home', 'ArrowLeft', ',', '.', 'ArrowRight'])
      && controls.every((b) => b.classList.contains('icon-btn') && b.querySelector('svg')),
    'play, back to the start, a second and a frame each way: each a button with its name, the key that does the same and its mark',
    controls.map((b) => b.getAttribute('aria-label')).join(' | '));
    ok(range.tagName === 'INPUT' && range.getAttribute('type') === 'range' && range.getAttribute('aria-label') === 'Time in the clip'
      && range.getAttribute('min') === '0' && range.getAttribute('max') === String(Math.round(FR.end)) && range.getAttribute('step') === '1'
      && range.getAttribute('aria-valuetext') === words(0).label && /s before the death$/.test(range.getAttribute('aria-valuetext')),
    `the timeline is an input of type range, the clip's length in ms, read out as the seconds from the death ("${range.getAttribute('aria-valuetext')}")`);
    const speed = fig.querySelector('.cp-speed');
    const rates = speed.querySelectorAll('button');
    ok(speed.getAttribute('role') === 'group' && speed.getAttribute('aria-label') === 'Playback speed'
      && same(rates.map((b) => b.textContent), ['1x', '0.5x', '0.25x']) && same(rates.map((b) => b.getAttribute('aria-pressed')), ['true', 'false', 'false']),
    'the speed, 1x, 0.5x and 0.25x, each a button that says whether it is the one');
    ok(time.getAttribute('aria-hidden') === 'true' && time.textContent === words(0).text
      && fig.querySelectorAll('.sr-only').some((s) => s.getAttribute('aria-live') === 'polite'),
    `the time beside them in the stills' words ("${time.textContent}"), the timeline saying it to a screen reader, and a polite line for each move`);
    ok(vid.getAttribute('preload') === 'none' && vid.getAttribute('poster') === base.frameData[names[3]] && vid.muted === true
      && ['muted', 'loop', 'playsinline'].every((a) => vid.hasAttribute(a)) && !vid.calls.length && !vid.seeks.length,
    'nothing loads until it is played or moved, the frame nearest the death from before it its picture');

    // ── The marks ──
    const marks = fig.querySelectorAll('.cp-track .cp-mark');
    const pOf = (ms) => String(ms / Math.round(FR.end));
    const death = marks.filter((x) => x.classList.contains('death'));
    const stills = marks.filter((x) => x.classList.contains('still'));
    ok(death.length === 1 && death[0].style['--p'] === pOf(DEATH) && !death[0].hidden && fig.querySelector('.cp-track').getAttribute('aria-hidden') === 'true',
      `the death marked on the timeline where it falls in the clip (${death[0] && death[0].style['--p']})`);
    ok(stills.length === 5 && same(stills.map((x) => x.style['--p']), AT.map((a) => pOf(DEATH + a * 1000))) && stills.every((x) => !x.hidden),
      'and the coach\'s five stills where they were taken, by their seconds from it', stills.map((x) => x.style['--p']).join(' '));
    ok(range.title === 'The red mark is the death, the white ones the coach\'s stills', 'the timeline says what its marks are', range.title);
    const rcss = fs.readFileSync(path.join(RENDERER, 'review', 'review.css'), 'utf8');
    ok(/\.cp-mark\.death \{[^}]*background: var\(--bad\);/.test(rcss) && /\.cp-fill \{[^}]*background: var\(--text-dim\);[^}]*transform: scaleX\(var\(--p\)\);/.test(rcss)
      && !/gradient/.test(rcss),
    'the death in --bad, the timeline filled with a solid fill scaled to its place, and no gradient');
    ok(/@media \(prefers-reduced-motion: reduce\) \{\s*\.v-clip-big, \.cp-btn, \.cp-rate \{ transition: none; \}/.test(rcss),
      'and nothing of the player moves when asked for reduced motion');

    // ── A step before the clip was ever played ──
    btn('forwardFrame').click();
    ok(vid.getAttribute('preload') === 'auto' && !vid.seeks.length && time.textContent === words(CT.insideOf(F, 1)).text,
      'a step before it ever played loads the clip and waits for its length, the time already the next frame\'s', `${vid.getAttribute('preload')} ${vid.seeks}`);
    loaded(vid, FR.end / 1000);
    ok(same(vid.seeks, [CT.insideOf(F, 1)]) && range.getAttribute('max') === String(Math.round(FR.end)),
      `loaded, it lands on the next frame's own time, just inside it (${vid.seeks[0]} s, the frame at ${TIMES[1]} ms)`);
    land(vid);
    // ONE SEEK IN FLIGHT: three steps while the first is on its way are one
    // seek after it, to the newest.
    btn('forwardFrame').click();
    btn('forwardFrame').click();
    btn('forwardFrame').click();
    ok(same(vid.seeks, [CT.insideOf(F, 1), CT.insideOf(F, 2)]), 'a step while none is on its way seeks at once', JSON.stringify(vid.seeks));
    land(vid);
    ok(same(vid.seeks, [CT.insideOf(F, 1), CT.insideOf(F, 2), CT.insideOf(F, 4)]) && time.textContent === words(CT.insideOf(F, 4)).text,
      'and the two asked while it was on its way are one seek once it landed, to the frame they came to: one seek in flight at a time',
      JSON.stringify(vid.seeks));
    land(vid);
    btn('backFrame').click();
    land(vid);
    ok(vid.seeks[vid.seeks.length - 1] === CT.insideOf(F, 3), 'a step back lands on the frame before');
    // Across the dropped frame, a step is the next frame and not a thirtieth of a second.
    vid.currentTime = CT.insideOf(F, 60);
    land(vid);
    btn('forwardFrame').click();
    land(vid);
    ok(vid.seeks[vid.seeks.length - 1] === CT.insideOf(F, 61) && TIMES[61] - TIMES[60] > 45,
      `across a dropped frame, the next frame's own time (${TIMES[61]} ms), not a thirtieth of a second on`);

    // ── Play, pause, and a step pauses first ──
    playBtn.click();
    ok(vid.paused === false && fig.classList.contains('playing') && playBtn.getAttribute('aria-label') === 'Pause the clip' && playBtn.title === 'Pause the clip (K)',
      'play plays it, and the button says pause');
    btn('backFrame').click();
    ok(vid.paused === true && vid.calls[vid.calls.length - 1] === 'pause' && playBtn.getAttribute('aria-label') === 'Play the clip',
      'a frame step pauses it first: a frame is studied paused');
    land(vid);
    // ── A second either way, and the start ──
    const t0 = vid.currentTime;
    btn('forwardSecond').click();
    land(vid);
    const oneOn = vid.seeks[vid.seeks.length - 1];
    ok(oneOn === CT.landOn(F, t0 + 1) && Math.abs(oneOn - (t0 + 1)) < 0.034, 'forward one second is a second on, inside the frame there');
    btn('backSecond').click();
    land(vid);
    const oneBack = vid.seeks[vid.seeks.length - 1];
    for (let i = 0; i < 4 && vid.seeks[vid.seeks.length - 1] > CT.startOf(F); i++) { btn('backSecond').click(); land(vid); }
    const backs = vid.seeks.slice(vid.seeks.lastIndexOf(oneOn) + 1);
    ok(oneBack === CT.landOn(F, oneOn - 1) && Math.abs(oneBack - t0) < 0.034 && t0 > 1
      && backs.slice(1).every((x, i) => x === (backs[i] - 1 > 0 ? CT.landOn(F, backs[i] - 1) : CT.startOf(F)))
      && backs[backs.length - 1] === CT.startOf(F) && (btn('backSecond').click(), land(vid), vid.seeks[vid.seeks.length - 1] === CT.startOf(F)),
    'back one second a second back, and no further than the start', JSON.stringify(vid.seeks.slice(-4)));
    btn('start').click();
    land(vid);
    ok(vid.seeks[vid.seeks.length - 1] === CT.startOf(F), 'back to the start is its first frame');
    // AT THE LAST FRAME, NO SEEK TO WHERE IT ALREADY STANDS: Chromium answers
    // one there by looping the clip back to its start (check:webmplay holds
    // it in the browser), and a step on at the end was frame 0.
    const LAST = CT.insideOf(F, TIMES.length - 1);
    range.value = String(Math.round(FR.end));
    p.fire(range, 'input');
    land(vid);
    const atEnd = vid.seeks.length;
    btn('forwardFrame').click();
    btn('forwardSecond').click();
    p.fire(range, 'input');
    ok(vid.seeks[atEnd - 1] === LAST && vid.seeks.length === atEnd && time.textContent === words(LAST).text,
      'at the last frame, a step on, a second on and the timeline at its end again seek nowhere: none to where it already stands',
      JSON.stringify(vid.seeks.slice(atEnd - 1)));
    btn('backFrame').click();
    land(vid);
    btn('forwardFrame').click();
    land(vid);
    ok(vid.seeks.length === atEnd + 2 && vid.seeks[vid.seeks.length - 1] === LAST, 'and a step back, then on again, are two seeks, back onto it');

    // ── The words at the death ──
    vid.currentTime = CT.insideOf(F, 90);
    land(vid);
    ok(time.textContent === 'At the death' && time.classList.contains('at-death') && range.getAttribute('aria-valuetext') === 'At the death',
      'the frame the death falls in reads "At the death", the timeline too');
    btn('forwardFrame').click();
    land(vid);
    ok(/^0\.0\d s after$/.test(time.textContent) && !time.classList.contains('at-death') && range.getAttribute('aria-valuetext') === `${time.textContent} the death`
      && fig.querySelectorAll('.sr-only').find((s) => s.getAttribute('aria-live')).textContent === `${time.textContent} the death`,
    `the frame after it to the hundredth ("${time.textContent}"), said once it is moved to`);

    // ── The keyboard, only while the player has focus ──
    const key = (target, k, extra) => p.fire(target, 'keydown', { key: k, ...(extra || {}) });
    const before = vid.seeks.length;
    ok(!key(fig, '.') && vid.seeks.length === before + 1 && vid.seeks[vid.seeks.length - 1] === CT.insideOf(F, 92), 'full stop steps a frame on');
    land(vid);
    ok(!key(fig, ',') && vid.seeks[vid.seeks.length - 1] === CT.insideOf(F, 91), 'comma a frame back');
    land(vid);
    ok(!key(fig, 'Home') && vid.seeks[vid.seeks.length - 1] === CT.startOf(F), 'Home the start');
    land(vid);
    const tk = vid.currentTime;
    ok(!key(fig, 'ArrowRight') && vid.seeks[vid.seeks.length - 1] === CT.landOn(F, tk + 1), 'the right arrow a second on');
    land(vid);
    const tk2 = vid.seeks[vid.seeks.length - 1];
    ok(!key(fig, 'ArrowLeft') && vid.seeks[vid.seeks.length - 1] === CT.landOn(F, tk2 - 1), 'the left arrow a second back');
    land(vid);
    ok(!key(fig, 'k') && vid.paused === false && !key(fig, 'K') && vid.paused === true && !key(fig, ' ') && vid.paused === false,
      'K plays and pauses, and so does Space');
    key(fig, ' ');
    const seeksNow = vid.seeks.length;
    ok(key(fig, 'ArrowDown') && key(fig, 'ArrowUp') && key(fig, 'PageDown') && key(fig, ',', { ctrlKey: true }) && vid.seeks.length === seeksNow,
      'the page\'s own scroll keys, and a key with Ctrl, are left to the page');
    const tr = vid.currentTime;
    const upOk = !key(range, 'ArrowUp') && vid.seeks[vid.seeks.length - 1] === CT.landOn(F, tr + 1) && vid.seeks.length === seeksNow + 1;
    const up = vid.seeks[vid.seeks.length - 1];
    land(vid);
    const downOk = !key(range, 'ArrowDown') && vid.seeks[vid.seeks.length - 1] === CT.landOn(F, up - 1) && Math.abs(vid.seeks[vid.seeks.length - 1] - tr) < 0.034
      && vid.seeks.length === seeksNow + 2;
    land(vid);
    ok(upOk && downOk, 'on the timeline, up and down are a second each way, as its arrows are, never the range\'s own millisecond step');
    ok(key(btn('backFrame'), ' ') && vid.paused === true, 'Space on a control reached by Tab presses that control, as a button\'s Space does');
    const strayKey = p.fire(p.$('v-summary'), 'keydown', { key: '.' });
    ok(strayKey && vid.seeks.length === seeksNow + 2, 'and a key anywhere else on the page does nothing to the clip');
    // A control pressed with the pointer hands the keyboard to the player.
    const down = p.fire(btn('forwardFrame'), 'mousedown');
    ok(!down && p.document.activeElement === fig, 'a control pressed with the pointer hands the keyboard to the player, not to itself');

    // ── The speed ──
    rates[2].click();
    ok(vid.playbackRate === 0.25 && vid.defaultPlaybackRate === 0.25 && same(rates.map((b) => b.getAttribute('aria-pressed')), ['false', 'false', 'true']),
      'a quarter speed, and the button says it is the one');
    rates[1].click();
    ok(vid.playbackRate === 0.5 && same(rates.map((b) => b.getAttribute('aria-pressed')), ['false', 'true', 'false']), 'half');
    rates[0].click();
    ok(vid.playbackRate === 1, 'and back to 1x');

    // ── The timeline dragged ──
    vid.play();
    p.fire(range, 'pointerdown');
    ok(vid.paused === true, 'dragged while it plays, it waits paused');
    range.value = '2500';
    p.fire(range, 'input');
    ok(vid.seeks[vid.seeks.length - 1] === CT.landOn(F, 2.5) && time.textContent === words(CT.landOn(F, 2.5)).text, 'at the place dragged to, inside the frame there, the time with it');
    range.value = '2600';
    p.fire(range, 'input');
    range.value = '2700';
    p.fire(range, 'input');
    const mid = vid.seeks.length;
    land(vid);
    ok(vid.seeks.length === mid + 1 && vid.seeks[vid.seeks.length - 1] === CT.landOn(F, 2.7), 'the places dragged past while a seek was on its way are one seek, to the newest');
    land(vid);
    p.fire(range, 'pointerup');
    ok(vid.paused === false, 'and let go, it plays on');
    vid.pause();
    // LET GO OFF THE TIMELINE, its place unchanged: the range hears neither
    // its pointerup nor a change, and the page's own pointerup lets go.
    vid.play();
    p.fire(range, 'pointerdown');
    const ups = (p.window._listeners.pointerup || []).slice();
    for (const fn of ups) fn({ type: 'pointerup' });
    ok(vid.paused === false && ups.length === 1 && !(p.window._listeners.pointerup || []).length,
      'grabbed, dragged off the timeline and let go there, it plays on: the page\'s own pointerup lets go, and is listened for no longer');
    vid.currentTime = 3.2;
    p.fire(vid, 'timeupdate');
    ok(range.value === '3200', 'and the timeline follows it as it plays again', range.value);
    vid.pause();

    // ── A still under its clip is a place in it ──
    const gos = p.$('moment-2').querySelectorAll('.v-shot .v-shot-go');
    ok(gos.length === 5 && gos.every((g) => g.tagName === 'BUTTON' && g.querySelector('img'))
      && same(gos.map((g) => g.getAttribute('aria-label')), AT.map((a) => (a < 0 ? `Show the clip at ${CT.secondsOf(a)} s before the death` : a <= 1 ? 'Show the clip at just after the death' : `Show the clip at ${CT.secondsOf(a)} s after the death`)))
      && same(p.$('moment-2').querySelectorAll('.v-shot figcaption').map((c) => c.textContent).slice(0, 4), AT.slice(0, 4).map((a) => `${Math.round(Math.abs(a) * 10) / 10} s before`)),
    'under its clip each still is a button named for its moment, its caption as it was', gos.map((g) => g.getAttribute('aria-label')).join(' | '));
    vid.play();
    gos[2].click();
    ok(vid.paused === true && vid.seeks[vid.seeks.length - 1] === CT.stillAt(F, DEATH, AT[2]) && CT.frameIndex(TIMES, vid.seeks[vid.seeks.length - 1] * 1000) === STILL_FRAMES[2]
      && gos[2].getAttribute('aria-current') === 'true' && gos[2].parentNode.classList.contains('shown') && !gos[1].hasAttribute('aria-current'),
    'a click on one moves the clip to that still\'s own frame and pauses it there, the still marked as the one shown');
    land(vid);
    // The still keeps the focus it was clicked with, and the player's keys work from it.
    const fromStill = vid.seeks.length;
    ok(!p.fire(gos[2], 'keydown', { key: '.' }) && vid.seeks.length === fromStill + 1
      && vid.seeks[vid.seeks.length - 1] === CT.insideOf(F, STILL_FRAMES[2] + 1),
    'full stop pressed on the still clicked steps the clip on from that still\'s frame: the stills hear the player\'s keys');
    land(vid);
    btn('forwardFrame').click();
    ok(!gos[2].hasAttribute('aria-current') && !gos[2].parentNode.classList.contains('shown'), 'and once the clip moves on, it no longer is');
    land(vid);
    const fig0 = gos[0].parentNode;
    gos[0].querySelector('img').click();
    ok(!fig0.classList.contains('zoom'), 'a still under its clip shows in the clip, the clip at the width a zoomed frame takes');

    // ── SEEN, NOT ASSUMED: a step checked against the frame presented ──
    // Beside a capture stall Chromium shows the frame before the one a step
    // lands in (check:webmplay holds it on a clip with one). The compositor
    // says which frame it presented (requestVideoFrameCallback, stood in for
    // here), and the seek goes again by what it saw.
    let shownCbs = [];
    const sp = await open(base, undefined, (e) => { e.requestVideoFrameCallback = (cb) => { shownCbs.push(cb); return shownCbs.length; }; });
    const present = (ms) => { const cbs = shownCbs; shownCbs = []; for (const cb of cbs) cb(0, { mediaTime: ms / 1000 }); };
    const sfig = sp.$('moment-2').querySelector('.v-clip');
    const sv = sfig.querySelector('video');
    const sbtn = (act) => sfig.querySelector(`.cp-btn[data-act="${act}"]`);
    const stime = sfig.querySelector('.cp-time');
    const sRange = sfig.querySelector('.cp-seek');
    const shows = (k) => { land(sv); present(TIMES[k]); sp.clock.flushFrames(); };
    const lastSeek = () => sv.seeks[sv.seeks.length - 1];
    loaded(sv, FR.end / 1000);
    sRange.value = String(TIMES[40] + 1);
    sp.fire(sRange, 'input');
    shows(40);
    ok(sv.seeks.length === 1 && stime.textContent === words(CT.insideOf(F, 40)).text, 'moved to frame 40 and seen there: one seek, and its words');
    sbtn('forwardFrame').click();
    const firstTry = lastSeek();
    shows(40);
    const margin41 = Math.min(CT.INSIDE_MS, (TIMES[42] - TIMES[41]) / 4);
    const secondTry = lastSeek();
    ok(firstTry === CT.insideOf(F, 41) && sv.seeks.length === 3 && secondTry > firstTry
      && Math.abs(secondTry * 1000 - (TIMES[41] + (firstTry * 1000 - TIMES[40]) - margin41)) < 1e-6,
    'a step forward shown the frame before it goes again, as far past frame 41\'s own start as frame 40 was taken to last',
    JSON.stringify([firstTry, secondTry]));
    shows(41);
    ok(sv.seeks.length === 3 && stime.textContent === words(CT.insideOf(F, 41)).text && sRange.value === String(Math.round(CT.insideOf(F, 41) * 1000)),
      `shown frame 41 then, the time beside the clip and the timeline are frame 41's, the clock at ${secondTry} s or not`);
    sbtn('forwardFrame').click();
    ok(lastSeek() === CT.insideOf(F, 42), 'and the next step counts on from the frame on screen, frame 42, never from where the clock stood');
    shows(42);
    sbtn('backFrame').click();
    ok(lastSeek() === secondTry, 'a frame once seen shown by another time is gone back to by that time: back to 41 as it was shown');
    shows(41);
    // A frame never shown for any time tried: six tries, then the frame on
    // screen is said, and the next step goes on past the one that would not show.
    const before42 = sv.seeks.length;
    sbtn('forwardFrame').click();
    for (let i = 0; i < 9; i++) shows(41);
    ok(sv.seeks.length === before42 + 7 && stime.textContent === words(CT.insideOf(F, 41)).text,
      'a frame shown for no time tried: six tries after the first, and the time beside the clip is the frame on screen\'s', String(sv.seeks.length - before42));
    sbtn('forwardFrame').click();
    ok(lastSeek() === CT.insideOf(F, 43), 'and the next step goes on past the frame that would not show, never stuck behind it');
    shows(43);
    // Shown a later frame than the one aimed at, the seek goes back toward its start.
    sbtn('forwardFrame').click();
    const late = lastSeek();
    shows(45);
    ok(lastSeek() < late && lastSeek() * 1000 > TIMES[44], 'shown a later frame, the seek goes again earlier, still inside the frame aimed at', JSON.stringify([late, lastSeek()]));
    shows(44);
    ok(stime.textContent === words(CT.insideOf(F, 44)).text, 'and once shown, its words');
    // Shown a later frame, then an earlier one: the next try goes between the two times seen.
    sbtn('forwardFrame').click();
    const b1 = lastSeek();
    shows(46);
    const b2 = lastSeek();
    shows(44);
    const b3 = lastSeek();
    ok(b2 < b1 && b3 > b2 && b3 < b1 && Math.abs(b3 - (b1 + b2) / 2) < 1e-9,
      'shown a later frame and then an earlier one, the next try goes halfway between the two times seen', JSON.stringify([b1, b2, b3]));
    shows(45);
    // Every try showed another frame, never the one aimed at: back to the try
    // that showed the nearest, one on the way the move goes before one behind,
    // as beside a real stall, where the last try stood nine frames back.
    const startKept = sv.seeks.length;
    sbtn('forwardFrame').click();
    const kept = [];
    for (const k of [43, 48, 47, 45, 48, 45, 43]) { kept.push([lastSeek(), k]); shows(k); }
    const nearest = kept.find(([, k]) => k === 47)[0];
    ok(Math.abs(kept[1][0] - (kept[0][0] + (TIMES[47] - TIMES[46]) / 1000)) < 1e-9,
      'shown a frame three before the one aimed at, the next try is a frame\'s length later, never as far again as the frame shown was taken to last',
      JSON.stringify(kept.slice(0, 2)));
    ok(sv.seeks.length === startKept + kept.length + 1 && lastSeek() === nearest,
      'none of seven tries showed frame 46: the clip goes back to the time that showed 47, the nearest on the way on',
      JSON.stringify(kept.map(([at, k]) => `${at}:${k}`)));
    shows(47);
    ok(stime.textContent === words(CT.insideOf(F, 47)).text, 'and says frame 47, the frame on screen');
    sbtn('forwardFrame').click();
    ok(lastSeek() === CT.insideOf(F, 47) || CT.frameIndex(TIMES, lastSeek() * 1000) === 47,
      'the next step goes on from 46, the frame that would not show, to 47', String(lastSeek()));
    shows(47);
    // THE SAME FRAME, NOT ONLY THE SAME TIME. On these frames (gaps of 17, 15
    // and 15 ms after 33s, as a real clip had them) the time that showed frame
    // 31 is frame 32's own landing to the ms: taken for the same place, the
    // step to 32 set no seek, and every step after it stayed on 31.
    const T2 = [];
    for (let i = 0, t = 0; i < 60; i++) { T2.push(t); t += i === 30 ? 17 : i === 31 || i === 32 ? 15 : 33; }
    const FR2 = { times: T2, end: T2[T2.length - 1] + 33 };
    const F2 = CT.framesOf(FR2);
    shownCbs = [];
    const sp2 = await open({ ...base, rounds: [card(2, { ...look, clipFrames: FR2, clipDeath: T2[50] })] }, undefined,
      (e) => { e.requestVideoFrameCallback = (cb) => { shownCbs.push(cb); return shownCbs.length; }; });
    const s2fig = sp2.$('moment-2').querySelector('.v-clip');
    const s2v = s2fig.querySelector('video');
    const s2shows = (k) => { land(s2v); present(T2[k]); sp2.clock.flushFrames(); };
    loaded(s2v, FR2.end / 1000);
    const s2range = s2fig.querySelector('.cp-seek');
    s2range.value = String(T2[30] + 1);
    sp2.fire(s2range, 'input');
    s2shows(30);
    s2fig.querySelector('.cp-btn[data-act="forwardFrame"]').click();
    s2shows(30);
    const shown31 = s2v.seeks[s2v.seeks.length - 1];
    s2shows(31);
    const before32 = s2v.seeks.length;
    s2fig.querySelector('.cp-btn[data-act="forwardFrame"]').click();
    ok(Math.abs(shown31 - CT.insideOf(F2, 32)) < 0.0005 && s2v.seeks.length === before32 + 1,
      'the time that showed frame 31 is frame 32\'s own, and the step to frame 32 seeks all the same: the same frame, never only the same time',
      JSON.stringify([shown31, CT.insideOf(F2, 32), s2v.seeks.length - before32]));
    s2shows(31);
    s2shows(32);
    ok(s2fig.querySelector('.cp-time').textContent === CT.timeWords(CT.insideOf(F2, 32), { death: T2[50], frames: F2 }).text,
      'and shown frame 31 for it, it goes again and shows 32');

    // ── A review saved before: no place for the death ──
    const older = await open({ ...base, rounds: [card(2, { ...look, clipDeath: null })] });
    const of = older.$('moment-2').querySelector('.v-clip');
    ok(!of.querySelectorAll('.cp-mark').length && !of.querySelector('.cp-seek').title
      && of.querySelector('.cp-time').textContent === `0 s of ${Math.round(FR.end / 100) / 10} s`
      && of.querySelector('.cp-seek').getAttribute('aria-valuetext') === `0 s into the clip, of ${Math.round(FR.end / 100) / 10} s`,
    `a review saved before 8.4.4 marks nothing and times the clip by its own seconds ("${of.querySelector('.cp-time').textContent}")`);
    const oldShot = older.$('moment-2').querySelectorAll('.v-shot')[0];
    ok(!older.$('moment-2').querySelectorAll('.v-shot-go').length && oldShot.querySelector('img').parentNode === oldShot,
      'and its stills, with no place in the clip, are frames as they were');
    oldShot.querySelector('img').click();
    ok(oldShot.classList.contains('zoom'), 'a click zooms one, as before');

    // ── A review with no clip times: a thirtieth of a second a step ──
    const bare = await open({ ...base, rounds: [card(2, { ...look, clipFrames: undefined })] });
    const bf = bare.$('moment-2').querySelector('.v-clip');
    const bv = bf.querySelector('video');
    const bMarks = bf.querySelectorAll('.cp-mark');
    ok(bf.querySelector('.cp-seek').getAttribute('max') === '0' && bMarks.length === 6 && bMarks.every((x) => x.hidden),
      'with no frames handed with it, its length is not known until it loads, and its marks wait for it');
    loaded(bv, 4);
    ok(bf.querySelector('.cp-seek').getAttribute('max') === '4000' && bMarks.every((x) => !x.hidden)
      && bf.querySelector('.cp-mark.death').style['--p'] === String(DEATH / 4000),
    'loaded, the timeline is the clip\'s length and the marks are placed on it');
    bf.querySelector('[data-act="forwardFrame"]').click();
    ok(Math.abs(bv.seeks[0] - 1 / 30) < 1e-9, 'and a step is a thirtieth of a second', JSON.stringify(bv.seeks));
    land(bv);
    bf.querySelector('[data-act="backFrame"]').click();
    ok(bv.seeks[1] === 0, 'back to the start, no further');

    // ── A League death's clip: the same player, the death marked, no stills ──
    const LID = 'lol-1759341600000-play02';
    const lol = {
      id: LID, kind: 'lol', game: { champion: 'Ahri', role: 'Middle', mode: 'CLASSIC', duration: '31:04' },
      scoreline: { kills: 4, deaths: 1, assists: 6, cs: 210, csAt10: 70, ward: 14 }, deaths: { headline: 'You died once.', detail: 'Alone.' },
      deathList: [{ n: 1, atSec: 210, at: '3:30', fact: 'No ally died within 20 seconds of it.', clip: 'd1-clip.mkv',
        clipUrl: `occlara-clip://review/${LID}/d1-clip.mkv`, clipFrames: FR, clipDeath: DEATH }],
      moments: [], objectives: { dragonsFor: 1, dragonsAgainst: 2, baronsFor: 0, baronsAgainst: 1, turretsFor: 3, turretsAgainst: 5 },
      scored: [], unmeasured: [], next: null, gamesRecorded: 0,
    };
    const l = await open(lol);
    const lf = l.$('death-1').querySelector('.v-clip');
    const lMarks = lf.querySelectorAll('.cp-mark');
    ok(lf && lf.getAttribute('aria-label') === 'The clip of death 1' && lMarks.length === 1 && lMarks[0].classList.contains('death')
      && lMarks[0].style['--p'] === pOf(DEATH) && lf.querySelector('.cp-seek').title === 'The red mark is the death'
      && same(lf.querySelectorAll('.cp-row .cp-btn').map((b) => b.getAttribute('aria-label')),
        ['Play the clip', 'Back to the start', 'Back one second', 'Back one frame', 'Forward one frame', 'Forward one second'])
      && lf.querySelectorAll('.cp-rate').length === 3 && !lf.querySelector('video').hasAttribute('poster'),
    'a League death\'s clip has the same player, its death marked where the game\'s clock put it, and no stills');
    lf.querySelector('[data-act="forwardFrame"]').click();
    loaded(lf.querySelector('video'), FR.end / 1000);
    ok(lf.querySelector('video').seeks[0] === CT.insideOf(F, 1), 'and it steps on its own frames too');

    // ── A look from the screen counts from its read ──
    const sc = await open({ ...base, rounds: [card(2, { ...look, source: 'screen' })] });
    const sf = sc.$('moment-2').querySelector('.v-clip');
    sf.querySelector('video').currentTime = CT.insideOf(F, 90);
    loaded(sf.querySelector('video'), FR.end / 1000);
    land(sf.querySelector('video'));
    ok(sf.querySelector('.cp-time').textContent === 'Read as dead' && sf.querySelector('.cp-seek').getAttribute('aria-valuetext') === 'The frame the screen read the death on'
      && sf.querySelector('.cp-seek').title === 'The red mark is where the screen read the death, the white ones the coach\'s stills',
    'a look from the screen counts from its read of the death, that frame "Read as dead", as its stills are named');
    ok(!DASHES.test(p.$('v-rounds').textContent + l.$('r-deaths').textContent + controls.map((b) => b.title + b.getAttribute('aria-label')).join(' ')),
      'no dash in the player\'s words');
  });

  await section('the AI log describes deaths, and only a tip era log counts reviews:', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'occlara-surfaces-'));
    try {
      const jpeg = Buffer.from('ffd8ffe000104a464946', 'hex');
      const T = Date.UTC(2026, 9, 1, 20, 0, 0);
      const alive = { map: 'Abyss', playerAlive: true, playerHp: 100, teamScore: 3, enemyScore: 2 };
      const dead = { map: 'Abyss', playerAlive: false, phase: 'dead', aliveTell: 'killed by Jett, spectating a teammate', teamScore: 3, enemyScore: 2 };
      const states = [alive, alive, dead, dead, alive];
      const write = (stamp, tipEra) => {
        const dir = path.join(root, `session-${stamp}`);
        fs.mkdirSync(dir, { recursive: true });
        const records = states.map((state, i) => {
          const frame = `frame-${String(i).padStart(5, '0')}.jpg`;
          fs.writeFileSync(path.join(dir, frame), jpeg);
          // What each build writes: 8.0 has no `shown` at all, the tip era always had one.
          return tipEra
            ? { i, at: T + i * 10000, frame, state, aiTip: '', shown: null, reject: null }
            : { i, at: T + i * 10000, frame, state, round: 6, died: i === 2, match: null };
        });
        fs.writeFileSync(path.join(dir, 'log.json'), JSON.stringify({ startedAt: T, records }));
        return `session-${stamp}`;
      };
      const now8 = write('2026-10-01T20-00-00-000Z', false);
      const old = write('2026-09-01T20-00-00-000Z', true);

      const open = async (id, weapon) => {
        const a = loadSurface('ailog', {
          handlers: {
            [C.AILOG_GET]: (sid) => aiLogStore.read(root, sid),
            [C.AILOG_CONFIRM]: () => ({ status: 'confirmed', summary: 'Riot agrees on 1 death.', pairs: [{ round: 6, killer: 'Jett', weapon }] }),
            [C.CONFIG_GET]: () => ({ ailogHintSeen: 3 }),
          },
          window: { location: { hash: `#${id}`, search: '' } },
        });
        await settle();
        return a;
      };

      const a = await open(now8, 'Outlaw');
      const sub = a.$('subtitle').textContent;
      ok(/1 death$/.test(sub) && !/reviewed/.test(sub), 'an 8.0 session counts its deaths and no reviews', `read "${sub}"`);
      const marks = a.document.querySelectorAll('#marks .mark-death');
      ok(marks.length === 1 && !marks[0].classList.contains('unreviewed'), 'its skull is not greyed out as a miss');
      ok(marks[0] && marks[0].title === 'Round 6: killed by Jett with an Outlaw. Confirmed by Riot.',
        'its tooltip names the death and Riot\'s weapon, with an Outlaw, and no review', `read "${marks[0] && marks[0].title}"`);
      if (marks[0]) marks[0].click();
      const why = a.$('death-why');
      ok(why.textContent === 'round 6, killed by Jett' && !why.classList.contains('unreviewed'),
        'on the death, the line says what happened, not that the coach said nothing', `read "${why.textContent}"`);

      const b = await open(old, 'Vandal');
      const subOld = b.$('subtitle').textContent;
      ok(/1 death, 0 reviewed$/.test(subOld), 'a tip era session keeps the reviewed count it was written with', `read "${subOld}"`);
      const markOld = b.document.querySelectorAll('#marks .mark-death')[0];
      ok(markOld && markOld.classList.contains('unreviewed')
        && markOld.title === 'Round 6: killed by Jett with a Vandal, no review was shown. Confirmed by Riot.',
        'and greys the death the coach never spoke about, with a Vandal', `read "${markOld && markOld.title}"`);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  // THE ENGINE'S DEATHS, AND RIOT'S CHECK OF THEM ROUND BY ROUND (8.4.1), on
  // the shape of the player's Fracture swiftplay: one SWITCH PLAYER frame the
  // engine never registered, then a false round 1 death it kept and the real
  // round 2 one, a weak tell's withdrawn between them, and Riot has round 2
  // alone, with no weapon name. Main's check stood in for by the real
  // reconcile it runs (index.js confirmDeaths).
  await section('the AI log opens a match on the death the engine kept, and Riot\'s check says each by its round:', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'occlara-surfaces-engine-'));
    try {
      const dr = require('../src/main/services/death-reconcile');
      const jpeg = Buffer.from('ffd8ffe000104a464946', 'hex');
      const M = Date.UTC(2026, 9, 14, 0, 24, 51);
      const sid = 'session-2026-10-14T00-24-51-000Z';
      const dir = path.join(root, sid);
      fs.mkdirSync(dir, { recursive: true });
      const OWN = { map: 'Fracture', playerAlive: true, playerHp: 100, aliveTell: 'own HP 100 and Classic bottom left', teamScore: 0, enemyScore: 0 };
      const SWITCH = { map: 'Fracture', playerAlive: false, aliveTell: 'Spectating, teammate portrait and SWITCH PLAYER bottom left', teamScore: 0, enemyScore: 0 };
      const WEAK = { map: 'Fracture', playerAlive: false, aliveTell: 'Spectating teammate, own HP not shown', teamScore: 1, enemyScore: 0 };
      const KILLED = { map: 'Fracture', playerAlive: false, aliveTell: 'KILLED BY CHAMBER and COMBAT REPORT visible, no own health number', teamScore: 1, enemyScore: 0 };
      const rows = [[OWN, 1], [SWITCH, 1], [OWN, 1], [SWITCH, 1, true], [SWITCH, 1], [{ ...OWN, teamScore: 1 }, 2], [WEAK, 2], [{ ...OWN, teamScore: 1 }, 2],
        [KILLED, 2, true], [KILLED, 2]];
      const records = rows.map(([state, round, died], i) => {
        const frame = `frame-${String(i).padStart(5, '0')}.jpg`;
        fs.writeFileSync(path.join(dir, frame), jpeg);
        return { i, at: M + 60000 + i * 1000, frame, state, round, died: died === true, match: M };
      });
      fs.writeFileSync(path.join(dir, 'log.json'), JSON.stringify({ startedAt: M, records }));
      const scope = aiLogStore.placeOf(dir, M, M + 600000);
      const riot = { rounds: 2, total: 1, deaths: [{ round: 2, killer: 'Chamber', weapon: 'Weapon', atMs: 3000 }] };
      const a = loadSurface('ailog', {
        handlers: {
          [C.AILOG_GET]: (id, sc) => aiLogStore.read(root, id, null, sc),
          [C.AILOG_CONFIRM]: (id, sc) => {
            const log = aiLogStore.read(root, id, null, sc);
            const rec = dr.reconcile(log.deaths, riot, log.records);
            rec.summary = dr.summarise(rec);
            return rec;
          },
          [C.CONFIG_GET]: () => ({ ailogHintSeen: 3 }),
        },
        window: { location: { hash: `#${encodeURIComponent(JSON.stringify({ scope }))}`, search: '' } },
      });
      await settle();
      const marks = a.document.querySelectorAll('#marks .mark-death');
      ok(Number(a.$('slider').value) === 3 && a.$('death-pos').textContent === 'Death 1 of 2' && marks.length === 2,
        'the eye opens on the match\'s first death the engine kept, not a SWITCH PLAYER frame it never registered, the withdrawn read no death',
        `${a.$('slider').value} | ${a.$('death-pos').textContent} | ${marks.length}`);
      ok(a.$('confirm').textContent === "Checked against Riot's record of the match: the screen read 2 deaths and Riot has 1, with none in round 1."
        && a.$('confirm').classList.contains('overcounted') && !DASHES.test(a.$('confirm').textContent),
      'Riot\'s check says it as the review says it', `read "${a.$('confirm').textContent}"`);
      ok(marks[0] && marks[0].classList.contains('refuted') && marks[0].title === 'Round 1: Riot has no death in this round. Frame 4.'
        && a.$('death-why').textContent === 'round 1, Riot has no death in this round',
      'the death in a round Riot has none in is marked so, dimmed', `read "${marks[0] && marks[0].title}" | "${a.$('death-why').textContent}"`);
      ok(marks[1] && !marks[1].classList.contains('refuted') && marks[1].title === 'Round 2: killed by Chamber. Confirmed by Riot.',
        'and the one Riot has carries its killer, and no "with a Weapon" for a kill Riot named no weapon for', `read "${marks[1] && marks[1].title}"`);
      // A killer Riot's record does not name: the server answers null for one
      // its roster lacks, never a name (8.4.1), and the mark says no killer.
      // And a server from before 8.4.1, which still sends the killer's Riot
      // ID: main's check keeps a killer only as an agent, so none is painted.
      const openWith = async (killer) => {
        riot.deaths[0] = { round: 2, killer, weapon: 'Vandal', atMs: 3000 };
        const b = loadSurface('ailog', {
          handlers: {
            [C.AILOG_GET]: (id, sc) => aiLogStore.read(root, id, null, sc),
            [C.AILOG_CONFIRM]: (id, sc) => {
              const log = aiLogStore.read(root, id, null, sc);
              const rec = dr.reconcile(log.deaths, riot, log.records);
              rec.summary = dr.summarise(rec);
              return rec;
            },
            [C.CONFIG_GET]: () => ({ ailogHintSeen: 3 }),
          },
          window: { location: { hash: `#${encodeURIComponent(JSON.stringify({ scope }))}`, search: '' } },
        });
        await settle();
        const mark = b.document.querySelectorAll('#marks .mark-death')[1];
        b.$('death-next').click();
        return { title: mark ? mark.title : null, why: b.$('death-why').textContent, text: b.document.body.textContent };
      };
      const unnamed = await openWith(null);
      ok(unnamed.title === 'Round 2. Confirmed by Riot.' && unnamed.why === 'round 2' && !/null|undefined/.test(`${unnamed.title} ${unnamed.why}`),
        'and one whose killer Riot\'s record does not name says no killer, never "killed by null"',
        `read "${unnamed.title}" | "${unnamed.why}"`);
      const named = await openWith('Foe#NA1');
      ok(named.title === 'Round 2. Confirmed by Riot.' && named.why === 'round 2' && !/Foe|NA1/.test(`${named.title} ${named.why} ${named.text}`),
        'and a server from before, sending the killer\'s Riot ID, has no name painted: the killer is an agent or none',
        `read "${named.title}" | "${named.why}"`);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  // ONE MATCH, from a review's eye (8.2): the AI log opens on that match's
  // frames alone, in death review mode, with no picker and "Whole session" in
  // its place; gone, it says so plainly; sealed mid match, it shows nothing.
  // Main is stood in for by the store it reads with, as main calls it.
  await section('the AI log opened on one match, from its review\'s eye:', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'occlara-surfaces-scope-'));
    try {
      const jpeg = Buffer.from('ffd8ffe000104a464946', 'hex');
      const M1 = Date.UTC(2026, 9, 1, 18, 0, 0);
      const E1 = M1 + 1800000;
      const M2 = E1 + 4;
      const alive = { map: 'Abyss', playerAlive: true, playerHp: 100, teamScore: 3, enemyScore: 2 };
      const dead = { map: 'Abyss', playerAlive: false, phase: 'dead', aliveTell: 'killed by Jett, spectating a teammate', teamScore: 3, enemyScore: 2 };
      const write = (name, recs, mtime) => {
        const dir = path.join(root, name);
        fs.mkdirSync(dir, { recursive: true });
        // `died` as the engine writes it, on the frame it registered a death on.
        const records = recs.map(([at, state, match, died], i) => {
          const frame = `frame-${String(i).padStart(5, '0')}.jpg`;
          fs.writeFileSync(path.join(dir, frame), jpeg);
          return { i, at, frame, state, round: 4, died: died === true, match };
        });
        fs.writeFileSync(path.join(dir, 'log.json'), JSON.stringify({ startedAt: records[0].at, records }));
        fs.utimesSync(dir, mtime / 1000, mtime / 1000);
        return dir;
      };
      // Three matches in one session: two frames of one before, five of the
      // match the review is of, three of the one after. So the review's frames
      // are not where they sit in the whole session.
      const sid = 'session-2026-10-01T17-29-00-000Z';
      const M0 = M1 - 1800000;
      const dir = write(sid, [
        [M0 + 60000, alive, M0], [M0 + 70000, alive, M0],
        [M1 + 60000, alive, M1], [M1 + 70000, alive, M1], [M1 + 80000, dead, M1, true], [M1 + 90000, dead, M1], [E1 - 30000, alive, M1],
        [M2 + 60000, alive, M2], [M2 + 70000, alive, M2], [M2 + 80000, alive, M2],
      ], M2 + 80000);
      write('session-2026-09-30T10-00-00-000Z', [[M1 - 86400000, alive, M1 - 86400000], [M1 - 86000000, alive, M1 - 86400000]], M1 - 86000000);
      const place1 = aiLogStore.placeOf(dir, M1, E1);
      const place2 = aiLogStore.placeOf(dir, M2, M2 + 600000);
      // What main knows: the session being recorded, and whether a match is
      // being played. And, for one test, a reply main no longer gives.
      let live = null;
      let sealed = false;
      let unscoped = null;
      const open = async (target) => {
        const a = loadSurface('ailog', {
          handlers: {
            // As main answers it (index.js getAiLog): strict with a scope, the
            // number of sessions the log keeps beside it, sealed mid match on
            // the session being recorded; and a whole session through serve(),
            // with the seal decided on the session it serves.
            [C.AILOG_GET]: (id, scope) => {
              if (scope) {
                return sealed && id === live ? { records: [], sessions: [], scoped: true, sealed: true, keeps: 5 }
                  : { ...aiLogStore.read(root, id, live, scope), keeps: 5 };
              }
              if (unscoped) return unscoped(id);
              const log = aiLogStore.serve(root, id, live, sealed);
              return log.gone ? { ...log, keeps: 5 } : log;
            },
            [C.AILOG_CONFIRM]: () => ({ status: 'unavailable' }),
            [C.AILOG_ASK]: () => ({ reply: 'You peeked alone.' }),
            [C.CONFIG_GET]: () => ({ ailogHintSeen: 3 }),
          },
          window: { location: { hash: `#${typeof target === 'string' ? target : encodeURIComponent(JSON.stringify(target))}`, search: '' } },
        });
        await settle();
        return a;
      };
      const shown = (a) => ({ frames: Number(a.$('slider').max) + 1, at: Number(a.$('slider').value), picker: !a.$('session').hidden,
        whole: !a.$('whole').hidden, main: !a.$('main').hidden, empty: a.$('empty').hidden ? '' : a.$('empty').textContent,
        pos: a.$('death-pos').textContent, sub: a.$('subtitle').textContent });

      const a = await open({ scope: place1 });
      let s = shown(a);
      ok(s.main && s.frames === 5 && /^5 frames of this match, /.test(s.sub) && /, 1 death$/.test(s.sub),
        'it shows that match\'s five frames and none of the next match\'s three', JSON.stringify(s));
      ok(s.at === 2 && s.pos === 'Death 1 of 1', 'in death review mode, on the match\'s first death', JSON.stringify(s));
      ok(!s.picker && s.whole, 'with no session picker, and "Whole session" in its place', JSON.stringify(s));
      const confirmed = a.bridge.invoked.filter((x) => x[0] === C.AILOG_CONFIRM);
      ok(confirmed.length === 1 && confirmed[0][1] === sid && same(confirmed[0][2], place1),
        'Riot\'s check is asked about this match\'s frames, not the session\'s', JSON.stringify(confirmed));
      // A question about the frame on screen names the match, because the index
      // counts its frames and not the session's.
      a.$('ask-input').value = 'Why did I die here?';
      a.fire(a.$('ask-form'), 'submit');
      await settle();
      const asked = a.bridge.invoked.filter((x) => x[0] === C.AILOG_ASK).map((x) => x[1]);
      ok(asked.length === 1 && asked[0].session === sid && same(asked[0].scope, place1) && asked[0].index === 2,
        'a question about the frame names the match it is counted in', JSON.stringify(asked));

      a.$('whole').click();
      await settle();
      s = shown(a);
      ok(s.frames === 10 && s.at === 4 && !s.whole && /frames from /.test(s.sub),
        '"Whole session" opens the whole session, on the frame that was on screen', JSON.stringify(s));
      ok(s.picker, 'and the picker is back, since there is a session to pick again');
      ok(a.$('ask-log').textContent.includes('You peeked alone.'), 'with the frame\'s conversation still under it, keyed by the frame and not its place');

      // An open window is moved to another match by AILOG_SHOW.
      a.bridge.emit(C.AILOG_SHOW, { scope: place2 });
      await settle();
      s = shown(a);
      ok(s.frames === 3 && s.at === 0 && s.whole && !s.picker && /^3 frames of this match, /.test(s.sub),
        'moved to a match with no death, it opens on that match\'s first frame', JSON.stringify(s));

      // AT ONE MOMENT (8.2): the eye on a death a review looked at names when
      // its frame was captured, and the match opens on that frame rather than
      // on its first death.
      a.bridge.emit(C.AILOG_SHOW, { scope: place1, at: M1 + 70000 });
      await settle();
      s = shown(a);
      ok(s.frames === 5 && s.at === 1 && s.whole && s.pos === '1 death',
        'moved to a moment of a match, it opens on the frame captured then, its one death counted in words', JSON.stringify(s));
      const atMoment = await open({ scope: place1, at: M1 + 71500 });
      s = shown(atMoment);
      ok(s.main && s.frames === 5 && s.at === 1 && !s.picker && s.whole,
        'opened at a moment between two frames, it shows the nearer, in the match alone', JSON.stringify(s));
      atMoment.$('death-next').click();
      ok(shown(atMoment).at === 2 && shown(atMoment).pos === 'Death 1 of 1', 'and the death it led to is the next one on');
      const notATime = await open({ scope: place1, at: 'soon' });
      ok(shown(notATime).at === 2 && shown(notATime).pos === 'Death 1 of 1', 'a moment that is not a time opens on the first death, as before');

      // GONE, said plainly, and never another session's frames in their place.
      const GONE = /no longer has this match\. It keeps your last 5 recording sessions, and the review keeps the frames the coach looked at\.$/;
      ok(GONE.test('The AI log no longer has this match. It keeps your last 5 recording sessions, and the review keeps the frames the coach looked at.'),
        'the gone line detector matches the line');
      for (const [what, target] of [['main found no kept session', { scope: { gone: true } }],
        ['its session was pruned', { scope: { ...place1, session: 'session-2026-09-01T10-00-00-000Z' } }],
        ['its scope is not a match', { scope: { session: sid, match: 'x' } }],
        ['its hash cannot be read', '%7Bbroken']]) {
        const g = await open(target);
        const gs = shown(g);
        ok(!gs.main && GONE.test(gs.empty) && !gs.picker && !gs.whole, `${what}: it says the log keeps your last 5 sessions and the review its frames`,
          JSON.stringify(gs));
        ok(!DASHES.test(gs.empty), `${what}: with no dash`);
      }
      live = sid;
      sealed = true;
      const z = await open({ scope: place1 });
      const zs = shown(z);
      ok(!zs.main && /A match is being played, so this session's AI log stays closed until it ends\./.test(zs.empty) && !zs.picker && !zs.whole,
        'sealed mid match, it shows no frame and says when it opens', JSON.stringify(zs));
      sealed = false;
      live = null;
      // A session id in the hash still opens a whole session, as it always has.
      const w = await open('session-2026-09-30T10-00-00-000Z');
      ok(shown(w).frames === 2 && !shown(w).whole, 'a session id in the hash still opens that whole session');

      // WHOLE SESSION IS STRICT (8.2): the session the match was in, or the
      // reason it is not here, and never another session's frames under its
      // name. The session being recorded is the newest folder, as it is while
      // it is written, and its frames share their file names with the match's
      // own session's, since a name is a counter of each session's own.
      const SEALED = /^A match is being played, so this session's AI log stays closed until it ends\.$/;
      const GONE_PLAIN = /^The AI log no longer has this match\. It keeps only your most recent recording sessions, and the review keeps the frames the coach looked at\.$/;
      const GONE_PICKED = /^The AI log no longer has that session\. It keeps your last 5 recording sessions\.$/;
      ok(SEALED.test("A match is being played, so this session's AI log stays closed until it ends.")
        && GONE_PLAIN.test('The AI log no longer has this match. It keeps only your most recent recording sessions, and the review keeps the frames the coach looked at.')
        && GONE_PICKED.test('The AI log no longer has that session. It keeps your last 5 recording sessions.'),
      'the sealed and gone line detectors match their lines');
      const recording = 'session-2026-10-02T09-00-00-000Z';
      write(recording, Array.from({ length: 7 }, (_v, k) => [M2 + 3600000 + k * 10000, alive, M2 + 3600000]), M2 + 3700000);
      const optionIds = (a) => a.document.querySelectorAll('#session option').map((o) => o.value);

      // Mid match, on a match of a finished session: that session, and the
      // one being recorded in none of its lists.
      live = recording;
      sealed = true;
      const fin = await open({ scope: place1 });
      fin.$('whole').click();
      await settle();
      s = shown(fin);
      ok(s.main && s.frames === 10 && s.at === 4 && !s.whole, 'mid match, Whole session on a finished session shows it, on the frame that was on screen', JSON.stringify(s));
      ok(same(optionIds(fin), [sid, 'session-2026-09-30T10-00-00-000Z']), 'and its picker lists no session being recorded', JSON.stringify(optionIds(fin)));
      sealed = false;

      // Between matches the eye opens a match of the session being recorded,
      // and then the next match begins: main answers Whole session with the
      // newest finished session, marked sealed, which is not this one.
      live = sid;
      const rec = await open({ scope: place1 });
      ok(shown(rec).main && shown(rec).whole, 'between matches the eye opens a match of the session being recorded');
      sealed = true;
      rec.$('whole').click();
      await settle();
      s = shown(rec);
      ok(!s.main && SEALED.test(s.empty) && !s.picker && !s.whole,
        'pressed once the next match began, Whole session shows no frame, of its session or of the one main answers with, and says when it opens', JSON.stringify(s));
      sealed = false;
      live = null;

      // A reply that is another session, as main once served the newest folder
      // for a session pruned while the window was open: the gone line, never
      // that session's frames, nor its frame of the same file name.
      unscoped = () => aiLogStore.read(root, recording);
      const other = await open({ scope: place1 });
      other.$('whole').click();
      await settle();
      s = shown(other);
      ok(!s.main && GONE_PLAIN.test(s.empty) && !s.picker && !s.whole,
        'a reply that is another session paints the gone line, not that session at its frame of the same name', JSON.stringify(s));
      unscoped = null;

      // Its session pruned at a Start while the window was open: main has it
      // gone, and so does the window.
      const pruned = await open({ scope: place1 });
      fs.rmSync(dir, { recursive: true, force: true });
      pruned.$('whole').click();
      await settle();
      s = shown(pruned);
      ok(!s.main && GONE.test(s.empty) && !s.picker && !s.whole, 'its session pruned while the window was open, Whole session says the log no longer has it', JSON.stringify(s));

      // A session picked after it was pruned, since the picker was painted:
      // the reason, and the picker to choose again with nothing in it chosen.
      const pick = await open('session-2026-09-30T10-00-00-000Z');
      ok(shown(pick).main && same(optionIds(pick), [recording, 'session-2026-09-30T10-00-00-000Z']), 'a session is open, with the picker listing two');
      fs.rmSync(path.join(root, recording), { recursive: true, force: true });
      pick.$('session').value = recording;
      pick.fire(pick.$('session'), 'change');
      await settle();
      s = shown(pick);
      ok(!s.main && GONE_PICKED.test(s.empty) && s.picker && same(optionIds(pick), ['session-2026-09-30T10-00-00-000Z']) && pick.$('session').value === '',
        'a session picked after it was pruned says so, with the picker to choose again and none of it chosen', JSON.stringify({ ...s, options: optionIds(pick) }));
      ok(!DASHES.test(s.empty), 'with no dash');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  await section('the activation screen:', () => {
    const REAL_TIME = /real[- ]?time/i;
    ok(REAL_TIME.test('Real-time Valorant AI coaching'), 'the real time detector matches the line it replaced');
    ok(DASHES.test(`a${String.fromCharCode(0x2014)}b`) && DASHES.test(`a${String.fromCharCode(0x2013)}b`) && !DASHES.test('a-b'),
      'the dash detector matches both banned dashes and not a hyphen');
    const doc = new Document(fs.readFileSync(path.join(RENDERER, 'activation', 'index.html'), 'utf8'));
    const sub = (doc.querySelector('.logo .sub') || { textContent: '' }).textContent;
    ok(/post-match/i.test(sub) && ['Valorant', 'League of Legends'].every((g) => sub.includes(g)) && !/Rivals|Marvel/.test(sub),
      'it sells post-match coaching for both games, Valorant and League of Legends, and no other', `read "${sub}"`);
    ok(!REAL_TIME.test(sub) && !DASHES.test(sub), 'with no real time claim and no dash');
  });

  // TWO GAMES, VALORANT AND LEAGUE OF LEGENDS. Marvel Rivals is no longer
  // coached, and no page, stylesheet or script under src/renderer names it,
  // its publisher or its heroes any more: copy that comes back with a page
  // would sell a game the app does not coach.
  await section('no page names a game Occlara no longer coaches:', () => {
    const RETIRED_WORDS = /rivals|marvel|netease|luna snow|strategist|vanguard/i;
    const named = (line) => RETIRED_WORDS.test(line.replace(/arrivals?/gi, ''));
    ok(named('Marvel Rivals') && named('data-game="rivals"') && named('a Strategist') && named('NetEase Games')
      && !named('Valorant and League of Legends') && !named('the frames arrivals sorted'),
    'the detector finds the game, its id, its publisher and its roles, and passes over the two games and "arrivals"');
    const hits = [];
    const walk = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) { walk(p); continue; }
        if (!/[.](html|js|css)$/.test(e.name)) continue;
        fs.readFileSync(p, 'utf8').split('\n').forEach((line, i) => {
          // "arrivals" carries the letters and is no game.
          if (named(line)) hits.push(`${path.relative(ROOT, p)}:${i + 1}`);
        });
      }
    };
    walk(RENDERER);
    ok(!hits.length, 'none of src/renderer names it', hits.slice(0, 8).join(', '));
  });

  // THE KEY IN THE SHAPE IT HAS (8.3.2). The box showed XXXX-XXXX-XXXX-XXXX,
  // and a key typed that way, with no GC-, was refused as an invalid format,
  // as was one pasted with spaces in it. A key is put in its one shape before
  // it is sent (activation/key.js), held here against the server's own
  // KEY_REGEX, read out of server/routes/license.js so the two cannot drift.
  await section('the activation box sends a key in its one shape, however it was typed or pasted:', async () => {
    const licSrc = fs.readFileSync(path.join(ROOT, 'server', 'routes', 'license.js'), 'utf8');
    const lit = /const KEY_REGEX = \/(.+)\/;/.exec(licSrc);
    const SERVER_KEY = lit ? new RegExp(lit[1]) : null;
    ok(!!SERVER_KEY && SERVER_KEY.test('GC-AB12-CD34-EF56-GH78') && !SERVER_KEY.test('AB12-CD34-EF56-GH78') && !SERVER_KEY.test('gc-ab12-cd34-ef56-gh78'),
      'the server\'s KEY_REGEX, read from its source, takes GC- and four groups of four and nothing else', lit ? lit[1] : 'not found');
    const open = async () => {
      const q = loadSurface('activation', { handlers: { [C.LICENSE_ACTIVATE]: () => ({ ok: true, valid: false, error: 'License key not found' }) } });
      await settle();
      return q;
    };
    const sentKeys = (q) => q.bridge.invoked.filter(([ch]) => ch === C.LICENSE_ACTIVATE).map(([, k]) => k);
    const submit = async (q, typed) => {
      q.$('key').value = typed;
      q.fire(q.$('form'), 'submit');
      await settle();
      const keys = sentKeys(q);
      return { sent: keys[keys.length - 1], shown: q.$('key').value, count: keys.length };
    };
    const p = await open();
    const placeholder = p.$('key').getAttribute('placeholder');
    ok(placeholder === 'GC-XXXX-XXXX-XXXX-XXXX' && !!SERVER_KEY && SERVER_KEY.test(placeholder.replace(/X/g, 'A')),
      'the box shows the shape every key has, GC-XXXX-XXXX-XXXX-XXXX', placeholder);
    const KEY = 'GC-AB12-CD34-EF56-GH78';
    const fullWidth = (s) => [...s].map((c) => String.fromCharCode(c.charCodeAt(0) + 0xFEE0)).join('');
    const forms = [
      ['as it is', KEY],
      ['in lower case', 'gc-ab12-cd34-ef56-gh78'],
      ['without the GC- the old box left out', 'AB12-CD34-EF56-GH78'],
      ['with spaces for its dashes', 'GC AB12 CD34 EF56 GH78'],
      ['with spaces and a line break around it, from an email', '  gc-ab12-cd34-ef56-gh78 \n'],
      ['with spaces and no GC-', 'ab12 cd34 ef56 gh78'],
      ['with no dashes', 'GCAB12CD34EF56GH78'],
      ['with no GC and no dashes', 'AB12CD34EF56GH78'],
      ['spaced out around its dashes', 'GC - AB12 - CD34 - EF56 - GH78'],
      ['in full width characters', fullWidth(KEY)],
    ];
    for (const [how, typed] of forms) {
      const r = await submit(await open(), typed);
      ok(r.sent === KEY && !!SERVER_KEY && SERVER_KEY.test(r.sent) && r.shown === KEY && r.count === 1,
        `a key typed ${how} is sent as ${KEY}, which the server takes, and the box shows it`,
        `typed ${JSON.stringify(typed)}, sent ${JSON.stringify(r.sent)}, box ${JSON.stringify(r.shown)}`);
    }
    // A key whose own sixteen start with GC, typed without the prefix, keeps them.
    const gcBody = await submit(await open(), 'GCAB-CD34-EF56-GH78');
    ok(gcBody.sent === 'GC-GCAB-CD34-EF56-GH78', 'a key whose own letters start with GC keeps them', JSON.stringify(gcBody.sent));
    const part = await submit(await open(), ' gc-ab12-cd34 ');
    ok(part.sent === 'GC-AB12-CD34', 'text that is not a whole key is sent as typed, trimmed and upper cased, for the server to say so', JSON.stringify(part.sent));
    const empty = await open();
    const none = await submit(empty, '   ');
    ok(none.count === 0 && !empty.$('error').hidden && empty.$('error').textContent === 'Enter your license key.',
      'an empty box sends nothing and asks for the key', empty.$('error').textContent);
    // As it is typed and pasted, with the caret at the end.
    const typing = await open();
    const input = (value, extra) => {
      const box = typing.$('key');
      box.value = value;
      box.selectionStart = value.length;
      typing.fire(box, 'input', extra);
      return box.value;
    };
    ok(input(' gc ab12-cd', { inputType: 'insertText' }) === 'GCAB12-CD', 'typed, it is upper cased and its spaces dropped, as before', typing.$('key').value);
    ok(input('GCAB12CD34EF56GH', { inputType: 'insertText' }) === 'GCAB12CD34EF56GH',
      'typed, sixteen characters with GC in front are not cut into a key two characters early', typing.$('key').value);
    ok(input(' gc ab12 cd34 ef56 gh78 ', { inputType: 'insertFromPaste' }) === KEY,
      'a whole key pasted is put in its shape at once, so the box shows what will be sent', typing.$('key').value);
    ok(input('ab12 cd34', { inputType: 'insertFromPaste' }) === 'AB12CD34', 'part of a key pasted is only cleaned, as typing is', typing.$('key').value);
    ok(input('gc', { inputType: 'insertCompositionText', isComposing: true }) === 'gc', 'an input method still composing is left alone', typing.$('key').value);
    ok(p.scripts.indexOf('key.js') !== -1 && p.scripts.indexOf('key.js') < p.scripts.indexOf('activation.js'),
      'key.js is loaded before activation.js', p.scripts.join(', '));
    const rules = require('../src/renderer/activation/key');
    ok(rules.PLACEHOLDER === placeholder && !!SERVER_KEY && rules.SHAPE.source === SERVER_KEY.source,
      'key.js\'s shape is the server\'s, and its placeholder the box\'s', `${rules.SHAPE.source} | ${SERVER_KEY && SERVER_KEY.source}`);
  });

  // THE NOTICE THE GAMES' OWNER ASKS FOR (8.3.2), under the version line in
  // Settings: Riot's in exactly its own words, which its policy asks for where
  // players can readily see it. Both games are Riot's: the line for NetEase
  // and Marvel went with Marvel Rivals.
  await section('Settings, the games\' owner\'s notice under the version:', async () => {
    const RIOT = "Occlara isn't endorsed by Riot Games and doesn't reflect the views or opinions of Riot Games or anyone officially involved in producing or managing Riot Games properties. Riot Games, and all associated properties are trademarks or registered trademarks of Riot Games, Inc.";
    const se = loadSurface('settings', {
      handlers: {
        [C.CONFIG_GET]: () => ({ game: 'valorant', language: 'en', devGames: false }),
        [C.LICENSE_GET]: () => ({}), [C.STATE_GET]: () => ({}),
        [C.APP_VERSION]: () => ({ current: '8.3.2', state: 'current' }),
      },
    });
    await settle();
    const riot = se.$('legal-riot');
    ok(!!riot && riot.textContent === RIOT, 'Riot\'s notice, word for word', riot ? riot.textContent : 'missing');
    ok(!se.$('legal-netease') && !/NetEase|Marvel/.test(se.document.querySelector('section.wip').textContent),
      'and no line for NetEase or Marvel, whose game Occlara no longer coaches');
    const box = se.document.querySelector('section.wip');
    const lines = box ? box.querySelectorAll('.wip-line') : [];
    const iVer = lines.findIndex((l) => l.classList.contains('ver'));
    ok(iVer !== -1 && lines[iVer + 1] === riot && lines.length === iVer + 2,
      'under the version line, the last line of its box', lines.map((l) => l.className).join(' | '));
    ok(se.$('version').textContent === 'Version 8.3.2', 'the version line above it still paints', se.$('version').textContent);
    ok(!!riot && riot.classList.contains('legal') && !riot.hasAttribute('data-i18n') && !riot.hidden,
      'shown, and never translated: Riot asks for these words');
    const css = fs.readFileSync(path.join(RENDERER, 'settings', 'settings.css'), 'utf8');
    const rule = /\.wip-line\.legal\s*\{([^}]*)\}/.exec(css);
    const lineRule = /\.wip-line\s*\{([^}]*)\}/.exec(css);
    const px = (r) => { const m = r && /font-size:\s*([\d.]+)px/.exec(r[1]); return m ? Number(m[1]) : NaN; };
    ok(!!rule && /color:\s*var\(--text-mute\)/.test(rule[1]) && px(rule) <= px(lineRule),
      'in the theme\'s muted small type, no bigger than the lines above it', rule ? rule[1].trim() : 'no .wip-line.legal rule');
    ok(!DASHES.test(RIOT), 'with no dash');
  });

  // MANAGE SUBSCRIPTION OPENS THE ACCOUNT PAGE (8.3.2). Settings and the
  // licence window send OPEN_PURCHASE, and main's own handler
  // (register-ipc.js, run here with electron stood in for) opens the URL with
  // it, which was the home page.
  await section('Manage subscription opens the account page:', async () => {
    const se = loadSurface('settings', {
      handlers: {
        [C.CONFIG_GET]: () => ({ game: 'valorant', language: 'en', devGames: false }),
        [C.LICENSE_GET]: () => ({}), [C.STATE_GET]: () => ({}),
        [C.APP_VERSION]: () => ({ current: '8.3.2', state: 'current' }),
      },
    });
    await settle();
    se.$('purchase').click();
    const act = loadSurface('activation', { handlers: {} });
    await settle();
    act.$('purchase').click();
    const asked = (q) => q.bridge.sent.filter(([ch]) => ch === C.OPEN_PURCHASE).length;
    ok(se.$('purchase').textContent === 'Manage subscription' && asked(se) === 1 && asked(act) === 1,
      'Settings\' Manage subscription and the licence window\'s Get one ask main for it, over OPEN_PURCHASE');
    const Module = require('module');
    const file = require.resolve('../src/main/ipc/register-ipc');
    const on = {};
    const opened = [];
    const electron = {
      ipcMain: { handle() {}, on: (ch, fn) => { on[ch] = fn; } },
      shell: { openExternal: (url) => { opened.push(url); return Promise.resolve(); } },
    };
    const stubs = { '../services/store': { get: () => undefined, set() {} }, '../updater': {}, '../services/pc-check': {} };
    const realLoad = Module._load;
    Module._load = function stand(request, parent, ...rest) {
      if (request === 'electron') return electron;
      if (parent && parent.filename === file && Object.prototype.hasOwnProperty.call(stubs, request)) return stubs[request];
      return realLoad.call(this, request, parent, ...rest);
    };
    try {
      delete require.cache[file];
      require(file)({ controller: {}, license: {} });
    } finally {
      Module._load = realLoad;
      delete require.cache[file];
    }
    if (on[C.OPEN_PURCHASE]) on[C.OPEN_PURCHASE]({});
    ok(opened.length === 1 && opened[0] === 'https://occlara.app/account',
      'main opens the account page, https://occlara.app/account, never the home page', JSON.stringify(opened));
    // The licence window's "Get one" is for somebody with no key, often no
    // account: the account page would open on its Log in tab.
    if (on[C.OPEN_PURCHASE]) { on[C.OPEN_PURCHASE]({}, 'signup'); on[C.OPEN_PURCHASE]({}, 'https://evil.example'); }
    ok(opened[1] === 'https://occlara.app/signup' && opened[2] === 'https://occlara.app/account',
      'asked for the sign up page it opens that, and anything else a page sends is the account page, never a URL it names',
      JSON.stringify(opened.slice(1)));
    const actPre = fs.readFileSync(path.join(ROOT, 'src', 'preload', 'activation-preload.js'), 'utf8');
    const setPre = fs.readFileSync(path.join(ROOT, 'src', 'preload', 'settings-preload.js'), 'utf8');
    ok(/openPurchase:\s*\(\)\s*=>\s*ipcRenderer\.send\(C\.OPEN_PURCHASE,\s*'signup'\)/.test(actPre)
      && /openPurchase:\s*\(\)\s*=>\s*ipcRenderer\.send\(C\.OPEN_PURCHASE\)/.test(setPre),
    'the licence window asks for the sign up page, Settings for the account page');
  });

  // ALL RIGHTS RESERVED (8.3.2). The repo is public, and package.json said
  // MIT with no LICENSE beside it. And the installer, which ships assets/**,
  // carried 58 agent pictures in assets/agents that nothing in the app has
  // drawn since the tips went in 8.0: Riot's art, in a paid app, for nothing.
  await section('the code is all rights reserved, and the installer ships no agent art:', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    ok(pkg.license === 'UNLICENSED', 'package.json\'s license is UNLICENSED, not MIT', pkg.license);
    const licFile = path.join(ROOT, 'LICENSE');
    const lic = fs.existsSync(licFile) ? fs.readFileSync(licFile, 'utf8') : '';
    ok(/^Copyright \(c\) 2026 lowful\. All rights reserved\./.test(lic) && /No license is granted to use,\s+copy, modify or distribute/.test(lic)
      && /written permission/.test(lic) && !DASHES.test(lic),
    'LICENSE says all rights reserved, and grants no use, copy, change or distribution without written permission', lic.split('\n')[0] || 'no LICENSE');
    // Read alone, "no license is granted to use" took back from every paying
    // customer the very license to install and use the app that the Terms of
    // Service (section 4) grant them, so the LICENSE names that one exception.
    ok(/license to install and use the Occlara app that the\s+Occlara Terms of Service \(https:\/\/occlara\.app\/terms\) grant to its customers/.test(lic),
      'and names the one exception, the license the Terms of Service grant customers to install and use the app',
      lic.replace(/\r?\n/g, ' ').slice(-160));
    ok(!fs.existsSync(path.join(ROOT, 'assets', 'agents')),
      'assets/agents is gone, and the installer ships no agent art');
    // And nothing writes it back: sync:valorant downloaded the kill feed
    // portraits on every run, and sync:busts the busts.
    const sync = fs.readFileSync(path.join(ROOT, 'scripts', 'sync-valorant-data.js'), 'utf8');
    ok(!/killfeedPortrait|'assets',\s*'agents'/.test(sync) && !pkg.scripts['sync:busts']
      && !fs.existsSync(path.join(ROOT, 'scripts', 'sync-agent-busts.js')),
    'and no sync script downloads agent art into assets again (sync:valorant fetches none, sync:busts is gone)');
  });

  // MOVING BETWEEN PAGES (8.2). A page of the main window arms before it is
  // shown, says when that frame is painted, and comes in when main says so
  // (main-window.js, check:mainwindow carries it out on real views). Every
  // page loads embed.js and has the motion on its bridge.
  await section('moving between pages: a page arms, says it is ready, and comes in:', async () => {
    const { PAGES } = require('../src/shared/shell-nav');
    for (const p of PAGES) {
      const html = fs.readFileSync(path.join(RENDERER, p.surface, 'index.html'), 'utf8');
      const head = html.slice(0, html.indexOf('</head>'));
      const iEmbed = head.indexOf('src="../shared/embed.js"');
      ok(iEmbed !== -1 && iEmbed < head.indexOf('<link rel="stylesheet"'), `${p.id}: embed.js runs in <head>, before its first paint`);
      const b = loadPreload(p.preload.replace('-preload.js', ''), {});
      const heard = [];
      if (b.api && typeof b.api.onPage === 'function') b.api.onPage((m) => heard.push(m.phase));
      b.emit(C.PUSH_PAGE, { phase: 'arm', dir: 'forward' });
      if (b.api && typeof b.api.pageReady === 'function') b.api.pageReady(p.id);
      ok(same(heard, ['arm']) && same(b.sent, [[C.PAGE_READY, p.id]]),
        `${p.id}: its bridge hears PUSH_PAGE and says PAGE_READY by its id`, `heard ${heard} sent ${JSON.stringify(b.sent)}`);
    }

    const at = Date.UTC(2026, 9, 1, 20);
    const homeRows = [70, 82].map((score, i) => ({ id: `h${i}`, at: at - i * 3600000, title: 'Jett', map: 'Abyss',
      result: 'Victory', score: '13-11', grade: { score, letter: grade.letter(score) } }));
    const homeHandlers = {
      [C.STATE_GET]: () => ({ ...BASE }), [C.CONFIG_GET]: () => ({ language: 'en' }),
      [C.REVIEWS_LIST]: () => homeRows,
      [C.PATTERNS_GET]: () => ({ matches: 2, enough: true, mistakes: [], strengths: [], missed: [],
        grades: homeRows.map((r) => ({ id: r.id, at: r.at, score: r.grade.score, letter: r.grade.letter })), average: 76, categories: [] }),
      [C.REVIEW_GET]: (id) => ({ id, kind: 'valorant', grade: { score: 70, letter: 'B', categories: [] } }),
    };
    const h = loadSurface('home', { handlers: homeHandlers, window: { location: { hash: '', search: '?embed=1&page=home' } } });
    const root = h.document.documentElement;
    const readies = () => h.bridge.sent.filter((s) => s[0] === C.PAGE_READY);
    const arrived = () => h.document.querySelectorAll('.home .card.card-in');
    ok(root.classList.contains('embedded') && root.classList.contains('page-armed'), 'loaded as a page, it is armed before anything is painted');
    await settle();
    ok(!readies().length, 'and says nothing until two frames have painted that');
    ok(!arrived().length, 'its cards, painted while it is armed, wait to arrive');
    h.clock.flushFrames();
    ok(same(readies(), [[C.PAGE_READY, 'home']]), 'two frames on, it says it is ready, by its own id', JSON.stringify(readies()));
    h.bridge.emit(C.PUSH_PAGE, { phase: 'enter', dir: 'forward' });
    ok(!root.classList.contains('page-armed') && root.dataset.pageDir === 'forward',
      'told to come in from the right, it takes that side first, then comes in');
    const cards = arrived();
    ok(cards.length >= 3 && same(cards.map((c) => c.style.getPropertyValue('--i')), cards.map((_c, i) => String(i))),
      'and its cards arrive one after another as it does', `${cards.length} cards`);
    h.bridge.emit(C.PUSH_PAGE, { phase: 'leave' });
    ok(root.classList.contains('page-leaving'), 'told another page is coming, it fades');
    h.bridge.emit(C.PUSH_PAGE, { phase: 'arm', dir: 'back' });
    ok(root.classList.contains('page-armed') && !root.classList.contains('page-leaving') && root.dataset.pageDir === 'back',
      'armed again, it is invisible on the side it comes back from');
    h.clock.flushFrames();
    ok(readies().length === 2, 'and answers that arm once');
    h.bridge.emit(C.PUSH_PAGE, { phase: 'arm', dir: 'forward' });
    h.bridge.emit(C.PUSH_PAGE, { phase: 'enter', dir: 'forward' });
    h.clock.flushFrames();
    ok(readies().length === 2 && !root.classList.contains('page-armed'), 'an arm answered by an enter before its frames is not answered after');
    // A review saved meanwhile repaints Home; its cards do not arrive again.
    for (const c of arrived()) c.classList.remove('card-in');
    h.bridge.emit(C.PUSH_REVIEWS, { id: 'h0', game: 'valorant' });
    await settle();
    ok(!arrived().length, 'a review saved while it is open repaints it without the cards arriving again');
    h.bridge.emit(C.PUSH_GAME, { id: 'lol', label: 'League of Legends' });
    await settle();
    ok(arrived().length >= 3, 'a change of game brings them in again');

    // A window of its own (no ?embed): never armed, and what waits for it to
    // be on screen runs at once.
    const own = loadSurface('home', { handlers: homeHandlers });
    await settle();
    ok(!own.document.documentElement.classList.contains('page-armed') && own.document.querySelectorAll('.home .card.card-in').length >= 3
      && !own.bridge.sent.some((s) => s[0] === C.PAGE_READY), 'a surface that is not a page is never armed, and never says ready');

    // The CSS it moves by: armed at once, never animated into, and never for
    // good; coming in on the tokens.
    const ui = fs.readFileSync(path.join(RENDERER, 'shared', 'ui.css'), 'utf8');
    const rule = (src, sel) => {
      const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return (src.match(new RegExp(`(?:^|\\n)${esc}\\s*\\{([^}]*)\\}`)) || [])[1] || '';
    };
    const prop = (body, name) => ((body.match(new RegExp(`(?:^|[;\\s])${name}\\s*:\\s*([^;]+);`)) || [])[1] || '').trim();
    ok(/clip:/.test(rule(ui, '.sr-only')) && prop(rule(ui, '.sr-only'), 'position') === 'absolute', 'the rule and property readers find a known rule');
    const armedCss = rule(ui, 'html.page-armed body');
    ok(prop(armedCss, 'opacity') === '0' && prop(armedCss, 'transition') === 'none'
      && prop(armedCss, 'transform') === 'translateX(var(--page-from, 0px))', 'armed: invisible, offset, and with no transition into it', armedCss.trim());
    ok(prop(armedCss, 'animation') === 'page-disarm 0s linear 1.2s forwards' && ui.includes('@keyframes page-disarm { to { opacity: 1; transform: none; } }'),
      'and let in by itself after 1.2 seconds if main never answers');
    ok(prop(rule(ui, 'html.page-armed[data-page-dir="forward"]'), '--page-from') === '12px'
      && prop(rule(ui, 'html.page-armed[data-page-dir="back"]'), '--page-from') === '-12px', 'forward from 12px right, back from 12px left');
    ok(prop(rule(ui, 'html.embedded body'), 'transition') === 'opacity var(--t-med) var(--ease-expo), transform var(--t-med) var(--ease-expo)',
      'coming in is --t-med on --ease-expo, opacity and transform only');
    ok(prop(rule(ui, 'html.page-leaving body'), 'transition') === 'opacity var(--t-fast) var(--ease)', 'leaving fades on --t-fast');
    const CUT = /@media \(prefers-reduced-motion: reduce\) \{\s*html\.page-armed body,\s*html\.page-leaving body \{ opacity: 1; transform: none; \}/;
    ok(CUT.test('@media (prefers-reduced-motion: reduce) {\n  html.page-armed body,\n  html.page-leaving body { opacity: 1; transform: none; }'),
      'the reduced motion reader matches the rule it looks for');
    ok(CUT.test(ui), 'asked for less motion, a page is painted as it is, armed or leaving: a plain cut with no blank frame');
    ok(prop(rule(ui, 'html.embedded .sheet'), 'animation') === 'none', 'and a surface\'s own card entrance does not play on top of it');
  });

  await section('everything that opens, opens and closes in motion:', async () => {
    const ui = fs.readFileSync(path.join(RENDERER, 'shared', 'ui.css'), 'utf8');
    const read = (rel) => fs.readFileSync(path.join(RENDERER, rel), 'utf8');
    const rule = (src, sel) => {
      const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return (src.match(new RegExp(`(?:^|\\n)${esc}\\s*\\{([^}]*)\\}`)) || [])[1] || '';
    };
    const prop = (body, name) => ((body.match(new RegExp(`(?:^|[;\\s])${name}\\s*:\\s*([^;]+);`)) || [])[1] || '').trim();
    ok(prop(rule(ui, '.reveal'), 'grid-template-rows') === '0fr' && prop(rule(ui, '.reveal.open'), 'grid-template-rows') === '1fr'
      && prop(rule(ui, '.reveal'), 'transition') === 'grid-template-rows var(--t-med) var(--ease-expo)'
      && prop(rule(ui, '.reveal > .reveal-clip'), 'overflow') === 'hidden',
    'opening in place is one grid row from 0fr to 1fr on --t-med, its clip hiding the rest');

    // The sidebar's marker: one element, moved to the current page.
    const shellCss = read('shell/shell.css');
    ok(!/background/.test(rule(shellCss, '.nav-item[aria-current="page"]')) && rule(shellCss, '.nav-item[aria-current="page"]').includes('color'),
      'the current item paints no background of its own');
    ok(prop(rule(shellCss, '.nav-marker'), 'transition').startsWith('transform var(--t-med) var(--ease-expo)'), 'the marker slides on --t-med');
    const p = await openShell({ language: 'en' }, {});
    const marker = p.$('nav-marker');
    ok(p.document.querySelectorAll('.nav-marker').length === 1 && marker.getAttribute('aria-hidden') === 'true', 'one marker for the whole sidebar');
    // Layout, which the fake DOM does not do: each item where the sidebar has it.
    const items = p.document.querySelectorAll('.nav-item');
    items.forEach((b, i) => Object.assign(b, { offsetTop: 120 + i * 46, offsetLeft: 12, offsetWidth: 208, offsetHeight: 44 }));
    p.$('nav-settings').offsetTop = 690;
    const top = (id) => p.document.querySelector(`.nav-item[data-page="${id}"]`).offsetTop;
    p.bridge.emit(C.PUSH_SHELL, { page: 'matches', shown: 'matches', sealed: false });
    ok(marker.classList.contains('on') && marker.style.transform === `translate(12px, ${top('matches')}px)` && marker.style.height === '44px',
      'it sits on the current page', marker.style.transform);
    p.bridge.emit(C.PUSH_SHELL, { page: 'stats', shown: 'stats', sealed: false });
    ok(marker.style.transform === `translate(12px, ${top('stats')}px)` && !marker.classList.contains('still'), 'going to another page it slides there');
    p.bridge.emit(C.PUSH_SHELL, { page: 'settings', shown: 'settings', sealed: false });
    ok(marker.style.transform === 'translate(12px, 690px)', 'down to Settings at the foot as well');
    p.bridge.emit(C.PUSH_SHELL, { page: 'settings', shown: null, sealed: true });
    ok(!marker.classList.contains('on'), 'sealed, no page is current and it fades out');
    p.bridge.emit(C.PUSH_SHELL, { page: 'review', shown: 'review', sealed: false });
    ok(marker.classList.contains('on') && marker.classList.contains('still') && marker.style.transform === `translate(12px, ${top('matches')}px)`,
      'unsealed on the review, it appears on Matches, put there rather than slid');
    // THE MARKER FOLLOWS THE RECORD CARD, and with the sidebar overflowing
    // (the window's minimum height) Settings, below it, moves with it. Layout
    // again: Settings under a card as tall as what it shows, which since 8.3
    // is no line and since 8.4.4 no agent check, its two buttons alone.
    const settingsAt = () => 520 + p.$('rec').children.filter((c) => c.className !== 'rec-controls' && !c.hidden).length * 48
      + (p.$('rec').querySelector('p') ? 18 : 0);
    Object.defineProperty(p.$('nav-settings'), 'offsetTop', { get: settingsAt, configurable: true });
    const onSettings = () => marker.style.transform === `translate(12px, ${settingsAt()}px)`;
    const where = () => `marker ${marker.style.transform}, Settings at ${settingsAt()}`;
    p.bridge.emit(C.PUSH_SHELL, { page: 'settings', shown: 'settings', sealed: false });
    ok(onSettings(), 'on Settings, the marker is on it', where());
    const blocked = 'Capture is blocked: Windows will not let Occlara read the screen. Set the game to Windowed Fullscreen and press Start again.';
    const before = settingsAt();
    p.bridge.emit(C.PUSH_STATE, { ...BASE, notice: { text: blocked, at: 1 } });
    ok(p.notice() === blocked && settingsAt() === before && onSettings(),
      'a notice is the top strip\'s (8.3): the card stays as it was, and so do Settings and the marker on it', where());
    p.bridge.emit(C.PUSH_STATE, { ...BASE, notice: null });
    ok(p.notice() === null && settingsAt() === before && onSettings(), 'and stay when it clears', where());
    // Recording Valorant: nothing opens in the card (8.4.4), so Settings
    // stays where it was and so does the marker on it, and a resize of the
    // card still puts the marker back after layout.
    p.bridge.emit(C.PUSH_STATUS, { status: 'coaching' });
    p.bridge.emit(C.PUSH_STATE, { ...BASE, isCoaching: true, status: 'coaching' });
    p.clock.advance(10000);
    p.resized(p.$('rec'));
    ok(settingsAt() === before && onSettings(), 'recording, the card opens nothing and Settings and the marker on it stay put', where());
    ok(prop(rule(shellCss, '.sealed'), 'animation') === 'riseIn var(--t-slow) var(--ease-expo) both',
      'the Recording screen rises in as it appears');

    // A dropdown closes as it opened.
    const se = loadSurface('settings', {
      handlers: {
        [C.CONFIG_GET]: () => ({ game: 'valorant', language: 'en', devGames: false }),
        [C.LICENSE_GET]: () => ({}), [C.STATE_GET]: () => ({}),
        [C.APP_VERSION]: () => ({ current: '8.2.0', state: 'current' }),
      },
    });
    await settle();
    const mount = se.$('gamepick');
    const ddBtn = mount.querySelector('.dd-btn');
    const list = mount.querySelector('.dd-list');
    ddBtn.click();
    ok(!list.hidden && list.parentNode === se.document.body && ddBtn.getAttribute('aria-expanded') === 'true', 'open, the list hangs off body');
    ddBtn.click();
    ok(!list.hidden && list.classList.contains('dd-closing') && ddBtn.getAttribute('aria-expanded') === 'false' && !mount.classList.contains('dd-open'),
      'closed, it is closed to everything but the eye, and fades on screen');
    se.clock.advance(139);
    ok(!list.hidden, 'for --t-fast');
    se.clock.advance(1);
    ok(list.hidden && !list.classList.contains('dd-closing') && list.parentNode === mount, 'then it is hidden, back in its place');
    ddBtn.click();
    ddBtn.click();
    ddBtn.click();
    se.clock.advance(300);
    ok(!list.hidden && !list.classList.contains('dd-closing') && ddBtn.getAttribute('aria-expanded') === 'true',
      'opened again while it closed, it is open, and the close it cut short never hides it');
    const ddCss = read('shared/dropdown.css');
    ok(prop(rule(ddCss, '.dd-list.dd-closing'), 'animation') === 'ddOut var(--t-fast) var(--ease) both'
      && prop(rule(ddCss, '.dd-list.dd-closing'), 'pointer-events') === 'none', 'closing plays ddOut on --t-fast and takes no click');

    // Stats' rank notes open under the tile by height, and close back.
    const session = { id: 'st1', at: Date.UTC(2026, 9, 1, 20), map: 'Abyss', title: 'Jett', grade: { score: 82, letter: grade.letter(82) } };
    const st = loadSurface('stats', {
      handlers: {
        [C.STATS_DASHBOARD]: () => ({ game: 'valorant', statsSupported: true, categories: {},
          rank: { value: 'Gold 2', direction: 'flat' }, winRate: { value: 52, direction: 'up' }, topAgents: [],
          sessions: [session], sessionCount: 1, matches: { matches: [], fetchedAt: 0, mode: 'competitive' }, grading: null, riotId: 'Me#EUW' }),
        [C.STATS_MATCHES]: () => ({ matches: [] }),
        [C.STATS_RANK_HISTORY]: () => ({ points: [] }),
      },
    });
    await settle();
    st.clock.flushFrames();
    const tile = st.document.querySelectorAll('#cards .card').find((c) => /^Rank/.test(c.querySelector('.label').textContent));
    const reveal = st.$('rank-reveal');
    ok(reveal.hidden && reveal.classList.contains('reveal') && st.$('rank-notes').parentNode.classList.contains('reveal-clip'),
      'closed, the notes are nothing at all, inside a reveal');
    tile.click();
    await settle();
    ok(!reveal.hidden && reveal.classList.contains('open') && tile.classList.contains('notes-open')
      && /About Gold/.test(st.$('rank-notes').textContent), 'the rank tile opens its notes by height, its chevron turned over');
    tile.click();
    ok(!reveal.hidden && !reveal.classList.contains('open') && !tile.classList.contains('notes-open'), 'and closes them back in place');
    st.clock.advance(220);
    ok(reveal.hidden, 'hidden once closed');
    tile.click();
    tile.click();
    tile.click();
    st.clock.advance(400);
    ok(!reveal.hidden && reveal.classList.contains('open'), 'opened again while closing, it stays open');
    // A graded match's drop down opens the same way, under its own top line.
    const srow = st.document.querySelector('#session-list .row.session');
    const sReveal = srow && srow.children[1];
    ok(sReveal && sReveal.classList.contains('reveal') && sReveal.querySelector('.reveal-clip > .detail .ask-btn'),
      'a graded match\'s drop down is a reveal under its top line, its buttons inside the clip');
    srow.click();
    ok(srow.classList.contains('open'), 'and a click opens it');
    const scss = read('stats/stats.css');
    ok(prop(rule(scss, '.expandable.open > .reveal'), 'grid-template-rows') === '1fr'
      && !/display:\s*none/.test(rule(scss, '.expandable .detail'))
      && prop(rule(scss, '.expandable > .reveal > .reveal-clip'), 'visibility') === 'hidden'
      && prop(rule(scss, '.expandable > .reveal > .reveal-clip'), 'transition') === 'visibility 0s linear var(--t-med)'
      && prop(rule(scss, '.expandable.open > .reveal > .reveal-clip'), 'visibility') === 'visible',
    'by height on its row\'s open, and closed it is out of reach once the close is through');
    ok(/display:\s*none/.test('a { display: none; }'), 'the display none detector matches a hidden rule');

    // A breakdown row opens in place: no table built again.
    const breakdown = require('../src/shared/breakdown');
    const graded = { score: 70, letter: 'B', provisional: false, categories: [] };
    const bAt = Date.UTC(2026, 9, 1, 20);
    const saved = ['Abyss', 'Abyss', 'Bind', 'Lotus'].map((map, i) => ({ id: `valorant-${bAt - i * 3600000}-mot${i}`, game: 'valorant',
      at: bAt - i * 3600000, review: { kind: 'valorant', source: 'watched', rounds: [], insights: {}, grade: graded,
        game: { map, agent: 'Jett', mode: 'Competitive', result: 'Victory', score: '13-11' },
        scoreline: { acs: 250, adr: 160, headshotPct: 22, kills: 20, deaths: 15, assists: 5 } } }));
    const m = loadSurface('matches', {
      handlers: {
        [C.STATE_GET]: () => ({ gameId: 'valorant' }), [C.REVIEWS_LIST]: () => [],
        [C.PATTERNS_GET]: () => ({ matches: 0, enough: false, grades: [], categories: [], average: null, mistakes: [], strengths: [], missed: [] }),
        [C.BREAKDOWN_GET]: (g, opts) => breakdown.build(g, saved, opts),
      },
    });
    await settle();
    const table = m.$('b-table');
    const rowsBefore = table.querySelectorAll('.b-row');
    const holders = () => table.children.filter((x) => x.classList.contains('b-detail-row'));
    ok(rowsBefore.length === 3, 'three maps, three rows', `${rowsBefore.length}`);
    rowsBefore[0].click();
    const rowsAfter = table.querySelectorAll('.b-row');
    ok(rowsAfter.length === rowsBefore.length && rowsAfter.every((r, i) => r === rowsBefore[i]),
      'opening a row builds nothing again: the same rows, in the same table');
    const first = holders()[0];
    ok(first && first.classList.contains('reveal') && first.classList.contains('open')
      && table.children.indexOf(first) === table.children.indexOf(rowsBefore[0]) + 1
      && rowsBefore[0].getAttribute('aria-expanded') === 'true', 'its detail is put right after it and opens by height');
    const clip = first && first.querySelector('.reveal-clip');
    ok(clip && clip.getAttribute('role') === 'cell' && clip.querySelector('.b-detail .b-dt'), 'the cell is the clip, the box inside it');
    rowsBefore[1].click();
    ok(!first.classList.contains('open') && first.parentNode === table && rowsBefore[0].getAttribute('aria-expanded') === 'false'
      && holders().length === 2 && holders()[1].classList.contains('open'), 'opening another closes the first in place while the second opens');
    m.clock.advance(220);
    ok(!first.parentNode && holders().length === 1, 'and the first is taken out once it has closed');
    rowsBefore[1].click();
    ok(!holders()[0].classList.contains('open') && rowsBefore[1].getAttribute('aria-expanded') === 'false', 'the open row clicked again closes');
    m.clock.advance(220);
    ok(!holders().length, 'and leaves nothing behind');

    // The review's frame zoom scales from where the frame was to where it is.
    const v = loadSurface('review', { handlers: { [C.LOL_REVIEW_GET]: () => ({
      id: 'valorant-1759341600000-zoom01', kind: 'valorant', source: 'watched', aiLog: null,
      game: { map: 'Abyss', agent: 'Jett', result: 'Defeat', score: '11-13' },
      rounds: [{ n: 2, side: 'Defence', result: 'lost', died: true, facts: ['Died at A Site'], reads: [], why: null,
        forensics: { cause: 'dry-peek', what: 'You swung wide.', better: 'Wait.', frames: ['b.jpg', 'a.jpg'], source: 'riot' } }],
      frameData: { 'b.jpg': 'data:image/jpeg;base64,AAAb', 'a.jpg': 'data:image/jpeg;base64,AAAa' },
    }) } });
    await settle();
    const strip = v.document.querySelector('#v-rounds .v-shots');
    const [i0, i1] = strip.querySelectorAll('.v-shot img');
    const f0 = i0.parentNode;
    const box = (left, topPx, width) => ({ left, top: topPx, width, height: width * 9 / 16, x: left, y: topPx, right: left + width, bottom: topPx + width * 9 / 16 });
    i0.getBoundingClientRect = () => (f0.classList.contains('zoom') ? box(0, 0, 810) : box(0, 0, 400));
    i1.getBoundingClientRect = () => (f0.classList.contains('zoom') ? box(0, 470, 400) : box(410, 0, 400));
    let atReflow = null;
    Object.defineProperty(strip, 'offsetWidth', { configurable: true,
      get() { atReflow = [i0, i1].map((i) => `${i.style.transform}|${i.style.transition}`); return 810; } });
    i0.click();
    ok(f0.classList.contains('zoom') && atReflow && atReflow[0].startsWith('translate(0px, 0px) scale(0.49') && atReflow[0].endsWith('|none')
      && atReflow[1] === 'translate(410px, -470px) scale(1)|none', 'zooming, each frame is drawn back where it was first', JSON.stringify(atReflow));
    ok([i0, i1].every((i) => i.style.transform === '' && i.style.transition === ''), 'and then let go, so the transition carries it to its place');
    i0.click();
    ok(!f0.classList.contains('zoom') && atReflow[0].startsWith('translate(0px, 0px) scale(2.02'), 'and back out, scaled down from the zoom');
    const rcss = read('review/review.css');
    ok(prop(rule(rcss, '.v-shot img'), 'transition') === 'transform var(--t-med) var(--ease-expo)'
      && prop(rule(rcss, '.v-shot img'), 'transform-origin') === '0 0', 'on --t-med, from its top left corner');

    // The AI log and the weekly report ease in as their windows open.
    ok(prop(rule(read('ailog/ailog.css'), 'body'), 'animation') === 'sheetIn var(--t-slow) var(--ease-expo) both'
      && read('weekly/weekly.css').includes('.sheet { animation: sheetIn var(--t-slow) var(--ease-expo) both; }')
      && ui.includes('@keyframes sheetIn {'), 'the AI log and the weekly report ease in on --t-slow');
  });

  // getConfig everywhere initI18n runs, or it cannot read the language at all.
  // onState wherever the surface can be open while Settings saves a language,
  // or it never hears about the change. Onboarding is the one exception: it is
  // the first run tour, it sets the language itself and re-runs initI18n after
  // saving it, and nothing else can change the language while it is open.
  await section('every surface that translates itself can read the language:', async () => {
    const CALLS = /\binitI18n\(/;
    const SETS_ITS_OWN = new Set(['onboarding']);
    ok(CALLS.test('window.initI18n(use).then(use)'), 'the detector matches a real call');
    let seen = 0;
    for (const dir of fs.readdirSync(RENDERER, { withFileTypes: true })) {
      if (!dir.isDirectory() || dir.name === 'shared') continue;
      const folder = path.join(RENDERER, dir.name);
      const calls = fs.readdirSync(folder).filter((f) => f.endsWith('.js'))
        .some((f) => CALLS.test(fs.readFileSync(path.join(folder, f), 'utf8')));
      if (!calls) continue;
      seen++;
      const b = loadPreload(dir.name, { [C.CONFIG_GET]: () => ({ language: 'de' }) });
      let channel = null;
      if (b.api && typeof b.api.getConfig === 'function') {
        await b.api.getConfig();
        channel = (b.invoked[b.invoked.length - 1] || [])[0];
      }
      ok(channel === C.CONFIG_GET, `${dir.name}: getConfig on its bridge, over CONFIG_GET`);
      if (!SETS_ITS_OWN.has(dir.name)) {
        ok(b.api && typeof b.api.onState === 'function', `${dir.name}: onState on its bridge, so a change in Settings reaches it`);
      }
    }
    ok(seen >= 3, `found the surfaces that translate themselves (${seen})`);
  });

  // ── Ask Coach (8.5.0): the chip, the starters, the switch, its own lines ───
  // The chip names the match the thread is about, the starters are that
  // match's, a switch starts a thread under a divider, a reply keeps its
  // paragraphs, and the cap, the hold and a match in progress are lines of
  // their own, never a coach's bubble. Main decides all of it (CHAT_MATCHES,
  // CHAT_MATCH, CHAT_SEND); the page names it in the player's language.
  await section('Ask Coach, the chip, the starters, the switch and its own lines:', async () => {
    const LIST = [
      { id: 'valorant-1790000000002-frac01', map: 'Fracture', agent: 'Jett', mode: 'Swiftplay', result: 'Victory', score: '5-1', day: '13 Oct', at: 2 },
      { id: 'valorant-1790000000001-split1', map: 'Split', agent: 'Jett', mode: 'Competitive', result: 'Victory', score: '13-7', day: '4 Oct', at: 1 },
    ];
    const open = async (o) => {
      const sent = [];
      const moves = [];
      const replies = (o && o.replies) || [];
      const answer = (id) => {
        const cur = LIST.find((r) => r.id === id) || null;
        return { game: 'valorant', list: LIST, chosen: id === 'none' ? { id: null, how: 'none' } : { id: (cur || LIST[0]).id, how: id ? 'picked' : 'newest' },
          current: id === 'none' ? null : (cur || LIST[0]), starters: id === 'none' ? null : { walk: cur && cur.map === 'Split' ? 4 : 5, agent: 'Jett', map: (cur || LIST[0]).map, riotOnly: false, lol: false } };
      };
      const ch = loadSurface('chat', {
        handlers: {
          [C.CONFIG_GET]: () => ({ language: 'en', game: 'valorant' }),
          [C.CHAT_MATCHES]: () => answer((o && o.chosen) || null),
          [C.CHAT_MATCH]: (id) => { moves.push(id); return answer(id); },
          [C.CHAT_SEED]: () => (o && o.seed) || null,
          [C.CHAT_SEND]: (messages, opts) => { sent.push({ messages, opts }); return replies.shift() || { ok: true, reply: 'A reply.' }; },
        },
      });
      await settle(12);
      ch.sent = sent;
      ch.moves = moves;
      ch.bubbles = () => ch.document.querySelectorAll('.msg').map((m) => ({ who: m.classList.contains('user') ? 'user' : 'coach', text: m.textContent }));
      ch.lines = () => ch.document.querySelectorAll('.chat-line').map((l) => ({ kind: l.className, text: l.textContent }));
      ch.dividers = () => ch.document.querySelectorAll('.chat-divider').map((d) => d.textContent);
      ch.starters = () => ch.document.querySelectorAll('#starters .starter').map((b) => b.textContent);
      return ch;
    };
    const page = await open();
    ok(page.document.querySelector('#match-pick .dd-text').textContent === 'Fracture, Jett, won 5 to 1, 13 Oct', 'THE CHIP NAMES ITS MATCH: map, agent, result and day');
    page.document.querySelector('#match-pick .dd-btn').click();
    const opts = page.document.querySelectorAll('.dd-opt').map((x) => [x.getAttribute('data-value'), x.textContent]);
    ok(JSON.stringify(opts) === JSON.stringify([[LIST[0].id, 'Fracture, Jett, won 5 to 1, 13 Oct'], [LIST[1].id, 'Split, Jett, won 13 to 7, 4 Oct'], ['none', 'No match, general questions']]),
      'its list is the ten newest and "No match, general questions"', JSON.stringify(opts));
    ok(JSON.stringify(page.starters()) === JSON.stringify(['Walk me through round 5', 'What should I change on Jett?', 'Where am I losing rounds?']),
      'THE STARTERS ARE THE MATCH\'S', JSON.stringify(page.starters()));
    // The switch: a new thread under a divider naming the match.
    page.fire(page.document.querySelector(`.dd-opt[data-value="${LIST[1].id}"]`), 'mousedown');
    await settle(8);
    page.clock.advance(300);
    ok(page.moves[0] === LIST[1].id && JSON.stringify(page.dividers()) === JSON.stringify(['Now about your Split win, 4 Oct']),
      'THE SWITCH STARTS A NEW THREAD UNDER ONE LINE', JSON.stringify(page.dividers()));
    ok(page.starters()[0] === 'Walk me through round 4', 'and the starters follow the match');
    // A reply in paragraphs, kept as text.
    const two = await open({ replies: [{ ok: true, reply: 'First paragraph.\n\nSecond paragraph.', match: LIST[0] }] });
    two.document.querySelectorAll('#starters .starter')[0].click();
    await settle(8);
    const coach = two.bubbles().find((b) => b.who === 'coach');
    ok(coach && coach.text === 'First paragraph.\n\nSecond paragraph.', 'a reply\'s paragraphs reach the bubble whole, as text');
    const css = fs.readFileSync(path.join(RENDERER, 'chat', 'chat.css'), 'utf8');
    ok(/\.msg\s*\{[^}]*white-space:\s*pre-line/.test(css), 'AND THE BUBBLE IS PRE-LINE');
    ok(two.sent[0] && two.sent[0].opts.reviewId === LIST[0].id && two.sent[0].messages.length === 1, 'the question goes with the chip\'s match');
    // The cap, the hold and a match in progress: lines of their own.
    const capped = await open({ replies: [{ ok: false, kind: 'chat-daily', resetsAt: Date.UTC(2026, 9, 16, 4, 40) }] });
    capped.document.querySelectorAll('#starters .starter')[1].click();
    await settle(8);
    const cap = capped.lines().find((l) => /cap/.test(l.kind));
    ok(cap && /^You've used today's questions\. Ask Coach is back at .+\.$/.test(cap.text) && capped.bubbles().every((b) => b.who === 'user'),
      'THE CAP IS A LINE OF ITS OWN, IN THE PLAYER\'S CLOCK, never a coach bubble', JSON.stringify(capped.lines()));
    const held = await open({ seed: { reviewId: 'valorant-1790000000003-stop01', held: true, until: 5 } });
    ok(held.lines().some((l) => /held/.test(l.kind) && l.text === "This match may still be going on. Ask Coach can talk about it once Riot's record has it, or in 90 minutes.")
      && !held.sent.length, 'THE HELD LINE, and no question is asked about it');
    // The opening questions.
    const riot = await open({ seed: { reviewId: LIST[1].id, title: 'Sunset Iso 2-5', map: 'Sunset', riotOnly: true } });
    ok(riot.sent[0] && riot.sent[0].messages[0].content === "Go through my Sunset match with me. What does Riot's record show, and where would you start?",
      'A RIOT ONLY REVIEW OPENS WITH ITS OWN QUESTION');
    const rec = await open({ seed: { reviewId: LIST[0].id, title: 'Fracture Jett 5-1', map: 'Fracture', riotOnly: false } });
    ok(rec.sent[0] && /What was my most costly mistake/.test(rec.sent[0].messages[0].content), 'a recorded one with "what was my most costly mistake"');
    // A question that named another match: the divider goes above it.
    const moved = await open({ replies: [{ ok: true, reply: 'About Split.', moved: true, match: LIST[1], from: LIST[0] }] });
    moved.document.getElementById('input').value = 'Why did I die in round 2 on Split?';
    moved.fire(moved.document.getElementById('composer'), 'submit');
    await settle(10);
    const kids = moved.document.getElementById('thread').children.map((k) => k.className);
    const dIdx = kids.findIndex((k) => /chat-divider/.test(k));
    const uIdx = kids.findIndex((k) => /msg user/.test(k));
    ok(dIdx >= 0 && dIdx < uIdx && /Split win/.test(moved.dividers()[0]), 'a question that moved the chip starts its thread above itself', kids.join(' | '));
    // The chip moved while a reply was on its way: the answer stays in the
    // thread that asked it, above the new divider, and out of the new thread.
    let release = null;
    const late = await open({ replies: [new Promise((r) => { release = r; })] });
    late.document.querySelectorAll('#starters .starter')[0].click();
    await settle(4);
    late.document.querySelector('#match-pick .dd-btn').click();
    late.fire(late.document.querySelector(`.dd-opt[data-value="${LIST[1].id}"]`), 'mousedown');
    await settle(8);
    late.clock.advance(300);
    release({ ok: true, reply: 'About Fracture round 5.', match: LIST[0] });
    await settle(8);
    const order = late.document.getElementById('thread').children.map((k) => (/msg coach/.test(k.className) ? 'reply'
      : /chat-divider/.test(k.className) ? 'divider' : /msg user/.test(k.className) ? 'question' : 'other'));
    late.document.getElementById('input').value = 'Walk me through round 4';
    late.fire(late.document.getElementById('composer'), 'submit');
    await settle(8);
    ok(order.indexOf('question') < order.indexOf('reply') && order.indexOf('reply') < order.indexOf('divider')
      && late.sent[1] && late.sent[1].messages.length === 1,
    'AN ANSWER ON ITS WAY WHEN THE CHIP MOVES STAYS IN THE THREAD THAT ASKED IT', `${order.join(' | ')}; ${late.sent[1] && late.sent[1].messages.length}`);
    // Two matches on a map: asked which, in the page's words.
    const which = await open({ replies: [{ ok: true, which: { map: 'Split', count: 2 } }] });
    which.document.querySelectorAll('#starters .starter')[0].click();
    await settle(8);
    ok(which.bubbles().some((b) => b.who === 'coach' && b.text === '2 of your last ten matches are on Split. Which one do you mean? Pick it from the match list above.'),
      'two matches on a map: the reply asks which');
    // No match: the general starters.
    const none = await open({ chosen: 'none' });
    ok(JSON.stringify(none.starters()) === JSON.stringify(["How should I use my agent's kit?", 'When should my team save?', 'How do I win more duels with a Sheriff?']),
      'with no match, the general starters', JSON.stringify(none.starters()));
    // Nothing of the tip era.
    const html = fs.readFileSync(path.join(RENDERER, 'chat', 'index.html'), 'utf8') + fs.readFileSync(path.join(RENDERER, 'chat', 'chat.js'), 'utf8');
    ok(!/this session|coached session|tips/i.test(html), 'NO "THIS SESSION", no coached session, no tips');
    ok(!DASHES.test(html), 'and no dash in the page');
  });

  // ── Onboarding: How Occlara watches (8.3.1) ────────────────────────────────
  // Record gameplay or Frames only, with the PC check behind the choice: when
  // the check runs, what the page pre selects and saves, and what it never
  // overwrites. The rules themselves are test:pccheck's, the page in the real
  // app check:onboardingriot's.
  await section('onboarding, How Occlara watches:', async () => {
    const rules = require('../src/renderer/onboarding/pc-rules');
    const GB = 1024 * 1024 * 1024;
    const ASKS = [
      { res: '720', width: 1280, height: 720, codec: 'avc1.42E01F', bitrate: 3e6 },
      { res: '1080', width: 1920, height: 1080, codec: 'avc1.42E028', bitrate: 6e6 },
    ];
    // The PC 8.3 was built on, as main's PC check answers for it.
    const BIG = { ok: true, gpu: 'NVIDIA GeForce RTX 5060', cpu: 'Intel(R) Core(TM) i5-14400F', threads: 16, ramBytes: 31.84 * GB,
      display: { width: 1920, height: 1080 }, freeBytes: 103.4 * GB, drive: 'C:', asks: ASKS };
    /**
     * The tour, open on its first page: `saved` laid over the store's
     * defaults, `facts` main's answer (a function may throw), `encoder` the
     * GPU's answer to each ask, `hold` keeping main's answer back until
     * release().
     */
    async function tour(o) {
      const opt = o || {};
      const saved = { language: 'en', recordingMode: 'auto', recordingRes: '720', recordingAutoOff: null, ...(opt.saved || {}) };
      const writes = [];
      const asked = [];
      let release = null;
      const facts = opt.facts === undefined ? BIG : opt.facts;
      const answer = () => (typeof facts === 'function' ? facts() : facts);
      const p = loadSurface('onboarding', {
        handlers: {
          [C.CONFIG_GET]: () => ({ ...saved }),
          [C.CONFIG_SET]: (patch) => { writes.push(patch); Object.assign(saved, patch); return { ok: true }; },
          [C.BACKFILL_STATUS]: () => null,
          [C.PC_CHECK]: () => (opt.hold ? new Promise((r) => { release = () => r(answer()); }) : answer()),
        },
        window: { VideoEncoder: { isConfigSupported: async (c) => { asked.push(c); return opt.encoder ? opt.encoder(c) : { supported: true }; } } },
      });
      await settle();
      const buttons = () => p.$('ob-res').querySelectorAll('button');
      return {
        p, writes, asked,
        open: async () => { p.window.go(3); await settle(20); },
        release: async () => { release(); await settle(20); },
        checks: () => p.bridge.invoked.filter((x) => x[0] === C.PC_CHECK).length,
        size: (r) => p.$('ob-res').querySelector(`[data-res="${r}"]`),
        view: () => ({
          line: p.$('ob-pc-line').textContent,
          rec: p.$('ob-rec').getAttribute('aria-checked') === 'true',
          frames: p.$('ob-frames').getAttribute('aria-checked') === 'true',
          recOff: p.$('ob-rec').disabled,
          res: buttons().filter((b) => b.classList.contains('active')).map((b) => b.dataset.res).join(),
          sizes: buttons().filter((b) => !b.disabled).map((b) => b.dataset.res).join(),
          quiet: p.$('ob-res').classList.contains('quiet'),
          recTag: !p.$('ob-rec-tag').hidden,
          framesTag: !p.$('ob-frames-tag').hidden,
          facts: p.document.querySelectorAll('#ob-pc-facts dd').map((d) => d.textContent),
        }),
      };
    }
    const wrote = (t) => JSON.stringify(t.writes);
    const tours = [];

    // A capable PC, first run: the store holds its defaults, which nobody chose.
    const big = await tour();
    tours.push(big);
    ok(big.p.$('ob-rec').getAttribute('aria-checked') === 'true' && big.view().res === '720',
      'before anything is read, the page shows the store\'s defaults: Record at 720p');
    ok(big.checks() === 0, 'nothing is checked before its page opens');
    await big.open();
    let v = big.view();
    ok(big.checks() === 1, 'the check runs as its page opens');
    ok(v.rec && !v.frames && v.res === '1080' && v.recTag && !v.framesTag && v.line === 'This PC can record at 1080p.',
      'a capable PC on a first run: Record at 1080p pre selected, and tagged Recommended', JSON.stringify(v));
    ok(wrote(big) === '[{"recordingMode":"auto","recordingRes":"1080"}]', 'and saved at once, as recordingMode and recordingRes', wrote(big));
    ok(same(v.facts, ['NVIDIA GeForce RTX 5060', '720p and 1080p', '16 threads', '32 GB', '1920x1080', '103 GB on C:']),
      'what the check found is listed: GPU, encoder, threads, RAM, display, free space', JSON.stringify(v.facts));
    ok(same(big.asked, ASKS.map((a) => ({ codec: a.codec, width: a.width, height: a.height, bitrate: a.bitrate, framerate: 30, hardwareAcceleration: 'prefer-hardware' }))),
      'main\'s two asks are put to the encoder as they came, prefer-hardware at 30 fps', JSON.stringify(big.asked));
    big.p.window.go(2);
    await settle();
    await big.open();
    ok(big.checks() === 1 && big.asked.length === 2, 'once: back and forward again asks nothing more');

    // Both choices save the moment they are made.
    big.p.$('ob-frames').click();
    await settle();
    v = big.view();
    ok(v.frames && !v.rec && v.quiet && big.writes[big.writes.length - 1].recordingMode === 'off',
      'Frames only saves recordingMode off, and the size goes quiet', wrote(big));
    big.size('720').click();
    await settle();
    v = big.view();
    ok(v.rec && v.res === '720' && same(big.writes[big.writes.length - 1], { recordingMode: 'auto', recordingRes: '720' }),
      'a size picks Record at that size', wrote(big));
    const before = big.writes.length;
    big.p.$('ob-rec').click();
    await settle();
    ok(big.writes.length === before, 'Record picked again while picked saves nothing new');
    big.p.$('ob-frames').click();
    big.p.$('ob-rec').click();
    await settle();
    ok(same(big.writes.slice(-2), [{ recordingMode: 'off', recordingRes: '720' }, { recordingMode: 'auto', recordingRes: '720' }]),
      'Frames only, then Record: each saved as it is made', wrote(big));

    // A modest PC: Frames only recommended, Record still a choice.
    const modest = await tour({ facts: { ...BIG, ramBytes: 3.8 * GB } });
    tours.push(modest);
    await modest.open();
    v = modest.view();
    ok(v.frames && !v.rec && v.framesTag && !v.recTag && !v.recOff && wrote(modest) === '[{"recordingMode":"off","recordingRes":"720"}]',
      'a modest PC on a first run: Frames only pre selected, tagged and saved, Record still open', JSON.stringify(v));
    modest.p.$('ob-rec').click();
    await settle();
    ok(modest.view().rec && same(modest.writes[modest.writes.length - 1], { recordingMode: 'auto', recordingRes: '720' }),
      'and Record can still be chosen there', wrote(modest));

    // No encoder: Record cannot be chosen, and Frames only is saved over a Record the player chose.
    const none = await tour({ saved: { recordingRes: '1080' }, encoder: () => ({ supported: false }) });
    tours.push(none);
    await none.open();
    v = none.view();
    ok(v.recOff && v.frames && !v.rec && v.sizes === '' && !v.recTag && !v.framesTag && /no hardware video encoder/.test(v.line),
      'no hardware encoder: Record and both sizes disabled, Frames only shown, nothing tagged', JSON.stringify(v));
    ok(wrote(none) === '[{"recordingMode":"off","recordingRes":"1080"}]',
      'and Frames only saved over a Record at 1080p the player had chosen, which could never record here', wrote(none));
    none.p.$('ob-rec').click();
    none.size('720').click();
    await settle();
    ok(none.writes.length === 1 && none.view().frames, 'a disabled Record or size clicked saves nothing');

    // Not enough space: the same, the line saying how much and where.
    const disk = await tour({ facts: { ...BIG, freeBytes: 5.26 * GB } });
    tours.push(disk);
    await disk.open();
    v = disk.view();
    ok(v.recOff && v.frames && v.line === rules.recommend({ ...BIG, freeBytes: 5.26 * GB, encoder: { 720: true, 1080: true } }).why
      && /5\.2 GB/.test(v.line) && wrote(disk) === '[{"recordingMode":"off","recordingRes":"720"}]',
    'under 8 GB free: Record disabled, Frames only saved, and the line names the drive and the space', v.line);

    // Shown again after a logout, the tour keeps what the player chose.
    const rerun = await tour({ saved: { recordingMode: 'off' } });
    tours.push(rerun);
    await rerun.open();
    v = rerun.view();
    ok(v.frames && !v.rec && v.recTag && rerun.writes.length === 0,
      'Off chosen in Settings, on a PC that could record at 1080p: still Off, Record tagged, nothing saved', JSON.stringify(v));
    const kept1080 = await tour({ saved: { recordingRes: '1080' }, facts: { ...BIG, display: { width: 1600, height: 900 } } });
    await kept1080.open();
    v = kept1080.view();
    ok(v.rec && v.res === '1080' && kept1080.writes.length === 0, '1080p chosen where the rules say 720p: still 1080p, nothing saved', JSON.stringify(v));
    const autoOff = await tour({ saved: { recordingMode: 'off', recordingAutoOff: { at: 1, reason: 'busy', sessions: 2 } } });
    await autoOff.open();
    ok(autoOff.view().frames && autoOff.writes.length === 0, 'Off because recording turned itself off is not reset either');

    // A pick made before the check lands is the player's, and stays.
    const early = await tour({ hold: true });
    early.p.window.go(3);
    await settle(20);
    ok(early.view().line === 'Checking this PC', 'while main answers, the line says it is checking');
    early.p.$('ob-frames').click();
    await settle();
    await early.release();
    v = early.view();
    ok(v.frames && v.recTag && wrote(early) === '[{"recordingMode":"off","recordingRes":"720"}]',
      'Frames only picked while checking: still Frames only once the check says 1080p, and nothing else saved', wrote(early));

    // A check that fails, or an encoder that never answers, leaves the defaults alone.
    for (const [what, facts] of [['main answering ok false', { ok: false, error: 'pc check failed' }],
      ['main throwing', () => { throw new Error('main went away'); }]]) {
      const failed = await tour({ facts });
      tours.push(failed);
      await failed.open();
      v = failed.view();
      ok(/could not be checked/.test(v.line) && v.rec && v.res === '720' && failed.writes.length === 0 && failed.asked.length === 0
        && v.facts.every((f) => f === 'Not known' || f === 'Not checked'),
      `${what}: "could not be checked", Record at 720p kept, nothing asked or saved`, JSON.stringify(v));
    }
    const hung = await tour({ encoder: () => new Promise(() => {}) });
    hung.p.window.go(3);
    await settle(20);
    ok(hung.view().line === 'Checking this PC', 'an encoder slow to answer is waited for');
    // Both asks wait at once: one after the other, a hung encoder held
    // "Checking this PC" up for ten seconds.
    hung.p.clock.advance(5000);
    await settle(20);
    v = hung.view();
    ok(/could not be checked/.test(v.line) && v.rec && hung.writes.length === 0 && hung.asked.length === 2,
      'and after five seconds both asks count as unanswered, not as a no: they wait at once, not one after the other', v.line);

    // A size the encoder refused cannot be picked.
    const no1080 = await tour({ encoder: (c) => ({ supported: c.width < 1900 }) });
    tours.push(no1080);
    await no1080.open();
    v = no1080.view();
    ok(v.sizes === '720' && v.res === '720' && v.line === 'This PC can record at 720p. Its encoder does not take 1080p.' && no1080.writes.length === 0,
      'an encoder that refuses 1080p: 1080p disabled, Record at 720p, which was saved already', JSON.stringify(v));
    no1080.size('1080').click();
    await settle();
    ok(no1080.writes.length === 0 && no1080.view().res === '720', 'and 1080p clicked saves nothing');
    ok(no1080.size('1080').title === 'Its encoder does not take 1080p.' && no1080.size('720').title === ''
      && no1080.size('1080').getAttribute('aria-checked') === 'false', 'the size it cannot pick says why on itself', no1080.size('1080').title);

    // A SAVED 1080p THE ENCODER REFUSES never records (the recorder's gate
    // asks the same question and records nothing on a no). It was kept, shown
    // picked and disabled at once; now it is shown unavailable with its
    // reason, and the recommended size is picked and saved in its place,
    // beside the player's own Record or Frames only.
    const refuses = (c) => ({ supported: c.width < 1900 });
    const saved1080 = await tour({ saved: { recordingRes: '1080' }, encoder: refuses });
    tours.push(saved1080);
    await saved1080.open();
    v = saved1080.view();
    ok(v.rec && v.res === '720' && v.sizes === '720' && saved1080.size('1080').getAttribute('aria-checked') === 'false'
      && saved1080.size('1080').title === 'Its encoder does not take 1080p.' && v.line === 'This PC can record at 720p. Its encoder does not take 1080p.'
      && wrote(saved1080) === '[{"recordingMode":"auto","recordingRes":"720"}]',
    'a saved 1080p the encoder refuses: shown unavailable, the line saying why, and Record at 720p picked and saved in its place', `${JSON.stringify(v)} ${wrote(saved1080)}`);
    const modest1080 = await tour({ saved: { recordingRes: '1080' }, encoder: refuses, facts: { ...BIG, ramBytes: 3.8 * GB } });
    tours.push(modest1080);
    await modest1080.open();
    v = modest1080.view();
    ok(v.rec && v.res === '720' && v.framesTag && v.line === `${rules.recommend({ ...BIG, ramBytes: 3.8 * GB, encoder: { 720: true, 1080: false } }).why} Its encoder does not take 1080p.`
      && wrote(modest1080) === '[{"recordingMode":"auto","recordingRes":"720"}]',
    'on a modest PC too: the player\'s Record kept at 720p, Frames only still tagged, and the reason added to the line, which did not say it', `${v.line} ${wrote(modest1080)}`);
    const off1080 = await tour({ saved: { recordingMode: 'off', recordingRes: '1080' }, encoder: refuses });
    await off1080.open();
    v = off1080.view();
    ok(v.frames && !v.rec && v.res === '720' && wrote(off1080) === '[{"recordingMode":"off","recordingRes":"720"}]',
      'and with Frames only chosen, Frames only stays, the size Record would take put right under it', `${JSON.stringify(v)} ${wrote(off1080)}`);
    // The rules never recommend a size the encoder refused while the other records.
    const odd = rules.recommend({ ...BIG, ramBytes: 3.8 * GB, encoder: { 720: false, 1080: true } });
    ok(odd.mode === 'off' && odd.res === '1080' && odd.refused[720] === 'Its encoder does not take 720p.' && odd.refused[1080] === null
      && rules.recommend({ ...BIG, encoder: { 720: true, 1080: false } }).short === rules.REFUSED('1080'),
    'and the rules recommend no size the encoder refused: a modest PC whose encoder takes only 1080p is at 1080p', JSON.stringify(odd.refused));

    // THE CHOICES ARE RADIOS, and the keys say so. A key goes where focus is,
    // up through the page, then to the window, as the browser sends it, unless
    // a control stopped it on the way.
    const { makeEvent } = require('./fixtures/fake-dom');
    const press = (t, el, key) => {
      const e = makeEvent('keydown', { key, target: el });
      el.dispatchEvent(e);
      if (!e._stopped) for (const fn of t.p.window._listeners.keydown || []) fn.call(t.p.window, e);
      return e;
    };
    const pageOf = (t) => t.p.document.querySelectorAll('.page').findIndex((pg) => !pg.hidden);
    const last = (t) => t.writes[t.writes.length - 1];
    const keys = await tour();
    await keys.open();
    const recCardEl = keys.p.$('ob-rec');
    const framesCardEl = keys.p.$('ob-frames');
    ok(recCardEl.tabIndex === 0 && framesCardEl.tabIndex === -1 && keys.size('1080').tabIndex === 0 && keys.size('720').tabIndex === -1,
      'Tab comes into each group of choices on its picked one alone: Record, and its 1080p');
    recCardEl.focus();
    press(keys, recCardEl, 'ArrowDown');
    await settle();
    v = keys.view();
    ok(pageOf(keys) === 3 && keys.p.document.activeElement === framesCardEl && v.frames && !v.rec && framesCardEl.tabIndex === 0 && recCardEl.tabIndex === -1
      && same(last(keys), { recordingMode: 'off', recordingRes: '1080' }),
    'an arrow on a choice moves to the next one and picks it, as a radio does, and turns no page', `page ${pageOf(keys)}, ${wrote(keys)}`);
    press(keys, framesCardEl, 'ArrowRight');
    await settle();
    ok(pageOf(keys) === 3 && keys.p.document.activeElement === recCardEl && keys.view().rec && same(last(keys), { recordingMode: 'auto', recordingRes: '1080' }),
      'and round again from the last one, by either arrow', `page ${pageOf(keys)}, ${wrote(keys)}`);
    keys.size('1080').focus();
    press(keys, keys.size('1080'), 'ArrowLeft');
    await settle();
    const leftTo = keys.p.document.activeElement;
    const leftSaved = last(keys);
    // and round again within its own two, never out to the cards
    press(keys, keys.size('720'), 'ArrowLeft');
    await settle();
    ok(pageOf(keys) === 3 && leftTo === keys.size('720') && same(leftSaved, { recordingMode: 'auto', recordingRes: '720' })
      && keys.p.document.activeElement === keys.size('1080') && keys.view().res === '1080' && keys.view().rec
      && keys.size('1080').getAttribute('aria-checked') === 'true' && keys.size('720').getAttribute('aria-checked') === 'false'
      && same(last(keys), { recordingMode: 'auto', recordingRes: '1080' }),
    'the size is a group of its own: an arrow moves between 720p and 1080p and round again, Record at that size, and no page turns', wrote(keys));
    const noneBefore = none.writes.length;
    none.p.$('ob-frames').focus();
    press(none, none.p.$('ob-frames'), 'ArrowUp');
    await settle();
    ok(pageOf(none) === 3 && none.view().frames && none.writes.length === noneBefore && none.p.document.activeElement === none.p.$('ob-frames'),
      'a choice that cannot be made is passed over: with Record disabled an arrow stays on Frames only');
    // ENTER ON A CHOICE PICKS IT AND STAYS; on the page's last control,
    // Frames only, it picks and goes on, as Enter in a form's last field sends it.
    framesCardEl.click();
    await settle();
    let recClicks = 0;
    recCardEl.addEventListener('click', () => { recClicks++; });
    recCardEl.focus();
    const enterRec = press(keys, recCardEl, 'Enter');
    await settle();
    ok(pageOf(keys) === 3 && keys.view().rec && recClicks === 1 && enterRec.defaultPrevented && same(last(keys), { recordingMode: 'auto', recordingRes: '1080' }),
      'Enter on Record picks it and stays on the page: its click made once, and the browser\'s own kept from following it', `page ${pageOf(keys)}, ${recClicks} clicks, ${wrote(keys)}`);
    keys.size('720').focus();
    press(keys, keys.size('720'), 'Enter');
    await settle();
    ok(pageOf(keys) === 3 && keys.view().res === '720' && same(last(keys), { recordingMode: 'auto', recordingRes: '720' }), 'Enter on a size picks it and stays');
    framesCardEl.focus();
    press(keys, framesCardEl, 'Enter');
    await settle();
    ok(pageOf(keys) === 4 && same(last(keys), { recordingMode: 'off', recordingRes: '720' }),
      'Enter on Frames only, the page\'s last control, picks it and goes on', `page ${pageOf(keys)}, ${wrote(keys)}`);
    // The footer and the rest of the tour: Enter on a button is that button.
    keys.p.window.go(1);
    keys.p.$('next').focus();
    press(keys, keys.p.$('next'), 'Enter');
    ok(pageOf(keys) === 2, 'Enter on Next is one page on, never two', `page ${pageOf(keys)}`);
    keys.p.$('back').focus();
    press(keys, keys.p.$('back'), 'Enter');
    ok(pageOf(keys) === 1, 'Enter on Back one page back, where it went forward and back again', `page ${pageOf(keys)}`);
    press(keys, keys.p.document.body, 'Enter');
    ok(pageOf(keys) === 2, 'Enter with no control in hand is Next, as it was', `page ${pageOf(keys)}`);
    press(keys, keys.p.document.body, 'ArrowRight');
    const turned = pageOf(keys);
    press(keys, keys.p.document.body, 'ArrowLeft');
    ok(turned === 3 && pageOf(keys) === 2, 'and the arrows away from the choices still turn the pages', `${turned} then ${pageOf(keys)}`);
    const [offTips, onTips] = keys.p.$('advanced').querySelectorAll('button');
    offTips.focus();
    press(keys, offTips, 'Enter');
    await settle();
    ok(pageOf(keys) === 2 && offTips.classList.contains('active') && same(last(keys), { advancedTips: false }),
      'after every match, Enter on Off picks it and stays', wrote(keys));
    onTips.focus();
    press(keys, onTips, 'Enter');
    await settle();
    ok(pageOf(keys) === 3 && onTips.classList.contains('active') && same(last(keys), { advancedTips: true }),
      'and on On, the page\'s last control, picks it and goes on', `page ${pageOf(keys)}, ${wrote(keys)}`);
    // A key a control takes for itself is its own: the language list on the
    // first page opens on Enter and closes on Escape, and neither turns the
    // page or ends the tour. The Escape after it, the list closed, does.
    keys.p.window.go(0);
    const langBtn = keys.p.$('ob-language').querySelector('button');
    const doneSent = () => keys.p.bridge.sent.filter((s) => s[0] === C.ONBOARDING_DONE).length;
    langBtn.focus();
    press(keys, langBtn, 'Enter');
    const opened = langBtn.getAttribute('aria-expanded') === 'true' && pageOf(keys) === 0;
    press(keys, langBtn, 'Escape');
    const closedOnly = langBtn.getAttribute('aria-expanded') === 'false' && doneSent() === 0 && pageOf(keys) === 0;
    press(keys, langBtn, 'Escape');
    ok(opened && closedOnly && doneSent() === 1, 'the language list takes its own Enter and Escape, turning no page and ending no tour; Escape with it closed ends the tour',
      `opened ${opened}, closed only ${closedOnly}, done sent ${doneSent()}`);

    // THE WORDS ARE TRUE IN EVERY GAME. Valorant and League record, and
    // League's screen is never read: its review comes from the game's own
    // record.
    const copy = new Set();
    for (const t of tours) {
      for (const el of t.p.document.querySelectorAll('#ob-watch h1, #ob-watch .sub, #ob-pc-line, #ob-watch .ob-opt-title, #ob-watch .ob-opt-text, #ob-pc-facts dt, #ob-pc-facts dd')) {
        for (const s of el.textContent.split(/(?<=[.!?])\s+/)) if (s.trim()) copy.add(s.trim());
      }
    }
    const words = [...copy];
    ok(words.length > 20, `the copy of the page in every state above (${words.length} sentences)`);
    ok(!words.some((w) => DASHES.test(w)), 'no dash anywhere on the page', words.filter((w) => DASHES.test(w)).join(' | '));
    const screen = words.filter((w) => /screen/i.test(w));
    ok(screen.length >= 1 && screen.every((w) => /\bValorant\b/.test(w) && !/League/.test(w)),
      'every sentence that says the screen is read says Valorant, and none says League', screen.join(' | '));
    const recCard = big.p.$('ob-rec').textContent;
    const framesCard = big.p.$('ob-frames').textContent;
    ok(/Valorant and League are recorded at about 30 fps/.test(recCard) && /stays on this PC/.test(recCard),
      'Record gameplay: Valorant and League, about 30 fps, and the video stays on this PC', recCard);
    ok(/Nothing is recorded/.test(framesCard) && /no clips/.test(framesCard), 'Frames only: nothing is recorded, so no clips', framesCard);
    ok(!words.some((w) => /Rivals|Marvel/.test(w)), 'and nothing names a game Occlara no longer coaches');
  });

  console.log(fails ? `\nFAIL: ${fails} problem(s)` : '\nPASS: every surface does the right thing with what arrives');
  process.exit(fails ? 1 : 0);
})().catch((e) => {
  console.log(`FAIL  the test itself threw: ${e.stack || e}`);
  process.exit(1);
});

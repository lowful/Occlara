'use strict';

/**
 * test:reviewpage. THE REVIEW PAGE IN 9.1 (the owner's items 6, 7, 16 and 18)
 * and the clutch the AI audit found credited to a player who died.
 *
 *   1. A CLUTCH IS WON ALIVE (insights.js clutchWonAlive, grade.js
 *      Decisions): the Split round 12 shape, the player left last, then
 *      killed, the round won by the spike, is no "Won as the last one
 *      standing" and no clutch in Decisions; alive, it still is; every guard
 *      the rule had still holds; the Duos sheet's chip takes the same rule.
 *   2. THE HEAD: the back arrow goes back through the app's history with
 *      Matches as the fallback and says where it goes; "All matches" is gone;
 *      the eye, Share image and the match's menu are its actions.
 *   3. DELETE MATCH: from the menu, behind a confirm; Keep it deletes nothing;
 *      Delete match asks main once with the review's id; a refusal says why;
 *      no menu while the review is still being built.
 *   4. WHAT MOVED THE RATING: every rated round's line carries its move on the
 *      100 scale and the engine's label, as the rating's view has them, and
 *      the moves add up to the match.
 *   5. THE BEST HIGHLIGHT: the best kept clip by clips.js highlightRank
 *      itself (asked through the preload, which ranks a clutch by
 *      clutchWonAlive), its line from Riot's facts, in the agent's place;
 *      none kept, none shown. main presents a highlight's clip URL
 *      (presentClips).
 *   6. THE REPLAY AS A PLAYER: every label rating.js writes on the sample
 *      matches has one role, each round's kills are Riot's count; pause holds
 *      it, the next and previous event step it, a death's moment is its clip
 *      and a kill's its highlight at that kill.
 *
 * Pure node on the fake DOM (fixtures/fake-dom.js), no window. Written with a
 * file tool, never a shell heredoc (CLAUDE.md, the regex trap).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const C = require('../src/shared/channels');
const insights = require('../src/shared/insights');
const grade = require('../src/shared/grade');
const clips = require('../src/shared/clips');
const reviewClips = require('../src/main/services/review-clips');
const { served } = require('../src/shared/valorant-review');
const { scrubText } = require('../src/shared/plain-text');
const proof = require('./fixtures/proof-reviews');
const vm = require('vm');
const { loadSurface, settle, makeEvent } = require('./fixtures/fake-dom');

let checks = 0;
let fails = 0;
function ok(cond, msg, detail) {
  checks++;
  if (cond) console.log(`  ok  ${msg}`);
  else { fails++; console.log(`  FAIL ${msg}${detail !== undefined ? ` (${detail})` : ''}`); }
}
const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const DASHES = new RegExp(`[${String.fromCharCode(0x2013)}${String.fromCharCode(0x2014)}]`);

// ── 1. A clutch is won alive ───────────────────────────────────────────────
console.log('a clutch is won alive:');
{
  const V = (n, o) => ({ n, verified: true, feedKnown: true, side: 'attacking', died: false, firstDeath: false, firstKill: false,
    kills: 0, traded: null, trades: 0, aliveAtDeath: null, clutch: null, result: 'won', ...o });
  // Split, 4 Oct, round 12: left last against two, planted, killed, the spike went off.
  const split12 = V(12, { died: true, kills: 1, traded: false, aliveAtDeath: { mates: 1, enemies: 2 }, clutch: { vs: 2, won: true }, planted: true });
  const alive = V(9, { kills: 2, clutch: { vs: 2, won: true } });
  ok(insights.clutchWonAlive(alive) && !insights.clutchWonAlive(split12), 'won alone and alive is a clutch; won by the spike after the player died is not');
  ok(!insights.clutchWonAlive(V(3, { clutch: { vs: 2, won: false } })) && !insights.clutchWonAlive(V(3, { clutch: { vs: 0, won: true } }))
    && !insights.clutchWonAlive(V(3, { clutch: { vs: 2, won: null } })) && !insights.clutchWonAlive(V(3, { clutch: null }))
    && !insights.clutchWonAlive(null),
  'every guard kept: lost, against none, not known whether won, no clutch at all, no round');
  ok(!insights.clutchWonAlive(V(3, { died: null, clutch: { vs: 1, won: true } })) && !insights.clutchWonAlive(V(3, { died: undefined, clutch: { vs: 1, won: true } })),
    'a round whose death is not known claims no clutch');
  const filler = [1, 2, 3, 4, 5].map((n) => V(n));
  const strengths = (rounds) => insights.valorant(rounds, { role: 'Duelist' }).strengths.filter((s) => s.key === 'clutch');
  ok(strengths([...filler, split12]).length === 0, 'the Split round 12 shape writes no "Won as the last one standing"');
  const won = strengths([...filler, alive, split12]);
  ok(won.length === 1 && won[0].title === 'Won as the last one standing' && JSON.stringify(won[0].rounds) === '[9]'
    && won[0].detail === 'Round 9, alone against 2.', 'alive, it is written as before, and only that round', JSON.stringify(won));
  // Decisions: the clutch credit the same way.
  const dec = (rounds) => grade.valorant({ rounds, scoreline: { kills: 10, deaths: 4, assists: 3, acs: 250 }, role: 'Duelist',
    history: [], totalRounds: rounds.length }).categories.find((c) => c.key === 'decisions');
  const withDead = dec([...filler, split12]);
  const withAlive = dec([...filler, alive, V(12, { died: true, kills: 1, traded: false, aliveAtDeath: { mates: 1, enemies: 2 } })]);
  ok(withDead && !withDead.evidence.some((e) => /clutch/.test(e)), 'Decisions credits no clutch to the player who died in it', JSON.stringify(withDead && withDead.evidence));
  ok(withAlive && withAlive.evidence.includes('won 1 clutch'), 'and still credits one won alive', JSON.stringify(withAlive && withAlive.evidence));
  ok(/clutchWonAlive/.test(read('src/shared/insights.js')) && /r\.died === false/.test(read('src/shared/grade.js')),
    'the lists and the grade read the same rule');
  // The Duos sheet's chip (src/shared/duos.js sideOf), the same rule: a 1vN
  // the player died in says no "won", whatever the round's end.
  const duos = require('../src/shared/duos');
  const chip = (row) => (duos.sideOf({ kills: [], ...row }).chips.find((c) => /^Clutch/.test(c.word)) || {});
  const dead = chip({ died: true, sec: 70, clutch: { vs: 2, won: true } });
  const lived = chip({ died: false, clutch: { vs: 2, won: true } });
  const lost = chip({ died: true, sec: 70, clutch: { vs: 3, won: false } });
  ok(dead.word === 'Clutch 1v2' && dead.tone === null && lived.word === 'Clutch 1v2, won' && lived.tone === 'good' && lost.word === 'Clutch 1v3, lost'
    && chip({ clutch: { vs: 1, won: true } }).word === 'Clutch 1v1',
  'the Duos sheet says won only where the player lived through it; killed, the 1vN alone; a death not known claims nothing',
  JSON.stringify([dead, lived, lost]));
  // The owner's own Split of 4 Oct, Riot's record as kept in the repo: round 12 is the audit's case.
  const verify = require('../src/shared/valorant-verify');
  const split = verify.reconcile([], JSON.parse(read('scripts/fixtures/riot-split-13-7.json'))).rounds;
  const r12 = split.find((r) => r.n === 12);
  ok(r12 && r12.clutch && r12.clutch.won === true && r12.died === true && r12.result === 'won',
    'Riot\'s record of the real Split: round 12 left the player last against 3, the player died, the round was won', JSON.stringify(r12 && r12.clutch));
  const realIns = insights.valorant(split, { role: 'Duelist' });
  const realDec = grade.valorant({ rounds: split, scoreline: { kills: 17, deaths: 16, assists: 8, acs: 279, adr: 181, headshotPct: 22 }, role: 'Duelist', history: [], totalRounds: 20 })
    .categories.find((c) => c.key === 'decisions');
  ok(!realIns.strengths.some((s) => s.key === 'clutch') && !realDec.evidence.some((e) => /clutch/.test(e)),
    'and on it neither "Won as the last one standing" nor a clutch in Decisions', JSON.stringify(realDec.evidence));
}

// The sample library, served and presented as main presents it.
const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'occlara-reviewpage-'));
const seeded = proof.seed(path.join(ud, 'profile'), { now: Date.now() - 30 * 60 * 1000 });
const ID = seeded.ids[0];
function sample(extra) {
  const e = seeded.store.get(ID);
  const r = JSON.parse(JSON.stringify(e.review));
  if (extra) extra(r);
  const out = scrubText({ ...served({ ...r, id: ID }) });
  return reviewClips.presentClips(out, { has: (n) => /^h17-clip|^h21-clip|^r2-clip/.test(n), url: (n) => `occlara-clip://review/${ID}/${n}` });
}
const withMedia = (r) => {
  const at = (n) => r.rounds.find((c) => c.n === n);
  at(17).highlight = { clip: 'h17-clip.mkv', length: 9000, kills: [2400, 3600, 4700, 7400], cuts: [] };
  at(21).highlight = { clip: 'h21-clip.mkv', length: 7000, kills: [1800, 2900, 4100], cuts: [] };
  at(11).highlight = { clip: 'h11-clip.mkv', length: 8000, kills: [1000, 2000, 3000, 4000], cuts: [] };
  at(2).forensics = { cause: 'isolated', what: 'You swung the angle alone.', better: 'Wait for a teammate before you swing.', source: 'riot', at: 1, clip: 'r2-clip.mkv', clipDeath: 11000 };
};
const HIST = (o) => ({ back: true, forward: false, backTo: 'matches', forwardTo: null, backLabel: 'Matches', forwardLabel: null, at: 1, length: 2, ...o });

/** A function the page's scripts declared, by its name. */
const inPage = (win, name) => vm.runInContext(name, win);
/** A key on the document, its listeners in order until one stops it, as a browser's capture does. */
function press(v, k) {
  const e = makeEvent('keydown', { key: k });
  for (const fn of v.document._listeners.keydown || []) { fn.call(v.document, e); if (e._stopped) break; }
}
async function open(review, handlers) {
  const v = loadSurface('review', { handlers: { [C.LOL_REVIEW_GET]: () => review, [C.HISTORY_GET]: () => HIST(), ...(handlers || {}) },
    preload: (api) => ({ ...api, close: () => {} }) });
  await settle();
  return v;
}

(async () => {
  // ── 2. The head ─────────────────────────────────────────────────────────
  console.log('the head:');
  {
    const html = read('src/renderer/review/index.html');
    ok(!/All matches/.test(html) && !/id="matches"/.test(html) && !/\$\('matches'\)/.test(read('src/renderer/review/review.js')),
      '"All matches" is gone from the page and its script');
    const v = await open(sample());
    const back = v.$('back');
    ok(back && back.getAttribute('aria-label') === 'Back to Matches' && v.$('back-label').textContent === 'Matches',
      'the back arrow says where it goes, from the history', back && back.getAttribute('aria-label'));
    back.click();
    await settle();
    const went = v.bridge.invoked.filter((x) => x[0] === C.HISTORY_GO);
    ok(went.length === 1 && went[0][1].dir === 'back' && went[0][1].fallback === 'matches' && went[0][1].from === 'page',
      'pressed, it goes back through the app\'s history with Matches as the fallback', JSON.stringify(went));
    v.bridge.emit(C.PUSH_HISTORY, HIST({ backTo: 'moments', backLabel: 'Clips' }));
    ok(v.$('back-label').textContent === 'Clips' && back.getAttribute('aria-label') === 'Back to Clips', 'it follows the history: back to Clips');
    v.bridge.emit(C.PUSH_HISTORY, HIST({ back: false, backTo: null, backLabel: null }));
    ok(v.$('back-label').textContent === 'Matches', 'with nothing behind it, Matches, the fallback');
    const acts = v.document.querySelector('.h-actions');
    const ids = acts.children.map((n) => n.id || n.className);
    ok(acts.children.indexOf(v.$('eye-host')) === acts.children.indexOf(v.$('share')) - 1 && acts.children.indexOf(v.$('share')) < ids.indexOf('v-more-wrap no-drag'),
      'the actions: the eye, Share image, then the match\'s menu', JSON.stringify(ids));
    ok(v.$('share').classList.contains('v-glass') && v.$('more').classList.contains('v-glass') && back.classList.contains('v-back'),
      'each a glass button of the head');
    const css = read('src/renderer/review/review.css');
    ok(/html\.embedded \.v-head \.h-brand \{[^}]*clip: rect\(0, 0, 0, 0\)/.test(css) && v.document.querySelector('header .h-brand h2').textContent === 'Match review',
      'the page\'s name is kept for a screen reader and the site\'s proof, out of sight in the window');
    ok(/\.vd > \.vd-agent\.full \{ top: 0; \}/.test(css) && /left: max\(calc\(var\(--text-r\) \+ 24px\), calc\(var\(--col-r\) - 160px - var\(--moon\) \/ 2\)\)/.test(css)
      && /top: 66px; width: var\(--moon\)/.test(css),
      'the agent stands inside the hero, and the moon sits whole below the head, its limb clear of the hero\'s text');
    ok(/\.v-sky\.building \.v-moon \{ left: calc\(50% \+ 300px\)/.test(css) && /classList\.toggle\('building'/.test(read('src/renderer/review/review.js')),
      'and clear of the loading screen\'s column while the review is made');
    ok(/\.sheet > \.body\.scrolled \{ --v-fade: 28px; \}/.test(css) && /classList\.toggle\('scrolled'/.test(read('src/renderer/review/review.js')),
      'what scrolls under the head fades through a soft edge once the page has moved');
    // 9.1 fix: the sky's soft top edge stays put and only its inner layer
    // slides, so the moon rising under the head fades out, never cut by a
    // straight edge at the bar (it was, from about 180px of scroll).
    ok(v.$('v-moon').parentNode === v.$('v-sky-in') && v.$('v-stars').parentNode === v.$('v-sky-in') && v.$('v-sky-in').parentNode === v.$('v-sky')
      && /\.v-sky \{[^}]*mask-image: linear-gradient\(transparent 0, rgba\(0, 0, 0, 1\) 64px\)/.test(css) && /\.v-sky-in \{ position: absolute; inset: 0; \}/.test(css),
    'the sky\'s frame holds the fade, the stars and the moon in a layer inside it');
    const scroller = v.document.querySelector('main.body');
    scroller.scrollTop = 300;
    scroller.dispatchEvent(makeEvent('scroll'));
    v.clock.flushFrames();
    ok(/^translate3d\(0, -180\.0px, 0\)$/.test(v.$('v-sky-in').style.transform || '') && !v.$('v-sky').style.transform && Number(v.$('v-sky').style.opacity) < 1,
      'scrolled, the inner layer slides and the frame with its fade stays, fading as a whole', `${v.$('v-sky-in').style.transform} | ${v.$('v-sky').style.transform} | ${v.$('v-sky').style.opacity}`);
    scroller.scrollTop = 0;
    scroller.dispatchEvent(makeEvent('scroll'));
    v.clock.flushFrames();
    ok(!v.$('v-sky-in').style.transform && !v.$('v-sky').style.opacity, 'back at the top, nothing moved or faded');
    ok(/@media \(max-width: 1100px\) \{[^\n]*\.vd > \.vd-agent\.full \{ right: 0; \}/.test(css) && /\.sheet > \.body \{ overflow-x: hidden; \}/.test(css)
      && !/right: -6%/.test(css),
    'between 900 and 1100px the portrait stands inside the column, and the page never scrolls sideways');
    ok(/\.vd\.has-hl > \.vd-top \{ max-width: calc\(100% - var\(--hl-w\) - 40px\); \}/.test(css),
      'beside the best highlight, the match\'s line wraps in the hero\'s column, clear of the card\'s caption');
    ok(/\.block \{ scroll-margin-top: 36px; \}/.test(css), 'a block scrolled to lands below the head\'s soft edge');
    ok(/\.sheet \{ overflow: clip; \}/.test(css) && /\.medal-defs \{ position: absolute; width: 0; height: 0;/.test(css),
      'the page never scrolls but its own scroller: the sheet clips, and the medals\' defs take no line (it slid the head 21px under the bar)');
    const replayAt = html.indexOf('id="rt-replay"');
    ok(replayAt > html.indexOf('</main>'), 'the replay sits outside the scroll, so the soft edge never fades it');
  }

  // ── 3. Delete match ─────────────────────────────────────────────────────
  console.log('delete match:');
  {
    const asked = [];
    let answer = { ok: true, id: ID };
    const v = await open(sample(), { [C.MATCH_DELETE]: (id) => { asked.push(id); return answer; } });
    ok(!v.$('more').hidden && v.$('more-menu').hidden && v.$('del-scrim').hidden, 'the match\'s menu is there, closed, and no confirm');
    v.$('more').click();
    ok(!v.$('more-menu').hidden && v.$('more').getAttribute('aria-expanded') === 'true', 'pressed, it opens');
    v.$('delete-match').click();
    ok(v.$('more-menu').hidden && !v.$('del-scrim').hidden && v.document.activeElement === v.$('del-keep') && asked.length === 0,
      'Delete match asks first, Keep it focused, and nothing is deleted yet');
    ok(/cannot be undone/.test(v.$('del-body').textContent) && !DASHES.test(v.$('del-dialog').textContent), 'it says plainly what goes, with no dash');
    v.$('del-keep').click();
    ok(v.$('del-scrim').hidden && asked.length === 0, 'Keep it keeps the match');
    v.$('more').click();
    v.$('delete-match').click();
    press(v, 'Escape');
    ok(v.$('del-scrim').hidden && asked.length === 0, 'Escape keeps it too');
    v.$('more').click();
    v.$('delete-match').click();
    answer = { ok: false, error: 'match' };
    v.$('del-go').click();
    await settle();
    ok(asked.length === 1 && asked[0] === ID && !v.$('del-said').hidden && v.$('del-said').textContent === 'You can delete it once your match is over.',
      'a refusal mid match says why, and the confirm stays', JSON.stringify(asked));
    answer = { ok: true, id: ID };
    v.$('del-go').click();
    await settle();
    ok(asked.length === 2 && v.$('del-scrim').hidden, 'Delete match asks main with the review\'s id, and the confirm goes as main takes the page back');
    // 9.1 fix: opened from the keyboard (Enter on the dots: a click with no
    // pointer, detail 0), the menu's first row has the focus.
    v.$('more').dispatchEvent(makeEvent('click', { detail: 0 }));
    ok(!v.$('more-menu').hidden && v.document.activeElement === v.$('delete-match'), 'Enter on the menu button opens it with Delete match focused');
    press(v, 'Escape');
    // An import says, as Matches does, that its own video file is kept.
    const imp = await open({ ...sample(), imported: true });
    imp.$('more').click();
    imp.$('delete-match').click();
    ok(/cannot be undone\. Your video file is kept, and the game it used is not given back\.$/.test(imp.$('del-body').textContent)
      && !/video file/.test(v.$('del-body').textContent), 'an import\'s confirm keeps its video file, word for word as Matches; a recorded match\'s does not say it',
    imp.$('del-body').textContent);
    const building = await open({ ...sample(), work: { path: 'riot', steps: ['saved', 'riot'], step: 'riot', endedAt: Date.now() - 60000, until: Date.now() + 300000 } });
    ok(building.$('more').hidden, 'a review still being built has no menu');
    const nothing = await open(null);
    ok(nothing.$('more').hidden, 'nor has an empty page');
  }

  // ── 4. What moved the rating ────────────────────────────────────────────
  console.log('what moved the rating in each round:');
  {
    const r = sample();
    const view = r.ratingView;
    const v = await open(r);
    const rows = v.document.querySelectorAll('#v-rounds .v-round');
    const moves = rows.map((row) => row.querySelector('.v-rt-move'));
    ok(view && rows.length === view.rounds.length && moves.every(Boolean), `every round's line carries its move (${moves.filter(Boolean).length} of ${rows.length})`);
    const off = view.rounds.filter((x, i) => !moves[i] || moves[i].querySelector('.v-rt-d').textContent !== x.delta
      || moves[i].querySelector('.v-rt-label').textContent !== x.label);
    ok(!off.length, 'each the rating\'s own move on the 100 scale and the engine\'s label', JSON.stringify(off.slice(0, 2)));
    const sum = view.rounds.reduce((a, x) => a + Number(x.delta), 0);
    ok(60 + sum === Number(view.shown), `the moves add up to the match (60 ${sum >= 0 ? '+' : ''}${sum} = ${view.shown})`);
    const up = moves.find((m) => m.classList.contains('up'));
    const down = moves.find((m) => m.classList.contains('down'));
    ok(up && /^\+\d/.test(up.querySelector('.v-rt-d').textContent) && down && /^-\d/.test(down.querySelector('.v-rt-d').textContent),
      'a gain in green and a loss in red, the sign always the text');
    const fold = rows.find((row) => row.querySelector('.v-fold'));
    ok(!fold || fold.querySelector('.v-round-head').children.indexOf(fold.querySelector('.v-rt-move')) < fold.querySelector('.v-round-head').children.indexOf(fold.querySelector('.v-fold')),
      'before the round\'s own controls');
    const unrated = await open({ ...r, ratingView: { value: null, note: 'Rated only once Riot\'s record of the match is linked.' } });
    ok(!unrated.document.querySelector('#v-rounds .v-rt-move'), 'a review with no rating shows no move');
    // 9.1 fixes: Every round only where there are rounds to go to.
    const locked = await open({ ...r, locked: true });
    const bare = await open({ ...r, rounds: [] });
    ok(!v.$('v-every').hidden && locked.$('v-every').hidden && locked.$('v-rounds-wrap').hidden && bare.$('v-every').hidden,
      'Every round shows with rounds, and not on a locked review or one with none');
    ok(/\.v-round\.fold > \.v-round-body\[hidden\] \{[^}]*grid-auto-rows: minmax\(0, 0fr\);/.test(read('src/renderer/review/review.css')),
      'a folded round of two parts closes whole, its second part\'s row too');
    const medal = v.document.querySelectorAll('#v-medals .medal-text').map((n) => n.textContent).find((t) => /in the lobby/.test(t));
    ok(medal && /^1st of 10 in the lobby by match rating, \d+$/.test(medal), 'the medal names the match rating by its name', medal);
    // LEAGUE SAYS WHO ONCE (9.1, Reviewer 6 bug 20): with its Verdict shown,
    // the plain line over it goes, and the Verdict's line leads with the
    // champion, nothing run on at its right; with no grade the plain line stays.
    const lolReview = require('../src/shared/lol-review');
    const lolBuilt = lolReview.buildReview({ me: 'Me#EUW', allies: [], champion: 'Ahri', role: 'Mid', band: 2, mode: 'Ranked Solo',
      stats: { gameTimeSec: 1800, csAt10: 52, deathsBy15: 2, wardScore: 9.5, deathsAhead: null, goldHeldSec: null },
      final: { cs: 180, kills: 5, deaths: 2, assists: 7, ward: 9.5, level: 16 }, events: [] }, []);
    const graded = { ...lolBuilt, kind: 'lol', id: 'lol-1790000000000-demo', grade: { score: 81, letter: 'A', provisional: false, categories: [], notes: [] } };
    const lv = await open(graded);
    const ident = lv.document.querySelector('#review > .ident');
    const lmeta = lv.document.querySelector('#r-verdict .v-meta');
    ok(!lv.$('r-verdict').hidden && ident.hidden && lmeta && lmeta.textContent === ['Ahri', 'Mid', 'Ranked Solo', '30:00'].join(' · ')
      && !lv.document.querySelector('#r-verdict .v-result') && lv.$('r-champ').textContent === 'Ahri',
    'League, graded: one line, the champion first, the plain line over it gone', lmeta && lmeta.textContent);
    const lu = await open({ ...lolBuilt, kind: 'lol', id: 'lol-1790000000001-demo' });
    ok(lu.$('r-verdict').hidden && !lu.document.querySelector('#review > .ident').hidden, 'and with no grade, no Verdict, the plain line stays');
    // SAID ONCE (9.1, Reviewer 6 bug 17): a line a medal says, and the change
    // on the last match the hero's delta says, are not chips again under it.
    const P = { id: r.id, vsLast: { delta: 7, provisional: false }, lines: [
      { kind: 'best', tone: 'good', text: 'Best grade in your last 4 graded matches.' },
      { kind: 'last', tone: 'good', text: 'Up 7 on your last match.' },
      { kind: 'average', tone: 'good', text: 'Up 5 on your average of 66 over your last 4 graded matches.' },
    ] };
    const pv = await open(r, { [C.PROGRESS_GET]: () => P });
    const chips = pv.document.querySelectorAll('#v-prog .gv-prog').map((n) => n.textContent);
    const medals = pv.document.querySelectorAll('#v-medals .medal-text').map((n) => n.textContent);
    const delta = pv.document.querySelector('#v-grade .vd-delta');
    ok(JSON.stringify(chips) === JSON.stringify([P.lines[2].text]) && medals.includes('Best grade in your last 4 graded matches')
      && delta && delta.textContent === '+7 on your last match',
    'the medal and the hero\'s delta say theirs once; the strip says only the rest', JSON.stringify({ chips, medals, delta: delta && delta.textContent }));
  }

  // ── 5. The best highlight ───────────────────────────────────────────────
  console.log('the best highlight:');
  {
    const plain = await open(sample());
    ok(plain.$('v-hl').hidden && !plain.$('v-verdict').classList.contains('has-hl'), 'no highlight clip kept: nothing shown, the agent stays');
    const r = sample(withMedia);
    ok(r.rounds.find((c) => c.n === 17).highlight.clipUrl === `occlara-clip://review/${ID}/h17-clip.mkv` && !r.rounds.find((c) => c.n === 11).highlight.clipUrl,
      'main presents a highlight\'s clip by its URL while it is on disk, and none for one that is not');
    const v = await open(r);
    ok(!v.$('v-hl').hidden && v.$('v-verdict').classList.contains('has-hl') && v.$('v-hl-video').getAttribute('src') === `occlara-clip://review/${ID}/h17-clip.mkv`,
      'the 4K of round 17 plays, not the 3K of round 21 (round 11\'s 4K has no clip on disk)', v.$('v-hl-video').getAttribute('src'));
    ok(v.$('v-hl-round').textContent === 'Round 17, 4K' && v.$('v-hl-video').hasAttribute('muted') && v.$('v-hl-video').hasAttribute('loop'),
      'its line is Riot\'s facts of the round, and it is muted and looping', v.$('v-hl-round').textContent);
    ok(/\.vd\.has-hl > \.vd-agent \{ display: none; \}/.test(read('src/renderer/review/review.css')), 'in the agent\'s place');
    // 9.1 fix: the round's row holds its highlight's clip, so the line at the
    // top opens a round with something in it (it opened a bare line).
    const row17 = v.$('round-17');
    const body17 = row17.querySelector('.v-round-body');
    const player17 = row17.querySelector('.v-hl-moment video');
    ok(row17.classList.contains('fold') && !row17.classList.contains('quiet') && body17 && body17.hidden && player17
      && player17.getAttribute('src') === `occlara-clip://review/${ID}/h17-clip.mkv`
      && row17.querySelector('.v-fold').getAttribute('aria-label') === 'Round 17, show the highlight'
      && row17.querySelector('.v-hl-moment .v-look-what').textContent === '4K',
    'a round whose highlight was kept folds to its line, its clip and "4K" in it', row17.className);
    ok(!v.$('round-11').querySelector('.v-hl-moment'), 'a highlight whose clip is not on disk adds nothing to its row');
    // ITS PICTURE BEFORE IT PLAYS (9.1): never an empty box. The map's art
    // while main makes its poster, then the poster where it stands, with no
    // repaint; a clip with the coach's own frame keeps that frame.
    const JPEG = 'data:image/jpeg;base64,/9j/AAA=';
    const url17 = `occlara-clip://review/${ID}/h17-clip.mkv`;
    const art = player17.getAttribute('poster') || '';
    ok(/assets\/valorant\/maps\/Abyss\.\w+$/.test(art) && player17.dataset.art === '1', 'with no poster made yet, the map\'s art, as Clips shows it', art);
    const death2 = v.$('round-2') && v.$('round-2').querySelector('video.v-clip-video');
    const death2Poster = death2 ? death2.getAttribute('poster') : null;
    v.bridge.emit(C.PUSH_CLIP_POSTERS, { id: 'valorant-0-other', posters: [{ url: url17, poster: JPEG }] });
    ok(player17.getAttribute('poster') === art, 'a poster for another review changes nothing here');
    v.bridge.emit(C.PUSH_CLIP_POSTERS, { id: ID, posters: [{ url: url17, poster: JPEG }, { url: `occlara-clip://review/${ID}/r2-clip.mkv`, poster: JPEG }] });
    ok(player17.getAttribute('poster') === JPEG && !player17.dataset.art && row17.querySelector('.v-hl-moment video') === player17
      && inPage(v.window, 'current').rounds.find((c) => c.n === 17).highlight.clipPoster === JPEG,
    'the poster main makes goes on that clip where it stands, no repaint, and the review the page holds keeps it',
    JSON.stringify([String(player17.getAttribute('poster')).slice(0, 30), player17.dataset.art, row17.querySelector('.v-hl-moment video') === player17]));
    ok(death2 && death2Poster === art && death2.getAttribute('poster') === JPEG,
      'a death\'s clip with no frame of the coach\'s shows the map\'s art too, never a dark box, and takes its poster the same way', String(death2Poster));
    // One with the coach's frame as its picture keeps it: the poster never goes over the coach's own.
    const framed = v.document.createElement('video');
    framed.className = 'v-clip-video';
    framed.setAttribute('src', url17);
    framed.setAttribute('poster', 'data:image/jpeg;base64,COACH');
    v.$('round-17').append(framed);
    v.bridge.emit(C.PUSH_CLIP_POSTERS, { id: ID, posters: [{ url: url17, poster: JPEG }] });
    ok(framed.getAttribute('poster') === 'data:image/jpeg;base64,COACH', 'and a clip whose picture is the coach\'s own frame keeps that frame');
    const withPoster = sample(withMedia);
    withPoster.rounds.find((c) => c.n === 17).highlight.clipPoster = JPEG;
    const vp = await open(withPoster);
    ok(vp.$('round-17').querySelector('.v-hl-moment video').getAttribute('poster') === JPEG, 'a poster main already has is drawn from the first paint');
    v.$('v-hl-round').click();
    ok(!body17.hidden && row17.classList.contains('open') && v.document.activeElement === row17, 'the best highlight\'s line opens its round, the clip there');
    const bareRow = (await open(sample())).$('round-17');
    ok(bareRow.classList.contains('quiet') && !bareRow.querySelector('.v-hl-moment'), 'with nothing kept the round stays one quiet line');
    // The order is clips.js highlightRank's.
    // A card says whether the player died in its round; these lived unless told.
    const R = (n, kills, clutch, extra) => ({ n, died: false, riot: { kills, clutch: clutch || null }, highlight: { clip: `h${n}-clip.mkv`, clipUrl: `u${n}`, kills: [] }, ...extra });
    const vmw = v.window;
    const order = [R(3, 2), R(4, 3), R(5, 1, { vs: 2, won: true }), R(6, 4), R(7, 5)];
    const pick = (rounds) => { const c = inPage(vmw, 'bestHighlight')({ rounds }); return c ? c.n : null; };
    ok(pick(order) === 7 && pick(order.slice(0, 4)) === 6 && pick(order.slice(0, 3)) === 5 && pick(order.slice(0, 2)) === 4,
      'an ace, a 4K, a clutch won, a 3K, a 2K, as clips.js cuts them');
    // 9.1: a clutch the player died in (the audited Split round 12: one kill,
    // killed, the round won after) is no clutch of theirs, and never the best over a 3K.
    const deadClutch = R(12, 1, { vs: 3, won: true }, { died: true });
    ok(pick([deadClutch, R(4, 3)]) === 4 && inPage(vmw, 'highlightRankOf')(deadClutch) === null
      && inPage(vmw, 'highlightRankOf')(R(9, 3, { vs: 2, won: true }, { died: true })) === 3,
    'a clutch the player died in ranks by its kills alone, so a real 3K is the best highlight');
    const every = [...order, deadClutch, R(9, 3, { vs: 2, won: true }, { died: true }), R(10, 1, { vs: 1, won: true }, { died: undefined })];
    ok(every.every((c) => (inPage(vmw, 'highlightRankOf')(c) === clips.highlightRank({ ...c.riot, died: c.died }))), 'rank for rank clips.js highlightRank');
    // ONE RULE, NO COPY (9.1): the page asks clips.js highlightRank and
    // insights.js clutchWonAlive through its preload, and clips.js takes the
    // clutch from clutchWonAlive itself, so a clutch "against 0" (no one left
    // to win against) is no clutch anywhere either.
    const zero = R(8, 1, { vs: 0, won: true });
    ok(inPage(vmw, 'highlightRankOf')(zero) === null && clips.highlightRank({ ...zero.riot, died: false }) === null
      && !/clutch\.won|clutch && r\.clutch/.test(read('src/renderer/review/review.js'))
      && /clutchWonAlive\(\{ clutch: r\.clutch, died: r\.died \}\)/.test(read('src/shared/clips.js'))
      && /highlightRank: \(r\) => clips\.highlightRank\(/.test(read('src/preload/review-preload.js'))
      && /clutchWonAlive: \(r\) => clutchWonAlive\(/.test(read('src/preload/review-preload.js')),
    'the page keeps no copy of the clutch rule: clips.js ranks by insights.js clutchWonAlive, and the page asks both through its preload');
    const title = inPage(vmw, 'highlightTitle');
    ok(title({ n: 4, died: true, riot: { kills: 1, clutch: { vs: 2, won: true } }, highlight: {} }) === 'Round 4, a kill'
      && title({ n: 9, died: false, riot: { kills: 3, clutch: { vs: 1, won: true } }, highlight: {} }) === 'Round 9, 3K, won alone against one'
      && title({ n: 2, died: false, riot: { kills: 5 }, highlight: {} }) === 'Round 2, an ace',
    'a clutch is named only where the player was alive at the end');
    const stalled = await open(r);
    stalled.clock.advance(7999);
    const still = !stalled.$('v-hl').hidden;
    stalled.clock.advance(2);
    ok(still && stalled.$('v-hl').hidden && !stalled.$('v-verdict').classList.contains('has-hl') && !stalled.$('v-sky').classList.contains('with-hl'),
      'a clip that never shows a frame gives the place back to the agent after 8 s');
    const locked = await open({ ...r, locked: true });
    ok(locked.$('v-hl').hidden, 'a locked review plays none');
    v.bridge.emit(C.PUSH_LOL_REVIEW, { id: 'lol-1759348800000-lol001', kind: 'lol', game: { champion: 'Ahri' }, scoreline: {}, deaths: {}, deathList: [], moments: [], objectives: {}, scored: [], unmeasured: [], gamesRecorded: 0 });
    await settle();
    ok(v.$('v-hl').hidden && !v.$('v-hl-video').getAttribute('src'), 'another game\'s review lets the clip go');
  }

  // ── 6. The replay as a player ───────────────────────────────────────────
  console.log('the replay as a player:');
  {
    const r = sample(withMedia);
    const v = await open(r);
    const RV = v.window.RatingView;
    const roleOf = RV.roleOf;
    // Every label rating.js writes on the four sample matches has one role.
    const labels = [];
    for (const id of seeded.ids) {
      const s = served({ ...seeded.store.get(id).review, id });
      for (const e of (s.ratingView && s.ratingView.events) || []) labels.push(e);
    }
    const none = labels.filter((e) => !roleOf(e));
    ok(labels.length > 100 && !none.length, `each of ${labels.length} events of the sample matches has a role`, JSON.stringify(none.slice(0, 3).map((e) => e.label)));
    ok(roleOf({ kind: 'kill', label: 'Killed a teammate' }) === 'teamkill' && roleOf({ kind: 'kill', label: 'Killed by a teammate' }) === 'death'
      && roleOf({ kind: 'kill', label: 'Kill after the round was decided' }) === 'kill' && roleOf({ kind: 'kill', label: 'Died to yourself' }) === 'death'
      && roleOf({ kind: 'kill', label: 'Kill as the last one up, 1v2' }) === 'kill' && roleOf({ kind: 'kill', label: 'Assist, 4v4' }) === 'assist'
      && roleOf({ kind: 'end', label: 'Round won' }) === 'end' && roleOf({ kind: 'kill', label: 'something new' }) === null,
    'the openings rating.js writes, each to its role, and a new one to none');
    // Each round's kills by role are Riot's count of the player's kills.
    const steps = RV.steps(r.ratingView).out;
    const byRound = new Map();
    for (const s of steps) if (s.e && s.role === 'kill') byRound.set(s.round, (byRound.get(s.round) || 0) + 1);
    const wrong = r.rounds.filter((c) => c.riot && typeof c.riot.kills === 'number' && (byRound.get(c.n) || 0) !== c.riot.kills);
    ok(!wrong.length, 'each round\'s kills, by role, are Riot\'s count of the player\'s kills', JSON.stringify(wrong.map((c) => [c.n, c.riot.kills, byRound.get(c.n)])));
    // The moments: a death's own clip from just before it, a kill's highlight at that kill.
    const mediaOf = inPage(v.window, 'mediaOf');
    const r17 = steps.filter((s) => s.round === 17 && s.role === 'kill');
    const m17 = r17.map((s) => mediaOf(s.e, s.role, s.nth));
    ok(m17.length === 4 && m17.every((m) => m && /h17-clip/.test(m.clip)) && JSON.stringify(m17.map((m) => m.at)) === '[2.4,3.6,4.7,7.4]',
      'round 17\'s four kills, each at its own place in the highlight', JSON.stringify(m17.map((m) => m && m.at)));
    const d2 = steps.find((s) => s.round === 2 && s.role === 'death');
    const m2 = d2 && mediaOf(d2.e, d2.role, d2.nth);
    ok(m2 && /r2-clip/.test(m2.clip) && m2.at === 11 && /clip of your death/.test(m2.cap), 'round 2\'s death, its own clip at the death', JSON.stringify(m2));
    const d3 = steps.find((s) => s.round === 3 && s.role === 'death');
    ok(d3 && mediaOf(d3.e, d3.role, d3.nth) === null, 'a death with nothing kept has no moment');
    // The transport.
    RV.play(true);
    ok(RV.open() && RV.state().playing === true && RV.state().i === -1 && v.$('rt-r-round').textContent === 'Kick off', 'it opens at kick off, playing');
    RV.pause();
    ok(RV.state().playing === false && v.$('rt-replay').classList.contains('paused') && v.$('rt-r-toggle').getAttribute('aria-label') === 'Play',
      'paused, it holds, and its button says Play');
    v.clock.advance(10000);
    ok(RV.state().i === -1, 'and nothing moves while it is paused');
    RV.nextEvent();
    const first = RV.state();
    ok(first.i === 0 && v.$('rt-r-label').textContent === steps[0].e.label && v.$('rt-r-said').textContent.startsWith('Round 1,'),
      'the next event, said for a screen reader as it is stepped to by hand', v.$('rt-r-said').textContent);
    for (let k = 0; k < 400 && !/h17-clip/.test((RV.state() || {}).media || ''); k++) RV.nextEvent();
    const at17 = RV.state();
    ok(/h17-clip/.test(at17.media) && v.$('rt-r-media').classList.contains('has-clip') && v.$('rt-r-video').getAttribute('src') === `occlara-clip://review/${ID}/h17-clip.mkv`
      && /^Round 17,/.test(v.$('rt-r-cap').textContent), 'stepping on reaches round 17, its clip on screen', at17.media);
    ok(v.$('rt-r-score').textContent === r.ratingView.rounds[15].score, 'the score as it stood in round 17', v.$('rt-r-score').textContent);
    RV.prevEvent();
    ok(RV.state().i < at17.i && v.$('rt-r-round').textContent === `Round ${steps[RV.state().i].round} of 24`, 'the previous event steps back, drawn whole from the steps before it');
    // 9.1 fixes. Paused, a step holds the moment itself (a hair before it),
    // not the walk up to it: the clip runs in from 1.8 s before only while it plays.
    RV.nextEvent();
    const vid = v.$('rt-r-video');
    if (typeof vid.onloadedmetadata === 'function') vid.onloadedmetadata();
    ok(RV.state().i === at17.i && Math.abs(vid.currentTime - (m17[0].at - 0.1)) < 1e-6, 'paused, a step shows the kill itself, not the walk up to it', vid.currentTime);
    // The rest of round 17: a kill its own moment, and the round's other
    // events (a plant, its end) keep its last moment, never a blank.
    const NONE = 'No clip or frame of this moment was kept';
    const seen17 = [];
    for (let k = 0; k < 40; k++) {
      RV.nextEvent();
      const st = steps[RV.state().i];
      if (!st || st.round !== 17) break;
      seen17.push({ role: st.role, media: RV.state().media, cap: v.$('rt-r-cap').textContent, has: v.$('rt-r-media').classList.contains('has-clip') });
    }
    const rest17 = seen17.filter((x) => x.role !== 'kill' && x.role !== 'death');
    ok(rest17.length >= 1 && rest17.some((x) => x.role === 'end') && rest17.every((x) => /h17-clip/.test(x.media || '') && x.has && x.cap !== NONE),
      'round 17\'s other events, its end with them, keep its clip on screen', JSON.stringify(seen17));
    // A death with nothing kept says so; any other event with nothing before
    // it in its round shows the map and no line.
    const sayAt = (pred) => {
      press(v, 'Home');
      for (let k = 0; k < 400; k++) { const s = RV.state(); if (s.i >= 0 && pred(steps[s.i], s.i)) return { media: s.media, cap: v.$('rt-r-cap').textContent }; if (s.done) return null; RV.nextEvent(); }
      return null;
    };
    const dead3 = sayAt((s) => s.round === 3 && s.role === 'death');
    ok(dead3 && dead3.cap === NONE && /^n\|/.test(dead3.media), 'a death with nothing kept says none was kept', JSON.stringify(dead3));
    const firstOther = sayAt((s, i) => s.e && s.role !== 'kill' && s.role !== 'death'
      && !steps.slice(0, i).some((p) => p.round === s.round && p.e && mediaOf(p.e, p.role, p.nth)));
    ok(firstOther && firstOther.cap === '' && /^n\|$/.test(firstOther.media), 'another event with nothing before it in its round shows the map, no line', JSON.stringify(firstOther));
    RV.finish();
    ok(RV.state().done && v.$('rt-r-round').textContent === 'Full time' && v.$('rt-r-next').disabled && !v.$('rt-r-prev').disabled
      && !v.$('rt-r-again').hidden && v.$('rt-r-skip').hidden, 'at full time: no next, a previous, Watch again');
    ok(/h17-clip\.mkv\|null$/.test(RV.state().media) && v.$('rt-r-video').loop === true && v.$('rt-r-cap').textContent === 'Round 17, 4K, your best highlight',
      'and the match\'s best highlight, looping', `${RV.state().media} ${v.$('rt-r-cap').textContent}`);
    RV.prevEvent();
    ok(!RV.state().done && steps[RV.state().i].e && steps[RV.state().i].round === 24, 'and a step back from full time is the last event');
    RV.stop();
    ok(!RV.open() && v.$('rt-replay').hidden && !v.$('rt-r-video').getAttribute('src'), 'closed, its clip let go');
    // Keys, as a player's, before the page's own Esc.
    RV.play(true);
    const key = (k) => press(v, k);
    key(' ');
    ok(RV.state().playing === false, 'Space pauses');
    key('ArrowRight');
    ok(RV.state().i === 0, 'the right arrow steps on');
    key('Escape');
    ok(RV.state().done && !v.$('rt-replay').hidden, 'Esc goes to full time first');
    // 9.1 fix: at full time Watch again has the keyboard, so Space (pressing
    // the focused button) plays it again; on Close it closed the replay.
    ok(v.document.activeElement === v.$('rt-r-again'), 'at full time, Watch again has the focus', v.document.activeElement && v.document.activeElement.id);
    v.document.activeElement.click();
    ok(RV.open() && RV.state().playing && !RV.state().done && RV.state().i === -1, 'and pressed, it plays again from kick off');
    key('Escape');
    ok(RV.state().done, 'Esc to full time again');
    key('Escape');
    ok(!RV.open() && v.$('rt-replay').hidden, 'and again closes it, the page staying');
    // 9.1 after the review: SPACE PLAYS AND PAUSES WHEREVER THE KEYBOARD IS
    // IN IT, on a step button a click left it on as well (it stepped, against
    // the hint's "Space plays and pauses"); Close, Full time and Watch again
    // are pressed by Space themselves, and Enter presses any button.
    const pressOn = (target, k, type) => {
      const e = makeEvent(type || 'keydown', { key: k, target });
      for (const fn of v.document._listeners[type || 'keydown'] || []) { fn.call(v.document, e); if (e._stopped) break; }
      return e;
    };
    RV.play(true);
    RV.pause();
    RV.nextEvent();
    const at = RV.state().i;
    const sp = pressOn(v.$('rt-r-next'), ' ');
    ok(RV.state().playing === true && RV.state().i === at && sp.defaultPrevented && pressOn(v.$('rt-r-next'), ' ', 'keyup').defaultPrevented,
      'Space on the next step button plays, never steps, and its keyup presses nothing', JSON.stringify(RV.state()));
    pressOn(v.$('rt-r-prev'), ' ');
    ok(RV.state().playing === false, 'and on the previous one pauses again');
    const ent = pressOn(v.$('rt-r-next'), 'Enter');
    const own = pressOn(v.$('rt-r-close'), ' ');
    ok(!ent.defaultPrevented && !own.defaultPrevented && RV.state().playing === false && RV.open(),
      'Enter presses the button it is on, and Space on Close presses Close itself');
    // FULL TIME'S RING (Reviewer 6, bug 12): the line's end ring takes the
    // final number's tier, never the tier of the step it was drawn at last.
    const view = inPage(v.window, 'current').ratingView;
    RV.finish();
    const ring = v.$('rt-r-line').querySelector('.rt-now');
    const tierOf = v.window.RatingBadge.tierOf;
    ok(ring && ring.classList.contains(`t-${tierOf(view.value)}`) && v.window.RatingBadge.TIERS.filter((t) => ring.classList.contains(`t-${t}`)).length === 1,
      'at full time the line\'s end ring is in the final rating\'s tier', ring && ring.className);
    RV.stop();
    // WHILE A MATCH IS RECORDED (html.rec-still, Motion.still): it opens at
    // full time, still, as under less motion, and plays nothing by itself.
    v.document.documentElement.classList.add('rec-still');
    RV.play(false);
    ok(RV.open() && RV.state().done && RV.state().playing === false && v.$('rt-r-round').textContent === 'Full time',
      'opened while a match is recorded, it stands at full time and plays nothing', JSON.stringify(RV.state()));
    RV.stop();
    v.document.documentElement.classList.remove('rec-still');
  }

  // ── Every new line on the page: sentence case, no dash ──────────────────
  {
    const src = read('src/renderer/review/review.js') + read('src/renderer/review/rating-view.js') + read('src/renderer/review/index.html');
    ok(!DASHES.test(src), 'no dash anywhere in the review\'s files');
    ok(!/Practise/.test(src), 'Practice, never Practise');
  }

  try { fs.rmSync(ud, { recursive: true, force: true }); } catch { /* temp */ }
  console.log(fails ? `\nFAIL: ${fails} of ${checks} review page checks failed` : `\nall ${checks} review page checks passed`);
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

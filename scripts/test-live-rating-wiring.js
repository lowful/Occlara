'use strict';

/**
 * THE LIVE RATING'S WIRING (the owner's second exception, 2026-11-26,
 * docs/claude/screen-silence.md "The live rating"). Main decides it, and with
 * the switch off no rating data exists in any window or leaves main:
 *   - live-rating-service.js: with the switch off a frame is not even decoded,
 *     what was kept goes, PUSH_LIVE gets no `rating` key and the widget no
 *     payload; on, only the view's own fields, and the widget's states (live,
 *     idle between matches, "Full time" for a while once Riot's record came);
 *     the live final kept per match and set against the confirmed one;
 *   - index.js, read as text: the read's frame reaches the rating only through
 *     that gate, liveView adds `rating` only through it, the switches are off
 *     by default, the widget's token and port are no page's to write, Settings
 *     never reads the token, an import has no such hook;
 *   - the pages: the Recording screen and the widget draw every string as text.
 *
 * Pure node, no window. Run: npm run test:liveratingwiring
 */
const fs = require('fs');
const path = require('path');
const { createLiveRatingService, pick, wantFeed } = require('../src/main/services/live-rating-service');
const kf = require('../src/shared/killfeed');
const { drawFrame, cut } = require('./fixtures/killfeed-frames');

let checks = 0;
let fails = 0;
function ok(cond, msg) {
  checks++;
  if (cond) console.log(`  ok  ${msg}`);
  else { fails++; console.log(`  FAIL ${msg}`); }
}
const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const T0 = 1_800_000_000_000;
const ctx = { side: 'attacking', phase: 'active', playerAlive: true, teamScore: 0, enemyScore: 0, clock: '1:30', gameMode: 'standard',
  playerHp: 87, playerCredits: 3900, enemiesAlive: 3, playerSpot: 'A Main', map: 'Abyss', agent: 'Jett', agentConfirmed: true };
// A read's record as the reader hands it (its frame is never read here), and
// the recorder's corner rows, drawn and read by the real detector.
const rec = (at, match, extra) => ({ at, image: 'a frame never decoded', round: 1, died: false, match: match === undefined ? T0 : match, ...(extra || {}) });
const rowsOf = (rows) => {
  const fr = drawFrame({ W: 1920, H: 1080, rows });
  return kf.detect(cut(fr, kf.regionOf(1920, 1080)), 1080).list;
};
const KILL = rowsOf([{ slot: 0, killer: 'ally', victim: 'enemy', mine: 'kill', vlen: 0.06 }]);
const tap = (s, at, list, on) => s.feedTap({ at, H: 1080, list }, { on: on !== false });

console.log('The gate: off, nothing is kept');
{
  const s = createLiveRatingService();
  const now = Date.now();
  for (let i = 0; i < 3; i++) ok(s.feed(rec(now + i * 1000), ctx, { on: false }) === false, `off: read ${i + 1} not taken`);
  ok(tap(s, now + 3000, KILL, false) === false && !s.active(), 'off: the recorder\'s rows are dropped');
  ok(s.view() === null && s.field({ on: false, inMatch: true }) === undefined && s.field({ on: true, inMatch: true }) === undefined, 'off: no view and no field');
  ok(s.widget({ on: false, stream: true, inMatch: true }) === null && s.widget({ on: true, stream: false, inMatch: true }) === null, 'either switch off: no widget payload at all');
}

console.log('\nOn: the recorder\'s rows with the reads\' context, and only the view\'s fields');
{
  const s = createLiveRatingService();
  const now = Date.now();
  s.feed(rec(now - 1000), ctx, { on: true });
  ok(s.field({ on: true, inMatch: true, now }).reading === false, 'before the recorder sends any row: not reading, no number');
  for (let i = 0; i < 3; i++) tap(s, now + i * 200, KILL);
  const f = s.field({ on: true, inMatch: true, now: now + 500 });
  ok(f && Object.keys(f).sort().join() === 'last,line,shown,tier,value' && Object.keys(f.last).sort().join() === 'delta,down,label,up',
    `PUSH_LIVE's rating: the value, its tier, the last move and its label, the line (${f && Object.keys(f).join(', ')})`);
  ok(f && f.value > 6 && f.last.label === 'Opening kill', `the player's kill moved it, its label with no numbers standing (${f && f.shown}, "${f && f.last.label}")`);
  ok(!/87|3900|A Main|Abyss|Jett|enemiesAlive|spike|credit|\dv\d/i.test(JSON.stringify(f)), 'nothing of the reader\'s context rides along, and no "4v5"');
  ok(s.field({ on: true, inMatch: false, now }) === undefined, 'not in a match: no field');
  const w = s.widget({ on: true, stream: true, inMatch: true, now: now + 500 });
  ok(w && w.state === 'live' && JSON.stringify(w.rating) === JSON.stringify(f), 'the widget, mid match: the same fields, nothing more');
  ok(JSON.stringify(s.widget({ on: true, stream: true, inMatch: false, now })) === '{"state":"idle"}', 'between matches the widget shows nothing');
  // The recorder's rows stop: not reading, on the screen and the widget.
  const later = now + 500 + 4000;
  ok(JSON.stringify(s.field({ on: true, inMatch: true, now: later })) === '{"reading":false}', 'the recorder\'s rows stopped: "not reading", no number');
  ok(JSON.stringify(s.widget({ on: true, stream: true, inMatch: true, now: later })) === '{"state":"blind"}', 'and the widget says so too');
  // The page stopped for its cost: not reading until it is let read again.
  tap(s, later, KILL);
  s.halt('slow');
  ok(s.field({ on: true, inMatch: true, now: later }).reading === false && s.readingNow(later).why === 'slow', 'stopped for its cost: "not reading"');
  s.halt(null);
  ok(s.field({ on: true, inMatch: true, now: later }).reading !== false, 'let read again: the number is back');
  // The match ends; its confirmed rating comes in.
  const kept = s.end(T0);
  ok(kept && kept.kills === 1, 'the match\'s live final is kept at its end');
  const line = s.compare(T0, { value: 7.2, rounds: 1, version: 1 });
  ok(line && line.confirmed === 7.2 && line.liveKills === 1 && line.gap === Math.round((kept.value - 7.2) * 10) / 10, `set against the confirmed rating, gap ${line && line.gap}`);
  ok(s.compare(T0 + 1, { value: 7 }) === null, 'a match not rated live has nothing to set against');
  const ft = s.widget({ on: true, stream: true, inMatch: false, fullTime: { value: 7.2, until: now + 60000 }, now });
  ok(ft && ft.state === 'final' && ft.rating.shown === '7.2' && Object.keys(ft.rating).sort().join() === 'shown,tier,value', '"Full time": the confirmed number, for a while');
  s.feed(rec(later + 1000), ctx, { on: false });
  ok(s.view() === null && !s.active(), 'switched off: what was kept is gone');
}

console.log('\nOne rating a match id: a new id is a new match, a resume goes back to its own');
{
  const s = createLiveRatingService();
  const now = Date.now();
  s.feed(rec(now, T0), ctx, { on: true });
  for (let i = 1; i <= 3; i++) tap(s, now + i * 200, KILL);
  const a = s.field({ on: true, inMatch: true, now: now + 700 });
  // Match B: its first read carries match A's score.
  s.feed(rec(now + 60000, T0 + 9, { round: 3 }), { ...ctx, teamScore: 1, enemyScore: 0 }, { on: true });
  tap(s, now + 60200, []);
  const b = s.field({ on: true, inMatch: true, now: now + 60300 });
  ok(a.value > 6 && b.value === 6 && b.last === null, `a new match id starts again whatever its first score (${a.value} then ${b.value})`);
  // The reader resumes match A (resumeMatch puts its id back): A's own rating.
  s.feed(rec(now + 61000, T0), ctx, { on: true });
  tap(s, now + 61200, []);
  const back = s.field({ on: true, inMatch: true, now: now + 61300 });
  ok(back.value === a.value, `a match the reader resumes is rated on from its own (${back.value})`);
}

console.log('\nWhen the recorder reads the corner (by what it is asked, not by its text)');
{
  const base = { on: true, game: 'valorant', valorantSession: true, height: 1080, slow: false, lagMs: 200 };
  const cases = [
    [{}, true, null], [{ on: false }, false, 'off'], [{ game: 'lol' }, false, 'game'], [{ valorantSession: false }, false, 'game'],
    [{ height: 480 }, false, 'height'], [{ height: 720 }, true, null], [{ height: undefined }, false, 'height'],
    [{ slow: true }, false, 'slow'], [{ lagMs: 4000 }, false, 'lag'],
  ];
  for (const [over, on, why] of cases) {
    const w = wantFeed({ ...base, ...over });
    ok(w.on === on && w.why === why, `${JSON.stringify(over)}: ${on ? 'read' : 'not read'}${why ? ` (${why})` : ''}`);
  }
  // Round 4: the lag has a gap between letting go (over 1500 ms) and taking
  // back (under 1000 ms), so a recorder hovering at the limit does not switch
  // the feed every second.
  let lagging = false;
  const flips = [];
  for (const lagMs of [1400, 1600, 1450, 1550, 1200, 1100, 900, 1450, 1600]) {
    const w = wantFeed({ ...base, lagMs, wasLagging: lagging });
    lagging = w.lagging;
    flips.push(w.on ? 'on' : 'off');
  }
  ok(flips.join() === 'on,off,off,off,off,off,on,on,off', `the lag lets go over 1500 ms and takes back only under 1000 ms (${flips.join()})`);
  ok(wantFeed({ ...base, lagMs: undefined, wasLagging: true }).on === true, 'no lag reading leaves nothing stuck off');
  // The main recorder, driven: the page is asked only while it records, and
  // a page that stops for its cost is not asked again by itself.
  const { Recorder } = require('../src/main/services/recorder');
  const sent = [];
  const emitted = [];
  const fake = Object.create(Recorder.prototype);
  require('events').EventEmitter.call(fake);
  Object.assign(fake, { page: { send: (m) => sent.push(m) }, state: 'recording', feedOn: false });
  fake.on('feed', () => emitted.push('feed'));
  fake.on('feed-off', () => emitted.push('feed-off'));
  fake.setFeed(true);
  ok(sent.length === 1 && sent[0].type === 'feed' && sent[0].on === true && sent[0].everyMs === 200, 'asked: the page is told to read five a second');
  fake.fromPage(fake.page, 'status', { type: 'feed', at: Date.now(), list: [] });
  fake.fromPage(fake.page, 'status', { type: 'feed-off', why: 'slow', ms: 22 });
  fake.fromPage(fake.page, 'status', { type: 'feed', at: Date.now(), list: [] });
  ok(emitted.join() === 'feed,feed-off' && fake.feedOn === false, 'rows while asked; the page stopping for its cost ends it, and later rows are not taken');
  fake.setFeed(false);
  ok(sent.length === 1, 'already off: nothing more is sent');
  fake.state = 'idle';
  fake.setFeed(true);
  ok(sent.length === 1 && fake.feedOn === true, 'not recording: remembered, asked of the next page when it starts');
}

console.log('\npick: only the view\'s own fields, whatever is handed in');
{
  const p = pick({ value: 6.4, shown: '6.4', tier: 'fair', last: { delta: '+0.4', up: true, down: false, label: 'Kill, 4v5', hp: 87 }, line: [6, 6.4], map: 'Abyss', hp: 87 });
  ok(JSON.stringify(p) === '{"value":6.4,"shown":"6.4","tier":"fair","last":{"delta":"+0.4","up":true,"down":false,"label":"Kill"},"line":[6,6.4]}', 'a stray field never rides along, and the label says what happened alone');
  ok(pick(null) === null && pick({}) === null, 'nothing rated is nothing');
  const L = require('../src/main/services/live-rating-service').liveLabel;
  ok(L('First kill, 5v5') === 'Opening kill' && L('Died first, 4v5') === 'Died first' && L('Kill as the last one up, 1v3') === 'Kill' && L('Spike planted, 5v5') === 'Spike planted'
    && L('Traded a teammate, 3v2') === 'Trade kill' && L('Round won, held to the timer') === 'Round won, held to the timer', 'every live label without the numbers standing');
}

console.log('\nindex.js decides it, read as text');
{
  const idx = read('src/main/index.js');
  ok(/diagnostics: \(rec\) => \{ recordAiFrame\(rec\); feedLiveRating\(rec\); \}/.test(idx), 'the live reader\'s applied reads reach the rating through feedLiveRating');
  ok(/liveRating\.feed\(rec, engine\.matchContext, \{ on: liveRatingSwitch\.on \}\)/.test(idx) && /engine instanceof CoachingEngine\) \|\| !state\.isCoaching\) return;/.test(idx),
    'only the live Valorant reader\'s, and only through the switch');
  ok(/const rated = liveRating\.field\(\{ on: all\.liveRating === true, inMatch: liveRatingSupported\(\), now: Date\.now\(\) \}\);\s*if \(rated\) out\.rating = rated;/.test(idx),
    'liveView adds `rating` only through the gate, with the switch on and a recording at 720p or more');
  ok((idx.match(/out\.rating\s*=/g) || []).length === 1, 'and nowhere else');
  ok(/registry\.sendTo\('main', C\.PUSH_LIVE, view\);/.test(idx) && !/broadcast\(C\.PUSH_LIVE/.test(idx), 'PUSH_LIVE goes to the shell alone');
  ok(/recorder\.setFeed\(want\.on\)/.test(idx) && /wantFeed\(\{ on, game:/.test(idx), 'the recorder is asked through wantFeed: the game, the height, the cost');
  ok(/wasLagging: feedLagging \}\);\s*feedLagging = want\.lagging;/.test(idx), 'the lag\'s state is handed back each time (its gap between off and on)');
  ok(/if \(id !== null && id !== feedMatch\) \{ feedMatch = id; if \(feedSlow\) \{ feedSlow = false;/.test(idx) && /liveRating\.end\(snap\.startedAt\);[^\n]*\n\s*feedSlow = false;/.test(idx),
    'a page stopped for its cost is asked again at the next match, not left off for the whole recording');
  ok(!/decodeFeed|nativeImage\.createFromBuffer\(Buffer\.from\(shot/.test(idx), 'the reads\' own frames are never decoded for the rating');
  ok(/liveRating: all\.liveRating === true, liveRatingStream: all\.liveRating === true && all\.liveRatingStream === true/.test(idx), 'the state says both switches, the widget only with the rating on');
  const iv = read('src/main/services/import-video.js');
  ok(!/liveRating|live-rating|killfeed/.test(iv), 'an import runs its own reader with no such hook: nothing live');
}

console.log('\nThe switches: off by default, the token main\'s alone');
{
  const cfg = read('src/shared/config.js');
  ok(/liveRating:\s+false,/.test(cfg) && /liveRatingStream:\s+false,/.test(cfg), 'both switches off by default');
  const keys = require('../src/main/ipc/config-keys');
  const pw = keys.pageWritable({ liveRating: true, liveRatingStream: true, ratingWidgetToken: 'x'.repeat(40), ratingWidgetPort: 9 });
  ok(pw.liveRating === true && pw.liveRatingStream === true && !('ratingWidgetToken' in pw) && !('ratingWidgetPort' in pw), 'a page writes the two switches, never the widget\'s token or port');
  const ipc = read('src/main/ipc/register-ipc.js');
  ok(!/ratingWidgetToken|ratingWidgetPort/.test(ipc), 'CONFIG_GET hands no page the token or the port');
  const sp = read('src/preload/shell-preload.js');
  ok(/'liveMap', 'liveAgent', 'liveScore', 'liveRound'\]\.includes\(key\)/.test(sp) && !/liveRating/.test(sp), 'the Recording screen\'s own Choose cannot turn the rating on: only Settings, past its warning');
}

console.log('\nThe pages draw it as text');
{
  const shell = read('src/renderer/shell/shell.js');
  const body = shell.slice(shell.indexOf('function paintRating'), shell.indexOf("if (typeof window.occlara.onLive === 'function')"));
  ok(body.length > 200 && !/innerHTML/.test(body), 'the Recording screen sets the rating\'s strings as text');
  const widget = read('src/renderer/rating-widget/widget.js');
  ok(!/innerHTML/.test(widget) && /new EventSource\('events'\)/.test(widget), 'the widget sets its strings as text, from its own events alone');
  const html = read('src/renderer/settings/index.html');
  ok(/Riot does not approve apps that show real-time data that changes how you play/.test(html) && /never what to do/.test(html) && /id="lr-confirm"/.test(html),
    'Settings says it plainly beside the switch and asks before it turns on');
  const words = [html.slice(html.indexOf('id="lr-row"'), html.indexOf('</section>', html.indexOf('id="lr-row"'))), read('src/renderer/rating-widget/widget.html'), widget];
  const DASH = new RegExp('[' + String.fromCharCode(0x2013, 0x2014) + ']');
  ok(words.every((w) => !DASH.test(w)) && DASH.test(String.fromCharCode(0x2014)), 'no dash in what it says');
  const visible = (w) => w.replace(/<!--[\s\S]*?-->/g, ' ').replace(/<style>[\s\S]*?<\/style>|<script>[\s\S]*?<\/script>/g, ' ').replace(/<[^>]+>/g, ' ');
  ok(!/;/.test(visible(words[0])) && !/;/.test(visible(words[1])) && /;/.test(visible('<!-- a; b --><p>one; two</p>')) && !/;/.test(visible('<!-- a; b --><p>one</p>')),
    'no semicolon in what the player reads');
}

console.log(`\n${fails ? fails + ' of ' + checks + ' failed' : 'all ' + checks + ' live rating wiring checks passed'}`);
process.exit(fails ? 1 : 0);

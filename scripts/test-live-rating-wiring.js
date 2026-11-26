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
const { createLiveRatingService, pick } = require('../src/main/services/live-rating-service');
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

// A decode that stands in for nativeImage: the shot names a drawn frame.
const FRAMES = new Map();
let decoded = 0;
function decode(shot) {
  decoded++;
  const fr = FRAMES.get(shot);
  if (!fr) return null;
  return { img: cut(fr, kf.regionOf(fr.width, fr.height)), H: fr.height };
}
const T0 = 1_800_000_000_000;
FRAMES.set('kill', drawFrame({ W: 1280, H: 720, rows: [{ slot: 0, killer: 'ally', victim: 'enemy', mine: 'kill', vlen: 0.06 }] }));
FRAMES.set('empty', drawFrame({ W: 1280, H: 720, rows: [] }));
const ctx = { side: 'attacking', phase: 'active', playerAlive: true, teamScore: 0, enemyScore: 0, clock: '1:30', gameMode: 'standard',
  playerHp: 87, playerCredits: 3900, enemiesAlive: 3, playerSpot: 'A Main', map: 'Abyss', agent: 'Jett', agentConfirmed: true };
const rec = (sec, shot) => ({ at: T0 + sec * 1000, image: shot, round: 1, died: false, match: T0 });

console.log('The gate: off, nothing is read or kept');
{
  const s = createLiveRatingService({ decode });
  decoded = 0;
  for (let i = 0; i < 4; i++) ok(s.feed(rec(10 + i, 'kill'), ctx, { on: false }) === false, `off: frame ${i + 1} not taken`);
  ok(decoded === 0, 'off: no frame was decoded for the rating');
  ok(s.view() === null && s.field({ on: false, inMatch: true }) === undefined && s.field({ on: true, inMatch: true }) === undefined, 'off: no view and no field');
  ok(s.widget({ on: false, stream: true, inMatch: true }) === null && s.widget({ on: true, stream: false, inMatch: true }) === null, 'either switch off: no widget payload at all');
}

console.log('\nOn: the view, and only its fields');
{
  const s = createLiveRatingService({ decode });
  decoded = 0;
  s.feed(rec(10, 'empty'), ctx, { on: true });
  s.feed(rec(11, 'kill'), ctx, { on: true });
  s.feed(rec(12, 'kill'), ctx, { on: true });
  ok(decoded === 3, 'on: each read\'s frame decoded once');
  const f = s.field({ on: true, inMatch: true });
  ok(f && Object.keys(f).sort().join() === 'last,line,shown,tier,value' && Object.keys(f.last).sort().join() === 'delta,down,label,up',
    `PUSH_LIVE's rating: the value, its tier, the last move and its label, the line (${f && Object.keys(f).join(', ')})`);
  ok(f && f.value > 6 && /^First kill, 5v5$/.test(f.last.label), `the player's kill moved it (${f && f.shown}, "${f && f.last.label}")`);
  const text = JSON.stringify(f);
  ok(!/87|3900|A Main|Abyss|Jett|enemiesAlive|spike|credit/i.test(text), 'nothing of the reader\'s context rides along: no HP, credits, spot, map or agent');
  ok(s.field({ on: true, inMatch: false }) === undefined, 'not in a match: no field');
  const w = s.widget({ on: true, stream: true, inMatch: true });
  ok(w && w.state === 'live' && JSON.stringify(w.rating) === JSON.stringify(f) && Object.keys(w).sort().join() === 'rating,state', 'the widget, mid match: the same fields, nothing more');
  ok(JSON.stringify(s.widget({ on: true, stream: true, inMatch: false })) === '{"state":"idle"}', 'between matches the widget shows nothing');
  // The match ends; its confirmed rating comes in.
  const kept = s.end(T0);
  ok(kept && kept.value === f.value && kept.kills === 1, 'the match\'s live final is kept at its end');
  const line = s.compare(T0, { value: 7.2, rounds: 1, version: 1 });
  ok(line && line.live === f.value && line.confirmed === 7.2 && line.gap === Math.round((f.value - 7.2) * 10) / 10 && line.liveKills === 1,
    `set against the confirmed rating: live ${line && line.live}, confirmed 7.2, gap ${line && line.gap}`);
  ok(s.compare(T0 + 1, { value: 7 }) === null, 'a match not rated live has nothing to set against');
  const now = Date.now();
  const ft = s.widget({ on: true, stream: true, inMatch: false, fullTime: { value: 7.2, until: now + 60000 }, now });
  ok(ft && ft.state === 'final' && ft.rating.shown === '7.2' && ft.rating.tier === 'good' && Object.keys(ft.rating).sort().join() === 'shown,tier,value',
    '"Full time": the confirmed number, for a while once Riot\'s record came');
  ok(JSON.stringify(s.widget({ on: true, stream: true, inMatch: false, fullTime: { value: 7.2, until: now - 1 }, now })) === '{"state":"idle"}', 'and then nothing again');
  // Switched off: everything kept goes at once.
  s.feed(rec(20, 'kill'), ctx, { on: false });
  ok(s.view() === null && !s.active(), 'switched off: what was kept is gone');
}

console.log('\npick: only the view\'s own fields, whatever is handed in');
{
  const p = pick({ value: 6.4, shown: '6.4', tier: 'fair', last: { delta: '+0.4', up: true, down: false, label: 'Kill, 4v5', hp: 87 }, line: [6, 6.4], map: 'Abyss', hp: 87 });
  ok(JSON.stringify(p) === '{"value":6.4,"shown":"6.4","tier":"fair","last":{"delta":"+0.4","up":true,"down":false,"label":"Kill, 4v5"},"line":[6,6.4]}', 'a stray field never rides along');
  ok(pick(null) === null && pick({}) === null, 'nothing rated is nothing');
}

console.log('\nindex.js decides it, read as text');
{
  const idx = read('src/main/index.js');
  ok(/diagnostics: \(rec\) => \{ recordAiFrame\(rec\); feedLiveRating\(rec\); \}/.test(idx), 'the live reader\'s applied reads reach the rating through feedLiveRating');
  ok(/liveRating\.feed\(rec, engine\.matchContext, \{ on: liveRatingSwitch\.on \}\)/.test(idx) && /engine instanceof CoachingEngine\) \|\| !state\.isCoaching\) return;/.test(idx),
    'only the live Valorant reader\'s, and only through the switch');
  ok(/const rated = liveRating\.field\(\{ on: all\.liveRating === true, inMatch: true \}\);\s*if \(rated\) out\.rating = rated;/.test(idx), 'liveView adds `rating` only through the gate, with the switch on');
  ok((idx.match(/out\.rating\s*=/g) || []).length === 1, 'and nowhere else');
  ok(/if \(!on\) liveRating\.reset\(\);/.test(idx), 'the switch off: what was kept goes, every tick');
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

'use strict';

/**
 * The live view's tracker: who is recording, reviewing or has the app open,
 * from the requests clients already make, with the licence never stored in
 * what the admin page receives.
 *
 * Run: npm run test:presence
 */

const { Presence, classify, hashOf } = require('../server/services/presence');

let fails = 0;
let checks = 0;
const ok = (cond, what) => {
  checks++;
  if (!cond) { fails++; console.log(`FAIL  ${what}`); } else console.log(`ok    ${what}`);
};

let clock = Date.parse('2026-10-04T18:00:00Z');
const p = new Presence({ now: () => clock });
const KEY = 'GC-AAAA-BBBB-CCCC-DDDD';
const OTHER = 'GC-ZZZZ-YYYY-XXXX-WWWW';

ok(classify('/api/coach/read').kind === 'read' && classify('/api/coach/read').game === 'valorant', 'a live read is recording Valorant');
ok(classify('/api/coach/death-forensics').kind === 'review', 'the death look is a review');
ok(classify('/api/rivals/review').kind === 'review' && classify('/api/rivals/draft').kind === 'read', 'Rivals: the scoreboard is a review, hero select a read');
ok(classify('/api/license/activate').kind === 'license', 'the licence re-check is just the app being open');

p.touch({ key: KEY, path: '/api/coach/read', version: '8.0.1' });
p.touch({ key: KEY, path: '/api/coach/read' });
p.touch({ key: OTHER.toLowerCase(), path: '/api/license/activate' });
let s = p.snapshot();
ok(s.now.recording === 1 && s.now.appOpen === 1 && s.now.seenToday === 2, `one recording, one with the app open (${JSON.stringify(s.now)})`);
const me = s.users.find((u) => u.user === hashOf(KEY));
ok(me && me.state === 'recording' && me.game === 'valorant' && me.version === '8.0.1' && me.readsLastMinute === 2,
  'the recording user shows their game, version and reads a minute');
ok(!JSON.stringify(s).includes(KEY) && !JSON.stringify(s).includes('ZZZZ'), 'no licence key appears in what the admin page receives');
ok(s.users.find((u) => u.user === hashOf(OTHER)), 'keys are matched case insensitively');

clock += 25 * 1000;   // the match ended, the review is being written
p.touch({ key: KEY, path: '/api/coach/match-review' });
s = p.snapshot();
ok(s.users.find((u) => u.user === hashOf(KEY)).state === 'reviewing', 'a review in the last minutes is reviewing');

clock += 5 * 60 * 1000;
s = p.snapshot();
ok(s.users.find((u) => u.user === hashOf(KEY)).state === 'app open', 'five quiet minutes later the app is just open');

clock += 11 * 60 * 1000;
s = p.snapshot();
ok(s.now.online === 0 && s.now.seenToday === 2, 'after ten quiet minutes nobody is online, both were seen today');

clock += 25 * 60 * 60 * 1000;
s = p.snapshot();
ok(s.users.length === 0 && p.keys.size === 0, 'a day later they are forgotten, keys included');

p.touch({ key: 'short', path: '/api/coach/read' });
p.touch({ key: null, path: '/api/coach/read' });
ok(p.snapshot().users.length === 0, 'a request without a real licence is not a user');

p.finish({ path: '/api/coach/read', status: 200, ms: 900 });
p.finish({ path: '/api/coach/read', status: 503, ms: 12000 });
p.error('/api/coach/read', new Error('upstream exploded'));
s = p.snapshot();
const r = s.routes.find((x) => x.route === '/api/coach/read');
ok(r && r.calls === 2 && r.errors5xx === 1 && r.slow === 1 && r.avgMs === 6450, 'routes count calls, server errors and slow calls');
ok(s.errors[0] && /upstream exploded/.test(s.errors[0].message), 'the last errors are kept, newest first');
ok(typeof s.server.uptimeSec === 'number' && s.server.startedAt, 'the server says when it started');

console.log(`\n${fails ? fails + ' of ' + checks + ' failed' : 'all ' + checks + ' presence checks passed'}`);
process.exit(fails ? 1 : 0);

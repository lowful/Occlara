'use strict';

/**
 * Stats repaints its graded matches when a review is saved (PUSH_REVIEWS), and
 * a dashboard call that fails on that push must not wipe the rows already on
 * screen: safeHandle answers { ok:false, error } with no sessions in it, which
 * used to read as an empty library.
 *
 * Run: npm run test:statsrefresh
 */
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { loadSurface, settle } = require(path.join(ROOT, 'scripts/fixtures/fake-dom'));
const C = require(path.join(ROOT, 'src/shared/channels'));
const grade = require(path.join(ROOT, 'src/shared/grade'));

let fails = 0;
const ok = (c, what, detail) => { if (!c) { fails++; console.log('FAIL ', what, detail || ''); } else console.log('ok   ', what); };

(async () => {
  const at = Date.UTC(2026, 9, 1, 20);
  const s = (id, score, i) => ({ id, at: at - i * 3600000, map: 'Abyss', title: 'Jett', grade: { score, letter: grade.letter(score) } });
  let sessions = [s('a', 82, 0), s('b', 58, 1)];
  let failNext = false;
  const dash = () => {
    if (failNext) return { ok: false, error: 'boom' };   // what safeHandle answers when the handler throws
    return { game: 'valorant', statsSupported: true, categories: {}, rank: { value: null, direction: 'flat' },
      winRate: { value: null, direction: 'flat' }, topAgents: [], sessions: sessions.slice(), sessionCount: sessions.length,
      matches: { matches: [], fetchedAt: 0, mode: 'competitive' }, grading: null, riotId: '' };
  };
  const st = loadSurface('stats', {
    handlers: { [C.STATS_DASHBOARD]: dash, [C.STATS_MATCHES]: () => ({ matches: [] }), [C.STATS_RANK_HISTORY]: () => ({ points: [] }) },
  });
  await settle();
  st.clock.flushFrames();
  const rows = () => st.document.querySelectorAll('#session-list .row.session');
  ok(rows().length === 2, 'two graded rows after load');

  failNext = true;
  st.bridge.emit(C.PUSH_REVIEWS, { id: 'a', game: 'valorant' });
  st.clock.advance(500);
  await settle();
  ok(rows().length === 2 && st.$('session-empty').hidden, 'a failed refresh keeps the rows, no empty state',
    `rows ${rows().length}, empty hidden ${st.$('session-empty').hidden}`);

  failNext = false;
  sessions = [s('c', 91, 0), ...sessions];
  st.bridge.emit(C.PUSH_REVIEWS, { id: 'c', game: 'valorant' });
  st.clock.advance(500);
  await settle();
  st.clock.flushFrames();
  ok(rows().length === 3, 'and the next good refresh still lands');
  console.log(fails ? `FAIL: ${fails}` : 'PASS');
  process.exit(fails ? 1 : 0);
})();

'use strict';

/**
 * A FULLER LIBRARY, FOR LOOKING (9.1, Matches): 28 library rows as
 * REVIEWS_LIST hands them out, over three weeks and every time of day, so the
 * grade trend has a run to draw and When you play has enough to name a best
 * and a worst. Evenings go well, late nights badly, afternoons in between,
 * each with spread. Among them a row still being checked, a part too little
 * of was read, one saved with no games left, a provisional grade and an
 * imported recording, so every kind of row is pictured.
 *
 * Rows only, no reviews behind them: scripts/shot-demo.js answers the list
 * with these in its matchesmany scenes. Agents and maps only, never a
 * player's name. Deterministic: the same rows on every run for one `now`.
 *
 * Dev only, never shipped.
 */
const AGENTS = ['Jett', 'Reyna', 'Omen', 'Sova', 'Killjoy', 'Raze', 'Clove', 'Iso'];
const MAPS = ['Abyss', 'Ascent', 'Bind', 'Haven', 'Split', 'Sunset', 'Lotus', 'Pearl', 'Corrode'];
const MISTAKES = ['Deaths nobody traded', 'Dying in the first 30 seconds', 'Peeked alone', 'One enemy agent kept winning', 'Gave back the advantage'];
const MODES = ['Competitive', 'Competitive', 'Swiftplay', 'Unrated'];

function rand(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

/**
 * @param now  the newest match's end, in ms
 * @returns rows, newest first
 */
function manyRows(now) {
  const r = rand(91);
  const pick = (list) => list[Math.floor(r() * list.length)];
  // [days back, hour started, base grade]
  const plan = [];
  const HOURS = [[20, 82], [21, 80], [19, 84], [1, 61], [0, 63], [14, 72], [16, 71], [22, 78], [2, 60]];
  for (let i = 0; i < 26; i++) {
    const [h, base] = HOURS[i % HOURS.length];
    plan.push({ day: Math.floor(i * 0.8), hour: h, base });
  }
  const rows = plan.map((p, i) => {
    const start = new Date(now - p.day * 86400000);
    start.setHours(p.hour, Math.floor(r() * 50), 0, 0);
    // Never a match that has not ended yet: one that would start in the
    // last hour or later is the day before's.
    if (start.getTime() > now - 3600000) start.setDate(start.getDate() - 1);
    const grade = Math.max(38, Math.min(97, Math.round(p.base + (r() - 0.5) * 18)));
    const won = grade + (r() - 0.5) * 24 > 70;
    const us = won ? 13 : Math.floor(4 + r() * 8);
    const them = won ? Math.floor(4 + r() * 8) : 13;
    const at = start.getTime() + (us + them) * 100 * 1000;
    const mode = pick(MODES);
    return {
      id: `valorant-${at}-many${String(i).padStart(2, '0')}`, game: 'valorant', at,
      title: pick(AGENTS), map: pick(MAPS), mode, result: won ? 'Victory' : 'Defeat', score: `${us}-${them}`,
      grade: { score: grade, provisional: false }, topMistake: r() < 0.8 ? pick(MISTAKES) : null,
      rating: { value: (grade / 10) - 1 + r(), shown: String(Math.round(((grade / 10) - 1 + r()) * 10)) },
      verified: true, matchId: `m${i}`, matchStartedAt: start.getTime(), source: 'watched', aiLog: i < 3 ? 'kept' : 'gone', work: null,
    };
  });
  rows.sort((a, b) => b.at - a.at);
  // The kinds of row a library holds, newest first among them.
  rows[1] = { ...rows[1], grade: { score: rows[1].grade.score, provisional: true }, verified: false, matchId: null };
  rows.splice(0, 0, { id: `valorant-${now}-checking`, game: 'valorant', at: now, title: 'Jett', map: 'Lotus', mode: 'Competitive',
    result: 'Victory', score: '13-10', grade: { score: 79 }, work: { path: 'riot', step: 'riot', steps: ['saved', 'riot', 'deaths', 'look', 'writing'] }, aiLog: 'kept' });
  rows.splice(3, 0, { id: `valorant-${now - 5 * 3600000}-part`, game: 'valorant', at: now - 5 * 3600000, title: null, map: 'Haven', mode: null,
    result: null, score: null, grade: null, aiLog: 'kept', work: null });
  rows.splice(7, 0, { id: `valorant-${now - 2 * 86400000}-locked`, game: 'valorant', at: now - 2 * 86400000, title: 'Omen', map: 'Bind', mode: 'Competitive',
    result: 'Defeat', score: '9-13', grade: null, locked: true, verified: true, aiLog: null, work: null });
  rows.splice(10, 0, { id: `valorant-${now - 3 * 86400000}-import`, game: 'valorant', at: now - 3 * 86400000, title: 'Sova', map: 'Ascent', mode: 'Competitive',
    result: 'Victory', score: '13-8', grade: { score: 81 }, imported: true, matchId: 'imp1', verified: true, aiLog: null, work: null });
  rows.sort((a, b) => b.at - a.at);
  return rows;
}

module.exports = { manyRows };

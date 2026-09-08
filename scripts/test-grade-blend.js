'use strict';

/**
 * The session grade, and the scoreboard that is allowed to lift it.
 *
 * THE ROW THIS WAS BUILT FROM is real, out of %APPDATA%\Occlara\performance.json:
 *
 *   scores: { impact: 85, positioning: 45, utility: 60, aim: 75 }
 *   match:  { grade: "S", result: "Victory", acs: 386, kd: 1.83, adr: 252 }
 *   overall: 66
 *   gradedWithMatch: true
 *
 * The scoreboard was already in the grading prompt. The 66 came from `overall`
 * being an unweighted mean that never looked at grade or result.
 */

const g = require('../src/shared/grade-blend');

let checks = 0;
function ok(what, cond) {
  checks += 1;
  if (!cond) { console.error('FAIL: ' + what); process.exit(1); }
}

const REAL = { impact: 85, positioning: 45, utility: 60, aim: 75 };
const S_WIN = { grade: 'S', result: 'Victory' };

// ── The row that started it ─────────────────────────────────────────────────
{
  ok('the category mean is still 66', Math.round(g.categoryMean(REAL)) === 66);
  ok('an S grade victory is worth 96', g.matchScore(S_WIN) === 96);
  ok('the real session now scores 81, not 66', g.overallScore(REAL, S_WIN) === 81);
}

// ── THE FLOOR. The match may only raise. ────────────────────────────────────
{
  // A bad scoreboard is not proof the coaching was wrong, and dragging the
  // number down would kick somebody who already lost.
  const poor = { impact: 55, positioning: 40, utility: 50, aim: 60 };
  const mean = Math.round(g.categoryMean(poor));
  ok('a D grade defeat does not lower the score', g.overallScore(poor, { grade: 'D', result: 'Defeat' }) === mean);
  ok('a C grade defeat does not lower the score', g.overallScore(poor, { grade: 'C', result: 'Defeat' }) >= mean);

  // And it still raises a weak grade when the scoreboard was genuinely good.
  ok('a strong scoreboard lifts a weak grade', g.overallScore(poor, S_WIN) > mean);

  // Every grade, every direction: never below the mean.
  for (const grade of ['S', 'A', 'B', 'C', 'D']) {
    for (const result of ['Victory', 'Defeat']) {
      for (const scores of [REAL, poor, { impact: 90, positioning: 90, utility: 90, aim: 90 }]) {
        const m = Math.round(g.categoryMean(scores));
        ok(`${grade} ${result} never lowers a mean of ${m}`, g.overallScore(scores, { grade, result }) >= m);
      }
    }
  }
}

// ── No verified match means habits alone ────────────────────────────────────
{
  ok('a null match leaves the mean untouched', g.overallScore(REAL, null) === 66);
  ok('an unlinked match leaves the mean untouched', g.overallScore(REAL, {}) === 66);
  ok('an unknown grade leaves the mean untouched', g.overallScore(REAL, { grade: 'Z' }) === 66);
  ok('a match with no grade leaves the mean untouched', g.overallScore(REAL, { result: 'Victory' }) === 66);
}

// ── Winning is worth a little, not a lot ────────────────────────────────────
{
  const win = g.matchScore({ grade: 'B', result: 'Victory' });
  const loss = g.matchScore({ grade: 'B', result: 'Defeat' });
  ok('a victory is worth the bonus and no more', win - loss === g.VICTORY_BONUS);
  ok('the bonus is small', g.VICTORY_BONUS <= 6);
  ok('nothing exceeds 100', g.matchScore({ grade: 'S', result: 'Victory' }) <= 100);
}

// ── Partial and malformed input ─────────────────────────────────────────────
{
  ok('missing categories average what is there', g.categoryMean({ impact: 80, aim: 60 }) === 70);
  ok('no categories at all is null', g.categoryMean({}) === null);
  ok('no categories scores zero rather than NaN', g.overallScore({}, S_WIN) === 0);
  ok('a null scores object does not throw', g.overallScore(null, S_WIN) === 0);
  ok('a non-numeric category is ignored', g.categoryMean({ impact: 'x', aim: 60 }) === 60);
}

// ── The two call sites must not drift ───────────────────────────────────────
{
  // index.js computed the mean inline in TWO places and they were kept in sync
  // by hand. Both now call this helper, so the arithmetic exists once.
  const fs = require('fs');
  const src = fs.readFileSync(require('path').join(__dirname, '..', 'src/main/index.js'), 'utf8');
  const inline = src.split(/\r?\n/).filter((l) =>
    l.indexOf('.impact +') !== -1 && l.indexOf('/ 4') !== -1);
  ok('no inline overall arithmetic is left in index.js', inline.length === 0);
  const calls = (src.match(/gradeBlend\.overallScore\(/g) || []).length;
  ok('both grading sites call the helper', calls === 2);
}

console.log('PASS: all ' + checks + ' grade blend checks passed');

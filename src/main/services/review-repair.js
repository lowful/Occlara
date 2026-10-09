'use strict';

/**
 * Saved reviews whose words a release has since corrected, rebuilt once from
 * what each review saved.
 *
 * RIVALS COMPARISONS SAVED BEFORE 8.0.3 READ BACKWARDS FOR DEATHS. insights.js
 * took up or down from `better`, and fewer deaths is the better way for that
 * one, so a match with more deaths than usual was saved as the mistake
 * "Deaths down 38%", and one with fewer as the strength "Deaths up 38%". The
 * patterns and the breakdown rebuild their titles from the key, but the
 * library row, the review window, the weekly report and Ask Coach read the
 * saved entries. Every Rivals review carries the comparison its insights were
 * made from (`against`), so the entries are made again from it, the same way
 * a review is built today, and nothing else in the review changes.
 *
 * Plain Node, so test-grade.js runs it against a temp library.
 */

/**
 * @param store     a ReviewStore
 * @param insights  src/shared/insights.js
 * @returns the number of reviews rewritten
 */
function repairRivalsTitles(store, insights) {
  let fixed = 0;
  for (const meta of store.list('rivals')) {
    const e = store.get(meta.id);
    const r = e && e.review;
    if (!r || r.kind !== 'rivals' || r.empty || !Array.isArray(r.against)) continue;
    const fresh = insights.rivals(r);
    if (JSON.stringify(fresh) === JSON.stringify(r.insights)) continue;
    store.save({ id: e.id, game: 'rivals', at: e.at, review: { ...r, insights: fresh } });
    fixed++;
  }
  return fixed;
}

module.exports = { repairRivalsTitles };

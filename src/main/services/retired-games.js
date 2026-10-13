'use strict';

/**
 * WHAT AN INSTALL KEPT OF A GAME OCCLARA NO LONGER COACHES, put away at
 * launch (index.js, as the app is ready, before any page can ask for it).
 *
 * Marvel Rivals was coached until 8.3.2 and is not any more (games.js
 * RETIRED). So at every launch, and after the first there is nothing left to
 * do:
 *   - a stored game of it becomes the default, Valorant: the picker has no
 *     button for it any more, and Settings and the shell would have shown no
 *     game chosen at all (config());
 *   - its config keys go: rivalsHistory, the per match records its reviews
 *     were graded against (config());
 *   - its saved reviews are deleted, each with its folder and its library
 *     row, since there is no page left to open one (reviews(), review-store.js
 *     removeRetired()). Until they are, the library never lists or opens one,
 *     so none is counted on Home, in Matches, the patterns, the breakdown or
 *     the weekly report.
 *
 * rivalsTitlesRepaired IS NOT ONE OF ITS KEYS, whatever its name says. A
 * repair of saved reviews wrote it at the first launch of 8.0.3 or later, and
 * keepOldConnection() in index.js reads it to tell an install that ran 8.0.3,
 * the version that brought Connect, from one that never did. The repair is
 * gone; the key stays, written at the first launch as it always was
 * (createAppSurfaces), with exactly that meaning.
 *
 * Plain Node, so test-games.js runs it on a stand-in store and a temp library.
 */

const games = require('../../shared/games');

// The config keys only a retired game wrote.
const KEYS = Object.freeze(['rivalsHistory']);

/**
 * The config, put right.
 *
 * @param store  the config store: get, set, has, delete
 * @returns { game: the retired id it held, or null, keys: the keys dropped }
 */
function config(store) {
  const out = { game: null, keys: [] };
  const stored = store.get('game');
  if (games.isRetired(stored)) {
    store.set('game', games.DEFAULT_GAME);
    out.game = String(stored).toLowerCase();
  }
  for (const key of KEYS) {
    if (store.has(key)) {
      store.delete(key);
      out.keys.push(key);
    }
  }
  return out;
}

/**
 * The saved reviews of a retired game, deleted.
 *
 * @param reviewStore  a ReviewStore
 * @returns how many went
 */
function reviews(reviewStore) {
  return reviewStore.removeRetired();
}

/**
 * Both, each said in one line when it changed anything, and neither able to
 * stop the launch: what fails here is tried again at the next one.
 *
 * @returns { config: config()'s answer, reviews: reviews()'s }
 */
function putAway({ store, reviewStore, log = (...a) => console.log(...a) }) {
  const out = { config: { game: null, keys: [] }, reviews: 0 };
  try {
    out.config = config(store);
    const c = out.config;
    if (c.game || c.keys.length) {
      log(`[games] put away what a retired game kept in the config:${c.game ? ` the game ${c.game} is now ${games.DEFAULT_GAME}` : ''}`
        + `${c.game && c.keys.length ? ',' : ''}${c.keys.length ? ` dropped ${c.keys.join(', ')}` : ''}`);
    }
  } catch (e) {
    log(`[games] the config of a retired game could not be put away: ${e.message}`);
  }
  try {
    out.reviews = reviews(reviewStore);
    if (out.reviews) {
      log(`[reviews] deleted ${out.reviews} saved review${out.reviews === 1 ? '' : 's'} of a game Occlara no longer coaches, with their folders and library rows: none can be opened any more`);
    }
  } catch (e) {
    log(`[reviews] the saved reviews of a retired game could not be deleted: ${e.message}`);
  }
  return out;
}

module.exports = { putAway, config, reviews, KEYS };

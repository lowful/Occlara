'use strict';

/**
 * The games Occlara can coach.
 *
 * One place that answers "what is this app currently about": the name shown to
 * the player, the palette, and, importantly, whether coaching for it actually
 * exists yet. Before this file the answer was implicit, scattered across a
 * hardcoded `game: 'Valorant'` string in two payloads and a require of
 * valorant-data.generated.json at four call sites.
 *
 * `coaching: false` is the honest half of this. A game can be present in the
 * registry, and have a finished palette, long before its coach works. Shipping a
 * picker whose second option silently runs Valorant logic under a different
 * colour scheme would be worse than shipping no picker at all, so an
 * unavailable game is hidden from players entirely and only appears when
 * devGames is switched on in the config.
 */

const GAMES = {
  valorant: {
    id: 'valorant',
    label: 'Valorant',
    // Riot red and cyan on near-black. The historical default, and the reason
    // the brand tokens are still named --red and --cyan.
    palette: null,          // null means "the defaults already in theme.css"
    coaching: true,
    // How the game is read, which differs more than the palette does: Valorant
    // is read every one to five seconds through the match. Nothing is shown to
    // the player during a match in any game: Riot's policy bans "go here now"
    // and names the alternative in the same sentence, "coaching the player
    // game over game". That is the product.
    cadence: 'live',
  },

  lol: {
    id: 'lol',
    label: 'League of Legends',
    palette: null,
    // League is read differently from Valorant, in two ways that matter.
    //
    // 1. Riot's Data Dragon publishes every champion, ability and icon per
    //    patch for third-party use, so League can ship real champion icons.
    //    Separate from that is Riot product registration and approval for a
    //    PAID product, which is a permission to obtain rather than a data
    //    problem.
    //
    // 2. Riot documents a Live Client Data API on 127.0.0.1:2999 that hands
    //    over exact champion names, scores and events during a match, so
    //    nothing has to be read off the screen to know who is playing. That
    //    is a decision to take deliberately rather than drift into, because
    //    it is a NEW KIND OF INPUT for a product whose promise is "we only
    //    capture the display". It is not memory reading, not file access and
    //    not input automation, so it does not break that promise, but the
    //    promise has to be restated rather than quietly widened. It is the
    //    Live Client Data API on 2999, NOT the LCU, which Riot says is
    //    unsupported for third parties.
    //
    // A GAME IS COACHABLE WHEN ANY OF ITS FEATURES IS, which is why League
    // carries a feature map rather than one `coaching` switch: its review is
    // built and its live coach must never be (canCoach below).
    features: {
      learn: true,          // the curriculum surface, no live coaching
      live: false,          // not built, and gated on the decision above
      // Rank, mastery and match history all need a Riot PRODUCTION API key
      // (Account-V1, League-V4, Champion-Mastery-V4, Match-V5). The app has no
      // Riot key of any kind, so there is no League data source at all. Until
      // there is, the dashboard says so instead of showing Valorant's numbers
      // under a League selection. Stated explicitly rather than left to
      // hasFeature's false-by-absence, because the stats dashboard reads it.
      stats: false,
    },
    // `preview` does not mean unfinished, it means SHOWN TO PLAYERS with a
    // preview label, and the label is honest because live coaching genuinely
    // is not built. It stayed false until there was something worth
    // previewing: 173 champions of real data and a twelve lesson curriculum.
    preview: true,
    // Not 'live'. Learning is a player sitting down to study, which is
    // neither a tip stream nor a one-shot read.
    cadence: 'learn',
  },
};

const DEFAULT_GAME = 'valorant';

/**
 * GAMES OCCLARA COACHED ONCE AND NO LONGER DOES. Marvel Rivals was coached
 * until 8.3.2 and is not any more. What an install kept of it is put away at
 * launch (src/main/services/retired-games.js): a stored choice of it becomes
 * the default game, its config keys go, and its saved reviews are deleted.
 * Until they are, the library never lists or opens one (review-store.js).
 * The id is kept here, and nowhere else, so that is possible at all.
 */
const RETIRED = Object.freeze(['rivals']);

/** Is this the id of a game Occlara no longer coaches? */
function isRetired(id) {
  return RETIRED.includes(String(id || '').toLowerCase());
}

/** The game record for an id, falling back to the default rather than throwing. */
function get(id) {
  return GAMES[String(id || '').toLowerCase()] || GAMES[DEFAULT_GAME];
}

/**
 * Games a player may choose.
 *
 * A game appears once it can be coached OR once it is explicitly marked as a
 * preview. Preview means the shell is real and the coach is not, and the label
 * says so, which is the honest middle ground between hiding work that is
 * genuinely finished and pretending a coach exists that does not.
 *
 * @param includeUnavailable reveals games that are neither coachable nor
 *   marked preview, for development only.
 */
function list(includeUnavailable) {
  return Object.values(GAMES).filter((g) => g.coaching || g.preview || includeUnavailable);
}

/**
 * Is this a game we can actually coach right now?
 *
 * True when ANY feature works, since a game whose review is proven and whose
 * live coach does not exist should still review. Valorant carries
 * `coaching: true` and no feature map, so it stays coachable without listing
 * every feature it has.
 */
function canCoach(id) {
  const g = get(id);
  if (g.coaching) return true;
  return Object.values(g.features || {}).some(Boolean);
}

/** Is one specific feature ready for this game? */
function hasFeature(id, name) {
  const g = get(id);
  if (g.features) return !!g.features[name];
  return !!g.coaching;          // a game with no feature map has all of them
}

module.exports = { GAMES, DEFAULT_GAME, RETIRED, isRetired, get, list, canCoach, hasFeature };

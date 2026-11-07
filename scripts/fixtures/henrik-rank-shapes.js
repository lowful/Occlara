'use strict';

/**
 * HenrikDev's richer rank answers, written from the documented schemas
 * (docs.henrikdev.xyz: get-mmr-by-puuid-v3, get-stored-mmr-history-by-puuid-v2,
 * get-player-accolades-by-puuid-v1, read 2026-11-06), with the nulls each
 * schema allows, plus the old v2 mmr and v1 mmr-history shapes the fallbacks
 * still read. No real player: every name is a placeholder and every puuid
 * is made up. test:trackerroutes, test:homemodel and test:rank-band read them.
 */

const ME_PUUID = '11111111-2222-4333-8444-555555555555';
const OTHER_PUUID = '99999999-8888-4777-8666-555555555555';

// MMR v3: current, peak, seasonal, with a leaderboard placement null on the
// current act and set on an older one.
const MMR_V3 = {
  status: 200,
  data: {
    account: { name: 'Me', tag: 'EUW', puuid: ME_PUUID },
    current: {
      tier: { id: 17, name: 'Platinum 3' },
      rr: 54,
      last_change: 18,
      elo: 1454,
      games_needed_for_rating: 0,
      rank_protection_shields: 2,
      leaderboard_placement: null,
    },
    peak: {
      season: { id: '4c4b8cff-43eb-13d3-8f14-96b783c90cd2', short: 'e9a2' },
      ranking_schema: 'base',
      tier: { id: 19, name: 'Diamond 2' },
      rr: 31,
    },
    seasonal: [
      { season: { id: 'a', short: 'e9a1' }, wins: 31, games: 58, end_tier: { id: 18, name: 'Diamond 1' }, end_rr: 12,
        ranking_schema: 'base', act_wins: [{ id: 18, name: 'Diamond 1' }], leaderboard_placement: { rank: 0, updated_at: '2025-01-01T00:00:00Z' } },
      { season: { id: 'b', short: 'e9a2' }, wins: 24, games: 41, end_tier: { id: 17, name: 'Platinum 3' }, end_rr: 54,
        ranking_schema: 'base', act_wins: [], leaderboard_placement: null },
    ],
  },
};

// The same with every optional part null or missing, as a new account sends it.
const MMR_V3_SPARSE = {
  status: 200,
  data: {
    account: { name: 'Me', tag: 'EUW', puuid: ME_PUUID },
    current: { tier: { id: 0, name: 'Unrated' }, rr: 0, last_change: 0, elo: 0, games_needed_for_rating: 5,
      rank_protection_shields: 0, leaderboard_placement: null },
    peak: null,
    seasonal: [],
  },
};

// The v2 mmr the fallback reads, as it has always been shaped.
const MMR_V2 = {
  status: 200,
  data: {
    name: 'Me', tag: 'EUW',
    current_data: { currenttier: 16, currenttierpatched: 'Platinum 2', ranking_in_tier: 40, mmr_change_to_last_game: 20, elo: 1340 },
    highest_rank: { old: false, tier: 18, patched_tier: 'Diamond 1', season: 'e8a3' },
  },
};

const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.parse('2026-11-01T18:00:00Z');

// Stored MMR history v2, newest first, as HenrikDev answers it. The middle
// game was kept by a shield, the one before it refunded RR.
const STORED_V2 = {
  status: 200,
  results: { total: 4, returned: 4, before: 0, after: 0 },
  data: [
    { match_id: 'match-d', tier: { id: 17, name: 'Platinum 3' }, map: { id: 'm', name: 'Ascent' }, season: { id: 's', short: 'e9a2' },
      rr: 54, last_change: 18, elo: 1454, refunded_rr: 0, was_derank_protected: false, date: new Date(T0 + 3 * DAY).toISOString() },
    { match_id: 'match-c', tier: { id: 17, name: 'Platinum 3' }, map: { id: 'm', name: 'Bind' }, season: { id: 's', short: 'e9a2' },
      rr: 36, last_change: 0, elo: 1436, refunded_rr: 0, was_derank_protected: true, date: new Date(T0 + 2 * DAY).toISOString() },
    { match_id: 'match-b', tier: { id: 17, name: 'Platinum 3' }, map: { id: 'm', name: 'Haven' }, season: { id: 's', short: 'e9a2' },
      rr: 36, last_change: -14, elo: 1436, refunded_rr: 7, was_derank_protected: false, date: new Date(T0 + DAY).toISOString() },
    { match_id: 'match-a', tier: { id: 17, name: 'Platinum 3' }, map: { id: 'm', name: 'Lotus' }, season: { id: 's', short: 'e9a2' },
      rr: 50, last_change: 21, elo: 1450, refunded_rr: 0, was_derank_protected: false, date: new Date(T0).toISOString() },
  ],
};

// The v1 mmr-history the fallback reads, newest first, with its match ids.
const HISTORY_V1 = {
  status: 200,
  data: [
    { currenttierpatched: 'Platinum 2', ranking_in_tier: 40, mmr_change_to_last_game: 20, elo: 1340, match_id: 'old-b',
      date: 'Sunday, November 2, 2026 6:00 PM', date_raw: Math.round((T0 + DAY) / 1000) },
    { currenttierpatched: 'Platinum 2', ranking_in_tier: 20, mmr_change_to_last_game: -12, elo: 1320, match_id: 'old-a',
      date: 'Saturday, November 1, 2026 6:00 PM', date_raw: Math.round(T0 / 1000) },
  ],
};

// Accolades v1: two matches, each with the player and another player, an
// accolade of a kind the app has no words for, a null type, and a summary.
const ACCOLADES_V1 = {
  status: 200,
  data: {
    account: { name: 'Me', tag: 'EUW', puuid: ME_PUUID },
    matches: [
      { match_id: 'match-d', started_at: new Date(T0 + 3 * DAY).toISOString(), players: [
        { puuid: ME_PUUID, accolades: [
          { id: 'top_frag', value: 1, is_act_record: false, type: 'top_frag' },
          { id: 'damage_per_round', value: 182.4, is_act_record: true, type: 'damage_per_round' },
          { id: 'aces', value: 1, is_act_record: false, type: 'aces' },
          { id: 'mystery_new_kind', value: 3, is_act_record: true, type: null },
          { id: 'kills', value: 19, is_act_record: false, type: 'kills' },
        ] },
        { puuid: OTHER_PUUID, accolades: [{ id: 'clutches', value: 4, is_act_record: true, type: 'clutches' }] },
      ] },
      { match_id: 'match-x', started_at: null, players: [
        { puuid: OTHER_PUUID, accolades: [{ id: 'aces', value: 2, is_act_record: true, type: 'aces' }] },
      ] },
      { match_id: null, started_at: null, players: [] },
    ],
    summary: {
      all_time: [
        { id: 'aces', count: 4, best_value: 1, type: 'aces' },
        { id: 'clutches', count: 31, best_value: 3, type: 'clutches' },
        { id: 'distinction', count: 9, best_value: 1, type: 'distinction' },
      ],
      seasons: [{ season: { id: 's', short: null }, accolades: [] }],
    },
  },
};

// Accolades with no summary, as the schema allows.
const ACCOLADES_SPARSE = { status: 200, data: { account: { name: 'Me', tag: 'EUW', puuid: ME_PUUID }, matches: [], summary: null } };

module.exports = {
  ME_PUUID, OTHER_PUUID, T0, DAY,
  MMR_V3, MMR_V3_SPARSE, MMR_V2, STORED_V2, HISTORY_V1, ACCOLADES_V1, ACCOLADES_SPARSE,
};

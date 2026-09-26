'use strict';

/**
 * Riot's round by round record of one match, for one player.
 *
 * WHY THIS EXISTS. The post-match review is built from the screen, and the
 * screen is wrong in ways that only show up against Riot's own record. Checked
 * against it, the real 24 round Abyss match in scripts/fixtures read 22 deaths
 * where Riot has 21, invented the extra one in round 17, and put 6 deaths in
 * the first 30 seconds where Riot puts 19 of 21 there. The timing error is the
 * spectator trap: after a death the HUD shows a teammate alive at 100 health,
 * so the coach believes the player lived another half a minute.
 *
 * Riot knows every kill to the millisecond. When the match can be linked, the
 * review uses this, and the screen only fills in what Riot does not record.
 *
 * Takes a HenrikDev v4 match payload (`data`), returns a plain object, never
 * throws. Every field read goes through a fallback, because the v4 shape has
 * moved before (players as an array or as { all_players }, teams as an array
 * or keyed by colour) and a wrong field must degrade to null, not to a wrong
 * number.
 */

const lower = (s) => String(s || '').toLowerCase();

function playersOf(d) {
  if (Array.isArray(d && d.players)) return d.players;
  if (d && d.players && Array.isArray(d.players.all_players)) return d.players.all_players;
  return [];
}

function killsOf(d) {
  if (Array.isArray(d && d.kills)) return d.kills;
  const out = [];
  (Array.isArray(d && d.rounds) ? d.rounds : []).forEach((r, i) => {
    for (const s of (Array.isArray(r.player_stats) ? r.player_stats : (Array.isArray(r.stats) ? r.stats : []))) {
      for (const k of (Array.isArray(s.kill_events) ? s.kill_events : [])) out.push({ round: i, ...k });
    }
  });
  return out;
}

const teamOfPlayer = (p) => lower(p && (p.team_id || p.team));
const idOf = (x) => x && (x.puuid || [x.name, x.tag].filter(Boolean).join('#').toLowerCase()) || null;
const agentOfPlayer = (p) => (p && ((p.agent && p.agent.name) || (typeof p.character === 'string' ? p.character
  : p.character && p.character.name))) || null;

/** Who won a round, as a lowercase team id, whatever the field is called. */
function winnerOf(r) {
  return lower(r && (r.winning_team || r.winningTeam || (r.result && r.result.winning_team)));
}

/** Attackers for a round. Red attacks the first half in every mode. */
function attackersOf(n, halfLength) {
  if (!halfLength) return null;
  if (n <= halfLength) return 'red';
  if (n <= halfLength * 2) return 'blue';
  // Overtime and sudden death swap every round, starting with red.
  return (n - halfLength * 2) % 2 === 1 ? 'red' : 'blue';
}

/**
 * @param d     the v4 `data` object
 * @param name  Riot name
 * @param tag   Riot tag
 */
function parse(d, name, tag) {
  const players = playersOf(d);
  const me = players.find((p) => lower(p.name) === lower(name) && lower(p.tag) === lower(tag));
  const shape = {
    top: d ? Object.keys(d) : [],
    round0: d && Array.isArray(d.rounds) && d.rounds[0] ? Object.keys(d.rounds[0]) : null,
    kill0: killsOf(d)[0] ? Object.keys(killsOf(d)[0]) : null,
    player0: players[0] ? Object.keys(players[0]) : null,
  };
  if (!me) return { error: 'That Riot ID is not in this match.', shape };

  const myTeam = teamOfPlayer(me);
  const myId = idOf(me);
  const agentById = new Map(players.map((p) => [idOf(p), agentOfPlayer(p)]));
  const isMe = (x) => !!x && (idOf(x) === myId
    || (lower(x.name) === lower(name) && lower(x.tag) === lower(tag)));

  const rounds = Array.isArray(d.rounds) ? d.rounds : [];
  const queue = lower(d.metadata && (d.metadata.queue && (d.metadata.queue.id || d.metadata.queue.name)
    || d.metadata.mode));
  const halfLength = /swift/.test(queue) ? 4 : /spike ?rush/.test(queue) ? 3 : (rounds.length ? 12 : null);

  const kills = killsOf(d).map((k) => ({
    // Riot counts rounds from 0. The existing match-deaths route and the 24
    // round fixture both confirm it: round 1 has no death, exactly as the
    // frames show the player alive at 100 health when it ended.
    n: typeof k.round === 'number' ? k.round + 1 : null,
    ms: typeof k.time_in_round_in_ms === 'number' ? k.time_in_round_in_ms
      : (typeof k.kill_time_in_round === 'number' ? k.kill_time_in_round : null),
    killer: k.killer || (k.killer_puuid ? { puuid: k.killer_puuid } : null),
    victim: k.victim || (k.victim_puuid ? { puuid: k.victim_puuid } : null),
    weapon: (k.weapon && (k.weapon.name || k.weapon.type)) || k.damage_weapon_name || null,
  })).filter((k) => k.n);

  const perRound = rounds.map((r, i) => {
    const n = i + 1;
    const inRound = kills.filter((k) => k.n === n).sort((a, b) => (a.ms || 0) - (b.ms || 0));
    const death = inRound.find((k) => isMe(k.victim)) || null;
    const winner = winnerOf(r);
    const attackers = attackersOf(n, halfLength);
    const plant = r.plant || r.plant_events || null;
    const plantMs = plant && (typeof plant.round_time_in_ms === 'number' ? plant.round_time_in_ms
      : typeof plant.plant_time_in_round === 'number' ? plant.plant_time_in_round : null);
    return {
      n,
      won: winner ? winner === myTeam : null,
      side: attackers ? (attackers === myTeam ? 'attacking' : 'defending') : null,
      kills: inRound.filter((k) => isMe(k.killer)).length,
      died: !!death,
      deathMs: death ? death.ms : null,
      killerAgent: death && death.killer ? (agentById.get(idOf(death.killer)) || null) : null,
      weapon: death ? death.weapon : null,
      // The first death of the round belongs to one of ten players, and being
      // it on repeat is the most specific thing a review can say about entries.
      firstDeath: !!(inRound[0] && isMe(inRound[0].victim)),
      firstKill: !!(inRound[0] && isMe(inRound[0].killer)),
      planted: !!(plant && (plant.site || plant.plant_site || plantMs !== null)),
      plantMs,
      // A death after the spike went down is a post-plant death, never "early".
      afterPlant: !!(death && plantMs !== null && death.ms !== null && death.ms > plantMs),
    };
  });

  const st = me.stats || {};
  const teams = Array.isArray(d.teams) ? d.teams : (d.teams && typeof d.teams === 'object'
    ? Object.entries(d.teams).map(([id, t]) => ({ team_id: id, ...t })) : []);
  const roundsWon = (t) => {
    const r = t && t.rounds;
    const v = r && (r.won != null ? r.won : r.win);
    return typeof v === 'number' ? v : (t && typeof t.rounds_won === 'number' ? t.rounds_won : null);
  };
  const mine = teams.find((t) => lower(t.team_id) === myTeam);
  const theirs = teams.find((t) => lower(t.team_id) !== myTeam);
  const my = roundsWon(mine);
  const their = roundsWon(theirs);

  return {
    map: (d.metadata && d.metadata.map && (d.metadata.map.name || d.metadata.map)) || null,
    queue: queue || null,
    rounds: rounds.length,
    me: {
      agent: agentOfPlayer(me),
      kills: typeof st.kills === 'number' ? st.kills : null,
      deaths: typeof st.deaths === 'number' ? st.deaths : null,
      assists: typeof st.assists === 'number' ? st.assists : null,
    },
    score: my !== null && their !== null ? `${my}-${their}` : null,
    result: my !== null && their !== null ? (my > their ? 'Victory' : my < their ? 'Defeat' : 'Draw') : null,
    perRound,
    shape,
  };
}

module.exports = { parse, attackersOf, killsOf, playersOf };

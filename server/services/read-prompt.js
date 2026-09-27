'use strict';

/**
 * The per-frame READ prompt: facts only, no coaching.
 *
 * WHY THIS EXISTS. Occlara no longer shows anything during a match. The coach
 * reads the game live and reviews it afterwards, so a frame has exactly one job:
 * report what the HUD shows. The old /analyze prompt was about 15,000 tokens,
 * and nearly all of it taught the model how to write a tip a player would read
 * mid fight: tone, repetition, buy phase bars, playbook notes, recent tips.
 * None of that is needed to read a score. This prompt keeps every rule that
 * protects a FACT and drops every rule about advice, which is what makes it
 * cheap and fast enough to read the game every one to three seconds.
 *
 * THE STATE SHAPE IS UNCHANGED, and that matters more than anything else here.
 * mapState() in routes/coach.js parses it exactly as it parses the /analyze
 * reply, so every client guard (map lock, label fingerprint, scoreboard
 * continuity, HP beats death, spectate tells) keeps working untouched.
 *
 * Each rule below is here because of a measured failure recorded beside the
 * same rule in the old prompt: the spectator HUD read as the player's own
 * health, a round number inferred from a "last round before swap" banner, a
 * callout from another map, a map carried over from the previous match.
 */

const FIELDS = `STATE: {"side":null,"phase":null,"round":null,"clock":null,"team":null,"enemy":null,"credits":null,"hp":null,"alive":null,"aliveTell":null,"mates":null,"foes":null,"weapon":null,"ult":null,"map":null,"mode":null,"mmPos":null,"locLabel":null,"playerSpot":null,"enemySpot":null,"push":null,"pushOnSite":null,"spike":null,"spikeSpot":null,"killFeed":null,"teamRead":null,"note":null}`;

function contextLine(ctx) {
  const c = ctx || {};
  const bits = [];
  if (c.agent) bits.push(`agent ${c.agent}`);
  if (c.map) bits.push(`map ${c.map}`);
  if (c.side) bits.push(`side ${c.side}`);
  if (typeof c.teamScore === 'number' && typeof c.enemyScore === 'number' && (c.teamScore || c.enemyScore)) {
    bits.push(`last score read ${c.teamScore}-${c.enemyScore}`);
  }
  if (c.playerAlive === false) bits.push('the player was DEAD on the last frame');
  if (c.gameMode) bits.push(`mode ${c.gameMode}`);
  return bits.length
    ? `WHAT THE LAST FRAMES SHOWED (context only, the current frame decides every field): ${bits.join(', ')}.`
    : '';
}

function buildReadPrompt(ctx) {
  return `You are reading one Valorant screenshot for a match recorder. You do not coach and you do not advise. You report what the screen shows.

If the screen is NOT live gameplay (main menu, lobby, agent select, loading screen, career or collection page, range with no match, end of match screen), reply with exactly LOBBY and nothing else.

Otherwise reply with exactly one line and nothing else:
${FIELDS}

Every field is null unless you can READ it on screen. A guess is worse than a null, because every later reading and the post match review are built on these values.

${contextLine(ctx)}

- alive and aliveTell: CHECK THIS FIRST. Is the player's OWN health number visible at the bottom-center with their OWN weapon and abilities at the bottom-left? Yes: alive true, aliveTell names what you saw ("own HP 87 and Vandal bottom left"). No: alive false, and aliveTell names the dead tell: the word "Spectating", a teammate's portrait and name above "SWITCH PLAYER" bottom-left, "KILLED BY" upper right, a "COMBAT REPORT", a killcam, or no own health number at all. WHILE SPECTATING THE HEALTH NUMBER BELONGS TO THE TEAMMATE BEING WATCHED: report hp null and alive false. A flash, a smoke or a scope is not death.
- hp: the player's OWN health number at the bottom-center, else null. Never estimate, never carry over.
- team, enemy, round: read the TWO SCORE DIGITS at the top-center, team is your side's score. round = team + enemy + 1. NEVER infer the round from a banner like "LAST ROUND BEFORE SWAP" or "MATCH POINT"; if the digits are unreadable all three are null.
- phase: "buy" (barriers up), "active" (round live), "postplant" (spike down), "dead" (player dead or spectating).
- clock: the round timer at the top-center exactly as shown ("1:12"). After a plant it is the spike timer.
- side: in the buy phase read the ATTACKING or DEFENDING banner at the top, it is authoritative. Otherwise "attack" if your team has the spike, "defense" if you see a defuser, else null.
- mode: only when printed on screen (SWIFTPLAY, COMPETITIVE, UNRATED), else null.
- locLabel: the location text the game prints beside the top-left of the minimap ("Mid Top", "A Lobby"). Copy it EXACTLY, never substitute a callout you think fits better.
- mmPos: where the player's own YELLOW arrow sits on the minimap as [across, down], with the minimap's top-left [0,0] and bottom-right [1,1]. Null if the minimap rotates or the arrow is not visible.
- playerSpot: a plain words location only when locLabel is not printed, using callouts that exist on this map, else null.
- map: from the minimap's layout, only when sure, never carried over from a previous match.
- mates: other teammates alive (0 to 4); foes: enemies alive (0 to 5), from the portraits along the top bar.
- weapon: what is in the player's hands, "Knife" counts.
- ult: "ready" only when the ultimate icon is clearly charged, "charging" when its pips are visibly incomplete, else null.
- credits: only in the buy phase when readable.
- enemySpot: where a RED enemy icon or question mark sits on the minimap, as a short callout, else null.
- push: "<count> <site> <live|stale>" when enemy marks cluster toward one site ("3 B live"), else null. pushOnSite: true when those marks are already inside the site.
- spike: "planted", "carried" or "dropped" when visible; spikeSpot: where, as a short callout.
- killFeed: what the kill feed at the top-right just showed, in a few words ("player got the opening pick", "we lost two in a trade"), else null.
- teamRead: where the BLUE teammate icons are relative to the YELLOW player icon ("4 blue going A, player alone mid"), during the buy phase and the first seconds of a round, and again when the plan visibly changes. Else null.
- note: ONE short factual observation of what the player is doing or where they stand ("holding Hookah alone", "pushed alone with no trade", "last alive in a 1v2 post plant"). Only what you can see, never advice, null when nothing notable.

Use commas, never dashes. No markdown, no preamble, no second line.`;
}

module.exports = { buildReadPrompt, FIELDS };

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

/*
 * VARIANT B (8.4.1), FOR THE BENCH ONLY. routes/coach.js serves it when an
 * admin bench names it (readVariant, beside the admin password as a bench
 * model is) and never to a player, so the live prompt below is the one every
 * install reads with, byte for byte as it was. It becomes the default only
 * once npm run verify:ai has passed it live, plain and with --lag 4.
 *
 * On the player's Fracture swiftplay of 14 Oct the live prompt registered two
 * deaths of a living player, one of them filed in a round Riot has them
 * surviving:
 *   - it offers "the word Spectating" as a dead tell and hands the model a
 *     sentence to copy, "a teammate's portrait and name above SWITCH PLAYER",
 *     which came back word for word on frames of a living player whose only
 *     cue was the SPECTATORS 1 counter, and it never says what that counter is
 *   - it says a planted spike has a timer, and Valorant prints none: the
 *     round timer gives way to the spike icon
 * B drops the word, says what the counter is, asks for the death screen's
 * words only when they are printed on the frame, with no sentence to copy,
 * and says there is no clock after a plant. Only these two entries differ,
 * b's alive one a line longer for the counter (three lines of the prompt in
 * all); the STATE line is the same, so mapState() reads either reply alike.
 *
 * VARIANT C, FOR THE BENCH ONLY AS B IS, and served the same way. b's bench
 * of 14 Oct, judged frame by frame against Riot's record over four real
 * sessions, did not replace the live prompt: on the three current sessions
 * the live prompt caught 24 of Riot's 24 deaths and b 21, and where the two
 * disagreed on dead or alive the frames sided with the live prompt 74 times
 * to 22. Nearly all of it was the buy phase, where the COMBAT REPORT of the
 * round before, KILLED BY at its top, is still on screen over a living
 * player: 111 buy frames read dead on b, 59 on the live prompt. c keeps b's
 * one clean win, no "Spectating" and no sentence to copy (the live prompt's
 * "portrait" tell came back 36 times, five of them on a living player), and:
 *   - is dead only on SWITCH PLAYER, a COMBAT REPORT with ROUND ONGOING at its
 *     foot, or no health number at all: every dead frame judged printed one of
 *     them, and no buy phase frame did (its report lists the abilities)
 *   - says the buy phase is never death, banner by banner
 *   - names what is no sign of death, each a frame read dead on a living
 *     player: the SPECTATORS counter, the skull of the player's own kill
 *     banner, the kill feed, the scoreboard, a WON, LOST or FLAWLESS banner
 *   - asks for no word the frame does not print and none saying a word is
 *     absent: each of b's nine tells saying one was not there ("SWITCH PLAYER
 *     not shown") was a death to the server, whose tell rule reads the words
 *     and not the negation
 *   - says alive null when it cannot tell, where b's "what you see in place of
 *     the health" wrote "no own HP shown" on a living player and cost a round
 *   - keeps the printed timer until the spike icon takes its place: b's "no
 *     timer after a plant" dropped round clocks of 0:19 and 0:06 and called
 *     both a plant, and the engine refuses a plant only on a running clock
 * and keeps 120 characters of the tell (TELL_MAX in routes/coach.js), where
 * 90 cut "SPECTATORS 1" to "SPECTATOR", which reads as a spectator screen.
 * c's alive entry is three lines where the live one is one, its clock entry
 * one, and nothing else of the prompt or the STATE line moves. It replaces
 * the live prompt only once three runs of each, interleaved over the four
 * sessions on one upstream, each frame sent the engine's own context
 * (readContext) and scored by time against Riot, show it missing no death the
 * live prompt caught, inventing no more deaths or plants, reading fewer buy
 * frames dead in every session and no more LOBBY, and passing verify:ai plain
 * and at --lag 4, its cost a read within a tenth of the live prompt's.
 */
/*
 * C IS THE LIVE PROMPT SINCE 15 OCT 2026, and the prompt every install read
 * with before it is variant a, kept byte for byte for the benches to measure
 * against. Three runs of each, interleaved over the four real sessions on one
 * upstream, each frame sent the engine's own context and scored by time
 * against Riot (npm run bench:sessions), c against it:
 *   - invented deaths 4.33 a run against 7.33, no real death it caught missed
 *   - real deaths caught: the Abyss 17.3 of 21 against 15, the Split 16 of 16
 *     against 15.7, the Sunset 5 of 5 and the Fracture 3 of 3 both
 *   - buy frames read dead 0.5 to 4.1% against 8.2 to 32.8%, in every session
 *   - LOBBY replies 10.7 against 38 (the false menus that ended a match early)
 *   - invented plants 1.33 both; verify:ai PASSED plain and at --lag 4
 *   - a read cost 12.7% more ($0.0003173 against $0.0002816), its prompt
 *     about 1,000 characters longer: past the tenth the bench allowed, and the
 *     player chose c for the rest
 * The live tell keeps 120 characters (TELL_MAX in routes/coach.js), a's 60.
 */
const VARIANTS = ['a', 'b', 'c'];
const LINES = {
  alive: {
    a: `- alive and aliveTell: CHECK THIS FIRST. Is the player's OWN health number visible at the bottom-center with their OWN weapon and abilities at the bottom-left? Yes: alive true, aliveTell names what you saw ("own HP 87 and Vandal bottom left"). No: alive false, and aliveTell names the dead tell: the word "Spectating", a teammate's portrait and name above "SWITCH PLAYER" bottom-left, "KILLED BY" upper right, a "COMBAT REPORT", a killcam, or no own health number at all. WHILE SPECTATING THE HEALTH NUMBER BELONGS TO THE TEAMMATE BEING WATCHED: report hp null and alive false. A flash, a smoke or a scope is not death.`,
    b: `- alive and aliveTell: CHECK THIS FIRST. Is the player's OWN health number visible at the bottom-center with their OWN weapon and abilities at the bottom-left? Yes: alive true, aliveTell names what you saw ("own HP 87 and Vandal bottom left"). No: alive false, and aliveTell names the evidence on THIS frame. The death screen prints SWITCH PLAYER at the bottom-left, KILLED BY at the upper right and a COMBAT REPORT panel: write those words in aliveTell only when they are printed on this frame, never because you expect them there. With none of them printed, aliveTell names what you see in place of the player's own health and loadout. WHILE SPECTATING THE HEALTH NUMBER BELONGS TO THE TEAMMATE BEING WATCHED: report hp null and alive false. A flash, a smoke or a scope is not death.
- SPECTATORS and a number at the top right counts the people watching the player on screen. A living player sees it, so it is never a sign of death, and it is no sign of life either: decide alive from the health number and the death screen, never from it, and never write it in aliveTell.`,
    c: `- alive and aliveTell: CHECK THIS FIRST. Is the player's OWN health number visible at the bottom-center with their OWN weapon and abilities at the bottom-left? Yes: alive true, aliveTell names what you saw ("own HP 87 and Vandal bottom left"), however low or red the number is. The player is dead only when this frame prints SWITCH PLAYER at the bottom-left, or a COMBAT REPORT panel with KILLED BY at its top and ROUND ONGOING at its foot, or shows no health number at the bottom-center at all. Then alive false, and aliveTell names which of these is on this frame, never a word the frame does not print and never a word to say it is absent. WHILE SPECTATING THE HEALTH NUMBER BELONGS TO THE TEAMMATE BEING WATCHED: report hp null and alive false. If you cannot tell, alive null.
- THE BUY PHASE IS NEVER DEATH. Each round opens with the COMBAT REPORT of the round before still on screen, KILLED BY at its top when the player died in it, beside a BUY PHASE, LAST ROUND BEFORE SWAP or MATCH POINT banner with PRESS B TO BUY: the player is alive, so alive true, and aliveTell names the own health and loadout, never that panel.
- None of these is a sign of death, and none goes in aliveTell: SPECTATORS and a number at the top right (it counts who is watching the player), a skull icon at the bottom-center (the player's own kill banner), a name in the kill feed, the scoreboard, the map, the buy menu, a WON, LOST or FLAWLESS banner, a flash, a smoke or a scope.`,
  },
  clock: {
    a: `- clock: the round timer at the top-center exactly as shown ("1:12"). After a plant it is the spike timer.`,
    b: `- clock: the round timer at the top-center exactly as shown ("1:12"). Once the spike is planted the game shows the spike icon there and no timer at all: clock null.`,
    c: `- clock: the timer at the top-center exactly as shown ("1:12"). When the spike icon stands in its place there is no timer: clock null. A timer still counting there means the spike is not down: then phase is not "postplant" and spike is not "planted".`,
  },
};
// The live prompt is c's, word for word; a bench naming c is read with it.
LINES.alive.live = LINES.alive.c;
LINES.clock.live = LINES.clock.c;

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

/**
 * @param ctx      what the last applied read showed (contextLine)
 * @param variant  'a', 'b' or 'c' for a bench's variant ('c' is the live
 *                 prompt's own text), anything else the live prompt
 */
function buildReadPrompt(ctx, variant) {
  const v = VARIANTS.includes(variant) ? variant : 'live';
  return `You are reading one Valorant screenshot for a match recorder. You do not coach and you do not advise. You report what the screen shows.

If the screen is NOT live gameplay (main menu, lobby, agent select, loading screen, career or collection page, range with no match, end of match screen), reply with exactly LOBBY and nothing else.

Otherwise reply with exactly one line and nothing else:
${FIELDS}

Every field is null unless you can READ it on screen. A guess is worse than a null, because every later reading and the post match review are built on these values.

${contextLine(ctx)}

${LINES.alive[v]}
- hp: the player's OWN health number at the bottom-center, else null. Never estimate, never carry over.
- team, enemy, round: read the TWO SCORE DIGITS at the top-center, team is your side's score. round = team + enemy + 1. NEVER infer the round from a banner like "LAST ROUND BEFORE SWAP" or "MATCH POINT"; if the digits are unreadable all three are null.
- phase: "buy" (barriers up), "active" (round live), "postplant" (spike down), "dead" (player dead or spectating).
${LINES.clock[v]}
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

module.exports = { buildReadPrompt, FIELDS, VARIANTS };

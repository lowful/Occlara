'use strict';

/**
 * A START THAT NEVER REACHES A GAME IS CANCELLED (owner, 2026-11-09: "make
 * sure that when a user starts but doesn't go into a game it cancels that").
 *
 * Until this, Start ran until Stop whatever happened: a player who pressed
 * Start and then never opened Valorant, or left it in its menus and walked
 * away, kept the reader sending a read every 5 to 10 seconds (read-cadence.js,
 * menus) for hours, a recording session open and an AI log folder made. No
 * game was counted for it, since only a read the server calls in a match
 * reserves one (server/routes/coach.js inMatchState, usage.js noteRead), but
 * nothing ever ended it either.
 *
 * NEVER ENTERED A GAME means: since Start (or the last resume) no reply was
 * anything but LOBBY (engine.sawGame) and the ledger holds no round. Every
 * reply the server could have reserved a game on is one that is not LOBBY, so
 * a session this watch may cancel has reserved nothing, and there is nothing
 * to release. The first reply that is not LOBBY disarms the watch for the rest
 * of the session: after a match, sitting in the menus is the app's ordinary
 * between matches state, not a Start that never reached a game.
 *
 * TWO RULES, each its own evidence, both only while armed and not paused:
 *
 *   NO_GAME_PROCESS_MS (5 min): neither Valorant nor Riot's client is running
 *     (the process list, tasklist, read by name only, as Task Manager shows
 *     it: nothing of the game is read or touched). Nobody can queue without
 *     the game open, and Valorant cannot run without Riot's client, so a
 *     renamed game executable never counts as gone while the client is up.
 *     Riot's client up alone (launching, patching) is never gone. Five
 *     minutes covers launching the game after pressing Start, Vanguard and
 *     the client's own start included.
 *
 *   MENUS_ONLY_MS (30 min): the game open, every reply LOBBY (menus, the
 *     queue, agent select, loading all read as LOBBY, read-prompt.js), with
 *     one read LOBBY within LOBBY_FRESH_MS so the menus are seen, not assumed
 *     (reads failing, a capped account's reads stopped: never cancelled on
 *     that). Thirty, not less, because a queue cannot be told from the main
 *     menu on screen and a cancel in a queue loses the whole match's review:
 *     high rank and off hour competitive queues run past ten minutes, a dodge
 *     sends the player back to queue, and agent select (85 s) and loading
 *     follow. Its cost is small: menus are read every 10 s after three
 *     minutes (read-cadence.js), about 190 reads in 30 minutes.
 *
 * A probe that cannot tell (not Windows, tasklist failing) never cancels by
 * the first rule. A pause restarts both clocks.
 *
 * Plain Node, the clock and the process list handed in: scripts/test-no-game.js.
 */

const NO_GAME_PROCESS_MS = 5 * 60 * 1000;
const MENUS_ONLY_MS = 30 * 60 * 1000;
const LOBBY_FRESH_MS = 2 * 60 * 1000;
const TICK_MS = 15 * 1000;
const NOTICE = 'Stopped watching: no game started. Press Start when you are ready.';

// Lower case image names. The game itself, and what launches it.
const GAME_EXES = ['valorant-win64-shipping.exe'];
const LAUNCHER_PREFIXES = ['valorant', 'riotclient'];

/** tasklist /FO CSV /NH, read into a set of lower case image names. */
function parseTasklist(text) {
  const names = new Set();
  for (const line of String(text || '').split(/\r?\n/)) {
    const m = line.match(/^\s*"([^"]+)"/);
    if (m) names.add(m[1].trim().toLowerCase());
  }
  return names;
}

/** 'game', 'launcher', 'none', or null when the list says nothing. */
function stateOf(names) {
  if (!names || !names.size) return null;
  for (const n of names) if (GAME_EXES.includes(n)) return 'game';
  for (const n of names) if (LAUNCHER_PREFIXES.some((p) => n.startsWith(p))) return 'launcher';
  return 'none';
}

/** Whether Valorant runs now: 'game', 'launcher', 'none', or null (cannot tell). Never throws. */
function probeValorant(deps = {}) {
  const platform = deps.platform || process.platform;
  if (platform !== 'win32') return Promise.resolve(null);
  const exec = deps.exec || require('child_process').execFile;
  return new Promise((resolve) => {
    try {
      exec('tasklist', ['/FO', 'CSV', '/NH'], { windowsHide: true, timeout: 10000, maxBuffer: 4 * 1024 * 1024 },
        (err, out) => resolve(err ? null : stateOf(parseTasklist(out))));
    } catch { resolve(null); }
  });
}

/**
 * The watch for one session. arm() at Start; check() on every tick with what
 * the reader and the probe say; a non null answer ({ reason }) is the cancel.
 */
function createNoGameWatch(opts = {}) {
  const now = typeof opts.now === 'function' ? opts.now : Date.now;
  const processMs = Number.isFinite(opts.processMs) ? opts.processMs : NO_GAME_PROCESS_MS;
  const menusMs = Number.isFinite(opts.menusMs) ? opts.menusMs : MENUS_ONLY_MS;
  const freshMs = Number.isFinite(opts.lobbyFreshMs) ? opts.lobbyFreshMs : LOBBY_FRESH_MS;
  let armed = false;
  let since = 0;
  let goneSince = null;
  return {
    arm() { armed = true; since = now(); goneSince = null; },
    disarm() { armed = false; },
    armed: () => armed,
    check(s = {}) {
      if (!armed) return null;
      const t = now();
      if (s.sawGame) { armed = false; return null; }
      if (s.paused) { since = t; goneSince = null; return null; }
      if (s.process === 'none') {
        if (goneSince === null) goneSince = Math.max(t, since);
        if (t - goneSince >= processMs) return { reason: 'no-game-process' };
      } else {
        goneSince = null;
      }
      const lobbyAt = Number(s.lastLobbyAt) || 0;
      if (t - since >= menusMs && s.inLobby && lobbyAt && t - lobbyAt <= freshMs) return { reason: 'menus' };
      return null;
    },
  };
}

module.exports = {
  NO_GAME_PROCESS_MS, MENUS_ONLY_MS, LOBBY_FRESH_MS, TICK_MS, NOTICE,
  parseTasklist, stateOf, probeValorant, createNoGameWatch,
};

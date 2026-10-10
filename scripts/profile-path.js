'use strict';

/**
 * Where a real player profile lives on this machine.
 *
 * The folder moved from "%APPDATA%\GhostCoach 2.0" to "%APPDATA%\Occlara", and
 * the store file inside it from ghostcoach-config.json to occlara-config.json.
 * Dev scripts read an actual installed profile (verify:ai grades a real session,
 * review:log reads real AI logs), so they have to find it on EITHER side of that
 * move: whoever is running them may still have an older build installed, which
 * has not migrated yet and never will until it is launched.
 *
 * Prefers the new location, falls back to the old, and returns the new one when
 * neither exists so callers report a sensible path in their "not found" message.
 */
const fs = require('fs');
const path = require('path');

function firstThatExists(candidates) {
  for (const c of candidates) { if (fs.existsSync(c)) return c; }
  return candidates[0];
}

function profileDir(appData) {
  const base = appData || process.env.APPDATA || '';
  return firstThatExists([
    path.join(base, 'Occlara'),
    path.join(base, 'GhostCoach 2.0'),
  ]);
}

function configPath(dir) {
  const root = dir || profileDir();
  return firstThatExists([
    path.join(root, 'occlara-config.json'),
    path.join(root, 'ghostcoach-config.json'),
  ]);
}

/**
 * The recorded session a bench reads (bench:read, so verify:ai, and
 * bench:forensics), and every folder it was looked for in: a copy kept in
 * userData/bench first, then the AI log itself.
 *
 * THE AI LOG KEEPS ONLY THE FIVE NEWEST SESSIONS, and the app prunes the rest
 * at every Start (AI_LOG_KEEP_SESSIONS in src/main/index.js), so the real
 * match verify:ai is gated on goes the moment a player has recorded five
 * since. Nothing ever prunes bench/. A folder counts only with its log.json in
 * it; `dir` is null when no folder has one, and `looked` is what to name then.
 */
function benchSession(root, session) {
  const looked = [path.join(root, 'bench', session), path.join(root, 'ai-log', session)];
  return { dir: looked.find((d) => fs.existsSync(path.join(d, 'log.json'))) || null, looked };
}

module.exports = { profileDir, configPath, benchSession };

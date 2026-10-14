'use strict';

/**
 * Turn one AI log session into a fixture the engine can be replayed with.
 *
 * The fixtures in this folder are public, so a session goes through here before
 * it is committed: no frames, no notes, no team plans, and every free text
 * field the guards read (the alive tell, the kill feed) cut down to words from
 * an allowlist, which drops every player name while keeping what the spectator
 * and death checks look for ("Spectating", "SWITCH PLAYER", "KILLED BY Sage"),
 * a placeholder where a word went. Nothing is written while the fixture holds
 * a word no list knows, or one of the Riot ID in Settings (leaks, below).
 *
 * The AI log keeps only gameplay frames, so menus between them are absent. A
 * test that needs the menus after a match adds them.
 *
 * WHERE THE MENUS WERE (8.3.2). The log numbers every game read it is handed
 * and thins the old ones, and it is never handed a LOBBY reply. So beside the
 * frames goes `thinned`, one count a frame: the game reads numbered between it
 * and the frame before it and thinned away since. A gap the cadence filled
 * with more reads than that held LOBBY replies, and the read cadence's replay
 * (test-read-policy.js) puts them back there. Counts only, no frame and no
 * text.
 *
 * Run: node scripts/fixtures/make-session-fixture.js <session folder> <out.json> "<note>" [--accept=word,word]
 */

const fs = require('fs');
const path = require('path');
const data = require('../../src/shared/valorant-data.generated.json');

const HUD_WORDS = `own hp health number numbers num bottom top left right center centre middle upper
  lower corner and with without no not the a an of by for is are was shown showing shows visible open
  opened prompt panel portrait portraits teammate teammates spectating spectate spectator spectated
  switch player players killed kill kills killer combat report killcam cam death recap died dead
  you your we our lost won one two three four five got assist assists traded trade last round
  abilities ability weapon weapons knife loadout in on at hand hands greyed grey gray out observer
  respawn respawned screen icon icons bar ult ultimate ready charging minimap scoreboard map banner
  timer clock spike planted plant defuse alive enemy enemies ally allies team view camera watching
  from after before during while still only mid site main buy phase menu held holding sidearm gun
  pistol rifle primary secondary card name names visible readable`.split(/\s+/).filter(Boolean);

const ALLOW = new Set([
  ...HUD_WORDS,
  ...Object.keys(data.agents || {}).map((a) => a.toLowerCase()),
  ...Object.keys(data.weapons || {}).map((w) => w.toLowerCase()),
].map((w) => w.toLowerCase()));

/*
 * A DROPPED WORD LEAVES A PLACEHOLDER (8.4.1). Dropping a name outright moved
 * the words after it up, and the guards read word order: "<name> killed by
 * Chamber", a kill feed line about somebody else, became "killed by Chamber",
 * which the spectate guard's anchored KILLED_BY_PLAYER reads as the player's
 * own death banner. On the player's Fracture swiftplay that one line turned a
 * frame the model read alive, the read that let round 6 register a second
 * death, into a death screen, and the replay hid the bug. So each run of
 * dropped words is one PLACEHOLDER, a word no guard knows and no player is
 * named by: "someone killed by Chamber".
 */
const PLACEHOLDER = 'someone';

/** Keep allowlisted words and plain numbers, a placeholder for each run of the rest. */
function scrub(text) {
  if (typeof text !== 'string') return undefined;
  const out = [];
  let kept = 0;
  for (const w of text.split(/[^A-Za-z0-9']+/)) {
    if (!w) continue;
    if (/^\d+$/.test(w) || ALLOW.has(w.toLowerCase().replace(/'s$/, ''))) {
      out.push(w);
      kept++;
    } else if (out[out.length - 1] !== PLACEHOLDER) {
      out.push(PLACEHOLDER);
    }
  }
  return kept ? out.join(' ') : undefined;
}

const KEEP = ['phase', 'teamScore', 'enemyScore', 'side', 'playerAlive', 'playerHp', 'clock', 'playerCredits',
  'playerWeapon', 'playerUlt', 'teammatesAlive', 'enemiesAlive', 'locLabel', 'playerSpot', 'map', 'spike', 'spikeSpot'];

function records(dir) {
  const L = JSON.parse(fs.readFileSync(path.join(dir, 'log.json'), 'utf8'));
  const recs = (Array.isArray(L) ? L : (L.records || [])).slice().sort((a, b) => a.at - b.at);
  if (!recs.length) throw new Error('no records');
  return recs;
}

/** Per frame, the game reads the log thinned away between it and the one before (see the header). */
function thinnedOf(dir) {
  const recs = records(dir);
  if (!recs.every((r) => Number.isInteger(r.i))) return null;
  return recs.map((r, k) => Math.max(0, k ? r.i - recs[k - 1].i - 1 : r.i));
}

function build(dir) {
  const recs = records(dir);
  const t0 = recs[0].at;
  return recs.map((r) => {
    const s = r.state || {};
    const f = { t: Math.round((r.at - t0) / 100) / 10 };
    for (const k of KEEP) if (s[k] !== undefined && s[k] !== null) f[k] = s[k];
    const tell = scrub(s.aliveTell);
    if (tell) f.aliveTell = tell;
    const feed = scrub(s.killFeed);
    if (feed) f.killFeed = feed;
    return f;
  });
}

/*
 * NO NAME GOES INTO A FIXTURE (8.4.1). The free text is cut to the allowlist,
 * and the rest a fixture keeps is the game's own words: a phase, a weapon, a
 * map and its callouts. So a word that is none of those, nor a number nor the
 * placeholder, is what a name looks like (strangeWords). The command line
 * refuses to write a fixture holding one, unless each is named with --accept
 * once a person has checked it is no name, and it never writes one holding a
 * word of the player's Riot ID, which nothing can accept. test-session-replay.js
 * holds the committed fixture to the same lists.
 */
const GAME_WORDS = (() => {
  const out = new Set();
  const add = (s) => { for (const w of String(s || '').toLowerCase().split(/[^a-z0-9']+/)) if (w) out.add(w.replace(/'s$/, '')); };
  for (const [agent, a] of Object.entries(data.agents || {})) {
    add(agent);
    for (const ability of (a && a.abilities) || []) add(ability);
  }
  for (const w of Object.keys(data.weapons || {})) add(w);
  for (const m of data.maps || []) add(typeof m === 'string' ? m : m && m.name);
  for (const w of Object.keys(data.mapCallouts || {})) add(w);
  for (const [map, g] of Object.entries(data.mapGeometry || {})) {
    add(map);
    for (const c of (g && g.callouts) || []) { add(c && c.n); add(c && c.a); }
  }
  return out;
})();
// The values of the fields kept as they are (phase, side, spike, ultimate).
const ENUM_WORDS = new Set(['active', 'postplant', 'attacking', 'defending', 'carried', 'dropped']);

const wordsOf = (text) => String(text).split(/[^A-Za-z0-9']+/).filter(Boolean);
const known = (w) => {
  const l = w.toLowerCase().replace(/'s$/, '');
  return /^\d+$/.test(w) || l === PLACEHOLDER || ALLOW.has(l) || GAME_WORDS.has(l) || ENUM_WORDS.has(l);
};

/** Every word in a fixture's frames that no list above knows, as { word: count }. */
function strangeWords(frames) {
  const out = {};
  for (const f of frames || []) {
    for (const v of Object.values(f)) {
      if (typeof v !== 'string') continue;
      for (const w of wordsOf(v)) if (!known(w)) out[w] = (out[w] || 0) + 1;
    }
  }
  return out;
}

/**
 * The words of `frames` a person could be named by: any word of the Riot ID
 * the session's profile has in Settings (its letters, a numeric tag alone
 * says nothing), and every word the session's own reads wrote that no list
 * knows, its tells, kill feeds, notes, team plans and the chat lines in them.
 */
function leaks(dir, frames) {
  let riotId = [];
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(dir, '..', '..', 'occlara-config.json'), 'utf8'));
    riotId = wordsOf(cfg.riotId || '').filter((w) => !/^\d+$/.test(w)).map((w) => w.toLowerCase());
  } catch { /* no profile beside the session: the session's own words still count */ }
  const session = new Set();
  for (const r of records(dir)) {
    for (const v of Object.values(r.state || {})) {
      if (typeof v === 'string') for (const w of wordsOf(v)) if (!known(w)) session.add(w.toLowerCase());
    }
  }
  const found = { riotId: new Set(), session: new Set(), checked: { riotId: riotId.length, session: session.size } };
  for (const f of frames) {
    for (const v of Object.values(f)) {
      if (typeof v !== 'string') continue;
      for (const w of wordsOf(v)) {
        const l = w.toLowerCase();
        if (riotId.includes(l)) found.riotId.add(l);
        if (session.has(l)) found.session.add(l);
      }
    }
  }
  return { riotId: [...found.riotId], session: [...found.session], checked: found.checked };
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const accept = new Set(args.filter((a) => a.startsWith('--accept=')).flatMap((a) => a.slice(9).split(','))
    .map((w) => w.trim().toLowerCase()).filter(Boolean));
  const [dir, out, note] = args.filter((a) => !a.startsWith('--accept='));
  if (!dir || !out) {
    console.log('usage: node scripts/fixtures/make-session-fixture.js <session folder> <out.json> "<note>" [--accept=word,word]');
    process.exit(1);
  }
  const frames = build(dir);
  const thinned = thinnedOf(dir);
  const leak = leaks(dir, frames);
  const open = leak.session.filter((w) => !accept.has(w));
  console.log(`checked against ${leak.checked.session} words the session wrote that no list knows`
    + ` and ${leak.checked.riotId} of the Riot ID in Settings`);
  if (leak.riotId.length || open.length) {
    console.log(`refused, nothing written: ${leak.riotId.length} word(s) of the Riot ID`
      + `${open.length ? `, and these the session wrote and no list knows: ${open.join(', ')}` : ''}`
      + '. A word checked and found to be no name can be passed with --accept=word.');
    process.exit(1);
  }
  fs.writeFileSync(out, JSON.stringify({ note: note || '', frames, ...(thinned ? { thinned } : {}) }) + '\n');
  console.log(`${frames.length} frames written to ${out}${leak.session.length ? ` (accepted: ${leak.session.join(', ')})` : ''}`);
}

module.exports = { build, scrub, thinnedOf, leaks, strangeWords, PLACEHOLDER, ALLOW };

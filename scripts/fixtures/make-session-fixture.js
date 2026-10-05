'use strict';

/**
 * Turn one AI log session into a fixture the engine can be replayed with.
 *
 * The fixtures in this folder are public, so a session goes through here before
 * it is committed: no frames, no notes, no team plans, and every free text
 * field the guards read (the alive tell, the kill feed) cut down to words from
 * an allowlist, which drops every player name while keeping what the spectator
 * and death checks look for ("Spectating", "SWITCH PLAYER", "KILLED BY Sage").
 *
 * The AI log keeps only gameplay frames, so menus between them are absent. A
 * test that needs the menus after a match adds them.
 *
 * Run: node scripts/fixtures/make-session-fixture.js <session folder> <out.json> "<note>"
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

/** Keep allowlisted words and plain numbers, drop everything else. */
function scrub(text) {
  if (typeof text !== 'string') return undefined;
  const kept = text.split(/[^A-Za-z0-9']+/).filter((w) => {
    if (!w) return false;
    if (/^\d+$/.test(w)) return true;
    return ALLOW.has(w.toLowerCase().replace(/'s$/, ''));
  });
  return kept.length ? kept.join(' ') : undefined;
}

const KEEP = ['phase', 'teamScore', 'enemyScore', 'side', 'playerAlive', 'playerHp', 'clock', 'playerCredits',
  'playerWeapon', 'playerUlt', 'teammatesAlive', 'enemiesAlive', 'locLabel', 'playerSpot', 'map', 'spike', 'spikeSpot'];

function build(dir) {
  const L = JSON.parse(fs.readFileSync(path.join(dir, 'log.json'), 'utf8'));
  const recs = (Array.isArray(L) ? L : (L.records || [])).slice().sort((a, b) => a.at - b.at);
  if (!recs.length) throw new Error('no records');
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

if (require.main === module) {
  const [dir, out, note] = process.argv.slice(2);
  if (!dir || !out) {
    console.log('usage: node scripts/fixtures/make-session-fixture.js <session folder> <out.json> "<note>"');
    process.exit(1);
  }
  const frames = build(dir);
  fs.writeFileSync(out, JSON.stringify({ note: note || '', frames }) + '\n');
  console.log(`${frames.length} frames written to ${out}`);
}

module.exports = { build, scrub };

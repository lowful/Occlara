'use strict';

/**
 * Pull the Marvel Rivals roster from the game's own site.
 *
 * WHY THIS EXISTS, given rivals-heroes.js says the opposite. That file's header
 * evaluated community trackers and a community API and was right about all of
 * them: rivalsdata.com 403s a bot, tracker.gg disallows the paths in robots.txt,
 * marvelrivalsapi.com was 502 throughout, and the one usable dataset was smaller
 * than the roster and unlicensed. What it never checked was marvelrivals.com
 * itself, which turns out to be the best source available:
 *
 *   robots.txt returns 404, so nothing is disallowed
 *   the roster is embedded as data-tag / data-name / data-url attributes
 *   every hero page carries Health, Movement Speed and the full ability list
 *   it is first party, so the names are the names, not a community transcription
 *
 * That last point is the one that matters most. Two reputable outlets call The
 * Thing's anti-dive ability "Earthbound"; the string appears nowhere on the
 * official pages, where it is "Yancy Street Charge". A coach that names an
 * ability has to name the real one.
 *
 * WHAT THIS DOES NOT FETCH. Archetype (dive / poke / brawl) is community
 * vocabulary and appears nowhere official, so it stays hand-assigned in
 * rivals-heroes.js. Win rates, tier lists and ban rates are not here either:
 * they are volatile by nature and belong to the META block that expires.
 *
 * Writes server/rivals-data.generated.json. Do not hand-edit it.
 *
 *   npm run sync:rivals
 */

const fs = require('fs');
const path = require('path');

const INDEX = 'https://www.marvelrivals.com/heroes/';
const OUT = path.join(__dirname, '..', 'server', 'rivals-data.generated.json');

// Polite, and honest about who is asking. The site has no robots.txt to obey,
// which is not a reason to hammer it.
const UA = 'Occlara/1.0 (+https://occlara.app) hero-data-sync';
const GAP_MS = 400;

/**
 * Refuse to write a roster that collapsed.
 *
 * sync-lol.js carries the same guard for the same reason: the failure mode of a
 * scraper is not an exception, it is a successful fetch of a page whose markup
 * changed, producing a confident, empty, wrong file. A roster this far below the
 * real one means the selectors moved, and overwriting good data with it would be
 * worse than not running at all.
 */
const SANITY_MIN_HEROES = 45;
const SANITY_MIN_WITH_HP = 40;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function grab(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  return r.text();
}

/** Decode the handful of entities that actually appear in these pages. */
function clean(s) {
  return String(s || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\u00a0/g, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&#39;|&rsquo;|\u2019/g, "'")
    .replace(/&quot;/gi, '"')
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Every <td>Label</td><td>Value</td> pair on a page, as a list. */
function labelledCells(html, label) {
  const out = [];
  const re = new RegExp(
    '<td[^>]*>\\s*' + label + '\\s*</td>\\s*<td[^>]*>([\\s\\S]*?)</td>', 'gi');
  let m;
  while ((m = re.exec(html)) !== null) out.push(clean(m[1]));
  return out;
}

/**
 * Health, as a number plus whatever else the page says.
 *
 * "150+125 Regenerative Shield" is the dive Duelist shape and the reason they
 * can dive repeatedly: the shield refills out of combat. Base and shield are
 * kept apart because they mean different things to a coach. Base is what decides
 * whether a target dies to one burst.
 */
function parseHealth(raw) {
  const text = clean(raw);
  const nums = text.match(/\d+/g);
  if (!nums || !nums.length) return null;
  const base = Number(nums[0]);
  const shield = /shield/i.test(text) && nums[1] ? Number(nums[1]) : 0;
  return { base, shield, total: base + shield, printed: text };
}

/**
 * Movement speed in metres per second.
 *
 * NEWER HEROES PRINT 600 WHERE OLDER ONES PRINT 6m/s, which is centimetres and
 * a hundredfold error if taken at face value. Anything that looks like a raw
 * centimetre figure is divided down, and anything still absurd is dropped
 * rather than guessed.
 */
function parseSpeed(raw) {
  const text = clean(raw);
  const n = Number((text.match(/[\d.]+/) || [])[0]);
  if (!isFinite(n) || n <= 0) return null;
  const mps = n > 60 ? n / 100 : n;
  return mps >= 2 && mps <= 20 ? Math.round(mps * 10) / 10 : null;
}

/**
 * Ability names and what they do.
 *
 * The page is one table per hero: row 0 holds the hero name and the Base Stats
 * block, every row after it is an ability. The name always sits in the narrow
 * cell, the description in the wide one after the icon.
 */
function parseAbilities(html, heroName) {
  const out = [];
  /*
   * MATCHED ON POSITION, NOT ON STYLING. The first version keyed on the name
   * cell carrying style="width: 69px", which is true of every hero page written
   * before roughly mid 2026 and of none written after: The Hood, Gorr, Jubilee
   * and Rogue all use a bare <td> and a 179px icon cell, and all four parsed
   * zero abilities while looking like a clean run.
   *
   * Every row on every version opens the same way, an index then a name, before
   * any nested stat table, so that is what this matches.
   */
  const re = /<tr[^>]*>\s*<td[^>]*>\s*(\d{1,2})\s*<\/td>\s*<td[^>]*>([\s\S]{1,80}?)<\/td>([\s\S]{0,6000}?)<\/tr>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const name = clean(m[2]);
    if (!name || name.length > 48) continue;
    // Row 0 repeats the hero's own name beside the Base Stats block.
    if (name.toLowerCase() === heroName.toLowerCase()) continue;
    const cells = [];
    const cellRe = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    let c;
    while ((c = cellRe.exec(m[3])) !== null) cells.push(clean(c[1]));
    // The longest cell in the row is the description; the rest are icons and
    // stat sub-tables flattened to noise.
    const desc = cells.filter((x) => x.length > 25).sort((a, b) => b.length - a.length)[0] || '';
    if (!out.some((a) => a.name === name)) out.push({ name, text: desc });
  }
  return out;
}

/**
 * The name as a person would write it.
 *
 * The index prints most heroes in capitals and a few in mixed case, so the raw
 * values are a mix of "BLACK PANTHER" and "Gorr the God Butcher". Worse,
 * "CLOAK&DAGGER" has no spaces, and that one does not resolve against the hero
 * table at all, which is the only kind of naming error that actually costs
 * something here.
 */
const SMALL = new Set(['the', 'of', 'and', 'a', 'to']);
function properName(raw) {
  let s = clean(raw).replace(/&/g, ' & ').replace(/\s+/g, ' ').trim();
  // Leave anything already mixed case alone; the site has it right.
  if (/[a-z]/.test(s)) return s;
  return s.split(' ').map((w, i) => w.split('-').map((part, j) => {
    const lower = part.toLowerCase();
    if (i > 0 && j === 0 && SMALL.has(lower)) return lower;
    return lower.charAt(0).toUpperCase() + lower.slice(1);
  }).join('-')).join(' ');
}

async function main() {
  console.log('reading ' + INDEX);
  const index = await grab(INDEX);

  const entries = [];
  const re = /data-url="([^"]+)"[^>]*?data-id="[^"]*"[^>]*?data-tag="([^"]*)"[^>]*?data-name="([^"]+)"/gi;
  let m;
  while ((m = re.exec(index)) !== null) {
    entries.push({ url: m[1], tag: clean(m[2]), name: properName(m[3]) });
  }
  console.log('roster entries found: ' + entries.length);
  if (entries.length < SANITY_MIN_HEROES) {
    throw new Error(`only ${entries.length} heroes in the index, expected at least `
      + `${SANITY_MIN_HEROES}. The selectors have probably moved; refusing to write.`);
  }

  const heroes = [];
  for (const e of entries) {
    let page;
    try {
      page = await grab(e.url);
    } catch (err) {
      console.log(`  ${e.name}: ${err.message}`);
      heroes.push({ name: e.name, roles: rolesOf(e.tag), health: null, speed: null, abilities: [] });
      continue;
    }
    const healths = labelledCells(page, 'Health').map(parseHealth).filter(Boolean);
    const speeds = labelledCells(page, 'Movement Speed').map(parseSpeed).filter((v) => v !== null);

    /*
     * MORE THAN ONE STAT BLOCK IS A REAL SHAPE, not a parse failure. Hulk prints
     * three (Banner 200, Hulk 400+300, Monster 1400) and Deadpool four, none of
     * them labelled by role. Taking the first match gives Banner's 200, which is
     * wrong for every purpose a coach has. So every block is kept, and the
     * PRIMARY is the largest base, which is the form the hero actually fights in.
     */
    const primary = healths.length
      ? healths.reduce((a, b) => (b.base > a.base ? b : a))
      : null;

    heroes.push({
      name: e.name,
      roles: rolesOf(e.tag),
      health: primary,
      healthForms: healths.length > 1 ? healths : undefined,
      speed: speeds.length ? speeds[0] : null,
      abilities: parseAbilities(page, e.name),
      source: e.url,
    });
    const hp = primary ? primary.base + (primary.shield ? '+' + primary.shield : '') : '?';
    console.log(`  ${e.name.padEnd(24)} ${rolesOf(e.tag).join('/').padEnd(28)} hp ${String(hp).padEnd(9)} ${parseAbilities(page, e.name).length} abilities`);
    await sleep(GAP_MS);
  }

  const withHp = heroes.filter((h) => h.health).length;
  if (withHp < SANITY_MIN_WITH_HP) {
    throw new Error(`only ${withHp} of ${heroes.length} heroes parsed a health value, `
      + `expected at least ${SANITY_MIN_WITH_HP}. Refusing to write.`);
  }

  const data = {
    generatedAt: new Date().toISOString(),
    source: INDEX,
    count: heroes.length,
    heroes: heroes.sort((a, b) => a.name.localeCompare(b.name)),
  };

  diff(data);
  fs.writeFileSync(OUT, JSON.stringify(data, null, 2));
  console.log(`\nwrote ${OUT}`);
  console.log(`  ${heroes.length} heroes, ${withHp} with health, `
    + `${heroes.filter((h) => h.abilities.length).length} with abilities`);
}

/** Official roles. Deadpool carries all three, space separated. */
function rolesOf(tag) {
  const t = String(tag || '').toUpperCase();
  const found = ['VANGUARD', 'DUELIST', 'STRATEGIST'].filter((r) => t.includes(r));
  return found.map((r) => r[0] + r.slice(1).toLowerCase());
}

/**
 * Say what changed, the way sync-valorant-data.js does.
 *
 * A patch that adds a hero or moves a health pool should be visible in the run
 * log, because that is the moment somebody has to decide whether the hand
 * assigned archetypes still hold.
 */
function diff(next) {
  let prev;
  try { prev = JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch { return; }
  const was = new Map((prev.heroes || []).map((h) => [h.name, h]));
  const now = new Map(next.heroes.map((h) => [h.name, h]));
  const added = [...now.keys()].filter((n) => !was.has(n));
  const gone = [...was.keys()].filter((n) => !now.has(n));
  const moved = [...now.keys()].filter((n) => {
    const a = was.get(n); const b = now.get(n);
    return a && a.health && b.health && a.health.total !== b.health.total;
  });
  if (added.length) console.log('\n  NEW: ' + added.join(', '));
  if (gone.length) console.log('  GONE: ' + gone.join(', '));
  for (const n of moved) {
    console.log(`  HEALTH CHANGED: ${n} ${was.get(n).health.printed} -> ${now.get(n).health.printed}`);
  }
}

main().catch((e) => { console.error('\nsync failed: ' + e.message); process.exit(1); });

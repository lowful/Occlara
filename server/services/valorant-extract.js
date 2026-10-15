'use strict';

/**
 * The game's own data, read out of valorant-api.com's replies (a mirror of the
 * game's files, updated every patch) into the shape both generated copies of
 * valorant-data.generated.json hold.
 *
 * ONE EXTRACTION, TWO CALLERS. scripts/sync-valorant-data.js fetches the
 * endpoints and writes what this returns; game-primer.js's live version check
 * fetches the same endpoints when the live patch differs from the synced one,
 * extracts them HERE, and diffs every number the primer prints. Two copies of
 * this code would drift, and a live check that read the data differently from
 * the sync would withhold numbers that never changed, or keep ones that did.
 * It lives in server/ because the server's deploy root is server/ and nothing
 * there may require a file outside it (check:server); scripts/ may require it.
 *
 * Pure: no fetch, no file, no clock. The caller passes the endpoints' `data`.
 *
 * IT FAILS CLOSED. A renamed field, a missing armour, an agent missing a used
 * slot or a description, a gun or gear item the primer's renderer does not
 * know: each throws, naming every problem at once, rather than writing a file
 * that silently lacks what the primer prints. A new gun is a renderer change
 * first (KNOWN_WEAPONS below), then a sync.
 *
 * What the gates read today is kept exactly as it was: agents[x].abilities is
 * still the lower case list of the four used abilities in the game's order,
 * and weapons[x].ranges[].body, the range bounds, cost, category and fallsOff
 * are unchanged. Everything new is added beside them.
 */

const ENDPOINTS = {
  agents: 'https://valorant-api.com/v1/agents?isPlayableCharacter=true',
  maps: 'https://valorant-api.com/v1/maps',
  weapons: 'https://valorant-api.com/v1/weapons',
  gear: 'https://valorant-api.com/v1/gear',
  gamemodes: 'https://valorant-api.com/v1/gamemodes',
  version: 'https://valorant-api.com/v1/version',
};

// Ability slots that a player actively USES. Passive is kept in the kit (it is
// part of the agent's text) but never in `abilities`, which the gates read.
const USED_SLOTS = new Set(['Ability1', 'Ability2', 'Grenade', 'Ultimate']);

// The default key of each slot, as the game binds them out of the box.
const SLOT_KEY = { Grenade: 'C', Ability1: 'Q', Ability2: 'E', Ultimate: 'X', Passive: null };
const SLOT_ORDER = ['Grenade', 'Ability1', 'Ability2', 'Ultimate', 'Passive'];

/*
 * The guns and gear the primer's renderer knows, in the order it prints them.
 * An item the game data has and this list does not is a failure, never a
 * silent omission: the renderer would have no line for it, and a gun table
 * missing a gun reads as complete.
 */
const KNOWN_WEAPONS = ['classic', 'shorty', 'frenzy', 'ghost', 'bandit', 'sheriff', 'stinger', 'spectre',
  'bucky', 'judge', 'bulldog', 'guardian', 'phantom', 'vandal', 'warden', 'marshal', 'outlaw', 'operator',
  'ares', 'odin'];
const KNOWN_GEAR = ['Light Armor', 'Regen Shield', 'Heavy Armor'];
const REQUIRED_GEAR = ['Light Armor', 'Heavy Armor'];

// Generic or ambiguous region names that must NOT gate a tip: common English
// words (a tip may use them non-locationally) and spots on so many maps they
// carry no map signal. The callout->map assignments still come from the API.
const CALLOUT_DENY = new Set([
  'site', 'spawn', 'main', 'top', 'bottom', 'hall', 'lobby', 'link', 'window',
  'tower', 'cubby', 'back', 'ramp', 'ramps', 'stairs', 'door', 'doors', 'exit',
  'short', 'long', 'box', 'angle box', 'flat box', 'pit', 'yard', 'drop', 'bend',
  'wall', 'bridge', 'screen', 'screens', 'connector', 'secret', 'rafters', 'gate',
  'bench', 'pillar', 'pillars', 'arches', 'arch', 'water', 'alley', 'garden',
  'courtyard', 'fountain', 'generator', 'elbow', 'plaza', 'shops', 'shop', 'hut',
  'upper', 'tiles', 'pocket', 'danger', 'security', 'cave', 'rope', 'ropes',
  'belt', 'blue', 'green', 'orange', 'yellow', 'fence', 'pallet', 'pipes',
  'snow pile', 'wood doors', 'boat house', 'art', 'club', 'records', 'restaurant',
  'gym', 'trophy', 'sandbags', 'horseshoe', 'root',
]);

// Famous community callouts the game files name differently. Kept so the gate
// still catches the real terms players (and the coach) use.
const COMMUNITY_CALLOUTS = { hookah: ['bind'], showers: ['bind'] };

// Only a callout on this few standard maps is distinctive enough to gate on.
const MAX_MAPS_FOR_DISTINCTIVE = 3;

// Super-regions that are spawn areas, not places a tip should ever send the
// player. Kept in the geometry (so the locator can still NAME them when the
// player is standing there) but never offered as a destination.
const SPAWN_SUPERS = new Set(['attacker side', 'defender side']);

// Places the game files name one thing and every player calls another. Stored
// as an alias ON the real callout (never a second entry at the same point, that
// would make the location read ambiguous and lose the precision), so the coach
// can say the word the player actually uses.
// Keyed by map, then by the game's own callout name.
const COMMUNITY_ALIASES = {
  bind: { 'B Window': 'Hookah', 'A Bath': 'Showers' },
};

const finite = (x) => typeof x === 'number' && Number.isFinite(x);

function buildAgents(rows, problems) {
  const agents = {};
  for (const a of rows) {
    if (!a.displayName || !a.role || !Array.isArray(a.abilities)) continue;
    const abilities = a.abilities
      .filter((ab) => USED_SLOTS.has(ab.slot) && ab.displayName)
      .map((ab) => String(ab.displayName).toLowerCase().trim())
      .filter(Boolean);
    // The kit in the game's own words, on its default keys. The name is kept
    // exactly as `abilities` has it ("Nebula  / Dissipate", two spaces and
    // all) and the description with its runs of spaces closed; the renderer
    // tidies both when it prints them.
    const kit = [];
    for (const slot of SLOT_ORDER) {
      for (const ab of a.abilities.filter((x) => x && x.slot === slot)) {
        const name = String(ab.displayName || '').trim();
        const description = String(ab.description || '').replace(/\s+/g, ' ').trim();
        if (!name) continue;
        kit.push({ slot, key: SLOT_KEY[slot], name, description });
      }
    }
    for (const slot of USED_SLOTS) {
      const used = kit.filter((k) => k.slot === slot);
      if (!used.length) problems.push(`agent ${a.displayName} has no ${slot} ability`);
      for (const k of used) if (!k.description) problems.push(`agent ${a.displayName}'s ${k.name} has no description`);
    }
    agents[a.displayName] = { role: a.role.displayName, abilities, kit };
  }
  return agents;
}

/** Riot's own description of each role, word for word. */
function buildRoles(rows, problems) {
  const roles = {};
  for (const a of rows) {
    if (!a || !a.role || !a.role.displayName) continue;
    const name = String(a.role.displayName).trim();
    const text = String(a.role.description || '').replace(/\s+/g, ' ').trim();
    if (!text) { problems.push(`role ${name} has no description`); continue; }
    if (!roles[name]) roles[name] = text;
  }
  return Object.fromEntries(Object.keys(roles).sort().map((k) => [k, roles[k]]));
}

// A standard plant/defuse map has a tacticalDescription ("A/B Sites" or
// "A/B/C Sites"); Team Deathmatch and tutorial maps have null.
function isStandardMap(m) {
  return !!(m.displayName && m.tacticalDescription && Array.isArray(m.callouts) && m.callouts.length);
}

function buildMaps(rows) {
  const standard = rows.filter(isStandardMap);
  const maps = standard.map((m) => m.displayName).sort();
  const threeSite = standard
    .filter((m) => /\bc\b/i.test(m.tacticalDescription))   // "A/B/C Sites"
    .map((m) => m.displayName).sort();
  return { maps, threeSiteMaps: threeSite, standardRows: standard };
}

function buildCallouts(standardRows) {
  const byCallout = {};
  for (const m of standardRows) {
    const map = m.displayName.toLowerCase();
    const seen = new Set();
    for (const c of m.callouts) {
      const n = (c.regionName || '').toLowerCase().trim();
      if (!n || CALLOUT_DENY.has(n) || seen.has(n)) continue;
      seen.add(n);
      (byCallout[n] = byCallout[n] || new Set()).add(map);
    }
  }
  const out = {};
  for (const [n, set] of Object.entries(byCallout)) {
    if (set.size <= MAX_MAPS_FOR_DISTINCTIVE) out[n] = [...set].sort();
  }
  for (const [n, maps] of Object.entries(COMMUNITY_CALLOUTS)) out[n] = maps.slice();
  // Stable key order for clean diffs.
  return Object.fromEntries(Object.keys(out).sort().map((k) => [k, out[k]]));
}

/**
 * Convert a callout's world location to a position on the minimap as the player
 * sees it: 0..1 across (left to right) and 0..1 down (top to bottom).
 *
 * This is the game's own transform, shipped in the map data. Note the axis
 * swap, it is not a typo: the world Y drives the minimap X and the world X
 * drives the minimap Y.
 */
function worldToMinimap(loc, m) {
  return {
    x: loc.y * m.xMultiplier + m.xScalarToAdd,
    y: loc.x * m.yMultiplier + m.yScalarToAdd,
  };
}

const r3 = (n) => Math.round(n * 1000) / 1000;

/** "top left", "center", "bottom right", ... from a normalized minimap point. */
function describeSpot(x, y) {
  const col = x < 0.34 ? 'left' : x > 0.66 ? 'right' : 'center';
  const row = y < 0.34 ? 'top'  : y > 0.66 ? 'bottom' : 'middle';
  if (row === 'middle' && col === 'center') return 'dead center';
  if (col === 'center') return row + ' center';
  if (row === 'middle') return 'middle ' + col;
  return row + ' ' + col;
}

/**
 * Per-map minimap geometry: every real callout placed on the minimap, plus the
 * centroid of each super-region (A, B, C, Mid). This is what lets the coach
 * turn "the yellow arrow is 40% across, 70% down" into a callout that is
 * guaranteed to exist on THIS map, instead of guessing a name from memory.
 *
 * The transform itself is kept beside them (for Riot's own kill positions,
 * which arrive in world units and need the same conversion).
 */
function buildGeometry(standardRows) {
  const out = {};
  for (const m of standardRows) {
    if (typeof m.xMultiplier !== 'number' || typeof m.yMultiplier !== 'number') continue;

    const aliases = COMMUNITY_ALIASES[m.displayName.toLowerCase()] || {};
    const callouts = [];
    const superPts = {};
    for (const c of m.callouts) {
      if (!c.location || !c.regionName || !c.superRegionName) continue;
      const p = worldToMinimap(c.location, m);
      if (!isFinite(p.x) || !isFinite(p.y)) continue;
      const sup    = String(c.superRegionName).trim();
      const region = String(c.regionName).trim();
      // "A" + "Main" -> "A Main"; avoid "Mid Mid" style doubles.
      const name = region.toLowerCase() === sup.toLowerCase() ? region : `${sup} ${region}`;
      const entry = { n: name, s: sup, x: r3(p.x), y: r3(p.y) };
      if (aliases[name]) entry.a = aliases[name];   // what players actually call it
      callouts.push(entry);
      (superPts[sup] = superPts[sup] || []).push(p);
    }
    if (!callouts.length) continue;

    // Where each site sits on the minimap, straight from the callout centroids.
    const sites = {};
    for (const [sup, pts] of Object.entries(superPts)) {
      if (SPAWN_SUPERS.has(sup.toLowerCase())) continue;
      const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
      const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
      sites[sup] = { x: r3(cx), y: r3(cy), where: describeSpot(cx, cy) };
    }

    callouts.sort((a, b) => a.n.localeCompare(b.n));
    out[m.displayName.toLowerCase()] = {
      hasMid: Object.keys(sites).some((s) => /^mid$/i.test(s)),
      sites,
      callouts,
      transform: {
        xMultiplier: m.xMultiplier, yMultiplier: m.yMultiplier,
        xScalarToAdd: m.xScalarToAdd, yScalarToAdd: m.yScalarToAdd,
      },
    };
  }
  return out;
}

// "EWallPenetrationDisplayType::High" -> "High"; null for null.
const enumTail = (v) => {
  const s = String(v || '');
  const i = s.lastIndexOf('::');
  return s ? (i >= 0 ? s.slice(i + 2) : s) || null : null;
};
// valorant-api writes -1 for "does not apply" (a Bandit's pellet count, a
// sniper's aimed spread). A number that does not apply is null, never -1.
const applies = (x) => (finite(x) && x >= 0 ? x : null);

/**
 * Per weapon numbers, which is what turns range advice into a fact.
 *
 * "Position for the range your gun works at" is a platitude until you can say
 * that a Bucky does 17 a pellet inside 8m and 9 past 12m. THIRTEEN OF TWENTY
 * weapons have a damage cliff, so for most of the buy this is real, checkable
 * advice rather than a feel.
 *
 * The body damage and range bounds are what the playbook's number check reads.
 * Head and leg damage, the fire rate, the magazine, the reload, the draw, the
 * running speed, the first bullet's spread, the aimed burst, the pellets, the
 * alt fire, the wall penetration and the feature are what the primer prints
 * and computes from (hits and time to kill through each armour). Each is the
 * game's own number; a field the API renames fails the sync rather than
 * leaving a gap.
 */
function buildWeapons(rows, problems) {
  const out = {};
  for (const w of rows || []) {
    const stats = w.weaponStats;
    if (!stats || !Array.isArray(stats.damageRanges) || !stats.damageRanges.length) continue;
    const name = String(w.displayName || '').trim();
    if (!name) continue;
    const key = name.toLowerCase();
    const ranges = stats.damageRanges.map((r) => ({
      from: Number(r.rangeStartMeters),
      to: Number(r.rangeEndMeters),
      body: Number(r.bodyDamage),
      head: Number(r.headDamage),
      leg: Number(r.legDamage),
    })).filter((r) => isFinite(r.from) && isFinite(r.to) && isFinite(r.body));
    if (!ranges.length) continue;
    if (!KNOWN_WEAPONS.includes(key)) problems.push(`weapon ${name} is one the primer does not know`);
    for (const r of ranges) {
      if (!finite(r.head) || !finite(r.leg)) problems.push(`weapon ${name} has a band with no head or leg damage`);
    }
    for (const [field, label] of [['fireRate', 'fire rate'], ['magazineSize', 'magazine'],
      ['reloadTimeSeconds', 'reload'], ['equipTimeSeconds', 'draw time'], ['runSpeedMultiplier', 'run speed'],
      ['firstBulletAccuracy', 'first bullet spread']]) {
      if (!finite(stats[field])) problems.push(`weapon ${name} has no ${label} (${field})`);
    }
    const ads = stats.adsStats || null;
    const pellets = applies(stats.shotgunPelletCount);
    const burst = ads ? applies(ads.burstCount) : null;
    const alt = enumTail(stats.altFireType);
    out[key] = {
      category: String((w.shopData && w.shopData.categoryText) || '').replace('Weapon', '').trim() || null,
      cost: (w.shopData && Number(w.shopData.cost)) || null,
      ranges,
      // A weapon with one tier does the same damage at every range, which is
      // itself worth knowing: it is why the Vandal can hold any angle.
      fallsOff: ranges.length > 1,
      fireRate: stats.fireRate,
      magazine: stats.magazineSize,
      reload: stats.reloadTimeSeconds,
      equip: stats.equipTimeSeconds,
      runSpeed: stats.runSpeedMultiplier,
      spread: { hip: applies(stats.firstBulletAccuracy), ads: ads ? applies(ads.firstBulletAccuracy) : null },
      adsBurst: burst && burst > 1 ? burst : null,
      pellets: pellets && pellets > 1 ? pellets : null,
      altFire: alt,
      altPellets: stats.altShotgunStats ? applies(stats.altShotgunStats.shotgunPelletCount) : null,
      airBurst: stats.airBurstStats
        ? { pellets: applies(stats.airBurstStats.shotgunPelletCount), distance: applies(stats.airBurstStats.burstDistance) }
        : null,
      penetration: enumTail(stats.wallPenetration),
      feature: enumTail(stats.feature),
    };
  }
  return out;
}

/**
 * The gear: what each armour costs, the share of each hit it takes, and how
 * much it takes before it breaks, read out of the game's own text ("Breaks
 * after it has absorbed 50 damage"). The Regen Shield's text gives its share
 * and its pool but not what one fill absorbs; that one number is a stated fact
 * (game-rules.json, Riot's patch notes), never guessed here.
 */
function buildGear(rows, problems) {
  const out = {};
  for (const g of rows || []) {
    const name = String((g && g.displayName) || '').trim();
    if (!name) continue;
    if (!KNOWN_GEAR.includes(name)) { problems.push(`gear ${name} is one the primer does not know`); continue; }
    const details = Array.isArray(g.details) ? g.details : [];
    const detail = (re) => (details.find((d) => re.test(String(d.name || ''))) || {}).value;
    const absorbedText = String(detail(/ABSORBED/i) || '');
    const absorbed = /^\s*\d+(?:\.\d+)?\s*%\s*$/.test(absorbedText) ? Number(absorbedText.replace('%', '')) / 100 : null;
    const capText = (String(g.description || '').match(/absorbed (\d+(?:\.\d+)?) damage/i) || [])[1];
    const poolText = String(detail(/POOL/i) || '');
    const cost = g.shopData ? Number(g.shopData.cost) : NaN;
    if (!finite(cost)) problems.push(`gear ${name} has no cost`);
    if (!(absorbed > 0 && absorbed <= 1)) problems.push(`gear ${name} has no damage absorbed share`);
    out[name] = {
      cost: finite(cost) ? cost : null,
      absorbed,
      capacity: capText ? Number(capText) : null,
      pool: /^\s*\d+(?:\.\d+)?\s*$/.test(poolText) ? Number(poolText) : null,
    };
  }
  for (const name of REQUIRED_GEAR) {
    if (!out[name]) problems.push(`gear ${name} is missing`);
    else if (!finite(out[name].capacity)) problems.push(`gear ${name} has no capacity in its description`);
  }
  return Object.fromEntries(KNOWN_GEAR.filter((n) => out[n]).map((n) => [n, out[n]]));
}

/**
 * The two modes the primer covers, in the game's own words: Standard (what
 * Competitive and Unrated play) and Swiftplay. "First to 13 wins." is Riot's
 * text; Swiftplay's half and its rule against a win by two are the mode's own
 * fields. Missing is null, never a guess: the primer prints nothing it lacks.
 */
function buildModes(rows) {
  const pick = (name) => (rows || []).find((m) => m && m.displayName === name) || null;
  const winOf = (m) => {
    const hit = String((m && m.description) || '').match(/first to (\d+) wins/i);
    return hit ? Number(hit[1]) : null;
  };
  const ruleOf = (m, rule) => {
    const r = ((m && m.gameRuleBoolOverrides) || []).find((x) => String(x.ruleName || '').endsWith(`::${rule}`));
    return r ? !!r.state : null;
  };
  const out = {};
  const standard = pick('Standard');
  out.standard = {
    win: winOf(standard),
    description: standard ? String(standard.description || '').trim() || null : null,
  };
  const swift = pick('Swiftplay');
  out.swiftplay = {
    win: winOf(swift),
    roundsPerHalf: swift && finite(swift.roundsPerHalf) && swift.roundsPerHalf > 0 ? swift.roundsPerHalf : null,
    overtimeWinByTwo: ruleOf(swift, 'IsOvertimeWinByTwo'),
    description: swift ? String(swift.description || '').trim() || null : null,
  };
  return out;
}

/** "release-13.08" -> "13.08" */
function patchFromBranch(branch) {
  const m = String(branch || '').match(/(\d+\.\d+)/);
  return m ? m[1] : null;
}

function buildVersion(v, problems) {
  const patch = patchFromBranch(v && v.branch);
  if (!patch) problems.push(`could not read a patch number from the version (${JSON.stringify(v && v.branch)})`);
  return {
    patch,
    version: (v && typeof v.version === 'string' && v.version) || null,
    buildDate: (v && typeof v.buildDate === 'string' && v.buildDate) || null,
  };
}

class ExtractError extends Error {
  constructor(problems) {
    super(`the game data failed ${problems.length} check(s): ${problems.join('; ')}`);
    this.problems = problems;
  }
}

/**
 * The generated data from the endpoints' replies. `raw` holds each endpoint's
 * `data`: { agents, maps, weapons, gear, gamemodes, version }. With `maps`
 * left out (the live check has no use for callouts) the map blocks are empty.
 * Throws ExtractError listing every problem when the data fails closed.
 */
function extract(raw) {
  const problems = [];
  const r = raw || {};
  for (const k of ['agents', 'weapons', 'gear', 'gamemodes']) {
    if (!Array.isArray(r[k])) problems.push(`no ${k} array`);
  }
  if (!r.version || typeof r.version !== 'object') problems.push('no version');
  if (problems.length) throw new ExtractError(problems);

  const version = buildVersion(r.version, problems);
  const agents = buildAgents(r.agents, problems);
  const roles = buildRoles(r.agents, problems);
  let maps = [];
  let threeSiteMaps = [];
  let mapCallouts = {};
  let mapGeometry = {};
  if (Array.isArray(r.maps)) {
    const built = buildMaps(r.maps);
    maps = built.maps;
    threeSiteMaps = built.threeSiteMaps;
    mapCallouts = buildCallouts(built.standardRows);
    mapGeometry = buildGeometry(built.standardRows);
  }
  const weapons = buildWeapons(r.weapons, problems);
  if (Object.keys(weapons).length < 15) {
    problems.push(`only ${Object.keys(weapons).length} weapons parsed a damage table, expected at least 15`);
  }
  const gear = buildGear(r.gear, problems);
  const modes = buildModes(r.gamemodes);
  if (!Object.keys(agents).length) problems.push('no agents');
  if (problems.length) throw new ExtractError(problems);

  return {
    patch: version.patch, version: version.version, buildDate: version.buildDate,
    agents, roles, maps, threeSiteMaps, mapCallouts, mapGeometry, weapons, gear, modes,
  };
}

module.exports = {
  extract, ExtractError, ENDPOINTS, KNOWN_WEAPONS, KNOWN_GEAR, REQUIRED_GEAR, SLOT_KEY, SLOT_ORDER,
  USED_SLOTS, patchFromBranch,
  // The pieces, for the sync's own diff and the tests.
  buildAgents, buildRoles, buildMaps, buildCallouts, buildGeometry, buildWeapons, buildGear, buildModes,
  worldToMinimap, describeSpot,
};

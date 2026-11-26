'use strict';

/**
 * A SAMPLE YEAR FOR OCCLARA WRAPPED (docs/claude/wrapped.md), built from the
 * repo's own fixtures: the sample library's real Abyss match
 * (proof-reviews.js build(), the match replayed through the engine and laid
 * over Riot's record of it) made into its year record row by the real
 * wrapped.js rowOf, then varied a match at a time with a seeded generator into
 * a year of play: agents, maps, grades rising over the year, results, kills,
 * highlights, clutches, mistakes (one falling, one staying), a rank climbing,
 * and seven League games so League's own slide is drawn.
 *
 * It is plainly a sample: every Wrapped opened on it says so, and it never
 * reaches a player. Used by the dev switch OCCLARA_DEV_WRAPPED=sample
 * (index.js, a run from the repo only), scripts/shot-wrapped.js and
 * scripts/test-wrapped.js. Deterministic: the same rows every run.
 */

const path = require('path');
const REPO = path.join(__dirname, '..', '..');
const W = require(path.join(REPO, 'src/shared/wrapped'));
const gradeOf = require(path.join(REPO, 'src/shared/grade'));

const YEAR = 2026;

/** A seeded generator (mulberry32), so the sample is the same every run. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (r, weighted) => {
  const total = weighted.reduce((n, [, w]) => n + w, 0);
  let x = r() * total;
  for (const [v, w] of weighted) { x -= w; if (x <= 0) return v; }
  return weighted[weighted.length - 1][0];
};

let baseRow = null;
/** The real built match as its row, once. */
function base() {
  if (baseRow) return baseRow;
  const proof = require('./proof-reviews');
  const b = proof.build({ now: new Date(YEAR, 10, 20, 21).getTime() });
  baseRow = W.rowOf(`valorant-${new Date(YEAR, 10, 20, 21).getTime()}-base01`, 'valorant', new Date(YEAR, 10, 20, 21).getTime(), { ...b.builtLooked, kind: 'valorant' });
  return baseRow;
}

const AGENTS = [['Jett', 42], ['Raze', 15], ['Neon', 12], ['Omen', 10], ['Sova', 8], ['Killjoy', 7], ['Reyna', 6]];
const MAPS = [['Ascent', 12], ['Sunset', 12], ['Abyss', 10], ['Haven', 9], ['Bind', 9], ['Split', 8], ['Lotus', 8], ['Pearl', 7], ['Icebox', 6], ['Corrode', 6], ['Fracture', 5], ['Breeze', 4]];
const GUNS = [['Vandal', 52], ['Phantom', 20], ['Sheriff', 10], ['Operator', 8], ['Ghost', 6], ['Spectre', 4]];
const ENEMIES = [['Reyna', 16], ['Jett', 14], ['Omen', 10], ['Sova', 9], ['Killjoy', 9], ['Raze', 8], ['Cypher', 7], ['Skye', 7], ['Viper', 6], ['Neon', 5], ['Clove', 5], ['Iso', 4]];
const LADDER = ['Gold 1', 'Gold 2', 'Gold 3', 'Platinum 1', 'Platinum 2', 'Platinum 3', 'Diamond 1'];

/**
 * The sample year's rows, oldest first.
 * @param opts.matches  how many Valorant matches (default 96)
 * @param opts.lol      how many League games (default 7)
 */
function rows(opts) {
  const o = opts || {};
  const n = Number.isInteger(o.matches) ? o.matches : 96;
  const nl = Number.isInteger(o.lol) ? o.lol : 7;
  const r = rng(o.seed || 2026);
  const b = base();
  const out = [];
  const start = new Date(YEAR, 0, 6, 19).getTime();
  const end = new Date(YEAR, 11, 12, 22).getTime();
  let elo = 1180;
  let prev = 0;
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 1 : i / (n - 1);
    // Evenings, two or three matches a sitting now and then, a busier autumn.
    const spread = Math.pow(t, 0.85);
    const at = i && r() < 0.42 ? prev + Math.round((38 + r() * 20) * 60000)
      : Math.max(prev + 3600000, Math.round(start + spread * (end - start) + (r() - 0.5) * 2 * 86400000));
    prev = at;
    const comp = r() < 0.62;
    const grade = Math.max(34, Math.min(97, Math.round(58 + 19 * t + (r() - 0.5) * 20)));
    const won = r() < 0.3 + (grade - 45) / 70;
    const team = comp ? (won ? 13 : Math.floor(r() * 12)) : (won ? 5 : Math.floor(r() * 5));
    const enemy = comp ? (won ? Math.floor(r() * 12) : 13) : (won ? Math.floor(r() * 5) : 5);
    const rounds = team + enemy;
    const kpr = 0.62 + grade / 160 + (r() - 0.5) * 0.3;
    const k = Math.max(2, Math.round(rounds * kpr));
    const d = Math.max(3, Math.round(rounds * (0.82 - grade / 400) + (r() - 0.5) * 4));
    const multi = { 2: 0, 3: 0, 4: 0, 5: 0 };
    const highlights = [];
    for (let rd = 1; rd <= rounds; rd++) {
      const x = r();
      const kills = x < 0.0012 + t * 0.0018 ? 5 : x < 0.014 ? 4 : x < 0.075 ? 3 : x < 0.22 ? 2 : 0;
      const clutch = r() < 0.03 ? 1 + Math.floor(r() * 3) : 0;
      if (kills >= 2) multi[kills] += 1;
      if (kills >= 2 || clutch) highlights.push({ r: rd, k: kills, cv: clutch, clip: (kills >= 3 || clutch) && r() < 0.45 ? `h${rd}-clip.mkv` : null });
    }
    const clutches = highlights.filter((h) => h.cv).length;
    const weapons = {};
    for (let j = 0; j < k; j++) { const g = pick(r, GUNS); weapons[g] = (weapons[g] || 0) + 1; }
    const killedBy = {};
    for (let j = 0; j < d; j++) { const a = pick(r, ENEMIES); killedBy[a] = (killedBy[a] || 0) + 1; }
    const source = r() < 0.72 ? 'watched' : r() < 0.85 ? 'riot' : 'import';
    // Untraded deaths fall over the year; dying early stays.
    const mistakes = source === 'riot' ? null : [
      ...(r() < 0.85 - 0.6 * t ? [{ key: 'untraded', n: 3 + Math.floor(r() * 6), title: 'Died where nobody could trade' }] : []),
      ...(r() < 0.62 ? [{ key: 'early', n: 2 + Math.floor(r() * 5), title: 'Dying in the first 30 seconds' }] : []),
      ...(r() < 0.35 ? [{ key: 'lost-advantage', n: 2 + Math.floor(r() * 3), title: 'Gave back the advantage' }] : []),
      ...(r() < 0.28 ? [{ key: 'cause:isolated', n: 2, title: 'Caught alone' }] : []),
    ];
    if (comp) elo += won ? 14 + Math.floor(r() * 10) : -(10 + Math.floor(r() * 9));
    const tier = LADDER[Math.max(0, Math.min(LADDER.length - 1, Math.floor((elo - 1000) / 100)))];
    const id = `valorant-${at}-s${String(i).padStart(4, '0')}`;
    out.push({
      ...b, id, at, source,
      result: team > enemy ? 'win' : team < enemy ? 'loss' : 'draw',
      mode: comp ? 'Competitive' : 'Swiftplay',
      grade: { score: grade, letter: gradeOf.letter(grade), provisional: r() < 0.04 },
      k, d, a: Math.round(rounds * 0.18 + r() * 3),
      map: pick(r, MAPS), agent: pick(r, AGENTS),
      team, enemy, rounds, acs: Math.round(150 + kpr * 150 + (r() - 0.5) * 40), adr: null, hs: Math.round(18 + r() * 16),
      minutes: Math.round(rounds * 1.75 + 3), minutesBy: 'riot',
      riotRounds: source === 'watched' && r() < 0.15 ? 0 : rounds,
      multi, clutches, clutchBest: highlights.reduce((m, h) => Math.max(m, h.cv), 0),
      fk: Math.round(rounds * (0.12 + 0.06 * r())), fd: Math.round(rounds * (0.1 + 0.05 * r())),
      weapons, killedBy, mistakes, highlights: highlights.slice(0, 12),
      highlightClips: highlights.filter((h) => h.clip).map((h) => h.clip), deathClips: [],
      ...(comp ? { rank: { tier, elo } } : {}),
      matchStartedAt: at - rounds * 105000, matchId: null,
    });
  }
  const champs = [['Ahri', 3], ['Jinx', 2], ['Lux', 1], ['Ezreal', 1]];
  for (let i = 0; i < nl; i++) {
    const at = new Date(YEAR, 2 + i, 9 + i, 20).getTime();
    const grade = Math.round(55 + i * 3 + (r() - 0.5) * 10);
    out.push({
      v: W.SCHEMA, id: `lol-${at}-l${String(i).padStart(4, '0')}`, game: 'lol', at, source: 'watched',
      result: r() < 0.55 ? 'win' : 'loss', mode: 'Ranked Solo', grade: { score: grade, letter: gradeOf.letter(grade), provisional: false },
      k: 4 + Math.floor(r() * 8), d: 2 + Math.floor(r() * 6), a: 5 + Math.floor(r() * 9),
      champion: pick(r, champs), role: 'Middle', cs: 150 + Math.floor(r() * 90), minutes: 26 + Math.floor(r() * 12), minutesBy: 'game', deathClips: [],
    });
  }
  return out.sort((a, b2) => a.at - b2.at);
}

module.exports = { rows, base, YEAR };

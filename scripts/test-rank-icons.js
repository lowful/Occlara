'use strict';

/**
 * test:rankicons. THE RANK'S OWN ICON (9.1, the owner's item 10): the rank
 * card on Home and on Stats shows the player's real rank icon, the right tier
 * and division, beside the rank, with the RR, the way to the next tier and
 * the last change. Held here:
 *
 *   - every tier src/shared/rank-tiers.js knows, and Unranked, has its file in
 *     assets/ranks (npm run sync:rankicons), a whole WebP with its alpha, its
 *     RIFF size its length (a piped WebP leaves it 0 and Chromium refuses
 *     it), small, and no file the ladder does not know;
 *   - the names Riot and HenrikDev print find their tier in any case or
 *     spacing, and nothing else does;
 *   - the ladder's order, the tier after each, where the RR stops being
 *     capped at 100, and the RR read back from a history point's elo, by
 *     HenrikDev's own example;
 *   - Home's preload names the file for the card's tier, and Stats' preload
 *     names it and the way to the next tier;
 *   - the Trainer asks for none of it (it ships nothing of Riot's).
 *
 * Run: npm run test:rankicons
 */

const fs = require('fs');
const path = require('path');
const T = require('../src/shared/rank-tiers');
const { rankModel } = require('../src/shared/home-model');
const { loadPreload, settle } = require('./fixtures/fake-dom');
const C = require('../src/shared/channels');

const ROOT = path.join(__dirname, '..');
const DIR = path.join(ROOT, 'assets', 'ranks');

let fails = 0;
let checks = 0;
const ok = (cond, what, detail) => {
  checks++;
  if (!cond) { fails++; console.log(`FAIL  ${what}${detail ? `\n        ${detail}` : ''}`); } else console.log(`ok    ${what}`);
};

(async () => {
  // ── The files ──────────────────────────────────────────────────────────────
  const files = fs.existsSync(DIR) ? fs.readdirSync(DIR) : [];
  ok(T.SLUGS.length === 26 && T.TIERS.length === 25, 'the ladder: 25 tiers, Iron 1 to Radiant, and Unranked', T.SLUGS.join());
  const missing = T.SLUGS.filter((s) => !files.includes(`${s}.webp`));
  ok(!missing.length, 'every tier and Unranked has its icon in assets/ranks', missing.join(', '));
  const stray = files.filter((f) => !T.SLUGS.includes(f.replace(/\.webp$/, '')));
  ok(!stray.length, 'and no file the ladder does not know', stray.join(', '));
  let total = 0;
  const bad = [];
  for (const s of T.SLUGS) {
    const f = path.join(DIR, `${s}.webp`);
    if (!fs.existsSync(f)) continue;
    const b = fs.readFileSync(f);
    total += b.length;
    const riff = b.length > 30 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP';
    const sized = riff && b.readUInt32LE(4) + 8 === b.length;
    // VP8X with its alpha flag, or VP8L (lossless, which always carries alpha).
    const chunk = riff ? b.toString('ascii', 12, 16) : '';
    const alpha = chunk === 'VP8L' || (chunk === 'VP8X' && (b[20] & 0x10) !== 0);
    const w = chunk === 'VP8X' ? 1 + b.readUIntLE(24, 3) : null;
    const h = chunk === 'VP8X' ? 1 + b.readUIntLE(27, 3) : null;
    if (!riff || !sized || !alpha || b.length > 24 * 1024 || (w !== null && (w !== 128 || h !== 128))) bad.push(`${s} (${b.length} B, ${chunk}, ${w}x${h})`);
  }
  ok(!bad.length, 'each a whole WebP with its alpha, its RIFF size its length, 128 pixels square and under 24 KB', bad.join(', '));
  ok(total < 512 * 1024, `all of them together are small (${Math.round(total / 1024)} KB)`);

  // ── The names ──────────────────────────────────────────────────────────────
  const slugs = ['Diamond 1', 'diamond 1', 'DIAMOND  1', 'Diamond1', ' Diamond 1 '].map(T.slugOf);
  ok(slugs.every((s) => s === 'diamond-1'), 'a tier is found in any case or spacing HenrikDev or Riot print it', JSON.stringify(slugs));
  ok(T.slugOf('Radiant') === 'radiant' && T.slugOf('RADIANT') === 'radiant' && T.slugOf('Unrated') === 'unranked' && T.slugOf('Unranked') === 'unranked',
    'Radiant, and Unrated and Unranked as one');
  ok(['Diamond 4', 'Bogus 2', 'Radiant 1', '', null, undefined, 'Immortal', 'Gold 0'].every((x) => T.slugOf(x) === null),
    'and nothing the ladder does not know: no fourth division, no made up tier, no Radiant 1');
  ok(T.iconFile('Ascendant 3') === 'ranks/ascendant-3.webp' && T.iconFile('Radiant') === 'ranks/radiant.webp' && T.iconFile('Bogus') === null,
    'the icon path for a tier, and none for a name not known');

  // ── The ladder ─────────────────────────────────────────────────────────────
  const chain = [];
  for (let t = 'Iron 1'; t; t = T.nextOf(t)) chain.push(t);
  ok(chain.length === 25 && chain.join() === T.TIERS.join(), 'from Iron 1 the tier after each walks the whole ladder to Radiant, and stops');
  ok(T.nextOf('Ascendant 3') === 'Immortal 1' && T.nextOf('Immortal 3') === 'Radiant' && T.nextOf('Radiant') === null && T.nextOf('Platinum 3') === 'Diamond 1',
    'across every tier boundary');
  ok(T.capped('Ascendant 3') && T.capped('Iron 1') && !T.capped('Immortal 1') && !T.capped('Immortal 3') && !T.capped('Radiant') && !T.capped('Bogus'),
    'the RR runs in steps of 100 below Immortal and not from Immortal 1');
  ok(T.placeOf('Iron 1') === 0 && T.placeOf('Gold 1') === 9 && T.placeOf('Radiant') === 24 && T.placeOf('Unranked') === null,
    "a tier's place is Riot's tier number less 3");
  // HenrikDev's own example: currenttier 12, "Gold 1", ranking_in_tier 29, elo 929.
  ok(T.rrOf('Gold 1', 929) === 29 && T.rrOf('Diamond 1', 1544) === 44 && T.rrOf('Immortal 3', 2550) === 250 && T.rrOf('Radiant', 2920) === 520
    && T.rrOf('Immortal 1', 2100) === 0, "the RR read back from a history point's elo, uncapped from Immortal 1");
  ok(T.rrOf('Diamond 1', 1844) === null && T.rrOf('Gold 1', 899) === null && T.rrOf('Radiant', 'x') === null && T.rrOf('Bogus', 900) === null,
    'and nothing when the elo does not fit the tier it names: never a guess');

  // ── The card's model ───────────────────────────────────────────────────────
  const pts = (tier, elos) => ({ points: elos.map((elo, i) => ({ date: 1e12 + i * 1e6, elo, change: i ? elos[i] - elos[i - 1] : 12, tier })) });
  const imm = rankModel(pts('Immortal 2', [2290, 2312]));
  ok(imm && imm.rr === 112 && imm.capped === false && imm.next === 'Immortal 3' && imm.change === 22, 'Immortal 2: its RR uncapped, no step of 100, the next tier named', JSON.stringify(imm));
  const rad = rankModel(pts('Radiant', [2900, 2944]));
  ok(rad && rad.rr === 544 && rad.next === null && rad.capped === false, 'Radiant: its RR, no tier after it', JSON.stringify(rad));
  const dia = rankModel(pts('Diamond 1', [1530, 1557]));
  ok(dia && dia.rr === 57 && dia.capped === true && dia.next === 'Diamond 2', 'Diamond 1 at 57: 43 to Diamond 2', JSON.stringify(dia));

  // ── The preloads ───────────────────────────────────────────────────────────
  const home = loadPreload('home', {
    [C.STATS_RANK_HISTORY]: () => pts('Ascendant 3', [2280, 2291]),
    [C.REVIEWS_LIST]: () => [],
  });
  const r = await home.api.getRank('valorant');
  ok(r && r.card && r.card.icon === '../../../assets/ranks/ascendant-3.webp' && r.card.next === 'Immortal 1', "Home's preload names the card's own icon file", JSON.stringify(r && r.card));
  const lol = await home.api.getRank('lol');
  ok(lol === null, 'and nothing for League');
  const stats = loadPreload('stats', {});
  ok(stats.api.rankIcon('Gold 2') === '../../../assets/ranks/gold-2.webp' && stats.api.rankIcon('Nope') === null, "Stats' preload names the tile's icon file");
  const prog = stats.api.rankProgress('Gold 2', 1067);
  ok(prog && prog.rr === 67 && prog.next === 'Gold 3' && prog.capped === true, "and the way to the next tier from a history point's elo", JSON.stringify(prog));
  ok(stats.api.rankProgress('Bogus', 900) === null && stats.api.rankProgress('Gold 2', 0) === null, 'and none for a tier or an elo it cannot read');
  // Iron 1 at 0 RR is an elo of 0, the one tier where 0 is a rank (9.1).
  const iron = stats.api.rankProgress('Iron 1', 0);
  ok(iron && iron.rr === 0 && iron.next === 'Iron 2' && iron.capped === true && stats.api.rankProgress('Unranked', 0) === null,
    'Iron 1 at 0 RR is a rank with 100 to Iron 2; Unranked at 0 is none', JSON.stringify(iron));
  const iron0 = rankModel(pts('Iron 1', [19, 0]));
  ok(iron0 && iron0.tier === 'Iron 1' && iron0.rr === 0 && iron0.change === -19 && iron0.next === 'Iron 2',
    "Home's model: Iron 1 at 0 RR is the rank, and the game that cost 19 its last change", JSON.stringify(iron0));
  ok(rankModel({ points: [{ date: 1e12, elo: 0, change: 0, tier: 'Unrated' }, { date: 1e12 + 1, elo: 0, change: 0, tier: 'Gold 2' }] }) === null,
    'an elo of 0 under any tier but Iron 1 is still no rank');
  await settle();

  // ── Never in the Trainer ───────────────────────────────────────────────────
  const trainer = path.join(ROOT, 'src', 'renderer', 'trainer');
  const named = fs.existsSync(trainer) ? fs.readdirSync(trainer).filter((f) => /\.(js|html|css)$/.test(f))
    .filter((f) => /assets\/ranks|rank-tiers|rankIcon/.test(fs.readFileSync(path.join(trainer, f), 'utf8'))) : [];
  ok(!named.length, 'the Trainer asks for no rank icon', named.join(', '));

  console.log(`\n${fails ? `FAIL: ${fails} of ${checks}` : `all ${checks} rank icon checks passed`}`);
  process.exit(fails ? 1 : 0);
})();

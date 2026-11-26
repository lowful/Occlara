'use strict';

/**
 * THE MATCH RATING'S ARCHETYPES (docs/claude/rating.md, "The bottom of the
 * scale"): eleven players written as rounds of Riot's record, from the second
 * independent review of the rating (a hard carry, an entry always traded, a
 * lurker, a baiter, a support, a sentinel, an AFK Riot did not flag, a lost
 * clutch hero, a bottom frag, a top frag on a losing team and a 12/12
 * player), and a balanced lobby where every kill and death rotates through
 * the ten. Synthetic, agents only. test:rating holds their order.
 */

const U = ['us:Sova', 'us:Omen', 'us:Killjoy', 'us:Sage'];
const T = ['them:Jett', 'them:Raze', 'them:Viper', 'them:Cypher', 'them:Skye'];
const end = (key) => (key === 'me' ? { by: 'me' } : key.startsWith('us:') ? { by: 'mate', a: key.slice(3) } : { by: 'enemy', a: key.slice(5) });
const sideOf = (n) => (n <= 12 ? 'attacking' : 'defending');

/*
 * A round as a list of tokens, the round played out in order:
 *   'M>e' me kills next enemy, 'm>e' a mate kills next enemy, 'e>m' enemy kills next mate, 'e>M' enemy kills me,
 *   'M>e+a' me kills with a mate assisting, 'm>e+M' a mate kills, me assisting,
 *   'P:M' I plant, 'P:m' a mate plants, 'P:e' they plant, 'D:M' I defuse, 'D:m' a mate defuses, 'D:e' they defuse,
 *   'T' the spike's time passes (45 s), 'gap' a long wait (20 s).
 * The enemy killing is the next enemy still up; a trade is the killer of the last death killed next.
 */
function play(n, won, tokens) {
  const usUp = ['me', ...U]; const themUp = [...T]; const feed = []; let t = 5000; let plantMs; let plantBy; let defuseMs; let defuseBy;
  let lastKiller = null;
  for (const tok of tokens) {
    if (tok === 'gap') { t += 20000; continue; }
    if (tok === 'T') { t = (plantMs || t) + 46000; continue; }
    if (tok.startsWith('P:')) { plantMs = t; plantBy = end(tok[2] === 'M' ? 'me' : tok[2] === 'm' ? usUp.find((x) => x !== 'me') : themUp[0]); t += 3000; continue; }
    if (tok.startsWith('D:')) { defuseMs = t; defuseBy = end(tok[2] === 'M' ? 'me' : tok[2] === 'm' ? usUp.find((x) => x !== 'me') : themUp[0]); t += 1000; continue; }
    const [body, assist] = tok.split('+');
    const [k, v] = body.split('>');
    let killer; let victim;
    if (k === 'M') killer = 'me'; else if (k === 'm') killer = usUp.find((x) => x !== 'me'); else killer = themUp.includes(lastKiller) && v !== 'e' ? lastKiller : themUp[0];
    if (v === 'e') victim = (k !== 'e' && themUp.includes(lastKiller)) ? lastKiller : themUp[0];
    else if (v === 'M') victim = 'me'; else victim = usUp.find((x) => x !== 'me') || 'me';
    if (!killer || !victim) continue;
    const e = { ms: t, by: end(killer).by, on: end(victim).by, w: 'Vandal' };
    if (end(killer).a) e.ka = end(killer).a; if (end(victim).a) e.va = end(victim).a;
    if (assist) { const a = assist === 'M' ? 'me' : usUp.find((x) => x !== 'me' && x !== killer); if (a) e.as = [end(a)]; }
    feed.push(e);
    if (victim.startsWith('them')) themUp.splice(themUp.indexOf(victim), 1); else usUp.splice(usUp.indexOf(victim), 1);
    lastKiller = killer;
    t += tok.startsWith('e>') && feed.length > 1 ? 900 : 3500;
  }
  return { n, side: sideOf(n), won, feed, ...(plantMs != null ? { plantMs, plantBy } : {}), ...(defuseMs != null ? { defuseMs, defuseBy } : {}) };
}
const s = (x) => x.split(' ');
// Background rounds where the subject is average: one kill or one death
const avgW = s('m>e e>m M>e m>e m>e m>e');           // won, me 1 kill, survive
const avgL = s('e>m m>e e>M e>m e>m e>m');           // lost, me dies
const quietW = s('m>e e>m m>e m>e m>e m>e');          // won, nothing of mine
const quietL = s('e>m e>m m>e e>m e>M e>m');          // lost, I die 4th-ish

function match(pattern, pick) {
  const rs = []; let i = 0;
  for (const c of pattern) { i++; rs.push(play(i, c === 'W', pick(i, c === 'W'))); }
  return rs;
}
const A = {
  'hard carry (13-9)': match('WWLWWLWWLWLWWLWWLWLWLW', (n, w) => (w ? (n % 2 ? s('M>e e>m M>e m>e m>e m>e') : s('m>e e>m M>e m>e m>e m>e')) : (n % 3 ? s('M>e e>m e>M e>m e>m e>m') : avgL))),
  'entry, always traded (13-11)': match('WLWLWWLWLWLWLWLWWLWLWLWW', (n, w) => (w ? (n % 2 ? s('M>e e>M m>e e>m m>e m>e m>e') : s('e>M m>e e>m m>e m>e m>e m>e')) : (n % 2 ? s('e>M m>e e>m e>m e>m m>e e>m') : s('M>e e>M m>e e>m e>m e>m e>m')))),
  'lurker, late kills (13-11)': match('WLWWLWLWLWLWWLWLWLWLWLWW', (n, w) => (w ? (n % 2 ? s('e>m m>e e>m m>e gap M>e m>e m>e') : s('e>m m>e e>m gap M>e e>m m>e m>e m>e')) : (n % 2 ? s('e>m m>e e>m e>m gap M>e e>M') : s('e>m e>m m>e e>m gap e>M')))),
  'baiter, exit kills (12-12)': match('WLWLWLWLWLWLWLWLWLWLWLWL', (n, w) => (w ? s('m>e m>e e>m m>e m>e M>e') : (n % 4 === 2 ? s('e>m P:e e>m m>e e>m e>m T M>e e>M') : s('e>m e>m e>m m>e e>m e>M')))),
  'support, assists and plants (13-11)': match('WWLWLWLWWLWLWLWWLWLWLWLW', (n, w) => (w ? (n <= 12 ? s('m>e+M e>m P:M m>e+M e>m m>e m>e+M m>e') : s('m>e+M e>m m>e e>M m>e m>e m>e')) : (n <= 12 ? s('e>m P:M m>e+M e>M e>m e>m e>m') : s('e>m m>e+M e>M e>m e>m e>m')))),
  'sentinel, survives, defuses (13-11)': match('WLWWLWLWLWLWWWLWLWLWWLWL', (n, w) => (w ? (n > 12 ? s('e>m m>e P:e m>e M>e m>e m>e D:M') : s('e>m m>e M>e m>e m>e m>e')) : (n > 12 ? s('e>m P:e m>e e>m e>m e>m T') : s('e>m e>m m>e e>m e>m')))),
  'AFK, not flagged (3-13)': match('LLWLLLLLWLLLLWLL', (n, w) => (w ? quietW : s('e>m e>m e>m e>m gap e>M'))),
  '1v4 clutch hero, lost (9-13)': match('LWLLWLLWLLWLLLWLWLLWWL', (n, w) => (w ? ([2, 11, 20].includes(n) ? s('e>m m>e e>m e>m e>m gap M>e M>e M>e M>e') : avgW) : avgL)),
  'bottom frag, won (13-7)': match('WWLWWLWWLWWLWWLWWLWW', (n, w) => (w ? (n % 3 ? s('e>M m>e m>e e>m m>e m>e m>e') : s('M>e e>M m>e m>e m>e m>e')) : (n % 2 ? s('M>e e>M e>m m>e e>m e>m e>m') : s('e>M e>m m>e e>m e>m e>m')))),
  'top frag, lost (10-13)': match('LWLLWLWLLWLWLLWLWLLWLWL', (n, w) => (w ? s('M>e e>m M>e m>e m>e m>e') : (n % 2 ? s('M>e e>m e>m e>m e>M e>m') : s('e>m M>e e>m e>m e>M e>m')))),
  'average player (12-12)': match('WLWLWLWLWLWLWLWLWLWLWLWL', (n, w) => (w ? (n % 2 ? avgW : quietW) : (n % 4 === 0 ? quietL : avgL))),
};

function balanced(rounds) {
  const US = ['me', 'Sova', 'Omen', 'Killjoy', 'Sage'];
  const TH = ['Jett', 'Raze', 'Viper', 'Cypher', 'Skye'];
  const out = [];
  for (let n = 1; n <= rounds; n++) {
    const up = { us: US.slice(), them: TH.slice() };
    const feed = []; let t = 4000; let i = 0;
    const usWins = n % 2 === 1;
    while (up.us.length && up.them.length) {
      // the winning side kills two in three
      const usKills = (i % 3 !== 2) === usWins;
      const ks = usKills ? up.us : up.them; const vs = usKills ? up.them : up.us;
      const killer = ks[(n + i) % ks.length]; const victim = vs[(n * 3 + i) % vs.length];
      const end = (who, ours) => (who === 'me' ? { by: 'me' } : { by: ours ? 'mate' : 'enemy', a: who });
      const K = end(killer, usKills); const V = end(victim, !usKills);
      feed.push({ ms: t, by: K.by, on: V.by, ...(K.a ? { ka: K.a } : {}), ...(V.a ? { va: V.a } : {}), w: 'Vandal' });
      vs.splice(vs.indexOf(victim), 1); t += 6000; i++;
    }
    out.push({ n, side: n <= 12 ? 'attacking' : 'defending', won: up.us.length > 0, feed });
  }
  return out;
}

module.exports = { A, balanced, play };

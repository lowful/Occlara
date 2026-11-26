'use strict';

/**
 * HOW WELL THE RATING VIDEO READS A VIDEO ALONE (docs/claude/rating.md "The
 * video tool"), on the owner's own data, read only, no name printed.
 *
 * 1. The round rule (events.js: a new round after a wipe, or after GAP_S with
 *    no row) on Riot's record of every round his reviews keep: the gaps
 *    between kills inside a round that would split it, and the boundaries it
 *    could miss (the next round's first kill comes at least the 30 s buy
 *    phase after the last one, a lower bound).
 * 2. The numbers standing on his death clips with Riot's feed: at each kill
 *    Riot names inside the clip, one second later, are both teams' players
 *    down (counted from the clip's start) what Riot says?
 * 3. --review's placing from the video alone (plan.js alignRounds) against
 *    the clip's own death mark, on the clips that have one.
 *
 *   npm run measure:ratingvideo [-- --fps=10]
 */

const fs = require('fs');
const path = require('path');
const { probe, readFeed } = require('./rating-video');
const { createOfflineReader, GAP_S, WIPE_GAP_S, ROW_S } = require('./rating-video/events');
const { alignRounds } = require('./rating-video/plan');

const ROOT = path.join(process.env.APPDATA || '', 'Occlara', 'reviews');
const FPS = Number((process.argv.find((a) => a.startsWith('--fps=')) || '--fps=10').slice(6));
const BUY_S = 30;

function reviews() {
  if (!fs.existsSync(ROOT)) return [];
  return fs.readdirSync(ROOT).filter((f) => f.endsWith('.json') && f !== 'index.json').map((f) => {
    const v = JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8')).review;
    return v && v.kind === 'valorant' ? { id: f.slice(-11, -5), review: v, dir: path.join(ROOT, f.replace(/\.json$/, '')) } : null;
  }).filter(Boolean);
}

const team = (k) => (k === 'me' || k === 'mate' || k === 'us' ? 'us' : 'them');

(async () => {
  const all = reviews();
  // 1. The round rule on Riot's record.
  let within = 0; let split = 0; let bounds = 0; let missed = 0; let wipes = 0; let rounds = 0;
  for (const { review } of all) {
    const rs = (review.rounds || []).filter((c) => c.riot && Array.isArray(c.riot.feed)).sort((a, b) => a.n - b.n);
    for (let i = 0; i < rs.length; i++) {
      rounds++;
      const feed = rs[i].riot.feed.filter((e) => Number.isFinite(e.ms)).sort((a, b) => a.ms - b.ms);
      for (let k = 1; k < feed.length; k++) { within++; if ((feed[k].ms - feed[k - 1].ms) / 1000 >= GAP_S) split++; }
      const prev = i > 0 && rs[i - 1].n === rs[i].n - 1 ? rs[i - 1] : null;
      if (!prev || !feed.length) continue;
      bounds++;
      const pf = prev.riot.feed;
      const wiped = pf.filter((e) => team(e.on) === 'us').length >= 5 || pf.filter((e) => team(e.on) === 'them').length >= 5;
      if (wiped) wipes++;
      // The least the gap can be: the buy phase and the next round's first kill.
      const least = BUY_S + feed[0].ms / 1000;
      if (!(wiped ? least >= WIPE_GAP_S + ROW_S : least >= GAP_S)) missed++;
    }
  }
  console.log(`THE ROUND RULE on Riot's record: ${rounds} rounds, ${bounds} boundaries between rounds kept in a row`);
  console.log(`  ${wipes} of ${bounds} rounds before a boundary ended in a wipe`);
  console.log(`  boundaries the rule could miss: ${missed} of ${bounds} (a lower bound on the gap, so at most this)`);
  console.log(`  gaps inside a round of ${GAP_S} s or more, a round split where none was: ${split} of ${within}`);

  // 2 and 3. The clips.
  let moments = 0; let both = 0; let usOk = 0; let themOk = 0; let clips = 0;
  const offErr = [];
  let placed = 0; let withMark = 0;
  for (const rv of all) {
    for (const c of rv.review.rounds || []) {
      const fo = c.forensics;
      if (!fo || !fo.clip || !fs.existsSync(path.join(rv.dir, fo.clip))) continue;
      const feed = c.riot && Array.isArray(c.riot.feed) ? c.riot.feed.filter((e) => Number.isFinite(e.ms)) : null;
      if (!feed || !Number.isFinite(fo.clipDeath)) continue;
      const file = path.join(rv.dir, fo.clip);
      const info = probe(file);
      const reader = createOfflineReader({});
      await readFeed({ input: file, fps: FPS }, info, reader);
      const ev = reader.finish(info.duration).events.filter((e) => e.kind === 'kill');
      const death = feed.find((e) => e.on === 'me');
      if (!death) continue;
      clips++;
      const off = (fo.clipDeath - death.ms) / 1000;
      const truth = feed.map((e) => ({ t: off + e.ms / 1000, victim: team(e.on) }));
      // Rows on screen in the first half second were made before the clip: neither side counts them.
      const inClip = (t) => t >= 0.5 && t <= info.duration;
      const count = (list, at, side) => list.filter((e) => inClip(e.t) && e.t <= at && (side === 'us' ? (e.victim === 'us' || e.victim === 'me') : e.victim === 'them')).length;
      for (const k of truth.filter((e) => inClip(e.t) && e.t + 1 <= info.duration)) {
        const at = k.t + 1;
        moments++;
        const u = count(ev, at, 'us') === count(truth, at, 'us');
        const th = count(ev, at, 'them') === count(truth, at, 'them');
        if (u) usOk++; if (th) themOk++; if (u && th) both++;
      }
      // 3: the clip placed from the video alone, against its own mark.
      withMark++;
      const one = { rounds: [c], game: rv.review.game };
      const got = alignRounds(one, ev);
      if (got.has(c.n)) { placed++; offErr.push(Math.abs(got.get(c.n) - off)); }
      console.log(`${rv.id} r${c.n} ${info.H}p: kills read ${ev.length}, in Riot's feed in the clip ${truth.filter((e) => inClip(e.t)).length}; placed from the video ${got.has(c.n) ? `${(got.get(c.n) - off).toFixed(2)} s from the mark` : 'not placed'}`);
    }
  }
  const pc = (a, b) => (b ? `${(100 * a / b).toFixed(1)}%` : '-');
  const q = (a, p) => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * p))].toFixed(2) : '-'; };
  console.log(`\nTHE NUMBERS STANDING on ${clips} clips with Riot's feed and a death mark, at ${FPS} a second, one second after each kill:`);
  console.log(`  both teams right ${both} of ${moments} (${pc(both, moments)}), the player's team ${pc(usOk, moments)}, the enemy ${pc(themOk, moments)}`);
  console.log(`--review PLACED FROM THE VIDEO ALONE: ${placed} of ${withMark} clips, off the death mark by p50 ${q(offErr, 0.5)} s, max ${q(offErr, 1)} s`);
})().catch((e) => { console.error(e.message); process.exit(1); });

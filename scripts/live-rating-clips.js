'use strict';

/**
 * THE LIVE RATING ON FULL RATE VIDEO (docs/claude/rating.md "Live", round 2).
 *
 * The owner's death clips (r<n>-clip.mkv beside his saved reviews, 30 a
 * second at the recording's own height) are real recordings with the death
 * and every kill of the round at known moments (the clip's own death mark and
 * Riot's feed on the review). Each is decoded with the bundled ffmpeg at the
 * rate the recorder's page reads the corner live (--fps, 5 by default; 2, 10
 * and 30 to compare), only the kill feed's corner, read by the detector and fed
 * to the live feed with two frame confirmation, the context saying the player
 * is dead a second after the death (the guarded context's lag). Read only:
 * nothing is copied, no name is printed. A clip saved before its death mark
 * was kept has its death placed 4.45 s before its end (est), the others' mean.
 *
 *   node scripts/live-rating-clips.js [--fps=5] [--mine=2] [--lag=1] [-v]
 */
const fs = require('fs'); const path = require('path'); const { execFileSync } = require('child_process');
const FF = require('ffmpeg-static');
const kf = require('../src/shared/killfeed');
const { createLiveRating } = require('../src/shared/live-rating');
const ROOT = path.join(process.env.APPDATA || '', 'Occlara', 'reviews');
const args = process.argv.slice(2);
const FPS = Number((args.find((a) => a.startsWith('--fps=')) || '--fps=5').slice(6));
const MINE = Number((args.find((a) => a.startsWith('--mine=')) || '--mine=2').slice(7));
const VERB = args.includes('-v');
const ALIVE_LAG = Number((args.find((a) => a.startsWith('--lag=')) || '--lag=1').slice(6));  // s the guarded context takes to say dead

function clips() {
  const out = [];
  for (const f of fs.readdirSync(ROOT).filter((x) => x.endsWith('.json') && x !== 'index.json')) {
    const v = JSON.parse(fs.readFileSync(path.join(ROOT, f))).review;
    const dir = path.join(ROOT, f.replace(/\.json$/, ''));
    for (const c of v.rounds || []) {
      const fo = c.forensics;
      if (!fo || !fo.clip || !fs.existsSync(path.join(dir, fo.clip))) continue;
      const file = path.join(dir, fo.clip);
      const info = (() => { try { execFileSync(FF, ['-hide_banner', '-i', file], { stdio: ['ignore', 'pipe', 'pipe'] }); } catch (e) { return String(e.stderr); } return ''; })();
      const m = info.match(/, (\d{3,4})x(\d{3,4})/); const dm = info.match(/Duration: (\d+):(\d+):([\d.]+)/);
      const W = +m[1]; const H = +m[2]; const dur = (+dm[1]) * 3600 + (+dm[2]) * 60 + (+dm[3]);
      const feed = (c.riot && Array.isArray(c.riot.feed)) ? c.riot.feed : null;
      const dEv = feed && feed.find((e) => e.on === 'me');
      const deathMs = dEv ? dEv.ms : (c.riot && Number.isFinite(c.riot.sec) ? c.riot.sec * 1000 : null);
      const estimated = !Number.isFinite(fo.clipDeath);
      const clipDeath = estimated ? (dur - 4.45) * 1000 : fo.clipDeath;
      const evs = feed ? feed.map((e) => ({ t: (clipDeath - (deathMs - e.ms)) / 1000, by: e.by, on: e.on })) : null;
      out.push({ name: `${f.slice(-11, -5)}/${fo.clip}`, file, W, H, dur, clipDeath: clipDeath / 1000, estimated, evs, deathMs });
    }
  }
  return out;
}

function frames(c, fps) {
  const r = kf.regionOf(c.W, c.H);
  const buf = execFileSync(FF, ['-loglevel', 'error', '-i', c.file, '-vf', `fps=${fps},crop=${r.width}:${r.height}:${r.x}:${r.y}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 1 << 30 });
  const size = r.width * r.height * 3; const out = [];
  for (let k = 0; k * size < buf.length; k++) out.push({ t: k / fps, img: { width: r.width, height: r.height, data: buf.subarray(k * size, (k + 1) * size), channels: 3 } });
  return out;
}

const T0 = 1_800_000_000_000;
const tot = { k: { riot: 0, hit: 0, ev: 0, lag: [] }, d: { riot: 0, hit: 0, ev: 0, lag: [] }, o: { riot: 0, ev: 0 }, ms: [], multi: { riot: 0, hit: 0 } };
const byH = {};
for (const c of clips()) {
  const fr = frames(c, FPS);
  const live = createLiveRating({ mineSeen: MINE });
  let t0 = process.hrtime.bigint();
  for (const f of fr) {
    const s = process.hrtime.bigint(); const det = kf.detect(f.img, c.H); tot.ms.push(Number(process.hrtime.bigint() - s) / 1e6);
    const alive = f.t < c.clipDeath + ALIVE_LAG;
    live.frame({ at: T0 + f.t * 1000, match: T0, round: 1, side: 'attacking', phase: alive ? 'active' : 'dead', alive, team: 0, enemy: 0, clock: '1:20', det });
  }
  const ev = live.events().filter((e) => e.kind === 'kill' && e.out && !e.out.ignored).map((e) => ({ ...e, t: (e.at - T0) / 1000 }));
  // Rows on screen at the clip's start were made before it: never truth to find, never a mistake to count.
  const early = (e) => e.t < 0.5;
  const H = c.H; byH[H] = byH[H] || { k: { riot: 0, hit: 0, ev: 0 }, d: { riot: 0, hit: 0, ev: 0 }, clips: 0 }; byH[H].clips++;
  const used = new Set();
  const match = (truth, got, lo, hi) => { let hit = 0; const lag = []; const fp = [];
    for (const g of got) { const k = truth.findIndex((x, i) => !used.has(x) && g.t >= x.t + lo && g.t <= x.t + hi); if (k >= 0) { used.add(truth[k]); hit++; lag.push(g.t - truth[k].t); } else fp.push(g); }
    return { hit, lag, fp }; };
  const myK = ev.filter((e) => e.killer === 'me' && !early(e));
  const myD = ev.filter((e) => e.victim === 'me' && !early(e));
  const tk = c.evs ? c.evs.filter((e) => e.by === 'me' && e.on === 'enemy' && e.t >= 0.3 && e.t <= c.dur - 0.5) : [];
  // Rows made just before the clip are seen in its first seconds: truth for the matcher, not for recall.
  const tkAll = c.evs ? c.evs.filter((e) => e.by === 'me' && e.on === 'enemy' && e.t >= -6 && e.t <= c.dur) : [];
  const td = [{ t: c.clipDeath }];
  const mk = match(tkAll, myK, -0.5, 4); const md = match(td, myD, c.estimated ? -3 : -0.5, 4);
  if (!c.evs) { console.log('   (no feed) own kills counted', myK.length, myK.map((e)=>e.t.toFixed(1)).join(' ')); myK.length = 0; }
  const hitsInClip = mk.lag.length; // all hits
  const recallK = tk.filter((k) => used.has(k)).length;
  tot.k.riot += tk.length; tot.k.hit += recallK; tot.k.ev += myK.length; tot.k.lag.push(...mk.lag);
  tot.d.riot += 1; tot.d.hit += md.hit; tot.d.ev += myD.length; tot.d.lag.push(...md.lag);
  byH[H].k.riot += tk.length; byH[H].k.hit += recallK; byH[H].k.ev += myK.length; byH[H].d.riot++; byH[H].d.hit += md.hit; byH[H].d.ev += myD.length;
  // Everyone else's kills, counted once each.
  const oth = c.evs ? c.evs.filter((e) => !(e.by === 'me' || e.on === 'me') && e.t >= 0.3 && e.t <= c.dur - 0.5).length : null;
  const othEv = ev.filter((e) => e.killer !== 'me' && e.victim !== 'me' && !early(e)).length;
  if (oth !== null) { tot.o.riot += oth; tot.o.ev += othEv; }
  console.log(`${c.name.padEnd(22)} ${c.H}p ${c.estimated ? 'est' : '   '} death@${c.clipDeath.toFixed(1)} ownK ${recallK}/${tk.length} (counted ${myK.length}${mk.fp.length ? ', wrong ' + mk.fp.map((e) => e.t.toFixed(1)).join(' ') : ''}) death ${md.hit}/1 (counted ${myD.length}${md.fp.length ? ', wrong ' + md.fp.map((e) => e.t.toFixed(1)).join(' ') : ''}) others ${othEv}/${oth === null ? '?' : oth}`);
  if (VERB) { console.log('   truth', (c.evs || []).filter((e) => e.t > -6).map((e) => `${e.t.toFixed(1)}:${e.by}>${e.on}`).join(' ')); console.log('   got  ', ev.map((e) => `${e.t.toFixed(1)}:${e.killer}>${e.victim}`).join(' ')); }
}
const q = (a, p) => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * p))].toFixed(2) : '-'; };
const pc = (a, b) => (b ? (100 * a / b).toFixed(1) + '%' : '-');
console.log(`\n${FPS} fps, yellow on ${MINE} frame(s), the context says dead ${ALIVE_LAG} s after the death`);
for (const [H, v] of Object.entries(byH)) console.log(`${H}p (${v.clips} clips): kills ${v.k.hit}/${v.k.riot} found, ${v.k.ev} counted; deaths ${v.d.hit}/${v.d.riot}, ${v.d.ev} counted`);
console.log(`own kills  recall ${tot.k.hit}/${tot.k.riot} ${pc(tot.k.hit, tot.k.riot)}  counted ${tot.k.ev}  lag p50 ${q(tot.k.lag, .5)} p90 ${q(tot.k.lag, .9)}`);
console.log(`own deaths recall ${tot.d.hit}/${tot.d.riot} ${pc(tot.d.hit, tot.d.riot)}  precision ${tot.d.hit}/${tot.d.ev} ${pc(tot.d.hit, tot.d.ev)}  lag p50 ${q(tot.d.lag, .5)} p90 ${q(tot.d.lag, .9)}`);
console.log(`others' kills counted ${tot.o.ev} against ${tot.o.riot} in Riot's feed`);
console.log(`detector ${tot.ms.length} frames p50 ${q(tot.ms, .5)} ms p99 ${q(tot.ms, .99)} ms`);

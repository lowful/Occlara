'use strict';

/**
 * BENCH A'S LOOK SET (8.5.0): the deaths the label bench looks at, each as the
 * live client sends it, into userData/bench/looks/, never the repo.
 *
 * 8.4.3 sends five recording stills a death (frameAt -3, -1.5, -0.7, -0.3 and
 * 0.7 s from Riot's death), and on that body the look called four of its five
 * speaking looks lost-duel: the bench of 13 Oct sent two read frames, another
 * body. So the set is mostly recorded deaths, taken the way a player's are:
 *
 *   - the stills a review kept beside it (8.3.1 and later: the Fracture and
 *     Pearl swiftplays), copied as they were sent;
 *   - the stills a review's kept clip holds (the Sunset swiftplay, recorded
 *     on 8.3.0, before a look took them), decoded at clips.LOOK_AT through the
 *     app's own frames page (src/renderer/frames), as recordingStills does;
 *   - the read's frames a review kept, where it has nothing else (the Abyss
 *     swiftplay), and the Abyss 13 to 11's four teachable deaths from the
 *     bench's copy of its session, timed by Riot's record as an 8.3.1+ client
 *     times a match it did not record (bench-forensics.js --timed).
 *
 * Each death carries Riot's facts as its card has them, never a name: agents,
 * the weapon, the numbers standing, the trade, the plant, the screen's spot.
 *
 * A CLIP'S MOMENT. A look saved by 8.4.4 or later knows where in its clip the
 * death is (forensics.clipDeath). One saved before does not, and the moment
 * is given by hand, in seconds into the clip, as matched against the match's
 * AI log frame by frame: --at <review>@<round>=<seconds>, the review by the
 * end of its id. A clip with no moment is left out, said so, never guessed.
 * A round goes after an @, never a colon: an argument shaped like l7eesy:2
 * makes Electron exit before this script runs a line (shot-surface.js).
 *
 * THE KEY SHEET. Bench A is scored against a key written BEFORE it runs, by
 * people who watch each clip and its stills beside Riot's facts: for each
 * death the fight as it was, whether it was a fair duel, the labels a look
 * may give and the ones it must not. This writes the sheet to fill
 * (key.template.json, and key-sheet.html to read it by) and never touches a
 * key.json already there: that is the panel's.
 *
 *   npx electron scripts/make-look-set.js
 *   npx electron scripts/make-look-set.js --only eq7o3v,q3bntd,l7eesy,610vb4@2 --at l7eesy@2=9.2,l7eesy@3=12.2
 *   node scripts/make-look-set.js              (no clip stills: those need Electron)
 *
 *   --only   reviews by the end of their id, a round or rounds after an @ (610vb4@2, q3bntd@1+5);
 *            the Abyss 13 to 11's deaths are in the set either way
 *   --at     a clip's death in seconds into it, for a look saved before 8.4.4
 *   --no-abyss  leave the Abyss 13 to 11's deaths out
 *   --out    another folder than userData/bench/looks
 *
 * Reads the library and writes the set: no request, no model, no licence.
 */

const fs = require('fs');
const path = require('path');
const { profileDir, benchSession } = require('./profile-path');
const clips = require('../src/shared/clips');
const lookStills = require('../src/main/services/look-stills');
const df = require('../server/services/death-forensics');

const args = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : dflt;
};
const ROOT = profileDir(process.env.APPDATA || '');
const REVIEWS = path.join(ROOT, 'reviews');
const OUT = path.resolve(flag('out', path.join(ROOT, 'bench', 'looks')));
const ABYSS_SESSION = 'session-2026-09-22T04-24-07-240Z';
const WITH_ABYSS = !args.includes('--no-abyss');
const ELECTRON = !!process.versions.electron;

/** --only: { suffix: Set of rounds or null for every round }. */
function onlyOf(text) {
  if (!text) return null;
  const out = new Map();
  for (const part of String(text).split(',').map((s) => s.trim()).filter(Boolean)) {
    const [id, rounds] = part.split('@');
    out.set(id, rounds ? new Set(rounds.split('+').map(Number).filter(Number.isInteger)) : null);
  }
  return out;
}
/** --at: { 'suffix@n': seconds }. */
function atOf(text) {
  const out = new Map();
  for (const part of String(text || '').split(',').map((s) => s.trim()).filter(Boolean)) {
    const m = /^([A-Za-z0-9-]+)@(\d+)=(-?\d+(?:\.\d+)?)$/.exec(part);
    if (m) out.set(`${m[1]}@${m[2]}`, Number(m[3]));
    else console.log(`  --at ${part}: not <review>@<round>=<seconds>, so not taken`);
  }
  return out;
}
const ONLY = onlyOf(flag('only', null));
const AT = atOf(flag('at', ''));
const picked = (id, n) => {
  if (!ONLY) return true;
  for (const [suffix, rounds] of ONLY) if (id.endsWith(suffix) && (!rounds || rounds.has(n))) return true;
  return false;
};
const atFor = (id, n) => {
  for (const [k, s] of AT) {
    const [suffix, round] = k.split('@');
    if (id.endsWith(suffix) && Number(round) === n) return s;
  }
  return null;
};

// A weapon Riot's record named by its type, as 8.4.0 saved it, is no weapon:
// a client since sends none.
const weaponOf = (w) => (typeof w === 'string' && w && w.toLowerCase() !== 'weapon' ? w : null);

/*
 * A card saved before 8.0.3 keeps Riot's facts only as the sentences
 * roundFacts() wrote ("Died at B Main, 13s in, to Tejo with a Outlaw", "4
 * against 5 when you died"), from fixed words, so they read back exactly.
 */
function legacyFacts(card) {
  const facts = Array.isArray(card.facts) ? card.facts.map(String) : [];
  const died = facts.find((f) => /^Died\b/.test(f)) || '';
  const by = /\bto ([A-Za-z/]+)(?: with an? ([A-Za-z]+))?$/.exec(died);
  const sec = /\b(\d+)s in\b/.exec(died);
  const spot = /^Died at ([^,]+)/.exec(died);
  const alive = facts.map((f) => /^(\d+) against (\d+) when you died$/.exec(f)).find(Boolean);
  return {
    sec: sec ? Number(sec[1]) : null, killer: by ? by[1] : null, weapon: by ? weaponOf(by[2]) : null,
    firstDeath: facts.includes('First death of the round'),
    traded: facts.includes('Traded by a teammate') ? true : facts.includes('Not traded') ? false : null,
    alive: alive ? { mates: Number(alive[1]), enemies: Number(alive[2]) } : null,
    spot: spot ? spot[1].trim() : null,
  };
}

/** Riot's facts of one card, as askForensics sends them. Agents and the gun, never a name. */
function factsOf(card) {
  const riot = card.riot || null;
  const old = riot ? null : legacyFacts(card);
  const side = card.sideKey || (card.side === 'Attack' ? 'attacking' : card.side === 'Defence' ? 'defending' : null);
  if (old) return { n: card.n, side, ...old, spot: card.spot || old.spot, planted: !!card.planted, afterPlant: false };
  return {
    n: card.n, side, sec: typeof riot.sec === 'number' ? riot.sec : null,
    killer: riot.killer || null, weapon: weaponOf(riot.weapon), firstDeath: !!riot.firstDeath,
    traded: typeof riot.traded === 'boolean' ? riot.traded : null,
    alive: riot.alive && typeof riot.alive.mates === 'number' ? { mates: riot.alive.mates, enemies: riot.alive.enemies } : null,
    planted: !!card.planted, afterPlant: !!riot.afterPlant, spot: card.spot || null,
  };
}

/** The library's Valorant reviews, newest first: { id, review, dir }. */
function library() {
  let names = [];
  try { names = fs.readdirSync(REVIEWS).filter((f) => /^valorant-\d+-[a-z0-9]+\.json$/.test(f)); } catch { names = []; }
  return names.map((f) => {
    try {
      const j = JSON.parse(fs.readFileSync(path.join(REVIEWS, f), 'utf8'));
      return { id: j.id || f.replace(/\.json$/, ''), review: j.review || j, dir: path.join(REVIEWS, f.replace(/\.json$/, '')) };
    } catch { return null; }
  }).filter((x) => x && x.review && x.review.kind === 'valorant' && x.review.source !== 'riot')
    .sort((a, b) => (b.review.at || 0) - (a.review.at || 0));
}

function copy(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}
const exists = (p) => { try { return fs.statSync(p).isFile(); } catch { return false; } };

/** One looked at death of a review, or a reason it is left out. */
function deathOf(entry, card, decodeLater) {
  const f = card.forensics;
  const id = entry.id;
  const short = id.split('-').pop();
  const base = {
    key: `${short}:${card.n}`, review: id, round: card.n,
    match: `${entry.review.game && entry.review.game.map} ${String((entry.review.game && entry.review.game.mode) || '').toLowerCase()}`.trim(),
    map: (entry.review.game && entry.review.game.map) || null, agent: (entry.review.game && entry.review.game.agent) || null,
    source: f.source === 'screen' ? 'screen' : 'riot', facts: factsOf(card),
    clip: f.clip && exists(path.join(entry.dir, f.clip)) ? path.join(entry.dir, f.clip) : null,
  };
  const names = Array.isArray(f.frames) ? f.frames : [];
  // The stills it kept, as they were sent.
  if (f.framesFrom === 'recording' && Array.isArray(f.frameAt) && f.frameAt.length === names.length && names.every((n) => exists(path.join(entry.dir, n)))) {
    const frames = names.map((n) => { copy(path.join(entry.dir, n), path.join(OUT, short, n)); return path.posix.join(short, n); });
    return { ...base, body: 'recording', frames, frameAt: f.frameAt.slice(), framesFrom: 'recording' };
  }
  // The stills its clip holds, around the death's moment in it.
  const moment = Number.isFinite(f.clipDeath) ? f.clipDeath / 1000 : atFor(id, card.n);
  if (base.clip && moment !== null) {
    return decodeLater({ ...base, body: 'recording', framesFrom: 'recording' }, moment, short);
  }
  // A recorded death is looked at as the recording, or not at all: its read
  // frames are the body 8.4.3 no longer sends.
  if (base.clip) return { skip: `${base.key}: its clip has no moment saved with it; pass --at ${short}@${card.n}=<seconds into the clip>` };
  // The read's frames, where it kept nothing else.
  if (names.length >= 2 && names.every((n) => exists(path.join(entry.dir, n)))) {
    const frames = names.map((n) => { copy(path.join(entry.dir, n), path.join(OUT, short, n)); return path.posix.join(short, n); });
    const timed = Array.isArray(f.frameAt) && f.frameAt.length === names.length;
    return { ...base, body: 'reads', frames, frameAt: timed ? f.frameAt.slice() : null, framesFrom: timed ? 'reads' : null };
  }
  return { skip: `${base.key}: nothing of it kept to look at (${names.length} frame${names.length === 1 ? '' : 's'})` };
}

/** The Abyss 13 to 11's teachable deaths, from the bench's copy of its session, timed by Riot's record. */
function abyssDeaths() {
  const { replay, load } = require('./fixtures/replay-match');
  const verify = require('../src/shared/valorant-verify');
  const deathFrames = require('../src/shared/death-frames');
  const { dir } = benchSession(ROOT, ABYSS_SESSION);
  if (!dir) return { skip: `the Abyss 13 to 11: no copy of ${ABYSS_SESSION} in userData/bench or the AI log` };
  const log = JSON.parse(fs.readFileSync(path.join(dir, 'log.json'), 'utf8'));
  const played = replay(load('valorant-match-abyss-13-11.json').frames, 'standard');
  if (played.records.length !== log.records.length) return { skip: 'the Abyss 13 to 11: the fixture and the session no longer line up' };
  const records = played.records.map((r, i) => ({ ...r, frame: log.records[i].frame }));
  const riot = load('riot-abyss-13-11.json');
  const rounds = deathFrames.withRiotTimes(verify.reconcile(played.rounds, riot).rounds, riot);
  return deathFrames.looksFor(records, rounds, {}, 'riot').map(({ round: r, frames: recs, frameAt }) => {
    const frames = recs.map((x) => { copy(path.join(dir, x.frame), path.join(OUT, 'abyss', x.frame)); return path.posix.join('abyss', x.frame); });
    const timed = Array.isArray(frameAt) && frameAt.length === recs.length && frameAt.every(Number.isFinite);
    return {
      key: `abyss:${r.n}`, review: null, round: r.n, match: 'Abyss competitive', map: 'Abyss', agent: 'Jett', source: 'riot',
      facts: { n: r.n, side: r.side, sec: r.deathSec, killer: r.killerAgent, weapon: r.weapon, firstDeath: !!r.firstDeath,
        traded: typeof r.traded === 'boolean' ? r.traded : null, alive: r.aliveAtDeath || null, planted: !!r.planted,
        afterPlant: !!r.afterPlant, spot: r.deathSpot || null },
      clip: null, body: 'reads', frames, frameAt: timed ? frameAt.slice() : null, framesFrom: timed ? 'reads' : null,
    };
  });
}

/** Riot's facts in a line for the key sheet. */
function factLine(d) {
  const x = d.facts;
  const bits = [];
  bits.push(`round ${x.n}${x.side ? `, on ${x.side === 'attacking' ? 'attack' : 'defence'}` : ''}`);
  if (typeof x.sec === 'number') bits.push(`${x.sec} s in`);
  if (x.killer) bits.push(`killed by ${x.killer}${x.weapon ? ` with a ${x.weapon}` : ''}`);
  if (x.firstDeath) bits.push('the first death of the round');
  if (x.alive) bits.push(`${x.alive.mates} against ${x.alive.enemies} standing`);
  if (x.traded === true) bits.push('traded');
  if (x.traded === false) bits.push('not traded');
  if (x.planted) bits.push(x.afterPlant ? 'after the plant' : 'planted later');
  if (x.spot) bits.push(`the screen placed it at ${x.spot}`);
  return bits.join(', ');
}

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const at = (s) => (s < 0 ? `${Math.abs(s)} s before` : s === 0 ? 'at the death' : `${s} s after`);

/** The sheet the key is written on, and a page to read it by. key.json, the panel's, is never written here. */
function writeKey(deaths) {
  const labels = Object.entries(df.CAUSES_B).map(([k, v]) => ({ key: k, means: v, avoidable: df.AVOIDABLE.has(k) }));
  const fights = Object.fromEntries(Object.entries(df.FIGHTS).map(([k, f]) => [k, { causes: f.causes, changes: f.changes }]));
  const template = {
    note: 'The key bench A is scored against (npm run bench:forensics -- --own --key), written before the bench runs, by people '
      + 'who watch each death\'s clip and stills beside Riot\'s facts and never the coach\'s answer. Copy this file to key.json '
      + 'beside it and fill every death: "fight" one of the fights below, the fight as it was; "fair" true when it was a fight '
      + 'to take from where it was taken, lost on the shot (then "acceptable" is ["lost-duel"]); "acceptable" every label a look '
      + 'may give and be right; "forbidden" every label that would be wrong (never one that is acceptable); "unclear" true when '
      + 'the stills do not show the fight (then "acceptable" is ["unclear"]). A label on neither list is neither counted for nor '
      + 'against. "note" a sentence for the reader, never a player\'s name.',
    labels, fights,
    deaths: deaths.map((d) => ({
      key: d.key, match: d.match, agent: d.agent, riot: factLine(d),
      stills: d.frames.map((f, i) => `${f}${d.frameAt ? ` (${at(d.frameAt[i])})` : ''}`), clip: d.clip,
      fight: null, fair: null, unclear: null, acceptable: [], forbidden: [], note: '',
    })),
  };
  fs.writeFileSync(path.join(OUT, 'key.template.json'), JSON.stringify(template, null, 2) + '\n');
  const rows = deaths.map((d) => `<section><h2>${esc(d.key)}: ${esc(d.match)}, ${esc(d.agent)}</h2><p>${esc(factLine(d))}</p>`
    + `${d.clip ? `<p><a href="${esc(`file:///${d.clip.replace(/\\/g, '/')}`)}">the clip</a></p>` : '<p>no clip: the read\'s frames only</p>'}`
    + `<div class="row">${d.frames.map((f, i) => `<figure><img src="${esc(f.replace(/\\/g, '/'))}" alt=""><figcaption>${esc(d.frameAt ? at(d.frameAt[i]) : f)}</figcaption></figure>`).join('')}</div></section>`).join('\n');
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Bench A key sheet</title>
<style>body{font:14px/1.45 system-ui,sans-serif;margin:16px;background:#fff;color:#111}h2{font-size:15px;margin:24px 0 4px}.row{display:flex;gap:8px;flex-wrap:wrap}figure{margin:0;width:320px}img{width:320px;height:auto;display:block}figcaption{font-size:12px;color:#555}</style></head><body>
<h1>Bench A key sheet</h1><p>${esc(template.note)}</p>
<h2>The labels</h2><ul>${labels.map((l) => `<li><b>${esc(l.key)}</b>: ${esc(l.means)}</li>`).join('')}</ul>
<h2>The fights, and the labels each allows</h2><ul>${Object.entries(fights).map(([k, f]) => `<li><b>${esc(k)}</b>: ${esc(f.causes.join(', '))}</li>`).join('')}</ul>
${rows}
</body></html>
`;
  fs.writeFileSync(path.join(OUT, 'key-sheet.html'), html);
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const pending = [];
  const decodeLater = (death, moment, short) => { pending.push({ death, moment, short }); return { pending: death.key }; };
  const deaths = [];
  const skipped = [];
  const lib = library();
  console.log(`[looks] ${lib.length} recorded Valorant reviews in ${REVIEWS}`);
  for (const entry of lib) {
    for (const card of entry.review.rounds || []) {
      if (!card || !card.died || !card.forensics || !card.forensics.cause || !picked(entry.id, card.n)) continue;
      const d = deathOf(entry, card, decodeLater);
      if (d.skip) skipped.push(d.skip);
      else if (!d.pending) deaths.push(d);
    }
  }
  // The clips' stills, through the app's own frames page.
  if (pending.length && !ELECTRON) {
    for (const p of pending) skipped.push(`${p.death.key}: its stills are in its clip, and taking them needs Electron (npx electron scripts/make-look-set.js)`);
  } else if (pending.length) {
    const page = await require('../src/main/windows/frames-window').open();
    try {
      for (const p of pending) {
        const offsets = p.death.source === 'screen' ? clips.LOOK_AT.screen : clips.LOOK_AT.riot;
        const stills = await lookStills.stillsOf({ bytes: fs.readFileSync(p.death.clip), startWall: 0, moment: p.moment * 1000, offsets,
          decode: (job) => page.decode(job), size: { width: 1280, height: 720, quality: 0.7 } });
        if (stills.length < 2) { skipped.push(`${p.death.key}: its clip gave ${stills.length} still${stills.length === 1 ? '' : 's'} at ${p.moment} s`); continue; }
        const frames = stills.map((s, k) => {
          const name = clips.stillName(p.death.round, k + 1, s.at);
          const rel = path.posix.join(p.short, name);
          fs.mkdirSync(path.join(OUT, p.short), { recursive: true });
          fs.writeFileSync(path.join(OUT, rel), s.jpeg);
          return rel;
        });
        deaths.push({ ...p.death, frames, frameAt: stills.map((s) => s.at), clipMoment: p.moment });
      }
    } finally { page.close(); }
  }
  if (WITH_ABYSS) {
    const abyss = abyssDeaths();
    if (abyss.skip) skipped.push(abyss.skip); else deaths.push(...abyss);
  }
  const order = (d) => [d.review ? 0 : 1, d.key];
  deaths.sort((a, b) => (order(a)[0] - order(b)[0]) || order(a)[1].localeCompare(order(b)[1], 'en', { numeric: true }));
  const looks = { recording: deaths.filter((d) => d.body === 'recording').length, reads: deaths.filter((d) => d.body === 'reads').length };
  fs.writeFileSync(path.join(OUT, 'set.json'), JSON.stringify({
    made: new Date().toISOString(),
    note: 'Bench A\'s deaths, each as the live client sends it: Riot\'s facts and the frames, in time order, with their seconds from '
      + 'Riot\'s death where the look knew it. Made by scripts/make-look-set.js; the frames are beside this file.',
    deaths,
  }, null, 2) + '\n');
  writeKey(deaths);
  for (const s of skipped) console.log(`  left out: ${s}`);
  console.log(`[looks] ${deaths.length} deaths (${looks.recording} from the recording, ${looks.reads} the read's frames): ${deaths.map((d) => d.key).join(', ')}`);
  console.log(`[looks] wrote set.json, key.template.json and key-sheet.html to ${OUT}${exists(path.join(OUT, 'key.json')) ? ', and left key.json as it was' : ''}`);
  return deaths.length ? 0 : 1;
}

if (ELECTRON) {
  const { app } = require('electron');
  app.whenReady().then(main).then((code) => app.exit(code), (e) => { console.error(e && e.stack ? e.stack : e); app.exit(1); });
} else {
  main().then((code) => process.exit(code), (e) => { console.error(e && e.stack ? e.stack : e); process.exit(1); });
}

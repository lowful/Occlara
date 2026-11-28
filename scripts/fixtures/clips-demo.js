'use strict';

/**
 * A FULLER CLIPS PAGE, FOR LOOKING (9.1, the owner's items 12, 13 and 18).
 *
 * The sample library (proof-reviews.js) is one real match, Jett on Abyss,
 * saved four times, so on the Clips page every filter has one map, one agent
 * and one result, and one stub clip is kept. This lays the same real match
 * out as six matches on different maps, agents and results, the coach's look
 * on more of its deaths with a clip kept, a clip of each multi kill round,
 * and answers Storage, so the pictures show the hero, the filters, a clip's
 * menu, the confirm and the storage card as a real library would. The model
 * is main's own (src/shared/moments.js build), only the saved reviews are
 * stood in.
 *
 * Dev tool for scripts/shot-demo.js and scripts/test-clips-page.js, never
 * shipped. No name of any player: agents only.
 */
const path = require('path');
const proof = require('./proof-reviews');
const moments = require('../../src/shared/moments');
const patterns = require('../../src/shared/patterns');
const { mapArtOf } = require('../../src/shared/agent-icons');

const ROOT = path.join(__dirname, '..', '..');
const GB = 1024 * 1024 * 1024;
const MB = 1024 * 1024;

// Six matches, newest first: where, who, how it went, the grade.
const MATCHES = [
  { map: 'Split', agent: 'Jett', result: 'Victory', score: '13-9', mode: 'Competitive', grade: 84 },
  { map: 'Ascent', agent: 'Reyna', result: 'Defeat', score: '10-13', mode: 'Competitive', grade: 61 },
  { map: 'Bind', agent: 'Jett', result: 'Victory', score: '13-6', mode: 'Swiftplay', grade: 77 },
  { map: 'Haven', agent: 'Raze', result: 'Defeat', score: '8-13', mode: 'Competitive', grade: 58 },
  { map: 'Lotus', agent: 'Reyna', result: 'Victory', score: '13-11', mode: 'Competitive', grade: 71 },
  { map: 'Abyss', agent: 'Jett', result: 'Victory', score: '13-11', mode: 'Competitive', grade: 69 },
];
// The look's causes, given in turn to the deaths it looked at.
const CAUSES = ['dry-peek', 'isolated', 'crossfire', 'lost-duel', 'exposed', 'isolated', 'repeek'];

/**
 * The saved reviews ({ id, at, game, review }, newest first) and the clips on
 * disk beside each ({ id: [names] }). `keep` says how many matches keep clips.
 */
function library(opts) {
  const o = opts || {};
  const now = typeof o.now === 'number' ? o.now : Date.now();
  const b = proof.build({ now });
  const base = b.builtLooked;
  const saved = [];
  const onDisk = {};
  MATCHES.forEach((spec, i) => {
    const at = now - i * 26 * 3600000 - 40 * 60000;
    const id = `valorant-${at}-demo${i}`;
    let looked = 0;
    const kept = [];
    const rounds = base.rounds.map((c, k) => {
      const card = { ...c };
      // The coach looked at up to four of its deaths, a clip kept of each.
      if (c.died && looked < 4 && (k + i) % 3 !== 1) {
        const cause = CAUSES[(looked + i) % CAUSES.length];
        const clip = `r${c.n}-clip.mkv`;
        card.forensics = { ...(c.forensics || {}), cause, what: null, source: 'riot', at: now, clip, clipDeath: 11000 };
        looked += 1;
        if (i < (o.keep == null ? 5 : o.keep)) kept.push(clip);
      }
      // A clip of each multi kill round, its kills on the clip's own timeline.
      if (c.riot && typeof c.riot.kills === 'number' && c.riot.kills >= 2) {
        const clip = `h${c.n}-clip.mkv`;
        const kills = Array.from({ length: c.riot.kills }, (_v, j) => 3200 + j * 2100);
        card.highlight = { clip, length: kills[kills.length - 1] + 3000, kills, cuts: [] };
        if (i < (o.keep == null ? 5 : o.keep)) kept.push(clip);
      }
      return card;
    });
    const review = {
      ...base, id, at, kind: 'valorant', rounds,
      game: { ...(base.game || {}), map: spec.map, agent: spec.agent, result: spec.result, score: spec.score, mode: spec.mode },
      grade: { ...(base.grade || {}), score: spec.grade, provisional: false },
    };
    saved.push({ id, at, game: 'valorant', review });
    onDisk[id] = kept;
  });
  return { saved, onDisk };
}

/** Main's model of the library, as MOMENTS_GET answers it (index.js getMoments). */
function model(opts) {
  const { saved, onDisk } = library(opts);
  return moments.build('valorant', saved, {
    patterns: patterns.summarise(saved),
    clips: (id) => onDisk[id] || [],
    url: (id, name) => `occlara-clip://review/${id}/${name}`,
    frames: () => null,
    recordingMode: 'auto',
  });
}

/**
 * Stand in posters: main makes each from the clip itself (clip-posters.js),
 * 480 wide; here, with no clip to read, a 480 wide crop of the map's own
 * splash, a different part of it for each clip, through Electron's
 * nativeImage. Never shipped; only the pictures see them.
 */
function withPosters(m, nativeImage) {
  if (!nativeImage || !m || !Array.isArray(m.matches)) return m;
  let n = 0;
  for (const match of m.matches) {
    const rel = mapArtOf(match.map);
    if (!rel) continue;
    const img = nativeImage.createFromPath(path.join(ROOT, 'assets', rel));
    if (img.isEmpty()) continue;
    const { width, height } = img.getSize();
    for (const x of match.moments) {
      if (!x.clip) continue;
      const w = Math.round(width * 0.62);
      const h = Math.round((w * 9) / 16);
      const left = Math.round(((n * 0.23) % 1) * (width - w));
      const top = Math.round(((n * 0.37) % 1) * Math.max(0, height - h));
      const crop = img.crop({ x: left, y: top, width: w, height: Math.min(h, height) }).resize({ width: 480 });
      x.clip.poster = `data:image/jpeg;base64,${crop.toJPEG(78).toString('base64')}`;
      n += 1;
    }
  }
  return m;
}

/** STORAGE_GET's answer (index.js storage): 'some', or 'low' with the drive nearly full. */
function storage(kind) {
  const clips = { bytes: Math.round(2.34 * GB), count: 14, matches: 5 };
  const recordings = { bytes: Math.round(1.12 * GB), count: 1 };
  const frames = { bytes: 386 * MB, review: 122 * MB, log: 264 * MB };
  const other = { bytes: 47 * MB };
  return {
    clips, recordings, frames, other,
    total: clips.bytes + recordings.bytes + frames.bytes + other.bytes,
    free: { bytes: kind === 'low' ? Math.round(5.6 * GB) : Math.round(212.4 * GB), drive: 'C:' },
    capGB: 10, clearable: { clips: true }, recordNeeds: 8 * GB,
  };
}

module.exports = { MATCHES, library, model, withPosters, storage };

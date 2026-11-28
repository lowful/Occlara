'use strict';

/**
 * THE MOMENTS PAGE'S DATA (8.7): the player's deaths and highlights, compiled
 * from the saved reviews, newest match first.
 *
 * It took the Breakdown tab's place. A table of win rates by map said little a
 * player could act on between matches; what they asked to see is the moments
 * themselves: every death with what the coach saw there and the clip of it
 * where one was kept, and every round Riot's record proves was a highlight.
 *
 * NOTHING HERE IS WRITTEN BY A MODEL. A death's title is the look's cause from
 * its closed list (death-causes.js), or Riot's own facts (the killer's agent
 * and the gun), and a highlight is counted off Riot's verified round record:
 * two or more kills in a round (2K to 5K, five is an ace), a clutch Riot says was won,
 * and the first kill of the round in two or more rounds running. Nothing is
 * claimed from the screen alone: a round Riot never verified has no highlight.
 *
 * A REPEATED MISTAKE IS MARKED ON ITS DEATHS. Each review's counted mistakes
 * carry their rounds (insights.js), and the patterns across matches carry the
 * same keys (patterns.js), so a death in one of those rounds is marked with the
 * mistake's title, and the COMPILATION at the top groups every such death by
 * the pattern it belongs to, "Deaths nobody traded, 20 deaths over 4
 * matches", with the clips kept of them to play back to back.
 *
 * CLIPS ARE ONLY WHERE THE COACH LOOKED. A clip is cut at a look (clips.js),
 * so a death with no look has none and says nothing about it; a death whose
 * look named a clip that is gone says why, once the review was told
 * (clipsCleared), else that it is gone. And the page's one note says why no
 * clip at all was kept, when none was: recording Off, the cap, or Clear clips.
 * A HIGHLIGHT WITH KILLS HAS ITS OWN CLIP (8.17, clips.js HIGHLIGHTS), cut
 * with the deaths' off Riot's kill times, the dead time between its kills
 * left out and the cuts marked; a highlight whose kills could not be timed
 * has none and says nothing about one, and the reel plays every one kept.
 *
 * Pure: the library hands in the saved reviews, the patterns and what is on
 * disk, so scripts/test-moments.js runs it on the real fixture.
 */

const { causeTitle } = require('./death-causes');
// A title a key no longer goes by, in today's words (9.1).
const { todaysTitle } = require('./mistake-titles');
const { cardSatOut } = require('./sat-out');
const { deathClip, CLIP_RE } = require('./clips');
// How many matches the page reads: THE PATTERNS' OWN WINDOW, one and the same
// (re-exported below, and main reads it through here), so the compilation
// and its `across` marks count over exactly the matches the Patterns page does.
const { LOOK_BACK, WINDOW } = require('./patterns');
// The icon of what killed the player, a file the bundled index names (kit-icons.js).
const { killIcon } = require('./kit-icons');

// A highlight needs this many kills in one round (2K, 3K, 4K or 5K); five is an ace.
const MULTI_KILLS = 2;
const ACE_KILLS = 5;
// The first kill of the round in this many rounds running is a streak.
const STREAK = 2;

const plural = (n, one, many) => `${n} ${n === 1 ? one : (many || `${one}s`)}`;

/** "round 4", "rounds 2 and 9", "rounds 2, 5 and 9". */
function roundsText(ns) {
  if (!ns.length) return '';
  if (ns.length === 1) return `round ${ns[0]}`;
  return `rounds ${ns.slice(0, -1).join(', ')} and ${ns[ns.length - 1]}`;
}

/** "12 s in", "1:42 in". */
function secText(sec) {
  if (typeof sec !== 'number' || !Number.isFinite(sec) || sec < 0) return null;
  const s = Math.round(sec);
  if (s < 60) return `${s} s in`;
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')} in`;
}

/** Whether a clip name is on disk, by what the library handed in. */
function onDisk(have, name) {
  if (!name || !CLIP_RE.test(name)) return false;
  if (have instanceof Set) return have.has(name);
  return Array.isArray(have) && have.includes(name);
}

/**
 * A death's clip as the page plays it: { url, name, death, frames } while the
 * clip is on disk (the death its place in the clip in ms, the frames main's
 * read of the file for the player's frame step, or null for either), else a
 * reason it is gone, or null where none was ever cut.
 */
function clipOf(name, death, have, review, io, id) {
  if (!name || !CLIP_RE.test(name)) return { clip: null, clipGone: null };
  if (onDisk(have, name)) {
    let frames = null;
    try { frames = io.frames(id, name) || null; } catch { frames = null; }
    return {
      clip: { url: io.url(id, name), name, death: typeof death === 'number' && Number.isFinite(death) ? death : null, frames },
      clipGone: null,
    };
  }
  const why = review.clipsCleared && review.clipsCleared.reason === 'space' ? 'space'
    : review.clipsCleared ? 'cleared' : 'gone';
  return { clip: null, clipGone: why };
}

/** The player's own kills in a round, in seconds from its start, off Riot's kill feed. */
function killSecs(riot) {
  const feed = riot && Array.isArray(riot.feed) ? riot.feed : [];
  return feed.filter((k) => k && k.by === 'me' && typeof k.ms === 'number' && Number.isFinite(k.ms))
    .map((k) => Math.round(k.ms / 1000)).sort((a, b) => a - b);
}

/** The counted mistakes of one review whose rounds hold round `n`: [{ key, title }]. */
function mistakesAt(review, n) {
  const ins = review.source === 'riot' ? null : review.insights;
  const list = ins && Array.isArray(ins.mistakes) ? ins.mistakes : [];
  return list.filter((e) => e && e.key && Array.isArray(e.rounds) && e.rounds.includes(n))
    .map((e) => ({ key: e.key, title: todaysTitle(e.key, e.title) }));
}

/**
 * "an Operator", "a Vandal": a gun that starts with a vowel takes "an", the
 * rule valorant-review.js withArticle keeps for the round card (moments.js
 * does not require it). The title said "with a Operator" before.
 */
const withArticle = (w) => `${/^[aeiou]/i.test(String(w)) ? 'an' : 'a'} ${w}`;

/** A Valorant review's deaths, one entry per round the player died in. */
function valorantDeaths(saved, have, io, patternKeys) {
  const { id, review } = saved;
  const out = [];
  for (const c of Array.isArray(review.rounds) ? review.rounds : []) {
    if (!c || !c.died || !Number.isInteger(c.n)) continue;
    // A death in a round Riot says the player sat out (8.8, sat-out.js) is
    // no moment to learn from: it was listed as "first to die, nobody traded
    // it", or under the look's cause, like any other.
    if (cardSatOut(c)) continue;
    const f = c.forensics && c.forensics.cause ? c.forensics : null;
    const riot = c.riot || null;
    const cause = f ? f.cause : null;
    const spoke = f && cause !== 'unclear';
    // The title: the look's cause, else Riot's facts, else the screen's.
    let title;
    if (spoke) title = causeTitle(cause, 1);
    else if (riot && riot.killer) title = `Killed by ${riot.killer}${riot.weapon ? ` with ${withArticle(riot.weapon)}` : ''}`;
    else title = 'Died';
    // One plain line: what the look saw, else where and when.
    const where = [];
    // Riot's place where the card holds it (8.7.10, one place for a death).
    const at = (riot && typeof riot.place === 'string' && riot.place) || c.spot;
    if (at) where.push(`at ${at}`);
    if (riot && riot.firstDeath) where.push('first to die');
    if (riot && riot.traded === false) where.push('nobody traded it');
    if (riot && riot.afterPlant) where.push('after the plant');
    const line = spoke && f.what ? f.what : (where.length ? where.join(', ') : null);
    const repeats = mistakesAt(review, c.n).map((m) => ({ ...m, across: patternKeys.has(m.key) }));
    const name = f ? (f.clip || null) : null;
    const { clip, clipGone } = clipOf(name, f ? f.clipDeath : null, have, review, io, id);
    out.push({
      kind: 'death', id, round: c.n, key: `${id}:r${c.n}`,
      title, line, cause, lookAt: f && typeof f.at === 'number' ? f.at : null,
      sec: riot && typeof riot.sec === 'number' ? riot.sec : null,
      time: riot ? secText(riot.sec) : null,
      lost: c.result === 'lost',
      repeats, clip, clipGone, clipGoneText: clipGone ? GONE[clipGone] : null,
      // Riot's gun, or the killer's ability, as its bundled icon beside the
      // title ({ kind, file, label }), or null: never a path from free text.
      killIcon: riot && riot.weapon ? killIcon(riot.weapon, riot.killer) : null,
    });
  }
  return out;
}

/**
 * A highlight's clip (8.17) as the page plays it: clipOf's, with where each
 * kill and each cut falls in it (ms on the clip's own timeline) and how much
 * each cut skipped, for its player's marks. Null where none was cut: a round
 * with no drop to time its kills by, recording off, a review saved before.
 */
function highlightClipOf(card, have, review, io, id) {
  const h = card && card.highlight && typeof card.highlight === 'object' ? card.highlight : null;
  if (!h || typeof h.clip !== 'string' || h.clip[0] !== 'h') return { clip: null, clipGone: null };
  const got = clipOf(h.clip, null, have, review, io, id);
  if (!got.clip) return got;
  const ms = (x) => typeof x === 'number' && Number.isFinite(x) && x >= 0;
  return {
    clip: {
      ...got.clip,
      kills: (Array.isArray(h.kills) ? h.kills : []).filter(ms),
      cuts: (Array.isArray(h.cuts) ? h.cuts : []).filter((c) => c && ms(c.at) && ms(c.skipped)).map((c) => ({ at: c.at, skipped: c.skipped })),
    },
    clipGone: null,
  };
}

/** A Valorant review's highlights, off its Riot verified rounds alone. */
function valorantHighlights(saved, have, io) {
  const { id, review } = saved;
  const playIo = io || { url: (i, name) => `${i}/${name}`, frames: () => null };
  const cards = (Array.isArray(review.rounds) ? review.rounds : []).filter((c) => c && Number.isInteger(c.n) && c.riot);
  const out = [];
  for (const c of cards) {
    const r = c.riot;
    const kills = typeof r.kills === 'number' ? r.kills : 0;
    const clutch = r.clutch && typeof r.clutch.vs === 'number' && r.clutch.won === true ? r.clutch : null;
    if (kills < MULTI_KILLS && !clutch) continue;
    const parts = [];
    let title;
    if (kills >= MULTI_KILLS) title = `${kills}K`;
    else title = `Clutch, alone against ${clutch.vs === 1 ? 'one' : clutch.vs}`;
    if (kills >= ACE_KILLS) parts.push('an ace, all five of them');
    else if (kills >= MULTI_KILLS) parts.push(`${kills} kills in the round`);
    if (clutch && kills >= MULTI_KILLS) parts.push(`won it alone against ${clutch.vs === 1 ? 'one' : clutch.vs}`);
    if (r.firstKill) parts.push('first kill of the round');
    const secs = killSecs(r);
    if (secs.length) parts.push(`kills at ${secs.map((s) => `${s} s`).join(', ')}`);
    const { clip, clipGone } = highlightClipOf(c, have, review, playIo, id);
    out.push({
      kind: 'highlight', id, round: c.n, key: `${id}:h${c.n}`,
      title, line: parts.length ? parts.join(', ') : null,
      what: kills >= ACE_KILLS ? 'ace' : kills >= MULTI_KILLS ? 'multi' : 'clutch',
      // 9.1: how many a clutch was won against, for the best clip's weight (bestOf).
      vs: clutch ? clutch.vs : null,
      kills, sec: secs.length ? secs[0] : null, time: secs.length ? secText(secs[0]) : null,
      won: c.result === 'won',
      clip, clipGone, clipGoneText: clipGone ? GONE[clipGone] : null, repeats: [],
    });
  }
  // The first kill of the round, two or more rounds running: one entry on the
  // streak's first round.
  const openers = cards.filter((c) => c.riot.firstKill).map((c) => c.n).sort((a, b) => a - b);
  let run = [];
  const streaks = [];
  for (const n of openers) {
    if (run.length && n === run[run.length - 1] + 1) run.push(n);
    else { if (run.length >= STREAK) streaks.push(run); run = [n]; }
  }
  if (run.length >= STREAK) streaks.push(run);
  for (const s of streaks) {
    out.push({
      kind: 'highlight', id, round: s[0], key: `${id}:s${s[0]}`,
      title: `First kill ${s.length} rounds running`, line: `Opened ${roundsText(s)}.`,
      what: 'streak', kills: null, sec: null, time: null, rounds: s.slice(),
      won: null, clip: null, clipGone: null, repeats: [],
    });
  }
  return out;
}

/** A League review's deaths, from its death list (lol-review.js). */
function lolDeaths(saved, have, io) {
  const { id, review } = saved;
  const out = [];
  for (const d of Array.isArray(review.deathList) ? review.deathList : []) {
    if (!d || !Number.isInteger(d.n)) continue;
    const name = typeof d.clip === 'string' ? d.clip : (have && onDisk(have, deathClip(d.n)) ? deathClip(d.n) : null);
    const { clip, clipGone } = clipOf(name, d.clipDeath, have, review, io, id);
    out.push({
      kind: 'death', id, round: d.n, key: `${id}:d${d.n}`,
      title: `Death ${d.n}`, line: d.fact || null, cause: null, lookAt: null,
      sec: typeof d.atSec === 'number' ? d.atSec : null, time: d.at ? `at ${d.at}` : null,
      lost: null, repeats: [], clip, clipGone, clipGoneText: clipGone ? GONE[clipGone] : null,
    });
  }
  return out;
}

/** The ruled line over a match's moments. */
function matchOf(saved) {
  const r = saved.review || {};
  const g = r.game || {};
  const grade = r.grade && typeof r.grade.score === 'number'
    ? { score: r.grade.score, letter: r.grade.letter, provisional: !!r.grade.provisional } : null;
  return {
    id: saved.id, at: saved.at, game: saved.game || r.kind || null,
    title: g.agent || g.champion || null, map: g.map || null, mode: g.mode || null,
    result: g.result || null, score: g.score || null, grade,
    source: r.source || null, verified: !!r.verified,
  };
}

/**
 * @param game      'valorant' | 'lol'
 * @param saved     whole saved reviews ({ id, at, game, review }), newest first
 * @param opts.patterns      patterns.js summarise(saved), for the keys across matches
 * @param opts.clips         (id) => the clip names on disk beside that review
 * @param opts.url           (id, name) => the URL the page plays a clip by
 * @param opts.frames        (id, name) => the clip's frames ({ times, end }, review-clips.js frameTimes), or none
 * @param opts.recordingMode 'auto' | 'off', for the page's note on no clips
 */
function build(game, saved, opts) {
  const o = opts || {};
  const io = {
    url: typeof o.url === 'function' ? o.url : (id, name) => `${id}/${name}`,
    frames: typeof o.frames === 'function' ? o.frames : () => null,
  };
  const clipsOf = typeof o.clips === 'function' ? o.clips : () => [];
  const patterns = o.patterns || {};
  const patternList = Array.isArray(patterns.mistakes) ? patterns.mistakes : [];
  const patternKeys = new Set(patternList.map((p) => p.key));
  const all = (Array.isArray(saved) ? saved : []).filter((s) => s && s.review && s.id).slice(0, LOOK_BACK);

  const matches = [];
  let deaths = 0;
  let highlights = 0;
  let clips = 0;
  let gone = null;
  let looked = 0;
  const lit = [];
  for (const s of all) {
    const have = new Set((clipsOf(s.id) || []).map((c) => (typeof c === 'string' ? c : c && c.name)).filter(Boolean));
    const isLol = (s.game || s.review.kind) === 'lol';
    const d = isLol ? lolDeaths(s, have, io) : valorantDeaths(s, have, io, patternKeys);
    const h = isLol ? [] : valorantHighlights(s, have, io);
    const moments = [...d, ...h].sort((a, b) => a.round - b.round || (a.kind === 'highlight' ? -1 : 1));
    deaths += d.length;
    highlights += h.length;
    for (const m of d) {
      if (m.clip) clips += 1;
      if (m.clipGone && m.clipGone !== 'gone') gone = gone || m.clipGone;
      if (m.cause) looked += 1;
    }
    for (const m of h) {
      if (m.clip) { clips += 1; lit.push(m.key); }
      if (m.clipGone && m.clipGone !== 'gone') gone = gone || m.clipGone;
    }
    matches.push({ ...matchOf(s), moments });
  }

  // THE HIGHLIGHTS REEL (8.17): every highlight clip kept, newest match first,
  // played back to back as the compilation plays a pattern's deaths. Beside
  // the compilation, never in it: that one counts repeated mistakes.
  const reel = lit.length ? {
    key: 'highlights', title: 'Your highlights', clips: lit.length,
    line: `${plural(lit.length, 'highlight clip')} kept`, items: lit.slice(),
  } : null;

  // THE COMPILATION: every death in a round a pattern across matches counts,
  // grouped by the pattern, most deaths first, over THE PATTERN'S OWN WINDOW,
  // the last WINDOW recorded matches (patterns.js summarise): with 14 saved it
  // said "280 deaths over 14 matches" beside a pattern of 10 of 10.
  const windowIds = new Set(all.filter((s) => s.review.source !== 'riot').slice(0, WINDOW).map((s) => s.id));
  const compilation = [];
  for (const p of patternList) {
    const items = [];
    const seen = new Set();
    for (const m of matches) {
      if (!windowIds.has(m.id)) continue;
      for (const x of m.moments) {
        if (x.kind !== 'death' || !x.repeats.some((r) => r.key === p.key)) continue;
        items.push(x);
        seen.add(m.id);
      }
    }
    if (!items.length) continue;
    const withClips = items.filter((x) => x.clip);
    compilation.push({
      key: p.key, title: p.title, fix: p.fix || null, judged: !!p.judged,
      deaths: items.length, matches: seen.size, clips: withClips.length,
      line: `${plural(items.length, 'death')} over ${plural(seen.size, 'match', 'matches')}`
        + (withClips.length ? `, ${plural(withClips.length, 'clip')} kept` : ''),
      items: items.map((x) => x.key),
    });
  }
  compilation.sort((a, b) => b.deaths - a.deaths || b.clips - a.clips);

  // The one note on clips, said once: why none at all was kept.
  let clipsNote = null;
  if (!clips && matches.length) {
    if (o.recordingMode === 'off') clipsNote = 'off';
    else if (gone) clipsNote = gone;
    else if (!looked) clipsNote = 'nolook';
  }

  return {
    game, matches, compilation, reel,
    best: bestOf(matches, compilation),
    counts: { matches: matches.length, deaths, highlights, clips },
    clipsNote, clipsNoteText: clipsNote ? NOTES[clipsNote] : null,
    enough: !!patterns.enough,
  };
}

/**
 * How much a kept highlight is worth as the page's hero: an ace 50, a 4K 40,
 * a 3K 30, a 2K 20, a clutch won 15 more and 5 a head it was won against (a
 * one against two with a 2K is 45, a 1v1 with one kill 20), the first kill
 * of the round 2 more. 0 for a death.
 */
function weightOf(x) {
  if (!x || x.kind !== 'highlight') return 0;
  const kills = typeof x.kills === 'number' ? x.kills : 0;
  const vs = typeof x.vs === 'number' && x.vs > 0 ? x.vs : 0;
  return kills * 10 + (vs ? 15 + vs * 5 : 0) + (/first kill of the round/.test(x.line || '') ? 2 : 0);
}

/**
 * THE BEST RECENT CLIP (9.1, the owner's item 13: "one hero: the player's
 * best recent clip, large, not three cards of different sizes"). Only a clip
 * kept and on disk, from the newest RECENT matches (the patterns' WINDOW):
 *   - the kept highlight worth the most (weightOf), the newer of two alike;
 *   - else the newest kept death of the most repeated mistake across matches
 *     (the compilation's first that has one), "worth another look";
 *   - else the newest kept death.
 * { key, kind, label, line }: the moment's key, and the words over it, main's
 * like every sentence on the page. Null with no clip kept in those matches.
 */
const RECENT = WINDOW;
function bestOf(matches, compilation) {
  const recent = (Array.isArray(matches) ? matches : []).slice(0, RECENT);
  const kept = [];
  recent.forEach((m, mi) => (m.moments || []).forEach((x) => { if (x && x.clip) kept.push({ x, mi }); }));
  if (!kept.length) return null;
  const n = recent.length;
  const lastN = n === 1 ? 'your last match' : `your last ${n} matches`;
  const lit = kept.filter((k) => k.x.kind === 'highlight').sort((a, b) => weightOf(b.x) - weightOf(a.x) || a.mi - b.mi || a.x.round - b.x.round);
  if (lit.length) {
    const x = lit[0].x;
    return { key: x.key, kind: 'highlight', label: 'Your best recent clip', line: `The best highlight kept from ${lastN}.` };
  }
  const deaths = kept.filter((k) => k.x.kind === 'death');
  for (const c of Array.isArray(compilation) ? compilation : []) {
    const hit = deaths.find((k) => (k.x.repeats || []).some((r) => r.key === c.key && r.across));
    if (hit) return { key: hit.x.key, kind: 'death', label: 'Worth another look', line: `${c.title}, one of your repeated mistakes.` };
  }
  const x = deaths[0].x;
  return { key: x.key, kind: 'death', label: 'Your latest clip', line: `No highlight clip was kept from ${lastN}.` };
}

/** The sentence the page says for a clips note, and for a clip that is gone: written here, so the page counts and words nothing. */
const NOTES = Object.freeze({
  off: 'No clips were kept: recording was off. Turn it on in Settings and the coach keeps a clip of each death it looks at.',
  space: 'The clips of these matches were cleared to keep your clips under the space set in Settings.',
  cleared: 'The clips of these matches were cleared in Settings.',
  nolook: 'No clips yet: a clip is kept of each death the coach looks at once Riot\'s record of the match is in.',
});
const GONE = Object.freeze({
  space: 'Clip cleared for space',
  cleared: 'Clip cleared',
  gone: 'Clip gone',
});

// mistakesAt and clipOf are the Practice page's join too (8.11, practice.js
// clipFor): its own clip of a mistake is found exactly as the compilation finds it.
module.exports = { build, valorantDeaths, valorantHighlights, highlightClipOf, lolDeaths, mistakesAt, clipOf, secText, roundsText, bestOf, weightOf, NOTES, GONE, MULTI_KILLS, ACE_KILLS, STREAK, LOOK_BACK, RECENT };

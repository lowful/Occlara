'use strict';

/**
 * Reading the AI decision log: list the kept sessions, open one of them.
 *
 * Split out from the writer so it can be tested without Electron, because the
 * two rules that matter here are both invisible when they break:
 *
 *   - the picker must NOT carry frames. A session holds 2 to 12MB of JPEG,
 *     which base64 inflates by a third again, so listing five sessions eagerly
 *     would push 30MB+ through a single IPC call to fill a dropdown. Metadata
 *     comes from log.json alone, at roughly 50 to 100KB a session.
 *   - the session id arrives from a renderer, so it is matched against the
 *     folder listing rather than joined onto a path.
 *
 * And two that matter since 8.2. Every read is STRICT about its session: the
 * one named and no other, and { gone: true } once the log no longer keeps it,
 * never the newest session in its place, because the newest folder is the one
 * being written. Which session a read serves is decided before anything is
 * read, and the seal mid match is decided on THAT session, never on the id the
 * viewer asked for (served, serve, askAbout). And when a review's eye opens the
 * log on its own match, that read is stricter still: only that match's frames.
 *
 * Every function takes the root explicitly and keeps no state, so a test can
 * point it at a fixture directory.
 */
const fs = require('fs');
const path = require('path');
const timeline = require('./ai-log-timeline');

/*
 * HOW LONG A FINISHED MATCH'S FRAMES ARE HELD AT MOST for its review, against
 * the thinning (index.js holdAiLogFrames). A hold is let go when the review is
 * done with them, and this is only for a release that never comes. It has to
 * outlast the longest link a review runs, a match stopped halfway, with Riot's
 * rounds tried after it and then the look at its deaths (match-link.js), and
 * test:valorantreview holds it to that.
 */
const HOLD_MAX_MS = 60 * 60 * 1000;

/** Session folders that actually have an index, newest first. */
function dirs(root) {
  if (!root || !fs.existsSync(root)) return [];
  return fs.readdirSync(root)
    .filter((f) => /^session-/.test(f) && fs.existsSync(path.join(root, f, 'log.json')))
    .map((f) => ({ f, t: fs.statSync(path.join(root, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t)
    .map((d) => d.f);
}

/** Recover the start time from a folder name, since the stamp is an ISO string
 *  with its colons and dot swapped for dashes to be a legal path. Only needed
 *  when a session holds no records to read a timestamp from. */
function startedAt(id) {
  const m = /^session-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/.exec(String(id));
  return m ? Date.parse(`${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z`) || 0 : 0;
}

function records(root, id) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, id, 'log.json'), 'utf8')).records || [];
  } catch { return []; }
}

/** Metadata for every kept session, and NO frames. This is the picker's list. */
function sessions(root, liveId) {
  try {
    return dirs(root).map((id) => {
      const recs = records(root, id);
      const first = recs[0] || {};
      const last = recs[recs.length - 1] || {};
      return {
        id,
        at: first.at || startedAt(id),
        frames: recs.length,
        // DEATHS THAT HAPPENED, not deaths the coach talked about. This used
        // to count `shown.death` flags, so a session with six real deaths and
        // one review was labelled "2 deaths" in the picker while the log's own
        // header said six. Same number, two meanings, one of them wrong.
        deaths: timeline.deaths(recs).length,
        deathsReviewed: recs.filter((r) => r.shown && r.shown.death).length,
        // CONFIRMED maps, not the raw reads. Listing what the model said would
        // label all five real sessions on this machine with two or three maps
        // each, when every one of them was a single map from start to finish.
        maps: timeline.mapsPlayed(recs),
        mins: first.at && last.at ? Math.max(1, Math.round((last.at - first.at) / 60000)) : 0,
        live: !!liveId && id === liveId,
      };
    });
  } catch { return []; }
}

/** Each record's frame inlined as a data URI, or null where its file is gone. */
function inline(dir, recs) {
  for (const r of recs) {
    try {
      r.frameData = 'data:image/jpeg;base64,' + fs.readFileSync(path.join(dir, r.frame)).toString('base64');
    } catch { r.frameData = null; }
  }
  return recs;
}

/** What the viewer is handed beside the records, worked out from those records alone. */
function timelineOf(recs) {
  return {
    // Where the map actually changed, so the scrubber can mark it. Computed
    // once here rather than in the renderer, because it needs the callout
    // fingerprint from the engine and a renderer has no Node access.
    segments: timeline.segments(recs).map((s) => ({
      from: s.from, to: s.to, map: s.map, confirmed: s.confirmed,
      byModel: s.byModel, byLabel: s.byLabel, labels: s.labels,
    })),
    // Every death, not just the ones the coach spoke about. The two differ by
    // design, since the engine caps review tips and then goes quiet, so the
    // marks used to stop at the coaching and leave real deaths unfindable.
    deaths: timeline.deaths(recs),
    deathCheck: timeline.deathSanity(recs),
  };
}

/**
 * One session with its frames inlined as data URIs, so the viewer needs no file
 * access: the newest when no id is given, and the one named when one is.
 *
 * A NAME THE LOG NO LONGER KEEPS IS { gone: true } (8.2), never the newest in
 * its place. That fallback was for a session pruned while its window was open,
 * and a prune runs at every Start, after which the newest folder is the session
 * being written. So an old match's log left open over a Start served the match
 * in progress, past a seal that only knew the live session's own id.
 *
 * With a `scope` it is one match of that session instead, strictly (readMatch).
 */
function read(root, id, liveId, scope) {
  if (scope) return readMatch(root, id, scope);
  return serve(root, id, liveId, false);
}

/** One kept session, its frames inlined, and no list. `id` is a name from dirs(). */
function readOne(root, id) {
  const recs = inline(path.join(root, id), records(root, id));
  return { session: id, records: recs, ...timelineOf(recs) };
}

/**
 * WHICH SESSION A READ OF THE LOG SERVES (8.2), worked out from the kept
 * folders before anything is read, so that the seal is decided on the session
 * served and never on the id asked for:
 *
 *   - a session named: that one and no other, and 'gone' once the log no
 *     longer keeps it;
 *   - none named: the newest, for a viewer that opens on whatever is latest;
 *   - while a match is in progress (`sealed`), the session being written is
 *     'sealed', however it was reached.
 *
 * @param kept  the kept session folders, newest first, as dirs() lists them
 * @returns { id }, with id null when nothing is kept, or
 *          { id: null, refused: 'gone' | 'sealed' }
 */
function served(kept, id, liveId, sealed) {
  const list = Array.isArray(kept) ? kept : [];
  const asked = id ? String(id) : null;
  if (asked !== null && !list.includes(asked)) return { id: null, refused: 'gone' };
  const sid = asked !== null ? asked : (list[0] || null);
  if (sealed && sid !== null && sid === liveId) return { id: null, refused: 'sealed' };
  return { id: sid };
}

/**
 * A WHOLE SESSION AS A VIEWER IS SERVED IT (8.2), for the one served() names.
 *
 * While a match is in progress (`sealed`) the session being written is closed.
 * Asked for, by name or as the newest, the viewer is served the newest finished
 * session in its place, marked sealed, as the log has always opened mid match.
 * And it is in no list handed back mid match, whatever was asked for, since
 * its map, its length and its count of deaths are the match being played. A
 * name the log no longer keeps is { gone: true }, mid match or not, with the
 * list beside it for a picker to choose again from.
 */
function serve(root, id, liveId, sealed) {
  try {
    const pick = served(dirs(root), id, liveId, sealed);
    const all = sessions(root, liveId);
    const listed = sealed ? all.filter((s) => !s.live) : all;
    if (pick.refused === 'gone') return { gone: true, session: null, records: [], sessions: listed };
    if (sealed && (pick.refused === 'sealed' || !id)) {
      const past = listed[0] ? listed[0].id : null;
      return past ? { ...readOne(root, past), sessions: listed, sealed: true } : { records: [], sessions: listed, sealed: true };
    }
    if (!pick.id) return { records: [], sessions: listed };
    return { ...readOne(root, pick.id), sessions: listed };
  } catch (e) {
    return { records: [], sessions: [], error: e.message };
  }
}

/**
 * THE FRAMES A QUESTION ABOUT ONE OF THEM IS ANSWERED FROM (8.2): the ones the
 * viewer has on screen, which is one match of a session when a review's eye
 * opened it (readMatch) and that whole session otherwise, and only ever the
 * session it named. Refused 'gone' when the log no longer keeps it, and then
 * 'sealed' when it is the session being written while a match is in progress.
 * Nothing stands in for either: the question carries an index into the frames
 * on screen, and another session's frame at that index would be answered
 * about with nothing to say it was another picture.
 *
 * @returns { records }, or { records: [], refused: 'gone' | 'sealed' }
 */
function askAbout(root, session, scope, liveId, sealed) {
  try {
    if (!session) return { records: [], refused: 'gone' };
    const pick = served(dirs(root), session, liveId, sealed);
    if (pick.refused) return { records: [], refused: pick.refused };
    const log = scope && typeof scope === 'object' ? readMatch(root, pick.id, scope) : readOne(root, pick.id);
    return { records: Array.isArray(log.records) ? log.records : [] };
  } catch (e) {
    return { records: [], error: e.message };
  }
}

/** A scope as the viewer may be handed one: three finite numbers, or null. */
function matchScope(scope) {
  const s = scope && typeof scope === 'object' ? scope : {};
  const n = (v) => typeof v === 'number' && Number.isFinite(v);
  return n(s.match) && n(s.from) && n(s.to) ? { match: s.match, from: s.from, to: s.to } : null;
}

/**
 * Whether a record is one match's: captured once the match began, and either
 * carrying its stamp (the moment the engine began that match, on every record
 * since 8.0) or captured before it ended. The stamp alone gets two kinds of
 * frame wrong. The one read as a match ends is logged after the engine has
 * begun the next, under the next one's stamp, and belongs to the match it
 * shows. And a match the engine ended too early and then resumed has the
 * frames read in between under the stamp of the match it thought had begun.
 */
function inMatch(r, s) {
  if (!r || typeof r !== 'object' || typeof r.at !== 'number' || r.at < s.from) return false;
  return r.match === s.match || r.at <= s.to;
}

/**
 * ONE MATCH OF ONE SESSION, for the eye on its review (8.2), and stricter than
 * a whole session's read: only that match's frames, and { gone: true } once
 * the session or those frames are no longer kept. Never the newest session in
 * their place, which would show another match under this one's name.
 *
 * @param scope { match, from, to }: the match's stamp and its window, in ms
 */
function readMatch(root, id, scope) {
  const gone = { gone: true, session: null, records: [], sessions: [] };
  try {
    const sid = String(id || '');
    const s = matchScope(scope);
    if (!s || !dirs(root).includes(sid)) return gone;
    const recs = inline(path.join(root, sid), records(root, sid).filter((r) => inMatch(r, s)));
    if (!recs.some((r) => r.frameData)) return gone;
    return { session: sid, scoped: true, sessions: [], records: recs, ...timelineOf(recs) };
  } catch (e) {
    return { ...gone, error: e.message };
  }
}

/**
 * Where one match's frames are, as its review keeps them (8.2): the session
 * folder, the match's stamp and its window, the scope readMatch() is handed
 * back. Null when the log was off and there is no folder.
 */
function placeOf(dir, startedAt, endedAt) {
  const n = (v) => typeof v === 'number' && Number.isFinite(v);
  if (!dir || !n(startedAt) || !n(endedAt)) return null;
  return { session: path.basename(String(dir)), match: startedAt, from: startedAt, to: endedAt };
}

/**
 * The matches one session holds, from its index alone with no frame read: one
 * span per stamp, { match, first, last, frames }, oldest first. `id` is a name
 * from dirs(), never one a renderer sent.
 */
function matchesIn(root, id) {
  const by = new Map();
  for (const r of records(root, String(id || ''))) {
    if (!r || typeof r.match !== 'number' || typeof r.at !== 'number') continue;
    const s = by.get(r.match) || { match: r.match, first: r.at, last: r.at, frames: 0 };
    s.first = Math.min(s.first, r.at);
    s.last = Math.max(s.last, r.at);
    s.frames++;
    by.set(r.match, s);
  }
  return [...by.values()].sort((a, b) => a.match - b.match);
}

// A match's last logged frame comes this long before the end its review keeps,
// at most. The end is decided on the menus after it (most of a minute of them
// at worst) or on twenty seconds of reads at the final score, so five minutes
// is generous on purpose: what it rules out is a session with nothing near the
// end at all.
const END_GAP_MS = 5 * 60 * 1000;
// The frames of a match are all captured before its end is decided. A little
// past it is allowed anyway, for a clock that ticked between the two reads.
const END_SLACK_MS = 2000;

/**
 * Where a review saved before 8.2, which kept no place in the log, still has
 * its frames: { session, match, from, to }, or null.
 *
 * Every record since 8.0 carries its match's stamp, and a review's `at` is the
 * moment its match ended. So the match is the newest stamped before that end
 * whose last frame came within END_GAP_MS of it. A session with nothing that
 * close holds another match, however near in time, and is never offered in
 * its place.
 *
 * @param sessions  [{ id, spans }]: kept sessions and the matchesIn() of each
 * @param end       when the review's match ended
 */
function locate(sessions, end) {
  if (typeof end !== 'number' || !Number.isFinite(end)) return null;
  let best = null;
  for (const s of Array.isArray(sessions) ? sessions : []) {
    for (const span of (s && s.spans) || []) {
      if (!(span.match < end) || span.last > end + END_SLACK_MS || end - span.last > END_GAP_MS) continue;
      if (!best || span.match > best.match) best = { session: s.id, match: span.match, from: span.match, to: end };
    }
  }
  return best;
}

/**
 * Which frames of the log are one review's: its scope { session, match, from,
 * to } while a kept session holds them, false once none does, and null where
 * there never was a log to keep: a match graded from Riot's record alone, one
 * recorded with the AI log off, and every game but Valorant, whose reader is
 * the only one that writes the log.
 *
 * Since 8.2 a review carries its scope (`aiLog`, null when the log was off), so
 * its session only has to be kept. Null is no eye at all (log-eye.js), never
 * the disabled one whose tooltip says the log was pruned: with the log off
 * nothing was written to prune, and the review looked at no frame. One saved
 * before carries no field at all and is found by when its match ended
 * (locate), among the finished sessions alone: the session being written holds
 * no review without the field.
 *
 * @param entry     { valorant, source, at, aiLog } of a review or its library row
 * @param kept      the kept session folders, as dirs() lists them, or a function
 *                  giving them, only called for a review that can have a log
 * @param finished  () => [{ id, spans }], only read for a review saved before 8.2
 */
function scopeFor(entry, kept, finished) {
  const e = entry || {};
  if (!e.valorant || e.source === 'riot') return null;
  if (e.aiLog !== undefined) {
    const s = e.aiLog;
    if (s === null) return null;   // recorded with the log off
    const folders = (typeof kept === 'function' ? kept() : kept) || [];
    return s && typeof s.session === 'string' && folders.includes(s.session) ? s : false;
  }
  return locate(typeof finished === 'function' ? finished() : finished, e.at) || false;
}

/**
 * Keep only the most recent session folders.
 *
 * Deliberately NOT built on dirs(), which skips folders with no log.json. A
 * session that is started and closed before a single frame is captured leaves
 * exactly such a folder, and a prune that cannot see them never removes them, so
 * they pile up forever in a directory whose whole point is to stay bounded.
 * Empty ones go first, then the oldest of the rest.
 *
 * `live` is the session being recorded right now, and it MUST be excluded.
 * A live session has no log.json until its first frame lands, so without this
 * it matches the empty rule exactly. Between 3.3.0 and 3.9.0 the caller created
 * the folder and pruned on the next line, which deleted the session it had just
 * started; every frame after that wrote into a path that no longer existed and
 * the error was swallowed by the "a dropped frame is not worth interrupting
 * coaching" catch. Two weeks of decision logs went missing in silence, and the
 * only symptom was the log window showing nothing newer than the release.
 */
function prune(root, keep, live) {
  try {
    if (!root || !fs.existsSync(root)) return;
    const all = fs.readdirSync(root)
      .filter((f) => /^session-/.test(f))
      .filter((f) => f !== live)
      .map((f) => ({ f, t: fs.statSync(path.join(root, f)).mtimeMs, has: fs.existsSync(path.join(root, f, 'log.json')) }));
    const empty = all.filter((d) => !d.has);
    const real = all.filter((d) => d.has).sort((a, b) => b.t - a.t);
    // The live session counts against the budget even though it is not a
    // candidate for removal, or starting one always keeps keep+1 on disk.
    const room = live ? Math.max(0, keep - 1) : keep;
    for (const d of [...empty, ...real.slice(room)]) {
      fs.rmSync(path.join(root, d.f), { recursive: true, force: true });
    }
  } catch {}
}

module.exports = { dirs, sessions, read, served, serve, askAbout, prune, startedAt, placeOf, matchesIn, locate, scopeFor, END_GAP_MS, HOLD_MAX_MS };

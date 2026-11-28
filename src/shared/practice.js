'use strict';

/**
 * PRACTICE: a plan from the player's own repeated mistakes, the drills for
 * them, and whether it is working. Pure: no Electron, no disk, so
 * test:practice drives every rule here directly; main
 * (src/main/services/practice-store.js) reads the store, the library and the
 * drill library and hands them in.
 *
 * THE PLAN IS THE PATTERNS' OWN LIST. Its mistakes are patterns.summarise()'s
 * (the Patterns page's read: the last ten recorded matches, a pattern needs
 * two), never counted again here: the two most serious that the drill
 * library has drills for, each with how often it repeated, "In 4 of your
 * last 6 recorded matches", and up to three drills for that cause and the
 * player's rank band (rank-band.js).
 *
 * IT DOES NOT CHURN. A mistake stays the focus while it is still a repeated
 * mistake, whatever the order of the list below it; a focus is replaced only
 * once its mistake has left the patterns' list, and a drill only once the
 * player has finished it (marked it practiced FINISH times), by the next one
 * for that cause. Which mistakes were the focus and since when is stored
 * (`practice` in the store, schema SCHEMA), so a restart keeps it.
 *
 * IS IT WORKING, honestly: for each focus, how many of the last WINDOW
 * recorded matches since the plan was made carried the mistake against the
 * WINDOW before them, as counts ("Down from 5 of 5 to 2 of 5"), never a
 * percentage or a claim beyond them, and under ENOUGH matches since the plan
 * how many there are and how many more it needs ("1 match since the plan
 * began, 2 more to tell if it is shrinking"). A match that could not have counted a Riot
 * only key (progress.js couldCount) is left out of both windows.
 *
 * EVERYTHING HERE IS LOCAL. The plan, the log and the streak live in the
 * store on this PC; nothing is sent anywhere. No economy content: a drill
 * that talks about credits or buys is dropped from the library as it is read.
 *
 * SHOWN, NOT ONLY TOLD (8.11): each mistake carries the player's own newest
 * kept clip of it (clipFor, the Moments page's join), and a drill may carry a
 * demo hosted on the website (demoOf, only under DEMO_BASE). The page fetches
 * the demo from there; nothing of the player's goes anywhere.
 *
 * THREE GROUPS (9.1, the owner's ask): the page shows its drills under
 * Mechanics, Game sense and Awareness (GROUPS), only the important ones: the
 * plan's own drills, each in its group with the repeated mistake it is there
 * for (`reason`); a group the plan leaves empty takes one drill for the next
 * repeated mistake of its kind, else one drill for every player, and the
 * Trainer always sits under Mechanics (`trainer`). A drill names its group
 * in the library (`group`), else its cause decides (GROUP_OF_CAUSE).
 */

const { countable } = require('./insights');
const { cardSatOut } = require('./sat-out');
const { causeTitle } = require('./death-causes');
const { couldCount } = require('./progress');
const { validBand } = require('./rank-band');
// The player's own clip of a mistake is the Moments page's join (8.11):
// the rounds a review counted the mistake in, and the clip kept of the death
// there while it is on disk.
const { mistakesAt, clipOf } = require('./moments');
// Where in a clip the Clips page takes its poster: one rule for every page (clips.js).
const { posterAt } = require('./clips');

const SCHEMA = 1;
const FOCUS_N = 2;      // mistakes in the plan
const DRILLS_N = 2;     // drills under each (9.1: two, only the important ones)
const GROUP_MAX = 4;    // drills shown in one group
const FINISH = 3;       // marks that finish a drill
const WINDOW = 5;       // matches in each half of "Is it working?"
const ENOUGH = 3;       // matches since the plan before it says anything
const LOG_MAX = 400;    // entries kept in the log
const GENERAL = 'general';

const WHERE = { range: 'Practice Range', deathmatch: 'Deathmatch', tdm: 'Team Deathmatch', custom: 'Custom game', unrated: 'Unrated match' };

/*
 * THE THREE GROUPS (9.1). Mechanics is the fight itself (aim, the stop, the
 * spray, the peek's technique), Game sense the choice of fight and what comes
 * after it, Awareness where the team and the enemy are. The words are the
 * page's: its eyebrow (`name`) and its title.
 */
const GROUPS = [
  { id: 'mechanics', name: 'Mechanics', title: 'Win the fights you take' },
  { id: 'sense', name: 'Game sense', title: 'Pick the right fight' },
  { id: 'awareness', name: 'Awareness', title: 'Know where everyone is' },
];
const GROUP_IDS = new Set(GROUPS.map((g) => g.id));
// A drill that names no group (a library of another shape, the tests'
// sample) takes its cause's: the one most of that cause's drills are in.
const GROUP_OF_CAUSE = {
  'lost-duel': 'mechanics', 'low-headshots': 'mechanics',
  isolated: 'awareness', untraded: 'awareness', crossfire: 'awareness', rotating: 'awareness',
};
// The Trainer under Mechanics: its scenarios offered when no drill there names one.
const TRAINER_PICKS = ['flick-grid', 'micro-flicks', 'counter-strafe'];
const BAND_LABEL = {
  iron_bronze: 'Iron and Bronze', silver_gold: 'Silver and Gold',
  plat_diamond: 'Platinum and Diamond', asc_plus: 'Ascendant and up',
};

// Copy from the library keeps the house rule: no em or en dash. Built from
// char codes, so the characters never sit in this file.
const DASHES = new RegExp('\\s*[' + String.fromCharCode(0x2013, 0x2014) + ']\\s*', 'g');
// The economy is out of scope (match-to-review.md): a drill about it is dropped.
const ECONOMY = /\b(econom\w*|credits?|eco rounds?|force buy\w*|force-buy\w*|buy rounds?|save rounds?|full buy)\b/i;

const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
const clean = (s, max) => (typeof s === 'string' ? s.replace(DASHES, ', ').replace(/\s+/g, ' ').trim().slice(0, max || 400) : '');
const listOf = (x) => (Array.isArray(x) ? x : typeof x === 'string' ? [x] : []);
/** A mistake's key as the library names it: 'cause:repeek' and 'repeek' are one cause. */
const causeKey = (k) => String(k || '').trim().toLowerCase().replace(/^cause:/, '');

// ── The drill library ──────────────────────────────────────────────────────

/*
 * A DRILL'S DEMO (8.11): an optional short video of the drill being done,
 * `demo: { src, poster, secs }`, recorded by the owner and hosted on the
 * website (scripts/make-drill-demo.js makes it, docs/drill-demo-guide.md says
 * how). Kept only when both URLs are https under DEMO_BASE, with no query,
 * fragment, login or port, and a video or picture file's own extension, so the
 * library can never point the page anywhere else; anything less and the drill
 * reads as having no demo. The page's CSP allows that one origin for media
 * and pictures, and nothing else from the web.
 */
const DEMO_BASE = 'https://occlara.app/drills/';
const DEMO_PATH = /^\/drills\/[a-z0-9][a-z0-9_-]{0,63}(?:\/[a-z0-9][a-z0-9_-]{0,63})*\.([a-z0-9]{3,4})$/;
const DEMO_VIDEO = new Set(['webm', 'mp4']);
const DEMO_PICTURE = new Set(['webp', 'jpg', 'jpeg', 'png']);

/** One demo URL as given, when it is a file of that kind under DEMO_BASE, else null. */
function demoUrl(raw, kinds) {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  if (!s.startsWith(DEMO_BASE) || s.length > 300) return null;
  let u;
  try { u = new URL(s); } catch { return null; }
  if (u.href !== s || u.protocol !== 'https:' || u.hostname !== 'occlara.app' || u.port || u.username || u.password || u.search || u.hash) return null;
  const m = DEMO_PATH.exec(u.pathname);
  return m && kinds.has(m[1]) ? u.href : null;
}

/** A drill's demo, or null: both URLs good, and its seconds when they are a sensible length. */
function demoOf(raw) {
  if (!isObj(raw)) return null;
  const src = demoUrl(raw.src, DEMO_VIDEO);
  const poster = demoUrl(raw.poster, DEMO_PICTURE);
  if (!src || !poster) return null;
  const n = Number(raw.secs);
  return { src, poster, secs: Number.isFinite(n) && n >= 1 && n <= 30 ? Math.round(n) : null };
}

function whereOf(raw) {
  const s = String(raw || '').toLowerCase();
  if (!s) return null;
  if (/range/.test(s)) return WHERE.range;
  if (/team\s*death|tdm/.test(s)) return WHERE.tdm;
  if (/death\s*match|^dm$/.test(s)) return WHERE.deathmatch;
  if (/custom/.test(s)) return WHERE.custom;
  if (/unrated|swiftplay|match/.test(s)) return WHERE.unrated;
  return null;
}

/*
 * A DRILL'S TRAINER SCENARIO (docs/claude/trainer.md): an optional
 * `trainer: "<scenario id>"` on a drill a scenario of the Trainer page truly
 * trains (the aim and pre-aim drills). Kept only when it is a plain id that
 * trainer-scenarios.json names, else null, so a typo never shows a Train this
 * that opens nothing. The page is handed the id and the scenario's name as
 * the Trainer itself writes it ("Site retake, Hard").
 */
const TRAINER_ID = /^[a-z0-9-]{1,48}$/;
const TRAINER_SCENARIOS = (() => {
  try {
    const raw = require('./trainer-scenarios.json');
    return new Map((Array.isArray(raw && raw.scenarios) ? raw.scenarios : [])
      .filter((s) => isObj(s) && typeof s.id === 'string' && TRAINER_ID.test(s.id) && typeof s.title === 'string' && s.title)
      .map((s) => [s.id, clean(s.level ? `${s.title}, ${s.level === 'hard' ? 'Hard' : 'Easy'}` : s.title, 90)]));
  } catch { return new Map(); }
})();

/** A drill's Trainer scenario id, or null. */
function trainerOf(raw) {
  return typeof raw === 'string' && TRAINER_ID.test(raw) && TRAINER_SCENARIOS.has(raw) ? raw : null;
}

/**
 * A drill's group (9.1): the one the library names, else a drill the Trainer
 * trains is Mechanics, else its cause's group, else Game sense.
 */
function groupOf(raw, causes, trainer) {
  const g = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (GROUP_IDS.has(g)) return g;
  if (trainer) return 'mechanics';
  for (const c of causes || []) if (GROUP_OF_CAUSE[c]) return GROUP_OF_CAUSE[c];
  return 'sense';
}

/** One drill as the page shows it, or null when it lacks what a drill needs. */
function normDrill(d) {
  if (!isObj(d)) return null;
  const id = typeof d.id === 'string' && /^[a-z0-9][a-z0-9_-]{0,63}$/i.test(d.id.trim()) ? d.id.trim() : null;
  const title = clean(d.title || d.name, 90);
  const steps = listOf(d.steps).map((s) => clean(s, 240)).filter(Boolean).slice(0, 6);
  // Its cause, and the further mistakes it serves (`also`, Nov 2026: the aim
  // drills serve low-headshots too).
  const causes = [...new Set([...listOf(d.causes || d.cause || d.keys || d.mistakes), ...listOf(d.also)].map(causeKey).filter(Boolean))];
  if (!id || !title || !steps.length || !causes.length) return null;
  const goal = clean(d.goal || d.target, 240) || null;
  const check = clean(d.check || d.howYouKnow || d.how || d.verify || d.nextReview, 240) || null;
  const why = clean(d.why, 240) || null;
  if (ECONOMY.test([title, goal, check, why, ...steps].join(' '))) return null;
  const m = Number(d.minutes != null ? d.minutes : d.duration != null ? d.duration : d.mins);
  const trainer = trainerOf(d.trainer);
  return {
    id, title, causes, steps, goal, check, why,
    bands: [...new Set(listOf(d.bands || d.band || d.ranks).map(validBand).filter(Boolean))],
    where: whereOf(d.where || d.mode || d.place),
    minutes: Number.isFinite(m) && m >= 1 && m <= 90 ? Math.round(m) : null,
    demo: demoOf(d.demo),
    trainer,
    group: groupOf(d.group, causes, trainer),
    // 9.1: a drill that starts from a review ("Play the review's one fix")
    // says so, and is not offered before there is one.
    needs: d.needs === 'review' ? 'review' : null,
  };
}

/**
 * The library, read whatever shape it came in: an array of drills or
 * { version, drills }. Null when nothing in it is a drill (missing, malformed).
 */
function normaliseLibrary(raw) {
  const arr = Array.isArray(raw) ? raw : isObj(raw) && Array.isArray(raw.drills) ? raw.drills : null;
  if (!arr) return null;
  const seen = new Set();
  const drills = [];
  for (const d of arr) {
    const n = normDrill(d);
    if (!n || seen.has(n.id)) continue;
    seen.add(n.id);
    drills.push(n);
  }
  return drills.length ? { drills } : null;
}

// ── The stored state ───────────────────────────────────────────────────────

function emptyState() { return { v: SCHEMA, plans: {}, log: [] }; }

function normFocus(f) {
  if (!isObj(f) || typeof f.key !== 'string' || !f.key) return null;
  return {
    key: f.key.slice(0, 80),
    title: clean(f.title, 120) || f.key,
    since: Number.isFinite(f.since) ? f.since : 0,
    drills: (Array.isArray(f.drills) ? f.drills : []).filter((x) => typeof x === 'string' && x).slice(0, DRILLS_N),
  };
}

function normEntry(e) {
  if (!isObj(e) || typeof e.id !== 'string' || !e.id || typeof e.drill !== 'string' || !e.drill || !Number.isFinite(e.at)) return null;
  return {
    id: e.id.slice(0, 40), drill: e.drill.slice(0, 64), at: e.at,
    title: clean(e.title, 90) || e.drill,
    minutes: Number.isFinite(e.minutes) && e.minutes > 0 ? Math.round(e.minutes) : null,
    cause: typeof e.cause === 'string' && e.cause ? e.cause.slice(0, 80) : null,
  };
}

/**
 * The `practice` key as stored, made safe: anything missing, malformed or of
 * a schema this build does not know is read as nothing saved yet.
 */
function normaliseState(raw) {
  if (!isObj(raw) || (raw.v !== undefined && raw.v !== SCHEMA)) return emptyState();
  const out = emptyState();
  if (isObj(raw.plans)) {
    for (const [game, p] of Object.entries(raw.plans)) {
      if (!/^[a-z]{2,16}$/.test(game) || !isObj(p)) continue;
      const focus = listOf(p.focus).map(normFocus).filter(Boolean).slice(0, FOCUS_N);
      if (focus.length) out.plans[game] = { madeAt: Number.isFinite(p.madeAt) ? p.madeAt : 0, focus };
    }
  }
  const ids = new Set();
  out.log = listOf(raw.log).map(normEntry).filter((e) => e && !ids.has(e.id) && ids.add(e.id))
    .sort((a, b) => b.at - a.at).slice(0, LOG_MAX);
  return out;
}

// ── Days ───────────────────────────────────────────────────────────────────

/** A day on this PC's clock, 'YYYY-MM-DD'. */
function dayKey(at) {
  const d = new Date(at);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
const timesDone = (log, id) => log.filter((e) => e.drill === id).length;
const doneToday = (log, id, now) => log.some((e) => e.drill === id && dayKey(e.at) === dayKey(now));
const practicedToday = (log, now) => log.some((e) => dayKey(e.at) === dayKey(now));

/**
 * Days practiced in a row, ending today or, before today's first mark,
 * yesterday; and the minutes of every entry in the log.
 */
function streakOf(log, now) {
  const days = new Set(log.map((e) => dayKey(e.at)));
  const minutes = log.reduce((n, e) => n + (e.minutes || 0), 0);
  const day = 24 * 3600 * 1000;
  // Back a day at a time from noon, so a change of clock never skips one.
  const noon = new Date(now); noon.setHours(12, 0, 0, 0);
  let at = noon.getTime();
  if (!days.has(dayKey(at))) at -= day;
  let run = 0;
  while (days.has(dayKey(at))) { run++; at -= day; }
  let line;
  if (!log.length) line = 'Nothing practiced yet.';
  else if (run >= 2) line = `Practiced ${run} days in a row, ${minutes} minutes in all.`;
  else line = `${minutes} minutes practiced in all.`;
  return { days: run, minutes, entries: log.length, line };
}

// ── Choosing drills ────────────────────────────────────────────────────────

/** The drills for one cause that fit the band, the band's own first, unfinished before finished. */
function drillsFor(library, cause, band, log) {
  const key = causeKey(cause);
  const pool = ((library && library.drills) || []).filter((d) => d.causes.includes(key));
  const b = validBand(band);
  const fits = b ? pool.filter((d) => !d.bands.length || d.bands.includes(b)) : pool;
  const list = fits.length ? fits : pool;
  const rank = (d) => (b && d.bands.includes(b) ? 0 : !d.bands.length ? 1 : 2) + (timesDone(log || [], d.id) >= FINISH ? 10 : 0);
  return list.map((d, i) => ({ d, i })).sort((x, y) => rank(x.d) - rank(y.d) || x.i - y.i).map((x) => x.d);
}

const hasDrills = (library, key) => drillsFor(library, key, null, []).length > 0;

/** A focus's drills: the ones it had while unfinished, then the next for its cause. */
function fillDrills(library, key, band, log, had) {
  const all = drillsFor(library, key, band, log);
  const byId = new Map(all.map((d) => [d.id, d]));
  const kept = (had || []).filter((id) => byId.has(id) && timesDone(log, id) < FINISH);
  const next = all.filter((d) => !kept.includes(d.id) && timesDone(log, d.id) < FINISH).map((d) => d.id);
  let ids = [...kept, ...next].slice(0, DRILLS_N);
  // Every drill for it finished: the plan keeps them rather than going empty.
  if (!ids.length) ids = all.slice(0, DRILLS_N).map((d) => d.id);
  return ids;
}

/**
 * The plan for this game, kept or refreshed. Returns { state, changed }:
 * the state with the plan in it, and whether anything stored moved.
 *
 * @param o.patterns  patterns.summarise() of the game's saved reviews
 * @param o.library   normaliseLibrary(), or null
 * @param o.band      the rank band, or null
 * @param o.state     normaliseState()
 * @param o.now       ms
 * @param o.game      the plan's game ('valorant')
 */
function choosePlan(o) {
  const state = o.state || emptyState();
  const game = o.game || 'valorant';
  const library = o.library;
  if (!library) return { state, changed: false };
  const p = o.patterns || {};
  const mistakes = p.enough && Array.isArray(p.mistakes) ? p.mistakes.filter((m) => m && typeof m.key === 'string') : [];
  const candidates = mistakes.filter((m) => hasDrills(library, m.key));
  const prev = state.plans[game] || null;
  const focus = [];
  // A focus stays while its mistake still repeats: never reordered by the list below it.
  for (const f of (prev ? prev.focus : [])) {
    const m = candidates.find((c) => c.key === f.key);
    if (m && focus.length < FOCUS_N) focus.push({ ...f, title: clean(m.title, 120) || f.title });
  }
  for (const m of candidates) {
    if (focus.length >= FOCUS_N) break;
    if (!focus.some((f) => f.key === m.key)) focus.push({ key: m.key, title: clean(m.title, 120) || m.key, since: o.now, drills: [] });
  }
  for (const f of focus) f.drills = fillDrills(library, f.key, o.band, state.log, f.drills);
  const keys = (pl) => (pl ? pl.focus.map((f) => f.key).join('|') : '');
  const plan = focus.length
    ? { madeAt: prev && keys(prev) === focus.map((f) => f.key).join('|') ? prev.madeAt : o.now, focus }
    : null;
  const changed = JSON.stringify(prev || null) !== JSON.stringify(plan);
  if (!changed) return { state, changed: false };
  const plans = { ...state.plans };
  if (plan) plans[game] = plan; else delete plans[game];
  return { state: { ...state, plans }, changed: true };
}

// ── Is it working? ─────────────────────────────────────────────────────────

/** Whether one saved review carried the mistake, rounds the player sat out left out (patterns.js does the same). */
function carries(review, key) {
  const e = countable(review).mistakes.find((x) => x && x.key === key);
  if (!e) return false;
  const rounds = Array.isArray(e.rounds) ? e.rounds : [];
  if (!rounds.length) return true;
  const out = new Set(((review && review.rounds) || []).filter((c) => c && Number.isInteger(c.n) && cardSatOut(c)).map((c) => c.n));
  return rounds.some((n) => !out.has(n));
}

const recordedOf = (saved) => (Array.isArray(saved) ? saved : [])
  .filter((s) => s && s.review && s.review.source !== 'riot' && Number.isFinite(s.at) && (s.game === 'valorant' || s.review.kind === 'valorant'))
  .sort((a, b) => b.at - a.at);

/**
 * The trend of one focus: the last WINDOW recorded matches since the plan
 * against the WINDOW before them, as counts.
 * @returns {{ enough, text, over, tone: 'good'|'bad'|'even', trend: 'down'|'up'|'same'|null, recent, before }}
 */
function progressOf(saved, key, since) {
  const all = recordedOf(saved).filter((s) => couldCount(s.review, key));
  const after = all.filter((s) => s.at >= (since || 0));
  // Too few matches SINCE THE PLAN BEGAN, said in the row itself (9.1, the
  // final critic): beside "In 4 of your last 4 recorded matches" a bare "Not
  // enough matches yet" read as a contradiction, its real meaning only in the
  // tooltip. The row says which matches it waits for and how many more.
  if (after.length < ENOUGH) {
    const n = after.length;
    const more = ENOUGH - n;
    return {
      enough: false, tone: 'even', trend: null, recent: null, before: null,
      text: n === 0 ? `No match since the plan began, ${ENOUGH} to tell if it is shrinking`
        : `${n === 1 ? '1 match' : `${n} matches`} since the plan began, ${more} more to tell if it is shrinking`,
      over: `Whether it is shrinking is read from the matches you play after the plan began, once there are ${ENOUGH}`,
    };
  }
  const recent = all.slice(0, Math.min(WINDOW, after.length));
  const before = all.slice(recent.length, recent.length + WINDOW);
  const a = recent.filter((s) => carries(s.review, key)).length;
  const A = recent.length;
  const out = { enough: true, recent: { n: a, of: A } };
  // Every recorded match is since the plan: the count beside it already says
  // how often, so this says only that there is nothing to compare with yet,
  // quiet, and keeps the count for its title.
  if (!before.length) {
    return { ...out, before: null, tone: 'wait', trend: null,
      over: `In ${a} of your ${A} matches since the plan, with none before it to compare`, text: 'Nothing earlier to compare yet' };
  }
  const b = before.filter((s) => carries(s.review, key)).length;
  const B = before.length;
  const over = `Your last ${A} matches against the ${B} before`;
  const base = { ...out, before: { n: b, of: B }, over };
  // Compared as shares, written as the counts themselves.
  if (a * B < b * A) return { ...base, tone: 'good', trend: 'down', text: `Down from ${b} of ${B} to ${a} of ${A}` };
  if (a * B > b * A) return { ...base, tone: 'bad', trend: 'up', text: `Up from ${b} of ${B} to ${a} of ${A}` };
  return { ...base, tone: 'even', trend: 'same', text: A === B ? `Same, ${a} of ${A} both times` : `Same rate, ${a} of ${A} against ${b} of ${B}` };
}

// ── The player's own clip of it ────────────────────────────────────────────

/** The frame a clip shows until it plays: the look's frame nearest the death from before it, else its first (review.js posterOf). */
function posterName(f) {
  const names = Array.isArray(f.frames) ? f.frames.filter((n) => typeof n === 'string' && n) : [];
  const at = Array.isArray(f.frameAt) && f.frameAt.length === names.length ? f.frameAt : null;
  if (!names.length) return null;
  if (at) {
    let best = null;
    names.forEach((n, i) => { if (typeof at[i] === 'number' && at[i] < 0) best = n; });
    if (best) return best;
  }
  return names[0];
}

/**
 * THE PLAYER'S OWN CLIP OF A MISTAKE (8.11), shown beside its drills: the
 * newest kept clip of a death in a round the mistake was counted in. The
 * Moments page's own join (moments.js mistakesAt for the rounds, clipOf for
 * what is still on disk): the newest recorded match first and, inside it, its
 * latest round; a clip named on a card but gone from disk is passed over for
 * the next one, and with none kept there is none. A round the player sat out
 * is no moment to learn from, as on Moments. Every URL is main's (io.url),
 * never a path a page handed in.
 *
 * @param saved   the saved reviews, any order ({ id, at, game, review })
 * @param key     the mistake's key, as the patterns and insights name it
 * @param io.clips   (id) => the clip names on disk beside that review
 * @param io.url     (id, name) => the URL the page plays it by
 * @param io.frames  (id, name) => its frames ({ times, end }), or none
 * @param io.poster  (id, frameName) => a picture URL of that frame, or none
 * @param io.clipPoster  (id, clipName, atSec) => the Clips page's poster of
 *                   that clip as a data URL, or none while it is made (asked
 *                   for at atSec, clips.js posterAt); optional
 * @returns {{ url, name, death, frames, round, map, at, id, poster, posterOf, title, line, label } | null}
 *          posterOf: 'frame' (the coach's), 'clip' (the Clips poster) or null (none yet, the page shows the map's art)
 */
function clipFor(saved, key, io) {
  const o = io || {};
  if (typeof key !== 'string' || !key || typeof o.clips !== 'function' || typeof o.url !== 'function') return null;
  const moIo = { url: o.url, frames: typeof o.frames === 'function' ? o.frames : () => null };
  for (const s of recordedOf(saved)) {
    if (!s.id) continue;
    const review = s.review;
    const cards = (Array.isArray(review.rounds) ? review.rounds : [])
      .filter((c) => c && c.died && Number.isInteger(c.n) && !cardSatOut(c)
        && c.forensics && typeof c.forensics.clip === 'string' && c.forensics.clip
        && mistakesAt(review, c.n).some((m) => m.key === key))
      .sort((a, b) => b.n - a.n);
    if (!cards.length) continue;
    // Asked of the disk only for a review that has a candidate.
    let have;
    try { have = new Set((o.clips(s.id) || []).map((c) => (typeof c === 'string' ? c : c && c.name)).filter(Boolean)); } catch { have = new Set(); }
    for (const c of cards) {
      const f = c.forensics;
      const { clip } = clipOf(f.clip, f.clipDeath, have, review, moIo, s.id);
      if (!clip) continue;
      const g = review.game || {};
      const map = typeof g.map === 'string' && g.map ? clean(g.map, 40) : null;
      // ITS PICTURE (9.1, the review's own chain, review.js clipPicture): the
      // coach's frame, else the poster the Clips page makes of the clip
      // (main's clipPosters, asked for once where none is made yet), else
      // none, and the page shows the map's art dimmed with a label. Never an
      // empty box.
      let poster = null;
      let posterOf = null;
      const pn = posterName(f);
      if (pn && typeof o.poster === 'function') {
        try { poster = o.poster(s.id, pn) || null; } catch { poster = null; }
        if (poster) posterOf = 'frame';
      }
      if (!poster && typeof o.clipPoster === 'function') {
        try { poster = o.clipPoster(s.id, clip.name, posterAt({ death: clip.death })) || null; } catch { poster = null; }
        if (poster) posterOf = 'clip';
      }
      return {
        url: clip.url, name: clip.name, death: clip.death, frames: clip.frames,
        round: c.n, map, at: s.at, id: s.id, poster, posterOf,
        title: 'Your newest clip of this mistake',
        line: map ? `Round ${c.n} on ${map}` : `Round ${c.n}`,
        label: `The clip of round ${c.n}`,
      };
    }
  }
  return null;
}

// ── What the page shows ────────────────────────────────────────────────────

function drillView(d, log, now) {
  const done = timesDone(log, d.id);
  return {
    id: d.id, title: d.title, where: d.where, minutes: d.minutes, steps: d.steps, goal: d.goal, check: d.check, why: d.why,
    demo: d.demo || null,
    // Train this (docs/claude/trainer.md): the scenario and its name, or none.
    trainer: d.trainer || null,
    trainerTitle: d.trainer ? TRAINER_SCENARIOS.get(d.trainer) || null : null,
    group: d.group || groupOf(null, d.causes, d.trainer),
    done, finish: FINISH, finished: done >= FINISH, today: doneToday(log, d.id, now),
    doneLine: done >= FINISH ? `Done ${done} times, finished` : done ? `Done ${done} of ${FINISH} times` : null,
  };
}

/** A cause's title for a key the patterns do not list (the review's link to a mistake that is not in the plan). */
function titleOfKey(key, given) {
  const t = clean(given, 120);
  if (t) return t;
  const c = String(key || '').startsWith('cause:') ? causeTitle(String(key).slice(6), 2) : null;
  return c || null;
}

/**
 * Today's practice for Home, or null: only with a plan, only before the
 * first mark of the day, the first unfinished drill of the first focus.
 */
function todayOf(state, library, now, game) {
  const plan = state && state.plans && state.plans[game || 'valorant'];
  if (!plan || !library || practicedToday(state.log, now)) return null;
  const byId = new Map(library.drills.map((d) => [d.id, d]));
  for (const f of plan.focus) {
    for (const id of f.drills) {
      const d = byId.get(id);
      if (!d || timesDone(state.log, id) >= FINISH) continue;
      return { drill: d.id, cause: f.key, title: d.title, minutes: d.minutes,
        text: d.minutes ? `Today's practice: ${d.title}, ${d.minutes} minutes` : `Today's practice: ${d.title}` };
    }
  }
  return null;
}

/** How often a mistake repeated, in the one phrasing the page uses for it (Your focus and a drill's reason). */
const repeatLine = (m, recorded) => (m && Number.isFinite(m.matches) && m.matches > 0 && recorded > 0
  ? `In ${m.matches} of your last ${recorded} recorded matches` : null);

/**
 * THE THREE GROUPS (9.1): Mechanics, Game sense and Awareness, each with only
 * the important drills, every one with the reason it is there.
 *
 * 1. The plan's drills, the first of each focus before the second, each in
 *    its own group with its mistake as the reason.
 * 2. A group the plan leaves empty: one drill for the next repeated mistake
 *    of that kind beyond the plan, unfinished, with that mistake as the reason.
 * 3. Still empty: drills for every player of that kind at the band (one with
 *    a plan, two without one), the reason saying so.
 * A drill is shown once on the page: the review's own drills above (asked)
 * are left out here. Mechanics carries the Trainer, with the scenarios its
 * drills name first.
 */
function groupsView(o) {
  const { status, focus, asked, mistakes, recorded, library, band, log, now } = o;
  if (!library) return GROUPS.map((g) => ({ ...g, drills: [], trainer: g.id === 'mechanics' ? trainerView([]) : null }));
  const seen = new Set(asked ? asked.drills.map((d) => d.id) : []);
  const items = [];
  for (let i = 0; i < DRILLS_N; i++) {
    for (const f of focus) {
      const d = f.drills[i];
      if (!d || seen.has(d.id)) continue;
      seen.add(d.id);
      const m = mistakes.find((x) => x && x.key === f.key) || null;
      items.push({ ...d, reason: { kind: 'mistake', key: f.key, title: f.title, line: repeatLine(m, recorded) } });
    }
  }
  const plan = status === 'plan';
  return GROUPS.map((g) => {
    const list = items.filter((d) => d.group === g.id).slice(0, GROUP_MAX);
    if (!list.length && plan) {
      for (const m of mistakes) {
        if (!m || typeof m.key !== 'string' || focus.some((f) => f.key === m.key)) continue;
        const d = drillsFor(library, m.key, band, log).find((x) => x.group === g.id && !seen.has(x.id) && timesDone(log, x.id) < FINISH);
        if (!d) continue;
        seen.add(d.id);
        list.push({ ...drillView(d, log, now), reason: { kind: 'mistake', key: m.key, title: clean(m.title, 120) || null, line: repeatLine(m, recorded) } });
        break;
      }
    }
    if (!list.length) {
      // With a plan, the row says why a drill for every player stands among
      // the mistakes' drills. Without one every row is for every player, and
      // the card above says so once, so the rows carry no reason at all.
      const reason = plan ? { kind: 'general', key: GENERAL, title: null, line: 'For every player, as nothing of this kind repeats in your matches' } : null;
      for (const d of drillsFor(library, GENERAL, band, log)) {
        if (list.length >= (plan ? 1 : 2)) break;
        if (d.group !== g.id || seen.has(d.id)) continue;
        // A drill that starts from a review ("Play the review's one fix") waits for the first one.
        if (d.needs === 'review' && status === 'nomatches') continue;
        seen.add(d.id);
        list.push({ ...drillView(d, log, now), reason });
      }
    }
    return { ...g, drills: list, trainer: g.id === 'mechanics' ? trainerView(list) : null };
  });
}

/**
 * The Trainer under Mechanics (9.1): what it is, up to three of its
 * scenarios (the ones the group's drills name first), and why it is there.
 */
function trainerView(list) {
  const ids = [];
  for (const d of list) if (d.trainer && !ids.includes(d.trainer)) ids.push(d.trainer);
  for (const id of TRAINER_PICKS) if (!ids.includes(id) && TRAINER_SCENARIOS.has(id)) ids.push(id);
  const own = list.find((d) => d.reason && d.reason.kind === 'mistake' && d.reason.title);
  return {
    title: 'Aim trainer',
    line: 'Flicks, counter strafes, spray control and site retakes, played right here in the app.',
    scenarios: ids.slice(0, 3).map((id) => ({ id, title: TRAINER_SCENARIOS.get(id) })),
    reason: own ? { ...own.reason } : { kind: 'general', key: GENERAL, title: null, line: 'A few minutes before you queue warms up every player.' },
  };
}

/**
 * The page, whole: every line it shows is written here.
 *
 * @param o.patterns, o.library, o.band, o.state (after choosePlan), o.now
 * @param o.saved     the saved reviews the patterns were made from, newest first
 * @param o.riotId    whether a Riot ID is set in Settings
 * @param o.focus     { key, title } the review asked the page to open on, or null
 * @param o.clipOf    (key) => the player's own clip of that mistake (clipFor), or none
 * @returns { status: 'plan' | 'norepeats' | 'nomatches' | 'nolibrary', ... }
 */
function planView(o) {
  const clipFn = (key) => {
    if (typeof o.clipOf !== 'function') return null;
    try { return o.clipOf(key) || null; } catch { return null; }
  };
  const state = o.state || emptyState();
  const log = state.log;
  const now = o.now;
  const p = o.patterns || {};
  const library = o.library;
  const band = validBand(o.band);
  const recorded = Number.isFinite(p.recorded) ? p.recorded : 0;
  const plan = state.plans.valorant || null;
  const status = !library ? 'nolibrary' : !recorded ? 'nomatches' : plan ? 'plan' : 'norepeats';
  const byId = new Map(((library && library.drills) || []).map((d) => [d.id, d]));
  const mistakes = Array.isArray(p.mistakes) ? p.mistakes : [];
  const focusKey = o.focus && typeof o.focus.key === 'string' ? o.focus.key : null;

  const focus = status === 'plan' ? plan.focus.map((f) => {
    const m = mistakes.find((x) => x && x.key === f.key) || null;
    return {
      key: f.key, title: f.title,
      line: m && Number.isFinite(m.matches) ? `In ${m.matches} of your last ${recorded} recorded matches` : null,
      fix: m && typeof m.fix === 'string' ? clean(m.fix, 300) : null,
      since: f.since,
      focused: f.key === focusKey,
      drills: f.drills.map((id) => byId.get(id)).filter(Boolean).map((d) => drillView(d, log, now)),
      progress: progressOf(o.saved, f.key, f.since),
      clip: clipFn(f.key),
    };
  }) : [];

  // The review's link to a mistake the plan does not hold: its drills, shown, not stored.
  let asked = null;
  if (library && focusKey && !focus.some((f) => f.key === focusKey)) {
    const drills = drillsFor(library, focusKey, band, log).slice(0, DRILLS_N).map((d) => drillView(d, log, now));
    const title = titleOfKey(focusKey, o.focus.title);
    asked = { key: focusKey, title, drills, line: drills.length ? null : 'The drill library has no drills for this mistake yet.', clip: clipFn(focusKey) };
  }

  const general = library && status !== 'plan'
    ? drillsFor(library, GENERAL, band, log).filter((d) => !(d.needs === 'review' && status === 'nomatches'))
      .slice(0, DRILLS_N).map((d) => drillView(d, log, now)) : [];

  const groups = groupsView({ status, focus, asked, mistakes, recorded, library, band, log, now });

  const bandLine = band ? `Drills sized for ${BAND_LABEL[band]}.`
    : o.riotId ? 'No rank on record yet, so these drills fit every level.'
      : 'These drills fit every level until your rank is known.';

  const empty = status === 'nolibrary'
    ? { title: 'No drills in this build', hint: 'The drill library is not available, so there is nothing to practice from here yet. Your log below is kept.' }
    : status === 'nomatches'
      ? { title: 'No matches yet', hint: 'Press Start and play a match. Once two recorded matches show the same mistake, your plan is built from it. Until then, these drills help every player.' }
      : status === 'norepeats'
        ? { title: 'No repeated mistakes yet', hint: mistakes.length
          ? 'None of your repeated mistakes has a drill in the library yet. Until one does, these drills help every player.'
          : 'A mistake needs to show up in two recorded matches before it is a habit to practice. Until then, these drills help every player.' }
        : null;

  // The page's grey sub line under its title, true of what it shows: picked
  // from the player's repeats only when there is a plan; none when there are
  // no drills at all (the empty card says why).
  const sub = status === 'plan' ? 'Drills picked from what keeps repeating in your matches.'
    : status === 'nolibrary' ? null
      : 'Drills for every player, until a mistake repeats in your matches.';

  return {
    status, empty, focus, asked, general, groups, band, bandLine, needsRiotId: !band && !o.riotId,
    sub,
    streak: streakOf(log, now),
    today: todayOf(state, library, now, 'valorant'),
    log: log.map((e) => ({ id: e.id, title: e.title, minutes: e.minutes, at: e.at, day: dayKey(e.at) })),
    privacy: status === 'plan' ? 'Your plan and log are kept on this PC. Nothing on this page is sent anywhere.'
      : 'Your practice log is kept on this PC. Nothing on this page is sent anywhere.',
  };
}

// ── Writing the log ────────────────────────────────────────────────────────

/**
 * A drill marked practiced: one dated entry, once a day a drill. Null when it
 * was already marked today.
 */
function mark(state, drill, now, id, cause) {
  const s = state || emptyState();
  if (!drill || !drill.id || doneToday(s.log, drill.id, now)) return null;
  const entry = { id: id || `p${now.toString(36)}`, drill: drill.id, title: drill.title, minutes: drill.minutes || null, cause: cause || null, at: now };
  return { state: { ...s, log: [entry, ...s.log].slice(0, LOG_MAX) }, entry };
}

/** An entry taken out of the log; the state as it was when there is no such entry. */
function unmark(state, id) {
  const s = state || emptyState();
  const log = s.log.filter((e) => e.id !== id);
  return log.length === s.log.length ? null : { ...s, log };
}

module.exports = {
  SCHEMA, FOCUS_N, DRILLS_N, GROUP_MAX, FINISH, WINDOW, ENOUGH, GENERAL, WHERE, BAND_LABEL, DEMO_BASE, GROUPS,
  normaliseLibrary, normaliseState, emptyState, choosePlan, planView, progressOf, streakOf,
  todayOf, drillsFor, carries, mark, unmark, dayKey, causeKey, clipFor, demoOf, trainerOf, groupOf,
};

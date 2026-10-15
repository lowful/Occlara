'use strict';

/**
 * BENCH A'S SCORE (8.5.0): the label bench's look set read against its key,
 * in plain Node, so test:forensics holds the arithmetic without a model.
 *
 * SCORED ON RAW REPLIES, BEFORE parse(). Variant b's parse enforces the
 * families: a reply that judged a fight right and labelled it a repeek comes
 * out unclear, and parsed it can never show the contradiction the bench is
 * there to count. So each reply is read here as the model wrote it (rawLook:
 * its words as keys, nothing enforced), and the parsed look the server gave
 * is kept beside it.
 *
 * THE KEY (userData/bench/looks/key.json, never the repo) is written before
 * the bench, by people who watch each death: the fight as it was, whether it
 * was a fair duel, and the labels a look may give (acceptable) and must not
 * (forbidden). The bars are bench A's, each the spec's:
 *
 *   forbidden    forbidden labels at most 2 in 80 looks
 *   fair         every fair duel in the key lost-duel in at least 4 of 5 runs
 *   avoidable    the share of looks calling a death avoidable at most the
 *                key's share plus 5 points
 *   unclear      unclear wherever the key says unclear, every run
 *   contradict   raw self contradictions (a cause outside its fight's family,
 *                a right fight changing anything but the aim) in at most 5% of
 *                the looks that spoke (variant b only)
 *   conflicts    the looks that spoke and fell to unclear in parse, at most 10%
 *                (variant b only)
 *   fracture     the Fracture swiftplay's three deaths all inside their
 *                acceptable sets in 4 runs of 5
 *   p90          the five still body's p90 at most 4 s
 */

const df = require('../server/services/death-forensics');

const asKey = (v) => String(v == null ? '' : v).toLowerCase().trim().replace(/\s+/g, '-');
const known = (v, list) => (list.includes(asKey(v)) ? asKey(v) : (asKey(v) && asKey(v) !== 'none' ? 'unknown' : null));
const CAUSE_KEYS = Object.keys(df.CAUSES);
const FIGHT_KEYS = Object.keys(df.FIGHTS);

/**
 * One reply as the model wrote it: { json, fight, cause, alt, change, what, better }, keys only, nothing enforced.
 * `text` is the reply's text, or the label words the server sends a bench in its place (death-forensics.js
 * rawLabels: no sentence of the model's ever leaves the server), read the same way.
 */
function rawLook(text) {
  if (text && typeof text === 'object') {
    if (!text.json) return { json: false, fight: null, cause: null, alt: null, change: null, what: false, better: null };
    return { json: true, fight: known(text.fight, FIGHT_KEYS), cause: known(text.cause, CAUSE_KEYS), alt: known(text.alt, CAUSE_KEYS),
      change: known(text.change, df.CHANGES), what: text.what === true, better: null };
  }
  const j = df.replyJson(text);
  if (!j) return { json: false, fight: null, cause: null, alt: null, change: null, what: false, better: null };
  return {
    json: true,
    fight: known(j.fight, FIGHT_KEYS),
    cause: known(j.cause, CAUSE_KEYS),
    alt: known(j.alt, CAUSE_KEYS),
    change: known(j.change, df.CHANGES),
    what: !!String(j.what || '').trim(),
    better: String(j.better || '').trim() || null,
  };
}

/** Whether a raw look spoke: a label from the list other than unclear. */
const speaks = (raw) => !!raw.cause && raw.cause !== 'unclear' && raw.cause !== 'unknown';

/** A raw look that contradicts itself (variant b): its cause outside its fight's family, or a right fight changing anything but the aim. */
function contradicts(raw) {
  if (!raw.fight || raw.fight === 'unknown' || !speaks(raw)) return false;
  const f = df.FIGHTS[raw.fight];
  if (!f.causes.includes(raw.cause)) return true;
  return raw.fight === 'right' && !!raw.change && !['aim', 'none'].includes(raw.change);
}

/** A raw look parse() turns to unclear for its family (variant b): neither its cause nor its second choice is its fight's. */
function conflicts(raw) {
  if (!speaks(raw)) return false;
  const f = raw.fight && raw.fight !== 'unknown' ? df.FIGHTS[raw.fight] : null;
  return !f || (!f.causes.includes(raw.cause) && !f.causes.includes(raw.alt));
}

const isAvoidable = (cause) => df.AVOIDABLE.has(cause);
/** The key's word on a death, read as a key: avoidable when every acceptable label is. */
function keyOf(k) {
  const acceptable = Array.isArray(k && k.acceptable) ? k.acceptable.map(asKey) : [];
  const forbidden = Array.isArray(k && k.forbidden) ? k.forbidden.map(asKey) : [];
  const unclear = !!(k && k.unclear) || (acceptable.length === 1 && acceptable[0] === 'unclear');
  return { acceptable, forbidden, unclear, fair: !!(k && k.fair), avoidable: !unclear && acceptable.length > 0 && acceptable.every(isAvoidable) };
}

/** A key that can be scored: every death of the set in it, with an acceptable set, and no label both acceptable and forbidden. */
function keyProblems(set, key) {
  const out = [];
  const byKey = new Map(((key && key.deaths) || []).map((k) => [k.key, k]));
  for (const d of (set && set.deaths) || []) {
    const k = byKey.get(d.key);
    if (!k) { out.push(`${d.key}: not in the key`); continue; }
    const v = keyOf(k);
    if (!v.acceptable.length) out.push(`${d.key}: no acceptable label`);
    const both = v.acceptable.filter((c) => v.forbidden.includes(c));
    if (both.length) out.push(`${d.key}: ${both.join(', ')} both acceptable and forbidden`);
    const off = [...v.acceptable, ...v.forbidden].filter((c) => !CAUSE_KEYS.includes(c));
    if (off.length) out.push(`${d.key}: ${off.join(', ')} not a label`);
    if (v.fair && (v.acceptable.length !== 1 || v.acceptable[0] !== 'lost-duel')) out.push(`${d.key}: a fair duel's acceptable label is lost-duel alone`);
  }
  return out;
}

/** The p-th percentile of a list of numbers, nearest rank. */
function percentile(xs, p) {
  const s = xs.filter(Number.isFinite).slice().sort((a, b) => a - b);
  if (!s.length) return null;
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)];
}

/**
 * The bars, on every look the bench took.
 *
 * @param o.set      set.json: { deaths: [{ key, match, body }] }
 * @param o.key      key.json: { deaths: [{ key, fair, unclear, acceptable, forbidden }] }, or null
 * @param o.looks    [{ key, run, raw, parsed, ms }]: raw the model's reply text, parsed the server's look
 * @param o.variant  'a' or 'b'
 * @param o.runs     the runs asked for, 5 for bench A
 */
function score(o) {
  const looks = (o.looks || []).map((l) => ({ ...l, read: rawLook(l.raw) }));
  const runs = o.runs || 5;
  const byKey = new Map(((o.key && o.key.deaths) || []).map((k) => [k.key, keyOf(k)]));
  const deaths = (o.set && o.set.deaths) || [];
  const bars = [];
  const bar = (name, value, limit, pass, note) => bars.push({ name, value, limit, pass: pass === null ? null : !!pass, note: note || '' });
  const spoke = looks.filter((l) => speaks(l.read));
  const keyed = !!o.key;
  const of = (k) => looks.filter((l) => l.key === k);
  const needRuns = Math.ceil(0.8 * runs);

  if (keyed) {
    const forbidden = looks.filter((l) => (byKey.get(l.key) || { forbidden: [] }).forbidden.includes(l.read.cause)).length;
    const allowed = Math.floor((2 * looks.length) / 80);
    bar('forbidden', `${forbidden} in ${looks.length}`, `at most ${allowed}`, forbidden <= allowed);
    const fair = deaths.filter((d) => (byKey.get(d.key) || {}).fair);
    const fairMiss = fair.filter((d) => of(d.key).filter((l) => l.read.cause === 'lost-duel').length < needRuns);
    bar('fair', `${fair.length - fairMiss.length} of ${fair.length} fair duels`, `lost-duel in ${needRuns} of ${runs} runs`, !fairMiss.length,
      fairMiss.map((d) => d.key).join(', '));
    const keyShare = deaths.length ? deaths.filter((d) => (byKey.get(d.key) || {}).avoidable).length / deaths.length : 0;
    const benchShare = looks.length ? looks.filter((l) => isAvoidable(l.read.cause)).length / looks.length : 0;
    bar('avoidable', `${Math.round(benchShare * 100)}%`, `at most ${Math.round(keyShare * 100) + 5}% (the key's ${Math.round(keyShare * 100)}% and 5)`,
      benchShare <= keyShare + 0.05 + 1e-9);
    const unclear = deaths.filter((d) => (byKey.get(d.key) || {}).unclear);
    const spokeAnyway = unclear.filter((d) => of(d.key).some((l) => l.read.cause !== 'unclear'));
    bar('unclear', `${unclear.length - spokeAnyway.length} of ${unclear.length}`, 'unclear every run', !spokeAnyway.length, spokeAnyway.map((d) => d.key).join(', '));
    const fracture = deaths.filter((d) => /^fracture\b/i.test(String(d.match || '')));
    const runIds = [...new Set(looks.map((l) => l.run))];
    const fracRuns = fracture.length ? runIds.filter((r) => fracture.every((d) => {
      const l = looks.find((x) => x.key === d.key && x.run === r);
      return l && (byKey.get(d.key) || { acceptable: [] }).acceptable.includes(l.read.cause);
    })).length : 0;
    bar('fracture', `${fracRuns} of ${runIds.length} runs`, `all three acceptable in ${needRuns} of ${runs}`, fracture.length === 3 && fracRuns >= needRuns,
      fracture.length === 3 ? '' : `${fracture.length} Fracture deaths in the set`);
  }
  if (o.variant === 'b') {
    const contra = spoke.filter((l) => contradicts(l.read)).length;
    bar('contradict', `${contra} of ${spoke.length} that spoke`, 'at most 5%', !spoke.length || contra / spoke.length <= 0.05);
    const conf = spoke.filter((l) => conflicts(l.read)).length;
    bar('conflicts', `${conf} of ${spoke.length} that spoke`, 'at most 10%', !spoke.length || conf / spoke.length <= 0.1);
  }
  const still = looks.filter((l) => (deaths.find((d) => d.key === l.key) || {}).body === 'recording').map((l) => l.ms);
  const p90 = percentile(still, 90);
  bar('p90', p90 === null ? 'none' : `${(p90 / 1000).toFixed(2)} s`, 'at most 4 s on the five still body', p90 === null ? null : p90 <= 4000);
  return {
    bars,
    pass: bars.every((b) => b.pass !== false),
    looks: looks.length,
    spoke: spoke.length,
    perDeath: deaths.map((d) => ({
      key: d.key, match: d.match,
      raw: of(d.key).map((l) => `${l.read.fight ? `${l.read.fight}/` : ''}${l.read.cause || 'none'}${l.read.change ? ` (${l.read.change})` : ''}`),
      parsed: of(d.key).map((l) => (l.parsed && l.parsed.cause) || 'none'),
      answer: byKey.get(d.key) || null,
    })),
  };
}

/**
 * One death of the set as the client sends it (askForensics): its facts, and
 * its frames as base64 with the last before the death and the first after it
 * leading (look-stills.js sendOrder), their seconds beside them.
 *
 * @param d     a set.json death
 * @param read  (relative path) => Buffer
 */
function bodyDeath(d, read) {
  const frames = d.frames.map((f) => read(f).toString('base64'));
  if (!Array.isArray(d.frameAt) || d.frameAt.length !== frames.length) return { ...d.facts, frames };
  const order = require('../src/main/services/look-stills').sendOrder(d.frameAt);
  return { ...d.facts, frames: order.map((i) => frames[i]), frameAt: order.map((i) => d.frameAt[i]), framesFrom: d.framesFrom || 'reads' };
}

// What a look costs, for the budget before the ledger answers: five stills
// and two frames, from the 13 Oct bench's booked costs on Sol.
const LOOK_COST = { recording: 0.0165, reads: 0.008 };
const estimate = (d) => LOOK_COST[d.body] || LOOK_COST.recording;

// BENCH A STOPS AT $3, BOTH PROMPTS TOGETHER (the spec's table: about $2.20,
// stopped at $3). Each prompt is one run of the bench, b and then a, the
// control, so a run stops at half of it unless --budget says otherwise: at $3
// a run, the two could spend $6. A variant of the set's 80 looks is about
// $1.11 (11 deaths on five stills, 5 on two frames, five runs).
const BENCH_A_USD = 3;
const RUN_USD = BENCH_A_USD / 2;

module.exports = { rawLook, speaks, contradicts, conflicts, keyOf, keyProblems, percentile, score, bodyDeath, estimate, LOOK_COST, BENCH_A_USD, RUN_USD };

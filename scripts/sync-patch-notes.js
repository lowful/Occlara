#!/usr/bin/env node
'use strict';

/**
 * Sync the current Valorant patch into Occlara so the coach never advises
 * around a change that already happened (a nerfed ability, a reworked gun).
 *
 * Two authoritative sources, no interpretation in between:
 *   - valorant-api.com/v1/version  -> which patch is actually live
 *   - Riot's own patch notes page  -> the change lines, kept VERBATIM
 *
 * Lines are never summarised or paraphrased here. Riot's wording goes straight
 * to the coach, which is what keeps this trustworthy: a summarising step is a
 * place for facts to get bent, and coaching built on a bent fact is worse than
 * coaching with no patch knowledge at all.
 *
 * THE HISTORY (8.5.0). The file also keeps the last 12 patches, each with its
 * release date and EVERY line of its notes, not only the ones naming an agent,
 * a gun or a map: an economy change ("Loss bonus credits increased") names
 * none, and the old sync dropped it, so nothing could have seen it. The
 * primer's gates read the history (server/services/game-primer.js): a stated
 * fact is withheld when a patch since it was verified, or since a past match
 * was played, has a line tagged with one of its topics (patch-topics.js), and
 * a gun's or an agent's numbers when such a line names it. The top level
 * fields (patch, headline, changes, notesFound) are kept exactly as they were,
 * because patch-context.js reads them.
 *
 * Run:  npm run sync:patch
 *       npm run sync:patch -- --upgrade   offline: converts the file to the new
 *                                         shape from what it already holds
 * Writes server/patch-notes.generated.json (server only; the client never needs it).
 */

const fs = require('fs');
const path = require('path');

const VERSION_URL = 'https://valorant-api.com/v1/version';
const WEAPONS_URL = 'https://valorant-api.com/v1/weapons';
const AGENTS_URL  = 'https://valorant-api.com/v1/agents?isPlayableCharacter=true';
const NOTES_INDEX = 'https://playvalorant.com/en-us/news/game-updates/';
const UA = { 'user-agent': 'Mozilla/5.0 (compatible; Occlara patch sync)' };
const OUT_PATH = path.join(__dirname, '..', 'server', 'patch-notes.generated.json');

// A line has to actually say something to be worth shipping; bare headings
// ("Iso", "Gatecrash") carry no information for the coach.
const MIN_WORDS = 5;
const MAX_LINE  = 240;
const MAX_LINES = 40;
// The history keeps every line of a patch's notes, up to this many; a patch
// with more is marked capped, and the gates then trust none of its silences.
// EVERY line means the short and the long ones too, which the two limits above
// keep out of `changes` only. Riot writes a change as a heading and short
// lines under it, and the heading is what names its topic: 9.10's Regen Shield
// was "Regen Shield" over "Damage Absorption: 25 HP", neither five words, so a
// history with the prompt's filter saw nothing about the shield, and a plant
// time line under a "Spike" heading said nothing of the spike either.
const MAX_HISTORY_LINES = 1000;
const KEEP_PATCHES = 12;

async function getJson(url) {
  const r = await fetch(url, { headers: UA });
  if (!r.ok) throw new Error(`${url} -> HTTP ${r.status}`);
  const j = await r.json();
  if (!j || !j.data) throw new Error(`${url} -> no data`);
  return j.data;
}

/**
 * Readable text out of a Riot news page, with list items kept as lines.
 *
 * The page ends with a carousel of OTHER patches' articles, and their teaser
 * text reads exactly like a change line ("Neon and shotgun nerfs are here!").
 * Pulling those in would attribute another patch's changes to this one, so the
 * page is cut at the first recommendation card before any text is read.
 */
function htmlToLines(rawHtml) {
  const cut  = rawHtml.search(/data-testid="card-title"/i);
  const html = cut > 1000 ? rawHtml.slice(0, cut) : rawHtml;
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<li[^>]*>/gi, '\n')
    .replace(/<\/(p|div|h\d|li|tr|section)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/&#x27;|&rsquo;|&#39;/g, "'")
    .replace(/&quot;|&ldquo;|&rdquo;/g, '"')
    .replace(/&hellip;/g, '...')
    .replace(/[ \t]+/g, ' ');
  return text.split('\n').map((l) => l.trim()).filter(Boolean);
}

/** "release-13.01" -> "13.01" */
function patchFromBranch(branch) {
  const m = String(branch || '').match(/(\d+\.\d+)/);
  return m ? m[1] : null;
}

/** When the article went up, as an ISO string, or null. */
function dateOf(html) {
  const hit = String(html || '').match(/"datePublished"\s*:\s*"([^"]+)"/)
    || String(html || '').match(/property="article:published_time"\s+content="([^"]+)"/i)
    || String(html || '').match(/<time[^>]+datetime="([^"]+)"/i);
  if (!hit) return null;
  const t = Date.parse(hit[1]);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

/** Every patch the notes index links, newest first: ['13.08', '13.07', ...]. */
function slugsFromIndex(html) {
  const seen = new Set();
  const re = /valorant-patch-notes-(\d+)-(\d+)/gi;
  let m;
  while ((m = re.exec(String(html || ''))) !== null) seen.add(`${Number(m[1])}.${m[2].padStart(2, '0')}`);
  return [...seen].sort((a, b) => patchKey(b) - patchKey(a));
}

const patchKey = (p) => {
  const m = String(p || '').match(/^(\d+)\.(\d+)/);
  return m ? Number(m[1]) * 1000 + Number(m[2]) : -1;
};

/**
 * The patch notes URL for a version. Riot's slug is stable
 * ("valorant-patch-notes-13-01"), but we confirm against the index rather than
 * trusting the guess, so a naming change degrades to "notes unavailable"
 * instead of silently shipping the wrong patch's changes.
 */
async function findNotesUrl(patch, indexHtml) {
  const slug = patch.replace('.', '-');
  const guess = `${NOTES_INDEX}valorant-patch-notes-${slug}/`;
  try {
    const r = await fetch(guess, { headers: UA });
    if (r.ok) return guess;
  } catch {}
  // Fall back to whatever the index actually links for this patch.
  try {
    const html = indexHtml || await (await fetch(NOTES_INDEX, { headers: UA })).text();
    const re = new RegExp(`href="([^"]*valorant-patch-notes-${slug}[^"]*)"`, 'i');
    const m = html.match(re);
    if (m) return m[1].startsWith('http') ? m[1] : `https://playvalorant.com${m[1]}`;
  } catch {}
  return null;
}

function classify(line, agents, weapons, maps) {
  const hits = [];
  for (const [type, names] of [['agent', agents], ['weapon', weapons], ['map', maps]]) {
    for (const n of names) {
      // Word-boundary match so "Sage" never fires inside another word.
      if (new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}\\b`, 'i').test(line)) {
        hits.push({ type, name: n });
      }
    }
  }
  return hits;
}

/**
 * One patch's notes out of its page: the headline, the named lines the coach
 * prompt has always read (`changes`, at most MAX_LINES, five words to 240
 * characters as before), and every line for the history, a bare heading and a
 * long paragraph included, each with what it names. `substantive` counts the
 * lines of five words or more: the page's own short chrome ("Sign in", the
 * title) is no proof its notes were read, so a history entry's notesFound asks
 * for one of those.
 */
function notesFromHtml(html, names) {
  const lines = htmlToLines(html);
  const desc = html.match(/<meta[^>]+name="description"[^>]+content="([^"]{20,300})"/i)
            || html.match(/"description"\s*:\s*"([^"]{20,300})"/);
  const headline = desc ? desc[1].trim() : null;
  const changes = [];
  const all = [];
  const seen = new Set();
  // The headline already leads the block; repeating it as a change line just
  // spends prompt space saying the same thing twice.
  if (headline) seen.add(headline.toLowerCase());
  let capped = false;
  let substantive = 0;
  for (const line of lines) {
    const key = line.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const hits = classify(line, names.agents, names.weapons, names.maps);
    const named = [...new Set(hits.map((h) => h.name))];
    if (all.length < MAX_HISTORY_LINES) all.push({ line, names: named });
    else capped = true;
    const words = line.split(/\s+/).length;
    if (words >= MIN_WORDS) substantive++;
    // The prompt's own lines are filtered as they always were.
    if (line.length > MAX_LINE || words < MIN_WORDS) continue;
    // One entry per line, tagged with everything it mentions.
    if (hits.length && changes.length < MAX_LINES) changes.push({ type: hits[0].type, names: named, line });
  }
  return { headline, changes, lines: all, capped, date: dateOf(html), substantive };
}

/**
 * The old shape (8.4 and before) as a history entry, offline. Its lines are the
 * named ones only, because the old sync dropped the rest, so it is marked
 * linesKept 'named': the gates may read it for a gun or an agent, never to
 * clear a stated fact. With MAX_LINES lines kept it may have dropped named ones
 * too, and is marked capped.
 */
function upgrade(prev) {
  const p = prev || {};
  if (Array.isArray(p.history)) return p;
  const entry = p.patch ? [{
    patch: p.patch,
    date: p.buildDate || null,
    dateFrom: p.buildDate ? 'buildDate' : null,
    source: p.source || null,
    notesFound: !!p.notesFound,
    linesKept: 'named',
    capped: (p.changes || []).length >= MAX_LINES,
    lines: (p.changes || []).map((c) => ({ line: c.line, names: c.names || [] })),
  }] : [];
  return { ...p, history: entry };
}

/**
 * A patch read this run as a history entry. Its notes count as found only on a
 * line of five words or more (`substantive`): a page that gave nothing but its
 * own chrome must withhold what that patch could touch, never vouch for it.
 */
function historyEntry(patch, notes, source, date, dateFrom) {
  return { patch, date: date || null, dateFrom: date ? dateFrom : null, source: source || null,
    notesFound: !!(notes && notes.substantive > 0), linesKept: 'all', capped: !!(notes && notes.capped), lines: (notes && notes.lines) || [] };
}

/** The newest KEEP_PATCHES, a patch fetched this run replacing its older entry. */
function mergeHistory(prevHistory, fresh, keep = KEEP_PATCHES) {
  const by = new Map();
  for (const e of prevHistory || []) if (e && e.patch) by.set(e.patch, e);
  for (const e of fresh || []) if (e && e.patch) by.set(e.patch, e);
  return [...by.values()].sort((a, b) => patchKey(b.patch) - patchKey(a.patch)).slice(0, keep);
}

async function main() {
  const outPath = OUT_PATH;
  let prev = {};
  try { prev = JSON.parse(fs.readFileSync(outPath, 'utf8')); } catch {}

  if (process.argv.includes('--upgrade')) {
    const next = upgrade(prev);
    fs.writeFileSync(outPath, JSON.stringify(next, null, 2) + '\n');
    console.log(`Upgraded ${outPath} offline: history of ${next.history.length} patch(es), `
      + `${next.history.map((e) => `${e.patch} (${e.lines.length} lines, ${e.linesKept})`).join(', ')}.`);
    return;
  }

  console.log('Checking the live Valorant patch ...');
  const [version, weaponRows, agentRows] = await Promise.all([
    getJson(VERSION_URL), getJson(WEAPONS_URL), getJson(AGENTS_URL),
  ]);

  const patch = patchFromBranch(version.branch);
  if (!patch) throw new Error(`could not read a patch number from branch "${version.branch}"`);

  const agents  = agentRows.map((a) => a.displayName).filter(Boolean);
  const weapons = weaponRows.map((w) => w.displayName).filter((n) => n && n !== 'Melee');
  let maps = [];
  try {
    maps = Object.keys(require('../server/valorant-data.generated.json').mapGeometry || {})
      .map((m) => m[0].toUpperCase() + m.slice(1));
  } catch {}
  const names = { agents, weapons, maps };

  console.log(`Live patch: ${patch} (built ${version.buildDate})`);
  let indexHtml = null;
  try { indexHtml = await (await fetch(NOTES_INDEX, { headers: UA })).text(); } catch {}
  const url = await findNotesUrl(patch, indexHtml);

  const data = {
    generatedAt: new Date().toISOString(),
    patch,
    buildDate: version.buildDate || null,
    source: url,
    headline: null,
    changes: [],       // [{ type, name, line }] verbatim from Riot
    notesFound: false,
  };

  const fresh = [];
  if (!url) {
    console.warn(`No patch notes page found for ${patch}. Shipping the version only;`);
    console.warn('the coach will know which patch is live but not what changed.');
    fresh.push(historyEntry(patch, null, null, version.buildDate, 'buildDate'));
  } else {
    const html = await (await fetch(url, { headers: UA })).text();
    const notes = notesFromHtml(html, names);
    data.headline = notes.headline;
    data.changes = notes.changes;
    data.notesFound = data.changes.length > 0;
    fresh.push(historyEntry(patch, notes, url, notes.date || version.buildDate, notes.date ? 'article' : 'buildDate'));
  }

  // The patches before it, from the index's own links, the newest first.
  const older = slugsFromIndex(indexHtml).filter((p) => patchKey(p) < patchKey(patch)).slice(0, KEEP_PATCHES - 1);
  for (const p of older) {
    try {
      const u = await findNotesUrl(p, indexHtml);
      if (!u) { fresh.push(historyEntry(p, null, null, null, null)); continue; }
      const html = await (await fetch(u, { headers: UA })).text();
      const notes = notesFromHtml(html, names);
      fresh.push(historyEntry(p, notes, u, notes.date, 'article'));
    } catch (e) {
      // Recorded, never skipped: a hole in the history is a patch the gates
      // could not see, and a patch with no notes withholds what it could touch.
      console.warn(`  ${p}: notes not read (${e.message})`);
      fresh.push(historyEntry(p, null, null, null, null));
    }
  }
  data.history = mergeHistory(upgrade(prev).history, fresh);

  fs.writeFileSync(outPath, JSON.stringify(data, null, 2) + '\n');

  console.log(`\nPatch ${patch}${data.headline ? ': ' + data.headline : ''}`);
  console.log(`Change lines captured: ${data.changes.length}`);
  for (const c of data.changes.slice(0, 8)) {
    console.log(`  [${c.type}] ${c.names.join(', ')}: ${c.line.slice(0, 90)}`);
  }
  console.log(`History: ${data.history.map((e) => `${e.patch} ${e.date ? e.date.slice(0, 10) : 'undated'} `
    + `${e.notesFound ? `${e.lines.length} lines${e.capped ? ' (capped)' : ''}` : 'no notes'}${e.linesKept === 'named' ? ' (named only)' : ''}`).join('; ')}`);
  if (prev.patch && prev.patch !== patch) {
    console.log(`\nNEW PATCH: ${prev.patch} -> ${patch}`);
  } else if (prev.patch === patch) {
    console.log('\nSame patch as the last sync.');
  }
  console.log(`\nWrote: ${outPath}`);
  console.log('Next: npm run check:primer, which lists any stated fact the new notes withhold.');
}

if (require.main === module) {
  main().catch((e) => { console.error('patch sync failed:', e.message); process.exit(1); });
}

module.exports = { htmlToLines, patchFromBranch, dateOf, slugsFromIndex, notesFromHtml, upgrade, mergeHistory, historyEntry, classify,
  MAX_LINES, MAX_HISTORY_LINES, KEEP_PATCHES };

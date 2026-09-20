'use strict';

/**
 * The official balance post: what the game changed, in the game's own words.
 *
 * WHY THIS AND NOT A TIER LIST. Every Rivals win rate source was evaluated and
 * rejected, and the reasons are tabulated in docs/AI-CONTEXT.md. What was never
 * checked is that NetEase publishes the balance changes themselves, dated, per
 * hero, with a one line summary of the intent, at marvelrivals.com/balancepost/.
 * That is first party, it needs no permission, and it is a different and better
 * kind of knowledge than a tier list:
 *
 *   a tier list says    "Hela is S tier"          an opinion, contested, stale in a month
 *   a balance post says "Hela's Nastrond Crow     a fact, dated, quotable, and the
 *                        Form damage went 70 to    player can go and check it
 *                        60 on 2026/09/08"
 *
 * THE COACH QUOTES AND NEVER JUDGES. It does not say a hero was buffed or
 * nerfed, because deciding that is inference and it goes wrong in an obvious
 * way: "reduce cooldown" is a buff and "reduce damage" is a nerf, and the verb
 * is identical. What it says is that the hero changed, when, and what the
 * official summary line was. NetEase already wrote the characterisation, so
 * there is nothing to infer.
 *
 * WHAT IS NOT AVAILABLE, so nobody re-hunts it: the site's MAPS and HERO HOT
 * LIST nav items are `javascript:;` dropdowns rendered client side, and none of
 * /maps/, /gamemap/, /hotlist/, /herolist/, /teamup/ or /hero/ exist. The nav
 * JS does not carry the URLs either. /heroes/, /news/ and the article pages are
 * the whole of what is statically reachable.
 *
 *   npm run sync:rivalsbalance
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const NEWS = 'https://www.marvelrivals.com/news/';
const OUT = path.join(__dirname, '..', 'server', 'rivals-balance.generated.json');
// The client copy, for the same reason sync-rivals-data.js writes one: the
// installer ships src/ and not server/, so a guard in src/ requiring across
// resolves in the repo and throws MODULE_NOT_FOUND on a real install.
// check:clientboot enforces it.
const OUT_CLIENT = path.join(__dirname, '..', 'src', 'shared', 'rivals-balance.generated.json');

const heroes = require(path.join(__dirname, '..', 'server', 'services', 'rivals-heroes.js'));

// Refuse to write a file that would make the coach quieter than the one it
// replaces. A parse that silently yields two heroes looks like a light patch
// rather than like a broken selector.
const SANITY_MIN_HEROES = 8;

const GAP_MS = 400;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function get(url, depth = 0) {
  return new Promise((resolve, reject) => {
    if (depth > 4) return reject(new Error('too many redirects: ' + url));
    https.get(url, { headers: { 'user-agent': 'Mozilla/5.0' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return get(new URL(res.headers.location, url).href, depth + 1).then(resolve, reject);
      }
      if (res.statusCode !== 200) return reject(new Error(url + ' returned ' + res.statusCode));
      let d = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { d += c; });
      res.on('end', () => resolve(d));
    }).on('error', reject);
  });
}

/**
 * HTML to text, keeping the line structure the parser depends on.
 *
 * Block ends become newlines BEFORE tags are stripped, because the entire
 * structure of a balance post is carried by which line a thing is on: a role
 * heading, a hero name, a summary, then bullets. Flattening first loses it.
 */
function toText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h1|h2|h3|h4|h5|h6|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/&rsquo;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

/** Every balance post linked from the news index, newest first. */
function balanceLinks(html) {
  const out = [];
  const re = /https:\/\/www\.marvelrivals\.com\/balancepost\/(\d{8})\/[\w.]+\.html/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    if (!out.some((x) => x.url === m[0])) out.push({ url: m[0], date: m[1] });
  }
  return out.sort((a, b) => b.date.localeCompare(a.date));
}

const ROLES = ['VANGUARD', 'DUELIST', 'STRATEGIST'];

/**
 * Hero sections out of one balance post.
 *
 * The shape, verified against the 2026/09/08 post:
 *
 *   VANGUARD                 a role heading, alone on its line, all capitals
 *   Captain America          the hero
 *   The First Avenger is ... one line of official summary
 *   - Increase base Health   one bullet per change
 *   - Remove Vibranium ...
 *
 * Deadpool appears as "Deadpool (Strategist)" because he is officially
 * tri-role, so the parenthetical is stripped before the name is resolved. That
 * is also a standing argument for leaving him in PENDING: the balance post
 * itself cannot name him without disambiguating.
 */
function parsePost(text) {
  const lines = text.split('\n').map((l) => l.trim());

  // The article body starts at ADJUSTMENTS and ends at the social footer. The
  // nav above repeats words like HERO and TEAM-UP that would otherwise be read
  // as content.
  let from = lines.findIndex((l) => /^ADJUSTMENTS?$/i.test(l));
  if (from < 0) from = lines.findIndex((l) => /^GLOBAL CHANGES$/i.test(l));
  if (from < 0) return { heroes: [], global: [] };
  let to = lines.findIndex((l, i) => i > from && /^Discord \| X \|/.test(l));
  if (to < 0) to = lines.length;

  const body = lines.slice(from, to);

  const out = [];
  const global = [];
  let role = null;
  let current = null;
  let inGlobal = false;

  const flush = () => { if (current && current.changes.length) out.push(current); current = null; };

  for (const line of body) {
    if (!line) continue;

    if (/^GLOBAL CHANGES$/i.test(line)) { flush(); inGlobal = true; role = null; continue; }

    if (ROLES.includes(line.toUpperCase()) && line === line.toUpperCase()) {
      flush();
      inGlobal = false;
      role = line.toUpperCase();
      role = role.charAt(0) + role.slice(1).toLowerCase();
      continue;
    }

    const bullet = line.match(/^[-•]\s*(.+)$/);
    if (bullet) {
      const change = bullet[1].trim();
      if (inGlobal) global.push(change);
      else if (current) current.changes.push(change);
      continue;
    }

    // GLOBAL CHANGES CARRIES NO DASHES, which a bullet-only rule silently
    // drops. In the 2026/09/08 post the section reads "Strategists:" and then
    // two bare sentences, and the first version of this parser reported zero
    // global changes while the page plainly had two. Nothing errored, and
    // "this patch changed nothing globally" is a believable output, which is
    // what made it worth a comment rather than a quiet fix.
    if (inGlobal) { global.push(line); continue; }

    if (!role) continue;

    // Not a bullet and inside a role section: either a hero name or the
    // summary line that follows one.
    if (current && current.summary === null) { current.summary = line; continue; }

    const name = heroes.onRoster(line.replace(/\s*\([^)]*\)\s*$/, ''));
    if (name) {
      flush();
      current = { hero: name, printedAs: line, role, summary: null, changes: [] };
    }
    // Anything else inside a role section that is not a known hero is dropped
    // rather than guessed at, which is the same rule the rest of this app runs
    // on: a hero the roster does not know produces no advice.
  }
  flush();
  return { heroes: out, global };
}

function versionOf(text) {
  const m = text.match(/Version\s+(\d{8})\s+Balance Post/i);
  return m ? m[1] : null;
}

function dateOf(text) {
  const m = text.match(/\n(\d{4})\/(\d{2})\/(\d{2})\n/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

async function main() {
  console.log('fetching the news index');
  const news = await get(NEWS);
  const links = balanceLinks(news);
  if (!links.length) throw new Error('no balance posts linked from ' + NEWS);
  console.log(`  ${links.length} balance post(s) linked, newest ${links[0].date}`);

  const newest = links[0];
  await sleep(GAP_MS);
  console.log('fetching ' + newest.url);
  const text = toText(await get(newest.url));

  const version = versionOf(text);
  const published = dateOf(text);
  const { heroes: changed, global } = parsePost(text);

  console.log('');
  for (const h of changed) {
    console.log(`  ${h.printedAs.padEnd(26)} ${String(h.role).padEnd(12)} ${h.changes.length} change(s)`);
  }
  console.log('');
  if (changed.length < SANITY_MIN_HEROES) {
    throw new Error(`only ${changed.length} hero section(s) parsed, expected at least `
      + `${SANITY_MIN_HEROES}. The page shape probably changed. Refusing to write.`);
  }

  const data = {
    generatedAt: new Date().toISOString(),
    source: newest.url,
    version,                       // the game version the changes ship in
    published,                     // when the post went up
    note: 'Generated by npm run sync:rivalsbalance. Do not hand edit.',
    global,
    heroes: changed,
  };

  const prev = (() => { try { return require(OUT); } catch { return null; } })();
  if (prev && prev.version === version) {
    console.log(`no change: still version ${version}`);
  } else if (prev) {
    console.log(`version ${prev.version} -> ${version}`);
  }

  fs.writeFileSync(OUT, JSON.stringify(data, null, 2));
  console.log(`wrote ${OUT}`);

  // The client copy carries only what the review needs: which heroes changed,
  // the official summary line, and how many changes. Not the change bullets,
  // which run to thousands of characters and are never rendered.
  //
  // EACH HERO MAPS TO A LIST, because Deadpool is officially tri-role and the
  // post gives him three separate sections: "Deadpool (Vanguard)",
  // "Deadpool (Duelist)" and "Deadpool (Strategist)", with different changes in
  // each. Keyed one-to-one, Object.fromEntries kept the last and silently threw
  // away two, and the count printed 36 against 38 parsed. A list is also the
  // honest shape for the lookup: knowing the hero does not always tell you
  // which section applies.
  const byHero = {};
  for (const h of changed) {
    (byHero[h.hero] = byHero[h.hero] || []).push({
      summary: h.summary, count: h.changes.length, role: h.role, printedAs: h.printedAs,
    });
  }
  const client = {
    generatedAt: data.generatedAt,
    source: data.source,
    version, published,
    note: data.note,
    heroes: byHero,
  };
  fs.writeFileSync(OUT_CLIENT, JSON.stringify(client, null, 2));
  console.log(`wrote ${OUT_CLIENT}`);
  console.log(`  version ${version}, published ${published}, `
    + `${changed.length} heroes changed, ${global.length} global change(s)`);
}

main().catch((e) => { console.error('sync failed:', e.message); process.exit(1); });

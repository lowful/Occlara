#!/usr/bin/env node
'use strict';

/**
 * Post a version's changelog entry to Discord as one embed, the last step of
 * `npm run release` (after publish-download.js).
 *
 * Reads changelog/changelog.json (the one source, scripts/sync-changelog.js),
 * takes the entry for package.json's version or for --version x.y.z, and POSTs
 * one embed to the webhook in env DISCORD_WEBHOOK_URL: the title "Occlara
 * <version>" linking to https://occlara.app/changelog, the summary as its
 * description, the items grouped New, Improved and Fixed as fields of bullet
 * lines, the dark ground as its colour, "occlara.app" as its footer. No
 * mention of anyone: allowed_mentions parses nothing, so even an "@everyone"
 * in a line would ping nobody.
 *
 * THE WEBHOOK URL IS A SECRET. It is read from the environment only, never
 * printed, never logged, and scrubbed from any error before a line is written
 * (a fetch error can carry the URL it was asked).
 *
 * IT NEVER FAILS A RELEASE. No webhook set, a URL that is not Discord's, no
 * entry for the version, a network error or a refusal: one calm line, exit 0.
 *
 * Run:  npm run post:changelog                    the entry for package.json's version
 *       node scripts/post-changelog.js --version 8.7.3
 *       node scripts/post-changelog.js --dry      print the payload, send nothing
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SOURCE = path.join(ROOT, 'changelog', 'changelog.json');
const CHANGELOG_URL = 'https://occlara.app/changelog';
const COLOR = 0x0A0B0E;   // the app's dark ground, theme.css --bg
const BULLET = String.fromCharCode(0x2022);
const TIMEOUT_MS = 10000;

// Discord's embed limits.
const LIMITS = { title: 256, description: 4096, fieldName: 256, fieldValue: 1024, fields: 25, total: 6000 };
const GROUPS = [['new', 'New'], ['improved', 'Improved'], ['fixed', 'Fixed']];
const WEBHOOK = /^https:\/\/(?:ptb\.|canary\.)?(?:discord|discordapp)\.com\/api\/webhooks\/\d+\/[\w-]+\/?(?:\?[\w=&-]*)?$/;

const clip = (s, n) => (s.length <= n ? s : `${s.slice(0, n - 3).trimEnd()}...`);

/** The Discord payload for one changelog entry, every limit kept. */
function buildPayload(entry) {
  const title = clip(`Occlara ${entry.version}`, LIMITS.title);
  const description = clip(String(entry.summary || ''), LIMITS.description);
  const footer = 'occlara.app';
  let budget = LIMITS.total - title.length - description.length - footer.length;
  const MORE = { name: 'More', value: `Every change is at ${CHANGELOG_URL}` };
  const reserve = MORE.name.length + MORE.value.length;
  const fields = [];
  let dropped = false;

  for (const [kind, name] of GROUPS) {
    const lines = (entry.items || []).filter((it) => it && it.kind === kind)
      .map((it) => clip(`${BULLET} ${String(it.text || '').trim()}`, LIMITS.fieldValue));
    let value = '';
    const flush = () => {
      if (!value) return;
      const room = fields.length < LIMITS.fields - 1 && budget - reserve >= name.length + value.length;
      if (room) { fields.push({ name, value }); budget -= name.length + value.length; } else dropped = true;
      value = '';
    };
    for (const line of lines) {
      const next = value ? `${value}\n${line}` : line;
      if (next.length > LIMITS.fieldValue) { flush(); value = line; } else value = next;
    }
    flush();
  }
  if (dropped) fields.push(MORE);

  const embed = { title, url: CHANGELOG_URL, description, color: COLOR, fields, footer: { text: footer } };
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(entry.date || ''))) embed.timestamp = `${entry.date}T12:00:00.000Z`;
  return { allowed_mentions: { parse: [] }, embeds: [embed] };
}

/** A message with the webhook URL (and its token) taken out. */
function scrub(text, url) {
  let s = String(text || '');
  if (url) {
    s = s.split(url).join('[webhook]');
    const token = url.split('/').filter(Boolean).pop();
    if (token && token.length > 4) s = s.split(token).join('[token]');
  }
  return s;
}

/**
 * Send it. Never throws, never prints the URL.
 * @returns { sent: boolean, reason }
 */
async function post({ entry, env = process.env, fetch: doFetch = globalThis.fetch, log = console.log } = {}) {
  const url = String((env && env.DISCORD_WEBHOOK_URL) || '').trim();
  if (!url) { log('no Discord webhook set, skipping'); return { sent: false, reason: 'unset' }; }
  if (!WEBHOOK.test(url)) { log('the Discord webhook is not a Discord webhook URL, skipping'); return { sent: false, reason: 'url' }; }
  if (!entry) { log('no changelog entry for this version, nothing posted to Discord'); return { sent: false, reason: 'entry' }; }
  if (typeof doFetch !== 'function') { log('this Node has no fetch, nothing posted to Discord'); return { sent: false, reason: 'fetch' }; }
  const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), TIMEOUT_MS) : null;
  try {
    const res = await doFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildPayload(entry)),
      ...(ctrl ? { signal: ctrl.signal } : {}),
    });
    if (!res || !res.ok) {
      log(`Discord did not take the changelog post (HTTP ${res ? res.status : 'none'}), the release goes on`);
      return { sent: false, reason: 'status' };
    }
    log(`posted the ${entry.version} changelog to Discord`);
    return { sent: true };
  } catch (e) {
    const kind = e && e.name === 'AbortError' ? 'it timed out' : `${scrub((e && e.name) || 'Error', url)}`;
    log(`could not reach Discord for the changelog post (${kind}), the release goes on`);
    return { sent: false, reason: 'error' };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function entryFor(version) {
  const entries = JSON.parse(fs.readFileSync(SOURCE, 'utf8'));
  return (Array.isArray(entries) ? entries : []).find((e) => e && e.version === version) || null;
}

async function main(argv) {
  const at = argv.indexOf('--version');
  const version = at >= 0 && argv[at + 1] ? argv[at + 1] : require(path.join(ROOT, 'package.json')).version;
  let entry = null;
  try { entry = entryFor(version); } catch (e) {
    console.log(`could not read the changelog (${e.name}), nothing posted to Discord`);
    return;
  }
  if (argv.includes('--dry')) {
    if (!entry) { console.log(`no changelog entry for ${version}, nothing to show`); return; }
    console.log(JSON.stringify(buildPayload(entry), null, 2));
    return;
  }
  await post({ entry });
}

if (require.main === module) {
  main(process.argv.slice(2))
    .catch((e) => console.log(`the changelog post stopped (${e && e.name}), the release goes on`))
    .finally(() => { process.exitCode = 0; });
}

module.exports = { buildPayload, post, scrub, LIMITS, COLOR, CHANGELOG_URL, WEBHOOK };

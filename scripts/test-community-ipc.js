'use strict';

/**
 * test:communityipc. The two ways the community leaves the app, and the
 * update line, held to their rules:
 *
 *   - the Discord invite opens only when the URL asked for is EXACTLY
 *     config.js DISCORD_URL, through shell.openExternal, once, and never mid
 *     match or while the window is sealed (src/main/ipc/community.js)
 *   - the changelog's refresh is a GET of /api/changelog on the API's base,
 *     4 s at most, null on any failure, and only well formed entries pass
 *   - Home's update line (src/shared/changelog.js noticeFor): nothing on the
 *     first launch ever, once after an update to a version with an entry
 *   - the wiring: the channels, register-ipc.js, index.js's seal test, and
 *     the shell's and Settings' bridges asking for exactly DISCORD_URL
 *
 * Run: npm run test:communityipc
 */

const fs = require('fs');
const path = require('path');
const C = require('../src/shared/channels');
const { DISCORD_URL, SERVER_BASE_URL, API } = require('../src/shared/config');
const changelog = require('../src/shared/changelog');
const { createCommunity, REFRESH_MS } = require('../src/main/ipc/community');
const { loadPreload } = require('./fixtures/fake-dom');

const ROOT = path.join(__dirname, '..');
let fails = 0;
const ok = (cond, what, detail) => {
  if (!cond) { fails++; console.log(`FAIL  ${what}${detail ? `\n        ${detail}` : ''}`); }
  else console.log(`ok    ${what}`);
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const BUNDLED = require('../src/shared/changelog.generated.json');

(async () => {
  // ── The Discord invite ────────────────────────────────────────────────────
  ok(DISCORD_URL === 'https://discord.gg/JYmXhvDkG9', 'config.js DISCORD_URL is the Occlara invite');
  const opened = [];
  let busy = false;
  const community = createCommunity({ openExternal: async (u) => { opened.push(u); }, busy: () => busy });

  const r = await community.openDiscord(DISCORD_URL);
  ok(r && r.ok === true && same(opened, [DISCORD_URL]), 'the exact invite opens in the browser, once', JSON.stringify({ r, opened }));

  const near = [
    `${DISCORD_URL}/`, DISCORD_URL.replace('https', 'http'), DISCORD_URL.toUpperCase(), `${DISCORD_URL}?x=1`,
    `${DISCORD_URL}#a`, ` ${DISCORD_URL}`, 'https://discord.gg/other', 'https://discord.com/invite/JYmXhvDkG9',
    'https://evil.example/https://discord.gg/JYmXhvDkG9', 'javascript:alert(1)', 'file:///C:/Windows/System32/calc.exe',
    '', null, undefined, 42, { href: DISCORD_URL }, [DISCORD_URL],
  ];
  opened.length = 0;
  const refusals = await Promise.all(near.map((u) => community.openDiscord(u)));
  ok(refusals.every((x) => x && x.ok === false && x.error === 'url') && opened.length === 0,
    'anything but the exact invite is refused as url and opens nothing', JSON.stringify(refusals));

  busy = true;
  const mid = await community.openDiscord(DISCORD_URL);
  ok(mid && mid.ok === false && mid.error === 'match' && opened.length === 0, 'mid match or sealed, the invite is refused and nothing opens');
  busy = false;
  ok((await community.openDiscord(DISCORD_URL)).ok && opened.length === 1, 'and the match over, it opens again');

  // ── The changelog's refresh ───────────────────────────────────────────────
  ok(REFRESH_MS === 4000, 'the refresh waits 4 s at most');
  const asked = [];
  const answer = (status, body) => async (url, init) => { asked.push([url, init && init.method]); return { ok: status >= 200 && status < 300, status, json: async () => body }; };
  const good = await createCommunity({ fetch: answer(200, { version: BUNDLED[0].version, entries: BUNDLED }) }).refresh();
  ok(same(good, changelog.clean(BUNDLED)) && good.length === BUNDLED.length, 'a good answer gives the entries, checked');
  ok(asked[0] && asked[0][0] === `${SERVER_BASE_URL}${API.CHANGELOG}` && asked[0][0] === 'https://ghostcoach-production.up.railway.app/api/changelog' && asked[0][1] === 'GET',
    'asked of GET /api/changelog on the API base', JSON.stringify(asked[0]));
  ok(await createCommunity({ fetch: answer(500, { entries: BUNDLED }) }).refresh() === null, 'a 500 is null');
  ok(await createCommunity({ fetch: answer(404, null) }).refresh() === null, 'a 404 (an older server) is null');
  ok(await createCommunity({ fetch: async () => { throw new Error('offline'); } }).refresh() === null, 'no network is null, silently');
  ok(await createCommunity({ fetch: answer(200, { entries: 'x' }) }).refresh() === null, 'a body that is not entries is null');
  ok(await createCommunity({ fetch: async () => ({ ok: true, json: async () => { throw new SyntaxError('bad json'); } }) }).refresh() === null, 'a body that is not JSON is null');
  ok(await createCommunity({ fetch: null }).refresh() === null, 'and with no fetch at all, null');
  const t0 = Date.now();
  let aborted = false;
  const hung = await createCommunity({ timeoutMs: 60, fetch: (url, init) => new Promise(() => { init.signal.addEventListener('abort', () => { aborted = true; }); }) }).refresh();
  ok(hung === null && Date.now() - t0 < 1000 && aborted, 'a server that never answers is null after the wait, its request aborted');
  const slowBody = await createCommunity({ timeoutMs: 60, fetch: async () => ({ ok: true, json: () => new Promise(() => {}) }) }).refresh();
  ok(slowBody === null, 'and a body that never ends is null after the wait too');

  // What the server says is checked before the page sees a line of it.
  const DASH = String.fromCharCode(0x2014);
  const dirty = [
    { version: '9.0.0', date: '2026-12-01', title: 'Bad', summary: `One ${DASH} two.`, items: [{ kind: 'new', text: 'x' }] },
    { version: '8.9.0', date: '2026-11-30', title: 'Semi', summary: 'One; two.', items: [{ kind: 'new', text: 'x' }] },
    { version: '8.8.0', date: '2026-11-20', title: 'Fine', summary: 'Fine.', items: [{ kind: 'new', text: 'Good line.' }, { kind: 'removed', text: 'Unknown kind.' }, { kind: 'fixed', text: `Dash ${DASH} here.` }] },
    { version: 'x', date: '2026-11-20', title: 'Bad version', summary: 'x.', items: [{ kind: 'new', text: 'x' }] },
    { version: '8.7.9', date: 'soon', title: 'Bad date', summary: 'x.', items: [{ kind: 'new', text: 'x' }] },
    { version: '8.8.0', date: '2026-11-20', title: 'Again', summary: 'Twice.', items: [{ kind: 'new', text: 'x' }] },
    { version: '8.7.8', date: '2026-11-19', title: 'No items', summary: 'x.', items: [] },
    { version: '8.7.7', date: '2026-11-18', title: '<img src=x onerror=alert(1)>', summary: 'Text only.', items: [{ kind: 'improved', text: '<b>stays text</b>' }], extra: 'dropped' },
  ];
  const cleaned = changelog.clean(dirty);
  ok(same(cleaned.map((e) => e.version), ['8.8.0', '8.7.7']), 'only well formed entries pass: no dash, no semicolon, a real version and day, items, no repeat', JSON.stringify(cleaned && cleaned.map((e) => e.version)));
  ok(same(cleaned[0].items, [{ kind: 'new', text: 'Good line.' }]) && !('extra' in cleaned[1]), 'and inside one only its good items and known fields');
  ok(changelog.clean(dirty.slice(0, 2)) === null && changelog.clean('x') === null && changelog.clean([]) === null, 'with none left, no answer');
  ok(same(changelog.clean([BUNDLED[2], BUNDLED[0], BUNDLED[1]]).map((e) => e.version), BUNDLED.slice(0, 3).map((e) => e.version)), 'and the list comes newest first');

  // ── Home's update line ───────────────────────────────────────────────────
  const latest = BUNDLED[0].version;
  const older = BUNDLED[1].version;
  const n = (o) => changelog.noticeFor({ current: latest, entries: BUNDLED, ...o });
  ok(same(n({ seen: '', onboarded: false }), { seed: latest }), 'the first launch ever says nothing and only remembers the version');
  const shown = n({ seen: '', onboarded: true });
  ok(shown && shown.version === latest && shown.text === `Occlara updated to ${latest}.` && shown.link === "See what's new",
    'an install from before the changelog, updated, is told once', JSON.stringify(shown));
  ok(n({ seen: older, onboarded: true }) && n({ seen: older, onboarded: true }).version === latest, 'an update from an older version is told');
  ok(n({ seen: latest, onboarded: true }) === null, 'the version already offered says nothing');
  ok(n({ seen: '99.0.0', onboarded: true }) === null, 'a version older than the one seen (a downgrade) says nothing');
  ok(changelog.noticeFor({ current: '99.0.0', seen: older, onboarded: true, entries: BUNDLED }) === null, 'a version with no entry says nothing');
  ok(changelog.noticeFor({ current: 'dev', seen: older, onboarded: true, entries: BUNDLED }) === null, 'and a version that is no x.y.z says nothing');
  const DASHES = new RegExp(`[${String.fromCharCode(0x2013, 0x2014)};]`);
  ok(DASHES.test(`a${DASH}b`) && !DASHES.test('a-b') && !DASHES.test(shown.text + shown.link), 'the line carries no dash and no semicolon');
  ok(changelog.dayOf('2026-11-04') === '4 Nov 2026' && changelog.dayOf('nope') === '', 'a day reads as 4 Nov 2026');
  ok(changelog.kindWord('new') === 'New' && changelog.kindWord('improved') === 'Improved' && changelog.kindWord('fixed') === 'Fixed' && changelog.kindWord('x') === '', 'the kinds read as words');

  // ── The wiring ───────────────────────────────────────────────────────────
  ok(C.DISCORD_OPEN && C.CHANGELOG_REFRESH && C.CHANGELOG_NOTICE && C.CHANGELOG_SEEN && C.PUSH_LIST.includes(C.PUSH_CHANGELOG),
    'the channels are in channels.js, the push on its list');
  const reg = fs.readFileSync(path.join(ROOT, 'src/main/ipc/register-ipc.js'), 'utf8');
  ok(/safeHandle\(C\.DISCORD_OPEN, async \(_e, url\) => community\.openDiscord\(url\)\)/.test(reg)
    && /safeHandle\(C\.CHANGELOG_REFRESH, async \(\) => community\.refresh\(\)\)/.test(reg)
    && /safeHandle\(C\.CHANGELOG_NOTICE, async \(\) => changelog\.notice\(\)\)/.test(reg),
  'register-ipc.js hands each channel to its handler, the URL as the page sent it');
  const idx = fs.readFileSync(path.join(ROOT, 'src/main/index.js'), 'utf8');
  ok(/busy: \(\) => matchInProgress\(\) \|\| windowSealed\(\)/.test(idx) && /openExternal: \(url\) => shell\.openExternal\(url\)/.test(idx),
    'index.js builds it on shell.openExternal, busy mid match or sealed');
  ok(/community: communityIpc, changelog: changelogIpc/.test(idx), 'and passes both to registerIpc');
  ok(/if \(!changelogWaiting \|\| state\.isCoaching \|\| matchInProgress\(\) \|\| windowSealed\(\)\) return null;/.test(idx),
    'the update line is answered null while recording, mid match or sealed');
  ok(!/https:\/\/discord/.test(fs.readFileSync(path.join(ROOT, 'src/main/ipc/community.js'), 'utf8')),
    'community.js names no invite of its own: config.js is the one place');

  for (const name of ['shell', 'settings']) {
    const b = loadPreload(name, { [C.DISCORD_OPEN]: () => ({ ok: true }) });
    await b.api.openDiscord();
    ok(b.invoked.some(([ch, url]) => ch === C.DISCORD_OPEN && url === DISCORD_URL), `the ${name} bridge asks for exactly DISCORD_URL`);
  }
  const s = loadPreload('settings', {});
  s.api.openWhatsNew();
  ok(s.sent.some(([ch, p]) => ch === C.SHELL_NAV && p === 'whatsnew'), 'and Settings opens the What\'s new page');
  const w = loadPreload('whatsnew', { [C.CHANGELOG_REFRESH]: () => null });
  ok(same(w.api.bundled(), changelog.clean(BUNDLED)), 'the What\'s new bridge hands over the bundled changelog, checked');
  ok(await w.api.refresh() === null && w.invoked.some(([ch]) => ch === C.CHANGELOG_REFRESH), 'and asks main to refresh it');
  const h = loadPreload('home', { [C.CHANGELOG_NOTICE]: () => shown });
  ok(same(await h.api.getNews(), shown), 'Home asks main for the update line');
  h.api.newsSeen(latest);
  h.api.openWhatsNew();
  ok(h.sent.some(([ch, v]) => ch === C.CHANGELOG_SEEN && v === latest) && h.sent.some(([ch, p]) => ch === C.SHELL_NAV && p === 'whatsnew'),
    'says when it was seen, and opens What\'s new');

  console.log(fails ? `\nFAIL: ${fails} problem(s)` : '\nPASS: the Discord invite, the changelog refresh and the update line keep their rules');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.log(`FAIL  the test itself threw: ${e.stack || e}`); process.exit(1); });

'use strict';

const { SERVER_BASE_URL, API } = require('../../shared/config');
const changelog = require('../../shared/changelog');

/**
 * THE COMMUNITY'S TWO WAYS OUT OF THE APP, both main's (register-ipc.js):
 *
 * openDiscord(url): the sidebar's Discord button and Settings' Community row
 * ask for the invite link, and it opens in the browser only when the URL is
 * exactly config.js DISCORD_URL (changelog.isDiscordUrl), through the same
 * shell.openExternal the Profile page's links use, and never mid match or
 * while the window is sealed: nothing leaves the app while a match is played.
 *
 * refresh(): the What's new page's background read of GET /api/changelog,
 * 4 s at most, every failure silent (null), and the answer checked
 * (changelog.fromServer) before the page sees a line of it. The page has
 * already painted the bundled copy, so a null changes nothing.
 *
 * Built with its effects passed in, so test-community-ipc.js drives it.
 *
 * @param deps.openExternal(url)  shell.openExternal
 * @param deps.busy()             true mid match or while the window is sealed
 * @param deps.fetch              global fetch (or a fake)
 * @param deps.base               the API's base, SERVER_BASE_URL by default
 * @param deps.timeoutMs          4000 by default
 */
const REFRESH_MS = 4000;

function createCommunity(deps) {
  const d = deps || {};
  const base = d.base || SERVER_BASE_URL;
  const timeoutMs = Number.isFinite(d.timeoutMs) ? d.timeoutMs : REFRESH_MS;
  const log = d.log || (() => {});

  async function openDiscord(url) {
    if (!changelog.isDiscordUrl(url)) return { ok: false, error: 'url' };
    if (d.busy && d.busy()) return { ok: false, error: 'match' };
    await d.openExternal(changelog.DISCORD_URL);
    log('[community] opened the Discord invite');
    return { ok: true };
  }

  async function refresh() {
    if (typeof d.fetch !== 'function') return null;
    const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    let timer = null;
    try {
      const answer = d.fetch(`${base}${API.CHANGELOG}`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: ctrl ? ctrl.signal : undefined,
      });
      const late = new Promise((resolve) => {
        timer = setTimeout(() => { if (ctrl) ctrl.abort(); resolve(null); }, timeoutMs);
      });
      const res = await Promise.race([answer, late]);
      if (!res || !res.ok) return null;
      const body = await Promise.race([res.json(), late]);
      return changelog.fromServer(body);
    } catch {
      return null;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  return { openDiscord, refresh };
}

module.exports = { createCommunity, REFRESH_MS };

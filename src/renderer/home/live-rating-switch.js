'use strict';

/*
 * THE LIVE RATING'S SWITCH ON HOME (9.1, the owner's item 14): beside Start,
 * so the switch is found before a match, not only deep in Settings. The live
 * rating is the owner's second deliberate exception to "nothing reaches the
 * screen" (docs/claude/screen-silence.md, "The live rating"): OFF by default,
 * and turning it on asks first, here exactly as in Settings, with the same
 * words (Settings' warning and its confirm's title; test:liveratingwiring
 * holds them equal). Off asks nothing.
 *
 * Main decides everything: it turns the switch on only for this page's own
 * view (LIVE_RATING_SET, register-ipc.js fromPage), off from anywhere, and
 * says what is true on PUSH_STATE's `live` (liveRating). Valorant only: League
 * has no live reader. The Recording screen never carries this switch.
 */
(function () {
  const $ = (id) => document.getElementById(id);
  const host = $('h-lr');
  const sw = $('h-lr-switch');
  const hint = $('h-lr-hint');
  const confirmBox = $('h-lr-confirm');
  if (!host || !sw || !window.occlara || typeof window.occlara.setLiveRating !== 'function') return;

  let on = false;
  let game = 'valorant';
  let needs = false;   // recording off or at 480p: main keeps the rating off and says why
  let busy = false;

  function paint() {
    host.hidden = game !== 'valorant';
    // The confirm opens under the row, outside the pill's own box (9.1): it
    // goes with the switch.
    if (host.hidden) confirmBox.hidden = true;
    sw.setAttribute('aria-checked', String(on));
    sw.disabled = busy;
    host.classList.toggle('on', on);
    hint.textContent = !on ? 'Off' : needs ? 'On, needs recording at 720p or 1080p' : 'On';
    host.title = 'Your match rating on the Recording screen while you play, marked provisional';
  }

  function ask() {
    confirmBox.hidden = false;
    $('h-lr-keep-off').focus();
  }
  function shut(refocus) {
    if (confirmBox.hidden) return;
    confirmBox.hidden = true;
    if (refocus) sw.focus();
  }

  async function set(next) {
    busy = true; paint();
    let r = null;
    try { r = await window.occlara.setLiveRating(next); } catch { r = null; }
    busy = false;
    if (r && typeof r.on === 'boolean') on = r.on;
    paint();
  }

  sw.addEventListener('click', () => {
    if (busy) return;
    if (on) { shut(false); set(false); return; }
    if (confirmBox.hidden) ask(); else shut(true);
  });
  // The whole pill is the switch's (9.1): it brightens under the pointer as
  // one, so a press on its name or its word presses the switch, which keeps
  // the keyboard and the switch role. The switch's own press is its own.
  const pill = host.querySelector('.h-lr-pill');
  if (pill) pill.addEventListener('click', (e) => { if (e.target !== sw && !sw.contains(e.target)) sw.click(); });
  $('h-lr-keep-off').addEventListener('click', () => shut(true));
  $('h-lr-turn-on').addEventListener('click', () => { shut(false); sw.focus(); set(true); });
  confirmBox.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); shut(true); } });

  /** What main says: the switch, from the state's `live`, and the game. */
  function take(s) {
    if (!s) return;
    if (typeof s.gameId === 'string') game = s.gameId;
    if (s.live && typeof s.live.liveRating === 'boolean') {
      on = s.live.liveRating;
      if (on) shut(false);
    }
    paint();
  }
  /** Recording off or at 480p keeps the rating off (index.js liveRatingSupported): the hint says so. */
  async function readNeeds() {
    let c = null;
    try { c = typeof window.occlara.getConfig === 'function' ? await window.occlara.getConfig() : null; } catch { c = null; }
    if (!c) return;
    needs = c.recordingMode === 'off' || String(c.recordingRes) === '480';
    paint();
  }

  if (typeof window.occlara.onState === 'function') window.occlara.onState(take);
  Promise.resolve(window.occlara.getState()).then(take).catch(() => {});
  readNeeds();
  // Asked again as Home comes back to the front: Settings may have changed it.
  if (typeof window.occlara.onPage === 'function') {
    window.occlara.onPage((m) => { if (m && m.phase === 'arm') { readNeeds(); shut(false); } });
  }
  paint();
})();

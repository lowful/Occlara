'use strict';

/*
 * THE INVITE PAGE (8.7). The player's invite link with Copy, how many
 * friends joined and the games earned, and how it works in two lines.
 *
 * Every line is main's: the link, `line` (usage.js inviteProgress) and `how`
 * (usage.js INVITE_HOW) come with the referral, and the games line with the
 * account's view (usage.js gamesLeft). This page counts nothing and names no
 * URL: Copy asks main, which copies only an occlara.app invite link, and See
 * plans asks main to open the pricing page.
 *
 * Three states besides the link: waiting for main, no account on this PC
 * (invites need one: a licence key alone has no link), and an account whose
 * link the server did not give (Try again). Main answers null mid match, but
 * the seal hides this page then, so nothing here is ever on screen mid match.
 */

const $ = (id) => document.getElementById(id);
const api = window.occlara || {};

const COPIED_MS = 1400;
// Asked again when the page comes back to the front, at most this often.
const AGAIN_MS = 30 * 1000;

let ask = 0;
let askedAt = 0;
let copiedTimer = null;

function show(which) {
  $('inv-wait').hidden = which !== 'wait';
  $('inv-out').hidden = which !== 'out';
  $('inv-error').hidden = which !== 'error';
  $('inv-body').hidden = which !== 'body';
}

function paintHow(how) {
  const list = $('inv-how');
  const lines = Array.isArray(how) ? how.filter((l) => typeof l === 'string' && l) : [];
  list.replaceChildren(...lines.map((line) => {
    const li = document.createElement('li');
    li.textContent = line;
    return li;
  }));
  list.parentNode.hidden = !lines.length;
}

function paintGames() {
  // The games left are the rail's line under Start (8.7, shell.js), said once.
  $('inv-upgrade').hidden = typeof api.openUpgrade !== 'function';
}

function paintReferral(ref, view) {
  const link = ref && typeof ref.link === 'string' ? ref.link : '';
  $('inv-link').textContent = link;
  $('inv-link').title = link;
  $('inv-copy').disabled = !link;
  $('inv-progress').textContent = (ref && typeof ref.line === 'string') ? ref.line : '';
  $('inv-progress').hidden = !$('inv-progress').textContent;
  paintHow(ref && ref.how);
  paintGames(view);
  show('body');
}

/** The account first, then its link. A newer ask makes an older answer paint nothing. */
async function load() {
  const mine = ++ask;
  askedAt = Date.now();
  const view = typeof api.getAccount === 'function' ? await Promise.resolve(api.getAccount()).catch(() => null) : null;
  if (mine !== ask) return;
  if (!view || !view.via) { show('out'); return; }
  // Painted once already, the link stays up while it is asked for again.
  if ($('inv-body').hidden) show('wait');
  const ref = typeof api.getReferral === 'function' ? await Promise.resolve(api.getReferral()).catch(() => null) : null;
  if (mine !== ask) return;
  if (ref && ref.link) { paintReferral(ref, view); return; }
  // A licence key alone may have no account behind it to invite from.
  show(view.via === 'key' ? 'out' : 'error');
}

async function copy() {
  if (typeof api.copyLink !== 'function') return;
  const btn = $('inv-copy');
  const r = await Promise.resolve(api.copyLink()).catch(() => null);
  const done = !!(r && r.ok);
  btn.textContent = done ? 'Copied' : 'Could not copy';
  $('inv-said').textContent = done ? 'Your invite link is copied.' : 'The link could not be copied.';
  clearTimeout(copiedTimer);
  copiedTimer = setTimeout(() => { btn.textContent = 'Copy link'; }, COPIED_MS);
}

$('inv-copy').addEventListener('click', copy);
$('inv-retry').addEventListener('click', () => load());
$('inv-settings').addEventListener('click', () => { if (typeof api.go === 'function') api.go('settings'); });
$('inv-upgrade').addEventListener('click', () => { if (typeof api.openUpgrade === 'function') api.openUpgrade(); });

if (typeof api.onAccount === 'function') api.onAccount(() => load());
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && Date.now() - askedAt > AGAIN_MS) load();
});

load().then(() => console.log('[invite] ready')).catch(() => show('error'));

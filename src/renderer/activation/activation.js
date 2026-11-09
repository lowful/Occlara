'use strict';

/*
 * THE SIGN IN WINDOW (8.7), which was the licence window.
 *
 * Sign in with your browser is the way in: main opens occlara.app, the
 * window waits with a Cancel, and once the browser hands the sign in back
 * main closes this window and opens the app (account-service.js signIn). A
 * licence key is the fallback, the old form exactly as it was, behind Use a
 * licence key. Create a free account opens the sign up page (main names it).
 */

const form     = document.getElementById('form');
const keyInput = document.getElementById('key');
const button   = document.getElementById('activate');
const spinner  = button.querySelector('.spinner');
const check    = button.querySelector('.check');
const errorBox = document.getElementById('error');
// The preload's bridge, or nothing (a screenshot of the page has none).
const bridge = window.occlara || {};
const signinPane  = document.getElementById('signin');
const waitingPane = document.getElementById('waiting');
const signinBtn   = document.getElementById('signin-browser');
// A key in its one shape (key.js). Without that file, a key is still sent
// trimmed and upper cased, as it always was, rather than the box doing nothing.
const KEY = window.OcclaraKey || {
  toKey: (v) => String(v || '').trim().toUpperCase(),
  asTyped: (v) => String(v || '').toUpperCase().replace(/[^A-Z0-9-]/g, ''),
  SHAPE: null,
};

// What a sign in that did not finish says. Cancelled says nothing: the
// player pressed Cancel and knows.
const SIGNIN_ERRORS = {
  timeout: 'The sign in took too long. Try again.',
  refused: 'That sign in was not accepted. Try again.',
  unreachable: 'Occlara could not reach its server. Check your connection and try again.',
  browser: 'Your browser could not be opened. Try again, or use a licence key.',
  listen: 'Sign in could not start on this PC. Try again, or use a licence key.',
};
const SIGNIN_FAILED = 'The sign in did not finish. Try again.';

function showError(msg) {
  errorBox.classList.remove('notice');
  errorBox.textContent = msg;
  errorBox.hidden = false;
  // restart shake animation
  errorBox.style.animation = 'none';
  void errorBox.offsetWidth;
  errorBox.style.animation = '';
}
function clearError() { errorBox.hidden = true; errorBox.classList.remove('notice'); }

// A neutral (non-error) notice, e.g. shown after logout or when a subscription
// runs out. Passed in via the ?notice= query when the window is opened.
function showNotice(msg) {
  errorBox.classList.add('notice');
  errorBox.textContent = msg;
  errorBox.hidden = false;
}
const notice = new URLSearchParams(location.search).get('notice');
if (notice) showNotice(notice);

/** One pane at a time: 'signin', 'waiting' or 'key'. */
let pane = 'signin';
function showPane(which) {
  pane = which;
  signinPane.hidden = which !== 'signin';
  waitingPane.hidden = which !== 'waiting';
  form.hidden = which !== 'key';
  if (which === 'key') keyInput.focus();
  else if (which === 'signin') signinBtn.focus();
  else document.getElementById('cancel').focus();
}

// ── Sign in with your browser ──────────────────────────────────────────────
let signingIn = false;
async function signIn() {
  if (signingIn || typeof bridge.signIn !== 'function') return;
  signingIn = true;
  clearError();
  showPane('waiting');
  let r = null;
  try { r = await bridge.signIn(); } catch { r = { ok: false, error: null }; }
  signingIn = false;
  // Signed in: main closes this window and opens the app.
  if (r && r.ok) return;
  showPane('signin');
  const why = r && r.error;
  if (why !== 'cancelled') showError(SIGNIN_ERRORS[why] || SIGNIN_FAILED);
}
signinBtn.addEventListener('click', signIn);
document.getElementById('cancel').addEventListener('click', () => {
  if (typeof bridge.cancelSignIn === 'function') bridge.cancelSignIn();
});
document.getElementById('use-key').addEventListener('click', () => { clearError(); showPane('key'); });
document.getElementById('back').addEventListener('click', () => { clearError(); showPane('signin'); });

// A sign in already waiting when this window opened (made again while the
// browser was out) is shown as waiting, and goes back once main says it ended.
function followAccount(view) {
  if (!view || signingIn) return;
  if (view.pending && pane !== 'waiting') showPane('waiting');
  else if (!view.pending && pane === 'waiting') showPane('signin');
}
if (typeof bridge.getAccount === 'function') {
  Promise.resolve(bridge.getAccount()).then(followAccount).catch(() => {});
}
if (typeof bridge.onAccount === 'function') bridge.onAccount(followAccount);

// ── A licence key, the old form unchanged ──────────────────────────────────
function setState(stateName) {
  button.classList.toggle('loading', stateName === 'loading');
  button.classList.toggle('success', stateName === 'success');
  spinner.hidden = stateName !== 'loading';
  check.hidden   = stateName !== 'success';
  const busy = stateName === 'loading' || stateName === 'success';
  button.disabled = busy;
  keyInput.disabled = busy;
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  clearError();
  // Put in its one shape before it is sent, GC- and four groups of four, from
  // however it was typed or pasted: lower case, without the GC-, with spaces.
  // The box shows what was sent.
  const key = KEY.toKey(keyInput.value);
  if (key !== keyInput.value) keyInput.value = key;
  if (!key) { showError('Enter your licence key.'); return; }

  setState('loading');
  try {
    const result = await bridge.activate(key);
    if (result && result.valid) {
      setState('success'); // main process closes this window and launches the app
      return;
    }
    setState('idle');
    showError((result && result.error) || 'That key could not be activated.');
  } catch (err) {
    setState('idle');
    showError('The key was not checked. Check your connection and try again.');
  }
});

// Normalize key entry: uppercase and strip stray characters, without fighting
// the caret (only rewrites when the cursor is at the end) or an input method
// still composing. A whole key pasted is put in its one shape at once, so the
// box shows the key that will be sent.
keyInput.addEventListener('input', (e) => {
  if (e && e.isComposing) return;
  if (keyInput.selectionStart !== keyInput.value.length) return;
  if (e && e.inputType === 'insertFromPaste' && KEY.SHAPE) {
    const whole = KEY.toKey(keyInput.value);
    if (KEY.SHAPE.test(whole)) { keyInput.value = whole; return; }
  }
  const normalized = KEY.asTyped(keyInput.value);
  if (normalized !== keyInput.value) keyInput.value = normalized;
});

// Create a free account: occlara.app/signup, which main opens.
document.getElementById('purchase').addEventListener('click', () => bridge.openPurchase());
document.getElementById('close').addEventListener('click', () => bridge.quit());

signinBtn.focus();

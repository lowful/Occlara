'use strict';

const form     = document.getElementById('form');
const keyInput = document.getElementById('key');
const button   = document.getElementById('activate');
const spinner  = button.querySelector('.spinner');
const check    = button.querySelector('.check');
const errorBox = document.getElementById('error');
// A key in its one shape (key.js). Without that file, a key is still sent
// trimmed and upper cased, as it always was, rather than the box doing nothing.
const KEY = window.OcclaraKey || {
  toKey: (v) => String(v || '').trim().toUpperCase(),
  asTyped: (v) => String(v || '').toUpperCase().replace(/[^A-Z0-9-]/g, ''),
  SHAPE: null,
};

keyInput.focus();

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
  if (!key) { showError('Enter your license key.'); return; }

  setState('loading');
  try {
    const result = await window.occlara.activate(key);
    if (result && result.valid) {
      setState('success'); // main process closes this window and launches the app
      return;
    }
    setState('idle');
    showError((result && result.error) || 'That key could not be activated.');
  } catch (err) {
    setState('idle');
    showError('Something went wrong. Please try again.');
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

document.getElementById('purchase').addEventListener('click', () => window.occlara.openPurchase());
document.getElementById('close').addEventListener('click', () => window.occlara.quit());

'use strict';

/*
 * REPORT A PROBLEM (docs/claude/feedback.md). The player picks a kind, says
 * what went wrong in their own words, adds up to three pictures (the picker,
 * a paste or a drop) and sends it.
 *
 * Every sentence the page says for an answer is main's (`said`, from
 * src/shared/feedback.js through FEEDBACK_INFO and each answer), and every
 * picture is main's to check, downscale and recompress (FEEDBACK_PREPARE):
 * the page reads the file and hands its bytes over, and gets a token and a
 * small preview back. A WebP is drawn to PNG first (at most 1600 px on its
 * long side), since main's decoder reads PNG and JPEG only. The page names
 * no URL and counts only the characters typed.
 *
 * Main answers null and refuses everything mid match, and the seal hides
 * this page then, so nothing here is on screen while a match is played.
 */

const $ = (id) => document.getElementById(id);
const api = window.occlara || {};

// Before main's info arrives: the same numbers, so the page is never stuck.
let info = {
  limits: { min: 10, max: 4000, images: 3, fileBytes: 5 * 1024 * 1024, types: ['image/png', 'image/jpeg', 'image/webp'] },
  said: {},
  review: null,
};
let kind = 'broke';
let withReview = false;
let pics = [];          // [{ token, preview }]
let adding = 0;         // pictures being read and prepared
let sending = false;
const LONG_SIDE = 1600;

const saidOf = (r, fallback) => (r && typeof r.said === 'string' && r.said) || info.said[fallback] || 'Report not sent. Check your connection and try again.';

function setSaid(id, text, bad) {
  const el = $(id);
  el.textContent = text || '';
  el.classList.toggle('bad', !!bad && !!text);
}

function textLength() { return $('fb-text').value.trim().length; }

function paintCount() {
  const n = $('fb-text').value.length;
  const max = info.limits.max;
  $('fb-count').textContent = `${n} of ${max}`;
  $('fb-count').classList.toggle('over', n > max);
  paintSend();
}

function paintSend() {
  const n = textLength();
  $('fb-send').disabled = sending || adding > 0 || n < info.limits.min || n > info.limits.max || info.signedIn === false;
  $('fb-send').textContent = sending ? 'Sending' : 'Send report';
}

// The kind is a row of words, one radio group (8.8): the chosen one checked
// and the one tab stop, the arrow keys moving the choice.
function paintKind() {
  for (const b of $('fb-kind').querySelectorAll('button')) {
    const on = b.dataset.kind === kind;
    b.setAttribute('aria-checked', String(on));
    b.setAttribute('tabindex', on ? '0' : '-1');
    b.classList.toggle('active', on);
    if (!b.dataset.text) b.dataset.text = b.textContent;
  }
}

function paintReview() {
  const r = info.review;
  $('fb-review-sec').hidden = !(r && r.id);
  $('fb-review-line').textContent = r && r.line ? r.line : '';
  for (const b of $('fb-review').querySelectorAll('button')) b.setAttribute('aria-pressed', String((b.dataset.review === 'on') === withReview));
}

function paintPics() {
  const list = $('fb-pics');
  list.replaceChildren(...pics.map((p, i) => {
    const li = document.createElement('li');
    li.className = 'fb-pic';
    const img = document.createElement('img');
    img.src = p.preview;
    img.alt = `Picture ${i + 1}`;
    const rm = document.createElement('button');
    rm.type = 'button';
    rm.className = 'btn btn-link sm';
    rm.textContent = 'Remove';
    rm.setAttribute('aria-label', `Remove picture ${i + 1}`);
    rm.addEventListener('click', () => {
      pics = pics.filter((x) => x.token !== p.token);
      if (typeof api.drop === 'function') Promise.resolve(api.drop(p.token)).catch(() => {});
      paintPics();
    });
    li.append(img, rm);
    return li;
  }));
  list.hidden = !pics.length;
  const full = pics.length + adding >= info.limits.images;
  $('fb-drop').classList.toggle('full', full);
  $('fb-pick').disabled = full;
  paintSend();
}

function paintInfo() {
  $('fb-what').textContent = info.whatIsSent || '';
  $('fb-never').textContent = info.neverSent || '';
  const facts = [info.version ? `Occlara ${info.version}` : null, info.os || null, info.gameLabel || null].filter(Boolean);
  $('fb-facts').textContent = facts.join(', ');
  $('fb-text').maxLength = info.limits.max;
  const out = info.signedIn === false;
  $('fb-out').hidden = !out;
  $('fb-out').textContent = out ? (info.said.auth || '') : '';
  $('fb-settings').hidden = !out;
  paintReview();
  paintCount();
  paintPics();
}

/** A WebP drawn to a PNG main can read, at most LONG_SIDE on its long side. */
async function webpToPng(file) {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, LONG_SIDE / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(bmp.width * scale));
  c.height = Math.max(1, Math.round(bmp.height * scale));
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  if (typeof bmp.close === 'function') bmp.close();
  const blob = await new Promise((resolve) => c.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('png');
  return blob.arrayBuffer();
}

async function addFiles(list) {
  const files = [...(list || [])].filter(Boolean);
  if (!files.length) return;
  setSaid('fb-pic-said', '');
  for (const file of files) {
    if (pics.length + adding >= info.limits.images) { setSaid('fb-pic-said', info.said.many, true); break; }
    if (!info.limits.types.includes(file.type)) { setSaid('fb-pic-said', info.said.type, true); continue; }
    if (file.size > info.limits.fileBytes) { setSaid('fb-pic-said', info.said.size, true); continue; }
    if (typeof api.prepare !== 'function') return;
    adding++;
    paintPics();
    try {
      const bytes = file.type === 'image/webp' ? await webpToPng(file) : await file.arrayBuffer();
      const r = await Promise.resolve(api.prepare({ type: file.type, size: file.size, bytes })).catch(() => null);
      if (r && r.ok && r.token) pics.push({ token: r.token, preview: r.preview });
      else setSaid('fb-pic-said', saidOf(r, 'image'), true);
    } catch {
      setSaid('fb-pic-said', info.said.image, true);
    } finally {
      adding--;
      paintPics();
    }
  }
}

async function send(e) {
  if (e) e.preventDefault();
  if ($('fb-send').disabled || typeof api.send !== 'function') return;
  sending = true;
  setSaid('fb-said', '');
  paintSend();
  const r = await Promise.resolve(api.send({ kind, text: $('fb-text').value, tokens: pics.map((p) => p.token), withReview }))
    .catch(() => null);
  sending = false;
  if (r && r.ok) {
    $('fb-done-said').textContent = saidOf(r, 'sent');
    $('fb-done-id').textContent = typeof r.id === 'string' ? r.id.slice(0, 8) : '';
    $('fb-done-id').title = typeof r.id === 'string' ? r.id : '';
    $('fb-form').hidden = true;
    $('fb-done').hidden = false;
    pics = [];
    paintPics();
    return;
  }
  setSaid('fb-said', saidOf(r, 'later'), true);
  paintSend();
}

function again() {
  $('fb-text').value = '';
  kind = 'broke';
  withReview = false;
  pics = [];
  setSaid('fb-said', '');
  setSaid('fb-pic-said', '');
  paintKind();
  $('fb-done').hidden = true;
  $('fb-form').hidden = false;
  paintInfo();
  load();
}

async function load() {
  const got = typeof api.info === 'function' ? await Promise.resolve(api.info()).catch(() => null) : null;
  if (got && typeof got === 'object') {
    info = { ...info, ...got, limits: { ...info.limits, ...(got.limits || {}) }, said: { ...(got.said || {}) } };
    // A review gone from the library since is no longer offered.
    if (!info.review) withReview = false;
  }
  paintInfo();
}

// ── wiring ─────────────────────────────────────────────────────────────────
$('fb-kind').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-kind]');
  if (!b) return;
  kind = b.dataset.kind;
  paintKind();
});
$('fb-kind').addEventListener('keydown', (e) => {
  const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1, Home: 'first', End: 'last' }[e.key];
  if (step === undefined) return;
  const all = [...$('fb-kind').querySelectorAll('button')];
  const at = all.findIndex((b) => b.dataset.kind === kind);
  const next = step === 'first' ? all[0] : step === 'last' ? all[all.length - 1] : all[((at < 0 ? 0 : at + step) + all.length) % all.length];
  if (typeof e.preventDefault === 'function') e.preventDefault();
  if (!next) return;
  next.click();
  if (typeof next.focus === 'function') next.focus();
});
$('fb-review').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-review]');
  if (!b) return;
  withReview = b.dataset.review === 'on';
  paintReview();
});
$('fb-text').addEventListener('input', paintCount);
$('fb-pick').addEventListener('click', () => $('fb-file').click());
$('fb-file').addEventListener('change', () => {
  const files = [...($('fb-file').files || [])];
  $('fb-file').value = '';
  addFiles(files);
});
// Paste: a picture on the clipboard is added; text pastes into the field as usual.
document.addEventListener('paste', (e) => {
  const items = e.clipboardData ? [...e.clipboardData.items] : [];
  const files = items.filter((i) => i.kind === 'file').map((i) => i.getAsFile()).filter(Boolean);
  if (!files.length) return;
  e.preventDefault();
  addFiles(files);
});
// Drop: anywhere on the page, the drop target showing it takes them.
const drop = $('fb-drop');
let dragDepth = 0;
const hasFiles = (e) => !!(e.dataTransfer && [...(e.dataTransfer.types || [])].includes('Files'));
document.addEventListener('dragenter', (e) => { if (!hasFiles(e)) return; e.preventDefault(); dragDepth++; drop.classList.add('over'); });
document.addEventListener('dragover', (e) => { if (!hasFiles(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
document.addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) drop.classList.remove('over'); });
document.addEventListener('drop', (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  dragDepth = 0;
  drop.classList.remove('over');
  addFiles(e.dataTransfer.files);
});
$('fb-form').addEventListener('submit', send);
$('fb-again').addEventListener('click', again);
$('fb-home').addEventListener('click', () => { if (typeof api.go === 'function') api.go('home'); });
$('fb-settings').addEventListener('click', () => { if (typeof api.go === 'function') api.go('settings'); });

if (typeof window.occlaraSeg === 'function') {
  window.occlaraSeg($('fb-review'));
}
// Back to the front, asked again: the last review may have changed.
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') load(); });

paintKind();
paintInfo();
load().then(() => console.log('[feedback] ready')).catch(() => {});

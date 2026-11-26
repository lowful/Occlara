'use strict';

/*
 * THE PROFILE PAGE (8.8). The games left as the hero, buying more games,
 * three figures of the player's own Valorant play, and the plans.
 *
 * Every line is main's: the page comes built from profile.js (PROFILE_GET),
 * and the buy button's words as the number changes are profile.js quote and
 * step, handed through the preload. This page counts nothing and names no
 * URL: Buy asks main, which opens the site's checkout only for a whole number
 * from 1 to 500, and See plan asks main for the pricing page. Signed out, the
 * same button signs in first.
 *
 * Main answers null mid match, and the seal hides this page then, so nothing
 * here is ever on screen mid match.
 */

const $ = (id) => document.getElementById(id);
const api = window.occlara || {};

// Asked again when the page comes back to the front, at most this often: a
// player back from the checkout sees the games they bought.
const AGAIN_MS = 30 * 1000;

let ask = 0;
let askedAt = 0;
let model = null;
let billing = 'monthly';
let segsReady = false;

/*
 * MOTION (8.9.2, shared/motion.js). The games left count up and the plans
 * rise once per visit of the page, only once it is on screen; a refresh (an
 * account push, a review saved) paints them as they are. Nothing moves under
 * reduced motion.
 */
const Mo = window.Motion || null;

/** The field's number moved by the stepper: it eases in from the side it came. */
function nudge(el, by) {
  if (!Mo || Mo.reduced() || !el) return;
  el.classList.remove('pr-nudge-up', 'pr-nudge-down');
  void el.offsetWidth;
  el.classList.add(by > 0 ? 'pr-nudge-up' : 'pr-nudge-down');
}

function show(which) {
  $('pr-wait').hidden = which !== 'wait';
  $('pr-body').hidden = which !== 'body';
}

function quoteOf(v) {
  return typeof api.quote === 'function' ? api.quote(v) : { ok: false, n: null, label: 'Buy games', note: '' };
}

// ── The hero ────────────────────────────────────────────────────────────────
function paintHero(h) {
  const games = h.state === 'games';
  $('pr-hero').classList.toggle('has-number', games);
  $('pr-count').hidden = !games;
  $('pr-number').textContent = games ? h.number : '';
  // The games left count up to their number, once per visit (tabular figures).
  if (games && Mo && Number.isFinite(Number(h.number)) && String(h.number).trim() !== '' && Mo.once($('pr-number'), 'count') && !Mo.reduced()) {
    Mo.whenShown(() => {
      if (Mo.reduced()) return;
      const el = $('pr-number');
      const v = Number(el.textContent);
      if (!Number.isInteger(v) || v < 0) { if (Number.isFinite(v)) Mo.countUp(el, v); return; }
      // A whole number is counted in CSS over its real text (profile.css .m-counting).
      el.style.setProperty('--to', String(v));
      el.classList.add('m-counting');
      setTimeout(() => el.classList.remove('m-counting'), 800 + 120);
    });
  }
  $('pr-unit').textContent = games ? h.unit : '';
  $('pr-plan').textContent = h.plan || '';
  $('pr-split').textContent = h.split || '';
  $('pr-split').hidden = !h.split;
  $('pr-renew').textContent = h.renew || '';
  $('pr-renew').hidden = !h.renew;
  $('pr-retry').hidden = h.state !== 'error';
}

// ── Buying games ────────────────────────────────────────────────────────────
function paintPicks(picks) {
  const row = $('pr-picks');
  const list = Array.isArray(picks) ? picks : [];
  row.replaceChildren(...list.map((p) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.games = String(p.n);
    b.textContent = p.label;
    b.setAttribute('aria-label', p.aria || p.label);
    b.setAttribute('aria-pressed', 'false');
    b.addEventListener('click', () => { $('pr-games').value = String(p.n); paintBuy(); });
    return b;
  }));
}

/** The button, the note and the chosen pick, for the number in the field. */
function paintBuy() {
  if (!model) return;
  const q = quoteOf($('pr-games').value);
  const out = !model.signedIn;
  const buy = model.buy || {};
  $('pr-buy').textContent = out ? buy.signIn : q.label;
  $('pr-buy').disabled = !out && !q.ok;
  $('pr-note').textContent = q.note || (out ? buy.signInNote : buy.checkout) || '';
  for (const b of $('pr-picks').children) {
    if (b.tagName !== 'BUTTON') continue;
    b.setAttribute('aria-pressed', String(!!q.ok && b.dataset.games === String(q.n)));
  }
}

/** The field settles on the number the button would buy, once the player leaves it. */
function settleField() {
  const q = quoteOf($('pr-games').value);
  if (q.ok) $('pr-games').value = String(q.n);
  paintBuy();
}

function stepBy(by) {
  if (typeof api.step !== 'function') return;
  const before = $('pr-games').value;
  $('pr-games').value = String(api.step($('pr-games').value, by));
  if ($('pr-games').value !== before) nudge($('pr-games'), by);
  paintBuy();
}

async function buy() {
  if (!model) return;
  if (!model.signedIn) {
    if (typeof api.signIn !== 'function') return;
    $('pr-buy').disabled = true;
    const r = await Promise.resolve(api.signIn()).catch(() => null);
    $('pr-buy').disabled = false;
    if (r && r.ok) load();
    return;
  }
  const q = quoteOf($('pr-games').value);
  if (!q.ok || typeof api.buy !== 'function') return;
  const r = await Promise.resolve(api.buy(q.n)).catch(() => null);
  const said = r && r.ok ? 'Checkout opened in your browser.' : 'The checkout could not be opened. Try again.';
  $('pr-note').textContent = said;
  $('pr-said').textContent = said;
}

// ── The player's play ──────────────────────────────────────────────────────
function paintPlay(play) {
  $('pr-play-title').textContent = play.title || '';
  $('pr-figs').replaceChildren(...(Array.isArray(play.figures) ? play.figures : []).map((f) => {
    const box = document.createElement('div');
    box.className = f.empty ? 'pr-fig empty' : 'pr-fig';
    const dt = document.createElement('dt');
    dt.className = 'pr-fig-l';
    dt.textContent = f.label;
    const dd = document.createElement('dd');
    dd.className = 'pr-fig-v';
    dd.textContent = f.value || '';
    dd.hidden = !f.value;
    // Most used weapon: the gun's kill feed icon main named (profile.js
    // weaponFigure, kit-icons.js), bundled under assets/, beside its name.
    if (f.value && typeof f.icon === 'string' && /^valorant\/weapons\/[A-Za-z0-9]+\.png$/.test(f.icon)) {
      const name = document.createElement('span');
      name.className = 'pr-fig-name';
      name.textContent = f.value;
      const img = document.createElement('img');
      img.className = 'pr-fig-gun';
      img.src = '../../../assets/' + f.icon;
      img.alt = f.value;
      img.title = f.value;
      img.addEventListener('error', () => img.remove());
      dd.classList.add('has-icon');
      dd.replaceChildren(name, img);
    }
    const sample = document.createElement('dd');
    sample.className = 'pr-fig-s';
    sample.textContent = f.sample || '';
    box.append(dt, dd, sample);
    return box;
  }));
}

// ── The plans ──────────────────────────────────────────────────────────────
function paintPlans(plans) {
  const items = plans && Array.isArray(plans.items) ? plans.items : [];
  $('pr-plans').replaceChildren(...items.map((p) => {
    const li = document.createElement('li');
    li.className = p.mine ? 'pr-plan-row mine' : 'pr-plan-row';
    const name = document.createElement('span');
    name.className = 'pr-plan-name';
    name.textContent = p.label;
    if (p.mine) {
      const tag = document.createElement('span');
      tag.className = 'pr-mine';
      tag.textContent = 'Your plan';
      name.append(tag);
    }
    const price = document.createElement('span');
    price.className = 'pr-price';
    const amount = document.createElement('span');
    amount.className = 'pr-amount';
    amount.textContent = billing === 'yearly' ? p.yearly : p.monthly;
    const per = document.createElement('span');
    per.className = 'pr-per';
    per.textContent = billing === 'yearly' ? p.yearlyPer : p.monthlyPer;
    price.append(amount, per);
    const games = document.createElement('span');
    games.className = 'pr-plan-games';
    games.textContent = p.games;
    const act = document.createElement('span');
    act.className = 'pr-plan-act';
    if (p.action) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn btn-ghost sm';
      b.textContent = p.action;
      b.addEventListener('click', () => { if (typeof api.openPlans === 'function') api.openPlans(); });
      act.append(b);
    }
    li.append(name, price, games, act);
    return li;
  }));
}

function setBilling(which) {
  billing = which === 'yearly' ? 'yearly' : 'monthly';
  $('pr-monthly').setAttribute('aria-pressed', String(billing === 'monthly'));
  $('pr-yearly').setAttribute('aria-pressed', String(billing === 'yearly'));
  if (model) { paintPlans(model.plans); paintGiftOffers(model.gifts); }
  // What changed is the prices: they fade in where they stand (profile.css).
  if (model && Mo && !Mo.reduced()) {
    for (const a of document.querySelectorAll('#pr-plans .pr-amount, #pr-gift-offers .pr-gift-price')) a.classList.add('pr-swap');
  }
}

// ── Gifts (8.8) ────────────────────────────────────────────────────────────
// Gift Pro and Gift Max at the cycle the Plans toggle shows, a field to redeem
// a link or code, and the gifts bought with Copy link. Main opens, redeems and
// copies; signed out, each action signs in first.

async function signInFirst() {
  if (typeof api.signIn !== 'function') return;
  const r = await Promise.resolve(api.signIn()).catch(() => null);
  if (r && r.ok) load();
}

function paintGiftOffers(g) {
  const offers = g && g.offers ? (billing === 'yearly' ? g.offers.yearly : g.offers.monthly) : [];
  $('pr-gift-offers').replaceChildren(...(Array.isArray(offers) ? offers : []).map((o) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn btn-ghost pr-gift';
    b.dataset.offer = o.id;
    b.setAttribute('aria-label', o.aria || o.label);
    const name = document.createElement('span');
    name.className = 'pr-gift-name';
    name.textContent = o.label;
    const price = document.createElement('span');
    price.className = 'pr-gift-price';
    price.textContent = o.price;
    b.append(name, price);
    b.addEventListener('click', () => giftOffer(o.id));
    return b;
  }));
}

async function giftOffer(id) {
  if (!model || !model.gifts) return;
  if (!model.gifts.signedIn) { signInFirst(); return; }
  if (typeof api.gift !== 'function') return;
  const r = await Promise.resolve(api.gift(id)).catch(() => null);
  const said = r && r.ok ? model.gifts.checkout : 'The checkout could not be opened. Try again.';
  $('pr-gift-note').textContent = said;
  $('pr-said').textContent = said;
}

function paintGifts(g) {
  if (!g) return;
  $('pr-gifts-title').textContent = g.title || '';
  $('pr-gifts-hint').textContent = g.signedIn ? (g.hint || '') : (g.signIn || '');
  paintGiftOffers(g);
  $('pr-gift-received').textContent = g.received || '';
  $('pr-gift-received').hidden = !g.received;
  const r = g.redeem || {};
  $('pr-redeem-label').textContent = r.label || '';
  $('pr-redeem-code').placeholder = r.placeholder || '';
  $('pr-redeem-go').textContent = r.button || '';
  const list = Array.isArray(g.bought) ? g.bought : [];
  $('pr-bought-wrap').hidden = !list.length;
  $('pr-bought-title').textContent = g.boughtTitle || '';
  $('pr-bought').replaceChildren(...list.map((x) => {
    const li = document.createElement('li');
    li.className = 'pr-gift-row';
    const what = document.createElement('span');
    what.className = 'pr-gift-what';
    what.textContent = x.what;
    const state = document.createElement('span');
    state.className = 'pr-gift-state';
    state.textContent = x.state;
    const when = document.createElement('span');
    when.className = 'pr-gift-when';
    when.textContent = x.when || '';
    const act = document.createElement('span');
    act.className = 'pr-gift-act';
    if (x.canCopy) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn btn-ghost sm';
      b.textContent = g.copy;
      b.addEventListener('click', async () => {
        if (typeof api.copyGift !== 'function') return;
        const c = await Promise.resolve(api.copyGift(x.id)).catch(() => null);
        if (c && c.ok) {
          b.textContent = g.copied;
          $('pr-said').textContent = g.copied;
          setTimeout(() => { b.textContent = g.copy; }, 2000);
        }
      });
      act.append(b);
    }
    li.append(what, state, when, act);
    return li;
  }));
}

async function redeem(e) {
  if (e) e.preventDefault();
  if (!model || !model.gifts) return;
  if (!model.gifts.signedIn) { signInFirst(); return; }
  const text = $('pr-redeem-code').value;
  if (!text.trim() || typeof api.redeemGift !== 'function') return;
  $('pr-redeem-go').disabled = true;
  const r = await Promise.resolve(api.redeemGift(text)).catch(() => null);
  $('pr-redeem-go').disabled = false;
  const said = (r && r.said) || 'The gift could not be redeemed just now. Try again.';
  $('pr-redeem-said').textContent = said;
  $('pr-said').textContent = said;
  if (r && r.ok) { $('pr-redeem-code').value = ''; load(); }
}

// ── The page ───────────────────────────────────────────────────────────────
function paint(m) {
  const first = !model;
  model = m;
  paintHero(m.hero || {});
  $('pr-rate').textContent = (m.buy && m.buy.rate) || '';
  if (first) {
    paintPicks(m.buy && m.buy.picks);
    $('pr-games').value = m.buy && m.buy.start && m.buy.start.ok ? String(m.buy.start.n) : '';
  }
  paintBuy();
  paintPlay(m.play || {});
  if (m.plans) {
    $('pr-monthly').textContent = m.plans.monthly || 'Monthly';
    $('pr-yearly').textContent = m.plans.yearly || 'Yearly';
  }
  paintPlans(m.plans);
  paintGifts(m.gifts);
  show('body');
  // The plans rise one after another, once per visit (motion.css .m-stagger).
  if (Mo && m.plans) Mo.stagger($('pr-plans'), 'rows');
  if (!segsReady && typeof window.occlaraSeg === 'function') {
    segsReady = true;
    window.occlaraSeg($('pr-picks'));
    window.occlaraSeg($('pr-billing'));
  }
}

/** The page from main. A newer ask makes an older answer paint nothing. */
async function load() {
  const mine = ++ask;
  askedAt = Date.now();
  // Painted once already, the page stays up while it is asked for again.
  if (!model) show('wait');
  const m = typeof api.getProfile === 'function' ? await Promise.resolve(api.getProfile()).catch(() => null) : null;
  if (mine !== ask) return;
  if (!m || !m.hero) {
    // Null only mid match, when the seal hides this page. Anything else that
    // is not a page is a failure, said as one.
    if (!model && m) $('pr-wait').textContent = 'Your profile could not be loaded. Open it again in a moment.';
    return;
  }
  paint(m);
  paintWrapped();
  loadSocial();
}

/*
 * YOUR YEAR (docs/claude/wrapped.md): Occlara Wrapped's entry, main's words
 * as they are (wrapped.js entryOf), shown in its window and after it; a year
 * without enough matches says so with no button. Null hides the section.
 */
let wrappedAsk = 0;
async function paintWrapped() {
  const mine = ++wrappedAsk;
  const e = typeof api.getWrapped === 'function' ? await Promise.resolve(api.getWrapped()).catch(() => null) : null;
  if (mine !== wrappedAsk) return;
  const sec = $('pr-wrapped');
  if (!e || typeof e.line !== 'string') { sec.hidden = true; return; }
  $('pr-wrapped-line').textContent = e.line;
  const b = $('pr-wrapped-open');
  b.hidden = !e.button;
  b.textContent = e.button || '';
  b.dataset.year = String(e.year);
  sec.hidden = false;
}
$('pr-wrapped-open').addEventListener('click', async () => {
  const y = Number($('pr-wrapped-open').dataset.year);
  const r = await Promise.resolve(api.openWrapped(Number.isInteger(y) ? y : null)).catch(() => null);
  $('pr-wrapped-said').textContent = r && r.ok ? '' : r && r.error === 'thin' ? 'Not enough matches for this year yet.' : 'Wrapped could not open. Try again in a moment.';
});

/*
 * PUBLIC PROFILE (docs/claude/social.md): a username (checked as it is typed,
 * a moment after the last key), the public switch and what it shows, the
 * Riot ID's verification in plain words, a preview and being discoverable.
 * Every line is main's (social.js); the section stays hidden until the
 * server says player search is open, and main answers null mid match.
 */
let social = null;
let socialAsk = 0;
let nameTimer = null;
let nameAsk = 0;
let socialSegs = false;
const NAME_WAIT_MS = 450;

function setSeg(id, on, disabled) {
  for (const b of $(id).querySelectorAll('button')) {
    b.setAttribute('aria-pressed', String((b.dataset.val === 'on') === !!on));
    b.disabled = !!disabled;
  }
}

function socialOut(line, action) {
  $('pr-social-out').hidden = !line;
  $('pr-social-out-line').textContent = line || '';
  const b = $('pr-social-out-act');
  b.hidden = !action;
  b.textContent = action ? action.label : '';
  b.onclick = action ? action.fn : null;
}

function paintSocial(s) {
  const sec = $('pr-social');
  // Not open yet (the SQL has not run), not known (no account to ask with,
  // the server out of reach) or no answer at all: nothing is offered.
  if (!s || s.live !== true) { sec.hidden = true; return; }
  sec.hidden = false;
  social = s;
  const w = s.words || {};
  if (s.problem === 'signed-out' || s.signedIn === false) {
    $('pr-social-body').hidden = true;
    socialOut('Sign in to an Occlara account to make a public profile and find other players.', { label: 'Sign in', fn: signInFirst });
    return;
  }
  if (s.problem) {
    $('pr-social-body').hidden = true;
    socialOut(s.problem === 'offline' ? 'Your public profile could not be loaded. Check your connection and try again.'
      : 'Your public profile could not be loaded just now. Try again in a moment.', { label: 'Try again', fn: () => loadSocial() });
    return;
  }
  socialOut(null);
  $('pr-social-body').hidden = false;
  const p = s.profile;
  const named = !!(p && p.username);
  if (document.activeElement !== $('pr-name-input')) $('pr-name-input').value = named ? p.username : '';
  $('pr-name-hint').textContent = w.nameHint || '';
  $('pr-public-hint').textContent = w.publicExplain || '';
  $('pr-public-more').textContent = w.publicMore || '';
  $('pr-disc-hint').textContent = w.discoverExplain || '';
  paintRiot(p, w);
  const verified = !!(named && p.riot && p.riot.state === 'verified');
  $('pr-riot-line').textContent = !named ? 'Pick a username first.'
    : verified ? 'On, your proved Riot ID shows on your profile and finds it in search.' : 'Has effect once you prove your Riot ID above.';
  // Nothing to switch before there is a username.
  setSeg('pr-public', named && p.public, !named);
  setSeg('pr-riot', !named || p.showRiotId, !named);
  setSeg('pr-disc', named && p.discoverable, !named);
  if (!socialSegs && typeof window.occlaraSeg === 'function') {
    socialSegs = true;
    for (const id of ['pr-public', 'pr-riot', 'pr-disc']) window.occlaraSeg($(id));
  }
  const pv = s.preview;
  $('pr-preview').hidden = !(named && pv);
  if (named && pv) {
    $('pr-preview-name').textContent = pv.username;
    $('pr-preview-riot').textContent = pv.riot || (w.riotProof ? 'No Riot ID shown' : '');
    $('pr-preview-riot').classList.toggle('none', !pv.riot);
    const bits = [pv.rank ? pv.rank.current : null, pv.agents[0] ? pv.agents[0].name : null, pv.grade ? `${pv.grade.avg} ${pv.grade.letter}` : null].filter(Boolean);
    $('pr-preview-line').textContent = p.public ? (bits.join(', ') || 'No numbers yet') : 'Private: only you can see it';
  }
  const blocked = p && Array.isArray(p.blocked) ? p.blocked : [];
  $('pr-blocked-wrap').hidden = !blocked.length;
  $('pr-blocked').replaceChildren(...blocked.map((name) => {
    const li = document.createElement('li');
    li.className = 'pr-gift-row';
    const n = document.createElement('span');
    n.className = 'pr-gift-what';
    n.textContent = name;
    const act = document.createElement('span');
    act.className = 'pr-gift-act';
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn btn-ghost sm';
    b.textContent = 'Unblock';
    b.addEventListener('click', async () => {
      b.disabled = true;
      const r = await Promise.resolve(api.unblock(name)).catch(() => null);
      $('pr-flags-said').textContent = (r && r.line) || 'Could not unblock right now. Try again in a moment.';
      if (r && r.ok) loadSocial(); else b.disabled = false;
    });
    act.append(b);
    li.append(n, document.createElement('span'), document.createElement('span'), act);
    return li;
  }));
}

/*
 * THE RIOT ID, PROVED (docs/claude/social.md): the state in plain words, then
 * either step 1 (the Riot ID and Start) or steps 2 and 3 of the open
 * challenge (the two agents with their bundled portraits, the time left,
 * Check and what it found). Every line is main's.
 */
const ART = /^valorant\/agents\/[A-Za-z0-9]+\.png$/;
function paintRiot(p, w) {
  const named = !!(p && p.username);
  // The Riot ID proof is the server's to open (SOCIAL_RIOT_PROOF): closed, no step, no switch, no word of it.
  const proof = !!(w && w.riotProof);
  $('pr-riot-block').hidden = !named || !proof;
  $('pr-riot-opt').hidden = !proof;
  if (!named || !proof) return;
  const r = p.riot || {};
  $('pr-riot-state').textContent = w.riotLine || '';
  const c = p.challenge && p.challenge.status === 'open' ? p.challenge : null;
  const cw = w.challenge || {};
  $('pr-prove').hidden = !!c;
  $('pr-challenge').hidden = !c;
  $('pr-prove-label').textContent = r.state === 'verified' ? 'Prove another Riot ID' : '1. Your Riot ID';
  if (!c) {
    if (!$('pr-prove-id').value && w.riotIdTyped) $('pr-prove-id').value = w.riotIdTyped;
    // The last check that ended (spent or expired) says why, once.
    const ended = p.challenge && p.challenge.status !== 'open' && p.challenge.status !== 'passed' ? (cw.result || null) : null;
    if (ended && !$('pr-prove-said').textContent) $('pr-prove-said').textContent = ended;
    return;
  }
  $('pr-agents').replaceChildren(...c.agents.map((a, i) => {
    const li = document.createElement('li');
    li.className = 'pr-agent';
    const rel = Array.isArray(cw.art) ? cw.art[i] : null;
    if (typeof rel === 'string' && ART.test(rel)) {
      const img = document.createElement('img');
      img.src = `../../../assets/${rel}`;
      img.alt = '';
      img.className = 'pr-agent-img';
      img.addEventListener('error', () => img.remove());
      li.append(img);
    }
    const t = document.createElement('span');
    t.className = 'pr-agent-text';
    const n = document.createElement('span');
    n.className = 'pr-agent-step';
    n.textContent = i === 0 ? 'First match' : i === c.agents.length - 1 ? 'Last match' : 'Then';
    const name = document.createElement('span');
    name.className = 'pr-agent-name';
    name.textContent = a || '';
    t.append(n, name);
    li.append(t);
    return li;
  }));
  $('pr-challenge-riot').textContent = c.riot ? `1. Started for ${c.riot.name}#${c.riot.tag}` : '1. Started';
  $('pr-challenge-plan').textContent = cw.plan || '';
  $('pr-challenge-note').textContent = cw.note || '';
  $('pr-challenge-time').textContent = cw.timeLeft || '';
  if (!$('pr-check-said').textContent && cw.result) $('pr-check-said').textContent = cw.result;
}

$('pr-prove').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (typeof api.riotStart !== 'function') return;
  $('pr-prove-go').disabled = true;
  $('pr-prove-said').textContent = '';
  const r = await Promise.resolve(api.riotStart($('pr-prove-id').value)).catch(() => null);
  $('pr-prove-go').disabled = false;
  if (!r) return;
  if (r.line) $('pr-prove-said').textContent = r.line;
  $('pr-check-said').textContent = '';
  if (r.state) paintSocial(r.state);
});
$('pr-check').addEventListener('click', async () => {
  if (typeof api.riotCheck !== 'function') return;
  $('pr-check').disabled = true;
  $('pr-check-said').textContent = 'Reading Riot\'s record';
  const r = await Promise.resolve(api.riotCheck()).catch(() => null);
  $('pr-check').disabled = false;
  if (!r) { $('pr-check-said').textContent = ''; return; }
  $('pr-check-said').textContent = r.line || '';
  if (r.ok) $('pr-prove-said').textContent = r.line || '';
  if (r.state) paintSocial(r.state);
});

async function loadSocial() {
  if (typeof api.socialState !== 'function') return;
  const mine = ++socialAsk;
  const s = await Promise.resolve(api.socialState()).catch(() => null);
  if (mine !== socialAsk) return;
  if (s === null) return;   // mid match: the seal hides the page
  paintSocial(s);
}

function nameSaid(line, kind) {
  const el = $('pr-name-said');
  el.textContent = line || '';
  el.classList.toggle('good', kind === 'good');
  el.classList.toggle('bad', kind === 'bad');
}

$('pr-name-input').addEventListener('input', () => {
  clearTimeout(nameTimer);
  const v = $('pr-name-input').value.trim();
  const mineNow = social && social.profile && social.profile.username;
  if (!v || v === mineNow) { nameSaid(''); return; }
  nameSaid('Checking');
  nameTimer = setTimeout(async () => {
    const mine = ++nameAsk;
    const r = typeof api.checkName === 'function' ? await Promise.resolve(api.checkName(v)).catch(() => null) : null;
    if (mine !== nameAsk || !r) return;
    nameSaid(r.line, r.ok ? 'good' : 'bad');
  }, NAME_WAIT_MS);
});
$('pr-name').addEventListener('submit', async (e) => {
  e.preventDefault();
  clearTimeout(nameTimer);
  nameAsk++;
  const v = $('pr-name-input').value.trim();
  if (!v || typeof api.setName !== 'function') return;
  $('pr-name-save').disabled = true;
  const r = await Promise.resolve(api.setName(v)).catch(() => null);
  $('pr-name-save').disabled = false;
  if (!r) return;
  nameSaid(r.line, r.ok ? 'good' : 'bad');
  if (r.ok && r.state) paintSocial(r.state);
});

async function flag(key, on) {
  if (typeof api.setFlags !== 'function') return;
  const ids = ['pr-public', 'pr-riot', 'pr-disc'];
  for (const id of ids) for (const b of $(id).querySelectorAll('button')) b.disabled = true;
  $('pr-flags-said').textContent = '';
  const r = await Promise.resolve(api.setFlags({ [key]: on })).catch(() => null);
  if (r) $('pr-flags-said').textContent = r.line || '';
  if (r && r.state) paintSocial(r.state); else loadSocial();
}
for (const [id, key] of [['pr-public', 'public'], ['pr-riot', 'showRiotId'], ['pr-disc', 'discoverable']]) {
  for (const b of $(id).querySelectorAll('button')) {
    b.addEventListener('click', () => {
      if (b.disabled || b.getAttribute('aria-pressed') === 'true') return;
      flag(key, b.dataset.val === 'on');
    });
  }
}
$('pr-find').addEventListener('click', () => { if (typeof api.openPlayers === 'function') api.openPlayers(''); });
$('pr-preview-open').addEventListener('click', () => {
  const p = social && social.profile;
  if (p && p.username && typeof api.openPlayers === 'function') api.openPlayers(p.username);
});
if (typeof api.onSocial === 'function') api.onSocial((m) => { if (!m || !m.open) loadSocial(); });

$('pr-games').addEventListener('input', paintBuy);
$('pr-games').addEventListener('change', settleField);
$('pr-games').addEventListener('keydown', (e) => {
  if (e.key === 'ArrowUp') { e.preventDefault(); stepBy(1); }
  else if (e.key === 'ArrowDown') { e.preventDefault(); stepBy(-1); }
  else if (e.key === 'Enter') { e.preventDefault(); settleField(); buy(); }
});
$('pr-less').addEventListener('click', () => stepBy(-1));
$('pr-more').addEventListener('click', () => stepBy(1));
$('pr-buy').addEventListener('click', buy);
$('pr-retry').addEventListener('click', () => load());
$('pr-monthly').addEventListener('click', () => setBilling('monthly'));
$('pr-yearly').addEventListener('click', () => setBilling('yearly'));
$('pr-redeem').addEventListener('submit', redeem);

if (typeof api.onAccount === 'function') api.onAccount(() => load());
if (typeof api.onReviews === 'function') api.onReviews(() => load());
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && Date.now() - askedAt > AGAIN_MS) load();
});

load().then(() => console.log('[profile] ready')).catch(() => show('wait'));

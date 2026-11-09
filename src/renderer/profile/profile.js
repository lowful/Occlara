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
  $('pr-games').value = String(api.step($('pr-games').value, by));
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
}

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

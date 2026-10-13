'use strict';
const express = require('express');
const router  = express.Router();
// One password check for every admin route: the header only, compared in
// constant time, and failures are rate limited in server.js. See admin-auth.js.
const { isAdmin } = require('../services/admin-auth');
const { presence, hashOf } = require('../services/presence');
const supabase = require('../db/supabase');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const {
  LICENCE_ENDED, LICENCE_REVOKED, SUB_ENDED, expiryFor, failingExpiryFor, licenceStatusOf, dbError,
} = require('../services/billing');

/**
 * GET /api/admin/coaching
 *
 * How the coach is performing across everyone using it, in counts only.
 *
 * The question this answers is "is a release making the coaching better or
 * worse", which until now could only be answered from one machine: the AI
 * decision log lives on the player's own PC and never leaves it. That stays
 * true. What comes back here is how many tips were shown, how many the model
 * wrote, and which KIND of gate stopped the rest. No frames, no tip text, no
 * map, no agent, no identity beyond an 8 character hash of the licence.
 *
 * The reject histogram is the valuable part: repetition being 74% of all
 * rejections is the sort of thing that is obvious in aggregate and invisible in
 * any single session.
 */
router.get('/coaching', (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });
  try {
    res.json(require('./coach').telemetry.summary());
  } catch (e) {
    res.status(500).json({ error: 'Telemetry unavailable' });
  }
});

// GET /api/admin/costs
// Protected by ADMIN_PASSWORD env var, sent as the X-Admin-Password header
// Returns cost tracking data from the coach module
//
// WHAT THE MODEL CALLS COST (8.3.1). `spend` is the provider's own figure for
// every call, today and this month, by route (read, forensics, review, chat,
// other): `real` what OpenRouter said each call cost, `estimated` the
// flat price for the calls it said nothing about (another provider, a call
// aborted at its deadline), `cost` the two together, `priced` how many calls
// carried a cost of their own. `global` is the calls as the routes count them
// and the flat estimate beside them, as before; `topUsers` carries each
// licence's spend too. All of it since the process started (`since`).
router.get('/costs', (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });

  // Lazy-require to avoid circular deps
  let coachModule;
  try {
    coachModule = require('./coach');
  } catch (e) {
    return res.status(500).json({ error: 'Cost data unavailable' });
  }

  const { costStore, globalStats, costs } = coachModule;
  const spend = costs.report(null);

  // Top 10 by calls today. Each user is the same 8 character hash the live
  // view shows, so a row here can be matched to a person there, and no part of
  // a licence key leaves the server: this used to print its first 8 characters.
  const byKey = [];
  for (const [key, stats] of costStore.entries()) {
    const own = costs.report(String(key).trim().toUpperCase());
    byKey.push({ user: hashOf(String(key).trim().toUpperCase()), callsToday: stats.callsToday, callsMonth: stats.callsMonth,
      costToday: own.today.cost, costMonth: own.month.cost,
      estCostToday: +stats.costToday.toFixed(4), estCostMonth: +stats.costMonth.toFixed(4),
      spendToday: own.today, spendMonth: own.month });
  }
  byKey.sort((a, b) => b.callsToday - a.callsToday);

  res.json({
    global: {
      callsToday:  globalStats.callsToday,
      callsMonth:  globalStats.callsMonth,
      costToday:   spend.today.cost,
      costMonth:   spend.month.cost,
      estCostToday:  '$' + globalStats.costToday.toFixed(4),
      estCostMonth:  '$' + globalStats.costMonth.toFixed(4),
    },
    spend: { today: spend.today, month: spend.month, routes: costs.routes, flatPerCall: costs.perCall,
      asksProvider: costs.asking() },
    topUsers: byKey.slice(0, 10),
    since: costs.since,
    asOf: new Date().toISOString(),
  });
});

/**
 * GET /api/admin/live
 *
 * Who is using Occlara right now: recording a match, reviewing one, or just
 * with the app open, plus everyone seen today, and how the server is doing
 * (when it started, memory, the routes that are failing, the last errors).
 * Built by services/presence.js from the requests the clients already make.
 *
 * The emails come from Supabase, looked up from the licence and remembered for
 * ten minutes. This is the only place they are shown, behind the admin password.
 */
const WHO_MS = 10 * 60 * 1000;
const WHO_BATCH = 100;      // licence keys asked about per lookup
const WHO_PARALLEL = 8;     // account lookups in flight at once
const who = new Map();      // hash -> { email, plan, at }
let resolving = null;       // the lookup in flight, shared by overlapping loads

/*
 * WHO EACH HASH IS, and three ways this used to go wrong:
 *
 *   It only asked about the first hundred missing keys but wrote an entry for
 *   every missing key, so person 101 onwards was cached as nobody for ten
 *   minutes, and since they all expired together the same tail was skipped on
 *   every refresh and never resolved. Only keys actually asked about get one.
 *
 *   Nothing was ever removed. presence forgets a user after a day; this map
 *   now forgets them with it.
 *
 *   The page reloads every five seconds and a slow first lookup overlapped
 *   itself, repeating the same account lookups one at a time. Overlapping
 *   loads now share one lookup, and the accounts are fetched in parallel.
 */
function resolveWho() {
  if (!resolving) resolving = resolveOnce().finally(() => { resolving = null; });
  return resolving;
}

async function emailsOf(userIds) {
  const out = new Map();
  const queue = [...new Set(userIds)];
  const worker = async () => {
    while (queue.length) {
      const id = queue.shift();
      try {
        const { data: u } = await supabase.auth.admin.getUserById(id);
        out.set(id, (u && u.user && u.user.email) || null);
      } catch { out.set(id, null); }
    }
  };
  await Promise.all(Array.from({ length: Math.min(WHO_PARALLEL, queue.length) }, worker));
  return out;
}

async function resolveOnce() {
  for (const hash of who.keys()) if (!presence.keys.has(hash)) who.delete(hash);
  const missing = [];
  for (const [hash, key] of presence.keys) {
    const w = who.get(hash);
    if (!w || Date.now() - w.at > WHO_MS) missing.push({ hash, key });
  }
  const batch = missing.slice(0, WHO_BATCH);
  if (batch.length) {
    try {
      const { data, error } = await supabase.from('licenses').select('license_key,plan,user_id')
        .in('license_key', batch.map((m) => m.key));
      // A failed lookup writes nothing, so the next refresh asks again rather
      // than showing everyone as unknown for ten minutes.
      if (error) throw new Error(error.message || error.code || 'licence lookup failed');
      const rows = new Map((data || []).map((r) => [r.license_key, r]));
      const emails = await emailsOf([...rows.values()].map((r) => r.user_id).filter(Boolean));
      const at = Date.now();
      for (const m of batch) {
        const row = rows.get(m.key);
        who.set(m.hash, { email: (row && row.user_id && emails.get(row.user_id)) || null,
          plan: row ? row.plan : null, at });
      }
    } catch (e) {
      console.warn('[admin] could not resolve accounts:', e.message);
    }
  }
  const out = {};
  for (const [hash, w] of who) out[hash] = { email: w.email, plan: w.plan };
  return out;
}

router.get('/live', async (req, res) => {
  if (!process.env.ADMIN_PASSWORD) return res.status(503).json({ error: 'admin-not-configured' });
  if (!isAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });
  try {
    res.json(presence.snapshot(await resolveWho()));
  } catch (e) {
    res.status(500).json({ error: 'Live view unavailable', detail: e.message });
  }
});

/**
 * POST /api/admin/licenses/sync-expiry[?apply=1]
 *
 * THE LICENCES THAT ALREADY EXIST, PUT RIGHT FROM STRIPE.
 *
 * Until the webhook was fixed no renewal ever reached a licence: the licences
 * table's trigger refused the service role's writes and nothing read the
 * error, so every subscriber still carries the expiry their key was minted
 * with (now plus 7, 30 or 365 days) and loses the app at the end of the first
 * period while Stripe goes on charging. Fixing the webhook moves a licence on
 * at its next renewal; this moves every one now, by the same rule
 * (services/billing.js): each licence with a subscription is read against that
 * subscription in Stripe, and
 *
 *   one Stripe is billing runs to its period end plus two days, active, and
 *     so does one set to cancel then, which the customer can still renew in
 *     Stripe's portal (Stripe ending it cancels the licence at the end all the
 *     same). One the site marked cancelled while Stripe went on billing it is
 *     active again for the period it paid for, and says so.
 *   one whose card is failing is payment_failed, to the end of the period
 *     paid for plus two days, which is where the unpaid period began
 *     (services/billing.js failingExpiryFor): never that unpaid period's end,
 *     which a failed payment's grace would have made a free month, or year.
 *   one Stripe has ended is cancelled, at the moment it ended at the latest. A
 *     licence revoked for a refund or a chargeback keeps that reason.
 *   one revoked for a refund or a chargeback whose subscription Stripe still
 *     bills is left as it is and listed: that subscription needs stopping.
 *   a lifetime licence is never given an expiry, whatever subscription it names.
 *
 * A DRY RUN BY DEFAULT: it reads Stripe and the table, writes nothing, and
 * lists every row it would change, before and after. ?apply=1 writes them, each
 * write checked, and answers 500 with the list when any failed. Behind the
 * admin password, as every route here. No licence key or email is in the reply.
 */
const SYNC = { page: 500 };

function sameInstant(a, b) {
  if (!a || !b) return !a && !b;
  return Math.abs(Date.parse(a) - Date.parse(b)) < 1000;
}

/** What a licence should be, given its subscription; `hold` leaves it as it is. */
function syncTarget(row, sub) {
  if (row.plan === 'lifetime') return { hold: true, note: 'a lifetime licence that names a subscription, left as it is' };
  if (SUB_ENDED.has(sub.status)) {
    const endedSec = Number(sub.ended_at || sub.canceled_at) || null;
    let expires = row.expires_at || null;
    if (endedSec && (!expires || Date.parse(expires) > endedSec * 1000)) expires = new Date(endedSec * 1000).toISOString();
    return { status: LICENCE_ENDED.has(row.status) ? row.status : 'cancelled', expires_at: expires,
      note: `Stripe ended the subscription (${sub.status})` };
  }
  if (LICENCE_REVOKED.has(row.status)) {
    return { hold: true, note: `revoked (${row.status}) but Stripe still bills the subscription (${sub.status}): cancel it in Stripe` };
  }
  const status = licenceStatusOf(sub.status);
  // A failing card's licence runs to the period PAID for plus the grace, never
  // the one being collected: a failed payment is usable until its expiry now
  // (routes/license.js usable), so the unpaid period's end was that period free.
  const expires = status === 'payment_failed' ? failingExpiryFor(sub, row.expires_at) : expiryFor(sub);
  if (!status || !expires) return { hold: true, note: `Stripe says ${sub.status} and gives no period, left as it is` };
  const out = { status, expires_at: expires };
  if (row.status === 'cancelled') out.note = 'cancelled on the account while Stripe still bills it, active again for the period paid';
  if (sub.cancel_at_period_end) out.note = (out.note ? `${out.note}; ` : '') + 'set to cancel at its period end';
  return out;
}

router.post('/licenses/sync-expiry', async (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });
  try {
    await syncExpiry(req, res);
  } catch (e) {
    console.error('[admin] sync-expiry failed:', e.message);
    if (!res.headersSent) res.status(500).json({ error: 'sync-expiry failed', detail: e.message });
  }
});

async function syncExpiry(req, res) {
  const apply = !!(req.query && (req.query.apply === '1' || req.query.apply === 'true'));

  const rows = [];
  for (let from = 0; ; from += SYNC.page) {
    const { data, error } = await supabase
      .from('licenses')
      .select('id,plan,status,expires_at,stripe_subscription_id')
      .not('stripe_subscription_id', 'is', null)
      .order('id', { ascending: true })
      .range(from, from + SYNC.page - 1);
    if (error) {
      console.error('[admin] sync-expiry could not read the licences:', dbError(error));
      return res.status(503).json({ error: 'Could not read the licences just now.', retry: true });
    }
    rows.push(...(data || []));
    if (!data || data.length < SYNC.page) break;
  }

  const subs = new Map();
  const changes = [];
  const held = [];
  const errors = [];
  let unchanged = 0;
  for (const row of rows) {
    const subId = row.stripe_subscription_id;
    let sub = subs.get(subId);
    if (!sub) {
      try {
        sub = await stripe.subscriptions.retrieve(subId);
        subs.set(subId, sub);
      } catch (e) {
        errors.push({ id: row.id, subscription: subId, error: e.code === 'resource_missing' ? 'not in Stripe' : e.message });
        continue;
      }
    }
    const to = syncTarget(row, sub);
    if (to.hold) { held.push({ id: row.id, plan: row.plan, subscription: subId, stripe: sub.status, note: to.note }); continue; }
    if (to.status === row.status && sameInstant(to.expires_at, row.expires_at)) { unchanged++; continue; }
    const change = {
      id: row.id, plan: row.plan, subscription: subId, stripe: sub.status,
      cancelAtPeriodEnd: !!sub.cancel_at_period_end,
      from: { status: row.status, expires_at: row.expires_at },
      to: { status: to.status, expires_at: to.expires_at },
    };
    if (to.note) change.note = to.note;
    changes.push(change);
  }

  let applied = 0;
  if (apply) {
    for (const c of changes) {
      const { data, error } = await supabase
        .from('licenses')
        .update({ status: c.to.status, expires_at: c.to.expires_at })
        .eq('id', c.id)
        .select('id');
      if (error || !data || !data.length) {
        c.applied = false;
        errors.push({ id: c.id, subscription: c.subscription, error: error ? dbError(error) : 'no row was changed' });
      } else {
        c.applied = true;
        applied++;
      }
    }
  }

  const failedWrites = changes.filter((c) => c.applied === false).length;
  console.log(`[admin] sync-expiry ${apply ? 'applied' : 'dry run'}: ${rows.length} licence(s) with a subscription, `
    + `${changes.length} to change, ${applied} written, ${held.length} held, ${errors.length} error(s)`);
  return res.status(apply && failedWrites ? 500 : 200).json({
    apply, checked: rows.length, subscriptions: subs.size,
    changes, unchanged, held, errors, applied,
  });
}

/* The page and its script. Served as two files because helmet's default
   policy allows scripts from this origin only, never inline ones. */
router.page = () => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Occlara Live</title>
<style>
  :root { color-scheme: dark; --bg:#08090A; --s:#0E0F11; --s2:#15161A; --line:rgba(255,255,255,.09); --line2:rgba(255,255,255,.18);
    --t:#F5F5F7; --d:#A9A9AF; --m:#86868C; --red:#FF4655; --good:#52C88A; --warn:#D9A441;
    --f: Geist, -apple-system, "Segoe UI", Roboto, system-ui, sans-serif; --mono: "Geist Mono", ui-monospace, Consolas, monospace; }
  * { box-sizing: border-box; } body { margin:0; background:var(--bg); color:var(--t); font:14px/1.5 var(--f); }
  .wrap { max-width:1080px; margin:0 auto; padding:28px 18px 60px; display:flex; flex-direction:column; gap:22px; }
  h1 { font-size:22px; margin:0; } h2 { font-size:12px; letter-spacing:.12em; text-transform:uppercase; color:var(--m); margin:0 0 10px; }
  .top { display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:12px; }
  .sub { color:var(--m); font-size:12px; } .pill { font:600 11px var(--mono); padding:3px 8px; border-radius:999px; border:1px solid var(--line2); color:var(--d); }
  .tiles { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:10px; }
  .tile { background:var(--s); border:1px solid var(--line); border-radius:12px; padding:14px 16px; }
  .tile b { display:block; font:600 30px/1.1 var(--mono); } .tile span { color:var(--m); font-size:12px; }
  .tile.rec b { color:var(--red); }
  table { width:100%; border-collapse:collapse; font-size:13px; } .tbl { overflow-x:auto; background:var(--s); border:1px solid var(--line); border-radius:12px; }
  th, td { text-align:left; padding:9px 12px; border-bottom:1px solid var(--line); white-space:nowrap; } th { color:var(--m); font-weight:600; font-size:11px; letter-spacing:.06em; text-transform:uppercase; }
  tr:last-child td { border-bottom:0; } .mono { font-family:var(--mono); }
  .st { display:inline-flex; align-items:center; gap:6px; } .st i { width:7px; height:7px; border-radius:50%; background:var(--m); }
  .st.recording i { background:var(--red); box-shadow:0 0 0 3px rgba(255,70,85,.18); } .st.reviewing i { background:var(--warn); } .st.open i { background:var(--good); }
  .grid2 { display:grid; grid-template-columns:1fr 1fr; gap:22px; }
  .kv { display:grid; grid-template-columns:auto 1fr; gap:6px 16px; background:var(--s); border:1px solid var(--line); border-radius:12px; padding:14px 16px; }
  .kv span { color:var(--m); } .bad { color:var(--red); } .empty { color:var(--m); padding:14px 16px; }
  form { display:flex; gap:8px; } input { background:var(--s); border:1px solid var(--line2); color:var(--t); border-radius:8px; padding:9px 12px; font:inherit; min-width:220px; }
  button { background:var(--red); color:#fff; border:0; border-radius:8px; padding:9px 14px; font:600 13px var(--f); cursor:pointer; }
  button.ghost { background:transparent; border:1px solid var(--line2); color:var(--d); }
  .err { color:var(--red); font-size:13px; } [hidden] { display:none !important; }
  @media (max-width:760px) { .tiles { grid-template-columns:repeat(2,minmax(0,1fr)); } .grid2 { grid-template-columns:1fr; } }
</style></head>
<body><div class="wrap">
  <div class="top"><div><h1>Occlara Live</h1><div class="sub" id="asof">Who is using Occlara right now</div></div>
    <form id="login"><input id="pw" type="password" placeholder="Admin password" autocomplete="current-password"><button>Open</button></form>
    <button class="ghost" id="logout" hidden>Lock</button></div>
  <p class="err" id="err" hidden></p>
  <div id="view" hidden>
    <div class="tiles">
      <div class="tile rec"><b id="n-rec">0</b><span>recording a match</span></div>
      <div class="tile"><b id="n-rev">0</b><span>reviewing a match</span></div>
      <div class="tile"><b id="n-open">0</b><span>with the app open</span></div>
      <div class="tile"><b id="n-today">0</b><span>seen today</span></div>
    </div>
    <div style="margin-top:22px"><h2>People</h2><div class="tbl"><table><thead><tr><th>Who</th><th>State</th><th>Game</th><th>Version</th><th>Last seen</th><th>Reads a minute</th><th>Calls today</th></tr></thead><tbody id="users"></tbody></table></div></div>
    <div class="grid2" style="margin-top:22px">
      <div><h2>Server</h2><div class="kv" id="server"></div></div>
      <div><h2>Recent errors</h2><div class="tbl"><table><tbody id="errors"></tbody></table></div></div>
    </div>
    <div style="margin-top:22px"><h2>Routes</h2><div class="tbl"><table><thead><tr><th>Route</th><th>Calls</th><th>5xx</th><th>4xx</th><th>Over 10s</th><th>Average</th><th>Last 5xx</th></tr></thead><tbody id="routes"></tbody></table></div></div>
  </div>
</div><script src="/admin/app.js"></script></body></html>`;

router.script = () => `'use strict';
const $ = (id) => document.getElementById(id);
let pw = null; try { pw = sessionStorage.getItem('occlaraAdmin'); } catch {}
let timer = null;
const ago = (s) => s < 60 ? s + 's ago' : s < 3600 ? Math.round(s / 60) + 'm ago' : Math.round(s / 3600) + 'h ago';
const dur = (s) => { const d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60); return (d ? d + 'd ' : '') + (h ? h + 'h ' : '') + m + 'm'; };
function cell(tr, text, cls) { const td = document.createElement('td'); if (cls) td.className = cls; td.textContent = text == null ? '' : String(text); tr.append(td); return td; }
function row(tbody, cells) { const tr = document.createElement('tr'); for (const c of cells) cell(tr, c[0], c[1]); tbody.append(tr); return tr; }
function empty(tbody, cols, text) { const tr = document.createElement('tr'); const td = cell(tr, text, 'empty'); td.colSpan = cols; tbody.append(tr); }
async function load() {
  try {
    const r = await fetch('/api/admin/live', { headers: { 'X-Admin-Password': pw || '' }, cache: 'no-store' });
    if (r.status === 401) { lock('That password was not accepted.'); return; }
    // The failed password limiter (admin-auth.js) answers 429 for the rest of
    // its hour, even to the right password, so polling on would only fail.
    if (r.status === 429) { lock('Too many wrong passwords from this address. Try again in an hour.'); return; }
    const d = await r.json().catch(() => ({}));
    if (r.status === 503 && d.error === 'admin-not-configured') { lock('ADMIN_PASSWORD is not set on Railway. Add it under the service Variables, then reload.'); return; }
    // Anything else is the server failing (a restart, an edge 502): say so and
    // keep polling, rather than failing on a body that is not the live view.
    if (!r.ok || !d.now) { $('err').textContent = 'The server answered ' + r.status + ', trying again in 5 seconds.'; $('err').hidden = false; return; }
    $('err').hidden = true; $('view').hidden = false; $('login').hidden = true; $('logout').hidden = false;
    $('asof').textContent = 'Updated ' + new Date(d.asOf).toLocaleTimeString() + ', refreshes every 5 seconds';
    $('n-rec').textContent = d.now.recording; $('n-rev').textContent = d.now.reviewing;
    $('n-open').textContent = d.now.appOpen; $('n-today').textContent = d.now.seenToday;
    const ub = $('users'); ub.replaceChildren();
    if (!d.users.length) empty(ub, 7, 'Nobody since the server started at ' + new Date(d.server.startedAt).toLocaleString() + '.');
    for (const u of d.users) {
      const tr = document.createElement('tr');
      cell(tr, u.email || u.user + (u.plan ? ' (' + u.plan + ')' : ''), u.email ? '' : 'mono');
      const st = cell(tr, ''); const sp = document.createElement('span'); sp.className = 'st ' + (u.state === 'app open' ? 'open' : u.state);
      sp.append(document.createElement('i'), document.createTextNode(u.state)); st.append(sp);
      cell(tr, u.game || ''); cell(tr, u.version || '', 'mono'); cell(tr, ago(u.lastSeenSec));
      cell(tr, u.readsLastMinute, 'mono'); cell(tr, u.callsToday, 'mono'); ub.append(tr);
    }
    const sv = $('server'); sv.replaceChildren();
    const kv = (k, v, bad) => { const a = document.createElement('span'); a.textContent = k; const b = document.createElement('b'); b.textContent = v; if (bad) b.className = 'bad'; sv.append(a, b); };
    kv('Up since', new Date(d.server.startedAt).toLocaleString() + ' (' + dur(d.server.uptimeSec) + ')', d.server.uptimeSec < 600);
    kv('Memory', d.server.heapMB + ' MB heap, ' + d.server.rssMB + ' MB total, peak heap ' + d.server.peakHeapMB + ' MB');
    kv('Node', d.server.node);
    const eb = $('errors'); eb.replaceChildren();
    if (!d.errors.length) empty(eb, 2, 'No errors since the server started.');
    for (const e of d.errors.slice(0, 15)) row(eb, [[new Date(e.at).toLocaleTimeString(), 'mono'], [e.where + ': ' + e.message, 'bad']]);
    const rb = $('routes'); rb.replaceChildren();
    if (!d.routes.length) empty(rb, 7, 'No calls yet.');
    for (const x of d.routes.slice(0, 25)) row(rb, [[x.route, 'mono'], [x.calls, 'mono'], [x.errors5xx, x.errors5xx ? 'mono bad' : 'mono'], [x.errors4xx, 'mono'], [x.slow, 'mono'], [x.avgMs + ' ms', 'mono'], [x.lastErrorSec == null ? '' : ago(x.lastErrorSec)]]);
  } catch (e) { $('err').textContent = 'Could not reach the server: ' + e.message; $('err').hidden = false; }
}
function start() { clearInterval(timer); load(); timer = setInterval(load, 5000); }
function lock(msg) { clearInterval(timer); pw = null; try { sessionStorage.removeItem('occlaraAdmin'); } catch {} $('view').hidden = true; $('login').hidden = false; $('logout').hidden = true; if (msg) { $('err').textContent = msg; $('err').hidden = false; } }
$('login').addEventListener('submit', (e) => { e.preventDefault(); pw = $('pw').value; try { sessionStorage.setItem('occlaraAdmin', pw); } catch {} start(); });
$('logout').addEventListener('click', () => lock(''));
if (pw) start();
`;

module.exports = router;
module.exports.__test = { resolveWho, who, SYNC, syncTarget };

'use strict';
const express = require('express');
const router  = express.Router();

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
  const adminPassword = process.env.ADMIN_PASSWORD;
  const provided = req.headers['x-admin-password'] || req.query.password;
  if (!adminPassword || provided !== adminPassword) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    res.json(require('./coach').telemetry.summary());
  } catch (e) {
    res.status(500).json({ error: 'Telemetry unavailable' });
  }
});

// GET /api/admin/costs
// Protected by ADMIN_PASSWORD env var
// Returns cost tracking data from the coach module
router.get('/costs', (req, res) => {
  const adminPassword = process.env.ADMIN_PASSWORD;
  const provided = req.headers['x-admin-password'] || req.query.password;

  if (!adminPassword || provided !== adminPassword) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // Lazy-require to avoid circular deps
  let coachModule;
  try {
    coachModule = require('./coach');
  } catch (e) {
    return res.status(500).json({ error: 'Cost data unavailable' });
  }

  const { costStore, globalStats } = coachModule;

  // Top 10 by calls today
  const byKey = [];
  for (const [key, stats] of costStore.entries()) {
    byKey.push({ key: key.slice(0, 8) + '...', callsToday: stats.callsToday, callsMonth: stats.callsMonth, costToday: +stats.costToday.toFixed(4), costMonth: +stats.costMonth.toFixed(4) });
  }
  byKey.sort((a, b) => b.callsToday - a.callsToday);

  res.json({
    global: {
      callsToday:  globalStats.callsToday,
      callsMonth:  globalStats.callsMonth,
      costToday:   +globalStats.costToday.toFixed(4),
      costMonth:   +globalStats.costMonth.toFixed(4),
      estCostToday:  '$' + globalStats.costToday.toFixed(4),
      estCostMonth:  '$' + globalStats.costMonth.toFixed(4),
    },
    topUsers: byKey.slice(0, 10),
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
const { presence } = require('../services/presence');
const supabase = require('../db/supabase');

const WHO_MS = 10 * 60 * 1000;
const who = new Map();   // hash -> { email, plan, at }

async function resolveWho() {
  const missing = [];
  for (const [hash, key] of presence.keys) {
    const w = who.get(hash);
    if (!w || Date.now() - w.at > WHO_MS) missing.push({ hash, key });
  }
  if (missing.length) {
    try {
      const { data } = await supabase.from('licenses').select('license_key,plan,user_id')
        .in('license_key', missing.map((m) => m.key).slice(0, 100));
      for (const m of missing) {
        const row = (data || []).find((r) => r.license_key === m.key);
        let email = null;
        if (row && row.user_id) {
          try {
            const { data: u } = await supabase.auth.admin.getUserById(row.user_id);
            email = (u && u.user && u.user.email) || null;
          } catch { email = null; }
        }
        who.set(m.hash, { email, plan: row ? row.plan : null, at: Date.now() });
      }
    } catch (e) {
      console.warn('[admin] could not resolve accounts:', e.message);
    }
  }
  const out = {};
  for (const [hash, w] of who) out[hash] = w;
  return out;
}

router.get('/live', async (req, res) => {
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (!adminPassword) return res.status(503).json({ error: 'admin-not-configured' });
  const provided = req.headers['x-admin-password'] || req.query.password;
  if (provided !== adminPassword) return res.status(401).json({ error: 'Unauthorized' });
  try {
    res.json(presence.snapshot(await resolveWho()));
  } catch (e) {
    res.status(500).json({ error: 'Live view unavailable', detail: e.message });
  }
});

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
    if (r.status === 503) { lock('ADMIN_PASSWORD is not set on Railway. Add it under the service Variables, then reload.'); return; }
    const d = await r.json();
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

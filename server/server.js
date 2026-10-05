'use strict';
require('dotenv').config();

const { presence } = require('./services/presence');

// ─── Global crash guards, keep the server alive on bad responses ────────────
process.on('uncaughtException', (err) => {
  console.error('[server] CRASH PREVENTED - uncaughtException:', err.message);
  console.error(err.stack);
  presence.error('uncaughtException', err);
});

process.on('unhandledRejection', (reason) => {
  console.error('[server] CRASH PREVENTED - unhandledRejection:', reason);
  presence.error('unhandledRejection', reason);
});

// WHY DID IT STOP. A Railway "deployment crashed" email says nothing about the
// cause, and the two common ones look identical from outside: Railway asking
// the process to stop (a redeploy, a restart) arrives as SIGTERM and is logged
// here, and running out of memory kills the process with no JavaScript running
// at all, so the last memory line below is the only witness.
process.on('SIGTERM', () => {
  const m = process.memoryUsage();
  console.log(`[server] SIGTERM received (a redeploy or restart), heap ${Math.round(m.heapUsed / 1048576)} MB, `
    + `rss ${Math.round(m.rss / 1048576)} MB, up ${Math.round(process.uptime())}s`);
  process.exit(0);
});
process.on('exit', (code) => console.log(`[server] exiting with code ${code} after ${Math.round(process.uptime())}s`));

const express   = require('express');
const cors      = require('cors');
const helmet    = require('helmet');
const rateLimit = require('express-rate-limit');

const paymentRoutes = require('./routes/payments');
const licenseRoutes = require('./routes/license');
const accountRoutes = require('./routes/account');
const coachRoutes   = require('./routes/coach');
const rivalsRoutes  = require('./routes/rivals');
const adminRoutes   = require('./routes/admin');
const webhookHandler = require('./routes/webhook');
const { errorHandler, corsRefusal } = require('./services/http-errors');
const { makeAdminLimiter } = require('./services/admin-auth');

const app  = express();
const PORT = process.env.PORT || 3000;

// Trust Railway's proxy so rate-limiter can read real client IPs
app.set('trust proxy', 1);

// ─── Security headers ─────────────────────────────────────────────────────────
app.use(helmet());

// ─── CORS ─────────────────────────────────────────────────────────────────────
const allowedOrigins = [
  // The new brand. www is listed separately because an Origin header carries
  // the exact host, and occlara.app and www.occlara.app are different origins.
  'https://occlara.app',
  'https://www.occlara.app',
  // The old brand, KEPT ON PURPOSE. A rename is a transition rather than a
  // switch: the previous site stays reachable while DNS settles and while
  // anybody still has it open, and removing it here would break checkout for
  // them the moment this deploys. Delete these once occlara.app has served
  // every path for a while and the old domain redirects.
  'https://ghostcoachai.com',
  'https://www.ghostcoachai.com',
  'https://ghostcoach-production.up.railway.app',
  'http://localhost:3000',
  'http://localhost:5173',
  'http://localhost:5174',
];

app.use(cors({
  origin: (origin, callback) => {
    // No Origin header = native clients (the Electron app, curl); allowed.
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    if (origin.endsWith('.lovable.app') || origin.endsWith('.lovable.dev')) return callback(null, true);
    // Everything else is rejected before any route runs, as a client error
    // (400) rather than the 500 a plain Error became. See http-errors.js.
    callback(corsRefusal());
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-License-Key', 'X-Prompt-Mode', 'X-Combat-Tip-Given', 'X-Recent-Tips', 'X-Admin-Password', 'X-Forced', 'X-Player-Stats', 'X-Occlara-Version'],
  credentials: true,
}));

// ─── Rate limiters ────────────────────────────────────────────────────────────
// Counts FAILED activations only. The desktop app re-checks its licence through
// this same route every three minutes, twenty times an hour, so counting every
// call meant an app left open spent the whole budget on good checks and a real
// sign in from that machine was refused for an hour. Brute force is failures.
// A 503 is the licence database failing, not a guess, so it is not counted
// either: an outage answers every client's re-check 503, and counting those
// left whole IPs locked out of a real sign in for an hour after it ended.
const activationLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, max: 10,
  skipSuccessfulRequests: true,
  requestWasSuccessful: (req, res) => res.statusCode < 400 || res.statusCode >= 500,
  message: { error: 'Too many activation attempts. Try again in 1 hour.' },
  standardHeaders: true, legacyHeaders: false,
});

const checkoutLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, max: 20,
  message: { error: 'Too many checkout attempts. Try again in 1 hour.' },
  standardHeaders: true, legacyHeaders: false,
});

// AI endpoints cost real money per call, so they are capped, but PER LICENSE
// KEY, not per IP. IP buckets collide players behind the same NAT or proxy
// chain and were throttling legit sessions (Ultra mode alone is ~20 analyzes
// per minute plus agent detection). Keyless requests share one bucket; the
// routes reject them with 400/403 before any AI cost anyway.
const licenseKeyOrIp = (req) => String(req.headers['x-license-key'] || '').trim().toUpperCase() || 'no-key';
const coachLimiter = rateLimit({
  windowMs: 60 * 1000, max: 90,   // headroom for the 1s capture tier
  keyGenerator: licenseKeyOrIp,
  // The live READ has its own budget below. Sharing this one, a match read
  // every second with two requests in flight would spend all 90 on reads
  // alone and starve agent detection and the review.
  skip: (req) => req.path === '/read',
  message: { error: 'Slow down. Too many coaching requests.' },
  standardHeaders: true, legacyHeaders: false,
});
// The live read: facts only, one small call per frame. 150 a minute per licence
// is a read every 400ms, above the fastest capture tier (one every second with
// two in flight) with room for a retry, and still a hard ceiling on cost.
const readLimiter = rateLimit({
  windowMs: 60 * 1000, max: 150,
  keyGenerator: licenseKeyOrIp,
  message: { error: 'Slow down. Too many read requests.' },
  standardHeaders: true, legacyHeaders: false,
});
const chatLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, max: 25,
  keyGenerator: licenseKeyOrIp,
  message: { error: 'Too many chat messages. Give it a few minutes.' },
  standardHeaders: true, legacyHeaders: false,
});
// Failed admin passwords, ten an hour per IP. One instance for the API and the
// page, so the count is shared. See services/admin-auth.js.
const adminLimiter = makeAdminLimiter();

// ─── Raw body routes, MUST come before JSON parser ──────────────────────────
// Stripe webhook needs raw JSON; coach/summary/round needs raw binary JPEG
app.post('/api/payments/webhook', express.raw({ type: 'application/json' }), webhookHandler);
app.post('/api/coach/summary/round', express.raw({ type: 'image/jpeg', limit: '500kb' }), (req, _, next) => { req._rawBody = req.body; next(); });

// ─── JSON parsers ─────────────────────────────────────────────────────────────
// The death look carries up to eight frames (four deaths, two each) at 720p,
// about 1.5 MB of base64 on a busy match, which sat right at the global 2 MB
// limit: an over limit body is answered 413 before the route runs, so the
// review simply had no death look and nothing said why.
app.use('/api/coach/death-forensics', express.json({ limit: '8mb' }));
// Global (2mb so /api/coach/analyze and /read can carry a base64 JPEG).
app.use(express.json({ limit: '2mb' }));

// ─── Who is using it ────────────────────────────────────────────────────────
// Every client call carries its licence, so the server knows who was last seen
// and doing what. See services/presence.js and the /admin page.
app.use('/api', (req, res, next) => {
  const path = req.originalUrl.split('?')[0];
  const t0 = Date.now();
  presence.touch({
    key: req.headers['x-license-key'] || (req.body && (req.body.key || req.body.licenseKey)),
    path,
    version: req.headers['x-occlara-version'],
  });
  // A path no route answered is one bucket, not one row each: a scan of 200
  // made up paths used to push the real routes out of the admin view.
  res.on('finish', () => presence.finish({
    path: res.statusCode === 404 && !req.route ? '(no such route)' : path,
    status: res.statusCode, ms: Date.now() - t0,
  }));
  next();
});

// ─── Route-level rate limits ──────────────────────────────────────────────────
app.use('/api/license/activate',        activationLimiter);
app.use('/api/payments/create-checkout', checkoutLimiter);
app.use('/api/coach/chat',               chatLimiter);
app.use('/api/coach/read',               readLimiter);
app.use('/api/coach',                    coachLimiter);
app.use('/api/rivals',                   coachLimiter);
app.use('/api/admin',                    adminLimiter);
app.use('/admin',                        adminLimiter);

// ─── Routes ──────────────────────────────────────────────────────────────────
app.use('/api/payments', paymentRoutes);
app.use('/api/license',  licenseRoutes);
app.use('/api/account',  accountRoutes);
app.use('/api/coach',    coachRoutes);
app.use('/api/rivals',   rivalsRoutes);
app.use('/api/admin',    adminRoutes);

// The live view: who is on Occlara right now. The page itself holds no data;
// it asks /api/admin/live with the admin password typed into it.
app.get('/admin', (_, res) => res.type('html').send(adminRoutes.page()));
app.get('/admin/app.js', (_, res) => res.type('application/javascript').send(adminRoutes.script()));

// ─── Health checks ────────────────────────────────────────────────────────────
// Reports the live AI model config (public model slugs only, never the key) so
// a model/env mismatch is observable instead of guessed from response latency.
// Asks the coach router what it is actually using rather than re-deriving it
// from the environment. This endpoint used to keep its own copy of the defaults
// and they drifted: with no env var set it named three models, none of which any
// code path could reach, and it reported a "deep" model that nothing has ever
// called. A diagnostic that answers "what is live" with a guess is worse than
// having no diagnostic, because it gets believed.
const healthInfo = () => ({
  status: 'ok',
  timestamp: new Date().toISOString(),
  // When this process started, so a restart is visible from outside.
  startedAt: new Date(Date.now() - process.uptime() * 1000).toISOString(),
  uptimeSec: Math.round(process.uptime()),
  ...coachRoutes.liveModels(),
});
app.get('/health',     (_, res) => res.json(healthInfo()));
app.get('/api/health', (_, res) => res.json(healthInfo()));

// ─── 404 / Error ─────────────────────────────────────────────────────────────
app.use((_, res) => res.status(404).json({ error: 'Not found' }));
// A client's mistake (a malformed or aborted body, a refused origin) keeps its
// own 4xx; only the server's own failures are a 500. See http-errors.js.
app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`[server] Occlara API running on port ${PORT}`);
  console.log(`[server] Stripe mode: ${process.env.STRIPE_SECRET_KEY?.startsWith('sk_live') ? 'LIVE' : 'TEST'}`);
  console.log(`[server] Supabase: ${process.env.SUPABASE_URL || '(not configured)'}`);
  console.log(`[server] AI provider: ${process.env.AI_API_KEY
    ? `OpenAI-compatible (${process.env.AI_VISION_MODEL || 'default model'})`
    : process.env.GEMINI_API_KEY ? 'Gemini' : '(none configured)'}`);
  console.log(`[server] Stats: ${process.env.HENRIKDEV_API_KEY ? 'HenrikDev' : ''}${process.env.TRACKER_API_KEY ? ' tracker.gg' : ''}` || '(none)');
});

// ─── Memory logging, every 60s so we can spot leaks early ───────────────────
setInterval(() => {
  const used = process.memoryUsage();
  const heap = Math.round(used.heapUsed / 1024 / 1024);
  presence.noteMemory(heap);
  console.log('[server] Memory:', heap, 'MB heap,', Math.round(used.rss / 1024 / 1024), 'MB rss');
}, 60000);

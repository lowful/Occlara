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
const usageRoutes   = require('./routes/usage');
const giftRoutes    = require('./routes/gifts');
const callers       = require('./services/caller');
const retiredRoutes = require('./routes/retired');
const adminRoutes   = require('./routes/admin');
const changelogRoutes = require('./routes/changelog');
// Report a problem (docs/claude/feedback.md): the player's report, and the owner's inbox.
const feedbackRoutes = require('./routes/feedback');
const feedbackModel = require('./services/feedback');
const webhookHandler = require('./routes/webhook');
const { errorHandler, corsRefusal } = require('./services/http-errors');
const { makeAdminLimiter, isAdmin } = require('./services/admin-auth');
const rateLimits = require('./services/rate-limits');

const app  = express();
const PORT = process.env.PORT || 3000;

// Trust Railway's proxy so rate-limiter can read real client IPs
app.set('trust proxy', 1);

// THE PLAYER'S OWN ADDRESS ON RAILWAY (5 Nov 2026): measured with /api/admin/whoami,
// Railway's edge adds a second hop, so req.ip under trust proxy 1 is the edge node's
// address, shared by every player behind it. Railway sets X-Real-IP to the real client
// and overwrites one a client sends (sent 1.2.3.4, the server saw the real one), so on
// Railway req.ip is that. Off Railway (tests, a local run) nothing changes.
app.use(rateLimits.realIpMiddleware(process.env));

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

// AI endpoints cost real money per call, so they are capped, but PER ACCOUNT,
// not per IP, once the caller is known. IP buckets collide players behind the
// same NAT or proxy chain and were throttling legit sessions (Ultra mode alone
// is ~20 analyzes per minute plus agent detection). Since 8.7 the bucket is
// the caller's accountKey (services/caller.js: the account when its user is
// known, else the licence key, the old bucket), asked before the limiter runs
// (identifyFirst below); a caller not verified is bucketed by its IP (an IPv6
// one by its /64), never by whatever key it typed, so made up keys share one
// bucket per address.
const licenseKeyOrIp = (req) => (req.caller && req.caller.accountKey) || callers.ipBucket(req.ip);
const coachLimiter = rateLimit({
  windowMs: 60 * 1000, max: 90,   // headroom for the 1s capture tier
  keyGenerator: licenseKeyOrIp,
  // The live READ has its own budget below. Sharing this one, a match read
  // every second with up to four requests in flight would spend all 90 on
  // reads alone and starve agent detection and the review.
  skip: (req) => req.path === '/read',
  message: { error: 'Slow down. Too many coaching requests.' },
  standardHeaders: true, legacyHeaders: false,
});
// The live read: facts only, one small call per frame. 150 a minute per licence
// is a read every 400ms, above the fastest capture tier (one every second, up
// to four in flight) with room for a retry, and still a hard ceiling on cost.
const readLimiter = rateLimit({
  windowMs: 60 * 1000, max: 150,
  keyGenerator: licenseKeyOrIp,
  message: { error: 'Slow down. Too many read requests.' },
  standardHeaders: true, legacyHeaders: false,
});
// Ask Coach's numbers live in one place (services/chat-guard.js CHAT_LIMITS):
// this limiter, and inside the routes one question at a time, a 2 s gap, 5 a
// minute and a repeat answered from memory.
const { CHAT_LIMITS } = require('./services/chat-guard');
const chatLimiter = rateLimit({
  windowMs: CHAT_LIMITS.LIMITER_WINDOW_MS, max: CHAT_LIMITS.LIMITER_MAX,
  keyGenerator: licenseKeyOrIp,
  message: { error: 'Too many chat messages. Give it a few minutes.' },
  standardHeaders: true, legacyHeaders: false,
});
// RIOT'S DATA ON A FREE ACCOUNT (8.7): the stats routes cost HenrikDev's
// quota, not a model's, and a free account has two games, so it gets a
// tighter budget there: 40 calls in ten minutes covers the Stats page, a
// review's record and a backfill, and stops one free account spending the
// quota every paying player shares. Paid tiers and 8.6 keys are untouched.
const RIOT_DATA_PATHS = ['/api/coach/player-stats', '/api/coach/rank-history', '/api/coach/match-deaths',
  '/api/coach/match-rounds', '/api/coach/matches', '/api/coach/last-match', '/api/coach/recent-matches'];
const freeRiotLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, max: 40,
  keyGenerator: licenseKeyOrIp,
  skip: (req) => !(req.caller && req.caller.tier === 'free' && req.caller.userId),
  message: { error: 'Slow down. Too many match lookups.' },
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
// review simply had no death look and nothing said why. Since 8.3.1 a death
// from the recording sends five stills, twenty a match: the real Sunset
// match's came to 1.6 MB, 2.1 MB of base64.
app.use('/api/coach/death-forensics', express.json({ limit: '8mb' }));
// A report carries up to three pictures the app already downscaled to 1600 px
// and recompressed, 2 MB each at most (services/feedback.js), in base64.
app.use('/api/feedback', express.json({ limit: feedbackModel.BODY_LIMIT }));
// Global (2mb so /api/coach/analyze and /read can carry a base64 JPEG).
app.use(express.json({ limit: '2mb' }));

// ─── Who is calling (8.7) ───────────────────────────────────────────────────
// The caller is named BEFORE the limiters, so they can bucket it by account
// (services/caller.js), and the route's admit() reuses the same answer, asked
// once a request. Only where a caller matters: the coach routes (not the
// retired tip paths, which answer 410 and look nothing up) and the account
// and usage routes. A request with no credentials is not asked about at all.
//
// MADE UP CREDENTIALS ARE LIMITED BEFORE THEIR LOOKUP (8.7.3, services/
// rate-limits.js createGuessGuard): an address whose credentials were refused
// sixty times in ten minutes is answered 429 for the rest of that window
// without a lookup. A valid caller and an outage are never counted.
// The sign in handoff is named here too (8.7.3), so its limit is per account.
// Gifts (8.8) too: their redeem is limited per account, and the peek says "yours".
const IDENTIFIED = ['/api/coach', '/api/usage', '/api/referral', '/api/account/me', '/api/account/signout', '/api/account/handoff', '/api/gifts', '/api/feedback'];
const guessGuard = rateLimits.createGuessGuard();
async function identifyFirst(req, res, next) {
  try {
    if (req.baseUrl === '/api/coach' && coachRoutes.RETIRED_PATHS.has(req.path)) return next();
    if (!callers.hasCredentials(req)) return next();
    const wait = guessGuard.blocked(req);
    if (wait) {
      res.set('Retry-After', String(wait));
      return res.status(429).json({ error: 'rate-limited', what: 'credentials', retryAfter: wait });
    }
    const r = await callers.identify(req);
    guessGuard.note(req, r.status);
    if (r.status === 'valid') req.caller = r.caller;
  } catch (e) { /* the route asks again and answers for itself */ }
  next();
}
app.use(IDENTIFIED, identifyFirst);

// ─── Who is using it ────────────────────────────────────────────────────────
// Every client call carries its licence or its session, so the server knows
// who was last seen and doing what. See services/presence.js and the /admin page.
app.use('/api', (req, res, next) => {
  const path = req.originalUrl.split('?')[0];
  const t0 = Date.now();
  presence.touch({
    key: req.headers['x-license-key'] || (req.body && (req.body.key || req.body.licenseKey)),
    account: req.caller && req.caller.accountKey,
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
// The activation limiter counts failed keys on /validate too (8.7.3): no
// client calls it, so a made up key there was a free lookup.
app.use(['/api/license/activate', '/api/license/validate'], activationLimiter);
app.use('/api/payments/create-checkout', checkoutLimiter);
// Frame chat shares Ask Coach's limiter (8.7.3): one bucket for both.
app.use(['/api/coach/chat', '/api/coach/frame-chat'], chatLimiter);
app.use('/api/coach/read',               readLimiter);
app.use(RIOT_DATA_PATHS,                 freeRiotLimiter);
app.use('/api/coach',                    coachLimiter);
app.use('/api/admin',                    adminLimiter);
app.use('/admin',                        adminLimiter);
// THE 8.7.3 LIMITS: every route that costs a lookup, a write, a model, Stripe
// or HenrikDev, keyed by the verified account where there is one and by the
// address otherwise, each at least five times what a real client sends.
// 429 { error: 'rate-limited', retryAfter } and Retry-After. The numbers and
// why: services/rate-limits.js routeLimits, docs/claude/accounts.md.
for (const { paths, mw } of rateLimits.routeLimits({ isAdmin, hasCredentials: callers.hasCredentials })) app.use(paths, mw);

// ─── Routes ──────────────────────────────────────────────────────────────────
app.use('/api/payments', paymentRoutes);
app.use('/api/license',  licenseRoutes);
app.use('/api/account',  accountRoutes);
// Accounts, games and invites (8.7): /api/account/handoff, /exchange,
// /signout and /me, /api/usage/claim, /api/referral and /redeem. After the
// account router, which serves only /dashboard and /portal. Its own per IP
// limits sit on the routes that take no account (routes/usage.js).
app.use('/api',          usageRoutes);
// Gifts (8.8): /api/gifts/peek, /redeem and the list (routes/gifts.js).
app.use('/api/gifts',    giftRoutes);
app.use('/api/coach',    coachRoutes);
// A game Occlara no longer coaches: an older install still calling its routes
// is answered 410 on every path, and nothing is looked up or called. See
// routes/retired.js.
app.use('/api/rivals',   retiredRoutes.rivals);
app.use('/api/changelog', changelogRoutes);
// Report a problem: a signed in account or a licence key, 5 an hour and 20 a
// day per account (rate-limits.js feedbackLimits), and the owner's inbox
// behind the admin password and its limiter (routes/feedback.js).
app.use('/api/feedback', feedbackRoutes.createRouter());
app.use('/api/admin/feedback', feedbackRoutes.createAdminRouter());
// Ask Coach's day (8.5.0): questions asked, drops by gate, retries, honest
// lines and cap refusals, counts only, behind the admin password and its
// limiter, never on the public /health (coach.js chatReport).
app.get('/api/admin/chat', (req, res) => {
  if (!isAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });
  res.json(coachRoutes.chatReport());
});
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
  console.log(`[server] Stats: ${process.env.HENRIKDEV_API_KEY ? 'HenrikDev' : '(none)'}`);
  // THE PRIMER'S LIVE VERSION CHECK (8.5.0, game-primer.js): at boot and
  // every six hours on Railway, never in a check, a test or CI
  // (liveCheckWanted). /api/admin/primer says what it found.
  try {
    const primer = require('./services/game-primer');
    if (primer.liveCheckWanted(process.env)) primer.startLiveCheck();
    else console.log('[server] primer live check off (not on Railway, or PRIMER_LIVE_CHECK=off)');
  } catch (e) {
    console.warn('[server] the primer live check could not start:', e.message);
  }
});

// ─── Memory logging, every 60s so we can spot leaks early ───────────────────
setInterval(() => {
  const used = process.memoryUsage();
  const heap = Math.round(used.heapUsed / 1024 / 1024);
  presence.noteMemory(heap);
  console.log('[server] Memory:', heap, 'MB heap,', Math.round(used.rss / 1024 / 1024), 'MB rss');
}, 60000);

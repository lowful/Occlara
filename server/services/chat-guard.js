'use strict';

/**
 * ASK COACH'S SPAM GUARD (8.7.3): what one account may ask of /api/coach/chat
 * and /frame-chat, beside the chat limiter in server.js and the daily cap in
 * coach.js (chatRoom). Every number is CHAT_LIMITS below, and the table of
 * them is docs/claude/accounts.md "Rate limits" and docs/claude/ask-coach.md.
 *
 *   ONE AT A TIME. A question while the same account's last one is still
 *   being answered is refused, with no model call. A turn that never ends
 *   (a crash between the guard and the answer) stops counting as in flight
 *   after IN_FLIGHT_MS.
 *   A GAP. A question less than GAP_MS after the account's last accepted one
 *   began is refused. From its start, not its answer: a real answer takes
 *   longer than the gap, so a player who asks again as soon as it lands is
 *   never refused, and only a script firing at failures is.
 *   A BURST. At most BURST_MAX accepted questions in BURST_WINDOW_MS (a fixed
 *   window, as rate-limits.js createLimiter). Only accepted questions count,
 *   so a client that keeps knocking while refused is free again when the
 *   window turns.
 *   A REPEAT. The same question about the same match, asked again within
 *   REPEAT_MS of an answer, is that answer again, sent from memory with no
 *   model call. Only an answer is remembered, never a failure, a cap line or
 *   the honest line, so a retry after an error always reaches the model.
 *
 * Refused is 429 { error: 'rate-limited', what, retryAfter, message } with a
 * Retry-After header, the shape every client in the field reads as "Too many
 * questions too quickly. Wait a few seconds and ask again." A client from
 * 8.7.3 says `message` for the one at a time refusal. Nothing here is ever
 * said mid match: Ask Coach and frame chat are sealed there.
 *
 * KEYED BY THE VERIFIED CALLER (rate-limits.js byCaller): the accountKey,
 * else the address. Chat and frame chat share one account's turns. Memory is
 * bounded: every map is swept of what is past its window at most once a
 * window, and past MAX_KEYS the oldest go first.
 */

const crypto = require('crypto');

const CHAT_LIMITS = Object.freeze({
  // The chat limiter in server.js, one bucket for chat and frame chat (unchanged).
  LIMITER_WINDOW_MS: 5 * 60 * 1000,
  LIMITER_MAX: 25,
  // The guard.
  BURST_MAX: 5,
  BURST_WINDOW_MS: 60 * 1000,
  GAP_MS: 2000,
  IN_FLIGHT_MS: 60 * 1000,    // above the route's 40 s budget and frame chat's 31 s
  REPEAT_MS: 30 * 1000,
  MAX_KEYS: 20000,
  // What a question is clipped to before it reaches a prompt (coach.js), for the docs and the tests.
  FRAME_QUESTION_CHARS: 500,
  CHAT_MESSAGE_CHARS: 1200,
});

const ONE_AT_A_TIME = 'One question at a time. Ask again once this answer is in.';
const TOO_FAST = 'Too many questions too quickly. Wait a few seconds and ask again.';

const norm = (s) => String(s == null ? '' : s).toLowerCase().replace(/\s+/g, ' ').trim();
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');

/** One key for "the same question about the same thing": the route, the question as typed, what it is about. */
function questionKey(route, question, about) {
  return sha(`${route}\n${norm(question)}\n${about == null ? '' : String(about)}`);
}

function createChatGuard(opts = {}) {
  const now = opts.now || (() => Date.now());
  const L = { ...CHAT_LIMITS, ...(opts.limits || {}) };

  const flying = new Map();   // account -> started at
  const last = new Map();     // account -> when its last accepted question began
  const bursts = new Map();   // account -> { start, n }
  const answers = new Map();  // account|question key -> { at, body }
  let swept = now();

  const keep = (map, k, v) => { map.delete(k); map.set(k, v); while (map.size > L.MAX_KEYS) map.delete(map.keys().next().value); };

  function sweep(at) {
    const every = Math.min(L.BURST_WINDOW_MS, L.REPEAT_MS, L.IN_FLIGHT_MS);
    if (at - swept < every) return;
    swept = at;
    for (const [k, t] of flying) if (at - t >= L.IN_FLIGHT_MS) flying.delete(k);
    for (const [k, t] of last) if (at - t >= L.GAP_MS) last.delete(k);
    for (const [k, e] of bursts) if (at - e.start >= L.BURST_WINDOW_MS) bursts.delete(k);
    for (const [k, e] of answers) if (at - e.at >= L.REPEAT_MS) answers.delete(k);
  }

  const refuse = (what, ms, message) => {
    const retryAfter = Math.max(1, Math.ceil(ms / 1000));
    return { ok: false, retryAfter, body: { error: 'rate-limited', what, retryAfter, message } };
  };

  /**
   * One question from `account` (rate-limits.js byCaller), `qkey` its
   * questionKey or null. Answers:
   *   { ok: true, end(), keep(body) }   go on; end() when answered, keep(body) remembers an answer
   *   { ok: false, repeat: body }       the same question's answer, from memory
   *   { ok: false, retryAfter, body }   refused: 429 with Retry-After
   */
  function begin(account, qkey) {
    const at = now();
    sweep(at);
    const k = String(account);
    const started = flying.get(k);
    if (started !== undefined && at - started < L.IN_FLIGHT_MS) {
      return refuse('chat-one-at-a-time', Math.min(L.IN_FLIGHT_MS - (at - started), 5000), ONE_AT_A_TIME);
    }
    const memoKey = qkey ? `${k}|${qkey}` : null;
    const memo = memoKey ? answers.get(memoKey) : null;
    if (memo && at - memo.at < L.REPEAT_MS) return { ok: false, repeat: memo.body };
    const prev = last.get(k);
    if (prev !== undefined && at - prev < L.GAP_MS) return refuse('chat-gap', L.GAP_MS - (at - prev), TOO_FAST);
    let b = bursts.get(k);
    if (!b || at - b.start >= L.BURST_WINDOW_MS) { b = { start: at, n: 0 }; keep(bursts, k, b); }
    if (b.n >= L.BURST_MAX) return refuse('chat-burst', b.start + L.BURST_WINDOW_MS - at, TOO_FAST);
    b.n++;
    keep(last, k, at);
    keep(flying, k, at);
    let ended = false;
    return {
      ok: true,
      end() {
        if (ended) return;
        ended = true;
        if (flying.get(k) === at) flying.delete(k);
      },
      keep(body) {
        if (!memoKey || !body || typeof body.reply !== 'string' || !body.reply) return;
        keep(answers, memoKey, { at: now(), body });
      },
    };
  }

  return { begin, flying, last, bursts, answers, limits: L };
}

module.exports = { CHAT_LIMITS, createChatGuard, questionKey, ONE_AT_A_TIME, TOO_FAST };

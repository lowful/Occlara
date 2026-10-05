'use strict';

/**
 * The Marvel Rivals reader.
 *
 * Same event surface as coaching-engine.js, deliberately, so the controller and
 * the AI log need no special case for which game is running. That includes
 * 'status', which carries the same three words, 'coaching', 'paused' and
 * 'stopped', and 'notice', which carries the same { kind, text } and takes a
 * notice back by sending its kind again with no text. This engine used to emit
 * objects as its status, and an object is not something a controller can track
 * a pause by; pause() says what that cost.
 *
 * What is completely different is what gets read. A Rivals review is built from
 * two screens: hero select, the one place the game PRINTS the player's hero, and
 * the scoreboard that ends the match. Almost every probe in between is answered
 * with a protocol word, LOBBY or SKIP, which costs a handful of tokens. Which of
 * the two questions a probe asks is the whole design, and route() says how it
 * is chosen.
 *
 * Nothing this engine reads reaches the screen during a match. Its tips are
 * emitted for the record and the controller shows only system ones. The one
 * thing that opens a window is a review, and only a scoreboard with a printed
 * result can make one (see onScoreboard).
 */
const EventEmitter = require('events');
const api = require('./api-client');
const { cleanTip, tipWords, overlapRatio } = require('./tip-hygiene');
const { draftAdvice, draftTipAllowed, readSuggested } = require('../../shared/rivals-draft');
const { validateTipForHero } = require('../../shared/rivals-abilities');
const { buildReview } = require('../../shared/rivals-review');
const { normaliseRole } = require('../../shared/rivals-comp');

// The two questions. Each prompt is told which screen it is looking at, so each
// misreads the other's screen as its own, which is why route() exists.
const DRAFT_ROUTE = '/api/rivals/draft';
const REVIEW_ROUTE = '/api/rivals/review';

// Hero select runs a short countdown, so the probe has to be quick or it misses
// the hero entirely. Most probes are answered LOBBY or SKIP, a handful of tokens.
const PROBE_MS = 8000;
// Once the hero is read there is nothing more to learn from hero select, and no
// scoreboard can appear for minutes, so the engine goes quiet rather than
// re-reading a countdown.
const DRAFT_COOLDOWN_MS = 90 * 1000;
// The backstop for the one way the same scoreboard could still be reviewed
// twice: the screen looked away from it and came back read differently. It only
// applies when no lobby and no hero select has been read since the last review.
// Every new match passes through both, so in practice it only ever holds back
// the same scoreboard.
const REVIEW_COOLDOWN_MS = 5 * 60 * 1000;
// The longest run of hero select questions before the scoreboard's is asked
// once. Five is forty seconds, longer than the hero select countdown, so a real
// hero select is never cut short, and a screen that hero select's prompt keeps
// misreading as hero select cannot hide a scoreboard for longer than that. An
// answer of LOBBY does not count: a lobby lasts as long as the queue does, it is
// no sign of a misread scoreboard, and counting it would use the run up before
// hero select had even started.
const DRAFT_RUN_MAX = 5;
// SKIP answers in a row that mean the reviewed scoreboard has gone. One is a
// glance away, a misread frame or an alt tab; two is eight seconds of something
// else.
const AWAY_READS = 2;
// A printed result waits for a second opinion (see onScoreboard): this many
// SKIPs in a row, or this long, and an unconfirmed one is dropped. The real end
// screen goes to the MVP and progress screens and then a menu within a minute.
const PENDING_AWAY_MAX = 6;
const PENDING_MS = 2 * 60 * 1000;

// The most a hero select countdown can read. It runs down from about thirty
// seconds (DRAFT_PROMPT). The end screen prints a time as well, the match's
// duration, and hero select's prompt, asked for "seconds left on the
// countdown", can hand that back as one: 754 for a twelve and a half minute
// match. Believed, that one number let a scoreboard pass as hero select, held a
// hero guessed off a portrait, and went quiet for DRAFT_COOLDOWN_MS while the
// scoreboard it was looking at went by unreviewed. A countdown has two digits.
const SELECT_TIMER_MAX = 99;

/** 'victory' or 'defeat' as the end screen prints it, or null. Nothing else ends a match. */
function matchResult(ctx) {
  const m = /^\s*(victory|defeat)\s*$/i.exec(String((ctx && ctx.result) || ''));
  return m ? m[1].toLowerCase() : null;
}

/**
 * A countdown as seconds: a number, a numeric string, or a clock such as
 * "0:12", which is how a countdown can be printed and so how a model copying
 * the screen can report it. Null for anything else.
 */
function countdownSeconds(t) {
  if (typeof t === 'number') return isFinite(t) ? t : null;
  if (typeof t !== 'string' || t.trim() === '') return null;
  const clock = /^(\d{1,2}):([0-5]\d)$/.exec(t.trim());
  if (clock) return Number(clock[1]) * 60 + Number(clock[2]);
  const n = Number(t);
  return isFinite(n) ? n : null;
}

/**
 * Did a hero select answer read something only hero select prints: a
 * countdown a hero select can show (SELECT_TIMER_MAX), or the SUGGESTED PICK
 * banner? Hero select's prompt is told the phase is always "draft", so the
 * phase alone proves nothing. Shown a scoreboard, it says draft, and it can
 * name a hero off a portrait that the roster check then passes. Believed on its
 * phase, that answer would erase the hero hero select really printed and put a
 * guessed one in the review.
 */
function readsAsSelect(ctx) {
  const secs = countdownSeconds(ctx && ctx.timer);
  const counting = secs !== null && secs >= 0 && secs <= SELECT_TIMER_MAX;
  return counting || !!readSuggested(ctx && ctx.suggested);
}

/**
 * The player's own row as the review reads it, or null when no scoreline was
 * read. Asked of buildReview itself, so the engine and the review can never
 * disagree about what counts as a scoreboard.
 */
function scorelineOf(ctx) {
  try {
    const r = buildReview({ state: ctx });
    return r && !r.empty ? r.scoreline : null;
  } catch {
    return null;
  }
}

class RivalsEngine extends EventEmitter {
  /**
   * @param opts { getKey, capture, log } the same shape the Valorant engine
   *        takes, so main/index.js can construct either from the registry.
   */
  constructor(opts = {}) {
    super();
    this.getKey = opts.getKey || (() => null);
    // Past matches, for the personal baseline the review compares against. A
    // default of none is the honest fallback: compareToHistory needs three
    // same-scope matches before it says anything, so no history simply means no
    // comparison rather than a wrong one.
    this.getHistory = opts.getHistory || (() => []);
    this.capture = opts.capture || (async () => null);
    this.log = opts.log || (() => {});
    // WHICH QUESTIONS THIS ENGINE IS ALLOWED TO ASK.
    //
    // The draft read gets teammate roles wrong, so it is off by default and the
    // engine never sends that request at all. That is stronger than gating the
    // tip afterwards: a request never made cannot produce a wrong answer, and it
    // does not spend a vision call to be thrown away.
    //
    // heroCapture is SEPARATE from draft and defaults on, because they are
    // different reads of the same screen and only one of them failed. The draft
    // tip is arithmetic over teammate ROLE ICONS, which the model miscounts. The
    // hero name is PRINTED IN LARGE TEXT on the left, and graded against a real
    // frame the model read it exactly right both times it was asked, on the same
    // day it scored 17 to 42% naming heroes from scoreboard portraits. Text is
    // not art. So the engine still asks the draft question, throws the tip away
    // while draft is off, and keeps the one field it can trust.
    this.features = { review: true, draft: false, heroCapture: true,
      ...(opts.features || {}) };
    this.running = false;
    this.paused = false;
    this.timer = null;
    // One probe at a time. resume() calls tick() directly, and a resume that
    // lands while a probe is in flight would otherwise start a second loop
    // beside the first.
    this.inFlight = false;
    // What the last answer that meant something said the screen was: 'lobby',
    // 'select' (hero select), 'scoreboard' or 'away' (SKIP: a match in progress,
    // or not the game at all). An answer that says nothing about the screen
    // leaves it alone. Null until the first one, which route() treats as the
    // menus, because that is where a player usually is when they press Start.
    this.seen = null;
    // Hero select questions in a row answered as anything but a lobby, for
    // DRAFT_RUN_MAX.
    this.draftRun = 0;
    // The last review emitted, and what has been read since. See onScoreboard().
    this.reviewed = null;
    // A scoreboard read once with a printed result, waiting for confirmation.
    this.pendingEnd = null;
    // A credits outage is said once, not once per probe.
    this.creditsWarned = false;
    this.recentTips = [];
    this.aiTipCount = 0;
    this.lastState = {};
    // The hero the player picked, read at hero select and held for the match.
    // Null until a draft is read, and NEVER inferred from anything else: no
    // other screen prints it.
    this.mine = null;
    // The session archive reads this on quit. Valorant fills it with per round
    // memory; Rivals has one review a match, so it stays empty rather than
    // absent, because an absent array is a crash and an empty one is a fact.
    this.matchMemory = [];
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.paused = false;
    this.emit('status', 'coaching');
    this.log('[rivals] started, probing every ' + (PROBE_MS / 1000) + 's');
    this.tick();
  }

  stop() {
    if (!this.running) return;
    this.running = false;
    this.paused = false;
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    // Stopped on the end screen: the result it printed is the match's, as a
    // menu after it would have confirmed.
    if (this.pendingEnd && Date.now() - this.pendingEnd.at < PENDING_MS) this.commitEnd(this.pendingEnd, false);
    this.pendingEnd = null;
    this.emit('status', 'stopped');
    this.log('[rivals] stopped');
  }

  schedule(ms) {
    // Not re-armed while paused. pause() clears the timer, and a probe that was
    // in flight when it landed would arm a new one on finishing, so paused would
    // no longer mean nothing is scheduled.
    if (!this.running || this.paused) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.tick(), ms);
  }

  /** One probe: capture, ask, act on whatever screen it turned out to be. */
  async tick() {
    if (!this.running || this.paused || this.inFlight) return;
    const key = this.getKey();
    if (!key) { this.schedule(PROBE_MS); return; }
    const route = this.route();
    // Every question this engine may ask is switched off.
    if (!route) { this.schedule(PROBE_MS); return; }

    this.inFlight = true;
    let next = PROBE_MS;
    try {
      let image = null;
      try { image = await this.capture(); } catch { image = null; }
      if (!image) return;

      const { ok, data } = await api.post(route, { image }, key, 30000);
      // A credits outage arrives as a 402, so it is read BEFORE the ok check.
      // Read after it, as it once was, the backoff never ran and the engine
      // kept asking every eight seconds through the whole outage.
      if (data && data.error === 'credits') { next = this.creditsOut(data); return; }
      if (!ok || !data) return;
      // The outage is over, so its line on the panel goes. A notice says what
      // is wrong NOW, and the controller takes one back only when the engine
      // sends its kind again with no text, which is how the Valorant engine
      // ends its own. Never sent, the credits line stayed up all session.
      if (this.creditsWarned) {
        this.creditsWarned = false;
        this.emit('notice', { kind: 'credits', text: null });
      }
      next = this.onReply(route, data, Date.now());
    } catch (e) {
      this.log('[rivals] probe failed: ' + e.message);
    } finally {
      this.inFlight = false;
      this.schedule(next);
    }
  }

  /** Report a credits outage honestly, once, and back off rather than looking broken. */
  creditsOut(data) {
    // retryIn is the server breaker's seconds left, and 0 means it is about to
    // close, so only a missing or broken value falls back to three minutes.
    const secs = Number(data.retryIn);
    const wait = Math.max(PROBE_MS, (data.retryIn != null && isFinite(secs) && secs >= 0 ? secs : 180) * 1000);
    this.log('[rivals] the AI is out of credits, next probe in ' + Math.round(wait / 1000) + 's');
    if (!this.creditsWarned) {
      this.creditsWarned = true;
      // The Valorant engine's words, so a player sees the same line in either game.
      this.emit('notice', { kind: 'credits', text: 'The coach AI is out of credits, so this match is not being read.' });
    }
    return wait;
  }

  /**
   * Which question this probe asks.
   *
   * IT FOLLOWS THE ORDER OF THE SCREENS, NEVER A TIMER. It used to be a timer:
   * ask hero select's question unless one had been answered in the last ninety
   * seconds. Only a hero select answer armed it, so through every match and on
   * every scoreboard it had expired, and with heroCapture on, as it ships, every
   * probe of every session asked hero select's question. The scoreboard was read
   * by a prompt with no field for a scoreline, and no Rivals match was ever
   * reviewed. Every unit test passed, because none of them played a match.
   *
   * The game fixes the order of its own screens. A lobby or a loading screen is
   * followed by hero select or by a match, never by a scoreboard. Hero select is
   * followed by a match, and a match ends on the scoreboard. So:
   *
   *   after a lobby, or during a hero select whose  hero select's, for at most
   *   name is not printed yet                       DRAFT_RUN_MAX probes in a row
   *   everything else: a match, the scoreboard,     the scoreboard's
   *   the scoreboard already reviewed
   *
   * A scoreboard is therefore only shown hero select's prompt after an answer
   * claimed a lobby, which on the end screen is a misread. readsAsSelect keeps
   * what that prompt says about it from being believed, and DRAFT_RUN_MAX gives
   * the screen back to the scoreboard's question in time.
   *
   * THE DEFAULT IS THE SCOREBOARD, because the two misses do not cost the same.
   * A missed hero select costs the hero's name, and the review says so in its
   * refusals. A missed scoreboard costs the whole match. Asking hero select's
   * question until a hero is held looks equivalent and is not: hero select is
   * missed whenever recording starts mid match or the name never prints, and
   * then the scoreboard is shown the wrong prompt as well.
   *
   * Which screen it was is still the model's answer, a protocol word or a
   * phase, never a local classifier, which would be a second thing that can be
   * wrong about the screen.
   */
  route() {
    const select = this.features.draft || this.features.heroCapture;
    if (!select) return this.features.review ? REVIEW_ROUTE : null;
    if (!this.features.review) return DRAFT_ROUTE;
    const selectNext = this.seen === null || this.seen === 'lobby'
      || (this.seen === 'select' && this.features.heroCapture && !this.mine);
    return selectNext && this.draftRun < DRAFT_RUN_MAX ? DRAFT_ROUTE : REVIEW_ROUTE;
  }

  /** Act on one answer, and say how long until the next probe. */
  onReply(route, data, now) {
    const tip = String(data.tip || '').trim();
    const ctx = data.context && typeof data.context === 'object' ? data.context : {};

    // Protocol, not coaching. The model correctly saying "this is not a draft"
    // must never reach a player or a tip counter. It is still the most useful
    // answer there is for choosing the next question.
    const word = /^(SKIP|LOBBY)$/i.exec(tip);
    const lobby = !!word && word[1].toUpperCase() === 'LOBBY';
    if (route !== DRAFT_ROUTE) this.draftRun = 0;
    else if (!lobby) this.draftRun++;
    if (word) {
      // A SKIP to hero select's question, while no hero is held and the last
      // screen was a lobby or hero select, leaves the screen where it was. A
      // hero select frame answered SKIP, the cut into it or an alt tab, used to
      // move the screen on and hand the rest of hero select to the scoreboard's
      // prompt, which reads no name, so one SKIP cost the hero for the match.
      // Neither screen is ever followed by a scoreboard, so staying costs
      // nothing, and DRAFT_RUN_MAX still moves on: the SKIP counted toward it,
      // so a match that has really started gets the scoreboard's question
      // within a few probes.
      const staying = !lobby && route === DRAFT_ROUTE && !this.mine
        && (this.seen === 'lobby' || this.seen === 'select');
      if (!staying) this.saw(lobby ? 'lobby' : 'away');
      return PROBE_MS;
    }

    let next = PROBE_MS;
    if (ctx.phase === 'draft') {
      // An answer that says hero select without reading anything only hero
      // select prints says nothing about the screen, so it changes nothing, and
      // DRAFT_RUN_MAX hands that screen to the scoreboard's question in time.
      if (readsAsSelect(ctx)) next = this.onSelect(route, ctx);
    } else if (ctx.phase === 'scoreboard') {
      if (route === DRAFT_ROUTE) {
        // Hero select's prompt is told the phase is always "draft". Saying
        // scoreboard anyway is worth believing, so the next question is the
        // scoreboard's. It reads no scoreline, so it can never make a review.
        this.saw('scoreboard');
      } else {
        // The scoreboard's prompt is told the phase is always "scoreboard", so
        // an answer without a scoreline says nothing about the screen: hero
        // select, the MVP screen and an unreadable scoreboard all look like it.
        const line = scorelineOf(ctx);
        if (line) {
          this.saw('scoreboard');
          this.onScoreboard(ctx, line, now);
        }
      }
    }
    this.lastState = ctx;

    this.offer(this.vet(tip, ctx), ctx, 'ai');
    return next;
  }

  /** A hero select answer: hold the hero it printed, and say when to probe next. */
  onSelect(route, ctx) {
    // A hero select read after anything but another hero select read is a NEW
    // one, and a hero held from the last one is stale. A match abandoned at hero
    // select or in loading never reaches a scoreboard, so nothing else would
    // ever forget it, and the next match's review would open naming it.
    if (this.seen !== 'select' && this.mine) {
      this.log('[rivals] a new hero select, so ' + this.mine + ' is forgotten');
      this.mine = null;
    }
    const asked = route === DRAFT_ROUTE;
    // Only hero select's own route checks the name against the closed roster
    // (confirmMine on the server), so only its answer may set the hero, and an
    // unreadable or invented name arrives absent rather than wrong. Held rather
    // than overwritten with null, because later probes land on screens that do
    // not print it.
    if (asked && this.features.heroCapture && ctx.mine) {
      if (ctx.mine !== this.mine) this.log('[rivals] hero read at draft: ' + ctx.mine);
      this.mine = ctx.mine;
    }
    this.saw('select');
    // Nothing more to learn here once the name is read, or, with only draft
    // advice on, once the screen has been read at all.
    if (asked && (!this.features.heroCapture || this.mine)) return DRAFT_COOLDOWN_MS;
    return PROBE_MS;
  }

  /** Record which screen an answer showed, and what that means for the last review. */
  saw(kind) {
    const last = this.reviewed;
    if (last) {
      if (kind === 'lobby' || kind === 'select') {
        // The way out of a scoreboard and into the next match.
        last.onScreen = false;
        last.newMatch = true;
        last.away = 0;
      } else if (kind === 'scoreboard') {
        last.away = 0;
      } else if (kind === 'away' && last.onScreen && ++last.away >= AWAY_READS) {
        last.onScreen = false;
      }
    }
    this.seen = kind;
    // A menu or hero select after a result was printed is the match over: the
    // way out of an end screen, never out of a scoreboard held open with Tab.
    const p = this.pendingEnd;
    if (p) {
      if (Date.now() - p.at > PENDING_MS) {
        this.pendingEnd = null;
      } else if (kind === 'lobby' || kind === 'select') {
        this.pendingEnd = null;
        this.commitEnd(p, false);
        this.reviewed.newMatch = true;
      } else if (kind === 'away' && ++p.away >= PENDING_AWAY_MAX) {
        this.log('[rivals] a printed result was never confirmed, so it was not the end of a match');
        this.pendingEnd = null;
      }
    }
  }

  /** Review a confirmed end of match. */
  commitEnd(p, onScreen) {
    this.reviewed = { at: Date.now(), key: p.key, onScreen, away: 0, newMatch: false };
    this.pushReview({ ...p.ctx, result: p.result });
  }

  /**
   * A scoreboard, read with a scoreline. Review it if it ends a match that has
   * not been reviewed yet.
   *
   * ONE SCOREBOARD IS ONE REVIEW. The end screen stays up for as long as the
   * player leaves it, and every probe reads it again. Each read used to become a
   * review: a fresh id, a library row, the window opened again and an entry in
   * rivalsHistory, so eighty seconds on the scoreboard filled the ten match
   * baseline with one match, and a pattern "seen in two matches" could be one
   * match seen twice. So a review is refused while any of these holds:
   *
   *   the scoreboard already reviewed is still on screen. Only a lobby, a hero
   *     select or AWAY_READS SKIPs in a row take it off (saw)
   *   it has the same result and scoreline as the last review: the same screen,
   *     looked away from and back at
   *   no lobby and no hero select has been read since the last review, and it
   *     is within REVIEW_COOLDOWN_MS of it: the same screen, read differently
   *
   * ONLY A PRINTED RESULT ENDS A MATCH. The scoreboard held open with Tab during
   * a match has every column the end screen has except VICTORY or DEFEAT, and
   * buildReview does not need a result, so now that the scoreboard's question is
   * asked all match, reviewing a Tab read would open the review window over a
   * match in progress. A real end read without its banner costs one probe, and
   * the next one reads it again.
   */
  onScoreboard(ctx, line, now) {
    const last = this.reviewed;
    if (last && last.onScreen) return;
    const result = matchResult(ctx);
    if (!result) {
      this.log('[rivals] a scoreboard with no result printed, so not the end of a match');
      return;
    }
    const key = JSON.stringify([result, line]);
    let why = null;
    if (last && last.key === key) why = 'the same result and scoreline as the last review';
    else if (last && !last.newMatch && now - last.at < REVIEW_COOLDOWN_MS) {
      why = 'no lobby or hero select has been read since the last review';
    }
    if (why) {
      last.onScreen = true;
      last.away = 0;
      this.log('[rivals] not reviewed again: ' + why);
      return;
    }
    // ONE READ OF A RESULT IS NOT THE END. A scoreboard held open with Tab mid
    // match prints no result, but the model can still answer one, and a single
    // such read opened the review window over the match. So a result waits for
    // a second read of the same scoreboard, or for the menu or hero select the
    // end screen leads to, and is dropped if play carries on instead.
    const p = this.pendingEnd;
    if (p && p.key === key) {
      this.pendingEnd = null;
      this.commitEnd({ ...p, ctx }, true);
      return;
    }
    this.pendingEnd = { key, ctx, result, at: now, away: 0 };
  }

  /**
   * THE DRAFT GATE, on the client, which is where every guard in this codebase
   * lives. coach.js parses and coaching-engine.js decides; rivals.js parses and
   * this decides. Keeping it here also keeps the server deployable, since only
   * server/ ships and a require reaching into src/ throws on Railway.
   *
   * A blocked tip is replaced rather than dropped. The player has eleven seconds
   * of hero select left, so a blank overlay helps nobody, and the replacement is
   * arithmetic over a roster the guard has already agreed is trustworthy.
   */
  vet(tip, ctx) {
    // THE ABILITY GATE RUNS FIRST, and on every phase, because it is a truth
    // gate rather than a draft one. Telling a Punisher to Web-Swing is wrong on
    // a scoreboard for the same reason it is wrong at hero select, and it is
    // the one thing a player can catch the coach out on instantly: they look at
    // their own keys and the button is not there.
    //
    // It permits everything while the hero is unknown, which is most of the
    // time, so it costs nothing on a match where hero select was missed.
    const spell = validateTipForHero(tip, this.mine);
    if (!spell.ok) {
      this.log(`[rivals] tip blocked: names ${spell.ability}, which is `
        + `${spell.owner}'s, and the player is on ${this.mine}`);
      return '';
    }

    if (!ctx || ctx.phase !== 'draft') return tip;      // reviews are not gated on a roster
    // ASKING IS NOT SPEAKING. With draft advice off the engine still sends the
    // draft request, because that screen is the only place the player's hero is
    // printed, but the sentence that comes back is built on the teammate role
    // count and that is the part that reads wrong. Drop it here, unconditionally
    // and before any other judgement, rather than trusting draftTipAllowed to
    // catch every case of a read this flag already says is not trusted.
    if (!this.features.draft) return '';
    const draft = { locked: Array.isArray(ctx.locked) ? ctx.locked : [], suggested: ctx.suggested };
    const verdict = draftTipAllowed(tip, draft);
    if (verdict.ok) return tip;

    this.log('[rivals] draft tip blocked: ' + verdict.why);
    const advice = draftAdvice(draft);
    return advice ? `Lock a ${advice.role}, ${advice.why}.` : '';
  }

  /**
   * Show a tip, unless it repeats one the player just read.
   *
   * Rivals sends so few tips that repetition is more glaring here than in
   * Valorant, not less: two drafts in a row producing the same sentence is the
   * entire coaching experience for that session.
   */
  offer(text, ctx, source) {
    // Protocol words are filtered in tick() too. Repeated here because a
    // protocol word rendered as a coaching card is a visible, embarrassing bug,
    // and this is the last gate before the overlay.
    if (/^(SKIP|LOBBY)$/i.test(String(text || '').trim())) return;

    const clean = cleanTip(text);
    if (!clean) return;
    // overlapRatio compares SETS from tipWords, not strings. Handing it strings
    // reads .size as undefined and returns 0 every time, so every repeat gets
    // through and the anti-repeat looks like it is working.
    const words = tipWords(clean);
    if (this.recentTips.some((t) => overlapRatio(words, t) > 0.6)) {
      this.log('[rivals] dropped a repeat');
      return;
    }
    this.aiTipCount++;
    this.recentTips.push(words);
    if (this.recentTips.length > 6) this.recentTips.shift();
    this.emit('tip', { text: clean, source, game: 'rivals', phase: (ctx && ctx.phase) || null });
  }

  /**
   * Build the post match review and hand it up, then forget the hero.
   *
   * THE FORGETTING IS THE PART THAT MATTERS. this.mine is read once at hero
   * select and held for the whole match, because later probes land on screens
   * that do not print it. A scoreboard means the match is over, so carrying the
   * name any further means the NEXT match opens its review naming the hero from
   * the last one. That is the worst kind of wrong: confidently specific, about
   * the one line the player checks first, and invisible in every test that only
   * ever plays one match.
   *
   * The review is built here rather than in main/index.js because it is a
   * judgement about what is fit to show, and every judgement in this codebase
   * lives on the client beside the guards.
   */
  pushReview(ctx) {
    let review = null;
    try {
      let history = [];
      try { history = this.getHistory() || []; } catch { history = []; }
      review = buildReview({ hero: this.mine, state: ctx, history });
    } catch (e) {
      this.log('[rivals] review build failed: ' + e.message);
    }
    // Forget in a finally sense: a review that threw must not leave a stale hero
    // armed for the next match either.
    this.mine = null;
    if (review && !review.empty) this.emit('review', review);
    else if (review) this.log('[rivals] no review: ' + review.why);
  }

  /**
   * The switch call, on demand rather than on a clock.
   *
   * This is where counter picking lives, because it is the first point at which
   * the enemy team is actually visible. Hero select never shows it, which the
   * capture frames settled and the draft prompt is written around.
   */
  async switchCall() {
    const key = this.getKey();
    if (!key) return { error: 'No license active.' };
    let image = null;
    try { image = await this.capture(); } catch { image = null; }
    if (!image) return { error: 'Could not capture the screen.' };
    try {
      const { ok, data } = await api.post('/api/rivals/review', { image }, key, 30000);
      if (!ok || !data || !data.tip) return { error: 'No answer came back.' };
      return { tip: data.tip, context: data.context || {} };
    } catch (e) {
      return { error: 'Could not reach the coach.' };
    }
  }

  // ── The rest of the engine contract ────────────────────────────────────────
  //
  // main/index.js drives whichever engine is running through one interface, and
  // a missing method is not a quiet no-op: pushTip calls getMix() on every tip,
  // so the first Rivals tip crashed the main process with "getMix is not a
  // function" while every unit test passed. Unit tests exercised the class; only
  // booting the app exercised the CONTRACT.
  //
  // Each of these is implemented honestly rather than stubbed to satisfy a
  // caller. Where Rivals has no equivalent concept the method does nothing and
  // says why, which is different from pretending the feature exists.

  /** Tip provenance, for the session archive. Rivals has no library fallback. */
  getMix() {
    return { ai: this.aiTipCount, library: 0, aiShare: this.aiTipCount ? 1 : 0 };
  }

  /** Push a tip in from outside, used for system messages. */
  emitTip(text, source = 'system') {
    this.emit('tip', { text: String(text || ''), source, game: 'rivals', phase: null });
  }

  /** The manual "coach me now" button: take a frame and read it immediately. */
  requestTip() { if (this.running) this.tick(); }

  /**
   * Pause and resume say so, in the Valorant engine's words, because the
   * controller tracks a pause by the 'status' event and by nothing else. They
   * used to be silent: the controller never learned the session was paused, so
   * every press of pause called pause() again, resume() could not be reached,
   * and nothing was read for the rest of the session while the panel still
   * showed it recording.
   */
  pause() {
    if (!this.running || this.paused) return;
    this.paused = true;
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    this.emit('status', 'paused');
    this.log('[rivals] paused');
  }

  resume() {
    if (!this.running || !this.paused) return;
    this.paused = false;
    this.emit('status', 'coaching');
    this.log('[rivals] resumed');
    this.tick();
  }

  noteBadTip() { /* Rivals sends too few tips for a three strike list to mean anything yet. */ }

  // Valorant reads the player's agent to gate ability advice. Rivals coaching is
  // role-shaped rather than hero-shaped, and the hero read is not reliable
  // enough to gate on, so these are accepted and ignored rather than acted on.
  setAgent() {}
  confirmAgent() {}

  // Habits, performance summaries and rank stats are all Valorant-shaped inputs
  // built from its own session history. Rivals has no equivalent record yet, and
  // feeding it Valorant's would describe the wrong game.
  setHabits() {}
  setPerformanceMode() {}
  setPerformanceSummary() {}
  setPlayerStats() {}

  /** What the diagnostics panel and the AI log ask for. */
  snapshot() {
    const raw = Array.isArray(this.lastState.locked) ? this.lastState.locked : [];
    // Advice is computed from the RAW roster, never the filtered one. Filtering
    // the unreadable entries out first hides them from the trust check, so a
    // roster the coach only half read looks complete and gets confident advice.
    // The filtered list is for DISPLAY only.
    const onlyDraft = this.lastState.phase === 'draft';
    return {
      game: 'rivals',
      running: this.running,
      phase: this.lastState.phase || null,
      map: this.lastState.map || null,
      locked: raw.map(normaliseRole).filter(Boolean),
      // No draft has been read means there is nothing to advise on, which is a
      // different thing from a draft where nobody has locked in yet.
      advice: onlyDraft ? draftAdvice({ locked: raw, suggested: this.lastState.suggested }) : null,
      tipsShown: this.recentTips.length,
    };
  }
}

module.exports = { RivalsEngine, PROBE_MS, DRAFT_COOLDOWN_MS, REVIEW_COOLDOWN_MS,
  DRAFT_RUN_MAX, AWAY_READS, DRAFT_ROUTE, REVIEW_ROUTE, SELECT_TIMER_MAX };
module.exports.__test = { matchResult, scorelineOf, readsAsSelect, countdownSeconds };

'use strict';

const EventEmitter = require('events');
const api = require('./api-client');
const agentData = require('./agent-data');
const { API, TIMING, CAPTURE_TIERS } = require('../../shared/config');

// Reads allowed in flight at once: two until the read's latency is measured,
// then as many as its p90 needs to keep the gap (inFlightLimit), never past
// four. At a fixed two, a read a second held only while p90 stayed under 2.2
// seconds, and auto ran at two seconds falling to three on real sessions. Four
// covers a slow model without letting it build a queue of stale frames.
const MIN_IN_FLIGHT = 2;
const MAX_IN_FLIGHT = 4;
// How long a read is waited for. The server gives up on one at 9 seconds
// (READ_TIMEOUT_MS in server/routes/coach.js), so a read still out at 12 will
// never be answered, and replies are applied in capture order: at the 30
// seconds every other call gets, one hung read held every reply behind it
// that long.
const READ_TIMEOUT_MS = 12000;
const spectate = require('../../shared/spectate-tells');
const { RoundLedger, clockSeconds, isBuyPhase, BUY_MAX_LEFT } = require('../../shared/valorant-rounds');
const { MatchEndWatch, isFinalScore } = require('../../shared/match-end');
const valorantReview = require('../../shared/valorant-review');

/**
 * The match reader. Lives in the main process; the heavy screen capture runs in
 * a Worker Thread (injected as captureFunction) so the game never stalls.
 *
 * It reads the game and says NOTHING during a match. Every read goes through
 * the guards in updateMatchContext into the round ledger, and when the match
 * ends the review is written from that ledger.
 *
 * Emits:
 *   'status'       'coaching' | 'paused' | 'stopped'
 *   'notice'       { kind, text } a problem worth one line on the panel
 *   'cadence'      the current gap between reads, in ms
 *   'agent'        the detected or confirmed agent
 *   'match-ended'  snapshot, the moment a match is over or recording stops
 *   'match-review' (reviewText, snapshot) once the narrative is written
 *   'match-resumed' { startedAt, from } the last end was wrong, its review is void
 */
class CoachingEngine extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.licenseKey      = opts.licenseKey || '';
    this.captureFunction = opts.captureFunction || null;
    // How often the game is read. 'auto' starts at the fastest tier and steps
    // with measured latency; a number pins it (from Settings).
    this.captureSpeed = CAPTURE_TIERS.includes(Number(opts.captureSpeed)) ? Number(opts.captureSpeed) : 'auto';
    this.gapMs = this.captureSpeed === 'auto' ? CAPTURE_TIERS[0] : this.captureSpeed;
    this.inFlight = 0;
    this.seq = 0;
    this.nextSeq = 0;
    this.pending = new Map();
    this.latencies = [];
    this.readErrors = 0;
    this.lastSendAt = 0;
    this.rateLimitedAt = 0;   // the server's read limiter last answered 429
    this.captureTimes = [];   // the capture helper's time per frame, for the log
    this.lastNote = null;
    // Experimental settings, read live from the store so a settings flip
    // applies to the very next capture: { proPlaybook: 'off'|'on'|'hybrid' }.
    this.experiments = typeof opts.experiments === 'function' ? opts.experiments : () => ({});
    // AI decision log: gets { at, image, state, tip, shown } per analyzed frame,
    // for the "what did the coach see and say" viewer. No-op when not provided.
    this.diagnostics = typeof opts.diagnostics === 'function' ? opts.diagnostics : null;

    this.matchContext = freshContext();

    this.isRunning   = false;
    this.isCapturing = false;
    this.paused      = false;
    this.shouldAbort = false;
    this.lastCaptureTime = 0;

    this.lastServerStatus = null; // last HTTP status (0 = network/unreachable)
    this.warnedFailure    = false; // one-time server "why no AI tips" notice
    this.failStreak       = 0;     // consecutive analyze failures (1 is a hiccup, 2+ is real)
    this.aiCreditsOutAt   = 0;     // when the AI last reported out of credits (402), 0 = fine
    this.warnedCapture    = false; // one-time capture-failure notice
    this.lastAuthSuspect  = 0;     // throttle for 401/403 -> license re-check

    this.enemyHistory  = [];      // recent enemy spots/angles the AI reported
    this.lastWarnedSpot = null;   // de-dupe the "they keep peeking X" warning
    this.lastPhaseChange = null;  // { from, to, at }: round-transition awareness
    this.inLobby        = false;  // server saw a menu/lobby: silence ALL tips
    this.matchMemory    = [];     // running log of the match (rounds, streaks, reads)
    this.playerNotes    = [];     // observed FACTS about what the player did on screen
    this.analyzedFrames = 0;      // frames analyzed this session (warm-up gate)
    this.lastDeathAt    = 0;      // when the player last died (death-review window)
    this.deathTipsSent  = 0;      // coaching tips shown since that death (capped, then silence)
    this.lastRoundLostAt = 0;     // when the team last lost a round (round-review window)
    this.aliveFalseStreak = 0;    // consecutive alive:false reads (2 confirm a death)
    this.firstHalfSide    = null; // locked first-half side; halftime flip is then arithmetic
    this.pendingFirstSide = null; // needs two agreeing reads before locking
    this.lockedSide       = null; // sticky side for the window halftime math cannot cover
    this.sideChallenge    = null; // a contradicting side read waiting for a second opinion
    this.pendingMap       = null; // map needs two agreeing reads before locking
    // Game mode decides the halftime math: swiftplay halves are 4 rounds,
    // unrated/competitive halves are 12. Locked from two agreeing HUD reads,
    // from score/round arithmetic (a 6th round win or a 10th round can only
    // be a standard match), from round 5's buy phase (a pistol round only in
    // swiftplay), or from a side swap read in the buy phase of rounds 5-8.
    this.pendingMode      = null; // vision-reported mode awaiting a 2nd agreeing read
    this.standardEvidence = 0;    // consecutive frames whose score/round prove standard
    this.swapEvidence     = 0;    // consecutive flipped buy phase side reads in rounds 5-8
    this.economyEvidence  = 0;    // round 5 buy reads with more than pistol credits (standard)
    this.pistolEvidence   = 0;    // round 5 buy reads with a pistol round's timer (swiftplay)
    this.buyAtFiveEvidence = 0;   // buy phases with a team on 5 wins (standard)
    this.firstHalfLockedAt = null; // the round the first-half side was locked in

    // THE MATCH, as the post-match review will tell it. The ledger records each
    // round from the guarded context, the watch decides when the match is
    // over, and matchStartedAt marks which tips belong to this match rather
    // than to the one before it in the same session.
    this.ledger = new RoundLedger();
    this.endWatch = new MatchEndWatch();
    this.matchStartedAt = Date.now();
    // The match the watch just ended, kept until a new one shows itself in case
    // it was not over (RESUME in match-end.js), and what was read since, so a
    // resumed match loses nothing.
    this.endedMatch = null;
    this.afterEnd = [];

    this.timers = [];
    this.loopTimer = null;
    this.agentTimer = null;
  }

  // ── lifecycle ───────────────────────────────────────────────────────────────
  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this.paused = false;
    this.shouldAbort = false;
    this.matchContext = freshContext();
    this.inFlight = 0;
    this.seq = 0;
    this.nextSeq = 0;
    this.pending = new Map();
    this.latencies = [];
    this.readErrors = 0;
    this.lastSendAt = 0;
    this.rateLimitedAt = 0;
    this.captureTimes = [];
    this.warnedFailure = false;
    this.warnedCapture = false;
    this.failStreak = 0;
    this.enemyHistory = [];
    this.lastWarnedSpot = null;
    this.lastPhaseChange = null;
    this.inLobby = false;
    this.matchMemory = [];
    this.playerNotes = [];
    this.analyzedFrames = 0;
    this.lastDeathAt = 0;
    this.deathTipsSent = 0;
    this.firstHalfSide = null;
    this.pendingFirstSide = null;
    this.lockedSide = null;
    this.sideChallenge = null;
    this.pendingMap = null;
    this.scoreboardChallenge = null;   // pending implausible round/score read
    this.lastScoreAt = 0;              // when a round/score read was last believed, for the rate ceiling
    this.seenLabels = [];              // location labels the game printed, for map fingerprinting
    this.mapConfirmedByLabels = false; // once true, the model cannot change the map
    this.mapDoubt = 0;                 // else a stale doubt keeps blocking callouts
    this.mapChallenger = null;
    this.aliveFalseStreak = 0;
    this.pendingMode = null;
    this.standardEvidence = 0;
    this.swapEvidence = 0;
    this.economyEvidence = 0;
    this.pistolEvidence = 0;
    this.buyAtFiveEvidence = 0;
    this.firstHalfLockedAt = null;
    this.emit('status', 'coaching');
    this.ledger = new RoundLedger();
    this.endWatch = new MatchEndWatch();
    this.matchStartedAt = Date.now();
    this.endedMatch = null;
    this.afterEnd = [];

    this.armAgentDetection();

    // A short heartbeat decides when the next read goes out; the gap and the
    // in-flight limit live in tick(), so the cadence can change mid match.
    this.loopTimer = setInterval(() => this.tick(), 200);
    this.emit('cadence', this.gapMs);

    console.log('[engine] started, reading every', this.gapMs, 'ms (', this.captureSpeed, '), key', this.licenseKey ? 'set' : 'MISSING');
  }

  stop() {
    if (!this.isRunning) return;
    this.isRunning = false;
    this.shouldAbort = true;
    this.timers.forEach(clearTimeout); this.timers = [];
    if (this.loopTimer)  { clearInterval(this.loopTimer);  this.loopTimer = null; }
    if (this.agentTimer) { clearInterval(this.agentTimer); this.agentTimer = null; }
    this.pending.clear();
    this.emit('status', 'stopped');

    // A match the watch already ended has had its review. Anything since, a
    // match stopped halfway included, gets one for the rounds it watched.
    if (!this.endWatch.ended) {
      // A final score read but not yet settled is still a score end: the
      // player stopped on the end screen. Not a swiftplay one, whose mode is
      // the weakest fact the engine has.
      const p = this.endWatch.pendingFinal;
      // Or a final score read once, on the banner, with only menus after it,
      // or on the very last frame read: the player stopped on the banner.
      const fc = this.finalCandidate;
      const candidate = !p && !!fc && (this.inLobby || fc.frame === this.analyzedFrames)
        && this.adoptFinalCandidate();
      const snap = this.matchSnapshot((p && !p.swift) || candidate ? 'score' : 'stop');
      // Stopped with a round on screen rather than a menu or an end screen: the
      // match is most likely still being played, so its review must not open
      // over it (the player restarting to fix tracking, say).
      if (snap) snap.stoppedLive = !this.inLobby && !p && !candidate;
      if (snap) this.requestMatchReview(snap);
    }
    console.log('[engine] stopped');
  }

  /**
   * Find the player's agent: a detection shortly after the match is seen, a
   * retry until one locks, and a prompt to the player if none has after nine
   * seconds. At session start, and again after every match, because the next
   * match is usually on a different agent.
   */
  armAgentDetection() {
    if (this.agentTimer) { clearInterval(this.agentTimer); this.agentTimer = null; }
    this.timers.push(setTimeout(() => this.isRunning && this.detectAgent(), TIMING.agentDetectFirst));
    this.agentTimer = setInterval(() => {
      if (!this.isRunning) return;
      if (this.matchContext.agent) { clearInterval(this.agentTimer); this.agentTimer = null; return; }
      this.detectAgent();
    }, TIMING.agentDetectRetry);

    // If detection hasn't locked an agent shortly after the first attempt, ask
    // the player directly (panel switches the bubble to a "type your agent" field).
    this.timers.push(setTimeout(() => {
      if (this.isRunning && !this.matchContext.agent) this.emit('agent', this.agentInfo());
    }, 9000));
  }

  // ── the match, for the review ──────────────────────────────────────────────

  /**
   * Record one analysed frame into the round ledger, and end the match when
   * the watch says it is over.
   *
   * Called after processAIResponse, so everything read here has already been
   * through the guards: the spectator merge, HP beats death, the scoreboard
   * continuity check. `died` is true only on the frame a death was REGISTERED,
   * which is the engine's own debounced decision, never the raw alive flag.
   */
  recordFrame({ lobby, died }) {
    const at = Date.now();
    if (lobby) {
      const w = this.endWatch.lobby({ at, rounds: this.ledger.size() });
      if (w && w.kind === 'end') this.endMatch(w.reason);
      return;
    }
    const c = this.matchContext;
    const seen = {
      at, team: c.teamScore | 0, enemy: c.enemyScore | 0, side: c.side, phase: c.phase,
      alive: c.playerAlive, died: !!died, deathSpot: c.deathSpot,
      clock: c.clock, ult: c.playerUlt, spike: c.spike, spikeSpot: c.spikeSpot,
      loc: c.locLabel || c.playerSpot,
      // What the player was SEEN doing this frame, a fact. It fills the round's
      // "what the coach saw" lines, which live tips used to fill.
      note: this.lastNote,
    };
    const w = this.endWatch.play({
      team: seen.team, enemy: seen.enemy, mode: c.gameMode, phase: c.phase, clock: c.clock, map: c.map,
      scoreRead: this.scoreReadThisFrame !== false, at,
    });
    if (w && w.kind === 'end') { this.endMatch(w.reason); return; }
    if (w && w.kind === 'ignore') {
      // Kept while the ended match might still resume. Bounded, because a
      // session can sit on an end screen or in a deathmatch for a long time.
      if (this.endedMatch) {
        this.afterEnd.push(seen);
        if (this.afterEnd.length > 600) this.afterEnd.shift();
      }
      return;
    }
    if (w && w.kind === 'resume') this.resumeMatch(w.from);
    // The agent is NOT reset here: endMatch already did, and the player may
    // have confirmed the new one in the panel before this first frame landed.
    if (w && w.kind === 'new-match') {
      this.endedMatch = null;
      this.afterEnd = [];
      this.beginMatch(false);
    }
    // A frame that reads as the NEXT match's first, waiting for a second read
    // before the reset, carries this match's held score: filed here it was a
    // round bought at 13-12 that nobody played.
    if (this.newMatchReads > 0) return;
    this.ledger.observe(seen);
  }

  /** Everything the review needs about the match so far, or null if too thin. */
  matchSnapshot(endedBy) {
    const c = this.matchContext;
    const lastRound = endedBy === 'score' ? (c.teamScore | 0) + (c.enemyScore | 0) : null;
    const rounds = this.ledger.list(lastRound);
    if (!rounds.length) return null;
    return {
      endedBy,
      rounds,
      tips: [],
      notes: this.playerNotes.slice(-20),
      context: { ...c, proPlaybook: this.experiments().proPlaybook || 'off',
        advancedTips: this.experiments().advancedTips === true,
        language: this.experiments().language || 'en' },
      startedAt: this.matchStartedAt,
      endedAt: Date.now(),
    };
  }

  /** The match is over: review it, then get ready for the next one. */
  endMatch(reason) {
    // The banner read the final score once and the end screen then read as
    // menus: the menu path ended it, and the score it ended on is that one.
    if (reason === 'lobby' && this.adoptFinalCandidate()) {
      reason = 'score';
      const c = this.matchContext;
      this.endWatch.adoptFinal(c.teamScore | 0, c.enemyScore | 0);
    }
    this.finalCandidate = null;
    const snap = this.matchSnapshot(reason);
    console.log(`[engine] match over (${reason}), ${snap ? snap.rounds.length : 0} rounds recorded`);
    const c = this.matchContext;
    this.endedMatch = {
      ledger: this.ledger, startedAt: this.matchStartedAt,
      notes: this.playerNotes.slice(), memory: this.matchMemory.slice(),
      agent: c.agent, agentConfirmed: c.agentConfirmed, snap,
    };
    this.afterEnd = [];
    this.beginMatch(true);
    if (snap) this.requestMatchReview(snap);
  }

  /**
   * A FINAL SCORE READ ONCE. A step forward needs two agreeing reads, and at a
   * read a second the round end banner of the last round is often read once
   * before the end screen, which reads as a menu: the real 13 to 11 Abyss match
   * read 13-11 on its last frame only, and ended 45 seconds later on the menu
   * path at 12-11 with no result. So that one read is kept (finalCandidate)
   * and, when nothing but menus came after it, it is the score the match ended
   * on. It is never taken while a round could still be on: a later read of
   * another score, or a buy phase, drops it.
   *
   * @returns true when the candidate was applied to the context and the ledger
   */
  adoptFinalCandidate() {
    const f = this.finalCandidate;
    this.finalCandidate = null;
    if (!f) return false;
    const c = this.matchContext;
    if ((c.teamScore | 0) > f.team || (c.enemyScore | 0) > f.enemy) return false;
    console.log(`[engine] the final score ${f.team}-${f.enemy} was read once on the banner, then only menus: the match ended on it`);
    c.teamScore = f.team;
    c.enemyScore = f.enemy;
    c.roundNumber = f.team + f.enemy + 1;
    // One observation at the final score, so the last round gets its result.
    this.ledger.observe({ at: Date.now(), team: f.team, enemy: f.enemy, side: c.side, phase: null,
      alive: c.playerAlive, died: false, clock: null });
    return true;
  }

  /**
   * A new match began while the watch still thought the last one was running
   * (a remake, an unrated 13-12 or a surrender whose menus were never read).
   * The last one is reviewed into the library and never opened over the new
   * one, or dropped when it is too short to review, like the menu path does.
   */
  closeUnendedMatch() {
    const enough = this.ledger.size() >= this.endWatch.minRounds;
    const snap = enough ? this.matchSnapshot('next-match') : null;
    console.log(`[engine] the last match was never seen ending: `
      + (snap ? `reviewing its ${snap.rounds.length} rounds` : 'too short to review'));
    this.endWatch.reset();
    this.endedMatch = null;
    this.afterEnd = [];
    this.beginMatch(true);
    if (snap) this.requestMatchReview(snap);
  }

  /**
   * The watch ended a match that was still being played. Put it back as it
   * was, with every frame read since, and tell the app, which withdraws the
   * review it opened too early. The next end reviews the whole match.
   */
  resumeMatch(from) {
    const m = this.endedMatch;
    const since = this.afterEnd;
    this.endedMatch = null;
    this.afterEnd = [];
    if (!m) return;
    if (m.snap) m.snap.voided = true;   // a review still being written never opens
    console.log(`[engine] the match was not over (ended by ${from}), resuming it with its ${m.ledger.size()} rounds`
      + ` and the ${since.length} frames read since`);
    this.ledger = m.ledger;
    this.matchStartedAt = m.startedAt;
    this.playerNotes = m.notes.concat(this.playerNotes).slice(-25);
    this.matchMemory = m.memory.concat(this.matchMemory).slice(-16);
    for (const seen of since) this.ledger.observe(seen);
    // The match's own agent, unless the player confirmed another since. The
    // false end reset it and armed detection, and a detection in the gap left
    // the resumed match on an unconfirmed (or wrong) agent for the rest of it.
    const ctx = this.matchContext;
    if (m.agent && (!ctx.agent || (m.agentConfirmed && !ctx.agentConfirmed))) {
      ctx.agent = m.agent;
      ctx.agentConfirmed = m.agentConfirmed;
      if (this.agentTimer) { clearInterval(this.agentTimer); this.agentTimer = null; }
      this.emit('agent', this.agentInfo());
    }
    this.emit('match-resumed', { startedAt: m.startedAt, from });
  }

  /**
   * A clean slate for the next match in the same session.
   *
   * The agent goes too. It used to survive for the whole session, which was
   * harmless while one session was one match, and wrong now that the app
   * sits running between matches: the second match's review would name the
   * first match's agent, and the ability gate would check the wrong kit.
   */
  beginMatch(resetAgent) {
    this.ledger = new RoundLedger();
    this.matchStartedAt = Date.now();
    this.playerNotes = [];
    this.matchMemory = [];
    if (resetAgent && this.matchContext.agent) {
      this.matchContext.agent = null;
      this.matchContext.agentConfirmed = false;
      this.emit('agent', this.agentInfo());
      if (this.isRunning) this.armAgentDetection();
    }
  }

  pause() {
    if (!this.isRunning || this.paused) return;
    this.paused = true;
    this.emit('status', 'paused');
    console.log('[engine] paused');
  }

  resume() {
    if (!this.isRunning || !this.paused) return;
    this.paused = false;
    this.emit('status', 'coaching');
    console.log('[engine] resumed');
  }

  // ── the live read ───────────────────────────────────────────────────────────
  /**
   * READING THE GAME, NEVER COACHING IT. Occlara shows nothing during a match:
   * each frame's only job is to report the HUD (POST /api/coach/read), and the
   * review writes the coaching once the match is over.
   *
   * UP TO FOUR READS IN FLIGHT, PROCESSED IN CAPTURE ORDER. A read takes one to
   * five seconds depending on the model, so one at a time capped the capture
   * rate at the model's latency, and two capped a read a second at a p90 of 2.2
   * seconds. How many may be out follows the measured latency (inFlightLimit).
   * Replies can come back out of order, and the round ledger, the death edge
   * and the scoreboard continuity guard all assume time runs forwards, so
   * replies wait in `pending` until every earlier one has been applied.
   *
   * What that costs is the context a read carries (readContext), the state as
   * of the last APPLIED reply: with four out it is four reads old, the same four
   * seconds two out at a two second gap gave, and older while a slow reply holds
   * the order, which is the other reason a read gives up at 12 seconds. The
   * prompt gives it as context only, the current frame deciding every field,
   * and every guard judges a reply against the state it lands on, never the one
   * it was sent with. bench:read -- --lag 4 measures the read on it.
   *
   * THE GAP ADAPTS, "the fastest the pipeline can sustain" rather than a fixed
   * number: tiers from CAPTURE_TIERS, stepping slower when p90 latency exceeds
   * what four in flight can cover, when three reads fail in a row, or when the
   * server answers 429 (which also stops sending for ten seconds), and faster
   * again when there is clear headroom. A manual speed in Settings pins it.
   */
  tick() {
    if (!this.isRunning || this.paused || this.isCapturing) return;
    if (this.aiCreditsOutAt && Date.now() - this.aiCreditsOutAt < AI_CREDITS_BACKOFF_MS) return;
    if (this.rateLimitedAt && Date.now() - this.rateLimitedAt < RATE_LIMIT_PAUSE_MS) return;
    if (this.inFlight >= this.inFlightLimit()) return;
    if (Date.now() - this.lastSendAt < this.gapMs) return;
    this.sendRead();
  }

  /**
   * How many reads may be out at once: enough for the measured p90 to cover
   * the gap with one to spare, at least two and at most four. Two before any
   * latency is measured, which is where a fixed limit always stood.
   */
  inFlightLimit() {
    if (!this.latencies.length) return MIN_IN_FLIGHT;
    const need = Math.ceil(quantile(this.latencies, 0.9) / this.gapMs) + 1;
    return Math.min(MAX_IN_FLIGHT, Math.max(MIN_IN_FLIGHT, need));
  }

  async sendRead() {
    const seq = this.seq++;
    const sentAt = Date.now();
    this.lastSendAt = sentAt;
    this.inFlight++;
    let result = { failed: true };
    try {
      let shot = null;
      this.isCapturing = true;
      try { shot = await this.captureFunction(); }
      catch (e) { console.error('[engine] capture error:', e.message); }
      finally { this.isCapturing = false; }
      if (this.shouldAbort) return;
      if (!shot) { this.onCaptureFailed(); return; }
      this.noteCapture(Date.now() - sentAt);
      // A notice says what is wrong NOW. Once capture or the server works
      // again, the line on the panel goes, rather than warning all session.
      if (this.warnedCapture) this.emit('notice', { kind: 'capture', text: null });
      this.warnedCapture = false;

      const at = Date.now();
      const { data, status } = await this.callServer(API.READ, { image: shot, context: this.readContext() },
        { timeoutMs: READ_TIMEOUT_MS });
      if (this.shouldAbort) return;
      if (!data) {
        this.onReadFailed();
        // A 429 has a rule of its own. Counted as failed reads too, three
        // refused together stepped the cadence down twice for one refusal.
        if (status === 429) this.onRateLimited();
        else this.noteLatency(null);
        return;
      }
      if (this.warnedFailure) this.emit('notice', { kind: 'read-failed', text: null });
      this.warnedFailure = false;
      this.failStreak = 0;
      this.noteLatency(Date.now() - at);
      result = { data, shot, at };
    } catch (e) {
      console.error('[engine] read error:', e.message);
    } finally {
      this.inFlight--;
      if (!this.shouldAbort) {
        this.pending.set(seq, result);
        this.drain();
      }
    }
  }

  /** Apply finished reads strictly in the order they were captured. */
  drain() {
    while (this.pending.has(this.nextSeq)) {
      const r = this.pending.get(this.nextSeq);
      this.pending.delete(this.nextSeq);
      this.nextSeq++;
      if (!r.failed) this.applyRead(r);
    }
  }

  applyRead({ data, shot, at }) {
    this.analyzedFrames++;
    const deathBefore = this.lastDeathAt;
    this.processRead(data);
    const died = this.lastDeathAt !== deathBefore;
    // The round ledger and the match-end watch. Guarded, because a bug in the
    // review's bookkeeping must never cost the reader its next frame.
    try {
      this.recordFrame({ lobby: this.inLobby, died });
    } catch (e) { console.log('[engine] round ledger error:', e.message); }
    // The AI decision log keeps the frame and what was read from it. The post
    // match review goes back to these frames for the moments before a death,
    // matched on the round the ledger filed the frame under and the clock on it.
    if (this.diagnostics && !this.inLobby) {
      try {
        this.diagnostics({ at, image: shot, state: data.context || {}, aiTip: '', shown: null, reject: null,
          died, round: this.ledger.current(), match: this.matchStartedAt });
      } catch (e) { console.log('[engine] diagnostics sink error:', e.message); }
    }
  }

  /** One read into the match state, through every guard in updateMatchContext. */
  processRead(data) {
    this.lastNote = null;
    if (!data || data.lobby) {
      if (!this.inLobby) console.log('[engine] menu or lobby');
      this.inLobby = true;
      return;
    }
    this.inLobby = false;
    const c = data.context || {};
    this.updateMatchContext(c);
    this.trackEnemy(c);
    // What the player was SEEN doing, a fact rather than advice. It goes into
    // the round ledger, and the review is written from it.
    if (c.playerNote) {
      this.addPlayerNote(c.playerNote);
      this.lastNote = c.playerNote;
    }
  }

  /** The little the read prompt needs: enough to stay consistent frame to frame. */
  readContext() {
    this.expireStalePlan();
    const c = this.matchContext;
    return {
      // Only once the player confirmed it, the rule the old context had too.
      agent: c.agentConfirmed ? c.agent : null,
      map: c.map, side: c.side, phase: c.phase, gameMode: c.gameMode,
      teamScore: c.teamScore, enemyScore: c.enemyScore, roundNumber: c.roundNumber,
      playerAlive: c.playerAlive,
    };
  }

  noteLatency(ms) {
    if (ms === null) this.readErrors++;
    else {
      this.readErrors = 0;
      this.latencies.push(ms);
      if (this.latencies.length > 30) this.latencies.shift();
    }
    this.adaptCadence();
  }

  /** `limited`: the server's read limiter just refused a read (onRateLimited). */
  adaptCadence(limited = false) {
    if (this.captureSpeed !== 'auto') return;
    const tiers = CAPTURE_TIERS;
    const i = Math.max(0, tiers.indexOf(this.gapMs));
    const setTier = (j, why) => {
      if (j === i) return;
      console.log(`[engine] read cadence ${tiers[i]}ms -> ${tiers[j]}ms (${why})`);
      this.gapMs = tiers[j];
      this.latencies = [];
      this.readErrors = 0;
      this.emit('cadence', this.gapMs);
    };
    if (limited && i < tiers.length - 1) { setTier(i + 1, 'the server is limiting reads'); return; }
    if (this.readErrors >= 3 && i < tiers.length - 1) { setTier(i + 1, 'reads failing'); return; }
    if (this.latencies.length < 12) return;
    const p90 = quantile(this.latencies, 0.9);
    // With four in flight a read may take four gaps before a fifth would be
    // needed. Past that, reads pile up and the frames go stale.
    if (p90 > this.gapMs * MAX_IN_FLIGHT * 1.1 && i < tiers.length - 1) setTier(i + 1, `p90 ${p90}ms`);
    else if (i > 0 && p90 < tiers[i - 1] * MAX_IN_FLIGHT * 0.7) setTier(i - 1, `p90 ${p90}ms`);
  }

  /**
   * The server's read limiter answered 429. Sending stops for ten seconds and
   * the cadence steps down once. The reads that were out beside the refused one
   * were sent before it said so, so their refusals extend the pause without
   * stepping again.
   */
  onRateLimited() {
    const now = Date.now();
    const fresh = now - this.rateLimitedAt >= RATE_LIMIT_PAUSE_MS;
    this.rateLimitedAt = now;
    if (!fresh) return;
    console.log(`[engine] the server is limiting reads, sending none for ${RATE_LIMIT_PAUSE_MS / 1000}s`);
    this.adaptCadence(true);
  }

  /**
   * The capture helper's time for one frame, logged as a p50 and a p90 every
   * CAPTURE_LOG_EVERY frames. The helper is launched once per frame and tick()
   * waits for a capture to finish, so a capture near the gap sets the cadence
   * by itself, whatever the server does. Past about 700ms, a steady read a
   * second needs a capture source that stays running, not one launched per
   * frame.
   */
  noteCapture(ms) {
    this.captureTimes.push(ms);
    if (this.captureTimes.length < CAPTURE_LOG_EVERY) return;
    const t = this.captureTimes;
    this.captureTimes = [];
    console.log(`[engine] capture p50 ${quantile(t, 0.5)}ms, p90 ${quantile(t, 0.9)}ms over the last ${t.length} frames;`
      + ` reading every ${this.gapMs}ms, up to ${this.inFlightLimit()} in flight`
      + (this.latencies.length ? `, read p90 ${quantile(this.latencies, 0.9)}ms` : ''));
  }

  /** Pin a speed from Settings, or hand it back to 'auto'. */
  setCaptureSpeed(speed) {
    this.captureSpeed = speed === 'auto' || !CAPTURE_TIERS.includes(Number(speed)) ? 'auto' : Number(speed);
    this.gapMs = this.captureSpeed === 'auto' ? (this.gapMs || CAPTURE_TIERS[0]) : this.captureSpeed;
    this.latencies = [];
    this.emit('cadence', this.gapMs);
  }

  onReadFailed() {
    // A rejected licence (401/403) asks the controller to re-validate now,
    // throttled so a burst of failures does not spam the licence endpoint.
    if ((this.lastServerStatus === 401 || this.lastServerStatus === 403) &&
        Date.now() - this.lastAuthSuspect > 60000) {
      this.lastAuthSuspect = Date.now();
      this.emit('auth-suspect');
    }
    // One miss is a hiccup, not an outage. Only a streak is worth a notice, and
    // it goes to the panel's status line, never over the game.
    this.failStreak++;
    if (this.failStreak < 3 || this.warnedFailure) return;
    this.warnedFailure = true;
    let text;
    if (!this.licenseKey) text = 'No licence picked up, so the coach cannot read your match.';
    else if (this.lastServerStatus === 401 || this.lastServerStatus === 403) text = 'Your licence is not active. Re-activate it in Settings.';
    else if (this.lastServerStatus === 402) text = 'The coach AI is out of credits, so this match is not being read.';
    else if (this.lastServerStatus === 429) text = 'The coach server is limiting reads, so this match is read less often for now.';
    else if (this.lastServerStatus >= 500) text = 'The coach server is having trouble. Reading resumes when it is back.';
    else text = 'Cannot reach the coach server right now. Reading resumes when it is back.';
    this.emit('notice', { kind: 'read-failed', text });
  }

  /** Screen capture failed (an antivirus block, usually). Said once, on the panel. */
  onCaptureFailed() {
    if (this.warnedCapture) return;
    this.warnedCapture = true;
    this.emit('notice', { kind: 'capture', text: 'Windows blocked screen capture. Add Occlara to your antivirus exclusions '
      + '(Windows Security, Virus and threat protection, Exclusions), then start again.' });
  }

  async detectAgent() {
    // Not while spectating: the ability bar on screen is then a teammate's,
    // and a detection taken from it named the wrong agent for the whole match.
    if (this.matchContext.agent || this.isCapturing || this.paused || this.isSpectating()) return;
    // The capture is the only part that has to keep reads out. Holding the
    // flag through the server call as well stopped every read for the call's
    // whole round trip, every 30 seconds until an agent locked.
    let shot = null;
    this.isCapturing = true;
    try { shot = await this.captureFunction(); }
    catch (e) { console.error('[engine] detect-agent capture error:', e.message); }
    finally { this.isCapturing = false; }
    if (!shot || this.shouldAbort || !this.isRunning) return;
    try {
      const { data } = await this.callServer(API.DETECT_AGENT, { image: shot });
      // Stopped, or an agent set by hand, while the call was out.
      if (this.shouldAbort || !this.isRunning || this.matchContext.agent) return;
      // Normalise whatever the server returns ("reyna", "KAY/O", "Jett ") to a
      // canonical name so detection reliably fires the confirm bubble.
      const detected = data && data.agent ? agentData.resolveName(data.agent) : null;
      if (detected) {
        this.matchContext.agent = detected;
        this.matchContext.agentConfirmed = false; // ask the player to confirm
        console.log('[engine] agent detected:', detected, '(raw:', data.agent + ')');
        if (this.agentTimer) { clearInterval(this.agentTimer); this.agentTimer = null; }
        this.emit('agent', this.agentInfo());
      }
    } catch (e) {
      console.error('[engine] detect-agent error:', e.message);
    }
  }

  // ── agent confirmation ────────────────────────────────────────────────────
  // The panel shows a bubble asking "Playing <X>?". A ✓ confirms the detection;
  // an ✗ lets the player type their agent. Until an agent is known, AI tips that
  // name a specific ability are held back (we can't verify they apply).
  agentInfo() {
    const agent = this.matchContext.agent;
    return {
      agent,
      confirmed: !!this.matchContext.agentConfirmed,
      role: agentData.getRole(agent),
    };
  }

  /** Player tapped ✓, trust the detected agent and stop re-detecting. */
  confirmAgent() {
    if (!this.matchContext.agent) return this.agentInfo();
    this.matchContext.agentConfirmed = true;
    if (this.agentTimer) { clearInterval(this.agentTimer); this.agentTimer = null; }
    console.log('[engine] agent confirmed:', this.matchContext.agent);
    this.emit('agent', this.agentInfo());
    return this.agentInfo();
  }

  /** Player typed their agent, override detection and lock it in. */
  setAgent(name) {
    const canonical = agentData.resolveName(name);
    if (!canonical) return { ok: false, error: 'unknown agent', agent: this.matchContext.agent };
    this.matchContext.agent = canonical;
    this.matchContext.agentConfirmed = true;
    if (this.agentTimer) { clearInterval(this.agentTimer); this.agentTimer = null; }
    console.log('[engine] agent set by player:', canonical);
    this.emit('agent', this.agentInfo());
    return { ok: true, ...this.agentInfo() };
  }

  /**
   * One call to the server: `data` when it answered, null when it did not, and
   * this call's own `status` either way (0 when it was never reached). The
   * status travels with the call because with up to four reads out,
   * `lastServerStatus` is whichever of them answered last.
   */
  async callServer(path, body, opts = {}) {
    try {
      const headers = opts.forced ? { 'X-Forced': 'true' } : undefined;
      // 30s unless the caller says otherwise. Agent detection runs past the
      // server's own 22 second race plus the network, so a slow answer is
      // waited out rather than read as a failure. The read passes its own 12
      // (READ_TIMEOUT_MS): it is one of up to four out at once and they are
      // applied in order, so a read the server has abandoned must not hold
      // the ones behind it for 30.
      const { ok, status, data } = await api.post(path, body, this.licenseKey, opts.timeoutMs || 30000, headers);
      this.lastServerStatus = status;
      if (!ok) {
        // 402 = the AI account is out of credits. Not transient, so record it
        // and let the loop idle instead of retrying every few seconds.
        if (status === 402) {
          if (!this.aiCreditsOutAt) console.error('[engine] AI out of credits, pausing AI requests');
          this.aiCreditsOutAt = Date.now();
        } else {
          console.error('[engine] server', path, 'status', status);
        }
        return { data: null, status };
      }
      this.aiCreditsOutAt = 0;   // a success proves credits are back
      return { data, status };
    } catch (e) {
      this.lastServerStatus = 0; // network/unreachable
      console.error('[engine] server', path, 'error:', e.message);
      return { data: null, status: 0 };
    }
  }

  /** Drop the team plan once it is too old to trust. A buy-phase read describes
   *  the opening push; by the time most of a round has run, the team has often
   *  rotated and coaching "within the plan" actively points the player the wrong
   *  way. Cleared rather than guessed at, so the coach falls back to what it can
   *  actually see. */
  expireStalePlan() {
    const at = this.matchContext.teamReadAt;
    if (!at || !this.matchContext.teamRead) return;
    if (Date.now() - at > TEAM_PLAN_TTL_MS) {
      console.log('[engine] team plan expired (stale), dropping it');
      this.matchContext.teamRead = null;
      this.matchContext.teamReadAt = 0;
    }
  }

  // ── enemy pattern tracking ────────────────────────────────────────────────────
  // Reads whatever enemy-location signal the AI returns in response.context and,
  // if the same spot shows up repeatedly, warns the player to pre-aim it.
  extractEnemySpot(ctx) {
    if (!ctx) return null;
    const cand = ctx.enemyAngle || ctx.enemySpot || ctx.enemyPosition ||
                 ctx.enemyLocation || ctx.lastSeenEnemy ||
                 (Array.isArray(ctx.enemyPositions) && ctx.enemyPositions.length === 1 ? ctx.enemyPositions[0] : null);
    return typeof cand === 'string' && cand.trim() ? cand.trim().toLowerCase() : null;
  }

  trackEnemy(ctx) {
    const spot = this.extractEnemySpot(ctx);
    if (!spot) return;
    this.enemyHistory.push(spot);
    if (this.enemyHistory.length > 8) this.enemyHistory.shift();

    // A repeated spot goes into MATCH MEMORY + ENEMY PATTERNS so the AI folds
    // the read into a real, situation-aware tip. (The old hardcoded "Heads up,
    // they keep swinging X" template tip is gone: templated spam, not coaching.)
    const recent  = this.enemyHistory.slice(-3);
    const repeats = recent.filter((s) => s === spot).length;
    if (repeats >= 2 && spot !== this.lastWarnedSpot) {
      this.lastWarnedSpot = spot;
      this.remember(`Enemies keep taking ${prettySpot(spot)}`);
    }
  }

  /** Observed facts about the player's actual play, deduped and capped.
   *  Unlike tips (advice that was merely SHOWN), these describe what really
   *  happened on screen, so reviews and session grades stay honest. */
  addPlayerNote(note) {
    const n = String(note).trim().slice(0, 90);
    if (!n || n.length < 8) return;
    const lower = n.toLowerCase();
    if (this.playerNotes.some((x) => x.toLowerCase() === lower)) return;
    this.playerNotes.push(n);
    if (this.playerNotes.length > 25) this.playerNotes.shift();
  }

  /** Append one line to the match memory (deduped, capped) so the AI keeps a
   *  running picture of the match instead of judging every frame cold. */
  remember(line) {
    if (!line || this.matchMemory[this.matchMemory.length - 1] === line) return;
    this.matchMemory.push(line);
    if (this.matchMemory.length > 16) this.matchMemory.shift();
  }

  /**
   * The map lock, which every callout depends on.
   *
   * This used to be write-once: two agreeing reads locked it, and from then on
   * `if (!this.matchContext.map)` threw away every later read. So one early
   * misread (a loading screen, a dark frame, a model bias toward a common map)
   * locked the WRONG map for the entire match, and it failed in the worst
   * possible direction: the callout gate trusts the lock, so it then actively
   * WAVED THROUGH that map's callouts. A player on Breeze got told to hold
   * "Elbow" and "B Back Site", which are Ascent callouts, and the gate approved
   * because it believed the map was Ascent.
   *
   * Now the lock is revisable. Two agreeing reads still acquire it, and two
   * agreeing CONTRADICTING reads correct it: if the evidence was good enough to
   * set the map, the same weight of evidence is good enough to change it. While
   * a contradiction is pending the map is treated as in doubt, which suppresses
   * named callouts rather than letting the wrong map's callouts through.
   */
  applyMapRead(raw) {
    const v = String(raw || '').trim();
    if (!v) return;
    // Printed location labels already settled this. The model's opinion does not
    // get to overturn evidence the game itself rendered.
    if (this.mapConfirmedByLabels) return;
    const same = (a, b) => String(a || '').toLowerCase() === String(b || '').toLowerCase();

    // Not locked yet: two agreeing reads acquire the lock.
    if (!this.matchContext.map) {
      if (same(this.pendingMap, v)) {
        this.matchContext.map = v;
        this.pendingMap = null;
        this.mapDoubt = 0;
        this.matchContext.mapUncertain = false;
        console.log(`[engine] map locked: ${v}`);
      } else {
        this.pendingMap = v;
      }
      return;
    }

    // Locked and this read agrees: clear any pending doubt.
    if (same(this.matchContext.map, v)) {
      if (this.mapDoubt) console.log(`[engine] map doubt cleared, still ${this.matchContext.map}`);
      this.mapDoubt = 0;
      this.mapChallenger = null;
      this.matchContext.mapUncertain = false;
      return;
    }

    // Locked but this read disagrees. Count consecutive challenges from the
    // SAME challenger; a one-off misread should not unseat a good lock.
    if (same(this.mapChallenger, v)) {
      this.mapDoubt = (this.mapDoubt || 0) + 1;
    } else {
      this.mapChallenger = v;
      this.mapDoubt = 1;
    }

    if (this.mapDoubt >= 2) {
      console.log(`[engine] map corrected: ${this.matchContext.map} -> ${v} (2 agreeing contradictions)`);
      this.matchContext.map = v;
      this.mapDoubt = 0;
      this.mapChallenger = null;
      this.matchContext.mapUncertain = false;
      // Everything derived from the old map is now meaningless.
      this.matchContext.playerSpot = null;
      this.matchContext.playerSpotVerified = false;
      this.matchContext.teamRead = null;
      this.matchContext.enemySpot = null;
      this.remember(`Map corrected to ${v}`);
    } else {
      this.matchContext.mapUncertain = true;
      console.log(`[engine] map in doubt: locked ${this.matchContext.map}, read ${v} (callouts suppressed)`);
    }
  }

  /** True while a contradicting map read is pending, so we do not know which
   *  map's callouts are legal. Named callouts are blocked until it resolves. */
  mapInDoubt() { return (this.mapDoubt || 0) > 0; }

  /**
   * Identify the map from the location labels the game prints beside the
   * minimap. This is the answer to the model being confidently and CONSISTENTLY
   * wrong about the map: a correction rule that waits for it to disagree with
   * itself never fires, but the labels are independent evidence.
   *
   * Each label narrows the candidates ("Mid Top" fits eight maps, adding
   * "B Market" leaves only Sunset). When exactly one map contains every label
   * seen this session, that IS the map, and it overrides whatever the model
   * claims, including a lock the model already won.
   */
  applyLocationLabel(label) {
    const l = String(label || '').trim();
    if (!l) return;
    if (!this.seenLabels) this.seenLabels = [];
    if (!this.seenLabels.includes(l)) this.seenLabels.push(l);
    if (this.seenLabels.length > 12) this.seenLabels.shift();

    const id = mapFromLabels(this.seenLabels);
    if (!id) return;

    if (id.confident && id.map) {
      if (this.matchContext.map !== id.map) {
        console.log(`[engine] map identified from printed labels as ${id.map}`
          + ` (was ${this.matchContext.map || 'unknown'}), labels: ${this.seenLabels.join(', ')}`);
        this.matchContext.map = id.map;
        this.matchContext.playerSpot = null;
        this.matchContext.playerSpotVerified = false;
        this.matchContext.teamRead = null;
      }
      // Printed text is the strongest evidence available, so it also settles
      // any pending doubt outright.
      this.mapDoubt = 0;
      this.mapChallenger = null;
      this.matchContext.mapUncertain = false;
      this.mapConfirmedByLabels = true;
    } else if (!id.candidates.length) {
      // No single map contains all these labels, so one was misread. Drop the
      // oldest and keep going rather than locking onto a contradiction.
      this.seenLabels.shift();
    }
  }

  /** Dead and watching. Either signal counts: the phase read and the alive flag
   *  are kept consistent, but one can land a frame before the other. */
  isSpectating() {
    return this.matchContext.playerAlive === false || this.matchContext.phase === 'dead';
  }

  updateMatchContext(updates) {
    const prevPhase = this.matchContext.phase;
    const prevRound = this.matchContext.roundNumber;
    const prevTeam  = this.matchContext.teamScore  | 0;
    const prevEnemy = this.matchContext.enemyScore | 0;
    const prevAlive = this.matchContext.playerAlive;
    const prevSpike = this.matchContext.spike;
    let newMatch = false;   // set by the new-match reset, so the continuity guard stands down

    // ONE SCORE IS NOT A SCOREBOARD. The server validates the two digits
    // separately, so a frame where one is hidden arrives with the other alone
    // and no round, which skipped every check below and was merged raw: at 12-9
    // a lone 13 ended a match in round 22, and at 5-5 a lone 1 dropped the score
    // to 5-1 and relabelled four rounds. The held value stands in for the
    // missing digit, so the lone one faces the same guard as a full read, and
    // the frame still does not count as one that read the score.
    const loneScore = (typeof updates.teamScore === 'number') !== (typeof updates.enemyScore === 'number');
    if (loneScore) {
      if (typeof updates.teamScore !== 'number') updates.teamScore = prevTeam;
      else updates.enemyScore = prevEnemy;
      delete updates.roundNumber;   // derived from the pair below
    }

    // A NEW MATCH in the same session: the round counter falls back to 1 and
    // the score resets to 0-0. Every per-match side lock must reset with it,
    // a first-half side carried over from the previous match is exactly the
    // wrong-side bug. Judged on the round the two scores give, since the model
    // leaves its own round empty on a third of frames, and on two reads in a
    // row, since one misread 0 to 0 must not wipe a live match's locks.
    // Once the watch has ended the match there is no live match to protect, so
    // a match that ended before round 5 (a surrender, a remake) does not leave
    // the next one's 0 to 0 rejected as a score going backwards.
    const afterEnd = !!(this.endWatch && this.endWatch.ended);
    const bothScores = !loneScore && typeof updates.teamScore === 'number' && typeof updates.enemyScore === 'number';
    const readRound = bothScores ? updates.teamScore + updates.enemyScore + 1 : null;
    const looksNew = bothScores && readRound <= 2 && updates.teamScore <= 1 && updates.enemyScore <= 1
      && prevRound > readRound && (prevRound >= 5 || afterEnd || this.ledger.size() > 0);
    // Early in a match a misread 0 is likelier than a remake, so it needs a third.
    const readsNeeded = afterEnd ? 1 : prevRound >= 5 ? 2 : 3;
    this.newMatchReads = looksNew ? (this.newMatchReads || 0) + 1 : 0;
    if (looksNew && this.newMatchReads >= readsNeeded) {
      this.newMatchReads = 0;
      // THE WATCH NEVER ENDED THE LAST ONE: a remake, an unrated 13-12 or a
      // surrender whose menus were never read. Without this the new match was
      // filed into the old ledger under round 27, and the old match's rounds
      // were reviewed under the new match's score. It is closed here, reviewed
      // into the library without opening (the player is already in the next
      // match), or dropped when it is too short to review.
      if (!afterEnd && this.ledger.size() > 0) this.closeUnendedMatch();
      console.log(`[engine] new match detected (round ${prevRound} -> ${readRound}), side/mode/map locks reset`);
      this.firstHalfSide = null;
      this.pendingFirstSide = null;
      this.lockedSide = null;
      this.sideChallenge = null;
      this.pendingMode = null;
      this.standardEvidence = 0;
      this.swapEvidence = 0;
      this.economyEvidence = 0;
      this.pistolEvidence = 0;
      this.buyAtFiveEvidence = 0;
      this.firstHalfLockedAt = null;
      this.matchContext.gameMode = null;
      this.matchContext.side = null;   // stale side from the last match: re-read it fresh
      this.matchContext.map = null;    // a new match may be a new map: re-read and re-lock
      this.pendingMap = null;
      // The label fingerprint has to go with it. applyMapRead returns early
      // while mapConfirmedByLabels is set, so clearing the map without clearing
      // the confirmation left the new match unable to lock a map at all, and the
      // old match's labels still filtering the candidates.
      this.mapConfirmedByLabels = false;
      this.seenLabels = [];
      this.mapDoubt = 0;
      this.mapChallenger = null;
      this.matchContext.mapUncertain = false;
      this.scoreboardChallenge = null;
      // The rest of what belongs to one match: the score clock the rate
      // ceiling measures from, the weapons seen this round, a pending step.
      this.lastScoreAt = Date.now();
      this.roundWeapons = new Set();
      this.lastStep = null;
      this.rollbackReads = 0;
      this.finalCandidate = null;
      this.lastRoundClock = null;
      newMatch = true;
    }

    // ── Scoreboard continuity ───────────────────────────────────────────────
    // The round number and score decide the HALFTIME SIDE, so a single misread
    // digit does not just look wrong, it flips the player's side and every tip
    // after it becomes anti-coaching. Observed in a real session: the round read
    // jumped 4 -> 12 -> 4 -> 13, the round-13 read tripped the halftime swap,
    // and an attacking player was coached to set up defensive crossfires for
    // minutes.
    //
    // Those bad reads were internally CONSISTENT (round 13 with a 3-9 score
    // really does add up), so self-consistency alone cannot catch them. What
    // gives them away is continuity: a round can only hold or tick up by one,
    // and scores never fall. An implausible read is held as a challenge and only
    // accepted if the next read agrees, which is the same evidence bar the map
    // lock uses and still lets the app pick up a match it joined late.
    // THE SCOREBOARD IS PRINTED, THE ROUND NUMBER IS NOT.
    //
    // Valorant's HUD shows two scores at the top. It does not show "round 6", so
    // any round number is the model INFERRING one, and it infers badly: across a
    // real session it sat on round 3 while the score climbed 2-1, 2-2, 3-2.
    //
    // That was expensive, because the invariant check below treats a round that
    // disagrees with the scores as an implausible reading and throws away the
    // WHOLE thing, both scores included. So a perfectly good scoreboard read
    // kept being discarded on account of a number the model made up, and the
    // tracked score went as long as 249 seconds without an update, roughly two
    // and a half rounds blind.
    //
    // Valorant's own arithmetic settles it: round = your score + their score + 1.
    // Two separately printed numbers beat one invented one, so the round is now
    // derived whenever both scores are readable, and the checks below run on the
    // corrected value. When the scores are missing there is nothing to derive
    // from and the model's round stands, as before.
    if (typeof updates.teamScore === 'number' && typeof updates.enemyScore === 'number') {
      const derived = updates.teamScore + updates.enemyScore + 1;
      if (updates.roundNumber !== derived) {
        if (typeof updates.roundNumber === 'number') {
          console.log(`[engine] round ${updates.roundNumber} does not match the scoreboard`
            + ` ${updates.teamScore}-${updates.enemyScore}, using round ${derived}`);
        }
        updates.roundNumber = derived;
      }
    }

    if (!newMatch && typeof updates.roundNumber === 'number' && prevRound > 0) {
      const jump = updates.roundNumber - prevRound;
      const scoresFell =
        (typeof updates.teamScore === 'number' && updates.teamScore < prevTeam) ||
        (typeof updates.enemyScore === 'number' && updates.enemyScore < prevEnemy);
      // Valorant's own invariant: round = your score + their score + 1.
      const inconsistent =
        typeof updates.teamScore === 'number' && typeof updates.enemyScore === 'number' &&
        updates.teamScore + updates.enemyScore + 1 !== updates.roundNumber;

      // A round NEVER goes backwards inside a match; only a new match resets it,
      // and that is detected separately above. So a backwards read can never be
      // confirmed, however many times it repeats. Without this, a repeated
      // misread gets accepted and then the true (lower) round walks it back, and
      // the round flaps, which is what drives the halftime side math back and
      // forth mid match.
      const backwards = jump < 0 || scoresFell;

      // TIME IS THE CEILING, AND NO AMOUNT OF AGREEMENT BEATS IT.
      //
      // "Twice in a row: believe it" was too weak on its own. The model reads
      // the SAME wrong HUD on consecutive frames, so agreeing with itself costs
      // it nothing, and a real session walked from round 3 to round 12 in 90
      // seconds and from 1-2 to 2-10 in another 81. Nine rounds cannot happen
      // in ninety seconds: a Valorant round is 100 seconds of play plus a buy
      // phase, so even the fastest possible round cannot repeat under about
      // half a minute.
      //
      // So the clock decides what is possible and the agreement rule only
      // decides what is believable within it. A genuine gap (alt tab, a paused
      // session) still passes, because the allowance grows with real elapsed
      // time rather than with frames.
      const sinceScore = this.lastScoreAt ? (Date.now() - this.lastScoreAt) : 0;
      const roundsPossible = this.lastScoreAt
        ? 1 + Math.floor(sinceScore / MIN_ROUND_MS)
        : Infinity;   // first read of the session has nothing to measure against
      const tooFast = jump > roundsPossible;

      // A STEP THAT WAS A MISREAD IS TAKEN BACK. A step forward needs two
      // agreeing reads (below), but the model can misread the same digit on
      // consecutive frames, and after that every true read was "backwards" and
      // thrown away for good: at 12-10 a 13 that was never scored ended the
      // match, and a 6-3 that was 5-3 swapped two rounds' results. So three
      // agreeing reads that carry on from the score BEFORE the step (that score
      // itself, or one round after it) undo the step, unless a buy phase read
      // at the new score has confirmed it since.
      const step = this.lastStep;
      const readSig = `${updates.teamScore}|${updates.enemyScore}`;
      const fromSum = step ? step.from.team + step.from.enemy : 0;
      const carriesOn = backwards && !!step && !step.bought && Date.now() - step.at < STEP_ROLLBACK_MS
        && typeof updates.teamScore === 'number' && typeof updates.enemyScore === 'number'
        && updates.teamScore >= step.from.team && updates.enemyScore >= step.from.enemy
        && updates.teamScore + updates.enemyScore - fromSum <= 1;
      // Counted over frames that read both scores; one with no score is no
      // evidence either way, and a quarter of frames carry none.
      if (typeof updates.teamScore === 'number' && typeof updates.enemyScore === 'number') {
        this.rollbackReads = carriesOn && this.rollbackSig === readSig ? (this.rollbackReads || 0) + 1 : (carriesOn ? 1 : 0);
        this.rollbackSig = carriesOn ? readSig : null;
      }
      if (carriesOn && this.rollbackReads >= 3) {
        console.log(`[engine] score step to ${step.to.team}-${step.to.enemy} was a misread, the score is `
          + `${updates.teamScore}-${updates.enemyScore}`);
        if (typeof this.ledger.rollback === 'function') this.ledger.rollback(step.from);
        const isFrom = updates.teamScore === step.from.team && updates.enemyScore === step.from.enemy;
        this.lastStep = isFrom ? null
          : { from: step.from, to: { team: updates.teamScore, enemy: updates.enemyScore }, at: Date.now(), bought: false };
        this.rollbackReads = 0;
        this.rollbackSig = null;
        this.scoreboardChallenge = null;
        updates.roundNumber = updates.teamScore + updates.enemyScore + 1;
      } else if (backwards) {
        console.log(`[engine] ignoring backwards scoreboard read: round ${prevRound} -> ${updates.roundNumber}`);
        delete updates.roundNumber;
        delete updates.teamScore;
        delete updates.enemyScore;
      } else if (tooFast) {
        // Never confirmable. Repeating an impossible claim does not make it true.
        console.log(`[engine] ignoring impossible scoreboard jump: round ${prevRound} -> ${updates.roundNumber}`
          + ` (+${jump}) after only ${Math.round(sinceScore / 1000)}s, at most +${roundsPossible} was possible`);
        this.scoreboardChallenge = null;
        delete updates.roundNumber;
        delete updates.teamScore;
        delete updates.enemyScore;
      } else if (jump >= 1 || inconsistent) {
        // ONE ROUND FORWARD needs a second read too, like every other jump.
        // At a read a second that costs one frame, and it is the difference
        // between a misread digit and a round the match never played.
        const sig = `${updates.roundNumber}|${updates.teamScore}|${updates.enemyScore}`;
        if (this.scoreboardChallenge === sig) {
          // Twice in a row: believe it. Covers a genuinely missed stretch of
          // frames (alt-tab, a long death) rather than a one-off misread.
          if (jump > 1 || inconsistent) console.log(`[engine] scoreboard jump confirmed, accepting round ${updates.roundNumber}`);
          this.scoreboardChallenge = null;
          this.finalCandidate = null;   // read twice: the watch holds it now
          if (typeof updates.teamScore === 'number' && typeof updates.enemyScore === 'number') {
            // The frame that accepted it, which can never be the one that
            // confirms it (see bought below).
            this.lastStep = { from: { team: prevTeam, enemy: prevEnemy },
              to: { team: updates.teamScore, enemy: updates.enemyScore }, at: Date.now(), bought: false,
              frame: this.analyzedFrames };
          }
        } else {
          this.scoreboardChallenge = sig;
          // A final score read once is kept, in case the next frame is the end
          // screen (adoptFinalCandidate).
          this.finalCandidate = jump === 1 && !inconsistent
            && isFinalScore(updates.teamScore, updates.enemyScore, 'standard')
            ? { team: updates.teamScore, enemy: updates.enemyScore, frame: this.analyzedFrames } : null;
          if (jump > 1 || inconsistent) {
            console.log(`[engine] implausible scoreboard read ignored: round ${prevRound} -> ${updates.roundNumber}`
              + `, score ${prevTeam}-${prevEnemy} -> ${updates.teamScore}-${updates.enemyScore}`
              + (inconsistent ? ' (does not add up)' : ''));
          }
          delete updates.roundNumber;
          delete updates.teamScore;
          delete updates.enemyScore;
        }
      } else {
        this.scoreboardChallenge = null;   // a clean read clears any pending doubt
      }
      // Stamp the clock whenever a read SURVIVED the guard above. Anything the
      // guard stripped leaves roundNumber deleted, so the allowance keeps
      // growing from the last believed read rather than resetting on a rejection
      // and quietly handing the next bad read a bigger budget.
      if (typeof updates.roundNumber === 'number') this.lastScoreAt = Date.now();
    }

    // Whether THIS frame carried a score of its own past the guard. The context
    // keeps the last one when it did not, and the match-end watch has to know
    // the difference (match-end.js). A lone digit filled from the held score
    // above is not a read of the scoreboard.
    this.scoreReadThisFrame = !loneScore
      && typeof updates.teamScore === 'number' && typeof updates.enemyScore === 'number';
    // THE ROUND THAT ENDED TAKES ITS PLANT AND ITS CLOCK WITH IT. A field the
    // model leaves empty is never merged, so a plant and a mid round clock rode
    // on into the next round whenever its buy phase went unread, and the ledger
    // counted the banner as play there and planted a round that had no plant.
    // Cleared before this frame's own fields merge, so a plant or a clock the
    // banner actually prints still lands (the ledger files it back).
    if (this.scoreReadThisFrame
        && (updates.teamScore !== prevTeam || updates.enemyScore !== prevEnemy)) {
      this.matchContext.spike = null;
      this.matchContext.spikeSpot = null;
      this.matchContext.clock = null;
    }
    // A buy phase read AT the new score, on a LATER frame than the one that
    // accepted the step, confirms it: from here the match has moved on, and
    // nothing takes the step back. The accepting frames themselves could not:
    // two buy phase frames misreading 6-3 at 5-3 confirmed their own misread.
    if (this.lastStep && this.scoreReadThisFrame && this.analyzedFrames > (this.lastStep.frame || 0)
        && isBuyPhase(updates.phase, updates.clock)
        && updates.teamScore === this.lastStep.to.team && updates.enemyScore === this.lastStep.to.enemy) {
      this.lastStep.bought = true;
    }
    // The candidate final goes the moment the game shows it was not the end:
    // another score read on a later frame, or a buy phase.
    if (this.finalCandidate && this.analyzedFrames > this.finalCandidate.frame
        && ((this.scoreReadThisFrame && (updates.teamScore !== this.finalCandidate.team
          || updates.enemyScore !== this.finalCandidate.enemy)) || isBuyPhase(updates.phase, updates.clock))) {
      this.finalCandidate = null;
    }

    // Game mode from the HUD (agent select header, loading screen, scoreboard,
    // end-of-round banner): two agreeing reads lock it for the match, exactly
    // like the side lock, so one misread frame cannot set the halftime math.
    if (updates.gameMode === 'swiftplay' || updates.gameMode === 'standard') {
      if (!this.matchContext.gameMode) {
        if (this.pendingMode === updates.gameMode) {
          this.matchContext.gameMode = updates.gameMode;
          console.log(`[engine] game mode locked: ${updates.gameMode}`);
        } else {
          this.pendingMode = updates.gameMode;
        }
      }
      delete updates.gameMode;   // never merged raw; only the lock above sets it
    }

    // Death detection. Frames arrive about 12 seconds apart, so demanding two
    // consecutive dead reads (the old rule) meant a death was only believed
    // 12 to 24 seconds after it happened, usually after the round had already
    // moved on, and any single flickered "alive" read reset the wait entirely.
    // That is why deaths went unnoticed.
    //
    // Now the model reports the EVIDENCE for its read. A named dead tell (a
    // spectate label, a killcam, a teammate's name where the player's own
    // loadout belongs) is direct proof, so one frame is enough. Only a bare
    // alive:false with no tell, which is what a flashbang or a dark frame
    // produces, still has to be confirmed by a second frame.
    // A readable health number beats any "dead" read. This is the ground truth
    // and it is what stops a hallucinated spectate tell from silencing the
    // coach for a player who is very much alive.
    //
    // WHOSE HUD IS THIS. Health only beats a dead read when the health is the
    // PLAYER'S OWN, and after a death it is not: the spectator camera puts a
    // teammate's health, weapon and abilities in the same corner of the screen.
    //
    // The old rule here had no way to tell the difference and, worse, deleted
    // the tell at the same time, destroying the only evidence the check below
    // could have used. A real session went: "own HP 100 and Ghost", "own HP 100
    // and Bandit", "own HP 19 and Sova abilities" while the player was Iso.
    // Health won all three times, the death never registered, and with it went
    // the death flag, the spectator merge guard and two correct death reviews.
    // A BUY PHASE IS ALWAYS A BOUNDARY, and leaning only on roundNumber is not
    // safe: in the session this was built from, roundNumber was missing on a
    // third of the frames. Without this, the weapon and health carried over from
    // the SPECTATED teammate into the player's next living round and read as two
    // weak spectate signals, which would have called a living player dead.
    const roundChanged = (updates.phase === 'buy')
      || (typeof updates.roundNumber === 'number'
          && typeof this.matchContext.roundNumber === 'number'
          && updates.roundNumber !== this.matchContext.roundNumber)
      // Coming back from spectating is a boundary too: everything remembered
      // about the HUD belonged to somebody else.
      || (this.matchContext.spectateSuspected === true && updates.playerAlive === true);
    if (roundChanged) this.roundWeapons = new Set();
    if (!this.roundWeapons) this.roundWeapons = new Set();
    if (updates.playerWeapon) this.roundWeapons.add(String(updates.playerWeapon));

    const hud = spectate.readHudOwner({
      tell:        updates.aliveTell,
      // Only an agent the player CONFIRMED. A detection taken while dead names
      // a teammate, and the player's own abilities then read as somebody else's.
      agent:       this.matchContext.agentConfirmed ? this.matchContext.agent : null,
      weapon:      updates.playerWeapon,
      prevWeapon:  this.matchContext.playerWeapon,
      weaponChurn: this.roundWeapons.size,
      hp:          updates.playerHp,
      prevHp:      this.matchContext.playerHp,
      roundChanged,
      // The two the model already reads and this check never saw. A kill feed
      // reading "Killed by <agent>" is printed on screen, not inferred, and it
      // is the strongest death tell available.
      killFeed:    updates.killFeed,
      phase:       updates.phase,
    });
    this.matchContext.spectateSuspected = hud.spectating;

    if (hud.spectating) {
      // The tell wins and the health number is DROPPED rather than reassigned,
      // because it belongs to somebody else and a teammate's health passed off
      // as the player's is worse than no reading at all.
      if (updates.playerHp != null || updates.playerAlive !== false) {
        console.log(`[engine] spectating: ${hud.signals.join('; ')}`);
      }
      updates.playerAlive = false;
      delete updates.playerHp;
    } else if (updates.playerAlive === false && typeof updates.playerHp === 'number' && updates.playerHp > 0) {
      console.log(`[engine] ignoring dead read: health is ${updates.playerHp}`);
      updates.playerAlive = true;
      // The tell is NOT deleted any more. It is the evidence the spectate check
      // above runs on, and throwing it away is what made this bug unfixable
      // from inside the guard that caused it.
    }
    // HP BEATS A DEAD PHASE TOO. The phase is the model's one word guess, and
    // the rule above only looked at the alive flag, so a frame reading phase
    // "dead" next to "own HP 100 and Vandal" registered a death by itself. The
    // spectate check has already said the health is the player's own here.
    if (updates.phase === 'dead' && !hud.spectating
        && typeof updates.playerHp === 'number' && updates.playerHp > 0) {
      console.log(`[engine] ignoring phase "dead": own health is ${updates.playerHp}`);
      delete updates.phase;
    }
    if (updates.playerAlive === false && updates.phase !== 'dead') {
      const tell   = String(updates.aliveTell || '');
      // A named tell only counts as proof when the health number was ALSO
      // genuinely absent. In a real session the health went unread on more than
      // half the frames, which left a single hallucinated tell able to declare
      // a death on its own; requiring the corroborating absence keeps the fast
      // path for real deaths (where there is no health to read) and makes a
      // frame the model simply could not parse wait for a second opinion.
      const healthAbsent = updates.playerHp == null || updates.playerHp === 0;
      const proven = healthAbsent && DEAD_TELL.test(tell) && !UNSURE_TELL.test(tell);
      this.aliveFalseStreak = (this.aliveFalseStreak || 0) + 1;
      if (proven) {
        if (this.aliveFalseStreak === 1) console.log(`[engine] death seen on one frame: "${tell}"`);
      } else if (this.aliveFalseStreak < 2 && prevAlive !== false) {
        delete updates.playerAlive;   // unproven, wait for a second read
      }
    } else if (updates.playerAlive === true || updates.phase === 'active') {
      this.aliveFalseStreak = 0;
    }
    if (updates.aliveTell) this.lastAliveTell = String(updates.aliveTell).slice(0, 60);

    // NOBODY DIES IN A BUY PHASE. The barriers are up, and what a dead read
    // there sees is the COMBAT REPORT of the round before ("KILLED BY Reyna" in
    // its panel), which Valorant shows again as the next buy phase starts. On a
    // real competitive session 9 of 29 death registrations were that panel,
    // each filed into the new round, where the ledger's one death a round then
    // refused the round's real death. So while a buy timer read on this frame
    // or an earlier one is still running, a dead read is a living player
    // buying. A round clock, more than 45 seconds, ends it: the round is live.
    const clockLeft = clockSeconds(updates.clock);
    // But only a REAL buy phase opens that window. A "buy" read whose clock
    // carries on the round clock read a moment ago is the round still running
    // (on the real session, "buy 0:30" two seconds after "active 0:32"), and
    // opening the window there hid the player's real death for half a minute.
    // The round clock chain is anchored on what cannot be a buy timer (more than
    // 45 seconds, or a post plant spike timer), so a buy phase misread as active
    // can never start one.
    const now = Date.now();
    const rc = this.lastRoundClock;
    const carriesOn = (left) => !!rc && left !== null && now - rc.at < 15000
      && Math.abs(rc.left - (now - rc.at) / 1000 - left) <= 3;
    if (updates.phase === 'buy' && carriesOn(clockLeft)) updates.phase = rc.phase;
    const buyRead = isBuyPhase(updates.phase, updates.clock);
    if (buyRead) this.buyUntil = now + (clockLeft === null ? 0 : clockLeft * 1000) + 2000;
    const inBuy = buyRead
      || (now < (this.buyUntil || 0) && (clockLeft === null || clockLeft <= BUY_MAX_LEFT));
    if (!inBuy && clockLeft !== null
        && ((updates.phase === 'active' && (clockLeft > BUY_MAX_LEFT || carriesOn(clockLeft)))
          || updates.phase === 'postplant')) {
      this.lastRoundClock = { at: now, left: clockLeft, phase: updates.phase };
    }
    if (inBuy && (updates.playerAlive === false || updates.phase === 'dead')) {
      console.log('[engine] ignoring a dead read in the buy phase, it is the combat report of the round before'
        + (updates.aliveTell ? ` ("${String(updates.aliveTell).slice(0, 50)}")` : ''));
      updates.playerAlive = true;
      if (updates.phase === 'dead') updates.phase = 'buy';
      this.matchContext.spectateSuspected = false;
      this.aliveFalseStreak = 0;
    }

    // A DEAD PLAYER'S HUD BELONGS TO SOMEBODY ELSE.
    //
    // Valorant puts you on a teammate's camera the moment you die, so the
    // health, the weapon and the position on screen are THEIRS, not the
    // player's. Nothing here knew that, so the spectated teammate's loadout was
    // merged in as the player's own. One real session reported nine different
    // weapons while the player was dead (Operator, Bulldog, Sheriff, Phantom,
    // Vandal, Shorty and more) and the coach then told the player "you died
    // peeking a close angle with the Operator" for a gun they never held.
    //
    // The last values read while the player was actually alive are the true
    // ones, so while spectating these fields are simply not merged. The death
    // review then describes the player's own loadout, which is what it is for.
    const spectatingNow = updates.playerAlive === false || updates.phase === 'dead'
                          || this.isSpectating();
    // playerHp belongs here for the same reason as the rest, and it is the one
    // that mattered most: the server strips a spectated health number before it
    // is ever sent, so the merge below simply skipped the field and the player's
    // LAST-ALIVE health stayed in context. The server then reads
    // `alive || hp > 0` and told the model "THE PLAYER IS ALIVE RIGHT NOW, at
    // 100 HP" while they were watching a killcam, which is precisely the
    // contradiction the whole death pipeline exists to prevent.
    // playerUlt joins this list for the reason the whole list exists: the moment
    // the player dies the HUD becomes the SPECTATED teammate's, so a charged
    // ultimate icon down there is THEIR ultimate, not the player's.
    const SPECTATOR_OWNED = ['playerWeapon', 'playerCredits', 'playerSpot', 'mmPos', 'playerHp', 'playerUlt'];

    for (const key of Object.keys(updates)) {
      const v = updates[key];
      if (v === null || v === undefined) continue;
      if (spectatingNow && SPECTATOR_OWNED.includes(key)) {
        if (this.matchContext[key] !== v) {
          console.log(`[engine] ignoring ${key}="${v}" while spectating (it belongs to the spectated player)`);
        }
        continue;
      }
      if (key === 'agent') {                              // locked once set
        if (!this.matchContext.agent) this.matchContext.agent = v;
        continue;
      }
      // Map locks only after TWO agreeing reads. A single misread (Haven seen
      // as Bind) used to lock for the whole match and let foreign callouts
      // ("go to Hookah" on Haven) pass, since the callout gate trusts the lock.
      // Until it locks, the map stays unknown and every named callout is
      // rejected, so unlocked frames only ever get general directions.
      if (key === 'map') {
        this.applyMapRead(v);
        continue;
      }
      // The location label the GAME printed. Accumulating these fingerprints the
      // map far more reliably than asking the model which map it is on, because
      // the label is text the game rendered rather than the model's judgement.
      if (key === 'locLabel') {
        // The label still identifies the MAP while spectating, because the
        // teammate is on the same map, so fingerprinting always gets it.
        this.applyLocationLabel(v);
        // But it stops being where the PLAYER is the moment they die: it then
        // follows the spectator camera. One session walked A Main, Mid Top, A
        // Tower, A Security, A Link and B Nest while the player lay dead in one
        // spot, and the death reviews named whichever one they happened to land
        // on. Keeping the last label read while alive is what makes "you died
        // at X" true.
        if (!spectatingNow) this.matchContext.locLabel = v;
        continue;
      }
      // handled separately (mode needs its 2-read lock), never merged raw
      if (key === 'recentTopics' || key === 'playerNote' || key === 'gameMode') continue;
      // The team's plan can CHANGE mid-round (a rotate). A read from the buy
      // phase kept driving tips all round, so the coach would still say "hit B"
      // after the team had rotated to A. Stamp each read, and when the plan
      // actually changes, record it so the coach follows the NEW plan.
      if (key === 'teamRead') {
        const prevRead = this.matchContext.teamRead;
        this.matchContext.teamRead = v;
        this.matchContext.teamReadAt = Date.now();
        if (prevRead && String(prevRead).toLowerCase() !== String(v).toLowerCase()) {
          this.remember(`Team plan changed: ${v}`);
          console.log(`[engine] team plan changed: "${prevRead}" -> "${v}"`);
        }
        continue;
      }
      this.matchContext[key] = v;
    }

    if (typeof updates.roundNumber === 'number' && updates.roundNumber > prevRound) {
      this.matchContext.roundsPlayed++;
    }
    // Round-transition awareness: note phase flips (buy -> active -> postplant …)
    // so the next request coaches the NEW phase and the cooldown briefly relaxes.
    if (updates.phase && updates.phase !== prevPhase) {
      this.lastPhaseChange = { from: prevPhase, to: updates.phase, at: Date.now() };
      // A new buy phase means a new plan: drop last round's team read so a
      // stale "4 stacking A" never coaches this round, and drop the player's
      // last known spot, everyone is back at spawn.
      if (updates.phase === 'buy') {
        this.matchContext.teamRead = null;
        this.matchContext.playerSpot = null;
        this.matchContext.playerSpotVerified = false;
        // Buy phase means a fresh round: everyone just respawned, so the player
        // is alive by definition. This clears a "dead" state that would
        // otherwise get stuck if the model later reports alive as null (unsure)
        // rather than an explicit true, which used to leave a live player being
        // coached as if they were still spectating. (consecutiveDeaths has its
        // own reset on respawn below, so it is deliberately left alone here.)
        this.matchContext.playerAlive = true;
        this.aliveFalseStreak = 0;
        this.deathTipsSent = 0;   // new round, the coach speaks again
        // Per-round facts: a stale "spike planted" would have the coach
        // coaching a retake for a round that already ended.
        this.matchContext.spike = null;
        this.matchContext.spikeSpot = null;
        this.matchContext.killFeed = null;
      }
      // The round going live locks the plan into match memory for continuity.
      if (updates.phase === 'active' && prevPhase === 'buy' && this.matchContext.teamRead) {
        this.remember(`Round plan: ${this.matchContext.teamRead}`);
      }
    }
    // A death registers from EITHER signal: the phase going to 'dead', or the
    // alive flag flipping false. The phase read misses plenty of deaths, and
    // previously that path only opened the review window without counting the
    // death or recording it, so streaks and match memory quietly lost deaths.
    // Both paths now do the full bookkeeping. Edge-triggered, plus a cooldown
    // so a flapping read cannot log the same death twice.
    const diedByPhase = updates.phase === 'dead' && prevPhase !== 'dead';
    const diedByAlive = updates.playerAlive === false && prevAlive !== false;
    if ((diedByPhase || diedByAlive) && Date.now() - this.lastDeathAt > 20000) {
      this.matchContext.consecutiveDeaths++;
      this.matchContext.consecutiveWins = 0;
      this.lastDeathAt = Date.now();   // opens the death-review window
      this.matchContext.lastDeathAt = this.lastDeathAt;   // visible to the tip verifier
      this.deathTipsSent = 0;          // this death gets its own review budget
      // The health they died with is not health they still have. Leaving it set
      // makes every later frame report a live player to the server, since it
      // treats any positive hp as alive.
      this.matchContext.playerHp = null;
      // WHERE THE PLAYER ACTUALLY DIED, pinned at the moment of death.
      // Everything positional goes stale the instant the spectator camera takes
      // over, so the review has to be told the spot rather than read it off a
      // frame showing a teammate somewhere else entirely. Both fields still
      // hold their last-alive values here, because the spectator guard above
      // stopped merging them.
      this.matchContext.deathSpot =
        this.matchContext.locLabel || this.matchContext.playerSpot || null;
      const where = this.matchContext.deathSpot;
      this.remember(`Player died round ${(this.matchContext.teamScore | 0) + (this.matchContext.enemyScore | 0) + 1}${where ? ` at ${where}` : ''}`);
      if (this.matchContext.consecutiveDeaths >= 2) {
        this.remember(`Player has died ${this.matchContext.consecutiveDeaths} rounds in a row`);
      }
      console.log(`[engine] death registered via ${diedByPhase ? 'phase' : 'alive flag'}`
        + (this.lastAliveTell ? ` ("${this.lastAliveTell}")` : ''));
    }
    // Back alive: a new round started for this player.
    if ((updates.phase === 'active' && prevPhase === 'dead')
        || (updates.playerAlive === true && prevAlive === false)) {
      this.matchContext.consecutiveDeaths = 0;
      this.deathTipsSent = 0;   // coaching resumes now that they can act again
      // The last death's location must not survive into the round after it, or
      // a later tip can cite a spot from a round that already ended.
      this.matchContext.deathSpot = null;
    }
    // A dead player is never in some other phase. Keeping these consistent is
    // what makes the verifier that blocks action advice for dead players fire,
    // since it keys off phase 'dead'.
    if (this.matchContext.playerAlive === false) this.matchContext.phase = 'dead';

    // The spike going down is the single biggest swing in a round, so it goes
    // into memory the moment it is first seen.
    if (updates.spike === 'planted' && prevSpike !== 'planted') {
      const where = updates.spikeSpot || this.matchContext.spikeSpot;
      this.remember(`Spike planted${where ? ' at ' + where : ''}`);
    }

    // Match memory: record round outcomes from score changes so future tips
    // know the flow of the match, not just the current frame.
    const team  = this.matchContext.teamScore  | 0;
    const enemy = this.matchContext.enemyScore | 0;
    if (team > prevTeam)  this.remember(`Won round ${team + enemy} (score ${team}-${enemy})`);
    if (enemy > prevEnemy) {
      this.remember(`Lost round ${team + enemy} (score ${team}-${enemy})`);
      this.lastRoundLostAt = Date.now();   // opens the round-review window
    }

    // ── Halftime math (mode-aware) ─────────────────────────────────────────
    // Vision can misread ATK/DEF, but round numbers are reliable, so once one
    // half's side is known the other half is arithmetic and it OVERRIDES
    // whatever the model claims. The halves depend on the game mode:
    //   swiftplay          4-round halves, first to 5, sudden death round 9
    //   unrated/competitive 12-round halves, overtime from round 25
    // Until the mode is known, only rounds where both modes agree on the half
    // are used (1-4 first half; 10+ can only be a standard match), so a
    // swiftplay's round 5 side swap is never bulldozed by 12-round math.
    const rn = this.matchContext.roundNumber | 0;
    const flipSide = (s) => (s === 'attacking' ? 'defending' : s === 'defending' ? 'attacking' : null);

    // Score/round arithmetic beats every other mode signal: swiftplay ends at
    // 5 round wins and 9 rounds total, so a 6th win or a 10th round proves a
    // standard match. Two consecutive frames of proof are required (a single
    // misread digit cannot lock it), and the proof even overrides a swiftplay
    // lock that came from vision, in which case the side locks reset because
    // they were derived with the wrong half length.
    if (this.matchContext.gameMode !== 'standard'
        && ((this.matchContext.teamScore | 0) >= 6 || (this.matchContext.enemyScore | 0) >= 6 || rn >= 10)) {
      this.standardEvidence++;
      if (this.standardEvidence >= 2) this.lockStandard('score/round past swiftplay limits');
    } else {
      this.standardEvidence = 0;
    }

    // THE BUY PHASE OF ROUND 5 SAYS WHICH MODE, in printed numbers. Swiftplay
    // swaps sides after round 4, so its round 5 is a PISTOL round: 800 credits
    // and a 45 second buy timer. A standard round 5 is neither, it has four
    // rounds of money and the usual 30 seconds. Measured on the logged
    // sessions: swiftplay round 5 was bought at 0:43 with 800, competitive
    // round 5 at 0:29 with 3,550 and 2,000.
    //
    // This replaced the side swap as the swiftplay tell, which is the model's
    // inference and not a printed fact. On a real competitive match it read the
    // side flipped twice in two seconds at round 5, locked swiftplay, and the
    // wrong lock then went back to the model as context, so rounds 5 to 9 all
    // read as defence and 3 to 5 ended the match in the middle of round 9.
    //
    // Only round 5's own buy phase counts: the score can lag a round, so a buy
    // phase after play at 2 to 2 is round 6 being bought.
    const sideRead = typeof updates.side === 'string' ? updates.side : null;
    const buying = isBuyPhase(updates.phase, updates.clock);
    const L = this.ledger;
    const roundFive = buying && team + enemy === 4 && !!L && L.base === 5 && L.offset === 0
      && !(L.since && L.since.played);
    if (roundFive && typeof updates.playerCredits === 'number' && updates.playerCredits > PISTOL_CREDITS) {
      this.economyEvidence++;
      if (this.economyEvidence >= 2 && this.matchContext.gameMode !== 'standard') {
        this.lockStandard(`round 5 was bought with ${updates.playerCredits} credits, more than a pistol round has`);
      }
    }
    const buyLeft = buying ? clockSeconds(updates.clock) : null;
    if (roundFive && buyLeft !== null && buyLeft >= PISTOL_BUY_LEFT
        && !this.matchContext.gameMode && !this.economyEvidence) {
      this.pistolEvidence++;
      if (this.pistolEvidence >= 2) {
        this.matchContext.gameMode = 'swiftplay';
        console.log(`[engine] game mode locked: swiftplay (round 5 has a pistol round's buy timer, ${updates.clock})`);
      }
    }
    // A team on 5 wins buying another round can only be a standard match,
    // because swiftplay is over at 5.
    if (buying && this.scoreReadThisFrame && Math.max(updates.teamScore, updates.enemyScore) === 5
        && this.matchContext.gameMode !== 'standard') {
      this.buyAtFiveEvidence++;
      if (this.buyAtFiveEvidence >= 2) this.lockStandard(`a buy phase at ${team}-${enemy}, and swiftplay ends at 5`);
    }
    // THE SIDE SWAP, the fallback for a session that missed round 5's buy
    // phase. Only buy phase reads count, where the prompt reads the printed
    // ATTACKING or DEFENDING banner instead of guessing from the spike, and it
    // takes four in a row with nothing in the economy against it.
    if (!this.matchContext.gameMode && !this.economyEvidence && this.firstHalfSide && sideRead && buying
        && rn >= 5 && rn <= 8) {
      if (sideRead === flipSide(this.firstHalfSide)) {
        this.swapEvidence++;
        if (this.swapEvidence >= SWAP_READS) {
          this.matchContext.gameMode = 'swiftplay';
          console.log('[engine] game mode locked: swiftplay (sides swapped in the buy phase of rounds 5-8)');
        }
      } else {
        this.swapEvidence = 0;
      }
    }

    const half = halfOfRound(rn, this.matchContext.gameMode);
    if (half && !this.firstHalfSide && this.matchContext.side) {
      const asFirstHalf = half === 1 ? this.matchContext.side : flipSide(this.matchContext.side);
      if (this.pendingFirstSide === asFirstHalf) {
        this.firstHalfSide = asFirstHalf;
        this.firstHalfLockedAt = rn;
        console.log(`[engine] first-half side locked: ${asFirstHalf}`);
      } else {
        this.pendingFirstSide = asFirstHalf;
      }
    }
    if (half && this.firstHalfSide) {
      const expected = half === 1 ? this.firstHalfSide : flipSide(this.firstHalfSide);
      if (this.matchContext.side !== expected) {
        console.log(`[engine] side corrected by halftime math: round ${rn} -> ${expected} (${this.matchContext.gameMode || 'mode unknown'})`);
        this.matchContext.side = expected;
      }
      this.sideChallenge = null;   // halftime math is authoritative, drop any pending flip
      return;
    }

    // NO HALFTIME MATH AVAILABLE. halfOfRound() returns null for rounds 5-9
    // while the mode is still unknown, because swiftplay and standard disagree
    // about where the half ends, and standard only locks at a score of 6 or
    // round 10. That left a live window with NO side guard at all, and the
    // model's side read is not stable enough to go unguarded: real sessions
    // show 5 stray "attacking" frames inside 33 "defending" ones in rounds 1-5,
    // which is a read that cannot be true, since sides only swap at halftime.
    //
    // So in that window the side becomes sticky. A flip has to be confirmed by
    // two consecutive agreeing reads before it is accepted, exactly like the
    // scoreboard and map guards. One odd frame can no longer turn the coach
    // around and have it call a defence like an attack.
    if (sideRead && this.lockedSide && sideRead !== this.lockedSide) {
      if (this.sideChallenge === sideRead) {
        console.log(`[engine] side flip confirmed by two reads: ${this.lockedSide} -> ${sideRead}`);
        this.lockedSide = sideRead;
        this.sideChallenge = null;
      } else {
        this.sideChallenge = sideRead;
        this.matchContext.side = this.lockedSide;   // hold the line until corroborated
        console.log(`[engine] side read ${sideRead} contradicts locked ${this.lockedSide}, waiting for a second read`);
      }
    } else if (sideRead) {
      this.lockedSide = sideRead;
      this.sideChallenge = null;
    }
  }

  /**
   * Standard is proven. A swiftplay lock before it was wrong, and so is a
   * first-half side derived from its 4 round halves, so that goes too. A side
   * locked in rounds 1 to 4 stays: both modes agree those are the first half.
   */
  lockStandard(why) {
    if (this.matchContext.gameMode === 'swiftplay') {
      console.log(`[engine] mode corrected to standard (${why}), side locks reset`);
      if (this.firstHalfLockedAt === null || this.firstHalfLockedAt > 4) {
        this.firstHalfSide = null;
        this.pendingFirstSide = null;
        this.firstHalfLockedAt = null;
      }
    } else {
      console.log(`[engine] game mode locked: standard (${why})`);
    }
    this.matchContext.gameMode = 'standard';
  }

  /**
   * Ask the server to write the review, then hand everything to the app.
   *
   * THE REVIEW ARRIVES EVEN WHEN THE MODEL DOES NOT. The rounds, the patterns
   * and the scoreline are computed here and in valorant-review.js; the model
   * only adds the summary and a why per round. So a timeout, an empty wallet
   * or a server that is down costs the player the narrative, never the match.
   */
  async requestMatchReview(snap) {
    if (!snap) return;
    // AT ONCE, before the narrative call: the app saves the computed review and
    // holds this match's AI log frames now. Waiting for the model meant a quit,
    // an update or a quick Stop and Start in the next minute lost the review,
    // or pointed its death frames at the next session's empty log.
    this.emit('match-ended', snap);
    let data = null;
    try {
      const body = valorantReview.requestBody(snap);
      body.context = { ...body.context, proPlaybook: snap.context.proPlaybook };
      // 60s rather than the 30s every frame gets: this is one call a match, it
      // writes up to ten round explanations, and the player is in a menu.
      const res = await api.post(API.MATCH_REVIEW, body, this.licenseKey, 60000);
      data = res && res.ok ? res.data : null;
      if (!data) console.error('[engine] match-review status', res && res.status);
    } catch (e) {
      console.error('[engine] match-review error:', e.message);
    }
    // The match resumed while the narrative was being written: this review is
    // of half a match that is still going, and must never open.
    if (snap.voided) {
      console.log('[engine] review dropped, the match it reviewed is still being played');
      return;
    }
    this.emit('match-review', data && data.review ? data.review : null, { ...snap, ai: data });
  }
}

// ── helpers ──────────────────────────────────────────────────────────────────
function freshContext() {
  return {
    agent: null, agentConfirmed: false, map: null, side: null, teammates: null,
    gameMode: null,   // 'swiftplay' (4-round halves) | 'standard' (12) | null; locked by 2 agreeing reads or score math
    roundNumber: 0, teamScore: 0, enemyScore: 0, clock: null,   // round timer (mm:ss) for stage-aware coaching
    phase: 'unknown', playerCredits: null, playerWeapon: null, playerAlive: true,
    playerUlt: null,  // 'ready' | 'charging' | null. Spectator-owned: after a death the
                      // ultimate icon on the HUD belongs to the teammate being watched.

    teammatesAlive: null, enemiesAlive: null,   // reported by the AI from the HUD bar
    playerHp: null,   // own health number: the ground truth for being alive
    deathSpot: null,  // where the player died, pinned at death; positional reads go stale once spectating starts
    spike: null,      // 'planted' | 'carried' | 'dropped', drives retake / post-plant coaching
    spikeSpot: null,  // where it is, for the retake call
    killFeed: null,   // last factual event from the kill feed (top right)
    teamRead: null,   // pre-round minimap read of the team's plan ("4 A, player alone mid")
    teamReadAt: 0,    // when that read landed; the plan expires so a rotate is not coached against
    playerSpot: null, // the player's own minimap location ("B main", "mid"), cleared each buy phase
    playerSpotVerified: false, // true when the spot came from minimap coordinates, not the model's wording
    consecutiveDeaths: 0, consecutiveWins: 0, roundsPlayed: 0,
  };
}

/**
 * Which half a round belongs to, or null when the side must be trusted from
 * the HUD instead of derived:
 *   swiftplay  rounds 1-4 first half, 5-8 second, 9 (sudden death) HUD
 *   standard   rounds 1-12 first half, 13-24 second, 25+ (overtime) HUD
 *   unknown    rounds 1-4 first half (both modes agree), 5-9 ambiguous (a
 *              swiftplay may already have swapped), 10-24 standard halves by
 *              elimination (swiftplay never reaches round 10), 25+ HUD
 */
function halfOfRound(rn, mode) {
  if (rn < 1) return null;
  if (mode === 'swiftplay') return rn <= 4 ? 1 : rn <= 8 ? 2 : null;
  if (mode === 'standard')  return rn <= 12 ? 1 : rn <= 24 ? 2 : null;
  if (rn <= 4) return 1;
  if (rn >= 10 && rn <= 24) return rn <= 12 ? 1 : 2;
  return null;
}

/** A quantile of a list of milliseconds, taken the way the cadence always took its p90. */
function quantile(list, q) {
  const sorted = list.slice().sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
}

// Tidy a raw enemy-spot token into a readable callout, e.g. "a_main" → "A Main".
function prettySpot(spot) {
  return String(spot).replace(/[_-]+/g, ' ').trim().replace(/\b\w/g, (c) => c.toUpperCase());
}

// The fastest a Valorant round can possibly repeat: a 30 second buy phase plus
// the shortest survivable round. Real rounds average well over a minute, so
// this is already generous, and it needs to be: too loose and a run of rejected
// reads banks enough time for the bad value to walk in anyway, which is exactly
// what 30 seconds did when replayed against the session that prompted this.
const MIN_ROUND_MS = 40000;

// How long a score step can still be taken back as a misread: a round and a
// buy phase. Past it, a buy phase has confirmed the step or the match moved on.
const STEP_ROLLBACK_MS = 3 * 60 * 1000;

// A pistol round's money and buy timer, the two printed facts that tell a
// swiftplay round 5 from a standard one. A normal buy phase is 30 seconds, so
// 32 leaves a misread digit some room.
const PISTOL_CREDITS = 800;
const PISTOL_BUY_LEFT = 32;
// Buy phase side reads in a row that make a side swap at round 5 believable.
const SWAP_READS = 4;

// How long the engine stops sending frames after the AI reports it is out of
// credits. Long enough that an outage costs almost nothing, short enough that
// topping up resumes coaching on its own without a restart.
const AI_CREDITS_BACKOFF_MS = 3 * 60 * 1000;

// How long sending stops after the server's read limiter answers 429. The
// limiter counts reads a minute per licence, and the cadence steps down once
// as well, so what resumes asks less of it.
const RATE_LIMIT_PAUSE_MS = 10000;

// How many captures one line of the capture log sums up: a minute at a read a
// second, enough for a p90 that means something.
const CAPTURE_LOG_EVERY = 60;

// How long a pre-round team plan stays trustworthy once the round is live. A
// round is 1:40, so a plan from the buy phase describes the opening push; past
// this the team has usually rotated and the plan misleads more than it helps.
const TEAM_PLAN_TTL_MS = 45000;

// Evidence that the player is genuinely dead and spectating, as reported in the
// model's aliveTell. Any one of these is direct proof, so the death registers
// from a single frame instead of waiting ~12s for a second one to agree.
const DEAD_TELL = /spectat|kill ?cam|death ?recap|observer|you died|respawn|teammate'?s? (?:name|loadout)|no hp|grey(?:ed)?[- ]?out/i;
// A read the model itself was not sure about never counts as proof.
const UNSURE_TELL = /unreadable|kept previous|unclear|not sure|cannot tell|can.?t tell|assum/i;

// Which maps contain a given printed location label. Built from the game's own
// callout data, so it stays correct as maps are added or renamed.
const MAP_LABEL_INDEX = (() => {
  try {
    const geo = require('../../shared/valorant-data.generated.json').mapGeometry || {};
    const idx = {};
    for (const [map, g] of Object.entries(geo)) {
      const names = new Set();
      for (const c of g.callouts) {
        names.add(c.n.toLowerCase());
        if (c.a) names.add(String(c.a).toLowerCase());
      }
      idx[map] = names;
    }
    return idx;
  } catch (e) {
    console.log('[engine] map label index unavailable:', e.message);
    return {};
  }
})();

/**
 * A printed label as the index stores it.
 *
 * The model sometimes qualifies what the game prints, "B Site (Attacker Side)"
 * for "B Site". The qualifier is commentary, not part of the name, and keeping
 * it turns a perfectly good label into an unknown one.
 */
function normaliseLabel(l) {
  return String(l || '')
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Narrow the map by intersecting every printed label seen so far.
 *
 * ONE UNKNOWN LABEL USED TO DISABLE THIS FOR THE ENTIRE SESSION. The test was
 * that EVERY label seen so far belongs to the candidate map, so a single name
 * the index did not carry ("Fountain", which is a real Bind callout the game
 * data does not list) emptied the candidate set and it never refilled. No error,
 * no log line: the map lock, and the callout gate that depends on it, simply
 * stopped existing, which is the failure this guard was written to prevent.
 *
 * It survived a long time because it needs a model that phrases labels slightly
 * differently to trigger it. Across three sessions on the previous model there
 * was not one unrecognised label; the first session on a new one produced two in
 * the first four frames and the map never locked again.
 *
 * A label no map has ever printed cannot tell two maps apart, so it is now
 * ignored rather than allowed to poison the set. The strictness that matters is
 * kept exactly as it was: every label that IS recognised must still agree on one
 * map, so a real callout from the wrong map still blocks the lock.
 */
function mapsWithLabel(l) {
  const hits = [];
  for (const [map, names] of Object.entries(MAP_LABEL_INDEX)) {
    // The game prints "B Fountain"; a model reasonably writes "Fountain". Accept
    // the bare name when the site letter is the only thing missing, otherwise a
    // map-exclusive callout is thrown away as unrecognised.
    if (names.has(l) || names.has(`a ${l}`) || names.has(`b ${l}`) || names.has(`c ${l}`)) hits.push(map);
  }
  return hits;
}

/**
 * Narrow the map by intersecting the printed labels seen so far, then, if that
 * is inconclusive, by weighing them.
 *
 * NOT ALL LABELS ARE WORTH THE SAME, and treating them as equal is what broke
 * this. "B Long" exists on exactly one map, so seeing it IS the answer. "A Site"
 * exists on all thirteen and carries no information whatsoever. Under a plain
 * intersection a single wrong generic label ("B Main", real, on nine maps, not
 * one of them Bind) silently vetoes a label that identified the map outright,
 * and the lock never engages for the rest of the session.
 *
 * So a label now counts for 1/(number of maps that have it): exclusive callouts
 * dominate, generic ones barely register, and one misread cannot cancel real
 * evidence. Locking still demands a lot, because a WRONG lock is worse than
 * none: the model can no longer correct it, and the callout gate starts
 * rejecting valid callouts. It needs a full exclusive-label's worth of evidence
 * and to beat the runner up by double.
 */
const LABEL_EVIDENCE_MIN = 1.0;    // one map-exclusive label, or several near-exclusive ones
const LABEL_EVIDENCE_EDGE = 2;     // and it must be twice the next best map
// ...AND enough labels to be worth weighing at all. Weighing exists to stop one
// bad label vetoing good ones, which only makes sense once there are good ones
// to protect. On two or three labels a single wrong-but-real callout can carry
// the vote outright, and a real 3-frame sample did exactly that, locking Haven
// on a Bind session. Below this the strict path still locks whenever the labels
// genuinely agree, so clean evidence is never held back; only the contested case
// has to wait, which is the case that needs the evidence.
const LABEL_VOTE_MIN = 4;

function mapFromLabels(labels) {
  const seen = [...new Set((labels || []).map(normaliseLabel).filter(Boolean))];
  if (!seen.length) return null;
  const known = seen.map((l) => [l, mapsWithLabel(l)]).filter(([, m]) => m.length);
  if (!known.length) return { map: null, confident: false, candidates: [] };

  const title = (n) => n.charAt(0).toUpperCase() + n.slice(1);

  // Clean agreement: every recognised label fits one map and only one. This is
  // the original rule and it still decides the common case.
  const candidates = Object.keys(MAP_LABEL_INDEX)
    .filter((map) => known.every(([, maps]) => maps.includes(map)));
  if (candidates.length === 1) {
    return { map: title(candidates[0]), confident: true, candidates };
  }

  // Contradictory labels. Weigh them by how much each one actually narrows the
  // map rather than letting the weakest veto the strongest, but only once there
  // is enough of them that the weighing means something.
  if (known.length < LABEL_VOTE_MIN) return { map: null, confident: false, candidates };
  const score = new Map();
  for (const [, maps] of known) {
    const w = 1 / maps.length;
    for (const m of maps) score.set(m, (score.get(m) || 0) + w);
  }
  const ranked = [...score.entries()].sort((a, b) => b[1] - a[1]);
  const [best, bestScore] = ranked[0] || [null, 0];
  const runnerUp = ranked[1] ? ranked[1][1] : 0;
  if (best && bestScore >= LABEL_EVIDENCE_MIN && bestScore >= runnerUp * LABEL_EVIDENCE_EDGE) {
    return { map: title(best), confident: true, candidates: [best] };
  }
  return { map: null, confident: false, candidates };
}

module.exports = CoachingEngine;
// Exposed for tests: the map fingerprint is the guard the review leans on.
module.exports.__test = { mapFromLabels };

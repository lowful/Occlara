'use strict';

/**
 * fn() with Date.now reading `at`, for one synchronous call and no longer.
 *
 * The engine has no clock of its own to hand in: its guards read Date.now
 * directly. So code that drives it over frames from another time (the benches
 * over a saved session, an imported recording over its video) sets the clock
 * around each call into it. Never across an await: everything else in the
 * process would then read the wrong time.
 *
 * Whole milliseconds, as the real Date.now: a file's modified time has a
 * fraction, and a review id built from one is refused by the review store.
 */
function withClock(at, fn) {
  const real = Date.now;
  const now = Math.floor(at);
  Date.now = () => now;
  try {
    return fn();
  } finally {
    Date.now = real;
  }
}

module.exports = { withClock };

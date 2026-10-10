'use strict';

/**
 * The last stop for an error, and the line between the client's mistakes and
 * the server's.
 *
 * Everything used to arrive here as a 500. body-parser hands over a malformed
 * JSON body ('entity.parse.failed') and a body the client stopped sending
 * halfway ('request.aborted', which happens whenever the app quits or the
 * network drops with up to four reads in flight), both already carrying
 * status 400, and the CORS callback handed over a plain Error. All three were
 * answered "Internal server error", logged as "[server] Error" and pushed into
 * the admin view's Recent errors, so the panel built to diagnose crashes filled
 * up with other people's mistakes.
 *
 * A 4xx is now answered with its own status and kept out of presence.errors.
 * Only what is left, the server's own failures, is a 500.
 */

const { presence } = require('./presence');

/** What a client is told for each kind of client error. */
const CLIENT_ERRORS = {
  'entity.parse.failed': 'Malformed JSON body',
  'request.aborted': 'Request aborted',
  'cors.refused': 'Origin not allowed',
};

/** The error the CORS origin callback refuses with: a client error, not a crash. */
function corsRefusal() {
  const err = new Error('Not allowed by CORS');
  err.status = 400;
  err.type = 'cors.refused';
  return err;
}

function errorHandler(err, req, res, _next) {
  const path = String((req && (req.originalUrl || req.url)) || '').split('?')[0];
  // A body over the limit is the client's problem and gets its real status,
  // not a 500 that reads as the server failing.
  if (err && (err.type === 'entity.too.large' || err.status === 413)) {
    console.warn(`[server] body too large on ${path}`);
    if (res.headersSent) return undefined;
    return res.status(413).json({ error: 'Request too large' });
  }

  const status = Number(err && (err.status || err.statusCode)) || 0;
  if (status >= 400 && status < 500) {
    // An aborted upload is the client going away, which is routine and says
    // nothing worth a log line. The others get one, never an error entry.
    if (err.type !== 'request.aborted') {
      console.warn(`[server] ${status} ${err.type || err.message || 'client error'} on ${path}`);
    }
    if (res.headersSent) return undefined;
    return res.status(status).json({ error: CLIENT_ERRORS[err.type] || 'Bad request' });
  }

  console.error('[server] Error:', err && err.message);
  presence.error(path, err);
  if (res.headersSent) return undefined;
  return res.status(500).json({ error: 'Internal server error' });
}

module.exports = { errorHandler, corsRefusal, CLIENT_ERRORS };

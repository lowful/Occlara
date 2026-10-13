'use strict';

/**
 * The routes of a game Occlara no longer coaches, answered so an older
 * install is told why.
 *
 * MARVEL RIVALS WAS REMOVED after 8.3.2, and Occlara coaches Valorant and
 * League of Legends. An install from 8.3.2 or before that was left on it still
 * calls /api/rivals/draft at hero select and /api/rivals/review on the
 * scoreboard, and the hero bench called /api/rivals/identify. Every path under
 * /api/rivals, by any method, answers 410 with one sentence and does nothing
 * else: no licence lookup and no model call, so an old install spends nothing
 * either, and no rate limit, so the answer is the same however often it asks.
 * server.js mounts it where those routes were.
 */
const express = require('express');

const RIVALS_GONE = 'Marvel Rivals is no longer supported by Occlara. Update Occlara at occlara.app.';

const rivals = express.Router();
rivals.use((req, res) => res.status(410).json({ error: RIVALS_GONE }));

module.exports = { rivals, RIVALS_GONE };

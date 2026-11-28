'use strict';

/**
 * The stated facts the patch gate withholds on the synced patch, one a line,
 * and nothing when it withholds none. Offline, no package needed.
 *
 * WHY IT EXISTS (9.1). The daily sync brought 13.10 on 10 Nov 2026, two of its
 * bug fix lines name the spike, and from that deploy the server left the plant,
 * the defuse, its half, the timer, the beeps and the plant pay out of every
 * review and Ask Coach prompt for 18 days, while seven checks failed and were
 * listed as known failures instead of read. sync-valorant.yml runs this after
 * a sync and opens an issue when it prints anything, so the next patch is a
 * read and a re-stamp (docs/claude/primer.md), never a silent gap.
 *
 * Run: node scripts/primer-withheld.js
 */

const path = require('path');

const primer = require(path.join(__dirname, '..', 'server', 'services', 'game-primer.js'));
const held = primer.statedGate();
for (const [id, why] of Object.entries(held)) console.log(`- ${id}: ${why}`);

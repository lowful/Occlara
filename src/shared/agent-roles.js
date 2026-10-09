'use strict';

/**
 * An agent's role, for code under src/shared, which cannot reach
 * src/main/services/agent-data.js. Read from the same generated agent data,
 * and case insensitive, because Riot's record and the screen do not always
 * agree on how a name is cased.
 */

let ROLES = new Map();
try {
  const d = require('./valorant-data.generated.json');
  ROLES = new Map(Object.entries(d.agents || {}).map(([name, a]) => [name.toLowerCase(), (a && a.role) || null]));
} catch {
  ROLES = new Map();
}

function roleOf(agent) {
  return agent ? ROLES.get(String(agent).trim().toLowerCase()) || null : null;
}

module.exports = { roleOf };

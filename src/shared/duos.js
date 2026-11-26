'use strict';

/**
 * OCCLARA DUOS, the app's half (docs/claude/duos.md).
 *
 * Pure: no Electron, no network, no file system, so test:duos drives it.
 *
 *   the rules       DUO RULES, below, word for word server/services/duos.js's
 *                   (src/ never requires server/, so test:duos holds the two
 *                   blocks equal)
 *   reportOf        what the app tells the server about a match it reviewed:
 *                   Riot's match id, both teams as their agents, its agent
 *   sheetOf         the sheet it uploads for a shared match, from its own
 *                   review: numbers, agents, the map, Riot's places and guns,
 *                   fixed keys. Never a sentence of a review (no summary, no
 *                   why, no read, no look's words, no fact line), never a name
 *   clipsOf         the clips of the review it may share (death r, flagged d,
 *                   highlight h), each with its marks and its ANCHOR: where
 *                   the round's own clock lies in the clip, from Riot's
 *                   moment of the death or the first kill
 *   the words       every line the Duos page says, finished here so the page
 *                   counts nothing
 */

const DATA = require('./valorant-data.generated.json');

// ── DUO RULES START (word for word the same in src/shared/duos.js) ────────
const DUO = Object.freeze({
  PARTNERS_MAX: 5,                          // live duos an account may be in, active or paused
  INVITES_OPEN_MAX: 10,                     // open invites an account may have sent
  INVITE_DAYS: 7,                           // an invite, by name or by code, lasts this long
  CODE_LEN: 10,                             // 10 of 32 letters: 50 bits
  GUESSES_PER_DAY: 10,                      // wrong codes an account may paste in a rolling day
  KEEP_DAYS: 30,                            // a shared match, its sheets, clips and pins, from the match
  REPORT_DAYS: 3,                           // a report of a reviewed match is kept this long
  REPORT_GAME_HOURS: 4,                     // the live game a report spends is at most this old
  PAIR_WINDOW_MIN: 180,                     // two reports of one match pair up within this
  CLIP_MAX_BYTES: 80 * 1024 * 1024,         // one clip, the bucket's own file limit too
  CLIPS_PER_MATCH: 18,                      // one account's clips of one shared match
  UPLOAD_BYTES: 2 * 1024 * 1024 * 1024,     // uploaded by one account in QUOTA_DAYS, every upload counted
  QUOTA_DAYS: 30,
  DOWNLOAD_BYTES_DAY: 1536 * 1024 * 1024,   // downloaded by one account in a rolling day
  DOWNLOAD_URLS_DAY: 120,                   // download URLs one account may be given in a rolling day
  DOWNLOAD_URL_SEC: 10,                     // a download URL's life: enough to START a fetch on a slow line
  ISSUES_MAX: 6,                            // upload URLs one clip may be given, retries included
  PINS_PER_CLIP: 20,                        // one author's pins on one clip
  SHEET_MAX_BYTES: 24 * 1024,
  ROUNDS_MAX: 50,
  CACHE_BYTES: 2 * 1024 * 1024 * 1024,      // the partner's clips kept on this PC, least recently used first out
  ENDED_DAYS: 14,                           // an ended duo is said on the page this long
  MATCHES_MAX: 60,
});
const PIN_LABELS = Object.freeze(['good-trade', 'should-trade', 'too-far', 'good-utility', 'wait-for-me', 'nice-shot', 'wrong-timing', 'my-mistake']);
const PIN_WORDS = Object.freeze({
  'good-trade': 'Good trade', 'should-trade': 'Should have traded', 'too-far': 'Too far from me', 'good-utility': 'Good utility',
  'wait-for-me': 'Wait for me', 'nice-shot': 'Nice shot', 'wrong-timing': 'Wrong timing', 'my-mistake': 'My mistake',
});
const REACTIONS = Object.freeze(['nice', 'wow', 'agreed', 'oops']);
const REACTION_WORDS = Object.freeze({ nice: 'Nice', wow: 'Wow', agreed: 'Agreed', oops: 'Oops' });
// No 0, 1, I or O: a code read aloud or retyped is never two codes.
const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const CLIP_NAME = /^[rdh]\d{1,3}-clip\.mkv$/;
const CLIP_KINDS = Object.freeze(['death', 'flag', 'highlight']);
const CAUSE_KEYS = Object.freeze(['dry-peek', 'isolated', 'repeek', 'crossfire', 'rotating', 'overextend', 'exposed', 'no-escape', 'lost-duel']);
const MODES = Object.freeze(['Competitive', 'Unrated', 'Swiftplay', 'Spike Rush', 'Premier', 'Standard', 'New Map']);

/** A code as a player pasted it ("k7m2-q9xh 4p", any case), as its 10 letters, or null. */
function codeOf(input) {
  if (typeof input !== 'string' || input.length > 40) return null;
  const t = input.toUpperCase().split('').filter((c) => c !== ' ' && c !== '-').join('');
  if (t.length !== DUO.CODE_LEN) return null;
  return t.split('').every((c) => CODE_ALPHABET.includes(c)) ? t : null;
}

/** A code as it is shown: "K7M2Q-9XH4P". */
const codeShown = (code) => (typeof code === 'string' && code.length === DUO.CODE_LEN ? `${code.slice(0, 5)}-${code.slice(5)}` : '');
// ── DUO RULES END ──────────────────────────────────────────────────────────

const plain = (s) => String(s || '').replace(/[^A-Za-z0-9]/g, '').toLowerCase();
const AGENTS = new Map(Object.keys(DATA.agents || {}).map((n) => [plain(n), n]));
const MAPS = new Map((DATA.maps || []).map((n) => [plain(n), n]));
const agentOf = (s) => (typeof s === 'string' && s.length <= 24 ? AGENTS.get(plain(s)) || null : null);
const mapOf = (s) => (typeof s === 'string' && s.length <= 24 ? MAPS.get(plain(s)) || null : null);
const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
const num = (x) => typeof x === 'number' && Number.isFinite(x);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ── What the app reports, and what it uploads ──────────────────────────────

/**
 * The report of one reviewed Valorant match: { matchId, us, them, agent }, or
 * null when the review is not linked to Riot's record (no matchId) or does
 * not know both teams (its comps). The server hashes the id at once.
 */
function reportOf(saved) {
  const r = saved && saved.review ? saved.review : saved;
  if (!isObj(r) || r.kind !== 'valorant' || r.source === 'riot' || r.locked === true) return null;
  const id = typeof r.matchId === 'string' && UUID_RE.test(r.matchId) ? r.matchId.toLowerCase() : null;
  const comps = isObj(r.comps) ? r.comps : null;
  const team = (xs) => (Array.isArray(xs) ? xs.map((x) => agentOf(x && x.agent)).filter(Boolean) : []);
  const agent = agentOf(r.game && r.game.agent);
  if (!id || !comps || !agent) return null;
  const us = team(comps.us);
  const them = team(comps.them);
  if (us.length < 2 || !us.includes(agent)) return null;
  return { matchId: id, us, them, agent };
}

const RESULT = { Victory: 'W', Defeat: 'L', Draw: 'D' };
const secOf = (ms) => (num(ms) && ms >= 0 ? Math.round(ms / 1000) : null);
/** The player's own death in a round, Riot's ms, off the feed (on: 'me'), else its second. */
function deathMsOf(card) {
  const riot = card && card.riot;
  const feed = riot && Array.isArray(riot.feed) ? riot.feed : [];
  const e = feed.find((k) => k && k.on === 'me' && num(k.ms));
  if (e) return e.ms;
  return riot && num(riot.sec) ? riot.sec * 1000 : null;
}
/** The player's own kills in a round, Riot's ms, in order. */
function killMsOf(card) {
  const feed = card && card.riot && Array.isArray(card.riot.feed) ? card.riot.feed : [];
  return feed.filter((k) => k && k.by === 'me' && num(k.ms)).map((k) => k.ms).sort((a, b) => a - b);
}

/**
 * The sheet of one shared match, from the player's own saved review: the
 * server's cleaner (duos.js cleanSheet) reads exactly these keys. Only Riot's
 * verified facts of a round, and the screen's place of a death only as a
 * place the server finds on the map. Null for a review that is not a
 * Valorant one.
 */
function sheetOf(saved) {
  const r = saved && saved.review ? saved.review : saved;
  if (!isObj(r) || r.kind !== 'valorant') return null;
  const g = isObj(r.game) ? r.game : {};
  const sc = typeof g.score === 'string' ? /^(\d{1,2})-(\d{1,2})$/.exec(g.score) : null;
  const score = sc ? { us: Number(sc[1]), them: Number(sc[2]) } : null;
  const line = isObj(r.scoreline) && Number.isInteger(r.scoreline.kills) && Number.isInteger(r.scoreline.deaths)
    ? { k: r.scoreline.kills, d: r.scoreline.deaths, a: Number.isInteger(r.scoreline.assists) ? r.scoreline.assists : 0 } : null;
  const grade = isObj(r.grade) && Number.isInteger(Math.round(r.grade.score)) && num(r.grade.score) ? { score: Math.max(0, Math.min(100, Math.round(r.grade.score))) } : null;
  const rounds = [];
  for (const c of Array.isArray(r.rounds) ? r.rounds : []) {
    if (!isObj(c) || !Number.isInteger(c.n) || c.n < 1 || c.n > DUO.ROUNDS_MAX) continue;
    if (rounds.length && rounds[rounds.length - 1].n >= c.n) continue;
    const riot = isObj(c.riot) ? c.riot : null;
    const died = c.died === true;
    const dms = died ? deathMsOf(c) : null;
    const kills = killMsOf(c).map(secOf).filter((x) => x !== null && x <= 200).slice(0, 5);
    const row = {
      n: c.n,
      side: c.sideKey === 'attacking' ? 'atk' : c.sideKey === 'defending' ? 'def' : null,
      won: c.result === 'won' ? true : c.result === 'lost' ? false : null,
      died,
      kills: died && dms !== null ? kills.filter((s) => s <= secOf(dms) + 1) : kills,
      fk: !!(riot && riot.firstKill),
    };
    if (died) {
      const s = secOf(dms);
      if (s !== null && s <= 200) row.sec = s;
      const place = (riot && typeof riot.place === 'string' && riot.place) || (typeof c.spot === 'string' && c.spot) || null;
      if (place) row.place = place.slice(0, 40);
      if (riot && riot.killer) row.killer = String(riot.killer).slice(0, 24);
      if (riot && riot.weapon) row.weapon = String(riot.weapon).slice(0, 32);
      row.fd = !!(riot && riot.firstDeath);
      if (riot && typeof riot.traded === 'boolean') row.traded = riot.traded;
      if (riot && isObj(riot.alive) && Number.isInteger(riot.alive.mates) && Number.isInteger(riot.alive.enemies)) {
        row.alive = { mates: Math.max(0, Math.min(4, riot.alive.mates)), enemies: Math.max(0, Math.min(5, riot.alive.enemies)) };
      }
      const cause = c.forensics && typeof c.forensics.cause === 'string' ? c.forensics.cause : null;
      if (cause && CAUSE_KEYS.includes(cause)) row.cause = cause;
    }
    if (riot && isObj(riot.clutch) && Number.isInteger(riot.clutch.vs) && riot.clutch.vs >= 1 && riot.clutch.vs <= 5) {
      row.clutch = { vs: riot.clutch.vs, won: typeof riot.clutch.won === 'boolean' ? riot.clutch.won : null };
    }
    if (c.planted && riot && /^[ABC]$/.test(String(riot.plantSite || ''))) {
      row.plant = { site: riot.plantSite, sec: num(riot.plantSec) && riot.plantSec >= 0 && riot.plantSec <= 200 ? Math.round(riot.plantSec) : null };
    }
    if (riot && Array.isArray(riot.killPlaces) && riot.killPlaces.length) row.killPlaces = riot.killPlaces.filter((p) => typeof p === 'string').slice(0, 5).map((p) => p.slice(0, 40));
    rounds.push(row);
  }
  // Rounds past the score (a review that read more rounds than the match had) are left out.
  const kept = score ? rounds.filter((x) => x.n <= score.us + score.them) : rounds;
  return {
    v: 1, agent: agentOf(g.agent), map: mapOf(g.map), mode: MODES.includes(g.mode) ? g.mode : null,
    result: RESULT[g.result] || null, score, grade, line, rounds: kept,
  };
}

/**
 * The clips of a review the app may share, each { name, round, kind, marks }
 * with marks { death, kills, cuts, anchor } in ms on the clip's own timeline.
 * THE ANCHOR is one moment known on both clocks, { clip, round }: the death
 * (the clip's clipDeath and Riot's moment of it in the round) or a
 * highlight's first kill (its first kill mark and Riot's first kill). A clip
 * with no such moment has none, and the page plays it alone, never on a
 * guessed clock. `has(name)` says whether the file is on disk.
 */
function clipsOf(saved, has) {
  const r = saved && saved.review ? saved.review : saved;
  if (!isObj(r) || r.kind !== 'valorant') return [];
  const on = typeof has === 'function' ? has : () => true;
  const byRound = new Map((Array.isArray(r.rounds) ? r.rounds : []).filter((c) => isObj(c) && Number.isInteger(c.n)).map((c) => [c.n, c]));
  const out = [];
  const ms = (x) => (num(x) && x >= 0 ? Math.round(x) : null);
  const push = (name, round, kind, marks) => {
    if (!CLIP_NAME.test(String(name || '')) || !Number.isInteger(round) || round < 1 || round > DUO.ROUNDS_MAX || !on(name)) return;
    if (out.some((c) => c.name === name)) return;
    out.push({ name, round, kind, marks });
  };
  for (const c of byRound.values()) {
    const f = isObj(c.forensics) ? c.forensics : null;
    if (f && typeof f.clip === 'string' && f.clip[0] === 'r') {
      const death = ms(f.clipDeath);
      const dms = deathMsOf(c);
      push(f.clip, c.n, 'death', { death, kills: [], cuts: [], anchor: death !== null && num(dms) ? { clip: death, round: Math.round(dms) } : null });
    }
    const h = isObj(c.highlight) ? c.highlight : null;
    if (h && typeof h.clip === 'string' && h.clip[0] === 'h') {
      const kills = (Array.isArray(h.kills) ? h.kills : []).map(ms).filter((x) => x !== null).sort((a, b) => a - b);
      const cuts = (Array.isArray(h.cuts) ? h.cuts : []).filter((x) => isObj(x) && ms(x.at) !== null && ms(x.skipped) !== null).map((x) => ({ at: ms(x.at), skipped: ms(x.skipped) }));
      const first = killMsOf(c)[0];
      push(h.clip, c.n, 'highlight', { death: null, kills, cuts, anchor: kills.length && num(first) ? { clip: kills[0], round: Math.round(first) } : null });
    }
  }
  const flags = r.deathFlags && Array.isArray(r.deathFlags.rounds) ? r.deathFlags.rounds : [];
  for (const fl of flags) {
    if (!isObj(fl) || typeof fl.clip !== 'string' || fl.clip[0] !== 'd' || !Number.isInteger(fl.n)) continue;
    const death = ms(fl.clipDeath);
    const card = byRound.get(fl.n);
    const dms = card && card.died ? deathMsOf(card) : null;
    push(fl.clip, fl.n, 'flag', { death, kills: [], cuts: [], anchor: death !== null && num(dms) && !fl.noDeath ? { clip: death, round: Math.round(dms) } : null });
  }
  out.sort((a, b) => a.round - b.round || a.name.localeCompare(b.name));
  return out.slice(0, DUO.CLIPS_PER_MATCH);
}

// ── The words ──────────────────────────────────────────────────────────────

const plural = (n, one, many) => `${n} ${n === 1 ? one : many || `${one}s`}`;
/** "just now", "12 min ago", "3 h ago", "2 days ago". */
function agoText(iso, now = Date.now()) {
  const t = Date.parse(iso || '');
  if (!Number.isFinite(t)) return '';
  const m = Math.max(0, Math.round((now - t) / 60000));
  if (m < 2) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 36) return `${h} h ago`;
  return plural(Math.round(h / 24), 'day') + ' ago';
}
/** "expires in 29 days", "expires in 5 h", "expires today". */
function leftText(iso, now = Date.now()) {
  const t = Date.parse(iso || '');
  if (!Number.isFinite(t)) return '';
  const h = (t - now) / 3600000;
  if (h <= 1) return 'expires within the hour';
  if (h < 36) return `expires in ${Math.round(h)} h`;
  return `expires in ${plural(Math.round(h / 24), 'day')}`;
}
/** 1536 MB as "1.5 GB", 120 MB as "120 MB". */
function bytesText(n) {
  const b = Number(n) || 0;
  if (b >= 1024 ** 3) return `${Math.round((b / 1024 ** 3) * 10) / 10} GB`;
  return `${Math.max(0, Math.round(b / 1024 ** 2))} MB`;
}
/** A second of a round as the game's clock counts up: "0:34". */
const clockText = (s) => (num(s) && s >= 0 ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}` : '');

const SAID = Object.freeze({
  offline: 'Occlara could not reach its server. Check your connection and try again.',
  'signed-out': 'Sign in to an Occlara account to use Duos.',
  'no-username': 'Pick a username on your Profile first. It is how your duo partner knows you.',
  failed: 'Something went wrong on our side. Try again in a moment.',
  busy: 'Too many requests in a short time. Wait a minute and try again.',
  loading: 'Loading your duos',
});
const WHAT = 'Play with a friend who uses Occlara. After each match you play together on one team, you both see where each of you died, what each of you was doing round by round, and each other\'s clips, side by side.';
const NEEDS_MAX = 'Duos needs a Max plan on one side. You can start a duo with Max, and anyone can join one, with any plan or none.';
const ASK_INVITE = 'Ask a friend with Max to invite you, or paste the code they sent you below.';
const NAMES_NOTE = 'A partner\'s clip is their own screen recording, shared by their choice, so it shows the game as it was on their screen, names in the kill feed and scoreboard included. Everything else here is numbers, agents and places.';

/** An invite's or accept's answer, as one line. */
function inviteLine(reason, o = {}) {
  switch (reason) {
    case 'sent': return 'Invite sent. If that player can be invited, they see it on their Duos page.';
    case 'made': return 'Send this code to your friend any way you like. It works once.';
    case 'paired': return o.username ? `You and ${o.username} are a duo now.` : 'You are a duo now.';
    case 'partner': return o.username ? `You and ${o.username} are already a duo.` : 'You are already a duo with that player.';
    case 'no-username': return SAID['no-username'];
    case 'no-max': return 'Starting a duo needs a Max plan.';
    case 'too-many': return `You have ${DUO.INVITES_OPEN_MAX} invites waiting. Cancel one first.`;
    case 'full': return `You are in ${DUO.PARTNERS_MAX} duos, the most there can be. Remove one first.`;
    case 'their-full': return `That player is in ${DUO.PARTNERS_MAX} duos already.`;
    case 'self': return 'That is your own username.';
    case 'already': return 'You already invited that player. The invite is waiting.';
    case 'bad-code': return 'That code does not work. It may be mistyped, used or expired.';
    case 'guesses': return 'Too many codes that did not work today. Try again tomorrow.';
    case 'own': return 'That is your own code. Send it to your friend.';
    case 'gone': return 'That invite is not there any more.';
    case 'name': return 'Type the username exactly, 3 to 20 letters, digits or underscores.';
    case 'offline': return SAID.offline;
    case 'busy': return SAID.busy;
    default: return SAID.failed;
  }
}

/** Why a duo is paused, or what keeps it active. */
function stateWords(p) {
  if (p.state === 'paused') return 'Paused: neither of you has Max now. Nothing new is shared, and what was shared stays until it expires.';
  if (p.max === 'both') return 'Active: you both have Max.';
  if (p.max === 'you') return 'Active on your Max plan.';
  return `Active on ${p.username}'s Max plan.`;
}

/** The page's home model, from GET /me and GET /matches. */
function homeModel(me, matches, o = {}) {
  const now = o.now || Date.now();
  if (!isObj(me)) return null;
  const partners = (me.partners || []).map((p) => ({
    username: p.username, state: p.state, stateLine: stateWords(p),
    rank: p.rank ? `${p.rank.tier}${p.rank.source === 'verified' ? '' : ', from their PC'}` : null,
    since: p.since ? `Duo since ${agoText(p.since, now).replace(/ ago$/, '')} ago` : null,
    pins: p.newPins ? `${plural(p.newPins, 'new pin')} on your clips` : null,
    matches: p.matches ? plural(p.matches, 'shared match', 'shared matches') : 'No shared match yet',
  }));
  return {
    username: me.username || null,
    max: me.max === true,
    discoverable: me.discoverable === true,
    partners,
    full: partners.length >= DUO.PARTNERS_MAX,
    ended: (me.ended || []).map((e) => ({ line: e.byMe ? `You ended your duo with ${e.username}, ${agoText(e.at, now)}. What you shared was deleted.`
      : `${e.username} ended your duo, ${agoText(e.at, now)}. What you shared was deleted.` })),
    invitesIn: (me.invitesIn || []).map((i) => ({ username: i.username, line: `Wants to be your duo, ${agoText(i.at, now)}, ${leftText(i.expiresAt, now)}` })),
    invitesOut: (me.invitesOut || []).map((i) => ({ ref: i.ref, title: i.code ? 'Invite code' : (i.name || 'Invite'),
      line: `${i.code ? 'Made' : 'Sent'} ${agoText(i.at, now)}, ${leftText(i.expiresAt, now)}` })),
    found: (me.found || []).map((f) => ({ username: f.username, agent: f.agent, line: `${f.agent ? `Played ${f.agent} on your team` : 'On your team'}, ${agoText(f.at, now)}` })),
    foundNote: me.discoverable ? (me.max ? 'Teammates who also use Occlara and turned on Discoverable. Invite one to a duo.'
      : 'Teammates who also use Occlara and turned on Discoverable. Ask one with Max to invite you.')
      : 'Turn on Discoverable on your Profile to see teammates who use Occlara, and be seen by them.',
    matches: (Array.isArray(matches) ? matches : []).map((m) => matchRow(m, now)),
    quota: me.quota ? `${bytesText(me.quota.up)} of your ${bytesText(me.quota.upMax)} uploaded in the last ${DUO.QUOTA_DAYS} days` : null,
    quotaFull: !!(me.quota && me.quota.up + DUO.CLIP_MAX_BYTES > me.quota.upMax),
  };
}

function headWords(h) {
  if (!h) return { agent: null, grade: null, letter: null };
  return { agent: h.agent, grade: h.grade ? String(h.grade.score) : null, letter: h.grade ? h.grade.letter : null };
}
function matchRow(m, now) {
  const head = m.mine || m.theirs || {};
  const score = m.mine && m.mine.score ? `${m.mine.score.us}-${m.mine.score.them}` : m.theirs && m.theirs.score ? `${m.theirs.score.them}-${m.theirs.score.us}` : null;
  const result = m.mine && m.mine.result ? m.mine.result : m.theirs && m.theirs.result ? ({ W: 'L', L: 'W', D: 'D' })[m.theirs.result] : null;
  return {
    ref: m.ref, partner: m.partner, map: head.map || null,
    title: [head.map || 'A match', score].filter(Boolean).join(', '),
    result: result === 'W' ? 'Win' : result === 'L' ? 'Loss' : result === 'D' ? 'Draw' : null,
    me: headWords(m.mine), them: headWords(m.theirs),
    when: `${agoText(m.playedAt, now)}, ${leftText(m.expiresAt, now)}`,
    clips: `${plural(m.myClips, 'clip')} of yours, ${plural(m.theirClips, 'clip')} of ${m.partner}'s`,
    paused: m.active !== true,
  };
}

/** One player's side of one round, as the table says it. */
function sideOf(r) {
  if (!r) return { none: true, line: 'Not on the sheet', chips: [], kills: [], death: null };
  const chips = [];
  if (r.fk) chips.push({ word: 'First kill', tone: 'good' });
  if (r.fd) chips.push({ word: 'First death', tone: 'bad' });
  if (r.died && r.traded === true) chips.push({ word: 'Traded', tone: null });
  if (r.died && r.traded === false) chips.push({ word: 'Not traded', tone: 'bad' });
  if (r.clutch) chips.push({ word: `Clutch 1v${r.clutch.vs}${r.clutch.won === true ? ', won' : r.clutch.won === false ? ', lost' : ''}`, tone: r.clutch.won ? 'good' : null });
  const kills = r.kills.length ? `${plural(r.kills.length, 'kill')} at ${r.kills.map(clockText).join(', ')}` : 'No kill';
  let death = 'Survived';
  if (r.died) {
    const parts = [`Died${r.sec !== null ? ` at ${clockText(r.sec)}` : ''}`];
    if (r.place) parts.push(`at ${r.place}`);
    if (r.killer) parts.push(`to ${r.killer}${r.weapon ? `, ${r.weapon}` : ''}`);
    death = parts.join(' ');
    if (r.alive) chips.push({ word: `${r.alive.mates + 1}v${r.alive.enemies} at the death`, tone: null });
  }
  return { none: false, line: death, kills: r.kills.slice(), death: r.died ? r.sec : null, killLine: kills, chips, died: r.died };
}

/**
 * The shared match view: both sheets round by round, a time axis per round
 * with both players' kills and deaths on it, the clips per round per side,
 * and the pins. `you` is the viewer's own username.
 */
function matchModel(m, o = {}) {
  if (!isObj(m)) return null;
  const now = o.now || Date.now();
  const mine = m.mine || null;
  const theirs = m.theirs || null;
  const head = mine || theirs || {};
  const by = (s) => new Map((s && Array.isArray(s.rounds) ? s.rounds : []).map((r) => [r.n, r]));
  const a = by(mine);
  const b = by(theirs);
  const ns = [...new Set([...a.keys(), ...b.keys()])].sort((x, y) => x - y);
  const clips = Array.isArray(m.clips) ? m.clips : [];
  const PRI = { death: 0, flag: 1, highlight: 2 };
  const pick = (n, own) => clips.filter((c) => c.round === n && c.mine === own).sort((x, y) => PRI[x.kind] - PRI[y.kind]);
  const pinsOf = (ref) => (Array.isArray(m.pins) ? m.pins : []).filter((p) => p.clip === ref)
    .map((p) => ({ ref: p.ref, at: p.at, mine: p.mine, word: PIN_WORDS[p.label] || 'Pin', reaction: p.reaction ? REACTION_WORDS[p.reaction] : null }));
  const rounds = ns.map((n) => {
    const x = a.get(n);
    const y = b.get(n);
    const sideWord = (x && x.side) || (y && y.side);
    const won = x && x.won !== null ? x.won : y && y.won !== null ? !y.won : null;
    const span = Math.max(100, ...[x, y].filter(Boolean).flatMap((r) => [...r.kills, r.sec || 0, r.plant && r.plant.sec ? r.plant.sec : 0]));
    const marks = [];
    for (const [who, r] of [['me', x], ['them', y]]) {
      if (!r) continue;
      for (const s of r.kills) marks.push({ who, kind: 'kill', sec: s, at: Math.min(1, s / span) });
      if (r.died && r.sec !== null) marks.push({ who, kind: 'death', sec: r.sec, at: Math.min(1, r.sec / span) });
    }
    const plant = (x && x.plant) || (y && y.plant) || null;
    const myClips = pick(n, true).map((c) => ({ ...c, pins: pinsOf(c.ref) }));
    const theirClips = pick(n, false).map((c) => ({ ...c, pins: pinsOf(c.ref) }));
    return {
      n, side: sideWord === 'atk' ? 'Attack' : sideWord === 'def' ? 'Defence' : null,
      result: won === true ? 'Won' : won === false ? 'Lost' : null,
      me: sideOf(x), them: sideOf(y),
      span, marks, plant: plant && plant.sec !== null ? { site: plant.site, at: Math.min(1, plant.sec / span), sec: plant.sec } : plant ? { site: plant.site, at: null, sec: null } : null,
      myClips, theirClips, watch: !!(myClips.length || theirClips.length),
      pins: theirClips.reduce((k, c) => k + c.pins.length, 0) + myClips.reduce((k, c) => k + c.pins.length, 0),
    };
  });
  const scoreOf = (s, flip) => (s && s.score ? (flip ? `${s.score.them}-${s.score.us}` : `${s.score.us}-${s.score.them}`) : null);
  const score = scoreOf(mine) || scoreOf(theirs, true);
  const g = (s) => (s && s.grade ? { score: String(s.grade.score), letter: s.grade.letter } : null);
  return {
    ref: m.ref, partner: m.partner,
    title: [head.map || 'A shared match', score].filter(Boolean).join(', '),
    sub: [mine && mine.agent ? `You as ${mine.agent}` : 'You', theirs && theirs.agent ? `${m.partner} as ${theirs.agent}` : m.partner].join(', ')
      + `, ${agoText(m.playedAt, now)}`,
    left: `Shared for ${DUO.KEEP_DAYS} days from the match, ${leftText(m.expiresAt, now)}.`,
    paused: m.active !== true,
    pausedLine: m.active !== true ? 'This duo is paused: neither of you has Max now. What was shared stays until it expires.' : null,
    mineMissing: !mine ? 'Your sheet of this match has not been shared yet.' : null,
    theirsMissing: !theirs ? `${m.partner} has not shared their side of this match yet. It shows here once their app uploads it.` : null,
    grades: { me: g(mine), them: g(theirs), meAgent: mine ? mine.agent : null, themAgent: theirs ? theirs.agent : null },
    lines: { me: mine && mine.line ? `${mine.line.k} / ${mine.line.d} / ${mine.line.a}` : null, them: theirs && theirs.line ? `${theirs.line.k} / ${theirs.line.d} / ${theirs.line.a}` : null },
    rounds,
    clipCount: clips.length,
  };
}

const PIN_CHOICES = PIN_LABELS.map((k) => ({ key: k, word: PIN_WORDS[k] }));
const REACTION_CHOICES = REACTIONS.map((k) => ({ key: k, word: REACTION_WORDS[k] }));

module.exports = {
  DUO, PIN_LABELS, PIN_WORDS, REACTIONS, REACTION_WORDS, CODE_ALPHABET, CLIP_NAME, CLIP_KINDS, CAUSE_KEYS, MODES,
  codeOf, codeShown, agentOf, mapOf, reportOf, sheetOf, clipsOf, deathMsOf, killMsOf,
  agoText, leftText, bytesText, clockText, inviteLine, stateWords, homeModel, matchModel, sideOf,
  SAID, WHAT, NEEDS_MAX, ASK_INVITE, NAMES_NOTE, PIN_CHOICES, REACTION_CHOICES,
};

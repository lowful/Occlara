'use strict';

/**
 * THE SAMPLE LIBRARY (8.7): the saved reviews the one window is booted with,
 * shared by check:mainwindow, which asserts the window on them, and
 * scripts/export-site-proof.js, which pictures the real pages on them for
 * the website. One fixture, so what the site shows is what the check holds.
 *
 * What it holds is built from the real Abyss match (valorant-match-abyss-
 * 13-11.json, replayed through the engine and reconciled with Riot's record
 * of it) and is plainly a sample: a Jett on Abyss, 13 : 11, a B of 71 as the
 * newest match, and three older ones graded 58, 61 and 64, so the grade rises
 * match on match and the newest is a best. The older three carry the coach's
 * look at rounds 2 and 6 (cause, what it saw, what was better, a clip named),
 * a clip kept on disk beside the second and gone from the third, so the
 * Moments page shows a cause, a repeated mistake across matches, a clip kept
 * and a clip gone. The newest is the built match untouched, so Home and the
 * review read as they always did. No Riot ID anywhere, so nothing is asked of the network, and
 * nothing that leaves the repo may call it anything but a sample match.
 *
 * Recording Off: check:mainwindow's step 5b records a match with the stand-in
 * reader below, and a check never records the desktop.
 */

const path = require('path');
const fs = require('fs');
const { EventEmitter } = require('events');
const Module = require('module');

const REPO = path.join(__dirname, '..', '..');
const { replay, load } = require('./replay-match');
const verify = require(path.join(REPO, 'src/shared/valorant-verify'));
const valorantReview = require(path.join(REPO, 'src/shared/valorant-review'));
const { ReviewStore, newId } = require(path.join(REPO, 'src/main/services/review-store'));
const gradeOf = require(path.join(REPO, 'src/shared/grade'));
const usage = require(path.join(REPO, 'src/shared/usage'));

/** What anything that leaves the repo calls this library. */
const SAMPLE_LABEL = 'Sample match';

/** The older matches' grades, newest first after the built one: rising, oldest to newest. */
const OLDER = [64, 61, 58];
const SEEDED = 1 + OLDER.length;

// THE COACH'S WORDS, standing in for the model's two lines on the sample
// match: a read of the match in three sentences, every number in it one the
// grade's own evidence shows, and the fix for next match.
const FOCUS = 'Enter second for a match: let a teammate or your utility take first contact, then trade.';
const SUMMARY = 'You carried the kills: 31 of them at 382 combat score a round, and the first kill of the round in 8 rounds. '
  + 'The deaths were the cost: 20 of your 21 went untraded, you were first to die in 4 rounds, and 6 times you died with the team ahead in numbers and the round was lost. '
  + 'Let a teammate take first contact and the kills stay while the deaths fall.';

// Both team comps (8.5.0) as a link keeps them, so the review's comps line is
// painted in the real window: a stand in, agents only, theirs the four the
// fixture's Riot record has killing the player and a fifth made up.
const COMPS = { us: [{ agent: 'Jett', role: 'Duelist' }, { agent: 'Killjoy', role: 'Sentinel' }, { agent: 'Omen', role: 'Controller' },
  { agent: 'Sova', role: 'Initiator' }, { agent: 'Breach', role: 'Initiator' }],
them: [{ agent: 'Skye', role: 'Initiator' }, { agent: 'Cypher', role: 'Sentinel' }, { agent: 'Viper', role: 'Controller' },
  { agent: 'Phoenix', role: 'Duelist' }, { agent: 'Killjoy', role: 'Sentinel' }] };

// AN ACCOUNT ON THIS PC (8.7), seeded: what the pages are handed, as the
// real account service's view hands it for a Free account with its free
// games used, every line written by the real usage.js. Only what a page is
// told is stood in for (view, referral); the service is the real one, so
// main still has no session and asks the network nothing. The referral is
// what GET /api/referral gives, finished as main finishes it.
const SEEDED_STATE = { tier: 'free', used: usage.FREE_GAMES, left: 0, free_total: usage.FREE_GAMES, bonus_pool: 0, bonus_earned: 0,
  email: 'player@example.com', account_key: 'GC-TEST-AB12-CD34-EF56', invites: { pending: 1, qualified: 1, refused: 0 } };
const SEEDED_VIEW = {
  signedIn: true, via: 'session', pending: false, waiting: false, email: SEEDED_STATE.email,
  tier: 'free', tierLabel: usage.tierLabel(SEEDED_STATE), gamesLeft: usage.gamesLeft(SEEDED_STATE),
  cap: usage.capState(SEEDED_STATE), capped: false, accountKey: SEEDED_STATE.account_key, invites: SEEDED_STATE.invites,
  // The Profile page's games (8.8), picked as the real view picks them.
  games: require(path.join(REPO, 'src/shared/profile')).gamesState(SEEDED_STATE),
  urls: { upgrade: usage.UPGRADE_URL, account: usage.ACCOUNT_URL, signup: usage.SIGNUP_URL },
};
const SEEDED_REF = { code: 'K7QM2XWP', link: 'https://occlara.app/invite/K7QM2XWP', invited: 2, qualified: 1, earned: 4,
  max_friends: usage.MAX_FRIENDS, max_games: usage.MAX_EARNED };
const SEEDED_REFERRAL = { ...SEEDED_REF, line: usage.inviteProgress(SEEDED_REF), how: usage.INVITE_HOW.slice() };
function seededAccounts(mod) {
  return { ...mod, createAccountService: (deps) => {
    const real = mod.createAccountService(deps);
    return { ...real, view: () => ({ ...SEEDED_VIEW }), referral: async () => ({ ...SEEDED_REFERRAL, how: SEEDED_REFERRAL.how.slice() }) };
  } };
}

// THE READER, a stand-in (as check:seal has it): what matchInProgress() reads
// and what the real one emits when its watch ends a match, nothing more: no
// capture, no model, no network. Every one made is kept in `readers`.
const readers = [];
class StandInValorant extends EventEmitter {
  constructor() {
    super();
    this.endWatch = { ended: false };
    this.ledger = { size: () => 0 };
    this.inLobby = true;
    readers.push(this);
  }
  start() { this.emit('status', 'coaching'); }
  stop() { this.emit('status', 'stopped'); }
  pause() {}
  resume() {}
}

/**
 * The stand-ins in place of the reader and the account service, asked for by
 * index.js alone. Compared without case: Windows paths can come back with the
 * drive letter in either. Call once, before index.js is required.
 */
let installed = false;
function installStandIns() {
  if (installed) return;
  installed = true;
  const INDEX = path.join(REPO, 'src', 'main', 'index.js');
  const same = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
  const realLoad = Module._load;
  Module._load = function patched(request, parent, isMain) {
    if (parent && parent.filename && same(parent.filename, INDEX) && request === './services/coaching-engine') return StandInValorant;
    if (parent && parent.filename && same(parent.filename, INDEX) && request === './services/account-service') return seededAccounts(realLoad(request, parent, isMain));
    return realLoad(request, parent, isMain);
  };
}

/**
 * The reviews, built from the real match.
 * @param opts.now  the newest match's time; the older ones an hour apart before it
 */
function build(opts) {
  const o = opts || {};
  const now = typeof o.now === 'number' ? o.now : Date.now();
  const played = replay(load('valorant-match-abyss-13-11.json').frames, 'standard');
  const { rounds } = verify.reconcile(played.rounds, load('riot-abyss-13-11.json'));
  const input = (rs) => ({ rounds: rs, context: { ...played.context, agent: 'Jett' }, endedBy: 'score', ai: { focus: FOCUS, summary: SUMMARY },
    role: 'Duelist', history: [], riotMe: { kills: 31, deaths: 21, assists: 4, score: 9168 }, comps: COMPS });
  // THE OLDER MATCHES WERE LOOKED AT (8.7, for the Moments page): the coach's
  // look at rounds 2 and 6 with a cause and a clip named, built from the same
  // match, so the Moments page shows a cause, a repeated mistake across the
  // matches, a kept clip (a stub file beside the newest of them, never played
  // here) and a clip gone.
  const LOOK = (r, clip) => (r.died && (r.n === 2 || r.n === 6)
    ? { ...r, forensics: { cause: 'isolated', what: 'You swung the angle alone.', better: 'Wait for a teammate before you swing.', source: 'riot', at: now, clip, clipDeath: 11000 } }
    : r);
  const built = valorantReview.build(input(rounds));
  const builtLooked = valorantReview.build(input(rounds.map((r) => LOOK(r, `r${r.n}-clip.mkv`))));
  return { now, played, rounds, built, builtLooked };
}

/**
 * A profile in `ud` with the four saved Valorant reviews, one clip on disk
 * beside the second match (a few bytes under a clip's name, enough for the
 * page to offer Play; the third says its clip is gone), and the config:
 * onboarding done, Recording Off, no Riot ID. Returns what the checks read.
 */
function seed(ud, opts) {
  fs.rmSync(ud, { recursive: true, force: true });
  fs.mkdirSync(ud, { recursive: true });
  fs.writeFileSync(path.join(ud, 'occlara-config.json'), JSON.stringify({
    game: 'valorant', onboardingCompleted: true, licenseKey: '', language: 'en', recordingMode: 'off',
    // The running version's What's new already offered: no update line on
    // Home in the pictures (check:mainwindow sets an older one to see it).
    changelogSeenVersion: require(path.join(__dirname, '..', '..', 'package.json')).version,
  }, null, 2));
  const b = build(opts);
  const store = new ReviewStore(path.join(ud, 'reviews'));
  // THE NEWEST IS A RECORD (8.7): the built match, then three older ones graded
  // lower, so the shots show what progress.js counts on the real pages, a best
  // (it needs three graded matches before it), the delta on the last match and
  // on the average. Lower, never higher, so the newest stays the grade and the
  // tallest bar the checks read.
  const ids = [];
  [null, ...OLDER].forEach((score, i) => {
    const at = b.now - i * 3600000;
    const id = newId('valorant', at);
    const base = score === null ? b.built : b.builtLooked;
    const g = score === null ? b.built.grade : { ...b.built.grade, score, letter: gradeOf.letter(score) };
    store.save({ id, game: 'valorant', at, review: { ...base, grade: g, id, at, kind: 'valorant' } });
    ids.push(id);
  });
  store.saveClip(ids[1], 'r2-clip.mkv', Buffer.alloc(64));
  return { ...b, ids, store, SEEDED, OLDER };
}

module.exports = {
  SAMPLE_LABEL, OLDER, SEEDED, FOCUS, SUMMARY, COMPS,
  SEEDED_STATE, SEEDED_VIEW, SEEDED_REF, SEEDED_REFERRAL, seededAccounts,
  StandInValorant, readers, installStandIns, build, seed, usage,
};

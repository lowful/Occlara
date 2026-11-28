'use strict';

/**
 * test:storage. DELETING A MATCH OR A CLIP, A CLIP'S FILE IN EXPLORER, AND
 * WHAT OCCLARA KEEPS ON THIS PC (9.1, the owner's item 18).
 *
 *   - services/storage-usage.js measures the clips (and their posters), the
 *     recordings, the frames (a review's and the AI log's) and the rest off a
 *     temp folder laid out as userData is, the total and the room left, and
 *     never walks into a link;
 *   - inside() lets Explorer open only a file inside the store's own folder;
 *   - review-store.js removeClip takes one clip and its poster and nothing
 *     else, and has() tells a review on disk; remove() (deleting a whole
 *     match) takes its file, folder (clips, posters, frames), row and year row
 *     and leaves every other review whole, and the cap and Clear clips still
 *     count right after;
 *   - index.js and the preloads, read as text: every one refused mid match or
 *     sealed, a page names an id and a clip name and never a path, Explorer is
 *     opened only on a clip of the store's own, the AI log's import folder goes
 *     with an imported match, the removal push names the review's own game.
 *
 * Pure node, a temp folder, no Electron.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { measure, inside, filesUnder } = require('../src/main/services/storage-usage');
const { ReviewStore } = require('../src/main/services/review-store');
const C = require('../src/shared/channels');

let checks = 0;
let fails = 0;
function ok(cond, msg, detail) {
  checks++;
  if (cond) console.log(`  ok  ${msg}`);
  else { fails++; console.log(`  FAIL ${msg}${detail !== undefined ? ` (${detail})` : ''}`); }
}
const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const write = (file, bytes) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, Buffer.alloc(bytes, 1)); };

(async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'occlara-storage-'));
  try {
    const reviews = path.join(base, 'reviews');
    const recording = path.join(base, 'recording');
    const aiLog = path.join(base, 'ai-log');
    const A = 'valorant-1790000000000-aaaa';
    const B = 'valorant-1790000100000-bbbb';
    const L = 'lol-1790000200000-cccc';
    const store = new ReviewStore(reviews);
    const at = (id) => Number(id.split('-')[1]);
    for (const id of [A, B, L]) store.save({ id, game: id.split('-')[0], at: at(id), review: { id, kind: id.startsWith('lol') ? 'lol' : 'valorant', game: { map: 'Bind' } }, frames: {} });
    write(path.join(reviews, A, 'r3-clip.mkv'), 3000);
    write(path.join(reviews, A, 'r3-poster.jpg'), 200);
    write(path.join(reviews, A, 'h5-clip.mkv'), 4000);
    write(path.join(reviews, A, 'death-r3.jpg'), 500);
    write(path.join(reviews, B, 'r1-clip.mkv'), 2000);
    write(path.join(reviews, B, 'death-r1.jpg'), 700);
    write(path.join(recording, 'rec-1', 'init.mkv'), 100);
    write(path.join(recording, 'rec-1', 'page-0001.mkv'), 9000);
    write(path.join(recording, 'rec-2', 'page-0001.mkv'), 1000);
    write(path.join(aiLog, 's1', 'frame-1.jpg'), 600);
    write(path.join(aiLog, 's1', 'log.jsonl'), 50);
    // A link out of the folder is never walked into.
    const outside = path.join(base, 'outside');
    write(path.join(outside, 'huge.bin'), 50000);
    let linked = false;
    try { fs.symlinkSync(outside, path.join(recording, 'link'), 'junction'); linked = true; } catch { /* no link here */ }

    const u = await measure({ reviews, recording, aiLog, freeBytes: () => 123456789, driveOf: () => 'C:' });
    ok(u.clips.count === 3 && u.clips.bytes === 9200 && u.clips.matches === 2, 'the clips: 3 kept over 2 matches, their posters counted with them', JSON.stringify(u.clips));
    ok(u.recordings.bytes === 10100 && u.recordings.count === 2, 'the recordings: every page of every recording folder', JSON.stringify(u.recordings));
    ok(u.frames.review === 1200 && u.frames.log === 600 && u.frames.bytes === 1800, "the frames: each review's own and the AI log's", JSON.stringify(u.frames));
    const json = (await filesUnder(reviews)).filter((f) => /\.json$/.test(f.name)).reduce((n, f) => n + f.bytes, 0);
    ok(u.other.bytes === json + 50 && u.total === u.clips.bytes + u.recordings.bytes + u.frames.bytes + u.other.bytes, 'the rest (the reviews, the log\'s text) and the total of all four', `${u.other.bytes} ${u.total}`);
    ok(u.free.bytes === 123456789 && u.free.drive === 'C:', 'and the room left on the drive');
    ok(!linked || u.recordings.bytes === 10100, 'a link in a folder is never walked into, so it never makes the folder look larger', linked ? 'linked' : 'no link made here');
    const none = await measure({ reviews: path.join(base, 'nothing'), recording: null, aiLog: null });
    ok(none.total === 0 && none.clips.count === 0 && none.free.bytes === null, 'with nothing kept it is all zero, and no room known says null');

    // inside(): Explorer only on a file of the store's own.
    ok(inside(reviews, path.join(reviews, A, 'r3-clip.mkv')) && !inside(reviews, reviews) && !inside(reviews, path.join(reviews, '..', 'x.mkv'))
      && !inside(reviews, path.join(base, 'reviews-evil', 'x.mkv')), "inside() is true only for a file under the store's own folder");

    // removeClip and has.
    ok(store.has(A) && !store.has('valorant-0-x') && !store.has('../etc'), 'has() tells a review on disk, and nothing that is not an id');
    ok(store.removeClip(A, 'r3-clip.mkv') === 3000 && !fs.existsSync(path.join(reviews, A, 'r3-clip.mkv')) && !fs.existsSync(path.join(reviews, A, 'r3-poster.jpg')),
      'removeClip takes the clip and its poster, and says what it freed');
    ok(fs.existsSync(path.join(reviews, A, 'h5-clip.mkv')) && fs.existsSync(path.join(reviews, A, 'death-r3.jpg')) && store.get(A),
      'and nothing else: the other clip, the frames and the review stay');
    ok(store.removeClip(A, 'r3-clip.mkv') === 0 && store.removeClip(A, '../B/r1-clip.mkv') === 0 && store.removeClip(A, 'notes.txt') === 0,
      'a clip already gone, a path, or a name that is no clip\'s takes nothing');
    // "CLIP DELETED", NOT "CLIP GONE" (9.1): the review is told the player
    // deleted that one clip, once, and every page names it so, before the
    // cap or Settings; a clip simply missing still reads gone.
    const savedA = store.get(A).review;
    ok(JSON.stringify(savedA.clipsDeleted) === '["r3-clip.mkv"]', 'the review keeps the name of the clip the player deleted, once', JSON.stringify(savedA.clipsDeleted));
    const moments = require('../src/shared/moments');
    const io = { url: (id, n) => `occlara-clip://review/${id}/${n}`, frames: () => null };
    const goneOf = (review, name) => moments.clipOf(name, null, new Set(), review, io, A).clipGone;
    ok(goneOf(savedA, 'r3-clip.mkv') === 'deleted' && moments.GONE.deleted === 'Clip deleted' && goneOf(savedA, 'r9-clip.mkv') === 'gone'
      && goneOf({ ...savedA, clipsCleared: { reason: 'space' } }, 'r3-clip.mkv') === 'deleted' && goneOf({ clipsCleared: { reason: 'space' } }, 'r3-clip.mkv') === 'space',
    'Clips reads "Clip deleted" for it, before the cap or Settings, and "Clip gone" only for one simply missing');
    const { presentClips } = require('../src/main/services/review-clips');
    const shownA = presentClips({ ...savedA, rounds: [{ n: 3, forensics: { clip: 'r3-clip.mkv' } }, { n: 9, forensics: { clip: 'r9-clip.mkv' } }] }, { has: () => false, url: () => 'u' });
    ok(shownA.rounds[0].forensics.clipGone === 'deleted' && !shownA.rounds[1].forensics.clipGone,
      'and the review page is told the same of that clip alone', JSON.stringify(shownA.rounds.map((c) => c.forensics.clipGone)));
    ok(read('src/renderer/review/review.js').includes("deleted: 'You deleted its clip.'"), 'the review says the player deleted it');

    // remove(): a whole match.
    ok(store.remove(A) && !store.get(A) && !fs.existsSync(path.join(reviews, A)) && !store.list().some((r) => r.id === A),
      'deleting a whole match takes its review, its folder (clips, posters, frames) and its row');
    ok(store.get(B) && fs.existsSync(path.join(reviews, B, 'r1-clip.mkv')) && store.list().length === 2, 'and every other review stays whole');
    const after = store.clipUsage();
    ok(after.clips === 1 && after.bytes === 2000, 'the clips counted after it are the ones left, so the cap and Clear clips stay right', JSON.stringify({ clips: after.clips, bytes: after.bytes }));
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }

  // ── The wiring, read as text ─────────────────────────────────────────────────
  {
    const idx = read('src/main/index.js');
    const fn = (name) => { const i = idx.indexOf(`  ${name}(`); return i < 0 ? '' : idx.slice(i, idx.indexOf('\n  },', i)); };
    for (const name of ['deleteMatch', 'deleteClip', 'revealClip', 'clearClips']) {
      ok(/if \(importBusy\(\)\) return \{ ok: false, error: 'match' \};/.test(fn(name)), `${name} is refused mid match or sealed`);
    }
    ok(/if \(importBusy\(\)\) return null;/.test(fn('async storage')), 'storage answers nothing mid match');
    // Clear clips (Settings, and the Clips preload has it too): refused mid
    // match or sealed as the other three are, before a clip is touched, and
    // Settings, told no, asks for the usage again rather than leaving its
    // button off.
    const cc = fn('clearClips');
    ok(cc.indexOf('importBusy()') > 0 && cc.indexOf('importBusy()') < cc.indexOf('reviewStore.clearClips('),
      'Clear clips is refused mid match or sealed, before a clip is touched');
    ok(/if \(u && u\.ok !== false\) paintClips\(u\);\s*else readClips\(\);/.test(read('src/renderer/settings/settings.js')),
      'and Settings, refused, asks for the usage again');
    ok(/showReview\(withFrames\(\(reviewStore\.get\(id\) \|\| e\)\.review\)\)/.test(fn('deleteClip')),
      'a delete repaints an open review from the review as saved now, which says the clip was deleted');
    ok(/workForId\(id\)/.test(fn('deleteMatch')) && /workForId\(id\)/.test(fn('deleteClip')), 'a review still being built is never deleted, nor its clips');
    ok(/aiLogStore\.removeImported\(aiLogRoot\(\), log\)/.test(fn('deleteMatch')) && /return out\.ok \? \{ ok: true \} : out;/.test(fn('importDelete')),
      'an imported match takes its AI log folder, and the import\'s own delete is the same path');
    ok(/storageUsage\.inside\(reviewStore\.root, file\)/.test(fn('revealClip')) && /reviewStore\.clipFile\(id, name\)/.test(fn('revealClip')) && /shell\.showItemInFolder\(file\)/.test(fn('revealClip')),
      "Explorer opens only on a clip of the store's own, by id and name, never a path a page names");
    ok(/const game = \(was && was\.game\)/.test(idx) && /registry\.broadcast\(C\.PUSH_REVIEWS, \{ id, game, removed: true \}\);/.test(idx), "the removal push names the review's own game");
    const ipc = read('src/main/ipc/register-ipc.js');
    ok(['MATCH_DELETE', 'CLIP_DELETE', 'CLIP_REVEAL', 'STORAGE_GET'].every((k) => ipc.includes(`safeHandle(C.${k}`)), 'all four are handled for our own pages only (safeHandle)');
    ok(C.MATCH_DELETE === 'reviews:delete' && C.CLIP_DELETE === 'clips:delete' && C.CLIP_REVEAL === 'clips:reveal' && C.STORAGE_GET === 'storage:get', 'the four channels');
    const mo = read('src/preload/moments-preload.js');
    ok(/deleteClip:/.test(mo) && /revealClip:/.test(mo) && /getStorage:/.test(mo) && /deleteMatch:/.test(read('src/preload/matches-preload.js')) && /deleteMatch:/.test(read('src/preload/review-preload.js')),
      'Clips can delete and reveal a clip and read the storage; Matches and the review can delete a match');
  }

  // THE MATCH RATING ON A LIBRARY ROW (9.1, item 16): Home and Matches read it off REVIEWS_LIST.
  {
    const { metaOf } = require('../src/main/services/review-store');
    const row = metaOf('valorant-1790000000000-aaaa', 'valorant', { rating: { version: 1, value: 8.34, rounds: 20, timeline: [] } }, 1);
    ok(row.rating && row.rating.value === 8.3 && row.rating.shown === '83', 'a row carries its match rating, shown on the 100 scale', JSON.stringify(row.rating));
    ok(metaOf('valorant-1790000000000-aaaa', 'valorant', {}, 1).rating === null && !('rating' in metaOf('lol-1790000000000-aaaa', 'lol', {}, 1)),
      'null for a Valorant match with none, no key for League');
    const idx = read('src/main/index.js');
    const fill = idx.slice(idx.indexOf('function fillRowRatings('), idx.indexOf('function fillRowRatings(') + 1500);
    ok(fill.includes('if (matchInProgress()) { setTimeout(step, 5000); return; }') && fill.includes('ratingOf.ratingOfReview(e.review)') && fill.includes('registry.sendTo(page, C.PUSH_REVIEWS, { ratings: true })'),
      'an older row is rated in the background, never mid match, from the same rating its page shows, and the pages told');
  }

  console.log(`\n${fails ? `FAIL: ${fails} of ${checks}` : `all ${checks} storage checks passed`}`);
  process.exit(fails ? 1 : 0);
})();

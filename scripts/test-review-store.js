'use strict';

/**
 * The library's index (src/main/services/review-store.js) is never trusted
 * over the reviews themselves.
 *
 * index.json is one small row per review, and every save and remove writes it
 * again from what it read. Read back as nothing (a file cut short by a power
 * cut, a scanner holding it for a moment), it used to come back as an empty
 * library: the next save wrote an index of one review over every other row,
 * a remove wrote none, and the clip cap and Clear clips, which took a folder
 * no row named for one no review owns, deleted every old review's folder
 * whole, its frames with its clips. Each <id>.json was still on disk and never
 * listed again.
 *
 * Plain fs on a temp folder.
 *
 * Run: npm run test:reviewstore
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { ReviewStore, newId } = require('../src/main/services/review-store');

let passed = 0;
let failed = 0;
function ok(cond, what, detail) {
  if (cond) { passed++; console.log(`ok    ${what}`); } else { failed++; console.log(`FAIL  ${what}${detail ? ` (${detail})` : ''}`); }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'occlara-reviewstore-'));
let seq = 0;
const fresh = () => { const d = path.join(tmp, `s${++seq}`); fs.mkdirSync(d, { recursive: true }); return d; };
const T0 = Date.UTC(2026, 9, 1, 18, 0, 0);
const review = (agent, score) => ({ game: { agent, map: 'Ascent', result: 'Win' }, grade: { score, letter: 'B' } });
const frame = Buffer.from('jpeg bytes').toString('base64');

/** Three reviews, each with a frame and a clip, as a library is after three matches. */
function library() {
  const dir = fresh();
  const store = new ReviewStore(dir);
  const ids = [];
  for (let i = 0; i < 3; i++) {
    const id = newId('valorant', T0 + i * 60000);
    store.save({ id, game: 'valorant', at: T0 + i * 60000, review: review(`Agent${i}`, 60 + i), frames: { 'r1-death.jpg': frame } });
    store.saveClip(id, 'r1-clip.mkv', Buffer.alloc(1000, 1));
    ids.push(id);
  }
  return { dir, store, ids, INDEX: path.join(dir, 'index.json') };
}

const CUT_SHORT = '[{"id":';

// 1. A save over an index cut short keeps every review listed.
{
  const { dir, store, ids, INDEX } = library();
  fs.writeFileSync(INDEX, CUT_SHORT);
  const id = newId('valorant', T0 + 10 * 60000);
  store.save({ id, game: 'valorant', at: T0 + 10 * 60000, review: review('Jett', 80) });
  const listed = store.list().map((r) => r.id);
  ok(listed.length === 4 && ids.every((x) => listed.includes(x)) && listed[0] === id,
    'a save over an index cut short lists all four reviews, newest first', `${listed.length} listed`);
  const row = store.list().find((r) => r.id === ids[1]);
  ok(row && row.title === 'Agent1' && row.grade && row.grade.score === 61 && row.at === T0 + 60000 && row.game === 'valorant',
    'and a row rebuilt from its review is the row save wrote', JSON.stringify(row));
  ok(Array.isArray(JSON.parse(fs.readFileSync(INDEX, 'utf8'))) && JSON.parse(fs.readFileSync(INDEX, 'utf8')).length === 4,
    'and the index written is whole again');
  // The cap after it clears clips only, oldest first, and no frame goes.
  const cleared = store.capClips(0);
  ok(cleared.length === 3 && ids.every((x) => fs.existsSync(path.join(dir, x, 'r1-death.jpg')) && !store.hasClip(x, 'r1-clip.mkv')),
    'and the clip cap after it clears the clips and keeps every frame', `${cleared.length} cleared`);
}

// 2. A remove over an unreadable index removes one review, not the library.
{
  const { store, ids, INDEX } = library();
  fs.writeFileSync(INDEX, '');
  store.remove(ids[0]);
  const listed = store.list().map((r) => r.id);
  ok(listed.length === 2 && listed.includes(ids[1]) && listed.includes(ids[2]) && !listed.includes(ids[0]),
    'a remove over an empty index file removes that review and lists the other two', `${listed.length} listed`);
}

// 3. The cap and Clear clips never take a review's folder for an unowned one,
// even while the index does not name it.
{
  const { dir, store, ids, INDEX } = library();
  fs.writeFileSync(INDEX, JSON.stringify([]));
  const u = store.clipUsage();
  ok(u.byReview.length === 3 && u.byReview.every((r) => r.owned),
    'a folder whose review is on disk is owned, listed in the index or not', JSON.stringify(u.byReview.map((r) => r.owned)));
  store.clearClips();
  ok(ids.every((x) => fs.existsSync(path.join(dir, x, 'r1-death.jpg')) && fs.existsSync(path.join(dir, `${x}.json`))),
    'and Clear clips then keeps every frame and every review');
  ok(ids.every((x) => (store.get(x) || { review: {} }).review.clipsCleared),
    'and each review is told its clips were cleared');
  // A folder no review owns still goes whole.
  const orphan = newId('valorant', T0 - 60000);
  store.saveClip(orphan, 'r1-clip.mkv', Buffer.alloc(10, 1));
  store.capClips(0);
  ok(!fs.existsSync(path.join(dir, orphan)), 'and a folder with no review at all still goes whole');
}

// 4. A review whose own file cannot be read at a rebuild is still listed, by its id.
{
  const { dir, store, ids, INDEX } = library();
  fs.writeFileSync(INDEX, CUT_SHORT);
  fs.writeFileSync(path.join(dir, `${ids[0]}.json`), '{"id":');
  const listed = store.list();
  const row = listed.find((r) => r.id === ids[0]);
  ok(listed.length === 3 && row && row.game === 'valorant' && row.at === T0,
    'a review unreadable at a rebuild is still listed, its game and time from its id', JSON.stringify(row));
}

// 5. An empty library is still empty, and a fresh one still saves.
{
  const dir = path.join(fresh(), 'reviews');
  const store = new ReviewStore(dir);
  ok(store.list().length === 0 && store.clipUsage().reviews === 0, 'a library with no folder lists nothing');
  const id = newId('lol', T0);
  store.save({ id, game: 'lol', at: T0, review: review(null, 50) });
  ok(store.list().length === 1 && store.list('lol')[0].id === id, 'and its first save lists one');
}

// 6. A whole index is read as it is: a row the index dropped on purpose
// (removed) is not brought back from a file a remove could not delete.
{
  const { dir, store, ids } = library();
  const left = path.join(dir, `${ids[0]}.json`);
  const kept = fs.readFileSync(left);
  store.remove(ids[0]);
  fs.writeFileSync(left, kept);
  ok(store.list().length === 2, 'a whole index is the list, never merged with the files beside it');
}

try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
console.log(failed ? `FAIL: ${failed} of ${passed + failed} review store checks failed` : `PASS: all ${passed} review store checks passed`);
process.exit(failed ? 1 : 0);

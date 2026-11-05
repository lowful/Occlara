'use strict';

/**
 * The Moments page's data (8.7, src/shared/moments.js) on the real Abyss
 * match and on made up reviews: every death with its title from the look's
 * cause or Riot's facts, when in the round it came and the repeated mistakes
 * it belongs to; every highlight Riot's record proves and none the screen
 * alone read; the clips by their URLs, gone with their reason, and the one
 * note on no clips; the compilation by pattern across matches, counting
 * deaths, matches and clips; a League review's deaths; and no dash anywhere.
 *
 * Run: npm run test:moments
 */

const fs = require('fs');
const path = require('path');
const { replay, load } = require('./fixtures/replay-match');
const verify = require('../src/shared/valorant-verify');
const valorantReview = require('../src/shared/valorant-review');
const patterns = require('../src/shared/patterns');
const moments = require('../src/shared/moments');
const { CAUSES } = require('../src/shared/death-causes');

let fails = 0;
let checks = 0;
const ok = (cond, what, detail) => {
  checks++;
  if (!cond) { fails++; console.log(`FAIL  ${what}${detail ? `\n        ${detail}` : ''}`); } else console.log(`ok    ${what}`);
};
// The two dashes the house rules ban, as escapes so this file carries neither.
const DASHES = new RegExp('[\\u2013\\u2014]');

// ── The real match ────────────────────────────────────────────────────────
const played = replay(load('valorant-match-abyss-13-11.json').frames, 'standard');
const { rounds } = verify.reconcile(played.rounds, load('riot-abyss-13-11.json'));
const built = valorantReview.build({ rounds, context: { ...played.context, agent: 'Jett' }, endedBy: 'score',
  ai: {}, role: 'Duelist', history: [], riotMe: { kills: 31, deaths: 21, assists: 4, score: 9168 } });
const T0 = Date.UTC(2026, 10, 1, 20);
const saved = (n, review) => Array.from({ length: n }, (_v, i) => ({
  id: `valorant-${T0 - i * 3600000}-mom${i}`, at: T0 - i * 3600000, game: 'valorant', review: { ...review, kind: 'valorant' },
}));
const url = (id, name) => `occlara-clip://review/${id}/${name}`;

{
  const three = saved(3, built);
  const b = moments.build('valorant', three, { patterns: patterns.summarise(three), clips: () => [], url, recordingMode: 'auto' });
  const deaths = rounds.filter((r) => r.died).length;
  ok(b.matches.length === 3 && b.counts.matches === 3, 'three saved matches, three entries, newest first', JSON.stringify(b.counts));
  ok(b.matches[0].at > b.matches[1].at && b.matches[0].id === three[0].id, 'newest first');
  ok(b.counts.deaths === deaths * 3, `every death of the match is an entry (${deaths} a match)`, `${b.counts.deaths}`);
  const m0 = b.matches[0];
  ok(m0.title === 'Jett' && m0.map === 'Abyss' && m0.result === 'Victory' && m0.score === '13-11' && m0.grade && typeof m0.grade.score === 'number',
    'the match line carries the agent, the map, the result, the score and the grade', JSON.stringify({ ...m0, moments: undefined }));
  const d = m0.moments.filter((x) => x.kind === 'death');
  const h = m0.moments.filter((x) => x.kind === 'highlight');
  ok(d.every((x) => /^Killed by [A-Z]/.test(x.title) || x.title === 'Died'), 'with no look, a death is titled by Riot\'s killer', d.map((x) => x.title).join(' | '));
  ok(d.some((x) => / with a /.test(x.title)), 'and the gun where Riot has it');
  ok(d.every((x) => x.time === null || /^\d+ s in$|^\d+:\d\d in$/.test(x.time)), 'its time is seconds into the round', d.map((x) => x.time).join(','));
  ok(d.every((x) => x.clip === null && x.clipGone === null), 'a death the coach never looked at has no clip and says nothing about one');
  const multi = rounds.filter((r) => typeof r.kills === 'number' && r.kills >= 2).map((r) => r.n);
  ok(multi.length >= 2 && h.filter((x) => x.what === 'multi').map((x) => x.round).join() === multi.join(),
    'every round of two kills or more (2K to 5K) is a highlight, and no other', `${multi.join()} vs ${h.map((x) => `${x.what}@${x.round}`).join()}`);
  ok(h.filter((x) => x.what === 'multi').every((x) => /^[2-4]K$/.test(x.title) && /kills at \d+ s/.test(x.line)),
    'titled by its kills, timed off Riot\'s kill feed', h.map((x) => `${x.title}: ${x.line}`).join(' | '));
  const streak = h.find((x) => x.what === 'streak');
  ok(streak && /^First kill \d rounds running$/.test(streak.title) && streak.rounds.length >= 2 && streak.round === streak.rounds[0],
    'the first kill in rounds running is one highlight on its first round', JSON.stringify(streak));
  ok(!h.some((x) => x.what === 'clutch'), 'no clutch Riot did not record as won');
  ok(m0.moments.every((x, i) => i === 0 || x.round >= m0.moments[i - 1].round), 'a match\'s moments are in round order');
  // The repeated mistakes: this review counts untraded, early, lost-advantage,
  // same-spot and same-killer, each with its rounds; across three copies every
  // one is a pattern, so every death in one of those rounds is marked.
  const keys = built.insights.mistakes.map((e) => e.key);
  ok(keys.includes('untraded') && keys.includes('same-spot'), 'the fixture counts the mistakes the marks rest on', keys.join());
  const untraded = built.insights.mistakes.find((e) => e.key === 'untraded');
  const marked = d.filter((x) => x.repeats.some((r) => r.key === 'untraded')).map((x) => x.round);
  ok(marked.join() === untraded.rounds.join(), 'a death is marked with each counted mistake whose rounds hold it', `${marked.join()} vs ${untraded.rounds.join()}`);
  ok(d.every((x) => x.repeats.every((r) => r.across === true && r.title)), 'and across matches, since every copy counts it');
  ok(b.compilation.length === keys.length && b.compilation[0].key === 'untraded'
    && b.compilation[0].deaths === untraded.rounds.length * 3 && b.compilation[0].matches === 3 && b.compilation[0].clips === 0,
    'the compilation groups every such death by its pattern, most deaths first', JSON.stringify(b.compilation.map((c) => [c.key, c.deaths, c.matches])));
  ok(b.compilation[0].line === `${untraded.rounds.length * 3} deaths over 3 matches` && b.compilation[0].title === untraded.title
    && b.compilation[0].items.length === b.compilation[0].deaths && b.compilation[0].items.every((k) => /^valorant-\d+-mom\d:r\d+$/.test(k)),
    'with its line and its items by key', b.compilation[0].line);
  ok(b.clipsNote === 'nolook' && /No clips yet/.test(b.clipsNoteText), 'with no look taken the note says clips come with the look', b.clipsNoteText);
  ok(b.enough === true, 'two recorded matches are enough for the patterns');
}

// ── A look, its clip, and the clip gone ───────────────────────────────────
{
  const look = (r, cause, extra) => (r.died ? { ...r, forensics: { cause, what: 'You swung the angle alone.', better: 'Wait for a teammate.', source: 'riot', at: T0, ...extra } } : r);
  const withLooks = rounds.map((r) => (r.n === 2 ? look(r, 'isolated', { clip: 'r2-clip.mkv', clipDeath: 11200 })
    : r.n === 6 ? look(r, 'isolated', { clip: 'r6-clip.mkv', clipDeath: 9800 })
      : r.n === 7 ? look(r, 'unclear', { clip: 'r7-clip.mkv' }) : r));
  const rv = valorantReview.build({ rounds: withLooks, context: { ...played.context, agent: 'Jett' }, endedBy: 'score',
    ai: {}, role: 'Duelist', history: [], riotMe: { kills: 31, deaths: 21, assists: 4, score: 9168 } });
  const two = saved(2, rv);
  const onDisk = { [two[0].id]: ['r2-clip.mkv', 'r7-clip.mkv'], [two[1].id]: [] };
  two[1].review = { ...two[1].review, clipsCleared: { reason: 'space', at: T0 } };
  const b = moments.build('valorant', two, { patterns: patterns.summarise(two), clips: (id) => onDisk[id] || [], url, recordingMode: 'auto' });
  const at = (m, n) => m.moments.find((x) => x.kind === 'death' && x.round === n);
  const r2 = at(b.matches[0], 2);
  ok(r2.title === CAUSES.isolated.one && r2.line === 'You swung the angle alone.' && r2.cause === 'isolated',
    'a death the coach looked at is titled by its cause, in the singular, with what the look saw', `${r2.title}: ${r2.line}`);
  ok(r2.clip && r2.clip.url === url(two[0].id, 'r2-clip.mkv') && r2.clip.death === 11200 && r2.clipGone === null,
    'its clip on disk is played by its URL, the death placed in it', JSON.stringify(r2.clip));
  const r6 = at(b.matches[0], 6);
  ok(!r6.clip && r6.clipGone === 'gone' && r6.clipGoneText === 'Clip gone', 'a clip named and not on disk, with no reason saved, is gone', JSON.stringify([r6.clipGone, r6.clipGoneText]));
  const r7 = at(b.matches[0], 7);
  ok(r7.cause === 'unclear' && /^Killed by/.test(r7.title) && r7.clip && r7.clip.death === null,
    'an unclear look keeps Riot\'s title and its clip, with no death marked', JSON.stringify([r7.title, r7.clip]));
  const old2 = at(b.matches[1], 2);
  ok(!old2.clip && old2.clipGone === 'space' && /cleared for space/.test(old2.clipGoneText),
    'a review told its clips were cleared for space says so on each', JSON.stringify([old2.clipGone, old2.clipGoneText]));
  ok(r2.repeats.some((r) => r.key === 'cause:isolated' && r.across) && r2.repeats.some((r) => r.key === 'untraded'),
    'a death is marked with the look\'s counted cause and the record\'s mistakes alike', JSON.stringify(r2.repeats));
  const iso = b.compilation.find((c) => c.key === 'cause:isolated');
  ok(iso && iso.judged && iso.deaths === 4 && iso.matches === 2 && iso.clips === 1 && iso.line === '4 deaths over 2 matches, 1 clip kept',
    'the compilation counts a cause across matches with its clips kept', JSON.stringify(iso));
  ok(b.counts.clips === 2 && b.clipsNote === null && b.clipsNoteText === null, 'with clips kept there is no note', JSON.stringify([b.counts, b.clipsNote]));

  // Nothing on disk, the reviews cleared: the note says why, once.
  const none = moments.build('valorant', two, { patterns: patterns.summarise(two), clips: () => [], url, recordingMode: 'auto' });
  ok(none.clipsNote === 'space' && /cleared to keep your clips under the space/.test(none.clipsNoteText), 'every clip cleared for space: the note says so', none.clipsNoteText);
  const off = moments.build('valorant', two, { patterns: patterns.summarise(two), clips: () => [], url, recordingMode: 'off' });
  ok(off.clipsNote === 'off' && /recording was off/.test(off.clipsNoteText), 'recording off: the note says to turn it on', off.clipsNoteText);
  ok(Object.values(moments.NOTES).concat(Object.values(moments.GONE)).every((t) => !DASHES.test(t)), 'no dash in any note');
}

// ── Riot's record alone, a clutch, an ace, and League ────────────────────
{
  const riotOnly = { ...built, kind: 'valorant', source: 'riot', insights: { facts: [] } };
  const one = [{ id: `valorant-${T0}-riot0`, at: T0, game: 'valorant', review: riotOnly }];
  const b = moments.build('valorant', one, { patterns: patterns.summarise(one), clips: () => [], url, recordingMode: 'auto' });
  ok(b.matches[0].moments.filter((x) => x.kind === 'death').every((x) => !x.repeats.length) && !b.compilation.length,
    'a match graded from Riot\'s record alone marks no repeated mistake');
  ok(b.enough === false, 'and one match is not enough for a pattern');

  const card = (n, riot, extra) => ({ n, side: 'Attack', sideKey: 'attacking', result: 'won', died: false, verified: true, watched: true, riot, ...extra });
  const madeUp = { kind: 'valorant', game: { agent: 'Reyna', map: 'Bind', mode: 'Competitive', result: 'Defeat', score: '9-13' },
    grade: { score: 74, letter: 'B', provisional: false }, insights: { mistakes: [], strengths: [], missed: [] },
    rounds: [
      card(1, { kills: 5, firstKill: true, clutch: null, feed: [{ ms: 10000, by: 'me', on: 'enemy' }, { ms: 20000, by: 'me', on: 'enemy' }] }),
      card(2, { kills: 2, firstKill: false, clutch: { vs: 2, won: true } }),
      card(3, { kills: 3, firstKill: true, clutch: { vs: 1, won: true } }),
      card(4, { kills: 1, firstKill: false, clutch: { vs: 3, won: false } }, { died: true, result: 'lost' }),
      { n: 5, result: 'lost', died: true, verified: false, watched: true, riot: null, spot: 'A Site' },
    ] };
  const two = [{ id: `valorant-${T0}-made0`, at: T0, game: 'valorant', review: madeUp }];
  const m = moments.build('valorant', two, { patterns: {}, clips: () => [], url, recordingMode: 'auto' }).matches[0].moments;
  const hl = m.filter((x) => x.kind === 'highlight');
  ok(hl.find((x) => x.round === 1 && x.what === 'ace' && x.title === '5K' && /an ace, all five of them, first kill of the round, kills at 10 s, 20 s/.test(x.line)),
    'five kills is an ace, its line the kills, the first kill and the kill times', JSON.stringify(hl.find((x) => x.round === 1)));
  ok(hl.find((x) => x.round === 2 && x.what === 'multi' && x.title === '2K' && /won it alone against 2/.test(x.line)), 'two kills and a clutch is a 2K highlight', JSON.stringify(hl.find((x) => x.round === 2)));
  ok(hl.find((x) => x.round === 3 && x.what === 'multi' && x.title === '3K' && /3 kills in the round, won it alone against one/.test(x.line)),
    'three kills and the clutch in one round is one entry', JSON.stringify(hl.find((x) => x.round === 3 && x.what === 'multi')));
  ok(!hl.some((x) => x.round === 4), 'a clutch lost and one kill is no highlight');
  ok(!hl.some((x) => x.what === 'streak'), 'first kills in rounds 1 and 3 are no streak');
  const d5 = m.find((x) => x.kind === 'death' && x.round === 5);
  ok(d5 && d5.title === 'Died' && d5.line === 'at A Site' && d5.time === null, 'a death Riot never verified is the screen\'s: where, and no time', JSON.stringify(d5));
  const d4 = m.find((x) => x.kind === 'death' && x.round === 4);
  ok(d4 && d4.lost === true && d4.title === 'Died', 'a verified death with no killer named is Died', JSON.stringify(d4));

  const lol = { kind: 'lol', game: { champion: 'Ahri', mode: "Summoner's Rift" }, grade: { score: 66, letter: 'C' },
    deathList: [{ n: 1, atSec: 212, at: '3:32', fact: 'No ally died within 10 seconds of it.', clip: 'd1-clip.mkv', clipDeath: 11000 },
      { n: 2, atSec: 700, at: '11:40', fact: 'An ally had died in the 10 seconds before it.' }] };
  const lolSaved = [{ id: `lol-${T0}-lol0`, at: T0, game: 'lol', review: lol }];
  const lb = moments.build('lol', lolSaved, { patterns: {}, clips: () => ['d1-clip.mkv'], url, recordingMode: 'auto' });
  const ld = lb.matches[0].moments;
  ok(lb.matches[0].title === 'Ahri' && ld.length === 2 && ld.every((x) => x.kind === 'death'),
    'a League game lists its deaths by the death list, under its champion', JSON.stringify(ld));
  ok(ld[0].title === 'Death 1' && ld[0].time === 'at 3:32' && ld[0].clip && ld[0].clip.url === url(lolSaved[0].id, 'd1-clip.mkv') && ld[0].clip.death === 11000,
    'with its clock and its clip', JSON.stringify(ld[0]));
  ok(ld[1].clip === null && ld[1].clipGone === null, 'a League death with no clip named says nothing of one');
  ok(lb.counts.highlights === 0, 'and no highlight: the record proves none');
}

// ── Nothing saved, and the words ──────────────────────────────────────────
{
  const b = moments.build('valorant', [], { patterns: {}, clips: () => [], url, recordingMode: 'auto' });
  ok(b.matches.length === 0 && b.compilation.length === 0 && b.clipsNote === null && b.counts.deaths === 0, 'an empty library is an empty page with no note');
  ok(moments.secText(42) === '42 s in' && moments.secText(95) === '1:35 in' && moments.secText(null) === null, 'the time reads seconds into the round, minutes past sixty');
  ok(moments.roundsText([3]) === 'round 3' && moments.roundsText([3, 4]) === 'rounds 3 and 4' && moments.roundsText([3, 4, 5]) === 'rounds 3, 4 and 5', 'rounds are listed in words');
  const files = ['src/shared/moments.js', 'src/renderer/moments/index.html', 'src/renderer/moments/moments.js', 'src/renderer/moments/moments.css', 'src/preload/moments-preload.js']
    .map((f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8'));
  ok(files.every((s) => !DASHES.test(s)), 'no dash in the module, the page, its script, its stylesheet or its preload');
  ok(DASHES.test('a \u2014 b') && DASHES.test('a \u2013 b') && !DASHES.test('a - b'), 'the dash detector matches both dashes and not a hyphen');
}

console.log(fails ? `\n${fails} of ${checks} moments checks FAILED` : `\nall ${checks} moments checks passed`);
process.exit(fails ? 1 : 0);

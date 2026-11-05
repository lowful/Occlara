'use strict';

/**
 * Ask Coach shows the player's own clips, offline:
 *
 *   server/services/chat-clips.js    the marker taken out, held to the match's rounds, placed
 *   server/services/chat-prompt.js   normalise keeps the rounds, the prompt says them, parseReply asks
 *   src/main/services/ask-coach.js   the rounds sent, the answer's clips played from this PC alone
 *   src/renderer/chat/               a clip under its paragraph, click to play, none mid match
 *
 * A marker is a round number the context said has a clip, never a path or a
 * URL; one of another round, a path, a URL, a round of another match or a
 * clip gone shows nothing; a reply with no clip is the plain text it was.
 *
 * Run: npm run test:chatclips
 */

const fs = require('fs');
const path = require('path');
const clips = require('../server/services/chat-clips');
const cp = require('../server/services/chat-prompt');
const chatContext = require('../src/shared/chat-context');
const { AskCoach, clipsFor } = require('../src/main/services/ask-coach');
const { metaOf } = require('../src/main/services/review-store');
const insights = require('../src/shared/insights');
const valorantReview = require('../src/shared/valorant-review');
const C = require('../src/shared/channels');
const { loadSurface, settle } = require('./fixtures/fake-dom');

let fails = 0;
const ok = (cond, what, detail) => {
  if (!cond) { fails++; console.log(`FAIL  ${what}${detail ? `\n        ${detail}` : ''}`); }
  else console.log(`ok    ${what}`);
};
const NOW = Date.UTC(2026, 10, 4, 20, 0);
const DASHES = new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`);

/** A small review: five rounds, the player died in 2 and 4. */
function small(id, at, map) {
  const cards = [1, 2, 3, 4, 5].map((n) => ({ n, side: n <= 4 ? 'Attack' : 'Defence', sideKey: n <= 4 ? 'attacking' : 'defending',
    result: n % 2 ? 'won' : 'lost', died: n % 2 === 0, verified: false, watched: true, facts: [], reads: [] }));
  return { kind: 'valorant', source: 'watched', id, at, game: { map, agent: 'Jett', mode: 'Swiftplay', result: 'Victory', score: '5-3' },
    rounds: cards, verified: false, insights: { mistakes: [], strengths: [], missed: [] }, grade: null, patterns: [] };
}
const url = (id, n) => `occlara-clip://review/${id}/r${n}-clip.mkv`;

(async () => {
  // ── The marker ───────────────────────────────────────────────────────────
  console.log('\nthe marker:');
  {
    const ok1 = clips.TOKEN.exec('r5');
    ok(ok1 && ok1[1] === '5', 'THE TOKEN READS r5 (a new regex, asserted on a known string)');
    ok(clips.TOKEN.test('round 12') && clips.TOKEN.test('7') && !clips.TOKEN.test('C:\\clips\\r5-clip.mkv') && !clips.TOKEN.test('occlara-clip://review/x/r5-clip.mkv'),
      'and round 12 and 7, never a path or a URL');
    clips.MARKER.lastIndex = 0;
    ok(clips.MARKER.test('the end. [clip:r5]'), 'THE MARKER IS FOUND (asserted on a known string)');
    clips.MARKER.lastIndex = 0;
    const x = clips.extract('Round 5 went wrong here. [clip:r5]\n\nRound 2 too. [clip:r2] [clip:r9] [clip:C:\\Users\\me\\r2-clip.mkv] [clip:occlara-clip://review/other/r4-clip.mkv]', [2, 5]);
    ok(!/\[|clip:/i.test(x.text), 'EVERY MARKER LEAVES THE TEXT, well formed or not, a path and a URL too', x.text);
    ok(JSON.stringify(x.marks.map((m) => m.round)) === JSON.stringify([5, 2, null, null, null]),
      'only a round the context listed survives as an ask: an unknown round, a path and a URL do not', JSON.stringify(x.marks));
    const asks = clips.asksOf(x, cp.cleanReply);
    ok(JSON.stringify(asks) === JSON.stringify([{ round: 5, para: 0 }, { round: 2, para: 1 }]), 'each ask goes with the paragraph it was written in', JSON.stringify(asks));
    const own = clips.asksOf(clips.extract('Round 4 first.\n[clip:r4]\nThen something else.', [4]), cp.cleanReply);
    ok(own.length === 1 && own[0].para === 0, 'a marker on its own line goes with the paragraph before it', JSON.stringify(own));
    const many = clips.asksOf(clips.extract('a [clip:r1] b [clip:r2] c [clip:r2] d [clip:r3] e [clip:r4]', [1, 2, 3, 4]), cp.cleanReply);
    ok(many.length === 3 && JSON.stringify(many.map((a) => a.round)) === '[1,2,3]', 'THREE AT MOST, one a round, in the order written', JSON.stringify(many));
    const think = clips.extract('<think>maybe [clip:r2]</think>Round 4. [clip:r4]', [2, 4]);
    ok(think.marks.length === 1 && think.marks[0].round === 4, 'a marker in the model\'s thinking is no ask');
    ok(clips.extract('Plain text.', [2]).text === 'Plain text.' && !clips.extract('Plain text.', [2]).marks.length, 'a reply with no marker is its text');
    ok(JSON.stringify(clips.roundsOf([2, 2, 0, 41, 'x', 3.5, 4])) === '[2,4]', 'the rounds a context may list: whole, 1 to 40, each once');
  }

  // ── Placing it in the reply as sent ──────────────────────────────────────
  console.log('\nplaced:');
  {
    const asks = [{ round: 5, para: 0, of: 2, kept: ['Round 5 went wrong here.'] }, { round: 2, para: 1, of: 2, kept: ['Round 2 too.'] }];
    ok(JSON.stringify(clips.place('Round 5 went wrong here.\n\nRound 2 too.', asks)) === JSON.stringify([{ round: 5, para: 0 }, { round: 2, para: 1 }]), 'under the paragraphs that kept their words');
    ok(JSON.stringify(clips.place('Round 2 too.', asks)) === JSON.stringify([{ round: 2, para: 0 }]),
      'A CLIP WHOSE PARAGRAPH WENT GOES WITH IT, and the next moves with its words');
    ok(!clips.place('', asks).length && !clips.place('Text.', null).length, 'nothing to place on, nothing placed');
    ok(!clips.place('Round 5.\n\nRound 2.', [{ round: 99, para: 0, of: 2, kept: ['Round 5.'] }]).length, 'a round outside 1 to 40 is no clip');
  }

  // ── The prompt and the gates ─────────────────────────────────────────────
  console.log('\nthe prompt and the gates:');
  const rv = small('valorant-1790000000002-frac01', NOW - 60000, 'Fracture');
  const other = small('valorant-1790000000001-split1', NOW - 120000, 'Split');
  {
    const ctx = chatContext.build(valorantReview.served(rv), { rows: [] }, null, 'Walk me through round 2', { game: 'valorant', language: 'en', now: NOW });
    const plain = cp.normalise(ctx);
    ok(Array.isArray(plain.match.clips) && !plain.match.clips.length, 'a context with no clips lists none');
    const before = cp.buildPrompt(plain, [{ role: 'user', content: 'Walk me through round 2' }]);
    ok(!/CLIPS|\[clip:/.test(before), 'AND ITS PROMPT SAYS NOTHING OF CLIPS (a match without one is told as before)');
    const withClips = cp.normalise({ ...ctx, match: { ...ctx.match, clips: [4, 2, 3, 9, '../x', 2] } });
    ok(JSON.stringify(withClips.match.clips) === '[2,4]', 'NORMALISE KEEPS ONLY DEATHS OF THIS MATCH: round 3 was survived, 9 is no round, a path is no number', JSON.stringify(withClips.match.clips));
    const prompt = cp.buildPrompt(withClips, [{ role: 'user', content: 'Walk me through round 2' }]);
    ok(/CLIPS\nThe player has a recorded clip of their death in rounds 2 and 4\./.test(prompt) && /\[clip:r2\]/.test(prompt) && /At most 3 clips/.test(prompt),
      'THE PROMPT SAYS WHICH ROUNDS HAVE A CLIP and how to attach one', (prompt.match(/CLIPS[\s\S]{0,400}/) || [''])[0]);
    ok(!DASHES.test((prompt.match(/CLIPS\n[^\n]*/) || ['x'])[0]), 'and no dash in it');
    const raw = 'In round 2 you died on attack. [clip:r2]\n\nIn round 4 you died on attack too. [clip:r4] [clip:r3] [clip:../../secret]';
    const out = cp.parseReply(raw, withClips, { messages: [{ role: 'user', content: 'Walk me through round 2' }] });
    ok(!/\[|clip/i.test(out.reply), 'THE GATES NEVER SEE A MARKER, and the reply carries none', out.reply);
    ok(out.reply.split('\n\n').length === 2 && out.clipAsks.map((a) => a.round).join(',') === '2,4',
      'the asks are the listed rounds whose paragraphs were kept', `${JSON.stringify(out.clipAsks)} ${JSON.stringify(out.reply)}`);
    // A paragraph the gates drop whole takes its clip with it.
    const gone = cp.parseReply('In round 2 you died on attack. [clip:r2]\n\nIn round 4 you died on attack too.\n\nIn round 19 you died on defence. [clip:r4]', withClips, { messages: [] });
    ok(!/round 19/.test(gone.reply) && JSON.stringify(gone.clipAsks.map((a) => a.round)) === '[2]',
      'A CLIP WHOSE PARAGRAPH THE GATES DROPPED IS NO ASK (round 19 is no round of the match)', `${JSON.stringify(gone.clipAsks)} ${JSON.stringify(gone.reply)}`);
    const placed = clips.place(out.reply, out.clipAsks);
    ok(placed.every((p) => [2, 4].includes(p.round)) && placed.length === out.clipAsks.length, 'and they are placed in the reply as kept', JSON.stringify(placed));
    const none = cp.parseReply(raw, plain, { messages: [] });
    ok(!none.clipAsks.length && !/\[clip/.test(none.reply), 'A CONTEXT WITH NO CLIPS: every marker stripped, nothing asked');
    const noMarks = cp.parseReply('In round 2 you died on attack.\n\nIn round 4 you died on attack too.', withClips, { messages: [] });
    const noMarksPlain = cp.parseReply('In round 2 you died on attack.\n\nIn round 4 you died on attack too.', plain, { messages: [] });
    ok(!noMarks.clipAsks.length && noMarks.reply === noMarksPlain.reply, 'a reply with no marker is gated and kept as it always was');
  }

  // ── Main's half ──────────────────────────────────────────────────────────
  console.log('\nmain\'s half:');
  {
    const have = [{ round: 2, url: url(rv.id, 2), death: 11000, frames: null }, { round: 4, url: url(rv.id, 4), death: 9000, frames: { times: [0, 33], end: 15000 } }];
    const reply = 'One.\n\nTwo.';
    ok(JSON.stringify(clipsFor([{ round: 2, para: 0 }, { round: 4, para: 1 }], have, reply).map((c) => [c.round, c.para, c.url]))
      === JSON.stringify([[2, 0, url(rv.id, 2)], [4, 1, url(rv.id, 4)]]), 'EACH ROUND IS PLAYED FROM THIS REVIEW\'S OWN CLIP');
    ok(!clipsFor([{ round: 3, para: 0 }], have, reply).length, 'A ROUND WITH NO CLIP ON THIS PC SHOWS NOTHING (gone, or of another match)');
    ok(!clipsFor([{ round: 2, para: 5 }], have, reply).length && !clipsFor([{ round: 2, para: -1 }], have, reply).length, 'a paragraph the reply does not have, nothing');
    const inj = clipsFor([{ round: 2, para: 0, url: 'file:///C:/Windows/x.mkv' }], have, reply);
    ok(inj.length === 1 && inj[0].url === url(rv.id, 2), 'A URL IN THE ANSWER IS NEVER READ: the clip is this PC\'s own');
    ok(!clipsFor([{ round: 2, para: 0 }], [{ round: 2, url: 'file:///C:/x.mkv' }], reply).length, 'and a clip not served by occlara-clip is no clip');
    ok(clipsFor([1, 2, 3, 4].map((n) => ({ round: n, para: 0 })), [1, 2, 3, 4].map((n) => ({ round: n, url: url(rv.id, n) })), reply).length === 3, 'three at most');

    // The question, end to end on fakes.
    const entries = new Map([[rv.id, { id: rv.id, game: 'valorant', at: rv.at, review: rv }], [other.id, { id: other.id, game: 'valorant', at: other.at, review: other }]]);
    const rows = () => [...entries.values()].map((e) => metaOf(e.id, e.game, e.review, e.at)).sort((a, b) => b.at - a.at);
    const calls = [];
    let answer = { reply: 'Round 2 first.\n\nThen round 4.', clips: [{ round: 2, para: 0 }, { round: 4, para: 1 }, { round: 5, para: 1 }] };
    let inMatch = false;
    const clipStore = { [rv.id]: have, [other.id]: [{ round: 5, url: url(other.id, 5) }] };
    const coach = new AskCoach({
      store: { get: (k) => ({ licenseKey: 'TEST-KEY' })[k] },
      api: { get: async () => ({ ok: true, status: 200, data: { error: 'no' } }), post: async (p, body) => { calls.push(body); return { ok: true, status: 200, data: answer }; } },
      reviews: { list: (g) => rows().filter((r) => !g || r.game === g), get: (id) => entries.get(id) || null,
        recent: (g, n) => rows().filter((r) => r.game === g).slice(0, n).map((r) => entries.get(r.id)), saveFilled: () => {} },
      present: (r) => valorantReview.served(r), matchInProgress: () => inMatch, game: () => 'valorant',
      clips: (id) => clipStore[id] || [],
      patterns: () => ({}), breakdown: () => ({ rows: {} }), tracker: async () => null, recentMatches: async () => [],
      countable: (r) => insights.countable(r), playbookMode: () => 'on', connectedRiotId: () => null, busy: () => false,
      lastHenrikAt: () => 0, language: () => 'en', advanced: () => false, failureText: (s) => `failed ${s}`, lastShownKind: () => null,
      now: () => NOW, sleep: async () => {}, log: () => {},
    });
    const res = await coach.chat([{ role: 'user', content: 'Walk me through round 2' }], { reviewId: rv.id });
    ok(JSON.stringify(calls[0].context.match.clips) === '[2,4]', 'THE CONTEXT TELLS THE ROUNDS WITH A CLIP, by number alone', JSON.stringify(calls[0].context.match.clips));
    ok(!JSON.stringify(calls[0]).includes('occlara-clip') && !JSON.stringify(calls[0]).includes('.mkv'), 'and no URL, path or file name leaves the PC');
    ok(res.ok && res.clips && res.clips.map((c) => c.round).join(',') === '2,4', 'THE ANSWER\'S CLIPS ARE THIS MATCH\'S: round 5 is another match\'s clip and shows nothing', JSON.stringify(res.clips));
    answer = { reply: "I couldn't give you an answer.", honest: true, clips: [{ round: 2, para: 0 }] };
    const honest = await coach.chat([{ role: 'user', content: 'Walk me through round 2' }], { reviewId: rv.id });
    ok(honest.ok && !honest.clips, 'the honest line carries no clip');
    answer = { reply: 'A reply.' };
    const old = await coach.chat([{ role: 'user', content: 'Walk me through round 2' }], { reviewId: rv.id });
    ok(old.ok && !('clips' in old), 'A SERVER THAT SENDS NO CLIPS: the answer is as it was');
    inMatch = true;
    calls.length = 0;
    const mid = await coach.chat([{ role: 'user', content: 'Walk me through round 2' }], { reviewId: rv.id });
    ok(!mid.ok && mid.kind === 'mid-match' && !calls.length, 'NOTHING MID MATCH: refused before any request, so no clip either');
    inMatch = false;
    const lol = new AskCoach({ d: null, clips: () => [{ round: 1, url: url('x', 1) }] });
    ok(!lol.clipsOf({ id: 'lol-1', game: 'lol' }).length, 'League has no round clips here');
  }

  // ── The page ─────────────────────────────────────────────────────────────
  console.log('\nthe page:');
  {
    const LIST = [{ id: rv.id, map: 'Fracture', agent: 'Jett', mode: 'Swiftplay', result: 'Victory', score: '5-3', day: '4 Nov', at: 2 }];
    const open = async (reply) => {
      const ch = loadSurface('chat', {
        handlers: {
          [C.CONFIG_GET]: () => ({ language: 'en', game: 'valorant' }),
          [C.CHAT_MATCHES]: () => ({ game: 'valorant', list: LIST, chosen: { id: LIST[0].id, how: 'newest' }, current: LIST[0], starters: { walk: 2, agent: 'Jett', map: 'Fracture', riotOnly: false, lol: false } }),
          [C.CHAT_SEND]: () => reply,
        },
        window: { HTMLMediaElement: function () {} },
      });
      await settle(12);
      ch.document.querySelectorAll('#starters .starter')[0].click();
      await settle(10);
      return ch;
    };
    const page = await open({ ok: true, reply: 'Round 2 first.\n\nThen round 4.', match: LIST[0],
      clips: [{ round: 2, para: 0, url: url(rv.id, 2), death: 11000, frames: null }, { round: 4, para: 1, url: url(rv.id, 4), death: null, frames: null }] });
    const bubble = page.document.querySelectorAll('.msg.coach')[0];
    const kids = bubble ? bubble.children.map((k) => k.className) : [];
    ok(JSON.stringify(kids) === JSON.stringify(['msg-para', 'chat-clip', 'msg-para', 'chat-clip']), 'EACH CLIP UNDER ITS PARAGRAPH', kids.join(' | '));
    ok(bubble && bubble.children[0].textContent === 'Round 2 first.', 'every paragraph set as text');
    ok(!page.document.querySelectorAll('video').length, 'NOTHING LOADS BEFORE A CLICK: no video until the player asks');
    const caps = page.document.querySelectorAll('.chat-clip-open').map((b) => b.textContent);
    ok(JSON.stringify(caps) === JSON.stringify(['Watch round 2', 'Watch round 4']), 'each capsule names its round', JSON.stringify(caps));
    page.document.querySelectorAll('.chat-clip-open')[0].click();
    const v = page.document.querySelectorAll('video')[0];
    ok(v && v.getAttribute('src') === url(rv.id, 2) && v.getAttribute('preload') === 'none', 'A CLICK OPENS THE REVIEW\'S OWN PLAYER on this round\'s clip');
    ok(page.document.querySelectorAll('.cp-rate').map((b) => b.textContent).join(',') === '1x,0.5x,0.25x', 'with 1x and 0.5x');
    ok(page.document.querySelector('.chat-clip-cap').textContent === 'Your death in round 2', 'and a line naming it');
    const plain = await open({ ok: true, reply: 'First paragraph.\n\nSecond paragraph.', match: LIST[0] });
    const pb = plain.document.querySelectorAll('.msg.coach')[0];
    ok(pb && pb.textContent === 'First paragraph.\n\nSecond paragraph.' && !pb.children.length, 'NO CLIP LEAVES PLAIN TEXT, one pre-line bubble as before');
    const bad = await open({ ok: true, reply: 'One.', match: LIST[0], clips: [{ round: 2, para: 0, url: 'file:///C:/x.mkv' }, { round: 3, para: 0, url: 'https://x.test/a.mkv' }] });
    const bb = bad.document.querySelectorAll('.msg.coach')[0];
    ok(bb && bb.textContent === 'One.' && !bad.document.querySelectorAll('.chat-clip').length, 'a clip not served by occlara-clip is never drawn');
    const honest = await open({ ok: true, honest: true, reply: 'x', match: LIST[0], clips: [{ round: 2, para: 0, url: url(rv.id, 2) }] });
    ok(!honest.document.querySelectorAll('.chat-clip').length, 'the honest line draws no clip');
    const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'chat', 'index.html'), 'utf8');
    const csp = (/content="([^"]*)"/.exec(html) || [])[1] || '';
    ok(/(^|;)\s*media-src 'self' occlara-clip:;/.test(csp) && /default-src 'self'/.test(csp), 'the page may play media from itself and occlara-clip, and nothing else', csp);
    const js = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'chat', 'chat.js'), 'utf8');
    ok(!/autoplay/i.test(js.replace(/Never autoplay/g, '')) && !DASHES.test(js), 'NEVER AUTOPLAY, and no dash in the page');
  }

  console.log(fails ? `\n${fails} failed` : '\nall passed');
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });

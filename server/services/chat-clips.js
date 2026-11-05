'use strict';

/**
 * ASK COACH SHOWS THE CLIP: the player's own clip of a death, under the
 * paragraph of the answer that talks about it.
 *
 * The client tells the model which rounds of the match have a clip kept on
 * the PC (chat-context's `match.clips`, round numbers and nothing else), and
 * the prompt lets the model attach one to a paragraph by writing a marker,
 * [clip:r5], at its end (chat-prompt.js renderClips). The model never names a
 * path or a URL and is never told one: a marker is a ROUND NUMBER, and it is
 * only ever a round this request said has a clip.
 *
 *   EVERY MARKER LEAVES THE TEXT before a gate reads it (extract): "r5" is
 *   no word of the answer, and a round the gates read in it would be a round
 *   no sentence named. Well formed or not, of a round with a clip or not, a
 *   path or a URL in one ([clip:C:\...], [clip:occlara-clip://...]): every
 *   one goes, and only a round in the list survives as an ask.
 *   THREE AT MOST, one a round, in the order written (MAX_CLIPS).
 *   A CLIP GOES WITH ITS PARAGRAPH. It is kept only where a sentence of the
 *   paragraph it was written in survives the gates and the route's own
 *   passes (place): a clip under words that could not be shown would show
 *   the player a round nothing on screen talks about.
 *
 * The answer carries { round, para } alone, para the paragraph of the reply
 * as sent (split on blank lines). The client plays the clip it holds for that
 * round of the match it asked about, or shows nothing (ask-coach.js
 * clipsFor): a round from another match, or one whose clip is gone, has no
 * file to play there.
 *
 * No require from src/: check:server forbids it.
 */

const MAX_CLIPS = 3;
// Any bracketed clip marker, well formed or not: every one is taken out.
const MARKER = /\[\s*clips?\s*[:=]?\s*([^\]\n]{0,160})\]/gi;
// What a marker may name: a round, as r5, round 5 or 5.
const TOKEN = /^(?:r|round\s*)?#?\s*(\d{1,2})$/i;
// What cleanReply strips before it reads paragraphs, stripped first here so a
// marker inside a model's thinking is never an ask.
const THINK = /<think>[\s\S]*?<\/think>/gi;
const FENCE = /```[\s\S]*?```/g;

/** The rounds a context said have a clip: whole numbers 1 to 40, each once. */
function roundsOf(list) {
  return [...new Set((Array.isArray(list) ? list : []).filter((n) => Number.isInteger(n) && n >= 1 && n <= 40))];
}

/**
 * The reply with every marker taken out, and where each stood.
 * @returns { text, marks: [{ round (null when it names no round in `allowed`), pos }] }
 */
function extract(raw, allowed) {
  const ok = new Set(roundsOf(allowed));
  const src = String(raw == null ? '' : raw).replace(/\r\n?/g, '\n').replace(THINK, ' ').replace(FENCE, ' ');
  const marks = [];
  let text = '';
  let last = 0;
  MARKER.lastIndex = 0;
  for (let m = MARKER.exec(src); m; m = MARKER.exec(src)) {
    text += src.slice(last, m.index);
    last = m.index + m[0].length;
    const t = TOKEN.exec(String(m[1] || '').trim());
    const round = t ? Number(t[1]) : null;
    marks.push({ round: round !== null && ok.has(round) ? round : null, pos: text.length });
  }
  text += src.slice(last);
  return { text, marks };
}

/**
 * The asks, three at most and one a round, each with the paragraph it was
 * written in: the last paragraph of the text before it, as `paragraphs`
 * (chat-prompt.js cleanReply) reads paragraphs, so a marker on its own line
 * after a paragraph goes with that paragraph.
 * @returns [{ round, para }]
 */
function asksOf(extracted, paragraphs) {
  const x = extracted || { text: '', marks: [] };
  const read = typeof paragraphs === 'function' ? paragraphs : (t) => String(t).split(/\n\s*\n/).filter((p) => p.trim());
  const out = [];
  const seen = new Set();
  for (const m of x.marks || []) {
    if (m.round === null || seen.has(m.round)) continue;
    seen.add(m.round);
    out.push({ round: m.round, para: Math.max(0, read(x.text.slice(0, m.pos)).length - 1) });
    if (out.length >= MAX_CLIPS) break;
  }
  return out;
}

/** A sentence or a paragraph as words alone, for finding one in the other. */
const flat = (s) => String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9\u00c0-\u024f]+/g, ' ').trim();

/**
 * Where each ask goes in the reply as it is sent: the paragraph holding a
 * sentence the ask's own paragraph kept, else, when the route's passes left
 * every paragraph standing, the same paragraph by its place. Else none.
 *
 * @param reply  the reply as sent, paragraphs on blank lines
 * @param asks   [{ round, para, kept: [sentence], of: paragraphs parseReply kept }]
 * @returns [{ round, para }]
 */
function place(reply, asks) {
  const paras = String(reply || '').split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  if (!paras.length) return [];
  const flats = paras.map(flat);
  const out = [];
  const seen = new Set();
  for (const a of Array.isArray(asks) ? asks : []) {
    if (!a || !Number.isInteger(a.round) || a.round < 1 || a.round > 40 || seen.has(a.round)) continue;
    let at = -1;
    for (const s of Array.isArray(a.kept) ? a.kept : []) {
      const f = flat(s);
      if (f.length < 8) continue;
      at = flats.findIndex((p) => p.includes(f));
      if (at >= 0) break;
    }
    if (at < 0 && Number.isInteger(a.para) && a.of === paras.length && a.para >= 0 && a.para < paras.length) at = a.para;
    if (at < 0) continue;
    seen.add(a.round);
    out.push({ round: a.round, para: at });
    if (out.length >= MAX_CLIPS) break;
  }
  return out;
}

module.exports = { extract, asksOf, place, roundsOf, MAX_CLIPS, MARKER, TOKEN };

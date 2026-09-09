'use strict';

/**
 * Glyphs for the things a tip talks about.
 *
 * A tip is read in about a second and a half, over a moving game frame, usually
 * mid fight. Marking the parts a player is actually looking for, the callout,
 * the direction, the agent, lets the sentence be scanned instead of read.
 *
 * TWO RULES, both inherited from decisions already made in this repo:
 *
 * 1. THE CARD IS THE TIP. addTip() had a coloured dot and a source label above
 *    every line of advice, and they were removed because they were furniture in
 *    front of the one sentence that mattered. A glyph earns its place only by
 *    marking information the player is hunting for. Nothing decorative goes in
 *    here, and the source dot does not come back through this door.
 *
 * 2. The tip TEXT is never changed. This decorates what the coach said, it does
 *    not rewrite it, so the AI contract and the STATE feedback loop are
 *    untouched. Shortening the tips themselves is a separate, riskier step.
 *
 * Glyphs are inline <svg> built in the DOM, never <img>, so the renderer CSP
 * (`img-src 'self' data:`) is never involved and they inherit currentColor.
 *
 * Loaded as a plain script by each surface, the same way shared/i18n-apply.js
 * is, so it needs no preload and no Node access. It also exports through
 * module.exports so the tokenizer can be tested offline in Node, which is the
 * whole reason tokenize() is kept free of any DOM.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.tipVisuals = api;
}(typeof window !== 'undefined' ? window : globalThis, function () {

  // ── The vocabulary ────────────────────────────────────────────────────────

  // Mirrors Object.keys(valorant-data.generated.json .mapCallouts). Renderers
  // cannot require the generated file, so it is repeated here and
  // test:tipvisuals asserts the two lists are identical. That check exists
  // because a silently stale copy is exactly how this kind of duplication rots.
  const CALLOUTS = [
    'arcade', 'bath', 'boba', 'boiler', 'cannon', 'canteen', 'catwalk', 'crane',
    'dish', 'dugout', 'flowers', 'garage', 'gravel', 'hookah', 'kitchen', 'lamps',
    'library', 'mail', 'market', 'mound', 'nest', 'pizza', 'pyramids', 'rubble',
    'sewer', 'showers', 'snowman', 'teleporter', 'tree', 'tube', 'tunnel', 'vent',
    'waterfall', 'wine',
  ];

  // Mirrors Object.keys(... .agents), asserted by the same test.
  const AGENTS = [
    'Gekko', 'Fade', 'Breach', 'Deadlock', 'Tejo', 'Raze', 'Chamber', 'KAY/O',
    'Skye', 'Cypher', 'Sova', 'Miks', 'Killjoy', 'Harbor', 'Vyse', 'Viper',
    'Phoenix', 'Veto', 'Astra', 'Brimstone', 'Iso', 'Clove', 'Neon', 'Yoru',
    'Waylay', 'Sage', 'Reyna', 'Omen', 'Jett',
  ];

  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // ── The patterns ──────────────────────────────────────────────────────────
  //
  // THE ARTICLE TRAP. A case-insensitive match on a bare "a" matches the A site
  // AND every article in English. That mistake has broken three separate rules
  // in this repo, one of them inside a checker written to catch it. So a site is
  // only ever matched as an uppercase letter FOLLOWED BY a site noun: "A Main"
  // and "B site" match, "take a fight" and "hold a long angle" cannot.
  //
  // Agents are matched case SENSITIVELY for the same family of reason. Their
  // names include Breach, Chamber, Harbor, Sage, Fade, Neon and Iso, all
  // ordinary English words, and "breach the site" must not light up an agent.
  const PATTERNS = [
    { kind: 'site', re: /\b[ABC] ?([Ss]ite|[Mm]ain|[Ll]ong|[Ss]hort|[Ll]ink|[Ll]obby|[Hh]eaven|[Hh]ell|[Rr]after|[Ee]lbow)s?\b/g },
    // "mid" the lane, not "mid round" or "midair".
    { kind: 'site', re: /\bmid\b(?! ?(round|game|air|fight))/gi },
    { kind: 'callout', re: new RegExp('\\b(' + CALLOUTS.map(esc).join('|') + ')\\b', 'gi') },
    { kind: 'rotate', re: /\brotat(?:e|es|ed|ing|ion)\b/gi },
    { kind: 'push', re: /\b(?:push|exec|entry|take space|take map)\b/gi },
    { kind: 'fallback', re: /\b(?:fall back|back off|retreat|disengage|reset)\b/gi },
    { kind: 'flank', re: /\b(?:flank|lurk|off ?angle)\w*\b/gi },
    { kind: 'agent', re: new RegExp('\\b(?:' + AGENTS.map(esc).join('|') + ')\\b', 'g') },
  ];

  // What a player is actually hunting for in a tip, most wanted first. Used to
  // decide which marks survive the cap: WHERE and WHO beat WHAT TO DO, because
  // the place and the agent are the parts you glance for, while the verb is
  // read in the sentence anyway.
  const KIND_PRIORITY = ['site', 'callout', 'agent', 'rotate', 'push', 'fallback', 'flank'];

  /**
   * Split a tip into plain text and marked terms.
   *
   * Pure and DOM free so it can be tested in Node. Earlier matches win on
   * overlap, so the order of PATTERNS is the precedence order: a site beats a
   * callout, which beats a direction.
   *
   * `opts.max` caps how many terms get marked. Uncapped, a single tip came back
   * with five bold runs in one sentence, which is not emphasis, it is noise:
   * when everything is marked nothing is. The cap keeps the highest priority
   * kinds and, within a kind, the earliest ones.
   */
  function tokenize(text, opts) {
    const src = String(text || '');
    if (!src) return [];
    const max = opts && Number.isFinite(opts.max) ? opts.max : Infinity;

    const hits = [];
    for (const { kind, re } of PATTERNS) {
      re.lastIndex = 0;   // shared regex objects are stateful with /g
      let m;
      while ((m = re.exec(src)) !== null) {
        if (m[0].length) hits.push({ kind, start: m.index, end: m.index + m[0].length });
        if (re.lastIndex === m.index) re.lastIndex++;   // never spin on an empty match
      }
    }

    hits.sort((a, b) => a.start - b.start || b.end - a.end);

    // Drop overlaps FIRST, so the cap counts marks that would really be drawn.
    const kept = [];
    let scan = 0;
    for (const h of hits) {
      if (h.start < scan) continue;
      kept.push(h);
      scan = h.end;
    }

    // Then cap by priority, and put what survives back in reading order.
    let chosen = kept;
    if (kept.length > max) {
      chosen = kept
        .map((h, i) => ({ h, i, rank: KIND_PRIORITY.indexOf(h.kind) }))
        .sort((a, b) => (a.rank - b.rank) || (a.i - b.i))
        .slice(0, max)
        .sort((a, b) => a.i - b.i)
        .map((x) => x.h);
    }

    const out = [];
    let at = 0;
    for (const h of chosen) {
      if (h.start < at) continue;                              // overlapped, already covered
      if (h.start > at) out.push({ type: 'text', value: src.slice(at, h.start) });
      out.push({ type: 'mark', kind: h.kind, value: src.slice(h.start, h.end) });
      at = h.end;
    }
    if (at < src.length) out.push({ type: 'text', value: src.slice(at) });
    return out;
  }

  // ── Drawing ───────────────────────────────────────────────────────────────

  const NS = 'http://www.w3.org/2000/svg';

  // 24x24 stroke icons, matching the shape language already used for the close
  // buttons across the app.
  const PATHS = {
    // topics
    spike:       ['M12 3v10', 'M8 13h8l-1 8H9z'],
    utility:     ['M12 4l7 4v8l-7 4-7-4V8z'],
    aim:         ['M12 3v4', 'M12 17v4', 'M3 12h4', 'M17 12h4', 'M12 9.5a2.5 2.5 0 100 5 2.5 2.5 0 100-5'],
    peeking:     ['M3 12s3.5-6 9-6 9 6 9 6-3.5 6-9 6-9-6-9-6z', 'M12 10a2 2 0 100 4 2 2 0 100-4'],
    positioning: ['M4 20V9l8-5 8 5v11', 'M9 20v-6h6v6'],
    rotation:    ['M20 12a8 8 0 11-2.3-5.6', 'M20 4v4h-4'],
    teamwork:    ['M8 11a3 3 0 100-6 3 3 0 100 6', 'M2 20a6 6 0 0112 0', 'M17 11a3 3 0 100-6', 'M16 15a6 6 0 016 5'],
    economy:     ['M12 3v18', 'M16 7H10a2.5 2.5 0 000 5h4a2.5 2.5 0 010 5H8'],
    mental:      ['M12 20s-7-4.5-7-9.5A4.5 4.5 0 0112 7a4.5 4.5 0 017 3.5c0 5-7 9.5-7 9.5z'],
    death:       ['M12 3a7 7 0 00-7 7v4h14v-4a7 7 0 00-7-7z', 'M9 18h6', 'M9.5 11v1', 'M14.5 11v1'],
    general:     ['M12 21a9 9 0 100-18 9 9 0 100 18', 'M12 8v5', 'M12 16v.5'],
    // Marvel Rivals roles. A glyph plus the hero's NAME, never a portrait:
    // shipping Marvel or NetEase character art inside a paid product is a
    // trademark problem rather than a styling choice, which is the same reason
    // the Rivals palette was drawn to evoke rather than reproduce. A shield, a
    // blade and a cross carry the role, and the name carries the identity.
    vanguard:    ['M12 3l8 3v6c0 4.4-3.2 7.9-8 9-4.8-1.1-8-4.6-8-9V6z'],
    duelist:     ['M4 20l7-7', 'M14 4h6v6', 'M20 4l-9 9', 'M4 15l5 5'],
    strategist:  ['M12 5v14', 'M5 12h14'],

    // inline marks. `rotate` is the mark kind and `rotation` is the topic name,
    // and they need separate entries even though they draw the same arrow: the
    // test caught this missing the moment it was written.
    rotate:      ['M20 12a8 8 0 11-2.3-5.6', 'M20 4v4h-4'],
    site:        ['M12 21s7-6.4 7-11a7 7 0 10-14 0c0 4.6 7 11 7 11z', 'M12 8a2.5 2.5 0 100 5 2.5 2.5 0 100-5'],
    callout:     ['M12 21s7-6.4 7-11a7 7 0 10-14 0c0 4.6 7 11 7 11z', 'M12 8a2.5 2.5 0 100 5 2.5 2.5 0 100-5'],
    push:        ['M4 12h15', 'M13 6l6 6-6 6'],
    fallback:    ['M20 12H5', 'M11 6l-6 6 6 6'],
    flank:       ['M6 18L18 6', 'M10 6h8v8'],
    agent:       ['M12 12a4 4 0 100-8 4 4 0 100 8', 'M4 21a8 8 0 0116 0'],
  };

  // Size comes from the --icon-* tokens in CSS, not from a number passed in
  // here. Three different call sites had picked 12, 13 and 15px by hand, which
  // is how an interface ends up looking slightly wrong with nothing obviously
  // broken. The attribute is only a pre-CSS fallback.
  function glyph(kind) {
    const paths = PATHS[kind];
    if (!paths) return null;
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '12');
    svg.setAttribute('height', '12');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    for (const d of paths) {
      const p = document.createElementNS(NS, 'path');
      p.setAttribute('d', d);
      svg.appendChild(p);
    }
    return svg;
  }

  /** The leading category icon, from the topic main already computed. */
  function topicGlyph(topic) {
    return glyph(PATHS[topic] ? topic : 'general');
  }

  /**
   * Fill `el` with the decorated tip.
   *
   * Replaces textContent, which is what every surface does today, so a caller
   * swaps one line for one line. Text still goes in through .textContent, never
   * innerHTML: a tip is model output and is never trusted as markup.
   */
  /**
   * Killed BY this agent, said in the sentence being rendered.
   *
   * Only the forms the coach actually writes, and only when the agent name is
   * what follows: "you died to a Sova", "killed by Jett", "traded by a Reyna".
   * A death review is the one place a tip names an opponent unambiguously.
   */
  const KILLED_BY = /\b(?:died|dying|killed|traded|dropped)\s+(?:to|by)\s+(?:an?\s+)?$/i;

  /**
   * Which side an agent named in a tip is on, or null when it cannot be known.
   *
   * Null is the common answer and it is the right one. See the note at the
   * call site for why guessing is worse than leaving a name uncoloured.
   */
  function agentSide(name, text, opts) {
    const o = opts || {};

    // The player's own agent. The engine will not coach until it has confirmed
    // this, so it is as solid a fact as the app holds.
    if (o.agent && String(o.agent).toLowerCase() === String(name).toLowerCase()) return 'ally';

    // Named as the cause of the player's death, by this sentence.
    const at = String(text).toLowerCase().indexOf(String(name).toLowerCase());
    if (at > 0 && KILLED_BY.test(String(text).slice(0, at))) return 'enemy';

    return null;
  }

  /**
   * Is this agent name the PERSON, or is it describing a thing they own?
   *
   * "You died to Sage" names a person. "You died to a Sage wall" names a wall.
   * The difference is invisible in the text and glaring once the name becomes a
   * portrait: the second one rendered as "you died to a [picture of Sage] wall",
   * which reads as though the player was killed by a photograph.
   *
   * The test is what FOLLOWS the name. A possession is followed by the noun it
   * owns; a person is followed by anything else, so PERSON_FOLLOWER lists the
   * words a possessed noun can never be: verbs, prepositions, conjunctions. No
   * ability noun in this game appears in it, which is what makes "a Sage wall is
   * up" safe: what follows "Sage" there is "wall", not "is".
   *
   * Deliberately a closed list rather than "any lowercase word". The two ways to
   * be wrong are not equal: a missing follower costs one portrait, while a
   * missing ability noun renders "you died to a [face] wall", which is the
   * defect this exists to prevent. So an unrecognised follower means NOT a
   * person and the name stays a word, the same answer this module gives
   * everywhere else it cannot prove something.
   */
  const PERSON_FOLLOWER = [
    // verbs and auxiliaries
    'is', 'was', 'are', 'were', 'has', 'had', 'will', 'can', 'could', 'would',
    'should', 'might', 'may', 'just', 'already', 'still', 'never', 'always',
    'holding', 'pushing', 'playing', 'watching', 'sitting', 'lurking', 'hiding',
    'rotating', 'peeking', 'waiting', 'coming', 'entering', 'swinging',
    'flanking', 'took', 'takes', 'got', 'gets', 'went', 'goes', 'killed',
    'caught', 'traded', 'picked', 'pushed', 'flashed', 'held', 'saw', 'sees',
    // prepositions
    'to', 'on', 'in', 'at', 'from', 'with', 'without', 'into', 'onto', 'near',
    'behind', 'under', 'over', 'through', 'across', 'around', 'by', 'for',
    'after', 'before', 'while', 'since', 'off', 'up',
    // conjunctions and relatives
    'and', 'or', 'so', 'but', 'because', 'if', 'when', 'where', 'who', 'that',
    'which', 'then', 'they', 'their', 'her', 'his', 'it',
  ];
  const AGENT_AS_PERSON = new RegExp(
    '^(?:\\s*[.,;:!?)]|$|\\s+(?:' + PERSON_FOLLOWER.join('|') + ')\\b)'
  );

  /** True when the name at `at` is the agent themselves, not "a Sage wall". */
  function isAgentAsPerson(text, at, name) {
    return AGENT_AS_PERSON.test(String(text).slice(at + String(name).length));
  }

  /** An agent name as a filename. Must match agentSlug() in sync-valorant-data.js. */
  function agentSlug(name) {
    return String(name || '').replace(/[^A-Za-z0-9]/g, '');
  }

  /**
   * The agent's kill feed portrait, or null when it is not shipped.
   *
   * Null is a real answer and the caller falls back to the word, which is why a
   * failed icon in the sync script is not fatal. Every surface that loads this
   * module sits two directories under src/renderer, so the path back to assets
   * is the same from all of them.
   */
  function agentIcon(name) {
    const slug = agentSlug(name);
    if (!slug) return null;
    const img = document.createElement('img');
    img.className = 'tv-agent-img';
    img.alt = '';                       // the span already carries the label
    img.decoding = 'async';
    // THE SQUARE BUST, not the kill feed crop beside it. The crop is 2:1, and
    // forcing a 2:1 face into a square mark cropped most of the face away and
    // squashed what was left. assets/agents/bust/ is the same art Riot ships at
    // 1024 square, resampled to 64 by scripts/sync-agent-busts.js.
    img.src = '../../../assets/agents/bust/' + slug + '.png';
    // A missing file must not leave an empty box in the middle of a sentence.
    // Guarded because this module also runs against the offline test's stub DOM,
    // which has no event plumbing and does not need any.
    if (typeof img.addEventListener !== 'function') return img;
    img.addEventListener('error', () => {
      const span = img.parentNode;
      if (!span) return;
      span.classList.remove('tv-agent-icon');
      span.replaceChildren(document.createTextNode(name));
      const g = glyph('agent');
      if (g) span.appendChild(g);
    });
    return img;
  }

  function render(el, text, opts) {
    if (!el) return;
    el.textContent = '';
    const o = opts || {};

    if (o.topic) {
      const lead = topicGlyph(o.topic);
      if (lead) {
        lead.setAttribute('class', 'tv-topic');
        el.appendChild(lead);
      }
    }

    // Three marks is the ceiling. Past that the emphasis stops meaning anything
    // and the card just looks busy over a moving game frame.
    const MAX_MARKS = 3;
    // Where this token starts in the original string. tokenize() covers the
    // text exactly once and in order, so summing the values walked so far is
    // the real offset, which is what decides whether an agent is a person.
    let at = 0;
    for (const tok of tokenize(text, { max: o.max || MAX_MARKS })) {
      const start = at;
      at += tok.value.length;
      if (tok.type === 'text') {
        el.appendChild(document.createTextNode(tok.value));
        continue;
      }
      const mark = document.createElement('span');
      mark.className = 'tv-mark tv-' + tok.kind;

      /*
       * Whose agent this is, when the app actually knows.
       *
       * Deliberately narrow. There is no team composition anywhere in this
       * app: matchContext.teammates is declared and never assigned, and the
       * stored match stats are career aggregates with no roster in them. So
       * rather than guess a side from where a name sits in a sentence, only
       * two cases are coloured, and both are things the app can state:
       *
       *   the player's own agent, which the engine confirms before it will
       *   coach at all;
       *
       *   an agent this very sentence names as having killed the player,
       *   which the sentence itself asserts. If that is wrong the tip was
       *   already wrong, so the colour adds no error of its own.
       *
       * Everything else stays a plain word. A green teammate that is actually
       * on the other team is worse than no colour, because it would be trusted.
       */
      const side = tok.kind === 'agent' ? agentSide(tok.value, text, o) : null;
      if (side) mark.classList.add('tv-' + side);

      /*
       * AN AGENT BECOMES ITS PORTRAIT, but only when both halves are true.
       *
       * The name has to be the PERSON. "You died to a Sage wall" is a sentence
       * about a wall, and swapping the name for a face there produced "you died
       * to a [face] wall", which is not something anyone can read.
       *
       * The side has to be PROVEN. A portrait with no colour was the third
       * state, and it was the weakest thing on the card: it looked like the
       * other two with the meaning filed off, and a player reasonably read grey
       * as a team rather than as an admission. There is no honest colour for an
       * agent whose side is unknown, so there is no portrait either, and the
       * name stays a word exactly as it was written. Nothing is guessed; the
       * uncertainty just stops being drawn as if it were information.
       *
       * The NAME IS NOT LOST either way: on the portrait it moves to the title
       * and the aria-label, which keeps the promise that a tip reads back whole.
       */
      if (side && isAgentAsPerson(text, start, tok.value)) {
        const img = agentIcon(tok.value);
        if (img) {
          mark.classList.add('tv-agent-icon');
          mark.title = tok.value;
          mark.setAttribute('aria-label', tok.value);
          mark.appendChild(img);
          el.appendChild(mark);
          continue;
        }
      }

      mark.appendChild(document.createTextNode(tok.value));
      const g = glyph(tok.kind);
      if (g) mark.appendChild(g);
      el.appendChild(mark);
    }
  }

  // PATHS is exported so the offline test can assert every topic and every
  // mark kind actually has an icon. glyph() itself needs a DOM, but a missing
  // path table is the failure that would really happen.
  /**
   * A Marvel Rivals hero, drawn as a role glyph plus the name.
   *
   * Exposed separately from the Valorant lexicon because the two games share no
   * vocabulary: a Rivals hero is supplied by the engine, which already knows
   * who is on screen, rather than matched out of the tip text.
   */
  function heroMark(name, role) {
    const el = document.createElement('span');
    el.className = 'tv-mark tv-hero';
    const g = glyph(String(role || '').toLowerCase());
    if (g) el.appendChild(g);
    el.appendChild(document.createTextNode(name));
    return el;
  }

  return { tokenize, render, glyph, topicGlyph, heroMark, CALLOUTS, AGENTS, PATTERNS, PATHS };
}));

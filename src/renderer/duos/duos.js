'use strict';

/*
 * OCCLARA DUOS (docs/claude/duos.md): the duos, the invites, the teammates
 * found, the shared matches, and one shared match with its two clips a round
 * on one clock.
 *
 * Every line is main's (src/shared/duos.js through the preload): this page
 * counts nothing, sets every string as text, and plays clips only from
 * occlara-clip://. Main answers null mid match or sealed, when the seal hides
 * this page, so nothing here is on screen, playing or loading during a match.
 */

const $ = (id) => document.getElementById(id);
const api = window.occlara || {};
const W = api.words || { said: {}, pins: [], reactions: [] };
const T = window.DuoTime;
const FRAME_MS = 1000 / 30;

let home = null;          // the last home model
let current = null;       // the shared match on screen
let stage = null;         // the round on the stage: { round, sides, pinLabel, pinReaction }
let ask = 0;

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined && text !== null) e.textContent = String(text);
  return e;
}
function button(cls, text, fn, label) {
  const b = el('button', cls, text);
  b.type = 'button';
  if (label) b.setAttribute('aria-label', label);
  if (fn) b.addEventListener('click', fn);
  return b;
}
const assetUrl = (rel) => (typeof rel === 'string' && /^valorant\/(agents|maps)\/[A-Za-z0-9]+\.(png|jpg)$/.test(rel) ? `../../../assets/${rel}` : null);
function picture(rel, alt, cls) {
  const src = assetUrl(rel);
  if (!src) return null;
  const img = document.createElement('img');
  img.src = src;
  img.alt = alt || '';
  img.className = cls;
  img.addEventListener('error', () => img.remove());
  return img;
}
const face = (agent, cls) => picture(agent && typeof api.agentArt === 'function' ? api.agentArt(agent) : null, '', cls || 'pl-face')
  || el('span', `${cls || 'pl-face'} none`);
const mapPic = (map) => picture(map && typeof api.mapArt === 'function' ? api.mapArt(map) : null, '', 'pv-map-img') || el('span', 'pv-map-img du-none');
const call = (fn, ...a) => (typeof api[fn] === 'function' ? Promise.resolve(api[fn](...a)).catch(() => null) : Promise.resolve(null));

// ── The page's one problem line ────────────────────────────────────────────
function stateLine(word, action) {
  $('du-state').hidden = !word;
  $('du-state-line').textContent = word ? (W.said[word] || word) : '';
  const b = $('du-state-act');
  b.hidden = !action;
  b.textContent = action ? action.label : '';
  b.onclick = action ? action.fn : null;
}
const SECTIONS = ['du-partners-sec', 'du-invites-sec', 'du-invite-sec', 'du-found-sec', 'du-matches-sec', 'du-upload-sec'];
function sections(on) { for (const id of SECTIONS) $(id).hidden = !on; }

async function signIn() {
  const r = await call('signIn');
  if (r && r.ok) boot();
}

// ── Home ───────────────────────────────────────────────────────────────────
function paintPartners(h) {
  const ul = $('du-partners');
  ul.replaceChildren(...h.partners.map((p) => {
    const li = el('li', `pl-row du-partner ${p.state}`);
    const who = el('span', 'pl-who');
    who.append(el('span', 'pl-name', p.username), el('span', 'du-sub', [p.rank, p.matches].filter(Boolean).join(', ')));
    const mid = el('span', 'du-mid');
    mid.append(el('span', `du-state-word ${p.state}`, p.stateLine));
    if (p.pins) mid.append(el('span', 'du-pins-new', p.pins));
    const acts = el('span', 'du-acts');
    let confirm = false;
    const rm = button('btn btn-link sm', 'Remove', async () => {
      if (!confirm) { confirm = true; rm.textContent = 'Remove and delete what we shared'; return; }
      rm.disabled = true;
      const r = await call('remove', p.username);
      if (r) { $('du-partner-said').textContent = r.line || ''; if (r.state) paint(r.state); }
    });
    const report = button('btn btn-link sm', 'Report', () => toggleReport(li, p.username));
    const block = button('btn btn-link sm', 'Block', async () => {
      block.disabled = true;
      const r = await call('block', p.username);
      $('du-partner-said').textContent = r && r.ok ? `${p.username} is blocked. Your duo ended and everything you shared was deleted.` : 'Could not block right now. Try again in a moment.';
      if (r && r.ok) boot();
      else block.disabled = false;
    });
    acts.append(rm, report, block);
    li.append(who, mid, acts);
    return li;
  }));
  $('du-partners-empty').hidden = h.partners.length > 0;
  $('du-ended').replaceChildren(...h.ended.map((e) => el('li', 'pl-note', e.line)));
}

/** Block and Report for any player a row names (a partner, an inviter, a teammate found). */
function guard(li, name, said) {
  const report = button('btn btn-link sm', 'Report', () => toggleReport(li, name));
  const block = button('btn btn-link sm', 'Block', async () => {
    block.disabled = true;
    const r = await call('block', name);
    $(said).textContent = r && r.ok ? `${name} is blocked. Neither of you can invite or find the other, and anything you shared was deleted.` : 'Could not block right now. Try again in a moment.';
    if (r && r.ok) boot();
    else block.disabled = false;
  });
  return [report, block];
}

const REPORT_REASONS = [['username', 'Their username'], ['pins', 'Their pins'], ['clips', 'Their clips'], ['other', 'Something else']];
const sayIn = (li) => (li.closest && li.closest('#du-found') ? 'du-found-said' : li.closest && li.closest('#du-invites') ? 'du-invite-said' : 'du-partner-said');
function toggleReport(li, name) {
  const open = li.querySelector('.du-report');
  if (open) { open.remove(); return; }
  const box = el('div', 'du-report');
  box.append(el('span', 'pl-label', `What is wrong with ${name}'s side?`));
  const seg = el('div', 'seg');
  seg.setAttribute('role', 'group');
  let reason = null;
  const send = button('btn btn-ghost sm', 'Send report', async () => {
    send.disabled = true;
    const r = await call('flag', name, reason);
    $(sayIn(li)).textContent = (r && r.line) || 'The report could not be sent. Try again in a moment.';
    if (r && r.ok) box.remove(); else send.disabled = false;
  });
  send.disabled = true;
  for (const [k, w] of REPORT_REASONS) {
    const b = button('', w, () => { reason = k; for (const x of seg.children) x.setAttribute('aria-pressed', String(x === b)); send.disabled = false; });
    b.setAttribute('aria-pressed', 'false');
    seg.append(b);
  }
  box.append(seg, send);
  li.append(box);
}

function paintInvites(h) {
  // One list: the invites to this player first, then the ones it sent.
  const incoming = h.invitesIn.map((i) => {
    const li = el('li', 'pl-row du-invite');
    const who = el('span', 'pl-who');
    who.append(el('span', 'pl-name', i.username), el('span', 'du-sub', i.line));
    const acts = el('span', 'du-acts');
    acts.append(button('btn btn-primary sm', 'Accept', async () => {
      const r = await call('acceptFrom', i.username);
      if (r) { $('du-invite-said').textContent = r.line || ''; if (r.state) paint(r.state); }
    }), button('btn btn-link sm', 'Decline', async () => {
      const r = await call('decline', i.username);
      if (r && r.state) paint(r.state);
    }), ...guard(li, i.username, 'du-invite-said'));
    li.append(who, acts);
    return li;
  });
  const outgoing = h.invitesOut.map((i) => {
    const li = el('li', 'pl-row du-invite out');
    const who = el('span', 'pl-who');
    who.append(el('span', 'pl-name', i.title), el('span', 'du-sub', i.line));
    const acts = el('span', 'du-acts');
    acts.append(button('btn btn-link sm', 'Cancel', async () => {
      const r = await call('cancel', i.ref);
      if (r && r.state) paint(r.state);
    }, `Cancel the invite: ${i.title}`));
    li.append(who, acts);
    return li;
  });
  $('du-invites').replaceChildren(...incoming, ...outgoing);
  $('du-invites-sec').hidden = !h.invitesIn.length && !h.invitesOut.length;
}

function paintInvite(h) {
  $('du-can-invite').hidden = !h.max;
  $('du-needs-max').hidden = h.max;
  $('du-needs-line').textContent = W.needsMax || '';
  $('du-ask-line').textContent = W.askInvite || '';
  $('du-name').disabled = h.full;
  $('du-invite-go').disabled = h.full;
  $('du-code-make').disabled = h.full;
}

function paintFound(h) {
  $('du-found-note').textContent = h.foundNote;
  $('du-found').replaceChildren(...h.found.map((f) => {
    const li = el('li', 'pl-row du-found');
    const who = el('span', 'pl-who');
    who.append(el('span', 'pl-name', f.username), el('span', 'du-sub', f.line));
    const acts = el('span', 'du-acts');
    if (h.max && !h.full) {
      acts.append(button('btn btn-ghost sm', 'Invite to duo', async (e) => {
        e.currentTarget.disabled = true;
        const r = await call('invite', f.username);
        if (r) { $('du-invite-said').textContent = r.line || ''; if (r.state) paint(r.state); }
      }));
    } else acts.append(el('span', 'du-sub', h.max ? 'You have the most duos there can be' : 'Ask them to invite you'));
    acts.append(...guard(li, f.username, 'du-found-said'));
    li.append(face(f.agent), who, acts);
    return li;
  }));
  $('du-found').hidden = !h.found.length;
}

function paintMatches(h) {
  $('du-matches').replaceChildren(...h.matches.map((m, i) => {
    const li = el('li', 'pl-result rise-in');
    li.style.setProperty('--i', String(Math.min(i, 8)));
    const b = button('pl-result-btn du-match-btn', null, () => openMatch(m.ref));
    const who = el('span', 'pl-who');
    who.append(el('span', 'pl-name', m.title), el('span', 'du-sub', `With ${m.partner}, ${m.when}`));
    const pair = el('span', 'du-pair');
    for (const [side, name] of [[m.me, 'You'], [m.them, m.partner]]) {
      const one = el('span', 'du-one');
      one.append(face(side.agent, 'pl-face sm'), el('span', 'du-g', side.grade ? `${name} ${side.grade}` : `${name}, no grade`));
      pair.append(one);
    }
    b.append(mapPic(m.map), who, pair);
    b.setAttribute('aria-label', [m.title, m.result, `with ${m.partner}`, m.when].filter(Boolean).join(', '));
    li.append(b);
    return li;
  }));
  const empty = !h.matches.length;
  $('du-matches').hidden = empty;
  $('du-matches-empty').hidden = !empty;
  $('du-matches-empty').textContent = h.partners.length
    ? `No shared match yet. Play a match with your duo on one team; once both of you have your review, it shows here for ${W.keepDays || 30} days.`
    : 'Once you have a duo, the matches you play together show here.';
}

function setSeg(id, val) {
  for (const b of $(id).querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.val === val));
}
function paintUpload(u) {
  if (!u) return;
  setSeg('du-upload', u.on ? 'on' : 'off');
  $('du-upload-line').textContent = u.line || '';
}

function paint(s) {
  if (!s) return;
  $('du-what').textContent = W.what || '';
  const p = s.problem;
  if (p === 'signed-out') { sections(false); stateLine('signed-out', { label: 'Sign in', fn: signIn }); return; }
  if (p === 'offline' || p === 'failed' || p === 'busy') { sections(false); stateLine(p, { label: 'Try again', fn: boot }); return; }
  if (p === 'not-live') { sections(false); stateLine('Duos is not open right now.'); return; }
  if (p === 'no-username') { sections(false); stateLine('no-username', { label: 'Open Profile', fn: () => api.go && api.go('profile') }); return; }
  const h = s.home;
  if (!h) { sections(false); stateLine('failed', { label: 'Try again', fn: boot }); return; }
  home = h;
  stateLine(null);
  sections(true);
  paintPartners(h);
  paintInvites(h);
  paintInvite(h);
  paintFound(h);
  paintMatches(h);
  paintUpload(s.upload);
  // Nothing to upload to with no duo: the switch shows once there is one.
  $('du-upload-sec').hidden = !h.partners.length;
  $('du-quota-line').textContent = h.quota ? `${h.quota}.` : '';
}

$('du-invite-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = $('du-name').value.trim();
  if (!name) return;
  $('du-invite-go').disabled = true;
  const r = await call('invite', name);
  $('du-invite-go').disabled = false;
  if (!r) return;
  $('du-invite-said').textContent = r.line || '';
  if (r.ok) $('du-name').value = '';
  if (r.state) paint(r.state);
});
$('du-code-make').addEventListener('click', async () => {
  $('du-code-make').disabled = true;
  const r = await call('makeCode');
  $('du-code-make').disabled = false;
  if (!r) return;
  if (r.ok && r.code) {
    $('du-code-box').hidden = false;
    $('du-code').textContent = r.code;
    $('du-code-line').textContent = [r.line, r.codeLine].filter(Boolean).join(' ');
    $('du-invite-said').textContent = '';
  } else $('du-invite-said').textContent = r.line || '';
  if (r.state) { const keep = $('du-code-box').hidden; paint(r.state); $('du-code-box').hidden = keep; }
});
$('du-join-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const code = $('du-join-code').value.trim();
  if (!code) return;
  $('du-join-go').disabled = true;
  const r = await call('acceptCode', code);
  $('du-join-go').disabled = false;
  if (!r) return;
  $('du-invite-said').textContent = r.line || '';
  if (r.ok) $('du-join-code').value = '';
  if (r.state) paint(r.state);
});
$('du-plans').addEventListener('click', () => call('plans'));
for (const b of $('du-upload').querySelectorAll('button')) {
  b.addEventListener('click', async () => {
    const r = await call('setUpload', b.dataset.val === 'on');
    if (r && r.upload) paintUpload(r.upload);
  });
}

// ── One shared match ───────────────────────────────────────────────────────
function showHome() {
  releaseStage();
  $('du-home').hidden = false;
  $('du-match').hidden = true;
  current = null;
}

async function openMatch(ref) {
  const mine = ++ask;
  stateLine('loading');
  const r = await call('match', ref);
  if (mine !== ask || !r) { if (!r) stateLine(null); return; }
  if (!r.ok) {
    stateLine(r.error === 'not-found' ? 'This match is not shared any more: it expired after its 30 days, or the duo ended.' : (r.error || 'failed'),
      r.error === 'offline' ? { label: 'Try again', fn: () => openMatch(ref) } : null);
    return;
  }
  stateLine(null);
  current = r.match;
  paintMatch(r.match, r.names);
  $('du-home').hidden = true;
  $('du-match').hidden = false;
  document.querySelector('.body').scrollTop = 0;
}

function sideCell(side, who) {
  const cell = el('div', `du-cell ${side.none ? 'none' : ''}`.trim());
  cell.append(el('span', 'du-who', who));
  cell.append(el('span', `du-line ${side.died ? 'died' : ''}`.trim(), side.line));
  if (!side.none) cell.append(el('span', 'du-sub', side.killLine));
  if (side.chips && side.chips.length) {
    const chips = el('span', 'du-chips');
    for (const c of side.chips) chips.append(el('span', `du-chip ${c.tone || ''}`.trim(), c.word));
    cell.append(chips);
  }
  return cell;
}

/** One round's time axis: both players' kills and deaths, the plant, on one line each. */
function axis(r, partner) {
  const row = el('div', 'du-axis-row');
  const names = el('div', 'du-lane-names');
  names.setAttribute('aria-hidden', 'true');
  names.append(el('span', null, 'You'), el('span', null, partner));
  const box = el('div', 'du-axis');
  box.setAttribute('role', 'img');
  const said = r.marks.map((m) => `${m.who === 'me' ? 'You' : partner} ${m.kind === 'kill' ? 'killed' : 'died'} at ${Math.floor(m.sec / 60)}:${String(m.sec % 60).padStart(2, '0')}`);
  if (r.plant && r.plant.sec !== null) said.push(`planted on ${r.plant.site} at ${Math.floor(r.plant.sec / 60)}:${String(r.plant.sec % 60).padStart(2, '0')}`);
  box.setAttribute('aria-label', said.length ? said.join(', ') : 'No kill or death on the record');
  for (const lane of ['me', 'them']) {
    const l = el('div', `du-lane ${lane}`);
    for (const m of r.marks.filter((x) => x.who === lane)) {
      const i = el('i', `du-mark ${m.kind}`);
      i.style.left = `${(m.at * 100).toFixed(2)}%`;
      l.append(i);
    }
    box.append(l);
  }
  if (r.plant && r.plant.at !== null) {
    const pl = el('i', 'du-plant');
    pl.style.left = `${(r.plant.at * 100).toFixed(2)}%`;
    box.append(pl);
  }
  const ticks = el('div', 'du-ticks');
  for (let s = 0; s <= r.span; s += 20) {
    const t = el('span', 'du-tick', `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`);
    t.style.left = `${((s / r.span) * 100).toFixed(2)}%`;
    ticks.append(t);
  }
  box.append(ticks);
  row.append(names, box);
  return row;
}

function paintMatch(m, names) {
  $('dm-title').textContent = m.title;
  $('dm-sub').textContent = m.sub;
  $('dm-left').textContent = m.left;
  $('dm-paused').hidden = !m.pausedLine;
  $('dm-paused').textContent = m.pausedLine || '';
  $('dm-g-me').textContent = m.grades.me ? m.grades.me.score : '-';
  $('dm-a-me').textContent = m.grades.meAgent ? `You, ${m.grades.meAgent}` : 'You';
  $('dm-k-me').textContent = m.lines.me ? `${m.lines.me} K / D / A` : '';
  $('dm-g-them').textContent = m.grades.them ? m.grades.them.score : '-';
  $('dm-a-them').textContent = m.grades.themAgent ? `${m.partner}, ${m.grades.themAgent}` : m.partner;
  $('dm-k-them').textContent = m.lines.them ? `${m.lines.them} K / D / A` : '';
  const missing = [m.mineMissing, m.theirsMissing].filter(Boolean).join(' ');
  $('dm-missing').hidden = !missing;
  $('dm-missing').textContent = missing;
  $('dm-key-them').textContent = m.partner;
  $('dm-names').textContent = names || W.names || '';
  $('dm-rounds').replaceChildren(...m.rounds.map((r) => {
    const li = el('li', 'du-round');
    const head = el('div', 'du-round-head');
    head.append(el('b', 'du-round-n', `Round ${r.n}`), el('span', 'du-sub', [r.side, r.result].filter(Boolean).join(', ')));
    if (r.plant) head.append(el('span', 'du-sub', `Planted on ${r.plant.site}`));
    if (r.watch) {
      const clips = r.myClips.length + r.theirClips.length;
      head.append(button('btn btn-ghost sm du-watch', clips > 1 && r.myClips.length && r.theirClips.length ? 'Watch both' : 'Watch', () => watch(r),
        `Watch round ${r.n}`));
    }
    if (r.pins) head.append(el('span', 'du-pins-new', `${r.pins} pin${r.pins === 1 ? '' : 's'}`));
    const cells = el('div', 'du-cells');
    cells.append(sideCell(r.me, 'You'), sideCell(r.them, m.partner));
    li.append(head, cells, axis(r, m.partner));
    return li;
  }));
  releaseStage();
  $('dm-stage-sec').hidden = true;
}

// ── The stage: a round's two clips, one clock ──────────────────────────────
function releaseStage() {
  const host = $('dm-stage');
  if (window.ClipPlayer && typeof window.ClipPlayer.release === 'function') window.ClipPlayer.release(host);
  host.replaceChildren();
  stage = null;
  $('dm-sync').hidden = true;
  $('dm-pin').hidden = true;
  $('dm-pins').replaceChildren();
}

const KIND_WORD = { death: 'death clip', flag: 'flagged death', highlight: 'highlight' };

async function urlOf(c) {
  if (c.url) return { ok: true, url: c.url };
  return (await call('openClip', { ref: c.ref, name: c.name, match: current.ref, expiresAt: current.expiresAt })) || { ok: false, line: 'That clip could not be opened.' };
}

async function watch(r) {
  releaseStage();
  const mine = ++ask;
  const sec = $('dm-stage-sec');
  sec.hidden = false;
  $('dm-stage-title').textContent = `Round ${r.n}`;
  $('dm-stage-note').textContent = 'Opening the clips';
  $('dm-stage-said').textContent = '';
  sec.scrollIntoView({ block: 'start', behavior: 'smooth' });
  const want = [['me', r.myClips[0], 'You'], ['them', r.theirClips[0], current.partner]];
  const sides = [];
  const notes = [];
  for (const [who, c, name] of want) {
    if (!c) { notes.push(`${who === 'me' ? 'You have' : `${name} has`} no clip of this round.`); continue; }
    const u = await urlOf(c);
    if (mine !== ask) return;
    if (!u.ok) { notes.push(`${who === 'me' ? 'Your' : `${name}'s`} clip: ${u.line}`); continue; }
    sides.push({ who, clip: c, name, url: u.url });
  }
  const host = $('dm-stage');
  host.replaceChildren();
  for (const s of sides) {
    const slot = el('div', `du-slot ${s.who}`);
    slot.append(el('span', 'du-slot-cap', `${s.who === 'me' ? 'You' : s.name}, ${KIND_WORD[s.clip.kind] || 'clip'}`));
    let p = null;
    if (window.ClipPlayer && typeof window.ClipPlayer.create === 'function') {
      p = window.ClipPlayer.create({ url: s.url, death: s.clip.marks.death, kills: s.clip.marks.kills, cuts: s.clip.marks.cuts,
        label: `${s.who === 'me' ? 'Your' : `${s.name}'s`} clip of round ${r.n}` });
      slot.append(p.el);
      s.video = p.video;
      s.fig = p.el;
    } else {
      const v = document.createElement('video');
      v.muted = true;
      v.setAttribute('src', s.url);
      slot.append(v);
      s.video = v;
      s.fig = slot;
    }
    s.video.removeAttribute('loop');
    s.video.loop = false;
    s.video.setAttribute('preload', 'metadata');
    try { s.video.preload = 'metadata'; if (typeof s.video.load === 'function') s.video.load(); } catch { /* the player loads it */ }
    s.video.addEventListener('loadedmetadata', () => drawPins());
    host.append(slot);
  }
  host.classList.toggle('two', sides.length === 2);
  const synced = sides.length === 2 && sides.every((s) => T && T.anchorOf(s.clip.marks));
  if (sides.length === 2 && !synced) notes.push('These two clips are not on one clock: one has no moment Riot timed, so each plays on its own.');
  if (synced) notes.push('Both clips run on the round\'s clock: play, pause, the seconds and the frames move both.');
  if (!sides.length) notes.unshift('No clip of this round could be played.');
  $('dm-stage-note').textContent = notes.join(' ');
  stage = { round: r, sides, synced, label: null, reaction: null, lead: 0 };
  if (synced) setupSync();
  setupPin();
  drawPins();
}

// THE OUTER CONTROLLER over the two players: the round's time is the lead
// clip's, the other follows it, and every move goes to both.
const lenOf = (s) => (s.video && Number.isFinite(s.video.duration) ? s.video.duration * 1000 : null);
function roundNow() {
  if (!stage || !stage.synced) return null;
  const s = stage.sides[stage.lead];
  return T.roundAt(s.clip.marks, (s.video.currentTime || 0) * 1000);
}
function spanNow() {
  const spans = stage.sides.map((s) => T.spanOf(s.clip.marks, lenOf(s))).filter(Boolean);
  if (!spans.length) return null;
  return [Math.min(...spans.map((x) => x[0])), Math.max(...spans.map((x) => x[1]))];
}
function seekRound(ms) {
  if (!stage || !stage.synced) return;
  for (const s of stage.sides) {
    const at = T.clipAt(s.clip.marks, ms, lenOf(s));
    if (!at) continue;
    try { s.video.currentTime = Math.max(0, at.clip / 1000); } catch { /* not loaded yet */ }
    s.out = !at.inside;
    if (s.out && !s.video.paused) s.video.pause();
  }
  // The lead is a clip the moment lies inside.
  const inside = stage.sides.findIndex((s) => !s.out);
  if (inside >= 0) stage.lead = inside;
  paintClock();
}
function paintClock() {
  const ms = roundNow();
  $('ds-time').textContent = ms === null ? '' : `Round time ${T.clockOf(ms)}`;
  const span = spanNow();
  if (span && ms !== null) $('ds-seek').value = String(Math.round(((ms - span[0]) / Math.max(1, span[1] - span[0])) * 1000));
  const playing = stage && stage.sides.some((s) => s.video && s.video.paused === false);
  $('ds-play').textContent = playing ? 'Pause both' : 'Play both';
}
function setupSync() {
  $('dm-sync').hidden = false;
  const move = (d) => { const now = roundNow(); if (now !== null) { pauseBoth(); seekRound(now + d); } };
  $('ds-back').onclick = () => move(-1000);
  $('ds-fwd').onclick = () => move(1000);
  $('ds-frame-back').onclick = () => move(-FRAME_MS);
  $('ds-frame-fwd').onclick = () => move(FRAME_MS);
  $('ds-play').onclick = () => {
    const playing = stage.sides.some((s) => s.video.paused === false);
    if (playing) { pauseBoth(); return; }
    const now = roundNow();
    if (now !== null) seekRound(now);
    for (const s of stage.sides) if (!s.out) { const p = s.video.play(); if (p && typeof p.catch === 'function') p.catch(() => {}); }
    paintClock();
  };
  $('ds-seek').oninput = () => {
    const span = spanNow();
    if (!span) return;
    pauseBoth();
    seekRound(span[0] + (Number($('ds-seek').value) / 1000) * (span[1] - span[0]));
  };
  for (const [i, s] of stage.sides.entries()) {
    s.video.addEventListener('timeupdate', () => follow(i));
    s.video.addEventListener('ended', () => {
      // The lead ran out: the other goes on, if the moment is inside it.
      const other = stage.sides[1 - i];
      if (other && !other.out && other.video.paused === false) stage.lead = 1 - i;
      paintClock();
    });
    s.video.addEventListener('pause', paintClock);
    s.video.addEventListener('play', paintClock);
    s.video.addEventListener('loadedmetadata', paintClock);
  }
}
function pauseBoth() { if (stage) for (const s of stage.sides) if (s.video && !s.video.paused) s.video.pause(); paintClock(); }
/** The other clip held to the lead's round time while both play. */
function follow(i) {
  if (!stage || !stage.synced || i !== stage.lead) return;
  const now = roundNow();
  const other = stage.sides[1 - i];
  if (now === null || !other) return paintClock();
  const at = T.clipAt(other.clip.marks, now, lenOf(other));
  if (at && at.inside) {
    const drift = Math.abs(other.video.currentTime * 1000 - at.clip);
    if (drift > 150) { try { other.video.currentTime = at.clip / 1000; } catch { /* loading */ } }
    if (other.video.paused && stage.sides[i].video.paused === false) { const p = other.video.play(); if (p && typeof p.catch === 'function') p.catch(() => {}); }
    other.out = false;
  } else if (at && !at.inside && !other.video.paused) { other.video.pause(); other.out = true; }
  paintClock();
}

// ── Pins: the partner's clip, a label from the list, a reaction ───────────
function setupPin() {
  const theirs = stage.sides.find((s) => s.who === 'them');
  $('dm-pin').hidden = !theirs;
  if (!theirs) return;
  $('dm-pin-label').textContent = `Pin a moment of ${theirs.name}'s clip`;
  const labels = $('dm-pin-labels');
  labels.replaceChildren(...W.pins.map((p) => {
    const b = button('', p.word, () => { stage.label = p.key; for (const x of labels.children) x.setAttribute('aria-pressed', String(x === b)); $('dm-pin-go').disabled = false; });
    b.setAttribute('aria-pressed', 'false');
    return b;
  }));
  const reacts = $('dm-pin-reactions');
  reacts.replaceChildren(...W.reactions.map((p) => {
    const b = button('', p.word, () => {
      stage.reaction = stage.reaction === p.key ? null : p.key;
      for (const x of reacts.children) x.setAttribute('aria-pressed', String(x === b && stage.reaction === p.key));
    });
    b.setAttribute('aria-pressed', 'false');
    return b;
  }));
  $('dm-pin-go').disabled = true;
  $('dm-pin-go').onclick = async () => {
    if (!stage || !stage.label) return;
    const at = Math.max(0, Math.round((theirs.video.currentTime || 0) * 1000));
    $('dm-pin-go').disabled = true;
    const r = await call('pin', { clip: theirs.clip.ref, at, label: stage.label, reaction: stage.reaction });
    $('dm-pin-go').disabled = false;
    if (!r || !r.ok) { $('dm-stage-said').textContent = (r && r.line) || 'The pin could not be saved. Try again in a moment.'; return; }
    const word = (W.pins.find((x) => x.key === stage.label) || {}).word || 'Pin';
    const react = stage.reaction ? (W.reactions.find((x) => x.key === stage.reaction) || {}).word : null;
    theirs.clip.pins.push({ ref: r.ref, at, mine: true, word, reaction: react });
    $('dm-stage-said').textContent = `Pinned at ${secs(at)} of the clip: ${word}.`;
    drawPins();
  };
}

/** A place in a clip, "2.1 s". */
const secs = (ms) => `${(Math.max(0, ms) / 1000).toFixed(1)} s`;

function drawPins() {
  if (!stage) return;
  const list = [];
  for (const s of stage.sides) {
    const track = s.fig && typeof s.fig.querySelector === 'function' ? s.fig.querySelector('.cp-track') : null;
    if (track) for (const old of track.querySelectorAll('.cp-mark.pin')) old.remove();
    const len = lenOf(s);
    for (const p of s.clip.pins || []) {
      if (track && len) {
        const i = el('i', 'cp-mark pin');
        i.style.left = `${Math.min(100, (p.at / len) * 100).toFixed(2)}%`;
        i.title = `${p.word}${p.reaction ? `, ${p.reaction}` : ''}`;
        track.append(i);
      }
      list.push({ s, p });
    }
  }
  $('dm-pins').replaceChildren(...list.sort((a, b) => a.p.at - b.p.at).map(({ s, p }) => {
    const li = el('li', 'du-pin-row');
    const who = p.mine ? 'You' : current.partner;
    const onWhat = s.who === 'me' ? 'your clip' : `${s.name}'s clip`;
    li.append(el('i', 'du-pin-dot'), el('span', 'du-pin-t', secs(p.at)),
      el('span', 'du-pin-w', `${p.word}${p.reaction ? `, ${p.reaction}` : ''}`), el('span', 'du-sub', `${who} on ${onWhat}`));
    li.append(button('btn btn-link sm', 'Go there', () => {
      pauseBoth();
      try { s.video.currentTime = p.at / 1000; } catch { /* loading */ }
      if (stage.synced) { stage.lead = stage.sides.indexOf(s); seekRound(roundNow()); }
    }, `Go to the pin at ${T.clockOf(p.at)}`));
    if (p.mine) {
      li.append(button('btn btn-link sm', 'Remove', async () => {
        const r = await call('unpin', p.ref);
        if (r && r.ok) { s.clip.pins = s.clip.pins.filter((x) => x !== p); drawPins(); }
      }, 'Remove this pin'));
    }
    return li;
  }));
}

$('dm-back').addEventListener('click', () => { showHome(); boot(); });

async function boot() {
  const s = await call('state');
  if (!s) return;   // mid match: the seal hides this page
  if (!current) paint(s);
  else { home = s.home || home; }
}

if (typeof api.onDuos === 'function') api.onDuos(() => { if (!current) boot(); });
if (typeof api.onAccount === 'function') api.onAccount(() => { showHome(); boot(); });
$('du-what').textContent = W.what || '';
stateLine('loading');
try { if (typeof window.occlaraSeg === 'function') window.occlaraSeg($('du-upload')); } catch { /* drawn flat */ }

boot().then(() => console.log('[duos] ready')).catch(() => {});

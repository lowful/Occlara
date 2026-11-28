'use strict';

/*
 * THE STREAM WIDGET'S PAGE (docs/claude/rating.md "Live"). Listens to the
 * server's events (rating-stream.js, same address, `events`) and draws what
 * each says, set as text: { state: 'idle' } nothing; { state: 'live', rating:
 * { shown, value, tier, last: { delta, label }, line } } the badge, the move,
 * the label and the line, "Live, provisional"; { state: 'final', rating:
 * { shown, value, tier } } the confirmed number, "Full time". EventSource
 * reconnects by itself (the server asks two seconds).
 */
(function () {
  const $ = (id) => document.getElementById(id);
  const box = $('w');
  if (/(?:^|[?&])size=compact(?:&|$)/.test(location.search)) document.body.classList.add('compact');
  let lastLabel = '';
  let lastValue = null;

  function line(points) {
    const vals = (Array.isArray(points) ? points : []).filter((v) => typeof v === 'number' && Number.isFinite(v));
    if (vals.length < 2) { $('w-path').setAttribute('d', ''); return; }
    const lo = Math.min(5.5, ...vals) - 0.2;
    const hi = Math.max(6.5, ...vals) + 0.2;
    const x = (i) => (i / (vals.length - 1)) * 160;
    const y = (v) => 32 - ((v - lo) / (hi - lo)) * 32;
    $('w-path').setAttribute('d', vals.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' '));
    $('w-line').querySelector('.w-base').setAttribute('y1', y(6).toFixed(1));
    $('w-line').querySelector('.w-base').setAttribute('y2', y(6).toFixed(1));
  }

  function show(on) {
    if (on) { box.hidden = false; requestAnimationFrame(() => box.classList.add('on')); } else { box.classList.remove('on'); box.hidden = true; lastLabel = ''; lastValue = null; }
  }

  function paint(msg) {
    const m = msg && typeof msg === 'object' ? msg : { state: 'idle' };
    const r = m.rating && typeof m.rating === 'object' ? m.rating : null;
    // Main says the kill feed is not being read: the plate says so, no number.
    if (m.state === 'blind') {
      box.classList.add('blind');
      $('w-state').textContent = 'Live';
      $('w-label').textContent = 'Not reading the kill feed';
      $('w-num').textContent = '';
      window.RatingBadge.setDelta($('w-delta'), '');
      line(null);
      show(true);
      return;
    }
    box.classList.remove('blind');
    if ((m.state !== 'live' && m.state !== 'final') || !r || typeof r.value !== 'number') { show(false); return; }
    box.classList.toggle('final', m.state === 'final');
    window.RatingBadge.setNumber($('w-num'), $('w-badge'), r.value);
    $('w-state').textContent = m.state === 'final' ? 'Full time' : 'Live, provisional';
    if (m.state === 'final') {
      window.RatingBadge.setDelta($('w-delta'), '');
      $('w-label').textContent = 'Confirmed by Riot\'s record';
      line(null);
    } else {
      const last = r.last && typeof r.last === 'object' ? r.last : null;
      if (lastValue !== null && r.value !== lastValue && last) window.RatingBadge.setDelta($('w-delta'), String(last.delta || ''));
      const label = last && typeof last.label === 'string' ? last.label : '';
      if (label !== lastLabel) {
        const l = $('w-label');
        l.textContent = label;
        l.classList.remove('in'); void l.offsetWidth; if (label) l.classList.add('in');
        lastLabel = label;
      }
      line(r.line);
    }
    lastValue = r.value;
    show(true);
  }

  try {
    const es = new EventSource('events');
    es.onmessage = (e) => { try { paint(JSON.parse(e.data)); } catch { /* one bad message, the next repaints */ } };
  } catch { /* no events: nothing shows */ }
  window.occlaraWidget = { paint };
})();

// THE SHOOTING ERROR GRAPH (docs/claude/trainer.md, "Scoring"): in the run's
// report, under the scores chart, one thin bar per shot, oldest on the left,
// stacked: the firing error (the cone the spray, the crouch and the aim left
// it) at the foot and the movement error (walking, running, in the air, just
// landed) on top, both in degrees, over a scale that fits the tallest bar.
// What it draws is trainer-math.js errorGraph's; it is built once, when the
// report shows, never during a run. No colour is named here: trainer.css
// gives `.fire` and `.move` theirs.

const NS = 'http://www.w3.org/2000/svg';
// The graph's own space (viewBox): 400 across, H high; each shot has a slot
// of 400 / cap and its bar fills BAR of it.
const W = 400, H = 48, BAR = 0.6, LEAST = 1.5;

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const degrees = (v) => `${Math.round(v * 100) / 100}°`;

/** The one plain sentence under the graph. */
export function shotGraphLine(g) {
  if (!g.shots) return '';
  if (!g.moving) return `None of your ${plural(g.shots, 'shot', 'shots')} carried movement error.`;
  if (g.moving === g.shots) return `Every one of your ${plural(g.shots, 'shot', 'shots')} carried movement error: you were moving, in the air or just landed as each left.`;
  return `${g.moving} of your ${plural(g.shots, 'shot', 'shots')} carried movement error: you were moving, in the air or just landed as they left.`;
}

/**
 * Paints the graph into the report's `#r-err` box from errorGraph's answer,
 * or hides it when no shot was fired.
 * @param box  { root, title, svg, top, said } the box's elements
 * @param g    trainer-math.js errorGraph(shots, cap)
 * @param cap  the most shots drawn
 */
export function paintShotGraph(box, g, cap) {
  box.svg.textContent = '';
  box.root.hidden = !g.shots;
  if (!g.shots) return;
  box.title.textContent = g.shots > cap ? `Shooting error, your last ${cap} shots` : 'Shooting error, shot by shot';
  box.top.textContent = degrees(g.top);
  const slot = W / cap;
  const rect = (cls, x, y, h) => {
    const r = document.createElementNS(NS, 'rect');
    r.setAttribute('class', cls);
    r.setAttribute('x', x.toFixed(2));
    r.setAttribute('y', y.toFixed(2));
    r.setAttribute('width', (slot * BAR).toFixed(2));
    r.setAttribute('height', Math.max(0, h).toFixed(2));
    box.svg.append(r);
  };
  // The foot, and a dashed line where the scale's top is.
  for (const [cls, y] of [['base', H], ['top', 0]]) {
    const l = document.createElementNS(NS, 'line');
    l.setAttribute('class', cls);
    l.setAttribute('x1', '0'); l.setAttribute('y1', String(y)); l.setAttribute('x2', String(W)); l.setAttribute('y2', String(y));
    box.svg.append(l);
  }
  const k = H / g.top;
  g.bars.forEach((b, i) => {
    const x = i * slot + (slot * (1 - BAR)) / 2;
    // A first shot's cone under a scale an airborne shot set is a fraction
    // of a pixel: drawn at least LEAST high, so every shot shows.
    const fire = Math.max(LEAST, b.fire * k), move = b.move * k;
    rect('fire', x, H - fire, fire);
    if (move > 0) rect('move', x, H - fire - move, move);
  });
  const line = shotGraphLine(g);
  box.said.textContent = line;
  box.svg.setAttribute('aria-label', `${box.title.textContent}, up to ${degrees(g.top).replace('°', ' degrees')}. ${line}`);
}

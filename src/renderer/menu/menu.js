'use strict';

/*
 * THE ACCOUNT MENU OVER THE PAGE (8.9.1): the view main lays over every page
 * while the avatar's menu is open (main-window.js openMenu). It draws the
 * shell's rows as sent (shell.js syncMenu), app authored markup with the Riot
 * ID and the games left as text the shell wrote, and holds the menu's
 * keyboard: ArrowUp and ArrowDown move through the rows that can be chosen,
 * Home and End go to either end, Enter and Space choose, and Escape and Tab
 * shut it, handing the focus back to the avatar. A row chosen is only named
 * to main (occlaraMenu.choose): the shell carries it out on its own row, so
 * a row the seal locked stays locked. The view losing the focus (a press on
 * the page, on the bar, another app) shuts it.
 */

const $ = (id) => document.getElementById(id);
const menu = $('menu');
const bridge = window.occlaraMenu;
let open = false;
let rowsTimer = 0;

const items = () => [...menu.querySelectorAll('[role="menuitem"]')].filter((b) => !b.hidden && !b.disabled);
function focusItem(which) {
  const list = items();
  if (!list.length) { menu.focus(); return; }
  const at = list.indexOf(document.activeElement);
  const i = which === 'first' ? 0 : which === 'last' ? list.length - 1
    : which === 'next' ? (at + 1) % list.length : (at <= 0 ? list.length : at) - 1;
  list[i].focus();
}

function draw(m) {
  if (!m || !m.html) {
    open = false;
    menu.hidden = true;
    menu.replaceChildren();
    return;
  }
  // The row with the focus keeps it as the rows are drawn again.
  const had = document.activeElement && menu.contains(document.activeElement) ? document.activeElement.id : '';
  menu.innerHTML = m.html;
  menu.style.left = `${Math.max(0, m.left || 0)}px`;
  menu.style.top = `${Math.max(0, m.top || 0)}px`;
  if (m.width > 0) menu.style.width = `${m.width}px`;
  if (m.height > 0) menu.style.height = `${m.height}px`;
  if (m.fresh || !open) {
    // Each opening comes down out of the bar again (shell.css menuIn), and
    // its rows follow it down one after another, once per opening (8.9.2,
    // menu.css): drawn again while open, they are simply there.
    menu.style.animation = 'none';
    menu.hidden = false;
    menu.querySelectorAll('[role="menuitem"]').forEach((b, i) => b.style.setProperty('--i', String(Math.min(i, 5))));
    menu.classList.remove('rows-in');
    void menu.offsetWidth;
    menu.style.animation = '';
    menu.classList.add('rows-in');
    clearTimeout(rowsTimer);
    rowsTimer = setTimeout(() => menu.classList.remove('rows-in'), 600);
  } else {
    clearTimeout(rowsTimer);
    menu.classList.remove('rows-in');
  }
  menu.hidden = false;
  open = true;
  // 'menu': opened by a press, the menu itself holds the focus, no row ringed.
  if (m.focus === 'menu') menu.focus();
  else if (m.focus) focusItem(m.focus);
  else if (had && $(had) && !$(had).disabled && !$(had).hidden) $(had).focus();
  else if (!menu.contains(document.activeElement) && document.activeElement !== menu) menu.focus();
}

if (bridge) {
  bridge.onMenu(draw);
  menu.addEventListener('click', (e) => {
    const b = e.target && e.target.closest ? e.target.closest('[role="menuitem"]') : null;
    if (!b || !menu.contains(b) || b.disabled || b.hidden || !b.id) return;
    bridge.choose(b.id);
  });
  menu.addEventListener('keydown', (e) => {
    const move = { ArrowDown: 'next', ArrowUp: 'prev', Home: 'first', End: 'last' }[e.key];
    if (move) { e.preventDefault(); focusItem(move); }
    else if (e.key === 'Tab' || e.key === 'Escape') { e.preventDefault(); bridge.close(true); }
  });
  // A press in the see-through margin round the menu is a press outside it.
  document.addEventListener('pointerdown', (e) => {
    if (open && !(e.target && e.target.nodeType === 1 && menu.contains(e.target))) bridge.close(false);
  });
  window.addEventListener('blur', () => { if (open) bridge.close(false); });
}

'use strict';

/*
 * THE CONTROL THAT BINDS THE FLAG KEY (8.13), in Settings and on the tour: the
 * key as a cap, Change, which takes the next key pressed, and Turn off. What
 * may be bound is shared/flag-key.js's, through the page's preload, and whether
 * another app holds the key is main's to ask (FLAG_KEY_TEST).
 */
(function (root) {
  function make(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text) n.textContent = text;
    return n;
  }

  root.occlaraFlagKeyControl = function occlaraFlagKeyControl(host, initial) {
    const api = root.occlara;
    const cap = make('kbd', 'flag-key-cap');
    const change = make('button', 'btn btn-ghost sm flag-key-change', 'Change');
    const off = make('button', 'btn btn-ghost sm flag-key-off', 'Turn off');
    change.type = 'button';
    off.type = 'button';
    const said = make('p', 'hint flag-key-said');
    said.hidden = true;
    said.setAttribute('aria-live', 'polite');
    const row = make('span', 'flag-key');
    row.append(cap, change, off);
    host.replaceChildren(row, said);

    let current = typeof initial === 'string' ? initial : 'F8';
    let listening = false;

    const say = (text) => { said.textContent = text || ''; said.hidden = !text; };
    const paint = () => {
      cap.textContent = listening ? 'Press a key' : current ? api.flagKey.label(current) : 'Off';
      change.textContent = listening ? 'Cancel' : current ? 'Change' : 'Choose a key';
      off.hidden = listening || !current;
    };
    const stop = () => {
      listening = false;
      window.removeEventListener('keydown', onKey, true);
      paint();
    };
    const save = async (accel) => {
      current = accel;
      paint();
      try { await api.setConfig({ flagKey: accel }); } catch { say('That could not be saved. Try again.'); }
    };
    async function onKey(e) {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.code === 'Escape') { stop(); return; }
      const got = api.flagKey.fromEvent({ code: e.code, ctrlKey: e.ctrlKey, altKey: e.altKey, shiftKey: e.shiftKey, metaKey: e.metaKey });
      if (got.pending) return;
      stop();
      if (!got.ok) { say(got.why); return; }
      let free = null;
      try { free = await api.flagKey.test(got.accel); } catch { free = null; }
      if (!free || !free.ok) { say((free && free.why) || 'That key could not be checked. Try another.'); return; }
      say('');
      await save(got.accel);
    }
    change.addEventListener('click', () => {
      if (listening) { stop(); return; }
      say('');
      listening = true;
      window.addEventListener('keydown', onKey, true);
      paint();
    });
    off.addEventListener('click', () => { say(''); save(''); });
    paint();
    return { set(value) { if (!listening && typeof value === 'string') { current = value; paint(); } } };
  };
}(window));

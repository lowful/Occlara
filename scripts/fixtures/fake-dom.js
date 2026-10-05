'use strict';

/**
 * Run a renderer surface in plain node: its real index.html, its real scripts
 * in the order the page loads them, and its real preload bridge.
 *
 * WHY NOT ELECTRON. The boot checks (check:matches, check:gameswitch and the
 * rest) drive the real app, which is the only way to prove a channel arrives,
 * but they need a display, a free single instance lock and a few seconds each.
 * The logic a surface runs on what arrives (which line the panel paints when a
 * licence ends, when a sound plays, which colour a grade gets) needs none of
 * that, so it is tested here, offline and in milliseconds, against the same
 * files the app loads.
 *
 * WHAT IS REAL: the markup (parsed from the surface's index.html, so an id or a
 * class the script expects has to exist), the scripts (run in one vm context
 * the way classic scripts share a page), the preload (required with a stand in
 * for electron, so the channel constants it subscribes with are the real ones)
 * and the shared modules the preload requires (channels, i18n, games).
 *
 * WHAT IS NOT: layout. getBoundingClientRect answers a fixed box and nothing is
 * measured, so a CSS change is still checked by looking at it
 * (scripts/shot-surface.js), never here.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const Module = require('module');

const ROOT = path.join(__dirname, '..', '..');
const RENDERER = path.join(ROOT, 'src', 'renderer');
const PRELOAD = path.join(ROOT, 'src', 'preload');

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
const RAW = new Set(['script', 'style']);

function decode(s) {
  return String(s)
    .replace(/&#(\d+);/g, (_m, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&nbsp;/g, '\u00a0').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
}

const camel = (s) => s.replace(/-([a-z])/g, (_m, c) => c.toUpperCase());

class TextNode {
  constructor(text) { this.nodeType = 3; this.parentNode = null; this._t = String(text); }
  get textContent() { return this._t; }
  set textContent(v) { this._t = String(v); }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
}

function makeStyle() {
  const style = {};
  Object.defineProperties(style, {
    setProperty: { value(k, v) { style[k] = String(v); } },
    getPropertyValue: { value(k) { return style[k] === undefined ? '' : style[k]; } },
    removeProperty: { value(k) { delete style[k]; } },
  });
  return style;
}

class Element {
  constructor(doc, tag) {
    this.ownerDocument = doc;
    this.tagName = String(tag).toUpperCase();
    this.nodeType = 1;
    this.childNodes = [];
    this.parentNode = null;
    this._attrs = new Map();
    this._classes = [];
    this._listeners = {};
    this.style = makeStyle();
    this.dataset = {};
    this.hidden = false;
    this.disabled = false;
    this.value = '';
  }

  get id() { return this._attrs.get('id') || ''; }
  set id(v) { this._attrs.set('id', String(v)); }
  get title() { return this._attrs.get('title') || ''; }
  set title(v) { this._attrs.set('title', String(v)); }
  get className() { return this._classes.join(' '); }
  set className(v) { this._classes = [...new Set(String(v).split(/\s+/).filter(Boolean))]; }
  get classList() {
    const el = this;
    return {
      add: (...cs) => { for (const c of cs) if (!el._classes.includes(c)) el._classes.push(c); },
      remove: (...cs) => { el._classes = el._classes.filter((c) => !cs.includes(c)); },
      toggle: (c, force) => {
        const on = force === undefined ? !el._classes.includes(c) : !!force;
        if (on && !el._classes.includes(c)) el._classes.push(c);
        if (!on) el._classes = el._classes.filter((x) => x !== c);
        return on;
      },
      contains: (c) => el._classes.includes(c),
      get length() { return el._classes.length; },
      toString: () => el.className,
    };
  }

  getAttribute(n) {
    if (n === 'class') return this._classes.length ? this.className : null;
    if (n === 'hidden') return this.hidden ? '' : null;
    if (n === 'disabled') return this.disabled ? '' : null;
    if (n.startsWith('data-')) {
      const v = this.dataset[camel(n.slice(5))];
      return v === undefined ? null : v;
    }
    return this._attrs.has(n) ? this._attrs.get(n) : null;
  }
  setAttribute(n, v) {
    const s = String(v);
    if (n === 'class') this.className = s;
    else if (n === 'hidden') this.hidden = true;
    else if (n === 'disabled') this.disabled = true;
    else if (n === 'value') this.value = s;
    else if (n.startsWith('data-')) this.dataset[camel(n.slice(5))] = s;
    else this._attrs.set(n, s);
  }
  removeAttribute(n) {
    if (n === 'class') this._classes = [];
    else if (n === 'hidden') this.hidden = false;
    else if (n === 'disabled') this.disabled = false;
    else if (n.startsWith('data-')) delete this.dataset[camel(n.slice(5))];
    else this._attrs.delete(n);
  }
  hasAttribute(n) { return this.getAttribute(n) !== null; }

  get children() { return this.childNodes.filter((c) => c.nodeType === 1); }
  get firstChild() { return this.childNodes[0] || null; }
  get textContent() { return this.childNodes.map((c) => c.textContent).join(''); }
  set textContent(v) {
    for (const c of this.childNodes) c.parentNode = null;
    this.childNodes = [];
    const s = v === null || v === undefined ? '' : String(v);
    if (s) this.appendChild(new TextNode(s));
  }
  get innerHTML() { return this._html || ''; }
  set innerHTML(v) {
    for (const c of this.childNodes) c.parentNode = null;
    this.childNodes = [];
    this._html = String(v);
    for (const n of parseInto(this.ownerDocument, this._html)) this.appendChild(n);
  }

  appendChild(n) {
    if (n.parentNode) n.parentNode.removeChild(n);
    n.parentNode = this;
    this.childNodes.push(n);
    return n;
  }
  removeChild(n) {
    const i = this.childNodes.indexOf(n);
    if (i !== -1) this.childNodes.splice(i, 1);
    n.parentNode = null;
    return n;
  }
  insertBefore(n, ref) {
    if (!ref) return this.appendChild(n);
    if (n.parentNode) n.parentNode.removeChild(n);
    const i = this.childNodes.indexOf(ref);
    n.parentNode = this;
    this.childNodes.splice(i === -1 ? this.childNodes.length : i, 0, n);
    return n;
  }
  _node(n) { return typeof n === 'string' ? new TextNode(n) : n; }
  append(...ns) { for (const n of ns) this.appendChild(this._node(n)); }
  prepend(...ns) { for (const n of ns.reverse()) this.insertBefore(this._node(n), this.childNodes[0] || null); }
  replaceChildren(...ns) { this.textContent = ''; this.append(...ns); }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  replaceWith(n) {
    const p = this.parentNode;
    if (!p) return;
    p.insertBefore(this._node(n), this);
    p.removeChild(this);
  }
  after(...ns) {
    const p = this.parentNode;
    if (!p) return;
    const i = p.childNodes.indexOf(this);
    const next = p.childNodes[i + 1] || null;
    for (const n of ns) p.insertBefore(this._node(n), next);
  }
  contains(n) { for (let x = n; x; x = x.parentNode) if (x === this) return true; return false; }

  addEventListener(type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn); }
  removeEventListener(type, fn) { this._listeners[type] = (this._listeners[type] || []).filter((f) => f !== fn); }
  dispatchEvent(evt) {
    const e = evt;
    if (!e.target) e.target = this;
    for (let x = this; x && !e._stopped; x = x.parentNode) {
      e.currentTarget = x;
      for (const fn of (x._listeners && x._listeners[e.type]) || []) fn.call(x, e);
    }
    return !e.defaultPrevented;
  }
  click() { this.dispatchEvent(makeEvent('click')); }
  focus() {}
  blur() {}
  scrollIntoView() {}
  getBoundingClientRect() { return { x: 0, y: 0, top: 0, left: 0, width: 100, height: 100, right: 100, bottom: 100 }; }

  matches(sel) { return parseSelector(sel).some((complex) => matchComplex(this, complex)); }
  closest(sel) { for (let x = this; x && x.nodeType === 1; x = x.parentNode) if (x.matches(sel)) return x; return null; }
  querySelectorAll(sel) { return queryAll(this, sel); }
  querySelector(sel) { return queryAll(this, sel)[0] || null; }
}

function makeEvent(type, extra) {
  return Object.assign({
    type,
    defaultPrevented: false,
    _stopped: false,
    preventDefault() { this.defaultPrevented = true; },
    stopPropagation() { this._stopped = true; },
  }, extra || {});
}

// ── Selectors: compound parts joined by descendant or child combinators ─────
// Enough for what the surfaces ask: tag, #id, .class, [attr], [attr="v"].
function parseCompound(s) {
  const out = { tag: null, id: null, classes: [], attrs: [] };
  const re = /^([a-zA-Z*][\w-]*)|#([\w-]+)|\.([\w-]+)|\[([\w-]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\]]*)))?\]/g;
  let m;
  let consumed = 0;
  while ((m = re.exec(s))) {
    if (m.index !== consumed) break;
    consumed = re.lastIndex;
    if (m[1]) out.tag = m[1] === '*' ? null : m[1].toUpperCase();
    else if (m[2]) out.id = m[2];
    else if (m[3]) out.classes.push(m[3]);
    else if (m[4]) out.attrs.push({ name: m[4], value: m[5] !== undefined ? m[5] : m[6] !== undefined ? m[6] : m[7] });
  }
  if (consumed !== s.length) throw new Error(`fake-dom: unsupported selector part "${s}"`);
  return out;
}

function parseSelector(sel) {
  return String(sel).split(',').map((one) => {
    const parts = [];
    const tokens = one.trim().replace(/\s*>\s*/g, ' > ').split(/\s+/).filter(Boolean);
    let combinator = ' ';
    for (const t of tokens) {
      if (t === '>') { combinator = '>'; continue; }
      parts.push({ combinator, compound: parseCompound(t) });
      combinator = ' ';
    }
    return parts;
  });
}

function matchCompound(el, c) {
  if (!el || el.nodeType !== 1) return false;
  if (c.tag && el.tagName !== c.tag) return false;
  if (c.id && el.id !== c.id) return false;
  for (const k of c.classes) if (!el._classes.includes(k)) return false;
  for (const a of c.attrs) {
    const v = el.getAttribute(a.name);
    if (v === null) return false;
    if (a.value !== undefined && v !== a.value) return false;
  }
  return true;
}

function matchComplex(el, parts, i = parts.length - 1) {
  if (!matchCompound(el, parts[i].compound)) return false;
  if (i === 0) return true;
  const how = parts[i].combinator;
  if (how === '>') return matchComplex(el.parentNode, parts, i - 1);
  for (let up = el.parentNode; up && up.nodeType === 1; up = up.parentNode) {
    if (matchComplex(up, parts, i - 1)) return true;
  }
  return false;
}

function queryAll(root, sel) {
  const list = parseSelector(sel);
  const out = [];
  const walk = (n) => {
    for (const c of n.childNodes) {
      if (c.nodeType !== 1) continue;
      if (list.some((parts) => matchComplex(c, parts))) out.push(c);
      walk(c);
    }
  };
  walk(root);
  return out;
}

// ── A tolerant HTML parser, for the app's own well formed markup ────────────
function parseInto(doc, html) {
  const top = new Element(doc, '#fragment');
  const stack = [top];
  const src = String(html).replace(/<!--[\s\S]*?-->/g, '').replace(/<!doctype[^>]*>/gi, '');
  const re = /<\/([a-zA-Z][\w:-]*)\s*>|<([a-zA-Z][\w:-]*)((?:\s+[^\s"'>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*(\/?)>|([^<]+)|(<)/g;
  let m;
  while ((m = re.exec(src))) {
    const cur = stack[stack.length - 1];
    if (m[1]) {
      const tag = m[1].toUpperCase();
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i].tagName === tag) { stack.length = i; break; }
      }
    } else if (m[2]) {
      const el = new Element(doc, m[2]);
      const attrRe = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
      let a;
      while ((a = attrRe.exec(m[3] || ''))) {
        const v = a[2] !== undefined ? a[2] : a[3] !== undefined ? a[3] : a[4] !== undefined ? a[4] : '';
        el.setAttribute(a[1], decode(v));
      }
      cur.appendChild(el);
      const tag = m[2].toLowerCase();
      if (RAW.has(tag) && !m[4]) {
        const end = src.toLowerCase().indexOf(`</${tag}`, re.lastIndex);
        const stop = end === -1 ? src.length : end;
        const body = src.slice(re.lastIndex, stop);
        if (body) el.appendChild(new TextNode(body));
        re.lastIndex = stop;
      } else if (!VOID.has(tag) && !m[4]) {
        stack.push(el);
      }
    } else if (m[5] !== undefined) {
      cur.appendChild(new TextNode(decode(m[5])));
    } else if (m[6]) {
      cur.appendChild(new TextNode('<'));
    }
  }
  const nodes = top.childNodes.slice();
  for (const n of nodes) n.parentNode = null;
  return nodes;
}

class Document {
  constructor(html) {
    this.nodeType = 9;
    this.childNodes = [];
    this._listeners = {};
    this.fonts = { ready: Promise.resolve() };
    const nodes = parseInto(this, html);
    let root = nodes.find((n) => n.nodeType === 1 && n.tagName === 'HTML');
    if (!root) {
      // A fragment: hang it all off a root of its own so it can be queried.
      root = new Element(this, 'html');
      for (const n of nodes) root.appendChild(n);
    }
    this.documentElement = root;
    root.parentNode = this;
    this.childNodes = [root];
    this.head = this.documentElement.querySelector('head');
    this.body = this.documentElement.querySelector('body') || this.documentElement;
  }
  getElementById(id) { return this.documentElement.querySelector(`#${id}`) || (this.documentElement.id === id ? this.documentElement : null); }
  querySelector(sel) { return this.documentElement.matches(sel) ? this.documentElement : this.documentElement.querySelector(sel); }
  querySelectorAll(sel) { return (this.documentElement.matches(sel) ? [this.documentElement] : []).concat(this.documentElement.querySelectorAll(sel)); }
  createElement(tag) { return new Element(this, tag); }
  createElementNS(_ns, tag) { return new Element(this, tag); }
  createTextNode(t) { return new TextNode(t); }
  createRange() { return { selectNodeContents() {} }; }
  addEventListener(type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn); }
  removeEventListener(type, fn) { this._listeners[type] = (this._listeners[type] || []).filter((f) => f !== fn); }
}

// ── Time: timers and frames the test advances by hand ───────────────────────
function makeClock() {
  let now = 1000;
  let seq = 0;
  const timers = new Map();
  const frames = [];
  const clock = {
    now: () => now,
    setTimeout: (fn, ms) => { const id = ++seq; timers.set(id, { fn, due: now + (Number(ms) || 0), every: 0 }); return id; },
    setInterval: (fn, ms) => { const id = ++seq; timers.set(id, { fn, due: now + (Number(ms) || 0), every: Math.max(1, Number(ms) || 0) }); return id; },
    clearTimeout: (id) => { timers.delete(id); },
    clearInterval: (id) => { timers.delete(id); },
    requestAnimationFrame: (fn) => { frames.push(fn); return frames.length; },
    /** Run every timer due within the next `ms`, in order. Intervals fire once. */
    advance(ms) {
      now += ms;
      const due = [...timers.entries()].filter(([, t]) => t.due <= now).sort((a, b) => a[1].due - b[1].due);
      for (const [id, t] of due) {
        if (t.every) t.due = now + t.every; else timers.delete(id);
        t.fn();
      }
    },
    /** Every queued animation frame, run far in the future so a count up finishes at once. */
    flushFrames() {
      for (let guard = 0; frames.length && guard < 1000; guard++) frames.shift()(now + 1e9);
    },
  };
  return clock;
}

// ── The preload, with electron stood in for ─────────────────────────────────
/**
 * Require a real preload and return what it exposes, plus a way to push to
 * it. `handlers` answers ipcRenderer.invoke by channel; a channel without one
 * answers undefined, as a main process handler that returned nothing would.
 */
function loadPreload(name, handlers) {
  const file = path.join(PRELOAD, `${name}-preload.js`);
  const exposed = {};
  const listeners = {};
  const sent = [];
  const invoked = [];
  const fake = {
    contextBridge: { exposeInMainWorld: (key, api) => { exposed[key] = api; } },
    ipcRenderer: {
      invoke: (ch, ...args) => {
        invoked.push([ch, ...args]);
        const h = handlers && handlers[ch];
        return Promise.resolve().then(() => (h ? h(...args) : undefined));
      },
      send: (ch, ...args) => { sent.push([ch, ...args]); },
      on: (ch, h) => { (listeners[ch] = listeners[ch] || []).push(h); },
      removeListener: (ch, h) => { listeners[ch] = (listeners[ch] || []).filter((x) => x !== h); },
    },
  };
  const original = Module._load;
  Module._load = function (request, ...rest) {
    if (request === 'electron') return fake;
    return original.call(this, request, ...rest);
  };
  try {
    delete require.cache[require.resolve(file)];
    require(file);
  } finally {
    Module._load = original;
  }
  return {
    api: exposed.occlara,
    emit: (ch, data) => { for (const h of listeners[ch] || []) h({}, data); },
    listening: (ch) => (listeners[ch] || []).length,
    sent,
    invoked,
  };
}

// ── A surface: markup, preload and scripts together ─────────────────────────
/**
 * @param name     the folder under src/renderer
 * @param opts.handlers   invoke answers for the preload, by channel
 * @param opts.preload    false to run with no bridge, or a function given the
 *                        exposed api that returns the one the page should see
 * @param opts.window     extra globals for the page (AudioContext, location...)
 */
function loadSurface(name, opts) {
  const o = opts || {};
  const dir = path.join(RENDERER, name);
  const doc = new Document(fs.readFileSync(path.join(dir, 'index.html'), 'utf8'));
  const clock = makeClock();
  const bridge = o.preload === false ? null : loadPreload(name, o.handlers || {});
  const logs = [];

  const win = {
    document: doc,
    console: { log: (...a) => logs.push(a.join(' ')), warn: (...a) => logs.push(a.join(' ')), error: (...a) => logs.push(a.join(' ')) },
    setTimeout: clock.setTimeout,
    setInterval: clock.setInterval,
    clearTimeout: clock.clearTimeout,
    clearInterval: clock.clearInterval,
    requestAnimationFrame: clock.requestAnimationFrame,
    performance: { now: clock.now },
    location: { hash: '', search: '' },
    navigator: {},
    innerWidth: 1280,
    innerHeight: 800,
    localStorage: { _m: {}, getItem(k) { return k in this._m ? this._m[k] : null; }, setItem(k, v) { this._m[k] = String(v); }, removeItem(k) { delete this._m[k]; } },
    Image: class { constructor() { this.complete = true; this.naturalWidth = 0; } },
    fetch: () => Promise.reject(new Error('no network in a test')),
    queueMicrotask: (fn) => Promise.resolve().then(fn),
    URLSearchParams,
    _listeners: {},
    addEventListener(type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn); },
    removeEventListener(type, fn) { this._listeners[type] = (this._listeners[type] || []).filter((f) => f !== fn); },
    close() { this.closed = true; },
    getSelection: () => ({ removeAllRanges() {}, addRange() {} }),
  };
  win.window = win;
  if (bridge) win.occlara = typeof o.preload === 'function' ? o.preload(bridge.api) : bridge.api;
  Object.assign(win, o.window || {});
  vm.createContext(win);

  const scripts = doc.querySelectorAll('script').map((s) => s.getAttribute('src')).filter(Boolean);
  for (const src of scripts) {
    const file = path.resolve(dir, src);
    vm.runInContext(fs.readFileSync(file, 'utf8'), win, { filename: file });
  }

  return {
    window: win,
    document: doc,
    clock,
    bridge,
    logs,
    scripts,
    $: (id) => doc.getElementById(id),
    fire: (el, type, extra) => el.dispatchEvent(makeEvent(type, extra)),
  };
}

/** Let every pending promise in every context settle. */
const settle = async (n = 6) => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)); };

module.exports = { loadSurface, loadPreload, parseInto, Document, Element, settle, makeEvent };

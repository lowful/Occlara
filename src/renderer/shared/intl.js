/* Counts, dates and times as whole sentences, in the interface's language (8.8).
 *
 * Every count the app writes goes through plural(), and every date or time
 * through date(), time() or ago(), so no surface builds "1 of 1 recorded
 * matches" or "168h ago" by hand again. A message is ONE whole sentence per
 * plural category with a named {n} (and any other {name}) placeholder, never
 * words glued around a number, so a translation can move the number:
 *
 *   occlaraIntl.plural(n, { one: '{n} match recorded', other: '{n} matches recorded' })
 *   occlaraIntl.plural(n, { one: '{n} of {total} match', other: '{n} of {total} matches' }, { total })
 *   occlaraIntl.ago(review.at)        // "3 hours ago", "yesterday", then "12 Oct"
 *   occlaraIntl.date(at)              // "12 Oct", with the year when it is not this one
 *   occlaraIntl.time(at)              // "21:04" or "9:04 PM", as the language writes it
 *
 * The language is <html lang> (i18n-apply.js sets it), then the system's.
 * Numbers in a sentence are formatted for that language ("1,284"). A
 * category the message does not give falls back to `other`. Loaded as a
 * plain script (window.occlaraIntl) and as a module for the tests.
 */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.occlaraIntl = api;
})(typeof window !== 'undefined' ? window : globalThis, function (root) {
  'use strict';

  const DAY = 86400000;

  function lang() {
    try {
      const doc = root.document && root.document.documentElement;
      const l = doc && (doc.getAttribute ? doc.getAttribute('lang') : doc.lang);
      if (l) return l;
    } catch { /* no document */ }
    try { if (root.navigator && root.navigator.language) return root.navigator.language; } catch { /* none */ }
    return 'en';
  }

  // One formatter per language and options, made once.
  const cache = new Map();
  function fmt(kind, opts) {
    const l = lang();
    const key = kind + '|' + l + '|' + JSON.stringify(opts || {});
    if (!cache.has(key)) {
      let f;
      try { f = new Intl[kind](l, opts); } catch { f = new Intl[kind]('en', opts); }
      cache.set(key, f);
    }
    return cache.get(key);
  }

  /** A number written for the interface's language: 1284 is "1,284" in English. */
  function number(n, opts) { return fmt('NumberFormat', opts).format(n); }

  /** Fill {name} placeholders; {n} is the count, formatted. */
  function fill(message, values) {
    return String(message).replace(/\{(\w+)\}/g, (m, k) => {
      if (!(k in values)) return m;
      const v = values[k];
      return typeof v === 'number' ? number(v) : String(v);
    });
  }

  /**
   * The whole sentence for count n: messages holds one sentence per plural
   * category (zero, one, two, few, many, other), `other` required.
   */
  function plural(n, messages, values) {
    const cat = fmt('PluralRules').select(n);
    const msg = messages[cat] != null ? messages[cat] : messages.other;
    return fill(msg, Object.assign({}, values || {}, { n }));
  }

  const toDate = (at) => (at instanceof Date ? at : new Date(typeof at === 'number' ? at : Date.parse(at)));

  /** A short date: "12 Oct", with the year when it is not this year's. */
  function date(at, now) {
    const d = toDate(at);
    if (Number.isNaN(d.getTime())) return '';
    const sameYear = d.getFullYear() === toDate(now == null ? Date.now() : now).getFullYear();
    return fmt('DateTimeFormat', sameYear ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' }).format(d);
  }

  /** A time of day, as the language writes one. */
  function time(at) {
    const d = toDate(at);
    if (Number.isNaN(d.getTime())) return '';
    return fmt('DateTimeFormat', { hour: 'numeric', minute: '2-digit' }).format(d);
  }

  /**
   * How long ago, up to six days ("now", "4 minutes ago", "3 hours ago",
   * "yesterday", "5 days ago"), and from the seventh day the short date.
   */
  function ago(at, now) {
    const d = toDate(at);
    if (Number.isNaN(d.getTime())) return '';
    const t = now == null ? Date.now() : toDate(now).getTime();
    const ms = Math.max(0, t - d.getTime());
    const rtf = fmt('RelativeTimeFormat', { numeric: 'auto' });
    if (ms < 45000) return rtf.format(0, 'second');
    if (ms < 45 * 60000) return rtf.format(-Math.max(1, Math.round(ms / 60000)), 'minute');
    // Hours while it is still today; from yesterday on, calendar days.
    const startOf = (x) => { const c = new Date(x); c.setHours(0, 0, 0, 0); return c.getTime(); };
    const days = Math.round((startOf(t) - startOf(d.getTime())) / DAY);
    if (days === 0) return rtf.format(-Math.max(1, Math.round(ms / 3600000)), 'hour');
    if (days <= 6) return rtf.format(-days, 'day');
    return date(d, t);
  }

  return { lang, number, plural, date, time, ago };
});

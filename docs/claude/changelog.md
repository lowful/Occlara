# The changelog, What's new and the Discord

One source of truth for what changed in each version, read in four places: the
app's What's new page, Home's update line, `GET /api/changelog` (the website's
changelog page reads it) and the Discord post a release makes.

## The source and its copies

`changelog/changelog.json` at the repo root is the only file anyone edits: an
array, newest first, of `{ version, date (YYYY-MM-DD), title, summary, items:
[{ kind: 'new' | 'improved' | 'fixed', text }] }`. Plain player language:
what a player would notice, nothing about internals, models' names or other
players, and every line true of the code at that version (check it).

`npm run sync:changelog` (`scripts/sync-changelog.js`) checks it and writes two
identical copies, like `sync:valorant`. Never hand edit either:

- `server/data/changelog.json`, served by `server/routes/changelog.js`
- `src/shared/changelog.generated.json`, bundled into the app

It fails closed, nothing written, on: a field missing or extra, a kind that is
not new, improved or fixed, a version not x.y.z, repeated or out of order
(strictly descending), a date that is no real day or later than the newer
version above it, an em or en dash or a semicolon anywhere, a summary that is
not one sentence under 140 characters, more than 12 items, a title over 80 or
an item over 300 characters.

`npm run check:changelog` (`scripts/check-changelog.js`, in `npm test`) holds
the source to those rules, both copies byte for byte to what the sync writes,
`package.json`'s version to having an entry and no entry newer than it, and the
validator itself to catching each broken rule on a known bad changelog. So a
version bump without its entry fails the suite: write the entry, sync, commit
the three files together.

## The server: GET /api/changelog

`server/routes/changelog.js`, mounted in `server.js` with one require and one
`app.use('/api/changelog', ...)` after the route limits, so the anonymous
limiter (per address, 300 a minute, `services/rate-limits.js routeLimits`)
covers it. No auth. Answers `{ version, entries }`, `version` the newest
entry's; `?since=x.y.z` gives only the entries strictly newer, a malformed
`since` is 400 `{ error: 'since' }`. `Cache-Control: public, max-age=300`,
`Access-Control-Allow-Origin: *`, and an OPTIONS answer of 204.

The global `cors()` in `server.js` runs before the route and still refuses a
browser Origin it does not list (occlara.app, its www, the Lovable previews
and localhost pass; no Origin, the app and curl pass). Opening it to every
site needs the router mounted before `cors()` (and so before the limiters) or
a change to the cors check; neither is done. `npm run test:changelog` runs it
over real http, the limiter in front included.

## The app: What's new

A page of the main window (`src/renderer/whatsnew/`, `whatsnew-preload.js`,
shell-nav `whatsnew`, `nav: false`), one step deeper than Settings, the
sidebar marking Settings while it shows. Reached from Settings' row "What's
new in Occlara", from the version line at the foot of Settings (Check for
updates is now its own word beside it) and from Home's update line. Locked
by the seal like every page (`check:seal`).

It paints the bundled copy at once (the preload's `bundled()`, checked by
`src/shared/changelog.js clean`), the running version (package.json, read by
the preload) marked "Your version", then asks main for `CHANGELOG_REFRESH`:
`src/main/ipc/community.js refresh` GETs `SERVER_BASE_URL + API.CHANGELOG`,
4 s at most, aborted after, null on any failure, and only well formed entries
pass `clean` (no dash, no semicolon, a real version and day, known kinds,
known fields). A different answer repaints without a second entrance; a null
changes nothing, silently. Every word is set as text.

The look: each version a ruled section (the version in the mono face, its
day, the title, one sentence), the newest the page's hero at 32px with no
rule over it, the items as rows parted by the hairline with the kind a small
word in its own column. Ink only, never the signal or an outcome colour.
Entries rise once on the first paint; reduced motion drops it.

## Home's update line

`src/shared/changelog.js noticeFor`, run once at launch by `index.js
changelogIpc.start()` against the store key `changelogSeenVersion`:

- the first launch ever (onboarding never completed, no key) says nothing and
  stores the version installed
- an install that finished onboarding but has no key (from before the
  changelog) or a key older than the running version, on a version the
  changelog has an entry for, gets "Occlara updated to X." with "See what's
  new" at the right of Home's title
- the same or a newer key, or no entry for the running version, says nothing

Never a modal and never mid match: `CHANGELOG_NOTICE` answers null while
recording, mid match or sealed, and the line is pushed (`PUSH_CHANGELOG`)
once from `flushAccountWaits`, the same wait as the cap's notice. Home tells
main it was seen (`CHANGELOG_SEEN`) only once the page is on screen
(`occlaraOnShown`), which stores the version, so the next launch is quiet.
Opening What's new stores it too and takes the line away at once (a null
push). `check:mainwindow` boots as an update and reads it.

## The Discord

`src/shared/config.js DISCORD_URL` (`https://discord.gg/JYmXhvDkG9`) is the one
place the invite is written. Two ways in, both asking main over
`DISCORD_OPEN` with that URL: the icon at the end of Settings' row in the
sidebar's foot (`#discord`, tooltip "Join the Occlara Discord", locked and
drawn as the lock by `paintNav` mid match), Settings' row "Community" with
Join the Discord. `community.js openDiscord` opens it through
`shell.openExternal` only when the URL is exactly `DISCORD_URL` (else
`{ ok: false, error: 'url' }`) and never mid match or sealed (`'match'`).
`npm run test:communityipc` holds both, the near misses included.

The mark is the plain Discord shape as one path in `currentColor`, the rows'
icon colour, no Discord artwork beyond it.

## The Discord post at release

`scripts/post-changelog.js`, the last step of `npm run release` after
`publish-download.js` (also `npm run post:changelog`, `--version x.y.z`,
`--dry` prints the payload and sends nothing). It POSTs one embed for
package.json's version to the webhook in env `DISCORD_WEBHOOK_URL`: title
"Occlara X", linked to `https://occlara.app/changelog`, the summary as its
description, the items as New, Improved and Fixed fields of bullet lines, the
dark ground as its colour, footer "occlara.app", `allowed_mentions: { parse:
[] }`. Discord's limits are kept (title 256, description 4096, a field 1024,
25 fields, 6000 in all; what does not fit ends in a More field).

The webhook URL is a secret: env only, never committed, never printed, and
scrubbed from any error. Unset, it prints "no Discord webhook set, skipping".
Nothing it meets fails a release: a bad URL, no entry, a network error or a
refusal is one calm line and exit 0. `test:changelog` holds the payload, the
limits, the skip and the swallowed failures with a fake fetch.

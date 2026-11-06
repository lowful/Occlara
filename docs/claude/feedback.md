# Report a problem

A player tells us what went wrong, in their own words, with up to three
pictures, and the report lands where the owner, or a Claude agent, can read
it, look at the pictures, reproduce it, fix it in this repo and mark it.

## The button and the page

The sidebar's foot: Invite, then Profile with **Report a problem** at the end
of its row, then Settings with the Discord at the end of its row. So the flag
icon (`#nav-feedback`, `.foot-icon`, tooltip "Report a problem") sits directly
above the Discord icon. In `shell.css` the foot is a two column grid: Profile
and Settings take column 1, every `.foot-icon` column 2, and the markup order
is invite, profile, nav-feedback, settings, discord. `check:mainwindow`
measures it on the real layout (same row as Profile, same column and width
as the Discord, right above it).

It is a page like the others: shell-nav `feedback` (`nav: false`, after
What's new, before the review), in `navButtons`, so `paintNav` locks it mid
match, draws it as the lock with "Locked until the match ends", and marks it
`aria-current` on its own page. Held after a stop it is open like the rest.

`src/renderer/feedback/` (index.html, feedback.js, feedback.css, held to
tokens), `src/preload/feedback-preload.js`. Top to bottom: the hero "What
went wrong?"; Kind as an `occlaraSeg` capsule (Something broke, Wrong
coaching, Idea, ids `broke`, `coaching`, `idea`); What happened, a textarea,
10 to 4000 characters, with a mono count; Pictures, up to 3, by the picker
(png, jpg, webp, several at once), a paste anywhere on the page, or a drop
anywhere on it (the dashed drop target goes solid while pictures are held
over the page), each a framed thumbnail with Remove; Your last review, its
line ("Your last match, Abyss as Jett") and Attach it or Leave it out
(default out), shown only when the library has one; What is sent, main's
sentence, the facts line (version, Windows, game) and a `<details>` "What is
never sent"; Send report. Sent, a calm thank you with the report's first 8
characters, Send another and Back to Home. With no account and no key, the
page says to sign in and Send stays shut.

Every sentence the page says for an answer is `src/shared/feedback.js SAID`,
handed over by main (`info().said`, each answer's `said`). No dash, no
semicolon (`test:feedback`).

## Main: services/feedback-service.js

Built in `index.js` (`feedbackIpc`, `busy: matchInProgress() ||
windowSealed()`), handed to `register-ipc.js`:

- `FEEDBACK_INFO` `() -> { version, os, game, gameLabel, review, signedIn,
  limits, kinds, whatIsSent, neverSent, said }`, null mid match or sealed.
  `signedIn` is the account view's `via` (a session or a key), as Invite reads it.
- `FEEDBACK_PREPARE` `({ type, size, bytes })`: PNG, JPEG or WebP, at most
  5 MB, the bytes really PNG or JPEG, read by Electron's `nativeImage`,
  downscaled to at most 1600 px on the long side (`quality: 'good'`),
  recompressed to JPEG 85 (70 if still over 2 MB), held in main under a
  random token (9 at most). The page gets `{ token, width, height, bytes,
  preview }`, the preview a 160 px JPEG data URL. A WebP is drawn to PNG by
  the page first (canvas, at most 1600 px), since nativeImage reads PNG and
  JPEG only. `check:seal` runs it on a real 3200 by 1800 PNG: 1600 by 900.
- `FEEDBACK_DROP` `(token)`: a held picture let go.
- `FEEDBACK_SEND` `({ kind, text, tokens, withReview })`: checked again,
  the words scrubbed (`feedback.js scrubText`: the stored Riot ID, as stored
  and as "name #tag", becomes "my Riot ID", the account's email "my email",
  any licence key shape "my licence key", any other email "an email"), the
  last review's id only when Attach it is chosen, POSTed with
  `account.auth()` (session bearer, else the key) to `/api/feedback`, 30 s.
  Busy is asked again right before the POST. Answers `{ ok, id, said }` or
  `{ ok: false, error, said }`, error one of match, kind, short, long, many,
  image, size, auth (401, 403), busy (429), later (503 and the rest),
  invalid (400), unreachable (a throw).

Every one refuses mid match or sealed (`match`), and the seal hides the page.

## The server

`server/routes/feedback.js`, `server/services/feedback.js`, mounted in
`server.js`: `express.json({ limit: '9mb' })` on `/api/feedback` before the
global parser, `/api/feedback` in `IDENTIFIED` (identifyFirst names the
caller), `app.use('/api/feedback', createRouter())` and
`app.use('/api/admin/feedback', createAdminRouter())` before the admin router.

`POST /api/feedback`: a caller from the caller resolution (session, site
token or licence key), else 401, an outage 503. Then the two limiters of
`rate-limits.js feedbackLimits`, keyed by the caller's account: 5 an hour
and 20 a day (429 with Retry-After). Then `validate`: kind on the list,
text cleaned (`cleanText`: control characters but newline and tab, bidi
overrides, zero width marks and every `<` and `>` taken out, by a char code
loop, not a regex) to 10 to 4000 characters, version `x.y.z`, os one line of
80, game valorant, lol or null, review id `[A-Za-z0-9_-]{1,64}` or null, at
most 3 images each `{ type: 'image/jpeg', data }` in base64 whose bytes
start as a JPEG, 2 MB at most. 400 names the field. A body over 9 MB is 413.

The row goes in `feedback_reports` with a server made uuid: `account_id`
(`u:<user id>`, or `k:` and 16 hex of the key's sha256, never the key),
kind, text, app_version, os, game, review_id, status `new`, pictures count.
Then each picture to the private bucket `feedback` at `<id>/<n>.jpg`. A
bucket upload that fails takes the row back out, so no report is half kept.
201 `{ ok, id }`, then the ping, never holding the answer.

**Not live**: a missing table (42P01, PGRST205) or bucket ("Bucket not
found") is `notLive`: 503 `{ error: 'feedback-not-live', said: 'Reports
cannot be taken right now. Try again later.' }`. Any other failure is 503
`feedback-failed` with the same sentence. The store is required lazily, so
the server starts without the SQL or even Supabase env.

**The ping**: env `FEEDBACK_WEBHOOK_URL`, optional, unset is skipped
silently, https only. A Discord message with the kind, `Occlara <version>`,
the game, the picture count, the first 300 characters quoted and the report
id, `allowed_mentions: { parse: [] }`, `flags: 4` (no link preview), 5 s at
most. The URL is never logged: every error goes through `scrub`, which takes
out the URL and any `/api/webhooks/...` path.

## The SQL

One file, applied by hand in the owner's Supabase (kept outside the repo,
like `gifts.sql`): `feedback_reports` created if not exists, its checks
dropped and added again (kinds, statuses new, triaged, fixed, wontfix, text
1 to 4000, pictures 0 to 3), two indexes, `REVOKE ALL` from PUBLIC, anon and
authenticated and `GRANT ALL` to service_role BEFORE `ENABLE ROW LEVEL
SECURITY` (the Lovable tool refuses the other order), no policy, no foreign
key to auth.users. The bucket: `insert into storage.buckets (id, name,
public, file_size_limit, allowed_mime_types) values ('feedback', 'feedback',
false, 2097152, array['image/jpeg']) on conflict (id) do nothing`, then held
private. No storage policy: the service role alone. `test:feedback` reads it
when `OCCLARA_FEEDBACK_SQL` names its path.

## Triage: npm run feedback

`scripts/feedback-inbox.js`, for the owner and for an agent. It talks to the
admin routes with `ADMIN_PASSWORD` (env, or `server/.env`), never the
Supabase service key, and `OCCLARA_SERVER` points it at another server.

- `npm run feedback` lists the new reports, one line each, and writes each to
  `feedback-inbox/<id>/`: `report.json`, `report.txt` (the words, to read)
  and its pictures `1.jpg` to `3.jpg` from 15 minute signed URLs.
  `--status triaged|fixed|wontfix|all`, `--limit N` (1 to 200),
  `--no-pictures`, `--json`.
- `npm run feedback -- --mark <id> <status> [note words]` sets the status
  and the note.

`feedback-inbox/` is gitignored: reports hold player data and this repo is
public. An agent's loop: `npm run feedback`, read `report.txt`, look at the
pictures, `--mark <id> triaged`, reproduce and fix in the repo, then
`--mark <id> fixed "what was fixed, in which version"`.

`GET /api/admin/feedback?status=new&limit=50` and `POST
/api/admin/feedback/:id { status, note }` (X-Admin-Password, the admin
limiter in front) are the two routes.

## Tests

`npm run test:feedback` (`scripts/test-feedback.js`): the two copies of the
numbers, validation and cleaning, the route over real http with a fake store
(auth, outage, the cap, the limits, missing table and bucket), the ping and
its scrubbing, the admin routes and the triage script against them, main's
service with a fake nativeImage (downscale, recompress, refusals, scrubbing,
the review only when attached, the seal), the page in the fake DOM (kind,
words, drop, paste, the three picture cap, Remove, Send, the thank you, the
refusals, no account), the preload, the channels and the shell's foot.
`check:seal` asks for the page and its four channels mid match through the
real index.js and prepares a real picture after it. `test:surfaces` and
`test:shellnav` hold the button and the page entry. `OCCLARA_SHOTS=1 npm run
check:mainwindow` writes `main-feedback.png`, `main-feedback-filled.png` and
`main-feedback-foot.png`.

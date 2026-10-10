# Occlara 8.1: One Window Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the separate panel, review, matches, settings, stats and chat windows with one main window: a sidebar (game, pages, the record control) and the pages beside it, following the approved mockups (https://claude.ai/artifact/4fu1kWQTWhkkBgmTxuNWAn).

**Architecture:** One frameless `BrowserWindow` ("main") whose own document is a new `shell` surface: the sidebar, a 40px top strip (drag area and window controls) and the sealed Recording screen. Every page is a `WebContentsView` laid over the content area, loading an EXISTING surface (matches, review, settings, stats, chat) with its own preload, plus one new surface (home). Views are created on first visit and kept alive, so a page keeps its scroll, its chat and its state. A pure navigation state machine decides which view shows; while a match is in progress the window is sealed: no page view shows and the shell paints the Recording screen.

**Tech Stack:** Electron 41 (`WebContentsView`, `BaseWindow.contentView`), vanilla HTML/CSS/JS, no build step, Node test scripts, Electron boot checks.

## Global Constraints

- No framework, no bundler, no TypeScript. Plain DOM and CSS (CLAUDE.md, Rules for UI work).
- Design tokens from `src/renderer/shared/theme.css` only; no hardcoded colours, radii, easings or durations in new CSS.
- Geist weights 400, 500, 600, 700, 800 and Geist Mono 400, 500 only. No webfont URL (CSP).
- No decorative gradients. The Start button stays red. A grade's colour is never its only signal.
- Every IPC channel name lives in `src/shared/channels.js`; never hand-type one elsewhere.
- Nothing reaches the screen during a match: a sealed window shows no page, and the review never opens over a match in progress.
- textContent only for anything that can carry a model's sentence.
- No em dashes or en dashes anywhere, code comments, copy and commit messages included.
- Never write a regex through a shell heredoc; edit regexes with a file tool and assert each one matches a known positive.
- `env -u ELECTRON_RUN_AS_NODE` for every Electron run from this shell.
- Separate windows stay separate: onboarding, activation, splash, dock, weekly, AI log, learn.
- `appId`, the releases repo name and the Railway host do not change.

---

## File structure

```
src/shared/shell-nav.js            pure: page table and the navigation/seal state machine
src/shared/home-model.js           pure: Home's figures from the library index and the patterns
src/main/windows/main-window.js    the main BrowserWindow, its page views, layout, seal
src/main/windows/registry.js       (modify) registers views as well as windows
src/preload/shell-preload.js       the shell's bridge: record controls, navigation, window controls
src/preload/home-preload.js        Home's bridge: reviews, patterns, state, navigation
src/renderer/shell/                index.html, shell.css, shell.js (sidebar, top strip, Recording screen)
src/renderer/home/                 index.html, home.css, home.js
src/renderer/shared/embed.js       sets html.embedded and data-section from the page's query
src/renderer/{matches,review,settings,stats,chat}/  (modify) embedded styles; matches gains sections
src/main/index.js                  (modify) main window replaces the panel; opens become pages; seal
src/main/tray.js, hotkeys.js       (modify) labels and the show/hide action
src/main/windows/panel-window.js   (delete) with src/renderer/panel/ and src/preload/panel-preload.js
scripts/test-shell-nav.js          node test for shell-nav.js
scripts/test-home-model.js         node test for home-model.js on the real fixture
scripts/check-main-window.js       boots the app: pages, views, seal, review routing
scripts/fixtures/surfaces.js       finds a surface by URL among windows AND views (boot checks)
```

---

### Task 1: The navigation state machine and the page table

**Files:**
- Create: `src/shared/shell-nav.js`
- Test: `scripts/test-shell-nav.js`, add `"test:shellnav"` to package.json and to the `npm test` list

**Interfaces:**
- Produces: `PAGES` (ordered array of `{ id, label, surface, query, preload, nav }`), `pageOf(id)`, `createNav({ home })` returning `{ go(id), seal(on), state() }` where `state()` is `{ page, shown, sealed }`: `page` the page the player is on (or will be on once unsealed), `shown` the page whose view is visible (`null` while sealed).

- [x] **Step 1: Write the failing test** (`scripts/test-shell-nav.js`): `go('matches')` shows matches; `seal(true)` hides every view (`shown === null`) and `go('review')` while sealed only moves `page`; `seal(false)` shows `review`; an unknown id is ignored; `PAGES` ids are unique and each `surface` exists under `src/renderer/`.
- [x] **Step 2: Run** `node scripts/test-shell-nav.js`, expect a require failure.
- [x] **Step 3: Implement** `shell-nav.js` (pure, no Electron):

```js
const PAGES = [
  { id: 'home', label: 'Home', surface: 'home', query: {}, preload: 'home-preload.js', nav: true },
  { id: 'matches', label: 'Matches', surface: 'matches', query: { section: 'list' }, preload: 'matches-preload.js', nav: true },
  { id: 'patterns', label: 'Patterns', surface: 'matches', query: { section: 'patterns' }, preload: 'matches-preload.js', nav: true },
  { id: 'breakdown', label: 'Breakdown', surface: 'matches', query: { section: 'breakdown' }, preload: 'matches-preload.js', nav: true },
  { id: 'stats', label: 'Stats', surface: 'stats', query: {}, preload: 'stats-preload.js', nav: true },
  { id: 'coach', label: 'Ask Coach', surface: 'chat', query: {}, preload: 'chat-preload.js', nav: true },
  { id: 'settings', label: 'Settings', surface: 'settings', query: {}, preload: 'settings-preload.js', nav: false },
  { id: 'review', label: 'Review', surface: 'review', query: {}, preload: 'review-preload.js', nav: false },
];
function pageOf(id) { return PAGES.find((p) => p.id === id) || null; }
function createNav({ home = 'home' } = {}) {
  let page = home, sealed = false;
  return {
    go(id) { if (pageOf(id)) page = id; return this.state(); },
    seal(on) { sealed = !!on; return this.state(); },
    state() { return { page, shown: sealed ? null : page, sealed }; },
  };
}
module.exports = { PAGES, pageOf, createNav };
```

- [x] **Step 4: Run** the test, expect PASS.
- [x] **Step 5: Commit** `feat: the page table and the navigation state for one window`.

### Task 2: Home's figures

**Files:**
- Create: `src/shared/home-model.js`
- Test: `scripts/test-home-model.js` (`"test:homemodel"`)

**Interfaces:**
- Consumes: the library index rows (`reviewStore.list(game)`: `{ id, at, game, title, result, score, grade: { score, letter, provisional }, topMistake, map, mode, verified, source }`) and `patterns.build(...)` output for the game (`mistakes[0]`, `trend`, `average`).
- Produces: `homeModel({ rows, patterns, review })` returning `{ last: { id, title, result, score, map, mode, at, grade, verified, source } | null, focus: string | null, top: { title, what, fix, trend } | null, trend: [{ id, score, map }] (oldest first, at most 5), average: number | null, recent: rows.slice(0, 5) }`. `focus` is the newest review's next match line when it has one, else null. Nothing is invented: every field is read from what it is given, null when absent.

- [x] **Step 1: Write the failing test** on the real Abyss fixture review built as `scripts/test-grade.js` builds it: `last.title`, `last.grade.score`, `trend` order and cap, `average` only with two graded matches, `top` from the first pattern mistake, everything null on an empty library.
- [x] **Step 2: Run** it, expect a require failure.
- [x] **Step 3: Implement** `home-model.js` reading only those fields.
- [x] **Step 4: Run**, expect PASS.
- [x] **Step 5: Commit** `feat: Home's figures, read from the library`.

### Task 3: The registry holds views

**Files:**
- Modify: `src/main/windows/registry.js`
- Test: extend `scripts/test-shell-nav.js` with a fake window and a fake view

**Interfaces:**
- Produces: `register(name, target)` accepts a `BrowserWindow` or a `WebContentsView` (anything with `webContents`); a view unregisters on `webContents` `destroyed`. `get(name)` returns the target; `sendTo` and `broadcast` reach views.

- [x] Steps: failing test with fakes (`{ webContents: { send, on, isDestroyed } }`), implement `isDead()` and the `destroyed` hook, run, commit `feat: the registry reaches page views`.

### Task 4: Embedded surfaces

**Files:**
- Create: `src/renderer/shared/embed.js`
- Modify: each of `matches`, `review`, `settings`, `stats`, `chat`: `index.html` (load `embed.js` first), `.css` (`html.embedded` rules), `.js` (no close on Escape or the close button when embedded)
- Modify: `src/renderer/matches/matches.js`, `index.html`: `data-section` shows one of `list`, `patterns`, `breakdown`

**Interfaces:**
- Produces: `html.embedded` set when the query has `embed=1`; `html[data-section]` from `section`. Embedded: no transparent gutter, no glass card, no close button, no drag region; the surface fills its view on `--bg`.

- [x] Steps: add a DOM assertion to `check:matches` (Task 7) for the section split; implement; run the existing checks; commit `feat: every page surface can be embedded`.

### Task 5: The shell and Home surfaces

**Files:**
- Create: `src/renderer/shell/{index.html,shell.css,shell.js}`, `src/preload/shell-preload.js`
- Create: `src/renderer/home/{index.html,home.css,home.js}`, `src/preload/home-preload.js`
- Modify: `src/shared/channels.js`: `SHELL_NAV` (send, page id), `SHELL_WINDOW` (send, 'minimize' | 'maximize' | 'close'), `SHELL_GET` (invoke, `{ page, sealed }`), `PUSH_SHELL` (`{ page, sealed }`), added to `PUSH_LIST`

**Interfaces:**
- Consumes: `PAGES` (Task 1), the panel's commands (`COACH_START`, `COACH_STOP`, `COACH_PAUSE`, `AGENT_CONFIRM`, `AGENT_SET`, `STATE_GET`, `CONFIG_GET`, `CONFIG_SET`, `APP_QUIT`, `OPEN_LEARN`), pushes `PUSH_STATE`, `PUSH_STATUS`, `PUSH_AGENT`, `PUSH_NUDGE`, `PUSH_GAME`, `PUSH_SHELL`.
- Produces: the sidebar (brand, game switcher built from `games.list`, the nav from `PAGES` where `nav`, Learn for League, the record card: status, Start/Stop, Pause, the agent check, the notice line, Settings, the Riot ID line), the top strip with window controls, the Recording screen shown while `sealed`. Sounds on start and stop move here from the panel, with the same rule.

- [x] Steps: build both surfaces to the mockups, port the panel's agent check, notice line and sounds verbatim in behaviour, `check:dom` passes, commit `feat: the shell and Home`.

### Task 6: The main window replaces the panel

**Files:**
- Create: `src/main/windows/main-window.js`
- Modify: `src/main/index.js`, `src/main/ipc/register-ipc.js`, `src/main/tray.js`, `src/main/hotkeys.js` (action name kept), `src/main/windows/dock-window.js` (anchor)
- Delete: `src/main/windows/panel-window.js`, `src/renderer/panel/`, `src/preload/panel-preload.js`

**Interfaces:**
- Consumes: `createNav`, `pageOf`, registry.
- Produces: `mainWindow.create({ deferShow })`, `get()`, `reveal()`, `show(page, { focus })`, `current()`, `setSealed(on)`, `toggleHidden()`, `reloadPage(id)`. Every former open (`openSettings`, `openHistory`, `openReview`, `REVIEW_OPEN`, `openChat`, `openStats`) shows a page; the review after a match shows the review page, never while sealed; Ask Coach on a different match reloads the coach page; the seal follows `matchInProgress()` on every state push and on a two second tick while recording; Ctrl+Shift+M and the tray hide and show the window, with the dock while hidden and recording; a second instance focuses it; the splash hands over to it.

- [x] Steps: implement, boot with `npm run dev` and read `debug.log`, run every boot check, commit `feat: one window replaces the panel and the page windows`.

### Task 7: Boot checks find views

**Files:**
- Create: `scripts/fixtures/surfaces.js` (`find(part)` over `webContents.getAllWebContents()`, returning `{ webContents }`)
- Create: `scripts/check-main-window.js` (`"check:mainwindow"`)
- Modify: `check-matches-window.js`, `check-rivals-review-window.js`, `check-lol-review-window.js`, `check-game-switch.js`, `check-onboarding-riot.js`, `shot-surface.js`

**Interfaces:**
- `check:mainwindow` boots the app with saved reviews: Home paints the last match, every nav page loads its surface in a view, the seal hides every view and paints the Recording screen, unsealing returns to the page, a review opened from Matches shows the review page.

- [x] Steps: write the check first against Task 6, run it, fix what it finds, run `npm test`, commit `test: the boot checks follow pages into views`.

### Task 8: Docs and release

- [x] CLAUDE.md: the UI list (shell, home, pages as views, panel gone), the IPC list, the separate windows that stay.
- [x] Screenshots of every page through `shot-surface.js`, looked at.
- [ ] Version 8.1.0, commit `release 8.1.0`, push, `npm run release`, verify `latest.yml` and both download names.

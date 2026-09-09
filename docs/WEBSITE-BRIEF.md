# Lovable prompt: the Occlara product section

Paste everything below the line into Lovable. It is written to be acted on
directly. There is a live reference page built from the app's real CSS, so
anything ambiguous here can be settled by looking at that instead of guessing.

None of this repo's files go into the website repo. This is a description.

---

Build a product section for **Occlara**, a Valorant coaching overlay, and then
bring the rest of the site into line with it. Sections 1 to 4 are the new work,
section 5 is the sweep, and the sweep is not optional. Stack is the one this
project already uses: Vite, React, TypeScript, Tailwind, shadcn.

## What Occlara is, in one paragraph

It watches the screen while you play, the way OBS does, and writes a short
coaching tip every few seconds. Then it checks each tip against what it can
actually prove and throws away everything it cannot stand behind. It never reads
game memory, never touches game files, never automates input. After the match it
shows every death and whether it had anything to say about each one.

## What this section has to land

The differentiator is not "AI tips appear over your game". Every competitor has
that. It is that **the coach refuses most of what it writes**. Do not soften that
into a feature bullet. It is the spine of the section: show tips arriving, show
the refusals piling up beside them struck through, then show the post-match log
admitting which deaths it stayed quiet on.

Show the refusal, never the machinery behind it. The count and the strike-through
are the claim; an internal rule name printed next to a tip is engineering
vocabulary leaking onto a sales page, and it reads as an error log rather than as
restraint. The line that closes the section is "Most coaching tools are judged on
what they say. This one is worth judging on what it will not."

Three beats, in this order:

1. **The overlay running**, with a live ledger of refused tips beside it.
2. **The agent icon**, and why only two of its three states get a colour.
3. **The death log**, including the window the camera never saw.

## Design tokens

Use these exactly. They are the app's own values, so the site and the product
cannot drift apart.

```
--bg          #08090A     page ground
--text        #F5F5F7
--text-dim    #A1A1A6     body copy on dark
--text-mute   #808086     captions only, never body copy
--red         #FF4655     the one accent, rgb 255,70,85
--good        #52C88A     proven ally, positive state, rgb 82,200,138
--warn        #D9A441     "the coach said nothing here"
--glass-border rgba(255,255,255,0.09)   every hairline
radii          8 / 12 / 16
easing         cubic-bezier(0.16, 1, 0.30, 1)    exponential ease out
```

**Type**: Geist for everything, Geist Mono for digits, timestamps, offsets, and
anything that lines up in a column. Both are on Google Fonts. Weights 400 to 800
only, never one outside that set.

**Headings** need an explicit `line-height` near 1.1. Inheriting a body 1.6 at
34px pulls the two lines so far apart they read as separate sentences. This went
wrong once already.

## Rules that keep getting broken

- **No decorative gradients.** Solid fills and hairline borders. The only
  gradient is the simulated game frame behind the tip cards, standing in for a
  photograph, plus the hatched fill on the unseen-window slot.
- **Red is spent in one place at a time.** It is the accent, the enemy glow, and
  the refusal count. It is not a heading colour or a border on every card.
- **Dark only.** Paint every colour explicitly so it holds whatever theme the
  visitor's browser is in. Do not build a light variant.
- **No em dashes or en dashes anywhere.** Commas. This is a hard rule.
- **No kicker or eyebrow labels above headings.** The heading carries itself.

## 1. Tip card

```
background   rgba(0, 0, 0, 0.90)
border       1px solid --glass-border
radius       13px
backdrop     blur(14px) saturate(150%)
shadow       0 8px 26px rgba(0,0,0,0.55)
body         13.5px / 1.5
width        348px
```

A meta row above the text: a 6px round dot, then an uppercase 10px label at
0.09em letter-spacing in `--text-mute`. The dot is `--red` normally. For a death
review the dot and the label are `--text` and the label reads **DEATH REVIEW**.

**Motion.** Cards arrive one at a time, roughly 2.6s apart. Entrance is 420ms on
the exponential ease: `opacity 0 to 1`, `translateY(20px) to 0`,
`scale(0.97) to 1`, `blur(3px) to none`. Keep at most two on screen. The first
card and several refusals must be present in the **first painted frame** so the
page is never an empty shell waiting on a timer.

## 2. The refusal ledger

A panel beside the game frame, same height. Header reads "Refused" with a
running count in `--red`, mono, tabular numerals. Each row is the withheld tip
in `--text-mute` at 12px with a **line-through** in `rgba(255,70,85,0.6)`,
clamped to two lines. Rows enter with a 460ms slide from the right. Keep four.

**Do not print the internal reason.** The rule names the coach uses are
engineering vocabulary and mean nothing to a player. The point that lands is the
count and the strike-through: it wrote these and decided not to show you.
Footer: "Every line here was written by the coach and stopped before it reached
the screen, because it could not stand behind it."

Real withheld tips to use, verbatim:

- You died holding A Nest alone after your teammate traded, so next time wait for a trade partner.
- You died to a close-range pistol while holding a wide angle with no cover.
- You died holding A Rafters alone with no crossfire, so next round find a partner.
- Set up a crossfire on A site with your Killjoy so any entry gets traded.

## 3. The agent icon

An agent's name is replaced by that agent's portrait. **The name is never lost**:
it moves to `title` and `aria-label`.

**There is no box.** No background, no border, no border-radius, no pill, no
circle, no container of any kind. The PNG sits inline in the sentence and the
colour is a **glow that follows the character's own silhouette**, made with
stacked `drop-shadow` filters on the image itself.

```css
.agent {                       /* the wrapper does nothing but size it */
  display: inline-block;
  width: 1.62em; height: 1.62em;
  vertical-align: -0.34em;
  margin: 0 0.1em;
  background: none; border: 0; border-radius: 0; box-shadow: none;
  overflow: visible;
}
.agent img {
  width: 100%; height: 100%;
  object-fit: contain;         /* not cover: there is no box to crop against */
  display: block;
}

/* neutral, and the default */
.agent img { filter: drop-shadow(0 1px 2px rgba(0,0,0,0.9)); }

/* proven enemy */
.agent.enemy img {
  filter: drop-shadow(0 0 1px #FF4655)
          drop-shadow(0 0 3px rgba(255,70,85,0.9))
          drop-shadow(0 0 6px rgba(255,70,85,0.55));
}
/* proven ally */
.agent.ally img {
  filter: drop-shadow(0 0 1px #52C88A)
          drop-shadow(0 0 3px rgba(82,200,138,0.9))
          drop-shadow(0 0 6px rgba(82,200,138,0.55));
}
```

`drop-shadow` follows the alpha channel, which is why the art choice below is not
interchangeable and why this cannot be done with `box-shadow`.

**Use the SQUARE bust, not the kill feed crop.** From
`https://valorant-api.com/v1/agents?isPlayableCharacter=true`, field
`displayIcon`. It is 1024x1024 and about 410KB, so resample it to 64px before
shipping: 29 agents at full size is twelve megabytes to draw a mark twenty
pixels wide. Self-host, do not hotlink.

The reason is measurable, not taste. The bust's alpha is a real character
silhouette, roughly a quarter of the box genuinely transparent with notches down
the side, so the glow traces the agent. The kill feed crop's alpha is a near
rectangle, so the identical filter on it draws a glowing box. On the page draw
the bust at about `2.1em` square.

Three states, and only two are a colour:

| State | Glow | When |
|---|---|---|
| Proven enemy | red, as above | the sentence says this agent killed the player |
| Proven ally | green, as above | it is the player's own confirmed agent |
| Not provable | none, just the dark separation shadow | anything else |

**Do not colour the third state.** There is no team roster anywhere in the
product, so a green teammate who is actually an opponent would be believed and
be wrong. No glow is the honest answer and the copy should say so.

**No article in front of an agent name.** Write "Reyna is holding B Main", never
"a Reyna" and never "the Reyna". There is one of each agent in a match, so the
name was never doing work the picture cannot. When the name modifies an object
it keeps normal grammar: "a Sage wall" and "a Viper orb" are correct.

Show these three states as three real sentences, not as three feature cards:

- Proven enemy: `You died to a [Sage] wall you could not see through.`
- Proven ally: `Your [Iso] shield is up, so you win this trade if you take it now.`
- Not provable: `[Sage] is holding B Main, so wait for your team.`

Using the same agent twice, once glowing and once not, is the point.

## 4. The death log

A horizontal rail with one marker per death, positioned by
`frameIndex / totalFrames`. Markers are 21px circles with a small skull glyph,
`--bg` fill and a `--glass-border` ring. Selected takes a `--red` border, a
`0 0 0 4px rgba(255,70,85,0.14)` halo and `scale(1.22)`. A death the coach said
nothing about gets a **dashed** border so the gaps are visible before anything
is clicked.

Below the rail, the selected death shows its index, round, killer **as an agent
name**, a state chip, then either the tip it wrote or, when it stayed quiet, the
words "no tip". Nothing else. No reason column, no rule name, no diagnostic
string: the same restraint as the ledger, for the same reason.

### The run-up strip, which is the part that matters

Under that, a row of slots showing the frames either side of the death with
their real offsets in seconds, and **the unseen window drawn as a slot of its
own**: dashed `rgba(255,70,85,0.4)` border, a 135deg hatched fill, the gap in
seconds in mono `--red`, and the word "unseen".

The capture waits on the model, so it runs about every eleven seconds, not the
three the setting implies. The kill always happens between two captures and is
never photographed. Say that plainly under the strip in `--warn`.

**Real data. Use it verbatim, do not round it into marketing numbers.**
Session: Icebox, Iso, 11/6/1, 386 ACS, Victory 5-3, tracker grade S, 49 frames.
Six deaths, matching Riot's own record of the match.

| # | Frame | Round | Killer | Run-up offsets | Unseen gap | Said anything |
|---|---|---|---|---|---|---|
| 1 | 7 | 1 | Sage | -10s, 0s, +14s | 9.6s | yes |
| 2 | 14 | 3 | Clove | -19s, -10s, 0s, +13s | 18.9s | no |
| 3 | 31 | 6 | Sage | -29s, -9s, 0s, +13s | 28.7s | no |
| 4 | 34 | not read | Clove | -19s, 0s, +13s | 18.9s | no |
| 5 | 41 | 7 | Clove | -22s, 0s, +13s | 21.8s | no |
| 6 | 44 | 8 | not read | -10s, 0s, +12s | 9.8s | no |

The tip shown for death 1, verbatim: "You died to a Sage wall you could not see
through, so next round clear that angle before you step out."

One of six is not a number to hide or to spin. It is the honest shape of a coach
that only speaks when it can prove something, and the five dashed markers are the
argument.

The `0s` slot is labelled **"first frame that reads dead"**, never "the death",
because it is a frame taken after it. Negative offsets are labelled
"alive, full health", positive ones "after".

## 5. Then go through the rest of the site with this

Sections 1 to 4 are the new work. This section is the part that is easy to skip
and should not be: **the whole site has to end up saying the same things.** Do
not build the new section next to an older one that contradicts it.

Walk every page, every section, every card, the nav, the footer, the meta tags
and the OG image, and bring each one up to date. Specifically:

- **Anywhere an agent is drawn**, replace whatever is there now with the boxless
  glow from section 3. No pill, no rounded rectangle, no circle crop, no ring, no
  bordered chip. If a page shows an agent as a username, a coloured text span, or
  a lettered avatar, it becomes the portrait with the name on `title` and
  `aria-label`. The three colour states are the same everywhere on the site.
- **Anywhere a refusal is shown**, drop the reason. No rule names, no
  `PLAY_PATTERNS`, no "too similar to a recent tip", no diagnostic strings, in
  copy or in screenshots or in alt text. Count plus strike-through, nothing else.
- **Anywhere the product is described**, make the description match what it
  actually does now: it watches the screen the way OBS does, it writes a tip
  every few seconds, it refuses most of them, and after the match it shows every
  death including the ones it had nothing to say about. If an older section
  promises real-time League advice, that promise is wrong and has to go: League
  is recorded silently and reviewed after the game, by policy, and that is
  explained below.
- **Every mention of the name.** The product is Occlara. GhostCoach was the old
  name and should not appear in copy, headings, alt text, filenames the visitor
  can see, or the page title. Two identifiers deliberately keep the old name and
  are not typos to correct: the installer `GhostCoach.2.0.Setup.exe` and any
  releases URL. Leave those exactly as they are, or existing download links die.
- **The download.** One primary button, pointing at `Occlara-Setup.exe`. Windows
  only, say so plainly rather than letting a Mac visitor find out after the
  click.
- **Tokens and type.** Any page still on an older palette, an older radius, or a
  font weight outside 400 to 800 moves onto the values in this brief. A missing
  weight silently falls back to a system font and changes the shape of the whole
  page without erroring, so check rather than assume.
- **Anything else you find that is stale, broken, inconsistent or contradictory,
  fix it.** Dead links, placeholder copy, lorem, a stat that disagrees with
  another stat, a screenshot of a UI that no longer exists, an empty section, a
  route that 404s, an image with no `alt`, a heading level that skips. You have
  the whole site; use that. Where two places disagree about a fact, this brief
  wins.

Two things not to "fix":

- **Do not invent numbers.** Every figure on the site should trace to something
  real. If you cannot source a claim, cut it rather than round it up.
- **Do not add testimonials, logos, user counts, or press mentions** unless you
  were given real ones. A fabricated quote on a page whose entire argument is
  honesty is the single worst thing that could ship here.

When you are done, list what you changed outside sections 1 to 4 and why, so the
sweep can be checked rather than taken on trust.

## What the product actually does, for the copy on other pages

Short version, accurate as of this brief, so nothing on the site has to guess:

- **Valorant.** Live coaching while you play. Screen capture only, the same way
  OBS sees the display. It never reads game memory, never touches game files,
  never automates input.
- **Marvel Rivals.** The same live coaching.
- **League of Legends.** Recorded silently during the game and reviewed after it
  ends. **There is no live League coaching and there must never be**, because
  Riot's League policy approves overlays that show "static data that is available
  prior to the game" and bans "any game-session-specific information that would
  be previously unknown to the player". The same policy names the legitimate
  alternative, coaching the player "game over game". Do not describe League as
  live, do not imply it, and do not write copy that a reader could reasonably
  read as live.
- **After the match**, the death log above, the session grade, and a chat where
  you can ask about any single captured frame.
- **Stats** exist for Valorant. Marvel Rivals has no official API and League
  needs a production key the app does not have, so those two say so instead of
  showing a Valorant shaped dashboard with someone else's numbers in it.

## Copy rules

- No em dashes or en dashes. Commas.
- Never name a player by username. Agents and roles only.
- Active voice. A control says exactly what happens.
- Do not claim the coach is always right. The whole section is about it saying
  when it does not know.

## Accessibility

Every agent icon carries the name in `title` and `aria-label`. Timeline markers
are real `<button>` elements with a visible focus ring and an `aria-label`
naming the death, its round, and whether anything was said. Honour
`prefers-reduced-motion`: no card entrance, no scale on select. Theme the browser
surfaces too, selection colour and scrollbar included, from the palette.

## Legal footer, required

> Occlara captures the display the way OBS does. It never reads game memory,
> never touches game files, and never automates input.
>
> Agent art is Riot's, shown under Valorant's third party guidelines. Occlara is
> not endorsed by Riot Games.

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
that. It is that **the coach only speaks when it can prove what it is saying**,
and says nothing the rest of the time. Do not soften that into a feature bullet.
It is the spine of the section, and the place it is proved is the post-match
review: six deaths in a real session, five reviewed, and one it deliberately
stayed quiet on rather than risk sending the player the wrong way.

Do not build a panel that lists refused tips, or a counter of them, or a feed of
struck-through text. An earlier draft had one and it was cut: a wall of crossed
out sentences reads as an error log, invites the reader to try to read them, and
makes restraint look like malfunction. The five silent markers on the death rail
make the same point without asking anyone to read a rejection. For the same
reason, never print an internal rule name anywhere on the site.

The line that closes the section is "Most coaching tools are judged on what they
say. This one is worth judging on what it will not."

Three beats, in this order:

1. **The overlay running**, one tip at a time over a game frame.
2. **The agent icon**, and why a colour on it has to be earned.
3. **The match review**, every death, who killed you, and what it actually said.

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

**Type**: Geist for everything, Geist Mono for digits, scores, labels that index
something, and anything that lines up in a column. Both are on Google Fonts. Weights 400 to 800
only, never one outside that set.

**Headings** need an explicit `line-height` near 1.1. Inheriting a body 1.6 at
34px pulls the two lines so far apart they read as separate sentences. This went
wrong once already.

## Rules that keep getting broken

- **No decorative gradients.** Solid fills and hairline borders. The only
  gradient is the simulated game frame behind the tip cards, standing in for a
  photograph.
- **Red is spent in one place at a time.** It is the accent and the enemy glow.
  It is not a heading colour or a border on every card.
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

**Motion** is specified in section 2. One card at a time, never two.

## 2. One tip at a time

Tips arrive **one at a time and do not stack.** The card that is up leaves
before the next one lands, so the frame is never holding more than one sentence.

This is not a layout preference, it is what the product is. A tip is glanced at
mid fight and then it is gone; a column of three of them is a feed, which is a
different and worse thing, and no player reads the second one during a round.

```
enter    420ms  cubic-bezier(0.16, 1, 0.30, 1)
         opacity 0 to 1, translateY(20px) to 0, scale(0.97) to 1, blur(3px) to none
exit     300ms
         opacity 1 to 0, translateY(0 to -12px), scale(1 to 0.985), blur(0 to 2px)
interval 3400ms
```

Animate the outgoing card out and remove it on its own timer so the two never
overlap in the layout. The first card must be present in the **first painted
frame**, so the page is never an empty box waiting on an interval.

Real tips to cycle, verbatim, all from one logged session:

- You died to [Sova] because you peeked A Nest wide with no trade partner. (death review)
- Your ult is up as [Iso], so take the duel you have been avoiding.
- You died to [Sage] after she walled off the cover you were running to. (death review)
- You are trading well as [Iso], so keep taking the first duel while it is working.
- You died to [Clove] who repeeked the smoke you had already cleared. (death review)

## 3. The agent icon

An agent's name is replaced by that agent's portrait, when and only when the
sentence proves whose side they are on. **The name is never lost**: it moves to
`title` and `aria-label`.

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

**TWO states, and every portrait carries a colour:**

| State | Glow | When |
|---|---|---|
| Proven enemy | red, as above | the sentence says this agent killed the player |
| Proven ally | green, as above | it is the player's own confirmed agent |

**There is no third state, and no uncoloured portrait.** There is no team roster
anywhere in the product, so an agent whose side cannot be proven simply keeps
their name as a word and gets no picture at all. A face with no colour used to be
that third state and it was the weakest thing on the card: it looked like the
other two with the meaning filed off, and a reader took grey to mean a team
rather than an admission. Nothing is guessed, the uncertainty just stops being
drawn as though it were information.

**A portrait is the PERSON, never a thing they own.** "You died to a Sage wall"
rendered as "you died to a [picture of Sage] wall", which reads as being killed
by a photograph. So the sentence names who killed the player, and says what their
utility did in a clause of its own: "You died to Sage, who walled off your cover
first." If a sentence has to talk about the object, the name stays a plain word
there and keeps ordinary grammar, article and all: "a Sage wall is up".

**No article in front of an agent name as a person.** Write "Reyna is holding B
Main", never "a Reyna" and never "the Reyna". There is one of each agent in a
match, so the name was never doing work the picture cannot.

Show the two states as two real sentences, not as feature cards:

- Proven enemy: `You died to [Sage], who walled off your cover first.`
- Proven ally: `Your shield is up as [Iso], so you win this trade if you take it now.`

## 4. The match review, which is the section that sells it

This is the strongest thing in the product, so build it carefully.

After a match, Occlara shows **every death you took, who killed you, and the
exact line it put on screen at the time.** Including the deaths it had nothing
to say about, which it marks rather than hides.

**Do not put capture statistics on this page.** An earlier draft of this section
had frame offsets in seconds, an "unseen window" showing the gap between two
captures, and a note about the model's polling interval. All of it was true and
none of it was the player's problem: it explained how the tool works instead of
what the tool found, and it made a review look like a diagnostic readout. No
frame numbers, no offsets, no capture rate, no confidence scores, no percentages.

A player looking at this wants three things per death, in this order: **who
killed me, what did it say, can I trust it.** Build only those.

### Structure

One card, `--glass-border` hairline, `--r-lg`, `rgba(255,255,255,0.022)` fill,
max width about 860px.

**Header row**, 18px 22px, hairline underneath:

| Element | Style |
|---|---|
| Map name | 15.5px, weight 700 |
| Agent and K/D/A | Geist Mono 13px, `--text-dim`, tabular numerals |
| Result | pill, right aligned, `--good` on `rgba(82,200,138,0.12)` with a `0.3` alpha border |

**Count row**, 13px 22px, hairline underneath: "6 deaths, 5 of them reviewed" in
`--text-mute` at 12.5px, and right aligned a row of one 7px dot per death. A
reviewed death is a filled `--text-mute` dot at 0.55 opacity; a silent one is
**hollow with a 1px `--warn` border**. Six dots read the shape of the match
before a single word is read.

**Then one row per death**, separated by hairlines, `19px 22px`, a two column
grid of `186px` and the rest with a 24px gap. Under 720px it stacks.

Left column:

- `DEATH 3 &middot; ROUND 6` in Geist Mono, 11.5px, `--text-mute`, uppercase,
  0.07em tracking. Omit the round when it was not read, do not print "unknown".
- `Killed by` in 12.5px `--text-dim`, then the agent portrait with the red enemy
  glow from section 3, then the name in 14.5px weight 600.
- When the killer was never legible: **"Killer never identified"** in 13px
  `--text-mute` italic, and drop the "Killed by" label entirely. "Killed by not
  identified" is not a sentence. Do not guess a name to fill the space.

Right column, and this is the part that matters: **the real tip card.** Not a
blockquote, not italic text, not a speech bubble. The same component from
section 1, with the `DEATH REVIEW` meta label and the white dot, capped at about
420px wide. The player sees the thing they saw in game.

### The death it said nothing about

Do not leave a blank. A gap reads as an oversight, and this one is the opposite.
In the same slot, a box with a **dashed** `rgba(217,164,65,0.4)` border on a
`rgba(217,164,65,0.05)` fill, `--r-md`, 14px 16px:

- Heading: "IT SAID NOTHING HERE", 12.5px, weight 600, `--warn`, uppercase, 0.07em
- Body: "It wrote a tip for this death and stopped itself before sending it." at
  13.5px `--text-dim`

Under the whole card, one paragraph in `--text-mute` explaining that specific
one in plain language, no rule names:

> The fourth one is blank because the coach wrote a tip and then stopped itself.
> It was about to tell you to hold A Nest, and it had already seen an enemy on B.
> It would rather leave a gap than send you the wrong way, and it shows you the
> gap instead of quietly closing it.

### The real data. Use it verbatim.

Session: **Icebox, Iso, 11 / 6 / 1, Victory 5-3.** Six deaths, matching Riot's
own record of the match. Every line below is what the coach actually wrote.

| # | Round | Killed by | Tip |
|---|---|---|---|
| 1 | 1 | Sage | You died to a wide angle with no cover, so next time retreat behind the box and let your team clear the site before you re-engage. |
| 2 | 3 | Clove | You died to a pistol at close range because you held that A Main angle too wide without a trade partner. |
| 3 | 6 | Sage | You died to [Sage] on B Site because you were isolated and exposed, so next time hold tight with a teammate. |
| 4 | not read | Clove | none, see above |
| 5 | 7 | Clove | You died holding A Site alone after your team pushed B, so you need to fall back into the site and wait. |
| 6 | 8 | never identified | You died holding A Rafters alone against a full buy, so next round fall back to A Site or wait for a teammate. |

Only row 3 names an agent inside the tip, so only row 3 gets a portrait in the
tip text. The left column portrait is separate and every identified killer gets
one, because a killer is a proven enemy by definition.

Row 3 is written "died to Sage", not "died to a Sage". That is not a typo to
correct: the article is stripped before the tip is ever drawn, for the reasons in
section 3.

### Motion

Rows fade and rise 8px on scroll into view, 380ms on the exponential ease,
staggered 60ms apart, once only. Nothing loops. Honour `prefers-reduced-motion`
by rendering them in place. The card must be fully populated in the first
painted frame; the animation is a reveal, never a loader.

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
  `aria-label`. Two colour states, everywhere on the site, and no uncoloured
  portrait: an agent whose side is not proven stays a plain word. A portrait
  never stands in for a name that is modifying an object.
- **Anywhere refused tips are listed**, delete the whole thing: the panel, the
  counter, the struck-through rows. And never print an internal rule name, no
  `PLAY_PATTERNS`, no "too similar to a recent tip", no diagnostic strings, in
  copy or in screenshots or in alt text. The restraint is shown by the silent
  markers in the death log, not by a list of rejections.
- **Anywhere tips are shown arriving**, they arrive one at a time. No stacks, no
  columns of two or three cards, no feed.
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

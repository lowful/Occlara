# Lovable prompt: the Occlara product section

Paste everything below the line into Lovable. It is written to be acted on
directly. There is a live reference page built from the app's real CSS, so
anything ambiguous here can be settled by looking at that instead of guessing.

None of this repo's files go into the website repo. This is a description.

---

Build a product section for **Occlara**, a Valorant coaching overlay. Stack is
the one this project already uses: Vite, React, TypeScript, Tailwind, shadcn.

## What Occlara is, in one paragraph

It watches the screen while you play, the way OBS does, and writes a short
coaching tip every few seconds. Then it checks each tip against what it can
actually prove and throws away everything it cannot stand behind. It never reads
game memory, never touches game files, never automates input. After the match it
shows every death and whether it had anything to say about each one.

## What this section has to land

The differentiator is not "AI tips appear over your game". Every competitor has
that. It is that **the coach refuses most of what it writes and can tell you
why**. Do not soften that into a feature bullet. It is the spine of the section:
show tips arriving, show the refusals piling up beside them with their real
reasons, then show the post-match log admitting which deaths it stayed quiet on.

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
- **Red is spent in one place at a time.** It is the accent, the enemy outline,
  and the refusal count. It is not a heading colour or a border on every card.
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
running count in `--red`, mono, tabular numerals. Each row: the refused tip in
`--text-mute` at 12px with a **line-through** in `rgba(255,70,85,0.6)`, clamped
to two lines, and under it the reason in mono 10.5px in `--red`. Rows enter with
a 460ms slide from the right. Keep four.

Real refused tips and reasons to use, verbatim:

| Tip | Reason |
|---|---|
| You died holding A Nest alone after your teammate traded, so next time wait for a trade partner. | already recommended a fall-back in the last two tips |
| You died to a close-range pistol while holding a wide angle with no cover. | too similar to a recent tip |
| You died holding A Rafters alone with no crossfire, so next round find a partner. | said the player was dead while they were alive at 100 HP |
| Set up a crossfire on A site with your Killjoy so any entry gets traded. | failed the final verify gate |

## 3. The agent icon

An agent's name is replaced by that agent's portrait. **The name is never lost**:
it moves to `title` and `aria-label`.

```
size     1.55em square, inline, vertical-align -0.32em, margin 0 0.14em
shape    rounded RECTANGLE, radius 8px. NOT a circle.
image    fills the box, object-fit cover, border-radius inherit
outline  box-shadow spread, never a border
```

**The outline is a spread box-shadow, not a border.** A border eats pixels off
every edge of a 20px box and leaves almost no face. A spread shadow sits outside
the art, so the whole box stays portrait.

**And it is not a circle.** A round mask on this art threw away most of the face
and squashed what was left.

Three states, and only two are a colour:

| State | Outline | Fill | When |
|---|---|---|---|
| Proven enemy | `0 0 0 1.5px #FF4655, 0 0 6px rgba(255,70,85,0.45)` | `rgba(255,70,85,0.2)` | the sentence says this agent killed the player |
| Proven ally | `0 0 0 1.5px #52C88A, 0 0 6px rgba(82,200,138,0.4)` | `rgba(82,200,138,0.2)` | it is the player's own confirmed agent |
| Not provable | `0 0 0 1px --glass-border` | `rgba(255,255,255,0.06)` | anything else |

**Do not colour the third state.** There is no team roster anywhere in the
product, so a green teammate who is actually an opponent would be believed and
be wrong. The grey outline is the honest answer and the copy should say so.

**No article in front of an agent name.** Write "Reyna is holding B Main", never
"a Reyna" and never "the Reyna". There is one of each agent in a match, so the
name was never doing work the picture cannot. When the name modifies an object
it keeps normal grammar: "a Sage wall" and "a Viper orb" are correct.

Show these three states as three real sentences, not as three feature cards:

- Proven enemy: `You died to a [Sage] wall you could not see through.`
- Proven ally: `Your [Iso] shield is up, so you win this trade if you take it now.`
- Not provable: `[Sage] is holding B Main, so wait for your team.`

Using the same agent twice, once coloured and once not, is the point.

**Art**: Valorant's kill feed portraits, about 10KB each and 2:1 wide, from
`https://valorant-api.com/v1/agents?isPlayableCharacter=true`, field
`killfeedPortrait`. At the larger size on a web page the wide crop reads better
than the square one. Download and self-host them; do not hotlink. On the page
they render at roughly `3.4em x 1.7em`, which is the one place the site
deliberately differs from the app.

## 4. The death log

A horizontal rail with one marker per death, positioned by
`frameIndex / totalFrames`. Markers are 21px circles with a small skull glyph,
`--bg` fill and a `--glass-border` ring. Selected takes a `--red` border, a
`0 0 0 4px rgba(255,70,85,0.14)` halo and `scale(1.22)`. A death the coach said
nothing about gets a **dashed** border so the gaps are visible before anything
is clicked.

Below the rail, the selected death shows its index, round, killer **as an agent
name**, a state chip, then the tip it wrote, then the reason in mono.

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

| # | Frame | Round | Killer | Run-up offsets | Unseen gap | Outcome |
|---|---|---|---|---|---|---|
| 1 | 7 | 1 | Sage | -10s, 0s, +14s | 9.6s | shown on the overlay |
| 2 | 14 | 3 | Clove | -19s, -10s, 0s, +13s | 18.9s | already recommended a trade in the last two tips |
| 3 | 31 | 6 | Sage | -29s, -9s, 0s, +13s | 28.7s | already recommended a hold-tight in the last two tips |
| 4 | 34 | not read | Clove | -19s, 0s, +13s | 18.9s | told the player to hold A Nest while 1 enemies are confirmed on B |
| 5 | 41 | 7 | Clove | -22s, 0s, +13s | 21.8s | already recommended a fall-back in the last two tips |
| 6 | 44 | 8 | not read | -10s, 0s, +12s | 9.8s | already recommended a fall-back in the last two tips |

The `0s` slot is labelled **"first frame that reads dead"**, never "the death",
because it is a frame taken after it. Negative offsets are labelled
"alive, full health", positive ones "after".

**Mark which rule stopped each one.** Deaths 2, 3, 5 and 6 were stopped by
repetition rules, which was the bug and is fixed. Death 4 was stopped by a truth
rule that was correct and still blocks it. Showing that difference is more
convincing than showing six failures.

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

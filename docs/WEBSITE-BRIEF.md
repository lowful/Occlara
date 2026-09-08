# Website brief: the coaching overlay section

Paste this into Lovable. It describes one section of occlara.app, not the whole
site. There is a live reference page that goes with it, built from the real
component CSS, so anything ambiguous below can be settled by looking at that.

None of this repo's files go into the website repo. This is a description, not
a port.

---

## What this section is for

Show what the coach actually says, and what it refuses to say. The second half
is the differentiator and should not be softened: every competitor shows tips
appearing, none of them shows a tip being withheld because the app could not
prove it.

Three beats, in this order:

1. **Tip cards arriving over a game.** Agents render as icons with a coloured
   ring.
2. **The ring legend.** Three states, and only two of them are a colour.
3. **The post-match death timeline.** Six deaths from one real session, each one
   either reviewed or explicitly not.

---

## Tokens

Take these exactly. They are the app's own values, so the site and the product
cannot drift.

```
--bg        #08090A     page ground
--panel     #0D0F11     raised surface
--surface   rgba(255,255,255,0.035)
--line      rgba(255,255,255,0.09)      hairline borders
--line-soft rgba(255,255,255,0.055)
--text      #F5F5F7
--dim       #A1A1A6     body copy on dark
--mute      #808086     captions, never body copy
--red       #FF4655     the one accent
--good      #52C88A     proven ally, positive state
--warn      #D9A441     "the coach said nothing here"
radii       8 / 12 / 16
easing      cubic-bezier(0.22, 1, 0.36, 1)
```

**Type**: Geist for everything, Geist Mono for digits, timestamps, labels and
anything that lines up in a column. Both are on Google Fonts. Weights 400 to 800
only, and never a weight outside that set.

**Three rules that keep getting broken:**

- **No decorative gradients.** Solid fills and hairline borders. The only
  gradient anywhere is the simulated game frame behind the tip cards, and that is
  standing in for a photograph.
- **Red is spent in one place at a time.** It is the accent and the enemy ring.
  It is not a heading colour and not a border on every card.
- **Dark only.** This section commits to one visual world. Paint every colour
  explicitly so it holds regardless of the visitor's theme.

---

## 1. Tip cards

```
background   rgba(8,9,10,0.90)
border       1px solid --line
radius       12
padding      13px 15px
backdrop     blur(14px)
shadow       0 8px 26px rgba(0,0,0,0.55)
body         13.5px / 1.5
```

A meta row above the text: a 6px dot, then an uppercase 10px label at
0.09em letter-spacing in `--mute`. The dot is `--red` normally and `--text` for a
death review, and a death review's label reads **DEATH REVIEW** in `--text`.

**Motion.** Cards arrive one at a time, roughly 900ms apart, then a new one every
5 seconds or so. Entrance is 380ms: `opacity 0 -> 1`, `translateY(14px) -> 0`,
`scale(0.985) -> 1`. Keep at most three on screen. The first card must be
present in the first painted frame; nothing waits on a scroll trigger.

---

## 2. The agent ring

An agent name is replaced by the agent's icon. The name moves to `title` and
`aria-label` and is never lost.

```
size     1.7em square, inline, vertical-align -0.3em
border   2px solid, border-radius 50%, box-sizing border-box
image    fills the box, object-fit cover, border-radius 50%
```

**The border is the ring, not an inset shadow.** The image fills the element, so
an inset shadow is painted underneath it and is invisible. This was got wrong
once already.

Three states:

| State | Border | Fill | When |
|---|---|---|---|
| Proven enemy | `--red` | `rgba(255,70,85,0.2)` | the sentence says this agent killed you |
| Proven ally | `--good` | `rgba(82,200,138,0.2)` | it is the player's own confirmed agent |
| Not provable | `--line` | `rgba(255,255,255,0.06)` | anything else |

**Do not colour the third state.** There is no team roster anywhere in the
product, so a green teammate who is actually an opponent would be believed and be
wrong. The grey ring is the honest answer and the copy should say so.

**Art.** Use Valorant's kill feed portraits, which are about 10KB each rather than
410KB, and are the icon the game itself puts next to a name. Ship them as files
on the site; do not hotlink. Include the disclaimer in the footer: agent art is
Riot's, shown under Valorant's third party guidelines, and Occlara is not
endorsed by Riot Games.

---

## 3. The death timeline

A horizontal rail with one marker per death, positioned by
`frameIndex / totalFrames`. Markers are 22px circles containing a small skull
glyph, on `--panel` with a `--line` border. Selected takes a `--red` border, a
`rgba(255,70,85,0.14)` fill and `scale(1.16)`. A death the coach said nothing
about gets a **dashed** border, so the gaps are visible before anything is
clicked.

Below the rail, the selected death shows: its index, round, killer as an AGENT
name, and a state chip. Then either the tip that was shown, or, in italic
`--mute`, the line that nothing reached the screen. Then a mono caption in a
faint box giving the actual reason.

**Use this real data.** It is one session, verified against Riot's own record of
the match: Icebox, Iso, 11/6/1, 386 ACS, Victory 5-3, tracker grade S.

| # | Frame | Round | Killer | Reviewed | Reason |
|---|---|---|---|---|---|
| 1 | 7 | 1 | Sage | yes | shown |
| 2 | 14 | 3 | Clove | no | already recommended a fall-back in the last two tips |
| 3 | 31 | 6 | Sage | no | too similar to a recent tip |
| 4 | 34 | 6 | Clove | no | said the player was dead while they were alive at 100 HP |
| 5 | 41 | 7 | Clove | no | already recommended a fall-back in the last two tips |
| 6 | 44 | 8 | not read | no | failed the final verify gate |

Total frames: 49.

---

## 4. The numbers

Four figures in one bordered group, divided by hairlines, mono and
`font-variant-numeric: tabular-nums`:

```
49  frames captured
26  death reviews written
24  of them dropped before you saw them      (--red)
 6  deaths detected, against Riot's 6        (--good)
```

These are from the same real session and are honest about a flaw that has since
been fixed. Keep them that way, and do not round them into marketing numbers.

---

## Copy rules

- No em dashes or en dashes anywhere. Commas.
- Never name a player by username. Agents and roles only.
- Active voice, and a control says exactly what happens.
- Do not claim the coach is always right. The whole point of the ring legend and
  the timeline is that it says when it does not know.

## Accessibility

Every agent icon carries the name in `title` and `aria-label`. Timeline markers
are real buttons with a visible focus ring and an `aria-label` naming the death
and round. Honour `prefers-reduced-motion`: no card entrance animation, no
scaling on select.

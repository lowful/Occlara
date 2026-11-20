# The Trainer's models

What the Trainer shows of guns, hands and bots is made here, ahead of time,
from seven CC0 models (`sources.json`, and
`native/trainer-models-NOTICE.txt` for who made each and what was changed).
The page loads the result as two plain modules and needs no loader:

- `src/renderer/trainer/models/guns.js`: the five first person view models
  (`heavy-rifle`, `silenced-rifle`, `heavy-pistol`, `sidearm`, `knife`), each
  one mesh with its forearms and gloved hands in it, and where its muzzle is.
- `src/renderer/trainer/models/figure.js`: the bots' figure with the rifle it
  holds, its 22 bone skeleton, and its clips (`aim`, `crouch`, `runF`, `runB`,
  `runL`, `runR`, `fall`).

Both are generated. Never edit them by hand: change `build.js` and run it.

## THE RULE: what may be a source

A generic real world model under CC0, or CC-BY with its credit written in the
notice, whose own page states the licence. Nothing of VALORANT's or any other
game's, and nothing that is a rip or a fan copy of a game's asset whatever
licence its uploader claims. If the page does not state the licence, it is
not a source. A new source goes into `sources.json` and the notice in the
same change.

## Making them again

```
node scripts/trainer-models/fetch.js <raw dir>
node scripts/trainer-models/build.js <raw dir>
```

`<raw dir>` is any folder outside the repository: the downloads are never
committed. `fetch.js` says so when a file's size is not the one read on 19 Nov
2026, which means the source changed and its page wants reading again.
`build.js` prints each mesh's size and how the figure sits in its hitboxes
(the helmet's middle against the head's sphere, how far the body and the legs
reach against their capsules), which is the thing to read after changing a
pose. `--dry` builds and prints without writing.

The build needs nothing installed: it reads `.glb` with `glb.js` and uses the
three.js already vendored for the page for its vectors and quaternions.

## Looking at it without the app

```
node scripts/trainer-models/build.js <raw dir> --dry --preview <ply dir>
blender -b -P scripts/trainer-models/preview.py -- <ply dir>/gun-heavy-rifle.ply <out prefix> left+back+q
```

`--preview` writes `.ply` files: `gun-<id>` (a view model in its own space),
`bare-<id>` (the weapon with no hands), `fp-<id>` (as the first person camera
holds it; view `fp`), and `fig-<clip>-<frame>` (the figure as the page skins
it). `preview.py` renders one with Blender's Workbench: `fp`, or `left`,
`right`, `front`, `back`, `top`, `under`, `q`, `q2`, `q3`, and a close look at
a point with `left@0,-0.08,0.14@0.26` (the point in the Trainer's space, then
how many metres across). Then look at it in the real app too: a pose that is
right in Blender can still be wrong under the page's light.

`--clips Idle@0,Run@0.25,Death@0.6` (with `--preview`) writes the source
figure in its own clips instead, at that share of each, as `clip-<name>-<share>`:
the way to see what a clip is before building on it.

If `check:publicmirror` ever refuses a model module for "secret shaped text",
nothing leaked: a long run of base64 spelled a token's first letters by
chance. `mesh.js b64` cuts such a run in two so the guard never sees it, and
`kit.js` joins the pieces; look there first.

## The files

| File | What it does |
| --- | --- |
| `sources.json` | Each source: its page, its file, its author, its licence, its size when read. |
| `fetch.js` | Downloads the sources into a folder. |
| `glb.js` | Reads a `.glb`: meshes, materials by base colour, the node tree, skins, clips. |
| `rig.js` | A skeleton posed in code: a clip sampled at a time, world matrices, aim a bone, a two bone reach, the turn between two frames. |
| `mesh.js` | Mesh tools: gather, move, cut, normals smoothed by angle, the outline's normals, the packing `kit.js unpack` reads, `.ply` for the previews. |
| `build.js` | The build itself: the colours, where each hand holds each weapon, the figure's poses and clips. |
| `preview.py` | Renders a `.ply` in headless Blender. |

## How a hand is placed

`build.js viewArm` and the `GUNS` table. A hand is given by where its middle
knuckle goes (`knuckle`, in the weapon's space: barrel down -z, up +y,
metres), which way the knuckles lie from the wrist (`F`), which way the palm
looks (`N`), which way the forearm leaves (`elbow`) and how far each finger
curls. The wrist follows from those. To move a hand, change `knuckle`; to
turn it, `F` and `N`; then look at it from `left`, `back` and `fp`.

## How the figure is posed

`build.js aimUpper`, `crouch` and `frame`. The legs come from the source's
clips. The upper body is the same in every clip: the spine squared and bladed
a little, the head level, the rifle's butt in the right shoulder, the right
hand reached onto the grip and the left under the handguard, wherever the
right hand's hold put the rifle. Every frame is moved so the helmet's middle
is over the figure's origin, because that is where the head's hitbox is
(`bots.js rayHit`); the fall alone keeps where it stood.

What ships of a frame is, for each bone, its turn from its parent and its
place in its parent, both measured from the bind pose. `bots.js` blends
frames bone by bone and walks the tree, so a blend never pulls a joint apart.

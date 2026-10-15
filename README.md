# VRCraft

A voxel sandbox for WebXR — build, mine, and survive the night, in a headset or in
a browser window. No build step, no npm, no bundler: it is plain ES modules plus a
vendored copy of three.js, so any static file server will run it.

🎮 **[Play it live →](https://samnode.github.io/vrcraft/)**

Targeted at Meta Quest 2/3/Pro in the Quest Browser, with a full keyboard-and-mouse
fallback for development.

## Running it

**On a Quest, the quickest route is the live link above.** Open
`samnode.github.io/vrcraft` in the Meta Quest Browser and tap **ENTER VR** — Pages
serves it over HTTPS, which is the secure context WebXR requires, so there is
nothing to install and no cable involved.

To run your own copy, any static server works. From this directory:

```bash
python3 -m http.server 8860
```

Then open <http://localhost:8860> and click **Play in browser**.

### Serving it to a Quest yourself

Only needed if you are running modified code rather than the live link. WebXR
requires a *secure context*: `http://localhost` qualifies, a plain
`http://192.168.x.x` does not. Two ways to get there:

**USB, no certificate warnings (recommended).** With Developer Mode on and the
headset plugged in:

```bash
adb reverse tcp:8860 tcp:8860
```

The headset now sees your machine's port 8860 as its own `localhost`. Open
`http://localhost:8860` in the Quest Browser and the **Enter VR** button lights up.

**Over Wi-Fi.** Serve TLS with the bundled helper and accept the one-time warning:

```bash
python3 serve-https.py
```

It prints an `https://<your-lan-ip>:8443` address to open in the headset.

Any HTTPS static host works the same way — this repo is served straight from
`main` by GitHub Pages, with no build step and nothing to configure.

## Modes

Pick **creative** or **survival** with the mode button on the start screen, before
you enter. A headset session has no web page to click, so choosing up front is the
only way to start a run in survival; on desktop `C` swaps at any time.

- **Creative** — the whole 13-block palette with unlimited counts, flight, no damage.
- **Survival** — nine empty slots you fill by mining, real stack counts, health,
  hunger, fall damage, hostile zombies after dark, and no flying.

## Mobs

Eight kinds, each with its own behaviour and drops.

| Mob | Behaviour | Drops |
| --- | --- | --- |
| Pig | Wanders | Porkchop |
| Cow | Wanders | Raw beef, leather |
| Sheep | Wanders | Wool |
| Chicken | Wanders, quick | Raw chicken, feathers |
| Zombie | Chases and hits you; burns at dawn | — |
| Skeleton | Keeps its distance and shoots arrows; burns at dawn | Bones, arrows |
| Creeper | Closes in, blinks, then blows a hole in the world | Gunpowder |
| Spider | Fast, low, attacks at night | String |

Passive animals spawn in daylight; the hostile roster only comes out at night and
only in survival. Creeper blasts are real: they carve a ragged sphere out of the
terrain, damage anything nearby with falloff, and you have about a second and a
half of blinking to get clear.

## Crafting

Open the recipe panel with `E` on desktop, or the left grip in VR, where it floats
in front of you and the right controller points at it. Recipes are ingredient
lists rather than a 3x3 grid — a grid is miserable to operate with motion
controllers, so this works like Minecraft's recipe book: you see everything, and
what you cannot make yet is dimmed with the reason.

The progression is the familiar one. Punch a tree for wood, turn it into planks
and sticks, build a crafting table, and the tool recipes open up. Mine stone for
cobblestone, build a furnace, and smelt iron ore into ingots — and your meat into
something worth eating.

Thirty-eight recipes in all. Beyond tools: doors, ladders, beds, wool, stone and
wood slabs, a bow with arrows for fighting back at range, and two full sets of
armour.

Doors and beds are **used** rather than placed on: aim at one and press place
(right-click, or the left trigger in VR). Doors swing open and shut; a bed carries
you through to dawn, but only if it is actually night. Ladders are climbed with
jump to go up and sneak to come down.

A door is two blocks tall and behaves as a single object: placing one needs two
clear cells and fills both, using either half swings the whole thing, and breaking
either half takes both. The upper half reads its facing from the lower half's
neighbours, so the two can never end up pointing different ways.

A bed is the same idea lying down: two blocks long, laid out along whichever way
you are facing when you place it. It is built as a mattress on four stubby legs
with its top at nine pixels, Minecraft's own proportions rather than a plain
slab, and the pillow always sits at the head end whichever of the four ways the
bed runs. Placing needs both cells clear, and using or breaking either half acts
on the whole bed.

## Biomes

Five of them, picked from two slow climate fields: temperature decides hot from
cold, humidity decides forest from open ground. Plains are flat and sparsely
treed, forests are thick with oak, deserts are dunes of sand over sandstone with
cacti standing in them, and the snowy taiga is deep snow and stepped conifers.

Mountains are the exception: they are chosen by terrain rather than climate, and
change with altitude the way a real one does — grass at the foot, bare stone
higher up, snow on the caps.

Height blends smoothly through a separate mountain factor rather than stepping
with the biome, because a hard change in amplitude at a biome edge would carve a
cliff along the whole seam. Peaks approach the world roof asymptotically instead
of being clamped against it, which is the difference between a rounded summit and
a sliced-off plateau.

## The Nether

A second dimension, reached the way you would expect: a frame of obsidian, lit
with flint and steel.

Obsidian is the gate to it. It sits in seams in the bottom thirteen layers of the
overworld, and nothing short of an iron pickaxe will take it — so the Nether is
not somewhere you reach before you have tooled up. Ten blocks builds a frame two
wide and three tall; corners are optional, exactly as in Minecraft. Flint and
steel costs an iron ingot and a lump of coal, which is the one recipe here that
departs from Minecraft: there is no gravel to knap flint out of, so the striker
is coal, which is at least the right idea.

Strike the frame and the air inside turns to a sheet of drifting purple. Stand in
it for a moment and you are through.

Nothing about a portal is recorded anywhere. It is recognised rather than
remembered: a rectangle of air completely ringed by obsidian in one vertical
plane, found by flooding the air and checking what the flood stopped against.
Because the flood only ever steps in four directions, the ring it tests is
exactly Minecraft's — the diagonal corners are never consulted, so leaving them
off still works. That one rule is the whole detector, and it means a portal
survives its chunk unloading and reloading with no bookkeeping at all. Break one
block of the frame and the sheet goes out, because the frame was the only record
of it.

### What is down there

One enormous cavern rather than a landscape. A lava sea at the bottom, a rock
roof you cannot see past at the top, and a floor of netherrack between them,
generated as a floor height and a roof height per column with 3D noise eating
hollows out of both. Where the floor comes out below the sea the column floods
and you get a lava lake; where it comes out above you get dry ground to walk on.
Columns of rock bridge the two, tapering as they climb so they read as
stalagmites rather than walls.

Glowstone grows on the ceiling in clusters and is most of the light. Quartz ore
runs through the netherrack. Soul sand drifts across the open floor. Obsidian
crusts the lava shore, which matters more than it looks: it is a second source of
portal frame for anyone who arrives and loses theirs.

The Nether has **no sky light at all** — that is the thing that makes it a
different place rather than a red cave. Under that roof the usual day/night term
has nothing left to multiply, so the dimension carries its own ambient floor: a
dim red that everything is seen through, with glowstone, lava and your own
torches as the only real light. There is no sun, no moon, no stars and no clouds,
and the horizon ends in red fog at a much shorter distance than the overworld's.

Lava burns at roughly Minecraft's rate: about three seconds to kill you with
nothing on, eight or so in a full set of iron. You can climb out, but at half the
lift and a third of the speed, and the burn is counting the whole time.

Two things live there. **Zombie pigmen** leave you alone until you hit one — and
then so does every other pigman within sixteen blocks, which is the character of
the place in one rule: nothing down there is safe, but most of it is your own
fault. **Ghasts** float, hold off at fifteen blocks or so, and lob fireballs that
blow craters in the rock. Obsidian is on the blast-proof list, so a ghast cannot
erase the portal you arrived through.

### Travelling

The destination is the same place at a different scale: one block in the Nether
is eight in the overworld, which is the entire reason to use it to get somewhere.
Walk a hundred blocks down there and come back up eight hundred from where you
started.

If a portal is already waiting at the far end, you come out of it. If there is
not, one is built — frame, platform and all. Arriving is not allowed to fail: a
player who lands inside rock or falls out of the world has no way of
understanding what went wrong, so the site search looks for ground with head room
for the frame, and hangs an obsidian pad in the open if the whole search square
turns out to be lava and pillar.

Both dimensions stay resident for the session. Only the one you are in is
simulated and drawn; the other keeps its voxels, its herds and anything lying on
its ground exactly where they were, frozen until you come back. Dying in the
Nether drops your things in the Nether and wakes you up at your overworld spawn,
which is a considerably longer walk back than usual.

## Armour and dying

Two sets: leather off the cows, iron out of the furnace. A cap costs five, a
chestplate eight, trousers seven and boots four, which are Minecraft's own
numbers, and so is the protection — four percent of a hit turned aside per
armour point, so a full leather set stops 28% and a full iron set 60%.
Starving and falling out of the world ignore it, because no helmet ever helped
with either.

Armour is **worn**, not placed: select a piece and press place to put it on. It
moves out of the hotbar into its own slot, so a helmet never costs you the slot
you were keeping cobblestone in, and swapping one piece for another hands the
old one back. If there is genuinely nowhere to put the old piece, the swap is
refused rather than quietly destroying it. What you are wearing shows in the HUD
as a row of armour pips above your hearts, with the four pieces themselves
mirrored opposite the hunger bar so you can see which slot is still bare.

Dying drops everything you were carrying **and** wearing on the ground where you
fell, and tells you the coordinates. You respawn empty at your spawn point and
have to walk back for it. Death drops never time out — a mob's loot gives you
five minutes, but your own grave waits as long as it takes.

Items on the ground are real entities, not chunk contents, which matters the
moment you respawn: the chunk you died in streams out behind you, and anything
owned by it would fall through a floor that no longer exists. Instead an item
whose ground is unloaded simply freezes until you come back and it loads again.
Mob loot lands the same way rather than teleporting into your pockets, and a
block mined with no room left falls at your feet instead of evaporating.

Tools matter, exactly as they do in Minecraft:

- **Speed** — the right tool class is several times faster. Stone takes 1.5s with
  bare hands, 0.6s with a wooden pickaxe, 0.21s with an iron one. The wrong tool
  gives no bonus at all.
- **Harvesting** — stone and ores only drop when mined with a good enough
  pickaxe. Bare-handed stone breaks and yields nothing; iron ore needs at least a
  stone pickaxe. The game tells you when you are missing the tool.
- **Combat** — a fist does 1 damage, a wooden sword 5, an iron sword 8.

## Controls

| Action | VR | Desktop |
| --- | --- | --- |
| Move | Left stick | Arrow keys |
| Look / turn | Head, right stick to turn | Mouse |
| Break / attack | Right trigger | Left click |
| Place / eat | Left trigger or either grip | Right click |
| Jump | `A` | `Space` |
| Sprint | Left stick click | `Shift` |
| Crafting | Left grip | `E` |
| Use a door or bed | Left trigger | Right click |
| Wear a piece of armour | Left trigger | Right click |
| Shoot a bow | Left trigger | Right click |
| Climb a ladder | `A` / left stick click | `Space` / `Ctrl` |
| Pick a block | Point at your wrist panel, pull the trigger | `1`–`9` |
| Next / previous block | `B` / `X` | Scroll wheel |
| Toggle flight (creative) | `Y` | `F` |
| Fly up / down | `A` / right stick down | `Space` / `Ctrl` |
| Creative ↔ survival | Choose on the start screen | `C` |

Stick turning is continuous rather than snapped, at 120°/s with a squared
response curve so small nudges aim finely. Continuous rotation is the less
comfortable of the two options in VR — if it makes you queasy, lower or raise
`TURN_SPEED` in `src/main.js`, which is the only constant involved.

The hotbar lives on your left wrist in VR. Aim the right controller at it and the
slot under your pointer highlights; pull the trigger to select that block. Mining
is suppressed while you are pointing at the panel, so the trigger never does both.

Room-scale walking is collided against the world: step into a real wall and the rig
is pushed back rather than letting your head pass through the blocks.

## What's in it

- **Terrain** — infinite streamed chunks from layered value noise: hills, beaches,
  oceans, carved cave systems, coal and iron ores, and scattered trees.
- **Biomes** — plains, forest, desert, snowy taiga and mountains, chosen from two
  slow climate fields the way a Whittaker diagram reads temperature against
  humidity. Deserts lay sand over sandstone and grow cacti, the taiga is snow and
  stepped conifers, and mountains change with altitude rather than climate: grass
  at the foot, bare rock higher, snow on the caps.
- **Building** — 34 placeable blocks, every one reachable from the creative
  palette, including torches, crafting tables and furnaces. Breaking respects
  hardness and tools, drops the right item, and refuses any placement that would
  seal you inside a block. Get wedged anyway — by switching flight off inside
  terrain, say — and the player is lifted clear rather than stuck.
- **The Nether** — a second dimension behind an obsidian portal lit with flint and
  steel: a lava sea under a rock roof, glowstone ceilings, quartz ore, soul sand
  and no sky light at all. One block down there is eight up here, so it is a
  short cut as well as a place. Portals are recognised from the obsidian around
  them rather than recorded anywhere, so they survive chunk streaming untouched.
- **Crafting** — 41 recipes across wood, stone, iron and netherrack, gated by
  whether a crafting table or furnace is within four blocks of you.
- **Armour** — leather and iron sets in four pieces each, worn into dedicated
  slots and soaking damage at Minecraft's four percent per point. Death takes
  your whole inventory and everything you had on.
- **Mobs** — ten kinds: four passive animals, plus zombies, arrow-firing
  skeletons, creepers that detonate and destroy terrain, and fast night spiders;
  and in the Nether, zombie pigmen that are neutral until provoked and ghasts
  that float out of reach lobbing fireballs.
- **Hands** — whatever you have selected is held in your right fist and modelled
  in 3D: tools and the bow out of boxes, full blocks as a textured cube, and
  everything else as its icon extruded into a solid. In VR the hand rides the
  controller's grip space rather than its aim ray, so a pickaxe points out of
  your fist and not down your laser. On desktop the same models are drawn as a
  view model that swings when you mine and bobs when you walk: the arm enters
  from the bottom-right corner, the fist is rolled towards you, and the tool's
  handle runs through the grip rather than sitting on top of it, so it reads as
  held rather than floating.
- **Lighting** — per-voxel sky and block light with flood-fill propagation, plus
  per-vertex ambient occlusion. The two light types are tinted separately in the
  shader: sunlight cools and dims towards night while torchlight stays warm, so a
  lit cave reads as lit rather than merely bright. The day/night cycle is a single
  uniform, so sunset costs nothing to animate.
- **Sky** — a gradient dome with a sun and moon that track the hour, a horizon
  that warms at dawn and dusk, drifting blocky clouds, and stars that fade in.
  Terrain fog blends to the dome's horizon so the view distance ends in sky
  rather than a wall of flat colour.
- **Surfaces** — block textures are randomly rotated per position, which breaks
  up the obvious tiling across a field of stone or dirt without any extra texture
  memory. Water shimmers on a travelling wave.
- **Survival** — health, hunger, fall damage, swimming, ladder climbing, sleeping
  through the night, and a 10-minute day cycle. Food comes from leaves, animals
  and the furnace.
- **Dropped items** — loot, overflow and your whole inventory on death lie on the
  ground as entities that fall, settle, spin and are picked up by walking over
  them. They survive their chunk unloading, so a grave is still there when you
  get back to it.
- **Creative** — unlimited blocks, no damage, flight. The mode the game starts in.

## Layout

```
index.html          Start screen and canvas host
serve-https.py      Optional TLS dev server for Wi-Fi headset testing
vendor/three/       Pinned three.js r169 (module build + VRButton)
src/
  main.js           Renderer, XR session, input mapping, frame loop
  world.js          Chunk storage, terrain generation, light propagation
  mesher.js         Chunk geometry + the terrain shader
  terrain.js        Chunk streaming with a per-frame time budget
  player.js         Collision, locomotion, room-scale rig handling
  interact.js       Breaking, placing, mining progress, hit detection
  mobs.js           Mob AI and projectiles, merged single-draw-call models
  survival.js       Day/night cycle, health, hunger
  inventory.js      Hotbar and stacks
  blocks.js         Block and item registry, tool rules
  crafting.js       Recipes, station requirements, craft and smelt
  craftui.js        Crafting panel, shared by the desktop overlay and VR
  items.js          Items lying on the ground: death drops, loot, overflow
  portal.js         Nether portals: recognising a frame, lighting it, travelling
  held.js           First-person hands and the model of whatever you are holding
  sky.js            Sky dome, sun, moon, clouds, stars, and the Nether's lack of them
  textures.js       Procedurally painted texture atlas (no image files)
  raycast.js        Voxel DDA for aiming
  ui.js             Canvas HUD, shared by the desktop overlay and VR wrist panel
  fx.js  sfx.js     Particle bursts and synthesised sound
  noise.js          Value noise and FBM
```

## Performance notes

Quest has a ~13.9 ms frame budget at 72 Hz. The numbers that matter, measured on
this build:

- Idle frame CPU: **~0.1 ms** — the world is static until something changes.
- Placing or breaking a block: **~5.1 ms** median, **8.0 ms** worst case.
- Chunk rebuild: ~2.3–4.0 ms meshing + ~2.3 ms lighting, depending on how much
  is built in the column.
- A creeper blast: 1.5 ms to carve the blocks, then two frames of ~8 ms and
  ~4 ms as the affected chunks remesh. Chunk rebuilds are atomic, so a very
  large edit always costs at least one full rebuild in the frame that follows.
- A loaded view at radius 4: ~70 chunk columns, 30–40 draw calls after frustum
  culling, ~60k triangles. The sky dome, clouds, sun and moon add four more.
- The Nether, at radius 3: **~0.1 ms** idle, 45 draw calls, ~114k triangles —
  cheaper than the overworld despite a floor and a roof in every column, because
  it is drawn three chunks out rather than four. Forty items lying on the ground
  cost nothing measurable.
- Stepping through a portal: **~110 ms**, once. That is the one deliberate hitch
  in the game — the outgoing dimension's meshes are released and the arrival is
  generated, lit and meshed on the spot, because arriving in an unbuilt world is
  worse than a dropped frame at a moment the player expects a transition.

Design choices behind those numbers: one mesh per 16×64×16 column rather than per
sub-chunk, so draw calls stay low; a padded voxel/light cache per rebuild so the
mesher never does a hashed world lookup in its inner loop; reusable typed-array
vertex buffers; and a per-frame millisecond budget on chunk work so terrain
streaming can never blow a frame.

If you want more view distance, raise `VIEW_CHUNKS` in `src/main.js`. On a PC that
can go to 8 or more comfortably; on Quest, 4–5 is the sweet spot.

## Releasing

GitHub Pages serves assets with `max-age=600` and gives no way to change that.
Without versioned URLs a returning visitor can end up with a freshly fetched
module next to a cached one — and if an export moved between them the page dies
with a module error rather than just behaving like the old build. So every import
specifier carries a `?v=N`, which makes each release a distinct set of URLs: a
browser either keeps the whole old graph or fetches the whole new one.

Bump it before pushing:

```bash
python3 release.py 8
```

That rewrites every import across `src/`, the script tag in `index.html`, and the
`BUILD` string shown in the help panel — which is how you confirm a headset is
running the build you think it is. The query lives in the specifier string, which
relative resolution preserves, so this needs no bundler and no import map.

## Tweaking

The world seed is the `seed` option passed to `Terrain` in `src/main.js`. Block
definitions — hardness, drops, light emission, whether a block is solid or
blended — all live in one table at the top of `src/blocks.js`, and the matching
texture is a small canvas-painting function in `src/textures.js`. Adding a block
means one row in each.

`window.VRCRAFT` is exposed in the console for poking at a running world:
`VRCRAFT.stats()`, `VRCRAFT.teleport(x, y, z)`, `VRCRAFT.setTime(0.8)`, and
`VRCRAFT.step(dt, frames)` to advance deterministically.

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

## Crafting

Open the recipe panel with `E` on desktop, or the left grip in VR, where it floats
in front of you and the right controller points at it. Recipes are ingredient
lists rather than a 3x3 grid — a grid is miserable to operate with motion
controllers, so this works like Minecraft's recipe book: you see everything, and
what you cannot make yet is dimmed with the reason.

The progression is the familiar one. Punch a tree for wood, turn it into planks
and sticks, build a crafting table, and the tool recipes open up. Mine stone for
cobblestone, build a furnace, and smelt iron ore into ingots.

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
| Move | Left stick | `W` `A` `S` `D` |
| Look / turn | Head, right stick to turn | Mouse |
| Break / attack | Right trigger | Left click |
| Place / eat | Left trigger or either grip | Right click |
| Jump | `A` | `Space` |
| Sprint | Left stick click | `Shift` |
| Crafting | Left grip | `E` |
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
- **Building** — 16 placeable blocks, every one reachable from the creative
  palette, including torches, crafting tables and furnaces. Breaking respects
  hardness and tools, drops the right item, and refuses any placement that would
  seal you inside a block. Get wedged anyway — by switching flight off inside
  terrain, say — and the player is lifted clear rather than stuck.
- **Crafting** — 19 recipes across wood, stone and iron, gated by whether a
  crafting table or furnace is within four blocks of you.
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
- **Survival** — health, hunger, fall damage, drowning-free swimming, a 10-minute
  day cycle, pigs that wander and zombies that hunt you after dark and burn at
  dawn. Apples drop from leaves; porkchops drop from pigs.
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
  mobs.js           Pig and zombie AI, merged single-draw-call models
  survival.js       Day/night cycle, health, hunger
  inventory.js      Hotbar and stacks
  blocks.js         Block and item registry, tool rules
  crafting.js       Recipes, station requirements, craft and smelt
  craftui.js        Crafting panel, shared by the desktop overlay and VR
  sky.js            Sky dome, sun, moon, clouds, stars
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
- Placing or breaking a block: **~4.9 ms** median, **9.4 ms** worst case.
- Chunk rebuild: ~2.3 ms meshing + ~1.7 ms lighting.
- A loaded view at radius 4: ~70 chunk columns, 30–40 draw calls after frustum
  culling, ~60k triangles. The sky dome, clouds, sun and moon add four more.

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

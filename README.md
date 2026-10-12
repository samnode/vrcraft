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

## Controls

| Action | VR | Desktop |
| --- | --- | --- |
| Move | Left stick | `W` `A` `S` `D` |
| Look / turn | Head, right stick to snap turn | Mouse |
| Break / attack | Right trigger | Left click |
| Place / eat | Left trigger or either grip | Right click |
| Jump | `A` | `Space` |
| Sprint | Left stick click | `Shift` |
| Next / previous item | `B` / `X` | Scroll or `1`–`9` |
| Toggle flight | `Y` | `F` |
| Fly up / down | `A` / right stick down | `Space` / `Ctrl` |
| Creative ↔ survival | — | `C` |

Room-scale walking is collided against the world: step into a real wall and the rig
is pushed back rather than letting your head pass through the blocks.

## What's in it

- **Terrain** — infinite streamed chunks from layered value noise: hills, beaches,
  oceans, carved cave systems, coal and iron ores, and scattered trees.
- **Building** — break and place 14 block types. Breaking respects hardness, drops
  the right item (stone yields cobblestone, grass yields dirt), and refuses any
  placement that would seal you inside a block.
- **Lighting** — per-voxel sky and block light with flood-fill propagation, plus
  per-vertex ambient occlusion. Glowstone lights caves; the day/night cycle is a
  single shader uniform, so sunset costs nothing to animate.
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
  blocks.js         Block registry
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
- Placing or breaking a block: **~4.4 ms** median, **8.5 ms** worst case.
- Chunk rebuild: ~2.8 ms meshing + ~2.1 ms lighting.
- A loaded view at radius 4: ~70 chunk meshes, 25–40 draw calls after frustum
  culling, ~40–65k triangles.

Design choices behind those numbers: one mesh per 16×64×16 column rather than per
sub-chunk, so draw calls stay low; a padded voxel/light cache per rebuild so the
mesher never does a hashed world lookup in its inner loop; reusable typed-array
vertex buffers; and a per-frame millisecond budget on chunk work so terrain
streaming can never blow a frame.

If you want more view distance, raise `VIEW_CHUNKS` in `src/main.js`. On a PC that
can go to 8 or more comfortably; on Quest, 4–5 is the sweet spot.

## Tweaking

The world seed is the `seed` option passed to `Terrain` in `src/main.js`. Block
definitions — hardness, drops, light emission, whether a block is solid or
blended — all live in one table at the top of `src/blocks.js`, and the matching
texture is a small canvas-painting function in `src/textures.js`. Adding a block
means one row in each.

`window.VRCRAFT` is exposed in the console for poking at a running world:
`VRCRAFT.stats()`, `VRCRAFT.teleport(x, y, z)`, `VRCRAFT.setTime(0.8)`, and
`VRCRAFT.step(dt, frames)` to advance deterministically.

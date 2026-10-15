// Nether portals: recognising a frame, lighting it, putting it out, and building
// the far end of the journey.
//
// A portal is a rectangle of air completely ringed by obsidian in a single
// vertical plane. That one rule is the whole detector, and it is what lets a
// player build a frame any way they like — corners on or off, two wide or three —
// without the game having to store which blocks were "meant" to be a portal.
// Nothing about a portal is recorded anywhere: the obsidian and the purple cells
// in the world are the entire state, so a portal survives the chunk it is in
// being unloaded and reloaded with no bookkeeping at all.

import { AIR, PORTAL, OBSIDIAN, isSolid } from './blocks.js?v=31';
import { SY, NETHER_SEA, NETHER_SCALE } from './world.js?v=31';

// Minecraft's limits, scaled to a 64-block world: at least two wide and three
// tall, and small enough that an ordinary cave can never qualify.
const MIN_W = 2, MAX_W = 4;
const MIN_H = 3, MAX_H = 6;
const MAX_INTERIOR = MAX_W * MAX_H;

const SIX = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
// In-plane neighbours, for a plane whose normal runs along x and along z.
const IN_PLANE = {
  0: [[0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]],
  2: [[0, 1, 0], [0, -1, 0], [1, 0, 0], [-1, 0, 0]],
};

const key = (x, y, z) => `${x},${y},${z}`;

/**
 * Flood the air region containing (x,y,z) within one vertical plane, and report
 * what stopped it. Leaking out of an unfinished frame is handled by the size cap
 * rather than by a special case: an unenclosed region either runs past
 * MAX_INTERIOR cells or ends against something that is not obsidian, and both
 * are rejected below.
 */
function floodPlane(world, x, y, z, axis) {
  const seen = new Set();
  const cells = [];
  const boundary = [];
  const stack = [[x, y, z]];

  while (stack.length) {
    const [cx, cy, cz] = stack.pop();
    if (cy < 0 || cy >= SY) return null;              // open to the sky or the void
    const k = key(cx, cy, cz);
    if (seen.has(k)) continue;
    seen.add(k);

    const id = world.get(cx, cy, cz);
    if (id !== AIR && id !== PORTAL) { boundary.push(id); continue; }

    cells.push([cx, cy, cz]);
    if (cells.length > MAX_INTERIOR) return null;
    for (const [dx, dy, dz] of IN_PLANE[axis]) stack.push([cx + dx, cy + dy, cz + dz]);
  }

  return { cells, boundary };
}

/**
 * The portal interior containing this air cell, or null. `axis` names which way
 * the plane's normal points: 0 for a portal you walk through along x, 2 along z.
 */
function scanFrame(world, x, y, z, axis) {
  const found = floodPlane(world, x, y, z, axis);
  if (!found || !found.cells.length) return null;
  // Every cell the flood stopped against has to be obsidian. Because the flood
  // only ever steps in four directions, that set is exactly the ring Minecraft
  // requires — the diagonal corners are never consulted, so they stay optional.
  if (!found.boundary.length) return null;
  for (const id of found.boundary) if (id !== OBSIDIAN) return null;

  // Must be a filled rectangle of a sane size, or a ragged pocket in an obsidian
  // wall would light up as a portal.
  let minA = Infinity, maxA = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [cx, cy, cz] of found.cells) {
    const a = axis === 0 ? cz : cx;
    if (a < minA) minA = a;
    if (a > maxA) maxA = a;
    if (cy < minY) minY = cy;
    if (cy > maxY) maxY = cy;
  }
  const w = maxA - minA + 1, h = maxY - minY + 1;
  if (w < MIN_W || w > MAX_W || h < MIN_H || h > MAX_H) return null;
  if (found.cells.length !== w * h) return null;

  return { cells: found.cells, axis, width: w, height: h };
}

/**
 * Strike a light against a block. Returns what happened, so the caller can tell
 * the player whether the frame was wrong or there was no frame at all.
 */
export function ignite(world, x, y, z) {
  // The struck block itself first, then its neighbours: a player lights the
  // obsidian at the bottom of the frame, which means the air to be filled is the
  // cell above the one actually hit.
  const seeds = [[x, y, z], ...SIX.map(([dx, dy, dz]) => [x + dx, y + dy, z + dz])];
  let sawAir = false;

  for (const [sx, sy, sz] of seeds) {
    if (world.get(sx, sy, sz) !== AIR) continue;
    sawAir = true;
    for (const axis of [0, 2]) {
      const frame = scanFrame(world, sx, sy, sz, axis);
      if (!frame) continue;
      for (const [cx, cy, cz] of frame.cells) world.set(cx, cy, cz, PORTAL);
      return { lit: true, cells: frame.cells.length, axis: frame.axis };
    }
  }
  return { lit: false, sawAir };
}

/**
 * Put out the sheet touching this position. Called when the frame is broken: the
 * flood is in all three dimensions, which is safe because a portal is only ever
 * one cell thick and so cannot reach another one that is not touching it.
 */
export function extinguish(world, x, y, z) {
  const seen = new Set();
  const stack = [[x, y, z]];
  let removed = 0;

  while (stack.length) {
    const [cx, cy, cz] = stack.pop();
    const k = key(cx, cy, cz);
    if (seen.has(k)) continue;
    seen.add(k);
    if (world.get(cx, cy, cz) !== PORTAL) continue;
    world.set(cx, cy, cz, AIR);
    removed++;
    for (const [dx, dy, dz] of SIX) stack.push([cx + dx, cy + dy, cz + dz]);
  }
  return removed;
}

/** Is a portal sheet touching this block? Used to decide whether breaking it matters. */
export function portalAdjacent(world, x, y, z) {
  for (const [dx, dy, dz] of SIX) {
    if (world.get(x + dx, y + dy, z + dz) === PORTAL) return [x + dx, y + dy, z + dz];
  }
  return null;
}

// ---------------------------------------------------------------- travelling

/** Where a position in one dimension comes out in the other. */
export function mapCoords(x, z, toNether) {
  const f = toNether ? 1 / NETHER_SCALE : NETHER_SCALE;
  return { x: Math.floor(x * f), z: Math.floor(z * f) };
}

/** Squares around a centre, nearest first — the search order for a destination. */
function spiral(radius) {
  const out = [];
  for (let dz = -radius; dz <= radius; dz++) {
    for (let dx = -radius; dx <= radius; dx++) out.push([dx, dz, dx * dx + dz * dz]);
  }
  out.sort((a, b) => a[2] - b[2]);
  return out;
}

const NEAR = spiral(12);
// Wider than the portal search: a Nether pillar can be twenty blocks across, and
// a site hunt that gives up inside one would strand the arrival in solid rock.
const WIDE = spiral(16);

/**
 * The nearest existing portal to (x,z), as a place to stand. Returns null if
 * there is none within the search square or the chunks are not loaded.
 */
export function findPortal(world, x, z) {
  for (const [dx, dz] of NEAR) {
    const cx = x + dx, cz = z + dz;
    for (let y = 1; y < SY - 1; y++) {
      if (world.get(cx, y, cz) !== PORTAL) continue;
      // Stand at the bottom of the sheet, which is where a player walks in.
      let base = y;
      while (base > 1 && world.get(cx, base - 1, cz) === PORTAL) base--;
      return { x: cx + 0.5, y: base, z: cz + 0.5 };
    }
  }
  return null;
}

const FRAME_W = 2, FRAME_H = 3;          // the interior that gets built

/**
 * Build a portal, frame and all, somewhere a player can stand at (x,z) — and if
 * nowhere there will do, on a pad of obsidian hung in the open. Minecraft does
 * the same thing, and for the same reason: arriving is not allowed to fail.
 */
export function buildPortal(world, x, z) {
  const site = chooseSite(world, x, z);
  const { px, py, pz } = site;

  // Clear the pocket first. The frame is in the x = px plane, so the space to
  // open up is one cell either side of it: the player has to be able to step
  // through, and the far side has to be somewhere to land rather than rock.
  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -2; dz <= FRAME_W + 1; dz++) {
      for (let dy = 0; dy <= FRAME_H + 2; dy++) world.set(px + dx, py + dy, pz + dz, AIR);
    }
  }
  // A floor under the whole pocket, so nothing built in the air drops you.
  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -2; dz <= FRAME_W + 1; dz++) {
      if (!isSolid(world.get(px + dx, py - 1, pz + dz))) {
        world.set(px + dx, py - 1, pz + dz, OBSIDIAN);
      }
    }
  }

  // The frame: the full 4x5 rectangle minus its interior. Corners are optional
  // to the detector but they are what makes a built portal look built.
  for (let dz = -1; dz <= FRAME_W; dz++) {
    for (let dy = -1; dy <= FRAME_H; dy++) {
      const inside = dz >= 0 && dz < FRAME_W && dy >= 0 && dy < FRAME_H;
      world.set(px, py + dy, pz + dz, inside ? PORTAL : OBSIDIAN);
    }
  }

  return { x: px + 0.5, y: py, z: pz + 0.5, built: true };
}

/**
 * Somewhere to put a portal near (x,z): a standable column if one exists within
 * the search square, otherwise an altitude to hang a pad at. In the Nether the
 * fallback sits well clear of the lava sea; in the overworld it sits at sea level,
 * which is above water and below the clouds either way.
 */
function chooseSite(world, x, z) {
  for (const [dx, dz] of WIDE) {
    const cx = x + dx, cz = z + dz;
    // The frame needs five clear cells over the floor, so demanding that much
    // head room here is both honest and a filter: a spot that cannot fit a
    // portal is not a spot, however standable it looks.
    const y = world.standY(cx, cz, FRAME_H + 2);
    if (y < 2 || y > SY - FRAME_H - 4) continue;
    return { px: cx, py: y, pz: cz };
  }
  const py = world.nether ? NETHER_SEA + 16 : Math.floor(SY / 2);
  return { px: x, py, pz: z };
}

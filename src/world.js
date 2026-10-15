// Chunked voxel world: storage, terrain generation and light propagation.
// One chunk is a full 16x64x16 column, which keeps the draw-call count low on Quest
// (one opaque + one transparent mesh per column) at the cost of slightly larger
// rebuilds when a block changes.
//
// A World is one dimension. The overworld and the Nether are two instances with
// different generators and different answers to "how bright is somewhere nobody
// has loaded yet" — 15 under an open sky, 0 under a rock roof. Both stay resident
// while you play, so the house you built is still standing when you come back.

import { fbm2, value3, rand2 } from './noise.js?v=31';
import {
  AIR, GRASS, DIRT, STONE, SAND, LOG, LEAVES, WATER, COAL_ORE, IRON_ORE,
  SNOW, SNOWY_GRASS, SANDSTONE, CACTUS, SPRUCE_LEAVES,
  NETHERRACK, LAVA, SOUL_SAND, QUARTZ_ORE, OBSIDIAN, GLOWSTONE,
  block, isOpaque, isSolid,
} from './blocks.js?v=31';

export const SX = 16, SY = 64, SZ = 16;
export const SEA_LEVEL = 26;
// The Nether's lava sea, and the band of rock its roof occupies.
export const NETHER_SEA = 10;
export const DIM = { OVERWORLD: 'overworld', NETHER: 'nether' };
// Horizontal squeeze between the two dimensions, as in Minecraft: one step here
// is eight over there, which is the entire reason to travel through the Nether.
export const NETHER_SCALE = 8;
export const BIOME = { PLAINS: 0, FOREST: 1, DESERT: 2, SNOWY: 3, MOUNTAINS: 4 };
export const BIOME_NAMES = ['Plains', 'Forest', 'Desert', 'Snowy', 'Mountains'];
const VOLUME = SX * SY * SZ;

export const idx = (x, y, z) => (y * SZ + z) * SX + x;
export const chunkKey = (cx, cz) => `${cx},${cz}`;

export class Chunk {
  constructor(cx, cz) {
    this.cx = cx;
    this.cz = cz;
    this.voxels = new Uint8Array(VOLUME);
    this.skyLight = new Uint8Array(VOLUME);
    this.blockLight = new Uint8Array(VOLUME);
    this.generated = false;
    this.dirty = true;       // needs a mesh rebuild
    this.lightDirty = true;  // needs a light recompute
    this.mesh = null;
    this.waterMesh = null;
    this.transparentMesh = null;
    this.portalMesh = null;
    // Tallest non-air voxel per column, used to skip empty sky during meshing.
    this.heights = new Uint8Array(SX * SZ);
  }

  get(x, y, z) {
    if (y < 0 || y >= SY) return AIR;
    return this.voxels[idx(x, y, z)];
  }

  set(x, y, z, id) {
    this.voxels[idx(x, y, z)] = id;
    const h = this.heights[z * SX + x];
    if (id !== AIR && y >= h) this.heights[z * SX + x] = y + 1;
    else if (id === AIR && y === h - 1) {
      let ny = y;
      while (ny > 0 && this.voxels[idx(x, ny - 1, z)] === AIR) ny--;
      this.heights[z * SX + x] = ny;
    }
  }
}

export class World {
  constructor(seed = 1337, kind = DIM.OVERWORLD) {
    this.seed = seed;
    this.kind = kind;
    this.nether = kind === DIM.NETHER;
    this.chunks = new Map();
    // Sky light where there is no chunk to ask, and above the world roof. The
    // Nether answers 0, which is what makes it genuinely dark rather than
    // merely tinted — and it means breaking through the roof lets in nothing.
    this.skyDefault = this.nether ? 0 : 15;
    // What lies below y=0. Only the mesher sees it, to cull the bottom face.
    this.baseBlock = this.nether ? NETHERRACK : STONE;
  }

  getChunk(cx, cz, create = false) {
    const key = chunkKey(cx, cz);
    let c = this.chunks.get(key);
    if (!c && create) {
      c = new Chunk(cx, cz);
      this.chunks.set(key, c);
      this.generate(c);
    }
    return c;
  }

  /** Block id at world coords; AIR outside loaded chunks, STONE below the world. */
  get(x, y, z) {
    if (y < 0) return this.baseBlock;
    if (y >= SY) return AIR;
    const cx = Math.floor(x / SX), cz = Math.floor(z / SZ);
    const c = this.chunks.get(chunkKey(cx, cz));
    if (!c) return AIR;
    return c.voxels[idx(x - cx * SX, y, z - cz * SZ)];
  }

  /** Writes a block and marks the owning chunk (and touched neighbours) dirty. */
  set(x, y, z, id) {
    if (y < 0 || y >= SY) return false;
    const cx = Math.floor(x / SX), cz = Math.floor(z / SZ);
    const c = this.chunks.get(chunkKey(cx, cz));
    if (!c) return false;
    const lx = x - cx * SX, lz = z - cz * SZ;
    if (c.voxels[idx(lx, y, z - cz * SZ)] === id) return false;
    c.set(lx, y, lz, id);
    c.dirty = true;
    c.lightDirty = true;
    // Light and face culling cross chunk borders, so refresh the neighbours too.
    if (lx === 0) this.touch(cx - 1, cz);
    if (lx === SX - 1) this.touch(cx + 1, cz);
    if (lz === 0) this.touch(cx, cz - 1);
    if (lz === SZ - 1) this.touch(cx, cz + 1);
    return true;
  }

  touch(cx, cz) {
    const c = this.chunks.get(chunkKey(cx, cz));
    if (c) { c.dirty = true; c.lightDirty = true; }
  }

  lightAt(x, y, z) {
    if (y >= SY) return [this.skyDefault, 0];
    if (y < 0) return [0, 0];
    const cx = Math.floor(x / SX), cz = Math.floor(z / SZ);
    const c = this.chunks.get(chunkKey(cx, cz));
    if (!c) return [this.skyDefault, 0];
    const i = idx(x - cx * SX, y, z - cz * SZ);
    return [c.skyLight[i], c.blockLight[i]];
  }

  // ---------------------------------------------------------------- generation

  // ------------------------------------------------------------------- biomes

  /**
   * How mountainous this spot is, 0..1 and smooth. Height blends through this
   * rather than stepping with the biome, because a hard change in amplitude at a
   * biome border would carve a cliff along the whole seam.
   */
  mountainFactor(x, z) {
    const p = fbm2(x / 260, z / 260, this.seed + 3003, 3);
    const t = Math.min(1, Math.max(0, (p - 0.50) / 0.26));
    return t * t * (3 - 2 * t);
  }

  /**
   * Which biome covers this column. Two slow climate fields, read the way a
   * Whittaker diagram does: temperature decides hot from cold, humidity decides
   * forest from open ground. Only surface blocks and planting read this, so the
   * boundaries can be abrupt without showing as terrain seams.
   */
  biomeAt(x, z) {
    if (this.mountainFactor(x, z) > 0.55) return BIOME.MOUNTAINS;
    const temp = fbm2(x / 420, z / 420, this.seed + 1001, 3);
    const wet = fbm2(x / 330, z / 330, this.seed + 2002, 3);
    if (temp > 0.60 && wet < 0.46) return BIOME.DESERT;
    if (temp < 0.38) return BIOME.SNOWY;
    if (wet > 0.54) return BIOME.FOREST;
    return BIOME.PLAINS;
  }

  /** Surface height as a pure function of world x,z so chunks always agree. */
  terrainHeight(x, z) {
    const continent = fbm2(x / 220, z / 220, this.seed, 3);
    const hills = fbm2(x / 48, z / 48, this.seed + 17, 4);
    const detail = fbm2(x / 14, z / 14, this.seed + 91, 2);
    // Push the continent term through a curve so plains stay flat and peaks spike.
    const base = SEA_LEVEL - 2 + continent * 10;
    const amp = 14 + this.mountainFactor(x, z) * 30;
    const raw = base + Math.pow(hills, 1.6) * amp + detail * 3;
    // Soft ceiling. A hard clamp against the world roof slices peaks into flat
    // plateaus; this rounds them off instead and never quite reaches the top.
    const KNEE = SY - 14;
    if (raw <= KNEE) return Math.floor(raw);
    return Math.floor(KNEE + (1 - Math.exp(-(raw - KNEE) / 8)) * 6);
  }

  /**
   * The block laid on top of a column. Mountains are the odd one: they change
   * with altitude rather than climate, so a single peak runs grass to bare rock
   * to snow the way a real one does.
   */
  surfaceBlock(biome, h) {
    switch (biome) {
      case BIOME.DESERT: return SAND;
      case BIOME.SNOWY: return SNOWY_GRASS;
      case BIOME.MOUNTAINS:
        if (h > 44) return SNOW;
        if (h > 36) return STONE;
        return GRASS;
      default: return GRASS;
    }
  }

  /** What sits in the few blocks under the surface. */
  fillerBlock(biome, h) {
    if (biome === BIOME.DESERT) return SANDSTONE;
    if (biome === BIOME.MOUNTAINS && h > 36) return STONE;
    return DIRT;
  }

  /** True where a cave carves out the rock at this position. */
  isCave(x, y, z) {
    if (y < 2) return false;
    const a = value3(x / 26, y / 15, z / 26, this.seed + 303);
    const b = value3(x / 17, y / 11, z / 17, this.seed + 404);
    // Two noise fields near their midpoints intersect in tunnel-like shapes.
    return Math.abs(a - 0.5) < 0.07 && Math.abs(b - 0.5) < 0.09;
  }

  generate(c) {
    if (this.nether) this.generateNether(c);
    else this.generateOverworld(c);
  }

  generateOverworld(c) {
    const ox = c.cx * SX, oz = c.cz * SZ;

    for (let lz = 0; lz < SZ; lz++) {
      for (let lx = 0; lx < SX; lx++) {
        const wx = ox + lx, wz = oz + lz;
        const h = Math.max(1, Math.min(SY - 6, this.terrainHeight(wx, wz)));
        const beach = h <= SEA_LEVEL + 1;

        const biome = this.biomeAt(wx, wz);

        for (let y = 0; y <= Math.max(h, SEA_LEVEL); y++) {
          let id = AIR;
          if (y <= h) {
            if (y === h) id = beach ? SAND : this.surfaceBlock(biome, h);
            else if (y > h - 4) id = beach ? SAND : this.fillerBlock(biome, h);
            else id = STONE;
            if (id === STONE) {
              const r = rand2(wx * 31 + y, wz * 17 - y, this.seed + 55);
              if (y < 20 && r > 0.988) id = IRON_ORE;
              else if (y < 34 && r > 0.972) id = COAL_ORE;
              // Obsidian seams, down where the rock is oldest. Two rolls rather
              // than one: the point sample decides whether a cell is obsidian,
              // the smooth field decides where seams are allowed at all, so what
              // you find is a vein worth following rather than isolated specks.
              if (y < 13 && rand2(wx * 7 - y, wz * 11 + y, this.seed + 66) > 0.976
                  && fbm2(wx / 7, wz / 7, this.seed + 67, 2) > 0.58) id = OBSIDIAN;
            }
            if (y < h && this.isCave(wx, y, wz)) id = AIR;
          }
          if (id === AIR && y <= SEA_LEVEL) id = WATER;
          if (id !== AIR) c.set(lx, y, lz, id);
        }
      }
    }

    this.plantTrees(c);
    c.generated = true;
  }

  // How thickly each biome plants, as the cut-off a per-column random must beat.
  // Deserts never pass; they get cacti from a separate roll instead.
  static TREE_ODDS = [0.994, 0.974, 1.1, 0.990, 0.996];

  /**
   * Trees are keyed off global coordinates and written from a padded candidate
   * region, so a canopy straddling a chunk border still appears in both halves.
   */
  plantTrees(c) {
    const pad = 4;
    for (let dz = -pad; dz < SZ + pad; dz++) {
      for (let dx = -pad; dx < SX + pad; dx++) {
        const wx = c.cx * SX + dx, wz = c.cz * SZ + dz;
        const biome = this.biomeAt(wx, wz);
        const roll = rand2(wx, wz, this.seed + 7);

        if (biome === BIOME.DESERT) { this.plantCactus(c, wx, wz, roll); continue; }
        if (roll < World.TREE_ODDS[biome]) continue;

        const h = Math.max(1, Math.min(SY - 6, this.terrainHeight(wx, wz)));
        if (h <= SEA_LEVEL + 1 || h > SY - 12) continue;      // no trees in water or sky
        // Nothing grows on bare mountain rock or on a snow cap.
        if (biome === BIOME.MOUNTAINS && h > 36) continue;
        if (this.isCave(wx, h, wz)) continue;

        const put = this.writer(c);
        if (biome === BIOME.SNOWY) this.spruce(put, wx, wz, h);
        else this.oak(put, wx, wz, h);
      }
    }
  }

  /** Clipped block writer for a chunk: anything outside it is another chunk's job. */
  writer(c) {
    return (x, y, z, id, overwrite) => {
      const lx = x - c.cx * SX, lz = z - c.cz * SZ;
      if (lx < 0 || lx >= SX || lz < 0 || lz >= SZ || y < 0 || y >= SY) return;
      if (!overwrite && c.get(lx, y, lz) !== AIR) return;
      c.set(lx, y, lz, id);
    };
  }

  /** The round-canopied tree of the plains and forests. */
  oak(put, wx, wz, h) {
    const trunk = 4 + Math.floor(rand2(wx, wz, this.seed + 8) * 3);
    for (let i = 1; i <= trunk; i++) put(wx, h + i, wz, LOG, true);
    const top = h + trunk;
    for (let ly = -2; ly <= 1; ly++) {
      const r = ly >= 1 ? 1 : 2;
      for (let lz2 = -r; lz2 <= r; lz2++) {
        for (let lx2 = -r; lx2 <= r; lx2++) {
          if (Math.abs(lx2) === r && Math.abs(lz2) === r && r > 1) continue; // round the corners
          put(wx + lx2, top + ly, wz + lz2, LEAVES, false);
        }
      }
    }
    put(wx, top + 2, wz, LEAVES, false);
  }

  /** Taller and conical, with the canopy stepping in as it climbs. */
  spruce(put, wx, wz, h) {
    const trunk = 8 + Math.floor(rand2(wx, wz, this.seed + 8) * 4);
    for (let i = 1; i <= trunk; i++) put(wx, h + i, wz, LOG, true);
    const top = h + trunk;
    put(wx, top + 1, wz, SPRUCE_LEAVES, false);
    // Skirts alternating narrow and wide on the way down. The alternation is the
    // whole trick: a canopy of constant radius reads as a dark pillar, not a fir.
    for (let i = 0; i < 7; i++) {
      const r = i === 0 ? 1 : (i % 2 === 1 ? 2 : 1);
      for (let lz2 = -r; lz2 <= r; lz2++) {
        for (let lx2 = -r; lx2 <= r; lx2++) {
          if (Math.abs(lx2) === r && Math.abs(lz2) === r) continue;    // clip corners
          put(wx + lx2, top - i, wz + lz2, SPRUCE_LEAVES, false);
        }
      }
    }
  }

  /** A short column of cactus, the only thing standing in a desert. */
  plantCactus(c, wx, wz, roll) {
    if (roll < 0.9955) return;
    const h = Math.max(1, Math.min(SY - 6, this.terrainHeight(wx, wz)));
    if (h <= SEA_LEVEL + 1 || h > SY - 8) return;
    if (this.isCave(wx, h, wz)) return;
    const put = this.writer(c);
    const tall = 2 + Math.floor(rand2(wx, wz, this.seed + 9) * 2);
    for (let i = 1; i <= tall; i++) put(wx, h + i, wz, CACTUS, true);
  }

  // -------------------------------------------------------------- the Nether

  /**
   * The Nether is one enormous cavern rather than a landscape: a lava sea at the
   * bottom, a rock roof you cannot see past at the top, and a floor of netherrack
   * between them. Generating it as a floor height and a roof height per column,
   * then eating holes in both with 3D noise, gives the overhangs and the ragged
   * ceiling without ever needing a density field over the whole volume.
   */
  netherFloor(x, z) {
    // The range deliberately straddles the lava: where the floor comes out below
    // NETHER_SEA the column floods and you get a lake, and where it comes out
    // above you get dry ground. A floor that never dipped under the sea would
    // bury the lava entirely and leave the Nether a dry cave system.
    return NETHER_SEA - 6 + Math.floor(fbm2(x / 44, z / 44, this.seed + 9001, 3) * 21);
  }

  /** The underside of the roof. Everything from here up is solid. */
  netherRoof(x, z) {
    return SY - 7 - Math.floor(fbm2(x / 52, z / 52, this.seed + 9002, 3) * 13);
  }

  generateNether(c) {
    const ox = c.cx * SX, oz = c.cz * SZ;

    for (let lz = 0; lz < SZ; lz++) {
      for (let lx = 0; lx < SX; lx++) {
        const wx = ox + lx, wz = oz + lz;
        const floor = this.netherFloor(wx, wz);
        const roof = this.netherRoof(wx, wz);
        const span = Math.max(1, roof - floor);
        // Where columns of rock bridge the cavern. Tapering the threshold with
        // height is what makes them stalagmites: wide at the floor, pinched as
        // they climb, and only the strongest ones reach the ceiling.
        const column = fbm2(wx / 30, wz / 30, this.seed + 9003, 2);

        for (let y = 0; y < SY; y++) {
          let id = AIR;
          if (y <= floor || y >= roof) id = NETHERRACK;
          else if (column > 0.74 + ((y - floor) / span) * 0.22) id = NETHERRACK;

          // Hollows bitten out of the bulk rock. They undercut the floor into
          // overhangs and leave the ceiling pitted rather than planed flat.
          if (id === NETHERRACK && y > 1 && y < SY - 2
              && value3(wx / 19, y / 13, wz / 19, this.seed + 9004) > 0.72) id = AIR;

          if (id === AIR && y <= NETHER_SEA) id = LAVA;
          else if (id === NETHERRACK) id = this.netherVein(wx, y, wz, roof);
          if (id !== AIR) c.set(lx, y, lz, id);
        }

        this.netherDressing(c, lx, lz, wx, wz);
      }
    }
    c.generated = true;
  }

  /** What a given cell of netherrack turns out to actually be. */
  netherVein(x, y, z, roof) {
    // Glowstone grows on the ceiling, in clusters: one roll decides the cell,
    // a smooth field decides whether this patch of ceiling has any at all.
    if (y >= roof && y <= roof + 2) {
      if (fbm2(x / 11, z / 11, this.seed + 9006, 2) > 0.66
          && rand2(x * 19 + y, z * 23 - y, this.seed + 9005) > 0.52) return GLOWSTONE;
    }
    // Obsidian crusts the lava shore, which matters more than it looks: it is a
    // second source of portal frame for anyone who arrives and loses theirs.
    // The band stops at the sea's own level rather than above it — the Nether
    // floor sits mostly a block or two higher, and a band that reached it would
    // tile a tenth of the open ground in black.
    if (y >= NETHER_SEA - 3 && y <= NETHER_SEA + 1
        && rand2(x * 13 - y, z * 29 + y, this.seed + 9007) > 0.90) return OBSIDIAN;
    const r = rand2(x * 31 + y, z * 17 - y, this.seed + 9008);
    if (r > 0.978) return QUARTZ_ORE;
    return NETHERRACK;
  }

  /** Soul sand drifts across the open floor, in patches you can see the edge of. */
  netherDressing(c, lx, lz, wx, wz) {
    if (fbm2(wx / 21, wz / 21, this.seed + 9009, 2) < 0.62) return;
    // Dress whatever the actual top of this column turned out to be, which after
    // the hollows is not necessarily the floor height the column started from.
    // Starting below the cavern ceiling rather than at the world roof: the very
    // top of the world has open sky above it as far as a chunk is concerned, so
    // a scan from there dresses the outside of the roof, where nobody can see it.
    for (let y = this.netherRoof(wx, wz) - 1; y > NETHER_SEA; y--) {
      if (c.get(lx, y, lz) !== NETHERRACK) continue;
      if (c.get(lx, y + 1, lz) !== AIR) continue;
      c.set(lx, y, lz, SOUL_SAND);
      return;
    }
  }

  // ------------------------------------------------------------------- lighting

  /**
   * Sky light falls straight down unobstructed, then both light types spread
   * horizontally with a BFS. Spreading is clamped to the chunk, so deep caves can
   * show a faint seam at chunk borders; direct sky light is global and matches.
   */
  computeLight(c) {
    const sky = c.skyLight, blk = c.blockLight;
    sky.fill(0);
    blk.fill(0);

    const queue = [];
    for (let lz = 0; lz < SZ; lz++) {
      for (let lx = 0; lx < SX; lx++) {
        // In the Nether this starts at zero, so the whole descent is skipped and
        // the sky field stays empty. Everything you can see down there is lit by
        // glowstone, lava or a torch you carried in.
        let level = this.skyDefault;
        for (let y = SY - 1; y >= 0; y--) {
          const id = c.voxels[idx(lx, y, lz)];
          if (isOpaque(id)) level = 0;
          else if (id === WATER && level > 0) level = Math.max(0, level - 2); // murk
          if (level > 0) {
            sky[idx(lx, y, lz)] = level;
            queue.push((lx << 16) | (y << 8) | lz);
          }
        }
      }
    }
    this.spread(c, sky, queue);

    const emitters = [];
    for (let i = 0; i < VOLUME; i++) {
      const id = c.voxels[i];
      if (id !== AIR && block(id).light > 0) {
        blk[i] = block(id).light;
        const y = Math.floor(i / (SX * SZ));
        const rem = i - y * SX * SZ;
        emitters.push(((rem % SX) << 16) | (y << 8) | Math.floor(rem / SX));
      }
    }
    this.spread(c, blk, emitters);
    c.lightDirty = false;
  }

  spread(c, field, queue) {
    const N = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
    for (let head = 0; head < queue.length; head++) {
      const p = queue[head];
      const lx = (p >> 16) & 0xff, y = (p >> 8) & 0xff, lz = p & 0xff;
      const level = field[idx(lx, y, lz)];
      if (level <= 1) continue;
      for (const [dx, dy, dz] of N) {
        const nx = lx + dx, ny = y + dy, nz = lz + dz;
        if (nx < 0 || nx >= SX || nz < 0 || nz >= SZ || ny < 0 || ny >= SY) continue;
        const i = idx(nx, ny, nz);
        if (isOpaque(c.voxels[i])) continue;
        if (field[i] >= level - 1) continue;
        field[i] = level - 1;
        queue.push((nx << 16) | (ny << 8) | nz);
      }
    }
  }

  // ------------------------------------------------------------------ queries

  solidAt(x, y, z) { return isSolid(this.get(Math.floor(x), Math.floor(y), Math.floor(z))); }

  /** Ground height for spawning: first air above the highest solid at x,z. */
  surfaceY(x, z) {
    const xi = Math.floor(x), zi = Math.floor(z);
    for (let y = SY - 1; y > 0; y--) {
      if (isSolid(this.get(xi, y, zi))) return y + 1;
    }
    return SEA_LEVEL + 1;
  }

  /**
   * Somewhere a player can actually stand. In the overworld that is the surface;
   * in the Nether the surface is the underside of the roof, so this looks instead
   * for solid rock with head room above it and nothing molten underfoot. Returns
   * -1 when the column offers nowhere, which is normal above the lava sea.
   */
  standY(x, z, clear = 3) {
    if (!this.nether) return this.surfaceY(x, z);
    const xi = Math.floor(x), zi = Math.floor(z);
    // Down from the ceiling of the open cavern — not up from the lava, and not
    // down from the world roof. Scanning up finds the first sealed pocket the
    // hollow noise bit out of the bulk rock, somewhere nobody can reach; from
    // the world roof it finds a ledge inside the ceiling, somewhere nobody can
    // leave. From the cavern ceiling the first solid cell is the surface you
    // would land on if you dropped, which is the floor or the top of a pillar.
    const top = Math.min(SY - 2, this.netherRoof(xi, zi) - 1);
    for (let y = top; y > NETHER_SEA; y--) {
      if (!isSolid(this.get(xi, y, zi))) continue;
      // That first solid cell is the surface, so if the head room is not there
      // this column simply has none: anything further down is under it.
      for (let h = 1; h <= clear; h++) if (this.get(xi, y + h, zi) !== AIR) return -1;
      return y + 1;
    }
    return -1;              // open to the lava all the way down: a lake
  }
}

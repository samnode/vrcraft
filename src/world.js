// Chunked voxel world: storage, terrain generation and light propagation.
// One chunk is a full 16x64x16 column, which keeps the draw-call count low on Quest
// (one opaque + one transparent mesh per column) at the cost of slightly larger
// rebuilds when a block changes.

import { fbm2, value3, rand2 } from './noise.js?v=20';
import {
  AIR, GRASS, DIRT, STONE, SAND, LOG, LEAVES, WATER, COAL_ORE, IRON_ORE,
  SNOW, SNOWY_GRASS, SANDSTONE, CACTUS, SPRUCE_LEAVES,
  block, isOpaque, isSolid,
} from './blocks.js?v=20';

export const SX = 16, SY = 64, SZ = 16;
export const SEA_LEVEL = 26;
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
  constructor(seed = 1337) {
    this.seed = seed;
    this.chunks = new Map();
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
    if (y < 0) return STONE;
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
    if (y >= SY) return [15, 0];
    if (y < 0) return [0, 0];
    const cx = Math.floor(x / SX), cz = Math.floor(z / SZ);
    const c = this.chunks.get(chunkKey(cx, cz));
    if (!c) return [15, 0];
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
        let level = 15;
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
}

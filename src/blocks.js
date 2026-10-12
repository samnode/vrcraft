// Block registry. Tile indices refer to the procedural atlas built in textures.js,
// which must declare tiles in the same order as TILES below.

export const AIR = 0;

export const TILES = [
  'grass_top', 'grass_side', 'dirt', 'stone', 'sand', 'log_top', 'log_side',
  'leaves', 'planks', 'cobble', 'water', 'glass', 'brick', 'glowstone',
  'coal_ore', 'iron_ore', 'apple', 'porkchop',
];

const tile = {};
TILES.forEach((name, i) => { tile[name] = i; });

/**
 * faces: [+x, -x, +y, -y, +z, -z] tile indices.
 * hardness: seconds to mine bare-handed; null means unbreakable.
 * drop: block id yielded when broken (defaults to the block itself).
 * opaque: blocks light and culls neighbouring faces.
 * solid: participates in player/mob collision.
 */
function def(id, name, opts) {
  const t = opts.all !== undefined
    ? [opts.all, opts.all, opts.all, opts.all, opts.all, opts.all]
    : [opts.side, opts.side, opts.top, opts.bottom ?? opts.side, opts.side, opts.side];
  return {
    id, name,
    faces: t,
    hardness: opts.hardness ?? 1,
    drop: opts.drop === null ? null : (opts.drop ?? id),
    opaque: opts.opaque ?? true,
    solid: opts.solid ?? true,
    light: opts.light ?? 0,
    // blend: drawn in the alpha-blended pass. Non-blended, non-opaque blocks
    // (leaves) are alpha-tested in the opaque pass so they depth-sort correctly.
    blend: opts.blend ?? false,
    food: opts.food ?? 0,
    // item: carried and eaten but never placed as a voxel.
    item: opts.item ?? false,
  };
}

export const BLOCKS = [];
function add(b) { BLOCKS[b.id] = b; return b.id; }

export const GRASS     = add(def(1,  'Grass',     { top: tile.grass_top, side: tile.grass_side, bottom: tile.dirt, hardness: 0.6, drop: 2 }));
export const DIRT      = add(def(2,  'Dirt',      { all: tile.dirt,    hardness: 0.5 }));
export const STONE     = add(def(3,  'Stone',     { all: tile.stone,   hardness: 1.5, drop: 8 }));
export const SAND      = add(def(4,  'Sand',      { all: tile.sand,    hardness: 0.5 }));
export const LOG       = add(def(5,  'Wood',      { top: tile.log_top, side: tile.log_side, hardness: 1.0 }));
export const LEAVES    = add(def(6,  'Leaves',    { all: tile.leaves,  hardness: 0.2, opaque: false, solid: true }));
export const PLANKS    = add(def(7,  'Planks',    { all: tile.planks,  hardness: 0.8 }));
export const COBBLE    = add(def(8,  'Cobblestone',{ all: tile.cobble, hardness: 1.5 }));
export const WATER     = add(def(9,  'Water',     { all: tile.water,   hardness: null, opaque: false, solid: false, blend: true }));
export const GLASS     = add(def(10, 'Glass',     { all: tile.glass,   hardness: 0.3, opaque: false, drop: null, blend: true }));
export const BRICK     = add(def(11, 'Brick',     { all: tile.brick,   hardness: 1.6 }));
export const GLOWSTONE = add(def(12, 'Glowstone', { all: tile.glowstone, hardness: 0.4, light: 14 }));
export const COAL_ORE  = add(def(13, 'Coal Ore',  { all: tile.coal_ore, hardness: 2.0 }));
export const IRON_ORE  = add(def(14, 'Iron Ore',  { all: tile.iron_ore, hardness: 2.5 }));

export const APPLE     = add(def(15, 'Apple',     { all: tile.apple,    item: true, food: 4 }));
export const PORKCHOP  = add(def(16, 'Porkchop',  { all: tile.porkchop, item: true, food: 8 }));

export const BLOCK_COUNT = BLOCKS.length;
export function isItem(id) { return id !== AIR && BLOCKS[id].item; }

export function block(id) { return BLOCKS[id]; }
export function isOpaque(id) { return id !== AIR && BLOCKS[id].opaque; }
export function isSolid(id) { return id !== AIR && BLOCKS[id].solid; }
export function isLiquid(id) { return id === WATER; }

// Blocks offered in the creative-ish hotbar before anything is mined.
export const STARTING_HOTBAR = [GRASS, DIRT, STONE, COBBLE, PLANKS, LOG, GLASS, GLOWSTONE, BRICK];

// Flat lookup tables for the mesher's inner loop, where a property access per
// voxel neighbour is measurably too slow.
export const OPAQUE_LUT = new Uint8Array(256);
export const BLEND_LUT = new Uint8Array(256);
for (let i = 1; i < BLOCKS.length; i++) {
  if (!BLOCKS[i]) continue;
  OPAQUE_LUT[i] = BLOCKS[i].opaque ? 1 : 0;
  BLEND_LUT[i] = BLOCKS[i].blend ? 1 : 0;
}

// Block and item registry.
//
// Ids 1..14 are the original terrain blocks; everything after is craftable. A
// single table drives mining times, drops, tool requirements, light and how each
// thing is drawn, so adding content means one row here and one painter in
// textures.js.

export const AIR = 0;

export const TILES = [
  'grass_top', 'grass_side', 'dirt', 'stone', 'sand', 'log_top', 'log_side',
  'leaves', 'planks', 'cobble', 'water', 'glass', 'brick', 'glowstone',
  'coal_ore', 'iron_ore', 'apple', 'porkchop',
  'table_top', 'table_side', 'furnace_front', 'furnace_side', 'torch',
  'stick', 'coal', 'iron_ingot',
  'pick_wood', 'pick_stone', 'pick_iron',
  'axe_wood', 'axe_stone', 'axe_iron',
  'shovel_wood', 'shovel_stone', 'shovel_iron',
  'sword_wood', 'sword_stone', 'sword_iron',
  'wool', 'door', 'door_top', 'ladder', 'bed',
  'beef', 'cooked_beef', 'cooked_pork', 'raw_chicken', 'cooked_chicken',
  'leather', 'feather', 'bone', 'string', 'arrow', 'bow', 'gunpowder',
];

const tile = {};
TILES.forEach((name, i) => { tile[name] = i; });

// Which tool class speeds a block up, and the tier needed to get a drop at all.
export const MAT = { NONE: 'none', STONE: 'stone', WOOD: 'wood', DIRT: 'dirt', PLANT: 'plant' };
export const TOOL = { PICKAXE: 'pickaxe', AXE: 'axe', SHOVEL: 'shovel', SWORD: 'sword' };
const TOOL_FOR = { [MAT.STONE]: TOOL.PICKAXE, [MAT.WOOD]: TOOL.AXE, [MAT.DIRT]: TOOL.SHOVEL };

function def(id, name, opts) {
  const faces = opts.all !== undefined
    ? [opts.all, opts.all, opts.all, opts.all, opts.all, opts.all]
    : [opts.side, opts.side, opts.top, opts.bottom ?? opts.side, opts.front ?? opts.side, opts.side];
  return {
    id, name, faces,
    hardness: opts.hardness ?? 1,
    drop: opts.drop === null ? null : (opts.drop ?? id),
    dropCount: opts.dropCount ?? 1,
    opaque: opts.opaque ?? true,
    solid: opts.solid ?? true,
    light: opts.light ?? 0,
    food: opts.food ?? 0,
    item: opts.item ?? false,
    blend: opts.blend ?? false,
    liquid: opts.liquid ?? false,
    // Shapes other than 'cube': 'post' (torch), 'slab' (half height) and
    // 'panel' (a thin sheet laid against whichever wall it was placed on).
    shape: opts.shape ?? 'cube',
    // Right-clicked rather than placed from: doors toggle, beds are slept in.
    use: opts.use ?? null,
    // Blocks two cells tall. The upper half is the same id, drawn with topTile.
    tall: opts.tall ?? false,
    topTile: opts.topTile ?? null,
    material: opts.material ?? MAT.NONE,
    // Minimum tool tier for this block to drop anything. 0 means bare hands.
    requiresTier: opts.requiresTier ?? 0,
    tool: opts.tool ?? null,     // {kind, tier, speed, damage} for tools
    // Blocks whose top face is randomly rotated per position to hide tiling.
    varyTexture: opts.varyTexture ?? false,
  };
}

export const BLOCKS = [];
function add(b) { BLOCKS[b.id] = b; return b.id; }

// ---------------------------------------------------------------- terrain
export const GRASS     = add(def(1,  'Grass',     { top: tile.grass_top, side: tile.grass_side, bottom: tile.dirt, hardness: 0.6, drop: 2, material: MAT.DIRT, varyTexture: true }));
export const DIRT      = add(def(2,  'Dirt',      { all: tile.dirt,    hardness: 0.5, material: MAT.DIRT, varyTexture: true }));
export const STONE     = add(def(3,  'Stone',     { all: tile.stone,   hardness: 1.5, drop: 8, material: MAT.STONE, requiresTier: 1, varyTexture: true }));
export const SAND      = add(def(4,  'Sand',      { all: tile.sand,    hardness: 0.5, material: MAT.DIRT, varyTexture: true }));
export const LOG       = add(def(5,  'Wood',      { top: tile.log_top, side: tile.log_side, hardness: 1.0, material: MAT.WOOD }));
export const LEAVES    = add(def(6,  'Leaves',    { all: tile.leaves,  hardness: 0.2, opaque: false, material: MAT.PLANT }));
export const PLANKS    = add(def(7,  'Planks',    { all: tile.planks,  hardness: 0.8, material: MAT.WOOD }));
export const COBBLE    = add(def(8,  'Cobblestone', { all: tile.cobble, hardness: 1.5, material: MAT.STONE, requiresTier: 1, varyTexture: true }));
export const WATER     = add(def(9,  'Water',     { all: tile.water,   hardness: null, opaque: false, solid: false, blend: true, liquid: true }));
export const GLASS     = add(def(10, 'Glass',     { all: tile.glass,   hardness: 0.3, opaque: false, drop: null, blend: true }));
export const BRICK     = add(def(11, 'Brick',     { all: tile.brick,   hardness: 1.6, material: MAT.STONE, requiresTier: 1 }));
export const GLOWSTONE = add(def(12, 'Glowstone', { all: tile.glowstone, hardness: 0.4, light: 14 }));
export const COAL_ORE  = add(def(13, 'Coal Ore',  { all: tile.coal_ore, hardness: 2.0, material: MAT.STONE, requiresTier: 1, drop: 25 }));
export const IRON_ORE  = add(def(14, 'Iron Ore',  { all: tile.iron_ore, hardness: 2.5, material: MAT.STONE, requiresTier: 2 }));

// ---------------------------------------------------------------- food
export const APPLE     = add(def(15, 'Apple',     { all: tile.apple,    item: true, food: 4 }));
export const PORKCHOP  = add(def(16, 'Porkchop',  { all: tile.porkchop, item: true, food: 8 }));

// ---------------------------------------------------------------- crafted blocks
export const TABLE   = add(def(17, 'Crafting Table', { top: tile.table_top, side: tile.table_side, hardness: 1.0, material: MAT.WOOD }));
export const FURNACE = add(def(18, 'Furnace', { top: tile.furnace_side, side: tile.furnace_side, front: tile.furnace_front, hardness: 2.0, material: MAT.STONE, requiresTier: 1 }));
export const TORCH   = add(def(19, 'Torch', { all: tile.torch, hardness: 0.1, light: 14, opaque: false, solid: false, shape: 'post' }));

// ---------------------------------------------------------------- materials
export const STICK      = add(def(20, 'Stick',      { all: tile.stick,      item: true }));
export const COAL       = add(def(25, 'Coal',       { all: tile.coal,       item: true }));
export const IRON_INGOT = add(def(26, 'Iron Ingot', { all: tile.iron_ingot, item: true }));

// ---------------------------------------------------------------- tools
function toolDef(id, name, tileName, kind, tier, speed, damage) {
  return add(def(id, name, { all: tile[tileName], item: true, tool: { kind, tier, speed, damage } }));
}
export const WOOD_PICK   = toolDef(30, 'Wooden Pickaxe', 'pick_wood',    TOOL.PICKAXE, 1, 2.5, 2);
export const STONE_PICK  = toolDef(31, 'Stone Pickaxe',  'pick_stone',   TOOL.PICKAXE, 2, 4.5, 3);
export const IRON_PICK   = toolDef(32, 'Iron Pickaxe',   'pick_iron',    TOOL.PICKAXE, 3, 7.0, 4);
export const WOOD_AXE    = toolDef(33, 'Wooden Axe',     'axe_wood',     TOOL.AXE,     1, 2.5, 3);
export const STONE_AXE   = toolDef(34, 'Stone Axe',      'axe_stone',    TOOL.AXE,     2, 4.5, 4);
export const IRON_AXE    = toolDef(35, 'Iron Axe',       'axe_iron',     TOOL.AXE,     3, 7.0, 5);
export const WOOD_SHOVEL = toolDef(36, 'Wooden Shovel',  'shovel_wood',  TOOL.SHOVEL,  1, 2.5, 2);
export const STONE_SHOVEL= toolDef(37, 'Stone Shovel',   'shovel_stone', TOOL.SHOVEL,  2, 4.5, 2);
export const IRON_SHOVEL = toolDef(38, 'Iron Shovel',    'shovel_iron',  TOOL.SHOVEL,  3, 7.0, 3);
export const WOOD_SWORD  = toolDef(39, 'Wooden Sword',   'sword_wood',   TOOL.SWORD,   1, 1.0, 5);
export const STONE_SWORD = toolDef(40, 'Stone Sword',    'sword_stone',  TOOL.SWORD,   2, 1.0, 6);
export const IRON_SWORD  = toolDef(41, 'Iron Sword',     'sword_iron',   TOOL.SWORD,   3, 1.0, 8);

// ---------------------------------------------------------------- built blocks
export const WOOL        = add(def(42, 'Wool',       { all: tile.wool, hardness: 0.6, material: MAT.PLANT }));
export const DOOR_CLOSED = add(def(43, 'Door', { all: tile.door, topTile: tile.door_top, tall: true, hardness: 0.8, material: MAT.WOOD, opaque: false, shape: 'panel', use: 'door' }));
export const DOOR_OPEN   = add(def(44, 'Door', { all: tile.door, topTile: tile.door_top, tall: true, hardness: 0.8, material: MAT.WOOD, opaque: false, solid: false, shape: 'panel', use: 'door', drop: 43 }));
export const LADDER      = add(def(45, 'Ladder',     { all: tile.ladder, hardness: 0.4, material: MAT.WOOD, opaque: false, solid: false, shape: 'panel' }));
export const BED         = add(def(46, 'Bed',        { all: tile.bed, hardness: 0.4, material: MAT.PLANT, opaque: false, shape: 'slab', use: 'bed' }));
export const STONE_SLAB  = add(def(47, 'Stone Slab', { all: tile.cobble, hardness: 1.5, material: MAT.STONE, requiresTier: 1, opaque: false, shape: 'slab' }));
export const WOOD_SLAB   = add(def(48, 'Wood Slab',  { all: tile.planks, hardness: 0.8, material: MAT.WOOD, opaque: false, shape: 'slab' }));

// ---------------------------------------------------------------- mob drops and food
export const BEEF            = add(def(49, 'Raw Beef',        { all: tile.beef,            item: true, food: 3 }));
export const COOKED_BEEF     = add(def(50, 'Steak',           { all: tile.cooked_beef,     item: true, food: 8 }));
export const COOKED_PORK     = add(def(51, 'Cooked Porkchop', { all: tile.cooked_pork,     item: true, food: 8 }));
export const RAW_CHICKEN     = add(def(52, 'Raw Chicken',     { all: tile.raw_chicken,     item: true, food: 2 }));
export const COOKED_CHICKEN  = add(def(53, 'Cooked Chicken',  { all: tile.cooked_chicken,  item: true, food: 6 }));
export const LEATHER         = add(def(54, 'Leather',         { all: tile.leather,         item: true }));
export const FEATHER         = add(def(55, 'Feather',         { all: tile.feather,         item: true }));
export const BONE            = add(def(56, 'Bone',            { all: tile.bone,            item: true }));
export const STRING          = add(def(57, 'String',          { all: tile.string,          item: true }));
export const ARROW           = add(def(58, 'Arrow',           { all: tile.arrow,           item: true }));
export const BOW             = add(def(59, 'Bow',             { all: tile.bow,             item: true }));
export const GUNPOWDER       = add(def(60, 'Gunpowder',       { all: tile.gunpowder,       item: true }));

export function block(id) { return BLOCKS[id]; }
export function isDoor(id) { return id === 43 || id === 44; }
export function isOpaque(id) { return id !== AIR && !!BLOCKS[id] && BLOCKS[id].opaque; }
export function isSolid(id) { return id !== AIR && !!BLOCKS[id] && BLOCKS[id].solid; }
export function isLiquid(id) { return id === WATER; }
export function isItem(id) { return id !== AIR && !!BLOCKS[id] && BLOCKS[id].item; }
/** Items cannot be placed; neither can anything with no block form. */
export function isPlaceable(id) { return id !== AIR && !!BLOCKS[id] && !BLOCKS[id].item; }

/** Seconds to break `blockId` with `toolId` in hand, and whether it drops. */
export function miningTime(blockId, toolId) {
  const b = block(blockId);
  if (!b || b.hardness === null) return Infinity;
  const tool = toolId ? block(toolId)?.tool : null;
  const wanted = TOOL_FOR[b.material];
  const matches = tool && wanted && tool.kind === wanted;
  return b.hardness / (matches ? tool.speed : 1);
}

export function canHarvest(blockId, toolId) {
  const b = block(blockId);
  if (!b) return false;
  if (b.requiresTier === 0) return true;
  const tool = toolId ? block(toolId)?.tool : null;
  const wanted = TOOL_FOR[b.material];
  return !!tool && tool.kind === wanted && tool.tier >= b.requiresTier;
}

export function attackDamage(toolId) {
  const tool = toolId ? block(toolId)?.tool : null;
  return tool ? tool.damage : 1;
}

// Every placeable block, for the creative palette.
export const CREATIVE_PALETTE = [
  GRASS, DIRT, STONE, SAND, COBBLE, PLANKS, LOG, LEAVES, WOOL, BRICK,
  GLASS, GLOWSTONE, TORCH, TABLE, FURNACE, DOOR_CLOSED, LADDER, BED,
  STONE_SLAB, WOOD_SLAB, COAL_ORE, IRON_ORE,
];
export const SURVIVAL_SLOTS = 18;

export const OPAQUE_LUT = new Uint8Array(256);
export const BLEND_LUT = new Uint8Array(256);
export const POST_LUT = new Uint8Array(256);
export const SLAB_LUT = new Uint8Array(256);
export const PANEL_LUT = new Uint8Array(256);
export const CLIMB_LUT = new Uint8Array(256);
export const LIQUID_LUT = new Uint8Array(256);
export const VARY_LUT = new Uint8Array(256);
for (let i = 1; i < BLOCKS.length; i++) {
  const b = BLOCKS[i];
  if (!b) continue;
  if (i === 45) CLIMB_LUT[i] = 1;                 // ladders
  OPAQUE_LUT[i] = b.opaque ? 1 : 0;
  BLEND_LUT[i] = b.blend ? 1 : 0;
  POST_LUT[i] = b.shape === 'post' ? 1 : 0;
  SLAB_LUT[i] = b.shape === 'slab' ? 1 : 0;
  PANEL_LUT[i] = b.shape === 'panel' ? 1 : 0;
  LIQUID_LUT[i] = b.liquid ? 1 : 0;
  VARY_LUT[i] = b.varyTexture ? 1 : 0;
}

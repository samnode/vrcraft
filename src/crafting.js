// Recipes and the craft/smelt logic.
//
// Recipes are ingredient lists rather than 3x3 grid layouts. A grid is miserable
// to operate with motion controllers, so this works like Minecraft's recipe book:
// you see what you can make and pick it. Stations still gate what is available,
// so a crafting table and a furnace are both worth building.

import {
  LOG, PLANKS, STICK, TABLE, FURNACE, TORCH, COBBLE, COAL, IRON_ORE, IRON_INGOT,
  GLASS, SAND, WOOD_PICK, STONE_PICK, IRON_PICK, WOOD_AXE, STONE_AXE, IRON_AXE,
  WOOD_SHOVEL, STONE_SHOVEL, IRON_SHOVEL, WOOD_SWORD, STONE_SWORD, IRON_SWORD,
  WOOL, DOOR_CLOSED, LADDER, BED, STONE_SLAB, WOOD_SLAB,
  BEEF, COOKED_BEEF, PORKCHOP, COOKED_PORK, RAW_CHICKEN, COOKED_CHICKEN,
  STRING, FEATHER, ARROW, BOW, BONE,
  block,
} from './blocks.js?v=8';

/** needs: null (anywhere), 'table' or 'furnace' — a station within reach. */
const r = (out, count, inputs, needs = null) => ({ out, count, inputs, needs });

export const RECIPES = [
  // Basics, craftable empty-handed in the field.
  r(PLANKS, 4, [[LOG, 1]]),
  r(STICK, 4, [[PLANKS, 2]]),
  r(TABLE, 1, [[PLANKS, 4]]),
  r(TORCH, 4, [[COAL, 1], [STICK, 1]]),

  // Everything below wants a crafting table nearby.
  r(FURNACE, 1, [[COBBLE, 8]], 'table'),
  r(WOOD_PICK, 1, [[PLANKS, 3], [STICK, 2]], 'table'),
  r(STONE_PICK, 1, [[COBBLE, 3], [STICK, 2]], 'table'),
  r(IRON_PICK, 1, [[IRON_INGOT, 3], [STICK, 2]], 'table'),
  r(WOOD_AXE, 1, [[PLANKS, 3], [STICK, 2]], 'table'),
  r(STONE_AXE, 1, [[COBBLE, 3], [STICK, 2]], 'table'),
  r(IRON_AXE, 1, [[IRON_INGOT, 3], [STICK, 2]], 'table'),
  r(WOOD_SHOVEL, 1, [[PLANKS, 1], [STICK, 2]], 'table'),
  r(STONE_SHOVEL, 1, [[COBBLE, 1], [STICK, 2]], 'table'),
  r(IRON_SHOVEL, 1, [[IRON_INGOT, 1], [STICK, 2]], 'table'),
  r(WOOD_SWORD, 1, [[PLANKS, 2], [STICK, 1]], 'table'),
  r(STONE_SWORD, 1, [[COBBLE, 2], [STICK, 1]], 'table'),
  r(IRON_SWORD, 1, [[IRON_INGOT, 2], [STICK, 1]], 'table'),

  // Building pieces.
  r(DOOR_CLOSED, 1, [[PLANKS, 6]], 'table'),
  r(LADDER, 3, [[STICK, 7]], 'table'),
  r(BED, 1, [[WOOL, 3], [PLANKS, 3]], 'table'),
  r(WOOD_SLAB, 6, [[PLANKS, 3]], 'table'),
  r(STONE_SLAB, 6, [[COBBLE, 3]], 'table'),
  r(WOOL, 1, [[STRING, 4]], 'table'),

  // Ranged combat.
  r(BOW, 1, [[STICK, 3], [STRING, 3]], 'table'),
  r(ARROW, 4, [[STICK, 1], [FEATHER, 1], [COBBLE, 1]], 'table'),

  // Smelting: a furnace plus coal for fuel.
  r(IRON_INGOT, 1, [[IRON_ORE, 1], [COAL, 1]], 'furnace'),
  r(GLASS, 1, [[SAND, 1], [COAL, 1]], 'furnace'),
  r(COOKED_BEEF, 1, [[BEEF, 1], [COAL, 1]], 'furnace'),
  r(COOKED_PORK, 1, [[PORKCHOP, 1], [COAL, 1]], 'furnace'),
  r(COOKED_CHICKEN, 1, [[RAW_CHICKEN, 1], [COAL, 1]], 'furnace'),
];

export function hasIngredients(recipe, inventory) {
  return recipe.inputs.every(([id, n]) => inventory.countOf(id) >= n);
}

export function stationAvailable(recipe, stations) {
  if (!recipe.needs) return true;
  return !!stations[recipe.needs];
}

export function canCraft(recipe, inventory, stations) {
  return hasIngredients(recipe, inventory) && stationAvailable(recipe, stations);
}

/** Consumes the inputs and adds the output. Returns true if it happened. */
export function craft(recipe, inventory, stations) {
  if (!canCraft(recipe, inventory, stations)) return false;
  for (const [id, n] of recipe.inputs) {
    if (!inventory.remove(id, n)) return false;      // should not happen after canCraft
  }
  inventory.add(recipe.out, recipe.count);
  return true;
}

export function recipeLabel(recipe) {
  const out = block(recipe.out);
  const name = recipe.count > 1 ? `${out.name} x${recipe.count}` : out.name;
  const inputs = recipe.inputs.map(([id, n]) => `${n} ${block(id).name}`).join(' + ');
  return { name, inputs, needs: recipe.needs };
}

/** Which crafting stations sit within `radius` blocks of a position. */
export function nearbyStations(world, position, radius = 4) {
  const stations = { table: false, furnace: false };
  const px = Math.floor(position.x), py = Math.floor(position.y), pz = Math.floor(position.z);
  for (let y = py - radius; y <= py + radius; y++) {
    for (let z = pz - radius; z <= pz + radius; z++) {
      for (let x = px - radius; x <= px + radius; x++) {
        const id = world.get(x, y, z);
        if (id === TABLE) stations.table = true;
        else if (id === FURNACE) stations.furnace = true;
        if (stations.table && stations.furnace) return stations;
      }
    }
  }
  return stations;
}

// Hotbar and stacks.
//
// Creative shows the whole placeable palette with unlimited counts, so every
// block in the game is one click away. Survival gives nine slots that fill from
// what you mine, with real stack counts.

import { CREATIVE_PALETTE, SURVIVAL_SLOTS, ARMOR_SLOTS, block } from './blocks.js?v=17';

const STACK_MAX = 64;

export class Inventory {
  constructor({ creative = true } = {}) {
    this.creative = creative;
    this.selected = 0;
    this.onChange = null;
    this.survivalSlots = Array.from({ length: SURVIVAL_SLOTS }, () => ({ id: 0, count: 0 }));
    // Worn gear lives outside the hotbar, so putting a helmet on does not cost
    // you a slot you were using for cobblestone.
    this.armor = { head: 0, chest: 0, legs: 0, feet: 0 };
    this.buildSlots();
  }

  buildSlots() {
    this.slots = this.creative
      ? CREATIVE_PALETTE.map((id) => ({ id, count: Infinity }))
      : this.survivalSlots;
    if (this.selected >= this.slots.length) this.selected = this.slots.length - 1;
  }

  get selectedSlot() { return this.slots[this.selected]; }

  select(i) {
    const n = this.slots.length;
    this.selected = ((i % n) + n) % n;
    this.changed();
  }

  cycle(delta) { this.select(this.selected + delta); }

  /** Block the player would place, or 0 if the slot cannot be placed from. */
  placeable() {
    const s = this.selectedSlot;
    if (!s || !s.id) return 0;
    if (!this.creative && s.count <= 0) return 0;
    return s.id;
  }

  consumeSelected() {
    if (this.creative) return true;
    const s = this.selectedSlot;
    if (!s || s.count <= 0) return false;
    s.count -= 1;
    if (s.count === 0) s.id = 0;
    this.changed();
    return true;
  }

  /** Total of an item across every slot. */
  countOf(id) {
    if (this.creative) return Infinity;
    let n = 0;
    for (const s of this.survivalSlots) if (s.id === id) n += s.count;
    return n;
  }

  /** Remove `count` of an item, draining across slots. */
  remove(id, count) {
    if (this.creative) return true;
    if (this.countOf(id) < count) return false;
    let left = count;
    for (const s of this.survivalSlots) {
      if (left === 0) break;
      if (s.id !== id) continue;
      const take = Math.min(s.count, left);
      s.count -= take;
      left -= take;
      if (s.count === 0) s.id = 0;
    }
    this.changed();
    return true;
  }

  /** The tool currently held, or 0. */
  heldTool() {
    const s = this.selectedSlot;
    if (!s || !s.id) return 0;
    return block(s.id).tool ? s.id : 0;
  }

  /** Add a mined block, stacking into an existing slot where possible. */
  add(id, count = 1) {
    if (!id || this.creative) return true;
    for (const s of this.survivalSlots) {
      if (s.id === id && s.count < STACK_MAX) {
        s.count = Math.min(STACK_MAX, s.count + count);
        this.changed();
        return true;
      }
    }
    for (const s of this.survivalSlots) {
      if (!s.id || s.count === 0) {
        s.id = id;
        s.count = count;
        this.changed();
        return true;
      }
    }
    return false;                                  // full
  }

  /**
   * Wear a piece, putting whatever it replaces back in the hotbar. Returns false
   * if there is nowhere to put the old piece, rather than quietly eating it.
   */
  equip(id) {
    const def = block(id);
    if (!def || !def.armor) return false;
    const slot = def.armor.slot;
    const current = this.armor[slot];
    if (current === id) return false;
    if (!this.creative) {
      if (!this.remove(id, 1)) return false;
      if (current && !this.add(current, 1)) {
        this.add(id, 1);                             // undo; the hotbar is full
        return false;
      }
    }
    this.armor[slot] = id;
    this.changed();
    return true;
  }

  /** Total protection worn, in Minecraft's armour points. */
  armorPoints() {
    let n = 0;
    for (const slot of ARMOR_SLOTS) {
      const id = this.armor[slot];
      if (id) n += block(id).armor.points;
    }
    return n;
  }

  /** Everything you were carrying and wearing, gone. Returns how much was lost. */
  clearAll() {
    let lost = 0;
    for (const s of this.survivalSlots) {
      lost += s.count;
      s.id = 0;
      s.count = 0;
    }
    for (const slot of ARMOR_SLOTS) {
      if (this.armor[slot]) lost += 1;
      this.armor[slot] = 0;
    }
    this.changed();
    return lost;
  }

  setCreative(on) {
    if (this.creative === on) return;
    this.creative = on;
    this.buildSlots();
    this.changed();
  }

  label() {
    const s = this.selectedSlot;
    if (!s || !s.id) return 'Empty';
    const name = block(s.id).name;
    return this.creative ? name : `${name} x${s.count}`;
  }

  changed() { if (this.onChange) this.onChange(this); }
}

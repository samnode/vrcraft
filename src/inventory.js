// Hotbar and stacks.
//
// Creative shows the palette a page of nine at a time with unlimited counts, so
// every block in the game is one key away. Survival gives slots that fill from
// what you mine, with real stack counts.

import { CREATIVE_PAGES, SURVIVAL_SLOTS, ARMOR_SLOTS, block } from './blocks.js?v=37';

const STACK_MAX = 64;

export class Inventory {
  constructor({ creative = true } = {}) {
    this.creative = creative;
    this.selected = 0;
    this.page = 0;                       // creative only: which page of the palette
    this.onChange = null;
    this.survivalSlots = Array.from({ length: SURVIVAL_SLOTS }, () => ({ id: 0, count: 0 }));
    // Worn gear lives outside the hotbar, so putting a helmet on does not cost
    // you a slot you were using for cobblestone.
    this.armor = { head: 0, chest: 0, legs: 0, feet: 0 };
    this.buildSlots();
  }

  buildSlots() {
    this.slots = this.creative
      ? this.currentPage.blocks.map((id) => ({ id, count: Infinity }))
      : this.survivalSlots;
    if (this.selected >= this.slots.length) this.selected = this.slots.length - 1;
  }

  get currentPage() { return CREATIVE_PAGES[this.page] ?? CREATIVE_PAGES[0]; }

  /** The page name, for the HUD. Empty in survival, which has no pages. */
  get pageLabel() {
    return this.creative ? `${this.currentPage.name} ${this.page + 1}/${CREATIVE_PAGES.length}` : '';
  }

  /** Turn to another page of the palette, wrapping round in both directions. */
  setPage(index) {
    if (!this.creative) return;
    const n = CREATIVE_PAGES.length;
    this.page = ((index % n) + n) % n;
    this.selected = 0;
    this.buildSlots();
    this.changed();
  }

  cyclePage(delta) { this.setPage(this.page + delta); }

  get selectedSlot() { return this.slots[this.selected]; }

  select(i) {
    const n = this.slots.length;
    this.selected = ((i % n) + n) % n;
    this.changed();
  }

  /**
   * Step one slot. Running off either end of a creative page turns to the next
   * one, so the wheel alone still reaches every block in the game — which is
   * what the headset has, with no digit keys and no brackets to press.
   */
  cycle(delta) {
    if (this.creative) {
      const next = this.selected + delta;
      if (next >= this.slots.length) { this.cyclePage(1); return; }
      if (next < 0) {
        this.cyclePage(-1);
        this.selected = this.slots.length - 1;
        this.changed();
        return;
      }
    }
    this.select(this.selected + delta);
  }

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

  /**
   * Add items, topping up part-filled stacks before taking an empty slot.
   * Returns how many actually fit, which may be fewer than asked for — picking a
   * stack up off the ground has to leave the remainder lying there rather than
   * quietly destroying it.
   */
  add(id, count = 1) {
    if (!id || count <= 0) return 0;
    if (this.creative) return count;
    let left = count;
    for (const s of this.survivalSlots) {
      if (left === 0) break;
      if (s.id !== id || s.count >= STACK_MAX) continue;
      const take = Math.min(STACK_MAX - s.count, left);
      s.count += take;
      left -= take;
    }
    for (const s of this.survivalSlots) {
      if (left === 0) break;
      if (s.id && s.count > 0) continue;
      s.id = id;
      s.count = Math.min(STACK_MAX, left);
      left -= s.count;
    }
    const added = count - left;
    if (added) this.changed();
    return added;
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

  /**
   * Empty the hotbar and the armour slots, handing back what was in them as a
   * list of stacks so the caller can put them on the ground.
   */
  takeAll() {
    const stacks = [];
    for (const s of this.survivalSlots) {
      if (s.id && s.count > 0) stacks.push({ id: s.id, count: s.count });
      s.id = 0;
      s.count = 0;
    }
    for (const slot of ARMOR_SLOTS) {
      if (this.armor[slot]) stacks.push({ id: this.armor[slot], count: 1 });
      this.armor[slot] = 0;
    }
    this.changed();
    return stacks;
  }

  /** Everything gone, with nothing handed back. */
  clearAll() {
    return this.takeAll().reduce((n, s) => n + s.count, 0);
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

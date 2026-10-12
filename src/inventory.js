// Nine-slot hotbar with stack counts. Mining drops feed it; placing consumes it.
// Creative mode ignores counts entirely so the sandbox stays frictionless.

import { STARTING_HOTBAR, block } from './blocks.js';

const STACK_MAX = 64;

export class Inventory {
  constructor({ creative = true } = {}) {
    this.creative = creative;
    this.slots = STARTING_HOTBAR.map((id) => ({ id, count: creative ? Infinity : 0 }));
    while (this.slots.length < 9) this.slots.push({ id: 0, count: 0 });
    this.selected = 0;
    this.onChange = null;
  }

  get selectedSlot() { return this.slots[this.selected]; }

  select(i) {
    this.selected = ((i % 9) + 9) % 9;
    this.changed();
  }

  cycle(delta) { this.select(this.selected + delta); }

  /** Block the player would place, or 0 if the slot cannot be placed from. */
  placeable() {
    const s = this.selectedSlot;
    if (!s.id) return 0;
    if (!this.creative && s.count <= 0) return 0;
    return s.id;
  }

  consumeSelected() {
    if (this.creative) return true;
    const s = this.selectedSlot;
    if (s.count <= 0) return false;
    s.count -= 1;
    if (s.count === 0) s.id = 0;
    this.changed();
    return true;
  }

  /** Add a mined block, stacking into an existing slot where possible. */
  add(id, count = 1) {
    if (!id || this.creative) return true;
    for (const s of this.slots) {
      if (s.id === id && s.count < STACK_MAX) {
        s.count = Math.min(STACK_MAX, s.count + count);
        this.changed();
        return true;
      }
    }
    for (const s of this.slots) {
      if (!s.id || s.count === 0) {
        s.id = id;
        s.count = count;
        this.changed();
        return true;
      }
    }
    return false;                                  // full
  }

  setCreative(on) {
    this.creative = on;
    if (on) {
      STARTING_HOTBAR.forEach((id, i) => { this.slots[i] = { id, count: Infinity }; });
    } else {
      for (const s of this.slots) {
        if (s.count === Infinity) s.count = 1;
      }
    }
    this.changed();
  }

  label() {
    const s = this.selectedSlot;
    if (!s.id) return 'Empty';
    const name = block(s.id).name;
    return this.creative ? name : `${name} x${s.count}`;
  }

  changed() { if (this.onChange) this.onChange(this); }
}

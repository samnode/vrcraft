// Items lying on the ground.
//
// Everything you were carrying becomes one of these when you die, and mob drops
// land as them too rather than teleporting into your pockets. They fall, settle
// on whatever is under them, spin, and go back in your inventory when you walk
// over them.
//
// Entities are not owned by chunks: an item sitting in a chunk that has since
// streamed out still exists, it is simply frozen until the ground beneath it is
// loaded again. Without that, dying and respawning somewhere else would drop
// your whole inventory through the floor of an unloaded world.

import * as THREE from '../vendor/three/three.module.js?v=31';
import { block, isPlaceable, isSolid } from './blocks.js?v=31';
import { SX, SZ, chunkKey } from './world.js?v=31';
import { blockCubeGeometry, iconGeometry } from './textures.js?v=31';
import { sfx } from './sfx.js?v=31';

const GRAVITY = 22;
const SIZE = 0.26;                // the cube's edge, in blocks
const PICKUP_RANGE = 1.4;
const PICKUP_DELAY = 0.6;         // so a death drop does not fly straight back
const DESPAWN = 300;              // five minutes, as in Minecraft
const DRAW_RANGE = 48;            // past this they are hidden, not simulated away
const MAX_ITEMS = 300;

export class DroppedItems {
  constructor(scene, world, atlas) {
    this.world = world;
    this.atlas = atlas;
    this.list = [];
    this.group = new THREE.Group();
    scene.add(this.group);

    // Two materials cover every item, the same split the held models use: full
    // blocks are textured cubes, everything else is its icon given thickness.
    this.blockMaterial = new THREE.MeshLambertMaterial({ map: atlas.texture });
    this.iconMaterial = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.geometryCache = new Map();
  }

  /** Hide this dimension's items while the player is elsewhere. */
  setActive(on) { this.group.visible = on; }

  geometryFor(id) {
    let geo = this.geometryCache.get(id);
    if (geo) return geo;
    const def = block(id);
    geo = isPlaceable(id) && def.shape === 'cube'
      ? blockCubeGeometry(def.faces)
      : iconGeometry(this.atlas.canvas, def.faces[0]);
    this.geometryCache.set(id, geo);
    return geo;
  }

  meshFor(id) {
    const def = block(id);
    const cube = isPlaceable(id) && def.shape === 'cube';
    const mesh = new THREE.Mesh(
      this.geometryFor(id),
      cube ? this.blockMaterial : this.iconMaterial,
    );
    // A cube geometry is a full block; the icon geometry is already small.
    if (cube) mesh.scale.setScalar(SIZE);
    else mesh.scale.setScalar(1.5);
    return mesh;
  }

  /**
   * Put one stack on the ground. `permanent` is for death drops: those wait for
   * you however long it takes to walk back, where a mob's loot times out.
   */
  drop(id, count, position, { permanent = false, scatter = 2.2, delay = PICKUP_DELAY } = {}) {
    if (!id || count <= 0 || !block(id)) return null;
    if (this.list.length >= MAX_ITEMS) this.evictOldest();

    const mesh = this.meshFor(id);
    this.group.add(mesh);
    const item = {
      id,
      count,
      position: position.clone(),
      velocity: new THREE.Vector3(
        (Math.random() - 0.5) * scatter,
        1.8 + Math.random() * 1.2,
        (Math.random() - 0.5) * scatter,
      ),
      age: 0,
      delay,
      permanent,
      spin: Math.random() * Math.PI * 2,
      mesh,
      dead: false,
    };
    this.list.push(item);
    return item;
  }

  /** Scatter a whole inventory's worth, as death does. */
  dropStacks(stacks, position) {
    for (const { id, count } of stacks) {
      this.drop(id, count, position, { permanent: true, delay: 1.2 });
    }
    return stacks.length;
  }

  evictOldest() {
    let worst = -1, worstAge = -1;
    for (let i = 0; i < this.list.length; i++) {
      const it = this.list[i];
      if (it.permanent) continue;                    // never drop someone's grave
      if (it.age > worstAge) { worstAge = it.age; worst = i; }
    }
    if (worst < 0) worst = 0;                        // all permanent: take the first
    this.retire(this.list[worst]);
    this.list.splice(worst, 1);
  }

  retire(item) {
    this.group.remove(item.mesh);                    // geometry is cached, not disposed
  }

  /** Is this item's ground actually loaded? */
  chunkLoaded(item) {
    const cx = Math.floor(item.position.x / SX);
    const cz = Math.floor(item.position.z / SZ);
    return this.world.chunks.has(chunkKey(cx, cz));
  }

  solid(x, y, z) {
    return isSolid(this.world.get(Math.floor(x), Math.floor(y), Math.floor(z)));
  }

  update(dt, player, inventory) {
    if (!this.list.length) return;
    const step = Math.min(dt, 0.05);
    const eye = player.position;

    for (const it of this.list) {
      it.age += step;
      it.delay = Math.max(0, it.delay - step);
      if (!it.permanent && it.age > DESPAWN) { it.dead = true; continue; }

      // Frozen while its ground is unloaded, or it would fall through nothing.
      const live = this.chunkLoaded(it);
      if (live) this.physics(it, step);

      it.spin += step * 1.6;
      it.mesh.position.set(it.position.x, it.position.y + Math.sin(it.age * 2.4) * 0.05, it.position.z);
      it.mesh.rotation.y = it.spin;

      const dx = it.position.x - eye.x;
      const dz = it.position.z - eye.z;
      const flat = dx * dx + dz * dz;
      it.mesh.visible = flat < DRAW_RANGE * DRAW_RANGE;

      if (!it.delay && live) this.tryPickup(it, player, inventory);
    }

    if (this.list.some((it) => it.dead)) {
      for (const it of this.list) if (it.dead) this.retire(it);
      this.list = this.list.filter((it) => !it.dead);
    }
  }

  physics(it, step) {
    it.velocity.y -= GRAVITY * step;
    const half = SIZE / 2;
    const p = it.position;
    const nx = p.x + it.velocity.x * step;
    const nz = p.z + it.velocity.z * step;
    const ny = p.y + it.velocity.y * step;

    if (!this.solid(nx, p.y + half, p.z)) p.x = nx; else it.velocity.x = 0;
    if (!this.solid(p.x, p.y + half, nz)) p.z = nz; else it.velocity.z = 0;

    if (it.velocity.y <= 0 && this.solid(p.x, ny - half, p.z)) {
      // Rest computed from where it tried to go, not from where it was: resting
      // on the reverted position walks the item up a block on every landing.
      p.y = Math.floor(ny - half) + 1 + half;
      it.velocity.y = 0;
      it.velocity.x *= 0.55;
      it.velocity.z *= 0.55;
    } else {
      p.y = ny;
    }

    if (p.y < -4) it.dead = true;
  }

  tryPickup(it, player, inventory) {
    if (inventory.creative) return;
    const dx = it.position.x - player.position.x;
    const dy = it.position.y - (player.position.y + 0.9);
    const dz = it.position.z - player.position.z;
    if (dx * dx + dy * dy + dz * dz > PICKUP_RANGE * PICKUP_RANGE) return;

    const taken = inventory.add(it.id, it.count);
    if (taken <= 0) return;                          // no room; leave it lying there
    it.count -= taken;
    sfx.pickup();
    if (this.onPickup) this.onPickup(it.id, taken);
    if (it.count <= 0) it.dead = true;
  }

  clear() {
    for (const it of this.list) this.retire(it);
    this.list = [];
  }
}

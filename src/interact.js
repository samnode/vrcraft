// Breaking, placing and hitting. Drives one shared highlight box; the caller
// supplies a ray per frame (gaze on desktop, controller aim in VR).

import * as THREE from '../vendor/three/three.module.js?v=10';
import { raycastVoxel } from './raycast.js?v=10';
import {
  AIR, LEAVES, APPLE, DOOR_CLOSED, DOOR_OPEN, BOW, ARROW,
  block, isItem, isLiquid, isSolid, isDoor, miningTime, canHarvest, attackDamage,
} from './blocks.js?v=10';
import { PLAYER_WIDTH, PLAYER_HEIGHT } from './player.js?v=10';
import { sfx } from './sfx.js?v=10';

const REACH = 6;
const PLACE_COOLDOWN = 0.18;
const HIT_COOLDOWN = 0.45;

export class Interactor {
  constructor(scene, terrain, player, inventory, survival, mobs, particles) {
    this.terrain = terrain;
    this.world = terrain.world;
    this.player = player;
    this.inventory = inventory;
    this.survival = survival;
    this.mobs = mobs;
    this.particles = particles;

    this.target = null;             // {x,y,z,id,normal}
    this.progress = 0;
    this.placeTimer = 0;
    this.hitTimer = 0;
    this.digSoundTimer = 0;
    // Read by the held-item models: `swinging` is a trigger held on something
    // breakable, `swingPulse` counts one-off actions worth an arm swing.
    this.swinging = false;
    this.swingPulse = 0;

    const box = new THREE.BoxGeometry(1.002, 1.002, 1.002);
    this.outline = new THREE.LineSegments(
      new THREE.EdgesGeometry(box),
      new THREE.LineBasicMaterial({ color: 0x0b0b0b, transparent: true, opacity: 0.85 }),
    );
    this.outline.visible = false;
    this.outline.frustumCulled = false;
    scene.add(this.outline);

    // Fills in as mining progresses, standing in for a crack overlay.
    this.crack = new THREE.Mesh(
      new THREE.BoxGeometry(1.01, 1.01, 1.01),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0 }),
    );
    this.crack.visible = false;
    this.crack.frustumCulled = false;
    scene.add(this.crack);

    this.onNotify = null;
    this.lastRay = { origin: new THREE.Vector3(), direction: new THREE.Vector3(0, 0, -1) };
  }

  /** ray: {origin: Vector3, direction: Vector3} already normalised. */
  update(dt, ray, input) {
    this.placeTimer = Math.max(0, this.placeTimer - dt);
    this.hitTimer = Math.max(0, this.hitTimer - dt);
    this.digSoundTimer = Math.max(0, this.digSoundTimer - dt);
    this.swinging = false;

    if (ray) this.lastRay = { origin: ray.origin.clone(), direction: ray.direction.clone() };
    const hit = ray ? raycastVoxel(this.world, ray.origin, ray.direction, REACH) : null;
    const mobHit = ray ? this.mobs.pick(ray.origin, ray.direction, 4) : null;

    // A mob in front of the block takes the swing instead.
    if (mobHit && (!hit || mobHit.distance < hit.distance)) {
      this.setTarget(null);
      if (input.breaking && this.hitTimer === 0) {
        this.hitTimer = HIT_COOLDOWN;
        // A sword hits far harder than a fist, which is the point of making one.
        this.mobs.hurt(mobHit.mob, attackDamage(this.inventory.heldTool()));
        this.particles.burst(mobHit.mob.center, 0xcc3333, 8, 2.2);
        this.swingPulse++;
        sfx.hit();
      }
      return;
    }

    if (!hit) { this.setTarget(null); return; }

    if (!this.target || this.target.x !== hit.x || this.target.y !== hit.y || this.target.z !== hit.z) {
      this.setTarget(hit);
      this.progress = 0;
    }

    if (input.breaking) {
      this.mine(dt, hit);
      this.swinging = true;
    } else this.progress = Math.max(0, this.progress - dt * 2);

    if (input.placing && this.placeTimer === 0) {
      this.place(hit);
      // Every successful action sets a cooldown, so a rise here means something
      // happened: a block went down, food was eaten, a door swung.
      if (this.placeTimer > 0) this.swingPulse++;
    }

    this.refreshVisuals();
  }

  setTarget(hit) {
    this.target = hit;
    const visible = !!hit;
    this.outline.visible = visible;
    this.crack.visible = visible;
    if (visible) {
      this.outline.position.set(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5);
      this.crack.position.copy(this.outline.position);
    } else {
      this.progress = 0;
    }
  }

  refreshVisuals() {
    this.crack.material.opacity = Math.min(0.55, this.progress * 0.55);
  }

  mine(dt, hit) {
    const def = block(hit.id);
    if (def.hardness === null) return;                 // bedrock-like, water
    // The right tool is several times faster; the wrong one is bare-hand speed.
    const seconds = miningTime(hit.id, this.inventory.heldTool());
    this.progress += dt / Math.max(0.05, seconds);

    if (this.digSoundTimer === 0) {
      this.digSoundTimer = 0.14;
      sfx.dig();
    }

    if (this.progress < 1) return;
    this.progress = 0;
    this.breakBlock(hit);
  }

  breakBlock(hit) {
    const def = block(hit.id);
    const harvestable = canHarvest(hit.id, this.inventory.heldTool());
    if (!this.world.set(hit.x, hit.y, hit.z, AIR)) return;

    // A door is one object in two cells: break either half and both go.
    if (isDoor(hit.id)) {
      const other = this.doorPartner(hit.x, hit.y, hit.z);
      if (other !== null) this.world.set(hit.x, other, hit.z, AIR);
    }

    const center = new THREE.Vector3(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5);
    this.particles.burst(center, this.particleColor(hit.id), 16, 3.0);
    sfx.break();

    // Leaves occasionally yield an apple, which is the main food source.
    let drop = def.drop;
    if (hit.id === LEAVES) drop = Math.random() < 0.12 ? APPLE : null;

    if (!harvestable) {
      // Mined without the required tool: the block breaks but yields nothing.
      drop = null;
      if (this.onNotify && !this.inventory.creative) {
        this.onNotify(`Need a better pickaxe for ${def.name}`);
      }
    }
    if (drop) this.collect(drop, def.dropCount ?? 1);

    this.setTarget(null);
  }

  collect(id, count = 1) {
    if (this.inventory.creative) return;
    if (this.inventory.add(id, count)) {
      sfx.pickup();
      if (this.onNotify) this.onNotify(`+${count} ${block(id).name}`);
    } else if (this.onNotify) {
      this.onNotify('Inventory full');
    }
  }

  place(hit) {
    // Right-clicking a door or bed operates it instead of placing from the hand,
    // which is what makes them feel like furniture rather than scenery.
    const targeted = block(hit.id);
    if (targeted && targeted.use) {
      this.useBlock(hit, targeted.use);
      return;
    }

    const id = this.inventory.placeable();
    if (!id) return;

    if (id === BOW) { this.shoot(); return; }

    if (isItem(id)) {                                  // food is eaten, not placed
      if (this.survival.enabled && this.survival.eat(id)) {
        this.inventory.consumeSelected();
        this.placeTimer = 0.5;
        sfx.eat();
        if (this.onNotify) this.onNotify(`Ate ${block(id).name}`);
      }
      return;
    }

    const x = hit.x + hit.normal[0], y = hit.y + hit.normal[1], z = hit.z + hit.normal[2];
    const existing = this.world.get(x, y, z);
    if (existing !== AIR && !isLiquid(existing)) return;
    // Only solid blocks can seal the player in; a torch in your own square is fine.
    if (isSolid(id) && this.overlapsPlayer(x, y, z)) return;

    const def = block(id);
    if (def.tall) {
      // Two cells tall, so both have to be clear before either is written.
      const above = this.world.get(x, y + 1, z);
      if (above !== AIR && !isLiquid(above)) {
        if (this.onNotify) this.onNotify('Not enough room for a door');
        return;
      }
      if (this.overlapsPlayer(x, y + 1, z)) return;
      if (!this.world.set(x, y, z, id)) return;
      this.world.set(x, y + 1, z, id);
      this.inventory.consumeSelected();
      this.placeTimer = PLACE_COOLDOWN;
      sfx.place();
      return;
    }

    if (!this.world.set(x, y, z, id)) return;
    this.inventory.consumeSelected();
    this.placeTimer = PLACE_COOLDOWN;
    sfx.place();
  }

  /** Doors swing; beds carry you to morning if it is actually night. */
  useBlock(hit, kind) {
    this.placeTimer = 0.35;
    if (kind === 'door') {
      const next = hit.id === DOOR_CLOSED ? DOOR_OPEN : DOOR_CLOSED;
      this.world.set(hit.x, hit.y, hit.z, next);
      const other = this.doorPartner(hit.x, hit.y, hit.z);
      if (other !== null) this.world.set(hit.x, other, hit.z, next);
      sfx.door();
      return;
    }
    if (kind === 'bed') {
      if (!this.survival.isNight) {
        if (this.onNotify) this.onNotify('You can only sleep at night');
        return;
      }
      this.survival.sleep();
      sfx.sleep();
      if (this.onNotify) this.onNotify('Good morning');
    }
  }

  /** The y of this door's other half, or null if it somehow stands alone. */
  doorPartner(x, y, z) {
    if (isDoor(this.world.get(x, y + 1, z))) return y + 1;
    if (isDoor(this.world.get(x, y - 1, z))) return y - 1;
    return null;
  }

  /** Fires an arrow from the aim ray, consuming one from the inventory. */
  shoot() {
    if (!this.inventory.creative && this.inventory.countOf(ARROW) < 1) {
      if (this.onNotify) this.onNotify('Out of arrows');
      this.placeTimer = 0.4;
      return;
    }
    if (!this.inventory.creative) this.inventory.remove(ARROW, 1);
    this.placeTimer = 0.5;
    const origin = this.lastRay.origin.clone();
    const target = origin.clone().addScaledVector(this.lastRay.direction, 24);
    this.mobs.arrows.fire(origin, target, 26, true);
  }

  overlapsPlayer(x, y, z) {
    const h = PLAYER_WIDTH / 2 + 0.02;
    const p = this.player.position;
    return x + 1 > p.x - h && x < p.x + h
        && z + 1 > p.z - h && z < p.z + h
        && y + 1 > p.y && y < p.y + PLAYER_HEIGHT;
  }

  particleColor(id) {
    // Approximate tints so debris reads as the right material without sampling.
    const COLORS = {
      1: 0x6f9e52, 2: 0x8a6a48, 3: 0x808084, 4: 0xd9ce96, 5: 0x6c5230,
      6: 0x3f7c34, 7: 0xa8844f, 8: 0x6c6c70, 10: 0xd6ecf4, 11: 0x9a4e3e,
      12: 0xe2c46e, 13: 0x303034, 14: 0xcea684,
      17: 0xa8844f, 18: 0x707074, 19: 0xffd166,
      42: 0xe8e8ee, 43: 0x96703e, 44: 0x96703e, 45: 0x9a7340, 46: 0xb03a3a,
      47: 0x6c6c70, 48: 0xa8844f,
    };
    return COLORS[id] ?? 0x9a9a9a;
  }
}

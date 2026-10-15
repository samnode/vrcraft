// Breaking, placing and hitting. Drives one shared highlight box; the caller
// supplies a ray per frame (gaze on desktop, controller aim in VR).

import * as THREE from '../vendor/three/three.module.js?v=31';
import { raycastVoxel } from './raycast.js?v=31';
import {
  AIR, LEAVES, SPRUCE_LEAVES, APPLE, DOOR_CLOSED, DOOR_OPEN, BOW, ARROW, BED_HEAD,
  FLINT_STEEL, OBSIDIAN,
  block, isItem, isArmor, isLiquid, isSolid, isDoor, isBed, bedPartnerId,
  miningTime, canHarvest, attackDamage,
} from './blocks.js?v=31';
import { ignite, extinguish, portalAdjacent } from './portal.js?v=31';
import { PLAYER_WIDTH, PLAYER_HEIGHT } from './player.js?v=31';
import { sfx } from './sfx.js?v=31';

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

  /** Follow the player into another dimension. */
  setTerrain(terrain) {
    this.terrain = terrain;
    this.world = terrain.world;
    this.setTarget(null);
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
    // And so is a bed, lying down rather than standing up.
    if (isBed(hit.id)) {
      const other = this.bedPartner(hit.x, hit.y, hit.z, hit.id);
      if (other) this.world.set(other[0], hit.y, other[1], AIR);
    }
    // A portal holds together only as long as its frame does. Taking out one
    // block of obsidian collapses the whole sheet, exactly as it should: the
    // frame is the portal's only record of itself.
    if (hit.id === OBSIDIAN) {
      const touching = portalAdjacent(this.world, hit.x, hit.y, hit.z);
      if (touching) {
        extinguish(this.world, ...touching);
        if (this.onNotify) this.onNotify('The portal closes');
      }
    }

    const center = new THREE.Vector3(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5);
    this.particles.burst(center, this.particleColor(hit.id), 16, 3.0);
    sfx.break();

    // Leaves occasionally yield an apple, which is the main food source.
    let drop = def.drop;
    if (hit.id === LEAVES || hit.id === SPRUCE_LEAVES) drop = Math.random() < 0.12 ? APPLE : null;

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
    const taken = this.inventory.add(id, count);
    if (taken > 0) {
      sfx.pickup();
      if (this.onNotify) this.onNotify(`+${taken} ${block(id).name}`);
    }
    // Whatever would not fit falls at your feet rather than vanishing.
    if (taken < count && this.onDropExcess) {
      this.onDropExcess(id, count - taken);
      if (this.onNotify) this.onNotify('Inventory full');
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

    if (id === FLINT_STEEL) { this.strikeLight(hit); return; }

    if (isArmor(id)) {                                 // worn, not placed or eaten
      this.placeTimer = 0.35;
      if (this.inventory.equip(id)) {
        sfx.place();
        if (this.onNotify) this.onNotify(`Wearing ${block(id).name}`);
      } else if (this.onNotify) {
        this.onNotify('No room to swap that out');
      }
      return;
    }

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

    if (def.long) {
      // Two cells long, laid out along whichever way you are facing. The far
      // cell has to be clear before either is written, same as a door's.
      const [dx, dz] = this.facingStep();
      const hx = x + dx, hz = z + dz;
      const far = this.world.get(hx, y, hz);
      if (far !== AIR && !isLiquid(far)) {
        if (this.onNotify) this.onNotify('Not enough room for a bed');
        return;
      }
      if (this.overlapsPlayer(hx, y, hz)) return;
      if (!this.world.set(x, y, z, id)) return;
      this.world.set(hx, y, hz, BED_HEAD);
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

  /**
   * Strike a light against the block being looked at. The only thing worth
   * lighting is a portal frame, so a failed strike says which part was missing
   * rather than nothing at all — building one of these from a description is
   * hard enough without the game staying silent about why it did not work.
   */
  strikeLight(hit) {
    this.placeTimer = 0.4;
    const result = ignite(this.world, hit.x, hit.y, hit.z);
    if (result.lit) {
      sfx.door();
      this.particles.burst(
        new THREE.Vector3(hit.x + 0.5, hit.y + 1.5, hit.z + 0.5), 0xa855f7, 24, 2.5);
      if (this.onNotify) this.onNotify('The portal opens');
      return;
    }
    sfx.hit();
    if (this.onNotify) {
      this.onNotify(result.sawAir
        ? 'That frame is not closed: obsidian all the way round, two by three inside'
        : 'Nothing to light here');
    }
  }

  /** The gaze flattened to one of the four compass steps. */
  facingStep() {
    const { fwd } = this.player.headingBasis();
    if (Math.abs(fwd.x) >= Math.abs(fwd.z)) return [fwd.x >= 0 ? 1 : -1, 0];
    return [0, fwd.z >= 0 ? 1 : -1];
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

  /** The [x, z] of this bed's other half, or null if it stands alone. */
  bedPartner(x, y, z, id) {
    const partner = bedPartnerId(id);
    const steps = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (const [dx, dz] of steps) {
      if (this.world.get(x + dx, y, z + dz) === partner) return [x + dx, z + dz];
    }
    return null;
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
      70: 0xf0f4ff, 71: 0xf0f4ff, 72: 0xdcd2a0, 73: 0x4f8a3c, 74: 0x326444,
      75: 0x74302e, 76: 0xff8a2a, 77: 0x56423a, 78: 0xb9b0a4, 79: 0x341a1e,
      80: 0x1a1226, 84: 0xe6e2da,
    };
    return COLORS[id] ?? 0x9a9a9a;
  }
}

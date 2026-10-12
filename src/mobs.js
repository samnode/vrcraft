// Pigs and zombies. Each mob type is baked into a single merged, vertex-coloured
// geometry so one mob costs one draw call — important with a Quest frame budget.

import * as THREE from '../vendor/three/three.module.js?v=9';
import {
  isSolid, PORKCHOP, BEEF, RAW_CHICKEN, LEATHER, FEATHER, BONE, STRING,
  ARROW, GUNPOWDER, AIR, block,
} from './blocks.js?v=9';
import { SEA_LEVEL, SY } from './world.js?v=9';
import { rand2 } from './noise.js?v=9';
import { sfx } from './sfx.js?v=9';

/** Merge axis-aligned boxes into one geometry, colour baked into the vertices. */
function mergeBoxes(parts) {
  const pos = [], norm = [], col = [];
  for (const part of parts) {
    const g = new THREE.BoxGeometry(...part.size).toNonIndexed();
    g.translate(...part.pos);
    const p = g.attributes.position.array, n = g.attributes.normal.array;
    const c = new THREE.Color(part.color);
    for (let i = 0; i < p.length; i += 3) {
      pos.push(p[i], p[i + 1], p[i + 2]);
      norm.push(n[i], n[i + 1], n[i + 2]);
      col.push(c.r, c.g, c.b);
    }
    g.dispose();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(norm, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.computeBoundingSphere();
  return geo;
}

const PIG = () => mergeBoxes([
  { size: [0.62, 0.56, 0.95], pos: [0, 0.58, 0],      color: 0xeea6a0 },  // body
  { size: [0.46, 0.44, 0.40], pos: [0, 0.66, -0.64],  color: 0xf2b3ac },  // head
  { size: [0.22, 0.14, 0.10], pos: [0, 0.60, -0.87],  color: 0xd98d88 },  // snout
  { size: [0.16, 0.34, 0.16], pos: [-0.20, 0.17, -0.30], color: 0xdd938e },
  { size: [0.16, 0.34, 0.16], pos: [0.20, 0.17, -0.30],  color: 0xdd938e },
  { size: [0.16, 0.34, 0.16], pos: [-0.20, 0.17, 0.30],  color: 0xdd938e },
  { size: [0.16, 0.34, 0.16], pos: [0.20, 0.17, 0.30],   color: 0xdd938e },
]);

const ZOMBIE = () => mergeBoxes([
  { size: [0.50, 0.70, 0.28], pos: [0, 1.12, 0],      color: 0x3a6b4a },  // torso
  { size: [0.44, 0.44, 0.44], pos: [0, 1.66, 0],      color: 0x5c8a5f },  // head
  { size: [0.16, 0.58, 0.44], pos: [-0.33, 1.22, -0.16], color: 0x4a7a55 }, // arms out
  { size: [0.16, 0.58, 0.44], pos: [0.33, 1.22, -0.16],  color: 0x4a7a55 },
  { size: [0.18, 0.78, 0.18], pos: [-0.13, 0.39, 0],  color: 0x2f4f6b },  // legs
  { size: [0.18, 0.78, 0.18], pos: [0.13, 0.39, 0],   color: 0x2f4f6b },
]);

const COW = () => mergeBoxes([
  { size: [0.68, 0.64, 1.05], pos: [0, 0.66, 0],        color: 0x4a3c33 },
  { size: [0.46, 0.46, 0.42], pos: [0, 0.78, -0.72],    color: 0x6b584b },
  { size: [0.50, 0.26, 0.30], pos: [0, 0.92, 0.12],     color: 0xe8e2d8 },  // white patch
  { size: [0.10, 0.10, 0.10], pos: [-0.20, 0.98, -0.78], color: 0xd8d2c4 }, // horns
  { size: [0.10, 0.10, 0.10], pos: [0.20, 0.98, -0.78], color: 0xd8d2c4 },
  { size: [0.18, 0.38, 0.18], pos: [-0.22, 0.19, -0.34], color: 0x3e332b },
  { size: [0.18, 0.38, 0.18], pos: [0.22, 0.19, -0.34],  color: 0x3e332b },
  { size: [0.18, 0.38, 0.18], pos: [-0.22, 0.19, 0.34],  color: 0x3e332b },
  { size: [0.18, 0.38, 0.18], pos: [0.22, 0.19, 0.34],   color: 0x3e332b },
]);

const SHEEP = () => mergeBoxes([
  { size: [0.70, 0.66, 0.98], pos: [0, 0.62, 0],       color: 0xeceae2 },  // fleece
  { size: [0.40, 0.40, 0.38], pos: [0, 0.68, -0.66],   color: 0xd9cfc0 },
  { size: [0.14, 0.32, 0.14], pos: [-0.20, 0.16, -0.30], color: 0xcfc6b8 },
  { size: [0.14, 0.32, 0.14], pos: [0.20, 0.16, -0.30],  color: 0xcfc6b8 },
  { size: [0.14, 0.32, 0.14], pos: [-0.20, 0.16, 0.30],  color: 0xcfc6b8 },
  { size: [0.14, 0.32, 0.14], pos: [0.20, 0.16, 0.30],   color: 0xcfc6b8 },
]);

const CHICKEN = () => mergeBoxes([
  { size: [0.34, 0.34, 0.46], pos: [0, 0.38, 0],       color: 0xf2f2ee },
  { size: [0.26, 0.26, 0.24], pos: [0, 0.60, -0.24],   color: 0xf6f6f2 },
  { size: [0.08, 0.08, 0.12], pos: [0, 0.57, -0.40],   color: 0xe8a33d },  // beak
  { size: [0.12, 0.10, 0.06], pos: [0, 0.74, -0.20],   color: 0xc0392b },  // comb
  { size: [0.06, 0.20, 0.06], pos: [-0.10, 0.10, 0],   color: 0xe8a33d },
  { size: [0.06, 0.20, 0.06], pos: [0.10, 0.10, 0],    color: 0xe8a33d },
]);

const SKELETON = () => mergeBoxes([
  { size: [0.38, 0.66, 0.22], pos: [0, 1.10, 0],       color: 0xd8d8d2 },
  { size: [0.42, 0.42, 0.42], pos: [0, 1.64, 0],       color: 0xe4e4de },
  { size: [0.12, 0.56, 0.38], pos: [-0.28, 1.20, -0.14], color: 0xcfcfc8 },
  { size: [0.12, 0.56, 0.38], pos: [0.28, 1.20, -0.14],  color: 0xcfcfc8 },
  { size: [0.14, 0.76, 0.14], pos: [-0.11, 0.38, 0],   color: 0xcfcfc8 },
  { size: [0.14, 0.76, 0.14], pos: [0.11, 0.38, 0],    color: 0xcfcfc8 },
]);

const CREEPER = () => mergeBoxes([
  { size: [0.50, 0.80, 0.34], pos: [0, 1.02, 0],       color: 0x5fa84e },
  { size: [0.46, 0.46, 0.46], pos: [0, 1.65, 0],       color: 0x6cb85a },
  { size: [0.12, 0.12, 0.04], pos: [-0.12, 1.72, -0.23], color: 0x101510 },  // face
  { size: [0.12, 0.12, 0.04], pos: [0.12, 1.72, -0.23],  color: 0x101510 },
  { size: [0.16, 0.18, 0.04], pos: [0, 1.56, -0.23],     color: 0x101510 },
  { size: [0.20, 0.42, 0.20], pos: [-0.14, 0.21, -0.14], color: 0x4e8f40 },
  { size: [0.20, 0.42, 0.20], pos: [0.14, 0.21, -0.14],  color: 0x4e8f40 },
  { size: [0.20, 0.42, 0.20], pos: [-0.14, 0.21, 0.14],  color: 0x4e8f40 },
  { size: [0.20, 0.42, 0.20], pos: [0.14, 0.21, 0.14],   color: 0x4e8f40 },
]);

const SPIDER = () => mergeBoxes([
  { size: [0.62, 0.42, 0.72], pos: [0, 0.32, 0.18],    color: 0x30211c },
  { size: [0.44, 0.38, 0.40], pos: [0, 0.34, -0.42],   color: 0x3a2822 },
  { size: [0.09, 0.09, 0.04], pos: [-0.11, 0.44, -0.62], color: 0xc0392b },
  { size: [0.09, 0.09, 0.04], pos: [0.11, 0.44, -0.62],  color: 0xc0392b },
  // Legs: wide, low and splayed, which is what reads as "spider" at a glance.
  { size: [0.62, 0.08, 0.08], pos: [-0.46, 0.18, -0.16], color: 0x241812 },
  { size: [0.62, 0.08, 0.08], pos: [0.46, 0.18, -0.16],  color: 0x241812 },
  { size: [0.62, 0.08, 0.08], pos: [-0.46, 0.18, 0.16],  color: 0x241812 },
  { size: [0.62, 0.08, 0.08], pos: [0.46, 0.18, 0.16],   color: 0x241812 },
  { size: [0.62, 0.08, 0.08], pos: [-0.46, 0.18, 0.48],  color: 0x241812 },
  { size: [0.62, 0.08, 0.08], pos: [0.46, 0.18, 0.48],   color: 0x241812 },
]);

/**
 * drops: [itemId, chance, max] rolled on death.
 * ranged mobs keep their distance and shoot; 'explode' mobs run in and detonate.
 */
const TYPES = {
  pig:      { build: PIG,      width: 0.9, height: 0.9, speed: 1.15, health: 10, hostile: false,
              drops: [[PORKCHOP, 1, 2]] },
  cow:      { build: COW,      width: 0.9, height: 1.2, speed: 1.0,  health: 10, hostile: false,
              drops: [[BEEF, 1, 2], [LEATHER, 0.7, 2]] },
  sheep:    { build: SHEEP,    width: 0.9, height: 1.1, speed: 1.1,  health: 8,  hostile: false,
              drops: [[42, 1, 2]] },                       // wool
  chicken:  { build: CHICKEN,  width: 0.5, height: 0.7, speed: 1.3,  health: 4,  hostile: false,
              drops: [[RAW_CHICKEN, 1, 1], [FEATHER, 0.9, 2]] },
  zombie:   { build: ZOMBIE,   width: 0.6, height: 1.9, speed: 2.1,  health: 20, hostile: true,
              burnsInSun: true, attack: 3, drops: [] },
  skeleton: { build: SKELETON, width: 0.6, height: 1.9, speed: 1.9,  health: 16, hostile: true,
              burnsInSun: true, ranged: true, attack: 2, drops: [[BONE, 1, 2], [ARROW, 0.6, 2]] },
  creeper:  { build: CREEPER,  width: 0.6, height: 1.8, speed: 1.8,  health: 16, hostile: true,
              explodes: true, drops: [[GUNPOWDER, 0.8, 2]] },
  spider:   { build: SPIDER,   width: 1.1, height: 0.7, speed: 2.6,  health: 12, hostile: true,
              attack: 2, drops: [[STRING, 1, 2]] },
};

class Mob {
  constructor(type, position) {
    this.type = type;
    this.def = TYPES[type];
    this.position = position.clone();
    this.velocity = new THREE.Vector3();
    this.yaw = Math.random() * Math.PI * 2;
    this.health = this.def.health;
    this.onGround = false;
    this.wanderTimer = 0;
    this.wander = new THREE.Vector2(0, 0);
    this.attackCooldown = 0;
    this.hurtFlash = 0;
    this.bob = Math.random() * 6;
    this.dead = false;
    this.fuse = 0;              // creepers only: counts up once you are close
  }

  get center() {
    return new THREE.Vector3(this.position.x, this.position.y + this.def.height * 0.55, this.position.z);
  }

  /** Does a point fall inside this mob's hit box? */
  containsPoint(p) {
    const h = this.def.width / 2;
    return Math.abs(p.x - this.position.x) <= h
        && Math.abs(p.z - this.position.z) <= h
        && p.y >= this.position.y - 0.1
        && p.y <= this.position.y + this.def.height + 0.1;
  }
}

export class Mobs {
  constructor(scene, world, survival) {
    this.world = world;
    this.survival = survival;
    this.list = [];
    this.group = new THREE.Group();
    scene.add(this.group);

    this.geometries = {};
    this.material = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.hurtMaterial = new THREE.MeshLambertMaterial({ vertexColors: true, color: 0xff7070 });
    for (const [name, def] of Object.entries(TYPES)) this.geometries[name] = def.build();

    this.spawnTimer = 2;
    this.onDrop = null;            // (blockId, count, position) => void
    this.onExplode = null;         // (position, radius) => void
    this.arrows = new Arrows(scene, world);
  }

  spawn(type, x, y, z) {
    if (this.list.length >= 18) return null;
    const mob = new Mob(type, new THREE.Vector3(x, y, z));
    mob.mesh = new THREE.Mesh(this.geometries[type], this.material);
    this.group.add(mob.mesh);
    this.list.push(mob);
    return mob;
  }

  update(dt, player) {
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawnTimer = 3;
      this.tryNaturalSpawn(player);
    }

    const playerFeet = player.position;
    for (const mob of this.list) {
      if (mob.dead) continue;
      this.think(dt, mob, player, playerFeet);
      this.physics(dt, mob);
      this.render(mob, dt);
    }
    this.arrows.update(dt, player, this.survival, this);

    // Retire the dead and anything that wandered out of the loaded world.
    this.list = this.list.filter((mob) => {
      const far = mob.position.distanceTo(playerFeet) > 80;
      if (!mob.dead && !far) return true;
      this.group.remove(mob.mesh);
      return false;
    });
  }

  think(dt, mob, player, playerFeet) {
    mob.attackCooldown = Math.max(0, mob.attackCooldown - dt);
    mob.hurtFlash = Math.max(0, mob.hurtFlash - dt * 3);

    const toPlayer = new THREE.Vector3().subVectors(playerFeet, mob.position);
    const dist = toPlayer.length();

    if (mob.def.hostile && dist < 18 && this.survival.enabled && !this.survival.dead) {
      mob.yaw = Math.atan2(toPlayer.x, toPlayer.z);

      if (mob.def.ranged) {
        // Skeletons hold a firing line instead of closing to melee.
        const want = dist < 5 ? -1 : (dist > 9 ? 1 : 0);
        mob.velocity.x = Math.sin(mob.yaw) * mob.def.speed * want;
        mob.velocity.z = Math.cos(mob.yaw) * mob.def.speed * want;
        if (dist < 16 && mob.attackCooldown === 0) {
          mob.attackCooldown = 1.8;
          this.arrows.fire(mob.center, playerFeet.clone().setY(playerFeet.y + 1.2), 18);
        }
      } else if (mob.def.explodes) {
        // Creepers close in, then hiss and detonate whether or not you flee.
        const push = dist > 0.9 ? 1 : 0;
        mob.velocity.x = Math.sin(mob.yaw) * mob.def.speed * push;
        mob.velocity.z = Math.cos(mob.yaw) * mob.def.speed * push;
        if (dist < 3.2) {
          if (mob.fuse === 0) sfx.fuse();
          mob.fuse += dt;
          if (mob.fuse > 1.5) { this.explode(mob); return; }
        } else {
          mob.fuse = Math.max(0, mob.fuse - dt);
        }
      } else {
        const push = dist > 1.1 ? 1 : 0;
        mob.velocity.x = Math.sin(mob.yaw) * mob.def.speed * push;
        mob.velocity.z = Math.cos(mob.yaw) * mob.def.speed * push;
        if (dist < 1.6 && Math.abs(toPlayer.y) < 2.2 && mob.attackCooldown === 0) {
          mob.attackCooldown = 1.1;
          this.survival.damage(mob.def.attack ?? 3, `a ${mob.type}`);
        }
      }

      // Daylight burns the undead, which keeps nights meaningful.
      if (mob.def.burnsInSun && this.survival.daylight > 0.85 && this.skyExposed(mob)) {
        this.hurt(mob, dt * 3);
      }
      return;
    }

    mob.wanderTimer -= dt;
    if (mob.wanderTimer <= 0) {
      mob.wanderTimer = 2 + Math.random() * 4;
      if (Math.random() < 0.35) {
        mob.wander.set(0, 0);                       // idle
      } else {
        mob.yaw = Math.random() * Math.PI * 2;
        mob.wander.set(Math.sin(mob.yaw), Math.cos(mob.yaw));
      }
    }
    mob.velocity.x = mob.wander.x * mob.def.speed;
    mob.velocity.z = mob.wander.y * mob.def.speed;
  }

  physics(dt, mob) {
    dt = Math.min(dt, 0.05);
    mob.velocity.y -= 26 * dt;
    if (mob.velocity.y < -40) mob.velocity.y = -40;

    const move = (axis, amount) => {
      if (!amount) return false;
      const before = mob.position[axis];
      mob.position[axis] += amount;
      if (!this.collides(mob)) return false;
      mob.position[axis] = before;
      return true;
    };

    // Same landing rule as the player: rest on top of the block actually entered.
    const dy = mob.velocity.y * dt;
    if (dy) {
      const before = mob.position.y;
      mob.position.y += dy;
      if (this.collides(mob)) {
        if (dy < 0) {
          mob.position.y = Math.floor(mob.position.y) + 1;
          if (this.collides(mob)) mob.position.y = before;
          mob.onGround = true;
        } else {
          mob.position.y = before;
        }
        mob.velocity.y = 0;
      } else {
        mob.onGround = false;
      }
    }

    const bx = move('x', mob.velocity.x * dt);
    const bz = move('z', mob.velocity.z * dt);
    // Hop over single-block obstacles, otherwise turn around.
    if ((bx || bz) && mob.onGround) {
      mob.velocity.y = 7.2;
      if (!mob.def.hostile) { mob.wander.multiplyScalar(-1); mob.wanderTimer = 1.5; }
    }
    if (mob.position.y < -6) mob.dead = true;
  }

  collides(mob) {
    const h = mob.def.width / 2;
    const { x, y, z } = mob.position;
    const y1 = y + mob.def.height - 0.001;
    for (let yy = Math.floor(y + 0.001); yy <= Math.floor(y1); yy++) {
      for (let zz = Math.floor(z - h); zz <= Math.floor(z + h); zz++) {
        for (let xx = Math.floor(x - h); xx <= Math.floor(x + h); xx++) {
          if (isSolid(this.world.get(xx, yy, zz))) return true;
        }
      }
    }
    return false;
  }

  skyExposed(mob) {
    const x = Math.floor(mob.position.x), z = Math.floor(mob.position.z);
    for (let y = Math.floor(mob.position.y + mob.def.height) + 1; y < SY; y++) {
      if (isSolid(this.world.get(x, y, z))) return false;
    }
    return true;
  }

  render(mob, dt) {
    mob.bob += dt * (Math.hypot(mob.velocity.x, mob.velocity.z) > 0.2 ? 9 : 1.5);
    mob.mesh.position.set(mob.position.x, mob.position.y, mob.position.z);
    mob.mesh.rotation.y = mob.yaw;
    // A bob and slight roll stand in for limb animation at VR viewing distance.
    const walking = Math.hypot(mob.velocity.x, mob.velocity.z) > 0.2;
    mob.mesh.position.y += walking ? Math.abs(Math.sin(mob.bob)) * 0.06 : 0;
    mob.mesh.rotation.z = walking ? Math.sin(mob.bob) * 0.05 : 0;
    // A creeper about to go off blinks, which is the only warning you get.
    const priming = mob.fuse > 0 && Math.sin(mob.fuse * 22) > 0;
    mob.mesh.material = (mob.hurtFlash > 0 || priming) ? this.hurtMaterial : this.material;
    mob.mesh.scale.setScalar(mob.fuse > 0 ? 1 + Math.min(mob.fuse, 1.5) * 0.12 : 1);
  }

  hurt(mob, amount) {
    mob.health -= amount;
    mob.hurtFlash = 0.3;
    mob.velocity.y = Math.max(mob.velocity.y, 2.5);
    if (mob.health <= 0 && !mob.dead) {
      mob.dead = true;
      this.rollDrops(mob);
    }
  }

  rollDrops(mob) {
    if (!this.onDrop) return;
    for (const [id, chance, max] of mob.def.drops ?? []) {
      if (Math.random() > chance) continue;
      this.onDrop(id, 1 + Math.floor(Math.random() * max), mob.center);
    }
  }

  /** Blows a spherical hole in the world and hurts everything nearby. */
  explode(mob) {
    mob.dead = true;
    const radius = 3.2;
    const cx = Math.floor(mob.position.x), cy = Math.floor(mob.position.y), cz = Math.floor(mob.position.z);
    const r = Math.ceil(radius);
    for (let y = cy - r; y <= cy + r; y++) {
      for (let z = cz - r; z <= cz + r; z++) {
        for (let x = cx - r; x <= cx + r; x++) {
          const d = Math.hypot(x - cx, y - cy, z - cz);
          // Ragged edge rather than a perfect sphere.
          if (d > radius - 0.5 + Math.random() * 0.9) continue;
          const id = this.world.get(x, y, z);
          if (id === AIR || block(id).hardness === null) continue;
          this.world.set(x, y, z, AIR);
        }
      }
    }
    if (this.onExplode) this.onExplode(mob.center, radius);
    sfx.explode();
  }

  /** First mob whose hit box the ray crosses, within maxDistance. */
  pick(origin, direction, maxDistance = 4) {
    let best = null, bestT = maxDistance;
    const p = new THREE.Vector3();
    for (const mob of this.list) {
      if (mob.dead) continue;
      for (let t = 0.2; t < bestT; t += 0.12) {
        p.copy(direction).multiplyScalar(t).add(origin);
        if (mob.containsPoint(p)) { best = mob; bestT = t; break; }
      }
    }
    return best ? { mob: best, distance: bestT } : null;
  }

  tryNaturalSpawn(player) {
    const night = this.survival.isNight;
    const passive = this.list.filter((m) => !m.def.hostile && !m.dead).length;
    const hostile = this.list.filter((m) => m.def.hostile && !m.dead).length;

    const wantPassive = passive < 8;
    const wantHostile = night && this.survival.enabled && hostile < 6;
    if (!wantPassive && !wantHostile) return;

    const PASSIVE = ['pig', 'cow', 'sheep', 'chicken'];
    const HOSTILE = ['zombie', 'skeleton', 'creeper', 'spider'];

    for (let attempt = 0; attempt < 12; attempt++) {
      const angle = Math.random() * Math.PI * 2;
      const r = 14 + Math.random() * 18;
      const x = Math.floor(player.position.x + Math.cos(angle) * r);
      const z = Math.floor(player.position.z + Math.sin(angle) * r);
      const y = this.world.surfaceY(x, z);
      if (y <= SEA_LEVEL + 1 || y >= SY - 2) continue;      // not in water or the ceiling

      const goHostile = wantHostile && (!wantPassive || Math.random() < 0.6);
      const pool = goHostile ? HOSTILE : PASSIVE;
      const type = pool[Math.floor(Math.random() * pool.length)];
      if (!goHostile && rand2(x, z, 3) < 0.25) continue;    // thin the herds a little

      const mob = this.spawn(type, x + 0.5, y, z + 0.5);
      if (mob && this.collides(mob)) mob.dead = true;
      return;
    }
  }
}

/**
 * Arrows, fired by skeletons and by the player's bow. A small pool of boxes with
 * ballistic motion; they stick nothing, they just hit and vanish.
 */
class Arrows {
  constructor(scene, world) {
    this.world = world;
    this.list = [];
    this.group = new THREE.Group();
    scene.add(this.group);
    this.geometry = mergeBoxes([
      { size: [0.06, 0.06, 0.5], pos: [0, 0, 0], color: 0x8a6636 },
      { size: [0.09, 0.09, 0.12], pos: [0, 0, -0.28], color: 0xd8d8dc },
    ]);
    this.material = new THREE.MeshLambertMaterial({ vertexColors: true });
  }

  /** Lobs an arrow from `from` towards `to`, with a little lift for the drop. */
  fire(from, to, speed, fromPlayer = false) {
    const dir = new THREE.Vector3().subVectors(to, from);
    const dist = dir.length();
    dir.normalize();
    dir.y += Math.min(0.35, dist * 0.018);          // crude ballistic lead
    dir.normalize();

    const mesh = new THREE.Mesh(this.geometry, this.material);
    this.group.add(mesh);
    this.list.push({
      position: from.clone(),
      velocity: dir.multiplyScalar(speed),
      life: 4,
      fromPlayer,
      mesh,
    });
    sfx.shoot();
  }

  update(dt, player, survival, mobs) {
    const step = Math.min(dt, 0.05);
    for (const a of this.list) {
      a.life -= step;
      a.velocity.y -= 14 * step;
      a.position.addScaledVector(a.velocity, step);

      a.mesh.position.copy(a.position);
      a.mesh.lookAt(a.position.clone().add(a.velocity));

      if (isSolid(this.world.get(
        Math.floor(a.position.x), Math.floor(a.position.y), Math.floor(a.position.z)))) {
        a.life = 0;
        continue;
      }

      if (a.fromPlayer) {
        const hit = mobs.list.find((m) => !m.dead && m.containsPoint(a.position));
        if (hit) { mobs.hurt(hit, 5); a.life = 0; }
      } else if (survival.enabled && !survival.dead) {
        const feet = player.position;
        const near = Math.abs(a.position.x - feet.x) < 0.5
          && Math.abs(a.position.z - feet.z) < 0.5
          && a.position.y > feet.y - 0.2 && a.position.y < feet.y + 1.9;
        if (near) { survival.damage(2, 'an arrow'); a.life = 0; }
      }
    }

    this.list = this.list.filter((a) => {
      if (a.life > 0) return true;
      this.group.remove(a.mesh);
      return false;
    });
  }
}

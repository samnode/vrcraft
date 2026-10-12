// Pigs and zombies. Each mob type is baked into a single merged, vertex-coloured
// geometry so one mob costs one draw call — important with a Quest frame budget.

import * as THREE from '../vendor/three/three.module.js';
import { isSolid, PORKCHOP } from './blocks.js';
import { SEA_LEVEL, SY } from './world.js';
import { rand2 } from './noise.js';

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

const TYPES = {
  pig:    { build: PIG,    width: 0.9, height: 0.9, speed: 1.15, health: 10, hostile: false, drop: PORKCHOP },
  zombie: { build: ZOMBIE, width: 0.6, height: 1.9, speed: 2.1,  health: 20, hostile: true,  drop: 0 },
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
    this.onDrop = null;            // (blockId, position) => void
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
      // Chase: head straight for the player and swing on contact.
      mob.yaw = Math.atan2(toPlayer.x, toPlayer.z);
      const push = dist > 1.1 ? 1 : 0;
      mob.velocity.x = Math.sin(mob.yaw) * mob.def.speed * push;
      mob.velocity.z = Math.cos(mob.yaw) * mob.def.speed * push;
      if (dist < 1.6 && Math.abs(toPlayer.y) < 2.2 && mob.attackCooldown === 0) {
        mob.attackCooldown = 1.1;
        this.survival.damage(3, 'a zombie');
      }
      // Daylight burns the undead, which keeps nights meaningful.
      if (this.survival.daylight > 0.85 && this.skyExposed(mob)) this.hurt(mob, dt * 3);
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
    mob.mesh.material = mob.hurtFlash > 0 ? this.hurtMaterial : this.material;
  }

  hurt(mob, amount) {
    mob.health -= amount;
    mob.hurtFlash = 0.3;
    mob.velocity.y = Math.max(mob.velocity.y, 2.5);
    if (mob.health <= 0 && !mob.dead) {
      mob.dead = true;
      if (mob.def.drop && this.onDrop) this.onDrop(mob.def.drop, mob.center);
    }
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
    const pigs = this.list.filter((m) => m.type === 'pig' && !m.dead).length;
    const zombies = this.list.filter((m) => m.type === 'zombie' && !m.dead).length;

    const wantPig = pigs < 6;
    const wantZombie = night && this.survival.enabled && zombies < 5;
    if (!wantPig && !wantZombie) return;

    for (let attempt = 0; attempt < 12; attempt++) {
      const angle = Math.random() * Math.PI * 2;
      const r = 14 + Math.random() * 18;
      const x = Math.floor(player.position.x + Math.cos(angle) * r);
      const z = Math.floor(player.position.z + Math.sin(angle) * r);
      const y = this.world.surfaceY(x, z);
      if (y <= SEA_LEVEL + 1 || y >= SY - 2) continue;      // not in water or the ceiling

      const type = wantZombie && (!wantPig || Math.random() < 0.6) ? 'zombie' : 'pig';
      if (type === 'pig' && rand2(x, z, 3) < 0.3) continue; // thin the herd out a little
      const mob = this.spawn(type, x + 0.5, y, z + 0.5);
      if (mob && this.collides(mob)) mob.dead = true;
      return;
    }
  }
}

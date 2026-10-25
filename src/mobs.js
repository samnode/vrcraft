// Pigs and zombies, and the Nether's own two. Each mob type is baked into a
// single merged, vertex-coloured geometry so one mob costs one draw call —
// important with a Quest frame budget.

import * as THREE from '../vendor/three/three.module.js?v=37';
import {
  isSolid, isLava, isBlastProof, PORKCHOP, BEEF, RAW_CHICKEN, LEATHER, FEATHER,
  BONE, STRING, ARROW, GUNPOWDER, QUARTZ, ENDER_PEARL, AIR,
} from './blocks.js?v=37';
import { SEA_LEVEL, SY } from './world.js?v=37';
import { rand2 } from './noise.js?v=37';
import { sfx } from './sfx.js?v=37';
import { mergeBoxes } from './textures.js?v=37';

// Scratch vectors for the boss's steering, which runs every frame and would
// otherwise allocate two Vector3s per frame for the life of the fight.
const TMP_A = new THREE.Vector3();
const TMP_B = new THREE.Vector3();

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

// Zombie proportions in pig colours, with a gold blade: the silhouette has to
// read as "the thing that kills you" from across a cavern, and the sword is what
// says that faster than the tint does.
const PIGMAN = () => mergeBoxes([
  { size: [0.50, 0.70, 0.28], pos: [0, 1.12, 0],         color: 0xc9827e },
  { size: [0.44, 0.44, 0.44], pos: [0, 1.66, 0],         color: 0xdd9690 },
  { size: [0.24, 0.15, 0.10], pos: [0, 1.59, -0.26],     color: 0xa96a66 },  // snout
  { size: [0.10, 0.10, 0.04], pos: [-0.12, 1.73, -0.23], color: 0x2a1418 },  // eyes
  { size: [0.10, 0.10, 0.04], pos: [0.12, 1.73, -0.23],  color: 0x2a1418 },
  { size: [0.16, 0.58, 0.44], pos: [-0.33, 1.22, -0.16], color: 0xbb7773 },  // arms out
  { size: [0.16, 0.58, 0.44], pos: [0.33, 1.22, -0.16],  color: 0xbb7773 },
  { size: [0.18, 0.78, 0.18], pos: [-0.13, 0.39, 0],     color: 0x6d5a48 },  // legs
  { size: [0.18, 0.78, 0.18], pos: [0.13, 0.39, 0],      color: 0x6d5a48 },
  { size: [0.07, 0.07, 0.54], pos: [0.33, 1.04, -0.54],  color: 0xe6c258 },  // gold blade
]);

/** Nine tentacles of uneven length, hung under the body on a 3x3 grid. */
function ghastTentacles() {
  const out = [];
  for (let i = 0; i < 9; i++) {
    const gx = (i % 3) - 1, gz = Math.floor(i / 3) - 1;
    const len = 0.5 + ((i * 7) % 5) * 0.16;
    out.push({
      size: [0.18, len, 0.18],
      pos: [gx * 0.52, 0.84 - len / 2, gz * 0.52],
      color: 0xd8d2cc,
    });
  }
  return out;
}

// A ghast is mostly face. The eyes and mouth are inset on the -z side, which is
// the direction every mob model in here faces, so it looks at what it is hunting.
const GHAST = () => mergeBoxes([
  { size: [1.58, 1.48, 1.58], pos: [0, 1.60, 0],         color: 0xe9e5e1 },
  { size: [0.26, 0.24, 0.06], pos: [-0.34, 1.80, -0.80], color: 0x1c1420 },
  { size: [0.26, 0.24, 0.06], pos: [0.34, 1.80, -0.80],  color: 0x1c1420 },
  { size: [0.50, 0.26, 0.06], pos: [0, 1.36, -0.80],     color: 0x1c1420 },
  ...ghastTentacles(),
]);

// Tall, thin, and almost entirely silhouette. The limbs are deliberately longer
// than any proportion that makes sense, because an enderman's whole effect is
// being the wrong shape for a person.
const ENDERMAN = () => mergeBoxes([
  { size: [0.42, 0.72, 0.26], pos: [0, 1.74, 0],         color: 0x15131a },
  { size: [0.44, 0.44, 0.44], pos: [0, 2.36, 0],         color: 0x1b1822 },
  { size: [0.12, 0.11, 0.05], pos: [-0.12, 2.42, -0.22], color: 0xd98bff },  // eyes
  { size: [0.12, 0.11, 0.05], pos: [0.12, 2.42, -0.22],  color: 0xd98bff },
  { size: [0.12, 1.12, 0.12], pos: [-0.30, 1.62, 0],     color: 0x15131a },  // arms
  { size: [0.12, 1.12, 0.12], pos: [0.30, 1.62, 0],      color: 0x15131a },
  { size: [0.13, 1.38, 0.13], pos: [-0.12, 0.69, 0],     color: 0x15131a },  // legs
  { size: [0.13, 1.38, 0.13], pos: [0.12, 0.69, 0],      color: 0x15131a },
]);

/** A tapering run of boxes, used for both the dragon's neck and its tail. */
function dragonSpine(from, to, segments, size, color) {
  const out = [];
  for (let i = 0; i < segments; i++) {
    const t = i / (segments - 1);
    const s = size * (1 - t * 0.62);
    out.push({
      size: [s, s, (to - from) / segments + 0.08],
      pos: [0, 2.0 + Math.sin(t * 0.9) * 0.25, from + (to - from) * t],
      color,
    });
  }
  return out;
}

// The dragon is built facing -z like every other mob here, so the head is at
// negative z and the tail runs back behind it. Wings are flat slabs rather than
// anything hinged: the geometry is merged and cannot articulate, so the shape
// has to carry the whole impression on its own.
// Lighter than a black dragon has any right to be. The End's sky is nearly
// black and its scene lights are faint, so a model painted the colour the thing
// actually is disappears into the background entirely.
const DRAGON = () => mergeBoxes([
  { size: [1.70, 1.30, 2.60], pos: [0, 2.0, 0],        color: 0x342c4c },   // body
  ...dragonSpine(-1.4, -3.6, 4, 0.85, 0x3b3254),                            // neck
  { size: [0.90, 0.80, 1.20], pos: [0, 2.18, -4.20],   color: 0x443a60 },   // head
  { size: [0.74, 0.26, 1.00], pos: [0, 1.76, -4.34],   color: 0x2b2440 },   // jaw
  { size: [0.18, 0.17, 0.06], pos: [-0.26, 2.40, -4.74], color: 0xe79aff }, // eyes
  { size: [0.18, 0.17, 0.06], pos: [0.26, 2.40, -4.74],  color: 0xe79aff },
  { size: [0.14, 0.42, 0.14], pos: [-0.30, 2.66, -3.86], color: 0x241e36 }, // horns
  { size: [0.14, 0.42, 0.14], pos: [0.30, 2.66, -3.86],  color: 0x241e36 },
  ...dragonSpine(1.4, 5.6, 5, 0.80, 0x3b3254),                              // tail
  { size: [4.60, 0.16, 1.90], pos: [-2.90, 2.55, 0.10], color: 0x4a3f6a },  // wings
  { size: [4.60, 0.16, 1.90], pos: [2.90, 2.55, 0.10],  color: 0x4a3f6a },
  { size: [1.30, 0.14, 1.10], pos: [-4.70, 2.42, 0.60], color: 0x5c4f82 },  // wing tips
  { size: [1.30, 0.14, 1.10], pos: [4.70, 2.42, 0.60],  color: 0x5c4f82 },
  { size: [0.30, 0.70, 0.30], pos: [-0.55, 1.20, 0.60], color: 0x2b2440 },  // legs
  { size: [0.30, 0.70, 0.30], pos: [0.55, 1.20, 0.60],  color: 0x2b2440 },
]);

/**
 * drops: [itemId, chance, max] rolled on death.
 * ranged mobs keep their distance and shoot; 'explode' mobs run in and detonate.
 * `neutral` mobs are hostile only once provoked, `floats` ones ignore gravity and
 * steer in three dimensions, and `fireproof` ones can stand in lava. `stared`
 * mobs count being looked at as provocation, and a `boss` flies its own pattern
 * and announces itself on the HUD.
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
  // The Nether's two. A pigman leaves you alone until you hit one, and then so
  // does every other pigman within earshot, which is the whole character of the
  // place: nothing down there is safe, but most of it is your own fault.
  pigman:   { build: PIGMAN,   width: 0.6, height: 1.9, speed: 1.9,  health: 20, hostile: true,
              neutral: true, fireproof: true, nether: true, attack: 4,
              drops: [[PORKCHOP, 1, 2], [QUARTZ, 0.4, 2]] },
  ghast:    { build: GHAST,    width: 1.8, height: 2.4, speed: 1.2,  health: 10, hostile: true,
              floats: true, fireball: true, fireproof: true, nether: true,
              drops: [[GUNPOWDER, 0.9, 2]] },
  // The End's two. An enderman is provoked by being looked at, which is the one
  // thing everybody knows about them, and blinks away rather than flinching.
  enderman: { build: ENDERMAN, width: 0.6, height: 2.9, speed: 2.4,  health: 20, hostile: true,
              neutral: true, stared: true, blinks: true, attack: 5,
              drops: [[ENDER_PEARL, 0.85, 2]] },
  dragon:   { build: DRAGON,   width: 4.0, height: 3.0, speed: 7.0,  health: 180, hostile: true,
              boss: true, floats: true, noclip: true, fireproof: true, attack: 8,
              name: 'Ender Dragon', altitude: 52, drops: [] },
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
    this.provoked = false;      // neutral mobs only: set when something hits them
    this.hover = position.y;    // floating mobs only: the altitude being sought
    this.pitch = 0;             // bosses only: nose-down angle while diving
    this.orbit = Math.random() * Math.PI * 2;
    this.phaseTimer = 6;        // counts down to the next change of mind
    this.breathTimer = 3;
    this.diving = false;
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
    this.gaze = null;              // the player's flattened look direction
    this.onDrop = null;            // (blockId, count, position) => void
    this.onExplode = null;         // (position, radius) => void
    this.onBossDeath = null;       // (mob) => void
    this.arrows = new Arrows(scene, world);
  }

  /** Hide this dimension's mobs and anything they have in the air. */
  setActive(on) {
    this.group.visible = on;
    this.arrows.group.visible = on;
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
    // Cached once a frame rather than per mob: every enderman asks the same
    // question about where the player is looking.
    this.gaze = player.headingBasis().fwd;
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
      // A boss is never retired for being far away: it is the reason you came,
      // and letting it despawn mid-flight would quietly end the fight.
      const far = !mob.def.boss && mob.position.distanceTo(playerFeet) > 80;
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

    // Anything standing in lava burns. Nether mobs are fireproof, so in practice
    // this is what happens to a creeper that chases you over the wrong edge.
    if (!mob.def.fireproof && this.inLava(mob)) this.hurt(mob, dt * 6);

    // Floating mobs steer vertically as part of thinking rather than falling,
    // because an altitude they are holding is a decision, not physics.
    if (mob.def.floats) this.steerHover(mob);

    if (mob.def.boss) { this.dragonThink(dt, mob, playerFeet); return; }

    // Being looked at counts as provocation. The test is generous in distance
    // and tight in angle: you have to be pointing at it, not merely facing the
    // half of the world it happens to be standing in.
    if (mob.def.stared && !mob.provoked && this.gaze && dist > 1.5 && dist < 26) {
      const nx = toPlayer.x / dist, nz = toPlayer.z / dist;
      if (-(nx * this.gaze.x + nz * this.gaze.z) > 0.985) {
        mob.provoked = true;
        sfx.fuse();
      }
    }

    // A neutral mob is hostile only once something has hit it.
    const angry = mob.def.hostile && (!mob.def.neutral || mob.provoked);
    if (angry && dist < 18 && this.survival.enabled && !this.survival.dead) {
      mob.yaw = Math.atan2(toPlayer.x, toPlayer.z);

      if (mob.def.fireball) {
        // A ghast holds off at range and lobs. Closing in would make it trivial
        // to hit with a sword, and the thing is supposed to be a problem.
        const want = dist < 9 ? -1 : (dist > 17 ? 1 : 0);
        mob.velocity.x = Math.sin(mob.yaw) * mob.def.speed * want;
        mob.velocity.z = Math.cos(mob.yaw) * mob.def.speed * want;
        if (dist < 22 && mob.attackCooldown === 0) {
          mob.attackCooldown = 3.0;
          this.arrows.fire(mob.center, playerFeet.clone().setY(playerFeet.y + 1.0), 13,
            false, 'fireball');
        }
      } else if (mob.def.ranged) {
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
      // An idle enderman relocates rather than strolls, now and then.
      if (mob.def.blinks && Math.random() < 0.25) { this.blink(mob); return; }
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

  /**
   * Hold an altitude a few blocks above whatever floor is below. Scanning for the
   * floor each time rather than remembering one is what lets a ghast drift out
   * over the lava sea and rise as the ground falls away beneath it.
   */
  steerHover(mob) {
    const x = Math.floor(mob.position.x), z = Math.floor(mob.position.z);
    let ground = null;
    for (let y = Math.floor(mob.position.y); y > 0 && y > mob.position.y - 24; y--) {
      if (isSolid(this.world.get(x, y, z))) { ground = y; break; }
    }
    if (ground !== null) mob.hover = Math.min(SY - 5, ground + 7);
    mob.velocity.y = THREE.MathUtils.clamp((mob.hover - mob.position.y) * 0.9, -1.6, 1.6);
  }

  /**
   * The dragon alternates between orbiting the island and diving at you. The
   * orbit is what makes it findable and shootable; the dive is what makes it a
   * fight. Nothing here consults the terrain — it flies through the pillars
   * rather than around them, because a boss wedged in a column is worse than a
   * boss that clips one.
   */
  dragonThink(dt, mob, playerFeet) {
    mob.attackCooldown = Math.max(0, mob.attackCooldown - dt);
    mob.hurtFlash = Math.max(0, mob.hurtFlash - dt * 3);
    mob.breathTimer -= dt;
    mob.phaseTimer -= dt;
    if (mob.phaseTimer <= 0) {
      mob.diving = !mob.diving;
      mob.phaseTimer = mob.diving ? 5 : 8;
    }

    const hunting = this.survival.enabled && !this.survival.dead;
    let target;
    if (mob.diving && hunting) {
      target = TMP_A.copy(playerFeet).add(TMP_B.set(0, 1.4, 0));
    } else {
      // Orbit the centre of the island, which is where the pillars point.
      mob.orbit += dt * 0.42;
      target = TMP_A.set(
        Math.cos(mob.orbit) * 36,
        mob.def.altitude,
        Math.sin(mob.orbit) * 36,
      );
    }

    const to = TMP_B.copy(target).sub(mob.position);
    const d = to.length();
    if (d > 0.001) to.multiplyScalar(1 / d);
    const speed = mob.diving ? mob.def.speed * 1.5 : mob.def.speed;
    mob.velocity.copy(to).multiplyScalar(Math.min(speed, d / Math.max(dt, 1e-3)));
    mob.yaw = Math.atan2(to.x, to.z);
    mob.pitch = Math.max(-0.7, Math.min(0.7, -to.y));

    const reach = playerFeet.distanceTo(mob.position);
    if (hunting && reach < 4.5 && mob.attackCooldown === 0) {
      mob.attackCooldown = 1.3;
      this.survival.damage(mob.def.attack, 'the dragon');
    }
    // Breath, only while it is on the wing: diving and breathing at once leaves
    // nowhere to stand, and the orbit is the half of the cycle you fight back in.
    if (hunting && !mob.diving && mob.breathTimer <= 0 && reach < 40) {
      mob.breathTimer = 3.4;
      this.arrows.fire(mob.center, playerFeet.clone().setY(playerFeet.y + 1.0), 16, false, 'fireball');
    }
  }

  /**
   * Jump somewhere else nearby — what an enderman does instead of flinching.
   * Returns false if there was nowhere to go, in which case it simply stays.
   */
  blink(mob) {
    const from = mob.position.clone();
    for (let i = 0; i < 16; i++) {
      const angle = Math.random() * Math.PI * 2;
      const r = 5 + Math.random() * 11;
      const x = Math.floor(from.x + Math.cos(angle) * r);
      const z = Math.floor(from.z + Math.sin(angle) * r);
      const y = this.world.standY(x, z, 3);
      if (y < 1) continue;
      mob.position.set(x + 0.5, y, z + 0.5);
      mob.velocity.set(0, 0, 0);
      if (!this.collides(mob)) return true;
    }
    mob.position.copy(from);
    return false;
  }

  /** Is any part of this mob standing in lava? */
  inLava(mob) {
    const x = Math.floor(mob.position.x), z = Math.floor(mob.position.z);
    return isLava(this.world.get(x, Math.floor(mob.position.y + 0.1), z))
        || isLava(this.world.get(x, Math.floor(mob.position.y + mob.def.height * 0.5), z));
  }

  physics(dt, mob) {
    dt = Math.min(dt, 0.05);

    if (mob.def.noclip) {
      mob.position.addScaledVector(mob.velocity, dt);
      return;
    }

    if (mob.def.floats) {
      // No gravity and no ground: it moves on all three axes and simply stops
      // against anything solid, which is enough for something that never jumps.
      for (const axis of ['y', 'x', 'z']) {
        const before = mob.position[axis];
        mob.position[axis] += mob.velocity[axis] * dt;
        if (this.collides(mob)) { mob.position[axis] = before; mob.velocity[axis] = 0; }
      }
      return;
    }

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
    const walking = !mob.def.floats && Math.hypot(mob.velocity.x, mob.velocity.z) > 0.2;
    mob.mesh.position.y += walking ? Math.abs(Math.sin(mob.bob)) * 0.06 : 0;
    mob.mesh.rotation.z = walking ? Math.sin(mob.bob) * 0.05 : 0;
    // A floater sways instead, on a slow cycle that never quite repeats.
    if (mob.def.floats) mob.mesh.position.y += Math.sin(mob.bob * 0.35) * 0.12;
    if (mob.def.boss) {
      // Pitch into the dive and bank through the turn. The geometry is merged
      // and cannot flap, so the whole impression of flight is in these two.
      mob.mesh.rotation.x = mob.pitch;
      mob.mesh.rotation.z = Math.sin(mob.bob * 0.5) * 0.14 - mob.velocity.y * 0.03;
    }
    // A creeper about to go off blinks, which is the only warning you get.
    const priming = mob.fuse > 0 && Math.sin(mob.fuse * 22) > 0;
    mob.mesh.material = (mob.hurtFlash > 0 || priming) ? this.hurtMaterial : this.material;
    mob.mesh.scale.setScalar(mob.fuse > 0 ? 1 + Math.min(mob.fuse, 1.5) * 0.12 : 1);
  }

  hurt(mob, amount) {
    mob.health -= amount;
    mob.hurtFlash = 0.3;
    if (!mob.def.floats) mob.velocity.y = Math.max(mob.velocity.y, 2.5);
    // Hitting one of a neutral kind angers every one of that kind nearby. It is
    // the behaviour that makes pigmen frightening rather than scenery.
    if (mob.def.neutral && !mob.provoked) {
      for (const other of this.list) {
        if (other.def !== mob.def || other.dead) continue;
        if (other.position.distanceTo(mob.position) < 16) other.provoked = true;
      }
    }
    // An enderman mostly answers a hit by not being there any more.
    if (mob.def.blinks && mob.health > 0 && Math.random() < 0.6) this.blink(mob);

    if (mob.health <= 0 && !mob.dead) {
      mob.dead = true;
      this.rollDrops(mob);
      if (mob.def.boss && this.onBossDeath) this.onBossDeath(mob);
    }
  }

  rollDrops(mob) {
    if (!this.onDrop) return;
    for (const [id, chance, max] of mob.def.drops ?? []) {
      if (Math.random() > chance) continue;
      this.onDrop(id, 1 + Math.floor(Math.random() * max), mob.center);
    }
  }

  explode(mob) {
    mob.dead = true;
    this.blast(mob.center, 3.2, 'a creeper');
  }

  /** Blows a spherical hole in the world and hurts everything nearby. */
  blast(center, radius, cause = 'an explosion') {
    const cx = Math.floor(center.x), cy = Math.floor(center.y), cz = Math.floor(center.z);
    const r = Math.ceil(radius);
    for (let y = cy - r; y <= cy + r; y++) {
      for (let z = cz - r; z <= cz + r; z++) {
        for (let x = cx - r; x <= cx + r; x++) {
          const d = Math.hypot(x - cx, y - cy, z - cz);
          // Ragged edge rather than a perfect sphere.
          if (d > radius - 0.5 + Math.random() * 0.9) continue;
          const id = this.world.get(x, y, z);
          // Obsidian is on the blast-proof list, which is what stops a ghast
          // from erasing the portal you arrived through while you are down there.
          if (id === AIR || isBlastProof(id)) continue;
          this.world.set(x, y, z, AIR);
        }
      }
    }
    if (this.onExplode) this.onExplode(center.clone(), radius, cause);
    sfx.explode();
  }

  /** The living boss, if there is one. The HUD asks once a frame. */
  get boss() {
    return this.list.find((m) => m.def.boss && !m.dead) || null;
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
    if (this.world.nether) return this.tryNetherSpawn(player);
    if (this.world.end) return this.tryEndSpawn(player);
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

  /**
   * The End has nothing living in it but endermen, and they are everywhere. No
   * night to wait for either: the sky is already black.
   */
  tryEndSpawn(player) {
    if (this.list.filter((m) => !m.dead && !m.def.boss).length >= 7) return;

    for (let attempt = 0; attempt < 12; attempt++) {
      const angle = Math.random() * Math.PI * 2;
      const r = 12 + Math.random() * 18;
      const x = Math.floor(player.position.x + Math.cos(angle) * r);
      const z = Math.floor(player.position.z + Math.sin(angle) * r);
      const y = this.world.standY(x, z, 4);
      if (y < 2) continue;                       // the void, which holds nothing
      const mob = this.spawn('enderman', x + 0.5, y, z + 0.5);
      if (mob && this.collides(mob)) mob.dead = true;
      return;
    }
  }

  /**
   * The Nether has no night to wait for and no sky to be exposed to, so it
   * populates whenever there is room. standY does the work of finding ground,
   * since the top of a column down there is the underside of the roof.
   */
  tryNetherSpawn(player) {
    if (this.list.filter((m) => !m.dead).length >= 9) return;

    for (let attempt = 0; attempt < 12; attempt++) {
      const angle = Math.random() * Math.PI * 2;
      const r = 15 + Math.random() * 16;
      const x = Math.floor(player.position.x + Math.cos(angle) * r);
      const z = Math.floor(player.position.z + Math.sin(angle) * r);
      const y = this.world.standY(x, z);
      if (y < 2 || y > SY - 6) continue;

      // Ghasts are the rarer of the two, and start well above the floor.
      const ghast = Math.random() < 0.28;
      const mob = this.spawn(ghast ? 'ghast' : 'pigman', x + 0.5, ghast ? y + 5 : y, z + 0.5);
      if (mob && this.collides(mob)) mob.dead = true;
      return;
    }
  }
}

/**
 * Arrows, ghast fireballs and thrown ender pearls. A small pool of boxes with
 * ballistic motion; they stick in nothing, they just hit and vanish. A fireball
 * differs in three ways and no more — it flies flat, it is slower, and arriving
 * makes a crater — and a pearl in one: wherever it lands, you do.
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
    this.onPearlLand = null;       // (position) => void
    this.pearlGeometry = mergeBoxes([
      { size: [0.22, 0.22, 0.22], pos: [0, 0, 0], color: 0x3fcf9a },
      { size: [0.26, 0.12, 0.12], pos: [0, 0, 0], color: 0x7ef0c4 },
    ]);
    this.fireballGeometry = mergeBoxes([
      { size: [0.44, 0.44, 0.44], pos: [0, 0, 0], color: 0xffb648 },
      { size: [0.52, 0.22, 0.22], pos: [0, 0, 0], color: 0xff7a24 },
      { size: [0.22, 0.52, 0.22], pos: [0, 0, 0], color: 0xff7a24 },
    ]);
    this.material = new THREE.MeshLambertMaterial({ vertexColors: true });
  }

  /** Lobs a projectile from `from` towards `to`, with a little lift for the drop. */
  fire(from, to, speed, fromPlayer = false, kind = 'arrow') {
    const fireball = kind === 'fireball';
    const pearl = kind === 'pearl';
    const dir = new THREE.Vector3().subVectors(to, from);
    const dist = dir.length();
    dir.normalize();
    // A fireball is aimed, not lobbed: it carries no gravity, so leading the
    // shot upwards would simply make it miss over the player's head.
    if (!fireball) {
      dir.y += Math.min(0.35, dist * 0.018);          // crude ballistic lead
      dir.normalize();
    }

    const geometry = fireball ? this.fireballGeometry
      : (pearl ? this.pearlGeometry : this.geometry);
    const mesh = new THREE.Mesh(geometry, this.material);
    this.group.add(mesh);
    this.list.push({
      position: from.clone(),
      velocity: dir.multiplyScalar(speed),
      life: fireball ? 6 : 4,
      fromPlayer,
      fireball,
      pearl,
      mesh,
    });
    sfx.shoot();
  }

  update(dt, player, survival, mobs) {
    const step = Math.min(dt, 0.05);
    for (const a of this.list) {
      a.life -= step;
      if (!a.fireball) a.velocity.y -= 14 * step;
      // A pearl that falls out of the world takes nobody with it.
      if (a.pearl && a.position.y < -2) { a.life = 0; continue; }
      a.position.addScaledVector(a.velocity, step);

      a.mesh.position.copy(a.position);
      a.mesh.lookAt(a.position.clone().add(a.velocity));
      if (a.fireball) a.mesh.rotation.z += step * 6;

      if (isSolid(this.world.get(
        Math.floor(a.position.x), Math.floor(a.position.y), Math.floor(a.position.z)))) {
        a.life = 0;
        if (a.fireball) mobs.blast(a.position.clone(), 2.0, 'a fireball');
        // Landing is the point of a pearl, so it reports where, having first
        // backed up along its own path to the last cell that was not solid.
        if (a.pearl && this.onPearlLand) {
          this.onPearlLand(a.position.clone().addScaledVector(a.velocity, -step * 1.2));
        }
        continue;
      }

      if (a.pearl) continue;              // a pearl hits the ground, not a mob

      if (a.fromPlayer) {
        const hit = mobs.list.find((m) => !m.dead && m.containsPoint(a.position));
        if (hit) { mobs.hurt(hit, 5); a.life = 0; }
      } else if (survival.enabled && !survival.dead) {
        const feet = player.position;
        // A fireball is wide enough to catch you without a direct hit, which is
        // what makes dodging one a matter of getting behind something.
        const reach = a.fireball ? 1.1 : 0.5;
        const near = Math.abs(a.position.x - feet.x) < reach
          && Math.abs(a.position.z - feet.z) < reach
          && a.position.y > feet.y - 0.2 && a.position.y < feet.y + 1.9;
        if (near) {
          a.life = 0;
          if (a.fireball) mobs.blast(a.position.clone(), 2.0, 'a fireball');
          else survival.damage(2, 'an arrow');
        }
      }
    }

    this.list = this.list.filter((a) => {
      if (a.life > 0) return true;
      this.group.remove(a.mesh);
      return false;
    });
  }
}

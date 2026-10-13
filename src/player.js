// Player state, voxel collision and locomotion.
//
// `position` is the authoritative feet position at the centre of the player's
// AABB base. In VR the headset may move independently of the rig, so each frame
// the headset's horizontal drift is folded in as intended movement, collided,
// and then the rig is repositioned to honour the result. Walking into a real wall
// therefore pushes the rig back instead of letting the head clip through.

import * as THREE from '../vendor/three/three.module.js?v=14';
import { isSolid, isLiquid, CLIMB_LUT } from './blocks.js?v=14';

const WIDTH = 0.6, HEIGHT = 1.8;
const GRAVITY = 26;
const JUMP_SPEED = 8.4;
const WALK_SPEED = 4.3;
const SPRINT_SPEED = 6.2;
const SWIM_SPEED = 3.0;
const CLIMB_SPEED = 2.6;
const FLY_SPEED = 9.0;
const TERMINAL = 50;
const STEP_UP = 0.55;            // auto-climb a single block edge while moving

export class Player {
  constructor(world, rig, camera) {
    this.world = world;
    this.rig = rig;
    this.camera = camera;
    this.position = new THREE.Vector3(0, 40, 0);
    this.velocity = new THREE.Vector3();
    this.yaw = 0;                // rig yaw, turned by snap-turn or mouse
    this.onGround = false;
    this.inWater = false;
    this.onLadder = false;
    this.flying = false;
    this.lastHeadLocal = new THREE.Vector2(0, 0);
    this.headTracked = false;
    this.fallStartY = null;
    this.onFallDamage = null;    // set by survival
    this._tmp = new THREE.Vector3();
  }

  get eyePosition() {
    const p = new THREE.Vector3();
    this.camera.getWorldPosition(p);
    return p;
  }

  /** Forward vector of the gaze, flattened for locomotion. */
  headingBasis() {
    const q = new THREE.Quaternion();
    this.camera.getWorldQuaternion(q);
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
    fwd.y = 0;
    if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1);
    fwd.normalize();
    // right = forward x up. Negating this swaps strafe, so the sign matters.
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
    return { fwd, right };
  }

  spawn(x, z) {
    const y = this.world.surfaceY(x, z);
    this.position.set(x + 0.5, y + 0.1, z + 0.5);
    this.velocity.set(0, 0, 0);
    this.headTracked = false;
    this.syncRig();
  }

  /**
   * move: {x, z} in -1..1 (stick/WASD), jump/sprint/sneak booleans,
   * turn: snap-turn delta in radians applied this frame.
   */
  update(dt, input) {
    dt = Math.min(dt, 0.05);                      // clamp hitches so nothing tunnels
    if (input.turn) this.applyTurn(input.turn);
    // Switching flight off inside terrain, or having blocks placed around you,
    // would otherwise wedge the player with no way out.
    if (!this.flying && this.intersects()) this.unstick();

    const head = this.headLocalDrift();
    const { fwd, right } = this.headingBasis();

    this.inWater = this.sampleWater();
    this.onLadder = !this.flying && this.sampleLadder();
    const speed = this.flying ? FLY_SPEED
      : this.inWater ? SWIM_SPEED
      : (input.sprint ? SPRINT_SPEED : WALK_SPEED);

    const wish = this._tmp.set(0, 0, 0)
      .addScaledVector(fwd, input.move.z)
      .addScaledVector(right, input.move.x);
    if (wish.lengthSq() > 1) wish.normalize();

    const delta = new THREE.Vector3(
      wish.x * speed * dt + head.x,
      0,
      wish.z * speed * dt + head.y,
    );

    if (this.flying) {
      this.velocity.y = input.jump ? FLY_SPEED : (input.sneak ? -FLY_SPEED : 0);
    } else if (this.inWater) {
      this.velocity.y += (input.jump ? 14 : -5) * dt;
      this.velocity.y = THREE.MathUtils.clamp(this.velocity.y, -3.5, 3.5);
      this.fallStartY = null;
    } else if (this.onLadder) {
      // On a ladder you climb with jump, descend with sneak, and otherwise ease
      // downwards rather than falling.
      this.velocity.y = input.jump ? CLIMB_SPEED : (input.sneak ? -CLIMB_SPEED : -0.9);
      this.fallStartY = null;
    } else {
      this.velocity.y -= GRAVITY * dt;
      if (this.velocity.y < -TERMINAL) this.velocity.y = -TERMINAL;
      if (input.jump && this.onGround) {
        this.velocity.y = JUMP_SPEED;
        this.onGround = false;
      }
    }
    delta.y = this.velocity.y * dt;

    this.moveAndCollide(delta);
    this.trackFall();
    this.syncRig();
  }

  applyTurn(radians) {
    // `position` already tracks the head's horizontal location, so turning about
    // the head is just a yaw change — syncRig repositions the rig to match. Head
    // drift is measured in rig-local space and rotated by the current yaw, so a
    // turn needs no tracking reset; resetting every frame during a smooth turn
    // would discard room-scale movement for as long as the stick was held.
    this.yaw += radians;
  }

  /** Horizontal distance the headset moved on its own since the last frame. */
  headLocalDrift() {
    const c = this.camera.position;
    if (!this.headTracked) {
      this.lastHeadLocal.set(c.x, c.z);
      this.headTracked = true;
      return { x: 0, y: 0 };
    }
    const dx = c.x - this.lastHeadLocal.x;
    const dz = c.z - this.lastHeadLocal.y;
    this.lastHeadLocal.set(c.x, c.z);
    // Rotate the rig-local drift into world space.
    const v = this._tmp.set(dx, 0, dz).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw);
    return { x: v.x, y: v.z };
  }

  moveAndCollide(delta) {
    if (this.flying) { this.position.add(delta); return; }

    // Vertical first, so standing on ground is resolved before horizontal sliding.
    this.moveVertical(delta.y);

    const blockedX = this.tryAxis('x', delta.x);
    const blockedZ = this.tryAxis('z', delta.z);

    // Step up single-block ledges rather than stopping dead against them.
    if ((blockedX || blockedZ) && this.onGround) {
      const y0 = this.position.y;
      this.position.y += STEP_UP;
      if (this.intersects()) {
        this.position.y = y0;
      } else {
        const stillX = blockedX ? this.tryAxis('x', delta.x) : false;
        const stillZ = blockedZ ? this.tryAxis('z', delta.z) : false;
        if (stillX && stillZ) this.position.y = y0;   // nothing gained, undo the lift
      }
    }

    if (this.position.y < -8) this.spawn(this.position.x, this.position.z);
  }

  /** Lift the player clear of solid blocks, falling back to the surface. */
  unstick() {
    const startY = this.position.y;
    for (let i = 1; i <= 8; i++) {
      this.position.y = Math.floor(startY) + i;
      if (!this.intersects()) {
        this.velocity.set(0, 0, 0);
        this.onGround = false;
        return;
      }
    }
    this.spawn(Math.floor(this.position.x), Math.floor(this.position.z));
  }

  /** Returns true if the move was blocked and reverted. */
  tryAxis(axis, amount) {
    if (!amount) return false;
    const before = this.position[axis];
    this.position[axis] += amount;
    if (!this.intersects()) return false;
    this.position[axis] = before;
    return true;
  }

  /**
   * Vertical movement is substepped so a fast fall cannot tunnel through a floor,
   * and a landing rests on top of the block actually entered rather than on the
   * position before the move.
   */
  moveVertical(dy) {
    if (!dy) return;
    const steps = Math.max(1, Math.ceil(Math.abs(dy) / 0.45));
    const slice = dy / steps;

    for (let i = 0; i < steps; i++) {
      const before = this.position.y;
      this.position.y += slice;
      if (!this.intersects()) {
        this.onGround = false;
        continue;
      }
      if (slice < 0) {
        this.position.y = Math.floor(this.position.y) + 1;
        if (this.intersects()) this.position.y = before;
        this.onGround = true;
      } else {
        this.position.y = before;                     // bumped a ceiling
      }
      this.velocity.y = 0;
      return;
    }
  }

  /** Does the player AABB overlap any solid voxel? */
  intersects() {
    const h = WIDTH / 2;
    const { x, y, z } = this.position;
    const x0 = Math.floor(x - h), x1 = Math.floor(x + h);
    const y0 = Math.floor(y + 0.001), y1 = Math.floor(y + HEIGHT - 0.001);
    const z0 = Math.floor(z - h), z1 = Math.floor(z + h);
    for (let yy = y0; yy <= y1; yy++) {
      for (let zz = z0; zz <= z1; zz++) {
        for (let xx = x0; xx <= x1; xx++) {
          if (isSolid(this.world.get(xx, yy, zz))) return true;
        }
      }
    }
    return false;
  }

  /** True when the player's body overlaps a climbable block. */
  sampleLadder() {
    const h = WIDTH / 2;
    const { x, y, z } = this.position;
    for (let yy = Math.floor(y); yy <= Math.floor(y + HEIGHT - 0.1); yy++) {
      for (let zz = Math.floor(z - h); zz <= Math.floor(z + h); zz++) {
        for (let xx = Math.floor(x - h); xx <= Math.floor(x + h); xx++) {
          if (CLIMB_LUT[this.world.get(xx, yy, zz)]) return true;
        }
      }
    }
    return false;
  }

  sampleWater() {
    const { x, y, z } = this.position;
    return isLiquid(this.world.get(Math.floor(x), Math.floor(y + 0.9), Math.floor(z)))
        || isLiquid(this.world.get(Math.floor(x), Math.floor(y + 0.1), Math.floor(z)));
  }

  trackFall() {
    if (this.flying || this.inWater || this.onLadder) { this.fallStartY = null; return; }
    if (!this.onGround) {
      if (this.velocity.y < -0.1 && this.fallStartY === null) this.fallStartY = this.position.y;
      return;
    }
    if (this.fallStartY !== null) {
      const drop = this.fallStartY - this.position.y;
      if (drop > 3.5 && this.onFallDamage) this.onFallDamage(Math.floor(drop - 3));
      this.fallStartY = null;
    }
  }

  /** Place the rig so the tracked head ends up over the collided body position. */
  syncRig() {
    this.rig.rotation.y = this.yaw;
    const c = this.camera.position;
    const local = this._tmp.set(c.x, 0, c.z)
      .applyAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw);
    this.rig.position.set(this.position.x - local.x, this.position.y, this.position.z - local.z);
  }
}

export { WIDTH as PLAYER_WIDTH, HEIGHT as PLAYER_HEIGHT };

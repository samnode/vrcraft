// Day/night cycle, health and hunger. The cycle drives one shader uniform plus the
// sky and fog colour, so terrain lighting costs nothing extra at runtime.

import * as THREE from '../vendor/three/three.module.js?v=31';
import { block } from './blocks.js?v=31';

const DAY_SECONDS = 600;                 // one full in-game day
const MAX_HEALTH = 20, MAX_HUNGER = 20;

const SKY_NIGHT = new THREE.Color(0x0a1026);
const SKY_DUSK  = new THREE.Color(0xe09055);
const SKY_DAY   = new THREE.Color(0x9fc4e8);

export class Survival {
  constructor({ onDeath = null, armorPoints = () => 0 } = {}) {
    this.time = 0.28;                    // start mid-morning
    this.health = MAX_HEALTH;
    this.hunger = MAX_HUNGER;
    this.exhaustion = 0;
    this.dead = false;
    this.enabled = false;                // off in creative
    this.onDeath = onDeath;
    this.armorPoints = armorPoints;
    this.hurtFlash = 0;
    this.messages = [];
    this.skyColor = SKY_DAY.clone();
  }

  get isNight() { return this.daylight < 0.3; }

  /** 0..1 multiplier applied to baked sky light. */
  get daylight() {
    const sun = Math.sin(this.time * Math.PI * 2);
    return THREE.MathUtils.clamp(sun * 1.25 + 0.22, 0.12, 1.0);
  }

  update(dt, player) {
    this.time = (this.time + dt / DAY_SECONDS) % 1;
    this.hurtFlash = Math.max(0, this.hurtFlash - dt * 2.2);

    const sun = Math.sin(this.time * Math.PI * 2);
    // Warm the sky near the horizon, go deep blue once the sun is down.
    if (sun > 0.25) this.skyColor.copy(SKY_DAY);
    else if (sun > -0.1) this.skyColor.copy(SKY_DUSK).lerp(SKY_DAY, (sun + 0.1) / 0.35);
    else this.skyColor.copy(SKY_NIGHT).lerp(SKY_DUSK, THREE.MathUtils.clamp((sun + 0.4) / 0.3, 0, 1));

    if (!this.enabled || this.dead) return;

    // Moving and jumping burn through the hunger bar.
    const moved = Math.hypot(player.velocity.x, player.velocity.z) + (player.onGround ? 0 : 0.4);
    this.exhaustion += (0.4 + moved * 0.9) * dt;
    if (this.exhaustion > 10) {
      this.exhaustion -= 10;
      this.hunger = Math.max(0, this.hunger - 1);
    }

    if (this.hunger === 0) this.damage(dt * 0.6, 'starvation', { armored: false });
    else if (this.hunger > 16 && this.health < MAX_HEALTH) this.health = Math.min(MAX_HEALTH, this.health + dt * 0.5);

    if (player.position.y < -4) this.damage(MAX_HEALTH, 'the void', { armored: false });
  }

  /**
   * Hurt the player. Armour turns aside 4% per point, Minecraft's own figure, so
   * a full iron set stops 60% of a hit. Starving and falling out of the world
   * ignore it: no helmet has ever helped with either.
   */
  damage(amount, cause = '', { armored = true } = {}) {
    if (!this.enabled || this.dead || amount <= 0) return;
    if (armored) {
      const soaked = Math.min(0.8, this.armorPoints() * 0.04);
      amount *= 1 - soaked;
    }
    this.health = Math.max(0, this.health - amount);
    this.hurtFlash = 1;
    if (this.health === 0) {
      this.dead = true;
      this.note(cause ? `You died from ${cause}.` : 'You died.');
      if (this.onDeath) this.onDeath();
    }
  }

  /** Eat a food item; returns true if it was consumed. */
  eat(id) {
    const def = block(id);
    if (!def || !def.food) return false;
    if (this.hunger >= MAX_HUNGER) return false;
    this.hunger = Math.min(MAX_HUNGER, this.hunger + def.food);
    return true;
  }

  /** Sleep through to dawn. Only meaningful at night, which the caller checks. */
  sleep() {
    this.time = 0.02;                 // just after sunrise
    this.health = Math.min(MAX_HEALTH, this.health + 6);
    this.exhaustion = 0;
  }

  revive() {
    this.health = MAX_HEALTH;
    this.hunger = MAX_HUNGER;
    this.exhaustion = 0;
    this.dead = false;
  }

  note(text) {
    this.messages.push({ text, t: 4 });
    if (this.messages.length > 4) this.messages.shift();
  }

  tickMessages(dt) {
    for (const m of this.messages) m.t -= dt;
    this.messages = this.messages.filter((m) => m.t > 0);
  }
}

export { MAX_HEALTH, MAX_HUNGER, DAY_SECONDS };

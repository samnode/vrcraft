// Pooled particle burst used for block breaking and hits. One Points draw call.

import * as THREE from '../vendor/three/three.module.js?v=17';

const MAX = 320;

export class Particles {
  constructor(scene) {
    this.positions = new Float32Array(MAX * 3);
    this.colors = new Float32Array(MAX * 3);
    this.velocities = new Float32Array(MAX * 3);
    this.life = new Float32Array(MAX);
    this.cursor = 0;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    geo.setDrawRange(0, MAX);
    this.geometry = geo;
    this.points = new THREE.Points(geo, new THREE.PointsMaterial({
      size: 0.09, vertexColors: true, sizeAttenuation: true, depthWrite: false,
    }));
    this.points.frustumCulled = false;
    scene.add(this.points);

    // Park every particle far below the world until it is spawned.
    for (let i = 0; i < MAX; i++) this.positions[i * 3 + 1] = -1000;
  }

  burst(position, color, count = 14, speed = 3.2) {
    const c = new THREE.Color(color);
    for (let i = 0; i < count; i++) {
      const j = this.cursor;
      this.cursor = (this.cursor + 1) % MAX;
      this.positions[j * 3] = position.x + (Math.random() - 0.5) * 0.5;
      this.positions[j * 3 + 1] = position.y + (Math.random() - 0.5) * 0.5;
      this.positions[j * 3 + 2] = position.z + (Math.random() - 0.5) * 0.5;
      this.velocities[j * 3] = (Math.random() - 0.5) * speed;
      this.velocities[j * 3 + 1] = Math.random() * speed;
      this.velocities[j * 3 + 2] = (Math.random() - 0.5) * speed;
      const shade = 0.75 + Math.random() * 0.45;
      this.colors[j * 3] = c.r * shade;
      this.colors[j * 3 + 1] = c.g * shade;
      this.colors[j * 3 + 2] = c.b * shade;
      this.life[j] = 0.6 + Math.random() * 0.3;
    }
  }

  update(dt) {
    let live = false;
    for (let i = 0; i < MAX; i++) {
      if (this.life[i] <= 0) continue;
      live = true;
      this.life[i] -= dt;
      this.velocities[i * 3 + 1] -= 11 * dt;
      this.positions[i * 3] += this.velocities[i * 3] * dt;
      this.positions[i * 3 + 1] += this.velocities[i * 3 + 1] * dt;
      this.positions[i * 3 + 2] += this.velocities[i * 3 + 2] * dt;
      if (this.life[i] <= 0) this.positions[i * 3 + 1] = -1000;
    }
    if (live) {
      this.geometry.attributes.position.needsUpdate = true;
      this.geometry.attributes.color.needsUpdate = true;
    }
  }
}

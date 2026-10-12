// Streams chunks in and out around the player and keeps mesh rebuilds inside a
// per-frame time budget, so generating terrain never stalls a VR frame.

import * as THREE from '../vendor/three/three.module.js?v=9';
import { World, SX, SZ, chunkKey } from './world.js?v=9';
import { buildChunkGeometry, createTerrainMaterials } from './mesher.js?v=9';

export class Terrain {
  constructor(scene, atlas, opts = {}) {
    this.world = new World(opts.seed ?? 20261012);
    this.scene = scene;
    this.radius = opts.radius ?? 4;          // chunks; 4 => 64 block view distance
    this.budgetMs = opts.budgetMs ?? 6;      // work allowed per frame
    this.group = new THREE.Group();
    scene.add(this.group);

    const fogFar = this.radius * SX - 6;
    this.materials = createTerrainMaterials(atlas, opts.fogColor ?? 0x9fc4e8, fogFar * 0.45, fogFar);
    this.center = { cx: Infinity, cz: Infinity };
    this.pending = [];                       // chunk coords awaiting generation
  }

  get uniforms() { return this.materials.uniforms; }

  /** Rebuild the pending queue when the player crosses into a new chunk. */
  update(playerPos) {
    const cx = Math.floor(playerPos.x / SX);
    const cz = Math.floor(playerPos.z / SZ);
    if (cx !== this.center.cx || cz !== this.center.cz) {
      this.center = { cx, cz };
      this.reschedule();
      this.evict();
    }
    this.processQueue();
  }

  reschedule() {
    const { cx, cz } = this.center;
    const r = this.radius;
    const want = [];
    for (let dz = -r - 1; dz <= r + 1; dz++) {
      for (let dx = -r - 1; dx <= r + 1; dx++) {
        // One ring past the view radius is generated but never meshed: a chunk
        // only meshes once its four neighbours exist, so borders come out seamless.
        if (dx * dx + dz * dz > (r + 1) * (r + 1) + r) continue;
        want.push({ cx: cx + dx, cz: cz + dz, d: dx * dx + dz * dz });
      }
    }
    want.sort((a, b) => a.d - b.d);                          // nearest chunks first
    this.pending = want;
  }

  evict() {
    const { cx, cz } = this.center;
    const limit = (this.radius + 2) ** 2;
    for (const [key, chunk] of this.world.chunks) {
      const dx = chunk.cx - cx, dz = chunk.cz - cz;
      if (dx * dx + dz * dz <= limit) continue;
      this.disposeMeshes(chunk);
      this.world.chunks.delete(key);
    }
  }

  disposeMeshes(chunk) {
    for (const key of ['mesh', 'waterMesh', 'transparentMesh']) {
      const m = chunk[key];
      if (!m) continue;
      this.group.remove(m);
      m.geometry.dispose();
      chunk[key] = null;
    }
  }

  processQueue() {
    const start = performance.now();

    // Phase 1: generate voxels for the nearest missing chunks. This is cheap
    // compared with meshing, so a lot of ground gets covered per frame.
    while (this.pending.length && performance.now() - start < this.budgetMs) {
      const { cx, cz } = this.pending.shift();
      // Light is computed up front: a chunk meshed next to one whose light is
      // still stale would show a dark seam along the shared border.
      this.ensureLight(this.world.getChunk(cx, cz, true));
    }

    // Phase 2: mesh whatever is dirty and fully surrounded. Chunks on the outer
    // generated ring are skipped until the player moves and fills in past them.
    for (const chunk of this.world.chunks.values()) {
      if (performance.now() - start >= this.budgetMs) break;
      if (!chunk.dirty && !chunk.lightDirty) continue;
      if (!this.neighboursReady(chunk)) continue;
      this.rebuild(chunk);
    }
  }

  neighboursReady(chunk) {
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      if (!this.world.chunks.has(chunkKey(chunk.cx + dx, chunk.cz + dz))) return false;
    }
    return true;
  }

  ensureLight(chunk) {
    if (chunk && chunk.lightDirty) this.world.computeLight(chunk);
  }

  rebuild(chunk) {
    this.ensureLight(chunk);
    // The mesher samples one voxel into each neighbour, so their light must be
    // current too, otherwise the shared border is shaded from a stale array.
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      this.ensureLight(this.world.chunks.get(chunkKey(chunk.cx + dx, chunk.cz + dz)));
    }
    const { opaque, water, transparent } = buildChunkGeometry(this.world, chunk);
    chunk.dirty = false;
    this.disposeMeshes(chunk);

    const place = (geometry, material, key) => {
      if (!geometry) return;
      const mesh = new THREE.Mesh(geometry, material);
      mesh.frustumCulled = true;
      chunk[key] = mesh;
      this.group.add(mesh);
    };
    // Geometry is already in world space, so the meshes stay at the origin.
    place(opaque, this.materials.opaque, 'mesh');
    place(water, this.materials.water, 'waterMesh');
    place(transparent, this.materials.transparent, 'transparentMesh');
  }

  /** Force the chunks around a point to exist and mesh immediately (used at spawn). */
  prime(x, z, radius = 1) {
    const cx = Math.floor(x / SX), cz = Math.floor(z / SZ);
    for (let dz = -radius - 1; dz <= radius + 1; dz++) {
      for (let dx = -radius - 1; dx <= radius + 1; dx++) this.world.getChunk(cx + dx, cz + dz, true);
    }
    for (const chunk of this.world.chunks.values()) {
      if (this.neighboursReady(chunk)) this.rebuild(chunk);
    }
  }
}

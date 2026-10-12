// Turns chunk voxels into geometry. Hidden faces are culled against neighbours
// (across chunk borders too) and each vertex carries baked sky light, block light
// and ambient occlusion so the day/night cycle is a single shader uniform.

import * as THREE from '../vendor/three/three.module.js';
import { SX, SY, SZ, idx } from './world.js';
import { AIR, STONE, block, OPAQUE_LUT } from './blocks.js';
import { tileUV } from './textures.js';

// Per-direction quad corners, wound counter-clockwise seen from outside the cube.
const FACES = [
  { dir: [1, 0, 0],  corners: [[1, 1, 1], [1, 0, 1], [1, 1, 0], [1, 0, 0]], shade: 0.80 },
  { dir: [-1, 0, 0], corners: [[0, 1, 0], [0, 0, 0], [0, 1, 1], [0, 0, 1]], shade: 0.80 },
  { dir: [0, 1, 0],  corners: [[0, 1, 1], [1, 1, 1], [0, 1, 0], [1, 1, 0]], shade: 1.00 },
  { dir: [0, -1, 0], corners: [[0, 0, 0], [1, 0, 0], [0, 0, 1], [1, 0, 1]], shade: 0.55 },
  { dir: [0, 0, 1],  corners: [[0, 1, 1], [0, 0, 1], [1, 1, 1], [1, 0, 1]], shade: 0.68 },
  { dir: [0, 0, -1], corners: [[1, 1, 0], [1, 0, 0], [0, 1, 0], [0, 0, 0]], shade: 0.68 },
];
const QUAD_INDICES = [0, 1, 2, 2, 1, 3];
// UV corner per quad vertex, matching the corner order above.
const QUAD_UV = [[0, 1], [0, 0], [1, 1], [1, 0]];

/** Classic voxel corner occlusion: 3 = fully open, 0 = wedged into a corner. */
function cornerAO(side1, side2, corner) {
  if (side1 && side2) return 0;
  return 3 - (side1 + side2 + corner);
}

/**
 * Vertex accumulator backed by reusable typed arrays. Pushing into plain arrays
 * and converting at the end was a large share of rebuild time; these buffers are
 * allocated once, grown only when a chunk needs more, and copied out on finish.
 */
class Buf {
  constructor(capacity = 1 << 16) {
    this.allocate(capacity);
    this.verts = 0;
    this.indices = 0;
  }

  allocate(capacity) {
    this.capacity = capacity;
    this.pos = new Float32Array(capacity * 3);
    this.uv = new Float32Array(capacity * 2);
    this.light = new Float32Array(capacity * 3);
    this.index = new Uint32Array(capacity * 2);   // six indices per four vertices
  }

  reset() { this.verts = 0; this.indices = 0; }

  /** Grow before a quad if the next four vertices would not fit. */
  ensure() {
    if (this.verts + 4 <= this.capacity) return;
    const old = { pos: this.pos, uv: this.uv, light: this.light, index: this.index, verts: this.verts, indices: this.indices };
    this.allocate(this.capacity * 2);
    this.pos.set(old.pos.subarray(0, old.verts * 3));
    this.uv.set(old.uv.subarray(0, old.verts * 2));
    this.light.set(old.light.subarray(0, old.verts * 3));
    this.index.set(old.index.subarray(0, old.indices));
  }

  vertex(x, y, z, u, v, sky, blk, shade) {
    const i = this.verts;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.uv[i * 2] = u; this.uv[i * 2 + 1] = v;
    this.light[i * 3] = sky; this.light[i * 3 + 1] = blk; this.light[i * 3 + 2] = shade;
    this.verts++;
  }

  quad(base) {
    for (let k = 0; k < 6; k++) this.index[this.indices++] = base + QUAD_INDICES[k];
  }

  toGeometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos.slice(0, this.verts * 3), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(this.uv.slice(0, this.verts * 2), 2));
    g.setAttribute('light', new THREE.BufferAttribute(this.light.slice(0, this.verts * 3), 3));
    g.setIndex(new THREE.BufferAttribute(this.index.slice(0, this.indices), 1));
    g.computeBoundingSphere();
    return g;
  }
}

// Reused across every chunk rebuild; meshing is single-threaded and synchronous.
const opaqueBuf = new Buf();
const transparentBuf = new Buf();

// A chunk plus a one-voxel shell of its neighbours, copied into flat arrays once
// per rebuild. Face culling, ambient occlusion and light sampling all read from
// here, which removes the hashed world lookups that dominated meshing time.
const PX = SX + 2, PY = SY + 2, PZ = SZ + 2;
const pidx = (x, y, z) => ((y + 1) * PZ + (z + 1)) * PX + (x + 1);

const cache = {
  vox: new Uint8Array(PX * PY * PZ),
  sky: new Uint8Array(PX * PY * PZ),
  blk: new Uint8Array(PX * PY * PZ),
};

function fillCache(world, chunk) {
  const { vox, sky, blk } = cache;
  const ox = chunk.cx * SX, oz = chunk.cz * SZ;

  // Interior: straight array copies, no world lookups at all.
  for (let y = 0; y < SY; y++) {
    for (let z = 0; z < SZ; z++) {
      for (let x = 0; x < SX; x++) {
        const src = idx(x, y, z), dst = pidx(x, y, z);
        vox[dst] = chunk.voxels[src];
        sky[dst] = chunk.skyLight[src];
        blk[dst] = chunk.blockLight[src];
      }
    }
  }

  // Shell: only the faces, edges and corners touching neighbouring chunks.
  const shell = (x, y, z) => {
    const dst = pidx(x, y, z);
    if (y < 0) { vox[dst] = STONE; sky[dst] = 0; blk[dst] = 0; return; }
    if (y >= SY) { vox[dst] = AIR; sky[dst] = 15; blk[dst] = 0; return; }
    vox[dst] = world.get(ox + x, y, oz + z);
    const [s, b] = world.lightAt(ox + x, y, oz + z);
    sky[dst] = s; blk[dst] = b;
  };

  for (let y = -1; y <= SY; y++) {
    for (let x = -1; x <= SX; x++) { shell(x, y, -1); shell(x, y, SZ); }
    for (let z = 0; z < SZ; z++) { shell(-1, y, z); shell(SX, y, z); }
  }
  for (let z = 0; z < SZ; z++) {
    for (let x = 0; x < SX; x++) { shell(x, -1, z); shell(x, SY, z); }
  }
}

export function buildChunkGeometry(world, chunk) {
  fillCache(world, chunk);

  const opaque = opaqueBuf, transparent = transparentBuf;
  opaque.reset();
  transparent.reset();
  const ox = chunk.cx * SX, oz = chunk.cz * SZ;

  for (let lz = 0; lz < SZ; lz++) {
    for (let lx = 0; lx < SX; lx++) {
      const top = chunk.heights[lz * SX + lx];
      for (let y = 0; y < top; y++) {
        const id = chunk.voxels[idx(lx, y, lz)];
        if (id === AIR) continue;
        const def = block(id);
        const buf = def.blend ? transparent : opaque;

        for (let f = 0; f < 6; f++) {
          const face = FACES[f];
          const [dx, dy, dz] = face.dir;
          const nid = cache.vox[pidx(lx + dx, y + dy, lz + dz)];
          // Cull against opaque neighbours, and against same-id neighbours so
          // water and glass do not draw internal walls against themselves.
          if (OPAQUE_LUT[nid] || nid === id) continue;

          emitFace(buf, face, lx, y, lz, ox, oz, def.faces[f]);
        }
      }
    }
  }

  return {
    opaque: opaque.verts ? opaque.toGeometry() : null,
    transparent: transparent.verts ? transparent.toGeometry() : null,
  };
}

function emitFace(buf, face, lx, y, lz, ox, oz, tileIndex) {
  const [dx, dy, dz] = face.dir;
  const axis = dx !== 0 ? 0 : (dy !== 0 ? 1 : 2);
  // The two axes spanning this face, used for both AO lookups and winding.
  const uAxis = axis === 0 ? 1 : 0;
  const vAxis = axis === 2 ? 1 : 2;

  const [u0, v0, u1, v1] = tileUV(tileIndex);
  buf.ensure();
  const base = buf.verts;
  const { vox, sky, blk } = cache;

  // The cell just outside this face; AO and light are sampled around it.
  const px = lx + dx, py = y + dy, pz = lz + dz;

  for (let i = 0; i < 4; i++) {
    const c = face.corners[i];
    const uv = QUAD_UV[i];

    const su = c[uAxis] * 2 - 1;
    const sv = c[vAxis] * 2 - 1;
    const o1 = [px, py, pz]; o1[uAxis] += su;
    const o2 = [px, py, pz]; o2[vAxis] += sv;
    const o3 = [px, py, pz]; o3[uAxis] += su; o3[vAxis] += sv;

    const i1 = pidx(o1[0], o1[1], o1[2]);
    const i2 = pidx(o2[0], o2[1], o2[2]);
    const i3 = pidx(o3[0], o3[1], o3[2]);
    const s1 = OPAQUE_LUT[vox[i1]], s2 = OPAQUE_LUT[vox[i2]], cn = OPAQUE_LUT[vox[i3]];
    const ao = 0.55 + (cornerAO(s1, s2, cn) / 3) * 0.45;

    // Average light over the four cells touching this corner for smooth gradients.
    let skySum = 0, blkSum = 0, n = 0;
    const i0 = pidx(px, py, pz);
    for (const j of [i0, i1, i2, i3]) {
      if (OPAQUE_LUT[vox[j]]) continue;
      skySum += sky[j]; blkSum += blk[j]; n++;
    }
    if (n === 0) { skySum = sky[i0]; blkSum = blk[i0]; n = 1; }

    buf.vertex(
      ox + lx + c[0], y + c[1], oz + lz + c[2],
      uv[0] ? u1 : u0, uv[1] ? v1 : v0,
      (skySum / n) / 15, (blkSum / n) / 15, ao * face.shade,
    );
  }

  buf.quad(base);
}

const VERT = `
  attribute vec3 light;
  varying vec2 vUv;
  varying vec3 vLight;
  varying float vDepth;
  void main() {
    vUv = uv;
    vLight = light;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vDepth = -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;

const FRAG = `
  precision mediump float;
  uniform sampler2D uAtlas;
  uniform float uDayLight;
  uniform vec3 uFogColor;
  uniform float uFogNear;
  uniform float uFogFar;
  uniform float uAlphaTest;
  varying vec2 vUv;
  varying vec3 vLight;
  varying float vDepth;
  void main() {
    vec4 tex = texture2D(uAtlas, vUv);
    if (tex.a < uAlphaTest) discard;
    // Sky light dims with the time of day; block light does not. A small floor
    // keeps unlit caves readable instead of pitch black.
    float lum = max(max(vLight.x * uDayLight, vLight.y), 0.05);
    vec3 color = tex.rgb * lum * vLight.z;
    float fog = clamp((vDepth - uFogNear) / (uFogFar - uFogNear), 0.0, 1.0);
    gl_FragColor = vec4(mix(color, uFogColor, fog), tex.a);
  }
`;

export function createTerrainMaterials(atlas, fogColor, fogNear, fogFar) {
  const uniforms = {
    uAtlas: { value: atlas },
    uDayLight: { value: 1 },
    uFogColor: { value: new THREE.Color(fogColor) },
    uFogNear: { value: fogNear },
    uFogFar: { value: fogFar },
    uAlphaTest: { value: 0.5 },
  };

  const opaque = new THREE.ShaderMaterial({
    uniforms, vertexShader: VERT, fragmentShader: FRAG,
  });

  // Transparent blocks share the uniform objects so one day/night write covers both.
  const transparent = new THREE.ShaderMaterial({
    uniforms: { ...uniforms, uAlphaTest: { value: 0.02 } },
    vertexShader: VERT, fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
  });

  return { opaque, transparent, uniforms };
}

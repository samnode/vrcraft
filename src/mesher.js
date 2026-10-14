// Turns chunk voxels into geometry. Hidden faces are culled against neighbours
// (across chunk borders too) and each vertex carries baked sky light, block light
// and ambient occlusion, so the day/night cycle is a single shader uniform.
//
// Three buffers come out of a chunk: opaque (alpha-tested, so leaves belong here),
// water (shimmers, drawn translucent) and other translucent blocks like glass.

import * as THREE from '../vendor/three/three.module.js?v=16';
import { SX, SY, SZ, idx } from './world.js?v=16';
import {
  AIR, STONE, block, OPAQUE_LUT, POST_LUT, SLAB_LUT, PANEL_LUT, CLIMB_LUT,
  LIQUID_LUT, VARY_LUT, BED_LUT, DOOR_OPEN, isDoor, bedPartnerId,
} from './blocks.js?v=16';
import { tileUV } from './textures.js?v=16';

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

// UV corner per quad vertex, and the same set rotated by 90/180/270 degrees.
// Picking one per block hides the fact that every stone cube shares a texture.
const QUAD_UV_ROT = [
  [[0, 1], [0, 0], [1, 1], [1, 0]],
  [[1, 1], [0, 1], [1, 0], [0, 0]],
  [[1, 0], [1, 1], [0, 0], [0, 1]],
  [[0, 0], [1, 0], [0, 1], [1, 1]],
];

/** Classic voxel corner occlusion: 3 = fully open, 0 = wedged into a corner. */
function cornerAO(side1, side2, corner) {
  if (side1 && side2) return 0;
  return 3 - (side1 + side2 + corner);
}

/** Stable per-position hash, used to choose a texture rotation. */
function hashPos(x, y, z) {
  let h = x * 374761393 + y * 668265263 + z * 2147483647;
  h = (h ^ (h >>> 13)) * 1274126177;
  return (h ^ (h >>> 16)) & 3;
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

  ensure() {
    if (this.verts + 4 <= this.capacity) return;
    const old = { pos: this.pos, uv: this.uv, light: this.light, index: this.index,
                  verts: this.verts, indices: this.indices };
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

const opaqueBuf = new Buf();
const waterBuf = new Buf();
const glassBuf = new Buf();

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
  opaqueBuf.reset(); waterBuf.reset(); glassBuf.reset();
  const ox = chunk.cx * SX, oz = chunk.cz * SZ;

  for (let lz = 0; lz < SZ; lz++) {
    for (let lx = 0; lx < SX; lx++) {
      const top = chunk.heights[lz * SX + lx];
      for (let y = 0; y < top; y++) {
        const id = chunk.voxels[idx(lx, y, lz)];
        if (id === AIR) continue;
        const def = block(id);

        if (BED_LUT[id]) {
          emitBed(opaqueBuf, id, def, lx, y, lz, ox, oz);
          continue;
        }
        if (POST_LUT[id] || SLAB_LUT[id] || PANEL_LUT[id]) {
          emitShape(opaqueBuf, id, def, lx, y, lz, ox, oz);
          continue;
        }

        const buf = LIQUID_LUT[id] ? waterBuf : (def.blend ? glassBuf : opaqueBuf);
        const rot = VARY_LUT[id] ? hashPos(ox + lx, y, oz + lz) : 0;

        for (let f = 0; f < 6; f++) {
          const face = FACES[f];
          const [dx, dy, dz] = face.dir;
          const nid = cache.vox[pidx(lx + dx, y + dy, lz + dz)];
          // Cull against opaque neighbours, and against same-id neighbours so
          // water and glass do not draw internal walls against themselves.
          if (OPAQUE_LUT[nid] || nid === id) continue;

          // Only rotate isotropic faces: a rotated grass side would put the
          // green lip down one edge of the block.
          const vary = rot && (f === 2 || f === 3 || def.faces[f] === def.faces[2]);
          emitFace(buf, face, lx, y, lz, ox, oz, def.faces[f], vary ? rot : 0);
        }
      }
    }
  }

  return {
    opaque: opaqueBuf.verts ? opaqueBuf.toGeometry() : null,
    water: waterBuf.verts ? waterBuf.toGeometry() : null,
    transparent: glassBuf.verts ? glassBuf.toGeometry() : null,
  };
}

function emitFace(buf, face, lx, y, lz, ox, oz, tileIndex, rot) {
  const [dx, dy, dz] = face.dir;
  const axis = dx !== 0 ? 0 : (dy !== 0 ? 1 : 2);
  const uAxis = axis === 0 ? 1 : 0;
  const vAxis = axis === 2 ? 1 : 2;

  const [u0, v0, u1, v1] = tileUV(tileIndex);
  buf.ensure();
  const base = buf.verts;
  const { vox, sky, blk } = cache;
  const uvSet = QUAD_UV_ROT[rot];

  const px = lx + dx, py = y + dy, pz = lz + dz;

  for (let i = 0; i < 4; i++) {
    const c = face.corners[i];
    const uv = uvSet[i];

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

const THIN = 0.14;

/**
 * Where a panel sits inside its cell. Ladders hug whichever wall they were put
 * against; doors fill the gap in a wall, spanning the axis the wall runs along.
 * Deriving this from the neighbours avoids needing per-block metadata, which the
 * flat Uint8 voxel array has no room for.
 */
function panelBounds(id, lx, y, lz, isTop) {
  // The upper half of a door reads its neighbours from the lower half's row, so
  // the two halves can never disagree about which way the door faces.
  const row = isTop ? y - 1 : y;
  const solid = (dx, dz) => OPAQUE_LUT[cache.vox[pidx(lx + dx, row, lz + dz)]];

  if (CLIMB_LUT[id]) {
    if (solid(0, -1)) return [0, 0, 0, 1, 1, THIN];
    if (solid(0, 1)) return [0, 0, 1 - THIN, 1, 1, 1];
    if (solid(-1, 0)) return [0, 0, 0, THIN, 1, 1];
    if (solid(1, 0)) return [1 - THIN, 0, 0, 1, 1, 1];
    return [0, 0, 0, 1, 1, THIN];
  }

  const xWall = solid(-1, 0) || solid(1, 0);
  const zWall = solid(0, -1) || solid(0, 1);
  // Spanning X means thin in Z, and vice versa. Opening the door swaps them.
  let spanX = xWall || !zWall;
  if (id === DOOR_OPEN) spanX = !spanX;
  return spanX
    ? [0, 0, 0.5 - THIN / 2, 1, 1, 0.5 + THIN / 2]
    : [0.5 - THIN / 2, 0, 0, 0.5 + THIN / 2, 1, 1];
}

function shapeBounds(id, lx, y, lz, isTop) {
  if (POST_LUT[id]) return [0.42, 0, 0.42, 0.58, 0.62, 0.58];
  if (SLAB_LUT[id]) return [0, 0, 0, 1, 0.5, 1];
  return panelBounds(id, lx, y, lz, isTop);
}

/**
 * One axis-aligned box inside a cell, textured face by face. `skip` names a face
 * index to leave out, for a surface that is buried against another box.
 */
function emitBox(buf, bounds, faces, rots, skyL, blkL, lx, y, lz, ox, oz, skip) {
  const [bx0, by0, bz0, bx1, by1, bz1] = bounds;
  for (let f = 0; f < 6; f++) {
    if (f === skip) continue;
    const face = FACES[f];
    const [u0, v0, u1, v1] = tileUV(faces[f]);
    const uvSet = QUAD_UV_ROT[rots ? rots[f] : 0];
    buf.ensure();
    const base = buf.verts;
    for (let i = 0; i < 4; i++) {
      const c = face.corners[i];
      const uv = uvSet[i];
      buf.vertex(
        ox + lx + (c[0] ? bx1 : bx0),
        y + (c[1] ? by1 : by0),
        oz + lz + (c[2] ? bz1 : bz0),
        uv[0] ? u1 : u0, uv[1] ? v1 : v0,
        skyL, blkL, face.shade,
      );
    }
    buf.quad(base);
  }
}

/**
 * Emits a sub-cube: torches, slabs, doors and ladders. Every face is drawn, since
 * a shape smaller than its cell can never be fully hidden by its neighbours.
 */
function emitShape(buf, id, def, lx, y, lz, ox, oz) {
  // A tall block's upper half is the same id sitting on its own kind.
  const isTop = def.tall && isDoor(id) && isDoor(cache.vox[pidx(lx, y - 1, lz)]);
  const faces = isTop && def.topTile !== null
    ? [def.topTile, def.topTile, def.topTile, def.topTile, def.topTile, def.topTile]
    : def.faces;
  const i0 = pidx(lx, y, lz);
  emitBox(
    buf, shapeBounds(id, lx, y, lz, isTop), faces, null,
    cache.sky[i0] / 15, Math.max(cache.blk[i0] / 15, def.light / 15),
    lx, y, lz, ox, oz, -1,
  );
}

// Minecraft's proportions: the mattress sits on legs three pixels tall and its
// top lands at nine pixels, which is why a bed is not simply a slab.
const BED_LEG = 3 / 16;
const BED_TOP = 9 / 16;

// Directions searched for the other half, and the face index each one points at.
const BED_DIRS = [
  [1, 0, 0], [-1, 0, 1], [0, 1, 4], [0, -1, 5],
];

/**
 * Which way this bed runs, as the step towards its other half plus the face
 * index that step points at. Reading it off the partner means neither half can
 * disagree with the other about the bed's axis, and costs no per-block metadata
 * — the same trick the doors use against their walls.
 */
function bedJoint(id, lx, y, lz) {
  const partner = bedPartnerId(id);
  for (let i = 0; i < 4; i++) {
    const [dx, dz, f] = BED_DIRS[i];
    if (cache.vox[pidx(lx + dx, y, lz + dz)] === partner) return BED_DIRS[i];
  }
  return null;
}

// Top-face UV rotation per direction of the bed's head, keyed by the face index
// of the step from foot to head, so the pillow always lies at the head end.
// Derived from FACES[2]'s winding: the top quad's corners run (0,1) (1,1) (0,0)
// (1,0) in xz, and v=1 is the painted top of the tile, which is the pillow.
const BED_TOP_ROT = { 0: 2, 1: 0, 4: 1, 5: 3 };

/**
 * A bed half: a mattress box on two legs, with the face against the other half
 * left out so the two do not z-fight along their shared seam.
 */
function emitBed(buf, id, def, lx, y, lz, ox, oz) {
  const parts = def.parts;
  const isHead = id === 61;
  // An orphaned half — carved out by an explosion, say — still has to draw as
  // something, so it falls back to lying along Z.
  const joint = bedJoint(id, lx, y, lz) || [0, -1, 5];
  const [jx, jz, jf] = joint;

  // The step from foot to head: towards the partner from the foot, away from it
  // from the head.
  const headFace = isHead ? (jf ^ 1) : jf;
  const side = isHead ? parts.sideHead : parts.sideFoot;
  const top = isHead ? parts.topHead : parts.topFoot;
  const faces = [side, side, top, parts.bottom, side, side];
  const rots = [0, 0, BED_TOP_ROT[headFace], 0, 0, 0];

  const i0 = pidx(lx, y, lz);
  const skyL = cache.sky[i0] / 15;
  const blkL = cache.blk[i0] / 15;

  emitBox(buf, [0, BED_LEG, 0, 1, BED_TOP, 1], faces, rots,
    skyL, blkL, lx, y, lz, ox, oz, jf);

  // Two legs, at the outer end's corners, across whichever axis the bed is not
  // running along.
  const legs = parts.bottom;
  const legFaces = [legs, legs, legs, legs, legs, legs];
  const o0 = 0, o1 = BED_LEG, i1 = 1 - BED_LEG;
  // The outer end is the cell edge away from the partner.
  const ez0 = jz > 0 ? o0 : i1, ex0 = jx > 0 ? o0 : i1;
  if (jx !== 0) {
    emitBox(buf, [ex0, 0, o0, ex0 + BED_LEG, BED_LEG, o1], legFaces, null, skyL, blkL, lx, y, lz, ox, oz, -1);
    emitBox(buf, [ex0, 0, i1, ex0 + BED_LEG, BED_LEG, 1], legFaces, null, skyL, blkL, lx, y, lz, ox, oz, -1);
  } else {
    emitBox(buf, [o0, 0, ez0, o1, BED_LEG, ez0 + BED_LEG], legFaces, null, skyL, blkL, lx, y, lz, ox, oz, -1);
    emitBox(buf, [i1, 0, ez0, 1, BED_LEG, ez0 + BED_LEG], legFaces, null, skyL, blkL, lx, y, lz, ox, oz, -1);
  }
}

const VERT = `
  attribute vec3 light;
  varying vec2 vUv;
  varying vec3 vLight;
  varying vec3 vWorld;
  varying float vDepth;
  void main() {
    vUv = uv;
    vLight = light;
    vWorld = position;
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
  uniform float uTime;
  uniform float uWater;
  varying vec2 vUv;
  varying vec3 vLight;
  varying vec3 vWorld;
  varying float vDepth;

  void main() {
    vec4 tex = texture2D(uAtlas, vUv);
    if (tex.a < uAlphaTest) discard;

    // Sunlight cools and dims towards night; torchlight stays warm regardless.
    // Keeping the two tinted separately is what makes a lit cave read as lit.
    vec3 skyTint = mix(vec3(0.42, 0.52, 0.80), vec3(1.0), uDayLight);
    vec3 warm = vec3(1.0, 0.76, 0.46);
    vec3 lum = skyTint * (vLight.x * uDayLight) + warm * vLight.y;
    lum = clamp(lum, vec3(0.05), vec3(1.25));

    vec3 color = tex.rgb * lum * vLight.z;

    // Water shimmers on a slow travelling wave rather than scrolling its UVs,
    // which would sample neighbouring tiles out of the atlas.
    if (uWater > 0.5) {
      float w = sin(vWorld.x * 0.7 + uTime * 1.3) * sin(vWorld.z * 0.6 + uTime * 0.9);
      color += vec3(0.05, 0.08, 0.11) * w;
    }

    float fog = clamp((vDepth - uFogNear) / (uFogFar - uFogNear), 0.0, 1.0);
    gl_FragColor = vec4(mix(color, uFogColor, fog), tex.a);
  }
`;

export function createTerrainMaterials(atlas, fogColor, fogNear, fogFar) {
  const shared = {
    uAtlas: { value: atlas },
    uDayLight: { value: 1 },
    uFogColor: { value: new THREE.Color(fogColor) },
    uFogNear: { value: fogNear },
    uFogFar: { value: fogFar },
    uTime: { value: 0 },
  };

  const make = (alphaTest, water, opts = {}) => new THREE.ShaderMaterial({
    // Spread shares the uniform objects, so one day/night write covers them all.
    uniforms: { ...shared, uAlphaTest: { value: alphaTest }, uWater: { value: water } },
    vertexShader: VERT,
    fragmentShader: FRAG,
    ...opts,
  });

  return {
    opaque: make(0.5, 0),
    water: make(0.02, 1, { transparent: true, depthWrite: false }),
    transparent: make(0.02, 0, { transparent: true, depthWrite: false }),
    uniforms: shared,
  };
}

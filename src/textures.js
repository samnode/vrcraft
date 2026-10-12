// Procedural block atlas. Everything is drawn into one canvas at load time, so the
// project ships with no binary assets and the texture budget on Quest stays tiny.

import * as THREE from '../vendor/three/three.module.js?v=7';
import { TILES } from './blocks.js?v=7';

export const TILE_PX = 32;
export const ATLAS_COLS = 7;
export const ATLAS_ROWS = 6;

// Deterministic per-pixel jitter so tiles look grainy rather than flat.
function px(x, y, salt) {
  let h = (x * 1836311903) ^ (y * 2971215073) ^ (salt * 1013904223);
  h = (h ^ (h >>> 15)) * 2246822519;
  h = (h ^ (h >>> 13)) * 3266489917;
  return ((h ^ (h >>> 16)) & 0xffff) / 0xffff;
}

function rgb(r, g, b) { return `rgb(${r | 0},${g | 0},${b | 0})`; }

/** Fill a tile with a base colour plus per-pixel brightness noise. */
function grainy(ctx, ox, oy, base, amount, salt) {
  for (let y = 0; y < TILE_PX; y++) {
    for (let x = 0; x < TILE_PX; x++) {
      const n = (px(x, y, salt) - 0.5) * amount;
      ctx.fillStyle = rgb(base[0] + base[0] * n, base[1] + base[1] * n, base[2] + base[2] * n);
      ctx.fillRect(ox + x, oy + y, 1, 1);
    }
  }
}

/** Scatter blobs of a second colour, used for cobble lumps and ore specks. */
function blobs(ctx, ox, oy, color, count, size, salt) {
  for (let i = 0; i < count; i++) {
    const bx = Math.floor(px(i, 1, salt) * (TILE_PX - size));
    const by = Math.floor(px(i, 2, salt) * (TILE_PX - size));
    const s = size + Math.floor(px(i, 3, salt) * size);
    ctx.fillStyle = color;
    ctx.fillRect(ox + bx, oy + by, s, s);
  }
}

const painters = {
  grass_top(ctx, ox, oy) {
    grainy(ctx, ox, oy, [96, 158, 72], 0.22, 1);
    blobs(ctx, ox, oy, 'rgba(120,180,86,0.55)', 26, 2, 11);
  },
  grass_side(ctx, ox, oy) {
    grainy(ctx, ox, oy, [134, 104, 70], 0.2, 2);
    // Grass lip across the top with a ragged lower edge.
    for (let x = 0; x < TILE_PX; x++) {
      const depth = 6 + Math.floor(px(x, 0, 3) * 5);
      for (let y = 0; y < depth; y++) {
        const n = (px(x, y, 4) - 0.5) * 0.25;
        ctx.fillStyle = rgb(96 + 96 * n, 158 + 158 * n, 72 + 72 * n);
        ctx.fillRect(ox + x, oy + y, 1, 1);
      }
    }
  },
  dirt(ctx, ox, oy) {
    grainy(ctx, ox, oy, [134, 104, 70], 0.24, 5);
    blobs(ctx, ox, oy, 'rgba(108,82,54,0.5)', 18, 2, 12);
  },
  stone(ctx, ox, oy) {
    grainy(ctx, ox, oy, [128, 128, 132], 0.16, 6);
    blobs(ctx, ox, oy, 'rgba(112,112,116,0.45)', 14, 3, 13);
  },
  sand(ctx, ox, oy) { grainy(ctx, ox, oy, [218, 206, 150], 0.14, 7); },
  log_top(ctx, ox, oy) {
    grainy(ctx, ox, oy, [150, 118, 76], 0.16, 8);
    const c = TILE_PX / 2;
    for (let r = 3; r < TILE_PX / 2; r += 4) {
      ctx.strokeStyle = 'rgba(104,78,48,0.6)';
      ctx.beginPath();
      ctx.arc(ox + c, oy + c, r, 0, Math.PI * 2);
      ctx.stroke();
    }
  },
  log_side(ctx, ox, oy) {
    grainy(ctx, ox, oy, [104, 78, 48], 0.2, 9);
    for (let x = 0; x < TILE_PX; x += 1) {
      if (px(x, 7, 10) > 0.72) {
        ctx.fillStyle = 'rgba(78,58,34,0.65)';
        ctx.fillRect(ox + x, oy, 1, TILE_PX);
      }
    }
  },
  leaves(ctx, ox, oy) {
    // Sampled at 2x2 blocks so gaps read as chunky foliage rather than fine static,
    // which shimmers badly at VR resolutions and distance.
    ctx.clearRect(ox, oy, TILE_PX, TILE_PX);
    const step = 2;
    for (let y = 0; y < TILE_PX; y += step) {
      for (let x = 0; x < TILE_PX; x += step) {
        const n = px(x / step, y / step, 14);
        if (n < 0.1) continue;                     // sparse holes let sky through
        const s = (px(x / step, y / step, 15) - 0.5) * 0.4;
        ctx.fillStyle = rgb(58 + 58 * s, 116 + 116 * s, 48 + 48 * s);
        ctx.fillRect(ox + x, oy + y, step, step);
      }
    }
  },
  planks(ctx, ox, oy) {
    grainy(ctx, ox, oy, [168, 132, 84], 0.14, 15);
    ctx.fillStyle = 'rgba(120,92,56,0.7)';
    for (let y = 0; y < TILE_PX; y += 8) ctx.fillRect(ox, oy + y, TILE_PX, 1);
  },
  cobble(ctx, ox, oy) {
    grainy(ctx, ox, oy, [108, 108, 112], 0.1, 16);
    blobs(ctx, ox, oy, 'rgba(146,146,150,0.85)', 10, 5, 17);
    blobs(ctx, ox, oy, 'rgba(78,78,82,0.7)', 12, 3, 18);
  },
  water(ctx, ox, oy) {
    for (let y = 0; y < TILE_PX; y++) {
      for (let x = 0; x < TILE_PX; x++) {
        const n = px(x, y, 19);
        ctx.fillStyle = `rgba(${48 + n * 24 | 0},${110 + n * 40 | 0},${200 + n * 40 | 0},0.72)`;
        ctx.fillRect(ox + x, oy + y, 1, 1);
      }
    }
  },
  glass(ctx, ox, oy) {
    ctx.clearRect(ox, oy, TILE_PX, TILE_PX);
    ctx.fillStyle = 'rgba(214,236,244,0.22)';
    ctx.fillRect(ox, oy, TILE_PX, TILE_PX);
    ctx.strokeStyle = 'rgba(226,244,250,0.85)';
    ctx.lineWidth = 2;
    ctx.strokeRect(ox + 1, oy + 1, TILE_PX - 2, TILE_PX - 2);
  },
  brick(ctx, ox, oy) {
    grainy(ctx, ox, oy, [154, 78, 62], 0.12, 20);
    ctx.fillStyle = 'rgba(206,198,188,0.9)';
    for (let y = 0; y < TILE_PX; y += 8) {
      ctx.fillRect(ox, oy + y, TILE_PX, 2);
      const offset = (y / 8) % 2 === 0 ? 0 : TILE_PX / 2;
      ctx.fillRect(ox + ((offset + TILE_PX / 2) % TILE_PX), oy + y, 2, 8);
    }
  },
  glowstone(ctx, ox, oy) {
    grainy(ctx, ox, oy, [226, 196, 110], 0.18, 21);
    blobs(ctx, ox, oy, 'rgba(255,244,190,0.95)', 14, 3, 22);
  },
  coal_ore(ctx, ox, oy) {
    painters.stone(ctx, ox, oy);
    blobs(ctx, ox, oy, 'rgba(32,32,36,0.95)', 7, 4, 23);
  },
  iron_ore(ctx, ox, oy) {
    painters.stone(ctx, ox, oy);
    blobs(ctx, ox, oy, 'rgba(206,166,132,0.95)', 7, 4, 24);
  },
  apple(ctx, ox, oy) {
    ctx.clearRect(ox, oy, TILE_PX, TILE_PX);
    const c = TILE_PX / 2;
    ctx.fillStyle = '#c0392b';
    ctx.beginPath();
    ctx.arc(ox + c, oy + c + 2, TILE_PX * 0.34, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.beginPath();
    ctx.arc(ox + c - 4, oy + c - 3, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#5d4037';
    ctx.fillRect(ox + c - 1, oy + 4, 2, 7);
    ctx.fillStyle = '#4caf50';
    ctx.fillRect(ox + c + 1, oy + 5, 6, 3);
  },
  porkchop(ctx, ox, oy) {
    ctx.clearRect(ox, oy, TILE_PX, TILE_PX);
    ctx.fillStyle = '#b86b5a';
    ctx.beginPath();
    ctx.ellipse(ox + TILE_PX / 2, oy + TILE_PX / 2 + 2, TILE_PX * 0.32, TILE_PX * 0.26, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#8d4a3c';
    for (let i = 0; i < 6; i++) {
      const bx = 10 + Math.floor(px(i, 5, 31) * 12);
      const by = 11 + Math.floor(px(i, 6, 31) * 10);
      ctx.fillRect(ox + bx, oy + by, 2, 2);
    }
    ctx.fillStyle = '#efe4d2';
    ctx.fillRect(ox + 5, oy + TILE_PX / 2 - 2, 7, 5);   // bone
  },
  table_top(ctx, ox, oy) {
    painters.planks(ctx, ox, oy);
    ctx.strokeStyle = 'rgba(70,52,30,0.8)';
    ctx.lineWidth = 2;
    ctx.strokeRect(ox + 4, oy + 4, TILE_PX - 8, TILE_PX - 8);
    ctx.beginPath();
    ctx.moveTo(ox + 4, oy + TILE_PX / 2); ctx.lineTo(ox + TILE_PX - 4, oy + TILE_PX / 2);
    ctx.moveTo(ox + TILE_PX / 2, oy + 4); ctx.lineTo(ox + TILE_PX / 2, oy + TILE_PX - 4);
    ctx.stroke();
  },
  table_side(ctx, ox, oy) {
    painters.planks(ctx, ox, oy);
    grainy(ctx, ox, oy + TILE_PX - 10, [120, 92, 56], 0.14, 40);
    ctx.fillStyle = 'rgba(70,52,30,0.55)';
    ctx.fillRect(ox, oy + TILE_PX - 11, TILE_PX, 2);
  },
  furnace_side(ctx, ox, oy) {
    grainy(ctx, ox, oy, [112, 112, 116], 0.14, 41);
    blobs(ctx, ox, oy, 'rgba(92,92,96,0.5)', 10, 3, 42);
  },
  furnace_front(ctx, ox, oy) {
    painters.furnace_side(ctx, ox, oy);
    // Dark mouth with a lit fire inside.
    ctx.fillStyle = '#2a2a2e';
    ctx.fillRect(ox + 6, oy + 13, TILE_PX - 12, TILE_PX - 18);
    const grad = ctx.createLinearGradient(0, oy + TILE_PX - 5, 0, oy + 15);
    grad.addColorStop(0, '#ffd166');
    grad.addColorStop(1, 'rgba(226,88,34,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(ox + 8, oy + 15, TILE_PX - 16, TILE_PX - 21);
    ctx.fillStyle = '#5a5a5e';
    ctx.fillRect(ox + 5, oy + 8, TILE_PX - 10, 3);
  },
  torch(ctx, ox, oy) {
    ctx.clearRect(ox, oy, TILE_PX, TILE_PX);
    const c = TILE_PX / 2;
    ctx.fillStyle = '#6b4f2a';                      // handle
    ctx.fillRect(ox + c - 3, oy + 10, 6, TILE_PX - 10);
    ctx.fillStyle = '#ffd166';                      // flame
    ctx.fillRect(ox + c - 4, oy + 3, 8, 8);
    ctx.fillStyle = '#fff3c4';
    ctx.fillRect(ox + c - 2, oy + 5, 4, 4);
  },
  stick(ctx, ox, oy) {
    ctx.clearRect(ox, oy, TILE_PX, TILE_PX);
    ctx.save();
    ctx.translate(ox + TILE_PX / 2, oy + TILE_PX / 2);
    ctx.rotate(-Math.PI / 4);
    ctx.fillStyle = '#8a6636';
    ctx.fillRect(-3, -12, 6, 24);
    ctx.fillStyle = '#6b4f2a';
    ctx.fillRect(-3, -12, 2, 24);
    ctx.restore();
  },
  coal(ctx, ox, oy) {
    ctx.clearRect(ox, oy, TILE_PX, TILE_PX);
    ctx.fillStyle = '#26262a';
    ctx.beginPath();
    ctx.ellipse(ox + TILE_PX / 2, oy + TILE_PX / 2, 10, 9, 0.3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(90,90,98,0.8)';
    ctx.fillRect(ox + 11, oy + 12, 4, 3);
  },
  iron_ingot(ctx, ox, oy) {
    ctx.clearRect(ox, oy, TILE_PX, TILE_PX);
    ctx.fillStyle = '#d8d8dc';
    ctx.beginPath();
    ctx.moveTo(ox + 7, oy + 20); ctx.lineTo(ox + 10, oy + 12);
    ctx.lineTo(ox + 22, oy + 12); ctx.lineTo(ox + 25, oy + 20);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.fillRect(ox + 11, oy + 14, 10, 2);
  },
};

// Tools share one painter: a shaft plus a head whose silhouette depends on the
// kind and whose colour depends on the material tier.
const TOOL_HEADS = {
  pick: (ctx, x, y, c) => {
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.moveTo(x - 11, y + 2); ctx.quadraticCurveTo(x, y - 8, x + 11, y + 2);
    ctx.lineTo(x + 8, y + 6); ctx.quadraticCurveTo(x, y - 2, x - 8, y + 6);
    ctx.closePath(); ctx.fill();
  },
  axe: (ctx, x, y, c) => {
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.moveTo(x - 2, y - 7); ctx.lineTo(x + 9, y - 4);
    ctx.lineTo(x + 9, y + 6); ctx.lineTo(x - 2, y + 8);
    ctx.closePath(); ctx.fill();
  },
  shovel: (ctx, x, y, c) => {
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.moveTo(x - 6, y - 5); ctx.lineTo(x + 6, y - 5);
    ctx.lineTo(x + 5, y + 7); ctx.lineTo(x - 5, y + 7);
    ctx.closePath(); ctx.fill();
  },
  sword: (ctx, x, y, c) => {
    ctx.fillStyle = c;
    ctx.fillRect(x - 3, y - 10, 6, 20);
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.fillRect(x - 1, y - 9, 2, 17);
  },
};

const TOOL_COLORS = { wood: '#a8844f', stone: '#8e8e94', iron: '#dcdce2' };

function paintTool(kind, material) {
  return (ctx, ox, oy) => {
    ctx.clearRect(ox, oy, TILE_PX, TILE_PX);
    const c = TILE_PX / 2;
    ctx.save();
    ctx.translate(ox + c, oy + c);
    ctx.rotate(Math.PI / 4);
    // Handle runs corner to corner; swords are all blade so they skip the head.
    ctx.fillStyle = '#7a5a30';
    ctx.fillRect(-2.5, kind === 'sword' ? 2 : -2, 5, kind === 'sword' ? 13 : 16);
    if (kind === 'sword') {
      ctx.fillStyle = '#5c431f';
      ctx.fillRect(-6, 0, 12, 3);                   // crossguard
    }
    TOOL_HEADS[kind](ctx, 0, kind === 'sword' ? -4 : -7, TOOL_COLORS[material]);
    ctx.restore();
  };
}

for (const kind of ['pick', 'axe', 'shovel', 'sword']) {
  for (const material of ['wood', 'stone', 'iron']) {
    painters[`${kind}_${material}`] = paintTool(kind, material);
  }
}

export function buildAtlas() {
  const canvas = document.createElement('canvas');
  canvas.width = ATLAS_COLS * TILE_PX;
  canvas.height = ATLAS_ROWS * TILE_PX;
  const ctx = canvas.getContext('2d');

  TILES.forEach((name, i) => {
    const ox = (i % ATLAS_COLS) * TILE_PX;
    const oy = Math.floor(i / ATLAS_COLS) * TILE_PX;
    const paint = painters[name];
    if (paint) paint(ctx, ox, oy);
    else grainy(ctx, ox, oy, [255, 0, 255], 0, 0); // missing-texture magenta
  });

  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter; // no mips: avoids atlas bleed between tiles
  texture.generateMipmaps = false;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
  // The raw canvas is handed back too: the HUD slices block icons out of it.
  return { texture, canvas };
}

/** Pixel rect of a tile inside the atlas canvas. */
export function tileRect(index) {
  return {
    x: (index % ATLAS_COLS) * TILE_PX,
    y: Math.floor(index / ATLAS_COLS) * TILE_PX,
    w: TILE_PX, h: TILE_PX,
  };
}

/** UV rect for a tile, inset by a quarter texel so neighbours never bleed in. */
export function tileUV(index) {
  const inset = 0.25 / TILE_PX;
  const u0 = (index % ATLAS_COLS) / ATLAS_COLS + inset / ATLAS_COLS;
  const v1 = 1 - Math.floor(index / ATLAS_COLS) / ATLAS_ROWS - inset / ATLAS_ROWS;
  const u1 = u0 + 1 / ATLAS_COLS - 2 * inset / ATLAS_COLS;
  const v0 = v1 - 1 / ATLAS_ROWS + 2 * inset / ATLAS_ROWS;
  return [u0, v0, u1, v1];
}

/**
 * A unit cube whose six faces are UV-mapped to a block's atlas tiles. BoxGeometry
 * emits faces in +x,-x,+y,-y,+z,-z order, which matches the block face table.
 */
export function blockCubeGeometry(faces) {
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const uv = geo.attributes.uv;
  for (let face = 0; face < 6; face++) {
    const [u0, v0, u1, v1] = tileUV(faces[face]);
    for (let v = 0; v < 4; v++) {
      const i = face * 4 + v;
      uv.setXY(i, uv.getX(i) ? u1 : u0, uv.getY(i) ? v1 : v0);
    }
  }
  uv.needsUpdate = true;
  return geo;
}

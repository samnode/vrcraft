// Procedural block atlas. Everything is drawn into one canvas at load time, so the
// project ships with no binary assets and the texture budget on Quest stays tiny.

import * as THREE from '../vendor/three/three.module.js?v=31';
import { TILES } from './blocks.js?v=31';

export const TILE_PX = 32;
export const ATLAS_COLS = 8;
export const ATLAS_ROWS = 12;

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

const BED_RED = [168, 48, 48];
const BED_LINEN = [233, 230, 220];
const BED_TIMBER = [107, 74, 40];

/** grainy() over a sub-rectangle, for bands inside a tile rather than whole tiles. */
function grainy2(ctx, ox, oy, w, h, base, amount, salt) {
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const n = (px(x, y, salt) - 0.5) * amount;
      ctx.fillStyle = rgb(base[0] + base[0] * n, base[1] + base[1] * n, base[2] + base[2] * n);
      ctx.fillRect(ox + x, oy + y, 1, 1);
    }
  }
}

/** The timber rail along the bottom of a bed's side, below the mattress. */
function bedRail(ctx, ox, oy) {
  grainy2(ctx, ox, oy + 23, TILE_PX, 9, BED_TIMBER, 0.14, 60);
  ctx.fillStyle = 'rgba(60,38,18,0.55)';
  ctx.fillRect(ox, oy + 23, TILE_PX, 1);
}

// Armour icons. Each piece is the same set of rectangles painted in a different
// metal, so leather and iron read as the same gear in two materials.
const LEATHER_TONES = [[139, 94, 60], 'rgba(198,146,100,0.6)', 'rgba(84,54,32,0.55)'];
const IRON_TONES = [[196, 200, 208], 'rgba(244,247,252,0.65)', 'rgba(126,131,142,0.6)'];

const ARMOR_SHAPES = {
  helmet: {
    fill: [[6, 7, 20, 6], [5, 13, 22, 8]],
    hole: [[10, 15, 12, 6]],
    hi: [[7, 8, 18, 2]],
    shade: [[5, 19, 22, 2]],
  },
  chest: {
    fill: [[9, 7, 14, 5], [7, 12, 18, 14], [3, 12, 5, 8], [24, 12, 5, 8]],
    hole: [[13, 7, 6, 3]],
    hi: [[8, 13, 16, 2]],
    shade: [[7, 24, 18, 2]],
  },
  legs: {
    fill: [[7, 5, 18, 8], [7, 13, 7, 14], [18, 13, 7, 14]],
    hole: [],
    hi: [[8, 6, 16, 2]],
    shade: [[7, 11, 18, 2]],
  },
  boots: {
    fill: [[5, 12, 9, 10], [4, 22, 11, 5], [18, 12, 9, 10], [17, 22, 11, 5]],
    hole: [],
    hi: [[5, 13, 9, 2], [18, 13, 9, 2]],
    shade: [[4, 25, 11, 2], [17, 25, 11, 2]],
  },
};

function armorIcon(shapeName, tones, salt) {
  const shape = ARMOR_SHAPES[shapeName];
  const [base, hi, shade] = tones;
  return (ctx, ox, oy) => {
    ctx.clearRect(ox, oy, TILE_PX, TILE_PX);
    for (const [x, y, w, h] of shape.fill) grainy2(ctx, ox + x, oy + y, w, h, base, 0.18, salt);
    for (const [x, y, w, h] of shape.hole) ctx.clearRect(ox + x, oy + y, w, h);
    ctx.fillStyle = hi;
    for (const [x, y, w, h] of shape.hi) ctx.fillRect(ox + x, oy + y, w, h);
    ctx.fillStyle = shade;
    for (const [x, y, w, h] of shape.shade) ctx.fillRect(ox + x, oy + y, w, h);
  };
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
  wool(ctx, ox, oy) {
    grainy(ctx, ox, oy, [226, 226, 232], 0.08, 50);
    // Short fibres in random directions give it a felted look.
    for (let i = 0; i < 70; i++) {
      const x = ox + Math.floor(px(i, 1, 51) * TILE_PX);
      const y = oy + Math.floor(px(i, 2, 51) * TILE_PX);
      ctx.fillStyle = px(i, 3, 51) > 0.5 ? 'rgba(200,200,208,0.7)' : 'rgba(250,250,255,0.8)';
      ctx.fillRect(x, y, 2, 1);
    }
  },
  // Lower half: one tall panel with the handle near its top edge.
  door(ctx, ox, oy) {
    grainy(ctx, ox, oy, [150, 112, 62], 0.1, 52);
    ctx.strokeStyle = 'rgba(96,70,36,0.85)';
    ctx.lineWidth = 2;
    ctx.strokeRect(ox + 4, oy, TILE_PX - 8, TILE_PX - 3);
    ctx.fillStyle = '#4a4a50';                      // handle
    ctx.beginPath();
    ctx.arc(ox + TILE_PX - 9, oy + 7, 2.5, 0, Math.PI * 2);
    ctx.fill();
  },
  // Upper half: panelled, with a small window so the two halves read as one door.
  door_top(ctx, ox, oy) {
    grainy(ctx, ox, oy, [150, 112, 62], 0.1, 54);
    ctx.strokeStyle = 'rgba(96,70,36,0.85)';
    ctx.lineWidth = 2;
    ctx.strokeRect(ox + 4, oy + 3, TILE_PX - 8, TILE_PX - 3);
    ctx.fillStyle = 'rgba(120,150,170,0.55)';       // window
    ctx.fillRect(ox + 9, oy + 8, TILE_PX - 18, 10);
    ctx.strokeStyle = 'rgba(96,70,36,0.9)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(ox + 9, oy + 8, TILE_PX - 18, 10);
  },
  ladder(ctx, ox, oy) {
    ctx.clearRect(ox, oy, TILE_PX, TILE_PX);
    ctx.fillStyle = '#9a7340';
    ctx.fillRect(ox + 4, oy, 4, TILE_PX);           // rails
    ctx.fillRect(ox + TILE_PX - 8, oy, 4, TILE_PX);
    ctx.fillStyle = '#b08a52';
    for (let y = 5; y < TILE_PX; y += 9) ctx.fillRect(ox + 4, oy + y, TILE_PX - 8, 3);
  },
  // Bed tiles. The two tops are drawn with the head end towards the top of the
  // tile and rotated into place by the mesher; the sides are deliberately
  // symmetric left-to-right so they can be used on all four walls of a half
  // without ever needing to know which way round they are.
  bed_top_foot(ctx, ox, oy) {
    grainy(ctx, ox, oy, BED_RED, 0.12, 53);
    ctx.fillStyle = 'rgba(120,30,30,0.45)';         // quilt seams
    ctx.fillRect(ox + 2, oy, 1, TILE_PX);
    ctx.fillRect(ox + TILE_PX - 3, oy, 1, TILE_PX);
    ctx.fillRect(ox, oy + TILE_PX - 7, TILE_PX, 1);
    ctx.fillStyle = 'rgba(226,116,116,0.30)';       // hem at the foot end
    ctx.fillRect(ox, oy + TILE_PX - 5, TILE_PX, 2);
  },
  bed_top_head(ctx, ox, oy) {
    grainy(ctx, ox, oy, BED_RED, 0.12, 54);
    ctx.fillStyle = 'rgba(120,30,30,0.45)';
    ctx.fillRect(ox + 2, oy, 1, TILE_PX);
    ctx.fillRect(ox + TILE_PX - 3, oy, 1, TILE_PX);
    grainy2(ctx, ox + 3, oy + 2, TILE_PX - 6, 13, BED_LINEN, 0.07, 55);   // pillow
    ctx.fillStyle = 'rgba(150,146,134,0.55)';       // pillow shadow onto the quilt
    ctx.fillRect(ox + 3, oy + 15, TILE_PX - 6, 2);
    ctx.fillStyle = 'rgba(226,116,116,0.28)';       // turned-down quilt edge
    ctx.fillRect(ox, oy + 18, TILE_PX, 2);
  },
  bed_side_foot(ctx, ox, oy) {
    grainy(ctx, ox, oy, BED_RED, 0.12, 56);
    ctx.fillStyle = 'rgba(120,30,30,0.45)';
    ctx.fillRect(ox, oy + 19, TILE_PX, 2);
    bedRail(ctx, ox, oy);
  },
  bed_side_head(ctx, ox, oy) {
    grainy(ctx, ox, oy, BED_RED, 0.12, 57);
    grainy2(ctx, ox, oy, TILE_PX, 10, BED_LINEN, 0.07, 58);               // pillow edge
    ctx.fillStyle = 'rgba(150,146,134,0.5)';
    ctx.fillRect(ox, oy + 10, TILE_PX, 1);
    ctx.fillStyle = 'rgba(120,30,30,0.45)';
    ctx.fillRect(ox, oy + 19, TILE_PX, 2);
    bedRail(ctx, ox, oy);
  },
  // Underside and the four legs: bare frame timber.
  bed_bottom(ctx, ox, oy) {
    grainy(ctx, ox, oy, BED_TIMBER, 0.16, 59);
    ctx.fillStyle = 'rgba(70,46,24,0.5)';
    for (let y = 6; y < TILE_PX; y += 10) ctx.fillRect(ox, oy + y, TILE_PX, 1);
  },
  // Hotbar and in-hand icon: the whole bed seen from the side.
  bed_item(ctx, ox, oy) {
    ctx.clearRect(ox, oy, TILE_PX, TILE_PX);
    ctx.fillStyle = '#5c3f21';                      // legs
    ctx.fillRect(ox + 3, oy + 22, 4, 6);
    ctx.fillRect(ox + TILE_PX - 7, oy + 22, 4, 6);
    ctx.fillStyle = '#6b4a28';                      // frame rail
    ctx.fillRect(ox + 2, oy + 18, TILE_PX - 4, 5);
    ctx.fillStyle = '#a83030';                      // mattress
    ctx.fillRect(ox + 2, oy + 10, TILE_PX - 4, 8);
    ctx.fillStyle = '#c04040';
    ctx.fillRect(ox + 2, oy + 10, TILE_PX - 4, 2);
    ctx.fillStyle = '#e9e6dc';                      // pillow at the head end
    ctx.fillRect(ox + 3, oy + 6, 11, 5);
  },
  snow(ctx, ox, oy) {
    grainy(ctx, ox, oy, [240, 243, 250], 0.07, 91);
    // A few brighter flecks so a snowfield is not a flat white rectangle.
    blobs(ctx, ox, oy, 'rgba(255,255,255,0.8)', 14, 2, 92);
  },
  snow_side(ctx, ox, oy) {
    grainy(ctx, ox, oy, [134, 104, 70], 0.2, 93);
    // Snow lip over dirt, with a ragged lower edge, the same trick as grass.
    for (let x = 0; x < TILE_PX; x++) {
      const depth = 7 + Math.floor(px(x, 0, 94) * 5);
      for (let y = 0; y < depth; y++) {
        const n = (px(x, y, 95) - 0.5) * 0.08;
        ctx.fillStyle = rgb(240 + 240 * n, 243 + 243 * n, 250 + 250 * n);
        ctx.fillRect(ox + x, oy + y, 1, 1);
      }
    }
  },
  sandstone(ctx, ox, oy) {
    grainy(ctx, ox, oy, [216, 199, 148], 0.1, 96);
    // Bedding planes: sandstone reads as stacked layers rather than specks.
    ctx.fillStyle = 'rgba(176,158,110,0.5)';
    ctx.fillRect(ox, oy + 2, TILE_PX, 1);
    ctx.fillRect(ox, oy + 13, TILE_PX, 2);
    ctx.fillRect(ox, oy + 24, TILE_PX, 1);
    ctx.fillStyle = 'rgba(244,232,198,0.45)';
    ctx.fillRect(ox, oy + 15, TILE_PX, 1);
  },
  cactus_top(ctx, ox, oy) {
    grainy(ctx, ox, oy, [78, 128, 66], 0.14, 97);
    ctx.fillStyle = 'rgba(46,88,40,0.65)';
    ctx.strokeStyle = 'rgba(46,88,40,0.65)';
    ctx.lineWidth = 2;
    ctx.strokeRect(ox + 4, oy + 4, TILE_PX - 8, TILE_PX - 8);
    ctx.fillStyle = 'rgba(120,170,100,0.5)';
    ctx.fillRect(ox + 13, oy + 13, 6, 6);
  },
  cactus_side(ctx, ox, oy) {
    grainy(ctx, ox, oy, [72, 120, 60], 0.14, 98);
    // Ribs down the flesh, with spines picked out along them.
    ctx.fillStyle = 'rgba(44,84,38,0.55)';
    for (const x of [3, 15, 27]) ctx.fillRect(ox + x, oy, 2, TILE_PX);
    ctx.fillStyle = 'rgba(226,228,200,0.85)';
    for (let y = 3; y < TILE_PX; y += 7) {
      ctx.fillRect(ox + 8, oy + y, 2, 1);
      ctx.fillRect(ox + 21, oy + y + 3, 2, 1);
    }
  },
  spruce_leaves(ctx, ox, oy) {
    ctx.clearRect(ox, oy, TILE_PX, TILE_PX);
    // Same cut-out needle pattern as oak, in a colder, darker green.
    for (let y = 0; y < TILE_PX; y++) {
      for (let x = 0; x < TILE_PX; x++) {
        if (px(x, y, 99) < 0.14) continue;                // gaps you can see through
        const n = (px(x, y, 100) - 0.5) * 0.26;
        ctx.fillStyle = rgb(50 + 50 * n, 100 + 100 * n, 66 + 66 * n);
        ctx.fillRect(ox + x, oy + y, 1, 1);
      }
    }
  },
  leather_helmet: armorIcon('helmet', LEATHER_TONES, 81),
  leather_chest:  armorIcon('chest',  LEATHER_TONES, 82),
  leather_legs:   armorIcon('legs',   LEATHER_TONES, 83),
  leather_boots:  armorIcon('boots',  LEATHER_TONES, 84),
  iron_helmet:    armorIcon('helmet', IRON_TONES, 85),
  iron_chest:     armorIcon('chest',  IRON_TONES, 86),
  iron_legs:      armorIcon('legs',   IRON_TONES, 87),
  iron_boots:     armorIcon('boots',  IRON_TONES, 88),
};

// Small round or elongated item icons, all drawn the same way.
function blobIcon(color, shade, rx, ry) {
  return (ctx, ox, oy) => {
    ctx.clearRect(ox, oy, TILE_PX, TILE_PX);
    const c = TILE_PX / 2;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.ellipse(ox + c, oy + c, rx, ry, 0.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = shade;
    ctx.beginPath();
    ctx.ellipse(ox + c - rx * 0.3, oy + c - ry * 0.3, rx * 0.35, ry * 0.3, 0.2, 0, Math.PI * 2);
    ctx.fill();
  };
}

Object.assign(painters, {
  beef:           blobIcon('#c7504e', 'rgba(255,255,255,0.35)', 11, 8),
  cooked_beef:    blobIcon('#8a4a2c', 'rgba(255,210,150,0.4)', 11, 8),
  cooked_pork:    blobIcon('#a9603a', 'rgba(255,220,170,0.4)', 11, 8),
  raw_chicken:    blobIcon('#e8b9a8', 'rgba(255,255,255,0.45)', 10, 8),
  cooked_chicken: blobIcon('#c08848', 'rgba(255,228,170,0.45)', 10, 8),
  leather:        blobIcon('#9a6b3f', 'rgba(220,180,130,0.35)', 11, 9),
  gunpowder(ctx, ox, oy) {
    ctx.clearRect(ox, oy, TILE_PX, TILE_PX);
    for (let i = 0; i < 40; i++) {
      const x = ox + 6 + Math.floor(px(i, 1, 60) * (TILE_PX - 12));
      const y = oy + 6 + Math.floor(px(i, 2, 60) * (TILE_PX - 12));
      ctx.fillStyle = px(i, 3, 60) > 0.5 ? '#4a4a52' : '#6e6e78';
      ctx.fillRect(x, y, 2, 2);
    }
  },
  feather(ctx, ox, oy) {
    ctx.clearRect(ox, oy, TILE_PX, TILE_PX);
    ctx.save();
    ctx.translate(ox + TILE_PX / 2, oy + TILE_PX / 2);
    ctx.rotate(-0.6);
    ctx.fillStyle = '#eef2f8';
    ctx.beginPath();
    ctx.ellipse(0, 0, 5, 12, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#b9c3d2';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, -12); ctx.lineTo(0, 13);
    ctx.stroke();
    ctx.restore();
  },
  bone(ctx, ox, oy) {
    ctx.clearRect(ox, oy, TILE_PX, TILE_PX);
    ctx.save();
    ctx.translate(ox + TILE_PX / 2, oy + TILE_PX / 2);
    ctx.rotate(-Math.PI / 4);
    ctx.fillStyle = '#eeead8';
    ctx.fillRect(-3, -9, 6, 18);
    for (const y of [-10, 10]) {
      ctx.beginPath();
      ctx.arc(-3, y, 3.5, 0, Math.PI * 2);
      ctx.arc(3, y, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  },
  string(ctx, ox, oy) {
    ctx.clearRect(ox, oy, TILE_PX, TILE_PX);
    ctx.strokeStyle = '#e4e4ea';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(ox + 6, oy + 4);
    ctx.bezierCurveTo(ox + 26, oy + 10, ox + 6, oy + 20, ox + 26, oy + 28);
    ctx.stroke();
  },
  arrow(ctx, ox, oy) {
    ctx.clearRect(ox, oy, TILE_PX, TILE_PX);
    ctx.save();
    ctx.translate(ox + TILE_PX / 2, oy + TILE_PX / 2);
    ctx.rotate(Math.PI / 4);
    ctx.fillStyle = '#8a6636';
    ctx.fillRect(-1.5, -12, 3, 22);
    ctx.fillStyle = '#d8d8dc';                      // head
    ctx.beginPath();
    ctx.moveTo(0, -15); ctx.lineTo(4, -8); ctx.lineTo(-4, -8);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#eef2f8';                      // fletching
    ctx.fillRect(-4, 7, 8, 2);
    ctx.restore();
  },
  bow(ctx, ox, oy) {
    ctx.clearRect(ox, oy, TILE_PX, TILE_PX);
    const c = TILE_PX / 2;
    ctx.strokeStyle = '#8a6636';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(ox + c + 5, oy + c, 11, Math.PI * 0.55, Math.PI * 1.45);
    ctx.stroke();
    ctx.strokeStyle = '#e4e4ea';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(ox + c - 1, oy + c - 10); ctx.lineTo(ox + c - 1, oy + c + 10);
    ctx.stroke();
  },
});

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

// ---------------------------------------------------------------- the Nether
//
// The whole dimension is built from one family of reds, which is what makes it
// read as somewhere else rather than as the overworld with a filter on it. Every
// tile here is deliberately darker than its overworld counterpart: the Nether has
// no sky light at all, so textures that look right under daylight turn to mud.

const NETHERRACK_BASE = [116, 48, 46];

Object.assign(painters, {
  netherrack(ctx, ox, oy) {
    grainy(ctx, ox, oy, NETHERRACK_BASE, 0.3, 70);
    // Stringy darker veins, drawn as short vertical runs so the stone looks
    // fibrous the way netherrack does rather than merely speckled.
    for (let x = 0; x < TILE_PX; x++) {
      if (px(x, 3, 71) < 0.7) continue;
      const y0 = Math.floor(px(x, 4, 72) * TILE_PX);
      const len = 3 + Math.floor(px(x, 5, 73) * 7);
      ctx.fillStyle = 'rgba(66,24,24,0.55)';
      ctx.fillRect(ox + x, oy + y0, 1, len);
    }
    blobs(ctx, ox, oy, 'rgba(154,70,58,0.4)', 14, 2, 74);
  },

  lava(ctx, ox, oy) {
    // Molten rock is a bright body with a dark crust floating on it. Painting
    // the crust as blobs over the glow, rather than tinting the whole tile,
    // keeps the hot parts genuinely bright next to the cooled parts.
    for (let y = 0; y < TILE_PX; y++) {
      for (let x = 0; x < TILE_PX; x++) {
        const n = px(x, y, 75) * 0.5 + px(Math.floor(x / 4), Math.floor(y / 4), 76) * 0.5;
        ctx.fillStyle = rgb(226 + n * 28, 96 + n * 110, 20 + n * 30);
        ctx.fillRect(ox + x, oy + y, 1, 1);
      }
    }
    blobs(ctx, ox, oy, 'rgba(120,34,12,0.55)', 9, 4, 77);
    blobs(ctx, ox, oy, 'rgba(255,232,140,0.8)', 7, 3, 78);
  },

  soul_sand(ctx, ox, oy) {
    // Lighter than it looks it should be. Everything down there is multiplied by
    // a dim red ambient, and at the shade this block would be by daylight it
    // reads as a hole cut in the floor rather than as a patch of ground.
    grainy(ctx, ox, oy, [124, 100, 86], 0.2, 79);
    // The hollows are what name the block. Three rough rings, each a dark pit
    // with a lighter rim, scattered without overlapping the tile edges.
    for (let i = 0; i < 3; i++) {
      const cx = 6 + Math.floor(px(i, 1, 80) * 20);
      const cy = 6 + Math.floor(px(i, 2, 81) * 20);
      ctx.fillStyle = 'rgba(88,68,56,0.7)';
      ctx.beginPath();
      ctx.arc(ox + cx, oy + cy, 3.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(156,132,112,0.55)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(ox + cx, oy + cy, 4.8, 0, Math.PI * 2);
      ctx.stroke();
    }
  },

  quartz_ore(ctx, ox, oy) {
    painters.netherrack(ctx, ox, oy);
    // Crystals in facets rather than round specks, so the ore reads as mineral
    // rather than as a lighter patch of the rock it sits in.
    for (let i = 0; i < 7; i++) {
      const cx = 4 + Math.floor(px(i, 6, 82) * 24);
      const cy = 4 + Math.floor(px(i, 7, 83) * 24);
      const s = 3 + Math.floor(px(i, 8, 84) * 3);
      ctx.fillStyle = 'rgba(232,226,216,0.95)';
      ctx.fillRect(ox + cx, oy + cy, s, s);
      ctx.fillStyle = 'rgba(160,150,142,0.7)';
      ctx.fillRect(ox + cx, oy + cy + s - 1, s, 1);
      ctx.fillStyle = 'rgba(255,255,252,0.9)';
      ctx.fillRect(ox + cx, oy + cy, s - 1, 1);
    }
  },

  quartz_block(ctx, ox, oy) {
    grainy(ctx, ox, oy, [230, 226, 218], 0.07, 85);
    ctx.fillStyle = 'rgba(200,194,184,0.45)';
    ctx.fillRect(ox, oy + TILE_PX - 2, TILE_PX, 2);
    ctx.fillStyle = 'rgba(252,252,250,0.6)';
    ctx.fillRect(ox, oy, TILE_PX, 2);
  },

  nether_brick(ctx, ox, oy) {
    grainy(ctx, ox, oy, [52, 26, 30], 0.18, 86);
    // Courses offset by half a brick, with mortar darker than the brick rather
    // than lighter: pale mortar is what makes a dark brick look like clay.
    ctx.fillStyle = 'rgba(26,12,15,0.9)';
    for (let y = 0; y < TILE_PX; y += 8) ctx.fillRect(ox, oy + y, TILE_PX, 2);
    for (let y = 0; y < TILE_PX; y += 8) {
      const shift = (y / 8) % 2 ? 8 : 0;
      for (let x = shift; x < TILE_PX; x += 16) ctx.fillRect(ox + x, oy + y, 2, 8);
    }
    blobs(ctx, ox, oy, 'rgba(80,42,46,0.35)', 10, 2, 87);
  },

  obsidian(ctx, ox, oy) {
    grainy(ctx, ox, oy, [22, 16, 36], 0.35, 88);
    blobs(ctx, ox, oy, 'rgba(78,54,122,0.5)', 12, 3, 89);
    // A couple of specular slashes: obsidian is volcanic glass, and the thing
    // that sells glass is a highlight that does not follow the grain.
    ctx.strokeStyle = 'rgba(150,120,205,0.4)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 3; i++) {
      const x = 4 + Math.floor(px(i, 9, 90) * 22);
      const y = 4 + Math.floor(px(i, 10, 91) * 22);
      ctx.beginPath();
      ctx.moveTo(ox + x, oy + y);
      ctx.lineTo(ox + x + 5, oy + y + 7);
      ctx.stroke();
    }
  },

  portal(ctx, ox, oy) {
    // The shader does the drifting and the glow; this tile supplies the
    // structure that drifts. Every term is periodic at the tile size, which is
    // the whole point: a portal is two cells wide and three tall, and a pattern
    // that did not wrap would show that grid as six identical stamps.
    for (let y = 0; y < TILE_PX; y++) {
      for (let x = 0; x < TILE_PX; x++) {
        const u = (x / TILE_PX) * Math.PI * 2;
        const v = (y / TILE_PX) * Math.PI * 2;
        const a = Math.sin(u * 2 + Math.sin(v) * 1.6);
        const b = Math.sin(v * 3 - Math.sin(u) * 1.3);
        const c = Math.sin(u + v * 2);
        const n = px(x, y, 92);
        const k = Math.min(1, Math.max(0, (a * 0.34 + b * 0.34 + c * 0.32 + 1) / 2 * 0.82 + n * 0.18));
        ctx.fillStyle = `rgba(${108 + k * 130 | 0},${34 + k * 74 | 0},${176 + k * 74 | 0},${(0.55 + k * 0.45).toFixed(3)})`;
        ctx.fillRect(ox + x, oy + y, 1, 1);
      }
    }
  },

  quartz(ctx, ox, oy) {
    ctx.clearRect(ox, oy, TILE_PX, TILE_PX);
    // A single cleaved shard, lit from the upper left.
    const shard = [[13, 6], [21, 12], [19, 25], [11, 24], [9, 11]];
    ctx.beginPath();
    ctx.moveTo(ox + shard[0][0], oy + shard[0][1]);
    for (const [x, y] of shard.slice(1)) ctx.lineTo(ox + x, oy + y);
    ctx.closePath();
    ctx.fillStyle = 'rgb(226,222,214)';
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,253,0.85)';
    ctx.beginPath();
    ctx.moveTo(ox + 13, oy + 6);
    ctx.lineTo(ox + 15, oy + 24);
    ctx.lineTo(ox + 11, oy + 24);
    ctx.lineTo(ox + 9, oy + 11);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(132,126,118,0.8)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(ox + 13, oy + 6);
    ctx.lineTo(ox + 15, oy + 24);
    ctx.stroke();
  },

  flint_steel(ctx, ox, oy) {
    ctx.clearRect(ox, oy, TILE_PX, TILE_PX);
    // Steel striker across the bottom, flint above it, sparks between: the two
    // halves have to touch or the icon reads as two unrelated objects.
    grainy2(ctx, ox + 6, oy + 18, 20, 6, [176, 180, 190], 0.2, 93);
    ctx.fillStyle = 'rgba(226,232,240,0.8)';
    ctx.fillRect(ox + 6, oy + 18, 20, 1);
    ctx.fillStyle = 'rgba(96,100,110,0.8)';
    ctx.fillRect(ox + 6, oy + 23, 20, 1);
    grainy2(ctx, ox + 9, oy + 8, 12, 9, [64, 62, 68], 0.3, 94);
    ctx.fillStyle = 'rgba(120,118,126,0.7)';
    ctx.fillRect(ox + 9, oy + 8, 12, 1);
    ctx.fillStyle = 'rgba(255,214,110,0.95)';
    for (const [x, y, s] of [[22, 14, 2], [25, 11, 2], [20, 10, 1], [26, 16, 1]]) {
      ctx.fillRect(ox + x, oy + y, s, s);
    }
  },
});

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

/**
 * One geometry out of a list of axis-aligned boxes, each with its own colour
 * baked into vertex colours. Mob and held-item models are built this way so a
 * whole model costs a single draw call. Parts may carry `rot: [x, y, z]`, which
 * is applied about the part's own centre before it is moved into place.
 */
export function mergeBoxes(parts) {
  const pos = [], norm = [], col = [];
  for (const part of parts) {
    const g = new THREE.BoxGeometry(...part.size).toNonIndexed();
    if (part.rot) {
      g.rotateX(part.rot[0]);
      g.rotateY(part.rot[1]);
      g.rotateZ(part.rot[2]);
    }
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

// Extruded item icons, cached by tile: an icon is rebuilt only the first time
// something is picked up, and from then on every hand shares the geometry.
const iconCache = new Map();

/**
 * A flat item icon turned into a solid: every opaque pixel becomes a box of
 * that colour, runs of one colour merged along each row. This is what makes a
 * carrot or an ingot look like an object in your fist rather than a sticker.
 */
export function iconGeometry(canvas, tileIndex, size = 0.16, depth = 0.024) {
  const cached = iconCache.get(tileIndex);
  if (cached) return cached;

  const { x, y, w, h } = tileRect(tileIndex);
  const data = canvas.getContext('2d', { willReadFrequently: true })
    .getImageData(x, y, w, h).data;
  const STEP = 2;                                  // 32px tiles read as 16 cells
  const cols = w / STEP, rows = h / STEP;
  const cell = size / cols;
  const parts = [];

  // Colours are quantised before comparing, or the per-pixel grain in the atlas
  // would break every row into single-cell boxes.
  const at = (col, row) => {
    const i = ((row * STEP) * w + col * STEP) * 4;
    if (data[i + 3] < 128) return -1;
    return ((data[i] & 0xf8) << 16) | ((data[i + 1] & 0xf8) << 8) | (data[i + 2] & 0xf8);
  };

  for (let row = 0; row < rows; row++) {
    let start = -1, color = -1;
    for (let col = 0; col <= cols; col++) {
      const here = col < cols ? at(col, row) : -1;
      if (here === color) continue;
      if (color !== -1) {
        const n = col - start;
        parts.push({
          size: [cell * n, cell, depth],
          pos: [(start + n / 2 - cols / 2) * cell, (rows / 2 - row - 0.5) * cell, 0],
          color,
        });
      }
      start = col;
      color = here;
    }
  }

  const geo = parts.length ? mergeBoxes(parts) : new THREE.BufferGeometry();
  iconCache.set(tileIndex, geo);
  return geo;
}

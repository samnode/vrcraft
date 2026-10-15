// The crafting panel. Like Hud, it draws to one canvas that is shown two ways:
// a DOM overlay on desktop, and a textured quad floating in front of you in VR
// that the right controller points at.

import * as THREE from '../vendor/three/three.module.js?v=31';
import { block } from './blocks.js?v=31';
import { tileRect } from './textures.js?v=31';
import { RECIPES, canCraft, hasIngredients, stationAvailable, recipeLabel } from './crafting.js?v=31';

const W = 1160, H = 700;
const ROW_H = 48, ROW_GAP = 3;
const LIST_TOP = 92, PAD = 20;
// Four columns rather than three: the recipe list in three columns runs off the
// bottom of the panel, and a taller panel would not fit a short window. At this
// row pitch the four columns hold eleven rows, so there is room for forty-four
// recipes before the layout has to change again.
const COLS = 4;

export class CraftUI {
  constructor(atlasCanvas) {
    this.atlas = atlasCanvas;
    this.open = false;
    this.rowRects = [];
    this.hoverIndex = -1;

    this.canvas = document.createElement('canvas');
    this.canvas.width = W;
    this.canvas.height = H;
    this.ctx = this.canvas.getContext('2d');
    this.ctx.imageSmoothingEnabled = false;

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.generateMipmaps = false;

    // Floats at a comfortable reading distance ahead of the player in VR. The
    // quad grew with the canvas: four columns on the old 0.78m panel would have
    // shrunk the recipe text by a fifth in the headset.
    this.panel = new THREE.Mesh(
      new THREE.PlaneGeometry(0.88, 0.88 * H / W),
      new THREE.MeshBasicMaterial({ map: this.texture, transparent: true, depthTest: false }),
    );
    this.panel.renderOrder = 11;
    this.panel.visible = false;
  }

  attachToDom(parent) {
    const el = this.canvas;
    // Bounded by viewport height as well as width, so the recipe list is never
    // clipped on a short window.
    el.style.cssText = 'position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);'
      + `width:min(1160px, 94vw, calc(88vh * ${(W / H).toFixed(3)}));`
      + 'image-rendering:pixelated;z-index:12;display:none;cursor:pointer';
    parent.appendChild(el);
  }

  setOpen(on) {
    this.open = on;
    this.canvas.style.display = on ? 'block' : 'none';
    this.hoverIndex = -1;
  }

  /** Place the VR panel in front of the camera, upright and facing the viewer. */
  positionInFront(camera) {
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.getWorldQuaternion(new THREE.Quaternion()));
    dir.y = 0;
    if (dir.lengthSq() < 1e-6) dir.set(0, 0, -1);
    dir.normalize();
    const head = camera.getWorldPosition(new THREE.Vector3());
    // 0.88m wide at 0.76m puts the recipe text at exactly the angular size it had
    // when the panel was three columns on a narrower canvas.
    this.panel.position.copy(head).addScaledVector(dir, 0.76).add(new THREE.Vector3(0, -0.1, 0));
    this.panel.lookAt(head);
  }

  draw(inventory, stations) {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, W, H);

    ctx.fillStyle = 'rgba(12,18,38,0.94)';
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = 'rgba(120,160,255,0.35)';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, W - 2, H - 2);

    ctx.fillStyle = '#ffffff';
    ctx.font = '700 26px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('Crafting', PAD, 44);

    ctx.font = '500 14px system-ui, sans-serif';
    ctx.fillStyle = stations.table ? '#9fe6a0' : '#8fa6cf';
    ctx.fillText(stations.table ? 'Crafting table in reach' : 'No crafting table nearby', PAD, 68);
    ctx.fillStyle = stations.furnace ? '#ffc98f' : '#8fa6cf';
    ctx.fillText(stations.furnace ? 'Furnace in reach' : 'No furnace nearby', PAD + 250, 68);

    ctx.textAlign = 'right';
    ctx.fillStyle = '#8fa6cf';
    ctx.font = '500 13px system-ui, sans-serif';
    ctx.fillText(inventory.creative ? 'Creative: everything unlocked' : 'Pick a recipe to craft', W - PAD, 44);

    this.rowRects = [];
    const colWidth = (W - PAD * 2 - 12 * (COLS - 1)) / COLS;

    RECIPES.forEach((recipe, i) => {
      const col = i % COLS, row = Math.floor(i / COLS);
      const x = PAD + col * (colWidth + 12);
      const y = LIST_TOP + row * (ROW_H + ROW_GAP);
      this.rowRects.push({ x, y, w: colWidth, h: ROW_H });

      const has = hasIngredients(recipe, inventory);
      const station = stationAvailable(recipe, stations);
      const ok = canCraft(recipe, inventory, stations);
      const hovered = i === this.hoverIndex;

      ctx.fillStyle = ok ? (hovered ? 'rgba(80,140,230,0.55)' : 'rgba(255,255,255,0.10)')
                         : 'rgba(255,255,255,0.03)';
      ctx.fillRect(x, y, colWidth, ROW_H);
      if (hovered) {
        ctx.strokeStyle = ok ? '#8fd0ff' : 'rgba(255,255,255,0.2)';
        ctx.lineWidth = 2;
        ctx.strokeRect(x + 1, y + 1, colWidth - 2, ROW_H - 2);
      }

      const out = block(recipe.out);
      const r = tileRect(out.faces[2]);
      ctx.globalAlpha = ok ? 1 : 0.35;
      ctx.drawImage(this.atlas, r.x, r.y, r.w, r.h, x + 6, y + 5, 38, 38);

      const label = recipeLabel(recipe);
      ctx.textAlign = 'left';
      ctx.fillStyle = ok ? '#ffffff' : '#7d8db0';
      ctx.font = '600 15px system-ui, sans-serif';
      ctx.fillText(label.name, x + 52, y + 21);

      // Missing ingredients and absent stations are the two reasons a row is dim.
      ctx.font = '500 12px system-ui, sans-serif';
      ctx.fillStyle = !station ? '#e8a06a' : (has ? '#9db2d8' : '#c47b7b');
      const note = !station ? `needs a ${recipe.needs}` : label.inputs;
      ctx.fillText(note, x + 52, y + 38);
      ctx.globalAlpha = 1;
    });

    this.texture.needsUpdate = true;
  }

  /** Canvas-pixel point to recipe index, or -1. */
  indexAtPixel(px, py) {
    for (let i = 0; i < this.rowRects.length; i++) {
      const r = this.rowRects[i];
      if (px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h) return i;
    }
    return -1;
  }

  indexAtUV(u, v) { return this.indexAtPixel(u * W, (1 - v) * H); }

  /** Maps a DOM click on the scaled canvas back to canvas pixels. */
  indexAtClientPoint(clientX, clientY) {
    const b = this.canvas.getBoundingClientRect();
    if (clientX < b.left || clientX > b.right || clientY < b.top || clientY > b.bottom) return -1;
    return this.indexAtPixel((clientX - b.left) / b.width * W, (clientY - b.top) / b.height * H);
  }
}

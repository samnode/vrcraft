// One canvas HUD, drawn once per frame and shown two ways: as a CSS overlay on
// desktop, and as a texture on a wrist panel in VR (where DOM is invisible).

import * as THREE from '../vendor/three/three.module.js?v=7';
import { block } from './blocks.js?v=7';
import { tileRect } from './textures.js?v=7';
import { MAX_HEALTH, MAX_HUNGER } from './survival.js?v=7';

const W = 768, H = 300;
const SLOT = 54, SLOT_GAP = 6;
const HOTBAR_TOP = 112;

export class Hud {
  constructor(atlasCanvas) {
    this.atlas = atlasCanvas;
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

    // Wrist panel: a quad parented to the left controller, tilted into view.
    const mat = new THREE.MeshBasicMaterial({ map: this.texture, transparent: true, depthTest: false });
    this.panel = new THREE.Mesh(new THREE.PlaneGeometry(0.30, 0.30 * H / W), mat);
    // Canvas-pixel rect per slot, refreshed on every draw so the VR pointer can
    // map a hit on this panel back to the block it is over.
    this.slotRects = [];
    this.panel.position.set(0, 0.045, -0.06);
    this.panel.rotation.set(-Math.PI / 3.1, 0, 0);
    this.panel.renderOrder = 10;
    this.panel.visible = false;
  }

  /** Mount the canvas as a DOM overlay for the desktop view. */
  attachToDom(parent) {
    const el = this.canvas;
    el.style.position = 'absolute';
    el.style.left = '50%';
    el.style.bottom = '12px';
    el.style.transform = 'translateX(-50%)';
    el.style.width = 'min(768px, 92vw)';
    el.style.imageRendering = 'pixelated';
    el.style.pointerEvents = 'none';
    el.style.zIndex = '5';
    parent.appendChild(el);
    this.domAttached = true;
  }

  setDomVisible(on) { if (this.domAttached) this.canvas.style.display = on ? 'block' : 'none'; }

  draw(state) {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, W, H);

    this.drawMessages(ctx, state.messages);
    if (state.survival) this.drawBars(ctx, state.health, state.hunger);
    this.drawHotbar(ctx, state.slots, state.selected, state.creative, state.hoverSlot);
    this.drawFooter(ctx, state);

    this.texture.needsUpdate = true;
  }

  drawMessages(ctx, messages = []) {
    ctx.font = '600 19px system-ui, sans-serif';
    ctx.textAlign = 'center';
    messages.slice(-3).forEach((m, i) => {
      ctx.globalAlpha = Math.min(1, m.t);
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      const w = ctx.measureText(m.text).width + 18;
      ctx.fillRect(W / 2 - w / 2, 4 + i * 26, w, 23);
      ctx.fillStyle = '#fff';
      ctx.fillText(m.text, W / 2, 21 + i * 26);
    });
    ctx.globalAlpha = 1;
  }

  drawBars(ctx, health, hunger) {
    const y = 88;
    for (let i = 0; i < MAX_HEALTH / 2; i++) {
      const filled = health >= (i + 1) * 2 ? 1 : (health > i * 2 ? 0.5 : 0);
      this.icon(ctx, 86 + i * 24, y, filled, '#e0373c', '#4a1114');
    }
    for (let i = 0; i < MAX_HUNGER / 2; i++) {
      const filled = hunger >= (i + 1) * 2 ? 1 : (hunger > i * 2 ? 0.5 : 0);
      this.icon(ctx, W - 86 - (MAX_HUNGER / 2 - 1 - i) * 24, y, filled, '#c98a3c', '#3d2a12');
    }
  }

  /** Simple pip: empty, half or full. Shape doubles for hearts and hunger. */
  icon(ctx, x, y, filled, color, empty) {
    ctx.fillStyle = empty;
    ctx.beginPath();
    ctx.arc(x, y, 9, 0, Math.PI * 2);
    ctx.fill();
    if (filled <= 0) return;
    ctx.fillStyle = color;
    ctx.beginPath();
    if (filled >= 1) ctx.arc(x, y, 7, 0, Math.PI * 2);
    else ctx.arc(x, y, 7, Math.PI / 2, Math.PI * 1.5);
    ctx.fill();
  }

  /**
   * Lays the palette out in up to two rows, so a 13-block creative palette and a
   * 9-slot survival bar both fit without changing the panel's shape.
   */
  drawHotbar(ctx, slots, selected, creative, hoverSlot) {
    const perRow = slots.length <= 9 ? slots.length : Math.ceil(slots.length / 2);
    this.slotRects = [];

    slots.forEach((slot, i) => {
      const row = Math.floor(i / perRow);
      const col = i % perRow;
      const count = Math.min(perRow, slots.length - row * perRow);
      const rowWidth = count * SLOT + (count - 1) * SLOT_GAP;
      const x = (W - rowWidth) / 2 + col * (SLOT + SLOT_GAP);
      const y = HOTBAR_TOP + row * (SLOT + 20);
      this.slotRects.push({ x, y, w: SLOT, h: SLOT });

      const active = i === selected;
      const hovered = i === hoverSlot;

      ctx.fillStyle = active ? 'rgba(255,255,255,0.22)' : 'rgba(0,0,0,0.42)';
      ctx.fillRect(x, y, SLOT, SLOT);

      if (slot.id) {
        const r = tileRect(block(slot.id).faces[2]);   // top face reads best as an icon
        ctx.drawImage(this.atlas, r.x, r.y, r.w, r.h, x + 6, y + 6, SLOT - 12, SLOT - 12);
        if (!creative && slot.count !== Infinity && slot.count > 0) {
          ctx.font = '700 15px system-ui, sans-serif';
          ctx.textAlign = 'right';
          ctx.fillStyle = '#000';
          ctx.fillText(String(slot.count), x + SLOT - 4, y + SLOT - 5);
          ctx.fillStyle = '#fff';
          ctx.fillText(String(slot.count), x + SLOT - 5, y + SLOT - 6);
        }
      }

      // Hover outline is what makes pointing at the wrist panel feel aimed.
      ctx.strokeStyle = active ? '#ffffff' : (hovered ? '#8fd0ff' : 'rgba(255,255,255,0.3)');
      ctx.lineWidth = active ? 3 : (hovered ? 3 : 1.5);
      ctx.strokeRect(x + 0.5, y + 0.5, SLOT - 1, SLOT - 1);

      if (i < 9) {
        ctx.font = '600 11px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        ctx.fillText(String(i + 1), x + SLOT / 2, y + SLOT + 13);
      }
    });
  }

  /**
   * Maps a UV hit on the panel to a slot index, or -1. UV origin is bottom-left
   * while the canvas runs top-down, so v is flipped.
   */
  slotAtUV(u, v) {
    const px = u * W, py = (1 - v) * H;
    for (let i = 0; i < this.slotRects.length; i++) {
      const r = this.slotRects[i];
      if (px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h) return i;
    }
    return -1;
  }

  drawFooter(ctx, state) {
    ctx.textAlign = 'center';
    ctx.font = '600 18px system-ui, sans-serif';
    ctx.fillStyle = '#fff';
    ctx.fillText(state.label, W / 2, H - 10);

    ctx.textAlign = 'left';
    ctx.font = '500 14px system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.fillText(state.mode, 12, H - 10);

    ctx.textAlign = 'right';
    ctx.fillText(state.clock, W - 12, H - 10);
  }
}

/** Formats the day/night cycle as a 24-hour clock. */
export function formatClock(time) {
  // time 0 is dawn, so shift by six hours to line the cycle up with sunrise.
  const hours = (time * 24 + 6) % 24;
  const h = Math.floor(hours);
  const m = Math.floor((hours - h) * 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

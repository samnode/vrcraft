// First-person hands.
//
// Whatever is selected is modelled in 3D and held in a fist: tools and the bow
// out of boxes, blocks as a textured cube, and everything else as its flat item
// icon given a little thickness. Every model is built with its grip at the local
// origin and its length running up +Y, so a mount only has to decide where the
// hand is and which way the fist points.

import * as THREE from '../vendor/three/three.module.js?v=31';
import { block, isPlaceable, BOW } from './blocks.js?v=31';
import { blockCubeGeometry, iconGeometry, mergeBoxes } from './textures.js?v=31';

const SKIN = 0xc98f68;
const CUFF = 0x2f5a93;
const SLEEVE = 0x3f6fb5;
const WOOD = 0x7a5a30;
// Tool tiers 1..3 are wood, stone and iron; these match the atlas icons.
const TIER_COLOR = { 1: 0xa8844f, 2: 0x8e8e94, 3: 0xdcdce2 };
// How far behind the fist the swing turns, in metres: a forearm's length.
const ELBOW = 0.30;

// Fist at the origin, forearm running back along +Z towards the elbow, thumb on
// top at the forward end. That is an XR grip space exactly: a held rod lies
// along -z pointing past the thumb, and +x comes out of the back of the hand.
const HAND = [
  { size: [0.090, 0.078, 0.105], pos: [0, 0, 0.005],         color: SKIN },   // fist
  { size: [0.030, 0.034, 0.052], pos: [0.028, 0.040, -0.030], color: SKIN },  // thumb
  { size: [0.086, 0.070, 0.045], pos: [0, 0.006, 0.078],     color: CUFF },   // cuff
  { size: [0.076, 0.064, 0.170], pos: [0, 0.008, 0.183],     color: SLEEVE }, // forearm
];

// On screen the arm has to run off the bottom of the frame to read as yours,
// which takes more limb than a tracked hand wants: in VR the arm ends where your
// real one begins, and anything past that is a second elbow floating in your chest.
const ARM_EXTENSION = [
  { size: [0.082, 0.070, 0.300], pos: [0, 0.010, 0.415], color: SLEEVE },
];

// Model geometry is shared between every hand and built once per item id: two
// hands and a hotbar you cycle through would otherwise churn geometry forever.
const modelCache = new Map();
function cached(key, build) {
  let geo = modelCache.get(key);
  if (!geo) { geo = build(); modelCache.set(key, geo); }
  return geo;
}

/**
 * The empty off hand. Mirrored by rebuilding the boxes rather than by scaling
 * x negative, which would flip every triangle's winding and cull the lot.
 */
export function offHandMesh() {
  const geo = cached('offhand', () => mergeBoxes(
    HAND.map((p) => ({ ...p, pos: [-p.pos[0], p.pos[1], p.pos[2]] })),
  ));
  return new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
}

/** Boxes for a tool, handle up +Y with the head on top. */
function toolParts(kind, metal) {
  // The shaft runs well below the grip on purpose: a handle that stops at the
  // fist reads as stuck to the top of it, where one whose butt pokes out the
  // bottom reads as gripped.
  const shaft = { size: [0.030, 0.310, 0.030], pos: [0, 0.062, 0], color: WOOD };
  switch (kind) {
    case 'pickaxe': return [shaft,
      { size: [0.070, 0.032, 0.032], pos: [0, 0.206, 0], color: metal },
      // The two arms droop away from the centre, giving the head its crescent.
      { size: [0.078, 0.026, 0.026], pos: [-0.069, 0.191, 0], rot: [0, 0, 0.42], color: metal },
      { size: [0.078, 0.026, 0.026], pos: [0.069, 0.191, 0], rot: [0, 0, -0.42], color: metal },
    ];
    case 'axe': return [shaft,
      { size: [0.032, 0.048, 0.030], pos: [0.014, 0.202, 0], color: metal },  // shoulder
      { size: [0.046, 0.110, 0.030], pos: [0.046, 0.168, 0], color: metal },  // cheek
      { size: [0.020, 0.140, 0.026], pos: [0.079, 0.166, 0], color: metal },  // edge
    ];
    case 'shovel': return [shaft,
      { size: [0.034, 0.044, 0.028], pos: [0, 0.188, 0], color: metal },      // socket
      { size: [0.092, 0.096, 0.020], pos: [0, 0.230, 0], color: metal },      // blade
    ];
    case 'sword': return [
      { size: [0.026, 0.115, 0.026], pos: [0, 0.005, 0], color: WOOD },
      { size: [0.034, 0.030, 0.034], pos: [0, -0.060, 0], color: metal },     // pommel
      { size: [0.125, 0.028, 0.034], pos: [0, 0.074, 0], color: 0x5c431f },   // crossguard
      { size: [0.046, 0.250, 0.016], pos: [0, 0.215, 0], color: metal },      // blade
      { size: [0.020, 0.044, 0.016], pos: [0, 0.356, 0], color: metal },      // point
    ];
    default: return [shaft];
  }
}

/** A bow: seven tangent segments around an arc, strung across the chord. */
function bowParts() {
  const R = 0.19;
  const parts = [{ size: [0.030, 0.075, 0.030], pos: [0.002, 0, 0], color: WOOD }];
  for (let i = -3; i <= 3; i++) {
    const a = i * 0.30;
    parts.push({
      size: [0.020, 0.062, 0.020],
      pos: [Math.cos(a) * R - R, Math.sin(a) * R, 0],
      rot: [0, 0, a],
      color: 0x8a6636,
    });
  }
  const tip = Math.sin(0.9) * R;
  parts.push({ size: [0.006, tip * 2, 0.006], pos: [Math.cos(0.9) * R - R, 0, 0], color: 0xe4e4ea });
  return parts;
}

const bowGeometry = () => mergeBoxes(bowParts());

export class HeldItem {
  /**
   * swing/bob scale the two animations. The desktop view model wants both; a
   * tracked VR hand wants almost none, because your real arm is doing the work
   * and moving the virtual hand away from it reads as lag.
   */
  constructor(atlas, {
    swing = 1, bob = 1, tilt = -Math.PI / 2 + 0.22, tracked = false, limb = [0, 0, 0],
  } = {}) {
    this.atlas = atlas;
    this.swingScale = swing;
    this.bobScale = bob;
    this.tracked = tracked;

    this.group = new THREE.Group();          // the mount positions this
    // Swings turn about the elbow, not the wrist. Pivoting at the fist throws
    // the forearm up across the view instead of arcing the hand down.
    this.pivot = new THREE.Group();
    this.pivot.position.z = ELBOW;
    this.arm = new THREE.Group();
    this.arm.position.z = -ELBOW;
    this.group.add(this.pivot);
    this.pivot.add(this.arm);

    // Three materials cover every model, so switching items allocates nothing
    // but the meshes themselves.
    this.partsMaterial = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.blockMaterial = new THREE.MeshLambertMaterial({ map: atlas.texture });
    this.glassMaterial = new THREE.MeshLambertMaterial({
      map: atlas.texture, transparent: true, opacity: 0.75,
    });

    // The limb turns on its own, independently of what the fist is holding. A
    // tracked hand leaves this at zero and the arm points straight back down the
    // grip; on screen it swings out so the forearm leaves frame at the corner
    // instead of vanishing end-on into the near plane.
    const boxes = tracked ? HAND : [...HAND, ...ARM_EXTENSION];
    this.limb = new THREE.Group();
    this.limb.rotation.set(limb[0], limb[1], limb[2]);
    this.limb.add(new THREE.Mesh(
      cached(tracked ? 'hand' : 'armed-hand', () => mergeBoxes(boxes)),
      this.partsMaterial,
    ));
    this.arm.add(this.limb);

    // Items are modelled along +Y; this turns that into "out of the fist". A
    // tracked hand wants that nearly square to the palm, a screen view model
    // wants it far shallower so the item reads across the frame.
    this.itemRoot = new THREE.Group();
    this.itemRoot.rotation.x = tilt;
    this.itemRoot.position.set(0, 0.012, -0.02);
    this.arm.add(this.itemRoot);

    this.model = null;
    this.id = -1;
    this.phase = 0;              // 0..1 through one swing arc
    this.swinging = false;
    this.walk = 0;
  }

  /** Rebuilds only when the selection actually changes. */
  setItem(id) {
    if (id === this.id) return;
    this.id = id;
    if (this.model) {
      this.itemRoot.remove(this.model);     // geometry is cached, not disposed
      this.model = null;
    }
    if (!id) return;
    this.model = this.buildModel(id);
    this.itemRoot.add(this.model);
  }

  buildModel(id) {
    const def = block(id);
    const g = new THREE.Group();

    if (def.tool) {
      g.add(new THREE.Mesh(
        cached(`tool${id}`, () => mergeBoxes(toolParts(def.tool.kind, TIER_COLOR[def.tool.tier]))),
        this.partsMaterial,
      ));
      // Every head is modelled flat in the xy plane; this turns that face
      // towards you, which is what makes an axe read as an axe and not a stick.
      g.rotation.y = 0.55;
      g.rotation.z = 0.12;                    // a shade off vertical looks held
      return g;
    }

    if (id === BOW) {
      const stave = new THREE.Mesh(cached('bow', bowGeometry), this.partsMaterial);
      // Tracked, the stave sits square to where you are aiming. On screen it is
      // turned towards you instead, or the whole bow reads as a stick.
      stave.rotation.y = this.tracked ? -Math.PI / 2 : 0.30;
      g.add(stave);
      // A bow is not gripped like a rod: whatever angle the item sits at, the
      // limbs stay upright across the fist.
      g.rotation.x = -this.itemRoot.rotation.x - 0.20;
      // On screen the fist is also rolled towards you, and the stave has to roll
      // back by the same amount or the bow lies on its side across the view.
      if (!this.tracked) g.rotation.z = 0.45;
      return g;
    }

    // Only full cubes are held as cubes. A torch, door or slab held as a solid
    // block would be a lie about its shape, and their tiles have transparent
    // backgrounds that a plain cube face cannot show, so they fall through to
    // the extruded icon below.
    if (isPlaceable(id) && def.shape === 'cube') {
      const cube = new THREE.Mesh(
        cached(`cube${id}`, () => blockCubeGeometry(def.faces)),
        def.blend ? this.glassMaterial : this.blockMaterial,
      );
      cube.scale.setScalar(0.135);
      // Low enough that the fist overlaps its near-bottom corner. Floated clear
      // of the hand it reads as a block following you around, not one you hold.
      cube.position.set(-0.01, 0.055, 0.01);
      // Turned so a corner leads and the top face shows: three faces visible is
      // what tells grass from dirt at a glance.
      cube.rotation.set(0.45, 0.6, 0);
      g.add(cube);
      return g;
    }

    // Food, ingots, sticks: the icon extruded into a solid, stood up in the fist.
    const icon = new THREE.Mesh(
      iconGeometry(this.atlas.canvas, def.faces[0]),
      this.partsMaterial,
    );
    icon.position.y = 0.10;
    icon.rotation.y = 0.35;
    g.add(icon);
    return g;
  }

  /**
   * swinging: held down on something breakable. pulse: a one-off action such as
   * placing or landing a hit, which gets a full arc of its own.
   */
  update(dt, { swinging = false, pulse = false, speed = 0 } = {}) {
    if (pulse) this.phase = 0.001;
    this.swinging = swinging;

    if (this.phase > 0 || swinging) {
      this.phase += dt * 3.2;
      if (this.phase >= 1) this.phase = swinging ? this.phase - 1 : 0;
    }

    const s = this.phase > 0 ? Math.sin(this.phase * Math.PI) : 0;
    const a = s * this.swingScale;
    // Split between elbow and wrist: the elbow alone drops the fist clean out
    // of frame at full swing, the wrist alone barely moves the tool.
    this.pivot.rotation.x = -a * 0.42;
    this.pivot.rotation.z = a * 0.18;
    this.arm.rotation.x = -a * 0.50;

    // Idle sway and a walking bob, both small enough to read as life not drift.
    this.walk += dt * Math.min(speed, 6) * 1.9;
    const b = this.bobScale;
    this.pivot.position.x = Math.sin(this.walk) * 0.012 * b;
    this.pivot.position.y = Math.abs(Math.cos(this.walk)) * -0.014 * b;
    this.pivot.rotation.z += Math.sin(this.walk * 0.5) * 0.03 * b;
  }
}

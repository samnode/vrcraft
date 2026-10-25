// Entry point: renderer and XR setup, input mapping for both controllers and
// keyboard/mouse, and the frame loop that drives every subsystem.

import * as THREE from '../vendor/three/three.module.js?v=37';
import { VRButton } from '../vendor/three/jsm/webxr/VRButton.js?v=37';

import { buildAtlas } from './textures.js?v=37';
import { HeldItem, offHandMesh } from './held.js?v=37';
import { DroppedItems } from './items.js?v=37';
import { Terrain } from './terrain.js?v=37';
import { Player } from './player.js?v=37';
import { Inventory } from './inventory.js?v=37';
import { Survival } from './survival.js?v=37';
import { Mobs } from './mobs.js?v=37';
import { Interactor } from './interact.js?v=37';
import { Particles } from './fx.js?v=37';
import { Hud, formatClock } from './ui.js?v=37';
import { CraftUI } from './craftui.js?v=37';
import { RECIPES, craft, nearbyStations } from './crafting.js?v=37';
import { Sky } from './sky.js?v=37';
import { block, PORTAL, END_PORTAL, DRAGON_EGG } from './blocks.js?v=37';
import { sfx } from './sfx.js?v=37';
import { SEA_LEVEL, BIOME_NAMES, DIM } from './world.js?v=37';
import {
  mapCoords, findPortal, buildPortal, endArrival, buildExitPortal,
} from './portal.js?v=37';

// Continuous stick turning. Raise for faster rotation; some people find anything
// above ~160 deg/s uncomfortable in a headset.
const TURN_SPEED = THREE.MathUtils.degToRad(120);   // radians per second at full deflection
const TURN_DEADZONE = 0.15;
// Bumped on each deploy. GitHub Pages caches assets for 10 minutes, so this is
// how you tell at a glance whether a headset is running the build you expect.
const BUILD = 'build 37';
const VIEW_CHUNKS = 4;
// The Nether is drawn closer in. Every column down there has a floor and a roof
// and often a pillar between them, so a chunk carries far more geometry than a
// landscape does, and the dense fog it is seen through hides the shorter view.
const NETHER_CHUNKS = 3;
// The End is mostly void, so a chunk there carries almost no geometry and the
// view can run further out than anywhere else without costing anything.
const END_CHUNKS = 5;
// How long you have to stand in a portal before it takes you, and how much
// faster that is in creative, where nobody wants to wait to go and look.
const PORTAL_DELAY = 1.2;
const PORTAL_DELAY_CREATIVE = 0.35;
// Lava burns at roughly Minecraft's rate: a few seconds to kill an unarmoured
// player, survivable in a full set of iron if you get out immediately.
const LAVA_DAMAGE = 7;

const panel = document.getElementById('panel');
const statusEl = document.getElementById('status');
const crosshair = document.getElementById('crosshair');

// ---------------------------------------------------------------- renderer

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(1);                       // Quest is fill-rate bound; 1 is right
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local-floor');
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.05, 400);
camera.position.set(0, 1.62, 0);                 // desktop eye height; XR overrides this

const rig = new THREE.Group();
rig.add(camera);
scene.add(rig);

// Mobs and held items use three's standard materials, so they need real lights.
const sun = new THREE.DirectionalLight(0xffffff, 1.6);
sun.position.set(0.5, 1, 0.3);
scene.add(sun);
const ambient = new THREE.HemisphereLight(0xcfe3ff, 0x4a4436, 0.75);
scene.add(ambient);

const atlas = buildAtlas();
const sky = new Sky(scene);

// ---------------------------------------------------------------- game state

// armorPoints is read lazily because the inventory is built just below this.
const survival = new Survival({
  onDeath: () => { sfx.hurt(); respawn(); },
  armorPoints: () => inventory.armorPoints(),
});
const inventory = new Inventory({ creative: true });
const particles = new Particles(scene);

// ---------------------------------------------------------------- dimensions

/**
 * One dimension: its terrain, its mobs, and whatever is lying on its ground.
 * Both dimensions stay resident for the whole session. Only the active one is
 * simulated and drawn; the other keeps its voxels, its herds and your grave
 * exactly where they were, frozen until you come back through the portal. That
 * is the only reason a house you build is still standing when you return.
 */
function makeDimension(name, opts) {
  const dimTerrain = new Terrain(scene, atlas.texture, opts);
  const dimMobs = new Mobs(scene, dimTerrain.world, survival);
  const dimItems = new DroppedItems(scene, dimTerrain.world, atlas);
  // Loot lands on the ground of the dimension it was dropped in, which is why
  // each set of mobs is wired to its own pile rather than to a shared one.
  dimMobs.onDrop = (id, count, position) => {
    particles.burst(position, 0xd98d88, 8, 2.0);
    dimItems.drop(id, count, position);
  };
  dimMobs.onExplode = onExplode;
  dimMobs.onBossDeath = onDragonDeath;
  // A thrown pearl takes you to wherever it stopped. The jolt is Minecraft's
  // and it is the whole cost of the trick.
  dimMobs.arrows.onPearlLand = (position) => {
    particles.burst(position, 0x3fcf9a, 18, 2.4);
    player.position.set(position.x, position.y + 0.1, position.z);
    player.velocity.set(0, 0, 0);
    player.headTracked = false;
    player.syncRig();
    survival.damage(2, 'the jolt', { armored: false });
  };
  return { name, terrain: dimTerrain, mobs: dimMobs, items: dimItems };
}

const DIMENSIONS = {
  [DIM.OVERWORLD]: makeDimension(DIM.OVERWORLD, {
    radius: VIEW_CHUNKS, fogColor: 0x9fc4e8,
  }),
  [DIM.NETHER]: makeDimension(DIM.NETHER, {
    kind: DIM.NETHER, radius: NETHER_CHUNKS, seed: 77140211,
    // Fog starting much closer in, and an ambient floor so the place is dim
    // rather than black: there is no sky light at all under that roof, so
    // without this the Nether renders as an entirely black screen. The triple is
    // a multiplier where 1.0 is an overworld surface at noon, tilted red.
    fogColor: 0x8c5549, fogNearFraction: 0.30, ambient: [0.62, 0.42, 0.40],
  }),
  [DIM.END]: makeDimension(DIM.END, {
    kind: DIM.END, radius: END_CHUNKS, seed: 51220831,
    // The End does have sky light, so its surfaces are lit from above as the
    // overworld's are — the sky is simply black. The ambient here is only for
    // undersides and the inside of a tunnel, and it is cold rather than warm.
    fogColor: 0x2a2440, fogNearFraction: 0.55, ambient: [0.16, 0.15, 0.24],
  }),
};

const overworld = DIMENSIONS[DIM.OVERWORLD];
const theEnd = DIMENSIONS[DIM.END];
// One dragon per world, and only one ever. Killing it opens the way home, and
// the flag is what stops a second one appearing the next time you step through.
let dragonSlain = false;
// Reassigned by setDimension. Everything below reads these rather than holding a
// dimension of its own, so there is exactly one place that knows where you are.
let dim = overworld;
let terrain = dim.terrain;
let mobs = dim.mobs;
let items = dim.items;

const player = new Player(terrain.world, rig, camera);
const interactor = new Interactor(scene, terrain, player, inventory, survival, mobs, particles);
const hud = new Hud(atlas.canvas);
hud.attachToDom(document.body);

const craftUI = new CraftUI(atlas.canvas);
craftUI.attachToDom(document.body);
scene.add(craftUI.panel);
let stations = { table: false, furnace: false };
let stationTimer = 0;

player.onFallDamage = (amount) => {
  survival.damage(amount, 'the fall');
  sfx.hurt();
};

// A block mined with a full inventory lands at your feet instead of evaporating.
interactor.onDropExcess = (id, count) => {
  items.drop(id, count, player.position.clone().add(new THREE.Vector3(0, 0.6, 0)), { scatter: 0.6 });
};

function onExplode(position, radius, cause = 'a creeper') {
  particles.burst(position, 0x3a3a3a, 60, 7.5);
  particles.burst(position, 0xffa040, 30, 5.5);
  // Everything within the blast takes damage, falling off with distance.
  const d = player.position.distanceTo(position);
  if (d < radius + 1.5) survival.damage(Math.round(14 * (1 - d / (radius + 1.5))), cause);
}
interactor.onNotify = (text) => survival.note(text);

// Spawn on dry land near the origin.
const spawn = findSpawn();
terrain.prime(spawn.x, spawn.z, 1);
player.spawn(spawn.x, spawn.z);

function findSpawn() {
  for (let r = 0; r < 64; r += 4) {
    for (let a = 0; a < 8; a++) {
      const x = Math.round(Math.cos(a) * r);
      const z = Math.round(Math.sin(a) * r);
      if (terrain.world.terrainHeight(x, z) > SEA_LEVEL + 2) return { x, z };
    }
  }
  return { x: 0, z: 0 };
}

function respawn() {
  // Everything you had falls where you died and waits there. Death drops never
  // time out, because the whole point is that you can walk back for them — and
  // if you died in the Nether they stay in the Nether, which is a longer walk.
  const grave = player.position.clone().add(new THREE.Vector3(0, 0.8, 0));
  const diedIn = dim.name;
  const stacks = inventory.takeAll();
  items.dropStacks(stacks, grave);
  survival.revive();
  // You always wake up in the overworld, wherever you fell.
  setDimension(overworld);
  player.spawn(spawn.x, spawn.z);
  if (stacks.length) {
    const at = `${Math.round(grave.x)}, ${Math.round(grave.y)}, ${Math.round(grave.z)}`;
    const where = diedIn === DIM.OVERWORLD ? ''
      : (diedIn === DIM.NETHER ? ' in the Nether' : ' in the End');
    survival.note(`You dropped ${stacks.length} stacks at ${at}${where}.`);
  } else {
    survival.note('Respawned at your spawn point.');
  }
}

// ---------------------------------------------------------------- travel

// Chunk work allowed per frame. Held here rather than on a Terrain because it is
// a property of the device, not of the dimension, and has to survive a switch.
let chunkBudgetMs = 6;

/**
 * Move the player between dimensions. Everything that holds a world — collision,
 * the mobs, the things lying on the ground, the block interactor — is repointed
 * here, which is the whole reason those are module-level bindings rather than a
 * copy inside each subsystem.
 */
function setDimension(next) {
  if (next === dim) return;
  dim.terrain.sleep();
  dim.items.setActive(false);
  dim.mobs.setActive(false);

  dim = next;
  terrain = dim.terrain;
  mobs = dim.mobs;
  items = dim.items;

  terrain.budgetMs = chunkBudgetMs;
  terrain.wake();
  items.setActive(true);
  mobs.setActive(true);
  player.world = terrain.world;
  interactor.setTerrain(terrain);
  interactor.mobs = mobs;

  sky.setKind(dim.name);
  // The scene lights exist for mobs and held items, which carry no baked light.
  // In the Nether they come up off the floor rather than down from a sun; in
  // the End there is no source at all, so they are flat and faintly violet.
  const lit = DIMENSION_LIGHT[dim.name];
  sun.color.set(lit.sun);
  sun.position.set(0.5, lit.from, 0.3);
  ambient.color.set(lit.ambient);
  ambient.groundColor.set(lit.ground);
}

// Per-dimension settings for the two scene lights. `from` is the directional
// light's height: positive for a sun overhead, negative for light off a floor.
const DIMENSION_LIGHT = {
  [DIM.OVERWORLD]: { sun: 0xffffff, from: 1,    ambient: 0xcfe3ff, ground: 0x4a4436 },
  [DIM.NETHER]:    { sun: 0xffb27a, from: -0.8, ambient: 0x8a3524, ground: 0x5a221a },
  [DIM.END]:       { sun: 0xd8ccf0, from: 0.7,  ambient: 0xa79cd0, ground: 0x2e2a44 },
};

/**
 * The portal the player is standing in, or 0. Ankles or chest counts, and which
 * kind it is decides where stepping through goes.
 */
function portalUnderfoot() {
  const p = player.position;
  const w = terrain.world;
  const x = Math.floor(p.x), z = Math.floor(p.z);
  for (const y of [Math.floor(p.y + 0.2), Math.floor(p.y + 1.2)]) {
    const id = w.get(x, y, z);
    if (id === PORTAL || id === END_PORTAL) return id;
  }
  return 0;
}

let portalHold = 0;
// Re-armed only once you are clear of a portal. Arriving leaves you standing
// inside one, and without this the next frame would send you straight back.
let portalArmed = true;

function updatePortal(dt) {
  const kind = portalUnderfoot();
  if (!kind) {
    portalHold = 0;
    portalArmed = true;
    return;
  }
  if (!portalArmed) return;
  portalHold += dt;
  // An End portal takes you the moment you fall into it, as Minecraft's does:
  // there is no standing in one, it is a hole in the floor.
  const delay = kind === END_PORTAL ? 0.15
    : (inventory.creative ? PORTAL_DELAY_CREATIVE : PORTAL_DELAY);
  if (portalHold < delay) return;
  portalHold = 0;
  portalArmed = false;
  if (kind === END_PORTAL) travelEnd(); else travelNether();
}

/**
 * Step through. The destination is the same place at a different scale — one
 * block here is eight over there, which is the entire reason to use the Nether
 * to get somewhere. If no portal is waiting at the far end, one is built:
 * arriving is not allowed to fail, because a player who lands inside rock or
 * falls out of the world has no way of understanding what went wrong.
 */
function travelNether() {
  const toNether = dim === overworld;
  const target = mapCoords(player.position.x, player.position.z, toNether);
  setDimension(DIMENSIONS[toNether ? DIM.NETHER : DIM.OVERWORLD]);

  // The destination chunks have to exist before anything can be read out of
  // them or written into them, and a portal is four blocks wide.
  terrain.prime(target.x, target.z, 1);
  const spot = findPortal(terrain.world, target.x, target.z)
    ?? buildPortal(terrain.world, target.x, target.z);
  // Anything just built has dirtied a chunk or two; this picks up only those.
  terrain.prime(spot.x, spot.z, 1);

  player.position.set(spot.x, spot.y + 0.1, spot.z);
  player.velocity.set(0, 0, 0);
  player.headTracked = false;
  player.syncRig();

  sfx.sleep();
  survival.note(toNether
    ? `The Nether. ${Math.round(spot.x)}, ${Math.round(spot.z)}.`
    : `Back in the overworld. ${Math.round(spot.x)}, ${Math.round(spot.z)}.`);
}

/**
 * Into the End and back. Unlike the Nether there is no scaling and no pairing:
 * the End is one fixed place at fixed coordinates, you always arrive on the
 * same island, and the way home is the exit portal rather than the one you came
 * in by — which is why coming back puts you at your spawn point.
 */
function travelEnd() {
  if (dim === theEnd) {
    setDimension(overworld);
    terrain.prime(spawn.x, spawn.z, 1);
    player.spawn(spawn.x, spawn.z);
    sfx.sleep();
    survival.note('Home, and the dragon is dead.');
    return;
  }

  setDimension(theEnd);
  // The island has to exist before anything can be read off it, and the arrival
  // search looks out as far as its rim.
  terrain.prime(0, 0, 3);
  const spot = endArrival(terrain.world);
  player.position.set(spot.x, spot.y + 0.1, spot.z);
  player.velocity.set(0, 0, 0);
  player.headTracked = false;
  player.syncRig();
  terrain.prime(spot.x, spot.z, 1);

  if (!dragonSlain && !mobs.boss) summonDragon();
  sfx.sleep();
  survival.note(dragonSlain ? 'The End. Quiet now.' : 'The End. Something is circling.');
}

/** Put the dragon on its orbit, high over the middle of the island. */
function summonDragon() {
  const d = mobs.spawn('dragon', 36, 52, 0);
  if (d) d.orbit = 0;
}

/**
 * The dragon going down is the one scripted event in the game: it opens the way
 * home and leaves the egg behind. Both are built at the island's centre, where
 * the ring of pillars has been pointing the whole time.
 */
function onDragonDeath(mob) {
  dragonSlain = true;
  particles.burst(mob.center, 0xc05de0, 90, 6.0);
  particles.burst(mob.center, 0xffffff, 40, 4.0);
  sfx.explode();

  const exit = buildExitPortal(theEnd.terrain.world);
  theEnd.terrain.world.set(Math.floor(exit.x), exit.y + 1, Math.floor(exit.z), DRAGON_EGG);
  theEnd.terrain.prime(exit.x, exit.z, 1);
  survival.note(`The dragon falls. A way home opens at ${Math.round(exit.x)}, ${Math.round(exit.z)}.`);
}

// ---------------------------------------------------------------- controllers

const controllers = [];
const grips = [];

// What you are carrying, held in the right fist. Barely any swing or bob in VR:
// your real arm is doing that, and moving the virtual hand off the tracked one
// is what makes a held object feel like it is lagging behind you.
const vrHand = new HeldItem(atlas, { swing: 0.22, bob: 0, tracked: true });

for (let i = 0; i < 2; i++) {
  // Two spaces per controller: the aim ray wants where you are pointing, a held
  // object wants where your hand actually is. WebXR exposes them separately.
  const controller = renderer.xr.getController(i);
  const grip = renderer.xr.getControllerGrip(i);
  controller.addEventListener('connected', (event) => {
    controller.userData.inputSource = event.data;
    controller.userData.hand = event.data.handedness;
    grip.userData.hand = event.data.handedness;
    buildControllerVisual(controller, grip, event.data.handedness);
  });
  controller.addEventListener('disconnected', () => {
    controller.userData.inputSource = null;
    controller.clear();
    grip.clear();
  });
  rig.add(controller);
  rig.add(grip);
  controllers.push(controller);
  grips.push(grip);
}

function buildControllerVisual(controller, grip, handedness) {
  controller.clear();
  grip.clear();

  if (handedness === 'right') {
    // Aiming ray: short, thin, and dimmed so it does not dominate the view.
    const geo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1),
    ]);
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.35,
    }));
    line.scale.z = 6;
    controller.add(line);
    // A grip space is already fist-shaped: origin in the palm, -z out along
    // whatever you are holding. The model is authored to match, so it mounts
    // with no fitting at all.
    grip.add(vrHand.group);
  } else {
    // The wrist panel stays in the controller space it was tuned for; only the
    // hand moves to the grip, which is where a hand belongs.
    controller.add(hud.panel);
    hud.panel.visible = renderer.xr.isPresenting;
    grip.add(offHandMesh());
  }
}

function controllerByHand(hand) {
  return controllers.find((c) => c.userData.hand === hand) || null;
}

// ---------------------------------------------------------------- view model

// Outside VR there is no tracked hand, so the same models are drawn into a
// second, tiny scene laid over the frame. That overlay pass is why the tool
// never clips into a wall you are standing against.
const viewHand = new HeldItem(atlas, { swing: 1, bob: 1, tilt: -0.68, limb: [0.80, 0.52, -0.95] });
const viewScene = new THREE.Scene();
const viewCamera = new THREE.PerspectiveCamera(70, 1, 0.01, 2);
const viewSun = new THREE.DirectionalLight(0xffffff, 1.5);
viewSun.position.set(-0.4, 0.8, 0.6);
const viewAmbient = new THREE.HemisphereLight(0xcfe3ff, 0x4a4436, 0.8);
viewScene.add(viewSun, viewAmbient, viewHand.group);
// Tuned by eye against the frame: the forearm has to leave the bottom-right
// corner and the fist has to sit low enough that the tool crosses open view,
// not the HUD.
viewHand.group.position.set(0.21, -0.17, -0.48);
viewHand.group.rotation.set(0.14, -0.50, -0.30);

function refreshHands() {
  const id = inventory.selectedSlot ? inventory.selectedSlot.id : 0;
  vrHand.setItem(id);
  viewHand.setItem(id);
}

// ---------------------------------------------------------------- input

const keys = new Set();
const mouse = { yaw: 0, pitch: 0, breaking: false, placing: false, locked: false };
const edge = { prev: {} };

function pressedOnce(name, down) {
  const was = !!edge.prev[name];
  edge.prev[name] = down;
  return down && !was;
}

function gatherVrInput(dt) {
  const left = controllerByHand('left');
  const right = controllerByHand('right');
  const padOf = (c) => (c && c.userData.inputSource && c.userData.inputSource.gamepad) || null;
  const lp = padOf(left), rp = padOf(right);

  const input = {
    move: { x: 0, z: 0 },
    jump: false, sprint: false, sneak: false,
    breaking: false, placing: false, turn: 0,
  };

  if (lp) {
    // xr-standard puts the thumbstick on axes 2 and 3.
    const ax = lp.axes[2] ?? 0, ay = lp.axes[3] ?? 0;
    if (Math.abs(ax) > 0.15) input.move.x = ax;
    if (Math.abs(ay) > 0.15) input.move.z = -ay;
    input.sprint = (lp.buttons[3]?.pressed) ?? false;         // stick click
    input.placing = pressed(lp, 0);
    if (pressedOnce('craft', pressed(lp, 1))) setCraftingOpen(!craftUI.open);
    if (pressedOnce('x', pressed(lp, 4))) inventory.cycle(-1);
    if (pressedOnce('y', pressed(lp, 5))) toggleFlight();
  }

  if (rp) {
    input.breaking = pressed(rp, 0);
    if (pressed(rp, 1)) input.placing = true;                  // right grip also places
    input.jump = pressed(rp, 4);
    if (pressedOnce('b', pressed(rp, 5))) inventory.cycle(1);
    // Clicking the right stick jumps a whole page of the creative palette.
    // Stepping one block at a time still reaches everything, but there are
    // forty-eight of them and a headset has no digit keys to shortcut with.
    if (pressedOnce('rstick', pressed(rp, 3))) inventory.cyclePage(1);

    // While flying, the right stick's vertical axis is free for altitude.
    if (player.flying) {
      const ty = rp.axes[3] ?? 0;
      if (ty < -0.5) input.jump = true;
      else if (ty > 0.5) input.sneak = true;
    }

    // Smooth turn, with the deflection curved so small nudges aim finely and the
    // stick still reaches full speed at the rim.
    const tx = rp.axes[2] ?? 0;
    const mag = Math.abs(tx);
    if (mag > TURN_DEADZONE) {
      const scaled = (mag - TURN_DEADZONE) / (1 - TURN_DEADZONE);
      input.turn = -Math.sign(tx) * scaled * scaled * TURN_SPEED * dt;
    }
  }

  return input;
}

function pressed(pad, index) {
  const b = pad.buttons[index];
  return !!b && (b.pressed || b.value > 0.5);
}

function gatherDesktopInput() {
  const input = {
    move: { x: 0, z: 0 },
    jump: keys.has('Space'),
    sprint: keys.has('ShiftLeft') || keys.has('ShiftRight'),
    sneak: keys.has('ControlLeft'),
    breaking: mouse.breaking,
    placing: mouse.placing,
    turn: 0,
  };
  // Arrow keys are the documented controls. WASD stays wired up as a silent
  // alias, because unlearning it costs anyone who already plays that way.
  if (keys.has('ArrowUp') || keys.has('KeyW')) input.move.z += 1;
  if (keys.has('ArrowDown') || keys.has('KeyS')) input.move.z -= 1;
  if (keys.has('ArrowRight') || keys.has('KeyD')) input.move.x += 1;
  if (keys.has('ArrowLeft') || keys.has('KeyA')) input.move.x -= 1;
  return input;
}

function setCraftingOpen(on) {
  if (craftUI.open === on) return;
  craftUI.open = on;
  refreshStations();

  if (renderer.xr.isPresenting) {
    craftUI.panel.visible = on;
    if (on) craftUI.positionInFront(camera);
    craftUI.canvas.style.display = 'none';
  } else {
    craftUI.setOpen(on);
    crosshair.style.display = on ? 'none' : 'block';
    // Mouse look owns the cursor, so the pointer lock has to go to click a recipe.
    if (on) document.exitPointerLock();
    else renderer.domElement.requestPointerLock()?.catch?.(() => {});
  }
}

function refreshStations() {
  stations = nearbyStations(terrain.world, player.position, 4);
}

function tryCraft(index) {
  const recipe = RECIPES[index];
  if (!recipe) return;
  if (craft(recipe, inventory, stations)) {
    sfx.pickup();
    survival.note(`Crafted ${block(recipe.out).name}`);
  } else {
    sfx.hit();
  }
}

function toggleFlight() {
  // Flight is a creative-mode tool; survival is meant to be walked.
  if (survival.enabled) { survival.note('No flying in survival'); return; }
  player.flying = !player.flying;
  player.velocity.set(0, 0, 0);
  survival.note(player.flying ? 'Flight on' : 'Flight off');
}

function setCreative(creative) {
  if (inventory.creative === creative) return;
  inventory.setCreative(creative);
  survival.enabled = !creative;
  if (!creative) {
    // Survival starts you whole, on foot, and with an empty inventory to fill.
    survival.revive();
    player.flying = false;
  }
  survival.note(creative ? 'Creative mode' : 'Survival mode');
  if (typeof refreshModeButton === 'function') refreshModeButton();
}

window.addEventListener('keydown', (e) => {
  // Arrows scroll the page by default, which drags the canvas out from under you.
  if (e.code === 'Tab' || e.code.startsWith('Arrow')) e.preventDefault();
  keys.add(e.code);
  if (e.code === 'KeyF') toggleFlight();
  if (e.code === 'KeyE') setCraftingOpen(!craftUI.open);
  if (e.code === 'KeyC') setCreative(!inventory.creative);
  if (e.code === 'Escape') {
    if (craftUI.open) setCraftingOpen(false);
    mouse.locked = false;
  }
  // The palette is paged nine at a time, so the digits alone cannot reach it
  // all. The brackets turn the page; the wheel still rolls through everything.
  if (e.code === 'BracketLeft') inventory.cyclePage(-1);
  if (e.code === 'BracketRight') inventory.cyclePage(1);
  const digit = e.code.match(/^Digit([1-9])$/);
  if (digit) inventory.select(Number(digit[1]) - 1);
});
window.addEventListener('keyup', (e) => keys.delete(e.code));

craftUI.canvas.addEventListener('mousedown', (e) => {
  const i = craftUI.indexAtClientPoint(e.clientX, e.clientY);
  if (i >= 0) tryCraft(i);
  e.preventDefault();
});

renderer.domElement.addEventListener('mousedown', (e) => {
  if (!mouse.locked) return;
  if (e.button === 0) mouse.breaking = true;
  if (e.button === 2) mouse.placing = true;
});
window.addEventListener('mouseup', (e) => {
  if (e.button === 0) mouse.breaking = false;
  if (e.button === 2) mouse.placing = false;
});
window.addEventListener('contextmenu', (e) => e.preventDefault());
window.addEventListener('wheel', (e) => {
  if (mouse.locked) inventory.cycle(Math.sign(e.deltaY));
}, { passive: true });

document.addEventListener('pointerlockchange', () => {
  mouse.locked = document.pointerLockElement === renderer.domElement;
  if (!mouse.locked) mouse.breaking = mouse.placing = false;
  // Opening the crafting panel deliberately drops the lock so the cursor works;
  // that must not be mistaken for the player quitting back to the start screen.
  if (!renderer.xr.isPresenting) showEntry(!mouse.locked && !craftUI.open);
});

document.addEventListener('mousemove', (e) => {
  if (craftUI.open && !renderer.xr.isPresenting) {
    craftUI.hoverIndex = craftUI.indexAtClientPoint(e.clientX, e.clientY);
    return;
  }
  if (!mouse.locked) return;
  mouse.yaw -= e.movementX * 0.0022;
  mouse.pitch -= e.movementY * 0.0022;
  mouse.pitch = THREE.MathUtils.clamp(mouse.pitch, -Math.PI / 2 + 0.01, Math.PI / 2 - 0.01);
});

// ---------------------------------------------------------------- session UI

// The world renders live from the first frame; entering is a single button
// click rather than a full-screen gate. Both buttons use three's VRButton look.
function stylizeEntryButton(el) {
  el.style.border = '1px solid #fff';
  el.style.borderRadius = '4px';
  el.style.background = 'rgba(0,0,0,0.1)';
  el.style.color = '#fff';
  el.style.font = 'normal 13px sans-serif';
  el.style.textAlign = 'center';
  el.style.opacity = '0.5';
  el.style.outline = 'none';
  el.style.cursor = 'pointer';
  el.onmouseenter = () => { el.style.opacity = '1.0'; };
  el.onmouseleave = () => { el.style.opacity = '0.5'; };
}

const entry = document.getElementById('entry');
const vrButton = VRButton.createButton(renderer);
entry.appendChild(vrButton);

const desktopButton = document.createElement('button');
desktopButton.textContent = 'PLAY IN BROWSER';
stylizeEntryButton(desktopButton);
entry.appendChild(desktopButton);

// Mode is chosen here, before entering, because a headset session has no DOM.
const modeButton = document.createElement('button');
stylizeEntryButton(modeButton);
function refreshModeButton() {
  modeButton.textContent = inventory.creative ? 'MODE: CREATIVE' : 'MODE: SURVIVAL';
}
refreshModeButton();
modeButton.addEventListener('click', () => setCreative(!inventory.creative));
entry.appendChild(modeButton);

/**
 * The entry row and help panel are up only while you are not playing. The VR
 * button's own visibility stays three's to manage, so it keeps hiding itself
 * until it knows whether a headset is available.
 */
function showEntry(on) {
  entry.style.display = on ? 'flex' : 'none';
  panel.style.display = on ? '' : 'none';
  hud.setDomVisible(!on);
  // The crosshair belongs to aiming, not to menus.
  crosshair.style.display = (on || craftUI.open) ? 'none' : 'block';
}

hud.setDomVisible(false);

const buildEl = document.createElement('div');
buildEl.textContent = BUILD;
buildEl.style.cssText = 'margin-top:8px;font-size:11px;color:#6f84ab';
panel.appendChild(buildEl);

if (!navigator.xr) {
  statusEl.textContent = 'No WebXR here — desktop mode still works. For the headset, '
    + 'open this page in the Meta Quest Browser over https or localhost.';
} else if (!window.isSecureContext) {
  statusEl.textContent = 'WebXR needs a secure context: serve over https, or use localhost.';
}

desktopButton.addEventListener('click', () => {
  sfx.resume();
  // Pointer lock is refused inside some embedded frames; say so rather than
  // leaving the player looking at a world they cannot move in.
  const request = renderer.domElement.requestPointerLock();
  if (request && typeof request.catch === 'function') {
    request.catch(() => {
      statusEl.textContent = 'This browser refused pointer lock, which mouse look needs. '
        + 'Open the page in its own tab or window and try again.';
    });
  }
});

renderer.xr.addEventListener('sessionstart', () => {
  // A standalone headset has roughly a third of the CPU headroom of a laptop,
  // and a blown frame during a turn reads as the rotation stuttering.
  chunkBudgetMs = 2.5;
  terrain.budgetMs = chunkBudgetMs;
  showEntry(false);
  crosshair.style.display = 'none';
  hud.panel.visible = true;
  camera.rotation.set(0, 0, 0);
  player.headTracked = false;
  sfx.resume();
});

renderer.xr.addEventListener('sessionend', () => {
  chunkBudgetMs = 6;
  terrain.budgetMs = chunkBudgetMs;
  setCraftingOpen(false);
  showEntry(true);
  hud.panel.visible = false;
});

window.addEventListener('resize', resize);
function resize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  viewCamera.aspect = camera.aspect;
  viewCamera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}
resize();

// ---------------------------------------------------------------- frame loop

// Overrides used by the debug handle to drive the game without real input.
const debug = { input: null, forceActive: false };

const pointer = {
  raycaster: new THREE.Raycaster(),
  hoverSlot: -1,
  pressed: false,
  craftPressed: false,
};

const rayOrigin = new THREE.Vector3();
const rayDirection = new THREE.Vector3();
const forward = new THREE.Vector3(0, 0, -1);
let last = performance.now();
let hudTimer = 0;
// Rolling frame time. Smooth rotation still looks like snapping if frames hitch,
// so this is the number that tells the two apart in a headset.
const frameTimes = [];
let fps = 0, worstFrameMs = 0;
let lastSwingPulse = 0;
let worldCalls = 0, worldTriangles = 0;

function aimRay() {
  if (renderer.xr.isPresenting) {
    const right = controllerByHand('right');
    const source = right && right.userData.inputSource ? right : camera;
    source.getWorldPosition(rayOrigin);
    rayDirection.copy(forward).applyQuaternion(source.getWorldQuaternion(new THREE.Quaternion()));
  } else {
    camera.getWorldPosition(rayOrigin);
    rayDirection.copy(forward).applyQuaternion(camera.getWorldQuaternion(new THREE.Quaternion()));
  }
  return { origin: rayOrigin, direction: rayDirection.normalize() };
}

function render() {
  const now = performance.now();
  const raw = now - last;
  const dt = Math.min(raw / 1000, 0.1);
  last = now;

  frameTimes.push(raw);
  if (frameTimes.length > 60) frameTimes.shift();
  if (frameTimes.length) {
    const mean = frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length;
    fps = Math.round(1000 / Math.max(mean, 0.01));
    worstFrameMs = Math.max(...frameTimes);
  }

  frame(dt);
}

function frame(dt) {
  const inVr = renderer.xr.isPresenting;
  const active = inVr || mouse.locked || debug.forceActive;
  const input = debug.input ?? (inVr ? gatherVrInput(dt) : gatherDesktopInput());

  if (!active) {
    input.move.x = input.move.z = 0;
    input.jump = input.breaking = input.placing = false;
  }

  if (!inVr) {
    // Desktop look: yaw lives on the rig, pitch on the camera.
    player.yaw = mouse.yaw;
    camera.rotation.set(mouse.pitch, 0, 0);
    camera.position.set(0, 1.62, 0);
  }

  // Aiming the right controller at the wrist panel picks a block rather than
  // mining, so the two uses of the trigger never collide.
  const overPanel = inVr ? updatePanelPointer(input) : -1;
  if (overPanel >= 0) input.breaking = false;

  if (craftUI.open) {
    // The crafting panel takes the trigger while it is up.
    if (inVr && updateCraftPointer(input)) input.breaking = false;
    input.placing = false;
    stationTimer -= dt;
    if (stationTimer <= 0) { stationTimer = 0.4; refreshStations(); }
    craftUI.draw(inventory, stations);
  }

  survival.update(dt, player);
  survival.tickMessages(dt);
  player.update(dt, input);
  // Standing in lava burns continuously rather than in hits, which is what makes
  // it read as a hazard to get out of rather than a trap you have already lost to.
  if (player.inLava) { survival.damage(dt * LAVA_DAMAGE, 'lava'); particles.burst(
    player.position.clone().add(new THREE.Vector3(0, 0.9, 0)), 0xffa040, 2, 1.6); }
  updatePortal(dt);
  // Falling out of the End would otherwise loop forever in creative: there is
  // no surface below to be put back on, only more void. Survival needs no help
  // here — the void kills you and respawning takes you home.
  if (terrain.world.end && player.position.y < -3 && !survival.enabled) {
    const spot = endArrival(terrain.world);
    player.position.set(spot.x, spot.y + 0.1, spot.z);
    player.velocity.set(0, 0, 0);
    player.syncRig();
    survival.note('The void let you go.');
  }
  terrain.update(player.position);
  mobs.update(dt, player);
  interactor.update(dt, active ? aimRay() : null, input);
  items.update(dt, player, inventory);
  particles.update(dt);
  refreshHands();
  updateHands(dt, inVr);
  updateSky(dt);

  hudTimer -= dt;
  if (hudTimer <= 0) {
    hudTimer = 1 / 15;                                   // 15 Hz is plenty for a HUD
    hud.draw({
      slots: inventory.slots,
      selected: inventory.selected,
      creative: inventory.creative,
      label: inventory.label(),
      page: inventory.pageLabel,
      survival: survival.enabled,
      health: survival.health,
      hunger: survival.hunger,
      armor: inventory.armor,
      armorPoints: inventory.armorPoints(),
      messages: survival.messages,
      boss: bossState(),
      mode: `${inventory.creative ? 'Creative' : 'Survival'}  ${fps} fps`,
      hoverSlot: pointer.hoverSlot,
      clock: formatClock(survival.time),
    });
  }

  renderer.render(scene, camera);
  // renderer.info resets on every render call, so the world's numbers have to
  // be read before the overlay pass overwrites them.
  worldCalls = renderer.info.render.calls;
  worldTriangles = renderer.info.render.triangles;

  if (!inVr) {
    // Drawn over the finished frame with a fresh depth buffer, so the hand sits
    // in front of the world no matter how close you stand to a block.
    renderer.autoClear = false;
    renderer.clearDepth();
    renderer.render(viewScene, viewCamera);
    renderer.autoClear = true;
  }
}

/** The boss bar's contents, or null when nothing is hunting you. */
function bossState() {
  const boss = mobs.boss;
  if (!boss) return null;
  return { name: boss.def.name, health: boss.health, max: boss.def.health };
}

/** Feeds both hands the same swing signals; only the live one is on screen. */
function updateHands(dt, inVr) {
  const pulse = interactor.swingPulse !== lastSwingPulse;
  lastSwingPulse = interactor.swingPulse;
  const speed = Math.hypot(player.velocity.x, player.velocity.z) * (player.onGround ? 1 : 0);
  const signal = { swinging: interactor.swinging, pulse, speed };
  vrHand.update(dt, signal);
  if (inVr) return;
  // The crafting panel floats where the hand would be drawn over it.
  viewHand.group.visible = !craftUI.open;
  viewHand.update(dt, signal);
}

/**
 * Returns the hovered hotbar slot, or -1. A trigger press while hovering selects
 * that block; the press is edge-detected so one pull picks exactly one block.
 */
function updatePanelPointer(input) {
  pointer.hoverSlot = -1;
  const right = controllerByHand('right');
  if (!right || !hud.panel.visible || !hud.panel.parent) return -1;

  right.getWorldPosition(rayOrigin);
  rayDirection.copy(forward).applyQuaternion(right.getWorldQuaternion(new THREE.Quaternion()));
  pointer.raycaster.set(rayOrigin, rayDirection.normalize());
  pointer.raycaster.far = 1.2;                       // arm's length only

  // Raycaster reads matrixWorld directly and will not refresh it itself.
  hud.panel.updateWorldMatrix(true, false);
  const hit = pointer.raycaster.intersectObject(hud.panel, false)[0];
  if (!hit || !hit.uv) { pointer.pressed = input.breaking; return -1; }

  const slot = hud.slotAtUV(hit.uv.x, hit.uv.y);
  pointer.hoverSlot = slot;

  if (slot >= 0 && input.breaking && !pointer.pressed) {
    inventory.select(slot);
    sfx.pickup();
  }
  pointer.pressed = input.breaking;
  return slot;
}

/** Points the right controller at the floating crafting panel in VR. */
function updateCraftPointer(input) {
  craftUI.hoverIndex = -1;
  const right = controllerByHand('right');
  if (!right || !craftUI.panel.visible) return false;

  right.getWorldPosition(rayOrigin);
  rayDirection.copy(forward).applyQuaternion(right.getWorldQuaternion(new THREE.Quaternion()));
  pointer.raycaster.set(rayOrigin, rayDirection.normalize());
  pointer.raycaster.far = 4;

  craftUI.panel.updateWorldMatrix(true, false);
  const hit = pointer.raycaster.intersectObject(craftUI.panel, false)[0];
  if (!hit || !hit.uv) { pointer.craftPressed = input.breaking; return false; }

  const index = craftUI.indexAtUV(hit.uv.x, hit.uv.y);
  craftUI.hoverIndex = index;
  if (index >= 0 && input.breaking && !pointer.craftPressed) tryCraft(index);
  pointer.craftPressed = input.breaking;
  return true;
}

function updateSky(dt) {
  const nether = terrain.world.nether;
  const end = terrain.world.end;
  const light = survival.daylight;
  // Under a rock roof the day/night term has nothing left to multiply, because
  // sky light is zero everywhere down there. Pinning it to one keeps the single
  // uniform honest for the things that are lit: glowstone, lava, and torches.
  // The End has sky light but no sun to vary it, so the term is pinned there
  // too — the darkness of the place is in the sky's colour, not in the hour.
  terrain.uniforms.uDayLight.value = (nether || end) ? 1 : light;
  terrain.uniforms.uTime.value += dt;

  // The sky dome owns the palette now; fog blends the terrain into its horizon
  // so the view distance ends in sky rather than a visible wall of colour.
  const horizon = sky.update(survival.time, light, player.position, dt);
  terrain.uniforms.uFogColor.value.copy(horizon);
  scene.background = null;                    // the dome covers the whole view

  if (nether || end) {
    // Fixed, because neither place has an hour of the day. The directional
    // light stays where setDimension put it: up off the lava in the Nether,
    // and in the End a flat violet that belongs to nothing in particular.
    sun.intensity = nether ? 0.5 : 0.55;
    ambient.intensity = nether ? 0.85 : 0.95;
    return;
  }
  sun.intensity = 0.35 + light * 1.35;
  ambient.intensity = 0.25 + light * 0.6;
  const angle = survival.time * Math.PI * 2;
  sun.position.set(Math.cos(angle) * 0.6, Math.max(0.15, Math.sin(angle)), 0.35);
}

renderer.setAnimationLoop(render);

// Debug handle: handy from the browser console, and used by the test harness.
window.VRCRAFT = {
  renderer, scene, camera, rig, player, inventory, survival,
  interactor, particles, hud, craftUI, sky, controllers, grips, BUILD,
  vrHand, viewHand, viewCamera, DIMENSIONS,
  // These three move when the player changes dimension, so they are read live
  // rather than captured: a stale terrain here would quietly measure the world
  // nobody is standing in.
  get terrain() { return terrain; },
  get mobs() { return mobs; },
  get items() { return items; },
  get dimension() { return dim.name; },
  setCraftingOpen, tryCraft, travelNether, travelEnd, summonDragon,
  goTo(name) { setDimension(DIMENSIONS[name] ?? overworld); },
  get stations() { return stations; },
  // Lets the VR input mapping be exercised without a headset: hand it a fake
  // gamepad through controllers[i].userData and call this directly.
  vrInput: (dt) => gatherVrInput(dt),
  teleport(x, y, z) { player.position.set(x, y, z); player.velocity.set(0, 0, 0); player.syncRig(); },
  /** Run frames at a fixed timestep; lets tests advance the world deterministically. */
  step(dt = 1 / 60, count = 1) { for (let i = 0; i < count; i++) frame(dt); },
  /** Feed a synthetic input object, or pass null to return to real input. */
  setInput(input) { debug.input = input; },
  setActive(on) { debug.forceActive = on; },
  setCreative,
  look(yaw, pitch = 0) { mouse.yaw = yaw; mouse.pitch = pitch; },
  setTime(t) { survival.time = t; },
  stats() {
    return {
      position: player.position.toArray().map((n) => +n.toFixed(2)),
      chunks: terrain.world.chunks.size,
      drawCalls: worldCalls,
      triangles: worldTriangles,
      mobs: mobs.list.length,
      items: items.list.length,
      dimension: dim.name,
      biome: terrain.world.nether ? 'Nether' : (terrain.world.end ? 'The End'
        : BIOME_NAMES[terrain.world.biomeAt(
          Math.floor(player.position.x), Math.floor(player.position.z))]),
      boss: bossState(),
      dragonSlain,
      onGround: player.onGround,
      inLava: player.inLava,
      inPortal: !!portalUnderfoot(),
      build: BUILD,
      fps,
      worstFrameMs: +worstFrameMs.toFixed(1),
      daylight: +survival.daylight.toFixed(2),
      health: survival.health,
      hunger: survival.hunger,
      armor: inventory.armor,
      armorPoints: inventory.armorPoints(),
    };
  },
};

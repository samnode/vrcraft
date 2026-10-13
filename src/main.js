// Entry point: renderer and XR setup, input mapping for both controllers and
// keyboard/mouse, and the frame loop that drives every subsystem.

import * as THREE from '../vendor/three/three.module.js?v=14';
import { VRButton } from '../vendor/three/jsm/webxr/VRButton.js?v=14';

import { buildAtlas } from './textures.js?v=14';
import { HeldItem, offHandMesh } from './held.js?v=14';
import { Terrain } from './terrain.js?v=14';
import { Player } from './player.js?v=14';
import { Inventory } from './inventory.js?v=14';
import { Survival } from './survival.js?v=14';
import { Mobs } from './mobs.js?v=14';
import { Interactor } from './interact.js?v=14';
import { Particles } from './fx.js?v=14';
import { Hud, formatClock } from './ui.js?v=14';
import { CraftUI } from './craftui.js?v=14';
import { RECIPES, craft, nearbyStations } from './crafting.js?v=14';
import { Sky } from './sky.js?v=14';
import { block } from './blocks.js?v=14';
import { sfx } from './sfx.js?v=14';
import { SEA_LEVEL } from './world.js?v=14';

// Continuous stick turning. Raise for faster rotation; some people find anything
// above ~160 deg/s uncomfortable in a headset.
const TURN_SPEED = THREE.MathUtils.degToRad(120);   // radians per second at full deflection
const TURN_DEADZONE = 0.15;
// Bumped on each deploy. GitHub Pages caches assets for 10 minutes, so this is
// how you tell at a glance whether a headset is running the build you expect.
const BUILD = 'build 14';
const VIEW_CHUNKS = 4;

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
const terrain = new Terrain(scene, atlas.texture, { radius: VIEW_CHUNKS, fogColor: 0x9fc4e8 });

const sky = new Sky(scene);

// ---------------------------------------------------------------- game state

const survival = new Survival({ onDeath: () => { sfx.hurt(); respawn(); } });
const player = new Player(terrain.world, rig, camera);
const inventory = new Inventory({ creative: true });
const particles = new Particles(scene);
const mobs = new Mobs(scene, terrain.world, survival);
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

mobs.onDrop = (id, count, position) => {
  particles.burst(position, 0xd98d88, 8, 2.0);
  interactor.collect(id, count);
};

mobs.onExplode = (position, radius) => {
  particles.burst(position, 0x3a3a3a, 60, 7.5);
  particles.burst(position, 0xffa040, 30, 5.5);
  // Everything within the blast takes damage, falling off with distance.
  const d = player.position.distanceTo(position);
  if (d < radius + 1.5) survival.damage(Math.round(14 * (1 - d / (radius + 1.5))), 'a creeper');
};
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
  survival.revive();
  player.spawn(spawn.x, spawn.z);
  survival.note('Respawned at your spawn point.');
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
  terrain.budgetMs = 2.5;
  showEntry(false);
  crosshair.style.display = 'none';
  hud.panel.visible = true;
  camera.rotation.set(0, 0, 0);
  player.headTracked = false;
  sfx.resume();
});

renderer.xr.addEventListener('sessionend', () => {
  terrain.budgetMs = 6;
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
  terrain.update(player.position);
  mobs.update(dt, player);
  interactor.update(dt, active ? aimRay() : null, input);
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
      survival: survival.enabled,
      health: survival.health,
      hunger: survival.hunger,
      messages: survival.messages,
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
  const light = survival.daylight;
  terrain.uniforms.uDayLight.value = light;
  terrain.uniforms.uTime.value += dt;

  // The sky dome owns the palette now; fog blends the terrain into its horizon
  // so the view distance ends in sky rather than a visible wall of colour.
  const horizon = sky.update(survival.time, light, player.position, dt);
  terrain.uniforms.uFogColor.value.copy(horizon);
  scene.background = null;                    // the dome covers the whole view

  sun.intensity = 0.35 + light * 1.35;
  ambient.intensity = 0.25 + light * 0.6;
  const angle = survival.time * Math.PI * 2;
  sun.position.set(Math.cos(angle) * 0.6, Math.max(0.15, Math.sin(angle)), 0.35);
}

renderer.setAnimationLoop(render);

// Debug handle: handy from the browser console, and used by the test harness.
window.VRCRAFT = {
  renderer, scene, camera, rig, terrain, player, inventory, survival, mobs,
  interactor, particles, hud, craftUI, sky, controllers, grips, BUILD,
  vrHand, viewHand, viewCamera,
  setCraftingOpen, tryCraft, get stations() { return stations; },
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
      onGround: player.onGround,
      build: BUILD,
      fps,
      worstFrameMs: +worstFrameMs.toFixed(1),
      daylight: +survival.daylight.toFixed(2),
      health: survival.health,
      hunger: survival.hunger,
    };
  },
};

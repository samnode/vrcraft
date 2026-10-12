// Entry point: renderer and XR setup, input mapping for both controllers and
// keyboard/mouse, and the frame loop that drives every subsystem.

import * as THREE from '../vendor/three/three.module.js';
import { VRButton } from '../vendor/three/jsm/webxr/VRButton.js';

import { buildAtlas, blockCubeGeometry } from './textures.js';
import { Terrain } from './terrain.js';
import { Player } from './player.js';
import { Inventory } from './inventory.js';
import { Survival } from './survival.js';
import { Mobs } from './mobs.js';
import { Interactor } from './interact.js';
import { Particles } from './fx.js';
import { Hud, formatClock } from './ui.js';
import { block } from './blocks.js';
import { sfx } from './sfx.js';
import { SEA_LEVEL } from './world.js';

// Continuous stick turning. Raise for faster rotation; some people find anything
// above ~160 deg/s uncomfortable in a headset.
const TURN_SPEED = THREE.MathUtils.degToRad(120);   // radians per second at full deflection
const TURN_DEADZONE = 0.15;
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

const stars = makeStars();
scene.add(stars);

// ---------------------------------------------------------------- game state

const survival = new Survival({ onDeath: () => { sfx.hurt(); respawn(); } });
const player = new Player(terrain.world, rig, camera);
const inventory = new Inventory({ creative: true });
const particles = new Particles(scene);
const mobs = new Mobs(scene, terrain.world, survival);
const interactor = new Interactor(scene, terrain, player, inventory, survival, mobs, particles);
const hud = new Hud(atlas.canvas);
hud.attachToDom(document.body);

player.onFallDamage = (amount) => {
  survival.damage(amount, 'the fall');
  sfx.hurt();
};

mobs.onDrop = (id, position) => {
  particles.burst(position, 0xd98d88, 10, 2.0);
  interactor.collect(id, 1);
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
const heldCube = { mesh: null, id: 0 };

for (let i = 0; i < 2; i++) {
  const controller = renderer.xr.getController(i);
  controller.addEventListener('connected', (event) => {
    controller.userData.inputSource = event.data;
    controller.userData.hand = event.data.handedness;
    buildControllerVisual(controller, event.data.handedness);
  });
  controller.addEventListener('disconnected', () => {
    controller.userData.inputSource = null;
    controller.clear();
  });
  rig.add(controller);
  controllers.push(controller);
}

function buildControllerVisual(controller, handedness) {
  controller.clear();

  const grip = new THREE.Mesh(
    new THREE.BoxGeometry(0.045, 0.045, 0.13),
    new THREE.MeshLambertMaterial({ color: 0x9a7b5a }),
  );
  grip.position.set(0, -0.01, 0.04);
  controller.add(grip);

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
  } else {
    controller.add(hud.panel);
    hud.panel.visible = renderer.xr.isPresenting;
    if (heldCube.mesh) heldCube.mesh.geometry.dispose();
    heldCube.id = 0;                                  // force a refresh next frame
    heldCube.mesh = new THREE.Mesh(
      blockCubeGeometry(block(inventory.slots[0].id || 1).faces),
      new THREE.MeshLambertMaterial({ map: atlas.texture }),
    );
    heldCube.mesh.scale.setScalar(0.09);
    heldCube.mesh.position.set(0.0, 0.03, -0.14);
    heldCube.mesh.rotation.set(0.3, 0.6, 0);
    controller.add(heldCube.mesh);
  }
}

function refreshHeldCube() {
  const id = inventory.selectedSlot.id;
  if (!heldCube.mesh || id === heldCube.id) return;
  heldCube.id = id;
  heldCube.mesh.visible = !!id;
  if (!id) return;
  heldCube.mesh.geometry.dispose();
  heldCube.mesh.geometry = blockCubeGeometry(block(id).faces);
}

function controllerByHand(hand) {
  return controllers.find((c) => c.userData.hand === hand) || null;
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
    input.placing = pressed(lp, 0) || pressed(lp, 1);
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
  if (keys.has('KeyW')) input.move.z += 1;
  if (keys.has('KeyS')) input.move.z -= 1;
  if (keys.has('KeyD')) input.move.x += 1;
  if (keys.has('KeyA')) input.move.x -= 1;
  return input;
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
  if (e.code === 'Tab') e.preventDefault();
  keys.add(e.code);
  if (e.code === 'KeyF') toggleFlight();
  if (e.code === 'KeyC') setCreative(!inventory.creative);
  if (e.code === 'Escape') mouse.locked = false;
  const digit = e.code.match(/^Digit([1-9])$/);
  if (digit) inventory.select(Number(digit[1]) - 1);
});
window.addEventListener('keyup', (e) => keys.delete(e.code));

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
  if (!renderer.xr.isPresenting) showEntry(!mouse.locked);
});

document.addEventListener('mousemove', (e) => {
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
  crosshair.style.display = on ? 'none' : 'block';
}

hud.setDomVisible(false);

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
  showEntry(false);
  crosshair.style.display = 'none';
  hud.panel.visible = true;
  camera.rotation.set(0, 0, 0);
  player.headTracked = false;
  sfx.resume();
});

renderer.xr.addEventListener('sessionend', () => {
  showEntry(true);
  hud.panel.visible = false;
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------------------------------------------------------------- frame loop

// Overrides used by the debug handle to drive the game without real input.
const debug = { input: null, forceActive: false };

const pointer = {
  raycaster: new THREE.Raycaster(),
  hoverSlot: -1,
  pressed: false,
};

const rayOrigin = new THREE.Vector3();
const rayDirection = new THREE.Vector3();
const forward = new THREE.Vector3(0, 0, -1);
let last = performance.now();
let hudTimer = 0;

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
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
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

  survival.update(dt, player);
  survival.tickMessages(dt);
  player.update(dt, input);
  terrain.update(player.position);
  mobs.update(dt, player);
  interactor.update(dt, active ? aimRay() : null, input);
  particles.update(dt);
  refreshHeldCube();
  updateSky();

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
      mode: inventory.creative ? 'Creative' : 'Survival',
      hoverSlot: pointer.hoverSlot,
      clock: formatClock(survival.time),
    });
  }

  renderer.render(scene, camera);
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

function updateSky() {
  const light = survival.daylight;
  terrain.uniforms.uDayLight.value = light;
  terrain.uniforms.uFogColor.value.copy(survival.skyColor);
  scene.background = survival.skyColor;

  sun.intensity = 0.35 + light * 1.35;
  ambient.intensity = 0.25 + light * 0.6;
  // Swing the light across the sky so mobs and held blocks shade with the cycle.
  const angle = survival.time * Math.PI * 2;
  sun.position.set(Math.cos(angle) * 0.6, Math.max(0.15, Math.sin(angle)), 0.35);

  stars.material.opacity = THREE.MathUtils.clamp(1 - light * 2.4, 0, 0.9);
  stars.visible = stars.material.opacity > 0.02;
  stars.position.copy(player.position);
}

function makeStars() {
  const count = 420;
  const pos = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    // Even scatter over the upper hemisphere of a large sphere.
    const u = Math.random(), v = Math.random() * 0.85 + 0.15;
    const theta = u * Math.PI * 2, phi = Math.acos(v);
    const r = 180;
    pos[i * 3] = Math.sin(phi) * Math.cos(theta) * r;
    pos[i * 3 + 1] = Math.cos(phi) * r;
    pos[i * 3 + 2] = Math.sin(phi) * Math.sin(theta) * r;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const points = new THREE.Points(geo, new THREE.PointsMaterial({
    color: 0xffffff, size: 1.4, sizeAttenuation: false, transparent: true, opacity: 0, depthWrite: false,
  }));
  points.frustumCulled = false;
  return points;
}

renderer.setAnimationLoop(render);

// Debug handle: handy from the browser console, and used by the test harness.
window.VRCRAFT = {
  renderer, scene, camera, rig, terrain, player, inventory, survival, mobs,
  interactor, particles, hud,
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
      drawCalls: renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
      mobs: mobs.list.length,
      onGround: player.onGround,
      daylight: +survival.daylight.toFixed(2),
      health: survival.health,
      hunger: survival.hunger,
    };
  },
};

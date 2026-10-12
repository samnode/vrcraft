// Sky dome, sun, moon and a drifting cloud layer. All of it follows the same
// time-of-day value the terrain shader uses, so the world and the sky never
// disagree about what hour it is.

import * as THREE from '../vendor/three/three.module.js?v=7';

const DOME_VERT = `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const DOME_FRAG = `
  precision mediump float;
  uniform vec3 uTop;
  uniform vec3 uHorizon;
  uniform vec3 uGlow;       // warm band around the sun, near sunrise and sunset
  uniform vec3 uSunDir;
  varying vec3 vDir;
  void main() {
    vec3 d = normalize(vDir);
    // Horizon-to-zenith ramp, eased so the gradient is tight near the ground.
    float h = clamp(d.y, 0.0, 1.0);
    vec3 col = mix(uHorizon, uTop, pow(h, 0.55));
    // Sun glow falls off sharply, and only where the sun actually is.
    float sun = max(dot(d, normalize(uSunDir)), 0.0);
    col += uGlow * pow(sun, 6.0);
    col += uGlow * 0.25 * pow(1.0 - h, 6.0);
    gl_FragColor = vec4(col, 1.0);
  }
`;

/** A soft round disc, used for both the sun and the moon. */
function discTexture(inner, outer, size = 64) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, inner);
  g.addColorStop(0.55, inner);
  g.addColorStop(0.75, outer);
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Blocky Minecraft-style cloud sheet, tiled and scrolled across the sky. */
function cloudTexture(size = 128) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, size, size);

  const hash = (x, y) => {
    let h = x * 374761393 + y * 668265263;
    h = (h ^ (h >>> 13)) * 1274126177;
    return ((h ^ (h >>> 16)) & 0xffff) / 0xffff;
  };

  // Coarse cells grown into blobs: sparse, chunky, and wrapping at the edges.
  const cell = 8;
  const cells = size / cell;
  for (let y = 0; y < cells; y++) {
    for (let x = 0; x < cells; x++) {
      let n = hash(x, y) * 0.55
        + hash(Math.floor(x / 2), Math.floor(y / 2)) * 0.3
        + hash(Math.floor(x / 4), Math.floor(y / 4)) * 0.15;
      if (n < 0.66) continue;
      ctx.fillStyle = `rgba(255,255,255,${(0.6 + (n - 0.66) * 1.4).toFixed(3)})`;
      ctx.fillRect(x * cell, y * cell, cell, cell);
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.repeat.set(3, 3);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const NIGHT_TOP = new THREE.Color(0x060a1c);
const NIGHT_HOR = new THREE.Color(0x121a38);
const DAY_TOP   = new THREE.Color(0x4f8fe0);
const DAY_HOR   = new THREE.Color(0xbcd8f2);
const DUSK_HOR  = new THREE.Color(0xe8945a);

export class Sky {
  constructor(scene) {
    this.group = new THREE.Group();
    // Rides with the player so the sky never gets closer to its edge.
    this.group.matrixAutoUpdate = true;
    scene.add(this.group);

    this.uniforms = {
      uTop: { value: DAY_TOP.clone() },
      uHorizon: { value: DAY_HOR.clone() },
      uGlow: { value: new THREE.Color(0x000000) },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    };
    this.dome = new THREE.Mesh(
      new THREE.SphereGeometry(300, 24, 16),
      new THREE.ShaderMaterial({
        uniforms: this.uniforms,
        vertexShader: DOME_VERT,
        fragmentShader: DOME_FRAG,
        side: THREE.BackSide,
        depthWrite: false,
      }),
    );
    this.dome.renderOrder = -2;
    this.group.add(this.dome);

    this.sun = this.makeDisc(discTexture('rgba(255,250,224,1)', 'rgba(255,214,120,0.6)'), 34);
    this.moon = this.makeDisc(discTexture('rgba(236,242,255,1)', 'rgba(180,200,240,0.5)'), 22);

    this.stars = this.makeStars();
    this.group.add(this.stars);

    this.clouds = new THREE.Mesh(
      new THREE.PlaneGeometry(900, 900),
      new THREE.MeshBasicMaterial({
        map: cloudTexture(), transparent: true, opacity: 0.6,
        depthWrite: false, side: THREE.DoubleSide, fog: false,
      }),
    );
    this.clouds.rotation.x = -Math.PI / 2;
    this.clouds.position.y = 110;
    this.clouds.renderOrder = -1;
    this.group.add(this.clouds);
  }

  makeDisc(texture, size) {
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(size, size),
      new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, fog: false }),
    );
    mesh.renderOrder = -1;
    this.group.add(mesh);
    return mesh;
  }

  makeStars() {
    const count = 500;
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const u = Math.random(), v = Math.random() * 0.9 + 0.1;
      const theta = u * Math.PI * 2, phi = Math.acos(v);
      const r = 260;
      pos[i * 3] = Math.sin(phi) * Math.cos(theta) * r;
      pos[i * 3 + 1] = Math.cos(phi) * r;
      pos[i * 3 + 2] = Math.sin(phi) * Math.sin(theta) * r;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const points = new THREE.Points(geo, new THREE.PointsMaterial({
      color: 0xffffff, size: 1.6, sizeAttenuation: false,
      transparent: true, opacity: 0, depthWrite: false, fog: false,
    }));
    points.frustumCulled = false;
    return points;
  }

  /**
   * time: 0..1 through the day, daylight: the same 0..1 term the terrain uses.
   * Returns the fog colour the world should blend to at this hour.
   */
  update(time, daylight, playerPosition, dt) {
    this.group.position.copy(playerPosition);

    const angle = time * Math.PI * 2;
    const sunDir = new THREE.Vector3(Math.cos(angle) * 0.6, Math.sin(angle), 0.35).normalize();
    this.uniforms.uSunDir.value.copy(sunDir);

    // Horizon warms as the sun approaches it, from either side.
    const height = sunDir.y;
    const dusk = Math.max(0, 1 - Math.abs(height) * 3.2);
    this.uniforms.uTop.value.copy(NIGHT_TOP).lerp(DAY_TOP, daylight);
    this.uniforms.uHorizon.value.copy(NIGHT_HOR).lerp(DAY_HOR, daylight).lerp(DUSK_HOR, dusk * 0.75);
    this.uniforms.uGlow.value.setRGB(0.45 * dusk, 0.22 * dusk, 0.07 * dusk);

    this.sun.position.copy(sunDir).multiplyScalar(240);
    this.sun.lookAt(this.group.position);
    this.sun.visible = height > -0.25;

    this.moon.position.copy(sunDir).multiplyScalar(-240);
    this.moon.lookAt(this.group.position);
    this.moon.visible = height < 0.25;

    this.stars.material.opacity = THREE.MathUtils.clamp(1 - daylight * 2.4, 0, 0.9);
    this.stars.visible = this.stars.material.opacity > 0.02;

    // Clouds drift on their own, independent of the player's motion.
    const map = this.clouds.material.map;
    map.offset.x = (map.offset.x + dt * 0.004) % 1;
    this.clouds.material.opacity = 0.18 + daylight * 0.42;
    this.clouds.material.color.copy(this.uniforms.uHorizon.value).lerp(new THREE.Color(0xffffff), 0.6);

    return this.uniforms.uHorizon.value;
  }
}

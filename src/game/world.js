import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Rng, clamp } from '../core/utils.js';
import { toon, glow, gradientMap, G } from './materials.js';
import { createHelipad, enableShadows } from './models.js';

// Остров-город: сетка дорог 9x9, кварталы 8x8, вода вокруг.
export const MAP = { S: 300, L: 268, R: 72 };
export const ROADS = Array.from({ length: 9 }, (_, k) => -240 + k * 60);
const ROAD_W = 12;
const SIDEWALK = 3;

export function islandSdf(x, z) {
  const L = MAP.L - MAP.R;
  const qx = Math.abs(x) - L;
  const qz = Math.abs(z) - L;
  return Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0) - MAP.R;
}

export const LIGHTING = {
  day: {
    sky: 0x9fd6ff, fog: [0x9fd6ff, 140, 330], sun: [0xfff1d6, 2.7], sunDir: [-0.55, 1, 0.35],
    hemi: [0xcfe8ff, 0x6f8f4f, 1.25], night: false, water: [0x1f7fc4, 0x46c7e8],
  },
  sunset: {
    sky: 0xf6a77a, fog: [0xf2a27c, 130, 310], sun: [0xffb072, 2.6], sunDir: [-0.9, 0.55, 0.25],
    hemi: [0xffc6a0, 0x5a4a6a, 1.05], night: false, water: [0x2a5f9a, 0xe58a6a],
  },
  night: {
    sky: 0x0b1530, fog: [0x0b1530, 120, 300], sun: [0x9fb4ff, 1.0], sunDir: [0.4, 1, 0.6],
    hemi: [0x4a58a0, 0x1a2230, 1.0], night: true, water: [0x0a2245, 0x1d4f7a],
  },
};

const WALL_COLORS = [0xf3e3c3, 0xf2b8a2, 0x9ed3d6, 0xb7c9f2, 0xf6d38b, 0xd7c2ea, 0xe8e2d8, 0xa8d8a0];
const ROOF_COLORS = [0x8d99a6, 0x7c8590, 0x9a8f80, 0x6f7b74];
const HOUSE_ROOFS = [0xc8553d, 0xb5651d, 0x8e3b46, 0x4f6d8f, 0x6b4f3a];
const CAR_COLORS = [0xe74c3c, 0x3498db, 0xf1c40f, 0xecf0f1, 0x2ecc71, 0x9b59b6, 0xe67e22, 0x34495e, 0x1abc9c];

const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _e = new THREE.Euler();
const _c = new THREE.Color();

function colored(geo, color) {
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  const c = new THREE.Color(color);
  const arr = new Float32Array(g.attributes.position.count * 3);
  for (let i = 0; i < arr.length; i += 3) {
    arr[i] = c.r;
    arr[i + 1] = c.g;
    arr[i + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  return g;
}

function carGeometry() {
  return G.custom('carMerged', () => {
    const parts = [
      colored(new THREE.BoxGeometry(2.2, 0.9, 4.3).translate(0, 0.85, 0), 0xffffff),
      colored(new THREE.BoxGeometry(1.9, 0.75, 2.2).translate(0, 1.65, -0.25), 0xffffff),
      colored(new THREE.BoxGeometry(1.96, 0.5, 2.0).translate(0, 1.68, -0.25), 0x38475a),
      colored(new THREE.BoxGeometry(2.3, 0.6, 0.8).translate(0, 0.5, 1.35), 0x1d1d1d),
      colored(new THREE.BoxGeometry(2.3, 0.6, 0.8).translate(0, 0.5, -1.35), 0x1d1d1d),
      colored(new THREE.BoxGeometry(1.6, 0.2, 0.1).translate(0, 0.95, 2.16), 0xfff3b0),
    ];
    return mergeGeometries(parts);
  });
}

function palmGeometry() {
  return G.custom('palmMerged', () => {
    const parts = [];
    for (let i = 0; i < 4; i++) {
      const seg = new THREE.CylinderGeometry(0.28 - i * 0.03, 0.34 - i * 0.03, 1.8, 7);
      seg.translate(i * 0.35, 0.9 + i * 1.7, 0);
      parts.push(colored(seg, 0x9b7653));
    }
    for (let k = 0; k < 6; k++) {
      const leaf = new THREE.BoxGeometry(0.9, 0.12, 3.4);
      leaf.translate(0, 0, 1.7);
      leaf.rotateX(0.45);
      leaf.rotateY((k / 6) * Math.PI * 2);
      leaf.translate(1.4, 7.0, 0);
      parts.push(colored(leaf, 0x3faa4a));
    }
    parts.push(colored(new THREE.SphereGeometry(0.45, 6, 4).translate(1.4, 6.9, 0), 0x6b4a2b));
    return mergeGeometries(parts);
  });
}

// Набор однотипных объектов, разбитых на чанки (для отсечения по видимости).
class PropSet {
  constructor(world, parts, opts = {}) {
    this.world = world;
    this.parts = parts;
    this.opts = { cast: true, receive: true, kind: null, radius: 1.5, debris: 0x777777, ...opts };
    this.items = [];
  }
  add(x, y, z, rotY = 0, sx = 1, sy = sx, sz = sx, color = null, extra = null) {
    const item = { x, y, z, rotY, sx, sy, sz, color, alive: true, refs: [], set: this, ...extra };
    this.items.push(item);
    return item;
  }
  build(scene) {
    const chunks = new Map();
    for (const it of this.items) {
      const key = Math.floor((it.x + 300) / 150) + ',' + Math.floor((it.z + 300) / 150);
      if (!chunks.has(key)) chunks.set(key, []);
      chunks.get(key).push(it);
    }
    for (const list of chunks.values()) {
      for (const part of this.parts) {
        const mesh = new THREE.InstancedMesh(part.geo, part.mat, list.length);
        mesh.castShadow = this.opts.cast;
        mesh.receiveShadow = this.opts.receive;
        list.forEach((it, idx) => {
          _e.set(it.tiltX || 0, it.rotY, it.tiltZ || 0);
          _q.setFromEuler(_e);
          _m.compose(_p.set(it.x, it.y, it.z), _q, _s.set(it.sx, it.sy, it.sz));
          mesh.setMatrixAt(idx, _m);
          if (part.colorize) mesh.setColorAt(idx, _c.set(it.color ?? 0xffffff));
          it.refs.push([mesh, idx]);
        });
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        mesh.computeBoundingSphere();
        scene.add(mesh);
        this.world.disposables.push(() => mesh.dispose());
      }
    }
    if (this.opts.kind) for (const it of this.items) this.world.registerProp(it);
  }
  hide(it) {
    it.alive = false;
    for (const [mesh, idx] of it.refs) {
      mesh.setMatrixAt(idx, ZERO);
      mesh.instanceMatrix.needsUpdate = true;
    }
  }
}

export class World {
  constructor(scene, { seed = 1, lighting = 'day', sites = 5, density = 1 } = {}) {
    this.scene = scene;
    this.rng = new Rng(seed);
    this.light = LIGHTING[lighting];
    this.night = this.light.night;
    this.density = density;
    this.disposables = [];
    this.buildings = [];
    this.bGrid = new Map();
    this.pGrid = new Map();
    this.collapsing = [];
    this.onPropDestroyed = null;
    this.time = 0;

    this.planBlocks(sites);
    this.makeMaterials();
    this.makeLights();
    this.makeWater();
    this.makeGround();
    this.populate();
    this.traffic = new Traffic(this, Math.round(26 * density));
    this.makeClouds();
  }

  // ---------- план города ----------
  planBlocks(siteCount) {
    const rng = this.rng;
    this.blocks = [];
    for (let i = 0; i < 8; i++) {
      for (let j = 0; j < 8; j++) {
        const x0 = ROADS[i] + ROAD_W / 2, x1 = ROADS[i + 1] - ROAD_W / 2;
        const z0 = ROADS[j] + ROAD_W / 2, z1 = ROADS[j + 1] - ROAD_W / 2;
        const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
        let type;
        const dc = Math.hypot(cx, cz);
        if (i === 7 && j === 7) type = 'base';
        else if ((i === 6 && j === 7) || (i === 7 && j === 6)) type = 'park';
        else if (dc < 95) type = 'downtown';
        else if (i === 0) type = 'industrial';
        else {
          const r = rng.next();
          type = r < 0.45 ? 'residential' : r < 0.82 ? 'commercial' : 'park';
        }
        this.blocks.push({ i, j, x0, x1, z0, z1, cx, cz, type });
      }
    }
    const base = this.blocks.find((b) => b.type === 'base');
    this.base = { x: base.cx, z: base.cz };

    const candidates = this.blocks.filter((b) => b.type !== 'base' && Math.abs(b.i - 7) + Math.abs(b.j - 7) >= 3);
    const chosen = [];
    const far = (b) => {
      let m = Math.hypot(b.cx - this.base.x, b.cz - this.base.z) * 0.6;
      for (const c of chosen) m = Math.min(m, Math.hypot(b.cx - c.cx, b.cz - c.cz));
      return m + rng.next() * 20;
    };
    for (let k = 0; k < siteCount; k++) {
      let best = null, bestV = -1;
      for (const b of candidates) {
        if (chosen.includes(b)) continue;
        const v = far(b);
        if (v > bestV) {
          bestV = v;
          best = b;
        }
      }
      best.type = 'site';
      chosen.push(best);
    }
    chosen.sort((a, b) => Math.hypot(a.cx - this.base.x, a.cz - this.base.z) - Math.hypot(b.cx - this.base.x, b.cz - this.base.z));
    this.sites = chosen.map((b) => ({ x: b.cx, z: b.cz, block: b }));
  }

  // ---------- материалы и свет ----------
  makeMaterials() {
    const tile = document.createElement('canvas');
    tile.width = tile.height = 64;
    const t = tile.getContext('2d');
    t.fillStyle = '#ffffff';
    t.fillRect(0, 0, 64, 64);
    t.fillStyle = 'rgba(0,0,0,0.06)';
    t.fillRect(0, 56, 64, 8);
    t.fillStyle = '#3c5872';
    t.fillRect(13, 14, 38, 34);
    t.fillStyle = '#6f93b3';
    t.beginPath();
    t.moveTo(13, 14);
    t.lineTo(30, 14);
    t.lineTo(13, 34);
    t.fill();
    t.fillStyle = '#e9e9e9';
    t.fillRect(11, 47, 42, 4);
    const wallTex = new THREE.CanvasTexture(tile);
    wallTex.wrapS = wallTex.wrapT = THREE.RepeatWrapping;
    wallTex.colorSpace = THREE.SRGBColorSpace;
    wallTex.anisotropy = 4;
    this.disposables.push(() => wallTex.dispose());

    let emissive = null;
    if (this.night) {
      const ec = document.createElement('canvas');
      ec.width = ec.height = 256;
      const e = ec.getContext('2d');
      e.fillStyle = '#000';
      e.fillRect(0, 0, 256, 256);
      for (let y = 0; y < 4; y++)
        for (let x = 0; x < 4; x++) {
          if (this.rng.chance(0.45)) {
            e.fillStyle = this.rng.pick(['#ffd27a', '#ffe9b0', '#9fd8ff', '#ffb35c']);
            e.fillRect(x * 64 + 13, y * 64 + 14, 38, 34);
          }
        }
      emissive = new THREE.CanvasTexture(ec);
      emissive.wrapS = emissive.wrapT = THREE.RepeatWrapping;
      emissive.colorSpace = THREE.SRGBColorSpace;
      emissive.repeat.set(0.25, 0.25);
      this.disposables.push(() => emissive.dispose());
    }
    this.wallMats = WALL_COLORS.map((c) => {
      const m = new THREE.MeshToonMaterial({ color: c, map: wallTex, gradientMap: gradientMap() });
      if (emissive) {
        m.emissiveMap = emissive;
        m.emissive = new THREE.Color(0xffffff);
        m.emissiveIntensity = 1.1;
      }
      this.disposables.push(() => m.dispose());
      return m;
    });
    this.roofMats = ROOF_COLORS.map((c) => toon(c));
    this.houseRoofMats = HOUSE_ROOFS.map((c) => toon(c));
  }

  makeLights() {
    const L = this.light;
    this.scene.background = new THREE.Color(L.sky);
    this.scene.fog = new THREE.Fog(...L.fog);
    this.hemi = new THREE.HemisphereLight(...L.hemi);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(...L.sun);
    this.sunDir = new THREE.Vector3(...L.sunDir).normalize();
    this.sun.castShadow = true;
    const cam = this.sun.shadow.camera;
    cam.left = -85;
    cam.right = 85;
    cam.top = 85;
    cam.bottom = -85;
    cam.near = 10;
    cam.far = 400;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.04;
    this.scene.add(this.sun, this.sun.target);
  }

  setShadowQuality(size) {
    const sh = this.sun.shadow;
    if (sh.mapSize.x === size) return;
    sh.mapSize.set(size, size);
    if (sh.map) {
      sh.map.dispose();
      sh.map = null;
    }
  }

  followSun(x, z) {
    // Привязка к сетке текселей убирает «дрожание» теней при полёте.
    const step = (170 / this.sun.shadow.mapSize.x) * 2;
    const sx = Math.round(x / step) * step;
    const sz = Math.round(z / step) * step;
    this.sun.target.position.set(sx, 0, sz);
    this.sun.position.set(sx + this.sunDir.x * 200, this.sunDir.y * 200, sz + this.sunDir.z * 200);
  }

  makeWater() {
    const [deep, shallow] = this.light.water;
    const mat = new THREE.ShaderMaterial({
      fog: true,
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        {
          uTime: { value: 0 },
          uDeep: { value: new THREE.Color(deep) },
          uShallow: { value: new THREE.Color(shallow) },
          uFoam: { value: new THREE.Color(this.night ? 0x9fc3e0 : 0xf4fbff) },
          uL: { value: MAP.L },
          uR: { value: MAP.R },
        },
      ]),
      vertexShader: /* glsl */ `
        uniform float uTime;
        varying vec2 vXZ;
        varying float vWave;
        #include <fog_pars_vertex>
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          float w = sin(wp.x * 0.08 + uTime * 1.2) * 0.22 + cos(wp.z * 0.07 + uTime * 0.9) * 0.22;
          wp.y += w;
          vXZ = wp.xz;
          vWave = w;
          vec4 mvPosition = viewMatrix * wp;
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform vec3 uDeep, uShallow, uFoam;
        uniform float uL, uR;
        varying vec2 vXZ;
        varying float vWave;
        #include <fog_pars_fragment>
        float sdf(vec2 p) {
          vec2 q = abs(p) - vec2(uL - uR);
          return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - uR;
        }
        void main() {
          float d = sdf(vXZ);
          vec3 col = mix(uDeep, uShallow, smoothstep(45.0, 0.0, d));
          float r = sin(vXZ.x * 0.33 + sin(vXZ.y * 0.21 + uTime) * 2.0 + uTime * 1.4)
                  * sin(vXZ.y * 0.29 + sin(vXZ.x * 0.17 - uTime * 0.8) * 2.0);
          col = mix(col, uFoam, step(0.86, r) * 0.35);
          float band = sin(d * 0.8 - uTime * 2.4);
          float foam = step(0.55, band) * smoothstep(11.0, 3.0, d) + smoothstep(2.5, 0.5, d);
          col = mix(col, uFoam, clamp(foam, 0.0, 1.0) * 0.85);
          col += vWave * 0.08;
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          #include <fog_fragment>
        }`,
    });
    const geo = new THREE.PlaneGeometry(1400, 1400, 70, 70);
    geo.rotateX(-Math.PI / 2);
    const water = new THREE.Mesh(geo, mat);
    water.position.y = -0.7;
    this.scene.add(water);
    this.water = mat;
    this.disposables.push(() => {
      geo.dispose();
      mat.dispose();
    });
  }

  // ---------- земля: рисуем текстуру города на canvas ----------
  makeGround() {
    const { S, L, R } = MAP;
    const N = 2048;
    const k = N / (2 * S);
    const cv = document.createElement('canvas');
    cv.width = cv.height = N;
    const g = cv.getContext('2d');
    const X = (x) => (x + S) * k;
    const rect = (x0, z0, x1, z1, color) => {
      g.fillStyle = color;
      g.fillRect(X(x0), X(z0), (x1 - x0) * k, (z1 - z0) * k);
    };
    const roundRect = (inset, color) => {
      g.fillStyle = color;
      g.beginPath();
      g.roundRect(X(-L + inset), X(-L + inset), (2 * (L - inset)) * k, (2 * (L - inset)) * k, (R - inset) * k);
      g.fill();
    };
    const rng = this.rng;
    const night = this.night;
    const pal = night
      ? { sand: '#8a7f6a', grass: '#2f5a3a', grass2: '#26492f', pave: '#5c6170', asphalt: '#262a33', walk: '#6b7080', dirt: '#5e4a35', line: '#b89a3e', concrete: '#4f535c' }
      : { sand: '#f0d9a0', grass: '#86c95f', grass2: '#73b553', pave: '#d8d2c4', asphalt: '#50555e', walk: '#e2ddd0', dirt: '#c49a62', line: '#f2c94c', concrete: '#bdb8ab' };

    rect(-S, -S, S, S, pal.sand);
    roundRect(14, pal.grass);
    for (let i = 0; i < 2600; i++) {
      g.fillStyle = rng.chance(0.5) ? pal.grass2 : night ? '#3a6a45' : '#98d670';
      g.globalAlpha = 0.25;
      g.beginPath();
      g.arc(rng.float(0, N), rng.float(0, N), rng.float(4, 22), 0, Math.PI * 2);
      g.fill();
    }
    g.globalAlpha = 1;
    // песок поверх травы у берега снова
    g.save();
    g.beginPath();
    g.rect(0, 0, N, N);
    g.roundRect(X(-L + 14), X(-L + 14), 2 * (L - 14) * k, 2 * (L - 14) * k, (R - 14) * k);
    g.fillStyle = pal.sand;
    g.fill('evenodd');
    g.restore();

    for (const b of this.blocks) {
      const pad = SIDEWALK;
      const x0 = b.x0 + pad, x1 = b.x1 - pad, z0 = b.z0 + pad, z1 = b.z1 - pad;
      if (b.type === 'downtown' || b.type === 'commercial') rect(x0, z0, x1, z1, pal.pave);
      else if (b.type === 'industrial' || b.type === 'base') rect(x0, z0, x1, z1, pal.concrete);
      else if (b.type === 'site') {
        rect(x0, z0, x1, z1, pal.dirt);
        g.strokeStyle = night ? 'rgba(0,0,0,0.25)' : 'rgba(90,60,30,0.35)';
        g.lineWidth = 2.2 * k;
        for (let t = 0; t < 4; t++) {
          g.beginPath();
          g.moveTo(X(x0 + rng.float(0, 10)), X(z0 + rng.float(0, 40)));
          g.bezierCurveTo(X(b.cx + rng.float(-20, 20)), X(b.cz + rng.float(-20, 20)), X(b.cx + rng.float(-20, 20)), X(b.cz + rng.float(-20, 20)), X(x1 - rng.float(0, 10)), X(z0 + rng.float(0, 40)));
          g.stroke();
        }
      } else if (b.type === 'park') {
        rect(x0, z0, x1, z1, pal.grass2);
        g.strokeStyle = pal.walk;
        g.lineWidth = 2.5 * k;
        g.beginPath();
        g.arc(X(b.cx), X(b.cz), 13 * k, 0, Math.PI * 2);
        g.moveTo(X(x0), X(b.cz));
        g.lineTo(X(x1), X(b.cz));
        g.moveTo(X(b.cx), X(z0));
        g.lineTo(X(b.cx), X(z1));
        g.stroke();
        if (rng.chance(0.6)) {
          b.pond = { x: b.cx + rng.float(-10, 10), z: b.cz + rng.float(-10, 10) };
          g.fillStyle = night ? '#1d4f7a' : '#5cc3e8';
          g.beginPath();
          g.ellipse(X(b.pond.x), X(b.pond.z), 7 * k, 5 * k, rng.float(0, 3), 0, Math.PI * 2);
          g.fill();
          g.strokeStyle = night ? '#8a7f6a' : '#f0e2b5';
          g.lineWidth = 1.2 * k;
          g.stroke();
        }
      }
    }

    // дороги
    const hw = ROAD_W / 2;
    for (const r of ROADS) {
      rect(r - hw - SIDEWALK, ROADS[0] - hw - SIDEWALK, r + hw + SIDEWALK, ROADS[8] + hw + SIDEWALK, pal.walk);
      rect(ROADS[0] - hw - SIDEWALK, r - hw - SIDEWALK, ROADS[8] + hw + SIDEWALK, r + hw + SIDEWALK, pal.walk);
    }
    for (const r of ROADS) {
      rect(r - hw, ROADS[0] - hw, r + hw, ROADS[8] + hw, pal.asphalt);
      rect(ROADS[0] - hw, r - hw, ROADS[8] + hw, r + hw, pal.asphalt);
    }
    g.fillStyle = pal.line;
    for (const r of ROADS) {
      for (let s = 0; s < 8; s++) {
        for (let t = ROADS[s] + hw + 4; t < ROADS[s + 1] - hw - 4; t += 6) {
          g.fillRect(X(r - 0.25), X(t), 0.5 * k, 3 * k);
          g.fillRect(X(t), X(r - 0.25), 3 * k, 0.5 * k);
        }
      }
    }
    g.fillStyle = night ? 'rgba(255,255,255,0.45)' : 'rgba(255,255,255,0.85)';
    for (const rx of ROADS)
      for (const rz of ROADS)
        for (let s = -hw + 1; s < hw - 1; s += 2) {
          for (const side of [-1, 1]) {
            g.fillRect(X(rx + s), X(rz + side * (hw + 0.6) - 0.9), 1 * k, 1.8 * k);
            g.fillRect(X(rx + side * (hw + 0.6) - 0.9), X(rz + s), 1.8 * k, 1 * k);
          }
        }

    this.groundCtx = { g, X, k };
    this.groundCanvas = cv;
    this.groundPal = pal;
  }

  finishGround() {
    const { S, L, R } = MAP;
    const tex = new THREE.CanvasTexture(this.groundCanvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    tex.repeat.set(1 / (2 * S), 1 / (2 * S));
    tex.offset.set(0.5, 0.5);
    const shape = new THREE.Shape();
    shape.moveTo(-L + R, -L);
    shape.lineTo(L - R, -L);
    shape.quadraticCurveTo(L, -L, L, -L + R);
    shape.lineTo(L, L - R);
    shape.quadraticCurveTo(L, L, L - R, L);
    shape.lineTo(-L + R, L);
    shape.quadraticCurveTo(-L, L, -L, L - R);
    shape.lineTo(-L, -L + R);
    shape.quadraticCurveTo(-L, -L, -L + R, -L);
    const geo = new THREE.ExtrudeGeometry(shape, { depth: 4, bevelEnabled: false, curveSegments: 16 });
    geo.rotateX(-Math.PI / 2);
    geo.translate(0, -4, 0);
    const top = new THREE.MeshToonMaterial({ map: tex, gradientMap: gradientMap() });
    const side = toon(this.night ? 0x6b604e : 0xd9bf85);
    const mesh = new THREE.Mesh(geo, [top, side]);
    mesh.receiveShadow = true;
    this.scene.add(mesh);
    this.ground = mesh;
    this.disposables.push(() => {
      geo.dispose();
      tex.dispose();
      top.dispose();
    });
    this.groundCanvas = null;
  }

  softShadow(x, z, w, d, blur = 10, alpha = 0.4) {
    const { g, X, k } = this.groundCtx;
    g.save();
    g.shadowColor = `rgba(0,0,0,${alpha})`;
    g.shadowBlur = blur;
    g.fillStyle = `rgba(0,0,0,${alpha * 0.6})`;
    g.fillRect(X(x - w / 2), X(z - d / 2), w * k, d * k);
    g.restore();
  }

  // ---------- наполнение города ----------
  populate() {
    const rng = this.rng;
    const D = this.density;
    const night = this.night;

    this.trees = new PropSet(this, [
      { geo: G.cyl(0.3, 0.42, 2.6, 6).clone().translate(0, 1.3, 0), mat: toon(0x8a5a35) },
      { geo: G.ico(2.3, 1).clone().translate(0, 4.1, 0), mat: toon(0xffffff), colorize: true },
    ], { kind: 'tree', radius: 2, debris: 0x4f9a3a });
    this.pines = new PropSet(this, [
      { geo: G.cyl(0.25, 0.35, 2.0, 6).clone().translate(0, 1.0, 0), mat: toon(0x7a4d2c) },
      { geo: G.cone(2.2, 5.6, 7).clone().translate(0, 4.6, 0), mat: toon(0xffffff), colorize: true },
    ], { kind: 'tree', radius: 2, debris: 0x2f7a43 });
    this.bushes = new PropSet(this, [{ geo: G.ico(1.2, 0), mat: toon(0xffffff), colorize: true }], { kind: 'bush', radius: 1.2, debris: 0x5aa83c });
    this.palms = new PropSet(this, [{ geo: palmGeometry(), mat: toon(0xffffff, { vertexColors: true }) }], { kind: 'tree', radius: 2, debris: 0x3faa4a });
    this.lamps = new PropSet(this, [
      { geo: G.cyl(0.12, 0.16, 6.5, 6).clone().translate(0, 3.25, 0), mat: toon(0x3d434c) },
      { geo: G.box(0.15, 0.15, 1.8).clone().translate(0, 6.4, 0.8), mat: toon(0x3d434c) },
      { geo: G.box(0.6, 0.25, 0.9).clone().translate(0, 6.3, 1.6), mat: night ? glow(0xffe08a) : toon(0xdedede) },
    ], { kind: 'lamp', radius: 0.8, debris: 0x3d434c });
    this.cars = new PropSet(this, [{ geo: carGeometry(), mat: toon(0xffffff, { vertexColors: true }), colorize: true }], { kind: 'car', radius: 2.3, debris: 0x555555 });
    this.containers = new PropSet(this, [{ geo: G.box(2.6, 2.6, 6.2), mat: toon(0xffffff), colorize: true }], { kind: 'container', radius: 3, debris: 0x8a5a35 });
    this.barrels = new PropSet(this, [
      { geo: G.cyl(2.2, 2.2, 4.2, 14).clone().translate(0, 2.1, 0), mat: toon(0xe9e4da) },
      { geo: G.cyl(2.25, 2.25, 0.6, 14).clone().translate(0, 3.0, 0), mat: toon(0xd8463c) },
    ], { kind: 'explosive', radius: 2.6, debris: 0xd8463c });
    this.rocks = new PropSet(this, [{ geo: G.custom('rock', () => new THREE.DodecahedronGeometry(1.4, 0)), mat: toon(0x9a958c) }], { cast: true });

    const treeGreen = () => _c.setHSL(rng.float(0.22, 0.33), rng.float(0.45, 0.65), night ? rng.float(0.18, 0.26) : rng.float(0.36, 0.48)).getHex();
    const addTree = (x, z, s = rng.float(0.8, 1.25)) => {
      if (rng.chance(0.3)) this.pines.add(x, 0, z, rng.float(0, 6), s, s, s, treeGreen());
      else this.trees.add(x, 0, z, rng.float(0, 6), s, s, s, treeGreen());
      this.softShadow(x, z, 3.5 * s, 3.5 * s, 8, 0.25);
    };

    for (const b of this.blocks) this.fillBlock(b, addTree);

    // улицы: деревья, фонари, припаркованные машины
    const hw = ROAD_W / 2;
    for (let li = 0; li < ROADS.length; li++) {
      const r = ROADS[li];
      for (let s = 0; s < 8; s++) {
        const a = ROADS[s], bnd = ROADS[s + 1];
        for (const orient of [0, 1]) {
          for (const side of [-1, 1]) {
            const neighbor = this.blockAt(orient === 0 ? r + side * 10 : (a + bnd) / 2, orient === 0 ? (a + bnd) / 2 : r + side * 10);
            if (neighbor && (neighbor.type === 'site' || neighbor.type === 'base')) continue;
            for (let t = a + hw + 8; t < bnd - hw - 6; t += 12) {
              const off = hw + SIDEWALK - 1.2;
              const px = orient === 0 ? r + side * off : t;
              const pz = orient === 0 ? t : r + side * off;
              if (rng.chance(0.42 * D)) addTree(px, pz, rng.float(0.65, 0.9));
              else if (rng.chance(0.25)) {
                const rot = orient === 0 ? (side > 0 ? -Math.PI / 2 : Math.PI / 2) : side > 0 ? Math.PI : 0;
                this.lamps.add(px, 0, pz, rot);
              }
              if (rng.chance(0.3 * D)) {
                const cx = orient === 0 ? r + side * (hw - 1.6) : t + 3;
                const cz = orient === 0 ? t + 3 : r + side * (hw - 1.6);
                const rot = orient === 0 ? (side > 0 ? 0 : Math.PI) : side > 0 ? Math.PI / 2 : -Math.PI / 2;
                this.cars.add(cx, 0, cz, rot, 1, 1, 1, rng.pick(CAR_COLORS));
              }
            }
          }
        }
      }
    }

    // пляж: пальмы и камни
    const L = MAP.L;
    for (let i = 0; i < 260 * D; i++) {
      const a = rng.float(0, Math.PI * 2);
      let x = Math.cos(a) * 400, z = Math.sin(a) * 400;
      // сдвигаем точку к берегу по нормали sdf
      for (let it = 0; it < 30; it++) {
        const d = islandSdf(x, z);
        const e = 0.5;
        const nx = islandSdf(x + e, z) - islandSdf(x - e, z);
        const nz = islandSdf(x, z + e) - islandSdf(x, z - e);
        const nl = Math.hypot(nx, nz) || 1;
        x -= (nx / nl) * d;
        z -= (nz / nl) * d;
      }
      const inset = rng.float(2, 11);
      const nx0 = islandSdf(x + 0.5, z) - islandSdf(x - 0.5, z);
      const nz0 = islandSdf(x, z + 0.5) - islandSdf(x, z - 0.5);
      const nl0 = Math.hypot(nx0, nz0) || 1;
      x -= (nx0 / nl0) * inset;
      z -= (nz0 / nl0) * inset;
      if (Math.hypot(x - this.base.x, z - this.base.z) < 40) continue;
      if (Math.abs(x) > L || Math.abs(z) > L) continue;
      if (rng.chance(0.4)) {
        const s = rng.float(0.8, 1.2);
        this.palms.add(x, 0, z, rng.float(0, 6.28), s);
      } else {
        const s = rng.float(0.6, 1.8);
        this.rocks.add(x, -0.3, z, rng.float(0, 6), s, s * 0.7, s);
      }
    }

    this.makeBase();
    this.makeHarbor();

    for (const set of [this.trees, this.pines, this.bushes, this.palms, this.lamps, this.cars, this.containers, this.barrels, this.rocks]) set.build(this.scene);
    this.finishGround();
  }

  blockAt(x, z) {
    for (const b of this.blocks) if (x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1) return b;
    return null;
  }

  fillBlock(b, addTree) {
    const rng = this.rng;
    const D = this.density;
    if (b.type === 'downtown' || b.type === 'commercial') {
      const tall = b.type === 'downtown';
      if (tall && rng.chance(0.2)) {
        this.addBuilding(b.cx, b.cz, rng.float(30, 34), rng.float(30, 34), rng.float(24, 28), 'flat');
        return;
      }
      for (const ox of [-1, 1])
        for (const oz of [-1, 1]) {
          const x = b.cx + ox * 11.5, z = b.cz + oz * 11.5;
          if (rng.chance(0.12)) {
            for (let t = 0; t < 3; t++) addTree(x + rng.float(-6, 6), z + rng.float(-6, 6));
            continue;
          }
          const w = rng.float(13, 19), d = rng.float(13, 19);
          const dc = Math.hypot(b.cx, b.cz);
          const h = tall ? clamp(rng.float(16, 28) - dc * 0.04, 14, 28) : rng.float(7, 16);
          this.addBuilding(x + rng.float(-1, 1), z + rng.float(-1, 1), w, d, h, 'flat');
        }
    } else if (b.type === 'residential') {
      for (const ox of [-1, 0, 1])
        for (const oz of [-1, 0, 1]) {
          const x = b.cx + ox * 14.5, z = b.cz + oz * 14.5;
          if (rng.chance(0.18)) {
            addTree(x + rng.float(-3, 3), z + rng.float(-3, 3));
            if (rng.chance(0.5)) this.bushes.add(x + rng.float(-5, 5), 0.5, z + rng.float(-5, 5), rng.float(0, 6), rng.float(0.8, 1.3), 0.8, 1, 0x5aa83c);
            continue;
          }
          const w = rng.float(8, 10.5), d = rng.float(8, 10.5);
          this.addBuilding(x, z, w, d, rng.float(4.5, 7.5), 'pitched');
          if (rng.chance(0.6 * D)) this.bushes.add(x + rng.float(-6, 6), 0.5, z + (rng.chance(0.5) ? 6 : -6), rng.float(0, 6), rng.float(0.7, 1.1), 0.8, 1, _c.setHSL(rng.float(0.2, 0.35), 0.55, 0.4).getHex());
        }
    } else if (b.type === 'industrial') {
      this.addBuilding(b.cx + 5, b.cz - 9, 34, 18, rng.float(8, 11), 'warehouse');
      for (let n = 0; n < 9; n++) {
        const x = b.cx - 14 + (n % 3) * 3.0;
        const z = b.cz + 8 + Math.floor(n / 3) * 7;
        const stack = rng.int(1, 3);
        for (let s = 0; s < stack; s++) this.containers.add(x, 1.3 + s * 2.6, z, 0, 1, 1, 1, rng.pick([0xd8463c, 0x2f80c8, 0x2e9e5b, 0xf2a93b, 0x8e5bb5]));
      }
      for (let n = 0; n < 2; n++) {
        this.barrels.add(b.cx + 9 + n * 6, 0, b.cz + 12, 0, 1);
        this.softShadow(b.cx + 9 + n * 6, b.cz + 12, 5, 5, 10, 0.3);
      }
    } else if (b.type === 'park') {
      const n = Math.round(22 * D);
      for (let t = 0; t < n; t++) {
        const x = rng.float(b.x0 + 5, b.x1 - 5), z = rng.float(b.z0 + 5, b.z1 - 5);
        if (Math.abs(Math.hypot(x - b.cx, z - b.cz) - 13) < 3) continue;
        if (b.pond && Math.hypot(x - b.pond.x, z - b.pond.z) < 9) continue;
        if (Math.abs(x - b.cx) < 2.5 || Math.abs(z - b.cz) < 2.5) continue;
        addTree(x, z);
      }
      for (let t = 0; t < 10 * D; t++) this.bushes.add(rng.float(b.x0 + 4, b.x1 - 4), 0.5, rng.float(b.z0 + 4, b.z1 - 4), rng.float(0, 6), rng.float(0.7, 1.2), 0.8, 1, _c.setHSL(rng.float(0.0, 0.95), 0.55, 0.6).getHex());
    }
  }

  addBuilding(x, z, w, d, h, style) {
    const rng = this.rng;
    const group = new THREE.Group();
    group.position.set(x, 0, z);
    const wall = rng.pick(this.wallMats);
    const geo = new THREE.BoxGeometry(w, h, d);
    const uv = geo.attributes.uv;
    const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
    for (let f = 0; f < 6; f++)
      for (let v = 0; v < 4; v++) {
        const i = f * 4 + v;
        uv.setXY(i, (uv.getX(i) * dims[f][0]) / 4, (uv.getY(i) * dims[f][1]) / 4);
      }
    geo.translate(0, h / 2, 0);
    const roofMat = style === 'pitched' ? rng.pick(this.houseRoofMats) : rng.pick(this.roofMats);
    const body = new THREE.Mesh(geo, [wall, wall, roofMat, roofMat, wall, wall]);
    group.add(body);
    this.disposables.push(() => geo.dispose());
    let top = h;
    if (style === 'pitched') {
      const rh = Math.min(w, d) * 0.38;
      const shape = new THREE.Shape([new THREE.Vector2(-w / 2 - 0.5, 0), new THREE.Vector2(w / 2 + 0.5, 0), new THREE.Vector2(0, rh)]);
      const rg = new THREE.ExtrudeGeometry(shape, { depth: d + 1, bevelEnabled: false });
      rg.translate(0, h, -(d + 1) / 2);
      group.add(new THREE.Mesh(rg, roofMat));
      this.disposables.push(() => rg.dispose());
      top = h + rh;
      if (rng.chance(0.5)) {
        const ch = new THREE.Mesh(G.box(1.2, 2.4, 1.2), toon(0x8a5a45));
        ch.position.set(w * 0.25, h + rh * 0.6, d * 0.2);
        group.add(ch);
      }
    } else if (style === 'warehouse') {
      for (let i = 0; i < 4; i++) {
        const m = new THREE.Mesh(G.box(w / 4 - 0.4, 1.4, d - 1), toon(0x9aa3ab));
        m.position.set(-w / 2 + w / 8 + (i * w) / 4, h + 0.7, 0);
        m.rotation.x = 0;
        group.add(m);
      }
      top = h + 1.4;
    } else {
      const parapet = new THREE.Mesh(G.box(1, 1, 1), roofMat);
      parapet.scale.set(w + 0.4, 0.6, d + 0.4);
      parapet.position.y = h + 0.1;
      group.add(parapet);
      const n = rng.int(1, 3);
      for (let i = 0; i < n; i++) {
        const r = rng.next();
        let m;
        if (r < 0.45) m = new THREE.Mesh(G.box(2.2, 1.3, 2.2), toon(0xc8ccd0));
        else if (r < 0.75) {
          m = new THREE.Mesh(G.cyl(1.3, 1.3, 2.6, 10), toon(0x8a6a4a));
          m.position.y = 0.6;
        } else m = new THREE.Mesh(G.cyl(0.08, 0.08, 6, 4), toon(0x444444));
        m.position.x += rng.float(-w / 2 + 2, w / 2 - 2);
        m.position.z += rng.float(-d / 2 + 2, d / 2 - 2);
        m.position.y += h + (r < 0.75 ? 1.0 : 3);
        group.add(m);
      }
      if (h > 22 && rng.chance(0.5)) {
        const pad = new THREE.Mesh(G.cyl(4, 4, 0.3, 16), toon(0x5a5f66));
        pad.position.set(0, h + 0.3, 0);
        group.add(pad);
      }
    }
    enableShadows(group);
    this.scene.add(group);
    this.softShadow(x, z, w + 1.5, d + 1.5, 14, 0.45);
    const hp = clamp(w * d * h * 0.045, 50, 380);
    const bld = { group, x, z, w, d, h, top, hp, maxHp: hp, alive: true, crate: null, wallColor: wall.color.getHex() };
    this.buildings.push(bld);
    const c0x = Math.floor((x - w / 2 + 300) / 30), c1x = Math.floor((x + w / 2 + 300) / 30);
    const c0z = Math.floor((z - d / 2 + 300) / 30), c1z = Math.floor((z + d / 2 + 300) / 30);
    for (let cx = c0x; cx <= c1x; cx++)
      for (let cz = c0z; cz <= c1z; cz++) {
        const key = cx * 1000 + cz;
        if (!this.bGrid.has(key)) this.bGrid.set(key, []);
        this.bGrid.get(key).push(bld);
      }
    return bld;
  }

  makeBase() {
    const { x, z } = this.base;
    const pad = createHelipad(10);
    pad.group.position.set(x, 0.02, z);
    this.scene.add(pad.group);
    this.padRing = pad.ring;
    const hangar = new THREE.Group();
    const shell = new THREE.Mesh(
      G.custom('hangar', () => new THREE.CylinderGeometry(6.5, 6.5, 14, 18, 1, false, 0, Math.PI).rotateZ(Math.PI / 2).rotateY(Math.PI / 2)),
      toon(0x7d8a6a)
    );
    shell.position.y = 0;
    hangar.add(shell);
    const door = new THREE.Mesh(G.box(8, 5, 0.3), toon(0x3b4232));
    door.position.set(0, 2.5, 7);
    hangar.add(door);
    hangar.position.set(x - 15, 0, z - 15);
    hangar.rotation.y = Math.PI / 2;
    enableShadows(hangar);
    this.scene.add(hangar);
    for (let i = 0; i < 3; i++) {
      const tank = new THREE.Mesh(G.cyl(1.8, 1.8, 3.6, 12), toon(0x5c8f3c));
      tank.position.set(x + 14, 1.8, z - 12 + i * 4.6);
      enableShadows(tank);
      this.scene.add(tank);
    }
    const flagPole = new THREE.Mesh(G.cyl(0.1, 0.1, 10, 6), toon(0xdddddd));
    flagPole.position.set(x + 12, 5, z + 14);
    this.scene.add(flagPole);
    const flag = new THREE.Mesh(G.box(0.05, 1.8, 3), toon(0x2f80c8));
    flag.position.set(x + 12, 9, z + 15.5);
    this.scene.add(flag);
    this.baseFlag = flag;
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      const sb = new THREE.Mesh(G.box(3, 1.2, 1.4), toon(0xd8c08a));
      sb.position.set(x + Math.cos(a) * 21, 0.6, z + Math.sin(a) * 21);
      sb.rotation.y = -a;
      enableShadows(sb);
      this.scene.add(sb);
    }
    this.softShadow(x - 15, z - 15, 15, 14, 14, 0.4);
  }

  makeHarbor() {
    const rng = this.rng;
    const L = MAP.L;
    for (let n = 0; n < 4; n++) {
      const z = -150 + n * 90;
      const pier = new THREE.Mesh(G.box(26, 0.8, 5), toon(0x9b7653));
      pier.position.set(-L - 10, 0.1, z);
      enableShadows(pier);
      this.scene.add(pier);
      for (let p = 0; p < 4; p++) {
        const post = new THREE.Mesh(G.cyl(0.35, 0.35, 3, 6), toon(0x6b4a2b));
        post.position.set(-L - 20 + p * 6, -1, z + 2.6);
        this.scene.add(post);
      }
      if (rng.chance(0.8)) this.addBoat(-L - 14 + rng.float(-3, 3), z + 7, Math.PI / 2 + rng.float(-0.2, 0.2));
    }
    // портовые краны
    for (let n = 0; n < 2; n++) {
      const crane = new THREE.Group();
      const yellow = toon(0xf2b632);
      for (const sx of [-1, 1])
        for (const sz of [-1, 1]) {
          const leg = new THREE.Mesh(G.box(0.8, 16, 0.8), yellow);
          leg.position.set(sx * 3, 8, sz * 3);
          crane.add(leg);
        }
      const beam = new THREE.Mesh(G.box(2, 2, 30), yellow);
      beam.position.set(0, 17, -4);
      beam.rotation.y = Math.PI / 2;
      crane.add(beam);
      const cab = new THREE.Mesh(G.box(3, 2.5, 3), toon(0xd8463c));
      cab.position.set(0, 14.5, 0);
      crane.add(cab);
      crane.position.set(-L + 8, 0, -100 + n * 140);
      enableShadows(crane);
      this.scene.add(crane);
    }
    // маяк
    const lh = new THREE.Group();
    for (let i = 0; i < 5; i++) {
      const seg = new THREE.Mesh(G.cyl(2.2 - i * 0.25, 2.4 - i * 0.25, 3, 14), toon(i % 2 ? 0xd8463c : 0xf5f5f5));
      seg.position.y = 1.5 + i * 3;
      lh.add(seg);
    }
    const lamp = new THREE.Mesh(G.sphere(1.3, 12, 8), glow(0xffe9a0));
    lamp.position.y = 16.5;
    lh.add(lamp);
    const capm = new THREE.Mesh(G.cone(1.8, 1.6, 12), toon(0x333333));
    capm.position.y = 18;
    lh.add(capm);
    lh.position.set(-L + 26, 0, -L + 26);
    enableShadows(lh);
    this.scene.add(lh);
    for (let i = 0; i < 5; i++) {
      const a = rng.float(0, Math.PI * 2);
      const r = rng.float(300, 360);
      this.addBoat(Math.cos(a) * r, Math.sin(a) * r, rng.float(0, 6));
    }
  }

  addBoat(x, z, rot) {
    const b = new THREE.Group();
    const hull = new THREE.Mesh(G.box(3, 1.4, 8), toon(this.rng.pick([0xf5f5f5, 0xd8463c, 0x2f80c8])));
    hull.position.y = 0.3;
    b.add(hull);
    const bow = new THREE.Mesh(G.cone(1.5, 2.6, 4), hull.material);
    bow.rotation.x = Math.PI / 2;
    bow.rotation.y = Math.PI / 4;
    bow.position.set(0, 0.3, 5.2);
    bow.scale.set(1.4, 1, 0.65);
    b.add(bow);
    const cab = new THREE.Mesh(G.box(2.2, 1.6, 2.6), toon(0xf2e6c8));
    cab.position.set(0, 1.7, -1);
    b.add(cab);
    b.position.set(x, -0.5, z);
    b.rotation.y = rot;
    enableShadows(b);
    this.scene.add(b);
    (this.boats ||= []).push({ obj: b, phase: this.rng.float(0, 6) });
  }

  makeClouds() {
    this.clouds = [];
    const rng = this.rng;
    for (let i = 0; i < 9; i++) {
      const mat = new THREE.MeshToonMaterial({ color: this.night ? 0x5a6a90 : 0xffffff, gradientMap: gradientMap(), transparent: true, opacity: 0.5, depthWrite: false });
      this.disposables.push(() => mat.dispose());
      const c = new THREE.Group();
      const n = rng.int(3, 5);
      for (let k = 0; k < n; k++) {
        const m = new THREE.Mesh(G.ico(1, 1), mat);
        const s = rng.float(5, 9);
        m.scale.set(s, s * 0.6, s);
        m.position.set(rng.float(-8, 8), rng.float(-1, 1), rng.float(-5, 5));
        m.castShadow = true;
        c.add(m);
      }
      c.position.set(rng.float(-300, 300), rng.float(48, 56), rng.float(-300, 300));
      this.scene.add(c);
      this.clouds.push({ obj: c, mat });
    }
  }

  // ---------- запросы ----------
  registerProp(it) {
    const key = Math.floor((it.x + 300) / 20) * 1000 + Math.floor((it.z + 300) / 20);
    if (!this.pGrid.has(key)) this.pGrid.set(key, []);
    this.pGrid.get(key).push(it);
  }

  buildingsNear(x, z, r) {
    const out = new Set();
    const c0x = Math.floor((x - r + 300) / 30), c1x = Math.floor((x + r + 300) / 30);
    const c0z = Math.floor((z - r + 300) / 30), c1z = Math.floor((z + r + 300) / 30);
    for (let cx = c0x; cx <= c1x; cx++)
      for (let cz = c0z; cz <= c1z; cz++) {
        const list = this.bGrid.get(cx * 1000 + cz);
        if (list) for (const b of list) if (b.alive) out.add(b);
      }
    return out;
  }

  // Максимальная высота зданий в радиусе — для автоматического набора высоты.
  clearance(x, z, r) {
    let h = 0;
    for (const b of this.buildingsNear(x, z, r)) {
      if (Math.abs(x - b.x) < b.w / 2 + r && Math.abs(z - b.z) < b.d / 2 + r) h = Math.max(h, b.top);
    }
    return h;
  }

  buildingAt(x, y, z) {
    const list = this.bGrid.get(Math.floor((x + 300) / 30) * 1000 + Math.floor((z + 300) / 30));
    if (!list) return null;
    for (const b of list) {
      if (b.alive && y < b.top && Math.abs(x - b.x) < b.w / 2 && Math.abs(z - b.z) < b.d / 2) return b;
    }
    return null;
  }

  damageBuilding(b, dmg) {
    if (!b.alive) return false;
    b.hp -= dmg;
    b.shake = 0.25;
    if (b.hp <= 0) {
      b.alive = false;
      this.collapsing.push({ b, t: 0 });
      return true;
    }
    return false;
  }

  // Взрыв задевает деревья, машины, фонари, контейнеры, цистерны.
  blast(x, z, r) {
    const out = [];
    const c0x = Math.floor((x - r - 3 + 300) / 20), c1x = Math.floor((x + r + 3 + 300) / 20);
    const c0z = Math.floor((z - r - 3 + 300) / 20), c1z = Math.floor((z + r + 3 + 300) / 20);
    for (let cx = c0x; cx <= c1x; cx++)
      for (let cz = c0z; cz <= c1z; cz++) {
        const list = this.pGrid.get(cx * 1000 + cz);
        if (!list) continue;
        for (const it of list) {
          if (!it.alive) continue;
          if (Math.hypot(it.x - x, it.z - z) < r + it.set.opts.radius) {
            it.set.hide(it);
            out.push(it);
          }
        }
      }
    for (const it of out) this.onPropDestroyed?.(it);
    this.traffic.blast(x, z, r);
    return out;
  }

  // ---------- дорожный граф ----------
  nodePos(i, j) {
    return { x: ROADS[i], z: ROADS[j] };
  }
  nearestNode(x, z) {
    let bi = 0, bj = 0, bd = Infinity;
    for (let i = 0; i < 9; i++)
      for (let j = 0; j < 9; j++) {
        const d = Math.hypot(ROADS[i] - x, ROADS[j] - z);
        if (d < bd) {
          bd = d;
          bi = i;
          bj = j;
        }
      }
    return [bi, bj];
  }
  neighbors(i, j) {
    const out = [];
    if (i > 0) out.push([i - 1, j]);
    if (i < 8) out.push([i + 1, j]);
    if (j > 0) out.push([i, j - 1]);
    if (j < 8) out.push([i, j + 1]);
    return out;
  }

  randomStreetPoint(rng, minDistFromBase = 90) {
    for (let t = 0; t < 50; t++) {
      const r = rng.pick(ROADS);
      const s = rng.float(-240, 240);
      const [x, z] = rng.chance(0.5) ? [r + rng.float(-5, 5), s] : [s, r + rng.float(-5, 5)];
      if (Math.hypot(x - this.base.x, z - this.base.z) > minDistFromBase) return { x, z };
    }
    return { x: 0, z: 0 };
  }

  // ---------- кадр ----------
  update(dt, focus, camPos) {
    this.time += dt;
    this.water.uniforms.uTime.value = this.time;
    this.traffic.update(dt);
    for (const b of this.boats || []) {
      b.obj.position.y = -0.5 + Math.sin(this.time * 1.3 + b.phase) * 0.25;
      b.obj.rotation.z = Math.sin(this.time * 1.1 + b.phase) * 0.06;
    }
    for (const c of this.clouds) {
      c.obj.position.x += dt * 2.2;
      c.obj.position.z += dt * 1.1;
      if (c.obj.position.x > 340) c.obj.position.x -= 680;
      if (c.obj.position.z > 340) c.obj.position.z -= 680;
      // облако не должно закрывать вертолёт: гасим его возле камеры и над игроком
      const d = Math.hypot(c.obj.position.x - focus.x, c.obj.position.z - focus.z);
      const dc = camPos ? camPos.distanceTo(c.obj.position) : 999;
      c.mat.opacity = Math.min(clamp((d - 20) / 40, 0.0, 0.55), clamp((dc - 45) / 50, 0.0, 0.55));
      c.obj.visible = c.mat.opacity > 0.02;
    }
    if (this.padRing) this.padRing.material.opacity = 0.55 + Math.sin(this.time * 4) * 0.3;
    if (this.baseFlag) this.baseFlag.rotation.y = Math.sin(this.time * 3) * 0.25;
    for (const b of this.buildings) {
      if (b.shake > 0 && b.alive) {
        b.shake -= dt;
        b.group.position.x = b.x + (Math.random() - 0.5) * b.shake * 1.2;
        b.group.position.z = b.z + (Math.random() - 0.5) * b.shake * 1.2;
        if (b.shake <= 0) b.group.position.set(b.x, 0, b.z);
      }
    }
    for (let i = this.collapsing.length - 1; i >= 0; i--) {
      const c = this.collapsing[i];
      c.t += dt;
      const p = Math.min(c.t / 1.6, 1);
      const b = c.b;
      b.group.position.set(b.x + (Math.random() - 0.5) * 0.8, -b.top * p * p, b.z + (Math.random() - 0.5) * 0.8);
      b.group.rotation.z = p * 0.08;
      if (p >= 1) {
        this.scene.remove(b.group);
        const rubble = new THREE.Mesh(G.ico(1, 0), toon(b.wallColor));
        rubble.scale.set(b.w * 0.55, Math.min(3 + b.h * 0.1, 5), b.d * 0.55);
        rubble.position.set(b.x, 0, b.z);
        rubble.castShadow = rubble.receiveShadow = true;
        this.scene.add(rubble);
        this.collapsing.splice(i, 1);
      }
    }
  }

  dispose() {
    for (const d of this.disposables) d();
    this.disposables = [];
  }
}

// Мирный трафик по дорожной сетке.
class Traffic {
  constructor(world, n) {
    this.world = world;
    this.cars = [];
    const rng = world.rng;
    this.mesh = new THREE.InstancedMesh(carGeometry(), toon(0xffffff, { vertexColors: true }), n);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    for (let k = 0; k < n; k++) {
      const i = rng.int(0, 8), j = rng.int(0, 8);
      const nb = rng.pick(world.neighbors(i, j));
      const car = { from: [i, j], to: nb, t: rng.float(0, 1), speed: rng.float(9, 14), alive: true, yaw: 0, x: 0, z: 0 };
      this.mesh.setColorAt(k, _c.set(rng.pick(CAR_COLORS)));
      this.cars.push(car);
    }
    this.mesh.instanceColor.needsUpdate = true;
    world.scene.add(this.mesh);
    this.update(0);
  }
  update(dt) {
    const w = this.world;
    this.cars.forEach((car, k) => {
      if (!car.alive) return;
      const a = w.nodePos(...car.from), b = w.nodePos(...car.to);
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      car.t += (car.speed * dt) / len;
      if (car.t >= 1) {
        car.t -= 1;
        const opts = w.neighbors(...car.to).filter((n) => n[0] !== car.from[0] || n[1] !== car.from[1]);
        car.from = car.to;
        car.to = w.rng.pick(opts);
      }
      const p = w.nodePos(...car.from), q = w.nodePos(...car.to);
      const fx = Math.sign(q.x - p.x), fz = Math.sign(q.z - p.z);
      car.x = p.x + (q.x - p.x) * car.t + fz * 3;
      car.z = p.z + (q.z - p.z) * car.t - fx * 3;
      const targetYaw = Math.atan2(fx, fz);
      let d = targetYaw - car.yaw;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      car.yaw += d * Math.min(1, dt * 8);
      _q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, car.yaw);
      _m.compose(_p.set(car.x, 0, car.z), _q, _s.set(1, 1, 1));
      this.mesh.setMatrixAt(k, _m);
    });
    this.mesh.instanceMatrix.needsUpdate = true;
  }
  blast(x, z, r) {
    this.cars.forEach((car, k) => {
      if (car.alive && Math.hypot(car.x - x, car.z - z) < r + 2.2) {
        car.alive = false;
        this.mesh.setMatrixAt(k, ZERO);
        this.world.onPropDestroyed?.({ x: car.x, y: 0, z: car.z, set: { opts: { kind: 'car', debris: 0x555555 } }, civilian: true });
      }
    });
  }
}

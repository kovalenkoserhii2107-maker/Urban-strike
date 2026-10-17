import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { Rng, clamp } from '../core/utils.js';
import { pbr, glow, G } from './materials.js';
import { T } from './textures.js';
import { Terrain, WORLD, LAYOUT, landSdf } from './terrain.js';
import { PropSet, GEO, MAT, CAR_COLORS } from './props.js';
import { buildCity } from './city.js';
import { buildRegions } from './regions.js';

export { WORLD, LAYOUT };

// Время суток: положение солнца для неба, свет, туман, вода.
export const LIGHTING = {
  day: {
    elevation: 46, azimuth: 140, turbidity: 5, rayleigh: 1.4, mie: 0.004,
    sun: [0xfff2df, 2.6], hemi: [0xcfe2ff, 0x5a6447, 0.35], fog: [0xb9cfdf, 0.0019], exposure: 0.9, env: 0.06,
    night: false, water: [0x0b3a57, 0x2c8c95], horizon: 0xc9dbe6, zenith: 0x4f86c6,
  },
  sunset: {
    elevation: 8, azimuth: 250, turbidity: 9, rayleigh: 2.8, mie: 0.006,
    sun: [0xffa463, 2.6], hemi: [0xffc6a0, 0x463c4a, 0.35], fog: [0xd79a7a, 0.0022], exposure: 1.0, env: 0.08,
    night: false, water: [0x1c3049, 0x5b6a74], horizon: 0xf2a77c, zenith: 0x5a6aa8,
  },
  night: {
    elevation: 52, azimuth: 60, turbidity: 2, rayleigh: 0.2, mie: 0.002, skyElevation: -6,
    sun: [0x9db4ff, 0.7], hemi: [0x34437a, 0x0c1018, 0.4], fog: [0x0b1426, 0.0026], exposure: 1.2, env: 0.5,
    night: true, water: [0x04111f, 0x0f2c44], horizon: 0x15233d, zenith: 0x060b18,
  },
};

class RoadGraph {
  constructor() {
    this.nodes = [];
  }
  add(x, y, z) {
    const n = { id: this.nodes.length, x, y, z, nbrs: [] };
    this.nodes.push(n);
    return n;
  }
  link(a, b) {
    if (a === b || a.nbrs.includes(b)) return;
    a.nbrs.push(b);
    b.nbrs.push(a);
  }
  nearest(x, z, filter = null) {
    let best = null, bd = Infinity;
    for (const n of this.nodes) {
      if (filter && !filter(n)) continue;
      const d = (n.x - x) ** 2 + (n.z - z) ** 2;
      if (d < bd) {
        bd = d;
        best = n;
      }
    }
    return best;
  }
  // Следующий узел: не разворачиваемся, если есть куда ехать дальше.
  next(from, to, rnd = Math.random) {
    const opts = to.nbrs.filter((n) => n !== from);
    const list = opts.length ? opts : to.nbrs;
    return list[Math.floor(rnd() * list.length)];
  }
}

export class World {
  constructor(scene, renderer, { seed = 1, lighting = 'day', density = 1 } = {}) {
    this.scene = scene;
    this.renderer = renderer;
    this.rng = new Rng(seed);
    this.density = density;
    this.disposables = [];
    this.buildings = [];
    this.bGrid = new Map();
    this.pGrid = new Map();
    this.collapsing = [];
    this.chimneys = [];
    this.onPropDestroyed = null;
    this.onSmoke = null;
    this.time = 0;
    this.graph = new RoadGraph();
    this.regions = {};
    this.sites = {};
    this.lampMat = pbr(0xdedede, { emissive: 0xffd58a, emissiveIntensity: 0 });
    this.waterLevel = WORLD.waterY;

    this.terrain = getTerrain();
    this.terrain.buildMeshes(scene, LIGHTING[lighting]);
    this.disposables.push(() => this.terrain.dispose());
    this.makeLights();
    this.makeWater();
    this.makeProps();
    buildCity(this);
    buildRegions(this);
    this.buildHighways();
    for (const set of Object.values(this.sets)) set.build(scene);
    this.traffic = new Traffic(this, Math.round(34 * density));
    this.setLighting(lighting);
  }

  // ---------- свет и небо ----------
  makeLights() {
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 0.5);
    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.castShadow = true;
    const cam = this.sun.shadow.camera;
    cam.left = cam.bottom = -75;
    cam.right = cam.top = 75;
    cam.near = 10;
    cam.far = 420;
    this.sun.shadow.bias = -0.0005;
    this.sun.shadow.normalBias = 0.05;
    this.sunDir = new THREE.Vector3(0, 1, 0);
    this.scene.add(this.hemi, this.sun, this.sun.target);
    this.sky = new Sky();
    this.sky.scale.setScalar(450);
    this.skyScene = new THREE.Scene();
    this.skyScene.add(this.sky);
    this.pmrem = new THREE.PMREMGenerator(this.renderer);
  }

  setLighting(name) {
    const L = LIGHTING[name];
    this.lightingName = name;
    this.light = L;
    this.night = L.night;
    const phi = THREE.MathUtils.degToRad(90 - L.elevation);
    const theta = THREE.MathUtils.degToRad(L.azimuth);
    this.sunDir.setFromSphericalCoords(1, phi, theta);
    const u = this.sky.material.uniforms;
    u.turbidity.value = L.turbidity;
    u.rayleigh.value = L.rayleigh;
    u.mieCoefficient.value = L.mie;
    u.mieDirectionalG.value = 0.8;
    const skySun = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - (L.skyElevation ?? L.elevation)), theta);
    u.sunPosition.value.copy(skySun);
    if (this.envRT) this.envRT.dispose();
    this.envRT = this.pmrem.fromScene(this.skyScene, 0, 0.1, 1000);
    this.scene.environment = this.envRT.texture;
    this.scene.environmentIntensity = L.env;
    this.scene.background = new THREE.Color(L.fog[0]);
    this.scene.fog = new THREE.FogExp2(L.fog[0], L.fog[1]);
    this.sun.color.set(L.sun[0]);
    this.sun.intensity = L.sun[1];
    this.hemi.color.set(L.hemi[0]);
    this.hemi.groundColor.set(L.hemi[1]);
    this.hemi.intensity = L.hemi[2];
    this.renderer.toneMappingExposure = L.exposure;
    for (const m of this.facadeMats || []) m.emissiveIntensity = L.night ? 1.4 : 0;
    this.lampMat.emissiveIntensity = L.night ? 3 : 0;
    const w = this.water.uniforms;
    w.uDeep.value.set(L.water[0]);
    w.uShallow.value.set(L.water[1]);
    w.uHorizon.value.set(L.horizon);
    w.uZenith.value.set(L.zenith);
    w.uSunDir.value.copy(this.sunDir);
    w.uSunColor.value.set(L.sun[0]).multiplyScalar(L.night ? 0.6 : 1.6);
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
    const step = (150 / this.sun.shadow.mapSize.x) * 2;
    const sx = Math.round(x / step) * step, sz = Math.round(z / step) * step;
    const y = this.heightAt(sx, sz);
    this.sun.target.position.set(sx, y, sz);
    this.sun.position.set(sx + this.sunDir.x * 220, y + Math.max(this.sunDir.y, 0.15) * 220, sz + this.sunDir.z * 220);
  }

  // ---------- вода ----------
  makeWater() {
    const mat = new THREE.ShaderMaterial({
      fog: true,
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        {
          uTime: { value: 0 },
          uNormal: { value: null },
          uDepth: { value: null },
          uDeep: { value: new THREE.Color() },
          uShallow: { value: new THREE.Color() },
          uHorizon: { value: new THREE.Color() },
          uZenith: { value: new THREE.Color() },
          uFoam: { value: new THREE.Color(0xeef4f6) },
          uSunDir: { value: new THREE.Vector3(0, 1, 0) },
          uSunColor: { value: new THREE.Color() },
          uHalf: { value: WORLD.half },
        },
      ]),
      vertexShader: /* glsl */ `
        uniform float uTime;
        varying vec3 vWorld;
        #include <fog_pars_vertex>
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          wp.y += sin(wp.x * 0.05 + uTime * 0.9) * 0.12 + cos(wp.z * 0.043 + uTime * 0.7) * 0.12;
          vWorld = wp.xyz;
          vec4 mvPosition = viewMatrix * wp;
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */ `
        uniform float uTime, uHalf;
        uniform sampler2D uNormal, uDepth;
        uniform vec3 uDeep, uShallow, uHorizon, uZenith, uFoam, uSunDir, uSunColor;
        varying vec3 vWorld;
        #include <fog_pars_fragment>
        void main() {
          vec2 p = vWorld.xz;
          vec3 n1 = texture2D(uNormal, p * 0.011 + vec2(uTime * 0.010, uTime * 0.006)).xyz * 2.0 - 1.0;
          vec3 n2 = texture2D(uNormal, p * 0.027 + vec2(-uTime * 0.012, uTime * 0.014)).xyz * 2.0 - 1.0;
          vec3 n = normalize(vec3(n1.x + n2.x * 0.7, 2.6, n1.y + n2.y * 0.7));
          vec3 V = normalize(cameraPosition - vWorld);
          float fres = 0.02 + 0.98 * pow(1.0 - max(dot(n, V), 0.0), 5.0);
          vec3 R = reflect(-V, n);
          vec3 sky = mix(uHorizon, uZenith, clamp(R.y * 1.4, 0.0, 1.0));
          float spec = pow(max(dot(R, uSunDir), 0.0), 260.0) * 3.0 + pow(max(dot(R, uSunDir), 0.0), 24.0) * 0.12;
          float depth = texture2D(uDepth, (p + uHalf) / (2.0 * uHalf)).r * 255.0 / 16.0 - 2.0;
          vec3 water = mix(uShallow, uDeep, smoothstep(0.0, 10.0, depth));
          vec3 col = mix(water, sky, fres * 0.85) + uSunColor * spec;
          float fn = texture2D(uNormal, p * 0.06 + vec2(uTime * 0.02, 0.0)).r;
          float shore = 1.0 - smoothstep(0.0, 1.4, depth);
          float wave = sin(depth * 3.2 - uTime * 1.8) * 0.5 + 0.5;
          float foam = shore * smoothstep(0.45, 0.8, fn * 0.55 + wave * 0.55);
          col = mix(col, uFoam, clamp(foam + smoothstep(0.35, 0.0, depth) * 0.6, 0.0, 1.0) * 0.8);
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          #include <fog_fragment>
        }`,
    });
    mat.uniforms.uNormal.value = T.waterNormal();
    mat.uniforms.uDepth.value = this.terrain.depthTexture();
    const geo = new THREE.PlaneGeometry(6000, 6000, 90, 90).rotateX(-Math.PI / 2);
    const water = new THREE.Mesh(geo, mat);
    water.position.y = WORLD.waterY;
    this.scene.add(water);
    this.water = mat;
    this.disposables.push(() => {
      geo.dispose();
      mat.dispose();
      mat.uniforms.uDepth.value.dispose();
    });
  }

  // ---------- наборы объектов ----------
  makeProps() {
    const foliage = MAT.foliage();
    this.sets = {
      trees: new PropSet(this, [{ geo: GEO.tree(0), mat: foliage, colorize: true }], { kind: 'tree', radius: 2, debris: 0x4f7a3a }),
      trees2: new PropSet(this, [{ geo: GEO.tree(1), mat: foliage, colorize: true }], { kind: 'tree', radius: 2, debris: 0x4f7a3a }),
      pines: new PropSet(this, [{ geo: GEO.pine(), mat: foliage, colorize: true }], { kind: 'tree', radius: 2, debris: 0x2f5a3a }),
      bushes: new PropSet(this, [{ geo: GEO.bush(), mat: foliage, colorize: true }], { kind: 'bush', radius: 1.2, debris: 0x4a7a34 }),
      palms: new PropSet(this, [{ geo: GEO.palm(), mat: MAT.plain({ roughness: 0.9, side: THREE.DoubleSide }) }], { kind: 'tree', radius: 2, debris: 0x3f7d36 }),
      lamps: new PropSet(this, [
        { geo: G.cyl(0.1, 0.14, 7, 6).clone().translate(0, 3.5, 0), mat: pbr(0x3a3e44, { metalness: 0.7, roughness: 0.45 }) },
        { geo: G.box(0.12, 0.12, 1.8).clone().translate(0, 6.9, 0.8), mat: pbr(0x3a3e44, { metalness: 0.7, roughness: 0.45 }) },
        { geo: G.box(0.55, 0.2, 0.9).clone().translate(0, 6.8, 1.6), mat: this.lampMat },
      ], { kind: 'lamp', radius: 0.8, debris: 0x3a3e44 }),
      cars: new PropSet(this, [{ geo: GEO.car(), mat: MAT.car(), colorize: true }], { kind: 'car', radius: 2.3, debris: 0x555555 }),
      containers: new PropSet(this, [{ geo: G.box(2.6, 2.6, 6.2), mat: pbr(0xffffff, { roughness: 0.6, metalness: 0.4 }), colorize: true }], { kind: 'container', radius: 3, debris: 0x8a5a35 }),
      barrels: new PropSet(this, [
        { geo: G.cyl(2.4, 2.4, 4.6, 18).clone().translate(0, 2.3, 0), mat: pbr(0xe4e6e8, { roughness: 0.35, metalness: 0.6 }) },
        { geo: G.cyl(2.45, 2.45, 0.5, 18).clone().translate(0, 3.6, 0), mat: pbr(0xb83a2e, { roughness: 0.5, metalness: 0.3 }) },
      ], { kind: 'explosive', radius: 2.8, debris: 0xb83a2e }),
      rocks: new PropSet(this, [{ geo: G.custom('rock', () => new THREE.DodecahedronGeometry(1.4, 1)), mat: pbr(0x8a847a, { roughness: 0.95, flatShading: true }) }], { receive: true }),
      hay: new PropSet(this, [{ geo: G.cyl(1.2, 1.2, 1.4, 14).clone().rotateZ(Math.PI / 2).translate(0, 1.2, 0), mat: pbr(0xd2b45a, { roughness: 1 }) }], { kind: 'bush', radius: 1.4, debris: 0xd2b45a }),
      fence: new PropSet(this, [{ geo: G.box(0.12, 2.2, 4).clone().translate(0, 1.1, 0), mat: pbr(0x8f9499, { roughness: 0.5, metalness: 0.6, transparent: true, opacity: 0.7 }) }], { cast: false }),
    };
  }

  treeColor() {
    const c = new THREE.Color();
    return c.setHSL(this.rng.float(0.2, 0.3), this.rng.float(0.35, 0.55), this.rng.float(0.25, 0.36)).getHex();
  }

  addTree(x, z, s = this.rng.float(0.8, 1.2), pine = null) {
    const y = this.heightAt(x, z) - 0.1;
    const isPine = pine ?? this.rng.chance(0.3);
    if (isPine) this.sets.pines.add(x, y, z, this.rng.float(0, 6), s, s * this.rng.float(0.9, 1.25), s, this.pineColor());
    else (this.rng.chance(0.5) ? this.sets.trees : this.sets.trees2).add(x, y, z, this.rng.float(0, 6), s, s * this.rng.float(0.85, 1.15), s, this.treeColor());
  }

  pineColor() {
    return new THREE.Color().setHSL(this.rng.float(0.28, 0.38), this.rng.float(0.3, 0.45), this.rng.float(0.18, 0.26)).getHex();
  }

  // ---------- трассы ----------
  buildHighways() {
    const pos = [], uv = [], idx = [];
    const mpos = [], midx = [];
    const W = 5.6;
    for (const road of this.terrain.roads) {
      let dist = 0;
      const base = pos.length / 3;
      for (let k = 0; k < road.length; k++) {
        const p = road[k];
        const a = road[Math.max(k - 1, 0)], b = road[Math.min(k + 1, road.length - 1)];
        let dx = b.x - a.x, dz = b.z - a.z;
        const l = Math.hypot(dx, dz) || 1;
        dx /= l;
        dz /= l;
        if (k > 0) dist += Math.hypot(p.x - road[k - 1].x, p.z - road[k - 1].z);
        const nx = -dz, nz = dx;
        pos.push(p.x + nx * W, p.y + 0.12, p.z + nz * W, p.x - nx * W, p.y + 0.12, p.z - nz * W);
        uv.push(0, dist / 11, 1.0, dist / 11);
        if (k > 0) {
          const i = base + k * 2;
          idx.push(i - 2, i - 1, i, i - 1, i + 1, i);
        }
        // пунктир по оси
        if (k > 0 && Math.floor(dist / 6) % 2 === 0) {
          const q = road[k - 1];
          const m = mpos.length / 3;
          const w = 0.16;
          mpos.push(q.x + nx * w, q.y + 0.16, q.z + nz * w, q.x - nx * w, q.y + 0.16, q.z - nz * w, p.x + nx * w, p.y + 0.16, p.z + nz * w, p.x - nx * w, p.y + 0.16, p.z - nz * w);
          midx.push(m, m + 1, m + 2, m + 1, m + 3, m + 2);
        }
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, pbr(0xffffff, { map: T.asphalt(), roughness: 0.92 }));
    mesh.receiveShadow = true;
    this.scene.add(mesh);
    const mg = new THREE.BufferGeometry();
    mg.setAttribute('position', new THREE.Float32BufferAttribute(mpos, 3));
    mg.setIndex(midx);
    mg.computeVertexNormals();
    this.scene.add(new THREE.Mesh(mg, pbr(0xe8c443, { roughness: 0.6 })));
    this.disposables.push(() => {
      geo.dispose();
      mg.dispose();
    });
    // узлы графа вдоль трасс: каждые ~40 м, концы цепляются к ближайшим узлам регионов
    for (const road of this.terrain.roads) {
      let prev = null, first = null;
      for (let k = 0; k < road.length - 1; k += 5) {
        const p = road[k];
        const node = this.graph.add(p.x, p.y, p.z);
        if (prev) this.graph.link(prev, node);
        first ||= node;
        prev = node;
      }
      const last = road.at(-1);
      const end = this.graph.add(last.x, last.y, last.z);
      this.graph.link(prev, end);
      // концы трассы цепляются к ближайшему узлу района (город, база, деревня)
      for (const tip of [first, end]) {
        const near = this.graph.nearest(tip.x, tip.z, (n) => n.region && Math.hypot(n.x - tip.x, n.z - tip.z) < 90);
        if (near) this.graph.link(tip, near);
      }
    }
  }

  // ---------- запросы ----------
  heightAt(x, z) {
    return this.terrain.sample(x, z);
  }
  isWater(x, z) {
    return this.terrain.sample(x, z) < WORLD.waterY + 0.2;
  }
  regionAt(x, z) {
    for (const [id, r] of Object.entries(LAYOUT)) {
      if (Array.isArray(r)) {
        for (const v of r) if (Math.hypot(x - v.x, z - v.z) < (v.r ?? 30) + 30) return v.name;
      } else if (r.hx) {
        if (Math.abs(x - r.x) < r.hx && Math.abs(z - r.z) < r.hz) return r.name;
      } else if (id === 'mountains' && Math.hypot(x - r.x, z - r.z) < r.r) return r.name;
    }
    return landSdf(x, z) > 0 ? 'Открытое море' : 'Холмы';
  }

  registerProp(it) {
    const key = Math.floor(it.x / 20) * 100000 + Math.floor(it.z / 20);
    if (!this.pGrid.has(key)) this.pGrid.set(key, []);
    this.pGrid.get(key).push(it);
  }

  addBuildingRecord(bld) {
    this.buildings.push(bld);
    const c0x = Math.floor((bld.x - bld.w / 2) / 30), c1x = Math.floor((bld.x + bld.w / 2) / 30);
    const c0z = Math.floor((bld.z - bld.d / 2) / 30), c1z = Math.floor((bld.z + bld.d / 2) / 30);
    for (let cx = c0x; cx <= c1x; cx++)
      for (let cz = c0z; cz <= c1z; cz++) {
        const key = cx * 100000 + cz;
        if (!this.bGrid.has(key)) this.bGrid.set(key, []);
        this.bGrid.get(key).push(bld);
      }
  }

  buildingsNear(x, z, r) {
    const out = new Set();
    const c0x = Math.floor((x - r) / 30), c1x = Math.floor((x + r) / 30);
    const c0z = Math.floor((z - r) / 30), c1z = Math.floor((z + r) / 30);
    for (let cx = c0x; cx <= c1x; cx++)
      for (let cz = c0z; cz <= c1z; cz++) {
        const list = this.bGrid.get(cx * 100000 + cz);
        if (list) for (const b of list) if (b.alive) out.add(b);
      }
    return out;
  }

  // Высота препятствий под вертолётом: рельеф и крыши.
  clearance(x, z, r) {
    let h = Math.max(this.heightAt(x, z), this.heightAt(x + r, z), this.heightAt(x - r, z), this.heightAt(x, z + r), this.heightAt(x, z - r));
    for (const b of this.buildingsNear(x, z, r)) {
      if (Math.abs(x - b.x) < b.w / 2 + r && Math.abs(z - b.z) < b.d / 2 + r) h = Math.max(h, b.y + b.top);
    }
    return h;
  }

  buildingAt(x, y, z) {
    const list = this.bGrid.get(Math.floor(x / 30) * 100000 + Math.floor(z / 30));
    if (!list) return null;
    for (const b of list) {
      if (b.alive && y < b.y + b.top && Math.abs(x - b.x) < b.w / 2 && Math.abs(z - b.z) < b.d / 2) return b;
    }
    return null;
  }

  damageBuilding(b, dmg) {
    if (!b.alive || b.indestructible) return false;
    b.hp -= dmg;
    b.shake = 0.25;
    if (b.hp <= 0) {
      b.alive = false;
      this.collapsing.push({ b, t: 0 });
      return true;
    }
    return false;
  }

  blast(x, z, r) {
    const out = [];
    const c0x = Math.floor((x - r - 3) / 20), c1x = Math.floor((x + r + 3) / 20);
    const c0z = Math.floor((z - r - 3) / 20), c1z = Math.floor((z + r + 3) / 20);
    for (let cx = c0x; cx <= c1x; cx++)
      for (let cz = c0z; cz <= c1z; cz++) {
        const list = this.pGrid.get(cx * 100000 + cz);
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

  randomStreetPoint(rng, region = 'city', minDistFromBase = 60) {
    const nodes = this.graph.nodes.filter((n) => n.region === region);
    for (let t = 0; t < 40; t++) {
      const a = rng.pick(nodes);
      if (!a?.nbrs.length) continue;
      const b = rng.pick(a.nbrs);
      const k = rng.float(0.15, 0.85);
      const x = a.x + (b.x - a.x) * k + rng.float(-4, 4), z = a.z + (b.z - a.z) * k + rng.float(-4, 4);
      if (Math.hypot(x - LAYOUT.fob.x, z - LAYOUT.fob.z) > minDistFromBase) return { x, z };
    }
    return { x: LAYOUT[region]?.x ?? 0, z: LAYOUT[region]?.z ?? 0 };
  }

  // ---------- кадр ----------
  update(dt, focus) {
    this.time += dt;
    this.water.uniforms.uTime.value = this.time;
    this.traffic.update(dt, focus);
    for (const b of this.boats || []) {
      b.obj.position.y = WORLD.waterY + 0.2 + Math.sin(this.time * 1.3 + b.phase) * 0.2;
      b.obj.rotation.z = Math.sin(this.time * 1.1 + b.phase) * 0.05;
    }
    if (this.padRings) for (const r of this.padRings) r.material.opacity = 0.55 + Math.sin(this.time * 4) * 0.3;
    for (const f of this.flags || []) f.rotation.y = f.userData.base + Math.sin(this.time * 3 + f.userData.phase) * 0.25;
    // дым из труб только рядом с игроком
    if (this.onSmoke) {
      for (const c of this.chimneys) {
        if (Math.abs(c.x - focus.x) > 160 || Math.abs(c.z - focus.z) > 160) continue;
        c.acc = (c.acc || 0) + dt;
        if (c.acc > 0.35) {
          c.acc = 0;
          this.onSmoke(c.x, c.y, c.z);
        }
      }
    }
    for (const b of this.buildings) {
      if (b.shake > 0 && b.alive) {
        b.shake -= dt;
        b.group.position.x = b.x + (Math.random() - 0.5) * b.shake * 1.2;
        b.group.position.z = b.z + (Math.random() - 0.5) * b.shake * 1.2;
        if (b.shake <= 0) b.group.position.set(b.x, b.y, b.z);
      }
    }
    for (let i = this.collapsing.length - 1; i >= 0; i--) {
      const c = this.collapsing[i];
      c.t += dt;
      const p = Math.min(c.t / 1.6, 1);
      const b = c.b;
      b.group.position.set(b.x + (Math.random() - 0.5) * 0.8, b.y - b.top * p * p, b.z + (Math.random() - 0.5) * 0.8);
      b.group.rotation.z = p * 0.08;
      if (p >= 1) {
        this.scene.remove(b.group);
        const rubble = new THREE.Mesh(G.custom('rubble', () => new THREE.DodecahedronGeometry(1, 1)), pbr(b.wallColor, { roughness: 1, flatShading: true }));
        rubble.scale.set(b.w * 0.55, Math.min(3 + b.h * 0.1, 5), b.d * 0.55);
        rubble.position.set(b.x, b.y, b.z);
        rubble.castShadow = rubble.receiveShadow = true;
        this.scene.add(rubble);
        this.collapsing.splice(i, 1);
      }
    }
  }

  dispose() {
    for (const d of this.disposables) d();
    this.disposables = [];
    this.envRT?.dispose();
    this.pmrem.dispose();
  }
}

// Рельеф считается один раз за сессию: он детерминирован.
let terrainCache = null;
export function getTerrain() {
  if (!terrainCache) terrainCache = new Terrain();
  return terrainCache;
}

// Мирный трафик по графу дорог (город, промзона, трассы).
class Traffic {
  constructor(world, n) {
    this.world = world;
    this.cars = [];
    const rng = world.rng;
    const g = world.graph;
    this.mesh = new THREE.InstancedMesh(GEO.car(), MAT.car(), n);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    const roadNodes = g.nodes.filter((nd) => nd.nbrs.length && (nd.region === 'city' || nd.region === 'industrial' || !nd.region));
    for (let k = 0; k < n; k++) {
      const from = rng.pick(roadNodes);
      const to = rng.pick(from.nbrs);
      this.cars.push({ from, to, t: rng.float(0, 1), speed: rng.float(9, 15), alive: true, yaw: 0, x: from.x, y: from.y, z: from.z });
      this.mesh.setColorAt(k, new THREE.Color(rng.pick(CAR_COLORS)));
    }
    this.mesh.instanceColor.needsUpdate = true;
    world.scene.add(this.mesh);
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._p = new THREE.Vector3();
    this._s = new THREE.Vector3(1, 1, 1);
    this.update(0, { x: 0, z: 0 });
  }
  update(dt) {
    const g = this.world.graph;
    this.cars.forEach((car, k) => {
      if (!car.alive) return;
      const a = car.from, b = car.to;
      const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
      car.t += (car.speed * dt) / len;
      if (car.t >= 1) {
        car.t -= 1;
        const nx = g.next(car.from, car.to);
        car.from = car.to;
        car.to = nx;
      }
      const p = car.from, q = car.to;
      const l2 = Math.hypot(q.x - p.x, q.z - p.z) || 1;
      const fx = (q.x - p.x) / l2, fz = (q.z - p.z) / l2;
      car.x = p.x + (q.x - p.x) * car.t + fz * 2.6;
      car.z = p.z + (q.z - p.z) * car.t - fx * 2.6;
      car.y = p.y + (q.y - p.y) * car.t + 0.12;
      const target = Math.atan2(fx, fz);
      let d = target - car.yaw;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      car.yaw += d * Math.min(1, dt * 6);
      const pitch = Math.atan2(q.y - p.y, l2);
      this._q.setFromEuler(new THREE.Euler(-pitch, car.yaw, 0, 'YXZ'));
      this._m.compose(this._p.set(car.x, car.y, car.z), this._q, this._s);
      this.mesh.setMatrixAt(k, this._m);
    });
    this.mesh.instanceMatrix.needsUpdate = true;
  }
  blast(x, z, r) {
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    this.cars.forEach((car, k) => {
      if (car.alive && Math.hypot(car.x - x, car.z - z) < r + 2.2) {
        car.alive = false;
        this.mesh.setMatrixAt(k, zero);
        this.world.onPropDestroyed?.({ x: car.x, y: car.y, z: car.z, set: { opts: { kind: 'car', debris: 0x555555 } }, civilian: true });
      }
    });
  }
}

export { clamp };

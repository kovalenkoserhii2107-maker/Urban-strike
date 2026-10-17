import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { G, pbr } from './materials.js';
import { valueNoise } from './noise.js';

const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _e = new THREE.Euler();
const _c = new THREE.Color();

export const CAR_COLORS = [0xb3261e, 0x1f4e8c, 0xd6b32a, 0xe9e9e6, 0x2c6e3f, 0x5b2d73, 0xc8661b, 0x2b2f36, 0x8a8f96, 0x101214];

export function colored(geo, color) {
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

// Затенение снизу кроны: имитация самозатенения листвы.
function shadeByHeight(geo, y0, y1, dark = 0.45) {
  const pos = geo.attributes.position, col = geo.attributes.color;
  for (let i = 0; i < pos.count; i++) {
    const t = Math.min(Math.max((pos.getY(i) - y0) / (y1 - y0), 0), 1);
    const k = dark + (1 - dark) * t;
    col.setXYZ(i, col.getX(i) * k, col.getY(i) * k, col.getZ(i) * k);
  }
  return geo;
}

export const GEO = {
  // Лиственное дерево: неровная крона из шума + ствол.
  tree: (variant = 0) =>
    G.custom('tree' + variant, () => {
      const crown = new THREE.IcosahedronGeometry(2.6, 1);
      const p = crown.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
        const k = 0.78 + valueNoise(x * 0.9 + variant * 5, z * 0.9 + y * 0.7, 3 + variant) * 0.45;
        p.setXYZ(i, x * k, y * k * 0.85, z * k);
      }
      crown.translate(0, 5.0, 0);
      const c = shadeByHeight(colored(crown, 0xffffff), 2.6, 7.2, 0.5);
      const trunk = colored(new THREE.CylinderGeometry(0.22, 0.38, 3.4, 7).translate(0, 1.7, 0), 0x5a4330);
      // трава/листья не тонируются стволом: ствол в отдельном атрибуте-маске
      trunk.setAttribute('tint', new THREE.BufferAttribute(new Float32Array(trunk.attributes.position.count).fill(0), 1));
      c.setAttribute('tint', new THREE.BufferAttribute(new Float32Array(c.attributes.position.count).fill(1), 1));
      return mergeGeometries([trunk, c]);
    }),
  pine: () =>
    G.custom('pine', () => {
      const parts = [colored(new THREE.CylinderGeometry(0.18, 0.3, 2.4, 6).translate(0, 1.2, 0), 0x4e3a28)];
      parts[0].setAttribute('tint', new THREE.BufferAttribute(new Float32Array(parts[0].attributes.position.count).fill(0), 1));
      for (let k = 0; k < 4; k++) {
        const cone = new THREE.ConeGeometry(2.4 - k * 0.5, 3.0, 9).translate(0, 2.6 + k * 1.6, 0);
        const g = shadeByHeight(colored(cone, 0xffffff), 1.1 + k * 1.6, 4.1 + k * 1.6, 0.55);
        g.setAttribute('tint', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count).fill(1), 1));
        parts.push(g);
      }
      return mergeGeometries(parts);
    }),
  bush: () =>
    G.custom('bushGeo', () => {
      const g = new THREE.IcosahedronGeometry(1.2, 1);
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const k = 0.8 + valueNoise(p.getX(i) * 2, p.getZ(i) * 2 + p.getY(i), 9) * 0.4;
        p.setXYZ(i, p.getX(i) * k, p.getY(i) * k * 0.7, p.getZ(i) * k);
      }
      const c = shadeByHeight(colored(g, 0xffffff), -0.8, 0.9, 0.5);
      c.setAttribute('tint', new THREE.BufferAttribute(new Float32Array(c.attributes.position.count).fill(1), 1));
      return c;
    }),
  palm: () =>
    G.custom('palmMerged', () => {
      const parts = [];
      for (let i = 0; i < 5; i++) {
        const seg = new THREE.CylinderGeometry(0.24 - i * 0.025, 0.3 - i * 0.025, 1.6, 7);
        seg.translate(i * 0.3, 0.8 + i * 1.5, 0);
        parts.push(colored(seg, 0x8a6d4f));
      }
      for (let k = 0; k < 7; k++) {
        const leaf = new THREE.PlaneGeometry(0.9, 3.6, 1, 4);
        const p = leaf.attributes.position;
        for (let i = 0; i < p.count; i++) {
          const t = (p.getY(i) + 1.8) / 3.6;
          p.setXYZ(i, p.getX(i) * (1 - t * 0.6), 0, (t * 3.6));
          p.setY(i, -t * t * 1.4);
        }
        leaf.rotateY((k / 7) * Math.PI * 2);
        leaf.translate(1.5, 7.6, 0);
        parts.push(colored(leaf, 0x3f7d36));
      }
      parts.push(colored(new THREE.SphereGeometry(0.4, 6, 4).translate(1.5, 7.5, 0), 0x5b3e24));
      return mergeGeometries(parts.map((g) => g.index ? g.toNonIndexed() : g));
    }),
  car: () =>
    G.custom('carMerged', () => {
      const body = new THREE.BoxGeometry(1.9, 0.7, 4.2, 2, 1, 4);
      // скругляем капот и багажник
      const p = body.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const z = p.getZ(i), y = p.getY(i);
        if (Math.abs(z) > 1.5 && y > 0) p.setY(i, y - 0.12);
      }
      const parts = [
        colored(body.translate(0, 0.72, 0), 0xffffff),
        colored(new THREE.BoxGeometry(1.7, 0.62, 2.0).translate(0, 1.36, -0.25), 0xffffff),
        colored(new THREE.BoxGeometry(1.74, 0.46, 1.86).translate(0, 1.38, -0.25), 0x1c2430),
        colored(new THREE.BoxGeometry(1.6, 0.04, 0.6).translate(0, 1.04, 1.25), 0x1c2430),
      ];
      for (const sx of [-0.86, 0.86])
        for (const sz of [-1.35, 1.35]) parts.push(colored(new THREE.CylinderGeometry(0.36, 0.36, 0.26, 12).rotateZ(Math.PI / 2).translate(sx, 0.36, sz), 0x161616));
      parts.push(colored(new THREE.BoxGeometry(1.5, 0.14, 0.06).translate(0, 0.86, 2.12), 0xfff3d0));
      parts.push(colored(new THREE.BoxGeometry(1.5, 0.12, 0.06).translate(0, 0.9, -2.12), 0xb01818));
      const g = mergeGeometries(parts.map((x) => (x.index ? x.toNonIndexed() : x)));
      return g;
    }),
};

// Набор однотипных объектов, разбитых на чанки (для отсечения по видимости).
export class PropSet {
  constructor(world, parts, opts = {}) {
    this.world = world;
    this.parts = parts;
    this.opts = { cast: true, receive: true, kind: null, radius: 1.5, debris: 0x777777, chunk: 100, ...opts };
    this.items = [];
  }
  add(x, y, z, rotY = 0, sx = 1, sy = sx, sz = sx, color = null, extra = null) {
    const item = { x, y, z, rotY, sx, sy, sz, color, alive: true, refs: [], set: this, ...extra };
    this.items.push(item);
    return item;
  }
  build(scene) {
    const C = this.opts.chunk;
    const chunks = new Map();
    for (const it of this.items) {
      const key = Math.floor(it.x / C) + ',' + Math.floor(it.z / C);
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

// Материал листвы: цвет экземпляра применяется только к листьям (атрибут tint),
// ствол остаётся коричневым.
export function foliageMaterial() {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 });
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float tint;')
      .replace(
        '#include <color_vertex>',
        `#include <color_vertex>
        #ifdef USE_INSTANCING_COLOR
          vColor.rgb = mix(color.rgb, color.rgb * instanceColor.rgb, tint);
        #endif`
      );
  };
  m.customProgramCacheKey = () => 'foliage';
  return m;
}

export const MAT = {
  foliage: () => G.custom('foliageMat', foliageMaterial),
  car: () => pbr(0xffffff, { vertexColors: true, roughness: 0.35, metalness: 0.45 }),
  plain: (opts) => pbr(0xffffff, { vertexColors: true, ...opts }),
};

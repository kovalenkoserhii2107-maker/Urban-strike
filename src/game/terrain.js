import * as THREE from 'three';
import { fbm, ridged } from './noise.js';
import { addDetail } from './materials.js';
import { T } from './textures.js';

// Остров ~1600×1600 м: рельеф, побережье, горы на северо-западе,
// выровненные площадки под город, базы и деревни, трассы между ними.

export const WORLD = { half: 1000, waterY: -2.2, step: 4 };

export const LAYOUT = {
  city: { name: 'Порт-Лазурь', x: -120, z: 260, hx: 262, hz: 262 },
  fob: { name: 'База «Сокол»', x: -120, z: 640, hx: 55, hz: 55 },
  industrial: { name: 'Промзона «Северсталь»', x: 470, z: 300, hx: 175, hz: 150 },
  airbase: { name: 'Авиабаза Кроста', x: 410, z: -380, hx: 300, hz: 125 },
  mountains: { name: 'Хребет Ястреба', x: -470, z: -420, r: 400 },
  villages: [
    { name: 'Озёрное', x: -600, z: 250, r: 75 },
    { name: 'Развилка', x: 60, z: -130, r: 70 },
    { name: 'Верхний Брод', x: -270, z: -580, r: 70 },
  ],
  // вражеские аванпосты: после зачистки становятся нашими точками дозаправки
  outposts: [
    { id: 'op1', name: 'Аванпост «Утёс»', x: -560, z: -120 },
    { id: 'op2', name: 'Аванпост «Поле»', x: -60, z: -400 },
    { id: 'op3', name: 'Аванпост «Мост»', x: 250, z: 60 },
    { id: 'op4', name: 'Аванпост «Маяк»', x: 650, z: 20 },
    { id: 'op5', name: 'Аванпост «Залив»', x: 240, z: 590 },
    { id: 'op6', name: 'Аванпост «Сосны»', x: -430, z: 520 },
    { id: 'op7', name: 'Аванпост «Пик»', x: -640, z: -540 },
    { id: 'op8', name: 'Аванпост «Север»', x: -90, z: -660 },
  ],
};

// Трассы между регионами: ломаные, дальше сглаживаются и врезаются в рельеф.
export const HIGHWAYS = [
  [[-120, 502], [-120, 585]],
  [[122, 260], [200, 275], [296, 300]],
  [[470, 150], [470, 40], [450, -150], [440, -254]],
  [[-120, 18], [-40, -60], [60, -130], [90, -250], [110, -380]],
  [[-362, 260], [-450, 255], [-525, 252]],
  [[-240, 18], [-250, -150], [-235, -300], [-265, -450], [-270, -510]],
  [[60, -130], [220, -100], [330, 40], [420, 150]],
];

const smooth = (a, b, x) => {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
};

export function landSdf(x, z) {
  const L = 790, R = 330;
  const qx = Math.abs(x) - (L - R), qz = Math.abs(z) - (L - R);
  const d = Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0) - R;
  return d + fbm(x * 0.004, z * 0.004, 3, 91) * 70;
}

function rectDist(z, x, y) {
  const dx = Math.max(Math.abs(x - z.x) - z.hx, 0);
  const dz = Math.max(Math.abs(y - z.z) - z.hz, 0);
  return Math.hypot(dx, dz);
}

function baseHeight(x, z) {
  const sdf = landSdf(x, z);
  if (sdf > 0) return WORLD.waterY - 1.5 - Math.min(sdf * 0.08, 25);
  const hills = (fbm(x * 0.0035, z * 0.0035, 4, 1) * 0.5 + 0.5) * 30 + fbm(x * 0.013, z * 0.013, 3, 2) * 3;
  const M = LAYOUT.mountains;
  const m = smooth(M.r, M.r * 0.2, Math.hypot(x - M.x, z - M.z));
  let h = hills * (1 - m * 0.4) + ridged(x * 0.0055, z * 0.0055, 5, 3) * 150 * m;
  h = WORLD.waterY + 1.0 + (h - WORLD.waterY - 1.0) * smooth(0, -110, sdf);
  return h;
}

export class Terrain {
  constructor() {
    const { half, step } = WORLD;
    this.n = Math.round((half * 2) / step) + 1;
    this.h = new Float32Array(this.n * this.n);
    this.roadMask = new Uint8Array(this.n * this.n);
    this.build();
  }

  idx(i, j) {
    return j * this.n + i;
  }
  gx(i) {
    return -WORLD.half + i * WORLD.step;
  }

  build() {
    const { n } = this;
    for (let j = 0; j < n; j++)
      for (let i = 0; i < n; i++) this.h[this.idx(i, j)] = baseHeight(this.gx(i), this.gx(j));

    // выравниваем площадки регионов
    const rects = [LAYOUT.city, LAYOUT.fob, LAYOUT.industrial, LAYOUT.airbase].map((z) => ({ ...z, h: 0, fade: 80 }));
    const circles = [
      ...LAYOUT.villages.map((v) => ({ ...v, h: Math.max(0.5, this.sample(v.x, v.z) * 0.85), fade: 60 })),
      ...LAYOUT.outposts.map((o) => ({ ...o, r: 24, h: Math.max(0.6, this.sample(o.x, o.z)), fade: 30 })),
    ];
    this.villageHeights = circles.map((c) => c.h);
    for (let j = 0; j < n; j++)
      for (let i = 0; i < n; i++) {
        const x = this.gx(i), z = this.gx(j);
        const k = this.idx(i, j);
        for (const r of rects) {
          const f = 1 - smooth(0, r.fade, rectDist(r, x, z));
          if (f > 0) this.h[k] += (r.h - this.h[k]) * f;
        }
        for (const c of circles) {
          const f = 1 - smooth(c.r, c.r + c.fade, Math.hypot(x - c.x, z - c.z));
          if (f > 0) this.h[k] += (c.h - this.h[k]) * f;
        }
      }

    // трассы: сглаженный профиль и полотно, врезанное в склон
    this.roads = HIGHWAYS.map((pts) => this.makeRoad(pts));
    for (const road of this.roads) this.carve(road);
  }

  makeRoad(pts) {
    const out = [];
    for (let s = 0; s < pts.length - 1; s++) {
      const [ax, az] = pts[s], [bx, bz] = pts[s + 1];
      const len = Math.hypot(bx - ax, bz - az);
      const n = Math.max(1, Math.round(len / 8));
      for (let k = 0; k < n; k++) out.push({ x: ax + ((bx - ax) * k) / n, z: az + ((bz - az) * k) / n });
    }
    out.push({ x: pts.at(-1)[0], z: pts.at(-1)[1] });
    // сглаживаем углы (Chaikin) и высоты (скользящее среднее)
    let p = out;
    for (let it = 0; it < 2; it++) {
      const q = [p[0]];
      for (let k = 0; k < p.length - 1; k++) {
        q.push({ x: p[k].x * 0.75 + p[k + 1].x * 0.25, z: p[k].z * 0.75 + p[k + 1].z * 0.25 });
        q.push({ x: p[k].x * 0.25 + p[k + 1].x * 0.75, z: p[k].z * 0.25 + p[k + 1].z * 0.75 });
      }
      q.push(p.at(-1));
      p = q;
    }
    const hs = p.map((v) => Math.max(this.sample(v.x, v.z), WORLD.waterY + 1.6));
    for (let pass = 0; pass < 6; pass++)
      for (let k = 1; k < hs.length - 1; k++) hs[k] = (hs[k - 1] + hs[k] * 2 + hs[k + 1]) / 4;
    p.forEach((v, k) => (v.y = hs[k]));
    // концы, входящие в выровненные площадки, ровно на нуле
    return p;
  }

  carve(road) {
    const { step, half } = WORLD;
    for (let k = 0; k < road.length - 1; k++) {
      const a = road[k], b = road[k + 1];
      const x0 = Math.min(a.x, b.x) - 16, x1 = Math.max(a.x, b.x) + 16;
      const z0 = Math.min(a.z, b.z) - 16, z1 = Math.max(a.z, b.z) + 16;
      const i0 = Math.max(0, Math.floor((x0 + half) / step)), i1 = Math.min(this.n - 1, Math.ceil((x1 + half) / step));
      const j0 = Math.max(0, Math.floor((z0 + half) / step)), j1 = Math.min(this.n - 1, Math.ceil((z1 + half) / step));
      const dx = b.x - a.x, dz = b.z - a.z, len2 = dx * dx + dz * dz || 1;
      for (let j = j0; j <= j1; j++)
        for (let i = i0; i <= i1; i++) {
          const x = this.gx(i), z = this.gx(j);
          const t = Math.min(Math.max(((x - a.x) * dx + (z - a.z) * dz) / len2, 0), 1);
          const d = Math.hypot(x - (a.x + dx * t), z - (a.z + dz * t));
          if (d > 16) continue;
          const hr = a.y + (b.y - a.y) * t - 0.1;
          const f = 1 - smooth(7, 16, d);
          const kk = this.idx(i, j);
          this.h[kk] += (hr - this.h[kk]) * f;
          if (d < 9) this.roadMask[kk] = 255;
        }
    }
  }

  // Рядом ли трасса (по маске, записанной при врезке дорог).
  isRoad(x, z) {
    const { step, half } = WORLD;
    const i = Math.round((x + half) / step), j = Math.round((z + half) / step);
    if (i < 0 || j < 0 || i >= this.n || j >= this.n) return false;
    return this.roadMask[this.idx(i, j)] > 0;
  }

  slope(x, z) {
    const e = 3;
    return Math.hypot(this.sample(x + e, z) - this.sample(x - e, z), this.sample(x, z + e) - this.sample(x, z - e)) / (2 * e);
  }

  // Высота в произвольной точке (билинейно по сетке).
  sample(x, z) {
    const { step, half } = WORLD;
    const fx = (x + half) / step, fz = (z + half) / step;
    const i = Math.min(Math.max(Math.floor(fx), 0), this.n - 2);
    const j = Math.min(Math.max(Math.floor(fz), 0), this.n - 2);
    const tx = Math.min(Math.max(fx - i, 0), 1), tz = Math.min(Math.max(fz - j, 0), 1);
    const h = this.h, n = this.n;
    const a = h[j * n + i], b = h[j * n + i + 1], c = h[(j + 1) * n + i], d = h[(j + 1) * n + i + 1];
    return (a + (b - a) * tx) * (1 - tz) + (c + (d - c) * tx) * tz;
  }

  // ---------- сетка рельефа: чанки 100×100 м ----------
  buildMeshes(scene, light) {
    const { step, half } = WORLD;
    const CH = 100, seg = CH / step;
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
    addDetail(mat, T.detail(), 0.09, 0.32);
    this.material = mat;
    const meshes = [];
    const col = new THREE.Color();
    const tmp = new THREE.Color();
    const night = light.night;
    const C = {
      grass1: new THREE.Color(0x5f8a3a), grass2: new THREE.Color(0x7c9a45), dry: new THREE.Color(0xa59a5c),
      sand: new THREE.Color(0xd9c38f), wetSand: new THREE.Color(0x9e8a62), rock: new THREE.Color(0x7d7468),
      snow: new THREE.Color(0xf0f2f4), dirt: new THREE.Color(0x8a7150), field1: new THREE.Color(0xc9b25a),
      field2: new THREE.Color(0x6e8f3c), mown: new THREE.Color(0x8aa452), roadside: new THREE.Color(0x7d6d55),
    };
    const villages = LAYOUT.villages;
    for (let cz = -half; cz < half; cz += CH)
      for (let cx = -half; cx < half; cx += CH) {
        const i0 = Math.round((cx + half) / step), j0 = Math.round((cz + half) / step);
        let maxH = -Infinity;
        for (let j = 0; j <= seg; j++) for (let i = 0; i <= seg; i++) maxH = Math.max(maxH, this.h[this.idx(i0 + i, j0 + j)]);
        if (maxH < WORLD.waterY - 0.5) continue;
        const count = (seg + 1) * (seg + 1);
        const pos = new Float32Array(count * 3), nor = new Float32Array(count * 3), colr = new Float32Array(count * 3);
        let v = 0;
        for (let j = 0; j <= seg; j++)
          for (let i = 0; i <= seg; i++, v++) {
            const gi = i0 + i, gj = j0 + j;
            const x = this.gx(gi), z = this.gx(gj);
            const hh = this.h[this.idx(gi, gj)];
            pos[v * 3] = x;
            pos[v * 3 + 1] = hh;
            pos[v * 3 + 2] = z;
            const hl = this.h[this.idx(Math.max(gi - 1, 0), gj)], hr = this.h[this.idx(Math.min(gi + 1, this.n - 1), gj)];
            const hd = this.h[this.idx(gi, Math.max(gj - 1, 0))], hu = this.h[this.idx(gi, Math.min(gj + 1, this.n - 1))];
            const nx = -(hr - hl) / (2 * step), nz = -(hu - hd) / (2 * step);
            const nl = Math.hypot(nx, 1, nz);
            nor[v * 3] = nx / nl;
            nor[v * 3 + 1] = 1 / nl;
            nor[v * 3 + 2] = nz / nl;
            const slope = Math.hypot(nx, nz);
            // цвет по высоте, уклону и региону
            const n1 = fbm(x * 0.01, z * 0.01, 3, 5) * 0.5 + 0.5;
            col.copy(C.grass1).lerp(C.grass2, n1).lerp(C.dry, Math.max(0, fbm(x * 0.003, z * 0.003, 2, 8)) * 0.8);
            if (hh < 1.5) col.lerp(hh < WORLD.waterY + 0.8 ? C.wetSand : C.sand, smooth(1.5, -0.2, hh));
            if (slope > 0.45 || hh > 55) col.lerp(C.rock, Math.max(smooth(0.45, 0.9, slope), smooth(55, 90, hh)));
            if (hh > 112) col.lerp(C.snow, smooth(112, 135, hh) * (1 - smooth(0.9, 1.4, slope)));
            if (rectDist(LAYOUT.airbase, x, z) < 1) col.lerp(C.mown, 0.7);
            if (rectDist(LAYOUT.industrial, x, z) < 1 || rectDist(LAYOUT.fob, x, z) < 1) col.lerp(C.dirt, 0.65);
            for (const vg of villages) {
              const d = Math.hypot(x - vg.x, z - vg.z);
              if (d > vg.r * 0.55 && d < vg.r + 70) {
                const stripe = Math.sin((x * 0.6 + z * 0.8) * 0.18) > 0 ? C.field1 : C.field2;
                tmp.copy(stripe).lerp(C.dirt, fbm(x * 0.05, z * 0.05, 2, 4) * 0.3 + 0.15);
                col.lerp(tmp, 0.75 * (1 - smooth(vg.r + 30, vg.r + 70, d)));
              }
            }
            if (this.roadMask[this.idx(gi, gj)]) col.lerp(C.roadside, 0.5);
            if (night) col.multiplyScalar(0.55);
            colr[v * 3] = col.r;
            colr[v * 3 + 1] = col.g;
            colr[v * 3 + 2] = col.b;
          }
        const idx = [];
        for (let j = 0; j < seg; j++)
          for (let i = 0; i < seg; i++) {
            const a = j * (seg + 1) + i, b = a + 1, c = a + seg + 1, d = c + 1;
            idx.push(a, c, b, b, c, d);
          }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
        geo.setAttribute('color', new THREE.BufferAttribute(colr, 3));
        geo.setIndex(idx);
        geo.computeBoundingSphere();
        const mesh = new THREE.Mesh(geo, mat);
        mesh.receiveShadow = true;
        scene.add(mesh);
        meshes.push(mesh);
      }
    this.meshes = meshes;
    return meshes;
  }

  // Маска глубины для шейдера воды (пена у берега, цвет мелководья).
  depthTexture() {
    const S = 256;
    const data = new Uint8Array(S * S);
    for (let j = 0; j < S; j++)
      for (let i = 0; i < S; i++) {
        const x = -WORLD.half + ((i + 0.5) / S) * WORLD.half * 2;
        const z = -WORLD.half + ((j + 0.5) / S) * WORLD.half * 2;
        const depth = WORLD.waterY - this.sample(x, z);
        data[j * S + i] = Math.max(0, Math.min(255, Math.round((depth + 2) * 16)));
      }
    const t = new THREE.DataTexture(data, S, S, THREE.RedFormat);
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearFilter;
    t.needsUpdate = true;
    return t;
  }

  dispose() {
    for (const m of this.meshes || []) m.geometry.dispose();
    this.material?.dispose();
  }
}

import * as THREE from 'three';
import { tileFbm } from './noise.js';
import { mulberry32 } from '../core/utils.js';

// Процедурные текстуры: всё рисуется в canvas при загрузке, без файлов.

const cache = new Map();
function once(key, make) {
  if (!cache.has(key)) cache.set(key, make());
  return cache.get(key);
}

function canvas(size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return [c, c.getContext('2d')];
}

function toTex(c, srgb = true, repeat = true) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

// Заливка шумом: base — функция (n, x, y) -> [r,g,b].
function noiseFill(g, size, period, octaves, seed, color) {
  const img = g.createImageData(size, size);
  const d = img.data;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const n = tileFbm((x / size) * period, (y / size) * period, period, octaves, seed);
      const [r, gg, b] = color(n, x, y);
      const i = (y * size + x) * 4;
      d[i] = r;
      d[i + 1] = gg;
      d[i + 2] = b;
      d[i + 3] = 255;
    }
  g.putImageData(img, 0, 0);
}

// Пятна, нарисованные с заворотом по краям (чтобы текстура тайлилась).
function speckles(g, size, n, rmin, rmax, colorFn, rnd) {
  for (let i = 0; i < n; i++) {
    const x = rnd() * size, y = rnd() * size, r = rmin + rnd() * (rmax - rmin);
    g.fillStyle = colorFn(rnd);
    for (const ox of [-size, 0, size])
      for (const oy of [-size, 0, size]) {
        if (x + ox < -r || x + ox > size + r || y + oy < -r || y + oy > size + r) continue;
        g.beginPath();
        g.arc(x + ox, y + oy, r, 0, Math.PI * 2);
        g.fill();
      }
  }
}

const clamp255 = (v) => Math.max(0, Math.min(255, v | 0));

export const T = {
  // Серый шум для детализации больших поверхностей.
  detail: () =>
    once('detail', () => {
      const [c, g] = canvas(256);
      noiseFill(g, 256, 16, 5, 7, (n) => {
        const v = clamp255(n * 255);
        return [v, v, v];
      });
      return toTex(c, false);
    }),

  asphalt: () =>
    once('asphalt', () => {
      const [c, g] = canvas(512);
      noiseFill(g, 512, 8, 5, 3, (n) => {
        const v = 58 + n * 34;
        return [v, v + 2, v + 6];
      });
      const rnd = mulberry32(11);
      speckles(g, 512, 2600, 0.6, 1.6, (r) => `rgba(${r() < 0.5 ? '20,20,22' : '140,140,140'},${0.25 + r() * 0.3})`, rnd);
      // заплатки и трещины
      speckles(g, 512, 10, 20, 60, () => 'rgba(30,32,36,0.18)', rnd);
      g.strokeStyle = 'rgba(15,15,17,0.45)';
      g.lineWidth = 1.2;
      for (let i = 0; i < 6; i++) {
        let x = rnd() * 512, y = rnd() * 512;
        g.beginPath();
        g.moveTo(x, y);
        for (let k = 0; k < 8; k++) {
          x += (rnd() - 0.5) * 40;
          y += (rnd() - 0.5) * 40;
          g.lineTo(x, y);
        }
        g.stroke();
      }
      return toTex(c);
    }),

  // Тротуарная плитка 2×2 м: на текстуре 4×4 м.
  sidewalk: () =>
    once('sidewalk', () => {
      const [c, g] = canvas(256);
      noiseFill(g, 256, 8, 4, 5, (n) => {
        const v = 168 + n * 40;
        return [v, v - 2, v - 8];
      });
      g.strokeStyle = 'rgba(70,65,60,0.55)';
      g.lineWidth = 2;
      for (let i = 0; i <= 2; i++) {
        g.beginPath();
        g.moveTo(i * 128, 0);
        g.lineTo(i * 128, 256);
        g.moveTo(0, i * 128);
        g.lineTo(256, i * 128);
        g.stroke();
      }
      return toTex(c);
    }),

  // Брусчатка площадей.
  paving: () =>
    once('paving', () => {
      const [c, g] = canvas(256);
      const rnd = mulberry32(5);
      g.fillStyle = '#6f675e';
      g.fillRect(0, 0, 256, 256);
      for (let y = 0; y < 16; y++)
        for (let x = 0; x < 8; x++) {
          const off = y % 2 ? 16 : 0;
          const v = 150 + rnd() * 50;
          g.fillStyle = `rgb(${v},${v - 8},${v - 20})`;
          g.fillRect(((x * 32 + off) % 256) + 1, y * 16 + 1, 30, 14);
          if (x * 32 + off + 32 > 256) g.fillRect(-1, y * 16 + 1, ((x * 32 + off + 32) % 256) - 1, 14);
        }
      return toTex(c);
    }),

  concrete: () =>
    once('concrete', () => {
      const [c, g] = canvas(256);
      noiseFill(g, 256, 6, 5, 9, (n) => {
        const v = 150 + n * 55;
        return [v, v, v - 4];
      });
      const rnd = mulberry32(3);
      speckles(g, 256, 40, 3, 14, () => 'rgba(60,55,50,0.08)', rnd);
      g.strokeStyle = 'rgba(40,40,40,0.35)';
      g.lineWidth = 1.5;
      g.strokeRect(0, 0, 256, 256);
      return toTex(c);
    }),

  dirt: () =>
    once('dirt', () => {
      const [c, g] = canvas(256);
      noiseFill(g, 256, 8, 5, 21, (n) => [120 + n * 70, 92 + n * 55, 60 + n * 35]);
      const rnd = mulberry32(8);
      speckles(g, 256, 500, 0.6, 2, (r) => `rgba(${r() < 0.5 ? '60,45,30' : '190,170,140'},0.5)`, rnd);
      return toTex(c);
    }),

  roofTiles: () =>
    once('roofTiles', () => {
      const [c, g] = canvas(128);
      for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
          const v = 0.85 + ((x * 7 + y * 13) % 5) * 0.05;
          g.fillStyle = `rgb(${clamp255(230 * v)},${clamp255(230 * v)},${clamp255(230 * v)})`;
          g.fillRect(x * 16 + (y % 2 ? 8 : 0), y * 16, 16, 16);
          if (y % 2 && x === 7) g.fillRect(0, y * 16, 8, 16);
        }
        g.fillStyle = 'rgba(0,0,0,0.35)';
        g.fillRect(0, y * 16 + 13, 128, 3);
      }
      return toTex(c);
    }),

  gravel: () =>
    once('gravel', () => {
      const [c, g] = canvas(256);
      noiseFill(g, 256, 16, 3, 41, (n) => {
        const v = 120 + n * 60;
        return [v, v - 2, v - 6];
      });
      const rnd = mulberry32(17);
      speckles(g, 256, 1800, 0.8, 2.2, (r) => {
        const v = 70 + r() * 120;
        return `rgba(${v},${v},${v - 5},0.7)`;
      }, rnd);
      return toTex(c);
    }),

  // Нормали для воды из тайлящегося шума.
  waterNormal: () =>
    once('waterNormal', () => {
      const size = 256;
      const h = new Float32Array(size * size);
      for (let y = 0; y < size; y++)
        for (let x = 0; x < size; x++) h[y * size + x] = tileFbm((x / size) * 8, (y / size) * 8, 8, 4, 77);
      const [c, g] = canvas(size);
      const img = g.createImageData(size, size);
      const at = (x, y) => h[((y + size) % size) * size + ((x + size) % size)];
      for (let y = 0; y < size; y++)
        for (let x = 0; x < size; x++) {
          const dx = (at(x + 1, y) - at(x - 1, y)) * 6;
          const dy = (at(x, y + 1) - at(x, y - 1)) * 6;
          const len = Math.hypot(dx, dy, 1);
          const i = (y * size + x) * 4;
          img.data[i] = clamp255((-dx / len * 0.5 + 0.5) * 255);
          img.data[i + 1] = clamp255((-dy / len * 0.5 + 0.5) * 255);
          img.data[i + 2] = clamp255((1 / len * 0.5 + 0.5) * 255);
          img.data[i + 3] = 255;
        }
      g.putImageData(img, 0, 0);
      return toTex(c, false);
    }),
};

// ---------- фасады ----------
// Одна текстура = 2 пролёта × 2 этажа (8×8 м). Возвращает цвет,
// карту шероховатости/металличности (G/B) и ночную карту свечения окон.
const FACADES = {
  glass: { wall: [70, 86, 102], frame: [40, 46, 54], glass: [92, 130, 160], win: [6, 6, 58, 58], mullion: true },
  brick: { wall: [150, 74, 52], frame: [232, 226, 214], glass: [52, 70, 86], win: [20, 18, 24, 34], brick: true },
  panel: { wall: [190, 186, 176], frame: [120, 118, 112], glass: [55, 72, 88], win: [16, 18, 32, 30], panel: true },
  plaster: { wall: [226, 214, 190], frame: [250, 248, 240], glass: [58, 76, 92], win: [20, 16, 24, 36], shutters: true },
};

export function facade(kind, seed = 1) {
  return once('facade-' + kind + seed, () => {
    const f = FACADES[kind];
    const S = 256;
    const [c, g] = canvas(S);
    const [oc, og] = canvas(S);
    const [ec, eg] = canvas(S);
    const rnd = mulberry32(seed * 31 + kind.length);
    const rgb = (a, k = 1) => `rgb(${clamp255(a[0] * k)},${clamp255(a[1] * k)},${clamp255(a[2] * k)})`;
    noiseFill(g, S, 4, 4, seed, (n) => f.wall.map((v) => v * (0.9 + n * 0.2)));
    og.fillStyle = 'rgb(0,225,0)';
    og.fillRect(0, 0, S, S);
    eg.fillStyle = '#000';
    eg.fillRect(0, 0, S, S);
    if (f.brick) {
      g.fillStyle = 'rgba(40,20,15,0.35)';
      for (let y = 0; y < S; y += 6) {
        g.fillRect(0, y, S, 1);
        for (let x = (y / 6) % 2 ? 0 : 7; x < S; x += 14) g.fillRect(x, y, 1, 6);
      }
    }
    if (f.panel) {
      g.fillStyle = 'rgba(60,60,60,0.35)';
      for (let i = 0; i <= 2; i++) {
        g.fillRect(0, i * 128 - 1, S, 2);
        g.fillRect(i * 128 - 1, 0, 2, S);
      }
    }
    // межэтажные пояса
    g.fillStyle = 'rgba(0,0,0,0.12)';
    g.fillRect(0, 124, S, 6);
    g.fillRect(0, 252, S, 4);
    const cell = 128;
    for (let fy = 0; fy < 2; fy++)
      for (let fx = 0; fx < 2; fx++) {
        const [l, t, r, b] = f.win;
        const x0 = fx * cell + l, y0 = fy * cell + t, w = cell - l - r, h = cell - t - b;
        g.fillStyle = rgb(f.frame);
        g.fillRect(x0 - 3, y0 - 3, w + 6, h + 6);
        const tone = 0.85 + rnd() * 0.3;
        const grad = g.createLinearGradient(x0, y0, x0 + w, y0 + h);
        grad.addColorStop(0, rgb(f.glass, tone * 1.25));
        grad.addColorStop(1, rgb(f.glass, tone * 0.8));
        g.fillStyle = grad;
        g.fillRect(x0, y0, w, h);
        // шторы/жалюзи внутри части окон
        if (rnd() < 0.35) {
          g.fillStyle = `rgba(${200 + rnd() * 50},${190 + rnd() * 40},${160 + rnd() * 40},0.35)`;
          g.fillRect(x0, y0, w, h * (0.3 + rnd() * 0.5));
        }
        if (f.mullion) {
          g.fillStyle = rgb(f.frame);
          g.fillRect(x0 + w / 2 - 1, y0, 3, h);
          g.fillRect(x0, y0 + h * 0.62, w, 3);
        } else {
          g.fillStyle = rgb(f.frame);
          g.fillRect(x0 + w / 2 - 2, y0, 4, h);
          g.fillRect(x0 - 5, y0 + h + 2, w + 10, 5);
        }
        if (f.shutters) {
          g.fillStyle = 'rgb(86,110,92)';
          g.fillRect(x0 - 14, y0, 10, h);
          g.fillRect(x0 + w + 4, y0, 10, h);
        }
        og.fillStyle = 'rgb(0,30,170)';
        og.fillRect(x0, y0, w, h);
        if (rnd() < 0.5) {
          const col = rnd() < 0.8 ? [255, 214, 140] : [170, 210, 255];
          eg.fillStyle = rgb(col, 0.6 + rnd() * 0.4);
          eg.fillRect(x0, y0, w, h);
        }
      }
    return { map: toTex(c), orm: toTex(oc, false), emissive: toTex(ec) };
  });
}

export const FACADE_KINDS = Object.keys(FACADES);

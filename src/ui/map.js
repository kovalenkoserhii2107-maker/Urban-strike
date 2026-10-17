import { WORLD, LAYOUT } from '../game/terrain.js';
import { FOG_SIZE } from '../game/openworld.js';

// Полноэкранная карта острова: рельеф с отмывкой, дороги, здания, туман войны,
// базы, аванпосты, события и сюжетный маркер. Нажатие ставит путевую точку.

const N = 512;

function renderBase(world) {
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const g = c.getContext('2d');
  const img = g.createImageData(N, N);
  const t = world.terrain;
  const cell = (WORLD.half * 2) / N;
  const H = (i, j) => t.sample(-WORLD.half + (i + 0.5) * cell, -WORLD.half + (j + 0.5) * cell);
  for (let j = 0; j < N; j++)
    for (let i = 0; i < N; i++) {
      const h = H(i, j);
      let r, gg, b;
      if (h < WORLD.waterY + 0.2) {
        const d = Math.min((WORLD.waterY - h) / 18, 1);
        r = 40 - d * 25;
        gg = 110 - d * 55;
        b = 150 - d * 40;
      } else {
        // рельеф: зелень → бурые склоны → скалы → снег
        const k = Math.min(Math.max(h / 120, 0), 1);
        if (h < 1.3) [r, gg, b] = [214, 196, 146];
        else if (k < 0.35) [r, gg, b] = [96 + k * 90, 132 + k * 30, 70];
        else if (k < 0.8) [r, gg, b] = [130, 120, 100];
        else [r, gg, b] = [236, 238, 240];
        const dx = H(Math.min(i + 1, N - 1), j) - H(Math.max(i - 1, 0), j);
        const dz = H(i, Math.min(j + 1, N - 1)) - H(i, Math.max(j - 1, 0));
        const shade = Math.min(Math.max(1 + (-dx - dz) * 0.035, 0.55), 1.35);
        r *= shade;
        gg *= shade;
        b *= shade;
      }
      const o = (j * N + i) * 4;
      img.data[o] = r;
      img.data[o + 1] = gg;
      img.data[o + 2] = b;
      img.data[o + 3] = 255;
    }
  g.putImageData(img, 0, 0);
  const X = (x) => ((x + WORLD.half) / (WORLD.half * 2)) * N;
  // районы
  g.fillStyle = 'rgba(150,150,150,0.45)';
  for (const z of [LAYOUT.city, LAYOUT.industrial, LAYOUT.airbase, LAYOUT.fob]) g.fillRect(X(z.x - z.hx), X(z.z - z.hz), (z.hx * 2 * N) / (WORLD.half * 2), (z.hz * 2 * N) / (WORLD.half * 2));
  // здания
  g.fillStyle = 'rgba(55,55,60,0.85)';
  for (const b of world.buildings) g.fillRect(X(b.x - b.w / 2), X(b.z - b.d / 2), Math.max(1, (b.w * N) / (WORLD.half * 2)), Math.max(1, (b.d * N) / (WORLD.half * 2)));
  // дороги
  g.strokeStyle = 'rgba(245,240,225,0.85)';
  g.lineWidth = 1.6;
  g.beginPath();
  for (const n of world.graph.nodes)
    for (const m of n.nbrs) {
      if (m.id < n.id) continue;
      g.moveTo(X(n.x), X(n.z));
      g.lineTo(X(m.x), X(m.z));
    }
  g.stroke();
  for (const road of world.terrain.roads) {
    g.beginPath();
    road.forEach((p, k) => (k ? g.lineTo(X(p.x), X(p.z)) : g.moveTo(X(p.x), X(p.z))));
    g.stroke();
  }
  return c;
}

export class MapScreen {
  constructor(root, game, onClose) {
    this.root = root;
    this.game = game;
    this.canvas = root.querySelector('#map-canvas');
    this.ctx = this.canvas.getContext('2d');
    this.onClose = onClose;
    this.base = null;
    this.canvas.addEventListener('pointerdown', (e) => this.tap(e));
    root.querySelector('#map-close').addEventListener('click', () => this.close());
    root.querySelector('#map-clear').addEventListener('click', () => {
      this.game.waypoint = null;
      this.draw();
    });
  }

  open() {
    if (!this.base) this.base = renderBase(this.game.world);
    this.root.classList.add('active');
    this.draw();
  }

  close() {
    this.root.classList.remove('active');
    this.onClose?.();
  }

  layout() {
    const r = this.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (this.canvas.width !== Math.round(r.width * dpr) || this.canvas.height !== Math.round(r.height * dpr)) {
      this.canvas.width = Math.round(r.width * dpr);
      this.canvas.height = Math.round(r.height * dpr);
    }
    const size = Math.min(r.width, r.height);
    return { dpr, size, ox: (r.width - size) / 2, oy: (r.height - size) / 2, r };
  }

  toScreen(x, z, L) {
    return [L.ox + ((x + WORLD.half) / (WORLD.half * 2)) * L.size, L.oy + ((z + WORLD.half) / (WORLD.half * 2)) * L.size];
  }

  markers() {
    const g = this.game, out = [];
    for (const b of g.friendlyBases()) out.push({ x: b.x, z: b.z, kind: 'base', label: b.name || 'База' });
    for (const op of g.ow?.outposts || []) if (op.owner === 'enemy') out.push({ x: op.x, z: op.z, kind: 'outpost', label: op.name });
    for (const ev of g.ow?.events || []) out.push({ x: ev.x, z: ev.z, kind: 'event', label: ev.text });
    const m = g.ow?.storyMarker();
    if (m) out.push({ x: m.x, z: m.z, kind: 'story', label: `Задание: ${m.def.name}` });
    const o = g.mission?.current()?.targetPos();
    if (o) out.push({ x: o.x, z: o.z, kind: 'story', label: g.mission.current().text });
    return out;
  }

  draw() {
    const L = this.layout();
    const g = this.ctx;
    g.setTransform(L.dpr, 0, 0, L.dpr, 0, 0);
    g.clearRect(0, 0, L.r.width, L.r.height);
    g.drawImage(this.base, L.ox, L.oy, L.size, L.size);
    // туман войны
    const ow = this.game.ow;
    if (ow) {
      // туман рисуем в маленький холст и растягиваем со сглаживанием — края мягкие
      this.fogCanvas ||= Object.assign(document.createElement('canvas'), { width: FOG_SIZE, height: FOG_SIZE });
      const fg = this.fogCanvas.getContext('2d');
      const img = fg.createImageData(FOG_SIZE, FOG_SIZE);
      for (let k = 0; k < FOG_SIZE * FOG_SIZE; k++) {
        img.data[k * 4] = 8;
        img.data[k * 4 + 1] = 16;
        img.data[k * 4 + 2] = 26;
        img.data[k * 4 + 3] = ow.fog[k] ? 0 : 200;
      }
      fg.putImageData(img, 0, 0);
      g.imageSmoothingEnabled = true;
      g.drawImage(this.fogCanvas, L.ox, L.oy, L.size, L.size);
    }
    // подписи районов
    g.font = '700 12px system-ui, sans-serif';
    g.textAlign = 'center';
    const regions = [LAYOUT.city, LAYOUT.industrial, LAYOUT.airbase, LAYOUT.mountains, ...LAYOUT.villages];
    for (const r of regions) {
      if (ow && !ow.explored(r.x, r.z)) continue;
      const [sx, sy] = this.toScreen(r.x, r.z, L);
      g.fillStyle = 'rgba(0,0,0,0.55)';
      g.fillText(r.name, sx + 1, sy + 1);
      g.fillStyle = '#fff';
      g.fillText(r.name, sx, sy);
    }
    for (const m of this.markers()) {
      const [sx, sy] = this.toScreen(m.x, m.z, L);
      if (m.kind === 'base') {
        g.fillStyle = '#3fa9ff';
        g.fillRect(sx - 6, sy - 6, 12, 12);
        g.strokeStyle = '#fff';
        g.lineWidth = 2;
        g.strokeRect(sx - 6, sy - 6, 12, 12);
      } else if (m.kind === 'outpost') {
        g.fillStyle = '#e8483a';
        g.beginPath();
        g.moveTo(sx, sy - 7);
        g.lineTo(sx + 7, sy + 6);
        g.lineTo(sx - 7, sy + 6);
        g.closePath();
        g.fill();
      } else if (m.kind === 'event') {
        g.fillStyle = '#ffa040';
        g.beginPath();
        g.arc(sx, sy, 6, 0, Math.PI * 2);
        g.fill();
      } else {
        g.fillStyle = '#ffd34d';
        g.font = '900 20px system-ui, sans-serif';
        g.fillText('★', sx, sy + 7);
        g.font = '700 12px system-ui, sans-serif';
      }
    }
    const wp = this.game.waypoint;
    if (wp) {
      const [sx, sy] = this.toScreen(wp.x, wp.z, L);
      g.strokeStyle = '#7fd8ff';
      g.lineWidth = 3;
      g.beginPath();
      g.arc(sx, sy, 9, 0, Math.PI * 2);
      g.moveTo(sx, sy - 14);
      g.lineTo(sx, sy + 14);
      g.moveTo(sx - 14, sy);
      g.lineTo(sx + 14, sy);
      g.stroke();
    }
    // игрок
    const p = this.game.player;
    const [px, py] = this.toScreen(p.pos.x, p.pos.z, L);
    g.save();
    g.translate(px, py);
    g.rotate(-p.yaw + Math.PI);
    g.fillStyle = '#7dff9a';
    g.strokeStyle = '#0b1a2b';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(0, -9);
    g.lineTo(7, 7);
    g.lineTo(-7, 7);
    g.closePath();
    g.fill();
    g.stroke();
    g.restore();
  }

  tap(e) {
    const L = this.layout();
    const x = ((e.clientX - L.r.left - L.ox) / L.size) * WORLD.half * 2 - WORLD.half;
    const z = ((e.clientY - L.r.top - L.oy) / L.size) * WORLD.half * 2 - WORLD.half;
    if (Math.abs(x) > WORLD.half || Math.abs(z) > WORLD.half) return;
    // нажали рядом с маркером — ставим точку на него
    let label = 'Путевая точка', px = x, pz = z;
    for (const m of this.markers()) {
      const [sx, sy] = this.toScreen(m.x, m.z, L);
      if (Math.hypot(sx - (e.clientX - L.r.left), sy - (e.clientY - L.r.top)) < 18) {
        label = m.label;
        px = m.x;
        pz = m.z;
        break;
      }
    }
    this.game.waypoint = { x: px, z: pz, y: this.game.world.heightAt(px, pz) + 5, label };
    this.root.querySelector('#map-info').textContent = label;
    this.draw();
  }
}

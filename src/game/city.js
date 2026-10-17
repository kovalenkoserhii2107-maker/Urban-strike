import * as THREE from 'three';
import { pbr } from './materials.js';
import { T } from './textures.js';
import { LAYOUT } from './terrain.js';
import { addBuilding, Surfaces } from './buildings.js';
import { CAR_COLORS } from './props.js';

const ROAD_W = 12;
const WALK = 3;

// Сетка улиц для любого района: асфальт, тротуары с бордюром, разметка,
// узлы графа дорог. Возвращает кварталы между улицами.
export function buildGrid(world, region, xs, zs, { markings = true } = {}) {
  const S = world.surfaces;
  const hw = ROAD_W / 2;
  const X0 = xs[0] - hw, X1 = xs.at(-1) + hw, Z0 = zs[0] - hw, Z1 = zs.at(-1) + hw;
  for (const x of xs) S.asphalt.quad(x - hw, Z0, x + hw, Z1, 0.06);
  for (const z of zs) S.asphalt.quad(X0, z - hw, X1, z + hw, 0.061);
  const blocks = [];
  for (let i = 0; i < xs.length - 1; i++)
    for (let j = 0; j < zs.length - 1; j++) {
      const x0 = xs[i] + hw, x1 = xs[i + 1] - hw, z0 = zs[j] + hw, z1 = zs[j + 1] - hw;
      // тротуар-кольцо с бордюром
      S.walk.slab(x0, z0, x1, z0 + WALK, 0, 0.2);
      S.walk.slab(x0, z1 - WALK, x1, z1, 0, 0.2);
      S.walk.slab(x0, z0 + WALK, x0 + WALK, z1 - WALK, 0, 0.2);
      S.walk.slab(x1 - WALK, z0 + WALK, x1, z1 - WALK, 0, 0.2);
      blocks.push({ i, j, x0, x1, z0, z1, cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, region });
    }
  if (markings) {
    const M = S.markYellow, W = S.markWhite;
    for (const x of xs)
      for (let j = 0; j < zs.length - 1; j++)
        for (let t = zs[j] + hw + 4; t < zs[j + 1] - hw - 4; t += 6) M.quad(x - 0.12, t, x + 0.12, t + 3, 0.075);
    for (const z of zs)
      for (let i = 0; i < xs.length - 1; i++)
        for (let t = xs[i] + hw + 4; t < xs[i + 1] - hw - 4; t += 6) M.quad(t, z - 0.12, t + 3, z + 0.12, 0.075);
    // пешеходные переходы
    for (const x of xs)
      for (const z of zs)
        for (const side of [-1, 1])
          for (let s = -hw + 0.8; s < hw - 0.8; s += 1.6) {
            W.quad(x + s, z + side * (hw + 0.4) - 1.2, x + s + 0.8, z + side * (hw + 0.4) + 1.2, 0.076);
            W.quad(x + side * (hw + 0.4) - 1.2, z + s, x + side * (hw + 0.4) + 1.2, z + s + 0.8, 0.076);
          }
  }
  // граф
  const nodes = xs.map((x) => zs.map((z) => {
    const n = world.graph.add(x, 0, z);
    n.region = region;
    return n;
  }));
  for (let i = 0; i < xs.length; i++)
    for (let j = 0; j < zs.length; j++) {
      if (i + 1 < xs.length) world.graph.link(nodes[i][j], nodes[i + 1][j]);
      if (j + 1 < zs.length) world.graph.link(nodes[i][j], nodes[i][j + 1]);
    }
  return { blocks, nodes, bounds: { X0, X1, Z0, Z1 } };
}

// Деревья, фонари и припаркованные машины вдоль улиц сетки.
export function streetDressing(world, xs, zs, skip = () => false) {
  const rng = world.rng, D = world.density, sets = world.sets;
  const hw = ROAD_W / 2;
  for (const [lines, cross, vertical] of [[xs, zs, true], [zs, xs, false]])
    for (const r of lines)
      for (let s = 0; s < cross.length - 1; s++)
        for (const side of [-1, 1]) {
          const mid = (cross[s] + cross[s + 1]) / 2;
          if (skip(vertical ? r + side * 12 : mid, vertical ? mid : r + side * 12)) continue;
          for (let t = cross[s] + hw + 8; t < cross[s + 1] - hw - 6; t += 12) {
            const off = hw + WALK - 1.1;
            const px = vertical ? r + side * off : t, pz = vertical ? t : r + side * off;
            if (rng.chance(0.4 * D)) world.addTree(px, pz, rng.float(0.6, 0.85), false);
            else if (rng.chance(0.3)) {
              const rot = vertical ? (side > 0 ? -Math.PI / 2 : Math.PI / 2) : side > 0 ? Math.PI : 0;
              sets.lamps.add(px, 0.2, pz, rot);
            }
            if (rng.chance(0.28 * D)) {
              const cx = vertical ? r + side * (hw - 1.4) : t + 3, cz = vertical ? t + 3 : r + side * (hw - 1.4);
              const rot = vertical ? (side > 0 ? 0 : Math.PI) : side > 0 ? Math.PI / 2 : -Math.PI / 2;
              sets.cars.add(cx, 0.06, cz, rot, 1, 1, 1, rng.pick(CAR_COLORS));
            }
          }
        }
}

export function makeSurfaces(world) {
  const asphalt = pbr(0xffffff, { map: T.asphalt(), roughness: 0.9 });
  const walk = pbr(0xffffff, { map: T.sidewalk(), roughness: 0.85 });
  world.surfaces = {
    asphalt: new Surfaces(asphalt, 1 / 12),
    walk: new Surfaces(walk, 1 / 4),
    paving: new Surfaces(pbr(0xffffff, { map: T.paving(), roughness: 0.8 }), 1 / 6),
    concrete: new Surfaces(pbr(0xffffff, { map: T.concrete(), roughness: 0.85 }), 1 / 10),
    dirt: new Surfaces(pbr(0xffffff, { map: T.dirt(), roughness: 1 }), 1 / 8),
    pond: new Surfaces(pbr(0x1d4a5e, { roughness: 0.05, metalness: 0.4 }), 1),
    markYellow: new Surfaces(pbr(0xe2bd3c, { roughness: 0.6 }), 1),
    markWhite: new Surfaces(pbr(0xf2f2ee, { roughness: 0.6 }), 1),
  };
}

export function flushSurfaces(world) {
  for (const s of Object.values(world.surfaces)) {
    const m = s.build(world.scene);
    if (m) world.disposables.push(() => m.geometry.dispose());
  }
}

// ---------- город Порт-Лазурь ----------
export function buildCity(world) {
  makeSurfaces(world);
  const C = LAYOUT.city;
  const rng = world.rng;
  const xs = Array.from({ length: 9 }, (_, k) => C.x - 240 + k * 60);
  const zs = Array.from({ length: 9 }, (_, k) => C.z - 240 + k * 60);
  const { blocks } = buildGrid(world, 'city', xs, zs);
  for (const b of blocks) {
    const dc = Math.hypot(b.cx - C.x, b.cz - C.z);
    if (dc < 95) b.type = 'downtown';
    else {
      const r = rng.next();
      b.type = r < 0.42 ? 'residential' : r < 0.82 ? 'commercial' : 'park';
    }
  }
  // площадки для заданий: подальше друг от друга и от нашей базы
  const fob = LAYOUT.fob;
  const chosen = [];
  for (let k = 0; k < 6; k++) {
    let best = null, bv = -1;
    for (const b of blocks) {
      if (chosen.includes(b) || Math.hypot(b.cx - fob.x, b.cz - fob.z) < 200) continue;
      let v = Infinity;
      for (const c of chosen) v = Math.min(v, Math.hypot(b.cx - c.cx, b.cz - c.cz));
      if (!chosen.length) v = Math.hypot(b.cx - fob.x, b.cz - fob.z);
      v += rng.next() * 25;
      if (v > bv) {
        bv = v;
        best = b;
      }
    }
    best.type = 'site';
    chosen.push(best);
  }
  chosen.sort((a, b) => Math.hypot(a.cx - fob.x, a.cz - fob.z) - Math.hypot(b.cx - fob.x, b.cz - fob.z));
  world.sites.city = chosen.map((b) => ({ x: b.cx, z: b.cz }));
  for (const b of blocks) fillBlock(world, b);
  streetDressing(world, xs, zs, (x, z) => {
    const b = blocks.find((bb) => x >= bb.x0 && x <= bb.x1 && z >= bb.z0 && z <= bb.z1);
    return b && b.type === 'site';
  });
}

const DOWNTOWN = [['glass', 0xffffff], ['glass', 0xd8e4ec], ['panel', 0xffffff], ['glass', 0xc9d6c4]];
const COMMERCIAL = [['panel', 0xffffff], ['plaster', 0xf3e6d0], ['brick', 0xffffff], ['plaster', 0xdfe8ef], ['brick', 0xd9b8a8], ['panel', 0xe8dcc8]];
const HOUSES = [['plaster', 0xf2e3c6], ['plaster', 0xe9d3c2], ['brick', 0xffffff], ['plaster', 0xd8e2d0], ['plaster', 0xf0f0ea]];

function fillBlock(world, b) {
  const rng = world.rng, S = world.surfaces, D = world.density, sets = world.sets;
  const ix0 = b.x0 + WALK, ix1 = b.x1 - WALK, iz0 = b.z0 + WALK, iz1 = b.z1 - WALK;
  if (b.type === 'downtown' || b.type === 'commercial') {
    S.paving.slab(ix0, iz0, ix1, iz1, 0, 0.2);
    const tall = b.type === 'downtown';
    if (tall && rng.chance(0.22)) {
      const [f, t] = rng.pick(DOWNTOWN);
      addBuilding(world, b.cx, b.cz, rng.float(28, 32), rng.float(28, 32), rng.float(28, 36), 'flat', { facade: f, tint: t, y: 0 });
      return;
    }
    for (const ox of [-1, 1])
      for (const oz of [-1, 1]) {
        const x = b.cx + ox * 11, z = b.cz + oz * 11;
        if (rng.chance(0.12)) {
          for (let t = 0; t < 3; t++) world.addTree(x + rng.float(-5, 5), z + rng.float(-5, 5), rng.float(0.8, 1.1), false);
          continue;
        }
        const [f, t] = rng.pick(tall ? DOWNTOWN : COMMERCIAL);
        const h = tall ? rng.float(20, 34) : rng.float(8, 18);
        addBuilding(world, x, z, rng.float(13, 18), rng.float(13, 18), h, 'flat', { facade: f, tint: t, y: 0 });
      }
  } else if (b.type === 'residential') {
    for (const ox of [-1, 0, 1])
      for (const oz of [-1, 0, 1]) {
        const x = b.cx + ox * 13.5, z = b.cz + oz * 13.5;
        if (rng.chance(0.18)) {
          world.addTree(x + rng.float(-3, 3), z + rng.float(-3, 3), rng.float(0.9, 1.2), false);
          continue;
        }
        const [f, t] = rng.pick(HOUSES);
        addBuilding(world, x, z, rng.float(8, 10), rng.float(8, 10), rng.float(4, 8), 'pitched', { facade: f, tint: t, y: 0 });
        if (rng.chance(0.6 * D)) sets.bushes.add(x + rng.float(-5.5, 5.5), 0.3, z + (rng.chance(0.5) ? 5.6 : -5.6), rng.float(0, 6), rng.float(0.7, 1.1), 0.8, 1, 0x4f7f34);
      }
  } else if (b.type === 'park') {
    // дорожки, пруд, деревья
    S.walk.quad(ix0, b.cz - 1.5, ix1, b.cz + 1.5, 0.05);
    S.walk.quad(b.cx - 1.5, iz0, b.cx + 1.5, iz1, 0.051);
    let pond = null;
    if (rng.chance(0.6)) {
      pond = { x: b.cx + rng.pick([-9, 9]), z: b.cz + rng.pick([-9, 9]) };
      S.pond.circle(pond.x, pond.z, 5.5, 0.06);
    }
    const n = Math.round(20 * D);
    for (let t = 0; t < n; t++) {
      const x = rng.float(ix0 + 2, ix1 - 2), z = rng.float(iz0 + 2, iz1 - 2);
      if (Math.abs(x - b.cx) < 3 || Math.abs(z - b.cz) < 3) continue;
      if (pond && Math.hypot(x - pond.x, z - pond.z) < 8) continue;
      world.addTree(x, z, rng.float(0.9, 1.3), false);
    }
    for (let t = 0; t < 8 * D; t++)
      sets.bushes.add(rng.float(ix0 + 2, ix1 - 2), 0.2, rng.float(iz0 + 2, iz1 - 2), rng.float(0, 6), rng.float(0.7, 1.2), 0.8, 1, new THREE.Color().setHSL(rng.float(0.22, 0.32), 0.45, 0.3).getHex());
  } else if (b.type === 'site') {
    S.dirt.quad(ix0, iz0, ix1, iz1, 0.04);
  }
}

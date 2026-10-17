import * as THREE from 'three';
import { pbr, metal, glow, glass, G } from './materials.js';
import { LAYOUT, WORLD, landSdf } from './terrain.js';
import { addBuilding } from './buildings.js';
import { buildGrid, streetDressing, flushSurfaces } from './city.js';
import { PropSet } from './props.js';
import { createHelipad, enableShadows } from './models.js';
import { createViper } from './viper.js';
import { fbm } from './noise.js';

function place(world, obj, x, z, y = null) {
  obj.position.set(x, y ?? world.heightAt(x, z), z);
  enableShadows(obj);
  world.scene.add(obj);
  return obj;
}

function flag(world, x, z, color, y = null) {
  const g = new THREE.Group();
  const pole = new THREE.Mesh(G.cyl(0.08, 0.1, 9, 6), metal(0xcfd3d6));
  pole.position.y = 4.5;
  const cloth = new THREE.Mesh(G.box(0.04, 1.6, 2.6), pbr(color, { roughness: 0.9, side: THREE.DoubleSide }));
  cloth.position.set(0, 8.1, 1.35);
  const pivot = new THREE.Group();
  pivot.add(cloth);
  pivot.userData = { base: 0, phase: Math.random() * 6 };
  g.add(pole, pivot);
  (world.flags ||= []).push(pivot);
  place(world, g, x, z, y);
  return { group: g, cloth };
}

function halfCylinder(world, x, z, r, len, rot, color, y = null) {
  const g = new THREE.Group();
  const shell = new THREE.Mesh(
    G.custom('hangar' + r + len, () => new THREE.CylinderGeometry(r, r, len, 24, 1, false, 0, Math.PI).rotateZ(Math.PI / 2).rotateY(Math.PI / 2)),
    metal(color, { roughness: 0.55, metalness: 0.55, side: THREE.DoubleSide })
  );
  g.add(shell);
  const door = new THREE.Mesh(G.box(r * 1.3, r * 0.8, 0.3), metal(0x3a3f44, { roughness: 0.6 }));
  door.position.set(0, r * 0.4, len / 2);
  g.add(door);
  g.rotation.y = rot;
  place(world, g, x, z, y);
  const b = { group: g, x, y: g.position.y, z, w: Math.abs(Math.sin(rot)) > 0.5 ? len : r * 2, d: Math.abs(Math.sin(rot)) > 0.5 ? r * 2 : len, h: r, top: r, hp: 380, maxHp: 380, alive: true, crate: null, wallColor: color };
  world.addBuildingRecord(b);
  return b;
}

export function createJet(color = 0x7d8288) {
  const g = new THREE.Group();
  const p = pbr(color, { roughness: 0.45, metalness: 0.5 });
  const body = new THREE.Mesh(G.custom('jetBody', () => new THREE.CapsuleGeometry(0.9, 9, 6, 12).rotateX(Math.PI / 2)), p);
  body.position.y = 1.6;
  g.add(body);
  const wing = new THREE.Mesh(
    G.custom('jetWing', () => {
      const s = new THREE.Shape([new THREE.Vector2(0, 2.5), new THREE.Vector2(5.5, -2.2), new THREE.Vector2(-5.5, -2.2)]);
      return new THREE.ExtrudeGeometry(s, { depth: 0.18, bevelEnabled: false }).rotateX(Math.PI / 2);
    }),
    p
  );
  wing.position.set(0, 1.5, -0.5);
  g.add(wing);
  const fin = new THREE.Mesh(G.box(0.15, 2.4, 1.8), p);
  fin.position.set(0, 3.2, -4.4);
  fin.rotation.x = 0.35;
  g.add(fin);
  const canopy = new THREE.Mesh(G.sphere(0.7, 12, 8), glass(0x7fb8d8, 0.7));
  canopy.scale.set(0.8, 0.7, 2);
  canopy.position.set(0, 2.3, 2.8);
  g.add(canopy);
  for (const s of [-1, 1]) {
    const gear = new THREE.Mesh(G.cyl(0.25, 0.25, 0.3, 10), pbr(0x111111));
    gear.rotation.z = Math.PI / 2;
    gear.position.set(s * 1.4, 0.3, -1);
    g.add(gear);
  }
  return g;
}

// ---------- база игрока ----------
function buildFOB(world) {
  const F = LAYOUT.fob;
  const S = world.surfaces;
  S.concrete.quad(F.x - F.hx, F.z - F.hz, F.x + F.hx, F.z + F.hz, 0.05);
  const pad = createHelipad(10);
  pad.group.position.set(F.x, 0.06, F.z);
  world.scene.add(pad.group);
  world.padRings = [pad.ring];
  world.base = { x: F.x, z: F.z };
  halfCylinder(world, F.x - 32, F.z - 22, 8, 18, Math.PI / 2, 0x6c7a5c, 0).indestructible = true;
  halfCylinder(world, F.x - 32, F.z + 22, 8, 18, Math.PI / 2, 0x6c7a5c, 0).indestructible = true;
  const bar = addBuilding(world, F.x + 34, F.z + 26, 16, 9, 4, 'flat', { facade: 'panel', tint: 0xb9c2a8, y: 0 });
  bar.indestructible = true;
  for (let i = 0; i < 3; i++) {
    const tank = new THREE.Mesh(G.cyl(2, 2, 4, 16), pbr(0x5c7a4a, { roughness: 0.5, metalness: 0.4 }));
    place(world, tank, F.x + 34, F.z - 30 + i * 5, 2);
  }
  // стоянка второго «Вайпера» для антуража
  const parked = createViper('jungle');
  parked.group.position.set(F.x + 26, 1.45, F.z - 4);
  parked.group.rotation.y = -Math.PI / 2;
  world.scene.add(parked.group);
  const pad2 = createHelipad(8);
  pad2.group.position.set(F.x + 26, 0.06, F.z - 4);
  world.scene.add(pad2.group);
  world.padRings.push(pad2.ring);
  flag(world, F.x + 14, F.z + 18, 0x2f6fb8, 0);
  // заграждения HESCO по периметру
  const hesco = (world.sets.hesco ||= new PropSet(world, [{ geo: G.box(1.4, 1.6, 1.4).clone().translate(0, 0.8, 0), mat: pbr(0xb39d73, { roughness: 1 }) }], {}));
  for (let t = -F.hx; t <= F.hx; t += 1.5) {
    for (const [x, z] of [[F.x + t, F.z - F.hz], [F.x + t, F.z + F.hz], [F.x - F.hx, F.z + t], [F.x + F.hx, F.z + t]]) {
      if (Math.abs(x - F.x) < 7 && z < F.z) continue; // въезд с трассы
      hesco.add(x, 0, z, 0);
    }
  }
  const node = world.graph.add(F.x, 0, F.z - F.hz);
  node.region = 'fob';
  world.friendlyBases = [{ id: 'fob', name: F.name, x: F.x, z: F.z }];
}

// ---------- промзона ----------
function buildIndustrial(world) {
  const rng = world.rng, S = world.surfaces;
  const xs = [300, 385, 470, 555, 640], zs = [150, 225, 300, 375, 450];
  const { blocks } = buildGrid(world, 'industrial', xs, zs, { markings: true });
  const yards = [];
  for (const b of blocks) {
    S.concrete.slab(b.x0 + 3, b.z0 + 3, b.x1 - 3, b.z1 - 3, 0, 0.18);
    const r = rng.next();
    if (yards.length < 4 && (b.i + b.j) % 3 === 1 && rng.chance(0.8)) {
      yards.push({ x: b.cx, z: b.cz });
      continue;
    }
    if (r < 0.35) {
      // завод с трубами
      addBuilding(world, b.cx - 6, b.cz, 40, 30, rng.float(12, 16), 'warehouse', { facade: 'panel', tint: 0xc7c2b6, y: 0 });
      for (let k = 0; k < 2; k++) {
        const x = b.cx + 22, z = b.cz - 10 + k * 18;
        const ch = new THREE.Group();
        const h = 34;
        const shaft = new THREE.Mesh(G.cyl(1.4, 2.0, h, 16), pbr(0xb9b2a6, { roughness: 0.85 }));
        shaft.position.y = h / 2;
        ch.add(shaft);
        for (let s = 0; s < 3; s++) {
          const band = new THREE.Mesh(G.cyl(1.52 - s * 0.05, 1.56 - s * 0.05, 1.4, 16), pbr(s % 2 ? 0xf2f2f2 : 0xb83a2e, { roughness: 0.7 }));
          band.position.y = h - 1 - s * 1.4;
          ch.add(band);
        }
        place(world, ch, x, z, 0);
        world.chimneys.push({ x, y: h + 1, z });
        world.addBuildingRecord({ group: ch, x, y: 0, z, w: 4, d: 4, h, top: h, hp: 200, maxHp: 200, alive: true, crate: null, wallColor: 0xb9b2a6 });
      }
    } else if (r < 0.6) {
      addBuilding(world, b.cx, b.cz, rng.float(40, 50), rng.float(30, 40), rng.float(9, 13), 'warehouse', { facade: rng.pick(['panel', 'brick']), tint: 0xffffff, y: 0 });
    } else if (r < 0.82) {
      for (let n = 0; n < 16; n++) {
        const x = b.cx - 22 + (n % 4) * 3.0 + (n >= 8 ? 22 : 0), z = b.cz - 14 + Math.floor((n % 8) / 4) * 7 + (n >= 8 ? 4 : 0);
        const stack = rng.int(1, 3);
        for (let s = 0; s < stack; s++) world.sets.containers.add(x, 0.18 + 1.3 + s * 2.6, z, 0, 1, 1, 1, rng.pick([0xa83a2c, 0x2b5f9a, 0x2e7a4b, 0xc9862c, 0x6b4e8a, 0x8a8f96]));
      }
    } else {
      for (let n = 0; n < 4; n++) world.sets.barrels.add(b.cx - 12 + (n % 2) * 24, 0.18, b.cz - 10 + Math.floor(n / 2) * 20, 0, 1);
    }
  }
  world.sites.industrial = yards;
  // портальные краны
  for (let n = 0; n < 2; n++) {
    const crane = new THREE.Group();
    const yellow = pbr(0xe0a82a, { roughness: 0.5, metalness: 0.4 });
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) {
        const leg = new THREE.Mesh(G.box(0.8, 18, 0.8), yellow);
        leg.position.set(sx * 4, 9, sz * 4);
        crane.add(leg);
      }
    const beam = new THREE.Mesh(G.box(2, 2, 36), yellow);
    beam.position.set(0, 19, 6);
    crane.add(beam);
    const cab = new THREE.Mesh(G.box(3, 2.5, 3), pbr(0xb83a2e, { roughness: 0.5 }));
    cab.position.set(0, 16.5, 0);
    crane.add(cab);
    place(world, crane, 680, 220 + n * 160, 0);
  }
  streetDressing(world, xs, zs, () => Math.random() < 0.5);
}

// ---------- авиабаза врага ----------
function buildAirbase(world) {
  const A = LAYOUT.airbase;
  const S = world.surfaces;
  const rz = A.z - 40;
  S.asphalt.quad(A.x - 265, rz - 15, A.x + 265, rz + 15, 0.07);
  S.asphalt.quad(A.x - 240, A.z + 25, A.x + 240, A.z + 39, 0.07);
  for (const dx of [-200, 0, 200]) S.asphalt.quad(A.x + dx - 7, rz + 15, A.x + dx + 7, A.z + 25, 0.068);
  S.concrete.quad(A.x - 220, A.z + 39, A.x + 220, A.z + 100, 0.06);
  // разметка ВПП
  for (let x = A.x - 240; x < A.x + 240; x += 30) S.markWhite.quad(x, rz - 0.5, x + 14, rz + 0.5, 0.08);
  for (const end of [-1, 1])
    for (let k = -5; k <= 5; k++) {
      const x0 = A.x + end * 250;
      S.markWhite.quad(Math.min(x0, x0 - end * 22), rz + k * 2.4 - 0.7, Math.max(x0, x0 - end * 22), rz + k * 2.4 + 0.7, 0.08);
    }
  S.markWhite.quad(A.x - 265, rz - 14, A.x + 265, rz - 13.4, 0.08);
  S.markWhite.quad(A.x - 265, rz + 13.4, A.x + 265, rz + 14, 0.08);
  // ангары, вышка, склад топлива, радар
  const sites = [];
  for (let k = 0; k < 4; k++) {
    const x = A.x - 170 + k * 95;
    halfCylinder(world, x, A.z + 82, 12, 28, 0, 0x7d7a70, 0);
    sites.push({ x, z: A.z + 55 });
  }
  const tower = addBuilding(world, A.x + 235, A.z + 70, 8, 8, 20, 'flat', { facade: 'panel', tint: 0xd8d2c4, y: 0, hp: 300 });
  const cab = new THREE.Mesh(G.box(11, 4, 11), glass(0x6fa7c9, 0.75));
  cab.position.set(0, tower.h + 2, 0);
  tower.group.add(cab);
  tower.top += 4;
  for (let n = 0; n < 4; n++) world.sets.barrels.add(A.x + 255, 0.06, A.z - 10 + n * 8, 0, 0.9);
  const dome = new THREE.Mesh(G.sphere(6, 20, 14), pbr(0xf2f2f0, { roughness: 0.6 }));
  place(world, dome, A.x - 250, A.z + 75, 4);
  sites.push({ x: A.x, z: A.z + 60 }, { x: A.x + 200, z: A.z + 40 });
  world.sites.airbase = sites;
  // кольцевая дорога и забор
  const ring = [[A.x - 300, A.z + 125], [A.x, A.z + 125], [A.x + 300, A.z + 125], [A.x + 300, A.z - 125], [A.x, A.z - 125], [A.x - 300, A.z - 125], [A.x - 300, A.z]];
  const nodes = ring.map(([x, z]) => {
    const n = world.graph.add(x, 0, z);
    n.region = 'airbase';
    return n;
  });
  for (let k = 0; k < nodes.length; k++) {
    const a = nodes[k], b = nodes[(k + 1) % nodes.length];
    world.graph.link(a, b);
    const x0 = Math.min(a.x, b.x) - 5, x1 = Math.max(a.x, b.x) + 5, z0 = Math.min(a.z, b.z) - 5, z1 = Math.max(a.z, b.z) + 5;
    S.asphalt.quad(x0, z0, x1, z1, 0.065 + k * 0.0005);
  }
  for (let t = -300; t <= 300; t += 4) {
    world.sets.fence.add(A.x + t, 0, A.z - 133, Math.PI / 2);
    world.sets.fence.add(A.x + t, 0, A.z + 133, Math.PI / 2);
  }
  for (let t = -133; t <= 133; t += 4) {
    world.sets.fence.add(A.x - 308, 0, A.z + t, 0);
    world.sets.fence.add(A.x + 308, 0, A.z + t, 0);
  }
  world.jetSpots = [];
  for (let k = 0; k < 6; k++) world.jetSpots.push({ x: A.x - 200 + k * 75, z: A.z + 18, rot: Math.PI });
}

// ---------- деревни ----------
function buildVillages(world) {
  const rng = world.rng;
  world.sites.villages = [];
  LAYOUT.villages.forEach((v, vi) => {
    const y = world.terrain.villageHeights[vi];
    const houses = Math.round(10 + rng.next() * 4);
    for (let k = 0; k < houses; k++) {
      const a = (k / houses) * Math.PI * 2 + rng.float(-0.2, 0.2);
      const r = rng.float(16, v.r * 0.55);
      const x = v.x + Math.cos(a) * r, z = v.z + Math.sin(a) * r;
      if (world.terrain.isRoad(x, z) || world.terrain.isRoad(x + 5, z) || world.terrain.isRoad(x - 5, z)) continue;
      addBuilding(world, x, z, rng.float(7, 9), rng.float(8, 10), rng.float(4, 6), 'pitched', {
        facade: rng.pick(['plaster', 'plaster', 'brick']), tint: rng.pick([0xf2e3c6, 0xe5d4bd, 0xdfe6d8, 0xffffff]), y, rot: -a + Math.PI / 2,
      });
      if (rng.chance(0.7)) world.addTree(x + rng.float(-7, 7), z + rng.float(-7, 7), rng.float(0.9, 1.3), false);
    }
    // церковь с колокольней
    const ch = addBuilding(world, v.x + 4, v.z - 4, 9, 16, 8, 'pitched', { facade: 'plaster', tint: 0xf4f1ea, y, roofTint: 0x4a5a6a });
    const tower = new THREE.Mesh(G.box(4, 10, 4), ch.group.children[0].material[0]);
    tower.position.set(0, 13, -9);
    ch.group.add(tower);
    const spire = new THREE.Mesh(G.cone(2.8, 6, 8), pbr(0x3f6a5a, { roughness: 0.4, metalness: 0.6 }));
    spire.position.set(0, 21, -9);
    ch.group.add(spire);
    ch.top = 24;
    // водонапорная башня и сено на полях
    const wt = new THREE.Group();
    const tank = new THREE.Mesh(G.cyl(3, 3, 4, 16), metal(0x9aa0a6, { roughness: 0.5 }));
    tank.position.y = 14;
    wt.add(tank);
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const leg = new THREE.Mesh(G.cyl(0.18, 0.18, 12, 6), metal(0x6b7075));
      leg.position.set(sx * 2, 6, sz * 2);
      wt.add(leg);
    }
    place(world, wt, v.x - 20, v.z + 18, y);
    for (let k = 0; k < 18; k++) {
      const a = rng.float(0, Math.PI * 2), r = rng.float(v.r * 0.8, v.r + 55);
      const x = v.x + Math.cos(a) * r, z = v.z + Math.sin(a) * r;
      if (world.terrain.isRoad(x, z)) continue;
      world.sets.hay.add(x, world.heightAt(x, z), z, rng.float(0, 6), 1);
    }
    const n = world.graph.add(v.x, y, v.z);
    n.region = 'village';
    world.sites.villages.push({ x: v.x, z: v.z, name: v.name });
  });
}

// ---------- вражеские аванпосты (оформление; логика — в openworld.js) ----------
function buildOutposts(world) {
  world.outpostDecor = {};
  for (const o of LAYOUT.outposts) {
    const y = world.heightAt(o.x, o.z);
    const g = new THREE.Group();
    for (let i = 0; i < 12; i++) {
      if (i === 3) continue;
      const a = (i / 12) * Math.PI * 2;
      const sb = new THREE.Mesh(G.box(3.4, 1.2, 1.3), pbr(0xb9a57a, { roughness: 1 }));
      sb.position.set(Math.cos(a) * 18, 0.6, Math.sin(a) * 18);
      sb.rotation.y = -a + Math.PI / 2;
      g.add(sb);
    }
    for (const [tx, tz] of [[-6, 4], [5, 7]]) {
      const tent = new THREE.Mesh(G.custom('tent', () => new THREE.CylinderGeometry(2.6, 2.6, 6, 3, 1).rotateZ(Math.PI / 2).rotateY(Math.PI / 2)), pbr(0x6b6a4a, { roughness: 1 }));
      tent.position.set(tx, 1.3, tz);
      tent.rotation.y = Math.PI / 2;
      g.add(tent);
    }
    const crates = new THREE.Mesh(G.box(2.4, 1.6, 1.6), pbr(0x6b5a3a, { roughness: 0.9 }));
    crates.position.set(-2, 0.8, -6);
    g.add(crates);
    const watch = new THREE.Group();
    for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const leg = new THREE.Mesh(G.box(0.25, 7, 0.25), pbr(0x5e4630));
      leg.position.set(sx * 1.2, 3.5, sz * 1.2);
      watch.add(leg);
    }
    const hut = new THREE.Mesh(G.box(3.4, 2.2, 3.4), pbr(0x7a5f42));
    hut.position.y = 8;
    watch.add(hut);
    watch.position.set(10, 0, -9);
    g.add(watch);
    // площадка FARP: видна, когда аванпост наш
    const pad = createHelipad(7);
    pad.group.position.set(-8, 0.05, -12);
    pad.group.visible = false;
    g.add(pad.group);
    g.position.set(o.x, y, o.z);
    enableShadows(g);
    world.scene.add(g);
    const fl = flag(world, o.x + 2, o.z - 2, 0xb83a2e, y);
    world.outpostDecor[o.id] = { group: g, flag: fl, pad: pad.group, padRing: pad.ring };
  }
}

export function setOutpostOwner(world, id, owner) {
  const d = world.outpostDecor?.[id];
  if (!d) return;
  d.flag.cloth.material = pbr(owner === 'ally' ? 0x2f6fb8 : 0xb83a2e, { roughness: 0.9, side: THREE.DoubleSide });
  d.pad.visible = owner === 'ally';
  if (owner === 'ally' && !world.padRings.includes(d.padRing)) world.padRings.push(d.padRing);
}

// ---------- природа: леса, горы, пляжи, лодки ----------
function buildNature(world) {
  const rng = world.rng, t = world.terrain, D = world.density;
  const zones = [LAYOUT.city, LAYOUT.fob, LAYOUT.industrial, LAYOUT.airbase];
  const inZone = (x, z, pad) => zones.some((r) => Math.abs(x - r.x) < r.hx + pad && Math.abs(z - r.z) < r.hz + pad);
  const M = LAYOUT.mountains;
  const sp = 8;
  for (let z = -WORLD.half; z < WORLD.half; z += sp)
    for (let x = -WORLD.half; x < WORLD.half; x += sp) {
      const px = x + rng.float(0, sp), pz = z + rng.float(0, sp);
      const h = t.sample(px, pz);
      if (h < 0.8 || h > 108) continue;
      const mountain = Math.hypot(px - M.x, pz - M.z) < M.r;
      const mask = fbm(px * 0.005, pz * 0.005, 3, 12);
      const p = mountain ? 0.45 : mask > 0.05 ? 0.4 : mask > -0.15 ? 0.06 : 0.015;
      if (!rng.chance(p * D)) continue;
      if (inZone(px, pz, 14) || t.isRoad(px, pz) || t.slope(px, pz) > 0.85) continue;
      if (LAYOUT.villages.some((v) => Math.hypot(px - v.x, pz - v.z) < v.r * 0.7)) continue;
      if (LAYOUT.outposts.some((o) => Math.hypot(px - o.x, pz - o.z) < 26)) continue;
      world.addTree(px, pz, rng.float(0.85, 1.35), h > 32 || mountain ? rng.chance(0.85) : rng.chance(0.15));
    }
  // валуны на склонах гор
  for (let i = 0; i < 500 * D; i++) {
    const a = rng.float(0, Math.PI * 2), r = rng.float(0, M.r);
    const x = M.x + Math.cos(a) * r, z = M.z + Math.sin(a) * r;
    const h = t.sample(x, z);
    if (h < 3 || t.isRoad(x, z)) continue;
    const s = rng.float(1, 3.5);
    world.sets.rocks.add(x, h - 0.4, z, rng.float(0, 6), s, s * 0.7, s);
  }
  // пляжи: пальмы и камни у кромки воды
  for (let i = 0; i < 2600; i++) {
    const x = rng.float(-WORLD.half, WORLD.half), z = rng.float(-WORLD.half, WORLD.half);
    const sdf = landSdf(x, z);
    if (sdf > -4 || sdf < -70) continue;
    const h = t.sample(x, z);
    if (h < WORLD.waterY + 0.6 || h > 2.5 || t.isRoad(x, z) || inZone(x, z, 5)) continue;
    if (rng.chance(0.55)) world.sets.palms.add(x, h - 0.1, z, rng.float(0, 6.28), rng.float(0.8, 1.2));
    else {
      const s = rng.float(0.6, 1.8);
      world.sets.rocks.add(x, h - 0.3, z, rng.float(0, 6), s, s * 0.7, s);
    }
  }
  // лодки у берегов
  world.boats = [];
  for (let i = 0; i < 14; i++) {
    let x, z;
    for (let k = 0; k < 30; k++) {
      x = rng.float(-WORLD.half, WORLD.half);
      z = rng.float(-WORLD.half, WORLD.half);
      const s = landSdf(x, z);
      if (s > 25 && s < 140) break;
    }
    const b = new THREE.Group();
    const hullMat = pbr(rng.pick([0xf2f2f0, 0xa83a2c, 0x2b5f9a]), { roughness: 0.4, metalness: 0.1 });
    const hull = new THREE.Mesh(G.custom('boatHull', () => {
      const g = new THREE.CylinderGeometry(1.6, 1.0, 9, 10, 1);
      g.rotateX(Math.PI / 2);
      g.scale(1, 0.6, 1);
      return g;
    }), hullMat);
    hull.position.y = 0.4;
    b.add(hull);
    const cab = new THREE.Mesh(G.box(2, 1.4, 2.8), pbr(0xeae6da, { roughness: 0.6 }));
    cab.position.set(0, 1.4, -0.8);
    b.add(cab);
    const win = new THREE.Mesh(G.box(2.05, 0.5, 2.0), glass(0x335566, 0.9));
    win.position.set(0, 1.6, -0.6);
    b.add(win);
    b.position.set(x, WORLD.waterY, z);
    b.rotation.y = rng.float(0, 6);
    enableShadows(b);
    world.scene.add(b);
    world.boats.push({ obj: b, phase: rng.float(0, 6) });
  }
}

function findPeaks(world) {
  const M = LAYOUT.mountains;
  const cand = [];
  for (let z = M.z - M.r; z < M.z + M.r; z += 20)
    for (let x = M.x - M.r; x < M.x + M.r; x += 20) {
      if (Math.hypot(x - M.x, z - M.z) > M.r * 0.85 || landSdf(x, z) > -60) continue;
      cand.push({ x, z, y: world.heightAt(x, z) });
    }
  cand.sort((a, b) => b.y - a.y);
  const peaks = [];
  for (const c of cand) {
    if (peaks.every((p) => Math.hypot(p.x - c.x, p.z - c.z) > 120)) peaks.push(c);
    if (peaks.length >= 5) break;
  }
  world.sites.mountains = peaks;
}

export function buildRegions(world) {
  buildFOB(world);
  buildIndustrial(world);
  buildAirbase(world);
  buildVillages(world);
  buildOutposts(world);
  findPeaks(world);
  buildNature(world);
  world.sites.outposts = LAYOUT.outposts.map((o) => ({ ...o, y: world.heightAt(o.x, o.z) }));
  flushSurfaces(world);
}


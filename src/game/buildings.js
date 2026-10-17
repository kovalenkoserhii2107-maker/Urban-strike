import * as THREE from 'three';
import { pbr, metal, G } from './materials.js';
import { T, facade } from './textures.js';
import { enableShadows } from './models.js';

// Материал фасада: цвет, шероховатость/металличность окон и ночное свечение
// берутся из одной процедурной текстуры. Кэшируется на мир.
export function facadeMaterial(world, kind, tint = 0xffffff, seed = 1) {
  world.facadeCache ||= new Map();
  world.facadeMats ||= [];
  const key = kind + tint + '-' + seed;
  let m = world.facadeCache.get(key);
  if (!m) {
    const f = facade(kind, seed);
    m = new THREE.MeshStandardMaterial({
      color: tint, map: f.map, roughnessMap: f.orm, metalnessMap: f.orm, roughness: 1, metalness: 1,
      emissiveMap: f.emissive, emissive: 0xffffff, emissiveIntensity: 0, envMapIntensity: 1.2,
    });
    world.facadeCache.set(key, m);
    world.facadeMats.push(m);
    world.disposables.push(() => m.dispose());
  }
  return m;
}

function roofMaterial(kind, tint) {
  if (kind === 'tiles') return pbr(tint, { map: T.roofTiles(), roughness: 0.75 });
  return pbr(tint, { map: T.gravel(), roughness: 0.95 });
}

// Коробка с UV в метрах (текстура фасада — 8×8 м).
function boxGeo(w, h, d) {
  const geo = new THREE.BoxGeometry(w, h, d);
  const uv = geo.attributes.uv;
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++)
    for (let v = 0; v < 4; v++) {
      const i = f * 4 + v;
      uv.setXY(i, (uv.getX(i) * dims[f][0]) / 8, (uv.getY(i) * dims[f][1]) / 8);
    }
  geo.translate(0, h / 2, 0);
  return geo;
}

// style: flat | pitched | warehouse | hangar | tower
export function addBuilding(world, x, z, w, d, h, style = 'flat', opts = {}) {
  const rng = world.rng;
  const y = opts.y ?? world.heightAt(x, z);
  h = Math.max(4, Math.round(h / 4) * 4);
  const group = new THREE.Group();
  group.position.set(x, y, z);
  if (opts.rot) group.rotation.y = opts.rot;
  const kind = opts.facade || 'plaster';
  const wall = facadeMaterial(world, kind, opts.tint ?? 0xffffff, opts.seed ?? rng.int(1, 3));
  const roofKind = style === 'pitched' ? 'tiles' : 'gravel';
  const roof = roofMaterial(roofKind, opts.roofTint ?? (style === 'pitched' ? rng.pick([0xb5583c, 0x8e4a3a, 0x6a6f78, 0x9a6a4a]) : 0xb0aca4));
  const geo = boxGeo(w, h, d);
  group.add(new THREE.Mesh(geo, [wall, wall, roof, roof, wall, wall]));
  world.disposables.push(() => geo.dispose());
  let top = h;
  if (style === 'pitched') {
    const rh = Math.min(w, d) * 0.4;
    const shape = new THREE.Shape([new THREE.Vector2(-w / 2 - 0.4, 0), new THREE.Vector2(w / 2 + 0.4, 0), new THREE.Vector2(0, rh)]);
    const rg = new THREE.ExtrudeGeometry(shape, { depth: d + 0.8, bevelEnabled: false });
    rg.translate(0, h, -(d + 0.8) / 2);
    // UV крыши в метрах, чтобы черепица была нужного размера
    const p = rg.attributes.position, uv = rg.attributes.uv;
    for (let i = 0; i < p.count; i++) uv.setXY(i, p.getZ(i) / 3, (p.getY(i) - h + Math.abs(p.getX(i))) / 3);
    group.add(new THREE.Mesh(rg, roof));
    world.disposables.push(() => rg.dispose());
    top = h + rh;
    if (rng.chance(0.6)) {
      const ch = new THREE.Mesh(G.box(0.9, 2.6, 0.9), pbr(0x7a4b3c, { roughness: 0.9 }));
      ch.position.set(w * 0.22, h + rh * 0.55, d * 0.18);
      group.add(ch);
    }
  } else if (style === 'warehouse') {
    const n = Math.max(2, Math.round(w / 9));
    for (let i = 0; i < n; i++) {
      const s = new THREE.Mesh(G.custom('saw', () => new THREE.CylinderGeometry(2.2, 2.2, 1, 3, 1, false, 0, Math.PI).rotateZ(Math.PI / 2)), metal(0x9aa3ab, { roughness: 0.5, metalness: 0.7 }));
      s.scale.set(1, 1, d - 1);
      s.position.set(-w / 2 + (w / n) * (i + 0.5), h, 0);
      s.rotation.y = Math.PI / 2;
      group.add(s);
    }
    top = h + 2.2;
  } else {
    const parapet = new THREE.Mesh(G.box(1, 1, 1), pbr(0x8f8b84, { roughness: 0.9 }));
    parapet.scale.set(w + 0.4, 0.7, d + 0.4);
    parapet.position.y = h + 0.1;
    group.add(parapet);
    const n = rng.int(1, 4);
    for (let i = 0; i < n; i++) {
      const r = rng.next();
      let m;
      if (r < 0.45) m = new THREE.Mesh(G.box(2.4, 1.4, 2.0), metal(0xc4c8cc, { roughness: 0.4, metalness: 0.6 }));
      else if (r < 0.7) {
        m = new THREE.Mesh(G.cyl(1.3, 1.3, 2.8, 12), pbr(0x7a6450, { roughness: 0.8 }));
        m.position.y = 0.7;
      } else if (r < 0.85) m = new THREE.Mesh(G.cyl(0.06, 0.06, 7, 4), metal(0x444444));
      else m = new THREE.Mesh(G.box(3.4, 0.2, 1.8), pbr(0x1e2b44, { roughness: 0.2, metalness: 0.8 }));
      m.position.x += rng.float(-w / 2 + 2, w / 2 - 2);
      m.position.z += rng.float(-d / 2 + 2, d / 2 - 2);
      m.position.y += h + (r < 0.7 ? 1.0 : r < 0.85 ? 3.5 : 0.6);
      if (r >= 0.85) m.rotation.x = -0.4;
      group.add(m);
    }
    if (h > 22 && rng.chance(0.5)) {
      const pad = new THREE.Mesh(G.cyl(4, 4, 0.3, 20), pbr(0x4a4f56, { roughness: 0.8 }));
      pad.position.set(0, h + 0.4, 0);
      group.add(pad);
    }
  }
  enableShadows(group);
  // мелочь на крышах тень не отбрасывает — экономим вызовы отрисовки
  group.children.forEach((c, i) => {
    if (i > 0 && style !== 'pitched') c.castShadow = false;
  });
  world.scene.add(group);
  const hp = opts.hp ?? Math.min(Math.max(w * d * h * 0.045, 50), 420);
  const bld = { group, x, y, z, w, d, h, top, hp, maxHp: hp, alive: true, crate: null, wallColor: opts.debris ?? 0xb8ab98, indestructible: !!opts.indestructible };
  if (opts.rot && Math.abs(Math.sin(opts.rot)) > 0.7) {
    bld.w = d;
    bld.d = w;
  }
  world.addBuildingRecord(bld);
  return bld;
}

// Партия поверхностей одного материала с UV в мировых метрах:
// дороги, тротуары, площади. Собирается в один меш.
export class Surfaces {
  constructor(material, uvScale = 0.1) {
    this.mat = material;
    this.s = uvScale;
    this.pos = [];
    this.nor = [];
    this.uv = [];
    this.col = null;
    this.idx = [];
  }
  vert(x, y, z, nx, ny, nz, u, v) {
    this.pos.push(x, y, z);
    this.nor.push(nx, ny, nz);
    this.uv.push(u, v);
    return this.pos.length / 3 - 1;
  }
  quad(x0, z0, x1, z1, y) {
    const s = this.s;
    const a = this.vert(x0, y, z0, 0, 1, 0, x0 * s, z0 * s);
    const b = this.vert(x1, y, z0, 0, 1, 0, x1 * s, z0 * s);
    const c = this.vert(x0, y, z1, 0, 1, 0, x0 * s, z1 * s);
    const d = this.vert(x1, y, z1, 0, 1, 0, x1 * s, z1 * s);
    this.idx.push(a, c, b, b, c, d);
  }
  // Плита с бордюром: верх и четыре боковые грани.
  slab(x0, z0, x1, z1, y0, y1) {
    this.quad(x0, z0, x1, z1, y1);
    const s = this.s;
    const side = (ax, az, bx, bz, nx, nz) => {
      const along = (p, q) => (Math.abs(nx) > 0 ? q : p) * s;
      const a = this.vert(ax, y0, az, nx, 0, nz, along(ax, az), y0 * s);
      const b = this.vert(bx, y0, bz, nx, 0, nz, along(bx, bz), y0 * s);
      const c = this.vert(ax, y1, az, nx, 0, nz, along(ax, az), y1 * s);
      const d = this.vert(bx, y1, bz, nx, 0, nz, along(bx, bz), y1 * s);
      this.idx.push(a, b, c, b, d, c);
    };
    side(x0, z1, x1, z1, 0, 1);
    side(x1, z0, x0, z0, 0, -1);
    side(x1, z1, x1, z0, 1, 0);
    side(x0, z0, x0, z1, -1, 0);
  }
  circle(cx, cz, r, y, seg = 24) {
    const c = this.vert(cx, y, cz, 0, 1, 0, cx * this.s, cz * this.s);
    const first = this.pos.length / 3;
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
      this.vert(x, y, z, 0, 1, 0, x * this.s, z * this.s);
    }
    for (let i = 0; i < seg; i++) this.idx.push(c, first + i + 1, first + i);
  }
  build(scene, receive = true) {
    if (!this.idx.length) return null;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    geo.setIndex(this.idx);
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, this.mat);
    mesh.receiveShadow = receive;
    scene.add(mesh);
    return mesh;
  }
}

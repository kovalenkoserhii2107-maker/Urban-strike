import * as THREE from 'three';
import { toon, glow, G } from './materials.js';
import { islandSdf } from './world.js';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();

// Пул частиц на одном InstancedMesh: мультяшные шарики дыма/огня, обломки.
class Pool {
  constructor(scene, geo, mat, max, { shadow = false, bounce = false } = {}) {
    this.mesh = new THREE.InstancedMesh(geo, mat, max);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = shadow;
    this.mesh.count = 0;
    for (let i = 0; i < max; i++) this.mesh.setColorAt(i, _c.setRGB(1, 1, 1));
    this.max = max;
    this.list = [];
    this.bounce = bounce;
    scene.add(this.mesh);
  }
  spawn(p) {
    if (this.list.length >= this.max) this.list.shift();
    p.t = 0;
    p.rx ??= Math.random() * 6;
    p.ry ??= Math.random() * 6;
    p.spin ??= 0;
    p.drag ??= 1;
    p.grav ??= 0;
    p.sx ??= 1;
    p.sy ??= 1;
    p.sz ??= 1;
    this.list.push(p);
    return p;
  }
  update(dt) {
    const list = this.list;
    let n = 0;
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      p.t += dt;
      if (p.t >= p.life) continue;
      const k = p.t / p.life;
      const dragF = Math.exp(-p.drag * dt);
      p.vx *= dragF;
      p.vz *= dragF;
      p.vy = p.vy * dragF - p.grav * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      if (this.bounce && p.y < p.floor) {
        p.y = p.floor;
        p.vy = -p.vy * 0.35;
        p.vx *= 0.6;
        p.vz *= 0.6;
        p.spin *= 0.6;
      }
      p.rx += p.spin * dt;
      p.ry += p.spin * 0.7 * dt;
      const grow = 1 - Math.pow(1 - Math.min(k * (p.growRate || 3), 1), 2);
      let s = p.s0 + (p.s1 - p.s0) * grow;
      s *= 1 - smooth(p.fadeFrom ?? 0.6, 1, k);
      _e.set(p.rx, p.ry, 0);
      _q.setFromEuler(_e);
      _m.compose(_p.set(p.x, p.y, p.z), _q, _s.set(s * p.sx, s * p.sy, s * p.sz));
      this.mesh.setMatrixAt(n, _m);
      if (p.c1) _c.copy(p.c0).lerp(p.c1, Math.min(1, k * (p.colorRate || 1.5)));
      else _c.copy(p.c0);
      this.mesh.setColorAt(n, _c);
      list[n] = p;
      n++;
    }
    list.length = n;
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor.needsUpdate = true;
  }
}

function smooth(a, b, x) {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
}

const rnd = (a, b) => a + Math.random() * (b - a);

export class FX {
  constructor(scene, quality = 1) {
    this.scene = scene;
    this.q = quality;
    this.smoke = new Pool(scene, G.ico(1, 1), toon(0xffffff), Math.round(900 * quality), { shadow: true });
    this.fire = new Pool(scene, G.ico(1, 1), glow(0xffffff), Math.round(600 * quality));
    this.debris = new Pool(scene, G.box(1, 1, 1), toon(0xffffff), Math.round(380 * quality), { shadow: true, bounce: true });
    this.emitters = [];

    const scorchGeo = new THREE.CircleGeometry(1, 18).rotateX(-Math.PI / 2);
    this.scorch = new THREE.InstancedMesh(
      scorchGeo,
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.38, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }),
      140
    );
    this.scorch.frustumCulled = false;
    this.scorch.count = 0;
    this.scorchIdx = 0;
    this.scorch.renderOrder = 1;
    scene.add(this.scorch);

    this.rings = [];
    for (let i = 0; i < 8; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: 0xfff1c0, transparent: true, opacity: 0, depthWrite: false, toneMapped: false, side: THREE.DoubleSide });
      const ring = new THREE.Mesh(G.custom('shockRing', () => new THREE.RingGeometry(0.85, 1, 40).rotateX(-Math.PI / 2)), mat);
      ring.visible = false;
      scene.add(ring);
      this.rings.push({ mesh: ring, t: 1, life: 0.5, size: 1 });
    }
    this.colFire0 = new THREE.Color(3.2, 1.7, 0.45);
    this.colFire1 = new THREE.Color(1.4, 0.25, 0.05);
    this.colFlash = new THREE.Color(4, 3.2, 1.8);
    this.colSmoke0 = new THREE.Color(0x4a4643);
    this.colSmoke1 = new THREE.Color(0x9c9893);
    this.colWhite0 = new THREE.Color(0xf4f4f4);
    this.colWhite1 = new THREE.Color(0xbfc6cc);
  }

  explosion(x, y, z, size = 1, debrisColor = 0x555555) {
    const onWater = islandSdf(x, z) > 0 && y < 2;
    this.fire.spawn({ x, y: y + 0.5, z, vx: 0, vy: 0, vz: 0, life: 0.28, s0: 0.5 * size, s1: 4.2 * size, c0: this.colFlash, growRate: 6, fadeFrom: 0.2 });
    const nf = Math.round(9 * size * this.q) + 3;
    for (let i = 0; i < nf; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = rnd(3, 10) * size;
      this.fire.spawn({
        x: x + rnd(-1, 1) * size, y: y + rnd(0, 1.5) * size, z: z + rnd(-1, 1) * size,
        vx: Math.cos(a) * sp, vy: rnd(3, 11) * size, vz: Math.sin(a) * sp, drag: 3, grav: -2,
        life: rnd(0.4, 0.75), s0: 0.6 * size, s1: rnd(1.3, 2.3) * size, c0: this.colFire0, c1: this.colFire1, colorRate: 1.4, fadeFrom: 0.45,
      });
    }
    const ns = Math.round(8 * size * this.q) + 2;
    for (let i = 0; i < ns; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = rnd(1, 5) * size;
      this.smoke.spawn({
        x: x + rnd(-1, 1) * size, y: y + rnd(0.5, 2) * size, z: z + rnd(-1, 1) * size,
        vx: Math.cos(a) * sp, vy: rnd(3, 7), vz: Math.sin(a) * sp, drag: 1.4,
        life: rnd(1.4, 2.6), s0: 0.8 * size, s1: rnd(2.2, 3.6) * size,
        c0: onWater ? this.colWhite0 : this.colSmoke0, c1: onWater ? this.colWhite1 : this.colSmoke1, colorRate: 1, fadeFrom: 0.55, growRate: 2,
      });
    }
    if (!onWater) this.debrisBurst(x, y + 0.5, z, Math.round(6 * size * this.q) + 2, debrisColor, size);
    if (y < 4) {
      this.ring(x, Math.max(y, 0) + 0.25, z, 7 * size);
      if (!onWater) this.addScorch(x, z, 2.6 * size);
    }
    if (onWater) {
      for (let i = 0; i < 10; i++)
        this.smoke.spawn({
          x: x + rnd(-1, 1), y: 0, z: z + rnd(-1, 1), vx: rnd(-2, 2), vy: rnd(10, 18), vz: rnd(-2, 2), grav: 25,
          life: rnd(0.8, 1.1), s0: 0.7, s1: 1.4, c0: this.colWhite0, fadeFrom: 0.6,
        });
    }
  }

  debrisBurst(x, y, z, n, color, size = 1) {
    _c.set(color);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = rnd(4, 12) * Math.sqrt(size);
      const s = rnd(0.25, 0.7) * Math.sqrt(size);
      const col = _c.clone().multiplyScalar(rnd(0.6, 1.1));
      this.debris.spawn({
        x, y, z, vx: Math.cos(a) * sp, vy: rnd(6, 16), vz: Math.sin(a) * sp, grav: 30, drag: 0.4, floor: 0.2,
        life: rnd(2.2, 3.6), s0: s, s1: s, sx: rnd(0.6, 1.6), sy: rnd(0.4, 1), sz: rnd(0.6, 1.6), spin: rnd(-10, 10), c0: col, fadeFrom: 0.85, growRate: 100,
      });
    }
  }

  puff(x, y, z, size = 1, white = false, vy = 2) {
    this.smoke.spawn({
      x, y, z, vx: rnd(-0.5, 0.5), vy, vz: rnd(-0.5, 0.5), drag: 1, life: rnd(0.6, 1.0), s0: 0.3 * size, s1: 1.0 * size,
      c0: white ? this.colWhite0 : this.colSmoke1, c1: white ? this.colWhite1 : this.colSmoke1, fadeFrom: 0.4, growRate: 2.5,
    });
  }

  trail(x, y, z, size = 1) {
    this.smoke.spawn({ x, y, z, vx: 0, vy: 0.6, vz: 0, drag: 2, life: 0.75, s0: 0.35 * size, s1: 0.9 * size, c0: this.colWhite0, c1: this.colWhite1, fadeFrom: 0.3, growRate: 2 });
    this.fire.spawn({ x, y, z, vx: 0, vy: 0, vz: 0, life: 0.08, s0: 0.45 * size, s1: 0.2 * size, c0: this.colFire0, fadeFrom: 0.5 });
  }

  muzzle(x, y, z, size = 1, color = null) {
    this.fire.spawn({ x, y, z, vx: 0, vy: 0, vz: 0, life: 0.06, s0: 0.5 * size, s1: 0.8 * size, c0: color || this.colFlash, fadeFrom: 0.5, growRate: 10 });
  }

  spark(x, y, z, n = 3) {
    for (let i = 0; i < n; i++)
      this.fire.spawn({ x, y, z, vx: rnd(-8, 8), vy: rnd(2, 10), vz: rnd(-8, 8), grav: 30, life: rnd(0.15, 0.3), s0: 0.18, s1: 0.1, c0: this.colFire0, fadeFrom: 0.5 });
  }

  dust(x, z, n = 2) {
    for (let i = 0; i < n; i++)
      this.smoke.spawn({ x: x + rnd(-1, 1), y: 0.4, z: z + rnd(-1, 1), vx: rnd(-3, 3), vy: rnd(1, 3), vz: rnd(-3, 3), drag: 2, life: rnd(0.5, 0.9), s0: 0.3, s1: 0.9, c0: new THREE.Color(0xc9b28a), fadeFrom: 0.4 });
  }

  flare(x, y, z, vx, vz) {
    return this.fire.spawn({ x, y, z, vx, vy: rnd(2, 5), vz, grav: 6, drag: 0.8, life: 2.2, s0: 0.7, s1: 0.5, c0: new THREE.Color(4, 2.6, 1.2), fadeFrom: 0.8, growRate: 20 });
  }

  addFire(x, y, z, duration = 6, size = 1) {
    this.emitters.push({ x, y, z, t: 0, duration, size, acc: 0 });
  }

  ring(x, y, z, size) {
    const r = this.rings.find((r) => r.t >= r.life) || this.rings[0];
    r.t = 0;
    r.size = size;
    r.mesh.position.set(x, y, z);
    r.mesh.visible = true;
  }

  addScorch(x, z, size) {
    const i = this.scorchIdx++ % 140;
    _q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, Math.random() * 6);
    _m.compose(_p.set(x, 0.06 + i * 0.0004, z), _q, _s.set(size, 1, size * rnd(0.8, 1.1)));
    this.scorch.setMatrixAt(i, _m);
    this.scorch.count = Math.min(this.scorchIdx, 140);
    this.scorch.instanceMatrix.needsUpdate = true;
  }

  update(dt) {
    for (let i = this.emitters.length - 1; i >= 0; i--) {
      const e = this.emitters[i];
      e.t += dt;
      if (e.t > e.duration) {
        this.emitters.splice(i, 1);
        continue;
      }
      e.acc += dt * 14 * this.q;
      const fade = 1 - e.t / e.duration;
      while (e.acc > 1) {
        e.acc -= 1;
        this.fire.spawn({
          x: e.x + rnd(-0.8, 0.8) * e.size, y: e.y, z: e.z + rnd(-0.8, 0.8) * e.size, vx: rnd(-0.5, 0.5), vy: rnd(3, 5), vz: rnd(-0.5, 0.5),
          life: rnd(0.35, 0.6), s0: 0.9 * e.size * fade, s1: 0.4 * e.size, c0: this.colFire0, c1: this.colFire1, fadeFrom: 0.3, growRate: 4,
        });
        if (Math.random() < 0.45)
          this.smoke.spawn({
            x: e.x + rnd(-0.5, 0.5), y: e.y + 2, z: e.z + rnd(-0.5, 0.5), vx: 1.5, vy: rnd(3, 5), vz: 0.8, drag: 0.6,
            life: rnd(1.8, 2.6), s0: 0.6 * e.size, s1: 2.2 * e.size, c0: this.colSmoke0, c1: this.colSmoke1, fadeFrom: 0.5, growRate: 1.5,
          });
      }
    }
    this.smoke.update(dt);
    this.fire.update(dt);
    this.debris.update(dt);
    for (const r of this.rings) {
      if (r.t >= r.life) continue;
      r.t += dt;
      const k = Math.min(r.t / r.life, 1);
      const s = r.size * (0.2 + 0.8 * (1 - (1 - k) * (1 - k)));
      r.mesh.scale.setScalar(s);
      r.mesh.material.opacity = (1 - k) * 0.8;
      if (k >= 1) r.mesh.visible = false;
    }
  }
}

import * as THREE from 'three';
import * as M from './models.js';
import { toon, G } from './materials.js';
import { createJet } from './regions.js';
import { turnTowards, wrapAngle, dist2D } from '../core/utils.js';

const _v = new THREE.Vector3();
const _d = new THREE.Vector3();
const _wq = new THREE.Quaternion();
const rnd = (a, b) => a + Math.random() * (b - a);
const WRECK = 0x2e2b29;

export class Enemy {
  constructor(game, kind, x, z, cfg) {
    this.game = game;
    this.kind = kind;
    this.pos = new THREE.Vector3(x, game.world.heightAt(x, z) + (cfg.y ?? 0), z);
    this.hp = this.maxHp = cfg.hp;
    this.radius = cfg.radius;
    this.centerY = cfg.centerY;
    this.score = cfg.score;
    this.label = cfg.label || '';
    this.alive = true;
    this.targetable = true;
    this.invulnerable = false;
    this.tag = null;
    this.cool = rnd(0.5, 2.5);
    this.flash = 0;
    this.yaw = rnd(0, Math.PI * 2);
    this._aim = new THREE.Vector3();
    this.radarColor = '#ff4b4b';
  }
  attach(obj) {
    this.obj = obj;
    obj.position.copy(this.pos);
    obj.rotation.y = this.yaw;
    this.game.scene.add(obj);
    return this;
  }
  aimPoint() {
    return this._aim.set(this.pos.x, this.pos.y + this.centerY, this.pos.z);
  }
  // src: 'remote' — попадание ракеты напарника (награду за него получает он)
  hit(dmg, src) {
    if (!this.alive || this.invulnerable) return;
    this.lastHit = src;
    this.hp -= dmg;
    this.flash = 0.1;
    if (this.hp <= 0) {
      this.alive = false;
      this.die();
      this.game.onEnemyKilled(this);
    }
  }
  die() {
    const g = this.game;
    const c = this.aimPoint();
    g.fx.explosion(c.x, c.y, c.z, 1.3, 0x5b4a33);
    g.fx.addFire(this.pos.x, this.pos.y + this.centerY, this.pos.z, 9, 1);
    g.audio.play('boomBig', c.x, c.z);
    g.shakeAt(c.x, c.z, 0.7);
    g.world.blast(this.pos.x, this.pos.z, 3.5);
    this.makeWreck();
  }
  makeWreck() {
    if (!this.obj) return;
    this.obj.traverse((o) => {
      if (o.isMesh) {
        if (o.material.transparent) o.visible = false;
        o.material = toon(WRECK);
      }
    });
    this.obj.rotation.z = rnd(-0.12, 0.12);
    this.obj.position.y = this.pos.y - 0.3;
  }
  ground() {
    return this.game.world.heightAt(this.pos.x, this.pos.z);
  }
  player() {
    const g = this.game;
    const p1 = g.player && g.player.alive && g.player.state === 'fly' ? g.player : null;
    const p2 = g.remotePlayer && g.remotePlayer.alive && g.remotePlayer.state === 'fly' ? g.remotePlayer : null;
    if (p1 && p2) {
      const d1 = dist2D(p1.pos.x, p1.pos.z, this.pos.x, this.pos.z);
      const d2 = dist2D(p2.pos.x, p2.pos.z, this.pos.x, this.pos.z);
      return d1 <= d2 ? p1 : p2;
    }
    return p1 || p2;
  }
  inRange(r) {
    const p = this.player();
    return p && dist2D(p.pos.x, p.pos.z, this.pos.x, this.pos.z) < r ? p : null;
  }
  lead(from, speed, factor = 0.75) {
    const p = this.player() || this.game.player;
    const t = from.distanceTo(p.pos) / speed;
    return _v.copy(p.pos).addScaledVector(p.vel, t * factor);
  }
  fireAt(kind, from, speed, spread = 0.03, opts = {}) {
    const target = this.lead(from, speed, opts.leadFactor ?? 0.75);
    _d.copy(target).sub(from).normalize();
    _d.x += rnd(-spread, spread);
    _d.y += rnd(-spread, spread);
    _d.z += rnd(-spread, spread);
    return this.game.projectiles.spawn(kind, 'enemy', from, _d, opts);
  }
  baseUpdate(dt) {
    if (this.flash > 0) {
      this.flash -= dt;
      const s = 1 + Math.max(this.flash, 0) * 0.8;
      this.obj.scale.setScalar((this.baseScale || 1) * s);
    }
  }
  update() {}
}

// Движение по дорожной сетке (джипы, конвой, танки, босс).
export class RoadMover {
  constructor(world, x, z, speed) {
    this.graph = world.graph;
    this.from = this.graph.nearest(x, z, (n) => n.nbrs.length > 0);
    this.to = this.from.nbrs[Math.floor(Math.random() * this.from.nbrs.length)];
    this.t = 0;
    this.speed = speed;
  }
  step(dt, pos, lane = 0) {
    const len = Math.hypot(this.to.x - this.from.x, this.to.z - this.from.z) || 1;
    this.t += (this.speed * dt) / len;
    if (this.t >= 1) {
      this.t -= 1;
      const nx = this.graph.next(this.from, this.to);
      this.from = this.to;
      this.to = nx;
    }
    const p = this.from, q = this.to;
    const l = Math.hypot(q.x - p.x, q.z - p.z) || 1;
    const fx = (q.x - p.x) / l, fz = (q.z - p.z) / l;
    pos.x = p.x + (q.x - p.x) * this.t + fz * lane;
    pos.z = p.z + (q.z - p.z) * this.t - fx * lane;
    pos.y = p.y + (q.y - p.y) * this.t + 0.1;
    return Math.atan2(fx, fz);
  }
}

export class Soldier extends Enemy {
  constructor(game, x, z, kind = 'rifle') {
    super(game, kind === 'rpg' ? 'rpg' : 'soldier', x, z, { hp: 6, radius: 1.7, centerY: 1.7, score: kind === 'rpg' ? 90 : 50 });
    this.model = M.createPerson(kind);
    this.home = new THREE.Vector3(x, 0, z);
    this.goal = this.home.clone();
    this.isRpg = kind === 'rpg';
    this.walk = rnd(0, 6);
    this.baseScale = 1.35;
    this.attach(this.model.group);
    this.radarColor = '#ff8a6b';
  }
  update(dt) {
    this.baseUpdate(dt);
    const p = this.inRange(this.isRpg ? 62 : 50);
    if (p) {
      this.yaw = turnTowards(this.yaw, Math.atan2(p.pos.x - this.pos.x, p.pos.z - this.pos.z), dt * 6);
      this.cool -= dt;
      if (this.cool <= 0) {
        _v.set(this.pos.x, this.pos.y + 2.8, this.pos.z);
        const from = _v.clone();
        if (this.isRpg) {
          this.fireAt('rpg', from, 32, 0.05);
          this.game.audio.play('rocketE', this.pos.x, this.pos.z);
          this.cool = rnd(4.5, 6.5);
        } else {
          this.fireAt('ebullet', from, 58, 0.05);
          this.game.fx.muzzle(from.x, from.y, from.z, 0.6, null);
          this.game.audio.play('gunE', this.pos.x, this.pos.z);
          this.cool = rnd(1.1, 2.2);
        }
      }
      this.model.inner.rotation.x = 0;
    } else {
      const d = dist2D(this.goal.x, this.goal.z, this.pos.x, this.pos.z);
      if (d < 0.6) {
        this.goal.set(this.home.x + rnd(-8, 8), 0, this.home.z + rnd(-8, 8));
      } else {
        this.yaw = turnTowards(this.yaw, Math.atan2(this.goal.x - this.pos.x, this.goal.z - this.pos.z), dt * 5);
        this.pos.x += Math.sin(this.yaw) * 2.6 * dt;
        this.pos.z += Math.cos(this.yaw) * 2.6 * dt;
        this.pos.y = this.ground();
        this.walk += dt * 9;
      }
    }
    this.model.inner.position.y = Math.abs(Math.sin(this.walk)) * 0.12;
    this.obj.position.copy(this.pos);
    this.obj.rotation.y = this.yaw;
  }
  die() {
    const g = this.game;
    g.fx.puff(this.pos.x, 1.5, this.pos.z, 2.2);
    g.fx.debrisBurst(this.pos.x, 1.5, this.pos.z, 4, 0xb8935a, 0.6);
    g.audio.play('hitSoft', this.pos.x, this.pos.z);
    g.scene.remove(this.obj);
  }
}

export class Rescuee {
  constructor(game, x, z, kind = 'hostage') {
    this.game = game;
    this.kind = kind;
    this.pos = new THREE.Vector3(x, game.world.heightAt(x, z), z);
    this.home = this.pos.clone();
    this.model = M.createPerson(kind);
    this.obj = this.model.group;
    this.obj.position.copy(this.pos);
    this.obj.rotation.y = rnd(0, 6);
    game.scene.add(this.obj);
    this.alive = true;
    this.attached = false;
    this.winchable = true;
    this.t = rnd(0, 6);
    this.radarColor = '#ffffff';
    this.liftHeight = 2.5;
  }
  update(dt) {
    this.t += dt;
    if (this.attached) {
      this.model.arms[0].rotation.x = -2.9;
      this.model.arms[1].rotation.x = -2.9;
      this.obj.rotation.y += dt * 2;
      return;
    }
    const g = this.game;
    const p1 = g.player;
    const p2 = g.remotePlayer;
    let p = p1;
    if (p2 && p2.alive && (!p1.alive || dist2D(p2.pos.x, p2.pos.z, this.pos.x, this.pos.z) < dist2D(p1.pos.x, p1.pos.z, this.pos.x, this.pos.z))) {
      p = p2;
    }
    const near = p.alive && dist2D(p.pos.x, p.pos.z, this.pos.x, this.pos.z) < 40;
    const wave = near ? 14 : 5;
    this.model.arms[0].rotation.x = -2.6 + Math.sin(this.t * wave) * 0.5;
    this.model.arms[1].rotation.x = -2.6 - Math.sin(this.t * wave) * 0.5;
    this.model.arms[0].rotation.z = -0.3;
    this.model.arms[1].rotation.z = 0.3;
    this.obj.position.y = this.pos.y + (near ? Math.abs(Math.sin(this.t * 8)) * 0.6 : 0);
    if (near) this.obj.rotation.y = Math.atan2(p.pos.x - this.pos.x, p.pos.z - this.pos.z);
  }
  reset() {
    this.attached = false;
    this.alive = true;
    this.pos.copy(this.home);
    this.obj.position.copy(this.pos);
    this.obj.visible = true;
    if (!this.obj.parent) this.game.scene.add(this.obj);
  }
}

export class Jeep extends Enemy {
  constructor(game, x, z, { patrol = true } = {}) {
    super(game, 'jeep', x, z, { hp: 34, radius: 2.8, centerY: 1.3, score: 150, label: 'Джип' });
    this.model = M.createJeep();
    this.mover = patrol ? new RoadMover(game.world, x, z, rnd(9, 12)) : null;
    this.attach(this.model.group);
    this.burst = 0;
  }
  update(dt) {
    this.baseUpdate(dt);
    if (this.mover) this.yaw = turnTowards(this.yaw, this.mover.step(dt, this.pos, 2.4), dt * 5);
    const p = this.inRange(62);
    const tr = this.model.turret;
    if (p) {
      const want = Math.atan2(p.pos.x - this.pos.x, p.pos.z - this.pos.z) - this.yaw;
      tr.rotation.y = turnTowards(tr.rotation.y, want, dt * 4);
      this.cool -= dt;
      if (this.cool <= 0) {
        this.burst = 3;
        this.cool = rnd(2.0, 2.8);
      }
      if (this.burst > 0) {
        this.burstT = (this.burstT || 0) - dt;
        if (this.burstT <= 0) {
          this.burst--;
          this.burstT = 0.12;
          const from = this.model.muzzle.getWorldPosition(new THREE.Vector3());
          this.fireAt('ebullet', from, 58, 0.04);
          this.game.fx.muzzle(from.x, from.y, from.z, 0.7);
          this.game.audio.play('gunE', this.pos.x, this.pos.z);
        }
      }
    }
    this.obj.position.copy(this.pos);
    this.obj.rotation.y = this.yaw;
  }
}

export class Truck extends Enemy {
  constructor(game, x, z) {
    super(game, 'truck', x, z, { hp: 60, radius: 3.4, centerY: 2, score: 300, label: 'Грузовик конвоя' });
    this.model = M.createTruck();
    this.mover = new RoadMover(game.world, x, z, 7);
    this.attach(this.model.group);
  }
  update(dt) {
    this.baseUpdate(dt);
    this.yaw = turnTowards(this.yaw, this.mover.step(dt, this.pos, 2.4), dt * 4);
    this.obj.position.copy(this.pos);
    this.obj.rotation.y = this.yaw;
  }
}

export class Tank extends Enemy {
  constructor(game, x, z, { patrol = false } = {}) {
    super(game, 'tank', x, z, { hp: 140, radius: 3.6, centerY: 1.8, score: 350, label: 'Танк' });
    this.model = M.createTank();
    this.mover = patrol ? new RoadMover(game.world, x, z, 4.5) : null;
    this.attach(this.model.group);
  }
  update(dt) {
    this.baseUpdate(dt);
    if (this.mover) this.yaw = turnTowards(this.yaw, this.mover.step(dt, this.pos, 2.6), dt * 2);
    const p = this.inRange(72);
    const tr = this.model.turret;
    this.cool -= dt;
    if (p) {
      const want = wrapAngle(Math.atan2(p.pos.x - this.pos.x, p.pos.z - this.pos.z) - this.yaw);
      tr.rotation.y = turnTowards(tr.rotation.y, want, dt * 1.6);
      if (this.cool <= 0 && Math.abs(wrapAngle(want - tr.rotation.y)) < 0.2) {
        const from = this.model.muzzle.getWorldPosition(new THREE.Vector3());
        this.fireAt('shell', from, 48, 0.02);
        this.game.fx.muzzle(from.x, from.y, from.z, 1.6);
        this.game.fx.puff(from.x, from.y, from.z, 1.5);
        this.game.audio.play('cannon', this.pos.x, this.pos.z);
        this.cool = rnd(3.0, 3.8);
      }
    }
    this.obj.position.copy(this.pos);
    this.obj.rotation.y = this.yaw;
  }
}

export class AAGun extends Enemy {
  constructor(game, x, z) {
    super(game, 'aa', x, z, { hp: 75, radius: 3.2, centerY: 1.6, score: 300, label: 'Зенитка' });
    this.model = M.createAAGun();
    this.attach(this.model.group);
    this.burst = 0;
  }
  update(dt) {
    this.baseUpdate(dt);
    const p = this.inRange(85);
    const tr = this.model.turret;
    if (p) {
      const want = wrapAngle(Math.atan2(p.pos.x - this.pos.x, p.pos.z - this.pos.z) - this.yaw);
      tr.rotation.y = turnTowards(tr.rotation.y, want, dt * 2.5);
      this.cool -= dt;
      if (this.cool <= 0) {
        this.burst = 4;
        this.cool = rnd(2.6, 3.4);
      }
      if (this.burst > 0) {
        this.bt = (this.bt || 0) - dt;
        if (this.bt <= 0) {
          this.burst--;
          this.bt = 0.14;
          const from = this.model.muzzle.getWorldPosition(new THREE.Vector3());
          const dist = from.distanceTo(p.pos);
          this.fireAt('flak', from, 62, 0.06, { life: dist / 62 + rnd(-0.12, 0.12) });
          this.game.fx.muzzle(from.x, from.y, from.z, 1.1);
          this.game.audio.play('flakShot', this.pos.x, this.pos.z);
        }
      }
    }
    this.obj.position.copy(this.pos);
  }
}

export class SAMSite extends Enemy {
  constructor(game, x, z) {
    super(game, 'sam', x, z, { hp: 85, radius: 3.4, centerY: 1.8, score: 450, label: 'Пусковая ЗРК' });
    this.model = M.createSAM();
    this.attach(this.model.group);
    this.cool = rnd(2, 4);
    this.reload = 0;
  }
  update(dt) {
    this.baseUpdate(dt);
    const p = this.inRange(120);
    const tr = this.model.turret;
    if (this.reload > 0) {
      this.reload -= dt;
      if (this.reload <= 0) this.model.missiles.forEach((m) => (m.visible = true));
    }
    if (p) {
      const want = wrapAngle(Math.atan2(p.pos.x - this.pos.x, p.pos.z - this.pos.z) - this.yaw);
      tr.rotation.y = turnTowards(tr.rotation.y, want, dt * 1.5);
      this.cool -= dt;
      if (this.cool <= 0 && Math.abs(wrapAngle(want - tr.rotation.y)) < 0.3) {
        const from = this.model.muzzle.getWorldPosition(new THREE.Vector3());
        this.model.rail.getWorldQuaternion(_wq);
        const dir = new THREE.Vector3(0, 0, 1).applyQuaternion(_wq);
        this.game.projectiles.spawn('sam', 'enemy', from, dir, { target: p });
        this.game.fx.puff(from.x, from.y, from.z, 3, true);
        this.game.audio.play('samLaunch', this.pos.x, this.pos.z);
        this.game.hud.toast('⚠ Ракета ЗРК! Жми «Ловушки»', 'warn');
        this.model.missiles.forEach((m) => (m.visible = false));
        this.reload = 3;
        this.cool = rnd(7.5, 9.5);
      }
    }
    this.obj.position.copy(this.pos);
  }
}

export class Radar extends Enemy {
  constructor(game, x, z) {
    super(game, 'radar', x, z, { hp: 95, radius: 3.8, centerY: 3, score: 600, label: 'Радар ПВО' });
    this.model = M.createRadar();
    this.attach(this.model.group);
  }
  update(dt) {
    this.baseUpdate(dt);
    this.model.head.rotation.y += dt * 1.2;
  }
}

export class Bunker extends Enemy {
  constructor(game, x, z) {
    super(game, 'bunker', x, z, { hp: 700, radius: 10, centerY: 4.5, score: 3000, label: 'Командный центр' });
    this.model = M.createBunker();
    this.yaw = 0;
    this.attach(this.model.group);
    this.spawnT = 6;
    this.spawned = [];
  }
  update(dt) {
    this.model.flag.rotation.y = Math.sin(performance.now() / 300) * 0.3;
    if (this.flash > 0) this.flash -= dt;
    if (this.inRange(90)) {
      this.spawnT -= dt;
      this.spawned = this.spawned.filter((s) => s.alive);
      if (this.spawnT <= 0 && this.spawned.length < 4) {
        this.spawnT = 9;
        const s = new Soldier(this.game, this.pos.x + rnd(-6, 6), this.pos.z + 8, Math.random() < 0.4 ? 'rpg' : 'rifle');
        this.game.addEnemy(s);
        this.spawned.push(s);
      }
    }
  }
  die() {
    this.game.bigDeath(this, 2.2, 6);
    this.makeWreck();
    this.obj.scale.y = 0.45;
  }
}

export class Generator extends Enemy {
  constructor(game, x, z) {
    super(game, 'generator', x, z, { hp: 240, radius: 5.5, centerY: 4, score: 1200, label: 'Генератор' });
    this.model = M.createGenerator();
    this.attach(this.model.group);
  }
  update(dt) {
    if (this.flash > 0) this.flash -= dt;
    this.model.core.scale.setScalar(1 + Math.sin(performance.now() / 200) * 0.08);
  }
  die() {
    this.game.bigDeath(this, 1.8, 4);
    this.makeWreck();
  }
}

export class EnemyHeli extends Enemy {
  constructor(game, x, z) {
    super(game, 'heli', x, z, { hp: 110, radius: 3.6, centerY: 0, score: 900, y: 18, label: 'Вертолёт противника' });
    this.model = M.createHeli('enemy');
    this.home = new THREE.Vector3(x, this.pos.y, z);
    this.vel = new THREE.Vector3();
    this.orbit = rnd(0, 6);
    this.attach(this.model.group);
    this.gunBurst = 0;
  }
  update(dt) {
    if (this.dying) return this.fall(dt);
    this.baseUpdate(dt);
    this.model.rotor.rotation.y += dt * 30;
    this.model.tailRotor.rotation.x += dt * 40;
    const p = this.inRange(95);
    let goal;
    if (p) {
      this.orbit += dt * 0.5;
      goal = _v.set(p.pos.x + Math.cos(this.orbit) * 34, 0, p.pos.z + Math.sin(this.orbit) * 34);
    } else {
      this.orbit += dt * 0.25;
      goal = _v.set(this.home.x + Math.cos(this.orbit) * 40, 0, this.home.z + Math.sin(this.orbit) * 40);
    }
    _d.copy(goal).sub(this.pos);
    _d.y = 0;
    const acc = Math.min(_d.length(), 20) * 1.4;
    _d.normalize().multiplyScalar(acc * dt);
    this.vel.add(_d).multiplyScalar(Math.exp(-1.2 * dt));
    this.pos.add(this.vel.clone().multiplyScalar(dt));
    // держим высоту над рельефом и крышами
    const alt = this.game.world.clearance(this.pos.x, this.pos.z, 6) + 17;
    this.pos.y += (alt - this.pos.y) * Math.min(1, dt * 1.5);
    const face = p ? Math.atan2(p.pos.x - this.pos.x, p.pos.z - this.pos.z) : Math.atan2(this.vel.x, this.vel.z);
    this.yaw = turnTowards(this.yaw, face, dt * 2.2);
    if (p) {
      this.cool -= dt;
      if (this.cool <= 0) {
        if (Math.random() < 0.5) {
          const from = this.model.podL.getWorldPosition(new THREE.Vector3());
          this.fireAt('ehrocket', from, 52, 0.03);
          this.game.audio.play('rocketE', this.pos.x, this.pos.z);
        } else this.gunBurst = 6;
        this.cool = rnd(2.2, 3.2);
      }
      if (this.gunBurst > 0) {
        this.gt = (this.gt || 0) - dt;
        if (this.gt <= 0) {
          this.gunBurst--;
          this.gt = 0.1;
          const from = this.model.nose.getWorldPosition(new THREE.Vector3());
          this.fireAt('ebullet', from, 58, 0.04);
          this.game.fx.muzzle(from.x, from.y, from.z, 0.6);
          this.game.audio.play('gunE', this.pos.x, this.pos.z);
        }
      }
    }
    this.obj.position.copy(this.pos);
    this.obj.rotation.set(this.vel.z * 0.02 * Math.cos(this.yaw) + this.vel.x * 0.02 * Math.sin(this.yaw), this.yaw, 0, 'YXZ');
  }
  die() {
    this.dying = true;
    this.spin = 0;
    this.game.fx.explosion(this.pos.x, this.pos.y, this.pos.z, 0.8);
    this.game.audio.play('boom', this.pos.x, this.pos.z);
  }
  fall(dt) {
    this.spin += dt * 9;
    this.vel.y -= 18 * dt;
    this.pos.addScaledVector(this.vel, dt);
    this.obj.position.copy(this.pos);
    this.obj.rotation.y += this.spin * dt;
    this.model.rotor.rotation.y += dt * 20;
    if (Math.random() < 0.6) this.game.fx.puff(this.pos.x, this.pos.y, this.pos.z, 2.2);
    const gy = Math.max(this.ground(), this.game.world.waterLevel);
    if (this.pos.y <= gy + 0.5) {
      this.dying = false;
      this.pos.y = gy;
      this.obj.position.y = gy;
      this.game.fx.explosion(this.pos.x, gy + 1, this.pos.z, 2);
      this.game.fx.addFire(this.pos.x, gy + 1, this.pos.z, 10, 1.2);
      this.game.audio.play('boomBig', this.pos.x, this.pos.z);
      this.game.world.blast(this.pos.x, this.pos.z, 6);
      this.game.shakeAt(this.pos.x, this.pos.z, 1);
      this.makeWreck();
      this.obj.rotation.x = 0.4;
    }
  }
}

// ---------- босс: бронированная ракетная крепость ----------
class BossPart extends Enemy {
  constructor(game, boss, kind, local, cfg) {
    super(game, kind, 0, 0, cfg);
    this.boss = boss;
    this.local = local;
    this.radarColor = '#ff2a2a';
  }
  sync() {
    this.obj.getWorldPosition(this.pos);
  }
  makeWreck() {
    this.obj.traverse((o) => o.isMesh && (o.material = toon(WRECK)));
    this.game.fx.addFire(this.pos.x, this.pos.y + 0.5, this.pos.z, 30, 0.8);
  }
  die() {
    const c = this.aimPoint();
    this.game.fx.explosion(c.x, c.y, c.z, 1.4);
    this.game.audio.play('boomBig', c.x, c.z);
    this.game.shakeAt(c.x, c.z, 0.8);
    this.makeWreck();
    this.boss.partDestroyed();
  }
}

class BossTurret extends BossPart {
  constructor(game, boss, local) {
    super(game, boss, 'bossTurret', local, { hp: 160, radius: 2.4, centerY: 0.6, score: 600, label: 'Турель крепости' });
    const g = new THREE.Group();
    const base = new THREE.Mesh(G.box(2, 1.1, 2.2), toon(0x8a7a5c));
    base.position.y = 0.5;
    g.add(base);
    const barrel = new THREE.Mesh(G.cyl(0.15, 0.18, 2.6, 6), toon(0x3b3f46));
    barrel.rotation.x = Math.PI / 2 - 0.5;
    barrel.position.set(0, 0.8, 1.3);
    g.add(barrel);
    M.enableShadows(g);
    g.position.copy(local);
    boss.obj.add(g);
    this.obj = g;
    this.cool = rnd(1, 2);
  }
  update(dt) {
    this.sync();
    if (this.flash > 0) this.flash -= dt;
    const p = this.inRange(78);
    if (!p) return;
    const want = wrapAngle(Math.atan2(p.pos.x - this.pos.x, p.pos.z - this.pos.z) - this.boss.yaw);
    this.obj.rotation.y = turnTowards(this.obj.rotation.y, want, dt * 3);
    this.cool -= dt;
    if (this.cool <= 0) {
      this.burst = 4;
      this.cool = rnd(1.6, 2.2);
    }
    if (this.burst > 0) {
      this.bt = (this.bt || 0) - dt;
      if (this.bt <= 0) {
        this.burst--;
        this.bt = 0.11;
        const from = this.aimPoint().clone();
        from.y += 1;
        this.fireAt('ebullet', from, 58, 0.035);
        this.game.fx.muzzle(from.x, from.y, from.z, 0.8);
        this.game.audio.play('gunE', this.pos.x, this.pos.z);
      }
    }
  }
}

class BossLauncher extends BossPart {
  constructor(game, boss, local) {
    super(game, boss, 'bossLauncher', local, { hp: 240, radius: 3, centerY: 1, score: 900, label: 'Ракетная установка' });
    const sam = M.createSAM();
    const g = sam.turret;
    g.position.copy(local);
    boss.obj.add(g);
    this.obj = g;
    this.model = sam;
    this.cool = 4;
  }
  update(dt) {
    this.sync();
    if (this.flash > 0) this.flash -= dt;
    const p = this.inRange(130);
    if (!p) return;
    const want = wrapAngle(Math.atan2(p.pos.x - this.pos.x, p.pos.z - this.pos.z) - this.boss.yaw);
    this.obj.rotation.y = turnTowards(this.obj.rotation.y, want, dt * 1.5);
    this.cool -= dt;
    if (this.cool <= 0) {
      const from = this.model.muzzle.getWorldPosition(new THREE.Vector3());
      this.model.rail.getWorldQuaternion(_wq);
      const dir = new THREE.Vector3(0, 0, 1).applyQuaternion(_wq);
      this.game.projectiles.spawn('sam', 'enemy', from, dir, { target: p });
      this.game.audio.play('samLaunch', this.pos.x, this.pos.z);
      this.game.hud.toast('⚠ Ракета ЗРК! Жми «Ловушки»', 'warn');
      this.cool = rnd(5.5, 7);
    }
  }
}

export class Fortress extends Enemy {
  constructor(game, x, z) {
    super(game, 'boss', x, z, { hp: 900, radius: 4, centerY: 6.8, score: 8000, label: 'Крепость «Голиаф»' });
    this.model = M.createFortress();
    this.mover = new RoadMover(game.world, x, z, 3.2);
    this.attach(this.model.group);
    this.invulnerable = true;
    this.targetable = false;
    this.isBoss = true;
    this.parts = [
      new BossTurret(game, this, new THREE.Vector3(-3.6, 4.2, 5.4)),
      new BossTurret(game, this, new THREE.Vector3(3.6, 4.2, 5.4)),
      new BossTurret(game, this, new THREE.Vector3(-3.6, 4.2, -6.2)),
      new BossTurret(game, this, new THREE.Vector3(3.6, 4.2, -6.2)),
      new BossLauncher(game, this, new THREE.Vector3(0, 6.3, 3.4)),
    ];
    this.remaining = this.parts.length;
    this.flakT = 3;
  }
  partDestroyed() {
    this.remaining--;
    if (this.remaining === 0) {
      this.invulnerable = false;
      this.targetable = true;
      this.mover.speed = 6;
      this.game.hud.toast('Щит крепости отключён — бей по ядру!', 'good');
      this.game.audio.play('shieldDown', this.pos.x, this.pos.z);
    }
  }
  totalHp() {
    let hp = Math.max(this.hp, 0), max = this.maxHp;
    for (const p of this.parts) {
      hp += Math.max(p.hp, 0);
      max += p.maxHp;
    }
    return hp / max;
  }
  aimPoint() {
    return this._aim.set(this.pos.x, this.pos.y + this.centerY, this.pos.z).add(new THREE.Vector3(0, 0, -1).applyAxisAngle(THREE.Object3D.DEFAULT_UP, this.yaw));
  }
  update(dt) {
    if (this.flash > 0) this.flash -= dt;
    this.yaw = turnTowards(this.yaw, this.mover.step(dt, this.pos, 0), dt * 0.8);
    this.obj.position.copy(this.pos);
    this.obj.rotation.y = this.yaw;
    this.obj.updateMatrixWorld(true);
    const sh = this.model.shield;
    if (this.invulnerable) {
      sh.material.opacity = 0.18 + Math.sin(performance.now() / 150) * 0.06;
      sh.rotation.y += dt;
    } else if (sh.visible) {
      sh.scale.multiplyScalar(1 + dt * 3);
      sh.material.opacity -= dt * 0.4;
      if (sh.material.opacity <= 0) sh.visible = false;
    }
    this.model.core.scale.setScalar(1 + Math.sin(performance.now() / (this.invulnerable ? 300 : 110)) * 0.12);
    if (!this.invulnerable) {
      const p = this.inRange(90);
      this.flakT -= dt;
      if (p && this.flakT <= 0) {
        this.flakT = 2.4;
        const from = this.aimPoint().clone();
        for (let i = 0; i < 5; i++) this.fireAt('flak', from, 62, 0.12, { life: from.distanceTo(p.pos) / 62 + rnd(-0.2, 0.2) });
        this.game.audio.play('flakShot', this.pos.x, this.pos.z);
      }
    }
  }
  die() {
    this.game.bigDeath(this, 3.5, 10);
    this.makeWreck();
  }
}

// Истребитель на стоянке авиабазы: неподвижная, но ценная цель.
export class ParkedJet extends Enemy {
  constructor(game, x, z, rot = 0) {
    super(game, 'jet', x, z, { hp: 50, radius: 4.5, centerY: 1.8, score: 450, label: 'Истребитель' });
    this.yaw = rot;
    this.attach(createJet());
  }
  update(dt) {
    this.baseUpdate(dt);
  }
}

export function spawnEnemy(game, type, x, z, opts = {}) {
  let e;
  switch (type) {
    case 'soldier': e = new Soldier(game, x, z, 'rifle'); break;
    case 'rpg': e = new Soldier(game, x, z, 'rpg'); break;
    case 'jeep': e = new Jeep(game, x, z, opts); break;
    case 'truck': e = new Truck(game, x, z); break;
    case 'tank': e = new Tank(game, x, z, opts); break;
    case 'aa': e = new AAGun(game, x, z); break;
    case 'sam': e = new SAMSite(game, x, z); break;
    case 'radar': e = new Radar(game, x, z); break;
    case 'bunker': e = new Bunker(game, x, z); break;
    case 'generator': e = new Generator(game, x, z); break;
    case 'heli': e = new EnemyHeli(game, x, z); break;
    case 'jet': e = new ParkedJet(game, x, z, opts.rot || 0); break;
    case 'boss': {
      e = new Fortress(game, x, z);
      game.addEnemy(e);
      for (const p of e.parts) game.addEnemy(p);
      e.tag = opts.tag || null;
      return e;
    }
    default: throw new Error('unknown enemy ' + type);
  }
  e.tag = opts.tag || null;
  game.addEnemy(e);
  return e;
}


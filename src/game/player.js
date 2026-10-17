import * as THREE from 'three';
import { createViper } from './viper.js';
import { toon, glow, G } from './materials.js';
import { clamp, damp, turnTowards, wrapAngle, dist2D } from '../core/utils.js';
import { MAP } from './world.js';

export const CAM_YAW = Math.PI / 4;
const CRUISE = 16;
const _v = new THREE.Vector3();
const _d = new THREE.Vector3();
const rnd = (a, b) => a + Math.random() * (b - a);

export class Player {
  constructor(game, upgrades) {
    this.game = game;
    const u = upgrades;
    this.maxArmor = 100 + u.armor * 30;
    this.fuelDrain = 0.55 / (1 + u.fuel * 0.3);
    this.gunMult = 1 + u.gun * 0.3;
    this.rocketMult = 1 + u.rockets * 0.2;
    this.maxAmmo = { gun: 1200, hydra: 38 + u.rockets * 10, hellfire: 8 + u.rockets * 2 };
    this.capacity = 6;

    const m = createViper(game.save.skin);
    this.model = m;
    this.obj = m.group;
    game.scene.add(this.obj);

    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.rope = new THREE.Mesh(G.cyl(0.07, 0.07, 1, 5).clone().translate(0, -0.5, 0), toon(0x222222));
    this.hook = new THREE.Mesh(G.box(0.5, 0.5, 0.5), glow(0xffd34d));
    this.rope.visible = this.hook.visible = false;
    game.scene.add(this.rope, this.hook);

    this.targetRing = new THREE.Mesh(
      G.custom('targetRing', () => new THREE.RingGeometry(1.0, 1.25, 4, 1).rotateX(-Math.PI / 2)),
      new THREE.MeshBasicMaterial({ color: 0xff3b3b, transparent: true, opacity: 0.9, depthTest: false, toneMapped: false })
    );
    this.targetRing.renderOrder = 10;
    game.scene.add(this.targetRing);

    if (game.world.night) {
      this.spot = new THREE.SpotLight(0xfff2c8, 900, 90, 0.42, 0.55, 1.6);
      this.spot.castShadow = false;
      game.scene.add(this.spot, this.spot.target);
    }
    this.respawn();
  }

  respawn() {
    const b = this.game.world.base;
    this.pos.set(b.x, 0.35, b.z);
    this.vel.set(0, 0, 0);
    this.yaw = Math.atan2(-Math.sin(CAM_YAW), -Math.cos(CAM_YAW));
    this.armor = this.maxArmor;
    this.fuel = 100;
    this.ammo = { ...this.maxAmmo };
    this.flares = 6;
    this.flareCharge = 0;
    this.passengers = [];
    this.alive = true;
    this.state = 'intro';
    this.introT = 0;
    this.invuln = 3;
    this.cool = { gun: 0, hydra: 0, hellfire: 0 };
    this.pod = 0;
    this.target = null;
    this.targetT = 0;
    this.winch = null;
    this.unloadT = 0;
    this.tilt = { x: 0, z: 0 };
    this.lowFuelWarned = false;
    this.obj.visible = true;
    this.obj.rotation.set(0, this.yaw, 0);
    this.obj.position.copy(this.pos);
  }

  aimPoint() {
    return this.pos;
  }

  // Ввод в экранных координатах -> направление в мире (камера повёрнута на 45°).
  worldMove(mx, my) {
    const s = Math.sin(CAM_YAW), c = Math.cos(CAM_YAW);
    return _d.set(c * mx - s * my, 0, -s * mx - c * my);
  }

  update(dt, input) {
    const g = this.game;
    const m = this.model;
    m.rotor.rotation.y += dt * (this.state === 'dead' ? 0 : 32);
    m.tailRotor.rotation.x += dt * 45;
    m.disc.material.opacity = this.state === 'dead' ? 0 : 0.1 + Math.sin(g.time * 40) * 0.03;
    m.tailDisc.material.opacity = this.state === 'dead' ? 0 : 0.12;
    m.beacon.visible = Math.sin(g.time * 6) > 0.3;

    if (this.state === 'dying') return this.updateDying(dt);
    if (this.state === 'dead') return;

    if (this.invuln > 0) this.invuln -= dt;

    if (this.state === 'intro') {
      this.introT += dt;
      const k = clamp(this.introT / 2.4, 0, 1);
      this.pos.y = 0.35 + (CRUISE - 0.35) * (1 - Math.pow(1 - k, 3));
      if (Math.random() < 0.7) g.fx.dust(this.pos.x + rnd(-6, 6), this.pos.z + rnd(-6, 6), 1);
      if (k >= 1) this.state = 'fly';
      this.applyTransform(dt, 0, 0);
      return;
    }

    // --- движение ---
    const mv = input.move;
    const mag = Math.min(1, Math.hypot(mv.x, mv.y));
    const dir = this.worldMove(mv.x, mv.y);
    const ACC = 46;
    this.vel.x += dir.x * ACC * dt;
    this.vel.z += dir.z * ACC * dt;
    const drag = Math.exp(-1.7 * dt);
    this.vel.x *= drag;
    this.vel.z *= drag;
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    const lim = MAP.L + 40;
    if (Math.abs(this.pos.x) > lim) {
      this.pos.x = Math.sign(this.pos.x) * lim;
      this.vel.x *= -0.3;
    }
    if (Math.abs(this.pos.z) > lim) {
      this.pos.z = Math.sign(this.pos.z) * lim;
      this.vel.z *= -0.3;
    }
    const clearance = g.world.clearance(this.pos.x, this.pos.z, 4);
    const targetAlt = Math.max(CRUISE, clearance + 6);
    this.pos.y = damp(this.pos.y, targetAlt, targetAlt > this.pos.y ? 4 : 1.5, dt);

    // --- цель и стрельба ---
    this.targetT -= dt;
    if (this.targetT <= 0) {
      this.targetT = 0.12;
      this.target = this.findTarget();
    }
    if (this.target && !this.target.alive) this.target = null;

    let wantYaw = this.yaw;
    const firing = input.gun || input.hydra;
    if (firing && this.target) {
      const t = this.target.pos;
      wantYaw = Math.atan2(t.x - this.pos.x, t.z - this.pos.z);
    } else if (mag > 0.15) wantYaw = Math.atan2(dir.x, dir.z);
    this.yaw = turnTowards(this.yaw, wantYaw, dt * (firing ? 4.5 : 3.4));

    for (const k in this.cool) this.cool[k] -= dt;
    if (input.gun) this.fireGun();
    if (input.hydra) this.fireHydra();
    if (input.hellfirePressed) this.fireHellfire();
    if (input.flarePressed) this.deployFlares();

    this.flareCharge += dt;
    if (this.flares < 6 && this.flareCharge > 9) {
      this.flareCharge = 0;
      this.flares++;
    }

    this.updateWinch(dt);
    this.updateBase(dt);

    // --- топливо ---
    this.fuel -= this.fuelDrain * dt;
    if (this.fuel < 25 && !this.lowFuelWarned) {
      this.lowFuelWarned = true;
      g.hud.toast('Мало топлива! Ищи канистры или вернись на базу', 'warn');
      g.audio.play('warn');
    }
    if (this.fuel > 30) this.lowFuelWarned = false;
    if (this.fuel <= 0) {
      this.fuel = 0;
      g.hud.toast('Топливо кончилось!', 'bad');
      this.die();
    }

    // наклон корпуса от ускорения
    const fwdX = Math.sin(this.yaw), fwdZ = Math.cos(this.yaw);
    const along = this.vel.x * fwdX + this.vel.z * fwdZ;
    const side = this.vel.x * fwdZ - this.vel.z * fwdX;
    this.applyTransform(dt, along, side);
    this.updateWeaponsVisual(dt);

    // рябь от винта над водой/землёй
    if (this.pos.y < 20 && Math.random() < 0.3) {
      const a = Math.random() * Math.PI * 2;
      g.fx.dust(this.pos.x + Math.cos(a) * 5, this.pos.z + Math.sin(a) * 5, 1);
    }
  }

  // Пушка следит за целью, стволы крутятся, на крыльях видно сколько осталось Hellfire,
  // а повреждённые двигатели дымят.
  updateWeaponsVisual(dt) {
    const m = this.model;
    let yaw = 0, pitch = 0.3;
    if (this.target) {
      this.obj.updateMatrixWorld();
      const local = this.obj.worldToLocal(_v.copy(this.target.aimPoint())).sub(m.gunTurret.position);
      yaw = clamp(Math.atan2(local.x, local.z), -1.9, 1.9);
      pitch = clamp(Math.atan2(-local.y, Math.hypot(local.x, local.z)), -0.2, 1.25);
    }
    m.gunTurret.rotation.y = damp(m.gunTurret.rotation.y, yaw, 10, dt);
    m.gunPitch.rotation.x = damp(m.gunPitch.rotation.x, pitch, 10, dt);
    if (this.gunSpin > 0) {
      this.gunSpin -= dt;
      m.barrels.rotation.z += dt * 45;
    }
    const shown = Math.ceil((this.ammo.hellfire / this.maxAmmo.hellfire) * m.hellfires.length);
    m.hellfires.forEach((h, i) => (h.visible = i < shown));
    const hp = this.armor / this.maxArmor;
    if (hp < 0.5 && Math.random() < (0.5 - hp) * 1.6) {
      const ex = m.exhausts[Math.random() < 0.5 ? 0 : 1].getWorldPosition(_v);
      this.game.fx.puff(ex.x, ex.y, ex.z, hp < 0.25 ? 1.6 : 1.1, false, 1.5);
      if (hp < 0.25 && Math.random() < 0.15) this.game.fx.spark(ex.x, ex.y, ex.z, 2);
    }
  }

  applyTransform(dt, along, side) {
    this.tilt.x = damp(this.tilt.x, clamp(along * 0.012, -0.32, 0.32), 5, dt);
    this.tilt.z = damp(this.tilt.z, clamp(-side * 0.014, -0.35, 0.35), 5, dt);
    const bob = Math.sin(this.game.time * 2.2) * 0.15;
    this.obj.position.set(this.pos.x, this.pos.y + bob, this.pos.z);
    this.obj.rotation.set(this.tilt.x, this.yaw, this.tilt.z, 'YXZ');
    this.obj.visible = !(this.invuln > 0 && this.state === 'fly' && Math.sin(this.game.time * 30) > 0.6);
    const tr = this.targetRing;
    if (this.target && this.state === 'fly') {
      const t = this.target;
      tr.visible = true;
      tr.position.set(t.pos.x, t.pos.y + 0.3 + (t.kind === 'heli' ? -t.centerY : 0), t.pos.z);
      const s = t.radius * 1.5 + Math.sin(this.game.time * 8) * 0.25;
      tr.scale.setScalar(s);
      tr.rotation.y += dt * 2;
    } else tr.visible = false;
    if (this.spot) {
      this.spot.position.set(this.pos.x, this.pos.y + 2, this.pos.z);
      this.spot.target.position.set(this.pos.x + Math.sin(this.yaw) * 22, 0, this.pos.z + Math.cos(this.yaw) * 22);
    }
  }

  findTarget() {
    let best = null, bestScore = Infinity;
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    for (const e of this.game.enemies) {
      if (!e.alive || !e.targetable) continue;
      const dx = e.pos.x - this.pos.x, dz = e.pos.z - this.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > 85) continue;
      const cos = (dx * fx + dz * fz) / (d || 1);
      const ang = Math.acos(clamp(cos, -1, 1));
      if (ang > 1.3 && d > 30) continue;
      const score = d + ang * 35 - (e.tag ? 10 : 0) - (e === this.target ? 12 : 0);
      if (score < bestScore) {
        bestScore = score;
        best = e;
      }
    }
    return best;
  }

  aimDir(from, speed, spread = 0) {
    if (this.target) {
      const tp = this.target.aimPoint();
      const tvel = this.target.vel || this.target.velocity;
      _v.copy(tp);
      if (tvel) _v.addScaledVector(tvel, from.distanceTo(tp) / speed);
      _v.sub(from);
    } else {
      _v.set(Math.sin(this.yaw) * 34, -this.pos.y, Math.cos(this.yaw) * 34);
    }
    _v.normalize();
    if (spread) {
      _v.x += rnd(-spread, spread);
      _v.y += rnd(-spread, spread);
      _v.z += rnd(-spread, spread);
    }
    return _v;
  }

  fireGun() {
    if (this.cool.gun > 0) return;
    if (this.ammo.gun <= 0) return this.dry();
    this.cool.gun = 1 / 12;
    this.gunSpin = 0.2;
    this.ammo.gun--;
    const g = this.game;
    const from = this.model.nose.getWorldPosition(new THREE.Vector3());
    g.projectiles.spawn('gun', 'player', from, this.aimDir(from, 150, 0.025), { mult: this.gunMult });
    g.fx.muzzle(from.x, from.y, from.z, 0.9);
    g.audio.play('gun');
    g.stats.shots++;
  }

  fireHydra() {
    if (this.cool.hydra > 0) return;
    if (this.ammo.hydra <= 0) return this.dry();
    this.cool.hydra = 0.24;
    this.ammo.hydra--;
    const g = this.game;
    const pod = this.pod++ % 2 ? this.model.podL : this.model.podR;
    const from = pod.getWorldPosition(new THREE.Vector3());
    g.projectiles.spawn('hydra', 'player', from, this.aimDir(from, 75, 0.012), { mult: this.rocketMult });
    g.fx.puff(from.x, from.y, from.z, 1.4, true);
    g.audio.play('rocket');
    g.vibrate(12);
  }

  fireHellfire() {
    if (this.cool.hellfire > 0) return;
    if (this.ammo.hellfire <= 0) return this.dry();
    this.cool.hellfire = 0.7;
    this.ammo.hellfire--;
    const g = this.game;
    // ракета уходит с той подвески, где она висела
    const rack = this.model.hellfires;
    const shown = Math.ceil(((this.ammo.hellfire + 1) / this.maxAmmo.hellfire) * rack.length);
    const from = rack[clamp(shown - 1, 0, rack.length - 1)].getWorldPosition(new THREE.Vector3());
    const dir = new THREE.Vector3(Math.sin(this.yaw), -0.25, Math.cos(this.yaw));
    g.projectiles.spawn('hellfire', 'player', from, dir, { mult: this.rocketMult, target: this.target });
    g.fx.puff(from.x, from.y, from.z, 2, true);
    g.audio.play('hellfire');
    g.vibrate(25);
    if (this.target) g.hud.toast('Hellfire: цель захвачена', 'info', 900);
  }

  dry() {
    if (!this.dryT || this.game.time - this.dryT > 1.5) {
      this.dryT = this.game.time;
      this.game.hud.toast('Нет боезапаса! Ищи ящики с патронами', 'warn');
      this.game.audio.play('click');
    }
  }

  deployFlares() {
    const g = this.game;
    if (this.flares <= 0) {
      g.hud.toast('Ловушки перезаряжаются…', 'info', 900);
      return;
    }
    this.flares--;
    this.flareCharge = 0;
    const decoys = [];
    for (let i = 0; i < 6; i++) {
      const a = this.yaw + Math.PI + rnd(-1.2, 1.2);
      const p = g.fx.flare(this.pos.x, this.pos.y - 1, this.pos.z, Math.sin(a) * rnd(8, 14), Math.cos(a) * rnd(8, 14));
      decoys.push(p);
    }
    let fooled = 0;
    for (const pr of g.projectiles.list) {
      if (pr.def.sam && pr.target === this && pr.pos.distanceTo(this.pos) < 90 && Math.random() < 0.92) {
        const fp = decoys[Math.floor(Math.random() * decoys.length)];
        pr.target = { isFlare: true, alive: true, get pos() { return _flarePos.set(fp.x, fp.y, fp.z); } };
        fooled++;
      }
    }
    g.audio.play('flare');
    if (fooled) g.hud.toast(`Ракеты уведены ловушками: ${fooled}`, 'good', 1200);
  }

  // --- лебёдка: подбор ящиков и людей, зависнув над ними ---
  updateWinch(dt) {
    const g = this.game;
    const speed = Math.hypot(this.vel.x, this.vel.z);
    const w = this.winch;
    const ropeTop = this.pos.y - 1.4;
    if (!w) {
      this.rope.visible = this.hook.visible = false;
      if (speed > 12) return;
      let best = null, bd = 7.5;
      for (const it of g.winchables) {
        if (!it.alive || it.attached) continue;
        if (it.kind !== 'pickup' && this.passengers.length >= this.capacity) continue;
        const d = dist2D(it.pos.x, it.pos.z, this.pos.x, this.pos.z);
        if (d < bd) {
          bd = d;
          best = it;
        }
      }
      if (best) {
        this.winch = { target: best, len: 0, phase: 'down' };
        g.audio.play('winch');
      }
      return;
    }
    const t = w.target;
    const hd = dist2D(t.pos.x, t.pos.z, this.pos.x, this.pos.z);
    if (w.phase === 'down') {
      w.len += 26 * dt;
      if (hd > 10 || !t.alive) w.phase = 'retract';
      else if (ropeTop - w.len <= t.pos.y + (t.liftHeight || 2)) {
        w.phase = 'up';
        t.attached = true;
      }
    } else if (w.phase === 'up') {
      w.len -= 15 * dt;
      t.pos.set(this.pos.x, ropeTop - w.len - (t.liftHeight || 2) + 0.5, this.pos.z);
      t.obj.position.copy(t.pos);
      if (w.len <= 0.5) {
        this.collect(t);
        this.winch = null;
      }
    } else {
      w.len -= 40 * dt;
      if (w.len <= 0) this.winch = null;
    }
    if (this.winch) {
      const len = Math.max(w.len, 0.01);
      this.rope.visible = this.hook.visible = true;
      this.rope.position.set(this.pos.x, ropeTop, this.pos.z);
      this.rope.scale.set(1, len, 1);
      this.hook.position.set(this.pos.x, ropeTop - len, this.pos.z);
    } else this.rope.visible = this.hook.visible = false;
  }

  collect(t) {
    const g = this.game;
    t.alive = false;
    t.attached = false;
    g.scene.remove(t.obj);
    if (t.kind === 'pickup') {
      const type = t.type;
      if (type === 'fuel') {
        this.fuel = Math.min(100, this.fuel + 55);
        g.hud.toast('+ Топливо', 'good', 1100);
      } else if (type === 'armor') {
        this.armor = Math.min(this.maxArmor, this.armor + this.maxArmor * 0.45);
        g.hud.toast('+ Броня', 'good', 1100);
      } else {
        this.ammo.gun = Math.min(this.maxAmmo.gun, this.ammo.gun + 400);
        this.ammo.hydra = Math.min(this.maxAmmo.hydra, this.ammo.hydra + 14);
        this.ammo.hellfire = Math.min(this.maxAmmo.hellfire, this.ammo.hellfire + 3);
        g.hud.toast('+ Боезапас', 'good', 1100);
      }
      g.audio.play('pickup');
      g.addScore(100, t.pos);
    } else {
      this.passengers.push(t);
      g.audio.play('rescue');
      g.hud.toast(`На борту: ${this.passengers.length}/${this.capacity}. Доставь на базу!`, 'good', 1600);
    }
    g.vibrate(20);
  }

  updateBase(dt) {
    const g = this.game;
    const b = g.world.base;
    const d = dist2D(b.x, b.z, this.pos.x, this.pos.z);
    const speed = Math.hypot(this.vel.x, this.vel.z);
    this.atBase = d < 11 && speed < 9;
    if (!this.atBase) return;
    this.fuel = Math.min(100, this.fuel + dt * 6);
    this.ammo.gun = Math.min(this.maxAmmo.gun, this.ammo.gun + dt * 60);
    if (this.passengers.length) {
      this.unloadT -= dt;
      if (this.unloadT <= 0) {
        this.unloadT = 0.55;
        const p = this.passengers.shift();
        g.onRescued(p);
      }
    }
  }

  damage(dmg) {
    if (!this.alive || this.state !== 'fly' || this.invuln > 0) return;
    const g = this.game;
    this.armor -= dmg;
    g.hud.flashDamage(dmg);
    g.vibrate(dmg > 8 ? 60 : 25);
    g.shake(Math.min(1, dmg / 12));
    g.audio.play('hitMetal');
    g.stats.damage += dmg;
    if (Math.random() < 0.5) g.fx.spark(this.pos.x, this.pos.y, this.pos.z, 4);
    if (this.armor <= 0) {
      this.armor = 0;
      this.die();
    } else if (this.armor < this.maxArmor * 0.25 && !this.lowArmorWarned) {
      this.lowArmorWarned = true;
      g.hud.toast('Броня критическая! Ищи ремкомплект', 'bad');
      g.audio.play('warn');
    }
    if (this.armor > this.maxArmor * 0.3) this.lowArmorWarned = false;
  }

  die() {
    if (this.state === 'dying' || this.state === 'dead') return;
    this.state = 'dying';
    this.dyingT = 0;
    this.winch = null;
    this.rope.visible = this.hook.visible = false;
    this.targetRing.visible = false;
    this.game.onPlayerDying();
  }

  updateDying(dt) {
    const g = this.game;
    this.dyingT += dt;
    this.yaw += dt * (6 + this.dyingT * 4);
    this.vel.multiplyScalar(Math.exp(-0.8 * dt));
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    this.pos.y -= dt * (4 + this.dyingT * 8);
    if (Math.random() < 0.8) g.fx.puff(this.pos.x, this.pos.y + 1, this.pos.z, 2.4);
    if (Math.random() < 0.3) g.fx.spark(this.pos.x, this.pos.y, this.pos.z, 3);
    this.obj.position.copy(this.pos);
    this.obj.rotation.set(0.4, this.yaw, 0.3, 'YXZ');
    if (this.pos.y <= 0.8) {
      this.pos.y = 0.8;
      this.state = 'dead';
      this.alive = false;
      g.fx.explosion(this.pos.x, 1.5, this.pos.z, 2.4, 0x5c8f3c);
      g.fx.addFire(this.pos.x, 1, this.pos.z, 8, 1.3);
      g.audio.play('boomBig');
      g.shake(1.5);
      g.vibrate([80, 40, 120]);
      g.world.blast(this.pos.x, this.pos.z, 6);
      this.obj.visible = false;
      g.onPlayerDead();
    }
  }

  dispose() {
    const s = this.game.scene;
    s.remove(this.obj, this.rope, this.hook, this.targetRing);
    if (this.spot) s.remove(this.spot, this.spot.target);
  }
}

const _flarePos = new THREE.Vector3();

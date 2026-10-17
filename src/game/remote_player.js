import * as THREE from 'three';
import { createViper } from './viper.js';
import { toon, glow, G } from './materials.js';
import { damp } from '../core/utils.js';

// Удалённый вертолёт напарника (Player 2 / Wingman).
export class RemotePlayer {
  constructor(game, role = 'client', skin = 'jungle', modules = {}) {
    this.game = game;
    this.role = role; // роль напарника: 'host' (ведущий) или 'client' (ведомый)
    this.label = role === 'host' ? 'ВЕДУЩИЙ (P1)' : 'ВЕДОМЫЙ (P2)';
    this.model = createViper(skin, modules);
    this.obj = this.model.group;
    game.scene.add(this.obj);

    this.pos = new THREE.Vector3();
    this.targetPos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.targetYaw = 0;
    this.tilt = { x: 0, z: 0 };
    this.targetTilt = { x: 0, z: 0 };

    this.armor = 100;
    this.maxArmor = 100;
    this.fuel = 100;
    this.alive = true;
    this.state = 'fly';

    // Трос и крюк лебёдки
    this.rope = new THREE.Mesh(G.cyl(0.07, 0.07, 1, 5).clone().translate(0, -0.5, 0), toon(0x222222));
    this.hook = new THREE.Mesh(G.box(0.5, 0.5, 0.5), glow(0x40c4ff));
    this.rope.visible = this.hook.visible = false;
    game.scene.add(this.rope, this.hook);

    // Маркер напарника (шеврон над вертолётом)
    this.hudSprite = this.createBadge(this.label);
    this.hudSprite.position.set(0, 4.5, 0);
    this.obj.add(this.hudSprite);

    // Сигнальный маячок на хвосте (синий у напарника, чтобы легко отличать от игрока)
    const beaconGeo = G.sphere(0.25, 6, 4);
    const beaconMat = glow(0x00e5ff);
    this.beacon = new THREE.Mesh(beaconGeo, beaconMat);
    this.beacon.position.set(0, 1.8, -4.8);
    this.obj.add(this.beacon);
    this.beaconT = 0;

    this.winch = null;
    this.lastReceived = performance.now();
  }

  createBadge(text) {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 64;
    const g = c.getContext('2d');
    g.fillStyle = 'rgba(0, 20, 40, 0.75)';
    g.roundRect(4, 4, 248, 56, 12);
    g.fill();
    g.lineWidth = 3;
    g.strokeStyle = '#00e5ff';
    g.stroke();
    g.fillStyle = '#ffffff';
    g.font = 'bold 24px monospace';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, 128, 32);

    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
    const sp = new THREE.Sprite(mat);
    sp.scale.set(6, 1.5, 1);
    return sp;
  }

  setSkin(skin, modules = {}) {
    if (this.obj) this.game.scene.remove(this.obj);
    this.model = createViper(skin, modules);
    this.obj = this.model.group;
    this.game.scene.add(this.obj);
    this.obj.add(this.hudSprite);
    this.obj.add(this.beacon);
  }

  // Приём данных от сети
  applyState(msg) {
    if (!msg || !msg.pos) return;
    this.targetPos.set(msg.pos[0], msg.pos[1], msg.pos[2]);
    if (msg.vel) this.vel.set(msg.vel[0], msg.vel[1], msg.vel[2]);
    this.targetYaw = msg.yaw ?? this.yaw;
    if (msg.tilt) {
      this.targetTilt.x = msg.tilt[0];
      this.targetTilt.z = msg.tilt[1];
    }
    if (msg.armor !== undefined) this.armor = msg.armor;
    if (msg.maxArmor !== undefined) this.maxArmor = msg.maxArmor;
    if (msg.fuel !== undefined) this.fuel = msg.fuel;
    if (msg.alive !== undefined) this.alive = msg.alive;

    this.winch = msg.winch || null;
    this.lastReceived = performance.now();
  }

  update(dt) {
    if (!this.alive) {
      this.obj.visible = false;
      this.rope.visible = this.hook.visible = false;
      return;
    }
    this.obj.visible = true;

    // Плавная интерполяция к целевой позиции и углам
    this.pos.lerp(this.targetPos, Math.min(dt * 18, 1));
    this.yaw = damp(this.yaw, this.targetYaw, 14, dt);
    this.tilt.x = damp(this.tilt.x, this.targetTilt.x, 10, dt);
    this.tilt.z = damp(this.tilt.z, this.targetTilt.z, 10, dt);

    this.obj.position.copy(this.pos);
    this.obj.rotation.set(this.tilt.x, this.yaw, this.tilt.z, 'YXZ');

    // Вращение несущего и хвостового винтов
    const sp = Math.hypot(this.vel.x, this.vel.z);
    this.model.rotor.rotation.y += dt * (32 + sp * 0.4);
    this.model.tailRotor.rotation.x += dt * (45 + sp * 0.6);

    // Мигание сигнального маячка напарника
    this.beaconT += dt;
    this.beacon.visible = Math.sin(this.beaconT * 8) > 0;

    // Отрисовка лебёдки напарника
    const ropeTop = this.pos.y - 1.4;
    if (this.winch && this.winch.len > 0) {
      const len = Math.max(this.winch.len, 0.01);
      this.rope.visible = this.hook.visible = true;
      this.rope.position.set(this.pos.x, ropeTop, this.pos.z);
      this.rope.scale.set(1, len, 1);
      this.hook.position.set(this.pos.x, ropeTop - len, this.pos.z);
    } else {
      this.rope.visible = this.hook.visible = false;
    }
  }

  aimPoint() {
    return this.pos;
  }

  damage(dmg, srcPos) {
    this.armor -= dmg;
    this.game.fx.spark(this.pos.x, this.pos.y, this.pos.z, 4);
    if (this.armor <= 0 && this.alive) {
      this.die();
    }
  }

  die() {
    this.alive = false;
    this.state = 'dying';
    const g = this.game;
    g.fx.explosion(this.pos.x, this.pos.y, this.pos.z, 2.0);
    g.audio.play('boomBig', this.pos.x, this.pos.z);
    g.shakeAt(this.pos.x, this.pos.z, 1.2);
    this.obj.visible = false;
  }

  respawn(base) {
    const g = this.game;
    this.alive = true;
    this.state = 'fly';
    this.armor = this.maxArmor;
    this.fuel = 100;
    const b = base || g.world.base;
    this.pos.set(b.x + 10, g.world.heightAt(b.x + 10, b.z) + 15, b.z);
    this.targetPos.copy(this.pos);
    this.obj.visible = true;
  }

  destroy() {
    if (this.obj) this.game.scene.remove(this.obj);
    if (this.rope) this.game.scene.remove(this.rope);
    if (this.hook) this.game.scene.remove(this.hook);
  }
}

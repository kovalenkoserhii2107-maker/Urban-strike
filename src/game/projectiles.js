import * as THREE from 'three';
import { toon, glow, G } from './materials.js';
import { segmentPointDist, clamp } from '../core/utils.js';

export const KINDS = {
  gun: { speed: 150, dmg: 5, splash: 0, life: 0.7, tracer: 'player' },
  hydra: { speed: 75, dmg: 46, splash: 5.5, life: 2.2, rocket: true, size: 1 },
  hellfire: { speed: 50, accel: 60, maxSpeed: 95, dmg: 150, splash: 7, life: 3.5, rocket: true, size: 1.3, turn: 5 },
  ebullet: { speed: 58, dmg: 2.2, splash: 0, life: 2, tracer: 'enemy' },
  shell: { speed: 48, dmg: 11, splash: 3, life: 2.6, tracer: 'shell' },
  rpg: { speed: 32, dmg: 13, splash: 3, life: 3, rocket: true, size: 0.8 },
  flak: { speed: 62, dmg: 6, splash: 6, life: 2.5, tracer: 'shell', flak: true },
  sam: { speed: 22, accel: 18, maxSpeed: 40, dmg: 26, splash: 4, life: 7, rocket: true, size: 1.4, turn: 1.75, sam: true },
  ehrocket: { speed: 52, dmg: 12, splash: 3, life: 2.4, rocket: true, size: 0.9 },
};

const _v = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _z = new THREE.Vector3(0, 0, 1);
const _c = new THREE.Color();
const TRACER_COLORS = { player: new THREE.Color(4, 3.4, 1.2), enemy: new THREE.Color(4, 0.9, 0.5), shell: new THREE.Color(3, 1.6, 0.6) };

export class Projectiles {
  constructor(game) {
    this.game = game;
    this.list = [];
    this.tracers = new THREE.InstancedMesh(G.box(0.22, 0.22, 2.6), glow(0xffffff), 500);
    this.tracers.frustumCulled = false;
    this.tracers.count = 0;
    for (let i = 0; i < 500; i++) this.tracers.setColorAt(i, _c.setRGB(1, 1, 1));
    game.scene.add(this.tracers);
    this.rocketPool = [];
  }

  makeRocket(def, team) {
    let m = this.rocketPool.pop();
    if (!m) {
      m = new THREE.Group();
      const body = new THREE.Mesh(G.cyl(0.18, 0.18, 1.6, 6), toon(0xf2f2f2));
      body.rotation.x = Math.PI / 2;
      const tip = new THREE.Mesh(G.cone(0.18, 0.5, 6), toon(0xd8463c));
      tip.rotation.x = Math.PI / 2;
      tip.position.z = 1.05;
      const flame = new THREE.Mesh(G.sphere(0.32, 6, 4), glow(0xffb347));
      flame.position.z = -0.9;
      m.add(body, tip, flame);
      m.userData.tip = tip;
    }
    m.userData.tip.material = team === 'player' ? toon(0xf2c94c) : toon(0xd8463c);
    m.scale.setScalar(def.size || 1);
    this.game.scene.add(m);
    return m;
  }

  spawn(kind, team, pos, dir, opts = {}) {
    const def = KINDS[kind];
    const speed = opts.speed ?? def.speed;
    const p = {
      kind, def, team,
      pos: pos.clone(), prev: pos.clone(),
      vel: dir.clone().normalize().multiplyScalar(speed),
      speed,
      life: opts.life ?? def.life,
      dmg: (opts.dmg ?? def.dmg) * (opts.mult ?? 1),
      splash: def.splash,
      target: opts.target || null,
      trailAcc: 0,
      alive: true,
    };
    if (def.rocket) p.mesh = this.makeRocket(def, team);
    this.list.push(p);
    return p;
  }

  explode(p, x, y, z) {
    const g = this.game;
    p.alive = false;
    const d = p.def;
    if (d.flak) {
      g.fx.explosion(x, y, z, 0.55);
      g.audio.play('flak', x, z);
    } else if (d.splash > 0) {
      const size = clamp(d.splash / 5, 0.5, 1.5);
      g.fx.explosion(x, y, z, size);
      g.audio.play(size > 1 ? 'boomBig' : 'boom', x, z);
      g.shakeAt(x, z, size * 0.5);
    } else if (y < g.fx.ground(x, z) + 0.6) {
      if (g.world.isWater(x, z)) g.fx.puff(x, g.world.waterLevel, z, 0.8, true, 5);
      else g.fx.dust(x, z, 1);
    } else {
      g.fx.spark(x, y, z, 2);
    }
    if (d.splash > 0) g.applySplash(x, y, z, d.splash, p.dmg, p.team);
  }

  update(dt) {
    const g = this.game;
    const player = g.player;
    let n = 0;
    for (const p of this.list) {
      if (!p.alive) continue;
      p.life -= dt;
      p.prev.copy(p.pos);
      const d = p.def;
      if (d.accel) p.speed = Math.min(d.maxSpeed, p.speed + d.accel * dt);
      if (p.target && d.turn) {
        const tp = p.target.alive === false ? null : p.target.aimPoint ? p.target.aimPoint() : p.target.pos;
        if (tp) {
          _v.copy(tp).sub(p.pos).normalize();
          const cur = p.vel.clone().normalize();
          const ang = Math.acos(clamp(cur.dot(_v), -1, 1));
          const t = ang > 1e-4 ? Math.min(1, (d.turn * dt) / ang) : 1;
          cur.lerp(_v, t).normalize();
          p.vel.copy(cur);
        } else p.target = null;
      }
      if (d.turn || d.accel) p.vel.setLength(p.speed);
      p.pos.addScaledVector(p.vel, dt);

      if (p.mesh) {
        p.mesh.position.copy(p.pos);
        _v.copy(p.vel).normalize();
        p.mesh.quaternion.setFromUnitVectors(_z, _v);
        p.trailAcc += dt;
        const rate = d.sam ? 0.025 : 0.035;
        while (p.trailAcc > rate) {
          p.trailAcc -= rate;
          g.fx.trail(p.pos.x - _v.x, p.pos.y - _v.y, p.pos.z - _v.z, d.sam ? 1.4 : 0.9);
        }
      }

      // столкновения
      let hit = false;
      if (p.team === 'player') {
        for (const e of g.enemies) {
          if (!e.alive || !e.targetable) continue;
          const c = e.aimPoint();
          if (Math.abs(c.x - p.pos.x) > 14 || Math.abs(c.z - p.pos.z) > 14) continue;
          if (segmentPointDist(p.prev.x, p.prev.y, p.prev.z, p.pos.x, p.pos.y, p.pos.z, c.x, c.y, c.z) < e.radius + 0.4) {
            if (d.splash === 0) {
              e.hit(p.dmg, 'gun');
              g.fx.spark(p.pos.x, p.pos.y, p.pos.z, 3);
              g.stats.hits++;
            }
            this.explode(p, p.pos.x, p.pos.y, p.pos.z);
            hit = true;
            break;
          }
        }
      } else if (!hit) {
        const targets = [];
        if (player.alive) targets.push(player);
        if (g.remotePlayer && g.remotePlayer.alive) targets.push(g.remotePlayer);
        for (const target of targets) {
          const c = target.pos;
          const dist = segmentPointDist(p.prev.x, p.prev.y, p.prev.z, p.pos.x, p.pos.y, p.pos.z, c.x, c.y, c.z);
          if (d.flak && dist < 4.5) {
            this.explode(p, p.pos.x, p.pos.y, p.pos.z);
            hit = true;
            break;
          } else if (dist < (d.rocket ? 2.8 : 2.4)) {
            target.damage(p.dmg, p.pos);
            if (d.splash > 0) {
              g.fx.explosion(p.pos.x, p.pos.y, p.pos.z, 0.6);
              g.audio.play('boom', p.pos.x, p.pos.z);
            } else g.fx.spark(p.pos.x, p.pos.y, p.pos.z, 4);
            p.alive = false;
            hit = true;
            break;
          }
        }
      }
      if (!hit && p.target && p.target.isFlare && p.pos.distanceTo(p.target.pos) < 3) {
        this.explode(p, p.pos.x, p.pos.y, p.pos.z);
        hit = true;
      }
      if (!hit) {
        const b = g.world.buildingAt(p.pos.x, p.pos.y, p.pos.z);
        if (b) {
          // ракеты бьют здания через splash, пули — напрямую
          if (d.splash === 0 && p.team === 'player') g.damageBuilding(b, p.dmg * 0.3);
          this.explode(p, p.pos.x, p.pos.y, p.pos.z);
          hit = true;
        } else if (p.pos.y <= (p.groundY = g.fx.ground(p.pos.x, p.pos.z)) + 0.15) {
          this.explode(p, p.pos.x, Math.max(p.pos.y, p.groundY), p.pos.z);
          hit = true;
        } else if (p.life <= 0) {
          if (d.flak || d.rocket) this.explode(p, p.pos.x, p.pos.y, p.pos.z);
          p.alive = false;
        }
      }
      if (p.alive) this.list[n++] = p;
      else if (p.mesh) {
        g.scene.remove(p.mesh);
        this.rocketPool.push(p.mesh);
        p.mesh = null;
      }
    }
    this.list.length = n;

    let t = 0;
    for (const p of this.list) {
      if (!p.def.tracer || t >= 500) continue;
      _v.copy(p.vel).normalize();
      _q.setFromUnitVectors(_z, _v);
      const len = p.def.tracer === 'player' ? 1.4 : 0.9;
      const w = p.def.tracer === 'shell' ? 2.2 : 1;
      _m.compose(p.pos, _q, _s.set(w, w, len));
      this.tracers.setMatrixAt(t, _m);
      this.tracers.setColorAt(t, TRACER_COLORS[p.def.tracer]);
      t++;
    }
    this.tracers.count = t;
    this.tracers.instanceMatrix.needsUpdate = true;
    if (this.tracers.instanceColor) this.tracers.instanceColor.needsUpdate = true;
  }

  // Ракеты ЗРК, которые сейчас ведут игрока (для предупреждения на HUD).
  incomingMissiles() {
    let n = 0;
    for (const p of this.list) if (p.def.sam && (p.target === this.game.player || p.target === this.game.remotePlayer)) n++;
    return n;
  }

  clear() {
    for (const p of this.list) if (p.mesh) this.game.scene.remove(p.mesh);
    this.list.length = 0;
  }
}

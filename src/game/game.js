import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { World } from './world.js';
import { FX } from './fx.js';
import { Projectiles } from './projectiles.js';
import { Player, CAM_YAW } from './player.js';
import { Pickup } from './pickups.js';
import { Rescuee } from './enemies.js';
import { MissionRunner, MISSIONS } from './missions.js';
import { Input } from './input.js';
import { Audio } from './audio.js';
import { HUD } from '../ui/hud.js';
import { createPerson } from './models.js';
import { clamp, damp } from '../core/utils.js';
import { persist } from '../core/save.js';

export const QUALITY = {
  low: { dpr: 1, shadow: 1024, bloom: false, density: 0.55, fx: 0.6 },
  medium: { dpr: 1.5, shadow: 2048, bloom: false, density: 0.85, fx: 0.85 },
  high: { dpr: 2, shadow: 2048, bloom: true, density: 1, fx: 1 },
};
const ORDER = ['low', 'medium', 'high'];
const CAM_ZOOM = { near: 0.82, normal: 1, far: 1.25 };
const _look = new THREE.Vector3();

const isCoarse = () => matchMedia('(pointer: coarse)').matches;

export class Game {
  constructor(canvas, hooks, save) {
    this.hooks = hooks;
    this.save = save;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', stencil: false });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.camera = new THREE.PerspectiveCamera(38, 1, 1, 900);
    this.audio = new Audio();
    this.input = new Input(document.querySelector('#controls'));
    this.hud = new HUD();
    this.mode = 'idle';
    this.timeScale = 1;
    this.time = 0;
    this.shakeAmt = 0;
    this.camLook = new THREE.Vector3();
    this.fpsAcc = { t: 0, n: 0 };
    this.setQuality(save.settings.quality);
    window.addEventListener('resize', () => this.resize());
    this.resize();
    this.last = performance.now();
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
  }

  // ---------- качество графики ----------
  setQuality(setting) {
    this.qualitySetting = setting;
    this.qualityLevel = setting === 'auto' ? (isCoarse() ? 'medium' : 'high') : setting;
    this.applyQuality();
  }
  applyQuality() {
    const q = QUALITY[this.qualityLevel];
    this.q = q;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.dpr));
    if (this.world) this.world.setShadowQuality(q.shadow);
    this.buildComposer();
    this.resize();
  }
  buildComposer() {
    if (this.composer) {
      this.composer.dispose();
      this.composer = null;
    }
    if (!this.q.bloom || !this.scene) return;
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(this.renderer, rt);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.55, 0.45, 0.92);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
  }
  autoQuality(rawDt) {
    if (this.qualitySetting !== 'auto' || this.mode !== 'play') return;
    const f = this.fpsAcc;
    f.t += rawDt;
    f.n++;
    if (f.t < 4) return;
    const fps = f.n / f.t;
    f.t = 0;
    f.n = 0;
    const i = ORDER.indexOf(this.qualityLevel);
    if (fps < 40 && i > 0) {
      this.qualityLevel = ORDER[i - 1];
      this.applyQuality();
    }
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (this.composer) {
      this.composer.setPixelRatio(this.renderer.getPixelRatio());
      this.composer.setSize(w, h);
    }
  }

  // ---------- загрузка миссии / фона меню ----------
  unload() {
    if (!this.scene) return;
    this.projectiles?.clear();
    this.world?.dispose();
    this.audio.stopRotor();
    this.scene = null;
    this.world = null;
    this.mission = null;
    this.boss = null;
  }

  build(def, withMission) {
    this.unload();
    this.scene = new THREE.Scene();
    this.enemies = [];
    this.winchables = [];
    this.timers = [];
    this.walkers = [];
    this.time = 0;
    this.timeScale = 1;
    this.world = new World(this.scene, { seed: def.seed, lighting: def.lighting, sites: def.sites, density: this.q.density });
    this.world.setShadowQuality(this.q.shadow);
    this.world.onPropDestroyed = (it) => this.onPropDestroyed(it);
    this.fx = new FX(this.scene, this.q.fx);
    this.projectiles = new Projectiles(this);
    this.player = new Player(this, this.save.upgrades);
    this.score = 0;
    this.combo = 1;
    this.lastKill = -10;
    this.lives = 3;
    this.stats = { kills: 0, shots: 0, hits: 0, damage: 0, civilians: 0, rescued: 0, buildings: 0 };
    this.hud.reset();
    if (withMission) this.mission = new MissionRunner(this, def);
    this.buildComposer();
    this.resize();
    // прогрев шейдеров, чтобы не было рывка в первом кадре
    this.updateCamera(0, true);
    this.renderer.compile(this.scene, this.camera);
  }

  startAttract() {
    this.build({ seed: 77, lighting: 'sunset', sites: 2 }, false);
    this.mode = 'attract';
    this.player.state = 'fly';
    this.player.pos.y = 18;
    this.player.invuln = 0;
    this.attractT = 0;
  }

  startMission(index) {
    const def = MISSIONS[index];
    this.missionIndex = index;
    this.missionDef = def;
    this.build(def, true);
    this.mode = 'play';
    this.cineT = 0;
    this.input.reset();
    this.input.enabled = false;
    this.audio.unlock();
    this.audio.startRotor();
    if (this.save.settings.music) this.audio.startMusic('action');
    if (index === 0 && !this.save.tutorialDone) this.tutorial();
  }

  // Короткое обучение в первой миссии: подсказки по очереди, один раз.
  tutorial() {
    const touch = isCoarse();
    const steps = [
      [4, touch ? 'Веди пальцем по левой половине экрана — вертолёт полетит туда' : 'WASD или стрелки — полёт'],
      [10, 'Держи «Пулемёт» или «Ракеты» — прицел сам наводится на ближайшую цель'],
      [17, 'Жёлтая стрелка и мигающая точка на радаре ведут к цели задания'],
      [24, 'Зависни над ящиком или человеком — лебёдка поднимет его на борт'],
      [31, 'На базе (площадка «H») вертолёт дозаправляется и высаживает спасённых'],
    ];
    for (const [t, text] of steps) this.after(t, () => this.mode === 'play' && this.hud.toast(text, 'info', 5000));
    this.after(33, () => {
      this.save.tutorialDone = true;
      persist();
    });
  }

  pause(on) {
    if (on && this.mode === 'play') {
      this.mode = 'paused';
      this.audio.setRotor(0, 0);
    } else if (!on && this.mode === 'paused') {
      this.mode = 'play';
      this.last = performance.now();
      this.input.reset();
    }
  }

  // ---------- игровые события ----------
  addEnemy(e) {
    this.enemies.push(e);
    return e;
  }
  addPickup(type, x, z) {
    const p = new Pickup(this, type, x, z);
    this.winchables.push(p);
    return p;
  }
  addRescuee(x, z, kind = 'hostage') {
    const r = new Rescuee(this, x, z, kind);
    this.winchables.push(r);
    return r;
  }
  after(delay, fn) {
    this.timers.push({ t: this.time + delay, fn });
  }
  vibrate(pattern) {
    if (this.save.settings.vibration && navigator.vibrate) {
      try {
        navigator.vibrate(pattern);
      } catch {
        /* не поддерживается */
      }
    }
  }
  shake(a) {
    this.shakeAmt = Math.min(2, this.shakeAmt + a);
  }
  shakeAt(x, z, a) {
    if (!this.player) return;
    const d = Math.hypot(x - this.player.pos.x, z - this.player.pos.z);
    if (d < 70) this.shake(a * (1 - d / 70));
  }
  addScore(v, pos, cls = '') {
    this.score += v;
    if (pos) this.hud.floater('+' + v, pos, cls);
  }

  applySplash(x, y, z, r, dmg, team) {
    if (team === 'player') {
      for (const e of this.enemies) {
        if (!e.alive) continue;
        const c = e.aimPoint();
        const d = Math.hypot(c.x - x, c.z - z);
        if (d < r + e.radius && Math.abs(c.y - y) < r + e.radius + 2) e.hit(dmg * (1 - 0.5 * clamp(d / (r + e.radius), 0, 1)));
      }
      for (const b of this.world.buildingsNear(x, z, r)) {
        const dx = Math.max(Math.abs(x - b.x) - b.w / 2, 0), dz = Math.max(Math.abs(z - b.z) - b.d / 2, 0);
        if (Math.hypot(dx, dz) < r && y < b.top + 2) this.damageBuilding(b, dmg * 0.55);
      }
    } else if (this.player.alive) {
      const p = this.player.pos;
      const d = Math.hypot(p.x - x, p.y - y, p.z - z);
      if (d < r) this.player.damage(dmg * (1 - 0.5 * (d / r)));
    }
    if (y < 7) this.world.blast(x, z, r * 0.7);
  }

  damageBuilding(b, dmg) {
    if (!this.world.damageBuilding(b, dmg)) return;
    this.stats.buildings++;
    this.audio.play('boomBig', b.x, b.z);
    this.shakeAt(b.x, b.z, 0.9);
    const dust = new THREE.Color(b.wallColor).lerp(new THREE.Color(0xcfc6b5), 0.5);
    for (let i = 0; i < 14 * this.q.fx; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.max(b.w, b.d) * 0.6;
      this.fx.smoke.spawn({
        x: b.x + Math.cos(a) * r, y: Math.random() * b.h * 0.6, z: b.z + Math.sin(a) * r,
        vx: Math.cos(a) * 4, vy: 2 + Math.random() * 3, vz: Math.sin(a) * 4, drag: 1,
        life: 2 + Math.random() * 1.5, s0: 2, s1: 4.5 + Math.random() * 2, c0: dust, c1: dust, fadeFrom: 0.6, growRate: 1.5,
      });
    }
    this.fx.debrisBurst(b.x, b.h * 0.6, b.z, Math.round(16 * this.q.fx), b.wallColor, 2);
    this.world.blast(b.x, b.z, Math.max(b.w, b.d) * 0.6);
    this.addScore(60, new THREE.Vector3(b.x, b.h, b.z));
    if (b.crate) {
      const type = b.crate;
      this.after(1.7, () => {
        this.addPickup(type, b.x, b.z);
        this.hud.toast('Под обломками нашёлся ящик!', 'good', 1400);
      });
    }
  }

  onPropDestroyed(it) {
    const kind = it.set.opts.kind;
    const y = it.y || 0;
    if (kind === 'car') {
      this.after(0.08 + Math.random() * 0.2, () => {
        this.fx.explosion(it.x, 1, it.z, 0.9, 0x666666);
        this.fx.addFire(it.x, 1, it.z, 5, 0.7);
        this.audio.play('boom', it.x, it.z);
      });
      if (it.civilian) {
        this.stats.civilians++;
        this.score = Math.max(0, this.score - 50);
        this.hud.floater('−50', new THREE.Vector3(it.x, 3, it.z), 'bad');
      }
    } else if (kind === 'explosive') {
      this.after(0.15, () => {
        this.fx.explosion(it.x, 2, it.z, 2.2, 0xd8463c);
        this.fx.addFire(it.x, 1, it.z, 12, 1.6);
        this.audio.play('boomBig', it.x, it.z);
        this.shakeAt(it.x, it.z, 1.2);
        this.applySplash(it.x, 2, it.z, 10, 90, 'player');
      });
    } else if (kind === 'tree' || kind === 'bush') {
      this.fx.debrisBurst(it.x, y + 3, it.z, 5, it.color ?? it.set.opts.debris, 0.8);
      this.fx.puff(it.x, y + 3, it.z, 1.5);
    } else if (kind === 'lamp') {
      this.fx.spark(it.x, 5, it.z, 6);
    } else {
      this.fx.debrisBurst(it.x, y + 1, it.z, 6, it.color ?? it.set.opts.debris, 1);
    }
  }

  onEnemyKilled(e) {
    this.stats.kills++;
    if (this.time - this.lastKill < 3.2) this.combo = Math.min(this.combo + 1, 9);
    else this.combo = 1;
    this.lastKill = this.time;
    const v = e.score * this.combo;
    this.addScore(v, e.aimPoint().clone(), e.tag ? 'big' : '');
    if (!e.tag && e.radius > 2.5 && Math.random() < 0.18) {
      const type = ['fuel', 'ammo', 'armor'][Math.floor(Math.random() * 3)];
      this.after(0.6, () => this.addPickup(type, e.pos.x + 3, e.pos.z));
    }
    if (e.tag && e.tag.targets && e.tag.targets.length > 1) {
      const left = e.tag.targets.filter((t) => t.alive).length;
      if (left > 0) this.hud.toast(`${e.label || 'Цель'} уничтожен(а) — осталось ${left}`, 'good', 1600);
    }
  }

  bigDeath(e, size, n) {
    const c = e.aimPoint().clone();
    for (let i = 0; i < n; i++) {
      this.after(i * 0.28, () => {
        const x = c.x + (Math.random() - 0.5) * e.radius * 1.6, z = c.z + (Math.random() - 0.5) * e.radius * 1.6;
        this.fx.explosion(x, c.y * Math.random(), z, size * 0.6);
        this.audio.play('boom', x, z);
        this.shake(0.4);
      });
    }
    this.after(n * 0.28 + 0.2, () => {
      this.fx.explosion(c.x, c.y, c.z, size * 1.4);
      this.fx.addFire(c.x, 1, c.z, 20, size * 0.8);
      this.audio.play('boomBig', c.x, c.z);
      this.shake(1.6);
      this.vibrate([60, 30, 100]);
      this.world.blast(c.x, c.z, e.radius * 1.4);
    });
  }

  onRescued(p) {
    this.stats.rescued++;
    if (p.objective) p.objective.delivered++;
    this.addScore(500, this.player.pos.clone(), 'big');
    this.audio.play('rescue');
    this.hud.toast(p.kind === 'pilot' ? 'Пилот спасён!' : 'Заложник спасён!', 'good', 1300);
    const m = createPerson(p.kind);
    const b = this.world.base;
    m.group.position.set(b.x + (Math.random() - 0.5) * 4, 0, b.z + (Math.random() - 0.5) * 4);
    this.scene.add(m.group);
    this.walkers.push({ m, t: 0, tx: b.x - 15, tz: b.z - 8 });
  }

  onObjectiveComplete(o, next) {
    this.audio.play('objective');
    this.vibrate([30, 40, 30]);
    this.hooks.banner('ЗАДАЧА ВЫПОЛНЕНА', next ? 'Далее: ' + next.text : '');
    this.addScore(1000, this.player.pos.clone(), 'big');
  }

  onMissionComplete() {
    this.mode = 'outro';
    this.outroT = 0;
    this.input.enabled = false;
    this.timeScale = 0.4;
    this.hooks.banner('МИССИЯ ВЫПОЛНЕНА', this.missionDef.name);
    this.after(1.6, () => {
      this.timeScale = 1;
    });
    this.after(3.4, () => {
      const t = this.time;
      const lost = 3 - this.lives;
      let stars = 1;
      if (lost <= 1) stars = 2;
      if (lost === 0 && t < this.missionDef.par && this.stats.civilians < 6) stars = 3;
      const accuracy = this.stats.shots ? Math.round((this.stats.hits / this.stats.shots) * 100) : 0;
      const bonus = this.lives * 1000;
      this.audio.stopRotor();
      this.hooks.onComplete({ index: this.missionIndex, time: t, score: this.score + bonus, bonus, stars, accuracy, ...this.stats });
      this.mode = 'idle';
    });
  }

  onPlayerDying() {
    this.timeScale = 0.55;
    this.input.enabled = false;
    this.hud.toast('Вертолёт подбит!', 'bad', 2000);
  }

  onPlayerDead() {
    this.timeScale = 1;
    this.lives--;
    for (const p of this.player.passengers) p.reset();
    this.player.passengers = [];
    this.after(2.6, () => {
      if (this.lives > 0) {
        this.hooks.transition(() => {
          this.player.respawn();
          this.projectiles.clear();
          this.cineT = 1.5;
          this.hud.toast(`Новый вертолёт. Осталось жизней: ${this.lives}`, 'info', 2200);
        });
      } else {
        this.mode = 'idle';
        this.audio.stopRotor();
        this.hooks.onGameOver({ score: this.score });
      }
    });
  }

  // ---------- камера ----------
  updateCamera(dt, snap = false) {
    const p = this.player;
    const cam = this.camera;
    const aspect = cam.aspect;
    const fit = clamp(1.05 / Math.min(aspect, 1.35) + (aspect < 1 ? 0.55 : 0), 1, 2.6);
    let yaw = CAM_YAW, dist = 1, height = 1;
    if (this.mode === 'attract') {
      yaw = CAM_YAW + this.attractT * 0.12;
      dist = 0.8;
      height = 0.71;
    } else if (this.cineT !== undefined && this.cineT < 3) {
      const k = clamp(this.cineT / 3, 0, 1);
      const e = 1 - Math.pow(1 - k, 3);
      yaw = CAM_YAW + (1 - e) * 1.4;
      dist = 0.45 + 0.55 * e;
      height = 0.39 + 0.61 * e;
    } else if (this.mode === 'outro') {
      yaw = CAM_YAW + this.outroT * 0.25;
      dist = 0.96;
      height = 0.9;
    }
    const lx = p.pos.x + p.vel.x * 0.5, lz = p.pos.z + p.vel.z * 0.5;
    const ly = this.mode === 'play' && this.cineT >= 3 ? p.pos.y * 0.45 : p.pos.y * 0.75;
    if (snap) this.camLook.set(lx, ly, lz);
    else {
      this.camLook.x = damp(this.camLook.x, lx, 4, dt);
      this.camLook.y = damp(this.camLook.y, ly, 4, dt);
      this.camLook.z = damp(this.camLook.z, lz, 4, dt);
    }
    const zoom = this.mode === 'attract' ? 1 : CAM_ZOOM[this.save.settings.camera] ?? 1;
    const B = 36 * fit * dist * zoom, H = 48 * fit * height * zoom;
    cam.position.set(this.camLook.x + Math.sin(yaw) * B, this.camLook.y + H, this.camLook.z + Math.cos(yaw) * B);
    if (this.shakeAmt > 0.01) {
      const s = this.shakeAmt * 0.9;
      cam.position.x += (Math.random() - 0.5) * s;
      cam.position.y += (Math.random() - 0.5) * s;
      cam.position.z += (Math.random() - 0.5) * s;
      this.shakeAmt *= Math.exp(-6 * dt);
    }
    if (this.mode === 'attract' && aspect > 1) {
      // в меню вертолёт смещён вправо, слева — кнопки
      const off = 14 * fit;
      cam.position.x -= Math.cos(yaw) * off;
      cam.position.z += Math.sin(yaw) * off;
      _look.copy(this.camLook);
      _look.x -= Math.cos(yaw) * off;
      _look.z += Math.sin(yaw) * off;
      cam.lookAt(_look);
      return;
    }
    cam.lookAt(this.camLook);
  }

  // ---------- главный цикл ----------
  loop(now) {
    requestAnimationFrame(this.loop);
    const rawDt = Math.min((now - this.last) / 1000, 0.05);
    this.last = now;
    if (!this.scene || this.mode === 'paused' || this.mode === 'idle') return;
    this.autoQuality(rawDt);
    const dt = rawDt * this.timeScale;
    const input = this.input.poll();
    if (input.pausePressed && this.mode === 'play') this.hooks.onPause();
    this.time += dt;

    if (this.mode === 'attract') {
      this.attractT += rawDt;
      const p = this.player;
      const a = this.attractT * 0.18;
      const tx = Math.cos(a) * 120, tz = Math.sin(a) * 120;
      p.vel.set((tx - p.pos.x) * 0.6, 0, (tz - p.pos.z) * 0.6);
      p.pos.x += p.vel.x * dt;
      p.pos.z += p.vel.z * dt;
      p.yaw = Math.atan2(p.vel.x, p.vel.z);
      p.applyTransform(dt, 18, 6);
      p.model.rotor.rotation.y += dt * 32;
      p.model.tailRotor.rotation.x += dt * 45;
    } else {
      if (this.mode === 'play' && this.cineT < 3) {
        this.cineT += rawDt;
        if (this.cineT >= 3 && this.player.state !== 'dying') this.input.enabled = true;
      }
      this.player.update(dt, input);
      for (const e of this.enemies) if (e.alive || e.dying) e.update(dt);
      for (const w of this.winchables) if (w.alive) w.update(dt);
      this.cleanT = (this.cleanT || 0) + dt;
      if (this.cleanT > 2) {
        this.cleanT = 0;
        this.enemies = this.enemies.filter((e) => e.alive || e.dying);
        this.winchables = this.winchables.filter((w) => w.alive);
      }
      this.projectiles.update(dt);
      if (this.combo > 1 && this.time - this.lastKill > 3.2) this.combo = 1;
      for (let i = this.walkers.length - 1; i >= 0; i--) {
        const w = this.walkers[i];
        w.t += dt;
        const o = w.m.group.position;
        const dx = w.tx - o.x, dz = w.tz - o.z;
        const d = Math.hypot(dx, dz);
        if (d < 1 || w.t > 6) {
          this.scene.remove(w.m.group);
          this.walkers.splice(i, 1);
          continue;
        }
        o.x += (dx / d) * 6 * dt;
        o.z += (dz / d) * 6 * dt;
        w.m.group.rotation.y = Math.atan2(dx, dz);
        w.m.inner.position.y = Math.abs(Math.sin(w.t * 12)) * 0.2;
        w.m.arms[0].rotation.x = Math.sin(w.t * 12) * 0.8;
        w.m.arms[1].rotation.x = -Math.sin(w.t * 12) * 0.8;
      }
      this.mission?.update();
      if (this.mode === 'outro') this.outroT += rawDt;
      this.hud.update(rawDt, this);
      const sp = Math.hypot(this.player.vel.x, this.player.vel.z);
      this.audio.setRotor(this.player.alive ? 1 : 0, sp);
    }
    for (let i = this.timers.length - 1; i >= 0; i--) {
      if (this.time >= this.timers[i].t) {
        const t = this.timers[i];
        this.timers.splice(i, 1);
        t.fn();
      }
    }
    this.fx.update(dt);
    this.world.update(dt, this.player.pos, this.camera.position);
    this.world.followSun(this.player.pos.x, this.player.pos.z);
    this.updateCamera(rawDt);
    this.audio.setListener(this.player.pos.x, this.player.pos.z);
    if (this.composer) this.composer.render(rawDt);
    else this.renderer.render(this.scene, this.camera);
  }
}

export { MISSIONS };

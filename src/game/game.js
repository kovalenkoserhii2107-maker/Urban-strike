import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { World, LAYOUT } from './world.js';
import { FX } from './fx.js';
import { Projectiles } from './projectiles.js';
import { Player, CAM_YAW } from './player.js';
import { Pickup } from './pickups.js';
import { Rescuee } from './enemies.js';
import { MissionRunner, STORY } from './missions.js';
import { OpenWorld } from './openworld.js';
import { Input } from './input.js';
import { Audio } from './audio.js';
import { HUD } from '../ui/hud.js';
import { createPerson } from './models.js';
import { clamp, damp } from '../core/utils.js';
import { persist } from '../core/save.js';

export const QUALITY = {
  low: { dpr: 1, shadow: 1024, post: false, ao: false, density: 0.5, fx: 0.6 },
  medium: { dpr: 1.5, shadow: 2048, post: false, ao: false, density: 0.75, fx: 0.85 },
  high: { dpr: 2, shadow: 2048, post: true, ao: true, density: 1, fx: 1 },
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
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.camera = new THREE.PerspectiveCamera(38, 1, 1, 1400);
    this.audio = new Audio();
    this.input = new Input(document.querySelector('#controls'));
    this.hud = new HUD();
    this.mode = 'idle';
    this.timeScale = 1;
    this.time = 0;
    this.shakeAmt = 0;
    this.combo = 1;
    this.lastKill = -10;
    this.camLook = new THREE.Vector3();
    this.fpsAcc = { t: 0, n: 0 };
    this.waypoint = null;
    this.setQuality(save.settings.quality, false);
    this.renderer.shadowMap.enabled = this.qualityLevel !== 'low';
    window.addEventListener('resize', () => this.resize());
    this.resize();
    this.last = performance.now();
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
  }

  // ---------- качество графики ----------
  setQuality(setting, apply = true) {
    this.qualitySetting = setting;
    this.qualityLevel = setting === 'auto' ? (isCoarse() ? 'medium' : 'high') : setting;
    this.q = QUALITY[this.qualityLevel];
    if (apply) this.applyQuality();
  }
  applyQuality() {
    this.q = QUALITY[this.qualityLevel];
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.q.dpr));
    // на низком качестве тени выключены: вдвое меньше вызовов отрисовки
    this.renderer.shadowMap.enabled = this.qualityLevel !== 'low';
    if (this.scene) this.scene.traverse((o) => o.material && (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => (m.needsUpdate = true)));
    if (this.world) this.world.setShadowQuality(this.q.shadow);
    this.buildComposer();
    this.resize();
  }
  buildComposer() {
    if (this.composer) {
      this.composer.dispose();
      this.composer = null;
    }
    if (!this.q.post || !this.scene) return;
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(this.renderer, rt);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    if (this.q.ao) {
      const ao = new GTAOPass(this.scene, this.camera, size.x, size.y);
      ao.updateGtaoMaterial({ radius: 2.5, distanceExponent: 1.5, thickness: 2, scale: 1.2 });
      ao.blendIntensity = 0.85;
      this.composer.addPass(ao);
    }
    this.composer.addPass(new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.3, 0.5, 0.96));
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

  // ---------- мир: строится один раз за сессию ----------
  buildWorld() {
    if (this.world) return;
    this.scene = new THREE.Scene();
    this.enemies = [];
    this.winchables = [];
    this.timers = [];
    this.walkers = [];
    this.world = new World(this.scene, this.renderer, { seed: 2024, lighting: 'day', density: this.q.density });
    this.world.setShadowQuality(this.q.shadow);
    this.world.onPropDestroyed = (it) => this.onPropDestroyed(it);
    this.world.onSmoke = (x, y, z) => this.fx.puff(x, y, z, 3.2, false, 4);
    this.fx = new FX(this.scene, this.q.fx, this.world);
    this.projectiles = new Projectiles(this);
    this.player = new Player(this);
    this.stats = { kills: 0, shots: 0, hits: 0, damage: 0, civilians: 0, rescued: 0, buildings: 0 };
    this.buildComposer();
    this.resize();
    this.updateCamera(0, true);
  }

  startAttract() {
    this.buildWorld();
    if (this.ow && this.mode !== 'attract') this.resumePos = this.player.pos.clone();
    this.mode = 'attract';
    this.attractT = 0;
    const p = this.player;
    p.state = 'fly';
    p.invuln = 0;
    p.pos.set(LAYOUT.city.x + 120, 40, LAYOUT.city.z);
    this.hud.reset();
  }

  // Вход в открытый мир (из меню). Повторный вход продолжает с того же места.
  startCampaign() {
    this.buildWorld();
    this.audio.unlock();
    this.audio.startRotor();
    if (this.save.settings.music) this.audio.startMusic('action');
    if (!this.ow) {
      this.ow = new OpenWorld(this);
      this.player.respawn(this.world.base);
      this.cineT = 0;
      if (this.save.chapter === 0 && !this.save.tutorialDone) this.tutorial();
    } else {
      // продолжаем с ближайшей к последней позиции нашей базы
      const at = this.resumePos || this.player.pos;
      const base = this.nearestBase(at.x, at.z);
      this.player.respawn(base);
      this.camLook.set(base.x, this.world.heightAt(base.x, base.z), base.z);
      this.cineT = 0;
    }
    this.mode = 'play';
    this.input.reset();
    this.input.enabled = this.cineT >= 3;
    this.last = performance.now();
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

  tutorial() {
    const touch = isCoarse();
    const steps = [
      [4, touch ? 'Веди пальцем по левой половине экрана — вертолёт полетит туда' : 'WASD или стрелки — полёт'],
      [10, 'Держи «Пулемёт» или «Ракеты» — прицел сам наводится на ближайшую цель'],
      [17, 'Золотая стрелка ведёт к сюжетному заданию. Кнопка «Карта» — весь остров'],
      [24, 'Красные аванпосты можно зачистить: они станут нашими точками дозаправки'],
      [31, 'Зависни над ящиком или человеком — лебёдка поднимет его на борт'],
      [38, 'На базе «Сокол» открывай ангар: модули открывают новые задания'],
    ];
    for (const [t, text] of steps) this.after(t, () => this.mode === 'play' && this.hud.toast(text, 'info', 5000));
    this.after(40, () => {
      this.save.tutorialDone = true;
      persist();
    });
  }

  // ---------- сюжетные задания ----------
  startStory(def) {
    this.hooks.transition(() => {
      if (this.world.lightingName !== def.lighting) this.world.setLighting(def.lighting);
      this.mission = new MissionRunner(this, def);
      this.missionDeaths = 0;
      this.missionStats = { ...this.stats };
      this.missionStart = this.time;
      this.applyNightVision();
    }).then(() => this.hooks.banner(def.name, def.place));
  }

  onStoryComplete(runner) {
    const def = runner.def;
    this.mode = 'outro';
    this.outroT = 0;
    this.input.enabled = false;
    this.timeScale = 0.4;
    this.hooks.banner('ЗАДАНИЕ ВЫПОЛНЕНО', def.name);
    this.after(1.6, () => (this.timeScale = 1));
    this.after(3.4, () => {
      const t = this.time - this.missionStart;
      let stars = 1;
      if (this.missionDeaths <= 1) stars = 2;
      if (this.missionDeaths === 0 && t < 900) stars = 3;
      const ms = this.missionStats;
      const res = {
        def, time: t, stars, reward: def.reward,
        kills: this.stats.kills - ms.kills, rescued: this.stats.rescued - ms.rescued, buildings: this.stats.buildings - ms.buildings,
        accuracy: this.stats.shots - ms.shots ? Math.round(((this.stats.hits - ms.hits) / (this.stats.shots - ms.shots)) * 100) : 0,
        civilians: this.stats.civilians - ms.civilians,
      };
      this.save.credits += def.reward;
      this.save.chapter = Math.max(this.save.chapter, STORY.indexOf(def) + 1);
      this.save.stars[def.id] = Math.max(this.save.stars[def.id] || 0, stars);
      persist();
      this.mission = null;
      this.boss = null;
      this.bossVisible = false;
      this.mode = 'paused';
      this.audio.setRotor(0, 0);
      this.hooks.onComplete(res);
    });
  }

  // Вернуться в мир после экрана итогов.
  resumeAfterStory() {
    if (this.world.lightingName !== 'day') this.world.setLighting('day');
    this.applyNightVision();
    this.mode = 'play';
    this.input.enabled = true;
    this.last = performance.now();
  }

  applyNightVision() {
    const nv = this.world.night && this.player.stats.nv;
    this.nightVision = nv;
    this.renderer.toneMappingExposure = this.world.light.exposure * (nv ? 2.2 : 1);
    this.hud.setNightVision(nv);
  }

  // ---------- базы ----------
  friendlyBases() {
    return this.ow ? this.ow.friendlyBases() : [{ id: 'fob', x: LAYOUT.fob.x, z: LAYOUT.fob.z, radius: 14, main: true }];
  }
  nearestBase(x, z) {
    let best = null, bd = Infinity;
    for (const b of this.friendlyBases()) {
      const d = Math.hypot(b.x - x, b.z - z);
      if (d < bd) {
        bd = d;
        best = b;
      }
    }
    return best;
  }

  // Покупка в ангаре: характеристики и внешний вид обновляются сразу.
  refitHeli() {
    const p = this.player;
    const state = { pos: p.pos.clone(), yaw: p.yaw, st: p.state, pax: p.passengers };
    p.dispose();
    this.player = new Player(this);
    const np = this.player;
    np.pos.copy(state.pos);
    np.yaw = state.yaw;
    np.state = state.st === 'fly' ? 'fly' : np.state;
    np.passengers = state.pax;
    np.invuln = 0;
    this.applyNightVision();
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
  addCredits(v, pos, cls = '') {
    v = Math.round(v);
    if (!v) return;
    this.save.credits = Math.max(0, this.save.credits + v);
    if (pos) this.hud.floater((v > 0 ? '+' : '') + v, pos, cls || (v < 0 ? 'bad' : ''));
  }
  // старое имя: очки теперь — кредиты
  addScore(v, pos, cls) {
    this.addCredits(v / 5, pos, cls);
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
        if (Math.hypot(dx, dz) < r && y < b.y + b.top + 2) this.damageBuilding(b, dmg * 0.55);
      }
    } else if (this.player.alive) {
      const p = this.player.pos;
      const d = Math.hypot(p.x - x, p.y - y, p.z - z);
      if (d < r) this.player.damage(dmg * (1 - 0.5 * (d / r)));
    }
    if (y < this.fx.ground(x, z) + 7) this.world.blast(x, z, r * 0.7);
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
        x: b.x + Math.cos(a) * r, y: b.y + Math.random() * b.h * 0.6, z: b.z + Math.sin(a) * r,
        vx: Math.cos(a) * 4, vy: 2 + Math.random() * 3, vz: Math.sin(a) * 4, drag: 1,
        life: 2 + Math.random() * 1.5, s0: 2, s1: 4.5 + Math.random() * 2, c0: dust, c1: dust, fadeFrom: 0.6, growRate: 1.5,
      });
    }
    this.fx.debrisBurst(b.x, b.y + b.h * 0.6, b.z, Math.round(16 * this.q.fx), b.wallColor, 2);
    this.world.blast(b.x, b.z, Math.max(b.w, b.d) * 0.6);
    this.addCredits(12, new THREE.Vector3(b.x, b.y + b.h, b.z));
    if (b.crate) {
      const type = b.crate;
      b.crate = null;
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
        this.fx.explosion(it.x, y + 1, it.z, 0.9, 0x666666);
        this.fx.addFire(it.x, y + 1, it.z, 5, 0.7);
        this.audio.play('boom', it.x, it.z);
      });
      if (it.civilian) {
        this.stats.civilians++;
        this.addCredits(-25, new THREE.Vector3(it.x, y + 3, it.z));
      }
    } else if (kind === 'explosive') {
      this.after(0.15, () => {
        this.fx.explosion(it.x, y + 2, it.z, 2.2, 0xb83a2e);
        this.fx.addFire(it.x, y + 1, it.z, 12, 1.6);
        this.audio.play('boomBig', it.x, it.z);
        this.shakeAt(it.x, it.z, 1.2);
        this.applySplash(it.x, y + 2, it.z, 10, 90, 'player');
      });
    } else if (kind === 'tree' || kind === 'bush') {
      this.fx.debrisBurst(it.x, y + 3, it.z, 5, it.color ?? it.set.opts.debris, 0.8);
      this.fx.puff(it.x, y + 3, it.z, 1.5);
    } else if (kind === 'lamp') {
      this.fx.spark(it.x, y + 5, it.z, 6);
    } else {
      this.fx.debrisBurst(it.x, y + 1, it.z, 6, it.color ?? it.set.opts.debris, 1);
    }
  }

  onEnemyKilled(e) {
    this.stats.kills++;
    if (this.time - this.lastKill < 3.2) this.combo = Math.min(this.combo + 1, 5);
    else this.combo = 1;
    this.lastKill = this.time;
    this.addCredits((e.score / 5) * this.combo + (e.bounty || 0), e.aimPoint().clone(), e.tag ? 'big' : '');
    if (!e.tag && e.radius > 2.5 && Math.random() < 0.2) {
      const type = ['fuel', 'ammo', 'armor'][Math.floor(Math.random() * 3)];
      this.after(0.6, () => this.addPickup(type, e.pos.x + 3, e.pos.z));
    }
    if (e.tag && e.tag.targets && e.tag.targets.length > 1) {
      const left = e.tag.targets.filter((t) => t.alive).length;
      if (left > 0) this.hud.toast(`${e.label || 'Цель'}: уничтожено, осталось ${left}`, 'good', 1600);
    }
  }

  bigDeath(e, size, n) {
    const c = e.aimPoint().clone();
    for (let i = 0; i < n; i++) {
      this.after(i * 0.28, () => {
        const x = c.x + (Math.random() - 0.5) * e.radius * 1.6, z = c.z + (Math.random() - 0.5) * e.radius * 1.6;
        this.fx.explosion(x, e.pos.y + (c.y - e.pos.y) * Math.random(), z, size * 0.6);
        this.audio.play('boom', x, z);
        this.shake(0.4);
      });
    }
    this.after(n * 0.28 + 0.2, () => {
      this.fx.explosion(c.x, c.y, c.z, size * 1.4);
      this.fx.addFire(c.x, e.pos.y + 1, c.z, 20, size * 0.8);
      this.audio.play('boomBig', c.x, c.z);
      this.shake(1.6);
      this.vibrate([60, 30, 100]);
      this.world.blast(c.x, c.z, e.radius * 1.4);
    });
  }

  onRescued(p) {
    this.stats.rescued++;
    if (p.objective) p.objective.delivered++;
    this.addCredits(100 + (p.bounty || 0), this.player.pos.clone(), 'big');
    this.audio.play('rescue');
    this.hud.toast(p.kind === 'pilot' ? 'Пилот спасён!' : 'Человек спасён!', 'good', 1300);
    const b = this.player.atBase || this.world.base;
    const m = createPerson(p.kind);
    const y = this.world.heightAt(b.x, b.z);
    m.group.position.set(b.x + (Math.random() - 0.5) * 4, y, b.z + (Math.random() - 0.5) * 4);
    this.scene.add(m.group);
    this.walkers.push({ m, t: 0, tx: b.x - 15, tz: b.z - 8 });
  }

  onObjectiveComplete(o, next) {
    this.audio.play('objective');
    this.vibrate([30, 40, 30]);
    this.hooks.banner('ЗАДАЧА ВЫПОЛНЕНА', next ? 'Далее: ' + next.text : '');
    this.addCredits(200, this.player.pos.clone(), 'big');
  }

  onPlayerDying() {
    this.timeScale = 0.55;
    this.input.enabled = false;
    this.hud.toast('Вертолёт подбит!', 'bad', 2000);
  }

  onPlayerDead() {
    this.timeScale = 1;
    if (this.mission) this.missionDeaths++;
    for (const p of this.player.passengers) p.reset();
    this.player.passengers = [];
    const repair = Math.min(this.save.credits, 150);
    this.after(2.6, () => {
      this.hooks.transition(() => {
        const base = this.nearestBase(this.player.pos.x, this.player.pos.z);
        this.player.respawn(base);
        this.projectiles.clear();
        this.camLook.set(base.x, this.world.heightAt(base.x, base.z), base.z);
        this.cineT = 1.5;
        this.save.credits -= repair;
        persist();
        this.hud.toast(`Новый вертолёт на базе «${base.name || 'Сокол'}». Ремонт: −${repair} 💰`, 'info', 2600);
      });
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
      yaw = CAM_YAW + this.attractT * 0.1;
      dist = 1.1;
      height = 0.75;
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
    const ground = Math.max(this.world.heightAt(p.pos.x, p.pos.z), this.world.waterLevel);
    const lx = p.pos.x + p.vel.x * 0.5, lz = p.pos.z + p.vel.z * 0.5;
    const ly = ground + (p.pos.y - ground) * (this.mode === 'play' && this.cineT >= 3 ? 0.45 : 0.75);
    if (snap) this.camLook.set(lx, ly, lz);
    else {
      this.camLook.x = damp(this.camLook.x, lx, 4, dt);
      this.camLook.y = damp(this.camLook.y, ly, 3, dt);
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
    if (input.mapPressed && this.mode === 'play') this.hooks.openMap();
    this.time += dt;

    if (this.mode === 'attract') {
      this.attractT += rawDt;
      const p = this.player;
      const a = this.attractT * 0.1;
      const tx = LAYOUT.city.x + Math.cos(a) * 150, tz = LAYOUT.city.z + Math.sin(a) * 150;
      p.vel.set((tx - p.pos.x) * 0.6, 0, (tz - p.pos.z) * 0.6);
      p.pos.x += p.vel.x * dt;
      p.pos.z += p.vel.z * dt;
      p.pos.y = damp(p.pos.y, this.world.clearance(p.pos.x, p.pos.z, 8) + 22, 1, dt);
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
      this.updateWalkers(dt);
      this.mission?.update();
      this.ow?.update(dt);
      if (this.mode === 'outro') this.outroT += rawDt;
      this.trackRegion();
      this.hud.update(rawDt, this);
      const sp = Math.hypot(this.player.vel.x, this.player.vel.z);
      this.audio.setRotor(this.player.alive ? 1 : 0, sp);
      this.saveT = (this.saveT || 0) + rawDt;
      if (this.saveT > 15) {
        this.saveT = 0;
        persist();
      }
    }
    for (let i = this.timers.length - 1; i >= 0; i--) {
      if (this.time >= this.timers[i].t) {
        const t = this.timers[i];
        this.timers.splice(i, 1);
        t.fn();
      }
    }
    this.fx.update(dt, this.camera);
    this.world.update(dt, this.player.pos);
    this.world.followSun(this.player.pos.x, this.player.pos.z);
    this.updateCamera(rawDt);
    this.audio.setListener(this.player.pos.x, this.player.pos.z);
    if (this.composer) this.composer.render(rawDt);
    else this.renderer.render(this.scene, this.camera);
  }

  trackRegion() {
    this.regionT = (this.regionT || 0) + 1;
    if (this.regionT % 30) return;
    const name = this.world.regionAt(this.player.pos.x, this.player.pos.z);
    if (name !== this.regionName) {
      if (this.regionName) this.hud.regionBanner(name);
      this.regionName = name;
    }
  }

  updateWalkers(dt) {
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
      o.y = this.world.heightAt(o.x, o.z);
      w.m.group.rotation.y = Math.atan2(dx, dz);
      w.m.inner.position.y = Math.abs(Math.sin(w.t * 12)) * 0.2;
      w.m.arms[0].rotation.x = Math.sin(w.t * 12) * 0.8;
      w.m.arms[1].rotation.x = -Math.sin(w.t * 12) * 0.8;
    }
  }
}

export { STORY };

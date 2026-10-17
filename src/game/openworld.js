import * as THREE from 'three';
import { Rng, dist2D } from '../core/utils.js';
import { spawnEnemy } from './enemies.js';
import { LAYOUT, WORLD } from './terrain.js';
import { setOutpostOwner } from './regions.js';
import { STORY } from './missions.js';
import { missingRequirements, moduleLevel } from './modules.js';
import { persist } from '../core/save.js';

const FOG_N = 96;

// Состояние открытого мира: аванпосты, фоновые враги, события, туман войны.
export class OpenWorld {
  constructor(game) {
    this.game = game;
    this.save = game.save;
    // события у каждого игрока свои, а расстановка врагов — одинаковая
    // у обоих участников совместной игры (фиксированное зерно)
    this.rng = new Rng(Date.now() & 0xffff);
    this.save.world ||= { outposts: {}, fog: '' };
    // сетка тумана могла поменяться с прошлой версии — тогда начинаем с чистой
    if (this.save.world.fogN !== FOG_N) {
      this.save.world.fog = '';
      this.save.world.fogN = FOG_N;
    }
    this.fog = decodeFog(this.save.world.fog);
    this.outposts = [];
    this.events = [];
    this.eventT = 50;
    this.zoneT = 0;
    this.fogT = 0;
    game.withTag('amb', () => this.spawnAmbient(new Rng(20240617)));
    this.setupOutposts();
  }

  // ---------- аванпосты ----------
  setupOutposts() {
    const g = this.game;
    LAYOUT.outposts.forEach((o, i) => {
      const owner = this.save.world.outposts[o.id] || 'enemy';
      const op = { ...o, owner, defenders: [], y: g.world.heightAt(o.x, o.z) };
      this.outposts.push(op);
      setOutpostOwner(g.world, o.id, owner);
      if (owner === 'enemy') {
        const list = ['soldier', 'soldier', 'rpg', 'soldier', i % 3 === 0 ? 'sam' : 'aa'];
        if (i % 2) list.push('jeep');
        op.defenders = g.withTag('op-' + o.id, () =>
          list.map((t, k) => {
            const a = (k / list.length) * Math.PI * 2;
            return spawnEnemy(g, t, o.x + Math.cos(a) * 11, o.z + Math.sin(a) * 11, { patrol: false });
          })
        );
        for (const d of op.defenders) d.outpost = op;
      }
    });
  }

  liberate(op) {
    const g = this.game;
    op.owner = 'ally';
    this.save.world.outposts[op.id] = 'ally';
    setOutpostOwner(g.world, op.id, 'ally');
    g.addCredits(400, new THREE.Vector3(op.x, op.y + 6, op.z), 'big');
    g.hooks.banner('АВАНПОСТ ОСВОБОЖДЁН', `${op.name}: теперь здесь можно заправиться и пополнить боезапас`);
    g.audio.play('objective');
    persist();
  }

  friendlyBases() {
    const out = [{ id: 'fob', name: LAYOUT.fob.name, x: LAYOUT.fob.x, z: LAYOUT.fob.z, radius: 14, main: true }];
    for (const op of this.outposts) if (op.owner === 'ally') out.push({ id: op.id, name: op.name, x: op.x - 8, z: op.z - 12, radius: 10 });
    return out;
  }

  // ---------- фоновые враги по регионам ----------
  spawnAmbient(rng) {
    const g = this.game, w = g.world;
    const put = (type, region, n, opts = {}) => {
      for (let i = 0; i < n; i++) {
        const p = w.randomStreetPoint(rng, region, 90);
        spawnEnemy(g, type, p.x, p.z, opts);
      }
    };
    put('soldier', 'city', 12);
    put('rpg', 'city', 3);
    put('jeep', 'city', 3, { patrol: true });
    put('aa', 'city', 2);
    put('soldier', 'industrial', 8);
    put('jeep', 'industrial', 2, { patrol: true });
    put('aa', 'industrial', 2);
    put('tank', 'industrial', 1, { patrol: true });
    put('soldier', 'airbase', 8);
    put('aa', 'airbase', 3);
    put('tank', 'airbase', 2, { patrol: true });
    put('sam', 'airbase', 2);

    put('soldier', 'refinery', 8);
    put('jeep', 'refinery', 2, { patrol: true });
    put('aa', 'refinery', 2);
    put('tank', 'refinery', 1, { patrol: true });

    put('soldier', 'radar', 8);
    put('sam', 'radar', 2);
    put('aa', 'radar', 2);

    put('soldier', 'dam', 6);
    put('rpg', 'dam', 3);
    put('aa', 'dam', 2);

    put('soldier', 'resort', 6);
    put('jeep', 'resort', 2, { patrol: true });

    put('soldier', 'bunker', 10);
    put('tank', 'bunker', 1);
    put('sam', 'bunker', 2);

    for (const v of LAYOUT.villages) {
      for (let i = 0; i < 3; i++) spawnEnemy(g, 'soldier', v.x + rng.float(-25, 25), v.z + rng.float(-25, 25));
    }
    for (const p of w.sites.mountains.slice(3)) spawnEnemy(g, 'aa', p.x + 6, p.z - 6);
    // припасы вдоль дорог и у аванпостов
    for (let i = 0; i < 48; i++) {
      const region = rng.pick(['city', 'industrial', 'airbase', 'refinery', 'radar', 'dam', 'resort', 'bunker', null]);
      let p;
      if (region) p = w.randomStreetPoint(rng, region, 40);
      else {
        const road = rng.pick(w.terrain.roads);
        const q = rng.pick(road);
        p = { x: q.x + rng.float(-3, 3), z: q.z + rng.float(-3, 3) };
      }
      g.addPickup(rng.pick(['fuel', 'fuel', 'ammo', 'armor']), p.x, p.z);
    }
    const blds = w.buildings.filter((b) => !b.indestructible);
    for (let i = 0; i < 65 && blds.length; i++) blds.splice(rng.int(0, blds.length - 1), 1)[0].crate = rng.pick(['fuel', 'ammo', 'armor']);
  }

  // ---------- сюжет ----------
  storyDef() {
    return STORY[this.save.chapter] || null;
  }

  // ведомый в паре задания не выбирает: их запускает ведущий
  get isWingman() {
    return this.game.coopMode && this.game.net?.isClient;
  }

  storyMarker() {
    const def = this.storyDef();
    if (!def || this.game.mission || this.isWingman) return null;
    return { ...def.marker, y: this.game.world.heightAt(def.marker.x, def.marker.z) + 6, def };
  }

  // ---------- события ----------
  spawnEvent() {
    const g = this.game, rng = this.rng, w = g.world;
    const type = rng.pick(['pilot', 'convoy', 'supply']);
    let pos = null;
    for (let t = 0; t < 30 && !pos; t++) {
      const x = rng.float(-WORLD.half + 300, WORLD.half - 300), z = rng.float(-WORLD.half + 300, WORLD.half - 300);
      const h = w.heightAt(x, z);
      if (h < 1 || h > 70 || w.terrain.slope(x, z) > 0.5) continue;
      if (dist2D(x, z, g.player.pos.x, g.player.pos.z) < 200) continue;
      pos = { x, z };
    }
    if (!pos) return;
    const ev = { type, x: pos.x, z: pos.z, t: 0, entities: [] };
    if (type === 'pilot') {
      const r = g.addRescuee(pos.x, pos.z, 'pilot');
      r.bounty = 350;
      ev.entities.push(r);
      ev.text = 'Сигнал бедствия: сбитый пилот';
      for (const t of ['soldier', 'soldier', 'rpg']) spawnEnemy(g, t, pos.x + rng.float(-14, 14), pos.z + rng.float(-14, 14));
    } else if (type === 'convoy') {
      const road = rng.pick(w.terrain.roads);
      const q = road[Math.floor(road.length / 2)];
      ev.x = q.x;
      ev.z = q.z;
      for (let i = 0; i < 2; i++) {
        const tr = spawnEnemy(g, 'truck', q.x, q.z + i * 5);
        tr.bounty = 250;
        ev.entities.push(tr);
      }
      spawnEnemy(g, 'jeep', q.x, q.z - 8, { patrol: true });
      ev.text = 'Разведка: вражеский конвой на трассе';
    } else {
      const p = g.addPickup('ammo', pos.x, pos.z);
      p.bounty = 200;
      ev.entities.push(p, g.addPickup('fuel', pos.x + 4, pos.z), g.addPickup('armor', pos.x - 4, pos.z));
      ev.text = 'Сброшен груз снабжения';
    }
    this.events.push(ev);
    g.hud.toast(ev.text + ' — отмечено на карте', 'info', 3500);
    g.audio.play('warn');
  }

  // ---------- кадр ----------
  update(dt) {
    const g = this.game, p = g.player;
    // освобождение аванпостов
    for (const op of this.outposts) {
      if (op.owner !== 'enemy' || !op.defenders.length) continue;
      if (op.defenders.every((d) => !d.alive) && dist2D(p.pos.x, p.pos.z, op.x, op.z) < 120) this.liberate(op);
    }
    // события
    this.eventT -= dt;
    if (this.eventT <= 0 && !this.isWingman) {
      this.eventT = this.rng.float(120, 200);
      if (this.events.length < 3) this.spawnEvent();
    }
    this.events = this.events.filter((ev) => ev.entities.some((e) => e.alive));
    // зона ПВО авиабазы: без станции помех туда не пройти
    const A = LAYOUT.airbase;
    const inZone = Math.abs(p.pos.x - A.x) < A.hx + 80 && Math.abs(p.pos.z - A.z) < A.hz + 80;
    if (inZone && p.state === 'fly' && moduleLevel(this.save, 'ew') < 2) {
      this.zoneT -= dt;
      if (this.zoneT <= 0) {
        this.zoneT = 4.5;
        const a = Math.random() * Math.PI * 2;
        const from = new THREE.Vector3(p.pos.x + Math.cos(a) * 110, p.pos.y + 20, p.pos.z + Math.sin(a) * 110);
        const dir = p.pos.clone().sub(from).normalize();
        g.projectiles.spawn('sam', 'enemy', from, dir, { target: p });
        g.hud.toast('Дальнобойная ПВО! Нужна станция помех: РЭБ ур. 2', 'bad', 2500);
        g.audio.play('samLaunch');
      }
    } else this.zoneT = 1.5;
    // предложение начать сюжетное задание
    const m = this.storyMarker();
    if (m && p.state === 'fly' && dist2D(p.pos.x, p.pos.z, m.x, m.z) < 70) {
      if (!this.prompted) {
        this.prompted = true;
        g.hooks.offerMission(m.def, missingRequirements(this.save, m.def.requires));
      }
    } else if (!m || dist2D(p.pos.x, p.pos.z, m.x, m.z) > 110) this.prompted = false;
    // туман войны
    this.fogT += dt;
    if (this.fogT > 0.5) {
      this.fogT = 0;
      this.reveal(p.pos.x, p.pos.z, p.stats.radar * 0.8);
    }
  }

  reveal(x, z, r) {
    const cell = (WORLD.half * 2) / FOG_N;
    const i0 = Math.floor((x - r + WORLD.half) / cell), i1 = Math.floor((x + r + WORLD.half) / cell);
    const j0 = Math.floor((z - r + WORLD.half) / cell), j1 = Math.floor((z + r + WORLD.half) / cell);
    let changed = false;
    for (let j = Math.max(j0, 0); j <= Math.min(j1, FOG_N - 1); j++)
      for (let i = Math.max(i0, 0); i <= Math.min(i1, FOG_N - 1); i++) {
        const cx = -WORLD.half + (i + 0.5) * cell, cz = -WORLD.half + (j + 0.5) * cell;
        if (Math.hypot(cx - x, cz - z) < r && !this.fog[j * FOG_N + i]) {
          this.fog[j * FOG_N + i] = 1;
          changed = true;
        }
      }
    if (changed) this.save.world.fog = encodeFog(this.fog);
  }

  explored(x, z) {
    const cell = (WORLD.half * 2) / FOG_N;
    const i = Math.floor((x + WORLD.half) / cell), j = Math.floor((z + WORLD.half) / cell);
    return i >= 0 && j >= 0 && i < FOG_N && j < FOG_N && this.fog[j * FOG_N + i] === 1;
  }
}

export const FOG_SIZE = FOG_N;

function decodeFog(str) {
  const out = new Uint8Array(FOG_N * FOG_N);
  if (!str) return out;
  try {
    const bin = atob(str);
    for (let i = 0; i < out.length; i++) out[i] = (bin.charCodeAt(i >> 3) >> (i & 7)) & 1;
  } catch {
    /* повреждённое сохранение — начинаем с чистой карты */
  }
  return out;
}

function encodeFog(arr) {
  const bytes = new Uint8Array(Math.ceil(arr.length / 8));
  for (let i = 0; i < arr.length; i++) if (arr[i]) bytes[i >> 3] |= 1 << (i & 7);
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

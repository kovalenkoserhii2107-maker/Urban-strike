import * as THREE from 'three';
import { Rng, dist2D } from '../core/utils.js';
import { spawnEnemy, Rescuee } from './enemies.js';
import { Pickup } from './pickups.js';
import { toon, G } from './materials.js';
import { createWreckHeli, enableShadows } from './models.js';

class Objective {
  constructor(text) {
    this.text = text;
    this.done = false;
  }
  progressText() {
    return '';
  }
  targetPos() {
    return null;
  }
}

class DestroyObjective extends Objective {
  constructor(text, targets, { boss = false } = {}) {
    super(text);
    this.targets = targets;
    this.boss = boss;
    for (const t of targets) t.tag = this;
  }
  check() {
    return this.targets.every((t) => !t.alive);
  }
  progressText() {
    const dead = this.targets.filter((t) => !t.alive).length;
    return this.targets.length > 1 ? `${dead}/${this.targets.length}` : '';
  }
  targetPos(game) {
    let best = null, bd = Infinity;
    const p = (game || this.game).player.pos;
    for (const t of this.targets) {
      if (!t.alive) continue;
      const d = dist2D(t.pos.x, t.pos.z, p.x, p.z);
      if (d < bd) {
        bd = d;
        best = t;
      }
    }
    return best ? { x: best.pos.x, y: best.pos.y + best.centerY + 4, z: best.pos.z } : null;
  }
}

class RescueObjective extends Objective {
  constructor(text, people, need) {
    super(text);
    this.people = people;
    this.need = need;
    this.delivered = 0;
    for (const p of people) p.objective = this;
  }
  check() {
    return this.delivered >= this.need;
  }
  progressText() {
    return `${this.delivered}/${this.need}`;
  }
  targetPos(game) {
    const g = game || this.game;
    const pl = g.player;
    const full = pl.passengers.length >= pl.capacity;
    const left = this.people.filter((p) => p.alive && !p.attached);
    if (pl.passengers.length && (full || left.length === 0)) return { x: g.world.base.x, y: 3, z: g.world.base.z };
    let best = null, bd = Infinity;
    for (const t of left) {
      const d = dist2D(t.pos.x, t.pos.z, pl.pos.x, pl.pos.z);
      if (d < bd) {
        bd = d;
        best = t;
      }
    }
    if (best) return { x: best.pos.x, y: 5, z: best.pos.z };
    return pl.passengers.length ? { x: g.world.base.x, y: 3, z: g.world.base.z } : null;
  }
}

export class MissionRunner {
  constructor(game, def) {
    this.game = game;
    this.def = def;
    this.rng = new Rng(def.seed * 7 + 3);
    this.objectives = def.setup(game, this);
    for (const o of this.objectives) o.game = game;
    this.idx = 0;
    this.finished = false;
    this.activate();
  }
  current() {
    return this.objectives[this.idx] || null;
  }
  activate() {
    const o = this.current();
    if (!o) return;
    this.game.bossVisible = !!o.boss;
    if (o.boss) this.game.boss = o.targets[0];
  }
  update() {
    if (this.finished) return;
    const o = this.current();
    if (!o) return;
    // выполненные заранее задачи засчитываются сразу
    for (const other of this.objectives) if (!other.done && other.check()) other.done = true;
    if (o.done) {
      this.idx++;
      this.game.onObjectiveComplete(o, this.current());
      this.activate();
      if (!this.current()) {
        this.finished = true;
        this.game.onMissionComplete();
      }
    }
  }

  // ---------- помощники расстановки ----------
  around(c, n, r, jitter = 2) {
    const out = [];
    const a0 = this.rng.float(0, Math.PI * 2);
    for (let i = 0; i < n; i++) {
      const a = a0 + (i / n) * Math.PI * 2;
      out.push({ x: c.x + Math.cos(a) * r + this.rng.float(-jitter, jitter), z: c.z + Math.sin(a) * r + this.rng.float(-jitter, jitter) });
    }
    return out;
  }
  guards(c, list, r = 12) {
    const pts = this.around(c, list.length, r, 3);
    return list.map((t, i) => spawnEnemy(this.game, t, pts[i].x, pts[i].z, { patrol: false }));
  }
  ambient({ soldiers = 0, rpg = 0, jeeps = 0, tanks = 0, aa = 0, sam = 0 }) {
    const g = this.game, rng = this.rng, w = g.world;
    for (let i = 0; i < soldiers; i++) {
      const p = w.randomStreetPoint(rng, 100);
      const n = rng.int(1, 3);
      for (let k = 0; k < n; k++) spawnEnemy(g, k === 2 || (rpg > 0 && rng.chance(0.25)) ? 'rpg' : 'soldier', p.x + rng.float(-4, 4), p.z + rng.float(-4, 4));
    }
    for (let i = 0; i < rpg; i++) {
      const p = w.randomStreetPoint(rng, 110);
      spawnEnemy(g, 'rpg', p.x, p.z);
    }
    for (let i = 0; i < jeeps; i++) {
      const p = w.randomStreetPoint(rng, 110);
      spawnEnemy(g, 'jeep', p.x, p.z, { patrol: true });
    }
    for (let i = 0; i < tanks; i++) {
      const p = w.randomStreetPoint(rng, 130);
      spawnEnemy(g, 'tank', p.x, p.z, { patrol: rng.chance(0.5) });
    }
    for (let i = 0; i < aa; i++) {
      const p = w.randomStreetPoint(rng, 120);
      spawnEnemy(g, 'aa', p.x, p.z);
    }
    for (let i = 0; i < sam; i++) {
      const p = w.randomStreetPoint(rng, 150);
      spawnEnemy(g, 'sam', p.x, p.z);
    }
  }
  pickups({ fuel = 8, ammo = 6, armor = 5, hidden = 14 }) {
    const g = this.game, rng = this.rng, w = g.world;
    const put = (type, n) => {
      for (let i = 0; i < n; i++) {
        const p = w.randomStreetPoint(rng, 55);
        g.addPickup(type, p.x, p.z);
      }
    };
    put('fuel', fuel);
    put('ammo', ammo);
    put('armor', armor);
    const blds = w.buildings.filter((b) => Math.hypot(b.x - w.base.x, b.z - w.base.z) > 60);
    for (let i = 0; i < hidden && blds.length; i++) {
      const b = blds.splice(rng.int(0, blds.length - 1), 1)[0];
      b.crate = rng.pick(['fuel', 'fuel', 'ammo', 'armor']);
    }
  }
  walls(c, size = 34, h = 3.2) {
    const s = this.game.scene;
    const mat = toon(0xb9ac93);
    const half = size / 2;
    const segs = [
      [0, -half, size, 1.2],
      [-half, 0, 1.2, size],
      [half, 0, 1.2, size],
      [-half / 2 - 3, half, half - 6, 1.2],
      [half / 2 + 3, half, half - 6, 1.2],
    ];
    for (const [x, z, w, d] of segs) {
      const m = new THREE.Mesh(G.box(1, 1, 1), mat);
      m.scale.set(w, h, d);
      m.position.set(c.x + x, h / 2, c.z + z);
      enableShadows(m);
      s.add(m);
    }
    for (const [x, z] of [[-half, -half], [half, -half]]) {
      const tower = new THREE.Group();
      for (const sx of [-1, 1])
        for (const sz of [-1, 1]) {
          const leg = new THREE.Mesh(G.box(0.3, 7, 0.3), toon(0x6b4a2b));
          leg.position.set(sx * 1.2, 3.5, sz * 1.2);
          tower.add(leg);
        }
      const hut = new THREE.Mesh(G.box(3.4, 2.2, 3.4), toon(0x8a6a4a));
      hut.position.y = 8;
      tower.add(hut);
      const roof = new THREE.Mesh(G.cone(2.8, 1.6, 4), toon(0x5b4a33));
      roof.position.y = 9.9;
      roof.rotation.y = Math.PI / 4;
      tower.add(roof);
      tower.position.set(c.x + x, 0, c.z + z);
      enableShadows(tower);
      s.add(tower);
    }
  }
  sandbags(c, r = 5) {
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      if (i === 2) continue;
      const m = new THREE.Mesh(G.box(2.6, 1.1, 1.2), toon(0xd8c08a));
      m.position.set(c.x + Math.cos(a) * r, 0.55, c.z + Math.sin(a) * r);
      m.rotation.y = -a + Math.PI / 2;
      enableShadows(m);
      this.game.scene.add(m);
    }
  }
}

export const MISSIONS = [
  {
    id: 1,
    name: 'Операция «Рассвет»',
    place: 'Порт-Лазурь, 06:40',
    lighting: 'day',
    seed: 1337,
    sites: 5,
    par: 600,
    briefing:
      'Наёмники генерала Кроста захватили Порт-Лазурь. Город накрыт сетью ПВО, в старом квартале держат заложников. Сначала ослепи их радары, потом вытащи людей и сравняй штаб с землёй.',
    goals: ['Уничтожить 3 радара ПВО', 'Спасти 5 заложников и доставить на базу', 'Уничтожить командный центр'],
    setup(game, M) {
      const S = game.world.sites;
      const radars = [];
      for (let i = 0; i < 3; i++) {
        const c = S[i];
        M.sandbags(c, 6);
        radars.push(spawnEnemy(game, 'radar', c.x, c.z));
        M.guards(c, ['aa', 'soldier', 'soldier', i === 2 ? 'rpg' : 'soldier'], 13);
      }
      const camp = S[3];
      M.walls(camp);
      const people = [];
      for (let i = 0; i < 6; i++) people.push(game.addRescuee(camp.x + (i % 3) * 4 - 4, camp.z + Math.floor(i / 3) * 5 - 2));
      M.guards(camp, ['soldier', 'soldier', 'rpg', 'soldier', 'jeep'], 22);
      const hq = S[4];
      const bunker = spawnEnemy(game, 'bunker', hq.x, hq.z);
      M.guards(hq, ['tank', 'aa', 'sam', 'soldier', 'soldier', 'rpg', 'tank'], 18);
      M.ambient({ soldiers: 12, rpg: 3, jeeps: 4, tanks: 2, aa: 2, sam: 0 });
      M.pickups({ fuel: 9, ammo: 7, armor: 6, hidden: 16 });
      return [
        new DestroyObjective('Уничтожь радары ПВО', radars),
        new RescueObjective('Спаси заложников и доставь на базу', people, 5),
        new DestroyObjective('Уничтожь командный центр', [bunker]),
      ];
    },
  },
  {
    id: 2,
    name: 'Ночной рейд',
    place: 'Порт-Лазурь, 02:15',
    lighting: 'night',
    seed: 4242,
    sites: 6,
    par: 720,
    briefing:
      'Наш разведчик сбит над деловым центром. Враг перебрасывает конвой с ракетами и прикрыл небо зенитными комплексами. Ночью они слепы — включай прожектор, держи ловушки наготове.',
    goals: ['Уничтожить 4 пусковые ЗРК', 'Перехватить конвой из 3 грузовиков', 'Эвакуировать сбитого пилота'],
    setup(game, M) {
      const S = game.world.sites;
      const sams = [];
      for (let i = 0; i < 4; i++) {
        const c = S[i];
        M.sandbags(c, 7);
        sams.push(spawnEnemy(game, 'sam', c.x, c.z));
        M.guards(c, ['soldier', 'aa', 'soldier'], 13);
      }
      const conv = S[4];
      const trucks = [];
      for (let i = 0; i < 3; i++) trucks.push(spawnEnemy(game, 'truck', conv.x + 30, conv.z + i * 4));
      for (let i = 0; i < 2; i++) spawnEnemy(game, 'jeep', conv.x + 30, conv.z - 8 - i * 6, { patrol: true });
      const crash = S[5];
      const wreck = createWreckHeli();
      wreck.group.position.set(crash.x + 5, 0, crash.z);
      game.scene.add(wreck.group);
      game.fx.addFire(crash.x + 5, 1, crash.z, 9999, 1.1);
      const pilot = game.addRescuee(crash.x - 3, crash.z + 2, 'pilot');
      M.guards(crash, ['soldier', 'soldier', 'rpg', 'tank', 'soldier'], 16);
      M.ambient({ soldiers: 14, rpg: 5, jeeps: 5, tanks: 3, aa: 3, sam: 0 });
      M.pickups({ fuel: 9, ammo: 8, armor: 6, hidden: 18 });
      return [
        new DestroyObjective('Уничтожь пусковые ЗРК', sams),
        new DestroyObjective('Перехвати конвой с ракетами', trucks),
        new RescueObjective('Эвакуируй сбитого пилота', [pilot], 1),
      ];
    },
  },
  {
    id: 3,
    name: 'Крепость «Голиаф»',
    place: 'Порт-Лазурь, 19:30',
    lighting: 'sunset',
    seed: 9001,
    sites: 5,
    par: 840,
    briefing:
      'Крост выводит из ангара «Голиаф» — бронированную ракетную крепость. Её щит питает электростанция. Сбей вертолётный патруль, обесточь генераторы и разбери крепость по частям: турели, пусковую, ядро.',
    goals: ['Сбить 2 вертолёта патруля', 'Уничтожить 3 генератора', 'Уничтожить крепость «Голиаф»'],
    setup(game, M) {
      const S = game.world.sites;
      const helis = [spawnEnemy(game, 'heli', S[0].x, S[0].z), spawnEnemy(game, 'heli', S[1].x, S[1].z)];
      M.guards(S[0], ['aa', 'soldier', 'soldier'], 12);
      M.guards(S[1], ['aa', 'rpg', 'soldier'], 12);
      const plant = S[2];
      const gens = M.around(plant, 3, 11, 0).map((p) => spawnEnemy(game, 'generator', p.x, p.z));
      M.guards(plant, ['tank', 'aa', 'sam', 'soldier', 'rpg'], 21);
      const bossSite = S[3];
      const boss = spawnEnemy(game, 'boss', bossSite.x + 30, bossSite.z + 30);
      M.guards(S[4], ['tank', 'aa', 'soldier', 'soldier'], 14);
      M.ambient({ soldiers: 16, rpg: 6, jeeps: 5, tanks: 4, aa: 4, sam: 1 });
      M.pickups({ fuel: 10, ammo: 9, armor: 7, hidden: 18 });
      return [
        new DestroyObjective('Сбей вертолёты патруля', helis),
        new DestroyObjective('Уничтожь генераторы щита', gens),
        new DestroyObjective('Уничтожь крепость «Голиаф»', [boss], { boss: true }),
      ];
    },
  },
];

export { Rescuee };

import * as THREE from 'three';
import { Rng, dist2D } from '../core/utils.js';
import { spawnEnemy, Rescuee } from './enemies.js';
import { pbr, G } from './materials.js';
import { createWreckHeli, createRadar, enableShadows } from './models.js';
import { LAYOUT } from './terrain.js';

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

export class DestroyObjective extends Objective {
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
  targetPos() {
    let best = null, bd = Infinity;
    const p = this.game.player.pos;
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

export class RescueObjective extends Objective {
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
  targetPos() {
    const g = this.game, pl = g.player;
    const full = pl.passengers.length >= pl.capacity;
    const left = this.people.filter((p) => p.alive && !p.attached);
    if (pl.passengers.length && (full || left.length === 0)) {
      const b = g.nearestBase(pl.pos.x, pl.pos.z);
      return { x: b.x, y: g.world.heightAt(b.x, b.z) + 3, z: b.z };
    }
    let best = null, bd = Infinity;
    for (const t of left) {
      const d = dist2D(t.pos.x, t.pos.z, pl.pos.x, pl.pos.z);
      if (d < bd) {
        bd = d;
        best = t;
      }
    }
    return best ? { x: best.pos.x, y: best.pos.y + 5, z: best.pos.z } : null;
  }
}

export class MissionRunner {
  constructor(game, def) {
    this.game = game;
    this.def = def;
    this.rng = new Rng(def.seed);
    this.startTime = game.time;
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
    this.game.bossVisible = !!o?.boss;
    if (o?.boss) this.game.boss = o.targets[0];
  }
  update() {
    if (this.finished) return;
    const o = this.current();
    if (!o) return;
    for (const other of this.objectives) if (!other.done && other.check()) other.done = true;
    if (o.done) {
      this.idx++;
      this.game.onObjectiveComplete(o, this.current());
      this.activate();
      if (!this.current()) {
        this.finished = true;
        this.game.onStoryComplete(this);
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
  sandbags(c, r = 5) {
    const y = this.game.world.heightAt(c.x, c.z);
    for (let i = 0; i < 8; i++) {
      if (i === 2) continue;
      const a = (i / 8) * Math.PI * 2;
      const m = new THREE.Mesh(G.box(2.6, 1.1, 1.2), pbr(0xb9a57a, { roughness: 1 }));
      m.position.set(c.x + Math.cos(a) * r, y + 0.55, c.z + Math.sin(a) * r);
      m.rotation.y = -a + Math.PI / 2;
      enableShadows(m);
      this.game.scene.add(m);
    }
  }
  walls(c, size = 34, h = 3.2) {
    const s = this.game.scene;
    const mat = pbr(0xa99e88, { roughness: 0.95 });
    const half = size / 2;
    const y = this.game.world.heightAt(c.x, c.z);
    const segs = [[0, -half, size, 1.2], [-half, 0, 1.2, size], [half, 0, 1.2, size], [-half / 2 - 3, half, half - 6, 1.2], [half / 2 + 3, half, half - 6, 1.2]];
    for (const [x, z, w, d] of segs) {
      const m = new THREE.Mesh(G.box(1, 1, 1), mat);
      m.scale.set(w, h, d);
      m.position.set(c.x + x, y + h / 2, c.z + z);
      enableShadows(m);
      s.add(m);
    }
  }
}

// ---------- сюжет ----------
// requires: минимальные уровни модулей; reward: кредиты за прохождение.
export const STORY = [
  {
    id: 'm1', name: 'Рассвет над Лазурью', place: 'Порт-Лазурь', region: 'city', lighting: 'day', seed: 1337,
    marker: { x: LAYOUT.city.x, z: LAYOUT.city.z + 200 }, requires: {}, reward: 2500,
    briefing: 'Наёмники генерала Кроста захватили Порт-Лазурь. Город накрыт сетью ПВО, в старом квартале держат заложников. Ослепи радары, вытащи людей и сравняй штаб с землёй.',
    goals: ['Уничтожить 3 радара ПВО', 'Спасти 5 заложников и доставить на любую нашу базу', 'Уничтожить командный центр'],
    setup(game, M) {
      const S = game.world.sites.city;
      const radars = [];
      for (let i = 0; i < 3; i++) {
        M.sandbags(S[i], 6);
        radars.push(spawnEnemy(game, 'radar', S[i].x, S[i].z));
        M.guards(S[i], ['aa', 'soldier', 'soldier', 'rpg'], 13);
      }
      M.walls(S[3]);
      const people = [];
      for (let i = 0; i < 6; i++) people.push(game.addRescuee(S[3].x + (i % 3) * 4 - 4, S[3].z + Math.floor(i / 3) * 5 - 2));
      M.guards(S[3], ['soldier', 'soldier', 'rpg', 'soldier', 'jeep'], 22);
      const bunker = spawnEnemy(game, 'bunker', S[4].x, S[4].z);
      M.guards(S[4], ['tank', 'aa', 'sam', 'soldier', 'soldier', 'rpg'], 18);
      return [
        new DestroyObjective('Уничтожь радары ПВО', radars),
        new RescueObjective('Спаси заложников и доставь на базу', people, 5),
        new DestroyObjective('Уничтожь командный центр', [bunker]),
      ];
    },
  },
  {
    id: 'm2', name: 'Ночной рейд', place: 'Промзона «Северсталь»', region: 'industrial', lighting: 'night', seed: 4242,
    marker: { x: LAYOUT.industrial.x - 190, z: LAYOUT.industrial.z }, requires: { ew: 1, sensors: 1 }, reward: 3500,
    briefing: 'Крост прячет зенитные комплексы в цехах промзоны и ночью гонит конвой с ракетами на авиабазу. Наш разведчик сбит над складами. Без тепловизора и ловушек туда лучше не соваться.',
    goals: ['Уничтожить 3 пусковые ЗРК', 'Перехватить конвой из 3 грузовиков', 'Эвакуировать сбитого пилота'],
    setup(game, M) {
      const S = game.world.sites.industrial;
      const sams = [];
      for (let i = 0; i < 3; i++) {
        M.sandbags(S[i], 7);
        sams.push(spawnEnemy(game, 'sam', S[i].x, S[i].z));
        M.guards(S[i], ['soldier', 'aa', 'rpg'], 13);
      }
      const trucks = [];
      for (let i = 0; i < 3; i++) trucks.push(spawnEnemy(game, 'truck', 470, 150 - i * 6));
      spawnEnemy(game, 'jeep', 470, 140, { patrol: true });
      const c = S[3] || { x: 600, z: 420 };
      const wreck = createWreckHeli();
      wreck.group.position.set(c.x + 5, game.world.heightAt(c.x, c.z), c.z);
      game.scene.add(wreck.group);
      game.fx.addFire(c.x + 5, wreck.group.position.y + 1, c.z, 9999, 1.1);
      const pilot = game.addRescuee(c.x - 3, c.z + 2, 'pilot');
      M.guards(c, ['soldier', 'soldier', 'rpg', 'tank'], 16);
      return [
        new DestroyObjective('Уничтожь пусковые ЗРК', sams),
        new DestroyObjective('Перехвати конвой с ракетами', trucks),
        new RescueObjective('Эвакуируй сбитого пилота на базу', [pilot], 1),
      ];
    },
  },
  {
    id: 'm3', name: 'Горный перевал', place: 'Хребет Ястреба', region: 'mountains', lighting: 'sunset', seed: 777,
    marker: { x: LAYOUT.villages[2].x + 60, z: LAYOUT.villages[2].z + 120 }, requires: { engine: 1, armor: 1 }, reward: 4000,
    briefing: 'В горах Крост поставил ретрансляторы, через которые наводит свою ПВО. Деревня Верхний Брод взята в заложники. Слабым двигателям не вытянуть по склонам, лёгкая броня не выдержит перекрёстный огонь.',
    goals: ['Взорвать 3 ретранслятора на вершинах', 'Вывезти 6 жителей Верхнего Брода', 'Подавить 2 горные позиции ЗРК'],
    setup(game, M) {
      const peaks = game.world.sites.mountains;
      const relays = [];
      for (let i = 0; i < 3; i++) {
        const p = peaks[i];
        const r = spawnEnemy(game, 'radar', p.x, p.z);
        r.label = 'Ретранслятор';
        relays.push(r);
        M.guards(p, ['soldier', 'rpg', 'aa'], 11);
      }
      const v = LAYOUT.villages[2];
      const people = [];
      for (let i = 0; i < 6; i++) people.push(game.addRescuee(v.x + (i % 3) * 5 - 5, v.z + Math.floor(i / 3) * 6 + 4, 'civilian'));
      M.guards(v, ['soldier', 'soldier', 'soldier', 'rpg', 'jeep'], 24);
      const nests = [peaks[3] || peaks[0], peaks[4] || peaks[1]].map((p) => {
        M.sandbags(p, 7);
        M.guards(p, ['aa', 'soldier'], 12);
        return spawnEnemy(game, 'sam', p.x + 4, p.z + 4);
      });
      return [
        new DestroyObjective('Взорви ретрансляторы на вершинах', relays),
        new RescueObjective('Вывези жителей Верхнего Брода', people, 6),
        new DestroyObjective('Подави горные позиции ЗРК', nests),
      ];
    },
  },
  {
    id: 'm4', name: 'Удар по авиабазе', place: 'Авиабаза Кроста', region: 'airbase', lighting: 'day', seed: 5150,
    marker: { x: LAYOUT.airbase.x - 360, z: LAYOUT.airbase.z }, requires: { hellfire: 1, ew: 2 }, reward: 5000,
    briefing: 'Авиабаза прикрыта дальнобойными комплексами — без станции помех туда не долететь. Сожги истребители на стоянке, пока они не взлетели, и сбей вертолёты охраны.',
    goals: ['Уничтожить 6 истребителей на стоянке', 'Сбить 2 вертолёта охраны', 'Уничтожить радар аэродрома'],
    setup(game, M) {
      const jets = game.world.jetSpots.map((s) => spawnEnemy(game, 'jet', s.x, s.z, { rot: s.rot }));
      const A = LAYOUT.airbase;
      const helis = [spawnEnemy(game, 'heli', A.x - 120, A.z + 40), spawnEnemy(game, 'heli', A.x + 150, A.z - 60)];
      const radar = spawnEnemy(game, 'radar', A.x - 250, A.z + 45);
      radar.label = 'Радар аэродрома';
      M.guards({ x: A.x, z: A.z + 20 }, ['tank', 'aa', 'aa', 'soldier', 'soldier', 'rpg', 'tank'], 60);
      return [
        new DestroyObjective('Сожги истребители на стоянке', jets),
        new DestroyObjective('Сбей вертолёты охраны', helis),
        new DestroyObjective('Уничтожь радар аэродрома', [radar]),
      ];
    },
  },
  {
    id: 'm5', name: 'Голиаф', place: 'Авиабаза Кроста', region: 'airbase', lighting: 'sunset', seed: 9001,
    marker: { x: LAYOUT.airbase.x, z: LAYOUT.airbase.z + 200 }, requires: { armor: 2, hellfire: 1 }, reward: 8000,
    briefing: 'Крост выводит «Голиаф» — бронированную ракетную крепость. Её щит питают генераторы у ангаров. Обесточь их и разбери крепость по частям: турели, пусковую, ядро.',
    goals: ['Уничтожить 3 генератора щита', 'Уничтожить крепость «Голиаф»'],
    setup(game, M) {
      const sites = game.world.sites.airbase;
      const gens = [sites[0], sites[2], sites[3]].map((p) => spawnEnemy(game, 'generator', p.x, p.z - 10));
      for (const p of [sites[0], sites[2]]) M.guards(p, ['aa', 'soldier', 'rpg'], 14);
      const A = LAYOUT.airbase;
      const boss = spawnEnemy(game, 'boss', A.x, A.z + 125);
      return [
        new DestroyObjective('Уничтожь генераторы щита', gens),
        new DestroyObjective('Уничтожь крепость «Голиаф»', [boss], { boss: true }),
      ];
    },
  },
];

export { Rescuee, createRadar };

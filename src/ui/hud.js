import * as THREE from 'three';
import { CAM_YAW } from '../game/player.js';

const $ = (s) => document.querySelector(s);
const _v = new THREE.Vector3();

export class HUD {
  constructor() {
    this.el = {
      root: $('#hud'),
      armor: $('#bar-armor .fill'),
      fuel: $('#bar-fuel .fill'),
      armorBar: $('#bar-armor'),
      fuelBar: $('#bar-fuel'),
      score: $('#hud-score'),
      lives: $('#hud-lives'),
      combo: $('#hud-combo'),
      objText: $('#obj-text'),
      objProg: $('#obj-progress'),
      toasts: $('#toasts'),
      boss: $('#boss-bar'),
      bossFill: $('#boss-bar .fill'),
      bossName: $('#boss-name'),
      missile: $('#missile-warn'),
      arrow: $('#obj-arrow'),
      arrowDist: $('#obj-arrow .dist'),
      marker: $('#obj-marker'),
      vignette: $('#damage-vignette'),
      pax: $('#passengers'),
      ammoGun: $('[data-ammo=gun]'),
      ammoHydra: $('[data-ammo=hydra]'),
      ammoHellfire: $('[data-ammo=hellfire]'),
      ammoFlare: $('[data-ammo=flare]'),
      floaters: $('#floaters'),
      winch: $('#winch-hint'),
      base: $('#base-hint'),
      tbar: $('#target-bar'),
      tname: $('#target-bar .tname'),
      tfill: $('#target-bar .fill'),
    };
    this.radar = $('#radar');
    this.rctx = this.radar.getContext('2d');
    this.cache = {};
    this.frame = 0;
    this.floaters = [];
    this.dmg = 0;
  }

  set(key, el, value, fn) {
    if (this.cache[key] === value) return;
    this.cache[key] = value;
    fn(el, value);
  }

  reset() {
    this.cache = {};
    this.el.toasts.innerHTML = '';
    this.el.floaters.innerHTML = '';
    this.floaters = [];
    this.el.boss.classList.remove('show');
    this.dmg = 0;
  }

  toast(text, type = 'info', ms = 2200) {
    const t = document.createElement('div');
    t.className = 'toast ' + type;
    t.textContent = text;
    this.el.toasts.prepend(t);
    while (this.el.toasts.children.length > 3) this.el.toasts.lastChild.remove();
    setTimeout(() => t.classList.add('out'), ms);
    setTimeout(() => t.remove(), ms + 400);
  }

  flashDamage(dmg) {
    this.dmg = Math.min(1, this.dmg + dmg / 25 + 0.15);
  }

  floater(text, pos, cls = '') {
    if (this.floaters.length > 14) this.floaters.shift().el.remove();
    const el = document.createElement('div');
    el.className = 'floater ' + cls;
    el.textContent = text;
    this.el.floaters.appendChild(el);
    this.floaters.push({ el, pos: pos.clone(), t: 0 });
  }

  update(dt, game) {
    const p = game.player;
    const e = this.el;
    this.frame++;
    this.set('armor', e.armor, Math.round((p.armor / p.maxArmor) * 100), (el, v) => {
      el.style.transform = `scaleX(${v / 100})`;
      e.armorBar.classList.toggle('low', v < 25);
    });
    this.set('fuel', e.fuel, Math.round(p.fuel), (el, v) => {
      el.style.transform = `scaleX(${v / 100})`;
      e.fuelBar.classList.toggle('low', v < 25);
    });
    this.set('score', e.score, game.score, (el, v) => (el.textContent = v.toLocaleString('ru-RU')));
    this.set('lives', e.lives, game.lives, (el, v) => (el.textContent = '🚁'.repeat(Math.max(v, 0))));
    this.set('combo', e.combo, game.combo > 1 ? game.combo : 0, (el, v) => {
      el.textContent = v ? `КОМБО ×${v}` : '';
      el.classList.toggle('show', !!v);
      if (v) {
        el.classList.remove('pop');
        void el.offsetWidth;
        el.classList.add('pop');
      }
    });
    this.set('ag', e.ammoGun, Math.floor(p.ammo.gun), (el, v) => (el.textContent = v));
    this.set('ah', e.ammoHydra, p.ammo.hydra, (el, v) => (el.textContent = v));
    this.set('af', e.ammoHellfire, p.ammo.hellfire, (el, v) => (el.textContent = v));
    this.set('afl', e.ammoFlare, p.flares, (el, v) => (el.textContent = v));
    this.set('pax', e.pax, p.passengers.length + '/' + p.capacity, (el, v) => {
      el.textContent = '👤 ' + v;
      el.classList.toggle('show', p.passengers.length > 0);
    });

    const obj = game.mission?.current();
    this.set('objT', e.objText, obj ? obj.text : '', (el, v) => (el.textContent = v));
    this.set('objP', e.objProg, obj ? obj.progressText() : '', (el, v) => (el.textContent = v));

    const boss = game.boss && game.boss.alive && game.bossVisible;
    this.set('boss', e.boss, boss ? Math.round(game.boss.totalHp() * 100) : -1, (el, v) => {
      el.classList.toggle('show', v >= 0);
      if (v >= 0) {
        e.bossFill.style.transform = `scaleX(${v / 100})`;
        e.bossName.textContent = game.boss.label;
      }
    });

    const incoming = game.projectiles.incomingMissiles();
    this.set('missile', e.missile, incoming > 0, (el, v) => el.classList.toggle('show', v));
    if (incoming > 0 && this.frame % 20 === 0) game.audio.play('lock');

    const w = p.winch;
    this.set('winch', e.winch, w ? (w.target.kind === 'pickup' ? 'Подъём груза…' : 'Подъём человека… держись ровно!') : '', (el, v) => {
      el.textContent = v;
      el.classList.toggle('show', !!v);
    });
    this.set('base', e.base, p.atBase ? (p.passengers.length ? 'Высадка пассажиров…' : 'База: дозаправка') : '', (el, v) => {
      el.textContent = v;
      el.classList.toggle('show', !!v);
    });

    this.dmg = Math.max(0, this.dmg - dt * 1.6);
    const lowArmor = p.armor / p.maxArmor < 0.25 && p.alive ? 0.35 + Math.sin(game.time * 6) * 0.15 : 0;
    e.vignette.style.opacity = Math.max(this.dmg, lowArmor).toFixed(2);

    this.updateTargetBar(game);
    this.updateArrow(game, obj);
    this.updateFloaters(dt, game);
    if (this.frame % 3 === 0) this.drawRadar(game, obj);
  }

  updateArrow(game, obj) {
    const e = this.el;
    const target = obj && obj.targetPos();
    if (!target || game.player.state !== 'fly') {
      e.arrow.style.display = 'none';
      e.marker.style.display = 'none';
      return;
    }
    const cam = game.camera;
    _v.set(target.x, target.y ?? 4, target.z).project(cam);
    const W = window.innerWidth, H = window.innerHeight;
    const onScreen = _v.z < 1 && Math.abs(_v.x) < 0.92 && Math.abs(_v.y) < 0.88;
    if (onScreen) {
      e.arrow.style.display = 'none';
      e.marker.style.display = 'block';
      e.marker.style.transform = `translate(${((_v.x + 1) / 2) * W}px, ${((1 - _v.y) / 2) * H}px)`;
    } else {
      e.marker.style.display = 'none';
      e.arrow.style.display = 'flex';
      let x = _v.x, y = _v.y;
      if (_v.z > 1) {
        x = -x;
        y = -y;
      }
      const ang = Math.atan2(-y, x);
      const mx = W / 2 - 46, my = H / 2 - 56;
      const k = Math.min(mx / Math.abs(Math.cos(ang) || 1e-3), my / Math.abs(Math.sin(ang) || 1e-3));
      const sx = W / 2 + Math.cos(ang) * k, sy = H / 2 + Math.sin(ang) * k;
      e.arrow.style.transform = `translate(${sx}px, ${sy}px)`;
      e.arrow.firstElementChild.style.transform = `rotate(${ang}rad)`;
      const d = Math.round(Math.hypot(target.x - game.player.pos.x, target.z - game.player.pos.z));
      if (this.cache.dist !== d) {
        this.cache.dist = d;
        e.arrowDist.textContent = d + ' м';
      }
    }
  }

  // Полоска здоровья над целью автоприцела (пехоте не нужна — она падает с пары пуль).
  updateTargetBar(game) {
    const e = this.el;
    const t = game.player.target;
    if (!t || !t.alive || t.maxHp <= 10 || game.player.state !== 'fly') {
      if (this.cache.tbar !== false) {
        this.cache.tbar = false;
        e.tbar.style.display = 'none';
      }
      return;
    }
    const c = t.aimPoint();
    _v.set(c.x, c.y, c.z).project(game.camera);
    if (_v.z > 1) return;
    if (this.cache.tbar !== true) {
      this.cache.tbar = true;
      e.tbar.style.display = 'flex';
    }
    const x = ((_v.x + 1) / 2) * window.innerWidth, y = ((1 - _v.y) / 2) * window.innerHeight;
    e.tbar.style.transform = `translate(${x}px, ${y + 28}px)`;
    e.tfill.style.transform = `scaleX(${Math.max(t.hp, 0) / t.maxHp})`;
    if (this.cache.tname !== t) {
      this.cache.tname = t;
      e.tname.textContent = t.label || '';
    }
  }

  updateFloaters(dt, game) {
    const W = window.innerWidth, H = window.innerHeight;
    for (let i = this.floaters.length - 1; i >= 0; i--) {
      const f = this.floaters[i];
      f.t += dt;
      if (f.t > 1.2) {
        f.el.remove();
        this.floaters.splice(i, 1);
        continue;
      }
      _v.copy(f.pos).project(game.camera);
      const x = ((_v.x + 1) / 2) * W, y = ((1 - _v.y) / 2) * H - f.t * 60;
      f.el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%) scale(${1 + Math.max(0, 0.3 - f.t)})`;
      f.el.style.opacity = f.t > 0.8 ? (1.2 - f.t) / 0.4 : 1;
    }
  }

  drawRadar(game, obj) {
    const c = this.radar;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const size = c.clientWidth;
    if (c.width !== Math.round(size * dpr)) {
      c.width = c.height = Math.round(size * dpr);
    }
    const g = this.rctx;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const R = size / 2;
    g.clearRect(0, 0, size, size);
    g.save();
    g.beginPath();
    g.arc(R, R, R - 1, 0, Math.PI * 2);
    g.clip();
    g.fillStyle = 'rgba(8,24,18,0.72)';
    g.fillRect(0, 0, size, size);
    g.strokeStyle = 'rgba(120,255,170,0.18)';
    g.lineWidth = 1;
    for (const r of [0.33, 0.66]) {
      g.beginPath();
      g.arc(R, R, R * r, 0, Math.PI * 2);
      g.stroke();
    }
    const sweep = (game.time * 2) % (Math.PI * 2);
    const grad = g.createConicGradient ? g.createConicGradient(sweep, R, R) : null;
    if (grad) {
      grad.addColorStop(0, 'rgba(120,255,170,0.25)');
      grad.addColorStop(0.12, 'rgba(120,255,170,0)');
      grad.addColorStop(1, 'rgba(120,255,170,0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, size, size);
    }
    const p = game.player.pos;
    const range = 170;
    const s = Math.sin(CAM_YAW), co = Math.cos(CAM_YAW);
    const map = (x, z) => {
      const dx = x - p.x, dz = z - p.z;
      const right = dx * co - dz * s;
      const up = -dx * s - dz * co;
      return [R + (right / range) * R, R - (up / range) * R];
    };
    const dot = (x, z, color, r = 2.5, clampEdge = false) => {
      let [sx, sy] = map(x, z);
      const ddx = sx - R, ddy = sy - R, dd = Math.hypot(ddx, ddy);
      if (dd > R - 4) {
        if (!clampEdge) return;
        sx = R + (ddx / dd) * (R - 5);
        sy = R + (ddy / dd) * (R - 5);
      }
      g.fillStyle = color;
      g.beginPath();
      g.arc(sx, sy, r, 0, Math.PI * 2);
      g.fill();
    };
    // контур острова
    g.strokeStyle = 'rgba(240,217,160,0.35)';
    g.lineWidth = 1.5;
    g.beginPath();
    const L = 268;
    const corners = [[-L, -L], [L, -L], [L, L], [-L, L]];
    corners.forEach(([x, z], i) => {
      const [sx, sy] = map(x, z);
      if (i === 0) g.moveTo(sx, sy);
      else g.lineTo(sx, sy);
    });
    g.closePath();
    g.stroke();
    for (const it of game.winchables) if (it.alive && !it.attached) dot(it.pos.x, it.pos.z, it.radarColor, 2.2);
    for (const e of game.enemies) if (e.alive) dot(e.pos.x, e.pos.z, e.tag ? '#ffd34d' : e.radarColor, e.tag ? 3.2 : 2);
    const b = game.world.base;
    {
      const [sx, sy] = map(b.x, b.z);
      g.strokeStyle = '#55e0ff';
      g.lineWidth = 2;
      g.strokeRect(sx - 4, sy - 4, 8, 8);
    }
    const target = obj && obj.targetPos();
    if (target && Math.sin(game.time * 8) > -0.3) dot(target.x, target.z, '#ffe14d', 4.2, true);
    g.restore();
    // игрок
    g.save();
    g.translate(R, R);
    const yaw = game.player.yaw;
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    const right = fx * co - fz * s, up = -fx * s - fz * co;
    g.rotate(Math.atan2(right, up));
    g.fillStyle = '#7dff9a';
    g.beginPath();
    g.moveTo(0, -6);
    g.lineTo(4.5, 5);
    g.lineTo(-4.5, 5);
    g.closePath();
    g.fill();
    g.restore();
  }
}

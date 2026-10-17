// Управление: виртуальный стик + кнопки (тач), клавиатура, геймпад.
export class Input {
  constructor(root) {
    this.move = { x: 0, y: 0 };
    this.held = { gun: false, hydra: false, hellfire: false, flare: false };
    this.pressed = { hellfire: false, flare: false, pause: false, map: false };
    this.keys = new Set();
    this.stick = { id: null, ox: 0, oy: 0, x: 0, y: 0 };
    this.enabled = true;

    const zone = root.querySelector('#stick-zone');
    this.base = root.querySelector('#stick-base');
    this.knob = root.querySelector('#stick-knob');
    zone.addEventListener('pointerdown', (e) => {
      if (this.stick.id !== null) return;
      zone.setPointerCapture(e.pointerId);
      this.stick = { id: e.pointerId, ox: e.clientX, oy: e.clientY, x: 0, y: 0 };
      this.base.style.left = e.clientX + 'px';
      this.base.style.top = e.clientY + 'px';
      this.base.classList.add('active');
      root.classList.add('used');
      this.knob.style.transform = 'translate(-50%, -50%)';
    });
    zone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.stick.id) return;
      const R = 56;
      let dx = e.clientX - this.stick.ox, dy = e.clientY - this.stick.oy;
      const d = Math.hypot(dx, dy);
      if (d > R) {
        // плавающий стик: центр подтягивается за пальцем
        this.stick.ox += (dx / d) * (d - R);
        this.stick.oy += (dy / d) * (d - R);
        this.base.style.left = this.stick.ox + 'px';
        this.base.style.top = this.stick.oy + 'px';
        dx = (dx / d) * R;
        dy = (dy / d) * R;
      }
      this.stick.x = dx / R;
      this.stick.y = -dy / R;
      this.knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    });
    const end = (e) => {
      if (e.pointerId !== this.stick.id) return;
      this.stick = { id: null, ox: 0, oy: 0, x: 0, y: 0 };
      this.base.classList.remove('active');
    };
    zone.addEventListener('pointerup', end);
    zone.addEventListener('pointercancel', end);

    for (const btn of root.querySelectorAll('[data-btn]')) {
      const name = btn.dataset.btn;
      btn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        btn.setPointerCapture(e.pointerId);
        btn.classList.add('down');
        this.held[name] = true;
        if (name in this.pressed) this.pressed[name] = true;
      });
      const up = () => {
        btn.classList.remove('down');
        this.held[name] = false;
      };
      btn.addEventListener('pointerup', up);
      btn.addEventListener('pointercancel', up);
      btn.addEventListener('lostpointercapture', up);
      btn.addEventListener('contextmenu', (e) => e.preventDefault());
    }

    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      if (e.code === 'KeyE' || e.code === 'KeyK') this.pressed.hellfire = true;
      if (e.code === 'KeyF' || e.code === 'KeyL') this.pressed.flare = true;
      if (e.code === 'Escape' || e.code === 'KeyP') this.pressed.pause = true;
      if (e.code === 'KeyM' || e.code === 'Tab') {
        this.pressed.map = true;
        e.preventDefault();
      }
      if (e.code === 'Space') e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    this.padPrev = {};
  }

  poll() {
    const k = this.keys;
    let x = this.stick.x, y = this.stick.y;
    if (k.has('KeyA') || k.has('ArrowLeft')) x -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) x += 1;
    if (k.has('KeyW') || k.has('ArrowUp')) y += 1;
    if (k.has('KeyS') || k.has('ArrowDown')) y -= 1;
    let gun = this.held.gun || k.has('Space') || k.has('KeyJ');
    let hydra = this.held.hydra || k.has('ShiftLeft') || k.has('KeyQ') || k.has('KeyH');

    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) {
      if (!p) continue;
      const ax = p.axes[0] || 0, ay = p.axes[1] || 0;
      if (Math.hypot(ax, ay) > 0.18) {
        x += ax;
        y -= ay;
      }
      const b = (i) => !!(p.buttons[i] && p.buttons[i].pressed);
      gun ||= b(0) || b(7);
      hydra ||= b(2) || b(6);
      const edge = (i, name) => {
        if (b(i) && !this.padPrev[i]) this.pressed[name] = true;
        this.padPrev[i] = b(i);
      };
      edge(1, 'hellfire');
      edge(3, 'flare');
      edge(9, 'pause');
      edge(8, 'map');
      break;
    }
    const m = Math.hypot(x, y);
    if (m > 1) {
      x /= m;
      y /= m;
    }
    const dead = 0.1;
    if (m < dead) x = y = 0;
    const out = {
      move: { x, y },
      gun: this.enabled && gun,
      hydra: this.enabled && hydra,
      hellfirePressed: this.enabled && this.pressed.hellfire,
      flarePressed: this.enabled && this.pressed.flare,
      pausePressed: this.pressed.pause,
      mapPressed: this.pressed.map,
    };
    if (!this.enabled) out.move = { x: 0, y: 0 };
    this.pressed.hellfire = this.pressed.flare = this.pressed.pause = this.pressed.map = false;
    return out;
  }

  reset() {
    this.stick = { id: null, ox: 0, oy: 0, x: 0, y: 0 };
    this.base.classList.remove('active');
    for (const k in this.held) this.held[k] = false;
    this.keys.clear();
  }
}

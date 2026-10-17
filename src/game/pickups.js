import { createPickup } from './models.js';

export class Pickup {
  constructor(game, type, x, z) {
    this.game = game;
    this.kind = 'pickup';
    this.type = type;
    this.model = createPickup(type);
    this.obj = this.model.group;
    this.obj.position.set(x, 0, z);
    this.pos = this.obj.position.clone();
    this.alive = true;
    this.attached = false;
    this.t = Math.random() * 6;
    this.liftHeight = 1;
    this.radarColor = { fuel: '#ff7a45', ammo: '#ffd34d', armor: '#4dff9a' }[type];
    game.scene.add(this.obj);
  }
  update(dt) {
    if (this.attached) {
      this.model.inner.rotation.y += dt * 4;
      return;
    }
    this.t += dt;
    this.model.inner.position.y = 1.6 + Math.sin(this.t * 2.5) * 0.35;
    this.model.inner.rotation.y += dt * 1.5;
    this.model.ring.scale.setScalar(1 + Math.sin(this.t * 4) * 0.12);
  }
}

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { toon, glow, G } from './materials.js';
import { colored } from './props.js';

// Все модели собраны из примитивов: мультяшный low-poly стиль, без внешних ассетов.
// Передняя часть каждой модели смотрит в +Z.

function add(parent, geo, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}

export function enableShadows(obj, cast = true, receive = true) {
  obj.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = cast && !o.userData.noShadow;
      o.receiveShadow = receive;
    }
  });
  return obj;
}

const ENEMY = { main: 0xc9a35b, dark: 0x5b4a33, accent: 0xd8463c, metal: 0x3b3f46 };

export function createHeli(scheme = 'player') {
  const c =
    scheme === 'player'
      ? { body: 0x5c8f3c, accent: 0xf2c94c, dark: 0x2c3a26, glass: 0x8fe3ff, blade: 0x262b2f }
      : { body: 0x7a6f66, accent: ENEMY.accent, dark: 0x34302d, glass: 0xffc27a, blade: 0x221f1d };
  const g = new THREE.Group();
  const body = add(g, G.sphere(1, 18, 12), toon(c.body), 0, 0, 0.2);
  body.scale.set(1.25, 1.1, 2.15);
  const glass = add(g, G.sphere(1, 16, 10), toon(c.glass, { emissive: c.glass, emissiveIntensity: 0.15 }), 0, 0.38, 1.45);
  glass.scale.set(0.95, 0.78, 1.0);
  const stripe = add(g, G.box(2.0, 0.22, 3.4), toon(c.accent), 0, -0.82, 0.1);
  stripe.userData.noShadow = true;
  const boom = add(g, G.cyl(0.18, 0.46, 4.8, 10), toon(c.body), 0, 0.25, -3.5);
  boom.rotation.x = -Math.PI / 2;
  add(g, G.box(0.16, 1.7, 1.05), toon(c.accent), 0, 0.95, -5.7).rotation.x = -0.25;
  add(g, G.box(2.0, 0.1, 0.62), toon(c.dark), 0, 0.32, -5.0);
  const tailRotor = new THREE.Group();
  tailRotor.position.set(0.24, 1.05, -5.85);
  add(tailRotor, G.box(0.06, 1.7, 0.2), toon(c.blade));
  add(tailRotor, G.box(0.06, 0.2, 1.7), toon(c.blade));
  g.add(tailRotor);
  for (const s of [-1, 1]) {
    add(g, G.box(0.14, 0.14, 4.3), toon(c.dark), s * 1.08, -1.5, 0.2);
    add(g, G.box(0.1, 0.65, 0.1), toon(c.dark), s * 0.98, -1.15, 1.2);
    add(g, G.box(0.1, 0.65, 0.1), toon(c.dark), s * 0.98, -1.15, -0.8);
    const pod = add(g, G.cyl(0.3, 0.3, 1.6, 10), toon(c.dark), s * 1.85, -0.45, 0.2);
    pod.rotation.x = Math.PI / 2;
    add(g, G.sphere(0.12, 6, 4), glow(s < 0 ? 0xff3b3b : 0x3bff6a), s * 2.15, -0.2, 0.0).userData.noShadow = true;
  }
  add(g, G.box(3.8, 0.14, 0.75), toon(c.dark), 0, -0.25, 0.1);
  add(g, G.sphere(0.32, 10, 8), toon(c.dark), 0, -0.78, 2.0);
  add(g, G.box(0.09, 0.09, 1.0), toon(c.blade), 0, -0.85, 2.55);
  add(g, G.cyl(0.13, 0.17, 0.6, 8), toon(c.dark), 0, 1.25, 0.2);
  const rotor = new THREE.Group();
  rotor.position.set(0, 1.58, 0.2);
  add(rotor, G.sphere(0.28, 10, 8), toon(c.dark));
  add(rotor, G.box(0.38, 0.06, 7.6), toon(c.blade));
  add(rotor, G.box(7.6, 0.06, 0.38), toon(c.blade));
  g.add(rotor);
  const disc = add(
    g,
    G.custom('rotorDisc', () => new THREE.CircleGeometry(3.8, 32)),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.1, depthWrite: false }),
    0,
    1.6,
    0.2
  );
  disc.rotation.x = -Math.PI / 2;
  disc.userData.noShadow = true;
  const beacon = add(g, G.sphere(0.15, 6, 4), glow(0xff2a2a), 0, 1.8, -5.6);
  beacon.userData.noShadow = true;

  const nose = new THREE.Object3D();
  nose.position.set(0, -0.85, 3.0);
  g.add(nose);
  const podL = new THREE.Object3D();
  podL.position.set(-1.85, -0.45, 1.1);
  const podR = new THREE.Object3D();
  podR.position.set(1.85, -0.45, 1.1);
  g.add(podL, podR);
  enableShadows(g, true, false);
  return { group: g, rotor, tailRotor, disc, beacon, nose, podL, podR };
}

// Человек: туловище, голова и снаряжение слиты в один меш (меньше вызовов отрисовки),
// руки отдельно — ими машут заложники.
export function createPerson(kind = 'rifle') {
  const g = new THREE.Group();
  const colors = {
    rifle: { body: 0x7a6a46, legs: 0x4b4232, hat: 0x5b5a3e },
    rpg: { body: 0x6f6040, legs: 0x463d2c, hat: 0x8a3a30 },
    hostage: { body: 0xe9e4d8, legs: 0x3b5b8f, hat: null },
    pilot: { body: 0xd8762a, legs: 0xb8601e, hat: 0xe8e8e8 },
    civilian: { body: 0x4f86b8, legs: 0x334155, hat: null },
  }[kind];
  const inner = new THREE.Group();
  g.add(inner);
  const geo = G.custom('person-' + kind, () => {
    const parts = [];
    const put = (geom, color, x, y, z, rx = 0) => {
      const c = geom.clone();
      if (rx) c.rotateX(rx);
      c.translate(x, y, z);
      parts.push(colored(c, color));
    };
    put(new THREE.CylinderGeometry(0.42, 0.5, 1.3, 8), colors.body, 0, 1.05, 0);
    put(new THREE.SphereGeometry(0.38, 10, 8), 0xe0b08a, 0, 2.0, 0);
    if (colors.hat) put(new THREE.SphereGeometry(0.43, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), colors.hat, 0, 2.08, 0);
    else put(new THREE.SphereGeometry(0.4, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2.4), 0x4a3020, 0, 2.08, -0.03);
    put(new THREE.BoxGeometry(0.28, 0.7, 0.3), colors.legs, -0.2, 0.35, 0);
    put(new THREE.BoxGeometry(0.28, 0.7, 0.3), colors.legs, 0.2, 0.35, 0);
    if (kind === 'rifle') put(new THREE.BoxGeometry(0.12, 0.14, 1.2), 0x1e1e1e, 0.3, 1.25, 0.5);
    if (kind === 'rpg') {
      put(new THREE.CylinderGeometry(0.16, 0.16, 1.8, 8), 0x3d4a2a, 0.45, 2.05, 0.1, Math.PI / 2);
      put(new THREE.ConeGeometry(0.24, 0.5, 8), ENEMY.accent, 0.45, 2.05, 1.1, Math.PI / 2);
    }
    return mergeGeometries(parts);
  });
  const mat = toon(0xffffff, { vertexColors: true, roughness: 0.85 });
  inner.add(new THREE.Mesh(geo, mat));
  const arms = [];
  for (const sx of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(sx * 0.56, 1.6, 0);
    add(pivot, G.box(0.22, 0.8, 0.22), toon(colors.body), 0, -0.4, 0);
    inner.add(pivot);
    arms.push(pivot);
  }
  if (kind === 'rifle') {
    arms[0].rotation.x = -1.1;
    arms[1].rotation.x = -1.1;
  } else if (kind === 'rpg') arms[1].rotation.x = -2.6;
  g.scale.setScalar(1.35);
  enableShadows(g);
  return { group: g, inner, arms };
}

export function createTank() {
  const g = new THREE.Group();
  add(g, G.box(4.2, 1.3, 6.0), toon(ENEMY.main), 0, 1.1, 0);
  add(g, G.box(3.6, 0.5, 1.2), toon(ENEMY.main), 0, 1.25, 3.3).rotation.x = 0.5;
  for (const s of [-1, 1]) {
    add(g, G.box(1.15, 1.25, 6.5), toon(0x34302d), s * 2.25, 0.65, 0);
    for (let i = -2; i <= 2; i++) {
      const w = add(g, G.cyl(0.5, 0.5, 1.2, 10), toon(0x55504a), s * 2.25, 0.5, i * 1.25);
      w.rotation.z = Math.PI / 2;
    }
  }
  const turret = new THREE.Group();
  turret.position.set(0, 2.0, -0.3);
  add(turret, G.cyl(1.5, 1.75, 1.0, 10), toon(ENEMY.main));
  add(turret, G.box(0.9, 0.5, 0.9), toon(ENEMY.dark), 0.6, 0.6, -0.5);
  const barrel = add(turret, G.cyl(0.18, 0.22, 4.2, 8), toon(ENEMY.metal), 0, 0.1, 2.5);
  barrel.rotation.x = Math.PI / 2;
  add(turret, G.box(0.6, 0.12, 0.6), toon(ENEMY.accent), -0.5, 0.56, -0.3);
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.1, 4.7);
  turret.add(muzzle);
  g.add(turret);
  enableShadows(g);
  return { group: g, turret, muzzle };
}

export function createJeep() {
  const g = new THREE.Group();
  add(g, G.box(2.4, 0.9, 4.2), toon(ENEMY.main), 0, 1.0, 0);
  add(g, G.box(2.3, 0.5, 1.4), toon(ENEMY.dark), 0, 1.4, 1.3);
  add(g, G.box(2.2, 0.1, 0.1), toon(0x222222), 0, 1.95, 0.6);
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) {
      const w = add(g, G.cyl(0.5, 0.5, 0.45, 10), toon(0x262626), sx * 1.25, 0.5, sz * 1.4);
      w.rotation.z = Math.PI / 2;
    }
  const turret = new THREE.Group();
  turret.position.set(0, 1.5, -0.8);
  add(turret, G.cyl(0.12, 0.12, 0.8, 6), toon(0x333333), 0, 0.3, 0);
  add(turret, G.box(0.25, 0.25, 1.5), toon(0x2a2a2a), 0, 0.75, 0.5);
  add(turret, G.box(0.9, 0.6, 0.12), toon(ENEMY.dark), 0, 0.75, 0.0);
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.75, 1.3);
  turret.add(muzzle);
  g.add(turret);
  enableShadows(g);
  return { group: g, turret, muzzle };
}

export function createTruck() {
  const g = new THREE.Group();
  add(g, G.box(2.6, 2.0, 2.2), toon(ENEMY.main), 0, 1.6, 2.6);
  add(g, G.box(2.3, 0.8, 0.12), toon(0x9fd8ff), 0, 2.0, 3.72).userData.noShadow = true;
  add(g, G.box(2.8, 2.7, 4.8), toon(0x6c7550), 0, 2.0, -1.2);
  add(g, G.box(2.7, 0.5, 7.4), toon(0x34302d), 0, 0.75, 0.2);
  for (const sx of [-1, 1])
    for (const sz of [-2.6, -0.8, 2.6]) {
      const w = add(g, G.cyl(0.6, 0.6, 0.5, 10), toon(0x262626), sx * 1.35, 0.6, sz);
      w.rotation.z = Math.PI / 2;
    }
  enableShadows(g);
  return { group: g };
}

export function createAAGun() {
  const g = new THREE.Group();
  add(g, G.cyl(2.4, 2.8, 0.9, 10), toon(0x8a8478), 0, 0.45, 0);
  const sand = add(g, G.torus(3.3, 0.55, 6, 14), toon(0xd8c08a), 0, 0.35, 0);
  sand.rotation.x = Math.PI / 2;
  sand.scale.z = 0.7;
  const turret = new THREE.Group();
  turret.position.set(0, 1.2, 0);
  add(turret, G.box(2.0, 1.1, 2.2), toon(ENEMY.main), 0, 0.5, 0);
  const guns = new THREE.Group();
  guns.position.set(0, 0.9, 0.4);
  for (const s of [-1, 1]) {
    const b = add(guns, G.cyl(0.12, 0.16, 3.4, 6), toon(ENEMY.metal), s * 0.45, 0, 1.6);
    b.rotation.x = Math.PI / 2;
  }
  guns.rotation.x = -0.75;
  turret.add(guns);
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0, 3.4);
  guns.add(muzzle);
  g.add(turret);
  enableShadows(g);
  return { group: g, turret, guns, muzzle };
}

export function createSAM() {
  const g = new THREE.Group();
  add(g, G.box(3.0, 1.2, 5.6), toon(ENEMY.main), 0, 1.0, 0);
  add(g, G.box(2.6, 1.0, 1.6), toon(ENEMY.dark), 0, 2.0, 2.0);
  for (const sx of [-1, 1])
    for (const sz of [-1.8, 0, 1.8]) {
      const w = add(g, G.cyl(0.55, 0.55, 0.45, 10), toon(0x262626), sx * 1.5, 0.55, sz);
      w.rotation.z = Math.PI / 2;
    }
  const turret = new THREE.Group();
  turret.position.set(0, 1.8, -0.8);
  const rail = new THREE.Group();
  rail.rotation.x = -0.6;
  add(rail, G.box(2.4, 0.3, 3.6), toon(ENEMY.metal));
  const missiles = [];
  for (const s of [-1, 1]) {
    const m = add(rail, G.cyl(0.26, 0.26, 3.4, 8), toon(0xf0f0f0), s * 0.6, 0.4, 0.2);
    m.rotation.x = Math.PI / 2;
    add(m, G.cone(0.26, 0.6, 8), toon(ENEMY.accent), 0, 2.0, 0);
    missiles.push(m);
  }
  turret.add(rail);
  g.add(turret);
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.5, 2.2);
  rail.add(muzzle);
  enableShadows(g);
  return { group: g, turret, rail, missiles, muzzle };
}

export function createRadar() {
  const g = new THREE.Group();
  add(g, G.cyl(2.6, 3.0, 1.2, 12), toon(0x9a958c), 0, 0.6, 0);
  add(g, G.cyl(0.35, 0.45, 4.5, 8), toon(0x6d6a63), 0, 3.4, 0);
  const head = new THREE.Group();
  head.position.set(0, 5.8, 0);
  const dish = add(
    head,
    G.custom('dish', () => new THREE.SphereGeometry(3.0, 18, 8, 0, Math.PI * 2, 0, 1.0)),
    new THREE.MeshStandardMaterial({ color: 0xe9eef2, side: THREE.DoubleSide, roughness: 0.5, metalness: 0.4 }),
    0,
    0,
    0
  );
  dish.rotation.x = -Math.PI / 2 + 0.35;
  dish.position.z = 1.4;
  add(head, G.cyl(0.08, 0.08, 2.6, 6), toon(0x444444), 0, 0.4, 2.2).rotation.x = Math.PI / 2 - 0.35;
  add(head, G.sphere(0.25, 8, 6), glow(0xff3030), 0, 0.7, 3.4);
  g.add(head);
  enableShadows(g);
  return { group: g, head };
}

export function createBunker() {
  const g = new THREE.Group();
  add(g, G.box(18, 6, 13), toon(0xa49d8e), 0, 3, 0);
  add(g, G.box(18.6, 0.6, 13.6), toon(0x7e786c), 0, 6.1, 0);
  add(g, G.box(9, 4.5, 7), toon(0xbbb3a1), -2, 8.5, -1);
  add(g, G.box(9.4, 0.4, 7.4), toon(0x7e786c), -2, 10.9, -1);
  for (let i = 0; i < 5; i++) add(g, G.box(2.2, 0.8, 0.2), toon(0x2b3440), -6 + i * 3, 4.2, 6.55).userData.noShadow = true;
  add(g, G.cyl(0.12, 0.12, 9, 6), toon(0x555555), 4, 11, 2);
  add(g, G.cyl(0.08, 0.08, 6, 6), toon(0x555555), 6, 9.5, -3);
  add(g, G.sphere(0.3, 8, 6), glow(0xff3030), 4, 15.6, 2);
  const flag = add(g, G.box(0.08, 1.6, 2.6), toon(ENEMY.accent), 4, 14.4, 3.3);
  add(g, G.cyl(1.2, 1.2, 0.8, 12), toon(0x6d6a63), 2.5, 11.4, -2.5);
  const dish = add(g, G.sphere(1.2, 10, 6), toon(0xeeeeee), 2.5, 12.3, -2.5);
  dish.scale.y = 0.5;
  enableShadows(g);
  return { group: g, flag };
}

export function createGenerator() {
  const g = new THREE.Group();
  const tower = add(
    g,
    G.custom('coolingTower', () => {
      const pts = [];
      for (let i = 0; i <= 10; i++) {
        const t = i / 10;
        pts.push(new THREE.Vector2(4.2 - Math.sin(t * Math.PI) * 1.5 - t * 0.6, t * 11));
      }
      return new THREE.LatheGeometry(pts, 18);
    }),
    new THREE.MeshStandardMaterial({ color: 0xd9d4c7, side: THREE.DoubleSide, roughness: 0.9 })
  );
  tower.position.y = 0;
  add(g, G.cyl(2.4, 2.4, 0.6, 18), toon(0xc0392b), 0, 9.5, 0);
  const core = add(g, G.cyl(1.4, 1.4, 3, 12), glow(0x66e0ff), 6, 1.5, 0);
  add(g, G.box(3.6, 1.2, 3.6), toon(0x6b7280), 6, 3.5, 0);
  for (let i = 0; i < 3; i++) add(g, G.cyl(0.25, 0.25, 6, 6), toon(0x9ca3af), 6 - 2 + i * 2, 3, 3).rotation.x = Math.PI / 2;
  enableShadows(g);
  return { group: g, core };
}

export function createFortress() {
  const g = new THREE.Group();
  add(g, G.box(10, 3.2, 16), toon(0x8a7a5c), 0, 2.6, 0);
  add(g, G.box(8, 2.2, 10), toon(0x6f6249), 0, 5.2, -1);
  add(g, G.box(10.4, 0.5, 2), toon(ENEMY.accent), 0, 4.3, 7.2);
  for (const s of [-1, 1]) {
    add(g, G.box(2, 2.4, 17), toon(0x2e2a26), s * 5.6, 1.2, 0);
    for (let i = -3; i <= 3; i++) {
      const w = add(g, G.cyl(0.9, 0.9, 2.1, 10), toon(0x4a453f), s * 5.6, 1.0, i * 2.3);
      w.rotation.z = Math.PI / 2;
    }
  }
  const core = add(g, G.sphere(2.2, 16, 12), glow(0xff5a2a), 0, 6.8, -1);
  const shield = add(
    g,
    G.sphere(4.6, 20, 14),
    new THREE.MeshBasicMaterial({ color: 0x66ccff, transparent: true, opacity: 0.22, depthWrite: false, toneMapped: false }),
    0,
    6.5,
    -1
  );
  shield.userData.noShadow = true;
  enableShadows(g);
  return { group: g, core, shield };
}

export function createWreckHeli() {
  const g = new THREE.Group();
  const body = add(g, G.sphere(1, 12, 8), toon(0x3a3f2a), 0, 1.0, 0);
  body.scale.set(1.3, 1.0, 2.1);
  const boom = add(g, G.cyl(0.18, 0.45, 4.5, 8), toon(0x2e3222), 0.8, 0.6, -3.2);
  boom.rotation.set(-Math.PI / 2, 0, 0.5);
  add(g, G.box(0.3, 0.06, 6), toon(0x1e1e1e), 1.5, 2.0, 0.5).rotation.set(0.3, 0.6, 0.2);
  g.rotation.z = 0.35;
  enableShadows(g);
  return { group: g };
}

export function createPickup(type) {
  const g = new THREE.Group();
  const inner = new THREE.Group();
  inner.position.y = 1.6;
  g.add(inner);
  if (type === 'fuel') {
    add(inner, G.cyl(0.9, 0.9, 2.0, 12), toon(0xe23b3b));
    add(inner, G.cyl(0.93, 0.93, 0.3, 12), toon(0xf5f5f5), 0, 0.4, 0);
    add(inner, G.cyl(0.2, 0.2, 0.3, 8), toon(0x333333), 0.4, 1.1, 0);
  } else if (type === 'ammo') {
    add(inner, G.box(2.2, 1.3, 1.5), toon(0x5d6b33));
    add(inner, G.box(2.25, 0.3, 1.55), toon(0xf2c94c), 0, 0.2, 0);
  } else {
    add(inner, G.box(1.8, 1.8, 1.8), toon(0xf7f7f7));
    add(inner, G.box(1.85, 1.2, 0.4), toon(0x2ecc71));
    add(inner, G.box(0.4, 1.2, 1.85), toon(0x2ecc71));
    add(inner, G.box(1.2, 1.85, 0.4), toon(0x2ecc71));
  }
  const ringColor = { fuel: 0xff6a3d, ammo: 0xffd34d, armor: 0x4dff9a }[type];
  const ring = add(g, G.torus(1.9, 0.12, 6, 28), glow(ringColor), 0, 0.15, 0);
  ring.rotation.x = Math.PI / 2;
  ring.userData.noShadow = true;
  enableShadows(g, true, false);
  return { group: g, inner, ring };
}

export function createHelipad(radius = 9) {
  const g = new THREE.Group();
  add(g, G.cyl(radius, radius, 0.3, 32), toon(0x55595f), 0, 0.15, 0).receiveShadow = true;
  const ringMat = glow(0x55e0ff, { transparent: true, opacity: 0.85 });
  const ring = add(g, G.custom('padRing' + radius, () => new THREE.RingGeometry(radius - 1.2, radius - 0.6, 48)), ringMat, 0, 0.34, 0);
  ring.rotation.x = -Math.PI / 2;
  const hMat = toon(0xf5f5f5);
  add(g, G.box(1.0, 0.1, 6), hMat, -1.8, 0.33, 0);
  add(g, G.box(1.0, 0.1, 6), hMat, 1.8, 0.33, 0);
  add(g, G.box(2.6, 0.1, 1.0), hMat, 0, 0.33, 0);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    add(g, G.sphere(0.25, 6, 4), glow(0xffd34d), Math.cos(a) * (radius + 0.3), 0.4, Math.sin(a) * (radius + 0.3));
  }
  g.traverse((o) => o.isMesh && (o.receiveShadow = true));
  return { group: g, ring };
}

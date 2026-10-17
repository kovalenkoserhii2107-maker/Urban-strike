import * as THREE from 'three';
import { toon, glow, glass as glassMat, paint, metal as metalMat, G } from './materials.js';
import { enableShadows } from './models.js';

// Ударный вертолёт игрока в стиле AH-1Z Viper: узкий тандемный фюзеляж,
// подвижная пушка под носом, крылья с блоками НУР и Hellfire. Нос смотрит в +Z.

export const SKINS = {
  marines: { name: 'Морская пехота', body: 0x8e979e, belly: 0x7b848b, dark: 0x41474d, mark: 0xe9ecef, pod: 0x5d6640 },
  jungle: { name: 'Джунгли', body: 0x5c8a3c, belly: 0x4d7633, dark: 0x2c3a26, mark: 0xf2c94c, pod: 0x3f4a2c },
  desert: { name: 'Пустыня', body: 0xc9b07a, belly: 0xb39b67, dark: 0x5f5136, mark: 0x8a3b2b, pod: 0x7a6a46 },
  night: { name: 'Ночной охотник', body: 0x2a2e33, belly: 0x22262a, dark: 0x15181b, mark: 0x8b96a0, pod: 0x2f3328 },
  veteran: { name: 'Ветеран', body: 0x6d7a84, belly: 0x5d6870, dark: 0x2a3036, mark: 0xd9b24a, pod: 0x4a5236 },
};

function add(parent, geo, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}

// Соты на торце блока НУР.
function honeycomb() {
  return G.custom('podFaceTex', () => {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const g = c.getContext('2d');
    g.fillStyle = '#3a3f2a';
    g.fillRect(0, 0, 64, 64);
    g.fillStyle = '#15170f';
    const pts = [[32, 32]];
    for (let i = 0; i < 6; i++) pts.push([32 + Math.cos((i / 6) * Math.PI * 2) * 17, 32 + Math.sin((i / 6) * Math.PI * 2) * 17]);
    for (const [x, y] of pts) {
      g.beginPath();
      g.arc(x, y, 7, 0, Math.PI * 2);
      g.fill();
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  });
}

export function createViper(skinId = 'marines', mods = {}) {
  const lv = (id) => mods?.[id] ?? 0;
  const c = SKINS[skinId] || SKINS.marines;
  // матовая авиационная краска, но с отражениями неба
  const body = paint(c.body, { roughness: 0.55, metalness: 0.2 });
  const belly = paint(c.belly, { roughness: 0.6, metalness: 0.15 });
  const dark = paint(c.dark, { roughness: 0.5, metalness: 0.3 });
  const mark = toon(c.mark);
  const metal = metalMat(0x2b2f33);
  const g = new THREE.Group();

  // --- фюзеляж ---
  const hull = add(g, G.custom('viperHull', () => new THREE.CapsuleGeometry(0.8, 4.0, 6, 14).rotateX(Math.PI / 2)), body, 0, 0, 0.25);
  hull.scale.set(0.8, 1.12, 1);
  const keel = add(g, G.box(1.0, 0.5, 4.6), belly, 0, -0.68, 0.15);
  keel.userData.noShadow = true;
  const nose = add(g, G.sphere(0.6, 14, 10), body, 0, -0.2, 2.95);
  nose.scale.set(0.82, 0.8, 1.1);
  // сенсорная турель на носу
  add(g, G.sphere(0.4, 14, 10), dark, 0, -0.28, 3.55);
  const lens = add(g, G.cyl(0.17, 0.17, 0.08, 14), glow(0x5fd4ff), 0, -0.28, 3.93);
  lens.rotation.x = Math.PI / 2;
  // кабина: два пилота друг за другом
  const glass = glassMat(0x8fc8e8, 0.42);
  const canopy = add(g, G.sphere(0.7, 18, 12), glass, 0, 0.82, 1.55);
  canopy.scale.set(0.62, 0.58, 1.95);
  canopy.renderOrder = 2;
  canopy.userData.noShadow = true;
  for (const z of [2.15, 1.05]) {
    add(g, G.sphere(0.2, 10, 8), toon(0xf2c29b), 0, 0.92, z);
    add(g, G.custom('pilotHelmet', () => new THREE.SphereGeometry(0.23, 10, 6, 0, Math.PI * 2, 0, Math.PI / 1.8)), toon(0x3d4a2a), 0, 0.96, z - 0.02);
    add(g, G.box(0.3, 0.09, 0.08), glow(0xffb347), 0, 0.93, z + 0.19);
  }
  // переплёт фонаря
  add(g, G.box(0.06, 0.06, 2.55), dark, 0, 1.22, 1.55);
  for (const [dz, s] of [[-0.85, 0.78], [0.05, 1], [0.8, 0.8]]) {
    const hoop = add(g, G.custom('canopyHoop', () => new THREE.TorusGeometry(1, 0.045, 5, 16, Math.PI)), dark, 0, 0.82, 1.55 + dz);
    hoop.scale.set(0.43 * s, 0.39 * s, 1);
  }
  // гаргрот с двигателями и редуктором
  const doghouse = add(g, G.custom('viperDoghouse', () => new THREE.CapsuleGeometry(0.5, 1.7, 5, 12).rotateX(Math.PI / 2)), body, 0, 1.0, -0.75);
  doghouse.scale.set(1.15, 1, 1);
  const exhausts = [];
  for (const s of [-1, 1]) {
    const nac = add(g, G.cyl(0.38, 0.4, 2.0, 12), body, s * 0.82, 0.78, -0.75);
    nac.rotation.x = Math.PI / 2;
    const intake = add(g, G.cyl(0.3, 0.3, 0.06, 12), toon(0x1c1f22), s * 0.82, 0.78, 0.27);
    intake.rotation.x = Math.PI / 2;
    // выхлоп отогнут вверх и наружу, как у «Вайпера»
    const ex = new THREE.Group();
    ex.position.set(s * 0.86, 0.8, -1.75);
    ex.rotation.set(0.45, s * 0.35, 0);
    const pipe = add(ex, G.cyl(0.36, 0.3, 1.0, 12), body, 0, 0, -0.45);
    pipe.rotation.x = Math.PI / 2;
    const hole = add(ex, G.cyl(0.27, 0.27, 0.05, 12), toon(0x111111), 0, 0, -0.96);
    hole.rotation.x = Math.PI / 2;
    const anchor = new THREE.Object3D();
    anchor.position.set(0, 0, -1.1);
    ex.add(anchor);
    exhausts.push(anchor);
    g.add(ex);
    // опознавательный знак на борту
    const roundel = add(g, G.cyl(0.24, 0.24, 0.03, 16), mark, s * 0.66, -0.05, 1.1);
    roundel.rotation.z = Math.PI / 2;
    const dot = add(g, G.cyl(0.1, 0.1, 0.035, 12), dark, s * 0.665, -0.05, 1.1);
    dot.rotation.z = Math.PI / 2;
  }
  add(g, G.cyl(0.16, 0.2, 0.32, 10), dark, 0, 1.55, -1.75);
  add(g, G.cyl(0.06, 0.06, 0.5, 6), metal, 0, 0.45, 3.0).rotation.x = -0.4;

  // --- хвост ---
  const boom = add(g, G.cyl(0.26, 0.56, 5.4, 12), body, 0, 0.45, -4.35);
  boom.rotation.x = -Math.PI / 2 - 0.04;
  const fin = add(
    g,
    G.custom('viperFin', () => {
      const s = new THREE.Shape();
      s.moveTo(-6.5, 0.3);
      s.lineTo(-7.7, 0.3);
      s.lineTo(-8.05, 2.35);
      s.lineTo(-7.45, 2.35);
      s.closePath();
      return new THREE.ExtrudeGeometry(s, { depth: 0.16, bevelEnabled: false }).rotateY(-Math.PI / 2).translate(0.08, 0, 0);
    }),
    body
  );
  fin.position.set(0, 0, 0);
  for (const s of [-1, 1]) {
    const stab = add(g, G.box(1.25, 0.08, 0.55), body, s * 0.75, 0.45, -5.9);
    stab.rotation.z = s * -0.05;
    add(g, G.box(0.06, 0.45, 0.5), body, s * 1.38, 0.55, -5.95);
  }
  add(g, G.box(0.03, 0.3, 0.9), mark, 0.09, 1.3, -7.6);
  const tailRotor = new THREE.Group();
  tailRotor.position.set(-0.22, 2.0, -7.75);
  add(tailRotor, G.cyl(0.1, 0.1, 0.3, 8), dark).rotation.z = Math.PI / 2;
  for (let i = 0; i < 2; i++) {
    const b = add(tailRotor, G.box(0.05, 1.9, 0.16), toon(0x2a2d30));
    b.rotation.x = (i * Math.PI) / 2;
  }
  g.add(tailRotor);
  const tailDisc = add(
    g,
    G.custom('tailDisc', () => new THREE.CircleGeometry(0.95, 20).rotateY(Math.PI / 2)),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.12, depthWrite: false, side: THREE.DoubleSide }),
    -0.26,
    2.0,
    -7.75
  );
  tailDisc.userData.noShadow = true;

  // --- шасси-полозья ---
  for (const s of [-1, 1]) {
    const skid = add(g, G.cyl(0.075, 0.075, 4.3, 8), metal, s * 0.95, -1.42, 0.25);
    skid.rotation.x = Math.PI / 2;
    const tip = add(g, G.cyl(0.075, 0.075, 0.55, 8), metal, s * 0.95, -1.3, 2.55);
    tip.rotation.x = Math.PI / 2 - 0.7;
    for (const z of [1.3, -0.9]) {
      const leg = add(g, G.cyl(0.06, 0.06, 0.95, 6), metal, s * 0.72, -1.05, z);
      leg.rotation.z = s * 0.55;
    }
  }

  // --- крылья и подвеска ---
  add(g, G.box(4.9, 0.16, 1.1), body, 0, -0.08, 0.05);
  const pods = [];
  const hellfires = [];
  const podFace = new THREE.MeshStandardMaterial({ map: honeycomb(), roughness: 0.7, metalness: 0.3 });
  const racks = [];
  for (const s of [-1, 1]) {
    // внутренний узел: блок НУР
    add(g, G.box(0.14, 0.26, 0.5), dark, s * 1.3, -0.28, 0.1);
    const podR = lv('rockets') >= 2 ? 0.4 : 0.34;
    const pod = add(g, G.cyl(podR, podR, 1.8, 14), [toon(c.pod), podFace, toon(c.pod)], s * 1.3, -0.62, 0.15);
    pod.rotation.x = Math.PI / 2;
    const podTip = new THREE.Object3D();
    podTip.position.set(s * 1.3, -0.62, 1.05);
    g.add(podTip);
    pods.push(podTip);
    // внешний узел: четыре Hellfire на балке
    add(g, G.box(0.14, 0.22, 0.5), dark, s * 2.05, -0.26, 0.1);
    add(g, G.box(0.56, 0.1, 1.3), dark, s * 2.05, -0.42, 0.1);
    racks.push(s);
    if (lv('ew') >= 1) {
      // контейнер РЭБ на законцовке вместо ракеты
      const ew = add(g, G.cyl(0.16, 0.16, 1.5, 10), dark, s * 2.52, -0.03, 0.2);
      ew.rotation.x = Math.PI / 2;
      add(g, G.sphere(0.16, 8, 6), dark, s * 2.52, -0.03, 0.95);
      add(g, G.box(0.04, 0.4, 0.3), dark, s * 2.52, 0.15, -0.4);
    } else {
      // ракета на законцовке крыла
      const aim = add(g, G.cyl(0.07, 0.07, 1.3, 8), toon(0xdfe3e6), s * 2.5, -0.03, 0.2);
      aim.rotation.x = Math.PI / 2;
    }
    if (lv('armor') >= 2) {
      // накладные бронеплиты кабины и двигателей
      add(g, G.box(0.06, 0.7, 2.4), dark, s * 0.69, 0.15, 1.6);
      add(g, G.box(0.06, 0.5, 1.6), dark, s * 1.22, 0.75, -0.7);
    }
  }
  // порядок пусков чередует борта, чтобы вес «уходил» симметрично
  for (let row = 0; row < 2; row++)
    for (let col = 0; col < 2; col++)
      for (const s of racks) {
        const m = new THREE.Group();
        m.position.set(s * 2.05 + (col ? 0.14 : -0.14), -0.6 - row * 0.25, 0.15);
        const tube = add(m, G.cyl(0.11, 0.11, 1.3, 8), toon(0x6b7076));
        tube.rotation.x = Math.PI / 2;
        const tip = add(m, G.cone(0.11, 0.3, 8), toon(0xd9a441), 0, 0, 0.8);
        tip.rotation.x = Math.PI / 2;
        g.add(m);
        hellfires.push(m);
      }

  // --- трёхствольная пушка под носом ---
  const gunTurret = new THREE.Group();
  gunTurret.position.set(0, -0.82, 2.7);
  add(gunTurret, G.sphere(0.3, 12, 8), dark);
  const gunPitch = new THREE.Group();
  gunPitch.position.set(0, -0.08, 0.1);
  gunTurret.add(gunPitch);
  add(gunPitch, G.cyl(0.13, 0.13, 0.5, 10), metal, 0, 0, 0.3).rotation.x = Math.PI / 2;
  const barrels = new THREE.Group();
  barrels.position.z = 0.55;
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    const b = add(barrels, G.cyl(0.045, 0.045, 0.9, 6), metal, Math.cos(a) * 0.08, Math.sin(a) * 0.08, 0.45);
    b.rotation.x = Math.PI / 2;
  }
  gunPitch.add(barrels);
  const muzzle = new THREE.Object3D();
  muzzle.position.z = 1.45;
  gunPitch.add(muzzle);
  g.add(gunTurret);

  // --- несущий винт ---
  add(g, G.cyl(0.13, 0.17, 0.55, 8), dark, 0, 1.68, -0.45);
  const rotor = new THREE.Group();
  rotor.position.set(0, 2.0, -0.45);
  add(rotor, G.sphere(0.3, 10, 8), dark);
  if (lv('sensors') >= 2) {
    // надвтулочный радар, как у «Лонгбоу»
    const dome = add(g, G.sphere(0.55, 16, 10), toon(0xc9cdd0), 0, 2.55, -0.45);
    dome.scale.y = 0.6;
    add(g, G.cyl(0.08, 0.08, 0.5, 6), dark, 0, 2.25, -0.45);
  }
  for (let i = 0; i < 2; i++) {
    const blade = add(rotor, G.box(0.36, 0.06, 8.4), toon(0x2a2d30));
    blade.rotation.y = (i * Math.PI) / 2 + Math.PI / 4;
  }
  g.add(rotor);
  const disc = add(
    g,
    G.custom('viperDisc', () => new THREE.CircleGeometry(4.2, 36)),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.1, depthWrite: false }),
    0,
    2.02,
    -0.45
  );
  disc.rotation.x = -Math.PI / 2;
  disc.userData.noShadow = true;

  // огни
  for (const s of [-1, 1]) add(g, G.sphere(0.1, 6, 4), glow(s < 0 ? 0xff3b3b : 0x3bff6a), s * 2.5, -0.03, 0.9).userData.noShadow = true;
  const beacon = add(g, G.sphere(0.13, 6, 4), glow(0xff2a2a), 0, 2.4, -7.75);
  beacon.userData.noShadow = true;

  enableShadows(g, true, false);
  canopy.castShadow = false;
  return { group: g, rotor, tailRotor, disc, tailDisc, beacon, nose: muzzle, podL: pods[0], podR: pods[1], gunTurret, gunPitch, barrels, hellfires, exhausts };
}

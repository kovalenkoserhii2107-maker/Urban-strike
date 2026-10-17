import * as THREE from 'three';

let gradient;
export function gradientMap() {
  if (!gradient) {
    gradient = new THREE.DataTexture(new Uint8Array([95, 160, 215, 255]), 4, 1, THREE.RedFormat);
    gradient.minFilter = THREE.NearestFilter;
    gradient.magFilter = THREE.NearestFilter;
    gradient.generateMipmaps = false;
    gradient.needsUpdate = true;
  }
  return gradient;
}

const toonCache = new Map();
// Мультяшный материал с 4 ступенями освещения. opts — только примитивы (кэшируется).
export function toon(color, opts = {}) {
  const key = color + '|' + JSON.stringify(opts);
  let m = toonCache.get(key);
  if (!m) {
    m = new THREE.MeshToonMaterial({ color, gradientMap: gradientMap(), ...opts });
    toonCache.set(key, m);
  }
  return m;
}

const glowCache = new Map();
// Неосвещаемый яркий материал: огонь, вспышки, фонари (ловится bloom-ом).
export function glow(color, opts = {}) {
  const key = color + '|' + JSON.stringify(opts);
  let m = glowCache.get(key);
  if (!m) {
    m = new THREE.MeshBasicMaterial({ color, toneMapped: false, ...opts });
    glowCache.set(key, m);
  }
  return m;
}

const geoCache = new Map();
function cached(key, make) {
  let g = geoCache.get(key);
  if (!g) {
    g = make();
    geoCache.set(key, g);
  }
  return g;
}

export const G = {
  box: (w, h, d) => cached(`b${w},${h},${d}`, () => new THREE.BoxGeometry(w, h, d)),
  cyl: (rt, rb, h, s = 10) => cached(`c${rt},${rb},${h},${s}`, () => new THREE.CylinderGeometry(rt, rb, h, s)),
  sphere: (r, w = 14, h = 10) => cached(`s${r},${w},${h}`, () => new THREE.SphereGeometry(r, w, h)),
  ico: (r, d = 0) => cached(`i${r},${d}`, () => new THREE.IcosahedronGeometry(r, d)),
  cone: (r, h, s = 8) => cached(`k${r},${h},${s}`, () => new THREE.ConeGeometry(r, h, s)),
  torus: (r, t, rs = 6, ts = 16) => cached(`t${r},${t},${rs},${ts}`, () => new THREE.TorusGeometry(r, t, rs, ts)),
  custom: cached,
};

import * as THREE from 'three';

// Физически корректные материалы (PBR). Шероховатость и металличность
// подобраны под тип поверхности: матовая краска, металл, стекло.

const pbrCache = new Map();
export function pbr(color, opts = {}) {
  const key = color + '|' + JSON.stringify(opts);
  let m = pbrCache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness: 0.82, metalness: 0.02, ...opts });
    pbrCache.set(key, m);
  }
  return m;
}

// Старое имя оставлено, чтобы модели не переписывать: теперь это тоже PBR.
export const toon = pbr;

// Автомобильная/авиационная краска: лёгкий блеск и отражения неба.
export const paint = (color, opts = {}) => pbr(color, { roughness: 0.42, metalness: 0.25, ...opts });
// Голый металл: стволы, рельсы, полозья.
export const metal = (color = 0x3a3d40, opts = {}) => pbr(color, { roughness: 0.38, metalness: 0.85, ...opts });

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

// Стекло кабин и окон: гладкое, полупрозрачное, отражает окружение.
export function glass(color = 0x9fd8ff, opacity = 0.45) {
  return pbr(color, { roughness: 0.05, metalness: 0.1, transparent: true, opacity, depthWrite: false, envMapIntensity: 1.6 });
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

// Детальная текстура поверх основного цвета: шум в мировых координатах,
// чтобы большие поверхности не выглядели плоскими вблизи.
export function addDetail(material, tex, scale = 0.12, strength = 0.35) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uDetail = { value: tex };
    shader.uniforms.uDetailScale = { value: scale };
    shader.uniforms.uDetailStrength = { value: strength };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vDetailPos;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvDetailPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vDetailPos;\nuniform sampler2D uDetail;\nuniform float uDetailScale;\nuniform float uDetailStrength;')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        vec2 dUv = vDetailPos.xz * uDetailScale;
        float dA = texture2D(uDetail, dUv).r;
        float dB = texture2D(uDetail, dUv * 0.137 + 0.31).r;
        diffuseColor.rgb *= 1.0 + ((dA * 0.6 + dB * 0.4) - 0.5) * 2.0 * uDetailStrength;`
      );
  };
  material.customProgramCacheKey = () => 'detail' + scale + strength;
  return material;
}

// Модули вертолёта: уровни открываются по главам сюжета и покупаются в ангаре.
// Некоторые задания и районы с сильной ПВО требуют определённых модулей.

export const MODULES = {
  armor: {
    name: 'Бронирование', icon: '🛡', levels: [
      { name: 'Штатная броня', armor: 100 },
      { name: 'Кевларовые панели', armor: 140, cost: 600, chapter: 1 },
      { name: 'Керамические плиты', armor: 190, cost: 1500, chapter: 2 },
      { name: 'Композит «Бастион»', armor: 250, cost: 3200, chapter: 3 },
    ],
  },
  engine: {
    name: 'Двигатели', icon: '⚙️', levels: [
      { name: 'T700 серийные', speed: 1.0 },
      { name: 'Форсированные T700', speed: 1.12, cost: 700, chapter: 1 },
      { name: 'T901 нового поколения', speed: 1.25, cost: 1900, chapter: 3 },
    ],
  },
  fuel: {
    name: 'Топливная система', icon: '⛽', levels: [
      { name: 'Штатные баки', drain: 1.0 },
      { name: 'Протектированные баки', drain: 0.8, cost: 450, chapter: 1 },
      { name: 'Экономичный режим FADEC', drain: 0.62, cost: 1300, chapter: 2 },
    ],
  },
  gun: {
    name: 'Пушка M197', icon: '🔫', levels: [
      { name: '20 мм, штатные снаряды', gunDmg: 1.0, gunRate: 12 },
      { name: 'Бронебойные снаряды', gunDmg: 1.35, gunRate: 13, cost: 500, chapter: 1 },
      { name: 'Ускоренный привод', gunDmg: 1.7, gunRate: 15, cost: 1600, chapter: 3 },
    ],
  },
  rockets: {
    name: 'Блоки НУР', icon: '🚀', levels: [
      { name: 'LAU-61, 19 ракет ×2', hydra: 38, rocketDmg: 1.0 },
      { name: 'Усиленные БЧ', hydra: 48, rocketDmg: 1.25, cost: 650, chapter: 1 },
      { name: 'APKWS с наведением', hydra: 60, rocketDmg: 1.5, cost: 2100, chapter: 3 },
    ],
  },
  hellfire: {
    name: 'Ракеты Hellfire', icon: '🎯', levels: [
      { name: 'AGM-114K ×8', hellfire: 8, hfDmg: 1.0 },
      { name: 'AGM-114R ×10', hellfire: 10, hfDmg: 1.3, cost: 900, chapter: 2 },
      { name: 'JAGM ×12, залп по двум целям', hellfire: 12, hfDmg: 1.5, salvo: true, cost: 2600, chapter: 3 },
    ],
  },
  ew: {
    name: 'РЭБ и ловушки', icon: '📡', levels: [
      { name: 'Тепловые ловушки ×4', flares: 4, recharge: 12, jam: 0 },
      { name: 'Ловушки ×6, быстрая перезарядка', flares: 6, recharge: 8, jam: 0.15, cost: 700, chapter: 1 },
      { name: 'Станция помех AN/ALQ', flares: 8, recharge: 6, jam: 0.4, cost: 2000, chapter: 2 },
    ],
  },
  sensors: {
    name: 'Сенсоры', icon: '🔭', levels: [
      { name: 'Оптика дневная', radar: 150, aim: 80, nv: false, crates: false },
      { name: 'Тепловизор (ночное зрение)', radar: 190, aim: 90, nv: true, crates: false, cost: 800, chapter: 1 },
      { name: 'Радар «Лонгбоу»', radar: 260, aim: 105, nv: true, crates: true, cost: 2200, chapter: 3 },
    ],
  },
  winch: {
    name: 'Лебёдка и отсек', icon: '🪝', levels: [
      { name: 'Лебёдка, 4 места', seats: 4, winch: 1.0 },
      { name: 'Скоростная лебёдка, 6 мест', seats: 6, winch: 1.4, cost: 500, chapter: 1 },
      { name: 'Десантный отсек, 8 мест', seats: 8, winch: 1.8, cost: 1400, chapter: 2 },
    ],
  },
};

export const MODULE_ORDER = ['armor', 'engine', 'fuel', 'gun', 'rockets', 'hellfire', 'ew', 'sensors', 'winch'];

// Окраски: открываются по ходу сюжета.
export const SKIN_UNLOCK = { marines: 0, jungle: 1, desert: 2, night: 3, veteran: 4 };

export function moduleLevel(save, id) {
  return save.modules?.[id] ?? 0;
}

// Итоговые характеристики вертолёта по установленным модулям.
export function heliStats(save) {
  const out = {};
  for (const id of MODULE_ORDER) Object.assign(out, MODULES[id].levels[moduleLevel(save, id)]);
  delete out.name;
  delete out.cost;
  delete out.chapter;
  return out;
}

export function nextLevel(save, id) {
  const lv = moduleLevel(save, id);
  return MODULES[id].levels[lv + 1] || null;
}

// Можно ли купить следующий уровень: глава и деньги.
export function canUpgrade(save, id) {
  const next = nextLevel(save, id);
  if (!next) return { ok: false, reason: 'Максимум' };
  if ((save.chapter ?? 0) < next.chapter) return { ok: false, reason: `Откроется в главе ${next.chapter + 1}` };
  if (save.credits < next.cost) return { ok: false, reason: 'Не хватает кредитов' };
  return { ok: true };
}

// Чего не хватает для требований задания: [{id, level, name}]
export function missingRequirements(save, req = {}) {
  const out = [];
  for (const [id, level] of Object.entries(req)) {
    if (moduleLevel(save, id) < level) out.push({ id, level, name: `${MODULES[id].name} ур. ${level}` });
  }
  return out;
}

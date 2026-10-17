const KEY = 'stormhawk-save-v1';

const DEFAULTS = {
  unlocked: 1,
  stars: {},
  best: {},
  credits: 0,
  upgrades: { armor: 0, fuel: 0, gun: 0, rockets: 0 },
  settings: { quality: 'auto', camera: 'normal', sound: true, music: true, vibration: true },
  tutorialDone: false,
};

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return structuredClone(DEFAULTS);
    const data = JSON.parse(raw);
    return {
      ...structuredClone(DEFAULTS),
      ...data,
      upgrades: { ...DEFAULTS.upgrades, ...data.upgrades },
      settings: { ...DEFAULTS.settings, ...data.settings },
    };
  } catch {
    return structuredClone(DEFAULTS);
  }
}

export const save = load();

export function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(save));
  } catch {
    // Хранилище недоступно (приватный режим) — прогресс живёт до закрытия вкладки.
  }
}

const KEY = 'stormhawk-save-v2';
const OLD_KEY = 'stormhawk-save-v1';

const DEFAULTS = {
  credits: 0,
  chapter: 0,
  modules: {},
  skin: 'marines',
  stars: {},
  tutorialDone: false,
  world: { outposts: {}, fog: '' },
  settings: { quality: 'auto', camera: 'normal', sound: true, music: true, vibration: true },
};

function fresh() {
  return structuredClone(DEFAULTS);
}

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const data = JSON.parse(raw);
      return {
        ...fresh(),
        ...data,
        world: { ...DEFAULTS.world, ...data.world },
        settings: { ...DEFAULTS.settings, ...data.settings },
      };
    }
    // перенос со старой версии: кредиты, окраска и настройки сохраняются
    const old = localStorage.getItem(OLD_KEY);
    if (old) {
      const o = JSON.parse(old);
      return { ...fresh(), credits: o.credits || 0, skin: o.skin || 'marines', tutorialDone: !!o.tutorialDone, settings: { ...DEFAULTS.settings, ...o.settings } };
    }
  } catch {
    /* повреждённые данные — начинаем заново */
  }
  return fresh();
}

export const save = load();

export function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(save));
  } catch {
    // Хранилище недоступно (приватный режим) — прогресс живёт до закрытия вкладки.
  }
}

export function resetProgress() {
  const settings = save.settings;
  for (const k of Object.keys(save)) delete save[k];
  Object.assign(save, fresh(), { settings });
  persist();
}

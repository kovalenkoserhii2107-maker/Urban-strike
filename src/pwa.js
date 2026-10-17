// Установка как приложения (PWA) и офлайн-кэш.
let deferred = null;
const listeners = new Set();

export const isStandalone = () =>
  matchMedia('(display-mode: standalone)').matches ||
  matchMedia('(display-mode: fullscreen)').matches ||
  window.navigator.standalone === true;

export const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export const canPrompt = () => !!deferred;

export function onInstallChange(fn) {
  listeners.add(fn);
}

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferred = e;
  listeners.forEach((fn) => fn());
});

window.addEventListener('appinstalled', () => {
  deferred = null;
  listeners.forEach((fn) => fn('installed'));
});

export async function promptInstall() {
  if (!deferred) return 'unavailable';
  deferred.prompt();
  const { outcome } = await deferred.userChoice;
  deferred = null;
  listeners.forEach((fn) => fn());
  return outcome;
}

export function registerSW() {
  if (!('serviceWorker' in navigator) || !import.meta.env.PROD) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}

export async function goFullscreen() {
  const el = document.documentElement;
  try {
    if (!document.fullscreenElement && el.requestFullscreen && !isStandalone()) await el.requestFullscreen({ navigationUI: 'hide' });
  } catch {
    /* браузер не разрешил */
  }
  try {
    await screen.orientation?.lock?.('landscape');
  } catch {
    /* блокировка ориентации доступна не везде */
  }
}

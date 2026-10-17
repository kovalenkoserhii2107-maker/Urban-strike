import { Game, STORY } from './game/game.js';
import { SKINS } from './game/viper.js';
import { MODULES, MODULE_ORDER, SKIN_UNLOCK, moduleLevel, nextLevel, canUpgrade, missingRequirements } from './game/modules.js';
import { MapScreen } from './ui/map.js';
import { save, persist, resetProgress } from './core/save.js';
import { isStandalone, isIOS, canPrompt, promptInstall, onInstallChange, registerSW, goFullscreen } from './pwa.js';

registerSW();

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
// Встроенная версия (просмотр по ссылке): установка PWA там недоступна.
const embedded = window.__STORMHAWK_EMBED__ === true;
const session = {
  get(k) {
    try {
      return sessionStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k, v) {
    try {
      sessionStorage.setItem(k, v);
    } catch {
      /* хранилище недоступно */
    }
  },
};
let current = 'splash';
let game;
let mapScreen;

// ---------- переходы между экранами ----------
function show(id) {
  for (const s of $$('.screen')) {
    if (s.id === id) {
      s.classList.add('active');
      s.classList.remove('leaving');
    } else if (s.classList.contains('active')) {
      s.classList.remove('active');
      s.classList.add('leaving');
      setTimeout(() => s.classList.remove('leaving'), 400);
    }
  }
  current = id;
}

function hideScreens() {
  for (const s of $$('.screen')) s.classList.remove('active');
  current = 'game';
}

const wipe = $('#wipe');
// «Шторка»: закрывает экран, выполняет действие, открывает.
function transition(fn, { color = '#0b1a2b' } = {}) {
  return new Promise((resolve) => {
    wipe.style.background = color;
    wipe.className = 'cover';
    setTimeout(async () => {
      await fn();
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          wipe.className = 'reveal';
          setTimeout(() => {
            wipe.className = '';
            resolve();
          }, 650);
        })
      );
    }, 520);
  });
}

function setGameUI(on) {
  $('#hud').classList.toggle('hidden', !on);
  $('#controls').classList.toggle('hidden', !on);
  document.body.classList.toggle('in-game', on);
}

function banner(title, sub = '') {
  const b = $('#banner');
  b.querySelector('h2').textContent = title;
  b.querySelector('p').textContent = sub;
  b.classList.remove('show');
  void b.offsetWidth;
  b.classList.add('show');
}

function click() {
  game?.audio.unlock();
  game?.audio.play('ui');
}

function refreshCredits() {
  for (const el of $$('.credits-val')) el.textContent = save.credits.toLocaleString('ru-RU');
}

// ---------- меню ----------
function refreshMenu() {
  $('#menu-credits').textContent = save.credits ? `💰 ${save.credits.toLocaleString('ru-RU')}` : '';
  $('#btn-menu-install').classList.toggle('hidden', embedded || isStandalone() || (!canPrompt() && !isIOS()));
  $('#btn-play').textContent = game?.ow ? 'Продолжить' : save.chapter > 0 || save.credits > 0 ? 'Продолжить' : 'В бой';
}

function goMenu() {
  setGameUI(false);
  refreshMenu();
  show('menu');
  if (game.mode !== 'attract') {
    if (game.mode === 'play') game.pause(true);
    game.audio.stopRotor();
    game.menuReturn = true;
    game.startAttract();
  }
  if (save.settings.music) {
    game.audio.unlock();
    game.audio.startMusic('menu');
  }
}

// ---------- сюжет ----------
function renderStory() {
  refreshCredits();
  const list = $('#mission-list');
  list.innerHTML = '';
  STORY.forEach((m, i) => {
    const done = i < save.chapter;
    const now = i === save.chapter;
    const missing = missingRequirements(save, m.requires);
    const stars = save.stars[m.id] || 0;
    const card = document.createElement('div');
    card.className = 'card mission ' + m.lighting + (done ? ' done' : now ? ' current' : ' locked');
    const reqs = Object.entries(m.requires)
      .map(([id, lv]) => `<span class="req ${moduleLevel(save, id) >= lv ? 'ok' : 'miss'}">${MODULES[id].icon} ${MODULES[id].name} ${lv}</span>`)
      .join('');
    card.innerHTML = `
      <div class="card-num">${i + 1}</div>
      <div class="card-body">
        <h3>${m.name}</h3>
        <div class="muted">${m.place}</div>
        ${done ? `<div class="stars small">${[1, 2, 3].map((s) => `<span class="${s <= stars ? 'on' : ''}">★</span>`).join('')}</div>` : ''}
        ${!done ? `<div class="reqs">${reqs || '<span class="req ok">Без требований</span>'}</div>` : ''}
        ${now ? `<div class="hint-line">${missing.length ? 'Улучши модули в ангаре' : 'Лети к ★ на карте'}</div>` : ''}
      </div>
      ${done ? '<div class="lock">✅</div>' : now ? '' : '<div class="lock">🔒</div>'}`;
    list.appendChild(card);
  });
}

let typer;
function offerMission(def, missing) {
  game.pause(true);
  $('#brief-name').textContent = def.name;
  $('#brief-place').textContent = def.place;
  $('#brief-goals').innerHTML = def.goals.map((g) => `<li>${g}</li>`).join('');
  $('#brief-reward').textContent = `${def.reward.toLocaleString('ru-RU')} 💰 и новые модули`;
  const req = $('#brief-req');
  req.innerHTML = missing.length
    ? `<div class="req-box">Нужны модули: ${missing.map((m) => `<b>${m.name}</b>`).join(', ')}.<br />Улучши их в ангаре на базе «Сокол».</div>`
    : '';
  $('#btn-launch').disabled = missing.length > 0;
  const el = $('#brief-story');
  el.textContent = '';
  clearInterval(typer);
  let k = 0;
  typer = setInterval(() => {
    k += 2;
    el.textContent = def.briefing.slice(0, k);
    if (k >= def.briefing.length) clearInterval(typer);
  }, 16);
  offerDef = def;
  show('offer');
}
let offerDef = null;

// ---------- ангар ----------
let hangarFrom = 'menu';
let hangarTab = 'modules';

function openHangar(from) {
  hangarFrom = from;
  if (from === 'game') game.pause(true);
  renderHangar();
  show('hangar');
}

function closeHangar() {
  click();
  if (hangarFrom === 'game') {
    hideScreens();
    game.pause(false);
  } else {
    refreshMenu();
    show('menu');
  }
}

function renderHangar() {
  refreshCredits();
  for (const t of $$('.tab')) t.classList.toggle('on', t.dataset.tab === hangarTab);
  $('#upgrade-list').classList.toggle('hidden', hangarTab !== 'modules');
  $('#skin-list').classList.toggle('hidden', hangarTab !== 'skins');
  const list = $('#upgrade-list');
  list.innerHTML = '';
  for (const id of MODULE_ORDER) {
    const mod = MODULES[id];
    const lv = moduleLevel(save, id);
    const next = nextLevel(save, id);
    const st = canUpgrade(save, id);
    const card = document.createElement('div');
    card.className = 'card upgrade' + (next && (save.chapter ?? 0) < next.chapter ? ' locked-next' : '');
    card.innerHTML = `
      <div class="up-icon">${mod.icon}</div>
      <div class="card-body">
        <h3>${mod.name}</h3>
        <div class="muted cur">${mod.levels[lv].name}</div>
        <div class="pips">${mod.levels.map((_, i) => `<i class="${i <= lv ? 'on' : ''}"></i>`).join('')}</div>
        ${next ? `<div class="next">→ ${next.name}</div>` : ''}
      </div>
      <button class="btn small ${st.ok ? 'primary' : ''}" ${st.ok ? '' : 'disabled'}>
        ${next ? (st.ok || st.reason === 'Не хватает кредитов' ? `💰 ${next.cost}` : '🔒') : 'MAX'}
      </button>
      ${next && !st.ok && st.reason !== 'Максимум' ? `<div class="lock-reason">${st.reason}</div>` : ''}`;
    card.querySelector('button').addEventListener('click', () => {
      if (!canUpgrade(save, id).ok) return;
      save.credits -= next.cost;
      save.modules[id] = lv + 1;
      persist();
      game.audio.unlock();
      game.audio.play('pickup');
      if (game.ow) game.refitHeli();
      else if (game.mode === 'attract') game.startAttract();
      renderHangar();
    });
    list.appendChild(card);
  }
  const skins = $('#skin-list');
  skins.innerHTML = '';
  for (const [id, sk] of Object.entries(SKINS)) {
    const need = SKIN_UNLOCK[id] ?? 0;
    const open = (save.chapter ?? 0) >= need;
    const b = document.createElement('button');
    b.className = 'card skin-card' + (save.skin === id ? ' on' : '') + (open ? '' : ' locked');
    const hex = (n) => '#' + n.toString(16).padStart(6, '0');
    b.innerHTML = `<i style="background: linear-gradient(135deg, ${hex(sk.body)} 55%, ${hex(sk.dark)} 55%)"></i>
      <div class="card-body"><h3>${sk.name}</h3><div class="muted">${open ? (save.skin === id ? 'Установлена' : 'Доступна') : `Откроется после главы ${need}`}</div></div>`;
    b.addEventListener('click', () => {
      if (!open) return;
      click();
      save.skin = id;
      persist();
      if (game.ow) game.refitHeli();
      else if (game.mode === 'attract') game.startAttract();
      renderHangar();
    });
    skins.appendChild(b);
  }
}

// ---------- настройки ----------
function renderSettings() {
  for (const b of $$('#quality-seg button')) b.classList.toggle('on', b.dataset.q === save.settings.quality);
  for (const b of $$('#camera-seg button')) b.classList.toggle('on', b.dataset.cam === save.settings.camera);
  $('#opt-sound').checked = save.settings.sound;
  $('#opt-music').checked = save.settings.music;
  $('#opt-vibration').checked = save.settings.vibration;
}

// ---------- итоги сюжетного задания ----------
function showResults(r) {
  const mm = Math.floor(r.time / 60), ss = Math.floor(r.time % 60);
  const rows = [
    ['Время', `${mm}:${String(ss).padStart(2, '0')}`],
    ['Уничтожено', r.kills],
    ['Спасено людей', r.rescued],
    ['Разрушено зданий', r.buildings],
    ['Точность', r.accuracy + '%'],
    ['Мирные потери', r.civilians],
  ];
  $('#res-table').innerHTML = rows.map(([k, v], i) => `<div class="res-row" style="--d:${i * 90}ms"><span>${k}</span><b>${v}</b></div>`).join('');
  $$('#res-stars span').forEach((s, i) => {
    s.className = '';
    setTimeout(() => {
      if (i < r.stars) {
        s.className = 'on';
        game.audio.play('pickup');
      }
    }, 600 + i * 380);
  });
  const unlocked = MODULE_ORDER.flatMap((id) => MODULES[id].levels.filter((l) => l.chapter === save.chapter).map((l) => `${MODULES[id].icon} ${l.name}`));
  const skin = Object.entries(SKIN_UNLOCK).find(([, ch]) => ch === save.chapter);
  if (skin) unlocked.push(`🎨 Окраска «${SKINS[skin[0]].name}»`);
  $('#res-unlock').innerHTML = unlocked.length ? `<b>Открыто в ангаре:</b><div class="chips">${unlocked.map((u) => `<span>${u}</span>`).join('')}</div>` : '';
  const credEl = $('#res-credits');
  let shown = 0;
  const step = Math.max(1, Math.round(r.reward / 40));
  const iv = setInterval(() => {
    shown = Math.min(r.reward, shown + step);
    credEl.textContent = shown.toLocaleString('ru-RU');
    if (shown >= r.reward) clearInterval(iv);
  }, 30);
  $('.win-title').textContent = save.chapter >= STORY.length ? 'Кампания пройдена!' : 'Задание выполнено!';
  show('results');
}

// ---------- запуск ----------
async function boot() {
  const fill = $('.loader-fill');
  const text = $('.loader-text');
  fill.style.width = '15%';
  await new Promise((r) => setTimeout(r, 60));
  try {
    game = new Game($('#game'), {
      banner,
      transition: (fn) => transition(fn),
      onPause: () => pauseGame(),
      openMap: () => openMap(),
      offerMission,
      onComplete: (r) => showResults(r),
    }, save);
  } catch (err) {
    text.textContent = 'Не удалось запустить WebGL: ' + err.message;
    return;
  }
  window.__game = game;
  game.audio.setEnabled(save.settings.sound);
  game.audio.setMusic(save.settings.music);
  fill.style.width = '35%';
  text.textContent = 'Рельеф, леса и города острова…';
  await new Promise((r) => setTimeout(r, 40));
  game.startAttract();
  fill.style.width = '85%';
  text.textContent = 'Прогрев шейдеров…';
  await new Promise((r) => setTimeout(r, 40));
  game.renderer.compile(game.scene, game.camera);
  mapScreen = new MapScreen($('#map-screen'), game, () => {
    hideScreens();
    game.pause(false);
  });
  fill.style.width = '100%';
  text.textContent = 'Готово!';
  await new Promise((r) => setTimeout(r, 300));
  const skip = session.get('install-skipped');
  await transition(() => {
    if (!isStandalone() && !skip && !embedded) openInstall();
    else goMenu();
  });
}

function openInstall() {
  const ios = isIOS();
  $('#install-ios').classList.toggle('hidden', !ios);
  $('#btn-install').classList.toggle('hidden', ios);
  $('#install-manual').classList.add('hidden');
  show('install');
}

function pauseGame() {
  if (game.mode !== 'play') return;
  game.pause(true);
  $('#opt-sound-p').checked = save.settings.sound;
  show('pause');
}

function openMap() {
  if (game.mode !== 'play' && current !== 'pause') return;
  game.pause(true);
  show('map-screen');
  requestAnimationFrame(() => mapScreen.open());
}

async function launch() {
  click();
  goFullscreen();
  game.audio.stopMusic();
  await transition(() => {
    hideScreens();
    setGameUI(true);
    game.startCampaign();
  });
}

// ---------- обработчики ----------
$('#btn-install').addEventListener('click', async () => {
  click();
  if (canPrompt()) {
    const res = await promptInstall();
    if (res === 'accepted') {
      session.set('install-skipped', '1');
      goMenu();
    }
  } else {
    $('#install-manual').classList.remove('hidden');
  }
});
$('#btn-skip-install').addEventListener('click', () => {
  click();
  session.set('install-skipped', '1');
  goMenu();
});
$('#btn-menu-install').addEventListener('click', () => {
  click();
  openInstall();
});
onInstallChange(() => {
  if (current === 'menu') refreshMenu();
});

$('#btn-play').addEventListener('click', () => launch());
$('#btn-missions').addEventListener('click', () => {
  click();
  renderStory();
  show('missions');
});
$('#btn-hangar').addEventListener('click', () => {
  click();
  openHangar('menu');
});
$('#btn-hangar-hud').addEventListener('click', () => {
  click();
  openHangar('game');
});
$('#hangar-back').addEventListener('click', closeHangar);
for (const t of $$('.tab'))
  t.addEventListener('click', () => {
    click();
    hangarTab = t.dataset.tab;
    renderHangar();
  });
$('#btn-settings').addEventListener('click', () => {
  click();
  renderSettings();
  show('settings');
});
for (const b of $$('[data-back]'))
  b.addEventListener('click', () => {
    click();
    refreshMenu();
    show(b.dataset.back);
  });

$('#btn-launch').addEventListener('click', () => {
  if (!offerDef || missingRequirements(save, offerDef.requires).length) return;
  click();
  hideScreens();
  game.pause(false);
  game.startStory(offerDef);
});
$('#btn-later').addEventListener('click', () => {
  click();
  hideScreens();
  game.pause(false);
});

for (const b of $$('#quality-seg button'))
  b.addEventListener('click', () => {
    click();
    save.settings.quality = b.dataset.q;
    persist();
    game.setQuality(b.dataset.q);
    renderSettings();
  });
for (const b of $$('#camera-seg button'))
  b.addEventListener('click', () => {
    click();
    save.settings.camera = b.dataset.cam;
    persist();
    renderSettings();
  });
const setSound = (e) => {
  save.settings.sound = e.target.checked;
  persist();
  game.audio.setEnabled(e.target.checked);
};
$('#opt-sound').addEventListener('change', setSound);
$('#opt-sound-p').addEventListener('change', setSound);
$('#opt-music').addEventListener('change', (e) => {
  save.settings.music = e.target.checked;
  persist();
  game.audio.setMusic(e.target.checked);
  if (e.target.checked) {
    game.audio.unlock();
    game.audio.startMusic('menu');
  } else game.audio.stopMusic();
});
$('#opt-vibration').addEventListener('change', (e) => {
  save.settings.vibration = e.target.checked;
  persist();
});
let resetArmed = false;
$('#btn-reset').addEventListener('click', (e) => {
  // подтверждение вторым нажатием: системные диалоги работают не везде
  if (!resetArmed) {
    resetArmed = true;
    e.target.textContent = 'Нажми ещё раз, чтобы сбросить';
    setTimeout(() => {
      resetArmed = false;
      e.target.textContent = 'Сбросить прогресс';
    }, 3000);
    return;
  }
  resetProgress();
  location.reload();
});

$('#btn-pause').addEventListener('click', () => {
  click();
  pauseGame();
});
$('#btn-map').addEventListener('click', () => {
  click();
  openMap();
});
$('#btn-pause-map').addEventListener('click', () => {
  click();
  show('map-screen');
  requestAnimationFrame(() => mapScreen.open());
});
$('#btn-resume').addEventListener('click', () => {
  click();
  hideScreens();
  game.pause(false);
});
$('#btn-quit').addEventListener('click', () => {
  click();
  persist();
  transition(() => goMenu());
});
$('#btn-next').addEventListener('click', () => {
  click();
  hideScreens();
  game.resumeAfterStory();
});
$('#btn-res-hangar').addEventListener('click', () => {
  click();
  game.resumeAfterStory();
  openHangar('game');
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    persist();
    if (game?.mode === 'play') pauseGame();
  }
});
// блокируем двойной тап-зум и жесты iOS
document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('dblclick', (e) => e.preventDefault());

boot();

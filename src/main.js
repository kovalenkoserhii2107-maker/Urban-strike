import { Game, MISSIONS } from './game/game.js';
import { SKINS } from './game/viper.js';
import { save, persist } from './core/save.js';
import { isStandalone, isIOS, canPrompt, promptInstall, onInstallChange, registerSW, goFullscreen } from './pwa.js';

registerSW();

const $ = (s) => document.querySelector(s);
// Встроенная версия (просмотр по ссылке): установка PWA там недоступна.
const embedded = window.__STORMHAWK_EMBED__ === true;
const session = {
  get: (k) => {
    try {
      return session.get(k);
    } catch {
      return null;
    }
  },
  set: (k, v) => {
    try {
      session.set(k, v);
    } catch {
      /* хранилище недоступно */
    }
  },
};
const $$ = (s) => [...document.querySelectorAll(s)];
let current = 'splash';
let game;

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

// ---------- меню ----------
function refreshMenu() {
  $('#menu-credits').textContent = save.credits ? `💰 ${save.credits}` : '';
  $('#btn-menu-install').classList.toggle('hidden', embedded || isStandalone() || (!canPrompt() && !isIOS()));
}

function goMenu() {
  setGameUI(false);
  refreshMenu();
  show('menu');
  if (game.mode !== 'attract') game.startAttract();
  if (save.settings.music) {
    game.audio.unlock();
    game.audio.startMusic('menu');
  }
}

function renderMissions() {
  const list = $('#mission-list');
  list.innerHTML = '';
  MISSIONS.forEach((m, i) => {
    const locked = i + 1 > save.unlocked;
    const stars = save.stars[m.id] || 0;
    const card = document.createElement('button');
    card.className = 'card mission ' + m.lighting + (locked ? ' locked' : '');
    card.innerHTML = `
      <div class="card-num">${i + 1}</div>
      <div class="card-body">
        <h3>${m.name}</h3>
        <div class="muted">${m.place}</div>
        <div class="stars small">${[1, 2, 3].map((s) => `<span class="${s <= stars ? 'on' : ''}">★</span>`).join('')}</div>
        ${save.best[m.id] ? `<div class="muted">Рекорд: ${save.best[m.id].toLocaleString('ru-RU')}</div>` : ''}
      </div>
      ${locked ? '<div class="lock">🔒</div>' : ''}`;
    card.addEventListener('click', () => {
      if (locked) {
        card.classList.remove('shake');
        void card.offsetWidth;
        card.classList.add('shake');
        return;
      }
      click();
      openBriefing(i);
    });
    list.appendChild(card);
  });
}

let briefIndex = 0;
let typer;
function openBriefing(i) {
  briefIndex = i;
  const m = MISSIONS[i];
  $('#brief-name').textContent = m.name;
  $('#brief-place').textContent = m.place;
  $('#brief-goals').innerHTML = m.goals.map((g) => `<li>${g}</li>`).join('');
  const el = $('#brief-story');
  el.textContent = '';
  clearInterval(typer);
  let k = 0;
  typer = setInterval(() => {
    k += 2;
    el.textContent = m.briefing.slice(0, k);
    if (k >= m.briefing.length) clearInterval(typer);
  }, 16);
  show('briefing');
}

async function launch(i) {
  briefIndex = i;
  click();
  goFullscreen();
  game.audio.stopMusic();
  await transition(() => {
    for (const s of $$('.screen')) s.classList.remove('active');
    game.startMission(i);
    setGameUI(true);
    current = 'game';
  });
  banner(MISSIONS[i].name, MISSIONS[i].place);
}

// ---------- ангар ----------
const UPGRADES = [
  { key: 'armor', name: 'Броня', icon: '🛡', desc: '+30 к максимальной броне' },
  { key: 'fuel', name: 'Топливный бак', icon: '⛽', desc: 'Расход топлива −23%' },
  { key: 'gun', name: 'Пулемёт', icon: '🔫', desc: '+30% урона пулемёта' },
  { key: 'rockets', name: 'Ракеты', icon: '🚀', desc: '+20% урона, +10 Hydra, +2 Hellfire' },
];
const COST = [400, 900, 1600];

function renderHangar() {
  $('#hangar-credits').textContent = save.credits.toLocaleString('ru-RU');
  const skins = $('#skin-list');
  skins.innerHTML = '';
  for (const [id, sk] of Object.entries(SKINS)) {
    const b = document.createElement('button');
    b.className = 'skin' + (save.skin === id ? ' on' : '');
    const hex = (n) => '#' + n.toString(16).padStart(6, '0');
    b.innerHTML = `<i style="background: linear-gradient(135deg, ${hex(sk.body)} 55%, ${hex(sk.dark)} 55%)"></i>${sk.name}`;
    b.addEventListener('click', () => {
      click();
      save.skin = id;
      persist();
      renderHangar();
      // в меню вертолёт сразу перекрашивается
      if (game.mode === 'attract') game.startAttract();
    });
    skins.appendChild(b);
  }
  const list = $('#upgrade-list');
  list.innerHTML = '';
  for (const u of UPGRADES) {
    const lvl = save.upgrades[u.key];
    const cost = COST[lvl];
    const card = document.createElement('div');
    card.className = 'card upgrade';
    card.innerHTML = `
      <div class="up-icon">${u.icon}</div>
      <div class="card-body">
        <h3>${u.name}</h3>
        <div class="muted">${u.desc}</div>
        <div class="pips">${[0, 1, 2].map((i) => `<i class="${i < lvl ? 'on' : ''}"></i>`).join('')}</div>
      </div>
      <button class="btn small ${cost && save.credits >= cost ? 'primary' : ''}" ${!cost || save.credits < cost ? 'disabled' : ''}>
        ${cost ? `💰 ${cost}` : 'MAX'}
      </button>`;
    card.querySelector('button').addEventListener('click', () => {
      if (!cost || save.credits < cost) return;
      save.credits -= cost;
      save.upgrades[u.key]++;
      persist();
      game.audio.unlock();
      game.audio.play('pickup');
      renderHangar();
      card.classList.add('bought');
    });
    list.appendChild(card);
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

// ---------- результаты ----------
function showResults(r) {
  const m = MISSIONS[r.index];
  const earned = Math.round(r.score / 10);
  save.credits += earned;
  save.stars[m.id] = Math.max(save.stars[m.id] || 0, r.stars);
  save.best[m.id] = Math.max(save.best[m.id] || 0, r.score);
  save.unlocked = Math.max(save.unlocked, Math.min(r.index + 2, MISSIONS.length));
  persist();
  const mm = Math.floor(r.time / 60), ss = Math.floor(r.time % 60);
  const rows = [
    ['Время', `${mm}:${String(ss).padStart(2, '0')}`],
    ['Уничтожено', r.kills],
    ['Спасено людей', r.rescued],
    ['Разрушено зданий', r.buildings],
    ['Точность', r.accuracy + '%'],
    ['Мирные потери', r.civilians],
    ['Бонус за жизни', '+' + r.bonus],
    ['Счёт', r.score.toLocaleString('ru-RU')],
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
  const credEl = $('#res-credits');
  let shown = 0;
  const step = Math.max(1, Math.round(earned / 40));
  const iv = setInterval(() => {
    shown = Math.min(earned, shown + step);
    credEl.textContent = shown.toLocaleString('ru-RU');
    if (shown >= earned) clearInterval(iv);
  }, 30);
  $('#btn-next').classList.toggle('hidden', r.index + 1 >= MISSIONS.length);
  $('.win-title').textContent = r.index + 1 >= MISSIONS.length ? 'Кампания пройдена!' : 'Миссия выполнена!';
  setGameUI(false);
  show('results');
  if (save.settings.music) game.audio.startMusic('menu');
}

// ---------- запуск ----------
async function boot() {
  const fill = $('.loader-fill');
  const text = $('.loader-text');
  fill.style.width = '25%';
  await new Promise((r) => setTimeout(r, 60));
  try {
    game = new Game($('#game'), {
      banner,
      transition: (fn) => transition(fn),
      onPause: () => pauseGame(),
      onComplete: (r) => showResults(r),
      onGameOver: () => {
        setGameUI(false);
        show('gameover');
      },
    }, save);
  } catch (err) {
    text.textContent = 'Не удалось запустить WebGL: ' + err.message;
    return;
  }
  window.__game = game;
  game.audio.setEnabled(save.settings.sound);
  game.audio.setMusic(save.settings.music);
  fill.style.width = '60%';
  text.textContent = 'Заправляем вертолёт…';
  await new Promise((r) => setTimeout(r, 30));
  game.startAttract();
  fill.style.width = '100%';
  text.textContent = 'Готово!';
  await new Promise((r) => setTimeout(r, 350));
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

$('#btn-play').addEventListener('click', () => {
  click();
  openBriefing(Math.min(save.unlocked, MISSIONS.length) - 1);
});
$('#btn-missions').addEventListener('click', () => {
  click();
  renderMissions();
  show('missions');
});
$('#btn-hangar').addEventListener('click', () => {
  click();
  renderHangar();
  show('hangar');
});
$('#btn-settings').addEventListener('click', () => {
  click();
  renderSettings();
  show('settings');
});
for (const b of $$('[data-back]'))
  b.addEventListener('click', () => {
    click();
    const to = b.dataset.back;
    if (to === 'missions') renderMissions();
    if (to === 'menu') refreshMenu();
    show(to);
  });
$('#btn-launch').addEventListener('click', () => launch(briefIndex));

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
$('#opt-sound').addEventListener('change', (e) => {
  save.settings.sound = e.target.checked;
  persist();
  game.audio.setEnabled(e.target.checked);
});
$('#opt-sound-p').addEventListener('change', (e) => {
  save.settings.sound = e.target.checked;
  persist();
  game.audio.setEnabled(e.target.checked);
});
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
  resetArmed = false;
  e.target.textContent = 'Сбросить прогресс';
  Object.assign(save, { unlocked: 1, stars: {}, best: {}, credits: 0, upgrades: { armor: 0, fuel: 0, gun: 0, rockets: 0 } });
  persist();
  refreshMenu();
  show('menu');
});

$('#btn-pause').addEventListener('click', () => {
  click();
  pauseGame();
});
$('#btn-resume').addEventListener('click', () => {
  click();
  for (const s of $$('.screen')) s.classList.remove('active');
  current = 'game';
  game.pause(false);
});
$('#btn-restart').addEventListener('click', () => {
  for (const s of $$('.screen')) s.classList.remove('active');
  launch(game.missionIndex);
});
$('#btn-quit').addEventListener('click', () => {
  click();
  game.audio.stopRotor();
  transition(() => goMenu());
});
$('#btn-next').addEventListener('click', () => {
  click();
  openBriefing(Math.min(briefIndex + 1, MISSIONS.length - 1));
});
$('#btn-res-hangar').addEventListener('click', () => {
  click();
  transition(() => {
    goMenu();
    renderHangar();
    show('hangar');
  });
});
$('#btn-res-menu').addEventListener('click', () => {
  click();
  transition(() => goMenu());
});
$('#btn-retry').addEventListener('click', () => launch(game.missionIndex));
$('#btn-go-hangar').addEventListener('click', () => {
  click();
  transition(() => {
    goMenu();
    renderHangar();
    show('hangar');
  });
});
$('#btn-go-menu').addEventListener('click', () => {
  click();
  transition(() => goMenu());
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden && game?.mode === 'play') pauseGame();
});
// блокируем двойной тап-зум и жесты iOS
document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('dblclick', (e) => e.preventDefault());

boot();

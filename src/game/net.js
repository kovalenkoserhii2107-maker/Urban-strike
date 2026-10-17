// Совместная игра: подключение по короткому коду комнаты.
//
// Как это работает для игрока: ведущий нажимает «Создать игру» и
// получает код из 4 символов (и ссылку, которой можно поделиться);
// напарник вводит код или открывает ссылку — и всё. IP-адреса,
// серверы и обмен длинными кодами больше не нужны.
//
// Транспорт выбирается сам:
// 1) WebRTC P2P через PeerJS — по умолчанию. Публичный сервер PeerJS
//    нужен только чтобы «познакомить» телефоны; игровые данные идут
//    напрямую между устройствами (по Wi-Fi — внутри сети).
// 2) WebSocket через server.js — если игра открыта с этого сервера
//    (локальная сеть без интернета). Код комнаты тот же.
//
// Надёжность: важные события идут по надёжному каналу, частые снимки
// позиций — по быстрому (без очерёдности). Сердцебиение раз в секунду:
// если напарник молчит 6 с, соединение считается потерянным и
// восстанавливается само в течение 30 с, без действий игроков.

import { Peer } from 'peerjs';

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // без 0/O и 1/I/L — их легко спутать
const CODE_LEN = 4;
const PEER_PREFIX = 'stormhawk-v1-';
const PING_MS = 1000;
const SILENT_MS = 6000;
const RECONNECT_MS = 30000;
const RETRY_MS = 2500;
const CONNECT_MS = 10000; // сколько ждём, пока поднимется новое соединение

export const ROOM_CODE_LEN = CODE_LEN;
export const newRoomCode = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(CODE_LEN)), (b) => ALPHABET[b % ALPHABET.length]).join('');
// Кириллица, похожая на латиницу: код часто набирают на русской раскладке.
const LOOKALIKE = { А: 'A', В: 'B', Е: 'E', К: 'K', М: 'M', Н: 'H', Р: 'P', С: 'C', Т: 'T', У: 'Y', Х: 'X' };
export const cleanRoomCode = (s) =>
  String(s || '')
    .toUpperCase()
    .split('')
    .map((c) => LOOKALIKE[c] || c)
    .filter((c) => ALPHABET.includes(c))
    .join('')
    .slice(0, CODE_LEN);

/** Ссылка-приглашение: открывший её сразу подключается к игре. */
export function inviteLink(code) {
  const u = new URL(location.href);
  u.search = '';
  u.hash = '';
  u.searchParams.set('coop', code);
  return u.toString();
}

const ICE = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
];

// Отладка: ?peer=host:port — свой сервер PeerJS вместо публичного.
function peerOptions() {
  const custom = new URLSearchParams(location.search).get('peer');
  const base = { config: { iceServers: ICE }, debug: 0 };
  if (!custom) return base;
  const [host, port] = custom.split(':');
  return { ...base, host, port: Number(port) || 9000, path: '/', secure: location.protocol === 'https:' };
}

/** Игра открыта с server.js? Тогда работаем через него — интернет не нужен. */
async function localServer() {
  if (!/^https?:$/.test(location.protocol)) return false;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 1500);
    const res = await fetch(new URL('__coop', location.href), { cache: 'no-store', signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) return false;
    return (await res.json())?.coop === true;
  } catch {
    return false;
  }
}

const ERRORS = {
  'peer-unavailable': 'Игра с таким кодом не найдена. Проверьте код или попросите напарника создать игру заново.',
  network: 'Нет связи с сервером соединения. Проверьте интернет и попробуйте ещё раз.',
  'server-error': 'Сервер соединения недоступен. Попробуйте через минуту.',
  'socket-error': 'Нет связи с сервером соединения. Проверьте интернет.',
  'socket-closed': 'Связь с сервером соединения прервалась.',
  'browser-incompatible': 'Этот браузер не поддерживает совместную игру. Откройте игру в Safari или Chrome.',
  webrtc: 'Не удалось связать устройства напрямую. Подключите оба телефона к одной сети Wi-Fi.',
  no_host: 'Игра с таким кодом не найдена. Проверьте код или попросите напарника создать игру заново.',
  full: 'В этой игре уже два пилота.',
  ws: 'Нет связи с сервером игры.',
};

export class NetworkManager {
  constructor(game) {
    this.game = game;
    this.role = 'none'; // 'host' | 'client' | 'none'
    this.transport = 'none'; // 'peer' | 'ws'
    // idle → connecting → waiting (ведущий ждёт) → connected ⇄ reconnecting
    this.status = 'idle';
    this.code = '';
    this.ping = 0;
    this.handlers = new Map();
    this.snapshotInterval = 1 / 20; // снимки мира от ведущего
    this.snapshotTimer = 0;
    this.inputInterval = 1 / 20; // позиция ведомого
    this.inputTimer = 0;
    this.seq = 0;
    this.remoteStats = { skin: 'jungle', modules: {} };
    this.peer = null;
    this.rel = null; // надёжный канал: события
    this.fast = null; // быстрый канал: снимки
    this.ws = null;
    this.lastHeard = 0;
    this.lostAt = 0;
    this.timer = null;
    this.retryT = null;
  }

  on(event, fn) {
    if (!this.handlers.has(event)) this.handlers.set(event, []);
    this.handlers.get(event).push(fn);
  }

  emit(event, data) {
    for (const fn of this.handlers.get(event) || []) {
      try {
        fn(data);
      } catch (e) {
        console.warn('net handler', event, e);
      }
    }
  }

  get isConnected() {
    return this.status === 'connected';
  }
  get isHost() {
    return this.role === 'host';
  }
  get isClient() {
    return this.role === 'client';
  }

  setStatus(status) {
    this.status = status;
    this.emit('status', { status, role: this.role, code: this.code, transport: this.transport });
  }

  fail(reason) {
    const text = ERRORS[reason] || 'Не удалось подключиться. Попробуйте ещё раз.';
    this.leave();
    this.emit('error', text);
  }

  // ---------------- Ведущий ----------------
  async host() {
    this.leave();
    this.role = 'host';
    this.setStatus('connecting');
    this.transport = (await localServer()) ? 'ws' : 'peer';
    if (this.role !== 'host') return; // передумали, пока проверяли сервер
    if (this.transport === 'ws') this.hostWS(newRoomCode());
    else this.hostPeer(newRoomCode(), 0);
  }

  hostPeer(code, attempt) {
    this.code = code;
    const peer = new Peer(PEER_PREFIX + code, peerOptions());
    this.peer = peer;
    peer.on('open', () => {
      if (this.peer !== peer) return;
      this.setStatus('waiting');
      this.startHeartbeat();
    });
    peer.on('connection', (conn) => this.acceptPeer(conn));
    peer.on('disconnected', () => this.keepSignaling(peer));
    peer.on('error', (err) => {
      if (this.peer !== peer) return;
      if (err.type === 'unavailable-id' && attempt < 5) {
        this.peer = null;
        peer.destroy();
        this.hostPeer(newRoomCode(), attempt + 1);
      } else if (this.status === 'connecting') {
        this.fail(err.type);
      }
    });
  }

  // Связь с сервером знакомств пропала — игровой канал живёт сам по
  // себе, а для переподключения напарника сервер ещё понадобится.
  keepSignaling(peer) {
    setTimeout(() => {
      if (this.peer === peer && !peer.destroyed && peer.disconnected) peer.reconnect();
    }, 1500);
  }

  acceptPeer(conn) {
    const label = conn.label === 'fast' ? 'fast' : 'rel';
    // третий пилот не нужен; тот же напарник после обрыва — пожалуйста
    const cur = this[label];
    if (cur?.open && cur.peer !== conn.peer && this.status === 'connected') {
      conn.on('open', () => {
        conn.send(JSON.stringify({ type: 'room_error', reason: 'full' }));
        setTimeout(() => conn.close(), 300);
      });
      return;
    }
    this.bindConn(conn, label);
  }

  // ---------------- Ведомый ----------------
  async join(rawCode) {
    const code = cleanRoomCode(rawCode);
    if (code.length !== CODE_LEN) {
      this.emit('error', 'Код игры — 4 символа.');
      return;
    }
    this.leave();
    this.role = 'client';
    this.code = code;
    this.setStatus('connecting');
    this.transport = (await localServer()) ? 'ws' : 'peer';
    if (this.role !== 'client') return;
    if (this.transport === 'ws') {
      this.joinWS(code);
      return;
    }
    const peer = new Peer(peerOptions());
    this.peer = peer;
    peer.on('open', () => {
      if (this.peer !== peer) return;
      this.startHeartbeat();
      this.connectToHost();
    });
    peer.on('disconnected', () => this.keepSignaling(peer));
    peer.on('error', (err) => {
      // при переподключении ошибки ожидаемы — следующая попытка по таймеру
      if (this.peer === peer && this.status === 'connecting') this.fail(err.type);
    });
  }

  connectToHost() {
    if (!this.peer || this.peer.destroyed || !this.peer.open) return;
    const id = PEER_PREFIX + this.code;
    this.connStartedAt = performance.now();
    this.bindConn(this.peer.connect(id, { label: 'rel', reliable: true, serialization: 'raw' }), 'rel');
    this.bindConn(this.peer.connect(id, { label: 'fast', reliable: false, serialization: 'raw' }), 'fast');
  }

  bindConn(conn, label) {
    const old = this[label];
    if (old && old !== conn) {
      try {
        old.close();
      } catch {
        /* уже закрыт */
      }
    }
    this[label] = conn;
    conn.on('open', () => {
      if (label === 'rel' && this[label] === conn) this.linkUp();
    });
    conn.on('data', (raw) => this.handleMessage(raw));
    const down = () => {
      if (this[label] === conn && label === 'rel') this.linkDown();
    };
    conn.on('close', down);
    conn.on('error', down);
  }

  // ---------------- WebSocket через server.js ----------------
  wsUrl() {
    const u = new URL('__coop', location.href);
    u.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return u.toString();
  }

  hostWS(code) {
    this.code = code;
    this.openWS({ type: 'join_room', room: code, role: 'host' });
  }

  joinWS(code) {
    this.openWS({ type: 'join_room', room: code, role: 'client' });
  }

  openWS(joinMsg) {
    let ws;
    try {
      ws = new WebSocket(this.wsUrl());
    } catch {
      this.fail('ws');
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      if (this.ws === ws) ws.send(JSON.stringify(joinMsg));
    };
    ws.onmessage = (e) => {
      if (this.ws === ws) this.handleMessage(e.data);
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      if (this.status === 'connecting') this.fail('ws');
      else if (this.status !== 'idle') this.linkDown();
    };
    if (!this.timer) this.startHeartbeat();
  }

  // ---------------- Связь есть / пропала ----------------
  linkUp() {
    const was = this.status;
    this.lastHeard = performance.now();
    this.lostAt = 0;
    clearTimeout(this.retryT);
    this.setStatus('connected');
    this.sendHello();
    if (was === 'reconnecting') this.emit('link_restored');
  }

  linkDown() {
    if (this.status === 'connected') {
      this.lostAt = performance.now();
      this.setStatus('reconnecting');
      this.emit('link_lost');
      this.retryT = setTimeout(() => this.retry(), 600);
    } else if (this.status === 'connecting' && this.role === 'client' && this.transport === 'peer') {
      this.fail('webrtc');
    } else if (this.status === 'waiting' && this.transport === 'ws') {
      // ведущий потерял сервер, ещё никого не дождавшись
      this.fail('ws');
    }
  }

  retry() {
    clearTimeout(this.retryT);
    if (this.status !== 'reconnecting') return;
    if (performance.now() - this.lostAt > RECONNECT_MS) {
      this.giveUp();
      return;
    }
    // ведомый сам стучится к ведущему; ведущий ждёт (по WebSocket —
    // заново занимает свою комнату на сервере)
    if (this.transport === 'peer') {
      // Новое соединение — только если старое закрыто или «молчит»
      // давно; иначе не мешаем ему подняться (WebRTC бывает медленным).
      const now = performance.now();
      const settled = now - (this.connStartedAt || 0) > CONNECT_MS;
      const stale = !this.rel || (!this.rel.open ? settled : settled && now - this.lastHeard > CONNECT_MS);
      if (this.role === 'client' && stale) this.connectToHost();
    } else if (!this.ws) {
      if (this.role === 'client') this.joinWS(this.code);
      else this.hostWS(this.code);
    }
    this.retryT = setTimeout(() => this.retry(), RETRY_MS);
  }

  giveUp() {
    const role = this.role;
    this.leave();
    this.emit('peer_disconnected', { role });
  }

  startHeartbeat() {
    clearInterval(this.timer);
    this.timer = setInterval(() => {
      // пингуем и при потерянной связи: если канал просто «замолчал»
      // (телефон свернули), первый же ответ вернёт сессию
      if (this.status !== 'connected' && this.status !== 'reconnecting') return;
      this.raw(JSON.stringify({ type: 'ping', t: performance.now() }), this.rel);
      if (this.status === 'connected' && performance.now() - this.lastHeard > SILENT_MS) this.linkDown();
    }, PING_MS);
  }

  sendHello() {
    this.send({
      type: 'hello',
      role: this.role,
      skin: this.game.save?.skin || 'marines',
      modules: this.game.save?.modules || {},
    });
  }

  // ---------------- Передача данных ----------------
  /** Надёжная отправка (события: выстрелы, спасение, старт). */
  send(obj) {
    if (this.status !== 'connected') return false;
    return this.raw(JSON.stringify(obj), this.rel);
  }

  /** Быстрая отправка: частые снимки, потеря одного не страшна. */
  sendFast(obj) {
    if (this.status !== 'connected') return false;
    return this.raw(JSON.stringify(obj), this.fast?.open ? this.fast : this.rel);
  }

  raw(str, conn) {
    try {
      if (this.transport === 'ws') {
        if (this.ws?.readyState !== WebSocket.OPEN) return false;
        this.ws.send(str);
        return true;
      }
      if (!conn?.open) return false;
      conn.send(str);
      return true;
    } catch {
      return false;
    }
  }

  handleMessage(raw) {
    let msg;
    try {
      msg = typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch {
      return;
    }
    if (!msg || typeof msg.type !== 'string') return;
    this.lastHeard = performance.now();
    const live = this.transport === 'ws' ? this.ws?.readyState === WebSocket.OPEN : this.rel?.open;
    if (this.status === 'reconnecting' && live && !msg.type.startsWith('room_') && !msg.type.startsWith('peer_')) this.linkUp();
    switch (msg.type) {
      // служебные сообщения server.js
      case 'room_joined':
        if (this.role === 'client' || msg.peers >= 2) this.linkUp();
        else if (this.status === 'connecting') this.setStatus('waiting');
        break;
      case 'peer_joined':
        this.linkUp();
        break;
      case 'peer_left':
        if (this.status === 'connected') this.linkDown();
        break;
      case 'room_error':
        if (this.status === 'reconnecting') break; // ждём, пока ведущий вернётся
        if (msg.reason === 'taken' && this.role === 'host' && this.transport === 'ws') {
          this.code = newRoomCode();
          this.raw(JSON.stringify({ type: 'join_room', room: this.code, role: 'host' }));
          break;
        }
        this.fail(msg.reason);
        break;
      // игровые
      case 'ping':
        this.raw(JSON.stringify({ type: 'pong', t: msg.t }), this.rel);
        break;
      case 'pong':
        this.ping = Math.round(performance.now() - msg.t);
        this.emit('ping', this.ping);
        break;
      case 'hello':
        this.remoteStats.skin = msg.skin || 'jungle';
        this.remoteStats.modules = msg.modules || {};
        this.emit('peer_hello', msg);
        break;
      case 'start':
        this.emit('start', msg);
        break;
      case 'bye':
        this.giveUp();
        break;
      case 'state':
        this.emit('remote_state', msg);
        break;
      case 'snapshot':
        this.emit('world_snapshot', msg);
        break;
      case 'fire':
        this.emit('remote_fire', msg);
        break;
      case 'flare':
        this.emit('remote_flare', msg);
        break;
      case 'revive':
        this.emit('remote_revive', msg);
        break;
      case 'pilot_down':
        this.emit('remote_pilot_down', msg);
        break;
      case 'story':
        this.emit('story', msg);
        break;
      case 'picked':
        this.emit('picked', msg);
        break;
      case 'rescued':
        this.emit('rescued', msg);
        break;
      case 'toast':
        this.emit('chat_toast', msg.text);
        break;
    }
  }

  /** Выйти из совместной игры; напарнику — «пока», чтобы он не ждал. */
  leave() {
    if (this.status === 'connected' || this.status === 'reconnecting') this.raw(JSON.stringify({ type: 'bye' }), this.rel);
    clearInterval(this.timer);
    clearTimeout(this.retryT);
    this.timer = this.retryT = null;
    for (const c of [this.rel, this.fast]) {
      try {
        c?.close();
      } catch {
        /* уже закрыт */
      }
    }
    this.rel = this.fast = null;
    const ws = this.ws;
    this.ws = null;
    try {
      ws?.close();
    } catch {
      /* уже закрыт */
    }
    const peer = this.peer;
    this.peer = null;
    try {
      peer?.destroy();
    } catch {
      /* уже закрыт */
    }
    this.role = 'none';
    this.code = '';
    this.ping = 0;
    if (this.status !== 'idle') this.setStatus('idle');
  }
}

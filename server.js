#!/usr/bin/env node
// Stormhawk: сервер для совместной игры в локальной сети без интернета.
// Без зависимостей — только стандартные модули Node.js.
//
//   npm run coop   → собирает игру и запускает сервер
//
// Оба игрока открывают адрес, который сервер напечатает, и дальше всё как
// обычно: «Создать игру» → код из 4 символов → напарник вводит код.
// Игра сама понимает, что открыта с этого сервера, и ходит через него.

import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(ROOT, 'dist');
const PORT = Number(process.env.PORT) || 8080;
const MAX_FRAME = 1 << 20; // 1 МБ: снимки мира — единицы килобайт
const ROOM_TTL = 60_000; // пустая комната живёт минуту — на случай переподключения

if (!fs.existsSync(path.join(DIST, 'index.html'))) {
  console.error('Нет собранной игры (папка dist). Запустите: npm run coop');
  process.exit(1);
}

function localIPs() {
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const n of list || []) if (n.family === 'IPv4' && !n.internal) out.push({ name, address: n.address });
  }
  return out;
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

// Отдаём только собранную игру из dist/ — и ничего за её пределами
// (раньше по «/../» можно было скачать любой файл с компьютера).
const server = http.createServer((req, res) => {
  let url;
  try {
    url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  } catch {
    res.writeHead(400).end();
    return;
  }
  if (url === '/__coop') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ coop: true }));
    return;
  }
  if (url.endsWith('/')) url += 'index.html';
  const file = path.normalize(path.join(DIST, url));
  if (!file.startsWith(DIST + path.sep)) {
    res.writeHead(403).end();
    return;
  }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Не найдено');
      return;
    }
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': ext === '.html' || file.endsWith('sw.js') ? 'no-cache' : 'public, max-age=3600',
    });
    fs.createReadStream(file).pipe(res);
  });
});

// ---------------- WebSocket (RFC 6455), минимально ----------------
function frame(text) {
  const payload = Buffer.from(text);
  const len = payload.length;
  let head;
  if (len < 126) head = Buffer.from([0x81, len]);
  else if (len <= 0xffff) {
    head = Buffer.alloc(4);
    head[0] = 0x81;
    head[1] = 126;
    head.writeUInt16BE(len, 2);
  } else {
    head = Buffer.alloc(10);
    head[0] = 0x81;
    head[1] = 127;
    head.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([head, payload]);
}

function send(sock, data) {
  if (!sock || sock.destroyed) return;
  try {
    sock.write(frame(typeof data === 'string' ? data : JSON.stringify(data)));
  } catch {
    /* сокет уже закрыт */
  }
}

// rooms: код → { host, client, emptySince }
const rooms = new Map();

function other(sock) {
  const r = rooms.get(sock.room);
  if (!r) return null;
  return sock.role === 'host' ? r.client : r.host;
}

function joinRoom(sock, msg) {
  const code = String(msg.room || '').toUpperCase().slice(0, 8);
  const role = msg.role === 'host' ? 'host' : 'client';
  let r = rooms.get(code);
  if (!code || (role === 'client' && !r?.host)) return send(sock, { type: 'room_error', reason: 'no_host' });
  if (!r) rooms.set(code, (r = { host: null, client: null, emptySince: 0 }));
  const cur = r[role];
  if (cur && !cur.destroyed && cur !== sock) {
    // место занято живым игроком: для ведущего — код занят, для ведомого — комната полна
    return send(sock, { type: 'room_error', reason: role === 'host' ? 'taken' : 'full' });
  }
  r[role] = sock;
  r.emptySince = 0;
  sock.room = code;
  sock.role = role;
  const peer = other(sock);
  send(sock, { type: 'room_joined', room: code, role, peers: peer ? 2 : 1 });
  if (peer) send(peer, { type: 'peer_joined', role });
}

function leaveRoom(sock) {
  const r = rooms.get(sock.room);
  if (!r || r[sock.role] !== sock) return;
  r[sock.role] = null;
  const peer = sock.role === 'host' ? r.client : r.host;
  if (peer) send(peer, { type: 'peer_left', role: sock.role });
  if (!r.host && !r.client) r.emptySince = Date.now();
}

setInterval(() => {
  const now = Date.now();
  for (const [code, r] of rooms) if (r.emptySince && now - r.emptySince > ROOM_TTL) rooms.delete(code);
}, 10_000).unref();

server.on('upgrade', (req, sock) => {
  const key = req.headers['sec-websocket-key'];
  if (!key || !req.url.startsWith('/__coop')) {
    sock.destroy();
    return;
  }
  const accept = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  sock.write(
    'HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
  );
  sock.setNoDelay(true);
  sock.room = null;
  sock.role = null;
  let buf = Buffer.alloc(0);
  let parts = []; // фрагменты длинного сообщения

  sock.on('data', (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    while (buf.length >= 2) {
      const fin = (buf[0] & 0x80) !== 0;
      const op = buf[0] & 0x0f;
      const masked = (buf[1] & 0x80) !== 0;
      let len = buf[1] & 0x7f;
      let off = 2;
      if (len === 126) {
        if (buf.length < 4) return;
        len = buf.readUInt16BE(2);
        off = 4;
      } else if (len === 127) {
        if (buf.length < 10) return;
        len = Number(buf.readBigUInt64BE(2));
        off = 10;
      }
      if (len > MAX_FRAME) {
        sock.destroy();
        return;
      }
      const need = off + (masked ? 4 : 0) + len;
      if (buf.length < need) return;
      let payload = buf.subarray(off + (masked ? 4 : 0), need);
      if (masked) {
        const mask = buf.subarray(off, off + 4);
        payload = Buffer.from(payload);
        for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
      }
      buf = buf.subarray(need);

      if (op === 0x8) {
        try {
          sock.end(Buffer.from([0x88, 0]));
        } catch {
          /* уже закрыт */
        }
        return;
      }
      if (op === 0x9) {
        // pong с тем же содержимым (управляющие кадры короче 126 байт)
        sock.write(Buffer.concat([Buffer.from([0x8a, payload.length]), payload]));
        continue;
      }
      if (op === 0xa) continue;
      if (op === 0x1 || op === 0x0) {
        parts.push(payload);
        if (!fin) continue;
        const text = Buffer.concat(parts).toString('utf8');
        parts = [];
        onMessage(sock, text);
      }
    }
  });
  sock.on('close', () => leaveRoom(sock));
  sock.on('error', () => sock.destroy());
});

function onMessage(sock, text) {
  let msg;
  try {
    msg = JSON.parse(text);
  } catch {
    return;
  }
  if (msg?.type === 'join_room') {
    joinRoom(sock, msg);
    return;
  }
  // всё остальное — напарнику по комнате, как есть
  send(other(sock), text);
}

server.listen(PORT, '0.0.0.0', () => {
  const ips = localIPs();
  console.log('==============================================================');
  console.log('  🚁 STORMHAWK: сервер совместной игры запущен');
  console.log('==============================================================');
  if (ips.length) {
    console.log('  Откройте на обоих телефонах (одна сеть Wi-Fi):');
    for (const ip of ips) console.log(`    http://${ip.address}:${PORT}   (${ip.name})`);
  } else {
    console.log('  Подключите компьютер к Wi-Fi, чтобы зайти с телефонов.');
  }
  console.log(`  На этом компьютере: http://localhost:${PORT}`);
  console.log('  Дальше: «Совместно» → «Создать игру» → напарник вводит код.');
  console.log('==============================================================');
});

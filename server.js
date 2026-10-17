#!/usr/bin/env node
// Stormhawk Local Wi-Fi Co-op Server (Zero Dependencies)
// Работает на стандартных модулях Node.js (http, crypto, fs, os, path).

import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 8080;
const ROOT = path.resolve(__dirname);

// Определение локальных IPv4-адресов в Wi-Fi сети
function getLocalIPs() {
  const ips = [];
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        ips.push({ name, address: net.address });
      }
    }
  }
  return ips;
}

// MIME-типы для раздачи статики
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
};

// Простой HTTP сервер
const server = http.createServer((req, res) => {
  let url = req.url.split('?')[0];
  if (url === '/') url = '/index.html';

  let filePath = path.join(ROOT, 'dist', url);
  if (!fs.existsSync(filePath)) {
    filePath = path.join(ROOT, url);
  }

  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    fs.createReadStream(filePath).pipe(res);
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('404 Not Found');
  }
});

// ---------------- WebSocket Relay (RFC 6455) ----------------
const rooms = new Map();

function sendFrame(socket, data) {
  const payload = Buffer.from(typeof data === 'string' ? data : JSON.stringify(data));
  const len = payload.length;
  let header;

  if (len < 126) {
    header = Buffer.from([0x81, len]);
  } else if (len <= 65535) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }

  try {
    socket.write(Buffer.concat([header, payload]));
  } catch {
    /* ошибка сокета */
  }
}

server.on('upgrade', (req, socket, head) => {
  const key = req.headers['sec-websocket-key'];
  if (!key) {
    socket.destroy();
    return;
  }

  const accept = crypto
    .createHash('sha1')
    .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
    .digest('base64');

  const headers = [
    'HTTP/1.1 101 Switching Protocols',
    'Upgrade: websocket',
    'Connection: Upgrade',
    `Sec-WebSocket-Accept: ${accept}`,
    '',
    '',
  ];
  socket.write(headers.join('\r\n'));

  socket.room = null;
  socket.role = null;

  let buffer = Buffer.alloc(0);

  socket.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);

    while (buffer.length >= 2) {
      const b0 = buffer[0];
      const b1 = buffer[1];
      const opcode = b0 & 0x0f;
      const masked = (b1 & 0x80) !== 0;
      let payloadLen = b1 & 0x7f;
      let offset = 2;

      if (payloadLen === 126) {
        if (buffer.length < 4) break;
        payloadLen = buffer.readUInt16BE(2);
        offset = 4;
      } else if (payloadLen === 127) {
        if (buffer.length < 10) break;
        payloadLen = Number(buffer.readBigUInt64BE(2));
        offset = 10;
      }

      const maskSize = masked ? 4 : 0;
      if (buffer.length < offset + maskSize + payloadLen) break;

      let payload = buffer.slice(offset + maskSize, offset + maskSize + payloadLen);
      if (masked) {
        const mask = buffer.slice(offset, offset + 4);
        const unmasked = Buffer.alloc(payloadLen);
        for (let i = 0; i < payloadLen; i++) {
          unmasked[i] = payload[i] ^ mask[i % 4];
        }
        payload = unmasked;
      }

      buffer = buffer.slice(offset + maskSize + payloadLen);

      if (opcode === 0x8) {
        socket.end();
        break;
      } else if (opcode === 0x9) {
        socket.write(Buffer.from([0x8a, 0]));
      } else if (opcode === 0x1) {
        const text = payload.toString('utf8');
        handleClientMessage(socket, text);
      }
    }
  });

  socket.on('close', () => {
    if (socket.room && rooms.has(socket.room)) {
      const set = rooms.get(socket.room);
      set.delete(socket);
      for (const peer of set) {
        sendFrame(peer, { type: 'peer_disconnected' });
      }
      if (set.size === 0) rooms.delete(socket.room);
    }
  });

  socket.on('error', () => {
    socket.destroy();
  });
});

function handleClientMessage(socket, raw) {
  try {
    const msg = JSON.parse(raw);

    if (msg.type === 'join_room') {
      const room = msg.room || 'default';
      socket.room = room;
      socket.role = msg.role || 'client';

      if (!rooms.has(room)) rooms.set(room, new Set());
      const set = rooms.get(room);
      set.add(socket);

      sendFrame(socket, { type: 'room_joined', room, role: socket.role, peers: set.size });

      for (const peer of set) {
        if (peer !== socket) {
          sendFrame(peer, { type: 'peer_joined', role: socket.role });
        }
      }
      return;
    }

    if (socket.room && rooms.has(socket.room)) {
      const set = rooms.get(socket.room);
      for (const peer of set) {
        if (peer !== socket) {
          sendFrame(peer, raw);
        }
      }
    } else {
      // Реле по умолчанию
      for (const [r, set] of rooms) {
        if (set.has(socket)) {
          for (const peer of set) {
            if (peer !== socket) sendFrame(peer, raw);
          }
        }
      }
    }
  } catch {}
}

server.listen(PORT, '0.0.0.0', () => {
  const ips = getLocalIPs();
  console.log('===============================================================');
  console.log('  🚁 STORMHAWK: ЛОКАЛЬНЫЙ WI-FI СЕРВЕР СОВМЕСТНОЙ ИГРЫ ЗАПУЩЕН');
  console.log('===============================================================');
  console.log(`  Порт: ${PORT}`);
  console.log('  Локальный доступ на этом ПК:');
  console.log(`    http://localhost:${PORT}`);
  if (ips.length > 0) {
    console.log('  Для подключения со второго телефона или ПК в этой сети Wi-Fi:');
    for (const iface of ips) {
      console.log(`    http://${iface.address}:${PORT}  (${iface.name})`);
    }
  } else {
    console.log('  Подключитесь к Wi-Fi для сетевой игры!');
  }
  console.log('===============================================================');
});

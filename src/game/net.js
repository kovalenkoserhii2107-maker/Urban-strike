// Сетевой менеджер для совместной игры по Wi-Fi / LAN.
// Поддерживает:
// 1) WebSocket (подключение к локальному серверу по IP)
// 2) WebRTC DataChannel (прямое P2P соединение браузер-к-браузеру без сервера)

export class NetworkManager {
  constructor(game) {
    this.game = game;
    this.role = 'none'; // 'host' | 'client' | 'none'
    this.transport = 'none'; // 'ws' | 'webrtc'
    this.status = 'disconnected'; // 'disconnected' | 'connecting' | 'connected'
    this.ws = null;
    this.pc = null;
    this.dc = null;
    this.handlers = new Map();
    this.ping = 0;
    this.lastPingTime = 0;
    this.snapshotInterval = 1 / 25; // 25 Hz снимки мира от хоста
    this.snapshotTimer = 0;
    this.inputInterval = 1 / 30; // 30 Hz ввод/позиция от клиента
    this.inputTimer = 0;
    this.remoteStats = { hp: 100, maxHp: 100, fuel: 100, alive: true, skin: 'marines' };
    this.seq = 0;
  }

  on(event, fn) {
    if (!this.handlers.has(event)) this.handlers.set(event, []);
    this.handlers.get(event).push(fn);
  }

  emit(event, data) {
    const list = this.handlers.get(event);
    if (list) for (const fn of list) fn(data);
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

  // ---------------- WebSocket режим ----------------
  connectWS(url, role, onReady, onError) {
    this.disconnect();
    this.role = role;
    this.transport = 'ws';
    this.status = 'connecting';
    this.emit('status', { status: 'connecting', role });

    try {
      this.ws = new WebSocket(url);
      this.ws.onopen = () => {
        this.status = 'connected';
        this.emit('status', { status: 'connected', role });
        this.startPing();
        // Отправляем приветственное рукопожатие
        this.send({
          type: 'hello',
          role: this.role,
          skin: this.game.save.skin || 'marines',
          modules: this.game.save.modules || {},
        });
        if (onReady) onReady();
      };
      this.ws.onmessage = (e) => this.handleMessage(e.data);
      this.ws.onclose = () => {
        this.status = 'disconnected';
        this.emit('status', { status: 'disconnected', role: this.role });
        this.emit('disconnected');
      };
      this.ws.onerror = (err) => {
        if (onError) onError(err);
      };
    } catch (err) {
      this.status = 'disconnected';
      if (onError) onError(err);
    }
  }

  // ---------------- WebRTC DataChannel (P2P) ----------------
  async initWebRTC(role, onSignal, onReady, onError) {
    this.disconnect();
    this.role = role;
    this.transport = 'webrtc';
    this.status = 'connecting';
    this.emit('status', { status: 'connecting', role });

    const config = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
      ],
    };

    try {
      this.pc = new RTCPeerConnection(config);

      this.pc.onicecandidate = (e) => {
        if (e.candidate) {
          onSignal({ type: 'candidate', candidate: e.candidate });
        }
      };

      if (role === 'host') {
        this.dc = this.pc.createDataChannel('stormhawk', { ordered: false, maxRetransmits: 0 });
        this.setupDataChannel(onReady);

        const offer = await this.pc.createOffer();
        await this.pc.setLocalDescription(offer);
        if (onSignal) onSignal({ type: 'offer', sdp: offer.sdp });
      } else {
        this.pc.ondatachannel = (e) => {
          this.dc = e.channel;
          this.setupDataChannel(onReady);
        };
      }
    } catch (err) {
      this.status = 'disconnected';
      if (onError) onError(err);
    }
  }

  async handleWebRTCSignal(signal) {
    if (!this.pc) return;
    try {
      if (signal.type === 'offer') {
        await this.pc.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp: signal.sdp }));
        const answer = await this.pc.createAnswer();
        await this.pc.setLocalDescription(answer);
        return { type: 'answer', sdp: answer.sdp };
      } else if (signal.type === 'answer') {
        await this.pc.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp: signal.sdp }));
      } else if (signal.type === 'candidate' && signal.candidate) {
        await this.pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
      }
    } catch (err) {
      console.warn('WebRTC signaling error:', err);
    }
  }

  setupDataChannel(onReady) {
    this.dc.onopen = () => {
      this.status = 'connected';
      this.emit('status', { status: 'connected', role: this.role });
      this.startPing();
      this.send({
        type: 'hello',
        role: this.role,
        skin: this.game.save.skin || 'marines',
        modules: this.game.save.modules || {},
      });
      if (onReady) onReady();
    };
    this.dc.onmessage = (e) => this.handleMessage(e.data);
    this.dc.onclose = () => {
      this.status = 'disconnected';
      this.emit('status', { status: 'disconnected', role: this.role });
      this.emit('disconnected');
    };
  }

  // ---------------- Передача данных ----------------
  send(obj) {
    if (this.status !== 'connected') return;
    try {
      const str = JSON.stringify(obj);
      if (this.transport === 'ws' && this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(str);
      } else if (this.transport === 'webrtc' && this.dc && this.dc.readyState === 'open') {
        this.dc.send(str);
      }
    } catch {
      /* буфер переполнен или разрыв */
    }
  }

  handleMessage(raw) {
    try {
      const msg = JSON.parse(raw);
      switch (msg.type) {
        case 'ping':
          this.send({ type: 'pong', t: msg.t });
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
        case 'pickup':
          this.emit('pickup_event', msg);
          break;
        case 'toast':
          this.emit('chat_toast', msg.text);
          break;
        case 'revive':
          this.emit('remote_revive', msg);
          break;
        case 'pilot_down':
          this.emit('remote_pilot_down', msg);
          break;
      }
    } catch (e) {
      console.warn('Network parse error:', e);
    }
  }

  startPing() {
    if (this.pingInterval) clearInterval(this.pingInterval);
    this.pingInterval = setInterval(() => {
      if (this.status === 'connected') {
        this.send({ type: 'ping', t: performance.now() });
      }
    }, 2000);
  }

  disconnect() {
    if (this.pingInterval) clearInterval(this.pingInterval);
    this.pingInterval = null;
    if (this.ws) {
      try {
        this.ws.close();
      } catch {}
      this.ws = null;
    }
    if (this.dc) {
      try {
        this.dc.close();
      } catch {}
      this.dc = null;
    }
    if (this.pc) {
      try {
        this.pc.close();
      } catch {}
      this.pc = null;
    }
    this.status = 'disconnected';
    this.role = 'none';
  }
}

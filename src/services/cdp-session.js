/**
 * CdpSession — cliente WebSocket CDP persistente.
 *
 * A diferencia de CdpCaller (one-shot: conecta → envía → cierra),
 * CdpSession mantiene la conexión abierta y despacha mensajes entrantes:
 *   - Respuestas (msg.id presente) → resuelven la Promise de send()
 *   - Eventos  (msg.method presente) → invocan handlers registrados con on()
 *
 * Usado por CdpInterceptor para el dominio Fetch (requiere session viva
 * para recibir Fetch.requestPaused y responder con continue/fulfill/fail).
 */

const net = require('net');
const crypto = require('crypto');
const { createWsFrameDecoder } = require('./ws-tap');

function encodeTextFrame(text) {
  const payload = Buffer.from(text, 'utf8');
  const len = payload.length;
  const maskKey = crypto.randomBytes(4);

  let hdr;
  if (len < 126) {
    hdr = Buffer.alloc(6);
    hdr[0] = 0x81; hdr[1] = 0x80 | len;
    maskKey.copy(hdr, 2);
  } else if (len < 65536) {
    hdr = Buffer.alloc(8);
    hdr[0] = 0x81; hdr[1] = 0xFE;
    hdr.writeUInt16BE(len, 2);
    maskKey.copy(hdr, 4);
  } else {
    hdr = Buffer.alloc(14);
    hdr[0] = 0x81; hdr[1] = 0xFF;
    hdr.writeBigUInt64BE(BigInt(len), 2);
    maskKey.copy(hdr, 10);
  }

  const masked = Buffer.allocUnsafe(len);
  for (let i = 0; i < len; i++) masked[i] = payload[i] ^ maskKey[i & 3];
  return Buffer.concat([hdr, masked]);
}

function createCdpSession({ wsUrl, log = () => {} }) {
  let socket     = null;
  let nextId     = 1;
  const pending   = new Map();   // id → { resolve, reject }
  const listeners = new Map();   // method → Set<handler>

  function dispatch(raw) {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.id !== undefined && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message || JSON.stringify(msg.error)));
      else resolve(msg.result ?? {});
      return;
    }

    if (msg.method) {
      const handlers = listeners.get(msg.method);
      if (handlers) {
        for (const h of handlers) {
          try { h(msg.params); } catch (e) { log(`[cdp-session] listener error: ${e.message}`); }
        }
      }
    }
  }

  function send(method, params = {}) {
    return new Promise((resolve, reject) => {
      if (!socket || socket.destroyed) {
        reject(new Error('CdpSession: not connected'));
        return;
      }
      const id = nextId++;
      pending.set(id, { resolve, reject });
      socket.write(encodeTextFrame(JSON.stringify({ id, method, params })));
    });
  }

  // Registra un handler para eventos CDP. Devuelve función de unsubscribe.
  function on(method, handler) {
    if (!listeners.has(method)) listeners.set(method, new Set());
    listeners.get(method).add(handler);
    return () => listeners.get(method)?.delete(handler);
  }

  function connect() {
    return new Promise((resolve, reject) => {
      const u = new URL(wsUrl);
      socket = net.createConnection(parseInt(u.port) || 80, u.hostname);

      const decoder = createWsFrameDecoder(dispatch);
      let httpBuf  = Buffer.alloc(0);
      let upgraded = false;

      socket.on('connect', () => {
        const key  = crypto.randomBytes(16).toString('base64');
        const path = u.pathname + (u.search || '');
        socket.write(
          `GET ${path} HTTP/1.1\r\n` +
          `Host: ${u.hostname}:${u.port}\r\n` +
          `Upgrade: websocket\r\n` +
          `Connection: Upgrade\r\n` +
          `Sec-WebSocket-Key: ${key}\r\n` +
          `Sec-WebSocket-Version: 13\r\n\r\n`
        );
      });

      socket.on('data', chunk => {
        if (!upgraded) {
          httpBuf = Buffer.concat([httpBuf, chunk]);
          const sep = httpBuf.indexOf('\r\n\r\n');
          if (sep === -1) return;
          const header = httpBuf.slice(0, sep).toString();
          if (!header.includes('101')) {
            reject(new Error(`WS upgrade failed: ${header.split('\r\n')[0]}`));
            socket.destroy();
            return;
          }
          upgraded = true;
          const rest = httpBuf.slice(sep + 4);
          httpBuf = null;
          resolve();
          if (rest.length) decoder(rest);
        } else {
          decoder(chunk);
        }
      });

      socket.on('error', err => {
        if (!upgraded) reject(err);
        else log(`[cdp-session] socket error: ${err.message}`);
        for (const [, p] of pending) p.reject(err);
        pending.clear();
      });

      socket.on('close', () => {
        for (const [, p] of pending) p.reject(new Error('CdpSession: socket closed'));
        pending.clear();
      });
    });
  }

  function close() {
    try { socket?.destroy(); } catch {}
    socket = null;
  }

  function isConnected() {
    return !!socket && !socket.destroyed;
  }

  return { connect, send, on, close, isConnected };
}

module.exports = { createCdpSession };

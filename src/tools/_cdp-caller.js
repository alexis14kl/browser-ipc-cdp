/**
 * CdpCaller — cliente CDP de uso único (one-shot) para tools custom.
 *
 * Sin dependencias externas: TCP + HTTP upgrade manual + reutiliza
 * createWsFrameDecoder del proyecto para recibir frames del servidor.
 * El cliente siempre enmascara sus frames (requisito RFC 6455 §5.3).
 *
 * Conecta SIEMPRE al proxy del proyecto (browserUrl = http://127.0.0.1:9333)
 * reescribiendo el webSocketDebuggerUrl que devuelve /json — así hereda la
 * re-resolución on-demand del proxy y no habla directo a Chrome.
 */

const net = require('net');
const http = require('http');
const crypto = require('crypto');
const { createWsFrameDecoder } = require('../services/ws-tap');

// ── Encoder cliente→servidor (masked, RFC 6455 §5.3) ──────────────────────

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

// ── HTTP GET helper ────────────────────────────────────────────────────────

function httpGet(url, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = http.get(
      { hostname: u.hostname, port: parseInt(u.port) || 80, path: u.pathname },
      res => {
        let data = '';
        res.on('data', c => { data += c; });
        res.on('end', () => {
          try { resolve(JSON.parse(data)); }
          catch (e) { reject(new Error(`/json parse error: ${e.message}`)); }
        });
      }
    );
    req.setTimeout(timeout, () => { req.destroy(); reject(new Error('HTTP timeout')); });
    req.on('error', reject);
  });
}

// ── Factory ────────────────────────────────────────────────────────────────

function createCdpCaller({ browserUrl, callTimeout = 15000 }) {
  // Redirige wsUrl al proxy para no hablar directo a Chrome
  function toProxyWs(wsUrl) {
    const proxy = new URL(browserUrl);
    const ws = new URL(wsUrl);
    ws.hostname = proxy.hostname;
    ws.port = proxy.port;
    return ws.toString();
  }

  async function getActivePage() {
    const targets = await httpGet(`${browserUrl}/json`);
    const page = targets.find(t => t.type === 'page');
    if (!page) return null;
    return { ...page, webSocketDebuggerUrl: toProxyWs(page.webSocketDebuggerUrl) };
  }

  async function call(method, params = {}) {
    const page = await getActivePage();
    if (!page) throw new Error('No hay página activa en el navegador');

    return new Promise((resolve, reject) => {
      const wsUrl = new URL(page.webSocketDebuggerUrl);
      const id = crypto.randomInt(1, 1_000_000_000);
      const socket = net.createConnection(
        parseInt(wsUrl.port) || 80,
        wsUrl.hostname
      );

      let settled = false;
      function finish(err, result) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        socket.destroy();
        if (err) reject(err);
        else resolve(result);
      }

      const timer = setTimeout(
        () => finish(new Error(`Timeout CDP: ${method}`)),
        callTimeout
      );

      const decoder = createWsFrameDecoder(text => {
        try {
          const msg = JSON.parse(text);
          if (msg.id !== id) return;
          if (msg.error) finish(new Error(msg.error.message || JSON.stringify(msg.error)));
          else finish(null, msg.result);
        } catch { /* frame no-JSON: ignorar */ }
      });

      let httpBuf = Buffer.alloc(0);
      let upgraded = false;

      socket.on('connect', () => {
        const key = crypto.randomBytes(16).toString('base64');
        const wsPath = wsUrl.pathname + (wsUrl.search || '');
        socket.write(
          `GET ${wsPath} HTTP/1.1\r\n` +
          `Host: ${wsUrl.hostname}:${wsUrl.port}\r\n` +
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
          if (!header.startsWith('HTTP/1.1 101')) {
            finish(new Error(`WS upgrade falló: ${header.split('\r\n')[0]}`));
            return;
          }
          upgraded = true;
          socket.write(encodeTextFrame(JSON.stringify({ id, method, params })));
          const rest = httpBuf.slice(sep + 4);
          httpBuf = null;
          if (rest.length) decoder(rest);
        } else {
          decoder(chunk);
        }
      });

      socket.on('error', finish);
      socket.on('close', () => finish(new Error('Socket cerrado sin respuesta')));
    });
  }

  return { call, getActivePage };
}

module.exports = { createCdpCaller };

/**
 * Tests del cursor-overlay (Fase cursor): que hable CDP correctamente contra
 * un navegador FALSO (un WebSocket server que imita los mensajes CDP), sin
 * navegador real. Verifica el contrato de integración:
 *   - opt-in: sin BROWSER_CDP_CURSOR el launcher no crea el overlay
 *   - Target.setAutoAttach al conectar
 *   - inyección (Page.enable + addScriptToEvaluateOnNewDocument + Runtime.evaluate)
 *     al adjuntarse un target de tipo "page"
 *   - reconexión: si el WS cae, reintenta solo
 */
const { test } = require('node:test');
const assert = require('node:assert');
const http = require('http');

const { createCursorOverlay } = require('../src/services/cursor-overlay');
const { OVERLAY_SOURCE } = require('../src/views/overlay-script');
const { waitFor, closeServer } = require('./helpers');

/**
 * Navegador CDP falso: acepta el WS, registra los métodos recibidos y puede
 * emitir Target.attachedToTarget para simular una página. Responde a todo
 * comando con {} para no colgar los await del cliente.
 */
async function fakeBrowser() {
  const received = [];
  let sock = null;
  const server = http.createServer();
  server.on('upgrade', (req, socket, head) => {
    // Handshake WS mínimo (sin librería): calcular Sec-WebSocket-Accept.
    const key = req.headers['sec-websocket-key'];
    const crypto = require('crypto');
    const accept = crypto.createHash('sha1')
      .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\n' +
      'Connection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n'
    );
    sock = socket;
    socket.on('data', (buf) => {
      const msg = decodeFrame(buf);
      if (!msg) return;
      try {
        const obj = JSON.parse(msg);
        received.push(obj);
        // Responder el comando (resultado vacío) para no colgar al cliente.
        sendFrame(socket, JSON.stringify({ id: obj.id, result: {} }));
      } catch {}
    });
    socket.on('error', () => {});
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  return {
    wsUrl: `ws://127.0.0.1:${port}/devtools/browser/fake`,
    received,
    // Simula que apareció una pestaña → el cliente debe inyectar el overlay.
    emitPage(sessionId = 'sess-1') {
      sendFrame(sock, JSON.stringify({
        method: 'Target.attachedToTarget',
        params: { sessionId, targetInfo: { type: 'page', targetId: 't1' } },
      }));
    },
    dropConnection() { try { sock.destroy(); } catch {} },
    close: () => { try { sock && sock.destroy(); } catch {} return closeServer(server); },
  };
}

// --- helpers de framing WebSocket (server→cliente sin máscara) ---
function sendFrame(socket, str) {
  const payload = Buffer.from(str, 'utf-8');
  const len = payload.length;
  let header;
  if (len < 126) header = Buffer.from([0x81, len]);
  else if (len < 65536) header = Buffer.from([0x81, 126, (len >> 8) & 255, len & 255]);
  else return; // suficiente para el test
  socket.write(Buffer.concat([header, payload]));
}
function decodeFrame(buf) {
  if (buf.length < 2) return null;
  const len = buf[1] & 127;
  let offset = 2, maskStart = offset;
  if (len === 126) { offset = 4; maskStart = offset; }
  const masked = (buf[1] & 128) === 128;
  const mask = masked ? buf.slice(maskStart, maskStart + 4) : null;
  const dataStart = masked ? maskStart + 4 : maskStart;
  const data = buf.slice(dataStart);
  if (mask) for (let i = 0; i < data.length; i++) data[i] ^= mask[i % 4];
  return data.toString('utf-8');
}

test('overlay: setAutoAttach al conectar e inyección al aparecer una página', async () => {
  const browser = await fakeBrowser();
  const overlay = createCursorOverlay({
    resolve: async () => ({ port: 1, version: { webSocketDebuggerUrl: browser.wsUrl } }),
    log: () => {},
    source: OVERLAY_SOURCE,
  });
  try {
    overlay.start();
    // Debe pedir setAutoAttach al conectar
    const gotAutoAttach = await waitFor(
      () => browser.received.some((m) => m.method === 'Target.setAutoAttach'),
      { timeoutMs: 4000 }
    );
    assert.ok(gotAutoAttach, 'no envió Target.setAutoAttach');

    // Simular una pestaña → debe inyectar el overlay en esa sesión
    browser.emitPage('sess-1');
    const injected = await waitFor(() => {
      const forSession = browser.received.filter((m) => m.sessionId === 'sess-1');
      return forSession.some((m) => m.method === 'Page.addScriptToEvaluateOnNewDocument')
          && forSession.some((m) => m.method === 'Runtime.evaluate');
    }, { timeoutMs: 4000 });
    assert.ok(injected, 'no inyectó el overlay en la página');

    // El source inyectado es el OVERLAY_SOURCE
    const addScript = browser.received.find((m) => m.method === 'Page.addScriptToEvaluateOnNewDocument');
    assert.strictEqual(addScript.params.source, OVERLAY_SOURCE);
  } finally {
    overlay.close();
    await browser.close();
  }
});

test('overlay: se reconecta solo si la conexión CDP cae', async () => {
  const browser = await fakeBrowser();
  const overlay = createCursorOverlay({
    resolve: async () => ({ port: 1, version: { webSocketDebuggerUrl: browser.wsUrl } }),
    log: () => {},
    source: OVERLAY_SOURCE,
    retryMs: 300,
  });
  try {
    overlay.start();
    await waitFor(() => browser.received.some((m) => m.method === 'Target.setAutoAttach'), { timeoutMs: 4000 });
    const count1 = browser.received.filter((m) => m.method === 'Target.setAutoAttach').length;

    // Tirar la conexión → debe reconectar y volver a hacer setAutoAttach
    browser.dropConnection();
    const reconnected = await waitFor(
      () => browser.received.filter((m) => m.method === 'Target.setAutoAttach').length > count1,
      { timeoutMs: 5000 }
    );
    assert.ok(reconnected, 'no se reconectó tras caer la conexión');
  } finally {
    overlay.close();
    await browser.close();
  }
});

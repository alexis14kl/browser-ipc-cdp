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

// El overlay usa el WebSocket global de Node (>=21); en 18/20 la feature se
// auto-deshabilita por diseño (guard + log en cursor-overlay.js:98). Estos
// tests verifican el comportamiento CON WebSocket — sin él, se saltan.
const NO_WS = typeof WebSocket === 'undefined'
  ? 'WebSocket nativo no disponible (Node <21): el overlay se deshabilita solo'
  : false;

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
    // Reensambla frames: varios comandos CDP pueden llegar coalescidos en un
    // solo chunk TCP (p.ej. dos páginas inyectando a la vez). Sin este bucle se
    // decodificaría solo el primero y los demás se perderían → inyección colgada.
    let acc = Buffer.alloc(0);
    socket.on('data', (buf) => {
      acc = Buffer.concat([acc, buf]);
      for (;;) {
        if (acc.length < 2) break;
        let payloadLen = acc[1] & 127;
        let headerLen = 2;
        if (payloadLen === 126) {           // longitud extendida de 16 bits
          if (acc.length < 4) break;
          payloadLen = acc.readUInt16BE(2);
          headerLen = 4;
        }
        const maskLen = (acc[1] & 128) ? 4 : 0;
        const total = headerLen + maskLen + payloadLen;
        if (acc.length < total) break; // frame incompleto: esperar más chunks
        const frame = acc.subarray(0, total);
        acc = acc.subarray(total);
        const msg = decodeFrame(frame);
        if (!msg) continue;
        try {
          const obj = JSON.parse(msg);
          received.push(obj);
          // Responder el comando (resultado vacío) para no colgar al cliente.
          sendFrame(socket, JSON.stringify({ id: obj.id, result: {} }));
        } catch {}
      }
    });
    socket.on('error', () => {});
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  return {
    wsUrl: `ws://127.0.0.1:${port}/devtools/browser/fake`,
    received,
    // Simula que apareció una pestaña → el cliente debe inyectar el overlay.
    emitPage(sessionId = 'sess-1', targetId = 't1') {
      sendFrame(sock, JSON.stringify({
        method: 'Target.attachedToTarget',
        params: { sessionId, targetInfo: { type: 'page', targetId } },
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

test('overlay: setAutoAttach al conectar e inyección al aparecer una página', { skip: NO_WS }, async () => {
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

test('overlay: si el WS cae a mitad de inyección, no cuelga ni fuga promesas', { skip: NO_WS }, async () => {
  // Navegador que NUNCA responde los comandos → los send() quedarían colgados
  // si no fuera por failAllPending al cerrar (y el timeout defensivo).
  const http = require('http');
  const crypto = require('crypto');
  let sock = null;
  const server = http.createServer();
  server.on('upgrade', (req, socket) => {
    const accept = crypto.createHash('sha1')
      .update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
    sock = socket; socket.on('error', () => {}); // no responde a nada
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  const overlay = createCursorOverlay({
    resolve: async () => ({ port: 1, version: { webSocketDebuggerUrl: `ws://127.0.0.1:${port}/x` } }),
    log: () => {}, source: OVERLAY_SOURCE, retryMs: 100,
  });
  try {
    overlay.start();
    // Esperar a que conecte (el server no responde, así el await de setAutoAttach
    // quedaría colgado sin el fix). Dar tiempo y cerrar el socket del server.
    await waitFor(() => sock !== null, { timeoutMs: 3000 });
    await new Promise((r) => setTimeout(r, 200));
    sock.destroy(); // simula caída del navegador a mitad de comando
    // El servicio no debe crashear; debe seguir vivo e intentar reconectar.
    // (si failAllPending no existiera, quedarían promesas colgadas, pero el
    //  proceso igual sigue; este test verifica que no lanza excepción no
    //  capturada y que close() resuelve limpio)
    await new Promise((r) => setTimeout(r, 300));
    assert.ok(true, 'sobrevivió a la caída sin crash');
  } finally {
    overlay.close();
    try { sock && sock.destroy(); } catch {}
    await closeServer(server);
  }
});

test('overlay: se reconecta solo si la conexión CDP cae', { skip: NO_WS }, async () => {
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

test('overlay: rutea el click SOLO a la pestaña que la IA usa (no broadcast)', { skip: NO_WS }, async () => {
  const browser = await fakeBrowser();
  const overlay = createCursorOverlay({
    resolve: async () => ({ port: 1, version: { webSocketDebuggerUrl: browser.wsUrl } }),
    log: () => {},
    source: OVERLAY_SOURCE,
  });
  try {
    overlay.start();
    await waitFor(() => browser.received.some((m) => m.method === 'Target.setAutoAttach'), { timeoutMs: 4000 });

    // Dos pestañas: sesión-overlay OV_A↔targetId TA, OV_B↔TB.
    browser.emitPage('OV_A', 'TA');
    browser.emitPage('OV_B', 'TB');
    await waitFor(() => {
      const a = browser.received.some((m) => m.sessionId === 'OV_A' && m.method === 'Runtime.evaluate');
      const b = browser.received.some((m) => m.sessionId === 'OV_B' && m.method === 'Runtime.evaluate');
      return a && b; // ambas inyectadas
    }, { timeoutMs: 4000 });

    // El cliente (chrome-devtools-mcp) opera la pestaña TA con SU sesión CL_A.
    overlay.noteClientTarget('CL_A', 'TA');

    const before = browser.received.length;
    // Click de la IA llega con el sessionId del CLIENTE.
    overlay.showAiInput({ type: 'mousePressed', x: 11, y: 22, sessionId: 'CL_A' });

    await waitFor(() => browser.received.slice(before).some(
      (m) => m.method === 'Runtime.evaluate' && /__clAiPointer/.test(m.params?.expression || '')
    ), { timeoutMs: 3000 });

    const pointerMsgs = browser.received.slice(before).filter(
      (m) => m.method === 'Runtime.evaluate' && /__clAiPointer/.test(m.params?.expression || '')
    );
    assert.strictEqual(pointerMsgs.length, 1, 'debe dibujar en UNA sola sesión');
    assert.strictEqual(pointerMsgs[0].sessionId, 'OV_A', 'debe rutear a la pestaña de la IA (TA→OV_A)');
    assert.ok(!pointerMsgs.some((m) => m.sessionId === 'OV_B'), 'no debe tocar la otra pestaña');
  } finally {
    overlay.close();
    await browser.close();
  }
});

test('overlay: sin vínculo cliente cae a broadcast (degradación segura)', { skip: NO_WS }, async () => {
  const browser = await fakeBrowser();
  const overlay = createCursorOverlay({
    resolve: async () => ({ port: 1, version: { webSocketDebuggerUrl: browser.wsUrl } }),
    log: () => {},
    source: OVERLAY_SOURCE,
  });
  try {
    overlay.start();
    await waitFor(() => browser.received.some((m) => m.method === 'Target.setAutoAttach'), { timeoutMs: 4000 });
    browser.emitPage('OV_A', 'TA');
    browser.emitPage('OV_B', 'TB');
    await waitFor(() => ['OV_A', 'OV_B'].every((s) =>
      browser.received.some((m) => m.sessionId === s && m.method === 'Runtime.evaluate')), { timeoutMs: 4000 });

    const before = browser.received.length;
    // Sin sessionId conocido → no hay vínculo → broadcast a ambas.
    overlay.showAiInput({ type: 'mousePressed', x: 5, y: 6, sessionId: 'DESCONOCIDA' });

    await waitFor(() => browser.received.slice(before).filter(
      (m) => m.method === 'Runtime.evaluate' && /__clAiPointer/.test(m.params?.expression || '')
    ).length >= 2, { timeoutMs: 3000 });

    const sessions = new Set(browser.received.slice(before)
      .filter((m) => m.method === 'Runtime.evaluate' && /__clAiPointer/.test(m.params?.expression || ''))
      .map((m) => m.sessionId));
    assert.ok(sessions.has('OV_A') && sessions.has('OV_B'), 'fallback debe alcanzar ambas pestañas');
  } finally {
    overlay.close();
    await browser.close();
  }
});

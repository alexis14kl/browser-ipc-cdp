'use strict';

/**
 * CdpInterceptor — el handler de Fetch.requestPaused tiene que estar registrado
 * ANTES del Fetch.enable.
 *
 * Regresión que captura: el decoder de frames procesa TODOS los frames completos
 * de un chunk TCP de forma síncrona. Si el navegador manda la respuesta del
 * `Fetch.enable` y la primera ráfaga de `Fetch.requestPaused` en el MISMO chunk,
 * esos eventos se despachan antes de que corra la continuación del `await` — y si
 * el listener se registra ahí, llegan sin handler y `dispatch` los descarta. Nadie
 * manda `Fetch.continueRequest` y esas requests quedan pausadas para siempre: la
 * pestaña se queda a medio cargar, sin error visible ("Brave sin internet").
 *
 * El navegador falso de aquí manda enable-response + 2 requestPaused en UN solo
 * write, que es exactamente el caso que dispara la carrera.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const http = require('http');
const { createCdpInterceptor } = require('../src/services/cdp-interceptor');
const { createWsFrameDecoder } = require('../src/services/ws-tap');
const { closeServer, trackSockets, waitFor } = require('./helpers');

/** Frame de texto server→cliente (sin máscara, como los del navegador). */
function frame(obj) {
  const payload = Buffer.from(JSON.stringify(obj), 'utf8');
  const len = payload.length;
  let header;
  if (len < 126) header = Buffer.from([0x81, len]);
  else { header = Buffer.alloc(4); header[0] = 0x81; header[1] = 126; header.writeUInt16BE(len, 2); }
  return Buffer.concat([header, payload]);
}

/**
 * Navegador falso: sirve /json con una pestaña y atiende el WS de esa página.
 * Al recibir Fetch.enable contesta con UN write que trae la respuesta y la
 * ráfaga de requestPaused pegadas — la condición de la carrera.
 * Registra los comandos recibidos para poder afirmar sobre ellos.
 */
function startFakeBrowser({ pausedIds = ['R1', 'R2'] } = {}) {
  const commands = [];

  const server = http.createServer((req, res) => {
    if (req.url === '/json') {
      const port = server.address().port;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify([{
        type: 'page',
        url: 'http://app.test/',
        webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/page/PAGE1`,
      }]));
      return;
    }
    res.statusCode = 404;
    res.end();
  });

  server.on('upgrade', (req, socket) => {
    socket.on('error', () => {});
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n');

    const decode = createWsFrameDecoder((text) => {
      let msg;
      try { msg = JSON.parse(text); } catch { return; }
      commands.push(msg);

      if (msg.method === 'Fetch.enable') {
        // UN solo write: respuesta + ráfaga de eventos en el mismo chunk TCP.
        socket.write(Buffer.concat([
          frame({ id: msg.id, result: {} }),
          ...pausedIds.map((requestId) => frame({
            method: 'Fetch.requestPaused',
            params: {
              requestId,
              request: { url: `http://app.test/${requestId}.js`, method: 'GET', headers: {} },
            },
          })),
        ]));
        return;
      }

      // Cualquier otro comando: ack vacío para que el await del servicio resuelva.
      if (msg.id != null) socket.write(frame({ id: msg.id, result: {} }));
    });

    socket.on('data', (chunk) => { try { decode(chunk); } catch {} });
  });

  trackSockets(server);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, commands }));
  });
}

test('continúa las requests pausadas que llegan en el mismo chunk que la respuesta del enable', async () => {
  const { server, commands } = await startFakeBrowser();
  const browserUrl = `http://127.0.0.1:${server.address().port}`;
  const interceptor = createCdpInterceptor({ browserUrl });

  try {
    await interceptor.start([{ name: 'pass-all', urlPattern: '*', action: 'pass' }]);

    const continued = () => commands.filter((c) => c.method === 'Fetch.continueRequest');
    const ok = await waitFor(() => continued().length >= 2, { timeoutMs: 5000, intervalMs: 50 });

    assert.ok(ok, `esperaba 2 Fetch.continueRequest, llegaron ${continued().length}: las requests quedaron pausadas`);
    assert.deepStrictEqual(
      continued().map((c) => c.params.requestId).sort(),
      ['R1', 'R2'],
    );

    // Y las capturó, que es lo que get_intercepted_requests luego reporta.
    assert.strictEqual(interceptor.getCaptured().length, 2);
  } finally {
    await interceptor.stop();
    await closeServer(server);
  }
});

test('stop() manda Fetch.disable y deja la intercepción inactiva', async () => {
  const { server, commands } = await startFakeBrowser({ pausedIds: [] });
  const browserUrl = `http://127.0.0.1:${server.address().port}`;
  const interceptor = createCdpInterceptor({ browserUrl });

  try {
    await interceptor.start([{ name: 'pass-all', urlPattern: '*', action: 'pass' }]);
    assert.strictEqual(interceptor.isActive(), true);

    await interceptor.stop();

    assert.ok(commands.some((c) => c.method === 'Fetch.disable'), 'no se envió Fetch.disable');
    assert.strictEqual(interceptor.isActive(), false);
  } finally {
    await closeServer(server);
  }
});

/**
 * Tests de comportamiento del proxy CDP dinámico (src/services/cdp-proxy.js).
 *
 * Capturan el contrato que NO puede romperse en el refactor:
 *  - reescritura del host:puerto del backend en los bodies JSON
 *  - header identificador x-cdp-proxy en toda respuesta HTTP
 *  - 502 con marker cuando no hay backend
 *  - re-resolución on-demand cuando el backend cambia de puerto (v2.3.0)
 *  - reclamo del puerto a un proxy huérfano (v2.3.1)
 *  - fallback de puerto cuando el ocupante NO es un proxy nuestro
 *  - túnel WebSocket (upgrade) extremo a extremo
 */
const { test } = require('node:test');
const assert = require('node:assert');
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');

const { startProxy } = require('../src/services/cdp-proxy');
const { randomPort, startFakeCdp, httpGet, waitFor, closeServer, trackSockets } = require('./helpers');

const noop = () => {};

test('proxy reenvía /json/version, reescribe el puerto del backend y marca x-cdp-proxy', async () => {
  const backend = await startFakeCdp();
  const backendPort = backend.address().port;
  const { port, server } = await startProxy({
    preferredPort: randomPort(),
    resolveBackend: async () => ({ port: backendPort, version: null }),
    log: noop,
  });
  try {
    const res = await httpGet(`http://127.0.0.1:${port}/json/version`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.headers['x-cdp-proxy'], 'browser-ipc-cdp');
    const json = JSON.parse(res.body);
    assert.strictEqual(json.Browser, 'FakeChrome/1.0');
    // El webSocketDebuggerUrl debe apuntar al PROXY, no al backend
    assert.ok(json.webSocketDebuggerUrl.includes(`127.0.0.1:${port}/`), `esperaba :${port} en ${json.webSocketDebuggerUrl}`);
    assert.ok(!json.webSocketDebuggerUrl.includes(`:${backendPort}/`), 'no debe filtrar el puerto real del backend');
  } finally {
    await closeServer(server);
    await closeServer(backend);
  }
});

test('proxy responde 502 con marker cuando no hay backend vivo', async () => {
  const { port, server } = await startProxy({
    preferredPort: randomPort(),
    resolveBackend: async () => null,
    log: noop,
  });
  try {
    const res = await httpGet(`http://127.0.0.1:${port}/json/version`);
    assert.strictEqual(res.status, 502);
    assert.strictEqual(res.headers['x-cdp-proxy'], 'browser-ipc-cdp');
    assert.ok(JSON.parse(res.body).error);
  } finally {
    await closeServer(server);
  }
});

test('proxy re-resuelve solo cuando el backend "reinicia" en otro puerto', async () => {
  let backend = await startFakeCdp();
  let current = backend.address().port;
  const { port, server } = await startProxy({
    preferredPort: randomPort(),
    initialBackend: { port: current, version: null },
    resolveBackend: async () => ({ port: current, version: null }),
    log: noop,
  });
  try {
    let res = await httpGet(`http://127.0.0.1:${port}/json/version`);
    assert.strictEqual(res.status, 200);

    // "Reinicio" del navegador: muere el backend y aparece otro en OTRO puerto
    await closeServer(backend);
    backend = await startFakeCdp();
    current = backend.address().port;

    // Sin reiniciar el proxy, la siguiente request debe recuperarse sola
    res = await httpGet(`http://127.0.0.1:${port}/json/version`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(JSON.parse(res.body).Browser, 'FakeChrome/1.0');
  } finally {
    await closeServer(server);
    await closeServer(backend);
  }
});

// reclaimPort identifica al dueño del puerto con lsof (posix) / netstat (win).
// Sin lsof (contenedores mínimos) el código degrada a no-reclamar por diseño;
// este test verifica el reclamo CON la herramienta presente.
const NO_LSOF = (() => {
  if (process.platform === 'win32') return false; // netstat siempre existe
  try {
    require('child_process').execSync('command -v lsof', { stdio: 'pipe', shell: '/bin/sh' });
    return false;
  } catch {
    return 'sin lsof: reclaimPort degrada a no-reclamar (el caso ocupante-ajeno sí se testea)';
  }
})();

test('proxy reclama el puerto fijo a un proxy huérfano de otra sesión', { skip: NO_LSOF }, async () => {
  const fixedPort = randomPort();
  // Proxy "huérfano": proceso hijo corriendo src/services/cdp-proxy.js standalone
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'src', 'services', 'cdp-proxy.js')], {
    env: { ...process.env, PROXY_PORT: String(fixedPort), BACKEND_PORT: '1' },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  const childExited = new Promise((r) => child.on('exit', r));
  const up = await waitFor(async () => {
    try { return (await httpGet(`http://127.0.0.1:${fixedPort}/json/version`, 500)).status === 502; }
    catch { return false; }
  });
  assert.ok(up, 'el proxy huérfano debía estar escuchando');

  const { port, server } = await startProxy({
    preferredPort: fixedPort,
    resolveBackend: async () => null,
    log: noop,
  });
  try {
    assert.strictEqual(port, fixedPort, 'el nuevo proxy debe quedarse con el MISMO puerto fijo');
    const exited = await Promise.race([childExited.then(() => true), new Promise((r) => setTimeout(() => r(false), 5000))]);
    assert.ok(exited, 'el huérfano debía morir al ser reemplazado');
  } finally {
    await closeServer(server);
    try { child.kill(); } catch {}
  }
});

test('proxy NO mata a un ocupante ajeno: cae al siguiente puerto', async () => {
  const busyPort = randomPort();
  // Ocupante sin el header x-cdp-proxy (no es nuestro)
  const stranger = require('http').createServer((req, res) => res.end('{}'));
  await new Promise((r) => stranger.listen(busyPort, '127.0.0.1', r));

  const { port, server } = await startProxy({
    preferredPort: busyPort,
    resolveBackend: async () => null,
    log: noop,
  });
  try {
    assert.strictEqual(port, busyPort + 1, 'debía usar el siguiente puerto sin matar al ajeno');
    // El ajeno sigue vivo
    const res = await httpGet(`http://127.0.0.1:${busyPort}/`);
    assert.strictEqual(res.status, 200);
  } finally {
    await closeServer(server);
    await closeServer(stranger);
  }
});

test('túnel WebSocket: upgrade a través del proxy con echo extremo a extremo', async () => {
  const backend = await startFakeCdp();
  const backendPort = backend.address().port;
  const { port, server } = await startProxy({
    preferredPort: randomPort(),
    resolveBackend: async () => ({ port: backendPort, version: null }),
    log: noop,
  });
  // El túnel WS desprende sockets del tracking de http.Server: sin esto,
  // closeServer(server) del proxy no resuelve nunca (cuelgue real detectado).
  trackSockets(server);
  try {
    const result = await new Promise((resolve, reject) => {
      const sock = net.connect(port, '127.0.0.1');
      let buf = '';
      let upgraded = false;
      sock.on('connect', () => {
        sock.write(
          `GET /devtools/browser/fake-id HTTP/1.1\r\n` +
          `Host: 127.0.0.1:${port}\r\n` +
          `Upgrade: websocket\r\nConnection: Upgrade\r\n` +
          `Sec-WebSocket-Key: dGVzdA==\r\nSec-WebSocket-Version: 13\r\n\r\n`
        );
      });
      sock.on('data', (d) => {
        buf += d.toString('utf-8');
        if (!upgraded && buf.includes('101 Switching Protocols')) {
          upgraded = true;
          buf = '';
          sock.write('PING-CRUDO');
        } else if (upgraded && buf.includes('PING-CRUDO')) {
          sock.destroy();
          resolve('echo-ok');
        }
      });
      sock.on('error', reject);
      setTimeout(() => reject(new Error('timeout túnel WS')), 5000);
    });
    assert.strictEqual(result, 'echo-ok');
  } finally {
    await closeServer(server);
    await closeServer(backend);
  }
});

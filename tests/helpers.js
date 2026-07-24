/**
 * Utilidades compartidas de la suite. Sin dependencias externas.
 *
 * Regla: los tests NUNCA usan el puerto 9333 (puede haber una sesión MCP real
 * corriendo en la máquina del desarrollador); siempre puertos altos aleatorios.
 */
const http = require('http');

function randomPort() {
  return 20000 + Math.floor(Math.random() * 20000);
}

/**
 * Servidor que imita el endpoint CDP de un navegador Chromium:
 * /json/version con webSocketDebuggerUrl propio y echo en el upgrade WS.
 */
function startFakeCdp() {
  const server = http.createServer((req, res) => {
    const port = server.address().port;
    if (req.url === '/json/version') {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({
        Browser: 'FakeChrome/1.0',
        'Protocol-Version': '1.3',
        webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/browser/fake-id`,
      }));
    } else if (req.url === '/json/list') {
      res.setHeader('Content-Type', 'application/json');
      res.end('[]');
    } else {
      res.statusCode = 404;
      res.end();
    }
  });
  server.on('upgrade', (req, socket) => {
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n');
    socket.on('data', (d) => socket.write(d)); // echo
    socket.on('error', () => {});
  });
  trackSockets(server);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function httpGet(url, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    // agent:false — sin keep-alive: con el agente global (keep-alive por
    // defecto desde Node 19) los sockets quedan vivos y el proceso de test
    // nunca termina porque server.close() espera las conexiones abiertas.
    const req = http.get(url, { timeout: timeoutMs, agent: false }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

async function waitFor(fn, { timeoutMs = 5000, intervalMs = 100 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await fn()) return true;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return false;
}

/**
 * Rastreo manual de sockets: los sockets que pasan por 'upgrade' (túnel WS) se
 * desprenden del tracking interno de http.Server, y entonces server.close()
 * puede no invocar su callback nunca (closeAllConnections tampoco los ve).
 * 'connection' captura TODOS los sockets entrantes, upgradeados o no.
 * Llamar ANTES de que le lleguen conexiones al server.
 */
function trackSockets(server) {
  const sockets = new Set();
  server.on('connection', (s) => {
    sockets.add(s);
    s.on('close', () => sockets.delete(s));
  });
  server.__testSockets = sockets;
  return server;
}

/**
 * Cierre determinista: tumba también las conexiones vivas (keep-alive del
 * agente global + sockets upgradeados rastreados); sin esto close() no
 * resuelve y el proceso de test queda colgado.
 */
function closeServer(server) {
  if (!server) return Promise.resolve();
  server.closeAllConnections?.();
  for (const s of server.__testSockets || []) { try { s.destroy(); } catch {} }
  return new Promise((r) => server.close(r));
}

module.exports = { randomPort, startFakeCdp, httpGet, waitFor, closeServer, trackSockets };

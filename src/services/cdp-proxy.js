/**
 * CDP Dynamic Proxy
 *
 * Escucha en un puerto local FIJO y reenvía cada request HTTP y cada WebSocket
 * al puerto CDP real del navegador, re-resolviéndolo on-demand.
 *
 * Problema que resuelve: chrome-devtools-mcp recibe --browserUrl UNA vez al
 * arrancar. Si el navegador arranca después, o se reinicia con
 * --remote-debugging-port=0 (puerto nuevo en cada arranque), el MCP queda
 * apuntando a un puerto muerto hasta reiniciar el MCP.
 *
 * Con el proxy, el MCP apunta siempre a http://127.0.0.1:<puertoFijo> y el
 * proxy encuentra el backend vivo en cada conexión. El puerto ya no cambia
 * nunca para el cliente.
 *
 * Uso standalone (debug):
 *   PROXY_PORT=9333 BACKEND_PORT=9222 node lib/cdp-proxy.js
 */

const http = require('http');
const net = require('net');
const { execFile } = require('child_process');
const { createInputTap, createTargetTap } = require('./ws-tap');
const { getPlatformId } = require('../platform');

const PROXY_HOST = '127.0.0.1';
// Cache negativo: con el navegador caído, no re-escanear (ps/lsof/probes) en cada request.
const MISS_TTL_MS = 3000;
// Header con el que cada instancia del proxy se identifica; permite detectar
// (y reemplazar) un proxy huérfano de una sesión anterior sin matar a ciegas.
const MARKER_HEADER = 'x-cdp-proxy';
const MARKER_VALUE = 'browser-ipc-cdp';

function probeProxy(port) {
  return new Promise((resolve) => {
    // 2s: bajo inanición de CPU (runners de CI compartidos) un proxy huérfano
    // puede tardar >700ms en responder; clasificarlo como 'other' por timeout
    // pierde el puerto fijo. El caso puerto-libre no paga este costo (el
    // ECONNREFUSED llega al instante).
    const req = http.get({ host: PROXY_HOST, port, path: '/json/version', timeout: 2000 }, (res) => {
      res.resume();
      resolve(res.headers[MARKER_HEADER] === MARKER_VALUE ? 'ours' : 'other');
    });
    req.on('timeout', () => { req.destroy(); resolve('other'); });
    req.on('error', () => resolve('free'));
  });
}

function listenerPid(port) {
  return new Promise((resolve) => {
    if (getPlatformId() === 'win32') {
      execFile('netstat', ['-ano', '-p', 'tcp'], (err, out) => {
        if (err) return resolve(null);
        const line = out.split('\n').find((l) => l.includes(`:${port}`) && /LISTENING/i.test(l));
        resolve(line ? parseInt(line.trim().split(/\s+/).pop(), 10) || null : null);
      });
    } else {
      execFile('lsof', ['-nP', '-t', `-iTCP:${port}`, '-sTCP:LISTEN'], (err, out) => {
        resolve(err ? null : parseInt(out.trim().split('\n')[0], 10) || null);
      });
    }
  });
}

// Si el puerto preferido lo ocupa un proxy nuestro huérfano (la sesión que lo
// lanzó ya murió), matarlo y quedarnos con el puerto: los clientes que ya
// apuntaban ahí siguen funcionando porque el reemplazo atiende igual.
async function reclaimPort(port, log) {
  const status = await probeProxy(port);
  if (status !== 'ours') return;
  const pid = await listenerPid(port);
  if (!pid || pid === process.pid) return;
  log(`proxy: :${port} ocupado por proxy huérfano (pid ${pid}), reemplazándolo`);
  try { process.kill(pid); } catch { return; }
  // 5s de espera: en máquinas lentas (runners de CI compartidos) el proceso
  // puede tardar >2s en morir y soltar el puerto; si no llega, el caller cae
  // al siguiente puerto (comportamiento seguro, solo pierde el puerto fijo).
  for (let i = 0; i < 50; i++) {
    if (await probeProxy(port) === 'free') return;
    await new Promise((r) => setTimeout(r, 100));
  }
}

/**
 * @param {object} opts
 * @param {number} opts.preferredPort - Puerto fijo deseado (si está ocupado prueba los siguientes).
 * @param {{port: number, version: object|null}|null} [opts.initialBackend] - Backend ya resuelto (cache inicial).
 * @param {() => Promise<{port: number, version: object|null}|null>} opts.resolveBackend - Re-resuelve el backend. Debe devolverlo YA verificado (vivo) o null.
 * @param {(backend: {port: number, version: object|null}, proxyPort: number) => void} [opts.onBackendChange] - Se dispara en cada resolución exitosa (incluido el backend inicial).
 * @param {(evt: {type: string, x: number, y: number, button?: string, sessionId?: string}) => void} [opts.onClientInput] - Se dispara por cada Input.dispatchMouseEvent que el cliente (chrome-devtools-mcp) manda por el túnel. SOLO-OBSERVACIÓN.
 * @param {(link: {sessionId: string, targetId: string}) => void} [opts.onClientAttach] - Vínculo sesión↔target que el navegador anuncia al cliente (Target.attachedToTarget, type page). Permite rutear el overlay a la pestaña correcta.
 * @param {(link: {sessionId: string}) => void} [opts.onClientDetach] - El cliente soltó una pestaña (Target.detachedFromTarget).
 * @param {(msg: string) => void} opts.log
 * @returns {Promise<{port: number, server: import('http').Server}>}
 */
async function startProxy({ preferredPort, initialBackend = null, resolveBackend, onBackendChange, onClientInput, onClientAttach, onClientDetach, log, maxPortAttempts = 10 }) {
  let listenPort = null;
  let backend = initialBackend;
  let resolving = null;
  let lastMissAt = 0;

  function notifyBackend() {
    log(`proxy: backend -> :${backend.port}`);
    if (onBackendChange) { try { onBackendChange(backend, listenPort); } catch {} }
  }

  // Devuelve el puerto cacheado de forma optimista: los callers ya reintentan
  // con forceRefresh cuando la conexión falla, así que sondearlo en cada
  // request solo duplicaría los roundtrips. Single-flight: si llegan varias
  // requests con el backend caído, una sola resolución.
  function getBackend(forceRefresh = false) {
    if (backend && !forceRefresh) return Promise.resolve(backend.port);
    if (resolving) return resolving;
    resolving = (async () => {
      try {
        backend = null;
        if (Date.now() - lastMissAt < MISS_TTL_MS) return null;
        backend = (await resolveBackend()) || null;
        if (!backend) {
          lastMissAt = Date.now();
          return null;
        }
        lastMissAt = 0;
        notifyBackend();
        return backend.port;
      } finally {
        resolving = null;
      }
    })();
    return resolving;
  }

  // El backend anuncia su propio host:puerto en /json/version y /json/list
  // (webSocketDebuggerUrl, devtoolsFrontendUrl). Hay que reescribirlo al del
  // proxy para que el cliente siga hablando con nosotros.
  function rewriteBody(text, port) {
    return text
      .split(`${PROXY_HOST}:${port}`).join(`${PROXY_HOST}:${listenPort}`)
      .split(`localhost:${port}`).join(`${PROXY_HOST}:${listenPort}`);
  }

  function replyNoBackend(res) {
    const body = JSON.stringify({ error: 'No live CDP backend. ¿Está el navegador corriendo con --remote-debugging-port?' });
    try {
      res.writeHead(502, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), [MARKER_HEADER]: MARKER_VALUE });
      res.end(body);
    } catch {}
  }

  function forward(req, res, body, port, allowRetry) {
    const headers = { ...req.headers, host: `${PROXY_HOST}:${port}` };
    delete headers['accept-encoding']; // sin gzip para poder reescribir el body
    const proxyReq = http.request({ host: PROXY_HOST, port, method: req.method, path: req.url, headers }, (proxyRes) => {
      const chunks = [];
      proxyRes.on('data', (c) => chunks.push(c));
      proxyRes.on('end', () => {
        let out = Buffer.concat(chunks);
        const type = proxyRes.headers['content-type'] || '';
        if (/json|text/i.test(type) || req.url.startsWith('/json')) {
          out = Buffer.from(rewriteBody(out.toString('utf-8'), port), 'utf-8');
        }
        const outHeaders = { ...proxyRes.headers };
        delete outHeaders['transfer-encoding'];
        outHeaders['content-length'] = String(out.length);
        outHeaders[MARKER_HEADER] = MARKER_VALUE;
        try {
          res.writeHead(proxyRes.statusCode, outHeaders);
          res.end(out);
        } catch {}
      });
      proxyRes.on('error', () => { try { res.destroy(); } catch {} });
    });
    proxyReq.on('error', async () => {
      if (allowRetry) {
        const fresh = await getBackend(true);
        if (fresh) return forward(req, res, body, fresh, false);
      }
      replyNoBackend(res);
    });
    proxyReq.end(body);
  }

  // Túnel TCP crudo para el upgrade WebSocket: se replica el handshake HTTP
  // (con Host reescrito, Chromium rechaza hosts desconocidos) y se pipean
  // los sockets — no hace falta parsear frames WS.
  function tunnel(req, socket, head, port) {
    return new Promise((resolve) => {
      const backend = net.connect(port, PROXY_HOST);
      backend.on('connect', () => {
        const lines = [`${req.method} ${req.url} HTTP/1.1`];
        for (let i = 0; i < req.rawHeaders.length; i += 2) {
          const key = req.rawHeaders[i];
          const val = key.toLowerCase() === 'host' ? `${PROXY_HOST}:${port}` : req.rawHeaders[i + 1];
          lines.push(`${key}: ${val}`);
        }
        backend.write(lines.join('\r\n') + '\r\n\r\n');
        if (head && head.length) backend.write(head);
        // Tap SOLO-OBSERVACIÓN del stream cliente→backend: un segundo listener
        // 'data' ve una copia de los chunks sin interferir con el pipe (que
        // sigue moviendo los bytes tal cual). Extrae los Input.dispatchMouseEvent
        // de la IA para el overlay. Nunca escribe de vuelta al túnel.
        if (onClientInput) {
          const tap = createInputTap(onClientInput);
          socket.on('data', (c) => { try { tap(c); } catch {} });
        }
        // Tap del sentido opuesto (backend→cliente): los eventos Target.*
        // viajan del navegador AL cliente, por eso se espían aquí y no en
        // socket. Da el mapa sessionId↔targetId para rutear el overlay.
        if (onClientAttach || onClientDetach) {
          const targetTap = createTargetTap({ onAttach: onClientAttach, onDetach: onClientDetach });
          backend.on('data', (c) => { try { targetTap(c); } catch {} });
        }
        socket.pipe(backend);
        backend.pipe(socket);
        backend.on('close', () => socket.destroy());
        socket.on('close', () => backend.destroy());
        backend.on('error', () => socket.destroy());
        resolve(true);
      });
      backend.on('error', () => resolve(false));
    });
  }

  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', async () => {
      const body = Buffer.concat(chunks);
      const port = await getBackend();
      if (!port) return replyNoBackend(res);
      forward(req, res, body, port, true);
    });
  });

  server.on('upgrade', async (req, socket, head) => {
    socket.on('error', () => {});
    for (const force of [false, true]) {
      const port = await getBackend(force);
      if (port && await tunnel(req, socket, head, port)) return;
    }
    try { socket.destroy(); } catch {}
  });

  await reclaimPort(preferredPort, log);

  listenPort = await new Promise((resolve, reject) => {
    let attempt = 0;
    let preferredRetries = 0;
    const tryPort = (p) => {
      server.once('error', (e) => {
        if (e.code === 'EADDRINUSE' && p === preferredPort && ++preferredRetries <= 3) {
          // El bind justo después de matar al huérfano puede chocar con su
          // socket aún en cierre (carrera de ms, típica de Linux): el probe
          // HTTP ya dio ECONNREFUSED pero el bind aún falla. Reintentar el
          // puerto PREFERIDO antes de rendirse y saltar al siguiente.
          setTimeout(() => tryPort(p), 250);
        } else if (e.code === 'EADDRINUSE' && ++attempt < maxPortAttempts) {
          log(`proxy: :${p} ocupado, probando :${preferredPort + attempt}`);
          tryPort(preferredPort + attempt);
        } else {
          reject(e);
        }
      });
      server.listen(p, PROXY_HOST);
    };
    // UN solo listener de 'listening' y el puerto real desde server.address():
    // pasar callback a cada listen() deja callbacks stale de intentos fallidos
    // que resolvían con el puerto viejo (ocupado) en vez del que quedó activo.
    server.on('listening', () => {
      server.removeAllListeners('error');
      server.on('error', (e) => log(`proxy server error: ${e.message}`));
      resolve(server.address().port);
    });
    tryPort(preferredPort);
  });

  // Notificar el backend inicial ya con listenPort conocido: así hay un solo
  // "writer" de estado (onBackendChange) y el caller no duplica esa lógica.
  if (backend) notifyBackend();

  return { port: listenPort, server };
}

module.exports = { startProxy };

// Modo standalone para debug: backend fijo via env, sin re-resolución real.
if (require.main === module) {
  const backendPort = parseInt(process.env.BACKEND_PORT || '9222', 10);
  startProxy({
    preferredPort: parseInt(process.env.PROXY_PORT || '9333', 10),
    resolveBackend: async () => ({ port: backendPort, version: null }),
    log: (m) => console.error(`[cdp-proxy] ${m}`),
  }).then(({ port }) => {
    console.error(`[cdp-proxy] MODO DEBUG: escuchando en http://${PROXY_HOST}:${port} -> backend FIJO :${backendPort}`);
    console.error('[cdp-proxy] no re-resuelve si el navegador cambia de puerto; para un puente real: browser-ipc-cdp-mcp --proxy-only');
  }).catch((e) => {
    console.error(`[cdp-proxy] fatal: ${e.message}`);
    process.exit(1);
  });
}

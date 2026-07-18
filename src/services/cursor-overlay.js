/**
 * Cursor Overlay Service — auto-inyecta la vista del cursor (overlay-script)
 * en TODAS las páginas del navegador vía CDP, sin pasos manuales.
 *
 * Abre su propio WebSocket al endpoint browser-level del navegador y:
 *   - Page.addScriptToEvaluateOnNewDocument → el overlay corre al inicio de
 *     cada documento nuevo (sobrevive navegación y recarga).
 *   - Runtime.evaluate del mismo source → lo instala también en las páginas
 *     YA abiertas en el momento de conectar.
 *   - Target.setDiscoverTargets + attach por target de tipo "page" (flatten):
 *     cubre pestañas nuevas que aparezcan después.
 *
 * Usa el WebSocket nativo de Node (>=21) — sin dependencias externas.
 * Es best-effort y NO bloqueante: si algo falla, el MCP sigue igual.
 *
 * @param {object} deps
 * @param {() => Promise<{port:number, version:object}|null>} deps.resolve  CdpService.resolve
 * @param {(msg: string) => void} [deps.log]
 * @param {string} deps.source  El JS del overlay (OVERLAY_SOURCE).
 */
function createCursorOverlay({ resolve, log = () => {}, source, retryMs = 4000 }) {
  let ws = null;
  let nextId = 1;
  const pending = new Map();       // id → resolve
  const injectedSessions = new Set();
  let stopped = false;
  let retryTimer = null;
  let lastMoveAt = 0;

  function send(method, params = {}, sessionId) {
    const id = nextId++;
    const msg = { id, method, params };
    if (sessionId) msg.sessionId = sessionId;
    ws.send(JSON.stringify(msg));
    // Timeout defensivo: si el navegador no responde (o se cae justo aquí),
    // la promesa se rechaza en vez de colgarse para siempre. injectInto lo
    // captura y limpia. Evita fugas en el Map pending de un proceso largo.
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (pending.delete(id)) reject(new Error(`CDP timeout: ${method}`));
      }, 8000);
      pending.set(id, { resolve, reject, timer });
    });
  }

  // Rechaza todas las promesas pendientes (WS caído): sin esto, los await de
  // injectInto quedan colgados y el Map crece en cada reconexión.
  function failAllPending(reason) {
    for (const [id, p] of pending) {
      clearTimeout(p.timer);
      pending.delete(id);
      p.reject(new Error(reason));
    }
  }

  async function injectInto(sessionId) {
    if (injectedSessions.has(sessionId)) return;
    injectedSessions.add(sessionId);
    try {
      await send('Page.enable', {}, sessionId);
      // Para documentos futuros (navegación/recarga)
      await send('Page.addScriptToEvaluateOnNewDocument', { source }, sessionId);
      // Para el documento actual ya cargado
      await send('Runtime.evaluate', { expression: source, includeCommandLineAPI: false }, sessionId);
    } catch (e) {
      injectedSessions.delete(sessionId);
      log(`overlay: inject falló (${e.message})`);
    }
  }

  function onMessage(raw) {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (msg.id && pending.has(msg.id)) {
      const p = pending.get(msg.id);
      clearTimeout(p.timer);
      pending.delete(msg.id);
      p.resolve(msg.result);
      return;
    }
    // Sesión adjuntada a un target page → inyectar
    if (msg.method === 'Target.attachedToTarget') {
      const { sessionId, targetInfo } = msg.params;
      if (targetInfo.type === 'page') injectInto(sessionId);
    }
  }

  function scheduleRetry() {
    if (stopped || retryTimer) return;
    retryTimer = setTimeout(() => { retryTimer = null; connect(); }, retryMs);
  }

  // Un intento de conexión + instalación. Si no hay backend o el WS cae,
  // reprograma solo: así el overlay SIGUE a Brave aunque cambie de puerto o
  // arranque después (igual que el proxy re-resuelve on-demand).
  async function connect() {
    if (stopped || ws) return;
    if (typeof WebSocket === 'undefined') {
      log('overlay: WebSocket nativo no disponible (Node <21); overlay deshabilitado');
      return;
    }
    let backend;
    try { backend = await resolve(); } catch { backend = null; }
    if (!backend || !backend.version || !backend.version.webSocketDebuggerUrl) {
      return scheduleRetry();
    }

    const sock = new WebSocket(backend.version.webSocketDebuggerUrl);
    const connected = await new Promise((res) => {
      sock.addEventListener('open', () => res(true), { once: true });
      sock.addEventListener('error', () => res(false), { once: true });
    });
    if (stopped) { try { sock.close(); } catch {} return; }
    if (!connected) { ws = null; return scheduleRetry(); }

    ws = sock;
    ws.addEventListener('message', (ev) => onMessage(ev.data));
    ws.addEventListener('close', () => {
      injectedSessions.clear();
      failAllPending('ws cerrado'); // libera los await colgados
      ws = null;
      scheduleRetry(); // Brave cerró/reinició → reconectar y reinstalar
    });

    try {
      // Auto-attach a cada page target (actuales y futuros), en modo flatten.
      await send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });
      log('overlay: instalado (cursor visible en cada página)');
    } catch (e) {
      log(`overlay: setAutoAttach falló (${e.message})`);
    }
  }

  // Dibuja un click de la IA en todas las páginas inyectadas. Lo alimenta el
  // tap del proxy (Input.dispatchMouseEvent) — es la señal exclusiva de la IA.
  // Fire-and-forget; los mouseMoved se estrangulan para no inundar el WS.
  function showAiInput(evt) {
    if (!ws || !evt || injectedSessions.size === 0) return;
    const type = evt.type;
    if (type === 'mouseMoved') {
      const now = Date.now();
      if (now - lastMoveAt < 30) return;
      lastMoveAt = now;
    } else if (type !== 'mousePressed' && type !== 'mouseReleased') {
      return;
    }
    const x = Math.round(evt.x || 0);
    const y = Math.round(evt.y || 0);
    const expr = `window.__clAiPointer&&window.__clAiPointer(${JSON.stringify(type)},${x},${y})`;
    for (const sessionId of injectedSessions) {
      send('Runtime.evaluate', { expression: expr, includeCommandLineAPI: false }, sessionId).catch(() => {});
    }
  }

  // Arranca el overlay: no bloquea (best-effort). Se auto-mantiene vía retries.
  function start() {
    stopped = false;
    connect();
  }

  function close() {
    stopped = true;
    if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
    try { ws && ws.close(); } catch {}
    ws = null;
  }

  // `run` se conserva como alias de un intento único (lo usa el demo).
  return { start, run: connect, close, showAiInput };
}

module.exports = { createCursorOverlay };

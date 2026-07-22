/**
 * CdpStealth — sesión CDP persistente para spoofing de fingerprint.
 *
 * CdpCaller (one-shot) registra Page.addScriptToEvaluateOnNewDocument pero
 * Chrome elimina esos scripts cuando la conexión WebSocket se cierra.
 * Esta sesión permanece abierta para que los scripts persistan, y además
 * suscribe Page.frameNavigated para re-aplicar los patches via Runtime.evaluate
 * inmediatamente después de cada navegación (doble cobertura).
 *
 * API: start(source), stop(), isActive(), getScriptId()
 */

const http = require('http');
const { createCdpSession } = require('./cdp-session');

function createCdpStealth({ browserUrl, log = () => {} }) {
  let session   = null;
  let scriptId  = null;
  let navUnsub  = null;
  let source    = null;

  function httpGet(url) {
    return new Promise((resolve, reject) => {
      const u   = new URL(url);
      const req = http.get(
        { hostname: u.hostname, port: parseInt(u.port) || 80, path: u.pathname },
        res => {
          let data = '';
          res.on('data', c => { data += c; });
          res.on('end', () => {
            try { resolve(JSON.parse(data)); }
            catch (e) { reject(new Error(`/json parse: ${e.message}`)); }
          });
        }
      );
      req.setTimeout(5000, () => { req.destroy(); reject(new Error('timeout')); });
      req.on('error', reject);
    });
  }

  async function getActivePageWs() {
    const targets = await httpGet(`${browserUrl}/json`);
    const page    = targets.find(t => t.type === 'page');
    if (!page) throw new Error('No active page found');
    const proxy = new URL(browserUrl);
    const ws    = new URL(page.webSocketDebuggerUrl);
    ws.hostname = proxy.hostname;
    ws.port     = proxy.port;
    return ws.toString();
  }

  async function applyPatch() {
    if (!session?.isConnected() || !source) return;
    try { await session.send('Runtime.evaluate', { expression: source }); }
    catch (e) { log(`[cdp-stealth] patch apply error: ${e.message}`); }
  }

  /**
   * Inicia la sesión persistente y registra el script de patches.
   * @param {string} patchSource  — código JS a inyectar en cada nuevo documento
   */
  async function start(patchSource) {
    source = patchSource;

    // Si ya está activa, solo actualiza el script
    if (session && session.isConnected()) {
      if (scriptId) {
        try { await session.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: scriptId }); }
        catch (_) {}
        scriptId = null;
      }
      if (navUnsub) { navUnsub(); navUnsub = null; }
    } else {
      const wsUrl = await getActivePageWs();
      session     = createCdpSession({ wsUrl, log });
      await session.connect();
      await session.send('Page.enable', {});
    }

    // Registrar script en sesión persistente → Chrome mantiene mientras la sesión viva
    const reg = await session.send('Page.addScriptToEvaluateOnNewDocument', { source });
    scriptId = reg?.identifier;

    // Aplicar en la página actual ahora mismo
    await applyPatch();

    // Re-aplicar en cada navegación (cobertura inmediata post-nav)
    navUnsub = session.on('Page.frameNavigated', params => {
      if (!params?.frame?.parentId) {   // solo main frame
        applyPatch();
      }
    });

    log(`[cdp-stealth] activo, scriptId=${scriptId}`);
  }

  async function stop() {
    if (navUnsub) { navUnsub(); navUnsub = null; }
    if (scriptId && session?.isConnected()) {
      try { await session.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: scriptId }); }
      catch (_) {}
      scriptId = null;
    }
    if (session) { session.close(); session = null; }
    source = null;
    log('[cdp-stealth] detenido');
  }

  function isActive() {
    return !!(session?.isConnected() && scriptId);
  }

  function getScriptId() { return scriptId; }

  return { start, stop, isActive, getScriptId };
}

module.exports = { createCdpStealth };

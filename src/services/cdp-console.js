/**
 * CdpConsole — captura de mensajes de consola del navegador via CDP.
 *
 * Suscribe Runtime.consoleAPICalled, Runtime.exceptionThrown y Log.entryAdded
 * en sesión WS persistente. Los mensajes se acumulan en memoria.
 *
 * Auto-inicia en el primer getMessages() si no está activo.
 */

const http = require('http');
const { createCdpSession } = require('./cdp-session');

function createCdpConsole({ browserUrl, log = () => {} }) {
  let session  = null;
  const buffer = [];   // { level, text, timestamp, url, lineNumber, source? }

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

  function argsToText(args = []) {
    return args.map(a => {
      if (a.type === 'string') return a.value;
      if (a.value !== undefined) return String(a.value);
      if (a.description) return a.description;
      return `[${a.type}]`;
    }).join(' ');
  }

  async function start() {
    if (session && session.isConnected()) return;
    const wsUrl = await getActivePageWs();
    session     = createCdpSession({ wsUrl, log });
    await session.connect();
    await session.send('Runtime.enable', {});
    await session.send('Log.enable', {}).catch(() => {});

    session.on('Runtime.consoleAPICalled', params => {
      buffer.push({
        level:      params.type || 'log',
        text:       argsToText(params.args),
        timestamp:  params.timestamp,
        url:        params.stackTrace?.callFrames?.[0]?.url        || '',
        lineNumber: params.stackTrace?.callFrames?.[0]?.lineNumber ?? 0,
      });
    });

    session.on('Runtime.exceptionThrown', params => {
      const ex = params.exceptionDetails;
      buffer.push({
        level:      'error',
        text:       ex.exception?.description || ex.text || 'Uncaught exception',
        timestamp:  params.timestamp,
        url:        ex.url || ex.stackTrace?.callFrames?.[0]?.url || '',
        lineNumber: ex.lineNumber ?? 0,
      });
    });

    session.on('Log.entryAdded', params => {
      const e = params.entry;
      // evitar duplicados de Runtime ya capturados
      if (e.source === 'javascript') return;
      buffer.push({
        level:      e.level || 'log',
        text:       e.text,
        timestamp:  e.timestamp,
        url:        e.url || '',
        lineNumber: e.lineNumber ?? 0,
        source:     e.source,
      });
    });

    log('[cdp-console] Console capture started');
  }

  function stop() {
    session?.close();
    session = null;
    log('[cdp-console] Console capture stopped');
  }

  function getMessages({ level, text, limit } = {}) {
    let r = buffer;
    if (level) {
      const lvl = level.toLowerCase();
      r = r.filter(m => m.level === lvl);
    }
    if (text) {
      const q = text.toLowerCase();
      r = r.filter(m => m.text?.toLowerCase().includes(q));
    }
    if (limit > 0) r = r.slice(-limit);
    return r;
  }

  function clear() { buffer.length = 0; }

  function isActive() { return !!session && session.isConnected(); }

  return { start, stop, getMessages, clear, isActive };
}

module.exports = { createCdpConsole };

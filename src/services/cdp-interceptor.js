/**
 * CdpInterceptor — servicio de intercepción de requests via CDP Fetch domain.
 *
 * Mantiene una CdpSession persistente y aplica reglas sobre cada request
 * que el navegador pausa (Fetch.requestPaused). Acciones soportadas:
 *   mock     — responde con body/status/headers sintéticos
 *   block    — cancela la request (BlockedByClient)
 *   redirect — reescribe la URL antes de continuar
 *   delay    — espera N ms y continúa
 *   pass     — continúa sin modificar (útil para capturar sin alterar)
 *
 * Patrón: factory con DI. Recibe browserUrl y log; devuelve { start, stop,
 * getCaptured, clearCaptured, isActive }. No toca process.* directamente.
 */

const http = require('http');
const { createCdpSession } = require('./cdp-session');

function createCdpInterceptor({ browserUrl, log = () => {} }) {
  let session  = null;
  let _rules   = [];
  const _captured = [];

  // ── helpers ───────────────────────────────────────────────────────────────

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
            catch (e) { reject(new Error(`/json parse error: ${e.message}`)); }
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

  function matchRule(event) {
    for (const rule of _rules) {
      const re = new RegExp('^' + rule.urlPattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
      if (re.test(event.request.url)) return rule;
    }
    return null;
  }

  // ── event handler ─────────────────────────────────────────────────────────

  async function handlePaused(event) {
    const rule = matchRule(event);

    _captured.push({
      url:      event.request.url,
      method:   event.request.method,
      postData: event.request.postData ?? null,
      headers:  event.request.headers  ?? null,
      rule:     rule?.name  ?? null,
      action:   rule?.action ?? 'pass',
    });

    try {
      if (!rule || rule.action === 'pass') {
        await session.send('Fetch.continueRequest', { requestId: event.requestId });
        return;
      }

      if (rule.action === 'block') {
        await session.send('Fetch.failRequest', {
          requestId:   event.requestId,
          errorReason: 'BlockedByClient',
        });
        return;
      }

      if (rule.action === 'mock') {
        const body = typeof rule.responseBody === 'string'
          ? rule.responseBody
          : JSON.stringify(rule.responseBody ?? {});
        const headers = [
          { name: 'content-type', value: rule.contentType ?? 'application/json' },
          ...(rule.responseHeaders ?? []),
        ];
        await session.send('Fetch.fulfillRequest', {
          requestId:       event.requestId,
          responseCode:    rule.responseCode ?? 200,
          responseHeaders: headers,
          body:            Buffer.from(body).toString('base64'),
        });
        return;
      }

      if (rule.action === 'redirect') {
        // Sustituye * con el wildcard capturado de la URL original
        const patternRe = new RegExp(
          '^' + rule.urlPattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '(.*)') + '$'
        );
        const match       = event.request.url.match(patternRe);
        const redirectUrl = rule.redirectUrl.replace(/\*/g, () => match?.[1] ?? '');
        await session.send('Fetch.continueRequest', {
          requestId: event.requestId,
          url:       redirectUrl,
        });
        return;
      }

      if (rule.action === 'delay') {
        await new Promise(r => setTimeout(r, rule.delayMs ?? 1000));
        await session.send('Fetch.continueRequest', { requestId: event.requestId });
        return;
      }

      if (rule.action === 'add_headers') {
        const existing = Object.entries(event.request.headers || {}).map(([name, value]) => ({ name, value }));
        const extra    = rule.headers ?? [];
        const extraNames = new Set(extra.map(h => h.name.toLowerCase()));
        const merged   = [...existing.filter(h => !extraNames.has(h.name.toLowerCase())), ...extra];
        await session.send('Fetch.continueRequest', { requestId: event.requestId, headers: merged });
        return;
      }

      // fallback
      await session.send('Fetch.continueRequest', { requestId: event.requestId });

    } catch (e) {
      log(`[interceptor] handler error: ${e.message}`);
      try { await session.send('Fetch.continueRequest', { requestId: event.requestId }); } catch {}
    }
  }

  // ── public API ────────────────────────────────────────────────────────────

  async function start(rules) {
    if (session) await stop();
    _rules = rules;
    _captured.length = 0;

    const wsUrl = await getActivePageWs();
    session = createCdpSession({ wsUrl, log });
    await session.connect();

    const patterns = rules.map(r => ({ urlPattern: r.urlPattern, requestStage: 'Request' }));
    await session.send('Fetch.enable', { patterns });
    session.on('Fetch.requestPaused', handlePaused);

    log(`[interceptor] activo — ${rules.length} regla(s): ${rules.map(r => r.name).join(', ')}`);
  }

  async function stop() {
    if (!session) return;
    try { await session.send('Fetch.disable', {}); } catch {}
    session.close();
    session  = null;
    _rules   = [];
    log('[interceptor] detenido');
  }

  function getCaptured()   { return [..._captured]; }
  function clearCaptured() { _captured.length = 0; }
  function isActive()      { return !!session && session.isConnected(); }

  return { start, stop, getCaptured, clearCaptured, isActive };
}

module.exports = { createCdpInterceptor };

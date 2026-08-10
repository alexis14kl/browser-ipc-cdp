/**
 * CdpInterceptor — servicio de intercepción de requests via CDP Fetch domain.
 *
 * Mantiene una CdpSession persistente y aplica reglas sobre cada request
 * que el navegador pausa (Fetch.requestPaused). Acciones soportadas:
 *   mock            — responde con body/status/headers sintéticos
 *   block           — cancela la request (BlockedByClient)
 *   redirect        — reescribe la URL antes de continuar
 *   delay           — espera N ms y continúa
 *   pass            — continúa sin modificar (útil para capturar sin alterar)
 *   add_headers     — inyecta headers extra antes de continuar
 *   modify_response — intercepta la RESPUESTA del servidor y modifica su body
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

  async function handleResponsePaused(event) {
    const rule = matchRule(event);
    if (!rule || rule.action !== 'modify_response') {
      try { await session.send('Fetch.continueResponse', { requestId: event.requestId }); } catch {}
      return;
    }

    try {
      // Leer body original del servidor
      let originalBody = '';
      try {
        const bodyResult = await session.send('Fetch.getResponseBody', { requestId: event.requestId });
        originalBody = bodyResult.base64Encoded
          ? Buffer.from(bodyResult.body, 'base64').toString('utf8')
          : (bodyResult.body ?? '');
      } catch {}

      let modifiedBody = originalBody;

      // jsonPatch: { "field.nested": value } — sobreescribe campos del JSON
      if (rule.jsonPatch && originalBody) {
        try {
          const parsed = JSON.parse(originalBody);
          for (const [path, value] of Object.entries(rule.jsonPatch)) {
            const keys = path.split('.');
            let obj = parsed;
            for (let i = 0; i < keys.length - 1; i++) {
              if (obj[keys[i]] == null) obj[keys[i]] = {};
              obj = obj[keys[i]];
            }
            obj[keys[keys.length - 1]] = value;
          }
          modifiedBody = JSON.stringify(parsed);
        } catch {}
      }

      // replaceBody: reemplaza el body entero
      if (rule.replaceBody !== undefined) {
        modifiedBody = typeof rule.replaceBody === 'string'
          ? rule.replaceBody
          : JSON.stringify(rule.replaceBody);
      }

      _captured.push({
        url:    event.request?.url ?? event.url ?? '',
        method: event.request?.method ?? '',
        stage:  'response',
        rule:   rule.name,
        action: 'modify_response',
      });

      await session.send('Fetch.fulfillRequest', {
        requestId:       event.requestId,
        responseCode:    rule.responseCode ?? event.responseStatusCode ?? 200,
        responseHeaders: event.responseHeaders ?? [],
        body:            Buffer.from(modifiedBody).toString('base64'),
      });
    } catch (e) {
      log(`[interceptor] modify_response error: ${e.message}`);
      try { await session.send('Fetch.continueResponse', { requestId: event.requestId }); } catch {}
    }
  }

  async function handlePaused(event) {
    // response-stage: responseStatusCode presente en el evento
    if (event.responseStatusCode !== undefined) {
      await handleResponsePaused(event);
      return;
    }

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

    const patterns = rules.map(r => ({
      urlPattern:   r.urlPattern,
      requestStage: r.action === 'modify_response' ? 'Response' : 'Request',
    }));
    // El listener va ANTES del enable: el decoder procesa TODOS los frames de un
    // chunk TCP de forma síncrona, así que si el navegador manda la respuesta del
    // enable y la primera ráfaga de requestPaused en el mismo chunk, esos eventos
    // se despachan antes de que corra la continuación del await. Sin handler,
    // dispatch los descarta y esas requests quedan pausadas para siempre (la
    // pestaña se queda a medio cargar, sin error). Registrar antes no tiene costo:
    // el navegador no emite requestPaused hasta que el enable se procesa.
    session.on('Fetch.requestPaused', handlePaused);
    await session.send('Fetch.enable', { patterns });

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

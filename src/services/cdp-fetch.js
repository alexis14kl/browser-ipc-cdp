/**
 * CdpFetch — sesión CDP persistente usando el dominio Fetch para MitM local.
 *
 * Fetch.enable + Fetch.requestPaused permiten pausar CADA request/response
 * y modificarla antes de que el navegador la procese. A diferencia de
 * Network.setRequestInterception (deprecated) y CdpInterceptor que opera
 * a nivel Network, este servicio usa el dominio Fetch moderno que:
 *   - Permite modificar body de request Y response (no solo headers)
 *   - Puede inyectar scripts HTML en respuestas del servidor
 *   - Cubre auth challenges (Fetch.requestPaused con authChallenge)
 *
 * IMPORTANTE: Todo request/response pausado DEBE recibir una respuesta
 * (continueRequest / fulfillRequest / failRequest / continueResponse),
 * de lo contrario el navegador se cuelga esperando indefinidamente.
 *
 * API: enable(), disable(), addRule(rule) → id, removeRule(id), clearRules(), getRules(), isActive()
 */

const http = require('http');
const { createCdpSession } = require('./cdp-session');

function createCdpFetch({ browserUrl, log = () => {} }) {
  let session    = null;
  let pauseUnsub = null;
  let ruleCounter = 0;
  const rules    = new Map(); // id → rule

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

  function matchesPattern(url, pattern) {
    const escaped = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.');
    try { return new RegExp(`^${escaped}$`).test(url); }
    catch (_) { return url.includes(pattern); }
  }

  async function safeRelease(requestId, method = 'Fetch.continueRequest') {
    try { await session.send(method, { requestId }); } catch (_) {}
  }

  async function handleRequestStage(params, matchingRules) {
    const requestId = params.requestId;
    let headers  = { ...(params.request.headers || {}) };
    let postData = params.request.postData;
    let url      = params.request.url;
    let method   = params.request.method;

    for (const rule of matchingRules) {
      const mod = rule.requestModifications || {};
      if (mod.headers)       headers  = { ...headers, ...mod.headers };
      if (mod.removeHeaders) mod.removeHeaders.forEach(h => { delete headers[h]; });
      if (mod.body !== undefined) postData = mod.body;
      if (mod.url)    url    = mod.url;
      if (mod.method) method = mod.method;
    }

    const headersList = Object.entries(headers).map(([name, value]) => ({ name, value: String(value) }));
    await session.send('Fetch.continueRequest', { requestId, url, method, postData, headers: headersList });
  }

  async function handleResponseStage(params, matchingRules) {
    const requestId      = params.requestId;
    let statusCode       = params.responseStatusCode;
    let responseHeaders  = [...(params.responseHeaders || [])];
    let bodyText         = '';

    try {
      const bodyResp = await session.send('Fetch.getResponseBody', { requestId });
      bodyText = bodyResp.base64Encoded
        ? Buffer.from(bodyResp.body, 'base64').toString('utf-8')
        : bodyResp.body;
    } catch (_) {}

    let modified  = bodyText;
    let didModify = false;

    for (const rule of matchingRules) {
      const mod = rule.responseModifications || {};

      if (mod.statusCode !== undefined) {
        statusCode = mod.statusCode;
        didModify  = true;
      }
      if (mod.headers) {
        mod.headers.forEach(h => {
          const idx = responseHeaders.findIndex(r => r.name.toLowerCase() === h.name.toLowerCase());
          if (idx >= 0) responseHeaders[idx] = h;
          else responseHeaders.push(h);
        });
        didModify = true;
      }
      if (mod.replaceBody !== undefined) {
        modified  = mod.replaceBody;
        didModify = true;
      } else if (mod.injectScript) {
        const tag = `<script>${mod.injectScript}<\/script>`;
        modified  = modified.includes('</body>')
          ? modified.replace('</body>', `${tag}</body>`)
          : modified + tag;
        didModify = true;
      } else if (mod.injectHtml) {
        modified  = modified.includes('</body>')
          ? modified.replace('</body>', `${mod.injectHtml}</body>`)
          : modified + mod.injectHtml;
        didModify = true;
      } else if (mod.jsonPatch) {
        try {
          const obj = JSON.parse(modified);
          for (const { op, path, value } of mod.jsonPatch) {
            if (op === 'set') {
              const keys = path.replace(/^\//, '').split('/');
              let cur = obj;
              for (const k of keys.slice(0, -1)) cur = cur[k];
              cur[keys[keys.length - 1]] = value;
            } else if (op === 'delete') {
              const keys = path.replace(/^\//, '').split('/');
              let cur = obj;
              for (const k of keys.slice(0, -1)) cur = cur[k];
              delete cur[keys[keys.length - 1]];
            }
          }
          modified  = JSON.stringify(obj);
          didModify = true;
        } catch (_) {}
      }
    }

    if (didModify) {
      await session.send('Fetch.fulfillRequest', {
        requestId,
        responseCode:    statusCode,
        responseHeaders,
        body:            Buffer.from(modified, 'utf-8').toString('base64'),
      });
    } else {
      await session.send('Fetch.continueResponse', { requestId });
    }
  }

  async function handlePaused(params) {
    const url        = params.request?.url || '';
    const isResponse = params.responseStatusCode !== undefined;

    const matchingRules = [...rules.values()].filter(r => {
      const stageOk = isResponse
        ? (r.stage === 'response' || r.stage === 'both')
        : (r.stage === 'request'  || r.stage === 'both');
      return stageOk && matchesPattern(url, r.urlPattern);
    });

    if (matchingRules.length === 0) {
      await safeRelease(params.requestId, isResponse ? 'Fetch.continueResponse' : 'Fetch.continueRequest');
      return;
    }

    try {
      if (isResponse) await handleResponseStage(params, matchingRules);
      else            await handleRequestStage(params, matchingRules);
    } catch (e) {
      log(`[cdp-fetch] handler error: ${e.message}`);
      await safeRelease(params.requestId);
    }
  }

  async function enable() {
    if (session?.isConnected()) return;

    const wsUrl = await getActivePageWs();
    session     = createCdpSession({ wsUrl, log });
    await session.connect();

    await session.send('Fetch.enable', {
      patterns: [
        { urlPattern: '*', requestStage: 'Request'  },
        { urlPattern: '*', requestStage: 'Response' },
      ],
    });

    pauseUnsub = session.on('Fetch.requestPaused', params => {
      handlePaused(params).catch(e => log(`[cdp-fetch] unhandled: ${e.message}`));
    });

    log('[cdp-fetch] activo');
  }

  async function disable() {
    if (pauseUnsub) { pauseUnsub(); pauseUnsub = null; }
    if (session?.isConnected()) {
      try { await session.send('Fetch.disable', {}); } catch (_) {}
      session.close();
    }
    session = null;
    rules.clear();
    ruleCounter = 0;
    log('[cdp-fetch] detenido');
  }

  function addRule(rule) {
    const id = `rule_${++ruleCounter}`;
    rules.set(id, {
      id,
      urlPattern:            rule.urlPattern || '*',
      stage:                 rule.stage || 'both',
      requestModifications:  rule.requestModifications  || null,
      responseModifications: rule.responseModifications || null,
    });
    log(`[cdp-fetch] regla ${id} agregada: ${rule.urlPattern} [${rule.stage || 'both'}]`);
    return id;
  }

  function removeRule(id)  { return rules.delete(id); }
  function clearRules()    { rules.clear(); ruleCounter = 0; }
  function getRules()      { return [...rules.values()]; }
  function isActive()      { return !!(session?.isConnected()); }

  return { enable, disable, addRule, removeRule, clearRules, getRules, isActive };
}

module.exports = { createCdpFetch };

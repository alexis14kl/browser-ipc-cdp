/**
 * CdpNetworkMonitor — monitoreo pasivo de red via CDP Network domain.
 *
 * Suscribe requestWillBeSent, responseReceived, loadingFinished, loadingFailed
 * en sesión WS persistente. Acumula requests en un Map por requestId.
 *
 * No interfiere con el tráfico (solo observa, no intercepta).
 */

const http = require('http');
const { createCdpSession } = require('./cdp-session');

function createCdpNetworkMonitor({ browserUrl, log = () => {} }) {
  let session         = null;
  const requestMap    = new Map();   // requestId → request object

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

  async function start() {
    if (session && session.isConnected()) return;
    const wsUrl = await getActivePageWs();
    session     = createCdpSession({ wsUrl, log });
    await session.connect();
    await session.send('Network.enable', {});

    session.on('Network.requestWillBeSent', params => {
      requestMap.set(params.requestId, {
        requestId:      params.requestId,
        url:            params.request.url,
        method:         params.request.method,
        type:           params.type || 'Other',
        initiator:      params.initiator?.type || 'other',
        requestHeaders: params.request.headers,
        postData:       params.request.postData || null,
        startTimestamp: params.timestamp,
        status:         null,
        responseHeaders: null,
        mimeType:       null,
        encodedSize:    null,
        durationMs:     null,
        failed:         false,
        errorText:      null,
      });
    });

    session.on('Network.responseReceived', params => {
      const r = requestMap.get(params.requestId);
      if (!r) return;
      r.status          = params.response.status;
      r.responseHeaders = params.response.headers;
      r.mimeType        = params.response.mimeType;
    });

    session.on('Network.loadingFinished', params => {
      const r = requestMap.get(params.requestId);
      if (!r) return;
      r.encodedSize = params.encodedDataLength;
      if (r.startTimestamp) {
        r.durationMs = Math.round((params.timestamp - r.startTimestamp) * 1000);
      }
    });

    session.on('Network.loadingFailed', params => {
      const r = requestMap.get(params.requestId);
      if (!r) return;
      r.failed    = true;
      r.errorText = params.errorText;
    });

    log('[cdp-network-monitor] Network monitoring started');
  }

  function stop() {
    session?.close();
    session = null;
    log('[cdp-network-monitor] Network monitoring stopped');
  }

  function getRequests({ method, status, url, type, failed, limit } = {}) {
    let r = Array.from(requestMap.values());
    if (method)        r = r.filter(x => x.method === method.toUpperCase());
    if (status != null) r = r.filter(x => x.status === status);
    if (url)           r = r.filter(x => x.url.toLowerCase().includes(url.toLowerCase()));
    if (type)          r = r.filter(x => x.type.toLowerCase() === type.toLowerCase());
    if (failed != null) r = r.filter(x => x.failed === failed);
    if (limit > 0)     r = r.slice(-limit);
    return r;
  }

  async function getRequest(urlOrId) {
    let req = requestMap.get(urlOrId);
    if (!req) {
      const q = urlOrId.toLowerCase();
      req = Array.from(requestMap.values()).find(x => x.url.toLowerCase().includes(q));
    }
    if (!req) return null;

    if (session && session.isConnected()) {
      try {
        const body = await session.send('Network.getResponseBody', { requestId: req.requestId });
        return { ...req, responseBody: body.body, responseBodyBase64: body.base64Encoded };
      } catch (_) {}
    }
    return req;
  }

  function clear() { requestMap.clear(); }

  function isActive() { return !!session && session.isConnected(); }

  return { start, stop, getRequests, getRequest, clear, isActive };
}

module.exports = { createCdpNetworkMonitor };

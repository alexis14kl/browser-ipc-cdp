/**
 * CdpCoverage — servicio de cobertura de código via CDP Profiler y CSS domains.
 *
 * Requiere sesión WS persistente: Profiler.enable y CSS.enable son session-scoped
 * en CDP — no persisten entre conexiones one-shot del CdpCaller.
 *
 * Dos sesiones independientes (pueden correr en paralelo):
 *   jsSession  — Profiler domain (JS coverage)
 *   cssSession — CSS domain (CSS coverage)
 *
 * Patrón: factory con DI igual que CdpInterceptor.
 */

const http = require('http');
const { createCdpSession } = require('./cdp-session');

function createCdpCoverage({ browserUrl, log = () => {} }) {
  let jsSession  = null;
  let cssSession = null;

  // ── helper ─────────────────────────────────────────────────────────────────

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

  async function openSession() {
    const wsUrl  = await getActivePageWs();
    const session = createCdpSession({ wsUrl, log });
    await session.connect();
    return session;
  }

  // ── JS Coverage ────────────────────────────────────────────────────────────

  async function startJs({ callCount = true, detailed = true } = {}) {
    if (jsSession) await stopJs().catch(() => {});
    jsSession = await openSession();
    await jsSession.send('Profiler.enable', {});
    await jsSession.send('Profiler.startPreciseCoverage', { callCount, detailed });
    log('[coverage] JS coverage started');
  }

  async function stopJs({ minCoverage, includeEmpty = false } = {}) {
    if (!jsSession) throw new Error('JS coverage not started');
    const { result } = await jsSession.send('Profiler.takePreciseCoverage', {});
    await jsSession.send('Profiler.stopPreciseCoverage', {});
    await jsSession.send('Profiler.disable', {});
    jsSession.close();
    jsSession = null;
    log('[coverage] JS coverage stopped');

    return (result || [])
      .map(script => {
        const totalRanges   = script.functions.reduce((a, fn) => a + fn.ranges.length, 0);
        const coveredRanges = script.functions.reduce((a, fn) => a + fn.ranges.filter(r => r.count > 0).length, 0);
        const pct = totalRanges > 0 ? Math.round((coveredRanges / totalRanges) * 100) : 0;
        return { url: script.url || '(anonymous)', coveragePct: pct, functions: script.functions.length };
      })
      .filter(s => {
        if (!includeEmpty && s.coveragePct === 0 && !s.url.startsWith('http')) return false;
        if (minCoverage != null && s.coveragePct >= minCoverage) return false;
        return true;
      })
      .sort((a, b) => a.coveragePct - b.coveragePct);
  }

  // ── CSS Coverage ───────────────────────────────────────────────────────────

  async function startCss() {
    if (cssSession) await stopCss().catch(() => {});
    cssSession = await openSession();
    await cssSession.send('CSS.enable', {});
    await cssSession.send('CSS.startRuleUsageTracking', {});
    log('[coverage] CSS coverage started');
  }

  async function stopCss({ unusedOnly = true } = {}) {
    if (!cssSession) throw new Error('CSS coverage not started');
    const { ruleUsage } = await cssSession.send('CSS.takeCoverageDelta', {});
    await cssSession.send('CSS.stopRuleUsageTracking', {});
    cssSession.close();
    cssSession = null;
    log('[coverage] CSS coverage stopped');

    const rules = (ruleUsage || []).filter(r => !unusedOnly || !r.used);
    return {
      total:  ruleUsage?.length ?? 0,
      used:   ruleUsage?.filter(r =>  r.used).length ?? 0,
      unused: ruleUsage?.filter(r => !r.used).length ?? 0,
      rules:  rules.slice(0, 200),
    };
  }

  function isJsActive()  { return !!jsSession  && jsSession.isConnected(); }
  function isCssActive() { return !!cssSession && cssSession.isConnected(); }

  return { startJs, stopJs, startCss, stopCss, isJsActive, isCssActive };
}

module.exports = { createCdpCoverage };

/**
 * Security tools — análisis defensivo y reconocimiento de superficie de ataque.
 *
 * Diseñados para pentesting autorizado, auditorías y red team:
 *   security_audit_headers   — análisis de cabeceras HTTP de seguridad
 *   detect_third_party_scripts — identificación de scripts de terceros / supply chain
 *   analyze_network_waterfall  — mapa de peticiones, mixed content, dominios sospechosos
 *   stealth_check             — detección de fingerprints de automatización CDP/browser
 *   bypass_csp      [OFF]    — Page.setBypassCSP(true): deshabilita todos los
 *                              Content-Security-Policy headers del sitio objetivo
 *   spoof_webdriver [OFF]    — Page.addScriptToEvaluateOnNewDocument + Runtime.evaluate
 *                              para ocultar navigator.webdriver antes de cualquier script
 *   extract_http_only_cookies — Network.getCookies bajo sandbox JS: retorna HttpOnly,
 *                              clasifica por rol, exporta formato Netscape/curl
 *
 * Nota: get_cookies (via Network.getCookies) ya expone cookies HttpOnly porque CDP
 * opera bajo la sandbox de JS — documentado en su description.
 */

// ── Catálogo de cabeceras de seguridad ────────────────────────────────────────

const SEC_HEADERS = [
  {
    key: 'content-security-policy',
    label: 'Content-Security-Policy',
    critical: true,
    check(v) {
      const issues = [];
      if (v.includes("'unsafe-inline'")) issues.push("'unsafe-inline' permite inyección XSS");
      if (v.includes("'unsafe-eval'"))   issues.push("'unsafe-eval' permite ejecución de código arbitrario");
      if (/script-src[^;]*\*/.test(v))   issues.push('wildcard en script-src permite cualquier dominio');
      if (!v.includes('default-src') && !v.includes('script-src'))
        issues.push('falta script-src / default-src — sin protección XSS efectiva');
      return { present: true, value: v.substring(0, 200), issues, grade: grade(issues, { 0: 'A', 1: 'B', 2: 'C' }, 'D') };
    },
    absent: () => ({ present: false, issues: ['Ausente — XSS no mitigado por política de contenido'], grade: 'F' }),
  },
  {
    key: 'strict-transport-security',
    label: 'Strict-Transport-Security (HSTS)',
    critical: true,
    check(v) {
      const issues = [];
      const maxAge = parseInt(v.match(/max-age=(\d+)/)?.[1] || '0');
      if (maxAge < 31536000) issues.push(`max-age ${maxAge}s < 1 año (mín recomendado: 31536000)`);
      if (!v.includes('includeSubDomains')) issues.push('falta includeSubDomains — subdominios vulnerables a SSL stripping');
      return { present: true, value: v, maxAgeDays: Math.round(maxAge / 86400), issues, grade: grade(issues, { 0: 'A', 1: 'B' }, 'C') };
    },
    absent: () => ({ present: false, issues: ['Ausente — SSL stripping posible'], grade: 'F' }),
  },
  {
    key: 'x-frame-options',
    label: 'X-Frame-Options',
    critical: false,
    check(v) {
      const issues = /ALLOW/i.test(v) && !/ALLOW-FROM/i.test(v) ? [] :
        v.toUpperCase() === 'ALLOWALL' ? ['ALLOWALL — clickjacking posible'] : [];
      return { present: true, value: v, issues, grade: issues.length ? 'F' : 'A' };
    },
    absent: () => ({ present: false, issues: ['Ausente — clickjacking posible (verificar frame-ancestors en CSP)'], grade: 'C' }),
  },
  {
    key: 'x-content-type-options',
    label: 'X-Content-Type-Options',
    critical: false,
    check(v) {
      const issues = v.toLowerCase() !== 'nosniff' ? ['Valor debe ser "nosniff"'] : [];
      return { present: true, value: v, issues, grade: issues.length ? 'B' : 'A' };
    },
    absent: () => ({ present: false, issues: ['Ausente — MIME-sniffing posible'], grade: 'C' }),
  },
  {
    key: 'referrer-policy',
    label: 'Referrer-Policy',
    critical: false,
    check(v) {
      const risky = ['unsafe-url', 'origin-when-cross-origin'];
      const issues = risky.includes(v.toLowerCase()) ? [`"${v}" filtra URL completa a terceros`] : [];
      return { present: true, value: v, issues, grade: issues.length ? 'C' : 'A' };
    },
    absent: () => ({ present: false, issues: ['Ausente — navegador usa política por defecto (puede filtrar referrer)'], grade: 'C' }),
  },
  {
    key: 'permissions-policy',
    label: 'Permissions-Policy',
    critical: false,
    check(v) {
      return { present: true, value: v.substring(0, 120), issues: [], grade: 'A' };
    },
    absent: () => ({ present: false, issues: ['Ausente — sin política explícita de APIs del navegador'], grade: 'C' }),
  },
  {
    key: 'access-control-allow-origin',
    label: 'CORS (Access-Control-Allow-Origin)',
    critical: false,
    check(v) {
      const issues = v === '*' ? ['Wildcard CORS — cualquier origen puede leer respuestas (peligroso en APIs autenticadas)'] : [];
      return { present: true, value: v, issues, grade: issues.length ? 'D' : 'A' };
    },
    absent: () => ({ present: false, issues: [], grade: 'N/A', note: 'Normal en páginas no-API' }),
  },
  {
    key: 'x-xss-protection',
    label: 'X-XSS-Protection (deprecado)',
    critical: false,
    check(v) {
      return { present: true, value: v, issues: [], grade: 'B', note: 'Deprecado — reemplazar con CSP' };
    },
    absent: () => ({ present: false, issues: [], grade: 'N/A', note: 'Deprecado — usar CSP' }),
  },
];

// ── Catálogo de servicios de terceros conocidos ───────────────────────────────

const KNOWN_SERVICES = {
  'google-analytics.com':    { name: 'Google Analytics',    category: 'analytics',  risk: 'low' },
  'googletagmanager.com':    { name: 'Google Tag Manager',  category: 'tag-mgr',    risk: 'medium' },
  'googlesyndication.com':   { name: 'Google AdSense',      category: 'ads',        risk: 'low' },
  'doubleclick.net':         { name: 'Google DoubleClick',  category: 'ads',        risk: 'low' },
  'facebook.net':            { name: 'Facebook Pixel',      category: 'tracking',   risk: 'medium' },
  'connect.facebook.net':    { name: 'Facebook SDK',        category: 'social',     risk: 'medium' },
  'recaptcha.net':           { name: 'Google reCAPTCHA',    category: 'security',   risk: 'low' },
  'gstatic.com':             { name: 'Google Static',       category: 'cdn',        risk: 'low' },
  'google.com':              { name: 'Google',              category: 'misc',       risk: 'low' },
  'googleapis.com':          { name: 'Google APIs',         category: 'cdn',        risk: 'low' },
  'cdn.jsdelivr.net':        { name: 'jsDelivr CDN',        category: 'cdn',        risk: 'low' },
  'cdnjs.cloudflare.com':    { name: 'Cloudflare CDN',      category: 'cdn',        risk: 'low' },
  'unpkg.com':               { name: 'unpkg CDN',           category: 'cdn',        risk: 'low' },
  'cloudflare.com':          { name: 'Cloudflare',          category: 'cdn',        risk: 'low' },
  'amazonaws.com':           { name: 'AWS S3/CloudFront',   category: 'cloud',      risk: 'low' },
  'azurefd.net':             { name: 'Azure Front Door',    category: 'cloud',      risk: 'low' },
  'hotjar.com':              { name: 'Hotjar',              category: 'analytics',  risk: 'medium' },
  'mixpanel.com':            { name: 'Mixpanel',            category: 'analytics',  risk: 'medium' },
  'segment.com':             { name: 'Segment',             category: 'analytics',  risk: 'medium' },
  'amplitude.com':           { name: 'Amplitude',           category: 'analytics',  risk: 'medium' },
  'intercom.io':             { name: 'Intercom',            category: 'support',    risk: 'medium' },
  'stripe.com':              { name: 'Stripe',              category: 'payment',    risk: 'low' },
  'paypal.com':              { name: 'PayPal',              category: 'payment',    risk: 'low' },
  'jquery.com':              { name: 'jQuery CDN',          category: 'cdn',        risk: 'low' },
  'bootstrapcdn.com':        { name: 'Bootstrap CDN',       category: 'cdn',        risk: 'low' },
  'sentry.io':               { name: 'Sentry',              category: 'monitoring', risk: 'low' },
  'bugsnag.com':             { name: 'Bugsnag',             category: 'monitoring', risk: 'low' },
  'datadog-browser-agent.com': { name: 'Datadog RUM',       category: 'monitoring', risk: 'low' },
  'newrelic.com':            { name: 'New Relic',           category: 'monitoring', risk: 'low' },
  'recaptcha.google.com':    { name: 'Google reCAPTCHA',    category: 'security',   risk: 'low' },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function grade(issues, map, fallback) {
  const n = issues.length;
  return map[n] ?? fallback;
}

function classifyHost(srcUrl, pageHost) {
  try {
    const host = new URL(srcUrl).hostname.replace(/^www\./, '');
    const isThirdParty = host !== pageHost && !host.endsWith('.' + pageHost);
    const knownEntry = Object.entries(KNOWN_SERVICES).find(([k]) => host.endsWith(k));
    return {
      host,
      thirdParty: isThirdParty,
      service: knownEntry ? knownEntry[1].name : null,
      category: knownEntry ? knownEntry[1].category : null,
      risk: knownEntry ? knownEntry[1].risk : (isThirdParty ? 'unknown' : 'same-origin'),
    };
  } catch { return null; }
}

// ── Tools ─────────────────────────────────────────────────────────────────────

function createSecurityTools({ caller }) {

  // 1. security_audit_headers ─────────────────────────────────────────────────
  const securityAuditHeaders = {
    name: 'security_audit_headers',
    description: 'Audit HTTP security headers of the current page (CSP, HSTS, X-Frame-Options, CORS, etc.). Grades each header A-F and lists misconfigurations. Useful for defensive audits and demonstrating header-based vulnerabilities.',
    inputSchema: { type: 'object', properties: {} },
    async handler() {
      // Obtener cabeceras via fetch desde el contexto de la página (mismo origen)
      const expr = `(async () => {
        const url = location.href;
        try {
          const r = await fetch(url, { method: 'HEAD', credentials: 'include', cache: 'no-store' });
          const headers = {};
          r.headers.forEach((v, k) => { headers[k] = v; });
          return { ok: true, status: r.status, url, headers };
        } catch (e1) {
          try {
            const r = await fetch(url, { credentials: 'include', cache: 'no-store',
              signal: AbortSignal.timeout ? AbortSignal.timeout(5000) : undefined });
            const headers = {};
            r.headers.forEach((v, k) => { headers[k] = v; });
            return { ok: true, status: r.status, url, headers };
          } catch(e2) {
            return { ok: false, error: e2.message };
          }
        }
      })()`;

      const res = await caller.call('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
      const data = res?.result?.value;
      if (!data?.ok) {
        return [{ type: 'text', text: JSON.stringify({ error: 'No se pudo obtener cabeceras', detail: data?.error }, null, 2) }];
      }

      const headers = data.headers;
      const results = SEC_HEADERS.map(def => {
        const val = headers[def.key];
        return { header: def.label, critical: def.critical, ...(val ? def.check(val) : def.absent()) };
      });

      const score = results.filter(r => r.critical && r.grade === 'F').length;
      const summary = {
        url: data.url,
        httpStatus: data.status,
        criticalFails: score,
        overallRisk: score === 0 ? 'LOW' : score === 1 ? 'MEDIUM' : 'HIGH',
        headers: results,
      };

      return [{ type: 'text', text: JSON.stringify(summary, null, 2) }];
    },
  };

  // 2. detect_third_party_scripts ─────────────────────────────────────────────
  const detectThirdPartyScripts = {
    name: 'detect_third_party_scripts',
    description: 'Identify all third-party scripts, iframes and stylesheets on the current page. Classifies known services (Analytics, CDN, Ads, Tracking) and flags unknown third parties — useful for supply chain attack surface mapping.',
    inputSchema: {
      type: 'object',
      properties: {
        riskFilter: {
          type: 'string',
          enum: ['all', 'unknown', 'medium', 'high'],
          description: 'Return only resources matching this risk level. Default: all.',
        },
      },
    },
    async handler(args) {
      const riskFilter = args.riskFilter || 'all';

      const expr = `(() => {
        const origin = location.hostname.replace(/^www\\./, '');
        function info(src) {
          if (!src) return null;
          try {
            const url = new URL(src, location.href);
            return { src: url.href, host: url.hostname };
          } catch { return null; }
        }
        const scripts    = Array.from(document.querySelectorAll('script[src]')).map(e => info(e.src)).filter(Boolean);
        const styles     = Array.from(document.querySelectorAll('link[rel="stylesheet"][href]')).map(e => info(e.href)).filter(Boolean);
        const iframes    = Array.from(document.querySelectorAll('iframe[src]')).map(e => info(e.src)).filter(Boolean);
        const imgs       = Array.from(document.querySelectorAll('img[src]')).map(e => info(e.src)).filter(Boolean);
        return { origin, scripts, styles, iframes, imgs };
      })()`;

      const res = await caller.call('Runtime.evaluate', { expression: expr, returnByValue: true });
      const { origin, scripts, styles, iframes, imgs } = res?.result?.value || {};

      function classify(items, type) {
        return items.map(({ src, host }) => {
          const pageHost = origin.replace(/^www\./, '');
          const clean    = host.replace(/^www\./, '');
          const isThird  = clean !== pageHost && !clean.endsWith('.' + pageHost);
          const entry    = Object.entries(KNOWN_SERVICES).find(([k]) => clean.endsWith(k));
          return {
            type,
            src: src.length > 120 ? src.substring(0, 120) + '...' : src,
            host: clean,
            thirdParty: isThird,
            service: entry ? entry[1].name     : null,
            category: entry ? entry[1].category : null,
            risk:     entry ? entry[1].risk     : (isThird ? 'unknown' : 'same-origin'),
          };
        }).filter(r => r.thirdParty);
      }

      let all = [
        ...classify(scripts, 'script'),
        ...classify(styles,  'stylesheet'),
        ...classify(iframes, 'iframe'),
        ...classify(imgs,    'image'),
      ];

      if (riskFilter !== 'all') {
        const order = { unknown: 3, high: 2, medium: 1, low: 0, 'same-origin': -1 };
        const minRisk = order[riskFilter] ?? 0;
        all = all.filter(r => (order[r.risk] ?? 0) >= minRisk);
      }

      const byHost = {};
      all.forEach(r => {
        if (!byHost[r.host]) byHost[r.host] = { host: r.host, service: r.service, category: r.category, risk: r.risk, resources: [] };
        byHost[r.host].resources.push({ type: r.type, src: r.src });
      });

      const result = {
        pageOrigin: origin,
        thirdPartyCount: Object.keys(byHost).length,
        unknownCount: Object.values(byHost).filter(h => h.risk === 'unknown').length,
        domains: Object.values(byHost).sort((a, b) => (b.risk === 'unknown' ? 1 : 0) - (a.risk === 'unknown' ? 1 : 0)),
      };

      return [{ type: 'text', text: JSON.stringify(result, null, 2) }];
    },
  };

  // 3. analyze_network_waterfall ──────────────────────────────────────────────
  const analyzeNetworkWaterfall = {
    name: 'analyze_network_waterfall',
    description: 'Analyze the page resource waterfall using PerformanceResourceTiming API. Detects mixed content (HTTP on HTTPS pages), slow resources, cross-origin requests and connection protocol breakdown. No monitoring session needed.',
    inputSchema: {
      type: 'object',
      properties: {
        slowMs: {
          type: 'number',
          description: 'Threshold in ms to flag slow resources. Default: 1000.',
        },
        includeAll: {
          type: 'boolean',
          description: 'Include same-origin resources. Default: false (only third-party + anomalies).',
        },
      },
    },
    async handler(args) {
      const slowMs    = args.slowMs ?? 1000;
      const includeAll = args.includeAll === true;

      const expr = `(() => {
        const entries = performance.getEntriesByType('resource');
        const pageProto = location.protocol;
        const pageHost  = location.hostname.replace(/^www\\./, '');
        return entries.map(e => {
          let host = '', proto = '';
          try { const u = new URL(e.name); host = u.hostname.replace(/^www\\./, ''); proto = u.protocol; } catch {}
          const isThird    = host !== pageHost && !host.endsWith('.' + pageHost);
          const mixedContent = pageProto === 'https:' && proto === 'http:';
          const slow       = e.duration > ${slowMs};
          return {
            name:         e.name.length > 100 ? e.name.substring(0, 100) + '...' : e.name,
            host,
            proto,
            type:         e.initiatorType,
            durationMs:   Math.round(e.duration),
            sizeKB:       e.transferSize > 0 ? +(e.transferSize / 1024).toFixed(1) : null,
            cached:       e.transferSize === 0 && e.decodedBodySize > 0,
            protocol:     e.nextHopProtocol || null,
            thirdParty:   isThird,
            mixedContent,
            slow,
          };
        });
      })()`;

      const res = await caller.call('Runtime.evaluate', { expression: expr, returnByValue: true });
      const entries = res?.result?.value || [];

      const flagged    = entries.filter(e => e.mixedContent || e.slow);
      const thirdParty = entries.filter(e => e.thirdParty);
      const mixed      = entries.filter(e => e.mixedContent);
      const slow       = entries.filter(e => e.slow);

      const protocols = {};
      entries.forEach(e => { if (e.protocol) protocols[e.protocol] = (protocols[e.protocol] || 0) + 1; });

      const result = {
        url:            location?.href,
        totalResources: entries.length,
        thirdParty:     thirdParty.length,
        mixedContent:   mixed.length,
        slowResources:  slow.length,
        protocols,
        issues: [
          ...mixed.map(e => ({ type: 'MIXED_CONTENT', resource: e.name, host: e.host })),
          ...slow.map(e =>  ({ type: 'SLOW', resource: e.name, durationMs: e.durationMs })),
        ],
        thirdPartyDomains: [...new Set(thirdParty.map(e => e.host))],
        resources: includeAll ? entries : [...flagged, ...thirdParty].filter((v, i, a) => a.indexOf(v) === i),
      };

      return [{ type: 'text', text: JSON.stringify(result, null, 2) }];
    },
  };

  // 4. stealth_check ──────────────────────────────────────────────────────────
  const stealthCheck = {
    name: 'stealth_check',
    description: 'Detect browser automation fingerprints that anti-bot systems use to identify CDP/Playwright/Puppeteer/Selenium sessions. Reports exposed signals and rates overall detectability risk.',
    inputSchema: { type: 'object', properties: {} },
    async handler() {
      const expr = `(() => {
        const findings = {};

        // navigator.webdriver — señal más básica de automatización
        findings.webdriver = { value: navigator.webdriver, risk: navigator.webdriver ? 'HIGH' : 'OK' };

        // Chrome runtime — ausente en headless puro
        const hasChromeRuntime = !!(window.chrome && (window.chrome.runtime || window.chrome.app));
        findings.chromeRuntime = { value: hasChromeRuntime, risk: hasChromeRuntime ? 'OK' : 'MEDIUM' };

        // Artefactos CDP pre-116 (cdc_ prefix)
        const cdcKeys = Object.keys(window).filter(k => k.startsWith('cdc_'));
        findings.cdpArtifacts = { value: cdcKeys, risk: cdcKeys.length ? 'HIGH' : 'OK' };

        // Playwright / Puppeteer globals
        findings.playwright = { value: '__playwright' in window || '__pw_manual' in window, risk: ('__playwright' in window || '__pw_manual' in window) ? 'HIGH' : 'OK' };
        findings.puppeteer  = { value: '__puppeteer_evaluation_script__' in window, risk: ('__puppeteer_evaluation_script__' in window) ? 'HIGH' : 'OK' };

        // Selenium
        const seleniumKeys = ['selenium','callSelenium','_selenium','__webdriverFunc','webdriver'];
        const selFound = seleniumKeys.filter(k => k in window);
        findings.selenium = { value: selFound, risk: selFound.length ? 'HIGH' : 'OK' };

        // Plugins — headless tiene 0 plugins
        findings.plugins = { value: navigator.plugins.length, risk: navigator.plugins.length === 0 ? 'HIGH' : 'OK' };

        // Languages — debe ser no vacío
        findings.languages = { value: navigator.languages?.join(','), risk: (!navigator.languages || !navigator.languages.length) ? 'HIGH' : 'OK' };

        // Hardware concurrency — 0 o 1 es sospechoso
        findings.hardwareConcurrency = { value: navigator.hardwareConcurrency, risk: (navigator.hardwareConcurrency < 2) ? 'MEDIUM' : 'OK' };

        // Device memory
        findings.deviceMemory = { value: navigator.deviceMemory, risk: (navigator.deviceMemory && navigator.deviceMemory < 1) ? 'MEDIUM' : 'OK' };

        // Notification permission — headless suele retornar 'denied' o 'default' diferente
        findings.notificationPermission = { value: typeof Notification !== 'undefined' ? Notification.permission : 'undefined', risk: 'INFO' };

        // WebGL renderer — 'SwiftShader' indica GPU virtual (headless típico)
        let webglRenderer = 'unknown';
        try {
          const c = document.createElement('canvas');
          const gl = c.getContext('webgl') || c.getContext('experimental-webgl');
          if (gl) {
            const ext = gl.getExtension('WEBGL_debug_renderer_info');
            webglRenderer = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'no-ext';
          }
        } catch(e) { webglRenderer = 'error'; }
        const swiftShader = /swiftshader|llvmpipe|virtualbox|vmware/i.test(webglRenderer);
        findings.webglRenderer = { value: webglRenderer, risk: swiftShader ? 'HIGH' : 'OK' };

        // Function.prototype.toString integridad (Puppeteer la parchea)
        const toStringStr = Function.prototype.toString.toString();
        const tampered = !toStringStr.includes('function toString') && !toStringStr.includes('native code');
        findings.toStringIntegrity = { value: tampered ? 'tampered' : 'native', risk: tampered ? 'MEDIUM' : 'OK' };

        // Resumen
        const risks = Object.values(findings).map(f => f.risk);
        const highCount   = risks.filter(r => r === 'HIGH').length;
        const mediumCount = risks.filter(r => r === 'MEDIUM').length;

        return {
          overall: highCount > 0 ? 'HIGH_DETECTABLE' : mediumCount > 0 ? 'MEDIUM_DETECTABLE' : 'LIKELY_CLEAN',
          highRiskSignals: highCount,
          mediumRiskSignals: mediumCount,
          findings,
        };
      })()`;

      const res = await caller.call('Runtime.evaluate', { expression: expr, returnByValue: true });
      const data = res?.result?.value;

      return [{ type: 'text', text: JSON.stringify(data, null, 2) }];
    },
  };

  // 5. bypass_csp ─────────────────────────────────────────────────────────────
  //
  // Page.setBypassCSP(true) instructs Chrome to ignore ALL CSP directives for the
  // current page — script-src, default-src, connect-src, everything. After calling
  // this you can inject inline <script> tags, call eval(), load cross-origin scripts
  // via DOM manipulation and they will execute without being blocked.
  //
  // Scope: persists for the lifetime of the CDP session or until called with
  // enabled=false. Does NOT survive a hard reload (F5 issues a new document load
  // but the CDP domain command stays active, so Chrome re-applies the bypass on
  // the new document automatically while the session is open).
  //
  // Note: Runtime.evaluate already bypasses CSP for CDP-injected code (evaluate_script
  // tool). bypass_csp is needed when the PAYLOAD itself must run in the page context
  // as a normal inline script — e.g. testing stored XSS execution, injecting a
  // script tag that loads a C2/collaborator, or chaining DOM-based XSS flows.
  const bypassCsp = {
    name: 'bypass_csp',
    description: 'Enable or disable Chrome\'s CSP enforcement for the current page via Page.setBypassCSP. When enabled, all Content-Security-Policy directives (script-src, connect-src, etc.) are ignored — inline scripts, eval(), and cross-origin loads execute without restriction. Use for XSS payload testing, CSP bypass research, and injecting scripts that must run in the page context rather than via CDP evaluate.',
    inputSchema: {
      type: 'object',
      properties: {
        enabled: {
          type: 'boolean',
          description: 'true = disable CSP enforcement (offensive). false = restore CSP enforcement. Default: true.',
        },
        verify: {
          type: 'boolean',
          description: 'After toggling, inject a canary eval() to confirm bypass is active. Default: true.',
        },
      },
    },
    async handler(args) {
      const enabled = args.enabled !== false;
      const verify  = args.verify  !== false;

      await caller.call('Page.setBypassCSP', { enabled });

      let verifyResult = null;
      if (verify) {
        // Probe: eval + inline script injection. Both blocked by strict CSP.
        // If bypass active, both return a value; if not, they throw or return null.
        const probe = await caller.call('Runtime.evaluate', {
          expression: `(() => {
            const canary = { eval: null, inlineScript: null, error: null };
            try {
              canary.eval = eval('"csp-bypass-active"');
            } catch(e) { canary.eval = 'BLOCKED: ' + e.message; }
            try {
              const s = document.createElement('script');
              s.textContent = 'window.__csp_probe = "injected"';
              document.head.appendChild(s);
              canary.inlineScript = window.__csp_probe || 'NO_OUTPUT';
              delete window.__csp_probe;
            } catch(e) { canary.inlineScript = 'BLOCKED: ' + e.message; }
            return canary;
          })()`,
          returnByValue: true,
        });
        verifyResult = probe?.result?.value;
      }

      const result = {
        bypassEnabled: enabled,
        status: enabled ? 'CSP DISABLED — all directives ignored' : 'CSP RESTORED — normal enforcement',
        note: 'Persists for this CDP session. Hard reload keeps bypass active while session is open.',
        verification: verifyResult,
      };

      return [{ type: 'text', text: JSON.stringify(result, null, 2) }];
    },
  };

  // 6. spoof_webdriver ────────────────────────────────────────────────────────
  //
  // Two-layer approach required:
  //   Layer A — Page.addScriptToEvaluateOnNewDocument: runs BEFORE any page
  //             script on every future navigation. This is the only reliable
  //             way to hide webdriver from anti-bot checks that run at parse
  //             time (before Runtime.evaluate can fire).
  //   Layer B — Runtime.evaluate on the current document: patches the already-
  //             loaded page immediately without waiting for a reload.
  //
  // The patch itself uses a fallback chain because navigator.webdriver is
  // non-configurable on CDP-attached sessions in some Chrome builds:
  //   1. Object.defineProperty (fastest, cleanest)
  //   2. delete + redefine (works if property is deletable)
  //   3. Proxy on window.navigator (last resort, slightly detectable)
  //
  // scriptId stored in closure so enabled=false can remove the exact script
  // that was registered without touching scripts added by other tools.
  let spoofScriptId = null;

  const WEBDRIVER_PATCH = `
    (function() {
      const patch = () => {
        try {
          Object.defineProperty(navigator, 'webdriver', {
            get: () => undefined,
            configurable: true,
            enumerable: false,
          });
        } catch (_) {
          try {
            delete navigator.webdriver;
            Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
          } catch (_2) {
            window.navigator = new Proxy(navigator, {
              get(t, p) {
                if (p === 'webdriver') return undefined;
                const v = t[p];
                return typeof v === 'function' ? v.bind(t) : v;
              },
            });
          }
        }
      };
      patch();
    })();
  `;

  const spoofWebdriver = {
    name: 'spoof_webdriver',
    description: 'Patch navigator.webdriver to undefined so anti-bot systems cannot detect CDP automation. Uses Page.addScriptToEvaluateOnNewDocument (runs before any page script on future navigations) + Runtime.evaluate (patches the current page immediately). Call with enabled=false to remove the patch. Run stealth_check after to verify.',
    inputSchema: {
      type: 'object',
      properties: {
        enabled: {
          type: 'boolean',
          description: 'true = activate spoof (default). false = remove it.',
        },
      },
    },
    async handler(args) {
      const enabled = args.enabled !== false;

      if (!enabled) {
        if (spoofScriptId) {
          await caller.call('Page.removeScriptToEvaluateOnNewDocument', { identifier: spoofScriptId });
          spoofScriptId = null;
        }
        return [{ type: 'text', text: JSON.stringify({
          spoofActive: false,
          status: 'Patch removed — navigator.webdriver will be true on next navigation',
        }, null, 2) }];
      }

      // Remove stale script if re-enabling
      if (spoofScriptId) {
        try { await caller.call('Page.removeScriptToEvaluateOnNewDocument', { identifier: spoofScriptId }); } catch (_) {}
        spoofScriptId = null;
      }

      // Layer A: register for all future documents
      const reg = await caller.call('Page.addScriptToEvaluateOnNewDocument', { source: WEBDRIVER_PATCH });
      spoofScriptId = reg?.identifier;

      // Layer B: apply to the current page right now
      await caller.call('Runtime.evaluate', { expression: WEBDRIVER_PATCH });

      // Verify on current page
      const check = await caller.call('Runtime.evaluate', {
        expression: 'navigator.webdriver',
        returnByValue: true,
      });
      const currentValue = check?.result?.value;

      return [{ type: 'text', text: JSON.stringify({
        spoofActive:          true,
        scriptId:             spoofScriptId,
        currentPagePatched:   currentValue === undefined || currentValue === null,
        currentWebdriver:     currentValue,
        status:               currentValue === undefined || currentValue === null
          ? 'CLEAN — navigator.webdriver is undefined on current page and all future navigations'
          : 'PARTIAL — script registered for future navigations but current page could not be patched',
      }, null, 2) }];
    },
  };

  // 7. extract_http_only_cookies ─────────────────────────────────────────────
  //
  // Network.getCookies operates below the JS sandbox — it returns ALL cookies
  // including HttpOnly (document.cookie filters these out deliberately).
  // This tool wraps that call with security-focused extras:
  //   - Filters to httpOnly=true by default
  //   - Classifies cookies by likely role (session, auth, csrf, tracking)
  //   - Exports in Netscape/curl format for direct use in other tools
  //   - Flags cookies without Secure flag on HTTPS pages (misconfiguration)
  const extractHttpOnlyCookies = {
    name: 'extract_http_only_cookies',
    description: 'Extract HttpOnly cookies that are inaccessible to JavaScript via document.cookie. Uses CDP Network.getCookies which bypasses the JS sandbox and returns all cookies including HttpOnly and Secure. Classifies cookies by role (session, auth, CSRF, tracking) and exports in Netscape format for use with curl/Burp/httpx.',
    inputSchema: {
      type: 'object',
      properties: {
        httpOnly: {
          type: 'boolean',
          description: 'true = only HttpOnly cookies (default). false = all cookies.',
        },
        format: {
          type: 'string',
          enum: ['json', 'netscape', 'both'],
          description: 'Output format. "netscape" = curl/wget cookie file format. Default: both.',
        },
        urls: {
          type: 'array',
          items: { type: 'string' },
          description: 'Filter by specific URLs. Omit to get all cookies for the current page.',
        },
      },
    },
    async handler(args) {
      const onlyHttpOnly = args.httpOnly !== false;
      const format       = args.format || 'both';

      const urlRes = await caller.call('Runtime.evaluate', {
        expression: 'location.href',
        returnByValue: true,
      });
      const pageUrl  = urlRes?.result?.value || '';
      const pageHost = (() => { try { return new URL(pageUrl).hostname; } catch { return ''; } })();
      const isHttps  = pageUrl.startsWith('https:');

      const params = args.urls?.length ? { urls: args.urls } : {};
      const res    = await caller.call('Network.getCookies', params);
      let cookies  = res?.cookies || [];

      if (onlyHttpOnly) cookies = cookies.filter(c => c.httpOnly);

      // Classify by cookie name patterns
      function classify(name) {
        const n = name.toLowerCase();
        if (/^(jsessionid|phpsessid|asp\.net_sessionid|connect\.sid|session|sess|sid)/.test(n)) return 'session';
        if (/^(token|auth|jwt|bearer|access_token|id_token|refresh_token)/.test(n)) return 'auth';
        if (/(csrf|xsrf|_token|csrftoken)/.test(n)) return 'csrf';
        if (/^(_ga|_gid|_fbp|_uetsid|_clck|mp_|amplitude)/.test(n)) return 'tracking';
        if (/(remember|persistent|keep_alive|autologin)/.test(n)) return 'persistent-auth';
        return 'unknown';
      }

      const enriched = cookies.map(c => ({
        name:     c.name,
        value:    c.value,
        domain:   c.domain,
        path:     c.path,
        httpOnly: c.httpOnly,
        secure:   c.secure,
        sameSite: c.sameSite || null,
        expires:  c.expires > 0 ? new Date(c.expires * 1000).toISOString() : 'session',
        role:     classify(c.name),
        warnings: [
          ...(isHttps && !c.secure ? ['missing Secure flag on HTTPS — cookie can leak over HTTP'] : []),
          ...(!c.sameSite || c.sameSite === 'None' ? ['SameSite=None or unset — CSRF risk'] : []),
        ],
      }));

      // Netscape format: domain  includeSubdomains  path  secure  expiry  name  value
      const netscape = [
        '# Netscape HTTP Cookie File',
        ...enriched.map(c => [
          c.domain.startsWith('.') ? c.domain : '.' + c.domain,
          'TRUE',
          c.path || '/',
          c.secure ? 'TRUE' : 'FALSE',
          c.expires === 'session' ? '0' : Math.floor(new Date(c.expires).getTime() / 1000),
          c.name,
          c.value,
        ].join('\t')),
      ].join('\n');

      const summary = {
        pageUrl,
        totalFound:     enriched.length,
        byRole:         enriched.reduce((acc, c) => { acc[c.role] = (acc[c.role] || 0) + 1; return acc; }, {}),
        withWarnings:   enriched.filter(c => c.warnings.length).length,
      };

      const out = {
        summary,
        ...(format === 'json'  || format === 'both' ? { cookies: enriched } : {}),
        ...(format === 'netscape' || format === 'both' ? { netscape } : {}),
      };

      return [{ type: 'text', text: JSON.stringify(out, null, 2) }];
    },
  };

  return [securityAuditHeaders, detectThirdPartyScripts, analyzeNetworkWaterfall, stealthCheck, bypassCsp, spoofWebdriver, extractHttpOnlyCookies];
}

module.exports = { createSecurityTools };

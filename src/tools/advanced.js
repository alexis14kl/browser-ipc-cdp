/**
 * Advanced Testing Tools — tools de alto nivel para QA/testers avanzados.
 *
 * Son wrappers semánticos sobre setup_request_interception que ocultan la
 * complejidad del Fetch domain CDP y exponen operaciones con nombres claros.
 * Cada tool arranca una sesión de intercepción nueva (reemplaza la anterior).
 * Para múltiples reglas simultáneas usar setup_request_interception directamente.
 *
 * Tools:
 *   mock_api            — respuesta sintética para un endpoint
 *   block_resources     — bloquear categorías de recursos (imgs, ads, fonts…)
 *   inject_error        — forzar código de error HTTP en un endpoint
 *   capture_payloads    — capturar POST body sin alterar la request
 *   add_auth_header     — inyectar Authorization (u otro header) en flight
 *   redirect_to_local   — redirigir prod → localhost (frontend vs backend local)
 *   throttle_api        — agregar latencia artificial a endpoints específicos
 */

function createAdvancedTools({ interceptor }) {

  // ── 1. mock_api ────────────────────────────────────────────────────────────
  const mockApi = {
    name: 'mock_api',
    description: 'Return a synthetic JSON response for a URL pattern. Test UI without a real backend.',
    inputSchema: {
      type: 'object',
      required: ['urlPattern', 'responseBody'],
      properties: {
        urlPattern:   { type: 'string', description: 'URL pattern with optional * wildcards. E.g. "*/api/users*".' },
        responseBody: { description: 'JSON object/array to return as response body.' },
        statusCode:   { type: 'number', description: 'HTTP status code. Default: 200.' },
        contentType:  { type: 'string', description: 'Content-Type header. Default: application/json.' },
      },
    },
    async handler(args) {
      await interceptor.start([{
        name:         'mock_api',
        urlPattern:   args.urlPattern,
        action:       'mock',
        responseCode: args.statusCode  ?? 200,
        responseBody: args.responseBody,
        contentType:  args.contentType ?? 'application/json',
      }]);
      const preview = JSON.stringify(args.responseBody).slice(0, 80);
      return [{ type: 'text', text: `Mocking ${args.urlPattern} → ${args.statusCode ?? 200} ${preview}${preview.length >= 80 ? '…' : ''}` }];
    },
  };

  // ── 2. block_resources ─────────────────────────────────────────────────────
  const RESOURCE_PATTERNS = {
    images:    ['*.png', '*.jpg', '*.jpeg', '*.gif', '*.webp', '*.svg', '*.ico', '*.avif'],
    fonts:     ['*.woff', '*.woff2', '*.ttf', '*.eot', '*.otf'],
    analytics: ['*google-analytics*', '*googletagmanager*', '*hotjar*', '*mixpanel*', '*segment.io*', '*amplitude*', '*clarity.ms*'],
    ads:       ['*doubleclick*', '*googlesyndication*', '*adnxs*', '*adsystem*', '*adserver*', '*moatads*', '*adsrvr*'],
    scripts:   ['*.js'],
    styles:    ['*.css'],
    media:     ['*.mp4', '*.webm', '*.ogg', '*.mp3', '*.wav', '*.m4a'],
  };

  const blockResources = {
    name: 'block_resources',
    description: 'Block resource categories to speed up pages or remove noise. Categories: images, fonts, analytics, ads, scripts, styles, media.',
    inputSchema: {
      type: 'object',
      required: ['categories'],
      properties: {
        categories: {
          type: 'array',
          items: { type: 'string', enum: Object.keys(RESOURCE_PATTERNS) },
          description: 'Resource categories to block.',
        },
      },
    },
    async handler(args) {
      const rules = args.categories.flatMap(cat =>
        (RESOURCE_PATTERNS[cat] ?? []).map((urlPattern, i) => ({
          name:       `block-${cat}-${i}`,
          urlPattern,
          action:     'block',
        }))
      );
      if (!rules.length) return [{ type: 'text', text: 'No patterns matched the given categories.' }];
      await interceptor.start(rules);
      return [{ type: 'text', text: `Blocking ${rules.length} URL pattern(s) across: ${args.categories.join(', ')}` }];
    },
  };

  // ── 3. inject_error ────────────────────────────────────────────────────────
  const STATUS_TEXTS = {
    400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden',
    404: 'Not Found',   408: 'Request Timeout', 409: 'Conflict',
    422: 'Unprocessable Entity', 429: 'Too Many Requests',
    500: 'Internal Server Error', 502: 'Bad Gateway',
    503: 'Service Unavailable',  504: 'Gateway Timeout',
  };

  const injectError = {
    name: 'inject_error',
    description: 'Force an HTTP error response on matching requests. Ideal for chaos/resilience testing.',
    inputSchema: {
      type: 'object',
      required: ['urlPattern', 'statusCode'],
      properties: {
        urlPattern:  { type: 'string', description: 'URL pattern with optional * wildcards.' },
        statusCode:  { type: 'number', description: 'HTTP error status (400, 401, 403, 404, 429, 500, 503…).' },
        message:     { type: 'string', description: 'Custom error message. Default: HTTP status text.' },
        errorField:  { type: 'string', description: 'JSON field name for the error message. Default: "error".' },
      },
    },
    async handler(args) {
      const msg   = args.message    ?? STATUS_TEXTS[args.statusCode] ?? 'Error';
      const field = args.errorField ?? 'error';
      await interceptor.start([{
        name:         'inject_error',
        urlPattern:   args.urlPattern,
        action:       'mock',
        responseCode: args.statusCode,
        responseBody: { [field]: msg, status: args.statusCode },
        contentType:  'application/json',
      }]);
      return [{ type: 'text', text: `Injecting HTTP ${args.statusCode} on ${args.urlPattern} — ${msg}` }];
    },
  };

  // ── 4. capture_payloads ────────────────────────────────────────────────────
  const capturePayloads = {
    name: 'capture_payloads',
    description: 'Capture request payloads (POST body, headers) for matching URLs without altering them. Call get_intercepted_requests to read captured data.',
    inputSchema: {
      type: 'object',
      required: ['urlPattern'],
      properties: {
        urlPattern: { type: 'string', description: 'URL pattern to capture. Use * as wildcard.' },
      },
    },
    async handler(args) {
      await interceptor.start([{
        name:       'capture_payloads',
        urlPattern: args.urlPattern,
        action:     'pass',
      }]);
      return [{ type: 'text', text: `Capturing payloads for ${args.urlPattern}. Call get_intercepted_requests to read them.` }];
    },
  };

  // ── 5. add_auth_header ─────────────────────────────────────────────────────
  const addAuthHeader = {
    name: 'add_auth_header',
    description: 'Inject an Authorization (or any) header into matching requests in flight. Authenticate without touching code.',
    inputSchema: {
      type: 'object',
      required: ['urlPattern'],
      properties: {
        urlPattern:  { type: 'string', description: 'URL pattern to intercept. Use * for all requests.' },
        token:       { type: 'string', description: 'Bearer token (without "Bearer " prefix). Used when headerValue is omitted.' },
        headerName:  { type: 'string', description: 'Header name. Default: Authorization.' },
        headerValue: { type: 'string', description: 'Full header value. Overrides token.' },
      },
    },
    async handler(args) {
      const name  = args.headerName  ?? 'Authorization';
      const value = args.headerValue ?? `Bearer ${args.token ?? ''}`;
      if (!value.trim()) throw new Error('Provide token or headerValue');

      await interceptor.start([{
        name:       'add_auth_header',
        urlPattern: args.urlPattern,
        action:     'add_headers',
        headers:    [{ name, value }],
      }]);
      const preview = value.length > 40 ? value.slice(0, 40) + '…' : value;
      return [{ type: 'text', text: `Injecting ${name}: ${preview} on ${args.urlPattern}` }];
    },
  };

  // ── 6. redirect_to_local ───────────────────────────────────────────────────
  const redirectToLocal = {
    name: 'redirect_to_local',
    description: 'Redirect API calls from a production domain to a local dev server. Test prod frontend against local backend.',
    inputSchema: {
      type: 'object',
      required: ['prodPattern', 'localPort'],
      properties: {
        prodPattern: { type: 'string', description: 'Production URL pattern. E.g. "https://api.myapp.com/*".' },
        localPort:   { type: 'number', description: 'Local port to redirect to. E.g. 3000.' },
        localHost:   { type: 'string', description: 'Local host. Default: localhost.' },
        basePath:    { type: 'string', description: 'Optional path prefix on the local server. Default: same path as original.' },
      },
    },
    async handler(args) {
      const host        = args.localHost ?? 'localhost';
      const base        = args.basePath  ?? '';
      const redirectUrl = `http://${host}:${args.localPort}${base}/*`;

      await interceptor.start([{
        name:        'redirect_to_local',
        urlPattern:  args.prodPattern,
        action:      'redirect',
        redirectUrl,
      }]);
      return [{ type: 'text', text: `Redirecting ${args.prodPattern} → http://${host}:${args.localPort}${base}` }];
    },
  };

  // ── 7. throttle_api ────────────────────────────────────────────────────────
  const throttleApi = {
    name: 'throttle_api',
    description: 'Add artificial latency to specific API requests. Test loading states, skeleton screens, and timeout handling.',
    inputSchema: {
      type: 'object',
      required: ['urlPattern'],
      properties: {
        urlPattern: { type: 'string', description: 'URL pattern to slow down.' },
        delayMs:    { type: 'number', description: 'Delay in milliseconds. Default: 2000.' },
      },
    },
    async handler(args) {
      const delay = args.delayMs ?? 2000;
      await interceptor.start([{
        name:       'throttle_api',
        urlPattern: args.urlPattern,
        action:     'delay',
        delayMs:    delay,
      }]);
      return [{ type: 'text', text: `Adding ${delay}ms delay on ${args.urlPattern}` }];
    },
  };

  return [mockApi, blockResources, injectError, capturePayloads, addAuthHeader, redirectToLocal, throttleApi];
}

module.exports = { createAdvancedTools };

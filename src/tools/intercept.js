/**
 * Tools de intercepción de requests via CdpInterceptor (servicio inyectado).
 *
 * Tres tools:
 *   setup_request_interception  — activa reglas (mock/block/redirect/delay/pass)
 *   get_intercepted_requests    — lee requests capturadas desde que inició
 *   clear_request_interception  — detiene la intercepción
 */

function createInterceptTools({ interceptor }) {
  const setupRequestInterception = {
    name: 'setup_request_interception',
    description: [
      'Intercept network requests matching URL patterns.',
      'Actions: mock (return synthetic response), block (cancel request),',
      'redirect (rewrite URL), delay (add latency), pass (capture only).',
      'Call clear_request_interception to stop.',
    ].join(' '),
    inputSchema: {
      type: 'object',
      required: ['rules'],
      properties: {
        rules: {
          type: 'array',
          description: 'Ordered list of interception rules. First match wins.',
          items: {
            type: 'object',
            required: ['name', 'urlPattern', 'action'],
            properties: {
              name:       { type: 'string', description: 'Rule identifier for logging.' },
              urlPattern: { type: 'string', description: 'URL pattern with optional * wildcards. E.g. "*/api/users*".' },
              action:     {
                type: 'string',
                enum: ['mock', 'block', 'redirect', 'delay', 'pass'],
                description: 'mock: return synthetic response | block: cancel | redirect: rewrite URL | delay: add latency | pass: capture only.',
              },
              // mock fields
              responseCode:    { type: 'number',  description: '[mock] HTTP status. Default 200.' },
              responseBody:    { description: '[mock] Body (object or string). Default {}.' },
              contentType:     { type: 'string',  description: '[mock] Content-Type. Default application/json.' },
              responseHeaders: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    name:  { type: 'string' },
                    value: { type: 'string' },
                  },
                },
                description: '[mock] Extra response headers.',
              },
              // redirect fields
              redirectUrl: { type: 'string', description: '[redirect] Target URL. Use * to preserve wildcard match.' },
              // delay fields
              delayMs: { type: 'number', description: '[delay] Milliseconds to wait before continuing. Default 1000.' },
            },
          },
        },
      },
    },
    async handler(args) {
      await interceptor.start(args.rules);
      const summary = args.rules.map(r => `${r.name}(${r.action}:${r.urlPattern})`).join(', ');
      return [{ type: 'text', text: `Interception active — ${args.rules.length} rule(s): ${summary}` }];
    },
  };

  const getInterceptedRequests = {
    name: 'get_intercepted_requests',
    description: 'Returns all requests captured since interception was last started.',
    inputSchema: { type: 'object', properties: {} },
    async handler() {
      if (!interceptor.isActive()) {
        return [{ type: 'text', text: 'Interception not active. Call setup_request_interception first.' }];
      }
      const captured = interceptor.getCaptured();
      return [{ type: 'text', text: JSON.stringify(captured, null, 2) }];
    },
  };

  const clearRequestInterception = {
    name: 'clear_request_interception',
    description: 'Stop request interception and remove all active rules.',
    inputSchema: { type: 'object', properties: {} },
    async handler() {
      await interceptor.stop();
      return [{ type: 'text', text: 'Request interception cleared.' }];
    },
  };

  return [setupRequestInterception, getInterceptedRequests, clearRequestInterception];
}

module.exports = { createInterceptTools };

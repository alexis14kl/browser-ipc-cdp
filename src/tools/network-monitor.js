/**
 * Tools de monitoreo pasivo de red via CdpNetworkMonitor (servicio inyectado).
 *
 * Complementa (no duplica) network.js que maneja condiciones/bloqueos/caché.
 * Estos tools OBSERVAN el tráfico sin modificarlo.
 */

function createNetworkMonitorTools({ networkMonitor }) {
  const listNetworkRequests = {
    name: 'list_network_requests',
    description: 'List all captured network requests (passive observation, no interception). Shows URL, method, HTTP status, resource type, size and duration. Auto-starts monitoring if not active.',
    inputSchema: {
      type: 'object',
      properties: {
        method: {
          type: 'string',
          description: 'Filter by HTTP method (GET, POST, PUT, etc.).',
        },
        status: {
          type: 'number',
          description: 'Filter by HTTP status code (e.g. 200, 404, 500).',
        },
        url: {
          type: 'string',
          description: 'Filter by URL substring (case-insensitive).',
        },
        type: {
          type: 'string',
          description: 'Filter by resource type: XHR, Fetch, Document, Script, Stylesheet, Image, Font, Media, WebSocket, Other.',
        },
        failed: {
          type: 'boolean',
          description: 'true = only failed/errored requests.',
        },
        limit: {
          type: 'number',
          description: 'Return last N matching requests.',
        },
      },
    },
    async handler(args) {
      if (!networkMonitor.isActive()) await networkMonitor.start();
      const requests = networkMonitor.getRequests({
        method: args.method,
        status: args.status,
        url:    args.url,
        type:   args.type,
        failed: args.failed,
        limit:  args.limit,
      });

      // summary sin headers/body para mantener output compacto
      const summary = requests.map(r => ({
        requestId: r.requestId,
        method:    r.method,
        url:       r.url,
        type:      r.type,
        status:    r.status,
        mimeType:  r.mimeType,
        size:      r.encodedSize != null ? `${(r.encodedSize / 1024).toFixed(1)}KB` : null,
        duration:  r.durationMs  != null ? `${r.durationMs}ms` : null,
        initiator: r.initiator,
        failed:    r.failed || false,
        errorText: r.errorText || null,
      }));

      const out = summary.length
        ? summary
        : { note: 'No requests captured yet. Navigate or interact with the page.', monitoring: networkMonitor.isActive() };
      return [{ type: 'text', text: JSON.stringify(out, null, 2) }];
    },
  };

  const getNetworkRequest = {
    name: 'get_network_request',
    description: 'Get full details of a specific network request including request/response headers, POST body and response body. Pass a URL substring or the requestId from list_network_requests.',
    inputSchema: {
      type: 'object',
      required: ['urlOrId'],
      properties: {
        urlOrId: {
          type: 'string',
          description: 'URL substring to match (first match returned) or exact requestId.',
        },
      },
    },
    async handler(args) {
      if (!networkMonitor.isActive()) await networkMonitor.start();
      const req = await networkMonitor.getRequest(args.urlOrId);
      if (!req) {
        return [{ type: 'text', text: `No request matching: ${args.urlOrId}` }];
      }
      return [{ type: 'text', text: JSON.stringify(req, null, 2) }];
    },
  };

  return [listNetworkRequests, getNetworkRequest];
}

module.exports = { createNetworkMonitorTools };

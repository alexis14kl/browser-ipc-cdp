/**
 * Tools de red: throttling y bloqueo de URLs via CDP Network domain.
 */

function createNetworkTools({ caller }) {
  const emulateNetwork = {
    name: 'emulate_network',
    description: 'Throttle or simulate network conditions (offline, 3G, etc.) for the current page.',
    inputSchema: {
      type: 'object',
      properties: {
        preset: {
          type: 'string',
          enum: ['offline', '2g', '3g', '4g', 'reset'],
          description: 'Preset condition. Use "reset" to restore normal network.',
        },
        offline:           { type: 'boolean', description: 'Force offline mode (overrides preset).' },
        latency:           { type: 'number',  description: 'Additional latency in ms.' },
        downloadThroughput:{ type: 'number',  description: 'Max download speed in bytes/s. -1 = unlimited.' },
        uploadThroughput:  { type: 'number',  description: 'Max upload speed in bytes/s. -1 = unlimited.' },
      },
    },
    async handler(args) {
      const presets = {
        offline: { offline: true,  latency: 0,   downloadThroughput: 0,       uploadThroughput: 0 },
        '2g':    { offline: false, latency: 300,  downloadThroughput: 6400,    uploadThroughput: 2048 },
        '3g':    { offline: false, latency: 100,  downloadThroughput: 40000,   uploadThroughput: 10000 },
        '4g':    { offline: false, latency: 20,   downloadThroughput: 4000000, uploadThroughput: 3000000 },
        reset:   { offline: false, latency: 0,   downloadThroughput: -1,      uploadThroughput: -1 },
      };

      let params;
      if (args.preset) {
        params = presets[args.preset];
      } else {
        params = {
          offline:            args.offline            ?? false,
          latency:            args.latency            ?? 0,
          downloadThroughput: args.downloadThroughput ?? -1,
          uploadThroughput:   args.uploadThroughput   ?? -1,
        };
      }

      await caller.call('Network.enable', {});
      await caller.call('Network.emulateNetworkConditions', params);

      const desc = args.preset
        ? `preset=${args.preset}`
        : `offline=${params.offline}, latency=${params.latency}ms, dl=${params.downloadThroughput}B/s`;
      return [{ type: 'text', text: `Network conditions set: ${desc}` }];
    },
  };

  const blockUrls = {
    name: 'block_urls',
    description: 'Block requests matching URL patterns. Pass empty array to unblock all.',
    inputSchema: {
      type: 'object',
      required: ['urls'],
      properties: {
        urls: {
          type: 'array',
          items: { type: 'string' },
          description: 'URL patterns to block (supports wildcards). Empty array removes all blocks.',
        },
      },
    },
    async handler(args) {
      await caller.call('Network.enable', {});
      await caller.call('Network.setBlockedURLs', { urls: args.urls });
      const msg = args.urls.length === 0
        ? 'All URL blocks removed'
        : `Blocking ${args.urls.length} pattern(s): ${args.urls.join(', ')}`;
      return [{ type: 'text', text: msg }];
    },
  };

  const clearBrowserCache = {
    name: 'clear_browser_cache',
    description: 'Clear the browser HTTP cache. Useful before performance tests or to force fresh resource loads.',
    inputSchema: { type: 'object', properties: {} },
    async handler() {
      await caller.call('Network.enable', {});
      await caller.call('Network.clearBrowserCache', {});
      return [{ type: 'text', text: 'Browser cache cleared.' }];
    },
  };

  const setExtraHeaders = {
    name: 'set_extra_headers',
    description: 'Add extra HTTP headers to every request made by the page. Pass empty object to clear. Simpler alternative to add_auth_header when you need persistent headers without interception.',
    inputSchema: {
      type: 'object',
      required: ['headers'],
      properties: {
        headers: {
          type: 'object',
          description: 'Key-value pairs of headers to inject. Pass {} to clear all extra headers.',
          additionalProperties: { type: 'string' },
        },
      },
    },
    async handler(args) {
      await caller.call('Network.enable', {});
      await caller.call('Network.setExtraHTTPHeaders', { headers: args.headers });
      const count = Object.keys(args.headers).length;
      const msg = count === 0
        ? 'Extra headers cleared.'
        : `Set ${count} extra header(s): ${Object.keys(args.headers).join(', ')}`;
      return [{ type: 'text', text: msg }];
    },
  };

  return [emulateNetwork, blockUrls, clearBrowserCache, setExtraHeaders];
}

module.exports = { createNetworkTools };

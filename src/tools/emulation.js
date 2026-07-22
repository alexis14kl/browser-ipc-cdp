/**
 * Tools de emulación del entorno del navegador: geolocation, permisos,
 * descargas y certificados via CDP Emulation/Browser/Page/Security domains.
 */

function createEmulationTools({ caller }) {
  const setGeolocation = {
    name: 'set_geolocation',
    description: 'Override geolocation for the current page. Omit params to clear override.',
    inputSchema: {
      type: 'object',
      properties: {
        latitude:  { type: 'number', description: 'Latitude in decimal degrees.' },
        longitude: { type: 'number', description: 'Longitude in decimal degrees.' },
        accuracy:  { type: 'number', description: 'Accuracy in meters (default 1).' },
        clear:     { type: 'boolean', description: 'Set true to remove the geolocation override.' },
      },
    },
    async handler(args) {
      if (args.clear) {
        await caller.call('Emulation.clearGeolocationOverride', {});
        return [{ type: 'text', text: 'Geolocation override cleared' }];
      }
      if (args.latitude == null || args.longitude == null) {
        throw new Error('latitude and longitude are required (or pass clear: true)');
      }
      await caller.call('Emulation.setGeolocationOverride', {
        latitude:  args.latitude,
        longitude: args.longitude,
        accuracy:  args.accuracy ?? 1,
      });
      return [{ type: 'text', text: `Geolocation set to ${args.latitude}, ${args.longitude} (accuracy ${args.accuracy ?? 1}m)` }];
    },
  };

  const grantPermissions = {
    name: 'grant_permissions',
    description: 'Grant or reset browser permissions for an origin (geolocation, camera, microphone, notifications, etc.).',
    inputSchema: {
      type: 'object',
      properties: {
        origin: {
          type: 'string',
          description: 'The origin to grant permissions for, e.g. "https://example.com". Omit to apply to all origins.',
        },
        permissions: {
          type: 'array',
          items: {
            type: 'string',
            enum: ['geolocation', 'camera', 'microphone', 'notifications',
                   'push', 'midi', 'clipboard-read', 'clipboard-write',
                   'payment-handler', 'background-fetch', 'idle-detection'],
          },
          description: 'Permissions to grant. Omit to reset all permissions.',
        },
        reset: { type: 'boolean', description: 'Set true to reset all permissions.' },
      },
    },
    async handler(args) {
      if (args.reset || !args.permissions) {
        await caller.call('Browser.resetPermissions', {});
        return [{ type: 'text', text: 'All permissions reset to default' }];
      }
      const params = { permissions: args.permissions };
      if (args.origin) params.origin = args.origin;
      await caller.call('Browser.grantPermissions', params);
      const target = args.origin ? `origin ${args.origin}` : 'all origins';
      return [{ type: 'text', text: `Granted [${args.permissions.join(', ')}] to ${target}` }];
    },
  };

  const setDownloadPath = {
    name: 'set_download_path',
    description: 'Control file download behavior: allow (with path), deny, or default.',
    inputSchema: {
      type: 'object',
      required: ['behavior'],
      properties: {
        behavior: {
          type: 'string',
          enum: ['allow', 'deny', 'default'],
          description: '"allow" saves to downloadPath, "deny" blocks downloads, "default" uses browser default.',
        },
        downloadPath: {
          type: 'string',
          description: 'Absolute path where files will be saved. Required when behavior is "allow".',
        },
      },
    },
    async handler(args) {
      if (args.behavior === 'allow' && !args.downloadPath) {
        throw new Error('downloadPath is required when behavior is "allow"');
      }
      const params = { behavior: args.behavior };
      if (args.downloadPath) params.downloadPath = args.downloadPath;
      await caller.call('Page.setDownloadBehavior', params);
      const desc = args.behavior === 'allow' ? `allow → ${args.downloadPath}` : args.behavior;
      return [{ type: 'text', text: `Download behavior: ${desc}` }];
    },
  };

  const ignoreCertErrors = {
    name: 'ignore_cert_errors',
    description: 'Ignore or restore HTTPS certificate errors (useful for testing self-signed certs).',
    inputSchema: {
      type: 'object',
      required: ['ignore'],
      properties: {
        ignore: { type: 'boolean', description: 'true to ignore cert errors, false to restore strict checking.' },
      },
    },
    async handler(args) {
      await caller.call('Security.setIgnoreCertificateErrors', { ignore: args.ignore });
      return [{ type: 'text', text: `Certificate error checking: ${args.ignore ? 'disabled' : 'enabled'}` }];
    },
  };

  return [setGeolocation, grantPermissions, setDownloadPath, ignoreCertErrors];
}

module.exports = { createEmulationTools };

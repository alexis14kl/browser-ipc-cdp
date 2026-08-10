/**
 * createCustomTools — agrega todos los tools custom del proyecto.
 *
 * Sigue el patrón factory del repo: recibe dependencias por inyección,
 * no importa nada global. El browserUrl se conoce en runtime (dentro de
 * mcp-controller.run), por eso la factory llega como parámetro al controller.
 */

const { createCdpCaller }           = require('./_cdp-caller');
const { createCookieTools }         = require('./cookies');
const { createPdfTools }            = require('./pdf');
const { createFrameTools }          = require('./frames');
const { createStorageTools }        = require('./storage');
const { createNetworkTools }        = require('./network');
const { createEmulationTools }      = require('./emulation');
const { createAccessibilityTools }  = require('./accessibility');
const { createDomTools }            = require('./dom');
const { createInteractTools }       = require('./interact');
const { createIndexedDbTools }      = require('./indexed-db');
const { createInterceptTools }      = require('./intercept');
const { createAdvancedTools }       = require('./advanced');
const { createCoverageTools }       = require('./coverage');
const { createConsoleTools }        = require('./console');
const { createNetworkMonitorTools } = require('./network-monitor');
const { createSecurityTools }       = require('./security');
const { createCdpInterceptor }      = require('../services/cdp-interceptor');
const { createCdpStealth }          = require('../services/cdp-stealth');
const { createCdpFetch }            = require('../services/cdp-fetch');
const { createCdpCoverage }         = require('../services/cdp-coverage');
const { createCdpConsole }          = require('../services/cdp-console');
const { createCdpNetworkMonitor }   = require('../services/cdp-network-monitor');

/**
 * @param {object} opts
 * @param {string} opts.browserUrl
 * @param {(msg: string) => void} [opts.log]
 * @param {{ add: (name: string, fn: () => any) => void }} [opts.shutdown] - Registro
 *   de limpiezas (services/shutdown). Los servicios con sesión CDP persistente se
 *   apuntan ahí para que morir NO deje el navegador con Fetch habilitado (requests
 *   pausadas que nadie reanuda). Se pasa solo desde el composition root.
 * @returns {Array<{ name, description, inputSchema, handler }>}
 */
function createCustomTools({ browserUrl, log = () => {}, shutdown = null }) {
  const caller          = createCdpCaller({ browserUrl });
  const interceptor     = createCdpInterceptor({ browserUrl, log });
  const coverage        = createCdpCoverage({ browserUrl, log });
  const consoleSvc      = createCdpConsole({ browserUrl, log });
  const networkMonitor  = createCdpNetworkMonitor({ browserUrl, log });
  const stealth         = createCdpStealth({ browserUrl, log });
  const cdpFetch        = createCdpFetch({ browserUrl, log });

  const tools = [
    ...createCookieTools({ caller }),
    ...createPdfTools({ caller }),
    ...createFrameTools({ caller }),
    ...createStorageTools({ caller }),
    ...createNetworkTools({ caller }),
    ...createEmulationTools({ caller }),
    ...createAccessibilityTools({ caller }),
    ...createDomTools({ caller }),
    ...createInteractTools({ caller }),
    ...createIndexedDbTools({ caller }),
    ...createInterceptTools({ interceptor }),
    ...createAdvancedTools({ interceptor }),
    ...createCoverageTools({ coverage }),
    ...createConsoleTools({ console: consoleSvc }),
    ...createNetworkMonitorTools({ networkMonitor }),
    ...createSecurityTools({ caller, stealth, fetch: cdpFetch }),
  ];

  // Limpieza al morir. El guard por isActive() evita ruido en el caso normal
  // (nadie usó estos tools) y hace la limpieza barata: solo se revierte lo que
  // de verdad quedó puesto en el navegador.
  if (shutdown) {
    for (const [name, svc, stop] of [
      ['interceptor',     interceptor,    () => interceptor.stop()],     // Fetch.disable
      ['cdp-fetch',       cdpFetch,       () => cdpFetch.disable()],     // Fetch.disable
      ['stealth',         stealth,        () => stealth.stop()],         // quita el script inyectado
      ['console',         consoleSvc,     () => consoleSvc.stop()],      // cierra la sesión
      ['network-monitor', networkMonitor, () => networkMonitor.stop()],  // cierra la sesión
    ]) {
      shutdown.add(name, () => (svc.isActive() ? stop() : undefined));
    }
  }

  log(`[custom-tools] ${tools.length} tools registrados: ${tools.map(t => t.name).join(', ')}`);
  return tools;
}

module.exports = { createCustomTools };

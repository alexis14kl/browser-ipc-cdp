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
const { createIndexedDbTools }      = require('./indexed-db');
const { createInterceptTools }      = require('./intercept');
const { createAdvancedTools }       = require('./advanced');
const { createCoverageTools }       = require('./coverage');
const { createConsoleTools }        = require('./console');
const { createNetworkMonitorTools } = require('./network-monitor');
const { createSecurityTools }       = require('./security');
const { createCdpInterceptor }      = require('../services/cdp-interceptor');
const { createCdpCoverage }         = require('../services/cdp-coverage');
const { createCdpConsole }          = require('../services/cdp-console');
const { createCdpNetworkMonitor }   = require('../services/cdp-network-monitor');

/**
 * @param {{ browserUrl: string, log?: (msg: string) => void }} opts
 * @returns {Array<{ name, description, inputSchema, handler }>}
 */
function createCustomTools({ browserUrl, log = () => {} }) {
  const caller          = createCdpCaller({ browserUrl });
  const interceptor     = createCdpInterceptor({ browserUrl, log });
  const coverage        = createCdpCoverage({ browserUrl, log });
  const consoleSvc      = createCdpConsole({ browserUrl, log });
  const networkMonitor  = createCdpNetworkMonitor({ browserUrl, log });

  const tools = [
    ...createCookieTools({ caller }),
    ...createPdfTools({ caller }),
    ...createFrameTools({ caller }),
    ...createStorageTools({ caller }),
    ...createNetworkTools({ caller }),
    ...createEmulationTools({ caller }),
    ...createAccessibilityTools({ caller }),
    ...createDomTools({ caller }),
    ...createIndexedDbTools({ caller }),
    ...createInterceptTools({ interceptor }),
    ...createAdvancedTools({ interceptor }),
    ...createCoverageTools({ coverage }),
    ...createConsoleTools({ console: consoleSvc }),
    ...createNetworkMonitorTools({ networkMonitor }),
    ...createSecurityTools({ caller }),
  ];

  log(`[custom-tools] ${tools.length} tools registrados: ${tools.map(t => t.name).join(', ')}`);
  return tools;
}

module.exports = { createCustomTools };

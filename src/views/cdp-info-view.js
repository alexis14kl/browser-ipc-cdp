/**
 * Vista persistida del estado CDP: cdp_info.json.
 *
 * Los clientes externos (skills, scripts) leen este archivo para saber a
 * dónde conectarse. FORMATO CONGELADO (contrato v2.3.x): con proxy, CDP_URL
 * apunta SIEMPRE al puerto fijo del proxy y BACKEND_URL al puerto real.
 */
const fs = require('fs');

function createCdpInfoView({ file, log = () => {} }) {
  function write(port, version, mode, proxyPort) {
    const data = {
      DEBUG_PORT: port,
      DEBUG_WS: version.webSocketDebuggerUrl || '',
      BROWSER: version.Browser || 'Unknown',
      CDP_URL: proxyPort ? `http://127.0.0.1:${proxyPort}` : `http://127.0.0.1:${port}`,
      BACKEND_URL: `http://127.0.0.1:${port}`,
      MODE: mode,
      UPDATED_AT: new Date().toISOString(),
    };
    try { fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8'); } catch (e) {
      log(`Write cdp_info failed: ${e.message}`);
    }
  }

  function read() {
    try { return JSON.parse(fs.readFileSync(file, 'utf-8')); } catch { return null; }
  }

  return { write, read };
}

module.exports = { createCdpInfoView };

/**
 * Vista persistida del estado CDP: cdp_info.json — ÚNICA para CLI y MCP.
 *
 * Los clientes externos (skills, scripts) leen este archivo para saber a
 * dónde conectarse. FORMATO CONGELADO (contrato v2.3.x): con proxy, CDP_URL
 * apunta SIEMPRE al puerto fijo del proxy y BACKEND_URL al puerto real.
 *
 * Ruta canónica: ~/cdp_info.json (la histórica que lee --status). El estado
 * NUNCA vive junto al launcher: en la ruta fija (~/.browser-ipc-cdp/app) el
 * swap de actualización borra el directorio completo — el estado moriría en
 * cada update. El CLI escribe además una copia en cwd (compat legacy) y la
 * lectura elige el archivo MÁS RECIENTE por mtime: así --status siempre ve
 * lo último que escribió el MCP (modo PROXY) o el CLI, gane quien gane.
 */
const fs = require('fs');
const path = require('path');

/** Ruta canónica, calculada al momento (los tests aíslan USERPROFILE). */
function canonicalPath() {
  return path.join(process.env.USERPROFILE || process.env.HOME || '.', 'cdp_info.json');
}

function createCdpInfoView({ file = null, log = () => {} } = {}) {
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
    try { fs.writeFileSync(file || canonicalPath(), JSON.stringify(data, null, 2), 'utf-8'); } catch (e) {
      log(`Write cdp_info failed: ${e.message}`);
    }
  }

  function read() {
    try { return JSON.parse(fs.readFileSync(file || canonicalPath(), 'utf-8')); } catch { return null; }
  }

  return { write, read };
}

/** Escritura del CLI: canónica + copia en cwd (compat legacy). */
function saveCdpInfo(data) {
  const paths = [canonicalPath(), path.join(process.cwd(), 'cdp_info.json')];
  for (const p of paths) {
    try {
      fs.writeFileSync(p, JSON.stringify({ ...data, UPDATED_AT: new Date().toISOString() }, null, 2));
    } catch (e) {}
  }
}

/** Lectura (--status): entre cwd y canónica gana el archivo más reciente. */
function loadCdpInfo() {
  const candidates = [path.join(process.cwd(), 'cdp_info.json'), canonicalPath()];
  let best = null;
  let bestMtime = -1;
  for (const p of candidates) {
    try {
      const mtime = fs.statSync(p).mtimeMs;
      if (mtime > bestMtime) {
        best = JSON.parse(fs.readFileSync(p, 'utf-8'));
        bestMtime = mtime;
      }
    } catch (e) {}
  }
  return best;
}

/** Limpieza (--uninstall): borra el estado persistido conocido. */
function removeCdpInfo() {
  let removed = 0;
  for (const p of [canonicalPath(), path.join(process.cwd(), 'cdp_info.json')]) {
    try { if (fs.existsSync(p)) { fs.rmSync(p); removed++; } } catch (e) {}
  }
  return removed;
}

module.exports = { createCdpInfoView, saveCdpInfo, loadCdpInfo, removeCdpInfo, canonicalPath };

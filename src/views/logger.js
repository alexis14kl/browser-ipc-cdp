/**
 * Logger con destino INYECTABLE — la vista de texto del sistema.
 *
 * Regla de oro: en modo MCP el stdout es EXCLUSIVO del protocolo JSON-RPC;
 * cualquier console.log lo corrompe (fue la causa de que el launcher no
 * pudiera reutilizar lib/ y duplicara todo). Con el destino inyectado el
 * error se vuelve estructural-mente imposible:
 *
 *   MCP:  createLogger({ stream: process.stderr, prefix: '[brave-mcp] ' })
 *   CLI:  createLogger({ stream: process.stdout, prefix: '  ' })
 *   Test: createLogger({ stream: <memoria> })
 *
 * API compatible con lib/logger.js (log/success/warn/error/banner) más el
 * log plano del launcher.
 */
function createLogger({ stream = process.stderr, prefix = '' } = {}) {
  const write = (line) => {
    try { stream.write(`${prefix}${line}\n`); } catch {}
  };
  return {
    log: (msg) => write(msg),
    success: (msg) => write(`[OK] ${msg}`),
    warn: (msg) => write(`[!] ${msg}`),
    error: (msg) => write(`[ERROR] ${msg}`),
    banner: (title = 'browser-ipc-cdp', subtitle = 'Control remoto de navegadores Chromium via IPC + CDP') => {
      write('');
      write(`  ${title}`);
      write(`  ${subtitle}`);
      write('');
    },
  };
}

module.exports = { createLogger };

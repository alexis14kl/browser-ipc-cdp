/**
 * Factory de plataforma: detecta el entorno UNA vez y entrega el
 * PlatformHelper correcto. Único lugar del sistema que mira process.platform.
 */
const fs = require('fs');

function detectWsl() {
  try {
    const v = fs.readFileSync('/proc/version', 'utf-8').toLowerCase();
    if (v.includes('microsoft') || v.includes('wsl')) return true;
  } catch {}
  // Algunos WSL2 no dicen "microsoft" en /proc/version; WSLInterop sí existe.
  try {
    return fs.existsSync('/proc/sys/fs/binfmt_misc/WSLInterop');
  } catch {
    return false;
  }
}

/** @returns {'win32'|'darwin'|'linux'|'wsl'} */
function getPlatformId() {
  if (process.platform === 'win32') return 'win32';
  if (process.platform === 'darwin') return 'darwin';
  return detectWsl() ? 'wsl' : 'linux';
}

/**
 * ¿El consumidor del MCP (Claude Code) corre dentro de WSL y por tanto necesita
 * alcanzar el navegador del host Windows a través del borde WSL↔Windows?
 *
 *   - CLI dentro de WSL      → sí (consumidor WSL).
 *   - CLI en Windows nativo  → no, salvo opt-in explícito
 *     BROWSER_IPC_CDP_TARGET=wsl (caso "npx desde Windows pero Claude Code
 *     vive en WSL").
 *   - Mac / Linux nativo     → no (conexión loopback).
 *
 * Fuente ÚNICA de este criterio: la consumen network.js (firewall/portproxy) y
 * mcp-config.js (resolución de IP del host). No duplicar en otros sitios.
 *
 * @returns {boolean}
 */
function consumerTargetsWsl() {
  if (getPlatformId() === 'wsl') return true;
  if (
    process.platform === 'win32' &&
    String(process.env.BROWSER_IPC_CDP_TARGET || '').toLowerCase() === 'wsl'
  ) {
    return true;
  }
  return false;
}

let cached;

/** @returns {import('./base').PlatformHelper} */
function getPlatformHelper() {
  if (!cached) {
    const id = getPlatformId();
    cached = require(`./${id === 'win32' ? 'win' : id}`);
  }
  return cached;
}

module.exports = { getPlatformId, getPlatformHelper, consumerTargetsWsl };

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

let cached;

/** @returns {import('./base').PlatformHelper} */
function getPlatformHelper() {
  if (!cached) {
    const id = getPlatformId();
    cached = require(`./${id === 'win32' ? 'win' : id}`);
  }
  return cached;
}

module.exports = { getPlatformId, getPlatformHelper };

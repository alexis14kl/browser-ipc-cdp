/**
 * Contrato PlatformHelper — la interfaz que implementa cada plataforma.
 *
 * El resto del sistema (CdpService, controllers) NUNCA consulta
 * process.platform: recibe un helper de estas por inyección desde
 * `platform/index.js` (Factory). Agregar una plataforma = un archivo nuevo
 * que cumpla este contrato.
 *
 * @typedef {object} PlatformHelper
 * @property {'win32'|'darwin'|'linux'|'wsl'} id
 * @property {() => Array<{name: string, path: string}>} userDataDirs
 *   Directorios de perfil Chromium donde buscar DevToolsActivePort,
 *   incluyendo los extra de BROWSER_CDP_EXTRA_PROFILES (leídos al momento
 *   de la llamada, no al cargar el módulo).
 * @property {() => Promise<Array<{label: string, ports: Set<number>}>>} discoverCandidatePorts
 *   Grupos de puertos candidatos sacados de los procesos Chromium vivos, en
 *   orden de prioridad (el consumidor los sondea con testCdp en ese orden).
 */
const path = require('path');

const HOME = process.env.USERPROFILE || process.env.HOME || '';

/**
 * Perfiles comunes a toda plataforma (los custom de skills CDP con
 * --user-data-dir en HOME). Cada plataforma agrega los suyos nativos.
 * Comportamiento heredado 1:1 del launcher v2.3.x.
 */
function commonUserDataDirs() {
  return [
    { name: 'brave-cdp', path: path.join(HOME, 'brave-cdp-profile') },
    { name: 'browser-cdp', path: path.join(HOME, 'browser-cdp-profile') },
    { name: 'chrome-debug', path: path.join(HOME, 'chrome-debug') },
  ];
}

/** Suma los perfiles de BROWSER_CDP_EXTRA_PROFILES ("p1;p2" o "p1:p2" o "p1,p2"). */
function withEnvExtraProfiles(dirs) {
  const extra = process.env.BROWSER_CDP_EXTRA_PROFILES;
  if (!extra) return dirs;
  const out = [...dirs];
  for (const item of extra.split(/[;:,]/)) {
    const trimmed = item.trim();
    if (trimmed) out.push({ name: 'env-extra', path: trimmed });
  }
  return out;
}

module.exports = { HOME, commonUserDataDirs, withEnvExtraProfiles };

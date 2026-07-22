/**
 * WSL: corre en entorno Linux pero el navegador vive en el host Windows.
 * Perfiles: los de Linux (por si hay Chromium nativo en WSL) — el acceso al
 * host Windows (cmd.exe, IP del host, portproxy) lo maneja browser-detect
 * (launchBrowser/discovery traducen rutas /mnt/c → C:\ y usan cmd.exe).
 */
const linux = require('./linux');

module.exports = { ...linux, id: 'wsl' };

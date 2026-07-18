/**
 * WSL: corre en entorno Linux pero el navegador vive en el host Windows.
 * Perfiles: los de Linux (por si hay Chromium nativo en WSL) — el acceso al
 * host Windows (cmd.exe, IP del host, portproxy) llega en la fase del
 * CdpService/auto-launch, que es quien lo consume hoy vía brave_ipc.py.
 */
const linux = require('./linux');

module.exports = { ...linux, id: 'wsl' };

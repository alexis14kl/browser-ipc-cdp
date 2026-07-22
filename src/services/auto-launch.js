/**
 * Auto-launch — último recurso de la cascada de resolución CDP: abre el
 * navegador con --remote-debugging-port en JS puro (sin Python).
 *
 * Reutiliza findBrowser + launchBrowser de browser-detect (la MISMA
 * implementación que usa el instalador CLI), con noKill=true para no cerrar
 * la sesión del usuario: si el navegador ya corre sin CDP, launchBrowser abre
 * una 2da instancia en perfil separado. Tras lanzar, el CdpService re-verifica
 * con tryActivePort.
 *
 * Cooldown: el proxy puede pedir resolución en cada tool call fallida; sin
 * cooldown un navegador que no arranca dispararía lanzamientos en cascada.
 */
const browserDetect = require('./browser-detect');

/**
 * @param {object} [deps]
 * @param {(msg: string) => void} [deps.log]
 * @param {number} [deps.cooldownMs]
 * @param {typeof browserDetect.findBrowser} [deps.findBrowser] - seam de test
 * @param {typeof browserDetect.launchBrowser} [deps.launchBrowser] - seam de test
 */
function createAutoLaunch({
  log = () => {},
  cooldownMs = 30000,
  findBrowser = browserDetect.findBrowser,
  launchBrowser = browserDetect.launchBrowser,
} = {}) {
  let lastLaunchAt = 0;

  return async function autoLaunch() {
    const now = Date.now();
    if (now - lastLaunchAt < cooldownMs) {
      log('Auto-launch en cooldown, skip');
      return;
    }
    lastLaunchAt = now;

    const browser = findBrowser('');
    if (!browser) {
      log('Auto-launch: no se encontró navegador Chromium instalado');
      return;
    }

    log(`Auto-launch: abriendo ${browser.name} con CDP (JS, sin Python)`);
    try {
      const { port } = await launchBrowser(browser, { noKill: true });
      log(`Auto-launch: CDP activo en :${port}`);
    } catch (e) {
      log(`Auto-launch: ${e.message}`);
    }
  };
}

module.exports = { createAutoLaunch };

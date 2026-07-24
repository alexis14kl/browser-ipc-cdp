/**
 * CliController — flujo del instalador `npx browser-ipc-cdp`.
 *
 * Orquesta la detección/lanzamiento del navegador y la configuración de
 * portproxy/firewall/.mcp.json para conectar Claude Code. La lógica vive en
 * services/ (browser-detect/network/mcp-config) y las verificaciones CDP en
 * las estáticas de cdp-service; este controller solo coordina y usa el
 * logger inyectable (a stdout, porque el CLI no habla protocolo por stdout).
 *
 * Comportamiento 1:1 del cli.js v2.3.x. Flags: --list --status --uninstall
 * --browser <b> --port <n> --clean.
 */
const { detectBrowsers, findBrowser, launchBrowser, detectExistingCDP } = require('../services/browser-detect');
const { fetchJson } = require('../services/cdp-service');
const { getPlatformId } = require('../platform');
const { setupPortproxy, setupFirewall } = require('../services/network');
const { updateMcpJson, getWslHostIp, removeBraveConfig } = require('../services/mcp-config');
const { ensureInstalled, uninstall, checkForUpdate, installedVersion } = require('../services/update');
const { saveCdpInfo, loadCdpInfo, removeCdpInfo } = require('../views/cdp-info-view');

const PLATFORM_LABEL = { win32: 'Windows', wsl: 'WSL (Windows host)', darwin: 'macOS', linux: 'Linux' };

function createCliController({ logger }) {
  const { log, success, warn, error, banner } = logger;

  async function run(flags) {
    banner();
    const platformId = getPlatformId();
    const platform = PLATFORM_LABEL[platformId];
    log(`Plataforma: ${platform}`);
    log(`Version:    v${installedVersion() || '?'}`);

    if (flags.list) {
      const browsers = detectBrowsers();
      if (browsers.length === 0) { error('No se encontraron navegadores Chromium instalados.'); process.exit(1); }
      log('Navegadores Chromium detectados:');
      browsers.forEach((b) => log(`  - ${b.name.padEnd(10)} → ${b.exe}`));
      process.exit(0);
    }

    if (flags.status) {
      const info = loadCdpInfo();
      if (info) {
        log(`Puerto CDP: ${info.DEBUG_PORT}`);
        log(`Navegador:  ${info.BROWSER}`);
        log(`Modo:       ${info.MODE || 'LAUNCHED'}`);
        // PAGES solo lo escribe el CLI; el MCP (modo PROXY) no lo reporta.
        if (info.PAGES !== undefined) log(`Paginas:    ${info.PAGES}`);
        if (info.CDP_URL) log(`CDP URL:    ${info.CDP_URL}`);
      } else {
        warn('No hay sesion CDP activa. Ejecuta: npx browser-ipc-cdp');
      }
      process.exit(0);
    }

    if (flags.uninstall) {
      log('Limpiando configuracion...');
      const removed = removeBraveConfig();
      log(`Entradas MCP "brave" eliminadas: ${removed}`);
      if (uninstall()) log('Copia fija ~/.browser-ipc-cdp eliminada.');
      const infoRemoved = removeCdpInfo();
      if (infoRemoved) log(`cdp_info.json eliminado (${infoRemoved} archivos).`);
      success('Desinstalado. Reinicia Claude Code para que deje de listar el MCP.');
      process.exit(0);
    }

    // Chequeo de versión en paralelo con la instalación (best-effort, nunca
    // bloquea ni rompe el flujo); se reporta al final, antes del resumen.
    const updatePromise = checkForUpdate();

    const preferredBrowser = flags.browser || '';
    const forcePort = parseInt(flags.port) || 0;
    const clean = !!flags.clean;

    log('[1/7] Detectando navegador...');
    const browser = findBrowser(preferredBrowser);
    if (!browser) {
      const available = detectBrowsers();
      if (available.length > 0) {
        error(`Navegador '${preferredBrowser}' no encontrado.`);
        log('Disponibles:');
        available.forEach((b) => log(`  - ${b.name}`));
      } else {
        error('No se encontro ningun navegador Chromium.');
        log('Instala Brave, Chrome o Edge.');
      }
      process.exit(1);
    }
    success(`${browser.name} encontrado: ${browser.exe}`);

    log('[2/7] Verificando CDP existente...');
    const existingPort = await detectExistingCDP(browser);
    let port, mode, pid;

    if (existingPort) {
      success(`CDP ya activo en puerto ${existingPort}. Sin reiniciar!`);
      port = existingPort; mode = 'ATTACHED'; pid = 0;
    } else {
      log('[3/7] Lanzando navegador con CDP...');
      const result = await launchBrowser(browser, { port: forcePort, clean });
      port = result.port; mode = 'LAUNCHED'; pid = result.pid;
      success(`CDP activo en puerto ${port}`);
    }

    log('[4/7] Configurando firewall...');
    setupFirewall();

    log('[5/7] Configurando portproxy para WSL...');
    setupPortproxy(port);

    log('[6/7] Instalando copia fija (helper de actualizacion)...');
    const wrapperPath = ensureInstalled({ log, warn });

    log('[7/7] Configurando MCP para Claude Code...');
    const wslIp = getWslHostIp();
    updateMcpJson(port, wslIp, wrapperPath);

    let browserVersion = 'Unknown', wsUrl = '', pages = 0;
    try {
      const versionData = await fetchJson(`http://127.0.0.1:${port}/json/version`, 5000);
      browserVersion = versionData.Browser || 'Unknown';
      wsUrl = versionData.webSocketDebuggerUrl || '';
      const pageList = await fetchJson(`http://127.0.0.1:${port}/json/list`, 5000);
      pages = Array.isArray(pageList) ? pageList.length : 0;
    } catch (e) {}

    saveCdpInfo({
      DEBUG_PORT: port, DEBUG_WS: wsUrl, BROWSER: browserVersion, BROWSER_EXE: browser.exe,
      PID: pid, CDP_URL: `http://127.0.0.1:${port}`, PAGES: pages, MODE: mode, WSL_IP: wslIp,
    });

    const cdpLocalUrl = `http://127.0.0.1:${port}`;
    const cdpWslUrl = `http://${wslIp}:${port}`;
    const cdpUrl = (platformId === 'wsl' || wslIp !== '127.0.0.1') ? cdpWslUrl : cdpLocalUrl;

    const upd = await updatePromise;
    if (upd && upd.outdated) {
      warn(`Nueva version v${upd.latest} disponible (tienes v${upd.current}). Actualiza: npx -y browser-ipc-cdp@latest`);
    }

    log('');
    log('='.repeat(55));
    log(`  MODO:        ${mode}${mode === 'ATTACHED' ? ' (sin reiniciar)' : ' (nuevo proceso)'}`);
    log(`  Plataforma:  ${platform}`);
    log(`  Navegador:   ${browserVersion}`);
    log(`  Puerto CDP:  ${port} (dinamico via IPC)`);
    log(`  Paginas:     ${pages}`);
    log('='.repeat(55));
    log('');
    log('  URLs de conexion:');
    log(`    Desde Windows: ${cdpLocalUrl}`);
    if (wslIp !== '127.0.0.1') log(`    Desde WSL:     ${cdpWslUrl}`);
    log('');
    log('  MCP configurado en .mcp.json:');
    log(`    browserUrl: ${cdpUrl}`);
    log('');
    log('  Siguiente paso en Claude Code:');
    log('    /mcp   (para conectar el MCP brave)');
    log('');
  }

  return { run };
}

module.exports = { createCliController };

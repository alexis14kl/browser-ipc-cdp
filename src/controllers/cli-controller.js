/**
 * CliController — flujo del instalador `npx browser-ipc-cdp`.
 *
 * Orquesta la detección/lanzamiento del navegador y la configuración de
 * portproxy/firewall/.mcp.json para conectar Claude Code. La implementación
 * por plataforma del lado CLI vive en lib/ (browser/network/mcp), que es el
 * instalador estable heredado; este controller solo la coordina y usa el
 * logger inyectable (a stdout, porque el CLI no habla protocolo por stdout).
 *
 * Comportamiento 1:1 del bin/cli.js v2.3.x. Flags: --list --status --uninstall
 * --browser <b> --port <n> --clean.
 */
const http = require('http');

const { detectBrowsers, findBrowser, launchBrowser, detectExistingCDP, IS_WSL, IS_WIN, IS_MAC } = require('../services/browser-detect');
const { setupPortproxy, setupFirewall } = require('../services/network');
const { updateMcpJson, getWslHostIp } = require('../services/mcp-config');
const { saveCdpInfo, loadCdpInfo } = require('../views/cli-cdp-info');

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, { timeout: 5000 }, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

function createCliController({ logger }) {
  const { log, success, warn, error, banner } = logger;

  async function run(flags) {
    banner();
    const platform = IS_WIN ? 'Windows' : IS_WSL ? 'WSL (Windows host)' : IS_MAC ? 'macOS' : 'Linux';
    log(`Plataforma: ${platform}`);

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
        log(`Paginas:    ${info.PAGES}`);
      } else {
        warn('No hay sesion CDP activa. Ejecuta: npx browser-ipc-cdp');
      }
      process.exit(0);
    }

    if (flags.uninstall) {
      log('Limpiando configuracion...');
      success('Desinstalado.');
      process.exit(0);
    }

    const preferredBrowser = flags.browser || '';
    const forcePort = parseInt(flags.port) || 0;
    const clean = !!flags.clean;

    log('[1/6] Detectando navegador...');
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

    log('[2/6] Verificando CDP existente...');
    const existingPort = await detectExistingCDP(browser);
    let port, mode, pid;

    if (existingPort) {
      success(`CDP ya activo en puerto ${existingPort}. Sin reiniciar!`);
      port = existingPort; mode = 'ATTACHED'; pid = 0;
    } else {
      log('[3/6] Lanzando navegador con CDP...');
      const result = await launchBrowser(browser, { port: forcePort, clean });
      port = result.port; mode = 'LAUNCHED'; pid = result.pid;
      success(`CDP activo en puerto ${port}`);
    }

    log('[4/6] Configurando firewall...');
    setupFirewall();

    log('[5/6] Configurando portproxy para WSL...');
    setupPortproxy(port);

    log('[6/6] Configurando MCP para Claude Code...');
    const wslIp = getWslHostIp();
    updateMcpJson(port, wslIp);

    let browserVersion = 'Unknown', wsUrl = '', pages = 0;
    try {
      const versionData = await fetchJson(`http://127.0.0.1:${port}/json/version`);
      browserVersion = versionData.Browser || 'Unknown';
      wsUrl = versionData.webSocketDebuggerUrl || '';
      const pageList = await fetchJson(`http://127.0.0.1:${port}/json/list`);
      pages = Array.isArray(pageList) ? pageList.length : 0;
    } catch (e) {}

    saveCdpInfo({
      DEBUG_PORT: port, DEBUG_WS: wsUrl, BROWSER: browserVersion, BROWSER_EXE: browser.exe,
      PID: pid, CDP_URL: `http://127.0.0.1:${port}`, PAGES: pages, MODE: mode, WSL_IP: wslIp,
    });

    const cdpLocalUrl = `http://127.0.0.1:${port}`;
    const cdpWslUrl = `http://${wslIp}:${port}`;
    const cdpUrl = (IS_WSL || wslIp !== '127.0.0.1') ? cdpWslUrl : cdpLocalUrl;

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

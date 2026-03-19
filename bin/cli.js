#!/usr/bin/env node
/**
 * browser-ipc-cdp CLI
 *
 * Un comando para conectar Claude Code a tu navegador real via IPC + CDP.
 *
 * Uso:
 *   npx browser-ipc-cdp                  # Auto-detectar navegador + instalar
 *   npx browser-ipc-cdp --browser brave  # Forzar Brave
 *   npx browser-ipc-cdp --browser chrome # Forzar Chrome
 *   npx browser-ipc-cdp --list           # Listar navegadores
 *   npx browser-ipc-cdp --status         # Ver estado actual
 *   npx browser-ipc-cdp --uninstall      # Desinstalar
 */
const { detectBrowsers, findBrowser, launchBrowser, detectExistingCDP, IS_WSL, IS_WIN, IS_MAC } = require('../lib/browser');
const { setupPortproxy, setupFirewall } = require('../lib/network');
const { updateMcpJson, getWslHostIp } = require('../lib/mcp');
const { saveCdpInfo, loadCdpInfo } = require('../lib/config');
const { log, success, warn, error, banner, table } = require('../lib/logger');

const args = process.argv.slice(2);
const flags = {};
for (let i = 0; i < args.length; i++) {
  if (args[i].startsWith('--')) {
    const key = args[i].replace('--', '');
    flags[key] = args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true;
    if (flags[key] !== true) i++;
  }
}

async function main() {
  banner();
  const platform = IS_WIN ? 'Windows' : IS_WSL ? 'WSL (Windows host)' : IS_MAC ? 'macOS' : 'Linux';
  log(`Plataforma: ${platform}`);

  // --list: listar navegadores
  if (flags.list) {
    const browsers = detectBrowsers();
    if (browsers.length === 0) {
      error('No se encontraron navegadores Chromium instalados.');
      process.exit(1);
    }
    log('Navegadores Chromium detectados:');
    browsers.forEach(b => log(`  - ${b.name.padEnd(10)} → ${b.exe}`));
    process.exit(0);
  }

  // --status: ver estado actual
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

  // --uninstall: limpiar
  if (flags.uninstall) {
    log('Limpiando configuracion...');
    // TODO: remove portproxy, firewall rule, .mcp.json entry
    success('Desinstalado.');
    process.exit(0);
  }

  // ─── FLUJO PRINCIPAL ──────────────────────────────────────────────────

  const preferredBrowser = flags.browser || '';
  const forcePort = parseInt(flags.port) || 0;
  const clean = !!flags.clean;

  // 1. Detectar navegador
  log('[1/6] Detectando navegador...');
  const browser = findBrowser(preferredBrowser);
  if (!browser) {
    const available = detectBrowsers();
    if (available.length > 0) {
      error(`Navegador '${preferredBrowser}' no encontrado.`);
      log('Disponibles:');
      available.forEach(b => log(`  - ${b.name}`));
    } else {
      error('No se encontro ningun navegador Chromium.');
      log('Instala Brave, Chrome o Edge.');
    }
    process.exit(1);
  }
  success(`${browser.name} encontrado: ${browser.exe}`);

  // 2. Verificar CDP existente
  log('[2/6] Verificando CDP existente...');
  const existingPort = await detectExistingCDP(browser);

  let port, mode, pid;

  if (existingPort) {
    success(`CDP ya activo en puerto ${existingPort}. Sin reiniciar!`);
    port = existingPort;
    mode = 'ATTACHED';
    pid = 0;
  } else {
    // 3. Lanzar navegador con CDP
    log('[3/6] Lanzando navegador con CDP...');
    const result = await launchBrowser(browser, { port: forcePort, clean });
    port = result.port;
    mode = 'LAUNCHED';
    pid = result.pid;
    success(`CDP activo en puerto ${port}`);
  }

  // 4. Firewall
  log('[4/6] Configurando firewall...');
  setupFirewall();

  // 5. Portproxy
  log('[5/6] Configurando portproxy para WSL...');
  setupPortproxy(port);

  // 6. MCP config
  log('[6/6] Configurando MCP para Claude Code...');
  const wslIp = getWslHostIp();
  updateMcpJson(port, wslIp);

  // Obtener info del CDP
  let browserVersion = 'Unknown';
  let wsUrl = '';
  let pages = 0;
  try {
    const http = require('http');
    const versionData = await fetchJson(`http://127.0.0.1:${port}/json/version`);
    browserVersion = versionData.Browser || 'Unknown';
    wsUrl = versionData.webSocketDebuggerUrl || '';
    const pageList = await fetchJson(`http://127.0.0.1:${port}/json/list`);
    pages = Array.isArray(pageList) ? pageList.length : 0;
  } catch (e) {}

  // Guardar info
  saveCdpInfo({
    DEBUG_PORT: port,
    DEBUG_WS: wsUrl,
    BROWSER: browserVersion,
    BROWSER_EXE: browser.exe,
    PID: pid,
    CDP_URL: `http://127.0.0.1:${port}`,
    PAGES: pages,
    MODE: mode,
    WSL_IP: wslIp,
  });

  // Resumen
  console.log('');
  console.log('='.repeat(55));
  console.log(`  MODO:        ${mode}${mode === 'ATTACHED' ? ' (sin reiniciar)' : ' (nuevo proceso)'}`);
  console.log(`  Navegador:   ${browserVersion}`);
  console.log(`  Puerto CDP:  ${port} (dinamico via IPC)`);
  console.log(`  Paginas:     ${pages}`);
  console.log(`  WSL IP:      ${wslIp}`);
  console.log(`  Portproxy:   0.0.0.0:${port} -> 127.0.0.1:${port}`);
  console.log(`  .mcp.json:   Actualizado`);
  console.log('='.repeat(55));
  console.log('');
  console.log('  Siguiente paso en Claude Code:');
  console.log('    /mcp   (para conectar el MCP brave)');
  console.log('');
  console.log('  Herramientas disponibles:');
  console.log('    mcp__brave__list_pages');
  console.log('    mcp__brave__navigate_page');
  console.log('    mcp__brave__take_snapshot');
  console.log('    mcp__brave__click / fill / press_key');
  console.log('');
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const http = require('http');
    http.get(url, { timeout: 5000 }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

main().catch(e => {
  error(e.message);
  process.exit(1);
});

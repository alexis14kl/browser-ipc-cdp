#!/usr/bin/env node
/**
 * Brave MCP Launcher — punto de entrada MCP (stdio) para Claude Code.
 *
 * Resuelve el puerto CDP de Brave/Chrome/Edge y arranca chrome-devtools-mcp
 * detrás de un proxy CDP dinámico en puerto FIJO (default 9333). El proxy
 * (lib/cdp-proxy.js) re-resuelve el puerto real en cada conexión: nunca hay
 * que reiniciar el MCP por cambio de puerto del navegador.
 *
 * Este archivo solo CABLEA dependencias (composition root); la lógica vive en:
 *   src/platform/               detección win/darwin/linux/wsl (Strategy+Factory)
 *   src/services/cdp-service    cascada ActivePort → procesos → auto-launch
 *   src/services/auto-launch    Adapter de brave_ipc.py (cooldown 30s)
 *   src/controllers/mcp-controller  orquestación resolver → proxy → spawn MCP
 *   src/views/                  logger (stderr) y cdp_info.json
 *
 * Env:
 *   BROWSER_CDP_PROXY_PORT     puerto fijo del proxy (default 9333)
 *   BROWSER_CDP_NO_PROXY=1     desactiva el proxy (comportamiento legacy)
 *   BROWSER_CDP_EXTRA_PROFILES User Data dirs extra separados por ; : ,
 *
 * Flags de diagnóstico: --resolve-only | --proxy-only
 */

const path = require('path');
const { startProxy } = require('./src/services/cdp-proxy');
const { getPlatformHelper, getPlatformId } = require('./src/platform');
const { createLogger } = require('./src/views/logger');
const { createCdpInfoView } = require('./src/views/cdp-info-view');
const { createCdpService } = require('./src/services/cdp-service');
const { createAutoLaunch } = require('./src/services/auto-launch');
const { createCursorOverlay } = require('./src/services/cursor-overlay');
const { OVERLAY_SOURCE } = require('./src/views/overlay-script');
const { createMcpController } = require('./src/controllers/mcp-controller');

// MCP stdio: stdout es EXCLUSIVO del JSON-RPC; todo log va a stderr.
const { log } = createLogger({ stream: process.stderr, prefix: '[brave-mcp] ' });

const platformId = getPlatformId();
const cdp = createCdpService({
  platform: getPlatformHelper(),
  log,
  autoLaunch: createAutoLaunch({
    scriptPath: path.join(__dirname, 'brave_ipc.py'),
    platformId,
    log,
  }),
});

// Overlay del cursor: opt-in con BROWSER_CDP_CURSOR=1 (apagado por defecto).
const cursorOverlay = process.env.BROWSER_CDP_CURSOR === '1'
  ? createCursorOverlay({ resolve: () => cdp.resolve(), log, source: OVERLAY_SOURCE })
  : null;

const controller = createMcpController({
  cdp,
  startProxy,
  cdpInfo: createCdpInfoView({ file: path.join(__dirname, 'cdp_info.json'), log }),
  log,
  isWin: platformId === 'win32',
  cursorOverlay,
});

controller.run().catch((e) => { log(`fatal: ${e.message}`); process.exit(1); });

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
 *   src/services/auto-launch    abre el navegador con CDP en JS (cooldown 30s)
 *   src/controllers/mcp-controller  orquestación resolver → proxy → spawn MCP
 *   src/views/                  logger (stderr) y cdp_info.json
 *
 * Env:
 *   BROWSER_CDP_PROXY_PORT     puerto fijo del proxy (default 9333)
 *   BROWSER_CDP_NO_PROXY=1     desactiva el proxy (comportamiento legacy)
 *   BROWSER_CDP_EXTRA_PROFILES User Data dirs extra separados por ; : ,
 *   BROWSER_CDP_CURSOR=0       apaga el overlay del cursor (ON por defecto)
 *
 * Flags de diagnóstico: --resolve-only | --proxy-only
 */

const { startProxy } = require('./src/services/cdp-proxy');
const { getPlatformHelper, getPlatformId } = require('./src/platform');
const { createLogger } = require('./src/views/logger');
const { createCdpInfoView } = require('./src/views/cdp-info-view');
const { createCdpService } = require('./src/services/cdp-service');
const { createAutoLaunch } = require('./src/services/auto-launch');
const { createCursorOverlay } = require('./src/services/cursor-overlay');
const { OVERLAY_SOURCE } = require('./src/views/overlay-script');
const { createMcpController } = require('./src/controllers/mcp-controller');
const { createCustomTools }   = require('./src/tools');
const { MCP_INSTRUCTIONS }    = require('./src/views/mcp-instructions');
const { createShutdown }      = require('./src/services/shutdown');

const { checkForUpdate, installedVersion } = require('./src/services/update');

// Modo bundle = distribución empaquetada (.mcpb de Claude Desktop O plugin de
// Claude Code), donde el paquete/plugin ES la unidad de versión: no aplica el
// flujo npx/auto-update ni su aviso, y SÍ se inyectan las instructions (no hay
// skill). Lo marca BROWSER_IPC_CDP_BUNDLE=1 (manifest del .mcpb o mcp-config.json
// del plugin). El flujo clásico npx/ruta-fija no lo pone → queda idéntico a hoy.
const isBundle = process.env.BROWSER_IPC_CDP_BUNDLE === '1';

// MCP stdio: stdout es EXCLUSIVO del JSON-RPC; todo log va a stderr.
const { log } = createLogger({ stream: process.stderr, prefix: '[brave-mcp] ' });

// Versión corriendo + aviso de update (best-effort, jamás bloquea el
// handshake): la config apunta a la ruta fija del UpdateService, pero si el
// usuario aún no re-corrió el instalador tras publicarse una versión nueva,
// este log es donde la IA (y el humano) se enteran de que corre código viejo.
log(`browser-ipc-cdp v${installedVersion() || '?'}${isBundle ? ' (bundle)' : ''}`);
if (!isBundle) {
  checkForUpdate().then((u) => {
    if (u && u.outdated) {
      log(`UPDATE disponible: v${u.latest} (corriendo v${u.current}). Ejecuta: npx -y browser-ipc-cdp@latest y reconecta con /mcp`);
    }
  }).catch(() => {});
}

const platformId = getPlatformId();
const cdp = createCdpService({
  platform: getPlatformHelper(),
  log,
  autoLaunch: createAutoLaunch({ log }),
});

// Overlay del cursor: ENCENDIDO por defecto (opt-out con BROWSER_CDP_CURSOR=0).
// Así basta con tener la versión instalada — no hay que poner un flag en cada
// config/proyecto. Best-effort y no bloqueante; quien no lo quiera lo apaga.
// Off si el env es '0' o 'false' (el manifest del bundle mapea el toggle
// booleano user_config.cursor_overlay → 'true'/'false'). Unset = ON (default).
const cursorFlag = process.env.BROWSER_CDP_CURSOR;
const cursorOverlay = (cursorFlag !== '0' && cursorFlag !== 'false')
  ? createCursorOverlay({ resolve: () => cdp.resolve(), log, source: OVERLAY_SOURCE })
  : null;

// Limpieza al morir: revierte lo que los tools dejaron puesto en el navegador
// (sobre todo Fetch.enable, que deja requests pausadas colgadas si nadie lo
// deshabilita). Cubre las dos rutas: señal del host MCP e exit del hijo.
const shutdown = createShutdown({
  log,
  on:   (event, handler) => process.on(event, handler),
  exit: (code) => process.exit(code),
});
if (cursorOverlay) shutdown.add('overlay', () => cursorOverlay.close());
shutdown.install();

const controller = createMcpController({
  cdp,
  startProxy,
  // cdp_info.json va a la ruta canónica (~), NUNCA junto al launcher: en la
  // ruta fija el swap de actualización borraría el estado en cada update.
  cdpInfo: createCdpInfoView({ log }),
  log,
  isWin: platformId === 'win32',
  cursorOverlay,
  // Factory de tools custom: recibe browserUrl (conocido en runtime dentro de
  // run()) y devuelve el array de tools a inyectar via McpStdioProxy.
  customToolsFactory: ({ browserUrl }) => createCustomTools({ browserUrl, log, shutdown }),
  // Se ejecuta antes de propagar la salida del hijo chrome-devtools-mcp.
  beforeExit: () => shutdown.run('mcp-exit'),
  // Guía operativa que el proxy anexa al `initialize`. SOLO en modo bundle
  // (.mcpb de Desktop), que no tiene la skill mcp-brave; en Claude Code el
  // flujo queda idéntico al de hoy (la skill sigue siendo la única fuente).
  instructions: isBundle ? MCP_INSTRUCTIONS : '',
});

controller.run().catch((e) => { log(`fatal: ${e.message}`); process.exit(1); });

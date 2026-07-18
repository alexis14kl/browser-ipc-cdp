#!/usr/bin/env node
/**
 * Demo manual del cursor-overlay contra el navegador vivo.
 *   node test-claude/overlay-demo.js
 * Resuelve el backend real (vía CdpService) e instala el overlay en todas las
 * páginas abiertas. NO es parte de la suite automática (necesita navegador).
 */
const path = require('path');
const { getPlatformHelper, getPlatformId } = require('../src/platform');
const { createLogger } = require('../src/views/logger');
const { createCdpService } = require('../src/services/cdp-service');
const { createAutoLaunch } = require('../src/services/auto-launch');
const { createCursorOverlay } = require('../src/services/cursor-overlay');
const { OVERLAY_SOURCE } = require('../src/views/overlay-script');

const { log } = createLogger({ stream: process.stderr, prefix: '[overlay-demo] ' });

const cdp = createCdpService({
  platform: getPlatformHelper(),
  log,
  autoLaunch: createAutoLaunch({ scriptPath: path.join(__dirname, '..', 'brave_ipc.py'), platformId: getPlatformId(), log }),
});

const overlay = createCursorOverlay({ resolve: () => cdp.resolve(), log, source: OVERLAY_SOURCE });

// El registro Page.addScriptToEvaluateOnNewDocument vive mientras la sesión CDP
// siga conectada; start() mantiene la conexión y se auto-reconecta.
const keepaliveSec = parseInt(process.argv[2] || '3', 10);
overlay.start();
log(`overlay arrancado; conexión viva ${keepaliveSec}s (navega para ver que persiste)`);
setTimeout(() => { overlay.close(); process.exit(0); }, keepaliveSec * 1000);

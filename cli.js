#!/usr/bin/env node
/**
 * browser-ipc-cdp CLI — instalador que conecta Claude Code a tu navegador
 * real via IPC + CDP. Entrada delgada: parsea flags y delega en CliController.
 *
 * Uso:
 *   npx browser-ipc-cdp                  # Auto-detectar navegador + instalar
 *   npx browser-ipc-cdp --browser brave  # Forzar Brave
 *   npx browser-ipc-cdp --list           # Listar navegadores
 *   npx browser-ipc-cdp --status         # Ver estado actual
 *   npx browser-ipc-cdp --uninstall      # Desinstalar
 */
const { createLogger } = require('./src/views/logger');
const { createCliController } = require('./src/controllers/cli-controller');

const args = process.argv.slice(2);
const flags = {};
for (let i = 0; i < args.length; i++) {
  if (args[i].startsWith('--')) {
    const key = args[i].replace('--', '');
    flags[key] = args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true;
    if (flags[key] !== true) i++;
  }
}

// El CLI no habla protocolo por stdout: sus mensajes van a stdout (prefijo "  ").
const logger = createLogger({ stream: process.stdout, prefix: '  ' });
const controller = createCliController({ logger });

controller.run(flags).catch((e) => {
  logger.error(e.message);
  process.exit(1);
});

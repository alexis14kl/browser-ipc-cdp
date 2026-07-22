/**
 * Tools de consola del navegador via CdpConsole (servicio inyectado).
 *
 * Nombres distintos a chrome-devtools-mcp (list_console_messages / get_console_message)
 * para evitar conflicto de nombres en el registro de tools.
 *
 * Auto-inicia la captura en el primer uso.
 */

function createConsoleTools({ console: consoleSvc }) {
  const monitorConsole = {
    name: 'monitor_console',
    description: 'List browser console messages captured via persistent CDP session (log, warn, error, info, debug). Distinct from list_console_messages — this uses a live WebSocket session and accumulates across navigations. Auto-starts on first call.',
    inputSchema: {
      type: 'object',
      properties: {
        level: {
          type: 'string',
          enum: ['log', 'warn', 'error', 'info', 'debug', 'verbose'],
          description: 'Filter by console level.',
        },
        text: {
          type: 'string',
          description: 'Filter by text substring (case-insensitive).',
        },
        limit: {
          type: 'number',
          description: 'Return last N messages. Default: all.',
        },
      },
    },
    async handler(args) {
      if (!consoleSvc.isActive()) await consoleSvc.start();
      const messages = consoleSvc.getMessages({
        level: args.level,
        text:  args.text,
        limit: args.limit,
      });
      const out = messages.length
        ? messages
        : { note: 'No messages captured yet. Interact with the page to generate console output.' };
      return [{ type: 'text', text: JSON.stringify(out, null, 2) }];
    },
  };

  const getConsoleEntry = {
    name: 'get_console_entry',
    description: 'Get a specific console message by index from the monitor_console buffer.',
    inputSchema: {
      type: 'object',
      required: ['index'],
      properties: {
        index: {
          type: 'number',
          description: 'Zero-based index from the full captured list.',
        },
      },
    },
    async handler(args) {
      if (!consoleSvc.isActive()) await consoleSvc.start();
      const all = consoleSvc.getMessages({});
      const msg = all[args.index];
      if (!msg) {
        return [{ type: 'text', text: `No message at index ${args.index}. Total captured: ${all.length}` }];
      }
      return [{ type: 'text', text: JSON.stringify(msg, null, 2) }];
    },
  };

  return [monitorConsole, getConsoleEntry];
}

module.exports = { createConsoleTools };

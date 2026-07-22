/**
 * Tools de consola del navegador via CdpConsole (servicio inyectado).
 *
 * Auto-inicia la captura en el primer uso.
 * No duplica nada de network.js ni intercept.js.
 */

function createConsoleTools({ console: consoleSvc }) {
  const listConsoleMessages = {
    name: 'list_console_messages',
    description: 'List browser console messages (log, warn, error, info, debug, verbose). Auto-starts capture if not active. Returns last N messages matching the optional filters.',
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

  const getConsoleMessage = {
    name: 'get_console_message',
    description: 'Get a specific console message by index from the captured list (use list_console_messages first).',
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

  return [listConsoleMessages, getConsoleMessage];
}

module.exports = { createConsoleTools };

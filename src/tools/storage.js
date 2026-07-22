/**
 * Acceso a localStorage y sessionStorage via CDP Runtime.evaluate.
 */

function createStorageTools({ caller }) {
  const getLocalStorage = {
    name: 'get_local_storage',
    description: 'Returns localStorage entries of the current page. Get all or a specific key.',
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Specific key to read. Omit to get all entries.' },
      },
    },
    async handler(args) {
      const expr = args.key
        ? `localStorage.getItem(${JSON.stringify(args.key)})`
        : `JSON.stringify(Object.fromEntries(Object.entries(localStorage)))`;

      const result = await caller.call('Runtime.evaluate', {
        expression:    expr,
        returnByValue: true,
      });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
      const raw = result.result?.value;
      const parsed = (() => { try { return JSON.parse(raw); } catch { return raw; } })();
      return [{ type: 'text', text: JSON.stringify(parsed, null, 2) }];
    },
  };

  const setLocalStorage = {
    name: 'set_local_storage',
    description: 'Sets a localStorage entry on the current page.',
    inputSchema: {
      type: 'object',
      required: ['key', 'value'],
      properties: {
        key:   { type: 'string' },
        value: { type: 'string' },
      },
    },
    async handler(args) {
      await caller.call('Runtime.evaluate', {
        expression:    `localStorage.setItem(${JSON.stringify(args.key)}, ${JSON.stringify(args.value)})`,
        returnByValue: true,
      });
      return [{ type: 'text', text: `localStorage["${args.key}"] = "${args.value}"` }];
    },
  };

  const getSessionStorage = {
    name: 'get_session_storage',
    description: 'Returns sessionStorage entries of the current page. Get all or a specific key.',
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Specific key to read. Omit to get all entries.' },
      },
    },
    async handler(args) {
      const expr = args.key
        ? `sessionStorage.getItem(${JSON.stringify(args.key)})`
        : `JSON.stringify(Object.fromEntries(Object.entries(sessionStorage)))`;

      const result = await caller.call('Runtime.evaluate', {
        expression:    expr,
        returnByValue: true,
      });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
      const raw = result.result?.value;
      const parsed = (() => { try { return JSON.parse(raw); } catch { return raw; } })();
      return [{ type: 'text', text: JSON.stringify(parsed, null, 2) }];
    },
  };

  return [getLocalStorage, setLocalStorage, getSessionStorage];
}

module.exports = { createStorageTools };

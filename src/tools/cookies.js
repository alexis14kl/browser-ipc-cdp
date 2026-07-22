/**
 * Gestión de cookies via CDP Network domain.
 * Tres tools: get_cookies, set_cookie, delete_cookies.
 */

function createCookieTools({ caller }) {
  const getCookies = {
    name: 'get_cookies',
    description: 'Returns cookies for the current page or filtered by URLs.',
    inputSchema: {
      type: 'object',
      properties: {
        urls: {
          type: 'array',
          items: { type: 'string' },
          description: 'Filter by URLs (optional — omit for all page cookies)',
        },
      },
    },
    async handler(args) {
      const params = args.urls?.length ? { urls: args.urls } : {};
      const result = await caller.call('Network.getCookies', params);
      return [{ type: 'text', text: JSON.stringify(result.cookies, null, 2) }];
    },
  };

  const setCookie = {
    name: 'set_cookie',
    description: 'Sets a cookie on the current page.',
    inputSchema: {
      type: 'object',
      required: ['name', 'value', 'url'],
      properties: {
        name:     { type: 'string' },
        value:    { type: 'string' },
        url:      { type: 'string', description: 'URL that the cookie applies to' },
        domain:   { type: 'string' },
        path:     { type: 'string' },
        secure:   { type: 'boolean' },
        httpOnly: { type: 'boolean' },
        sameSite: { type: 'string', enum: ['Strict', 'Lax', 'None'] },
        expires:  { type: 'number', description: 'Unix timestamp (seconds)' },
      },
    },
    async handler(args) {
      await caller.call('Network.setCookie', args);
      return [{ type: 'text', text: `Cookie "${args.name}" establecida.` }];
    },
  };

  const deleteCookies = {
    name: 'delete_cookies',
    description: 'Deletes cookies by name (optionally filtered by url/domain/path).',
    inputSchema: {
      type: 'object',
      required: ['name'],
      properties: {
        name:   { type: 'string' },
        url:    { type: 'string' },
        domain: { type: 'string' },
        path:   { type: 'string' },
      },
    },
    async handler(args) {
      await caller.call('Network.deleteCookies', args);
      return [{ type: 'text', text: `Cookie "${args.name}" eliminada.` }];
    },
  };

  return [getCookies, setCookie, deleteCookies];
}

module.exports = { createCookieTools };

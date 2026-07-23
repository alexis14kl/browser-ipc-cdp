/**
 * MCP server instructions — el texto que el proxy inyecta en la respuesta
 * `initialize` (campo `result.instructions`). Es el canal oficial de MCP para
 * decirle al cliente/modelo CÓMO operar el servidor.
 *
 * En Claude Code esta guía la aporta la skill `mcp-brave` (docs/mcp-brave/
 * SKILL.md); Claude Desktop no carga esa skill, así que destilamos aquí lo
 * operativo para que el bundle (.mcpb) tenga PARIDAD con el CLI. El proxy
 * ANEXA este texto al que ya traiga chrome-devtools-mcp (no lo reemplaza).
 *
 * Mantener en inglés (igual que las descripciones de las tools) y conciso:
 * se inyecta en el contexto del modelo en cada sesión.
 */

const MCP_INSTRUCTIONS = [
  'This server controls the user\'s REAL Chromium browser (Brave / Chrome / Edge) over the Chrome DevTools Protocol, including their real profile (sessions, cookies, extensions).',
  '',
  'Connection: a local proxy on a fixed port (default 127.0.0.1:9333) re-resolves the browser\'s real debugging port on every connection. The port never changes for you — never guess or hardcode ports.',
  '',
  'Auto-launch: if no browser with CDP is running, one is launched on demand. The first tool call after a cold start can take a few seconds; that is expected.',
  '',
  'Workflow:',
  '1. Call take_snapshot first to get the page\'s accessibility tree with fresh uids, then act by uid (click / fill / hover). Re-snapshot after navigation or DOM changes — stale uids fail.',
  '2. When several tabs are open, use list_pages and select_page before acting on a specific tab.',
  '3. Prefer one page/action at a time; verify with a snapshot or screenshot before the next step.',
  '',
  'Do NOT trigger native browser dialogs (alert / confirm / prompt) or other modal dialogs: they block the CDP session and freeze all further tool calls. Use console logging plus list_console_messages instead of alert-based debugging.',
  '',
  'Recovery: if tools start failing with "The selected page has been closed", the chrome-devtools-mcp page handle is stale. Reconnect/restart this MCP server (Claude Code: toggle it with /mcp; Claude Desktop: Settings → Extensions → off then on). The CDP port itself does not need fixing; the proxy re-resolves it automatically.',
  '',
  'A cursor overlay (blue arrow + click ripples) is shown on the page so the user can see what the agent is doing; it can be disabled in the extension settings.',
].join('\n');

module.exports = { MCP_INSTRUCTIONS };

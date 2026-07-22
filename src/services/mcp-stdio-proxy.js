/**
 * McpStdioProxy — intercepta el JSON-RPC entre Claude Code y chrome-devtools-mcp.
 *
 * Flujo:
 *   process.stdin → [proxy] → child.stdin
 *   child.stdout  → [proxy] → process.stdout
 *
 * Reglas:
 *   • tools/list request  → marcar id; delegar al hijo
 *   • tools/list response → inyectar tools custom al array antes de enviar
 *   • tools/call custom   → manejar localmente, NO delegar al hijo
 *   • todo lo demás       → pass-through transparente
 *
 * El formato MCP stdio es JSON newline-delimited (un objeto JSON por línea).
 */

const { createInterface } = require('readline');

function createMcpStdioProxy({ tools, input, output, child, log = () => {} }) {
  // Lookup rápido por nombre
  const toolMap = new Map(tools.map(t => [t.name, t]));
  // IDs de tools/list enviados al hijo pendientes de respuesta
  const pendingListIds = new Set();

  function writeMsg(stream, obj) {
    stream.write(JSON.stringify(obj) + '\n');
  }

  // Lee líneas de un Readable y llama cb(parsedObject) por cada mensaje JSON.
  // Líneas no-JSON (poco probable en MCP, pero defensivo) se descartan.
  function pipeJsonLines(readable, cb) {
    const rl = createInterface({ input: readable, crlfDelay: Infinity });
    rl.on('line', line => {
      const t = line.trim();
      if (!t) return;
      try { cb(JSON.parse(t)); }
      catch { /* línea no-JSON: ignorar silenciosamente */ }
    });
    return rl;
  }

  function start() {
    // ── stdin → child.stdin ────────────────────────────────────────────────
    pipeJsonLines(input, msg => {
      // Interceptar tools/call de tools custom
      if (msg.method === 'tools/call') {
        const tool = toolMap.get(msg.params?.name);
        if (tool) {
          Promise.resolve()
            .then(() => tool.handler(msg.params?.arguments ?? {}))
            .then(content => writeMsg(output, {
              jsonrpc: '2.0',
              id:      msg.id,
              result:  {
                content: Array.isArray(content)
                  ? content
                  : [{ type: 'text', text: String(content) }],
              },
            }))
            .catch(err => {
              log(`[mcp-proxy] error en tool "${msg.params?.name}": ${err.message}`);
              writeMsg(output, {
                jsonrpc: '2.0',
                id:      msg.id,
                error:   { code: -32000, message: err.message },
              });
            });
          return; // NO delegar al hijo
        }
      }

      // Marcar tools/list para inyectar tools custom en la respuesta
      if (msg.method === 'tools/list' && msg.id != null) {
        pendingListIds.add(msg.id);
      }

      // Delegar al hijo
      child.stdin.write(JSON.stringify(msg) + '\n');
    });

    // ── child.stdout → process.stdout ─────────────────────────────────────
    pipeJsonLines(child.stdout, msg => {
      // Inyectar tools custom en tools/list response
      if (
        msg.id != null &&
        pendingListIds.has(msg.id) &&
        Array.isArray(msg.result?.tools)
      ) {
        pendingListIds.delete(msg.id);
        msg.result.tools = [
          ...msg.result.tools,
          ...tools.map(t => ({
            name:        t.name,
            description: t.description,
            inputSchema: t.inputSchema,
          })),
        ];
        log(`[mcp-proxy] tools/list: ${msg.result.tools.length} tools (${tools.length} custom)`);
      }

      writeMsg(output, msg);
    });

    // Propagar exit/error del proceso hijo
    child.on('exit',  code  => process.exit(code ?? 0));
    child.on('error', err   => { log(`[mcp-proxy] spawn error: ${err.message}`); process.exit(1); });
  }

  return { start };
}

module.exports = { createMcpStdioProxy };

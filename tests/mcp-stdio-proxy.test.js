/**
 * McpStdioProxy — inyección de `instructions` en la respuesta `initialize`.
 * Verifica: (1) se anexa cuando se provee, (2) NO pisa las del hijo (concatena,
 * hijo primero), (3) con '' no toca la respuesta. El resto del pass-through ya
 * queda cubierto por el uso real; aquí probamos la lógica nueva.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { PassThrough } = require('node:stream');
const { createMcpStdioProxy } = require('../src/services/mcp-stdio-proxy');

function harness(instructions) {
  const input = new PassThrough();
  const output = new PassThrough();
  const childStdin = new PassThrough();
  const childStdout = new PassThrough();
  const child = { stdin: childStdin, stdout: childStdout, on: () => {} };
  createMcpStdioProxy({ tools: [], input, output, child, instructions }).start();
  return { input, output, childStdin, childStdout };
}

// Resuelve con el primer mensaje JSON (línea) que emita el stream.
function nextMessage(stream) {
  return new Promise((resolve) => {
    let buf = '';
    stream.on('data', (chunk) => {
      buf += chunk.toString();
      const nl = buf.indexOf('\n');
      if (nl !== -1) resolve(JSON.parse(buf.slice(0, nl)));
    });
  });
}

async function roundtrip({ instructions, id, childResult }) {
  const { input, output, childStdin, childStdout } = harness(instructions);
  const forwarded = nextMessage(childStdin);
  input.write(JSON.stringify({ jsonrpc: '2.0', id, method: 'initialize', params: {} }) + '\n');
  await forwarded; // el proxy ya marcó el id como initialize pendiente
  const out = nextMessage(output);
  childStdout.write(JSON.stringify({ jsonrpc: '2.0', id, result: childResult }) + '\n');
  return out;
}

test('initialize: inyecta instructions cuando se proveen', async () => {
  const out = await roundtrip({ instructions: 'MI GUIA', id: 1, childResult: { serverInfo: { name: 'x' } } });
  assert.strictEqual(out.result.instructions, 'MI GUIA');
});

test('initialize: ANEXA a las del hijo (no las pisa; hijo primero)', async () => {
  const out = await roundtrip({ instructions: 'MIA', id: 2, childResult: { instructions: 'DEL HIJO' } });
  assert.match(out.result.instructions, /DEL HIJO/);
  assert.match(out.result.instructions, /MIA/);
  assert.ok(out.result.instructions.indexOf('DEL HIJO') < out.result.instructions.indexOf('MIA'),
    'las del hijo van primero');
});

test("initialize: con instructions='' no se toca la respuesta", async () => {
  const out = await roundtrip({ instructions: '', id: 3, childResult: { foo: 1 } });
  assert.strictEqual(out.result.instructions, undefined);
});

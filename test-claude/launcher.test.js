/**
 * Tests de caja negra del launcher MCP (brave_mcp_launcher.js).
 *
 * Contrato que NO puede romperse en el refactor:
 *  - el handshake MCP (initialize) responde MUY por debajo de los 30s que
 *    espera Claude Code, aunque haya que resolver/lanzar navegador después
 *    (regresión real de v2.3.0)
 *  - --resolve-only imprime JSON con el puerto y sale
 *  - --proxy-only levanta el proxy identificable por el header x-cdp-proxy
 *
 * Los procesos hijos usan SIEMPRE un BROWSER_CDP_PROXY_PORT aleatorio para no
 * interferir con una sesión MCP real en el :9333 de la máquina.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');

const { randomPort, startFakeCdp, httpGet, waitFor, closeServer } = require('./helpers');

const LAUNCHER = path.join(__dirname, '..', 'brave_mcp_launcher.js');
const HANDSHAKE_BUDGET_MS = 15000; // Claude Code corta a los 30s; exigimos la mitad

function spawnLauncher(args, extraEnv = {}) {
  return spawn(process.execPath, [LAUNCHER, ...args], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, BROWSER_CDP_PROXY_PORT: String(randomPort()), ...extraEnv },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

test('handshake MCP: initialize responde dentro del presupuesto', async () => {
  const child = spawnLauncher([]);
  try {
    const started = Date.now();
    const reply = await new Promise((resolve, reject) => {
      let out = '';
      child.stdout.on('data', (d) => {
        out += d.toString('utf-8');
        const line = out.split('\n').find((l) => l.includes('"serverInfo"'));
        if (line) resolve(JSON.parse(line));
      });
      child.on('error', reject);
      child.on('exit', (code) => reject(new Error(`launcher salió antes del handshake (code ${code})`)));
      setTimeout(() => reject(new Error('timeout esperando initialize')), HANDSHAKE_BUDGET_MS);
      child.stdin.write(JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'initialize',
        params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '0' } },
      }) + '\n');
    });
    const elapsed = Date.now() - started;
    assert.ok(reply.result && reply.result.serverInfo, 'respuesta initialize sin serverInfo');
    assert.ok(elapsed < HANDSHAKE_BUDGET_MS, `handshake tardó ${elapsed}ms`);
  } finally {
    child.removeAllListeners('exit');
    try { child.stdin.end(); } catch {}
    try { child.kill('SIGTERM'); } catch {}
  }
});

test('--resolve-only imprime JSON con el puerto resuelto (profile fake vía env)', async () => {
  // Profile falso con DevToolsActivePort apuntando a un CDP fake nuestro
  const backend = await startFakeCdp();
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-test-profile-'));
  fs.writeFileSync(path.join(profileDir, 'DevToolsActivePort'), `${backend.address().port}\n/devtools/browser/fake-id\n`);

  // Integración con spawn real: en runners compartidos bajo carga el proceso
  // puede colgarse ocasionalmente (visto en windows-latest incluso con 40s);
  // 2 intentos — un fallo sistemático tumba ambos.
  async function attempt() {
    const child = spawnLauncher(['--resolve-only'], { BROWSER_CDP_EXTRA_PROFILES: profileDir });
    try {
      return await new Promise((resolve, reject) => {
        let out = '';
        child.stdout.on('data', (d) => (out += d.toString('utf-8')));
        child.on('exit', (code) => resolve({ code, stdout: out }));
        child.on('error', reject);
        setTimeout(() => reject(new Error('timeout --resolve-only')), 40000);
      });
    } finally {
      try { child.kill(); } catch {}
    }
  }

  try {
    // El reintento cubre AMBOS modos de fallo bajo carga: timeout/colgado
    // (excepción) y resolución nula por probe de 1500ms vencido (exit 1).
    let result;
    try { result = await attempt(); } catch { result = null; }
    if (!result || result.code !== 0) result = await attempt();
    const { code, stdout } = result;
    assert.strictEqual(code, 0, `exit code ${code}, stdout: ${stdout}`);
    const json = JSON.parse(stdout.trim().split('\n').pop());
    assert.ok(Number.isInteger(json.port) && json.port > 0, `puerto inválido en ${stdout}`);
    assert.ok(typeof json.browser === 'string' && json.browser.length > 0);
  } finally {
    await closeServer(backend);
    fs.rmSync(profileDir, { recursive: true, force: true });
  }
});

test('--proxy-only levanta el proxy con el header identificador', async () => {
  const proxyPort = randomPort();
  const backend = await startFakeCdp();
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-test-profile-'));
  fs.writeFileSync(path.join(profileDir, 'DevToolsActivePort'), `${backend.address().port}\n/devtools/browser/fake-id\n`);

  const child = spawnLauncher(['--proxy-only'], {
    BROWSER_CDP_PROXY_PORT: String(proxyPort),
    BROWSER_CDP_EXTRA_PROFILES: profileDir,
  });
  try {
    const up = await waitFor(async () => {
      try {
        const res = await httpGet(`http://127.0.0.1:${proxyPort}/json/version`, 800);
        return res.headers['x-cdp-proxy'] === 'browser-ipc-cdp';
      } catch { return false; }
    }, { timeoutMs: 15000 });
    assert.ok(up, 'el proxy-only debía responder con x-cdp-proxy');
  } finally {
    try { child.kill('SIGTERM'); } catch {}
    await closeServer(backend);
    fs.rmSync(profileDir, { recursive: true, force: true });
  }
});

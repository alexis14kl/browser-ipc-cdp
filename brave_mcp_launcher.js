#!/usr/bin/env node
/**
 * Brave MCP Launcher — punto de entrada MCP (stdio) para Claude Code.
 *
 * Resuelve el puerto CDP de Brave/Chrome/Edge y arranca chrome-devtools-mcp
 * detrás de un proxy CDP dinámico en puerto FIJO (default 9333).
 *
 * El proxy (lib/cdp-proxy.js) re-resuelve el puerto real del navegador en cada
 * conexión: si el navegador arranca después del MCP o se reinicia con otro
 * puerto (--remote-debugging-port=0), la siguiente llamada lo encuentra sola.
 * chrome-devtools-mcp apunta siempre a http://127.0.0.1:9333 y no hay que
 * reiniciar el MCP nunca por cambio de puerto.
 *
 * La lógica CDP vive en src/services/cdp-service.js (cascada: DevToolsActivePort
 * → discovery por procesos → auto-launch) sobre src/platform/ (win/darwin/
 * linux/wsl). Este archivo solo orquesta: resolver → proxy → spawn MCP.
 *
 * Env:
 *   BROWSER_CDP_PROXY_PORT     puerto fijo del proxy (default 9333)
 *   BROWSER_CDP_NO_PROXY=1     desactiva el proxy (comportamiento legacy)
 *   BROWSER_CDP_EXTRA_PROFILES User Data dirs extra separados por ; : ,
 *
 * Flags de diagnóstico: --resolve-only | --proxy-only
 *
 * Usa binario global de chrome-devtools-mcp (sin npx cold cache).
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { startProxy } = require('./lib/cdp-proxy');
const { getPlatformHelper, getPlatformId } = require('./src/platform');
const { createLogger } = require('./src/views/logger');
const { createCdpService } = require('./src/services/cdp-service');
const { createAutoLaunch } = require('./src/services/auto-launch');

const HERE = __dirname;
const CDP_INFO = path.join(HERE, 'cdp_info.json');
const BRAVE_IPC_PY = path.join(HERE, 'brave_ipc.py');

// MCP stdio: stdout es EXCLUSIVO del JSON-RPC; todo log va a stderr.
const { log } = createLogger({ stream: process.stderr, prefix: '[brave-mcp] ' });

const platform = getPlatformHelper();
const cdp = createCdpService({
  platform,
  log,
  autoLaunch: createAutoLaunch({ scriptPath: BRAVE_IPC_PY, platformId: getPlatformId(), log }),
});

const IS_WIN = process.platform === 'win32';

function resolveChromeDevtoolsMcpBin() {
  try {
    return require.resolve('chrome-devtools-mcp/build/src/bin/chrome-devtools-mcp.js');
  } catch {}
  const candidates = [
    path.join('C:', 'nvm4w', 'nodejs', 'node_modules', 'chrome-devtools-mcp', 'build', 'src', 'bin', 'chrome-devtools-mcp.js'),
    path.join(process.env.APPDATA || '', 'npm', 'node_modules', 'chrome-devtools-mcp', 'build', 'src', 'bin', 'chrome-devtools-mcp.js'),
    path.join('/usr', 'local', 'lib', 'node_modules', 'chrome-devtools-mcp', 'build', 'src', 'bin', 'chrome-devtools-mcp.js'),
  ];
  for (const p of candidates) { if (p && fs.existsSync(p)) return p; }
  return null;
}
const CHROME_DEVTOOLS_MCP_BIN = resolveChromeDevtoolsMcpBin();

function writeCdpInfo(port, version, mode, proxyPort) {
  const data = {
    DEBUG_PORT: port,
    DEBUG_WS: version.webSocketDebuggerUrl || '',
    BROWSER: version.Browser || 'Unknown',
    // Con proxy, los clientes deben hablar SIEMPRE con el puerto fijo del proxy
    CDP_URL: proxyPort ? `http://127.0.0.1:${proxyPort}` : `http://127.0.0.1:${port}`,
    BACKEND_URL: `http://127.0.0.1:${port}`,
    MODE: mode,
    UPDATED_AT: new Date().toISOString(),
  };
  try { fs.writeFileSync(CDP_INFO, JSON.stringify(data, null, 2), 'utf-8'); } catch (e) {
    log(`Write cdp_info failed: ${e.message}`);
  }
}

function pickRunner() {
  if (CHROME_DEVTOOLS_MCP_BIN && fs.existsSync(CHROME_DEVTOOLS_MCP_BIN)) {
    return { cmd: process.execPath, args: [CHROME_DEVTOOLS_MCP_BIN] };
  }
  log(`chrome-devtools-mcp bin not resolvable. Falling back to npx (slow first run).`);
  return IS_WIN
    ? { cmd: 'cmd.exe', args: ['/c', 'npx', '-y', 'chrome-devtools-mcp@latest'], shell: true }
    : { cmd: 'npx', args: ['-y', 'chrome-devtools-mcp@latest'], shell: true };
}

async function startDynamicProxy(initial) {
  if (process.env.BROWSER_CDP_NO_PROXY === '1') return null;
  try {
    return await startProxy({
      preferredPort: parseInt(process.env.BROWSER_CDP_PROXY_PORT || '9333', 10),
      initialBackend: initial,
      resolveBackend: () => cdp.resolve(), // devuelve {port, version} ya verificado
      onBackendChange: (backend, proxyPort) => writeCdpInfo(backend.port, backend.version, 'PROXY', proxyPort),
      log,
    });
  } catch (e) {
    log(`Proxy no pudo arrancar: ${e.message}. Modo directo (comportamiento legacy).`);
    return null;
  }
}

async function main() {
  // Flags de diagnóstico:
  //   --resolve-only  imprime el puerto CDP resuelto y sale
  //   --proxy-only    levanta solo el proxy (sin chrome-devtools-mcp)
  if (process.argv.includes('--resolve-only')) {
    const resolved = await cdp.resolve();
    console.log(JSON.stringify(resolved ? { port: resolved.port, browser: resolved.version.Browser } : null));
    process.exit(resolved ? 0 : 1);
  }

  // Resolución rápida SIN auto-launch: lanzar un navegador tarda más que el
  // timeout de handshake MCP del cliente (30s en Claude Code), y bloquearía
  // el arranque. Con el proxy, el backend se re-resuelve (auto-launch
  // incluido) on-demand en la primera conexión.
  let resolved = await cdp.resolve({ launch: false });

  const proxy = await startDynamicProxy(resolved);

  // Sin proxy no hay resolución on-demand: el auto-launch bloqueante es la
  // única opción (comportamiento legacy con BROWSER_CDP_NO_PROXY=1).
  if (!proxy && !resolved) resolved = await cdp.resolve();

  const backendDesc = resolved ? `:${resolved.port}` : 'pendiente (se resuelve on-demand)';

  if (process.argv.includes('--proxy-only')) {
    if (!proxy) { log('proxy-only: no se pudo levantar el proxy'); process.exit(1); }
    log(`proxy-only: http://127.0.0.1:${proxy.port} -> backend ${backendDesc}`);
    return; // el server mantiene vivo el proceso
  }

  let browserUrl;
  if (proxy) {
    browserUrl = `http://127.0.0.1:${proxy.port}`;
    log(`CDP proxy fijo en ${browserUrl} -> backend ${backendDesc}`);
  } else if (resolved) {
    writeCdpInfo(resolved.port, resolved.version, 'RESOLVED');
    browserUrl = `http://127.0.0.1:${resolved.port}`;
    log(`CDP ready: ${browserUrl}`);
  } else {
    browserUrl = 'http://127.0.0.1:9222';
    log(`CDP unresolved. MCP will retry against fallback ${browserUrl}.`);
  }

  // Warm-up en background: si no hay backend aún, disparar el auto-launch ya
  // (sin bloquear el handshake) para que la primera tool call no lo pague.
  if (proxy && !resolved) cdp.resolve().catch(() => {});

  const runner = pickRunner();
  const args = [...runner.args, '--browserUrl', browserUrl];
  log(`Spawn: ${runner.cmd} ${args.join(' ')}`);

  const child = spawn(runner.cmd, args, {
    stdio: ['inherit', 'inherit', 'inherit'],
    shell: !!runner.shell,
  });
  child.on('exit', (code) => process.exit(code || 0));
  child.on('error', (e) => { log(`spawn error: ${e.message}`); process.exit(1); });
}

main().catch(e => { log(`fatal: ${e.message}`); process.exit(1); });

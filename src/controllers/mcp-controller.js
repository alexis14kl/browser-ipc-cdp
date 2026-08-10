/**
 * McpController — orquesta el arranque del servidor MCP:
 *   resolver CDP rápido (sin auto-launch) → proxy fijo → warm-up → spawn
 *   de chrome-devtools-mcp apuntando al proxy.
 *
 * Todo llega por inyección (cdp service, startProxy, vista de cdp_info,
 * logger): el controller no toca process.platform ni process.stderr directo.
 * Comportamiento heredado 1:1 del main() del launcher v2.3.x.
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { createMcpStdioProxy } = require('../services/mcp-stdio-proxy');

function createMcpController({ cdp, startProxy, cdpInfo, log, isWin, cursorOverlay = null, customToolsFactory = null, instructions = '', beforeExit = null, env = process.env, argv = process.argv }) {
  function resolveChromeDevtoolsMcpBin() {
    try {
      return require.resolve('chrome-devtools-mcp/build/src/bin/chrome-devtools-mcp.js');
    } catch {}
    const candidates = [
      path.join('C:', 'nvm4w', 'nodejs', 'node_modules', 'chrome-devtools-mcp', 'build', 'src', 'bin', 'chrome-devtools-mcp.js'),
      path.join(env.APPDATA || '', 'npm', 'node_modules', 'chrome-devtools-mcp', 'build', 'src', 'bin', 'chrome-devtools-mcp.js'),
      path.join('/usr', 'local', 'lib', 'node_modules', 'chrome-devtools-mcp', 'build', 'src', 'bin', 'chrome-devtools-mcp.js'),
    ];
    for (const p of candidates) { if (p && fs.existsSync(p)) return p; }
    return null;
  }

  function pickRunner() {
    const bin = resolveChromeDevtoolsMcpBin();
    if (bin && fs.existsSync(bin)) {
      return { cmd: process.execPath, args: [bin] };
    }
    // Versión PINEADA (no @latest): debe coincidir con la dependencia de
    // package.json y con el vendor versionado en node_modules. Evita que el
    // fallback baje una versión mayor incompatible (p. ej. 1.x).
    log(`chrome-devtools-mcp bin not resolvable. Falling back to npx (slow first run).`);
    return isWin
      ? { cmd: 'cmd.exe', args: ['/c', 'npx', '-y', 'chrome-devtools-mcp@1.6.0'], shell: true }
      : { cmd: 'npx', args: ['-y', 'chrome-devtools-mcp@1.6.0'], shell: true };
  }

  async function startDynamicProxy(initial) {
    if (env.BROWSER_CDP_NO_PROXY === '1') return null;
    try {
      return await startProxy({
        preferredPort: parseInt(env.BROWSER_CDP_PROXY_PORT || '9333', 10),
        initialBackend: initial,
        resolveBackend: () => cdp.resolve(), // devuelve {port, version} ya verificado
        onBackendChange: (backend, proxyPort) => cdpInfo.write(backend.port, backend.version, 'PROXY', proxyPort),
        // Los clicks de la IA (Input.dispatchMouseEvent) viajan por el túnel;
        // el proxy los espía (solo-observación) y el overlay los dibuja. El
        // mouse físico del usuario no pasa por aquí → overlay exclusivo de la IA.
        onClientInput: cursorOverlay ? (evt) => { try { cursorOverlay.showAiInput(evt); } catch {} } : undefined,
        // Vínculos sesión↔target que el navegador anuncia al cliente: alimentan
        // el bridge para que showAiInput rutee el overlay a la pestaña correcta.
        onClientAttach: cursorOverlay ? (l) => { try { cursorOverlay.noteClientTarget(l.sessionId, l.targetId); } catch {} } : undefined,
        onClientDetach: cursorOverlay ? (l) => { try { cursorOverlay.dropClientTarget(l.sessionId); } catch {} } : undefined,
        log,
      });
    } catch (e) {
      log(`Proxy no pudo arrancar: ${e.message}. Modo directo (comportamiento legacy).`);
      return null;
    }
  }

  async function run() {
    // Flags de diagnóstico:
    //   --resolve-only  imprime el puerto CDP resuelto y sale
    //   --proxy-only    levanta solo el proxy (sin chrome-devtools-mcp)
    if (argv.includes('--resolve-only')) {
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

    if (argv.includes('--proxy-only')) {
      if (!proxy) { log('proxy-only: no se pudo levantar el proxy'); process.exit(1); }
      log(`proxy-only: http://127.0.0.1:${proxy.port} -> backend ${backendDesc}`);
      return; // el server mantiene vivo el proceso
    }

    let browserUrl;
    if (proxy) {
      browserUrl = `http://127.0.0.1:${proxy.port}`;
      log(`CDP proxy fijo en ${browserUrl} -> backend ${backendDesc}`);
    } else if (resolved) {
      cdpInfo.write(resolved.port, resolved.version, 'RESOLVED');
      browserUrl = `http://127.0.0.1:${resolved.port}`;
      log(`CDP ready: ${browserUrl}`);
    } else {
      browserUrl = 'http://127.0.0.1:9222';
      log(`CDP unresolved. MCP will retry against fallback ${browserUrl}.`);
    }

    // Warm-up en background: si no hay backend aún, disparar el auto-launch ya
    // (sin bloquear el handshake) para que la primera tool call no lo pague.
    if (proxy && !resolved) cdp.resolve().catch(() => {});

    // Overlay del cursor (ON por defecto, opt-out con BROWSER_CDP_CURSOR=0):
    // comparte el ciclo de vida del MCP y se auto-reconecta si Brave cambia de
    // puerto. No bloquea el arranque (best-effort).
    if (cursorOverlay) { try { cursorOverlay.start(); } catch {} }

    const runner = pickRunner();
    const args = [...runner.args, '--browserUrl', browserUrl];
    log(`Spawn: ${runner.cmd} ${args.join(' ')}`);

    // Si hay tools custom, activar modo pipe para que McpStdioProxy
    // pueda interceptar el JSON-RPC. Sin tools, modo inherit (legacy).
    const customTools = customToolsFactory ? customToolsFactory({ browserUrl }) : [];
    const stdioMode = customTools.length > 0 ? ['pipe', 'pipe', 'inherit'] : ['inherit', 'inherit', 'inherit'];

    const child = spawn(runner.cmd, args, {
      stdio: stdioMode,
      shell: !!runner.shell,
    });

    if (customTools.length > 0) {
      const stdioProxy = createMcpStdioProxy({
        tools:  customTools,
        input:  process.stdin,
        output: process.stdout,
        child,
        log,
        instructions,
        beforeExit,
      });
      stdioProxy.start();
    } else {
      // Modo legacy (sin tools custom): misma limpieza antes de salir.
      const exitAfterCleanup = async (code) => {
        if (beforeExit) { try { await beforeExit(); } catch (e) { log(`cleanup: ${e.message}`); } }
        process.exit(code);
      };
      child.on('exit',  (code) => { exitAfterCleanup(code || 0); });
      child.on('error', (e)    => { log(`spawn error: ${e.message}`); exitAfterCleanup(1); });
    }
  }

  return { run };
}

module.exports = { createMcpController };

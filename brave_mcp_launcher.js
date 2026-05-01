/**
 * Brave MCP Dynamic Launcher
 *
 * Resuelve dinamicamente el puerto CDP (Brave/Chrome/Edge) y lanza
 * chrome-devtools-mcp apuntando al puerto correcto. Si CDP no responde,
 * lanza brave_ipc.py automaticamente para iniciar el navegador.
 *
 * Uso en .mcp.json:
 *   {
 *     "mcpServers": {
 *       "brave": {
 *         "command": "node",
 *         "args": ["C:\\Users\\NyGsoft\\Desktop\\ipc\\brave_mcp_launcher.js"]
 *       }
 *     }
 *   }
 *
 * Flujo:
 *   1. Lee cdp_info.json -> puerto candidato
 *   2. Verifica CDP (curl /json/version) en hostIP:puerto
 *   3. Si responde -> lanza chrome-devtools-mcp con ese URL
 *   4. Si NO responde -> ejecuta brave_ipc.py --no-kill (auto-launch)
 *   5. Releer cdp_info.json + reverificar -> conectar
 */
const { execSync, spawn, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');

const CDP_INFO = path.join(__dirname, 'cdp_info.json');
const HOME_CDP_INFO = path.join(process.env.USERPROFILE || process.env.HOME || '.', 'cdp_info.json');
const BRAVE_IPC_PY = path.join(__dirname, 'brave_ipc.py');

const IS_WIN = process.platform === 'win32';
let IS_WSL = false;
try {
  const v = fs.readFileSync('/proc/version', 'utf-8').toLowerCase();
  IS_WSL = v.includes('microsoft') || v.includes('wsl');
} catch (e) {}

function logErr(msg) {
  process.stderr.write(`[brave-mcp] ${msg}\n`);
}

function readCdpInfo() {
  for (const p of [CDP_INFO, HOME_CDP_INFO]) {
    if (fs.existsSync(p)) {
      try { return JSON.parse(fs.readFileSync(p, 'utf-8')); } catch (e) {}
    }
  }
  return null;
}

function getHostIP() {
  if (IS_WIN) return '127.0.0.1';
  try {
    const resolv = fs.readFileSync('/etc/resolv.conf', 'utf-8');
    const match = resolv.match(/nameserver\s+(\d+\.\d+\.\d+\.\d+)/);
    if (match) return match[1];
  } catch (e) {}
  return '127.0.0.1';
}

function testCdp(url, timeoutMs = 3000) {
  return new Promise((resolve) => {
    const req = http.get(`${url}/json/version`, { timeout: timeoutMs }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

async function ensureCdpReady() {
  const hostIP = getHostIP();
  let info = readCdpInfo();
  let port = info && info.DEBUG_PORT;

  // Intento 1: CDP responde con puerto del cdp_info.json
  if (port) {
    const url = `http://${hostIP}:${port}`;
    if (await testCdp(url)) {
      logErr(`CDP activo en ${url}`);
      return url;
    }
    // Intento 2: localhost (caso Windows nativo)
    if (hostIP !== '127.0.0.1') {
      const localUrl = `http://127.0.0.1:${port}`;
      if (await testCdp(localUrl)) {
        logErr(`CDP activo en ${localUrl} (fallback localhost)`);
        return localUrl;
      }
    }
  }

  // Intento 3: auto-launch via brave_ipc.py
  logErr('CDP no responde. Auto-lanzando Brave via brave_ipc.py...');
  if (!fs.existsSync(BRAVE_IPC_PY)) {
    logErr(`brave_ipc.py no encontrado en ${BRAVE_IPC_PY}`);
    return null;
  }

  const pythonCmd = IS_WSL ? 'python3' : 'python';
  const launchCmd = IS_WSL
    ? `cmd.exe /c python "${BRAVE_IPC_PY.replace(/^\/mnt\/([a-z])\//, (_, d) => `${d.toUpperCase()}:\\`).replace(/\//g, '\\\\')}" --no-kill`
    : `${pythonCmd} "${BRAVE_IPC_PY}" --no-kill`;

  try {
    spawnSync(launchCmd, { shell: true, timeout: 60000, stdio: 'pipe' });
  } catch (e) {
    logErr(`Auto-launch fallo: ${e.message}`);
  }

  // Releer y reverificar
  info = readCdpInfo();
  port = info && info.DEBUG_PORT;
  if (port) {
    const url = `http://${hostIP}:${port}`;
    if (await testCdp(url, 5000)) {
      logErr(`CDP activo despues de auto-launch en ${url}`);
      return url;
    }
    const localUrl = `http://127.0.0.1:${port}`;
    if (await testCdp(localUrl, 5000)) {
      logErr(`CDP activo despues de auto-launch en ${localUrl}`);
      return localUrl;
    }
  }

  logErr('CDP sigue sin responder despues de auto-launch.');
  return null;
}

async function main() {
  const browserUrl = await ensureCdpReady();

  if (!browserUrl) {
    logErr('No se pudo establecer CDP. El MCP intentara conectar de todas formas.');
  }

  const finalUrl = browserUrl || `http://127.0.0.1:9222`;
  logErr(`Lanzando chrome-devtools-mcp -> ${finalUrl}`);

  const child = spawn(
    IS_WIN ? 'cmd.exe' : 'npx',
    IS_WIN
      ? ['/c', 'npx', '-y', 'chrome-devtools-mcp@latest', '--browserUrl', finalUrl]
      : ['-y', 'chrome-devtools-mcp@latest', '--browserUrl', finalUrl],
    { stdio: ['inherit', 'inherit', 'inherit'], shell: !IS_WIN }
  );

  child.on('exit', (code) => process.exit(code || 0));
  child.on('error', (e) => {
    logErr(`spawn error: ${e.message}`);
    process.exit(1);
  });
}

main().catch(e => {
  logErr(`fatal: ${e.message}`);
  process.exit(1);
});

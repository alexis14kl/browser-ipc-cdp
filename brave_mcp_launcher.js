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
 *   2. Verifica CDP (/json/version) en hostIP:puerto
 *   3. Si responde -> lanza chrome-devtools-mcp con ese URL
 *   4. Si stale -> auto-discovery via tasklist+netstat de procesos Chromium
 *   5. Si encuentra port vivo -> reescribe cdp_info.json y conecta
 *   6. Ultimo recurso -> brave_ipc.py --no-kill (auto-launch)
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

function getHostCandidates() {
  if (IS_WIN) return ['127.0.0.1'];

  const seen = new Set();
  const candidates = [];
  const add = (ip) => { if (ip && !seen.has(ip)) { seen.add(ip); candidates.push(ip); } };

  // 1. Gateway IP via /proc/net/route — IP real del host Windows en WSL2 NAT
  try {
    const route = fs.readFileSync('/proc/net/route', 'utf-8');
    for (const line of route.split('\n').slice(1)) {
      const parts = line.split(/\s+/);
      if (parts[1] === '00000000' && parts[2] && parts[2] !== '00000000') {
        const hex = parts[2];
        add([
          parseInt(hex.slice(6, 8), 16),
          parseInt(hex.slice(4, 6), 16),
          parseInt(hex.slice(2, 4), 16),
          parseInt(hex.slice(0, 2), 16),
        ].join('.'));
        break;
      }
    }
  } catch (e) {}

  // 2. Localhost (WSL2 mirrored networking mode)
  add('127.0.0.1');

  // 3. Nameservers de /etc/resolv.conf (último recurso)
  try {
    const resolv = fs.readFileSync('/etc/resolv.conf', 'utf-8');
    const re = /nameserver\s+(\d+\.\d+\.\d+\.\d+)/g;
    let m;
    while ((m = re.exec(resolv))) add(m[1]);
  } catch (e) {}

  return candidates;
}

async function tryCandidates(port, candidates, timeoutMs) {
  for (const host of candidates) {
    const url = `http://${host}:${port}`;
    if (await testCdp(url, timeoutMs)) return url;
  }
  return null;
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

/**
 * Descubre el puerto CDP real de cualquier proceso Chromium activo.
 * Usa tasklist (PIDs por imagen) + netstat (LISTENING por PID) y
 * prueba /json/version en cada candidato.
 *
 * Retorna { port, version } si encuentra uno vivo, o null.
 */
async function discoverBrowserCdp() {
  if (!IS_WIN) return null;

  const images = ['brave.exe', 'chrome.exe', 'msedge.exe', 'chromium.exe'];
  const pids = new Set();

  for (const img of images) {
    try {
      const out = execSync(
        `tasklist /FI "IMAGENAME eq ${img}" /FO CSV /NH`,
        { encoding: 'utf-8', timeout: 8000, maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] }
      );
      for (const line of out.split('\n')) {
        const parts = line.trim().split('","');
        if (parts.length >= 2) {
          const pid = parseInt(parts[1].replace(/"/g, ''), 10);
          if (Number.isFinite(pid) && pid > 0) pids.add(pid);
        }
      }
    } catch (e) {}
  }

  if (pids.size === 0) {
    logErr('Auto-discovery: ningun proceso Chromium corriendo');
    return null;
  }

  let netstatOut = '';
  try {
    netstatOut = execSync('netstat -ano', {
      encoding: 'utf-8', timeout: 20000, maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch (e) {
    logErr(`Auto-discovery netstat fallo: ${e.message}`);
    return null;
  }

  const ports = new Set();
  for (const line of netstatOut.split('\n')) {
    const tokens = line.trim().split(/\s+/);
    if (tokens.length < 5 || tokens[0] !== 'TCP' || !tokens[3].includes('LISTENING')) continue;
    const pid = parseInt(tokens[4], 10);
    if (!pids.has(pid)) continue;
    const m = tokens[1].match(/:(\d+)$/);
    if (!m) continue;
    const port = parseInt(m[1], 10);
    if (port > 1024 && port < 65536) ports.add(port);
  }

  logErr(`Auto-discovery: ${ports.size} ports candidatos de ${pids.size} procesos`);

  for (const port of ports) {
    const version = await testCdp(`http://127.0.0.1:${port}`, 1500);
    if (version) {
      logErr(`Auto-discovery: CDP vivo en puerto ${port}`);
      return { port, version };
    }
  }

  return null;
}

function rewriteCdpInfo(port, version) {
  const ws = (version && version.webSocketDebuggerUrl) || '';
  const browser = (version && version.Browser) || 'Unknown';
  const data = {
    DEBUG_PORT: port,
    DEBUG_WS: ws,
    BROWSER: browser,
    CDP_URL: `http://127.0.0.1:${port}`,
    MODE: 'AUTO_DISCOVERED',
  };
  for (const p of [HOME_CDP_INFO, CDP_INFO]) {
    try { fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf-8'); } catch (e) {}
  }
}

async function ensureCdpReady() {
  const candidates = getHostCandidates();
  logErr(`Candidatos host: ${candidates.join(', ')}`);
  let info = readCdpInfo();
  let port = info && info.DEBUG_PORT;

  // Intento 1: probar candidatos con el puerto en cdp_info.json
  if (port) {
    const url = await tryCandidates(port, candidates, 3000);
    if (url) {
      logErr(`CDP activo en ${url}`);
      return url;
    }
    logErr(`Puerto ${port} de cdp_info.json stale. Auto-discovery...`);
  }

  // Intento 2: auto-discovery via tasklist+netstat (no reinicia browser)
  const discovered = await discoverBrowserCdp();
  if (discovered) {
    rewriteCdpInfo(discovered.port, discovered.version);
    const url = await tryCandidates(discovered.port, candidates, 3000);
    if (url) {
      logErr(`CDP descubierto y cdp_info.json actualizado: ${url}`);
      return url;
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

  // Releer y reverificar contra todos los candidatos
  info = readCdpInfo();
  port = info && info.DEBUG_PORT;
  if (port) {
    const url = await tryCandidates(port, candidates, 5000);
    if (url) {
      logErr(`CDP activo despues de auto-launch en ${url}`);
      return url;
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

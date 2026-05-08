/**
 * Brave MCP Launcher (refactored)
 *
 * Resuelve el puerto CDP de Brave/Chrome/Edge y arranca chrome-devtools-mcp.
 *
 * Estrategia (rápida → lenta):
 *   1. Leer DevToolsActivePort de cada User Data dir conocido (instantáneo, autoritativo).
 *   2. Auto-discovery via tasklist + netstat (fallback si no hay archivo o stale).
 *   3. Auto-launch via brave_ipc.py --no-kill (último recurso).
 *
 * Usa binario global de chrome-devtools-mcp (sin npx cold cache).
 */

const { execSync, spawn, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');

const HERE = __dirname;
const CDP_INFO = path.join(HERE, 'cdp_info.json');
const BRAVE_IPC_PY = path.join(HERE, 'brave_ipc.py');

const IS_WIN = process.platform === 'win32';
let IS_WSL = false;
try {
  const v = fs.readFileSync('/proc/version', 'utf-8').toLowerCase();
  IS_WSL = v.includes('microsoft') || v.includes('wsl');
} catch {}

const HOME = process.env.USERPROFILE || process.env.HOME || '';
const LOCALAPPDATA = process.env.LOCALAPPDATA || path.join(HOME, 'AppData', 'Local');

const USER_DATA_DIRS = [
  { name: 'brave',         path: path.join(LOCALAPPDATA, 'BraveSoftware', 'Brave-Browser', 'User Data') },
  { name: 'chrome',        path: path.join(LOCALAPPDATA, 'Google', 'Chrome', 'User Data') },
  { name: 'edge',          path: path.join(LOCALAPPDATA, 'Microsoft', 'Edge', 'User Data') },
  { name: 'chromium',      path: path.join(LOCALAPPDATA, 'Chromium', 'User Data') },
  // Profiles custom usados por skills CDP (--user-data-dir=...)
  { name: 'brave-cdp',     path: path.join(HOME, 'brave-cdp-profile') },
  { name: 'browser-cdp',   path: path.join(HOME, 'browser-cdp-profile') },
  { name: 'chrome-debug',  path: path.join(HOME, 'chrome-debug') },
];

// Permite agregar profiles via env var: BROWSER_CDP_EXTRA_PROFILES="C:/path1;C:/path2"
if (process.env.BROWSER_CDP_EXTRA_PROFILES) {
  for (const extra of process.env.BROWSER_CDP_EXTRA_PROFILES.split(/[;:,]/)) {
    const trimmed = extra.trim();
    if (trimmed) USER_DATA_DIRS.push({ name: 'env-extra', path: trimmed });
  }
}

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

function log(msg) {
  process.stderr.write(`[brave-mcp] ${msg}\n`);
}

function readJsonSafe(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf-8')); } catch { return null; }
}

function testCdp(url, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const req = http.get(`${url}/json/version`, { timeout: timeoutMs }, (res) => {
      if (res.statusCode !== 200) { res.resume(); return resolve(null); }
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json && typeof json.webSocketDebuggerUrl === 'string' && json.webSocketDebuggerUrl) {
            resolve(json);
          } else { resolve(null); }
        } catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

function readDevToolsActivePort(userDataDir) {
  const file = path.join(userDataDir, 'DevToolsActivePort');
  if (!fs.existsSync(file)) return null;
  try {
    const txt = fs.readFileSync(file, 'utf-8');
    const lines = txt.split(/\r?\n/);
    const port = parseInt(lines[0], 10);
    if (Number.isFinite(port) && port > 0) return port;
  } catch {}
  return null;
}

function discoverProfilesDynamically() {
  // Escanea HOME y LOCALAPPDATA buscando dirs con DevToolsActivePort
  const found = [];
  const seen = new Set();

  function addIfHasFile(dirPath, name) {
    if (!dirPath || seen.has(dirPath)) return;
    seen.add(dirPath);
    try {
      if (fs.existsSync(path.join(dirPath, 'DevToolsActivePort'))) {
        found.push({ name, path: dirPath });
      }
    } catch {}
  }

  // 1. Profiles hardcoded conocidos
  for (const ud of USER_DATA_DIRS) addIfHasFile(ud.path, ud.name);

  // 2. Escanear HOME por dirs *-profile, *-cdp*, *-debug
  try {
    for (const entry of fs.readdirSync(HOME, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (/profile|cdp|debug|chromium/i.test(entry.name)) {
        addIfHasFile(path.join(HOME, entry.name), `home/${entry.name}`);
      }
    }
  } catch {}

  // 3. Escanear LOCALAPPDATA niveles 1-2 buscando "User Data"
  try {
    for (const entry of fs.readdirSync(LOCALAPPDATA, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const sub = path.join(LOCALAPPDATA, entry.name);
      addIfHasFile(path.join(sub, 'User Data'), `local/${entry.name}/User Data`);
      try {
        for (const sub2 of fs.readdirSync(sub, { withFileTypes: true })) {
          if (!sub2.isDirectory()) continue;
          addIfHasFile(path.join(sub, sub2.name, 'User Data'), `local/${entry.name}/${sub2.name}/User Data`);
        }
      } catch {}
    }
  } catch {}

  return found;
}

async function tryDevToolsActivePort() {
  const profiles = discoverProfilesDynamically();
  log(`Profiles con DevToolsActivePort: ${profiles.length}`);
  for (const ud of profiles) {
    const port = readDevToolsActivePort(ud.path);
    if (!port) continue;
    const version = await testCdp(`http://127.0.0.1:${port}`, 1500);
    if (version) {
      log(`DevToolsActivePort hit: ${ud.name} -> :${port}`);
      return { port, version };
    } else {
      log(`Stale port :${port} en ${ud.name}`);
    }
  }
  return null;
}

async function discoverViaNetstat() {
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
    } catch {}
  }

  if (pids.size === 0) {
    log('Discovery: no Chromium processes');
    return null;
  }

  let netstatOut;
  try {
    netstatOut = execSync('netstat -ano', {
      encoding: 'utf-8', timeout: 20000, maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch (e) {
    log(`Discovery netstat failed: ${e.message}`);
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

  log(`Discovery: ${ports.size} candidate ports across ${pids.size} processes`);

  for (const port of ports) {
    const version = await testCdp(`http://127.0.0.1:${port}`, 1500);
    if (version) {
      log(`Discovery hit: :${port}`);
      return { port, version };
    }
  }
  return null;
}

function writeCdpInfo(port, version, mode) {
  const data = {
    DEBUG_PORT: port,
    DEBUG_WS: version.webSocketDebuggerUrl || '',
    BROWSER: version.Browser || 'Unknown',
    CDP_URL: `http://127.0.0.1:${port}`,
    MODE: mode,
    UPDATED_AT: new Date().toISOString(),
  };
  try { fs.writeFileSync(CDP_INFO, JSON.stringify(data, null, 2), 'utf-8'); } catch (e) {
    log(`Write cdp_info failed: ${e.message}`);
  }
}

async function autoLaunch() {
  if (!fs.existsSync(BRAVE_IPC_PY)) {
    log(`brave_ipc.py not found at ${BRAVE_IPC_PY}`);
    return null;
  }
  log('Auto-launch via brave_ipc.py --no-kill');
  const cmd = IS_WSL
    ? `cmd.exe /c python "${BRAVE_IPC_PY.replace(/^\/mnt\/([a-z])\//, (_, d) => `${d.toUpperCase()}:\\`).replace(/\//g, '\\\\')}" --no-kill`
    : `python "${BRAVE_IPC_PY}" --no-kill`;
  try {
    spawnSync(cmd, { shell: true, timeout: 60000, stdio: 'pipe' });
  } catch (e) {
    log(`Auto-launch failed: ${e.message}`);
    return null;
  }
  return await tryDevToolsActivePort();
}

async function ensureCdp() {
  let result = await tryDevToolsActivePort();
  if (result) return result;

  log('DevToolsActivePort miss. Falling back to netstat discovery.');
  result = await discoverViaNetstat();
  if (result) return result;

  log('No live CDP found. Auto-launching browser.');
  result = await autoLaunch();
  return result;
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

async function main() {
  const cdp = await ensureCdp();

  let browserUrl;
  if (cdp) {
    writeCdpInfo(cdp.port, cdp.version, 'RESOLVED');
    browserUrl = `http://127.0.0.1:${cdp.port}`;
    log(`CDP ready: ${browserUrl}`);
  } else {
    browserUrl = 'http://127.0.0.1:9222';
    log(`CDP unresolved. MCP will retry against fallback ${browserUrl}.`);
  }

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

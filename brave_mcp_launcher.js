/**
 * Brave MCP Dynamic Launcher
 *
 * Lee el puerto dinámico de cdp_info.json (generado por brave_ipc.py)
 * y lanza chrome-devtools-mcp apuntando a ese puerto.
 *
 * Uso en .mcp.json:
 *   "command": "node",
 *   "args": ["C:\\Users\\NyGsoft\\Desktop\\ipc\\brave_mcp_launcher.js"]
 */
const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const CDP_INFO = path.join(__dirname, 'cdp_info.json');

function getPort() {
  // 1. Leer de cdp_info.json
  if (fs.existsSync(CDP_INFO)) {
    try {
      const data = JSON.parse(fs.readFileSync(CDP_INFO, 'utf-8'));
      if (data.DEBUG_PORT) return data.DEBUG_PORT;
    } catch (e) {}
  }

  // 2. Fallback: buscar DevToolsActivePort
  const dtap = path.join(
    process.env.USERPROFILE || 'C:\\Users\\NyGsoft',
    'brave-cdp-profile',
    'DevToolsActivePort'
  );
  if (fs.existsSync(dtap)) {
    try {
      const lines = fs.readFileSync(dtap, 'utf-8').trim().split('\n');
      if (lines[0]) return parseInt(lines[0].trim());
    } catch (e) {}
  }

  // 3. Fallback: puerto fijo
  return 9222;
}

const port = getPort();

// Detectar IP del host Windows (para WSL usa resolv.conf, para Windows usa localhost)
function getHostIP() {
  try {
    // Si estamos en WSL, leer la IP del host desde resolv.conf
    const resolv = fs.readFileSync('/etc/resolv.conf', 'utf-8');
    const match = resolv.match(/nameserver\s+(\d+\.\d+\.\d+\.\d+)/);
    if (match) return match[1];
  } catch (e) {}
  // Windows nativo o fallback
  return '127.0.0.1';
}

const hostIP = getHostIP();
const browserUrl = `http://${hostIP}:${port}`;

// Verificar que CDP responde antes de lanzar
try {
  execSync(`curl -s --connect-timeout 3 ${browserUrl}/json/version`, { stdio: 'pipe' });
} catch (e) {
  process.stderr.write(`[brave-mcp] CDP no responde en ${browserUrl}. Ejecuta brave_ipc.py primero.\n`);
  // Lanzar de todas formas, el MCP reintentará
}

process.stderr.write(`[brave-mcp] Conectando a Brave CDP en ${browserUrl}\n`);

// Lanzar chrome-devtools-mcp con el puerto dinámico
const child = spawn(
  'npx',
  ['-y', 'chrome-devtools-mcp@latest', '--browserUrl', browserUrl],
  {
    stdio: ['inherit', 'inherit', 'inherit'],
    shell: true,
  }
);

child.on('exit', (code) => process.exit(code || 0));

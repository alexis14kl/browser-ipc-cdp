const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { log, success, warn } = require('./logger');

function getWslHostIp() {
  const IS_WIN = process.platform === 'win32';

  // Mac/Linux nativo (sin WSL): localhost directo
  if (!IS_WIN && !fs.existsSync('/proc/version')) return '127.0.0.1';

  // Windows o WSL: Claude Code SIEMPRE corre en WSL,
  // asi que SIEMPRE necesitamos la IP del host Windows.
  // No importa si el usuario ejecuta npx desde Windows o WSL.

  // 1. Desde WSL: leer resolv.conf directamente
  try {
    if (fs.existsSync('/etc/resolv.conf')) {
      const content = fs.readFileSync('/etc/resolv.conf', 'utf-8');
      const match = content.match(/nameserver\s+(\d+\.\d+\.\d+\.\d+)/);
      if (match) return match[1];
    }
  } catch (e) {}

  // 2. Desde Windows: via wsl.exe
  try {
    const result = execSync('wsl.exe -e grep nameserver /etc/resolv.conf',
      { timeout: 10000, encoding: 'utf-8', stdio: 'pipe' });
    const match = result.match(/nameserver\s+(\d+\.\d+\.\d+\.\d+)/);
    if (match) return match[1];
  } catch (e) {}

  // 3. Via \\wsl$
  const distros = ['Ubuntu', 'Ubuntu-22.04', 'Ubuntu-24.04', 'Debian'];
  for (const distro of distros) {
    const resolvPath = `\\\\wsl$\\${distro}\\etc\\resolv.conf`;
    try {
      if (fs.existsSync(resolvPath)) {
        const content = fs.readFileSync(resolvPath, 'utf-8');
        const match = content.match(/nameserver\s+(\d+\.\d+\.\d+\.\d+)/);
        if (match) return match[1];
      }
    } catch (e) {}
  }

  return '127.0.0.1';
}

function updateMcpJson(port, wslIp) {
  // Estrategia: ejecutar el MCP desde Windows via cmd.exe
  // Asi usa 127.0.0.1 directo, sin portproxy ni firewall
  const braveEntry = {
    command: 'cmd.exe',
    args: ['/c', 'npx', '-y', 'chrome-devtools-mcp@latest', '--browserUrl', `http://127.0.0.1:${port}`],
  };

  // Rutas base donde buscar .mcp.json
  const home = process.env.USERPROFILE || process.env.HOME || '';
  const cwd = process.cwd();
  const scriptDir = path.join(__dirname, '..');

  // 1. Rutas fijas conocidas
  const mcpPaths = new Set([
    path.join(home, '.mcp.json'),           // Home del usuario
    path.join(cwd, '.mcp.json'),            // Donde ejecuto npx
    path.join(scriptDir, '.mcp.json'),      // Carpeta del paquete IPC
  ]);

  // 2. Buscar .mcp.json existentes en subdirectorios del home (1 nivel)
  try {
    const homeItems = fs.readdirSync(home);
    for (const item of homeItems) {
      const candidate = path.join(home, item, '.mcp.json');
      if (fs.existsSync(candidate)) {
        mcpPaths.add(candidate);
      }
    }
  } catch (e) {}

  // 3. En Windows: buscar en Desktop y sus subcarpetas
  const desktop = path.join(home, 'Desktop');
  try {
    if (fs.existsSync(desktop)) {
      const desktopItems = fs.readdirSync(desktop);
      for (const item of desktopItems) {
        const candidate = path.join(desktop, item, '.mcp.json');
        if (fs.existsSync(candidate)) {
          mcpPaths.add(candidate);
        }
      }
    }
  } catch (e) {}

  // 4. Actualizar todos los .mcp.json encontrados
  let updated = 0;
  for (const mcpPath of mcpPaths) {
    try {
      let data = { mcpServers: {} };
      if (fs.existsSync(mcpPath)) {
        data = JSON.parse(fs.readFileSync(mcpPath, 'utf-8'));
      }
      if (!data.mcpServers) data.mcpServers = {};

      // Solo actualizar si el archivo existe o es el home
      const isHome = mcpPath === path.join(home, '.mcp.json');
      if (!fs.existsSync(mcpPath) && !isHome) continue;

      data.mcpServers.brave = braveEntry;
      fs.writeFileSync(mcpPath, JSON.stringify(data, null, 2));
      updated++;
      log(`        -> ${mcpPath}`);
    } catch (e) {}
  }

  success(`.mcp.json actualizado (${updated} archivos): brave -> ${wslIp}:${port}`);
  return updated > 0;
}

module.exports = { getWslHostIp, updateMcpJson };

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { log, success, warn } = require('./logger');

function getWslHostIp() {
  const IS_WIN = process.platform === 'win32';

  // Mac/Linux: localhost funciona directo, no necesita IP especial
  if (!IS_WIN) return '127.0.0.1';

  // Windows: detectar IP para WSL

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
  const braveEntry = {
    command: 'npx',
    args: ['-y', 'chrome-devtools-mcp@latest', '--browserUrl', `http://${wslIp}:${port}`],
  };

  // Actualizar .mcp.json en home y directorio actual
  const mcpPaths = [
    path.join(process.env.USERPROFILE || process.env.HOME || '', '.mcp.json'),
    path.join(process.cwd(), '.mcp.json'),
  ];

  let updated = 0;
  for (const mcpPath of mcpPaths) {
    try {
      let data = { mcpServers: {} };
      if (fs.existsSync(mcpPath)) {
        data = JSON.parse(fs.readFileSync(mcpPath, 'utf-8'));
      }
      if (!data.mcpServers) data.mcpServers = {};
      data.mcpServers.brave = braveEntry;
      fs.writeFileSync(mcpPath, JSON.stringify(data, null, 2));
      updated++;
    } catch (e) {}
  }

  success(`.mcp.json actualizado (${updated} archivos): brave -> ${wslIp}:${port}`);
  return updated > 0;
}

module.exports = { getWslHostIp, updateMcpJson };

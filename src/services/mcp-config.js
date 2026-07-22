const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { log, success, warn } = require('../views/logger');
const { consumerTargetsWsl } = require('../platform');

function getWslHostIp() {
  // Consumidor nativo (Mac, Linux o Windows nativo sin opt-in): loopback directo.
  // Evita lanzar wsl.exe en Windows nativo, que abría una consola ajena y podía
  // colgar hasta 10s. Mismo criterio que needsForwarding() en network.js.
  if (!consumerTargetsWsl()) return '127.0.0.1';

  // Consumidor en WSL (o Windows + BROWSER_IPC_CDP_TARGET=wsl): buscar la IP del
  // host Windows alcanzable desde la VM.

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

/** Rutas candidatas de .claude.json: home(s) y /mnt/c/Users/* desde WSL. */
function claudeJsonCandidates() {
  const candidates = new Set();
  if (process.env.HOME) candidates.add(path.join(process.env.HOME, '.claude.json'));
  if (process.env.USERPROFILE) candidates.add(path.join(process.env.USERPROFILE, '.claude.json'));
  try {
    if (fs.existsSync('/mnt/c/Users')) {
      for (const user of fs.readdirSync('/mnt/c/Users')) {
        const candidate = `/mnt/c/Users/${user}/.claude.json`;
        if (fs.existsSync(candidate)) candidates.add(candidate);
      }
    }
  } catch (e) {}
  return candidates;
}

/**
 * Rutas candidatas de .mcp.json: home, cwd, carpeta del paquete, y los
 * .mcp.json ya existentes en subdirectorios del home y del Desktop (1 nivel).
 */
function mcpJsonCandidates() {
  const home = process.env.USERPROFILE || process.env.HOME || '';
  const mcpPaths = new Set([
    path.join(home, '.mcp.json'),
    path.join(process.cwd(), '.mcp.json'),
    path.join(__dirname, '..', '..', '.mcp.json'),
  ]);
  try {
    for (const item of fs.readdirSync(home)) {
      const candidate = path.join(home, item, '.mcp.json');
      if (fs.existsSync(candidate)) mcpPaths.add(candidate);
    }
  } catch (e) {}
  const desktop = path.join(home, 'Desktop');
  try {
    if (fs.existsSync(desktop)) {
      for (const item of fs.readdirSync(desktop)) {
        const candidate = path.join(desktop, item, '.mcp.json');
        if (fs.existsSync(candidate)) mcpPaths.add(candidate);
      }
    }
  } catch (e) {}
  return mcpPaths;
}

function updateClaudeUserConfig(wrapperPath) {
  // Registra el MCP "brave" en scope user (~/.claude.json top-level mcpServers)
  // para que aparezca en /mcp desde cualquier directorio, sin depender del cwd.
  const braveEntry = {
    type: 'stdio',
    command: 'node',
    args: [wrapperPath],
    env: {},
  };

  const candidates = claudeJsonCandidates();

  let updated = 0;
  for (const p of candidates) {
    try {
      // Solo modificar si Claude Code ya creo el archivo.
      // No bootstrap-eamos .claude.json para no chocar con first-run setup.
      if (!fs.existsSync(p)) continue;
      const data = JSON.parse(fs.readFileSync(p, 'utf-8'));
      if (!data.mcpServers) data.mcpServers = {};
      data.mcpServers.brave = braveEntry;

      // Write atomico: tmp + rename (evita corromper si Claude Code lee a medias)
      const tmp = p + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
      fs.renameSync(tmp, p);
      updated++;
      log(`        -> ${p} (user scope)`);
    } catch (e) {
      warn(`No se pudo actualizar ${p}: ${e.message}`);
    }
  }
  return updated;
}

function updateMcpJson(port, wslIp, wrapperPath = path.join(__dirname, '..', '..', 'brave_mcp_launcher.js')) {
  // Estrategia: apuntar al wrapper Node dinamico.
  // El wrapper lee cdp_info.json en cada invocacion -> puerto siempre fresco.
  // wrapperPath viene del UpdateService (ruta fija ~/.browser-ipc-cdp/app en
  // instalaciones npx, el repo en modo dev): asi la config nunca queda
  // apuntando a una copia vieja del cache de npx.
  const braveEntry = {
    command: 'node',
    args: [wrapperPath],
  };

  const home = process.env.USERPROFILE || process.env.HOME || '';
  const mcpPaths = mcpJsonCandidates();

  // Actualizar todos los .mcp.json encontrados
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

  // Tambien registrar en scope user (~/.claude.json) para que /mcp lo vea desde cualquier cwd
  const userUpdated = updateClaudeUserConfig(wrapperPath);
  if (userUpdated > 0) {
    success(`.claude.json actualizado (${userUpdated} archivos, scope user): brave registrado`);
  } else {
    warn('No se encontro .claude.json para registrar en scope user. Reinicia Claude Code una vez para que se cree, luego re-ejecuta este comando.');
  }

  return (updated + userUpdated) > 0;
}

/**
 * Quita la entrada mcpServers.brave de los archivos dados, preservando el
 * resto del contenido (write atomico tmp+rename). Núcleo con rutas explícitas
 * para poder testearlo sin tocar las configs reales de la máquina.
 */
function removeBraveEntry(paths) {
  let removed = 0;
  for (const p of paths) {
    try {
      if (!fs.existsSync(p)) continue;
      const data = JSON.parse(fs.readFileSync(p, 'utf-8'));
      if (!data.mcpServers || !data.mcpServers.brave) continue;
      delete data.mcpServers.brave;
      const tmp = p + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
      fs.renameSync(tmp, p);
      removed++;
      log(`        -> ${p} (brave eliminado)`);
    } catch (e) {}
  }
  return removed;
}

/** Desinstalación: quita brave de todos los .mcp.json/.claude.json conocidos. */
function removeBraveConfig() {
  return removeBraveEntry([...mcpJsonCandidates(), ...claudeJsonCandidates()]);
}

module.exports = { getWslHostIp, updateMcpJson, updateClaudeUserConfig, removeBraveEntry, removeBraveConfig };

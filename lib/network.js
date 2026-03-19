const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { log, success, warn } = require('./logger');

const IS_WIN = process.platform === 'win32';
let IS_WSL = false;
try {
  const v = fs.readFileSync('/proc/version', 'utf-8').toLowerCase();
  IS_WSL = v.includes('microsoft') || v.includes('wsl');
} catch (e) {}

const FIREWALL_RULE = 'CDP All Ports (IPC)';

/**
 * Ejecuta netsh con permisos elevados usando Python ctypes.
 * Python puede usar ctypes.windll.shell32.ShellExecuteW para elevar sin .bat
 * O si ya tiene permisos, ejecuta directo.
 */
function runNetshElevated(netshCommand) {
  // Python script inline que ejecuta como admin sin UAC visible
  const pyScript = `
import subprocess, sys, os
cmd = r'${netshCommand}'
try:
    r = subprocess.run(cmd, shell=True, capture_output=True, timeout=10)
    if r.returncode == 0:
        sys.exit(0)
except:
    pass
# Si fallo, intentar con ctypes (elevation silenciosa)
try:
    import ctypes
    if not ctypes.windll.shell32.IsUserAnAdmin():
        ctypes.windll.shell32.ShellExecuteW(None, "runas", "cmd.exe", f"/c {cmd}", None, 0)
        import time; time.sleep(3)
        sys.exit(0)
except:
    pass
sys.exit(1)
`.trim();

  try {
    const pythonCmd = IS_WSL ? 'python3' : 'python';
    execSync(`${pythonCmd} -c "${pyScript.replace(/"/g, '\\"').replace(/\n/g, ';')}"`,
      { timeout: 15000, stdio: 'pipe' });
    return true;
  } catch (e) {}

  // Fallback: powershell directo
  try {
    const ps = IS_WSL ? 'powershell.exe' : 'powershell';
    execSync(`${ps} -Command "Start-Process cmd -ArgumentList '/c ${netshCommand}' -Verb RunAs -Wait -WindowStyle Hidden"`,
      { timeout: 30000, stdio: 'pipe' });
    return true;
  } catch (e) {}

  return false;
}

function setupFirewall() {
  if (!IS_WIN && !IS_WSL) return true;

  // Verificar si ya existe
  try {
    const cmd = IS_WSL
      ? `cmd.exe /c netsh advfirewall firewall show rule name="${FIREWALL_RULE}"`
      : `netsh advfirewall firewall show rule name="${FIREWALL_RULE}"`;
    const check = execSync(cmd, { timeout: 10000, encoding: 'utf-8', stdio: 'pipe' });
    if (check.includes(FIREWALL_RULE)) return true;
  } catch (e) {}

  const fwCmd = `netsh advfirewall firewall add rule name="${FIREWALL_RULE}" dir=in action=allow protocol=TCP localport=1024-65535`;

  // Intento 1: directo
  try {
    const cmd = IS_WSL ? `cmd.exe /c ${fwCmd}` : fwCmd;
    execSync(cmd, { timeout: 10000, stdio: 'pipe' });
    success('Firewall: regla creada');
    return true;
  } catch (e) {}

  // Intento 2: elevado
  if (runNetshElevated(fwCmd)) {
    success('Firewall: regla creada (elevado)');
    return true;
  }

  warn('Firewall: no se pudo crear regla');
  return false;
}

function setupPortproxy(port) {
  if (!IS_WIN && !IS_WSL) return true;

  // Verificar si ya existe
  try {
    const cmd = IS_WSL
      ? 'cmd.exe /c netsh interface portproxy show all'
      : 'netsh interface portproxy show all';
    const check = execSync(cmd, { timeout: 10000, encoding: 'utf-8', stdio: 'pipe' });
    if (check.includes(`0.0.0.0         ${port}`)) {
      log(`        Portproxy ya existe para puerto ${port}`);
      return true;
    }
  } catch (e) {}

  const proxyCmd = `netsh interface portproxy add v4tov4 listenaddress=0.0.0.0 listenport=${port} connectaddress=127.0.0.1 connectport=${port}`;

  // Intento 1: directo
  try {
    const cmd = IS_WSL ? `cmd.exe /c ${proxyCmd}` : proxyCmd;
    execSync(cmd, { timeout: 10000, stdio: 'pipe' });
    success(`Portproxy: 0.0.0.0:${port} -> 127.0.0.1:${port}`);
    return true;
  } catch (e) {}

  // Intento 2: elevado
  if (runNetshElevated(proxyCmd)) {
    success(`Portproxy: 0.0.0.0:${port} -> 127.0.0.1:${port} (elevado)`);
    return true;
  }

  warn(`Portproxy: fallo para puerto ${port}`);
  return false;
}

module.exports = { setupFirewall, setupPortproxy };

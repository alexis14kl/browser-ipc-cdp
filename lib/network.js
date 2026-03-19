const { execSync } = require('child_process');
const { log, success, warn } = require('./logger');

const IS_WIN = process.platform === 'win32';
let IS_WSL = false;
try { const { IS_WSL: w } = require('./browser'); IS_WSL = w; } catch (e) {
  try {
    const fs = require('fs');
    const v = fs.readFileSync('/proc/version', 'utf-8').toLowerCase();
    IS_WSL = v.includes('microsoft') || v.includes('wsl');
  } catch (e2) {}
}

const NEEDS_NETSH = IS_WIN; // WSL no necesita netsh, usa host IP directo
const FIREWALL_RULE = 'CDP All Ports (IPC)';

function setupFirewall() {
  // Solo Windows nativo necesita firewall
  // WSL: el navegador corre en Windows pero WSL accede via host IP, firewall ya debe estar abierto
  // Mac/Linux: localhost directo
  if (!NEEDS_NETSH) {
    if (IS_WSL) {
      // En WSL: ejecutar netsh via cmd.exe para crear la regla en Windows
      try {
        const check = execSync(
          `cmd.exe /c netsh advfirewall firewall show rule name="${FIREWALL_RULE}"`,
          { timeout: 10000, encoding: 'utf-8', stdio: 'pipe' }
        );
        if (check.includes(FIREWALL_RULE)) return true;
      } catch (e) {}

      try {
        execSync(
          `cmd.exe /c netsh advfirewall firewall add rule name="${FIREWALL_RULE}" dir=in action=allow protocol=TCP localport=1024-65535`,
          { timeout: 10000, stdio: 'pipe' }
        );
        success('Firewall: regla universal creada (via WSL)');
        return true;
      } catch (e) {
        warn('Firewall: no se pudo crear regla desde WSL (ejecuta como Admin en Windows)');
        return false;
      }
    }
    return true;
  }

  // Windows nativo
  try {
    const check = execSync(
      `netsh advfirewall firewall show rule name="${FIREWALL_RULE}"`,
      { timeout: 10000, encoding: 'utf-8', stdio: 'pipe' }
    );
    if (check.includes(FIREWALL_RULE)) return true;
  } catch (e) {}

  try {
    execSync(
      `netsh advfirewall firewall add rule name="${FIREWALL_RULE}" dir=in action=allow protocol=TCP localport=1024-65535`,
      { timeout: 10000, stdio: 'pipe' }
    );
    success('Firewall: regla universal creada');
    return true;
  } catch (e) {
    warn('Firewall: no se pudo crear regla (ejecuta como Admin)');
    return false;
  }
}

function setupPortproxy(port) {
  // Mac/Linux nativo: no necesita portproxy
  if (!IS_WIN && !IS_WSL) {
    return true;
  }

  // WSL: ejecutar netsh via cmd.exe
  if (IS_WSL) {
    try {
      const check = execSync('cmd.exe /c netsh interface portproxy show all',
        { timeout: 10000, encoding: 'utf-8', stdio: 'pipe' });
      if (check.includes(`0.0.0.0         ${port}`)) {
        log(`        Portproxy ya existe para puerto ${port}`);
        return true;
      }
    } catch (e) {}

    try {
      execSync(
        `cmd.exe /c netsh interface portproxy add v4tov4 listenaddress=0.0.0.0 listenport=${port} connectaddress=127.0.0.1 connectport=${port}`,
        { timeout: 10000, stdio: 'pipe' }
      );
      success(`Portproxy: 0.0.0.0:${port} -> 127.0.0.1:${port} (via WSL)`);
      return true;
    } catch (e) {
      warn(`Portproxy: fallo desde WSL (ejecuta como Admin en Windows)`);
      return false;
    }
  }

  // Windows nativo
  try {
    const check = execSync('netsh interface portproxy show all',
      { timeout: 10000, encoding: 'utf-8', stdio: 'pipe' });
    if (check.includes(`0.0.0.0         ${port}`)) {
      log(`        Portproxy ya existe para puerto ${port}`);
      return true;
    }
  } catch (e) {}

  try {
    execSync(
      `netsh interface portproxy add v4tov4 listenaddress=0.0.0.0 listenport=${port} connectaddress=127.0.0.1 connectport=${port}`,
      { timeout: 10000, stdio: 'pipe' }
    );
    success(`Portproxy: 0.0.0.0:${port} -> 127.0.0.1:${port}`);
    return true;
  } catch (e) {
    warn(`Portproxy: fallo (ejecuta como Admin)`);
    return false;
  }
}

module.exports = { setupFirewall, setupPortproxy };

const { execSync } = require('child_process');
const { log, success, warn } = require('./logger');

const IS_WIN = process.platform === 'win32';
const FIREWALL_RULE = 'CDP All Ports (IPC)';

function setupFirewall() {
  // Solo necesario en Windows (WSL requiere reglas de firewall)
  // Mac/Linux no necesitan firewall para localhost
  if (!IS_WIN) {
    log('        Firewall: no necesario en esta plataforma');
    return true;
  }

  // Verificar si ya existe
  try {
    const check = execSync(
      `netsh advfirewall firewall show rule name="${FIREWALL_RULE}"`,
      { timeout: 10000, encoding: 'utf-8', stdio: 'pipe' }
    );
    if (check.includes(FIREWALL_RULE)) return true;
  } catch (e) {}

  // Crear regla universal
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
  // Solo necesario en Windows (WSL no alcanza 127.0.0.1 de Windows)
  // Mac/Linux: localhost funciona directo
  if (!IS_WIN) {
    log('        Portproxy: no necesario en esta plataforma');
    return true;
  }

  // Verificar si ya existe
  try {
    const check = execSync('netsh interface portproxy show all',
      { timeout: 10000, encoding: 'utf-8', stdio: 'pipe' });
    if (check.includes(`0.0.0.0         ${port}`)) {
      log(`        Portproxy ya existe para puerto ${port}`);
      return true;
    }
  } catch (e) {}

  // Crear portproxy
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

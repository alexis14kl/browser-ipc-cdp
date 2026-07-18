/**
 * Auto-launch — Adapter sobre brave_ipc.py.
 *
 * Lanza el navegador con CDP como último recurso de la cascada. Con cooldown:
 * el proxy puede pedir resolución en cada tool call fallida, y sin cooldown un
 * navegador que no arranca genera lanzamientos en cascada.
 *
 * Comportamiento heredado 1:1 del launcher v2.3.x (pickPython + autoLaunch).
 * En WSL delega en el python de Windows via cmd.exe (con traducción de ruta
 * /mnt/c/... → C:\...); en macOS moderno solo existe python3.
 */
const fs = require('fs');
const { exec, spawnSync } = require('child_process');

function createAutoLaunch({ scriptPath, platformId, log = () => {}, cooldownMs = 30000, execTimeoutMs = 60000 }) {
  const useWindowsPython = platformId === 'win32' || platformId === 'wsl';
  let cachedPython;
  let lastLaunchAt = 0;

  function pickPython() {
    if (cachedPython !== undefined) return cachedPython;
    cachedPython = useWindowsPython
      ? 'python'
      : ['python3', 'python'].find((cand) => !spawnSync(cand, ['--version'], { stdio: 'ignore' }).error) || null;
    return cachedPython;
  }

  return async function autoLaunch() {
    if (!fs.existsSync(scriptPath)) {
      log(`brave_ipc.py not found at ${scriptPath}`);
      return;
    }
    const now = Date.now();
    if (now - lastLaunchAt < cooldownMs) {
      log('Auto-launch en cooldown, skip');
      return;
    }
    lastLaunchAt = now;

    const py = pickPython();
    if (!py) {
      log('Auto-launch: no python/python3 en PATH');
      return;
    }
    log(`Auto-launch via brave_ipc.py --no-kill (${py})`);
    const cmd = platformId === 'wsl'
      ? `cmd.exe /c ${py} "${scriptPath.replace(/^\/mnt\/([a-z])\//, (_, d) => `${d.toUpperCase()}:\\`).replace(/\//g, '\\\\')}" --no-kill`
      : `${py} "${scriptPath}" --no-kill`;
    await new Promise((resolve) => {
      exec(cmd, { timeout: execTimeoutMs }, (err) => {
        if (err) log(`Auto-launch: ${err.message}`);
        resolve();
      });
    });
  };
}

module.exports = { createAutoLaunch };

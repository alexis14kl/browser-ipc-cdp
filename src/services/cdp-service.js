/**
 * CdpService — el helper central de CDP. ÚNICA implementación de:
 *   - fetchJson (primitiva HTTP-JSON de los endpoints /json/*)
 *   - testCdp (verificación de endpoint vivo)
 *   - lectura de DevToolsActivePort
 *   - descubrimiento de perfiles con CDP activo
 *   - la cascada de resolución: ActivePort → procesos → auto-launch
 *
 * fetchJson/testCdp/readActivePort no dependen del factory y se exportan
 * también como estáticas: browser-detect y el CLI consumen ESTAS en vez de
 * duplicarlas (la duplicación fue la causa de la regresión v2.3.0).
 *
 * No conoce process.platform: recibe el PlatformHelper por inyección
 * (Strategy elegida en src/platform/index.js). El auto-launch también se
 * inyecta — en tests se pasa uno falso y se prueba la cascada sin OS real.
 *
 * Comportamiento heredado 1:1 del launcher v2.3.x (ensureCdp y compañía).
 *
 * @param {object} deps
 * @param {import('../platform/base').PlatformHelper} deps.platform
 * @param {(msg: string) => void} [deps.log]
 * @param {(() => Promise<void>)|null} [deps.autoLaunch] - Dispara el arranque
 *   del navegador (con su propio cooldown). El service re-verifica después.
 */
const fs = require('fs');
const path = require('path');
const http = require('http');

/**
 * GET url y parsea la respuesta como JSON. Primitiva HTTP compartida:
 * testCdp se construye sobre ella y el CLI la usa para /json/list.
 * Rechaza en error de red, timeout, status != 200 o JSON inválido.
 */
function fetchJson(url, timeoutMs = 1500) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`HTTP ${res.statusCode}`)); }
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

/** GET /json/version; devuelve el JSON solo si hay webSocketDebuggerUrl. */
async function testCdp(url, timeoutMs = 1500) {
  try {
    const json = await fetchJson(`${url}/json/version`, timeoutMs);
    if (json && typeof json.webSocketDebuggerUrl === 'string' && json.webSocketDebuggerUrl) {
      return json;
    }
  } catch {}
  return null;
}

/** Lee el puerto del archivo DevToolsActivePort de un perfil (o null). */
function readActivePort(userDataDir) {
  const file = path.join(userDataDir, 'DevToolsActivePort');
  if (!fs.existsSync(file)) return null;
  try {
    const txt = fs.readFileSync(file, 'utf-8');
    const port = parseInt(txt.split(/\r?\n/)[0], 10);
    if (Number.isFinite(port) && port > 0) return port;
  } catch {}
  return null;
}

function createCdpService({ platform, log = () => {}, autoLaunch = null }) {
  const HOME = process.env.USERPROFILE || process.env.HOME || '';
  const LOCALAPPDATA = process.env.LOCALAPPDATA || path.join(HOME, 'AppData', 'Local');

  /**
   * Perfiles con DevToolsActivePort presente: los de la plataforma + escaneo
   * dinámico de HOME (dirs *-profile/cdp/debug/chromium) y LOCALAPPDATA
   * (niveles 1-2 buscando "User Data"; en unix no existe y se ignora).
   */
  function discoverProfiles() {
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

    for (const ud of platform.userDataDirs()) addIfHasFile(ud.path, ud.name);

    try {
      for (const entry of fs.readdirSync(HOME, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        if (/profile|cdp|debug|chromium/i.test(entry.name)) {
          addIfHasFile(path.join(HOME, entry.name), `home/${entry.name}`);
        }
      }
    } catch {}

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

  /** Primer perfil cuyo DevToolsActivePort apunte a un CDP vivo. */
  async function tryActivePort() {
    const profiles = discoverProfiles();
    log(`Profiles con DevToolsActivePort: ${profiles.length}`);
    for (const ud of profiles) {
      const port = readActivePort(ud.path);
      if (!port) continue;
      const version = await testCdp(`http://127.0.0.1:${port}`, 1500);
      if (version) {
        log(`DevToolsActivePort hit: ${ud.name} -> :${port}`);
        return { port, version };
      }
      log(`Stale port :${port} en ${ud.name}`);
    }
    return null;
  }

  /** Sondea puertos en paralelo; devuelve el primero vivo en orden de la lista. */
  async function firstLiveCdp(ports, label) {
    const list = [...ports];
    if (!list.length) return null;
    const results = await Promise.all(list.map((p) => testCdp(`http://127.0.0.1:${p}`, 1500)));
    const i = results.findIndex(Boolean);
    if (i === -1) return null;
    log(`Discovery hit (${label}): :${list[i]}`);
    return { port: list[i], version: results[i] };
  }

  /**
   * La cascada completa (antes ensureCdp del launcher):
   * ActivePort → discovery por procesos de la plataforma → auto-launch.
   * Con launch:false no lanza navegador (el handshake MCP no puede esperarlo).
   */
  async function resolve({ launch = true } = {}) {
    let result = await tryActivePort();
    if (result) return result;

    log('DevToolsActivePort miss. Falling back to process discovery.');
    const groups = await platform.discoverCandidatePorts(log);
    for (const group of groups) {
      result = await firstLiveCdp(group.ports, group.label);
      if (result) return result;
    }

    if (!launch || !autoLaunch) return null;
    log('No live CDP found. Auto-launching browser.');
    await autoLaunch();
    return await tryActivePort();
  }

  return { testCdp, readActivePort, discoverProfiles, tryActivePort, firstLiveCdp, resolve };
}

module.exports = { createCdpService, fetchJson, testCdp, readActivePort };

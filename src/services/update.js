/**
 * UpdateService — instalación en ruta fija + swap atómico + chequeo de versión.
 *
 * Problema que resuelve: el instalador escribía en .mcp.json/.claude.json la
 * ruta absoluta de la copia desde donde corrió (p. ej. el caché de npx,
 * ~/.npm/_npx/<hash>/...). Al publicar una versión nueva, esa ruta seguía
 * apuntando al código viejo: la IA quedaba trabajando con una versión
 * desactualizada aunque el paquete se actualizara en npm.
 *
 * Solución: el instalador se copia a una RUTA FIJA (~/.browser-ipc-cdp/app) y
 * las configs apuntan ahí para siempre. Actualizar = reemplazar el contenido
 * del directorio fijo con swap por rename (staging app.new → app; la copia
 * anterior pasa a app.old y se borra): lo viejo desaparece por completo
 * —incluyendo archivos que la versión nueva ya no trae— y lo nuevo queda.
 *
 * Modo dev: si la copia corriendo es un checkout git, NO se auto-copia; las
 * configs apuntan al repo (el flujo npm link del desarrollador queda intacto).
 *
 * El chequeo de versión reutiliza fetchJson de cdp-service (única primitiva
 * HTTP-JSON del sistema) contra el registry de npm; siempre best-effort.
 */
const fs = require('fs');
const path = require('path');
const { fetchJson } = require('./cdp-service');

const PACKAGE_ROOT = path.join(__dirname, '..', '..');
const PACKAGE_NAME = 'browser-ipc-cdp';
const REGISTRY_LATEST = `https://registry.npmjs.org/${PACKAGE_NAME}/latest`;

// Lo que se copia a la ruta fija: los archivos publicados (package.json
// "files" + bin del manifest). node_modules se maneja aparte.
const PACKAGE_FILES = ['bin', 'src', 'brave_mcp_launcher.js', 'brave_ipc.py', 'brave_cdp.bat', 'package.json', 'README.md', 'LICENSE'];

/** HOME al momento de la llamada (los tests lo aíslan vía USERPROFILE). */
function home() {
  return process.env.USERPROFILE || process.env.HOME || '';
}

function defaultDestRoot() {
  return path.join(home(), '.browser-ipc-cdp');
}

/** Versión del package.json de un directorio (o null). */
function installedVersion(dir = PACKAGE_ROOT) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf-8')).version || null;
  } catch {
    return null;
  }
}

/** "dependencies" del package.json de un directorio (o {}). */
function readDeclaredDeps(dir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf-8')).dependencies || {};
  } catch {
    return {};
  }
}

/**
 * Compara "x.y.z" numéricamente: <0 si a<b, 0 si igual, >0 si a>b.
 * Partes faltantes cuentan como 0 ("3.1" === "3.1.0"): sin esto la resta
 * con undefined da NaN y "outdated" quedaría en false en silencio.
 */
function cmpVersions(a, b) {
  const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    const da = pa[i] || 0, db = pb[i] || 0;
    if (da !== db) return da - db;
  }
  return 0;
}

/**
 * Compara la versión local contra el registry. Best-effort: devuelve
 * { current, latest, outdated } o null si no hay red/registry (nunca lanza).
 */
async function checkForUpdate({ registryUrl = REGISTRY_LATEST, timeoutMs = 2500, dir = PACKAGE_ROOT } = {}) {
  const current = installedVersion(dir);
  if (!current) return null;
  try {
    const json = await fetchJson(registryUrl, timeoutMs);
    if (!json || typeof json.version !== 'string') return null;
    return { current, latest: json.version, outdated: cmpVersions(json.version, current) > 0 };
  } catch {
    return null;
  }
}

/** Un checkout git es modo desarrollo: no se auto-copia. */
function isDevCheckout(dir = PACKAGE_ROOT) {
  return fs.existsSync(path.join(dir, '.git'));
}

/**
 * Copia el paquete corriendo a <destRoot>/app con swap por rename.
 * Idempotente: si la ruta fija ya tiene esta misma versión, no hace nada.
 * Si el swap falla a medias (p. ej. lock de Windows), revierte y lanza.
 *
 * @returns {string} ruta del directorio app instalado
 */
function selfInstall({ srcDir = PACKAGE_ROOT, destRoot = defaultDestRoot(), log = () => {} } = {}) {
  const dest = path.join(destRoot, 'app');
  if (path.resolve(srcDir) === path.resolve(dest)) return dest; // ya corre desde la fija

  const srcVer = installedVersion(srcDir);
  const curVer = installedVersion(dest);
  if (srcVer && curVer === srcVer) {
    log(`Copia fija ya en v${curVer} (sin cambios)`);
    return dest;
  }

  const staging = `${dest}.new`;
  const trash = `${dest}.old`;
  fs.rmSync(staging, { recursive: true, force: true });
  fs.rmSync(trash, { recursive: true, force: true });
  fs.mkdirSync(staging, { recursive: true });

  for (const entry of PACKAGE_FILES) {
    const from = path.join(srcDir, entry);
    if (fs.existsSync(from)) fs.cpSync(from, path.join(staging, entry), { recursive: true });
  }

  // Dependencias (chrome-devtools-mcp): se copia SOLO la clausura de
  // "dependencies" declaradas (BFS por los package.json). Cada dependencia
  // puede vivir ANIDADA en srcDir/node_modules (layout de npm i -g) o como
  // HERMANA en <root>/node_modules (layout del caché de npx) — se busca en
  // ese orden. Nunca se copia el árbol entero: en npm i -g el hermano es el
  // node_modules GLOBAL (npm, corepack...). Si una dependencia no aparece,
  // el launcher cae a su fallback npx (funcional, más lento).
  const siblings = path.dirname(srcDir);
  const depRoots = [path.join(srcDir, 'node_modules')];
  if (path.basename(siblings) === 'node_modules') depRoots.push(siblings);
  {
    const stagingDeps = path.join(staging, 'node_modules');
    const queue = Object.keys(readDeclaredDeps(srcDir));
    const seen = new Set([PACKAGE_NAME]); // el paquete mismo no es dependencia
    while (queue.length) {
      const dep = queue.shift();
      if (seen.has(dep)) continue;
      seen.add(dep);
      const from = depRoots.map((r) => path.join(r, dep)).find((p) => fs.existsSync(p));
      if (!from) continue;
      const to = path.join(stagingDeps, dep);
      fs.mkdirSync(path.dirname(to), { recursive: true }); // paquetes @scope/x
      fs.cpSync(from, to, { recursive: true });
      queue.push(...Object.keys(readDeclaredDeps(from)));
    }
  }

  // Swap: la copia vieja completa se va (incluye archivos que la versión
  // nueva ya no trae). Si falla a medias, se revierte para no dejar la ruta
  // fija rota (un launcher corriendo sigue vivo con sus fd abiertos).
  try {
    if (fs.existsSync(dest)) fs.renameSync(dest, trash);
    fs.renameSync(staging, dest);
  } catch (e) {
    if (!fs.existsSync(dest) && fs.existsSync(trash)) fs.renameSync(trash, dest);
    fs.rmSync(staging, { recursive: true, force: true });
    throw e;
  }
  fs.rmSync(trash, { recursive: true, force: true });

  log(curVer ? `Copia fija actualizada: v${curVer} -> v${srcVer} (lo viejo eliminado)` : `Copia fija instalada: v${srcVer} en ${dest}`);
  return dest;
}

/**
 * Devuelve la ruta del launcher que deben referenciar las configs:
 *   - checkout git → el del repo (modo dev, sin copia fija)
 *   - resto → el de la ruta fija, instalándola/actualizándola primero
 * Si la copia fija falla, cae a la copia actual (nunca deja al usuario sin MCP).
 */
function ensureInstalled({ srcDir = PACKAGE_ROOT, destRoot = defaultDestRoot(), log = () => {}, warn = () => {} } = {}) {
  if (isDevCheckout(srcDir)) {
    log('Checkout git detectado: modo dev, las configs apuntan al repo');
    return path.join(srcDir, 'brave_mcp_launcher.js');
  }
  try {
    return path.join(selfInstall({ srcDir, destRoot, log }), 'brave_mcp_launcher.js');
  } catch (e) {
    warn(`Copia fija fallo (${e.message}). Usando la copia actual; reintenta con el MCP desconectado.`);
    return path.join(srcDir, 'brave_mcp_launcher.js');
  }
}

/** Borra la instalación fija completa. @returns {boolean} si existía. */
function uninstall({ destRoot = defaultDestRoot() } = {}) {
  if (!fs.existsSync(destRoot)) return false;
  fs.rmSync(destRoot, { recursive: true, force: true });
  return true;
}

module.exports = {
  installedVersion, cmpVersions, checkForUpdate, isDevCheckout,
  selfInstall, ensureInstalled, uninstall, PACKAGE_ROOT,
};

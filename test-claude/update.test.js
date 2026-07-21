/**
 * Tests del UpdateService: swap atómico de la copia fija (lo viejo se borra,
 * lo nuevo queda), chequeo de versión contra un registry falso, modo dev, y
 * la limpieza real de --uninstall (removeBraveEntry con rutas explícitas).
 * Todo contra tmpdirs y servers locales — jamás toca las configs reales.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const {
  installedVersion, cmpVersions, checkForUpdate, isDevCheckout,
  selfInstall, ensureInstalled, uninstall,
} = require('../src/services/update');
const { removeBraveEntry } = require('../src/services/mcp-config');
const { trackSockets, closeServer } = require('./helpers');

const noop = () => {};

function tmpdir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/** Paquete falso mínimo con la forma del real. */
function fakePackage(dir, version) {
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'browser-ipc-cdp', version }));
  fs.writeFileSync(path.join(dir, 'brave_mcp_launcher.js'), `// launcher v${version}`);
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'a.js'), `module.exports = '${version}';`);
}

/** Registry falso: responde {version} en cualquier ruta. */
function startFakeRegistry(version) {
  const server = trackSockets(http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ name: 'browser-ipc-cdp', version }));
  }));
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

test('cmpVersions: orden semver numérico (no lexicográfico)', () => {
  assert.ok(cmpVersions('3.1.1', '3.1.0') > 0);
  assert.ok(cmpVersions('3.2.0', '3.10.0') < 0, '10 > 2 numéricamente');
  assert.strictEqual(cmpVersions('3.1.1', '3.1.1'), 0);
  assert.ok(cmpVersions('4.0.0', '3.99.99') > 0);
});

test('checkForUpdate: outdated true/false según el registry, null sin red', async () => {
  const src = tmpdir('upd-pkg-');
  fakePackage(src, '1.0.0');
  const registry = await startFakeRegistry('2.0.0');
  const url = `http://127.0.0.1:${registry.address().port}/browser-ipc-cdp/latest`;
  try {
    const upd = await checkForUpdate({ registryUrl: url, dir: src });
    assert.deepStrictEqual(upd, { current: '1.0.0', latest: '2.0.0', outdated: true });
  } finally {
    await closeServer(registry);
  }

  const same = await startFakeRegistry('1.0.0');
  try {
    const upd = await checkForUpdate({ registryUrl: `http://127.0.0.1:${same.address().port}/x`, dir: src });
    assert.strictEqual(upd.outdated, false);
  } finally {
    await closeServer(same);
    fs.rmSync(src, { recursive: true, force: true });
  }

  // Registry caído: null, jamás lanza (el flujo del CLI/MCP no puede romperse).
  assert.strictEqual(await checkForUpdate({ registryUrl: 'http://127.0.0.1:1/x', timeoutMs: 500 }), null);
});

test('selfInstall: instala, y al actualizar BORRA los archivos de la versión vieja', () => {
  const src = tmpdir('upd-src-');
  const destRoot = tmpdir('upd-dest-');
  const app = path.join(destRoot, 'app');
  try {
    // v1 trae un módulo que v2 ya no tendrá
    fakePackage(src, '1.0.0');
    fs.writeFileSync(path.join(src, 'src', 'obsoleto-v1.js'), 'viejo');
    selfInstall({ srcDir: src, destRoot, log: noop });
    assert.strictEqual(installedVersion(app), '1.0.0');
    assert.ok(fs.existsSync(path.join(app, 'src', 'obsoleto-v1.js')));

    // v2: sin el obsoleto, con un módulo nuevo
    fs.rmSync(path.join(src, 'src', 'obsoleto-v1.js'));
    fakePackage(src, '2.0.0');
    fs.writeFileSync(path.join(src, 'src', 'nuevo-v2.js'), 'nuevo');
    selfInstall({ srcDir: src, destRoot, log: noop });

    assert.strictEqual(installedVersion(app), '2.0.0');
    assert.ok(fs.existsSync(path.join(app, 'src', 'nuevo-v2.js')), 'lo nuevo queda');
    assert.ok(!fs.existsSync(path.join(app, 'src', 'obsoleto-v1.js')), 'lo viejo se borra');
    assert.ok(!fs.existsSync(`${app}.new`) && !fs.existsSync(`${app}.old`), 'sin residuos del swap');
  } finally {
    fs.rmSync(src, { recursive: true, force: true });
    fs.rmSync(destRoot, { recursive: true, force: true });
  }
});

test('selfInstall: idempotente con la misma versión y copia las dependencias hermanas', () => {
  // Layout del caché de npx: <root>/node_modules/{browser-ipc-cdp, chrome-devtools-mcp}
  const root = tmpdir('upd-npx-');
  const destRoot = tmpdir('upd-dest2-');
  const src = path.join(root, 'node_modules', 'browser-ipc-cdp');
  fs.mkdirSync(src, { recursive: true });
  fs.mkdirSync(path.join(root, 'node_modules', 'chrome-devtools-mcp'), { recursive: true });
  fs.writeFileSync(path.join(root, 'node_modules', 'chrome-devtools-mcp', 'index.js'), '// dep');
  try {
    fakePackage(src, '1.0.0');
    const app = selfInstall({ srcDir: src, destRoot, log: noop });

    assert.ok(fs.existsSync(path.join(app, 'node_modules', 'chrome-devtools-mcp', 'index.js')), 'dependencia hermana copiada');
    assert.ok(!fs.existsSync(path.join(app, 'node_modules', 'browser-ipc-cdp')), 'el paquete mismo no se anida');

    // Misma versión: no-op (marca un archivo y verifica que sobrevive)
    fs.writeFileSync(path.join(app, 'marca.txt'), 'intacto');
    selfInstall({ srcDir: src, destRoot, log: noop });
    assert.ok(fs.existsSync(path.join(app, 'marca.txt')), 'misma versión no reinstala');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(destRoot, { recursive: true, force: true });
  }
});

test('ensureInstalled: checkout git → modo dev, apunta al repo sin crear copia fija', () => {
  const src = tmpdir('upd-dev-');
  const destRoot = tmpdir('upd-dest3-');
  try {
    fakePackage(src, '1.0.0');
    fs.mkdirSync(path.join(src, '.git'));
    const wrapper = ensureInstalled({ srcDir: src, destRoot, log: noop, warn: noop });
    assert.strictEqual(wrapper, path.join(src, 'brave_mcp_launcher.js'));
    assert.ok(!fs.existsSync(path.join(destRoot, 'app')), 'en modo dev no se copia nada');
  } finally {
    fs.rmSync(src, { recursive: true, force: true });
    fs.rmSync(destRoot, { recursive: true, force: true });
  }
});

test('ensureInstalled: instalación normal → apunta al launcher de la ruta fija', () => {
  const src = tmpdir('upd-usr-');
  const destRoot = tmpdir('upd-dest4-');
  try {
    fakePackage(src, '1.0.0');
    const wrapper = ensureInstalled({ srcDir: src, destRoot, log: noop, warn: noop });
    assert.strictEqual(wrapper, path.join(destRoot, 'app', 'brave_mcp_launcher.js'));
    assert.ok(fs.existsSync(wrapper), 'el launcher fijo existe de verdad');
  } finally {
    fs.rmSync(src, { recursive: true, force: true });
    fs.rmSync(destRoot, { recursive: true, force: true });
  }
});

test('uninstall: borra la instalación fija y reporta si existía', () => {
  const destRoot = tmpdir('upd-uni-');
  fs.mkdirSync(path.join(destRoot, 'app'), { recursive: true });
  assert.strictEqual(uninstall({ destRoot }), true);
  assert.ok(!fs.existsSync(destRoot));
  assert.strictEqual(uninstall({ destRoot }), false, 'segunda vez: ya no existía');
});

test('removeBraveEntry: quita solo brave, preserva el resto, cuenta bien', () => {
  const dir = tmpdir('upd-cfg-');
  const withBrave = path.join(dir, '.mcp.json');
  const without = path.join(dir, 'otro.json');
  fs.writeFileSync(withBrave, JSON.stringify({ mcpServers: { brave: { command: 'node' }, otro: { command: 'x' } } }));
  fs.writeFileSync(without, JSON.stringify({ mcpServers: { otro: { command: 'x' } } }));
  try {
    const removed = removeBraveEntry([withBrave, without, path.join(dir, 'no-existe.json')]);
    assert.strictEqual(removed, 1, 'solo el archivo que tenía brave');
    const data = JSON.parse(fs.readFileSync(withBrave, 'utf-8'));
    assert.strictEqual(data.mcpServers.brave, undefined);
    assert.deepStrictEqual(data.mcpServers.otro, { command: 'x' }, 'las demás entradas quedan intactas');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('dev real: este repo es checkout git (protege el flujo npm link del dev)', () => {
  assert.strictEqual(isDevCheckout(), true);
});

/**
 * Tests de la vista unificada de cdp_info.json: ruta canónica (~), lectura
 * "gana el más reciente" entre cwd y canónica, y limpieza. Reproduce el bug
 * que motivó la unificación: el MCP escribía junto al launcher (que el swap
 * de update borra) y --status nunca veía el estado del modo PROXY.
 * Aislamiento: USERPROFILE → tmpdir (prioridad sobre HOME) y chdir a tmpdir.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { createCdpInfoView, saveCdpInfo, loadCdpInfo, removeCdpInfo, canonicalPath } = require('../src/views/cdp-info-view');

const FAKE_VERSION = { webSocketDebuggerUrl: 'ws://127.0.0.1:1/x', Browser: 'FakeChrome/1.0' };

function isolated(fn) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cdpinfo-home-'));
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'cdpinfo-cwd-'));
  const prevHome = process.env.USERPROFILE;
  const prevCwd = process.cwd();
  process.env.USERPROFILE = home;
  process.chdir(cwd);
  try {
    return fn({ home, cwd });
  } finally {
    if (prevHome === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = prevHome;
    process.chdir(prevCwd);
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(cwd, { recursive: true, force: true });
  }
}

test('el estado que escribe el MCP (modo PROXY) lo ve loadCdpInfo (--status)', () => {
  isolated(({ home }) => {
    const view = createCdpInfoView(); // sin file: ruta canónica
    view.write(49999, FAKE_VERSION, 'PROXY', 9333);

    assert.strictEqual(canonicalPath(), path.join(home, 'cdp_info.json'));
    const info = loadCdpInfo();
    assert.ok(info, '--status debe ver lo que escribió el MCP');
    assert.strictEqual(info.MODE, 'PROXY');
    assert.strictEqual(info.CDP_URL, 'http://127.0.0.1:9333', 'CDP_URL apunta al proxy fijo');
    assert.strictEqual(info.BACKEND_URL, 'http://127.0.0.1:49999');
    assert.ok(info.UPDATED_AT, 'formato congelado incluye UPDATED_AT');
  });
});

test('loadCdpInfo: entre cwd y canónica gana el archivo más reciente (mtime)', () => {
  isolated(({ home, cwd }) => {
    const canonical = path.join(home, 'cdp_info.json');
    const local = path.join(cwd, 'cdp_info.json');
    const old = Date.now() / 1000 - 3600;

    // cwd viejo, canónica nueva → gana la canónica
    fs.writeFileSync(local, JSON.stringify({ MODE: 'VIEJO-CWD' }));
    fs.utimesSync(local, old, old);
    fs.writeFileSync(canonical, JSON.stringify({ MODE: 'NUEVO-HOME' }));
    assert.strictEqual(loadCdpInfo().MODE, 'NUEVO-HOME');

    // cwd más nueva que la canónica → gana cwd
    fs.utimesSync(canonical, old, old);
    fs.writeFileSync(local, JSON.stringify({ MODE: 'NUEVO-CWD' }));
    assert.strictEqual(loadCdpInfo().MODE, 'NUEVO-CWD');
  });
});

test('saveCdpInfo escribe canónica + cwd con UPDATED_AT; removeCdpInfo borra ambos', () => {
  isolated(({ home, cwd }) => {
    saveCdpInfo({ DEBUG_PORT: 1234, MODE: 'ATTACHED' });
    for (const p of [path.join(home, 'cdp_info.json'), path.join(cwd, 'cdp_info.json')]) {
      const data = JSON.parse(fs.readFileSync(p, 'utf-8'));
      assert.strictEqual(data.DEBUG_PORT, 1234);
      assert.ok(data.UPDATED_AT, `UPDATED_AT presente en ${p}`);
    }
    assert.strictEqual(removeCdpInfo(), 2, 'borra los dos archivos');
    assert.strictEqual(loadCdpInfo(), null);
  });
});

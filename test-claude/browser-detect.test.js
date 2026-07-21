/**
 * Tests de la deduplicación CLI ↔ MCP: browser-detect consume las estáticas
 * de cdp-service (fetchJson/testCdp/readActivePort) y la plataforma viene de
 * src/platform. Cubre las estáticas, el camino DevToolsActivePort de
 * detectExistingCDP con un CDP falso, y las reglas de arquitectura que
 * impiden que la duplicación vuelva.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const { createCdpService, fetchJson, testCdp, readActivePort } = require('../src/services/cdp-service');
const { detectExistingCDP, isBrowserRunning, ...browserDetectRest } = require('../src/services/browser-detect');
const { startFakeCdp, closeServer, trackSockets } = require('./helpers');

const SRC = path.join(__dirname, '..', 'src');

function tmpProfile() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'bd-profile-'));
}

test('fetchJson: parsea /json/version del CDP falso y rechaza en puerto muerto', async () => {
  const server = await startFakeCdp();
  const port = server.address().port;
  try {
    const json = await fetchJson(`http://127.0.0.1:${port}/json/version`);
    assert.strictEqual(json.Browser, 'FakeChrome/1.0');
    const list = await fetchJson(`http://127.0.0.1:${port}/json/list`);
    assert.deepStrictEqual(list, []);
    await assert.rejects(() => fetchJson(`http://127.0.0.1:${port}/no-existe`), /HTTP 404/);
  } finally {
    await closeServer(server);
  }
  await assert.rejects(() => fetchJson(`http://127.0.0.1:${port}/json/version`, 500));
});

test('testCdp: JSON con webSocketDebuggerUrl → objeto; sin él o muerto → null', async () => {
  const fake = await startFakeCdp();
  const fakePort = fake.address().port;

  // Server que responde 200 pero SIN webSocketDebuggerUrl (no es un CDP real).
  const impostor = trackSockets(http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.end('{"Browser":"NoCdp/1.0"}');
  }));
  await new Promise((r) => impostor.listen(0, '127.0.0.1', r));
  const impostorPort = impostor.address().port;

  try {
    const ok = await testCdp(`http://127.0.0.1:${fakePort}`);
    assert.ok(ok && ok.webSocketDebuggerUrl, 'CDP vivo debe devolver el JSON');
    assert.strictEqual(await testCdp(`http://127.0.0.1:${impostorPort}`), null);
  } finally {
    await closeServer(fake);
    await closeServer(impostor);
  }
  assert.strictEqual(await testCdp(`http://127.0.0.1:${fakePort}`, 500), null);
});

test('readActivePort: lee la primera línea; null si falta el archivo o es basura', () => {
  const dir = tmpProfile();
  try {
    assert.strictEqual(readActivePort(dir), null, 'sin archivo → null');
    fs.writeFileSync(path.join(dir, 'DevToolsActivePort'), '54321\n/devtools/browser/abc');
    assert.strictEqual(readActivePort(dir), 54321);
    fs.writeFileSync(path.join(dir, 'DevToolsActivePort'), 'basura\n');
    assert.strictEqual(readActivePort(dir), null, 'contenido no numérico → null');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('detectExistingCDP: DevToolsActivePort del perfil apuntando a un CDP vivo → puerto', async (t) => {
  // El "navegador" es el propio node del test runner: isBrowserRunning lo ve
  // vivo en cualquier OS (pgrep/tasklist), y el perfil es un tmpdir con un
  // DevToolsActivePort que apunta al CDP falso.
  //
  // Precondición verificada en runtime: en algunos runners de CI pgrep no ve
  // al propio node de forma intermitente (flake real de macos-latest); si el
  // entorno no cumple, el test se salta en vez de fallar por el runner.
  if (!isBrowserRunning(process.execPath)) {
    t.skip('pgrep/tasklist no ve al propio proceso node en este entorno');
    return;
  }
  const server = await startFakeCdp();
  const port = server.address().port;
  const userData = tmpProfile();
  fs.writeFileSync(path.join(userData, 'DevToolsActivePort'), `${port}\n/devtools/browser/fake-id`);
  try {
    const browser = { name: 'fake', exe: process.execPath, userData };
    assert.strictEqual(await detectExistingCDP(browser), port);
  } finally {
    await closeServer(server);
    fs.rmSync(userData, { recursive: true, force: true });
  }
});

test('dedup: browser-detect ya no exporta sus copias (testCdp/IS_*)', () => {
  const exported = Object.keys({ detectExistingCDP, isBrowserRunning, ...browserDetectRest }).sort();
  assert.deepStrictEqual(exported, ['detectBrowsers', 'detectExistingCDP', 'findBrowser', 'isBrowserRunning', 'launchBrowser']);
});

test('dedup: las funciones del CdpService instanciado SON las estáticas', () => {
  const svc = createCdpService({
    platform: { id: 'fake', userDataDirs: () => [], discoverCandidatePorts: async () => [] },
  });
  assert.strictEqual(svc.testCdp, testCdp);
  assert.strictEqual(svc.readActivePort, readActivePort);
});

// Reglas de arquitectura ejecutables: si alguien re-duplica, este test lo ve.
test('arquitectura: process.platform solo se consulta en src/platform/index.js', () => {
  const offenders = walkJs(SRC)
    .filter((f) => /process\.platform\s*===/.test(fs.readFileSync(f, 'utf-8')))
    .map((f) => path.relative(SRC, f))
    .filter((f) => f !== path.join('platform', 'index.js'));
  assert.deepStrictEqual(offenders, [], `detección de plataforma duplicada en: ${offenders}`);
});

test('arquitectura: testCdp se define una sola vez (cdp-service.js)', () => {
  const offenders = walkJs(SRC)
    .filter((f) => /function testCdp\s*\(/.test(fs.readFileSync(f, 'utf-8')))
    .map((f) => path.relative(SRC, f))
    .filter((f) => f !== path.join('services', 'cdp-service.js'));
  assert.deepStrictEqual(offenders, [], `testCdp re-implementado en: ${offenders}`);
});

function walkJs(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkJs(p));
    else if (entry.name.endsWith('.js')) out.push(p);
  }
  return out;
}

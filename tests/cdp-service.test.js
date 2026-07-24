/**
 * Tests unitarios del CdpService (Fase 2): la cascada de resolución completa
 * con PlatformHelper y auto-launch FALSOS — sin navegador ni OS real.
 *
 * Aislamiento: el service lee HOME de process.env.USERPROFILE (prioridad
 * sobre HOME) al crearse; cada test apunta USERPROFILE a un tmpdir propio
 * para que el escaneo dinámico de perfiles no vea los reales de la máquina.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { createCdpService } = require('../src/services/cdp-service');
const { startFakeCdp, closeServer, randomPort } = require('./helpers');

const noop = () => {};

function isolatedHome() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-svc-home-'));
  const prev = process.env.USERPROFILE;
  process.env.USERPROFILE = dir;
  return {
    dir,
    restore() {
      if (prev === undefined) delete process.env.USERPROFILE;
      else process.env.USERPROFILE = prev;
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

function fakePlatform({ dirs = [], portGroups = [] } = {}) {
  return {
    id: 'fake',
    userDataDirs: () => dirs,
    discoverCandidatePorts: async () => portGroups,
  };
}

test('resolve(): hit por DevToolsActivePort del perfil de la plataforma', async () => {
  const home = isolatedHome();
  const backend = await startFakeCdp();
  try {
    const profile = path.join(home.dir, 'perfil-brave');
    fs.mkdirSync(profile);
    fs.writeFileSync(path.join(profile, 'DevToolsActivePort'), `${backend.address().port}\n/devtools/browser/x\n`);

    const cdp = createCdpService({
      platform: fakePlatform({ dirs: [{ name: 'fake-brave', path: profile }] }),
      log: noop,
    });
    const hit = await cdp.resolve({ launch: false });
    assert.ok(hit, 'debía resolver');
    assert.strictEqual(hit.port, backend.address().port);
    assert.strictEqual(hit.version.Browser, 'FakeChrome/1.0');
  } finally {
    await closeServer(backend);
    home.restore();
  }
});

test('resolve(): cae a discovery por procesos y elige el primer puerto VIVO', async () => {
  const home = isolatedHome();
  const backend = await startFakeCdp();
  try {
    const muerto = randomPort();
    const cdp = createCdpService({
      platform: fakePlatform({
        portGroups: [{ label: 'fake-ps', ports: new Set([muerto, backend.address().port]) }],
      }),
      log: noop,
    });
    const hit = await cdp.resolve({ launch: false });
    assert.ok(hit, 'debía resolver por discovery');
    assert.strictEqual(hit.port, backend.address().port, 'salta el puerto muerto y toma el vivo');
  } finally {
    await closeServer(backend);
    home.restore();
  }
});

test('resolve({launch:false}): sin CDP no lanza el navegador y devuelve null', async () => {
  const home = isolatedHome();
  try {
    let lanzado = false;
    const cdp = createCdpService({
      platform: fakePlatform(),
      log: noop,
      autoLaunch: async () => { lanzado = true; },
    });
    const hit = await cdp.resolve({ launch: false });
    assert.strictEqual(hit, null);
    assert.strictEqual(lanzado, false, 'launch:false NUNCA debe disparar auto-launch');
  } finally {
    home.restore();
  }
});

test('resolve(): auto-launch como último recurso y re-verificación posterior', async () => {
  const home = isolatedHome();
  const backend = await startFakeCdp();
  try {
    const profile = path.join(home.dir, 'perfil-lanzado');
    // El perfil NO existe aún: el auto-launch falso "arranca el navegador"
    // creando el DevToolsActivePort, como haría Brave de verdad.
    const cdp = createCdpService({
      platform: fakePlatform({ dirs: [{ name: 'fake', path: profile }] }),
      log: noop,
      autoLaunch: async () => {
        fs.mkdirSync(profile, { recursive: true });
        fs.writeFileSync(path.join(profile, 'DevToolsActivePort'), `${backend.address().port}\n/devtools/browser/x\n`);
      },
    });
    const hit = await cdp.resolve();
    assert.ok(hit, 'debía resolver tras el auto-launch');
    assert.strictEqual(hit.port, backend.address().port);
  } finally {
    await closeServer(backend);
    home.restore();
  }
});

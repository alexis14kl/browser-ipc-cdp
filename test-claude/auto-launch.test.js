/**
 * Tests del auto-launch en JS puro (fase 5: sin Python). Verifica la cascada
 * de la última etapa de resolución CDP: detectar navegador → lanzarlo con
 * noKill → cooldown. Con findBrowser/launchBrowser FALSOS (seam de inyección):
 * nunca abre un navegador real.
 */
const { test } = require('node:test');
const assert = require('node:assert');

const { createAutoLaunch } = require('../src/services/auto-launch');

const noop = () => {};

test('auto-launch: detecta el navegador y lo lanza con noKill=true', async () => {
  const calls = [];
  const autoLaunch = createAutoLaunch({
    findBrowser: () => ({ name: 'brave', exe: '/fake/brave' }),
    launchBrowser: (browser, opts) => { calls.push({ browser, opts }); return Promise.resolve({ port: 55123 }); },
  });
  await autoLaunch();
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].browser.name, 'brave');
  assert.strictEqual(calls[0].opts.noKill, true, 'NUNCA debe matar la sesión del usuario');
});

test('auto-launch: cooldown — la 2da llamada inmediata no relanza', async () => {
  let launches = 0;
  const autoLaunch = createAutoLaunch({
    cooldownMs: 30000,
    findBrowser: () => ({ name: 'chrome', exe: '/fake/chrome' }),
    launchBrowser: () => { launches++; return Promise.resolve({ port: 1 }); },
  });
  await autoLaunch();
  await autoLaunch(); // dentro del cooldown → skip
  assert.strictEqual(launches, 1, 'el cooldown evita lanzamientos en cascada');
});

test('auto-launch: cooldown vencido → sí relanza', async () => {
  let launches = 0;
  const autoLaunch = createAutoLaunch({
    cooldownMs: 0, // sin ventana de espera
    findBrowser: () => ({ name: 'edge', exe: '/fake/edge' }),
    launchBrowser: () => { launches++; return Promise.resolve({ port: 1 }); },
  });
  await autoLaunch();
  await autoLaunch();
  assert.strictEqual(launches, 2);
});

test('auto-launch: sin navegador instalado → no lanza, no lanza excepción', async () => {
  let launched = false;
  const autoLaunch = createAutoLaunch({
    findBrowser: () => null,
    launchBrowser: () => { launched = true; return Promise.resolve({ port: 1 }); },
  });
  await autoLaunch(); // no debe throw
  assert.strictEqual(launched, false);
});

test('auto-launch: un fallo de launchBrowser se traga (no rompe la cascada)', async () => {
  const autoLaunch = createAutoLaunch({
    log: noop,
    findBrowser: () => ({ name: 'brave', exe: '/fake/brave' }),
    launchBrowser: () => Promise.reject(new Error('Timeout esperando DevToolsActivePort')),
  });
  await assert.doesNotReject(() => autoLaunch());
});

test('auto-launch: sin residuos de código de la implementación Python', () => {
  // "sin Python" en un mensaje de log es legítimo; buscamos residuos de CÓDIGO.
  const src = require('fs').readFileSync(require.resolve('../src/services/auto-launch'), 'utf-8');
  assert.ok(!/brave_ipc|spawnSync|pickPython|scriptPath|\.py\b/.test(src), 'quedó residuo del adapter Python');
});

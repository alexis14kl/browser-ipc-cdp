'use strict';

/**
 * Shutdown — el registro de limpiezas que corre antes de que el proceso muera.
 *
 * Lo que se prueba sin tocar señales ni process.exit reales (ambos llegan por
 * inyección): que corre todo lo registrado, que es idempotente (las dos rutas de
 * muerte pueden dispararlo a la vez), que un handler roto no impide los demás,
 * que un handler colgado no bloquea la salida, y que install() engancha las
 * señales y sale DESPUÉS de limpiar.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const { createShutdown } = require('../src/services/shutdown');

test('corre todas las limpiezas registradas', async () => {
  const done = [];
  const s = createShutdown();
  s.add('a', () => done.push('a'));
  s.add('b', async () => { done.push('b'); });

  assert.strictEqual(s.size, 2);
  assert.strictEqual(await s.run('test'), true);
  assert.deepStrictEqual(done.sort(), ['a', 'b']);
});

test('es idempotente: la segunda llamada no repite las limpiezas', async () => {
  let calls = 0;
  const s = createShutdown();
  s.add('once', () => { calls++; });

  assert.strictEqual(await s.run('señal'), true);
  assert.strictEqual(await s.run('exit-del-hijo'), false, 'la segunda no debe ejecutar');
  assert.strictEqual(calls, 1);
});

test('un handler que lanza no impide a los demás, y se loguea', async () => {
  const done = [];
  const logs = [];
  const s = createShutdown({ log: (m) => logs.push(m) });
  s.add('roto', () => { throw new Error('boom'); });
  s.add('sano', () => done.push('sano'));

  await s.run('test');

  assert.deepStrictEqual(done, ['sano']);
  assert.ok(logs.some((l) => l.includes('roto') && l.includes('boom')), `sin log del fallo: ${logs.join(' | ')}`);
});

test('un handler colgado no bloquea la salida (presupuesto de timeout)', async () => {
  const logs = [];
  const s = createShutdown({ log: (m) => logs.push(m), timeoutMs: 100 });
  // Nunca resuelve: simula un send() a un socket que ya no contesta.
  s.add('colgado', () => new Promise(() => {}));

  const started = process.hrtime.bigint();
  await s.run('test');
  const elapsedMs = Number((process.hrtime.bigint() - started) / 1000000n);

  assert.ok(elapsedMs < 1000, `tardó ${elapsedMs}ms: no respetó el presupuesto`);
  assert.ok(logs.some((l) => l.includes('timeout')), 'no avisó del timeout');
});

test('install() engancha las señales y sale con 0 DESPUÉS de limpiar', async () => {
  const order = [];
  const hooks = new Map();
  const s = createShutdown({
    on:   (event, handler) => hooks.set(event, handler),
    exit: (code) => order.push(`exit:${code}`),
  });
  s.add('limpieza', () => { order.push('limpieza'); });

  assert.strictEqual(s.install(), true);
  assert.deepStrictEqual([...hooks.keys()], ['SIGINT', 'SIGTERM']);

  hooks.get('SIGTERM')();
  await new Promise((r) => setImmediate(r));   // deja correr el then del run()

  assert.deepStrictEqual(order, ['limpieza', 'exit:0'], 'el exit tiene que ir después de limpiar');
});

test('sin seams de process, install() no engancha nada (y no lanza)', () => {
  const s = createShutdown();
  assert.strictEqual(s.install(), false);
});

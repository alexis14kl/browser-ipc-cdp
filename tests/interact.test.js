/**
 * Tests de los tools de interacción por texto y navegación tolerante.
 * Mockean el `caller` (CDP one-shot): no tocan navegador real. Verifican el
 * contrato token-efficient: buscar+clickear en pocas llamadas, salida mínima,
 * y que navigate NO lance en falso al vencer el timeout (soft-success).
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { createInteractTools } = require('../src/tools/interact');

/** Caller mock: registra llamadas y responde por método (valor o función(params, idxDelMetodo)). */
function mockCaller(handlers = {}) {
  const calls = [];
  return {
    calls,
    async call(method, params) {
      calls.push({ method, params });
      const h = handlers[method];
      const idx = calls.filter((c) => c.method === method).length - 1;
      return typeof h === 'function' ? h(params, idx) : (h ?? {});
    },
  };
}

const byName = (caller) => Object.fromEntries(createInteractTools({ caller }).map((t) => [t.name, t]));

test('find_by_text: devuelve las coincidencias compactas de un solo Runtime.evaluate', async () => {
  const matches = [{ text: 'Guardar', tag: 'button', x: 100, y: 200, id: 'save' }];
  const caller = mockCaller({
    'Runtime.evaluate': { result: { value: JSON.stringify(matches) } },
  });
  const out = await byName(caller).find_by_text.handler({ text: 'Guardar' });

  assert.strictEqual(caller.calls.length, 1, 'una sola llamada CDP (barato)');
  assert.strictEqual(caller.calls[0].method, 'Runtime.evaluate');
  assert.deepStrictEqual(JSON.parse(out[0].text), matches);
});

test('find_by_text: sin coincidencias → mensaje corto, no array vacío ruidoso', async () => {
  const caller = mockCaller({ 'Runtime.evaluate': { result: { value: '[]' } } });
  const out = await byName(caller).find_by_text.handler({ text: 'nada' });
  assert.match(out[0].text, /Sin coincidencias/);
});

test('click_by_text: encuentra y clickea con Input en las coords del centro (una pasada)', async () => {
  const caller = mockCaller({
    'Runtime.evaluate': { result: { value: JSON.stringify({ found: true, count: 1, x: 233, y: 144, text: 'Perfil', tag: 'button' }) } },
    'Input.dispatchMouseEvent': {},
  });
  const out = await byName(caller).click_by_text.handler({ text: 'Perfil' });

  const inputs = caller.calls.filter((c) => c.method === 'Input.dispatchMouseEvent');
  assert.deepStrictEqual(inputs.map((c) => c.params.type), ['mouseMoved', 'mousePressed', 'mouseReleased']);
  for (const c of inputs) {
    assert.strictEqual(c.params.x, 233);
    assert.strictEqual(c.params.y, 144);
  }
  assert.match(out[0].text, /Click en "Perfil" \(button\) @ \(233,144\)/);
});

test('click_by_text: sin coincidencia → NO dispara ningún Input', async () => {
  const caller = mockCaller({
    'Runtime.evaluate': { result: { value: JSON.stringify({ found: false, count: 0 }) } },
  });
  const out = await byName(caller).click_by_text.handler({ text: 'fantasma' });

  assert.strictEqual(caller.calls.filter((c) => c.method === 'Input.dispatchMouseEvent').length, 0);
  assert.match(out[0].text, /Sin coincidencias/);
});

test('navigate: resuelve al alcanzar el readyState objetivo', async () => {
  const states = ['loading', 'complete'];
  const caller = mockCaller({
    'Page.navigate': {},
    'Runtime.evaluate': (_p, idx) => ({ result: { value: states[idx] ?? 'complete' } }),
  });
  const out = await byName(caller).navigate.handler({ url: 'https://x.test', waitUntil: 'complete', timeoutMs: 5000 });

  assert.strictEqual(caller.calls[0].method, 'Page.navigate');
  assert.match(out[0].text, /Navegado a https:\/\/x\.test \(readyState: complete\)/);
});

test('navigate: soft-success al vencer el timeout (NO lanza, falso negativo evitado)', async () => {
  const caller = mockCaller({
    'Page.navigate': {},
    'Runtime.evaluate': { result: { value: 'loading' } }, // nunca llega a interactive
  });
  const out = await byName(caller).navigate.handler({ url: 'https://slow.test', timeoutMs: 400 });

  assert.match(out[0].text, /sin error/);
  assert.match(out[0].text, /readyState "loading"/);
});

test('navigate: propaga el error real de Page.navigate (URL inválida)', async () => {
  const caller = mockCaller({ 'Page.navigate': { errorText: 'net::ERR_ABORTED' } });
  const out = await byName(caller).navigate.handler({ url: 'http://nope' });

  assert.match(out[0].text, /Navegación falló: net::ERR_ABORTED/);
  assert.strictEqual(caller.calls.filter((c) => c.method === 'Runtime.evaluate').length, 0, 'no hace polling si la navegación falló');
});

test('fill_by_label: modo simple (label+value) → un Runtime.evaluate y resumen compacto', async () => {
  const caller = mockCaller({
    'Runtime.evaluate': { result: { value: JSON.stringify([{ label: 'Cédula', ok: true, field: 'text' }]) } },
  });
  const out = await byName(caller).fill_by_label.handler({ label: 'Cédula', value: '123' });

  assert.strictEqual(caller.calls.length, 1, 'un solo round-trip');
  assert.match(out[0].text, /Rellenados 1\/1: Cédula✓/);
});

test('fill_by_label: modo lote → un formulario entero en una llamada, marca los fallos', async () => {
  const results = [
    { label: 'Nombre', ok: true, field: 'text' },
    { label: 'Cédula', ok: true, field: 'text' },
    { label: 'Correo', ok: false, reason: 'no encontrado' },
  ];
  const caller = mockCaller({ 'Runtime.evaluate': { result: { value: JSON.stringify(results) } } });
  const out = await byName(caller).fill_by_label.handler({
    fields: [
      { label: 'Nombre', value: 'Ana' },
      { label: 'Cédula', value: '123' },
      { label: 'Correo', value: 'ana@x.com' },
    ],
  });

  assert.strictEqual(caller.calls.length, 1, 'los 3 campos en UN solo Runtime.evaluate');
  assert.match(out[0].text, /Rellenados 2\/3/);
  assert.match(out[0].text, /Correo✗\(no encontrado\)/);
});

test('fill_by_label: sin label ni fields → mensaje claro, no toca CDP', async () => {
  const caller = mockCaller({});
  const out = await byName(caller).fill_by_label.handler({});

  assert.strictEqual(caller.calls.length, 0);
  assert.match(out[0].text, /falta/);
});

'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { createCdpCaller } = require('../src/tools/_cdp-caller');

// pickActivePage es puro: dada la lista de pestañas sondeadas, elige la ACTIVA
// (visible/enfocada), no la primera del /json. Este era el bug: click_by_text
// pegaba en la primer pestaña en vez de la seleccionada.
const { pickActivePage } = createCdpCaller({ browserUrl: 'http://127.0.0.1:9333' });

test('elige la pestaña visible aunque no sea la primera', () => {
  const chosen = pickActivePage([
    { page: 'bg1', visible: false, focused: false },
    { page: 'activa', visible: true, focused: false },
    { page: 'bg2', visible: false, focused: false },
  ]);
  assert.strictEqual(chosen, 'activa');
});

test('con varias visibles, desempata por foco de ventana', () => {
  const chosen = pickActivePage([
    { page: 'ventanaA', visible: true, focused: false },
    { page: 'ventanaB', visible: true, focused: true },
  ]);
  assert.strictEqual(chosen, 'ventanaB');
});

test('si ninguna reporta visible (ventana minimizada/sin foco), cae a la primera', () => {
  const chosen = pickActivePage([
    { page: 'p0', visible: false, focused: false },
    { page: 'p1', visible: false, focused: false },
  ]);
  assert.strictEqual(chosen, 'p0');
});

test('lista vacía → null', () => {
  assert.strictEqual(pickActivePage([]), null);
});

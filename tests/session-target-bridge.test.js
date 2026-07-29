'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { SessionTargetBridge } = require('../src/services/session-target-bridge');

test('resuelve sessionId_cliente → sessionId_overlay vía targetId compartido', () => {
  const b = new SessionTargetBridge();
  b.linkOverlay('OV1', 'T1');   // overlay atacha su sesión a la pestaña T1
  b.linkClient('CL1', 'T1');    // el cliente atacha su sesión a la MISMA pestaña
  assert.strictEqual(b.resolveOverlaySession('CL1'), 'OV1');
});

test('devuelve null si no hay vínculo cliente o overlay', () => {
  const b = new SessionTargetBridge();
  assert.strictEqual(b.resolveOverlaySession('desconocida'), null);
  b.linkClient('CL1', 'T1');    // cliente sí, pero overlay aún no
  assert.strictEqual(b.resolveOverlaySession('CL1'), null);
  assert.strictEqual(b.resolveOverlaySession(undefined), null);
});

test('dos pestañas se resuelven a su propia sesión-overlay (no se cruzan)', () => {
  const b = new SessionTargetBridge();
  b.linkOverlay('OV_A', 'TA'); b.linkClient('CL_A', 'TA');
  b.linkOverlay('OV_B', 'TB'); b.linkClient('CL_B', 'TB');
  assert.strictEqual(b.resolveOverlaySession('CL_A'), 'OV_A');
  assert.strictEqual(b.resolveOverlaySession('CL_B'), 'OV_B');
});

test('unlinkClient corta la resolución de esa sesión', () => {
  const b = new SessionTargetBridge();
  b.linkOverlay('OV1', 'T1'); b.linkClient('CL1', 'T1');
  b.unlinkClient('CL1');
  assert.strictEqual(b.resolveOverlaySession('CL1'), null);
});

test('unlinkOverlay no pisa un re-attach posterior al mismo target', () => {
  const b = new SessionTargetBridge();
  b.linkOverlay('OV_OLD', 'T1');
  b.linkOverlay('OV_NEW', 'T1');   // re-attach: T1 ahora apunta a OV_NEW
  b.unlinkOverlay('OV_OLD');       // soltar la vieja NO debe borrar el índice de T1
  b.linkClient('CL1', 'T1');
  assert.strictEqual(b.resolveOverlaySession('CL1'), 'OV_NEW');
});

test('clearOverlay olvida el lado overlay pero conserva el lado cliente', () => {
  const b = new SessionTargetBridge();
  b.linkClient('CL1', 'T1');
  b.linkOverlay('OV1', 'T1');
  b.clearOverlay();
  assert.strictEqual(b.resolveOverlaySession('CL1'), null, 'sin overlay no resuelve');
  b.linkOverlay('OV2', 'T1');  // el cliente seguía vinculado a T1 → reconecta y resuelve ya
  assert.strictEqual(b.resolveOverlaySession('CL1'), 'OV2');
});

test('link ignora argumentos vacíos (defensivo)', () => {
  const b = new SessionTargetBridge();
  b.linkOverlay('', 'T1'); b.linkOverlay('OV1', '');
  b.linkClient('', 'T1'); b.linkClient('CL1', '');
  assert.strictEqual(b.resolveOverlaySession('CL1'), null);
});

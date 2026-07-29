'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { createWsFrameDecoder, createInputTap, createTargetTap, pageTargetIdFromUrl } = require('../src/services/ws-tap');

// Construye un frame WS de texto server→client (SIN máscara), como los eventos
// que el navegador manda al cliente (Target.attachedToTarget, etc.).
function unmaskedTextFrame(str) {
  const payload = Buffer.from(str, 'utf8');
  const len = payload.length;
  let header;
  if (len < 126) header = Buffer.from([0x81, len]);
  else if (len < 65536) { header = Buffer.alloc(4); header[0] = 0x81; header[1] = 126; header.writeUInt16BE(len, 2); }
  else { header = Buffer.alloc(10); header[0] = 0x81; header[1] = 127; header.writeBigUInt64BE(BigInt(len), 2); }
  return Buffer.concat([header, payload]);
}

// Construye un frame WS de texto client→server (siempre enmascarado).
function maskedTextFrame(str, maskKey = Buffer.from([0x12, 0x34, 0x56, 0x78])) {
  const payload = Buffer.from(str, 'utf8');
  const len = payload.length;
  let header;
  if (len < 126) {
    header = Buffer.from([0x81, 0x80 | len]);
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81; header[1] = 0x80 | 126; header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81; header[1] = 0x80 | 127; header.writeBigUInt64BE(BigInt(len), 2);
  }
  const masked = Buffer.allocUnsafe(len);
  for (let i = 0; i < len; i++) masked[i] = payload[i] ^ maskKey[i & 3];
  return Buffer.concat([header, maskKey, masked]);
}

test('decodifica un frame de texto enmascarado', () => {
  const got = [];
  const feed = createWsFrameDecoder((t) => got.push(t));
  feed(maskedTextFrame('hola mundo'));
  assert.deepStrictEqual(got, ['hola mundo']);
});

test('reensambla un frame partido entre varios chunks TCP', () => {
  const got = [];
  const feed = createWsFrameDecoder((t) => got.push(t));
  const frame = maskedTextFrame('{"id":1,"method":"Input.dispatchMouseEvent"}');
  feed(frame.subarray(0, 3));
  feed(frame.subarray(3, 9));
  assert.deepStrictEqual(got, [], 'aún incompleto: no emite');
  feed(frame.subarray(9));
  assert.strictEqual(got.length, 1);
});

test('procesa dos frames pegados en un solo chunk', () => {
  const got = [];
  const feed = createWsFrameDecoder((t) => got.push(t));
  feed(Buffer.concat([maskedTextFrame('uno'), maskedTextFrame('dos')]));
  assert.deepStrictEqual(got, ['uno', 'dos']);
});

test('usa payload de 16 bits (len 126) correctamente', () => {
  const got = [];
  const feed = createWsFrameDecoder((t) => got.push(t));
  const big = 'x'.repeat(500);
  feed(maskedTextFrame(big));
  assert.deepStrictEqual(got, [big]);
});

test('createInputTap emite solo los Input.dispatchMouseEvent con coords y adjunta el sessionId', () => {
  const evts = [];
  const feed = createInputTap((e) => evts.push(e));
  feed(maskedTextFrame(JSON.stringify({ id: 5, sessionId: 'S1', method: 'Runtime.evaluate', params: {} })));
  feed(maskedTextFrame(JSON.stringify({ id: 6, sessionId: 'S1', method: 'Input.dispatchMouseEvent', params: { type: 'mousePressed', x: 120, y: 340, button: 'left' } })));
  feed(maskedTextFrame(JSON.stringify({ id: 7, method: 'Input.dispatchKeyEvent', params: { type: 'keyDown' } })));
  assert.deepStrictEqual(evts, [{ type: 'mousePressed', x: 120, y: 340, button: 'left', sessionId: 'S1' }]);
});

test('createTargetTap emite el vínculo sesión↔target solo para targets page', () => {
  const attaches = [];
  const detaches = [];
  const feed = createTargetTap({ onAttach: (l) => attaches.push(l), onDetach: (l) => detaches.push(l) });
  // page → se emite
  feed(unmaskedTextFrame(JSON.stringify({ method: 'Target.attachedToTarget', params: { sessionId: 'CS1', targetInfo: { type: 'page', targetId: 'T1' } } })));
  // iframe/worker → se ignora
  feed(unmaskedTextFrame(JSON.stringify({ method: 'Target.attachedToTarget', params: { sessionId: 'CS2', targetInfo: { type: 'iframe', targetId: 'T2' } } })));
  // detach
  feed(unmaskedTextFrame(JSON.stringify({ method: 'Target.detachedFromTarget', params: { sessionId: 'CS1' } })));
  assert.deepStrictEqual(attaches, [{ sessionId: 'CS1', targetId: 'T1' }]);
  assert.deepStrictEqual(detaches, [{ sessionId: 'CS1' }]);
});

test('createTargetTap ignora frames que no son eventos de Target', () => {
  const attaches = [];
  const feed = createTargetTap({ onAttach: (l) => attaches.push(l) });
  feed(unmaskedTextFrame(JSON.stringify({ id: 9, result: {} })));
  assert.deepStrictEqual(attaches, []);
});

test('pageTargetIdFromUrl extrae el targetId del endpoint de página', () => {
  assert.strictEqual(pageTargetIdFromUrl('/devtools/page/ABC123'), 'ABC123');
  assert.strictEqual(pageTargetIdFromUrl('ws://127.0.0.1:9333/devtools/page/DEAD-BEEF?x=1'), 'DEAD-BEEF');
  assert.strictEqual(pageTargetIdFromUrl('/devtools/browser/xyz'), null, 'browser-level no es page');
  assert.strictEqual(pageTargetIdFromUrl(''), null);
  assert.strictEqual(pageTargetIdFromUrl(undefined), null);
});

test('createInputTap ignora un Input.dispatchMouseEvent sin coordenadas', () => {
  const evts = [];
  const feed = createInputTap((e) => evts.push(e));
  feed(maskedTextFrame(JSON.stringify({ method: 'Input.dispatchMouseEvent', params: { type: 'mouseMoved' } })));
  assert.deepStrictEqual(evts, []);
});

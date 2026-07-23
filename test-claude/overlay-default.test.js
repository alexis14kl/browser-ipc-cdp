/**
 * El overlay del cursor está ENCENDIDO por defecto (opt-out).
 * Verifica la lógica del flag tal cual la evalúa el launcher:
 *   sin var o cualquier valor ≠ '0'/'false' → ON;
 *   BROWSER_CDP_CURSOR='0' o 'false' → OFF.
 * ('false' se acepta porque el manifest del bundle mapea el toggle booleano
 *  user_config.cursor_overlay → 'true'/'false'.)
 * Así basta actualizar la versión para tenerlo, sin flag por config.
 */
const { test } = require('node:test');
const assert = require('node:assert');

// Misma expresión que usa brave_mcp_launcher.js para decidir.
const overlayEnabled = (envValue) => envValue !== '0' && envValue !== 'false';

test('overlay ON por defecto: sin la variable', () => {
  assert.strictEqual(overlayEnabled(undefined), true);
});

test('overlay ON con valores distintos de 0/false (1, "true", vacío)', () => {
  assert.strictEqual(overlayEnabled('1'), true);
  assert.strictEqual(overlayEnabled('true'), true);
  assert.strictEqual(overlayEnabled(''), true);
});

test('overlay OFF con BROWSER_CDP_CURSOR=0 (opt-out explícito)', () => {
  assert.strictEqual(overlayEnabled('0'), false);
});

test('overlay OFF con BROWSER_CDP_CURSOR=false (toggle del bundle)', () => {
  assert.strictEqual(overlayEnabled('false'), false);
});

test('el launcher usa la expresión opt-out (!== "0"), no opt-in', () => {
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'brave_mcp_launcher.js'), 'utf-8');
  // Sigue leyendo la variable y apagando con !== '0' (opt-out preservado)...
  assert.match(src, /BROWSER_CDP_CURSOR/, 'el launcher debe leer BROWSER_CDP_CURSOR');
  assert.match(src, /!==\s*'0'/, 'el launcher debe ser opt-out (!== "0")');
  // ...y además acepta 'false' (mapeo booleano del manifest)...
  assert.match(src, /!==\s*'false'/, "el launcher debe aceptar 'false' como OFF");
  // ...sin que reaparezca la lógica opt-in vieja.
  assert.doesNotMatch(src, /BROWSER_CDP_CURSOR\s*===\s*'1'/, 'no debe quedar la lógica opt-in vieja');
});

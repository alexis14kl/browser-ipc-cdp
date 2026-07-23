/**
 * ensurePage — auto-cura el navegador "vivo pero con 0 páginas" (zombi / ventana
 * cerrada en Mac). Simula los endpoints CDP /json/list y /json/new con un HTTP
 * server local y verifica: crea tab solo si faltan páginas.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const { listPages, ensurePage } = require('../src/services/cdp-service');

function startServer(handler) {
  return new Promise((resolve) => {
    const srv = http.createServer(handler);
    srv.listen(0, '127.0.0.1', () => resolve({ srv, port: srv.address().port }));
  });
}

test('listPages devuelve solo targets type=page', async () => {
  const { srv, port } = await startServer((req, res) => {
    if (req.url === '/json/list') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify([
        { type: 'page', url: 'https://a' },
        { type: 'service_worker', url: 'sw' },
        { type: 'page', url: 'https://b' },
      ]));
    } else { res.writeHead(404); res.end(); }
  });
  const pages = await listPages(`http://127.0.0.1:${port}`);
  srv.close();
  assert.strictEqual(pages.length, 2);
});

test('ensurePage NO crea tab si ya hay páginas', async () => {
  let newCalls = 0;
  const { srv, port } = await startServer((req, res) => {
    if (req.url === '/json/list') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify([{ type: 'page', url: 'https://a' }]));
    } else if (req.url.startsWith('/json/new')) {
      newCalls++; res.writeHead(200); res.end('{}');
    } else { res.writeHead(404); res.end(); }
  });
  const ok = await ensurePage(`http://127.0.0.1:${port}`);
  srv.close();
  assert.strictEqual(ok, true);
  assert.strictEqual(newCalls, 0, 'no debe crear pestaña si ya hay');
});

test('ensurePage crea tab (PUT /json/new) si hay 0 páginas', async () => {
  let putNew = 0;
  const { srv, port } = await startServer((req, res) => {
    if (req.url === '/json/list') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify([{ type: 'service_worker' }])); // 0 páginas type=page
    } else if (req.url.startsWith('/json/new')) {
      if (req.method === 'PUT') putNew++;
      res.writeHead(200); res.end('{}');
    } else { res.writeHead(404); res.end(); }
  });
  const ok = await ensurePage(`http://127.0.0.1:${port}`);
  srv.close();
  assert.strictEqual(ok, true);
  assert.strictEqual(putNew, 1, 'debe crear una pestaña con PUT /json/new');
});

test('ensurePage cae a GET /json/new si PUT no está soportado', async () => {
  let getNew = 0;
  const { srv, port } = await startServer((req, res) => {
    if (req.url === '/json/list') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify([]));
    } else if (req.url.startsWith('/json/new')) {
      if (req.method === 'PUT') { res.writeHead(405); res.end(); return; } // no soportado
      getNew++; res.writeHead(200); res.end('{}');
    } else { res.writeHead(404); res.end(); }
  });
  const ok = await ensurePage(`http://127.0.0.1:${port}`);
  srv.close();
  assert.strictEqual(ok, true);
  assert.strictEqual(getNew, 1, 'debe caer a GET cuando PUT da 405');
});

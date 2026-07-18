/**
 * Smoke tests del CLI (bin/cli.js) — solo los flags READ-ONLY, que no tocan
 * el sistema (no lanzan navegador, no escriben firewall/portproxy/.mcp.json).
 * Garantizan que la entrada delgada + CliController + logger inyectable
 * arrancan y responden como el bin/cli.js v2.3.x.
 */
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { spawn } = require('child_process');

const CLI = path.join(__dirname, '..', 'bin', 'cli.js');

function runCli(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI, ...args], { cwd: path.join(__dirname, '..') });
    let stdout = '', stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('exit', (code) => resolve({ code, stdout, stderr }));
    child.on('error', reject);
    setTimeout(() => { try { child.kill(); } catch {} reject(new Error('timeout CLI')); }, 20000);
  });
}

test('--list: exit 0, banner y encabezado de navegadores por stdout', async () => {
  const { code, stdout, stderr } = await runCli(['--list']);
  assert.strictEqual(code, 0, `stderr: ${stderr}`);
  assert.match(stdout, /browser-ipc-cdp/, 'banner ausente');
  assert.match(stdout, /Plataforma:/);
  assert.match(stdout, /Navegadores Chromium|No se encontraron/);
  assert.strictEqual(stderr.trim(), '', 'el CLI no debe escribir en stderr');
});

test('--status: exit 0, reporta sesión o su ausencia por stdout', async () => {
  const { code, stdout } = await runCli(['--status']);
  assert.strictEqual(code, 0);
  assert.match(stdout, /Puerto CDP:|No hay sesion CDP activa/);
});

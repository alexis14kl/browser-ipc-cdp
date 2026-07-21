/**
 * Tests unitarios de la capa src/platform/ (Fase 1 del refactor).
 * Parsers puros con fixtures — sin tocar el OS real.
 */
const { test } = require('node:test');
const assert = require('node:assert');

const { getPlatformId, getPlatformHelper } = require('../src/platform');
const posix = require('../src/platform/posix');
const win = require('../src/platform/win');
const { createLogger } = require('../src/views/logger');

test('parsePsOutput: extrae puertos explícitos, junta pids con port=0 y descarta renderers', () => {
  const fixture = [
    '  501 /Applications/Brave Browser.app/Contents/MacOS/Brave Browser --remote-debugging-port=0 --restore-last-session',
    '  502 /Applications/Brave Browser.app/... --type=renderer --remote-debugging-port=0',
    '  777 /usr/bin/google-chrome --remote-debugging-port=9222',
    '  888 /opt/brave --remote-debugging-port=54335 --profile-directory=Default',
    '  999 vim notas.txt',
  ].join('\n');
  const { explicitPorts, zeroPortPids } = posix.parsePsOutput(fixture);
  assert.deepStrictEqual([...explicitPorts].sort(), [54335, 9222].sort());
  assert.deepStrictEqual(zeroPortPids, [501], 'solo el proceso principal con port=0, sin el renderer');
});

test('parseLsofListenPorts: saca los puertos LISTEN', () => {
  const fixture = [
    'COMMAND   PID USER   FD   TYPE  DEVICE SIZE/OFF NODE NAME',
    'Brave   501 monkey  13u  IPv4  0xabc      0t0  TCP 127.0.0.1:50468 (LISTEN)',
    'Brave   501 monkey  14u  IPv4  0xdef      0t0  TCP 127.0.0.1:63210 (LISTEN)',
    'Brave   501 monkey  22u  IPv4  0x123      0t0  TCP 192.168.1.5:54001->142.250.0.1:443 (ESTABLISHED)',
  ].join('\n');
  assert.deepStrictEqual([...posix.parseLsofListenPorts(fixture)].sort(), [50468, 63210].sort());
});

test('parseTasklistCsv: extrae pids del CSV de tasklist', () => {
  const fixture = [
    '"brave.exe","4321","Console","1","215.204 KB"',
    '"brave.exe","8765","Console","1","98.120 KB"',
    'INFO: no hay tareas en ejecución que coincidan con los criterios.',
  ].join('\r\n');
  assert.deepStrictEqual([...win.parseTasklistCsv(fixture)].sort(), [4321, 8765].sort());
});

test('parseNetstatListeners: solo LISTENING de los pids dados y puertos válidos', () => {
  const fixture = [
    '  TCP    127.0.0.1:9222         0.0.0.0:0              LISTENING       4321',
    '  TCP    127.0.0.1:49731        0.0.0.0:0              LISTENING       4321',
    '  TCP    0.0.0.0:135            0.0.0.0:0              LISTENING       1000',
    '  TCP    127.0.0.1:50000        127.0.0.1:50001        ESTABLISHED     4321',
    '  UDP    0.0.0.0:5353           *:*                                    4321',
  ].join('\r\n');
  const ports = win.parseNetstatListeners(fixture, new Set([4321, 8765]));
  assert.deepStrictEqual([...ports].sort(), [49731, 9222].sort(), 'ignora otros pids, ESTABLISHED y UDP');
});

test('factory: getPlatformId válido y helper con el contrato completo', () => {
  const id = getPlatformId();
  assert.ok(['win32', 'darwin', 'linux', 'wsl'].includes(id));
  const helper = getPlatformHelper();
  assert.strictEqual(typeof helper.userDataDirs, 'function');
  assert.strictEqual(typeof helper.discoverCandidatePorts, 'function');
  assert.ok(helper.id, 'helper.id presente');
});

test('userDataDirs: incluye BROWSER_CDP_EXTRA_PROFILES leído al llamar (no al cargar)', () => {
  const helper = getPlatformHelper();
  const prev = process.env.BROWSER_CDP_EXTRA_PROFILES;
  process.env.BROWSER_CDP_EXTRA_PROFILES = '/tmp/perfil-uno;/tmp/perfil-dos';
  try {
    const dirs = helper.userDataDirs();
    const extras = dirs.filter((d) => d.name === 'env-extra').map((d) => d.path);
    assert.deepStrictEqual(extras, ['/tmp/perfil-uno', '/tmp/perfil-dos']);
    assert.ok(dirs.length > extras.length, 'también trae los perfiles nativos de la plataforma');
  } finally {
    if (prev === undefined) delete process.env.BROWSER_CDP_EXTRA_PROFILES;
    else process.env.BROWSER_CDP_EXTRA_PROFILES = prev;
  }
});

test('logger inyectable: escribe SOLO en el stream inyectado, con prefijo', () => {
  const lines = [];
  const fakeStream = { write: (s) => lines.push(s) };
  const logger = createLogger({ stream: fakeStream, prefix: '[test] ' });
  logger.log('hola');
  logger.warn('cuidado');
  logger.error('explotó');
  logger.success('listo');
  assert.deepStrictEqual(lines, [
    '[test] hola\n',
    '[test] [!] cuidado\n',
    '[test] [ERROR] explotó\n',
    '[test] [OK] listo\n',
  ]);
});

test('win.userDataDirs: BROWSER_CDP_EXTRA_PROFILES con ruta C:\\ NO se parte por el ":"', () => {
  const prev = process.env.BROWSER_CDP_EXTRA_PROFILES;
  process.env.BROWSER_CDP_EXTRA_PROFILES = 'C:\\Users\\x\\Temp\\perfil;D:\\otro\\perfil';
  try {
    const extras = win.userDataDirs().filter((d) => d.name === 'env-extra').map((d) => d.path);
    assert.deepStrictEqual(extras, ['C:\\Users\\x\\Temp\\perfil', 'D:\\otro\\perfil'],
      'las letras de unidad sobreviven; solo ; y , separan en win32');
  } finally {
    if (prev === undefined) delete process.env.BROWSER_CDP_EXTRA_PROFILES;
    else process.env.BROWSER_CDP_EXTRA_PROFILES = prev;
  }
});

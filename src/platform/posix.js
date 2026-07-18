/**
 * Discovery de procesos compartido por macOS y Linux: busca Chromium con
 * --remote-debugging-port en `ps`, y para port=0 (asignado por el OS) saca
 * los puertos LISTEN reales del proceso con `lsof`.
 *
 * Los parsers son funciones puras exportadas para testearlas con fixtures
 * sin tocar el OS. Comportamiento heredado 1:1 de discoverViaPosix() del
 * launcher v2.3.x (execFile asíncrono: corre on-demand desde el proxy y no
 * debe bloquear el event loop).
 */
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);
const EXEC_OPTS = { timeout: 8000, maxBuffer: 16 * 1024 * 1024 };

/**
 * Salida de `ps ax -o pid=,command=` → puertos explícitos y pids con port=0.
 * Ignora renderers (--type=): solo el proceso principal expone CDP.
 */
function parsePsOutput(out) {
  const explicitPorts = new Set();
  const zeroPortPids = [];
  for (const line of out.split('\n')) {
    const m = line.match(/--remote-debugging-port=(\d+)/);
    if (!m || /--type=/.test(line)) continue;
    const pid = parseInt(line.trim().split(/\s+/)[0], 10);
    const port = parseInt(m[1], 10);
    if (port > 0) explicitPorts.add(port);
    else if (Number.isFinite(pid)) zeroPortPids.push(pid);
  }
  return { explicitPorts, zeroPortPids };
}

/** Salida de `lsof -nP -a -p <pids> -iTCP -sTCP:LISTEN` → puertos LISTEN. */
function parseLsofListenPorts(out) {
  const ports = new Set();
  for (const line of out.split('\n')) {
    const m = line.match(/:(\d+) \(LISTEN\)/);
    if (m) ports.add(parseInt(m[1], 10));
  }
  return ports;
}

/**
 * @param {(msg: string) => void} log
 * @returns {Promise<Array<{label: string, ports: Set<number>}>>}
 */
async function discoverCandidatePorts(log = () => {}) {
  let out;
  try {
    ({ stdout: out } = await execFileAsync('ps', ['ax', '-o', 'pid=,command='], EXEC_OPTS));
  } catch (e) {
    log(`Discovery ps failed: ${e.message}`);
    return [];
  }

  const { explicitPorts, zeroPortPids } = parsePsOutput(out);
  const groups = [];
  if (explicitPorts.size) groups.push({ label: 'flag', ports: explicitPorts });

  if (zeroPortPids.length) {
    try {
      const { stdout } = await execFileAsync(
        'lsof', ['-nP', '-a', '-p', zeroPortPids.join(','), '-iTCP', '-sTCP:LISTEN'], EXEC_OPTS
      );
      const ports = parseLsofListenPorts(stdout);
      if (ports.size) groups.push({ label: 'lsof', ports });
    } catch {}
  }
  return groups;
}

module.exports = { parsePsOutput, parseLsofListenPorts, discoverCandidatePorts };

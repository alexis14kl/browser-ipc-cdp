/**
 * Windows: perfiles en LOCALAPPDATA/<vendor>/User Data, discovery via
 * tasklist + netstat. Parsers puros exportados para tests con fixtures.
 * Comportamiento heredado 1:1 de discoverViaNetstat() del launcher v2.3.x.
 */
const path = require('path');
const { execSync } = require('child_process');
const { HOME, commonUserDataDirs, withEnvExtraProfiles } = require('./base');

const LOCALAPPDATA = process.env.LOCALAPPDATA || path.join(HOME, 'AppData', 'Local');
const CHROMIUM_IMAGES = ['brave.exe', 'chrome.exe', 'msedge.exe', 'chromium.exe'];

function userDataDirs() {
  // Separador SIN ':' — partiría las rutas con letra de unidad (C:\...)
  return withEnvExtraProfiles([
    { name: 'brave', path: path.join(LOCALAPPDATA, 'BraveSoftware', 'Brave-Browser', 'User Data') },
    { name: 'chrome', path: path.join(LOCALAPPDATA, 'Google', 'Chrome', 'User Data') },
    { name: 'edge', path: path.join(LOCALAPPDATA, 'Microsoft', 'Edge', 'User Data') },
    { name: 'chromium', path: path.join(LOCALAPPDATA, 'Chromium', 'User Data') },
    ...commonUserDataDirs(),
  ], /[;,]/);
}

/** Salida CSV de `tasklist /FI "IMAGENAME eq x.exe" /FO CSV /NH` → pids. */
function parseTasklistCsv(out) {
  const pids = new Set();
  for (const line of out.split('\n')) {
    const parts = line.trim().split('","');
    if (parts.length >= 2) {
      const pid = parseInt(parts[1].replace(/"/g, ''), 10);
      if (Number.isFinite(pid) && pid > 0) pids.add(pid);
    }
  }
  return pids;
}

/** Salida de `netstat -ano` → puertos LISTENING de los pids dados. */
function parseNetstatListeners(out, pids) {
  const ports = new Set();
  for (const line of out.split('\n')) {
    const tokens = line.trim().split(/\s+/);
    if (tokens.length < 5 || tokens[0] !== 'TCP' || !tokens[3].includes('LISTENING')) continue;
    const pid = parseInt(tokens[4], 10);
    if (!pids.has(pid)) continue;
    const m = tokens[1].match(/:(\d+)$/);
    if (!m) continue;
    const port = parseInt(m[1], 10);
    if (port > 1024 && port < 65536) ports.add(port);
  }
  return ports;
}

async function discoverCandidatePorts(log = () => {}) {
  const pids = new Set();
  for (const img of CHROMIUM_IMAGES) {
    try {
      const out = execSync(
        `tasklist /FI "IMAGENAME eq ${img}" /FO CSV /NH`,
        { encoding: 'utf-8', timeout: 8000, maxBuffer: 16 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] }
      );
      for (const pid of parseTasklistCsv(out)) pids.add(pid);
    } catch {}
  }
  if (pids.size === 0) {
    log('Discovery: no Chromium processes');
    return [];
  }

  let netstatOut;
  try {
    netstatOut = execSync('netstat -ano', {
      encoding: 'utf-8', timeout: 20000, maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch (e) {
    log(`Discovery netstat failed: ${e.message}`);
    return [];
  }

  const ports = parseNetstatListeners(netstatOut, pids);
  log(`Discovery: ${ports.size} candidate ports across ${pids.size} processes`);
  return ports.size ? [{ label: 'netstat', ports }] : [];
}

module.exports = { id: 'win32', userDataDirs, discoverCandidatePorts, parseTasklistCsv, parseNetstatListeners };

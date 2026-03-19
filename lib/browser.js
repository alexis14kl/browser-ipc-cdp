const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { log, success, warn } = require('./logger');

const IS_WIN = process.platform === 'win32';
const IS_MAC = process.platform === 'darwin';
const HOME = process.env.HOME || process.env.USERPROFILE || '';
const LOCALAPPDATA = process.env.LOCALAPPDATA || '';
const PROGRAMFILES = process.env.PROGRAMFILES || 'C:\\Program Files';
const PROGRAMFILES86 = process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)';

// Rutas dinámicas por plataforma
const BROWSER_REGISTRY = {
  brave: {
    win: [
      path.join(PROGRAMFILES, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
      path.join(PROGRAMFILES86, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
      path.join(LOCALAPPDATA, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
    ],
    mac: [
      '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
      path.join(HOME, 'Applications', 'Brave Browser.app', 'Contents', 'MacOS', 'Brave Browser'),
    ],
    linux: [
      '/usr/bin/brave-browser',
      '/usr/bin/brave',
      '/snap/bin/brave',
      '/opt/brave.com/brave/brave-browser',
    ],
    userData: {
      win: path.join(LOCALAPPDATA, 'BraveSoftware', 'Brave-Browser', 'User Data'),
      mac: path.join(HOME, 'Library', 'Application Support', 'BraveSoftware', 'Brave-Browser'),
      linux: path.join(HOME, '.config', 'BraveSoftware', 'Brave-Browser'),
    },
    processName: { win: 'brave.exe', mac: 'Brave Browser', linux: 'brave' },
  },
  chrome: {
    win: [
      path.join(PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(PROGRAMFILES86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    ],
    mac: [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      path.join(HOME, 'Applications', 'Google Chrome.app', 'Contents', 'MacOS', 'Google Chrome'),
    ],
    linux: [
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
      '/snap/bin/chromium',
      '/usr/bin/chromium-browser',
      '/usr/bin/chromium',
    ],
    userData: {
      win: path.join(LOCALAPPDATA, 'Google', 'Chrome', 'User Data'),
      mac: path.join(HOME, 'Library', 'Application Support', 'Google', 'Chrome'),
      linux: path.join(HOME, '.config', 'google-chrome'),
    },
    processName: { win: 'chrome.exe', mac: 'Google Chrome', linux: 'chrome' },
  },
  edge: {
    win: [
      path.join(PROGRAMFILES86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      path.join(PROGRAMFILES, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    ],
    mac: [
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    ],
    linux: [
      '/usr/bin/microsoft-edge',
      '/usr/bin/microsoft-edge-stable',
    ],
    userData: {
      win: path.join(LOCALAPPDATA, 'Microsoft', 'Edge', 'User Data'),
      mac: path.join(HOME, 'Library', 'Application Support', 'Microsoft Edge'),
      linux: path.join(HOME, '.config', 'microsoft-edge'),
    },
    processName: { win: 'msedge.exe', mac: 'Microsoft Edge', linux: 'msedge' },
  },
  chromium: {
    win: [
      path.join(LOCALAPPDATA, 'Chromium', 'Application', 'chrome.exe'),
    ],
    mac: [
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
    ],
    linux: [
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
      '/snap/bin/chromium',
    ],
    userData: {
      win: path.join(LOCALAPPDATA, 'Chromium', 'User Data'),
      mac: path.join(HOME, 'Library', 'Application Support', 'Chromium'),
      linux: path.join(HOME, '.config', 'chromium'),
    },
    processName: { win: 'chrome.exe', mac: 'Chromium', linux: 'chromium' },
  },
};

function getPlatform() {
  if (IS_WIN) return 'win';
  if (IS_MAC) return 'mac';
  return 'linux';
}

function getBrowserPaths(name) {
  const entry = BROWSER_REGISTRY[name];
  if (!entry) return { paths: [], userData: '', processName: '' };
  const plat = getPlatform();
  return {
    paths: entry[plat] || [],
    userData: (entry.userData && entry.userData[plat]) || '',
    processName: (entry.processName && entry.processName[plat]) || name,
  };
}

function detectBrowsers() {
  const found = [];
  for (const name of Object.keys(BROWSER_REGISTRY)) {
    const { paths, userData } = getBrowserPaths(name);
    for (const p of paths) {
      if (fs.existsSync(p)) {
        found.push({ name, exe: p, userData });
        break;
      }
    }
  }
  // Fallback: buscar en PATH
  const cmds = IS_WIN
    ? ['brave', 'chrome', 'msedge']
    : ['brave-browser', 'brave', 'google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge'];
  for (const cmd of cmds) {
    try {
      const which = IS_WIN
        ? execSync(`where ${cmd} 2>nul`, { encoding: 'utf-8', timeout: 5000 }).trim().split('\n')[0]
        : execSync(`which ${cmd} 2>/dev/null`, { encoding: 'utf-8', timeout: 5000 }).trim();
      if (which && fs.existsSync(which) && !found.some(b => b.exe === which)) {
        found.push({ name: cmd, exe: which, userData: '' });
      }
    } catch (e) {}
  }
  return found;
}

function findBrowser(preferred) {
  const browsers = detectBrowsers();
  if (preferred) {
    return browsers.find(b => b.name === preferred.toLowerCase()) || null;
  }
  // Config guardada
  const configPath = path.join(__dirname, '..', 'browser_config.json');
  if (fs.existsSync(configPath)) {
    try {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      if (config.exe && fs.existsSync(config.exe)) {
        return config;
      }
    } catch (e) {}
  }
  // Primer navegador encontrado
  if (browsers.length > 0) {
    try {
      fs.writeFileSync(configPath, JSON.stringify(browsers[0], null, 2));
    } catch (e) {}
    return browsers[0];
  }
  return null;
}

function testCdp(port, timeout = 3000) {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${port}/json/version`, { timeout }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

function isBrowserRunning(exe) {
  const exeName = path.basename(exe);
  try {
    if (IS_WIN) {
      const result = execSync(
        `tasklist /FI "IMAGENAME eq ${exeName}" /FO CSV /NH`,
        { timeout: 10000, encoding: 'utf-8', stdio: 'pipe' }
      );
      return result.toLowerCase().includes(exeName.toLowerCase());
    } else {
      const result = execSync(`pgrep -f "${exeName}"`, { timeout: 5000, stdio: 'pipe' });
      return result.length > 0;
    }
  } catch (e) {
    return false;
  }
}

async function detectExistingCDP(browser) {
  if (!isBrowserRunning(browser.exe)) return null;

  // 1. DevToolsActivePort
  if (browser.userData) {
    const portFile = path.join(browser.userData, 'DevToolsActivePort');
    if (fs.existsSync(portFile)) {
      try {
        const lines = fs.readFileSync(portFile, 'utf-8').trim().split('\n');
        const port = parseInt(lines[0].trim());
        if (port > 0) {
          const result = await testCdp(port);
          if (result) return port;
        }
      } catch (e) {}
    }
  }

  // 2. Command line scan
  try {
    const exeName = path.basename(browser.exe);
    let cmdOutput = '';
    if (IS_WIN) {
      cmdOutput = execSync(
        `wmic process where "name='${exeName}'" get commandline /format:list`,
        { timeout: 10000, encoding: 'utf-8', stdio: 'pipe' }
      );
    } else {
      cmdOutput = execSync(
        `ps aux | grep "${exeName}" | grep -v grep`,
        { timeout: 10000, encoding: 'utf-8', stdio: 'pipe' }
      );
    }
    const match = cmdOutput.match(/--remote-debugging-port[=\s](\d{2,5})/);
    if (match) {
      const port = parseInt(match[1]);
      if (port > 0) {
        const cdp = await testCdp(port);
        if (cdp) return port;
      }
    }
  } catch (e) {}

  // 3. Scan ports
  try {
    const exeName = path.basename(browser.exe);
    const pids = new Set();

    if (IS_WIN) {
      const taskResult = execSync(
        `tasklist /FI "IMAGENAME eq ${exeName}" /FO CSV /NH`,
        { timeout: 10000, encoding: 'utf-8', stdio: 'pipe' }
      );
      taskResult.split('\n').forEach(line => {
        const parts = line.trim().replace(/"/g, '').split(',');
        if (parts.length >= 2) {
          const pid = parseInt(parts[1]);
          if (!isNaN(pid)) pids.add(pid);
        }
      });
    } else {
      const pgrepResult = execSync(`pgrep -f "${exeName}"`,
        { timeout: 5000, encoding: 'utf-8', stdio: 'pipe' });
      pgrepResult.trim().split('\n').forEach(p => {
        const pid = parseInt(p.trim());
        if (!isNaN(pid)) pids.add(pid);
      });
    }

    if (pids.size > 0) {
      if (IS_WIN) {
        const netstat = execSync('netstat -ano -p tcp', { timeout: 10000, encoding: 'utf-8', stdio: 'pipe' });
        for (const line of netstat.split('\n')) {
          const tokens = line.trim().split(/\s+/);
          if (tokens.length >= 5 && tokens[3] === 'LISTENING') {
            const pid = parseInt(tokens[4]);
            if (pids.has(pid)) {
              const portStr = tokens[1].split(':').pop();
              const port = parseInt(portStr);
              if (port > 1024) {
                const cdp = await testCdp(port);
                if (cdp) return port;
              }
            }
          }
        }
      } else {
        // Mac/Linux: use lsof or ss
        for (const pid of pids) {
          try {
            const lsof = execSync(`lsof -i -P -n -p ${pid} 2>/dev/null | grep LISTEN`,
              { timeout: 10000, encoding: 'utf-8', stdio: 'pipe' });
            for (const line of lsof.split('\n')) {
              const match = line.match(/:(\d+)\s/);
              if (match) {
                const port = parseInt(match[1]);
                if (port > 1024) {
                  const cdp = await testCdp(port);
                  if (cdp) return port;
                }
              }
            }
          } catch (e) {}
        }
      }
    }
  } catch (e) {}

  return null;
}

function killBrowser(exe) {
  const exeName = path.basename(exe);
  try {
    if (IS_WIN) {
      execSync(`taskkill /F /IM ${exeName}`, { timeout: 10000, stdio: 'pipe' });
    } else {
      execSync(`pkill -f "${exeName}"`, { timeout: 10000, stdio: 'pipe' });
    }
  } catch (e) {}
}

function launchBrowser(browser, { port = 0, clean = false } = {}) {
  return new Promise((resolve, reject) => {
    killBrowser(browser.exe);

    // Wait for process to die
    setTimeout(() => {
      const userData = clean
        ? path.join(process.env.USERPROFILE || '', 'browser-cdp-profile')
        : browser.userData;

      // Clean DevToolsActivePort
      const portFile = path.join(userData, 'DevToolsActivePort');
      try { if (fs.existsSync(portFile)) fs.unlinkSync(portFile); } catch (e) {}

      const args = [
        `--remote-debugging-port=${port}`,
        '--remote-allow-origins=*',
        '--disable-backgrounding-occluded-windows',
      ];
      if (clean) args.push(`--user-data-dir=${userData}`);

      const spawnOpts = { detached: true, stdio: 'ignore' };
      // En Mac, si el exe es un .app, necesita 'open' como wrapper
      let cmd = browser.exe;
      let spawnArgs = args;
      if (IS_MAC && browser.exe.includes('.app/')) {
        // Ejecutar directo el binario dentro del .app
      }
      const child = spawn(cmd, spawnArgs, spawnOpts);
      child.unref();

      log(`        PID: ${child.pid}`);
      log(`        Perfil: ${clean ? 'LIMPIO' : 'REAL (tus datos)'}`);

      // Wait for DevToolsActivePort
      if (port === 0) {
        const deadline = Date.now() + 30000;
        const check = () => {
          if (Date.now() > deadline) {
            return reject(new Error('Timeout esperando DevToolsActivePort'));
          }
          if (fs.existsSync(portFile)) {
            try {
              const lines = fs.readFileSync(portFile, 'utf-8').trim().split('\n');
              const detected = parseInt(lines[0].trim());
              if (detected > 0) {
                return resolve({ port: detected, pid: child.pid });
              }
            } catch (e) {}
          }
          setTimeout(check, 500);
        };
        check();
      } else {
        // Fixed port: wait for CDP
        const deadline = Date.now() + 30000;
        const check = async () => {
          if (Date.now() > deadline) {
            return reject(new Error(`Timeout esperando CDP en puerto ${port}`));
          }
          const result = await testCdp(port);
          if (result) return resolve({ port, pid: child.pid });
          setTimeout(check, 500);
        };
        check();
      }
    }, 2000);
  });
}

module.exports = { detectBrowsers, findBrowser, detectExistingCDP, launchBrowser, testCdp };

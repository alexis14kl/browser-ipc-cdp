const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { log, success, warn } = require('./logger');

const IS_WIN = process.platform === 'win32';
const IS_MAC = process.platform === 'darwin';

// Detectar WSL: Linux pero con acceso a Windows
function isWSL() {
  if (IS_WIN || IS_MAC) return false;
  try {
    const version = fs.readFileSync('/proc/version', 'utf-8').toLowerCase();
    if (version.includes('microsoft') || version.includes('wsl')) return true;
  } catch (e) {}
  try {
    return fs.existsSync('/proc/sys/fs/binfmt_misc/WSLInterop');
  } catch (e) {}
  return false;
}

const IS_WSL = isWSL();
const HOME = process.env.HOME || process.env.USERPROFILE || '';

// En WSL: obtener paths de Windows via /mnt/c/
function getWindowsEnv(varName) {
  if (IS_WIN) return process.env[varName] || '';
  if (IS_WSL) {
    try {
      const result = execSync(`cmd.exe /c echo %${varName}%`, { encoding: 'utf-8', timeout: 5000, stdio: 'pipe' });
      const winPath = result.trim();
      if (winPath && !winPath.includes('%')) {
        // Convertir C:\Users\... a /mnt/c/Users/...
        return winPath.replace(/\\/g, '/').replace(/^([A-Za-z]):/, (_, d) => `/mnt/${d.toLowerCase()}`);
      }
    } catch (e) {}
  }
  return '';
}

const LOCALAPPDATA = IS_WIN ? (process.env.LOCALAPPDATA || '') : getWindowsEnv('LOCALAPPDATA');
const USERPROFILE = IS_WIN ? (process.env.USERPROFILE || '') : getWindowsEnv('USERPROFILE');

// Program Files: en WSL usar /mnt/c/
const PROGRAMFILES = IS_WIN ? (process.env.PROGRAMFILES || 'C:\\Program Files')
  : IS_WSL ? '/mnt/c/Program Files' : '';
const PROGRAMFILES86 = IS_WIN ? (process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)')
  : IS_WSL ? '/mnt/c/Program Files (x86)' : '';

// Rutas dinámicas por plataforma
const BROWSER_REGISTRY = {
  brave: {
    win: [
      path.join(PROGRAMFILES, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
      path.join(PROGRAMFILES86, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
      path.join(LOCALAPPDATA, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
    ],
    wsl: [
      path.join(PROGRAMFILES, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
      path.join(PROGRAMFILES86, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
      ...(LOCALAPPDATA ? [path.join(LOCALAPPDATA, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe')] : []),
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
      wsl: LOCALAPPDATA ? path.join(LOCALAPPDATA, 'BraveSoftware', 'Brave-Browser', 'User Data') : '',
      mac: path.join(HOME, 'Library', 'Application Support', 'BraveSoftware', 'Brave-Browser'),
      linux: path.join(HOME, '.config', 'BraveSoftware', 'Brave-Browser'),
    },
    processName: { win: 'brave.exe', wsl: 'brave.exe', mac: 'Brave Browser', linux: 'brave' },
  },
  chrome: {
    win: [
      path.join(PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(PROGRAMFILES86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    ],
    wsl: [
      path.join(PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(PROGRAMFILES86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      ...(LOCALAPPDATA ? [path.join(LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe')] : []),
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
      wsl: LOCALAPPDATA ? path.join(LOCALAPPDATA, 'Google', 'Chrome', 'User Data') : '',
      mac: path.join(HOME, 'Library', 'Application Support', 'Google', 'Chrome'),
      linux: path.join(HOME, '.config', 'google-chrome'),
    },
    processName: { win: 'chrome.exe', wsl: 'chrome.exe', mac: 'Google Chrome', linux: 'chrome' },
  },
  edge: {
    win: [
      path.join(PROGRAMFILES86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      path.join(PROGRAMFILES, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    ],
    wsl: [
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
      wsl: LOCALAPPDATA ? path.join(LOCALAPPDATA, 'Microsoft', 'Edge', 'User Data') : '',
      mac: path.join(HOME, 'Library', 'Application Support', 'Microsoft Edge'),
      linux: path.join(HOME, '.config', 'microsoft-edge'),
    },
    processName: { win: 'msedge.exe', wsl: 'msedge.exe', mac: 'Microsoft Edge', linux: 'msedge' },
  },
  chromium: {
    win: [
      path.join(LOCALAPPDATA, 'Chromium', 'Application', 'chrome.exe'),
    ],
    wsl: [
      ...(LOCALAPPDATA ? [path.join(LOCALAPPDATA, 'Chromium', 'Application', 'chrome.exe')] : []),
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
      wsl: LOCALAPPDATA ? path.join(LOCALAPPDATA, 'Chromium', 'User Data') : '',
      mac: path.join(HOME, 'Library', 'Application Support', 'Chromium'),
      linux: path.join(HOME, '.config', 'chromium'),
    },
    processName: { win: 'chrome.exe', wsl: 'chrome.exe', mac: 'Chromium', linux: 'chromium' },
  },
};

function getPlatform() {
  if (IS_WIN) return 'win';
  if (IS_WSL) return 'wsl';
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
    if (IS_WIN || IS_WSL) {
      // Windows y WSL: usar tasklist de Windows
      const cmd = IS_WSL
        ? `cmd.exe /c tasklist /FI "IMAGENAME eq ${exeName}" /FO CSV /NH`
        : `tasklist /FI "IMAGENAME eq ${exeName}" /FO CSV /NH`;
      const result = execSync(cmd, { timeout: 10000, encoding: 'utf-8', stdio: 'pipe' });
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
    if (IS_WIN || IS_WSL) {
      const wmicCmd = `wmic process where "name='${exeName}'" get commandline /format:list`;
      cmdOutput = IS_WSL
        ? execSync(`cmd.exe /c ${wmicCmd}`, { timeout: 10000, encoding: 'utf-8', stdio: 'pipe' })
        : execSync(wmicCmd, { timeout: 10000, encoding: 'utf-8', stdio: 'pipe' });
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

    if (IS_WIN || IS_WSL) {
      const taskCmd = `tasklist /FI "IMAGENAME eq ${exeName}" /FO CSV /NH`;
      const taskResult = IS_WSL
        ? execSync(`cmd.exe /c ${taskCmd}`, { timeout: 10000, encoding: 'utf-8', stdio: 'pipe' })
        : execSync(taskCmd, { timeout: 10000, encoding: 'utf-8', stdio: 'pipe' });
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
      if (IS_WIN || IS_WSL) {
        const netstatCmd = 'netstat -ano -p tcp';
        const netstat = IS_WSL
          ? execSync(`cmd.exe /c ${netstatCmd}`, { timeout: 10000, encoding: 'utf-8', stdio: 'pipe' })
          : execSync(netstatCmd, { timeout: 10000, encoding: 'utf-8', stdio: 'pipe' });
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
    } else if (IS_WSL) {
      execSync(`cmd.exe /c taskkill /F /IM ${exeName}`, { timeout: 10000, stdio: 'pipe' });
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
      let child;

      if (IS_WSL) {
        // WSL: convertir ruta /mnt/c/... a C:\... y lanzar via cmd.exe
        const winExe = browser.exe.replace(/^\/mnt\/([a-z])\//, (_, d) => `${d.toUpperCase()}:\\`).replace(/\//g, '\\');
        const winArgs = args.map(a => {
          if (a.startsWith('--user-data-dir=/mnt/')) {
            return a.replace(/^--user-data-dir=\/mnt\/([a-z])\//, (_, d) => `--user-data-dir=${d.toUpperCase()}:\\`).replace(/\//g, '\\');
          }
          return a;
        });
        child = spawn('cmd.exe', ['/c', 'start', '', winExe, ...winArgs], spawnOpts);
      } else {
        child = spawn(browser.exe, args, spawnOpts);
      }
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

module.exports = { detectBrowsers, findBrowser, detectExistingCDP, launchBrowser, testCdp, IS_WSL, IS_WIN, IS_MAC };

const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { log, success, warn } = require('./logger');

const BROWSER_PATHS = {
  brave: [
    'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
    'C:\\Program Files (x86)\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
    path.join(process.env.LOCALAPPDATA || '', 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
  ],
  chrome: [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
  ],
  edge: [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  ],
};

const BROWSER_USER_DATA = {
  brave: path.join(process.env.LOCALAPPDATA || '', 'BraveSoftware', 'Brave-Browser', 'User Data'),
  chrome: path.join(process.env.LOCALAPPDATA || '', 'Google', 'Chrome', 'User Data'),
  edge: path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'Edge', 'User Data'),
};

function detectBrowsers() {
  const found = [];
  for (const [name, paths] of Object.entries(BROWSER_PATHS)) {
    for (const p of paths) {
      if (fs.existsSync(p)) {
        found.push({
          name,
          exe: p,
          userData: BROWSER_USER_DATA[name] || '',
        });
        break;
      }
    }
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
  const exeName = path.basename(exe).toLowerCase();
  try {
    const result = execSync(
      `tasklist /FI "IMAGENAME eq ${exeName}" /FO CSV /NH`,
      { timeout: 10000, encoding: 'utf-8' }
    );
    return result.toLowerCase().includes(exeName);
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

  // 2. Command line
  try {
    const exeName = path.basename(browser.exe).toLowerCase();
    const result = execSync(
      `wmic process where "name='${exeName}'" get commandline /format:list`,
      { timeout: 10000, encoding: 'utf-8' }
    );
    const match = result.match(/--remote-debugging-port[=\s](\d{2,5})/);
    if (match) {
      const port = parseInt(match[1]);
      if (port > 0) {
        const cdp = await testCdp(port);
        if (cdp) return port;
      }
    }
  } catch (e) {}

  // 3. Scan ports via netstat
  try {
    const exeName = path.basename(browser.exe).toLowerCase();
    const taskResult = execSync(
      `tasklist /FI "IMAGENAME eq ${exeName}" /FO CSV /NH`,
      { timeout: 10000, encoding: 'utf-8' }
    );
    const pids = new Set();
    taskResult.split('\n').forEach(line => {
      const parts = line.trim().replace(/"/g, '').split(',');
      if (parts.length >= 2) {
        const pid = parseInt(parts[1]);
        if (!isNaN(pid)) pids.add(pid);
      }
    });

    if (pids.size > 0) {
      const netstat = execSync('netstat -ano -p tcp', { timeout: 10000, encoding: 'utf-8' });
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
    }
  } catch (e) {}

  return null;
}

function killBrowser(exe) {
  const exeName = path.basename(exe);
  try {
    execSync(`taskkill /F /IM ${exeName}`, { timeout: 10000, stdio: 'pipe' });
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

      const child = spawn(browser.exe, args, {
        detached: true,
        stdio: 'ignore',
      });
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

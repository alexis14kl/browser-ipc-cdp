const banner = () => {
  console.log('');
  console.log('  browser-ipc-cdp');
  console.log('  Control remoto de navegadores Chromium via IPC + CDP');
  console.log('');
};

const log = (msg) => console.log(`  ${msg}`);
const success = (msg) => console.log(`  [OK] ${msg}`);
const warn = (msg) => console.log(`  [!] ${msg}`);
const error = (msg) => console.error(`  [ERROR] ${msg}`);

module.exports = { banner, log, success, warn, error };

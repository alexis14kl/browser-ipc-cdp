const fs = require('fs');
const path = require('path');

const CDP_INFO_PATH = path.join(process.env.USERPROFILE || process.env.HOME || '.', 'cdp_info.json');

function saveCdpInfo(data) {
  // Guardar en home y en directorio actual
  const paths = [
    CDP_INFO_PATH,
    path.join(process.cwd(), 'cdp_info.json'),
  ];
  for (const p of paths) {
    try {
      fs.writeFileSync(p, JSON.stringify(data, null, 2));
    } catch (e) {}
  }
}

function loadCdpInfo() {
  const paths = [
    path.join(process.cwd(), 'cdp_info.json'),
    CDP_INFO_PATH,
  ];
  for (const p of paths) {
    try {
      if (fs.existsSync(p)) {
        return JSON.parse(fs.readFileSync(p, 'utf-8'));
      }
    } catch (e) {}
  }
  return null;
}

module.exports = { saveCdpInfo, loadCdpInfo };

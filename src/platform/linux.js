/** Linux: perfiles en XDG_CONFIG_HOME (~/.config), discovery via ps+lsof. */
const path = require('path');
const { HOME, commonUserDataDirs, withEnvExtraProfiles } = require('./base');
const { discoverCandidatePorts } = require('./posix');

function userDataDirs() {
  const CONFIG = process.env.XDG_CONFIG_HOME || path.join(HOME, '.config');
  return withEnvExtraProfiles([
    { name: 'brave-linux', path: path.join(CONFIG, 'BraveSoftware', 'Brave-Browser') },
    { name: 'chrome-linux', path: path.join(CONFIG, 'google-chrome') },
    { name: 'edge-linux', path: path.join(CONFIG, 'microsoft-edge') },
    { name: 'chromium-linux', path: path.join(CONFIG, 'chromium') },
    ...commonUserDataDirs(),
  ]);
}

module.exports = { id: 'linux', userDataDirs, discoverCandidatePorts };

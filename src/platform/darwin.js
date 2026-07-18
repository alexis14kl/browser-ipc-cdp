/** macOS: perfiles en ~/Library/Application Support, discovery via ps+lsof. */
const path = require('path');
const { HOME, commonUserDataDirs, withEnvExtraProfiles } = require('./base');
const { discoverCandidatePorts } = require('./posix');

const APPSUP = path.join(HOME, 'Library', 'Application Support');

function userDataDirs() {
  return withEnvExtraProfiles([
    { name: 'brave-mac', path: path.join(APPSUP, 'BraveSoftware', 'Brave-Browser') },
    { name: 'chrome-mac', path: path.join(APPSUP, 'Google', 'Chrome') },
    { name: 'edge-mac', path: path.join(APPSUP, 'Microsoft Edge') },
    { name: 'chromium-mac', path: path.join(APPSUP, 'Chromium') },
    ...commonUserDataDirs(),
  ]);
}

module.exports = { id: 'darwin', userDataDirs, discoverCandidatePorts };

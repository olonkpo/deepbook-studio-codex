'use strict';

const path = require('node:path');
const { rebuild } = require('@electron/rebuild');

// electron-builder only discovers native dependencies in its application root.
// Our Express server has its own package, so rebuild it explicitly for each
// target before packaging. The installed desktop runtime is Electron's Node.
module.exports = async ({ appDir, electronVersion, arch }) => {
  await rebuild({
    buildPath: path.join(appDir, 'backend'),
    electronVersion,
    arch,
    force: true,
    onlyModules: ['better-sqlite3'],
  });
  return false;
};

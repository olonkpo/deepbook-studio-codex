'use strict';

const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

async function main() {
  const appPath = process.argv[2];
  if (!appPath) throw new Error('Usage: node scripts/smoke-packaged.cjs path/to/packaged-app');
  const isMac = process.platform === 'darwin';
  const executable = isMac ? path.join(appPath, 'Contents', 'MacOS', 'DeepBook Studio')
    : path.join(appPath, process.platform === 'win32' ? 'DeepBook Studio.exe' : 'deepbook-studio');
  const resources = isMac ? path.join(appPath, 'Contents', 'Resources') : path.join(appPath, 'resources');
  const serverPath = path.join(resources, 'app.asar', 'backend', 'server.js');
  const dataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'deepbook-packaged-test-'));
  const child = spawn(executable, [serverPath], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', NODE_ENV: 'production', APPDATA_PATH: dataPath, PORT: '0' },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  let logs = '';
  child.stdout.on('data', chunk => { logs += chunk; });
  child.stderr.on('data', chunk => { logs += chunk; });
  try {
    const port = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Packaged backend startup timed out.\n' + logs)), 20000);
      child.once('error', err => { clearTimeout(timeout); reject(err); });
      child.once('exit', code => { clearTimeout(timeout); reject(new Error(`Packaged backend exited (${code}).\n${logs}`)); });
      child.on('message', message => {
        if (message.type === 'ready') { clearTimeout(timeout); resolve(message.port); }
      });
    });
    const base = `http://127.0.0.1:${port}`;
    const health = await (await fetch(base + '/api/health')).json();
    if (health.status !== 'ok') throw new Error('Health check failed.');
    const workspaces = await (await fetch(base + '/api/workspaces')).json();
    if (!Array.isArray(workspaces) || !workspaces.length) throw new Error('Packaged SQLite database could not be read: ' + JSON.stringify(workspaces) + '\n' + logs);
    const html = await (await fetch(base)).text();
    if (!html.includes('DeepBook Studio')) throw new Error('Packaged frontend is missing.');
    console.log('Packaged Electron runtime, SQLite, HTTP API and frontend passed.');
  } finally {
    const exited = new Promise(resolve => child.once('close', resolve));
    if (child.exitCode === null) {
      child.kill();
      await exited;
    }
    await fs.rm(dataPath, { recursive: true, force: true });
  }
}

main().catch(err => { console.error(err); process.exitCode = 1; });

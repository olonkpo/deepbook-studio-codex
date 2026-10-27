/**
* electron/main.js
* Electron main process — creates the app window and spawns the backend server.
*/

const { app, BrowserWindow, shell, dialog } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const http = require('http');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const isDev = process.argv.includes('--dev');
let backendPort = process.env.PORT || 3001;

let mainWindow = null;
let backendProcess = null;

// ── Spawn the backend Express server ─────────────────────────────────────────
function startBackend() {
  const backendPath = path.join(__dirname, '..', 'backend', 'server.js');
  return new Promise((resolve, reject) => {
    // Use the runtime shipped inside the app. No external Node/PATH dependency.
    backendProcess = spawn(process.execPath, [backendPath], {
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        NODE_ENV: 'production',
        PORT: '0',
        DEFAULT_AI_PROVIDER: process.env.DEFAULT_AI_PROVIDER || 'codex',
      },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      windowsHide: true,
    });
    const timeout = setTimeout(() => reject(new Error('Backend startup timed out.')), 20000);
    backendProcess.stdout.on('data', data => console.log(data.toString().trim()));
    backendProcess.stderr.on('data', data => console.error(data.toString().trim()));
    backendProcess.once('error', err => { clearTimeout(timeout); reject(err); });
    backendProcess.once('exit', code => {
      clearTimeout(timeout);
      reject(new Error(`Backend exited before startup (code ${code}).`));
    });
    backendProcess.on('message', message => {
      if (message.type === 'ready' && Number.isInteger(message.port) && message.port > 0) {
        backendPort = message.port;
        clearTimeout(timeout);
        resolve();
      }
    });
  });
}

// ── Wait for backend to be ready, then open the window ───────────────────────
function waitForBackend(retries = 20, delay = 500) {
  return new Promise((resolve, reject) => {
    function attempt(remaining) {
      const request = http.get(`http://127.0.0.1:${backendPort}/api/health`, res => {
        res.resume();
        if (res.statusCode === 200) {
          resolve();
        } else {
          retry(remaining);
        }
      }).on('error', () => retry(remaining));
      request.setTimeout(2000, () => request.destroy(new Error('Health request timed out.')));
    }

    function retry(remaining) {
      if (remaining <= 0) {
        reject(new Error('Backend did not start in time'));
        return;
      }
      setTimeout(() => attempt(remaining - 1), delay);
    }

    attempt(retries);
  });
}

// ── Create the main browser window ───────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'DeepBook Studio',
    backgroundColor: '#1a1a2e',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, // Security: isolate renderer from Node.js
      nodeIntegration: false, // Security: no Node.js in renderer
      sandbox: true, // Safe with contextIsolation: true (Electron 20+)
    },
  });

  // Load the frontend
  mainWindow.loadURL(`http://127.0.0.1:${backendPort}`);

  // Open external links in the default browser, not Electron
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  // Hot-reload in development
  if (isDev) {
    try {
      require('electron-reload')(__dirname, {
        electron: path.join(__dirname, '..', 'node_modules', '.bin', 'electron'),
        hardResetMethod: 'exit',
      });
    } catch {
      // electron-reload not installed — skip
    }
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ── App lifecycle ─────────────────────────────────────────────────────────────
app.whenReady().then(async () => {
  // Set native app menu
  const { buildMenu } = require('./menu');
  buildMenu();

  // Pass Electron's user-data path to the backend so SQLite lands in the right folder
  process.env.APPDATA_PATH = app.getPath('userData');

  // Start backend then open window
  // npm run dev already starts the backend with Node. Spawning another server
  // here races for the same port (and can use a different database path).
  try {
    if (isDev) await waitForBackend();
    else await startBackend();
    createWindow();
  } catch (err) {
    console.error('[Electron] Could not connect to backend:', err.message);
    dialog.showErrorBox('DeepBook Studio could not start', err.message);
    app.quit();
  }

  app.on('activate', () => {
    // macOS: re-create window when dock icon is clicked with no windows open
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// Quit when all windows are closed (except on macOS)
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// Clean up backend process on quit
app.on('will-quit', () => {
  if (backendProcess) {
    backendProcess.kill();
    backendProcess = null;
    console.log('[Electron] Backend process terminated.');
  }
});

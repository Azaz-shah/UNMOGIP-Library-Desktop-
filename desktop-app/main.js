const { app, BrowserWindow, dialog } = require('electron');
const path = require('path');
const { pathToFileURL } = require('url');

const PORT = 5000;

let mainWindow = null;
let backendHandle = null;

// Only one instance should run (it owns localhost:5000)
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(launchApp);
}

async function launchApp() {
  try {
    // ---- start the local Express + SQLite backend ----
    const userData = app.getPath('userData');
    const dbPath = path.join(userData, 'library.sqlite');
    const frontendDist = path.join(__dirname, 'frontend');

    // Load .env from userData folder so email settings survive app updates
    const envPath = path.join(userData, '.env');
    require('dotenv').config({ path: envPath });
    // Also try the backend folder (dev mode)
    require('dotenv').config({ path: path.join(__dirname, 'backend', '.env') });

    const serverModule = await import(
      pathToFileURL(path.join(__dirname, 'backend', 'server.js')).href
    );
    backendHandle = await serverModule.startServer({
      port: PORT,
      dbPath,
      frontendDist,
      quiet: true,
    });
    console.log(`UNMOGIP Library backend ready on http://localhost:${PORT}`);

    createWindow();
    setupSilentAutoUpdates();
  } catch (err) {
    if (err && err.code === 'EADDRINUSE') {
      dialog.showErrorBox(
        'Port 5000 is in use',
        'Another application is already using port 5000 (required by UNMOGIP Library).\n\n' +
          'Please close that application and start UNMOGIP Library again.'
      );
    } else {
      dialog.showErrorBox(
        'UNMOGIP Library could not start',
        (err && err.stack) || String(err)
      );
    }
    app.quit();
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1380,
    height: 880,
    minWidth: 1024,
    minHeight: 700,
    title: 'UNMOGIP Library Management System',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadURL(`http://localhost:${PORT}`);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Silent auto-updates (Step 6 of the conversion plan).
// Dormant until "build.publish" points at a real GitHub repo — see package.json.
function setupSilentAutoUpdates() {
  if (!app.isPackaged) return;
  try {
    const { autoUpdater } = require('electron-updater');
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    // No dialogs, no listeners: updates download silently and install on quit.
    autoUpdater.checkForUpdates().catch(() => {
      /* repo not configured / offline — stay quiet */
    });
  } catch (err) {
    console.warn('Auto-update disabled:', err.message);
  }
}

app.on('window-all-closed', () => {
  app.quit();
});

app.on('before-quit', () => {
  try {
    if (backendHandle && backendHandle.server) backendHandle.server.close();
  } catch (err) {
    /* ignore */
  }
});

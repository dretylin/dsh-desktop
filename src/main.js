'use strict';

const { app, BrowserWindow, Menu, ipcMain, shell, net } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const fs = require('node:fs');
const os = require('node:os');
const { spawn, spawnSync } = require('node:child_process');

// The DeepSeek Harness Web GUI. Override with the DSH_URL environment variable
// if your harness runs on a different port/host.
const HARNESS_URL = process.env.DSH_URL || 'http://127.0.0.1:3080';
const APP_NAME = 'DeepSeek Harness';
const OVERLAY_SOURCE = fs.readFileSync(path.join(__dirname, 'overlay.js'), 'utf8');

let mainWindow = null;
// Which bundled fallback page is on screen: 'start' | 'error' | null (the GUI).
let fallbackPage = null;

// --smoke: load the app, print which page loaded, then exit (used for CI checks).
const isSmokeTest = process.argv.includes('--smoke');

// ---------------------------------------------------------------------------
// Local dsh web server management
// ---------------------------------------------------------------------------

const server = {
  state: 'stopped', // stopped | starting | running | error
  managed: false,   // true when this app spawned the process
  pid: null,
  child: null,
  error: null,
  detail: null,     // last lines of child output, for diagnostics
};

/** Quick reachability probe against the harness root. */
function probeServer(timeoutMs = 2500) {
  return net
    .fetch(HARNESS_URL, { method: 'GET', signal: AbortSignal.timeout(timeoutMs) })
    .then((res) => res.ok)
    .catch(() => false);
}

function serverState() {
  return {
    state: server.state,
    managed: server.managed,
    pid: server.pid,
    error: server.error,
    detail: server.detail,
    url: HARNESS_URL,
  };
}

/**
 * Directory of the Node.js runtime shipped inside the installer (extraResources
 * → resources/node), or null when running from a tree where it was never
 * fetched. In development it lives in vendor/ (see scripts/fetch-node.js).
 */
function bundledNodeDir() {
  const dir = app.isPackaged
    ? path.join(process.resourcesPath, 'node')
    : path.join(__dirname, '..', 'vendor', 'node');
  return fs.existsSync(path.join(dir, 'npx.cmd')) ? dir : null;
}

/**
 * Resolve the full path of npx.cmd. The bundled runtime wins: shipping it is
 * what lets the app work on a machine with no Node installed, and pinning it
 * keeps every user on the same version. Falls back to PATH, then bare `npx`.
 */
function resolveNpx() {
  const bundled = bundledNodeDir();
  if (bundled) return path.join(bundled, 'npx.cmd');
  try {
    const r = spawnSync('where.exe', ['npx.cmd'], { encoding: 'utf8', windowsHide: true });
    if (r.status === 0 && r.stdout) {
      const first = r.stdout.split(/\r?\n/)[0].trim();
      if (first) return first;
    }
  } catch {}
  return 'npx';
}

let startInFlight = null;

/**
 * Spawn `npx --yes @deepseek-ai/dsh web` and wait until the server answers.
 * Resolves with the server state once it is terminal (running / error /
 * stopped) or after a startup timeout — used by the launch flow to decide
 * whether to show the GUI, keep waiting, or switch to the error page.
 *
 * Concurrent callers share one run: the reachability probe below takes up to
 * a few seconds, and without this a second call (the Settings "start" button
 * pressed while the launch flow is still probing) would spawn a second server
 * whose pid overwrites the first — leaving an orphan process behind on quit.
 */
function startServer() {
  if (startInFlight) return startInFlight;
  startInFlight = runStartServer().finally(() => {
    startInFlight = null;
  });
  return startInFlight;
}

async function runStartServer() {
  // Set synchronously (before the first await) so a caller that reports the
  // state right after calling us shows "starting" instead of "stopped".
  if (server.state !== 'running') server.state = 'starting';

  if (await probeServer()) {
    server.state = 'running';
    server.managed = false;
    server.pid = null;
    return serverState();
  }
  if (server.child) return serverState(); // already starting

  server.state = 'starting';
  server.managed = true;
  server.error = null;
  server.detail = null;

  const dshHome = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
  // Ensure the working directory exists (a missing cwd makes spawn fail with ENOENT).
  try {
    fs.mkdirSync(dshHome, { recursive: true });
  } catch {}
  const npx = resolveNpx();
  const comSpec = process.env.ComSpec || 'cmd.exe';
  // Pass the path unquoted. spawn() runs without a shell, so it already quotes
  // arguments containing spaces, and `cmd /c` preserves those quotes when they
  // wrap an existing executable. Quoting here as well produces
  // `cmd /c "\"C:\Program Files\nodejs\npx.cmd\""`, which cmd cannot parse —
  // that broke auto-start for every default Node install on Windows.
  const env = { ...process.env, DSH_HOME: dshHome };
  // Put the bundled runtime first on PATH so everything the harness spawns in
  // turn (node, npm) resolves to it too, not just the npx shim we invoke here.
  // Windows env keys keep their original case, so overwrite the existing key
  // rather than adding a second one that differs only in case.
  const nodeDir = bundledNodeDir();
  if (nodeDir) {
    const pathKey = Object.keys(env).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH';
    env[pathKey] = `${nodeDir};${env[pathKey] ?? ''}`;
  }
  const child = spawn(comSpec, ['/c', npx, '--yes', '@deepseek-ai/dsh', 'web'], {
    cwd: dshHome,
    env,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.child = child;
  server.pid = child.pid;

  let output = '';
  const push = (chunk) => {
    output = (output + String(chunk)).slice(-4000);
  };
  child.stdout.on('data', push);
  child.stderr.on('data', push);
  child.on('error', (err) => {
    server.state = 'error';
    server.error = err.message;
  });
  child.on('exit', async (code, signal) => {
    server.child = null;
    const lines = output.trim().split(/\r?\n/).slice(-8).join('\n');
    if (lines) server.detail = lines;
    // If the port is already served by another process, our spawn exits with a
    // conflict — treat that as "running" (external) rather than an error.
    const reachable = await probeServer(1500);
    if (reachable) {
      server.state = 'running';
      server.managed = false;
      server.pid = null;
      return;
    }
    if (server.state !== 'stopped') {
      server.state = 'error';
      server.error = `dsh web 进程已退出 (code=${code ?? signal ?? 'unknown'})`;
    }
  });

  // Resolve when the state turns terminal (the exit handler flips it to
  // error, the probe below flips it to running) or after the timeout.
  return new Promise((resolve) => {
    const deadline = Date.now() + 90000;
    const tick = async () => {
      if (['running', 'error', 'stopped'].includes(server.state) || Date.now() >= deadline) {
        resolve(serverState());
        return;
      }
      if (await probeServer(1500)) {
        server.state = 'running';
        resolve(serverState());
        return;
      }
      setTimeout(tick, 1000);
    };
    setTimeout(tick, 0);
  });
}

/** Kill the process tree we spawned (only if we manage it). */
function stopServer() {
  if (server.child && server.pid) {
    try {
      // stdio: 'ignore' so the kill works even when spawned with piped-stdio
      // restrictions (sandboxed environments); we don't need its output.
      spawnSync('taskkill', ['/PID', String(server.pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore',
      });
    } catch {}
    server.child = null;
  }
  server.state = 'stopped';
  server.managed = false;
  server.pid = null;
  return serverState();
}

// ---------------------------------------------------------------------------
// Persisted app settings (userData/settings.json)
// ---------------------------------------------------------------------------

function configPath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

let config = { autoStartServer: true };

function loadConfig() {
  try {
    // Strip a UTF-8 BOM if present (some editors write one; JSON.parse rejects it).
    const raw = fs.readFileSync(configPath(), 'utf8').replace(/^\uFEFF/, '');
    config = { ...config, ...JSON.parse(raw) };
  } catch {}
}

function saveConfig() {
  try {
    fs.mkdirSync(path.dirname(configPath()), { recursive: true });
    fs.writeFileSync(configPath(), JSON.stringify(config, null, 2));
  } catch {}
}

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------

const gotTheLock =
  isSmokeTest || process.argv.includes('--smoke-flow') || app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    app.setAppUserModelId('com.dsh.desktop');
    loadConfig();
    registerIpcHandlers();
    createWindow();
    if (process.platform === 'darwin') {
      buildMenu();
    } else {
      // No menu bar in the window (Windows/Linux); the keyboard shortcuts
      // formerly owned by the menu are registered in createWindow() instead.
      Menu.setApplicationMenu(null);
    }

    app.on('activate', () => {
      // macOS: re-create the window when the dock icon is clicked.
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  // Always stop a server we spawned when the app exits.
  app.on('will-quit', () => {
    stopServer();
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 680,
    title: APP_NAME,
    backgroundColor: '#0f1115',
    autoHideMenuBar: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  // Open target=_blank / window.open links in the system browser, never in-app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  // Stay on the harness origin; navigate anywhere else in the system browser.
  // Only our own bundled pages are allowed over file: — the preload bridge is
  // active on every page, so arbitrary local files must not be loadable.
  const bundledPages = new Set(
    ['start.html', 'error.html'].map((f) => pathToFileURL(path.join(__dirname, f)).href.toLowerCase())
  );
  mainWindow.webContents.on('will-navigate', (event, url) => {
    try {
      const target = new URL(url);
      if (target.protocol === 'file:') {
        // loadFile appends a query string; compare the document part only.
        // (file: URLs have origin "null", so href minus query/hash is the key.)
        const doc = target.href.split(/[?#]/)[0].toLowerCase();
        if (bundledPages.has(doc)) return;
        event.preventDefault();
        return;
      }
      const base = new URL(HARNESS_URL);
      if (target.origin !== base.origin) {
        event.preventDefault();
        shell.openExternal(url);
      }
    } catch {
      event.preventDefault();
    }
  });

  // Backup for mid-session failures (e.g. harness restarted while app is open).
  // Skipped only when the error page is already up, so we don't reload it under
  // the user; a failure while the "starting" screen shows must still surface.
  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    if (isMainFrame && fallbackPage !== 'error' && errorCode !== -3 /* ERR_ABORTED */) {
      showUnreachable(errorDescription || `加载失败 (${errorCode})`);
    }
  });

  mainWindow.webContents.on('did-finish-load', () => {
    const loadedURL = mainWindow.webContents.getURL();
    // Only an http(s) page is the harness GUI; file: pages are our own
    // start/error screens, which must keep their fallbackPage marker and must
    // not get the settings overlay (it would poll the server every 2s there).
    const isHarnessPage = /^https?:/.test(loadedURL);
    if (isHarnessPage) fallbackPage = null;
    const run = () =>
      isHarnessPage || isSmokeTest
        ? mainWindow.webContents.executeJavaScript(OVERLAY_SOURCE).catch(() => {})
        : Promise.resolve();
    if (isSmokeTest) {
      console.log('[smoke] loaded:', mainWindow.webContents.getURL());
      console.log('[smoke] userData:', app.getPath('userData'));
      console.log('[smoke] config:', JSON.stringify(config));
      try {
        console.log('[smoke] raw config:', JSON.stringify(fs.readFileSync(configPath(), 'utf8')));
      } catch (e) {
        console.log('[smoke] raw config error:', e.message);
      }
      console.log('[smoke] applicationMenu:', Menu.getApplicationMenu() ? 'present' : 'null');
      console.log('[smoke] bundled node:', bundledNodeDir() ?? 'none');
      console.log('[smoke] npx:', resolveNpx());
      run()
        .then(() => mainWindow.webContents.executeJavaScript('window.__dshOverlay === true'))
        .then((injected) => {
          console.log('[smoke] overlay injected:', injected);
          setTimeout(() => app.quit(), 600);
        })
        .catch((err) => {
          console.log('[smoke] overlay error:', String(err));
          app.quit();
        });
    } else if (process.argv.includes('--smoke-flow')) {
      // Flow test: print every page the window loads; quit once a real (http)
      // page appears — used to verify the starting-screen → GUI transition.
      const url = mainWindow.webContents.getURL();
      console.log('[flow] loaded:', url);
      if (url.startsWith('http://')) setTimeout(() => app.quit(), 800);
    } else {
      run();
    }
  });

  // Keyboard shortcuts that used to live in the application menu, now that
  // the menu bar is removed: Ctrl+R reload, Ctrl+0/-/+ zoom, F11 fullscreen,
  // Ctrl+Shift+I devtools.
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    const mod = input.control || input.meta;
    const key = String(input.key).toLowerCase();
    if (mod && key === 'r') {
      mainWindow.webContents.reload();
      event.preventDefault();
    } else if (mod && key === '0') {
      mainWindow.webContents.setZoomLevel(0);
      event.preventDefault();
    } else if (mod && (key === '-' || key === '_')) {
      mainWindow.webContents.setZoomLevel(mainWindow.webContents.getZoomLevel() - 0.5);
      event.preventDefault();
    } else if (mod && (key === '+' || key === '=')) {
      mainWindow.webContents.setZoomLevel(mainWindow.webContents.getZoomLevel() + 0.5);
      event.preventDefault();
    } else if (mod && input.shift && key === 'i') {
      mainWindow.webContents.toggleDevTools();
      event.preventDefault();
    } else if (input.key === 'F11') {
      mainWindow.setFullScreen(!mainWindow.isFullScreen());
      event.preventDefault();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Probe first: load the GUI when the harness answers; otherwise show the
  // "starting" screen while the server boots (auto-started here), and only
  // fall back to the error page when startup actually fails.
  (async () => {
    const ok = await probeServer();
    if (!mainWindow) return;
    if (ok) {
      mainWindow.loadURL(HARNESS_URL).catch(() => {});
      return;
    }
    if (!config.autoStartServer) {
      showUnreachable('DeepSeek Harness 服务未运行（自动启动已关闭）');
      return;
    }
    showStarting();
    const st = await startServer();
    if (!mainWindow) return;
    if (st.state === 'running') {
      mainWindow.loadURL(HARNESS_URL).catch(() => {});
    } else {
      showUnreachable(
        st.error ||
          (st.state === 'starting' ? '服务启动超时，请检查 dsh web 是否正常' : '服务启动失败')
      );
    }
  })();
}

function showStarting() {
  fallbackPage = 'start';
  mainWindow.loadFile(path.join(__dirname, 'start.html'), {
    query: { url: HARNESS_URL },
  });
}

function showUnreachable(detail) {
  fallbackPage = 'error';
  mainWindow.loadFile(path.join(__dirname, 'error.html'), {
    query: { url: HARNESS_URL, error: detail || '' },
  });
}

function registerIpcHandlers() {
  ipcMain.handle('dsh:status', async () => {
    const ok = await probeServer();
    return { ok, url: HARNESS_URL };
  });

  ipcMain.handle('dsh:retry', async () => {
    const ok = await probeServer();
    if (ok && mainWindow) {
      fallbackPage = null;
      await mainWindow.loadURL(HARNESS_URL);
      return { ok: true };
    }
    return { ok: false, url: HARNESS_URL };
  });

  ipcMain.handle('dsh:open-external', (_event, url) => {
    if (typeof url === 'string' && /^https?:\/\//.test(url)) shell.openExternal(url);
  });

  ipcMain.handle('app:version', () => app.getVersion());

  ipcMain.handle('server:status', async () => {
    const ok = await probeServer();
    if (ok) {
      server.state = 'running';
      server.error = null;
    } else if (server.state === 'running') {
      server.state = server.managed ? 'error' : 'stopped';
      if (server.managed) server.error = '服务已停止响应';
    }
    return serverState();
  });

  ipcMain.handle('server:start', () => {
    // Fire and forget; the status poll reports progress. startServer() marks the
    // state 'starting' synchronously, so the state returned here is never a
    // stale 'stopped' (which made the UI look like the click did nothing).
    startServer();
    return serverState();
  });
  ipcMain.handle('server:stop', () => stopServer());

  ipcMain.handle('config:get', () => ({ ...config }));
  ipcMain.handle('config:set', (_event, patch) => {
    config = { ...config, ...patch };
    saveConfig();
    return { ...config };
  });
}

function buildMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: '文件',
      submenu: [
        { label: '重新加载', accelerator: 'CmdOrCtrl+R', click: () => mainWindow?.webContents.reload() },
        { type: 'separator' },
        { role: 'quit', label: '退出' },
      ],
    },
    {
      label: '视图',
      submenu: [
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { role: 'resetZoom', label: '实际大小' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '全屏' },
        { role: 'toggleDevTools', label: '开发者工具' },
      ],
    },
    {
      label: '帮助',
      submenu: [
        { label: '在浏览器中打开 Harness', click: () => shell.openExternal(HARNESS_URL) },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

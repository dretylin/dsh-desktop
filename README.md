# DeepSeek Harness Desktop

[English](README.md) | [中文](README.zh-CN.md)

An Electron-based Windows desktop app that opens the DeepSeek Harness Web GUI
(default `http://127.0.0.1:3080`).

## System Requirements (read before installing)

### Runtime environment (end users)

| Item | Requirement |
|---|---|
| OS | Windows 10 / Windows 11, **64-bit (x64) only**. 32-bit is not supported; ARM64 is untested |
| Memory | 4 GB or more recommended (the Electron UI and the local Harness service run at the same time) |
| Disk space | Installer ~108 MB, ~360 MB once installed (includes the bundled Node.js runtime). The first launch additionally downloads Harness dependencies to the user cache via npx (~250 MB). Reserve **600 MB or more** in total |
| Node.js | **Not required.** The app bundles a Node.js 22 LTS runtime (v22.23.2) and prefers its `npx` when auto-starting the service; it only falls back to the system `npx` on PATH if the bundled runtime is missing |
| Port | `127.0.0.1:3080` by default. Auto-start requires this port to be free; if another process already serves it, the app treats it as an externally running service and connects directly (no error) |
| Network | The first auto-start needs internet to download `@deepseek-ai/dsh` and its dependencies through the bundled npx; afterwards the app works offline |
| First launch | The first launch downloads the Harness packages — the app waits up to 90 seconds (shown by the "Starting…" animation); subsequent launches are much faster |

> The installer is not code-signed (Authenticode); Windows SmartScreen may warn
> about an "unknown publisher" — choose **Run anyway**.

### Environment variables (optional)

| Variable | Default | Description |
|---|---|---|
| `DSH_URL` | `http://127.0.0.1:3080` | Harness Web GUI address (set this when the service runs on another host/port) |
| `DSH_HOME` | `%USERPROFILE%\.dsh` | Harness data/config directory; also the working directory of the service process |

### Development / build environment

| Item | Requirement |
|---|---|
| OS | Windows 10 / 11 (x64) |
| Node.js | 20.9.0 or newer (same as Harness); npm ships with Node |
| Network | Needed during build: `npm install` fetches dependencies; `npm run dist` also downloads the bundled Node runtime from nodejs.org (SHA-256 verified against the official checksum, then unpacked into `vendor/node`; skipped if already present) |

## Features

- Opens the Harness UI in its own window (single instance; launching again just focuses the existing window)
- **Auto-start local service**: when `http://127.0.0.1:3080` is not running, the app starts it with `npx @deepseek-ai/dsh web` from the bundled Node runtime (no system Node needed); the service started by the app is stopped when the app exits (externally running services are left alone)
- **Starting animation**: while the service is not ready and no error has occurred, the window shows "Starting…" with an animated dot-matrix rendition of the official whale icon; the error page (with details) only appears on real failures
- **Local Server panel in Settings**: open Settings in the sidebar and choose "Local Server" to see the Harness address with a status light — green when running, red when stopped/error; supports manual "Start/Stop service" and the "Auto-start service on app launch" toggle
- No menu bar ("File/View/Help" hidden); keyboard shortcuts preserved: Ctrl+R reload, Ctrl+ / Ctrl− / Ctrl+0 zoom, F11 fullscreen, Ctrl+Shift+I DevTools
- Offline error page with automatic retry every 5 seconds
- External links always open in the system browser; the window never leaves the Harness site

App settings are stored in `%APPDATA%\DeepSeek Harness\settings.json`.

## Run (development)

```bash
npm install
npm start
```

To point the app at a Harness instance on a different address:

```powershell
$env:DSH_URL = "http://127.0.0.1:3080"
npm start
```

## Build the Windows installer

```bash
npm run dist
```

Before `dist`, `scripts/fetch-node.js` runs automatically: it downloads a pinned
Node.js runtime (`v22.23.2` win-x64) from nodejs.org, verifies its SHA-256
checksum, unpacks it into `vendor/node`, and ships it inside the installer
(`extraResources` → `resources/node` at the install location). Versions that are
already downloaded are skipped (idempotent).

Outputs go to `dist/`:

- `DeepSeek Harness Setup x.x.x.exe` — NSIS installer (choose install directory, create desktop shortcut)
- `DeepSeek Harness x.x.x.exe` — portable edition, no installation required

Package without generating an installer (for quick checks):

```bash
npm run pack
```

## Project structure

```
dsh-desktop/
├── package.json          # dependencies, scripts, electron-builder config
├── scripts/
│   └── fetch-node.js     # downloads & verifies the bundled Node.js runtime (SHA-256), idempotent
├── vendor/
│   └── node/             # bundled Node.js 22 LTS runtime (shipped in the installer; don't edit)
├── src/
│   ├── main.js           # main process: window, service management (auto-start/monitor/stop), IPC
│   ├── preload.js        # preload script (secure contextBridge)
│   ├── overlay.js        # Local Server panel injected into the Settings UI
│   ├── start.html        # starting screen (dot-matrix whale swimming animation)
│   └── error.html        # offline error page when startup fails
└── build/
    ├── icon.png            # app icon (rendered from the official DeepSeek Harness favicon.svg)
    └── icon-render.html    # icon render source (kept for regeneration)
```

## License

[MIT](LICENSE) — see [LICENSE](LICENSE) for details.

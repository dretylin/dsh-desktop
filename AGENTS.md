# DeepSeek Harness Desktop - Agent Guidelines & Project Context

## 1. Project Overview

`dsh-desktop` is an Electron-based Windows desktop client for the **DeepSeek Harness Web GUI** (default: `http://127.0.0.1:3080`).

Key operational characteristics:
- **Zero-Dependency End-User Experience**: The application bundles a pinned Node.js LTS runtime (`v22.23.2` win-x64) into the installer (`extraResources`), allowing it to automatically launch and manage the local Harness service via `npx @deepseek-ai/dsh web` even if Node.js is not installed on the user's system.
- **Service Lifecycle Orchestration**: Automatically starts the local backend service if port 3080 is idle; attaches non-destructively if an external Harness instance is already running; stops managed child processes gracefully upon application exit.
- **Embedded In-App Management & Voice Input**: Dynamically injects a "Local Server & STT" management panel into the DeepSeek Harness Web Settings view and a microphone voice input button (supporting Alt+V) into the chat composer via DOM overlay, utilizing Google Vertex AI (`gemini-3.5-flash-lite`) for low-latency Speech-to-Text transcription.

---

## 2. Directory Structure & Architecture

```
dsh-desktop/
├── package.json          # Dependency specs, build scripts, and electron-builder configuration
├── scripts/
│   └── fetch-node.js     # Downloads, SHA-256 verifies, and unpacks the pinned Node runtime into vendor/node
├── vendor/
│   └── node/             # Bundled Node.js 22 LTS runtime (downloaded by fetch-node.js; ignored by git)
├── src/
│   ├── main.js           # Electron main process: window lifecycle, service supervisor, IPC handlers, config
│   ├── voice-stt.js      # Google Vertex STT (gemini-3.5-flash-lite) audio transcription service
│   ├── preload.js        # Sandboxed contextBridge exposing window.dsh API to the renderer/GUI
│   ├── overlay.js        # Script injected into the Harness Web GUI (Local Server settings + Voice Input button)
│   ├── start.html        # Loading screen with dot-matrix whale animation shown during service spin-up
│   └── error.html        # Fallback offline error page with failure diagnostics and auto-retry mechanism
└── build/
    ├── icon.png          # High-resolution application icon
    └── icon-render.html  # Source rendering canvas for generating icon assets
```

### Module Responsibilities
- **`src/main.js`**:
  - Enforces single-instance lock (`app.requestSingleInstanceLock()`).
  - Probes server reachability (`net.fetch`) before spawning child processes.
  - Resolves Node/npx path (`vendor/node/npx.cmd` in dev, `resources/node/npx.cmd` in production, falling back to system `where.exe npx.cmd`).
  - Manages child process lifecycle with duplicate-start guarding (`startInFlight` promise lock) and clean process tree termination on app shutdown.
  - Manages persistent settings stored at `%APPDATA%\DeepSeek Harness\settings.json`.
  - Sets up IPC channels (`server:status`, `server:start`, `server:stop`, `voice:transcribe`, `voice:status`, `config:get`, `config:set`, `dsh:open-external`, `app:version`).
- **`src/voice-stt.js`**:
  - Handles Google Cloud ADC resolution and OAuth access token caching.
  - Calls Google Vertex AI `gemini-3.5-flash-lite:generateContent` with audio inlineData to produce clean STT transcriptions.
- **`src/preload.js`**:
  - Secure bridge using `contextBridge.exposeInMainWorld('dsh', ...)` with narrow, JSON-serializable invocations.
- **`src/overlay.js`**:
  - Injected into the Web GUI after navigation.
  - Mounts a microphone button in the chat composer with recording pulse and transcribing spinner states.
  - Supports keyboard shortcut (`Alt + V`).
  - Injects the "Local Server & STT" tab into the Settings dialog.
- **`scripts/fetch-node.js`**:
  - Fetches `node-v22.23.2-win-x64.zip` and `SHASUMS256.txt` from `nodejs.org`, validates SHA-256 hash, extracts to `vendor/node`, and writes a `.version` stamp for idempotency.

---

## 3. Development & Build Commands

All commands should be executed from the `dsh-desktop` directory.

- **Install Dependencies**:
  ```bash
  npm install
  ```
- **Fetch Bundled Node Runtime**:
  ```bash
  npm run fetch-node
  ```
- **Run in Development**:
  ```bash
  npm start
  ```
- **Run against a Custom Harness URL**:
  ```powershell
  $env:DSH_URL = "http://127.0.0.1:3080"
  npm start
  ```
- **Package App Directory (Unpacked Check)**:
  ```bash
  npm run pack
  ```
  *(Automatically runs `prepack` -> `fetch-node` and produces output in `dist/win-unpacked`)*
- **Build Production Installers (NSIS & Portable)**:
  ```bash
  npm run dist
  ```
  *(Automatically runs `predist` -> `fetch-node` and outputs installers to `dist/`)*
- **Smoke Testing (CI / Headless Check)**:
  ```bash
  npx electron . --smoke
  ```

---

## 4. Configuration & Environment Variables

| Variable | Default Value | Description |
|---|---|---|
| `DSH_URL` | `http://127.0.0.1:3080` | URL of the DeepSeek Harness Web GUI |
| `DSH_HOME` | `%USERPROFILE%\.dsh` | Data and working directory used when spawning `npx @deepseek-ai/dsh web` |
| `APPDATA` | `C:\Users\<user>\AppData\Roaming` | Root directory for desktop config (`%APPDATA%\DeepSeek Harness\settings.json`) |

---

## 5. Critical Guidelines & Architectural Gotchas

1. **Process & Service Hygiene**:
   - Never kill an externally running Harness service on exit. Only kill the backend if `server.managed === true`.
   - Prevent zombie/orphan Node processes on Windows: child process spawns must be tracked and killed explicitly on `before-quit`, `will-quit`, and unhandled exceptions.
   - Use `startInFlight` lock pattern in `main.js` to ensure concurrent triggers (e.g., auto-start + UI button click) do not spawn redundant server processes.

2. **Security & Sandboxing**:
   - `nodeIntegration: false` and `contextIsolation: true` must remain enabled for the `BrowserWindow`.
   - Never pass raw `ipcRenderer` or Node built-ins into the renderer.
   - All external URL navigations (`will-navigate`, `new-window`, `setWindowOpenHandler`) must be intercepted and routed to `shell.openExternal(url)` to prevent arbitrary remote code execution.

3. **Overlay & DOM Resilience**:
   - The Web GUI is a React Single Page Application (SPA). The injected `overlay.js` must be idempotent and withstand DOM re-renders without causing memory leaks or duplicate UI nodes.

4. **Code Style & Runtime Compatibility**:
   - Codebase uses standard CommonJS (`'use strict'`, `require`, `module.exports`).
   - Keep `src/` modules vanilla JavaScript compatible with Electron's Node runtime (no transpilation/bundler step needed for `src/`).

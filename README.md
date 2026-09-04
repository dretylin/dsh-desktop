# DeepSeek Harness Desktop

[English](README.md) | [中文](README.zh-CN.md)

An Electron-based Windows desktop app that opens the DeepSeek Harness Web GUI
(default `http://127.0.0.1:3080`).

## What is DeepSeek Harness (dsh)

DeepSeek Harness (dsh) is an open-source agent harness developed by DeepSeek AI. Repo：https://github.com/deepseek-ai/deepseek-harness

## System Requirements (read before installing)

### Runtime environment (end users)

| Item | Requirement |
|---|---|
| OS | Windows 10 / Windows 11, **64-bit (x64) only**. 32-bit is not supported; ARM64 is untested |
| Memory | 4 GB or more recommended (the Electron UI and the local Harness service run at the same time) |
| Disk space | Installer ~156 MB, ~630 MB once installed (bundled Node.js runtime **and** the complete Harness dependency tree). Reserve **700 MB or more** including session data |
| Node.js | **Not required.** A pinned Node.js 22 LTS runtime (v22.23.2, npm 10.9.8) ships inside the app and runs the Harness |
| Harness | **Not required, and never downloaded at runtime.** `@deepseek-ai/dsh` 0.1.2-rc.1 and its entire dependency tree are resolved at build time and shipped inside the installer |
| Port | `127.0.0.1:3080` by default. Auto-start requires this port to be free; if another process already serves it, the app treats it as an externally running service and connects directly (no error). A Harness ≥ 0.1.2-rc.1 that you started yourself needs its token — see `DSH_URL` below |
| Network | Not needed to start the app. Only the agent itself needs internet (the DeepSeek API and any web tools) |
| First launch | Starts straight from the bundled tree — no download, no waiting |

> The installer is not code-signed (Authenticode); Windows SmartScreen may warn
> about an "unknown publisher" — choose **Run anyway**.

> **Do not copy or back up `%USERPROFILE%\.dsh` with a tool that dereferences
> symlinks.** The Harness maintains `.dsh\profiles\node_modules` as a symlink
> farm and re-points it to the bundled tree on every launch. If a real directory
> ends up where a symlink belongs, startup aborts with
> `... exists and is not a symlink or dsh-managed module proxy; remove it so dsh
> can manage the installation fallback`. Deleting `.dsh\profiles\node_modules`
> lets the next launch rebuild it.

### Environment variables (optional)

| Variable | Default | Description |
|---|---|---|
| `DSH_URL` | `http://127.0.0.1:3080` | The address the app loads and probes; the bundled Harness is started on the same port (`--port` follows it). Since 0.1.2-rc.1 the GUI answers **401** without the per-process token from the `dsh web:` startup line — the app captures that token from the service it starts, but to attach to a Harness you started yourself (with auto-start turned off) include the token here, e.g. `DSH_URL=http://127.0.0.1:8080/?token=…` |
| `DSH_HOME` | `%USERPROFILE%\.dsh` | Harness data/config directory; also the working directory of the service process |

### Optional extras

| Item | When you need it |
|---|---|
| pnpm | Only for `dsh plugin add/remove` (profile plugin management). It is not bundled and is not needed to run the app |
| PowerShell 7 | Optional. On Windows the agent's shell tool prefers `pwsh.exe` but falls back to the built-in Windows PowerShell 5.1, so nothing extra is required |
| DeepSeek account | Needed to actually use the agent. Sign in from the GUI on first run; credentials are stored in `%USERPROFILE%\.dsh\.credentials.yaml` |

### Development / build environment

| Item | Requirement |
|---|---|
| OS | Windows 10 / 11 (x64) |
| Node.js | 20.9.0 or newer; npm ships with Node |
| Network | Needed during build: `npm install` fetches dependencies; `npm run dist` additionally downloads the pinned Node runtime from nodejs.org (SHA-256 verified) and resolves the Harness tree with pnpm. Both steps are skipped when already staged |
| pnpm | Not needed manually — `scripts/fetch-harness.js` installs a pinned pnpm into `vendor/pnpm` and uses it. npm cannot be used here: its peer-dependency resolver does not terminate on the Harness dependency graph |

## Features

- Opens the Harness UI in its own window (single instance; launching again just focuses the existing window)
- **Auto-start local service**: when `http://127.0.0.1:3080` is not running, the app starts the bundled Harness directly with the bundled Node runtime — no npx, no registry access, no system Node — and opens the GUI through the tokenized startup URL the service prints, so the per-process login the Harness requires since 0.1.2-rc.1 happens without any user action; the service started by the app is stopped when the app exits (externally running services are left alone)
- **Starting animation**: while the service is not ready and no error has occurred, the window shows "Starting…" with an animated dot-matrix rendition of the official whale icon; the error page (with details) only appears on real failures
- **Voice Input (STT)**: click the microphone icon in the chat composer or press **Alt+V** to record speech, automatically transcribed into text using **Google Vertex AI (`gemini-3.5-transcribe`)** and appended into the input box
- **Local Server & STT panel in Settings**: open Settings in the sidebar and choose "Local Server & STT" to see the Harness service status, auto-start toggle, and voice input options (e.g. auto-send on speech completion)
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

Before `dist`, two staging scripts run automatically (both idempotent):

1. `scripts/fetch-node.js` — downloads the pinned Node.js runtime
   (`v22.23.2` win-x64) from nodejs.org, verifies its SHA-256 checksum against
   the official `SHASUMS256.txt`, and unpacks it into `vendor/node`.
2. `scripts/fetch-harness.js` — installs a pinned pnpm into `vendor/pnpm`, then
   resolves `@deepseek-ai/dsh@0.1.2-rc.1` into `vendor/harness` and verifies the
   result (entry point present, peer dependencies complete).

Both directories ship inside the installer via `extraResources`
(`resources/node` and `resources/harness`), which is what lets the app boot the
Harness with no download and no dependency resolution on the user's machine.

To move to a newer Harness release, change `HARNESS_SPEC` in
`scripts/fetch-harness.js`, delete `vendor/harness`, and rebuild. Pin the newest
release rather than an older one: every `@deepseek-ai/*` child is a caret range,
so an older top-level pin still resolves today's children and yields a mixed tree.

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
│   ├── fetch-node.js     # downloads & verifies the bundled Node.js runtime (SHA-256), idempotent
│   └── fetch-harness.js  # stages pnpm + the pinned Harness dependency tree, idempotent
├── vendor/               # build output, git-ignored; regenerated by the scripts above
│   ├── node/             # bundled Node.js 22 LTS runtime (shipped in the installer)
│   ├── pnpm/             # pinned pnpm used only at build time (not shipped)
│   └── harness/          # resolved @deepseek-ai/dsh tree (shipped in the installer)
├── src/
│   ├── main.js           # main process: window, service management (auto-start/monitor/stop), IPC
│   ├── harness-update.js # Harness version reporting (pinned builds never self-update)
│   ├── voice-stt.js      # Google Vertex STT (gemini-3.5-transcribe) audio transcription service
│   ├── preload.js        # preload script (secure contextBridge)
│   ├── overlay.js        # Voice input button & Local Server panel injected into the GUI
│   ├── start.html        # starting screen (dot-matrix whale swimming animation)
│   └── error.html        # offline error page when startup fails
└── build/
    ├── icon.png            # app icon (rendered from the official DeepSeek Harness favicon.svg)
    └── icon-render.html    # icon render source (kept for regeneration)
```

## License

[MIT](LICENSE) — see [LICENSE](LICENSE) for details.

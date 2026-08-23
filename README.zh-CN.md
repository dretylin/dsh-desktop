# DeepSeek Harness Desktop

[English](README.md) | [中文](README.zh-CN.md)

一个基于 Electron 的 Windows 桌面应用，用来打开 DeepSeek Harness Web GUI
（默认地址 `http://127.0.0.1:3080`）。

## What is DeepSeek Harness (dsh)

DeepSeek Harness (dsh) is an open-source agent harness developed by DeepSeek AI. 源代码仓库：https://github.com/deepseek-ai/deepseek-harness

## 系统要求（安装前必读）

### 运行环境（终端用户）

| 项目 | 要求 |
|---|---|
| 操作系统 | Windows 10 / Windows 11，**仅 64 位（x64）**。不支持 32 位系统；ARM64 设备未专门测试 |
| 内存 | 建议 4 GB 及以上（Electron 界面与本地 Harness 服务同时运行） |
| 磁盘空间 | 安装包约 149 MB，安装后约 630 MB（含内置 Node.js 运行时**和**完整的 Harness 依赖树）。连同会话数据建议预留 **700 MB 以上** |
| Node.js | **不需要安装。** 应用内置固定版本的 Node.js 22 LTS（v22.23.2，npm 10.9.8）运行时，并用它运行 Harness |
| Harness | **不需要安装，运行时也不会下载。** `@deepseek-ai/dsh` 0.1.1-rc.1 及其完整依赖树在构建时解析完毕并打包进安装包 |
| 端口 | 默认 `127.0.0.1:3080`。自动启动服务要求该端口未被占用；若端口已被其他进程占用，应用会将其视为"外部已运行的服务"直接连接，不会报错 |
| 网络 | 启动应用本身不需要联网。仅 Agent 自身需要联网（DeepSeek API 及联网工具） |
| 首次启动 | 直接从内置依赖树启动，无需下载、无需等待 |

> 安装包未做代码签名（Authenticode），Windows SmartScreen 可能提示"未知发布者"——选择"仍要运行"即可。

> **请勿使用会展开符号链接的工具复制或备份 `%USERPROFILE%\.dsh`。** Harness 将
> `.dsh\profiles\node_modules` 作为符号链接集合管理，每次启动都会把它重新指向内置依赖树。
> 若本该是符号链接的位置变成了真实目录，启动会中断并报
> `... exists and is not a symlink; remove it so dsh can manage the installation fallback`。
> 删除 `.dsh\profiles\node_modules` 后，下次启动会自动重建。

### 环境变量（可选）

| 变量 | 默认值 | 说明 |
|---|---|---|
| `DSH_URL` | `http://127.0.0.1:3080` | 应用加载和探测的地址。**它不会改变内置 Harness 监听的端口**——应用始终在 3080 启动服务。仅当你自行启动了 Harness（如 `dsh web --port 8080`）并关闭自动启动时，用它把窗口指向该地址 |
| `DSH_HOME` | `%USERPROFILE%\.dsh` | Harness 数据/配置目录，也是服务进程的工作目录 |

### 可选组件

| 项目 | 何时需要 |
|---|---|
| pnpm | 仅在使用 `dsh plugin add/remove`（配置档插件管理）时需要。未随应用打包，运行应用不需要 |
| PowerShell 7 | 可选。Windows 下 Agent 的 shell 工具优先使用 `pwsh.exe`，找不到时回退到系统自带的 Windows PowerShell 5.1，因此无需额外安装 |
| DeepSeek 账号 | 实际使用 Agent 时需要。首次运行在界面中登录，凭据保存在 `%USERPROFILE%\.dsh\.credentials.yaml` |

### 开发 / 打包环境

| 项目 | 要求 |
|---|---|
| 操作系统 | Windows 10 / 11（x64） |
| Node.js | 20.9.0 或更高，npm 随 Node 自带 |
| 网络 | 构建时需联网：`npm install` 拉取依赖；`npm run dist` 还会从 nodejs.org 下载固定版 Node 运行时（校验 SHA-256），并用 pnpm 解析 Harness 依赖树。两者均已就绪时会跳过 |
| pnpm | 无需手动安装——`scripts/fetch-harness.js` 会把固定版本的 pnpm 装到 `vendor/pnpm` 并使用它。此处不能用 npm：npm 的 peer 依赖解析在 Harness 的依赖图上无法终止 |

## 功能

- 独立窗口打开 Harness 界面（单实例，重复启动只会聚焦已有窗口）
- **自动启动本地服务**：打开应用时若 `http://127.0.0.1:3080` 未运行，直接用内置 Node 运行时拉起内置的 Harness——不经过 npx、不访问 npm registry、无需本机安装 Node；退出应用时自动停止由本应用启动的服务（外部已运行的服务不受影响）
- **启动中动画**：服务未就绪且无错误时，窗口显示"启动中…"与官方鲸鱼图标的点阵版游泳动画；只有启动真正出错时才显示错误页（含具体错误信息）
- **语音输入 (STT)**：点击对话输入框工具栏麦克风图标或按 **Alt + V** 录音，通过 **Google Vertex AI (`gemini-3.5-flash-lite`)** 极速转写为文字并自动填入输入框
- **Settings 中的 Local Server & STT 子界面**：点击侧边栏底部 Settings，在设置列表里选择 "Local Server & STT"，显示 Harness 服务状态与语音配置（如转写后自动发送消息开关）
- 无菜单栏（"文件/视图/帮助"已隐藏），快捷键保留：Ctrl + R 刷新、Ctrl + / Ctrl - / Ctrl 0 缩放、F11 全屏、Ctrl + Shift + I 开发者工具
- 启动出错时显示提示页，并每 5 秒自动重试连接
- 外部链接一律在系统默认浏览器中打开，窗口内不会跳出 Harness 站点

应用设置保存在 `%APPDATA%\DeepSeek Harness\settings.json`。

## 运行（开发）

```bash
npm install
npm start
```

如果你的 Harness 跑在其他地址，通过环境变量指定：

```powershell
$env:DSH_URL = "http://127.0.0.1:3080"
npm start
```

## 打包 Windows 安装程序

```bash
npm run dist
```

`dist` 前会自动执行两个准备脚本（均为幂等）：

1. `scripts/fetch-node.js` —— 从 nodejs.org 下载固定版本的 Node.js 运行时
   （`v22.23.2` win-x64），对照官方 `SHASUMS256.txt` 校验 SHA-256 后解压到
   `vendor/node`。
2. `scripts/fetch-harness.js` —— 将固定版本的 pnpm 安装到 `vendor/pnpm`，再用它把
   `@deepseek-ai/dsh@0.1.1-rc.1` 解析到 `vendor/harness`，并校验结果
   （入口文件存在、peer 依赖完整）。

两个目录都通过 `extraResources` 打包进安装包（`resources/node` 与
`resources/harness`），这正是应用能够在用户机器上零下载、零依赖解析启动 Harness 的原因。

升级到新版 Harness 时，修改 `scripts/fetch-harness.js` 中的 `HARNESS_SPEC`，
删除 `vendor/harness` 后重新构建。请固定到**最新**版本而非旧版本：所有
`@deepseek-ai/*` 子包都是 caret 范围，固定旧的顶层版本仍会拉到今天的子包，
得到的是混合版本的依赖树。

产物输出到 `dist/`：

- `DeepSeek Harness Setup x.x.x.exe` — NSIS 安装程序（可自选安装目录、创建桌面快捷方式）
- `DeepSeek Harness x.x.x.exe` — 免安装便携版

仅打包不生成安装程序（用于快速验证）：

```bash
npm run pack
```

## 项目结构

```
dsh-desktop/
├── package.json          # 依赖、脚本、electron-builder 配置
├── scripts/
│   ├── fetch-node.js     # 下载并校验内置 Node.js 运行时（SHA-256），幂等
│   └── fetch-harness.js  # 准备 pnpm 与固定版 Harness 依赖树，幂等
├── vendor/               # 构建产物，已 git-ignore；由上述脚本重新生成
│   ├── node/             # 内置 Node.js 22 LTS 运行时（打包进安装包）
│   ├── pnpm/             # 仅构建时使用的固定版 pnpm（不打包）
│   └── harness/          # 解析完成的 @deepseek-ai/dsh 依赖树（打包进安装包）
├── src/
│   ├── main.js           # 主进程：窗口、服务管理（自动启动/监控/停止）、IPC
│   ├── harness-update.js # Harness 版本信息（固定版构建不会自动更新）
│   ├── voice-stt.js      # Google Vertex STT (gemini-3.5-flash-lite) 语音转文字服务
│   ├── preload.js        # 预加载脚本（contextBridge 安全桥接）
│   ├── overlay.js        # 注入到界面的语音输入按钮与 Local Server 面板
│   ├── start.html        # 启动中页面（点阵版鲸鱼游泳动画）
│   └── error.html        # 启动出错时的离线提示页
└── build/
    ├── icon.png            # 应用图标（DeepSeek Harness 官方 favicon.svg 渲染）
    └── icon-render.html    # 图标渲染源文件（保留以便重新生成）
```

## 许可证

[MIT](LICENSE) — 详见 [LICENSE](LICENSE)。

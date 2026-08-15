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
| 磁盘空间 | 安装包约 108 MB，安装后约 360 MB（含内置 Node.js 运行时）；首次启动还会通过 npx 下载 Harness 依赖到用户缓存（约 250 MB）。合计建议预留 **600 MB 以上** |
| Node.js | **不需要安装。** 应用内置 Node.js 22 LTS（v22.23.2）运行时，自动启动服务时优先使用内置运行时的 `npx`；仅当内置运行时缺失时才回退到系统 PATH 中的 `npx` |
| 端口 | 默认 `127.0.0.1:3080`。自动启动服务要求该端口未被占用；若端口已被其他进程占用，应用会将其视为"外部已运行的服务"直接连接，不会报错 |
| 网络 | 首次自动启动服务时需要联网，通过内置 npx 下载 `@deepseek-ai/dsh` 及其依赖；下载完成后可离线使用 |
| 首次启动 | 首次启动需下载 Harness 包，最长等待 90 秒（窗口显示"启动中…"动画）；下载完成后启动显著加快 |

> 安装包未做代码签名（Authenticode），Windows SmartScreen 可能提示"未知发布者"——选择"仍要运行"即可。

### 环境变量（可选）

| 变量 | 默认值 | 说明 |
|---|---|---|
| `DSH_URL` | `http://127.0.0.1:3080` | Harness Web GUI 地址（服务运行在其他地址/端口时设置） |
| `DSH_HOME` | `%USERPROFILE%\.dsh` | Harness 数据/配置目录，也是服务进程的工作目录 |

### 开发 / 打包环境

| 项目 | 要求 |
|---|---|
| 操作系统 | Windows 10 / 11（x64） |
| Node.js | 20.9.0 或更高（与 Harness 要求一致），npm 随 Node 自带 |
| 网络 | 构建时需联网：`npm install` 拉取依赖；`npm run dist` 还会从 nodejs.org 下载内置 Node 运行时（校验官方 SHA-256 后解压到 `vendor/node`，已存在则跳过） |

## 功能

- 独立窗口打开 Harness 界面（单实例，重复启动只会聚焦已有窗口）
- **自动启动本地服务**：打开应用时若 `http://127.0.0.1:3080` 未运行，自动用内置 Node 运行时的 `npx @deepseek-ai/dsh web` 拉起 Harness（无需本机安装 Node）；退出应用时自动停止由本应用启动的服务（外部已运行的服务不受影响）
- **启动中动画**：服务未就绪且无错误时，窗口显示"启动中…"与官方鲸鱼图标的点阵版游泳动画；只有启动真正出错时才显示错误页（含具体错误信息）
- **Settings 中的 Local Server 子界面**：点击侧边栏底部 Settings，在设置列表里选择 "Local Server"，显示 Harness 地址与状态灯——运行正常亮绿灯，未运行/异常亮红灯；支持手动"启动/停止服务"、开关"启动桌面应用时自动启动服务"
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

`dist` 前会自动执行 `scripts/fetch-node.js`：从 nodejs.org 下载固定版本的
Node.js 运行时（`v22.23.2` win-x64），校验 SHA-256 后解压到 `vendor/node`，
并随安装包一起发布（`extraResources` → 安装目录 `resources/node`）。
已下载过的版本会跳过（幂等）。

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
│   └── fetch-node.js     # 下载并校验内置 Node.js 运行时（SHA-256），幂等
├── vendor/
│   └── node/             # 内置 Node.js 22 LTS 运行时（打包进安装包，勿手动修改）
├── src/
│   ├── main.js           # 主进程：窗口、服务管理（自动启动/监控/停止）、IPC
│   ├── preload.js        # 预加载脚本（contextBridge 安全桥接）
│   ├── overlay.js        # 注入到设置面板的 Local Server 子界面
│   ├── start.html        # 启动中页面（点阵版鲸鱼游泳动画）
│   └── error.html        # 启动出错时的离线提示页
└── build/
    ├── icon.png            # 应用图标（DeepSeek Harness 官方 favicon.svg 渲染）
    └── icon-render.html    # 图标渲染源文件（保留以便重新生成）
```

## 许可证

[MIT](LICENSE) — 详见 [LICENSE](LICENSE)。

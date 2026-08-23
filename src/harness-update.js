'use strict';

/**
 * Harness update support for the desktop app.
 *
 * Compares the cached @deepseek-ai/dsh version (inside the npx `_npx` cache
 * checkout) against the `latest` dist-tag on the npm registry, removes stale
 * cache checkouts, and reinstalls the latest version. Kept free of Electron
 * imports so every function can be unit-tested with plain Node; fetch and
 * spawn are injected where needed.
 */

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn, spawnSync } = require('node:child_process');

const PKG = '@deepseek-ai/dsh';
const DEFAULT_REGISTRY = 'https://registry.npmjs.org';
const DEFAULT_INSTALL_TIMEOUT = 180000;

/**
 * npm's cache root (the parent of `_npx/`).
 * Order: NPM_CONFIG_CACHE env → `npm config get cache` (prefers the bundled
 * runtime) → the Windows default %LOCALAPPDATA%\npm-cache.
 */
function npmCacheRoot(nodeDir) {
  if (process.env.NPM_CONFIG_CACHE) return process.env.NPM_CONFIG_CACHE;
  try {
    const npm = nodeDir ? path.join(nodeDir, 'npm.cmd') : 'npm.cmd';
    const env = { ...process.env };
    if (nodeDir) {
      // npm.cmd resolves `node` from PATH, so put the bundled runtime first.
      const pathKey = Object.keys(env).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH';
      env[pathKey] = `${nodeDir};${env[pathKey] ?? ''}`;
    }
    const r = spawnSync(npm, ['config', 'get', 'cache'], { encoding: 'utf8', windowsHide: true, env });
    if (r.status === 0) {
      const c = String(r.stdout || '').trim();
      if (c && c !== 'undefined' && c !== 'null') return c;
    }
  } catch {}
  return path.join(os.homedir(), 'AppData', 'Local', 'npm-cache');
}

/** Every `_npx` checkout that contains an installed @deepseek-ai/dsh. */
function findDshCacheDirs(cacheRoot) {
  const npxDir = path.join(cacheRoot, '_npx');
  if (!fs.existsSync(npxDir)) return [];
  let entries;
  try {
    entries = fs.readdirSync(npxDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const dir = path.join(npxDir, e.name);
    if (fs.existsSync(path.join(dir, 'node_modules', '@deepseek-ai', 'dsh', 'package.json'))) {
      out.push(dir);
    }
  }
  return out;
}

/** The installed version inside one `_npx` checkout, or null. */
function cachedVersion(cacheDir) {
  try {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(cacheDir, 'node_modules', '@deepseek-ai', 'dsh', 'package.json'), 'utf8')
    );
    return typeof pkg.version === 'string' ? pkg.version : null;
  } catch {
    return null;
  }
}

/** Recursively delete the given `_npx` checkouts (best-effort per dir). */
function removeCacheDirs(dirs) {
  for (const dir of dirs) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {}
  }
}

/** Fetch the `latest` dist-tag version from the npm registry. */
async function getLatestVersion({ fetch, registry = DEFAULT_REGISTRY, timeoutMs = 10000 } = {}) {
  const fn = fetch || globalThis.fetch;
  if (typeof fn !== 'function') throw new Error('no fetch implementation available');
  const url = `${registry}/${PKG.replace('/', '%2f')}/latest`;
  const res = await fn(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`npm registry 请求失败 (HTTP ${res.status})`);
  const data = await res.json();
  if (!data || typeof data.version !== 'string') {
    throw new Error('npm registry 响应缺少 version 字段');
  }
  return data.version;
}

/** Parse "x.y.z" plus an optional "-prerelease" tail. */
function parseVersion(v) {
  const [core, pre] = String(v || '').trim().split('-', 2);
  const nums = core.split('.').map((n) => parseInt(n, 10) || 0);
  while (nums.length < 3) nums.push(0);
  return { nums, pre: pre || null };
}

/** Minimal semver compare (release > prerelease; -rc.6 < -rc.7). Returns -1 | 0 | 1. */
function compareVersions(a, b) {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  for (let i = 0; i < 3; i++) {
    if (pa.nums[i] !== pb.nums[i]) return pa.nums[i] > pb.nums[i] ? 1 : -1;
  }
  if (pa.pre === pb.pre) return 0;
  if (pa.pre === null) return 1;
  if (pb.pre === null) return -1;
  return pa.pre < pb.pre ? -1 : 1;
}

/**
 * Reinstall the latest version into the npx cache by running
 * `npx --yes @deepseek-ai/dsh --version` (downloads, then prints the version
 * and exits — `dsh` registers -V/--version). Callers must remove the old
 * cache checkouts first, otherwise npx just reuses them.
 *
 * `stdio` is injectable for sandboxed test environments.
 */
function installLatest({ npx, comSpec, cwd, timeoutMs = DEFAULT_INSTALL_TIMEOUT, stdio = ['ignore', 'pipe', 'pipe'] }) {
  return new Promise((resolve) => {
    const child = spawn(comSpec, ['/c', npx, '--yes', PKG, '--version'], {
      cwd,
      windowsHide: true,
      stdio,
    });
    let output = '';
    if (child.stdout) child.stdout.on('data', (chunk) => (output = (output + String(chunk)).slice(-4000)));
    if (child.stderr) child.stderr.on('data', (chunk) => (output = (output + String(chunk)).slice(-4000)));

    const timer = setTimeout(() => {
      try { child.kill(); } catch {}
      resolve({ ok: false, error: '下载/安装超时' });
    }, timeoutMs);
    const settle = (ok, error) => {
      clearTimeout(timer);
      resolve({ ok, error });
    };

    child.on('error', (err) => settle(false, err.message));
    child.on('exit', (code) => {
      if (code !== 0) {
        const lines = output.trim().split(/\r?\n/).slice(-4).join(' | ');
        settle(false, `npx 安装进程退出 (code=${code})${lines ? '：' + lines : ''}`);
        return;
      }
      settle(true);
    });
  });
}

module.exports = {
  PKG,
  DEFAULT_REGISTRY,
  npmCacheRoot,
  findDshCacheDirs,
  cachedVersion,
  removeCacheDirs,
  getLatestVersion,
  compareVersions,
  parseVersion,
  installLatest,
};

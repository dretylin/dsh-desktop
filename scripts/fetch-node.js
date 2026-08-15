'use strict';

/**
 * Download the pinned Node.js runtime and unpack it into vendor/node so
 * electron-builder can ship it inside the installer.
 *
 * The app shells out to `npx @deepseek-ai/dsh web`; bundling the runtime is
 * what lets it do that on a machine with no Node installed. The archive is
 * verified against the official SHASUMS256.txt before it is unpacked — a
 * silently corrupted or substituted runtime would ship to every user.
 *
 * Idempotent: an already-unpacked runtime of the pinned version is left alone,
 * so `npm run dist` only pays the download once.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

// Pinned deliberately: the runtime users get must not drift with the build host.
const NODE_VERSION = 'v22.23.2';
const PLATFORM = 'win-x64';

const ARCHIVE = `node-${NODE_VERSION}-${PLATFORM}.zip`;
const BASE = `https://nodejs.org/dist/${NODE_VERSION}`;
const ROOT = path.join(__dirname, '..');
const VENDOR = path.join(ROOT, 'vendor', 'node');
const STAMP = path.join(VENDOR, '.version');
const CACHE = path.join(ROOT, 'vendor', '.cache');

function log(msg) {
  process.stdout.write(`[fetch-node] ${msg}\n`);
}

/** Download to a file via curl (present on Windows 10 1803+) and fail loudly. */
function download(url, dest) {
  const r = spawnSync(
    'curl',
    ['-fsSL', '--retry', '3', '--retry-delay', '2', '-o', dest, url],
    { stdio: ['ignore', 'inherit', 'inherit'] }
  );
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`download failed (${url}): curl exited ${r.status}`);
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

/** The published checksum for one archive name, from the release's SHASUMS256.txt. */
function expectedSha(sumsFile, archiveName) {
  for (const line of fs.readFileSync(sumsFile, 'utf8').split(/\r?\n/)) {
    const [sum, name] = line.trim().split(/\s+/);
    if (name === archiveName) return sum;
  }
  throw new Error(`${archiveName} is not listed in SHASUMS256.txt`);
}

function main() {
  if (fs.existsSync(STAMP) && fs.readFileSync(STAMP, 'utf8').trim() === NODE_VERSION) {
    log(`vendor/node already at ${NODE_VERSION} — skipping`);
    return;
  }

  fs.mkdirSync(CACHE, { recursive: true });
  const zip = path.join(CACHE, ARCHIVE);
  const sums = path.join(CACHE, `SHASUMS256-${NODE_VERSION}.txt`);

  log(`downloading ${ARCHIVE}`);
  download(`${BASE}/${ARCHIVE}`, zip);
  download(`${BASE}/SHASUMS256.txt`, sums);

  const want = expectedSha(sums, ARCHIVE);
  const got = sha256(zip);
  if (want !== got) {
    fs.rmSync(zip, { force: true });
    throw new Error(`checksum mismatch for ${ARCHIVE}\n  expected ${want}\n  actual   ${got}`);
  }
  log(`sha256 verified: ${got}`);

  // Unpack, then flatten node-<version>-<platform>/ into vendor/node/.
  fs.rmSync(VENDOR, { recursive: true, force: true });
  const staging = path.join(ROOT, 'vendor', '.staging');
  fs.rmSync(staging, { recursive: true, force: true });
  fs.mkdirSync(staging, { recursive: true });

  const r = spawnSync(
    'powershell',
    ['-NoProfile', '-NonInteractive', '-Command',
      `Expand-Archive -LiteralPath '${zip}' -DestinationPath '${staging}' -Force`],
    { stdio: ['ignore', 'inherit', 'inherit'] }
  );
  if (r.status !== 0) throw new Error(`Expand-Archive failed (exit ${r.status})`);

  fs.renameSync(path.join(staging, `node-${NODE_VERSION}-${PLATFORM}`), VENDOR);
  fs.rmSync(staging, { recursive: true, force: true });
  fs.writeFileSync(STAMP, `${NODE_VERSION}\n`);

  // Sanity check: the two executables the app actually invokes must be there.
  for (const f of ['node.exe', 'npx.cmd', 'npm.cmd']) {
    if (!fs.existsSync(path.join(VENDOR, f))) throw new Error(`vendor/node/${f} is missing after unpack`);
  }
  log(`unpacked ${NODE_VERSION} into vendor/node`);
}

main();

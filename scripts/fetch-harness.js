'use strict';

/**
 * Resolve the DeepSeek Harness dependency tree at build time and stage it in
 * vendor/harness so electron-builder can ship it inside the installer.
 *
 * Why this exists: the app used to boot the harness with
 * `npx --yes @deepseek-ai/dsh web`, which re-resolves the tree from the
 * registry on the user's machine. Two things make that unusable:
 *
 *   1. npm's peer-dependency resolver does not terminate on this tree — it
 *      pegs a core and grows past 3 GB without finishing (reproduced on npm
 *      10.9.8 and 11.16.0, for 0.1.0-rc.6 through 0.1.1-rc.1 alike).
 *   2. Pinning the top-level spec does not pin the tree: every
 *      @deepseek-ai/* child is a caret range, so `dsh@0.1.0-rc.6` installed
 *      today yields rc.8 internals.
 *
 * pnpm resolves the same tree in ~30s, so the build uses pnpm and freezes the
 * result. Users get the exact tree this build verified — no registry access,
 * no resolver, no first-run download.
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

// Pinned deliberately: both the installer and the resolver must be
// reproducible, or "the tree we tested" means nothing.
//
// Pin the CURRENT release, not an older one: every @deepseek-ai/* child is a
// caret range, so an older top-level pin still pulls today's children and
// yields a mixed tree (dsh@0.1.0-rc.6 resolves rc.8 internals). Pinning the
// newest release is the only way to get an internally consistent snapshot
// without writing an override for all ~195 scoped packages.
const HARNESS_SPEC = '@deepseek-ai/dsh@0.1.2-rc.1';
const PNPM_VERSION = '11.10.0';

const ROOT = path.join(__dirname, '..');
const VENDOR = path.join(ROOT, 'vendor');
const NODE_DIR = path.join(VENDOR, 'node');
const PNPM_HOME = path.join(VENDOR, 'pnpm');
const PNPM_CLI = path.join(PNPM_HOME, 'node_modules', 'pnpm', 'bin', 'pnpm.cjs');
const HARNESS = path.join(VENDOR, 'harness');
const MANIFEST = path.join(HARNESS, '.harness-manifest.json');

// The packages that carry install scripts. pnpm 11 blocks build scripts by
// default and exits 1 listing them; it also ignores this allow-list under
// `pnpm add` (it wants the newer `allowBuilds` map), so the scripts do not run.
// That is fine on win32-x64 — verified on 0.1.1-rc.1 and 0.1.2-rc.1 by loading
// both addons from the staged tree: koffi and node-pty ship prebuilt binaries
// their loaders find without the copy step, dsh-subprocess-local's postinstall
// only chmods a unix helper, and the protobufjs / @google/genai scripts are
// packaging no-ops. Kept as documentation of what is being skipped.
const BUILT_DEPS = [
  '@deepseek-ai/dsh-subprocess-local',
  '@google/genai',
  'koffi',
  'node-pty',
  'protobufjs',
];

function log(msg) {
  process.stdout.write(`[fetch-harness] ${msg}\n`);
}

/** PATH with the bundled runtime first, so npm/pnpm run on the pinned Node. */
function envWithNode() {
  const env = { ...process.env };
  const key = Object.keys(env).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH';
  env[key] = `${NODE_DIR};${env[key] ?? ''}`;
  return env;
}

function run(file, args, opts = {}) {
  const r = spawnSync(file, args, {
    stdio: ['ignore', 'inherit', 'inherit'],
    windowsHide: true,
    env: envWithNode(),
    ...opts,
  });
  if (r.error) throw r.error;
  return r.status ?? 1;
}

function readVersion(pkgDir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8')).version ?? null;
  } catch {
    return null;
  }
}

/** Install the pinned pnpm. It has no dependencies, so plain npm is safe here. */
function ensurePnpm() {
  if (readVersion(path.join(PNPM_HOME, 'node_modules', 'pnpm')) === PNPM_VERSION) {
    log(`pnpm ${PNPM_VERSION} already staged`);
    return;
  }
  log(`installing pnpm ${PNPM_VERSION}`);
  fs.mkdirSync(PNPM_HOME, { recursive: true });
  fs.writeFileSync(path.join(PNPM_HOME, 'package.json'), JSON.stringify({ name: 'dsh-pnpm-host', private: true }, null, 2));
  // Invoke npm's JS entry point rather than npm.cmd: Node refuses to spawn
  // .cmd/.bat without a shell since the CVE-2024-27980 fix.
  const npmCli = path.join(NODE_DIR, 'node_modules', 'npm', 'bin', 'npm-cli.js');
  if (!fs.existsSync(npmCli)) throw new Error(`npm CLI missing at ${npmCli}`);
  const status = run(path.join(NODE_DIR, 'node.exe'), [
    npmCli, 'install', `pnpm@${PNPM_VERSION}`, '--no-audit', '--no-fund', '--loglevel', 'error',
  ], { cwd: PNPM_HOME });
  if (status !== 0) throw new Error(`pnpm install failed (exit ${status})`);
  if (!fs.existsSync(PNPM_CLI)) throw new Error(`pnpm CLI missing at ${PNPM_CLI}`);
}

/**
 * pnpm config for the harness tree.
 * - hoisted: the harness resolves its own plugin bundles through a flat
 *   node_modules; pnpm's default isolated layout breaks that resolution.
 * - supportedArchitectures: without it pnpm fetches every optional platform
 *   variant (linux-s390x, openbsd, …) and the build fails on registry throttling.
 */
function writeHarnessProject() {
  fs.mkdirSync(HARNESS, { recursive: true });
  fs.writeFileSync(
    path.join(HARNESS, 'package.json'),
    JSON.stringify({ name: 'dsh-harness-bundle', private: true, version: '0.0.0' }, null, 2) + '\n'
  );
  const yaml = [
    'packages:',
    '  - .',
    'nodeLinker: hoisted',
    'autoInstallPeers: true',
    'onlyBuiltDependencies:',
    ...BUILT_DEPS.map((d) => `  - "${d}"`),
    'supportedArchitectures:',
    '  os:',
    '    - win32',
    '  cpu:',
    '    - x64',
    '',
  ].join('\n');
  fs.writeFileSync(path.join(HARNESS, 'pnpm-workspace.yaml'), yaml);
}

/** Fail loudly if the staged tree is not something the app can actually boot. */
function verifyTree() {
  const dshDir = path.join(HARNESS, 'node_modules', '@deepseek-ai', 'dsh');
  const bin = path.join(dshDir, 'lib', 'bin.js');
  if (!fs.existsSync(bin)) throw new Error(`harness entry point missing: ${bin}`);
  // A peer that npm's --legacy-peer-deps path silently drops; its absence is
  // the signature of an incomplete install that still looks plausible.
  const peer = path.join(HARNESS, 'node_modules', '@deepseek-ai', 'cordis-plugin-group');
  if (!fs.existsSync(peer)) throw new Error('peer dependency @deepseek-ai/cordis-plugin-group is missing');

  // Every scoped child is a caret range, so the launcher's version alone says
  // nothing about the tree; record the bundles and the browser build too, and
  // refuse a tree where any of them is missing.
  const versions = {};
  for (const name of ['dsh', 'dsh-base', 'dsh-web-app', 'dsh-web-frontend']) {
    const v = readVersion(path.join(HARNESS, 'node_modules', '@deepseek-ai', name));
    if (v === null) throw new Error(`@deepseek-ai/${name} is missing from the staged tree`);
    versions[name] = v;
  }
  return versions;
}

function main() {
  if (!fs.existsSync(path.join(NODE_DIR, 'node.exe'))) {
    throw new Error('vendor/node is missing — run scripts/fetch-node.js first');
  }

  if (fs.existsSync(MANIFEST)) {
    try {
      const m = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
      if (m.spec === HARNESS_SPEC && fs.existsSync(path.join(HARNESS, 'node_modules', '@deepseek-ai', 'dsh'))) {
        log(`vendor/harness already staged for ${HARNESS_SPEC} (dsh ${m.versions?.dsh})`);
        return;
      }
    } catch {}
  }

  ensurePnpm();
  writeHarnessProject();

  log(`resolving ${HARNESS_SPEC} with pnpm`);
  const status = run(path.join(NODE_DIR, 'node.exe'), [PNPM_CLI, 'add', HARNESS_SPEC], { cwd: HARNESS });
  // pnpm exits non-zero on warnings we tolerate (ignored build scripts,
  // optional-variant fetch retries), so the staged tree is the real verdict.
  if (status !== 0) log(`pnpm exited ${status}; verifying the tree before deciding`);

  const versions = verifyTree();
  fs.writeFileSync(
    MANIFEST,
    JSON.stringify({ spec: HARNESS_SPEC, pnpm: PNPM_VERSION, versions }, null, 2) + '\n'
  );
  log(`staged harness: ${Object.entries(versions).map(([k, v]) => `${k}@${v}`).join(', ')}`);
}

main();

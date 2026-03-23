const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const { ensureCargoBinInPath, pathKeyForEnv, pickModernNode, prependToPath } = require('./lib/nodeRuntime');
const { startAppleDoubleScrubber } = require('./lib/appleDoubleScrubber');
const { ensureMacCargoTargetOnApfs } = require('./lib/macosCargoTarget');
const { applyMacTauriEnv } = require('../platform/macos/node/tauriEnv');
const { resolveWindowsTauriArgs } = require('../platform/windows/node/vsDevCmd');

const isMac = process.platform === 'darwin';
const env = { ...process.env };
const pathKey = pathKeyForEnv(env);
const rawForwardedArgs = process.argv.slice(2);
const forwardedArgs = rawForwardedArgs[0] === '--' ? rawForwardedArgs.slice(1) : rawForwardedArgs;

ensureCargoBinInPath(env);

// Ensure `node` resolves to a Next-compatible Node (>=18) even when VS Code tasks
// don't load the user's shell init (common on macOS).
const chosenNode = pickModernNode(env, 18);
try {
  const nodeDir = path.dirname(chosenNode.nodeExe);
  prependToPath(env, nodeDir);
  env.SHOTSTYLE_NODE = chosenNode.nodeExe;
  if (chosenNode.version?.major) {
    console.log(`[tauri-dev] Using Node: ${chosenNode.nodeExe} (v${chosenNode.version.major}.${chosenNode.version.minor}.${chosenNode.version.patch})`);
  }
} catch {}

if (isMac) {
  applyMacTauriEnv(env, { logPrefix: 'tauri-dev' });
}

// Keep dev-generated cache data on the workspace volume when possible.
// (Useful when the system disk is low on space.)
try {
  const repoRoot = path.resolve(__dirname, '..');
  const devCacheDir = path.resolve(repoRoot, 'build-temp', 'shotstyle-cache');
  if (!env.SHOTSTYLE_CACHE_DIR) {
    env.SHOTSTYLE_CACHE_DIR = devCacheDir;
  }
  fs.mkdirSync(env.SHOTSTYLE_CACHE_DIR, { recursive: true });
  console.log(`[tauri-dev] SHOTSTYLE_CACHE_DIR=${env.SHOTSTYLE_CACHE_DIR}`);
} catch {}

// Also keep common dev temp/build artifacts on the workspace volume.
try {
  const repoRoot = path.resolve(__dirname, '..');
  const tmpDir = path.resolve(repoRoot, 'build-temp', 'shotstyle-tmp');
  // Keep Cargo artifacts on the workspace volume by default.
  // If you *need* to override (e.g. due to filesystem quirks), set SHOTSTYLE_CARGO_TARGET_DIR.
  const cargoTargetDir = (() => {
    const override = String(env.SHOTSTYLE_CARGO_TARGET_DIR || '').trim();
    if (override) return path.resolve(override);
    // APFS sparsebundle target is opt-in because some systems/volumes report
    // runtime write errors from Cargo (e.g. os error 92) even after mount.
    // Enable only when explicitly requested.
    const useApfsTarget = String(env.SHOTSTYLE_USE_APFS_CARGO || '').trim() === '1';
    if (useApfsTarget) {
      const apfsTarget = ensureMacCargoTargetOnApfs({ repoRoot, logPrefix: 'tauri-dev' });
      if (apfsTarget) return apfsTarget;
    }
    return path.resolve(repoRoot, 'build-temp', 'cargo-target');
  })();
  fs.mkdirSync(tmpDir, { recursive: true });
  fs.mkdirSync(cargoTargetDir, { recursive: true });
  env.TMPDIR = tmpDir;
  env.CARGO_TARGET_DIR = cargoTargetDir;
  console.log(`[tauri-dev] TMPDIR=${env.TMPDIR}`);
  console.log(`[tauri-dev] CARGO_TARGET_DIR=${env.CARGO_TARGET_DIR}`);
} catch {}

// Work around macOS AppleDouble sidecar files on non-APFS volumes (exFAT/SMB).
// Tauri's permissions build step can crash if it reads binary `._*.toml` files.
const appleDoubleScrubber = (() => {
  try {
    if (process.platform !== 'darwin') return null;
    if (!env.CARGO_TARGET_DIR) return null;
    return startAppleDoubleScrubber({ cargoTargetDir: env.CARGO_TARGET_DIR, logPrefix: 'tauri-dev' });
  } catch {
    return null;
  }
})();

const isWin = process.platform === 'win32';

// Ensure we control the Next dev server lifecycle on Windows so that
// watcher-related env vars (polling/ignores) take effect. Otherwise an
// already-running server can keep emitting Watchpack EINVAL errors.
if (isWin) {
  env.SHOTSTYLE_RESTART_DEV_SERVER = env.SHOTSTYLE_RESTART_DEV_SERVER || '1';
}

const cmd = (() => {
  if (isWin) return 'cmd';
  // Avoid depending on a global `npx` (which can point at an old Node install).
  // Use the same Node runtime running this script and the workspace-local Tauri CLI.
  return chosenNode.nodeExe || process.execPath;
})();
const args = (() => {
  if (!isWin) {
    const tauriCli = path.resolve(__dirname, '..', 'node_modules', '@tauri-apps', 'cli', 'tauri.js');
    return [tauriCli, 'dev', ...forwardedArgs];
  }
  return resolveWindowsTauriArgs({ env, tauriSubcommand: 'dev', forwardedArgs });
})();

const child = spawn(cmd, args, {
  stdio: 'inherit',
  env,
});

child.on('exit', (code) => {
  try { appleDoubleScrubber?.stop?.(); } catch {}
  process.exit(code ?? 0);
});

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const { ensureCargoBinInPath, pathKeyForEnv, pickModernNode, prependToPath } = require('./lib/nodeRuntime');
const { startAppleDoubleScrubber } = require('./lib/appleDoubleScrubber');
const { ensureMacCargoTargetOnApfs } = require('./lib/macosCargoTarget');
const { applyMacTauriEnv } = require('../platform/macos/node/tauriEnv');
const { resolveWindowsTauriArgs } = require('../platform/windows/node/vsDevCmd');

const isMac = process.platform === 'darwin';
const isGitHubActions = String(process.env.GITHUB_ACTIONS || '').toLowerCase() === 'true';
const env = { ...process.env };
const pathKey = pathKeyForEnv(env);
const rawForwardedArgs = process.argv.slice(2);
const forwardedArgs = rawForwardedArgs[0] === '--' ? rawForwardedArgs.slice(1) : rawForwardedArgs;

ensureCargoBinInPath(env);

const chosenNode = pickModernNode(env, 18);
try {
  const nodeDir = path.dirname(chosenNode.nodeExe);
  prependToPath(env, nodeDir);
  env.SHOTSTYLE_NODE = chosenNode.nodeExe;
  if (chosenNode.version?.major) {
    console.log(`[tauri-build] Using Node: ${chosenNode.nodeExe} (v${chosenNode.version.major}.${chosenNode.version.minor}.${chosenNode.version.patch})`);
  }
} catch {}

if (isMac && !isGitHubActions) {
  applyMacTauriEnv(env, { logPrefix: 'tauri-build' });
}

// Keep common build artifacts on the workspace volume when possible for local builds.
// CI release jobs should use Tauri's default target layout so the action can locate bundles.
if (!isGitHubActions) {
  try {
    const repoRoot = path.resolve(__dirname, '..');
    const tmpDir = path.resolve(repoRoot, 'build-temp', 'shotstyle-tmp');
    const cargoTargetDir = (() => {
      const override = String(env.SHOTSTYLE_CARGO_TARGET_DIR || '').trim();
      if (override) return path.resolve(override);
      const useApfsTarget = String(env.SHOTSTYLE_USE_APFS_CARGO || '').trim() === '1';
      if (useApfsTarget) {
        const apfsTarget = ensureMacCargoTargetOnApfs({ repoRoot, logPrefix: 'tauri-build' });
        if (apfsTarget) return apfsTarget;
      }
      return path.resolve(repoRoot, 'build-temp', 'cargo-target');
    })();

    fs.mkdirSync(tmpDir, { recursive: true });
    fs.mkdirSync(cargoTargetDir, { recursive: true });

    env.TMPDIR = env.TMPDIR || tmpDir;
    env.CARGO_TARGET_DIR = env.CARGO_TARGET_DIR || cargoTargetDir;

    console.log(`[tauri-build] TMPDIR=${env.TMPDIR}`);
    console.log(`[tauri-build] CARGO_TARGET_DIR=${env.CARGO_TARGET_DIR}`);
  } catch {}
}

// Work around macOS AppleDouble sidecar files on non-APFS volumes (exFAT/SMB).
const appleDoubleScrubber = (() => {
  try {
    if (process.platform !== 'darwin') return null;
    if (!env.CARGO_TARGET_DIR) return null;
    return startAppleDoubleScrubber({ cargoTargetDir: env.CARGO_TARGET_DIR, logPrefix: 'tauri-build' });
  } catch {
    return null;
  }
})();

const isWin = process.platform === 'win32';

const cmd = (() => {
  if (isWin) return 'cmd';
  // Avoid depending on a global `npx` (which can point at an old Node install).
  return chosenNode.nodeExe || process.execPath;
})();
const args = (() => {
  if (!isWin) {
    const tauriCli = path.resolve(__dirname, '..', 'node_modules', '@tauri-apps', 'cli', 'tauri.js');
    return [tauriCli, 'build', ...forwardedArgs];
  }
  return resolveWindowsTauriArgs({ env, tauriSubcommand: 'build', forwardedArgs });
})();

const child = spawn(cmd, args, {
  stdio: 'inherit',
  env,
});

child.on('exit', (code) => {
  try { appleDoubleScrubber?.stop?.(); } catch {}
  process.exit(code ?? 0);
});

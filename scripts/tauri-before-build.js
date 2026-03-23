#!/usr/bin/env node
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const { platformKey } = require('./lib/platform');
const { pickModernNode, prependToPath } = require('./lib/nodeRuntime');

// VS Code tasks on macOS often don't load shell init, so `npm` can end up running under
// an older system Node. Vite 5 expects `crypto.getRandomValues` on the Node crypto module
// (available in newer Node versions), so we proactively select a modern Node and prepend
// its bin dir to PATH.
const env = { ...process.env };
try {
  const chosenNode = pickModernNode(env, 20);
  const nodeDir = path.dirname(chosenNode.nodeExe);
  prependToPath(env, nodeDir);
  env.SHOTSTYLE_NODE = chosenNode.nodeExe;
} catch {}

const { npmCmd } = (() => {
  try {
    // eslint-disable-next-line global-require, import/no-dynamic-require
    return require(`../platform/${platformKey}/node/npmCmd`);
  } catch {
    return { npmCmd: 'npm' };
  }
})();

const normalizeChildEnv = (baseEnv) => {
  if (process.platform !== 'win32') return baseEnv;

  const normalized = {};
  for (const [key, value] of Object.entries(baseEnv)) {
    if (value == null) continue;
    const normalizedKey = key.toLowerCase() === 'path' ? 'Path' : key;
    normalized[normalizedKey] = String(value);
  }
  return normalized;
};

const childEnv = normalizeChildEnv(env);

function run(cmd, args, onClose) {
  const needsShell = process.platform === 'win32' && /\.(cmd|bat)$/i.test(cmd);
  const proc = spawn(cmd, args, {
    stdio: 'inherit',
    env: childEnv,
    shell: needsShell,
  });
  proc.on('close', code => onClose(code));
}

const moduleDirFromName = (baseDir, pkgName) => {
  const parts = String(pkgName || '').split('/').filter(Boolean);
  if (!parts.length) return null;
  return path.resolve(baseDir, 'node_modules', ...parts);
};

const getMissingModules = (baseDir, packageNames = []) => packageNames.filter((name) => {
  const p = moduleDirFromName(baseDir, name);
  return !p || !fs.existsSync(p);
});

const repoRoot = path.resolve(__dirname, '..');
const uiDir = path.resolve(repoRoot, 'ui');
const viteBin = path.resolve(uiDir, 'node_modules', 'vite', 'bin', 'vite.js');

if (!fs.existsSync(viteBin)) {
  console.warn('[tauri-build] UI dependencies were not found.');
  console.warn(`[tauri-build] Missing file: ${viteBin}`);
  console.log('[tauri-build] Installing ui dependencies...');
  run(npmCmd, ['--prefix', uiDir, 'install'], installCode => {
    if (installCode !== 0) {
      console.error(`[tauri-build] Failed to install ui dependencies (exit ${installCode}).`);
      process.exit(installCode || 1);
      return;
    }

    if (!fs.existsSync(viteBin)) {
      console.error('[tauri-build] ui dependencies installed but Vite binary is still missing.');
      process.exit(1);
      return;
    }

    console.log('Building desktop UI (Vite) into ./build...');
    run(npmCmd, ['--prefix', uiDir, 'run', 'build', '--', '--outDir', path.resolve(repoRoot, 'build'), '--emptyOutDir'], code => {
      process.exit(code);
    });
  });
  return;
}

const requiredRootModules = ['@theme-toggles/react', 'perfect-freehand'];
const missingRootModules = getMissingModules(repoRoot, requiredRootModules);
if (missingRootModules.length > 0) {
  console.warn('[tauri-build] Root dependencies required by shared UI components are missing.');
  console.warn(`[tauri-build] Missing modules: ${missingRootModules.join(', ')}`);
  console.log('[tauri-build] Installing root workspace dependencies...');
  run(npmCmd, ['install'], installCode => {
    if (installCode !== 0) {
      console.error(`[tauri-build] Failed to install root dependencies (exit ${installCode}).`);
      process.exit(installCode || 1);
      return;
    }

    const stillMissing = getMissingModules(repoRoot, requiredRootModules);
    if (stillMissing.length > 0) {
      console.error(`[tauri-build] Root dependencies still missing after install: ${stillMissing.join(', ')}`);
      process.exit(1);
      return;
    }

    console.log('Building desktop UI (Vite) into ./build...');
    run(npmCmd, ['--prefix', uiDir, 'run', 'build', '--', '--outDir', path.resolve(repoRoot, 'build'), '--emptyOutDir'], code => {
      process.exit(code);
    });
  });
  return;
}

console.log('Building desktop UI (Vite) into ./build...');
run(npmCmd, ['--prefix', uiDir, 'run', 'build', '--', '--outDir', path.resolve(repoRoot, 'build'), '--emptyOutDir'], code => {
  process.exit(code);
});

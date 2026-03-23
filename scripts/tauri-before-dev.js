#!/usr/bin/env node
const http = require('http');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const { platformKey, isWin } = require('./lib/platform');
const { pickModernNode } = require('./lib/nodeRuntime');

const { npmCmd } = (() => {
  try {
    // eslint-disable-next-line global-require, import/no-dynamic-require
    return require(`../platform/${platformKey}/node/npmCmd`);
  } catch {
    return { npmCmd: 'npm' };
  }
})();

const platform = (() => {
  try {
    // eslint-disable-next-line global-require, import/no-dynamic-require
    return require(`../platform/${platformKey}/node/tauriBeforeDev`);
  } catch {
    return {
      shouldRestartExistingDevServer: () => false,
      killPort: () => 0,
      applyNextWatcherEnv: (env) => ({ ...env }),
      getNextDevSpawn: ({ nodeExe, nextBin, port }) => ({ cmd: nodeExe, args: [nextBin, 'dev', '-p', String(port)] }),
    };
  }
})();

const PORT = process.env.PORT || 3002;
const options = { method: 'HEAD', host: 'localhost', port: PORT };

const httpRequest = (method, pathName) => new Promise((resolve, reject) => {
  const req = http.request(
    { method, host: 'localhost', port: PORT, path: pathName },
    (res) => {
      // Drain data to allow socket reuse.
      res.on('data', () => {});
      res.on('end', () => resolve(res.statusCode || 0));
    },
  );
  req.on('error', reject);
  req.end();
});

const isHealthyStatusCode = (code) => {
  const n = Number(code);
  if (!Number.isFinite(n)) return false;
  // Any 2xx/3xx/4xx means the server is alive.
  // 5xx usually indicates a broken/stale dev server (often from a previous run).
  return n >= 200 && n < 500;
};

const waitForHealthyDevServer = async ({ timeoutMs = 20_000, pollMs = 250 } = {}) => {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const code = await httpRequest('HEAD', '/');
      if (isHealthyStatusCode(code)) return { ok: true, statusCode: code };
    } catch {}
    await new Promise((r) => setTimeout(r, pollMs));
  }
  return { ok: false };
};

// Node discovery is handled by scripts/lib/nodeRuntime + platform/* modules.

// Guard against duplicate invocations starting two Next dev servers.
// This can happen when previous tauri:dev runs didn't exit cleanly or when
// multiple processes run BeforeDevCommand concurrently.
const lockPath = path.join(os.tmpdir(), `shotstyle-ui-dev-${PORT}.lock`);
let lockFd = null;

const isPidRunning = (pid) => {
  const n = Number(pid);
  if (!Number.isFinite(n) || n <= 0) return false;
  try {
    // Works cross-platform: throws if process doesn't exist or access denied.
    process.kill(n, 0);
    return true;
  } catch {
    return false;
  }
};

const tryReadLockMeta = () => {
  try {
    const raw = fs.readFileSync(lockPath, 'utf8');
    const meta = JSON.parse(String(raw || '{}'));
    return meta && typeof meta === 'object' ? meta : null;
  } catch {
    return null;
  }
};

const isLockStale = () => {
  try {
    const stat = fs.statSync(lockPath);
    const ageMs = Date.now() - Number(stat.mtimeMs || 0);
    // If the lock hasn't been updated in a while, assume it's stale.
    if (Number.isFinite(ageMs) && ageMs > 2 * 60 * 1000) return true;
  } catch {}

  const meta = tryReadLockMeta();
  const pid = meta?.pid;
  if (pid && !isPidRunning(pid)) return true;
  return false;
};
try {
  lockFd = fs.openSync(lockPath, 'wx');
} catch {
  // Another instance is already handling dev-server lifecycle.
  // If that instance crashed, a stale lock can leave tauri dev waiting forever.
  if (isLockStale()) {
    try { fs.unlinkSync(lockPath); } catch {}
    try {
      lockFd = fs.openSync(lockPath, 'wx');
    } catch {
      // Couldn't recover the lock; fall through to waiting for a healthy server.
    }
  }

  // If we still don't have the lock, do not exit immediately.
  // Instead, wait for the dev server to become healthy so Tauri doesn't boot to a blank window.
  if (lockFd == null) {
    // eslint-disable-next-line no-use-before-define
    waitForHealthyDevServer({ timeoutMs: 25_000 })
      .then((res) => {
        if (res?.ok) {
          process.exit(0);
        } else {
          process.exit(1);
        }
      })
      .catch(() => process.exit(1));
    return;
  }
}

// Record metadata for stale-lock detection.
try {
  fs.writeFileSync(lockPath, JSON.stringify({ pid: process.pid, createdAt: Date.now(), port: Number(PORT) || PORT }), 'utf8');
} catch {}
const releaseLock = () => {
  try { if (lockFd != null) fs.closeSync(lockFd); } catch {}
  lockFd = null;
  try { fs.unlinkSync(lockPath); } catch {}
};
process.on('exit', releaseLock);
process.on('SIGINT', () => { releaseLock(); process.exit(0); });
process.on('SIGTERM', () => { releaseLock(); process.exit(0); });

const warmUpDevRoutes = async () => {};

const moduleDirFromName = (baseDir, pkgName) => {
  const parts = String(pkgName || '').split('/').filter(Boolean);
  if (!parts.length) return null;
  return path.resolve(baseDir, 'node_modules', ...parts);
};

const getMissingModules = (baseDir, packageNames = []) => packageNames.filter((name) => {
  const p = moduleDirFromName(baseDir, name);
  return !p || !fs.existsSync(p);
});

const startUiExperimentationDev = () => {
  if (startUiExperimentationDev._started) return;
  startUiExperimentationDev._started = true;
  console.log(`Port ${PORT} not responding; starting UI Experimentation dev (Vite)...`);

  const chosenNode = pickModernNode(process.env, 18);
  const ver = chosenNode.version;

  if (!ver || !Number.isFinite(ver.major) || ver.major < 18) {
    console.error('[tauri-dev] UI Experimentation dev requires Node >= 18.');
    console.error(`[tauri-dev] Current Node: ${process.execPath} (${process.versions.node})`);
    console.error('[tauri-dev] Set SHOTSTYLE_NODE=/absolute/path/to/node18+ and retry.');
    releaseLock();
    process.exit(1);
    return;
  }

  const cwd = path.resolve(__dirname, '..');
  const uiCwd = path.resolve(cwd, 'ui');

  // Avoid relying on the global `npm` shim (which can be pinned to an old Node install).
  // Instead, run the workspace-local Vite CLI directly using our chosen Node.
  const viteBin = path.resolve(uiCwd, 'node_modules', 'vite', 'bin', 'vite.js');
  if (!fs.existsSync(viteBin)) {
    console.warn('[tauri-dev] UI dependencies were not found.');
    console.warn(`[tauri-dev] Missing file: ${viteBin}`);
    console.log('[tauri-dev] Installing ui dependencies...');
    const installCmd = isWin ? 'cmd' : npmCmd;
    const installArgs = isWin
      ? ['/c', npmCmd, '--prefix', uiCwd, 'install']
      : ['--prefix', uiCwd, 'install'];
    const install = spawn(
      installCmd,
      installArgs,
      { stdio: 'inherit', env: process.env, shell: false },
    );

    install.on('close', (installCode) => {
      if (installCode !== 0) {
        console.error(`[tauri-dev] Failed to install ui dependencies (exit ${installCode}).`);
        releaseLock();
        process.exit(installCode || 1);
        return;
      }

      if (!fs.existsSync(viteBin)) {
        console.error('[tauri-dev] ui dependencies installed but Vite binary is still missing.');
        releaseLock();
        process.exit(1);
        return;
      }

      startUiExperimentationDev._started = false;
      startUiExperimentationDev();
    });
    return;
  }

  const requiredRootModules = ['@theme-toggles/react', 'perfect-freehand'];
  const missingRootModules = getMissingModules(cwd, requiredRootModules);
  if (missingRootModules.length > 0) {
    console.warn('[tauri-dev] Root dependencies required by shared UI components are missing.');
    console.warn(`[tauri-dev] Missing modules: ${missingRootModules.join(', ')}`);
    console.log('[tauri-dev] Installing root workspace dependencies...');

    const rootInstallCmd = isWin ? 'cmd' : npmCmd;
    const rootInstallArgs = isWin ? ['/c', npmCmd, 'install'] : ['install'];
    const rootInstall = spawn(rootInstallCmd, rootInstallArgs, { stdio: 'inherit', env: process.env, cwd, shell: false });

    rootInstall.on('close', (installCode) => {
      if (installCode !== 0) {
        console.error(`[tauri-dev] Failed to install root dependencies (exit ${installCode}).`);
        releaseLock();
        process.exit(installCode || 1);
        return;
      }

      const stillMissing = getMissingModules(cwd, requiredRootModules);
      if (stillMissing.length > 0) {
        console.error(`[tauri-dev] Root dependencies still missing after install: ${stillMissing.join(', ')}`);
        releaseLock();
        process.exit(1);
        return;
      }

      startUiExperimentationDev._started = false;
      startUiExperimentationDev();
    });
    return;
  }

  const child = spawn(
    chosenNode.nodeExe || process.execPath,
    [viteBin, '--port', String(PORT), '--strictPort'],
    { stdio: 'inherit', env: process.env, cwd: uiCwd },
  );

  child.on('close', code => {
    releaseLock();
    process.exit(code);
  });
};

const req = http.request(options, res => {
  const shouldRestart = isWin && platform.shouldRestartExistingDevServer(process.env);
  if (!shouldRestart && isHealthyStatusCode(res.statusCode)) {
    console.log(`Dev server already running on port ${PORT} (status ${res.statusCode}); skipping start.`);
    process.exit(0);
    return;
  }

  if (!shouldRestart && !isHealthyStatusCode(res.statusCode)) {
    console.log(`Dev server on port ${PORT} looks unhealthy (status ${res.statusCode}); starting a fresh dev server...`);
    startUiExperimentationDev();
    return;
  }

  console.log(`Dev server already running on port ${PORT} (status ${res.statusCode}); restarting to apply watcher settings...`);
  const killed = platform.killPort(PORT);
  if (killed) {
    console.log(`Stopped ${killed} process(es) on port ${PORT}.`);
  }

  // Start a fresh dev server with the watcher env vars.
  startUiExperimentationDev();
});

req.on('error', () => {
  startUiExperimentationDev();
});

req.end();

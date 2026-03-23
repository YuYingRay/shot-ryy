const { execSync } = require('child_process');

const shouldRestartExistingDevServer = (env) => String(env.SHOTSTYLE_RESTART_DEV_SERVER || '') === '1';

const killPort = (port) => {
  try {
    const out = execSync(`netstat -aon | findstr :${port}`, { encoding: 'utf8' });
    const pids = new Set();

    for (const line of String(out || '').split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      // Only kill the LISTENING server process.
      const parts = trimmed.split(/\s+/);
      if (parts.length < 5) continue;

      const proto = String(parts[0] || '').toUpperCase();
      const local = String(parts[1] || '');
      const state = String(parts[3] || '').toUpperCase();
      const pid = String(parts[4] || '');

      if (proto !== 'TCP') continue;
      if (!local.endsWith(`:${port}`)) continue;
      if (state !== 'LISTENING') continue;
      if (pid && /^\d+$/.test(pid)) pids.add(pid);
    }

    for (const pid of pids) {
      try {
        execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore' });
      } catch {}
    }

    return pids.size;
  } catch {
    return 0;
  }
};

const applyNextWatcherEnv = (env) => ({
  ...env,
  // Reduce Watchpack/webpack filesystem watcher flakiness.
  // Polling avoids attempting to lstat protected system files like pagefile.sys.
  WATCHPACK_POLLING: env.WATCHPACK_POLLING || 'true',
  WATCHPACK_POLLING_INTERVAL: env.WATCHPACK_POLLING_INTERVAL || '1000',
  CHOKIDAR_USEPOLLING: env.CHOKIDAR_USEPOLLING || 'true',
  CHOKIDAR_INTERVAL: env.CHOKIDAR_INTERVAL || '1000',
});

const getNextDevSpawn = ({ port }) => ({
  cmd: 'cmd',
  args: ['/c', 'npm', 'run', 'dev'],
  port,
});

module.exports = {
  shouldRestartExistingDevServer,
  killPort,
  applyNextWatcherEnv,
  getNextDevSpawn,
};

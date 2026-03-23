const shouldRestartExistingDevServer = (_env) => false;
const killPort = (_port) => 0;
const applyNextWatcherEnv = (env) => ({ ...env });

const getNextDevSpawn = ({ nodeExe, nextBin, port }) => ({
  cmd: nodeExe,
  args: [nextBin, 'dev', '-p', String(port)],
});

module.exports = {
  shouldRestartExistingDevServer,
  killPort,
  applyNextWatcherEnv,
  getNextDevSpawn,
};

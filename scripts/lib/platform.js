const platformKey = (() => {
  if (process.platform === 'darwin') return 'macos';
  if (process.platform === 'win32') return 'windows';
  if (process.platform === 'linux') return 'linux';
  return 'unknown';
})();

module.exports = {
  platformKey,
  isMac: platformKey === 'macos',
  isWin: platformKey === 'windows',
  isLinux: platformKey === 'linux',
};

const fs = require('fs');
const os = require('os');
const path = require('path');

const addPlatformNodeCandidates = (add) => {
  // Common Linux locations.
  add(path.join(os.homedir(), '.volta', 'bin', 'node'));
  add('/usr/local/bin/node');
  add('/usr/bin/node');

  // nvm
  try {
    const nvmBase = path.join(os.homedir(), '.nvm', 'versions', 'node');
    if (fs.existsSync(nvmBase)) {
      const dirs = fs
        .readdirSync(nvmBase, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name)
        .sort();
      for (const d of dirs.reverse()) {
        add(path.join(nvmBase, d, 'bin', 'node'));
      }
    }
  } catch {}

  // asdf
  try {
    const asdfBase = path.join(os.homedir(), '.asdf', 'installs', 'nodejs');
    if (fs.existsSync(asdfBase)) {
      const dirs = fs
        .readdirSync(asdfBase, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name)
        .sort();
      for (const d of dirs.reverse()) {
        add(path.join(asdfBase, d, 'bin', 'node'));
      }
    }
  } catch {}
};

module.exports = { addPlatformNodeCandidates };

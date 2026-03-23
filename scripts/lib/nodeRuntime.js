const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const { platformKey } = require('./platform');

const parseNodeVersion = (raw) => {
  const s = String(raw || '').trim();
  const m = s.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) };
};

const getNodeVersion = (nodeExe) => {
  try {
    const out = execFileSync(nodeExe, ['-p', 'process.versions.node'], { encoding: 'utf8' });
    return parseNodeVersion(out);
  } catch {
    return null;
  }
};

const pickModernNode = (env, minMajor = 18) => {
  const seen = new Set();
  const candidates = [];

  const add = (p) => {
    if (!p) return;
    const s = String(p);
    if (!s || seen.has(s)) return;
    seen.add(s);
    candidates.push(s);
  };

  add(env.SHOTSTYLE_NODE);
  add(process.execPath);

  // Delegate platform-specific node discovery to platform/* modules.
  try {
    const nodePathsMod = path.resolve(__dirname, '..', '..', 'platform', platformKey, 'node', 'nodePaths.js');
    // eslint-disable-next-line global-require, import/no-dynamic-require
    const { addPlatformNodeCandidates } = require(nodePathsMod);
    if (typeof addPlatformNodeCandidates === 'function') {
      addPlatformNodeCandidates(add, env);
    }
  } catch {}

  let best = null;
  let bestVer = null;
  for (const c of candidates) {
    if (!fs.existsSync(c)) continue;
    const v = getNodeVersion(c);
    if (!v || !Number.isFinite(v.major)) continue;
    if (v.major < minMajor) continue;
    if (
      !bestVer ||
      v.major > bestVer.major ||
      (v.major === bestVer.major && v.minor > bestVer.minor) ||
      (v.major === bestVer.major && v.minor === bestVer.minor && v.patch > bestVer.patch)
    ) {
      best = c;
      bestVer = v;
    }
  }

  return { nodeExe: best || process.execPath, version: bestVer || getNodeVersion(process.execPath) };
};

const pathKeyForEnv = (env) => Object.keys(env).find((k) => k.toLowerCase() === 'path') || 'Path';

const prependToPath = (env, dir) => {
  if (!dir) return;
  const pathKey = pathKeyForEnv(env);
  const existing = String(env[pathKey] || '');
  const parts = existing.split(path.delimiter).filter(Boolean);
  if (parts.includes(dir)) return;
  env[pathKey] = `${dir}${existing ? path.delimiter : ''}${existing}`;
};

const ensureCargoBinInPath = (env) => {
  const cargoBin = path.join(process.env.USERPROFILE || '', '.cargo', 'bin');
  const pathKey = pathKeyForEnv(env);
  const currentPath = String(env[pathKey] || '');
  if (cargoBin && !currentPath.toLowerCase().includes(cargoBin.toLowerCase())) {
    env[pathKey] = `${currentPath}${currentPath ? path.delimiter : ''}${cargoBin}`;
  }
};

module.exports = {
  pickModernNode,
  prependToPath,
  ensureCargoBinInPath,
  pathKeyForEnv,
};

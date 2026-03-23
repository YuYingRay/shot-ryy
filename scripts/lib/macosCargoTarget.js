const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const isMac = process.platform === 'darwin';

const safeMkdirp = (dirPath) => {
  try {
    fs.mkdirSync(dirPath, { recursive: true });
  } catch {}
};

const isMounted = (mountPoint) => {
  try {
    // `mount` output includes lines like: 
    // /dev/diskXsY on /Volumes/shotstyle-cargo (apfs, local, ...)
    const out = execFileSync('mount', { encoding: 'utf8' });
    return String(out).split('\n').some((line) => line.includes(` on ${mountPoint} `));
  } catch {
    return false;
  }
};

const ensureSparsebundleExists = ({ sparsebundlePath, size = '80g', volname = 'shotstyle-cargo' }) => {
  if (fs.existsSync(sparsebundlePath)) return;
  safeMkdirp(path.dirname(sparsebundlePath));
  execFileSync(
    'hdiutil',
    ['create', '-type', 'SPARSEBUNDLE', '-fs', 'APFS', '-size', String(size), '-volname', String(volname), sparsebundlePath],
    { stdio: 'inherit' },
  );
};

const attachSparsebundle = ({ sparsebundlePath }) => {
  // Note: Some systems disallow mounting disk images into custom mountpoints
  // under other volumes (e.g. /Volumes/M). Attaching without -mountpoint mounts
  // at /Volumes/<volname>, which is reliable.
  execFileSync('hdiutil', ['attach', sparsebundlePath, '-nobrowse'], { stdio: 'inherit' });
};

/**
 * Ensures Cargo build artifacts can live on a macOS APFS filesystem even when
 * the workspace is on a non-APFS volume (exFAT/SMB) that emits AppleDouble `._*`
 * sidecar files which break Tauri's permission TOML parsing.
 *
 * Stores a sparsebundle *in the repo* (so it's on /Volumes/M) and mounts it at
 * `repoRoot/build-temp/shotstyle-cargo-apfs`.
 */
function ensureMacCargoTargetOnApfs({ repoRoot, logPrefix = 'tauri' } = {}) {
  if (!isMac) return null;
  if (!repoRoot) return null;

  const buildTemp = path.resolve(repoRoot, 'build-temp');
  const sparsebundlePath = path.resolve(buildTemp, 'shotstyle-cargo.apfs.sparsebundle');
  const mountPoint = path.resolve('/Volumes', 'shotstyle-cargo');

  try {
    ensureSparsebundleExists({ sparsebundlePath });

    if (!isMounted(mountPoint)) {
      attachSparsebundle({ sparsebundlePath });
    }

    const cargoTargetDir = path.resolve(mountPoint, 'cargo-target');
    safeMkdirp(cargoTargetDir);

    // Probe for real writeability. Some mounted images can appear present but
    // still fail with OS-level byte-sequence/write errors when Cargo writes.
    // If probe fails, return null so callers fall back to a regular local dir.
    const probeFile = path.resolve(cargoTargetDir, '.shotstyle-write-probe');
    try {
      fs.writeFileSync(probeFile, 'ok');
      fs.rmSync(probeFile, { force: true });
    } catch (probeErr) {
      try {
        console.warn(`[${logPrefix}] APFS cargo target not writable; falling back.`, String(probeErr?.message || probeErr));
      } catch {}
      return null;
    }

    try {
      console.log(`[${logPrefix}] Using APFS cargo target image: ${mountPoint}`);
    } catch {}

    return cargoTargetDir;
  } catch (e) {
    try {
      console.warn(`[${logPrefix}] Failed to mount APFS cargo target; falling back.`, String(e?.message || e));
    } catch {}
    return null;
  }
}

module.exports = {
  ensureMacCargoTargetOnApfs,
};

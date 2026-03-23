const fs = require('fs');
const path = require('path');

const isMac = process.platform === 'darwin';

const safeReaddir = (dirPath) => {
  try {
    return fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return null;
  }
};

const safeOverwriteUtf8 = (filePath, content) => {
  try {
    fs.writeFileSync(filePath, content, { encoding: 'utf8' });
    return true;
  } catch {
    return false;
  }
};

const scrubAppleDoubleTomlsRecursively = (rootDir, maxDepth) => {
  if (!rootDir) return 0;
  if (maxDepth <= 0) return 0;

  const entries = safeReaddir(rootDir);
  if (!entries) return 0;

  let scrubbed = 0;

  for (const ent of entries) {
    const full = path.resolve(rootDir, ent.name);
    if (ent.isDirectory()) {
      scrubbed += scrubAppleDoubleTomlsRecursively(full, maxDepth - 1);
      continue;
    }
    if (!ent.isFile()) continue;
    if (!ent.name.startsWith('._')) continue;
    if (!ent.name.endsWith('.toml')) continue;
    const ok = safeOverwriteUtf8(full, '# scrubbed AppleDouble sidecar\n');
    if (ok) scrubbed += 1;
  }

  return scrubbed;
};

const scrubTauriPermissions = (cargoTargetDir) => {
  const buildDir = path.resolve(cargoTargetDir, 'debug', 'build');
  const buildEntries = safeReaddir(buildDir);
  if (!buildEntries) return 0;

  let scrubbed = 0;

  for (const ent of buildEntries) {
    if (!ent.isDirectory()) continue;
    // Both "tauri-<hash>" and "tauri-<hash>" (build-script output) can exist.
    if (!ent.name.startsWith('tauri-')) continue;

    const permissionsRoot = path.resolve(buildDir, ent.name, 'out', 'permissions');
    scrubbed += scrubAppleDoubleTomlsRecursively(permissionsRoot, 10);
  }

  return scrubbed;
};

/**
 * On non-APFS volumes, macOS can create AppleDouble `._*` sidecar files.
 * Tauri's v2 permission build script tries to parse every `*.toml` it sees,
 * and crashes when it hits a binary AppleDouble file like `._default.toml`.
 *
 * This scrubber deletes those sidecars as they appear.
 */
function startAppleDoubleScrubber({ cargoTargetDir, logPrefix = 'tauri' } = {}) {
  if (!isMac) return { stop: () => {} };
  if (!cargoTargetDir) return { stop: () => {} };

  let timer = null;
  let ticks = 0;

  const tick = () => {
    ticks += 1;
    const scrubbed = scrubTauriPermissions(cargoTargetDir);
    if (scrubbed > 0) {
      try {
        console.log(`[${logPrefix}] Scrubbed ${scrubbed} AppleDouble (._*.toml) files from Tauri permissions output`);
      } catch {}
    }

    // Keep it aggressive early (when permissions are generated), then back off.
    const intervalMs = ticks < 200 ? 50 : 250;
    timer = setTimeout(tick, intervalMs);
  };

  // Start immediately.
  timer = setTimeout(tick, 10);

  return {
    stop: () => {
      try {
        if (timer) clearTimeout(timer);
      } catch {}
      timer = null;
    },
  };
}

module.exports = {
  startAppleDoubleScrubber,
};

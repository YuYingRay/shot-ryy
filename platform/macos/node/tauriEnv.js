const fs = require('fs');
const os = require('os');
const path = require('path');

const ensureWritableDir = (dirPath) => {
  try {
    fs.mkdirSync(dirPath, { recursive: true });
  } catch {
    return false;
  }

  // `mkdir` can succeed even when the volume is out of space (directory already exists).
  // Write a tiny file to confirm the directory is actually usable.
  const probe = path.join(dirPath, `.shotstyle-probe-${process.pid}-${Date.now()}.tmp`);
  try {
    fs.writeFileSync(probe, 'ok', 'utf8');
    fs.unlinkSync(probe);
    return true;
  } catch {
    try { fs.unlinkSync(probe); } catch {}
    return false;
  }
};

const applyMacTauriEnv = (env, { logPrefix } = {}) => {
  const prefix = logPrefix || 'tauri';

  const userTmpOverride = env.SHOTSTYLE_TMPDIR;
  const userTargetOverride = env.SHOTSTYLE_CARGO_TARGET_DIR;
  const respectExisting = env.SHOTSTYLE_RESPECT_EXISTING_CARGO_DIRS === '1';

  // IMPORTANT: Many developers keep the repo on ExFAT (external drives). ExFAT
  // causes macOS to create AppleDouble files (._*) for xattrs, and Tauri's build
  // will panic when it tries to parse those as UTF-8 TOML. To avoid this, keep
  // Cargo artifacts on the APFS home volume.
  const defaultTmpDir = path.join(os.homedir(), 'Library', 'Caches', 'shotstyle', 'tmp');
  const defaultTargetDir = path.join(os.homedir(), 'Library', 'Caches', 'shotstyle', 'cargo-target');

  // Do not inherit the system TMPDIR (/var/folders/...) by default because it
  // sits on the system volume, which is frequently near-full on dev machines.
  let tmpDir = userTmpOverride || (respectExisting ? env.TMPDIR : undefined) || defaultTmpDir;

  // Similarly, prefer our target dir unless the user explicitly wants to
  // respect an externally-provided CARGO_TARGET_DIR.
  const existingTargetDir = respectExisting ? env.CARGO_TARGET_DIR : undefined;
  let targetDir = userTargetOverride || existingTargetDir || defaultTargetDir;

  // If the home volume is full, using ~/Library/Caches/... can break dev (ENOSPC).
  // Fall back to repo-local build-temp paths when the preferred dirs aren't writable.
  const repoRoot = (() => {
    try { return process.cwd(); } catch { return null; }
  })();
  const repoFallbackBase = repoRoot ? path.join(repoRoot, 'build-temp', 'macos-cache') : null;
  const fallbackTmpDir = repoFallbackBase ? path.join(repoFallbackBase, 'tmp') : null;
  const fallbackTargetDir = repoFallbackBase ? path.join(repoFallbackBase, 'cargo-target') : null;

  if (!ensureWritableDir(tmpDir) && fallbackTmpDir) {
    tmpDir = fallbackTmpDir;
  }
  if (!ensureWritableDir(targetDir) && fallbackTargetDir) {
    targetDir = fallbackTargetDir;
  }

  env.TMPDIR = tmpDir;
  env.CARGO_TARGET_DIR = targetDir;
  // Prevent AppleDouble (._*) files from being generated during file copies.
  env.COPYFILE_DISABLE = '1';

  // Dirs already validated via ensureWritableDir above.

  if (env.TMPDIR && env.CARGO_TARGET_DIR) {
    console.log(`[${prefix}] Using TMPDIR: ${env.TMPDIR}`);
    console.log(`[${prefix}] Using CARGO_TARGET_DIR: ${env.CARGO_TARGET_DIR}`);
  }
};

module.exports = { applyMacTauriEnv };

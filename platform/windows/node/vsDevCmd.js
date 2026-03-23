const fs = require('fs');
const os = require('os');
const path = require('path');

const findVsDevCmd = () => {
  try {
    const vswhere = path.join(
      process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)',
      'Microsoft Visual Studio',
      'Installer',
      'vswhere.exe'
    );
    if (fs.existsSync(vswhere)) {
      const out = require('child_process')
        .execSync(
          `"${vswhere}" -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath`,
          { encoding: 'utf8' }
        )
        .trim();
      if (out) {
        const candidate = path.join(out, 'Common7', 'Tools', 'VsDevCmd.bat');
        if (fs.existsSync(candidate)) return candidate;
      }
    }
  } catch {}

  const candidates = [
    process.env.VSINSTALLDIR,
    'C:\\Program Files (x86)\\Microsoft Visual Studio\\2022\\BuildTools',
    'C:\\Program Files\\Microsoft Visual Studio\\2022\\BuildTools',
    'C:\\Program Files (x86)\\Microsoft Visual Studio\\2022\\Community',
    'C:\\Program Files\\Microsoft Visual Studio\\2022\\Community',
  ].filter(Boolean);

  for (const base of candidates) {
    const candidate = path.join(base, 'Common7', 'Tools', 'VsDevCmd.bat');
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
};

const detectArm64Link = () => {
  try {
    const base = 'C:\\Program Files (x86)\\Microsoft Visual Studio\\2022\\BuildTools\\VC\\Tools\\MSVC';
    if (!fs.existsSync(base)) return false;
    const entries = fs.readdirSync(base, { withFileTypes: true }).filter((e) => e.isDirectory());
    return entries.some((entry) => fs.existsSync(path.join(base, entry.name, 'bin', 'Hostarm64', 'arm64', 'link.exe')));
  } catch {
    return false;
  }
};

const prepareVsDevCmdBootstrap = ({ vsDevCmd, tauriSubcommand, forwardedArgs = [] }) => {
  const scriptPath = path.join(os.tmpdir(), `shotstyle-tauri-${tauriSubcommand}.cmd`);
  const renderedArgs = forwardedArgs.map((arg) => {
    const value = String(arg);
    return /[\s"]/u.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
  }).join(' ');
  fs.writeFileSync(
    scriptPath,
    `@echo off\r\ncall "${vsDevCmd}" -no_logo -arch=%1 -host_arch=%2\r\nnpx tauri ${tauriSubcommand}${renderedArgs ? ` ${renderedArgs}` : ''}\r\n`,
    'utf8'
  );
  return scriptPath;
};

const resolveWindowsTauriArgs = ({ env, tauriSubcommand, forwardedArgs = [] }) => {
  const isArm64Host = String(process.env.PROCESSOR_ARCHITECTURE || '').toLowerCase() === 'arm64';
  const arm64LinkExists = detectArm64Link();
  const targetArch = isArm64Host && !arm64LinkExists ? 'x64' : isArm64Host ? 'arm64' : 'x64';
  const hostArch = isArm64Host ? 'arm64' : 'x64';

  if (isArm64Host && targetArch === 'x64') {
    env.RUSTUP_TOOLCHAIN = 'stable-x86_64-pc-windows-msvc';
    env.CARGO_BUILD_TARGET = 'x86_64-pc-windows-msvc';
  }

  const vsDevCmd = findVsDevCmd();
  if (vsDevCmd) {
    const scriptPath = prepareVsDevCmdBootstrap({ vsDevCmd, tauriSubcommand, forwardedArgs });
    console.log(`[tauri-${tauriSubcommand}] Using VsDevCmd: ${vsDevCmd}`);
    console.log(`[tauri-${tauriSubcommand}] Bootstrap script: ${scriptPath}`);
    return ['/c', scriptPath, targetArch, hostArch];
  }

  console.log(`[tauri-${tauriSubcommand}] VsDevCmd not found; running without VS env`);
  const command = ['npx', 'tauri', tauriSubcommand, ...forwardedArgs]
    .map((part) => {
      const value = String(part);
      return /[\s"]/u.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
    })
    .join(' ');
  return ['/c', command];
};

module.exports = {
  findVsDevCmd,
  resolveWindowsTauriArgs,
};

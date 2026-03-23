#!/usr/bin/env node
const { spawn } = require('child_process');
const path = require('path');

const command = process.argv[2];
const forwardedArgs = process.argv.slice(3);
const normalizedForwardedArgs = forwardedArgs[0] === '--' ? forwardedArgs.slice(1) : forwardedArgs;

const scriptByCommand = {
  build: 'tauri-build.js',
  dev: 'tauri-dev.js',
};

if (!scriptByCommand[command]) {
  console.error(`[tauri-cli] Unsupported command: ${command || '(missing)'}`);
  console.error('[tauri-cli] Supported commands: build, dev');
  process.exit(1);
}

const scriptPath = path.resolve(__dirname, scriptByCommand[command]);
const child = spawn(process.execPath, [scriptPath, ...normalizedForwardedArgs], {
  stdio: 'inherit',
  env: process.env,
});

child.on('exit', (code) => {
  process.exit(code ?? 0);
});
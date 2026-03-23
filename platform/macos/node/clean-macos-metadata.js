const { execSync } = require('child_process');

const isMac = process.platform === 'darwin';
if (!isMac) {
  process.exit(0);
}

const commands = [
  "find . -path './node_modules' -prune -o -path './.git' -prune -o -type f \\( -name '._*' -o -name '.__*' \\) -delete 2>/dev/null || true",
  "find ./build-temp -type f \\( -name '._*' -o -name '.__*' \\) -delete 2>/dev/null || true",
  "find \"$HOME/Library/Caches/shotstyle\" -type f \\( -name '._*' -o -name '.__*' \\) -delete 2>/dev/null || true",
];

for (const cmd of commands) {
  try {
    execSync(cmd, { stdio: 'inherit', shell: true });
  } catch {
    // Ignore cleanup errors on macOS volumes that don't exist.
  }
}

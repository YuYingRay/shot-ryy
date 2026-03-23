import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  // This repo uses JSX in some .js files (e.g. components/I18nContext.js).
  // Teach Vite's pipeline to parse those during Vitest runs.
  esbuild: {
    loader: 'jsx',
    jsx: 'automatic',
  },
  resolve: {
    alias: {
      'tauri-plugin-screenshots-api': path.resolve(__dirname, 'tests/mocks/tauri-plugin-screenshots-api.js'),
      '@theme-toggles/react': path.resolve(__dirname, 'tests/mocks/theme-toggles-react.js'),
      '@theme-toggles/react/css/Classic.css': path.resolve(__dirname, 'tests/mocks/empty-style.js'),
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.js'],
    include: ['tests/**/*.test.{js,jsx,ts,tsx}'],
    exclude: ['**/*.smoke.test.*', '**/node_modules/**', '**/dist/**', '**/build/**', '**/build-target/**', '**/build-temp/**', '**/._*'],
  },
});

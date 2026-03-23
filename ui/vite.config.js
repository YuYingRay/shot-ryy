import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  // This repo contains JSX in some `.js` files under the shared app (e.g. components/ThemeContext.js).
  // Tell Vite/esbuild to treat `.js` as JSX so import analysis + builds succeed.
  esbuild: {
    loader: 'jsx',
    jsx: 'automatic',
    include: /\.[jt]sx?$/,
  },
  optimizeDeps: {
    esbuildOptions: {
      loader: {
        '.js': 'jsx',
      },
      jsx: 'automatic',
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      ui: path.resolve(__dirname, '../ui'),
      classnames: path.resolve(__dirname, './node_modules/classnames/index.js'),
      'fast-average-color': path.resolve(__dirname, './node_modules/fast-average-color/dist/index.esm.js'),
      'hotkeys-js': path.resolve(__dirname, './node_modules/hotkeys-js/dist/hotkeys.esm.js'),
      'perfect-freehand': path.resolve(__dirname, './node_modules/perfect-freehand/dist/esm/index.mjs'),
    },
  },
  build: {
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'index.html'),
        settings: path.resolve(__dirname, 'settings.html'),
      },
    },
  },
  server: {
    fs: {
      // Allow importing shared app modules (components/, utils/, public assets) from the repo root.
      allow: [path.resolve(__dirname, '..')],
    },
  },
})
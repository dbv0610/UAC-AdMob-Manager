import { resolve } from 'node:path';
import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const shared = { '@shared': resolve('src/shared') };

export default defineConfig({
  main: {
    resolve: { alias: shared },
    build: { externalizeDeps: true },
  },
  preload: {
    resolve: { alias: shared },
    // sandbox: true chỉ chạy preload dạng CommonJS
    build: { externalizeDeps: true, rollupOptions: { output: { format: 'cjs', entryFileNames: '[name].cjs' } } },
  },
  renderer: {
    resolve: { alias: { ...shared, '@': resolve('src/renderer/src') } },
    plugins: [react(), tailwindcss()],
    // Không nhúng font/ảnh thành data: URI — CSP chỉ cho 'self'
    build: { assetsInlineLimit: 0 },
  },
});

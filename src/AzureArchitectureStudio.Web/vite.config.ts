import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    strictPort: true,
    // MSAL popup login needs the opener window to read the popup's URL.
    // Vite/Chromium can default to COOP: same-origin which severs the
    // opener reference and leaves the popup orphaned. Force the lax value.
    headers: {
      'Cross-Origin-Opener-Policy': 'unsafe-none',
      'Cross-Origin-Embedder-Policy': 'unsafe-none',
    },
    proxy: {
      '/api': {
        target: 'https://localhost:7203',
        changeOrigin: true,
        secure: false,
      },
      '/Design': {
        target: 'https://localhost:7203',
        changeOrigin: true,
        secure: false,
      },
      '/Deploy': {
        target: 'https://localhost:7203',
        changeOrigin: true,
        secure: false,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});

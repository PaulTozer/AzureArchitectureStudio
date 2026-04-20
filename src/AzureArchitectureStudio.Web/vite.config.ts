import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
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

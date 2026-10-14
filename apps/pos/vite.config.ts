import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    /**
     * En desarrollo, todo lo que empieza con /api se manda al API local.
     * Asi la aplicacion SIEMPRE llama a rutas relativas y funciona igual en
     * desarrollo, en la nube y dentro de la app del celular: sin CORS.
     */
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});

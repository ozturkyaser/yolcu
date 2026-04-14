import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  /** Relativ für Capacitor / file:-WebView (Asset-Pfade). */
  base: './',
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api': {
        target: process.env.VITE_PROXY_API ?? 'http://localhost:4000',
        changeOrigin: true,
        ws: true,
      },
    },
  },
})

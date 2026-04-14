import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

const __dirname = dirname(fileURLToPath(import.meta.url))

/** Für Docker/CI ohne `.git`: `VITE_APP_BUILD_NUMBER` setzen (z. B. `git rev-list --count HEAD`). */
function resolveBuildNumber(): string {
  const fromEnv = process.env.VITE_APP_BUILD_NUMBER?.trim()
  if (fromEnv && /^\d+$/.test(fromEnv)) return fromEnv
  try {
    const repoRoot = join(__dirname, '..')
    return execSync('git rev-list --count HEAD', {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return '0'
  }
}

const pkg = JSON.parse(readFileSync(join(__dirname, 'package.json'), 'utf8')) as { version?: string }
const appVersion = String(pkg.version ?? '0.0.0')
const buildNumber = resolveBuildNumber()

export default defineConfig({
  /** Relativ für Capacitor / file:-WebView (Asset-Pfade). */
  base: './',
  define: {
    __YOL_APP_VERSION__: JSON.stringify(appVersion),
    __YOL_BUILD_NUMBER__: JSON.stringify(buildNumber),
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Yol Arkadaşım',
        short_name: 'Yol Arkadaşım',
        description: 'Karte, Gruppen und Routen für unterwegs.',
        theme_color: '#003f87',
        background_color: '#003f87',
        display: 'standalone',
        orientation: 'portrait-primary',
        scope: './',
        start_url: './',
        lang: 'de',
        icons: [
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/^\/api\//],
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2,webmanifest}'],
      },
    }),
  ],
  server: {
    /** Port belegt (z. B. 5173): nächsten freien Port nehmen statt sofort abzubrechen. */
    strictPort: false,
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.VITE_PROXY_API ?? 'http://localhost:4000',
        changeOrigin: true,
        ws: true,
      },
    },
  },
})

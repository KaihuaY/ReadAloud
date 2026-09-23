import { execSync } from 'node:child_process'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import basicSsl from '@vitejs/plugin-basic-ssl'
import { defineConfig } from 'vite'

/** Short git commit sha for this checkout, or 'dev' outside a git repo (e.g. a source zip). */
function gitShortSha(): string {
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() || 'dev'
  } catch {
    return 'dev'
  }
}

// Shown at the bottom of Settings and recorded alongside automatic progress
// backups (see src/buildInfo.ts) so a parent can tell which build a device
// is running.
const APP_BUILD = `${gitShortSha()} ${new Date().toISOString().slice(0, 10)}`

// https://vite.dev/config/
export default defineConfig(({ command, mode }) => ({
  // GitHub Pages serves this project from /ReadAloud/, so production
  // builds need that base path. The dev server (and any other non-build
  // command) stays at '/' so local paths and HMR keep working.
  base: command === 'build' ? '/ReadAloud/' : '/',
  define: {
    __APP_BUILD__: JSON.stringify(APP_BUILD),
  },
  server: {
    // Listen on all interfaces so a phone/iPad on the same Wi-Fi can open
    // the dev server (e.g. http://<your-computer-ip>:5173, or
    // https://<your-computer-ip>:5173 via `npm run dev:https`) for quick
    // testing.
    host: true,
  },
  plugins: [
    react(),
    tailwindcss(),
    // Only active for `npm run dev:https` (mode === 'https'): Safari on
    // iPad requires a secure origin to grant microphone access, so this
    // self-signs a certificate for the LAN dev server. Not used for
    // production builds or the plain `npm run dev`.
    ...(mode === 'https' ? [basicSsl()] : []),
    VitePWA({
      // 'autoUpdate' would reload the page the moment a new build activates,
      // even mid-recording or mid-lesson - 'prompt' instead just flips
      // `needRefresh` (see src/components/UpdateBanner.tsx), which waits
      // until the kid is idle (and not recording) before ever offering the
      // update.
      registerType: 'prompt',
      includeAssets: ['favicon.svg'],
      workbox: {
        // Default is ['**/*.{js,wasm,css,html}'] - extended so the reward
        // collection's photos (src/content/collection.ts, downloaded by
        // scripts/fetch-collection.mjs) are precached for offline use too.
        globPatterns: ['**/*.{js,wasm,css,html}', 'collection/**/*.jpg'],
      },
      manifest: {
        name: 'Read Aloud',
        short_name: 'Read Aloud',
        description: 'Read a little every day',
        theme_color: '#0b122e',
        background_color: '#0b122e',
        display: 'standalone',
        start_url: '.',
        icons: [
          {
            src: 'icon-192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'icon-512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: 'icon-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'maskable',
          },
          {
            src: 'icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
    }),
  ],
}))

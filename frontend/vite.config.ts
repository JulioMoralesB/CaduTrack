import path from 'path'
// From vitest/config rather than vite, so the `test` block below type-checks.
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // injectManifest rather than generateSW: the products cache needs a
      // plugin that stamps the cache date, and generateSW's config is
      // serialised, so it cannot carry a function.
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'autoUpdate',
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico}'],
      },
      manifest: {
        name: 'CaduTrack',
        short_name: 'CaduTrack',
        description: 'Registra lo que compras y entérate antes de que caduque.',
        lang: 'es',
        start_url: '/',
        display: 'standalone',
        background_color: '#14170f',
        theme_color: '#3f7d3a',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          // Separate entries: a launcher crops maskable icons to its own shape,
          // so the same file cannot serve both purposes without losing edges.
          { src: '/icons/icon-192-maskable.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
          { src: '/icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  // Same proxy for `vite preview`, so the built bundle — the only build that
  // has a service worker — can be exercised against a real backend.
  preview: {
    proxy: {
      '/api': {
        target: 'http://localhost:8001',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
  server: {
    proxy: {
      // Keeps the app on a single origin in development, so requests to the
      // backend are same-origin and CORS never enters the picture.
      '/api': {
        target: 'http://localhost:8001',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.ts',
  },
})

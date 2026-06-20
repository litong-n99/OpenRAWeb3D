import { defineConfig, type Plugin } from 'vite'

// ---------------------------------------------------------------------------
// Custom plugin: /test/ URL routing (dev-only)
// ---------------------------------------------------------------------------

/**
 * Routes /test/ URLs to src/__e2e__/ for clean test page access.
 *
 * - /test/                → /src/__e2e__/manual/ (hub page)
 * - /test/manual/...      → /src/__e2e__/manual/... (sub pages)
 *
 * Old /src/__e2e__/manual/... URLs are blocked (404) to enforce the
 * canonical /test/ prefix.
 *
 * Dev mode: active. Build mode: no-op (test pages excluded from builds).
 */
function testRoutesPlugin(): Plugin {
  return {
    name: 'vite-plugin-test-routes',
    apply: 'serve',
    configureServer(server) {
      // Block old-style page URLs (HTML only — not JS/TS resources).
      server.middlewares.use((req, res, next) => {
        const url = req.url
        if (url && url.startsWith('/src/__e2e__/manual/')) {
          if (url.endsWith('/') || url.endsWith('.html')) {
            res.statusCode = 404
            res.end('Not Found. Please use /test/ instead.')
            return
          }
        }
        next()
      })

      // Rewrite /test/... → /src/__e2e__/manual/...
      server.middlewares.use((req, _res, next) => {
        const url = req.url
        if (url && url.startsWith('/test/')) {
          const subPath = url.slice('/test/'.length)
          req.url = `/src/__e2e__/manual/${subPath || 'index.html'}`
        }
        next()
      })
    },
  }
}

// ---------------------------------------------------------------------------
// Vite config
// ---------------------------------------------------------------------------

export default defineConfig(({ command }) => {
  const isDev = command === 'serve'

  return {
    build: {
      rollupOptions: {
        input: {
          main: 'index.html',
        },
      },
    },

    plugins: [
      ...(isDev ? [testRoutesPlugin()] : []),
    ],
  }
})

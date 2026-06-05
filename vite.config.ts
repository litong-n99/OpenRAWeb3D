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
      // Sub-page scripts use relative imports (./main.ts) which the
      // browser resolves to /src/__e2e__/manual/.../main.ts — those
      // must pass through or the pages won't load.
      server.middlewares.use((req, res, next) => {
        const url = req.url
        if (url && url.startsWith('/src/__e2e__/manual/')) {
          // Block HTML page navigation only: directory (ends with /) or .html
          if (url.endsWith('/') || url.endsWith('.html')) {
            res.statusCode = 404
            res.end('Not Found. Please use /test/ instead.')
            return
          }
        }
        next()
      })

      // Rewrite /test/... → /src/__e2e__/manual/... (direct mapping)
      server.middlewares.use((req, _res, next) => {
        const url = req.url
        if (url && url.startsWith('/test/')) {
          // /test/         → subPath=""    → /src/__e2e__/manual/index.html
          // /test/foo/bar/ → subPath="foo/bar/" → /src/__e2e__/manual/foo/bar/
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
    // Disable SPA HTML fallback — every HTML file is served at its
    // filesystem path. / → index.html, /test/ → src/__e2e__/manual/index.html (via rewrite)
    appType: 'mpa',

    // Exclude test pages from production builds. Only the main app
    // entry point (index.html) is included in the rollup input.
    build: {
      rollupOptions: {
        input: {
          // Vite resolves input paths relative to the project root
          main: 'index.html',
        },
      },
    },

    plugins: [
      ...(isDev ? [testRoutesPlugin()] : []),
    ],
  }
})

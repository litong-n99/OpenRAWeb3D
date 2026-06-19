import { defineConfig, type Plugin } from 'vite'

// ---------------------------------------------------------------------------
// Custom plugin: CORS proxy for Content Installer mirror downloads (dev-only)
// ---------------------------------------------------------------------------

/**
 * Proxies /api/proxy?url=<encoded> requests to bypass browser CORS restrictions
 * when downloading game assets from OpenRA CDN mirrors.
 *
 * The browser's same-origin policy blocks fetch() to third-party CDN servers
 * that lack Access-Control-Allow-Origin headers. This middleware acts as a
 * server-side relay: the browser requests localhost, the dev server fetches
 * from the mirror and returns the response with permissive CORS headers.
 *
 * Mirrors the following headers from the upstream response:
 *   Content-Type, Content-Length, Content-Disposition, ETag, Last-Modified,
 *   Cache-Control, Accept-Ranges
 */
function corsProxyPlugin(): Plugin {
  return {
    name: 'vite-plugin-cors-proxy',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url ?? ''
        if (!url.startsWith('/api/proxy')) return next()

        // Extract the target URL from query parameter
        const parsed = new URL(url, 'http://localhost')
        const target = parsed.searchParams.get('url')
        if (!target) {
          res.statusCode = 400
          res.end('Missing "url" query parameter')
          return
        }

        // Validate: only allow http/https URLs
        if (!target.startsWith('http://') && !target.startsWith('https://')) {
          res.statusCode = 400
          res.end('Invalid URL scheme')
          return
        }

        try {
          const upstream = await fetch(target, {
            headers: {
              'User-Agent': 'OpenRAWeb3D-ContentInstaller/1.0',
            },
          })

          // Forward status and headers
          res.statusCode = upstream.status
          const forwardHeaders = [
            'content-type', 'content-length', 'content-disposition',
            'etag', 'last-modified', 'cache-control', 'accept-ranges',
          ]
          for (const h of forwardHeaders) {
            const v = upstream.headers.get(h)
            if (v) res.setHeader(h, v)
          }

          // Allow any origin (the dev server is localhost-only)
          res.setHeader('Access-Control-Allow-Origin', '*')
          res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
          res.setHeader('Access-Control-Allow-Headers', '*')

          // Stream the response body
          if (upstream.body) {
            const reader = upstream.body.getReader()
            const pump = async () => {
              while (true) {
                const { done, value } = await reader.read()
                if (done) { res.end(); break }
                res.write(value)
              }
            }
            await pump()
          } else {
            res.end()
          }
        } catch (e) {
          res.statusCode = 502
          res.end(`Proxy error: ${e instanceof Error ? e.message : String(e)}`)
        }
      })
    },
  }
}

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
    // SPA mode (Vite default) — serves index.html for all non-asset, non-test URLs.
    // The testRoutesPlugin middleware intercepts /test/... requests before the
    // SPA fallback, so /test/ pages continue to work in dev mode.
    //
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
      ...(isDev ? [corsProxyPlugin(), testRoutesPlugin()] : []),
    ],
  }
})

import { defineConfig, type Plugin } from 'vite'
import fs from 'fs'
import path from 'path'

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
// Custom plugin: patch fengari luaconf.js for browser (dev-only)
// ---------------------------------------------------------------------------

/**
 * Replaces fengari's luaconf.js with a browser-compatible version.
 *
 * The original luaconf.js:
 *   1. References `process.env.FENGARICONF` at module top level → crashes
 *   2. Uses `typeof process` to switch between browser/Node paths — but Vite's
 *      define makes `process` exist, so the Node path runs and calls
 *      `require('os').platform()` → also crashes.
 *
 * This plugin swaps in a patched version that handles both issues safely.
 */
function fengariPatchPlugin(): Plugin {
  const PATCHED = path.resolve(__dirname, 'src/OpenRA.Game/Scripting/fengari-luaconf-browser.js')

  return {
    name: 'vite-plugin-fengari-patch',
    enforce: 'pre',
    load(id) {
      // Intercept ANY luaconf.js resolution within fengari (including pre-bundling)
      if (id.includes('fengari') && (id.endsWith('/luaconf.js') || id.endsWith('\\luaconf.js'))) {
        if (!id.includes('fengari-luaconf-browser')) {
          return fs.readFileSync(PATCHED, 'utf-8')
        }
      }
      return null
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
      fengariPatchPlugin(),
      ...(isDev ? [testRoutesPlugin()] : []),
    ],

    // BUGFIX ch20: intercept fengari luaconf.js during esbuild pre-bundling.
    // The Vite plugin load hook only fires for on-the-fly transforms, but
    // pre-bundling uses esbuild. This esbuild plugin replaces the original
    // luaconf.js (which crashes on `process.env` and `require('os')`) with
    // our browser-patched version.
    optimizeDeps: {
      esbuildOptions: {
        plugins: [{
          name: 'esbuild-fengari-luaconf-patch',
          setup(build) {
            const PATCHED_CONTENT = fs.readFileSync(
              path.resolve(__dirname, 'src/OpenRA.Game/Scripting/fengari-luaconf-browser.js'),
              'utf-8',
            )
            build.onLoad(
              { filter: /fengari[/\\]src[/\\]luaconf\.js$/ },
              () => ({ contents: PATCHED_CONTENT, loader: 'js' }),
            )
          },
        }],
      },
    },
  }
})

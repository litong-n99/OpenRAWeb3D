import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'happy-dom',
    pool: 'threads', // vmThreads causes cross-test @babylonjs/core mock contamination on Node 24
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/tests-e2e/**',
    ],
  },
})

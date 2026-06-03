import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'happy-dom',
    pool: 'vmThreads', // Required for Node 24+ compatibility
  },
})

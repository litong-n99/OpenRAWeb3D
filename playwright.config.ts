import { defineConfig } from '@playwright/test';

// ---------------------------------------------------------------------------
// Output directory isolation
//
// Set PLAYWRIGHT_OUTPUT_DIR to route all test output to a per-page subfolder.
// Example for acceptance tests:
//   PLAYWRIGHT_OUTPUT_DIR=test-results/manual/ch02-rendering/rgba-debug-graphics
//
// When unset, defaults to 'test-results' (backward-compatible).
// ---------------------------------------------------------------------------
const outputDir = process.env.PLAYWRIGHT_OUTPUT_DIR || 'test-results';

export default defineConfig({
  testDir: './tests-e2e',
  timeout: 30000,
  expect: { timeout: 10000 },
  use: {
    baseURL: 'http://localhost:5173',
    headless: true,
    viewport: { width: 1920, height: 1080 },
    actionTimeout: 10000,
    screenshot: 'on',
    trace: 'off',
    video: 'off',
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
  ],
  reporter: [
    ['list'],
    ['json', { outputFile: `${outputDir}/results.json` }],
  ],
});

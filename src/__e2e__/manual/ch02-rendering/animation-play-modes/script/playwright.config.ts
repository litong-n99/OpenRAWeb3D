/**
 * playwright.acceptance.config.ts
 * Temporary config for running acceptance test scripts outside tests-e2e/.
 * Extends the main playwright config but sets testDir to the project root
 * so explicit file path arguments work.
 */
import { defineConfig } from '@playwright/test';

export default defineConfig({
  timeout: 60000,
  expect: { timeout: 15000 },
  use: {
    baseURL: 'http://localhost:5173',
    headless: true,
    viewport: { width: 1920, height: 1080 },
    actionTimeout: 10000,
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
  ],
  reporter: [['list'], ['json', { outputFile: 'test-results/manual/ch02-rendering/animation-play-modes/results.json' }]],
});

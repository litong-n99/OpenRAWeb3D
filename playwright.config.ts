import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests-e2e',
  timeout: 30000,
  expect: { timeout: 10000 },
  use: {
    baseURL: 'http://localhost:5173',
    headless: true,
    viewport: { width: 1920, height: 1080 },
    actionTimeout: 10000,
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
  ],
  reporter: [['list'], ['json', { outputFile: 'test-results/results.json' }]],
});

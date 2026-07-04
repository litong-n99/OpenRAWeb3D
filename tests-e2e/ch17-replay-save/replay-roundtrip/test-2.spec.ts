/**
 * Acceptance Test: ch17-replay-save / replay-roundtrip
 * Test 2: E2 - Pre-start Buffer & Transition (MAJOR)
 *
 * Verifies D2 section: recordingToFile transitions, chosenFilename, getBuffer non-null.
 */

import { test, expect } from '@playwright/test';

const PAGE_URL = '/test/ch17-replay-save/replay-roundtrip/';

test.describe('E2: Pre-start Buffer & Transition', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(PAGE_URL);
    await page.waitForFunction(() =>
      document.querySelectorAll('#section-record .test-result').length >= 8,
      null,
      { timeout: 15000 }
    );
  });

  test('D2 section shows 8 PASS results', async ({ page }) => {
    const d2Pass = page.locator('#section-record .pass');
    await expect(d2Pass).toHaveCount(8);
  });

  test('D2 section has zero FAIL results', async ({ page }) => {
    const d2Fail = page.locator('#section-record .fail');
    await expect(d2Fail).toHaveCount(0);
  });

  test('E2.1: Initial recordingToFile = false', async ({ page }) => {
    await expect(page.locator('#section-record')).toContainText('recordingToFile = false');
  });

  test('E2.2: Initial chosenFilename = ""', async ({ page }) => {
    await expect(page.locator('#section-record')).toContainText('chosenFilename = ""');
  });

  test('E2.3: Initial disposed = false', async ({ page }) => {
    await expect(page.locator('#section-record')).toContainText('disposed = false');
  });

  test('E2.4: After non-StartGame packet, recordingToFile still false', async ({ page }) => {
    await expect(page.locator('#section-record')).toContainText('recordingToFile 仍为 false');
  });

  test('E2.5: After StartGame, recordingToFile = true', async ({ page }) => {
    await expect(page.locator('#section-record')).toContainText('recordingToFile = true');
  });

  test('E2.6: After StartGame, chosenFilename = "test-replay-2024"', async ({ page }) => {
    await expect(page.locator('#section-record')).toContainText('chosenFilename = "test-replay-2024"');
  });

  test('E2.7: After dispose(), disposed = true', async ({ page }) => {
    await expect(page.locator('#section-record')).toContainText('disposed = true');
  });

  test('E2.8: After dispose(), getBuffer() returns non-null', async ({ page }) => {
    await expect(page.locator('#section-record')).toContainText('getBuffer() 返回非 null');
  });

  test('screenshot: D2 section after test completion', async ({ page }) => {
    await page.screenshot({
      path: 'test-results/manual/ch17-replay-save/replay-roundtrip/evidence/screenshot-2-d2-record.png',
      fullPage: true,
    });
  });
});

/**
 * Acceptance Test: ch17-replay-save / replay-roundtrip
 * Test 6: Edge Cases & Global Checks
 *
 * Verifies: no JS errors, info bar, global fail count, page layout.
 */

import { test, expect } from '@playwright/test';

const PAGE_URL = '/test/ch17-replay-save/replay-roundtrip/';

test.describe('Edge Cases & Global Checks', () => {
  test.beforeEach(async ({ page }) => {
    // Collect console errors
    await page.goto(PAGE_URL);
    await page.waitForLoadState('networkidle');
    // Wait for all sections populated
    await page.waitForFunction(() =>
      document.querySelectorAll('#section-isgamestart .test-result').length >= 5 &&
      document.querySelectorAll('#section-record .test-result').length >= 8 &&
      document.querySelectorAll('#section-serialize .test-result').length >= 2,
      null,
      { timeout: 15000 }
    );
  });

  test('No JavaScript errors in console', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', msg => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    page.on('pageerror', err => errors.push(err.message));

    // Reload to capture errors
    await page.reload();
    await page.waitForLoadState('networkidle');
    await page.waitForFunction(() =>
      document.querySelectorAll('#section-isgamestart .test-result').length >= 5,
      null,
      { timeout: 15000 }
    );

    expect(errors).toHaveLength(0);
  });

  test('Global: zero FAIL indicators across all sections', async ({ page }) => {
    const allFails = page.locator('.fail');
    await expect(allFails).toHaveCount(0);
  });

  test('Info bar shows UA, viewport, time', async ({ page }) => {
    const ua = page.locator('#info-ua');
    const viewport = page.locator('#info-viewport');
    const time = page.locator('#info-time');

    await expect(ua).not.toHaveText('-');
    await expect(viewport).not.toHaveText('-');
    await expect(time).not.toHaveText('-');

    // Viewport should contain a resolution-like string
    const vpText = await viewport.textContent();
    expect(vpText).toMatch(/^\d+x\d+$/);
  });

  test('Info bar shows engine = N/A (pure logic test)', async ({ page }) => {
    const engine = page.locator('#info-engine');
    await expect(engine).toHaveText('N/A (纯逻辑测试)');
  });

  test('All 6 test sections (D1-D6) are visible', async ({ page }) => {
    await expect(page.locator('#section-isgamestart')).toBeVisible();
    await expect(page.locator('#section-record')).toBeVisible();
    await expect(page.locator('#section-serialize')).toBeVisible();
    await expect(page.locator('#section-parse')).toBeVisible();
    await expect(page.locator('#section-hex')).toBeVisible();
    await expect(page.locator('#section-summary')).toBeVisible();
  });

  test('D1-D4 sections do not contain "尚未运行" (not-run placeholder)', async ({ page }) => {
    await expect(page.locator('#section-isgamestart')).not.toContainText('尚未运行');
    await expect(page.locator('#section-record')).not.toContainText('尚未运行');
    await expect(page.locator('#section-serialize')).not.toContainText('尚未运行');
    await expect(page.locator('#section-parse')).not.toContainText('尚未运行');
  });

  test('D5 section does not contain "尚未生成" (not-generated placeholder)', async ({ page }) => {
    await expect(page.locator('#section-hex')).not.toContainText('尚未生成');
    await expect(page.locator('#section-summary')).not.toContainText('尚未生成');
  });

  test('Re-run button works (click "Run All" does not break page)', async ({ page }) => {
    // Click the "Run All" button to re-run tests
    const btn = page.locator('#btn-run-all');
    await btn.click();

    // Wait for results to re-render
    await page.waitForTimeout(500);
    await page.waitForFunction(() =>
      document.querySelectorAll('#section-isgamestart .test-result').length >= 5,
      null,
      { timeout: 10000 }
    );

    // Verify no new failures
    const allFails = page.locator('.fail');
    await expect(allFails).toHaveCount(0);
  });

  test('screenshot: full page after all tests complete', async ({ page }) => {
    await page.screenshot({
      path: 'test-results/manual/ch17-replay-save/replay-roundtrip/evidence/screenshot-6-full-page.png',
      fullPage: true,
    });
  });
});

/**
 * Acceptance Test: ch17-replay-save / replay-roundtrip
 * Test 1: E1 - isGameStart Detection (BLOCKER)
 *
 * Verifies the 5 sub-tests in D1 section all pass.
 * Page auto-runs tests on load; no manual interaction required.
 */

import { test, expect } from '@playwright/test';

const PAGE_URL = '/test/ch17-replay-save/replay-roundtrip/';

test.describe('E1: isGameStart Detection', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(PAGE_URL);
    // Wait for auto-run completion: at least 5 result rows in D1
    await page.waitForFunction(() =>
      document.querySelectorAll('#section-isgamestart .test-result').length >= 5,
      null,
      { timeout: 15000 }
    );
  });

  test('D1 section shows 5 PASS results', async ({ page }) => {
    const d1Pass = page.locator('#section-isgamestart .pass');
    await expect(d1Pass).toHaveCount(5);
  });

  test('D1 section has zero FAIL results', async ({ page }) => {
    const d1Fail = page.locator('#section-isgamestart .fail');
    await expect(d1Fail).toHaveCount(0);
  });

  test('E1.1: isGameStart(StartGame packet) returns true', async ({ page }) => {
    const d1 = page.locator('#section-isgamestart');
    await expect(d1).toContainText('isGameStart(具有 StartGame 的数据包) 返回 true');
    // Verify the corresponding row has PASS class
    await expect(d1.locator('.test-result').filter({ hasText: 'StartGame 的数据包' }).locator('.pass')).toHaveCount(1);
  });

  test('E1.2: isGameStart(Chat packet) returns false', async ({ page }) => {
    const d1 = page.locator('#section-isgamestart');
    await expect(d1).toContainText('isGameStart(Chat 数据包) 返回 false');
  });

  test('E1.3: isGameStart(empty data) returns false no crash', async ({ page }) => {
    const d1 = page.locator('#section-isgamestart');
    await expect(d1).toContainText('isGameStart(空数据包) 返回 false');
  });

  test('E1.4: isGameStart(very short data) returns false no crash', async ({ page }) => {
    const d1 = page.locator('#section-isgamestart');
    await expect(d1).toContainText('isGameStart(超短数据包 [0x00]) 返回 false');
  });

  test('E1.5: isGameStart(frame>0 no StartGame) returns false', async ({ page }) => {
    const d1 = page.locator('#section-isgamestart');
    await expect(d1).toContainText('isGameStart(frame=5, 无 StartGame 订单) 返回 false');
  });

  test('screenshot: D1 section after test completion', async ({ page }) => {
    await page.screenshot({
      path: 'test-results/manual/ch17-replay-save/replay-roundtrip/evidence/screenshot-1-d1-isgamestart.png',
      fullPage: true,
    });
  });
});

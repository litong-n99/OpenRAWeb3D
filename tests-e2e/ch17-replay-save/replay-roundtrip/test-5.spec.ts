/**
 * Acceptance Test: ch17-replay-save / replay-roundtrip
 * Test 5: E5 - receive() Order Dispatch (BLOCKER)
 *
 * Verifies D4 section: send no-ops, receive dispatches, receiveSync, receiveDisconnect.
 */

import { test, expect } from '@playwright/test';

const PAGE_URL = '/test/ch17-replay-save/replay-roundtrip/';

test.describe('E5: Order Dispatch', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(PAGE_URL);
    await page.waitForFunction(() =>
      document.querySelectorAll('#section-parse .test-result').length >= 5,
      null,
      { timeout: 15000 }
    );
  });

  test('D4 section has zero FAIL results', async ({ page }) => {
    const d4Fail = page.locator('#section-parse .fail');
    await expect(d4Fail).toHaveCount(0);
  });

  test('E5.1: send() is no-op (no exception)', async ({ page }) => {
    await expect(page.locator('#section-parse')).toContainText('send() 空操作（无异常）');
  });

  test('E5.2: sendImmediate() is no-op (no exception)', async ({ page }) => {
    await expect(page.locator('#section-parse')).toContainText('sendImmediate() 空操作（无异常）');
  });

  test('E5.3: sendSync() no exception', async ({ page }) => {
    await expect(page.locator('#section-parse')).toContainText('sendSync() 无异常');
  });

  test('E5.4: receive() completes without exception', async ({ page }) => {
    await expect(page.locator('#section-parse')).toContainText('receive() 完成');
  });

  test('E5.5: receiveImmediateOrders called', async ({ page }) => {
    await expect(page.locator('#section-parse')).toContainText('receiveImmediateOrders 调用');
  });

  test('E5.6: receiveOrders called', async ({ page }) => {
    await expect(page.locator('#section-parse')).toContainText('receiveOrders 调用');
  });

  test('E5.7: receiveSync called (at least 1 from sendSync)', async ({ page }) => {
    await expect(page.locator('#section-parse')).toContainText('receiveSync 调用');
  });

  test('E5.8: receiveDisconnect called', async ({ page }) => {
    await expect(page.locator('#section-parse')).toContainText('receiveDisconnect 调用');
  });

  test('E5.9: dispose() no exception', async ({ page }) => {
    await expect(page.locator('#section-parse')).toContainText('dispose() 无异常');
  });

  test('E5.10: Dispatch log is visible', async ({ page }) => {
    // The dispatch log is a div inside D4
    const d4 = page.locator('#section-parse');
    await expect(d4).toContainText('分发日志');
    // Should have dispatch entries
    await expect(d4).toContainText('[immediate]');
    await expect(d4).toContainText('[orders]');
    await expect(d4).toContainText('[sync]');
  });

  test('screenshot: D4 dispatch log area', async ({ page }) => {
    await page.screenshot({
      path: 'test-results/manual/ch17-replay-save/replay-roundtrip/evidence/screenshot-5-d4-dispatch.png',
      fullPage: true,
    });
  });
});

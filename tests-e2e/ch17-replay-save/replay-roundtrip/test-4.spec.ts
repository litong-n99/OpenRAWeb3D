/**
 * Acceptance Test: ch17-replay-save / replay-roundtrip
 * Test 4: E4 - ReplayConnection Properties (MAJOR)
 *
 * Verifies D4 section: isValid, tickCount, finalGameTick, localClientId, filename, LobbyInfo.
 */

import { test, expect } from '@playwright/test';

const PAGE_URL = '/test/ch17-replay-save/replay-roundtrip/';

test.describe('E4: ReplayConnection Properties', () => {
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

  test('E4.1: isValid = true', async ({ page }) => {
    await expect(page.locator('#section-parse')).toContainText('ReplayConnection.IsValid = true');
  });

  test('E4.2: tickCount >= 0', async ({ page }) => {
    await expect(page.locator('#section-parse')).toContainText('ReplayConnection.TickCount >= 0');
  });

  test('E4.3: finalGameTick = 2', async ({ page }) => {
    await expect(page.locator('#section-parse')).toContainText('ReplayConnection.FinalGameTick = 2');
  });

  test('E4.4: localClientId = -1', async ({ page }) => {
    await expect(page.locator('#section-parse')).toContainText('ReplayConnection.localClientId = -1');
  });

  test('E4.5: filename = "test-replay-2024.orarep"', async ({ page }) => {
    await expect(page.locator('#section-parse')).toContainText('ReplayConnection.filename = "test-replay-2024.orarep"');
  });

  test('E4.6: LobbyInfo is non-null object', async ({ page }) => {
    await expect(page.locator('#section-parse')).toContainText('LobbyInfo 为非空对象');
  });

  test('E4.7: LobbyInfo.clients is array', async ({ page }) => {
    await expect(page.locator('#section-parse')).toContainText('LobbyInfo.clients 是数组');
  });

  test('E4.8: LobbyInfo.globalSettings is object', async ({ page }) => {
    await expect(page.locator('#section-parse')).toContainText('LobbyInfo.globalSettings 为对象');
  });

  test('E4.9: LobbyInfo.slots is Map', async ({ page }) => {
    await expect(page.locator('#section-parse')).toContainText('LobbyInfo.slots 是 Map');
  });

  test('screenshot: D4 section after test completion', async ({ page }) => {
    await page.screenshot({
      path: 'test-results/manual/ch17-replay-save/replay-roundtrip/evidence/screenshot-4-d4-connection.png',
      fullPage: true,
    });
  });
});

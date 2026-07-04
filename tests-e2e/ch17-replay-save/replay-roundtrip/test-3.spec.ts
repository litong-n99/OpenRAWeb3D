/**
 * Acceptance Test: ch17-replay-save / replay-roundtrip
 * Test 3: E3 - Binary Output & Metadata Parsing (BLOCKER)
 *
 * Verifies D3 (binary output), D5 (hex dump), D6 (summary table).
 */

import { test, expect } from '@playwright/test';

const PAGE_URL = '/test/ch17-replay-save/replay-roundtrip/';

test.describe('E3: Binary Output & Metadata Parsing', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(PAGE_URL);
    await page.waitForFunction(() =>
      document.querySelectorAll('#section-serialize .test-result').length >= 2,
      null,
      { timeout: 15000 }
    );
  });

  test('D3 section shows 7 PASS results (all metadata parsed)', async ({ page }) => {
    const d3Pass = page.locator('#section-serialize .pass');
    await expect(d3Pass).toHaveCount(7);
  });

  test('D3 section has zero FAIL results', async ({ page }) => {
    const d3Fail = page.locator('#section-serialize .fail');
    await expect(d3Fail).toHaveCount(0);
  });

  test('E3.1: Buffer size > 0', async ({ page }) => {
    await expect(page.locator('#section-serialize')).toContainText('二进制缓冲区大小');
    const d3 = page.locator('#section-serialize');
    const text = await d3.textContent();
    expect(text).toMatch(/字节 \(> 0\)/);
  });

  test('E3.2: ReplayMetadata.readFromBuffer() succeeds', async ({ page }) => {
    await expect(page.locator('#section-serialize')).toContainText('ReplayMetadata.readFromBuffer() 成功解析尾部');
  });

  test('E3.3: GameInfo.mod = "cnc"', async ({ page }) => {
    await expect(page.locator('#section-serialize')).toContainText('GameInfo.mod = "cnc"');
  });

  test('E3.4: GameInfo.mapUid = "test-map-uid"', async ({ page }) => {
    await expect(page.locator('#section-serialize')).toContainText('GameInfo.mapUid = "test-map-uid"');
  });

  test('E3.5: GameInfo.finalGameTick = 2', async ({ page }) => {
    await expect(page.locator('#section-serialize')).toContainText('GameInfo.finalGameTick = 2');
  });

  test('E3.6: GameInfo.players.length = 1', async ({ page }) => {
    await expect(page.locator('#section-serialize')).toContainText('GameInfo.players.length = 1');
  });

  test('E3.7: GameInfo.endTimeUtc is set', async ({ page }) => {
    await expect(page.locator('#section-serialize')).toContainText('GameInfo.endTimeUtc 已设置');
  });

  test('D5: Hex dump is rendered and non-empty', async ({ page }) => {
    const hex = page.locator('#section-hex .hex-dump');
    await expect(hex).toBeVisible();
    const hexText = await hex.textContent();
    expect(hexText).not.toBeNull();
    expect(hexText!.length).toBeGreaterThan(50);
    // Should contain offset lines
    expect(hexText).toContain('00000000:');
  });

  test('D6: Summary table rendered with correct metadata', async ({ page }) => {
    const table = page.locator('#section-summary .summary-table');
    await expect(table).toBeVisible();

    // No fail rows in summary table
    await expect(table.locator('tr.fail')).toHaveCount(0);

    // Key content
    await expect(table).toContainText('总字节数');
    await expect(table).toContainText('元数据尾部有效');
    await expect(table).toContainText('是 (PASS)');
    await expect(table).toContainText('FinalGameTick');
    await expect(table).toContainText('Mod');
    await expect(table).toContainText('cnc');
    await expect(table).toContainText('Version');
    await expect(table).toContainText('test-1.0');
    await expect(table).toContainText('MapTitle');
    await expect(table).toContainText('Test Map');
    await expect(table).toContainText('Players');
    await expect(table).toContainText('TestPlayer');
  });

  test('screenshot: D3+D5+D6 sections after test completion', async ({ page }) => {
    await page.screenshot({
      path: 'test-results/manual/ch17-replay-save/replay-roundtrip/evidence/screenshot-3-d3-d5-d6-serialize.png',
      fullPage: true,
    });
  });
});

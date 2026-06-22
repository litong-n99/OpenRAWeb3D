/**
 * Test 4: 可变帧间隔 — 帧速度调节
 *
 * NOTE: Exact cycle time measurements are unreliable in headless WebGL.
 * Instead, verify relative speed differences between interval settings.
 */
import { test, expect } from '@playwright/test';
const PAGE_URL = 'http://localhost:5173/test/ch02-rendering/animation-frame-switching/';

test.describe('Expectation 4: Variable Frame Interval', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(PAGE_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#sandbox canvas', { timeout: 15000 });
    await page.selectOption('#play-mode', 'repeating');
    await page.evaluate(() => {
      const slider = document.querySelector('#tick-slider') as HTMLInputElement;
      if (slider) { slider.value = '40'; slider.dispatchEvent(new Event('input')); }
      const speed = document.querySelector('#speed-slider') as HTMLInputElement;
      if (speed) { speed.value = '1'; speed.dispatchEvent(new Event('input')); }
    });
    await page.click('#btn-reset');
    await page.waitForTimeout(1000);
  });

  async function countTicksOverDuration(page: any, tickMs: number, durationMs: number): Promise<number> {
    await page.evaluate((ms: number) => {
      const slider = document.querySelector('#tick-slider') as HTMLInputElement;
      if (slider) { slider.value = String(ms); slider.dispatchEvent(new Event('input', { bubbles: true })); }
    }, tickMs);
    await page.waitForTimeout(500);
    const startTicks = await page.$eval('#state-ticks', el => parseInt(el.textContent || '0', 10));
    await page.waitForTimeout(durationMs);
    const endTicks = await page.$eval('#state-ticks', el => parseInt(el.textContent || '0', 10));
    return endTicks - startTicks;
  }

  test('4.1 40ms interval produces moderate tick rate', async ({ page }) => {
    const tickCount = await countTicksOverDuration(page, 40, 2000);
    expect(tickCount).toBeGreaterThanOrEqual(3);
    expect(tickCount).toBeLessThanOrEqual(30);
  });

  test('4.2 100ms interval is slower than 40ms interval', async ({ page }) => {
    const ticks40 = await countTicksOverDuration(page, 40, 1500);
    const ticks100 = await countTicksOverDuration(page, 100, 1500);
    expect(ticks100).toBeLessThan(ticks40);
  });

  test('4.3 200ms interval is slowest', async ({ page }) => {
    const ticks200 = await countTicksOverDuration(page, 200, 2000);
    expect(ticks200).toBeLessThanOrEqual(15);
    expect(ticks200).toBeGreaterThanOrEqual(1);
  });

  test('4.4 10ms interval is faster than 100ms interval', async ({ page }) => {
    const ticks10 = await countTicksOverDuration(page, 10, 1000);
    const ticks100 = await countTicksOverDuration(page, 100, 1000);
    expect(ticks10).toBeGreaterThan(ticks100);
  });
});

/**
 * Test 3: PlayBackwardsThen — 反向播放后停止
 */
import { test, expect } from '@playwright/test';
const PAGE_URL = 'http://localhost:5173/test/ch02-rendering/animation-frame-switching/';

test.describe('Expectation 3: PlayBackwardsThen Reverse Playback', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(PAGE_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#sandbox canvas', { timeout: 15000 });
    await page.waitForTimeout(1500);
  });

  test('3.1 PlayBackwardsThen plays frames in decreasing sequence', async ({ page }) => {
    await page.click('#btn-reset');
    await page.waitForTimeout(300);
    await page.selectOption('#play-mode', 'backwards');
    await page.waitForTimeout(100);
    const startFrame = await page.$eval('#state-frame', el => parseInt(el.textContent || '0', 10));
    await page.waitForTimeout(600);
    const endFrame = await page.$eval('#state-frame', el => parseInt(el.textContent || '0', 10));
    expect(endFrame).toBeLessThan(startFrame);
  });

  test('3.2 Animation auto-stops after reaching low frames', async ({ page }) => {
    await page.click('#btn-pause');
    await page.selectOption('#play-mode', 'backwards');
    await page.click('#btn-play');
    let lastTicks = -1;
    let stableLoops = 0;
    for (let i = 0; i < 80; i++) {
      const ticks = await page.$eval('#state-ticks', el => parseInt(el.textContent || '0', 10));
      if (ticks === lastTicks) { stableLoops++; if (stableLoops >= 5) break; }
      else { stableLoops = 0; }
      lastTicks = ticks;
      await page.waitForTimeout(100);
    }
    const finalFrame = await page.$eval('#state-frame', el => parseInt(el.textContent || '0', 10));
    expect(finalFrame).toBeLessThanOrEqual(5);
    expect(stableLoops).toBeGreaterThanOrEqual(2);
  });

  test('3.3 Clicking Play again after backwards completion restarts animation', async ({ page }) => {
    await page.click('#btn-pause');
    await page.selectOption('#play-mode', 'backwards');
    let lastTicks = -1;
    let stableLoops = 0;
    for (let i = 0; i < 80; i++) {
      const ticks = await page.$eval('#state-ticks', el => parseInt(el.textContent || '0', 10));
      if (ticks === lastTicks) { stableLoops++; if (stableLoops >= 5) break; }
      else { stableLoops = 0; }
      lastTicks = ticks;
      await page.waitForTimeout(100);
    }
    await page.click('#btn-play');
    await page.waitForTimeout(200);
    const afterFrame = await page.$eval('#state-frame', el => parseInt(el.textContent || '0', 10));
    expect(afterFrame).toBeGreaterThanOrEqual(8);
    const afterTicks = await page.$eval('#state-ticks', el => parseInt(el.textContent || '0', 10));
    expect(afterTicks).toBeGreaterThan(0);
  });
});

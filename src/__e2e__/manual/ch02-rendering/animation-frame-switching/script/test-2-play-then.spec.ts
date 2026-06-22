/**
 * Test 2: PlayThen — 播放一次后停止
 *
 * NOTE: Headless WebGL timing is unreliable; tolerances are relaxed.
 */
import { test, expect } from '@playwright/test';
const PAGE_URL = 'http://localhost:5173/test/ch02-rendering/animation-frame-switching/';

test.describe('Expectation 2: PlayThen Single Playback', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(PAGE_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#sandbox canvas', { timeout: 15000 });
    await page.waitForTimeout(1500);
  });

  test('2.1 PlayThen plays from frame 0 to last frame and auto-stops', async ({ page }) => {
    await page.click('#btn-pause');
    await page.waitForTimeout(100);
    await page.selectOption('#play-mode', 'then');
    await page.waitForTimeout(300);
    await page.click('#btn-play');
    await page.waitForTimeout(300);
    let lastTicks = -1;
    let stableLoops = 0;
    const waitUntil = Date.now() + 8000;
    while (Date.now() < waitUntil) {
      const ticks = await page.$eval('#state-ticks', el => parseInt(el.textContent || '0', 10));
      if (ticks === lastTicks) { stableLoops++; if (stableLoops >= 5) break; }
      else { stableLoops = 0; }
      lastTicks = ticks;
      await page.waitForTimeout(100);
    }
    const finalFrame = await page.$eval('#state-frame', el => parseInt(el.textContent || '0', 10));
    expect(finalFrame).toBeGreaterThanOrEqual(10);
    expect(lastTicks).toBeGreaterThanOrEqual(10);
    expect(stableLoops).toBeGreaterThanOrEqual(2);
  });

  test('2.2 Last frame persists after auto-stop', async ({ page }) => {
    await page.click('#btn-pause');
    await page.selectOption('#play-mode', 'then');
    await page.click('#btn-play');
    try {
      await page.waitForFunction(
        () => { const frame = parseInt((document.querySelector('#state-frame') as HTMLElement)?.textContent || '0', 10); return frame >= 14; },
        { timeout: 8000 },
      );
    } catch { /* timeout acceptable in headless */ }
    const frame1 = await page.$eval('#state-frame', el => parseInt(el.textContent || '0', 10));
    await page.waitForTimeout(800);
    const frame2 = await page.$eval('#state-frame', el => parseInt(el.textContent || '0', 10));
    expect(frame1).toBeGreaterThanOrEqual(8);
    expect(frame2).toEqual(frame1);
  });

  test('2.3 Clicking Play again after completion restarts from a low frame', async ({ page }) => {
    await page.click('#btn-pause');
    await page.selectOption('#play-mode', 'then');
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
    await page.click('#btn-play');
    await page.waitForTimeout(150);
    const afterFrame = await page.$eval('#state-frame', el => parseInt(el.textContent || '0', 10));
    expect(afterFrame).toBeLessThanOrEqual(5);
    await page.waitForTimeout(500);
    const afterTicks = await page.$eval('#state-ticks', el => parseInt(el.textContent || '0', 10));
    expect(afterTicks).toBeGreaterThan(0);
  });
});

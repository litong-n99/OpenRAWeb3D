/**
 * Test 5: FPS 稳定性 + 暂停/恢复 + 边界测试
 */
import { test, expect } from '@playwright/test';
const PAGE_URL = 'http://localhost:5173/test/ch02-rendering/animation-frame-switching/';

test.describe('Expectation 5: FPS Stability', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(PAGE_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#sandbox canvas', { timeout: 15000 });
    await page.waitForTimeout(3000);
  });

  test('5.1 Scene FPS stays >= 30 during normal playback', async ({ page }) => {
    const fpsReadings: number[] = [];
    const startTime = Date.now();
    while (Date.now() - startTime < 3000) {
      const fpsText = await page.$eval('#info-fps', el => el.textContent || '0');
      const fps = parseInt(fpsText, 10);
      if (!isNaN(fps) && fps > 0) fpsReadings.push(fps);
      await page.waitForTimeout(300);
    }
    expect(fpsReadings.length).toBeGreaterThanOrEqual(3);
    const avgFps = fpsReadings.reduce((a, b) => a + b, 0) / fpsReadings.length;
    expect(avgFps).toBeGreaterThanOrEqual(30);
  });

  test('5.2 WebGL engine reported correctly', async ({ page }) => {
    const engineText = await page.$eval('#info-engine', el => el.textContent || '');
    expect(engineText).toMatch(/WebGL \d\.0/);
    expect(engineText).toMatch(/Babylon\.js/);
  });
});

test.describe('Pause/Resume', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(PAGE_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#sandbox canvas', { timeout: 15000 });
    await page.selectOption('#play-mode', 'repeating');
    await page.evaluate(() => {
      const slider = document.querySelector('#tick-slider') as HTMLInputElement;
      if (slider) { slider.value = '40'; slider.dispatchEvent(new Event('input')); }
    });
    await page.click('#btn-reset');
    await page.waitForTimeout(1000);
  });

  test('Pause freezes current frame and ticks', async ({ page }) => {
    await page.waitForTimeout(500);
    await page.click('#btn-pause');
    await page.waitForTimeout(300);
    const pausedFrame = await page.$eval('#state-frame', el => parseInt(el.textContent || '0', 10));
    const pausedTicks = await page.$eval('#state-ticks', el => parseInt(el.textContent || '0', 10));
    await page.waitForTimeout(1500);
    const stillFrame = await page.$eval('#state-frame', el => parseInt(el.textContent || '0', 10));
    const stillTicks = await page.$eval('#state-ticks', el => parseInt(el.textContent || '0', 10));
    expect(stillFrame).toBe(pausedFrame);
    expect(stillTicks).toBe(pausedTicks);
  });

  test('Resume continues animation after pause', async ({ page }) => {
    await page.waitForTimeout(500);
    await page.click('#btn-pause');
    await page.waitForTimeout(300);
    const pausedTicks = await page.$eval('#state-ticks', el => parseInt(el.textContent || '0', 10));
    await page.click('#btn-play');
    await page.waitForTimeout(1000);
    const resumedTicks = await page.$eval('#state-ticks', el => parseInt(el.textContent || '0', 10));
    expect(resumedTicks).toBeGreaterThan(pausedTicks);
  });
});

test.describe('Boundary Tests', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(PAGE_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#sandbox canvas', { timeout: 15000 });
    await page.waitForTimeout(2000);
  });

  test('Speed scale 5.0x: animation runs fast without crashing', async ({ page }) => {
    await page.evaluate(() => {
      const slider = document.querySelector('#speed-slider') as HTMLInputElement;
      if (slider) { slider.value = '5'; slider.dispatchEvent(new Event('input')); }
    });
    await page.waitForTimeout(1500);
    const ticks = await page.$eval('#state-ticks', el => parseInt(el.textContent || '0', 10));
    expect(ticks).toBeGreaterThan(0);
    const canvasVisible = await page.$eval('#sandbox canvas', el => window.getComputedStyle(el).display !== 'none');
    expect(canvasVisible).toBe(true);
  });

  test('Speed scale 0.1x: animation slow but not crashed', async ({ page }) => {
    const startTicks = await page.$eval('#state-ticks', el => parseInt(el.textContent || '0', 10));
    await page.evaluate(() => {
      const slider = document.querySelector('#speed-slider') as HTMLInputElement;
      if (slider) { slider.value = '0.1'; slider.dispatchEvent(new Event('input')); }
    });
    await page.waitForTimeout(2000);
    const canvasVisible = await page.$eval('#sandbox canvas', el => window.getComputedStyle(el).display !== 'none');
    expect(canvasVisible).toBe(true);
    const endTicks = await page.$eval('#state-ticks', el => parseInt(el.textContent || '0', 10));
    const newTicks = endTicks - startTicks;
    expect(newTicks).toBeLessThanOrEqual(15);
    expect(newTicks).toBeGreaterThanOrEqual(0);
  });

  test('Rapid mode switching does not crash', async ({ page }) => {
    const modes = ['repeating', 'then', 'backwards', 'fetchDirection'];
    for (let round = 0; round < 5; round++) {
      for (const mode of modes) {
        await page.selectOption('#play-mode', mode);
        await page.waitForTimeout(100);
      }
    }
    const canvasVisible = await page.$eval('#sandbox canvas', el => window.getComputedStyle(el).display !== 'none');
    expect(canvasVisible).toBe(true);
    const engineText = await page.$eval('#info-engine', el => el.textContent || '');
    expect(engineText).toMatch(/WebGL/);
  });

  test('Frame count change: 4-frame animation works', async ({ page }) => {
    await page.selectOption('#frame-count', '4');
    await page.waitForTimeout(1000);
    const totalFrames = await page.$eval('#state-total', el => parseInt(el.textContent || '0', 10));
    expect(totalFrames).toBe(4);
    const currentFrame = await page.$eval('#state-frame', el => parseInt(el.textContent || '0', 10));
    expect(currentFrame).toBeLessThanOrEqual(3);
  });

  test('Frame count change: 30-frame animation works', async ({ page }) => {
    await page.selectOption('#frame-count', '30');
    await page.waitForTimeout(1000);
    const totalFrames = await page.$eval('#state-total', el => parseInt(el.textContent || '0', 10));
    expect(totalFrames).toBe(30);
    const currentFrame = await page.$eval('#state-frame', el => parseInt(el.textContent || '0', 10));
    expect(currentFrame).toBeLessThanOrEqual(29);
  });
});

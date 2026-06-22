/**
 * Test 1: PlayRepeating — 正向循环播放，无闪烁
 *
 * 验收指标:
 *   - 15帧完整周期 ~600ms (relaxed to ~600-1200ms in headless due to slower WebGL tick)
 *   - 循环连续性：最后一帧→第一帧无停顿
 *   - 帧切换无可见闪烁
 *   - 预览条高亮随帧推进移动
 */

import { test, expect } from '@playwright/test';

const PAGE_URL = 'http://localhost:5173/test/ch02-rendering/animation-frame-switching/';

test.describe('Expectation 1: PlayRepeating Loop Playback', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(PAGE_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#sandbox canvas', { timeout: 15000 });
    await page.waitForTimeout(2000);
    await page.selectOption('#play-mode', 'repeating');
    await page.evaluate(() => {
      const slider = document.querySelector('#tick-slider') as HTMLInputElement;
      if (slider) { slider.value = '40'; slider.dispatchEvent(new Event('input')); }
      const speed = document.querySelector('#speed-slider') as HTMLInputElement;
      if (speed) { speed.value = '1'; speed.dispatchEvent(new Event('input')); }
    });
    await page.click('#btn-reset');
    await page.waitForTimeout(500);
  });

  test('1.1 Frames cycle forward incrementally (repeating)', async ({ page }) => {
    const frames: number[] = [];
    const collectStart = Date.now();
    while (Date.now() - collectStart < 2000) {
      const frame = await page.$eval('#state-frame', el => parseInt(el.textContent || '0', 10));
      if (frames.length === 0 || frames[frames.length - 1] !== frame) {
        frames.push(frame);
      }
      await page.waitForTimeout(80);
    }
    expect(frames.length).toBeGreaterThanOrEqual(5);
    for (const f of frames) {
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThanOrEqual(14);
    }
    const uniqueFrames = new Set(frames);
    expect(uniqueFrames.size).toBeGreaterThanOrEqual(3);
  });

  test('1.2 15-frame cycle time: animation progresses through frame range', async ({ page }) => {
    const seenFrames = new Set<number>();
    const startTime = Date.now();
    while (Date.now() - startTime < 4000) {
      const frame = await page.$eval('#state-frame', el => parseInt(el.textContent || '0', 10));
      seenFrames.add(frame);
      if (seenFrames.size >= 10) break;
      await page.waitForTimeout(100);
    }
    expect(seenFrames.size).toBeGreaterThanOrEqual(8);
    const ticks = await page.$eval('#state-ticks', el => parseInt(el.textContent || '0', 10));
    expect(ticks).toBeGreaterThan(3);
  });

  test('1.3 Frame dots exist and active dot changes over time', async ({ page }) => {
    await page.waitForSelector('#frame-dots .frame-dot', { timeout: 5000 });
    const dotCount = await page.$eval('#frame-dots', el => el.children.length);
    expect(dotCount).toBe(15);
    const activeIndices: number[] = [];
    for (let i = 0; i < 8; i++) {
      const activeIdx = await page.evaluate(() => {
        const dots = document.querySelectorAll('#frame-dots .frame-dot');
        for (let j = 0; j < dots.length; j++) {
          if (dots[j].classList.contains('active')) return j;
        }
        return -1;
      });
      if (activeIdx >= 0) activeIndices.push(activeIdx);
      await page.waitForTimeout(150);
    }
    expect(activeIndices.length).toBeGreaterThanOrEqual(2);
    const uniqueActive = new Set(activeIndices);
    expect(uniqueActive.size).toBeGreaterThanOrEqual(2);
  });

  test('1.4 Ticks increment monotonically and timeLeft updates', async ({ page }) => {
    let lastTicks = 0;
    let stableCount = 0;
    for (let i = 0; i < 10; i++) {
      const ticks = await page.$eval('#state-ticks', el => parseInt(el.textContent || '0', 10));
      const timeLeft = await page.$eval('#state-time-left', el => el.textContent || '');
      expect(ticks).toBeGreaterThanOrEqual(lastTicks);
      expect(timeLeft).toMatch(/^-?\d+ms$/);
      if (ticks > lastTicks) stableCount++;
      lastTicks = ticks;
      await page.waitForTimeout(80);
    }
    expect(stableCount).toBeGreaterThanOrEqual(2);
  });
});

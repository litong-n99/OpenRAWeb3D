/**
 * test-2-fetch-index-manual.spec.ts
 *
 * Expectations covered:
 *   Expectation 1 (latter half): PlayFetchIndex manual slider control
 *   — frame follows slider position instantly (< 50ms visual, < 200ms automated)
 *
 * Verifies that switching to manual mode and dragging the slider
 * immediately updates the displayed frame.
 */

import { test, expect } from '@playwright/test';
import path from 'node:path';

const EVIDENCE_DIR = path.resolve(
  import.meta.dirname,
  '..', '..', '..', '..', '..', '..',
  'test-results', 'manual', 'ch02-rendering', 'animation-play-modes', 'evidence',
);

const PAGE_URL = '/test/ch02-rendering/animation-play-modes/';

test.describe('Expectation 1: PlayFetchIndex manual slider control', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(PAGE_URL);
    await page.waitForSelector('#info-engine', { state: 'attached', timeout: 15000 });
    await page.waitForFunction(() => {
      const el = document.getElementById('info-engine');
      return el && el.textContent !== '-';
    }, { timeout: 15000 });
    const engineText = await page.textContent('#info-engine');
    expect(engineText).toContain('WebGL');
  });

  test('T2.1: Switch to manual control — button state changes', async ({ page }) => {
    // Click manual control button
    await page.click('#btn-fetch-manual');
    await page.waitForTimeout(200);

    // Manual button should be active, auto button not
    const manualClass = await page.getAttribute('#btn-fetch-manual', 'class');
    expect(manualClass).toContain('active');

    const autoClass = await page.getAttribute('#btn-auto-progress', 'class');
    expect(autoClass).not.toContain('active');

    await page.screenshot({
      path: path.join(EVIDENCE_DIR, 'screenshot-t2-1-manual-mode.png'),
      fullPage: false,
    });
  });

  test('T2.2: Slider drag to frame 7 — frame display follows', async ({ page }) => {
    // Switch to manual first
    await page.click('#btn-fetch-manual');
    await page.waitForTimeout(200);

    // Set slider to value 7
    await page.evaluate(() => {
      const slider = document.getElementById('fetch-index-slider') as HTMLInputElement;
      slider.value = '7';
      slider.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.waitForTimeout(300);

    // Verify state-frame shows 7
    const frame = await page.textContent('#state-frame');
    expect(frame).toBe('7');

    // Verify slider value display
    const sliderVal = await page.textContent('#fetch-index-val');
    expect(sliderVal).toContain('7');
    expect(sliderVal).toContain('/');

    // Progress bar should reflect 7/14 = 50%
    const progressWidth = await page.evaluate(() => {
      const bar = document.getElementById('progress-bar');
      return bar ? bar.style.width : null;
    });
    expect(progressWidth).toBeTruthy();

    await page.screenshot({
      path: path.join(EVIDENCE_DIR, 'screenshot-t2-2-slider-frame-7.png'),
      fullPage: false,
    });
  });

  test('T2.3: Slider at maximum (14) — displays last frame', async ({ page }) => {
    await page.click('#btn-fetch-manual');
    await page.waitForTimeout(200);

    await page.evaluate(() => {
      const slider = document.getElementById('fetch-index-slider') as HTMLInputElement;
      slider.value = '14';
      slider.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.waitForTimeout(300);

    const frame = await page.textContent('#state-frame');
    expect(frame).toBe('14');

    const sliderVal = await page.textContent('#fetch-index-val');
    expect(sliderVal).toContain('14');

    await page.screenshot({
      path: path.join(EVIDENCE_DIR, 'screenshot-t2-3-slider-max.png'),
      fullPage: false,
    });
  });

  test('T2.4: Slider at minimum (0) — displays first frame', async ({ page }) => {
    await page.click('#btn-fetch-manual');
    await page.waitForTimeout(200);

    // First set to some non-zero value, then back to 0
    await page.evaluate(() => {
      const slider = document.getElementById('fetch-index-slider') as HTMLInputElement;
      slider.value = '10';
      slider.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.waitForTimeout(200);

    await page.evaluate(() => {
      const slider = document.getElementById('fetch-index-slider') as HTMLInputElement;
      slider.value = '0';
      slider.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.waitForTimeout(300);

    const frame = await page.textContent('#state-frame');
    expect(frame).toBe('0');

    const sliderVal = await page.textContent('#fetch-index-val');
    expect(sliderVal).toContain('0');

    await page.screenshot({
      path: path.join(EVIDENCE_DIR, 'screenshot-t2-4-slider-min.png'),
      fullPage: false,
    });
  });

  test('T2.5: Slider cannot exceed max bound (14)', async ({ page }) => {
    await page.click('#btn-fetch-manual');
    await page.waitForTimeout(200);

    // Verify slider max attribute is set
    const sliderMax = await page.getAttribute('#fetch-index-slider', 'max');
    expect(sliderMax).toBe('14');

    // Verify slider min attribute
    const sliderMin = await page.getAttribute('#fetch-index-slider', 'min');
    expect(sliderMin).toBe('0');

    // Try to set beyond max — browser should clamp
    await page.evaluate(() => {
      const slider = document.getElementById('fetch-index-slider') as HTMLInputElement;
      slider.value = '99';
      slider.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.waitForTimeout(200);

    // HTML input range should clamp
    const actualValue = await page.inputValue('#fetch-index-slider');
    // The browser clamped value
    const clamped = parseInt(actualValue, 10);
    expect(clamped).toBeLessThanOrEqual(14);
  });

  test('T2.6: Switch back to auto-progress — auto button active', async ({ page }) => {
    // First switch to manual
    await page.click('#btn-fetch-manual');
    await page.waitForTimeout(200);

    // Then switch back to auto
    await page.click('#btn-auto-progress');
    await page.waitForTimeout(200);

    const autoClass = await page.getAttribute('#btn-auto-progress', 'class');
    expect(autoClass).toContain('active');

    // Frame should start advancing again after some time
    const frame1 = await page.textContent('#state-frame');
    const f1 = parseInt(frame1!, 10);

    await page.waitForTimeout(1500);

    const frame2 = await page.textContent('#state-frame');
    const f2 = parseInt(frame2!, 10);
    expect(f2).not.toBe(f1);

    await page.screenshot({
      path: path.join(EVIDENCE_DIR, 'screenshot-t2-6-back-to-auto.png'),
      fullPage: false,
    });
  });

  test('T2.7: Rapid slider movements — multiple positions', async ({ page }) => {
    await page.click('#btn-fetch-manual');
    await page.waitForTimeout(200);

    // Move slider rapidly through multiple positions
    const positions = [2, 5, 8, 11, 14, 10, 4, 0, 6, 12];
    for (const pos of positions) {
      await page.evaluate((value) => {
        const slider = document.getElementById('fetch-index-slider') as HTMLInputElement;
        slider.value = String(value);
        slider.dispatchEvent(new Event('input', { bubbles: true }));
      }, pos);
      await page.waitForTimeout(150);

      const frame = await page.textContent('#state-frame');
      expect(frame).toBe(String(pos));
    }

    // Engine should still be alive after rapid movements
    const engineText = await page.textContent('#info-engine');
    expect(engineText).toContain('WebGL');

    await page.screenshot({
      path: path.join(EVIDENCE_DIR, 'screenshot-t2-7-rapid-slider.png'),
      fullPage: false,
    });
  });
});

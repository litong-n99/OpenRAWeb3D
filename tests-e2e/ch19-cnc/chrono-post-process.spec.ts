/**
 * chrono-post-process.spec.ts
 *
 * Acceptance tests for ch19-cnc/chrono-post-process/.
 * Verifies the ChronoshiftPostProcessEffect behaviour:
 *   - Enable activation
 *   - Linear blendFactor decay
 *   - Full-screen colour shift visuals
 *   - Re-activation reset
 *   - Different durations
 *   - Reset and rapid-click edge cases
 */

import { test, expect } from '@playwright/test';
import path from 'node:path';

const PAGE_URL = '/test/ch19-cnc/chrono-post-process/';
const EVIDENCE_DIR = path.resolve('e:/OpenRAWeb3D/test-results/manual/ch19-cnc/chrono-post-process/evidence');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function gotoAndInit(page: any): Promise<void> {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto(PAGE_URL, { waitUntil: 'networkidle' });

  // Verify the Babylon.js canvas is present before any rendering assertions.
  await page.waitForSelector('#renderCanvas', { timeout: 15000 });
  await page.waitForSelector('#info-engine', { timeout: 15000 });
  await page.waitForFunction(
    () => {
      const text = document.getElementById('info-engine')?.textContent || '';
      return text.includes('WebGL');
    },
    { timeout: 15000 },
  );

  // Allow a short settle time so the first frame/tick has run.
  await page.waitForTimeout(300);
}

async function screenshot(page: any, name: string): Promise<void> {
  await page.screenshot({
    path: path.resolve(EVIDENCE_DIR, name),
    fullPage: false,
  });
}

async function getBlend(page: any): Promise<number> {
  const text = await page.$eval('#st-blend', (el: Element) => el.textContent || '0');
  return parseFloat(text);
}

async function getRemaining(page: any): Promise<number> {
  const text = await page.$eval('#st-remaining', (el: Element) => el.textContent || '0');
  return parseInt(text, 10);
}

async function getTotal(page: any): Promise<number> {
  const text = await page.$eval('#st-total', (el: Element) => el.textContent || '0');
  return parseInt(text, 10);
}

async function getEnabledText(page: any): Promise<string> {
  return page.$eval('#st-enabled', (el: Element) => el.textContent || '');
}

async function getBarText(page: any): Promise<string> {
  return page.$eval('#st-bar', (el: Element) => el.textContent || '');
}

async function resetEffect(page: any): Promise<void> {
  await page.locator('#btn-reset').click();
  await page.waitForTimeout(200);
}

async function activateEffect(page: any): Promise<void> {
  await page.locator('#btn-activate').click();
  // Wait one tick (40 ms) so the status panel has updated.
  await page.waitForTimeout(50);
}

/**
 * Computes the average RGB colour of the rendered WebGL canvas by drawing it
 * onto a temporary 2D canvas and reading back the pixels. Useful for headless
 * colour-shift verification.
 */
async function getCanvasAverageColor(page: any): Promise<{ r: number; g: number; b: number } | null> {
  return page.evaluate(() => {
    const canvas = document.getElementById('renderCanvas') as HTMLCanvasElement | null;
    if (!canvas) return null;

    const width = canvas.width || 1;
    const height = canvas.height || 1;
    const tmp = document.createElement('canvas');
    tmp.width = width;
    tmp.height = height;
    const ctx = tmp.getContext('2d');
    if (!ctx) return null;

    ctx.drawImage(canvas, 0, 0);
    const imageData = ctx.getImageData(0, 0, width, height).data;

    let r = 0;
    let g = 0;
    let b = 0;
    for (let i = 0; i < imageData.length; i += 4) {
      r += imageData[i];
      g += imageData[i + 1];
      b += imageData[i + 2];
    }

    const count = imageData.length / 4;
    return {
      r: r / count,
      g: g / count,
      b: b / count,
    };
  });
}

function isColorShiftedToward(
  base: { r: number; g: number; b: number },
  shifted: { r: number; g: number; b: number },
  channel: 'r' | 'g' | 'b',
): boolean {
  const diff = shifted[channel] - base[channel];
  // Require a clear increase in the target channel relative to the other two.
  const others: Array<'r' | 'g' | 'b'> = ['r', 'g', 'b'].filter((c) => c !== channel) as Array<'r' | 'g' | 'b'>;
  return diff > 2 && shifted[channel] > base[others[0]] + 1 && shifted[channel] > base[others[1]] + 1;
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

test.describe('ChronoshiftPostProcessEffect Acceptance Tests', () => {
  test.beforeEach(async ({ page }) => {
    await gotoAndInit(page);
  });

  // ==========================================================================
  // E1. Enable Activation (BLOCKER)
  // ==========================================================================
  test('E1: Enable activation sets enabled, blendFactor=1.0 and full remainingFrames', async ({ page }) => {
    await resetEffect(page);

    await activateEffect(page);

    const enabledText = await getEnabledText(page);
    expect(enabledText).toBe('激活中');

    const blend = await getBlend(page);
    expect(blend).toBeCloseTo(1.0, 3);

    const remaining = await getRemaining(page);
    const total = await getTotal(page);
    expect(remaining).toBe(total);
    expect(total).toBe(60);

    await screenshot(page, 'e1-activated-blend-1.0.png');
  });

  // ==========================================================================
  // E2. Linear Decay (MAJOR)
  // ==========================================================================
  test('E2: blendFactor decays linearly from 1.0 to 0.0 over the effect duration', async ({ page }) => {
    await resetEffect(page);
    await activateEffect(page);

    // Start state
    let blend = await getBlend(page);
    expect(blend).toBeCloseTo(1.0, 3);
    await screenshot(page, 'e2-start-blend-1.0.png');

    // Midway (~30 ticks / ~1.2 s). Headless timing may drift, so use a wide tolerance.
    await page.waitForTimeout(1200);
    blend = await getBlend(page);
    expect(blend).toBeGreaterThanOrEqual(0.4);
    expect(blend).toBeLessThanOrEqual(0.6);
    await screenshot(page, 'e2-mid-blend-around-0.5.png');

    // End state (~60 ticks / ~2.4 s).
    await page.waitForTimeout(1300);
    blend = await getBlend(page);
    expect(blend).toBeCloseTo(0.0, 3);

    const enabledText = await getEnabledText(page);
    expect(enabledText).toBe('未激活');

    const remaining = await getRemaining(page);
    expect(remaining).toBe(0);

    await screenshot(page, 'e2-end-blend-0.0.png');
  });

  // ==========================================================================
  // E3. Full-Screen Color Shift (MAJOR) — Visual
  // ==========================================================================
  test('E3: Full-screen colour shift is visible at blendFactor=1.0 and absent at 0.0', async ({ page }) => {
    await resetEffect(page);

    // Baseline screenshot before any colour shift.
    await page.waitForTimeout(500);
    const baseColor = await getCanvasAverageColor(page);
    expect(baseColor).not.toBeNull();
    await screenshot(page, 'e3-baseline-no-shift.png');

    // Chroma (blue) shift at full strength.
    await page.locator('#sel-mode').selectOption('chroma');
    await activateEffect(page);
    const chromaColor = await getCanvasAverageColor(page);
    expect(chromaColor).not.toBeNull();
    await screenshot(page, 'e3-chroma-blend-1.0.png');

    if (baseColor && chromaColor) {
      expect(isColorShiftedToward(baseColor, chromaColor, 'b')).toBe(true);
    }

    // Wait until the effect has fully faded.
    await page.waitForTimeout(2600);
    const fadedColor = await getCanvasAverageColor(page);
    expect(fadedColor).not.toBeNull();
    await screenshot(page, 'e3-chroma-blend-0.0.png');

    if (baseColor && fadedColor) {
      // The faded scene should be visually similar to the baseline again.
      const delta = Math.abs(baseColor.r - fadedColor.r)
        + Math.abs(baseColor.g - fadedColor.g)
        + Math.abs(baseColor.b - fadedColor.b);
      expect(delta).toBeLessThan(15);
    }

    // Red-shift mode.
    await page.locator('#sel-mode').selectOption('red');
    await activateEffect(page);
    const redColor = await getCanvasAverageColor(page);
    expect(redColor).not.toBeNull();
    await screenshot(page, 'e3-red-blend-1.0.png');

    if (baseColor && redColor) {
      expect(isColorShiftedToward(baseColor, redColor, 'r')).toBe(true);
    }

    // Green-shift mode.
    await page.waitForTimeout(2600);
    await page.locator('#sel-mode').selectOption('green');
    await activateEffect(page);
    const greenColor = await getCanvasAverageColor(page);
    expect(greenColor).not.toBeNull();
    await screenshot(page, 'e3-green-blend-1.0.png');

    if (baseColor && greenColor) {
      expect(isColorShiftedToward(baseColor, greenColor, 'g')).toBe(true);
    }
  });

  // ==========================================================================
  // E4. Re-activation Reset (MAJOR)
  // ==========================================================================
  test('E4: Re-activation while active resets remainingFrames and blendFactor', async ({ page }) => {
    await resetEffect(page);
    await activateEffect(page);

    // Wait roughly 1 s (~25 ticks) so the effect has decayed partway.
    await page.waitForTimeout(1000);
    let blend = await getBlend(page);
    expect(blend).toBeLessThan(0.9);

    // Re-activate: should immediately reset to full strength.
    await activateEffect(page);

    blend = await getBlend(page);
    expect(blend).toBeCloseTo(1.0, 3);

    const remaining = await getRemaining(page);
    const total = await getTotal(page);
    expect(remaining).toBe(total);
    expect(total).toBe(60);

    const barText = await getBarText(page);
    // Progress bar should show 0% and be full of underscores (no # fills).
    expect(barText).toMatch(/\[_{20}\]\s+0%/);

    await screenshot(page, 'e4-reactivated-resets-to-full.png');
  });

  // ==========================================================================
  // E5. Different Durations (MINOR)
  // ==========================================================================
  test('E5: Different durations decay to zero in their expected time windows', async ({ page }) => {
    // 120 ticks => ~4.8 s slow decay.
    await page.locator('#sel-duration').selectOption('120');
    await page.waitForTimeout(100);
    await activateEffect(page);
    expect(await getTotal(page)).toBe(120);
    expect(await getBlend(page)).toBeCloseTo(1.0, 3);
    await screenshot(page, 'e5-duration-120-start.png');

    await page.waitForTimeout(5500);
    expect(await getBlend(page)).toBeCloseTo(0.0, 3);
    expect(await getEnabledText(page)).toBe('未激活');
    await screenshot(page, 'e5-duration-120-end.png');

    // 30 ticks => ~1.2 s faster decay.
    await page.locator('#sel-duration').selectOption('30');
    await page.waitForTimeout(100);
    await activateEffect(page);
    expect(await getTotal(page)).toBe(30);
    expect(await getBlend(page)).toBeCloseTo(1.0, 3);
    await screenshot(page, 'e5-duration-30-start.png');

    await page.waitForTimeout(1800);
    expect(await getBlend(page)).toBeCloseTo(0.0, 3);
    expect(await getEnabledText(page)).toBe('未激活');
    await screenshot(page, 'e5-duration-30-end.png');

    // 15 ticks => ~0.6 s fastest decay.
    await page.locator('#sel-duration').selectOption('15');
    await page.waitForTimeout(100);
    await activateEffect(page);
    expect(await getTotal(page)).toBe(15);
    expect(await getBlend(page)).toBeCloseTo(1.0, 3);
    await screenshot(page, 'e5-duration-15-start.png');

    await page.waitForTimeout(1200);
    expect(await getBlend(page)).toBeCloseTo(0.0, 3);
    expect(await getEnabledText(page)).toBe('未激活');
    await screenshot(page, 'e5-duration-15-end.png');
  });

  // ==========================================================================
  // Edge Case: Reset
  // ==========================================================================
  test('Edge: Reset immediately cancels the effect and clears blendFactor', async ({ page }) => {
    await resetEffect(page);
    await activateEffect(page);

    // Let it run briefly.
    await page.waitForTimeout(500);
    let blend = await getBlend(page);
    expect(blend).toBeLessThan(1.0);

    await page.locator('#btn-reset').click();
    await page.waitForTimeout(100);

    blend = await getBlend(page);
    expect(blend).toBeCloseTo(0.0, 3);

    const enabledText = await getEnabledText(page);
    expect(enabledText).toBe('未激活');

    const remaining = await getRemaining(page);
    expect(remaining).toBe(0);

    await screenshot(page, 'edge-reset-clears-effect.png');
  });

  // ==========================================================================
  // Edge Case: Rapid Activation Clicks
  // ==========================================================================
  test('Edge: Rapid activation clicks keep blendFactor at 1.0 and count down from last click', async ({ page }) => {
    await resetEffect(page);

    // Three quick activations.
    await page.locator('#btn-activate').click();
    await page.locator('#btn-activate').click();
    await page.locator('#btn-activate').click();
    await page.waitForTimeout(100);

    const blend = await getBlend(page);
    expect(blend).toBeCloseTo(1.0, 3);

    const remaining = await getRemaining(page);
    const total = await getTotal(page);
    expect(remaining).toBe(total);
    expect(total).toBe(60);

    await screenshot(page, 'edge-rapid-clicks-blend-1.0.png');

    // Ensure it still decays normally from the last click.
    await page.waitForTimeout(2600);
    expect(await getBlend(page)).toBeCloseTo(0.0, 3);
    expect(await getEnabledText(page)).toBe('未激活');
    await screenshot(page, 'edge-rapid-clicks-decayed.png');
  });
});

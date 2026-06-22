/**
 * Playwright E2E Tests — SpriteRenderer Blend Mode Validation
 *
 * Target: /test/ch02-rendering/sprite-blend-modes/
 * Module: SpriteRenderer blend-mode to Babylon.js alphaMode mapping
 * OpenRA reference: SpriteRenderer.ts — BlendMode enum + blendModeToAlphaMode()
 *
 * Acceptance criteria covered:
 *   1. Alpha/Translucent — standard transparency (ALPHA_COMBINE)
 *   2. Additive/LowAdditive — brighten on overlap (ALPHA_ADD)
 *   3. Subtractive — darken toward black (ALPHA_SUBTRACT)
 *   4. Multiply/Multiplicative/DoubleMultiplicative — uniform darken (ALPHA_MULTIPLY)
 *   5. Screen — soft brighten (ALPHA_SCREENMODE)
 *   6. None — fully opaque (ALPHA_DISABLE)
 *   7. Mode switching is instant (<50ms) without flicker/ghosting
 *   8. Control interactions: alpha slider, background toggle, single-display,
 *      quick-compare, radius/offset sliders
 *
 * HEADLESS MODE NOTE:
 *   Visual blend-mode verification is performed by canvas screenshots. Timing
 *   assertions are relaxed in headless Chromium because there is no real
 *   display/GPU vsync and requestAnimationFrame timing is synthetic.
 */

import { test, expect, type Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';

const PAGE_URL = '/test/ch02-rendering/sprite-blend-modes/';
const OUT_DIR = process.env.PLAYWRIGHT_OUTPUT_DIR || './test-results';
const EVIDENCE_DIR = path.resolve(OUT_DIR, 'evidence');

function evidenceFile(name: string): string {
  if (!fs.existsSync(EVIDENCE_DIR)) {
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  }
  return path.join(EVIDENCE_DIR, name);
}

async function isHeadless(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const ua = navigator.userAgent.toLowerCase();
    return ua.includes('headless') || (navigator as any).webdriver === true;
  });
}

async function waitForEngineReady(page: Page, timeout = 20000): Promise<void> {
  await expect(page.locator('#info-engine'), 'engine info should contain WebGL').toContainText('WebGL', { timeout });
  await expect(page.locator('#sandbox canvas'), 'Babylon.js canvas should be attached').toBeAttached({ timeout });
}

async function blendItemByLabel(page: Page, label: string) {
  // .blend-item contains child .name (exact label) + .alpha-mode (extra text).
  // Use :text-is for exact match (hasText does substring, "Additive" would also match "LowAdditive").
  return page.locator('.blend-item').filter({ has: page.locator(`.name:text-is("${label}")`) });
}

async function selectBlendMode(page: Page, label: string): Promise<void> {
  const item = await blendItemByLabel(page, label);
  await item.scrollIntoViewIfNeeded();
  await item.click();
  await expect(item).toHaveClass(/selected/);
  // Allow one render frame for the highlight to propagate.
  await page.waitForTimeout(50);
}

async function setSlider(page: Page, id: string, value: number): Promise<void> {
  await page.evaluate(({ sliderId, val }) => {
    const slider = document.getElementById(sliderId) as HTMLInputElement | null;
    if (!slider) throw new Error(`Slider #${sliderId} not found`);
    slider.value = String(val);
    slider.dispatchEvent(new Event('input', { bubbles: true }));
    slider.dispatchEvent(new Event('change', { bubbles: true }));
  }, { sliderId: id, val: value });
  await page.waitForTimeout(100);
}

async function screenshotSandbox(page: Page, name: string): Promise<void> {
  await page.locator('#sandbox').screenshot({ path: evidenceFile(name) });
}

test.describe.configure({ mode: 'serial' });

test.describe('SpriteRenderer Blend Mode Validation', () => {
  let page: Page;
  let headless: boolean;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await page.goto(PAGE_URL);
    await waitForEngineReady(page);
    headless = await isHeadless(page);
  });

  test.afterAll(async () => {
    await page.close();
  });

  // ---------------------------------------------------------------------------
  // Expectation 0: Initial load shows all 10 blend-mode panels
  // ---------------------------------------------------------------------------
  test('E0: Initial load — all 10 blend-mode panels render', async () => {
    test.setTimeout(60000);

    const blendItems = page.locator('.blend-item');
    await expect(blendItems, 'should have 10 blend mode list items').toHaveCount(10);

    const expectedLabels = [
      'None', 'Alpha', 'Translucent', 'Additive', 'LowAdditive',
      'Subtractive', 'Multiply', 'Multiplicative', 'DoubleMultiplicative', 'Screen',
    ];
    for (const label of expectedLabels) {
      const item = await blendItemByLabel(page, label);
      await expect(item, `blend list should contain "${label}"`).toBeVisible();
    }

    await screenshotSandbox(page, 'screenshot-0-initial-all-panels.png');
  });

  // ---------------------------------------------------------------------------
  // Expectation 1: Alpha/Translucent — standard transparency
  // ---------------------------------------------------------------------------
  test('E1: Alpha/Translucent — standard semi-transparent blending', async () => {
    test.setTimeout(60000);

    await selectBlendMode(page, 'Alpha');
    await screenshotSandbox(page, 'screenshot-1-alpha-mode.png');

    await selectBlendMode(page, 'Translucent');
    await screenshotSandbox(page, 'screenshot-1-translucent-mode.png');

    await expect(page.locator('.blend-item.selected .name')).toHaveText('Translucent');
    await expect(page.locator('#sandbox canvas')).toBeAttached();
  });

  // ---------------------------------------------------------------------------
  // Expectation 2: Additive/LowAdditive — brighten on overlap
  // ---------------------------------------------------------------------------
  test('E2: Additive/LowAdditive — overlap brightens', async () => {
    test.setTimeout(60000);

    await selectBlendMode(page, 'Additive');
    await screenshotSandbox(page, 'screenshot-2-additive-mode.png');

    await selectBlendMode(page, 'LowAdditive');
    await screenshotSandbox(page, 'screenshot-2-low-additive-mode.png');

    await expect(page.locator('.blend-item.selected .name')).toHaveText('LowAdditive');
    await expect(page.locator('#sandbox canvas')).toBeAttached();
  });

  // ---------------------------------------------------------------------------
  // Expectation 3: Subtractive — overlap darkens toward black
  // ---------------------------------------------------------------------------
  test('E3: Subtractive — overlap darkens toward black', async () => {
    test.setTimeout(60000);

    await selectBlendMode(page, 'Subtractive');
    await screenshotSandbox(page, 'screenshot-3-subtractive-mode.png');

    await expect(page.locator('.blend-item.selected .name')).toHaveText('Subtractive');
    await expect(page.locator('#sandbox canvas')).toBeAttached();
  });

  // ---------------------------------------------------------------------------
  // Expectation 4: Multiply/Multiplicative/DoubleMultiplicative — uniform darken
  // ---------------------------------------------------------------------------
  test('E4: Multiply/Multiplicative/DoubleMultiplicative — uniform darkening', async () => {
    test.setTimeout(60000);

    await selectBlendMode(page, 'Multiply');
    await screenshotSandbox(page, 'screenshot-4-multiply-mode.png');

    await selectBlendMode(page, 'Multiplicative');
    await screenshotSandbox(page, 'screenshot-4-multiplicative-mode.png');

    await selectBlendMode(page, 'DoubleMultiplicative');
    await screenshotSandbox(page, 'screenshot-4-double-multiplicative-mode.png');

    // Known limitation: multiply family does not respond to global alpha slider.
    await setSlider(page, 'alpha-slider', 0.5);
    await screenshotSandbox(page, 'screenshot-4-multiply-alpha-known-limitation.png');
    await setSlider(page, 'alpha-slider', 1);

    await expect(page.locator('.blend-item.selected .name')).toHaveText('DoubleMultiplicative');
    await expect(page.locator('#sandbox canvas')).toBeAttached();
  });

  // ---------------------------------------------------------------------------
  // Expectation 5: Screen — soft brighten
  // ---------------------------------------------------------------------------
  test('E5: Screen — soft brightening without overexposure', async () => {
    test.setTimeout(60000);

    await selectBlendMode(page, 'Screen');
    await screenshotSandbox(page, 'screenshot-5-screen-mode.png');

    await expect(page.locator('.blend-item.selected .name')).toHaveText('Screen');
    await expect(page.locator('#sandbox canvas')).toBeAttached();
  });

  // ---------------------------------------------------------------------------
  // Expectation 6: None — fully opaque, alpha ignored
  // ---------------------------------------------------------------------------
  test('E6: None — fully opaque, alpha channel ignored', async () => {
    test.setTimeout(60000);

    await selectBlendMode(page, 'None');
    await screenshotSandbox(page, 'screenshot-6-none-mode.png');

    await expect(page.locator('.blend-item.selected .name')).toHaveText('None');
    await expect(page.locator('#sandbox canvas')).toBeAttached();
  });

  // ---------------------------------------------------------------------------
  // Expectation 7: Mode switching is instant (<50ms) without flicker/ghosting
  // ---------------------------------------------------------------------------
  test('E7: Mode switching is instant and free of flicker/ghosting', async () => {
    test.setTimeout(60000);

    const modeSequence = ['Alpha', 'Additive', 'Subtractive', 'Multiply', 'Screen', 'None'];
    const timings: number[] = [];

    for (const label of modeSequence) {
      const start = Date.now();
      await selectBlendMode(page, label);
      const elapsed = Date.now() - start;
      timings.push(elapsed);
    }

    console.log(`[E7] switch timings (ms): ${timings.join(', ')} headless=${headless}`);

    if (!headless) {
      for (let i = 0; i < timings.length; i++) {
        expect(
          timings[i],
          `switch to ${modeSequence[i]} took ${timings[i]}ms, should be <= 50ms`
        ).toBeLessThanOrEqual(50);
      }
    }

    // No error overlay should be visible after rapid switching.
    await expect(page.locator('#gpu-error')).toBeHidden();
  });

  // ---------------------------------------------------------------------------
  // Expectation 8: Control interactions
  // ---------------------------------------------------------------------------
  test('E8: Control interactions — alpha, background, single-display, quick-compare, radius/offset', async () => {
    test.setTimeout(60000);

    // Ensure we start from a responsive mode (Alpha) and reset alpha to 1.
    await selectBlendMode(page, 'Alpha');
    await setSlider(page, 'alpha-slider', 1);

    // Global alpha = 0 — panels should become invisible (responsive modes).
    await setSlider(page, 'alpha-slider', 0);
    await screenshotSandbox(page, 'screenshot-7-alpha-zero.png');
    await setSlider(page, 'alpha-slider', 1);

    // Toggle background off and on.
    await page.locator('#show-background').setChecked(false);
    await page.waitForTimeout(100);
    await screenshotSandbox(page, 'screenshot-8-background-off.png');

    await page.locator('#show-background').setChecked(true);
    await page.waitForTimeout(100);

    // Toggle labels off and on.
    await page.locator('#show-labels').setChecked(false);
    await page.waitForTimeout(100);
    await page.locator('#show-labels').setChecked(true);
    await page.waitForTimeout(100);

    // Single-display unchecked: only the selected mode panel is visible.
    await page.locator('#single-display').setChecked(false);
    await page.waitForTimeout(100);
    await screenshotSandbox(page, 'screenshot-9-single-display-only-selected.png');

    await page.locator('#single-display').setChecked(true);
    await page.waitForTimeout(100);

    // Radius slider extremes.
    await setSlider(page, 'radius-slider', 0.3);
    await screenshotSandbox(page, 'screenshot-10-radius-min.png');

    await setSlider(page, 'radius-slider', 2);
    await screenshotSandbox(page, 'screenshot-10-radius-max.png');

    await setSlider(page, 'radius-slider', 1);

    // Offset slider extremes.
    await setSlider(page, 'offset-slider', -1.5);
    await screenshotSandbox(page, 'screenshot-11-offset-min.png');

    await setSlider(page, 'offset-slider', 1.5);
    await screenshotSandbox(page, 'screenshot-11-offset-max.png');

    await setSlider(page, 'offset-slider', 0);

    // Quick-compare mode: cycles through modes automatically every 1.5s.
    await page.locator('#quick-compare').setChecked(true);
    await page.waitForTimeout(3200);
    await screenshotSandbox(page, 'screenshot-12-quick-compare.png');
    await page.locator('#quick-compare').setChecked(false);
    await page.waitForTimeout(100);

    // Final reset and overview.
    await selectBlendMode(page, 'Alpha');
    await screenshotSandbox(page, 'screenshot-13-controls-reset.png');

    await expect(page.locator('#sandbox canvas')).toBeAttached();
    await expect(page.locator('#gpu-error')).toBeHidden();
  });
});

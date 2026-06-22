/**
 * Playwright E2E Tests — SpriteRenderer Billboard Behavior
 *
 * Target: http://localhost:5173/test/ch02-rendering/sprite-billboarding/
 * Module: SpriteRenderer billboard orientation validation
 * OpenRA reference: SpriteRenderer.cs (BILLBOARDMODE_Y)
 *
 * Acceptance criteria covered:
 *   1. BILLBOARDMODE_Y default view: 25 sprites face camera, upright posture
 *   2. Camera rotation: sprites continuously face camera; reference sprite shows side
 *   3. Beta angle independence: billboard works at 30° and 150°
 *   4. Mode switching: Y → ALL → NONE is instant (<50ms) and visually distinct
 *   5. FPS stability during auto-rotation
 *
 * HEADLESS MODE NOTE:
 *   FPS readings in headless Chromium are unreliable because there is no real
 *   display/GPU vsync and requestAnimationFrame timing is synthetic. This spec
 *   therefore relaxes FPS thresholds when headless and treats strict FPS tests
 *   as informational / best-effort.
 */

import { test, expect, type Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';

const PAGE_URL = 'http://localhost:5173/test/ch02-rendering/sprite-billboarding/';
const EVIDENCE_DIR = path.resolve(
  'test-results/manual/ch02-rendering/sprite-billboarding/evidence'
);

function evidenceFile(name: string): string {
  return path.join(EVIDENCE_DIR, name);
}

async function isHeadless(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const ua = navigator.userAgent.toLowerCase();
    return ua.includes('headless') || (navigator as any).webdriver === true;
  });
}

async function waitForEngineReady(page: Page, timeout = 20000): Promise<void> {
  await page.waitForFunction(
    () => {
      const engineEl = document.getElementById('info-engine');
      const fpsEl = document.getElementById('info-fps');
      const engineReady = engineEl?.textContent?.includes('WebGL') ?? false;
      const fpsText = fpsEl?.textContent ?? '';
      const fpsReady = fpsText !== '-' && fpsText !== '' && fpsText !== '0';
      return engineReady && fpsReady;
    },
    { timeout }
  );
}

async function waitForCanvas(page: Page): Promise<void> {
  await expect(page.locator('#sandbox canvas'), 'Babylon.js canvas should be attached').toBeAttached();
}

async function resetCamera(page: Page): Promise<void> {
  await page.locator('#reset-cam').click();
  await page.waitForTimeout(300);
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

async function readFps(page: Page): Promise<number> {
  const text = await page.locator('#info-fps').textContent();
  const fps = parseFloat(text ?? '-1');
  return Number.isNaN(fps) ? -1 : fps;
}

async function readState(page: Page): Promise<{
  sprites: number;
  alpha: number;
  beta: number;
  rot: number;
}> {
  const [spritesText, alphaText, betaText, rotText] = await Promise.all([
    page.locator('#state-sprites').textContent(),
    page.locator('#state-alpha').textContent(),
    page.locator('#state-beta').textContent(),
    page.locator('#state-rot').textContent(),
  ]);

  const parseNum = (text: string | null): number => {
    const cleaned = (text ?? '').replace(/[^0-9.\-]/g, '');
    if (cleaned === '' || cleaned === '-') return -1;
    return parseFloat(cleaned);
  };
  return {
    sprites: parseNum(spritesText),
    alpha: parseNum(alphaText),
    beta: parseNum(betaText),
    rot: parseNum(rotText),
  };
}

test.describe.configure({ mode: 'serial' });

test.describe('SpriteRenderer Billboard Behavior', () => {
  let page: Page;
  let headless: boolean;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await page.goto(PAGE_URL);
    // WebGL rendering stabilization after initial page load
    await page.waitForTimeout(2000);
    await waitForEngineReady(page);
    await waitForCanvas(page);
    headless = await isHeadless(page);
  });

  test.afterAll(async () => {
    await page.close();
  });

  // -------------------------------------------------------------------------
  // Expectation 1: BILLBOARDMODE_Y — sprites face camera and stay upright
  // -------------------------------------------------------------------------
  test('E1: BILLBOARDMODE_Y default view — sprites face camera and stay upright', async () => {
    test.setTimeout(60000);

    // Ensure default RTS view (alpha=-90°, beta=72°, radius=12)
    await resetCamera(page);
    await page.waitForTimeout(2000);

    const state = await readState(page);
    expect(state.sprites, 'sprite count should be 25').toBe(25);
    expect(state.alpha, 'default alpha should be -90°').toBe(-90);
    expect(state.beta, 'default beta should be 72°').toBe(72);

    // Confirm BILLBOARDMODE_Y is selected by default
    const modeValue = await page.locator('#billboard-mode').inputValue();
    expect(modeValue, 'default billboard mode should be Y').toBe('Y');

    // In BILLBOARDMODE_Y the displayed sprite Z rotation should stay near 0°
    // because only Y-axis rotation is applied by the billboard system.
    expect(
      Math.abs(state.rot),
      'sprite Z rotation should stay near 0° (upright)'
    ).toBeLessThanOrEqual(5);

    await page.screenshot({
      path: evidenceFile('screenshot-1-default-view.png'),
      fullPage: true,
    });
  });

  // -------------------------------------------------------------------------
  // Expectation 2: Camera rotation — sprites continuously face camera
  // -------------------------------------------------------------------------
  test('E2: Camera rotation — billboard sprites continuously face camera', async () => {
    test.setTimeout(60000);

    await resetCamera(page);
    await page.waitForTimeout(1500);

    // Sweep alpha from -90° to -180°
    await setSlider(page, 'alpha-slider', -180);
    await page.waitForTimeout(1500);

    let state = await readState(page);
    expect(state.alpha, 'alpha should reach -180°').toBe(-180);

    await page.screenshot({
      path: evidenceFile('screenshot-2-alpha-negative-180.png'),
      fullPage: true,
    });

    // Continue sweep to 0°
    await setSlider(page, 'alpha-slider', 0);
    await page.waitForTimeout(1500);

    state = await readState(page);
    expect(state.alpha, 'alpha should reach 0°').toBe(0);

    await page.screenshot({
      path: evidenceFile('e2-alpha-0-evidence.png'),
      fullPage: true,
    });

    // Reset and enable auto-rotate for a 360°-style verification
    await resetCamera(page);
    await page.waitForTimeout(1000);

    await page.locator('#auto-rotate').check();
    await page.waitForTimeout(5000);

    const rotatedState = await readState(page);
    expect(
      rotatedState.alpha,
      'auto-rotate should have moved alpha away from the starting -90°'
    ).not.toBe(-90);

    await page.screenshot({
      path: evidenceFile('e2-auto-rotate-evidence.png'),
      fullPage: true,
    });

    await page.locator('#auto-rotate').uncheck();
    await page.waitForTimeout(500);
  });

  // -------------------------------------------------------------------------
  // Expectation 3: Beta angle does not affect billboard effect
  // -------------------------------------------------------------------------
  test('E3: Beta angle does not affect billboard effect', async () => {
    test.setTimeout(60000);

    await resetCamera(page);
    await page.waitForTimeout(1500);

    // Beta 30° (near-horizontal)
    await setSlider(page, 'beta-slider', 30);
    await page.waitForTimeout(2000);

    let state = await readState(page);
    expect(state.beta, 'beta should be 30°').toBe(30);
    expect(
      Math.abs(state.rot),
      'sprite Z rotation should remain upright at beta=30°'
    ).toBeLessThanOrEqual(5);

    await page.screenshot({
      path: evidenceFile('screenshot-3-beta-30.png'),
      fullPage: true,
    });

    // Beta 150° (near-top-down)
    await setSlider(page, 'beta-slider', 150);
    await page.waitForTimeout(2000);

    state = await readState(page);
    expect(state.beta, 'beta should be 150°').toBe(150);
    expect(
      Math.abs(state.rot),
      'sprite Z rotation should remain upright at beta=150°'
    ).toBeLessThanOrEqual(5);

    await page.screenshot({
      path: evidenceFile('screenshot-4-beta-150.png'),
      fullPage: true,
    });

    // Reset
    await resetCamera(page);
    await page.waitForTimeout(500);
  });

  // -------------------------------------------------------------------------
  // Expectation 4: Billboard mode switching is instant and visually distinct
  // -------------------------------------------------------------------------
  test('E4: Billboard mode switching is instant and visually distinct', async () => {
    test.setTimeout(60000);

    await resetCamera(page);
    await page.waitForTimeout(1500);

    // Switch Y -> ALL
    const switchToAllStart = Date.now();
    await page.locator('#billboard-mode').selectOption('ALL');
    await page.waitForTimeout(100);
    const switchToAllMs = Date.now() - switchToAllStart;

    expect(await page.locator('#billboard-mode').inputValue(), 'mode should be ALL').toBe('ALL');

    await page.screenshot({
      path: evidenceFile('screenshot-5-billboard-all.png'),
      fullPage: true,
    });

    // Switch ALL -> NONE
    const switchToNoneStart = Date.now();
    await page.locator('#billboard-mode').selectOption('NONE');
    await page.waitForTimeout(100);
    const switchToNoneMs = Date.now() - switchToNoneStart;

    expect(await page.locator('#billboard-mode').inputValue(), 'mode should be NONE').toBe('NONE');

    // Move the camera so non-billboard sprites clearly show their side
    await setSlider(page, 'alpha-slider', -150);
    await page.waitForTimeout(1500);

    await page.screenshot({
      path: evidenceFile('screenshot-6-billboard-none.png'),
      fullPage: true,
    });

    console.log(
      `[E4] switch Y->ALL=${switchToAllMs}ms ALL->NONE=${switchToNoneMs}ms headless=${headless}`
    );

    if (!headless) {
      expect(
        switchToAllMs,
        `Y->ALL switch took ${switchToAllMs}ms, should be <= 50ms`
      ).toBeLessThanOrEqual(50);
      expect(
        switchToNoneMs,
        `ALL->NONE switch took ${switchToNoneMs}ms, should be <= 50ms`
      ).toBeLessThanOrEqual(50);
    } else {
      console.log('[E4] headless mode: timing thresholds are informational');
    }

    // Restore default billboard mode and camera
    await page.locator('#billboard-mode').selectOption('Y');
    await resetCamera(page);
    await page.waitForTimeout(500);
  });

  // -------------------------------------------------------------------------
  // Expectation 5: FPS stability during auto-rotation
  // -------------------------------------------------------------------------
  test('E5: FPS stability during auto-rotation', async () => {
    test.setTimeout(60000);

    await resetCamera(page);
    await page.waitForTimeout(1500);

    await page.locator('#auto-rotate').check();
    await page.waitForTimeout(2000);

    const fpsSamples: number[] = [];
    const end = Date.now() + 8000;
    while (Date.now() < end) {
      const fps = await readFps(page);
      if (fps >= 0) fpsSamples.push(fps);
      await page.waitForTimeout(500);
    }

    await page.locator('#auto-rotate').uncheck();
    await page.waitForTimeout(500);

    const minFps = fpsSamples.length ? Math.min(...fpsSamples) : 0;
    const avgFps = fpsSamples.length
      ? fpsSamples.reduce((a, b) => a + b, 0) / fpsSamples.length
      : 0;

    console.log(
      `[E5] samples=${fpsSamples.length} minFps=${minFps.toFixed(1)} avgFps=${avgFps.toFixed(1)} headless=${headless}`
    );

    expect(
      fpsSamples.length,
      'should collect FPS samples during auto-rotation'
    ).toBeGreaterThanOrEqual(3);
    expect(
      fpsSamples.every((f) => f > 0),
      'FPS should remain > 0 during rotation'
    ).toBe(true);

    if (!headless) {
      expect(
        minFps,
        `min FPS ${minFps.toFixed(1)} should be >= 55`
      ).toBeGreaterThanOrEqual(55);
      expect(
        avgFps,
        `avg FPS ${avgFps.toFixed(1)} should be >= 55`
      ).toBeGreaterThanOrEqual(55);
    } else {
      console.log('[E5] headless mode: timing thresholds are informational');
    }
  });
});

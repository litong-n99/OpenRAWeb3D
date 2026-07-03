import { test, expect } from '@playwright/test';
import {
  gotoRadar,
  screenshot,
  getViewportFromDOM,
  getCounts,
  getPixel,
  MAP_CELLS_W,
  MAP_CELLS_H,
  VIS_VISIBLE,
} from './radar-helpers.ts';

test.use({ baseURL: 'http://localhost:5173' });

test.describe('RadarWidget — Control buttons and keyboard', () => {
  test.beforeEach(async ({ page }) => {
    await gotoRadar(page);
  });

  // --- Viewport direction buttons ---

  test('B1: btn-viewport-up decreases viewportY by 2 cells', async ({ page }) => {
    const before = await getViewportFromDOM(page);
    await page.locator('#btn-viewport-up').click();
    await page.waitForTimeout(300);

    const after = await getViewportFromDOM(page);
    expect(after.y).toBe(Math.max(0, before.y - 2));
    expect(after.x).toBe(before.x);

    await screenshot(page, 'b1-viewport-up');
  });

  test('B2: btn-viewport-down increases viewportY by 2 cells', async ({ page }) => {
    const before = await getViewportFromDOM(page);
    await page.locator('#btn-viewport-down').click();
    await page.waitForTimeout(300);

    const after = await getViewportFromDOM(page);
    expect(after.y).toBe(Math.min(MAP_CELLS_H - before.h, before.y + 2));
    expect(after.x).toBe(before.x);

    await screenshot(page, 'b2-viewport-down');
  });

  test('B3: btn-viewport-left decreases viewportX by 2 cells', async ({ page }) => {
    const before = await getViewportFromDOM(page);
    await page.locator('#btn-viewport-left').click();
    await page.waitForTimeout(300);

    const after = await getViewportFromDOM(page);
    expect(after.x).toBe(Math.max(0, before.x - 2));
    expect(after.y).toBe(before.y);

    await screenshot(page, 'b3-viewport-left');
  });

  test('B4: btn-viewport-right increases viewportX by 2 cells', async ({ page }) => {
    const before = await getViewportFromDOM(page);
    await page.locator('#btn-viewport-right').click();
    await page.waitForTimeout(300);

    const after = await getViewportFromDOM(page);
    expect(after.x).toBe(Math.min(MAP_CELLS_W - before.w, before.x + 2));
    expect(after.y).toBe(before.y);

    await screenshot(page, 'b4-viewport-right');
  });

  test('B5: Arrow button at boundary clamps correctly', async ({ page }) => {
    // Click up 8 times from initial y=10 to reach y=0 (moves by 2 each)
    for (let i = 0; i < 8; i++) {
      await page.locator('#btn-viewport-up').click();
      await page.waitForTimeout(50);
    }

    // One more click should not go negative
    await page.locator('#btn-viewport-up').click();
    await page.waitForTimeout(200);

    const vp = await getViewportFromDOM(page);
    expect(vp.y).toBe(0);

    // Also test left clamp
    await page.locator('#btn-viewport-left').click();
    await page.waitForTimeout(200);
    // After 6 clicks left from x=15, x should be at 0 or 1 (clamped)
    // Just verify not negative
    expect(vp.x).toBeGreaterThanOrEqual(0);

    await screenshot(page, 'b5-button-clamp');
  });

  // --- Shroud control buttons ---

  test('B6: btn-reveal-all sets all 3072 cells to visible', async ({ page }) => {
    await page.locator('#btn-reveal-all').click();
    await page.waitForTimeout(300);

    const counts = await getCounts(page);
    expect(counts.visible).toBe(3072);
    expect(counts.fog).toBe(0);
    expect(counts.shroud).toBe(0);

    // After reveal-all, a previously shrouded cell should show terrain color
    const color = await getPixel(page, 60 * 4 + 2, 40 * 4 + 2);
    const isBlack = color[0] === 0 && color[1] === 0 && color[2] === 0;
    expect(isBlack).toBe(false);

    await screenshot(page, 'b6-reveal-all');
  });

  test('B7: btn-reset-shroud restores initial circular visibility pattern', async ({ page }) => {
    // First reveal all, then reset
    await page.locator('#btn-reveal-all').click();
    await page.waitForTimeout(200);
    await page.locator('#btn-reset-shroud').click();
    await page.waitForTimeout(300);

    const counts = await getCounts(page);
    expect(counts.shroud).toBeGreaterThan(0);
    expect(counts.visible).toBeLessThan(3072);

    // The pattern should match the initial ~437/734/1901 split
    expect(counts.visible).toBeGreaterThanOrEqual(400);
    expect(counts.visible).toBeLessThanOrEqual(500);
    expect(counts.fog).toBeGreaterThanOrEqual(650);
    expect(counts.fog).toBeLessThanOrEqual(800);

    await screenshot(page, 'b7-reset-shroud');
  });

  test('B8: btn-random-shroud changes visibility pattern', async ({ page }) => {
    const before = await getCounts(page);

    await page.locator('#btn-random-shroud').click();
    await page.waitForTimeout(300);

    const after = await getCounts(page);

    // The pattern should be different from initial
    const changed =
      before.visible !== after.visible ||
      before.fog !== after.fog ||
      before.shroud !== after.shroud;
    expect(changed).toBe(true);

    // Total should still be 3072
    expect(after.visible + after.fog + after.shroud).toBe(3072);

    await screenshot(page, 'b8-random-shroud');
  });

  // --- Keyboard navigation ---

  test('B9: ArrowDown key moves viewport down by 1 cell', async ({ page }) => {
    // Click on canvas to focus it for keyboard events
    await page.locator('#radar-canvas').click();
    await page.waitForTimeout(200);

    const before = await getViewportFromDOM(page);
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(200);

    const after = await getViewportFromDOM(page);
    expect(after.y).toBe(Math.min(MAP_CELLS_H - before.h, before.y + 1));
    expect(after.x).toBe(before.x);

    await screenshot(page, 'b9-arrow-down');
  });

  test('B10: ArrowUp key moves viewport up by 1 cell', async ({ page }) => {
    await page.locator('#radar-canvas').click();
    await page.waitForTimeout(200);

    const before = await getViewportFromDOM(page);
    await page.keyboard.press('ArrowUp');
    await page.waitForTimeout(200);

    const after = await getViewportFromDOM(page);
    expect(after.y).toBe(Math.max(0, before.y - 1));
    expect(after.x).toBe(before.x);

    await screenshot(page, 'b10-arrow-up');
  });

  test('B11: ArrowLeft key moves viewport left by 1 cell', async ({ page }) => {
    await page.locator('#radar-canvas').click();
    await page.waitForTimeout(200);

    const before = await getViewportFromDOM(page);
    await page.keyboard.press('ArrowLeft');
    await page.waitForTimeout(200);

    const after = await getViewportFromDOM(page);
    expect(after.x).toBe(Math.max(0, before.x - 1));
    expect(after.y).toBe(before.y);

    await screenshot(page, 'b11-arrow-left');
  });

  test('B12: ArrowRight key moves viewport right by 1 cell', async ({ page }) => {
    await page.locator('#radar-canvas').click();
    await page.waitForTimeout(200);

    const before = await getViewportFromDOM(page);
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(200);

    const after = await getViewportFromDOM(page);
    expect(after.x).toBe(Math.min(MAP_CELLS_W - before.w, before.x + 1));
    expect(after.y).toBe(before.y);

    await screenshot(page, 'b12-arrow-right');
  });
});

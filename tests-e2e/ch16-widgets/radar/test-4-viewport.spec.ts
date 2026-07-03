import { test, expect } from '@playwright/test';
import {
  gotoRadar,
  screenshot,
  getViewportFromDOM,
  getCanvasBox,
  RADAR_SCALE,
} from './radar-helpers.ts';

test.use({ baseURL: 'http://localhost:5173' });

test.describe('RadarWidget — Viewport rectangle interaction', () => {
  test.beforeEach(async ({ page }) => {
    await gotoRadar(page);
  });

  test('V1: Viewport starts at (15, 10) with size 8x6 cells', async ({ page }) => {
    const vp = await getViewportFromDOM(page);
    expect(vp).toEqual({ x: 15, y: 10, w: 8, h: 6 });
    await screenshot(page, 'v1-initial-viewport');
  });

  test('V2: Hovering the viewport rectangle changes cursor to grab', async ({ page }) => {
    const box = await getCanvasBox(page);
    const vp = await getViewportFromDOM(page);
    const centrePx = {
      x: box.x + (vp.x + vp.w / 2) * RADAR_SCALE,
      y: box.y + (vp.y + vp.h / 2) * RADAR_SCALE,
    };

    await page.mouse.move(centrePx.x, centrePx.y);
    await page.waitForTimeout(50);

    const cursor = await page.evaluate(() => (document.getElementById('radar-canvas') as HTMLCanvasElement).style.cursor);
    expect(cursor).toBe('grab');

    await screenshot(page, 'v2-hover-grab');
  });

  test('V3: Dragging the viewport rectangle moves it and shows grabbing cursor', async ({ page }) => {
    const box = await getCanvasBox(page);
    const startVp = await getViewportFromDOM(page);

    const startPx = {
      x: box.x + (startVp.x + startVp.w / 2) * RADAR_SCALE,
      y: box.y + (startVp.y + startVp.h / 2) * RADAR_SCALE,
    };

    // Start drag on the viewport centre.
    await page.mouse.move(startPx.x, startPx.y);
    await page.mouse.down();
    await page.waitForTimeout(50);

    const dragCursor = await page.evaluate(() => (document.getElementById('radar-canvas') as HTMLCanvasElement).style.cursor);
    expect(dragCursor).toBe('grabbing');

    // Drag 20 radar pixels right and 16 down (5 cells right, 4 down).
    await page.mouse.move(startPx.x + 20, startPx.y + 16);
    await page.waitForTimeout(50);

    const midVp = await getViewportFromDOM(page);
    expect(midVp.x).toBeGreaterThan(startVp.x);
    expect(midVp.y).toBeGreaterThan(startVp.y);

    await page.mouse.up();
    await page.waitForTimeout(50);

    const endCursor = await page.evaluate(() => (document.getElementById('radar-canvas') as HTMLCanvasElement).style.cursor);
    expect(endCursor).toBe('crosshair');

    await screenshot(page, 'v3-drag-viewport');
  });

  test('V4: Dragging the viewport beyond map edges clamps it inside bounds', async ({ page }) => {
    const box = await getCanvasBox(page);
    const startVp = await getViewportFromDOM(page);

    const startPx = {
      x: box.x + (startVp.x + startVp.w / 2) * RADAR_SCALE,
      y: box.y + (startVp.y + startVp.h / 2) * RADAR_SCALE,
    };

    await page.mouse.move(startPx.x, startPx.y);
    await page.mouse.down();
    // Drag far to the bottom-right corner of the canvas.
    await page.mouse.move(box.x + box.w - 4, box.y + box.h - 4);
    await page.waitForTimeout(50);
    await page.mouse.up();

    const vp = await getViewportFromDOM(page);
    expect(vp.x).toBeLessThanOrEqual(64 - vp.w); // 56
    expect(vp.y).toBeLessThanOrEqual(48 - vp.h); // 42
    expect(vp.x).toBeGreaterThanOrEqual(0);
    expect(vp.y).toBeGreaterThanOrEqual(0);

    await screenshot(page, 'v4-drag-clamped');
  });
});

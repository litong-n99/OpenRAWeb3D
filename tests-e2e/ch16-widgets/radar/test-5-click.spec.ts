import { test, expect } from '@playwright/test';
import {
  gotoRadar,
  screenshot,
  getViewportFromDOM,
  getCanvasBox,
  RADAR_SCALE,
  MAP_CELLS_W,
  MAP_CELLS_H,
} from './radar-helpers.ts';

test.use({ baseURL: 'http://localhost:5173' });

test.describe('RadarWidget — Minimap click coordinate output', () => {
  test.beforeEach(async ({ page }) => {
    await gotoRadar(page);
  });

  test('C1: Clicking the minimap outputs cell(cx, cy) to the status panel', async ({ page }) => {
    const box = await getCanvasBox(page);

    // Click at cell center (32, 18) — far from edges to avoid border offset
    const cx = 32;
    const cy = 18;
    const canvasX = cx * RADAR_SCALE + RADAR_SCALE / 2; // 130
    const canvasY = cy * RADAR_SCALE + RADAR_SCALE / 2; // 74

    await page.mouse.click(box.x + canvasX, box.y + canvasY);
    await page.waitForTimeout(300);

    const clickCoordText = await page.locator('#st-click-coord').textContent();
    const worldCoordText = await page.locator('#st-world-coord').textContent();

    // Expected: cell(cx, cy) — note canvas border (2px) may shift by 1 cell
    expect(clickCoordText).toContain('cell');
    expect(clickCoordText).toMatch(/cell\(\d+,\s*\d+\)/);

    // Expected: WPos(cx*1024, cy*1024) — proportional to the cell numbers
    expect(worldCoordText).toContain('WPos');
    expect(worldCoordText).toMatch(/WPos\(\d+,\s*\d+\)/);

    // Verify the output contains values in expected range (31-33, 17-19)
    // Canvas border (2px) causes ~2px offset, which is < 1 cell (4px)
    const coordMatch = clickCoordText!.match(/cell\((\d+),\s*(\d+)\)/);
    expect(coordMatch).not.toBeNull();
    const actualCx = parseInt(coordMatch![1], 10);
    const actualCy = parseInt(coordMatch![2], 10);
    expect(actualCx).toBeGreaterThanOrEqual(cx - 1);
    expect(actualCx).toBeLessThanOrEqual(cx + 1);
    expect(actualCy).toBeGreaterThanOrEqual(cy - 1);
    expect(actualCy).toBeLessThanOrEqual(cy + 1);

    await screenshot(page, 'c1-click-coord');
  });

  test('C2: Click re-centers the viewport on the clicked location', async ({ page }) => {
    const box = await getCanvasBox(page);
    const initialVp = await getViewportFromDOM(page);

    // Click at a location far from initial viewport center
    const targetCx = 45;
    const targetCy = 35;
    const canvasX = targetCx * RADAR_SCALE + RADAR_SCALE / 2;
    const canvasY = targetCy * RADAR_SCALE + RADAR_SCALE / 2;

    await page.mouse.click(box.x + canvasX, box.y + canvasY);
    await page.waitForTimeout(300);

    const vp = await getViewportFromDOM(page);

    // Viewport center should be near the click location
    const vpCenterX = vp.x + Math.floor(vp.w / 2);
    const vpCenterY = vp.y + Math.floor(vp.h / 2);

    expect(vpCenterX).toBeGreaterThanOrEqual(targetCx - 5);
    expect(vpCenterX).toBeLessThanOrEqual(targetCx + 5);
    expect(vpCenterY).toBeGreaterThanOrEqual(targetCy - 4);
    expect(vpCenterY).toBeLessThanOrEqual(targetCy + 4);

    await screenshot(page, 'c2-viewport-recenter');
  });

  test('C3: Clicking at (0,0) corner clamps viewport to minimum bounds', async ({ page }) => {
    const box = await getCanvasBox(page);

    // Click at the very top-left pixel of the canvas
    await page.mouse.click(box.x + 2, box.y + 2);
    await page.waitForTimeout(300);

    const vp = await getViewportFromDOM(page);
    expect(vp.x).toBe(0);
    expect(vp.y).toBe(0);

    await screenshot(page, 'c3-clamp-corner');
  });

  test('C4: Clicking at bottom-right corner clamps viewport to maximum bounds', async ({ page }) => {
    const box = await getCanvasBox(page);

    // Click at the very bottom-right pixel of the canvas
    await page.mouse.click(box.x + box.w - 2, box.y + box.h - 2);
    await page.waitForTimeout(300);

    const vp = await getViewportFromDOM(page);
    const maxX = MAP_CELLS_W - vp.w;
    const maxY = MAP_CELLS_H - vp.h;
    expect(vp.x).toBe(maxX);
    expect(vp.y).toBe(maxY);

    await screenshot(page, 'c4-clamp-max');
  });
});

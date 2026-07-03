import { test, expect } from '@playwright/test';
import {
  gotoRadar,
  screenshot,
  getPixel,
  expectColor,
  findCell,
  getCounts,
  VIS_VISIBLE,
  VIS_FOG,
  VIS_NONE,
} from './radar-helpers.ts';

test.use({ baseURL: 'http://localhost:5173' });

test.describe('RadarWidget — Shroud / Fog / Visibility layers', () => {
  test.beforeEach(async ({ page }) => {
    await gotoRadar(page);
  });

  test('S1: Initial counters show approximately 450 visible, 600 fog and 2000 shroud cells', async ({ page }) => {
    const counts = await getCounts(page);
    const total = counts.visible + counts.fog + counts.shroud;

    expect(total).toBe(64 * 48); // 3072
    expect(counts.visible, 'visible cells should be ~450').toBeGreaterThanOrEqual(400);
    expect(counts.visible).toBeLessThanOrEqual(500);
    expect(counts.fog, 'fog cells should be ~734').toBeGreaterThanOrEqual(650);
    expect(counts.fog).toBeLessThanOrEqual(850);
    expect(counts.shroud, 'shroud cells should be ~1900').toBeGreaterThanOrEqual(1750);
    expect(counts.shroud).toBeLessThanOrEqual(2050);

    await screenshot(page, 's1-initial-shroud-counters');
  });

  test('S2: VIS_VISIBLE cells keep full terrain color', async ({ page }) => {
    const cell = await findCell(page, 'Clear', VIS_VISIBLE);
    const px = cell.cx * 4 + 2;
    const py = cell.cy * 4 + 2;
    const color = await getPixel(page, px, py);
    expectColor(color, [74, 124, 63, 255], 5, 'Visible Clear');
    await screenshot(page, 's2-visible-cell');
  });

  test('S3: VIS_FOG cells are darkened to 50% of terrain color', async ({ page }) => {
    const cell = await findCell(page, 'Clear', VIS_FOG);
    const px = cell.cx * 4 + 2;
    const py = cell.cy * 4 + 2;
    const color = await getPixel(page, px, py);
    // Clear RGB multiplied by 0.5 and floored.
    expectColor(color, [37, 62, 31, 255], 5, 'Fog Clear');
    await screenshot(page, 's3-fog-cell');
  });

  test('S4: VIS_NONE cells are fully black', async ({ page }) => {
    const cell = await findCell(page, 'Clear', VIS_NONE);
    const px = cell.cx * 4 + 2;
    const py = cell.cy * 4 + 2;
    const color = await getPixel(page, px, py);
    expectColor(color, [0, 0, 0, 255], 5, 'Shrouded cell');
    await screenshot(page, 's4-shroud-cell');
  });

  test('S5: The visible region is centred near (20, 15) with a radius ~12', async ({ page }) => {
    // Centre cell should be visible.
    const center = await getPixel(page, 20 * 4 + 2, 15 * 4 + 2);
    expect(center[0]).toBeGreaterThan(20);
    expect(center[1]).toBeGreaterThan(20);
    expect(center[2]).toBeGreaterThan(20);

    // A cell well outside the fog ring (distance > 20) should be black.
    const outside = await getPixel(page, 45 * 4 + 2, 40 * 4 + 2);
    expectColor(outside, [0, 0, 0, 255], 0, 'Outside region');

    await screenshot(page, 's5-visible-region');
  });
});

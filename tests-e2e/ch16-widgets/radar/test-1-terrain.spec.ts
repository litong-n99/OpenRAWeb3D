import { test, expect } from '@playwright/test';
import {
  gotoRadar,
  screenshot,
  getPixel,
  expectColor,
  findCell,
  RADAR_W,
  RADAR_H,
  VIS_VISIBLE,
} from './radar-helpers.ts';

test.use({ baseURL: 'http://localhost:5173' });

test.describe('RadarWidget — Terrain color rendering', () => {
  test.beforeEach(async ({ page }) => {
    await gotoRadar(page);
  });

  test('T1: Page loads with 256x192 canvas and correct status text', async ({ page }) => {
    const canvas = page.locator('#radar-canvas');
    await expect(canvas).toHaveAttribute('width', String(RADAR_W));
    await expect(canvas).toHaveAttribute('height', String(RADAR_H));

    await expect(page.locator('#st-map-size')).toHaveText('64 x 48 cells');
    await expect(page.locator('#st-radar-px')).toHaveText(`${RADAR_W} x ${RADAR_H} px (4x scale)`);

    const legend = page.locator('#legend');
    await expect(legend).toContainText('Clear');
    await expect(legend).toContainText('Water');
    await expect(legend).toContainText('Road');
    await expect(legend).toContainText('Ore');
    await expect(legend).toContainText('黑幕');

    await screenshot(page, 't1-page-load');
  });

  test('T2: Clear terrain renders as green RGB(74, 124, 63)', async ({ page }) => {
    const cell = await findCell(page, 'Clear', VIS_VISIBLE);
    const px = cell.cx * 4 + 2;
    const py = cell.cy * 4 + 2;
    const color = await getPixel(page, px, py);
    expectColor(color, [74, 124, 63, 255], 5, 'Clear');
    await screenshot(page, 't2-terrain-clear');
  });

  test('T3: Rough terrain renders as brown RGB(139, 115, 85)', async ({ page }) => {
    const cell = await findCell(page, 'Rough', VIS_VISIBLE);
    const px = cell.cx * 4 + 2;
    const py = cell.cy * 4 + 2;
    const color = await getPixel(page, px, py);
    expectColor(color, [139, 115, 85, 255], 5, 'Rough');
    await screenshot(page, 't3-terrain-rough');
  });

  test('T4: Water river band renders as blue-gray RGB(74, 109, 140)', async ({ page }) => {
    // Row 24 is inside the water band (rows 22-26). Use cell (20,24) which is
    // within the visible circle (distance 9 from center (20,15), radius 12).
    const color = await getPixel(page, 20 * 4 + 2, 24 * 4 + 2);
    expectColor(color, [74, 109, 140, 255], 5, 'Water');
    await screenshot(page, 't4-terrain-water');
  });

  test('T5: Road paths render as tan RGB(160, 136, 74)', async ({ page }) => {
    // Horizontal road at row 10, plus vertical road at column 15.
    // Use cell (30, 38) for horizontal road (outside viewport overlay).
    // Use tolerance 15 due to possible viewport fill overlay blending.
    const hColor = await getPixel(page, 20 * 4 + 2, 10 * 4 + 2);
    const vColor = await getPixel(page, 15 * 4 + 2, 20 * 4 + 2);
    expectColor(hColor, [160, 136, 74, 255], 15, 'Road horizontal');
    expectColor(vColor, [160, 136, 74, 255], 15, 'Road vertical');
    await screenshot(page, 't5-terrain-road');
  });

  test('T6: Ore patches render as dark gray RGB(85, 85, 85)', async ({ page }) => {
    const color = await getPixel(page, 30 * 4 + 2, 11 * 4 + 2);
    expectColor(color, [85, 85, 85, 255], 5, 'Ore');
    await screenshot(page, 't6-terrain-ore');
  });

  test('T7: Cliff line renders as dark brown RGB(100, 60, 40)', async ({ page }) => {
    const color = await getPixel(page, 20 * 4 + 2, 20 * 4 + 2);
    expectColor(color, [100, 60, 40, 255], 5, 'Cliff');
    await screenshot(page, 't7-terrain-cliff');
  });

  test('T8: Beach strips adjacent to water render as sand RGB(180, 170, 140)', async ({ page }) => {
    // Rows 21 and 27 border the water band; pick a visible cell.
    const cell21 = await findCell(page, 'Beach', VIS_VISIBLE);
    const px = cell21.cx * 4 + 2;
    const py = cell21.cy * 4 + 2;
    const color = await getPixel(page, px, py);
    expectColor(color, [180, 170, 140, 255], 5, 'Beach');
    await screenshot(page, 't8-terrain-beach');
  });
});

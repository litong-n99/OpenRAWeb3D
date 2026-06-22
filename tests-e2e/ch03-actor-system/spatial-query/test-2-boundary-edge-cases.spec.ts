import { test, expect, type Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';

const PAGE_URL = 'http://localhost:5173/test/ch03-actor-system/spatial-query/';
const SNAPSHOT_DIR = 'test-results/manual/ch03-actor-system/spatial-query';
const EVIDENCE_DIR = path.resolve(SNAPSHOT_DIR, 'evidence');

function evidenceFile(name: string): string {
  const dir = path.resolve(EVIDENCE_DIR);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
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
  await page.waitForFunction(
    () => {
      const engineEl = document.getElementById('info-engine');
      return engineEl?.textContent?.includes('Babylon.js') ?? false;
    },
    { timeout }
  );
}

async function waitForTestApi(page: Page, timeout = 10000): Promise<void> {
  await page.waitForFunction(() => !!(window as any).__screenMapTest, { timeout });
}

async function getSelectedCount(page: Page): Promise<number> {
  const text = await page.locator('#stat-selected').textContent();
  return parseInt(text || '0', 10);
}

interface UnitInfo {
  id: number;
  name: string;
  x: number;
  z: number;
  halfWidth: number;
  halfHeight: number;
  selected: boolean;
  hovered: boolean;
}

interface ScreenPoint {
  x: number;
  y: number;
}

interface CameraState {
  alpha: number;
  beta: number;
  radius: number;
  target: { x: number; y: number; z: number };
}

interface ScreenMapTestApi {
  getUnits(): UnitInfo[];
  getSelectedCount(): number;
  getHoveredUnit(): { id: number; name: string; x: number; z: number } | null;
  screenToWorld(sx: number, sy: number): { x: number; z: number } | null;
  worldToScreen(x: number, z: number): ScreenPoint | null;
  setUnitPosition(id: number, x: number, z: number): boolean;
  randomize(): void;
  toggleBounds(): void;
  toggleMouseBounds(): void;
  toggleGrid(): void;
  setHoverEnabled(enabled: boolean): void;
  setBinSize(val: number): void;
  getGridInfo(): { binSize: number; cols: number; rows: number };
  getBoundsLineCount(): number;
  getBoundsColors(): { r: number; g: number; b: number }[];
  queryRect(x1: number, z1: number, x2: number, z2: number): string[];
  queryPoint(x: number, z: number): string[];
  getCameraState(): CameraState;
}

declare global {
  interface Window {
    __screenMapTest: ScreenMapTestApi;
  }
}

async function getUnits(page: Page): Promise<UnitInfo[]> {
  return page.evaluate(() => window.__screenMapTest.getUnits());
}

async function worldToScreen(page: Page, x: number, z: number): Promise<ScreenPoint> {
  const p = await page.evaluate(
    ({ x, z }) => window.__screenMapTest.worldToScreen(x, z),
    { x, z }
  );
  if (!p) throw new Error(`worldToScreen failed for (${x}, ${z})`);
  return p;
}

async function clickWorld(page: Page, x: number, z: number): Promise<void> {
  const p = await worldToScreen(page, x, z);
  await page.mouse.click(p.x, p.y);
  await page.waitForTimeout(100);
}

async function dragWorld(
  page: Page,
  x1: number,
  z1: number,
  x2: number,
  z2: number
): Promise<void> {
  const start = await worldToScreen(page, x1, z1);
  const end = await worldToScreen(page, x2, z2);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(100);
}

async function findEmptyWorldRect(
  page: Page
): Promise<{ x1: number; z1: number; x2: number; z2: number } | null> {
  return page.evaluate(() => {
    const api = window.__screenMapTest;
    const range = 13;
    for (let x = range; x >= -range; x -= 2) {
      for (let z = range; z >= -range; z -= 2) {
        if (api.queryPoint(x, z).length === 0) {
          return { x1: x - 1.5, z1: z - 1.5, x2: x + 1.5, z2: z + 1.5 };
        }
      }
    }
    return null;
  });
}

async function expectNoGpuError(page: Page): Promise<void> {
  const gpuError = page.locator('#gpu-error');
  await expect(gpuError).toHaveCSS('display', 'none');
}

async function waitForNumericFps(page: Page, timeout = 5000): Promise<void> {
  await page.waitForFunction(
    () => {
      const text = document.getElementById('info-fps')?.textContent || '0';
      return /^\d+$/.test(text.trim());
    },
    { timeout }
  );
}

test.use({ snapshotDir: SNAPSHOT_DIR });

test.describe('Ch03 Actor System - Spatial Query (Boundary & Edge Cases)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(PAGE_URL);
    await waitForEngineReady(page);
    await waitForTestApi(page);
    await expectNoGpuError(page);
    await page.waitForTimeout(500);
  });

  test('B1: Full scene selection', async ({ page }) => {
    // Drag a world rectangle that comfortably contains every possible unit position.
    await dragWorld(page, -13, -13, 13, 13);
    await page.waitForTimeout(200);

    const selectedCount = await getSelectedCount(page);
    expect(selectedCount, 'dragging corner-to-corner should select all 20 units').toBe(20);

    test.info().annotations.push({
      type: 'visual-check',
      description: 'Canvas screenshot should show all 20 units highlighted in cyan.',
    });
    await page.screenshot({ path: evidenceFile('b1-full-scene-selection.png') });
  });

  test('B2: Selection outside scene', async ({ page }) => {
    // A rectangle fully outside the 30x30 world should return no units via the API.
    const outsideResult = await page.evaluate(() => {
      return window.__screenMapTest.queryRect(-20, -20, -19, -19);
    });
    expect(outsideResult.length, 'rect fully outside world should return 0 units').toBe(0);

    // Also perform an actual empty-area drag inside the world bounds.
    const rect = await findEmptyWorldRect(page);
    expect(rect, 'should find an empty world rectangle').not.toBeNull();
    if (!rect) return;

    await dragWorld(page, rect.x1, rect.z1, rect.x2, rect.z2);
    await page.waitForTimeout(200);

    expect(await getSelectedCount(page), 'dragging over empty area should select 0 units').toBe(0);

    test.info().annotations.push({
      type: 'visual-check',
      description: 'Canvas screenshot should show no cyan highlights in the empty selection area.',
    });
    await page.screenshot({ path: evidenceFile('b2-selection-outside-scene.png') });
  });

  test('B3: Rapid randomize + select 5 times', async ({ page }) => {
    for (let i = 0; i < 5; i++) {
      await page.evaluate(() => window.__screenMapTest.randomize());
      await page.waitForTimeout(200);

      const units = await getUnits(page);
      expect(units.length, `iteration ${i + 1}: unit count should remain stable`).toBe(20);

      // Use a full-scene drag so the test does not depend on the exact screen position
      // of a single randomly placed unit.
      await dragWorld(page, -13, -13, 13, 13);
      await page.waitForTimeout(200);

      const selected = await getSelectedCount(page);
      expect(
        selected,
        `iteration ${i + 1}: full-scene selection should select all 20 units after randomize, got ${selected}`
      ).toBe(20);
    }

    await expectNoGpuError(page);

    test.info().annotations.push({
      type: 'visual-check',
      description: 'Final screenshot shows a stable scene after 5 rapid randomize/select cycles.',
    });
    await page.screenshot({ path: evidenceFile('b3-rapid-randomize-select.png') });
  });

  test('B4: Extreme camera zoom', async ({ page }) => {
    const canvasBox = await page.locator('#sandbox canvas').boundingBox();
    expect(canvasBox, 'canvas bounding box should exist').not.toBeNull();
    if (!canvasBox) return;

    const centerX = canvasBox.x + canvasBox.width / 2;
    const centerY = canvasBox.y + canvasBox.height / 2;
    await page.mouse.move(centerX, centerY);

    // Zoom in aggressively to reach lower radius limit (camera.lowerRadiusLimit = 5)
    await page.mouse.wheel(0, -5000);
    await page.waitForTimeout(500);

    let state = await page.evaluate(() => window.__screenMapTest.getCameraState());
    expect(
      state.radius,
      `camera should reach near lower radius limit after zoom in (got ${state.radius.toFixed(1)})`
    ).toBeLessThanOrEqual(6);
    await waitForNumericFps(page);
    await expectNoGpuError(page);

    test.info().annotations.push({
      type: 'visual-check',
      description: `Screenshot at closest zoom (radius=${state.radius.toFixed(1)}) should still render units and bounds correctly.`,
    });
    await page.screenshot({ path: evidenceFile('b4-zoom-in.png') });

    // Zoom out aggressively to reach upper radius limit (camera.upperRadiusLimit = 50)
    await page.mouse.move(centerX, centerY);
    await page.mouse.wheel(0, 10000);
    await page.waitForTimeout(500);

    state = await page.evaluate(() => window.__screenMapTest.getCameraState());
    expect(
      state.radius,
      `camera should reach near upper radius limit after zoom out (got ${state.radius.toFixed(1)})`
    ).toBeGreaterThanOrEqual(49);
    await waitForNumericFps(page);
    await expectNoGpuError(page);

    test.info().annotations.push({
      type: 'visual-check',
      description: `Screenshot at farthest zoom (radius=${state.radius.toFixed(1)}) should still render the full scene.`,
    });
    await page.screenshot({ path: evidenceFile('b4-zoom-out.png') });
  });

  test('B5: Overlapping units', async ({ page }) => {
    const units = await getUnits(page);
    expect(units.length, 'should have at least 2 units').toBeGreaterThanOrEqual(2);

    const target = units[0];
    // Force unit 1 to exactly overlap unit 0 position
    const moved = await page.evaluate(
      ({ id, x, z }) => window.__screenMapTest.setUnitPosition(id, x, z),
      { id: 1, x: target.x, z: target.z }
    );
    expect(moved, 'setUnitPosition should succeed').toBe(true);
    await page.waitForTimeout(300);

    // A click on the shared position is treated as a point query (drag distance < 1 world unit).
    // Because the two units occupy the same bounds, both should be selected.
    const hits = await page.evaluate(
      ({ x, z }) => window.__screenMapTest.queryPoint(x, z),
      { x: target.x, z: target.z }
    );
    expect(
      hits.length,
      'overlapping units at same position should both be detected by point query'
    ).toBeGreaterThanOrEqual(2);

    await clickWorld(page, target.x, target.z);
    await page.waitForTimeout(200);

    const selectedCount = await getSelectedCount(page);
    expect(
      selectedCount,
      `click on overlapping units should select all of them (expected >= 2, got ${selectedCount})`
    ).toBeGreaterThanOrEqual(2);

    await expectNoGpuError(page);

    test.info().annotations.push({
      type: 'visual-check',
      description: 'Canvas screenshot shows both overlapping units highlighted in cyan at the same position.',
    });
    await page.screenshot({ path: evidenceFile('b5-overlapping-units.png') });
  });
});

/**
 * test-1.spec.ts — Automated acceptance test for Chapter 11 Building Placement
 *
 * Test page: /test/ch11-production/building-placement/
 * Type: Babylon.js 3D WebGL placement preview
 *
 * Acceptance criteria covered:
 *   E1. Ghost semi-transparent preview
 *   E2. Footprint cells matching BuildingInfo footprint
 *   E3. Valid/invalid placement colors and rules
 *   E4. Grid snap to cell center
 *   E5. Rotation cycling
 *
 * Implementation notes:
 *   - All interactions go through window.__testHarness via page.evaluate().
 *   - The harness moves the cursor programmatically, so mouse coordinates are
 *     not required for core assertions.
 */

import { test, expect, type Page } from '@playwright/test';

const TEST_URL = '/test/ch11-production/building-placement/';

type BuildingType = 'power-plant' | 'barracks' | 'turret';

interface Color3 {
  r: number;
  g: number;
  b: number;
}

interface GhostInfo {
  visible: boolean;
  color: Color3;
  alpha: number;
  valid: boolean;
  cellX: number;
  cellY: number;
}

interface FootprintCell {
  cx: number;
  cy: number;
  type: 'occupied' | 'passable' | 'empty';
  buildable: boolean;
}

interface PlacedBuilding {
  type: string;
  cellX: number;
  cellY: number;
  rotation: number;
}

interface BuildingPlacementHarness {
  selectBuilding(type: BuildingType): void;
  moveCursorToCell(cell: { x: number; y: number }): void;
  canPlace(): boolean;
  getGhostInfo(): GhostInfo | null;
  getFootprintCells(): FootprintCell[];
  getCellColor(cell: { x: number; y: number }): Color3 | null;
  rotateBuilding(): number;
  getRotation(): number;
  getBuildingType(): string;
  getPlacedBuildings(): PlacedBuilding[];
  placeAt(type: BuildingType, cell: { x: number; y: number }, rotation?: number): PlacedBuilding | null;
  getGridSize(): {
    width: number;
    height: number;
    playableXMin: number;
    playableXMax: number;
    playableYMin: number;
    playableYMax: number;
  };
  isObstacle(cx: number, cy: number): boolean;
  reset(): void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function waitForHarness(page: Page, timeout = 20000): Promise<void> {
  await page.waitForSelector('#renderCanvas', { state: 'visible', timeout });
  await page.waitForFunction(
    () => {
      const h = (window as any).__testHarness;
      return (
        !!h &&
        typeof h.selectBuilding === 'function' &&
        typeof h.moveCursorToCell === 'function' &&
        typeof h.canPlace === 'function' &&
        typeof h.getGhostInfo === 'function'
      );
    },
    { timeout }
  );
}

async function selectBuilding(page: Page, type: BuildingType): Promise<void> {
  await page.evaluate((t) => {
    (window as any).__testHarness.selectBuilding(t);
  }, type);
}

async function moveCursorToCell(page: Page, x: number, y: number): Promise<void> {
  await page.evaluate(({ cx, cy }) => {
    (window as any).__testHarness.moveCursorToCell({ x: cx, y: cy });
  }, { cx: x, cy: y });
}

async function canPlace(page: Page): Promise<boolean> {
  return page.evaluate(() => (window as any).__testHarness.canPlace());
}

async function getGhostInfo(page: Page): Promise<GhostInfo | null> {
  return page.evaluate(() => {
    const info = (window as any).__testHarness.getGhostInfo();
    return info ? { ...info } : null;
  });
}

async function getFootprintCells(page: Page): Promise<FootprintCell[]> {
  return page.evaluate(() => (window as any).__testHarness.getFootprintCells());
}

async function getCellColor(page: Page, x: number, y: number): Promise<Color3 | null> {
  return page.evaluate(
    ({ cx, cy }) => (window as any).__testHarness.getCellColor({ x: cx, y: cy }),
    { cx: x, cy: y }
  );
}

async function rotateBuilding(page: Page): Promise<number> {
  return page.evaluate(() => (window as any).__testHarness.rotateBuilding());
}

async function getRotation(page: Page): Promise<number> {
  return page.evaluate(() => (window as any).__testHarness.getRotation());
}

async function placeAt(
  page: Page,
  type: BuildingType,
  x: number,
  y: number,
  rotation?: number
): Promise<PlacedBuilding | null> {
  return page.evaluate(
    ({ t, cx, cy, r }) => (window as any).__testHarness.placeAt(t, { x: cx, y: cy }, r),
    { t: type, cx: x, cy: y, r: rotation }
  );
}

async function getPlacedBuildings(page: Page): Promise<PlacedBuilding[]> {
  return page.evaluate(() => (window as any).__testHarness.getPlacedBuildings());
}

async function reset(page: Page): Promise<void> {
  await page.evaluate(() => (window as any).__testHarness.reset());
}

function colorsClose(actual: Color3, expected: Color3, tolerance = 0.05): boolean {
  return (
    Math.abs(actual.r - expected.r) <= tolerance &&
    Math.abs(actual.g - expected.g) <= tolerance &&
    Math.abs(actual.b - expected.b) <= tolerance
  );
}

function expectColor(actual: Color3, expected: Color3, tolerance = 0.05): void {
  expect(colorsClose(actual, expected, tolerance)).toBe(true);
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

test.describe('Building Placement Acceptance Test (E1-E5)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_URL);
    await waitForHarness(page);
    // Allow WebGL context, shader compilation and first frames to settle.
    await page.waitForTimeout(1000);
  });

  // ================================================================
  // E1. Ghost semi-transparent preview
  // ================================================================

  test('E1 - Ghost semi-transparent preview follows cursor and hides OOB', async ({ page }) => {
    // E1.1 + E1.4: power plant ghost is visible, 50% alpha and covers 2x2 cells.
    await selectBuilding(page, 'power-plant');
    await moveCursorToCell(page, 2, 2);

    const ghost = await getGhostInfo(page);
    expect(ghost, 'ghost should be visible over clear cell').not.toBeNull();
    expect(ghost!.visible).toBe(true);
    expect(ghost!.alpha).toBeCloseTo(0.5, 2);

    const powerCells = await getFootprintCells(page);
    expect(powerCells.length).toBe(4);
    expect(powerCells.every((c) => c.type === 'occupied')).toBe(true);

    // E1.4: turret ghost covers 1x1 cell.
    await selectBuilding(page, 'turret');
    await moveCursorToCell(page, 2, 2);

    const turretGhost = await getGhostInfo(page);
    expect(turretGhost, 'turret ghost should be visible').not.toBeNull();
    const turretCells = await getFootprintCells(page);
    expect(turretCells.length).toBe(1);
    expect(turretCells[0].type).toBe('occupied');

    // E1.3: ghost hidden when cursor moves out-of-bounds.
    await moveCursorToCell(page, 0, 0);
    const oobGhost = await getGhostInfo(page);
    expect(oobGhost).toBeNull();
  });

  // ================================================================
  // E2. Footprint matching
  // ================================================================

  test('E2 - Footprint cells match building definitions', async ({ page }) => {
    // E2.1: power plant 2x2, all occupied.
    await selectBuilding(page, 'power-plant');
    await moveCursorToCell(page, 2, 2);
    const powerCells = await getFootprintCells(page);
    expect(powerCells.length).toBe(4);
    expect(powerCells.filter((c) => c.type === 'occupied').length).toBe(4);

    // E2.2: barracks "xx=x" -> 3 occupied + 1 passable.
    await selectBuilding(page, 'barracks');
    await moveCursorToCell(page, 2, 2);
    const barracksCells = await getFootprintCells(page);
    expect(barracksCells.length).toBe(4);
    expect(barracksCells.filter((c) => c.type === 'occupied').length).toBe(3);
    expect(barracksCells.filter((c) => c.type === 'passable').length).toBe(1);

    // E2.4: passable cell rendered with expected blue-ish color.
    const passableCell = barracksCells.find((c) => c.type === 'passable')!;
    const passableColor = await getCellColor(page, passableCell.cx, passableCell.cy);
    expect(passableColor, 'passable cell should have a color').not.toBeNull();
    expectColor(passableColor!, { r: 0.25, g: 0.25, b: 0.55 });

    // E2.3: turret 1x1, single occupied cell.
    await selectBuilding(page, 'turret');
    await moveCursorToCell(page, 2, 2);
    const turretCells = await getFootprintCells(page);
    expect(turretCells.length).toBe(1);
    expect(turretCells[0].type).toBe('occupied');
  });

  // ================================================================
  // E3. Valid/invalid colors and placement rules
  // ================================================================

  test('E3 - Valid/invalid placement colors and rules', async ({ page }) => {
    // E3.1 + E3.3: clear cell is valid and green.
    await selectBuilding(page, 'power-plant');
    await moveCursorToCell(page, 2, 2);
    expect(await canPlace(page)).toBe(true);

    const validGhost = await getGhostInfo(page);
    expect(validGhost, 'valid ghost should be visible').not.toBeNull();
    expectColor(validGhost!.color, { r: 0.13, g: 0.55, b: 0.13 });

    // E3.2 + E3.4: obstacle cell is invalid and red.
    await moveCursorToCell(page, 4, 4);
    expect(await canPlace(page)).toBe(false);

    const invalidGhost = await getGhostInfo(page);
    expect(invalidGhost, 'invalid ghost should still be visible').not.toBeNull();
    expectColor(invalidGhost!.color, { r: 0.76, g: 0.14, b: 0.14 });

    // E3.5: OOB cell invalid and ghost hidden.
    await moveCursorToCell(page, 0, 0);
    expect(await canPlace(page)).toBe(false);
    expect(await getGhostInfo(page)).toBeNull();

    // E3.6: water cell invalid.
    await moveCursorToCell(page, 8, 3);
    expect(await canPlace(page)).toBe(false);

    // E3.7: placed building blocks the same spot.
    await reset(page);
    await selectBuilding(page, 'power-plant');
    const placed = await placeAt(page, 'power-plant', 2, 2);
    expect(placed, 'placement should succeed on clear cell').not.toBeNull();

    await moveCursorToCell(page, 2, 2);
    expect(await canPlace(page)).toBe(false);

    const blockedGhost = await getGhostInfo(page);
    expect(blockedGhost, 'blocked ghost should be visible in red').not.toBeNull();
    expectColor(blockedGhost!.color, { r: 0.76, g: 0.14, b: 0.14 });
  });

  // ================================================================
  // E4. Grid snap
  // ================================================================

  test('E4 - Grid snap to cell center', async ({ page }) => {
    // E4.2: 1x1 turret at (6,6) snaps exactly to cell center.
    await selectBuilding(page, 'turret');
    await moveCursorToCell(page, 6, 6);

    const ghost = await getGhostInfo(page);
    expect(ghost, 'turret ghost at (6,6) should be visible').not.toBeNull();
    expect(ghost!.cellX).toBe(6);
    expect(ghost!.cellY).toBe(6);

    const snapText = await page.locator('#stat-snap-offset').textContent();
    expect(snapText).toBe('0.0000 wu');

    // Extra: 2x2 building also snaps within the 0.1 wu tolerance.
    await selectBuilding(page, 'power-plant');
    await moveCursorToCell(page, 7, 2);
    const snapText2 = await page.locator('#stat-snap-offset').textContent();
    expect(snapText2).toBe('0.0000 wu');
  });

  // ================================================================
  // E5. Rotation
  // ================================================================

  test('E5 - Rotation cycles through cardinal directions', async ({ page }) => {
    // E5.1: initial rotation is 0.
    expect(await getRotation(page)).toBe(0);

    // E5.2: one rotation -> 90.
    const r1 = await rotateBuilding(page);
    expect(r1).toBe(90);
    expect(await getRotation(page)).toBe(90);

    // E5.3: four rotations cycle back to 0.
    expect(await rotateBuilding(page)).toBe(180);
    expect(await rotateBuilding(page)).toBe(270);
    expect(await rotateBuilding(page)).toBe(0);
    expect(await getRotation(page)).toBe(0);

    // E5.5: placed building records its rotation angle.
    await selectBuilding(page, 'power-plant');
    await rotateBuilding(page); // back to 90
    expect(await getRotation(page)).toBe(90);

    const placed = await placeAt(page, 'power-plant', 5, 2, 90);
    expect(placed).not.toBeNull();
    expect(placed!.rotation).toBe(90);

    const buildings = await getPlacedBuildings(page);
    expect(buildings.length).toBe(1);
    expect(buildings[0].rotation).toBe(90);
  });

  // ================================================================
  // Keyboard shortcuts
  // ================================================================

  test('Keyboard shortcuts: R rotates, 1/2/3 selects building type', async ({ page }) => {
    await page.keyboard.press('r');
    await page.waitForTimeout(150);
    expect(await getRotation(page)).toBe(90);

    await page.keyboard.press('1');
    await page.waitForTimeout(150);
    expect(await page.evaluate(() => (window as any).__testHarness.getBuildingType())).toBe('power-plant');

    await page.keyboard.press('2');
    await page.waitForTimeout(150);
    expect(await page.evaluate(() => (window as any).__testHarness.getBuildingType())).toBe('barracks');

    await page.keyboard.press('3');
    await page.waitForTimeout(150);
    expect(await page.evaluate(() => (window as any).__testHarness.getBuildingType())).toBe('turret');
  });

  // ================================================================
  // Edge cases
  // ================================================================

  test('Edge cases: boundary placement, blocking, and multiple buildings', async ({ page }) => {
    await reset(page);

    // Boundary placement: 2x2 power plant at (1,1) fits entirely inside the playable area.
    await selectBuilding(page, 'power-plant');
    await moveCursorToCell(page, 1, 1);
    expect(await canPlace(page)).toBe(true);

    // Near-edge OOB: a 2x2 power plant at (10,9) would extend to column 11,
    // which is outside the playable area (playable x range is 1..10).
    await moveCursorToCell(page, 10, 9);
    expect(await canPlace(page)).toBe(false);

    // Multiple buildings: place three turrets and verify the list.
    await selectBuilding(page, 'turret');
    expect(await placeAt(page, 'turret', 2, 2)).not.toBeNull();
    expect(await placeAt(page, 'turret', 5, 2)).not.toBeNull();
    expect(await placeAt(page, 'turret', 8, 2)).not.toBeNull();

    const buildings = await getPlacedBuildings(page);
    expect(buildings.length).toBe(3);
    expect(buildings.map((b) => ({ x: b.cellX, y: b.cellY }))).toEqual([
      { x: 2, y: 2 },
      { x: 5, y: 2 },
      { x: 8, y: 2 },
    ]);
  });
});

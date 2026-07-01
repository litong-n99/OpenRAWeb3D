/**
 * test-1.spec.ts — Automated acceptance test for Chapter 11 Rally Point
 *
 * Test page: /test/ch11-production/rally-point/
 * Type: Babylon.js 3D rally point flag + dashed-line visual acceptance test
 *
 * Acceptance criteria covered:
 *   R1. Flag at target cell center
 *   R2. Dashed line from building exit to rally flag
 *   R3. Flag animation (≥15 distinct positions/s)
 *   R4. Multi-rally per-slot numbered flags
 *   R5. Line updates within 1 frame
 *
 * Implementation notes:
 *   - All programmatic state is read through window.__testHarness.
 *   - UI buttons (slot selectors, clear/reset) are exercised via DOM locators.
 *   - Screenshots are intentionally omitted; they are handled separately.
 *   - The page loads with 4 default rally points; reset() clears them but does
 *     not restore defaults, so tests that need defaults rely on the fresh page.
 */

import { test, expect, type Page } from '@playwright/test';

const TEST_URL = '/test/ch11-production/rally-point/';

interface Cell {
  x: number;
  y: number;
}

interface Vector3 {
  x: number;
  y: number;
  z: number;
}

interface RallyPosition {
  buildingId: string;
  slot: number;
  cellX: number;
  cellY: number;
}

interface RallyFlag {
  buildingId: string;
  slot: number;
  position: Vector3;
  lastUpdateFrame: number;
}

interface RallyLine {
  buildingId: string;
  slot: number;
  from: Vector3;
  to: Vector3;
  dashCount: number;
}

interface RallyPointHarness {
  setRallyPoint(building: string, slot: number, cell: Cell): void;
  getRallyPositions(): RallyPosition[];
  getRallyFlags(): RallyFlag[];
  getRallyLines(): RallyLine[];
  getFlagCount(): number;
  getFrameNumber(): number;
  getAnimTime(): number;
  getFps(): number;
  clearRallyPoint(building: string): void;
  clearAll(): void;
  reset(): void;
  selectBuilding(building: string): void;
  selectSlot(slot: number): void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function waitForHarness(page: Page, timeout = 20000): Promise<void> {
  await page.waitForSelector('#renderCanvas', { state: 'visible', timeout });
  await page.waitForFunction(
    () => {
      const h = (window as any).__testHarness as Partial<RallyPointHarness>;
      return (
        !!h &&
        typeof h.setRallyPoint === 'function' &&
        typeof h.getRallyFlags === 'function' &&
        typeof h.getRallyLines === 'function' &&
        typeof h.getFrameNumber === 'function' &&
        typeof h.getAnimTime === 'function'
      );
    },
    { timeout }
  );
}

async function resetScene(page: Page): Promise<void> {
  await page.evaluate(() => (window as any).__testHarness.reset());
}

async function setRallyPoint(
  page: Page,
  building: string,
  slot: number,
  cell: Cell
): Promise<void> {
  await page.evaluate(({ b, s, c }) => {
    (window as any).__testHarness.setRallyPoint(b, s, c);
  }, { b: building, s: slot, c: cell });
}

async function getRallyPositions(page: Page): Promise<RallyPosition[]> {
  return page.evaluate(() => (window as any).__testHarness.getRallyPositions());
}

async function getRallyFlags(page: Page): Promise<RallyFlag[]> {
  return page.evaluate(() => (window as any).__testHarness.getRallyFlags());
}

async function getRallyLines(page: Page): Promise<RallyLine[]> {
  return page.evaluate(() => (window as any).__testHarness.getRallyLines());
}

async function getFlagCount(page: Page): Promise<number> {
  return page.evaluate(() => (window as any).__testHarness.getFlagCount());
}

async function getFrameNumber(page: Page): Promise<number> {
  return page.evaluate(() => (window as any).__testHarness.getFrameNumber());
}

async function getAnimTime(page: Page): Promise<number> {
  return page.evaluate(() => (window as any).__testHarness.getAnimTime());
}

async function getFps(page: Page): Promise<number> {
  return page.evaluate(() => (window as any).__testHarness.getFps());
}

async function clearRallyPoint(page: Page, building: string): Promise<void> {
  await page.evaluate((b) => (window as any).__testHarness.clearRallyPoint(b), building);
}

async function clearAll(page: Page): Promise<void> {
  await page.evaluate(() => (window as any).__testHarness.clearAll());
}

async function selectBuilding(page: Page, building: string): Promise<void> {
  await page.evaluate((b) => (window as any).__testHarness.selectBuilding(b), building);
}

async function selectSlot(page: Page, slot: number): Promise<void> {
  await page.evaluate((s) => (window as any).__testHarness.selectSlot(s), slot);
}

function expectPositionClose(actual: Vector3, expected: Vector3, tolerance = 0.1): void {
  expect(Math.abs(actual.x - expected.x)).toBeLessThanOrEqual(tolerance);
  expect(Math.abs(actual.y - expected.y)).toBeLessThanOrEqual(tolerance);
  expect(Math.abs(actual.z - expected.z)).toBeLessThanOrEqual(tolerance);
}

function findFlag(flags: RallyFlag[], buildingId: string, slot: number): RallyFlag | undefined {
  return flags.find((f) => f.buildingId === buildingId && f.slot === slot);
}

function findLine(lines: RallyLine[], buildingId: string, slot: number): RallyLine | undefined {
  return lines.find((l) => l.buildingId === buildingId && l.slot === slot);
}

async function clickSlotButton(page: Page, slot: number): Promise<void> {
  await page.locator(`#slot-${slot}`).click();
  await page.waitForTimeout(100);
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

test.describe('Rally Point Acceptance Test (R1-R5)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(TEST_URL);
    await waitForHarness(page);
    // Give WebGL/Babylon one extra second to settle before interacting.
    await page.waitForTimeout(1000);
  });

  // ================================================================
  // R1. Flag at Target Cell Center
  // ================================================================

  test('R1 - Flag appears at target cell center and moves within 1 tick', async ({ page }) => {
    // The page loads with 4 default rally points.

    // R1.1: Default Barracks slot 1 flag is at cell (5, 1) center.
    const flags = await getRallyFlags(page);
    expect(flags).toHaveLength(4);
    const defaultFlag = findFlag(flags, 'barracks', 1);
    expect(defaultFlag, 'default Barracks slot 1 flag should exist').toBeDefined();
    expectPositionClose(defaultFlag!.position, { x: 5.5, y: 0.35, z: 1.5 }, 0.1);

    // R1.2: Setting a new rally point moves the flag to the new cell center within one tick.
    await setRallyPoint(page, 'barracks', 1, { x: 8, y: 8 });
    const movedFlags = await getRallyFlags(page);
    const movedFlag = findFlag(movedFlags, 'barracks', 1);
    expect(movedFlag, 'moved flag should exist').toBeDefined();
    expectPositionClose(movedFlag!.position, { x: 8.5, y: 0.35, z: 8.5 }, 0.1);

    // R1.3: Multi-rally default state has 4 flags (Barracks×2, War Factory×1, Naval Yard×1).
    const allFlags = await getRallyFlags(page);
    expect(allFlags).toHaveLength(4);
    expect(findFlag(allFlags, 'barracks', 1)).toBeDefined();
    expect(findFlag(allFlags, 'barracks', 2)).toBeDefined();
    expect(findFlag(allFlags, 'warfactory', 1)).toBeDefined();
    expect(findFlag(allFlags, 'navalyard', 1)).toBeDefined();
  });

  // ================================================================
  // R2. Dashed Line from Building Exit to Rally Flag
  // ================================================================

  test('R2 - Dashed line connects building exit to rally flag', async ({ page }) => {
    // R2.1: getRallyLines() returns from/to endpoints for every default rally point.
    const lines = await getRallyLines(page);
    expect(lines.length).toBe(4);
    for (const line of lines) {
      expect(line.from).toBeDefined();
      expect(line.to).toBeDefined();
      // `to` should match the flag base position for that slot.
      const flag = findFlag(await getRallyFlags(page), line.buildingId, line.slot);
      expect(flag, `flag should exist for ${line.buildingId}:${line.slot}`).toBeDefined();
      expectPositionClose(line.to, flag!.position, 0.05);
    }

    // R2.2: Line updates within 1 frame of rally point change.
    const updateResult = await page.evaluate(() => {
      const h = (window as any).__testHarness;
      const frameBefore = h.getFrameNumber();
      h.setRallyPoint('warfactory', 1, { x: 1, y: 1 });
      const line = h.getRallyLines().find(
        (l: RallyLine) => l.buildingId === 'warfactory' && l.slot === 1
      );
      return {
        frameBefore,
        lastUpdateFrame: h.getRallyFlags().find(
          (f: RallyFlag) => f.buildingId === 'warfactory' && f.slot === 1
        )?.lastUpdateFrame,
        frameAfter: h.getFrameNumber(),
        lineTo: line?.to,
      };
    });
    expect(updateResult.lastUpdateFrame).toBe(updateResult.frameAfter);
    expect(updateResult.lastUpdateFrame).toBeGreaterThanOrEqual(updateResult.frameBefore);
    expectPositionClose(updateResult.lineTo!, { x: 1.5, y: 0.35, z: 1.5 }, 0.05);

    // R2.3: Dashed line is visible with dash segments (dashCount > 0).
    const lineDetails = await getRallyLines(page);
    expect(lineDetails.every((l) => l.dashCount > 0)).toBe(true);
  });

  // ================================================================
  // R3. Flag Animation
  // ================================================================

  test('R3 - Flag animation runs continuously while flags are visible', async ({ page }) => {
    const fps = await getFps(page);
    expect(fps).toBeGreaterThan(0);

    // R3.1: Animation time advances over time, indicating the bob/wave is running.
    const animTimeStart = await getAnimTime(page);
    await page.waitForTimeout(1000);
    const animTimeEnd = await getAnimTime(page);
    expect(animTimeEnd).toBeGreaterThan(animTimeStart);

    // At the default speed factor (1.5) and ANIM_BASE_SPEED (6 rad/s), the phase
    // advances at 9 rad/s — more than enough for ≥15 distinct positions/s when
    // the engine is rendering at the measured FPS.
    expect(fps).toBeGreaterThanOrEqual(15);

    // R3.2: Animation continues while flags are visible.
    // Sample actual flag mesh Y positions through the exposed scene using rAF
    // so the render loop can advance between samples.
    const positions = await page.evaluate(() => {
      const h = (window as any).__testHarness;
      return new Promise<number[]>((resolve) => {
        const samples: number[] = [];
        let count = 0;
        const maxSamples = 45;
        const collect = () => {
          const mesh = h.scene.getMeshByName('flag_s1');
          if (mesh) {
            samples.push(mesh.absolutePosition.y);
          }
          count++;
          if (count < maxSamples) {
            requestAnimationFrame(collect);
          } else {
            resolve(samples);
          }
        };
        collect();
      });
    });
    expect(positions.length).toBeGreaterThanOrEqual(15);
    const uniquePositions = new Set(positions.map((p) => p.toFixed(4)));
    expect(uniquePositions.size).toBeGreaterThanOrEqual(15);
  });

  // ================================================================
  // R4. Multi-Rally Per-Slot Numbered Flags
  // ================================================================

  test('R4 - Per-slot numbered flags are independent and UI controls work', async ({ page }) => {
    await resetScene(page);
    await clearAll(page);
    expect(await getFlagCount(page)).toBe(0);

    // R4.1: Each slot has an independent rally point for the same building.
    await setRallyPoint(page, 'barracks', 1, { x: 1, y: 1 });
    await setRallyPoint(page, 'barracks', 2, { x: 3, y: 1 });
    await setRallyPoint(page, 'barracks', 3, { x: 5, y: 1 });

    const flags = await getRallyFlags(page);
    expect(flags).toHaveLength(3);
    expect(findFlag(flags, 'barracks', 1)).toBeDefined();
    expect(findFlag(flags, 'barracks', 2)).toBeDefined();
    expect(findFlag(flags, 'barracks', 3)).toBeDefined();

    // R4.2: Different slots have different positions.
    const pos1 = findFlag(flags, 'barracks', 1)!.position;
    const pos2 = findFlag(flags, 'barracks', 2)!.position;
    const pos3 = findFlag(flags, 'barracks', 3)!.position;
    expect(pos1.x).not.toBe(pos2.x);
    expect(pos2.x).not.toBe(pos3.x);

    // UI slot buttons: clicking Slot 2 updates the active slot UI state.
    await clickSlotButton(page, 2);
    const slot2Active = await page.locator('#slot-2').evaluate((el) =>
      el.classList.contains('active-slot')
    );
    const slot1Active = await page.locator('#slot-1').evaluate((el) =>
      el.classList.contains('active-slot')
    );
    expect(slot2Active).toBe(true);
    expect(slot1Active).toBe(false);

    // R4.3 / UI: Clear Building button removes flags for the selected building.
    await selectBuilding(page, 'barracks');
    await page.locator('#btn-clear-building').click();
    await page.waitForTimeout(150);
    expect(await getFlagCount(page)).toBe(0);

    // UI: Clear All button removes all flags.
    await setRallyPoint(page, 'warfactory', 1, { x: 7, y: 7 });
    await setRallyPoint(page, 'navalyard', 1, { x: 2, y: 8 });
    expect(await getFlagCount(page)).toBe(2);
    await page.locator('#btn-clear-all').click();
    await page.waitForTimeout(150);
    expect(await getFlagCount(page)).toBe(0);

    // UI: Reset button clears all flags and resets the active building/slot UI.
    await setRallyPoint(page, 'barracks', 2, { x: 4, y: 4 });
    await setRallyPoint(page, 'warfactory', 1, { x: 6, y: 6 });
    await selectBuilding(page, 'warfactory');
    await selectSlot(page, 3);
    expect(await getFlagCount(page)).toBe(2);

    await page.locator('#btn-reset').click();
    await page.waitForTimeout(150);
    expect(await getFlagCount(page)).toBe(0);

    const resetBuilding = await page.locator('#building-select').inputValue();
    const slot1ResetActive = await page.locator('#slot-1').evaluate((el) =>
      el.classList.contains('active-slot')
    );
    expect(resetBuilding).toBe('barracks');
    expect(slot1ResetActive).toBe(true);

    // R4.3 / Harness: clearRallyPoint(building) removes flags for that building only.
    await setRallyPoint(page, 'barracks', 1, { x: 1, y: 1 });
    await setRallyPoint(page, 'barracks', 2, { x: 2, y: 2 });
    await setRallyPoint(page, 'warfactory', 1, { x: 7, y: 7 });
    await setRallyPoint(page, 'navalyard', 1, { x: 2, y: 8 });
    expect(await getFlagCount(page)).toBe(4);

    await clearRallyPoint(page, 'barracks');
    const afterClear = await getRallyFlags(page);
    expect(afterClear).toHaveLength(2);
    expect(findFlag(afterClear, 'barracks', 1)).toBeUndefined();
    expect(findFlag(afterClear, 'barracks', 2)).toBeUndefined();
    expect(findFlag(afterClear, 'warfactory', 1)).toBeDefined();
    expect(findFlag(afterClear, 'navalyard', 1)).toBeDefined();
  });

  // ================================================================
  // R5. Line Updates Within 1 Frame
  // ================================================================

  test('R5 - Rally point changes update line within 1 frame', async ({ page }) => {
    await resetScene(page);
    await clearAll(page);

    // R5.1: Moving a rally point updates the line in the same frame (frameDelta = 0).
    await setRallyPoint(page, 'warfactory', 1, { x: 4, y: 4 });
    const frameDeltaResult = await page.evaluate(() => {
      const h = (window as any).__testHarness;
      const frameBefore = h.getFrameNumber();
      h.setRallyPoint('warfactory', 1, { x: 6, y: 6 });
      const flag = h.getRallyFlags().find(
        (f: RallyFlag) => f.buildingId === 'warfactory' && f.slot === 1
      );
      const line = h.getRallyLines().find(
        (l: RallyLine) => l.buildingId === 'warfactory' && l.slot === 1
      );
      return {
        frameBefore,
        lastUpdateFrame: flag?.lastUpdateFrame,
        frameAfter: h.getFrameNumber(),
        lineTo: line?.to,
        flagPosition: flag?.position,
      };
    });
    expect(frameDeltaResult.lastUpdateFrame).toBe(frameDeltaResult.frameAfter);
    expect(frameDeltaResult.lastUpdateFrame! - frameDeltaResult.frameBefore).toBeLessThanOrEqual(1);
    expectPositionClose(frameDeltaResult.flagPosition!, { x: 6.5, y: 0.35, z: 6.5 }, 0.05);
    expectPositionClose(frameDeltaResult.lineTo!, { x: 6.5, y: 0.35, z: 6.5 }, 0.05);

    // R5.2: 5 rapid consecutive moves all produce proper positions and lines.
    const rapidResult = await page.evaluate(() => {
      const h = (window as any).__testHarness;
      const moves = [
        { x: 1, y: 1 },
        { x: 2, y: 2 },
        { x: 3, y: 3 },
        { x: 4, y: 4 },
        { x: 5, y: 5 },
      ];
      const results: { position: Vector3; lineTo: Vector3 | undefined; dashCount: number }[] = [];
      for (const cell of moves) {
        h.setRallyPoint('barracks', 1, cell);
        const flag = h.getRallyFlags().find(
          (f: RallyFlag) => f.buildingId === 'barracks' && f.slot === 1
        );
        const line = h.getRallyLines().find(
          (l: RallyLine) => l.buildingId === 'barracks' && l.slot === 1
        );
        results.push({
          position: flag!.position,
          lineTo: line?.to,
          dashCount: line?.dashCount ?? 0,
        });
      }
      return results;
    });

    expect(rapidResult).toHaveLength(5);
    for (let i = 0; i < rapidResult.length; i++) {
      const expectedCell = { x: i + 1, y: i + 1 };
      const expectedPos = { x: expectedCell.x + 0.5, y: 0.35, z: expectedCell.y + 0.5 };
      expectPositionClose(rapidResult[i].position, expectedPos, 0.05);
      expect(rapidResult[i].lineTo).toBeDefined();
      expectPositionClose(rapidResult[i].lineTo!, expectedPos, 0.05);
      expect(rapidResult[i].dashCount).toBeGreaterThan(0);
    }
  });
});

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

interface GridInfo {
  binSize: number;
  cols: number;
  rows: number;
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
  getGridInfo(): GridInfo;
  getBoundsLineCount(): number;
  getBoundsColors(): { r: number; g: number; b: number }[];
  queryRect(x1: number, z1: number, x2: number, z2: number): string[];
  queryPoint(x: number, z: number): string[];
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

async function findBlankScreenPoint(
  page: Page,
  padding = 50
): Promise<{ x: number; y: number }> {
  const candidate = await page.evaluate((padding) => {
    const canvas = document.querySelector('#sandbox canvas') as HTMLCanvasElement | null;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const api = window.__screenMapTest;
    const candidates = [
      { x: rect.left + padding, y: rect.top + padding },
      { x: rect.right - padding, y: rect.top + padding },
      { x: rect.left + padding, y: rect.bottom - padding },
      { x: rect.right - padding, y: rect.bottom - padding },
      {
        x: rect.left + Math.floor(rect.width * 0.15),
        y: rect.top + Math.floor(rect.height * 0.15),
      },
      {
        x: rect.left + Math.floor(rect.width * 0.85),
        y: rect.top + Math.floor(rect.height * 0.85),
      },
    ];
    for (const c of candidates) {
      const w = api.screenToWorld(c.x, c.y);
      if (!w) continue;
      const hits = api.queryPoint(w.x, w.z);
      if (hits.length === 0) return c;
    }
    return null;
  }, padding);

  if (!candidate) throw new Error('Could not find a blank screen point');
  return candidate;
}

async function findRectWithUnitCount(
  page: Page,
  min: number,
  max: number
): Promise<{
  x1: number;
  z1: number;
  x2: number;
  z2: number;
  expectedCount: number;
  expectedNames: string[];
} | null> {
  return page.evaluate(
    ({ min, max }) => {
      const api = window.__screenMapTest;
      const units = api.getUnits();
      const sizes = [4, 6, 8, 10, 12, 14, 16, 18, 20];
      for (const u of units) {
        for (const size of sizes) {
          const half = size / 2;
          const x1 = u.x - half;
          const z1 = u.z - half;
          const x2 = u.x + half;
          const z2 = u.z + half;
          const hits = api.queryRect(x1, z1, x2, z2);
          if (hits.length >= min && hits.length <= max) {
            return {
              x1,
              z1,
              x2,
              z2,
              expectedCount: hits.length,
              expectedNames: hits,
            };
          }
        }
      }
      return null;
    },
    { min, max }
  );
}

function deltaE(
  a: { r: number; g: number; b: number },
  b: { r: number; g: number; b: number }
): number {
  return Math.sqrt(
    Math.pow(a.r - b.r, 2) + Math.pow(a.g - b.g, 2) + Math.pow(a.b - b.b, 2)
  );
}

async function expectNoGpuError(page: Page): Promise<void> {
  const gpuError = page.locator('#gpu-error');
  await expect(gpuError).toHaveCSS('display', 'none');
}

test.use({ snapshotDir: SNAPSHOT_DIR });

test.describe('Ch03 Actor System - Spatial Query (Core Expectations)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(PAGE_URL);
    await waitForEngineReady(page);
    await waitForTestApi(page);
    await expectNoGpuError(page);
    await page.waitForTimeout(500);
  });

  test('E1: Exact Click (ActorsAtMouse)', async ({ page }) => {
    const units = await getUnits(page);
    expect(units.length, 'scene should contain 20 units').toBe(20);

    // Prefer a unit that is not overlapping another unit so the expectation of
    // "exactly one selected" is unambiguous.
    const isolatedName = await page.evaluate(() => {
      const api = window.__screenMapTest;
      const all = api.getUnits();
      for (const u of all) {
        let ok = true;
        for (const v of all) {
          if (v.name === u.name) continue;
          const dx = u.x - v.x;
          const dz = u.z - v.z;
          if (Math.sqrt(dx * dx + dz * dz) < 1.5) {
            ok = false;
            break;
          }
        }
        if (ok) return u.name;
      }
      return null;
    });

    if (!isolatedName) {
      await page.evaluate(() => window.__screenMapTest.setUnitPosition(0, 10, 10));
      await page.waitForTimeout(200);
    }
    const targetName = isolatedName || 'unit_0';

    const freshUnits = await getUnits(page);
    const target = freshUnits.find((u) => u.name === targetName)!;
    expect(target, `target unit ${targetName} should exist`).toBeDefined();

    await clickWorld(page, target.x, target.z);

    const selectedCount = await getSelectedCount(page);
    expect(selectedCount, 'exact click should select exactly one unit').toBe(1);

    const afterUnits = await getUnits(page);
    const afterTarget = afterUnits.find((u) => u.name === targetName)!;
    expect(afterTarget.selected, `${targetName} should be selected after click`).toBe(true);

    test.info().annotations.push({
      type: 'visual-check',
      description:
        'Canvas screenshot shows the clicked unit highlighted in pure cyan (emissiveColor 0,1,1) with its number texture removed.',
    });
    await page.screenshot({ path: evidenceFile('e1-exact-click-selected.png') });

    const blank = await findBlankScreenPoint(page);
    await page.mouse.click(blank.x, blank.y);
    await page.waitForTimeout(200);

    expect(await getSelectedCount(page), 'clicking a blank area should clear selection').toBe(0);
    await page.screenshot({ path: evidenceFile('e1-exact-click-blank.png') });
  });

  test('E2: Rectangle Selection (ActorsInMouseBox)', async ({ page }) => {
    const rect = await findRectWithUnitCount(page, 3, 5);
    expect(rect, 'should find a world rectangle covering 3-5 units').not.toBeNull();
    if (!rect) return;

    await dragWorld(page, rect.x1, rect.z1, rect.x2, rect.z2);
    await page.waitForTimeout(200);

    const selectedCount = await getSelectedCount(page);
    expect(
      selectedCount,
      `rect query should select exactly ${rect.expectedCount} units (got ${selectedCount})`
    ).toBe(rect.expectedCount);

    const overlay = await page.locator('#overlay').textContent();
    expect(overlay).toContain(`Selected: ${rect.expectedCount}`);

    const selectedNames = await page.evaluate(() =>
      window.__screenMapTest.getUnits().filter((u) => u.selected).map((u) => u.name)
    );
    for (const name of rect.expectedNames) {
      expect(selectedNames, `unit ${name} should be selected`).toContain(name);
    }

    test.info().annotations.push({
      type: 'visual-check',
      description:
        'Canvas screenshot shows the expected units highlighted in cyan; units outside the dragged box should remain unhighlighted.',
    });
    await page.screenshot({ path: evidenceFile('e2-rectangle-selection.png') });
  });

  test('E3: ScreenBounds Visualization', async ({ page }) => {
    // Show Bounds is enabled by default.
    const lineCount = await page.evaluate(() => window.__screenMapTest.getBoundsLineCount());
    expect(lineCount, 'default ScreenBounds lines should equal unit count').toBe(20);

    const colors = await page.evaluate(() => window.__screenMapTest.getBoundsColors());
    const expectedGreen = { r: 76, g: 179, b: 76 };
    for (const c of colors) {
      expect(
        deltaE(c, expectedGreen),
        `ScreenBounds color ${JSON.stringify(c)} should be close to green ${JSON.stringify(expectedGreen)}`
      ).toBeLessThanOrEqual(15);
    }

    test.info().annotations.push({
      type: 'visual-check',
      description:
        'Canvas screenshot shows a green wireframe (R=76,G=179,B=76) precisely wrapping each unit.',
    });
    await page.screenshot({ path: evidenceFile('e3-screen-bounds-default.png') });

    await page.evaluate(() => window.__screenMapTest.randomize());
    await page.waitForTimeout(300);

    const lineCountAfter = await page.evaluate(() => window.__screenMapTest.getBoundsLineCount());
    expect(lineCountAfter, 'ScreenBounds lines should still equal unit count after randomize').toBe(
      20
    );

    test.info().annotations.push({
      type: 'visual-check',
      description:
        'After randomizing, green wireframes should have moved to the new unit positions with no offset.',
    });
    await page.screenshot({ path: evidenceFile('e3-screen-bounds-after-randomize.png') });
  });

  test('E4: MouseBounds Visualization', async ({ page }) => {
    // Enable mouse bounds while keeping screen bounds on.
    await page.evaluate(() => window.__screenMapTest.toggleMouseBounds());
    await page.waitForTimeout(200);

    const lineCount = await page.evaluate(() => window.__screenMapTest.getBoundsLineCount());
    expect(lineCount, 'ScreenBounds + MouseBounds should produce 40 wireframe lines').toBe(40);

    const colors = await page.evaluate(() => window.__screenMapTest.getBoundsColors());
    const hasGreen = colors.some((c) => deltaE(c, { r: 76, g: 179, b: 76 }) <= 15);
    const hasOrange = colors.some((c) => deltaE(c, { r: 229, g: 153, b: 51 }) <= 15);
    expect(hasGreen, 'should contain green ScreenBounds lines').toBe(true);
    expect(hasOrange, 'should contain orange MouseBounds lines').toBe(true);

    test.info().annotations.push({
      type: 'visual-check',
      description:
        'Canvas screenshot shows both green ScreenBounds and orange MouseBounds (R=229,G=153,B=51) at the same unit positions, clearly distinguishable.',
    });
    await page.screenshot({ path: evidenceFile('e4-mouse-bounds.png') });
  });

  test('E5: Bin Grid Granularity', async ({ page }) => {
    await page.evaluate(() => window.__screenMapTest.toggleGrid());
    await page.waitForTimeout(200);

    const cases: { val: number; cols: number; rows: number }[] = [
      { val: 5, cols: 6, rows: 6 },
      { val: 10, cols: 3, rows: 3 },
      { val: 15, cols: 2, rows: 2 },
    ];

    for (const { val, cols, rows } of cases) {
      const result = await page.evaluate((val) => {
        const t0 = performance.now();
        window.__screenMapTest.setBinSize(val);
        const info = window.__screenMapTest.getGridInfo();
        const t1 = performance.now();
        return { elapsed: t1 - t0, info };
      }, val);

      expect(result.elapsed, `binSize=${val} grid update should be <= 200ms`).toBeLessThanOrEqual(
        200
      );
      expect(result.info.binSize, `binSize should be ${val}`).toBe(val);
      expect(result.info.cols, `binSize=${val} should produce ${cols} columns`).toBe(cols);
      expect(result.info.rows, `binSize=${val} should produce ${rows} rows`).toBe(rows);

      test.info().annotations.push({
        type: 'visual-check',
        description: `Screenshot shows ${cols}x${rows} grid lines for binSize=${val}.`,
      });
      await page.screenshot({
        path: evidenceFile(`e5-bin-grid-size-${val}.png`),
      });
    }

    // Query correctness sanity check with the coarsest grid: a full-scene drag should
    // still select all 20 units regardless of bin size.
    await dragWorld(page, -13, -13, 13, 13);
    await page.waitForTimeout(200);
    expect(
      await getSelectedCount(page),
      'full-scene drag with binSize=15 should select all units'
    ).toBe(20);
  });

  test('E6: Hover Detection', async ({ page }) => {
    await page.evaluate(() => window.__screenMapTest.setHoverEnabled(true));
    await page.waitForTimeout(200);

    const units = await getUnits(page);
    const target = units[0];
    const p = await worldToScreen(page, target.x, target.z);

    await page.mouse.move(p.x, p.y);
    await page.waitForTimeout(100);

    const hovered = await page.evaluate(() => window.__screenMapTest.getHoveredUnit());
    expect(hovered, 'mouse over a unit should produce a hovered unit').not.toBeNull();
    expect(hovered!.name, 'hovered unit should match the unit under the cursor').toBe(target.name);

    test.info().annotations.push({
      type: 'visual-check',
      description:
        'Canvas screenshot shows the hovered unit highlighted in pure yellow (emissiveColor 1,1,0) with its texture removed.',
    });
    await page.screenshot({ path: evidenceFile('e6-hover-over-unit.png') });

    const blank = await findBlankScreenPoint(page);
    await page.mouse.move(blank.x, blank.y);
    await page.waitForTimeout(100);

    const hoveredAfter = await page.evaluate(() => window.__screenMapTest.getHoveredUnit());
    expect(hoveredAfter, 'mouse over blank area should clear hover within 100ms').toBeNull();

    await page.screenshot({ path: evidenceFile('e6-hover-blank.png') });
  });

  test('E7: Randomize Consistency', async ({ page }) => {
    for (let i = 0; i < 3; i++) {
      await page.evaluate(() => window.__screenMapTest.randomize());
      await page.waitForTimeout(500);

      const units = await getUnits(page);
      expect(units.length, 'unit count should remain 20 after randomize').toBe(20);

      for (const u of units) {
        expect(
          Math.abs(u.x),
          `unit ${u.name} x position should stay within world bounds`
        ).toBeLessThanOrEqual(13);
        expect(
          Math.abs(u.z),
          `unit ${u.name} z position should stay within world bounds`
        ).toBeLessThanOrEqual(13);
      }

      const lineCount = await page.evaluate(() => window.__screenMapTest.getBoundsLineCount());
      expect(lineCount, 'ScreenBounds should still be drawn after randomize').toBe(20);

      // Verify query still matches the rendered state: a full-scene drag should
      // select all 20 units, and a point query on the first unit should find it.
      const target = units[0];
      const pointHits = await page.evaluate(
        ({ x, z }) => window.__screenMapTest.queryPoint(x, z),
        { x: target.x, z: target.z }
      );
      expect(pointHits, `iteration ${i + 1}: point query at unit position should find it`).toContain(
        target.name
      );

      await dragWorld(page, -13, -13, 13, 13);
      await page.waitForTimeout(200);

      const selectedCount = await getSelectedCount(page);
      expect(
        selectedCount,
        `iteration ${i + 1}: full-scene selection after randomize should select all 20 units (got ${selectedCount})`
      ).toBe(20);

      test.info().annotations.push({
        type: 'visual-check',
        description: `Iteration ${i + 1}: all 20 units are selected, matching the full-scene box visualization.`,
      });
      await page.screenshot({
        path: evidenceFile(`e7-randomize-consistency-${i + 1}.png`),
      });
    }
  });
});

/**
 * Pathfinding Visual Acceptance Test
 *
 * URL: http://localhost:5173/test/ch04-map-terrain/pathfinding-visual/
 *
 * Validates A* pathfinding, HPA* hierarchy abstraction, domain connectivity,
 * performance, keyboard interaction, and edge cases for the pathfinding
 * visualization page.
 */
import { test, expect, type Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

// -----------------------------------------------------------------------------
// Configuration
// -----------------------------------------------------------------------------

const BASE_URL = 'http://localhost:5173/test/ch04-map-terrain/pathfinding-visual/';
const EVIDENCE_DIR = 'evidence';

function evidencePath(name: string): string {
  if (!fs.existsSync(EVIDENCE_DIR)) {
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  }
  return path.join(EVIDENCE_DIR, name);
}

interface TestHarness {
  getGrid: () => { walkable: boolean; x: number; y: number }[][];
  getAStarPath: () => { x: number; y: number }[];
  getHpaPath: () => { x: number; y: number }[];
  getAStarExplored: () => number;
  getHpaExplored: () => number;
  getDomains: () => Map<number, number>;
  getVizMode: () => 'a' | 'hpa' | 'both' | 'domains' | 'hierarchy';
  setStart: (x: number, y: number) => void;
  setTarget: (x: number, y: number) => void;
  toggleObstacle: (x: number, y: number) => void;
  runUpdate: () => void;
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

async function waitForPageReady(page: Page): Promise<void> {
  await page.goto(BASE_URL);

  // Wait for the stats panel path-length cell to be populated.
  await page.waitForSelector('#stat-path-len', { timeout: 15000 });
  await page.waitForFunction(
    () => {
      const el = document.getElementById('stat-path-len');
      return el !== null && el.textContent !== null && el.textContent.trim() !== '';
    },
    { timeout: 10000 }
  );

  // Verify the WebGL engine is loaded.
  await page.waitForFunction(
    () => {
      const el = document.getElementById('info-engine');
      return el !== null && el.textContent !== null && el.textContent.includes('WebGL');
    },
    { timeout: 10000 }
  );

  // Allow the first render frame to complete.
  await page.waitForTimeout(500);
}

async function setVizMode(page: Page, mode: TestHarness['getVizMode']): Promise<void> {
  const buttonMap: Record<string, string> = {
    a: 'btn-viz-a',
    hpa: 'btn-viz-hpa',
    both: 'btn-viz-both',
    domains: 'btn-viz-domains',
    hierarchy: 'btn-viz-hierarchy',
  };
  await page.click(`#${buttonMap[mode]}`);
  await page.waitForTimeout(300);
}

async function clearObstacles(page: Page): Promise<void> {
  await page.click('#btn-clear-obstacles');
  await page.waitForTimeout(300);
}

async function randomObstacles(page: Page): Promise<void> {
  await page.click('#btn-random-obstacles');
  await page.waitForTimeout(300);
}

async function getCurrentFps(page: Page): Promise<number> {
  const text = await page.locator('#info-fps').textContent();
  return parseFloat((text ?? '0').trim());
}

async function isHeadless(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const ua = navigator.userAgent.toLowerCase();
    return ua.includes('headless') || (navigator as any).webdriver === true;
  });
}

async function getAStarPathLength(page: Page): Promise<number> {
  const text = await page.locator('#stat-path-len').textContent();
  return parseInt((text ?? '0').trim(), 10);
}

async function getAStarTimeMs(page: Page): Promise<number> {
  const text = await page.locator('#stat-a-time').textContent();
  return parseFloat((text ?? '0 ms').replace('ms', '').trim());
}

async function getHpaTimeMs(page: Page): Promise<number> {
  const text = await page.locator('#stat-hpa-time').textContent();
  return parseFloat((text ?? '0 ms').replace('ms', '').trim());
}

async function getDomainCount(page: Page): Promise<number> {
  const text = await page.locator('#stat-domains').textContent();
  return parseInt((text ?? '0').trim(), 10);
}

async function pathAvoidsObstacles(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const h = (window as any).__testHarness as TestHarness | undefined;
    if (!h) return false;
    const grid = h.getGrid();
    const path = h.getAStarPath();
    return path.length > 0 && path.every((p) => grid[p.y]?.[p.x]?.walkable === true);
  });
}

async function pathInBounds(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const h = (window as any).__testHarness as TestHarness | undefined;
    if (!h) return false;
    const path = h.getAStarPath();
    return path.every((p) => p.x >= 0 && p.x < 30 && p.y >= 0 && p.y < 30);
  });
}

async function ensureRandomObstaclesWithPath(page: Page, maxAttempts = 3): Promise<void> {
  for (let i = 0; i < maxAttempts; i++) {
    await randomObstacles(page);
    const len = await getAStarPathLength(page);
    if (len > 0) return;
  }
  throw new Error('Failed to generate random obstacles with a valid A* path');
}

// -----------------------------------------------------------------------------
// Test suite
// -----------------------------------------------------------------------------

test.describe('Pathfinding Visual Acceptance Test', () => {
  test.setTimeout(120000);

  test.beforeEach(async ({ page }) => {
    await waitForPageReady(page);
  });

  // ===========================================================================
  // 1. A* Basic Pathfinding
  // ===========================================================================

  test('E1.1: A* finds a straight-line path of 26 nodes with no obstacles', async ({ page }) => {
    await clearObstacles(page);

    const pathLen = await getAStarPathLength(page);
    expect(pathLen).toBe(26);

    const exploredText = await page.locator('#stat-a-explored').textContent();
    const explored = parseInt((exploredText ?? '0').trim(), 10);
    expect(explored).toBe(26);

    expect(await pathAvoidsObstacles(page)).toBe(true);
  });

  test('E1.2: A* search time is under 5 ms', async ({ page }) => {
    await clearObstacles(page);
    const timeMs = await getAStarTimeMs(page);
    expect(timeMs).toBeLessThan(5);
  });

  test('E1.3: A* path avoids obstacles after random obstacles are added', async ({ page }) => {
    await ensureRandomObstaclesWithPath(page);

    expect(await pathAvoidsObstacles(page)).toBe(true);

    const pathLen = await getAStarPathLength(page);
    expect(pathLen).toBeGreaterThan(0);
  });

  test('E1.4: Ctrl+Click toggles an obstacle and the path reroutes', async ({ page }) => {
    await clearObstacles(page);

    await page.evaluate(() => {
      const h = (window as any).__testHarness as TestHarness;
      h.toggleObstacle(14, 14);
    });
    await page.waitForTimeout(300);

    const blocked = await page.evaluate(() => {
      const h = (window as any).__testHarness as TestHarness;
      return !h.getGrid()[14][14].walkable;
    });
    expect(blocked).toBe(true);

    const pathLen = await getAStarPathLength(page);
    expect(pathLen).toBeGreaterThan(0);
    expect(await pathAvoidsObstacles(page)).toBe(true);
  });

  // ===========================================================================
  // 2. HPA* Hierarchy
  // ===========================================================================

  test('E2.1: 30x30 grid produces 9 abstract clusters', async ({ page }) => {
    await clearObstacles(page);
    await setVizMode(page, 'hierarchy');

    const text = await page.locator('#stat-hpa-nodes').textContent();
    const nodeCount = parseInt((text ?? '0').trim(), 10);
    expect(nodeCount).toBe(9);
  });

  test('E2.2: Abstract edge count is greater than 0 and at most 12', async ({ page }) => {
    await clearObstacles(page);
    await setVizMode(page, 'hierarchy');

    const text = await page.locator('#stat-hpa-edges').textContent();
    const edges = parseInt((text ?? '0').trim(), 10);
    expect(edges).toBeGreaterThan(0);
    expect(edges).toBeLessThanOrEqual(12);
  });

  test('E2.3: HPA* search time is under 3 ms', async ({ page }) => {
    await clearObstacles(page);
    await setVizMode(page, 'hpa');

    const timeMs = await getHpaTimeMs(page);
    expect(timeMs).toBeLessThan(3);
  });

  test('E2.4: HPA* statistics remain valid after a fresh recalculation', async ({ page }) => {
    await clearObstacles(page);
    await page.evaluate(() => {
      const h = (window as any).__testHarness as TestHarness;
      h.runUpdate();
    });
    await page.waitForTimeout(300);

    const nodes = parseInt((await page.locator('#stat-hpa-nodes').textContent() ?? '0').trim(), 10);
    const edges = parseInt((await page.locator('#stat-hpa-edges').textContent() ?? '0').trim(), 10);
    const explored = parseInt((await page.locator('#stat-hpa-explored').textContent() ?? '0').trim(), 10);
    const timeMs = await getHpaTimeMs(page);

    expect(nodes).toBeGreaterThan(0);
    expect(edges).toBeGreaterThan(0);
    expect(explored).toBeGreaterThan(0);
    expect(timeMs).toBeLessThan(10);

    const aStarLen = await getAStarPathLength(page);
    expect(aStarLen).toBeGreaterThan(0);
  });

  // ===========================================================================
  // 3. Domain Visualization
  // ===========================================================================

  test('E3.1: No obstacles produces a single domain', async ({ page }) => {
    await clearObstacles(page);
    await setVizMode(page, 'domains');

    const domainCount = await getDomainCount(page);
    expect(domainCount).toBe(1);
  });

  test('E3.2: Random obstacles produce multiple domains', async ({ page }) => {
    await randomObstacles(page);
    await setVizMode(page, 'domains');

    const domainCount = await getDomainCount(page);
    expect(domainCount).toBeGreaterThanOrEqual(2);
  });

  test('E3.3: A complete wall at x=15 creates at least two domains', async ({ page }) => {
    await clearObstacles(page);

    await page.evaluate(() => {
      const h = (window as any).__testHarness as TestHarness;
      for (let y = 0; y < 30; y++) {
        h.toggleObstacle(15, y);
      }
    });
    await page.waitForTimeout(500);

    await setVizMode(page, 'domains');

    const domainCount = await getDomainCount(page);
    expect(domainCount).toBeGreaterThanOrEqual(2);
  });

  // ===========================================================================
  // 4. Performance
  // ===========================================================================

  test('E4.1: FPS is measurable in the render loop', async ({ page }) => {
    await page.waitForTimeout(1500);

    const fps = await getCurrentFps(page);
    const headless = await isHeadless(page);

    test.info().annotations.push({
      type: 'fps-note',
      description: `FPS=${fps.toFixed(1)}, headless=${headless}`,
    });

    expect(fps).toBeGreaterThan(0);
  });

  // ===========================================================================
  // 5. Keyboard Interaction
  // ===========================================================================

  test('E5.1: Keys 1-5 switch visualization modes correctly', async ({ page }) => {
    const expectations: Array<{ key: string; mode: TestHarness['getVizMode'] }> = [
      { key: '1', mode: 'a' },
      { key: '2', mode: 'hpa' },
      { key: '3', mode: 'both' },
      { key: '4', mode: 'domains' },
      { key: '5', mode: 'hierarchy' },
    ];

    for (const { key, mode } of expectations) {
      await page.keyboard.press(key);
      await page.waitForTimeout(150);
      const actual = await page.evaluate(() => {
        const h = (window as any).__testHarness as TestHarness | undefined;
        return h?.getVizMode();
      });
      expect(actual).toBe(mode);
    }
  });

  test('E5.2: Rapid mode switching does not crash and stats remain valid', async ({ page }) => {
    const sequence = ['1', '2', '3', '4', '5', '1'];
    for (const key of sequence) {
      await page.keyboard.press(key);
      await page.waitForTimeout(80);
    }

    const mode = await page.evaluate(() => {
      const h = (window as any).__testHarness as TestHarness | undefined;
      return h?.getVizMode();
    });
    expect(mode).toBe('a');

    const pathLen = await getAStarPathLength(page);
    expect(pathLen).toBeGreaterThan(0);

    const exploredText = await page.locator('#stat-a-explored').textContent();
    expect(exploredText).toBeTruthy();
  });

  test('E5.3: Keyboard R recalculates and C clears obstacles', async ({ page }) => {
    await ensureRandomObstaclesWithPath(page);
    const lenBefore = await getAStarPathLength(page);
    expect(lenBefore).toBeGreaterThan(0);

    await page.keyboard.press('r');
    await page.waitForTimeout(300);
    const lenAfterRecalc = await getAStarPathLength(page);
    expect(lenAfterRecalc).toBeGreaterThan(0);

    await page.keyboard.press('c');
    await page.waitForTimeout(300);
    const lenAfterClear = await getAStarPathLength(page);
    expect(lenAfterClear).toBe(26);
  });

  // ===========================================================================
  // 6. Edge Cases
  // ===========================================================================

  test('E6.1: Unreachable target results in a path length of 0', async ({ page }) => {
    await clearObstacles(page);

    await page.evaluate(() => {
      const h = (window as any).__testHarness as TestHarness;
      h.setStart(1, 1);
      h.setTarget(27, 14);
    });
    await page.waitForTimeout(300);

    // Surround the target at (27, 14) with a ring of obstacles.
    await page.evaluate(() => {
      const h = (window as any).__testHarness as TestHarness;
      const ring = [
        [26, 13], [27, 13], [28, 13],
        [26, 14], [28, 14],
        [26, 15], [27, 15], [28, 15],
      ];
      for (const [x, y] of ring) {
        h.toggleObstacle(x, y);
      }
    });
    await page.waitForTimeout(500);

    const pathLen = await getAStarPathLength(page);
    expect(pathLen).toBe(0);
  });

  test('E6.2: Grid boundary path from (0,0) to (29,29) stays in bounds', async ({ page }) => {
    await clearObstacles(page);

    await page.evaluate(() => {
      const h = (window as any).__testHarness as TestHarness;
      h.setStart(0, 0);
      h.setTarget(29, 29);
    });
    await page.waitForTimeout(300);

    const pathLen = await getAStarPathLength(page);
    expect(pathLen).toBeGreaterThan(0);
    expect(await pathInBounds(page)).toBe(true);
    expect(await pathAvoidsObstacles(page)).toBe(true);
  });

  // ===========================================================================
  // 7. Screenshots
  // ===========================================================================

  test('S1: Screenshot A* mode with no obstacles', async ({ page }) => {
    await clearObstacles(page);
    await setVizMode(page, 'a');

    const pathLen = await getAStarPathLength(page);
    expect(pathLen).toBe(26);

    await page.screenshot({
      path: evidencePath('screenshot-1-astar-clear.png'),
      fullPage: false,
    });
  });

  test('S2: Screenshot A* mode with 30% random obstacles', async ({ page }) => {
    await ensureRandomObstaclesWithPath(page);
    await setVizMode(page, 'a');

    const pathLen = await getAStarPathLength(page);
    expect(pathLen).toBeGreaterThan(0);

    await page.screenshot({
      path: evidencePath('screenshot-2-astar-obstacles.png'),
      fullPage: false,
    });
  });

  test('S3: Screenshot HPA* hierarchy mode with no obstacles', async ({ page }) => {
    await clearObstacles(page);
    await setVizMode(page, 'hierarchy');

    const nodes = parseInt((await page.locator('#stat-hpa-nodes').textContent() ?? '0').trim(), 10);
    expect(nodes).toBe(9);

    await page.screenshot({
      path: evidencePath('screenshot-3-hpa-hierarchy.png'),
      fullPage: false,
    });
  });

  test('S4: Screenshot both comparison mode with random obstacles', async ({ page }) => {
    await ensureRandomObstaclesWithPath(page);
    await setVizMode(page, 'both');

    const pathLen = await getAStarPathLength(page);
    expect(pathLen).toBeGreaterThan(0);

    await page.screenshot({
      path: evidencePath('screenshot-4-both-compare.png'),
      fullPage: false,
    });
  });

  test('S5: Screenshot domain mode with random obstacles', async ({ page }) => {
    await randomObstacles(page);
    await setVizMode(page, 'domains');

    const domainCount = await getDomainCount(page);
    expect(domainCount).toBeGreaterThanOrEqual(2);

    await page.screenshot({
      path: evidencePath('screenshot-5-domains.png'),
      fullPage: false,
    });
  });
});

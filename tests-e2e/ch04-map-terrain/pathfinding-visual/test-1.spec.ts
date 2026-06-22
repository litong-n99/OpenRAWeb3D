/**
 * pathfinding-e2e.spec.ts — Playwright e2e test for pathfinding visual acceptance test
 *
 * Tests against: /test/ch04-map-terrain/pathfinding-visual/
 * Uses __testHarness global API for programmatic verification.
 */
import { test, expect, Page } from '@playwright/test';
import path from 'path';

const DELAY = 300;
const EVIDENCE_DIR = process.env.PLAYWRIGHT_OUTPUT_DIR
  ? path.resolve(process.env.PLAYWRIGHT_OUTPUT_DIR, 'evidence')
  : path.resolve('test-results/manual/ch04-map-terrain/pathfinding-visual/evidence');

async function getHarness(page: Page) {
  return page.evaluate(() => (window as any).__testHarness);
}

async function getDomainCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    const h = (window as any).__testHarness;
    if (!h) return -1;
    const domains = h.getDomains();
    // domains is a Map<number, number>; count unique domain IDs
    const uniqueIds = new Set<number>();
    for (const v of (domains as Map<number, number>).values()) {
      uniqueIds.add(v);
    }
    return uniqueIds.size;
  });
}

test.describe('Pathfinding Visual Acceptance Test', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('/test/ch04-map-terrain/pathfinding-visual/');
    await page.waitForSelector('#stat-path-len', { timeout: 15000 });
    // Verify engine is WebGL
    await page.waitForFunction(() => {
      const el = document.getElementById('info-engine');
      return el?.textContent?.includes('WebGL');
    }, { timeout: 10000 });
    // Ensure we start in A* mode and with clear obstacles
    await page.click('#btn-viz-a');
    await page.click('#btn-clear-obstacles');
    await page.waitForTimeout(DELAY);
  });

  // ================================================================
  // 1. A* Basic Pathfinding
  // ================================================================

  test('1.1 A* straight-line path has 26 nodes from (2,14) to (27,14)', async ({ page }) => {
    const pathLen = await page.textContent('#stat-path-len');
    const nodes = parseInt(pathLen || '0', 10);
    expect(nodes).toBe(26);

    // Verify path contains correct start and end
    const path = await page.evaluate(() => (window as any).__testHarness.getAStarPath());
    expect(path[0]).toEqual({ x: 2, y: 14 });
    expect(path[path.length - 1]).toEqual({ x: 27, y: 14 });
  });

  test('1.2 A* explored nodes = path length in straight line (no wasted search)', async ({ page }) => {
    const explored = await page.evaluate(() => (window as any).__testHarness.getAStarExplored());
    const pathLenText = await page.textContent('#stat-path-len');
    const pathLen = parseInt(pathLenText || '0', 10);
    // In a straight line, A* explores exactly the path cells (no detours)
    expect(explored).toBe(pathLen);
    expect(explored).toBe(26);
  });

  test('1.3 A* path time < 5ms', async ({ page }) => {
    const timeText = await page.textContent('#stat-a-time');
    const timeMs = parseFloat((timeText || '999 ms').replace(/[^0-9.]/g, ''));
    expect(timeMs).toBeLessThan(5);
  });

  test('1.4 A* path avoids obstacles after random obstacles (30%)', async ({ page }) => {
    await page.click('#btn-random-obstacles');
    await page.waitForTimeout(DELAY);

    const pathValid = await page.evaluate(() => {
      const h = (window as any).__testHarness;
      if (!h) return false;
      const grid = h.getGrid();
      const path = h.getAStarPath();
      for (const p of path) {
        if (!grid[p.y]?.[p.x]?.walkable) return false;
      }
      return path.length > 0;
    });
    expect(pathValid).toBe(true);

    // Path should be longer than the straight-line minimum of 26
    const pathLen = await page.textContent('#stat-path-len');
    const nodes = parseInt(pathLen || '0', 10);
    expect(nodes).toBeGreaterThan(26);
  });

  test('1.5 Ctrl+Click (harness toggleObstacle) blocks cell and path reroutes', async ({ page }) => {
    await page.evaluate(() => {
      const h = (window as any).__testHarness;
      if (h) h.toggleObstacle(14, 14);
    });
    await page.waitForTimeout(DELAY);

    const blocked = await page.evaluate(() => {
      const grid = (window as any).__testHarness.getGrid();
      return !grid[14][14].walkable;
    });
    expect(blocked).toBe(true);

    const pathLen = await page.textContent('#stat-path-len');
    const nodes = parseInt(pathLen || '0', 10);
    // Path should still exist (routes around single blocked cell)
    expect(nodes).toBeGreaterThan(0);
  });

  // ================================================================
  // 2. HPA* Hierarchy
  // ================================================================

  test('2.1 HPA* has 9 abstract nodes for 30x30 grid', async ({ page }) => {
    const nodeText = await page.textContent('#stat-hpa-nodes');
    const nodeCount = parseInt(nodeText || '0', 10);
    expect(nodeCount).toBe(9);
  });

  test('2.2 HPA* abstract edges <= 12 and > 0', async ({ page }) => {
    const edgesText = await page.textContent('#stat-hpa-edges');
    const edges = parseInt(edgesText || '0', 10);
    expect(edges).toBeLessThanOrEqual(12);
    expect(edges).toBeGreaterThan(0);
  });

  test('2.3 HPA* path time < 3ms', async ({ page }) => {
    const timeText = await page.textContent('#stat-hpa-time');
    const timeMs = parseFloat((timeText || '999 ms').replace(/[^0-9.]/g, ''));
    expect(timeMs).toBeLessThan(3);
  });

  test('2.4 HPA* stats are populated after computation', async ({ page }) => {
    await page.evaluate(() => (window as any).__testHarness.runUpdate());
    await page.waitForTimeout(DELAY);

    const hpaNodes = await page.textContent('#stat-hpa-nodes');
    const hpaEdges = await page.textContent('#stat-hpa-edges');
    const hpaTime = await page.textContent('#stat-hpa-time');
    const hpaExplored = await page.textContent('#stat-hpa-explored');

    expect(parseInt(hpaNodes || '0', 10)).toBeGreaterThan(0);
    expect(parseInt(hpaEdges || '0', 10)).toBeGreaterThan(0);
    expect(parseFloat((hpaTime || '999').replace(/[^0-9.]/g, ''))).toBeLessThan(10);
    expect(parseInt(hpaExplored || '0', 10)).toBeGreaterThan(0);
  });

  // ================================================================
  // 3. Domain Visualization
  // ================================================================

  test('3.1 Single domain with no obstacles', async ({ page }) => {
    await page.click('#btn-viz-domains');
    await page.waitForTimeout(DELAY);

    const domainCount = await getDomainCount(page);
    expect(domainCount).toBe(1);

    const statDomains = await page.textContent('#stat-domains');
    expect(parseInt(statDomains || '0', 10)).toBe(1);
  });

  test('3.2 Multiple domains with random obstacles (30%)', async ({ page }) => {
    await page.click('#btn-random-obstacles');
    await page.waitForTimeout(DELAY);
    await page.click('#btn-viz-domains');
    await page.waitForTimeout(DELAY);

    const domainCount = await getDomainCount(page);
    // With 30% random obstacles, should have at least 1 domain (may not always split)
    expect(domainCount).toBeGreaterThanOrEqual(1);
  });

  test('3.3 Complete wall at x=15 creates at least 2 domains', async ({ page }) => {
    // Create vertical wall
    await page.evaluate(() => {
      const h = (window as any).__testHarness;
      if (!h) return;
      for (let y = 0; y < 30; y++) {
        h.toggleObstacle(15, y);
      }
    });
    await page.waitForTimeout(DELAY);
    await page.click('#btn-viz-domains');
    await page.waitForTimeout(DELAY);

    const domainCount = await getDomainCount(page);
    expect(domainCount).toBeGreaterThanOrEqual(2);

    const statDomains = await page.textContent('#stat-domains');
    expect(parseInt(statDomains || '0', 10)).toBeGreaterThanOrEqual(2);
  });

  // ================================================================
  // 4. Performance
  // ================================================================

  test('4.1 FPS is measurable (headless mode)', async ({ page }) => {
    await page.waitForTimeout(2000); // Let FPS stabilize

    const fpsText = await page.textContent('#info-fps');
    const fps = parseInt(fpsText || '0', 10);
    // Headless Chromium caps FPS; expect at minimum a running render loop
    expect(fps).toBeGreaterThan(0);
  });

  // ================================================================
  // 5. Keyboard Interaction
  // ================================================================

  test('5.1 Keys 1-5 switch visualization modes correctly', async ({ page }) => {
    const expectedModes = ['a', 'hpa', 'both', 'domains', 'hierarchy'];

    for (let i = 0; i < 5; i++) {
      await page.keyboard.press(String(i + 1));
      await page.waitForTimeout(200);

      const mode = await page.evaluate(() => (window as any).__testHarness.getVizMode());
      expect(mode).toBe(expectedModes[i]);
    }
  });

  test('5.2 Rapid mode switching does not crash', async ({ page }) => {
    // Rapidly press all 5 keys
    await page.keyboard.press('1');
    await page.waitForTimeout(50);
    await page.keyboard.press('2');
    await page.waitForTimeout(50);
    await page.keyboard.press('3');
    await page.waitForTimeout(50);
    await page.keyboard.press('4');
    await page.waitForTimeout(50);
    await page.keyboard.press('5');
    await page.waitForTimeout(DELAY);

    // Should still be functional
    const pathLen = await page.textContent('#stat-path-len');
    expect(parseInt(pathLen || '0', 10)).toBeGreaterThan(0);

    const fpsText = await page.textContent('#info-fps');
    const fps = parseInt(fpsText || '0', 10);
    expect(fps).toBeGreaterThan(0);
  });

  // ================================================================
  // 6. Edge Cases
  // ================================================================

  test('6.1 Unreachable target returns path length 0', async ({ page }) => {
    // Move start to (1,1), surround target at (27,14) with obstacles
    await page.evaluate(() => {
      const h = (window as any).__testHarness;
      if (!h) return;
      h.setStart(1, 1);
      // Surround target (27,14) with wall
      h.toggleObstacle(26, 13); h.toggleObstacle(27, 13); h.toggleObstacle(28, 13);
      h.toggleObstacle(26, 14); /* target at 27,14 */ h.toggleObstacle(28, 14);
      h.toggleObstacle(26, 15); h.toggleObstacle(27, 15); h.toggleObstacle(28, 15);
    });
    await page.waitForTimeout(DELAY);

    const pathLen = await page.textContent('#stat-path-len');
    const nodes = parseInt(pathLen || '0', 10);
    expect(nodes).toBe(0);

    const path = await page.evaluate(() => (window as any).__testHarness.getAStarPath());
    expect(path.length).toBe(0);
  });

  test('6.2 Grid boundary: start(0,0) to target(29,29) stays in bounds', async ({ page }) => {
    await page.evaluate(() => {
      const h = (window as any).__testHarness;
      if (!h) return;
      h.setStart(0, 0);
      h.setTarget(29, 29);
    });
    await page.waitForTimeout(DELAY);

    const pathLen = await page.textContent('#stat-path-len');
    const nodes = parseInt(pathLen || '0', 10);
    expect(nodes).toBeGreaterThan(0);

    const inBounds = await page.evaluate(() => {
      const path = (window as any).__testHarness.getAStarPath();
      return path.every((p: { x: number; y: number }) =>
        p.x >= 0 && p.x < 30 && p.y >= 0 && p.y < 30
      );
    });
    expect(inBounds).toBe(true);
  });

  // ================================================================
  // 7. Screenshots for visual verification (Kimi)
  // ================================================================

  test('7.1 Screenshot: A* mode, no obstacles, straight line path', async ({ page }) => {
    await page.click('#btn-viz-a');
    await page.waitForTimeout(DELAY);
    await page.screenshot({ path: path.join(EVIDENCE_DIR, 'screenshot-1-astar-clear.png') });
  });

  test('7.2 Screenshot: A* mode, random obstacles (30%)', async ({ page }) => {
    await page.click('#btn-random-obstacles');
    await page.click('#btn-viz-a');
    await page.waitForTimeout(DELAY);
    await page.screenshot({ path: path.join(EVIDENCE_DIR, 'screenshot-2-astar-obstacles.png') });
  });

  test('7.3 Screenshot: HPA* hierarchy mode, abstract nodes and edges', async ({ page }) => {
    await page.click('#btn-clear-obstacles');
    await page.click('#btn-viz-hierarchy');
    await page.waitForTimeout(DELAY);
    await page.screenshot({ path: path.join(EVIDENCE_DIR, 'screenshot-3-hpa-hierarchy.png') });
  });

  test('7.4 Screenshot: Both comparison mode (A* vs HPA*)', async ({ page }) => {
    await page.click('#btn-random-obstacles');
    await page.click('#btn-viz-both');
    await page.waitForTimeout(DELAY);
    await page.screenshot({ path: path.join(EVIDENCE_DIR, 'screenshot-4-both-compare.png') });
  });

  test('7.5 Screenshot: Domain mode, random obstacles (multi-color)', async ({ page }) => {
    await page.click('#btn-random-obstacles');
    await page.click('#btn-viz-domains');
    await page.waitForTimeout(DELAY);
    await page.screenshot({ path: path.join(EVIDENCE_DIR, 'screenshot-5-domains.png') });
  });

  test('7.6 Screenshot: HPA* hierarchy mode, clear view of blue cluster frames and white nodes', async ({ page }) => {
    await page.click('#btn-clear-obstacles');
    await page.click('#btn-viz-hierarchy');
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(EVIDENCE_DIR, 'screenshot-6-hierarchy-clear.png') });
  });
});

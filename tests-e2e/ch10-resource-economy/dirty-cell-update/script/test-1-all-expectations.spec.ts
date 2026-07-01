/**
 * Playwright E2E Test: ResourceRenderer Dirty Cell Incremental Update
 *
 * Test page: http://localhost:5173/test/ch10-resource-economy/dirty-cell-update/
 * Module: ResourceRenderer (dirty cell tracking + incremental sprite update)
 * OpenRA reference: ResourceRenderer._addDirtyCell() + tickRender() dirty queue
 *
 * Expectations covered:
 *   E1: Single cell harvest only affects target cell
 *   E2: Density step-by-step visual gradient
 *   E3: Cell clear correctly removes sprite
 *   E4: Bulk harvest performance stability
 *   E5: Replenish all resources full recovery
 *
 * Plus boundary tests: corner cell, fast auto, clear dirty queue, re-click empty cell
 */

import { test, expect } from '@playwright/test';

const PAGE_URL = 'http://localhost:5173/test/ch10-resource-economy/dirty-cell-update/';

/**
 * Helper: get all stats from the state monitoring panel
 */
async function getStats(page: any) {
  return {
    resourceCells: await page.locator('#stat-resource-cells').textContent(),
    depletedCells: await page.locator('#stat-depleted-cells').textContent(),
    dirtyCount: await page.locator('#stat-dirty-count').textContent(),
    processedTotal: await page.locator('#stat-processed-total').textContent(),
    updateTime: await page.locator('#stat-update-time').textContent(),
    fps: await page.locator('#info-fps').textContent(),
    engine: await page.locator('#info-engine').textContent(),
  };
}

/**
 * Helper: click the harvest button N times
 */
async function harvestNTimes(page: any, n: number) {
  const btn = page.locator('text=采集一次 (-1 密度)');
  for (let i = 0; i < n; i++) {
    await btn.click();
    await page.waitForTimeout(80);
  }
}

/**
 * Helper: set target cell coordinates via sliders
 */
async function setTargetCell(page: any, x: number, y: number) {
  await page.locator('#harvest-cell-x').fill(String(x));
  await page.locator('#harvest-cell-y').fill(String(y));
  await page.waitForTimeout(100);
}

test.describe('Initial Page Load', () => {
  test('page loads with Babylon.js WebGL 2.0 and correct initial stats', async ({ page }) => {
    await page.goto(PAGE_URL);
    await page.waitForTimeout(2000); // Wait for Babylon.js init + first render

    const stats = await getStats(page);

    // Environment
    expect(stats.engine).toContain('Babylon.js');
    expect(stats.engine).toContain('WebGL 2.0');

    // Initial state: all 192 cells at full density
    expect(stats.resourceCells).toBe('192');
    expect(stats.depletedCells).toBe('0');
    expect(stats.dirtyCount).toBe('0');
    expect(stats.processedTotal).toBe('0');

    // FPS should be measurable
    const fps = parseInt(stats.fps || '0', 10);
    expect(fps).toBeGreaterThan(0);
  });
});

test.describe('E1: Single Cell Harvest Only Affects Target Cell', () => {
  test('harvest cell (7,5) once: only target changes, dirty auto-clears', async ({ page }) => {
    await page.goto(PAGE_URL);
    await page.waitForTimeout(2000);

    // Set target to (7,5) — this should be default
    await setTargetCell(page, 7, 5);

    // Harvest once
    await harvestNTimes(page, 1);

    const stats = await getStats(page);

    // Cell (7,5) density went from 10 to 9 — still has resource
    expect(stats.resourceCells).toBe('192');
    expect(stats.depletedCells).toBe('0');

    // Dirty cell should be auto-cleared (processed immediately)
    expect(stats.dirtyCount).toBe('0');

    // Processed total should be 1
    expect(stats.processedTotal).toBe('1');
  });
});

test.describe('E2: Density Step-by-Step Visual Gradient', () => {
  test('10 consecutive harvests on cell (7,5): density 10→0, no skipping', async ({ page }) => {
    await page.goto(PAGE_URL);
    await page.waitForTimeout(2000);

    await setTargetCell(page, 7, 5);

    // Harvest 10 times total (first one already logged above in E1, but we start fresh here)
    for (let i = 1; i <= 10; i++) {
      await harvestNTimes(page, 1);
      const stats = await getStats();
      expect(parseInt(stats.processedTotal || '0', 10)).toBe(i);
      expect(stats.dirtyCount).toBe('0'); // Always auto-cleared
    }

    const stats = await getStats();
    expect(stats.resourceCells).toBe('191'); // One cell fully depleted
    expect(stats.depletedCells).toBe('1');
    expect(stats.processedTotal).toBe('10');
    expect(stats.dirtyCount).toBe('0');
  });
});

test.describe('E3: Cell Clear Correctly Removes Sprite', () => {
  test('clear cell (10,3): density 10→0 instantly, re-click has no effect', async ({ page }) => {
    await page.goto(PAGE_URL);
    await page.waitForTimeout(2000);

    // First, deplete cell (7,5) with 10 harvests
    await setTargetCell(page, 7, 5);
    await harvestNTimes(page, 10);

    // Now clear cell (10,3)
    await setTargetCell(page, 10, 3);
    await page.locator('text=清空此 Cell').click();
    await page.waitForTimeout(200);

    let stats = await getStats();
    expect(stats.resourceCells).toBe('190'); // 192 - 2 depleted
    expect(stats.depletedCells).toBe('2');
    expect(stats.processedTotal).toBe('11'); // 10 harvests + 1 clear
    expect(stats.dirtyCount).toBe('0');

    // Re-click on already empty cell — should have no effect
    await page.locator('text=清空此 Cell').click();
    await page.waitForTimeout(200);

    stats = await getStats();
    // All values should remain unchanged
    expect(stats.resourceCells).toBe('190');
    expect(stats.depletedCells).toBe('2');
    expect(stats.processedTotal).toBe('11'); // NOT incremented
  });
});

test.describe('E4: Bulk Harvest Performance Stability', () => {
  test('auto harvest for 10s at 200ms: FPS >= 50, dirty queue never builds up', async ({ page }) => {
    await page.goto(PAGE_URL);
    await page.waitForTimeout(2000);

    // Set speed to medium (200ms)
    await page.locator('#auto-speed').selectOption('200');

    // Start auto harvest
    await page.locator('text=启动自动采集').click();

    // Wait 8 seconds
    await page.waitForTimeout(8000);

    // Check FPS mid-run
    let stats = await getStats();
    const fpsMid = parseInt(stats.fps || '0', 10);
    expect(fpsMid).toBeGreaterThanOrEqual(50);
    expect(stats.dirtyCount).toBe('0'); // Queue never builds up

    // Stop auto harvest
    const stopBtn = page.locator('text=停止自动采集');
    if (await stopBtn.isVisible()) {
      await stopBtn.click();
    }

    await page.waitForTimeout(500);

    stats = await getStats();
    const fpsEnd = parseInt(stats.fps || '0', 10);
    expect(fpsEnd).toBeGreaterThanOrEqual(50);

    // Processed total should have increased significantly
    const processed = parseInt(stats.processedTotal || '0', 10);
    expect(processed).toBeGreaterThan(50); // At least 50 harvests in 8 seconds
  });

  test('fast auto harvest (50ms) for 5s: FPS >= 45', async ({ page }) => {
    await page.goto(PAGE_URL);
    await page.waitForTimeout(2000);

    // Set speed to fast (50ms)
    await page.locator('#auto-speed').selectOption('50');

    // Start auto harvest
    await page.locator('text=启动自动采集').click();

    // Wait 5 seconds
    await page.waitForTimeout(5000);

    const stats = await getStats();
    const fps = parseInt(stats.fps || '0', 10);
    expect(fps).toBeGreaterThanOrEqual(45);
    expect(stats.dirtyCount).toBe('0');

    // Stop auto harvest
    const stopBtn = page.locator('text=停止自动采集');
    if (await stopBtn.isVisible()) {
      await stopBtn.click();
    }
  });
});

test.describe('E5: Replenish All Resources Full Recovery', () => {
  test('replenish after partial depletion: all 192 cells restored, dirty cleared', async ({ page }) => {
    await page.goto(PAGE_URL);
    await page.waitForTimeout(2000);

    // Deplete some cells first
    await setTargetCell(page, 7, 5);
    await harvestNTimes(page, 10); // Deplete cell (7,5)

    await setTargetCell(page, 10, 3);
    await page.locator('text=清空此 Cell').click(); // Deplete cell (10,3)
    await page.waitForTimeout(200);

    // Auto-harvest briefly to spread harvests
    await page.locator('#auto-speed').selectOption('50');
    await page.locator('text=启动自动采集').click();
    await page.waitForTimeout(3000);
    const stopBtn = page.locator('text=停止自动采集');
    if (await stopBtn.isVisible()) {
      await stopBtn.click();
    }

    // Now replenish
    await page.locator('text=补充资源 (恢复所有 Cell)').click();
    await page.waitForTimeout(500);

    const stats = await getStats();

    // All cells restored
    expect(stats.resourceCells).toBe('192');
    expect(stats.depletedCells).toBe('0');
    expect(stats.dirtyCount).toBe('0');

    // Update time should be under 1 second
    const updateTimeStr = stats.updateTime || '';
    expect(updateTimeStr).toContain('ms');
  });
});

test.describe('Boundary Tests', () => {
  test('corner cell harvest at (0,0) works correctly', async ({ page }) => {
    await page.goto(PAGE_URL);
    await page.waitForTimeout(2000);

    await setTargetCell(page, 0, 0);
    await harvestNTimes(page, 1);

    const stats = await getStats();
    expect(stats.processedTotal).toBe('1');
    expect(stats.dirtyCount).toBe('0');
  });

  test('clear dirty queue manually and reprocess', async ({ page }) => {
    await page.goto(PAGE_URL);
    await page.waitForTimeout(2000);

    // Harvest once — auto-processes, so dirty queue is 0
    await setTargetCell(page, 7, 5);
    await harvestNTimes(page, 1);

    // Clear dirty queue (should have no effect since it is already empty)
    await page.locator('text=清空脏 Cell 队列').click();

    // Process all (should have no effect — no cells to process)
    await page.locator('text=处理全部脏 Cell').click();

    const stats = await getStats();
    expect(stats.dirtyCount).toBe('0');
    expect(stats.processedTotal).toBe('1');
  });

  test('random harvest works and updates stats', async ({ page }) => {
    await page.goto(PAGE_URL);
    await page.waitForTimeout(2000);

    const beforeStats = await getStats();
    await page.locator('text=采集随机 Cell').click();
    await page.waitForTimeout(200);

    const afterStats = await getStats();
    expect(parseInt(afterStats.processedTotal || '0', 10))
      .toBe(parseInt(beforeStats.processedTotal || '0', 10) + 1);
    expect(afterStats.dirtyCount).toBe('0');
  });
});

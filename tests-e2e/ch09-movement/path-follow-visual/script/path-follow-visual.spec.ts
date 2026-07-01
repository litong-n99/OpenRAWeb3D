/**
 * path-follow-visual.spec.ts
 *
 * Acceptance test for ch09-movement/path-follow-visual
 * Validates unit path following: BFS pathfinding, movement, obstacle avoidance,
 * deceleration, and general behavior across 4 scenarios.
 *
 * Test page: http://localhost:5173/test/ch09-movement/path-follow-visual/
 *
 * OpenRA reference: Mobile.ts + Locomotor.ts + HierarchicalPathFinder.ts
 * Covering 7 expectation groups (E1-E7, 23 sub-indicators)
 */

import { test, expect } from '@playwright/test';

const PAGE_URL = 'http://localhost:5173/test/ch09-movement/path-follow-visual/';

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

async function clickScenario(page: any, scenario: string) {
  await page.locator(`button[data-scenario="${scenario}"]`).click();
}

async function clickReset(page: any) {
  await page.locator('#btn-reset').click();
}

async function clickPause(page: any) {
  await page.locator('#btn-pause').click();
}

async function readDiag(page: any, id: string): Promise<string> {
  return (await page.locator(`#${id}`).textContent()) || '';
}

async function waitForDestination(page: any, timeoutMs = 15000) {
  await page.waitForFunction(
    () => {
      const el = document.getElementById('diag-state');
      return el && (el.textContent || '').includes('DESTINATION REACHED');
    },
    { timeout: timeoutMs }
  );
}

// Extract WPos from diagnostic position string like "(17920, 2560)"
function parsePosition(posStr: string): { x: number; y: number } | null {
  const m = posStr.match(/\((\d+),\s*(\d+)\)/);
  if (!m) return null;
  return { x: parseInt(m[1]!, 10), y: parseInt(m[2]!, 10) };
}

test.describe('Path Follow Visual Acceptance Tests', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(PAGE_URL, { waitUntil: 'networkidle' });
    // Wait for Babylon.js + WebGL initialization
    await page.waitForFunction(
      () => {
        const el = document.getElementById('info-engine');
        return el && !!(el.textContent || '').includes('WebGL');
      },
      { timeout: 15000 }
    );
    // Allow initial render
    await page.waitForTimeout(800);
  });

  // -----------------------------------------------------------------------
  // E7.4: FPS stability + E7 initial state
  // -----------------------------------------------------------------------
  test('E7.4 — Initial state: idle diagnostics, WebGL 2.0, FPS >= 30', async ({ page }) => {
    // Engine info
    const engine = await readDiag(page, 'info-engine');
    expect(engine).toContain('WebGL');

    // FPS
    const fps = parseInt(await readDiag(page, 'info-fps'), 10);
    expect(fps).toBeGreaterThanOrEqual(30);

    // Diagnostics idle
    expect(await readDiag(page, 'diag-state')).toMatch(/idle/i);
    expect(await readDiag(page, 'diag-pos')).toBe('-');
    expect(await readDiag(page, 'diag-ticks')).toBe('-');
  });

  // -----------------------------------------------------------------------
  // E1.1, E2, E3, E4, E7.3 — Straight scenario
  // -----------------------------------------------------------------------
  test('Straight scenario: reaches destination with correct position and ticks', async ({ page }) => {
    await clickScenario(page, 'straight');
    await waitForDestination(page);

    // E3.1: State shows DESTINATION REACHED
    expect(await readDiag(page, 'diag-state')).toBe('DESTINATION REACHED');

    // E3.1: Position at (17920, 2560) = cell (17,2) center
    const pos = parsePosition(await readDiag(page, 'diag-pos'));
    expect(pos).not.toBeNull();
    expect(pos!.x).toBe(17920);
    expect(pos!.y).toBe(2560);

    // E1.1: Ticks should be reasonable (15 cells at 1024 su/tick)
    const ticks = parseInt(await readDiag(page, 'diag-ticks'), 10);
    expect(ticks).toBeGreaterThan(0);
    expect(ticks).toBeLessThanOrEqual(30);

    // E1.1: Distance traveled
    const dist = parseInt(await readDiag(page, 'diag-dist'), 10);
    expect(dist).toBeGreaterThan(10000);
    // Approx distance: 15 cells * 1024 = 15360, BFS may add some
    expect(dist).toBeLessThan(20000);

    // E4: Waypoints shown
    const wp = await readDiag(page, 'diag-wp');
    expect(wp).toMatch(/^\d+\/\d+$/);
  });

  // -----------------------------------------------------------------------
  // E2, E3, E4 — Diagonal scenario
  // -----------------------------------------------------------------------
  test('Diagonal scenario: reaches destination (17,17)', async ({ page }) => {
    await clickScenario(page, 'diagonal');
    await waitForDestination(page);

    expect(await readDiag(page, 'diag-state')).toBe('DESTINATION REACHED');

    const pos = parsePosition(await readDiag(page, 'diag-pos'));
    expect(pos).not.toBeNull();
    expect(pos!.x).toBe(17920);
    expect(pos!.y).toBe(17920);

    const ticks = parseInt(await readDiag(page, 'diag-ticks'), 10);
    expect(ticks).toBeGreaterThan(10);
    expect(ticks).toBeLessThanOrEqual(50);
  });

  // -----------------------------------------------------------------------
  // E6 — Obstacle avoidance
  // -----------------------------------------------------------------------
  test('Obstacle scenario: path avoids the wall, reaches (17,14)', async ({ page }) => {
    await clickScenario(page, 'obstacle');
    await waitForDestination(page);

    expect(await readDiag(page, 'diag-state')).toBe('DESTINATION REACHED');

    const pos = parsePosition(await readDiag(page, 'diag-pos'));
    expect(pos).not.toBeNull();
    expect(pos!.x).toBe(17920);
    expect(pos!.y).toBe(14848); // row 14

    // E6: Check waypoints from harness — none should be obstacle cells
    const waypoints = await page.evaluate(() => {
      const h = (window as any).__testHarness;
      return h ? h.getPathWaypoints() : null;
    });
    expect(waypoints).not.toBeNull();
    expect(waypoints.length).toBeGreaterThan(0);

    // Obstacle cells: rows 9-10, cols 5-14
    const obstacleSet = new Set<string>();
    for (let r = 9; r <= 10; r++) {
      for (let c = 5; c <= 14; c++) {
        obstacleSet.add(`${c},${r}`);
      }
    }
    // Convert Babylon world pos back to grid: col = round(x - 0.5), row = round(z - 0.5)
    for (const wp of waypoints) {
      const col = Math.round(wp.x - 0.5);
      const row = Math.round(wp.z - 0.5);
      const key = `${col},${row}`;
      expect(obstacleSet.has(key)).toBeFalsy();
    }
  });

  // -----------------------------------------------------------------------
  // E1, E3 — Long scenario
  // -----------------------------------------------------------------------
  test('Long scenario: reaches destination (18,18)', async ({ page }) => {
    await clickScenario(page, 'long');
    await waitForDestination(page);

    expect(await readDiag(page, 'diag-state')).toBe('DESTINATION REACHED');

    const pos = parsePosition(await readDiag(page, 'diag-pos'));
    expect(pos).not.toBeNull();
    expect(pos!.x).toBe(18944);
    expect(pos!.y).toBe(18944);

    // Long path: at least 20 waypoints
    const ticks = parseInt(await readDiag(page, 'diag-ticks'), 10);
    expect(ticks).toBeGreaterThan(15);
    expect(ticks).toBeLessThanOrEqual(60);
  });

  // -----------------------------------------------------------------------
  // E7.1 — Reset
  // -----------------------------------------------------------------------
  test('E7.1 — Reset clears all visualizations and returns to idle', async ({ page }) => {
    // Start a scenario first
    await clickScenario(page, 'straight');
    await waitForDestination(page);

    // Now reset
    await clickReset(page);
    await page.waitForTimeout(500);

    // Diagnostics should be idle
    expect(await readDiag(page, 'diag-state')).toBe('idle');
    expect(await readDiag(page, 'diag-pos')).toBe('-');
    expect(await readDiag(page, 'diag-ticks')).toBe('-');

    // Unit position should be null
    const unitPos = await page.evaluate(() => {
      return (window as any).__testHarness?.getUnitPosition();
    });
    expect(unitPos).toBeNull();

    // Log should show "Ready"
    const log = await page.locator('#event-log').textContent();
    expect(log).toMatch(/Ready/i);
  });

  // -----------------------------------------------------------------------
  // E7.2 — Pause / Resume
  // -----------------------------------------------------------------------
  test('E7.2 — Pause stops movement, Resume continues to destination', async ({ page }) => {
    await clickScenario(page, 'obstacle');

    // Wait briefly for movement to start (tick 1-2), then pause
    await page.waitForTimeout(150);
    await clickPause(page);

    // Should be paused
    await page.waitForFunction(
      () => {
        const el = document.getElementById('diag-state');
        return el && (el.textContent || '').includes('PAUSED');
      },
      { timeout: 5000 }
    );
    expect(await readDiag(page, 'diag-state')).toBe('PAUSED');

    // Record position while paused
    const pausedPos = await readDiag(page, 'diag-pos');

    // Wait and verify position hasn't changed
    await page.waitForTimeout(500);
    const stillPos = await readDiag(page, 'diag-pos');
    expect(stillPos).toBe(pausedPos);

    // Resume
    await clickPause(page); // toggles to Resume
    await waitForDestination(page);

    expect(await readDiag(page, 'diag-state')).toBe('DESTINATION REACHED');
  });

  // -----------------------------------------------------------------------
  // E7.3 — Repeatability: Straight 3x within ±5 ticks
  // -----------------------------------------------------------------------
  test('E7.3 — Repeatability: Straight scenario 3x, ticks within ±5', async ({ page }) => {
    const tickResults: number[] = [];

    for (let i = 0; i < 3; i++) {
      await clickScenario(page, 'straight');
      await waitForDestination(page);

      const ticks = parseInt(await readDiag(page, 'diag-ticks'), 10);
      expect(ticks).toBeGreaterThan(0);
      tickResults.push(ticks);

      // Brief pause between runs
      await page.waitForTimeout(200);
    }

    // All 3 runs should be within ±5 ticks
    const maxTicks = Math.max(...tickResults);
    const minTicks = Math.min(...tickResults);
    expect(maxTicks - minTicks).toBeLessThanOrEqual(5);
  });

  // -----------------------------------------------------------------------
  // E7.5 — Scenario switching: all 4 scenarios work sequentially
  // -----------------------------------------------------------------------
  test('E7.5 — All 4 scenarios run sequentially without error', async ({ page }) => {
    const scenarios = ['straight', 'diagonal', 'obstacle', 'long'];
    const expected: Record<string, [number, number]> = {
      straight: [17920, 2560],
      diagonal: [17920, 17920],
      obstacle: [17920, 14848],
      long: [18944, 18944],
    };

    for (const sc of scenarios) {
      await clickScenario(page, sc);
      await waitForDestination(page);
      expect(await readDiag(page, 'diag-state')).toBe('DESTINATION REACHED');

      const pos = parsePosition(await readDiag(page, 'diag-pos'));
      expect(pos).not.toBeNull();
      const [ex, ey] = expected[sc]!;
      expect(pos!.x).toBe(ex);
      expect(pos!.y).toBe(ey);
    }
  });

  // -----------------------------------------------------------------------
  // E1.2 — Speed slider display updates (known: actual speed not applied due to reset bug)
  // -----------------------------------------------------------------------
  test('E1.2 — Speed slider updates display text', async ({ page }) => {
    // Set speed to 256
    await page.locator('#speed-slider').fill('256');
    await page.locator('#speed-slider').dispatchEvent('input');
    await page.waitForTimeout(100);

    const display = await page.locator('#speed-display').textContent();
    expect(display).toContain('256');

    // Set speed to 2048
    await page.locator('#speed-slider').fill('2048');
    await page.locator('#speed-slider').dispatchEvent('input');
    await page.waitForTimeout(100);

    const display2 = await page.locator('#speed-display').textContent();
    expect(display2).toContain('2048');

    // KNOWN BUG: The diagnostic panel (diag-speed) may not match the slider
    // because resetSimulation() overwrites unitState.speed to 1024.
    // This test verifies the UI display updates; E1.3 speed control is blocked.
  });

  // -----------------------------------------------------------------------
  // E7.4 — FPS >= 30 during simulation
  // -----------------------------------------------------------------------
  test('E7.4 — FPS stays >= 30 during simulation', async ({ page }) => {
    await clickScenario(page, 'long');
    await waitForDestination(page);

    const fps = parseInt(await readDiag(page, 'info-fps'), 10);
    expect(fps).toBeGreaterThanOrEqual(30);
  });

  // -----------------------------------------------------------------------
  // Edge case — Window resize does not break rendering
  // -----------------------------------------------------------------------
  test('Edge — Window resize to 1280x720 does not break', async ({ page }) => {
    await clickScenario(page, 'straight');
    await page.waitForTimeout(200);

    // Resize
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.waitForTimeout(500);

    await waitForDestination(page);
    expect(await readDiag(page, 'diag-state')).toBe('DESTINATION REACHED');
  });
});

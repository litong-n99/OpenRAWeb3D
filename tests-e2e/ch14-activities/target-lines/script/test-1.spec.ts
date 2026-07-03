import { test, expect, Page } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const EVIDENCE_DIR = 'test-results/manual/ch14-activities/target-lines/evidence';

function ensureEvidenceDir() {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
}

async function waitForWebGLReady(page: Page) {
  await page.waitForSelector('#info-engine', { state: 'visible' });
  // Headless Chromium may report WebGL 1.0 with software rendering,
  // so we match any WebGL version string.
  await expect(page.locator('#info-engine')).toContainText('WebGL', { timeout: 15000 });
  await page.waitForFunction(() => {
    const harness = (window as any).__testHarness;
    return harness && harness.scene && harness.engine && harness.units;
  }, { timeout: 15000 });
}

async function getLineCount(page: Page): Promise<number> {
  const text = await page.locator('#stat-line-count').textContent() || '0';
  return parseInt(text, 10);
}

test.describe('CH14 Activities - Target Lines', () => {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];

  test.beforeEach(async ({ page }) => {
    ensureEvidenceDir();
    consoleErrors.length = 0;
    pageErrors.length = 0;

    page.on('console', msg => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });
    page.on('pageerror', err => pageErrors.push(err.message));

    await page.goto('http://localhost:5173/test/ch14-activities/target-lines/');
    await waitForWebGLReady(page);
  });

  test.afterEach(async ({}, testInfo) => {
    if (consoleErrors.length > 0) {
      testInfo.attach('console-errors.txt', { body: consoleErrors.join('\n'), contentType: 'text/plain' });
    }
    if (pageErrors.length > 0) {
      testInfo.attach('page-errors.txt', { body: pageErrors.join('\n'), contentType: 'text/plain' });
    }
  });

  // ===========================================================================
  // E1: Color vs Activity Type (MAJOR)
  // ===========================================================================
  test('E1: color reflects activity type (Move blue / AttackMove red)', async ({ page }) => {
    // Unit A starts with Move
    await expect(page.locator('#stat-activity')).toHaveText('Move');
    await expect(page.locator('#stat-selected')).toHaveText('Unit A');

    await page.screenshot({ path: path.join(EVIDENCE_DIR, 'screenshot-1-initial.png') });

    // Switch to AttackMove
    await page.locator('#btn-attack-move').click();
    await expect(page.locator('#stat-activity')).toHaveText('AttackMove');
    await expect(page.locator('#color-attack')).toHaveValue('#e94560');

    const attackColor = await page.locator('#color-attack').evaluate((el: HTMLInputElement) => el.value);
    expect(attackColor.toLowerCase()).toBe('#e94560');

    await page.screenshot({ path: path.join(EVIDENCE_DIR, 'screenshot-2-attackmove.png') });

    // Switch back to Move
    await page.locator('#btn-move').click();
    await expect(page.locator('#stat-activity')).toHaveText('Move');
    await expect(page.locator('#color-move')).toHaveValue('#3399f2');

    // Modify the Move color picker and verify it updates
    await page.locator('#color-move').fill('#00ff00');
    await expect(page.locator('#color-move')).toHaveValue('#00ff00');
  });

  // ===========================================================================
  // E2: Dashed Line Style (MINOR)
  // Note: headless mode cannot verify dash pattern visually; we verify via
  // DOM indicators and __testHarness that lines exist and update correctly.
  // Kimi visual verification handles the actual dash pattern validation.
  // ===========================================================================
  test('E2: target line mesh exists and updates with new target', async ({ page }) => {
    const canvas = page.locator('canvas').first();
    await expect(canvas).toBeVisible();

    // Initial state: Unit A has a target, so at least one targetLine mesh exists
    const hasLineMesh = await page.evaluate(() => {
      const harness = (window as any).__testHarness;
      return harness.scene.meshes.some(
        (m: any) => m.name && (m.name.includes('targetLine') || m.name.includes('wpLine'))
      );
    });
    expect(hasLineMesh).toBe(true);

    // Verify line count is at least 1 (Unit A has initial target)
    const initialCount = await getLineCount(page);
    expect(initialCount).toBeGreaterThanOrEqual(1);

    // Add a waypoint to verify line count increases (new waypoint segment = +1 line)
    await page.locator('#btn-add-waypoint').click();
    await expect(async () => {
      const count = await getLineCount(page);
      expect(count).toBeGreaterThan(initialCount);
    }).toPass({ timeout: 3000 });

    const countAfter = await getLineCount(page);
    expect(countAfter).toBeGreaterThan(initialCount);
  });

  // ===========================================================================
  // E3: Waypoint Nodes (MAJOR)
  // ===========================================================================
  test('E3: adding and clearing waypoints updates line count correctly', async ({ page }) => {
    await page.screenshot({ path: path.join(EVIDENCE_DIR, 'screenshot-3-waypoints.png') });

    const baseCount = await getLineCount(page);

    // Add first waypoint
    await page.locator('#btn-add-waypoint').click();
    await expect(async () => {
      const count = await getLineCount(page);
      expect(count).toBeGreaterThan(baseCount);
    }).toPass({ timeout: 3000 });
    const countOne = await getLineCount(page);

    // Add second waypoint
    await page.locator('#btn-add-waypoint').click();
    await expect(async () => {
      const count = await getLineCount(page);
      expect(count).toBeGreaterThan(countOne);
    }).toPass({ timeout: 3000 });

    // Clear waypoints
    await page.locator('#btn-clear-waypoints').click();
    await expect(async () => {
      const count = await getLineCount(page);
      expect(count).toBeLessThanOrEqual(baseCount);
    }).toPass({ timeout: 3000 });
  });

  // ===========================================================================
  // E4: Dynamic Update & Fade-out (BLOCKER)
  // ===========================================================================
  test('E4: target line fades out after unit reaches its target', async ({ page }) => {
    const canvas = page.locator('canvas').first();
    await expect(canvas).toBeVisible();

    const box = await canvas.boundingBox();
    if (!box) throw new Error('Canvas bounding box not available');

    // Click at a moderate distance so the unit can arrive in a reasonable time
    await page.mouse.click(box.x + box.width * 0.65, box.y + box.height * 0.45);

    // A target line should appear
    await expect(async () => {
      const count = await getLineCount(page);
      expect(count).toBeGreaterThan(0);
    }).toPass({ timeout: 5000 });

    // Wait until the unit arrives and the target is cleared
    await page.waitForFunction(
      () => {
        const harness = (window as any).__testHarness;
        const unitA = harness.units.get('A');
        return unitA && unitA.targetCell === null;
      },
      { timeout: 30000 }
    );

    await expect(async () => {
      const count = await getLineCount(page);
      expect(count).toBe(0);
    }).toPass({ timeout: 5000 });

    // Final programmatic verification
    const targetCleared = await page.evaluate(() => {
      const harness = (window as any).__testHarness;
      const unitA = harness.units.get('A');
      return unitA && unitA.targetCell === null;
    });
    expect(targetCleared).toBe(true);
  });

  // ===========================================================================
  // E5: Multi-Unit Independent Target Lines (MAJOR)
  // ===========================================================================
  test('E5: units maintain independent selections and activity types', async ({ page }) => {
    // Select Unit B via UI. Unit B starts with AttackMove (set in main.ts).
    await page.locator('#btn-unit-b').click();
    await expect(page.locator('#stat-selected')).toHaveText('Unit B');
    // Unit B's initial activity type is AttackMove
    await expect(page.locator('#stat-activity')).toHaveText('AttackMove');

    await page.screenshot({ path: path.join(EVIDENCE_DIR, 'screenshot-4-unit-b.png') });

    // Change Unit B to Move
    await page.locator('#btn-move').click();
    await expect(page.locator('#stat-activity')).toHaveText('Move');

    // Switch back to Unit A with keyboard shortcut
    await page.keyboard.press('a');
    await expect(page.locator('#stat-selected')).toHaveText('Unit A');

    // Unit A should still be on Move (its independent activity type)
    await expect(page.locator('#stat-activity')).toHaveText('Move');

    // Programmatic check via harness: getSelectedUnit returns 'A' or 'B'
    const selected = await page.evaluate(() => (window as any).__testHarness.getSelectedUnit());
    expect(selected).toBe('A');

    // Switch back to Unit B and ensure its Move activity persisted
    await page.keyboard.press('b');
    await expect(page.locator('#stat-selected')).toHaveText('Unit B');
    await expect(page.locator('#stat-activity')).toHaveText('Move');
  });

  // ===========================================================================
  // Edge / boundary tests
  // ===========================================================================
  test('Edge: rapid activity switching does not produce errors', async ({ page }) => {
    // Rapidly alternate Move / AttackMove 5 times
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press('m');
      await page.keyboard.press('t');
    }

    // Allow any queued handlers to settle
    await page.waitForTimeout(500);

    expect(consoleErrors).toHaveLength(0);
    expect(pageErrors).toHaveLength(0);
  });

  test('Edge: toggling target lines hides them', async ({ page }) => {
    await page.keyboard.press('l');
    await page.waitForTimeout(300);

    const visible = await page.evaluate(() => (window as any).__testHarness.getTargetLinesVisible());
    expect(visible).toBe(false);

    await page.screenshot({ path: path.join(EVIDENCE_DIR, 'screenshot-5-lines-hidden.png') });

    // Toggle back on
    await page.keyboard.press('l');
    await page.waitForTimeout(300);
    const visibleAgain = await page.evaluate(() => (window as any).__testHarness.getTargetLinesVisible());
    expect(visibleAgain).toBe(true);
  });

  test('Edge: toggling waypoints hides them', async ({ page }) => {
    // Add a waypoint first so there is something to toggle
    await page.locator('#btn-add-waypoint').click();
    await page.waitForTimeout(300);

    await page.keyboard.press('w');
    await page.waitForTimeout(300);

    const visible = await page.evaluate(() => (window as any).__testHarness.getWaypointsVisible());
    expect(visible).toBe(false);

    // Toggle back on
    await page.keyboard.press('w');
    await page.waitForTimeout(300);
    const visibleAgain = await page.evaluate(() => (window as any).__testHarness.getWaypointsVisible());
    expect(visibleAgain).toBe(true);
  });
});

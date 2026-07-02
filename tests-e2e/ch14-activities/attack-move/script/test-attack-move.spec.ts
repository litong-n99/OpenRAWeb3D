import { test, expect, type Page } from '@playwright/test';

const BASE_URL = 'http://localhost:5173/test/ch14-activities/attack-move/';
const EVIDENCE_DIR = 'test-results/manual/ch14-activities/attack-move/evidence';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function getHarness<T>(page: Page, method: string): Promise<T> {
  return page.evaluate((m) => (window as any).__testHarness[m](), method);
}

async function getUnit(page: Page): Promise<any> {
  return getHarness(page, 'getUnit');
}

async function getEnemies(page: Page): Promise<any[]> {
  return getHarness(page, 'getEnemies');
}

async function getUnitState(page: Page): Promise<string> {
  return getHarness(page, 'getUnitState');
}

async function getInterruptCount(page: Page): Promise<number> {
  return getHarness(page, 'getInterruptCount');
}

async function getScanRange(page: Page): Promise<number> {
  return getHarness(page, 'getScanRange');
}

/**
 * Click a preset button and read harness state in the same JS turn,
 * before the render loop can advance. This avoids race conditions where
 * an interrupt happens between the click and the first assertion.
 */
async function applyPreset(page: Page, id: string): Promise<{ unit: any; enemies: any[] }> {
  return page.evaluate((presetId) => {
    const btn = document.getElementById(presetId);
    if (btn) btn.click();
    const harness = (window as any).__testHarness;
    return {
      unit: harness.getUnit(),
      enemies: harness.getEnemies(),
    };
  }, id);
}

async function clickScanRange(page: Page, id: string): Promise<void> {
  await page.locator(id).click();
  // Let the render loop apply the new ring size / stats.
  await page.waitForTimeout(120);
}

async function waitForUnitState(
  page: Page,
  expected: string,
  timeout = 5000
): Promise<void> {
  await page.waitForFunction(
    (state) => (window as any).__testHarness.getUnitState() === state,
    expected,
    { timeout }
  );
}

async function waitForEnemyDead(
  page: Page,
  enemyIndex = 0,
  timeout = 5000
): Promise<void> {
  await page.waitForFunction(
    (idx) => {
      const enemies = (window as any).__testHarness.getEnemies();
      return !enemies[idx]?.alive;
    },
    enemyIndex,
    { timeout }
  );
}

async function waitForAllEnemiesDead(page: Page, timeout = 25000): Promise<void> {
  await page.waitForFunction(
    () => {
      const enemies = (window as any).__testHarness.getEnemies();
      return enemies.length > 0 && enemies.every((e: any) => !e.alive);
    },
    undefined,
    { timeout }
  );
}

async function screenshot(page: Page, name: string) {
  await page.screenshot({ path: `${EVIDENCE_DIR}/${name}` });
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

test.describe('AttackMove Activity Acceptance', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
    // Wait until the harness is exposed and the stats panel is live.
    await page.waitForFunction(() => !!(window as any).__testHarness?.getUnit, {
      timeout: 10000,
    });
    await page.waitForSelector('#stat-state', { timeout: 10000 });
    // Let the first frames render before interacting.
    await page.waitForTimeout(500);
  });

  // -------------------------------------------------------------------------
  // E1: 攻击移动中断行为 (BLOCKER)
  // -------------------------------------------------------------------------
  test('E1 attack-move interrupt behavior', async ({ page }) => {
    const { unit: unitStart } = await applyPreset(page, 'btn-scene-enemy-mid');
    expect(unitStart.state).toBe('moving');
    expect(unitStart.targetX).toBe(17);
    expect(unitStart.targetY).toBe(10);

    await screenshot(page, 'e1-initial-moving.png');

    // Wait for the state transition to attacking.
    await waitForUnitState(page, 'attacking', 5000);

    const unitAttacking = await getUnit(page);
    expect(unitAttacking.state).toBe('attacking');
    expect(unitAttacking.interruptCount).toBeGreaterThan(unitStart.interruptCount);

    // DOM alert should be visible.
    const alert = page.locator('#enemy-alert');
    await expect(alert).toHaveClass(/visible/);
    await expect(alert).toContainText('发现敌人');

    await screenshot(page, 'e1-attacking-alert.png');

    // Wait for the enemy to die (attack takes ~1 second).
    await waitForEnemyDead(page, 0, 5000);

    const interrupts = await getInterruptCount(page);
    expect(interrupts).toBeGreaterThanOrEqual(1);

    await screenshot(page, 'e1-enemy-dead.png');
  });

  // -------------------------------------------------------------------------
  // E2: 扫描范围可视化 (MAJOR)
  // -------------------------------------------------------------------------
  test('E2 scan range visualization', async ({ page }) => {
    const { unit: unitMoving } = await applyPreset(page, 'btn-scene-enemy-mid');
    const scanRange = unitMoving.scanRange;
    expect(scanRange).toBe(5);

    // Torus was created with diameter 1, then scaled by scanRange * CELL_SIZE * 2.
    // scanRange 5 -> scaling 10 -> world diameter 10.
    const ringScaling = await page.evaluate(() => {
      const u = (window as any).__testHarness.getUnit();
      return u.scanRing?.scaling.x ?? -1;
    });
    expect(ringScaling).toBeCloseTo(scanRange * 2, 2);

    await screenshot(page, 'e2-scan-ring-moving.png');

    // Verify combat color while attacking.
    await waitForUnitState(page, 'attacking', 5000);
    const combatColor = await page.evaluate(() => {
      const u = (window as any).__testHarness.getUnit();
      const c = u.scanMat?.emissiveColor;
      return c ? { r: c.r, g: c.g, b: c.b } : null;
    });
    expect(combatColor).not.toBeNull();
    // COLOR_SCAN_COMBAT = #E94560 -> Color3(0.91, 0.27, 0.38)
    expect(combatColor!.r).toBeCloseTo(0.91, 1);
    expect(combatColor!.g).toBeCloseTo(0.27, 1);
    expect(combatColor!.b).toBeCloseTo(0.38, 1);

    await screenshot(page, 'e2-scan-ring-combat.png');

    // After the enemy is dead, verify safe color.
    await waitForEnemyDead(page, 0, 5000);
    await waitForUnitState(page, 'moving', 5000);

    const safeColor = await page.evaluate(() => {
      const u = (window as any).__testHarness.getUnit();
      const c = u.scanMat?.emissiveColor;
      return c ? { r: c.r, g: c.g, b: c.b } : null;
    });
    // COLOR_SCAN_SAFE = #44CC44 -> Color3(0.27, 0.80, 0.27)
    expect(safeColor).not.toBeNull();
    expect(safeColor!.r).toBeCloseTo(0.27, 1);
    expect(safeColor!.g).toBeCloseTo(0.80, 1);
    expect(safeColor!.b).toBeCloseTo(0.27, 1);

    await screenshot(page, 'e2-scan-ring-safe.png');
  });

  // -------------------------------------------------------------------------
  // E3: 目标线保持 (MAJOR)
  // -------------------------------------------------------------------------
  test('E3 target line remains pointing to original target', async ({ page }) => {
    const { unit: unitStart } = await applyPreset(page, 'btn-scene-enemy-mid');
    const originalTarget = { x: unitStart.targetX, y: unitStart.targetY };

    await waitForUnitState(page, 'attacking', 5000);

    // Target should not change to enemy position.
    const unitAttacking = await getUnit(page);
    expect(unitAttacking.targetX).toBe(originalTarget.x);
    expect(unitAttacking.targetY).toBe(originalTarget.y);

    // Target line should still be visible during the attack.
    const lineExistsDuringAttack = await page.evaluate(() => {
      const scene = (window as any).__testHarness.scene;
      return scene.meshes.some((m: any) => m.name === 'targetLine' || m.name === 'targetMarker');
    });
    expect(lineExistsDuringAttack).toBe(true);

    await screenshot(page, 'e3-target-line-attacking.png');

    // Wait until the unit finishes and becomes idle (allow slow headless rendering).
    await waitForUnitState(page, 'idle', 20000);

    // At destination, target line should have been disposed.
    const lineStillExists = await page.evaluate(() => {
      const scene = (window as any).__testHarness.scene;
      return scene.meshes.some((m: any) => m.name === 'targetLine' || m.name === 'targetMarker');
    });
    expect(lineStillExists).toBe(false);

    await screenshot(page, 'e3-target-line-idle.png');
  });

  // -------------------------------------------------------------------------
  // E4: 恢复移动 (BLOCKER)
  // -------------------------------------------------------------------------
  test('E4 resume moving after combat', async ({ page }) => {
    const { unit: unitStart } = await applyPreset(page, 'btn-scene-enemy-mid');
    const originalTarget = { x: unitStart.targetX, y: unitStart.targetY };

    await waitForUnitState(page, 'attacking', 5000);
    await waitForEnemyDead(page, 0, 5000);

    // Expect the short "resuming" state then back to moving.
    await waitForUnitState(page, 'resuming', 2000);
    await waitForUnitState(page, 'moving', 5000);

    // Unit must keep the original target.
    const unitResumed = await getUnit(page);
    expect(unitResumed.targetX).toBe(originalTarget.x);
    expect(unitResumed.targetY).toBe(originalTarget.y);

    await screenshot(page, 'e4-resumed-moving.png');

    // It should eventually reach the original target and become idle.
    await waitForUnitState(page, 'idle', 20000);

    const unitFinal = await getUnit(page);
    expect(unitFinal.cellX).toBe(originalTarget.x);
    expect(unitFinal.cellY).toBe(originalTarget.y);

    await screenshot(page, 'e4-reached-target.png');
  });

  // -------------------------------------------------------------------------
  // E5: 多敌人场景 (BLOCKER)
  // -------------------------------------------------------------------------
  test('E5 multiple enemies are cleared sequentially', async ({ page }) => {
    const { unit: unitStart, enemies: enemiesInitial } = await applyPreset(
      page,
      'btn-scene-multiple'
    );
    expect(enemiesInitial.length).toBe(3);

    const startInterrupts = unitStart.interruptCount;

    await screenshot(page, 'e5-multiple-start.png');

    // Wait until all three enemies are eliminated.
    await waitForAllEnemiesDead(page, 25000);

    const endInterrupts = await getInterruptCount(page);
    expect(endInterrupts).toBeGreaterThanOrEqual(startInterrupts + 3);

    await screenshot(page, 'e5-multiple-all-dead.png');
  });

  // -------------------------------------------------------------------------
  // Boundary tests
  // -------------------------------------------------------------------------

  test('B1 rapid reset 10 times does not crash', async ({ page }) => {
    for (let i = 0; i < 10; i++) {
      await page.locator('#btn-reset').click();
      await page.waitForTimeout(80);
    }

    // Give the render loop a moment to recover.
    await page.waitForTimeout(500);

    const unit = await getUnit(page);
    expect(unit).toBeTruthy();
    expect(typeof unit.posX).toBe('number');
    expect(typeof unit.posZ).toBe('number');

    await screenshot(page, 'b1-rapid-reset.png');
  });

  test('B2 scan range changes immediately while moving', async ({ page }) => {
    await applyPreset(page, 'btn-scene-direct');
    await waitForUnitState(page, 'moving', 3000);

    const checkRingScaling = async (range: number) => {
      const scaling = await page.evaluate(() => {
        const u = (window as any).__testHarness.getUnit();
        return u.scanRing?.scaling.x ?? -1;
      });
      // World diameter = range * CELL_SIZE * 2 = range * 2.
      expect(scaling).toBeCloseTo(range * 2, 2);

      const currentRange = await getScanRange(page);
      expect(currentRange).toBe(range);
    };

    await clickScanRange(page, '#btn-scan-3');
    await checkRingScaling(3);
    await screenshot(page, 'b2-scan-range-3.png');

    await clickScanRange(page, '#btn-scan-5');
    await checkRingScaling(5);
    await screenshot(page, 'b2-scan-range-5.png');

    await clickScanRange(page, '#btn-scan-8');
    await checkRingScaling(8);
    await screenshot(page, 'b2-scan-range-8.png');
  });

  test('B3 direct path reaches target without interruption', async ({ page }) => {
    const { unit: unitStart, enemies } = await applyPreset(page, 'btn-scene-direct');
    expect(enemies.length).toBe(0);
    expect(unitStart.state).toBe('moving');

    await screenshot(page, 'b3-direct-start.png');

    // Wait for arrival.
    await waitForUnitState(page, 'idle', 20000);

    const unitEnd = await getUnit(page);
    expect(unitEnd.cellX).toBe(unitStart.targetX);
    expect(unitEnd.cellY).toBe(unitStart.targetY);
    expect(unitEnd.interruptCount).toBe(0);

    await screenshot(page, 'b3-direct-arrived.png');
  });
});

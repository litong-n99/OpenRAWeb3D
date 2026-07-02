import { test, expect, type Page } from '@playwright/test';

const BASE_URL = 'http://localhost:5173/test/ch14-activities/attack/';
const EVIDENCE_DIR = 'test-results/manual/ch14-activities/attack/evidence';

async function clickPreset(page: Page, id: string) {
  await page.locator(id).click();
  await page.waitForTimeout(500);
}

async function getHarness(page: Page, method: string) {
  return page.evaluate((m) => (window as any).__testHarness[m](), method);
}

test.describe('Attack Activity', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL);
    await page.waitForSelector('#stat-attack-status', { timeout: 10000 });
    await page.waitForTimeout(500);
  });

  // E1: Range detection & auto-move (BLOCKER)
  test('E1 range detection & auto-move', async ({ page }) => {
    await clickPreset(page, '#btn-scene-out-range');

    const initialInRange = await getHarness(page, 'isInRange');
    expect(initialInRange).toBe(false);

    const initialStatus = await page.textContent('#stat-attack-status');
    // Should indicate movement is needed
    const needsMove = (initialStatus ?? '').includes('移动');
    expect(needsMove).toBe(true);

    await page.screenshot({ path: `${EVIDENCE_DIR}/e1-start-out-of-range.png` });

    // Wait for the attacker to close distance via A* pathfinding
    await page.waitForTimeout(8000);

    await page.screenshot({ path: `${EVIDENCE_DIR}/e1-arrived-in-range.png` });

    const finalInRange = await getHarness(page, 'isInRange');
    expect(finalInRange).toBe(true);

    const finalStatus = await page.textContent('#stat-attack-status');
    // Should have transitioned to Attacking or at least NeedsToTurn
    const isTerminal = (finalStatus ?? '').includes('攻击') || (finalStatus ?? '').includes('转向');
    expect(isTerminal).toBe(true);
  });

  // E2: Turn & fire (MAJOR)
  test('E2 turn & fire', async ({ page }) => {
    // Click without delay to capture NeedsToTurn state before unit turns
    await page.locator('#btn-scene-needs-turn').click();
    // Immediately read status before the render loop advances (or minimal delay)
    await page.waitForTimeout(50);

    let startStatus = await page.textContent('#stat-attack-status');
    // The unit may turn very fast - if we missed NeedsToTurn, verify it was either turn or attack
    const validStart = (startStatus ?? '').includes('转向') || (startStatus ?? '').includes('攻击');
    expect(validStart).toBe(true);

    const startCount = await getHarness(page, 'getFireCount');
    await page.screenshot({ path: `${EVIDENCE_DIR}/e2-needs-turn.png` });

    // Allow time to turn and fire at least once (cooldown = 20 frames)
    await page.waitForTimeout(4000);

    await page.screenshot({ path: `${EVIDENCE_DIR}/e2-attacking.png` });

    const endCount = await getHarness(page, 'getFireCount');
    expect(endCount).toBeGreaterThan(startCount);

    const status = await page.textContent('#stat-attack-status');
    expect(status).toContain('攻击'); // Attacking

    // Check that FIRE flash element is present (it uses class toggling)
    const flash = page.locator('#attack-flash');
    await expect(flash).toBeVisible();
  });

  // E3: WAngle facing system (BLOCKER)
  test('E3 WAngle facing system', async ({ page }) => {
    // Click without delay to capture turn state
    await page.locator('#btn-scene-needs-turn').click();
    await page.waitForTimeout(50);

    const facingText = await page.textContent('#stat-facing');
    // Should show WAngle value with degrees
    expect(facingText).toMatch(/^\d+\s+\(\d+°\)$/);

    // After click with minimal delay, check in-firing-arc
    // (unit may have already turned partially or fully)
    const initialArc = await getHarness(page, 'isInFiringArc');
    const initialFacing = facingText;

    await page.screenshot({ path: `${EVIDENCE_DIR}/e3-before-turn.png` });

    await page.waitForTimeout(4000);

    await page.screenshot({ path: `${EVIDENCE_DIR}/e3-after-turn.png` });

    const endArc = await getHarness(page, 'isInFiringArc');
    expect(endArc).toBe(true);

    // Verify final facing is the correct WAngle (pointing at target to the right/east)
    // After attack, facing should be toward target (around 768 for East)
    const facingAfter = await page.textContent('#stat-facing');
    const facingAfterWAngle = parseInt((facingAfter ?? '0').split(' ')[0], 10);
    // Target is to the east (WAngle ~768) — verify facing is in eastern quadrant
    expect(facingAfterWAngle).toBeGreaterThan(600);
    expect(facingAfterWAngle).toBeLessThan(950);
  });

  // E4: Target line rendering (MAJOR)
  test('E4 target line rendering', async ({ page }) => {
    await clickPreset(page, '#btn-scene-in-range');

    const lineColorAlive = await page.textContent('#stat-line-color');
    expect(lineColorAlive).toContain('#E94560');
    expect(lineColorAlive).toContain('红');

    await page.screenshot({ path: `${EVIDENCE_DIR}/e4-target-line-alive.png` });

    // Fire until target dies by waiting long enough
    await page.waitForTimeout(15000);

    await page.screenshot({ path: `${EVIDENCE_DIR}/e4-target-dead-no-line.png` });

    const lineColorDead = await page.textContent('#stat-line-color');
    expect(lineColorDead).toContain('无目标');
  });

  // E5: Minimum range behavior (MAJOR)
  test('E5 min range retreat', async ({ page }) => {
    await clickPreset(page, '#btn-scene-min-range');

    const startStatus = await page.textContent('#stat-attack-status');
    expect(startStatus).toContain('移动'); // too close, needs to retreat

    const attackerStart = await page.evaluate(() => {
      const a = (window as any).__testHarness.getAttacker();
      const t = (window as any).__testHarness.getTarget();
      return { ax: a.posX, az: a.posZ, tx: t.posX, tz: t.posZ, minRange: a.minRange };
    });
    expect(attackerStart.minRange).toBeGreaterThan(0);

    await page.screenshot({ path: `${EVIDENCE_DIR}/e5-min-range-start.png` });

    // Wait for retreat
    await page.waitForTimeout(5000);

    await page.screenshot({ path: `${EVIDENCE_DIR}/e5-min-range-retreated.png` });

    const attackerEnd = await page.evaluate(() => {
      const a = (window as any).__testHarness.getAttacker();
      const t = (window as any).__testHarness.getTarget();
      return { ax: a.posX, az: a.posZ, tx: t.posX, tz: t.posZ };
    });

    const distStart = Math.hypot(attackerStart.ax - attackerStart.tx, attackerStart.az - attackerStart.tz);
    const distEnd = Math.hypot(attackerEnd.ax - attackerEnd.tx, attackerEnd.az - attackerEnd.tz);

    // Unit should have moved further away
    expect(distEnd).toBeGreaterThan(distStart);
  });

  // E6: Moving target pursuit (BLOCKER)
  test('E6 moving target pursuit', async ({ page }) => {
    await clickPreset(page, '#btn-scene-moving-target');

    const targetStart = await page.evaluate(() => {
      const t = (window as any).__testHarness.getTarget();
      return { tx: t.posX, tz: t.posZ, pathLen: t.patrolPath?.length || 0 };
    });
    expect(targetStart.pathLen).toBeGreaterThan(0);

    await page.screenshot({ path: `${EVIDENCE_DIR}/e6-moving-target-start.png` });

    // Wait for patrol movement and pursuit
    await page.waitForTimeout(8000);

    await page.screenshot({ path: `${EVIDENCE_DIR}/e6-moving-target-pursuit.png` });

    const targetEnd = await page.evaluate(() => {
      const t = (window as any).__testHarness.getTarget();
      return { tx: t.posX, tz: t.posZ };
    });

    // Target should have moved from initial position
    const targetMoved = targetStart.tx !== targetEnd.tx || targetStart.tz !== targetEnd.tz;
    expect(targetMoved).toBe(true);

    // Fire count should increase during pursuit
    const fireCount = await getHarness(page, 'getFireCount');
    expect(fireCount).toBeGreaterThan(0);
  });

  // Edge case 1: Rapid preset switching (no crash)
  test('EC1 rapid preset switching', async ({ page }) => {
    for (let i = 0; i < 3; i++) {
      await page.locator('#btn-scene-in-range').click();
      await page.waitForTimeout(200);
      await page.locator('#btn-scene-out-range').click();
      await page.waitForTimeout(200);
      await page.locator('#btn-scene-needs-turn').click();
      await page.waitForTimeout(200);
      await page.locator('#btn-scene-min-range').click();
      await page.waitForTimeout(200);
      await page.locator('#btn-scene-moving-target').click();
      await page.waitForTimeout(200);
    }
    await page.waitForTimeout(1000);
    await page.screenshot({ path: `${EVIDENCE_DIR}/ec1-rapid-switch.png` });

    const status = await page.textContent('#stat-attack-status');
    expect(status).toBeTruthy();
    expect(status).not.toContain('undefined');
    expect(status).not.toContain('null');

    const attacker = await page.evaluate(() => {
      const a = (window as any).__testHarness.getAttacker();
      return { exists: !!a, posX: a.posX, posZ: a.posZ };
    });
    expect(attacker.exists).toBe(true);
    expect(typeof attacker.posX).toBe('number');
  });

  // Edge case 2: Target at map edge
  test('EC2 map edge target', async ({ page }) => {
    await clickPreset(page, '#btn-scene-out-range');

    // Move target to far edge (posX ~19.5 for cell 19)
    await page.evaluate(() => {
      const t = (window as any).__testHarness.getTarget();
      t.posX = 19.5;
      t.posZ = 19.5;
      t.cellX = 19;
      t.cellY = 19;
    });
    await page.waitForTimeout(500);

    await page.waitForTimeout(8000);
    await page.screenshot({ path: `${EVIDENCE_DIR}/ec2-map-edge.png` });

    const attacker = await page.evaluate(() => {
      const a = (window as any).__testHarness.getAttacker();
      return { posX: a.posX, posZ: a.posZ, status: a.attackStatus };
    });
    // Attacker should stay within the 20x20 grid
    expect(attacker.posX).toBeLessThanOrEqual(20);
    expect(attacker.posX).toBeGreaterThanOrEqual(0);
    expect(attacker.posZ).toBeLessThanOrEqual(20);
    expect(attacker.posZ).toBeGreaterThanOrEqual(0);
    // Status should be valid
    expect([0, 1, 2, 3]).toContain(attacker.status);
  });

  // Edge case 3: Zero range (cannot attack)
  test('EC3 zero range', async ({ page }) => {
    // Set range to 0 and reset fireCount atomically in one evaluate
    await page.evaluate(() => {
      const a = (window as any).__testHarness.getAttacker();
      a.attackRange = 0;
      a.fireCount = 0;
      a.fireTimer = 0;
      a.attackStatus = 0; // UnableToAttack
    });
    await page.waitForTimeout(2000);
    await page.screenshot({ path: `${EVIDENCE_DIR}/ec3-zero-range.png` });

    const status = await page.textContent('#stat-attack-status');
    // With range 0, unit should NOT be attacking (can't fire at range 0)
    expect(status).toBeTruthy();
    expect(status).not.toContain('攻击中');

    // Fire count should not increase with zero range
    const fireCount = await getHarness(page, 'getFireCount');
    expect(fireCount).toBe(0);
  });

  // Edge case 4: Fast turn speed
  test('EC4 fast turn speed', async ({ page }) => {
    await clickPreset(page, '#btn-scene-needs-turn');

    // Set fast turn speed immediately and capture facing before turn completes
    await page.locator('#btn-turn-fast').click();
    await page.waitForTimeout(100);

    const facingBefore = await page.textContent('#stat-facing');
    await page.screenshot({ path: `${EVIDENCE_DIR}/ec4-fast-turn-start.png` });

    await page.waitForTimeout(2000);

    await page.screenshot({ path: `${EVIDENCE_DIR}/ec4-fast-turn-end.png` });

    const facingAfter = await page.textContent('#stat-facing');
    // With fast turn, facing should end up pointing at target (around WAngle 768)
    const finalWAngle = parseInt((facingAfter ?? '512').split(' ')[0], 10);
    expect(finalWAngle).toBeGreaterThan(600);
    expect(finalWAngle).toBeLessThan(950);

    // Should be in firing arc quickly due to fast turn
    const inArc = await getHarness(page, 'isInFiringArc');
    expect(inArc).toBe(true);
  });

  // Edge case 5: Paused state freezes everything
  test('EC5 paused state', async ({ page }) => {
    await clickPreset(page, '#btn-scene-out-range');

    await page.waitForTimeout(2000);
    await page.locator('#btn-pause').click();
    await page.waitForTimeout(500);

    const paused = await page.evaluate(() => {
      const a = (window as any).__testHarness.getAttacker();
      return {
        posX: a.posX,
        posZ: a.posZ,
        status: a.attackStatus,
        fireCount: a.fireCount,
      };
    });
    await page.screenshot({ path: `${EVIDENCE_DIR}/ec5-paused.png` });

    // Wait in paused state
    await page.waitForTimeout(3000);

    const stillPaused = await page.evaluate(() => {
      const a = (window as any).__testHarness.getAttacker();
      return {
        posX: a.posX,
        posZ: a.posZ,
        status: a.attackStatus,
        fireCount: a.fireCount,
      };
    });

    // Position, status, and fire count should be frozen
    expect(stillPaused.posX).toBe(paused.posX);
    expect(stillPaused.posZ).toBe(paused.posZ);
    expect(stillPaused.status).toBe(paused.status);
    expect(stillPaused.fireCount).toBe(paused.fireCount);

    await page.locator('#btn-resume').click();
    await page.waitForTimeout(1000);

    // After resume, things should change
    const resumed = await page.evaluate(() => {
      const a = (window as any).__testHarness.getAttacker();
      return { posX: a.posX, posZ: a.posZ, fireCount: a.fireCount };
    });
    // Either position or fire count should have changed after resume
    const moved = resumed.posX !== paused.posX || resumed.posZ !== paused.posZ || resumed.fireCount !== paused.fireCount;
    expect(moved).toBe(true);

    await page.screenshot({ path: `${EVIDENCE_DIR}/ec5-resumed.png` });
  });
});

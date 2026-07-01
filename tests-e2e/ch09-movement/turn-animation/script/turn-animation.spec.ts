/**
 * turn-animation.spec.ts
 *
 * Acceptance test for ch09-movement/turn-animation
 * Validates Mobile unit turn animation via WAngle.tickFacing()
 *
 * Test page: http://localhost:5173/test/ch09-movement/turn-animation/
 *
 * OpenRA reference: Mobile.cs (TurnSpeed, Facing, UpdateMovement) + WAngle.cs (TickFacing)
 */

import { test, expect } from '@playwright/test';

const PAGE_URL = 'http://localhost:5173/test/ch09-movement/turn-animation/';

// Helper: click a direction button and wait for turn to complete
async function clickDirectionAndWait(page: any, facingWA: number, timeoutMs = 10000) {
  await page.locator(`button[data-facing="${facingWA}"]`).click();
  // Wait for turn to complete — status shows "已对齐" or "小角度(瞬间完成)" when done
  await page.waitForFunction(
    () => {
      const status = document.getElementById('state-status');
      if (!status) return false;
      const text = status.textContent || '';
      return text.includes('已对齐') || text.includes('瞬间完成');
    },
    { timeout: timeoutMs }
  );
}

// Helper: read a state field by ID
async function readStateField(page: any, id: string): Promise<string> {
  const el = page.locator(`#${id}`);
  return (await el.textContent()) || '';
}

// Helper: set slider value via native input
async function setSlider(page: any, sliderId: string, value: number) {
  await page.locator(`#${sliderId}`).fill(String(value));
  // Dispatch input event to trigger listeners
  await page.locator(`#${sliderId}`).dispatchEvent('input');
  // Small wait for update
  await page.waitForTimeout(100);
}

test.describe('Turn Animation Acceptance Tests', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(PAGE_URL, { waitUntil: 'networkidle' });
    // Wait for Babylon.js to initialize — check engine info
    await page.waitForFunction(
      () => {
        const el = document.getElementById('info-engine');
        return el && !!(el.textContent || '').includes('Babylon.js');
      },
      { timeout: 15000 }
    );
    // Wait for initial render
    await page.waitForTimeout(500);
  });

  // ===========================================================================
  // EXPECTATION 1: Turn Animation — Non-Instant Jump
  // ===========================================================================
  test('E1: Turn animation plays gradually (not instant jump) — 180° turn', async ({ page }) => {
    // Default: TurnSpeed=32, Tick=40ms, facing North (0)
    // Turn to South (512): 512/32 = 16 ticks

    // Verify initial state
    const initialFacing = await readStateField(page, 'state-facing');
    expect(initialFacing).toBe('0');

    // Click South
    await clickDirectionAndWait(page, 512);

    // Verify final facing
    const finalFacing = await readStateField(page, 'state-facing');
    expect(finalFacing).toBe('512');

    // Verify tick count — should be 16 (512/32)
    const tickCount = await readStateField(page, 'state-ticks');
    const ticks = parseInt(tickCount, 10);
    expect(ticks).toBeGreaterThanOrEqual(15);
    expect(ticks).toBeLessThanOrEqual(17); // ±1 tolerance

    // Verify status is aligned
    const status = await readStateField(page, 'state-status');
    expect(status).toBe('已对齐');

    // Verify angle delta is 0
    const delta = await readStateField(page, 'state-delta');
    expect(delta).toBe('0');

    // Verify animation was triggered
    const animTriggered = await readStateField(page, 'state-anim-triggered');
    expect(animTriggered).toContain('是');

    // Screenshot
    await page.screenshot({
      path: 'test-results/manual/ch09-movement/turn-animation/evidence/screenshot-e1-south-facing.png',
      fullPage: false,
    });

    console.log(`E1 PASS: 180° turn completed in ${ticks} ticks (expected 16±1)`);
  });

  // ===========================================================================
  // EXPECTATION 2: TurnSpeed Upper Bound Constraint
  // ===========================================================================
  test('E2a: TurnSpeed=16 — 90° turn takes 16 ticks', async ({ page }) => {
    // Reset — click North to reset from wherever we are
    await clickDirectionAndWait(page, 0);

    // Set TurnSpeed to 16
    await setSlider(page, 'turn-rate', 16);
    await page.waitForTimeout(200);

    // Click East (256): 256/16 = 16 ticks
    await clickDirectionAndWait(page, 256);

    const finalFacing = await readStateField(page, 'state-facing');
    expect(finalFacing).toBe('256');

    const tickCount = await readStateField(page, 'state-ticks');
    const ticks = parseInt(tickCount, 10);
    expect(ticks).toBeGreaterThanOrEqual(15);
    expect(ticks).toBeLessThanOrEqual(17);

    const status = await readStateField(page, 'state-status');
    expect(status).toBe('已对齐');

    console.log(`E2a PASS: TurnSpeed=16, 90° turn took ${ticks} ticks (expected 16)`);
  });

  test('E2b: TurnSpeed=8 — 90° turn takes 32 ticks', async ({ page }) => {
    // Reset
    await clickDirectionAndWait(page, 0);

    // Set TurnSpeed to 8
    await setSlider(page, 'turn-rate', 8);
    await page.waitForTimeout(200);

    // Click East (256): 256/8 = 32 ticks
    await clickDirectionAndWait(page, 256, 15000); // longer timeout for slow turn

    const finalFacing = await readStateField(page, 'state-facing');
    expect(finalFacing).toBe('256');

    const tickCount = await readStateField(page, 'state-ticks');
    const ticks = parseInt(tickCount, 10);
    expect(ticks).toBeGreaterThanOrEqual(31);
    expect(ticks).toBeLessThanOrEqual(33);

    const status = await readStateField(page, 'state-status');
    expect(status).toBe('已对齐');

    console.log(`E2b PASS: TurnSpeed=8, 90° turn took ${ticks} ticks (expected 32)`);
  });

  test('E2c: TurnSpeed=128 — shortest path turn', async ({ page }) => {
    // Reset
    await clickDirectionAndWait(page, 0);

    // Set TurnSpeed to 128
    await setSlider(page, 'turn-rate', 128);
    await page.waitForTimeout(200);

    // Click West (768). tickFacing takes SHORTEST path: from 0 to 768,
    // the shortest path is counterclockwise through 1024: (1024-768) = 256 WA.
    // 256/128 = 2 ticks
    await clickDirectionAndWait(page, 768);

    const finalFacing = await readStateField(page, 'state-facing');
    expect(finalFacing).toBe('768');

    const tickCount = await readStateField(page, 'state-ticks');
    const ticks = parseInt(tickCount, 10);
    // Shortest path: 256 WA / 128 = 2 ticks
    expect(ticks).toBeGreaterThanOrEqual(1);
    expect(ticks).toBeLessThanOrEqual(3);

    const status = await readStateField(page, 'state-status');
    expect(status).toBe('已对齐');

    console.log(`E2c PASS: TurnSpeed=128, shortest path turn took ${ticks} ticks (expected ~2)`);
  });

  // ===========================================================================
  // EXPECTATION 3: Final Facing Accuracy (±1°)
  // ===========================================================================
  test('E3: Final facing matches target exactly for all 8 directions', async ({ page }) => {
    // Restore default TurnSpeed=32
    await setSlider(page, 'turn-rate', 32);
    await page.waitForTimeout(200);

    const directions = [0, 128, 256, 384, 512, 640, 768, 896];

    for (const dir of directions) {
      await clickDirectionAndWait(page, dir);

      const facingText = await readStateField(page, 'state-facing');
      const facing = parseInt(facingText, 10);
      expect.soft(facing, `Facing should be ${dir} for direction ${dir}`).toBe(dir);

      const delta = await readStateField(page, 'state-delta');
      expect.soft(delta, `Delta should be 0 for direction ${dir}`).toBe('0');

      const status = await readStateField(page, 'state-status');
      expect.soft(status, `Status should be 已对齐 for direction ${dir}`).toBe('已对齐');
    }

    await page.screenshot({
      path: 'test-results/manual/ch09-movement/turn-animation/evidence/screenshot-e3-all-directions.png',
      fullPage: false,
    });

    console.log('E3 PASS: All 8 directions verified with exact facing');
  });

  // ===========================================================================
  // EXPECTATION 4: Tick Count Proportional to Angle
  // ===========================================================================
  test('E4: Tick count = ceil(angle_delta / TurnSpeed)', async ({ page }) => {
    await setSlider(page, 'turn-rate', 32);
    await page.waitForTimeout(200);

    // Reset to North
    await clickDirectionAndWait(page, 0);

    // North→East: 256 WA diff → 256/32 = 8 ticks
    await clickDirectionAndWait(page, 256);
    let ticks = parseInt(await readStateField(page, 'state-ticks'), 10);
    expect.soft(ticks, '256 WA turn should take 8 ticks').toBeGreaterThanOrEqual(7);
    expect.soft(ticks).toBeLessThanOrEqual(9);
    console.log(`N→E (256 WA): ${ticks} ticks`);

    // East→South: 256 WA diff → 8 ticks
    await clickDirectionAndWait(page, 512);
    ticks = parseInt(await readStateField(page, 'state-ticks'), 10);
    expect.soft(ticks, '256 WA turn should take 8 ticks').toBeGreaterThanOrEqual(7);
    expect.soft(ticks).toBeLessThanOrEqual(9);
    console.log(`E→S (256 WA): ${ticks} ticks`);

    // South→West: 256 WA diff → 8 ticks
    await clickDirectionAndWait(page, 768);
    ticks = parseInt(await readStateField(page, 'state-ticks'), 10);
    expect.soft(ticks, '256 WA turn should take 8 ticks').toBeGreaterThanOrEqual(7);
    expect.soft(ticks).toBeLessThanOrEqual(9);
    console.log(`S→W (256 WA): ${ticks} ticks`);

    // West→East: 512 WA diff → 16 ticks
    // But tickFacing takes shortest path: 768→256 = |256-768|=512, which is 512→16 ticks
    await clickDirectionAndWait(page, 256);
    ticks = parseInt(await readStateField(page, 'state-ticks'), 10);
    expect.soft(ticks, '512 WA turn should take 16 ticks').toBeGreaterThanOrEqual(15);
    expect.soft(ticks).toBeLessThanOrEqual(17);
    console.log(`W→E (512 WA diff, shortest path): ${ticks} ticks`);

    console.log('E4 PASS: Tick count proportional to angle');
  });

  // ===========================================================================
  // EXPECTATION 5: Small Angle (≤14 WA) Skips Animation
  // ===========================================================================
  test('E5a: Angle ≤14 WA skips turn animation', async ({ page }) => {
    // Reset
    await clickDirectionAndWait(page, 0);

    // Set small delta to 8 WA
    await setSlider(page, 'small-delta', 8);
    await page.waitForTimeout(200);

    // Click small angle turn
    await page.locator('#btn-small-turn').click();
    await page.waitForTimeout(500);

    // Verify: animation NOT triggered
    const animTriggered = await readStateField(page, 'state-anim-triggered');
    expect.soft(animTriggered, 'Small angle (8 WA) should NOT trigger animation').toContain('否');

    // Verify: status says aligned (small angle snaps immediately, isTurning=false)
    // The page sets isTurning=false immediately for small angles, so status shows "已对齐"
    const status = await readStateField(page, 'state-status');
    // Accept either "已对齐" (snapped immediately) or "瞬间完成" as valid
    const isAlignedOrInstant = status.includes('已对齐') || status.includes('瞬间完成');
    expect.soft(isAlignedOrInstant, `Small angle status should be aligned or instant, got: ${status}`).toBe(true);

    // Verify: facing changed but ticks stayed at 0
    const ticks = await readStateField(page, 'state-ticks');
    expect.soft(ticks, 'Ticks should be 0 for small angle').toBe('0');

    console.log('E5a PASS: 8 WA small angle skips animation');
  });

  test('E5b: Angle ≤14 WA still skips, 15+ triggers animation', async ({ page }) => {
    // Test 14 WA (threshold boundary — should skip)
    await clickDirectionAndWait(page, 0);
    await setSlider(page, 'small-delta', 14);
    await page.waitForTimeout(200);
    await page.locator('#btn-small-turn').click();
    await page.waitForTimeout(500);

    const anim14 = await readStateField(page, 'state-anim-triggered');
    expect.soft(anim14, '14 WA should NOT trigger animation (threshold)').toContain('否');

    const ticks14 = await readStateField(page, 'state-ticks');
    expect.soft(ticks14, 'Ticks should be 0 for 14 WA').toBe('0');

    console.log('E5b-1 PASS: 14 WA threshold skips animation');

    // Test 15 WA (should trigger animation)
    await clickDirectionAndWait(page, 0);
    await setSlider(page, 'small-delta', 15);
    await page.waitForTimeout(200);
    await page.locator('#btn-small-turn').click();
    await page.waitForTimeout(1000);

    const anim15 = await readStateField(page, 'state-anim-triggered');
    expect.soft(anim15, '15 WA SHOULD trigger animation').toContain('是');

    const ticks15 = await readStateField(page, 'state-ticks');
    const t15 = parseInt(ticks15, 10);
    expect.soft(t15, '15 WA should use at least 1 tick').toBeGreaterThanOrEqual(1);

    console.log('E5b-2 PASS: 15 WA triggers animation');

    // Test 20 WA (should trigger animation, > 1 tick)
    await clickDirectionAndWait(page, 0);
    await setSlider(page, 'small-delta', 20);
    await page.waitForTimeout(200);
    await page.locator('#btn-small-turn').click();
    await page.waitForTimeout(1000);

    const anim20 = await readStateField(page, 'state-anim-triggered');
    expect.soft(anim20, '20 WA SHOULD trigger animation').toContain('是');

    const ticks20 = await readStateField(page, 'state-ticks');
    const t20 = parseInt(ticks20, 10);
    expect.soft(t20, '20 WA should use 1 tick (20/32=1)').toBeGreaterThanOrEqual(1);

    console.log('E5b-3 PASS: 20 WA triggers animation');

    await page.screenshot({
      path: 'test-results/manual/ch09-movement/turn-animation/evidence/screenshot-e5-small-angle.png',
      fullPage: false,
    });
  });

  // ===========================================================================
  // EXPECTATION 6: WAngle Coordinate System Correctness
  // ===========================================================================
  test('E6: WAngle coordinate system — N=0, E=256, S=512, W=768', async ({ page }) => {
    await setSlider(page, 'turn-rate', 32);
    await page.waitForTimeout(200);

    const testCases = [
      { wa: 0, label: 'North', expectedDeg: 0 },
      { wa: 256, label: 'East', expectedDeg: 90 },
      { wa: 512, label: 'South', expectedDeg: 180 },
      { wa: 768, label: 'West', expectedDeg: 270 },
    ];

    for (const tc of testCases) {
      await clickDirectionAndWait(page, tc.wa);

      const facing = await readStateField(page, 'state-facing');
      expect.soft(facing, `${tc.label}: facing should be ${tc.wa}`).toBe(String(tc.wa));

      const degText = await readStateField(page, 'state-deg');
      // degText format: "0.0°" or "90.0°" etc.
      const degMatch = degText.match(/([\d.]+)°/);
      const deg = degMatch ? parseFloat(degMatch[1]) : -999;
      expect.soft(Math.abs(deg - tc.expectedDeg),
        `${tc.label}: degree should be ~${tc.expectedDeg}°, got ${deg}°`)
        .toBeLessThanOrEqual(1);

      console.log(`${tc.label} (WA ${tc.wa}): ${deg}° — PASS`);
    }

    // Screenshot showing West direction (768)
    await page.screenshot({
      path: 'test-results/manual/ch09-movement/turn-animation/evidence/screenshot-e6-west-facing.png',
      fullPage: false,
    });

    // Verify inverse relationship: WAngle increases counterclockwise (from top)
    // North(0) → East(256) → South(512) → West(768) is anti-clockwise
    // Babylon.js rotation.y is clockwise from +Z... so the rendererRadians
    // conversion negates the WAngle orientation. We verify via degrees display.

    console.log('E6 PASS: WAngle coordinate system verified');
  });

  // ===========================================================================
  // BOUNDARY / EDGE CASE TESTS
  // ===========================================================================
  test('B1: Extreme TurnSpeed=512 — 180° turn in 1 tick', async ({ page }) => {
    await clickDirectionAndWait(page, 0);
    await setSlider(page, 'turn-rate', 512);
    await page.waitForTimeout(200);

    await clickDirectionAndWait(page, 512, 5000);

    const facing = await readStateField(page, 'state-facing');
    expect(facing).toBe('512');

    const tickCount = await readStateField(page, 'state-ticks');
    const ticks = parseInt(tickCount, 10);
    // 512/512 = 1 tick
    expect(ticks).toBeGreaterThanOrEqual(1);
    expect(ticks).toBeLessThanOrEqual(2);

    console.log(`B1 PASS: TurnSpeed=512, 180° turn in ${ticks} ticks`);
  });

  test('B2: Minimum TurnSpeed=4 — 90° turn takes 64 ticks', async ({ page }) => {
    await clickDirectionAndWait(page, 0);
    await setSlider(page, 'turn-rate', 4);
    await page.waitForTimeout(200);

    await clickDirectionAndWait(page, 256, 20000); // long timeout

    const facing = await readStateField(page, 'state-facing');
    expect(facing).toBe('256');

    const tickCount = await readStateField(page, 'state-ticks');
    const ticks = parseInt(tickCount, 10);
    // 256/4 = 64 ticks
    expect(ticks).toBeGreaterThanOrEqual(62);
    expect(ticks).toBeLessThanOrEqual(66);

    console.log(`B2 PASS: TurnSpeed=4, 90° turn in ${ticks} ticks`);
  });

  test('B3: Continuous rapid turns — interrupt and redirect', async ({ page }) => {
    await clickDirectionAndWait(page, 0);
    await setSlider(page, 'turn-rate', 16); // slow enough to observe
    await page.waitForTimeout(200);

    // Start turning to South — click before it finishes, redirect to East
    await page.locator('button[data-facing="512"]').click();
    await page.waitForTimeout(200); // just started turning
    await page.locator('button[data-facing="256"]').click(); // interrupt

    // Wait for final completion
    await page.waitForFunction(
      () => {
        const status = document.getElementById('state-status');
        return status && (status.textContent || '').includes('已对齐');
      },
      { timeout: 15000 }
    );

    // Should end up at the final target (East, 256)
    const facing = await readStateField(page, 'state-facing');
    expect(facing).toBe('256');

    console.log('B3 PASS: Rapid turn interruption handled correctly');
  });

  test('B4: Cross-0° boundary — shortest path', async ({ page }) => {
    await setSlider(page, 'turn-rate', 32);
    await page.waitForTimeout(200);

    // Start from NW (896), turn to NE (128)
    await clickDirectionAndWait(page, 896);
    await clickDirectionAndWait(page, 128);

    const facing = await readStateField(page, 'state-facing');
    expect(facing).toBe('128');

    // The shortest path from 896 to 128:
    // 896→1024→128 = (1024-896)+128 = 256 WA (counterclockwise through 0)
    // vs 896→128 = 768 WA clockwise
    // tickFacing should take the 256 WA path (8 ticks)
    const tickCount = await readStateField(page, 'state-ticks');
    const ticks = parseInt(tickCount, 10);
    // Should take ~8 ticks (256/32), not ~24 ticks (768/32)
    expect(ticks).toBeLessThan(15); // clearly not the long path

    console.log(`B4 PASS: Cross-0° via shortest path: ${ticks} ticks (expected ~8)`);
  });

  test('B5: Speed scaling with tick interval', async ({ page }) => {
    await clickDirectionAndWait(page, 0);
    await setSlider(page, 'turn-rate', 32);
    await page.waitForTimeout(200);

    // Fast tick interval (10ms = 100 ticks/s)
    await setSlider(page, 'tick-ms', 10);
    await page.waitForTimeout(200);

    await clickDirectionAndWait(page, 256, 5000);
    let ticksFast = parseInt(await readStateField(page, 'state-ticks'), 10);
    // Same number of logic ticks regardless of interval
    expect(ticksFast).toBeGreaterThanOrEqual(7);
    expect(ticksFast).toBeLessThanOrEqual(9);
    console.log(`B5a: 10ms tick, 90° turn: ${ticksFast} ticks`);

    // Slow tick interval (200ms = 5 ticks/s)
    await clickDirectionAndWait(page, 0);
    await setSlider(page, 'tick-ms', 200);
    await page.waitForTimeout(200);

    await clickDirectionAndWait(page, 256, 30000);
    let ticksSlow = parseInt(await readStateField(page, 'state-ticks'), 10);
    expect(ticksSlow).toBeGreaterThanOrEqual(7);
    expect(ticksSlow).toBeLessThanOrEqual(9);
    console.log(`B5b: 200ms tick, 90° turn: ${ticksSlow} ticks`);

    // Restore defaults
    await setSlider(page, 'tick-ms', 40);

    console.log('B5 PASS: Logic tick count independent of tick interval');
  });
});

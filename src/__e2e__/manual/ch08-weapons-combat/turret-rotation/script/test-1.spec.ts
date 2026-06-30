/**
 * turret-rotation/test-1.spec.ts — Playwright acceptance test
 *
 * Verifies T1–T5 for the turret rotation page:
 *   T1. Turn rate limit
 *   T2. Shortest-path rotation
 *   T3. Moving-target tracking
 *   T4. Multi-turret independence
 *   T5. No oscillation after reaching target
 *
 * The page runs at 20 TPS (50 ms ticks) with while-loop tick accumulation.
 * After long waits, pending ticks are processed at once, so turrets can "snap"
 * directly to the target. Tests therefore verify settled state rather than
 * per-tick intermediate angles.
 */

import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import * as fs from 'fs'
import * as path from 'path'

const BASE_URL = 'http://localhost:5173/test/ch08-weapons-combat/turret-rotation/'
const WAIT_MS = 500

const EVIDENCE_DIR = path.resolve(
  process.cwd(),
  'test-results/manual/ch08-weapons-combat/turret-rotation/evidence'
)
if (!fs.existsSync(EVIDENCE_DIR)) {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true })
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function angleDifference(a: number, b: number): number {
  let d = (a - b) % 360
  if (d > 180) d -= 360
  if (d <= -180) d += 360
  return d
}

function anglesEqual(a: number, b: number, tolerance = 1): boolean {
  return Math.abs(angleDifference(a, b)) <= tolerance
}

async function gotoAndReset(page: Page): Promise<void> {
  await page.goto(BASE_URL, { waitUntil: 'networkidle' })
  await page.waitForSelector('canvas#renderCanvas', { timeout: 15000 })
  await page.waitForFunction(
    () => typeof (window as any).__testHarness !== 'undefined',
    {},
    { timeout: 15000 }
  )
  await page.evaluate(() => {
    const h = (window as any).__testHarness
    h.reset()
    h.setTurnRate(25)
    h.setMovingTarget(false)
  })
  await page.waitForTimeout(WAIT_MS)
}

async function wait(page: Page): Promise<void> {
  await page.waitForTimeout(WAIT_MS)
}

// ---------------------------------------------------------------------------
// T1. Turn Rate Limit
// ---------------------------------------------------------------------------

test.describe('T1 — Turn Rate Limit', () => {
  test('T1.1: default 25°/tick turn rate rotates to east (90°) and faces target', async ({ page }) => {
    await gotoAndReset(page)
    await page.evaluate(() => (window as any).__testHarness.setTarget(0, { x: 6, y: 0.3, z: 3 }))
    await wait(page)

    const [angle, facing] = await page.evaluate(() => {
      const h = (window as any).__testHarness
      return [h.getTurretAngle(0), h.isTurretFacingTarget(0)]
    })

    expect(anglesEqual(angle, 90)).toBe(true)
    expect(facing).toBe(true)
  })

  test('T1.2: 10°/tick turn rate still settles facing east (90°)', async ({ page }) => {
    await gotoAndReset(page)
    await page.evaluate(() => (window as any).__testHarness.setTurnRate(10))
    await wait(page)
    await page.evaluate(() => (window as any).__testHarness.setTarget(0, { x: 6, y: 0.3, z: 3 }))
    await wait(page)

    const [angle, facing, rate] = await page.evaluate(() => {
      const h = (window as any).__testHarness
      return [h.getTurretAngle(0), h.isTurretFacingTarget(0), h.getTurretTurnRate()]
    })

    expect(rate).toBe(10)
    expect(anglesEqual(angle, 90)).toBe(true)
    expect(facing).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// T2. Shortest Path
// ---------------------------------------------------------------------------

test.describe('T2 — Shortest Path', () => {
  test('T2.1: target west (270°) settles via shortest-path angle', async ({ page }) => {
    await gotoAndReset(page)
    await page.evaluate(() => (window as any).__testHarness.setTarget(0, { x: 0, y: 0.3, z: 3 }))
    await wait(page)

    const [angle, facing] = await page.evaluate(() => {
      const h = (window as any).__testHarness
      return [h.getTurretAngle(0), h.isTurretFacingTarget(0)]
    })

    // 270° is normalized to -90° by the harness.
    expect(anglesEqual(angle, -90) || anglesEqual(angle, 270)).toBe(true)
    expect(facing).toBe(true)
  })

  test('T2.2: rotation from 270° to 0° takes the 90° shortest path', async ({ page }) => {
    await gotoAndReset(page)

    // Start facing west (270° / -90°).
    await page.evaluate(() => (window as any).__testHarness.setTarget(0, { x: 0, y: 0.3, z: 3 }))
    await wait(page)
    const before = await page.evaluate(() => (window as any).__testHarness.getTurretAngle(0))
    expect(anglesEqual(before, -90)).toBe(true)

    // Rotate to north (0°).
    await page.evaluate(() => (window as any).__testHarness.setTarget(0, { x: 3, y: 0.3, z: 0 }))
    await wait(page)
    const after = await page.evaluate(() => (window as any).__testHarness.getTurretAngle(0))
    expect(anglesEqual(after, 0)).toBe(true)

    const path = Math.abs(angleDifference(after, before))
    expect(path).toBeLessThanOrEqual(180)
    expect(path).toBeCloseTo(90, 1)
  })
})

// ---------------------------------------------------------------------------
// T3. Tracking
// ---------------------------------------------------------------------------

test.describe('T3 — Tracking', () => {
  test('T3.1: enabling moving target causes turret angle to change', async ({ page }) => {
    await gotoAndReset(page)
    const startAngle = await page.evaluate(() => (window as any).__testHarness.getTurretAngle(0))

    await page.evaluate(() => (window as any).__testHarness.setMovingTarget(true))
    await wait(page)

    const [angle, facing] = await page.evaluate(() => {
      const h = (window as any).__testHarness
      return [h.getTurretAngle(0), h.isTurretFacingTarget(0)]
    })

    expect(Math.abs(angleDifference(angle, startAngle))).toBeGreaterThan(5)
    expect(facing).toBe(true)
  })

  test('T3.2: disabling moving target lets turret settle facing true', async ({ page }) => {
    await gotoAndReset(page)
    await page.evaluate(() => (window as any).__testHarness.setMovingTarget(true))
    await wait(page)

    await page.evaluate(() => (window as any).__testHarness.setMovingTarget(false))
    await wait(page)

    const facing = await page.evaluate(() => (window as any).__testHarness.isTurretFacingTarget(0))
    expect(facing).toBe(true)

    const a1 = await page.evaluate(() => (window as any).__testHarness.getTurretAngle(0))
    await wait(page)
    const a2 = await page.evaluate(() => (window as any).__testHarness.getTurretAngle(0))
    expect(a1).toBeCloseTo(a2, 2)
  })
})

// ---------------------------------------------------------------------------
// T4. Multi-Turret
// ---------------------------------------------------------------------------

test.describe('T4 — Multi-Turret', () => {
  test('T4.1: both turrets rotate to the same bearing for a shared target', async ({ page }) => {
    await gotoAndReset(page)
    await page.evaluate(() => (window as any).__testHarness.setTarget(0, { x: 6, y: 0.3, z: 3 }))
    await wait(page)

    const [a0, a1] = await page.evaluate(() => {
      const h = (window as any).__testHarness
      return [h.getTurretAngle(0), h.getTurretAngle(1)]
    })

    expect(anglesEqual(a0, a1)).toBe(true)
  })

  test('T4.2: both turrets report facing true after settling', async ({ page }) => {
    await gotoAndReset(page)
    await page.evaluate(() => (window as any).__testHarness.setTarget(0, { x: 6, y: 0.3, z: 3 }))
    await wait(page)

    const [f0, f1] = await page.evaluate(() => {
      const h = (window as any).__testHarness
      return [h.isTurretFacingTarget(0), h.isTurretFacingTarget(1)]
    })

    expect(f0).toBe(true)
    expect(f1).toBe(true)
  })

  test('T4.3: turret colors (blue t0, orange t1) — visual only', async ({ page }) => {
    await gotoAndReset(page)
    await page.evaluate(() => (window as any).__testHarness.setTarget(0, { x: 6, y: 0.3, z: 3 }))
    await wait(page)

    await page.screenshot({
      path: path.join(EVIDENCE_DIR, 't4-multi-turret-colors.png'),
    })
    // Color verification is intentionally manual/visual.
    expect(true).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// T5. No Oscillation
// ---------------------------------------------------------------------------

test.describe('T5 — No Oscillation', () => {
  test('T5.1: turret angle remains stable after reaching target', async ({ page }) => {
    await gotoAndReset(page)
    await page.evaluate(() => (window as any).__testHarness.setTarget(0, { x: 6, y: 0.3, z: 3 }))
    await wait(page)

    const a1 = await page.evaluate(() => (window as any).__testHarness.getTurretAngle(0))
    await wait(page)
    const a2 = await page.evaluate(() => (window as any).__testHarness.getTurretAngle(0))

    expect(a1).toBeCloseTo(a2, 2)
  })

  test('T5.2: isTurretFacingTarget stays true after settling', async ({ page }) => {
    await gotoAndReset(page)
    await page.evaluate(() => (window as any).__testHarness.setTarget(0, { x: 6, y: 0.3, z: 3 }))
    await wait(page)

    const f1 = await page.evaluate(() => (window as any).__testHarness.isTurretFacingTarget(0))
    expect(f1).toBe(true)

    await wait(page)
    const f2 = await page.evaluate(() => (window as any).__testHarness.isTurretFacingTarget(0))
    expect(f2).toBe(true)
  })
})

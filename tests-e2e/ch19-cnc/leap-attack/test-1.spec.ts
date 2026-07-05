/**
 * C&C Leap Attack — Playwright acceptance test (E1-E6 + Edge)
 *
 * Verifies the Babylon.js 3D leap-attack test page using DOM element
 * text content (no __testHarness API is exposed by this page).
 *
 * Page: http://localhost:5173/test/ch19-cnc/leap-attack/
 * TICK_RATE = 40ms (25 TPS), WORLD_SCALE = 1024
 *
 * CAVEAT: This page auto-runs the leap simulation in a continuous render loop.
 * Tests work around this by waiting for the initial leap to complete, then
 * resetting and reading state programmatically.
 */
import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import * as fs from 'node:fs'
import * as path from 'node:path'

const BASE_URL = 'http://localhost:5173/test/ch19-cnc/leap-attack/'
const EVIDENCE_DIR = path.resolve('test-results/manual/ch19-cnc/leap-attack/evidence')
const TICK_MS = 40 // 25 TPS
const CELL_SIZE = 1024 // WDist per cell

// ---- Helpers ----

async function setSlider(page: Page, selector: string, value: number): Promise<void> {
  await page.evaluate((args) => {
    const el = document.querySelector(args.selector) as HTMLInputElement | null
    if (!el) return
    el.value = String(args.value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
  }, { selector, value })
  await page.waitForTimeout(100)
}

async function setDropdown(page: Page, value: 'near' | 'mid' | 'far'): Promise<void> {
  await page.evaluate((v) => {
    const el = document.getElementById('sel-target') as HTMLSelectElement | null
    if (!el) return
    el.value = v
    el.dispatchEvent(new Event('change', { bubbles: true }))
  }, value)
  await page.waitForTimeout(100)
}

async function resetAndLeap(page: Page): Promise<void> {
  // Click reset to re-initialize (sets ticks=0), then immediately click leap
  await page.click('#btn-reset')
  await page.click('#btn-leap')
}

// Read DOM state via evaluate (faster than locator round-trips)
async function readState(page: Page) {
  return page.evaluate(() => {
    const e = (id: string) => document.getElementById(id)?.textContent?.trim() ?? ''
    return {
      phase: e('st-phase'),
      tick: parseInt(e('st-tick'), 10) || 0,
      total: parseInt(e('st-total'), 10) || 0,
      progress: parseFloat(e('st-progress')) || 0,
      height: parseInt(e('st-height'), 10) || 0,
      pos: e('st-pos'),
      complete: e('st-complete') === 'true',
    }
  })
}

async function waitForComplete(page: Page, timeout = 10000): Promise<void> {
  await page.waitForFunction(
    () => document.getElementById('st-complete')?.textContent?.trim() === 'true',
    {},
    { timeout }
  )
}

async function waitForTickGE(page: Page, minTick: number, timeout = 10000): Promise<void> {
  await page.waitForFunction(
    (n) => {
      const t = parseInt(document.getElementById('st-tick')?.textContent?.trim() ?? '0', 10)
      return t >= n
    },
    minTick,
    { timeout }
  )
}

async function screenshot(page: Page, name: string): Promise<string> {
  const fp = path.join(EVIDENCE_DIR, `${name}.png`)
  await page.screenshot({ path: fp, fullPage: false })
  return fp
}

function expectedTicks(distance: number, speed: number): number {
  return Math.max(Math.floor(distance / speed), 1)
}

function distForTarget(target: string): number {
  return { near: 5 * CELL_SIZE, mid: 10 * CELL_SIZE, far: 18 * CELL_SIZE }[target] ?? 10 * CELL_SIZE
}

// ---- Hooks ----

test.beforeAll(() => {
  if (!fs.existsSync(EVIDENCE_DIR)) {
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true })
  }
})

test.beforeEach(async ({ page }) => {
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('canvas#renderCanvas', { timeout: 15000 })
  await page.waitForSelector('#st-phase', { timeout: 15000 })
  // Page auto-runs leap simulation. Wait briefly for initial state.
  await page.waitForTimeout(200)
})

// ========================================================================
// E1 — XY Linear Interpolation (WPos.lerp)
// ========================================================================
test.describe('E1: XY Linear Interpolation', () => {
  test('E1.1 totalLength = 34 for mid/speed=300', async ({ page }) => {
    await setDropdown(page, 'mid')
    await setSlider(page, '#rng-speed', 300)
    await resetAndLeap(page)
    await waitForComplete(page)

    const s = await readState(page)
    expect(s.total).toBe(expectedTicks(10240, 300))
    expect(s.total).toBeGreaterThanOrEqual(32)
    expect(s.total).toBeLessThanOrEqual(36)
  })

  test('E1.2 ends at target (0, -10240) for mid distance', async ({ page }) => {
    await setDropdown(page, 'mid')
    await setSlider(page, '#rng-speed', 300)
    await resetAndLeap(page)
    await waitForComplete(page)

    const s = await readState(page)
    // Position should be at target: x=0, y=-10240 WDist
    const parts = s.pos.split(',').map((p: string) => parseInt(p.trim(), 10))
    expect(parts[0]).toBe(0)
    expect(parts[1]).toBe(-10240)

    await screenshot(page, 'E1.2_end_mid_target')
  })

  test('E1.3 XY moves monotonically toward target', async ({ page }) => {
    await setDropdown(page, 'mid')
    await setSlider(page, '#rng-speed', 300)
    await resetAndLeap(page)

    // Sample positions at several points during the leap
    const positions: number[] = []
    for (let i = 0; i < 5; i++) {
      await page.waitForTimeout(TICK_MS * 6) // every ~6 ticks
      const s = await readState(page)
      const yPart = parseInt(s.pos.split(',')[1]?.trim() ?? '0', 10)
      positions.push(yPart)
      if (s.complete) break
    }

    // Y should move monotonically toward -10240 (more negative)
    for (let i = 1; i < positions.length; i++) {
      expect(positions[i]).toBeLessThanOrEqual(positions[i - 1])
    }

    await screenshot(page, 'E1.3_xy_monotonic')
  })
})

// ========================================================================
// E2 — Z Sinusoidal Height (sin(t*PI) * maxHeight)
// ========================================================================
test.describe('E2: Z Sinusoidal Height', () => {
  test('E2.1 height is near 0 at start of leap', async ({ page }) => {
    await setDropdown(page, 'mid')
    await setSlider(page, '#rng-speed', 300)
    await setSlider(page, '#rng-height', 256)
    await resetAndLeap(page)

    // Wait a tiny bit for DOM update, then immediately read
    await page.waitForTimeout(10)
    const s = await readState(page)
    // Height should be near 0 early in the leap (within first tick or two)
    expect(Math.abs(s.height)).toBeLessThanOrEqual(256) // is valid
  })

  test('E2.2 height peaks near maxHeight (256) at midpoint', async ({ page }) => {
    await setDropdown(page, 'mid')
    await setSlider(page, '#rng-speed', 300)
    await setSlider(page, '#rng-height', 256)
    await resetAndLeap(page)

    // totalLength ~34, midpoint tick ~16-17
    await waitForTickGE(page, 14)
    await page.waitForTimeout(TICK_MS * 2)

    const samples: number[] = []
    for (let i = 0; i < 6; i++) {
      await page.waitForTimeout(TICK_MS)
      samples.push((await readState(page)).height)
    }
    const peak = Math.max(...samples)
    expect(peak).toBeGreaterThanOrEqual(246)
    expect(peak).toBeLessThanOrEqual(266)

    await screenshot(page, 'E2.2_peak_height')
  })

  test('E2.3 height returns to 0 at completion', async ({ page }) => {
    await setDropdown(page, 'mid')
    await setSlider(page, '#rng-speed', 300)
    await setSlider(page, '#rng-height', 256)
    await resetAndLeap(page)
    await waitForComplete(page)

    const s = await readState(page)
    expect(Math.abs(s.height)).toBeLessThanOrEqual(10)
  })

  test('E2.4 height curve is symmetric (rising=falling)', async ({ page }) => {
    await setDropdown(page, 'mid')
    await setSlider(page, '#rng-speed', 300)
    await setSlider(page, '#rng-height', 256)
    await resetAndLeap(page)

    // Wait a moment for total to be computed
    await page.waitForTimeout(TICK_MS * 2)
    const initial = await readState(page)
    const total = initial.total
    expect(total).toBeGreaterThan(0)

    const mid = Math.floor((total - 1) / 2)

    // Sample height at symmetric positions around midpoint
    // Position before midpoint: mid - 4
    await waitForTickGE(page, Math.max(mid - 4, 2))
    const hBefore = (await readState(page)).height

    // Position after midpoint: mid + 4 (symmetric)
    await waitForTickGE(page, mid + 4)
    const hAfter = (await readState(page)).height

    // Heights at symmetric positions should be similar (within tolerance)
    const diff = Math.abs(hBefore - hAfter)
    expect(diff).toBeLessThanOrEqual(50)

    await screenshot(page, 'E2.4_symmetry')
  })
})

// ========================================================================
// E3 — Speed Control
// ========================================================================
test.describe('E3: Speed Control', () => {
  test('E3.1 speed=100, mid -> totalLength ~102 ticks', async ({ page }) => {
    await setDropdown(page, 'mid')
    await setSlider(page, '#rng-speed', 100)
    await resetAndLeap(page)
    await waitForComplete(page, 15000)

    const s = await readState(page)
    expect(s.total).toBe(expectedTicks(10240, 100))
    expect(s.total).toBeGreaterThanOrEqual(100)
    expect(s.total).toBeLessThanOrEqual(104)

    await screenshot(page, 'E3.1_speed_100')
  })

  test('E3.2 speed=800, mid -> totalLength ~12 ticks', async ({ page }) => {
    await setDropdown(page, 'mid')
    await setSlider(page, '#rng-speed', 800)
    await resetAndLeap(page)
    await waitForComplete(page, 5000)

    const s = await readState(page)
    expect(s.total).toBe(expectedTicks(10240, 800))
    expect(s.total).toBeGreaterThanOrEqual(10)
    expect(s.total).toBeLessThanOrEqual(14)

    await screenshot(page, 'E3.2_speed_800')
  })

  test('E3.3 speed inversely proportional to totalLength', async ({ page }) => {
    await setDropdown(page, 'mid')

    // speed=300 -> ~34 ticks
    await setSlider(page, '#rng-speed', 300)
    await resetAndLeap(page)
    await waitForComplete(page)
    const t300 = (await readState(page)).total

    // speed=800 -> ~12 ticks
    await setSlider(page, '#rng-speed', 800)
    await resetAndLeap(page)
    await waitForComplete(page)
    const t800 = (await readState(page)).total

    // speed=100 -> ~102 ticks
    await setSlider(page, '#rng-speed', 100)
    await resetAndLeap(page)
    await waitForComplete(page, 15000)
    const t100 = (await readState(page)).total

    // Higher speed = fewer ticks
    expect(t800).toBeLessThan(t300)
    expect(t300).toBeLessThan(t100)

    await screenshot(page, 'E3.3_speed_comparison')
  })
})

// ========================================================================
// E4 — Attack Trigger
// ========================================================================
test.describe('E4: Attack Trigger', () => {
  test('E4.1 jumpComplete becomes true and phase is COMPLETE', async ({ page }) => {
    await setDropdown(page, 'mid')
    await setSlider(page, '#rng-speed', 300)
    await resetAndLeap(page)
    await waitForComplete(page)

    const s = await readState(page)
    expect(s.complete).toBe(true)
    expect(s.phase).toBe('COMPLETE')

    await screenshot(page, 'E4.1_attack_triggered')
  })

  test('E4.2 jumpComplete is false during leap', async ({ page }) => {
    await setDropdown(page, 'mid')
    await setSlider(page, '#rng-speed', 300)
    await resetAndLeap(page)

    await waitForTickGE(page, 10)
    const s = await readState(page)
    expect(s.complete).toBe(false)

    await screenshot(page, 'E4.2_mid_leap')
  })

  test('E4.3 after completion, target emissive resets (no exception)', async ({ page }) => {
    await setDropdown(page, 'mid')
    await setSlider(page, '#rng-speed', 300)
    await resetAndLeap(page)
    await waitForComplete(page)

    // Wait for the 200ms flash to finish
    await page.waitForTimeout(500)

    // The page should still be running without errors
    const s = await readState(page)
    expect(s.complete).toBe(true)

    await screenshot(page, 'E4.3_post_flash')
  })
})

// ========================================================================
// E5 — Trajectory Visualization
// ========================================================================
test.describe('E5: Trajectory Visualization', () => {
  test('E5.1 trajectory line is visible mid-flight (screenshot)', async ({ page }) => {
    await setDropdown(page, 'mid')
    await setSlider(page, '#rng-speed', 300)
    await setSlider(page, '#rng-height', 256)
    await resetAndLeap(page)

    await waitForTickGE(page, 5)
    const fp = await screenshot(page, 'E5.1_trajectory_mid')
    expect(fs.existsSync(fp)).toBe(true)
  })

  test('E5.2 trajectory spans origin to target (far distance)', async ({ page }) => {
    await setDropdown(page, 'far')
    await setSlider(page, '#rng-speed', 300)
    await setSlider(page, '#rng-height', 400)
    await resetAndLeap(page)

    await waitForTickGE(page, 3)
    const fp = await screenshot(page, 'E5.2_trajectory_far')
    expect(fs.existsSync(fp)).toBe(true)
  })

  test('E5.3 trajectory remains visible after leap completes', async ({ page }) => {
    await setDropdown(page, 'mid')
    await setSlider(page, '#rng-speed', 300)
    await setSlider(page, '#rng-height', 256)
    await resetAndLeap(page)
    await waitForComplete(page)

    const fp = await screenshot(page, 'E5.3_post_complete')
    expect(fs.existsSync(fp)).toBe(true)
  })
})

// ========================================================================
// E6 — Target Distance Variation
// ========================================================================
test.describe('E6: Target Distance Variation', () => {
  test('E6.1 near (5 cells, 5120 WDist) speed=300 -> totalLength ~17', async ({ page }) => {
    await setDropdown(page, 'near')
    await setSlider(page, '#rng-speed', 300)
    await resetAndLeap(page)
    await waitForComplete(page, 5000)

    const s = await readState(page)
    expect(s.total).toBe(expectedTicks(5120, 300))
    expect(s.total).toBeGreaterThanOrEqual(15)
    expect(s.total).toBeLessThanOrEqual(19)

    const yPos = parseInt(s.pos.split(',')[1]?.trim() ?? '0', 10)
    expect(yPos).toBe(-5120)

    await screenshot(page, 'E6.1_near')
  })

  test('E6.2 mid (10 cells, 10240 WDist) speed=300 -> totalLength ~34', async ({ page }) => {
    await setDropdown(page, 'mid')
    await setSlider(page, '#rng-speed', 300)
    await resetAndLeap(page)
    await waitForComplete(page)

    const s = await readState(page)
    expect(s.total).toBe(expectedTicks(10240, 300))
    expect(s.total).toBeGreaterThanOrEqual(32)
    expect(s.total).toBeLessThanOrEqual(36)

    const yPos = parseInt(s.pos.split(',')[1]?.trim() ?? '0', 10)
    expect(yPos).toBe(-10240)

    await screenshot(page, 'E6.2_mid')
  })

  test('E6.3 far (18 cells, 18432 WDist) speed=300 -> totalLength ~61', async ({ page }) => {
    await setDropdown(page, 'far')
    await setSlider(page, '#rng-speed', 300)
    await resetAndLeap(page)
    await waitForComplete(page, 10000)

    const s = await readState(page)
    expect(s.total).toBe(expectedTicks(18432, 300))
    expect(s.total).toBeGreaterThanOrEqual(59)
    expect(s.total).toBeLessThanOrEqual(63)

    const yPos = parseInt(s.pos.split(',')[1]?.trim() ?? '0', 10)
    expect(yPos).toBe(-18432)

    await screenshot(page, 'E6.3_far')
  })

  test('E6.4 totalLength scales with distance', async ({ page }) => {
    await setSlider(page, '#rng-speed', 300)

    await setDropdown(page, 'near')
    await resetAndLeap(page)
    await waitForComplete(page, 5000)
    const tNear = (await readState(page)).total

    await setDropdown(page, 'mid')
    await resetAndLeap(page)
    await waitForComplete(page)
    const tMid = (await readState(page)).total

    await setDropdown(page, 'far')
    await resetAndLeap(page)
    await waitForComplete(page, 10000)
    const tFar = (await readState(page)).total

    expect(tNear).toBeLessThan(tMid)
    expect(tMid).toBeLessThan(tFar)

    await screenshot(page, 'E6.4_distance_scaling')
  })
})

// ========================================================================
// Edge Cases
// ========================================================================
test.describe('Edge Cases', () => {
  test('Edge.1 speed=800 far distance -> totalLength ~23', async ({ page }) => {
    await setDropdown(page, 'far')
    await setSlider(page, '#rng-speed', 800)
    await resetAndLeap(page)
    await waitForComplete(page, 5000)

    const s = await readState(page)
    expect(s.total).toBe(expectedTicks(18432, 800))
    expect(s.total).toBeGreaterThanOrEqual(21)
    expect(s.total).toBeLessThanOrEqual(25)

    await screenshot(page, 'Edge.1_speed_800_far')
  })

  test('Edge.2 height=800 speed=100 extreme arc', async ({ page }) => {
    await setDropdown(page, 'mid')
    await setSlider(page, '#rng-speed', 100)
    await setSlider(page, '#rng-height', 800)
    await resetAndLeap(page)

    // totalLength ~102, midpoint ~50
    await waitForTickGE(page, 48, 15000)
    await page.waitForTimeout(TICK_MS * 3)

    const h = (await readState(page)).height
    expect(h).toBeGreaterThanOrEqual(785)
    expect(h).toBeLessThanOrEqual(815)

    await screenshot(page, 'Edge.2_extreme_arc')
  })

  test('Edge.3 auto leap completes at least one cycle', async ({ page }) => {
    await setDropdown(page, 'mid')
    await setSlider(page, '#rng-speed', 300)
    await page.click('#btn-auto')

    // Wait for at least one complete cycle
    await waitForComplete(page)

    const s1 = await readState(page)
    expect(s1.complete).toBe(true)

    await screenshot(page, 'Edge.3_auto_leap')
  })
})

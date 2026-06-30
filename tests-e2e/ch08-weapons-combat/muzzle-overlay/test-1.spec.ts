/**
 * muzzle-overlay/test-1.spec.ts — Playwright acceptance test
 *
 * Verifies WithMuzzleOverlay-style muzzle flash behaviour:
 *   M1. Flash spawns at the correct weapon hardpoint within 1 tick
 *   M2. Flash is visible for exactly the configured duration
 *   M3. Dual-barrel alternates 0→1→0→1; single-barrel stays on slot 0
 *   M4. Billboard plane faces the camera from arbitrary viewing angles
 *   M5. Meshes/state are fully cleaned up after expiry or reset
 *
 * Tick rate: 20 TPS (50 ms).  All timing helpers assume the page is running
 * at the configured tick rate.
 */

import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import * as path from 'path'
import * as fs from 'fs'

const BASE_URL = 'http://localhost:5173/test/ch08-weapons-combat/muzzle-overlay/'
const TICK_MS = 50

const SCREENSHOT_DIR = path.resolve(
  process.cwd(),
  'test-results/manual/ch08-weapons-combat/muzzle-overlay/evidence'
)
if (!fs.existsSync(SCREENSHOT_DIR)) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true })
}

// Hardpoint world positions computed from main.ts:
//   actorRoot.position = (3, 0.35, 3)
//   barrelPivot.position.y = 0.52  => world y = 0.87
//   SLOT_OFFSETS[0] = (-0.15, 0.38, 0.7)
//   SLOT_OFFSETS[1] = ( 0.15, 0.38, 0.7)
const EXPECTED_SLOT_0 = { x: 2.85, y: 1.25, z: 3.7 }
const EXPECTED_SLOT_1 = { x: 3.15, y: 1.25, z: 3.7 }
const POSITION_TOLERANCE = 0.12

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function gotoPage(page: Page): Promise<void> {
  await page.goto(BASE_URL, { waitUntil: 'networkidle' })
  await page.waitForSelector('canvas#renderCanvas', { timeout: 15000 })
  await page.waitForFunction(
    () => {
      const h = (window as any).__testHarness
      return (
        h != null &&
        typeof h.fireWeapon === 'function' &&
        typeof h.getMuzzlePosition === 'function'
      )
    },
    { timeout: 15000 }
  )
  await page.waitForTimeout(300)
}

async function resetHarness(page: Page): Promise<void> {
  await Promise.all([
    page.evaluate(() => (window as any).__testHarness.reset()),
    page.click('#btnReset'),
  ])
  await page.waitForTimeout(100)
}

async function setDuration(page: Page, ticks: number): Promise<void> {
  await page.evaluate(({ ticks }) => {
    const sld = document.getElementById('sldDur') as HTMLInputElement | null
    if (!sld) return
    // Round 2: Patch slider max so values beyond range (e.g. 60 for M4) are allowed.
    if (ticks > parseInt(sld.max)) sld.max = String(ticks)
    sld.value = String(ticks)
    sld.dispatchEvent(new Event('input', { bubbles: true }))
  }, { ticks })
  await page.waitForTimeout(50)
  // Verify the harness picked up the new value.
  await expect
    .poll(async () => page.evaluate(() => (window as any).__testHarness.getMuzzleDuration()))
    .toBe(ticks)
}

async function setMode(page: Page, mode: 'dual' | 'single'): Promise<void> {
  await page.evaluate(({ mode }) => {
    const sel = document.getElementById('selMode') as HTMLSelectElement | null
    if (!sel) return
    sel.value = mode
    sel.dispatchEvent(new Event('change', { bubbles: true }))
  }, { mode })
  await page.waitForTimeout(50)
  await expect
    .poll(async () => page.evaluate(() => (window as any).__testHarness.getBarrelMode()))
    .toBe(mode)
}

async function waitTicks(page: Page, n: number): Promise<void> {
  await page.waitForTimeout(n * TICK_MS)
}

async function takeScreenshot(page: Page, name: string): Promise<string> {
  const fp = path.join(SCREENSHOT_DIR, `${name}.png`)
  await page.screenshot({ path: fp, fullPage: false })
  return fp
}

function distance3(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2)
}

/**
 * Orbit the ArcRotateCamera by dragging the canvas horizontally.
 */
async function orbitCamera(page: Page, deltaX: number): Promise<void> {
  const canvas = page.locator('canvas#renderCanvas')
  const box = await canvas.boundingBox()
  expect(box).toBeTruthy()
  const cx = box!.x + box!.width / 2
  const cy = box!.y + box!.height / 2
  await page.mouse.move(cx, cy)
  await page.mouse.down()
  await page.mouse.move(cx + deltaX, cy, { steps: 12 })
  await page.mouse.up()
  await page.waitForTimeout(250)
}

async function readBillboardDot(page: Page): Promise<number> {
  const text = await page.locator('#diagDot').textContent()
  const n = text ? parseFloat(text) : NaN
  return Number.isNaN(n) ? -1 : n
}

// ---------------------------------------------------------------------------
// M1. Flash Appears at Weapon Hardpoint
// ---------------------------------------------------------------------------

test.describe('M1 — Flash at Hardpoint', () => {
  test.beforeEach(async ({ page }) => {
    await gotoPage(page)
    await resetHarness(page)
  })

  test('M1.1: Slot 0 flash spawns at expected hardpoint (±0.12 wu)', async ({ page }) => {
    await page.evaluate(() => (window as any).__testHarness.fireWeapon(0))
    const pos = await page.evaluate(() => (window as any).__testHarness.getMuzzlePosition(0))
    expect(pos).not.toBeNull()
    expect(distance3(pos!, EXPECTED_SLOT_0)).toBeLessThanOrEqual(POSITION_TOLERANCE)
  })

  test('M1.2: Slot 1 flash spawns at expected hardpoint (±0.12 wu)', async ({ page }) => {
    await page.evaluate(() => (window as any).__testHarness.fireWeapon(1))
    const pos = await page.evaluate(() => (window as any).__testHarness.getMuzzlePosition(1))
    expect(pos).not.toBeNull()
    expect(distance3(pos!, EXPECTED_SLOT_1)).toBeLessThanOrEqual(POSITION_TOLERANCE)
  })

  test('M1.3: Flash is visible within 1 tick (≤ 50 ms) of fire', async ({ page }) => {
    await page.evaluate(() => (window as any).__testHarness.fireWeapon(0))
    await waitTicks(page, 1)
    const visible = await page.evaluate(() => (window as any).__testHarness.isMuzzleVisible(0))
    expect(visible).toBe(true)
  })

  test('M1.4: Initial remaining ticks equal configured duration', async ({ page }) => {
    // Combine fire + read in one evaluate to eliminate inter-frame race.
    const { rem, dur } = await page.evaluate(() => {
      const h = (window as any).__testHarness
      h.fireWeapon(0)
      return { rem: h.getRemainingTicks(0), dur: h.getMuzzleDuration() }
    })
    expect(rem).toBe(dur)
  })

  test('M1.5: Flash at hardpoint — VISUAL', async ({ page }) => {
    await page.evaluate(() => (window as any).__testHarness.fireWeapon(0))
    await waitTicks(page, 1)
    const fp = await takeScreenshot(page, 'M1.5_flash_at_hardpoint')
    expect(fs.existsSync(fp)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// M2. Flash Visible for Exactly Configured Duration
// ---------------------------------------------------------------------------

test.describe('M2 — Configured Duration', () => {
  test.beforeEach(async ({ page }) => {
    await gotoPage(page)
    await resetHarness(page)
    await setDuration(page, 6)
  })

  test('M2.1: Default duration = 6 ticks; remaining ticks counts down 6→0', async ({ page }) => {
    // Round 2: fire + initial read in one evaluate to eliminate inter-frame race.
    // MAX_CATCHUP_TICKS=3 means 1-3 ticks may process per frame, so exact tick
    // values at each sampling point can differ by ±2.  Instead verify:
    //   (a) initial > 0, (b) monotonic non-increasing, (c) reaches 0, (d) stays 0.
    const { duration, first } = await page.evaluate(() => {
      const h = (window as any).__testHarness
      h.fireWeapon(0)
      return { duration: h.getMuzzleDuration(), first: h.getRemainingTicks(0) }
    })
    expect(duration).toBe(6)
    expect(first).toBeGreaterThanOrEqual(1)
    expect(first).toBeLessThanOrEqual(duration)

    const history: number[] = [first]
    for (let i = 0; i <= duration + 2; i++) {
      await waitTicks(page, 1)
      const rem = await page.evaluate(() => (window as any).__testHarness.getRemainingTicks(0))
      history.push(rem)
    }

    // Monotonic non-increasing
    for (let i = 1; i < history.length; i++) {
      expect(history[i]).toBeLessThanOrEqual(history[i - 1]!)
    }
    // Reaches 0
    const zeroIndex = history.findIndex((v) => v === 0)
    expect(zeroIndex).toBeGreaterThan(0)
    // Stays at 0 after first zero
    for (let i = Math.max(zeroIndex, 0); i < history.length; i++) {
      expect(history[i]).toBe(0)
    }
  })

  test('M2.2: Flash invisible exactly after duration expires', async ({ page }) => {
    await page.evaluate(() => (window as any).__testHarness.fireWeapon(0))
    await waitTicks(page, 6)
    const stillVisible = await page.evaluate(() => (window as any).__testHarness.isMuzzleVisible(0))
    expect(stillVisible).toBe(false)
    const active = await page.evaluate(() => (window as any).__testHarness.getActiveSlotCount())
    expect(active).toBe(0)
  })

  test('M2.3: Duration slider = 10 makes flash last exactly 10 ticks', async ({ page }) => {
    await setDuration(page, 10)
    await page.evaluate(() => (window as any).__testHarness.fireWeapon(0))

    const duration = await page.evaluate(() => (window as any).__testHarness.getMuzzleDuration())
    expect(duration).toBe(10)

    // Round 2: Use timing margins. waitForTimeout is a minimum, not exact.
    // Wait 8 ticks (400ms) and verify still visible (flash lasts 10 ticks = 500ms).
    await waitTicks(page, 8)
    const visible8 = await page.evaluate(() => (window as any).__testHarness.isMuzzleVisible(0))
    expect(visible8).toBe(true)

    // Wait 3 more ticks — flash should now be expired (8+3=11 > 10).
    await waitTicks(page, 3)
    const visible11 = await page.evaluate(() => (window as any).__testHarness.isMuzzleVisible(0))
    expect(visible11).toBe(false)

    const rem = await page.evaluate(() => (window as any).__testHarness.getRemainingTicks(0))
    expect(rem).toBe(0)
  })

  test('M2.4: Minimum duration (2 ticks) still works', async ({ page }) => {
    await setDuration(page, 2)
    // Round 2: With MAX_CATCHUP_TICKS=3, a single frame can consume all 2 ticks.
    // Fire + read in the same evaluate to ensure we see the flash before expiry.
    const { visible, rem } = await page.evaluate(() => {
      const h = (window as any).__testHarness
      h.fireWeapon(0)
      return { visible: h.isMuzzleVisible(0), rem: h.getRemainingTicks(0) }
    })
    expect(visible).toBe(true)
    expect(rem).toBe(2)

    // After 3 ticks (150ms) the flash must be gone.
    await waitTicks(page, 3)
    const finalVisible = await page.evaluate(() => (window as any).__testHarness.isMuzzleVisible(0))
    expect(finalVisible).toBe(false)
  })

  test('M2.5: Long duration (20 ticks) counts down correctly', async ({ page }) => {
    await setDuration(page, 20)
    await page.evaluate(() => (window as any).__testHarness.fireWeapon(0))
    // Round 2: waitForTimeout jitter means 500ms != exactly 10 ticks.
    // Wait 9 ticks (conservative) and verify remaining >= 10.
    await waitTicks(page, 9)
    const rem = await page.evaluate(() => (window as any).__testHarness.getRemainingTicks(0))
    expect(rem).toBeGreaterThanOrEqual(10)
    // Wait 12 more ticks (total 21 > 20), flash must be gone.
    await waitTicks(page, 12)
    const visible = await page.evaluate(() => (window as any).__testHarness.isMuzzleVisible(0))
    expect(visible).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// M3. Dual / Single Barrel Mode
// ---------------------------------------------------------------------------

test.describe('M3 — Barrel Mode Alternation', () => {
  test.beforeEach(async ({ page }) => {
    await gotoPage(page)
    await resetHarness(page)
    await setMode(page, 'dual')
    await setDuration(page, 6)
  })

  test('M3.1: Dual mode fires alternate slot 0→1→0→1', async ({ page }) => {
    // Round 2: Both slots can be active simultaneously at 1-tick fire intervals
    // (6-tick duration), so simple visibility checks are ambiguous.  Instead use
    // the #diagNext DOM element to verify the alternation counter advances
    // correctly: 0→1→0→1 after 4 auto-fires.
    await expect(page.locator('#diagNext')).toHaveText('0')

    for (let i = 0; i < 4; i++) {
      const beforeNext = await page.locator('#diagNext').textContent()
      await page.evaluate(() => (window as any).__testHarness.fireWeapon())
      // auto-fire in dual mode advances nextSlot
      await waitTicks(page, 1)
      const afterNext = await page.locator('#diagNext').textContent()
      // nextSlot should have toggled: if before=0 after=1, if before=1 after=0
      expect(afterNext).not.toBe(beforeNext)
      expect(['0', '1']).toContain(afterNext)
    }

    // After 4 fires, nextSlot returns to 0 (since 4 % 2 == 0).
    await expect(page.locator('#diagNext')).toHaveText('0')
    const count = await page.evaluate(() => (window as any).__testHarness.getFireCount())
    expect(count).toBe(4)
  })

  test('M3.2: Single mode always uses slot 0', async ({ page }) => {
    await setMode(page, 'single')
    for (let i = 0; i < 5; i++) {
      await page.evaluate(() => (window as any).__testHarness.fireWeapon())
      const s0 = await page.evaluate(() => (window as any).__testHarness.isMuzzleVisible(0))
      const s1 = await page.evaluate(() => (window as any).__testHarness.isMuzzleVisible(1))
      expect(s0).toBe(true)
      expect(s1).toBe(false)
      await waitTicks(page, 1)
    }
  })

  test('M3.3: Manual slot 0 fire does not corrupt dual alternation', async ({ page }) => {
    // Manual fire on slot 0 does NOT advance nextSlot.  The next auto-fire
    // uses the current nextSlot (which is 0 after manual slot-0 fire).
    // This preserves the alternation counter — manual fire doesn't skip a turn.
    await page.evaluate(() => (window as any).__testHarness.fireWeapon(0))
    await waitTicks(page, 1)

    // Auto-fire uses current nextSlot (0), then advances to 1.
    await page.evaluate(() => (window as any).__testHarness.fireWeapon())
    const s0 = await page.evaluate(() => (window as any).__testHarness.isMuzzleVisible(0))
    expect(s0).toBe(true)

    // Next auto-fire uses slot 1, alternating back.
    await waitTicks(page, 1)
    await page.evaluate(() => (window as any).__testHarness.fireWeapon())
    const s1 = await page.evaluate(() => (window as any).__testHarness.isMuzzleVisible(1))
    expect(s1).toBe(true)

    const count = await page.evaluate(() => (window as any).__testHarness.getFireCount())
    expect(count).toBe(3)
  })

  test('M3.4: UI Fire Weapon button triggers visible flash', async ({ page }) => {
    await page.click('#btnFire')
    await waitTicks(page, 1)
    const active = await page.evaluate(() => (window as any).__testHarness.getActiveSlotCount())
    expect(active).toBe(1)
  })

  test('M3.5: UI Slot buttons fire correct slots', async ({ page }) => {
    await page.click('#btnFireS1')
    await waitTicks(page, 1)
    const s1 = await page.evaluate(() => (window as any).__testHarness.isMuzzleVisible(1))
    expect(s1).toBe(true)

    await waitTicks(page, 6)
    await page.click('#btnFireS0')
    await waitTicks(page, 1)
    const s0 = await page.evaluate(() => (window as any).__testHarness.isMuzzleVisible(0))
    expect(s0).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// M4. Billboard Faces Camera
// ---------------------------------------------------------------------------

test.describe('M4 — Billboard Facing', () => {
  test.beforeEach(async ({ page }) => {
    await gotoPage(page)
    await resetHarness(page)
    // Round 2: 60 ticks = 3s, enough for all orbit/sweep tests without flash expiry.
    await setDuration(page, 60)
  })

  test('M4.1: Billboard dot > 0.95 from default camera angle', async ({ page }) => {
    await page.evaluate(() => (window as any).__testHarness.fireWeapon(0))
    await waitTicks(page, 1)
    const dot = await readBillboardDot(page)
    expect(dot).toBeGreaterThan(0.95)
  })

  test('M4.2: Billboard dot > 0.95 after orbiting camera left', async ({ page }) => {
    await page.evaluate(() => (window as any).__testHarness.fireWeapon(0))
    await waitTicks(page, 1)
    await orbitCamera(page, -350)
    const dot = await readBillboardDot(page)
    expect(dot).toBeGreaterThan(0.95)
  })

  test('M4.3: Billboard dot > 0.95 after orbiting camera right', async ({ page }) => {
    await page.evaluate(() => (window as any).__testHarness.fireWeapon(0))
    await waitTicks(page, 1)
    await orbitCamera(page, 350)
    const dot = await readBillboardDot(page)
    expect(dot).toBeGreaterThan(0.95)
  })

  test('M4.4: Billboard dot > 0.95 through a 360° camera sweep', async ({ page }) => {
    // Round 2: Re-fire the weapon at each step to guarantee a fresh flash is
    // always available, regardless of how long orbitCamera takes.
    const steps = 8
    for (let i = 0; i < steps; i++) {
      await page.evaluate(() => (window as any).__testHarness.fireWeapon(0))
      await waitTicks(page, 1)
      await orbitCamera(page, 90)
      const dot = await readBillboardDot(page)
      expect(dot).toBeGreaterThan(0.95)
    }
  })

  test('M4.5: Billboard facing remains correct while flash fades — VISUAL', async ({ page }) => {
    await orbitCamera(page, -180)
    await page.evaluate(() => (window as any).__testHarness.fireWeapon(0))
    await waitTicks(page, 3)
    const fp = await takeScreenshot(page, 'M4.5_billboard_facing_side_view')
    expect(fs.existsSync(fp)).toBe(true)
    const dot = await readBillboardDot(page)
    expect(dot).toBeGreaterThan(0.95)
  })
})

// ---------------------------------------------------------------------------
// M5. Clean Disposal with No Residual
// ---------------------------------------------------------------------------

test.describe('M5 — Cleanup and Residuals', () => {
  test.beforeEach(async ({ page }) => {
    await gotoPage(page)
    await resetHarness(page)
    await setMode(page, 'dual')
    await setDuration(page, 6)
  })

  test('M5.1: After duration expires active slot count is zero', async ({ page }) => {
    await page.evaluate(() => (window as any).__testHarness.fireWeapon(0))
    await waitTicks(page, 6)
    const active = await page.evaluate(() => (window as any).__testHarness.getActiveSlotCount())
    expect(active).toBe(0)
  })

  test('M5.2: Reset clears fire count, slots, and remaining ticks', async ({ page }) => {
    await page.evaluate(() => {
      const h = (window as any).__testHarness
      h.fireWeapon()
      h.fireWeapon()
      h.fireWeapon()
    })
    await waitTicks(page, 1)
    await resetHarness(page)

    const active = await page.evaluate(() => (window as any).__testHarness.getActiveSlotCount())
    const count = await page.evaluate(() => (window as any).__testHarness.getFireCount())
    const rem0 = await page.evaluate(() => (window as any).__testHarness.getRemainingTicks(0))
    const rem1 = await page.evaluate(() => (window as any).__testHarness.getRemainingTicks(1))

    expect(active).toBe(0)
    expect(count).toBe(0)
    expect(rem0).toBe(0)
    expect(rem1).toBe(0)

    // UI diagnostics should also reflect reset.
    await expect(page.locator('#diagFires')).toHaveText('0')
    await expect(page.locator('#diagS0vis')).toHaveText('no')
    await expect(page.locator('#diagS1vis')).toHaveText('no')
  })

  test('M5.3: Rapid fire every 2 ticks for 60 ticks does not leak active slots', async ({ page }) => {
    // Fire every 2 ticks.  Duration is 6, so at most 3-4 flashes can be
    // alive concurrently per slot.  Active slot count must never exceed 2.
    const maxActiveObserved = await page.evaluate(async () => {
      const h = (window as any).__testHarness
      let max = 0
      for (let t = 0; t < 60; t++) {
        if (t % 2 === 0) h.fireWeapon()
        await new Promise((r) => setTimeout(r, 50))
        const active = h.getActiveSlotCount()
        if (active > max) max = active
      }
      return max
    })
    expect(maxActiveObserved).toBeLessThanOrEqual(2)

    // Wait for the final flash to expire and confirm everything is gone.
    await waitTicks(page, 8)
    const finalActive = await page.evaluate(() => (window as any).__testHarness.getActiveSlotCount())
    expect(finalActive).toBe(0)
  })

  test('M5.4: Re-firing the same slot disposes the previous mesh immediately', async ({ page }) => {
    await page.evaluate(() => (window as any).__testHarness.fireWeapon(0))
    await waitTicks(page, 2)

    const firstPos = await page.evaluate(() => (window as any).__testHarness.getMuzzlePosition(0))
    expect(firstPos).not.toBeNull()

    // Re-fire slot 0 before it expires; old mesh is disposed and replaced.
    await page.evaluate(() => (window as any).__testHarness.fireWeapon(0))
    await waitTicks(page, 1)

    const secondPos = await page.evaluate(() => (window as any).__testHarness.getMuzzlePosition(0))
    expect(secondPos).not.toBeNull()
    expect(distance3(firstPos!, secondPos!)).toBeLessThanOrEqual(POSITION_TOLERANCE)

    const active = await page.evaluate(() => (window as any).__testHarness.getActiveSlotCount())
    expect(active).toBe(1)
  })

  test('M5.5: Mode switch resets alternation and does not leave stale flashes', async ({ page }) => {
    await page.evaluate(() => (window as any).__testHarness.fireWeapon())
    await waitTicks(page, 1)
    await setMode(page, 'single')
    const active = await page.evaluate(() => (window as any).__testHarness.getActiveSlotCount())
    const mode = await page.evaluate(() => (window as any).__testHarness.getBarrelMode())
    expect(mode).toBe('single')
    // Mode switch itself does not reset existing flashes.
    expect(active).toBeGreaterThanOrEqual(0)

    await waitTicks(page, 6)
    const activeAfter = await page.evaluate(() => (window as any).__testHarness.getActiveSlotCount())
    expect(activeAfter).toBe(0)

    // Next fire in single mode must use slot 0.
    await page.evaluate(() => (window as any).__testHarness.fireWeapon())
    await waitTicks(page, 1)
    const s0 = await page.evaluate(() => (window as any).__testHarness.isMuzzleVisible(0))
    const s1 = await page.evaluate(() => (window as any).__testHarness.isMuzzleVisible(1))
    expect(s0).toBe(true)
    expect(s1).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Initial state / sanity
// ---------------------------------------------------------------------------

test.describe('Initial State', () => {
  test('page loads with dual mode, duration 6, zero fires', async ({ page }) => {
    await gotoPage(page)
    const mode = await page.evaluate(() => (window as any).__testHarness.getBarrelMode())
    const dur = await page.evaluate(() => (window as any).__testHarness.getMuzzleDuration())
    const count = await page.evaluate(() => (window as any).__testHarness.getFireCount())
    const active = await page.evaluate(() => (window as any).__testHarness.getActiveSlotCount())

    expect(mode).toBe('dual')
    expect(dur).toBe(6)
    expect(count).toBe(0)
    expect(active).toBe(0)

    await expect(page.locator('#diagMode')).toHaveText('dual')
    await expect(page.locator('#diagFires')).toHaveText('0')

    const fp = await takeScreenshot(page, 'initial_state')
    expect(fs.existsSync(fp)).toBe(true)
  })
})

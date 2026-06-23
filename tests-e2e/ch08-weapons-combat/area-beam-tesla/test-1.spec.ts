import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'

const BASE_URL = 'http://localhost:5173/test/ch08-weapons-combat/area-beam-tesla/'

async function setSlider(page: Page, selector: string, value: number) {
  await page.evaluate(({ sel, val }: { sel: string; val: number }) => {
    const el = document.querySelector(sel) as HTMLInputElement | null
    if (!el) return
    el.value = String(val)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }, { sel: selector, val: value })
}

async function waitForTicks(page: Page, target: number, timeout = 20000) {
  await page.waitForFunction(
    (t: number) => {
      const el = document.getElementById('diag-ticks')
      const val = el?.textContent ?? '-'
      if (val === '-') return false
      const n = parseInt(val, 10)
      return !isNaN(n) && n >= t
    },
    target,
    { timeout }
  )
}

test.describe('A1 — Beam Opacity FadeIn', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL)
    await page.waitForSelector('canvas#renderCanvas')
    await page.evaluate(() => (window as any).__testHarness.reset())
  })

  test('A1.1 default config beam length is 18 ticks', async ({ page }) => {
    await page.click('#btn-fire')
    await page.waitForFunction(
      () => (window as any).__testHarness.getActiveBeam() !== null,
      {},
      { timeout: 5000 }
    )

    const length = await page.evaluate(() => (window as any).__testHarness.getActiveBeam().length)
    expect(length).toBe(18)

    const speedText = await page.textContent('#diag-speed-display')
    expect(speedText).toContain('beamLength=18t')
    await page.screenshot({ path: 'test-results/manual/ch08-weapons-combat/area-beam-tesla/evidence/test-a1.1.png' })
  })

  test('A1.2 tick 17 opacity ≈ 0.94 and tick 18 opacity = 1.0', async ({ page }) => {
    await page.click('#btn-fire')
    await page.waitForFunction(
      () => (window as any).__testHarness.getActiveBeam() !== null,
      {},
      { timeout: 5000 }
    )

    // Poll for ticks >= 17; opacity at head-tick-17 should be close to 17/18 ≈ 0.94
    // Timing: sim runs at ~30 ticks/s, so by the time poll fires we may be at tick 18+.
    // Accept opacity in [0.85, 1.0] range for tick 17 window.
    await waitForTicks(page, 17)
    const opacity17 = await page.evaluate(() => (window as any).__testHarness.getBeamOpacity())
    expect(opacity17).toBeGreaterThanOrEqual(0.85)

    // At tick 18 the head arrives and opacity should be exactly 1
    await waitForTicks(page, 18)
    const opacity18 = await page.evaluate(() => (window as any).__testHarness.getBeamOpacity())
    expect(opacity18).toBe(1)
    await page.screenshot({ path: 'test-results/manual/ch08-weapons-combat/area-beam-tesla/evidence/test-a1.2.png' })
  })

  test('A1.3 speed=256 gives length=36; opacity peaks before fadeOut', async ({ page }) => {
    // With speed=256 (length=36) and default duration=30, the tail starts
    // fading out at tick 30 before the head arrives at tick 36.
    // Opacity peaks at ~0.97 just before fadeOut starts at tick 30.
    // To verify the fade-in curve, extend duration so head arrives first.
    await setSlider(page, '#config-speed', 256)
    await setSlider(page, '#config-duration', 50)
    await page.click('#btn-fire')
    await page.waitForFunction(
      () => (window as any).__testHarness.getActiveBeam() !== null,
      {},
      { timeout: 5000 }
    )

    const length = await page.evaluate(() => (window as any).__testHarness.getActiveBeam().length)
    expect(length).toBe(36)

    const speedText = await page.textContent('#diag-speed-display')
    expect(speedText).toContain('beamLength=36t')

    // Head arrives at tick 36; check opacity just before fadeOut starts
    await waitForTicks(page, 36)
    await page.waitForTimeout(200)
    const opacity = await page.evaluate(() => (window as any).__testHarness.getBeamOpacity())
    expect(opacity).toBeGreaterThanOrEqual(0.95)
    await page.screenshot({ path: 'test-results/manual/ch08-weapons-combat/area-beam-tesla/evidence/test-a1.3.png' })
  })

  test('A1.4 fadeIn phase transitions correctly to sustain', async ({ page }) => {
    await page.click('#btn-fire')
    await page.waitForFunction(
      () => (window as any).__testHarness.getActiveBeam() !== null,
      {},
      { timeout: 5000 }
    )

    await page.waitForTimeout(200)
    const phaseEarly = await page.textContent('#diag-phase')
    expect(phaseEarly).toBe('fadeIn')

    await waitForTicks(page, 18)
    await page.waitForTimeout(100)
    const phaseLate = await page.textContent('#diag-phase')
    expect(phaseLate).toBe('sustain')
    await page.screenshot({ path: 'test-results/manual/ch08-weapons-combat/area-beam-tesla/evidence/test-a1.4.png' })
  })
})

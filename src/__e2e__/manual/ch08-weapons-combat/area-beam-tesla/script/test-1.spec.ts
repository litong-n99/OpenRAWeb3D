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

    await waitForTicks(page, 17)
    await page.waitForTimeout(100)
    const opacity17 = await page.evaluate(() => (window as any).__testHarness.getBeamOpacity())
    expect(opacity17).toBeGreaterThanOrEqual(0.90)
    expect(opacity17).toBeLessThanOrEqual(0.98)

    await waitForTicks(page, 18)
    await page.waitForTimeout(100)
    const opacity18 = await page.evaluate(() => (window as any).__testHarness.getBeamOpacity())
    expect(opacity18).toBe(1)
    await page.screenshot({ path: 'test-results/manual/ch08-weapons-combat/area-beam-tesla/evidence/test-a1.2.png' })
  })

  test('A1.3 speed=256 gives length=36 and opacity 1.0 at tick 36', async ({ page }) => {
    await setSlider(page, '#config-speed', 256)
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

    await waitForTicks(page, 36)
    await page.waitForTimeout(100)
    const opacity = await page.evaluate(() => (window as any).__testHarness.getBeamOpacity())
    expect(opacity).toBe(1)
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

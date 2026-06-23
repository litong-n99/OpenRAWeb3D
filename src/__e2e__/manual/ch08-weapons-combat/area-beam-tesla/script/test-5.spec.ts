import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'

const BASE_URL = 'http://localhost:5173/test/ch08-weapons-combat/area-beam-tesla/'

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

test.describe('A5 — Beam FadeOut and Disposal', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL)
    await page.waitForSelector('canvas#renderCanvas')
    await page.evaluate(() => (window as any).__testHarness.reset())
  })

  test('A5.1 tail starts at tick 30 (isFadingOut becomes true)', async ({ page }) => {
    await page.click('#btn-fire')
    await page.waitForFunction(
      () => (window as any).__testHarness.getActiveBeam() !== null,
      {},
      { timeout: 5000 }
    )

    await waitForTicks(page, 30)
    await page.waitForTimeout(100)
    const fadingOut = await page.evaluate(() => (window as any).__testHarness.isFadingOut())
    expect(fadingOut).toBe(true)
    const phase = await page.textContent('#diag-phase')
    expect(phase).toBe('fadeOut')
    await page.screenshot({ path: 'test-results/manual/ch08-weapons-combat/area-beam-tesla/evidence/test-a5.1.png' })
  })

  test('A5.2 tail reaches target at tick 48', async ({ page }) => {
    await page.click('#btn-fire')
    await page.waitForFunction(
      () => (window as any).__testHarness.getActiveBeam() !== null,
      {},
      { timeout: 5000 }
    )

    await waitForTicks(page, 48)
    await page.waitForTimeout(200)
    const phase = await page.textContent('#diag-phase')
    expect(phase).toBe('done')
    const complete = await page.textContent('#diag-complete')
    expect(complete).toBe('YES')
    await page.screenshot({ path: 'test-results/manual/ch08-weapons-combat/area-beam-tesla/evidence/test-a5.2.png' })
  })

  test('A5.3 beam complete → opacity = 0', async ({ page }) => {
    await page.click('#btn-fire')
    await page.waitForFunction(
      () => (window as any).__testHarness.getActiveBeam() !== null,
      {},
      { timeout: 5000 }
    )

    await waitForTicks(page, 48)
    await page.waitForTimeout(200)
    const opacity = await page.evaluate(() => (window as any).__testHarness.getBeamOpacity())
    expect(opacity).toBe(0)
    await page.screenshot({ path: 'test-results/manual/ch08-weapons-combat/area-beam-tesla/evidence/test-a5.3.png' })
  })

  test('A5.4 isFadingOut transitions correctly', async ({ page }) => {
    await page.click('#btn-fire')
    await page.waitForFunction(
      () => (window as any).__testHarness.getActiveBeam() !== null,
      {},
      { timeout: 5000 }
    )

    await page.waitForFunction(
      () => (window as any).__testHarness.getFadePhase() === 'sustain',
      {},
      { timeout: 10000 }
    )
    const fadingOutEarly = await page.evaluate(() => (window as any).__testHarness.isFadingOut())
    expect(fadingOutEarly).toBe(false)

    await waitForTicks(page, 30)
    await page.waitForFunction(
      () => (window as any).__testHarness.getFadePhase() === 'fadeOut',
      {},
      { timeout: 10000 }
    )
    const fadingOutMid = await page.evaluate(() => (window as any).__testHarness.isFadingOut())
    expect(fadingOutMid).toBe(true)

    await waitForTicks(page, 48)
    await page.waitForFunction(
      () => (window as any).__testHarness.getFadePhase() === 'done',
      {},
      { timeout: 10000 }
    )
    const fadingOutLate = await page.evaluate(() => (window as any).__testHarness.isFadingOut())
    expect(fadingOutLate).toBe(false)
    await page.screenshot({ path: 'test-results/manual/ch08-weapons-combat/area-beam-tesla/evidence/test-a5.4.png' })
  })
})

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

async function fireAndWaitForBeam(page: Page) {
  await page.click('#btn-fire')
  await page.waitForFunction(
    () => (window as any).__testHarness.getActiveBeam() !== null,
    {},
    { timeout: 5000 }
  )
  await page.waitForTimeout(300)
}

test.describe('A2 — Beam Midpoint Width', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL)
    await page.waitForSelector('canvas#renderCanvas')
    await page.evaluate(() => (window as any).__testHarness.reset())
  })

  test('A2.1 default width=512 yields beam width ≈ 0.5 wu', async ({ page }) => {
    await fireAndWaitForBeam(page)
    const width = await page.evaluate(() => (window as any).__testHarness.getBeamWidth())
    expect(width).toBeCloseTo(0.5, 1)
    await page.screenshot({ path: 'test-results/manual/ch08-weapons-combat/area-beam-tesla/evidence/test-a2.1.png' })
  })

  test('A2.2 width=1024 yields beam width ≈ 1.0 wu', async ({ page }) => {
    await setSlider(page, '#config-width', 1024)
    await fireAndWaitForBeam(page)
    const width = await page.evaluate(() => (window as any).__testHarness.getBeamWidth())
    expect(width).toBeCloseTo(1.0, 1)
    await page.screenshot({ path: 'test-results/manual/ch08-weapons-combat/area-beam-tesla/evidence/test-a2.2.png' })
  })

  test('A2.3 width display shows configured width info', async ({ page }) => {
    await setSlider(page, '#config-width', 1024)
    await fireAndWaitForBeam(page)
    const display = await page.textContent('#diag-width-display')
    expect(display).toContain('1024 su')
    // The diag-width-display format is "1024 su (r=0.500 wu)" — note the space after 0.500
    expect(display).toContain('r=0.500')
    await page.screenshot({ path: 'test-results/manual/ch08-weapons-combat/area-beam-tesla/evidence/test-a2.3.png' })
  })

  test('A2.4 width=256 yields beam width ≈ 0.25 wu', async ({ page }) => {
    await setSlider(page, '#config-width', 256)
    await fireAndWaitForBeam(page)
    const width = await page.evaluate(() => (window as any).__testHarness.getBeamWidth())
    expect(width).toBeCloseTo(0.25, 1)
    await page.screenshot({ path: 'test-results/manual/ch08-weapons-combat/area-beam-tesla/evidence/test-a2.4.png' })
  })
})

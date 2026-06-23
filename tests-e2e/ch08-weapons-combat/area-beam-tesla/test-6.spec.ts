import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'

const BASE_URL = 'http://localhost:5173/test/ch08-weapons-combat/area-beam-tesla/'

interface MockActorState {
  id: number
  label: string
  hit: boolean
  hitCount: number
}

async function setSlider(page: Page, selector: string, value: number) {
  await page.evaluate(({ sel, val }: { sel: string; val: number }) => {
    const el = document.querySelector(sel) as HTMLInputElement | null
    if (!el) return
    el.value = String(val)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }, { sel: selector, val: value })
}

async function setSelect(page: Page, selector: string, value: string) {
  await page.evaluate(({ sel, val }: { sel: string; val: string }) => {
    const el = document.querySelector(sel) as HTMLSelectElement | null
    if (!el) return
    el.value = val
    el.dispatchEvent(new Event('change', { bubbles: true }))
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

test.describe('A6 — Config Slider Responsiveness', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL)
    await page.waitForSelector('canvas#renderCanvas')
    await page.evaluate(() => (window as any).__testHarness.reset())
  })

  test('A6.1 speed slider 256 changes beam length to 36', async ({ page }) => {
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
    await page.screenshot({ path: 'test-results/manual/ch08-weapons-combat/area-beam-tesla/evidence/test-a6.1.png' })
  })

  test('A6.2 duration slider 15 triggers stopTargeting at tick 15', async ({ page }) => {
    await setSlider(page, '#config-duration', 15)
    await page.click('#btn-fire')
    await page.waitForFunction(
      () => (window as any).__testHarness.getActiveBeam() !== null,
      {},
      { timeout: 5000 }
    )

    await waitForTicks(page, 15)
    await page.waitForFunction(
      () => (window as any).__testHarness.getFadePhase() === 'fadeOut',
      {},
      { timeout: 10000 }
    )
    const phase = await page.textContent('#diag-phase')
    expect(phase).toBe('fadeOut')
    await page.screenshot({ path: 'test-results/manual/ch08-weapons-combat/area-beam-tesla/evidence/test-a6.2.png' })
  })

  test('A6.3 width slider 2048 widens beam (A_center/B_inside/D_edge always hit)', async ({ page }) => {
    // Actor placements scale with halfW: C_outside at 1.5*halfW and
    // E_farOutside at 3*halfW always remain outside the beam regardless of width.
    await setSlider(page, '#config-width', 2048)
    await page.click('#btn-fire')
    await page.waitForFunction(
      () => (window as any).__testHarness.getActiveBeam() !== null,
      {},
      { timeout: 5000 }
    )
    await page.waitForFunction(
      () => (window as any).__testHarness.getActorsInBeam().length >= 3,
      {},
      { timeout: 15000 }
    )
    await page.waitForTimeout(200)

    const states: MockActorState[] = await page.evaluate(() =>
      (window as any).__testHarness.getMockActorStates()
    )
    expect(states.length).toBe(5)

    // A_center, B_inside, D_edge should always be hit
    const alwaysHit = ['A_center', 'B_inside', 'D_edge']
    for (const label of alwaysHit) {
      const actor = states.find((s) => s.label === label)
      expect(actor).toBeDefined()
      expect(actor!.hit).toBe(true)
      expect(actor!.hitCount).toBeGreaterThanOrEqual(1)
    }

    // C_outside, E_farOutside should NOT be hit (positions scale with width)
    const neverHit = ['C_outside', 'E_farOutside']
    for (const label of neverHit) {
      const actor = states.find((s) => s.label === label)
      expect(actor).toBeDefined()
      expect(actor!.hit).toBe(false)
    }

    await page.screenshot({ path: 'test-results/manual/ch08-weapons-combat/area-beam-tesla/evidence/test-a6.3.png' })
  })

  test('A6.4 color select changes next beam color', async ({ page }) => {
    await setSelect(page, '#config-color', '255,100,100')
    await page.click('#btn-fire')
    await page.waitForFunction(
      () => (window as any).__testHarness.getActiveBeam() !== null,
      {},
      { timeout: 5000 }
    )
    await page.waitForTimeout(300)

    const color = await page.evaluate(() => {
      const scene = (window as any).__testHarness.scene
      const mesh = scene.getMeshByName('beamBody')
      if (!mesh || !mesh.material) return null
      const mat = mesh.material as any
      return {
        r: mat.diffuseColor.r,
        g: mat.diffuseColor.g,
        b: mat.diffuseColor.b,
      }
    })

    expect(color).not.toBeNull()
    expect(color!.r).toBeGreaterThan(0.7)
    expect(color!.g).toBeLessThan(0.4)
    expect(color!.b).toBeLessThan(0.4)
    await page.screenshot({ path: 'test-results/manual/ch08-weapons-combat/area-beam-tesla/evidence/test-a6.4.png' })
  })
})

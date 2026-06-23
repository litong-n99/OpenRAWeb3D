import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'

const BASE_URL = 'http://localhost:5173/test/ch08-weapons-combat/area-beam-tesla/'

interface MockActorState {
  id: number
  label: string
  hit: boolean
  hitCount: number
}

async function fireUntilHits(page: Page, expectedHitCount = 3) {
  await page.click('#btn-fire')
  await page.waitForFunction(
    () => (window as any).__testHarness.getActiveBeam() !== null,
    {},
    { timeout: 5000 }
  )
  await page.waitForFunction(
    (n: number) => (window as any).__testHarness.getActorsInBeam().length >= n,
    expectedHitCount,
    { timeout: 15000 }
  )
  await page.waitForTimeout(200)
}

test.describe('A4 — Actors Outside Width Receive No Damage', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL)
    await page.waitForSelector('canvas#renderCanvas')
    await page.evaluate(() => (window as any).__testHarness.reset())
  })

  test('A4.1 C_outside is not hit', async ({ page }) => {
    await fireUntilHits(page, 3)
    const states: MockActorState[] = await page.evaluate(() =>
      (window as any).__testHarness.getMockActorStates()
    )
    const actor = states.find((s) => s.label === 'C_outside')
    expect(actor).toBeDefined()
    expect(actor!.hit).toBe(false)
    expect(actor!.hitCount).toBe(0)
    await page.screenshot({ path: 'test-results/manual/ch08-weapons-combat/area-beam-tesla/evidence/test-a4.1.png' })
  })

  test('A4.2 E_farOutside is not hit', async ({ page }) => {
    await fireUntilHits(page, 3)
    const states: MockActorState[] = await page.evaluate(() =>
      (window as any).__testHarness.getMockActorStates()
    )
    const actor = states.find((s) => s.label === 'E_farOutside')
    expect(actor).toBeDefined()
    expect(actor!.hit).toBe(false)
    expect(actor!.hitCount).toBe(0)
    await page.screenshot({ path: 'test-results/manual/ch08-weapons-combat/area-beam-tesla/evidence/test-a4.2.png' })
  })

  test('A4.3 all non-hit actors remain unhit', async ({ page }) => {
    await fireUntilHits(page, 3)
    const states: MockActorState[] = await page.evaluate(() =>
      (window as any).__testHarness.getMockActorStates()
    )
    const outside = states.filter(
      (s) => s.label === 'C_outside' || s.label === 'E_farOutside'
    )
    for (const actor of outside) {
      expect(actor.hit).toBe(false)
      expect(actor.hitCount).toBe(0)
    }
    await page.screenshot({ path: 'test-results/manual/ch08-weapons-combat/area-beam-tesla/evidence/test-a4.3.png' })
  })

  test('A4.4 getActorsInBeam contains only A_center, B_inside, D_edge IDs', async ({ page }) => {
    await fireUntilHits(page, 3)
    const states: MockActorState[] = await page.evaluate(() =>
      (window as any).__testHarness.getMockActorStates()
    )
    const expectedIds = [
      states.find((s) => s.label === 'A_center')!.id,
      states.find((s) => s.label === 'B_inside')!.id,
      states.find((s) => s.label === 'D_edge')!.id,
    ].sort((a, b) => a - b)

    // getActorsInBeam() accumulates hit IDs across ticks (duplicates possible).
    // Deduplicate to get unique hit actors.
    const hitIds: number[] = await page.evaluate(() =>
      (window as any).__testHarness.getActorsInBeam()
    )
    const actualIds = [...new Set(hitIds)].sort((a, b) => a - b)
    expect(actualIds).toEqual(expectedIds)
    await page.screenshot({ path: 'test-results/manual/ch08-weapons-combat/area-beam-tesla/evidence/test-a4.4.png' })
  })
})

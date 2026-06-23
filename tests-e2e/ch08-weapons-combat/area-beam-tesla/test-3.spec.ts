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

test.describe('A3 — Actors Within Width Receive Damage', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL)
    await page.waitForSelector('canvas#renderCanvas')
    await page.evaluate(() => (window as any).__testHarness.reset())
  })

  test('A3.1 A_center is hit', async ({ page }) => {
    await fireUntilHits(page, 3)
    const states: MockActorState[] = await page.evaluate(() =>
      (window as any).__testHarness.getMockActorStates()
    )
    const actor = states.find((s) => s.label === 'A_center')
    expect(actor).toBeDefined()
    expect(actor!.hit).toBe(true)
    expect(actor!.hitCount).toBeGreaterThanOrEqual(1)
    await page.screenshot({ path: 'test-results/manual/ch08-weapons-combat/area-beam-tesla/evidence/test-a3.1.png' })
  })

  test('A3.2 B_inside is hit', async ({ page }) => {
    await fireUntilHits(page, 3)
    const states: MockActorState[] = await page.evaluate(() =>
      (window as any).__testHarness.getMockActorStates()
    )
    const actor = states.find((s) => s.label === 'B_inside')
    expect(actor).toBeDefined()
    expect(actor!.hit).toBe(true)
    expect(actor!.hitCount).toBeGreaterThanOrEqual(1)
    await page.screenshot({ path: 'test-results/manual/ch08-weapons-combat/area-beam-tesla/evidence/test-a3.2.png' })
  })

  test('A3.3 D_edge is hit', async ({ page }) => {
    await fireUntilHits(page, 3)
    const states: MockActorState[] = await page.evaluate(() =>
      (window as any).__testHarness.getMockActorStates()
    )
    const actor = states.find((s) => s.label === 'D_edge')
    expect(actor).toBeDefined()
    expect(actor!.hit).toBe(true)
    expect(actor!.hitCount).toBeGreaterThanOrEqual(1)
    await page.screenshot({ path: 'test-results/manual/ch08-weapons-combat/area-beam-tesla/evidence/test-a3.3.png' })
  })

  test('A3.4 all hit actors have hit=true and hitCount>=1', async ({ page }) => {
    await fireUntilHits(page, 3)
    const states: MockActorState[] = await page.evaluate(() =>
      (window as any).__testHarness.getMockActorStates()
    )
    const hitActors = states.filter((s) => s.hit)
    expect(hitActors.length).toBeGreaterThanOrEqual(3)
    for (const actor of hitActors) {
      expect(actor.hit).toBe(true)
      expect(actor.hitCount).toBeGreaterThanOrEqual(1)
    }
    await page.screenshot({ path: 'test-results/manual/ch08-weapons-combat/area-beam-tesla/evidence/test-a3.4.png' })
  })
})

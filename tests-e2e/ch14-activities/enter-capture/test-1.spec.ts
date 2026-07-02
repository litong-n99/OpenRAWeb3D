import { test, expect, Page } from '@playwright/test'
import path from 'path'
import fs from 'fs'

const BASE_URL = 'http://localhost:5173/test/ch14-activities/enter-capture/'
const EVIDENCE_DIR = path.resolve('test-results/manual/ch14-activities/enter-capture/evidence')

// Ensure evidence directory exists once before all tests
fs.mkdirSync(EVIDENCE_DIR, { recursive: true })

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function waitForEl(page: Page, selector: string, timeout = 10000): Promise<void> {
  await page.waitForSelector(selector, { timeout })
}

async function pollFor<T>(
  page: Page,
  fn: () => T | Promise<T>,
  timeout = 30000,
  interval = 500,
): Promise<T> {
  const start = Date.now()
  while (true) {
    const result = await page.evaluate(fn as () => T)
    if (result) return result
    if (Date.now() - start >= timeout) {
      throw new Error(`pollFor timed out after ${timeout}ms`)
    }
    await page.waitForTimeout(interval)
  }
}

async function screenshot(page: Page, name: string): Promise<void> {
  const filePath = path.join(EVIDENCE_DIR, `${name}.png`)
  await page.screenshot({ path: filePath, fullPage: false })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('E1: Approaching phase - engineer moves toward building', async ({ page }) => {
  await page.goto(BASE_URL)
  await waitForEl(page, '#renderCanvas')

  // Verify WebGL engine loaded
  await expect(page.locator('#info-engine')).not.toHaveText('-', { timeout: 10000 })
  await expect(page.locator('#info-grid')).toHaveText('20x20')

  await page.click('#btn-scene-basic')
  await page.waitForTimeout(500)

  await expect(page.locator('#stat-building-owner')).toHaveText('敌方')

  // Wait for movement to begin / progress
  await page.waitForTimeout(2500)

  const enterState = await page.locator('#stat-enter-state').textContent()
  expect(enterState).toMatch(/接近中|进入中/)

  const lineColor = await page.locator('#stat-line-color').textContent()
  expect(lineColor).toContain('#44CC44')

  await screenshot(page, 'E1-approaching')
})

test('E2+E3: Entering phase and capture result', async ({ page }) => {
  await page.goto(BASE_URL)
  await waitForEl(page, '#renderCanvas')
  await waitForEl(page, '#btn-scene-basic')

  await page.click('#btn-scene-basic')
  await page.click('#btn-speed-4x')

  // Poll for capture completion up to 30 seconds
  await pollFor(
    page,
    () => (window as any).__testHarness.getCaptureComplete(),
    30000,
    500,
  )

  // Give the UI one frame to settle
  await page.waitForTimeout(200)

  const owner = await page.evaluate(() => (window as any).__testHarness.getBuildingOwner())
  expect(owner).toBe('friendly')

  await expect(page.locator('#stat-capture-count')).toHaveText('1')
  await expect(page.locator('#stat-building-owner')).toHaveText('己方')

  // CAPTURED! overlay text persists even after the visible class is removed
  const overlayText = await page.locator('#capture-overlay').textContent()
  expect(overlayText).toBe('CAPTURED!')

  await screenshot(page, 'E2E3-capture-result')
})

test('E4: Consumed capture - engineer disappears', async ({ page }) => {
  await page.goto(BASE_URL)
  await waitForEl(page, '#renderCanvas')

  await page.click('#btn-scene-consumed')
  await page.click('#btn-speed-4x')

  await pollFor(
    page,
    () => (window as any).__testHarness.getCaptureComplete(),
    30000,
    500,
  )

  await page.waitForTimeout(200)

  await expect(page.locator('#stat-engineer-state')).toHaveText('已消耗')
  await expect(page.locator('#stat-building-owner')).toHaveText('己方')

  const engineer = await page.evaluate(() => (window as any).__testHarness.getEngineer())
  expect(engineer.isVisible).toBe(false)

  await screenshot(page, 'E4-consumed')
})

test('E5: Sabotage mode - HP reduced, building stays enemy', async ({ page }) => {
  await page.goto(BASE_URL)
  await waitForEl(page, '#renderCanvas')

  await page.click('#btn-scene-sabotage')
  await page.click('#btn-speed-4x')

  await pollFor(
    page,
    () => (window as any).__testHarness.getCaptureComplete(),
    30000,
    500,
  )

  await page.waitForTimeout(200)

  await expect(page.locator('#stat-building-owner')).toHaveText('敌方')
  await expect(page.locator('#stat-building-hp')).toHaveText('55/100')

  const overlayText = await page.locator('#capture-overlay').textContent()
  expect(overlayText).toBe('SABOTAGED!')

  const owner = await page.evaluate(() => (window as any).__testHarness.getBuildingOwner())
  expect(owner).toBe('enemy')

  await screenshot(page, 'E5-sabotage')
})

test('E6: Cancel capture - engineer stops, state becomes Finished', async ({ page }) => {
  await page.goto(BASE_URL)
  await waitForEl(page, '#renderCanvas')

  await page.click('#btn-scene-cancel')
  await page.click('#btn-speed-4x')

  await page.waitForTimeout(3000)

  await expect(page.locator('#stat-enter-state')).toHaveText('已完成')
  await expect(page.locator('#stat-building-owner')).toHaveText('敌方')

  const { engineer, building } = await page.evaluate(() => ({
    engineer: (window as any).__testHarness.getEngineer(),
    building: (window as any).__testHarness.getBuilding(),
  }))

  expect(engineer.cellX !== building.cellX || engineer.cellY !== building.cellY).toBe(true)

  await screenshot(page, 'E6-cancel')
})

test('E7: Target line disappears after capture', async ({ page }) => {
  await page.goto(BASE_URL)
  await waitForEl(page, '#renderCanvas')

  await page.click('#btn-scene-basic')
  await page.click('#btn-speed-4x')

  await pollFor(
    page,
    () => (window as any).__testHarness.getCaptureComplete(),
    30000,
    500,
  )

  await page.waitForTimeout(200)

  await expect(page.locator('#stat-line-color')).toHaveText('无')

  await screenshot(page, 'E7-line-disappears')
})

test('BOUNDARY: Rapid preset switching - no crash', async ({ page }) => {
  await page.goto(BASE_URL)
  await waitForEl(page, '#renderCanvas')

  const errors: string[] = []
  page.on('pageerror', (err) => errors.push(err.message))
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text())
  })

  await page.click('#btn-scene-basic')
  await page.waitForTimeout(500)
  await page.click('#btn-scene-consumed')
  await page.waitForTimeout(500)
  await page.click('#btn-scene-sabotage')
  await page.waitForTimeout(500)
  await page.click('#btn-scene-cancel')
  await page.waitForTimeout(500)
  await page.click('#btn-reset')
  await page.waitForTimeout(1000)

  const canvas = await page.locator('#renderCanvas')
  await expect(canvas).toBeVisible()
  expect(errors).toHaveLength(0)

  await screenshot(page, 'B1-rapid-switching')
})

test('BOUNDARY: Pause/resume during capture', async ({ page }) => {
  await page.goto(BASE_URL)
  await waitForEl(page, '#renderCanvas')

  await page.click('#btn-scene-basic')
  await page.click('#btn-speed-1x')
  await page.click('#btn-pause')

  await page.waitForTimeout(2000)

  // Even while paused the render loop still runs, so FPS should be displayed
  const fpsText = await page.locator('#info-fps').textContent()
  expect(fpsText).not.toBe('-')
  expect(Number(fpsText)).toBeGreaterThan(0)

  await page.click('#btn-resume')
  await page.click('#btn-speed-4x')

  await pollFor(
    page,
    () => (window as any).__testHarness.getCaptureComplete(),
    30000,
    500,
  )

  const owner = await page.evaluate(() => (window as any).__testHarness.getBuildingOwner())
  expect(owner).toBe('friendly')

  await screenshot(page, 'B2-pause-resume')
})

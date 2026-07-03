import { test, expect, type Page } from '@playwright/test'
import * as fs from 'fs'
import * as path from 'path'

const BASE_URL = 'http://localhost:5173/test/ch14-activities/turn/'
const EVIDENCE_DIR = path.resolve(
  process.env.PLAYWRIGHT_OUTPUT_DIR || 'test-results',
  'manual/ch14-activities/turn/evidence'
)

const WANGLE_FULL = 1024

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ensureEvidenceDir() {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true })
}

async function screenshot(page: Page, name: string) {
  await page.screenshot({
    path: path.join(EVIDENCE_DIR, `${name}.png`),
    fullPage: false,
  })
}

function wAngleDiff(from: number, to: number): number {
  let diff = ((to - from + WANGLE_FULL) % WANGLE_FULL)
  if (diff > WANGLE_FULL / 2) diff -= WANGLE_FULL
  return diff
}

async function waitForHarnessReady(page: Page) {
  await page.waitForSelector('#info-engine', { state: 'visible' })
  await expect(page.locator('#info-engine')).toContainText('WebGL', { timeout: 15000 })
  await page.waitForFunction(
    () => {
      const h = (window as any).__testHarness
      return h && h.scene && h.engine && h.camera
    },
    { timeout: 15000 }
  )
}

async function waitForTurnComplete(page: Page, timeoutMs = 15000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const complete = await page.evaluate(() => (window as any).__testHarness?.isTurnComplete?.())
    if (complete) return
    await page.waitForTimeout(50)
  }
  throw new Error('Turn did not complete within timeout')
}

async function getFacing(page: Page): Promise<number> {
  return page.evaluate(() => (window as any).__testHarness.getFacing())
}

async function getDesiredFacing(page: Page): Promise<number> {
  return page.evaluate(() => (window as any).__testHarness.getDesiredFacing())
}

async function isTurnComplete(page: Page): Promise<boolean> {
  return page.evaluate(() => (window as any).__testHarness.isTurnComplete())
}

async function getTurnCount(page: Page): Promise<number> {
  return page.evaluate(() => (window as any).__testHarness.getTurnCount())
}

async function getUnit(page: Page): Promise<any> {
  return page.evaluate(() => (window as any).__testHarness.getUnit())
}

async function getCurrentTurnFrames(page: Page): Promise<number> {
  const unit = await getUnit(page)
  return unit.currentTurnFrames
}

async function startTurn(page: Page, wangle: number) {
  await page.evaluate(({ wangle }) => (window as any).__testHarness.startTurn(wangle), { wangle })
}

async function resetTurnTest(page: Page) {
  // Ensure render loop is running and speed is 1x for deterministic frame counts
  await page.locator('#btn-resume').click()
  await page.locator('#btn-speed-1x').click()
  await page.locator('#btn-turn-normal').click()
  await page.locator('#btn-reset').click()
  await page.waitForTimeout(200)
}

async function statTurnState(page: Page): Promise<string | null> {
  return page.locator('#stat-turn-state').textContent()
}

async function statCurrentFacing(page: Page): Promise<string | null> {
  return page.locator('#stat-current-facing').textContent()
}

async function statDesiredFacing(page: Page): Promise<string | null> {
  return page.locator('#stat-desired-facing').textContent()
}

async function statAngleDiff(page: Page): Promise<string | null> {
  return page.locator('#stat-angle-diff').textContent()
}

async function statTurnSpeed(page: Page): Promise<string | null> {
  return page.locator('#stat-turn-speed').textContent()
}

async function statCompletionFrames(page: Page): Promise<string | null> {
  return page.locator('#stat-completion-frames').textContent()
}

async function statTurnCount(page: Page): Promise<string | null> {
  return page.locator('#stat-turn-count').textContent()
}

async function hasTargetIndicator(page: Page): Promise<boolean> {
  return page.evaluate(() =>
    (window as any).__testHarness.scene.meshes.some((m: any) => m.name === 'targetIndicator')
  )
}

async function hasArcLine(page: Page): Promise<boolean> {
  return page.evaluate(() =>
    (window as any).__testHarness.scene.meshes.some((m: any) => m.name === 'arcLine')
  )
}

async function hasCompleteMarker(page: Page): Promise<boolean> {
  return page.evaluate(() =>
    (window as any).__testHarness.scene.meshes.some((m: any) => m.name === 'completeMarker')
  )
}

/**
 * Project a world ground position to canvas client coordinates and dispatch a click.
 */
async function clickGroundAtWorld(page: Page, wx: number, wz: number) {
  await page.evaluate(
    ({ wx, wz }) => {
      const canvas = document.getElementById('renderCanvas') as HTMLCanvasElement
      const h = (window as any).__testHarness
      const camera = h.camera
      const engine = h.engine

      function transform(
        m: number[],
        v: { x: number; y: number; z: number; w: number }
      ) {
        return {
          x: m[0] * v.x + m[4] * v.y + m[8] * v.z + m[12] * v.w,
          y: m[1] * v.x + m[5] * v.y + m[9] * v.z + m[13] * v.w,
          z: m[2] * v.x + m[6] * v.y + m[10] * v.z + m[14] * v.w,
          w: m[3] * v.x + m[7] * v.y + m[11] * v.z + m[15] * v.w,
        }
      }

      function project(worldX: number, worldY: number, worldZ: number) {
        const view = camera.getViewMatrix().m as number[]
        const proj = camera.getProjectionMatrix().m as number[]
        const width = engine.getRenderWidth()
        const height = engine.getRenderHeight()
        const v = transform(view, { x: worldX, y: worldY, z: worldZ, w: 1 })
        const c = transform(proj, v)
        return {
          x: (c.x / c.w * 0.5 + 0.5) * width,
          y: (1 - (c.y / c.w * 0.5 + 0.5)) * height,
        }
      }

      const rect = canvas.getBoundingClientRect()
      const p = project(wx, 0, wz)
      const evt = new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        clientX: rect.left + p.x,
        clientY: rect.top + p.y,
      })
      canvas.dispatchEvent(evt)
    },
    { wx, wz }
  )
}

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

test.use({ viewport: { width: 1280, height: 720 } })
test.setTimeout(120000)

test.describe('CH14 Activities - Turn', () => {
  const consoleErrors: string[] = []
  const pageErrors: string[] = []

  test.beforeAll(() => {
    ensureEvidenceDir()
  })

  test.beforeEach(async ({ page }) => {
    consoleErrors.length = 0
    pageErrors.length = 0

    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text())
    })
    page.on('pageerror', (err) => pageErrors.push(err.message))

    await page.goto(BASE_URL)
    await page.waitForLoadState('networkidle')
    await waitForHarnessReady(page)
    await page.locator('#renderCanvas').waitFor({ state: 'visible' })
    await resetTurnTest(page)
  })

  test.afterEach(async ({}, testInfo) => {
    if (consoleErrors.length > 0) {
      testInfo.attach('console-errors.txt', {
        body: consoleErrors.join('\n'),
        contentType: 'text/plain',
      })
    }
    if (pageErrors.length > 0) {
      testInfo.attach('page-errors.txt', {
        body: pageErrors.join('\n'),
        contentType: 'text/plain',
      })
    }
  })

  // ===========================================================================
  // E1: Shortest Arc Turn (BLOCKER)
  // ===========================================================================
  test('E1: shortest arc from North to East goes 256 WAngle clockwise', async ({ page }) => {
    const startFacing = await getFacing(page)
    expect(startFacing).toBe(0)
    expect(await isTurnComplete(page)).toBe(true)

    // Use slow speed so the turn lasts long enough to observe the arc.
    await page.locator('#btn-turn-slow').click()
    await page.waitForTimeout(100)

    await page.locator('#btn-turn-east').click()

    const desired = await getDesiredFacing(page)
    expect(desired).toBe(768)

    // Verify via harness that the shortest-arc difference is 256, not 768.
    const initialDiff = wAngleDiff(startFacing, desired)
    expect(Math.abs(initialDiff)).toBe(256)
    expect(initialDiff).toBeLessThan(0) // clockwise direction via wrap

    // Verify turn is in progress (tickTurn runs before updateStatsPanel,
    // so the initial -256 diff becomes -252 by the first DOM update; we only
    // check that the turn has started and is not yet complete).
    expect(await isTurnComplete(page)).toBe(false)
    await expect.poll(async () => await statAngleDiff(page)).not.toContain('0 (0°')
    await screenshot(page, 'e1-shortest-arc-start')

    // Wait a short moment and confirm we are moving along the shortest path
    // (facing should decrease through the 1024 boundary, e.g. 0 -> 1016 -> ...)
    await page.waitForTimeout(300)
    const midFacing = await getFacing(page)
    const midDiff = wAngleDiff(midFacing, desired)
    expect(Math.abs(midDiff)).toBeLessThan(256)
    expect(midDiff).toBeLessThanOrEqual(0)

    await waitForTurnComplete(page)
    expect(await getFacing(page)).toBe(768)
    expect(await statTurnState(page)).toBe('完成')
    await screenshot(page, 'e1-shortest-arc-complete')
  })

  // ===========================================================================
  // E2: WAngle Coordinate System (BLOCKER)
  // ===========================================================================
  test('E2: preset directions map to correct WAngle values', async ({ page }) => {
    const directions = [
      { id: '#btn-turn-north', wangle: 0, label: '北' },
      { id: '#btn-turn-west', wangle: 256, label: '西' },
      { id: '#btn-turn-south', wangle: 512, label: '南' },
      { id: '#btn-turn-east', wangle: 768, label: '东' },
    ]

    for (const dir of directions) {
      await page.locator(dir.id).click()
      await waitForTurnComplete(page)

      expect(await getFacing(page)).toBe(dir.wangle)
      expect(await statTurnState(page)).toBe('完成')
      expect(await statCurrentFacing(page)).toContain(String(dir.wangle))
      expect(await statAngleDiff(page)).toContain('0')

      await screenshot(page, `e2-direction-${dir.label}`)
    }
  })

  // ===========================================================================
  // E3: Turn Speed Verification (MAJOR)
  // ===========================================================================
  test('E3: completion frames scale correctly with turnSpeed', async ({ page }) => {
    const cases = [
      { speedBtn: '#btn-turn-slow', speed: 4, expectedFrames: 128, tolerance: 2 },
      { speedBtn: '#btn-turn-normal', speed: 8, expectedFrames: 64, tolerance: 2 },
      { speedBtn: '#btn-turn-fast', speed: 16, expectedFrames: 32, tolerance: 2 },
      { speedBtn: '#btn-turn-instant', speed: 256, expectedFrames: 2, tolerance: 1 },
    ]

    for (const c of cases) {
      await resetTurnTest(page)

      await page.locator(c.speedBtn).click()
      await page.waitForTimeout(100)
      expect(await statTurnSpeed(page)).toContain(String(c.speed))

      await page.locator('#btn-turn-south').click()
      await waitForTurnComplete(page, 20000)

      const actualFrames = await getCurrentTurnFrames(page)
      expect(Math.abs(actualFrames - c.expectedFrames)).toBeLessThanOrEqual(c.tolerance)
      expect(await getFacing(page)).toBe(512)

      await screenshot(page, `e3-speed-${c.speed}`)
    }
  })

  // ===========================================================================
  // E4: Completion Detection (BLOCKER)
  // ===========================================================================
  test('E4: completion updates state, counters and visual markers correctly', async ({ page }) => {
    const turnCountBefore = await getTurnCount(page)

    await page.locator('#btn-turn-southwest').click()
    await page.waitForTimeout(100)
    expect(await isTurnComplete(page)).toBe(false)
    expect(await hasTargetIndicator(page)).toBe(true)
    expect(await hasArcLine(page)).toBe(true)
    expect(await hasCompleteMarker(page)).toBe(false)

    await waitForTurnComplete(page)

    expect(await getFacing(page)).toBe(384)
    expect(await isTurnComplete(page)).toBe(true)
    expect(await getTurnCount(page)).toBe(turnCountBefore + 1)
    expect(await statTurnState(page)).toBe('完成')
    expect(await statCurrentFacing(page)).toContain('384')
    expect(await hasTargetIndicator(page)).toBe(false)
    expect(await hasArcLine(page)).toBe(false)
    expect(await hasCompleteMarker(page)).toBe(true)

    await screenshot(page, 'e4-complete')
  })

  // ===========================================================================
  // E5: Mobile Disabled/Paused (MAJOR)
  // ===========================================================================
  test('E5: Mobile disabled and paused states halt and resume turning', async ({ page }) => {
    // Use slow speed so we have time to toggle mid-turn
    await page.locator('#btn-turn-slow').click()
    await page.waitForTimeout(100)

    // --- Disabled ---
    await page.locator('#btn-turn-south').click()
    await page.waitForTimeout(200)
    await page.locator('#btn-toggle-disabled').click()

    // DOM updates asynchronously on the render loop; poll for the disabled state.
    await expect.poll(async () => await statTurnState(page)).toBe('禁用')
    const facingWhenDisabled = await getFacing(page)
    expect(facingWhenDisabled).not.toBe(512)

    await page.waitForTimeout(600)
    expect(await getFacing(page)).toBe(facingWhenDisabled)

    await page.locator('#btn-toggle-disabled').click()
    await waitForTurnComplete(page)
    expect(await getFacing(page)).toBe(512)
    expect(await statTurnState(page)).toBe('完成')
    await screenshot(page, 'e5-disabled-resumed')

    // --- Paused ---
    await resetTurnTest(page)
    await page.locator('#btn-turn-slow').click()
    await page.waitForTimeout(100)

    await page.locator('#btn-turn-south').click()
    await page.waitForTimeout(200)
    await page.locator('#btn-toggle-paused').click()

    await expect.poll(async () => await statTurnState(page)).toBe('暂停')
    const facingWhenPaused = await getFacing(page)
    expect(facingWhenPaused).not.toBe(512)

    await page.waitForTimeout(600)
    expect(await getFacing(page)).toBe(facingWhenPaused)

    await page.locator('#btn-toggle-paused').click()
    await waitForTurnComplete(page)
    expect(await getFacing(page)).toBe(512)
    expect(await statTurnState(page)).toBe('完成')
    await screenshot(page, 'e5-paused-resumed')
  })

  // ===========================================================================
  // E6: Click Ground to Turn (BLOCKER)
  // ===========================================================================
  test('E6: clicking ground east of the unit starts a turn toward East', async ({ page }) => {
    expect(await isTurnComplete(page)).toBe(true)

    // Unit is centered at (10.5, 0, 10.5); click on ground to the east
    await clickGroundAtWorld(page, 16.5, 10.5)
    await page.waitForTimeout(200)

    expect(await isTurnComplete(page)).toBe(false)
    expect(await hasTargetIndicator(page)).toBe(true)
    expect(await hasArcLine(page)).toBe(true)

    const desired = await getDesiredFacing(page)
    expect(Math.abs(wAngleDiff(desired, 768))).toBeLessThanOrEqual(32)

    await waitForTurnComplete(page)
    expect(await getFacing(page)).toBe(desired)
    await screenshot(page, 'e6-click-ground')
  })

  // ===========================================================================
  // Edge: 360-degree turn (same facing)
  // ===========================================================================
  test('Edge: turning to current facing completes immediately', async ({ page }) => {
    expect(await getFacing(page)).toBe(0)
    expect(await isTurnComplete(page)).toBe(true)

    await page.locator('#btn-turn-north').click()
    await page.waitForTimeout(200)

    expect(await isTurnComplete(page)).toBe(true)
    expect(await getFacing(page)).toBe(0)
    expect(await getCurrentTurnFrames(page)).toBe(0)
    expect(await statTurnState(page)).toBe('完成')
    await screenshot(page, 'edge-360-turn')
  })

  // ===========================================================================
  // Edge: Continuous rapid turns
  // ===========================================================================
  test('Edge: continuous rapid turns complete without crashes', async ({ page }) => {
    const directions = [
      '#btn-turn-east',
      '#btn-turn-south',
      '#btn-turn-west',
      '#btn-turn-north',
    ]
    const startCount = await getTurnCount(page)

    for (const id of directions) {
      await page.locator(id).click()
      await waitForTurnComplete(page)
    }

    expect(await getFacing(page)).toBe(0)
    expect(await getTurnCount(page)).toBe(startCount + directions.length)
    expect(await statTurnState(page)).toBe('完成')
    expect(consoleErrors).toHaveLength(0)
    expect(pageErrors).toHaveLength(0)
    await screenshot(page, 'edge-rapid-turns')
  })
})

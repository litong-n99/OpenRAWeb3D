import { test, expect, Page } from '@playwright/test'
import * as fs from 'fs'
import * as path from 'path'

const BASE_URL = 'http://localhost:5173/test/ch14-activities/move/'
const SCREENSHOT_DIR = path.join('tests-e2e', 'ch14-activities', 'move', 'evidence')

function ensureScreenshotDir() {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true })
}

async function screenshot(page: Page, name: string) {
  await page.screenshot({
    path: path.join(SCREENSHOT_DIR, `${name}.png`),
    fullPage: false,
  })
}

async function clickCell(
  page: Page,
  gx: number,
  gy: number,
  options: { ctrl?: boolean } = {}
) {
  await page.evaluate(
    ({ gx, gy, ctrl }) => {
      const canvas = document.getElementById('renderCanvas') as HTMLCanvasElement
      const h = (window as any).__testHarness
      const camera = h.camera
      const engine = h.engine

      function project(wx: number, wy: number, wz: number) {
        const view = camera.getViewMatrix().m as number[]
        const proj = camera.getProjectionMatrix().m as number[]
        const width = engine.getRenderWidth()
        const height = engine.getRenderHeight()

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

        const v = transform(view, { x: wx, y: wy, z: wz, w: 1 })
        const c = transform(proj, v)
        const ndcX = c.x / c.w
        const ndcY = c.y / c.w
        return {
          x: (ndcX * 0.5 + 0.5) * width,
          y: (1 - (ndcY * 0.5 + 0.5)) * height,
        }
      }

      const rect = canvas.getBoundingClientRect()
      const p = project(gx + 0.5, 0, gy + 0.5)
      const evt = new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        clientX: rect.left + p.x,
        clientY: rect.top + p.y,
        ctrlKey: !!ctrl,
      })
      canvas.dispatchEvent(evt)
    },
    { gx, gy, ctrl: options.ctrl ?? false }
  )
}

async function getCell(page: Page) {
  return page.evaluate(() => (window as any).__testHarness.getCell())
}

async function getPath(page: Page) {
  return page.evaluate(() => (window as any).__testHarness.getPath())
}

async function isMoving(page: Page) {
  return page.evaluate(() => (window as any).__testHarness.isMoving())
}

async function getFacing(page: Page) {
  return page.evaluate(() => (window as any).__testHarness.getFacing())
}

async function getMovePhase(page: Page) {
  return page.evaluate(() => (window as any).__testHarness.unit.movePhase)
}

async function gridWalkable(page: Page, x: number, y: number) {
  return page.evaluate(
    ({ x, y }) => (window as any).__testHarness.grid[y][x].walkable,
    { x, y }
  )
}

async function getSpeedMultiplier(page: Page) {
  return page.evaluate(() => {
    if (document.getElementById('btn-speed-4x')?.classList.contains('active')) return 4
    if (document.getElementById('btn-speed-2x')?.classList.contains('active')) return 2
    return 1
  })
}

async function sampleMovement(page: Page, durationMs: number) {
  return page.evaluate(
    ({ durationMs }) => {
      const h = (window as any).__testHarness
      const samples: Array<{
        t: number
        phase: string
        progress: number
        distance: number
        x: number
        z: number
        facing: number
        pathIndex: number
      }> = []
      return new Promise<typeof samples>((resolve) => {
        const start = performance.now()
        const frame = () => {
          const now = performance.now()
          const u = h.unit
          samples.push({
            t: now - start,
            phase: u.movePhase,
            progress: u.progress,
            distance: u.distance,
            x: u.posX,
            z: u.posZ,
            facing: u.facing,
            pathIndex: u.pathIndex,
          })
          if (now - start < durationMs) {
            requestAnimationFrame(frame)
          } else {
            resolve(samples)
          }
        }
        requestAnimationFrame(frame)
      })
    },
    { durationMs }
  )
}

async function statState(page: Page) {
  return page.locator('#stat-state').textContent()
}

async function waitForArrival(page: Page, timeout = 30000) {
  await expect.poll(async () => await isMoving(page), { timeout }).toBe(false)
}

test.use({ viewport: { width: 1280, height: 720 } })
test.setTimeout(120000)

test.beforeAll(() => {
  ensureScreenshotDir()
})

test.describe('Move Activity Acceptance Tests', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL)
    await page.waitForLoadState('networkidle')
    await page.waitForFunction(() => !!(window as any).__testHarness)
    await page.locator('#renderCanvas').waitFor({ state: 'visible' })
    await page.locator('#btn-scene-empty').click()
    await page.locator('#btn-reset-unit').click()
    await page.waitForTimeout(500)
  })

  test('E1: Path Following', async ({ page }) => {
    expect(await getCell(page)).toEqual({ x: 2, y: 10 })

    const target = { x: 10, y: 10 }
    await clickCell(page, target.x, target.y)
    await page.waitForTimeout(200)

    await expect
      .poll(async () => (await getPath(page)).length, { timeout: 2000 })
      .toBeGreaterThan(0)
    expect(await isMoving(page)).toBe(true)

    const path = await getPath(page)
    expect(path[0]).toEqual({ x: 2, y: 10 })
    expect(path[path.length - 1]).toEqual(target)

    await waitForArrival(page, 30000)

    expect(await statState(page)).toBe('空闲')
    expect(await getCell(page)).toEqual(target)
    await screenshot(page, 'e1-path-following-arrived')
  })

  test('E2: Facing and Turning', async ({ page }) => {
    const target = { x: 10, y: 2 }
    const startFacing = await getFacing(page)

    await clickCell(page, target.x, target.y)

    await expect
      .poll(async () => await statState(page), { timeout: 3000 })
      .toBe('转向中')
    await screenshot(page, 'e2-turning')

    const turningFacing = await getFacing(page)
    expect(turningFacing).not.toEqual(startFacing)

    await expect
      .poll(async () => await statState(page), { timeout: 5000 })
      .toContain('移动')
    expect(['移动前半段', '移动后半段']).toContain(await statState(page))

    await waitForArrival(page, 30000)

    const finalFacing = await getFacing(page)
    expect(Math.abs(finalFacing - 896)).toBeLessThanOrEqual(8)
    expect(await statState(page)).toBe('空闲')
    expect(await getCell(page)).toEqual(target)
    await screenshot(page, 'e2-facing-turning-arrived')
  })

  test('E3: Two-Phase Movement', async ({ page }) => {
    const target = { x: 15, y: 10 }
    await clickCell(page, target.x, target.y)
    await page.waitForTimeout(100)

    const [samples, states] = await Promise.all([
      sampleMovement(page, 12000),
      (async () => {
        const states = new Set<string>()
        const deadline = Date.now() + 12000
        while (Date.now() < deadline && (await isMoving(page))) {
          states.add((await statState(page)) ?? '')
          await page.waitForTimeout(50)
        }
        return states
      })(),
    ])

    await screenshot(page, 'e3-two-phase-movement')

    const phases = samples.map((s) => s.phase)
    expect(phases).toContain('firstHalf')
    expect(phases).toContain('secondHalf')
    expect(phases[phases.length - 1]).toBe('idle')

    expect(states.has('移动前半段')).toBe(true)
    expect(states.has('移动后半段')).toBe(true)

    let maxDelta = 0
    for (let i = 1; i < samples.length; i++) {
      const dx = samples[i].x - samples[i - 1].x
      const dz = samples[i].z - samples[i - 1].z
      const d = Math.sqrt(dx * dx + dz * dz)
      if (d > maxDelta) maxDelta = d
    }
    expect(maxDelta).toBeLessThanOrEqual(0.15)

    const progressSamples = samples.filter(
      (s) => s.phase === 'firstHalf' || s.phase === 'secondHalf'
    )
    expect(progressSamples.length).toBeGreaterThan(0)
    for (const s of progressSamples) {
      expect(s.progress).toBeGreaterThanOrEqual(0)
      expect(s.progress).toBeLessThanOrEqual(s.distance + 0.001)
    }

    await waitForArrival(page, 30000)
    expect(await statState(page)).toBe('空闲')
    expect(await getCell(page)).toEqual(target)
  })

  test('E4: Obstacle Avoidance', async ({ page }) => {
    await page.locator('#btn-scene-maze').click()
    await page.waitForTimeout(500)

    await screenshot(page, 'e4-maze-scene')

    const target = { x: 18, y: 2 }
    await clickCell(page, target.x, target.y)

    await expect
      .poll(async () => (await getPath(page)).length, { timeout: 2000 })
      .toBeGreaterThan(0)

    const path = await getPath(page)
    for (const p of path) {
      expect(await gridWalkable(page, p.x, p.y)).toBe(true)
    }
    expect(path.length).toBeGreaterThan(18)

    await screenshot(page, 'e4-obstacle-avoidance-path')

    await waitForArrival(page, 30000)
    expect(await getCell(page)).toEqual(target)
    expect(await statState(page)).toBe('空闲')
    await screenshot(page, 'e4-obstacle-avoidance-arrived')
  })

  test('E5: Speed Control', async ({ page }) => {
    await page.locator('#btn-speed-2x').click()
    await page.waitForTimeout(100)
    await expect(page.locator('#btn-speed-2x')).toHaveClass(/active/)
    expect(await getSpeedMultiplier(page)).toBe(2)

    const target = { x: 12, y: 10 }
    await clickCell(page, target.x, target.y)
    await page.waitForTimeout(600)

    const posStart = await page.evaluate(() => {
      const u = (window as any).__testHarness.unit
      return { x: u.posX, z: u.posZ }
    })
    await page.waitForTimeout(500)
    const posMid = await page.evaluate(() => {
      const u = (window as any).__testHarness.unit
      return { x: u.posX, z: u.posZ }
    })
    expect(
      Math.abs(posMid.x - posStart.x) + Math.abs(posMid.z - posStart.z)
    ).toBeGreaterThan(0.05)

    await page.locator('#btn-pause').click()
    await page.waitForTimeout(200)
    const posPause = await page.evaluate(() => {
      const u = (window as any).__testHarness.unit
      return { x: u.posX, z: u.posZ }
    })
    await page.waitForTimeout(800)
    const posPaused2 = await page.evaluate(() => {
      const u = (window as any).__testHarness.unit
      return { x: u.posX, z: u.posZ }
    })
    expect(Math.abs(posPause.x - posPaused2.x)).toBeLessThan(0.01)
    expect(Math.abs(posPause.z - posPaused2.z)).toBeLessThan(0.01)
    expect(await isMoving(page)).toBe(true)

    await page.locator('#btn-resume').click()
    await page.waitForTimeout(500)
    const posResume = await page.evaluate(() => {
      const u = (window as any).__testHarness.unit
      return { x: u.posX, z: u.posZ }
    })
    expect(
      Math.abs(posResume.x - posPaused2.x) + Math.abs(posResume.z - posPaused2.z)
    ).toBeGreaterThan(0.03)

    await waitForArrival(page, 15000)

    async function measureTrip(speedButton: string) {
      await page.locator('#btn-reset-unit').click()
      await page.locator(speedButton).click()
      await page.waitForTimeout(100)
      const start = Date.now()
      await clickCell(page, target.x, target.y)
      await waitForArrival(page, 15000)
      return Date.now() - start
    }

    const t1 = await measureTrip('#btn-speed-1x')
    await screenshot(page, 'e5-speed-1x')

    const t2 = await measureTrip('#btn-speed-2x')
    await screenshot(page, 'e5-speed-2x')

    const t4 = await measureTrip('#btn-speed-4x')
    await screenshot(page, 'e5-speed-4x')

    expect(t2).toBeLessThan(t1 * 0.65)
    expect(t4).toBeLessThan(t2 * 0.65)
    expect(t4).toBeLessThan(t1 * 0.35)
  })

  test('E6: Edge Cases', async ({ page }) => {
    await clickCell(page, 12, 10)
    await page.waitForTimeout(120)
    await clickCell(page, 5, 5)
    await page.waitForTimeout(120)
    await clickCell(page, 15, 15)

    await waitForArrival(page, 30000)
    expect(await getCell(page)).toEqual({ x: 15, y: 15 })
    expect(await statState(page)).toBe('空闲')
    await screenshot(page, 'e6-rapid-clicks')

    await page.locator('#btn-reset-unit').click()
    await page.locator('#btn-scene-maze').click()
    await page.waitForTimeout(300)

    await clickCell(page, 8, 8, { ctrl: true })
    await page.waitForTimeout(200)
    expect(await gridWalkable(page, 8, 8)).toBe(false)

    await clickCell(page, 8, 8)
    await page.waitForTimeout(300)
    expect(await isMoving(page)).toBe(false)
    expect((await getPath(page)).length).toBe(0)
    expect(await getCell(page)).toEqual({ x: 2, y: 10 })
    await screenshot(page, 'e6-obstacle-target')

    await page.locator('#btn-reset-unit').click()
    await page.locator('#btn-scene-empty').click()
    await page.locator('#btn-speed-4x').click()
    await page.waitForTimeout(100)

    await clickCell(page, 18, 2)
    await page.waitForTimeout(100)

    const samples = await sampleMovement(page, 10000)
    await screenshot(page, 'e6-4x-long-distance')

    let maxPathIndexJump = 0
    for (let i = 1; i < samples.length; i++) {
      const diff = samples[i].pathIndex - samples[i - 1].pathIndex
      if (diff > maxPathIndexJump) maxPathIndexJump = diff
    }
    expect(maxPathIndexJump).toBeLessThanOrEqual(1)

    let maxDelta = 0
    for (let i = 1; i < samples.length; i++) {
      const dx = samples[i].x - samples[i - 1].x
      const dz = samples[i].z - samples[i - 1].z
      const d = Math.sqrt(dx * dx + dz * dz)
      if (d > maxDelta) maxDelta = d
    }
    expect(maxDelta).toBeLessThanOrEqual(0.4)

    await waitForArrival(page, 15000)
    expect(await getCell(page)).toEqual({ x: 18, y: 2 })
    expect(await statState(page)).toBe('空闲')
  })
})

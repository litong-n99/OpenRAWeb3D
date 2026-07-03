import { test, expect, type Page } from '@playwright/test'
import * as fs from 'fs'
import * as path from 'path'

const BASE_URL = 'http://localhost:5173/test/ch14-activities/move/'
const EVIDENCE_DIR = path.resolve(
  process.env.PLAYWRIGHT_OUTPUT_DIR || 'test-results',
  'evidence'
)

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

async function getPath(page: Page) {
  return page.evaluate(() => (window as any).__testHarness.getPath())
}

async function isMoving(page: Page) {
  return page.evaluate(() => (window as any).__testHarness.isMoving())
}

async function getCell(page: Page) {
  return page.evaluate(() => (window as any).__testHarness.getCell())
}

async function getFacing(page: Page) {
  return page.evaluate(() => (window as any).__testHarness.getFacing())
}

async function gridWalkable(page: Page, x: number, y: number) {
  return page.evaluate(
    ({ x, y }) => (window as any).__testHarness.grid[y][x].walkable,
    { x, y }
  )
}

async function getUnitPosition(page: Page) {
  return page.evaluate(() => {
    const u = (window as any).__testHarness.unit
    return { x: u.posX, z: u.posZ }
  })
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

async function statTarget(page: Page) {
  return page.locator('#stat-target').textContent()
}

async function statPathLen(page: Page) {
  return page.locator('#stat-path-len').textContent()
}

async function waitForArrival(page: Page, timeout = 30000) {
  await expect.poll(async () => await isMoving(page), { timeout }).toBe(false)
}

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

test.use({ viewport: { width: 1280, height: 720 } })
test.setTimeout(120000)

test.beforeAll(() => {
  ensureEvidenceDir()
})

test.beforeEach(async ({ page }) => {
  await page.goto(BASE_URL)
  await page.waitForLoadState('networkidle')
  await page.waitForFunction(() => !!(window as any).__testHarness)
  await page.locator('#renderCanvas').waitFor({ state: 'visible' })
  await page.locator('#btn-scene-empty').click()
  await page.locator('#btn-reset-unit').click()
  await page.waitForTimeout(300)
})

// ---------------------------------------------------------------------------
// E1. 路径跟随
// ---------------------------------------------------------------------------

test.describe('E1 路径跟随', () => {
  test('空场景东西向直线路径长度正确且单位到达目标', async ({ page }) => {
    expect(await getCell(page)).toEqual({ x: 2, y: 10 })
    await screenshot(page, 'e1-start')

    const target = { x: 12, y: 10 }
    await clickCell(page, target.x, target.y)
    await screenshot(page, 'e1-target-set')

    await expect.poll(async () => (await getPath(page)).length, {
      timeout: 2000,
    }).toBeGreaterThan(0)
    expect(await isMoving(page)).toBe(true)

    const path = await getPath(page)
    expect(path[0]).toEqual({ x: 2, y: 10 })
    expect(path[path.length - 1]).toEqual(target)
    expect(path.length).toBe(11)

    expect(await statTarget(page)).toContain(`(${target.x}, ${target.y})`)
    expect(await statPathLen(page)).toContain('格剩余')

    await waitForArrival(page)

    expect(await getCell(page)).toEqual(target)
    expect(await statState(page)).toBe('空闲')
    await screenshot(page, 'e1-arrived')
  })

  test('南北向路径起点与终点正确', async ({ page }) => {
    const target = { x: 2, y: 2 }
    await clickCell(page, target.x, target.y)

    const path = await getPath(page)
    expect(path[0]).toEqual({ x: 2, y: 10 })
    expect(path[path.length - 1]).toEqual(target)
    expect(path.length).toBe(9)

    await waitForArrival(page)
    expect(await getCell(page)).toEqual(target)
    expect(await statState(page)).toBe('空闲')
  })
})

// ---------------------------------------------------------------------------
// E2. 朝向与转向
// ---------------------------------------------------------------------------

test.describe('E2 朝向与转向', () => {
  test('对角线东北目标最终朝向接近 896', async ({ page }) => {
    const target = { x: 10, y: 2 }
    const startFacing = await getFacing(page)

    await clickCell(page, target.x, target.y)
    await screenshot(page, 'e2-diagonal-target-set')

    await expect.poll(async () => await statState(page), {
      timeout: 3000,
    }).toBe('转向中')

    const turningFacing = await getFacing(page)
    expect(turningFacing).not.toEqual(startFacing)

    await expect.poll(async () => await statState(page), {
      timeout: 5000,
    }).toContain('移动')

    await waitForArrival(page)

    const finalFacing = await getFacing(page)
    expect(Math.abs(finalFacing - 896)).toBeLessThanOrEqual(8)
    expect(await statState(page)).toBe('空闲')
    expect(await getCell(page)).toEqual(target)
    await screenshot(page, 'e2-diagonal-arrived')
  })

  test('转弯路径经历转向中阶段且无朝向跳变', async ({ page }) => {
    // First, move north (straight line, no turning needed since unit faces north)
    await clickCell(page, 2, 2)
    await waitForArrival(page)
    await screenshot(page, 'e2-north-arrived')

    // Start sampling BEFORE east click so turning phase is captured
    const samplesPromise = sampleMovement(page, 15000)
    await page.waitForTimeout(200)
    // Dispatch east click while sampling is active
    await clickCell(page, 18, 2)

    const samples = await samplesPromise
    const turningSamples = samples.filter((s) => s.phase === 'turning')
    expect(turningSamples.length).toBeGreaterThan(0)

    // 转向阶段每帧朝向变化量不应超过 10 WAngle (accounting for 0/1024 wrap)
    function wAngleAbsDiff(a: number, b: number): number {
      let diff = ((b - a + 1024) % 1024)
      if (diff > 512) diff = 1024 - diff
      return diff
    }
    let maxTurnDelta = 0
    for (let i = 1; i < turningSamples.length; i++) {
      const d = wAngleAbsDiff(turningSamples[i - 1].facing, turningSamples[i].facing)
      if (d > maxTurnDelta) maxTurnDelta = d
    }
    expect(maxTurnDelta).toBeLessThanOrEqual(10)

    // Verify final state after east movement
    await waitForArrival(page, 20000)
    expect(await getCell(page)).toEqual({ x: 18, y: 2 })
    expect(await statState(page)).toBe('空闲')
    await screenshot(page, 'e2-east-arrived')
  })
})

// ---------------------------------------------------------------------------
// E3. 两段式移动连续性
// ---------------------------------------------------------------------------

test.describe('E3 两段式移动连续性', () => {
  test('移动阶段顺序为 firstHalf -> secondHalf -> idle 且无位置跳变', async ({ page }) => {
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

    await screenshot(page, 'e3-continuity')

    const phases = samples.map((s) => s.phase)
    expect(phases).toContain('firstHalf')
    expect(phases).toContain('secondHalf')
    expect(phases[phases.length - 1]).toBe('idle')

    expect(states.has('移动前半段')).toBe(true)
    expect(states.has('移动后半段')).toBe(true)

    // firstHalf -> secondHalf 切换时 progress carryover 应正确带入
    for (let i = 1; i < samples.length; i++) {
      if (
        samples[i - 1].phase === 'firstHalf' &&
        samples[i].phase === 'secondHalf'
      ) {
        expect(samples[i].progress).toBeGreaterThan(0)
        expect(samples[i].progress).toBeLessThan(0.1)
      }
    }

    // 相邻采样帧位置跳变不应过大
    let maxDelta = 0
    for (let i = 1; i < samples.length; i++) {
      const dx = samples[i].x - samples[i - 1].x
      const dz = samples[i].z - samples[i - 1].z
      const d = Math.sqrt(dx * dx + dz * dz)
      if (d > maxDelta) maxDelta = d
    }
    expect(maxDelta).toBeLessThanOrEqual(0.1)

    // 移动阶段进度应在合理范围
    const progressSamples = samples.filter(
      (s) => s.phase === 'firstHalf' || s.phase === 'secondHalf'
    )
    expect(progressSamples.length).toBeGreaterThan(0)
    for (const s of progressSamples) {
      expect(s.progress).toBeGreaterThanOrEqual(0)
      expect(s.progress).toBeLessThanOrEqual(s.distance + 0.001)
    }

    await waitForArrival(page)
    expect(await statState(page)).toBe('空闲')
    expect(await getCell(page)).toEqual(target)
  })
})

// ---------------------------------------------------------------------------
// E4. 障碍物绕行
// ---------------------------------------------------------------------------

test.describe('E4 障碍物绕行', () => {
  test('迷宫场景中路径绕行障碍并到达远端目标', async ({ page }) => {
    await page.locator('#btn-scene-maze').click()
    await page.waitForTimeout(400)
    await screenshot(page, 'e4-maze')

    const target = { x: 18, y: 2 }
    await clickCell(page, target.x, target.y)

    await expect.poll(async () => (await getPath(page)).length, {
      timeout: 2000,
    }).toBeGreaterThan(0)

    const path = await getPath(page)
    for (const p of path) {
      expect(await gridWalkable(page, p.x, p.y)).toBe(true)
    }
    expect(path.length).toBeGreaterThan(18)

    await waitForArrival(page, 30000)

    expect(await getCell(page)).toEqual(target)
    expect(await statState(page)).toBe('空闲')
    await screenshot(page, 'e4-arrived')
  })

  test('切换障碍后重新设置目标可得到避开障碍的新路径', async ({ page }) => {
    await clickCell(page, 12, 10)
    const path = await getPath(page)
    expect(path.length).toBeGreaterThan(0)

    const blockCell = path.find(
      (p: { x: number; y: number }, i: number) =>
        i > 0 && i < path.length - 1 && p.y === 10
    )
    expect(blockCell).toBeDefined()

    await clickCell(page, blockCell!.x, blockCell!.y, { ctrl: true })
    await page.waitForTimeout(200)
    expect(await gridWalkable(page, blockCell!.x, blockCell!.y)).toBe(false)

    await clickCell(page, 12, 10)
    const newPath = await getPath(page)
    expect(newPath.length).toBeGreaterThan(0)
    expect(
      newPath.some((p: { x: number; y: number }) =>
        p.x === blockCell!.x && p.y === blockCell!.y
      )
    ).toBe(false)

    for (const p of newPath as { x: number; y: number }[]) {
      expect(await gridWalkable(page, p.x, p.y)).toBe(true)
    }
    await screenshot(page, 'e4-recalc')
  })

  test('目标在障碍物上时单位不移动且路径为空', async ({ page }) => {
    await clickCell(page, 8, 8, { ctrl: true })
    await page.waitForTimeout(200)
    expect(await gridWalkable(page, 8, 8)).toBe(false)

    await clickCell(page, 8, 8)
    await page.waitForTimeout(300)

    expect(await isMoving(page)).toBe(false)
    expect((await getPath(page)).length).toBe(0)
    expect(await getCell(page)).toEqual({ x: 2, y: 10 })
    expect(await statState(page)).toBe('空闲')
    await screenshot(page, 'e4-obstacle-target')
  })
})

// ---------------------------------------------------------------------------
// E5. 速度控制
// ---------------------------------------------------------------------------

test.describe('E5 速度控制', () => {
  async function measureTrip(
    page: Page,
    target: { x: number; y: number },
    speedButton: string
  ) {
    await page.locator('#btn-reset-unit').click()
    await page.locator(speedButton).click()
    await page.waitForTimeout(100)
    const start = Date.now()
    await clickCell(page, target.x, target.y)
    await waitForArrival(page, 15000)
    return Date.now() - start
  }

  test('1x/2x/4x 速度按钮状态与实际倍率一致', async ({ page }) => {
    await page.locator('#btn-speed-1x').click()
    await page.waitForTimeout(100)
    await expect(page.locator('#btn-speed-1x')).toHaveClass(/active/)
    expect(await getSpeedMultiplier(page)).toBe(1)

    await page.locator('#btn-speed-2x').click()
    await page.waitForTimeout(100)
    await expect(page.locator('#btn-speed-2x')).toHaveClass(/active/)
    expect(await getSpeedMultiplier(page)).toBe(2)

    await page.locator('#btn-speed-4x').click()
    await page.waitForTimeout(100)
    await expect(page.locator('#btn-speed-4x')).toHaveClass(/active/)
    expect(await getSpeedMultiplier(page)).toBe(4)
  })

  test('移动速度与倍率近似成反比', async ({ page }) => {
    const target = { x: 12, y: 10 }

    const t1 = await measureTrip(page, target, '#btn-speed-1x')
    await screenshot(page, 'e5-speed-1x')

    const t2 = await measureTrip(page, target, '#btn-speed-2x')
    await screenshot(page, 'e5-speed-2x')

    const t4 = await measureTrip(page, target, '#btn-speed-4x')
    await screenshot(page, 'e5-speed-4x')

    expect(t2).toBeLessThan(t1 * 0.65)
    expect(t4).toBeLessThan(t2 * 0.65)
    expect(t4).toBeLessThan(t1 * 0.35)
  })

  test('暂停与恢复即时生效', async ({ page }) => {
    const target = { x: 12, y: 10 }
    await page.locator('#btn-speed-2x').click()
    await clickCell(page, target.x, target.y)
    await page.waitForTimeout(600)

    await page.locator('#btn-pause').click()
    await screenshot(page, 'e5-paused')

    const pos1 = await getUnitPosition(page)
    await page.waitForTimeout(1000)
    const pos2 = await getUnitPosition(page)

    expect(Math.abs(pos1.x - pos2.x)).toBeLessThan(0.01)
    expect(Math.abs(pos1.z - pos2.z)).toBeLessThan(0.01)
    expect(await isMoving(page)).toBe(true)

    await page.locator('#btn-resume').click()
    await page.waitForTimeout(600)
    const pos3 = await getUnitPosition(page)

    expect(
      Math.abs(pos3.x - pos2.x) + Math.abs(pos3.z - pos2.z)
    ).toBeGreaterThan(0.05)

    await waitForArrival(page, 15000)
    expect(await getCell(page)).toEqual(target)
    expect(await statState(page)).toBe('空闲')
  })

  test('移动中切换速度即时生效', async ({ page }) => {
    const target = { x: 12, y: 10 }
    await clickCell(page, target.x, target.y)
    await page.waitForTimeout(800)

    await page.locator('#btn-speed-4x').click()
    await page.waitForTimeout(100)
    expect(await getSpeedMultiplier(page)).toBe(4)

    const posBefore = await getUnitPosition(page)
    await page.waitForTimeout(400)
    const posAfter = await getUnitPosition(page)

    expect(
      Math.abs(posAfter.x - posBefore.x) + Math.abs(posAfter.z - posBefore.z)
    ).toBeGreaterThan(0.1)

    await waitForArrival(page, 15000)
    expect(await getCell(page)).toEqual(target)
  })
})

// ---------------------------------------------------------------------------
// E6. 边界测试
// ---------------------------------------------------------------------------

test.describe('E6 边界测试', () => {
  test('快速连续点击目标依次前往无崩溃', async ({ page }) => {
    await clickCell(page, 12, 10)
    await page.waitForTimeout(120)
    await clickCell(page, 5, 5)
    await page.waitForTimeout(120)
    await clickCell(page, 15, 15)

    await waitForArrival(page, 30000)

    expect(await getCell(page)).toEqual({ x: 15, y: 15 })
    expect(await statState(page)).toBe('空闲')
    await screenshot(page, 'e6-rapid')
  })

  test('清除路径后单位停止移动', async ({ page }) => {
    await clickCell(page, 12, 10)
    await page.waitForTimeout(300)
    expect(await isMoving(page)).toBe(true)

    await page.locator('#btn-clear-path').click()
    await page.waitForTimeout(200)

    expect(await isMoving(page)).toBe(false)
    expect((await getPath(page)).length).toBe(0)
    expect(await statTarget(page)).toBe('-')
    expect(await statState(page)).toBe('空闲')
    await screenshot(page, 'e6-clear-path')
  })

  test('重置单位位置恢复初始状态', async ({ page }) => {
    await clickCell(page, 12, 10)
    await page.waitForTimeout(500)

    await page.locator('#btn-reset-unit').click()
    await page.waitForTimeout(200)

    expect(await getCell(page)).toEqual({ x: 2, y: 10 })
    expect(await getFacing(page)).toBe(0)
    expect(await isMoving(page)).toBe(false)
    expect((await getPath(page)).length).toBe(0)
    expect(await statState(page)).toBe('空闲')
    await screenshot(page, 'e6-reset')
  })

  test('4x 速度长距离移动无穿墙且 pathIndex 递增不超过 1', async ({ page }) => {
    await page.locator('#btn-scene-maze').click()
    await page.waitForTimeout(400)
    await page.locator('#btn-speed-4x').click()
    await page.waitForTimeout(100)

    await clickCell(page, 18, 2)
    await page.waitForTimeout(100)

    const samples = await sampleMovement(page, 10000)
    await screenshot(page, 'e6-4x-long')

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

    await waitForArrival(page, 20000)
    expect(await getCell(page)).toEqual({ x: 18, y: 2 })
    expect(await statState(page)).toBe('空闲')
  })

  test('随机障碍场景下路径全部可行走', async ({ page }) => {
    await page.locator('#btn-scene-blocks').click()
    await page.waitForTimeout(400)

    const target = { x: 18, y: 18 }
    await clickCell(page, target.x, target.y)
    await page.waitForTimeout(300)

    const path = await getPath(page)
    if (path.length > 0) {
      for (const p of path) {
        expect(await gridWalkable(page, p.x, p.y)).toBe(true)
      }
      await waitForArrival(page, 30000)
      expect(await getCell(page)).toEqual(target)
      expect(await statState(page)).toBe('空闲')
    } else {
      expect(await isMoving(page)).toBe(false)
    }

    await screenshot(page, 'e6-random-blocks')
  })
})

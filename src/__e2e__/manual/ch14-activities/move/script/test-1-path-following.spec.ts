import { test, expect, Page } from '@playwright/test'
import * as fs from 'fs'
import * as path from 'path'

const BASE_URL = 'http://localhost:5173/test/ch14-activities/move/'
const EVIDENCE_DIR = path.join(
  'src',
  '__e2e__',
  'manual',
  'ch14-activities',
  'move',
  'script',
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

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

test.use({ viewport: { width: 1280, height: 720 } })

test.beforeAll(() => {
  ensureEvidenceDir()
})

test.beforeEach(async ({ page }) => {
  await page.goto(BASE_URL)
  await page.waitForLoadState('networkidle')
  await page.waitForFunction(() => !!(window as any).__testHarness)
  await page.locator('#btn-scene-empty').click()
  await page.locator('#btn-reset-unit').click()
  await page.waitForTimeout(200)
})

// ---------------------------------------------------------------------------
// E1. 路径跟随 (BLOCKER)
// ---------------------------------------------------------------------------

test.describe('E1 路径跟随', () => {
  test('单位沿最短路径移动并到达目标', async ({ page }) => {
    await screenshot(page, 'e1-start')

    const target = { x: 12, y: 10 }
    await clickCell(page, target.x, target.y)
    await screenshot(page, 'e1-target-set')

    // 路径应立即生成且非空
    await expect.poll(async () => (await getPath(page)).length, {
      timeout: 2000,
    }).toBeGreaterThan(0)
    expect(await isMoving(page)).toBe(true)

    const path = await getPath(page)
    expect(path[0]).toEqual({ x: 2, y: 10 })
    expect(path[path.length - 1]).toEqual(target)
    // 空场景中东西向 10 格直线路径长度应为 11（含起点）
    expect(path.length).toBe(11)

    // 等待到达，1x 速度约 5~7 秒
    await expect.poll(async () => await isMoving(page), {
      timeout: 10000,
    }).toBe(false)

    expect(await getCell(page)).toEqual(target)
    expect(await statState(page)).toBe('空闲')
    await screenshot(page, 'e1-arrived')
  })
})

// ---------------------------------------------------------------------------
// E2. 朝向与转向 (MAJOR)
// ---------------------------------------------------------------------------

test.describe('E2 朝向与转向', () => {
  test('对角线目标触发转向且最终朝向正确', async ({ page }) => {
    // 从 (2,10) 到 (10,2) 为东北方向，期望最终 facing ≈ 896
    await clickCell(page, 10, 2)
    await screenshot(page, 'e2-diagonal-target-set')

    // 应当先进入转向阶段
    await expect.poll(async () => await statState(page), {
      timeout: 2000,
    }).toBe('转向中')

    await expect.poll(async () => await isMoving(page), {
      timeout: 10000,
    }).toBe(false)

    const finalFacing = await getFacing(page)
    // 允许一帧的转向误差
    expect(Math.abs(finalFacing - 896)).toBeLessThanOrEqual(8)
    expect(await statState(page)).toBe('空闲')
    await screenshot(page, 'e2-diagonal-arrived')
  })

  test('转弯目标经历转向中阶段', async ({ page }) => {
    // 先向北移动到 (2,2)，再向东移动到 (18,2)，必然有 90° 转向
    await clickCell(page, 2, 2)
    await expect.poll(async () => await isMoving(page), {
      timeout: 10000,
    }).toBe(false)
    await screenshot(page, 'e2-north-arrived')

    await clickCell(page, 18, 2)
    const states = new Set<string>()
    const deadline = Date.now() + 10000
    while (Date.now() < deadline) {
      states.add((await statState(page)) ?? '')
      if (!(await isMoving(page))) break
      await page.waitForTimeout(50)
    }

    expect(states.has('转向中')).toBe(true)
    expect(await getCell(page)).toEqual({ x: 18, y: 2 })
    expect(await statState(page)).toBe('空闲')
    await screenshot(page, 'e2-east-arrived')
  })
})

// ---------------------------------------------------------------------------
// E3. 两段式移动连续性 (MAJOR)
// ---------------------------------------------------------------------------

test.describe('E3 两段式移动连续性', () => {
  test('移动阶段顺序为 firstHalf -> secondHalf 且无位置跳变', async ({ page }) => {
    await clickCell(page, 12, 10)
    await page.waitForTimeout(100)

    const samples = await sampleMovement(page, 8000)
    await screenshot(page, 'e3-continuity')

    const phases = samples.map((s) => s.phase)
    expect(phases).toContain('firstHalf')
    expect(phases).toContain('secondHalf')
    expect(phases).toContain('idle')

    // 检查 firstHalf -> secondHalf 切换时 carryover 被正确带入
    for (let i = 1; i < samples.length; i++) {
      if (
        samples[i - 1].phase === 'firstHalf' &&
        samples[i].phase === 'secondHalf'
      ) {
        expect(samples[i].progress).toBeGreaterThan(0)
        expect(samples[i].progress).toBeLessThan(0.1)
      }
    }

    // 相邻采样帧之间的位置跳变不应过大（1x 速度下每帧约 0.033 世界单位）
    let maxDelta = 0
    for (let i = 1; i < samples.length; i++) {
      const dx = samples[i].x - samples[i - 1].x
      const dz = samples[i].z - samples[i - 1].z
      const d = Math.sqrt(dx * dx + dz * dz)
      if (d > maxDelta) maxDelta = d
    }
    expect(maxDelta).toBeLessThanOrEqual(0.08)

    expect(await getCell(page)).toEqual({ x: 12, y: 10 })
    expect(await statState(page)).toBe('空闲')
  })
})

// ---------------------------------------------------------------------------
// E4. 障碍物绕行 (BLOCKER)
// ---------------------------------------------------------------------------

test.describe('E4 障碍物绕行', () => {
  test('迷宫场景中路径绕行障碍并到达远端目标', async ({ page }) => {
    await page.locator('#btn-scene-maze').click()
    await page.waitForTimeout(300)
    await screenshot(page, 'e4-maze')

    const target = { x: 18, y: 2 }
    await clickCell(page, target.x, target.y)

    await expect.poll(async () => (await getPath(page)).length, {
      timeout: 2000,
    }).toBeGreaterThan(0)

    const path = await getPath(page)
    // 路径不得经过任何不可行走格
    for (const p of path) {
      expect(await gridWalkable(page, p.x, p.y)).toBe(true)
    }
    // 实际路径使用对角线，长度会小于纯曼哈顿路径；只要明显长于直线距离即可
    expect(path.length).toBeGreaterThan(18)

    await expect.poll(async () => await isMoving(page), {
      timeout: 20000,
    }).toBe(false)

    expect(await getCell(page)).toEqual(target)
    expect(await statState(page)).toBe('空闲')
    await screenshot(page, 'e4-arrived')
  })

  test('切换障碍后重新设置目标可得到避开障碍的新路径', async ({ page }) => {
    await clickCell(page, 12, 10)
    const path = await getPath(page)
    expect(path.length).toBeGreaterThan(0)

    // 在直线路径上找一个中间格切换为障碍
    const blockCell = path.find(
      (p, i) => i > 0 && i < path.length - 1 && p.y === 10
    )
    expect(blockCell).toBeDefined()

    await clickCell(page, blockCell!.x, blockCell!.y, { ctrl: true })
    await page.waitForTimeout(100)
    expect(await gridWalkable(page, blockCell!.x, blockCell!.y)).toBe(false)

    await clickCell(page, 12, 10)
    const newPath = await getPath(page)
    expect(newPath.length).toBeGreaterThan(0)
    expect(
      newPath.some((p) => p.x === blockCell!.x && p.y === blockCell!.y)
    ).toBe(false)

    for (const p of newPath) {
      expect(await gridWalkable(page, p.x, p.y)).toBe(true)
    }
    await screenshot(page, 'e4-recalc')
  })
})

// ---------------------------------------------------------------------------
// E5. 速度控制 (MAJOR)
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
    await expect.poll(async () => await isMoving(page), {
      timeout: 15000,
    }).toBe(false)
    return Date.now() - start
  }

  test('1x/2x/4x 速度近似成反比', async ({ page }) => {
    const target = { x: 12, y: 10 }

    const t1 = await measureTrip(page, target, '#btn-speed-1x')
    await screenshot(page, 'e5-speed-1x')

    const t2 = await measureTrip(page, target, '#btn-speed-2x')
    await screenshot(page, 'e5-speed-2x')

    const t4 = await measureTrip(page, target, '#btn-speed-4x')
    await screenshot(page, 'e5-speed-4x')

    // 2x 应明显小于 1x 的一半上限；4x 应明显小于 2x 的一半上限
    expect(t2).toBeLessThan(t1 * 0.65)
    expect(t4).toBeLessThan(t2 * 0.65)
    expect(t4).toBeLessThan(t1 * 0.35)
  })

  test('暂停与恢复即时生效', async ({ page }) => {
    await clickCell(page, 12, 10)
    await page.waitForTimeout(800)

    await page.locator('#btn-pause').click()
    await screenshot(page, 'e5-paused')

    const pos1 = await page.evaluate(() => {
      const u = (window as any).__testHarness.unit
      return { x: u.posX, z: u.posZ }
    })
    await page.waitForTimeout(1000)
    const pos2 = await page.evaluate(() => {
      const u = (window as any).__testHarness.unit
      return { x: u.posX, z: u.posZ }
    })

    expect(Math.abs(pos1.x - pos2.x)).toBeLessThan(0.01)
    expect(Math.abs(pos1.z - pos2.z)).toBeLessThan(0.01)

    await page.locator('#btn-resume').click()
    await page.waitForTimeout(800)
    const pos3 = await page.evaluate(() => {
      const u = (window as any).__testHarness.unit
      return { x: u.posX, z: u.posZ }
    })

    expect(
      Math.abs(pos3.x - pos2.x) + Math.abs(pos3.z - pos2.z)
    ).toBeGreaterThan(0.05)

    await expect.poll(async () => await isMoving(page), {
      timeout: 10000,
    }).toBe(false)
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

    await expect.poll(async () => await isMoving(page), {
      timeout: 15000,
    }).toBe(false)

    expect(await getCell(page)).toEqual({ x: 15, y: 15 })
    expect(await statState(page)).toBe('空闲')
    await screenshot(page, 'e6-rapid')
  })

  test('目标在障碍物上时单位不移动', async ({ page }) => {
    await clickCell(page, 8, 8, { ctrl: true })
    await page.waitForTimeout(100)
    expect(await gridWalkable(page, 8, 8)).toBe(false)

    await clickCell(page, 8, 8)
    await page.waitForTimeout(300)

    expect(await isMoving(page)).toBe(false)
    expect((await getPath(page)).length).toBe(0)
    expect(await getCell(page)).toEqual({ x: 2, y: 10 })
    await screenshot(page, 'e6-obstacle-target')
  })

  test('4x 速度长距离移动无穿墙', async ({ page }) => {
    await page.locator('#btn-scene-maze').click()
    await page.waitForTimeout(300)
    await page.locator('#btn-speed-4x').click()

    await clickCell(page, 18, 2)
    const samples = await sampleMovement(page, 8000)
    await screenshot(page, 'e6-4x-long')

    let maxDelta = 0
    for (let i = 1; i < samples.length; i++) {
      const dx = samples[i].x - samples[i - 1].x
      const dz = samples[i].z - samples[i - 1].z
      const d = Math.sqrt(dx * dx + dz * dz)
      if (d > maxDelta) maxDelta = d
    }
    // 4x 速度 60fps 下每帧约 0.13 世界单位，留出一定余量
    expect(maxDelta).toBeLessThanOrEqual(0.4)

    await expect.poll(async () => await isMoving(page), {
      timeout: 15000,
    }).toBe(false)

    expect(await getCell(page)).toEqual({ x: 18, y: 2 })
    expect(await statState(page)).toBe('空闲')
  })
})

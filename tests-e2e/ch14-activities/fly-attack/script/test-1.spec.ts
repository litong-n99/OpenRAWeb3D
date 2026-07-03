import { test, expect, Page } from '@playwright/test'
import path from 'path'
import fs from 'fs'

const BASE_URL = 'http://localhost:5173/test/ch14-activities/fly-attack/'
const EVIDENCE_DIR = path.resolve('test-results/manual/ch14-activities/fly-attack/evidence')

// Ensure evidence directory exists once before all tests
fs.mkdirSync(EVIDENCE_DIR, { recursive: true })

// ---------------------------------------------------------------------------
// Constants (must match the test page)
// ---------------------------------------------------------------------------

const WORLD_SCALE = 1024
const ATTACK_RANGE = 2500 // WDist
const STRAFE_EXIT_RANGE = 2000 // WDist
const TICK_RATE_MS = 40 // 25 ticks/s
const BASE_POSITION_WORLD = { x: -12, y: 0, z: -8 }
const INITIAL_ATTACKER_WORLD = { x: -8, y: 1280 / WORLD_SCALE, z: 0 }
const INITIAL_TARGET_WORLD = { x: 0, y: 0, z: 0 }

// ---------------------------------------------------------------------------
// Type definitions
// ---------------------------------------------------------------------------

interface AttackerState {
  x: number
  y: number
  z: number
  facing: number
  ammoPercent: number
  canHover: boolean
}

interface Point3 {
  x: number
  y: number
  z: number
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function waitForEl(page: Page, selector: string, timeout = 10000): Promise<void> {
  await page.waitForSelector(selector, { timeout })
}

async function screenshot(page: Page, name: string): Promise<void> {
  const filePath = path.join(EVIDENCE_DIR, `${name}.png`)
  await page.screenshot({ path: filePath, fullPage: false })
}

async function waitForInit(page: Page): Promise<void> {
  await waitForEl(page, '#renderCanvas')
  await page.waitForFunction(
    () => typeof (window as any).__flyAttackTest !== 'undefined',
    { timeout: 15000 },
  )
  // Engine info should be populated once WebGL is ready
  await expect(page.locator('#info-engine')).not.toHaveText('-', { timeout: 15000 })
  await expect(page.locator('#info-engine')).toHaveText('WebGL 2.0')
  await expect(page.locator('#info-viewport')).not.toHaveText('-', { timeout: 15000 })
  // Babylon.js scene needs a little extra time to settle
  await page.waitForTimeout(2000)
}

async function getAttackerState(page: Page): Promise<AttackerState> {
  return page.evaluate(() => {
    const a = (window as any).__flyAttackTest.attacker
    return {
      x: a.position.x,
      y: a.position.y,
      z: a.position.z,
      facing: a.facing,
      ammoPercent: a.ammoPercent,
      canHover: a.canHover,
    }
  })
}

async function getPhase(page: Page): Promise<string> {
  return (await page.locator('#st-attack-state').textContent()) ?? ''
}

async function waitForPhase(page: Page, phase: string, timeout = 15000): Promise<void> {
  await expect(page.locator('#st-attack-state')).toHaveText(phase, { timeout })
}

async function selectAttackType(page: Page, type: 'default' | 'strafe' | 'hover'): Promise<void> {
  await page.selectOption('#sel-attack', type)
  await page.waitForTimeout(100)
}

async function clickAttack(page: Page): Promise<void> {
  await page.click('#btn-attack')
  await page.waitForTimeout(100)
}

async function clickAmmoEmpty(page: Page): Promise<void> {
  await page.click('#btn-ammo-empty')
  await page.waitForTimeout(100)
}

async function clickReset(page: Page): Promise<void> {
  await page.click('#btn-reset')
  // Wait for the reset to propagate through the render loop
  await page.waitForTimeout(500)
  await expect(page.locator('#st-attack-state')).toHaveText('idle', { timeout: 5000 })
}

async function clickCanvasAt(page: Page, relX: number, relY: number): Promise<void> {
  const box = await page.locator('#renderCanvas').boundingBox()
  if (!box) throw new Error('Canvas bounding box not found')
  const x = Math.round(box.x + box.width * relX)
  const y = Math.round(box.y + box.height * relY)
  await page.click('#renderCanvas', { position: { x, y } })
  // Give Babylon.js scene.pick time to process and update meshes
  await page.waitForTimeout(400)
}

function wDistToWorld(wdist: number): number {
  return wdist / WORLD_SCALE
}

function worldToWDist(world: number): number {
  return world * WORLD_SCALE
}

function horizontalDistanceWDist(a: Point3, b: Point3): number {
  const dx = a.x - b.x
  const dz = a.z - b.z
  return Math.sqrt(dx * dx + dz * dz) * WORLD_SCALE
}

/**
 * Count bright yellow (#FFCC33) flash pixels on the rendered canvas.
 * Returns a count so the heavy pixel data never leaves the browser.
 */
async function countFlashPixelsOnCanvas(
  page: Page,
  width = 200,
  height = 112,
): Promise<number> {
  return page.evaluate(
    ({ w, h }: { w: number; h: number }) =>
      new Promise<number>((resolve, reject) => {
        const src = document.getElementById('renderCanvas') as HTMLCanvasElement | null
        if (!src) return reject(new Error('renderCanvas not found'))

        const c = document.createElement('canvas')
        c.width = w
        c.height = h
        const ctx = c.getContext('2d')
        if (!ctx) return reject(new Error('could not get 2d context'))

        const img = new Image()
        img.onload = () => {
          ctx.drawImage(img, 0, 0, w, h)
          const data = ctx.getImageData(0, 0, w, h).data
          let count = 0
          for (let i = 0; i < data.length; i += 4) {
            const r = data[i]
            const g = data[i + 1]
            const b = data[i + 2]
            const a = data[i + 3]
            if (r > 230 && g > 180 && b < 80 && a > 100) {
              count++
            }
          }
          resolve(count)
        }
        img.onerror = reject
        img.src = src.toDataURL('image/png')
      }),
    { w: width, h: height },
  )
}

/**
 * Capture a down-scaled snapshot of the canvas as a plain RGBA number array.
 */
async function readCanvasPixels(
  page: Page,
  width = 200,
  height = 112,
): Promise<number[]> {
  return page.evaluate(
    ({ w, h }: { w: number; h: number }) =>
      new Promise<number[]>((resolve, reject) => {
        const src = document.getElementById('renderCanvas') as HTMLCanvasElement | null
        if (!src) return reject(new Error('renderCanvas not found'))

        const c = document.createElement('canvas')
        c.width = w
        c.height = h
        const ctx = c.getContext('2d')
        if (!ctx) return reject(new Error('could not get 2d context'))

        const img = new Image()
        img.onload = () => {
          ctx.drawImage(img, 0, 0, w, h)
          resolve(Array.from(ctx.getImageData(0, 0, w, h).data))
        }
        img.onerror = reject
        img.src = src.toDataURL('image/png')
      }),
    { w: width, h: height },
  )
}

/**
 * Count pixels that changed between a previously captured snapshot and the
 * current canvas contents.
 */
async function countCanvasPixelDiff(
  page: Page,
  before: number[],
  width = 200,
  height = 112,
  threshold = 30,
): Promise<number> {
  return page.evaluate(
    ({
      before,
      w,
      h,
      threshold,
    }: {
      before: number[]
      w: number
      h: number
      threshold: number
    }) =>
      new Promise<number>((resolve, reject) => {
        const src = document.getElementById('renderCanvas') as HTMLCanvasElement | null
        if (!src) return reject(new Error('renderCanvas not found'))

        const c = document.createElement('canvas')
        c.width = w
        c.height = h
        const ctx = c.getContext('2d')
        if (!ctx) return reject(new Error('could not get 2d context'))

        const img = new Image()
        img.onload = () => {
          ctx.drawImage(img, 0, 0, w, h)
          const data = ctx.getImageData(0, 0, w, h).data
          let changed = 0
          const len = Math.min(data.length, before.length)
          for (let i = 0; i < len; i += 4) {
            if (
              Math.abs(data[i] - before[i]) > threshold ||
              Math.abs(data[i + 1] - before[i + 1]) > threshold ||
              Math.abs(data[i + 2] - before[i + 2]) > threshold ||
              Math.abs(data[i + 3] - before[i + 3]) > threshold
            ) {
              changed++
            }
          }
          resolve(changed)
        }
        img.onerror = reject
        img.src = src.toDataURL('image/png')
      }),
    { before, w: width, h: height, threshold },
  )
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('CH14 Activities - FlyAttack 验收测试', () => {
  test('E1: Default 掠过攻击', async ({ page }) => {
    test.setTimeout(45000)
    await page.goto(BASE_URL)
    await waitForInit(page)

    await clickReset(page)
    await selectAttackType(page, 'default')

    const attackerBefore = await getAttackerState(page)
    expect(attackerBefore.ammoPercent).toBe(100)

    await clickAttack(page)

    // Should first transition into approach, then attack_run
    await waitForPhase(page, 'approach', 10000)
    await waitForPhase(page, 'attack_run', 15000)

    let attackRunSeen = 0
    let lastPhase = ''
    let endedOutsideRange = false
    const startedAt = Date.now()

    while (Date.now() - startedAt < 25000) {
      const phase = await getPhase(page)
      if (phase === 'attack_run' && lastPhase !== 'attack_run') {
        attackRunSeen++
      }
      lastPhase = phase

      const attacker = await getAttackerState(page)
      const distToTarget = horizontalDistanceWDist(attacker, INITIAL_TARGET_WORLD)
      if (phase === 'exit' && distToTarget > ATTACK_RANGE * 1.5) {
        endedOutsideRange = true
        break
      }

      await page.waitForTimeout(100)
    }

    const attackerAfter = await getAttackerState(page)

    expect(attackRunSeen).toBeGreaterThanOrEqual(2)
    expect(endedOutsideRange).toBe(true)
    expect(attackerBefore.ammoPercent - attackerAfter.ammoPercent).toBeGreaterThan(0)
    await expect(page.locator('#st-target-line')).toHaveText('红色 (攻击)')

    await screenshot(page, 'E1-default-attack')
  })

  test('E2: Strafe 扫射', async ({ page }) => {
    test.setTimeout(45000)
    await page.goto(BASE_URL)
    await waitForInit(page)

    await clickReset(page)
    await selectAttackType(page, 'strafe')

    await clickAttack(page)
    await waitForPhase(page, 'strafe', 15000)

    const attackerStart = await getAttackerState(page)
    const ammoStart = attackerStart.ammoPercent

    let lastPhase = 'strafe'
    const startedAt = Date.now()
    while (Date.now() - startedAt < 20000) {
      const phase = await getPhase(page)
      lastPhase = phase
      if (phase === 'exit') break
      await page.waitForTimeout(100)
    }

    const attackerEnd = await getAttackerState(page)
    const ammoEnd = attackerEnd.ammoPercent
    const distToTarget = horizontalDistanceWDist(attackerEnd, INITIAL_TARGET_WORLD)

    expect(lastPhase).toBe('exit')
    expect(ammoStart - ammoEnd).toBeGreaterThan(20)
    expect(distToTarget).toBeGreaterThan(STRAFE_EXIT_RANGE)
    await expect(page.locator('#st-target-line')).toHaveText('红色 (攻击)')

    await screenshot(page, 'E2-strafe-attack')
  })

  test('E3: Hover 悬停攻击', async ({ page }) => {
    test.setTimeout(45000)
    await page.goto(BASE_URL)
    await waitForInit(page)

    await clickReset(page)
    await selectAttackType(page, 'hover')

    await clickAttack(page)
    await waitForPhase(page, 'hover', 15000)

    const hoverStart = await getAttackerState(page)
    const ammoStart = hoverStart.ammoPercent
    let maxDisplacementWDist = 0

    const startedAt = Date.now()
    while (Date.now() - startedAt < 12000) {
      const phase = await getPhase(page)
      const attacker = await getAttackerState(page)
      const displacement = horizontalDistanceWDist(attacker, hoverStart)
      if (displacement > maxDisplacementWDist) {
        maxDisplacementWDist = displacement
      }
      if (phase !== 'hover') break
      await page.waitForTimeout(100)
    }

    const attackerEnd = await getAttackerState(page)
    const ammoEnd = attackerEnd.ammoPercent

    expect(ammoStart - ammoEnd).toBeGreaterThan(0)
    expect(ammoStart - ammoEnd).toBeLessThan(20)
    expect(maxDisplacementWDist).toBeLessThan(500)
    await expect(page.locator('#st-target-line')).toHaveText('红色 (攻击)')

    await screenshot(page, 'E3-hover-attack')
  })

  test('E4: 弹药耗尽返航', async ({ page }) => {
    test.setTimeout(60000)
    await page.goto(BASE_URL)
    await waitForInit(page)

    await clickReset(page)
    await selectAttackType(page, 'default')

    await clickAttack(page)
    await expect(page.locator('#st-attack-state')).not.toHaveText('idle', {
      timeout: 10000,
    })

    // Let the attack get underway before forcing ammo depletion
    await page.waitForTimeout(800)
    await clickAmmoEmpty(page)

    await waitForPhase(page, 'return_to_base', 15000)
    await expect(page.locator('#st-target-line')).toHaveText('绿色 (返航)')

    let reachedBase = false
    const startedAt = Date.now()
    while (Date.now() - startedAt < 30000) {
      const attacker = await getAttackerState(page)
      const distToBase = horizontalDistanceWDist(attacker, BASE_POSITION_WORLD)
      const phase = await getPhase(page)

      if (distToBase < 500 || phase === 'idle' || attacker.ammoPercent === 100) {
        reachedBase = true
        break
      }
      await page.waitForTimeout(200)
    }

    expect(reachedBase).toBe(true)

    const final = await getAttackerState(page)
    const finalPhase = await getPhase(page)
    expect(finalPhase === 'idle' || final.ammoPercent === 100).toBe(true)

    await screenshot(page, 'E4-return-to-base')
  })

  test('E5: 开火效果', async ({ page }) => {
    test.setTimeout(45000)
    await page.goto(BASE_URL)
    await waitForInit(page)

    await clickReset(page)
    await selectAttackType(page, 'default')

    await clickAttack(page)
    await waitForPhase(page, 'attack_run', 15000)

    let sawFlash = false
    let sawNoFlash = false
    let flashFrameCount = 0
    let noFlashFrameCount = 0

    const startedAt = Date.now()
    while (Date.now() - startedAt < 8000) {
      const count = await countFlashPixelsOnCanvas(page, 200, 112)
      if (count > 5) {
        sawFlash = true
        flashFrameCount++
      } else {
        sawNoFlash = true
        noFlashFrameCount++
      }
      if (sawFlash && sawNoFlash) break
      await page.waitForTimeout(80)
    }

    expect(sawFlash).toBe(true)
    expect(sawNoFlash).toBe(true)
    expect(flashFrameCount).toBeLessThan(noFlashFrameCount + flashFrameCount)

    await screenshot(page, 'E5-fire-flash')
  })

  test('B-A: 目标在射程外 → 接近后攻击', async ({ page }) => {
    test.setTimeout(45000)
    await page.goto(BASE_URL)
    await waitForInit(page)

    await clickReset(page)
    // Place a new target far to the east
    await clickCanvasAt(page, 0.8, 0.5)

    await selectAttackType(page, 'default')
    await clickAttack(page)

    // The aircraft is far from the target, so it must approach first
    await waitForPhase(page, 'approach', 10000)
    await waitForPhase(page, 'attack_run', 20000)

    const attacker = await getAttackerState(page)
    expect(attacker.ammoPercent).toBeLessThan(100)
    await expect(page.locator('#st-target-line')).toHaveText('红色 (攻击)')

    await screenshot(page, 'B-A-out-of-range-approach')
  })

  test('B-B: 快速重置清除所有轨迹和效果', async ({ page }) => {
    test.setTimeout(45000)
    await page.goto(BASE_URL)
    await waitForInit(page)

    await clickReset(page)
    await selectAttackType(page, 'default')
    await clickAttack(page)

    await waitForPhase(page, 'attack_run', 15000)
    await page.waitForTimeout(600)

    const midAmmo = (await getAttackerState(page)).ammoPercent
    expect(midAmmo).toBeLessThan(100)

    await clickReset(page)

    await expect(page.locator('#st-attack-state')).toHaveText('idle')
    await expect(page.locator('#st-ammo')).toHaveText('100%')
    await expect(page.locator('#st-target-line')).toHaveText('-')

    const attacker = await getAttackerState(page)
    expect(Math.abs(attacker.x - INITIAL_ATTACKER_WORLD.x)).toBeLessThan(0.1)
    expect(Math.abs(attacker.z - INITIAL_ATTACKER_WORLD.z)).toBeLessThan(0.1)
    expect(Math.abs(worldToWDist(attacker.y) - 1280)).toBeLessThan(100)

    const flashPixels = await countFlashPixelsOnCanvas(page, 200, 112)
    expect(flashPixels).toBe(0)

    await screenshot(page, 'B-B-reset-clears')
  })

  test('B-C: 弹药耗尽后再攻击', async ({ page }) => {
    test.setTimeout(60000)
    await page.goto(BASE_URL)
    await waitForInit(page)

    await clickReset(page)
    await selectAttackType(page, 'default')

    // First attack, then force return-to-base
    await clickAttack(page)
    await expect(page.locator('#st-attack-state')).not.toHaveText('idle', {
      timeout: 10000,
    })
    await page.waitForTimeout(500)
    await clickAmmoEmpty(page)

    await waitForPhase(page, 'return_to_base', 15000)
    await expect(page.locator('#st-attack-state')).toHaveText('idle', {
      timeout: 30000,
    })
    await expect(page.locator('#st-ammo')).toHaveText('100%')

    // Attack again after resupply
    await clickAttack(page)
    await expect(page.locator('#st-attack-state')).not.toHaveText('idle', {
      timeout: 10000,
    })

    await page.waitForTimeout(1500)
    const attacker = await getAttackerState(page)
    expect(attacker.ammoPercent).toBeLessThan(100)

    await screenshot(page, 'B-C-attack-after-resupply')
  })

  test('B-D: 点击画布设置新目标位置', async ({ page }) => {
    test.setTimeout(45000)
    await page.goto(BASE_URL)
    await waitForInit(page)

    await clickReset(page)
    await page.waitForTimeout(500)

    const before = await readCanvasPixels(page, 200, 112)

    // Click far from the default target to move the blue building & range ring
    await clickCanvasAt(page, 0.75, 0.25)
    await page.waitForTimeout(800)

    const after = await readCanvasPixels(page, 200, 112)
    const diffCount = await countCanvasPixelDiff(page, before, 200, 112, 30)

    expect(diffCount).toBeGreaterThan(200)

    await screenshot(page, 'B-D-canvas-new-target')
  })
})

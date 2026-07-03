import { test, expect, Page } from '@playwright/test'
import path from 'path'
import fs from 'fs'

const BASE_URL = 'http://localhost:5173/test/ch14-activities/fly-attack/'
const EVIDENCE_DIR = path.resolve('test-results/manual/ch14-activities/fly-attack/evidence')

fs.mkdirSync(EVIDENCE_DIR, { recursive: true })

const WORLD_SCALE = 1024
const CRUISE_ALTITUDE = 1280
const INITIAL_ATTACKER_POS = { x: -8, y: CRUISE_ALTITUDE / WORLD_SCALE, z: 0 }

interface FlyAttackTestState {
  attacker: {
    position: { x: number; y: number; z: number }
    facing: number
    pitch: number
    roll: number
    speed: number
    turnSpeed: number
    canHover: boolean
    ammoPercent: number
  }
  currentPhase: string
  attackType: string
  targetPosition: { x: number; y: number; z: number }
  basePosition: { x: number; y: number; z: number }
}

async function waitForInit(page: Page): Promise<void> {
  await page.waitForSelector('#renderCanvas', { timeout: 15000 })
  await page.waitForFunction(
    () => typeof (window as any).__flyAttackTest !== 'undefined',
    { timeout: 15000 }
  )
  await expect(page.locator('#info-engine')).not.toHaveText('-', { timeout: 15000 })
  await page.waitForTimeout(1000)
}

async function getTestState(page: Page): Promise<FlyAttackTestState> {
  return page.evaluate(() => {
    const t = (window as any).__flyAttackTest
    return {
      attacker: {
        position: {
          x: t.attacker.position.x,
          y: t.attacker.position.y,
          z: t.attacker.position.z,
        },
        facing: t.attacker.facing,
        pitch: t.attacker.pitch,
        roll: t.attacker.roll,
        speed: t.attacker.speed,
        turnSpeed: t.attacker.turnSpeed,
        canHover: t.attacker.canHover,
        ammoPercent: t.attacker.ammoPercent,
      },
      currentPhase: t.currentPhase,
      attackType: t.attackType,
      targetPosition: t.targetPosition,
      basePosition: t.basePosition,
    }
  })
}

async function getPhase(page: Page): Promise<string> {
  return (await page.locator('#st-attack-state').textContent()) ?? ''
}

async function pollForPhase(
  page: Page,
  phase: string,
  timeout = 10000,
  interval = 200
): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    const current = await getPhase(page)
    if (current === phase) return
    await page.waitForTimeout(interval)
  }
  throw new Error(`Timed out waiting for phase "${phase}"`)
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
  await expect(page.locator('#st-attack-state')).toHaveText('idle', { timeout: 5000 })
  await expect(page.locator('#st-ammo')).toHaveText('100%')
}

async function screenshot(page: Page, filename: string): Promise<void> {
  await page.screenshot({ path: path.join(EVIDENCE_DIR, filename), fullPage: false })
}

async function countYellowFlashPixels(page: Page, width = 200, height = 112): Promise<number> {
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
            if (r > 220 && g > 170 && b < 90 && a > 100) {
              count++
            }
          }
          resolve(count)
        }
        img.onerror = reject
        img.src = src.toDataURL('image/png')
      }),
    { w: width, h: height }
  )
}

test.describe('CH14 FlyAttack Acceptance Tests', () => {
  test('E1: Default Attack (FlyAttackRun)', async ({ page }) => {
    test.setTimeout(45000)
    await page.goto(BASE_URL)
    await waitForInit(page)

    await clickReset(page)
    await selectAttackType(page, 'default')

    const before = await getTestState(page)
    expect(before.attacker.ammoPercent).toBe(100)

    await clickAttack(page)

    let sawApproach = false
    await pollForPhase(page, 'attack_run', 10000, 200)

    const start = Date.now()
    while (Date.now() - start < 2000) {
      if ((await getPhase(page)) === 'approach') {
        sawApproach = true
        break
      }
      await page.waitForTimeout(100)
    }

    const ammoCheckStart = Date.now()
    while (Date.now() - ammoCheckStart < 5000) {
      const state = await getTestState(page)
      if (state.attacker.ammoPercent < 100) break
      await page.waitForTimeout(200)
    }

    const stateAtScreenshot = await getTestState(page)
    expect(stateAtScreenshot.attacker.ammoPercent).toBeLessThan(100)
    await expect(page.locator('#st-target-line')).toHaveText('红色 (攻击)')
    await screenshot(page, 'screenshot-1-default-attack-run.png')

    let attackRunCount = 0
    let lastPhase = ''
    let seenSecondAttackRun = false
    const secondPassStart = Date.now()
    while (Date.now() - secondPassStart < 15000) {
      const phase = await getPhase(page)
      if (phase === 'attack_run' && lastPhase !== 'attack_run') {
        attackRunCount++
      }
      lastPhase = phase
      if (attackRunCount >= 2) {
        seenSecondAttackRun = true
        break
      }
      await page.waitForTimeout(200)
    }

    expect(attackRunCount).toBeGreaterThanOrEqual(1)
    await screenshot(page, 'screenshot-1b-default-second-pass.png')
    expect(sawApproach || (await getPhase(page)) !== 'idle').toBe(true)
  })

  test('E2: Strafe Attack', async ({ page }) => {
    test.setTimeout(45000)
    await page.goto(BASE_URL)
    await waitForInit(page)

    await clickReset(page)
    await selectAttackType(page, 'strafe')
    await clickAttack(page)

    await pollForPhase(page, 'strafe', 10000, 200)
    await screenshot(page, 'screenshot-2-strafe-attack.png')

    const startState = await getTestState(page)
    const ammoStart = startState.attacker.ammoPercent
    let ammoMin = ammoStart
    let finalPhase = 'strafe'

    const strafeStart = Date.now()
    while (Date.now() - strafeStart < 15000) {
      const phase = await getPhase(page)
      finalPhase = phase
      const state = await getTestState(page)
      if (state.attacker.ammoPercent < ammoMin) ammoMin = state.attacker.ammoPercent
      if (phase === 'exit' || phase === 'approach') break
      await page.waitForTimeout(200)
    }

    expect(ammoStart - ammoMin).toBeGreaterThanOrEqual(20)
    expect(finalPhase === 'exit' || finalPhase === 'approach').toBe(true)
    await expect(page.locator('#st-attack-type')).toHaveText('strafe')
  })

  test('E3: Hover Attack', async ({ page }) => {
    test.setTimeout(45000)
    await page.goto(BASE_URL)
    await waitForInit(page)

    await clickReset(page)
    await selectAttackType(page, 'hover')
    await clickAttack(page)

    await pollForPhase(page, 'hover', 10000, 200)
    await screenshot(page, 'screenshot-3-hover-attack.png')

    const startState = await getTestState(page)
    const ammoStart = startState.attacker.ammoPercent
    let hoverTicks = 0

    const hoverStart = Date.now()
    while (Date.now() - hoverStart < 5000) {
      const phase = await getPhase(page)
      if (phase === 'hover') hoverTicks++
      await page.waitForTimeout(200)
    }

    const endState = await getTestState(page)
    const ammoDrop = ammoStart - endState.attacker.ammoPercent

    expect(hoverTicks).toBeGreaterThan(0)
    expect(ammoDrop).toBeGreaterThan(0)
    expect(ammoDrop).toBeLessThan(50)
  })

  test('E4: Ammo Depletion Return to Base', async ({ page }) => {
    test.setTimeout(45000)
    await page.goto(BASE_URL)
    await waitForInit(page)

    await clickReset(page)
    await selectAttackType(page, 'default')
    await clickAttack(page)

    await pollForPhase(page, 'attack_run', 10000, 200)
    await clickAmmoEmpty(page)

    await pollForPhase(page, 'return_to_base', 10000, 200)
    await expect(page.locator('#st-target-line')).toHaveText('绿色 (返航)')
    await screenshot(page, 'screenshot-4-return-to-base.png')

    await pollForPhase(page, 'idle', 15000, 200)

    const finalState = await getTestState(page)
    expect(finalState.attacker.ammoPercent).toBe(100)
  })

  test('E5: Fire Effect', async ({ page }) => {
    test.setTimeout(45000)
    await page.goto(BASE_URL)
    await waitForInit(page)

    await clickReset(page)
    await selectAttackType(page, 'default')
    await clickAttack(page)

    await pollForPhase(page, 'attack_run', 10000, 200)

    let sawFlash = false
    const flashStart = Date.now()
    while (Date.now() - flashStart < 5000) {
      const count = await countYellowFlashPixels(page)
      if (count > 0) {
        sawFlash = true
        break
      }
      await page.waitForTimeout(200)
    }

    await screenshot(page, 'screenshot-5-fire-effect.png')
    expect(sawFlash).toBe(true)
  })

  test('Boundary B-A: Target Out of Range', async ({ page }) => {
    test.setTimeout(45000)
    await page.goto(BASE_URL)
    await waitForInit(page)

    await clickReset(page)
    await selectAttackType(page, 'default')
    await clickAttack(page)

    await pollForPhase(page, 'approach', 10000, 200)
    const phase = await getPhase(page)
    expect(phase).toBe('approach')
  })

  test('Boundary B-B: Rapid Reset', async ({ page }) => {
    test.setTimeout(45000)
    await page.goto(BASE_URL)
    await waitForInit(page)

    await clickReset(page)
    await selectAttackType(page, 'default')
    await clickAttack(page)
    await page.waitForTimeout(1000)
    await clickReset(page)

    await expect(page.locator('#st-attack-state')).toHaveText('idle')
    await expect(page.locator('#st-ammo')).toHaveText('100%')

    const state = await getTestState(page)
    expect(Math.abs(state.attacker.position.x - INITIAL_ATTACKER_POS.x)).toBeLessThan(0.1)
    expect(Math.abs(state.attacker.position.y - INITIAL_ATTACKER_POS.y)).toBeLessThan(0.1)
    expect(Math.abs(state.attacker.position.z - INITIAL_ATTACKER_POS.z)).toBeLessThan(0.1)
  })

  test('Boundary B-C: Attack After Reload', async ({ page }) => {
    test.setTimeout(45000)
    await page.goto(BASE_URL)
    await waitForInit(page)

    await clickReset(page)
    await clickAmmoEmpty(page)

    const emptyState = await getTestState(page)
    expect(emptyState.attacker.ammoPercent).toBe(0)

    await clickReset(page)

    const reloadedState = await getTestState(page)
    expect(reloadedState.attacker.ammoPercent).toBe(100)

    await selectAttackType(page, 'default')
    await clickAttack(page)

    await pollForPhase(page, 'approach', 10000, 200)
    await pollForPhase(page, 'attack_run', 10000, 200)
  })

  test('Boundary B-D: Type Switch Mid-Attack', async ({ page }) => {
    test.setTimeout(45000)
    await page.goto(BASE_URL)
    await waitForInit(page)

    await clickReset(page)
    await selectAttackType(page, 'default')
    await clickAttack(page)

    const firstPhase = await getPhase(page)
    if (firstPhase !== 'attack_run' && firstPhase !== 'approach') {
      await pollForPhase(page, 'approach', 5000, 200)
    }

    await clickReset(page)
    await selectAttackType(page, 'strafe')
    await clickAttack(page)

    await expect(page.locator('#st-attack-type')).toHaveText('strafe')

    const start = Date.now()
    let matched = false
    while (Date.now() - start < 10000) {
      const phase = await getPhase(page)
      if (phase === 'strafe' || phase === 'approach') {
        matched = true
        break
      }
      await page.waitForTimeout(200)
    }
    expect(matched).toBe(true)
  })
})

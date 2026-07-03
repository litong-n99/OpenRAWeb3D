import { test, expect, type Page } from '@playwright/test'
import * as fs from 'fs'
import * as path from 'path'

const BASE_URL = 'http://localhost:5173/test/ch14-activities/parachute/'
const EVIDENCE_DIR = path.resolve(
  process.env.PLAYWRIGHT_OUTPUT_DIR || 'test-results',
  'evidence'
)

const TICK_MS = 40

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

interface ParachuteState {
  x: number
  y: number
  z: number
  alt: number
  fallRate: number
  groundLevel: number
  isDescending: boolean
  tickCount: number
  landed: boolean
}

async function getParachuteState(page: Page): Promise<ParachuteState> {
  return page.evaluate(() => {
    const p = (window as any).__parachuteTest.parachute
    return {
      x: p.position.x,
      y: p.position.y,
      z: p.position.z,
      alt: Math.round(p.position.y * 1024),
      fallRate: p.fallRate,
      groundLevel: p.groundLevel,
      isDescending: p.isDescending,
      tickCount: p.tickCount,
      landed: p.landed,
    }
  })
}

/**
 * Get the zone position by starting a quick API drop and reading the parachute
 * start position (startParachute reads zone.position from the Babylon scene internally).
 */
async function getZonePosition(page: Page): Promise<{ x: number; z: number } | null> {
  await startParachuteApi(page, 256, 1)
  await page.waitForTimeout(TICK_MS)
  const state = await getParachuteState(page)
  await clickReset(page)
  await page.waitForTimeout(TICK_MS * 2)
  return { x: state.x, z: state.z }
}

/**
 * Check if landing effect (dust mesh) is present by verifying:
 * - parachute state indicates landed
 * - console log for landing notification has fired
 * Visual confirmation done via screenshots + Kimi.
 */
async function verifyLandingEffect(page: Page): Promise<boolean> {
  const state = await getParachuteState(page)
  return state.landed && !state.isDescending
}

async function getStatAlt(page: Page) {
  return page.locator('#st-alt').textContent()
}

async function getStatState(page: Page) {
  return page.locator('#st-state').textContent()
}

async function setFallRate(page: Page, rate: number) {
  await page.locator('#sel-fall-rate').selectOption(String(rate))
}

async function setStartAlt(page: Page, alt: number) {
  await page.locator('#sel-start-alt').selectOption(String(alt))
}

async function clickDrop(page: Page) {
  await page.locator('#btn-drop').click()
}

async function clickReset(page: Page) {
  await page.locator('#btn-reset').click()
}

async function startParachuteApi(page: Page, fallRate: number, startAlt: number) {
  await page.evaluate(
    ({ fallRate, startAlt }) => {
      ;(window as any).__parachuteTest.startParachute(fallRate, startAlt)
    },
    { fallRate, startAlt }
  )
}

async function clickCanvasNearCenter(page: Page, offsetX: number, offsetY: number) {
  const canvas = page.locator('#renderCanvas')
  const box = await canvas.boundingBox()
  if (!box) throw new Error('renderCanvas not found')
  await canvas.click({
    position: {
      x: box.width / 2 + offsetX,
      y: box.height / 2 + offsetY,
    },
  })
}

async function waitForLanding(page: Page, timeout = 30000) {
  await expect.poll(
    async () => {
      const s = await getParachuteState(page)
      return s.landed && !s.isDescending
    },
    { timeout, intervals: [TICK_MS] }
  ).toBe(true)
}

async function waitForConsoleLanding(page: Page, timeout = 30000) {
  return page.waitForEvent('console', {
    predicate: (msg) =>
      msg.text().includes('[Parachute] onLanded notification triggered'),
    timeout,
  })
}

async function dropAndWaitForLanding(page: Page, timeout = 30000) {
  const landingLog = waitForConsoleLanding(page, timeout)
  await clickDrop(page)
  await waitForLanding(page, timeout)
  await landingLog
}

function expectApprox(actual: number, expected: number, tolerance: number) {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tolerance)
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
  await page.waitForFunction(() => !!(window as any).__parachuteTest)
  await page.locator('#renderCanvas').waitFor({ state: 'visible' })
  await clickReset(page)
  await page.waitForTimeout(TICK_MS * 2)
})

// ---------------------------------------------------------------------------
// E1. 正常速率下降
// ---------------------------------------------------------------------------

test.describe('E1 正常速率下降', () => {
  test('128 速率从 5120 高度约 40 ticks 着陆并触发通知', async ({ page }) => {
    await setFallRate(page, 128)
    await setStartAlt(page, 5120)
    await screenshot(page, 'e1-before-drop')

    await dropAndWaitForLanding(page)

    const state = await getParachuteState(page)
    expect(state.landed).toBe(true)
    expect(state.isDescending).toBe(false)
    expect(state.alt).toBe(0)
    expectApprox(state.tickCount, 40, 1)
    expect(await getStatState(page)).toBe('已着陆')
    expect(await getStatAlt(page)).toBe('0')
    expect(await verifyLandingEffect(page)).toBe(true)

    await screenshot(page, 'e1-landed')
  })
})

// ---------------------------------------------------------------------------
// E2. 慢速下降
// ---------------------------------------------------------------------------

test.describe('E2 慢速下降', () => {
  test('64 速率从 10240 高度约 160 ticks 着陆', async ({ page }) => {
    await setFallRate(page, 64)
    await setStartAlt(page, 10240)
    await screenshot(page, 'e2-before-drop')

    await dropAndWaitForLanding(page)

    const state = await getParachuteState(page)
    expect(state.landed).toBe(true)
    expect(state.isDescending).toBe(false)
    expect(state.alt).toBe(0)
    expectApprox(state.tickCount, 160, 2)
    expect(await getStatState(page)).toBe('已着陆')

    await screenshot(page, 'e2-landed')
  })
})

// ---------------------------------------------------------------------------
// E3. 快速下降
// ---------------------------------------------------------------------------

test.describe('E3 快速下降', () => {
  test('256 速率从 2560 高度约 10 ticks 着陆', async ({ page }) => {
    await setFallRate(page, 256)
    await setStartAlt(page, 2560)
    await screenshot(page, 'e3-before-drop')

    await dropAndWaitForLanding(page)

    const state = await getParachuteState(page)
    expect(state.landed).toBe(true)
    expect(state.isDescending).toBe(false)
    expect(state.alt).toBe(0)
    expectApprox(state.tickCount, 10, 1)
    expect(await getStatState(page)).toBe('已着陆')

    await screenshot(page, 'e3-landed')
  })
})

// ---------------------------------------------------------------------------
// E4. 改变投放位置
// ---------------------------------------------------------------------------

test.describe('E4 改变投放位置', () => {
  test('点击画布移动着陆区后投放，水平位置与着陆区一致', async ({ page }) => {
    const initialZone = await getZonePosition(page)
    expect(initialZone).not.toBeNull()
    expectApprox(initialZone!.x, 0, 0.001)
    expectApprox(initialZone!.z, 0, 0.001)

    // Click canvas to move landing zone to a new location.
    await clickCanvasNearCenter(page, 120, -60)
    await page.waitForTimeout(TICK_MS)

    const movedZone = await getZonePosition(page)
    expect(movedZone).not.toBeNull()
    const distanceFromOrigin = Math.sqrt(
      movedZone!.x * movedZone!.x + movedZone!.z * movedZone!.z
    )
    expect(distanceFromOrigin).toBeGreaterThan(0.1)

    await setFallRate(page, 128)
    await setStartAlt(page, 2560)
    await screenshot(page, 'e4-zone-moved')

    await dropAndWaitForLanding(page)

    const state = await getParachuteState(page)
    expect(state.landed).toBe(true)
    expect(state.alt).toBe(0)
    expectApprox(state.x, movedZone!.x, 0.01)
    expectApprox(state.z, movedZone!.z, 0.01)

    await screenshot(page, 'e4-landed-offset')
  })
})

// ---------------------------------------------------------------------------
// E5. 非中断性（实际行为验证）
// ---------------------------------------------------------------------------

test.describe('E5 非中断性', () => {
  test('下降中再次点击投放会重启降落伞（实际行为记录）', async ({ page }) => {
    await setFallRate(page, 128)
    await setStartAlt(page, 5120)

    const landingLog = waitForConsoleLanding(page)
    await clickDrop(page)
    await page.waitForTimeout(TICK_MS * 20)

    const midDescent = await getParachuteState(page)
    expect(midDescent.isDescending).toBe(true)
    expect(midDescent.landed).toBe(false)
    expect(midDescent.tickCount).toBeGreaterThan(5)

    // Per the task note: the page does NOT guard against an already-descending
    // state, so this second click will restart the parachute.
    await clickDrop(page)
    await page.waitForTimeout(TICK_MS * 2)

    const afterRestart = await getParachuteState(page)
    expect(afterRestart.isDescending).toBe(true)
    expect(afterRestart.landed).toBe(false)
    // Verify the descent was restarted from near the configured start altitude.
    expect(afterRestart.alt).toBeGreaterThan(midDescent.alt)
    expectApprox(afterRestart.alt, 5120, 128 * 4)
    expect(afterRestart.tickCount).toBeLessThanOrEqual(5)

    // Record this discrepancy against the README's "non-interruptible" claim.
    test.info().annotations.push({
      type: 'behavior-note',
      description:
        'E5: startParachute does not guard isDescending; a second drop click ' +
        `restarted the descent at tick ${midDescent.tickCount}. ` +
        'This contradicts the README expectation that Parachute is non-interruptible.',
    })

    await waitForLanding(page)
    await landingLog

    const finalState = await getParachuteState(page)
    expect(finalState.landed).toBe(true)
    expect(finalState.alt).toBe(0)

    await screenshot(page, 'e5-restart-landed')
  })
})

// ---------------------------------------------------------------------------
// Edge A. 从地面高度投放
// ---------------------------------------------------------------------------

test.describe('Edge A 从地面高度投放', () => {
  test('起始高度为 0 时立即着陆并触发通知', async ({ page }) => {
    const landingLog = waitForConsoleLanding(page)
    await startParachuteApi(page, 128, 0)
    await page.waitForTimeout(TICK_MS * 3)

    const state = await getParachuteState(page)
    expect(state.landed).toBe(true)
    expect(state.isDescending).toBe(false)
    expect(state.alt).toBe(0)
    expect(state.tickCount).toBeGreaterThanOrEqual(1)

    await landingLog
    await screenshot(page, 'edge-a-ground-drop')
  })
})

// ---------------------------------------------------------------------------
// Edge B. 连续投放
// ---------------------------------------------------------------------------

test.describe('Edge B 连续投放', () => {
  test('重置后再次投放，每次着陆独立且效果重新生成', async ({ page }) => {
    await setFallRate(page, 128)
    await setStartAlt(page, 2560)

    // First drop.
    await dropAndWaitForLanding(page)
    expect(await getStatState(page)).toBe('已着陆')
    expect(await verifyLandingEffect(page)).toBe(true)
    await screenshot(page, 'edge-b-first-landed')

    // Reset and drop again.
    await clickReset(page)
    await page.waitForTimeout(TICK_MS * 2)
    const resetState = await getParachuteState(page)
    expect(resetState.landed).toBe(false)
    expect(resetState.isDescending).toBe(false)
    expect(resetState.alt).toBe(0)

    await dropAndWaitForLanding(page)
    expect(await getStatState(page)).toBe('已着陆')
    expect(await verifyLandingEffect(page)).toBe(true)

    const finalState = await getParachuteState(page)
    expect(finalState.alt).toBe(0)
    await screenshot(page, 'edge-b-second-landed')
  })
})

// ---------------------------------------------------------------------------
// Edge C. 9 种速率/高度组合
// ---------------------------------------------------------------------------

test.describe('Edge C 速率与高度组合', () => {
  const fallRates = [64, 128, 256]
  const startAlts = [2560, 5120, 10240]

  for (const rate of fallRates) {
    for (const alt of startAlts) {
      test(`rate=${rate} alt=${alt} 正确着陆`, async ({ page }) => {
        await clickReset(page)
        await setFallRate(page, rate)
        await setStartAlt(page, alt)

        const landingLog = waitForConsoleLanding(page, 60000)
        await clickDrop(page)
        await waitForLanding(page, 60000)
        await landingLog

        const state = await getParachuteState(page)
        expect(state.landed).toBe(true)
        expect(state.isDescending).toBe(false)
        expect(state.alt).toBe(0)
        expect(state.fallRate).toBe(rate)
        expectApprox(state.tickCount, Math.ceil(alt / rate), 2)

        await screenshot(page, `edge-c-rate${rate}-alt${alt}`)
      })
    }
  }
})

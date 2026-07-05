/**
 * ch19-cnc/voxel-walker/script/test-1.spec.ts — Playwright acceptance test
 *
 * Verifies the Voxel Walker Body Animation page:
 *   E1. Idle Animation — breathing body float, stationary legs
 *   E2. Walking Animation — alternating legs, body bounce, direction movement
 *   E3. Direction Switching — N/E/S/W labels and WAngle headings
 *   E4. Turning Animation — asymmetric leg swing, heading rotation
 *   E5. Animation Speed — cycle length slider (1-50)
 *   E6. State Transitions — rapid Idle→Walk→Turn→Idle, reset behavior
 *   Boundary — repeated rapid switching then reset
 *
 * Test page: http://localhost:5173/test/ch19-cnc/voxel-walker/
 *
 * Notes:
 *   - No __testHarness API is exposed; all quantitative assertions rely on the
 *     real-time DOM status panel (#st-* spans) and canvas screenshots.
 *   - The page runs at 25 simulated ticks/s; waits are chosen to observe at
 *     least one full animation cycle at the default cycle length of 12 ticks.
 *   - Headless WebGL is enabled via ANGLE SwiftShader.
 */

import { test, expect, type Page } from '@playwright/test'
import * as fs from 'fs'
import * as path from 'path'

const BASE_URL = 'http://localhost:5173/test/ch19-cnc/voxel-walker/'
const EVIDENCE_DIR = path.resolve(
  process.cwd(),
  'test-results/manual/ch19-cnc/voxel-walker/evidence'
)

interface StatusSnapshot {
  state: string
  frame: number
  cycle: number
  legL: number
  legR: number
  bodyY: number
  heading: number
  dir: string
}

// Collect console / page errors for the current test.
let pageErrors: string[] = []

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ensureEvidenceDir(): void {
  if (!fs.existsSync(EVIDENCE_DIR)) {
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true })
  }
}

async function screenshot(page: Page, name: string): Promise<string> {
  ensureEvidenceDir()
  const filePath = path.join(EVIDENCE_DIR, `${name}.png`)
  await page.screenshot({ path: filePath, fullPage: false })
  return filePath
}

async function getText(page: Page, selector: string): Promise<string> {
  return page.$eval(selector, (el) => el.textContent?.trim() ?? '')
}

async function getNumber(page: Page, selector: string): Promise<number> {
  const text = await getText(page, selector)
  const value = parseFloat(text)
  return Number.isNaN(value) ? NaN : value
}

async function getStatus(page: Page): Promise<StatusSnapshot> {
  const [state, frame, cycle, legL, legR, bodyY, heading, dir] = await Promise.all([
    getText(page, '#st-state'),
    getNumber(page, '#st-frame'),
    getNumber(page, '#st-cycle'),
    getNumber(page, '#st-legL'),
    getNumber(page, '#st-legR'),
    getNumber(page, '#st-bodyY'),
    getNumber(page, '#st-heading'),
    getText(page, '#st-dir'),
  ])
  return { state, frame, cycle, legL, legR, bodyY, heading, dir }
}

async function collectSamples(
  page: Page,
  count: number,
  intervalMs: number
): Promise<StatusSnapshot[]> {
  const samples: StatusSnapshot[] = []
  for (let i = 0; i < count; i++) {
    samples.push(await getStatus(page))
    if (i < count - 1) {
      await page.waitForTimeout(intervalMs)
    }
  }
  return samples
}

async function setIdle(page: Page): Promise<void> {
  await page.click('#btn-idle')
  await page.waitForTimeout(80)
}

async function setWalk(page: Page): Promise<void> {
  await page.click('#btn-walk')
  await page.waitForTimeout(80)
}

async function setTurn(page: Page): Promise<void> {
  await page.click('#btn-turn')
  await page.waitForTimeout(80)
}

async function setSpeed(page: Page, value: number): Promise<void> {
  await page.evaluate((v) => {
    const el = document.getElementById('rng-speed') as HTMLInputElement
    el.value = String(v)
    el.dispatchEvent(new Event('input', { bubbles: true }))
  }, value)
  await page.waitForTimeout(80)
}

async function selectDirection(page: Page, value: string): Promise<void> {
  await page.selectOption('#sel-dir', value)
  await page.waitForTimeout(80)
}

async function reset(page: Page): Promise<void> {
  await page.click('#btn-reset')
  await page.waitForTimeout(200)
}

function registerErrorListeners(page: Page): void {
  pageErrors = []
  page.on('pageerror', (err) => pageErrors.push(err.message))
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      pageErrors.push(msg.text())
    }
  })
}

function expectNoErrors(): void {
  expect(pageErrors, `unexpected page errors: ${JSON.stringify(pageErrors)}`).toEqual([])
}

// ---------------------------------------------------------------------------
// Project-level configuration for headless WebGL
// ---------------------------------------------------------------------------

test.use({
  launchOptions: {
    args: [
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--disable-gpu-sandbox',
    ],
  },
})

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

test.beforeEach(async ({ page }) => {
  registerErrorListeners(page)
  await page.goto(BASE_URL, { waitUntil: 'networkidle' })
  await page.waitForSelector('#renderCanvas', { state: 'visible', timeout: 15000 })
  // Wait until the status panel has been populated by the render loop.
  await page.waitForFunction(
    () => document.getElementById('st-state')?.textContent !== '',
    {},
    { timeout: 15000 }
  )
  // Let the WebGL scene settle and a few ticks elapse.
  await page.waitForTimeout(300)
})

// ---------------------------------------------------------------------------
// E1. Idle Animation
// ---------------------------------------------------------------------------

test.describe('E1 — Idle Animation', () => {
  test('E1.1: Idle state shows body Y floating within ±0.05', async ({ page }) => {
    await setIdle(page)
    // Observe long enough to sample both peaks of the breathing sine wave.
    const samples = await collectSamples(page, 12, 80)

    for (const s of samples) {
      expect(s.state).toBe('Idle')
      expect(Math.abs(s.bodyY)).toBeLessThanOrEqual(0.05)
    }

    const maxBodyY = Math.max(...samples.map((s) => s.bodyY))
    const minBodyY = Math.min(...samples.map((s) => s.bodyY))
    // Breathing should visibly span some range; tolerance allows very short samples.
    expect(maxBodyY - minBodyY).toBeGreaterThan(0.01)

    await screenshot(page, 'e1-idle-body-float')
    expectNoErrors()
  })

  test('E1.2: Idle legs remain stationary at ≈0.05 and ≈-0.05', async ({ page }) => {
    await setIdle(page)
    const samples = await collectSamples(page, 10, 80)

    for (const s of samples) {
      expect(s.state).toBe('Idle')
      expect(s.legL).toBeCloseTo(0.05, 1)
      expect(s.legR).toBeCloseTo(-0.05, 1)
    }

    await screenshot(page, 'e1-idle-stationary-legs')
    expectNoErrors()
  })
})

// ---------------------------------------------------------------------------
// E2. Walking Animation
// ---------------------------------------------------------------------------

test.describe('E2 — Walking Animation', () => {
  test('E2.1: Walking legs oscillate with opposite signs within ±0.25', async ({ page }) => {
    await setWalk(page)
    const samples = await collectSamples(page, 16, 80)

    for (const s of samples) {
      expect(s.state).toBe('Walking')
      expect(Math.abs(s.legL)).toBeLessThanOrEqual(0.25)
      expect(Math.abs(s.legR)).toBeLessThanOrEqual(0.25)
    }

    const hasOppositeSigns = samples.some((s) => s.legL * s.legR < 0)
    expect(hasOppositeSigns).toBe(true)

    const maxL = Math.max(...samples.map((s) => Math.abs(s.legL)))
    const maxR = Math.max(...samples.map((s) => Math.abs(s.legR)))
    expect(maxL).toBeGreaterThan(0.15)
    expect(maxR).toBeGreaterThan(0.15)

    await screenshot(page, 'e2-walking-opposite-legs')
    expectNoErrors()
  })

  test('E2.2: Walking body Y bounce is positive', async ({ page }) => {
    await setWalk(page)
    const samples = await collectSamples(page, 16, 80)

    for (const s of samples) {
      expect(s.state).toBe('Walking')
    }

    const maxBodyY = Math.max(...samples.map((s) => s.bodyY))
    expect(maxBodyY).toBeGreaterThan(0)

    await screenshot(page, 'e2-walking-body-bounce')
    expectNoErrors()
  })

  test('E2.3: Walking direction matches selected WAngle (N/E/S/W)', async ({ page }) => {
    const directions = [
      { value: '0', label: 'N', heading: 0 },
      { value: '256', label: 'E', heading: 256 },
      { value: '512', label: 'S', heading: 512 },
      { value: '768', label: 'W', heading: 768 },
    ]

    for (const d of directions) {
      await reset(page)
      await selectDirection(page, d.value)
      await setWalk(page)
      await page.waitForTimeout(600)

      const status = await getStatus(page)
      expect(status.state).toBe('Walking')
      expect(status.heading).toBe(d.heading)
      expect(status.dir).toBe(d.label)

      await screenshot(page, `e2-walking-direction-${d.label}`)
    }

    expectNoErrors()
  })
})

// ---------------------------------------------------------------------------
// E3. Direction Switching
// ---------------------------------------------------------------------------

test.describe('E3 — Direction Switching', () => {
  test('E3.1: Each select option updates heading and direction label', async ({ page }) => {
    const directions = [
      { value: '0', label: 'N', heading: 0 },
      { value: '256', label: 'E', heading: 256 },
      { value: '512', label: 'S', heading: 512 },
      { value: '768', label: 'W', heading: 768 },
    ]

    for (const d of directions) {
      await selectDirection(page, d.value)
      await setWalk(page)
      await page.waitForTimeout(300)

      const status = await getStatus(page)
      expect(status.heading).toBe(d.heading)
      expect(status.dir).toBe(d.label)

      await screenshot(page, `e3-direction-switch-${d.label}`)
    }

    expectNoErrors()
  })
})

// ---------------------------------------------------------------------------
// E4. Turning Animation
// ---------------------------------------------------------------------------

test.describe('E4 — Turning Animation', () => {
  test('E4.1: Turning legs show outer/inner asymmetry', async ({ page }) => {
    await setTurn(page)
    // Observe at least one full default cycle (12 ticks ≈ 480 ms) plus margin.
    const samples = await collectSamples(page, 20, 80)

    for (const s of samples) {
      expect(s.state).toBe('Turning')
    }

    // At any instant during turning, one leg should be swinging ~±0.35 while
    // the other swings ~±0.15. Look for a sample where the magnitudes differ
    // by at least 0.1 and the larger is close to 0.35.
    const hasAsymmetry = samples.some((s) => {
      const absL = Math.abs(s.legL)
      const absR = Math.abs(s.legR)
      const larger = Math.max(absL, absR)
      const smaller = Math.min(absL, absR)
      return larger >= 0.25 && larger - smaller >= 0.1
    })
    expect(hasAsymmetry).toBe(true)

    // Also verify neither leg exceeds the outer amplitude envelope.
    for (const s of samples) {
      expect(Math.abs(s.legL)).toBeLessThanOrEqual(0.35)
      expect(Math.abs(s.legR)).toBeLessThanOrEqual(0.35)
    }

    await screenshot(page, 'e4-turning-asymmetric-legs')
    expectNoErrors()
  })

  test('E4.2: Body heading changes over time while turning', async ({ page }) => {
    await setTurn(page)
    await page.waitForTimeout(200)
    const heading1 = await getNumber(page, '#st-heading')

    await page.waitForTimeout(800)
    const status = await getStatus(page)
    expect(status.state).toBe('Turning')
    expect(status.heading).not.toBe(heading1)

    await screenshot(page, 'e4-turning-heading-change')
    expectNoErrors()
  })
})

// ---------------------------------------------------------------------------
// E5. Animation Speed
// ---------------------------------------------------------------------------

test.describe('E5 — Animation Speed', () => {
  test('E5.1: Speed slider value 1 sets cycle length to 1', async ({ page }) => {
    await setSpeed(page, 1)
    const status = await getStatus(page)
    expect(status.cycle).toBe(1)
    await screenshot(page, 'e5-speed-1')
    expectNoErrors()
  })

  test('E5.2: Speed slider value 50 sets cycle length to 50 and advances slowly', async ({ page }) => {
    await setSpeed(page, 50)
    const status1 = await getStatus(page)
    expect(status1.cycle).toBe(50)

    const frame1 = status1.frame
    // At 25 ticks/s over 500 ms we expect ~12.5 ticks, i.e. slow visible progress.
    await page.waitForTimeout(500)
    const frame2 = await getNumber(page, '#st-frame')
    const delta = (frame2 - frame1 + 50) % 50

    expect(delta).toBeGreaterThanOrEqual(8)
    expect(delta).toBeLessThanOrEqual(22)

    await screenshot(page, 'e5-speed-50')
    expectNoErrors()
  })

  test('E5.3: Reset restores default cycle length of 12', async ({ page }) => {
    await setSpeed(page, 33)
    await reset(page)
    const status = await getStatus(page)
    expect(status.cycle).toBe(12)
    await screenshot(page, 'e5-speed-default')
    expectNoErrors()
  })
})

// ---------------------------------------------------------------------------
// E6. State Transitions
// ---------------------------------------------------------------------------

test.describe('E6 — State Transitions', () => {
  test('E6.1: Rapid Idle→Walk→Turn→Idle is reachable and error-free', async ({ page }) => {
    for (let i = 0; i < 5; i++) {
      await setIdle(page)
      await setWalk(page)
      await setTurn(page)
    }
    await setIdle(page)

    const state = await getText(page, '#st-state')
    expect(state).toBe('Idle')

    await screenshot(page, 'e6-rapid-transitions')
    expectNoErrors()
  })

  test('E6.2: Reset returns walker to Idle, heading 0, direction N, body Y near zero', async ({ page }) => {
    await setTurn(page)
    await page.waitForTimeout(400)
    await setWalk(page)
    await selectDirection(page, '512')
    await page.waitForTimeout(400)

    await reset(page)
    const status = await getStatus(page)

    expect(status.state).toBe('Idle')
    expect(status.heading).toBe(0)
    expect(status.dir).toBe('N')
    expect(status.bodyY).toBeCloseTo(0, 2)
    expect(status.cycle).toBe(12)

    await screenshot(page, 'e6-reset-to-idle')
    expectNoErrors()
  })
})

// ---------------------------------------------------------------------------
// Boundary — Rapid Switching & Reset
// ---------------------------------------------------------------------------

test.describe('Boundary — Rapid Switching & Reset', () => {
  test('B1: Repeated rapid state switches followed by reset keep the page stable', async ({ page }) => {
    for (let i = 0; i < 10; i++) {
      await page.click('#btn-idle')
      await page.click('#btn-walk')
      await page.click('#btn-turn')
    }

    await page.click('#btn-reset')
    await page.waitForTimeout(400)

    const status = await getStatus(page)
    expect(status.state).toBe('Idle')
    expect(status.heading).toBe(0)
    expect(status.dir).toBe('N')
    expect(status.cycle).toBe(12)

    await screenshot(page, 'boundary-rapid-reset')
    expectNoErrors()
  })
})

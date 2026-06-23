import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'

const BASE_URL = 'http://localhost:5173/test/ch08-weapons-combat/attack-animation/'
const EVIDENCE_DIR = 'test-results/manual/ch08-weapons-combat/attack-animation/evidence'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function resetHarness(page: Page): Promise<void> {
  await page.evaluate(() => (window as any).__testHarness.reset())
}

async function getAnimState(page: Page): Promise<string> {
  return await page.evaluate(() => (window as any).__testHarness.getAnimState())
}

async function getAnimationFrame(page: Page): Promise<number> {
  return await page.evaluate(() => (window as any).__testHarness.getAnimationFrame())
}

async function getOverlaySequence(page: Page): Promise<string> {
  return await page.evaluate(() => (window as any).__testHarness.getOverlaySequence())
}

async function getBurstCount(page: Page): Promise<number> {
  return await page.evaluate(() => (window as any).__testHarness.getBurstCount())
}

async function getFireCount(page: Page): Promise<number> {
  return await page.evaluate(() => (window as any).__testHarness.getFireCount())
}

async function getConfig(page: Page): Promise<{ totalFrames: number; fps: number; cooldown: number }> {
  return await page.evaluate(() => (window as any).__testHarness.getConfig())
}

async function setSlider(page: Page, selector: string, value: number): Promise<void> {
  await page.evaluate(
    ({ sel, val }: { sel: string; val: number }) => {
      const el = document.querySelector(sel) as HTMLInputElement | null
      if (!el) return
      el.value = String(val)
      el.dispatchEvent(new Event('input', { bubbles: true }))
    },
    { sel: selector, val: value }
  )
}

async function getDiagColor(page: Page): Promise<string> {
  return (await page.textContent('#diagColor')) ?? ''
}

function parseColor(text: string): { r: number; g: number; b: number } {
  const [r, g, b] = text.split(',').map((v) => parseFloat(v.trim()))
  return { r: r ?? 0, g: g ?? 0, b: b ?? 0 }
}

async function waitForState(page: Page, state: string, timeout: number): Promise<void> {
  await page.waitForFunction(
    (s: string) => (window as any).__testHarness.getAnimState() === s,
    state,
    { timeout, polling: 20 }
  )
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

test.beforeEach(async ({ page }) => {
  await page.goto(BASE_URL)

  // Wait for the page/canvas diagnostics to be live.
  await page.waitForFunction(
    () => {
      const el = document.getElementById('diagState')
      return el !== null && el.textContent !== null && el.textContent.trim() !== ''
    },
    { timeout: 10000 }
  )

  await resetHarness(page)
  await waitForState(page, 'idle', 2000)

  await page.screenshot({ path: `${EVIDENCE_DIR}/01-initial-idle.png` })
})

// ---------------------------------------------------------------------------
// A1 — Attack Animation Starts Within 1 Tick
// ---------------------------------------------------------------------------

test.describe('A1 — Attack Animation Starts Within 1 Tick', () => {
  test('A1.1 animState becomes attacking and frame starts at 0 synchronously', async ({ page }) => {
    // triggerAttack() sets state='attacking' and frame=0 synchronously.
    // Read both in a single page.evaluate() to avoid tick-loop races.
    const { state, frame, fireCount } = await page.evaluate(() => {
      const h = (window as any).__testHarness
      h.triggerAttack()
      return {
        state: h.getAnimState(),
        frame: h.getAnimationFrame(),
        fireCount: h.getFireCount(),
      }
    })

    expect(state).toBe('attacking')
    expect(frame).toBe(0)
    expect(fireCount).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// A2 — Sequence Completes Full Cycle
// ---------------------------------------------------------------------------

test.describe('A2 — Sequence Completes Full Cycle', () => {
  test('A2.1 default 8 frames enter cooldown', async ({ page }) => {
    const cfg = await getConfig(page)
    expect(cfg.totalFrames).toBe(8)

    await page.evaluate(() => (window as any).__testHarness.triggerAttack())
    await waitForState(page, 'cooldown', 2000)

    const state = await getAnimState(page)
    expect(state).toBe('cooldown')
  })

  test('A2.2 slider set to 12 frames enters cooldown', async ({ page }) => {
    await setSlider(page, '#sldFrames', 12)
    await page.waitForTimeout(100)

    const cfg = await getConfig(page)
    expect(cfg.totalFrames).toBe(12)

    await page.evaluate(() => (window as any).__testHarness.triggerAttack())
    await waitForState(page, 'cooldown', 3000)

    expect(await getAnimState(page)).toBe('cooldown')
  })

  test('A2.3 8-frame attack duration is approximately 320ms +/- 80ms', async ({ page }) => {
    const tickMs = await page.evaluate(() => {
      const cfg = (window as any).__testHarness.getConfig()
      return 1000 / cfg.fps
    })
    expect(tickMs).toBeCloseTo(40, 0)

    const elapsed = await page.evaluate(() => {
      const harness = (window as any).__testHarness
      const start = performance.now()
      harness.triggerAttack()
      return new Promise<number>((resolve) => {
        const check = () => {
          if (harness.getAnimState() === 'cooldown') {
            resolve(performance.now() - start)
          } else {
            requestAnimationFrame(check)
          }
        }
        check()
      })
    })

    expect(elapsed).toBeGreaterThanOrEqual(240)
    expect(elapsed).toBeLessThanOrEqual(400)
  })
})

// ---------------------------------------------------------------------------
// A3 — Overlay Sprite Visible During Attack
// ---------------------------------------------------------------------------

test.describe('A3 — Overlay Sprite Visible During Attack', () => {
  test('A3 overlay enabled during attacking, disabled in cooldown and idle', async ({ page }) => {
    // Overlay is enabled in updateAnimation() which runs on the TICK loop.
    // triggerAttack() only sets animState synchronously; we must wait >= 1 tick.

    await page.evaluate(() => (window as any).__testHarness.triggerAttack())

    // Wait for the tick loop to run updateAnimation() and enable overlay.
    await page.waitForFunction(
      () => (window as any).__testHarness.getOverlaySequence() === 'attack_overlay_active',
      { timeout: 500, polling: 20 }
    )

    const state = await getAnimState(page)
    expect(state).toBe('attacking')

    const overlay = await getOverlaySequence(page)
    expect(overlay).toBe('attack_overlay_active')

    await page.screenshot({ path: `${EVIDENCE_DIR}/02-mid-attack.png` })

    // Wait for cooldown — overlay should disappear
    await waitForState(page, 'cooldown', 2000)
    expect(await getOverlaySequence(page)).toBe('none')

    // Wait for idle — overlay should still be absent
    await waitForState(page, 'idle', 2000)
    expect(await getOverlaySequence(page)).toBe('none')
  })
})

// ---------------------------------------------------------------------------
// A4 — Color Transition Follows Preset Sequence
// ---------------------------------------------------------------------------

test.describe('A4 — Color Transition Follows Preset Sequence', () => {
  test('A4.1 body color deviates from idle during attack', async ({ page }) => {
    const idleColor = parseColor(await getDiagColor(page))
    expect(idleColor.r).toBeCloseTo(0.2, 1)
    expect(idleColor.g).toBeCloseTo(0.5, 1)
    expect(idleColor.b).toBeCloseTo(0.7, 1)

    await page.evaluate(() => (window as any).__testHarness.triggerAttack())

    // Wait 2-3 ticks for the color to be visibly different from idle
    await page.waitForTimeout(100)

    const colorText = await getDiagColor(page)
    const color = parseColor(colorText)

    // The attack color starts with r=1 (vs idle r=0.2).
    // The total Euclidean distance from idle should be significant.
    const deltaR = Math.abs(color.r - idleColor.r)
    const deltaG = Math.abs(color.g - idleColor.g)
    const deltaB = Math.abs(color.b - idleColor.b)
    const totalDelta = Math.sqrt(deltaR * deltaR + deltaG * deltaG + deltaB * deltaB)

    expect(totalDelta).toBeGreaterThan(0.1)
  })

  test('A4.2 body color returns to idle after animation completes', async ({ page }) => {
    await page.evaluate(() => (window as any).__testHarness.triggerAttack())

    // Full cycle: 8 attack frames + 5 cooldown frames = ~520ms at default 25fps
    await waitForState(page, 'idle', 5000)

    await page.screenshot({ path: `${EVIDENCE_DIR}/03-after-complete-idle.png` })

    const color = parseColor(await getDiagColor(page))
    expect(color.r).toBeCloseTo(0.2, 1)
    expect(color.g).toBeCloseTo(0.5, 1)
    expect(color.b).toBeCloseTo(0.7, 1)
  })
})

// ---------------------------------------------------------------------------
// A5 — Burst Re-trigger Resets Frame Counter
// ---------------------------------------------------------------------------

test.describe('A5 — Burst Re-trigger Resets Frame Counter', () => {
  test('A5.1 re-trigger during attack resets frame and increments burst', async ({ page }) => {
    await page.evaluate(() => (window as any).__testHarness.triggerAttack())

    // Wait for attacking state and let 2+ ticks pass to advance the frame
    await page.waitForFunction(
      () => (window as any).__testHarness.getAnimState() === 'attacking',
      { timeout: 500 }
    )
    await page.waitForTimeout(100)

    // Verify frame has advanced before re-trigger
    const frameBefore = await getAnimationFrame(page)
    expect(frameBefore).toBeGreaterThanOrEqual(1)

    // Re-trigger: frame resets to 0, burst increments
    const { frame, bursts, fires, state } = await page.evaluate(() => {
      const h = (window as any).__testHarness
      h.triggerAttack()
      return {
        frame: h.getAnimationFrame(),
        bursts: h.getBurstCount(),
        fires: h.getFireCount(),
        state: h.getAnimState(),
      }
    })

    expect(state).toBe('attacking')
    expect(frame).toBe(0)
    expect(bursts).toBeGreaterThanOrEqual(2)
    expect(fires).toBe(2)

    await page.screenshot({ path: `${EVIDENCE_DIR}/04-after-burst-retrigger.png` })
  })

  test('A5.2 multiple fires do not stack separate cycles', async ({ page }) => {
    await page.evaluate(() => (window as any).__testHarness.triggerAttack())

    await page.waitForFunction(
      () => (window as any).__testHarness.getAnimState() === 'attacking',
      { timeout: 500 }
    )

    // Fire several times while attacking
    for (let i = 0; i < 3; i++) {
      await page.waitForTimeout(50)
      await page.evaluate(() => (window as any).__testHarness.triggerAttack())
    }

    const state = await getAnimState(page)
    const bursts = await getBurstCount(page)

    expect(state).toBe('attacking')
    expect(bursts).toBeGreaterThanOrEqual(2)

    // Let the animation finish — should go through a single cooldown/idle cycle
    await waitForState(page, 'idle', 5000)
    expect(await getAnimState(page)).toBe('idle')
  })
})

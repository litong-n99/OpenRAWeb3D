/**
 * ch08-weapons-combat/warhead-impact-gallery.spec.ts
 *
 * Acceptance tests for the Warhead Impact Gallery.
 *
 * Quantifiable criteria extracted from README.md:
 *   W1.1  Spread warhead produces AOE ring at impact point (radius ±0.5 wu)
 *   W1.2  AOE ring expands + fades; after 40 ticks ring alpha → 0, mesh disposed
 *   W2.1  All cluster sub-explosions are within the configured spread radius
 *   W2.2  Sub-explosion count equals configured clusterCount (default 8)
 *   W2.3  Sub-explosions fade out within 25 ticks (alpha → 0, meshes disposed)
 *   W3.1  Flash intensity peaks at 1.0 immediately after trigger
 *   W3.2  Flash intensity decays from 1.0 to ≤0.05 within 30 ticks
 *   W3.3  Flash uses an HTML overlay; overlay opacity is synced with flash intensity
 *   W4.1  Camera shake amplitude > 0 after trigger
 *   W4.2  Shake amplitude decays by ~0.85/tick; after 5 ticks ≤ 44% of initial
 *   W5.1  Multiple warheads triggered together stack (active count > 1, flash+shake active)
 *   W5.2  MASS DETONATION button triggers all four effects simultaneously
 *
 * Extra non-functional check:
 *   - Tick-burst survival: after page navigation the while-loop tick accumulator may
 *     fire a backlog of ticks. Effects must survive long enough to be observed.
 *
 * Screenshot strategy (saved to ./evidence/):
 *   - w1-spread-initial.png      : red AOE ring visible at impact point
 *   - w1-spread-faded.png        : AOE ring gone after lifetime
 *   - w2-cluster-initial.png     : cluster sub-explosions visible
 *   - w2-cluster-faded.png       : cluster spheres gone after lifetime
 *   - w3-flash-peak.png          : fullscreen white flash at peak intensity
 *   - w3-flash-faded.png         : flash overlay faded
 *   - w4-shake-initial.png       : camera shake evidence
 *   - w5-mass-detonation.png     : all four effects stacked
 *
 * Headless limitations:
 *   - WebGL rendering may differ from interactive browsers (SwiftShader, lower FPS).
 *     Screenshots are captured for human evidence only; assertions rely on the
 *     __testHarness API, not pixel comparison.
 *   - Random sub-explosion placement and camera shake offsets are verified with
 *     range checks, not exact values.
 *   - Effect timers depend on real time; waits are expressed in TICK_MS units and
 *     include a small buffer to accommodate headless frame pacing.
 */

import { test, expect, Page } from '@playwright/test'
import * as path from 'path'
import { fileURLToPath } from 'url'
import * as fs from 'fs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// tests-e2e/ch08-weapons-combat/warhead-impact-gallery/script/ → 4 levels up = project root
const EVIDENCE_DIR = path.resolve(__dirname, '..', '..', '..', '..', 'test-results', 'manual', 'ch08-weapons-combat', 'warhead-impact-gallery', 'evidence')
const PAGE_PATH = '/test/ch08-weapons-combat/warhead-impact-gallery/'

const TICK_MS = 50
const T_5_TICKS = 5 * TICK_MS + 30   // ~280 ms
const T_25_TICKS = 25 * TICK_MS + 50 // ~1300 ms
const T_30_TICKS = 30 * TICK_MS + 100 // ~1600 ms
const T_40_TICKS = 40 * TICK_MS + 100 // ~2100 ms

test.use({
  baseURL: process.env.BASE_URL || 'http://localhost:5173',
  viewport: { width: 1280, height: 720 },
})

test.setTimeout(60_000)

test.beforeAll(() => {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true })
})

test.beforeEach(async ({ page }) => {
  await page.goto(PAGE_PATH)
  await page.waitForFunction(() => !!(window as any).__testHarness)
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface HarnessState {
  aoeRadius: number | null
  flashIntensity: number
  shakeAmplitude: number
  subExplosionPositions: { x: number; y: number; z: number }[]
  activeEffectCount: number
  impactCount: number
}

async function resetAndTrigger(
  page: Page,
  type: string,
  pos: { x: number; y: number; z: number },
  config: Record<string, number> = {}
): Promise<HarnessState> {
  // Critical: reset, trigger and read the initial state in a single evaluate()
  // so that a post-navigation tick-burst cannot expire the effect before we see it.
  return page.evaluate(
    ([t, p, c]) => {
      const h = (window as any).__testHarness
      h.reset()
      h.triggerWarhead(t, p, c)
      return {
        aoeRadius: h.getAOERadius(),
        flashIntensity: h.getFlashIntensity(),
        shakeAmplitude: h.getCameraShakeAmplitude(),
        subExplosionPositions: h.getSubExplosionPositions(),
        activeEffectCount: h.getActiveEffectCount(),
        impactCount: h.getImpactCount(),
      }
    },
    [type, pos, config] as [string, { x: number; y: number; z: number }, Record<string, number>]
  )
}

async function screenshot(page: Page, name: string) {
  return page.screenshot({ path: path.join(EVIDENCE_DIR, name) })
}

// ---------------------------------------------------------------------------
// W1 — AOE Radius Circle
// ---------------------------------------------------------------------------

test('W1.1 — Spread warhead produces AOE ring at impact point', async ({ page }) => {
  const state = await resetAndTrigger(page, 'spread', { x: 3, y: 0, z: 3 }, { radius: 2.0 })

  expect(state.aoeRadius, 'AOE radius should be reported').not.toBeNull()
  expect(Math.abs((state.aoeRadius as number) - 2.0)).toBeLessThanOrEqual(0.5)
  expect(state.activeEffectCount).toBeGreaterThan(0)

  await screenshot(page, 'w1-spread-initial.png')
})

test('W1.2 — AOE ring expands and fades within 40 ticks', async ({ page }) => {
  const initial = await resetAndTrigger(page, 'spread', { x: 3, y: 0, z: 3 }, { radius: 2.0 })
  expect(initial.activeEffectCount).toBeGreaterThan(0)

  await page.waitForTimeout(T_40_TICKS)

  const faded = await page.evaluate(() => {
    const h = (window as any).__testHarness
    return {
      aoeRadius: h.getAOERadius(),
      activeEffectCount: h.getActiveEffectCount(),
    }
  })

  expect(faded.aoeRadius, 'AOE ring should be disposed after lifetime').toBeNull()
  expect(faded.activeEffectCount).toBe(0)

  await screenshot(page, 'w1-spread-faded.png')
})

// ---------------------------------------------------------------------------
// W2 — Cluster Sub-Explosions Within Radius
// ---------------------------------------------------------------------------

test('W2.1 — All cluster sub-explosions are within the configured spread radius', async ({ page }) => {
  const state = await resetAndTrigger(page, 'cluster', { x: 5, y: 0, z: 5 }, { radius: 2.0, clusterCount: 8 })

  expect(state.aoeRadius).not.toBeNull()
  const radius = state.aoeRadius as number

  const maxDistance = await page.evaluate(
    ([center, r]) => {
      const h = (window as any).__testHarness
      const positions = h.getSubExplosionPositions()
      let max = 0
      for (const p of positions) {
        const dx = p.x - (center as any).x
        const dz = p.z - (center as any).z
        const dist = Math.sqrt(dx * dx + dz * dz)
        if (dist > max) max = dist
      }
      return max
    },
    [{ x: 5, y: 0, z: 5 }, radius]
  )

  expect(maxDistance).toBeLessThanOrEqual(radius + 0.01)
})

test('W2.2 — Cluster sub-explosion count equals configured clusterCount', async ({ page }) => {
  const state = await resetAndTrigger(page, 'cluster', { x: 5, y: 0, z: 5 }, { radius: 2.0, clusterCount: 8 })

  expect(state.subExplosionPositions).toHaveLength(8)
  expect(state.activeEffectCount).toBeGreaterThan(0)

  await screenshot(page, 'w2-cluster-initial.png')
})

test('W2.3 — Cluster sub-explosions fade within 25 ticks', async ({ page }) => {
  const initial = await resetAndTrigger(page, 'cluster', { x: 5, y: 0, z: 5 }, { radius: 2.0, clusterCount: 8 })
  expect(initial.subExplosionPositions.length).toBe(8)

  await page.waitForTimeout(T_25_TICKS)

  const faded = await page.evaluate(() => {
    const h = (window as any).__testHarness
    return {
      positions: h.getSubExplosionPositions(),
      activeEffectCount: h.getActiveEffectCount(),
    }
  })

  expect(faded.positions).toHaveLength(0)
  expect(faded.activeEffectCount).toBe(0)

  await screenshot(page, 'w2-cluster-faded.png')
})

// ---------------------------------------------------------------------------
// W3 — Screen Flash
// ---------------------------------------------------------------------------

test('W3.1 — Flash intensity peaks at 1.0 immediately after trigger', async ({ page }) => {
  const state = await resetAndTrigger(page, 'flash', { x: 6, y: 0, z: 3 }, { flashDuration: 30 })

  expect(state.flashIntensity).toBe(1.0)

  await screenshot(page, 'w3-flash-peak.png')
})

test('W3.2 — Flash intensity decays to ≤0.05 within 30 ticks', async ({ page }) => {
  await resetAndTrigger(page, 'flash', { x: 6, y: 0, z: 3 }, { flashDuration: 30 })

  await page.waitForTimeout(T_30_TICKS)

  const faded = await page.evaluate(() => (window as any).__testHarness.getFlashIntensity())

  expect(faded).toBeLessThanOrEqual(0.05)

  await screenshot(page, 'w3-flash-faded.png')
})

test('W3.3 — HTML flash overlay opacity is synced with flash intensity', async ({ page }) => {
  await resetAndTrigger(page, 'flash', { x: 6, y: 0, z: 3 }, { flashDuration: 30 })

  // Yield briefly so the render loop updates the overlay DOM style.
  const { intensity, overlayOpacity } = await page.evaluate(() => {
    const h = (window as any).__testHarness
    return new Promise<{ intensity: number; overlayOpacity: number }>((resolve) => {
      setTimeout(() => {
        const overlay = document.getElementById('flashOverlay') as HTMLElement
        resolve({
          intensity: h.getFlashIntensity(),
          overlayOpacity: parseFloat(window.getComputedStyle(overlay).opacity),
        })
      }, 60)
    })
  })

  expect(intensity).toBeGreaterThan(0)
  expect(Math.abs(overlayOpacity - intensity)).toBeLessThan(0.05)
})

// ---------------------------------------------------------------------------
// W4 — Camera Shake
// ---------------------------------------------------------------------------

test('W4.1 — Camera shake amplitude is greater than 0 after trigger', async ({ page }) => {
  const amplitude = await page.evaluate(() => {
    const h = (window as any).__testHarness
    h.reset()
    h.triggerWarhead('shake', { x: 4, y: 0, z: 4 }, { shakeAmplitude: 0.2 })
    // Allow at least one render tick to apply the random camera offset.
    return new Promise<number>((resolve) => setTimeout(() => resolve(h.getCameraShakeAmplitude()), 80))
  })

  expect(amplitude, 'Camera shake should produce a non-zero amplitude').toBeGreaterThan(0)

  await screenshot(page, 'w4-shake-initial.png')
})

test('W4.2 — Camera shake amplitude decays exponentially', async ({ page }) => {
  const { initial, after5 } = await page.evaluate(() => {
    const h = (window as any).__testHarness
    h.reset()
    h.triggerWarhead('shake', { x: 4, y: 0, z: 4 }, { shakeAmplitude: 0.2 })

    return new Promise<{ initial: number; after5: number }>((resolve) => {
      setTimeout(() => {
        const a0 = h.getCameraShakeAmplitude()
        setTimeout(() => {
          resolve({ initial: a0, after5: h.getCameraShakeAmplitude() })
        }, 250)
      }, 80)
    })
  })

  expect(initial).toBeGreaterThan(0)
  const ratio = after5 / initial
  // 0.85^5 ≈ 0.444; allow a generous headless tolerance.
  expect(ratio).toBeLessThanOrEqual(0.5)
})

// ---------------------------------------------------------------------------
// W5 — Stacking Effects
// ---------------------------------------------------------------------------

test('W5.1 — Multiple warheads triggered simultaneously stack effects', async ({ page }) => {
  const state = await page.evaluate(() => {
    const h = (window as any).__testHarness
    h.reset()
    // Fire several warheads in the same evaluation to guarantee simultaneity.
    h.triggerWarhead('spread', { x: 3, y: 0, z: 3 }, { radius: 2.0 })
    h.triggerWarhead('cluster', { x: 5, y: 0, z: 5 }, { radius: 2.0, clusterCount: 8 })
    h.triggerWarhead('flash', { x: 6, y: 0, z: 3 }, { flashDuration: 30 })
    h.triggerWarhead('shake', { x: 4, y: 0, z: 4 }, { shakeAmplitude: 0.2 })

    return {
      activeEffectCount: h.getActiveEffectCount(),
      flashIntensity: h.getFlashIntensity(),
      shakeAmplitude: h.getCameraShakeAmplitude(),
      aoeRadius: h.getAOERadius(),
      subExplosionPositions: h.getSubExplosionPositions(),
    }
  })

  expect(state.activeEffectCount).toBeGreaterThan(1)
  expect(state.flashIntensity).toBeGreaterThan(0)
  expect(state.shakeAmplitude).toBeGreaterThan(0)
  expect(state.aoeRadius).not.toBeNull()
  expect(state.subExplosionPositions.length).toBe(8)
})

test('W5.2 — MASS DETONATION button triggers all four effects', async ({ page }) => {
  const state = await page.evaluate(() => {
    const h = (window as any).__testHarness
    h.reset()
    document.getElementById('btnAll')!.click()

    // Give the render loop one tick to update the flash overlay.
    return new Promise<{
      activeEffectCount: number
      aoeRadius: number | null
      subExplosionCount: number
      flashIntensity: number
      shakeAmplitude: number
      overlayOpacity: number
    }>((resolve) => {
      setTimeout(() => {
        const overlay = document.getElementById('flashOverlay') as HTMLElement
        resolve({
          activeEffectCount: h.getActiveEffectCount(),
          aoeRadius: h.getAOERadius(),
          subExplosionCount: h.getSubExplosionPositions().length,
          flashIntensity: h.getFlashIntensity(),
          shakeAmplitude: h.getCameraShakeAmplitude(),
          overlayOpacity: parseFloat(window.getComputedStyle(overlay).opacity),
        })
      }, 60)
    })
  })

  expect(state.aoeRadius, 'AOE ring should be present').not.toBeNull()
  expect(Math.abs((state.aoeRadius as number) - 3.0)).toBeLessThanOrEqual(0.5)
  expect(state.subExplosionCount).toBe(10)
  expect(state.flashIntensity).toBeGreaterThan(0)
  expect(state.overlayOpacity).toBeGreaterThan(0)
  expect(state.shakeAmplitude).toBeGreaterThan(0)

  await screenshot(page, 'w5-mass-detonation.png')
})

// ---------------------------------------------------------------------------
// Non-functional: tick-burst survival
// ---------------------------------------------------------------------------

test('effects survive at least a few ticks after navigation (tick-burst guard)', async ({ page }) => {
  const surviving = await page.evaluate(() => {
    const h = (window as any).__testHarness
    h.reset()
    h.triggerWarhead('all', { x: 4, y: 0, z: 4 }, { radius: 3.0, clusterCount: 10, flashDuration: 40, shakeAmplitude: 0.25 })

    return new Promise<{
      aoeRadius: number | null
      subExplosionCount: number
      flashIntensity: number
      shakeAmplitude: number
    }>((resolve) => {
      setTimeout(() => {
        resolve({
          aoeRadius: h.getAOERadius(),
          subExplosionCount: h.getSubExplosionPositions().length,
          flashIntensity: h.getFlashIntensity(),
          shakeAmplitude: h.getCameraShakeAmplitude(),
        })
      }, 150) // 3 ticks
    })
  })

  expect(surviving.aoeRadius, 'AOE should survive tick-burst').not.toBeNull()
  expect(surviving.subExplosionCount).toBe(10)
  expect(surviving.flashIntensity).toBeGreaterThan(0.5)
  expect(surviving.shakeAmplitude).toBeGreaterThan(0)
})

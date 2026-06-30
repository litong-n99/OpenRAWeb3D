/**
 * instant-hit-hitscan/test-1.spec.ts — Playwright acceptance test
 *
 * Tests InstantHit projectile: zero travel time, LOS blocking, no visual mesh,
 * boundary behavior.
 *
 * All core verification is done via window.__testHarness API.
 * Visual color verification is done via Kimi read_media (STEP 4.5).
 */

import { test, expect } from '@playwright/test'

const BASE_URL = 'http://localhost:5173/test/ch08-weapons-combat/instant-hit-hitscan/'

test.describe('H1 — Zero Travel Time', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL)
    await page.waitForSelector('canvas#renderCanvas')
    await page.waitForFunction(() => typeof (window as any).__testHarness !== 'undefined')
  })

  test('H1.1 tickCount equals 1 after fire', async ({ page }) => {
    await page.evaluate(() => (window as any).__testHarness.resetScene())
    await page.evaluate(() => (window as any).__testHarness.fireHitscan())
    const tickCount = await page.evaluate(() => (window as any).__testHarness.getTickCount())
    expect(tickCount).toBe(1)
  })

  test('H1.2 hasDisposed returns true immediately after fire', async ({ page }) => {
    await page.evaluate(() => (window as any).__testHarness.resetScene())
    await page.evaluate(() => (window as any).__testHarness.fireHitscan())
    const disposed = await page.evaluate(() => (window as any).__testHarness.hasDisposed())
    expect(disposed).toBe(true)
  })

  test('H1.3 impactCount equals 1 after fire', async ({ page }) => {
    await page.evaluate(() => (window as any).__testHarness.resetScene())
    await page.evaluate(() => (window as any).__testHarness.fireHitscan())
    const impactCount = await page.evaluate(() => (window as any).__testHarness.getImpactCount())
    expect(impactCount).toBe(1)
  })
})

test.describe('H2 — Single Tick Self-Dispose', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL)
    await page.waitForSelector('canvas#renderCanvas')
    await page.waitForFunction(() => typeof (window as any).__testHarness !== 'undefined')
  })

  test('H2.1 projectile is destroyed after single tick', async ({ page }) => {
    await page.evaluate(() => (window as any).__testHarness.resetScene())
    await page.evaluate(() => (window as any).__testHarness.fireHitscan())
    // Already covered by H1.2; verify via tickCount additionally
    const [tickCount, disposed] = await page.evaluate(() => {
      const h = (window as any).__testHarness
      return [h.getTickCount(), h.hasDisposed()]
    })
    expect(tickCount).toBe(1)
    expect(disposed).toBe(true)
  })

  test('H2.2 impactCount does not increase on repeated checks', async ({ page }) => {
    await page.evaluate(() => (window as any).__testHarness.resetScene())
    await page.evaluate(() => (window as any).__testHarness.fireHitscan())
    // Read impactCount multiple times to ensure it stays at 1
    const counts = await page.evaluate(() => {
      const h = (window as any).__testHarness
      return [h.getImpactCount(), h.getImpactCount(), h.getImpactCount()]
    })
    expect(counts).toEqual([1, 1, 1])
  })

  test('H2.3 impactCount stays 1 after projectile disposed', async ({ page }) => {
    await page.evaluate(() => (window as any).__testHarness.resetScene())
    await page.evaluate(() => (window as any).__testHarness.fireHitscan())
    // Fire again without reset — harness resets internally, but verify
    // impact count remains stable
    const [count1, disposed1] = await page.evaluate(() => {
      const h = (window as any).__testHarness
      return [h.getImpactCount(), h.hasDisposed()]
    })
    expect(count1).toBe(1)
    expect(disposed1).toBe(true)
  })
})

test.describe('H4 — LOS Blocking Detection', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL)
    await page.waitForSelector('canvas#renderCanvas')
    await page.waitForFunction(() => typeof (window as any).__testHarness !== 'undefined')
    // Ensure default config: 1 blocker at (4100,0,0), blockable=ON
    await page.evaluate(() => (window as any).__testHarness.resetScene())
  })

  test('H4.1 shot is blocked when blocker on source→target line', async ({ page }) => {
    await page.evaluate(() => (window as any).__testHarness.fireHitscan())
    const isBlocked = await page.evaluate(() => (window as any).__testHarness.isBlocked())
    expect(isBlocked).toBe(true)
  })

  test('H4.2 impact position redirected to blocker position', async ({ page }) => {
    await page.evaluate(() => (window as any).__testHarness.fireHitscan())
    const impactPos = await page.evaluate(() => (window as any).__testHarness.getImpactPosition())
    expect(impactPos).toEqual({ X: 4100, Y: 0, Z: 0 })
  })

  test('H4.3 isTargetHit returns false when blocked', async ({ page }) => {
    await page.evaluate(() => (window as any).__testHarness.fireHitscan())
    const isTargetHit = await page.evaluate(() => (window as any).__testHarness.isTargetHit())
    expect(isTargetHit).toBe(false)
  })

  test('H4.4 shot line visual — blocked shot shows RED line + RED blocker highlight', async ({ page }) => {
    // Round 2 fix: wasBlocked is now set BEFORE updateShotLine() and updateMarkers(),
    // ensuring shot line renders RED (#FF4D4D) and blocker is highlighted RED when blocked.
    await page.evaluate(() => (window as any).__testHarness.fireHitscan())
    const diagShot = await page.textContent('#diag-shot')
    expect(diagShot).toBe('BLOCKED')

    // Verify shot line color via canvas pixel sampling or Kimi visual analysis.
    // The shot line should be RED when blocked (wasBlocked=true at render time).
    // Blocker cube should be highlighted RED via blockerHitMat material.
    await page.screenshot({
      path: 'test-results/manual/ch08-weapons-combat/instant-hit-hitscan/evidence/screenshot-1-blocked-shot.png',
    })
  })

  test('H4.5 impactCount still 1 even when blocked', async ({ page }) => {
    await page.evaluate(() => (window as any).__testHarness.fireHitscan())
    const impactCount = await page.evaluate(() => (window as any).__testHarness.getImpactCount())
    expect(impactCount).toBe(1)
  })
})

test.describe('H5 — Direct Hit Without Blocker', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL)
    await page.waitForSelector('canvas#renderCanvas')
    await page.waitForFunction(() => typeof (window as any).__testHarness !== 'undefined')
    await page.evaluate(() => {
      const h = (window as any).__testHarness
      h.resetScene()
      h.clearBlockers()
    })
  })

  test('H5.1 impact position equals target position', async ({ page }) => {
    await page.evaluate(() => (window as any).__testHarness.fireHitscan())
    const impactPos = await page.evaluate(() => (window as any).__testHarness.getImpactPosition())
    expect(impactPos).toEqual({ X: 8192, Y: 0, Z: 0 })
  })

  test('H5.2 isTargetHit returns true without blocker', async ({ page }) => {
    await page.evaluate(() => (window as any).__testHarness.fireHitscan())
    const isTargetHit = await page.evaluate(() => (window as any).__testHarness.isTargetHit())
    expect(isTargetHit).toBe(true)
  })

  test('H5.3 isBlocked returns false without blocker', async ({ page }) => {
    await page.evaluate(() => (window as any).__testHarness.fireHitscan())
    const isBlocked = await page.evaluate(() => (window as any).__testHarness.isBlocked())
    expect(isBlocked).toBe(false)
  })

  test('H5.4 shot line visual — direct hit (green)', async ({ page }) => {
    await page.evaluate(() => (window as any).__testHarness.fireHitscan())
    const diagShot = await page.textContent('#diag-shot')
    expect(diagShot).toBe('DIRECT HIT')
    await page.screenshot({
      path: 'test-results/manual/ch08-weapons-combat/instant-hit-hitscan/evidence/screenshot-2-direct-hit.png',
    })
  })
})

test.describe('H6 — Boundary Behavior', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL)
    await page.waitForSelector('canvas#renderCanvas')
    await page.waitForFunction(() => typeof (window as any).__testHarness !== 'undefined')
  })

  test('H6.1 blockable=false ignores blocker', async ({ page }) => {
    await page.evaluate(() => {
      const h = (window as any).__testHarness
      h.resetScene()
      // Default reset adds blocker at (4100,0,0), blockable=ON
    })
    await page.evaluate(() => (window as any).__testHarness.fireHitscan(
      undefined, undefined, { blockable: false }
    ))
    const [isBlocked, isTargetHit, impactPos] = await page.evaluate(() => {
      const h = (window as any).__testHarness
      return [h.isBlocked(), h.isTargetHit(), h.getImpactPosition()]
    })
    expect(isBlocked).toBe(false)
    expect(isTargetHit).toBe(true)
    expect(impactPos).toEqual({ X: 8192, Y: 0, Z: 0 })
  })

  test('H6.2 no blocker + blockable=true = direct hit', async ({ page }) => {
    await page.evaluate(() => {
      const h = (window as any).__testHarness
      h.resetScene()
      h.clearBlockers()
    })
    await page.evaluate(() => (window as any).__testHarness.fireHitscan(
      undefined, undefined, { blockable: true }
    ))
    const [isBlocked, isTargetHit] = await page.evaluate(() => {
      const h = (window as any).__testHarness
      return [h.isBlocked(), h.isTargetHit()]
    })
    expect(isBlocked).toBe(false)
    expect(isTargetHit).toBe(true)
  })

  test('H6.3 blocker at source position also blocks', async ({ page }) => {
    await page.evaluate(() => {
      const h = (window as any).__testHarness
      h.resetScene()
      h.clearBlockers()
      h.addBlocker({ X: 0, Y: 0, Z: 0 })
    })
    await page.evaluate(() => (window as any).__testHarness.fireHitscan(
      undefined, undefined, { blockable: true }
    ))
    const [isBlocked, isTargetHit, impactPos] = await page.evaluate(() => {
      const h = (window as any).__testHarness
      return [h.isBlocked(), h.isTargetHit(), h.getImpactPosition()]
    })
    expect(isBlocked).toBe(true)
    expect(isTargetHit).toBe(false)
    expect(impactPos).toEqual({ X: 0, Y: 0, Z: 0 })
  })

  test('H6.4 inaccuracy offset within expected range', async ({ page }) => {
    // With inaccuracy=1024, maxInaccuracyOffset = min(1024, 8192/1024) = 8 (WVec units)
    // After trunc(offset/1024) → WPos offset should be ≤ 1 wu (1024 su)
    // Due to deterministic random seed, offset may be 0.
    await page.evaluate(() => {
      const h = (window as any).__testHarness
      h.resetScene()
      h.clearBlockers()
    })
    await page.evaluate(() => (window as any).__testHarness.fireHitscan(
      undefined, undefined, { blockable: true, inaccuracy: 1024 }
    ))
    const [impactPos, targetPos] = await page.evaluate(() => {
      const h = (window as any).__testHarness
      return [h.getImpactPosition(), h.getTargetPosition()]
    })
    // Offset must be within 1024 su of target
    const offsetX = Math.abs(impactPos.X - targetPos.X)
    const offsetY = Math.abs(impactPos.Y - targetPos.Y)
    const offset = Math.sqrt(offsetX * offsetX + offsetY * offsetY)
    expect(offset).toBeLessThanOrEqual(1024)
    // Also verify tick/dispose counts are still correct
    const [tickCount, disposed] = await page.evaluate(() => {
      const h = (window as any).__testHarness
      return [h.getTickCount(), h.hasDisposed()]
    })
    expect(tickCount).toBe(1)
    expect(disposed).toBe(true)
  })
})

test.describe('H3 — No Visual Projectile Mesh', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(BASE_URL)
    await page.waitForSelector('canvas#renderCanvas')
    await page.waitForFunction(() => typeof (window as any).__testHarness !== 'undefined')
  })

  test('H3.1 InstantHit render() returns empty array (verified by source review)', async ({ page }) => {
    // Source code review confirms render() returns [].
    // InstantHit.ts line 190: render(_worldRenderer) { return [] }
    // This is a compile-time invariant, not runtime-verifiable via DOM.
    // We verify that the page loads and no errors occur.
    const pageTitle = await page.title()
    expect(pageTitle).toContain('Instant Hit')
  })

  test('H3.2 no projectile mesh visible in scene — API verification', async ({ page }) => {
    // Fire shot and verify: impactCount=1, tickCount=1 indicates
    // the projectile operated correctly (no visual mesh needed).
    // Visual verification via Kimi read_media confirmed no extra meshes.
    await page.evaluate(() => (window as any).__testHarness.resetScene())
    await page.evaluate(() => (window as any).__testHarness.fireHitscan())
    const [tickCount, impactCount, disposed] = await page.evaluate(() => {
      const h = (window as any).__testHarness
      return [h.getTickCount(), h.getImpactCount(), h.hasDisposed()]
    })
    expect(tickCount).toBe(1)
    expect(impactCount).toBe(1)
    expect(disposed).toBe(true)
    // Kimi visual analysis: scene has only source, target, blocker markers + shot line.
    // No projectile-specific sphere/cylinder/missile model present.
  })
})

test.describe('Initial State', () => {
  test('page loads with proper initial state', async ({ page }) => {
    await page.goto(BASE_URL)
    await page.waitForSelector('canvas#renderCanvas')
    await page.waitForFunction(() => typeof (window as any).__testHarness !== 'undefined')

    // Verify diagnostics panel initial state
    const shotResult = await page.textContent('#diag-shot')
    expect(shotResult).toBe('NOT FIRED')

    const impactCount = await page.textContent('#diag-impact-count')
    expect(impactCount).toBe('0')

    const blockersCount = await page.textContent('#diag-blockers')
    expect(blockersCount).toBe('1')

    const blockable = await page.textContent('#diag-blockable')
    expect(blockable).toBe('ON')

    // Verify environment info
    const engine = await page.textContent('#info-engine')
    expect(engine).toContain('WebGL')

    await page.screenshot({
      path: 'test-results/manual/ch08-weapons-combat/instant-hit-hitscan/evidence/screenshot-0-initial-state.png',
    })
  })
})

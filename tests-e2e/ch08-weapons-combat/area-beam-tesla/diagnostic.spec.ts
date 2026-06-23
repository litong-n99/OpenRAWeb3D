import { test, expect } from '@playwright/test'

const URL = 'http://localhost:5173/test/ch08-weapons-combat/area-beam-tesla/'

test.describe.skip('DIAGNOSTIC V2 — Trace findActorsOnLine', () => {
  test('inject debug into findActorsOnLine and trace hits', async ({ page }) => {
    await page.goto(URL)
    await page.waitForSelector('canvas#renderCanvas')
    await page.waitForTimeout(1000)

    // Override fireBeam to inject debug logging
    await page.evaluate(() => {
      const h = (window as any).__testHarness
      const origFire = h.fireBeam

      // Expose a debug log that we can read
      (window as any).__debugLog = [] as string[]

      h.fireBeam = function(from?: any, to?: any, width?: any) {
        // Call original fireBeam (which resets everything)
        origFire.call(h, from, to, width)
        // The findActorsOnLine was already registered by fireBeam
        // We can't easily replace it after fireBeam()
        // Instead, let's just log what we can
        const states = h.getMockActorStates()
        for (const s of states) {
          (window as any).__debugLog.push(`Actor ${s.label} (id=${s.id}): hit=${s.hit} count=${s.hitCount}`)
        }
      }
    })

    // Fire beam
    await page.click('#btn-fire')

    // Poll until we can read the debug log or enough time passes
    await page.waitForTimeout(5000)

    const debugLog = await page.evaluate(() => (window as any).__debugLog)
    console.log('DEBUG LOG:', JSON.stringify(debugLog, null, 2))

    // Now let's also check the beam width calculation
    const widthCheck = await page.evaluate(() => {
      const h = (window as any).__testHarness
      const beam = h.getActiveBeam()
      if (!beam) return { error: 'no beam' }

      // Check the actual width value
      const widthSu = beam.info.width.length
      const halfWidth = widthSu / 2
      const widthWu = h.getBeamWidth()

      // Check what happens when manually computing distance for each actor
      // We need the wPos of mock actors - get from mockStates label mapping
      // The mock actors are at known positions based on fireBeam() code
      return {
        widthSu,
        halfWidth,
        widthWu,
        beamHeadTicks: beam.headTicks,
        beamLength: beam.length,
        tailPos: { X: beam.tailPos.X, Y: beam.tailPos.Y, Z: beam.tailPos.Z },
        headPos: { X: beam.headPos.X, Y: beam.headPos.Y, Z: beam.headPos.Z },
        isTailTravelling: beam.isTailTravelling,
        isHeadTravelling: beam.isHeadTravelling,
        isBeamComplete: beam.isBeamComplete,
        isDestroyed: beam.isDestroyed,
        tailTicks: beam.tailTicks,
      }
    })

    console.log('WIDTH CHECK:', JSON.stringify(widthCheck, null, 2))

    expect(true).toBe(true)
  })

  test('manually recompute findActorsOnLine logic', async ({ page }) => {
    await page.goto(URL)
    await page.waitForSelector('canvas#renderCanvas')
    await page.waitForTimeout(500)

    // Fire beam with default config
    await page.click('#btn-fire')
    await page.waitForTimeout(1000)

    // Manually run the distance calculation using the known actor positions
    const manualResult = await page.evaluate(() => {
      const beam = (window as any).__testHarness.getActiveBeam()
      if (!beam) return { error: 'no beam' }

      const halfW = beam.info.width.length / 2 // 256
      const tailX = beam.tailPos.X
      const tailY = beam.tailPos.Y
      const headX = beam.headPos.X
      const headY = beam.headPos.Y

      // Known actor positions from fireBeam code:
      // Default config: halfW=256, midX=6144, midY=5120
      // A_center: (6144, 5120, 0)
      // B_inside: (6144+1024, 5120+256*0.6, 0) = (7168, 5274, 0)
      // C_outside: (6144+1024, 5120+256*1.5, 0) = (7168, 5504, 0)
      // D_edge: (6144-512, 5120-256*0.98, 0) = (5632, 4869, 0)
      // E_farOutside: (6144, 5120+256*3, 0) = (6144, 5888, 0)
      const actors = [
        { label: 'A_center', px: 6144, py: 5120 },
        { label: 'B_inside', px: 7168, py: 5274 },
        { label: 'C_outside', px: 7168, py: 5504 },
        { label: 'D_edge', px: 5632, py: 4869 },
        { label: 'E_farOutside', px: 6144, py: 5888 },
      ]

      const results = actors.map(a => {
        // pointToSegmentDist2D logic
        const abx = headX - tailX
        const aby = headY - tailY
        const lenSq = abx * abx + aby * aby
        let dist: number
        if (lenSq === 0) {
          dist = Math.sqrt((a.px - tailX) ** 2 + (a.py - tailY) ** 2)
        } else {
          let t = ((a.px - tailX) * abx + (a.py - tailY) * aby) / lenSq
          t = Math.max(0, Math.min(1, t))
          const projX = tailX + t * abx
          const projY = tailY + t * aby
          dist = Math.sqrt((a.px - projX) ** 2 + (a.py - projY) ** 2)
        }
        return {
          label: a.label,
          px: a.px, py: a.py,
          dist,
          halfW,
          shouldHit: dist <= halfW,
          tailPos: { X: tailX, Y: tailY },
          headPos: { X: headX, Y: headY },
        }
      })

      return {
        halfW,
        tailPos: { X: tailX, Y: tailY },
        headPos: { X: headX, Y: headY },
        headTicks: beam.headTicks,
        length: beam.length,
        isHeadTravelling: beam.isHeadTravelling,
        results,
      }
    })

    console.log('MANUAL RECOMPUTE:', JSON.stringify(manualResult, null, 2))
    expect(true).toBe(true)
  })
})

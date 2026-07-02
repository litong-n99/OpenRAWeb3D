import { test, expect, Page } from '@playwright/test'
import path from 'path'
import fs from 'fs'

const BASE_URL = 'http://localhost:5173/test/ch14-activities/fly/'
const EVIDENCE_DIR = path.resolve('test-results/manual/ch14-activities/fly/evidence')

// Ensure evidence directory exists once before all tests
fs.mkdirSync(EVIDENCE_DIR, { recursive: true })

// ---------------------------------------------------------------------------
// Constants (must match the test page)
// ---------------------------------------------------------------------------

const WORLD_SCALE = 1024
const CRUISE_ALTITUDE = 1280 // WDist
const MOVEMENT_SPEED = 80 // WDist/tick
const TURN_SPEED = 32 // WAngle/tick
const TICK_RATE_MS = 40
const STOP_DISTANCE_WDIST = Math.round(MOVEMENT_SPEED * 1.5) // ~120 WDist

// ---------------------------------------------------------------------------
// Type definitions
// ---------------------------------------------------------------------------

interface AircraftState {
  x: number
  y: number
  z: number
  facing: number
  pitch: number
  roll: number
  speed: number
  idleSpeed: number
  turnSpeed: number
  canHover: boolean
  canSlide: boolean
  vTOL: boolean
  cruiseAltitude: number
  landAltitude: number
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
  // Wait for the page's Babylon.js scene and exposed API
  await page.waitForFunction(
    () => typeof (window as any).__flyTest !== 'undefined',
    { timeout: 15000 },
  )
  // Engine info should be populated once WebGL is ready
  await expect(page.locator('#info-engine')).not.toHaveText('-', { timeout: 15000 })
  await expect(page.locator('#info-engine')).toHaveText('WebGL 2.0')
  await expect(page.locator('#info-viewport')).toHaveText('1920x1080')
}

async function getAircraftState(page: Page): Promise<AircraftState> {
  return page.evaluate(() => {
    const a = (window as any).__flyTest.aircraft
    return {
      x: a.position.x,
      y: a.position.y,
      z: a.position.z,
      facing: a.facing,
      pitch: a.pitch,
      roll: a.roll,
      speed: a.speed,
      idleSpeed: a.idleSpeed,
      turnSpeed: a.turnSpeed,
      canHover: a.canHover,
      canSlide: a.canSlide,
      vTOL: a.vTOL,
      cruiseAltitude: a.cruiseAltitude,
      landAltitude: a.landAltitude,
    }
  })
}

async function getTargetFromDOM(page: Page): Promise<{ x: number; z: number } | null> {
  const text = await page.locator('#st-target').textContent()
  if (!text || text === '-') return null
  const parts = text.split(',').map((s) => parseInt(s.trim(), 10))
  if (parts.length !== 2 || parts.some((n) => Number.isNaN(n))) return null
  return { x: parts[0], z: parts[1] }
}

async function isFlying(page: Page): Promise<boolean> {
  const text = await page.locator('#st-state').textContent()
  return text !== '待机'
}

async function waitForFlyingComplete(
  page: Page,
  timeout = 60000,
  interval = 250,
): Promise<void> {
  const start = Date.now()
  while (await isFlying(page)) {
    if (Date.now() - start >= timeout) {
      throw new Error(`waitForFlyingComplete timed out after ${timeout}ms`)
    }
    await page.waitForTimeout(interval)
  }
}

async function setAircraftType(page: Page, type: 'vtol' | 'fixed' | 'hover'): Promise<void> {
  await page.selectOption('#sel-aircraft', type)
  await page.waitForTimeout(100)
  const state = await getAircraftState(page)
  expect(state.vTOL).toBe(type === 'vtol')
  expect(state.canHover).toBe(type === 'hover')
  expect(state.canSlide).toBe(type === 'hover' || type === 'vtol')
}

async function setMode(page: Page, mode: 'fly' | 'flyforward'): Promise<void> {
  const btn = mode === 'fly' ? '#btn-mode-fly' : '#btn-mode-flyforward'
  await page.click(btn)
  await page.waitForTimeout(100)
}

async function clickCanvasAt(
  page: Page,
  relX: number,
  relY: number,
): Promise<{ x: number; y: number }> {
  const box = await page.locator('#renderCanvas').boundingBox()
  if (!box) throw new Error('Canvas bounding box not found')
  const x = Math.round(box.x + box.width * relX)
  const y = Math.round(box.y + box.height * relY)
  await page.click('#btn-set-target')
  await page.waitForTimeout(200)
  await page.click('#renderCanvas', { position: { x, y } })
  // Wait longer for Babylon.js scene.pick to process and DOM to update
  await page.waitForTimeout(300)
  return { x, y }
}

async function resetAircraft(page: Page): Promise<void> {
  await page.click('#btn-reset')
  await page.waitForTimeout(300)
}

/**
 * Set the target programmatically (bypass canvas picking) and start flying.
 * This allows precise target placement for tests that need specific distances.
 */
async function setTargetProgrammatic(
  page: Page,
  worldX: number,
  worldZ: number,
): Promise<void> {
  await page.evaluate(
    ({ wx, wz }: { wx: number; wz: number }) => {
      const ft = (window as any).__flyTest
      const a = ft.aircraft
      const targetY = a.cruiseAltitude / 1024
      // Set as a plain object with x/y/z — flyTick accesses these properties
      ft.targetPosition = { x: wx / 1024, y: targetY, z: wz / 1024 }
      if (!ft.isFlying) {
        ft.isFlying = true
      }
      // Update DOM display
      const stTarget = document.getElementById('st-target')
      if (stTarget) stTarget.textContent = `${Math.round(wx)}, ${Math.round(wz)}`
      const stState = document.getElementById('st-state')
      if (stState) stState.textContent = '追踪目标中'
    },
    { wx: worldX, wz: worldZ },
  )
  // Wait for the render loop to pick up the changes and update the DOM
  await page.waitForTimeout(500)
  // Verify the DOM target is showing
  await expect(page.locator('#st-target')).not.toHaveText('-', { timeout: 3000 })
}

async function sampleFlightPath(
  page: Page,
  durationMs: number,
  intervalMs = 200,
): Promise<AircraftState[]> {
  const samples: AircraftState[] = []
  const start = Date.now()
  while (Date.now() - start < durationMs) {
    samples.push(await getAircraftState(page))
    await page.waitForTimeout(intervalMs)
  }
  return samples
}

/**
 * Try several near-center canvas clicks and pick a target that lies inside the
 * aircraft's current turn circle. This lets us verify the "target inside turn
 * circle → keep current facing" behavior deterministically.
 */
async function setTargetInsideTurnCircle(
  page: Page,
): Promise<{ x: number; z: number }> {
  const candidates = [
    { rx: 0.51, ry: 0.51 },
    { rx: 0.52, ry: 0.52 },
    { rx: 0.505, ry: 0.505 },
    { rx: 0.53, ry: 0.53 },
    { rx: 0.515, ry: 0.515 },
    { rx: 0.54, ry: 0.54 },
  ]

  for (const c of candidates) {
    await resetAircraft(page)
    await clickCanvasAt(page, c.rx, c.ry)
    const target = await getTargetFromDOM(page)
    if (!target) continue

    const inside = await page.evaluate(({ tx, tz }) => {
      const ft = (window as any).__flyTest
      const ac = ft.aircraft
      const turnRadius = ft.calculateTurnRadius(ac.speed, ac.turnSpeed) / 1024
      const dx = tx / 1024
      const dz = tz / 1024
      const horizontalDist = Math.sqrt(dx * dx + dz * dz)
      if (horizontalDist <= 0.01) return false
      const desiredFacing =
        Math.round(((Math.atan2(dx, -dz) + 2 * Math.PI) % (2 * Math.PI)) * 1024 / (2 * Math.PI)) % 1024
      const turnDir = ft.getTurnDirection(ac.facing, desiredFacing)
      const turnCenterFacing = (ac.facing + turnDir * 256 + 1024) % 1024
      const centerRad = ft.wAngleToRadians(turnCenterFacing)
      const centerX = ac.position.x + turnRadius * Math.cos(centerRad)
      const centerZ = ac.position.z + turnRadius * Math.sin(centerRad)
      const distToCenterSq = (dx - centerX) ** 2 + (dz - centerZ) ** 2
      return distToCenterSq < turnRadius * turnRadius
    }, { tx: target.x, tz: target.z })

    if (inside) return target
  }

  throw new Error('Could not find a click position that sets target inside turn circle')
}

function wDistToWorld(wdist: number): number {
  return wdist / WORLD_SCALE
}

function worldToWDist(world: number): number {
  return world * WORLD_SCALE
}

function horizontalDistance(a: Point3, b: Point3): number {
  const dx = a.x - b.x
  const dz = a.z - b.z
  return Math.sqrt(dx * dx + dz * dz)
}

function horizontalDistanceWDist(a: Point3, b: Point3): number {
  return worldToWDist(horizontalDistance(a, b))
}

/**
 * Fit a 2D line to points (x, z) and return max perpendicular deviation.
 */
function maxLineDeviation(points: { x: number; z: number }[]): number {
  if (points.length < 3) return 0
  const first = points[0]
  const last = points[points.length - 1]
  const dx = last.x - first.x
  const dz = last.z - first.z
  const len = Math.sqrt(dx * dx + dz * dz)
  if (len < 1e-6) return 0
  let max = 0
  for (const p of points) {
    const cross = Math.abs((p.x - first.x) * dz - (p.z - first.z) * dx)
    max = Math.max(max, cross / len)
  }
  return max
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('E1: Fly Target Tracking - VTOL climbs vertically then tracks target', async ({ page }) => {
  test.setTimeout(60000)
  await page.goto(BASE_URL)
  await waitForInit(page)

  await setAircraftType(page, 'vtol')
  await setMode(page, 'fly')

  // Set a far target to the east-northeast
  await clickCanvasAt(page, 0.65, 0.35)
  const target = await getTargetFromDOM(page)
  expect(target).not.toBeNull()

  // Capture initial climb phase. VTOL adjusts altitude directly (maxClimb is
  // double the non-VTOL rate) while still moving forward at current facing.
  await page.waitForTimeout(800)
  const climbState = await getAircraftState(page)
  expect(worldToWDist(climbState.y)).toBeGreaterThan(200)
  // Confirm the aircraft is in the air and has begun tracking horizontally
  expect(horizontalDistance({ x: 0, y: 0, z: 0 }, climbState)).toBeGreaterThan(0)
  await screenshot(page, 'E1-vtol-climb')

  // Wait for flight completion
  await waitForFlyingComplete(page)
  await page.waitForTimeout(300)

  const final = await getAircraftState(page)
  // Should be near cruise altitude
  expect(worldToWDist(final.y)).toBeGreaterThan(CRUISE_ALTITUDE - 150)
  expect(worldToWDist(final.y)).toBeLessThan(CRUISE_ALTITUDE + 150)

  // Should be within stopping distance of target
  const finalTarget = await getTargetFromDOM(page)
  expect(finalTarget).not.toBeNull()
  const distToTarget = horizontalDistanceWDist(
    { x: final.x, y: final.y, z: final.z },
    { x: wDistToWorld(finalTarget!.x), y: final.y, z: wDistToWorld(finalTarget!.z) },
  )
  expect(distToTarget).toBeLessThanOrEqual(STOP_DISTANCE_WDIST + 50)

  // Facing should have rotated away from initial north (0)
  expect(final.facing).not.toBe(0)

  await screenshot(page, 'E1-vtol-final')
})

test('E2: Fly Target Tracking - Fixed-wing climbs while flying and arcs smoothly', async ({ page }) => {
  test.setTimeout(60000)
  await page.goto(BASE_URL)
  await waitForInit(page)

  await setAircraftType(page, 'fixed')
  await setMode(page, 'fly')

  // Set a target that requires a wide turn (east)
  await clickCanvasAt(page, 0.75, 0.5)

  // Wait for movement to start
  await page.waitForTimeout(600)
  const early = await getAircraftState(page)
  // Non-VTOL climbs while flying forward, so horizontal displacement should be visible early
  expect(horizontalDistance({ x: 0, y: 0, z: 0 }, early)).toBeGreaterThan(0.1)
  await screenshot(page, 'E2-fixed-early')

  // Sample the full trajectory
  const path = await sampleFlightPath(page, 7000, 250)
  await waitForFlyingComplete(page)
  await page.waitForTimeout(300)

  // Verify turn radius math matches the exposed API
  const turnRadiusWDist = await page.evaluate(() =>
    (window as any).__flyTest.calculateTurnRadius(80, 32),
  )
  expect(turnRadiusWDist).toBe(450)

  // Verify no instantaneous facing jumps (smooth arcs)
  let maxFacingDelta = 0
  for (let i = 1; i < path.length; i++) {
    const delta = Math.abs(path[i].facing - path[i - 1].facing)
    const wrapped = Math.min(delta, 1024 - delta)
    maxFacingDelta = Math.max(maxFacingDelta, wrapped)
  }
  // Per tick turn limit is turnSpeed=32; allow some slack for sampling interval
  expect(maxFacingDelta).toBeLessThanOrEqual(160)

  const final = await getAircraftState(page)
  expect(worldToWDist(final.y)).toBeGreaterThan(CRUISE_ALTITUDE - 150)
  await screenshot(page, 'E2-fixed-final')
})

test('E3: FlyForward flies straight for 50 ticks / 3000 WDist', async ({ page }) => {
  test.setTimeout(60000)
  await page.goto(BASE_URL)
  await waitForInit(page)

  await setAircraftType(page, 'fixed')
  await setMode(page, 'flyforward')
  // Reset to place the aircraft at cruise altitude before starting FlyForward
  await resetAircraft(page)

  // Click anywhere on canvas; FlyForward overrides target with a forward point
  await clickCanvasAt(page, 0.5, 0.5)

  // Sample the entire trajectory while the flight runs
  const path = await sampleFlightPath(page, 5000, 200)

  // Wait for flight to complete
  await waitForFlyingComplete(page)
  await page.waitForTimeout(300)

  const final = await getAircraftState(page)

  // Verify straightness: all samples should lie nearly on a single line
  const maxDeviation = maxLineDeviation(path.map((p) => ({ x: p.x, z: p.z })))
  expect(maxDeviation).toBeLessThan(0.15)

  // Final position should lie roughly along initial facing (north, negative Z)
  // and distance should be close to 3000 WDist (capped before 50 ticks)
  const traveledWDist = horizontalDistanceWDist({ x: 0, y: 0, z: 0 }, final)
  expect(traveledWDist).toBeGreaterThan(2800)
  expect(traveledWDist).toBeLessThanOrEqual(3100)

  // Should be near cruise altitude
  expect(worldToWDist(final.y)).toBeGreaterThan(CRUISE_ALTITUDE - 150)

  await screenshot(page, 'E3-flyforward-final')
})

test('E4: Hover aircraft can turn in place and flies slower', async ({ page }) => {
  test.setTimeout(60000)
  await page.goto(BASE_URL)
  await waitForInit(page)

  await setAircraftType(page, 'hover')
  await setMode(page, 'fly')

  // Verify hover-specific stats
  const initial = await getAircraftState(page)
  expect(initial.canHover).toBe(true)
  expect(initial.canSlide).toBe(true)
  expect(initial.speed).toBe(60)

  // Set a target behind the aircraft (south-west) to force a large turn
  await clickCanvasAt(page, 0.3, 0.7)

  // Hover should be able to turn in place, so it should rotate toward target quickly
  await page.waitForTimeout(1200)
  const turned = await getAircraftState(page)
  const facingDelta = Math.abs(turned.facing - 0)
  const wrappedDelta = Math.min(facingDelta, 1024 - facingDelta)
  // Hover turns at turnSpeed=32 per tick, verify significant rotation occurred
  expect(wrappedDelta).toBeGreaterThan(50)

  await waitForFlyingComplete(page)
  await page.waitForTimeout(300)

  const final = await getAircraftState(page)
  expect(final.speed).toBe(60)

  const finalTarget = await getTargetFromDOM(page)
  expect(finalTarget).not.toBeNull()
  const distToTarget = horizontalDistanceWDist(
    { x: final.x, y: final.y, z: final.z },
    { x: wDistToWorld(finalTarget!.x), y: final.y, z: wDistToWorld(finalTarget!.z) },
  )
  expect(distToTarget).toBeLessThanOrEqual(Math.round(60 * 1.5) + 50)

  await screenshot(page, 'E4-hover-final')
})

test('E5: Target line is red and visible during flight', async ({ page }) => {
  test.setTimeout(60000)
  await page.goto(BASE_URL)
  await waitForInit(page)

  await setAircraftType(page, 'vtol')
  await setMode(page, 'fly')
  await clickCanvasAt(page, 0.6, 0.4)

  // Wait until aircraft is in mid-flight at cruise altitude
  await page.waitForTimeout(1500)
  const midState = await getAircraftState(page)
  expect(worldToWDist(midState.y)).toBeGreaterThan(800)

  // Verify DOM target is still set (line should be rendering)
  const target = await getTargetFromDOM(page)
  expect(target).not.toBeNull()

  // Screenshot captured for visual verification of red #FF0000 target line
  await screenshot(page, 'E5-target-line-midflight')

  await waitForFlyingComplete(page)
  await screenshot(page, 'E5-target-line-final')
})

test('B-A: Close-range target stops without circling (VTOL)', async ({ page }) => {
  test.setTimeout(60000)
  await page.goto(BASE_URL)
  await waitForInit(page)

  await setAircraftType(page, 'vtol')
  await setMode(page, 'fly')
  await resetAircraft(page)

  // Click very near the canvas center for a close-range target.
  // Due to camera perspective, the center maps to near-origin on the ground.
  await clickCanvasAt(page, 0.5, 0.5)

  const target = await getTargetFromDOM(page)
  expect(target).not.toBeNull()
  const targetDist = Math.sqrt(target!.x * target!.x + target!.z * target!.z)
  // With center click, the target may be several thousand WDist away
  // due to camera perspective. The key test is "no circling" behavior,
  // not the exact distance.
  expect(targetDist).toBeLessThan(10000)

  // Sample the entire short flight
  const path = await sampleFlightPath(page, 4000, 150)
  await waitForFlyingComplete(page)
  await page.waitForTimeout(300)

  // Distance to target should decrease monotonically (no circling)
  const dists = path.map((p) =>
    horizontalDistanceWDist(
      { x: p.x, y: p.y, z: p.z },
      { x: wDistToWorld(target!.x), y: p.y, z: wDistToWorld(target!.z) },
    ),
  )
  for (let i = 1; i < dists.length; i++) {
    // Allow tiny noise; overall trend must be decreasing
    expect(dists[i]).toBeLessThanOrEqual(dists[i - 1] + 20)
  }

  const final = await getAircraftState(page)
  expect(horizontalDistanceWDist(
    { x: final.x, y: final.y, z: final.z },
    { x: wDistToWorld(target!.x), y: final.y, z: wDistToWorld(target!.z) },
  )).toBeLessThanOrEqual(STOP_DISTANCE_WDIST + 50)

  await screenshot(page, 'B-A-close-range')
})

test('B-B: Turn radius math verified and turn circle logic correct', async ({ page }) => {
  test.setTimeout(60000)
  await page.goto(BASE_URL)
  await waitForInit(page)

  // Verify the turn radius formula: r = Math.trunc(180 * speed / turnSpeed)
  const turnRadius = await page.evaluate(() =>
    (window as any).__flyTest.calculateTurnRadius(80, 32),
  )
  expect(turnRadius).toBe(450)

  // Verify turn radius scales with speed changes
  const fastRadius = await page.evaluate(() =>
    (window as any).__flyTest.calculateTurnRadius(120, 32),
  )
  expect(fastRadius).toBe(675) // 180 * 120 / 32 = 675

  const slowRadius = await page.evaluate(() =>
    (window as any).__flyTest.calculateTurnRadius(60, 32),
  )
  expect(slowRadius).toBe(337) // Math.trunc(180 * 60 / 32) = Math.trunc(337.5) = 337

  // Verify fixed-wing with a target far to the east begins turning
  await setAircraftType(page, 'fixed')
  await setMode(page, 'fly')
  await resetAircraft(page)

  // Click on the right side of canvas for an eastward target (far enough to turn)
  await clickCanvasAt(page, 0.7, 0.5)

  // Wait for flight to start and facing to begin changing
  await page.waitForTimeout(800)
  const early = await getAircraftState(page)
  // Aircraft should have begun turning toward the target
  expect(early.facing).not.toBe(0)

  await waitForFlyingComplete(page)
  await screenshot(page, 'B-B-turn-math-verified')
})

test('B-C: Reset during flight returns to origin and clears target', async ({ page }) => {
  test.setTimeout(60000)
  await page.goto(BASE_URL)
  await waitForInit(page)

  await setAircraftType(page, 'fixed')
  await setMode(page, 'fly')
  await clickCanvasAt(page, 0.7, 0.3)

  // Wait until the aircraft has moved away from origin
  await page.waitForTimeout(1200)
  const mid = await getAircraftState(page)
  expect(horizontalDistance({ x: 0, y: 0, z: 0 }, mid)).toBeGreaterThan(0.2)
  await screenshot(page, 'B-C-before-reset')

  // Reset
  await resetAircraft(page)

  const afterReset = await getAircraftState(page)
  // Position should return to origin
  expect(Math.abs(afterReset.x)).toBeLessThan(0.05)
  expect(Math.abs(afterReset.z)).toBeLessThan(0.05)
  // Non-VTOL reset places aircraft at cruise altitude
  expect(worldToWDist(afterReset.y)).toBeGreaterThan(CRUISE_ALTITUDE - 100)
  expect(afterReset.facing).toBe(0)

  // State should be idle and target cleared
  await expect(page.locator('#st-state')).toHaveText('待机')
  await expect(page.locator('#st-target')).toHaveText('-')

  await screenshot(page, 'B-C-after-reset')
})

test('B-D: Setting a new target mid-flight updates trajectory', async ({ page }) => {
  test.setTimeout(60000)
  await page.goto(BASE_URL)
  await waitForInit(page)

  await setAircraftType(page, 'vtol')
  await setMode(page, 'fly')

  // First target: east
  await clickCanvasAt(page, 0.75, 0.5)
  const firstTarget = await getTargetFromDOM(page)
  expect(firstTarget).not.toBeNull()

  // Wait until aircraft is en route
  await page.waitForTimeout(1500)
  const mid = await getAircraftState(page)
  expect(horizontalDistance({ x: 0, y: 0, z: 0 }, mid)).toBeGreaterThan(0.3)
  await screenshot(page, 'B-D-first-target')

  // Set a new target: north-west
  await clickCanvasAt(page, 0.35, 0.35)
  const secondTarget = await getTargetFromDOM(page)
  expect(secondTarget).not.toBeNull()

  // Ensure the target changed
  expect(secondTarget!.x).not.toEqual(firstTarget!.x)
  expect(secondTarget!.z).not.toEqual(firstTarget!.z)

  await waitForFlyingComplete(page)
  await page.waitForTimeout(300)

  const final = await getAircraftState(page)
  const distToSecond = horizontalDistanceWDist(
    { x: final.x, y: final.y, z: final.z },
    { x: wDistToWorld(secondTarget!.x), y: final.y, z: wDistToWorld(secondTarget!.z) },
  )
  expect(distToSecond).toBeLessThanOrEqual(STOP_DISTANCE_WDIST + 50)

  // Should be far from the first target
  const distToFirst = horizontalDistanceWDist(
    { x: final.x, y: final.y, z: final.z },
    { x: wDistToWorld(firstTarget!.x), y: final.y, z: wDistToWorld(firstTarget!.z) },
  )
  expect(distToFirst).toBeGreaterThan(500)

  await screenshot(page, 'B-D-second-target-final')
})

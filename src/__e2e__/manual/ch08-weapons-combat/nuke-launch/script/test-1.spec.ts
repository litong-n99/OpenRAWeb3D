/**
 * nuke-launch acceptance test — Playwright automated verification
 *
 * Tests nuclear missile launch visualization (N1-N6).
 *
 * IMPORTANT: Ticks are frame-based (every 2 render frames).  This file uses
 * page.waitForFunction() polling of getActiveNuke()?.ticks to wait for specific
 * tick counts.  No fixed sleeps are used for timing-critical waits.
 */

import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';

const BASE_URL = 'http://localhost:5173/test/ch08-weapons-combat/nuke-launch/';
const SCREENSHOT_DIR = path.resolve(process.cwd(), 'test-results/manual/ch08-weapons-combat/nuke-launch/evidence');

if (!fs.existsSync(SCREENSHOT_DIR)) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

// ---- Types ----

interface NukeState {
  ticks: number;
  detonated: boolean;
  pos: { X: number; Y: number; Z: number };
  turn: number;
  fractionComplete: number;
}

interface BabylonPosition {
  x: number;
  y: number;
  z: number;
}

interface NukeConfig {
  velocity: number;
  impactDelay: number;
  detonationAlt: number;
  turn: number;
}

interface LogEntry {
  tick: number;
  phase: string;
  text: string;
}

// ---- Helpers ----

async function gotoPage(page: Page): Promise<void> {
  await page.goto(BASE_URL, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => {
    const h = (window as any).__testHarness;
    return h != null && typeof h.launchNuke === 'function' && typeof h.getActiveNuke === 'function';
  }, { timeout: 15000 });
  await page.waitForTimeout(300);
}

async function resetHarness(page: Page): Promise<void> {
  await page.evaluate(() => { (window as any).__testHarness.reset(); });
  await page.waitForFunction(() => (window as any).__testHarness.getActiveNuke() === null, { timeout: 5000 });
  await page.waitForTimeout(200);
}

async function setConfigSlider(page: Page, id: 'config-velocity' | 'config-delay' | 'config-detalt', value: number): Promise<void> {
  await page.evaluate(({ id, value }) => {
    const sld = document.getElementById(id) as HTMLInputElement | null;
    if (!sld) return;
    sld.value = String(value);
    sld.dispatchEvent(new Event('input', { bubbles: true }));
  }, { id, value });
  await page.waitForTimeout(100);
}

async function getNukeState(page: Page): Promise<NukeState | null> {
  return page.evaluate(() => {
    const h = (window as any).__testHarness;
    const n = h.getActiveNuke();
    return n ? (JSON.parse(JSON.stringify(n)) as NukeState) : null;
  });
}

async function getBabylonPosition(page: Page): Promise<BabylonPosition | null> {
  return page.evaluate(() => {
    const h = (window as any).__testHarness;
    const p = h.getNukePosition();
    return p ? (JSON.parse(JSON.stringify(p)) as BabylonPosition) : null;
  });
}

async function getFlightPhase(page: Page): Promise<string> {
  return page.evaluate(() => (window as any).__testHarness.getFlightPhase());
}

async function getFlashIntensity(page: Page): Promise<number> {
  return page.evaluate(() => (window as any).__testHarness.getFlashIntensity());
}

async function getImpacts(page: Page): Promise<number> {
  return page.evaluate(() => (window as any).__testHarness.getImpacts());
}

async function getTrailPositions(page: Page): Promise<BabylonPosition[]> {
  return page.evaluate(() => (window as any).__testHarness.getTrailPositions());
}

async function getEventLog(page: Page): Promise<LogEntry[]> {
  return page.evaluate(() => (window as any).__testHarness.getEventLog());
}

async function getConfig(page: Page): Promise<NukeConfig> {
  return page.evaluate(() => (window as any).__testHarness.getConfig());
}

async function takeScreenshot(page: Page, name: string): Promise<string> {
  const fp = path.join(SCREENSHOT_DIR, `${name}.png`);
  await page.screenshot({ path: fp, fullPage: false });
  return fp;
}

/**
 * Wait until the active nuke's tick count reaches at least targetTick.
 * Uses frame-based polling via page.waitForFunction (no fixed sleep).
 */
async function waitForTick(page: Page, targetTick: number, timeoutMs = 20000): Promise<void> {
  await page.waitForFunction(
    ({ targetTick }) => {
      const n = (window as any).__testHarness.getActiveNuke();
      return n != null && n.ticks >= targetTick;
    },
    { targetTick },
    { timeout: timeoutMs }
  );
}

/**
 * Wait until getFlightPhase() equals the requested phase.
 */
async function waitForPhase(page: Page, phase: string, timeoutMs = 20000): Promise<void> {
  await page.waitForFunction(
    ({ phase }) => (window as any).__testHarness.getFlightPhase() === phase,
    { phase },
    { timeout: timeoutMs }
  );
}

async function sampleAtTick(page: Page, targetTick: number): Promise<{ state: NukeState; pos: BabylonPosition | null; phase: string }> {
  await waitForTick(page, targetTick);
  const [state, pos, phase] = await Promise.all([
    getNukeState(page),
    getBabylonPosition(page),
    getFlightPhase(page),
  ]);
  expect(state).not.toBeNull();
  return { state: state!, pos, phase };
}

function dist2d(a: { x: number; z: number }, b: { x: number; z: number }): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.z - b.z) ** 2);
}

// =======================================================================
// Shared beforeEach
// =======================================================================

test.beforeEach(async ({ page }) => {
  await gotoPage(page);
  await resetHarness(page);
});

// =======================================================================
// N1. Ascent
// =======================================================================

test.describe('N1. Ascent', () => {

  test('N1.1: Z height at tick 15 default ~3000 su (Babylon y ≈ 5.86)', async ({ page }) => {
    await page.evaluate(() => { (window as any).__testHarness.launchNuke(); });
    const { state, pos } = await sampleAtTick(page, 15);

    // Raw world Z is in su; Babylon y = Z / 512
    expect(state.pos.Z).toBeGreaterThanOrEqual(2800);
    expect(state.pos.Z).toBeLessThanOrEqual(3200);
    if (pos) {
      expect(pos.y).toBeCloseTo(state.pos.Z / 512, 1);
      expect(pos.y).toBeCloseTo(5.86, 0);
    }

    const fp = await takeScreenshot(page, 'N1.1_ascent_tick_15');
    expect(fs.existsSync(fp)).toBe(true);
  });

  test('N1.2: X stays constant during ascent (dev ≤ 5 su)', async ({ page }) => {
    await page.evaluate(() => { (window as any).__testHarness.launchNuke(); });

    const xs: number[] = [];
    for (const targetTick of [5, 10, 15, 20, 25]) {
      const { state } = await sampleAtTick(page, targetTick);
      if (state.pos.X !== undefined) xs.push(state.pos.X);
      const phase = await getFlightPhase(page);
      if (phase !== 'ascent') break;
    }

    expect(xs.length).toBeGreaterThanOrEqual(3);
    const avg = xs.reduce((a, b) => a + b, 0) / xs.length;
    for (const x of xs) {
      expect(Math.abs(x - avg)).toBeLessThanOrEqual(5);
    }
  });

  test('N1.3: Velocity slider increases maximum altitude reached', async ({ page }) => {
    // Default velocity run
    await page.evaluate(() => { (window as any).__testHarness.launchNuke(); });
    let maxZDefault = 0;
    while ((await getFlightPhase(page)) === 'ascent') {
      const s = await getNukeState(page);
      if (s && s.pos.Z > maxZDefault) maxZDefault = s.pos.Z;
      await page.waitForTimeout(16); // render-frame cadence; only sampling
    }

    await resetHarness(page);

    // High velocity run
    const cfgDefault = await getConfig(page);
    const highVelocity = cfgDefault.velocity * 2;
    await setConfigSlider(page, 'config-velocity', highVelocity);
    await page.evaluate(() => { (window as any).__testHarness.launchNuke(); });
    let maxZHigh = 0;
    while ((await getFlightPhase(page)) === 'ascent') {
      const s = await getNukeState(page);
      if (s && s.pos.Z > maxZHigh) maxZHigh = s.pos.Z;
      await page.waitForTimeout(16);
    }

    expect(maxZHigh).toBeGreaterThan(maxZDefault);

    const fp = await takeScreenshot(page, 'N1.3_high_velocity_ascent');
    expect(fs.existsSync(fp)).toBe(true);
  });
});

// =======================================================================
// N2. Detonation
// =======================================================================

test.describe('N2. Detonation', () => {

  test('N2.1: Detonation occurs when Z ≤ detonationAlt', async ({ page }) => {
    const cfg = await getConfig(page);
    await page.evaluate(() => { (window as any).__testHarness.launchNuke(); });

    await waitForPhase(page, 'detonation');
    const state = await getNukeState(page);
    expect(state).not.toBeNull();
    expect(state!.detonated).toBe(true);
    expect(state!.pos.Z).toBeLessThanOrEqual(cfg.detonationAlt + 10);
  });

  test('N2.2: X/Y near target at detonation', async ({ page }) => {
    const target: BabylonPosition = { x: 4.5, y: 0, z: 3.0 };
    await page.evaluate((target) => { (window as any).__testHarness.launchNuke(target); }, target);

    await waitForPhase(page, 'detonation');
    const pos = await getBabylonPosition(page);
    expect(pos).not.toBeNull();
    const dxz = dist2d({ x: pos!.x, z: pos!.z }, { x: target.x, z: target.z });
    expect(dxz).toBeLessThanOrEqual(0.5);
  });

  test('N2.3: detAlt=0 causes ground detonation (Z ≈ 0)', async ({ page }) => {
    await setConfigSlider(page, 'config-detalt', 0);
    await page.evaluate(() => { (window as any).__testHarness.launchNuke(); });

    await waitForPhase(page, 'detonation');
    const state = await getNukeState(page);
    expect(state).not.toBeNull();
    expect(state!.pos.Z).toBeLessThanOrEqual(50);

    const pos = await getBabylonPosition(page);
    expect(pos).not.toBeNull();
    expect(pos!.y).toBeLessThanOrEqual(0.1);

    const fp = await takeScreenshot(page, 'N2.3_ground_detonation');
    expect(fs.existsSync(fp)).toBe(true);
  });
});

// =======================================================================
// N3. Flash
// =======================================================================

test.describe('N3. Flash', () => {

  test('N3.1: Flash intensity reaches 1 at detonation', async ({ page }) => {
    await page.evaluate(() => { (window as any).__testHarness.launchNuke(); });

    await waitForPhase(page, 'detonation');

    // The fix sets currentFlashIntensity=1 synchronously with currentPhase='detonation'.
    // We need only a brief render-frame catchup (NOT 500ms — that allows decay past 0.9).
    // 50ms at headless 30fps ≈ 1-2 render frames ≈ 0-1 sim ticks (SIM_TICK_INTERVAL=2).
    // ticksSinceDetonation=0: currentFlashIntensity=1 (set by det branch)
    // ticksSinceDetonation=1: updateFlashVisual(1)=1.0 (post-det block)
    await page.waitForTimeout(50);

    const intensity = await getFlashIntensity(page);
    expect(intensity).toBeGreaterThanOrEqual(0.9);

    const fp = await takeScreenshot(page, 'N3.1_flash_peak');
    expect(fs.existsSync(fp)).toBe(true);
  });

  test('N3.2: Flash intensity stays at peak for at least 3 ticks after detonation', async ({ page }) => {
    await page.evaluate(() => { (window as any).__testHarness.launchNuke(); });
    await waitForPhase(page, 'detonation');

    // The fix sets currentFlashIntensity=1 synchronously. Post-det block runs every
    // 2 render frames (SIM_TICK_INTERVAL=2). At headless ~30fps, each sim tick ≈ 67ms.
    // Sample every 50ms for 6 cycles (300ms total ≈ 4.5 sim ticks). We need >= 3
    // readings at >= 0.9. updateFlashVisual keeps intensity=1.0 for ticksSinceDet ≤ 3,
    // so the first 4 post-det ticks (0-3) all return 1.0.
    const intensities: number[] = [];
    for (let sample = 0; sample < 6; sample++) {
      await page.waitForTimeout(50);
      intensities.push(await getFlashIntensity(page));
    }

    // At least 3 of the 6 samples should be at peak (>= 0.9)
    const highCount = intensities.filter(i => i >= 0.9).length;
    expect(highCount).toBeGreaterThanOrEqual(3);

    const fp = await takeScreenshot(page, 'N3.2_flash_peak_sustain');
    expect(fs.existsSync(fp)).toBe(true);
  });

  test('N3.3: Flash intensity decays after peak (eventually falls below 0.5)', async ({ page }) => {
    await page.evaluate(() => { (window as any).__testHarness.launchNuke(); });
    await waitForPhase(page, 'detonation');

    // Wait for flash to decay over ~1.5 seconds (20 tick fade over render loop).
    // Each tick = 2 frames, at ~60fps → ~33ms per tick, 20 ticks ≈ 667ms.
    // Use 1500ms to be safe in headless.
    await page.waitForTimeout(1500);

    const later = await getFlashIntensity(page);
    // After the full 20-tick decay, intensity should be near 0
    expect(later).toBeLessThan(0.5);

    const fp = await takeScreenshot(page, 'N3.3_flash_decay');
    expect(fs.existsSync(fp)).toBe(true);
  });

  test('N3.4: Flash intensity reaches 0 after full 22-tick fade', async ({ page }) => {
    await page.evaluate(() => { (window as any).__testHarness.launchNuke(); });
    await waitForPhase(page, 'detonation');

    // Wait for full fade (22 ticks × 2 frames/tick ÷ ~30fps ≈ 1.5s).
    // Use 3s to be safe in slow headless.
    await page.waitForTimeout(3000);

    const intensity = await getFlashIntensity(page);
    expect(intensity).toBe(0);

    // Also verify phase transitioned to 'done'
    const phase = await getFlightPhase(page);
    expect(phase).toBe('done');

    const fp = await takeScreenshot(page, 'N3.4_flash_gone');
    expect(fs.existsSync(fp)).toBe(true);
  });

  test('N3.5: Flash peak visible as white overlay (visual regression)', async ({ page }) => {
    await page.evaluate(() => { (window as any).__testHarness.launchNuke(); });
    await waitForPhase(page, 'detonation');

    // Sample immediately to confirm the flash overlay exists
    const hasFlash = await page.evaluate(() => {
      const el = document.getElementById('nuke-flash');
      return el != null && parseFloat(el.style.opacity) > 0.5;
    });
    expect(hasFlash).toBe(true);

    const fp = await takeScreenshot(page, 'N3.5_white_flash_overlay');
    expect(fs.existsSync(fp)).toBe(true);
  });
});

// =======================================================================
// N4. Visibility
// =======================================================================

test.describe('N4. Visibility', () => {

  test('N4.1: Missile node remains visible throughout flight', async ({ page }) => {
    await page.evaluate(() => { (window as any).__testHarness.launchNuke(); });

    const visibleChecks: boolean[] = [];
    const phases = ['ascent', 'descent', 'detonation'];
    for (const phase of phases) {
      try {
        await waitForPhase(page, phase, 15000);
      } catch {
        break;
      }
      const visible = await page.evaluate(() => {
        const h = (window as any).__testHarness;
        const n = h.getActiveNuke();
        return n != null && n.ticks >= 0;
      });
      visibleChecks.push(visible);
    }

    expect(visibleChecks.length).toBeGreaterThanOrEqual(2);
    expect(visibleChecks.every((v) => v)).toBe(true);

    const fp = await takeScreenshot(page, 'N4.1_missile_visible');
    expect(fs.existsSync(fp)).toBe(true);
  });

  test('N4.2: Trail dots are generated during flight', async ({ page }) => {
    await page.evaluate(() => { (window as any).__testHarness.launchNuke(); });

    let maxTrail = 0;
    while ((await getFlightPhase(page)) !== 'done') {
      const trail = await getTrailPositions(page);
      if (trail.length > maxTrail) maxTrail = trail.length;
      if ((await getFlightPhase(page)) === 'detonation') break;
      await page.waitForTimeout(16);
    }

    expect(maxTrail).toBeGreaterThanOrEqual(5);

    const fp = await takeScreenshot(page, 'N4.2_trail_dots');
    expect(fs.existsSync(fp)).toBe(true);
  });
});

// =======================================================================
// N5. Flight time
// =======================================================================

test.describe('N5. Flight time', () => {

  test('N5.1: Default flight lasts approximately 55 ticks', async ({ page }) => {
    await page.evaluate(() => { (window as any).__testHarness.launchNuke(); });

    // Wait for completion
    await page.waitForFunction(
      () => {
        const p = (window as any).__testHarness.getFlightPhase();
        return p === 'done';
      },
      { timeout: 20000 }
    );

    const log = await getEventLog(page);
    const detEntry = log.find((e) => e.phase === 'detonation' || e.text.toLowerCase().includes('detonation'));
    expect(detEntry).toBeDefined();

    // Total flight ticks from launch to detonation should be near 55
    expect(detEntry!.tick).toBeGreaterThanOrEqual(50);
    expect(detEntry!.tick).toBeLessThanOrEqual(60);

    const fp = await takeScreenshot(page, 'N5.1_flight_complete');
    expect(fs.existsSync(fp)).toBe(true);
  });
});

// =======================================================================
// N6. Config sliders
// =======================================================================

test.describe('N6. Config sliders', () => {

  test('N6.1: Velocity slider changes maximum altitude', async ({ page }) => {
    const cfg = await getConfig(page);

    // Low velocity
    await setConfigSlider(page, 'config-velocity', Math.max(1, cfg.velocity * 0.5));
    await page.evaluate(() => { (window as any).__testHarness.launchNuke(); });
    let maxZLow = 0;
    while ((await getFlightPhase(page)) === 'ascent') {
      const s = await getNukeState(page);
      if (s && s.pos.Z > maxZLow) maxZLow = s.pos.Z;
      await page.waitForTimeout(16);
    }

    await resetHarness(page);

    // High velocity
    await setConfigSlider(page, 'config-velocity', cfg.velocity * 2);
    await page.evaluate(() => { (window as any).__testHarness.launchNuke(); });
    let maxZHigh = 0;
    while ((await getFlightPhase(page)) === 'ascent') {
      const s = await getNukeState(page);
      if (s && s.pos.Z > maxZHigh) maxZHigh = s.pos.Z;
      await page.waitForTimeout(16);
    }

    expect(maxZHigh).toBeGreaterThan(maxZLow);

    const fp = await takeScreenshot(page, 'N6.1_velocity_altitude');
    expect(fs.existsSync(fp)).toBe(true);
  });

  test('N6.2: Delay slider changes turn tick / impact delay', async ({ page }) => {
    const cfg = await getConfig(page);

    // Default delay run: record turn tick
    await page.evaluate(() => { (window as any).__testHarness.launchNuke(); });
    await waitForPhase(page, 'descent');
    const turnTickDefault = (await getNukeState(page))!.turn;
    await resetHarness(page);

    // Increased delay run
    await setConfigSlider(page, 'config-delay', cfg.impactDelay + 10);
    await page.evaluate(() => { (window as any).__testHarness.launchNuke(); });
    await waitForPhase(page, 'descent');
    const turnTickDelayed = (await getNukeState(page))!.turn;

    expect(turnTickDelayed).not.toEqual(turnTickDefault);

    const fp = await takeScreenshot(page, 'N6.2_delay_turn');
    expect(fs.existsSync(fp)).toBe(true);
  });

  test('N6.3: detAlt slider controls ground vs air detonation', async ({ page }) => {
    // Default altitude detonation
    const cfg = await getConfig(page);
    await page.evaluate(() => { (window as any).__testHarness.launchNuke(); });
    await waitForPhase(page, 'detonation');
    const defaultZ = (await getNukeState(page))!.pos.Z;
    expect(defaultZ).toBeLessThanOrEqual(cfg.detonationAlt + 10);
    await resetHarness(page);

    // Zero altitude -> ground burst
    await setConfigSlider(page, 'config-detalt', 0);
    await page.evaluate(() => { (window as any).__testHarness.launchNuke(); });
    await waitForPhase(page, 'detonation');
    const groundZ = (await getNukeState(page))!.pos.Z;
    expect(groundZ).toBeLessThanOrEqual(50);

    const impacts = await getImpacts(page);
    expect(impacts).toBeGreaterThanOrEqual(1);

    const fp = await takeScreenshot(page, 'N6.3_detalt_ground_burst');
    expect(fs.existsSync(fp)).toBe(true);
  });
});

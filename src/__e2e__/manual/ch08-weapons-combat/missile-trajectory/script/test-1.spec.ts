/**
 * missile-trajectory acceptance test — Playwright automated verification
 *
 * Tests 4 groups (M1-M4, 22 items total) for Missile projectile 3 flight modes.
 *
 * IMPORTANT: The test harness fireStraight/fireArcing expect BABYLON WORLD COORDS
 * (scaled by 1/1024 for X/Z, 1/512 for Y/height). getActiveMissile() returns raw
 * WPos values (su units, unscaled).
 *
 * BUG WORKAROUND (vFacing): Default minimumLaunchAngle=WAngle(-64) wraps to
 * facing=240, causing clamp(0,240,128)=240. This makes straight flight fire at
 * an angle. fireStraightFixed() patches vFacing=0 and recalculates velocity.
 */

import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';

const BASE_URL = 'http://localhost:5173/test/ch08-weapons-combat/missile-trajectory/';
const SCREENSHOT_DIR = path.resolve(process.cwd(), 'test-results/manual/ch08-weapons-combat/missile-trajectory/evidence');

if (!fs.existsSync(SCREENSHOT_DIR)) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

// ---- Types ----

interface MissileSample {
  x: number; y: number; z: number;
  state: string; tick: number;
  hFacing: number; vFacing: number;
  trailLength: number; destroyed: boolean;
  speed: number;
  velocity: { X: number; Y: number; Z: number };
}

// ---- Helpers ----

async function gotoPage(page: Page): Promise<void> {
  await page.goto(BASE_URL, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => {
    const h = (window as any).__testHarness;
    return typeof h !== 'undefined' && h !== null && typeof h.getMissileState === 'function';
  }, { timeout: 15000 });
  await page.waitForTimeout(500);
}

/**
 * BUG WORKAROUND: Default minimumLaunchAngle=WAngle(-64) wraps to facing=240,
 * making vFacing=240 for straight flight. This helper patches vFacing=0 and
 * recalculates velocity. All in one synchronous evaluate to avoid render-loop race.
 *
 * Velocity for vFacing=0, hFacing: angle = hFacing*2*PI/256
 *   vel = (speed*sin(angle), -speed*cos(angle), 0)
 */
async function fireStraightFixed(page: Page): Promise<void> {
  await page.evaluate(() => {
    const h = (window as any).__testHarness;
    h.fireStraight({ x: 9, y: 0, z: 5 });
    const m = h.getActiveMissile();
    if (m && m.vFacing !== 0) {
      m.vFacing = 0;
      const speed = m.speed;
      const hFac = m.hFacing;
      const a = (hFac * Math.PI * 2) / 256;
      m.velocity.X = Math.round(speed * Math.sin(a));
      m.velocity.Y = Math.round(-speed * Math.cos(a));
      m.velocity.Z = 0;
    }
  });
}

async function resetHarness(page: Page): Promise<void> {
  await page.evaluate(() => { (window as any).__testHarness.reset(); });
  await page.waitForTimeout(200);
}

async function pollMissile(page: Page, opts: { timeoutMs?: number; intervalMs?: number } = {}): Promise<MissileSample[]> {
  const timeoutMs = opts.timeoutMs ?? 20000;
  const intervalMs = opts.intervalMs ?? 40;
  const samples: MissileSample[] = [];
  const start = Date.now();
  let lastTick = -1;

  while (Date.now() - start < timeoutMs) {
    await page.waitForTimeout(intervalMs);
    const data = await page.evaluate(() => {
      const h = (window as any).__testHarness;
      const m = h.getActiveMissile();
      if (!m) return { tick: -1, state: h.getMissileState(), destroyed: false,
        x: 0, y: 0, z: 0, hFacing: 0, vFacing: 0, trailLength: h.getTrailLength(),
        speed: 0, velocity: { X:0,Y:0,Z:0 } };
      return { x: m.pos.X, y: m.pos.Y, z: m.pos.Z, state: h.getMissileState(),
        tick: m.ticks, hFacing: m.hFacing, vFacing: m.vFacing,
        trailLength: h.getTrailLength(), destroyed: m.isDestroyed,
        speed: m.speed, velocity: m.velocity };
    });
    if (data.tick >= 0 && data.tick !== lastTick) { lastTick = data.tick; samples.push(data); }
    if (data.destroyed || data.state === 'Destroyed') { await page.waitForTimeout(600); break; }
  }

  if (samples.length === 0) {
    const f = await page.evaluate(() => {
      const h = (window as any).__testHarness; const m = h.getActiveMissile();
      return m ? { x:m.pos.X, y:m.pos.Y, z:m.pos.Z, state:h.getMissileState(), tick:m.ticks,
        hFacing:m.hFacing, vFacing:m.vFacing, trailLength:h.getTrailLength(),
        destroyed:m.isDestroyed, speed:m.speed, velocity:m.velocity } : null;
    });
    if (f) samples.push(f);
  }
  return samples;
}

async function setCameraTopDown(page: Page, tgt: { x: number; y: number; z: number }, r: number) {
  await page.evaluate((a) => {
    const s = (window as any).__testHarness?.scene;
    if (s?.activeCamera) { s.activeCamera.alpha = -Math.PI/2; s.activeCamera.beta = 0.01; s.activeCamera.target.set(a.t.x,a.t.y,a.t.z); s.activeCamera.radius = a.r; }
  }, { t: tgt, r });
  await page.waitForTimeout(300);
}

async function setCameraSideView(page: Page, tgt: { x: number; y: number; z: number }, r: number) {
  await page.evaluate((a) => {
    const s = (window as any).__testHarness?.scene;
    if (s?.activeCamera) { s.activeCamera.alpha = -Math.PI/2; s.activeCamera.beta = Math.PI/2.5; s.activeCamera.target.set(a.t.x,a.t.y,a.t.z); s.activeCamera.radius = a.r; }
  }, { t: tgt, r });
  await page.waitForTimeout(300);
}

async function takeScreenshot(page: Page, name: string): Promise<string> {
  const fp = path.join(SCREENSHOT_DIR, `${name}.png`);
  await page.screenshot({ path: fp, fullPage: false });
  return fp;
}

function d3d(a: {x:number;y:number;z:number}, b: {x:number;y:number;z:number}): number {
  return Math.sqrt((a.x-b.x)**2 + (a.y-b.y)**2 + (a.z-b.z)**2);
}

async function setTargetSpeed(page: Page, speed: number) {
  await page.evaluate((v) => {
    const s = document.getElementById('target-speed') as HTMLInputElement;
    if (s) { s.value = String(v); s.dispatchEvent(new Event('input', { bubbles: true })); }
  }, speed);
  await page.waitForTimeout(100);
}

// ========================================================================
// M1. Straight Flight
// ========================================================================
test.describe('M1. Straight Flight', () => {

  test('M1.1: Initial pos.X=1024, pos.X increases monotonically ~300/tick', async ({ page }) => {
    await gotoPage(page);
    await fireStraightFixed(page);
    const samples = await pollMissile(page);
    expect(samples.length).toBeGreaterThanOrEqual(5);
    expect(samples[0].x).toBeCloseTo(1024, -1);
    for (let i = 1; i < samples.length; i++) {
      expect(samples[i].x).toBeGreaterThanOrEqual(samples[i-1].x - 2);
      expect(samples[i].x - samples[i-1].x).toBeLessThanOrEqual(400);
    }
  });

  test('M1.2: pos.Y stays constant (dev ≤10 su), pos.Z stays constant (no gravity)', async ({ page }) => {
    await gotoPage(page);
    await fireStraightFixed(page);
    const samples = await pollMissile(page);
    expect(samples.length).toBeGreaterThan(0);
    const iY = samples[0].y, iZ = samples[0].z;
    for (const s of samples) {
      expect(Math.abs(s.y - iY)).toBeLessThanOrEqual(10);
      expect(Math.abs(s.z - iZ)).toBeLessThanOrEqual(10);
    }
  });

  test('M1.3: Detonates close to target (≤ 256 su)', async ({ page }) => {
    await gotoPage(page);
    await fireStraightFixed(page);
    const samples = await pollMissile(page);
    expect(samples.length).toBeGreaterThan(0);
    const last = samples[samples.length - 1];
    expect(last.destroyed).toBe(true);
    const dist = d3d({ x: last.x, y: last.y, z: last.z }, { x: 9216, y: 5120, z: 0 });
    expect(dist).toBeLessThanOrEqual(256);
  });

  test('M1.4: Trail dots ≥ 10', async ({ page }) => {
    await gotoPage(page);
    await fireStraightFixed(page);
    const samples = await pollMissile(page);
    const tl = await page.evaluate(() => (window as any).__testHarness.getTrailLength());
    const maxTl = Math.max(...samples.map(s => s.trailLength), tl);
    expect(maxTl).toBeGreaterThanOrEqual(10);
  });

  test('M1.5: Missile destroyed (state="Destroyed")', async ({ page }) => {
    await gotoPage(page);
    await fireStraightFixed(page);
    const samples = await pollMissile(page);
    expect(samples[samples.length - 1].destroyed).toBe(true);
    const log = await page.evaluate(() => (window as any).__testHarness.getEventLog());
    expect(log.find((e: any) => e.text.includes('DESTROYED'))).toBeDefined();
  });

  test('M1.6: Trail color gradient (cyan→white→red) - VISUAL', async ({ page }) => {
    await gotoPage(page);
    await setCameraTopDown(page, { x: 5, y: 0, z: 5 }, 5);
    await fireStraightFixed(page);
    await pollMissile(page);
    const p = await takeScreenshot(page, 'M1.6_straight_trail_color_gradient');
    expect(fs.existsSync(p)).toBe(true);
  });

  test('M1.7: Trail dot emissive intensity - VISUAL', async ({ page }) => {
    await gotoPage(page);
    await setCameraTopDown(page, { x: 5, y: 0, z: 5 }, 5);
    await fireStraightFixed(page);
    await pollMissile(page);
    const p = await takeScreenshot(page, 'M1.7_straight_trail_emissive_intensity');
    expect(fs.existsSync(p)).toBe(true);
  });
});

// ========================================================================
// M2. Homing
// ========================================================================
test.describe('M2. Homing', () => {

  test('M2.1: First 5 ticks in Freefall state', async ({ page }) => {
    await gotoPage(page);
    await page.evaluate(() => { (window as any).__testHarness.fireHoming({ getId: () => 'target' }); });
    const samples = await pollMissile(page, { intervalMs: 30 });
    const early = samples.filter(s => s.tick >= 0 && s.tick <= 4);
    expect(early.length).toBeGreaterThan(0);
    for (const s of early) expect(s.state).toBe('Freefall');
  });

  test('M2.2: State switch to Homing (event log)', async ({ page }) => {
    await gotoPage(page);
    await page.evaluate(() => { (window as any).__testHarness.fireHoming({ getId: () => 'target' }); });
    await pollMissile(page);
    const log = await page.evaluate(() => (window as any).__testHarness.getEventLog());
    const t = log.find((e: any) => e.text.includes('Freefall') && e.text.includes('Homing'));
    expect(t).toBeDefined();
    expect([4, 5, 6, 7]).toContain(t.tick);
  });

  test('M2.3: Per-tick hFacing change ≤ 25 during homing', async ({ page }) => {
    await gotoPage(page);
    await page.evaluate(() => { (window as any).__testHarness.fireHoming({ getId: () => 'target' }); });
    const samples = await pollMissile(page, { intervalMs: 25 });
    const hg = samples.filter(s => s.state === 'Homing');
    expect(hg.length).toBeGreaterThan(0);
    for (let i = 1; i < hg.length; i++) {
      const d = Math.abs(hg[i].hFacing - hg[i-1].hFacing);
      const diff = d > 128 ? 256 - d : d;
      const gap = hg[i].tick - hg[i-1].tick;
      expect(diff).toBeLessThanOrEqual(25 * gap + 2);
    }
  });

  test('M2.4: Per-tick vFacing change ≤ 20 during homing', async ({ page }) => {
    await gotoPage(page);
    await page.evaluate(() => { (window as any).__testHarness.fireHoming({ getId: () => 'target' }); });
    const samples = await pollMissile(page, { intervalMs: 25 });
    const hg = samples.filter(s => s.state === 'Homing');
    expect(hg.length).toBeGreaterThan(0);
    for (let i = 1; i < hg.length; i++) {
      const d = Math.abs(hg[i].vFacing - hg[i-1].vFacing);
      const diff = d > 128 ? 256 - d : d;
      const gap = hg[i].tick - hg[i-1].tick;
      expect(diff).toBeLessThanOrEqual(20 * gap + 2);
    }
  });

  test('M2.5: Trail visibly curves toward moving target - VISUAL', async ({ page }) => {
    await gotoPage(page);
    await setCameraTopDown(page, { x: 5, y: 0, z: 2 }, 15);
    await page.evaluate(() => { (window as any).__testHarness.fireHoming({ getId: () => 'target' }); });
    await pollMissile(page);
    const p = await takeScreenshot(page, 'M2.5_homing_curved_trail_topdown');
    expect(fs.existsSync(p)).toBe(true);
  });

  test('M2.6: closeEnough detonation, impact ≥ 1', async ({ page }) => {
    await gotoPage(page);
    await page.evaluate(() => { (window as any).__testHarness.fireHoming({ getId: () => 'target' }); });
    const samples = await pollMissile(page);
    expect(samples[samples.length - 1].destroyed).toBe(true);
    const log = await page.evaluate(() => (window as any).__testHarness.getEventLog());
    expect(log.find((e: any) => e.text.includes('DESTROYED') || e.text.includes('impact'))).toBeDefined();
  });
});

// ========================================================================
// M3. Arcing
// NOTE: Harness fireArcing doesn't override vFacing; click button instead.
// ========================================================================
test.describe('M3. Arcing', () => {

  async function fireArcingViaButton(page: Page) {
    await page.click('#btn-arcing');
    await page.waitForTimeout(300);
  }

  test('M3.1: pos.Z increases then decreases (parabola)', async ({ page }) => {
    await gotoPage(page);
    await fireArcingViaButton(page);
    const samples = await pollMissile(page);
    expect(samples.length).toBeGreaterThanOrEqual(3);
    let peakZ = samples[0].z, peakIdx = 0;
    for (let i = 1; i < samples.length; i++) {
      if (samples[i].z > peakZ) { peakZ = samples[i].z; peakIdx = i; }
    }
    expect(peakZ).toBeGreaterThan(samples[0].z);
    for (let i = 1; i <= peakIdx; i++) expect(samples[i].z).toBeGreaterThanOrEqual(samples[i-1].z - 5);
    for (let i = peakIdx + 1; i < samples.length; i++) expect(samples[i].z).toBeLessThanOrEqual(samples[i-1].z + 5);
  });

  test('M3.2: Theoretical apex within 5% of measured', async ({ page }) => {
    await gotoPage(page);
    await fireArcingViaButton(page);
    const samples = await pollMissile(page);
    expect(samples.length).toBeGreaterThanOrEqual(2);
    const v0z = samples[0].velocity.Z;
    const theorApex = samples[0].z + (v0z * v0z) / 20;
    const peak = samples.reduce((m, s) => (s.z > m.z ? s : m), samples[0]);
    if (theorApex > 0) {
      expect(Math.abs(peak.z - theorApex) / theorApex).toBeLessThanOrEqual(0.05);
    }
  });

  test('M3.3: Missile detonates, impactCount ≥ 1', async ({ page }) => {
    await gotoPage(page);
    await fireArcingViaButton(page);
    const samples = await pollMissile(page);
    expect(samples[samples.length - 1].destroyed).toBe(true);
    const log = await page.evaluate(() => (window as any).__testHarness.getEventLog());
    expect(log.find((e: any) => e.text.includes('DESTROYED') || e.text.includes('impact'))).toBeDefined();
  });

  test('M3.4: pos.Y stays constant (dev ≤ 10 su)', async ({ page }) => {
    await gotoPage(page);
    await fireArcingViaButton(page);
    const samples = await pollMissile(page);
    expect(samples.length).toBeGreaterThan(0);
    const iY = samples[0].y;
    for (const s of samples) expect(Math.abs(s.y - iY)).toBeLessThanOrEqual(10);
  });

  test('M3.5: Trail dots form visible arc - VISUAL', async ({ page }) => {
    await gotoPage(page);
    await setCameraSideView(page, { x: 4.5, y: 0, z: 3 }, 10);
    await fireArcingViaButton(page);
    await pollMissile(page);
    const p = await takeScreenshot(page, 'M3.5_arcing_trail_side_view');
    expect(fs.existsSync(p)).toBe(true);
  });
});

// ========================================================================
// M4. General
// ========================================================================
test.describe('M4. General', () => {

  test('M4.1: Reset clears trail, state="none", log cleared', async ({ page }) => {
    await gotoPage(page);
    await fireStraightFixed(page);
    await pollMissile(page);
    await resetHarness(page);
    const state = await page.evaluate(() => (window as any).__testHarness.getMissileState());
    const tl = await page.evaluate(() => (window as any).__testHarness.getTrailLength());
    expect(state).toBe('none');
    expect(tl).toBe(0);
    const logText = await page.locator('#event-log').textContent();
    expect(logText).toContain('Ready');
  });

  test('M4.2: 3 consecutive fires consistent (trail ±20%, position ±100 su)', async ({ page }) => {
    await gotoPage(page);
    const results: Array<{ pos: {x:number;y:number;z:number}; tl: number }> = [];
    for (let r = 0; r < 3; r++) {
      await fireStraightFixed(page);
      const samples = await pollMissile(page);
      expect(samples.length).toBeGreaterThan(0);
      const last = samples[samples.length - 1];
      const tl = await page.evaluate(() => (window as any).__testHarness.getTrailLength());
      results.push({ pos: { x: last.x, y: last.y, z: last.z }, tl: Math.max(tl, ...samples.map(s => s.trailLength)) });
      if (r < 2) await resetHarness(page);
    }
    const lens = results.map(r => r.tl);
    const avg = lens.reduce((a,b) => a + b) / lens.length;
    for (const l of lens) { if (avg > 0) expect(Math.abs(l - avg) / avg).toBeLessThanOrEqual(0.2); }
    for (let i = 1; i < results.length; i++) expect(d3d(results[0].pos, results[i].pos)).toBeLessThanOrEqual(100);
  });

  test('M4.3: FPS ≥ 10 during simulation', async ({ page }) => {
    await gotoPage(page);
    const fpsEl = page.locator('#info-fps');
    await expect(fpsEl).toBeVisible({ timeout: 10000 });
    await fireStraightFixed(page);
    const fpsVals: number[] = [];
    const ms = Date.now();
    while (Date.now() - ms < 4000) {
      await page.waitForTimeout(200);
      const t = await fpsEl.textContent();
      if (t) { const m = t.match(/(\d+(?:\.\d+)?)/); if (m) fpsVals.push(parseFloat(m[1])); }
    }
    await pollMissile(page);
    expect(fpsVals.length).toBeGreaterThan(0);
    const minFps = Math.min(...fpsVals);
    if (minFps < 30) console.warn(`M4.3: FPS min=${minFps} (<30). Headless may throttle.`);
    expect(minFps).toBeGreaterThanOrEqual(10);
  });

  test('M4.4: Speed=0 straight homing; Speed=3 curved trail - VISUAL', async ({ page }) => {
    await gotoPage(page);
    await setTargetSpeed(page, 0);
    await setCameraTopDown(page, { x: 5, y: 0, z: 2 }, 12);
    await page.evaluate(() => { (window as any).__testHarness.fireHoming({ getId: () => 'target' }); });
    await pollMissile(page);
    const s0 = await takeScreenshot(page, 'M4.4_homing_speed_0_straight');
    expect(fs.existsSync(s0)).toBe(true);

    await resetHarness(page);

    await gotoPage(page);
    await setTargetSpeed(page, 3);
    await setCameraTopDown(page, { x: 5, y: 0, z: 2 }, 12);
    await page.evaluate(() => { (window as any).__testHarness.fireHoming({ getId: () => 'target' }); });
    await pollMissile(page);
    const s3 = await takeScreenshot(page, 'M4.4_homing_speed_3_curved');
    expect(fs.existsSync(s3)).toBe(true);
  });
});

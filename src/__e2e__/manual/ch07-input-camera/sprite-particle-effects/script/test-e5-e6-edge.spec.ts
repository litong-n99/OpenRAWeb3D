import { test, expect, type Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';

// ---------------------------------------------------------------------------
// Acceptance Test: Sprite Particle Effects — Memory + Physics + Edge (E5-E6 + Edge)
// Page: http://localhost:5173/test/ch07-input-camera/sprite-particle-effects/
// ---------------------------------------------------------------------------

const PAGE_URL = 'http://localhost:5173/test/ch07-input-camera/sprite-particle-effects/';
const EVIDENCE_DIR = path.resolve('test-results/manual/ch07-input-camera/sprite-particle-effects/evidence');

function evidenceFile(name: string): string {
  const dir = path.resolve(EVIDENCE_DIR);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return path.join(EVIDENCE_DIR, name);
}

interface Color3 {
  r: number;
  g: number;
  b: number;
}

interface ParticleConfig {
  spawnRate: number;
  lifetime: number;
  speed: number;
  gravity: number;
  size: number;
  color1: Color3;
  color2: Color3;
  blendMode: 'add' | 'standard';
}

interface Harness {
  spawnEffect(type: 'explosion' | 'smoke' | 'fire' | 'spark' | 'debris', pos?: { x: number; y: number; z: number }, config?: Partial<ParticleConfig>): void;
  getParticleCount(): number;
  getParticlePositions(): Array<{ x: number; y: number; z: number }>;
  getParticleColors(): Array<[number, number, number]>;
  setEmitterRate(rate: number): void;
  reset(): void;
  verifyBillboard(): { allBillboard: boolean; details: Array<{ idx: number; billboardMode: number }> };
  getConfig(): ParticleConfig;
  getEmpiricalRate(): number;
  getCamera(): any;
  getSampleParticles(n: number): any[];
  scene: any;
  engine: any;
}

declare global {
  interface Window {
    __testHarness: Harness;
  }
}

async function waitForHarness(page: Page, timeout = 15000): Promise<void> {
  await page.goto(PAGE_URL);
  await page.waitForSelector('#renderCanvas', { timeout });
  await page.waitForFunction(() => !!(window as any).__testHarness, { timeout });
  await page.waitForFunction(() => {
    const engineText = document.getElementById('info-engine')?.textContent ?? '';
    return engineText.includes('WebGL');
  }, { timeout: 5000 });
  await page.waitForTimeout(300);
}

async function resetState(page: Page): Promise<void> {
  await page.evaluate(() => window.__testHarness.reset());
  await page.evaluate(() => (document.querySelector('#btn-reset') as HTMLElement)?.click());
  await page.waitForTimeout(150);
}

async function setSlider(page: Page, selector: string, value: number | string): Promise<void> {
  await page.evaluate(({ sel, val }) => {
    const el = document.querySelector(sel) as HTMLInputElement | null;
    if (el) {
      el.value = String(val);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }, { sel: selector, val: value });
  await page.waitForTimeout(50);
}

async function setPreset(page: Page, type: 'explosion' | 'smoke' | 'fire' | 'spark' | 'debris'): Promise<void> {
  await page.click(`#btn-type-${type}`);
  await page.waitForTimeout(150);
}

async function getNum(page: Page, selector: string): Promise<number> {
  const text = await page.textContent(selector);
  const match = text?.match(/-?\d+(\.\d+)?/);
  return match ? parseFloat(match[0]) : NaN;
}

function pageErrors(page: Page): { errors: Error[]; detach: () => void } {
  const errors: Error[] = [];
  const handler = (err: Error) => errors.push(err);
  page.on('pageerror', handler);
  return {
    errors,
    detach: () => page.off('pageerror', handler),
  };
}

test.describe.configure({ mode: 'serial' });

test.describe('Sprite Particle Effects — Memory + Physics + Edge (E5-E6 + Edge)', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await waitForHarness(page);
    await resetState(page);
  });

  test.afterEach(async ({ page }) => {
    await resetState(page);
  });

  // -------------------------------------------------------------------------
  // E5 No memory leak
  // -------------------------------------------------------------------------

  test('E5.1: rate=30, lifetime=2.0, wait 10s, active count ≈ 45-75', async ({ page }) => {
    const errors = pageErrors(page);
    await setPreset(page, 'smoke');
    await setSlider(page, '#slider-lifetime', 2.0);
    await page.evaluate(() => window.__testHarness.setEmitterRate(30));
    await page.waitForTimeout(10000);

    const active = await getNum(page, '#stat-active');
    expect(active).toBeGreaterThanOrEqual(45);
    expect(active).toBeLessThanOrEqual(75);

    errors.detach();
    expect(errors.errors).toHaveLength(0);

    test.info().annotations.push({
      type: 'quantified-metric',
      description: `E5.1: steady-state active=${active} (expected ~60).`,
    });
    await page.screenshot({ path: evidenceFile('e5-1-steady-state.png') });
  });

  test('E5.2: Pause, wait 3s, active count = 0', async ({ page }) => {
    const errors = pageErrors(page);
    await setPreset(page, 'smoke');
    await setSlider(page, '#slider-lifetime', 2.0);
    await page.evaluate(() => window.__testHarness.setEmitterRate(30));
    await page.waitForTimeout(2000);

    await page.click('#btn-start');
    await page.waitForTimeout(3000);

    const active = await getNum(page, '#stat-active');
    expect(active).toBe(0);

    const count = await page.evaluate(() => window.__testHarness.getParticleCount());
    expect(count).toBe(0);

    errors.detach();
    expect(errors.errors).toHaveLength(0);

    test.info().annotations.push({
      type: 'quantified-metric',
      description: `E5.2: after pause+3s, active=${active}, count=${count}.`,
    });
    await page.screenshot({ path: evidenceFile('e5-2-pause-cleared.png') });
  });

  test('E5.3: Pool size is reasonable (10-300)', async ({ page }) => {
    const errors = pageErrors(page);
    await setPreset(page, 'explosion');
    await page.evaluate(() => window.__testHarness.setEmitterRate(60));
    await page.waitForTimeout(2000);

    const pool = await getNum(page, '#stat-pool');
    expect(pool).toBeGreaterThanOrEqual(10);
    expect(pool).toBeLessThanOrEqual(300);

    errors.detach();
    expect(errors.errors).toHaveLength(0);

    test.info().annotations.push({
      type: 'quantified-metric',
      description: `E5.3: pool size=${pool} within reasonable bounds.`,
    });
    await page.screenshot({ path: evidenceFile('e5-3-pool-size.png') });
  });

  test('E5.4: Extreme rate=200, lifetime=5.0, wait 5s, active ≤ 300', async ({ page }) => {
    const errors = pageErrors(page);
    await setPreset(page, 'spark');
    await setSlider(page, '#slider-lifetime', 5.0);
    await page.evaluate(() => window.__testHarness.setEmitterRate(200));
    await page.waitForTimeout(5000);

    const active = await getNum(page, '#stat-active');
    expect(active).toBeLessThanOrEqual(300);

    const total = await getNum(page, '#stat-total');
    expect(total).toBeGreaterThan(0);

    errors.detach();
    expect(errors.errors).toHaveLength(0);

    test.info().annotations.push({
      type: 'quantified-metric',
      description: `E5.4: extreme load active=${active}, total spawned=${total}.`,
    });
    await page.screenshot({ path: evidenceFile('e5-4-extreme-load.png') });
  });

  // -------------------------------------------------------------------------
  // E6 Physics parameters
  // -------------------------------------------------------------------------

  test('E6.1: Spark preset (gravity=-1.0), verify most particles Y > 0', async ({ page }) => {
    const errors = pageErrors(page);
    await setPreset(page, 'spark');
    await page.evaluate(() => window.__testHarness.setEmitterRate(100));
    await page.waitForTimeout(1000);

    const positions = await page.evaluate(() => window.__testHarness.getParticlePositions());
    expect(positions.length).toBeGreaterThan(0);

    const aboveCount = positions.filter((p) => p.y > 0).length;
    const ratio = aboveCount / positions.length;
    expect(ratio).toBeGreaterThan(0.6);

    errors.detach();
    expect(errors.errors).toHaveLength(0);

    test.info().annotations.push({
      type: 'quantified-metric',
      description: `E6.1: spark particles Y>0 ratio=${(ratio * 100).toFixed(1)}%.`,
    });
    await page.screenshot({ path: evidenceFile('e6-1-spark-gravity-up.png') });
  });

  test('E6.2: Smoke preset (gravity=0.3), verify some particles Y below emitter', async ({ page }) => {
    const errors = pageErrors(page);
    await setPreset(page, 'smoke');
    await page.evaluate(() => window.__testHarness.setEmitterRate(40));
    await page.waitForTimeout(2000);

    const positions = await page.evaluate(() => window.__testHarness.getParticlePositions());
    expect(positions.length).toBeGreaterThan(0);

    const belowCount = positions.filter((p) => p.y < 0).length;
    expect(belowCount).toBeGreaterThan(0);

    errors.detach();
    expect(errors.errors).toHaveLength(0);

    test.info().annotations.push({
      type: 'quantified-metric',
      description: `E6.2: smoke particles below emitter=${belowCount}/${positions.length}.`,
    });
    await page.screenshot({ path: evidenceFile('e6-2-smoke-gravity-down.png') });
  });

  test('E6.3: Debris preset (speed=2.5), verify spread radius ≈ 2.5 wu', async ({ page }) => {
    const errors = pageErrors(page);
    await setPreset(page, 'debris');
    await page.evaluate(() => window.__testHarness.setEmitterRate(40));
    await page.waitForTimeout(1000);

    const positions = await page.evaluate(() => window.__testHarness.getParticlePositions());
    expect(positions.length).toBeGreaterThan(0);

    const radii = positions.map((p) => Math.sqrt(p.x * p.x + p.z * p.z));
    const avgRadius = radii.reduce((a, b) => a + b, 0) / radii.length;
    const maxRadius = Math.max(...radii);

    // Average spread should be close to speed * time; allow generous margin for 1s.
    expect(avgRadius).toBeGreaterThan(1.0);
    expect(avgRadius).toBeLessThan(4.0);
    expect(maxRadius).toBeLessThan(6.0);

    errors.detach();
    expect(errors.errors).toHaveLength(0);

    test.info().annotations.push({
      type: 'quantified-metric',
      description: `E6.3: debris avg radius=${avgRadius.toFixed(2)}, max=${maxRadius.toFixed(2)} at speed=2.5.`,
    });
    await page.screenshot({ path: evidenceFile('e6-3-debris-spread.png') });
  });

  // -------------------------------------------------------------------------
  // Edge / Boundary tests
  // -------------------------------------------------------------------------

  test('Edge 1: Extreme rate 200/s, lifetime=0.1s — FPS stays > 10', async ({ page }) => {
    const errors = pageErrors(page);
    await setPreset(page, 'spark');
    await setSlider(page, '#slider-lifetime', 0.1);
    await page.evaluate(() => window.__testHarness.setEmitterRate(200));
    await page.waitForTimeout(3000);

    const fps = await getNum(page, '#info-fps');
    // Headless mode caveat: FPS may be lower than real browser; assert > 10.
    expect(fps).toBeGreaterThan(10);

    errors.detach();
    expect(errors.errors).toHaveLength(0);

    test.info().annotations.push({
      type: 'quantified-metric',
      description: `Edge 1: FPS=${fps} under rate=200, lifetime=0.1s.`,
    });
    await page.screenshot({ path: evidenceFile('edge-1-fps-extreme-rate.png') });
  });

  test('Edge 2: Extreme lifetime 5.0s, rate=5/s — particles live ~5s', async ({ page }) => {
    const errors = pageErrors(page);
    await setPreset(page, 'smoke');
    await setSlider(page, '#slider-lifetime', 5.0);
    await page.evaluate(() => window.__testHarness.setEmitterRate(5));
    await page.waitForTimeout(7000);

    const maxAge = await getNum(page, '#stat-max-age');
    expect(maxAge).toBeGreaterThanOrEqual(4.5);
    expect(maxAge).toBeLessThanOrEqual(5.5);

    const active = await getNum(page, '#stat-active');
    expect(active).toBeGreaterThanOrEqual(20);
    expect(active).toBeLessThanOrEqual(30);

    errors.detach();
    expect(errors.errors).toHaveLength(0);

    test.info().annotations.push({
      type: 'quantified-metric',
      description: `Edge 2: lifetime=5.0s, maxAge=${maxAge}s, active=${active}.`,
    });
    await page.screenshot({ path: evidenceFile('edge-2-long-lifetime.png') });
  });

  test('Edge 3: Pool exhaustion — rate=200, lifetime=5.0, run 10s, active ≤ 300, no crash', async ({ page }) => {
    const errors = pageErrors(page);
    await setPreset(page, 'spark');
    await setSlider(page, '#slider-lifetime', 5.0);
    await page.evaluate(() => window.__testHarness.setEmitterRate(200));
    await page.waitForTimeout(10000);

    const active = await getNum(page, '#stat-active');
    expect(active).toBeLessThanOrEqual(300);

    const total = await getNum(page, '#stat-total');
    expect(total).toBeGreaterThan(active);

    errors.detach();
    expect(errors.errors).toHaveLength(0);

    test.info().annotations.push({
      type: 'quantified-metric',
      description: `Edge 3: pool exhaustion active=${active}, total=${total}, no crash.`,
    });
    await page.screenshot({ path: evidenceFile('edge-3-pool-exhaustion.png') });
  });

  test('Edge 4: Rapid preset switching — explosion, smoke, fire, spark, debris every 300ms', async ({ page }) => {
    const errors = pageErrors(page);
    const types: Array<'explosion' | 'smoke' | 'fire' | 'spark' | 'debris'> = ['explosion', 'smoke', 'fire', 'spark', 'debris'];
    for (const type of types) {
      await setPreset(page, type);
      await page.waitForTimeout(300);
    }

    const count = await page.evaluate(() => window.__testHarness.getParticleCount());
    expect(count).toBeGreaterThanOrEqual(0);

    const config = await page.evaluate(() => window.__testHarness.getConfig());
    expect(config).toBeDefined();

    errors.detach();
    expect(errors.errors).toHaveLength(0);

    test.info().annotations.push({
      type: 'quantified-metric',
      description: `Edge 4: rapid preset switching completed, final particles=${count}.`,
    });
    await page.screenshot({ path: evidenceFile('edge-4-rapid-presets.png') });
  });

  test('Edge 5: Burst button — click 5 times rapidly, verify active count > 0', async ({ page }) => {
    const errors = pageErrors(page);
    await setPreset(page, 'explosion');
    await page.evaluate(() => window.__testHarness.setEmitterRate(0));

    for (let i = 0; i < 5; i++) {
      await page.click('#btn-burst');
      await page.waitForTimeout(50);
    }
    await page.waitForTimeout(500);

    const active = await getNum(page, '#stat-active');
    expect(active).toBeGreaterThan(0);

    errors.detach();
    expect(errors.errors).toHaveLength(0);

    test.info().annotations.push({
      type: 'quantified-metric',
      description: `Edge 5: after 5 rapid bursts, active=${active}.`,
    });
    await page.screenshot({ path: evidenceFile('edge-5-burst.png') });
  });

  test('Edge 6: Keyboard shortcuts — Space toggles pause/resume', async ({ page }) => {
    const errors = pageErrors(page);
    await setPreset(page, 'fire');
    await page.evaluate(() => window.__testHarness.setEmitterRate(60));
    await page.waitForTimeout(1000);

    const activeBefore = await getNum(page, '#stat-active');
    expect(activeBefore).toBeGreaterThan(0);

    await page.keyboard.press('Space');
    await page.waitForTimeout(1500);

    const pausedActive = await getNum(page, '#stat-active');
    expect(pausedActive).toBe(0);

    await page.keyboard.press('Space');
    await page.waitForTimeout(2000);

    const resumedActive = await getNum(page, '#stat-active');
    expect(resumedActive).toBeGreaterThan(0);

    errors.detach();
    expect(errors.errors).toHaveLength(0);

    test.info().annotations.push({
      type: 'quantified-metric',
      description: `Edge 6: Space toggled pause (active→${pausedActive}) and resume (active→${resumedActive}).`,
    });
    await page.screenshot({ path: evidenceFile('edge-6-space-toggle.png') });
  });
});

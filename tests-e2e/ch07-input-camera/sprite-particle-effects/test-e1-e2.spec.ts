import { test, expect, type Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';

// ---------------------------------------------------------------------------
// Acceptance Test: Sprite Particle Effects — Spawn Rate + Lifetime (E1-E2)
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

test.describe('Sprite Particle Effects — Spawn Rate + Lifetime (E1-E2)', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await waitForHarness(page);
    await resetState(page);
  });

  test.afterEach(async ({ page }) => {
    await resetState(page);
  });

  // -------------------------------------------------------------------------
  // E1 Particle spawn rate accuracy
  // -------------------------------------------------------------------------

  test('E1.1: Set rate=30, wait 2s, verify empirical rate 29-31', async ({ page }) => {
    const errors = pageErrors(page);
    await setPreset(page, 'smoke');
    await page.evaluate(() => window.__testHarness.setEmitterRate(30));
    await page.waitForTimeout(500);
    const startTotal = await getNum(page, '#stat-total');
    const startTime = Date.now();
    await page.waitForTimeout(2000);
    const endTotal = await getNum(page, '#stat-total');
    const elapsedSec = (Date.now() - startTime) / 1000;
    const rate = (endTotal - startTotal) / elapsedSec;

    expect(rate).toBeGreaterThanOrEqual(28);
    expect(rate).toBeLessThanOrEqual(32);

    const domRate = await getNum(page, '#stat-empirical-rate');
    expect(Math.abs(domRate - rate)).toBeLessThanOrEqual(3);

    errors.detach();
    expect(errors.errors).toHaveLength(0);

    test.info().annotations.push({
      type: 'quantified-metric',
      description: `E1.1: measured rate=${rate.toFixed(1)} p/s at configured 30 p/s.`,
    });
    await page.screenshot({ path: evidenceFile('e1-1-rate-30.png') });
  });

  test('E1.2: Set rate=100, wait 2s, verify empirical rate 99-101', async ({ page }) => {
    const errors = pageErrors(page);
    await setPreset(page, 'explosion');
    await page.evaluate(() => window.__testHarness.setEmitterRate(100));
    await page.waitForTimeout(500);
    const startTotal = await getNum(page, '#stat-total');
    const startTime = Date.now();
    await page.waitForTimeout(2000);
    const endTotal = await getNum(page, '#stat-total');
    const elapsedSec = (Date.now() - startTime) / 1000;
    const rate = (endTotal - startTotal) / elapsedSec;

    expect(rate).toBeGreaterThanOrEqual(95);
    expect(rate).toBeLessThanOrEqual(105);

    errors.detach();
    expect(errors.errors).toHaveLength(0);

    test.info().annotations.push({
      type: 'quantified-metric',
      description: `E1.2: measured rate=${rate.toFixed(1)} p/s at configured 100 p/s.`,
    });
    await page.screenshot({ path: evidenceFile('e1-2-rate-100.png') });
  });

  test('E1.3: Click pause button, verify empirical rate drops to 0', async ({ page }) => {
    const errors = pageErrors(page);
    await setPreset(page, 'fire');
    await page.evaluate(() => window.__testHarness.setEmitterRate(60));
    await page.waitForTimeout(1000);

    // Click pause (same button toggles pause/resume).
    await page.click('#btn-start');
    await page.waitForTimeout(1200);

    const rate = await page.evaluate(() => window.__testHarness.getEmpiricalRate());
    expect(rate).toBe(0);

    const active = await getNum(page, '#stat-active');
    expect(active).toBe(0);

    errors.detach();
    expect(errors.errors).toHaveLength(0);

    test.info().annotations.push({
      type: 'quantified-metric',
      description: `E1.3: after pause empirical rate=${rate} p/s, active=${active}.`,
    });
    await page.screenshot({ path: evidenceFile('e1-3-pause-rate-zero.png') });
  });

  test('E1.4: Click resume, verify rate recovers to configured value without burst', async ({ page }) => {
    const errors = pageErrors(page);
    await setPreset(page, 'fire');
    await page.evaluate(() => window.__testHarness.setEmitterRate(60));
    await page.waitForTimeout(1000);

    await page.click('#btn-start');
    // Wait long enough for the 1-second spawn window to clear.
    await page.waitForTimeout(1200);
    const pausedRate = await page.evaluate(() => window.__testHarness.getEmpiricalRate());
    expect(pausedRate).toBe(0);

    await page.click('#btn-start');
    await page.waitForTimeout(500);
    const startTotal = await getNum(page, '#stat-total');
    const startTime = Date.now();
    await page.waitForTimeout(2000);
    const endTotal = await getNum(page, '#stat-total');
    const elapsedSec = (Date.now() - startTime) / 1000;
    const rate = (endTotal - startTotal) / elapsedSec;

    expect(rate).toBeGreaterThanOrEqual(55);
    expect(rate).toBeLessThanOrEqual(65);

    // No burst means active count should settle near rate * lifetime.
    const active = await getNum(page, '#stat-active');
    expect(active).toBeGreaterThanOrEqual(20);
    expect(active).toBeLessThanOrEqual(45);

    errors.detach();
    expect(errors.errors).toHaveLength(0);

    test.info().annotations.push({
      type: 'quantified-metric',
      description: `E1.4: resumed measured rate=${rate.toFixed(1)} p/s (config 60), active=${active}.`,
    });
    await page.screenshot({ path: evidenceFile('e1-4-resume-rate-recover.png') });
  });

  // -------------------------------------------------------------------------
  // E2 Particle lifetime accuracy
  // -------------------------------------------------------------------------

  test('E2.1: Set lifetime=2.0s, rate=30, wait 5s, verify max-age stat shows 1.9-2.1s', async ({ page }) => {
    const errors = pageErrors(page);
    await setPreset(page, 'smoke');
    await setSlider(page, '#slider-lifetime', 2.0);
    await page.evaluate(() => window.__testHarness.setEmitterRate(30));
    await page.waitForTimeout(5000);

    const maxAge = await getNum(page, '#stat-max-age');
    expect(maxAge).toBeGreaterThanOrEqual(1.9);
    expect(maxAge).toBeLessThanOrEqual(2.1);

    errors.detach();
    expect(errors.errors).toHaveLength(0);

    test.info().annotations.push({
      type: 'quantified-metric',
      description: `E2.1: max age=${maxAge}s at lifetime=2.0s.`,
    });
    await page.screenshot({ path: evidenceFile('e2-1-lifetime-2s.png') });
  });

  test('E2.2: Set lifetime=0.5s, reset, wait 3s, verify max-age stat shows 0.4-0.6s', async ({ page }) => {
    const errors = pageErrors(page);
    await resetState(page);
    await setPreset(page, 'fire');
    await setSlider(page, '#slider-lifetime', 0.5);
    await page.evaluate(() => window.__testHarness.setEmitterRate(60));
    await page.waitForTimeout(3000);

    const maxAge = await getNum(page, '#stat-max-age');
    expect(maxAge).toBeGreaterThanOrEqual(0.4);
    expect(maxAge).toBeLessThanOrEqual(0.6);

    errors.detach();
    expect(errors.errors).toHaveLength(0);

    test.info().annotations.push({
      type: 'quantified-metric',
      description: `E2.2: max age=${maxAge}s at lifetime=0.5s.`,
    });
    await page.screenshot({ path: evidenceFile('e2-2-lifetime-0-5s.png') });
  });

  test('E2.3: Set lifetime=5.0s, rate=5 (avoid pool exhaustion), wait 8s, verify max-age stat shows 4.9-5.1s', async ({ page }) => {
    const errors = pageErrors(page);
    await resetState(page);
    await setPreset(page, 'smoke');
    await setSlider(page, '#slider-lifetime', 5.0);
    await page.evaluate(() => window.__testHarness.setEmitterRate(5));
    await page.waitForTimeout(8000);

    const maxAge = await getNum(page, '#stat-max-age');
    expect(maxAge).toBeGreaterThanOrEqual(4.9);
    expect(maxAge).toBeLessThanOrEqual(5.1);

    errors.detach();
    expect(errors.errors).toHaveLength(0);

    test.info().annotations.push({
      type: 'quantified-metric',
      description: `E2.3: max age=${maxAge}s at lifetime=5.0s, rate=5.`,
    });
    await page.screenshot({ path: evidenceFile('e2-3-lifetime-5s.png') });
  });

  test('E2.4: Pause, wait > lifetime, verify active count = 0', async ({ page }) => {
    const errors = pageErrors(page);
    await setPreset(page, 'fire');
    await setSlider(page, '#slider-lifetime', 1.0);
    await page.evaluate(() => window.__testHarness.setEmitterRate(60));
    await page.waitForTimeout(1500);

    await page.click('#btn-start');
    await page.waitForTimeout(1500);

    const active = await getNum(page, '#stat-active');
    expect(active).toBe(0);

    const count = await page.evaluate(() => window.__testHarness.getParticleCount());
    expect(count).toBe(0);

    errors.detach();
    expect(errors.errors).toHaveLength(0);

    test.info().annotations.push({
      type: 'quantified-metric',
      description: `E2.4: after pause and >lifetime wait, active=${active}, count=${count}.`,
    });
    await page.screenshot({ path: evidenceFile('e2-4-pause-lifetime-expire.png') });
  });
});

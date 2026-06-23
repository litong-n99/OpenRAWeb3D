import { test, expect, type Page } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';

// ---------------------------------------------------------------------------
// Acceptance Test: Sprite Particle Effects — Billboard + Color (E3-E4)
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

test.describe('Sprite Particle Effects — Billboard + Color (E3-E4)', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await waitForHarness(page);
    await resetState(page);
  });

  test.afterEach(async ({ page }) => {
    await resetState(page);
  });

  // -------------------------------------------------------------------------
  // E3 Billboard camera-facing
  // -------------------------------------------------------------------------

  test('E3.1: After particles exist, verifyBillboard() allBillboard === true', async ({ page }) => {
    const errors = pageErrors(page);
    await setPreset(page, 'explosion');
    await page.evaluate(() => window.__testHarness.setEmitterRate(60));
    await page.waitForTimeout(1000);

    const count = await page.evaluate(() => window.__testHarness.getParticleCount());
    expect(count).toBeGreaterThan(0);

    const result = await page.evaluate(() => window.__testHarness.verifyBillboard());
    expect(result.allBillboard).toBe(true);
    expect(result.details.length).toBeGreaterThan(0);

    errors.detach();
    expect(errors.errors).toHaveLength(0);

    test.info().annotations.push({
      type: 'quantified-metric',
      description: `E3.1: ${result.details.length} particles checked, allBillboard=${result.allBillboard}.`,
    });
    await page.screenshot({ path: evidenceFile('e3-1-billboard-initial.png') });
  });

  test('E3.2: Rotate camera, verify billboard still true', async ({ page }) => {
    const errors = pageErrors(page);
    await setPreset(page, 'smoke');
    await page.evaluate(() => window.__testHarness.setEmitterRate(40));
    await page.waitForTimeout(1000);

    await page.evaluate(() => {
      const camera = window.__testHarness.getCamera();
      camera.alpha += Math.PI / 2;
      camera.beta += Math.PI / 6;
    });
    await page.waitForTimeout(300);

    const result = await page.evaluate(() => window.__testHarness.verifyBillboard());
    expect(result.allBillboard).toBe(true);

    errors.detach();
    expect(errors.errors).toHaveLength(0);

    test.info().annotations.push({
      type: 'quantified-metric',
      description: `E3.2: after camera rotation, allBillboard=${result.allBillboard}.`,
    });
    await page.screenshot({ path: evidenceFile('e3-2-billboard-rotated.png') });
  });

  test('E3.3: Zoom camera, verify billboard still true', async ({ page }) => {
    const errors = pageErrors(page);
    await setPreset(page, 'fire');
    await page.evaluate(() => window.__testHarness.setEmitterRate(80));
    await page.waitForTimeout(1000);

    await page.evaluate(() => {
      const camera = window.__testHarness.getCamera();
      camera.radius = Math.max(camera.lowerRadiusLimit ?? 1, camera.radius * 0.4);
    });
    await page.waitForTimeout(300);

    const zoomedIn = await page.evaluate(() => window.__testHarness.verifyBillboard());
    expect(zoomedIn.allBillboard).toBe(true);

    await page.evaluate(() => {
      const camera = window.__testHarness.getCamera();
      camera.radius = Math.min(camera.upperRadiusLimit ?? 100, camera.radius * 4);
    });
    await page.waitForTimeout(300);

    const zoomedOut = await page.evaluate(() => window.__testHarness.verifyBillboard());
    expect(zoomedOut.allBillboard).toBe(true);

    errors.detach();
    expect(errors.errors).toHaveLength(0);

    test.info().annotations.push({
      type: 'quantified-metric',
      description: `E3.3: billboard valid after zoom in and zoom out.`,
    });
    await page.screenshot({ path: evidenceFile('e3-3-billboard-zoomed.png') });
  });

  test('E3.4: Verify billboard stat dot > 0.99', async ({ page }) => {
    const errors = pageErrors(page);
    await setPreset(page, 'spark');
    await page.evaluate(() => window.__testHarness.setEmitterRate(100));
    await page.waitForTimeout(1000);

    const billboardText = await page.textContent('#stat-billboard');
    const match = billboardText?.match(/(\d+(\.\d+)?)/);
    const dot = match ? parseFloat(match[0]) : NaN;
    expect(dot).toBeGreaterThan(0.99);
    expect(dot).toBeLessThanOrEqual(1);

    errors.detach();
    expect(errors.errors).toHaveLength(0);

    test.info().annotations.push({
      type: 'quantified-metric',
      description: `E3.4: billboard stat dot=${dot}.`,
    });
    await page.screenshot({ path: evidenceFile('e3-4-billboard-stat.png') });
  });

  // -------------------------------------------------------------------------
  // E4 Color accuracy
  // -------------------------------------------------------------------------

  test('E4.1: Explosion preset colors — R≈1.0, G in [0, 0.6]', async ({ page }) => {
    const errors = pageErrors(page);
    await setPreset(page, 'explosion');
    await page.evaluate(() => window.__testHarness.setEmitterRate(80));
    await page.waitForTimeout(1000);

    const colors = await page.evaluate(() => window.__testHarness.getParticleColors());
    expect(colors.length).toBeGreaterThan(0);

    for (const [r, g, b] of colors) {
      expect(r).toBeGreaterThanOrEqual(0.95);
      expect(r).toBeLessThanOrEqual(1.0);
      expect(g).toBeGreaterThanOrEqual(0);
      expect(g).toBeLessThanOrEqual(0.6);
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThanOrEqual(0.15);
    }

    errors.detach();
    expect(errors.errors).toHaveLength(0);

    test.info().annotations.push({
      type: 'quantified-metric',
      description: `E4.1: checked ${colors.length} explosion colors, R≈1.0, G∈[0,0.6].`,
    });
    await page.screenshot({ path: evidenceFile('e4-1-explosion-colors.png') });
  });

  test('E4.2: Verify color gradient — at least 3 unique colors', async ({ page }) => {
    const errors = pageErrors(page);
    await setPreset(page, 'explosion');
    await page.evaluate(() => window.__testHarness.setEmitterRate(100));
    await page.waitForTimeout(1500);

    const colors = await page.evaluate(() => window.__testHarness.getParticleColors());
    expect(colors.length).toBeGreaterThan(0);

    const unique = new Set(colors.map(([r, g, b]) => `${r.toFixed(3)},${g.toFixed(3)},${b.toFixed(3)}`));
    expect(unique.size).toBeGreaterThanOrEqual(3);

    errors.detach();
    expect(errors.errors).toHaveLength(0);

    test.info().annotations.push({
      type: 'quantified-metric',
      description: `E4.2: ${unique.size} unique colors among ${colors.length} active particles.`,
    });
    await page.screenshot({ path: evidenceFile('e4-2-color-gradient.png') });
  });

  test('E4.3: Switch blend mode to standard, verify particles still render', async ({ page }) => {
    const errors = pageErrors(page);
    await setPreset(page, 'smoke');
    await page.evaluate(() => window.__testHarness.setEmitterRate(40));
    await page.waitForTimeout(1000);

    const countBefore = await page.evaluate(() => window.__testHarness.getParticleCount());
    expect(countBefore).toBeGreaterThan(0);

    await page.click('#btn-blend-standard');
    await page.waitForTimeout(1000);

    const countAfter = await page.evaluate(() => window.__testHarness.getParticleCount());
    expect(countAfter).toBeGreaterThan(0);

    const config = await page.evaluate(() => window.__testHarness.getConfig());
    expect(config.blendMode).toBe('standard');

    errors.detach();
    expect(errors.errors).toHaveLength(0);

    test.info().annotations.push({
      type: 'quantified-metric',
      description: `E4.3: blend=standard, particles before=${countBefore}, after=${countAfter}.`,
    });
    await page.screenshot({ path: evidenceFile('e4-3-blend-standard.png') });
  });
});

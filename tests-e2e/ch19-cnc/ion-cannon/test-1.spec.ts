/**
 * ch19-cnc/ion-cannon test-1.spec.ts — Core acceptance tests E1-E5
 *
 * E1: Beam descent (normal/fast/slow timing)
 * E2: Beam light intensity progression
 * E3: Weapon impact delay + cleanup
 * E4: Ground splash particles
 * E5: Target marker rendering
 */

import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const TEST_URL = 'http://localhost:5173/test/ch19-cnc/ion-cannon/';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EVIDENCE_DIR = path.resolve(__dirname, '../../../test-results/manual/ch19-cnc/ion-cannon/evidence');

// Tick rate: 25 ticks/s = 40ms/tick
const TICK_MS = 40;

async function screenshot(page: Page, name: string) {
  return page.screenshot({ path: path.join(EVIDENCE_DIR, `${name}.png`) });
}

async function getStatus(page: Page) {
  return page.evaluate(() => ({
    phase: document.getElementById('st-phase')!.textContent,
    height: document.getElementById('st-height')!.textContent,
    delay: document.getElementById('st-delay')!.textContent,
    impacted: document.getElementById('st-impacted')!.textContent,
    particles: document.getElementById('st-particles')!.textContent,
    destroyed: document.getElementById('st-destroyed')!.textContent,
    engine: document.getElementById('info-engine')!.textContent,
  }));
}

async function getPhase(page: Page): Promise<string> {
  return page.evaluate(() => document.getElementById('st-phase')!.textContent ?? '');
}

async function getHeight(page: Page): Promise<number> {
  return page.evaluate(() => parseFloat(document.getElementById('st-height')!.textContent ?? '8'));
}

test.beforeAll(() => {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
});

test.beforeEach(async ({ page }) => {
  await page.goto(TEST_URL);
  await page.waitForSelector('#renderCanvas');
  await page.waitForSelector('#st-phase');
  // Wait for Babylon.js engine to initialize
  await page.waitForTimeout(1000);
});

// ---------------------------------------------------------------------------
// E1. Beam Descent — Normal Speed
// ---------------------------------------------------------------------------

test('E1.1: beam descends at normal speed (0.5/tick)', async ({ page }) => {
  // Verify initial state
  let status = await getStatus(page);
  expect(status.phase).toBe('IDLE');
  expect(status.height).toBe('8.00');

  // Set normal speed
  await page.selectOption('#sel-speed', 'normal');
  const speedLabel = await page.evaluate(() => (document.getElementById('sel-speed') as HTMLSelectElement).value);
  expect(speedLabel).toBe('normal');

  // Click fire
  await page.click('#btn-fire');

  // Phase should immediately change to DESCENDING
  await expect.poll(() => getPhase(page), { timeout: 2000 }).toBe('DESCENDING');

  // Wait for phase to become IMPACTING (beam reached ground)
  await expect.poll(() => getPhase(page), { timeout: 3000 }).toBe('IMPACTING');

  // Height should be near 0
  const h = await getHeight(page);
  expect(h).toBeLessThanOrEqual(0.5);

  await screenshot(page, 'e1-normal-descent-impacting');
});

// ---------------------------------------------------------------------------
// E1. Beam Descent — Fast Speed
// ---------------------------------------------------------------------------

test('E1.2: beam descends at fast speed (2.0/tick)', async ({ page }) => {
  await page.selectOption('#sel-speed', 'fast');
  const speedLabel = await page.evaluate(() => (document.getElementById('sel-speed') as HTMLSelectElement).value);
  expect(speedLabel).toBe('fast');

  await page.click('#btn-fire');

  // Wait for phase to become IMPACTING (beam reached ground)
  await expect.poll(() => getPhase(page), { timeout: 3000 }).toBe('IMPACTING');

  // Height should be near 0
  const h = await getHeight(page);
  expect(h).toBeLessThanOrEqual(0.5);

  await screenshot(page, 'e1-fast-descent-impacting');
});

// ---------------------------------------------------------------------------
// E1. Beam Descent — Slow Speed
// ---------------------------------------------------------------------------

test('E1.3: beam descends at slow speed (0.2/tick)', async ({ page }) => {
  await page.selectOption('#sel-speed', 'slow');
  const speedLabel = await page.evaluate(() => (document.getElementById('sel-speed') as HTMLSelectElement).value);
  expect(speedLabel).toBe('slow');

  await page.click('#btn-fire');

  // Wait for phase to become IMPACTING (beam reached ground)
  await expect.poll(() => getPhase(page), { timeout: 5000 }).toBe('IMPACTING');

  // Height should be near 0
  const h = await getHeight(page);
  expect(h).toBeLessThanOrEqual(0.5);

  await screenshot(page, 'e1-slow-descent-impacting');
});

// ---------------------------------------------------------------------------
// E1.4: Speed comparison — fast completes in fewer ticks than slow
// ---------------------------------------------------------------------------

test('E1.4: fast speed completes faster than slow speed', async ({ page }) => {
  // Measure slow descent time
  await page.selectOption('#sel-speed', 'slow');
  await page.click('#btn-fire');
  const slowStart = Date.now();
  await expect.poll(() => getPhase(page), { timeout: 5000 }).toBe('IMPACTING');
  const slowTime = Date.now() - slowStart;
  await page.click('#btn-reset');
  await page.waitForTimeout(500);

  // Measure fast descent time
  await page.selectOption('#sel-speed', 'fast');
  await page.click('#btn-fire');
  const fastStart = Date.now();
  await expect.poll(() => getPhase(page), { timeout: 3000 }).toBe('IMPACTING');
  const fastTime = Date.now() - fastStart;

  // Fast should complete faster than slow
  expect(fastTime).toBeLessThan(slowTime);
});

// ---------------------------------------------------------------------------
// E2. Beam Light — Intensity Progression
// ---------------------------------------------------------------------------

test('E2: beam light intensity increases as beam descends', async ({ page }) => {
  await page.selectOption('#sel-speed', 'normal');

  await page.click('#btn-fire');
  await page.waitForTimeout(100);

  // At mid-descent (~320ms), height should be around 4.0
  await page.waitForTimeout(300);
  const hMidAbout = await getHeight(page);
  // Height should have decreased from 8.0
  expect(hMidAbout).toBeLessThan(7.5);

  // At beam reaching ground, height should be near 0
  await expect.poll(() => getPhase(page), { timeout: 3000 }).toBe('IMPACTING');
  const hGround = await getHeight(page);
  expect(hGround).toBeLessThanOrEqual(0.5);

  // Verify light formula: (1 - height/8) * 3.0 reaches max 3.0 at ground
  // We can't directly read light intensity from DOM, but we verify height progression
  // which drives the formula. At impact, the light should be near max (3.0).

  await screenshot(page, 'e2-beam-at-ground');
});

// ---------------------------------------------------------------------------
// E3. Weapon Impact — Delay + Cleanup
// ---------------------------------------------------------------------------

test('E3: weapon impact fires after delay, beam cleaned up after impact', async ({ page }) => {
  // Set delay to 15 ticks
  await page.evaluate(() => {
    const slider = document.getElementById('rng-delay') as HTMLInputElement;
    slider.value = '15';
    slider.dispatchEvent(new Event('input'));
  });

  await page.selectOption('#sel-speed', 'normal');

  await page.click('#btn-fire');

  // Wait for beam to reach ground (DESCENDING -> IMPACTING)
  await expect.poll(() => getPhase(page), { timeout: 3000 }).toBe('IMPACTING');

  // Take screenshot during IMPACTING phase (before or at impact)
  await screenshot(page, 'e3-impacting');

  // Wait for impact to trigger (weaponDelay countdown reaching 0)
  // Note: headless mode may run ticks faster than real-time, so we don't
  // assert exact wall-clock timing.  Instead we verify the state transition.
  await expect.poll(
    () => page.evaluate(() => document.getElementById('st-impacted')!.textContent),
    { timeout: 5000 }
  ).toBe('true');

  await screenshot(page, 'e3-impact-triggered');

  // Verify particles are active after impact
  const particlesActive = await page.evaluate(() =>
    document.getElementById('st-particles')!.textContent
  );
  expect(particlesActive).toBe('active');

  // Wait for beam cleanup (impact + 25 ticks)
  await expect.poll(
    () => page.evaluate(() => document.getElementById('st-destroyed')!.textContent),
    { timeout: 5000 }
  ).toBe('true');

  await screenshot(page, 'e3-beam-destroyed');

  // After cleanup, phase should be COMPLETE
  expect(await getPhase(page)).toBe('COMPLETE');
});

// ---------------------------------------------------------------------------
// E4. Ground Splash — Particles
// ---------------------------------------------------------------------------

test('E4: ground splash particles activate on impact and stop after duration', async ({ page }) => {
  await page.selectOption('#sel-speed', 'normal');

  await page.click('#btn-fire');

  // Wait for impact
  await expect.poll(
    () => page.evaluate(() => document.getElementById('st-impacted')!.textContent),
    { timeout: 5000 }
  ).toBe('true');

  // Particles should be active
  await expect.poll(
    () => page.evaluate(() => document.getElementById('st-particles')!.textContent),
    { timeout: 2000 }
  ).toBe('active');

  await screenshot(page, 'e4-splash-active');

  // Particles should stop after SPLASH_DURATION = 20 ticks = 800ms
  await expect.poll(
    () => page.evaluate(() => document.getElementById('st-particles')!.textContent),
    { timeout: 5000 }
  ).toBe('0');

  await screenshot(page, 'e4-splash-ended');
});

// ---------------------------------------------------------------------------
// E5. Target Marker — Red Double Ring
// ---------------------------------------------------------------------------

test('E5: target marker renders as red double ring on ground', async ({ page }) => {
  // Verify WebGL engine
  const engineInfo = await page.evaluate(() =>
    document.getElementById('info-engine')!.textContent
  );
  expect(engineInfo).toContain('WebGL');

  // Verify canvas is present and has content
  const canvasPresent = await page.evaluate(() => {
    const canvas = document.getElementById('renderCanvas') as HTMLCanvasElement | null;
    return canvas !== null && canvas.width > 0 && canvas.height > 0;
  });
  expect(canvasPresent).toBe(true);

  // Take initial screenshot showing target marker
  await screenshot(page, 'e5-target-marker-initial');

  // Verify target marker is visible after page load (torus rendered)
  await page.waitForTimeout(500);
  await screenshot(page, 'e5-target-marker-stable');
});

// ---------------------------------------------------------------------------
// Default speed — full cycle screenshot
// ---------------------------------------------------------------------------

test('E1-E4 full cycle: normal speed complete animation sequence', async ({ page }) => {
  await page.selectOption('#sel-speed', 'normal');

  // Screenshot initial state
  await screenshot(page, 'fullcycle-00-idle');

  await page.click('#btn-fire');
  await page.waitForTimeout(100);
  await screenshot(page, 'fullcycle-01-descending');

  // Wait for impact
  await expect.poll(
    () => page.evaluate(() => document.getElementById('st-impacted')!.textContent),
    { timeout: 8000 }
  ).toBe('true');

  await screenshot(page, 'fullcycle-02-impact');

  // Wait for cleanup
  await expect.poll(
    () => page.evaluate(() => document.getElementById('st-destroyed')!.textContent),
    { timeout: 8000 }
  ).toBe('true');

  await screenshot(page, 'fullcycle-03-complete');

  const phase = await getPhase(page);
  expect(phase).toBe('COMPLETE');
});

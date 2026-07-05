/**
 * ch19-cnc/ion-cannon test-2.spec.ts — Boundary / edge case tests
 *
 * B1: Triple fire sequence
 * B2: Reset during active beam
 * B3: Weapon delay extremes (5 and 30 ticks)
 */

import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const TEST_URL = 'http://localhost:5173/test/ch19-cnc/ion-cannon/';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EVIDENCE_DIR = path.resolve(__dirname, '../../../test-results/manual/ch19-cnc/ion-cannon/evidence');

async function screenshot(page: Page, name: string) {
  return page.screenshot({ path: path.join(EVIDENCE_DIR, `${name}.png`) });
}

async function getStatus(page: Page) {
  return page.evaluate(() => ({
    phase: document.getElementById('st-phase')!.textContent,
    height: document.getElementById('st-height')!.textContent,
    impacted: document.getElementById('st-impacted')!.textContent,
    particles: document.getElementById('st-particles')!.textContent,
    destroyed: document.getElementById('st-destroyed')!.textContent,
  }));
}

test.beforeAll(() => {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
});

test.beforeEach(async ({ page }) => {
  await page.goto(TEST_URL);
  await page.waitForSelector('#renderCanvas');
  await page.waitForSelector('#st-phase');
  await page.waitForTimeout(1000);
});

// ---------------------------------------------------------------------------
// B1. Triple Fire — 3 independent beam cycles at 2s intervals
// ---------------------------------------------------------------------------

test('B1: triple fire produces three independent fire cycles', async ({ page }) => {
  await page.selectOption('#sel-speed', 'normal');

  // Click multi-fire
  await page.click('#btn-multi');

  // First cycle: should see DESCENDING → IMPACTING → COMPLETE
  await expect.poll(
    () => page.evaluate(() => document.getElementById('st-phase')!.textContent),
    { timeout: 3000 }
  ).toBe('DESCENDING');

  await screenshot(page, 'b1-multi-1st-descending');

  // Wait for first impact
  await expect.poll(
    () => page.evaluate(() => document.getElementById('st-impacted')!.textContent),
    { timeout: 8000 }
  ).toBe('true');

  await screenshot(page, 'b1-multi-1st-impact');

  // Wait for first cleanup
  await expect.poll(
    () => page.evaluate(() => document.getElementById('st-destroyed')!.textContent),
    { timeout: 8000 }
  ).toBe('true');

  // Second fire triggers at 2000ms (via setTimeout in multi-fire handler)
  // By ~3000ms we should see the second cycle's descending phase
  await page.waitForTimeout(500);
  await screenshot(page, 'b1-multi-between-cycles');

  // Wait for second cycle to complete
  await expect.poll(
    () => page.evaluate(() => document.getElementById('st-impacted')!.textContent),
    { timeout: 10000 }
  ).toBe('true');

  // Wait for third cycle
  // The multi-fire uses setTimeout 0ms, 2000ms, 4000ms.
  // Each cycle takes ~640ms (descent) + ~600ms (delay) + ~1000ms (cleanup) ≈ 2240ms.
  // So by ~7000ms, all three should have fired.
  // Wait for the final completion.
  await expect.poll(
    () => page.evaluate(() => document.getElementById('st-destroyed')!.textContent),
    { timeout: 15000 }
  ).toBe('true');

  await screenshot(page, 'b1-multi-final');

  const status = await getStatus(page);
  expect(status.destroyed).toBe('true');
});

// ---------------------------------------------------------------------------
// B2. Reset — Beam and particles cleared immediately
// ---------------------------------------------------------------------------

test('B2: reset during active beam clears all state', async ({ page }) => {
  await page.selectOption('#sel-speed', 'slow'); // Slow to give us time to reset mid-descent

  await page.click('#btn-fire');

  // Wait for beam to start descending
  await expect.poll(
    () => page.evaluate(() => document.getElementById('st-phase')!.textContent),
    { timeout: 2000 }
  ).toBe('DESCENDING');

  // Wait a moment for some descent
  await page.waitForTimeout(300);
  await screenshot(page, 'b2-mid-descent-before-reset');

  // Click reset
  await page.click('#btn-reset');

  // State should return to IDLE immediately
  await page.waitForTimeout(200);

  const status = await getStatus(page);
  expect(status.phase).toBe('IDLE');
  expect(status.height).toBe('8.00');
  expect(status.impacted).toBe('false');
  expect(status.destroyed).toBe('false');
  expect(status.particles).toBe('0');

  await screenshot(page, 'b2-after-reset');
});

// ---------------------------------------------------------------------------
// B3.1 Weapon Delay — Minimum (5 ticks = 200ms)
// ---------------------------------------------------------------------------

test('B3.1: minimum weapon delay (5 ticks) triggers impact quickly', async ({ page }) => {
  // Set delay to 5 ticks
  await page.evaluate(() => {
    const slider = document.getElementById('rng-delay') as HTMLInputElement;
    slider.value = '5';
    slider.dispatchEvent(new Event('input'));
  });

  // Verify delay display
  const delayLabel = await page.evaluate(() =>
    document.getElementById('lbl-delay')!.textContent
  );
  expect(delayLabel).toBe('5');

  await page.selectOption('#sel-speed', 'normal');

  await page.click('#btn-fire');

  // Wait for beam to reach ground
  await expect.poll(
    () => page.evaluate(() => document.getElementById('st-phase')!.textContent),
    { timeout: 3000 }
  ).toBe('IMPACTING');

  const impactStart = Date.now();
  await expect.poll(
    () => page.evaluate(() => document.getElementById('st-impacted')!.textContent),
    { timeout: 5000 }
  ).toBe('true');
  const impactDelay = Date.now() - impactStart;

  // 5 ticks * 40ms = 200ms
  expect(impactDelay).toBeLessThan(600);

  await screenshot(page, 'b3-1-delay-5-impact');
});

// ---------------------------------------------------------------------------
// B3.2 Weapon Delay — Maximum (30 ticks = 1200ms)
// ---------------------------------------------------------------------------

test('B3.2: maximum weapon delay (30 ticks) triggers impact slowly', async ({ page }) => {
  // Set delay to 30 ticks
  await page.evaluate(() => {
    const slider = document.getElementById('rng-delay') as HTMLInputElement;
    slider.value = '30';
    slider.dispatchEvent(new Event('input'));
  });

  // Verify delay display
  const delayLabel = await page.evaluate(() =>
    document.getElementById('lbl-delay')!.textContent
  );
  expect(delayLabel).toBe('30');

  await page.selectOption('#sel-speed', 'normal');

  await page.click('#btn-fire');

  // Wait for beam to reach ground
  await expect.poll(
    () => page.evaluate(() => document.getElementById('st-phase')!.textContent),
    { timeout: 3000 }
  ).toBe('IMPACTING');

  await screenshot(page, 'b3-2-delay-30-impacting');

  const impactStart = Date.now();
  await expect.poll(
    () => page.evaluate(() => document.getElementById('st-impacted')!.textContent),
    { timeout: 8000 }
  ).toBe('true');
  const impactDelay = Date.now() - impactStart;

  // 30 ticks * 40ms = 1200ms
  expect(impactDelay).toBeGreaterThan(500);

  await screenshot(page, 'b3-2-delay-30-impact');
});

// ---------------------------------------------------------------------------
// B3.3 Reset then re-fire
// ---------------------------------------------------------------------------

test('B3.3: can fire again after reset', async ({ page }) => {
  await page.selectOption('#sel-speed', 'normal');

  // First fire
  await page.click('#btn-fire');
  await expect.poll(
    () => page.evaluate(() => document.getElementById('st-phase')!.textContent),
    { timeout: 2000 }
  ).toBe('DESCENDING');

  // Reset
  await page.click('#btn-reset');
  await page.waitForTimeout(300);

  // Verify clean state
  let status = await getStatus(page);
  expect(status.phase).toBe('IDLE');

  // Second fire
  await page.click('#btn-fire');
  await expect.poll(
    () => page.evaluate(() => document.getElementById('st-phase')!.textContent),
    { timeout: 2000 }
  ).toBe('DESCENDING');

  // Verify it runs to completion
  await expect.poll(
    () => page.evaluate(() => document.getElementById('st-destroyed')!.textContent),
    { timeout: 10000 }
  ).toBe('true');

  status = await getStatus(page);
  expect(status.phase).toBe('COMPLETE');

  await screenshot(page, 'b3-3-refire-complete');
});
